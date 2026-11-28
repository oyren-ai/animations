import type { MidiNote, ParsedMidi } from "./types.ts";

/**
 * Offline, deterministic, pure-TypeScript synthesiser: MIDI notes in, stereo Float32 audio (and a PCM16 WAV) out.
 *
 * - No DOM, no node:fs, no Math.random / Date.now: every bit of noise comes from a mulberry32 PRNG seeded from the
 *   note's index, so two renders of the same input are byte-identical.
 * - Note onsets are sample accurate: a note at timeSec t starts at sample round(t * sampleRate) and ramps in over
 *   2 ms (raised cosine), so the audible onset is within ~1 ms of the MIDI time.
 * - Voices: piano (tuned Karplus-Strong string pair + inharmonic partials + hammer thump), bell (Chowning FM + 2.76f
 *   partial), marimba (1:4:10 bar partials + mallet tick), kalimba (tine + shimmer partial + thump). MIDI channel 9
 *   (General MIDI percussion) gets a soft one-shot click/thump/hat so drum parts are not silent.
 * - Mix: pitch-dependent equal-power pan, Schroeder reverb (4 damped combs + 2 allpass per channel, decorrelated
 *   L/R), 22 Hz DC high-pass, percentile gain normalisation (capped) and a soft limiter that never exceeds `ceiling`.
 */

export const SYNTH_SAMPLE_RATE = 48000;
export type Instrument =
  | "piano"
  | "bell"
  | "marimba"
  | "kalimba"
  | "strings"
  | "musicbox"
  | "tar"
  | "bass"
  | "organ"
  | "harpsichord"
  | "harp";

export interface SynthOptions {
  /** Output sample rate in Hz (default 48000). */
  sampleRate?: number;
  /** Ring-out added after the last note-off (default 3 s). */
  tailSec?: number;
  /** Force the exact output length in seconds; default is last note end + tailSec. */
  totalSec?: number;
  /** Instrument per track index; wins over `programs`. */
  instruments?: Record<number, Instrument>;
  /** General MIDI program per track index (used when there is no `instruments` entry). */
  programs?: Record<number, number>;
  /** General MIDI program per "track:channel" key; wins over `programs` (format 0 files carry several instruments in one track). */
  channelPrograms?: Record<string, number>;
  /** Reverb send level 0..1 (default 0.22): wet = reverb * decorrelated tail, added on top of the dry signal. */
  reverb?: number;
  /** Soft-limiter ceiling; the output peak is guaranteed <= ceiling (default 0.84). */
  ceiling?: number;
  /** Peak that loud passages are normalised towards before the limiter (default 0.8). */
  targetPeak?: number;
  /** Cap on the normalisation gain (default 4, i.e. +12 dB); use 1 to only ever turn the level down. */
  maxGain?: number;
  /**
   * Gentle bus compression strength 0..1 before normalisation (default 0.5): loud chords are pulled down so the
   * quiet passages come up, for a steadier level on a phone. 0 turns it off.
   */
  compression?: number;
  /**
   * Loudness drive in dB (default 3): loud passages are pushed this far past `targetPeak` and the short
   * transient peaks are then caught by a 3 ms look-ahead limiter, which raises the body level of peaky
   * piano material. 0 disables the push.
   */
  driveDb?: number;
}

