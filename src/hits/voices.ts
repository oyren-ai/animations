import {
  calibrateStereoMaster,
  createStereoBuffer,
  encodeStereoPcm16Wav,
  panGains,
  STEREO_SAMPLE_RATE,
  type StereoBuffer,
} from "../audio-reactive/synth.ts";
import { FPS, createRng } from "./kit.ts";
import type { HitAudio } from "./types.ts";

/**
 * Warm, band-limited voices for hit videos.
 * Every voice is a sum of sines or low-passed noise, so the energy stays under about 2 kHz
 * (the owner found bright, dense sound annoying on phones). Voices are deterministic and
 * use no Node `Buffer`, so they run in the browser bundle and in Node tests.
 */

export const PENTATONIC_MAJOR = [0, 2, 4, 7, 9] as const;
export const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;

export function noteHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** MIDI note for step `index` of a scale that repeats every octave. */
export function scaleMidi(rootMidi: number, scale: readonly number[], index: number): number {
  const octave = Math.floor(index / scale.length);
  const degree = ((index % scale.length) + scale.length) % scale.length;
  return rootMidi + 12 * octave + scale[degree];
}

export function newHitBuffer(totalFrames: number): StereoBuffer {
  return createStereoBuffer(totalFrames, FPS);
}

function mix(
  buf: StereoBuffer,
  startSec: number,
  durSec: number,
  pan: number,
  voice: (tt: number) => number,
): void {
  const start = Math.round(startSec * buf.sampleRate);
  if (start >= buf.left.length) return;
  const first = Math.max(0, start);
  const end = Math.min(buf.left.length, start + Math.round(durSec * buf.sampleRate));
  const { left: gl, right: gr } = panGains(pan);
  for (let i = first; i < end; i++) {
    const tt = (i - start) / buf.sampleRate;
    const s = voice(tt);
    buf.left[i] += s * gl;
    buf.right[i] += s * gr;
  }
}

const TWO_PI = Math.PI * 2;

export function addBell(
  buf: StereoBuffer,
  o: { t: number; freq: number; gain?: number; pan?: number; decay?: number; durSec?: number },
): void {
  const { t, gain = 0.2, pan = 0, decay = 7, durSec = 0.55 } = o;
  const f = Math.min(o.freq, 1800);
  const third = 3 * f < 2600 ? 0.07 : 0;
  mix(buf, t, durSec, pan, (tt) => {
    const attack = Math.min(1, tt / 0.006);
    const tail = Math.min(1, (durSec - tt) / 0.012);
    const env = attack * tail * Math.exp(-tt * decay);
    const w = TWO_PI * f * tt;
    return (
      gain *
      env *
      (Math.sin(w) + 0.26 * Math.sin(2.01 * w) * Math.exp(-tt * decay * 0.8) + third * Math.sin(3.02 * w))
    );
  });
}

export function addThud(
  buf: StereoBuffer,
  o: { t: number; gain?: number; pan?: number; hz?: number; durSec?: number },
): void {
  const { t, gain = 0.4, pan = 0, hz = 90, durSec = 0.2 } = o;
  let phase = 0;
  mix(buf, t, durSec, pan, (tt) => {
    const f = hz * (0.65 + 0.9 * Math.exp(-tt * 28));
    phase += (TWO_PI * f) / STEREO_SAMPLE_RATE;
    const attack = Math.min(1, tt / 0.003);
    const tail = Math.min(1, (durSec - tt) / 0.02);
    return gain * attack * tail * Math.exp(-tt * 18) * Math.sin(phase);
  });
}

export function addTick(
  buf: StereoBuffer,
  o: { t: number; gain?: number; pan?: number; hz?: number; durSec?: number },
): void {
  const { t, gain = 0.14, pan = 0, hz = 1150, durSec = 0.035 } = o;
  mix(buf, t, durSec, pan, (tt) => {
    const attack = Math.min(1, tt / 0.001);
    const env = attack * Math.exp(-tt * 150);
    return gain * env * (Math.sin(TWO_PI * hz * tt) + 0.3 * Math.sin(TWO_PI * hz * 1.5 * tt));
  });
}

/** Low-passed noise sweep (cutoff capped at 1.6 kHz) for rises, whooshes and bursts. */
export function addWhoosh(
  buf: StereoBuffer,
  o: { t: number; durSec: number; gain?: number; pan?: number; fromHz?: number; toHz?: number; seed?: number },
): void {
  const { t, durSec, gain = 0.2, pan = 0, fromHz = 300, toHz = 1200, seed = 7 } = o;
  const rng = createRng(seed);
  let y = 0;
  mix(buf, t, durSec, pan, (tt) => {
    const x = tt / durSec;
    const fc = Math.min(1600, fromHz + (toHz - fromHz) * x);
    const a = 1 - Math.exp((-TWO_PI * fc) / STEREO_SAMPLE_RATE);
    y += a * (rng.next() * 2 - 1 - y);
    const env = Math.sin(Math.PI * Math.min(1, x)) ** 2;
    return gain * env * y * 3.2;
  });
}

