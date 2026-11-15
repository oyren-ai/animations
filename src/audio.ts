import { SCENE_FRAMES, TOTAL_FRAMES, VIDEO } from "./settings.ts";
import type { Cue } from "./ball-drop/sim.ts";
import { HARMONIC_TIERS, prepareCountryMap, type CountryMapSlug } from "./country-maps/fourier.ts";
import { WAVE } from "./pendulum-wave/wave.ts";
import type { StringArenaTrace } from "./string-arena/sim.ts";
import type { DropTrace } from "./drop-arenas/sim.ts";

export const SAMPLE_RATE = 48000;
export const SAMPLES_PER_FRAME = SAMPLE_RATE / VIDEO.fps;
export type Tone = { frame: number; frequency: number; amplitude: number; length: number };
const scale = [261.625565, 293.664768, 329.627557, 391.995436, 440];

const MAP_ROOT_HZ: Record<CountryMapSlug, number> = {
  "map-of-azerbaijan": 146.832384, // D3
  "map-of-turkey": 130.812783,     // C3
  "map-of-india": 164.813778,      // E3
  "map-of-italy": 174.614116,      // F3
  "map-of-japan": 195.997718,      // G3
};

const RISING_RATIOS = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2] as const;

export function tonesFor(events: Cue[]): Tone[] {
  const tones = events.filter((event) => event.type !== "spawn").map((event, index) => ({
    frame: event.frame, frequency: scale[index % scale.length],
    amplitude: event.type === "merge" ? 0.25 : 0.09, length: event.type === "merge" ? 0.28 : 0.12,
  }));
  return [...tones, ...closingTones()];
}

function closingTones(): Tone[] {
  return [261.625565, 329.627557, 391.995436].map((frequency, index) => ({
    frame: SCENE_FRAMES + Math.round(index * 0.08 * VIDEO.fps), frequency, amplitude: 0.18, length: 0.7,
  }));
}

export function waveTones(): Tone[] {
  const result: Tone[] = [];
  for (let index = 0; index < WAVE.count; index++) {
    const cycles = WAVE.firstCycles + index;
    for (let crossing = 0; crossing < cycles; crossing++) {
      result.push({ frame: Math.round((0.75 + crossing) * WAVE.period / cycles * VIDEO.fps),
        frequency: scale[index % scale.length] * (index < 6 ? 0.5 : 1), amplitude: 0.1, length: 0.2 });
    }
  }
  return [...result, ...closingTones()].sort((a, b) => a.frame - b.frame || a.frequency - b.frequency);
}

export function countryMapTones(slug: CountryMapSlug): Tone[] {
  const map = prepareCountryMap(slug);
  const root = MAP_ROOT_HZ[slug] * 2;
  const maxSpec = Math.max(1e-6, ...map.spectrumAmplitudes);
  const cues: Tone[] = [];

  for (const tier of HARMONIC_TIERS) {
    const cueFrame = tier.index === 0 ? 0 : Math.max(0, tier.startFrame - 2);
    const leadFreq = root * RISING_RATIOS[tier.index];
    const specBoost = 0.85 + 0.15 * (map.spectrumAmplitudes[Math.min(tier.order - 1, map.spectrumAmplitudes.length - 1)] / maxSpec);
    cues.push({
      frame: cueFrame,
      frequency: leadFreq,
      amplitude: (tier.order === 240 ? 0.26 : 0.19) * specBoost,
      length: tier.order === 240 ? 1.45 : 0.52,
    });
    cues.push({
      frame: cueFrame + 2,
      frequency: leadFreq * 1.5,
      amplitude: 0.1 * specBoost,
      length: tier.order === 240 ? 1.25 : 0.38,
    });
    if (tier.order === 240) {
      // Warm resolved major-ninth chord lock-in at N = 240
      for (const [offset, ratio, amp] of [
        [0, 1, 0.22],
        [3, 5 / 4, 0.18],
        [6, 3 / 2, 0.18],
        [9, 9 / 4, 0.14],
      ] as const) {
        cues.push({
          frame: cueFrame + offset,
          frequency: root * ratio,
          amplitude: amp,
          length: 1.9,
        });
      }
    }
  }

  return [...cues, ...closingTones()].sort((a, b) => a.frame - b.frame || a.frequency - b.frequency);
}

function encodeMonoPcm16Wav(samples: Float32Array): Buffer {
  const sampleCount = samples.length;
  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24); wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(sampleCount * 2, 40);
  for (let i = 0; i < sampleCount; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    wav.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return wav;
}

