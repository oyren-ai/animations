import { clamp, clamp01, hash01, lerp, smoothstep } from "../midi/kit.ts";
import type { MidiNote } from "../midi/types.ts";

/**
 * Framing-standard stage bounds: 980 px wide (x = 50..1030, centred on x = 540),
 * y = 295..1645 (height 1350 px, vertical centre y = 970).
 */
export const STAGE = {
  left: 50,
  right: 1030,
  top: 295,
  hudBottom: 355,
  skyTop: 360,
  promenadeTop: 960,
  railingTop: 1318,
  walkwayTop: 1362,
  waterTop: 1416,
  bottom: 1645,
} as const;

export const LAMPLIGHTER_X = 540;
export const LAMPLIGHTER_FEET_Y = 1392;
export const SCROLL_SPEED = 148; // px / sec along the seaside promenade
export const POLE_REST_TIP_X = 568;
export const POLE_REST_TIP_Y = 1142;

export const LEAD_MIN_PITCH = 60; // C4
export const LEAD_MAX_PITCH = 82; // Bb5
export const LAMP_LOW_Y = 1148;   // low pitch lantern height
export const LAMP_HIGH_Y = 924;   // high pitch lantern height

export type BakuRole = "lead" | "chord" | "strings" | "bass" | "brush";

export interface SkylineWindow {
  index: number;
  buildingIdx: number;
  x: number;
  y: number;
  w: number;
  h: number;
  tier: number; // 0 = lower, 1 = middle, 2 = upper dome/cornice
}

export interface BuildingSpec {
  left: number;
  right: number;
  top: number;
  domeRadius: number;
  rows: number;
  cols: number;
}

/** 7 strictly symmetric terraced limestone buildings centred on x = 540 (total 96 arched windows). */
export const BUILDINGS: readonly BuildingSpec[] = [
  { left: 74,  right: 194, top: 690, domeRadius: 0,  rows: 4, cols: 3 }, // 12
  { left: 202, right: 326, top: 600, domeRadius: 26, rows: 5, cols: 3 }, // 15
  { left: 334, right: 458, top: 525, domeRadius: 0,  rows: 5, cols: 3 }, // 15
  { left: 466, right: 614, top: 458, domeRadius: 44, rows: 6, cols: 2 }, // 12 (central domed tower, midpoint 540!)
  { left: 622, right: 746, top: 525, domeRadius: 0,  rows: 5, cols: 3 }, // 15
  { left: 754, right: 878, top: 600, domeRadius: 26, rows: 5, cols: 3 }, // 15
  { left: 886, right: 1006, top: 690, domeRadius: 0, rows: 4, cols: 3 }, // 12 -> total = 96 windows!
];

export function buildSkylineWindows(): SkylineWindow[] {
  const out: SkylineWindow[] = [];
  BUILDINGS.forEach((b, bIdx) => {
    const bw = b.right - b.left;
    const bh = STAGE.promenadeTop - b.top;
    const marginX = 18;
    const marginTop = 26;
    const marginBot = 28;
    const cellW = (bw - marginX * 2) / b.cols;
    const cellH = (bh - marginTop - marginBot) / b.rows;
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        const cx = b.left + marginX + (c + 0.5) * cellW;
        const cy = b.top + marginTop + (r + 0.5) * cellH;
        const tier = r === 0 ? 2 : r < b.rows - 2 ? 1 : 0;
        out.push({
          index: out.length,
          buildingIdx: bIdx,
          x: cx,
          y: cy,
          w: Math.min(20, cellW * 0.56),
          h: Math.min(30, cellH * 0.62),
          tier,
        });
      }
    }
  });
  return out;
}

export function classifyBakuRole(note: MidiNote): BakuRole {
  if (note.channel === 9) return "brush";
  if (note.track === 1 || note.channel === 0) return "lead";
  if (note.track === 3 || note.channel === 2) return "strings";
  if (note.track === 4 || note.channel === 3 || note.pitch < 46) return "bass";
  return "chord";
}