export function addBoom(buf: StereoBuffer, o: { t: number; gain?: number; seed?: number }): void {
  const { t, gain = 0.5, seed = 11 } = o;
  let phase = 0;
  mix(buf, t, 1.1, 0, (tt) => {
    const f = 46 + 70 * Math.exp(-tt * 9);
    phase += (TWO_PI * f) / STEREO_SAMPLE_RATE;
    const attack = Math.min(1, tt / 0.004);
    const tail = Math.min(1, (1.1 - tt) / 0.05);
    return gain * attack * tail * Math.exp(-tt * 3.4) * Math.sin(phase);
  });
  addWhoosh(buf, { t, durSec: 0.7, gain: gain * 0.55, fromHz: 900, toHz: 220, seed });
}

/** Soft sustained chord. Slow attack and release so chords can overlap into a steady bed. */
export function addSoftPad(
  buf: StereoBuffer,
  o: {
    startSec: number;
    durSec: number;
    freqs: readonly number[];
    gain?: number;
    attackSec?: number;
    releaseSec?: number;
    detuneCents?: number;
  },
): void {
  const { startSec, durSec, freqs, gain = 0.05, attackSec = 0.5, releaseSec = 0.6, detuneCents = 3 } = o;
  const start = Math.round(startSec * buf.sampleRate);
  const count = Math.round(durSec * buf.sampleRate);
  const detune = 2 ** (detuneCents / 1200);
  for (let i = 0; i < count; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= buf.left.length) continue;
    const tt = i / buf.sampleRate;
    const a = Math.min(1, tt / attackSec);
    const r = Math.min(1, (durSec - tt) / releaseSec);
    const env = gain * a * a * (3 - 2 * a) * r * r * (3 - 2 * r);
    let l = 0;
    let rgt = 0;
    for (const f of freqs) {
      l += Math.sin(TWO_PI * f * detune * tt) + 0.2 * Math.sin(TWO_PI * f * 2 * detune * tt);
      rgt += Math.sin((TWO_PI * f * tt) / detune) + 0.2 * Math.sin((TWO_PI * f * 2 * tt) / detune);
    }
    buf.left[idx] += (env * l) / freqs.length;
    buf.right[idx] += (env * rgt) / freqs.length;
  }
}

/** Sine glide plus a little low-passed noise: a build-up that swells toward `t + durSec`. */
export function addRiser(
  buf: StereoBuffer,
  o: { t: number; durSec: number; gain?: number; fromHz?: number; toHz?: number },
): void {
  const { t, durSec, gain = 0.12, fromHz = 180, toHz = 900 } = o;
  let phase = 0;
  mix(buf, t, durSec, 0, (tt) => {
    const x = tt / durSec;
    const f = fromHz * (toHz / fromHz) ** x;
    phase += (TWO_PI * f) / STEREO_SAMPLE_RATE;
    return gain * x * x * Math.min(1, (durSec - tt) / 0.02) * Math.sin(phase);
  });
  addWhoosh(buf, { t, durSec, gain: gain * 0.5, fromHz: 250, toHz: 1400, seed: 23 });
}

/* ---------- event helpers and mastering ---------- */

/** Keep at most `maxPerSecond` events: greedy, in time order, so a dense burst never becomes a wall of noise. */
export function thinEvents<T extends { t: number }>(events: readonly T[], maxPerSecond: number): T[] {
  const gap = 1 / maxPerSecond;
  const out: T[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    if (e.t - last >= gap) {
      out.push(e);
      last = e.t;
    }
  }
  return out;
}

/** Ratio of first-difference energy to signal energy of the mono mix. A 1 kHz sine at 48 kHz gives about 0.017. */
export function brightnessRatio(buf: StereoBuffer): number {
  let diff = 0;
  let sig = 0;
  let prev = 0;
  for (let i = 0; i < buf.left.length; i++) {
    const m = (buf.left[i] + buf.right[i]) * 0.5;
    diff += (m - prev) * (m - prev);
    sig += m * m;
    prev = m;
  }
  return sig > 0 ? diff / sig : 0;
}

/** Master to about -14 LUFS with a true-peak ceiling under -1.5 dBTP, then encode the WAV. */
export function finishHitAudio(buf: StereoBuffer): HitAudio {
  calibrateStereoMaster(buf, { targetLufs: -14, ceilingDbTp: -1.8 });
  return { buffer: buf, wav: encodeStereoPcm16Wav(buf.left, buf.right) };
}
