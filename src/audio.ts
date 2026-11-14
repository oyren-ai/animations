import { SCENE_FRAMES, TOTAL_FRAMES, VIDEO } from "./settings.ts";
import type { Cue } from "./ball-drop/sim.ts";
import { WAVE } from "./pendulum-wave/wave.ts";

export const SAMPLE_RATE = 48000;
export const SAMPLES_PER_FRAME = SAMPLE_RATE / VIDEO.fps;
export type Tone = { frame: number; frequency: number; amplitude: number; length: number };
const scale = [261.625565, 293.664768, 329.627557, 391.995436, 440];

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
  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24); wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(sampleCount * 2, 40);
  for (let i = 0; i < sampleCount; i++) wav.writeInt16LE(Math.round(samples[i] * gain * 32767), 44 + i * 2);
  return wav;
}
