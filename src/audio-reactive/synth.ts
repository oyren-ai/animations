export const STEREO_SAMPLE_RATE = 48000;
export const SPECTRUM_BIN_COUNT = 32;

export interface StereoBuffer {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  fps: number;
  totalFrames: number;
}

export interface FrameAudioFeatures {
  frame: number;
  subBass: number;
  bass: number;
  mid: number;
  high: number;
  rms: number;
  kickImpulse: number;
  stereoWidth: number;
  spectrumBins: Float32Array;
}

export function panGains(pan: number): { left: number; right: number } {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0));
  const angle = ((clamped + 1) * Math.PI) / 4;
  return {
    left: Math.cos(angle),
    right: Math.sin(angle),
  };
}

export function panFromScreenX(x: number, width = 1080, maxSpread = 0.82): number {
  const norm = (x / Math.max(1, width)) * 2 - 1;
  return Math.max(-1, Math.min(1, norm * maxSpread));
}

export function createStereoBuffer(totalFrames: number, fps = 60): StereoBuffer {
  if (!Number.isInteger(totalFrames) || totalFrames <= 0 || !(fps > 0)) {
    throw new RangeError(`Invalid stereo buffer dimensions: frames=${totalFrames}, fps=${fps}`);
  }
  const sampleCount = Math.round((totalFrames / fps) * STEREO_SAMPLE_RATE);
  return {
    left: new Float32Array(sampleCount),
    right: new Float32Array(sampleCount),
    sampleRate: STEREO_SAMPLE_RATE,
    fps,
    totalFrames,
  };
}

function nextRandSigned(state: { s: number }): number {
  let x = state.s | 0;
  if (x === 0) x = 0x6d2b79f5;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.s = x;
  return (x >>> 0) / 2147483648 - 1;
}

export function addKick(
  buf: StereoBuffer,
  opts: {
    startSec: number;
    durationSec?: number;
    startHz?: number;
    endHz?: number;
    gain?: number;
  },
): void {
  const {
    startSec,
    durationSec = 0.34,
    startHz = 160,
    endHz = 55,
    gain = 0.55,
  } = opts;
  const start = Math.max(0, Math.round(startSec * buf.sampleRate));
  const count = Math.round(durationSec * buf.sampleRate);
  let phase = 0;

  for (let i = 0; i < count && start + i < buf.left.length; i++) {
    const t = i / buf.sampleRate;
    const freq = endHz + (startHz - endHz) * Math.exp(-t / 0.034);
    phase += (2 * Math.PI * freq) / buf.sampleRate;
    const attack = Math.min(1, t / 0.0025);
    const bodyEnv = Math.exp(-t * 8.2) * (1 - i / count);
    const click = Math.exp(-t * 95) * Math.sin(2 * Math.PI * 1150 * t) * 0.24;
    const body = Math.tanh(Math.sin(phase) * 1.45) * 0.92;
    const sample = gain * attack * (body * bodyEnv + click);
    buf.left[start + i] += sample * 0.70710678;
    buf.right[start + i] += sample * 0.70710678;
  }
}

export function addSnare(
  buf: StereoBuffer,
  opts: {
    startSec: number;
    durationSec?: number;
    gain?: number;
    pan?: number;
    seed?: number;
  },
): void {
  const { startSec, durationSec = 0.22, gain = 0.28, pan = 0, seed = 1337 } = opts;
  const start = Math.max(0, Math.round(startSec * buf.sampleRate));
  const count = Math.round(durationSec * buf.sampleRate);
  const { left: gL, right: gR } = panGains(pan);
  const rngL = { s: (seed ^ 0x9e3779b9) | 1 };
  const rngR = { s: (seed ^ 0x85ebca6b) | 1 };
  let tonePhase = 0;
  let lpL = 0;
  let hpL = 0;
  let lpR = 0;
  let hpR = 0;

  for (let i = 0; i < count && start + i < buf.left.length; i++) {
    const t = i / buf.sampleRate;
    const freq = 128 + 82 * Math.exp(-t / 0.022);
    tonePhase += (2 * Math.PI * freq) / buf.sampleRate;
    const tone = Math.sin(tonePhase) * Math.exp(-t * 22) * 0.55;

    const nL = nextRandSigned(rngL);
    const nR = nextRandSigned(rngR);
    lpL += 0.34 * (nL - lpL);
    hpL += 0.06 * (lpL - hpL);
    lpR += 0.34 * (nR - lpR);
    hpR += 0.06 * (lpR - hpR);

    const noiseEnv = Math.min(1, t / 0.002) * Math.exp(-t * 14.5) * (1 - i / count);
    const sL = gain * (tone + (lpL - hpL) * noiseEnv * 0.95);
    const sR = gain * (tone + (lpR - hpR) * noiseEnv * 0.95);
    buf.left[start + i] += sL * gL;
    buf.right[start + i] += sR * gR;
  }
}

