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

/** Bold layered ember flame for Fire (coral-amber outer, golden inner, hot cream core). */
function drawFire(ctx: CanvasRenderingContext2D, u: number, color: string, variant: number) {
  contactShadow(ctx, u, 0.72);
  ctx.lineJoin = "round";
  const flip = variant % 2 === 0 ? 1 : -1;
  ctx.scale(flip, 1);
  const casingW = Math.max(3.2, u * 0.25);

  const outerFlame = () => {
    ctx.beginPath();
    ctx.moveTo(0.06 * u, -1.08 * u);
    ctx.bezierCurveTo(0.42 * u, -0.62 * u, 0.86 * u, -0.26 * u, 0.82 * u, 0.24 * u);
    ctx.bezierCurveTo(0.8 * u, 0.68 * u, 0.44 * u, 0.88 * u, 0, 0.88 * u);
    ctx.bezierCurveTo(-0.5 * u, 0.88 * u, -0.84 * u, 0.62 * u, -0.82 * u, 0.16 * u);
    ctx.bezierCurveTo(-0.8 * u, -0.18 * u, -0.56 * u, -0.44 * u, -0.42 * u, -0.64 * u);
    ctx.bezierCurveTo(-0.4 * u, -0.36 * u, -0.24 * u, -0.32 * u, -0.22 * u, -0.52 * u);
    ctx.bezierCurveTo(-0.18 * u, -0.76 * u, -0.04 * u, -0.94 * u, 0.06 * u, -1.08 * u);
    ctx.closePath();
  };

  outerFlame();
  ctx.lineWidth = casingW;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();

  // Mid amber flame tongue.
  ctx.beginPath();
  ctx.moveTo(0.04 * u, -0.56 * u);
  ctx.bezierCurveTo(0.32 * u, -0.2 * u, 0.56 * u, 0.08 * u, 0.52 * u, 0.42 * u);
  ctx.bezierCurveTo(0.48 * u, 0.7 * u, 0.24 * u, 0.8 * u, 0, 0.8 * u);
  ctx.bezierCurveTo(-0.3 * u, 0.8 * u, -0.52 * u, 0.64 * u, -0.5 * u, 0.34 * u);
  ctx.bezierCurveTo(-0.48 * u, 0.04 * u, -0.22 * u, -0.22 * u, 0.04 * u, -0.56 * u);
  ctx.closePath();
  ctx.fillStyle = "#ffae34";
  ctx.fill();

  // Bright golden-cream hot inner core.
  ctx.beginPath();
  ctx.moveTo(0.02 * u, -0.02 * u);
  ctx.bezierCurveTo(0.22 * u, 0.2 * u, 0.3 * u, 0.44 * u, 0.24 * u, 0.62 * u);
  ctx.bezierCurveTo(0.18 * u, 0.74 * u, -0.16 * u, 0.74 * u, -0.22 * u, 0.6 * u);
  ctx.bezierCurveTo(-0.28 * u, 0.42 * u, -0.18 * u, 0.18 * u, 0.02 * u, -0.02 * u);
  ctx.closePath();
  ctx.fillStyle = "#fff1ad";
  ctx.fill();
}

/** Plump faceted sky-cyan droplet for Water with crisp depth crescent and ice specular. */
function drawWater(ctx: CanvasRenderingContext2D, u: number, color: string) {
  contactShadow(ctx, u, 0.68);
  ctx.lineJoin = "round";
  const casingW = Math.max(3.2, u * 0.25);

  const dropPath = () => {
    ctx.beginPath();
    ctx.moveTo(0, -1.06 * u);
    ctx.bezierCurveTo(0.36 * u, -0.5 * u, 0.8 * u, -0.02 * u, 0.78 * u, 0.32 * u);
    ctx.bezierCurveTo(0.76 * u, 0.72 * u, 0.42 * u, 0.88 * u, 0, 0.88 * u);
    ctx.bezierCurveTo(-0.42 * u, 0.88 * u, -0.76 * u, 0.72 * u, -0.78 * u, 0.32 * u);
    ctx.bezierCurveTo(-0.8 * u, -0.02 * u, -0.36 * u, -0.5 * u, 0, -1.06 * u);
    ctx.closePath();
  };

  dropPath();
  ctx.lineWidth = casingW;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();

  // Shaded lower-right depth crescent.
  ctx.save();
  dropPath();
  ctx.clip();
  ctx.beginPath();
  ctx.arc(0.32 * u, 0.48 * u, 0.72 * u, 0, TAU);
  ctx.fillStyle = "#0e7db8";
  ctx.fill();

  // Bright upper-left lit core.
  ctx.beginPath();
  ctx.ellipse(-0.18 * u, 0.14 * u, 0.42 * u, 0.56 * u, -0.25, 0, TAU);
  ctx.fillStyle = lighten(color, 0.44);
  ctx.fill();

  // Crisp ice-white specular pill.
  ctx.beginPath();
  ctx.ellipse(-0.32 * u, 0.06 * u, 0.14 * u, 0.28 * u, -0.35, 0, TAU);
  ctx.fillStyle = "#eefaff";
  ctx.fill();
  ctx.restore();
}

