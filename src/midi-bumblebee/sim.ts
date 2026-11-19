import { clamp, clamp01, hash01, lerp, lowerBound, smoothstep } from "../midi/kit.ts";
import type { MidiNote } from "../midi/types.ts";

/** Framing-standard stage bounds: 980 px wide (50 px margins, centred on x = 540), y = 290..1590 (centred on y = 940). */
export const STAGE = {
  left: 50,
  right: 1030,
  top: 290,
  hudBottom: 356,
  rollTop: 358,
  keyTop: 1310,
  bottom: 1590,
} as const;

export const WHITE_HEIGHT = STAGE.bottom - STAGE.keyTop; // 280 px
export const FALL_SEC = 1.15;
export const FALL_SPEED = (STAGE.keyTop - STAGE.rollTop) / FALL_SEC;
export const SPARK_LIFE_SEC = 0.65;
export const BEE_REST_X = 540;
export const BEE_REST_Y = 820;

const BLACK_CLASSES = [1, 3, 6, 8, 10];
export const isBlackKey = (pitch: number) => BLACK_CLASSES.includes(((pitch % 12) + 12) % 12);
const BLACK_OFFSET: Record<number, number> = { 1: -0.1, 3: 0.1, 6: -0.12, 8: 0, 10: 0.12 };

export interface KeyboardLayout {
  lo: number;
  hi: number;
  whiteCount: number;
  keyWidth: number;
  left: number;
  right: number;
  top: number;
  whiteHeight: number;
  blackWidth: number;
  blackHeight: number;
  fold: (pitch: number) => number;
  keyRect: (pitch: number) => { x: number; width: number; height: number; black: boolean };
  keyCenterX: (pitch: number) => number;
}

function nextWhiteUp(p: number): number { let x = p; while (isBlackKey(x)) x++; return x; }
function nextWhiteDown(p: number): number { let x = p; while (isBlackKey(x)) x--; return x; }
function countWhite(lo: number, hi: number): number {
  let c = 0;
  for (let p = lo; p <= hi; p++) if (!isBlackKey(p)) c++;
  return c;
}

export function planBumblebeeKeyboard(pitches: readonly number[]): KeyboardLayout {
  const sorted = [...pitches].sort((a, b) => a - b);
  let minP = sorted.length ? sorted[0] : 48;
  let maxP = sorted.length ? sorted[sorted.length - 1] : 84;
  let lo = nextWhiteDown(minP);
  let hi = nextWhiteUp(maxP);
  while (countWhite(lo, hi) > 36) {
    const mid = sorted[sorted.length >> 1] ?? 69;
    if (mid - lo > hi - mid) lo = nextWhiteUp(lo + 1);
    else hi = nextWhiteDown(hi - 1);
  }
  let up = true;
  while (countWhite(lo, hi) < 29) {
    if ((up && hi < 108) || lo <= 21) hi = nextWhiteUp(hi + 1);
    else lo = nextWhiteDown(lo - 1);
    up = !up;
  }
  const whiteCount = countWhite(lo, hi);
  const width = STAGE.right - STAGE.left;
  const keyWidth = width / whiteCount;
  const blackWidth = keyWidth * 0.62;
  const blackHeight = WHITE_HEIGHT * 0.62;
  const whiteIndex = (pitch: number) => countWhite(lo, pitch - 1);
  const fold = (pitch: number) => {
    let p = pitch;
    while (p < lo) p += 12;
    while (p > hi) p -= 12;
    return p;
  };
  const keyRect = (pitch: number) => {
    if (isBlackKey(pitch)) {
      const edge = STAGE.left + whiteIndex(pitch) * keyWidth;
      const cx = edge + (BLACK_OFFSET[((pitch % 12) + 12) % 12] ?? 0) * keyWidth;
      return { x: cx - blackWidth / 2, width: blackWidth, height: blackHeight, black: true };
    }
    return { x: STAGE.left + whiteIndex(pitch) * keyWidth, width: keyWidth, height: WHITE_HEIGHT, black: false };
  };
  return {
    lo,
    hi,
    whiteCount,
    keyWidth,
    left: STAGE.left,
    right: STAGE.right,
    top: STAGE.keyTop,
    whiteHeight: WHITE_HEIGHT,
    blackWidth,
    blackHeight,
    fold,
    keyRect,
    keyCenterX: (pitch: number) => {
      const r = keyRect(pitch);
      return r.x + r.width / 2;
    },
  };
}

export interface NoteBarEvent {
  index: number;
  note: MidiNote;
  pitch: number;
  x: number;
  width: number;
  black: boolean;
  isLead: boolean;
  hue: number;
  vel01: number;
  tOn: number;
  tOff: number;
  tEnter: number;
  seed: number;
}

