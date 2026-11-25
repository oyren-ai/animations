import { clamp, clamp01, hash01, lerp, smoothstep } from "../midi/kit.ts";
import { extractReconciledMelody, type ArshinSectionKind } from "../midi/arshin.ts";
import type { MidiNote } from "../midi/types.ts";

/**
 * Framing-standard stage bounds: 980 px wide (x = 50..1030, centred on x = 540),
 * y = 295..1645 (height 1350 px, vertical centre y = 970, well below quiet brand layer y = 95..156
 * and caption y = 178..248).
 */
export const STAGE = {
  left: 50,
  right: 1030,
  top: 295,
  eavesBottom: 376,
  canopyTop: 380,
  counterTop: 1176,
  counterBottom: 1252,
  plinthTop: 1368,
  bottom: 1645,
} as const;

export const PEDDLER_X = 540;
export const PEDDLER_BASE_Y = STAGE.counterTop;
export const STICK_REST_Y = 1118;
export const RIBBON_SPEED = 235; // px / sec unwinding from right bolt shelf to peddler at x = 540
export const BOLT_X = 942;
export const CHEST_X = 138;
export const CHEST_Y = 1126;

export const SHELF_LOW_Y = 1132;
export const SHELF_HIGH_Y = 910;
export const HANGING_LINES_Y = [448, 598, 748] as const; // [high pitch line, mid pitch line, low pitch line]
export const NAGHARA_CX = 540;
export const NAGHARA_CY = 1506;
export const LANTERN_COUNT = 12;

export type ArshinRole = "melody" | "tar" | "piano" | "bass" | "drum";

/** Rich jewel-toned silk palette indexed by pitch class (ruby, pomegranate, saffron, emerald, turquoise, cobalt, amethyst). */
const SILK_HUES = [350, 14, 38, 48, 158, 178, 196, 214, 262, 286, 318, 336] as const;

export function silkHueForPitch(pitch: number): number {
  return SILK_HUES[((pitch % 12) + 12) % 12];
}

export function classifyArshinRole(note: MidiNote): ArshinRole {
  if (note.channel === 9) return "drum";
  if (note.track === 1 || note.channel === 0) return "melody";
  if (note.track === 2 || note.channel === 1) return "tar";
  if (note.track === 4 || note.channel === 3 || note.pitch < 50) return "bass";
  return "piano";
}

export interface ArshinNoteEvent {
  index: number;
  melodyOrdinal: number;
  note: MidiNote;
  role: ArshinRole;
  pitch: number;
  vel01: number;
  hue: number;
  /** Target x where the physical agent strikes/snips/chimes at exact tOn. */
  x: number;
  /** Target y where the physical agent strikes/snips/chimes at exact tOn. */
  y: number;
  /** Overhead silk line index 0..2 (for melody cloths), lantern index 0..11 (for piano), or cord index 0..3 (for bass). */
  slotIndex: number;
  /** Final hung x coordinate on the overhead silk line (left-to-centre for 1st pass, right-to-centre for repeats). */
  hangX: number;
  hangY: number;
  clothWidth: number;
  clothDrop: number;
  section: ArshinSectionKind;
  isRepeatPass: boolean;
  tOn: number;
  tOff: number;
  seed: number;
}

export function lanternX(slot: number): number {
  const u = slot / (LANTERN_COUNT - 1);
  return lerp(114, 966, u);
}

export function bassCordCoords(slot: number): { x1: number; x2: number; y: number } {
  const isRight = slot >= 2;
  const row = slot % 2;
  const y = 1468 + row * 68;
  return isRight ? { x1: 644, x2: 976, y } : { x1: 104, x2: 436, y };
}

