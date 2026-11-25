import { drawReelText, type ReelBox } from "../../shared/reelUtils.ts";
import {
  FPS,
  H,
  PALETTE,
  SAFE_CENTER_X,
  W,
  clamp01,
  createRng,
  drawChrome,
  drawResult,
  drawStat,
  easeOutCubic,
  fillBackdrop,
  smoothstep,
} from "../kit.ts";
import { HIT_SEED } from "../types.ts";
import { BRICK, WALL, ballAtStep, slotSpan, type BrickTrace } from "./sim.ts";
import { BRICK_SPEC } from "./spec.ts";

export interface PaintStats {
  /** Bricks drawn this frame. */
  bricks: number;
  /** Balls drawn this frame (the ball counts while any of it is on screen). */
  balls: number;
  /** Ambient drifting dots drawn this frame. */
  dots: number;
  escaped: boolean;
}

const TAU = Math.PI * 2;
const R = BRICK.ballR;
const DOOR_Y = BRICK.doorY;
const POP = BRICK.popFrames;
/** Frames the exit posts take to glide to a new width after a brick lands. */
const DOOR_EASE = 8;
const STEPS_PER_FRAME = BRICK.stepHz / FPS;

const LIME = ["#b6e600", "#c8ff00", "#dcff5c"] as const;
const VIOLET = ["#7747dd", "#8b5cf6", "#a58bff"] as const;
const BRICK_COLORS = [...LIME, ...VIOLET] as const;

/* ---------- precomputed, seeded decoration (identical on every run) ---------- */

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  ph: number;
  c: string;
}
const DOT_COLORS = ["#c8ff85", "#a78bfa", "#67e8f9", "#f4f5f7", "#8b5cf6", "#c8ff00"] as const;
const DOTS: readonly Dot[] = (() => {
  const rng = createRng(HIT_SEED ^ 0xb71c);
  return Array.from({ length: 150 }, () => ({
    x: rng.range(0, W),
    y: rng.range(0, H),
    vx: rng.range(-0.22, 0.22),
    vy: rng.range(-0.55, -0.08),
    r: rng.range(1.3, 3.8),
    a: rng.range(0.22, 0.6),
    ph: rng.range(0, TAU),
    c: rng.pick(DOT_COLORS),
  }));
})();

const BOKEH = (() => {
  const rng = createRng(HIT_SEED ^ 0x3a91);
  return Array.from({ length: 9 }, (_, i) => ({
    x: rng.range(80, W - 80),
    y: rng.range(260, H - 200),
    vx: rng.range(-0.14, 0.14),
    vy: rng.range(-0.22, 0.22),
    r: rng.range(190, 360),
    c: (["139,92,246", "45,212,191", "139,92,246", "34,211,238", "200,255,0"] as const)[i % 5],
    a: rng.range(0.1, 0.17),
  }));
})();

const CONFETTI = (() => {
  const rng = createRng(HIT_SEED ^ 0x77e1);
  return Array.from({ length: 90 }, (_, i) => ({
    ang: rng.range(-1.25, 1.25),
    speed: rng.range(10, 30),
    size: rng.range(3, 7.5),
    color: i % 4,
    wobble: rng.range(0, TAU),
  }));
})();
const CONFETTI_COLORS = ["#c8ff00", "#a58bff", "#fff7e0", "#fbbf24"] as const;

const hash01 = (a: number, b: number): number => {
  let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) % 100000) / 100000;
};