/** Bold Oyren-lime veined leaf with folded bevel and deep forest-ink stem & ribs. */
function drawLeaf(ctx: CanvasRenderingContext2D, u: number, color: string, variant: number) {
  contactShadow(ctx, u, 0.74);
  ctx.rotate(((Math.abs(variant) % 5) - 2) * 0.08);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const casingW = Math.max(3.2, u * 0.24);

  // Dark-outlined stem stub at lower left.
  ctx.beginPath();
  ctx.moveTo(-0.84 * u, 0.78 * u);
  ctx.lineTo(-0.42 * u, 0.42 * u);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(4.4, u * 0.32);
  ctx.stroke();
  ctx.strokeStyle = "#5c8c00";
  ctx.lineWidth = Math.max(2.2, u * 0.14);
  ctx.stroke();

  const leafBlade = () => {
    ctx.beginPath();
    ctx.moveTo(-0.54 * u, 0.54 * u);
    ctx.bezierCurveTo(-0.88 * u, -0.06 * u, -0.28 * u, -0.84 * u, 0.84 * u, -0.82 * u);
    ctx.bezierCurveTo(0.8 * u, 0.26 * u, 0.06 * u, 0.9 * u, -0.54 * u, 0.54 * u);
    ctx.closePath();
  };

  leafBlade();
  ctx.lineWidth = casingW;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();

  // Upper-left bright folded half.
  ctx.save();
  leafBlade();
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(-0.6 * u, 0.6 * u);
  ctx.lineTo(0.9 * u, -0.9 * u);
  ctx.lineTo(-1.0 * u, -1.0 * u);
  ctx.closePath();
  ctx.fillStyle = lighten(color, 0.36);
  ctx.fill();
  ctx.restore();

  // Crisp forest-ink midrib and angled side veins.
  ctx.strokeStyle = "#1f4704";
  ctx.lineWidth = Math.max(2, u * 0.11);
  ctx.beginPath();
  ctx.moveTo(-0.52 * u, 0.52 * u);
  ctx.quadraticCurveTo(0.06 * u, -0.06 * u, 0.62 * u, -0.62 * u);
  ctx.moveTo(-0.18 * u, 0.18 * u);
  ctx.lineTo(-0.28 * u, -0.26 * u);
  ctx.moveTo(-0.16 * u, 0.16 * u);
  ctx.lineTo(0.28 * u, 0.26 * u);
  ctx.moveTo(0.16 * u, -0.16 * u);
  ctx.lineTo(0.08 * u, -0.52 * u);
  ctx.moveTo(0.16 * u, -0.16 * u);
  ctx.lineTo(0.5 * u, -0.08 * u);
  ctx.stroke();
  ctx.lineCap = "butt";
}

/**
 * Bold solid-filled Staunton chess piece silhouettes: thick outer dark casing
 * stroked BEFORE fills, lit upper-left bevels, and crisp architectural accents.
 */
