import { VIDEO } from "../settings.ts";
import { SAMPLE_RATE, SAMPLES_PER_FRAME } from "./synth.ts";
import { midiToHz, type Note, type PieceScore, type VisualNoteEvent } from "./types.ts";

export interface WavDecodedStereo {
  readonly sampleRate: number;
  readonly channels: number;
  readonly frameCount: number;
  readonly mono: Float32Array;
  readonly left: Float32Array;
  readonly right: Float32Array;
}

export function decodeStereoPcm16Wav(wav: Buffer): WavDecodedStereo {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 16) !== "WAVEfmt ") {
    throw new Error("Invalid WAV header");
  }
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const bitsPerSample = wav.readUInt16LE(34);
  if (bitsPerSample !== 16 || (channels !== 1 && channels !== 2)) {
    throw new Error(`Unsupported WAV format: channels=${channels}, bits=${bitsPerSample}`);
  }
  const dataBytes = wav.readUInt32LE(40);
  const frameCount = Math.floor(dataBytes / (channels * 2));
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  const mono = new Float32Array(frameCount);

  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    const l = wav.readInt16LE(offset) / 32767;
    const r = channels === 2 ? wav.readInt16LE(offset + 2) / 32767 : l;
    left[i] = l;
    right[i] = r;
    mono[i] = 0.5 * (l + r);
    offset += channels * 2;
  }
  return { sampleRate, channels, frameCount, mono, left, right };
}

/** In-place radix-2 Cooley-Tukey FFT */
function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * wRe - im[i + k + half] * wIm;
        const vIm = re[i + k + half] * wIm + im[i + k + half] * wRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }
}

/**
 * Estimates dominant fundamental pitch in [minHz, maxHz] starting right after note onset
 * using a zero-padded 32768-point Hann-windowed FFT + harmonic product / fundamental check
 * + parabolic bin interpolation (~0.05 Hz resolution).
 */
export function measureNotePitchHz(
  mono: Float32Array,
  onsetTimeSec: number,
  durationSec: number,
  minHz = 55,
  maxHz = 2400,
): { dominantHz: number; fundamentalHz: number } {
  const fftSize = 32768;
  // Skip first 10 ms transient click so steady pitched body dominates
  const startSample = Math.max(0, Math.round((onsetTimeSec + 0.01) * SAMPLE_RATE));
  const winLen = Math.min(
    16384,
    Math.max(2048, Math.round(Math.min(0.24, durationSec * 0.85) * SAMPLE_RATE)),
    mono.length - startSample,
  );

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  for (let i = 0; i < winLen; i++) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, winLen - 1)));
    re[i] = mono[startSample + i] * hann;
  }
  fftRadix2(re, im);

  const binHz = SAMPLE_RATE / fftSize;
  const minBin = Math.max(2, Math.floor(minHz / binHz));
  const maxBin = Math.min((fftSize >> 1) - 2, Math.ceil(maxHz / binHz));
  const mag = new Float64Array(fftSize >> 1);
  for (let b = 1; b < mag.length; b++) {
    mag[b] = Math.hypot(re[b], im[b]);
  }

  let bestBin = minBin;
  let bestMag = -1;
  for (let b = minBin; b <= maxBin; b++) {
    if (mag[b] > bestMag) {
      bestMag = mag[b];
      bestBin = b;
    }
  }

  const refineBin = (b: number): number => {
    const m0 = mag[b - 1];
    const m1 = mag[b];
    const m2 = mag[b + 1];
    const denom = m0 - 2 * m1 + m2;
    const delta = Math.abs(denom) > 1e-12 ? (0.5 * (m0 - m2)) / denom : 0;
    return (b + Math.max(-0.5, Math.min(0.5, delta))) * binHz;
  };

  const dominantHz = refineBin(bestBin);

  // Check if dominant peak is the 2nd harmonic of a clear fundamental at half frequency
  let fundamentalHz = dominantHz;
  const halfBin = Math.round(bestBin / 2);
  if (halfBin >= minBin) {
    let subPeakBin = halfBin;
    let subPeakMag = 0;
    for (let b = Math.max(minBin, halfBin - 3); b <= Math.min(maxBin, halfBin + 3); b++) {
      if (mag[b] > subPeakMag) {
        subPeakMag = mag[b];
        subPeakBin = b;
      }
    }
    if (subPeakMag > bestMag * 0.42) {
      fundamentalHz = refineBin(subPeakBin);
    }
  }

  return { dominantHz, fundamentalHz };
}