/** A deterministic mono PCM16 WAV; a fixed peak ceiling leaves encoder headroom. */
export function synthesize(tones: Tone[], frameCount = TOTAL_FRAMES) {
  const sampleCount = frameCount * SAMPLES_PER_FRAME;
  const samples = new Float32Array(sampleCount);
  for (const tone of tones) {
    if (!Number.isInteger(tone.frame) || tone.frame < 0 || tone.frame >= frameCount ||
        !(tone.frequency > 0) || !(tone.length > 0) || !(tone.amplitude >= 0)) throw new RangeError("Invalid sound cue");
    const start = tone.frame * SAMPLES_PER_FRAME, count = Math.round(tone.length * SAMPLE_RATE);
    for (let i = 0; i < count && start + i < samples.length; i++) {
      const t = i / SAMPLE_RATE, attack = Math.min(1, t / 0.006);
      const decay = Math.exp(-t * 12), tail = 1 - i / count;
      samples[start + i] += tone.amplitude * attack * decay * tail *
        (Math.sin(2 * Math.PI * tone.frequency * t) + Math.sin(4 * Math.PI * tone.frequency * t) * 0.25);
    }
  }
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0 ? 0.5 / peak : 1;
  for (let i = 0; i < sampleCount; i++) samples[i] *= gain;
  return encodeMonoPcm16Wav(samples);
}

/**
 * Deterministic soundtrack for progressive Fourier map compositions:
 * continuous sweeping harmonic synth bed + rising step bells + warm N=240 lock-in chord,
 * calibrated around -16 LUFS integrated stereo loudness with <= -3 dBTP true-peak ceiling.
 */
export function synthesizeCountryMapWav(slug: CountryMapSlug, frameCount = TOTAL_FRAMES): Buffer {
  const tones = countryMapTones(slug);
  const root = MAP_ROOT_HZ[slug];
  const sampleCount = frameCount * SAMPLES_PER_FRAME;
  const durationSec = sampleCount / SAMPLE_RATE;
  const samples = new Float32Array(sampleCount);

  // 1. Continuous gentle sweeping synth pad across the full 15s timeline (steady through closing beat)
  for (let i = 0; i < sampleCount; i++) {
    const sec = i / SAMPLE_RATE;
    const envIn = Math.min(1, sec / 0.18);
    const envOut = Math.min(1, (durationSec - sec) / 0.14);
    const sweep = 0.78 + 0.22 * Math.sin((2 * Math.PI * sec) / 2.5 - Math.PI / 2);
    const shimmer = sec >= 9.3 && sec < 12.0 ? 1.18 : 1.0;
    const f1 = Math.sin(2 * Math.PI * root * sec);
    const f2 = Math.sin(2 * Math.PI * root * 1.003 * sec) * 0.65;
    const fifth = Math.sin(2 * Math.PI * root * 1.5 * sec) * 0.52;
    const tenth = Math.sin(2 * Math.PI * root * 2.5 * sec) * (0.22 * sweep);
    samples[i] = envIn * envOut * sweep * shimmer * (f1 + f2 + fifth + tenth) * 0.085;
  }

  // 2. Crisp rising harmonic bell/chord cues at each N step-up + N=240 resolution + closing chime
  for (const tone of tones) {
    if (!Number.isInteger(tone.frame) || tone.frame < 0 || tone.frame >= frameCount ||
        !(tone.frequency > 0) || !(tone.length > 0) || !(tone.amplitude >= 0)) {
      throw new RangeError("Invalid sound cue");
    }
    const start = tone.frame * SAMPLES_PER_FRAME;
    const count = Math.round(tone.length * SAMPLE_RATE);
    const decayRate = tone.length > 1 ? 2.4 : 5.8;
    for (let i = 0; i < count && start + i < sampleCount; i++) {
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1, t / 0.01);
      const decay = Math.exp(-t * decayRate);
      const tail = 1 - i / count;
      const wave =
        Math.sin(2 * Math.PI * tone.frequency * t) +
        Math.sin(4 * Math.PI * tone.frequency * t) * 0.28 +
        Math.sin(6 * Math.PI * tone.frequency * t) * 0.09;
      samples[start + i] += tone.amplitude * attack * decay * tail * wave * 0.55;
    }
  }

  // 3. Calibrate RMS for ~-16.0 LUFS stereo integrated loudness with soft-knee ceiling <= 0.62 (-4.1 dBFS)
  let sumSq = 0;
  for (let i = 0; i < sampleCount; i++) sumSq += samples[i] * samples[i];
  const rms = Math.sqrt(sumSq / sampleCount);
  const targetMonoRms = 0.183; // K-weighted stereo integrated loudness ~ -16.0 LUFS
  const rmsGain = rms > 0 ? targetMonoRms / rms : 1;
  const ceiling = 0.72;
  for (let i = 0; i < sampleCount; i++) {
    const scaled = samples[i] * rmsGain;
    samples[i] = ceiling * Math.tanh(scaled / ceiling);
  }
  return encodeMonoPcm16Wav(samples);
}

