import { mulberry32 } from "./sim.ts";
import type { SwarmIcon } from "./themes.ts";

/**
 * Original vector sprites for the swarm scenes. Everything is plain canvas paths:
 * no images, no fonts. `size` is the visual diameter (length for scissors) in px.
 * All drawers use flat fills only (no per-sprite gradients or shadow blur) so a
 * few hundred of them stay cheap per frame.
 */

const TAU = Math.PI * 2;
const OUTLINE = "#12161c";

export const ROCK_VARIANTS = 6;
export const PAPER_VARIANTS = 7;

interface RockFacet {
  pts: readonly number[];
  fill: string;
}

interface RockShape {
  outline: readonly number[];
  facets: readonly RockFacet[];
  cracks: readonly number[];
}

/**
 * A boulder: irregular outline, side facets shaded by their outward normal (light from
 * the upper left), a lighter top plateau, and a couple of hairline cracks.
 */
function buildRock(variant: number): RockShape {
  const rand = mulberry32(9100 + variant * 31);
  const n = 8 + (variant % 3);
  const phase = rand() * TAU;
  const squash = 0.8 + rand() * 0.18;
  const outline: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * TAU + (rand() - 0.5) * 0.45;
    const rr = 0.74 + rand() * 0.34;
    outline.push(Math.cos(a) * rr, Math.sin(a) * rr * squash);
  }
  const ridgeX = -0.1;
  const ridgeY = -0.16;
  const inner: number[] = [];
  for (let k = 0; k < n; k++) {
    inner.push(ridgeX + (outline[2 * k] - ridgeX) * 0.5, ridgeY + (outline[2 * k + 1] - ridgeY) * 0.5);
  }
  const facets: RockFacet[] = [];
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    const x0 = outline[2 * k];
    const y0 = outline[2 * k + 1];
    const x1 = outline[2 * k1];
    const y1 = outline[2 * k1 + 1];
    const lit = Math.cos(Math.atan2((y0 + y1) / 2 - ridgeY, (x0 + x1) / 2 - ridgeX) + 2.35);
    const lightness = 47 + lit * 19 + (rand() - 0.5) * 6;
    facets.push({
      pts: [x0, y0, x1, y1, inner[2 * k1], inner[2 * k1 + 1], inner[2 * k], inner[2 * k + 1]],
      fill: `hsl(214, 9%, ${lightness.toFixed(1)}%)`,
    });
  }
  facets.push({ pts: inner, fill: "hsl(214, 8%, 71%)" });
  const cracks: number[] = [];
  for (let c = 0; c < 2; c++) {
    const k = Math.floor(rand() * n);
    cracks.push(inner[2 * k] * 0.9, inner[2 * k + 1] * 0.9, inner[2 * k] * 0.4 + ridgeX * 0.3, inner[2 * k + 1] * 0.4 + ridgeY * 0.3);
  }
  return { outline, facets, cracks };
}

const ROCKS: readonly RockShape[] = Array.from({ length: ROCK_VARIANTS }, (_, v) => buildRock(v));

function contactShadow(ctx: CanvasRenderingContext2D, u: number, wide: number) {
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(0, u * 0.8, u * wide, u * 0.28, 0, 0, TAU);
  ctx.fill();
}

function drawRock(ctx: CanvasRenderingContext2D, u: number, variant: number) {
  const rock = ROCKS[Math.abs(variant) % ROCKS.length];
  contactShadow(ctx, u, 0.85);
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let k = 0; k < rock.outline.length; k += 2) {
    if (k === 0) ctx.moveTo(rock.outline[0] * u, rock.outline[1] * u);
    else ctx.lineTo(rock.outline[k] * u, rock.outline[k + 1] * u);
  }
  ctx.closePath();
  ctx.fillStyle = "hsl(214, 9%, 48%)";
  ctx.fill();
  for (const facet of rock.facets) {
    const p = facet.pts;
    ctx.fillStyle = facet.fill;
    ctx.beginPath();
    ctx.moveTo(p[0] * u, p[1] * u);
    for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k] * u, p[k + 1] * u);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(20,24,30,0.45)";
  ctx.lineWidth = Math.max(1, u * 0.05);
  ctx.beginPath();
  for (let k = 0; k < rock.cracks.length; k += 4) {
    ctx.moveTo(rock.cracks[k] * u, rock.cracks[k + 1] * u);
    ctx.lineTo(rock.cracks[k + 2] * u, rock.cracks[k + 3] * u);
  }
  ctx.stroke();
  ctx.lineWidth = Math.max(1.8, u * 0.12);
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  for (let k = 0; k < rock.outline.length; k += 2) {
    if (k === 0) ctx.moveTo(rock.outline[0] * u, rock.outline[1] * u);
    else ctx.lineTo(rock.outline[k] * u, rock.outline[k + 1] * u);
  }
  ctx.closePath();
  ctx.stroke();
}

