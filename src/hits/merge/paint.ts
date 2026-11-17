import { drawReelText, type ReelBox } from "../../shared/reelUtils.ts";
import {
  clamp,
  clamp01,
  createRng,
  drawChrome,
  drawStat,
  easeOutCubic,
  fillHudScrims,
  FPS,
  H,
  PALETTE,
  SAFE,
  SAFE_CENTER_X,
  smoothstep,
  W,
} from "../kit.ts";
import { HIT_SEED } from "../types.ts";
import { FLOOR_Y, MOUTH_X, MOUTH_Y, POS_SCALE, TUNING, type MergeTrace } from "./sim.ts";
import { MERGE_SPEC } from "./spec.ts";
import { FINAL_BANNER, TIER_COUNT, TIERS, tierInfo } from "./tiers.ts";

/**
 * FunnelMerge painter: one full 1080x1920 frame from the baked trace and the frame number.
 * Pieces are batched per tier (one path and one fill per layer), the ambient dots are batched per screen
 * cell, and every piece of text goes through `drawReelText` so the safe-bounds assertion runs on it.
 */

const TWO_PI = Math.PI * 2;
const FONT = '"Inter Variable", Inter, sans-serif';

/* ---------- small helpers ---------- */

const rgbMemo = new Map<string, readonly [number, number, number]>();
function rgbOf(hex: string): readonly [number, number, number] {
  let v = rgbMemo.get(hex);
  if (!v) {
    const n = Number.parseInt(hex.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbMemo.set(hex, v);
  }
  return v;
}
export function rgba(hex: string, a: number): string {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${a < 0 ? 0 : a > 1 ? 1 : a})`;
}

const easeOutBack = (t: number): number => {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

function hash01(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Left edge of a popup `width` px wide that is inside the safe text bounds (6 px margin), from the wanted left edge. */
export function clampPopupLeft(wantedLeft: number, width: number): number {
  return Math.max(SAFE.left + 6, Math.min(SAFE.right - 6 - width, wantedLeft));
}

/* ---------- layout ---------- */

const RUN = TUNING.rampRun;
const RISE = TUNING.rampRise;
const RAMP_Y = FLOOR_Y - RISE;
const SLOPE = RISE / RUN;

function surfaceY(x: number): number {
  if (x < RUN) return RAMP_Y + (Math.max(x, -60) / RUN) * RISE;
  if (x > W - RUN) return RAMP_Y + (Math.max(W - x, -60) / RUN) * RISE;
  return FLOOR_Y;
}

const TUBE_HALF = 52;
const NOZZLE_TOP = 596;
const LADDER_Y = 570;
const STATS_Y = 516;

/* ---------- per-trace cache ---------- */

interface PaintCache {
  mergeFrames: Uint16Array;
  spawnFrames: Uint16Array;
  spawnT: Float64Array;
  impactFrames: Uint16Array;
  madeByMerge: Uint8Array;
  finalFrame: number;
  /** Id of the first tier-7 piece, or 0. */
  finalId: number;
}

const caches = new WeakMap<MergeTrace, PaintCache>();

function cacheOf(trace: MergeTrace): PaintCache {
  let c = caches.get(trace);
  if (c) return c;
  const madeByMerge = new Uint8Array(trace.bornFrame.length + 1);
  for (const m of trace.merges) madeByMerge[m.newId] = 1;
  const firstFinal = trace.merges.find((m) => m.tier === TIER_COUNT);
  c = {
    mergeFrames: Uint16Array.from(trace.merges, (m) => m.frame),
    spawnFrames: Uint16Array.from(trace.spawns, (s) => Math.floor(s.sub / 4) + 1),
    spawnT: Float64Array.from(trace.spawns, (s) => s.t),
    impactFrames: Uint16Array.from(trace.impacts, (e) => Math.floor(e.sub / 4) + 1),
    madeByMerge,
    finalFrame: firstFinal ? firstFinal.frame : -1,
    finalId: firstFinal ? firstFinal.newId : 0,
  };
  caches.set(trace, c);
  return c;
}

/** Number of entries of the ascending `arr` that are <= v. */
function countAtOrBefore(arr: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/* ---------- ambient dots ---------- */

const DOT_COLS = 12;
const DOT_ROWS = 13;
export const AMBIENT_DOT_COUNT = DOT_COLS * DOT_ROWS;
const GROUP_COLS = 6;
const GROUP_ROWS = 10;

interface Dot {
  hx: number;
  hy: number;
  ax: number;
  ay: number;
  w1: number;
  w2: number;
  p1: number;
  p2: number;
  r: number;
}

const DOT_GROUPS: Dot[][] = Array.from({ length: GROUP_COLS * GROUP_ROWS }, () => []);
const DOT_TINTS = [PALETTE.cyan, PALETTE.limeSoft, "#a78bfa", "#e2e8f0"] as const;
{
  const rng = createRng(HIT_SEED ^ 0x1badf00d);
  for (let r = 0; r < DOT_ROWS; r++) {
    for (let c = 0; c < DOT_COLS; c++) {
      const hx = (c + rng.next()) * (W / DOT_COLS);
      const hy = (r + rng.next()) * (H / DOT_ROWS);
      const dot: Dot = {
        hx,
        hy,
        ax: rng.range(12, 46),
        ay: rng.range(12, 46),
        w1: TWO_PI / rng.range(5, 12),
        w2: TWO_PI / rng.range(6, 14),
        p1: rng.range(0, TWO_PI),
        p2: rng.range(0, TWO_PI),
        r: rng.range(1.3, 3.4),
      };
      const gc = Math.min(GROUP_COLS - 1, Math.floor((hx / W) * GROUP_COLS));
      const gr = Math.min(GROUP_ROWS - 1, Math.floor((hy / H) * GROUP_ROWS));
      DOT_GROUPS[gr * GROUP_COLS + gc].push(dot);
    }
  }
}

function drawAmbient(ctx: CanvasRenderingContext2D, t: number, tint: string): void {
  for (let g = 0; g < DOT_GROUPS.length; g++) {
    const dots = DOT_GROUPS[g];
    if (dots.length === 0) continue;
    ctx.fillStyle = rgba(g % 5 === 0 ? tint : DOT_TINTS[g % DOT_TINTS.length], 0.1 + 0.22 * (0.5 + 0.5 * Math.sin(t * 0.9 + g)));
    ctx.beginPath();
    for (const d of dots) {
      const x = d.hx + d.ax * Math.sin(d.w1 * t + d.p1);
      const y = d.hy + d.ay * Math.cos(d.w2 * t + d.p2);
      ctx.moveTo(x + d.r, y);
      ctx.arc(x, y, d.r, 0, TWO_PI);
    }
    ctx.fill();
  }
}

/* ---------- backdrop, bowl, deck ---------- */

function drawBackdrop(ctx: CanvasRenderingContext2D, f: number, top: number, finalGlow: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#101d38");
  g.addColorStop(0.34, "#0d1a33");
  g.addColorStop(0.7, "#0b1428");
  g.addColorStop(1, "#080d1a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const drift = Math.sin(f / 150) * 0.5 + 0.5;
  const glowA = ctx.createRadialGradient(W * (0.15 + 0.2 * drift), 760, 30, W * 0.3, 800, 760);
  glowA.addColorStop(0, "rgba(139,92,246,0.20)");
  glowA.addColorStop(1, "rgba(139,92,246,0)");
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, W, H);

  const glowB = ctx.createRadialGradient(W * (0.9 - 0.15 * drift), 1250, 30, W * 0.8, 1250, 820);
  glowB.addColorStop(0, "rgba(45,212,191,0.17)");
  glowB.addColorStop(1, "rgba(45,212,191,0)");
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, W, H);

  // the glow at the bottom of the bowl takes the colour of the highest tier reached
  const tint = top >= 1 ? tierInfo(top).color : PALETTE.cyan;
  const glowC = ctx.createRadialGradient(W / 2, 1250, 20, W / 2, 1250, 760);
  glowC.addColorStop(0, rgba(tint, 0.1 + 0.025 * top + 0.16 * finalGlow));
  glowC.addColorStop(1, rgba(tint, 0));
  ctx.fillStyle = glowC;
  ctx.fillRect(0, 560, W, H - 560);

  // tank grid
  ctx.strokeStyle = "rgba(130,170,230,0.055)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 90; x < W; x += 90) {
    ctx.moveTo(x, 640);
    ctx.lineTo(x, FLOOR_Y);
  }
  for (let y = 700; y < FLOOR_Y; y += 120) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
}

function polyline(ctx: CanvasRenderingContext2D, dy: number): void {
  const ext = 60;
  ctx.moveTo(-ext, RAMP_Y - ext * SLOPE + dy);
  ctx.lineTo(RUN, FLOOR_Y + dy);
  ctx.lineTo(W - RUN, FLOOR_Y + dy);
  ctx.lineTo(W + ext, RAMP_Y - ext * SLOPE + dy);
}

function drawBowl(ctx: CanvasRenderingContext2D, t: number, hit: number, top: number): void {
  // glass walls above the ramps
  const wallL = ctx.createLinearGradient(0, 0, 44, 0);
  wallL.addColorStop(0, "rgba(34,211,238,0.32)");
  wallL.addColorStop(1, "rgba(34,211,238,0)");
  ctx.fillStyle = wallL;
  ctx.fillRect(0, 640, 44, RAMP_Y - 600);
  const wallR = ctx.createLinearGradient(W, 0, W - 44, 0);
  wallR.addColorStop(0, "rgba(34,211,238,0.32)");
  wallR.addColorStop(1, "rgba(34,211,238,0)");
  ctx.fillStyle = wallR;
  ctx.fillRect(W - 44, 640, 44, RAMP_Y - 600);

  // ground mass under the surface
  const mass = ctx.createLinearGradient(0, RAMP_Y, 0, H);
  mass.addColorStop(0, "#112040");
  mass.addColorStop(0.3, "#0b1630");
  mass.addColorStop(1, "#060a16");
  ctx.fillStyle = mass;
  ctx.beginPath();
  polyline(ctx, 0);
  ctx.lineTo(W + 60, H + 60);
  ctx.lineTo(-60, H + 60);
  ctx.closePath();
  ctx.fill();

  // glass sheen right under the ramps
  ctx.fillStyle = "rgba(130,180,255,0.07)";
  ctx.beginPath();
  polyline(ctx, 0);
  ctx.lineTo(W + 60, RAMP_Y - 60 * SLOPE + 34);
  ctx.lineTo(W - RUN, FLOOR_Y + 34);
  ctx.lineTo(RUN, FLOOR_Y + 34);
  ctx.lineTo(-60, RAMP_Y - 60 * SLOPE + 34);
  ctx.closePath();
  ctx.fill();

  // plates: the first two follow the ramps only, the rest run under the whole deck
  ctx.lineWidth = 2;
  for (let i = 0; i < 2; i++) {
    const dy = 46 + 52 * i;
    ctx.strokeStyle = `rgba(80,125,200,${0.5 - i * 0.12})`;
    ctx.beginPath();
    ctx.moveTo(-60, RAMP_Y - 60 * SLOPE + dy);
    ctx.lineTo(RUN, FLOOR_Y + dy);
    ctx.moveTo(W - RUN, FLOOR_Y + dy);
    ctx.lineTo(W + 60, RAMP_Y - 60 * SLOPE + dy);
    ctx.stroke();
  }
  const deckPlates = [138, 206, 288, 384, 500];
  for (let i = 0; i < deckPlates.length; i++) {
    ctx.strokeStyle = `rgba(70,115,190,${0.46 - i * 0.07})`;
    ctx.beginPath();
    polyline(ctx, deckPlates[i]);
    ctx.stroke();
  }

  // LED row on the first deck plate: one light per tier, lit as the ladder fills
  for (let k = 0; k < TIER_COUNT; k++) {
    const lit = top >= k + 1;
    ctx.fillStyle = rgba(TIERS[k].color, lit ? 0.55 + 0.4 * Math.sin(t * 3.2 + k * 0.9) : 0.14);
    ctx.beginPath();
    for (let i = k; i < 21; i += TIER_COUNT) {
      const x = 32 + i * 50;
      const y = surfaceY(x) + 138;
      ctx.moveTo(x + 5, y);
      ctx.arc(x, y, 5, 0, TWO_PI);
    }
    ctx.fill();
  }

  // data packets running along two plates
  ctx.fillStyle = "rgba(200,255,0,0.8)";
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const x = ((t * 150 + i * 110) % (W + 160)) - 80;
    const y = surfaceY(x) + 206;
    ctx.moveTo(x + 4.5, y);
    ctx.arc(x, y, 4.5, 0, TWO_PI);
  }
  ctx.fill();
  ctx.fillStyle = "rgba(34,211,238,0.75)";
  ctx.beginPath();
  for (let i = 0; i < 9; i++) {
    const x = W - (((t * 105 + i * 150) % (W + 160)) - 80);
    const y = surfaceY(x) + 288;
    ctx.moveTo(x + 4, y);
    ctx.arc(x, y, 4, 0, TWO_PI);
  }
  ctx.fill();

  // surface edge: soft glow, steel, neon
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = `rgba(34,211,238,${0.12 + 0.1 * hit})`;
  ctx.lineWidth = 20;
  ctx.beginPath();
  polyline(ctx, 0);
  ctx.stroke();
  ctx.strokeStyle = "#22365c";
  ctx.lineWidth = 8;
  ctx.beginPath();
  polyline(ctx, 0);
  ctx.stroke();
  const edge = ctx.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, PALETTE.cyan);
  edge.addColorStop(0.5, PALETTE.lime);
  edge.addColorStop(1, PALETTE.cyan);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  polyline(ctx, 0);
  ctx.stroke();
}

/* ---------- tube ---------- */

function drawPipeGlass(ctx: CanvasRenderingContext2D, t: number): void {
  const x0 = MOUTH_X - TUBE_HALF;
  const body = ctx.createLinearGradient(x0, 0, x0 + 2 * TUBE_HALF, 0);
  body.addColorStop(0, "rgba(150,195,255,0.13)");
  body.addColorStop(0.2, "rgba(255,255,255,0.20)");
  body.addColorStop(0.5, "rgba(120,160,230,0.07)");
  body.addColorStop(0.82, "rgba(255,255,255,0.13)");
  body.addColorStop(1, "rgba(150,195,255,0.12)");
  ctx.fillStyle = body;
  ctx.fillRect(x0, -20, 2 * TUBE_HALF, NOZZLE_TOP + 24);
  ctx.strokeStyle = "rgba(190,225,255,0.34)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, -20);
  ctx.lineTo(x0, NOZZLE_TOP + 4);
  ctx.moveTo(x0 + 2 * TUBE_HALF, -20);
  ctx.lineTo(x0 + 2 * TUBE_HALF, NOZZLE_TOP + 4);
  ctx.stroke();
  // little lime motes streaming down the pipe
  ctx.fillStyle = "rgba(200,255,0,0.55)";
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const y = ((t * 520 + i * 54) % (NOZZLE_TOP + 40)) - 20;
    const x = MOUTH_X + 22 * Math.sin(i * 2.1 + t * 0.6);
    ctx.moveTo(x + 3, y);
    ctx.arc(x, y, 3, 0, TWO_PI);
  }
  ctx.fill();
}

function nozzlePath(ctx: CanvasRenderingContext2D): void {
  const l = MOUTH_X - TUBE_HALF - 4;
  const r = MOUTH_X + TUBE_HALF + 4;
  ctx.beginPath();
  ctx.moveTo(l, NOZZLE_TOP - 6);
  ctx.lineTo(l, NOZZLE_TOP + 14);
  ctx.quadraticCurveTo(l - 4, MOUTH_Y - 6, MOUTH_X - 92, MOUTH_Y + 2);
  ctx.lineTo(MOUTH_X + 92, MOUTH_Y + 2);
  ctx.quadraticCurveTo(r + 4, MOUTH_Y - 6, r, NOZZLE_TOP + 14);
  ctx.lineTo(r, NOZZLE_TOP - 6);
  ctx.closePath();
}

/** The nozzle is drawn after the pieces, so a dropped piece looks like it leaves from inside it. */
function drawNozzle(ctx: CanvasRenderingContext2D, t: number, charge: number, kick: number): void {
  const metal = ctx.createLinearGradient(MOUTH_X - 96, 0, MOUTH_X + 96, 0);
  metal.addColorStop(0, "#1b2740");
  metal.addColorStop(0.25, "#4a5c82");
  metal.addColorStop(0.5, "#2a3858");
  metal.addColorStop(0.8, "#3d4e72");
  metal.addColorStop(1, "#18223a");
  ctx.fillStyle = metal;
  nozzlePath(ctx);
  ctx.fill();
  ctx.strokeStyle = "rgba(190,225,255,0.4)";
  ctx.lineWidth = 2;
  nozzlePath(ctx);
  ctx.stroke();

  // glow of the next piece charging inside the nozzle
  const glow = ctx.createRadialGradient(MOUTH_X, MOUTH_Y - 4, 4, MOUTH_X, MOUTH_Y - 4, 120);
  glow.addColorStop(0, `rgba(200,255,0,${0.12 + 0.5 * charge + 0.3 * kick})`);
  glow.addColorStop(1, "rgba(200,255,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(MOUTH_X - 130, MOUTH_Y - 120, 260, 190);

  // the lip
  ctx.strokeStyle = `rgba(200,255,0,${0.55 + 0.35 * Math.max(charge, kick)})`;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(MOUTH_X - 92, MOUTH_Y + 2);
  ctx.lineTo(MOUTH_X + 92, MOUTH_Y + 2);
  ctx.stroke();
  ctx.strokeStyle = `rgba(200,255,0,${0.12 + 0.1 * Math.sin(t * 5)})`;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(MOUTH_X - 86, MOUTH_Y + 4);
  ctx.lineTo(MOUTH_X + 86, MOUTH_Y + 4);
  ctx.stroke();
}

/* ---------- pieces ---------- */

const POP_FRAMES = 14;
const FLASH_FRAMES = 8;
const scratch = {
  idx: new Int32Array(512),
  x: new Float32Array(512),
  y: new Float32Array(512),
  r: new Float32Array(512),
  id: new Int32Array(512),
};

function popScale(ageFrames: number, made: boolean): number {
  if (!made || ageFrames >= POP_FRAMES) return 1;
  return 1 + 0.12 * Math.sin((Math.PI * ageFrames) / POP_FRAMES);
}

function circles(ctx: CanvasRenderingContext2D, n: number, scale: number, dx: number, dy: number, dr = 0): void {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const r = scratch.r[i] * scale + dr;
    if (r <= 0) continue;
    const x = scratch.x[i] + dx * scratch.r[i];
    const y = scratch.y[i] + dy * scratch.r[i];
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TWO_PI);
  }
}

function drawAura(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, glow: number): void {
  const color = TIERS[TIER_COUNT - 1].color;
  const aura = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.5);
  aura.addColorStop(0, rgba(color, 0.42 * glow));
  aura.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = aura;
  ctx.fillRect(x - r * 2.6, y - r * 2.6, r * 5.2, r * 5.2);
  // slowly turning rays
  ctx.fillStyle = rgba(color, 0.16 * glow);
  ctx.beginPath();
  const rays = 14;
  const spin = t * 0.35;
  for (let k = 0; k < rays; k++) {
    const a = spin + (k / rays) * TWO_PI;
    const half = 0.1 + 0.03 * Math.sin(t * 2 + k);
    const long = r * (1.55 + 0.18 * Math.sin(t * 3 + k * 1.7));
    ctx.moveTo(x + Math.cos(a - half) * r * 1.0, y + Math.sin(a - half) * r * 1.0);
    ctx.lineTo(x + Math.cos(a) * long, y + Math.sin(a) * long);
    ctx.lineTo(x + Math.cos(a + half) * r * 1.0, y + Math.sin(a + half) * r * 1.0);
  }
  ctx.fill();
  ctx.strokeStyle = rgba("#f7ffcc", 0.55 * glow);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, r + 10 + 7 * Math.sin(t * 3.4), 0, TWO_PI);
  ctx.stroke();
}

/** Lime embers drifting off the final form during the hold. Deterministic from the frame number. */
function drawEmbers(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, sinceSec: number): void {
  const n = 44;
  const fadeIn = clamp01(sinceSec / 0.5);
  for (let band = 0; band < 3; band++) {
    ctx.fillStyle = rgba("#e8ff66", (0.85 - 0.25 * band) * fadeIn);
    ctx.beginPath();
    for (let k = band; k < n; k += 3) {
      const life = (sinceSec * 0.55 + hash01(k * 7.3) + k / n) % 1;
      const ang = hash01(k * 3.1 + 5) * TWO_PI;
      const dist = r * (0.95 + 0.9 * life) + 20 * hash01(k * 1.7);
      const px = x + Math.cos(ang) * dist + 14 * Math.sin(sinceSec * 2 + k);
      const py = y + Math.sin(ang) * dist - 140 * life;
      const rr = (2.4 + 3.4 * hash01(k * 9.9)) * (1 - life * 0.6);
      ctx.moveTo(px + rr, py);
      ctx.arc(px, py, rr, 0, TWO_PI);
    }
    ctx.fill();
  }
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  name: string,
  x: number,
  y: number,
  r: number,
  tierIdx: number,
): void {
  const size = Math.max(17, Math.min(98, r * 0.52));
  const halfW = (name.length * size * 0.6) / 2 + 2;
  const base = y + size * 0.3;
  const margin = Math.min(x - halfW - SAFE.left, SAFE.right - (x + halfW), base - size * 0.8 - SAFE.top, SAFE.bottom - (base + size * 0.24));
  // fade a label out before its box could touch the safe bounds (8 px of slack for font differences)
  const alpha = clamp01((margin - 8) / 26);
  if (alpha <= 0.04) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  drawReelText(ctx, boxes, name, x, base, {
    size,
    weight: 800,
    align: "center",
    maxWidth: Math.max(30, r * 1.55),
    color: tierIdx === TIER_COUNT - 1 ? "#1d3300" : "#0a1220",
  });
  ctx.restore();
}

/** Faint streaks behind fast movers (a fresh drop, a hard landing): the piece's path over the last 3 frames. */
function drawTrails(ctx: CanvasRenderingContext2D, trace: MergeTrace, f: number): void {
  if (f < 3) return;
  const k0 = trace.frameStart[f];
  const k1 = trace.frameStart[f + 1];
  const p0 = trace.frameStart[f - 3];
  const p1 = trace.frameStart[f - 2];
  ctx.lineCap = "round";
  for (let tier = 1; tier <= TIER_COUNT; tier++) {
    let any = false;
    for (let k = k0; k < k1; k++) {
      if (trace.ptier[k] !== tier) continue;
      const id = trace.pid[k];
      let j = p0;
      while (j < p1 && trace.pid[j] !== id) j++;
      if (j >= p1) continue;
      const x = trace.px[k] / POS_SCALE;
      const y = trace.py[k] / POS_SCALE;
      const px = trace.px[j] / POS_SCALE;
      const py = trace.py[j] / POS_SCALE;
      if ((x - px) ** 2 + (y - py) ** 2 < 36 * 36) continue;
      if (!any) {
        ctx.strokeStyle = rgba(TIERS[tier - 1].color, 0.16);
        ctx.lineWidth = TIERS[tier - 1].radius * 1.5;
        ctx.beginPath();
        any = true;
      }
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
    }
    if (any) ctx.stroke();
  }
}

function drawPieces(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  trace: MergeTrace,
  cache: PaintCache,
  f: number,
  t: number,
  finalGlow: number,
): void {
  const k0 = trace.frameStart[f];
  const k1 = trace.frameStart[f + 1];

  // tier-7 halo goes behind everything
  for (let k = k0; k < k1; k++) {
    if (trace.ptier[k] !== TIER_COUNT) continue;
    const id = trace.pid[k];
    const age = f - trace.bornFrame[id];
    const sc = popScale(age, cache.madeByMerge[id] === 1);
    const ax = trace.px[k] / POS_SCALE;
    const ay = trace.py[k] / POS_SCALE;
    const ar = (trace.pr[k] / POS_SCALE) * sc;
    drawAura(ctx, ax, ay, ar, t, 0.65 + 0.35 * finalGlow);
    if (id === cache.finalId) drawEmbers(ctx, ax, ay, ar, (f - cache.finalFrame) / FPS);
  }

  drawTrails(ctx, trace, f);

  for (let tier = TIER_COUNT; tier >= 1; tier--) {
    const info = TIERS[tier - 1];
    let n = 0;
    for (let k = k0; k < k1 && n < 500; k++) {
      if (trace.ptier[k] !== tier) continue;
      const id = trace.pid[k];
      const sc = popScale(f - trace.bornFrame[id], cache.madeByMerge[id] === 1);
      scratch.x[n] = trace.px[k] / POS_SCALE;
      scratch.y[n] = trace.py[k] / POS_SCALE;
      scratch.r[n] = (trace.pr[k] / POS_SCALE) * sc;
      n++;
    }
    if (n === 0) continue;
    // glow
    ctx.fillStyle = rgba(info.color, 0.06);
    circles(ctx, n, 1, 0, 0, 20);
    ctx.fill();
    ctx.fillStyle = rgba(info.color, 0.1);
    circles(ctx, n, 1, 0, 0, 11);
    ctx.fill();
    ctx.fillStyle = rgba(info.color, 0.18);
    circles(ctx, n, 1, 0, 0, 5);
    ctx.fill();
    // rim, then the body shifted up and left so the rim reads as a bevel
    ctx.fillStyle = info.dark;
    circles(ctx, n, 1, 0, 0);
    ctx.fill();
    ctx.fillStyle = info.color;
    circles(ctx, n, 0.92, -0.035, -0.045);
    ctx.fill();
    // soft shade low on the right, then the highlights
    ctx.fillStyle = rgba(info.dark, 0.22);
    circles(ctx, n, 0.62, 0.2, 0.26);
    ctx.fill();
    ctx.fillStyle = rgba(info.light, 0.42);
    circles(ctx, n, 0.4, -0.3, -0.34);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    circles(ctx, n, 0.13, -0.39, -0.43);
    ctx.fill();
  }

  // pop flash on freshly merged pieces
  let flashes = 0;
  for (let k = k0; k < k1 && flashes < 64; k++) {
    const id = trace.pid[k];
    if (cache.madeByMerge[id] !== 1) continue;
    const age = f - trace.bornFrame[id];
    if (age < 0 || age >= FLASH_FRAMES) continue;
    const r = (trace.pr[k] / POS_SCALE) * popScale(age, true);
    ctx.fillStyle = `rgba(255,255,255,${0.85 * (1 - age / FLASH_FRAMES) ** 1.5})`;
    ctx.beginPath();
    ctx.arc(trace.px[k] / POS_SCALE, trace.py[k] / POS_SCALE, r, 0, TWO_PI);
    ctx.fill();
    flashes++;
  }

  // labels last, smaller tiers first so a big label is never covered
  for (let tier = 1; tier <= TIER_COUNT; tier++) {
    const name = TIERS[tier - 1].name;
    for (let k = k0; k < k1; k++) {
      if (trace.ptier[k] !== tier) continue;
      const id = trace.pid[k];
      const sc = popScale(f - trace.bornFrame[id], cache.madeByMerge[id] === 1);
      const r = (trace.pr[k] / POS_SCALE) * sc;
      drawLabel(ctx, boxes, name, trace.px[k] / POS_SCALE, trace.py[k] / POS_SCALE, r, tier - 1);
    }
  }
}

/* ---------- effects ---------- */

const RING_FRAMES = 30;
const SPARK_FRAMES = 34;
const SPARK_GRAVITY = 1100;

function drawMergeEffects(ctx: CanvasRenderingContext2D, trace: MergeTrace, cache: PaintCache, f: number): void {
  const to = countAtOrBefore(cache.mergeFrames, f);
  for (let i = to - 1; i >= 0; i--) {
    const m = trace.merges[i];
    const ageF = f - m.frame;
    if (ageF > RING_FRAMES) break;
    if (ageF < 0) continue;
    const info = TIERS[m.tier - 1];
    const p = ageF / RING_FRAMES;
    // flash of light at the merge point
    if (ageF < 12) {
      const k = 1 - ageF / 12;
      const g = ctx.createRadialGradient(m.x, m.y, 2, m.x, m.y, info.radius * 1.8);
      g.addColorStop(0, rgba(info.light, 0.5 * k));
      g.addColorStop(1, rgba(info.light, 0));
      ctx.fillStyle = g;
      ctx.fillRect(m.x - info.radius * 1.9, m.y - info.radius * 1.9, info.radius * 3.8, info.radius * 3.8);
    }
    // shockwave ring
    const ring = info.radius + 8 + easeOutCubic(p) * (30 + 11 * m.tier);
    ctx.strokeStyle = rgba(info.color, 0.8 * (1 - p) ** 1.5);
    ctx.lineWidth = 2 + 6 * (1 - p);
    ctx.beginPath();
    ctx.arc(m.x, m.y, ring, 0, TWO_PI);
    ctx.stroke();
    // sparks
    if (ageF < SPARK_FRAMES) {
      const tau = ageF / FPS;
      const life = ageF / SPARK_FRAMES;
      const n = 7 + 2 * m.tier;
      ctx.fillStyle = rgba(info.light, 0.95 * (1 - life) ** 1.2);
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const a = ((k + hash01(m.index * 31 + k)) / n) * TWO_PI;
        const sp = 190 + 340 * hash01(m.index * 17 + k * 3 + 1);
        const x = m.x + Math.cos(a) * sp * tau * (1 - 0.35 * life);
        const y = m.y + Math.sin(a) * sp * tau * (1 - 0.35 * life) - 120 * tau + 0.5 * SPARK_GRAVITY * tau * tau;
        const r = 1 + (2.2 + 0.5 * m.tier) * (1 - life);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TWO_PI);
      }
      ctx.fill();
    }
  }
}

function drawImpactPuffs(ctx: CanvasRenderingContext2D, trace: MergeTrace, cache: PaintCache, f: number): void {
  const to = countAtOrBefore(cache.impactFrames, f);
  for (let i = to - 1; i >= 0; i--) {
    const e = trace.impacts[i];
    const ageF = f - cache.impactFrames[i];
    if (ageF > 12) break;
    const p = ageF / 12;
    ctx.strokeStyle = `rgba(190,225,255,${0.5 * (1 - p)})`;
    ctx.lineWidth = 2 + 3 * (1 - p);
    ctx.beginPath();
    ctx.arc(e.x, e.y, 8 + 34 * easeOutCubic(p), 0, TWO_PI);
    ctx.stroke();
  }
}

/** How hard the surface edge is lit: recent floor hits. */
function surfaceHit(trace: MergeTrace, cache: PaintCache, f: number): number {
  const to = countAtOrBefore(cache.impactFrames, f);
  let k = 0;
  for (let i = to - 1; i >= 0 && f - cache.impactFrames[i] <= 10; i--) k = Math.max(k, 1 - (f - cache.impactFrames[i]) / 10);
  return k;
}

function cameraShake(trace: MergeTrace, cache: PaintCache, f: number): [number, number] {
  const to = countAtOrBefore(cache.mergeFrames, f);
  let amp = 0;
  for (let i = to - 1; i >= 0 && f - cache.mergeFrames[i] <= 24; i--) {
    const m = trace.merges[i];
    const k = 1 - (f - m.frame) / 24;
    const a = m.tier === TIER_COUNT ? 12 : m.tier >= 5 ? 2.2 * (m.tier - 4) : 0;
    amp = Math.max(amp, a * k * k);
  }
  return [amp * Math.sin(f * 2.3), amp * Math.cos(f * 1.9)];
}

/* ---------- spawn rhythm ---------- */

function spawnState(cache: PaintCache, f: number): { charge: number; kick: number } {
  const t = f / FPS;
  const n = countAtOrBefore(cache.spawnT, t);
  const nextT = n < cache.spawnT.length ? cache.spawnT[n] : Number.POSITIVE_INFINITY;
  const lastF = n > 0 ? cache.spawnFrames[n - 1] : -1000;
  const charge = clamp01(1 - (nextT - t) / 0.14);
  const kick = clamp01(1 - (f - lastF) / 9);
  return { charge, kick };
}

function drawMouthRings(ctx: CanvasRenderingContext2D, cache: PaintCache, f: number): void {
  const n = countAtOrBefore(cache.spawnFrames, f);
  for (let i = n - 1; i >= 0 && f - cache.spawnFrames[i] <= 14; i--) {
    const p = (f - cache.spawnFrames[i]) / 14;
    ctx.strokeStyle = `rgba(200,255,0,${0.7 * (1 - p)})`;
    ctx.lineWidth = 2 + 5 * (1 - p);
    ctx.beginPath();
    ctx.arc(MOUTH_X, MOUTH_Y + 2, 24 + 80 * easeOutCubic(p), 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
}

/* ---------- HUD ---------- */

function drawLadder(ctx: CanvasRenderingContext2D, boxes: ReelBox[], top: number, t: number, justReached: number): void {
  // scrim so the names stay readable over the pipe
  ctx.fillStyle = "rgba(5,10,20,0.58)";
  ctx.beginPath();
  ctx.roundRect(50, LADDER_Y - 28, 860, 56, 28);
  ctx.fill();
  ctx.strokeStyle = "rgba(160,200,255,0.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(50, LADDER_Y - 28, 860, 56, 28);
  ctx.stroke();

  for (let i = 0; i < TIER_COUNT; i++) {
    const info = TIERS[i];
    const x0 = SAFE.left + 120 * i;
    const cx = x0 + 22;
    const reached = top >= i + 1;
    const isTop = top === i + 1;
    if (reached) {
      const k = isTop ? 1 + 0.16 * justReached : 1;
      ctx.fillStyle = rgba(info.color, 0.22);
      ctx.beginPath();
      ctx.arc(cx, LADDER_Y, 24 * k, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = info.dark;
      ctx.beginPath();
      ctx.arc(cx, LADDER_Y, 17.5 * k, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = info.color;
      ctx.beginPath();
      ctx.arc(cx - 0.6, LADDER_Y - 0.8, 15 * k, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = rgba(info.light, 0.5);
      ctx.beginPath();
      ctx.arc(cx - 5, LADDER_Y - 6, 6 * k, 0, TWO_PI);
      ctx.fill();
    } else {
      const goal = i === TIER_COUNT - 1 && top >= TIER_COUNT - 1;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.arc(cx, LADDER_Y, 17, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = goal ? rgba(info.color, 0.45 + 0.4 * Math.sin(t * 7)) : "rgba(255,255,255,0.22)";
      ctx.lineWidth = goal ? 3.5 : 2;
      ctx.beginPath();
      ctx.arc(cx, LADDER_Y, 17, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 8;
    drawReelText(ctx, boxes, info.name, x0 + 50, LADDER_Y + 8, {
      size: 23,
      weight: 700,
      align: "left",
      maxWidth: 66,
      color: reached ? PALETTE.ink : "rgba(167,182,197,0.55)",
    });
    ctx.restore();
  }
}

function chainColor(c: number): string {
  if (c >= 6) return PALETTE.coral;
  if (c >= 4) return PALETTE.amber;
  if (c >= 3) return PALETTE.lime;
  return PALETTE.limeSoft;
}

function drawPopups(ctx: CanvasRenderingContext2D, boxes: ReelBox[], trace: MergeTrace, cache: PaintCache, f: number): void {
  const to = countAtOrBefore(cache.mergeFrames, f);
  let shown = 0;
  let lastX = -9999;
  for (let i = to - 1; i >= 0 && shown < 2; i--) {
    const m = trace.merges[i];
    const ageF = f - m.frame;
    if (ageF > 52) break;
    if (m.chain < 2 || ageF < 0) continue;
    // a cascade climbs x2, x3, x4 in one place: only the newest count is shown there
    if (Math.abs(m.x - lastX) < 190) continue;
    lastX = m.x;
    shown++;
    const p = ageF / 52;
    const size = 42 + 9 * Math.min(m.chain - 2, 4);
    const text = `x${m.chain}`;
    ctx.font = `800 ${size}px ${FONT}`;
    const w = ctx.measureText(text).width;
    const info = TIERS[m.tier - 1];
    const cx = m.x;
    const cy = m.y - info.radius - 22 - 80 * easeOutCubic(p);
    const left = clampPopupLeft(cx - w / 2, w);
    // never above the banner's lane (it ends at y 854), never into the deck
    const baseline = clamp(cy, 930, 1430);
    ctx.save();
    ctx.globalAlpha = p < 0.65 ? 1 : (1 - p) / 0.35;
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 14;
    drawReelText(ctx, boxes, text, left, baseline, {
      size,
      weight: 800,
      align: "left",
      maxWidth: w + 60,
      color: chainColor(m.chain),
    });
    ctx.restore();
  }
}

function drawBanner(ctx: CanvasRenderingContext2D, boxes: ReelBox[], ageSec: number, t: number): void {
  const k = easeOutBack(ageSec / 0.4);
  const a = clamp01(ageSec / 0.2);
  const y0 = 738;
  ctx.fillStyle = `rgba(5,9,16,${0.78 * a})`;
  ctx.beginPath();
  ctx.roundRect(SAFE.left - 8, y0, SAFE.right - SAFE.left + 16, 116, 34);
  ctx.fill();
  ctx.strokeStyle = rgba(PALETTE.lime, 0.75 * a);
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.roundRect(SAFE.left - 8, y0, SAFE.right - SAFE.left + 16, 116, 34);
  ctx.stroke();
  ctx.save();
  ctx.globalAlpha = a;
  ctx.shadowColor = rgba(PALETTE.lime, 0.55 + 0.25 * Math.sin(t * 6));
  ctx.shadowBlur = 30;
  drawReelText(ctx, boxes, FINAL_BANNER, SAFE_CENTER_X, y0 + 78, {
    size: 78 * (0.74 + 0.26 * Math.min(1, k)),
    weight: 900,
    align: "center",
    maxWidth: SAFE.right - SAFE.left - 20,
    color: PALETTE.lime,
  });
  ctx.restore();
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  trace: MergeTrace,
  cache: PaintCache,
  f: number,
  t: number,
): void {
  const top = trace.topTier[f];
  const merges = trace.mergeCount[f];
  const live = trace.chainLive[f];
  const lastMergeFrame = merges > 0 ? trace.merges[merges - 1].frame : -1000;
  const bump = clamp01(1 - (f - lastMergeFrame) / 12);
  const justReached = top >= 2 ? clamp01(1 - (f - (trace.merges.find((m) => m.tier === top)?.frame ?? -1000)) / 24) : 0;

  drawStat(ctx, boxes, {
    label: "TIER",
    value: `${top}/${TIER_COUNT}`,
    x: SAFE.left + 4,
    y: STATS_Y,
    align: "left",
    valueSize: 54 + 6 * justReached,
    color: top >= 1 ? tierInfo(top).color : PALETTE.muted,
  });
  drawStat(ctx, boxes, {
    label: "MERGES",
    value: String(merges),
    x: SAFE_CENTER_X,
    y: STATS_Y,
    align: "center",
    valueSize: 54 + 8 * bump,
    color: PALETTE.ink,
    maxWidth: 240,
  });
  if (live >= 2) {
    drawStat(ctx, boxes, {
      label: "CHAIN",
      value: `x${live}`,
      x: SAFE.right - 4,
      y: STATS_Y,
      align: "right",
      valueSize: 54 + 10 * bump,
      color: chainColor(live),
      maxWidth: 200,
    });
  }
  drawLadder(ctx, boxes, top, t, justReached);
  drawPopups(ctx, boxes, trace, cache, f);
  if (cache.finalFrame >= 0 && f >= cache.finalFrame) drawBanner(ctx, boxes, (f - cache.finalFrame) / FPS, t);
}

/* ---------- main ---------- */

/** The CTA and seed lines sit on the deck (y 1478 to 1548); a quiet plate keeps them readable over any glow. */
function drawCaptionPlate(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(4,8,16,0.74)";
  ctx.beginPath();
  ctx.roundRect(40, FLOOR_Y + 8, 880, 114, 28);
  ctx.fill();
  ctx.strokeStyle = "rgba(160,200,255,0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(40, FLOOR_Y + 8, 880, 114, 28);
  ctx.stroke();
}

export function paintMerge(ctx: CanvasRenderingContext2D, trace: MergeTrace, frame: number): ReelBox[] {
  const boxes: ReelBox[] = [];
  const f = clamp(Math.floor(frame), 0, trace.frames - 1);
  const t = f / FPS;
  const cache = cacheOf(trace);
  const top = trace.topTier[f];
  const sinceFinal = cache.finalFrame >= 0 && f >= cache.finalFrame ? (f - cache.finalFrame) / FPS : -1;
  const finalGlow = sinceFinal >= 0 ? smoothstep(0, 0.6, sinceFinal) : 0;

  drawBackdrop(ctx, f, top, finalGlow);

  const [sx, sy] = cameraShake(trace, cache, f);
  const { charge, kick } = spawnState(cache, f);
  ctx.save();
  ctx.translate(sx, sy);
  drawBowl(ctx, t, surfaceHit(trace, cache, f), top);
  drawAmbient(ctx, t, top >= 1 ? tierInfo(top).color : PALETTE.cyan);
  drawPipeGlass(ctx, t);
  drawPieces(ctx, boxes, trace, cache, f, t, finalGlow);
  drawImpactPuffs(ctx, trace, cache, f);
  drawMergeEffects(ctx, trace, cache, f);
  drawNozzle(ctx, t, charge, kick);
  drawMouthRings(ctx, cache, f);
  ctx.restore();

  fillHudScrims(ctx, 560, 1);

  if (sinceFinal >= 0 && sinceFinal < 0.5) {
    ctx.fillStyle = `rgba(255,255,255,${0.36 * (1 - sinceFinal / 0.5) ** 2})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (sinceFinal >= 0 && sinceFinal < 1.2) drawFinalRings(ctx, trace, sinceFinal);

  drawCaptionPlate(ctx);
  drawChrome(ctx, boxes, MERGE_SPEC);
  drawHud(ctx, boxes, trace, cache, f, t);
  return boxes;
}

function drawFinalRings(ctx: CanvasRenderingContext2D, trace: MergeTrace, sinceFinal: number): void {
  const m = trace.merges.find((x) => x.tier === TIER_COUNT);
  if (!m) return;
  for (let k = 0; k < 3; k++) {
    const p = clamp01((sinceFinal - k * 0.14) / 0.9);
    if (p <= 0 || p >= 1) continue;
    ctx.strokeStyle = rgba(k === 1 ? "#ffffff" : PALETTE.lime, 0.8 * (1 - p) ** 1.3);
    ctx.lineWidth = 16 * (1 - p) + 2;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 200 + easeOutCubic(p) * (520 + 160 * k), 0, TWO_PI);
    ctx.stroke();
  }
}
