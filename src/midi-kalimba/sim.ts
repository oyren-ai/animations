import { clamp, clamp01, hash01, lerp, lowerBound, smoothstep } from "../midi/kit.ts";
import type { MidiNote } from "../midi/types.ts";

/** Framing-standard stage bounds: x = 50..1030 (width 980, centred on 540), y = 290..1590 (centred on 940). */
export const STAGE = {
  left: 50,
  right: 1030,
  top: 290,
  hudBottom: 366,
  bodyLeft: 84,
  bodyRight: 996,
  bodyTop: 398,
  bodyBottom: 1562,
  upperBarY: 454,
  upperBridgeY: 488,
  mainBarY: 676,
  mainBridgeY: 716,
  soundholeX: 540,
  soundholeY: 1326,
  soundholeR: 130,
  bottom: 1590,
} as const;

export const KALIMBA_LOW_PITCH = 52;  // E3
export const KALIMBA_HIGH_PITCH = 83; // B5

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

export interface KalimbaTine {
  index: number;
  pitch: number;
  label: string;
  accidental: boolean;
  /** Center X of the spring-steel tine (symmetric alternating V-fan about x = 540). */
  x: number;
  width: number;
  /** Y where the tine emerges from its saddle bridge. */
  bridgeY: number;
  /** Resting free-tip Y of the tine (longest bass tine at center, shorter treble tines on wings). */
  tipY: number;
  /** Plucking contact point Y just inside the rounded bent tip. */
  pluckY: number;
  /** Normalized pitch 0 (E3 bass) -> 1 (B5 treble). */
  u: number;
  /** Visual cantilever vibration frequency in Hz (lower tines slower, treble tines shimmer faster). */
  vibHz: number;
  hue: number;
}

export interface KalimbaPluck {
  index: number;
  note: MidiNote;
  tineIndex: number;
  pitch: number;
  x: number;
  y: number;
  tOn: number;
  vel01: number;
  /** 0 = L-Outer, 1 = L-Inner, 2 = R-Inner, 3 = R-Outer. */
  thumb: number;
  hue: number;
  seed: number;
}

export interface ThumbSpec {
  id: number;
  hand: "left" | "right";
  pivotX: number;
  pivotY: number;
  restX: number;
  restY: number;
  pickColor: string;
  glowHue: number;
}

export const THUMBS: readonly ThumbSpec[] = [
  { id: 0, hand: "left", pivotX: 164, pivotY: 1512, restX: 280, restY: 980, pickColor: "#fbbf24", glowHue: 42 },
  { id: 1, hand: "left", pivotX: 316, pivotY: 1528, restX: 438, restY: 1090, pickColor: "#38bdf8", glowHue: 198 },
  { id: 2, hand: "right", pivotX: 764, pivotY: 1528, restX: 642, restY: 1090, pickColor: "#c8ff00", glowHue: 74 },
  { id: 3, hand: "right", pivotX: 916, pivotY: 1512, restX: 800, restY: 980, pickColor: "#eef6fc", glowHue: 165 },
];

export interface KalimbaPlan {
  tines: readonly KalimbaTine[];
  naturalTines: readonly KalimbaTine[];
  accidentalTines: readonly KalimbaTine[];
  plucks: readonly KalimbaPluck[];
  byTine: readonly (readonly KalimbaPluck[])[];
  byThumb: readonly (readonly KalimbaPluck[])[];
  tineByPitch: ReadonlyMap<number, number>;
}

/**
 * Symmetric alternating Kalimba V-fan index offset from center (0, -1, +1, -2, +2, ...).
 */
function alternatingOffset(rankIdx: number): number {
  if (rankIdx === 0) return 0;
  const k = Math.ceil(rankIdx / 2);
  return rankIdx % 2 === 1 ? -k : k;
}

/**
 * Build the 32-tine two-tier chromatic mahogany concert kalimba (E3 = 52 .. B5 = 83):
 * - Lower diatonic rank: 19 natural spring-steel tines in classic symmetric alternating V-fan centred on x = 540.
 * - Upper chromatic rank: 13 sharp/flat spring-steel tines mounted on the raised upper brass bar centred on x = 540.
 * Every single note in the score maps 1-to-1 to an exact physical tine and one of the four plucking thumbs.
 */
