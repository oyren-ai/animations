import type { ReelBox } from "../shared/reelUtils.ts";
import type { MidiSceneData } from "./timeline.ts";
import type { MidiNote } from "./types.ts";

/**
 * Small deterministic helpers shared by the MIDI scenes. Everything here is a pure function of its inputs:
 * frames can be rendered in any order, on any worker, and look identical.
 */

export const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
export const clamp01 = (value: number) => clamp(value, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
export const easeInOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));

/** Overshooting ease: 0 at t=0, 1 at t=1, peak above 1 in between. */
export function easeOutBack(t: number, overshoot = 1.70158): number {
  const x = clamp01(t) - 1;
  return 1 + (overshoot + 1) * x ** 3 + overshoot * x ** 2;
}

/** Seeded PRNG (mulberry32); returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless hash of two integers to a float in [0, 1): the same input always gives the same value. */
export function hash01(a: number, b = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function hsla(hue: number, saturation: number, lightness: number, alpha = 1): string {
  const h = ((hue % 360) + 360) % 360;
  return `hsla(${h.toFixed(1)}, ${(saturation * 100).toFixed(1)}%, ${(lightness * 100).toFixed(1)}%, ${clamp01(alpha).toFixed(3)})`;
}

/** [r, g, b] in 0..255 for an HSL colour (hue in degrees); handy for per-pixel work. */
export function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 360;
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (t0: number) => {
    const t = ((t0 % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
}

/**
 * Hue (degrees) of a pitch class on a circle-of-fifths colour wheel, so harmonically close notes get
 * neighbouring colours. `offset` rotates the wheel.
 */
export function pitchClassHue(pitch: number, offset = 205): number {
  return (offset + (((pitch % 12) * 7) % 12) * 30) % 360;
}

/** Index of the first note whose onset is >= timeSec (notes must be sorted by onset). */
export function lowerBound(notes: readonly MidiNote[], timeSec: number): number {
  let lo = 0, hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].timeSec < timeSec) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export interface Accent {
  /** Onset of the first note of the group, piece seconds. */
  timeSec: number;
  noteCount: number;
  /** Sum of squared normalised velocities: about 0.4 for one mezzo-forte note, 2.5 for a four-note forte chord. */
  loudness: number;
  /** 0..1, smooth function of loudness: 0 for ordinary notes, 1 for the loudest chords. */
  strength: number;
}

/** Group notes that start within `groupSec` of each other into chords and rate each group's loudness. */
export function buildAccents(notes: readonly MidiNote[], groupSec = 0.045, lo = 0.9, hi = 3.4): Accent[] {
  const accents: Accent[] = [];
  let i = 0;
  while (i < notes.length) {
    const start = notes[i].timeSec;
    let loudness = 0, count = 0;
    while (i < notes.length && notes[i].timeSec - start <= groupSec) {
      loudness += (notes[i].velocity / 127) ** 2;
      count++;
      i++;
    }
    accents.push({ timeSec: start, noteCount: count, loudness, strength: smoothstep(lo, hi, loudness) });
  }
  return accents;
}

/**
 * Sum of exponentially decaying accent pulses at time t: strength * exp(-(t - tAccent) / tau), only
 * for accents with strength above `minStrength` that happened within the last 6 tau.
 */
export function accentPulse(accents: readonly Accent[], t: number, tau: number, minStrength = 0.02): number {
  let lo = 0, hi = accents.length;
  while (lo < hi) { // first accent later than t
    const mid = (lo + hi) >> 1;
    if (accents[mid].timeSec <= t) lo = mid + 1; else hi = mid;
  }
  let sum = 0;
  for (let i = lo - 1; i >= 0; i--) {
    const age = t - accents[i].timeSec;
    if (age > tau * 6) break;
    if (accents[i].strength >= minStrength) sum += accents[i].strength * Math.exp(-age / tau);
  }
  return sum;
}

export interface CameraKick { zoom: number; dx: number; dy: number; rotation: number }

/** Camera punch-in and damped shake from loud-chord accents; all zero when nothing has happened recently. */
export function cameraKick(accents: readonly Accent[], t: number, strength = 1): CameraKick {
  let lo = 0, hi = accents.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (accents[mid].timeSec <= t) lo = mid + 1; else hi = mid;
  }
  let zoom = 0, dx = 0, dy = 0, rotation = 0;
  for (let i = lo - 1; i >= 0; i--) {
    const age = t - accents[i].timeSec;
    if (age > 0.9) break;
    const accent = accents[i];
    if (accent.strength < 0.05) continue;
    const punch = accent.strength * Math.exp(-age / 0.16);
    const wobble = accent.strength * Math.exp(-age / 0.11);
    const phase = hash01(i, 11) * Math.PI * 2;
    zoom += punch * 0.03;
    dx += wobble * Math.cos(age * 52 + phase) * 12;
    dy += wobble * Math.sin(age * 61 + phase * 1.7) * 12;
    rotation += wobble * Math.cos(age * 37 + phase * 0.6) * 0.0045;
  }
  // Framing standard: kicks never exceed 3 percent zoom (they decay back to exactly 1.0 within a second).
  return { zoom: Math.min(0.03, zoom * strength), dx: dx * strength, dy: dy * strength, rotation: rotation * strength };
}

/** Opacity of a black cover that fades the picture out over the last `seconds` (default 0.3 s) of the video. */
export function endFade(frame: number, totalFrames: number, fps: number, seconds = 0.3): number {
  return smoothstep(totalFrames - seconds * fps, totalFrames - 1, frame);
}

const spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * A soft radial glow sprite (white-hot core fading to the hue and then to transparent) drawn once and
 * cached; blitting it with "lighter" compositing is much cheaper than gradient or shadowBlur glows.
 * Browser only (needs `document`).
 */
export function glowSprite(hue: number, size = 128, core = 0.16, lightness = 0.62): HTMLCanvasElement {
  const key = `${Math.round(hue)}:${size}:${core}:${lightness}`;
  let sprite = spriteCache.get(key);
  if (!sprite) {
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = size;
    const g = sprite.getContext("2d");
    if (!g) throw new Error("2D canvas context unavailable");
    const r = size / 2;
    const gradient = g.createRadialGradient(r, r, 0, r, r, r);
    gradient.addColorStop(0, hsla(hue, 0.9, 0.97, 1));
    gradient.addColorStop(core, hsla(hue, 0.95, 0.82, 0.95));
    gradient.addColorStop(core + 0.18, hsla(hue, 0.95, lightness, 0.55));
    gradient.addColorStop(0.62, hsla(hue, 0.9, lightness * 0.8, 0.16));
    gradient.addColorStop(1, hsla(hue, 0.9, lightness * 0.6, 0));
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
    spriteCache.set(key, sprite);
  }
  return sprite;
}

/** Blit a glow sprite centred on (x, y) with the given diameter and opacity (call with "lighter" set). */
export function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, diameter: number, hue: number, alpha: number, core = 0.16) {
  if (alpha <= 0.002 || diameter <= 0.5) return;
  const sprite = glowSprite(hue, 128, core);
  ctx.globalAlpha = clamp01(alpha);
  ctx.drawImage(sprite, x - diameter / 2, y - diameter / 2, diameter, diameter);
  ctx.globalAlpha = 1; // never leak this sprite's opacity into the next fill or stroke
}

