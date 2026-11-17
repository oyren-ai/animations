import { panFromScreenX } from "../../audio-reactive/synth.ts";
import { HIT_CLOSING_FRAMES, type HitAudio } from "../types.ts";
import {
  addBell,
  addBoom,
  addRiser,
  addSoftPad,
  addThud,
  addTick,
  finishHitAudio,
  newHitBuffer,
  noteHz,
  PENTATONIC_MAJOR,
  scaleMidi,
  thinEvents,
} from "../voices.ts";
import { SCENE_FRAMES, SIM_FPS, WORLD_W, type MergeTrace } from "./sim.ts";
import { TIER_COUNT } from "./tiers.ts";

/**
 * FunnelMerge sound: every merge rings a bell whose pitch climbs a pentatonic scale with the new tier,
 * a chain stacks up to two more notes above it, drops are a very soft tick, wall and floor hits a soft
 * thud, and the final form gets a riser, a boom and a C major add9 fanfare over a steady pad bed.
 * Everything is a sum of sines or low-passed noise, so the mix stays warm and band-limited.
 */

/** Merge bells and chain notes together never exceed this many per second, in any 1 s window. */
export const BELL_CAP_PER_SEC = 10;
/** Merges closer than this are one gesture: a loose `thinEvents` pass drops the near-duplicates (50 ms). */
const BELL_DUPLICATE_RATE = 20;
export const TICK_CAP_PER_SEC = 8;
export const THUD_CAP_PER_SEC = 6;
export const CHAIN_NOTE_STAGGER_SEC = 0.04;
export const ROOT_MIDI = 60;

export interface BellEvent {
  t: number;
  midi: number;
  gain: number;
  pan: number;
  tier: number;
  /** 0 = the merge bell, 1 and 2 = chain notes above it. */
  chainNote: number;
  decay: number;
  durSec: number;
}

export interface TickEvent {
  t: number;
  gain: number;
  pan: number;
  hz: number;
}

export interface ThudEvent {
  t: number;
  gain: number;
  pan: number;
  hz: number;
}

export interface FinalCue {
  /** Time of the first tier-7 piece. */
  t: number;
  riserStart: number;
  /** C major add9: C5 E5 G5 D6. */
  chordMidi: number[];
}

export interface MergeSchedule {
  bells: BellEvent[];
  ticks: TickEvent[];
  thuds: ThudEvent[];
  final: FinalCue | null;
}

/** MIDI note of the bell for a tier; `step` climbs further up the pentatonic scale for chain notes. */
export function bellMidi(tier: number, step = 0): number {
  return scaleMidi(ROOT_MIDI, PENTATONIC_MAJOR, 2 * tier - 2 + 2 * step);
}

const pan = (x: number): number => panFromScreenX(x, WORLD_W, 0.6);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** True when one more event at `t` keeps every 1 s window at or under `cap` events. `times` is sorted. */
function fitsCap(times: readonly number[], t: number, cap: number): boolean {
  const starts = [t];
  for (const x of times) if (x > t - 1 && x <= t) starts.push(x);
  for (const w of starts) {
    let n = t >= w && t < w + 1 ? 1 : 0;
    for (const x of times) if (x >= w && x < w + 1) n++;
    if (n > cap) return false;
  }
  return true;
}

function insertSorted(times: number[], t: number): void {
  let i = times.length;
  while (i > 0 && times[i - 1] > t) i--;
  times.splice(i, 0, t);
}