export function buildKalimbaPlan(notes: readonly MidiNote[]): KalimbaPlan {
  const naturalPitches: number[] = [];
  const accidentalPitches: number[] = [];
  for (let p = KALIMBA_LOW_PITCH; p <= KALIMBA_HIGH_PITCH; p++) {
    if (isAccidentalPitch(p)) accidentalPitches.push(p);
    else naturalPitches.push(p);
  }

  const tines: KalimbaTine[] = [];
  const tineByPitch = new Map<number, number>();
  const totalSpan = KALIMBA_HIGH_PITCH - KALIMBA_LOW_PITCH;

  // Lower natural rank: 19 tines, slot offsets -9..+9, step 43.5 px -> spans 540 ± 391.5 (148.5 .. 931.5)
  const natStep = 43.5;
  naturalPitches.forEach((pitch, rankIdx) => {
    const off = alternatingOffset(rankIdx);
    const absNorm = Math.abs(off) / 9; // 0 center (longest bass) -> 1 outer wings (shortest treble)
    const u = (pitch - KALIMBA_LOW_PITCH) / totalSpan;
    const x = 540 + off * natStep;
    const tipY = lerp(1148, 868, Math.pow(absNorm, 0.88));
    const tine: KalimbaTine = {
      index: tines.length,
      pitch,
      label: pitchName(pitch),
      accidental: false,
      x,
      width: lerp(33, 27, absNorm),
      bridgeY: STAGE.mainBridgeY,
      tipY,
      pluckY: tipY - 14,
      u,
      vibHz: lerp(15, 29, u),
      hue: lerp(36, 78, u),
    };
    tineByPitch.set(pitch, tine.index);
    tines.push(tine);
  });

  // Upper chromatic rank: 13 tines, slot offsets -6..+6, step 58 px -> spans 540 ± 348 (192 .. 888)
  const accStep = 58;
  accidentalPitches.forEach((pitch, rankIdx) => {
    const off = alternatingOffset(rankIdx);
    const absNorm = Math.abs(off) / 6;
    const u = (pitch - KALIMBA_LOW_PITCH) / totalSpan;
    const x = 540 + off * accStep;
    const tipY = lerp(642, 566, Math.pow(absNorm, 0.86));
    const tine: KalimbaTine = {
      index: tines.length,
      pitch,
      label: pitchName(pitch),
      accidental: true,
      x,
      width: lerp(31, 25, absNorm),
      bridgeY: STAGE.upperBridgeY,
      tipY,
      pluckY: tipY - 12,
      u,
      vibHz: lerp(17, 31, u),
      hue: lerp(42, 84, u),
    };
    tineByPitch.set(pitch, tine.index);
    tines.push(tine);
  });

  // Assign every MIDI note deterministically to its exact tine and one of the four articulated plucking thumbs.
  const sorted = [...notes].sort((a, b) => a.timeSec - b.timeSec || a.pitch - b.pitch);
  const byTineMut: KalimbaPluck[][] = tines.map(() => []);
  const byThumbMut: KalimbaPluck[][] = THUMBS.map(() => []);
  const plucks: KalimbaPluck[] = [];

  const lastThumbTime = [-10, -10, -10, -10];
  const lastThumbX = THUMBS.map((th) => th.restX);

  for (const n of sorted) {
    const clampedPitch = clamp(Math.round(n.pitch), KALIMBA_LOW_PITCH, KALIMBA_HIGH_PITCH);
    const tineIndex = tineByPitch.get(clampedPitch);
    if (tineIndex === undefined) continue;
    const tine = tines[tineIndex];

    // Left-of-center tines prefer left-hand thumbs (0, 1); right-of-center prefer right-hand thumbs (2, 3);
    // dead-center tines prefer inner thumbs (1, 2). If all preferred thumbs are busy at the exact same instant,
    // allow any free thumb so no single thumb is ever asked to strike two different tines simultaneously.
    const preferred: readonly number[] =
      tine.x < 536 ? [0, 1]
      : tine.x > 544 ? [2, 3]
      : [1, 2];
    const hasFreePreferred = preferred.some((c) => n.timeSec - lastThumbTime[c] >= 0.03);
    const candidates: readonly number[] = hasFreePreferred ? preferred : [0, 1, 2, 3];

    let chosen = candidates[0];
    let bestScore = Infinity;
    for (const c of candidates) {
      const dt = n.timeSec - lastThumbTime[c];
      const travel = Math.abs(tine.x - lastThumbX[c]) / 260;
      const busyPenalty = dt < 0.03 ? 50 : dt < 0.09 ? 10 : dt < 0.16 ? 2.5 : 0;
      const handPenalty = preferred.includes(c) ? 0 : 1.2;
      // Prefer outer thumb for outer wing tines, inner thumb for center tines
      const sideBias =
        (c === 0 && tine.x < 340) || (c === 3 && tine.x > 740)
          ? -0.35
          : (c === 1 && tine.x >= 340) || (c === 2 && tine.x <= 740)
            ? -0.35
            : 0.15;
      const score = busyPenalty + handPenalty + travel + sideBias;
      if (score < bestScore) {
        bestScore = score;
        chosen = c;
      }
    }

    lastThumbTime[chosen] = n.timeSec;
    lastThumbX[chosen] = tine.x;

    const pluck: KalimbaPluck = {
      index: plucks.length,
      note: n,
      tineIndex,
      pitch: tine.pitch,
      x: tine.x,
      y: tine.pluckY,
      tOn: n.timeSec,
      vel01: clamp01(n.velocity / 127),
      thumb: chosen,
      hue: tine.hue,
      seed: hash01(plucks.length, tine.pitch),
    };
    plucks.push(pluck);
    byTineMut[tineIndex].push(pluck);
    byThumbMut[chosen].push(pluck);
  }

  return {
    tines,
    naturalTines: tines.filter((t) => !t.accidental),
    accidentalTines: tines.filter((t) => t.accidental),
    plucks,
    byTine: byTineMut,
    byThumb: byThumbMut,
    tineByPitch,
  };
}