function drawChessPiece(ctx: CanvasRenderingContext2D, icon: SwarmIcon, u: number, color: string) {
  contactShadow(ctx, u, 0.78);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const casingW = Math.max(3.2, u * 0.25);

  const strokeAndFill = (trace: () => void) => {
    trace();
    ctx.lineWidth = casingW;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();
  };

  if (icon === "king") {
    const silhouette = () => {
      ctx.beginPath();
      // Cross finial at top
      ctx.moveTo(-0.11 * u, -1.06 * u);
      ctx.lineTo(0.11 * u, -1.06 * u);
      ctx.lineTo(0.11 * u, -0.88 * u);
      ctx.lineTo(0.32 * u, -0.88 * u);
      ctx.lineTo(0.32 * u, -0.68 * u);
      ctx.lineTo(0.11 * u, -0.68 * u);
      ctx.lineTo(0.11 * u, -0.52 * u);
      // Crown dome + flared body + plinth base
      ctx.bezierCurveTo(0.56 * u, -0.52 * u, 0.68 * u, -0.24 * u, 0.5 * u, 0.1 * u);
      ctx.lineTo(0.42 * u, 0.24 * u);
      ctx.lineTo(0.56 * u, 0.56 * u);
      ctx.lineTo(0.72 * u, 0.64 * u);
      ctx.lineTo(0.72 * u, 0.86 * u);
      ctx.lineTo(-0.72 * u, 0.86 * u);
      ctx.lineTo(-0.72 * u, 0.64 * u);
      ctx.lineTo(-0.56 * u, 0.56 * u);
      ctx.lineTo(-0.42 * u, 0.24 * u);
      ctx.lineTo(-0.5 * u, 0.1 * u);
      ctx.bezierCurveTo(-0.68 * u, -0.24 * u, -0.56 * u, -0.52 * u, -0.11 * u, -0.52 * u);
      ctx.lineTo(-0.11 * u, -0.68 * u);
      ctx.lineTo(-0.32 * u, -0.68 * u);
      ctx.lineTo(-0.32 * u, -0.88 * u);
      ctx.lineTo(-0.11 * u, -0.88 * u);
      ctx.closePath();
    };
    strokeAndFill(silhouette);
    ctx.save();
    silhouette();
    ctx.clip();
    ctx.fillStyle = lighten(color, 0.42);
    ctx.fillRect(-0.8 * u, -1.1 * u, 0.8 * u, 2.0 * u);
    ctx.fillStyle = "#1c3305";
    ctx.fillRect(-0.56 * u, 0.12 * u, 1.12 * u, 0.13 * u);
    ctx.fillRect(-0.66 * u, 0.55 * u, 1.32 * u, 0.1 * u);
    ctx.restore();
    return;
  }

  if (icon === "queen") {
    const silhouette = () => {
      ctx.beginPath();
      ctx.moveTo(-0.72 * u, 0.86 * u);
      ctx.lineTo(-0.72 * u, 0.64 * u);
      ctx.lineTo(-0.54 * u, 0.54 * u);
      ctx.lineTo(-0.42 * u, 0.16 * u);
      // 5-point royal coronet
      ctx.lineTo(-0.76 * u, -0.56 * u);
      ctx.lineTo(-0.36 * u, -0.14 * u);
      ctx.lineTo(-0.34 * u, -0.78 * u);
      ctx.lineTo(-0.08 * u, -0.22 * u);
      ctx.lineTo(0, -0.92 * u);
      ctx.lineTo(0.08 * u, -0.22 * u);
      ctx.lineTo(0.34 * u, -0.78 * u);
      ctx.lineTo(0.36 * u, -0.14 * u);
      ctx.lineTo(0.76 * u, -0.56 * u);
      ctx.lineTo(0.42 * u, 0.16 * u);
      ctx.lineTo(0.54 * u, 0.54 * u);
      ctx.lineTo(0.72 * u, 0.64 * u);
      ctx.lineTo(0.72 * u, 0.86 * u);
      ctx.closePath();
    };
    strokeAndFill(silhouette);
    ctx.save();
    silhouette();
    ctx.clip();
    ctx.fillStyle = lighten(color, 0.36);
    ctx.fillRect(-0.85 * u, -1.0 * u, 0.85 * u, 1.9 * u);
    ctx.fillStyle = "#521b0f";
    ctx.fillRect(-0.52 * u, 0.14 * u, 1.04 * u, 0.13 * u);
    ctx.fillRect(-0.66 * u, 0.55 * u, 1.32 * u, 0.1 * u);
    ctx.restore();
    // Bright coronet tip pearls.
    for (const [px, py, pr] of [
      [0, -0.92, 0.13],
      [-0.36, -0.78, 0.11],
      [0.36, -0.78, 0.11],
      [-0.75, -0.56, 0.1],
      [0.75, -0.56, 0.1],
    ] as const) {
      ctx.beginPath();
      ctx.arc(px * u, py * u, pr * u, 0, TAU);
      ctx.fillStyle = OUTLINE;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px * u, py * u, pr * 0.72 * u, 0, TAU);
      ctx.fillStyle = lighten(color, 0.58);
      ctx.fill();
    }
    return;
  }

  if (icon === "rook") {
    const silhouette = () => {
      ctx.beginPath();
      ctx.moveTo(-0.72 * u, 0.86 * u);
      ctx.lineTo(-0.72 * u, 0.6 * u);
      ctx.lineTo(-0.54 * u, 0.48 * u);
      ctx.lineTo(-0.46 * u, -0.22 * u);
      ctx.lineTo(-0.66 * u, -0.34 * u);
      // Three battlement merlons
      ctx.lineTo(-0.66 * u, -0.88 * u);
      ctx.lineTo(-0.34 * u, -0.88 * u);
      ctx.lineTo(-0.34 * u, -0.6 * u);
      ctx.lineTo(-0.16 * u, -0.6 * u);
      ctx.lineTo(-0.16 * u, -0.88 * u);
      ctx.lineTo(0.16 * u, -0.88 * u);
      ctx.lineTo(0.16 * u, -0.6 * u);
      ctx.lineTo(0.34 * u, -0.6 * u);
      ctx.lineTo(0.34 * u, -0.88 * u);
      ctx.lineTo(0.66 * u, -0.88 * u);
      ctx.lineTo(0.66 * u, -0.34 * u);
      ctx.lineTo(0.46 * u, -0.22 * u);
      ctx.lineTo(0.54 * u, 0.48 * u);
      ctx.lineTo(0.72 * u, 0.6 * u);
      ctx.lineTo(0.72 * u, 0.86 * u);
      ctx.closePath();
    };
    strokeAndFill(silhouette);
    ctx.save();
    silhouette();
    ctx.clip();
    ctx.fillStyle = lighten(color, 0.36);
    ctx.fillRect(-0.8 * u, -0.95 * u, 0.8 * u, 1.9 * u);
    ctx.fillStyle = "#103b5c";
    ctx.fillRect(-0.66 * u, -0.32 * u, 1.32 * u, 0.12 * u);
    ctx.fillRect(-0.66 * u, 0.52 * u, 1.32 * u, 0.1 * u);
    ctx.restore();
    return;
  }

  if (icon === "bishop") {
    const silhouette = () => {
      ctx.beginPath();
      ctx.moveTo(0, -0.82 * u);
      ctx.bezierCurveTo(0.46 * u, -0.58 * u, 0.6 * u, -0.14 * u, 0.42 * u, 0.2 * u);
      ctx.lineTo(0.54 * u, 0.54 * u);
      ctx.lineTo(0.7 * u, 0.64 * u);
      ctx.lineTo(0.7 * u, 0.86 * u);
      ctx.lineTo(-0.7 * u, 0.86 * u);
      ctx.lineTo(-0.7 * u, 0.64 * u);
      ctx.lineTo(-0.54 * u, 0.54 * u);
      ctx.lineTo(-0.42 * u, 0.2 * u);
      ctx.bezierCurveTo(-0.6 * u, -0.14 * u, -0.46 * u, -0.58 * u, 0, -0.82 * u);
      ctx.closePath();
    };
    strokeAndFill(silhouette);
    ctx.save();
    silhouette();
    ctx.clip();
    ctx.fillStyle = lighten(color, 0.38);
    ctx.fillRect(-0.8 * u, -0.9 * u, 0.8 * u, 1.85 * u);
    ctx.fillStyle = "#26114d";
    ctx.fillRect(-0.56 * u, 0.16 * u, 1.12 * u, 0.12 * u);
    ctx.fillRect(-0.66 * u, 0.55 * u, 1.32 * u, 0.1 * u);
    ctx.restore();

    // Iconic diagonal mitre cleft.
    ctx.strokeStyle = "#1d0c3d";
    ctx.lineWidth = Math.max(2.8, u * 0.17);
    ctx.beginPath();
    ctx.moveTo(0.06 * u, -0.44 * u);
    ctx.lineTo(0.4 * u, -0.14 * u);
    ctx.stroke();

    // Top finial orb.
    ctx.beginPath();
    ctx.arc(0, -0.92 * u, 0.17 * u, 0, TAU);
    ctx.fillStyle = OUTLINE;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -0.92 * u, 0.11 * u, 0, TAU);
    ctx.fillStyle = lighten(color, 0.55);
    ctx.fill();
    return;
  }

  // Sculpted Staunton Knight horse-head profile facing +x.
  const silhouette = () => {
    ctx.beginPath();
    ctx.moveTo(-0.72 * u, 0.86 * u);
    ctx.lineTo(-0.72 * u, 0.62 * u);
    ctx.lineTo(-0.54 * u, 0.5 * u);
    // Arched mane & neck on left
    ctx.bezierCurveTo(-0.68 * u, 0.04 * u, -0.62 * u, -0.52 * u, -0.22 * u, -0.78 * u);
    // Pointed ear
    ctx.lineTo(-0.18 * u, -1.02 * u);
    ctx.lineTo(0.06 * u, -0.78 * u);
    // Brow down to bold muzzle
    ctx.bezierCurveTo(0.36 * u, -0.7 * u, 0.66 * u, -0.44 * u, 0.78 * u, -0.16 * u);
    ctx.lineTo(0.64 * u, 0.08 * u);
    ctx.lineTo(0.34 * u, 0.02 * u);
    // Undercut jaw to chest
    ctx.bezierCurveTo(0.24 * u, 0.18 * u, 0.42 * u, 0.34 * u, 0.56 * u, 0.54 * u);
    ctx.lineTo(0.72 * u, 0.62 * u);
    ctx.lineTo(0.72 * u, 0.86 * u);
    ctx.closePath();
  };
  strokeAndFill(silhouette);
  ctx.save();
  silhouette();
  ctx.clip();
  // Cool slate shadow along mane ridge & lower base for sculptural volume.
  ctx.beginPath();
  ctx.moveTo(-0.75 * u, 0.9 * u);
  ctx.lineTo(-0.75 * u, -0.9 * u);
  ctx.lineTo(-0.22 * u, -0.9 * u);
  ctx.quadraticCurveTo(-0.36 * u, 0.02 * u, -0.14 * u, 0.62 * u);
  ctx.lineTo(0.78 * u, 0.62 * u);
  ctx.lineTo(0.78 * u, 0.9 * u);
  ctx.closePath();
  ctx.fillStyle = "#bdd5e8";
  ctx.fill();
  ctx.fillStyle = "#2b4d68";
  ctx.fillRect(-0.68 * u, 0.56 * u, 1.36 * u, 0.1 * u);
  ctx.restore();

  // Crisp ink eye & bridle slash.
  ctx.fillStyle = "#0e2233";
  ctx.beginPath();
  ctx.arc(0.2 * u, -0.42 * u, 0.095 * u, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#356589";
  ctx.lineWidth = Math.max(1.8, u * 0.09);
  ctx.beginPath();
  ctx.moveTo(0.56 * u, -0.14 * u);
  ctx.lineTo(0.66 * u, -0.08 * u);
  ctx.stroke();
  ctx.lineCap = "butt";
}