function drawPaper(ctx: CanvasRenderingContext2D, u: number, variant: number) {
  contactShadow(ctx, u, 0.7);
  ctx.rotate(((Math.abs(variant) % PAPER_VARIANTS) - 3) * 0.1);
  const w = 0.68 * u;
  const h = 0.9 * u;
  const fold = 0.38 * u;
  ctx.fillStyle = "rgba(205,225,255,0.09)";
  ctx.fillRect(-w - 0.14 * u, -h - 0.14 * u, 2 * (w + 0.14 * u), 2 * (h + 0.14 * u));
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.6, u * 0.1);
  ctx.strokeStyle = "#566380";
  ctx.beginPath();
  ctx.moveTo(-w, -h);
  ctx.lineTo(w - fold, -h);
  ctx.lineTo(w, -h + fold);
  ctx.lineTo(w, h);
  ctx.lineTo(-w, h);
  ctx.closePath();
  ctx.fillStyle = "#f7faff";
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w - fold, -h);
  ctx.lineTo(w - fold, -h + fold);
  ctx.lineTo(w, -h + fold);
  ctx.closePath();
  ctx.fillStyle = "#bccbe6";
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#a3b3d3";
  ctx.lineWidth = Math.max(1.2, u * 0.085);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let line = 0; line < 3; line++) {
    const y = (-0.12 + line * 0.34) * u;
    ctx.moveTo(-0.42 * u, y);
    ctx.lineTo((line === 2 ? 0.1 : 0.42) * u, y);
  }
  ctx.stroke();
  ctx.lineCap = "butt";
}

