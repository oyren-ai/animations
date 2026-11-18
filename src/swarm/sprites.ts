import { mulberry32 } from "./sim.ts";
import type { SwarmIcon } from "./themes.ts";

/**
 * Original Oyren flat-vector sprites for the swarm scenes. Everything is plain
 * canvas paths: no images, no fonts, no per-sprite gradients or shadow blur so
 * hundreds of sprites render quickly at 60 fps. Outer dark casings are stroked
 * BEFORE fills so every blade and shape keeps its full bold solid colour at
 * phone size.
 */

const TAU = Math.PI * 2;
const OUTLINE = "#040a10";

export const ROCK_VARIANTS = 6;
export const PAPER_VARIANTS = 7;

interface GemFacet {
  pts: readonly number[];
  fill: string;
}

interface GemShape {
  outline: readonly number[];
  facets: readonly GemFacet[];
  table: readonly number[];
}

/**
 * Faceted slate-blue crystal gem: crisp 7..8-sided cut polygon, facets lit from
 * the upper-left in Oyren slate-sky blues, and a bright flat crown table.
 */
function buildGem(variant: number): GemShape {
  const rand = mulberry32(4400 + variant * 47);
  const n = 7 + (variant % 2);
  const phase = (variant / ROCK_VARIANTS) * (TAU / n) + rand() * 0.35;
  const squash = 0.9 + (variant % 3) * 0.04;
  const outline: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * TAU + (rand() - 0.5) * 0.16;
    const rr = 0.88 + (k % 2 === 0 ? 0.08 : -0.03) + (rand() - 0.5) * 0.08;
    outline.push(Math.cos(a) * rr, Math.sin(a) * rr * squash);
  }
  const tableShiftX = -0.06;
  const tableShiftY = -0.08;
  const table: number[] = [];
  for (let k = 0; k < n; k++) {
    table.push(
      tableShiftX + (outline[2 * k] - tableShiftX) * 0.48,
      tableShiftY + (outline[2 * k + 1] - tableShiftY) * 0.48,
    );
  }
  const palette = ["#244d6b", "#356d94", "#4d94c2", "#6bb7e3", "#8fd0f5"];
  const facets: GemFacet[] = [];
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    const mx = (outline[2 * k] + outline[2 * k1]) * 0.5 - tableShiftX;
    const my = (outline[2 * k + 1] + outline[2 * k1 + 1]) * 0.5 - tableShiftY;
    const lit = Math.cos(Math.atan2(my, mx) + 2.25);
    const tier = Math.max(0, Math.min(palette.length - 1, Math.round((lit + 1) * 2)));
    facets.push({
      pts: [
        outline[2 * k],
        outline[2 * k + 1],
        outline[2 * k1],
        outline[2 * k1 + 1],
        table[2 * k1],
        table[2 * k1 + 1],
        table[2 * k],
        table[2 * k + 1],
      ],
      fill: palette[tier],
    });
  }
  return { outline, facets, table };
}

const GEMS: readonly GemShape[] = Array.from({ length: ROCK_VARIANTS }, (_, v) => buildGem(v));

function contactShadow(ctx: CanvasRenderingContext2D, u: number, wide: number) {
  ctx.fillStyle = "rgba(1, 4, 7, 0.45)";
  ctx.beginPath();
  ctx.ellipse(0, u * 0.82, u * wide, u * 0.26, 0, 0, TAU);
  ctx.fill();
}

function tracePoly(ctx: CanvasRenderingContext2D, pts: readonly number[], u: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0] * u, pts[1] * u);
  for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k] * u, pts[k + 1] * u);
  ctx.closePath();
}

function drawRock(ctx: CanvasRenderingContext2D, u: number, variant: number) {
  const gem = GEMS[Math.abs(variant) % GEMS.length];
  contactShadow(ctx, u, 0.8);
  ctx.lineJoin = "round";
  tracePoly(ctx, gem.outline, u);
  ctx.lineWidth = Math.max(2.6, u * 0.22);
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = "#356d94";
  ctx.fill();
  for (const facet of gem.facets) {
    tracePoly(ctx, facet.pts, u);
    ctx.fillStyle = facet.fill;
    ctx.fill();
  }
  tracePoly(ctx, gem.table, u);
  ctx.fillStyle = "#bce6fb";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.58)";
  ctx.lineWidth = Math.max(1.1, u * 0.06);
  ctx.stroke();
}