function drawWeapon(
  ctx: CanvasRenderingContext2D,
  icon: "sword" | "axe" | "spear",
  u: number,
  color: string,
) {
  contactShadow(ctx, u, 0.78);
  const strokeW = Math.max(2.6, u * 0.22);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const strokeAndFill = (trace: () => void, fill = color) => {
    trace();
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  if (icon === "sword") {
    ctx.save();
    ctx.rotate(-0.68);
    // Double-edged broadsword blade
    const blade = () => {
      ctx.beginPath();
      ctx.moveTo(0, -1.04 * u);
      ctx.lineTo(0.24 * u, -0.66 * u);
      ctx.lineTo(0.2 * u, 0.34 * u);
      ctx.lineTo(-0.2 * u, 0.34 * u);
      ctx.lineTo(-0.24 * u, -0.66 * u);
      ctx.closePath();
    };
    strokeAndFill(blade, color);
    // Split metallic highlight half
    ctx.save();
    blade();
    ctx.clip();
    ctx.fillStyle = lighten(color, 0.44);
    ctx.fillRect(-0.3 * u, -1.1 * u, 0.3 * u, 1.5 * u);
    ctx.strokeStyle = "#395206";
    ctx.lineWidth = Math.max(1.6, u * 0.08);
    ctx.beginPath();
    ctx.moveTo(0, -0.78 * u);
    ctx.lineTo(0, 0.28 * u);
    ctx.stroke();
    ctx.restore();

    // Steel crossguard
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.roundRect(-0.54 * u, 0.28 * u, 1.08 * u, 0.2 * u, 0.08 * u);
    }, "#d7e6f0");

    // Wrapped dark hilt & pommel
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.roundRect(-0.12 * u, 0.46 * u, 0.24 * u, 0.38 * u, 0.06 * u);
    }, "#2e4152");
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.arc(0, 0.88 * u, 0.17 * u, 0, TAU);
    }, lighten(color, 0.3));
    ctx.restore();
    return;
  }

  if (icon === "axe") {
    // Central oak/slate shaft
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.roundRect(-0.12 * u, -0.84 * u, 0.24 * u, 1.72 * u, 0.09 * u);
    }, "#8c6142");

    // Bold symmetric twin-headed battle axe blades
    const blades = () => {
      ctx.beginPath();
      // Right crescent head
      ctx.moveTo(0.08 * u, -0.44 * u);
      ctx.quadraticCurveTo(0.46 * u, -0.64 * u, 0.86 * u, -0.84 * u);
      ctx.quadraticCurveTo(1.02 * u, -0.24 * u, 0.84 * u, 0.24 * u);
      ctx.quadraticCurveTo(0.46 * u, 0.04 * u, 0.08 * u, -0.04 * u);
      // Left crescent head
      ctx.lineTo(-0.08 * u, -0.04 * u);
      ctx.quadraticCurveTo(-0.46 * u, 0.04 * u, -0.84 * u, 0.24 * u);
      ctx.quadraticCurveTo(-1.02 * u, -0.24 * u, -0.86 * u, -0.84 * u);
      ctx.quadraticCurveTo(-0.46 * u, -0.64 * u, -0.08 * u, -0.44 * u);
      ctx.closePath();
    };
    strokeAndFill(blades, color);

    // Gleaming curved cutting edge bevels
    ctx.save();
    blades();
    ctx.clip();
    ctx.strokeStyle = lighten(color, 0.52);
    ctx.lineWidth = Math.max(2.6, u * 0.18);
    ctx.beginPath();
    ctx.moveTo(0.84 * u, -0.82 * u);
    ctx.quadraticCurveTo(0.98 * u, -0.24 * u, 0.82 * u, 0.22 * u);
    ctx.moveTo(-0.84 * u, -0.82 * u);
    ctx.quadraticCurveTo(-0.98 * u, -0.24 * u, -0.82 * u, 0.22 * u);
    ctx.stroke();
    ctx.restore();

    // Central iron collar boss
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.roundRect(-0.18 * u, -0.48 * u, 0.36 * u, 0.48 * u, 0.08 * u);
    }, "#2b3b4c");
    ctx.fillStyle = lighten(color, 0.4);
    ctx.beginPath();
    ctx.arc(0, -0.24 * u, 0.08 * u, 0, TAU);
    ctx.fill();
    return;
  }

  // Winged cyan spear / halberd angled crisply
  ctx.save();
  ctx.rotate(0.62);
  // Long slender shaft
  strokeAndFill(() => {
    ctx.beginPath();
    ctx.roundRect(-0.09 * u, -0.18 * u, 0.18 * u, 1.12 * u, 0.07 * u);
  }, "#6f8da6");
  // Winged cross-lug collar
  strokeAndFill(() => {
    ctx.beginPath();
    ctx.moveTo(-0.42 * u, -0.08 * u);
    ctx.lineTo(0, -0.26 * u);
    ctx.lineTo(0.42 * u, -0.08 * u);
    ctx.lineTo(0.32 * u, 0.08 * u);
    ctx.lineTo(0, -0.02 * u);
    ctx.lineTo(-0.32 * u, 0.08 * u);
    ctx.closePath();
  }, "#d9f2ff");
  // Sharp diamond spearhead
  const head = () => {
    ctx.beginPath();
    ctx.moveTo(0, -1.08 * u);
    ctx.lineTo(0.36 * u, -0.44 * u);
    ctx.lineTo(0.16 * u, -0.1 * u);
    ctx.lineTo(-0.16 * u, -0.1 * u);
    ctx.lineTo(-0.36 * u, -0.44 * u);
    ctx.closePath();
  };
  strokeAndFill(head, color);
  ctx.save();
  head();
  ctx.clip();
  ctx.fillStyle = lighten(color, 0.48);
  ctx.fillRect(-0.42 * u, -1.12 * u, 0.42 * u, 1.1 * u);
  ctx.restore();
  ctx.restore();
}