const easeOutBack = (t: number): number => {
  const c = 1.9;
  const x = clamp01(t) - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/* ---------- per-trace derived data (pure, cached by trace object) ---------- */

interface Derived {
  /** Exit width the viewer sees: posts glide to the new width after each brick. */
  doorVis: Float32Array;
  /** Integrated pulse phase of the exit glow; the pulse gets faster as the exit narrows. */
  phase: Float32Array;
  /** x, y, w, h of every brick. */
  box: Float32Array;
  group: Uint8Array;
}
const derivedCache = new WeakMap<BrickTrace, Derived>();

function derive(trace: BrickTrace): Derived {
  const cached = derivedCache.get(trace);
  if (cached) return cached;
  const n = trace.sceneFrames;
  const doorVis = new Float32Array(n);
  const phase = new Float32Array(n);
  const { doorW0, doorDelta } = trace.params;
  let ph = 0;
  for (let f = 0; f < n; f++) {
    let taken = 0;
    for (let i = 0; i < trace.bricksAt[f]; i++) {
      const age = f - trace.bricks[i].frame;
      taken += age >= DOOR_EASE ? 1 : easeOutCubic(age / DOOR_EASE);
    }
    const w = Math.max(0, doorW0 - doorDelta * taken);
    doorVis[f] = w;
    phase[f] = ph;
    const closed = doorW0 > 0 ? 1 - w / doorW0 : 1;
    ph += (0.9 + 4.6 * closed ** 1.6) / FPS;
  }
  const box = new Float32Array(trace.bricks.length * 4);
  const group = new Uint8Array(trace.bricks.length);
  const L = BRICK.lining;
  const D = BRICK.brickDepth;
  trace.bricks.forEach((b, i) => {
    const off = L + D * (b.level - 1);
    const span = slotSpan(b.wall);
    let x: number;
    let y: number;
    let w: number;
    let h: number;
    if (b.wall === WALL.left) [x, y, w, h] = [off, b.slot * span, D, span];
    else if (b.wall === WALL.right) [x, y, w, h] = [W - off - D, b.slot * span, D, span];
    else if (b.wall === WALL.top) [x, y, w, h] = [b.slot * span, off, span, D];
    else [x, y, w, h] = [b.slot * span, H - off - D, span, D];
    box.set([x, y, w, h], i * 4);
    const colour = (b.slot + b.level) & 1;
    group[i] = colour * 3 + ((b.wall * 7 + b.slot * 3 + b.level * 5) % 3);
  });
  const out = { doorVis, phase, box, group };
  derivedCache.set(trace, out);
  return out;
}

/* ---------- layers ---------- */

function drawChamberPattern(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = "rgba(150,110,255,0.115)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const rowH = 64;
  const brickW = 144;
  for (let row = 0; row * rowH < H; row++) {
    const y = row * rowH;
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    for (let x = row & 1 ? brickW / 2 : 0; x < W; x += brickW) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + rowH);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawAmbient(ctx: CanvasRenderingContext2D, f: number): number {
  for (const b of BOKEH) {
    const x = b.x + Math.sin(f * 0.006 + b.vx * 40) * 120 + b.vx * f * 0.5;
    const y = b.y + Math.cos(f * 0.005 + b.vy * 40) * 120 + b.vy * f * 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, b.r);
    g.addColorStop(0, `rgba(${b.c},${b.a})`);
    g.addColorStop(1, `rgba(${b.c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - b.r, y - b.r, b.r * 2, b.r * 2);
  }
  let n = 0;
  for (const d of DOTS) {
    const x = (((d.x + d.vx * f) % W) + W) % W;
    const y = (((d.y + d.vy * f) % H) + H) % H;
    ctx.globalAlpha = d.a * (0.55 + 0.45 * Math.sin(f * 0.045 + d.ph));
    ctx.fillStyle = d.c;
    ctx.beginPath();
    ctx.arc(x, y, d.r, 0, TAU);
    ctx.fill();
    n += 1;
  }
  ctx.globalAlpha = 1;
  return n;
}

function drawVignette(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(W / 2, H * 0.5, 380, W / 2, H * 0.5, 1250);
  g.addColorStop(0, "rgba(3,5,10,0)");
  g.addColorStop(1, "rgba(3,5,10,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawWallGlow(ctx: CanvasRenderingContext2D): void {
  const L = BRICK.lining;
  const depth = 130;
  const strips: [number, number, number, number, number, number, number, number][] = [
    [0, 0, depth, H, L, 0, depth, 0],
    [W - depth, 0, depth, H, W - L, 0, W - depth, 0],
    [0, 0, W, depth, 0, L, 0, depth],
    [0, H - depth, W, depth, 0, H - L, 0, H - depth],
  ];
  for (const [x, y, w, h, x0, y0, x1, y1] of strips) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, "rgba(139,92,246,0.32)");
    g.addColorStop(1, "rgba(139,92,246,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
}

function drawLining(ctx: CanvasRenderingContext2D, top: number, bot: number): void {
  const L = BRICK.lining;
  ctx.fillStyle = "rgba(139,92,246,0.62)";
  ctx.fillRect(0, 0, W, L);
  ctx.fillRect(0, H - L, W, L);
  ctx.fillRect(W - L, L, L, H - 2 * L);
  ctx.fillRect(0, L, L, Math.max(0, top - L));
  ctx.fillRect(0, bot, L, Math.max(0, H - L - bot));
  ctx.fillStyle = "rgba(200,255,0,0.4)";
  ctx.fillRect(L, L, W - 2 * L, 2);
  ctx.fillRect(L, H - L - 2, W - 2 * L, 2);
  ctx.fillRect(W - L - 2, L, 2, H - 2 * L);
  ctx.fillRect(L, L, 2, Math.max(0, top - L));
  ctx.fillRect(L, bot, 2, Math.max(0, H - L - bot));
}

function drawDoorLight(ctx: CanvasRenderingContext2D, w: number, pulse: number, f: number, lime: boolean): void {
  if (w <= 0.5) return;
  const top = DOOR_Y - w / 2;
  const hue = lime ? "205,255,70" : "255,206,110";
  // The doorway: a warm panel with sharp top and bottom edges (the posts) that fades with the distance from the wall.
  const panelHue = lime ? "214,255,96" : "255,224,150";
  const panel = ctx.createLinearGradient(0, 0, 210, 0);
  panel.addColorStop(0, `rgba(${panelHue},${0.5 + 0.18 * pulse})`);
  panel.addColorStop(1, `rgba(${panelHue},0)`);
  ctx.fillStyle = panel;
  ctx.fillRect(0, top, 210, w);
  // The glow beyond it is additive and elliptical: a soft pool as tall as the exit that fades in every direction.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const rx = 520;
  ctx.translate(0, DOOR_Y);
  ctx.scale(1, (w / 2 + 120) / rx);
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  pool.addColorStop(0, `rgba(${hue},${0.5 + 0.24 * pulse})`);
  pool.addColorStop(0.45, `rgba(${hue},${0.18 + 0.1 * pulse})`);
  pool.addColorStop(1, `rgba(${hue},0)`);
  ctx.fillStyle = pool;
  ctx.fillRect(0, -rx, rx, rx * 2);
  ctx.restore();
  ctx.fillStyle = `rgba(255,248,224,${0.78 + 0.22 * pulse})`;
  ctx.fillRect(0, top, BRICK.lining, w);
  if (w > 120) {
    ctx.strokeStyle = `rgba(${hue},0.6)`;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let k = 0; k < 3; k++) {
      const x = 118 - ((f * 1.6 + k * 36) % 108);
      ctx.globalAlpha = Math.max(0, Math.min(1, x / 40)) * 0.8;
      ctx.beginPath();
      ctx.moveTo(x + 14, DOOR_Y - 16);
      ctx.lineTo(x, DOOR_Y);
      ctx.lineTo(x + 14, DOOR_Y + 16);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function drawPosts(ctx: CanvasRenderingContext2D, w: number, pulse: number, lime: boolean): void {
  const top = DOOR_Y - w / 2;
  const bot = DOOR_Y + w / 2;
  const hue = lime ? "200,255,0" : "255,190,60";
  ctx.fillStyle = `rgba(${hue},${0.2 + 0.2 * pulse})`;
  for (const y of [top - 64, bot]) {
    ctx.beginPath();
    rr(ctx, -2, y - 4, 40, 68, 14);
    ctx.fill();
  }
  ctx.fillStyle = "#fff7e0";
  for (const y of [top - 50, bot]) {
    ctx.beginPath();
    rr(ctx, 0, y, BRICK.lining + 4, 50, 6);
    ctx.fill();
  }
}

function drawBricks(ctx: CanvasRenderingContext2D, trace: BrickTrace, d: Derived, f: number): number {
  const count = trace.bricksAt[f];
  const inset = 2.5;
  const settled = (i: number): boolean => f - trace.bricks[i].frame >= POP;
  // glow behind each colour family
  for (let c = 0; c < 2; c++) {
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < count; i++) {
      if (!settled(i) || (d.group[i] < 3 ? 0 : 1) !== c) continue;
      const k = i * 4;
      rr(ctx, d.box[k] + inset, d.box[k + 1] + inset, d.box[k + 2] - 2 * inset, d.box[k + 3] - 2 * inset, 8);
      any = true;
    }
    if (any) {
      ctx.lineJoin = "round";
      ctx.lineWidth = 30;
      ctx.strokeStyle = c === 0 ? "rgba(200,255,0,0.07)" : "rgba(139,92,246,0.12)";
      ctx.stroke();
      ctx.lineWidth = 13;
      ctx.strokeStyle = c === 0 ? "rgba(200,255,0,0.2)" : "rgba(150,110,255,0.3)";
      ctx.stroke();
    }
  }
  for (let g = 0; g < 6; g++) {
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < count; i++) {
      if (d.group[i] !== g || !settled(i)) continue;
      const k = i * 4;
      rr(ctx, d.box[k] + inset, d.box[k + 1] + inset, d.box[k + 2] - 2 * inset, d.box[k + 3] - 2 * inset, 8);
      any = true;
    }
    if (any) {
      ctx.fillStyle = BRICK_COLORS[g];
      ctx.fill();
    }
  }
  ctx.beginPath();
  let anyHi = false;
  for (let i = 0; i < count; i++) {
    if (!settled(i)) continue;
    const k = i * 4;
    rr(ctx, d.box[k] + inset + 4, d.box[k + 1] + inset + 4, d.box[k + 2] - 2 * inset - 8, 5, 2.5);
    anyHi = true;
  }
  if (anyHi) {
    ctx.fillStyle = "rgba(255,255,255,0.34)";
    ctx.fill();
  }
  ctx.beginPath();
  let anySh = false;
  for (let i = 0; i < count; i++) {
    if (!settled(i)) continue;
    const k = i * 4;
    rr(ctx, d.box[k] + inset + 4, d.box[k + 1] + d.box[k + 3] - inset - 9, d.box[k + 2] - 2 * inset - 8, 5, 2.5);
    anySh = true;
  }
  if (anySh) {
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fill();
  }
  // fresh bricks pop in over 6 frames with a little overshoot and a white flash
  for (let i = count - 1; i >= 0; i--) {
    const age = f - trace.bricks[i].frame;
    if (age >= POP) break;
    const k = i * 4;
    const s = 0.4 + 0.6 * easeOutBack((age + 0.5) / POP);
    const w = (d.box[k + 2] - 2 * inset) * s;
    const h = (d.box[k + 3] - 2 * inset) * s;
    const cx = d.box[k] + d.box[k + 2] / 2;
    const cy = d.box[k + 1] + d.box[k + 3] / 2;
    ctx.globalAlpha = 0.35 * (1 - age / POP);
    ctx.fillStyle = d.group[i] < 3 ? "#c8ff00" : "#8b5cf6";
    ctx.beginPath();
    rr(ctx, cx - w / 2 - 9, cy - h / 2 - 9, w + 18, h + 18, 14);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = BRICK_COLORS[d.group[i]];
    ctx.beginPath();
    rr(ctx, cx - w / 2, cy - h / 2, w, h, 8);
    ctx.fill();
    ctx.globalAlpha = 0.85 * (1 - age / POP) ** 1.5;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    rr(ctx, cx - w / 2, cy - h / 2, w, h, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  return count;
}

const WALL_NORMAL = [0, Math.PI, Math.PI / 2, -Math.PI / 2] as const;

function drawSparks(ctx: CanvasRenderingContext2D, trace: BrickTrace, f: number): void {
  const count = trace.bricksAt[f];
  for (let j = count - 1; j >= 0; j--) {
    const ev = trace.bounces[j];
    const age = f - ev.frame;
    if (age > 18) break;
    if (age < 12) {
      // the wall lights up where the ball hit it
      ctx.fillStyle = `rgba(255,255,235,${0.9 * (1 - age / 12) ** 1.5})`;
      ctx.beginPath();
      if (ev.wall === WALL.left) rr(ctx, 0, ev.y - 46, BRICK.lining + 6, 92, 6);
      else if (ev.wall === WALL.right) rr(ctx, W - BRICK.lining - 6, ev.y - 46, BRICK.lining + 6, 92, 6);
      else if (ev.wall === WALL.top) rr(ctx, ev.x - 46, 0, 92, BRICK.lining + 6, 6);
      else rr(ctx, ev.x - 46, H - BRICK.lining - 6, 92, BRICK.lining + 6, 6);
      ctx.fill();
    }
    if (age < 10) {
      ctx.strokeStyle = `rgba(255,255,240,${0.75 * (1 - age / 10)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(ev.x, ev.y, 16 + age * 6, 0, TAU);
      ctx.stroke();
    }
    for (let k = 0; k < 8; k++) {
      const ang = WALL_NORMAL[ev.wall] + (hash01(j, k) - 0.5) * 2.5;
      const speed = 6 + 10 * hash01(j, k + 17);
      const dist = speed * 4 * (1 - Math.exp(-age / 5));
      const life = 1 - age / 18;
      ctx.globalAlpha = life * life;
      ctx.fillStyle = k & 1 ? "#fff7e0" : "#c8ff00";
      ctx.beginPath();
      ctx.arc(ev.x + Math.cos(ang) * dist, ev.y + Math.sin(ang) * dist, 1.5 + 3.4 * life, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawBall(ctx: CanvasRenderingContext2D, trace: BrickTrace, f: number): number {
  const fs = trace.frameStep[f];
  for (let k = BRICK.trailLen; k >= 1; k--) {
    const p = ballAtStep(trace, fs - k * STEPS_PER_FRAME);
    if (p.x < -R || fs - k * STEPS_PER_FRAME < 0) continue;
    const life = 1 - k / (BRICK.trailLen + 1);
    ctx.fillStyle = `rgba(120,232,255,${0.4 * life ** 1.7})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R * (0.34 + 0.6 * life), 0, TAU);
    ctx.fill();
  }
  const x = trace.ballX[f];
  const y = trace.ballY[f];
  if (x < -R - 2) return 0;
  // a short squash along the wall normal right after a bounce
  let rx = R;
  let ry = R;
  const count = trace.bricksAt[f];
  if (count > 0) {
    const ev = trace.bounces[count - 1];
    const age = f - ev.frame;
    if (age >= 0 && age < 5) {
      const k = 0.24 * (1 - age / 5) ** 2;
      if (ev.wall < 2) {
        rx = R * (1 - k);
        ry = R * (1 + 0.7 * k);
      } else {
        rx = R * (1 + 0.7 * k);
        ry = R * (1 - k);
      }
    }
  }
  const halo = ctx.createRadialGradient(x, y, R * 0.5, x, y, R * 3.3);
  halo.addColorStop(0, "rgba(125,235,255,0.5)");
  halo.addColorStop(1, "rgba(125,235,255,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, R * 3.3, 0, TAU);
  ctx.fill();
  const body = ctx.createRadialGradient(x - 9, y - 10, 3, x, y, R);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(0.55, "#b9f3ff");
  body.addColorStop(1, "#22d3ee");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  return 1;
}

function drawEscapeBurst(ctx: CanvasRenderingContext2D, a: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const k = Math.exp(-a / 22);
  const flash = ctx.createRadialGradient(0, DOOR_Y, 0, 0, DOOR_Y, 200 + a * 26);
  flash.addColorStop(0, `rgba(255,248,214,${0.85 * k})`);
  flash.addColorStop(0.4, `rgba(200,255,40,${0.34 * k})`);
  flash.addColorStop(1, "rgba(200,255,0,0)");
  ctx.fillStyle = flash;
  ctx.fillRect(0, 0, 1180, H);
  // light shafts fanning out of the exit, long and short ones alternating, bright at the door and fading outward
  const shafts = ctx.createRadialGradient(0, DOOR_Y, 20, 0, DOOR_Y, 1150);
  const sa = 0.5 * Math.exp(-a / 80);
  shafts.addColorStop(0, `rgba(255,248,205,${sa})`);
  shafts.addColorStop(0.5, `rgba(214,255,90,${sa * 0.45})`);
  shafts.addColorStop(1, "rgba(200,255,0,0)");
  ctx.fillStyle = shafts;
  ctx.beginPath();
  for (let i = 0; i < 11; i++) {
    const ang = -1.3 + (i / 10) * 2.6;
    const len = (i & 1 ? 760 : 1150) * (1 - Math.exp(-a / 10));
    const half = i & 1 ? 0.03 : 0.045;
    ctx.moveTo(0, DOOR_Y);
    ctx.lineTo(Math.cos(ang - half) * len, DOOR_Y + Math.sin(ang - half) * len);
    ctx.lineTo(Math.cos(ang + half) * len, DOOR_Y + Math.sin(ang + half) * len);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
  // shock rings
  for (let r = 0; r < 3; r++) {
    const age = a - r * 7;
    if (age < 0 || age > 56) continue;
    const fade = 1 - age / 56;
    ctx.strokeStyle = r === 1 ? `rgba(200,255,0,${0.85 * fade})` : `rgba(255,250,225,${0.75 * fade})`;
    ctx.lineWidth = 7 - r * 2;
    ctx.beginPath();
    ctx.arc(0, DOOR_Y, 70 + age * (26 + r * 5), -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  }
  // confetti shot from the exit across the chamber
  for (let c = 0; c < CONFETTI_COLORS.length; c++) {
    ctx.fillStyle = CONFETTI_COLORS[c];
    for (let i = c; i < CONFETTI.length; i += 4) {
      const p = CONFETTI[i];
      const life = Math.max(0, 1 - a / 110);
      if (life <= 0) continue;
      const dist = p.speed * 28 * (1 - Math.exp(-a / 20));
      const x = Math.cos(p.ang) * dist + 14;
      const y = DOOR_Y + Math.sin(p.ang) * dist + 0.011 * a * a + Math.sin(a * 0.16 + p.wobble) * 9;
      ctx.globalAlpha = Math.min(1, life * 1.8);
      ctx.beginPath();
      ctx.arc(x, y, p.size * (0.55 + 0.45 * life), 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** After the escape a white wave runs along the bricks, starting at the exit. */
function drawRipple(ctx: CanvasRenderingContext2D, trace: BrickTrace, d: Derived, f: number, a: number): void {
  const count = trace.bricksAt[f];
  for (let i = 0; i < count; i++) {
    const k = i * 4;
    const cx = d.box[k] + d.box[k + 2] / 2;
    const cy = d.box[k + 1] + d.box[k + 3] / 2;
    const phase = a - Math.hypot(cx, cy - DOOR_Y) / 42;
    if (phase < 0 || phase > 18) continue;
    ctx.globalAlpha = 0.85 * (1 - phase / 18) ** 2;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    rr(ctx, d.box[k] + 2.5, d.box[k + 1] + 2.5, d.box[k + 2] - 5, d.box[k + 3] - 5, 8);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Last-chance slow motion: the room dims toward the exit and a ring tightens around it. */
function drawFocus(ctx: CanvasRenderingContext2D, rate: number, w: number): void {
  const k = clamp01((1 - rate) / (1 - BRICK.rateMin));
  if (k < 0.02) return;
  const g = ctx.createRadialGradient(0, DOOR_Y, 240, 0, DOOR_Y, 1500);
  g.addColorStop(0, "rgba(3,5,10,0)");
  g.addColorStop(1, `rgba(3,5,10,${0.5 * k})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = `rgba(255,200,90,${0.55 * k})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, DOOR_Y, Math.max(90, w * 0.5 + 60 + 190 * (1 - k)), -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
}

/* ---------- HUD ---------- */

function drawLabelPill(ctx: CanvasRenderingContext2D, boxes: ReelBox[], text: string, x: number, y: number, color: string): void {
  ctx.fillStyle = "rgba(5,7,11,0.62)";
  ctx.beginPath();
  rr(ctx, x - 12, y - 28, 108, 42, 13);
  ctx.fill();
  drawReelText(ctx, boxes, text, x, y, { size: 30, weight: 800, color, maxWidth: 150 });
}

export function paintScene(
  ctx: CanvasRenderingContext2D,
  trace: BrickTrace,
  frame: number,
): { boxes: ReelBox[]; stats: PaintStats } {
  const f = Math.max(0, Math.min(trace.sceneFrames - 1, Math.floor(frame)));
  const boxes: ReelBox[] = [];
  const d = derive(trace);
  const esc = trace.escape;
  const escaped = esc !== null && f >= esc.frame;
  const w = d.doorVis[f];
  const pulse = 0.5 + 0.5 * Math.sin(TAU * d.phase[f]);
  const top = DOOR_Y - w / 2;
  const bot = DOOR_Y + w / 2;

  fillBackdrop(ctx, f, { top: "#131d35", bottom: "#091020" });
  drawChamberPattern(ctx);
  const dots = drawAmbient(ctx, f);
  drawVignette(ctx);
  drawWallGlow(ctx);

  drawDoorLight(ctx, w, pulse, f, escaped);
  drawLining(ctx, top, bot);
  const bricks = drawBricks(ctx, trace, d, f);
  if (esc && escaped) drawRipple(ctx, trace, d, f, f - esc.frame);
  drawSparks(ctx, trace, f);
  drawPosts(ctx, w, pulse, escaped);
  if (!escaped) drawFocus(ctx, trace.rate[f], w);
  const balls = drawBall(ctx, trace, f);
  if (esc && escaped) drawEscapeBurst(ctx, f - esc.frame);

  // HUD on top: question, rule, CTA and seed, then the two counters and the lines that explain the tune.
  const layout = drawChrome(ctx, boxes, BRICK_SPEC);
  const count = trace.bricksAt[f];
  if (count > 0) {
    const age = f - trace.bricks[count - 1].frame;
    if (age < 10) {
      const g = ctx.createRadialGradient(270, layout.counterY - 22, 0, 270, layout.counterY - 22, 110);
      g.addColorStop(0, `rgba(200,255,0,${0.4 * (1 - age / 10)})`);
      g.addColorStop(1, "rgba(200,255,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(160, layout.counterY - 132, 220, 220);
    }
  }
  drawStat(ctx, boxes, { label: "BRICKS", value: String(count), x: 270, y: layout.counterY, color: PALETTE.lime, maxWidth: 300 });
  drawStat(ctx, boxes, {
    label: "EXIT",
    value: `${Math.round(w)} px`,
    x: 690,
    y: layout.counterY,
    color: escaped ? PALETTE.lime : PALETTE.amber,
    maxWidth: 300,
  });

  const noteAlpha = smoothstep(150, 180, f) * (esc ? 1 - smoothstep(esc.frame - 6, esc.frame + 6, f) : 1);
  if (noteAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = noteAlpha;
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = 12;
    drawReelText(ctx, boxes, "Every bounce plays the next note. Name the song.", SAFE_CENTER_X, 640, {
      size: 30,
      weight: 700,
      align: "center",
      color: PALETTE.ink,
      maxWidth: 840,
    });
    ctx.restore();
  }

  if (w > 0.5) drawLabelPill(ctx, boxes, "EXIT", 64, DOOR_Y + 9, escaped ? PALETTE.lime : PALETTE.amber);

  if (esc && escaped) {
    const a = f - esc.frame;
    const pop = easeOutBack(a / 12);
    const rg = ctx.createRadialGradient(SAFE_CENTER_X, 780, 0, SAFE_CENTER_X, 780, 430);
    rg.addColorStop(0, `rgba(200,255,0,${0.2 * clamp01(a / 8)})`);
    rg.addColorStop(1, "rgba(200,255,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 500, W, 560);
    drawResult(ctx, boxes, "IT GOT OUT!", 780, { size: 92 * (0.45 + 0.55 * pop), color: PALETTE.lime, alpha: 0.3 + 0.7 * clamp01(a / 5) });
    const sub = smoothstep(14, 30, a);
    if (sub > 0.01) {
      ctx.save();
      ctx.globalAlpha = sub;
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 14;
      drawReelText(
        ctx,
        boxes,
        `exit ${Math.round(esc.doorW)} px · ball ${2 * R} px · ${Math.round(esc.doorW - 2 * R)} px to spare`,
        SAFE_CENTER_X,
        860,
        { size: 32, weight: 700, align: "center", color: PALETTE.ink, maxWidth: 840 },
      );
      ctx.restore();
    }
  } else if (!esc && f >= trace.sceneFrames - 150) {
    const a = f - (trace.sceneFrames - 150);
    drawResult(ctx, boxes, "WALLED IN", 780, { size: 92 * (0.5 + 0.5 * easeOutBack(a / 12)), color: PALETTE.coral, alpha: 0.3 + 0.7 * clamp01(a / 5) });
  }

  return { boxes, stats: { bricks, balls, dots, escaped } };
}
