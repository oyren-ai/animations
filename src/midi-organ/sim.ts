import { clamp, clamp01, hash01, lerp, lowerBound, smoothstep } from "../midi/kit.ts";
import type { MidiNote } from "../midi/types.ts";

/** Framing-standard stage bounds: x = 50..1030 (width 980, centred on 540), y = 290..1590 (centred on 940). */
export const STAGE = {
  left: 50,
  right: 1030,
  top: 290,
  hudBottom: 366,
  caseLeft: 66,
  caseRight: 1014,
  pipesTop: 406,
  windchestTop: 1042,
  windchestBottom: 1098,
  rollerTop: 1106,
  rollerBottom: 1322,
  manualTop: 1334,
  manualBottom: 1564,
  bottom: 1590,
} as const;

export const ORGAN_LOW_PITCH = 38;  // D2
export const ORGAN_HIGH_PITCH = 82; // Bb5 (covers full BWV 565 Toccata Bars 1..30)

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const ACCIDENTAL_PCS = new Set([1, 3, 6, 8, 10]);

export function isAccidentalPitch(pitch: number): boolean {
  return ACCIDENTAL_PCS.has(((pitch % 12) + 12) % 12);
}

export function pitchName(pitch: number): string {
  const pc = ((pitch % 12) + 12) % 12;
  const oct = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[pc]}${oct}`;
}

export interface OrganPipe {
  index: number;
  pitch: number;
  label: string;
  accidental: boolean;
  /** Pipe facade position (symmetric C-side left / C#-side right cathedral facade). */
  pipeX: number;
  pipeWidth: number;
  pipeTopY: number;
  mouthY: number;
  footY: number;
  /** Manual key position (standard left-to-right chromatic keyboard at bottom console). */
  keyX: number;
  keyWidth: number;
  keyBottomY: number;
  /** Horizontal rollerboard channel Y connecting key tracker rod to pipe pallet valve. */
  rollerY: number;
  /** Normalized pitch 0 (D2 bass) -> 1 (A5 treble). */
  u: number;
  hue: number;
}

export interface PipeEvent {
  index: number;
  note: MidiNote;
  pipeIndex: number;
  pitch: number;
  tOn: number;
  tOff: number;
  vel01: number;
  hue: number;
  seed: number;
}

export interface OrganPlan {
  pipes: readonly OrganPipe[];
  naturalPipes: readonly OrganPipe[];
  accidentalPipes: readonly OrganPipe[];
  events: readonly PipeEvent[];
  byPipe: readonly (readonly PipeEvent[])[];
  pipeByPitch: ReadonlyMap<number, number>;
}

/**
 * Build the 44-pipe cathedral mechanical tracker organ (D2 = 38 .. A5 = 81):
 * - Upper symmetric facade: bass towers on outer left & right sweeping down into center treble arch.
 * - Middle exposed rollerboard: horizontal tracker arms mapping each keyboard key to its exact pipe.
 * - Lower 44-key chromatic organ manual: 26 ivory natural keys + 18 ebony sharp keys centred on x = 540.
 */
export function buildOrganPlan(notes: readonly MidiNote[]): OrganPlan {
  const totalPipes = ORGAN_HIGH_PITCH - ORGAN_LOW_PITCH + 1; // 44
  const naturalPitches: number[] = [];
  for (let p = ORGAN_LOW_PITCH; p <= ORGAN_HIGH_PITCH; p++) {
    if (!isAccidentalPitch(p)) naturalPitches.push(p);
  }

  // Symmetric 26-natural-key manual deck spanning x = 84..996 (mid = 540.0).
  const keyDeckLeft = 84;
  const keyDeckRight = 996;
  const natSlotW = (keyDeckRight - keyDeckLeft) / naturalPitches.length;
  const natKeyW = natSlotW * 0.9;
  const accKeyW = natSlotW * 0.58;

  const naturalKeyX = new Map<number, number>();
  naturalPitches.forEach((pitch, idx) => {
    naturalKeyX.set(pitch, keyDeckLeft + (idx + 0.5) * natSlotW);
  });

  // Symmetric Baroque cathedral facade ordering (C-side left, C#-side right):
  // slot 0..21 on left wing, slot 22..43 on right wing (mirrored about x = 540).
  const facadeLeft = 90;
  const facadeRight = 990;
  const pipeSlotW = (facadeRight - facadeLeft) / totalPipes;

  const pipes: OrganPipe[] = [];
  const pipeByPitch = new Map<number, number>();

  for (let i = 0; i < totalPipes; i++) {
    const pitch = ORGAN_LOW_PITCH + i;
    const u = i / Math.max(1, totalPipes - 1);
    const acc = isAccidentalPitch(pitch);

    // Alternating left-tower / right-tower inward placement for authentic cathedral symmetry:
    // even i -> left wing (0, 1, 2, ... 21), odd i -> right wing mirrored (43, 42, ... 22).
    const pairIdx = Math.floor(i / 2);
    const slot = i % 2 === 0 ? pairIdx : totalPipes - 1 - pairIdx;
    const pipeX = facadeLeft + (slot + 0.5) * pipeSlotW;

    // Classic cathedral M-arch tower profile: tall bass towers on flanks, gentle central crown rise.
    const distFromEdge = Math.min(slot, totalPipes - 1 - slot) / (totalPipes / 2 - 0.5); // 0 edge -> 1 center
    const centerCrown = Math.exp(-Math.pow((distFromEdge - 1) / 0.24, 2)) * 58;
    const bodyHeight = lerp(525, 228, Math.pow(distFromEdge, 0.72)) + centerCrown;
    const footY = STAGE.windchestTop;
    const mouthY = footY - lerp(84, 52, u);
    const pipeTopY = Math.max(STAGE.pipesTop + 6, mouthY - bodyHeight);
    const pipeWidth = lerp(pipeSlotW * 0.84, pipeSlotW * 0.64, u);

    // Keyboard X coordinate
    let keyX: number;
    if (!acc) {
      keyX = naturalKeyX.get(pitch)!;
    } else {
      const loX = naturalKeyX.get(pitch - 1) ?? keyDeckLeft;
      const hiX = naturalKeyX.get(pitch + 1) ?? keyDeckRight;
      keyX = (loX + hiX) * 0.5;
    }

    // Dedicated horizontal rollerboard lane so no two roller bars overlap vertically.
    const rollerY = lerp(STAGE.rollerTop + 14, STAGE.rollerBottom - 14, (i + 0.5) / totalPipes);

    const pipe: OrganPipe = {
      index: i,
      pitch,
      label: pitchName(pitch),
      accidental: acc,
      pipeX,
      pipeWidth,
      pipeTopY,
      mouthY,
      footY,
      keyX,
      keyWidth: acc ? accKeyW : natKeyW,
      keyBottomY: acc ? STAGE.manualTop + 136 : STAGE.manualBottom,
      rollerY,
      u,
      hue: lerp(34, 78, u), // warm burnished gold in pedal bass -> luminous Oyren lime-gold in treble
    };
    pipeByPitch.set(pitch, i);
    pipes.push(pipe);
  }

  const naturalPipes = pipes.filter((p) => !p.accidental);
  const accidentalPipes = pipes.filter((p) => p.accidental);

  const sorted = [...notes].sort((a, b) => a.timeSec - b.timeSec || a.pitch - b.pitch);
  const byPipeMut: PipeEvent[][] = pipes.map(() => []);
  const events: PipeEvent[] = [];

  for (const n of sorted) {
    const clampedPitch = clamp(Math.round(n.pitch), ORGAN_LOW_PITCH, ORGAN_HIGH_PITCH);
    const pipeIndex = pipeByPitch.get(clampedPitch);
    if (pipeIndex === undefined) continue;
    const pipe = pipes[pipeIndex];
    const tOn = n.timeSec;
    const tOff = tOn + Math.max(0.08, n.durationSec);
    const ev: PipeEvent = {
      index: events.length,
      note: n,
      pipeIndex,
      pitch: pipe.pitch,
      tOn,
      tOff,
      vel01: clamp01(n.velocity / 127),
      hue: pipe.hue,
      seed: hash01(events.length, pipe.pitch),
    };
    events.push(ev);
    byPipeMut[pipeIndex].push(ev);
  }

  return {
    pipes,
    naturalPipes,
    accidentalPipes,
    events,
    byPipe: byPipeMut,
    pipeByPitch,
  };
}

export interface PipeState {
  /** 0..1 key depression & mechanical tracker pull (1 while held, smooth 45 ms return on release). */
  keyDown: number;
  /** 0..1 pallet valve opening angle (tracks keyDown with crisp pneumatic valve snap). */
  palletOpen: number;
  /** 0..1 speaking wind-column & lip-vibration intensity (sustains while held + brief cathedral glow). */
  speaking: number;
  /** 0..1 sharp onset chiff pulse right at note-on for acoustic shockwave ring at the pipe mouth. */
  onsetBurst: number;
  /** Seconds since most recent onset (Infinity if none yet). */
  age: number;
  /** Velocity of the active / most recent note on this pipe. */
  vel01: number;
}

/** Pure mechanical & acoustic state of one pipe + its linked key/tracker/pallet at piece time `t`. */
export function pipeStateAt(pipeEvents: readonly PipeEvent[], t: number): PipeState {
  if (pipeEvents.length === 0) {
    return { keyDown: 0, palletOpen: 0, speaking: 0, onsetBurst: 0, age: Infinity, vel01: 0 };
  }

  // Binary search for last event starting at or before t + tiny anticipation window (0.015 s).
  let lo = 0;
  let hi = pipeEvents.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pipeEvents[mid].tOn <= t + 0.015) lo = mid + 1;
    else hi = mid;
  }

  let keyDown = 0;
  let speaking = 0;
  let onsetBurst = 0;
  let bestAge = Infinity;
  let vel01 = 0;

  // Check last few overlapping/recent notes on this pipe.
  for (let i = Math.max(0, lo - 4); i < lo; i++) {
    const ev = pipeEvents[i];
    const age = t - ev.tOn;
    if (age < -0.015) continue;

    // Key visibly begins depressing 15 ms before note-on and locks fully down at age = 0.
    let k: number;
    if (age < 0) {
      k = smoothstep(-0.015, 0, age) * 0.45;
    } else if (t <= ev.tOff) {
      k = 1;
    } else {
      const rel = t - ev.tOff;
      if (rel > 0.42) continue;
      k = Math.max(0, 1 - smoothstep(0, 0.065, rel));
    }

    // Wind column speaks crisply at note-on while held, then decays cleanly over 260 ms after pallet shuts.
    let sp = 0;
    if (age >= 0) {
      if (t <= ev.tOff) {
        const attack = 0.74 + 0.26 * smoothstep(0, 0.022, age);
        sp = attack * (0.72 + 0.28 * ev.vel01);
      } else {
        const rel = t - ev.tOff;
        sp = Math.exp(-rel / 0.14) * (0.72 + 0.28 * ev.vel01);
      }
      const burst = Math.exp(-age / 0.14) * (0.55 + 0.45 * ev.vel01);
      if (burst > onsetBurst) onsetBurst = burst;
      if (age < bestAge) bestAge = age;
    }

    if (k > keyDown) {
      keyDown = k;
      vel01 = Math.max(vel01, ev.vel01);
    }
    if (sp > speaking) {
      speaking = sp;
      vel01 = Math.max(vel01, ev.vel01);
    }
  }

  return {
    keyDown: clamp01(keyDown),
    palletOpen: clamp01(keyDown > 0.02 ? smoothstep(0.05, 0.85, keyDown) : 0),
    speaking: clamp01(speaking),
    onsetBurst: clamp01(onsetBurst),
    age: bestAge,
    vel01,
  };
}

/** Count of pipe actuations fired up to piece time `t`. */
export function soundedCountAt(events: readonly PipeEvent[], t: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].tOn <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Seamless loop progress 0..1 (resets cleanly to 0 during the final 0.55 s tail). */
export function organProgressAt(t: number, endSec: number, tailSec: number): number {
  if (t <= 0 || endSec <= 0) return 0;
  if (t <= endSec) return clamp01(t / endSec);
  const resetStart = endSec + Math.max(0.4, tailSec - 0.55);
  const resetEnd = endSec + tailSec - 0.04;
  if (t <= resetStart) return 1;
  return 1 - smoothstep(resetStart, resetEnd, t);
}

/** Current musical movement label for the right HUD indicator. */
export function organSectionLabelAt(t: number, endSec: number): string {
  const frac = endSec > 0 ? clamp01(t / endSec) : 0;
  if (frac < 0.22) return "ADAGIO · D MINOR";
  if (frac < 0.36) return "PEDAL BLOOM";
  if (frac < 0.78) return "PRESTISSIMO";
  return "FULL ORGAN";
}

/** Helper used by paint/tests to find active recent events near `t`. */
export function recentPipeEventsAt(events: readonly PipeEvent[], t: number, windowSec = 0.6): PipeEvent[] {
  const endIdx = soundedCountAt(events, t);
  const out: PipeEvent[] = [];
  for (let i = endIdx - 1; i >= 0; i--) {
    const ev = events[i];
    if (t - ev.tOff > windowSec && t - ev.tOn > windowSec) break;
    out.push(ev);
  }
  return out;
}

// Re-export lowerBound so callers stay consistent with sibling scenes.
export { lowerBound };