export interface PitchSampleResult {
  readonly noteIndex: number;
  readonly time: number;
  readonly midi: number;
  readonly expectedHz: number;
  readonly measuredHz: number;
  readonly relErrorPct: number;
}

export interface PieceVerificationReport {
  readonly id: string;
  readonly durationSec: number;
  readonly wavDurationSec: number;
  readonly noteCount: number;
  readonly visualEventCount: number;
  readonly maxVisualFrameError: number;
  readonly maxAudioOnsetFrameError: number;
  readonly peak: number;
  readonly rmsDb: number;
  readonly dcOffset: number;
  readonly clippedSamples: number;
  readonly maxSilentGapSec: number;
  readonly pitchSamples: readonly PitchSampleResult[];
  readonly maxPitchErrorPct: number;
}

/**
 * Picks clean isolated / exposed lead notes across the piece so FFT measures a single note
 * rather than a dense polyphonic chord cluster.
 */
function selectPitchSampleNotes(notes: readonly Note[], maxSamples = 14): number[] {
  const candidates: number[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.duration < 0.13) continue;
    // Prefer exposed notes where no other note overlaps within [-0.04s, +0.11s]
    const overlapping = notes.some(
      (other, j) =>
        j !== i &&
        other.time <= n.time + 0.1 &&
        other.time + other.duration >= n.time - 0.02,
    );
    if (!overlapping) {
      candidates.push(i);
    }
  }

  // Fallback if piece is richly harmonized everywhere: pick notes where lead is loudest or bass is separated
  if (candidates.length < 6) {
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.duration < 0.14 || candidates.includes(i)) continue;
      const sameOnsetCount = notes.filter(
        (other) => Math.abs(other.time - n.time) < 0.06,
      ).length;
      if (sameOnsetCount === 1) {
        candidates.push(i);
      }
    }
  }

  if (candidates.length <= maxSamples) return candidates;
  const picked: number[] = [];
  for (let k = 0; k < maxSamples; k++) {
    const idx = Math.floor((k * (candidates.length - 1)) / Math.max(1, maxSamples - 1));
    picked.push(candidates[idx]);
  }
  return picked;
}