export function addHiHat(
  buf: StereoBuffer,
  opts: {
    startSec: number;
    durationSec?: number;
    gain?: number;
    pan?: number;
    seed?: number;
  },
): void {
  const { startSec, durationSec = 0.075, gain = 0.14, pan = 0.18, seed = 7331 } = opts;
  const start = Math.max(0, Math.round(startSec * buf.sampleRate));
  const count = Math.round(durationSec * buf.sampleRate);
  const { left: gL, right: gR } = panGains(pan);
  const rng = { s: (seed ^ 0xc2b2ae35) | 1 };
  let prev = 0;

  for (let i = 0; i < count && start + i < buf.left.length; i++) {
    const t = i / buf.sampleRate;
    const raw = nextRandSigned(rng);
    const hp = raw - prev * 0.86;
    prev = raw;
    const metallic =
      (Math.sin(2 * Math.PI * 6340 * t) + Math.sin(2 * Math.PI * 8915 * t)) * 0.18;
    const env = Math.min(1, t / 0.0015) * Math.exp(-t * 42) * (1 - i / count);
    const sample = gain * env * (hp * 0.82 + metallic);
    buf.left[start + i] += sample * gL;
    buf.right[start + i] += sample * gR;
  }
}

export function addBassNote(
  buf: StereoBuffer,
  opts: {
    startSec: number;
    durationSec: number;
    frequency: number;
    gain?: number;
    brightness?: number;
  },
): void {
  const { startSec, durationSec, frequency, gain = 0.3, brightness = 1.0 } = opts;
  const start = Math.max(0, Math.round(startSec * buf.sampleRate));
  const count = Math.round(durationSec * buf.sampleRate);
  let phaseSub = 0;
  let phaseL = 0;
  let phaseR = 0;
  const detuneL = frequency * 0.9965;
  const detuneR = frequency * 1.0035;

  for (let i = 0; i < count && start + i < buf.left.length; i++) {
    const t = i / buf.sampleRate;
    const rem = (count - i) / buf.sampleRate;
    const env = Math.min(1, t / 0.008) * Math.min(1, rem / 0.018) * (0.68 + 0.32 * Math.exp(-t * 5.5));
    const filtDecay = Math.exp(-t * 6.5) * brightness;

    phaseSub += (2 * Math.PI * frequency) / buf.sampleRate;
    phaseL += (2 * Math.PI * detuneL) / buf.sampleRate;
    phaseR += (2 * Math.PI * detuneR) / buf.sampleRate;

    const sub = Math.sin(phaseSub) * 0.65;
    let sawL = 0;
    let sawR = 0;
    for (let h = 1; h <= 6; h++) {
      const weight = (1 / h) * Math.exp(-(h - 1) * (0.48 - 0.22 * filtDecay));
      sawL += Math.sin(phaseL * h) * weight;
      sawR += Math.sin(phaseR * h) * weight;
    }

    buf.left[start + i] += gain * env * Math.tanh((sub + sawL * 0.48) * 1.15) * 0.7071;
    buf.right[start + i] += gain * env * Math.tanh((sub + sawR * 0.48) * 1.15) * 0.7071;
  }
}