/** Blades point along +x; `open` (0..1) swings the two halves apart like a snip. */
function drawScissors(ctx: CanvasRenderingContext2D, u: number, color: string, open: number) {
  const spread = 0.04 + 0.2 * Math.max(0, Math.min(1, open));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const s of [1, -1]) {
    ctx.save();
    ctx.rotate(s * spread);
    // Blade.
    ctx.save();
    ctx.rotate(s * 0.07);
    ctx.beginPath();
    ctx.moveTo(-0.12 * u, -0.15 * u);
    ctx.lineTo(1.0 * u, -0.02 * u);
    ctx.lineTo(1.0 * u, 0.035 * u);
    ctx.lineTo(-0.12 * u, 0.17 * u);
    ctx.closePath();
    ctx.fillStyle = "#e9eef4";
    ctx.fill();
    ctx.lineWidth = Math.max(1.3, u * 0.075);
    ctx.strokeStyle = "#49515c";
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = Math.max(1, u * 0.04);
    ctx.beginPath();
    ctx.moveTo(0.06 * u, -0.07 * u);
    ctx.lineTo(0.88 * u, -0.006 * u);
    ctx.stroke();
    ctx.restore();
    // Handle: shank plus ring, bent away from the blade.
    ctx.save();
    ctx.rotate(Math.PI + s * 0.58);
    ctx.lineWidth = 0.27 * u;
    ctx.strokeStyle = "#4d1411";
    ctx.beginPath();
    ctx.moveTo(0.02 * u, 0);
    ctx.lineTo(0.52 * u, 0);
    ctx.stroke();
    ctx.lineWidth = 0.14 * u;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(0.02 * u, 0);
    ctx.lineTo(0.52 * u, 0);
    ctx.stroke();
    ctx.lineWidth = 0.29 * u;
    ctx.strokeStyle = "#4d1411";
    ctx.beginPath();
    ctx.arc(0.8 * u, 0, 0.25 * u, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 0.15 * u;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(0.8 * u, 0, 0.25 * u, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, 0.045 * u);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(0.8 * u, 0, 0.25 * u, 3.6, 4.7);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
  ctx.fillStyle = "#4b5461";
  ctx.strokeStyle = "#15191f";
  ctx.lineWidth = Math.max(1, u * 0.05);
  ctx.beginPath();
  ctx.arc(0, 0, 0.11 * u, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.arc(-0.03 * u, -0.03 * u, 0.035 * u, 0, TAU);
  ctx.fill();
  ctx.lineCap = "butt";
}

const lightenCache = new Map<string, string>();

/** Mix a `#rrggbb` colour toward white. */
export function lighten(hex: string, amount: number): string {
  const key = `${hex}|${amount}`;
  const cached = lightenCache.get(key);
  if (cached) return cached;
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const out = `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
  lightenCache.set(key, out);
  return out;
}

function shapePath(ctx: CanvasRenderingContext2D, icon: SwarmIcon, u: number) {
  ctx.beginPath();
  if (icon === "circle") {
    ctx.arc(0, 0, u * 0.9, 0, TAU);
  } else if (icon === "triangle") {
    ctx.moveTo(0, -u * 0.98);
    ctx.lineTo(u * 0.98, u * 0.74);
    ctx.lineTo(-u * 0.98, u * 0.74);
    ctx.closePath();
  } else if (icon === "square") {
    const s = u * 0.82;
    const r = u * 0.26;
    ctx.moveTo(-s + r, -s);
    ctx.arcTo(s, -s, s, s, r);
    ctx.arcTo(s, s, -s, s, r);
    ctx.arcTo(-s, s, -s, -s, r);
    ctx.arcTo(-s, -s, s, -s, r);
    ctx.closePath();
  } else if (icon === "star") {
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 === 0 ? u * 1.04 : u * 0.46;
      if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  } else {
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      if (k === 0) ctx.moveTo(Math.cos(a) * u * 0.98, Math.sin(a) * u * 0.98);
      else ctx.lineTo(Math.cos(a) * u * 0.98, Math.sin(a) * u * 0.98);
    }
    ctx.closePath();
  }
}

function drawBadge(ctx: CanvasRenderingContext2D, icon: SwarmIcon, u: number, color: string) {
  contactShadow(ctx, u, 0.8);
  ctx.lineJoin = "round";
  shapePath(ctx, icon, u);
  ctx.lineWidth = Math.max(2.4, u * 0.26);
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  // Lighter inner facet, nudged toward the light, gives the badge a little volume.
  const alpha = ctx.globalAlpha;
  ctx.save();
  ctx.translate(-u * 0.13, -u * 0.15);
  ctx.scale(0.55, 0.55);
  shapePath(ctx, icon, u);
  ctx.fillStyle = lighten(color, 0.42);
  ctx.globalAlpha = alpha * 0.62;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = Math.max(1.2, u * 0.07);
  ctx.strokeStyle = lighten(color, 0.55);
  shapePath(ctx, icon, u * 0.96);
  ctx.globalAlpha = alpha * 0.55;
  ctx.stroke();
  ctx.globalAlpha = alpha;
}

/**
 * Draw one sprite centred at (x, y). `size` is the diameter in px; `angle`
 * only matters for scissors (heading); `variant` picks a rock or paper look;
 * `open` animates the scissors blades (0..1).
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  icon: SwarmIcon,
  x: number,
  y: number,
  size: number,
  angle = 0,
  color = "#ffffff",
  variant = 0,
  open = 0.3,
) {
  const u = size / 2;
  ctx.save();
  ctx.translate(x, y);
  if (icon === "rock") {
    drawRock(ctx, u, variant);
  } else if (icon === "paper") {
    drawPaper(ctx, u, variant);
  } else if (icon === "scissors") {
    contactShadow(ctx, u * 0.8, 0.9);
    ctx.rotate(angle);
    drawScissors(ctx, u, color, open);
  } else {
    drawBadge(ctx, icon, u, color);
  }
  ctx.restore();
}

/** Static icon used by the counters; scissors are tilted so they read as scissors. */
export function drawTypeIcon(
  ctx: CanvasRenderingContext2D,
  icon: SwarmIcon,
  cx: number,
  cy: number,
  size: number,
  color: string,
) {
  drawSprite(ctx, icon, cx, cy, size, icon === "scissors" ? -0.62 : 0, color, 2, 0.35);
}
