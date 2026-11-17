import { VIDEO } from "../settings.ts";
import { assertReelSafeBox, type ReelBox } from "../shared/reelUtils.ts";
import { easeOut } from "../theme.ts";
import { mulberry32, SWARM_ARENA, type SwarmTrace } from "./sim.ts";
import { drawSprite, drawTypeIcon, lighten } from "./sprites.ts";
import type { SwarmDefinition, SwarmIcon } from "./themes.ts";

/** Canvas layout in px. Text, numbers, bar and caption stay inside the reel-safe zone (x 60..900, y 220..1560). */
export const SWARM_LAYOUT = {
  /** Safe-zone centre; the title, rules and caption are centred here. */
  centerX: 480,
  titleBaseline: 346,
  rulesBaseline: 398,
  arenaLeft: 0,
  arenaTop: 420,
  arenaWidth: SWARM_ARENA.width,
  arenaHeight: SWARM_ARENA.height,
  barLeft: 64,
  barWidth: 832,
  barTop: 1356,
  barHeight: 40,
  counterCenterY: 1476,
  columnsLeft: 60,
  columnsWidth: 840,
} as const;

/**
 * The title is at least 110 px tall as drawn: Inter caps are 0.727 em high, so
 * a 152 px face gives a 110 px cap height, squeezed horizontally to fit the
 * 840 px safe width.
 */
export const TITLE_FONT_SIZE = 152;
export const TITLE_MIN_FONT_SIZE = 110;
export const TITLE_SCALE_X = 0.84;
export const TITLE_CAP_HEIGHT = Math.round(TITLE_FONT_SIZE * 0.727);
export const RULES_FONT_SIZE = 30;
export const CAPTION_FONT_SIZE = 150;
/** Frames a conversion pop and ring flash stay visible. */
export const POP_FRAMES = 12;
export const RING_FRAMES = 16;
const CAPTION_POP_FRAMES = 14;

const FONT = '"Inter Variable", Inter, sans-serif';
const CYAN = "#26e0ff";
const TAU = Math.PI * 2;

