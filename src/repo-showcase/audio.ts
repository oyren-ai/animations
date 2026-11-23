// Node-only audio build for AnimationsRepoShowcase: the English voice clips are placed on the timing map,
// a procedural 48 kHz stereo bed (the repo's own synth) is scaled to sit 12 LU under the voice, and the
// mix is mastered to about -14 LUFS with true peak at or below -1.5 dBTP. Deterministic for a given input.
import { readFileSync } from "node:fs";
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
  measureStereoLufsAndPeak,
  STEREO_SAMPLE_RATE,
  type StereoBuffer,
} from "../audio-reactive/synth.ts";
import { SHOWCASE_FPS, SHOWCASE_TIMING, type ShowcaseTiming } from "./timing.ts";
import { SHOWCASE_VOICE_DATA } from "./voice.generated.ts";

const BPM = 124;
const BEAT = 60 / BPM;
const BED_UNDER_VOICE_LU = 12;
const CLIP_FADE_SAMPLES = Math.round(0.004 * STEREO_SAMPLE_RATE);

export interface DecodedWav {
  readonly sampleRate: number;
  readonly left: Float32Array;
  readonly right: Float32Array;
}

/** Decodes a 16-bit PCM wav (mono or stereo) without any Node-specific helpers. */
export function decodeStereoPcm16Wav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      if (view.getUint16(offset + 8, true) !== 1 || view.getUint16(offset + 22, true) !== 16) throw new Error("expected 16-bit PCM wav");
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
    }
    if (id === "data") {
      if (channels < 1 || channels > 2) throw new Error("expected a mono or stereo wav");
      const frames = Math.floor(Math.min(size, bytes.byteLength - offset - 8) / 2 / channels);
      const left = new Float32Array(frames);
      const right = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        left[i] = view.getInt16(offset + 8 + i * 2 * channels, true) / 32768;
        right[i] = channels === 2 ? view.getInt16(offset + 8 + (i * 2 + 1) * 2, true) / 32768 : left[i];
      }
      return { sampleRate, left, right };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("wav without a data chunk");
}

/** Reads the five committed voice clips (48 kHz mono) as float samples, one array per script line. */
export function loadShowcaseVoice(read: (publicPath: string) => Uint8Array = (path) => readFileSync(new URL(`../../public/${path}`, import.meta.url))): Float32Array[] {
  return SHOWCASE_VOICE_DATA.lines.map((clip) => {
    const wav = decodeStereoPcm16Wav(read(clip.file));
    if (wav.sampleRate !== STEREO_SAMPLE_RATE) throw new Error(`${clip.file} must be 48 kHz`);
    return wav.left;
  });
}

function placeClip(buffer: StereoBuffer, clip: Float32Array, startSample: number): void {
  for (let i = 0; i < clip.length; i++) {
    const index = startSample + i;
    if (index >= buffer.left.length) break;
    const fade = Math.min(1, i / CLIP_FADE_SAMPLES, (clip.length - 1 - i) / CLIP_FADE_SAMPLES);
    buffer.left[index] += clip[i] * fade;
    buffer.right[index] += clip[i] * fade;
  }
}

const CHORDS = [
  { pad: [110.0, 164.81, 220.0, 261.63, 329.63], bass: 55.0 }, // A minor
  { pad: [87.31, 130.81, 174.61, 261.63, 349.23], bass: 87.31 }, // F major
  { pad: [130.81, 196.0, 261.63, 329.63, 392.0], bass: 65.41 }, // C major
  { pad: [98.0, 146.83, 196.0, 246.94, 392.0], bass: 98.0 }, // G major
] as const;
const ARP = [440.0, 523.25, 659.25, 783.99, 880.0, 783.99, 659.25, 523.25] as const; // A minor pentatonic
const END_CHORD = [130.81, 196.0, 261.63, 329.63, 392.0, 493.88] as const; // C major 9

