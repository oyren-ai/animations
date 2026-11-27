import { OYREN_BRAND } from "../brand/OyrenBrand.tsx";
import { VIDEO } from "../settings.ts";
import type { ReelBox } from "../shared/reelUtils.ts";
import { easeOut } from "../theme.ts";
import { SWARM_ARENA, type SwarmTrace } from "./sim.ts";
import { drawSprite, drawTypeIcon, lighten } from "./sprites.ts";
import type { SwarmDefinition, SwarmIcon } from "./themes.ts";

/**
 * Canvas layout in px, following the framing standard and Oyren brand brief:
 * everything is centred on x = 540 with equal 50 px arena margins, the top
 * wordmark band (y 70..150) and bottom brand band (around y 1768) stay clear,
 * text and numbers stay inside the central 840 px, and the workspace window +
 * scene block sit centred around y = 940.
 */
export const SWARM_LAYOUT = {
  centerX: VIDEO.width / 2,
  titleBaseline: 284,
  rulesBaseline: 322,
  windowTop: 338,
  windowHeaderHeight: 32,
  windowRadius: 22,
  arenaLeft: (VIDEO.width - SWARM_ARENA.width) / 2,
  arenaTop: 370,
  arenaWidth: SWARM_ARENA.width,
  arenaHeight: SWARM_ARENA.height,
  barLeft: (VIDEO.width - SWARM_ARENA.width) / 2,
  barWidth: SWARM_ARENA.width,
  barTop: 1595,
  barHeight: 26,
  counterCenterY: 1658,
  columnsLeft: 120,
  columnsWidth: 840,
} as const;

/** Where text, numbers and art may sit (px). */
export const SWARM_SAFE = {
  textLeft: 120,
  textRight: 960,
  artLeft: 40,
  artRight: 1040,
  top: 150,
  bottom: 1708,
} as const;

export function swarmBoxIsSafe(box: { label: string; left: number; right: number; top: number; bottom: number }): boolean {
  const art = box.label === "bar";
  const left = art ? SWARM_SAFE.artLeft : SWARM_SAFE.textLeft;
  const right = art ? SWARM_SAFE.artRight : SWARM_SAFE.textRight;
  return (
    Number.isFinite(box.left + box.right + box.top + box.bottom) &&
    box.right >= box.left &&
    box.bottom >= box.top &&
    box.left >= left - 0.5 &&
    box.right <= right + 0.5 &&
    box.top >= SWARM_SAFE.top - 0.5 &&
    box.bottom <= SWARM_SAFE.bottom + 0.5
  );
}

/**
 * The title is at least 110 px tall as drawn: Inter caps are 0.727 em high, so
 * a 152 px face gives a 111 px cap height.
 */
export const TITLE_FONT_SIZE = 152;
export const TITLE_MIN_FONT_SIZE = 110;
export const TITLE_SCALE_X = 0.92;
export const TITLE_CAP_HEIGHT = Math.round(TITLE_FONT_SIZE * 0.727);
export const RULES_FONT_SIZE = 27;
export const CAPTION_FONT_SIZE = 104;
/** Frames a conversion pop and ring/spark flash stay visible. */
export const POP_FRAMES = 12;
export const RING_FRAMES = 18;
const CAPTION_POP_FRAMES = 14;

const FONT = '"Inter Variable", Inter, sans-serif';
const MONO_FONT = 'ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace';
const TAU = Math.PI * 2;

/** Seamless dot-grid super-period (3 cells of 48 px) so frame 0 and totalFrames align. */
const DOT_STEP = 48;
const DOT_PERIOD = DOT_STEP * 3;

/** Relative on-screen size per sprite kind (times 2.1 sprite radii). */
const SPRITE_SCALE: Record<SwarmIcon, number> = {
  rock: 1.05,
  paper: 1.1,
  scissors: 1.42,
  circle: 1.04,
  triangle: 1.14,
  square: 1.02,
  star: 1.22,
  hexagon: 1.08,
  fire: 1.16,
  water: 1.12,
  leaf: 1.16,
  king: 1.16,
  queen: 1.16,
  rook: 1.1,
  bishop: 1.14,
  knight: 1.16,
};

export interface BarSegment {
  type: number;
  x: number;
  width: number;
}