export interface StereoAudio {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

/** General MIDI program number to one of the eleven voices (everything not listed is a piano). */
export function instrumentForProgram(program: number): Instrument {
  const p = Math.trunc(program);
  if (p === 6) return "harpsichord";
  if (p === 10) return "musicbox";
  if ((p >= 8 && p <= 9) || p === 14 || p === 98 || (p >= 112 && p <= 119)) return "bell";
  if (p >= 11 && p <= 13) return "marimba";
  if (p >= 19 && p <= 20) return "organ";
  if (p === 25 || p === 26) return "tar";
  if (p === 32 || p === 33) return "bass";
  if ((p >= 40 && p <= 44) || (p >= 48 && p <= 51)) return "strings";
  if (p === 46) return "harp";
  if (p >= 105 && p <= 108) return "kalimba";
  return "piano";
}

const TWO_PI = Math.PI * 2;
const LN1000 = Math.log(1000);
const ATTACK_SEC = 0.002;
const MIN_RELEASE_SEC = 0.008;
const PAN_LOW_PITCH = 21;
const PAN_HIGH_PITCH = 108;
const PAN_SPREAD = 0.3;
const DC_CUTOFF_HZ = 22;
const END_FADE_SEC = 0.015;
const DEFAULT_REVERB = 0.22;
const DEFAULT_CEILING = 0.84; // leaves about 1 dB of headroom for AAC overshoot, which measured up to +1 dB on marimba transients
const DEFAULT_TARGET_PEAK = 0.8;
const DEFAULT_MAX_GAIN = 4;
/** Per-voice trims so a note at the same velocity is about equally loud on every instrument (measured, see tests). */
const VOICE_GAIN: Record<Instrument, number> = {
  piano: 0.2,
  bell: 0.2,
  marimba: 0.3,
  kalimba: 0.19,
  strings: 0.18,
  musicbox: 0.21,
  tar: 0.21,
  bass: 0.23,
  organ: 0.19,
  harpsichord: 0.21,
  harp: 0.22,
};
const DRUM_GAIN = 0.3;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Small, fast, well-distributed seeded PRNG returning floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noteHz(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/** Per-sample multiplier giving a -60 dB decay after t60 seconds. */
function t60ToDecay(t60: number, sr: number): number {
  return Math.exp(-LN1000 / (Math.max(t60, 1e-4) * sr));
}

/** Reusable scratch memory so rendering does not allocate per note. */
class Workspace {
  private buf = new Float64Array(0);
  private strBuf = new Float64Array(0);
  /** A zero-filled scratch buffer of at least n samples. */
  voice(n: number): Float64Array {
    if (this.buf.length < n) this.buf = new Float64Array(Math.max(n, this.buf.length * 2));
    this.buf.fill(0, 0, n);
    return this.buf;
  }
  /** Delay-line memory for the Karplus-Strong loop (contents are overwritten by the caller). */
  delay(n: number): Float64Array {
    if (this.strBuf.length < n) this.strBuf = new Float64Array(Math.max(n, this.strBuf.length * 2));
    return this.strBuf;
  }
}

interface NoteParams {
  pitch: number;
  freq: number;
  /** velocity / 127 */
  vn: number;
  /** Seconds the key is held (note duration, not yet floored to the voice minimum). */
  holdSec: number;
  sr: number;
  rng: () => number;
}

/** A rendered voice: samples [0, len) of the workspace buffer, plus where the release starts and how long it is. */
interface VoiceOut {
  buf: Float64Array;
  len: number;
  hold: number;
  release: number;
}

/** out[0..len) += amp * r^n * sin(w n + phase), computed with a damped rotation (no per-sample transcendentals). */
function addDecayingSine(out: Float64Array, len: number, freqHz: number, amp: number, t60: number, phase: number, sr: number): void {
  if (!(freqHz > 0) || freqHz >= 0.45 * sr || amp === 0) return;
  const w = (TWO_PI * freqHz) / sr;
  const r = t60ToDecay(t60, sr);
  const c = r * Math.cos(w);
  const s = r * Math.sin(w);
  let u = amp * Math.cos(phase);
  let v = amp * Math.sin(phase);
  for (let i = 0; i < len; i++) {
    out[i] += v;
    const nu = c * u - s * v;
    v = s * u + c * v;
    u = nu;
  }
}

/** Adds noise through two cascaded one-pole lowpasses with an exponential envelope; level is the RMS at the start. */
function addNoiseBurst(out: Float64Array, len: number, sr: number, rng: () => number, cutoffHz: number, tauSec: number, level: number): void {
  if (level === 0) return;
  const a = Math.exp((-TWO_PI * clamp(cutoffHz, 20, 0.45 * sr)) / sr);
  // RMS of uniform [-1,1] noise is 0.5774; two identical one-poles scale the variance by (1-a)(1+a^2)/(1+a)^3.
  const norm = 1 / (0.57735 * Math.sqrt(((1 - a) * (1 + a * a)) / Math.pow(1 + a, 3)));
  const decay = Math.exp(-1 / (tauSec * sr));
  const n = Math.min(len, Math.ceil(tauSec * sr * 9));
  let y1 = 0;
  let y2 = 0;
  let env = level * norm;
  for (let i = 0; i < n; i++) {
    y1 = a * y1 + (1 - a) * (rng() * 2 - 1);
    y2 = a * y2 + (1 - a) * y1;
    out[i] += env * y2;
    env *= decay;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Karplus-Strong string with exact fractional-delay tuning
// ---------------------------------------------------------------------------------------------------------------

/** Magnitude of the two-tap loop filter (1-S) + S z^-1 at angular frequency w. */
function twoTapMagnitude(s: number, w: number): number {
  return Math.sqrt((1 - s) * (1 - s) + s * s + 2 * s * (1 - s) * Math.cos(w));
}

/** Exact phase delay in samples of (1-S) + S z^-1 at angular frequency w. */
function twoTapDelay(s: number, w: number): number {
  return Math.atan2(s * Math.sin(w), 1 - s + s * Math.cos(w)) / w;
}

/** Exact phase delay in samples of the first-order allpass (eta + z^-1) / (1 + eta z^-1) at angular frequency w. */
function allpassDelay(eta: number, w: number): number {
  const phase = Math.atan2(-Math.sin(w), eta + Math.cos(w)) - Math.atan2(-eta * Math.sin(w), 1 + eta * Math.cos(w));
  return -phase / w;
}

/** Allpass coefficient whose phase delay at w equals `delay` samples (the delay is monotonic in eta: bisection). */
function solveAllpass(delay: number, w: number): number {
  let lo = -0.95;
  let hi = 0.95;
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi);
    if (allpassDelay(mid, w) > delay) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Adds one tuned Karplus-Strong string to out[0..len). The loop is an integer delay line + two-tap damping filter +
 * first-order allpass; the allpass is solved so that the *total* phase delay at the fundamental is exactly
 * sampleRate / freq (the damping filter's own delay is compensated), so the pitch is accurate to a fraction of a cent.
 * The string is excited with one period of velocity-lowpassed noise; `t60` is the fundamental's -60 dB decay time.
 */
function addKarplusStrong(ws: Workspace, out: Float64Array, len: number, sr: number, freq: number, t60: number, cutoffHz: number, level: number, rng: () => number): void {
  if (!(freq > 0) || freq > 0.1 * sr || level === 0) return;
  const w0 = (TWO_PI * freq) / sr;
  const roundTrip = sr / freq;
  const targetGain = Math.pow(10, -3 / (Math.max(t60, 0.05) * freq));
  let s = 0.5;
  let hMag = twoTapMagnitude(s, w0);
  while (targetGain / hMag > 0.9992 && s > 0.005) {
    s *= 0.6;
    hMag = twoTapMagnitude(s, w0);
  }
  const rho = Math.min(0.9995, targetGain / hMag);
  const remaining = roundTrip - twoTapDelay(s, w0);
  const n = Math.max(2, Math.floor(remaining - 0.5));
  const eta = solveAllpass(remaining - n, w0);
  const line = ws.delay(n);

  // Excitation: one period of lowpassed noise, mean removed, normalised to unit RMS.
  const a = Math.exp((-TWO_PI * clamp(cutoffHz, 20, 0.45 * sr)) / sr);
  let y1 = 0;
  let y2 = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    y1 = a * y1 + (1 - a) * (rng() * 2 - 1);
    y2 = a * y2 + (1 - a) * y1;
    line[i] = y2;
    mean += y2;
  }
  mean /= n;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    line[i] -= mean;
    energy += line[i] * line[i];
  }
  const scale = energy > 0 ? level / Math.sqrt(energy / n) : 0;
  for (let i = 0; i < n; i++) line[i] *= scale;

  const tap0 = 1 - s;
  const tap1 = s;
  let idx = 0;
  let prev = 0;
  let apIn = 0;
  let apOut = 0;
  for (let i = 0; i < len; i++) {
    const y = line[idx];
    out[i] += y;
    const filtered = rho * (tap0 * y + tap1 * prev);
    prev = y;
    const ap = eta * filtered + apIn - eta * apOut;
    apIn = filtered;
    apOut = ap;
    line[idx] = ap;
    if (++idx === n) idx = 0;
  }
}

/** A single decaying Karplus-Strong string on its own (mono), exported so the tuning can be verified in isolation. */
export function renderKarplusStrong(freq: number, seconds: number, options: { sampleRate?: number; t60?: number; cutoffHz?: number; seed?: number } = {}): Float32Array {
  const sr = options.sampleRate ?? SYNTH_SAMPLE_RATE;
  const len = Math.max(1, Math.round(seconds * sr));
  const ws = new Workspace();
  const buf = ws.voice(len);
  addKarplusStrong(ws, buf, len, sr, freq, options.t60 ?? 3, options.cutoffHz ?? freq * 4, 1, mulberry32(options.seed ?? 1));
  return Float32Array.from(buf.subarray(0, len));
}

// ---------------------------------------------------------------------------------------------------------------
// Voices. Each writes its raw (unit-ish level) signal to the workspace buffer; envelope, gain and pan are applied after.
// ---------------------------------------------------------------------------------------------------------------

function renderPiano(ws: Workspace, p: NoteParams): VoiceOut {
  const { freq: f, sr, vn, pitch, rng } = p;
  // Fundamental decay: bass rings for many seconds, the top octaves die in about a second.
  const t60 = Math.min(8, 7 * Math.pow(2, -(pitch - 40) / 20));
  const hold = Math.max(p.holdSec, 0.05);
  const release = 0.25 - 0.13 * clamp((pitch - 36) / 60, 0, 1); // damper: ~0.25 s in the bass, ~0.12 s at the top
  const len = Math.max(2, Math.round(Math.min(t60 * 1.25, hold + release) * sr));
  const buf = ws.voice(len);

  // Slightly inharmonic partials; the fundamental is kept exactly at f. Soft playing darkens the upper partials.
  const inharmonicity = 3e-4 * Math.pow(2, (pitch - 60) / 13);
  const bright = 0.35 + 0.65 * vn;
  const weights = [1, 0.5, 0.3, 0.18, 0.1, 0.06];
  for (let k = 1; k <= 6; k++) {
    const fk = k * f * Math.sqrt((1 + inharmonicity * k * k) / (1 + inharmonicity));
    if (fk > 0.42 * sr) break;
    addDecayingSine(buf, len, fk, 0.55 * weights[k - 1] * Math.pow(bright, (k - 1) * 0.9), (t60 * 0.5) / (1 + 0.8 * (k - 1)), 0, sr);
  }

  // Karplus-Strong strings: two slightly detuned strings from A2 up give a gentle chorus.
  const strings = pitch >= 45 ? 2 : 1;
  const cutoff = Math.min(5000, f * (2 + 6 * vn * vn));
  const ksLevel = (0.3 + 0.3 * vn) / Math.sqrt(strings);
  for (let i = 0; i < strings; i++) {
    const cents = strings === 1 ? 0 : i === 0 ? -0.9 : 0.9;
    addKarplusStrong(ws, buf, len, sr, f * Math.pow(2, cents / 1200), t60, cutoff, ksLevel, rng);
  }

  // Hammer thump and felt tick.
  addNoiseBurst(buf, len, sr, rng, 320, 0.012, 0.5 * Math.pow(vn, 1.5));
  addNoiseBurst(buf, len, sr, rng, 3000, 0.0025, 0.12 * vn * vn);
  return { buf, len, hold: Math.round(hold * sr), release: Math.round(release * sr) };
}

function renderBell(ws: Workspace, p: NoteParams): VoiceOut {
  const { freq: f, sr, vn } = p;
  const t60 = clamp(4 * Math.sqrt(261.63 / f), 1.5, 4);
  const len = Math.max(2, Math.round(Math.min(5, t60 * 1.25) * sr));
  const buf = ws.voice(len);

  // Chowning FM bell: carrier f, inharmonic modulator at 3.5 f, modulation index decaying from ~4.7 (loud) to ~0.
  const ratio = 3.5;
  const maxIndex = Math.max(0.3, (12000 - f) / (ratio * f) - 1); // keep sidebands from aliasing at high pitches
  const index0 = Math.min(1.5 + 3.2 * vn, maxIndex);
  const indexFloor = Math.min(0.06, index0);
  const indexDecay = Math.exp(-1 / ((0.22 * Math.sqrt(t60 / 4)) * sr));
  const amplitudeDecay = t60ToDecay(t60, sr);
  const wc = (TWO_PI * f) / sr;
  const wm = wc * ratio;
  let envelope = 1;
  let swing = index0 - indexFloor;
  for (let i = 0; i < len; i++) {
    buf[i] = envelope * Math.sin(wc * i + (indexFloor + swing) * Math.sin(wm * i));
    envelope *= amplitudeDecay;
    swing *= indexDecay;
  }
  // Bright, quicker-fading upper partial near the classic bell ratio 2.76.
  addDecayingSine(buf, len, 2.76 * f, 0.3 * (0.4 + 0.6 * vn), t60 * 0.4, 0, sr);
  return { buf, len, hold: len, release: 0 };
}

function renderMarimba(ws: Workspace, p: NoteParams): VoiceOut {
  const { freq: f, sr, vn, rng } = p;
  const t60 = clamp(0.9 * Math.pow(261.63 / f, 0.45), 0.35, 2);
  const hold = Math.max(p.holdSec, 0.03);
  const release = 0.2;
  const len = Math.max(2, Math.round(Math.min(t60 * 1.25, hold + release) * sr));
  const buf = ws.voice(len);
  // Tuned bar: partials at 1 : 4 : 10; a soft mallet leaves the upper two weak.
  addDecayingSine(buf, len, f, 1, t60, 0, sr);
  addDecayingSine(buf, len, 4 * f, 0.12 + 0.55 * vn * vn, t60 * 0.17, 0, sr);
  addDecayingSine(buf, len, 10 * f, 0.02 + 0.25 * vn * vn * vn, t60 * 0.055, 0, sr);
  addNoiseBurst(buf, len, sr, rng, 3500, 0.0025, 0.18 * Math.pow(vn, 1.3));
  return { buf, len, hold: Math.round(hold * sr), release: Math.round(release * sr) };
}

function renderKalimba(ws: Workspace, p: NoteParams): VoiceOut {
  const { freq: f, sr, vn, rng } = p;
  const t60 = clamp(2.5 * Math.pow(261.63 / f, 0.2), 1.2, 2.6);
  const hold = Math.max(p.holdSec, 0.05);
  const release = 0.3;
  const len = Math.max(2, Math.round(Math.min(t60 * 1.25, hold + release) * sr));
  const buf = ws.voice(len);
  addDecayingSine(buf, len, f, 1, t60, 0, sr);
  addDecayingSine(buf, len, f * 1.0028, 0.4, t60 * 0.9, 0, sr); // slightly detuned twin: slow shimmer
  addDecayingSine(buf, len, 5.4 * f, 0.1 + 0.3 * Math.pow(vn, 1.5), t60 * 0.12, 0, sr); // inharmonic tine mode
  addNoiseBurst(buf, len, sr, rng, 260, 0.014, 0.3 * Math.pow(vn, 1.3)); // soft body thump
  return { buf, len, hold: Math.round(hold * sr), release: Math.round(release * sr) };
}

/** Tuned cantilevered steel comb tooth: pure fundamental + fast-decaying inharmonic flexural partials + pin pluck. */
function renderMusicBox(ws: Workspace, p: NoteParams): VoiceOut {
  const { freq: f, sr, vn, rng } = p;
  const t60 = clamp(2.05 * Math.pow(523.25 / f, 0.32), 0.85, 2.35);
  const len = Math.max(2, Math.round(Math.min(3.0, t60 * 1.25) * sr));
  const buf = ws.voice(len);
  addDecayingSine(buf, len, f, 1, t60, 0, sr);
  addDecayingSine(buf, len, f * 1.0018, 0.26, t60 * 0.85, 0.4, sr);
  addDecayingSine(buf, len, 2 * f, 0.18 * (0.4 + 0.6 * vn), t60 * 0.45, 0, sr);
  addDecayingSine(buf, len, 2.92 * f, 0.32 * (0.2 + 0.8 * vn * vn), t60 * 0.16, 0, sr);
  addDecayingSine(buf, len, 5.65 * f, 0.16 * vn * vn, t60 * 0.06, 0, sr);
  addNoiseBurst(buf, len, sr, rng, 4800, 0.0016, 0.16 * Math.pow(vn, 1.3));
  addNoiseBurst(buf, len, sr, rng, 420, 0.008, 0.14 * vn);
  return { buf, len, hold: len, release: 0 };
}

/** Bowed strings built from three symmetrically detuned band-limited sawtooth oscillators with delayed vibrato. */
function renderStrings(ws: Workspace, p: NoteParams): VoiceOut {
  const { freq: f, sr, vn, rng } = p;
  const hold = Math.max(p.holdSec, 0.08);
  const release = 0.22;
  const len = Math.max(2, Math.round((hold + release) * sr));
  const buf = ws.voice(len);

  const maxFreq = Math.min(7200, 0.42 * sr);
  const maxHarm = Math.min(18, Math.max(1, Math.floor(maxFreq / f)));
  const rolloff = 1.42 - 0.42 * vn; // louder bow pressure excites brighter upper sawtooth harmonics
  const harmAmp = new Float64Array(maxHarm + 1);
  let norm = 0;
  for (let k = 1; k <= maxHarm; k++) {
    const fk = k * f;
    // Wooden body formant peak near 650 Hz
    const body = 1 + 0.45 * Math.exp(-Math.pow(Math.log2(fk / 650), 2) / 1.2);
    const a = (body / Math.pow(k, rolloff)) * (k % 2 === 0 ? 0.88 : 1);
    harmAmp[k] = a;
    norm += a * a;
  }
  const scale = norm > 0 ? 0.78 / Math.sqrt(norm) : 0;
  for (let k = 1; k <= maxHarm; k++) harmAmp[k] *= scale;

  const detunes = [-4.2, 0, 4.2];
  const weights = [0.3, 0.56, 0.3];
  const phases = new Float64Array(detunes.length);
  for (let v = 0; v < detunes.length; v++) phases[v] = rng() * TWO_PI * (v === 1 ? 0 : 1);
  const vibRate = 5.3 + 0.35 * (rng() - 0.5);
  const vibPhase0 = rng() * TWO_PI;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Crisp bow articulation (0.42 immediate bite rising smoothly to 1.0 over ~42 ms)
    const bowEnv = 0.42 + 0.58 * (1 - Math.exp(-t / 0.018));
    const vibDepth = 0.0025 * clamp((t - 0.14) / 0.22, 0, 1);
    const vibMul = 1 + vibDepth * Math.sin(TWO_PI * vibRate * t + vibPhase0);
    let sample = 0;
    for (let v = 0; v < detunes.length; v++) {
      const fv = f * Math.pow(2, detunes[v] / 1200) * vibMul;
      const ph = phases[v];
      let voiceSum = 0;
      for (let k = 1; k <= maxHarm; k++) {
        voiceSum += harmAmp[k] * Math.sin(k * ph);
      }
      sample += weights[v] * voiceSum;
      phases[v] = ph + (TWO_PI * fv) / sr;
      if (phases[v] > TWO_PI * 64) phases[v] -= TWO_PI * 64;
    }
    buf[i] = bowEnv * sample;
  }
  addNoiseBurst(buf, len, sr, rng, 2400, 0.014, 0.12 * vn * vn);
  return { buf, len, hold: Math.round(hold * sr), release: Math.round(release * sr) };
}

/** Bright double-course plucked lute (Tar / Oud colour): paired Karplus-Strong strings + sympathetic octave shimmer + mizrab pick. */
function renderTar(ws: Workspace, p: NoteParams): VoiceOut {
  const { freq: f, sr, vn, rng } = p;
  const t60 = clamp(2.8 * Math.pow(293.66 / f, 0.35), 1.1, 3.6);
  const hold = Math.max(p.holdSec, 0.06);
  const release = 0.24;
  const len = Math.max(2, Math.round(Math.min(t60 * 1.25, hold + release) * sr));
  const buf = ws.voice(len);

  // Paired melody course (slight +/-1.4 cent shimmer) with bright velocity-sensitive cutoff
  const cutoff = Math.min(8200, f * (3.5 + 9 * vn * vn));
  addKarplusStrong(ws, buf, len, sr, f * Math.pow(2, -1.4 / 1200), t60, cutoff, 0.42 + 0.25 * vn, rng);
  addKarplusStrong(ws, buf, len, sr, f * Math.pow(2, 1.4 / 1200), t60 * 0.92, cutoff * 0.9, 0.36 + 0.22 * vn, rng);

  // Mulberry-wood / skin membrane body harmonics + delicate sympathetic octave string
  addDecayingSine(buf, len, f, 0.48, t60 * 0.75, 0, sr);
  addDecayingSine(buf, len, 2 * f, 0.28 * (0.35 + 0.65 * vn), t60 * 0.55, 0.3, sr);
  addDecayingSine(buf, len, 3 * f, 0.16 * vn, t60 * 0.3, 0, sr);
  addDecayingSine(buf, len, 4.02 * f, 0.09 * vn * vn, t60 * 0.22, 0.8, sr);

  // Crisp mizrab plectrum transient + skin tap
  addNoiseBurst(buf, len, sr, rng, 4400, 0.0018, 0.24 * Math.pow(vn, 1.35));
  addNoiseBurst(buf, len, sr, rng, 520, 0.009, 0.18 * vn);
  return { buf, len, hold: Math.round(hold * sr), release: Math.round(release * sr) };
}

/** Soft low plucked upright double bass: warm woody fundamental + damped gut Karplus-Strong string + finger thump. */
function renderBass(ws: Workspace, p: NoteParams): VoiceOut {
  const { freq: f, sr, vn, rng } = p;
  const t60 = clamp(2.4 * Math.pow(110 / Math.max(40, f), 0.25), 1.0, 2.8);
  const hold = Math.max(p.holdSec, 0.08);
  const release = 0.18;
  const len = Math.max(2, Math.round(Math.min(t60 * 1.2, hold + release) * sr));
  const buf = ws.voice(len);

  addDecayingSine(buf, len, f, 0.85, t60, 0, sr);
  addDecayingSine(buf, len, 2 * f, 0.42 * (0.45 + 0.55 * vn), t60 * 0.6, 0, sr);
  addDecayingSine(buf, len, 3 * f, 0.18 * vn, t60 * 0.35, 0, sr);
  const cutoff = Math.min(1400, f * (2.2 + 3.5 * vn * vn));
  addKarplusStrong(ws, buf, len, sr, f, t60 * 0.85, cutoff, 0.32 + 0.18 * vn, rng);
  addNoiseBurst(buf, len, sr, rng, 210, 0.014, 0.28 * Math.pow(vn, 1.3));
  return { buf, len, hold: Math.round(hold * sr), release: Math.round(release * sr) };
}

/** Cathedral flue pipe organ: Principal 8' + Octave 4' + Twelfth + Fifteenth + mixture pipes with pallet wind chiff. */
function renderOrgan(ws: Workspace, p: NoteParams): VoiceOut {
  const { freq: f, pitch, sr, vn, rng } = p;
  const hold = Math.max(p.holdSec, 0.085);
  const release = 0.13;
  const len = Math.max(2, Math.round((hold + release) * sr));
  const buf = ws.voice(len);

  // Velocity opens upper mixture stops so loud passages sound grander and brighter.
  const bright = 0.22 + 0.78 * vn * vn;
  const stops: Array<[number, number]> = [
    [1, 0.88], // Principal 8' (dominant fundamental)
    [2, 0.44 * (0.45 + 0.55 * vn)], // Octave 4'
    [3, 0.24 * bright], // Twelfth 2-2/3'
    [4, 0.22 * bright], // Fifteenth 2'
    [5, 0.1 * bright * vn], // Tierce
    [6, 0.11 * bright * vn], // Mixture
    [8, 0.07 * bright * vn], // Super-octave
  ];
  if (pitch <= 64 && f * 0.5 >= 32) {
    stops.push([0.5, 0.26 * (0.65 + 0.35 * vn)]); // Bourdon 16' sub-octave warmth
  }

  // Filter above Nyquist & gently tame piercing top partials.
  const active: Array<[number, number]> = [];
  let normSq = 0;
  for (const [mult, rawAmp] of stops) {
    const fh = f * mult;
    if (fh >= sr * 0.42) continue;
    const hfRolloff = 1 / (1 + Math.pow(fh / 5400, 2));
    const a = rawAmp * hfRolloff;
    active.push([mult, a]);
    normSq += a * a;
  }
  const norm = normSq > 0 ? 0.82 / Math.sqrt(normSq) : 0;

  // Dual-rank slight chorus detune for real windchest pipe shimmer.
  const detunes = [-1.7, 1.7];
  const weights = [0.56, 0.56];
  const phases = new Float64Array(detunes.length);
  phases[0] = 0;
  phases[1] = rng() * TWO_PI;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Crisp pallet valve air-column rise (~16 ms) with subtle wind stability.
    const windEnv = 0.5 + 0.5 * (1 - Math.exp(-t / 0.011));
    let sample = 0;
    for (let v = 0; v < detunes.length; v++) {
      const fv = f * Math.pow(2, detunes[v] / 1200);
      const ph = phases[v];
      let rank = 0;
      for (let s = 0; s < active.length; s++) {
        rank += active[s][1] * Math.sin(active[s][0] * ph);
      }
      sample += weights[v] * rank;
      phases[v] = ph + (TWO_PI * fv) / sr;
      if (phases[v] > TWO_PI * 64) phases[v] -= TWO_PI * 64;
    }
    buf[i] = windEnv * norm * sample;
  }

  // Authentic flue pipe onset wind-chiff burst when air hits the labium.
  addNoiseBurst(buf, len, sr, rng, Math.min(4800, Math.max(900, f * 4.5)), 0.014, 0.14 * Math.pow(vn, 1.4));
  return { buf, len, hold: Math.round(hold * sr), release: Math.round(release * sr) };
}

/** Plucked Baroque concert harpsichord: bright paired brass Karplus-Strong strings + upper quill harmonics + crisp felt damper. */
function renderHarpsichord(ws: Workspace, p: NoteParams): VoiceOut {
  const { freq: f, sr, vn, rng } = p;
  const t60 = clamp(2.6 * Math.pow(261.63 / Math.max(55, f), 0.38), 0.9, 3.4);
  const hold = Math.max(p.holdSec, 0.075);
  const release = 0.065; // crisp felt jack damper release
  const len = Math.max(2, Math.round(Math.min(t60 * 1.15, hold + release) * sr));
  const buf = ws.voice(len);

  // Bright quill-plucked brass string pair (8' choir + subtle 4' octave shimmer)
  const cutoff = Math.min(11000, f * (4.5 + 11 * vn * vn));
  addKarplusStrong(ws, buf, len, sr, f * Math.pow(2, -1.1 / 1200), t60, cutoff, 0.36 + 0.24 * vn, rng);
  addKarplusStrong(ws, buf, len, sr, f * Math.pow(2, 1.1 / 1200), t60 * 0.94, cutoff * 0.92, 0.3 + 0.22 * vn, rng);

  // Dominant fundamental + bright metallic harpsichord harmonic ladder (2f, 3f, 4f, 5f)
  addDecayingSine(buf, len, f, 0.62, t60 * 0.85, 0, sr);
  addDecayingSine(buf, len, 2 * f, 0.36 * (0.45 + 0.55 * vn), t60 * 0.62, 0.2, sr);
  addDecayingSine(buf, len, 3 * f, 0.22 * (0.35 + 0.65 * vn * vn), t60 * 0.42, 0.5, sr);
  if (4 * f < sr * 0.42) addDecayingSine(buf, len, 4 * f, 0.14 * vn * vn, t60 * 0.28, 0.9, sr);
  if (5 * f < sr * 0.42) addDecayingSine(buf, len, 5 * f, 0.08 * vn * vn, t60 * 0.2, 1.2, sr);

  // Crisp crow-quill plectrum snap transient
  addNoiseBurst(buf, len, sr, rng, 5600, 0.0022, 0.22 * Math.pow(vn, 1.35));
  return { buf, len, hold: Math.round(hold * sr), release: Math.round(release * sr) };
}

/** Concert pedal harp: warm round plucked nylon/gut string + spruce soundboard bloom + natural free ring-out. */
function renderHarp(ws: Workspace, p: NoteParams): VoiceOut {
  const { freq: f, sr, vn, rng } = p;
  const t60 = clamp(3.8 * Math.pow(261.63 / Math.max(55, f), 0.42), 1.25, 4.6);
  const hold = Math.max(p.holdSec, 0.14);
  const release = clamp(t60 * 0.45, 0.38, 1.35); // concert harp rings warmly unless explicitly damped
  const len = Math.max(2, Math.round(Math.min(t60 * 1.2, hold + release) * sr));
  const buf = ws.voice(len);

  // Warm plucked string (slightly gentler cutoff than harpsichord for round finger-pad tone)
  const cutoff = Math.min(7200, f * (2.6 + 7.5 * vn * vn));
  addKarplusStrong(ws, buf, len, sr, f, t60, cutoff, 0.38 + 0.24 * vn, rng);

  // Pure glowing harp fundamental + warm 2nd/3rd harmonics
  addDecayingSine(buf, len, f, 0.78, t60 * 0.92, 0, sr);
  addDecayingSine(buf, len, 2 * f, 0.32 * (0.35 + 0.65 * vn), t60 * 0.56, 0.15, sr);
  if (3 * f < sr * 0.42) addDecayingSine(buf, len, 3 * f, 0.14 * vn * vn, t60 * 0.34, 0.4, sr);
  if (4 * f < sr * 0.42) addDecayingSine(buf, len, 4 * f, 0.06 * vn * vn, t60 * 0.2, 0.8, sr);

  // Soft fingertip pluck warmth + spruce soundboard tap
  addNoiseBurst(buf, len, sr, rng, 1800, 0.004, 0.14 * Math.pow(vn, 1.4));
  return { buf, len, hold: Math.round(hold * sr), release: Math.round(release * sr) };
}

/** GM percussion on channel 9: one-shot sweep / noise voices, deliberately soft. */
function renderDrum(ws: Workspace, p: NoteParams): VoiceOut {
  const { pitch, sr, rng } = p;
  const kind = pitch === 35 || pitch === 36 ? "kick" : [41, 43, 45, 47, 48, 50].includes(pitch) ? "tom"
    : pitch === 39 ? "brushswirl" : pitch === 40 ? "brushtap"
    : pitch === 60 ? "nagharadum" : pitch === 61 ? "nagharatak"
    : [37, 38].includes(pitch) ? "snare" : pitch === 42 || pitch === 44 ? "hat" : pitch === 46 ? "openhat"
    : [49, 51, 52, 53, 55, 57, 59].includes(pitch) ? "cymbal" : "click";
  const seconds = kind === "kick" ? 0.35 : kind === "tom" ? 0.4 : kind === "brushswirl" ? 0.34 : kind === "brushtap" ? 0.18
    : kind === "nagharadum" ? 0.26 : kind === "nagharatak" ? 0.15
    : kind === "snare" ? 0.3 : kind === "hat" ? 0.12
    : kind === "openhat" ? 0.5 : kind === "cymbal" ? 1.4 : 0.2;
  const len = Math.round(seconds * sr);
  const buf = ws.voice(len);

  const sweep = (from: number, to: number, sweepTau: number, ampTau: number, amp: number): void => {
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const hz = to + (from - to) * Math.exp(-t / sweepTau);
      phase += (TWO_PI * hz) / sr;
      buf[i] += amp * Math.exp(-t / ampTau) * Math.sin(phase);
    }
  };
  /** Noise with a one-pole highpass (first difference blend) and lowpass, exponential decay. */
  const hiss = (highpass: boolean, lowHz: number, tau: number, amp: number): void => {
    const a = Math.exp((-TWO_PI * lowHz) / sr);
    let y = 0;
    let prev = 0;
    const decay = Math.exp(-1 / (tau * sr));
    let env = amp;
    for (let i = 0; i < len; i++) {
      const x = rng() * 2 - 1;
      y = a * y + (1 - a) * (highpass ? x - 0.95 * prev : x);
      prev = x;
      buf[i] += env * y * 2.2;
      env *= decay;
    }
  };

