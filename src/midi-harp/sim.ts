import { clamp, clamp01, hash01, lerp, lowerBound, smoothstep } from "../midi/kit.ts";
import type { MidiNote } from "../midi/types.ts";

/** Framing-standard stage bounds: x = 50..1030 (width 980, centred on 540), y = 290..1590 (centred on 940). */
export const STAGE = {
  left: 50,
  right: 1030,
  top: 290,
  hudBottom: 366,
  frameLeft: 86,
  frameRight: 994,
  pillarX: 118,
  pillarTopY: 404,
  pedestalY: 1524,
  stringLeftX: 160,
  stringRightX: 920,
  bottom: 1590,
} as const;

export const HARP_LOW_PITCH = 40;  // E2
export const HARP_HIGH_PITCH = 88; // E6

/** E-major diatonic pitch classes: E(4), F#(6), G#(8), A(9), B(11), C#(1), D#(3). */
const E_MAJOR_PCS = new Set([1, 3, 4, 6, 8, 9, 11]);
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function isEMajorPitch(pitch: number): boolean {
  return E_MAJOR_PCS.has(((pitch % 12) + 12) % 12);
}

export function pitchName(pitch: number): string {
  const pc = ((pitch % 12) + 12) % 12;
  const oct = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[pc]}${oct}`;
}

export type HarpStringColorRole = "red-c" | "blue-f" | "wire-bass" | "gut-pearl";

export interface HarpString {
  index: number;
  pitch: number;
  label: string;
  role: HarpStringColorRole;
  /** Vertical string X coordinate (29 strings spanning 160..920, symmetric on x = 540). */
  x: number;
  /** Top attachment Y along the S-curved harmonic neck (with tuning pin & brass action disc). */
  topY: number;
  /** Bottom eyelet Y along the angled Sitka-spruce soundboard rib. */
  botY: number;
  /** Plucking contact Y along the natural diagonal hand line (~54% down the string). */
  pluckY: number;
  /** Normalized pitch 0 (E2 bass) -> 1 (E6 treble). */
  u: number;
  /** Visual transverse standing-wave frequency in Hz. */
  vibHz: number;
  /** Base glow hue when plucked (crimson C#, cyan F#, chartreuse/gold gut). */
  hue: number;
}

export interface HarpPluck {
  index: number;
  note: MidiNote;
  stringIndex: number;
  pitch: number;
  x: number;
  y: number;
  tOn: number;
  vel01: number;
  /** 0 = L-Bass, 1 = L-Mid, 2 = R-Mid, 3 = R-Treble. */
  finger: number;
  /** Pull direction: left hand pulls slightly left (-1), right hand pulls slightly right (+1). */
  pullDir: -1 | 1;
  hue: number;
  seed: number;
}

export interface FingerSpec {
  id: number;
  hand: "left" | "right";
  knuckleX: number;
  knuckleY: number;
  restX: number;
  restY: number;
  accentColor: string;
  glowHue: number;
}

export const FINGERS: readonly FingerSpec[] = [
  { id: 0, hand: "left", knuckleX: 186, knuckleY: 1456, restX: 258, restY: 1110, accentColor: "#fbbf24", glowHue: 42 },
  { id: 1, hand: "left", knuckleX: 332, knuckleY: 1384, restX: 432, restY: 1020, accentColor: "#38bdf8", glowHue: 198 },
  { id: 2, hand: "right", knuckleX: 748, knuckleY: 1184, restX: 648, restY: 940, accentColor: "#c8ff00", glowHue: 74 },
  { id: 3, hand: "right", knuckleX: 894, knuckleY: 1114, restX: 822, restY: 882, accentColor: "#eef6fc", glowHue: 165 },
];

export interface HarpPlan {
  strings: readonly HarpString[];
  plucks: readonly HarpPluck[];
  byString: readonly (readonly HarpPluck[])[];
  byFinger: readonly (readonly HarpPluck[])[];
  stringByPitch: ReadonlyMap<number, number>;
}

/**
 * S-curved harmonic neck profile `topY(u)` for u in [0..1] (E2 longest bass -> E6 shortest treble).
 * Iconic concert pedal harp arch: tall golden crown at bass pillar, graceful concave dip in upper mid,
 * sweeping smoothly into the shoulder knee.
 */
export function harmonicNeckY(u: number): number {
  const linear = lerp(432, 668, Math.pow(u, 0.92));
  const sCurve = -42 * Math.sin(Math.PI * Math.pow(u, 0.85)) + 26 * Math.sin(Math.PI * 2 * u);
  return linear + sCurve;
}

/** Angled Sitka-spruce soundboard rib `botY(u)` rising smoothly from pedestal to right shoulder knee. */
export function soundboardRibY(u: number): number {
  return lerp(1456, 1084, u);
}

/**
 * Build the 29-string E-major concert pedal harp (E2 = 40 .. E6 = 88):
 * - Authentic concert harp string colour-coding: red C# strings, blue F# strings, gold bass & pearl gut strings.
 * - Symmetric string span (160..920, centred on x = 540).
 * - Every note in Vivaldi's Spring maps 1-to-1 to its exact physical string and a collision-free plucking finger.
 */
export function buildHarpPlan(notes: readonly MidiNote[]): HarpPlan {
  const pitches: number[] = [];
  for (let p = HARP_LOW_PITCH; p <= HARP_HIGH_PITCH; p++) {
    if (isEMajorPitch(p)) pitches.push(p);
  }

  const strings: HarpString[] = [];
  const stringByPitch = new Map<number, number>();
  const count = pitches.length; // 29 strings

  pitches.forEach((pitch, idx) => {
    const u = idx / (count - 1);
    const pc = ((pitch % 12) + 12) % 12;
    const role: HarpStringColorRole =
      pc === 1 ? "red-c"
      : pc === 6 ? "blue-f"
      : idx < 8 ? "wire-bass"
      : "gut-pearl";

    const x = lerp(STAGE.stringLeftX, STAGE.stringRightX, u);
    const topY = harmonicNeckY(u);
    const botY = soundboardRibY(u);
    const pluckY = lerp(topY, botY, lerp(0.55, 0.52, u));
    const hue =
      role === "red-c" ? 356
      : role === "blue-f" ? 198
      : lerp(42, 78, u);

    const s: HarpString = {
      index: idx,
      pitch,
      label: pitchName(pitch),
      role,
      x,
      topY,
      botY,
      pluckY,
      u,
      vibHz: lerp(13, 28, u),
      hue,
    };
    stringByPitch.set(pitch, idx);
    strings.push(s);
  });

  // Helper: snap any chromatic note (if custom MIDI is passed) to nearest diatonic harp string
  const findStringIndex = (pitch: number): number => {
    const exact = stringByPitch.get(pitch);
    if (exact !== undefined) return exact;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (const s of strings) {
      const d = Math.abs(s.pitch - pitch);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = s.index;
      }
    }
    return bestIdx;
  };

  const sorted = [...notes].sort((a, b) => a.timeSec - b.timeSec || a.pitch - b.pitch);
  const byStringMut: HarpPluck[][] = strings.map(() => []);
  const byFingerMut: HarpPluck[][] = FINGERS.map(() => []);
  const plucks: HarpPluck[] = [];

  const lastFingerTime = [-10, -10, -10, -10];
  const lastFingerX = FINGERS.map((f) => f.restX);

  for (const n of sorted) {
    const clampedPitch = clamp(Math.round(n.pitch), HARP_LOW_PITCH, HARP_HIGH_PITCH);
    const stringIndex = findStringIndex(clampedPitch);
    const s = strings[stringIndex];

    // Bass/lower-mid strings prefer left-hand fingers [0, 1]; upper-mid/treble prefer right-hand fingers [2, 3].
    // Fall back to all 4 fingers if both preferred fingers are busy within 30 ms so chords never collide!
    const preferred: readonly number[] =
      s.index < 13 ? [0, 1]
      : s.index > 15 ? [2, 3]
      : [1, 2];
    const hasFreePreferred = preferred.some((c) => n.timeSec - lastFingerTime[c] >= 0.03);
    const candidates: readonly number[] = hasFreePreferred ? preferred : [0, 1, 2, 3];

    let chosen = candidates[0];
    let bestScore = Infinity;
    for (const c of candidates) {
      const dt = n.timeSec - lastFingerTime[c];
      const travel = Math.abs(s.x - lastFingerX[c]) / 260;
      const busyPenalty = dt < 0.03 ? 50 : dt < 0.09 ? 10 : dt < 0.16 ? 2.5 : 0;
      const handPenalty = preferred.includes(c) ? 0 : 1.2;
      const sideBias =
        (c === 0 && s.x < 340) || (c === 3 && s.x > 740)
          ? -0.35
          : (c === 1 && s.x >= 340) || (c === 2 && s.x <= 740)
            ? -0.35
            : 0.15;
      const score = busyPenalty + handPenalty + travel + sideBias;
      if (score < bestScore) {
        bestScore = score;
        chosen = c;
      }
    }

    lastFingerTime[chosen] = n.timeSec;
    lastFingerX[chosen] = s.x;

    const pluck: HarpPluck = {
      index: plucks.length,
      note: n,
      stringIndex,
      pitch: s.pitch,
      x: s.x,
      y: s.pluckY,
      tOn: n.timeSec,
      vel01: clamp01(n.velocity / 127),
      finger: chosen,
      pullDir: chosen < 2 ? -1 : 1,
      hue: s.hue,
      seed: hash01(plucks.length, s.pitch),
    };
    plucks.push(pluck);
    byStringMut[stringIndex].push(pluck);
    byFingerMut[chosen].push(pluck);
  }

  return {
    strings,
    plucks,
    byString: byStringMut,
    byFinger: byFingerMut,
    stringByPitch,
  };
}

export interface HarpStringMotion {
  /** Signed pre-pluck sideways deflection in px right before tOn as the finger pulls the string. */
  preloadPx: number;
  /** Signed post-pluck fundamental standing-wave displacement in px right after tOn. */
  oscPx: number;
  /** Signed second-harmonic overtone ripple in px for realistic harp string shimmer. */
  overtonePx: number;
  /** Instantaneous vibration envelope 0..1. */
  vibEnv: number;
  /** Luminous string glow 0..1 after release. */
  glow: number;
  /** Seconds since most recent pluck release (Infinity if none). */
  age: number;
}

export const PRELOAD_SEC = 0.085;

/** Pure physical harp string state at piece time `t`: pre-pluck triangular kink -> snapped standing wave. */
export function harpStringMotionAt(
  s: HarpString,
  stringPlucks: readonly HarpPluck[],
  t: number,
): HarpStringMotion {
  if (stringPlucks.length === 0) {
    return { preloadPx: 0, oscPx: 0, overtonePx: 0, vibEnv: 0, glow: 0, age: Infinity };
  }

  // First pluck with tOn > t
  let lo = 0;
  let hi = stringPlucks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (stringPlucks[mid].tOn <= t) lo = mid + 1;
    else hi = mid;
  }

  let preloadPx = 0;
  if (lo < stringPlucks.length) {
    const next = stringPlucks[lo];
    const dtToOn = next.tOn - t;
    if (dtToOn > 0 && dtToOn <= PRELOAD_SEC) {
      const load = smoothstep(PRELOAD_SEC, 0, dtToOn);
      preloadPx = next.pullDir * load * (8.5 + 4.5 * next.vel01);
    }
  }

  let oscPx = 0;
  let overtonePx = 0;
  let vibEnv = 0;
  let glow = 0;
  let bestAge = Infinity;

  if (lo > 0) {
    const prev = stringPlucks[lo - 1];
    const age = t - prev.tOn;
    if (age >= 0 && age < 2.2) {
      bestAge = age;
      const tau = lerp(0.82, 0.42, s.u);
      const env = Math.exp(-age / tau) * (0.64 + 0.36 * prev.vel01);
      const amp = lerp(11.5, 6.2, s.u);
      oscPx = prev.pullDir * Math.cos(age * s.vibHz * Math.PI * 2) * env * amp;
      overtonePx = prev.pullDir * Math.sin(age * s.vibHz * 2 * Math.PI * 2) * Math.exp(-age / (tau * 0.55)) * amp * 0.3;
      vibEnv = clamp01(env);
      glow = clamp01(Math.exp(-age / 0.42) * (0.68 + 0.32 * prev.vel01));
    }
  }

  return { preloadPx, oscPx, overtonePx, vibEnv, glow, age: bestAge };
}

export interface FingerPose {
  tipX: number;
  tipY: number;
  /** 0 = contacting string at exact tOn, 1 = hovered free while travelling between strings. */
  lift: number;
  /** 0..1 release follow-through intensity right after pluck. */
  flick: number;
  active: boolean;
}

/**
 * Pure deterministic kinematics for one articulated plucking finger:
 * glides smoothly onto the next string, pulls it sideways during `PRELOAD_SEC`,
 * sits cleanly at `(pluck.x, pluck.y)` with `lift = 0` at exact `t = tOn`, then follows through cleanly.
 */
export function fingerPoseAt(
  spec: FingerSpec,
  fingerPlucks: readonly HarpPluck[],
  t: number,
  endSec: number,
  tailSec: number,
): FingerPose {
  if (fingerPlucks.length === 0) {
    return { tipX: spec.restX, tipY: spec.restY, lift: 1, flick: 0, active: false };
  }

  let lo = 0;
  let hi = fingerPlucks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fingerPlucks[mid].tOn <= t) lo = mid + 1;
    else hi = mid;
  }

  const prev = lo > 0 ? fingerPlucks[lo - 1] : null;
  const next = lo < fingerPlucks.length ? fingerPlucks[lo] : null;

  if (!prev && next) {
    const approachStart = next.tOn - 0.55;
    if (t <= approachStart) {
      return { tipX: spec.restX, tipY: spec.restY, lift: 1, flick: 0, active: false };
    }
    const u = smoothstep(approachStart, next.tOn, t);
    const load = smoothstep(next.tOn - PRELOAD_SEC, next.tOn, t) * (1 - smoothstep(0.985, 1, u));
    return {
      tipX: lerp(spec.restX, next.x, u) + next.pullDir * load * 9,
      tipY: lerp(spec.restY, next.y, u),
      lift: 1 - smoothstep(0.55, 0.96, u),
      flick: 0,
      active: true,
    };
  }

  if (prev && !next) {
    const age = t - prev.tOn;
    if (age <= 1e-4) {
      return { tipX: prev.x, tipY: prev.y, lift: 0, flick: 1, active: true };
    }
    const flick = Math.exp(-age / 0.085);
    const returnStart = Math.max(prev.tOn + 0.16, endSec + 0.25);
    const returnEnd = endSec + Math.max(0.9, tailSec - 0.35);
    if (t <= returnStart) {
      const follow = smoothstep(0, 0.06, age) * 15 * prev.pullDir;
      return {
        tipX: prev.x + follow * (1 - smoothstep(0.08, 0.25, age)),
        tipY: prev.y,
        lift: smoothstep(0.02, 0.14, age) * 0.85,
        flick,
        active: age < 0.35,
      };
    }
    const u = smoothstep(returnStart, returnEnd, t);
    return {
      tipX: lerp(prev.x, spec.restX, u),
      tipY: lerp(prev.y, spec.restY, u),
      lift: lerp(0.85, 1, u),
      flick: 0,
      active: u < 0.95,
    };
  }

  const p = prev!;
  const q = next!;
  const span = Math.max(1e-4, q.tOn - p.tOn);
  const agePrev = t - p.tOn;
  if (agePrev <= 1e-4) {
    return { tipX: p.x, tipY: p.y, lift: 0, flick: 1, active: true };
  }
  const u = clamp01(agePrev / span);
  const flick = Math.exp(-agePrev / 0.075);

  const moveStart = Math.min(0.24, 0.055 / span);
  const moveEnd = Math.max(moveStart + 0.05, 1 - Math.min(0.28, PRELOAD_SEC / span));
  const glide = smoothstep(moveStart, moveEnd, u);
  const arcLift = Math.sin(glide * Math.PI);
  const preload = smoothstep(Math.max(0.5, 1 - PRELOAD_SEC / span), 1, u) * (1 - smoothstep(0.985, 1.0, u));
  const snapSide = Math.sin(clamp01(agePrev / 0.07) * Math.PI) * 11 * p.pullDir;

  const tipX = lerp(p.x, q.x, glide) + snapSide + preload * 8 * q.pullDir;
  const tipY = lerp(p.y, q.y, glide) - arcLift * 20;
  const lift = u >= 1 - 1e-4 ? 0 : clamp01(arcLift * 0.95);

  return { tipX, tipY, lift, flick, active: true };
}

/** Count of harp plucks fired up to piece time `t`. */
export function pluckedCountAt(plucks: readonly HarpPluck[], t: number): number {
  let lo = 0;
  let hi = plucks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (plucks[mid].tOn <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Soundboard acoustic resonance 0..1 driven by recent plucks. */
export function soundboardEnergyAt(plucks: readonly HarpPluck[], t: number): number {
  const idx = pluckedCountAt(plucks, t);
  let sum = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const age = t - plucks[i].tOn;
    if (age > 0.85) break;
    sum += (0.55 + 0.45 * plucks[i].vel01) * Math.exp(-age / 0.28);
  }
  return clamp01(sum / 2.6);
}

/** Seamless loop progress 0..1 (resets cleanly to 0 during final 0.5 s tail). */
export function harpProgressAt(t: number, endSec: number, tailSec: number): number {
  if (t <= 0 || endSec <= 0) return 0;
  if (t <= endSec) return clamp01(t / endSec);
  const resetStart = endSec + Math.max(0.35, tailSec - 0.5);
  const resetEnd = endSec + tailSec - 0.04;
  if (t <= resetStart) return 1;
  return 1 - smoothstep(resetStart, resetEnd, t);
}

export function harpSectionLabelAt(t: number, endSec: number): string {
  const frac = endSec > 0 ? clamp01(t / endSec) : 0;
  if (frac < 0.24) return "RITORNELLO · FORTE";
  if (frac < 0.46) return "RITORNELLO · ECHO";
  if (frac < 0.62) return "BIRDSONG TRILLS";
  if (frac < 0.82) return "MURMURING BROOK";
  return "SPRING FINALE";
}

export { lowerBound };