export interface TineMotion {
  /** Pre-pluck downward tension flex in px (0..13 px right before tOn as the thumb loads the tine). */
  preloadPx: number;
  /** Post-pluck damped cantilever oscillation displacement in px (oscillates right after tOn). */
  oscPx: number;
  /** Instantaneous vibration envelope 0..1 for specular tip blur and acoustic soundhole energy. */
  vibEnv: number;
  /** Metallic glow intensity 0..1 after pluck release. */
  glow: number;
  /** Seconds since most recent pluck release (Infinity if none). */
  age: number;
}

const PRELOAD_SEC = 0.085;

/** Pure physical tine cantilever state at piece time `t` (pre-pluck thumb bend -> snap release oscillation). */
export function tineMotionAt(tine: KalimbaTine, tinePlucks: readonly KalimbaPluck[], t: number): TineMotion {
  if (tinePlucks.length === 0) {
    return { preloadPx: 0, oscPx: 0, vibEnv: 0, glow: 0, age: Infinity };
  }

  // First pluck with tOn > t (upcoming pluck for pre-pluck thumb loading!)
  let lo = 0;
  let hi = tinePlucks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tinePlucks[mid].tOn <= t) lo = mid + 1;
    else hi = mid;
  }

  let preloadPx = 0;
  if (lo < tinePlucks.length) {
    const next = tinePlucks[lo];
    const dtToOn = next.tOn - t;
    if (dtToOn > 0 && dtToOn <= PRELOAD_SEC) {
      const load = smoothstep(PRELOAD_SEC, 0, dtToOn);
      preloadPx = load * (9 + 4.5 * next.vel01);
    }
  }

  let oscPx = 0;
  let vibEnv = 0;
  let glow = 0;
  let bestAge = Infinity;

  if (lo > 0) {
    const prev = tinePlucks[lo - 1];
    const age = t - prev.tOn;
    if (age >= 0 && age < 1.8) {
      bestAge = age;
      const tau = lerp(0.55, 0.34, tine.u);
      const env = Math.exp(-age / tau) * (0.62 + 0.38 * prev.vel01);
      // Starts deflected downward and springs rapidly upward at t = tOn!
      oscPx = Math.cos(age * tine.vibHz * Math.PI * 2) * env * 11;
      vibEnv = clamp01(env);
      glow = clamp01(Math.exp(-age / 0.36) * (0.65 + 0.35 * prev.vel01));
    }
  }

  return { preloadPx, oscPx, vibEnv, glow, age: bestAge };
}

export interface ThumbPose {
  tipX: number;
  tipY: number;
  /** 0 = pressed on tine tip (at tOn), 1 = lifted hovering between tines. */
  lift: number;
  /** 0..1 flick/snap intensity right after note-on. */
  flick: number;
  /** True when the thumb is actively approaching or plucking a note. */
  active: boolean;
}

/**
 * Pure deterministic kinematics for one articulated plucking thumb:
 * glides smoothly from previous tine to next tine, presses down onto the tine tip before `tOn`,
 * lands at `(pluck.x, pluck.y)` with `lift = 0` at `t = tOn`, then snaps cleanly off the tip!
 */
