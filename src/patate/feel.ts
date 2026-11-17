// Pacing and feel for the Patate Merge compositions.
// Owner note: "these la patate videos can be slowed down and we can make la patates squishy and bouncy".
// Pure constants and math with no Node imports, so the sim, the painter and the tests share one source of truth.

/** Sub-steps the 240 Hz solver takes in one 60 fps frame of the original 24 s version. The solver itself never changes. */
export const PATATE_SOLVER_SUBSTEPS_PER_FRAME = 4;

/**
 * The one pacing knob.
 *
 * The merge ladder is chaotic: across 17 nudged combinations of gravity, bounce and drop spacing (51 composition
 * runs) only 5 runs reached the boss merge and no combination worked for all three compositions. So the physics are
 * left alone and the pace changes instead: the same 240 Hz solver is stepped fewer times per video frame. Every
 * potato, merge and bounce is exactly where it was, just reached later on screen, so the chain is identical.
 * Keep this an integer; a fraction would change the solver step and break the chain.
 *
 *   4 sub-steps per frame = the original 24 s video.
 *   3 sub-steps per frame = motion 25% slower, scene 1680 frames, video 1860 frames = 31 s.
 */
export const PATATE_PACE = {
  substepsPerFrame: 3,
} as const;

/** Video frames per solver frame (4/3 at 3 sub-steps). Lengths and effect lifetimes are scaled by this. */
export const PATATE_FRAME_STRETCH = PATATE_SOLVER_SUBSTEPS_PER_FRAME / PATATE_PACE.substepsPerFrame;
/** Solver frames per video frame (0.75 at 3 sub-steps). Motion in sim time per video time. */
export const PATATE_TIME_SCALE = PATATE_PACE.substepsPerFrame / PATATE_SOLVER_SUBSTEPS_PER_FRAME;

/** Volume-preserving squash-and-stretch. All "log" amounts are natural-log scale factors. Timing follows the pace. */
export const PATATE_SQUASH = {
  /** Contacts slower than this (px/s) leave no mark. */
  minImpactSpeed: 90,
  /** Contact speed (px/s) that reaches the full squash. */
  fullImpactSpeed: 900,
  /** Largest squash from one impact: along the contact it scales by exp(-u), across it by exp(+u). */
  maxLogSquash: 0.3,
  /** Cap for several impacts landing on one potato at once. */
  maxTotalLogSquash: 0.36,
  /** Spring frequency in Hz (3.2 Hz at the original pace). */
  frequencyHz: 3.2 * PATATE_TIME_SCALE,
  /** Spring decay rate in 1/s (5.0 at the original pace). */
  decayPerSecond: 5.0 * PATATE_TIME_SCALE,
  /** Frames after an impact before its spring is gone (48 at the original pace). */
  settleFrames: Math.round(48 * PATATE_FRAME_STRETCH),
  /** Frames over which the end of the spring is faded to exactly nothing (10 at the original pace). */
  taperFrames: Math.round(10 * PATATE_FRAME_STRETCH),
  /** Frames before a hit during which the potato stretches along its path (4 at the original pace). */
  anticipationFrames: Math.round(4 * PATATE_FRAME_STRETCH),
  /** Strength of that pre-impact stretch, as a share of the impact's own squash. */
  anticipationStretch: 0.35,
  /** Pop speed (px/s equivalent) of a freshly merged potato. */
  popSpeed: 800,
  /** How strongly neighbours shiver from a merge shockwave (blast kick times this). */
  popJiggleGain: 3,
} as const;

export type PatateImpactKind = "hit" | "pop";

/** One contact or merge shock on one potato. The deformation axis is the contact direction (nx, ny). */
export interface PatateImpact {
  readonly frame: number;
  readonly bodyId: number;
  /** "hit" is a contact the potato flew into (it stretches before it); "pop" is a merge shock (no anticipation). */
  readonly kind: PatateImpactKind;
  readonly nx: number;
  readonly ny: number;
  /** Approach speed in px/s, already scaled by this body's share of the collision (lighter potatoes squash more). */
  readonly speed: number;
}

