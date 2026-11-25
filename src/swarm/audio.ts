import { SAMPLE_RATE, SAMPLES_PER_FRAME } from "../audio.ts";
import { mulberry32, type SwarmTrace } from "./sim.ts";
import type { SwarmDefinition, SwarmSound } from "./themes.ts";

/**
 * Synthesised soundtrack for the swarm compositions. Everything is computed
 * from the trace (events and per-frame type counts) with plain arithmetic, so
 * a seed always yields the same WAV:
 *
 * 1. one short percussive voice per kept conversion, timbre chosen by the
 *    winning type's skin sound, pitch varied on a pentatonic ladder;
 * 2. a deterministic limiter so a 2000-conversion swarm stays a texture;
 * 3. a quiet drone whose pitch, pulse and brightness climb as fewer types
 *    survive, and which resolves into a major pad once one type is left;
 * 4. a bell arpeggio on the winning frame.
 */

const TWO_PI = Math.PI * 2;
const FPS = SAMPLE_RATE / SAMPLES_PER_FRAME;

export const SWARM_SOUND_KINDS = [
  "tok",
  "fwip",
  "snip",
  "bloop",
  "ting",
  "blip",
  "twinkle",
  "knock",
] as const satisfies readonly SwarmSound[];

export const SWARM_AUDIO = {
  /** Smallest spacing between any two kept conversions (a 0..2 frame jitter is added). */
  globalGapFrames: 4,
  /** Smallest spacing between two kept conversions won by the same type. */
  typeGapFrames: 6,
  /** Hard cap on kept conversions in any sliding window of `windowFrames`. */
  windowFrames: 60,
  windowCap: 13,
  /** Longest voice, in frames, and the polyphony cap. */
  voiceFrames: 10,
  maxVoices: 3,
  /** An eligible conversion yields to a rarer winner within this many frames. */
  lookaheadFrames: 3,
  /** Pentatonic ladder (semitones) the pitch of a conversion is drawn from. */
  pitchSteps: [-5, -3, 0, 2, 4, 7],
} as const;

function hash32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const hash01 = (n: number) => hash32(n) / 4294967296;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export interface ConversionTrigger {
  eventIndex: number;
  frame: number;
  winner: number;
  /** Frequency ratio applied to the voice. */
  pitch: number;
  semitones: number;
  gain: number;
  /** Conversions skipped since the previous kept one; they lift this voice's gain. */
  dropped: number;
}

/**
 * Chooses which conversions are audible. At most ~13 per second, never closer
 * than 4 frames, never more than one per 6 frames for the same winner, at most
 * three overlapping voices. Among conversions that compete for a slot the rarer
 * winner is preferred, so a comeback is heard. Dropped conversions lift the next
 * kept voice's gain instead of piling up.
 */
