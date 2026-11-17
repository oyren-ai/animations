import { panFromScreenX } from "../../audio-reactive/synth.ts";
import { FPS } from "../kit.ts";
import { HIT_CLOSING_FRAMES, type HitAudio } from "../types.ts";
import {
  addBell,
  addRiser,
  addSoftPad,
  addThud,
  addWhoosh,
  finishHitAudio,
  newHitBuffer,
  noteHz,
  thinEvents,
} from "../voices.ts";
import { levelThickness, type BrickTrace } from "./sim.ts";

/** Two bells closer than this are pushed apart, so a corner double hit stays two readable notes (about 5 frames). */
export const BRICK_NOTE_MIN_GAP = 0.08;

export interface BrickNote {
  readonly t: number;
  readonly midi: number;
  readonly pan: number;
  readonly gain: number;
  /** Index of the bounce that plays this note. */
  readonly bounce: number;
}

export interface BrickThud {
  readonly t: number;
  readonly gain: number;
  readonly hz: number;
  readonly pan: number;
}

export interface BrickSchedule {
  readonly notes: BrickNote[];
  readonly thuds: BrickThud[];
  /** Video seconds of the payoff (the ball leaving, or the end of the scene when it is walled in). */
  readonly payoffT: number;
  readonly escapeT: number | null;
  /** Time the exit first dropped to half of its width (start of the riser). */
  readonly halfClosedT: number;
}

/** Every bounce plays the next note of the tune and a soft thud scaled by the brick thickness. */
export function buildBrickSchedule(trace: BrickTrace): BrickSchedule {
  const notes: BrickNote[] = [];
  const thudEvents: BrickThud[] = [];
  let last = Number.NEGATIVE_INFINITY;
  trace.bounces.forEach((b, i) => {
    const t = Math.max(b.t, last + BRICK_NOTE_MIN_GAP);
    last = t;
    const pan = panFromScreenX(b.x, 1080, 0.82);
    notes.push({ t, midi: b.note, pan, gain: 0.2, bounce: i });
    const thick = levelThickness(b.level);
    thudEvents.push({ t: b.t, gain: 0.07 + thick * 0.0009, hz: 112 - 7 * b.level, pan });
  });
  const thuds = thinEvents(thudEvents, 9);
  const escapeT = trace.escape ? trace.escape.t : null;
  const sceneEnd = trace.sceneFrames / FPS;
  const payoffT = escapeT ?? sceneEnd - 2.2;
  let halfClosedT = payoffT - 8;
  const half = trace.params.doorW0 / 2;
  for (let f = 0; f < trace.sceneFrames; f++) {
    if (trace.doorW[f] <= half) {
      halfClosedT = f / FPS;
      break;
    }
  }
  return { notes, thuds, payoffT, escapeT, halfClosedT };
}

/** Pad chords in a slow C - G - Am - F loop, voiced low and close so the bed stays warm. */
const PAD_CHORDS: readonly (readonly number[])[] = [
  [48, 52, 55, 64],
  [47, 50, 55, 62],
  [45, 52, 57, 60],
  [45, 53, 57, 60],
];

export function buildBrickAudio(trace: BrickTrace): HitAudio {
  const totalFrames = trace.sceneFrames + HIT_CLOSING_FRAMES;
  const total = totalFrames / FPS;
  const buf = newHitBuffer(totalFrames);
  const schedule = buildBrickSchedule(trace);
  const { payoffT } = schedule;

  // Bed: C - G - Am - F up to the payoff, then C major resolves and rings to the last frame.
  const segment = payoffT / PAD_CHORDS.length;
  PAD_CHORDS.forEach((chord, i) => {
    const start = i * segment;
    const end = i === PAD_CHORDS.length - 1 ? payoffT + 0.5 : (i + 1) * segment + 1.2;
    addSoftPad(buf, {
      startSec: start,
      durSec: end - start,
      freqs: chord.map(noteHz),
      gain: 0.052,
      attackSec: i === 0 ? 0.3 : 1.0,
      releaseSec: 1.2,
    });
  });
  addSoftPad(buf, {
    startSec: payoffT - 0.05,
    durSec: total - payoffT + 2,
    freqs: [48, 55, 60, 64].map(noteHz),
    gain: 0.062,
    attackSec: 0.35,
    releaseSec: 0.5,
  });

  // A riser that swells as the exit closes and peaks at the payoff.
  const riserStart = Math.max(0.5, Math.min(schedule.halfClosedT, payoffT - 2));
  addRiser(buf, { t: riserStart, durSec: payoffT - riserStart, gain: 0.1, fromHz: 140, toHz: 520 });

  // One bell per bounce, always the next note of the tune, panned by the contact position.
  for (const n of schedule.notes) addBell(buf, { t: n.t, freq: noteHz(n.midi + 12), gain: n.gain, pan: n.pan });
  for (const th of schedule.thuds) addThud(buf, { t: th.t, gain: th.gain, pan: th.pan, hz: th.hz });

  if (schedule.escapeT !== null) {
    // The ball is out: a rising C major arpeggio, a whoosh toward the door side, and a soft thump.
    const arp = [72, 76, 79, 84, 88];
    arp.forEach((midi, i) => {
      addBell(buf, { t: payoffT + 0.02 + i * 0.075, freq: noteHz(midi), gain: 0.17, pan: -0.55 + i * 0.28, decay: 4.5, durSec: 0.9 });
    });
    addWhoosh(buf, { t: payoffT - 0.12, durSec: 0.95, gain: 0.2, pan: -0.55, fromHz: 250, toHz: 1500, seed: 31 });
    addThud(buf, { t: payoffT, gain: 0.3, hz: 74, pan: -0.3, durSec: 0.32 });
  } else {
    // Walled in: one low thump and a falling whoosh.
    addThud(buf, { t: payoffT, gain: 0.34, hz: 58, durSec: 0.4 });
    addWhoosh(buf, { t: payoffT - 0.1, durSec: 0.9, gain: 0.14, fromHz: 900, toHz: 200, seed: 37 });
  }
  return finishHitAudio(buf);
}
