import { VIDEO } from "../settings.ts";

/**
 * Shared dark-ink architectural framing for Round 4 physics set pieces.
 * Leaves the top OyrenBrandLayer band (y = 0..175) and bottom OyrenBrandLayer
 * band (y = 1700..1920) completely unobstructed, with all text and chambers
 * centred symmetrically on x = 540.
 */
export const SETPIECE_LAYOUT = {
  width: VIDEO.width,
  height: VIDEO.height,
  fps: VIDEO.fps,
  centerX: VIDEO.width / 2,
  questionY: 238,
  rule1Y: 282,
  rule2Y: 316,
  counterY: 394,
  subCounterY: 428,
  progressTop: 446,
  progressWidth: 780,
  progressHeight: 10,
  stageTop: 484,
  stageBottom: 1554,
  footerBarY: 1606,
  seedCaptionY: 1656,
} as const;

export const SP_COLORS = {
  bg0: "#03070b",
  bg1: "#09131d",
  panel: "#081018",
  panelBorder: "rgba(200, 255, 0, 0.24)",
  ink: "#f4f7fa",
  muted: "#9eb2c4",
  dim: "#5d7184",
  lime: "#c8ff00",
  limeGlow: "rgba(200, 255, 0, 0.35)",
  cyan: "#38bdf8",
  violet: "#a78bfa",
  amber: "#fbbf24",
  coral: "#fb7185",
} as const;

const FONT = '"Inter Variable", Inter, sans-serif';
const MONO = 'ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace';

export function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Paint the dark-ink radial backdrop + subtle architectural dot grid. */
export function paintSetPieceBackdrop(ctx: CanvasRenderingContext2D, frame: number, accentRgb = "56, 189, 248"): void {
  const W = SETPIECE_LAYOUT.width;
  const H = SETPIECE_LAYOUT.height;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, SP_COLORS.bg1);
  grad.addColorStop(0.5, "#050b12");
  grad.addColorStop(1, SP_COLORS.bg0);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Gentle breathing ambient glow behind the central contraption
  const breath = 0.5 + 0.5 * Math.sin(frame * 0.035);
  const rad = ctx.createRadialGradient(
    W * 0.5,
    1020,
    40,
    W * 0.5,
    1020,
    680,
  );
  rad.addColorStop(0, `rgba(${accentRgb}, ${(0.11 + 0.04 * breath).toFixed(3)})`);
  rad.addColorStop(0.6, "rgba(200, 255, 0, 0.03)");
  rad.addColorStop(1, "rgba(3, 7, 11, 0)");
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, W, H);

  // Subtle dark-ink workspace dot grid
  ctx.fillStyle = "rgba(158, 178, 196, 0.075)";
  const step = 48;
  for (let y = 180; y <= 1690; y += step) {
    for (let x = 60; x <= W - 60; x += step) {
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }
}

export interface HeaderChromeParams {
  questionPrefix: string;
  questionHighlight: string;
  ruleLine1: string;
  ruleLine2: string;
  counterText: string;
  counterColor?: string;
  subCounterText: string;
  progress: number;
  seed: number;
}

/**
 * Draw the v4-style crisp header:
 * - Two-tone question headline (prefix white + highlight Oyren-lime)
 * - Two short plain-English rule lines
 * - Giant tabular climbing counter + mono subtitle
 * - Sleek gradient progress bar
 * - Subtle seed footer above the clear brand band
 */