/** Framing standard: everything is centred on x = 540 of 1080; text stays inside the central 840 px. */
export const FRAME_CENTER_X = 540;
export const TEXT_LEFT = 120;
export const TEXT_RIGHT = 960;

/**
 * Draws one line of text centred on `centerX` (default 540), shrinking the font until it fits `maxWidth`
 * (at most the central 840 px), and returns its box. Throws if the box would leave the central 840 px.
 */
export function drawCenteredText(
  ctx: CanvasRenderingContext2D, text: string, y: number,
  options: { size?: number; weight?: number; color?: string; maxWidth?: number; letterSpacing?: number; centerX?: number } = {},
): ReelBox {
  const { size = 24, weight = 600, color = "#f4f5f7", maxWidth = TEXT_RIGHT - TEXT_LEFT, letterSpacing = 0, centerX = FRAME_CENTER_X } = options;
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  spaced.letterSpacing = letterSpacing + "px";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let fontSize = size;
  let width: number;
  for (;;) {
    ctx.font = `${weight} ${fontSize}px "Inter Variable", Inter, sans-serif`;
    width = ctx.measureText(text).width;
    if (width <= maxWidth + letterSpacing || fontSize <= 10) break;
    fontSize -= 0.5;
  }
  // Canvas letter spacing adds a trailing gap after the last glyph; shift by half of it so the visible text stays centred.
  const x = centerX + letterSpacing / 2;
  ctx.fillText(text, x, y);
  spaced.letterSpacing = "0px";
  const visible = width - letterSpacing;
  const box: ReelBox = { label: text, left: centerX - visible / 2, right: centerX + visible / 2, top: y - fontSize * 0.78, bottom: y + fontSize * 0.22 };
  if (box.left < TEXT_LEFT - 0.5 || box.right > TEXT_RIGHT + 0.5) throw new RangeError(`Text leaves the central 840 px: ${JSON.stringify(box)}`);
  return box;
}