/** Build 1-to-1 physical bazaar events for every MIDI note in the piece. */
export function buildArshinEvents(notes: readonly MidiNote[]): {
  events: ArshinNoteEvent[];
  melodyMinPitch: number;
  melodyMaxPitch: number;
  foldAwayStartSec: number;
} {
  const reconciled = extractReconciledMelody();
  const melodyRaw = notes.filter((n) => classifyArshinRole(n) === "melody");
  const useReconciledMeta = melodyRaw.length === reconciled.notes.length;

  let minP = 52;
  let maxP = 68;
  if (melodyRaw.length) {
    minP = Math.min(...melodyRaw.map((n) => n.pitch));
    maxP = Math.max(...melodyRaw.map((n) => n.pitch));
    if (maxP - minP < 8) {
      minP -= 4;
      maxP += 4;
    }
  }

  // Count how many melody cloths go to each (lineIdx, isRepeatBay) group so they space evenly with zero overlap!
  const bayTotals = [0, 0, 0, 0, 0, 0]; // lineIdx * 2 + (isRepeat ? 1 : 0)
  const melodyMeta = melodyRaw.map((n, mIdx) => {
    const uPitch = clamp01((n.pitch - minP) / Math.max(1, maxP - minP));
    const lineIdx = uPitch > 0.66 ? 0 : uPitch > 0.33 ? 1 : 2;
    const rec = useReconciledMeta ? reconciled.notes[mIdx] : null;
    const isRepeatPass = rec ? rec.isRepeatPass : mIdx % 8 >= 4;
    const section: ArshinSectionKind = rec ? rec.section : "verse";
    const bayKey = lineIdx * 2 + (isRepeatPass ? 1 : 0);
    const ordInBay = bayTotals[bayKey]++;
    return { lineIdx, isRepeatPass, section, bayKey, ordInBay, uPitch };
  });

  let mCursor = 0;
  let lastMelodyOff = 0;

  const events = notes.map((note, index) => {
    const role = classifyArshinRole(note);
    const vel01 = clamp01(note.velocity / 127);
    const dur = Math.max(0.08, note.durationSec);
    let melodyOrdinal = -1;
    let x = PEDDLER_X;
    let y = STICK_REST_Y;
    let slotIndex = 0;
    let hangX = PEDDLER_X;
    let hangY: number = HANGING_LINES_Y[1];
    let clothWidth = 22;
    let clothDrop = 86;
    let section: ArshinSectionKind = "verse";
    let isRepeatPass = false;
    let hue = silkHueForPitch(note.pitch);

    if (role === "melody") {
      const meta = melodyMeta[mCursor];
      melodyOrdinal = mCursor;
      mCursor++;
      x = PEDDLER_X;
      y = lerp(SHELF_LOW_Y, SHELF_HIGH_Y, meta.uPitch);
      slotIndex = meta.lineIdx;
      hangY = HANGING_LINES_Y[meta.lineIdx];
      section = meta.section;
      isRepeatPass = meta.isRepeatPass;

      const countInBay = Math.max(1, bayTotals[meta.bayKey]);
      const uBay = countInBay === 1 ? 0.5 : meta.ordInBay / (countInBay - 1);
      // First-pass cloths fill left-to-centre bay (x = 98..524); repeat-pass cloths fill right-to-centre bay (x = 556..982)!
      hangX = isRepeatPass ? lerp(556, 982, uBay) : lerp(98, 524, uBay);
      clothWidth = clamp(12 + dur * 18, 12, 24);
      clothDrop = clamp(68 + dur * 64, 68, 124);
      lastMelodyOff = Math.max(lastMelodyOff, note.timeSec + dur);
    } else if (role === "tar") {
      const uPitch = clamp01((note.pitch - (minP + 12)) / Math.max(1, maxP - minP));
      x = lerp(250, 830, uPitch);
      y = STAGE.counterTop + 36;
      hue = 44; // bright golden tar shimmer
    } else if (role === "piano") {
      slotIndex = ((note.pitch % LANTERN_COUNT) + LANTERN_COUNT) % LANTERN_COUNT;
      x = lanternX(slotIndex);
      y = 338;
      hue = 40;
    } else if (role === "bass") {
      slotIndex = note.pitch < 41 ? 0 : note.pitch < 44 ? 1 : note.pitch < 47 ? 2 : 3;
      const cord = bassCordCoords(slotIndex);
      x = (cord.x1 + cord.x2) / 2;
      y = cord.y;
      hue = 34;
    } else {
      // Naghara frame drum
      slotIndex = note.pitch === 60 ? 0 : 1; // 0 = central dum, 1 = rim/jingle tak
      x = NAGHARA_CX;
      y = NAGHARA_CY;
      hue = slotIndex === 0 ? 36 : 48;
    }

    return {
      index,
      melodyOrdinal,
      note,
      role,
      pitch: note.pitch,
      vel01,
      hue,
      x,
      y,
      slotIndex,
      hangX,
      hangY,
      clothWidth,
      clothDrop,
      section,
      isRepeatPass,
      tOn: note.timeSec,
      tOff: note.timeSec + dur,
      seed: index * 5741 + 19,
    };
  });

  return {
    events,
    melodyMinPitch: minP,
    melodyMaxPitch: maxP,
    foldAwayStartSec: lastMelodyOff + 0.18,
  };
}

