import { panFromScreenX } from "../../audio-reactive/synth.ts";
import { FPS } from "../kit.ts";
import { HIT_CLOSING_FRAMES, type HitAudio } from "../types.ts";
import {
  addBell,
  addRiser,
  addSoftPad,
  addThud,
  addTick,
  addWhoosh,
  finishHitAudio,
  newHitBuffer,
  noteHz,
  thinEvents,
} from "../voices.ts";
import { CELL, CLOCK_ZERO_FRAME, COLS, SCENE_FRAMES, TEAM_COUNT, TICK_FRAMES, type WarTrace } from "./sim.ts";

/**
 * Sparse, warm, band-limited sound for the colour war. Everything is planned from the trace first
 * (`planWarAudio`, easy to test) and then voiced with the shared voice kit.
 *  - a soft bell per capture batch, one pitch per colour (C4 E4 G4 D5), panned by the batch's x
 *  - underdog: a rising whoosh into a low thud on the exact tick frame, plus the colour's own note
 *  - the last 3 s: one soft beat per clock second, the pitch climbing
 *  - the end: a riser, then a chord on the winner's note that rings into the closing card
 *  - a steady soft pad bed from the first to the last frame
 */

/** Capture pitches: C4, E4, G4, D5. Each colour keeps its own note for the whole video. */
export const TEAM_MIDI = [60, 64, 67, 74] as const;

/** Chords on the winner's note, all inside C major (C major, E minor, G major, D minor). */
export const END_CHORDS: readonly (readonly number[])[] = [
  [48, 60, 64, 67, 72],
  [52, 64, 67, 71, 76],
  [43, 55, 67, 71, 74],
  [50, 62, 65, 69, 74],
];

const BEAT_MIDI = [67, 71, 74] as const;

/**
 * Capture ticks. A colour collects the cells it captured into a batch and rings when the batch has at least
 * `MIN_BATCH_CELLS` cells, no sooner than `TEAM_GAP_FRAMES` (plus a small deterministic jitter) after its last
 * ring, and no sooner than `GLOBAL_GAP_FRAMES` after any colour's last ring. A batch that has to wait keeps
 * growing, so nothing is dropped and every colour is heard. The global gap is exactly the rate cap.
 */
const TEAM_GAP_FRAMES = 18; // about 3 per second per colour
const TEAM_JITTER_FRAMES = 6;
const GLOBAL_GAP_FRAMES = 3; // 20 per second at most
const MIN_BATCH_CELLS = 2;
/** The global cap on capture ticks per second (the brief asks for about 20). */
export const CAPTURE_RATE_CAP = 20;
const CLACK_RATE_CAP = 4;
const WALL_RATE_CAP = 3;

/** A small deterministic jitter so a steady stream never sounds like a machine. */
function jitter(frame: number, team: number): number {
  const h = (Math.imul(frame + 1, 0x9e3779b1) ^ Math.imul(team + 7, 0x85ebca6b)) >>> 0;
  return (h >>> 24) % TEAM_JITTER_FRAMES;
}

export interface CaptureTick {
  t: number;
  team: number;
  midi: number;
  pan: number;
  cells: number;
}

export interface WarAudioPlan {
  captures: CaptureTick[];
  /** Ball against ball. */
  clacks: { t: number; pan: number; power: number }[];
  /** Ball against the canvas edge. */
  walls: { t: number; pan: number }[];
  underdogs: { t: number; team: number; midi: number }[];
  beats: { t: number; midi: number }[];
  end: { t: number; team: number; riserStart: number; midis: readonly number[] };
}

export function planWarAudio(trace: WarTrace): WarAudioPlan {
  const accCells = new Float64Array(TEAM_COUNT);
  const accX = new Float64Array(TEAM_COUNT);
  // the colours start out of phase with each other
  const lastEmit = new Int32Array(TEAM_COUNT).map((_, team) => -TEAM_GAP_FRAMES + 4 * team);
  let lastAny = -GLOBAL_GAP_FRAMES;
  const raw: CaptureTick[] = [];
  for (let f = 1; f <= CLOCK_ZERO_FRAME; f++) {
    for (let k = trace.capStart[f]; k < trace.capStart[f + 1]; k++) {
      const team = trace.capTeam[k];
      accCells[team]++;
      accX[team] += ((trace.capCell[k] % COLS) + 0.5) * CELL;
    }
    // the colour order rotates with the frame so no colour always gets the free slot first
    for (let off = 0; off < TEAM_COUNT; off++) {
      const team = (off + f) % TEAM_COUNT;
      if (
        accCells[team] >= MIN_BATCH_CELLS &&
        f - lastEmit[team] >= TEAM_GAP_FRAMES + jitter(f, team) &&
        f - lastAny >= GLOBAL_GAP_FRAMES
      ) {
        raw.push({
          t: f / FPS,
          team,
          midi: TEAM_MIDI[team],
          pan: panFromScreenX(accX[team] / accCells[team]),
          cells: accCells[team],
        });
        accCells[team] = 0;
        accX[team] = 0;
        lastEmit[team] = f;
        lastAny = f;
      }
    }
  }
  // the structural gap already holds the cap; thinEvents is the formal guard (a hair above the cap so a
  // 3-frame spacing, which rounds to 0.04999 s, is not thrown away)
  const captures = thinEvents(raw, CAPTURE_RATE_CAP + 1);

  const clackRaw: { t: number; pan: number; power: number }[] = [];
  const wallRaw: { t: number; pan: number }[] = [];
  for (let i = 0; i < trace.bounceFrame.length; i++) {
    const t = trace.bounceFrame[i] / FPS;
    const pan = panFromScreenX(trace.bounceX[i]);
    if (trace.bounceKind[i] === 0) clackRaw.push({ t, pan, power: trace.bouncePower[i] });
    else wallRaw.push({ t, pan });
  }

  const underdogs = TICK_FRAMES.map((frame, i) => ({
    t: frame / FPS,
    team: trace.tickTeam[i],
    midi: TEAM_MIDI[trace.tickTeam[i]],
  }));
  const beats = BEAT_MIDI.map((midi, step) => ({ t: (CLOCK_ZERO_FRAME - 180 + 60 * step) / FPS, midi }));
  const endT = CLOCK_ZERO_FRAME / FPS;
  return {
    captures,
    clacks: thinEvents(clackRaw, CLACK_RATE_CAP),
    walls: thinEvents(wallRaw, WALL_RATE_CAP),
    underdogs,
    beats,
    end: { t: endT, team: trace.winner, riserStart: endT - 1.5, midis: END_CHORDS[trace.winner] },
  };
}