function composeBed(bed: StereoBuffer, timing: ShowcaseTiming): void {
  const totalSec = timing.totalFrames / SHOWCASE_FPS;
  const barSec = BEAT * 4;
  for (let bar = 0; bar * barSec < totalSec; bar++) {
    const start = bar * barSec;
    const chord = CHORDS[bar % CHORDS.length];
    addPadChord(bed, { startSec: start, durationSec: Math.min(barSec + 0.25, totalSec - start), frequencies: chord.pad, gain: 0.5, stereoSpread: 0.7 });
    for (let beat = 0; beat < 4; beat++) {
      const at = start + beat * BEAT;
      if (at >= totalSec) break;
      addKick(bed, { startSec: at, gain: 0.55 });
      addHiHat(bed, { startSec: at + BEAT / 2, gain: 0.12, pan: beat % 2 ? 0.35 : -0.35, seed: bar * 8 + beat + 1 });
      if (beat % 2 === 0) addBassNote(bed, { startSec: at, durationSec: BEAT * 1.8, frequency: chord.bass, gain: 0.6 });
      for (let eighth = 0; eighth < 2; eighth++) {
        const step = bar * 8 + beat * 2 + eighth;
        addPluck(bed, {
          startSec: at + (eighth * BEAT) / 2,
          durationSec: 0.35,
          frequency: ARP[step % ARP.length],
          gain: 0.16,
          pan: Math.sin(step * 0.9) * 0.6,
        });
      }
    }
  }

  const remixBeat = timing.beats.find((beat) => beat.id === "l4");
  const cuts = [...timing.segments.map((segment) => segment.fromFrame), remixBeat?.fromFrame ?? 0, timing.endCard.fromFrame].filter((frame) => frame > 0);
  for (const [index, frame] of cuts.entries()) {
    addSnare(bed, { startSec: frame / SHOWCASE_FPS, gain: 0.2, pan: index % 2 ? 0.3 : -0.3, seed: 100 + index });
  }

  const endSec = timing.endCard.fromFrame / SHOWCASE_FPS;
  addPadChord(bed, { startSec: endSec, durationSec: totalSec - endSec, frequencies: END_CHORD, gain: 0.6, stereoSpread: 0.9 });
  const lastLine = timing.lines[timing.lines.length - 1];
  addPluck(bed, { startSec: lastLine.endFrame / SHOWCASE_FPS - 0.35, durationSec: 1.0, frequency: 1046.5, gain: 0.3, pan: 0 });
}

export interface ShowcaseAudioBundle {
  readonly wav: Uint8Array;
  /** Integrated loudness of the voice track alone, before mastering. */
  readonly voiceLufs: number;
  /** Integrated loudness of the scaled bed alone, before mastering. */
  readonly bedLufs: number;
  readonly integratedLufs: number;
  readonly truePeakDb: number;
}

export function buildShowcaseAudio(voiceClips: readonly Float32Array[], timing: ShowcaseTiming = SHOWCASE_TIMING): ShowcaseAudioBundle {
  if (voiceClips.length !== timing.lines.length) throw new Error("one voice clip per script line is required");
  const voice = createStereoBuffer(timing.totalFrames, SHOWCASE_FPS);
  for (const [index, line] of timing.lines.entries()) {
    placeClip(voice, voiceClips[index], Math.round((line.startFrame / SHOWCASE_FPS) * STEREO_SAMPLE_RATE));
  }
  const voiceLufs = measureStereoLufsAndPeak(voice.left, voice.right).integratedLufs;

  const bed = createStereoBuffer(timing.totalFrames, SHOWCASE_FPS);
  composeBed(bed, timing);
  const rawBedLufs = measureStereoLufsAndPeak(bed.left, bed.right).integratedLufs;
  const scale = 10 ** ((voiceLufs - BED_UNDER_VOICE_LU - rawBedLufs) / 20);
  for (let i = 0; i < bed.left.length; i++) {
    bed.left[i] *= scale;
    bed.right[i] *= scale;
  }
  const bedLufs = measureStereoLufsAndPeak(bed.left, bed.right).integratedLufs;

  const mix = createStereoBuffer(timing.totalFrames, SHOWCASE_FPS);
  for (let i = 0; i < mix.left.length; i++) {
    mix.left[i] = voice.left[i] + bed.left[i];
    mix.right[i] = voice.right[i] + bed.right[i];
  }
  const master = calibrateStereoMaster(mix, { targetLufs: -14.0, ceilingDbTp: -1.8 });
  return {
    wav: encodeStereoPcm16Wav(mix.left, mix.right),
    voiceLufs,
    bedLufs,
    integratedLufs: master.integratedLufs,
    truePeakDb: master.truePeakDb,
  };
}

/** The wav that pnpm assets writes to public/generated/animations-repo-showcase.wav. */
export function synthesizeShowcaseWav(): Uint8Array {
  return buildShowcaseAudio(loadShowcaseVoice()).wav;
}
