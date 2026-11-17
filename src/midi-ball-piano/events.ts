import { clamp, clamp01, hash01, smoothstep } from "../midi/kit.ts";
import type { MidiNote } from "../midi/types.ts";
import type { KeyboardLayout } from "./layout.ts";

/**
 * Per-note ball motion for the Ball Piano scene. Everything is a closed-form function of piece time,
 * so any frame can be painted without simulating the frames before it.
 */

/** Seconds a ball falls from the top of the screen to its key: the release time is note-on minus this. */
export const FALL_SEC = 1.6;
/** Bottom of a ball when it is released: inside the frame, below the title, so the whole fall path is visible. */
export const START_BOTTOM_Y = 340;
/** Seconds the ball is in contact with the key, squashing and rebounding. */
export const CONTACT_SEC = 0.085;
/** Seconds after note-on until a ball (and its effects) has completely faded. */
export const BALL_LIFE_SEC = 0.75;
export const SPARK_LIFE_SEC = 0.85;

export interface BallEvent {
  index: number;
  note: MidiNote;
  /** Pitch after folding into the keyboard range. */
  pitch: number;
  hue: number;
  lightness: number;
  x: number;
  keyTop: number;
  black: boolean;
  radius: number;
  vel01: number;
  seed: number;
  tOn: number;
  tRelease: number;
  /** Constant gravity chosen so the ball lands exactly at tOn after FALL_SEC. */
  gravity: number;
  impactSpeed: number;
  /** Number of sparks thrown on impact. */
  sparkCount: number;
  /** Size factor of effects relative to the 39.5 px keys the effects were designed for. */
  scale: number;
}

/** Hue (degrees) of a pitch class on a chromatic wheel, rotated so common keys give distinct, tasteful colours. */
export function ballHue(pitch: number): number {
  return (200 + (((pitch % 12) + 12) % 12) * 30) % 360;
}

export function buildBallEvents(notes: readonly MidiNote[], layout: KeyboardLayout): BallEvent[] {
  return notes.map((note, index) => {
    const pitch = layout.fold(note.pitch);
    const rect = layout.keyRect(pitch);
    const vel01 = clamp01(note.velocity / 127);
    const radius = layout.keyWidth * (0.36 + 0.08 * vel01) * (rect.black ? 0.95 : 1); // diameter about 0.8 of a key width
    const keyTop = layout.top;
    const gravity = (2 * (keyTop - START_BOTTOM_Y)) / (FALL_SEC * FALL_SEC);
    return {
      index, note, pitch,
      hue: ballHue(pitch),
      lightness: 0.6 + 0.08 * clamp((pitch - layout.lo) / Math.max(1, layout.hi - layout.lo), 0, 1),
      x: rect.x + rect.width / 2,
      keyTop,
      black: rect.black,
      radius,
      vel01,
      seed: index * 7919 + 17,
      tOn: note.timeSec,
      tRelease: note.timeSec - FALL_SEC,
      gravity,
      impactSpeed: gravity * FALL_SEC,
      sparkCount: 10 + Math.round(16 * vel01),
      scale: layout.keyWidth / 39.5,
    };
  });
}

/** Vertical position of the ball's lowest point while falling (t <= tOn): reaches keyTop exactly at tOn. */
export function fallBottomY(event: BallEvent, t: number): number {
  const age = t - event.tRelease;
  return START_BOTTOM_Y + 0.5 * event.gravity * age * age;
}

export interface BallPose {
  /** Centre of the ball. */
  x: number;
  y: number;
  /** Horizontal and vertical scale (squash and stretch, volume preserving). */
  sx: number;
  sy: number;
  /** Seconds since impact (negative while falling). */
  age: number;
  /** Fall speed in px/s (0 once in contact or rebounding). */
  speed: number;
  /** Height of the ball's bottom above the key top during the rebound. */
  lift: number;
  alpha: number;
  /** True from the moment of impact. */
  landed: boolean;
}

/**
 * Pose of a ball at piece time t, or null when it is not visible: falling from `tRelease`, impact (squash)
 * at `tOn`, a short rebound that fades out over BALL_LIFE_SEC.
 */