/** Bar segment layout: widths are exactly proportional to the counts and sum to `width`. */
export function barSegments(counts: ArrayLike<number>, x: number, width: number): BarSegment[] {
  let total = 0;
  for (let k = 0; k < counts.length; k++) total += counts[k];
  const segments: BarSegment[] = [];
  let cumulative = 0;
  for (let k = 0; k < counts.length; k++) {
    const left = total > 0 ? x + (width * cumulative) / total : x;
    cumulative += counts[k];
    const right = total > 0 ? x + (width * cumulative) / total : x;
    segments.push({ type: k, x: left, width: right - left });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Background & Workspace Window (Oyren ink, seamless drifting dot grid, lime glow)
// ---------------------------------------------------------------------------

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function bottomRoundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.closePath();
}

interface BackdropAssets {
  ink: HTMLCanvasElement;
  dots: HTMLCanvasElement;
  vignette: HTMLCanvasElement;
}

let backdropAssets: BackdropAssets | null | undefined;

function getBackdropAssets(): BackdropAssets | null {
  if (backdropAssets !== undefined) return backdropAssets;
  backdropAssets = null;
  if (typeof document === "undefined") return null;

  const W = VIDEO.width;
  const H = VIDEO.height;
  const L = SWARM_LAYOUT;
  const windowHeight = L.windowHeaderHeight + L.arenaHeight;
  const windowCenterY = L.windowTop + windowHeight / 2;

  // 1. Deep Oyren ink gradient + soft ambient lime & slate-blue glows behind the workspace window.
  const ink = document.createElement("canvas");
  ink.width = W;
  ink.height = H;
  const gi = ink.getContext("2d");
  if (!gi) return null;

  const bgGrad = gi.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, OYREN_BRAND.ink);
  bgGrad.addColorStop(0.45, "#06121a");
  bgGrad.addColorStop(0.75, "#051017");
  bgGrad.addColorStop(1, OYREN_BRAND.ink);
  gi.fillStyle = bgGrad;
  gi.fillRect(0, 0, W, H);

  const limeGlow = gi.createRadialGradient(L.centerX, windowCenterY, 120, L.centerX, windowCenterY, 720);
  limeGlow.addColorStop(0, "rgba(200, 255, 0, 0.11)");
  limeGlow.addColorStop(0.55, "rgba(200, 255, 0, 0.045)");
  limeGlow.addColorStop(1, "rgba(200, 255, 0, 0)");
  gi.fillStyle = limeGlow;
  gi.fillRect(0, 0, W, H);

  const blueGlow = gi.createRadialGradient(L.centerX, windowCenterY - 120, 40, L.centerX, windowCenterY, 820);
  blueGlow.addColorStop(0, "rgba(100, 181, 229, 0.08)");
  blueGlow.addColorStop(1, "rgba(100, 181, 229, 0)");
  gi.fillStyle = blueGlow;
  gi.fillRect(0, 0, W, H);

  // 2. Seamless tileable dot-grid sheet.
  const dots = document.createElement("canvas");
  dots.width = W + DOT_PERIOD;
  dots.height = H + DOT_PERIOD;
  const gd = dots.getContext("2d");
  if (!gd) return null;
  for (let row = 0, y = DOT_STEP / 2; y < dots.height; row++, y += DOT_STEP) {
    for (let col = 0, x = DOT_STEP / 2; x < dots.width; col++, x += DOT_STEP) {
      const accent = row % 3 === 0 && col % 3 === 0;
      gd.fillStyle = accent ? "rgba(200, 255, 0, 0.17)" : "rgba(148, 192, 218, 0.12)";
      gd.beginPath();
      gd.arc(x, y, accent ? 1.7 : 1.3, 0, TAU);
      gd.fill();
    }
  }

  // 3. Gentle radial vignette centred symmetrically on x = 540.
  const vignette = document.createElement("canvas");
  vignette.width = W;
  vignette.height = H;
  const gv = vignette.getContext("2d");
  if (!gv) return null;
  const vig = gv.createRadialGradient(L.centerX, H / 2, 470, L.centerX, H / 2, 1220);
  vig.addColorStop(0, "rgba(2, 5, 7, 0)");
  vig.addColorStop(1, "rgba(2, 5, 7, 0.56)");
  gv.fillStyle = vig;
  gv.fillRect(0, 0, W, H);

  backdropAssets = { ink, dots, vignette };
  return backdropAssets;
}

