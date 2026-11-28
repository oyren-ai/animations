import { clamp, clamp01, hash01, lerp, lowerBound, smoothstep } from "../midi/kit.ts";
import type { MidiNote } from "../midi/types.ts";

/** Framing-standard stage bounds: x = 50..1030 (width 980, centred on 540), y = 290..1590 (centred on 940). */
export const STAGE = {
  left: 50,
  right: 1030,
  top: 290,
  hudBottom: 366,
  frameLeft: 66,
  frameRight: 1014,
  upperBarTop: 556,
  upperBarBottom: 752,
  lowerBarTop: 778,
  lowerBarBottom: 1064,
  resonatorTop: 1076,
  resonatorBottom: 1554,
  bottom: 1590,
} as const;

export const MARIMBA_LOW_PITCH = 43; // G2
export const MARIMBA_HIGH_PITCH = 83; // B5

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

export interface MarimbaBar {
  index: number;
  pitch: number;
  label: string;
  accidental: boolean;
  /** Horizontal centre of the rosewood bar (px). */
  x: number;
  /** Bar width (px). */
  width: number;
  /** Top and bottom Y of the rosewood bar (tapers shorter toward treble). */
  topY: number;
  bottomY: number;
  /** Vertical strike target Y (centre of the beating zone). */
  strikeY: number;
  /** Resonator tube bottom Y (graduated longer for bass, shorter for treble). */
  resonatorBottomY: number;
  /** Normalized position 0 (bass) -> 1 (treble). */
  u: number;
  hue: number;
}

export interface MarimbaStrike {
  index: number;
  note: MidiNote;
  barIndex: number;
  pitch: number;
  x: number;
  y: number;
  tOn: number;
  vel01: number;
  /** 0 = L1 bass, 1 = L2 harmony, 2 = R1 melody-A, 3 = R2 melody-B. */
  mallet: number;
  hue: number;
  seed: number;
}

export interface MalletSpec {
  id: number;
  hand: "left" | "right";
  pivotX: number;
  pivotY: number;
  restX: number;
  restY: number;
  headColor: string;
  glowHue: number;
}

export const MALLETS: readonly MalletSpec[] = [
  { id: 0, hand: "left", pivotX: 256, pivotY: 1476, restX: 280, restY: 942, headColor: "#fbbf24", glowHue: 42 },
  { id: 1, hand: "left", pivotX: 374, pivotY: 1488, restX: 432, restY: 932, headColor: "#38bdf8", glowHue: 198 },
  { id: 2, hand: "right", pivotX: 706, pivotY: 1488, restX: 648, restY: 922, headColor: "#c8ff00", glowHue: 74 },
  { id: 3, hand: "right", pivotX: 824, pivotY: 1476, restX: 800, restY: 912, headColor: "#eef6fc", glowHue: 165 },
];

export interface MarimbaPlan {
  bars: readonly MarimbaBar[];
  naturalBars: readonly MarimbaBar[];
  accidentalBars: readonly MarimbaBar[];
  strikes: readonly MarimbaStrike[];
  byBar: readonly (readonly MarimbaStrike[])[];
  byMallet: readonly (readonly MarimbaStrike[])[];
  barByPitch: ReadonlyMap<number, number>;
}

/**
 * Build the physical two-tier concert rosewood marimba (G2..B5: 24 natural bars on the lower rank
 * and 17 chromatic accidental bars on the upper rank, strictly centred on x = 540) and assign every
 * marimba MIDI note (tracks 1..3; excludes the subtle resonator sub-bass reinforcement on track 4)
 * to one of the four animated Stevens-grip mallets.
 */