export function paintSetPieceChrome(ctx: CanvasRenderingContext2D, p: HeaderChromeParams): void {
  const cx = SETPIECE_LAYOUT.centerX;
  ctx.save();
  ctx.textBaseline = "alphabetic";

  // 1. Two-tone bold headline centred as one unit
  const headFont = `900 44px ${FONT}`;
  ctx.font = headFont;
  const prefix = p.questionPrefix + " ";
  const wPre = ctx.measureText(prefix).width;
  const wHi = ctx.measureText(p.questionHighlight).width;
  const totalW = wPre + wHi;
  const maxHeadW = 940;
  const scaleX = totalW > maxHeadW ? maxHeadW / totalW : 1;

  ctx.save();
  ctx.translate(cx, SETPIECE_LAYOUT.questionY);
  ctx.scale(scaleX, 1);
  ctx.textAlign = "left";
  ctx.fillStyle = SP_COLORS.ink;
  ctx.fillText(prefix, -totalW / 2, 0);
  ctx.fillStyle = SP_COLORS.lime;
  ctx.fillText(p.questionHighlight, -totalW / 2 + wPre, 0);
  ctx.restore();

  // 2. Two crisp plain-English rule lines
  ctx.textAlign = "center";
  ctx.font = `500 25px ${FONT}`;
  ctx.fillStyle = SP_COLORS.muted;
  ctx.fillText(p.ruleLine1, cx, SETPIECE_LAYOUT.rule1Y);
  ctx.fillText(p.ruleLine2, cx, SETPIECE_LAYOUT.rule2Y);

  // 3. Giant tabular counter
  ctx.font = `900 66px ${FONT}`;
  ctx.fillStyle = p.counterColor ?? SP_COLORS.ink;
  ctx.fillText(p.counterText, cx, SETPIECE_LAYOUT.counterY);

  // 4. Crisp mono sub-counter
  ctx.font = `700 22px ${MONO}`;
  ctx.fillStyle = SP_COLORS.muted;
  ctx.fillText(p.subCounterText, cx, SETPIECE_LAYOUT.subCounterY);

  // 5. Progress bar
  const bw = SETPIECE_LAYOUT.progressWidth;
  const bh = SETPIECE_LAYOUT.progressHeight;
  const bx = cx - bw / 2;
  const by = SETPIECE_LAYOUT.progressTop;
  ctx.fillStyle = "rgba(158, 178, 196, 0.16)";
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, bh / 2);
  ctx.fill();

  const fillW = Math.max(0, Math.min(bw, bw * clamp01(p.progress)));
  if (fillW > 2) {
    const barGrad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    barGrad.addColorStop(0, SP_COLORS.violet);
    barGrad.addColorStop(0.55, SP_COLORS.cyan);
    barGrad.addColorStop(1, SP_COLORS.lime);
    ctx.fillStyle = barGrad;
    ctx.beginPath();
    ctx.roundRect(bx, by, fillW, bh, bh / 2);
    ctx.fill();
  }

  // 6. Subtle seed note well above bottom OyrenBrandLayer band
  ctx.font = `500 20px ${MONO}`;
  ctx.fillStyle = SP_COLORS.dim;
  ctx.fillText(`seeded deterministic physics · seed ${p.seed}`, cx, SETPIECE_LAYOUT.seedCaptionY);

  ctx.restore();
}

/** Crisp payoff badge centred inside the chamber once the goal is reached. */
export function paintPayoffBanner(
  ctx: CanvasRenderingContext2D,
  cy: number,
  headline: string,
  subline: string,
  progress01: number,
): void {
  const t = clamp01(progress01);
  if (t <= 0) return;
  const ease = 1 - (1 - t) ** 3;
  const cx = SETPIECE_LAYOUT.centerX;
  const scale = 0.88 + 0.12 * ease;

  ctx.save();
  ctx.globalAlpha = ease;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  const pillW = 720;
  const pillH = 148;
  ctx.fillStyle = "rgba(4, 9, 14, 0.9)";
  ctx.strokeStyle = SP_COLORS.lime;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(-pillW / 2, -pillH / 2, pillW, pillH, 28);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 58px ${FONT}`;
  ctx.fillStyle = SP_COLORS.lime;
  ctx.fillText(headline, 0, -4);

  ctx.font = `700 26px ${MONO}`;
  ctx.fillStyle = SP_COLORS.ink;
  ctx.fillText(subline, 0, 44);
  ctx.restore();
}