export function scheduleConversionSounds(trace: SwarmTrace): ConversionTrigger[] {
  const A = SWARM_AUDIO;
  const { events, counts, types: K, count: N } = trace;
  const kept: ConversionTrigger[] = [];
  const lastByType = new Array<number>(K).fill(-1e9);
  let lastKept = -1e9;
  let gap: number = A.globalGapFrames;
  let dropped = 0;
  let windowStart = 0;

  const shareOf = (index: number) => counts[events[index].frame * K + events[index].winner] / N;
  const eligible = (index: number) => {
    const frame = events[index].frame;
    if (frame - lastKept < gap) return false;
    if (frame - lastByType[events[index].winner] < A.typeGapFrames) return false;
    while (windowStart < kept.length && kept[windowStart].frame <= frame - A.windowFrames) windowStart++;
    if (kept.length - windowStart >= A.windowCap) return false;
    let active = 0;
    for (let k = kept.length - 1; k >= 0 && kept[k].frame > frame - A.voiceFrames; k--) active++;
    return active < A.maxVoices;
  };

  let i = 0;
  while (i < events.length) {
    if (!eligible(i)) {
      dropped++;
      i++;
      continue;
    }
    let best = i;
    let bestShare = shareOf(i);
    let j = i + 1;
    for (; j < events.length && events[j].frame < events[i].frame + A.lookaheadFrames; j++) {
      if (eligible(j) && shareOf(j) < bestShare - 1e-9) {
        best = j;
        bestShare = shareOf(j);
      }
    }
    dropped += j - i - 1;

    const event = events[best];
    const h = hash32(best * 7919 + event.frame * 104729 + trace.seed);
    const share = bestShare;
    let step = h % A.pitchSteps.length;
    if (share < 0.12) step = Math.min(A.pitchSteps.length - 1, step + 1);
    else if (share > 0.5) step = Math.max(0, step - 1);
    const semitones = A.pitchSteps[step] + ((hash01(h) - 0.5) * 0.16);
    kept.push({
      eventIndex: best,
      frame: event.frame,
      winner: event.winner,
      pitch: 2 ** (semitones / 12),
      semitones,
      gain: (0.88 + 0.24 * hash01(h ^ 0x5bd1e995)) * (1 + 0.08 * Math.min(4, dropped)),
      dropped,
    });
    lastKept = event.frame;
    lastByType[event.winner] = event.frame;
    gap = A.globalGapFrames + (hash32(h ^ 0x27d4eb2f) % 3);
    dropped = 0;
    i = j;
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Voices. Each renderer returns a mono Float32Array at SAMPLE_RATE, peak 1.
// ---------------------------------------------------------------------------

type Voice = (pitch: number, noise: () => number) => Float32Array;

/** Quarter-sine attack: 0 at t = 0, 1 at t = a. */
const rise = (t: number, a: number) => (t >= a ? 1 : Math.sin((Math.PI / 2) * (t / a)));
const onePole = (hz: number) => 1 - Math.exp((-TWO_PI * hz) / SAMPLE_RATE);

function finishVoice(out: Float32Array): Float32Array {
  const taper = Math.round(0.004 * SAMPLE_RATE);
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    if (i >= out.length - taper) out[i] *= (out.length - 1 - i) / taper;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}

/** Rock: a low membrane thump with a short wooden overtone and a dull click. */
const renderTok: Voice = (p, noise) => {
  const out = new Float32Array(Math.round(0.12 * SAMPLE_RATE));
  const a = onePole(2200);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    phase += (TWO_PI * 150 * p * (1 + 0.95 * Math.exp(-t / 0.016))) / SAMPLE_RATE;
    const body = Math.sin(phase) + 0.3 * Math.sin(phase * 2.31) * Math.exp(-t / 0.01);
    lp += a * (noise() - lp);
    out[i] = rise(t, 0.0012) * Math.exp(-t / 0.034) * body + 0.55 * lp * Math.exp(-t / 0.0016);
  }
  return finishVoice(out);
};

/** Paper: soft band-passed noise swept upward, raised-cosine attack. */
const renderFwip: Voice = (p, noise) => {
  const out = new Float32Array(Math.round(0.13 * SAMPLE_RATE));
  const damping = 0.5;
  let low = 0;
  let band = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const centre = Math.min(6000, (850 + 2600 * Math.min(1, t / 0.1) ** 0.8) * p);
    const f = 2 * Math.sin((Math.PI * centre) / SAMPLE_RATE);
    const high = noise() - low - damping * band;
    band += f * high;
    low += f * band;
    const attack = t < 0.014 ? 0.5 - 0.5 * Math.cos((Math.PI * t) / 0.014) : 1;
    out[i] = band * attack * Math.exp(-Math.max(0, t - 0.014) / 0.045);
  }
  return finishVoice(out);
};