  if (kind === "kick") sweep(130, 46, 0.03, 0.13, 1);
  else if (kind === "tom") sweep(2 * (60 + (pitch - 41) * 9), 60 + (pitch - 41) * 9, 0.04, 0.11, 0.8);
  else if (kind === "brushswirl") {
    // Velvety jazz wire-brush sweep across coated snare skin (soft bandpass noise swell)
    const a = Math.exp((-TWO_PI * 4200) / sr);
    let y = 0, prev = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const x = rng() * 2 - 1;
      y = a * y + (1 - a) * (x - 0.92 * prev);
      prev = x;
      const swell = (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t / 0.11))) * Math.exp(-t / 0.14);
      buf[i] += 0.72 * swell * y * 2.1;
    }
  } else if (kind === "brushtap") {
    hiss(true, 5200, 0.048, 0.42);
  } else if (kind === "nagharadum") {
    sweep(148, 86, 0.028, 0.11, 0.85);
    hiss(false, 950, 0.018, 0.34);
  } else if (kind === "nagharatak") {
    sweep(295, 215, 0.014, 0.042, 0.52);
    hiss(true, 6200, 0.032, 0.38);
  }
  else if (kind === "snare") { hiss(true, 7000, 0.07, 0.6); sweep(210, 170, 0.02, 0.05, 0.4); }
  else if (kind === "hat") hiss(true, 9000, 0.02, 0.45);
  else if (kind === "openhat") hiss(true, 9000, 0.12, 0.4);
  else if (kind === "cymbal") hiss(true, 8500, 0.4, 0.3);
  else { hiss(false, 2500, 0.01, 0.5); sweep(240, 190, 0.02, 0.04, 0.5); }
  return { buf, len, hold: len, release: 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Per-note envelope and mixing
// ---------------------------------------------------------------------------------------------------------------

const E5 = Math.exp(-5);

/** Applies the 2 ms attack, the damper/release fade and the minimum end fade in place; returns the final length. */
function shapeEnvelope(buf: Float64Array, len: number, hold: number, release: number, sr: number): number {
  const attack = Math.min(len, Math.max(2, Math.round(ATTACK_SEC * sr)));
  for (let i = 0; i < attack; i++) buf[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / attack);
  let end = len;
  if (release > 0 && hold < end) {
    end = Math.min(end, hold + release);
    for (let i = hold; i < end; i++) buf[i] *= (Math.exp((-5 * (i - hold)) / release) - E5) / (1 - E5);
  }
  const fade = Math.min(Math.round(MIN_RELEASE_SEC * sr), end >> 1);
  for (let j = 0; j < fade; j++) buf[end - 1 - j] *= 0.5 - 0.5 * Math.cos((Math.PI * (j + 1)) / (fade + 1));
  return end;
}

/** Slight pitch-dependent trim: the very top octaves are perceived as louder and harsher. */
function pitchTrim(pitch: number): number {
  return 1 / (1 + Math.max(0, pitch - 84) / 48);
}

/** Equal-power gains for a pan between -0.3 (lowest piano key) and +0.3 (highest). */
function panGains(pitch: number): [number, number] {
  const pan = PAN_SPREAD * (2 * clamp((pitch - PAN_LOW_PITCH) / (PAN_HIGH_PITCH - PAN_LOW_PITCH), 0, 1) - 1);
  const angle = ((pan + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

// ---------------------------------------------------------------------------------------------------------------
// Reverb: Schroeder, 4 parallel damped combs + 2 series allpass per channel, different delay lengths per channel
// ---------------------------------------------------------------------------------------------------------------

class ReverbChannel {
  private readonly combs: Float64Array[];
  private readonly combIndex: Int32Array;
  private readonly combLow: Float64Array;
  private readonly combGain: Float64Array;
  private readonly allpasses: Float64Array[];
  private readonly allpassIndex: Int32Array;

  constructor(combLengths: number[], allpassLengths: number[], sr: number, rt60: number, private readonly damp: number) {
    const scale = sr / 48000;
    const lengths = combLengths.map((l) => Math.max(8, Math.round(l * scale)));
    this.combs = lengths.map((l) => new Float64Array(l));
    this.combIndex = new Int32Array(lengths.length);
    this.combLow = new Float64Array(lengths.length);
    this.combGain = Float64Array.from(lengths, (l) => Math.pow(10, (-3 * l) / (rt60 * sr)));
    this.allpasses = allpassLengths.map((l) => new Float64Array(Math.max(4, Math.round(l * scale))));
    this.allpassIndex = new Int32Array(allpassLengths.length);
  }

  process(x: number): number {
    let sum = 0;
    const damp = this.damp;
    for (let c = 0; c < this.combs.length; c++) {
      const line = this.combs[c];
      const i = this.combIndex[c];
      const out = line[i];
      const low = out * (1 - damp) + this.combLow[c] * damp;
      this.combLow[c] = low;
      line[i] = x + low * this.combGain[c];
      this.combIndex[c] = i + 1 === line.length ? 0 : i + 1;
      sum += out;
    }
    let y = sum * 0.25;
    for (let a = 0; a < this.allpasses.length; a++) {
      const line = this.allpasses[a];
      const i = this.allpassIndex[a];
      const delayed = line[i];
      line[i] = y + delayed * 0.5;
      this.allpassIndex[a] = i + 1 === line.length ? 0 : i + 1;
      y = delayed - y;
    }
    return y;
  }
}

/** Adds `level` * (decorrelated reverb of the mono sum) to both channels; about 1.8 s decay, 8 ms pre-delay. */
function addReverb(left: Float64Array, right: Float64Array, sr: number, level: number): void {
  const n = left.length;
  if (!(level > 0) || n === 0) return;
  const rt60 = 1.8;
  const damp = 0.3;
  const wetL = new ReverbChannel([1423, 1637, 1823, 1997], [607, 241], sr, rt60, damp);
  const wetR = new ReverbChannel([1447, 1669, 1861, 2027], [631, 257], sr, rt60, damp);
  const pre = new Float64Array(Math.max(1, Math.round(0.008 * sr)));
  let p = 0;
  for (let i = 0; i < n; i++) {
    const mono = 0.5 * (left[i] + right[i]);
    const delayed = pre[p];
    pre[p] = mono;
    if (++p === pre.length) p = 0;
    left[i] += level * wetL.process(delayed);
    right[i] += level * wetR.process(delayed);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Master: DC high-pass, normalisation, soft limiter, end fade
// ---------------------------------------------------------------------------------------------------------------

function highPassDc(buf: Float64Array, sr: number): void {
  const a = Math.exp((-TWO_PI * DC_CUTOFF_HZ) / sr);
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    y1 = a * (y1 + x - x1);
    x1 = x;
    buf[i] = y1;
  }
}

/** Linear up to the knee, then a tanh shoulder that approaches (never reaches) the ceiling. */
function softLimit(x: number, ceiling: number, knee: number): number {
  const ax = Math.abs(x);
  if (ax <= knee) return x;
  const y = knee + (ceiling - knee) * Math.tanh((ax - knee) / (ceiling - knee));
  return x < 0 ? -y : y;
}

/** Reference level: the 99.5th percentile of 2048-sample block peaks, so one stray coincidence does not make the
 * whole piece quiet (the limiter handles the few blocks above it). Short pieces use their true peak. */
function referenceLevel(left: Float64Array, right: Float64Array): number {
  const n = left.length, block = 2048;
  const blocks = Math.ceil(n / block);
  const peaks = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let peak = 0;
    const end = Math.min(n, (b + 1) * block);
    for (let i = b * block; i < end; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    peaks[b] = peak;
  }
  peaks.sort();
  return blocks > 0 ? peaks[Math.floor((blocks - 1) * 0.995)] : 0;
}

/** Stereo-linked feed-forward compressor, threshold 9 dB under the loud-passage reference, ratio 1..2.4. */
function compressBus(left: Float64Array, right: Float64Array, sr: number, reference: number, strength: number): void {
  if (!(reference > 1e-7) || !(strength > 0)) return;
  const threshold = reference * 0.35;
  const exponent = 1 / (1 + 1.4 * strength) - 1; // gain = (level / threshold) ** exponent above the threshold
  const attack = Math.exp(-1 / (0.004 * sr)), release = Math.exp(-1 / (0.14 * sr));
  let env = 0;
  for (let i = 0; i < left.length; i++) {
    const level = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    env = level > env ? attack * env + (1 - attack) * level : release * env + (1 - release) * level;
    if (env > threshold) {
      const g = Math.pow(env / threshold, exponent);
      left[i] *= g;
      right[i] *= g;
    }
  }
}

/**
 * Look-ahead peak limiter: the gain needed to bring each sample under the threshold, minimum-filtered and then
 * averaged over the same +/-3 ms window, so every sample ends up at or below the threshold with no clicks.
 */
function lookaheadLimit(left: Float64Array, right: Float64Array, sr: number, threshold: number): void {
  const n = left.length;
  const win = Math.max(1, Math.round(0.003 * sr));
  const need = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const peak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (peak > threshold) { need[i] = threshold / peak; any = true; } else need[i] = 1;
  }
  if (!any) return;
  const minimum = new Float32Array(n); // sliding minimum over [i - win, i + win] with a monotonic deque
  const deque = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n + win; i++) {
    if (i < n) {
      while (tail > head && need[deque[tail - 1]] >= need[i]) tail--;
      deque[tail++] = i;
    }
    const centre = i - win;
    if (centre >= 0) {
      while (deque[head] < centre - win) head++;
      minimum[centre] = need[deque[head]];
    }
  }
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + minimum[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - win), hi = Math.min(n - 1, i + win);
    const g = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
    left[i] *= g;
    right[i] *= g;
  }
}

function masterToFloat32(left: Float64Array, right: Float64Array, sr: number, targetPeak: number, maxGain: number, ceiling: number, compression: number, driveDb: number): StereoAudio {
  const n = left.length;
  highPassDc(left, sr);
  highPassDc(right, sr);
  compressBus(left, right, sr, referenceLevel(left, right), compression);
  const reference = referenceLevel(left, right);
  const gain = reference > 1e-7 ? clamp((targetPeak / reference) * Math.pow(10, Math.max(0, driveDb) / 20), 0, maxGain) : 1;
  for (let i = 0; i < n; i++) { left[i] *= gain; right[i] *= gain; }
  lookaheadLimit(left, right, sr, 0.97 * ceiling);
  highPassDc(left, sr); // gain modulation by the limiter can leave a tiny offset; remove it again
  highPassDc(right, sr);

  const knee = 0.7 * ceiling;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const fade = Math.min(Math.round(END_FADE_SEC * sr), n >> 2);
  for (let i = 0; i < n; i++) {
    const g = i >= n - fade ? 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / (fade + 1)) : 1;
    const l = softLimit(left[i], ceiling, knee) * g;
    const r = softLimit(right[i], ceiling, knee) * g;
    // Flush non-finite values and denormal-sized filter residue (below -240 dBFS) to an exact 0.
    outL[i] = Number.isFinite(l) && Math.abs(l) > 1e-12 ? l : 0;
    outR[i] = Number.isFinite(r) && Math.abs(r) > 1e-12 ? r : 0;
  }
  return { left: outL, right: outR, sampleRate: sr };
}

// ---------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------

function resolveInstrument(note: MidiNote, options: SynthOptions): Instrument {
  const explicit = options.instruments?.[note.track];
  if (explicit !== undefined) return explicit;
  const program = options.channelPrograms?.[note.track + ":" + note.channel] ?? options.programs?.[note.track];
  return program === undefined ? "piano" : instrumentForProgram(program);
}

/** Renders the notes to stereo audio. Deterministic: the same notes and options always give the same samples. */
export function renderNotes(notes: readonly MidiNote[], options: SynthOptions = {}): StereoAudio {
  const sr = options.sampleRate ?? SYNTH_SAMPLE_RATE;
  if (!(sr >= 8000 && sr <= 384000)) throw new RangeError(`Unsupported sample rate: ${sr}`);
  const tailSec = Math.max(0, options.tailSec ?? 3);
  const reverb = clamp(options.reverb ?? DEFAULT_REVERB, 0, 1);
  const ceiling = clamp(options.ceiling ?? DEFAULT_CEILING, 0.05, 1);
  const targetPeak = Math.max(0, options.targetPeak ?? DEFAULT_TARGET_PEAK);
  const maxGain = Math.max(0, options.maxGain ?? DEFAULT_MAX_GAIN);

  const valid = (note: MidiNote): boolean =>
    Number.isFinite(note.timeSec) && Number.isFinite(note.pitch) && Number.isFinite(note.velocity) && note.velocity > 0;
  let lastEnd = 0;
  for (const note of notes) {
    if (valid(note)) lastEnd = Math.max(lastEnd, note.timeSec + (Number.isFinite(note.durationSec) ? Math.max(0, note.durationSec) : 0));
  }
  const totalSec = options.totalSec !== undefined && Number.isFinite(options.totalSec) ? Math.max(0, options.totalSec) : lastEnd + tailSec;
  const frames = Math.round(totalSec * sr);
  const mixL = new Float64Array(frames);
  const mixR = new Float64Array(frames);

  const ws = new Workspace();
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index];
    if (!valid(note)) continue;
    const start = Math.max(0, Math.round(note.timeSec * sr));
    if (start >= frames) continue;
    const pitch = clamp(note.pitch, 0, 127);
    const bendSemitones = Number.isFinite(note.pitchBendCents) ? clamp(note.pitchBendCents!, -200, 200) / 100 : 0;
    const params: NoteParams = {
      pitch,
      freq: noteHz(pitch + bendSemitones),
      vn: clamp(note.velocity, 1, 127) / 127,
      holdSec: Number.isFinite(note.durationSec) ? Math.max(0, note.durationSec) : 0,
      sr,
      rng: mulberry32(Math.imul(index + 1, 0x9e3779b1) ^ 0x5bd1e995 ^ Math.round(pitch)),
    };
    const drum = note.channel === 9;
    const instrument = resolveInstrument(note, options);
    const voice = drum ? renderDrum(ws, params)
      : instrument === "bell" ? renderBell(ws, params)
      : instrument === "marimba" ? renderMarimba(ws, params)
      : instrument === "kalimba" ? renderKalimba(ws, params)
      : instrument === "musicbox" ? renderMusicBox(ws, params)
      : instrument === "strings" ? renderStrings(ws, params)
      : instrument === "tar" ? renderTar(ws, params)
      : instrument === "bass" ? renderBass(ws, params)
      : instrument === "organ" ? renderOrgan(ws, params)
      : instrument === "harpsichord" ? renderHarpsichord(ws, params)
      : instrument === "harp" ? renderHarp(ws, params)
      : renderPiano(ws, params);
    const buf = voice.buf;
    const len = Math.min(shapeEnvelope(buf, voice.len, voice.hold, voice.release, sr), frames - start);
    const amp = Math.pow(params.vn, 1.2) * (drum ? DRUM_GAIN : VOICE_GAIN[instrument] * pitchTrim(pitch));
    const [gl, gr] = panGains(drum ? 60 : pitch);
    const al = amp * gl;
    const ar = amp * gr;
    for (let i = 0; i < len; i++) {
      const v = buf[i];
      mixL[start + i] += v * al;
      mixR[start + i] += v * ar;
    }
  }

  addReverb(mixL, mixR, sr, reverb);
  return masterToFloat32(mixL, mixR, sr, targetPeak, maxGain, ceiling, clamp(options.compression ?? 0.5, 0, 1), options.driveDb ?? 3);
}