function drawCosmosSprite(
  ctx: CanvasRenderingContext2D,
  icon: "sun" | "moon" | "planet" | "rocket" | "ufo",
  u: number,
  color: string,
) {
  contactShadow(ctx, u, 0.78);
  const strokeW = Math.max(2.5, u * 0.21);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const strokeAndFill = (trace: () => void, fill = color) => {
    trace();
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  if (icon === "sun") {
    // 8 crisp triangular rays around the core
    const rays = () => {
      ctx.beginPath();
      const spikes = 8;
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * TAU - Math.PI / 2;
        const r = (i % 2 === 0 ? 0.98 : 0.6) * u;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };
    strokeAndFill(rays, "#f59e0b");
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.arc(0, 0, 0.56 * u, 0, TAU);
    }, color);
    ctx.fillStyle = "#fef3c7";
    ctx.beginPath();
    ctx.arc(-0.14 * u, -0.14 * u, 0.22 * u, 0, TAU);
    ctx.fill();
    return;
  }

  if (icon === "moon") {
    const crescent = () => {
      ctx.beginPath();
      ctx.arc(0, 0, 0.86 * u, 0.55, TAU - 0.55, false);
      ctx.arc(0.36 * u, -0.06 * u, 0.68 * u, -0.82, 0.96, true);
      ctx.closePath();
    };
    strokeAndFill(crescent, color);
    ctx.save();
    crescent();
    ctx.clip();
    ctx.fillStyle = "#b8d2e6";
    ctx.beginPath();
    ctx.arc(-0.42 * u, 0.28 * u, 0.16 * u, 0, TAU);
    ctx.arc(-0.24 * u, -0.34 * u, 0.12 * u, 0, TAU);
    ctx.arc(-0.56 * u, -0.04 * u, 0.09 * u, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (icon === "planet") {
    ctx.save();
    ctx.rotate(-0.36);
    // Back half of ring
    ctx.beginPath();
    ctx.ellipse(0, 0, 1.04 * u, 0.3 * u, 0, Math.PI, TAU);
    ctx.lineWidth = Math.max(4.4, u * 0.34);
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.lineWidth = Math.max(2.4, u * 0.18);
    ctx.strokeStyle = "#e9d5ff";
    ctx.stroke();

    // Sphere
    const globe = () => {
      ctx.beginPath();
      ctx.arc(0, 0, 0.6 * u, 0, TAU);
    };
    strokeAndFill(globe, color);
    ctx.save();
    globe();
    ctx.clip();
    ctx.fillStyle = lighten(color, 0.38);
    ctx.fillRect(-0.7 * u, -0.44 * u, 1.4 * u, 0.16 * u);
    ctx.fillStyle = "#5b21b6";
    ctx.fillRect(-0.7 * u, 0.12 * u, 1.4 * u, 0.18 * u);
    ctx.restore();

    // Front half of ring sweeping over the sphere
    ctx.beginPath();
    ctx.ellipse(0, 0, 1.04 * u, 0.3 * u, 0, 0, Math.PI);
    ctx.lineWidth = Math.max(4.4, u * 0.34);
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.lineWidth = Math.max(2.4, u * 0.18);
    ctx.strokeStyle = "#f3e8ff";
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (icon === "rocket") {
    ctx.save();
    ctx.rotate(0.55);
    // Thruster tail flame
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.moveTo(-0.2 * u, 0.48 * u);
      ctx.lineTo(0, 0.98 * u);
      ctx.lineTo(0.2 * u, 0.48 * u);
      ctx.closePath();
    }, "#fde047");
    // Swept side fins
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.moveTo(-0.28 * u, 0.08 * u);
      ctx.lineTo(-0.66 * u, 0.56 * u);
      ctx.lineTo(-0.22 * u, 0.48 * u);
      ctx.closePath();
    }, "#dc2626");
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.moveTo(0.28 * u, 0.08 * u);
      ctx.lineTo(0.66 * u, 0.56 * u);
      ctx.lineTo(0.22 * u, 0.48 * u);
      ctx.closePath();
    }, "#dc2626");
    // Fuselage body
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(0, -0.96 * u);
      ctx.bezierCurveTo(0.38 * u, -0.54 * u, 0.42 * u, 0.08 * u, 0.3 * u, 0.52 * u);
      ctx.lineTo(-0.3 * u, 0.52 * u);
      ctx.bezierCurveTo(-0.42 * u, 0.08 * u, -0.38 * u, -0.54 * u, 0, -0.96 * u);
      ctx.closePath();
    };
    strokeAndFill(body, color);
    ctx.save();
    body();
    ctx.clip();
    ctx.fillStyle = lighten(color, 0.36);
    ctx.fillRect(-0.45 * u, -1.0 * u, 0.45 * u, 1.6 * u);
    ctx.restore();
    // Porthole window
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.arc(0, -0.14 * u, 0.2 * u, 0, TAU);
    }, "#38bdf8");
    ctx.fillStyle = "#e0f2fe";
    ctx.beginPath();
    ctx.arc(-0.06 * u, -0.2 * u, 0.07 * u, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }

  // UFO flying saucer (Oyren lime)
  // Upper glass cockpit dome
  strokeAndFill(() => {
    ctx.beginPath();
    ctx.arc(0, -0.12 * u, 0.46 * u, Math.PI, TAU);
    ctx.closePath();
  }, "#e0f7ff");
  // Wide saucer hull
  const hull = () => {
    ctx.beginPath();
    ctx.ellipse(0, 0.1 * u, 0.96 * u, 0.34 * u, 0, 0, TAU);
  };
  strokeAndFill(hull, color);
  ctx.save();
  hull();
  ctx.clip();
  ctx.fillStyle = "#4d7c0f";
  ctx.fillRect(-1.0 * u, 0.14 * u, 2.0 * u, 0.35 * u);
  ctx.restore();
  // Three bright rim lights
  for (const lx of [-0.52, 0, 0.52] as const) {
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(lx * u, 0.08 * u, 0.12 * u, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#fef9c3";
    ctx.beginPath();
    ctx.arc(lx * u, 0.08 * u, 0.075 * u, 0, TAU);
    ctx.fill();
  }
}

