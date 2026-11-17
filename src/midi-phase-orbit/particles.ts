import { clamp01, hash01, lerp } from "../midi/kit.ts";
import { DISC, polarX, polarY, type OrbitEvent } from "./layout.ts";

/**
 * Stateless particles for Phase Orbit. Every position is a pure function of (note seed, spark index, time
 * since the crossing) or (dust index, time): frames can be rendered in any order and always agree.
 * Coordinates are disc coordinates: from the hub, un-rotated, 12 o'clock up.
 */

export interface SparkPoint { x: number; y: number; alpha: number; size: number }

/** Longest spark life in seconds: callers can ignore notes crossed longer ago than this. */
export const SPARK_MAX_LIFE = 1.5;

export function sparkLife(ev: OrbitEvent, j: number): number {
  return lerp(0.4, 0.95, hash01(ev.seed, j * 8 + 2)) * (0.8 + 0.4 * ev.vel) * (ev.sparkPower > 1 ? 1.4 : 1);
}

/**
 * Spark j of a note `age` seconds after its crossing, thrown outward along the radial direction with
 * linear drag (distance = v (1 - e^(-k age)) / k), a little tangential spread, then fading and shrinking.
 * The flight is scaled so the spark centre never travels past DISC.sparkReach, however close to the rim the ring is.
 * Writes into `out` and returns false when the spark is not alive.
 */
export function sparkAt(ev: OrbitEvent, j: number, age: number, out: SparkPoint): boolean {
  const life = sparkLife(ev, j);
  if (age < 0 || age >= life) return false;
  const speed = lerp(315, 770, hash01(ev.seed, j * 8 + 1)) * (0.55 + 0.65 * ev.vel) * ev.sparkPower;
  const drag = lerp(3.2, 6.2, hash01(ev.seed, j * 8 + 3));
  const reach = speed / drag; // distance as age -> infinity
  const room = Math.max(5, DISC.sparkReach - ev.radius - 4);
  const fit = Math.min(1, room / reach);
  const distance = fit * speed * (1 - Math.exp(-drag * age)) / drag;
  const spread = (hash01(ev.seed, j * 8 + 4) - 0.5) * 0.8;
  const radial = ev.radius + distance;
  const lateral = spread * distance;
  // Rotate the (radial, lateral) offset into the disc frame at the note's angle.
  const rx = polarX(1, ev.angle), ry = polarY(1, ev.angle); // unit radial vector
  out.x = rx * radial + -ry * lateral;
  out.y = ry * radial + rx * lateral;
  const k = clamp01(age / life);
  out.alpha = (1 - k) ** 1.5;
  out.size = lerp(20, 6, k) * (0.8 + 0.5 * hash01(ev.seed, j * 8 + 5));
  return true;
}

export interface DustPoint { x: number; y: number; alpha: number; size: number; hue: number; depth: number }

export const DUST_COUNT = 110;

/** Slowly drifting, twinkling star dust: an analytic function of the index and time, wrapped to the canvas. */
export function dustAt(i: number, t: number, width: number, height: number, out: DustPoint): void {
  const depth = 0.2 + 0.8 * hash01(i, 101) ** 1.6;
  const margin = 40;
  const w = width + margin * 2, h = height + margin * 2;
  const vx = (hash01(i, 102) - 0.5) * 9 * depth + 2.4 * depth;
  const vy = -(3 + 13 * depth * hash01(i, 103));
  const x = (((hash01(i, 104) * w + vx * t) % w) + w) % w - margin;
  const y = (((hash01(i, 105) * h + vy * t) % h) + h) % h - margin;
  const twinkle = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (lerp(0.08, 0.35, hash01(i, 106)) * t + hash01(i, 107)));
  out.x = x;
  out.y = y;
  out.depth = depth;
  out.size = 1.6 + 3.6 * depth * (0.6 + 0.4 * hash01(i, 108));
  out.alpha = (0.18 + 0.7 * depth) * (0.25 + 0.75 * twinkle);
  const warm = hash01(i, 109);
  out.hue = warm < 0.12 ? 36 : warm < 0.3 ? 285 : 205 + 40 * hash01(i, 110);
}