export function buildNoteBarEvents(notes: readonly MidiNote[], layout: KeyboardLayout): NoteBarEvent[] {
  const hasTrack1 = notes.some((n) => n.track === 1);
  return notes.map((note, index) => {
    const pitch = layout.fold(note.pitch);
    const rect = layout.keyRect(pitch);
    const isLead = hasTrack1 ? note.track === 1 : note.channel === 0;
    const isSparkle = note.track === 3 || note.channel === 2;
    const vel01 = clamp01(note.velocity / 127);
    const hue = isLead
      ? lerp(44, 72, clamp01((pitch - 56) / 36)) // warm bumblebee gold -> electric lime
      : isSparkle
        ? 82
        : lerp(196, 232, clamp01((pitch - 40) / 28)); // cool royal cyan-indigo for left-hand stride
    const barW = Math.max(8, rect.width * (rect.black ? 0.84 : 0.78));
    const dur = Math.max(0.05, note.durationSec);
    return {
      index,
      note,
      pitch,
      x: rect.x + rect.width / 2,
      width: barW,
      black: rect.black,
      isLead,
      hue,
      vel01,
      tOn: note.timeSec,
      tOff: note.timeSec + dur,
      tEnter: note.timeSec - FALL_SEC,
      seed: index * 6151 + 29,
    };
  });
}

export interface BarRect {
  x: number;
  top: number;
  bottom: number;
  width: number;
  active: boolean;
  alpha: number;
}

/** Closed-form falling note bar geometry at piece time t, or null when off-stage. */
export function barRectAt(ev: NoteBarEvent, t: number): BarRect | null {
  const rawBottom = STAGE.keyTop - (ev.tOn - t) * FALL_SPEED;
  const rawTop = Math.min(rawBottom - 18, STAGE.keyTop - (ev.tOff - t) * FALL_SPEED);
  if (rawBottom <= STAGE.rollTop || rawTop >= STAGE.keyTop) return null;
  const top = Math.max(STAGE.rollTop, rawTop);
  const bottom = Math.min(STAGE.keyTop, rawBottom);
  if (bottom - top < 1.5) return null;
  const active = t >= ev.tOn && t <= ev.tOff + 0.04;
  const fadeOut = ev.tOff < t ? 1 - smoothstep(ev.tOff, ev.tOff + 0.08, t) : 1;
  return {
    x: ev.x - ev.width / 2,
    top,
    bottom,
    width: ev.width,
    active,
    alpha: clamp01(fadeOut),
  };
}

export interface KeyState {
  press: number;
  glow: number;
  hue: number;
}

export function keyStateAt(events: readonly NoteBarEvent[], t: number): KeyState | null {
  let press = 0;
  let glow = 0;
  let hue = 48;
  for (const ev of events) {
    const age = t - ev.tOn;
    if (age < 0) continue;
    const held = Math.max(0.09, ev.tOff - ev.tOn);
    if (age > held + 0.25) continue;
    const rel = smoothstep(held, held + 0.14, age);
    const p = smoothstep(0, 0.02, age) * (1 - rel);
    const g = (0.35 + 0.65 * Math.exp(-age / 0.18)) * ev.vel01 * (1 - rel) + 0.45 * Math.exp(-age / 0.09) * ev.vel01;
    if (p > press) press = p;
    if (g >= glow) {
      glow = g;
      hue = ev.hue;
    }
  }
  return press > 0.002 || glow > 0.01 ? { press, glow: clamp01(glow), hue } : null;
}

export interface BeePose {
  x: number;
  y: number;
  tilt: number;
  swarmCount: number;
  swarmBlend: number;
}