/** 16-bit PCM stereo WAV: 44-byte RIFF header followed by interleaved little-endian samples. */
export function encodeWavPcm16(audio: StereoAudio): Buffer {
  const frames = audio.left.length;
  if (audio.right.length !== frames) throw new RangeError("Left and right channels must have the same length");
  const dataBytes = frames * 4;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(2, 22); // channels
  wav.writeUInt32LE(audio.sampleRate, 24);
  wav.writeUInt32LE(audio.sampleRate * 4, 28); // byte rate
  wav.writeUInt16LE(4, 32); // block align
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    wav.writeInt16LE(Math.round(clamp(audio.left[i], -1, 1) * 32767), offset);
    wav.writeInt16LE(Math.round(clamp(audio.right[i], -1, 1) * 32767), offset + 2);
    offset += 4;
  }
  return wav;
}

/**
 * ParsedMidi to WAV: the General MIDI program of each channel (or, failing that, the first program of the track)
 * picks the voice unless `instruments` / `programs` / `channelPrograms` override it.
 */
export function synthesizeMidiToWav(midi: ParsedMidi, options: SynthOptions = {}): Buffer {
  const programs: Record<number, number> = {};
  const channelPrograms: Record<string, number> = {};
  for (const track of midi.tracks) {
    if (track.programs.length > 0) programs[track.index] = track.programs[0];
    for (const [channel, program] of Object.entries(track.channelPrograms ?? {})) channelPrograms[track.index + ":" + channel] = program;
  }
  const merged: SynthOptions = {
    ...options,
    programs: { ...programs, ...options.programs },
    channelPrograms: { ...channelPrograms, ...options.channelPrograms },
  };
  return encodeWavPcm16(renderNotes(midi.notes, merged));
}