/** Scissors: two quick bright metallic clicks, the second a little higher. */
const renderSnip: Voice = (p, noise) => {
  const out = new Float32Array(Math.round(0.09 * SAMPLE_RATE));
  const clicks = [
    { start: 0, gain: 1, lift: 1 },
    { start: 0.034, gain: 0.8, lift: 1.13 },
  ];
  let previous = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const n = noise();
    const hiss = n - previous;
    previous = n;
    let v = 0;
    for (const c of clicks) {
      const tc = t - c.start;
      if (tc < 0) continue;
      const f1 = 3300 * p * c.lift;
      const f2 = 5150 * p * c.lift;
      const f3 = 6900 * p * c.lift;
      const ring =
        Math.sin(TWO_PI * f1 * tc + 1.6 * Math.sin(TWO_PI * f2 * 0.5 * tc)) * Math.exp(-tc / 0.005) +
        0.6 * Math.sin(TWO_PI * f2 * tc) * Math.exp(-tc / 0.0038) +
        0.35 * Math.sin(TWO_PI * f3 * tc) * Math.exp(-tc / 0.0026);
      v += c.gain * (ring + 0.9 * hiss * Math.exp(-tc / 0.0018));
    }
    out[i] = v;
  }
  return finishVoice(out);
};

/** Circle: a soft, round sine that falls in pitch. */
const renderBloop: Voice = (p) => {
  const out = new Float32Array(Math.round(0.14 * SAMPLE_RATE));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    phase += (TWO_PI * (330 + 430 * Math.exp(-t / 0.05)) * p) / SAMPLE_RATE;
    out[i] = rise(t, 0.007) * Math.exp(-t / 0.046) * (Math.sin(phase) + 0.1 * Math.sin(2 * phase));
  }
  return finishVoice(out);
};

/** Triangle: a bright plucked triangle wave with a fast inharmonic bell partial. */
const renderTing: Voice = (p) => {
  const out = new Float32Array(Math.round(0.14 * SAMPLE_RATE));
  const f = 1320 * p;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const tri = (2 / Math.PI) * Math.asin(Math.sin(TWO_PI * f * t));
    out[i] =
      rise(t, 0.0006) *
      Math.exp(-t / 0.042) *
      (tri +
        0.45 * Math.sin(TWO_PI * 2.76 * f * t) * Math.exp(-t / 0.018) +
        0.2 * Math.sin(TWO_PI * 5.4 * f * t) * Math.exp(-t / 0.009));
  }
  return finishVoice(out);
};

/** Square: an 8-bit-style rising chirp stepped in six notes, lightly bit-crushed. */
const renderBlip: Voice = (p) => {
  const out = new Float32Array(Math.round(0.09 * SAMPLE_RATE));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const step = Math.min(5, Math.floor(t / 0.011));
    phase += (TWO_PI * 560 * p * 2 ** (0.28 * step)) / SAMPLE_RATE;
    // Band-limited square: odd harmonics up to the 7th.
    const square =
      (Math.sin(phase) + Math.sin(3 * phase) / 3 + Math.sin(5 * phase) / 5 + Math.sin(7 * phase) / 7) *
      (4 / Math.PI);
    const env = t < 0.06 ? 1 : Math.max(0, 1 - (t - 0.06) / 0.03);
    out[i] = Math.round(square * env * 10) / 10;
  }
  return finishVoice(out);
};