/**
 * The small, unobtrusive title shared by the MIDI scenes: the piece name and a "MIDI - <scene>" line, centred
 * on x = 540 near the top (baselines y = 196 and 240, above the art). Fades in over the first 0.8 s.
 */
export function drawSceneTitle(ctx: CanvasRenderingContext2D, scene: MidiSceneData, label: string, frame: number): ReelBox[] {
  const boxes: ReelBox[] = [];
  const appear = smoothstep(0.1, 0.9, frame / scene.fps);
  ctx.save();
  ctx.globalAlpha = 0.92 * appear;
  boxes.push(drawCenteredText(ctx, scene.title, 196, { size: 46, weight: 700, color: "#eef2ff", maxWidth: 780 }));
  ctx.globalAlpha = 0.66 * appear;
  boxes.push(drawCenteredText(ctx, "MIDI  \u00b7  " + label.toUpperCase(), 240, { size: 22, weight: 600, color: "#a9b4d6", maxWidth: 780, letterSpacing: 4 }));
  ctx.restore();
  return boxes;
}

/** Soft dark vignette over the whole canvas (call after the scene, with source-over compositing). */
export function drawVignette(ctx: CanvasRenderingContext2D, width: number, height: number, strength = 0.5) {
  const radius = Math.hypot(width, height) / 2;
  const gradient = ctx.createRadialGradient(width / 2, height / 2, radius * 0.45, width / 2, height / 2, radius);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, `rgba(0,0,6,${strength})`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

const softCache = new Map<string, HTMLCanvasElement>();

/** A smooth, coreless radial glow (no white-hot centre) for large background light pools. Browser only. */
export function softSprite(hue: number, size = 256): HTMLCanvasElement {
  const key = `${Math.round(hue)}:${size}`;
  let sprite = softCache.get(key);
  if (!sprite) {
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = size;
    const g = sprite.getContext("2d");
    if (!g) throw new Error("2D canvas context unavailable");
    const r = size / 2;
    const gradient = g.createRadialGradient(r, r, 0, r, r, r);
    for (let i = 0; i <= 8; i++) { // smooth Gaussian-like fall-off
      const u = i / 8;
      gradient.addColorStop(u, hsla(hue, 0.85, 0.55, Math.exp(-4.2 * u * u) * (1 - u * u * u)));
    }
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
    softCache.set(key, sprite);
  }
  return sprite;
}

export function drawSoft(ctx: CanvasRenderingContext2D, x: number, y: number, diameter: number, hue: number, alpha: number) {
  if (alpha <= 0.002) return;
  ctx.globalAlpha = clamp01(alpha);
  ctx.drawImage(softSprite(hue), x - diameter / 2, y - diameter / 2, diameter, diameter);
  ctx.globalAlpha = 1;
}