export function addPluck(
  buf: StereoBuffer,
  opts: {
    startSec: number;
    durationSec: number;
    frequency: number;
    gain?: number;
    pan?: number;
    fmIndex?: number;
  },
): void {
  const {
    startSec,
    durationSec,
    frequency,
    gain = 0.18,
    pan = 0,
    fmIndex = 1.65,
  } = opts;
  const start = Math.max(0, Math.round(startSec * buf.sampleRate));
  const count = Math.round(durationSec * buf.sampleRate);
  const { left: gL, right: gR } = panGains(pan);
  const decayRate = durationSec > 0.45 ? 4.6 : 9.2;

  for (let i = 0; i < count && start + i < buf.left.length; i++) {
    const t = i / buf.sampleRate;
    const attack = Math.min(1, t / 0.004);
    const decay = Math.exp(-t * decayRate);
    const tail = Math.min(1, (count - i) / Math.max(1, 0.014 * buf.sampleRate));
    const modEnv = fmIndex * Math.exp(-t * 18);
    const mod = Math.sin(2 * Math.PI * frequency * 2.0 * t) * modEnv;
    const carrier =
      Math.sin(2 * Math.PI * frequency * t + mod) +
      Math.sin(2 * Math.PI * frequency * 3.0 * t) * 0.16 * decay;
    // Subtle stereo Haas/chorus shimmer on higher frequencies
    const shimmer = Math.sin(2 * Math.PI * (frequency * 1.0025) * t + 0.45) * 0.22;
    const env = gain * attack * decay * tail;
    buf.left[start + i] += env * (carrier + shimmer) * gL;
    buf.right[start + i] += env * (carrier - shimmer) * gR;
  }
}

export function addPadChord(
  buf: StereoBuffer,
  opts: {
    startSec: number;
    durationSec: number;
    frequencies: readonly number[];
    gain?: number;
    stereoSpread?: number;
  },
): void {
  const {
    startSec,
    durationSec,
    frequencies,
    gain = 0.14,
    stereoSpread = 0.55,
  } = opts;
  if (frequencies.length === 0) return;
  const start = Math.max(0, Math.round(startSec * buf.sampleRate));
  const count = Math.round(durationSec * buf.sampleRate);
  const perVoiceGain = gain / Math.sqrt(frequencies.length);

  for (let v = 0; v < frequencies.length; v++) {
    const f = frequencies[v];
    const voicePan =
      frequencies.length === 1
        ? 0
        : ((v / (frequencies.length - 1)) * 2 - 1) * stereoSpread;
    const { left: gL, right: gR } = panGains(voicePan);
    const detuneA = f * 0.9982;
    const detuneB = f * 1.0018;

    for (let i = 0; i < count && start + i < buf.left.length; i++) {
      const t = i / buf.sampleRate;
      const rem = (count - i) / buf.sampleRate;
      const fadeIn = Math.min(1, t / 0.14);
      const fadeOut = Math.min(1, rem / 0.16);
      const breathe = 0.86 + 0.14 * Math.sin(2 * Math.PI * 0.42 * t + v * 0.9);
      const oscA = Math.sin(2 * Math.PI * detuneA * t) + 0.32 * Math.sin(4 * Math.PI * detuneA * t);
      const oscB = Math.sin(2 * Math.PI * detuneB * t + 0.6) + 0.32 * Math.sin(4 * Math.PI * detuneB * t + 0.6);
      const env = perVoiceGain * fadeIn * fadeOut * breathe;
      buf.left[start + i] += env * oscA * gL;
      buf.right[start + i] += env * oscB * gR;
    }
  }
}

/**
 * ITU-R BS.1770-4 K-weighting cascade at 48 kHz (Stage 1 pre-filter shelf + Stage 2 RLB high-pass).
 */
