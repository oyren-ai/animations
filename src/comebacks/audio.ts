import {
  addBassNote,
  addHiHat,
  addKick,
  addPadChord,
  addPluck,
  addSnare,
  calibrateStereoMaster,
  createStereoBuffer,
  encodeStereoPcm16Wav,
  extractFrameAudioFeatures,
  panGains,
  type FrameAudioFeatures,
  type StereoBuffer,
} from "../audio-reactive/synth.ts";
import type { ComebackTraceBase } from "./invariants.ts";

export const LEFT_LANE_PAN = -0.62;
export const RIGHT_LANE_PAN = 0.62;

const LEFT_SCALE_HZ = [
  293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46, 783.99, 880.0, 1046.5,
] as const;

const RIGHT_ASCENT_SEMITONES = [
  0, 2, 4, 7, 9, 11, 12, 14, 16, 19, 21, 23, 24, 26, 28, 31, 33, 35, 36,
] as const;

function rightEventHz(pitchStep: number): number {
  const idx = Math.max(0, Math.min(RIGHT_ASCENT_SEMITONES.length - 1, Math.round(pitchStep)));
  const semis = RIGHT_ASCENT_SEMITONES[idx];
  return 220 * Math.pow(2, semis / 12);
}

/**
 * Adds a continuous 4-octave Shepard harmonic riser leading directly into overtakeSec.
 */
export function addShepardSuspenseRiser(
  buf: StereoBuffer,
  startSec: number,
  endSec: number,
  peakGain = 0.16,
): void {
  const s0 = Math.max(0, Math.round(startSec * buf.sampleRate));
  const s1 = Math.min(buf.left.length, Math.round(endSec * buf.sampleRate));
  if (s1 <= s0 + 480) return;

  const durSamples = s1 - s0;
  const phases = [0, 0, 0, 0];

  for (let i = 0; i < durSamples; i++) {
    const prog = i / durSamples; // 0 -> 1
    const env =
      Math.min(1, i / (0.08 * buf.sampleRate)) *
      Math.min(1, (durSamples - i) / (0.02 * buf.sampleRate)) *
      (0.28 + 0.72 * prog * prog);

    // Sweep 2.2 Shepard octaves upward as progress approaches overtake
    let sumL = 0;
    let sumR = 0;

    for (let oct = 0; oct < 4; oct++) {
      // Each voice wraps only where its spectral bell is silent; a shared wrap clicks.
      const normOct = ((oct + prog * 2.2) % 4) / 4; // 0 .. 1 across ~110 Hz -> 1760 Hz
      const freq = 110 * Math.pow(2, normOct * 4);
      phases[oct] += (2 * Math.PI * freq) / buf.sampleRate;
      // Raised-cosine spectral bell so octaves wrap seamlessly
      const bell = 0.5 * (1 - Math.cos(2 * Math.PI * normOct));
      const pan = Math.sin(prog * Math.PI * 5 + oct * 1.57) * 0.48;
      const { left: gL, right: gR } = panGains(pan);
      const sig = Math.sin(phases[oct]) * bell;
      sumL += sig * gL;
      sumR += sig * gR;
    }

    buf.left[s0 + i] += peakGain * env * sumL * 0.55;
    buf.right[s0 + i] += peakGain * env * sumR * 0.55;
  }
}

export interface ComebackAudioBundle {
  buffer: StereoBuffer;
  features: FrameAudioFeatures[];
}