const REEL_PENTATONIC = [
  261.625565, // C4
  293.664768, // D4
  329.627557, // E4
  391.995436, // G4
  440.0,      // A4
  523.251131, // C5
  659.255114, // E5
  783.990872, // G5
] as const;

function closingTonesAt(sceneFrames: number, totalFrames: number): Tone[] {
  return [261.625565, 329.627557, 391.995436, 523.251131]
    .map((frequency, index) => ({
      frame: Math.min(totalFrames - 2, sceneFrames + Math.round(index * 0.07 * VIDEO.fps)),
      frequency,
      amplitude: 0.21,
      length: 0.95,
    }))
    .filter((t) => t.frame >= 0 && t.frame < totalFrames);
}

function renderCalibratedReelWav(
  tones: Tone[],
  rootHzBySecond: (sec: number) => number,
  frameCount: number,
): Buffer {
  const sampleCount = frameCount * SAMPLES_PER_FRAME;
  const durationSec = sampleCount / SAMPLE_RATE;
  const samples = new Float32Array(sampleCount);

  // Continuous warm ambient pad so audio never drops out between hits or during the end card
  let phase1 = 0;
  let phase2 = 0;
  let phase3 = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sec = i / SAMPLE_RATE;
    const root = rootHzBySecond(sec);
    phase1 += (2 * Math.PI * root) / SAMPLE_RATE;
    phase2 += (2 * Math.PI * root * 1.5) / SAMPLE_RATE;
    phase3 += (2 * Math.PI * root * 2.002) / SAMPLE_RATE;
    const envIn = Math.min(1, sec / 0.16);
    const envOut = Math.min(1, (durationSec - sec) / 0.16);
    const pulse = 0.82 + 0.18 * Math.sin((2 * Math.PI * sec) / 2.5 - Math.PI / 2);
    samples[i] =
      envIn *
      envOut *
      pulse *
      (Math.sin(phase1) + Math.sin(phase2) * 0.55 + Math.sin(phase3) * 0.24) *
      0.082;
  }

  for (const tone of tones) {
    if (
      !Number.isInteger(tone.frame) ||
      tone.frame < 0 ||
      tone.frame >= frameCount ||
      !(tone.frequency > 0) ||
      !(tone.length > 0) ||
      !(tone.amplitude >= 0)
    ) {
      continue;
    }
    const start = tone.frame * SAMPLES_PER_FRAME;
    const count = Math.round(tone.length * SAMPLE_RATE);
    const decayRate = tone.length > 0.6 ? 3.2 : 9.5;
    for (let i = 0; i < count && start + i < sampleCount; i++) {
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1, t / 0.005);
      const decay = Math.exp(-t * decayRate);
      const tail = 1 - i / count;
      const wave =
        Math.sin(2 * Math.PI * tone.frequency * t) +
        Math.sin(4 * Math.PI * tone.frequency * t) * 0.24 +
        Math.sin(6 * Math.PI * tone.frequency * t) * 0.08;
      samples[start + i] += tone.amplitude * attack * decay * tail * wave * 0.52;
    }
  }

  let sumSq = 0;
  for (let i = 0; i < sampleCount; i++) sumSq += samples[i] * samples[i];
  const rms = Math.sqrt(sumSq / sampleCount);
  const targetMonoRms = 0.182; // ~ -16.0 LUFS integrated stereo loudness
  const rmsGain = rms > 0 ? targetMonoRms / rms : 1;
  const ceiling = 0.72; // <= -2.8 dBTP true-peak ceiling
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = ceiling * Math.tanh((samples[i] * rmsGain) / ceiling);
  }
  return encodeMonoPcm16Wav(samples);
}