function paintBackdrop(ctx: CanvasRenderingContext2D, f: number, totalFrames: number) {
  const assets = getBackdropAssets();
  if (!assets) {
    ctx.fillStyle = OYREN_BRAND.ink;
    ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
    return;
  }
  ctx.drawImage(assets.ink, 0, 0);
  // Seamless loop: u goes 0 -> 1 over totalFrames, shifting by exact integer multiples of DOT_PERIOD.
  const u = totalFrames > 0 ? f / totalFrames : 0;
  const ox = (u * DOT_PERIOD) % DOT_PERIOD;
  const oy = (u * 2 * DOT_PERIOD) % DOT_PERIOD;
  ctx.drawImage(assets.dots, -ox, -oy);
  ctx.drawImage(assets.vignette, 0, 0);
}

function paintWorkspaceWindowBase(ctx: CanvasRenderingContext2D, definition: SwarmDefinition, f: number) {
  const L = SWARM_LAYOUT;
  const winW = L.arenaWidth;
  const winH = L.windowHeaderHeight + L.arenaHeight;

  // Soft lime outer glow around the workspace window.
  const pulse = 0.85 + 0.15 * Math.sin((f / VIDEO.fps) * 2.1);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  roundRectPath(ctx, L.arenaLeft, L.windowTop, winW, winH, L.windowRadius);
  ctx.strokeStyle = `rgba(200, 255, 0, ${(0.055 * pulse).toFixed(4)})`;
  ctx.lineWidth = 18;
  ctx.stroke();
  ctx.strokeStyle = `rgba(200, 255, 0, ${(0.12 * pulse).toFixed(4)})`;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.restore();

  // Clipped workspace card interior.
  ctx.save();
  roundRectPath(ctx, L.arenaLeft, L.windowTop, winW, winH, L.windowRadius);
  ctx.clip();

  const surfaceGrad = ctx.createLinearGradient(0, L.arenaTop, 0, L.arenaTop + L.arenaHeight);
  surfaceGrad.addColorStop(0, "#061018");
  surfaceGrad.addColorStop(0.5, "#050c12");
  surfaceGrad.addColorStop(1, "#04090e");
  ctx.fillStyle = surfaceGrad;
  ctx.fillRect(L.arenaLeft, L.arenaTop, L.arenaWidth, L.arenaHeight);

  // Faint coordinate grid inside the playfield, symmetric around the arena centre.
  const gridStep = 56;
  const midX = L.arenaLeft + L.arenaWidth / 2;
  const midY = L.arenaTop + L.arenaHeight / 2;
  ctx.lineWidth = 1;
  for (let m = 0; m * gridStep < L.arenaWidth / 2; m++) {
    const major = m % 4 === 0;
    ctx.strokeStyle = major ? "rgba(116, 185, 209, 0.11)" : "rgba(116, 185, 209, 0.055)";
    const xs = m === 0 ? [midX] : [midX - m * gridStep, midX + m * gridStep];
    for (const x of xs) {
      ctx.beginPath();
      ctx.moveTo(x, L.arenaTop);
      ctx.lineTo(x, L.arenaTop + L.arenaHeight);
      ctx.stroke();
    }
  }
  for (let m = 0; m * gridStep < L.arenaHeight / 2; m++) {
    const major = m % 4 === 0;
    ctx.strokeStyle = major ? "rgba(116, 185, 209, 0.11)" : "rgba(116, 185, 209, 0.055)";
    const ys = m === 0 ? [midY] : [midY - m * gridStep, midY + m * gridStep];
    for (const y of ys) {
      ctx.beginPath();
      ctx.moveTo(L.arenaLeft, y);
      ctx.lineTo(L.arenaLeft + L.arenaWidth, y);
      ctx.stroke();
    }
  }

  // Subtle centre crosshair tick.
  ctx.strokeStyle = "rgba(200, 255, 0, 0.22)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(midX - 12, midY);
  ctx.lineTo(midX + 12, midY);
  ctx.moveTo(midX, midY - 12);
  ctx.lineTo(midX, midY + 12);
  ctx.stroke();

  // Slim workspace title bar at the top of the window.
  ctx.fillStyle = "#0b1822";
  ctx.fillRect(L.arenaLeft, L.windowTop, winW, L.windowHeaderHeight);
  ctx.strokeStyle = "rgba(200, 255, 0, 0.24)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(L.arenaLeft, L.arenaTop);
  ctx.lineTo(L.arenaLeft + winW, L.arenaTop);
  ctx.stroke();

  // Three small Oyren window dots on the left, balanced by three subtle status ticks on the right.
  const headerCy = L.windowTop + L.windowHeaderHeight / 2;
  const dotColors = [OYREN_BRAND.lime, "#64b5e5", "#435869"];
  for (let d = 0; d < 3; d++) {
    ctx.fillStyle = dotColors[d];
    ctx.beginPath();
    ctx.arc(L.arenaLeft + 24 + d * 16, headerCy, 4.4, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "rgba(148, 192, 218, 0.35)";
    ctx.beginPath();
    ctx.arc(L.arenaLeft + winW - 24 - d * 16, headerCy, 2.6, 0, TAU);
    ctx.fill();
  }

  // Small centred monospace workspace path label.
  const windowLabel =
    definition.windowLabel ??
    (definition.slug === "swarm-rps-classic" ? "oyren / arena · rps" : "oyren / arena · five-rivals");
  ctx.font = `500 16px ${MONO_FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const labelW = ctx.measureText(windowLabel).width;
  ctx.fillStyle = "#9bb1c0";
  ctx.fillText(windowLabel, L.centerX - labelW / 2, headerCy + 5.5);

  ctx.restore();
}

function paintWorkspaceWindowRim(ctx: CanvasRenderingContext2D) {
  const L = SWARM_LAYOUT;
  const winW = L.arenaWidth;
  const winH = L.windowHeaderHeight + L.arenaHeight;
  roundRectPath(ctx, L.arenaLeft, L.windowTop, winW, winH, L.windowRadius);
  ctx.strokeStyle = "rgba(200, 255, 0, 0.64)";
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const fitCache = new Map<string, number>();

interface TextStyle {
  size: number;
  weight?: number;
  maxWidth?: number;
  minSize?: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  align?: "left" | "center";
  drop?: number;
  scaleX?: number;
}

function pushBox(boxes: ReelBox[], label: string, left: number, top: number, right: number, bottom: number): ReelBox {
  const box: ReelBox = { label, left, top, right, bottom };
  if (!swarmBoxIsSafe(box)) throw new RangeError(`Swarm UI box outside the framing zone: ${JSON.stringify(box)}`);
  boxes.push(box);
  return box;
}

function fitSize(ctx: CanvasRenderingContext2D, str: string, weight: number, style: TextStyle): number {
  const { size, maxWidth = Infinity, minSize = 10 } = style;
  const key = `${str}|${weight}|${size}|${maxWidth}|${minSize}`;
  const cached = fitCache.get(key);
  if (cached !== undefined) return cached;
  let fontSize = size;
  while (fontSize > minSize) {
    ctx.font = `${weight} ${fontSize}px ${FONT}`;
    if (ctx.measureText(str).width <= maxWidth) break;
    fontSize -= 0.5;
  }
  fitCache.set(key, fontSize);
  return fontSize;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  str: string,
  x: number,
  baseline: number,
  style: TextStyle,
): ReelBox {
  const weight = style.weight ?? 900;
  const stroke = style.strokeWidth ?? 0;
  const sx = style.scaleX ?? 1;
  const fitted = { ...style, maxWidth: ((style.maxWidth ?? Infinity) - stroke - 6) / sx };
  const fontSize = fitSize(ctx, str, weight, fitted);
  ctx.font = `${weight} ${fontSize}px ${FONT}`;
  const metrics = ctx.measureText(str);
  const px = style.align === "left" ? x : x - (metrics.width * sx) / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.save();
  ctx.translate(px, baseline);
  ctx.scale(sx, 1);
  if (style.drop) {
    ctx.fillStyle = "rgba(2, 6, 9, 0.58)";
    ctx.fillText(str, 0, style.drop);
  }
  if (stroke > 0 && style.stroke) {
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = stroke;
    ctx.strokeText(str, 0, 0);
  }
  ctx.fillStyle = style.fill;
  ctx.fillText(str, 0, 0);
  ctx.restore();
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.76;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.22;
  const half = stroke / 2;
  return pushBox(
    boxes,
    str,
    px - (metrics.actualBoundingBoxLeft || 0) * sx - half,
    baseline - ascent - half,
    px + (metrics.actualBoundingBoxRight || metrics.width) * sx + half,
    baseline + descent + half,
  );
}

/**
 * Draw "WHO WINS?" at Inter 900 with tight tracking and Oyren lime on the
 * trailing question mark, recording a single centred ReelBox for the full title.
 */
function drawBrandTitle(ctx: CanvasRenderingContext2D, boxes: ReelBox[], title: string) {
  const L = SWARM_LAYOUT;
  const hasQuestion = title.endsWith("?");
  const lead = hasQuestion ? title.slice(0, -1) : title;
  const accent = hasQuestion ? "?" : "";
  const sx = TITLE_SCALE_X;
  const maxWidth = 828;
  let fontSize = TITLE_FONT_SIZE;
  while (fontSize > TITLE_MIN_FONT_SIZE) {
    ctx.font = `900 ${fontSize}px ${FONT}`;
    const leadW = ctx.measureText(lead).width;
    const accW = accent ? ctx.measureText(accent).width : 0;
    const kern = accent ? -fontSize * 0.02 : 0;
    if ((leadW + kern + accW) * sx <= maxWidth) break;
    fontSize -= 0.5;
  }
  ctx.font = `900 ${fontSize}px ${FONT}`;
  const mFull = ctx.measureText(title);
  const mLead = ctx.measureText(lead);
  const mAcc = accent ? ctx.measureText(accent) : null;
  const kern = accent ? -fontSize * 0.02 : 0;
  const rawWidth = mLead.width + kern + (mAcc ? mAcc.width : 0);
  const totalWidth = rawWidth * sx;
  const startX = L.centerX - totalWidth / 2;

  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.translate(startX, L.titleBaseline);
  ctx.scale(sx, 1);

  ctx.fillStyle = "rgba(2, 6, 9, 0.65)";
  ctx.fillText(lead, 0, 5);
  if (accent) ctx.fillText(accent, mLead.width + kern, 5);

  ctx.fillStyle = OYREN_BRAND.white;
  ctx.fillText(lead, 0, 0);
  if (accent) {
    ctx.fillStyle = OYREN_BRAND.lime;
    ctx.fillText(accent, mLead.width + kern, 0);
  }
  ctx.restore();

  const ascent = mFull.actualBoundingBoxAscent || fontSize * 0.76;
  const descent = mFull.actualBoundingBoxDescent || fontSize * 0.22;
  pushBox(
    boxes,
    title,
    L.centerX - totalWidth / 2,
    L.titleBaseline - ascent,
    L.centerX + totalWidth / 2,
    L.titleBaseline + descent,
  );
}

// ---------------------------------------------------------------------------
// Sprites, additive conversion effects, share bar, counters, winner pill
// ---------------------------------------------------------------------------

let popAge = new Int16Array(0);

function popScale(age: number): number {
  if (age < 0 || age >= POP_FRAMES) return 1;
  return 1 + 0.34 * Math.sin((Math.PI * age) / POP_FRAMES);
}

function paintSprites(
  ctx: CanvasRenderingContext2D,
  definition: SwarmDefinition,
  trace: SwarmTrace,
  f: number,
) {
  const L = SWARM_LAYOUT;
  const N = trace.count;
  const { types } = definition.skin;
  const base = f * N;
  const baseSize = 2.1 * trace.config.radius;

  if (popAge.length !== N) popAge = new Int16Array(N);
  popAge.fill(-1);
  const firstEvent = trace.eventStart[Math.max(0, f - POP_FRAMES + 1)];
  const lastEvent = trace.eventStart[f + 1];
  for (let e = firstEvent; e < lastEvent; e++) {
    const event = trace.events[e];
    popAge[event.sprite] = f - event.frame;
  }

  ctx.save();
  bottomRoundRectPath(ctx, L.arenaLeft, L.arenaTop, L.arenaWidth, L.arenaHeight, L.windowRadius);
  ctx.clip();
  ctx.translate(L.arenaLeft, L.arenaTop);

  const winPulse = f >= trace.winFrame ? f - trace.winFrame : -1;
  for (let i = 0; i < N; i++) {
    const type = trace.type[base + i];
    const skin = types[type];
    let scale = popScale(popAge[i]);
    if (winPulse >= 0 && type === trace.winner) {
      scale *= 1 + 0.045 * Math.sin((winPulse / 40) * TAU + i * 0.7);
    }
    const size = baseSize * SPRITE_SCALE[skin.icon] * scale;
    const open = 0.5 + 0.5 * Math.sin(f * 0.19 + i * 1.7);
    drawSprite(ctx, skin.icon, trace.x[base + i], trace.y[base + i], size, trace.angle[base + i], skin.color, i, open);
  }

  // Additive conversion rings and radial sparks in the converting team's colour.
  const ringFirst = trace.eventStart[Math.max(0, f - RING_FRAMES + 1)];
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let e = ringFirst; e < lastEvent; e++) {
    const event = trace.events[e];
    const age = f - event.frame;
    const u = age / RING_FRAMES;
    const color = types[event.winner].color;
    const eased = easeOut(u);
    const radius = trace.config.radius * (0.85 + 2.35 * eased);
    const fade = Math.max(0, 1 - u) ** 1.45;

    // Expanding glow ring + crisp inner ring.
    ctx.globalAlpha = fade * 0.34;
    ctx.strokeStyle = color;
    ctx.lineWidth = 8 * (1 - u) + 2;
    ctx.beginPath();
    ctx.arc(event.x, event.y, radius, 0, TAU);
    ctx.stroke();

    ctx.globalAlpha = fade * 0.88;
    ctx.strokeStyle = lighten(color, 0.35);
    ctx.lineWidth = 1.4 + 3.8 * (1 - u);
    ctx.beginPath();
    ctx.arc(event.x, event.y, radius, 0, TAU);
    ctx.stroke();

    // Radial sparks flying outward in the converting team's colour.
    if (age < 13) {
      const su = age / 13;
      const se = easeOut(su);
      const sparkAlpha = (1 - su) ** 1.3 * 0.92;
      const innerR = trace.config.radius * (0.55 + 1.65 * se);
      const outerR = innerR + trace.config.radius * (0.68 * (1 - su * 0.65));
      const baseAngle = ((event.frame * 11 + event.sprite * 23) % 360) * (Math.PI / 180);
      ctx.globalAlpha = sparkAlpha;
      ctx.strokeStyle = lighten(color, 0.42);
      ctx.lineWidth = Math.max(1.4, 3.2 * (1 - su));
      ctx.beginPath();
      for (let s = 0; s < 6; s++) {
        const a = baseAngle + (s * TAU) / 6;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        ctx.moveTo(event.x + ca * innerR, event.y + sa * innerR);
        ctx.lineTo(event.x + ca * outerR, event.y + sa * outerR);
      }
      ctx.stroke();
    }

    if (age < 4) {
      ctx.globalAlpha = 0.48 * (1 - age / 4);
      ctx.fillStyle = lighten(color, 0.55);
      ctx.beginPath();
      ctx.arc(event.x, event.y, trace.config.radius * 0.9, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = Math.max(0, Math.min(1, t));
  return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2;
}

/** Draw tabular digits in team colour with fixed cell advance, returning exact width. */
function drawTabularDigits(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  digits: string,
  left: number,
  baseline: number,
  fontSize: number,
  color: string,
) {
  ctx.font = `800 ${fontSize}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const cellW = Math.max(ctx.measureText("0").width, fontSize * 0.58);
  const totalW = digits.length * cellW;

  ctx.save();
  for (let i = 0; i < digits.length; i++) {
    const ch = digits[i];
    const cw = ctx.measureText(ch).width;
    const dx = left + i * cellW + (cellW - cw) / 2;
    ctx.fillStyle = "rgba(2, 6, 9, 0.65)";
    ctx.fillText(ch, dx, baseline + 3);
    ctx.fillStyle = color;
    ctx.fillText(ch, dx, baseline);
  }
  ctx.restore();

  const sample = ctx.measureText("0");
  const ascent = sample.actualBoundingBoxAscent || fontSize * 0.75;
  const descent = sample.actualBoundingBoxDescent || fontSize * 0.2;
  pushBox(boxes, digits, left, baseline - ascent, left + totalW, baseline + descent);
}

function paintBarAndCounters(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  definition: SwarmDefinition,
  trace: SwarmTrace,
  f: number,
) {
  const L = SWARM_LAYOUT;
  const K = trace.types;
  const counts = trace.counts.subarray(f * K, f * K + K);
  let sum = 0;
  for (let k = 0; k < K; k++) sum += counts[k];
  if (sum !== trace.count) {
    throw new RangeError(`Swarm counts ${sum} do not add up to ${trace.count} at frame ${f}`);
  }
  const skins = definition.skin.types;

  // Share bar: rounded pill track, flat team colours, crisp dark gaps.
  ctx.save();
  roundRectPath(ctx, L.barLeft, L.barTop, L.barWidth, L.barHeight, L.barHeight / 2);
  ctx.fillStyle = "#061017";
  ctx.fill();
  ctx.clip();
  const segments = barSegments(counts, L.barLeft, L.barWidth);
  for (const segment of segments) {
    if (segment.width <= 0) continue;
    ctx.fillStyle = skins[segment.type].color;
    ctx.fillRect(segment.x, L.barTop, segment.width, L.barHeight);
  }
  ctx.fillStyle = OYREN_BRAND.ink;
  for (let k = 1; k < segments.length; k++) {
    if (segments[k].width > 0 && segments[k].x > L.barLeft + 1.5) {
      ctx.fillRect(segments[k].x - 2, L.barTop, 4, L.barHeight);
    }
  }
  ctx.restore();
  roundRectPath(ctx, L.barLeft + 0.75, L.barTop + 0.75, L.barWidth - 1.5, L.barHeight - 1.5, L.barHeight / 2 - 0.75);
  ctx.strokeStyle = "rgba(184, 206, 224, 0.28)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  pushBox(boxes, "bar", L.barLeft, L.barTop, L.barLeft + L.barWidth, L.barTop + L.barHeight);

  // Counters: small team glyph + tabular figures in team colour, centred on x = 540.
  const columnWidth = L.columnsWidth / K;
  const iconSize = K <= 3 ? 48 : 36;
  const gap = K <= 3 ? 14 : 8;
  const numberSize = K <= 3 ? 66 : 46;
  const nominalSize = fitSize(ctx, "000", 800, {
    size: numberSize,
    maxWidth: columnWidth - iconSize - gap - 12,
    minSize: 28,
    fill: "#ffffff",
  });
  ctx.font = `800 ${nominalSize}px ${FONT}`;
  const cellW = Math.max(ctx.measureText("0").width, nominalSize * 0.58);

  const budget = L.columnsWidth - 20;
  const wideGroup = iconSize + gap + 3 * cellW;
  const normalGroup = iconSize + gap + 2 * cellW;
  const spacing = K > 1 ? Math.max(10, (budget - wideGroup - (K - 1) * normalGroup) / (K - 1)) : 0;

  const groupWidths: number[] = [];
  const digitStrings: string[] = [];
  for (let k = 0; k < K; k++) {
    const str = String(counts[k]);
    digitStrings.push(str);
    groupWidths.push(iconSize + gap + str.length * cellW);
  }
  const groupsWidth = groupWidths.reduce((a, b) => a + b, 0);
  const rowSpacing = K > 1 ? Math.min(spacing, Math.max(0, (budget - groupsWidth) / (K - 1))) : 0;
  const rowWidth = groupsWidth + rowSpacing * (K - 1);

  let cursor = L.centerX - rowWidth / 2;
  for (let k = 0; k < K; k++) {
    const left = cursor;
    cursor += groupWidths[k] + rowSpacing;
    const iconCx = left + iconSize / 2;
    const drawSize = iconSize * (skins[k].icon === "scissors" ? 1.12 : 1);
    drawTypeIcon(ctx, skins[k].icon, iconCx, L.counterCenterY, drawSize, skins[k].color);
    pushBox(
      boxes,
      `${skins[k].name} icon`,
      iconCx - drawSize / 2,
      L.counterCenterY - drawSize / 2,
      iconCx + drawSize / 2,
      L.counterCenterY + drawSize / 2,
    );
    const digitHeight = nominalSize * 0.72;
    drawTabularDigits(
      ctx,
      boxes,
      digitStrings[k],
      left + iconSize + gap,
      L.counterCenterY + digitHeight / 2,
      nominalSize,
      skins[k].color,
    );
  }
}

function paintCaption(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  definition: SwarmDefinition,
  trace: SwarmTrace,
  f: number,
) {
  const L = SWARM_LAYOUT;
  const skin = definition.skin.types[trace.winner];
  const fullLabel = `${skin.caption} WINS`;
  const winnerWord = skin.caption;
  const suffixWord = " WINS";
  const t = (f - trace.winFrame) / CAPTION_POP_FRAMES;
  const scale = 0.6 + 0.4 * easeOutBack(t);
  const alpha = Math.max(0, Math.min(1, t * 2.4));
  const cx = L.centerX;
  const cy = L.arenaTop + L.arenaHeight / 2;
  const panelW = 760;
  const panelH = 164;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // Soft lime + team glow behind the pill.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  roundRectPath(ctx, -panelW / 2, -panelH / 2, panelW, panelH, panelH / 2);
  ctx.strokeStyle = "rgba(200, 255, 0, 0.16)";
  ctx.lineWidth = 18;
  ctx.stroke();
  ctx.restore();

  // Deep Oyren ink pill with crisp lime border.
  roundRectPath(ctx, -panelW / 2, -panelH / 2, panelW, panelH, panelH / 2);
  ctx.fillStyle = "rgba(3, 8, 10, 0.94)";
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = OYREN_BRAND.lime;
  ctx.stroke();

  roundRectPath(ctx, -panelW / 2 + 8, -panelH / 2 + 8, panelW - 16, panelH - 16, panelH / 2 - 8);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "rgba(200, 255, 0, 0.22)";
  ctx.stroke();

  const maxWidth = panelW - 104;
  const weight = 900;
  const fontSize = fitSize(ctx, fullLabel, weight, { size: CAPTION_FONT_SIZE, maxWidth, minSize: 54, fill: skin.color });
  ctx.font = `${weight} ${fontSize}px ${FONT}`;
  const metrics = ctx.measureText(fullLabel);
  const nameMetrics = ctx.measureText(winnerWord);
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.75;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
  const baseline = (ascent - descent) / 2;
  const px = -metrics.width / 2;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillText(fullLabel, px, baseline + 3);

  ctx.fillStyle = skin.color;
  ctx.fillText(winnerWord, px, baseline);
  ctx.fillStyle = skin.color.toLowerCase() === "#eef6fc" ? "#9cb6c9" : OYREN_BRAND.white;
  ctx.fillText(suffixWord, px + nameMetrics.width, baseline);
  ctx.restore();

  pushBox(
    boxes,
    fullLabel,
    cx + scale * (px - (metrics.actualBoundingBoxLeft || 0)),
    cy + scale * (baseline - ascent),
    cx + scale * (px + (metrics.actualBoundingBoxRight || metrics.width)),
    cy + scale * (baseline + descent),
  );
  pushBox(
    boxes,
    "caption panel",
    cx - (scale * panelW) / 2,
    cy - (scale * panelH) / 2,
    cx + (scale * panelW) / 2,
    cy + (scale * panelH) / 2,
  );
}

/**
 * Paint frame `frame` of a swarm clip onto a 1080x1920 canvas and return the
 * text / bar / icon boxes for safe-zone checks.
 */
export function paintSwarmFrame(
  ctx: CanvasRenderingContext2D,
  definition: SwarmDefinition,
  trace: SwarmTrace,
  frame: number,
): ReelBox[] {
  if (trace.x.length === 0) throw new Error("paintSwarmFrame needs a trace recorded with positions");
  const L = SWARM_LAYOUT;
  const boxes: ReelBox[] = [];
  const f = Math.max(0, Math.min(trace.totalFrames - 1, Math.round(frame)));

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  paintBackdrop(ctx, f, trace.totalFrames);
  paintWorkspaceWindowBase(ctx, definition, f);
  paintSprites(ctx, definition, trace, f);
  paintWorkspaceWindowRim(ctx);

  drawBrandTitle(ctx, boxes, definition.skin.title);
  drawText(ctx, boxes, definition.skin.rules, L.centerX, L.rulesBaseline, {
    size: RULES_FONT_SIZE,
    weight: 600,
    maxWidth: 840,
    minSize: 20,
    fill: "#b8cad8",
    drop: 3,
  });

  paintBarAndCounters(ctx, boxes, definition, trace, f);
  if (f >= trace.winFrame) paintCaption(ctx, boxes, definition, trace, f);
  return boxes;
}