/** Relative on-screen size per sprite kind (times 2.1 sprite radii). */
const SPRITE_SCALE: Record<SwarmIcon, number> = {
  rock: 1.04,
  paper: 1.12,
  scissors: 1.34,
  circle: 1.0,
  triangle: 1.14,
  square: 0.98,
  star: 1.2,
  hexagon: 1.04,
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
// Background: dark procedural stone wall, drawn once to an offscreen canvas.
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

function glowLine(g: CanvasRenderingContext2D, y: number) {
  const W = VIDEO.width;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.lineCap = "butt";
  for (const [width, alpha] of [
    [54, 0.045],
    [30, 0.08],
    [14, 0.17],
  ] as const) {
    g.strokeStyle = `rgba(38, 224, 255, ${alpha})`;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.shadowColor = CYAN;
  g.shadowBlur = 26;
  g.strokeStyle = "#6fefff";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, y);
  g.lineTo(W, y);
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = "#eafdff";
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(0, y);
  g.lineTo(W, y);
  g.stroke();
  g.restore();
}

function stoneBlock(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rand: () => number,
) {
  const gap = 4;
  const lightness = 13 + rand() * 9;
  const hue = 206 + rand() * 16;
  const sat = 11 + rand() * 9;
  const fill = g.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${(lightness + 6).toFixed(1)}%)`);
  fill.addColorStop(1, `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${(lightness - 2).toFixed(1)}%)`);
  roundRectPath(g, x + gap, y + gap, w - 2 * gap, h - 2 * gap, 12);
  g.fillStyle = fill;
  g.fill();
  // Chiselled edge: light on the top-left, shadow on the bottom-right.
  g.lineWidth = 2.4;
  g.strokeStyle = "rgba(170, 200, 230, 0.075)";
  g.beginPath();
  g.moveTo(x + gap + 10, y + gap + 1.5);
  g.lineTo(x + w - gap - 12, y + gap + 1.5);
  g.moveTo(x + gap + 1.5, y + gap + 12);
  g.lineTo(x + gap + 1.5, y + h - gap - 12);
  g.stroke();
  g.strokeStyle = "rgba(0, 0, 0, 0.34)";
  g.beginPath();
  g.moveTo(x + gap + 12, y + h - gap - 1.5);
  g.lineTo(x + w - gap - 10, y + h - gap - 1.5);
  g.moveTo(x + w - gap - 1.5, y + gap + 12);
  g.lineTo(x + w - gap - 1.5, y + h - gap - 12);
  g.stroke();
  // Speckle and pitting.
  const specks = 26 + Math.floor((w * h) / 1500);
  for (let s = 0; s < specks; s++) {
    const sx = x + gap + 6 + rand() * (w - 2 * gap - 12);
    const sy = y + gap + 6 + rand() * (h - 2 * gap - 12);
    const dark = rand() < 0.55;
    g.fillStyle = dark ? "rgba(0, 0, 0, 0.16)" : "rgba(190, 215, 240, 0.06)";
    g.beginPath();
    g.arc(sx, sy, 0.8 + rand() * 2.1, 0, TAU);
    g.fill();
  }
}

function buildWall(g: CanvasRenderingContext2D) {
  const W = VIDEO.width;
  const H = VIDEO.height;
  const L = SWARM_LAYOUT;
  const rand = mulberry32(20260);
  g.fillStyle = "#070a0e";
  g.fillRect(0, 0, W, H);

  let y = -38;
  while (y < H) {
    const rowH = 84 + Math.floor(rand() * 28);
    let x = -Math.floor(rand() * 170);
    while (x < W) {
      const blockW = 150 + Math.floor(rand() * 150);
      stoneBlock(g, x, y, blockW, rowH, rand);
      x += blockW;
    }
    y += rowH;
  }

  // Hairline cracks.
  g.lineCap = "round";
  g.lineJoin = "round";
  for (let c = 0; c < 34; c++) {
    let cx = rand() * W;
    let cy = rand() * H;
    const segments = 4 + Math.floor(rand() * 4);
    g.beginPath();
    g.moveTo(cx, cy);
    for (let s = 0; s < segments; s++) {
      cx += (rand() - 0.5) * 46;
      cy += 8 + rand() * 26;
      g.lineTo(cx, cy);
    }
    g.strokeStyle = "rgba(0, 0, 0, 0.42)";
    g.lineWidth = 1.5;
    g.stroke();
    g.strokeStyle = "rgba(170, 200, 230, 0.05)";
    g.lineWidth = 1;
    g.translate(1.2, 1.2);
    g.stroke();
    g.translate(-1.2, -1.2);
  }

  // Fine grain: one deterministic pass over the pixels.
  const image = g.getImageData(0, 0, W, H);
  const data = image.data;
  let state = 0x9e3779b9 | 0;
  for (let i = 0; i < data.length; i += 4) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const n = (((state >>> 0) % 1000) / 1000 - 0.5) * 15;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n * 1.05;
  }
  g.putImageData(image, 0, 0);

  // Everything outside the arena sits a little deeper in shadow.
  g.fillStyle = "rgba(2, 4, 8, 0.42)";
  g.fillRect(0, 0, W, L.arenaTop);
  g.fillRect(0, L.arenaTop + L.arenaHeight, W, H - L.arenaTop - L.arenaHeight);

  // Light spill from the glowing edges into the arena.
  for (const edge of [0, 1]) {
    const edgeY = edge === 0 ? L.arenaTop : L.arenaTop + L.arenaHeight;
    const dir = edge === 0 ? 1 : -1;
    const spill = g.createLinearGradient(0, edgeY, 0, edgeY + dir * 150);
    spill.addColorStop(0, "rgba(38, 224, 255, 0.16)");
    spill.addColorStop(1, "rgba(38, 224, 255, 0)");
    g.fillStyle = spill;
    g.fillRect(0, Math.min(edgeY, edgeY + dir * 150), W, 150);
  }

  const vignette = g.createRadialGradient(W / 2, H / 2, 420, W / 2, H / 2, 1250);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.6)");
  g.fillStyle = vignette;
  g.fillRect(0, 0, W, H);

  glowLine(g, L.arenaTop);
  glowLine(g, L.arenaTop + L.arenaHeight);
}

let wallCanvas: HTMLCanvasElement | null | undefined;

function getWall(): HTMLCanvasElement | null {
  if (wallCanvas !== undefined) return wallCanvas;
  wallCanvas = null;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = VIDEO.width;
  canvas.height = VIDEO.height;
  const g = canvas.getContext("2d");
  if (!g) return null;
  buildWall(g);
  wallCanvas = canvas;
  return canvas;
}

function paintFlatBackdrop(ctx: CanvasRenderingContext2D) {
  const L = SWARM_LAYOUT;
  ctx.fillStyle = "#0d1218";
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
  for (const y of [L.arenaTop, L.arenaTop + L.arenaHeight]) {
    ctx.fillStyle = CYAN;
    ctx.fillRect(0, y - 2, VIDEO.width, 4);
  }
}

// ---------------------------------------------------------------------------
// Text
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
  /** Dark offset copy under the text for depth. */
  drop?: number;
  /** Horizontal squeeze applied to the glyphs (1 = none). */
  scaleX?: number;
}

function pushBox(boxes: ReelBox[], label: string, left: number, top: number, right: number, bottom: number): ReelBox {
  const box: ReelBox = { label, left, top, right, bottom };
  assertReelSafeBox(box);
  boxes.push(box);
  return box;
}

/** Pick (and cache) the largest font size <= `size` whose width fits `maxWidth`. */
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

/** Draw text with an outline and record its (stroke-inclusive) safe-zone box. */
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
  // The outline widens the text, so it has to fit inside the box too (plus a little for glyph bearings).
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
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = stroke;
    if (stroke > 0) ctx.strokeText(str, 0, style.drop);
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

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

let popAge = new Int16Array(0);

function popScale(age: number): number {
  if (age < 0 || age >= POP_FRAMES) return 1;
  return 1 + 0.35 * Math.sin((Math.PI * age) / POP_FRAMES);
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
  ctx.beginPath();
  ctx.rect(L.arenaLeft, L.arenaTop, L.arenaWidth, L.arenaHeight);
  ctx.clip();
  ctx.translate(0, L.arenaTop);
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

  // Ring flashes at conversions, in the winner's colour.
  const ringFirst = trace.eventStart[Math.max(0, f - RING_FRAMES + 1)];
  ctx.globalCompositeOperation = "lighter";
  for (let e = ringFirst; e < lastEvent; e++) {
    const event = trace.events[e];
    const u = (f - event.frame) / RING_FRAMES;
    const color = types[event.winner].color;
    const radius = trace.config.radius * (0.9 + 2.5 * easeOut(u));
    ctx.globalAlpha = Math.max(0, 1 - u) ** 1.4 * 0.9;
    ctx.strokeStyle = lighten(color, 0.3);
    ctx.lineWidth = 1.5 + 5 * (1 - u);
    ctx.beginPath();
    ctx.arc(event.x, event.y, radius, 0, TAU);
    ctx.stroke();
    if (f - event.frame < 4) {
      ctx.globalAlpha = 0.5 * (1 - (f - event.frame) / 4);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(event.x, event.y, trace.config.radius * 0.95, 0, TAU);
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

  // Proportion bar: rounded track, one segment per type, thin separators on the seams.
  ctx.save();
  roundRectPath(ctx, L.barLeft, L.barTop, L.barWidth, L.barHeight, L.barHeight / 2);
  ctx.fillStyle = "#0a0d12";
  ctx.fill();
  ctx.clip();
  const segments = barSegments(counts, L.barLeft, L.barWidth);
  for (const segment of segments) {
    if (segment.width <= 0) continue;
    const color = skins[segment.type].color;
    ctx.fillStyle = color;
    ctx.fillRect(segment.x, L.barTop, segment.width, L.barHeight);
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.fillRect(segment.x, L.barTop, segment.width, L.barHeight * 0.38);
  }
  ctx.fillStyle = "rgba(6, 9, 14, 0.85)";
  for (let k = 1; k < segments.length; k++) {
    if (segments[k].width > 0 && segments[k].x > L.barLeft + 1) ctx.fillRect(segments[k].x - 1.5, L.barTop, 3, L.barHeight);
  }
  ctx.restore();
  roundRectPath(ctx, L.barLeft + 2, L.barTop + 2, L.barWidth - 4, L.barHeight - 4, L.barHeight / 2 - 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = 4;
  ctx.stroke();
  pushBox(boxes, "bar", L.barLeft, L.barTop, L.barLeft + L.barWidth, L.barTop + L.barHeight);

  // Counters: stable icon slot per column, live number to its right.
  const columnWidth = L.columnsWidth / K;
  const iconSize = K <= 3 ? 62 : 38;
  const gap = K <= 3 ? 16 : 8;
  const numberSize = K <= 3 ? 84 : 50;
  const numberStyle: TextStyle = {
    size: numberSize,
    maxWidth: columnWidth - iconSize - gap - 10,
    minSize: 30,
    fill: "#ffffff",
    stroke: "#06090e",
    strokeWidth: Math.round(numberSize * 0.14),
    align: "left",
    drop: 4,
  };
  const nominalSize = fitSize(ctx, "000", 900, numberStyle);
  ctx.font = `900 ${nominalSize}px ${FONT}`;
  const nominalWidth = ctx.measureText("000").width;
  const groupWidth = iconSize + gap + nominalWidth;
  for (let k = 0; k < K; k++) {
    const center = L.columnsLeft + columnWidth * (k + 0.5);
    const left = center - groupWidth / 2;
    const iconCx = left + iconSize / 2;
    const drawSize = iconSize * (skins[k].icon === "scissors" ? 1.12 : 1);
    drawTypeIcon(ctx, skins[k].icon, iconCx, L.counterCenterY, drawSize, skins[k].color);
    pushBox(boxes, `${skins[k].name} icon`, iconCx - drawSize / 2, L.counterCenterY - drawSize / 2, iconCx + drawSize / 2, L.counterCenterY + drawSize / 2);
    const digitHeight = nominalSize * 0.73;
    drawText(ctx, boxes, String(counts[k]), left + iconSize + gap, L.counterCenterY + digitHeight / 2, {
      ...numberStyle,
      size: nominalSize,
      maxWidth: Infinity,
    });
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
  const text = `${skin.caption} WINS`;
  const t = (f - trace.winFrame) / CAPTION_POP_FRAMES;
  const scale = 0.55 + 0.45 * easeOutBack(t);
  const alpha = Math.max(0, Math.min(1, t * 2.4));
  const cx = L.centerX;
  const cy = L.arenaTop + L.arenaHeight / 2;
  const panelW = 800;
  const panelH = 230;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  roundRectPath(ctx, -panelW / 2, -panelH / 2, panelW, panelH, 44);
  ctx.fillStyle = "rgba(5, 8, 13, 0.84)";
  ctx.shadowColor = skin.color;
  ctx.shadowBlur = 38;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 7;
  ctx.strokeStyle = skin.color;
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  roundRectPath(ctx, -panelW / 2 + 9, -panelH / 2 + 9, panelW - 18, panelH - 18, 36);
  ctx.stroke();

  const maxWidth = panelW - 90;
  const weight = 900;
  const fontSize = fitSize(ctx, text, weight, { size: CAPTION_FONT_SIZE, maxWidth, minSize: 60, fill: skin.color });
  ctx.font = `${weight} ${fontSize}px ${FONT}`;
  const metrics = ctx.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.76;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.22;
  const baseline = (ascent - descent) / 2;
  const px = -metrics.width / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.round(fontSize * 0.13);
  ctx.strokeStyle = "#04060a";
  ctx.strokeText(text, px, baseline);
  ctx.fillStyle = skin.color;
  ctx.fillText(text, px, baseline);
  ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
  ctx.save();
  ctx.beginPath();
  ctx.rect(px - 4, baseline - ascent - 4, metrics.width + 8, ascent * 0.42);
  ctx.clip();
  ctx.fillText(text, px, baseline);
  ctx.restore();
  ctx.restore();

  // Recorded in canvas space with the pop scale applied, so the check is on what is really drawn.
  const half = Math.round(fontSize * 0.13) / 2;
  pushBox(
    boxes,
    text,
    cx + scale * (px - (metrics.actualBoundingBoxLeft || 0) - half),
    cy + scale * (baseline - ascent - half),
    cx + scale * (px + (metrics.actualBoundingBoxRight || metrics.width) + half),
    cy + scale * (baseline + descent + half),
  );
  pushBox(boxes, "caption panel", cx - (scale * panelW) / 2, cy - (scale * panelH) / 2, cx + (scale * panelW) / 2, cy + (scale * panelH) / 2);
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
  const wall = getWall();
  if (wall) ctx.drawImage(wall, 0, 0);
  else paintFlatBackdrop(ctx);

  paintSprites(ctx, definition, trace, f);

  // A faint breathing pulse on the glowing edges.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.1 + 0.07 * Math.sin((f / VIDEO.fps) * 2.4);
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, L.arenaTop);
  ctx.lineTo(VIDEO.width, L.arenaTop);
  ctx.moveTo(0, L.arenaTop + L.arenaHeight);
  ctx.lineTo(VIDEO.width, L.arenaTop + L.arenaHeight);
  ctx.stroke();
  ctx.restore();

  drawText(ctx, boxes, definition.skin.title, L.centerX, L.titleBaseline, {
    size: TITLE_FONT_SIZE,
    minSize: TITLE_MIN_FONT_SIZE,
    scaleX: TITLE_SCALE_X,
    maxWidth: 840,
    fill: "#ffffff",
    stroke: "#05080c",
    strokeWidth: 14,
    drop: 6,
  });
  drawText(ctx, boxes, definition.skin.rules, L.centerX, L.rulesBaseline, {
    size: RULES_FONT_SIZE,
    weight: 700,
    maxWidth: 840,
    minSize: 22,
    fill: "#e3ecf8",
    stroke: "rgba(3, 6, 10, 0.85)",
    strokeWidth: 6,
  });

  paintBarAndCounters(ctx, boxes, definition, trace, f);
  if (f >= trace.winFrame) paintCaption(ctx, boxes, definition, trace, f);
  return boxes;
}