function drawVaultSprite(
  ctx: CanvasRenderingContext2D,
  icon: "key" | "lock" | "chest",
  u: number,
  color: string,
) {
  contactShadow(ctx, u, 0.8);
  const strokeW = Math.max(2.6, u * 0.22);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const strokeAndFill = (trace: () => void, fill = color) => {
    trace();
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  if (icon === "key") {
    ctx.save();
    ctx.rotate(-0.62);
    // Shaft + twin bitting teeth
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.roundRect(-0.13 * u, -0.1 * u, 0.26 * u, 1.04 * u, 0.09 * u);
    }, color);
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.roundRect(0.06 * u, 0.44 * u, 0.42 * u, 0.17 * u, 0.05 * u);
    }, color);
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.roundRect(0.06 * u, 0.72 * u, 0.34 * u, 0.16 * u, 0.05 * u);
    }, color);
    // Ornate circular bow
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.arc(0, -0.46 * u, 0.48 * u, 0, TAU);
    }, color);
    ctx.fillStyle = lighten(color, 0.45);
    ctx.beginPath();
    ctx.arc(-0.12 * u, -0.58 * u, 0.18 * u, 0, TAU);
    ctx.fill();
    // Key bow inner hole
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(0, -0.46 * u, 0.2 * u, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (icon === "lock") {
    // Curved steel padlock shackle
    ctx.beginPath();
    ctx.arc(0, -0.26 * u, 0.44 * u, Math.PI, TAU);
    ctx.lineTo(0.44 * u, 0.06 * u);
    ctx.moveTo(-0.44 * u, -0.26 * u);
    ctx.lineTo(-0.44 * u, 0.06 * u);
    ctx.lineWidth = Math.max(5.5, u * 0.44);
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.lineWidth = Math.max(3.0, u * 0.23);
    ctx.strokeStyle = "#d9f2ff";
    ctx.stroke();

    // Solid rounded padlock body
    const body = () => {
      ctx.beginPath();
      ctx.roundRect(-0.74 * u, -0.1 * u, 1.48 * u, 0.96 * u, 0.22 * u);
    };
    strokeAndFill(body, color);
    ctx.save();
    body();
    ctx.clip();
    ctx.fillStyle = lighten(color, 0.36);
    ctx.fillRect(-0.8 * u, -0.14 * u, 0.76 * u, 1.05 * u);
    ctx.restore();

    // Crisp dark keyhole
    ctx.fillStyle = "#082032";
    ctx.beginPath();
    ctx.arc(0, 0.28 * u, 0.15 * u, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-0.08 * u, 0.34 * u);
    ctx.lineTo(0.08 * u, 0.34 * u);
    ctx.lineTo(0.12 * u, 0.64 * u);
    ctx.lineTo(-0.12 * u, 0.64 * u);
    ctx.closePath();
    ctx.fill();
    return;
  }

  // Amber-gold banded treasure chest
  const lid = () => {
    ctx.beginPath();
    ctx.moveTo(-0.82 * u, -0.02 * u);
    ctx.quadraticCurveTo(-0.82 * u, -0.74 * u, 0, -0.74 * u);
    ctx.quadraticCurveTo(0.82 * u, -0.74 * u, 0.82 * u, -0.02 * u);
    ctx.closePath();
  };
  strokeAndFill(lid, lighten(color, 0.12));

  const base = () => {
    ctx.beginPath();
    ctx.roundRect(-0.82 * u, -0.06 * u, 1.64 * u, 0.88 * u, [0.06 * u, 0.06 * u, 0.18 * u, 0.18 * u]);
  };
  strokeAndFill(base, color);

  // Dark bronze iron straps
  ctx.fillStyle = "#5c2f0c";
  ctx.fillRect(-0.56 * u, -0.64 * u, 0.2 * u, 1.44 * u);
  ctx.fillRect(0.36 * u, -0.64 * u, 0.2 * u, 1.44 * u);
  ctx.fillRect(-0.82 * u, -0.12 * u, 1.64 * u, 0.14 * u);

  // Center brass latch plate
  strokeAndFill(() => {
    ctx.beginPath();
    ctx.roundRect(-0.2 * u, -0.22 * u, 0.4 * u, 0.44 * u, 0.08 * u);
  }, "#fef08a");
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(0, 0, 0.07 * u, 0, TAU);
  ctx.fill();
}