export function buildMarimbaPlan(notes: readonly MidiNote[]): MarimbaPlan {
  const naturalPitches: number[] = [];
  for (let p = MARIMBA_LOW_PITCH; p <= MARIMBA_HIGH_PITCH; p++) {
    if (!isAccidentalPitch(p)) naturalPitches.push(p);
  }

  // Natural bar deck: exact symmetry on x = 540 (left = 88, right = 992 -> mid = 540.0).
  const deckLeft = 88;
  const deckRight = 992;
  const slotW = (deckRight - deckLeft) / naturalPitches.length;
  const natWidth = slotW * 0.82;
  const accWidth = slotW * 0.68;

  const naturalXByPitch = new Map<number, number>();
  const bars: MarimbaBar[] = [];
  const barByPitch = new Map<number, number>();

  naturalPitches.forEach((pitch, idx) => {
    const u = naturalPitches.length > 1 ? idx / (naturalPitches.length - 1) : 0.5;
    const x = deckLeft + (idx + 0.5) * slotW;
    naturalXByPitch.set(pitch, x);

    // Physical concert marimba taper: bass bars longer, treble bars shorter, aligned cleanly near the waist.
    const barLen = lerp(274, 178, u);
    const topY = STAGE.lowerBarTop + lerp(0, 48, u);
    const bottomY = topY + barLen;
    const resonatorLen = lerp(452, 168, Math.pow(u, 0.88));
    const bar: MarimbaBar = {
      index: bars.length,
      pitch,
      label: pitchName(pitch),
      accidental: false,
      x,
      width: natWidth,
      topY,
      bottomY,
      strikeY: lerp(topY, bottomY, 0.52),
      resonatorBottomY: STAGE.resonatorTop + resonatorLen,
      u,
      hue: lerp(34, 82, u),
    };
    barByPitch.set(pitch, bar.index);
    bars.push(bar);
  });

  for (let p = MARIMBA_LOW_PITCH; p <= MARIMBA_HIGH_PITCH; p++) {
    if (!isAccidentalPitch(p)) continue;
    const leftNat = naturalXByPitch.get(p - 1);
    const rightNat = naturalXByPitch.get(p + 1);
    if (leftNat === undefined || rightNat === undefined) continue;
    const x = 0.5 * (leftNat + rightNat);
    const u = (p - MARIMBA_LOW_PITCH) / (MARIMBA_HIGH_PITCH - MARIMBA_LOW_PITCH);
    const barLen = lerp(194, 134, u);
    const bottomY = STAGE.upperBarBottom;
    const topY = bottomY - barLen;
    const resonatorLen = lerp(375, 138, Math.pow(u, 0.88));
    const bar: MarimbaBar = {
      index: bars.length,
      pitch: p,
      label: pitchName(p),
      accidental: true,
      x,
      width: accWidth,
      topY,
      bottomY,
      strikeY: lerp(topY, bottomY, 0.56),
      resonatorBottomY: STAGE.resonatorTop + resonatorLen,
      u,
      hue: lerp(28, 76, u),
    };
    barByPitch.set(p, bar.index);
    bars.push(bar);
  }

  const findBar = (pitch: number): number => {
    const exact = barByPitch.get(pitch);
    if (exact !== undefined) return exact;
    let best = 0;
    let bestDist = Infinity;
    for (const b of bars) {
      const d = Math.abs(b.pitch - pitch);
      if (d < bestDist) {
        best = b.index;
        bestDist = d;
      }
    }
    return best;
  };

  // Visual strikes come from the actual marimba bar tracks (channel 0..2 / program 12; ignore channel 3 sub-bass pad).
  const marimbaNotes = notes.filter((n) => n.channel !== 3 && n.channel !== 9);
  const lastTimeByMallet = [-10, -10, -10, -10];
  const lastXByMallet = MALLETS.map((m) => m.restX);

  const strikes: MarimbaStrike[] = marimbaNotes.map((note, index) => {
    const barIndex = findBar(note.pitch);
    const bar = bars[barIndex];
    // Assign right-hand pair [2, 3] for melody (track 1 / channel 0 or high pitches >= 66),
    // and left-hand pair [0, 1] for bass & inner harmony.
    const rightHand = note.channel === 0 || (note.channel !== 2 && note.pitch >= 67);
    const pair: readonly [number, number] = rightHand ? [2, 3] : [0, 1];
    const [mA, mB] = pair;
    const dtA = note.timeSec - lastTimeByMallet[mA];
    const dtB = note.timeSec - lastTimeByMallet[mB];
    let mallet: number;
    if (dtA < 0.04 && dtB < 0.04) {
      // Chord thicker than 2 notes on one hand: borrow the freest mallet on the opposite hand (4-mallet chord voicing).
      const alt: readonly [number, number] = rightHand ? [1, 0] : [2, 3];
      const dtAlt0 = note.timeSec - lastTimeByMallet[alt[0]];
      const dtAlt1 = note.timeSec - lastTimeByMallet[alt[1]];
      mallet = dtAlt0 >= dtAlt1 ? alt[0] : alt[1];
    } else if (dtA < 0.08 && dtB >= 0.08) {
      mallet = mB;
    } else if (dtB < 0.08 && dtA >= 0.08) {
      mallet = mA;
    } else {
      // Natural Stevens-grip alternation: keep left-side mallet (mA) on the left of right-side mallet (mB) so shafts stay uncrossed.
      const crossPenaltyA = bar.x > lastXByMallet[mB] + 8 ? 500 : 0;
      const crossPenaltyB = bar.x < lastXByMallet[mA] - 8 ? 500 : 0;
      const scoreA = dtA * 220 - Math.abs(bar.x - lastXByMallet[mA]) * 0.45 - crossPenaltyA;
      const scoreB = dtB * 220 - Math.abs(bar.x - lastXByMallet[mB]) * 0.45 - crossPenaltyB;
      mallet = scoreA >= scoreB ? mA : mB;
    }
    lastTimeByMallet[mallet] = note.timeSec;
    lastXByMallet[mallet] = bar.x;

    return {
      index,
      note,
      barIndex,
      pitch: bar.pitch,
      x: bar.x,
      y: bar.strikeY,
      tOn: note.timeSec,
      vel01: clamp01(note.velocity / 127),
      mallet,
      hue: MALLETS[mallet].glowHue,
      seed: index * 7919 + 31,
    };
  });

  const byBar = bars.map((_, i) => strikes.filter((s) => s.barIndex === i));
  const byMallet = MALLETS.map((_, m) => strikes.filter((s) => s.mallet === m));

  return {
    bars,
    naturalBars: bars.filter((b) => !b.accidental),
    accidentalBars: bars.filter((b) => b.accidental),
    strikes,
    byBar,
    byMallet,
    barByPitch,
  };
}