export function lampHeightForPitch(pitch: number): number {
  const u = clamp01((pitch - LEAD_MIN_PITCH) / (LEAD_MAX_PITCH - LEAD_MIN_PITCH));
  return lerp(LAMP_LOW_Y, LAMP_HIGH_Y, u);
}

export function bassHarbourX(pitch: number): number {
  const u = clamp01((pitch - 36) / 18);
  return lerp(160, 920, u);
}

export interface BakuNoteEvent {
  index: number;
  note: MidiNote;
  role: BakuRole;
  pitch: number;
  pitchBendCents: number;
  /** Target x at onset (540 for lead lamps; window x for chord/strings; harbour x for bass). */
  x: number;
  /** Target y at onset (lantern y, window y, or water y). */
  y: number;
  windowIdx: number;
  vel01: number;
  hue: number;
  tOn: number;
  tOff: number;
  seed: number;
}

/** Build 1-to-1 physical visual events for every MIDI note in Baku Nights. */
export function buildBakuEvents(notes: readonly MidiNote[], windows: readonly SkylineWindow[]): BakuNoteEvent[] {
  let chordCounter = 0;
  let stringCounter = 0;
  const upperWindows = windows.filter((w) => w.tier >= 1);
  const poolUpper = upperWindows.length ? upperWindows : windows;

  return notes.map((note, index) => {
    const role = classifyBakuRole(note);
    const vel01 = clamp01(note.velocity / 127);
    const cents = note.pitchBendCents ?? 0;
    let x = LAMPLIGHTER_X;
    let y = LAMP_LOW_Y;
    let windowIdx = -1;
    let hue = 42;

    if (role === "lead") {
      x = LAMPLIGHTER_X;
      y = lampHeightForPitch(note.pitch);
      hue = lerp(38, 52, clamp01((note.pitch - LEAD_MIN_PITCH) / 22));
    } else if (role === "chord") {
      // Deterministic symmetric permutation across all 96 windows so the skyline fills evenly!
      const perm = (chordCounter * 37 + (note.pitch % 12) * 7) % windows.length;
      chordCounter++;
      const win = windows[perm];
      windowIdx = win.index;
      x = win.x;
      y = win.y;
      hue = 38 + (perm % 3) * 4;
    } else if (role === "strings") {
      const perm = (stringCounter * 19 + 5) % poolUpper.length;
      stringCounter++;
      const win = poolUpper[perm];
      windowIdx = win.index;
      x = win.x;
      y = win.y;
      hue = Math.abs(cents) > 10 ? 28 : 45; // warm saffron-amber for -20c Rast third inflection!
    } else if (role === "bass") {
      x = bassHarbourX(note.pitch);
      y = 1495 + ((index % 3) - 1) * 28;
      hue = 40;
    } else {
      // Night brush sea-breeze wavelet
      x = lerp(210, 870, hash01(index, 77));
      y = lerp(1442, 1605, hash01(index, 78));
      hue = 198;
    }

    const dur = Math.max(0.1, note.durationSec);
    return {
      index,
      note,
      role,
      pitch: note.pitch,
      pitchBendCents: cents,
      x,
      y,
      windowIdx,
      vel01,
      hue,
      tOn: note.timeSec,
      tOff: note.timeSec + dur,
      seed: index * 5179 + 31,
    };
  });
}

export interface BakuEventState {
  active: boolean;
  flash: number;
  glow: number;
}

/** Exact 1-to-1 onset state of any Baku Nights event at piece time t (active within 1 frame of tOn). */
export function bakuEventStateAt(ev: BakuNoteEvent, t: number): BakuEventState | null {
  if (t < ev.tOn) return null;
  const age = t - ev.tOn;
  const dur = Math.max(0.1, ev.tOff - ev.tOn);
  const maxLife = ev.role === "lead" ? 4.2 : ev.role === "bass" ? 1.85 : ev.role === "brush" ? 1.15 : dur + 0.65;
  if (age > maxLife) return null;
  const flash = Math.exp(-age / 0.14) * (0.55 + 0.45 * ev.vel01);
  const rel = smoothstep(dur, maxLife, age);
  const glow = clamp01((1 - rel) * (0.45 + 0.55 * Math.exp(-age / 0.6)) * (0.55 + 0.45 * ev.vel01));
  return {
    active: age >= 0 && age <= Math.max(dur, 0.12),
    flash: clamp01(flash),
    glow,
  };
}