/** Star: two glassy high partials with fast vibrato and shimmer. */
const renderTwinkle: Voice = (p) => {
  const out = new Float32Array(Math.round(0.14 * SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const vibrato = 0.9 * Math.sin(TWO_PI * 23 * t);
    const shimmer = 0.65 + 0.35 * Math.sin(TWO_PI * 31 * t + 1);
    out[i] =
      rise(t, 0.002) *
      Math.exp(-t / 0.042) *
      shimmer *
      (Math.sin(TWO_PI * 2093 * p * t + vibrato) +
        0.8 * Math.sin(TWO_PI * 3136 * p * 1.002 * t + 0.8 * vibrato) +
        0.35 * Math.sin(TWO_PI * 4186 * p * t));
  }
  return finishVoice(out);
};

/** Hexagon: a low-mid woody FM thock with a dull click. */
const renderKnock: Voice = (p, noise) => {
  const out = new Float32Array(Math.round(0.1 * SAMPLE_RATE));
  const a = onePole(1800);
  const carrier = 235 * p;
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const index = 4.2 * Math.exp(-t / 0.011);
    const wood =
      Math.sin(TWO_PI * carrier * t + index * Math.sin(TWO_PI * 1.41 * carrier * t)) +
      0.35 * Math.sin(TWO_PI * 2.7 * carrier * t + 0.6 * index * Math.sin(TWO_PI * 3.1 * carrier * t)) *
        Math.exp(-t / 0.012);
    lp += a * (noise() - lp);
    out[i] = rise(t, 0.0008) * Math.exp(-t / 0.024) * wood + 0.3 * lp * Math.exp(-t / 0.0022);
  }
  return finishVoice(out);
};

const VOICES: Record<SwarmSound, Voice> = {
  tok: renderTok,
  fwip: renderFwip,
  snip: renderSnip,
  bloop: renderBloop,
  ting: renderTing,
  blip: renderBlip,
  twinkle: renderTwinkle,
  knock: renderKnock,
};

/**
 * Level of each voice (its peak is 1 before this). Chosen so the voices have a
 * similar RMS, with the brightest ones a little lower: they read louder.
 */
const VOICE_LEVEL: Record<SwarmSound, number> = {
  tok: 1,
  fwip: 0.95,
  snip: 0.8,
  bloop: 0.8,
  ting: 1,
  blip: 0.3,
  twinkle: 0.85,
  knock: 1,
};

/** One conversion voice on its own (also used by the tests). Deterministic for a given `seed`. */
export function renderConversionSound(kind: SwarmSound, pitch = 1, seed = 1): Float32Array {
  const rand = mulberry32(seed);
  const voice = VOICES[kind](pitch, () => rand() * 2 - 1);
  const level = VOICE_LEVEL[kind];
  for (let i = 0; i < voice.length; i++) voice[i] *= level;
  return voice;
}

// ---------------------------------------------------------------------------
// Tension bed and finish chime
// ---------------------------------------------------------------------------

/**
 * Tension per frame in 0..1: how many types are gone, how far ahead the leader
 * is, plus a slow creep so even a balanced middle game keeps climbing. It
 * peaks on the winning frame, then relaxes. Smoothed over about half a second.
 */
export function tensionCurve(trace: SwarmTrace): Float32Array {
  const { counts, types: K, count: N, totalFrames, winFrame } = trace;
  const out = new Float32Array(totalFrames);
  const alpha = 1 - Math.exp(-1 / (0.5 * FPS));
  let smooth = 0;
  for (let f = 0; f < totalFrames; f++) {
    let alive = 0;
    let top = 0;
    for (let k = 0; k < K; k++) {
      const c = counts[f * K + k];
      if (c > 0) alive++;
      if (c > top) top = c;
    }
    const aliveFraction = K > 1 ? (K - alive) / (K - 1) : 1;
    const dominance = clamp01((top / N - 1 / K) / (1 - 1 / K));
    const progress = Math.min(1, f / Math.max(1, winFrame));
    let target = 0.5 * aliveFraction + 0.35 * dominance + 0.15 * progress;
    if (f >= winFrame) {
      const relax = Math.min(1, (f - winFrame) / FPS / 0.6);
      target = target * (1 - relax) + 0.1 * relax;
    }
    smooth += (target - smooth) * alpha;
    out[f] = smooth;
  }
  return out;
}

/**
 * Quiet drone on `rootHz`: root, a slightly detuned twin, octave and fifth.
 * As tension rises the pitch climbs (up to +10 percent), the pulse speeds up
 * from 0.7 to 4.3 Hz and deepens, and upper partials fade in. After the win a
 * soft major pad (root x2, x2.5, x3) takes over.
 */