/** A symmetric 2x2 matrix [[a, c], [b, d]] with determinant 1, applied in world space before the potato's own rotation. */
export interface Deformation {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

export const NO_DEFORMATION: Deformation = { a: 1, b: 0, c: 0, d: 1 };

const FPS = 60;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Log squash for one impact: zero below the minimum speed, linear up to the full speed, then capped. */
export function impactAmount(speed: number): number {
  const { minImpactSpeed, fullImpactSpeed, maxLogSquash } = PATATE_SQUASH;
  return maxLogSquash * clamp01((speed - minImpactSpeed) / (fullImpactSpeed - minImpactSpeed));
}

/** Unit spring after an impact: 1 at the hit, a rebound into a stretch, then a smooth fade to exactly 0. */
export function impactSpring(ageFrames: number): number {
  const { settleFrames, taperFrames, frequencyHz, decayPerSecond } = PATATE_SQUASH;
  if (ageFrames < 0 || ageFrames >= settleFrames) return 0;
  const seconds = ageFrames / FPS;
  const wave = Math.exp(-decayPerSecond * seconds) * Math.cos(2 * Math.PI * frequencyHz * seconds);
  const fadeStart = settleFrames - taperFrames;
  if (ageFrames <= fadeStart) return wave;
  const k = (settleFrames - ageFrames) / taperFrames;
  return wave * k * k * (3 - 2 * k);
}

/** Negative response (a stretch along the contact) in the frames just before a hit. */
function anticipation(ageFrames: number): number {
  const { anticipationFrames, anticipationStretch } = PATATE_SQUASH;
  if (ageFrames >= 0 || ageFrames < -anticipationFrames) return 0;
  return -anticipationStretch * (1 + ageFrames / anticipationFrames);
}

/**
 * The deformation of one potato at one frame, as a pure function of its impacts.
 * Each impact adds u * (I - 2nn^T), a traceless symmetric tensor, so the sum is traceless too and its matrix
 * exponential has determinant 1: the potato squashes along the contact, widens across it, and keeps its volume.
 */
export function bodyDeformation(impacts: readonly PatateImpact[] | undefined, frame: number): Deformation {
  if (!impacts || impacts.length === 0) return NO_DEFORMATION;
  const { anticipationFrames, settleFrames, maxTotalLogSquash } = PATATE_SQUASH;
  let p = 0;
  let q = 0;
  for (const impact of impacts) {
    const age = frame - impact.frame;
    if (age < -anticipationFrames || age >= settleFrames) continue;
    const amount = impactAmount(impact.speed);
    if (amount === 0) continue;
    const response = age >= 0 ? impactSpring(age) : impact.kind === "hit" ? anticipation(age) : 0;
    if (response === 0) continue;
    const doubleAngle = 2 * Math.atan2(impact.ny, impact.nx);
    p -= amount * response * Math.cos(doubleAngle);
    q -= amount * response * Math.sin(doubleAngle);
  }
  const magnitude = Math.hypot(p, q);
  if (magnitude < 1e-9) return NO_DEFORMATION;
  const capped = Math.min(magnitude, maxTotalLogSquash);
  p *= capped / magnitude;
  q *= capped / magnitude;
  const cosh = Math.cosh(capped);
  const sinhc = Math.sinh(capped) / capped;
  return { a: cosh + sinhc * p, b: sinhc * q, c: sinhc * q, d: cosh - sinhc * p };
}

const indexCache = new WeakMap<readonly PatateImpact[], ReadonlyMap<number, readonly PatateImpact[]>>();

/** Groups a trace's impacts by body id (cached per trace) so painting looks up only the impacts it needs. */
export function impactsByBody(impacts: readonly PatateImpact[]): ReadonlyMap<number, readonly PatateImpact[]> {
  const cached = indexCache.get(impacts);
  if (cached) return cached;
  const index = new Map<number, PatateImpact[]>();
  for (const impact of impacts) {
    const list = index.get(impact.bodyId);
    if (list) list.push(impact);
    else index.set(impact.bodyId, [impact]);
  }
  indexCache.set(impacts, index);
  return index;
}