function drawOceanSprite(
  ctx: CanvasRenderingContext2D,
  icon: "whale" | "octopus" | "turtle" | "shell" | "seahorse",
  u: number,
  color: string,
) {
  contactShadow(ctx, u, 0.82);
  const strokeW = Math.max(2.5, u * 0.21);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const strokeAndFill = (trace: () => void, fill = color) => {
    trace();
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  if (icon === "whale") {
    // Playful rounded whale silhouette with uplifted tail fluke & tiny water spout
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(-0.84 * u, 0.16 * u);
      ctx.bezierCurveTo(-0.84 * u, -0.56 * u, -0.1 * u, -0.62 * u, 0.34 * u, -0.16 * u);
      ctx.quadraticCurveTo(0.56 * u, 0.06 * u, 0.72 * u, -0.24 * u);
      ctx.lineTo(0.96 * u, -0.44 * u);
      ctx.quadraticCurveTo(0.84 * u, -0.06 * u, 0.94 * u, 0.14 * u);
      ctx.quadraticCurveTo(0.66 * u, 0.16 * u, 0.52 * u, 0.36 * u);
      ctx.bezierCurveTo(0.16 * u, 0.64 * u, -0.84 * u, 0.62 * u, -0.84 * u, 0.16 * u);
      ctx.closePath();
    };
    strokeAndFill(body, color);
    ctx.save();
    body();
    ctx.clip();
    ctx.fillStyle = "#e0f7ff";
    ctx.fillRect(-0.9 * u, 0.26 * u, 1.3 * u, 0.45 * u);
    ctx.restore();
    // Water spout arcs
    ctx.strokeStyle = "#e0f7ff";
    ctx.lineWidth = Math.max(2, u * 0.12);
    ctx.beginPath();
    ctx.moveTo(-0.34 * u, -0.46 * u);
    ctx.quadraticCurveTo(-0.46 * u, -0.82 * u, -0.62 * u, -0.76 * u);
    ctx.moveTo(-0.34 * u, -0.46 * u);
    ctx.quadraticCurveTo(-0.22 * u, -0.82 * u, -0.06 * u, -0.76 * u);
    ctx.stroke();
    // Friendly ink eye
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(-0.46 * u, 0.08 * u, 0.1 * u, 0, TAU);
    ctx.fill();
    return;
  }

  if (icon === "octopus") {
    // Four symmetrical curled tentacles below
    for (const tx of [-0.66, -0.24, 0.24, 0.66] as const) {
      ctx.beginPath();
      ctx.moveTo(tx * 0.45 * u, 0.12 * u);
      ctx.quadraticCurveTo(tx * 1.1 * u, 0.46 * u, tx * 0.9 * u, 0.78 * u);
      ctx.lineWidth = Math.max(5.2, u * 0.4);
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      ctx.lineWidth = Math.max(2.8, u * 0.22);
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    // Round dome mantle
    const head = () => {
      ctx.beginPath();
      ctx.arc(0, -0.18 * u, 0.62 * u, 0, TAU);
    };
    strokeAndFill(head, color);
    ctx.fillStyle = lighten(color, 0.4);
    ctx.beginPath();
    ctx.arc(-0.18 * u, -0.4 * u, 0.18 * u, 0, TAU);
    ctx.fill();
    // Bright eyes
    for (const ex of [-0.22, 0.22] as const) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ex * u, -0.06 * u, 0.14 * u, 0, TAU);
      ctx.fill();
      ctx.fillStyle = OUTLINE;
      ctx.beginPath();
      ctx.arc(ex * u, -0.05 * u, 0.075 * u, 0, TAU);
      ctx.fill();
    }
    return;
  }

  if (icon === "turtle") {
    // Top-down Oyren-lime sea turtle with four swept flippers & patterned oval shell
    const flipper = (fx: number, fy: number, rx: number, ry: number, rot: number) => {
      strokeAndFill(() => {
        ctx.beginPath();
        ctx.ellipse(fx * u, fy * u, rx * u, ry * u, rot, 0, TAU);
      }, "#84cc16");
    };
    flipper(-0.66, -0.22, 0.42, 0.18, -0.45);
    flipper(0.66, -0.22, 0.42, 0.18, 0.45);
    flipper(-0.48, 0.56, 0.3, 0.14, 0.6);
    flipper(0.48, 0.56, 0.3, 0.14, -0.6);
    // Head
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.arc(0, -0.72 * u, 0.24 * u, 0, TAU);
    }, "#a3e635");
    // Sculpted domed shell
    const shell = () => {
      ctx.beginPath();
      ctx.ellipse(0, 0.08 * u, 0.54 * u, 0.66 * u, 0, 0, TAU);
    };
    strokeAndFill(shell, color);
    // Hexagonal center scute marking
    ctx.strokeStyle = "#365314";
    ctx.lineWidth = Math.max(1.8, u * 0.1);
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU - Math.PI / 2;
      const px = Math.cos(a) * 0.28 * u;
      const py = 0.08 * u + Math.sin(a) * 0.34 * u;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    return;
  }

  if (icon === "shell") {
    // Coral fluted scallop seashell with hinge base
    const fan = () => {
      ctx.beginPath();
      ctx.moveTo(-0.34 * u, 0.72 * u);
      ctx.lineTo(-0.88 * u, -0.06 * u);
      ctx.arc(0, -0.06 * u, 0.88 * u, Math.PI, TAU);
      ctx.lineTo(0.34 * u, 0.72 * u);
      ctx.closePath();
    };
    strokeAndFill(fan, color);
    // Fluted radial ribs
    ctx.strokeStyle = lighten(color, 0.45);
    ctx.lineWidth = Math.max(2, u * 0.11);
    for (const a of [-0.72, -0.36, 0, 0.36, 0.72] as const) {
      ctx.beginPath();
      ctx.moveTo(0, 0.58 * u);
      ctx.lineTo(Math.sin(a) * 0.76 * u, -0.06 * u - Math.cos(a) * 0.72 * u);
      ctx.stroke();
    }
    // Hinge collar
    strokeAndFill(() => {
      ctx.beginPath();
      ctx.roundRect(-0.38 * u, 0.54 * u, 0.76 * u, 0.24 * u, 0.09 * u);
    }, lighten(color, 0.25));
    return;
  }

  // Golden curved seahorse S-profile
  const horse = () => {
    ctx.beginPath();
    ctx.moveTo(0.06 * u, -0.88 * u);
    ctx.bezierCurveTo(0.46 * u, -0.84 * u, 0.56 * u, -0.44 * u, 0.78 * u, -0.44 * u); // snout
    ctx.lineTo(0.76 * u, -0.26 * u);
    ctx.bezierCurveTo(0.42 * u, -0.24 * u, 0.24 * u, -0.06 * u, 0.34 * u, 0.24 * u); // belly
    ctx.bezierCurveTo(0.42 * u, 0.58 * u, 0.16 * u, 0.9 * u, -0.18 * u, 0.88 * u); // curled tail outer
    ctx.bezierCurveTo(-0.46 * u, 0.84 * u, -0.5 * u, 0.52 * u, -0.22 * u, 0.48 * u);
    ctx.bezierCurveTo(-0.08 * u, 0.48 * u, -0.02 * u, 0.64 * u, -0.16 * u, 0.66 * u); // tail spiral
    ctx.bezierCurveTo(-0.02 * u, 0.66 * u, 0.04 * u, 0.44 * u, -0.18 * u, 0.24 * u); // back curve
    ctx.bezierCurveTo(-0.56 * u, -0.04 * u, -0.44 * u, -0.68 * u, 0.06 * u, -0.88 * u);
    ctx.closePath();
  };
  strokeAndFill(horse, color);
  // Dorsal fin accent
  strokeAndFill(() => {
    ctx.beginPath();
    ctx.moveTo(-0.38 * u, -0.18 * u);
    ctx.lineTo(-0.68 * u, -0.02 * u);
    ctx.lineTo(-0.32 * u, 0.16 * u);
    ctx.closePath();
  }, "#fef08a");
  // Ink eye
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(0.24 * u, -0.56 * u, 0.095 * u, 0, TAU);
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
  } else if (icon === "fire") {
    drawFire(ctx, u, color, variant);
  } else if (icon === "water") {
    drawWater(ctx, u, color);
  } else if (icon === "leaf") {
    drawLeaf(ctx, u, color, variant);
  } else if (icon === "king" || icon === "queen" || icon === "rook" || icon === "bishop" || icon === "knight") {
    drawChessPiece(ctx, icon, u, color);
  } else if (icon === "sword" || icon === "axe" || icon === "spear") {
    drawWeapon(ctx, icon, u, color);
  } else if (icon === "sun" || icon === "moon" || icon === "planet" || icon === "rocket" || icon === "ufo") {
    drawCosmosSprite(ctx, icon, u, color);
  } else if (icon === "key" || icon === "lock" || icon === "chest") {
    drawVaultSprite(ctx, icon, u, color);
  } else if (icon === "whale" || icon === "octopus" || icon === "turtle" || icon === "shell" || icon === "seahorse") {
    drawOceanSprite(ctx, icon, u, color);
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