export function buildMergeSchedule(trace: MergeTrace): MergeSchedule {
  // bells: one per merge (a loose thin pass, then the 1 s window cap), then chain notes where the cap still has room
  const merged = thinEvents(
    trace.merges.map((m) => ({ t: m.t, m })),
    BELL_DUPLICATE_RATE,
  );
  const bells: BellEvent[] = [];
  const times: number[] = [];
  const mains: { t: number; m: (typeof trace.merges)[number] }[] = [];
  for (const { t, m } of merged) {
    if (!fitsCap(times, t, BELL_CAP_PER_SEC)) continue;
    mains.push({ t, m });
    insertSorted(times, t);
    bells.push({
      t,
      midi: bellMidi(m.tier),
      gain: 0.11 + 0.024 * (m.tier - 2),
      pan: pan(m.x),
      tier: m.tier,
      chainNote: 0,
      decay: 8.5 - 0.8 * (m.tier - 2),
      durSec: 0.5 + 0.17 * (m.tier - 2),
    });
  }
  for (const { t, m } of mains) {
    const extras = Math.min(2, m.chain - 1);
    for (let k = 1; k <= extras; k++) {
      const tk = t + CHAIN_NOTE_STAGGER_SEC * k;
      if (!fitsCap(times, tk, BELL_CAP_PER_SEC)) break;
      insertSorted(times, tk);
      bells.push({
        t: tk,
        midi: bellMidi(m.tier, k),
        gain: (0.11 + 0.024 * (m.tier - 2)) * 0.62 ** k,
        pan: pan(m.x),
        tier: m.tier,
        chainNote: k,
        decay: 8.5 - 0.8 * (m.tier - 2),
        durSec: 0.5 + 0.17 * (m.tier - 2),
      });
    }
  }
  bells.sort((a, b) => a.t - b.t || a.chainNote - b.chainNote);

  const ticks: TickEvent[] = thinEvents(
    trace.spawns.map((s, i) => ({ t: s.t, gain: 0.05, pan: pan(s.x + s.vx * 0.2), hz: 880 + 70 * (i % 4) })),
    TICK_CAP_PER_SEC,
  );

  const thuds: ThudEvent[] = thinEvents(
    trace.impacts.map((e) => ({
      t: e.t,
      gain: clamp(0.03 + e.speed / 22000, 0.03, 0.12),
      pan: pan(e.x),
      hz: Math.max(72, 150 - 12 * e.tier),
    })),
    THUD_CAP_PER_SEC,
  );

  // the riser starts about when the second tier-6 piece appears (both halves of the final merge exist) and ends on the merge
  let final: FinalCue | null = null;
  const first = trace.merges.find((m) => m.tier === TIER_COUNT);
  if (first) {
    const sixes = trace.merges.filter((m) => m.tier === TIER_COUNT - 1);
    const second = sixes.length >= 2 ? sixes[1].t : first.t - 1.6;
    const riserStart = Math.max(0, first.t - 2.4, Math.min(second - 0.6, first.t - 1.2));
    final = { t: first.t, riserStart, chordMidi: [72, 76, 79, 86] };
  }

  return { bells, ticks, thuds, final };
}

/** Pad chords under everything: C, Am, F, G, each 4 s long and overlapping, so a bed runs to the last frame. */
const PAD_CHORDS: readonly (readonly number[])[] = [
  [48, 55, 64],
  [45, 52, 60],
  [41, 48, 57],
  [43, 50, 59],
];

export function buildMergeAudio(trace: MergeTrace): HitAudio {
  const totalFrames = SCENE_FRAMES + HIT_CLOSING_FRAMES;
  const totalSec = totalFrames / SIM_FPS;
  const buf = newHitBuffer(totalFrames);

  for (let k = 0; k * 4 < totalSec; k++) {
    addSoftPad(buf, {
      startSec: k * 4 - 0.6,
      durSec: k * 4 + 5.4 >= totalSec ? totalSec - (k * 4 - 0.6) + 2 : 6,
      freqs: PAD_CHORDS[k % PAD_CHORDS.length].map(noteHz),
      gain: 0.058,
      attackSec: 1.0,
      releaseSec: 1.3,
    });
  }

  const s = buildMergeSchedule(trace);
  for (const e of s.ticks) addTick(buf, { t: e.t, gain: e.gain, pan: e.pan, hz: e.hz });
  for (const e of s.thuds) addThud(buf, { t: e.t, gain: e.gain, pan: e.pan, hz: e.hz });
  for (const b of s.bells) {
    addBell(buf, { t: b.t, freq: noteHz(b.midi), gain: b.gain, pan: b.pan, decay: b.decay, durSec: b.durSec });
  }

  const fin = s.final;
  if (fin) {
    addRiser(buf, { t: fin.riserStart, durSec: fin.t - fin.riserStart, gain: 0.14, fromHz: 160, toHz: 880 });
    addBoom(buf, { t: fin.t, gain: 0.5 });
    const pans = [-0.4, -0.15, 0.15, 0.4];
    fin.chordMidi.forEach((midi, i) => {
      addBell(buf, { t: fin.t + 0.03 * i, freq: noteHz(midi), gain: 0.14, pan: pans[i], decay: 1.7, durSec: 2.6 });
    });
    addSoftPad(buf, {
      startSec: fin.t - 0.2,
      durSec: 4.4,
      freqs: [noteHz(60), noteHz(64), noteHz(67), noteHz(74)],
      gain: 0.1,
      attackSec: 0.35,
      releaseSec: 1.6,
    });
  }
  return finishHitAudio(buf);
}