export function thumbPoseAt(
  spec: ThumbSpec,
  thumbPlucks: readonly KalimbaPluck[],
  t: number,
  endSec: number,
  tailSec: number,
): ThumbPose {
  if (thumbPlucks.length === 0) {
    return { tipX: spec.restX, tipY: spec.restY, lift: 1, flick: 0, active: false };
  }

  // Find first pluck with tOn > t
  let lo = 0;
  let hi = thumbPlucks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (thumbPlucks[mid].tOn <= t) lo = mid + 1;
    else hi = mid;
  }

  const prev = lo > 0 ? thumbPlucks[lo - 1] : null;
  const next = lo < thumbPlucks.length ? thumbPlucks[lo] : null;

  // Before the first pluck: smooth glide from rest position onto the first tine tip
  if (!prev && next) {
    const approachStart = next.tOn - 0.55;
    if (t <= approachStart) {
      return { tipX: spec.restX, tipY: spec.restY, lift: 1, flick: 0, active: false };
    }
    const u = smoothstep(approachStart, next.tOn, t);
    const load = smoothstep(next.tOn - PRELOAD_SEC, next.tOn, t);
    return {
      tipX: lerp(spec.restX, next.x, u),
      tipY: lerp(spec.restY, next.y, u) + load * 10,
      lift: 1 - smoothstep(0.55, 0.96, u),
      flick: 0,
      active: true,
    };
  }

  // After the final pluck: snap off, then glide smoothly home to rest before loop end
  if (prev && !next) {
    const age = t - prev.tOn;
    if (age <= 1e-4) {
      return { tipX: prev.x, tipY: prev.y, lift: 0, flick: 1, active: true };
    }
    const flick = Math.exp(-age / 0.085);
    const returnStart = Math.max(prev.tOn + 0.16, endSec + 0.25);
    const returnEnd = endSec + Math.max(0.9, tailSec - 0.35);
    if (t <= returnStart) {
      const snapDown = smoothstep(0, 0.06, age) * 16;
      return {
        tipX: prev.x,
        tipY: prev.y + snapDown * (1 - smoothstep(0.08, 0.25, age)),
        lift: smoothstep(0.02, 0.14, age) * 0.85,
        flick,
        active: age < 0.35,
      };
    }
    const u = smoothstep(returnStart, returnEnd, t);
    return {
      tipX: lerp(prev.x, spec.restX, u),
      tipY: lerp(prev.y + 10, spec.restY, u),
      lift: lerp(0.85, 1, u),
      flick: 0,
      active: u < 0.95,
    };
  }

  // Between prev and next plucks
  const p = prev!;
  const q = next!;
  const span = Math.max(1e-4, q.tOn - p.tOn);
  const agePrev = t - p.tOn;
  if (agePrev <= 1e-4) {
    return { tipX: p.x, tipY: p.y, lift: 0, flick: 1, active: true };
  }
  const u = clamp01(agePrev / span);
  const flick = Math.exp(-agePrev / 0.075);

  // Brief post-pluck flick clearance, then smooth arc glide to next tine, ending in pre-pluck contact
  const moveStart = Math.min(0.24, 0.055 / span);
  const moveEnd = Math.max(moveStart + 0.05, 1 - Math.min(0.28, PRELOAD_SEC / span));
  const glide = smoothstep(moveStart, moveEnd, u);
  const arcLift = Math.sin(glide * Math.PI);
  const preload = smoothstep(Math.max(0.5, 1 - PRELOAD_SEC / span), 1, u) * (1 - smoothstep(0.98, 1.0, u));

  const snapOffset = Math.sin(clamp01(agePrev / 0.07) * Math.PI) * 12;
  const tipX = lerp(p.x, q.x, glide);
  const tipY = lerp(p.y, q.y, glide) - arcLift * 22 + snapOffset + preload * 8;
  const lift = u >= 1 - 1e-4 ? 0 : clamp01(arcLift * 0.95);

  return { tipX, tipY, lift, flick, active: true };
}

/** Count of kalimba plucks fired up to piece time `t`. */
export function pluckedCountAt(plucks: readonly KalimbaPluck[], t: number): number {
  let lo = 0;
  let hi = plucks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (plucks[mid].tOn <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Soundhole acoustic energy 0..1 driven by recent plucks. */
export function soundholeEnergyAt(plucks: readonly KalimbaPluck[], t: number): number {
  const idx = pluckedCountAt(plucks, t);
  let sum = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const age = t - plucks[i].tOn;
    if (age > 0.7) break;
    sum += (0.55 + 0.45 * plucks[i].vel01) * Math.exp(-age / 0.22);
  }
  return clamp01(sum / 2.2);
}

/** Seamless loop progress 0..1 (resets cleanly to 0 during the final 0.5 s tail). */
export function kalimbaProgressAt(t: number, endSec: number, tailSec: number): number {
  if (t <= 0 || endSec <= 0) return 0;
  if (t <= endSec) return clamp01(t / endSec);
  const resetStart = endSec + Math.max(0.35, tailSec - 0.5);
  const resetEnd = endSec + tailSec - 0.04;
  if (t <= resetStart) return 1;
  return 1 - smoothstep(resetStart, resetEnd, t);
}

export function kalimbaSectionLabelAt(t: number, endSec: number): string {
  const frac = endSec > 0 ? clamp01(t / endSec) : 0;
  if (frac < 0.36) return "E MINOR · THEME A";
  if (frac < 0.65) return "CHROMATIC FILIGREE";
  if (frac < 0.92) return "RECAPITULATION";
  return "FINALE";
}

export { lowerBound };