function applyKWeighting48k(input: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  // Stage 1: high-shelf pre-filter
  const b10 = 1.53512485958697;
  const b11 = -2.69169618940638;
  const b12 = 1.19839281085285;
  const a11 = -1.69065929318241;
  const a12 = 0.73248077421585;

  // Stage 2: RLB high-pass
  const b20 = 1.0;
  const b21 = -2.0;
  const b22 = 1.0;
  const a21 = -1.99004745483398;
  const a22 = 0.99007225036621;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let u1 = 0, u2 = 0, v1 = 0, v2 = 0;

  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b10 * x0 + b11 * x1 + b12 * x2 - a11 * y1 - a12 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;

    const v0 = b20 * y0 + b21 * u1 + b22 * u2 - a21 * v1 - a22 * v2;
    u2 = u1;
    u1 = y0;
    v2 = v1;
    v1 = v0;
    out[i] = v0;
  }
  return out;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function measureChannelTruePeakLinear(channel: Float32Array): number {
  let maxPeak = 0;
  const n = channel.length;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(channel[i]);
    if (a > maxPeak) maxPeak = a;
    if (i >= 1 && i < n - 2) {
      const p0 = channel[i - 1];
      const p1 = channel[i];
      const p2 = channel[i + 1];
      const p3 = channel[i + 2];
      for (const frac of [0.25, 0.5, 0.75]) {
        const interp = Math.abs(catmullRom(p0, p1, p2, p3, frac));
        if (interp > maxPeak) maxPeak = interp;
      }
    }
  }
  return maxPeak;
}