export function verifyPieceWavAndSync(
  score: PieceScore,
  wav: Buffer,
  visualEvents: readonly VisualNoteEvent[],
  opts: { allowedPauseWindow?: readonly [number, number] } = {},
): PieceVerificationReport {
  const decoded = decodeStereoPcm16Wav(wav);
  const expectedSamples = score.totalFrames * SAMPLES_PER_FRAME;
  if (decoded.frameCount !== expectedSamples) {
    throw new Error(
      `${score.id}: WAV sample count ${decoded.frameCount} != expected ${expectedSamples}`,
    );
  }

  // 1. Loudness, peak, DC offset, clipping
  let peak = 0;
  let sumSq = 0;
  let sumL = 0;
  let sumR = 0;
  let clippedSamples = 0;
  for (let i = 0; i < decoded.frameCount; i++) {
    const l = decoded.left[i];
    const r = decoded.right[i];
    const al = Math.abs(l);
    const ar = Math.abs(r);
    if (al > peak) peak = al;
    if (ar > peak) peak = ar;
    if (al >= 0.999 || ar >= 0.999) clippedSamples++;
    sumSq += 0.5 * (l * l + r * r);
    sumL += l;
    sumR += r;
  }
  const rms = Math.sqrt(sumSq / decoded.frameCount);
  const rmsDb = 20 * Math.log10(Math.max(1e-9, rms));
  const dcOffset = Math.max(Math.abs(sumL), Math.abs(sumR)) / decoded.frameCount;

  // 2. Silent gap scan (100 ms windows; ignore intended pre-payoff dramatic pause window if specified)
  const win = Math.round(0.1 * SAMPLE_RATE);
  let curSilentSec = 0;
  let maxSilentGapSec = 0;
  for (let s = 0; s + win <= decoded.frameCount; s += win) {
    const tSec = s / SAMPLE_RATE;
    if (
      opts.allowedPauseWindow &&
      tSec >= opts.allowedPauseWindow[0] &&
      tSec <= opts.allowedPauseWindow[1]
    ) {
      curSilentSec = 0;
      continue;
    }
    let wSq = 0;
    for (let i = 0; i < win; i++) {
      wSq += decoded.mono[s + i] * decoded.mono[s + i];
    }
    const wRms = Math.sqrt(wSq / win);
    if (wRms < 0.004) {
      curSilentSec += 0.1;
      if (curSilentSec > maxSilentGapSec) maxSilentGapSec = curSilentSec;
    } else {
      curSilentSec = 0;
    }
  }

  // 3. Visual event count & frame sync
  let maxVisualFrameError = 0;
  const count = Math.min(score.notes.length, visualEvents.length);
  for (let i = 0; i < count; i++) {
    const expectedFrame = Math.round(score.notes[i].time * VIDEO.fps);
    const err = Math.abs(visualEvents[i].frame - expectedFrame);
    if (err > maxVisualFrameError) maxVisualFrameError = err;
  }

  // 4. Acoustic onset check on sampled notes (confirm energy rises within +-1 frame of note.time)
  const sampleIndices = selectPitchSampleNotes(score.notes, 14);
  let maxAudioOnsetFrameError = 0;
  const pitchSamples: PitchSampleResult[] = [];

  for (const idx of sampleIndices) {
    const n = score.notes[idx];
    const expectedHz = midiToHz(n.midi);
    // Search narrow frequency band when other accompaniment/drone might be present, or full band first
    const full = measureNotePitchHz(decoded.mono, n.time, n.duration, 45, 2600);
    // Check both fundamentalHz and dominantHz (in case bass/drone sits below a high lead note)
    let measuredHz = full.fundamentalHz;
    if (
      Math.abs(full.dominantHz - expectedHz) / expectedHz <
      Math.abs(measuredHz - expectedHz) / expectedHz
    ) {
      measuredHz = full.dominantHz;
    }
    // If polyphonic harmony/reverb tail dominates global FFT, measure around target pitch (+-2 semitones = +-12%)
    // which catches any detuning or wrong semitone (5.95% >> 1%) while isolating from fourths/fifths in polyphony.
    if (Math.abs(measuredHz - expectedHz) / expectedHz > 0.02) {
      const local = measureNotePitchHz(
        decoded.mono,
        n.time,
        n.duration,
        expectedHz * 0.88,
        expectedHz * 1.12,
      );
      measuredHz = local.dominantHz;
    }
    const relErrorPct = (Math.abs(measuredHz - expectedHz) / expectedHz) * 100;
    pitchSamples.push({
      noteIndex: idx,
      time: Number(n.time.toFixed(3)),
      midi: n.midi,
      expectedHz: Number(expectedHz.toFixed(2)),
      measuredHz: Number(measuredHz.toFixed(2)),
      relErrorPct: Number(relErrorPct.toFixed(3)),
    });

    // Check frame-level energy onset around expectedFrame +- 1 frame
    const expectedFrame = Math.round(n.time * VIDEO.fps);
    let bestFrame = expectedFrame;
    let bestJump = -Infinity;
    for (let df = -1; df <= 1; df++) {
      const f = expectedFrame + df;
      if (f < 1 || f >= score.totalFrames - 1) continue;
      const s0 = f * SAMPLES_PER_FRAME;
      let pre = 0;
      let post = 0;
      const checkLen = Math.min(SAMPLES_PER_FRAME, decoded.frameCount - s0);
      for (let k = 0; k < checkLen; k++) {
        const a = decoded.mono[Math.max(0, s0 - checkLen + k)];
        const b = decoded.mono[s0 + k];
        pre += a * a;
        post += b * b;
      }
      const jump = post - pre * 0.65;
      if (jump > bestJump) {
        bestJump = jump;
        bestFrame = f;
      }
    }
    const onsetErr = Math.abs(bestFrame - expectedFrame);
    if (onsetErr > maxAudioOnsetFrameError) maxAudioOnsetFrameError = onsetErr;
  }

  const maxPitchErrorPct = pitchSamples.reduce(
    (mx, p) => Math.max(mx, p.relErrorPct),
    0,
  );

  return {
    id: score.id,
    durationSec: score.durationSec,
    wavDurationSec: decoded.frameCount / decoded.sampleRate,
    noteCount: score.notes.length,
    visualEventCount: visualEvents.length,
    maxVisualFrameError,
    maxAudioOnsetFrameError,
    peak: Number(peak.toFixed(4)),
    rmsDb: Number(rmsDb.toFixed(2)),
    dcOffset: Number(dcOffset.toFixed(6)),
    clippedSamples,
    maxSilentGapSec: Number(maxSilentGapSec.toFixed(2)),
    pitchSamples,
    maxPitchErrorPct: Number(maxPitchErrorPct.toFixed(3)),
  };
}