/** Ice-white code sheet with syntax-highlighted lines in Oyren lime and slate-blue. */
function drawPaper(ctx: CanvasRenderingContext2D, u: number, variant: number) {
  contactShadow(ctx, u, 0.68);
  ctx.rotate(((Math.abs(variant) % PAPER_VARIANTS) - 3) * 0.075);
  const w = 0.72 * u;
  const h = 0.9 * u;
  const r = 0.16 * u;

  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.roundRect(-w, -h, 2 * w, 2 * h, r);
  ctx.lineWidth = Math.max(2.6, u * 0.2);
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = "#eef6fc";
  ctx.fill();

  // Top code-tab header strip.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#cfe1ef";
  ctx.fillRect(-w, -h, 2 * w, 0.38 * u);
  ctx.fillStyle = "#8bc800";
  ctx.beginPath();
  ctx.arc(-w + 0.22 * u, -h + 0.19 * u, 0.065 * u, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#4892bf";
  ctx.beginPath();
  ctx.arc(-w + 0.42 * u, -h + 0.19 * u, 0.065 * u, 0, TAU);
  ctx.fill();
  ctx.restore();

  // Indented code lines.
  const barH = Math.max(1.8, 0.12 * u);
  ctx.fillStyle = "#7ab800";
  ctx.fillRect(-0.48 * u, -0.34 * u, 0.34 * u, barH);
  ctx.fillStyle = "#357ca8";
  ctx.fillRect(-0.06 * u, -0.34 * u, 0.52 * u, barH);

  ctx.fillStyle = "#4892bf";
  ctx.fillRect(-0.34 * u, -0.04 * u, 0.48 * u, barH);
  ctx.fillStyle = "#698399";
  ctx.fillRect(0.2 * u, -0.04 * u, 0.26 * u, barH);

  ctx.fillStyle = "#7ab800";
  ctx.fillRect(-0.34 * u, 0.26 * u, 0.28 * u, barH);
  ctx.fillStyle = "#2b465c";
  ctx.fillRect(0.02 * u, 0.26 * u, 0.42 * u, barH);

  ctx.fillStyle = "#357ca8";
  ctx.fillRect(-0.48 * u, 0.55 * u, 0.56 * u, barH);
}

/**
 * Bold Oyren shears pointing along +x: wide solid-filled lime blades with a
 * clear open-V silhouette and chunky ink-coloured ring handles (+40 % thicker strokes).
 */
function drawScissors(ctx: CanvasRenderingContext2D, u: number, color: string, open: number) {
  // Keep a generous minimum V-opening so the two blades never collapse into one thin line.
  const spread = 0.2 + 0.22 * Math.max(0, Math.min(1, open));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // 1. Draw both ink-coloured ring handles first (at the -x end), with thick bold strokes
  //    and a crisp slate-rim outline so the dark ink rings stand out against the arena.
  for (const s of [1, -1]) {
    ctx.save();
    ctx.rotate(s * spread);
    ctx.save();
    ctx.rotate(Math.PI + s * 0.52);

    // Outer slate-rim silhouette for legibility against dark ink ground.
    ctx.strokeStyle = "#5d7f99";
    ctx.lineWidth = 0.38 * u;
    ctx.beginPath();
    ctx.moveTo(0.02 * u, 0);
    ctx.lineTo(0.46 * u, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0.73 * u, 0, 0.26 * u, 0, TAU);
    ctx.strokeStyle = "#5d7f99";
    ctx.lineWidth = 0.36 * u;
    ctx.stroke();

    // Bold ink-coloured handle body (~45 % thicker stroke than before).
    ctx.strokeStyle = "#0e1d2a";
    ctx.lineWidth = 0.27 * u;
    ctx.beginPath();
    ctx.moveTo(0.02 * u, 0);
    ctx.lineTo(0.46 * u, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0.73 * u, 0, 0.26 * u, 0, TAU);
    ctx.strokeStyle = "#0e1d2a";
    ctx.lineWidth = 0.25 * u;
    ctx.stroke();

    // Punch clean dark arena-ink finger hole inside the ring.
    ctx.fillStyle = "#04090e";
    ctx.beginPath();
    ctx.arc(0.73 * u, 0, 0.12 * u, 0, TAU);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  // 2. Draw both wide, solid-filled lime blades on top (stroking outer casing FIRST so
  //    100 % of the wide blade polygon stays bright solid lime).
  for (const s of [1, -1]) {
    ctx.save();
    ctx.rotate(s * spread + s * 0.04);

    const bladePath = () => {
      ctx.beginPath();
      ctx.moveTo(-0.18 * u, -s * 0.06 * u);
      ctx.lineTo(1.06 * u, -s * 0.02 * u);
      ctx.lineTo(0.92 * u, s * 0.21 * u);
      ctx.lineTo(0.32 * u, s * 0.31 * u);
      ctx.lineTo(-0.16 * u, s * 0.24 * u);
      ctx.closePath();
    };

    bladePath();
    ctx.lineWidth = Math.max(2.6, u * 0.2);
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    bladePath();
    ctx.fillStyle = color;
    ctx.fill();

    // Bright pale-lime inner bevel along the cutting edge for crisp volume.
    ctx.beginPath();
    ctx.moveTo(-0.08 * u, -s * 0.02 * u);
    ctx.lineTo(0.96 * u, -s * 0.005 * u);
    ctx.lineTo(0.84 * u, s * 0.1 * u);
    ctx.lineTo(-0.08 * u, s * 0.08 * u);
    ctx.closePath();
    ctx.fillStyle = "#ecff8c";
    ctx.fill();

    ctx.restore();
  }

  // 3. Bold ink pivot bolt + bright screw head at the crossing.
  ctx.beginPath();
  ctx.arc(0, 0, 0.19 * u, 0, TAU);
  ctx.fillStyle = "#0b1824";
  ctx.fill();
  ctx.lineWidth = Math.max(1.8, u * 0.08);
  ctx.strokeStyle = "#6c8ea8";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 0.075 * u, 0, TAU);
  ctx.fillStyle = "#f1f7fd";
  ctx.fill();
  ctx.lineCap = "butt";
}

const colorMixCache = new Map<string, string>();

/** Mix a `#rrggbb` colour toward white (`amount > 0`) or black (`amount < 0`). */
export function lighten(hex: string, amount: number): string {
  const key = `${hex}|${amount}`;
  const cached = colorMixCache.get(key);
  if (cached) return cached;
  const n = parseInt(hex.slice(1), 16);
  const target = amount >= 0 ? 255 : 0;
  const a = Math.min(1, Math.abs(amount));
  const mix = (c: number) => Math.round(c + (target - c) * a);
  const out = `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
  colorMixCache.set(key, out);
  return out;
}

/**
 * Bold, 100 % solid-filled Five-Rivals shapes: outer dark casing is stroked FIRST
 * (+40 % thicker) and the full body is filled solidly with faceted brand tones
 * (no dark cutouts that would thin the shape against the dark arena).
 */
function drawRivalShape(ctx: CanvasRenderingContext2D, icon: SwarmIcon, u: number, color: string) {
  contactShadow(ctx, u, 0.8);
  ctx.lineJoin = "round";
  const casingW = Math.max(3.2, u * 0.25);

  if (icon === "circle") {
    ctx.beginPath();
    ctx.arc(0, 0, u * 0.92, 0, TAU);
    ctx.lineWidth = casingW;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();

    // Solid lit upper-left bevel disc + crisp lighter inner ring.
    ctx.beginPath();
    ctx.arc(-u * 0.14, -u * 0.16, u * 0.56, 0, TAU);
    ctx.fillStyle = lighten(color, 0.42);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, u * 0.34, 0, TAU);
    ctx.fillStyle = lighten(color, -0.18);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(-u * 0.06, -u * 0.06, u * 0.16, 0, TAU);
    ctx.fillStyle = lighten(color, 0.65);
    ctx.fill();
    return;
  }

  if (icon === "triangle") {
    const topY = -u * 1.02;
    const botY = u * 0.78;
    const halfW = u * 1.02;
    const tri = () => {
      ctx.beginPath();
      ctx.moveTo(0, topY);
      ctx.lineTo(halfW, botY);
      ctx.lineTo(-halfW, botY);
      ctx.closePath();
    };
    tri();
    ctx.lineWidth = casingW;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();

    // Left lit facet.
    ctx.beginPath();
    ctx.moveTo(0, topY);
    ctx.lineTo(0, botY);
    ctx.lineTo(-halfW, botY);
    ctx.closePath();
    ctx.fillStyle = lighten(color, 0.32);
    ctx.fill();

    // Solid bright inner crown delta.
    ctx.beginPath();
    ctx.moveTo(0, -u * 0.44);
    ctx.lineTo(u * 0.42, u * 0.42);
    ctx.lineTo(-u * 0.42, u * 0.42);
    ctx.closePath();
    ctx.fillStyle = lighten(color, 0.58);
    ctx.fill();
    return;
  }

  if (icon === "square") {
    const s = u * 0.86;
    const c = u * 0.24;
    const chamfer = () => {
      ctx.beginPath();
      ctx.moveTo(-s + c, -s);
      ctx.lineTo(s - c, -s);
      ctx.lineTo(s, -s + c);
      ctx.lineTo(s, s - c);
      ctx.lineTo(s - c, s);
      ctx.lineTo(-s + c, s);
      ctx.lineTo(-s, s - c);
      ctx.lineTo(-s, -s + c);
      ctx.closePath();
    };
    chamfer();
    ctx.lineWidth = casingW;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();

    // Bottom-right subtle slate bevel so the solid ice-white block has crisp volume.
    ctx.beginPath();
    ctx.moveTo(s, -s + c);
    ctx.lineTo(s, s - c);
    ctx.lineTo(s - c, s);
    ctx.lineTo(-s + c, s);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = "#cadeee";
    ctx.fill();

    // Solid slate-blue inner diamond accent.
    ctx.beginPath();
    ctx.moveTo(0, -u * 0.4);
    ctx.lineTo(u * 0.4, 0);
    ctx.lineTo(0, u * 0.4);
    ctx.lineTo(-u * 0.4, 0);
    ctx.closePath();
    ctx.fillStyle = "#4d98c7";
    ctx.fill();
    return;
  }

  if (icon === "star") {
    const pts: number[] = [];
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 === 0 ? u * 1.08 : u * 0.52;
      pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    tracePoly(ctx, pts, 1);
    ctx.lineWidth = casingW;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();

    for (let k = 0; k < 10; k += 2) {
      const k1 = (k + 1) % 10;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(pts[2 * k], pts[2 * k + 1]);
      ctx.lineTo(pts[2 * k1], pts[2 * k1 + 1]);
      ctx.closePath();
      ctx.fillStyle = lighten(color, 0.35);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(0, 0, u * 0.28, 0, TAU);
    ctx.fillStyle = "#f4ecff";
    ctx.fill();
    return;
  }

  // Bold solid-filled faceted hexagon prism.
  const hex: number[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    hex.push(Math.cos(a) * u * 0.98, Math.sin(a) * u * 0.98);
  }
  tracePoly(ctx, hex, 1);
  ctx.lineWidth = casingW;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(hex[6], hex[7]);
  ctx.lineTo(hex[8], hex[9]);
  ctx.lineTo(hex[10], hex[11]);
  ctx.closePath();
  ctx.fillStyle = lighten(color, 0.36);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(hex[2], hex[3]);
  ctx.lineTo(hex[4], hex[5]);
  ctx.lineTo(hex[6], hex[7]);
  ctx.closePath();
  ctx.fillStyle = lighten(color, -0.18);
  ctx.fill();

  const innerHex: number[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    innerHex.push(Math.cos(a) * u * 0.42, Math.sin(a) * u * 0.42);
  }
  tracePoly(ctx, innerHex, 1);
  ctx.fillStyle = lighten(color, 0.52);
  ctx.fill();
}

/**
 * Draw one sprite centred at (x, y). `size` is the diameter in px; `angle`
 * sets the heading for scissors; `variant` picks a rock or paper look;
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
    contactShadow(ctx, u * 0.82, 0.9);
    ctx.rotate(angle);
    drawScissors(ctx, u, color, open);
  } else {
    drawRivalShape(ctx, icon, u, color);
  }
  ctx.restore();
}

/** Small glyph used by the counters; scissors are tilted so they read cleanly. */
export function drawTypeIcon(
  ctx: CanvasRenderingContext2D,
  icon: SwarmIcon,
  cx: number,
  cy: number,
  size: number,
  color: string,
) {
  drawSprite(ctx, icon, cx, cy, size, icon === "scissors" ? -0.58 : 0, color, 2, 0.42);
}