export function measureStereoLufsAndPeak(
  left: Float32Array,
  right: Float32Array,
): { integratedLufs: number; truePeakDb: number; samplePeakDb: number } {
  const kwL = applyKWeighting48k(left);
  const kwR = applyKWeighting48k(right);
  const blockSamples = Math.round(0.4 * STEREO_SAMPLE_RATE); // 400 ms gating block
  const hopSamples = Math.round(0.1 * STEREO_SAMPLE_RATE); // 75% overlap per BS.1770-4
  const blockEnergies: number[] = [];

  if (left.length < blockSamples) {
    let sum = 0;
    for (let i = 0; i < left.length; i++) {
      sum += kwL[i] * kwL[i] + kwR[i] * kwR[i];
    }
    const z = sum / Math.max(1, left.length);
    blockEnergies.push(z);
  } else {
    for (let start = 0; start + blockSamples <= left.length; start += hopSamples) {
      let sumL = 0;
      let sumR = 0;
      for (let i = 0; i < blockSamples; i++) {
        const l = kwL[start + i];
        const r = kwR[start + i];
        sumL += l * l;
        sumR += r * r;
      }
      blockEnergies.push((sumL + sumR) / blockSamples);
    }
  }

  // Absolute gate (-70 LUFS)
  const absGateZ = 10 ** ((-70 + 0.691) / 10);
  const aboveAbs = blockEnergies.filter((z) => z > absGateZ);
  let integratedZ = 1e-12;
  if (aboveAbs.length > 0) {
    const meanAbs = aboveAbs.reduce((a, b) => a + b, 0) / aboveAbs.length;
    const relGateLufs = -0.691 + 10 * Math.log10(meanAbs) - 10;
    const relGateZ = 10 ** ((relGateLufs + 0.691) / 10);
    const aboveRel = aboveAbs.filter((z) => z > relGateZ);
    integratedZ =
      aboveRel.length > 0
        ? aboveRel.reduce((a, b) => a + b, 0) / aboveRel.length
        : meanAbs;
  }

  const integratedLufs = -0.691 + 10 * Math.log10(Math.max(1e-12, integratedZ));
  let samplePeak = 0;
  for (let i = 0; i < left.length; i++) {
    samplePeak = Math.max(samplePeak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const truePeak = Math.max(
    measureChannelTruePeakLinear(left),
    measureChannelTruePeakLinear(right),
  );
  return {
    integratedLufs,
    truePeakDb: 20 * Math.log10(Math.max(1e-9, truePeak)),
    samplePeakDb: 20 * Math.log10(Math.max(1e-9, samplePeak)),
  };
}

export function calibrateStereoMaster(
  buf: StereoBuffer,
  opts: { targetLufs?: number; ceilingDbTp?: number } = {},
): { integratedLufs: number; truePeakDb: number } {
  const targetLufs = opts.targetLufs ?? -14.0;
  const ceilingDbTp = opts.ceilingDbTp ?? -1.8;
  // Leave extra 0.25 dB safety margin for inter-sample Catmull-Rom / sinc reconstruction
  const ceilingLinear = 10 ** ((ceilingDbTp - 0.28) / 20);

  for (let pass = 0; pass < 3; pass++) {
    const current = measureStereoLufsAndPeak(buf.left, buf.right);
    if (!Number.isFinite(current.integratedLufs) || current.integratedLufs < -65) break;
    const deltaDb = Math.max(-18, Math.min(24, targetLufs - current.integratedLufs));
    const linearGain = 10 ** (deltaDb / 20);
    for (let i = 0; i < buf.left.length; i++) {
      buf.left[i] = ceilingLinear * Math.tanh((buf.left[i] * linearGain) / ceilingLinear);
      buf.right[i] = ceilingLinear * Math.tanh((buf.right[i] * linearGain) / ceilingLinear);
    }
  }

  // Final strict true-peak guard
  const finalCheck = measureStereoLufsAndPeak(buf.left, buf.right);
  if (finalCheck.truePeakDb > ceilingDbTp) {
    const trim = 10 ** ((ceilingDbTp - finalCheck.truePeakDb - 0.05) / 20);
    for (let i = 0; i < buf.left.length; i++) {
      buf.left[i] *= trim;
      buf.right[i] *= trim;
    }
    const postTrim = measureStereoLufsAndPeak(buf.left, buf.right);
    return { integratedLufs: postTrim.integratedLufs, truePeakDb: postTrim.truePeakDb };
  }

  return {
    integratedLufs: finalCheck.integratedLufs,
    truePeakDb: finalCheck.truePeakDb,
  };
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    bytes[offset + i] = text.charCodeAt(i) & 0xff;
  }
}

export function encodeStereoPcm16Wav(left: Float32Array, right: Float32Array): Uint8Array {
  if (left.length !== right.length) {
    throw new RangeError(`Channel length mismatch: left=${left.length}, right=${right.length}`);
  }
  const sampleCount = left.length;
  const dataBytes = sampleCount * 4;
  const wav = new Uint8Array(44 + dataBytes);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  writeAscii(wav, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(wav, 8, "WAVEfmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, 2, true); // NumChannels = 2 (Stereo)
  view.setUint32(24, STEREO_SAMPLE_RATE, true);
  view.setUint32(28, STEREO_SAMPLE_RATE * 4, true); // ByteRate = 48000 * 2 * 2
  view.setUint16(32, 4, true); // BlockAlign = 4
  view.setUint16(34, 16, true); // BitsPerSample = 16
  writeAscii(wav, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < sampleCount; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    const offset = 44 + i * 4;
    view.setInt16(offset, Math.round(l * 32767), true);
    view.setInt16(offset + 2, Math.round(r * 32767), true);
  }
  return wav;
}

const SPECTRUM_FREQS = Array.from({ length: SPECTRUM_BIN_COUNT }, (_, idx) => {
  const minHz = 40;
  const maxHz = 8000;
  return minHz * (maxHz / minHz) ** (idx / (SPECTRUM_BIN_COUNT - 1));
});

/**
 * Deterministic per-frame audio envelope and 32-band log-frequency spectrum extractor.
 * Computes features directly from the stereo PCM buffers so Canvas2D and WebGL2 shaders
 * render identical frames under arbitrary scrubbing or concurrent worker slices.
 */
export function extractFrameAudioFeatures(
  left: Float32Array,
  right: Float32Array,
  fps = 60,
): FrameAudioFeatures[] {
  if (left.length !== right.length) {
    throw new RangeError("Left and right buffers must have equal length");
  }
  const samplesPerFrame = STEREO_SAMPLE_RATE / fps;
  const totalFrames = Math.max(1, Math.round(left.length / samplesPerFrame));
  const winSize = 1024;
  const hann = new Float32Array(winSize);
  for (let n = 0; n < winSize; n++) {
    hann[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (winSize - 1)));
  }

  // Precompute Goertzel coefficients for 32 log-spaced frequencies
  const coeffs = SPECTRUM_FREQS.map((freq) => {
    const omega = (2 * Math.PI * freq) / STEREO_SAMPLE_RATE;
    return 2 * Math.cos(omega);
  });

  const rawBins: Float32Array[] = new Array(totalFrames);
  const rawRms = new Float32Array(totalFrames);
  const rawWidth = new Float32Array(totalFrames);
  const windowed = new Float32Array(winSize);

  let maxRms = 1e-6;
  const maxPerBin = new Float32Array(SPECTRUM_BIN_COUNT).fill(1e-6);

  for (let f = 0; f < totalFrames; f++) {
    const center = Math.round((f + 0.5) * samplesPerFrame);
    const start = center - (winSize >> 1);
    let midSq = 0;
    let sideSq = 0;

    for (let n = 0; n < winSize; n++) {
      const idx = start + n;
      const l = idx >= 0 && idx < left.length ? left[idx] : 0;
      const r = idx >= 0 && idx < right.length ? right[idx] : 0;
      const mid = 0.5 * (l + r);
      const side = 0.5 * (l - r);
      midSq += mid * mid;
      sideSq += side * side;
      windowed[n] = mid * hann[n];
    }

    const rms = Math.sqrt((midSq + sideSq) / winSize);
    rawRms[f] = rms;
    if (rms > maxRms) maxRms = rms;
    rawWidth[f] = Math.min(1, Math.sqrt(sideSq / Math.max(1e-9, midSq + sideSq)) * 1.414);

    const bins = new Float32Array(SPECTRUM_BIN_COUNT);
    for (let b = 0; b < SPECTRUM_BIN_COUNT; b++) {
      const coeff = coeffs[b];
      let s1 = 0;
      let s2 = 0;
      for (let n = 0; n < winSize; n++) {
        const s0 = windowed[n] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const tilt = (SPECTRUM_FREQS[b] / 120) ** 0.14;
      const mag = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) * (2 / winSize) * tilt;
      bins[b] = mag;
      if (mag > maxPerBin[b]) maxPerBin[b] = mag;
    }
    rawBins[f] = bins;
  }

  let globalBinPeak = 1e-6;
  for (let b = 0; b < SPECTRUM_BIN_COUNT; b++) {
    if (maxPerBin[b] > globalBinPeak) globalBinPeak = maxPerBin[b];
  }

  const smoothedBins = new Float32Array(SPECTRUM_BIN_COUNT);
  let prevLow = 0;
  let kickEnv = 0;
  let smoothRms = 0;

  const features: FrameAudioFeatures[] = new Array(totalFrames);
  const release = Math.exp(-1 / (0.09 * fps));
  const kickRelease = Math.exp(-1 / (0.12 * fps));

  for (let f = 0; f < totalFrames; f++) {
    const bins = new Float32Array(SPECTRUM_BIN_COUNT);
    for (let b = 0; b < SPECTRUM_BIN_COUNT; b++) {
      const normRef = 0.85 * maxPerBin[b] + 0.15 * globalBinPeak;
      const target = Math.min(1, (rawBins[f][b] / Math.max(1e-6, normRef)) ** 0.8);
      smoothedBins[b] =
        target >= smoothedBins[b]
          ? smoothedBins[b] * 0.2 + target * 0.8
          : smoothedBins[b] * release + target * (1 - release);
      bins[b] = smoothedBins[b];
    }

    const bandLevel = (lo: number, hi: number) => {
      let sum = 0;
      let peak = 0;
      for (let b = lo; b <= hi; b++) {
        sum += bins[b];
        if (bins[b] > peak) peak = bins[b];
      }
      const mean = sum / (hi - lo + 1);
      return Math.min(1, 0.55 * peak + 0.45 * mean);
    };

    const subBass = bandLevel(0, 5);
    const bass = bandLevel(6, 11);
    const mid = bandLevel(12, 21);
    const high = bandLevel(22, 31);

    const lowEnergy = Math.max(subBass, bass * 0.85);
    const flux = Math.max(0, lowEnergy - prevLow * 0.86);
    prevLow = lowEnergy;
    const kickTarget = Math.min(1, flux * 2.1 + subBass * 0.45);
    kickEnv = Math.max(kickTarget, kickEnv * kickRelease);

    const normRms = Math.min(1, rawRms[f] / Math.max(1e-6, maxRms));
    smoothRms = normRms > smoothRms ? smoothRms * 0.35 + normRms * 0.65 : smoothRms * 0.82 + normRms * 0.18;

    features[f] = {
      frame: f,
      subBass,
      bass,
      mid,
      high,
      rms: smoothRms,
      kickImpulse: kickEnv,
      stereoWidth: rawWidth[f],
      spectrumBins: bins,
    };
  }

  return features;
}