export function buildComebackAudioBundle(trace: ComebackTraceBase): ComebackAudioBundle {
  const buf = createStereoBuffer(trace.totalFrames, trace.fps);
  const totalSec = trace.totalFrames / trace.fps;
  const overtakeSec = trace.overtakeFrame / trace.fps;
  const victorySec = trace.victoryFrame / trace.fps;

  // Find when early leader hits >= 80% progress to trigger endgame suspense riser
  const earlyArr = trace.earlyLeader === "left" ? trace.leftProgress : trace.rightProgress;
  let suspenseFrame = Math.floor(trace.overtakeFrame * 0.68);
  for (let f = 0; f < trace.overtakeFrame; f++) {
    if (earlyArr[f] >= 0.8) {
      suspenseFrame = f;
      break;
    }
  }
  const suspenseStartSec = Math.max(
    Math.max(2.0, overtakeSec - 6.5),
    Math.min(overtakeSec - 2.4, suspenseFrame / trace.fps),
  );

  // 1. Driving 128 BPM electronic rhythm & bass foundation across the full Short + EndCard
  const beatSec = 60 / 128; // 0.46875s
  const totalBeats = Math.ceil(totalSec / beatSec);
  const raceBassRoots = [73.42, 73.42, 87.31, 58.27, 73.42, 73.42, 65.41, 55.0]; // D2, F2, Bb1, C2, A1
  const winBassRoots = [73.42, 73.42, 110.0, 92.5]; // D2, A2, F#2 (triumphant D major!)

  for (let b = 0; b < totalBeats; b++) {
    const t = b * beatSec;
    if (t >= totalSec - 0.06) break;

    const inSuspense = t >= suspenseStartSec && t < overtakeSec - 0.08;
    const postOvertake = t >= overtakeSec - 0.02;
    const inClosing = t >= victorySec + 1.2;

    // Punchy 4-on-the-floor kick + double-time heartbeat during suspense
    addKick(buf, {
      startSec: t,
      durationSec: 0.3,
      startHz: postOvertake ? 168 : 152,
      endHz: 52,
      gain: inClosing ? 0.38 : postOvertake ? 0.52 : 0.46,
    });
    if (inSuspense) {
      const tension = (t - suspenseStartSec) / Math.max(0.4, overtakeSec - suspenseStartSec);
      addKick(buf, {
        startSec: t + beatSec * 0.5,
        durationSec: 0.2,
        startHz: 145 + tension * 35,
        endHz: 58,
        gain: 0.28 + tension * 0.16,
      });
      if (tension > 0.58 && t + beatSec * 0.75 < overtakeSec) {
        addSnare(buf, {
          startSec: t + beatSec * 0.75,
          durationSec: 0.12,
          gain: 0.16 + tension * 0.1,
          pan: (b % 2 === 0 ? -1 : 1) * 0.35,
          seed: 900 + b,
        });
      }
    }

    // Snare on beats 2 & 4
    if (b % 2 === 1) {
      addSnare(buf, {
        startSec: t,
        durationSec: 0.19,
        gain: postOvertake ? 0.26 : 0.22,
        pan: (b % 4 === 1 ? -1 : 1) * 0.14,
        seed: 2026 + b,
      });
    }

    // Crisp stereo 8th/16th hi-hats
    for (let s = 0; s < 4; s++) {
      const ht = t + s * (beatSec * 0.25);
      if (ht >= totalSec - 0.04) break;
      if (!inSuspense && !postOvertake && s % 2 === 1) continue;
      addHiHat(buf, {
        startSec: ht,
        durationSec: s === 2 ? 0.085 : 0.055,
        gain: s === 2 ? 0.12 : 0.075,
        pan: (s % 2 === 0 ? -1 : 1) * 0.36,
        seed: 5100 + b * 4 + s,
      });
    }

    // Bassline (switches from minor tension to triumphant major at overtake!)
    const bassFreq = postOvertake
      ? winBassRoots[b % winBassRoots.length]
      : raceBassRoots[b % raceBassRoots.length];
    addBassNote(buf, {
      startSec: t,
      durationSec: beatSec * 0.46,
      frequency: bassFreq,
      gain: 0.26,
      brightness: postOvertake ? 1.18 : 0.92,
    });
    addBassNote(buf, {
      startSec: t + beatSec * 0.5,
      durationSec: beatSec * 0.44,
      frequency: bassFreq * (postOvertake ? 1.5 : 1.0),
      gain: 0.21,
      brightness: 1.05,
    });
  }

  // 2. Atmospheric harmonic pad chords (minor suspense -> D major-9th triumph through EndCard)
  const barSec = beatSec * 4;
  for (let t = 0; t < totalSec - 0.2; t += barSec) {
    const dur = Math.min(barSec * 1.04, totalSec - t);
    const isTriumph = t >= overtakeSec - 0.25;
    const freqs = isTriumph
      ? [146.83, 220.0, 369.99, 554.37, 659.25] // D major 9th!
      : t >= suspenseStartSec
        ? [146.83, 220.0, 329.63, 440.0, 466.16] // D minor add b6 tension!
        : [146.83, 220.0, 349.23, 440.0]; // D minor 7
    addPadChord(buf, {
      startSec: t,
      durationSec: dur,
      frequencies: freqs,
      gain: isTriumph ? 0.16 : 0.12,
      stereoSpread: isTriumph ? 0.72 : 0.52,
    });
  }

  // 3. Shepard harmonic suspense riser leading into exact overtakeSec
  addShepardSuspenseRiser(buf, suspenseStartSec, overtakeSec, 0.17);

  // 4. Spatial lane event plucks (Left = -0.62, Right = +0.62)
  let lastLeftSec = -1;
  let lastRightSec = -1;
  for (const ev of trace.events) {
    const t = ev.frame / trace.fps;
    if (t >= totalSec - 0.05) continue;

    if (ev.kind === "overtake" || ev.kind === "victory") {
      // Visceral stereo sub-bass drop + triumphant major-9th chord stab!
      addKick(buf, {
        startSec: t,
        durationSec: 0.62,
        startHz: 176,
        endHz: 44,
        gain: ev.kind === "victory" ? 0.74 : 0.68,
      });
      addSnare(buf, { startSec: t, durationSec: 0.3, gain: 0.26, pan: -0.48, seed: 8001 + ev.frame });
      addSnare(buf, { startSec: t, durationSec: 0.3, gain: 0.26, pan: 0.48, seed: 8002 + ev.frame });
      addPadChord(buf, {
        startSec: t,
        durationSec: Math.min(2.2, totalSec - t),
        frequencies: [293.66, 369.99, 440.0, 554.37, 659.25],
        gain: 0.2,
        stereoSpread: 0.8,
      });
      continue;
    }

    if (ev.side === "left") {
      if (t - lastLeftSec < 0.055) continue;
      lastLeftSec = t;
      const hz = LEFT_SCALE_HZ[Math.max(0, Math.min(LEFT_SCALE_HZ.length - 1, ev.stageIndex))];
      addPluck(buf, {
        startSec: t,
        durationSec: 0.22,
        frequency: hz,
        gain: 0.14 + ev.intensity * 0.06,
        pan: LEFT_LANE_PAN,
        fmIndex: 1.4,
      });
    } else {
      if (t - lastRightSec < 0.042) continue;
      lastRightSec = t;
      const hz = rightEventHz(ev.pitchStep);
      addPluck(buf, {
        startSec: t,
        durationSec: ev.kind === "stage-break" ? 0.32 : 0.24,
        frequency: hz,
        gain: 0.16 + ev.intensity * 0.11,
        pan: RIGHT_LANE_PAN,
        fmIndex: 1.5 + ev.intensity * 1.1,
      });
      if (ev.kind === "stage-break" || ev.intensity >= 0.65) {
        addSnare(buf, {
          startSec: t,
          durationSec: 0.15,
          gain: 0.16 * ev.intensity,
          pan: RIGHT_LANE_PAN * 0.8,
          seed: 4400 + ev.frame,
        });
      }
    }
  }

  // 5. Calibrate integrated loudness to -14.0 LUFS with <= -1.8 dBTP true-peak soft-clipper
  calibrateStereoMaster(buf, { targetLufs: -14.0, ceilingDbTp: -1.8 });
  const features = extractFrameAudioFeatures(buf.left, buf.right, buf.fps);
  return { buffer: buf, features };
}

export function encodeComebackWavFromBundle(bundle: ComebackAudioBundle): Uint8Array {
  return encodeStereoPcm16Wav(bundle.buffer.left, bundle.buffer.right);
}