export function renderTensionBed(trace: SwarmTrace, definition: SwarmDefinition): Float32Array {
  const total = trace.totalFrames * SAMPLES_PER_FRAME;
  const out = new Float32Array(total);
  const tension = tensionCurve(trace);
  const root = definition.rootHz;
  const w = TWO_PI / SAMPLE_RATE;
  const fadeIn = Math.round(0.02 * SAMPLE_RATE);
  const winSample = trace.winFrame * SAMPLES_PER_FRAME;
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  let p4 = 0;
  let p5 = 0;
  let p6 = 0;
  let pulse = 0;
  for (let i = 0; i < total; i++) {
    const f = Math.floor(i / SAMPLES_PER_FRAME);
    const frac = (i - f * SAMPLES_PER_FRAME) / SAMPLES_PER_FRAME;
    const t0 = tension[f];
    const t1 = tension[Math.min(f + 1, tension.length - 1)];
    const T = t0 + (t1 - t0) * frac;
    const base = root * (1 + 0.1 * T);
    p1 += w * base;
    p2 += w * base * 1.0035;
    p3 += w * base * 2;
    p4 += w * base * 1.5;
    p5 += w * base * 3;
    p6 += w * base * 4.01;
    pulse += w * (0.7 + 3.6 * T);
    const depth = 0.16 + 0.4 * T;
    const lfo = 1 - depth + depth * (0.5 + 0.5 * Math.sin(pulse));
    const bright = T * T;
    let v =
      Math.sin(p1) +
      0.7 * Math.sin(p2) +
      0.45 * Math.sin(p3) +
      (0.16 + 0.34 * T) * Math.sin(p4) +
      0.3 * bright * Math.sin(p5) +
      0.2 * bright * Math.sin(p6);
    v *= (0.029 + 0.052 * T) * lfo;
    if (i >= winSample) {
      const s = (i - winSample) / SAMPLE_RATE;
      const pad = rise(s, 0.25) * Math.exp(-s / 2.2) * 0.05;
      v +=
        pad *
        (Math.sin(w * root * 2 * i) + 0.8 * Math.sin(w * root * 2.5 * i) + 0.7 * Math.sin(w * root * 3 * i));
    }
    out[i] = v * Math.min(1, i / fadeIn);
  }
  return out;
}

/** Bell arpeggio on the major triad two octaves above `rootHz`, about 1.5 s of ring. */
export function renderFinishChime(rootHz: number): Float32Array {
  const length = Math.round(2.1 * SAMPLE_RATE);
  const out = new Float32Array(length);
  const base = rootHz * 4;
  const notes = [
    { ratio: 1, start: 0 },
    { ratio: 5 / 4, start: 0.065 },
    { ratio: 3 / 2, start: 0.13 },
    { ratio: 2, start: 0.195 },
  ];
  const partials = [
    { ratio: 1, amp: 1, decay: 0.55 },
    { ratio: 2, amp: 0.34, decay: 0.33 },
    { ratio: 3, amp: 0.15, decay: 0.2 },
    { ratio: 4.2, amp: 0.07, decay: 0.12 },
  ];
  for (const note of notes) {
    const first = Math.round(note.start * SAMPLE_RATE);
    for (let i = first; i < length; i++) {
      const t = (i - first) / SAMPLE_RATE;
      let v = 0;
      for (const part of partials) {
        v += part.amp * Math.sin(TWO_PI * base * note.ratio * part.ratio * t) * Math.exp(-t / part.decay);
      }
      out[i] += 0.27 * rise(t, 0.002) * v;
    }
  }
  const fade = Math.round(0.05 * SAMPLE_RATE);
  for (let i = 0; i < fade; i++) out[length - 1 - i] *= i / fade;
  return out;
}

// ---------------------------------------------------------------------------
// Mixdown
// ---------------------------------------------------------------------------

export interface SwarmAudioLayers {
  bed: Float32Array;
  sounds: Float32Array;
  chime: Float32Array;
  triggers: ConversionTrigger[];
}