/** A slow, steady bed: four soft chords, each fading into the next with matching ramps so the level never dips. */
const PAD_CHORDS: readonly (readonly number[])[] = [
  [48, 55, 62, 64], // C add9
  [45, 52, 60, 67], // A minor 7
  [41, 48, 57, 64], // F major 7
  [43, 50, 59, 62], // G
];
const PAD_STEP_SEC = 6;
const PAD_FADE_SEC = 1.5;

export function buildWarAudio(trace: WarTrace): HitAudio {
  const totalFrames = SCENE_FRAMES + HIT_CLOSING_FRAMES;
  const buf = newHitBuffer(totalFrames);
  const totalSec = totalFrames / FPS;
  const plan = planWarAudio(trace);

  // pad bed, to the last frame
  for (let k = 0; PAD_STEP_SEC * k < totalSec; k++) {
    const start = PAD_STEP_SEC * k;
    addSoftPad(buf, {
      startSec: start,
      durSec: Math.min(PAD_STEP_SEC + PAD_FADE_SEC, totalSec - start + PAD_FADE_SEC),
      freqs: PAD_CHORDS[k % PAD_CHORDS.length].map(noteHz),
      gain: 0.075,
      attackSec: k === 0 ? 0.35 : PAD_FADE_SEC,
      releaseSec: PAD_FADE_SEC,
    });
  }

  // capture ticks
  for (const e of plan.captures) {
    const weight = Math.min(1, Math.sqrt(e.cells / 90));
    addBell(buf, {
      t: e.t,
      freq: noteHz(e.midi),
      gain: 0.07 + 0.075 * weight,
      pan: e.pan,
      decay: 11,
      durSec: 0.32,
    });
  }

  // collisions: quiet, dry clicks so every visible bounce is heard without adding bright noise
  for (const c of plan.clacks) {
    addThud(buf, { t: c.t, gain: 0.16, pan: c.pan, hz: 150, durSec: 0.16 });
    addTick(buf, { t: c.t, gain: 0.1, pan: c.pan, hz: 420, durSec: 0.05 });
  }
  for (const w of plan.walls) addTick(buf, { t: w.t, gain: 0.07, pan: w.pan, hz: 300, durSec: 0.05 });

  // underdog: a whoosh that rises into a low thud on the exact frame, then the colour's own note
  plan.underdogs.forEach((u, i) => {
    addWhoosh(buf, { t: u.t - 0.4, durSec: 1.0, gain: 0.2, fromHz: 250, toHz: 1300, seed: 31 + i });
    addThud(buf, { t: u.t, gain: 0.5, hz: 78, durSec: 0.32 });
    addBell(buf, { t: u.t + 0.04, freq: noteHz(u.midi + 12), gain: 0.2, decay: 5, durSec: 0.9 });
    addBell(buf, { t: u.t + 0.16, freq: noteHz(u.midi + 19), gain: 0.14, decay: 5, durSec: 0.8 });
  });

  // the last 3 s: one soft beat per clock second, the pitch climbing
  for (const b of plan.beats) {
    addThud(buf, { t: b.t, gain: 0.28, hz: 70, durSec: 0.22 });
    addBell(buf, { t: b.t, freq: noteHz(b.midi), gain: 0.17, decay: 6, durSec: 0.6 });
  }

  // the end: a riser, then the winner's chord, ringing into the closing card
  addRiser(buf, { t: plan.end.riserStart, durSec: plan.end.t - plan.end.riserStart, gain: 0.1, fromHz: 180, toHz: 900 });
  addThud(buf, { t: plan.end.t, gain: 0.5, hz: 62, durSec: 0.5 });
  plan.end.midis.forEach((midi, i) => {
    addBell(buf, { t: plan.end.t + i * 0.035, freq: noteHz(midi), gain: 0.15, decay: 1.5, durSec: 3.6 });
  });

  return finishHitAudio(buf);
}