export interface BarMotion {
  /** Vertical flex offset in px when struck. */
  dipY: number;
  /** 0..1 glowing bar excitation. */
  glow: number;
  /** Seconds since most recent strike (-1 if idle). */
  age: number;
  /** 0..1 resonator acoustic pulse strength. */
  resonatorPulse: number;
  /** Accent hue of the striking mallet. */
  hue: number;
  vel01: number;
}

export function barMotionAt(barStrikes: readonly MarimbaStrike[], t: number): BarMotion {
  let dipY = 0;
  let glow = 0;
  let age = -1;
  let resonatorPulse = 0;
  let hue = 74;
  let vel01 = 0;

  let lo = 0;
  let hi = barStrikes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (barStrikes[mid].tOn < t - 1.5) lo = mid + 1;
    else hi = mid;
  }

  for (let i = Math.max(0, lo - 1); i < barStrikes.length; i++) {
    const s = barStrikes[i];
    const dt = t - s.tOn;
    if (dt < -1e-6) break;
    if (dt <= 1.45) {
      const amp = 0.55 + 0.45 * s.vel01;
      const flex = Math.exp(-dt / 0.14) * Math.cos(2 * Math.PI * 18 * dt) * 4.8 * amp;
      dipY += flex;
      const g = Math.exp(-dt / 0.44) * amp + 0.5 * Math.exp(-dt / 0.08);
      if (g >= glow) {
        glow = g;
        age = dt;
        hue = s.hue;
        vel01 = s.vel01;
      }
      const res = Math.exp(-dt / 0.52) * amp;
      if (res > resonatorPulse) resonatorPulse = res;
    }
  }

  return {
    dipY: clamp(dipY, -5, 6.5),
    glow: clamp01(glow),
    age,
    resonatorPulse: clamp01(resonatorPulse),
    hue,
    vel01,
  };
}

export interface MalletPose {
  headX: number;
  headY: number;
  /** 0 = touching the rosewood bar, 1 = high in wind-up arc. */
  lift: number;
  /** 0..1 strike impact flash right at t = tOn. */
  impact: number;
}

/**
 * Pure deterministic parabolic arc trajectory for one mallet: winds up before each strike,
 * lands cleanly at exact (strike.x, strike.y) with lift = 0 at t = strike.tOn, recoils cleanly,
 * and glides back to rest during the closing loop tail.
 */