/** The three layers before normalisation, each exactly `totalFrames * SAMPLES_PER_FRAME` long. */
export function renderSwarmLayers(trace: SwarmTrace, definition: SwarmDefinition): SwarmAudioLayers {
  const total = trace.totalFrames * SAMPLES_PER_FRAME;
  const triggers = scheduleConversionSounds(trace);
  const sounds = new Float32Array(total);
  for (const trigger of triggers) {
    const kind = definition.skin.types[trigger.winner].sound;
    const voice = renderConversionSound(kind, trigger.pitch, trigger.eventIndex + 1);
    const start = trigger.frame * SAMPLES_PER_FRAME;
    const gain = 0.55 * trigger.gain;
    for (let i = 0; i < voice.length && start + i < total; i++) sounds[start + i] += gain * voice[i];
  }
  const chime = new Float32Array(total);
  const ring = renderFinishChime(definition.rootHz);
  const chimeStart = trace.winFrame * SAMPLES_PER_FRAME;
  for (let i = 0; i < ring.length && chimeStart + i < total; i++) chime[chimeStart + i] = ring[i];
  return { bed: renderTensionBed(trace, definition), sounds, chime, triggers };
}

function encodeMonoPcm16Wav(samples: Float32Array): Buffer {
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return wav;
}

/** Loudness reference: this share of samples lies at or below the level that is scaled to `NORMALISE_LEVEL`. */
const NORMALISE_PERCENTILE = 0.9995;
const NORMALISE_LEVEL = 0.85;
/** Soft knee: linear up to `KNEE`, then tanh towards `KNEE + KNEE_ROOM` (0.88), so no sample reaches 0.95. */
const KNEE = 0.7;
const KNEE_ROOM = 0.18;

/** Magnitude below which `fraction` of the samples fall (histogram estimate, exact to 1/4096 of the peak). */
function percentileAbs(samples: Float32Array, fraction: number): number {
  let top = 0;
  for (let i = 0; i < samples.length; i++) top = Math.max(top, Math.abs(samples[i]));
  if (top === 0) return 0;
  const bins = 4096;
  const histogram = new Uint32Array(bins);
  for (let i = 0; i < samples.length; i++) {
    histogram[Math.min(bins - 1, Math.floor((Math.abs(samples[i]) / top) * bins))]++;
  }
  const target = fraction * samples.length;
  let seen = 0;
  for (let b = 0; b < bins; b++) {
    seen += histogram[b];
    if (seen >= target) return ((b + 1) / bins) * top;
  }
  return top;
}

/**
 * Deterministic mono PCM16 WAV, `trace.totalFrames * SAMPLES_PER_FRAME` samples.
 * The mix is scaled so its 99.95th percentile sits at 0.85, then a soft knee
 * above 0.7 keeps every sample under 0.88; the last 100 ms fade out smoothly.
 */
export function synthesizeSwarmWav(trace: SwarmTrace, definition: SwarmDefinition): Buffer {
  const { bed, sounds, chime } = renderSwarmLayers(trace, definition);
  const total = bed.length;
  const mix = new Float32Array(total);
  for (let i = 0; i < total; i++) mix[i] = bed[i] + sounds[i] + chime[i];
  const reference = percentileAbs(mix, NORMALISE_PERCENTILE);
  const scale = reference > 0 ? NORMALISE_LEVEL / reference : 1;
  const fade = Math.round(0.1 * SAMPLE_RATE);
  for (let i = 0; i < total; i++) {
    const x = mix[i] * scale;
    const a = Math.abs(x);
    let y = a <= KNEE ? x : Math.sign(x) * (KNEE + KNEE_ROOM * Math.tanh((a - KNEE) / KNEE_ROOM));
    if (i >= total - fade) y *= 0.5 + 0.5 * Math.cos((Math.PI * (i - (total - fade))) / fade);
    mix[i] = y;
  }
  return encodeMonoPcm16Wav(mix);
}