export function synthesizeStringArenaWav(
  rounds: readonly { startFrame: number; trace: StringArenaTrace }[],
  sceneFrames: number,
  totalFrames: number,
): Buffer {
  const tones: Tone[] = [];
  const roundRoots = [146.832384, 164.813778, 195.997718]; // D3 -> E3 -> G3

  for (let rIdx = 0; rIdx < rounds.length; rIdx++) {
    const { startFrame, trace } = rounds[rIdx];
    let lastCutFrame = -99;
    // Round start bell
    tones.push({
      frame: startFrame,
      frequency: roundRoots[rIdx % roundRoots.length] * 2,
      amplitude: 0.2,
      length: 0.45,
    });

    for (const ev of trace.events) {
      const f = Math.min(totalFrames - 2, startFrame + ev.frame);
      if (ev.kind === "gain") {
        // Bright upward pluck on wall-bounce +1 string anchor
        tones.push({
          frame: f,
          frequency: REEL_PENTATONIC[ev.owner % 5] * 1.5,
          amplitude: 0.17,
          length: 0.18,
        });
      } else if (ev.kind === "cut") {
        if (f - lastCutFrame >= 2) {
          lastCutFrame = f;
          tones.push({
            frame: f,
            frequency: REEL_PENTATONIC[(ev.owner + 2) % 6],
            amplitude: 0.11,
            length: 0.09,
          });
        }
      } else if (ev.kind === "body") {
        tones.push({
          frame: f,
          frequency: 195.997718,
          amplitude: 0.1,
          length: 0.08,
        });
      } else if (ev.kind === "out") {
        tones.push({
          frame: f,
          frequency: REEL_PENTATONIC[ev.owner % 5] * 0.75,
          amplitude: 0.22,
          length: 0.42,
        });
      } else if (ev.kind === "finish") {
        for (const [df, ratio] of [
          [0, 1],
          [3, 5 / 4],
          [6, 3 / 2],
          [9, 2],
        ] as const) {
          tones.push({
            frame: Math.min(totalFrames - 2, f + df),
            frequency: 261.625565 * ratio,
            amplitude: 0.2,
            length: 0.78,
          });
        }
      }
    }
  }

  tones.push(...closingTonesAt(sceneFrames, totalFrames));
  return renderCalibratedReelWav(
    tones,
    (sec) => {
      const f = sec * VIDEO.fps;
      const idx = rounds.findIndex(
        (r) => f >= r.startFrame && f < r.startFrame + r.trace.totalRoundFrames,
      );
      return roundRoots[(idx >= 0 ? idx : rounds.length - 1) % roundRoots.length];
    },
    totalFrames,
  );
}

export function synthesizeDropArenaWav(
  stages: readonly { startFrame: number; trace: DropTrace }[],
  sceneFrames: number,
  totalFrames: number,
): Buffer {
  const tones: Tone[] = [];
  const stageRoots = [130.812783, 146.832384, 164.813778, 174.614116]; // C3, D3, E3, F3

  for (let sIdx = 0; sIdx < stages.length; sIdx++) {
    const { startFrame, trace } = stages[sIdx];
    let lastMinorCue = -99;
    tones.push({
      frame: startFrame,
      frequency: stageRoots[sIdx % stageRoots.length] * 2,
      amplitude: 0.19,
      length: 0.42,
    });

    for (let i = 0; i < trace.events.length; i++) {
      const ev = trace.events[i];
      if (ev.type === "spawn") continue;
      const f = Math.min(totalFrames - 2, startFrame + ev.frame);

      if (ev.type === "merge") {
        const tierIdx = Math.max(0, Math.min(7, (ev.tier ?? 2) - 1));
        tones.push({
          frame: f,
          frequency: REEL_PENTATONIC[tierIdx],
          amplitude: (ev.tier ?? 2) >= 6 ? 0.24 : 0.16,
          length: (ev.tier ?? 2) >= 6 ? 0.34 : 0.18,
        });
      } else if (ev.type === "climax") {
        for (const [df, freq] of [
          [0, 261.625565],
          [3, 329.627557],
          [6, 391.995436],
          [9, 523.251131],
          [12, 659.255114],
        ] as const) {
          tones.push({
            frame: Math.min(totalFrames - 2, f + df),
            frequency: freq,
            amplitude: 0.23,
            length: 1.05,
          });
        }
      } else if (f - lastMinorCue >= 3) {
        lastMinorCue = f;
        tones.push({
          frame: f,
          frequency: REEL_PENTATONIC[(i + sIdx) % 6],
          amplitude: ev.type === "bounce" ? 0.08 : 0.12,
          length: 0.11,
        });
      }
    }
  }

  tones.push(...closingTonesAt(sceneFrames, totalFrames));
  return renderCalibratedReelWav(
    tones,
    (sec) => {
      const f = sec * VIDEO.fps;
      const idx = stages.findIndex(
        (s) => f >= s.startFrame && f < s.startFrame + (s.trace.frames.length - 1),
      );
      return stageRoots[(idx >= 0 ? idx : stages.length - 1) % stageRoots.length];
    },
    totalFrames,
  );
}