export interface ArshinEventState {
  active: boolean;
  strike: number;
  glow: number;
}

/** Closed-form 1-to-1 onset state for any Arshin event at piece time t (active within 1 frame of tOn). */
export function arshinEventStateAt(ev: ArshinNoteEvent, t: number): ArshinEventState | null {
  if (t < ev.tOn) return null;
  const age = t - ev.tOn;
  const dur = Math.max(0.08, ev.tOff - ev.tOn);
  const maxLife = dur + 0.45;
  if (age > maxLife) return null;
  const strike = Math.exp(-age / 0.12) * (0.55 + 0.45 * ev.vel01);
  const rel = smoothstep(dur, maxLife, age);
  const glow = clamp01((1 - rel) * (0.42 + 0.58 * Math.exp(-age / 0.45)) * (0.55 + 0.45 * ev.vel01));
  return {
    active: age >= 0 && age <= Math.max(dur, 0.1),
    strike: clamp01(strike),
    glow,
  };
}

export interface PeddlerPose {
  stickY: number;
  stickTilt: number;
  scissorSnap: number;
  foldPull: number;
}

/** Deterministic pose of the Cloth Peddler's brass arshin stick and shears at x = 540, returning to rest for loops. */
export function peddlerPoseAt(
  melodyEvents: readonly ArshinNoteEvent[],
  t: number,
  leadSec: number,
  foldAwayStartSec: number,
  endSec: number,
  tailSec: number,
): PeddlerPose {
  if (!melodyEvents.length) {
    return { stickY: STICK_REST_Y, stickTilt: 0, scissorSnap: 0, foldPull: 0 };
  }
  const first = melodyEvents[0];
  const last = melodyEvents[melodyEvents.length - 1];

  if (t <= first.tOn) {
    const u = smoothstep(-leadSec, first.tOn, t);
    const lift = Math.sin(Math.PI * smoothstep(first.tOn - 0.6, first.tOn, t));
    return {
      stickY: lerp(STICK_REST_Y, first.y, u),
      stickTilt: -0.14 * lift,
      scissorSnap: 0,
      foldPull: 0,
    };
  }

  const settleEnd = endSec + tailSec - 0.06;
  if (t >= foldAwayStartSec) {
    const u = smoothstep(foldAwayStartSec, Math.max(foldAwayStartSec + 0.4, settleEnd), t);
    const pullArc = Math.sin(Math.PI * smoothstep(0.05, 0.85, u));
    return {
      stickY: lerp(last.y, STICK_REST_Y, u),
      stickTilt: 0.1 * pullArc,
      scissorSnap: 0,
      foldPull: pullArc,
    };
  }

  let lo = 0;
  let hi = melodyEvents.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (melodyEvents[mid].tOn <= t) lo = mid;
    else hi = mid - 1;
  }
  const curr = melodyEvents[lo];
  const next = melodyEvents[Math.min(melodyEvents.length - 1, lo + 1)];
  const span = Math.max(0.05, next.tOn - curr.tOn);
  const age = t - curr.tOn;
  const u = clamp01(age / span);

  const move = smoothstep(0.24, 0.94, u);
  const snap = Math.exp(-age / 0.11);
  return {
    stickY: lerp(curr.y, next.y, move),
    stickTilt: 0.12 * snap * (curr.melodyOrdinal % 2 === 0 ? 1 : -1),
    scissorSnap: clamp01(snap),
    foldPull: 0,
  };
}

export function jingleSparkAt(seed: number, k: number, age: number): { dx: number; dy: number; alpha: number } | null {
  const life = 0.22 + 0.18 * hash01(seed, k * 3 + 1);
  if (age < 0 || age > life) return null;
  const ang = (k / 8) * Math.PI * 2 + (hash01(seed, k * 3 + 2) - 0.5) * 0.4;
  const r = 64 + (45 + 65 * hash01(seed, k * 3 + 3)) * (1 - Math.exp(-4 * age));
  const fade = 1 - age / life;
  return { dx: Math.cos(ang) * r, dy: Math.sin(ang) * r, alpha: fade * fade };
}