/** Streetlamp x position at piece time t (reaches x = 540 at exact t = ev.tOn). */
export function lampXAt(ev: BakuNoteEvent, t: number): number {
  return LAMPLIGHTER_X + (ev.tOn - t) * SCROLL_SPEED;
}

export interface LamplighterPose {
  x: number;
  feetY: number;
  stridePhase: number;
  poleTipX: number;
  poleTipY: number;
  emberGlow: number;
}

/** Smooth deterministic trajectory of the silhouetted lamplighter and his ember-tipped brass pole. */
export function lamplighterPoseAt(
  leadEvents: readonly BakuNoteEvent[],
  t: number,
  leadSec: number,
  endSec: number,
  tailSec: number,
  loopPhase: number,
): LamplighterPose {
  // Integer number of gentle walking cycles across the whole clip -> frame N-1 stride matches frame 0!
  const stridePhase = loopPhase * 38;
  if (!leadEvents.length) {
    return {
      x: LAMPLIGHTER_X,
      feetY: LAMPLIGHTER_FEET_Y,
      stridePhase,
      poleTipX: POLE_REST_TIP_X,
      poleTipY: POLE_REST_TIP_Y,
      emberGlow: 0.45,
    };
  }
  const first = leadEvents[0];
  const last = leadEvents[leadEvents.length - 1];

  if (t <= first.tOn) {
    const u = smoothstep(-leadSec, first.tOn, t);
    const reach = smoothstep(first.tOn - 0.55, first.tOn, t);
    return {
      x: LAMPLIGHTER_X,
      feetY: LAMPLIGHTER_FEET_Y,
      stridePhase,
      poleTipX: lerp(POLE_REST_TIP_X, LAMPLIGHTER_X, u),
      poleTipY: lerp(POLE_REST_TIP_Y, first.y, reach),
      emberGlow: 0.45 + 0.55 * reach,
    };
  }

  const settleStart = last.tOn + 0.35;
  const settleEnd = endSec + tailSec - 0.06;
  if (t >= settleStart) {
    const u = smoothstep(settleStart, Math.max(settleStart + 0.3, settleEnd), t);
    return {
      x: LAMPLIGHTER_X,
      feetY: LAMPLIGHTER_FEET_Y,
      stridePhase,
      poleTipX: lerp(LAMPLIGHTER_X, POLE_REST_TIP_X, u),
      poleTipY: lerp(last.y, POLE_REST_TIP_Y, u),
      emberGlow: lerp(0.85, 0.45, u),
    };
  }

  let lo = 0;
  let hi = leadEvents.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (leadEvents[mid].tOn <= t) lo = mid;
    else hi = mid - 1;
  }
  const curr = leadEvents[lo];
  const next = leadEvents[Math.min(leadEvents.length - 1, lo + 1)];
  const span = Math.max(0.08, next.tOn - curr.tOn);
  const age = t - curr.tOn;
  const u = clamp01(age / span);

  // Hold briefly at ignited lamp, dip slightly in natural stride, then lift smoothly to kiss next.y at u = 1!
  const liftToNext = smoothstep(0.28, 0.98, u);
  const arcDip = 26 * Math.sin(Math.PI * u);
  const tipY = lerp(curr.y, next.y, liftToNext) + arcDip;
  const tipX = LAMPLIGHTER_X + 10 * Math.sin(Math.PI * u);
  const spark = Math.exp(-age / 0.18);

  return {
    x: LAMPLIGHTER_X,
    feetY: LAMPLIGHTER_FEET_Y,
    stridePhase,
    poleTipX: tipX,
    poleTipY: tipY,
    emberGlow: clamp01(0.48 + 0.52 * Math.max(spark, smoothstep(0.75, 1.0, u))),
  };
}