export function ballPose(event: BallEvent, t: number): BallPose | null {
  const age = t - event.tOn;
  if (t < event.tRelease || age > BALL_LIFE_SEC) return null;
  const r = event.radius;
  if (age < 0) {
    const speed = event.gravity * (t - event.tRelease);
    const stretch = 1 + clamp(speed / 3200, 0, 0.5);
    const bottom = fallBottomY(event, t);
    const sy = stretch, sx = Math.pow(sy, -0.6);
    const y = bottom - r * sy;
    return { x: event.x, y, sx, sy, age, speed, lift: 0, alpha: smoothstep(START_BOTTOM_Y - 12, START_BOTTOM_Y + 70, y), landed: false };
  }
  const stretch0 = 1 + clamp(event.impactSpeed / 3200, 0, 0.5);
  let sy: number, lift = 0;
  if (age < CONTACT_SEC) {
    const u = age / CONTACT_SEC;
    sy = u < 0.5 ? stretch0 + (0.52 - stretch0) * smoothstep(0, 0.5, u) : 0.52 + (1.22 - 0.52) * smoothstep(0.5, 1, u);
  } else {
    const flight = age - CONTACT_SEC;
    sy = 1 + 0.22 * Math.exp(-flight / 0.12) * Math.cos(2 * Math.PI * 5.5 * flight);
    const reboundSpeed = (0.1 + 0.14 * event.vel01) * event.impactSpeed;
    lift = Math.max(0, reboundSpeed * flight - 0.5 * event.gravity * flight * flight);
  }
  const sx = Math.pow(sy, -0.6);
  const y = event.keyTop - lift - r * sy;
  const alpha = 1 - smoothstep(0.1, BALL_LIFE_SEC, age);
  return { x: event.x, y, sx, sy, age, speed: 0, lift, alpha, landed: true };
}

export interface SparkState { x: number; y: number; alpha: number; size: number }

/** Closed-form ballistic spark with linear drag; k-th spark of an event, `age` seconds after impact. */
export function sparkState(event: BallEvent, k: number, age: number): SparkState | null {
  const life = 0.4 + 0.45 * hash01(event.seed, k * 3 + 1);
  if (age < 0 || age > life) return null;
  const angle = -Math.PI / 2 + (hash01(event.seed, k * 3 + 2) - 0.5) * 2.5;
  const speed = (260 + 640 * hash01(event.seed, k * 3 + 3)) * (0.65 + 0.6 * event.vel01) * event.scale;
  const drag = 2.4, gravity = 1500;
  const decay = (1 - Math.exp(-drag * age)) / drag;
  const x = event.x + Math.cos(angle) * speed * decay;
  const y = event.keyTop - 4 + Math.sin(angle) * speed * decay + gravity * (age - decay) / drag;
  const fade = 1 - age / life;
  return { x, y, alpha: fade * fade, size: (5 + 9 * hash01(event.seed, k * 3 + 4) * (0.6 + 0.6 * event.vel01)) * event.scale };
}

export interface KeyLight {
  /** 0..1, how far the key is pressed down. */
  press: number;
  /** 0..1 brightness of the colour on the key. */
  glow: number;
  hue: number;
}

/**
 * State of one key at piece time t: pressed from note-on until note-off (plus a short release), brightest at the
 * strike and settling to a dimmer glow while held. Uses the events of that pitch only.
 */
export function keyLight(events: readonly BallEvent[], t: number): KeyLight | null {
  let press = 0, glow = 0, hue = 0;
  for (const event of events) {
    const age = t - event.tOn;
    if (age < 0) continue;
    const held = Math.max(event.note.durationSec, 0.12);
    const release = smoothstep(held, held + 0.16, age);
    const down = smoothstep(0, 0.035, age) * (1 - release);
    const lit = (0.3 + 0.7 * Math.exp(-age / 0.22)) * event.vel01 * (1 - release) + 0.55 * Math.exp(-age / 0.1) * event.vel01;
    if (down > press) press = down;
    if (lit >= glow) { glow = lit; hue = event.hue; }
  }
  return press > 0.001 || glow > 0.01 ? { press, glow: clamp01(glow), hue } : null;
}

/** Index range [from, to) of events that can be visible at piece time t (events are in note order, sorted by onset). */
export function visibleRange(events: readonly BallEvent[], t: number, pastSec = Math.max(BALL_LIFE_SEC, SPARK_LIFE_SEC) + 0.2): [number, number] {
  const from = t - pastSec;
  const until = t + FALL_SEC + 0.05;
  let lo = 0, hi = events.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].tOn < from) lo = mid + 1; else hi = mid; }
  const start = lo;
  hi = events.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].tOn <= until) lo = mid + 1; else hi = mid; }
  return [start, lo];
}

/** Recent-note colour and energy: hue is the loudness-weighted circular mean of the last few seconds. */
export function moodAt(events: readonly BallEvent[], t: number): { hue: number; energy: number } {
  const [from, to] = visibleRange(events, t, 3.5);
  let x = 0, y = 0, energy = 0;
  for (let i = from; i < to; i++) {
    const age = t - events[i].tOn;
    if (age < 0) continue;
    const w = events[i].vel01 * Math.exp(-age / 0.6);
    const a = (events[i].hue * Math.PI) / 180;
    x += Math.cos(a) * w; y += Math.sin(a) * w; energy += w;
  }
  const hue = energy > 0.02 ? ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 : 250;
  return { hue, energy };
}