/** Smooth deterministic trajectory of the hero bumblebee along the lead melody, returning cleanly to rest for loops. */
export function beePoseAt(
  leadEvents: readonly NoteBarEvent[],
  t: number,
  leadSec: number,
  endSec: number,
  tailSec: number,
): BeePose {
  const strikeY = STAGE.keyTop - 32;
  if (!leadEvents.length) {
    return { x: BEE_REST_X, y: BEE_REST_Y, tilt: 0, swarmCount: 1, swarmBlend: 0 };
  }
  const first = leadEvents[0];
  const last = leadEvents[leadEvents.length - 1];

  // Lead-in dive from rest hover (540, 820) at frame 0 to first key at t = first.tOn
  if (t <= first.tOn) {
    const u = smoothstep(-leadSec, first.tOn, t);
    const x = lerp(BEE_REST_X, first.x, u);
    const arc = -95 * Math.sin(Math.PI * u);
    const y = lerp(BEE_REST_Y, strikeY, u * u) + arc;
    const vx = (first.x - BEE_REST_X) * 1.4 * Math.sin(Math.PI * u);
    return { x, y, tilt: clamp(vx / 1400, -0.42, 0.42), swarmCount: 1, swarmBlend: 0 };
  }

  // Loop settle after the last melody note back to exact (BEE_REST_X, BEE_REST_Y) with zero tilt
  const settleStart = last.tOn + 0.18;
  const settleEnd = endSec + tailSec - 0.08;
  if (t >= settleStart) {
    const u = smoothstep(settleStart, Math.max(settleStart + 0.3, settleEnd), t);
    const x = lerp(last.x, BEE_REST_X, u);
    const lift = -120 * Math.sin(Math.PI * u);
    const y = lerp(strikeY - 18, BEE_REST_Y, u) + lift;
    const vx = (BEE_REST_X - last.x) * 1.2 * Math.sin(Math.PI * u);
    return {
      x,
      y,
      tilt: clamp(vx / 1500, -0.35, 0.35) * (1 - u),
      swarmCount: 1 + Math.round(6 * (1 - smoothstep(0, 0.55, u))),
      swarmBlend: 1 - smoothstep(0, 0.55, u),
    };
  }

  // Active flight between consecutive melody notes [idx - 1, idx]
  let lo = 0;
  let hi = leadEvents.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (leadEvents[mid].tOn <= t) lo = mid;
    else hi = mid - 1;
  }
  const curr = leadEvents[lo];
  const next = leadEvents[Math.min(leadEvents.length - 1, lo + 1)];
  const span = Math.max(0.02, next.tOn - curr.tOn);
  const u = clamp01((t - curr.tOn) / span);
  const smoothU = u * u * (3 - 2 * u);
  const x = lerp(curr.x, next.x, smoothU);
  const dist = Math.abs(next.x - curr.x);
  const hopHeight = clamp(24 + dist * 0.22 + Math.min(0.4, span) * 90, 22, 135);
  const y = strikeY - hopHeight * 4 * u * (1 - u);
  const vx = ((next.x - curr.x) / span) * (6 * u * (1 - u));
  const tilt = clamp(vx / 2200, -0.46, 0.46);

  // Swarm grows cleanly across the 4 structural sections: 1 -> 3 -> 5 -> 7 bees
  const progress = clamp01(t / Math.max(1, endSec));
  const swarmCount = progress < 0.28 ? 1 : progress < 0.52 ? 3 : progress < 0.74 ? 5 : 7;
  const swarmBlend = smoothstep(0.24, 0.8, progress);
  return { x, y, tilt, swarmCount, swarmBlend };
}

/** Smoothed live notes-per-second readout over a causal 1.2 s Hann-like kernel, returning 0 at start and loop end. */
export function notesPerSecondAt(notes: readonly MidiNote[], t: number, endSec: number): number {
  if (t <= -0.05 || t >= endSec + 1.4) return 0;
  const win = 1.25;
  const fromIdx = lowerBound(notes, t - win);
  const toIdx = lowerBound(notes, t + 0.05);
  let weighted = 0;
  for (let i = fromIdx; i < toIdx; i++) {
    const dt = t - notes[i].timeSec;
    if (dt < -0.05 || dt > win) continue;
    // Raised-cosine causal window whose integral over [0, win] is win / 2
    const u = clamp01((dt + 0.05) / (win + 0.05));
    weighted += 0.5 * (1 - Math.cos(2 * Math.PI * u));
  }
  const raw = weighted / (0.5 * (win + 0.05));
  const taperEnd = 1 - smoothstep(endSec + 0.15, endSec + 1.35, t);
  return Math.max(0, raw * taperEnd);
}

export function sparkAt(ev: NoteBarEvent, k: number, age: number): { x: number; y: number; size: number; alpha: number } | null {
  const life = 0.28 + 0.34 * hash01(ev.seed, k * 3 + 1);
  if (age < 0 || age > life) return null;
  const angle = -Math.PI / 2 + (hash01(ev.seed, k * 3 + 2) - 0.5) * 2.2;
  const speed = (180 + 420 * hash01(ev.seed, k * 3 + 3)) * (0.65 + 0.55 * ev.vel01);
  const drag = 2.8;
  const grav = 1100;
  const dec = (1 - Math.exp(-drag * age)) / drag;
  const x = ev.x + Math.cos(angle) * speed * dec;
  const y = STAGE.keyTop - 3 + Math.sin(angle) * speed * dec + (grav * (age - dec)) / drag;
  const fade = 1 - age / life;
  return { x, y, size: 3.5 + 4.5 * hash01(ev.seed, k * 3 + 4), alpha: fade * fade };
}