export function malletPoseAt(
  spec: MalletSpec,
  strikes: readonly MarimbaStrike[],
  t: number,
  endSec: number,
  tailSec: number,
): MalletPose {
  if (strikes.length === 0) {
    return { headX: spec.restX, headY: spec.restY, lift: 0.45, impact: 0 };
  }

  // Binary search first strike with tOn > t
  let lo = 0;
  let hi = strikes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strikes[mid].tOn <= t) lo = mid + 1;
    else hi = mid;
  }

  const prev = lo > 0 ? strikes[lo - 1] : null;
  const next = lo < strikes.length ? strikes[lo] : null;

  // Before first strike: smoothly lift from rest and whip down onto first bar
  if (!prev && next) {
    const lead = 0.65;
    const u = clamp01((t - (next.tOn - lead)) / lead);
    const ease = smoothstep(0, 1, u);
    const headX = lerp(spec.restX, next.x, ease);
    const headY = lerp(spec.restY, next.y, ease);
    // Lift peaks around u = 0.58 then whips straight down to 0 at u = 1
    const lift = u < 0.01 ? 0.45 : lerp(0.45, 0.92, Math.sin(Math.PI * u)) * (1 - smoothstep(0.75, 1.0, u));
    return { headX, headY, lift: clamp01(lift), impact: 0 };
  }

  // After final strike: crisp recoil then smooth glide back to resting poise for seamless loop
  if (prev && !next) {
    const age = t - prev.tOn;
    const impact = Math.exp(-age / 0.065);
    const recoil = clamp01(age / 0.22) * 0.45;
    const returnU = smoothstep(endSec + 0.35, endSec + Math.max(1.2, tailSec - 0.15), t);
    return {
      headX: lerp(prev.x, spec.restX, returnU),
      headY: lerp(prev.y, spec.restY, returnU),
      lift: lerp(recoil, 0.45, returnU),
      impact: clamp01(impact),
    };
  }

  // Between two strikes prev -> next
  if (prev && next) {
    const span = Math.max(0.06, next.tOn - prev.tOn);
    const u = clamp01((t - prev.tOn) / span);
    const age = t - prev.tOn;
    const impact = Math.exp(-age / 0.065);

    // If long pause (> 1.4 s), settle gently near midpoint then wind up cleanly over the final 0.55 s
    if (span > 1.4) {
      const moveStart = next.tOn - 0.58;
      if (t < moveStart) {
        const settleU = smoothstep(0, 0.35, age);
        const holdX = lerp(prev.x, spec.restX, 0.35 * settleU);
        const holdY = lerp(prev.y, spec.restY, 0.35 * settleU);
        const lift = 0.42 * settleU;
        return { headX: holdX, headY: holdY, lift, impact: clamp01(impact) };
      }
      const w = clamp01((t - moveStart) / 0.58);
      const startX = lerp(prev.x, spec.restX, 0.35);
      const startY = lerp(prev.y, spec.restY, 0.35);
      const headX = lerp(startX, next.x, smoothstep(0, 1, w));
      const headY = lerp(startY, next.y, smoothstep(0, 1, w));
      const lift = (0.42 + 0.52 * Math.sin(Math.PI * w)) * (1 - smoothstep(0.76, 1.0, w));
      return { headX, headY, lift: clamp01(lift), impact: clamp01(impact) };
    }

    const headX = lerp(prev.x, next.x, smoothstep(0.05, 0.96, u));
    const headY = lerp(prev.y, next.y, smoothstep(0.05, 0.96, u));
    const arcHeight = clamp(0.32 + span * 0.65, 0.32, 0.95);
    const lift = arcHeight * Math.sin(Math.PI * u);
    return { headX, headY, lift: clamp01(lift), impact: clamp01(impact) };
  }

  return { headX: spec.restX, headY: spec.restY, lift: 0.45, impact: 0 };
}

export function marimbaProgressAt(t: number, endSec: number, tailSec: number): number {
  if (t <= 0 || endSec <= 0) return 0;
  const play = clamp01(t / endSec);
  const reset = smoothstep(endSec + 0.6, endSec + Math.max(1.2, tailSec - 0.15), t);
  return clamp01(play * (1 - reset));
}

export function struckCountAt(strikes: readonly MarimbaStrike[], t: number, endSec: number, tailSec: number): number {
  if (t < 0) return 0;
  let lo = 0;
  let hi = strikes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strikes[mid].tOn <= t + 1e-6) lo = mid + 1;
    else hi = mid;
  }
  const reset = smoothstep(endSec + 0.6, endSec + Math.max(1.2, tailSec - 0.15), t);
  return Math.round(lo * (1 - reset));
}

export function marimbaSparkAt(
  ev: MarimbaStrike,
  k: number,
  age: number,
): { x: number; y: number; size: number; alpha: number } | null {
  const life = 0.28 + 0.32 * hash01(ev.seed, k * 5 + 1);
  if (age < 0 || age > life) return null;
  const angle = -Math.PI / 2 + (hash01(ev.seed, k * 5 + 2) - 0.5) * 1.9;
  const speed = (110 + 250 * hash01(ev.seed, k * 5 + 3)) * (0.65 + 0.45 * ev.vel01);
  const drag = 2.8;
  const dec = (1 - Math.exp(-drag * age)) / drag;
  const x = ev.x + Math.cos(angle) * speed * dec;
  const y = ev.y + Math.sin(angle) * speed * dec + 220 * age * age;
  const fade = 1 - age / life;
  return { x, y, size: 2.8 + 3.6 * hash01(ev.seed, k * 5 + 4), alpha: fade * fade };
}

export function firstStrikeIndexAfter(strikes: readonly MarimbaStrike[], t: number): number {
  return lowerBound(strikes.map((s) => s.note), t);
}
