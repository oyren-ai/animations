import { VIDEO } from "../settings.ts";
import { drawReelText, REEL_SAFE_BOUNDS, type ReelBox } from "../shared/reelUtils.ts";
import { HIT_SEED, type HitSpec } from "./types.ts";

export const W = VIDEO.width;
export const H = VIDEO.height;
export const FPS = VIDEO.fps;
export const SAFE = REEL_SAFE_BOUNDS;
export const SAFE_CENTER_X = (REEL_SAFE_BOUNDS.left + REEL_SAFE_BOUNDS.right) / 2;
export const SAFE_WIDTH = REEL_SAFE_BOUNDS.right - REEL_SAFE_BOUNDS.left;

export const PALETTE = {
  bg0: "#05070b",
  bg1: "#0d1522",
  ink: "#f4f5f7",
  muted: "#a7b6c5",
  lime: "#c8ff00",
  limeSoft: "#c8ff85",
  violet: "#8b5cf6",
  cyan: "#22d3ee",
  pink: "#f472b6",
  amber: "#fbbf24",
  coral: "#fb7185",
  teal: "#2dd4bf",
} as const;

export const CTA_LINES = [
  "Made by AI agents, with nothing installed on a computer.",
  "Create a Codespace at oyren.ai",
] as const;

export const HUD = {
  hookFirstY: 292,
  hookLineGap: 94,
  hookSize: 86,
  ruleSize: 34,
  /** Rules longer than this wrap onto two balanced lines so they stay readable. */
  ruleWrapChars: 40,
  ruleLineGap: 42,
  ctaY1: 1478,
  ctaY2: 1514,
  ctaSize: 27,
  footerY: 1548,
  footerSize: 22,
} as const;

/* ---------- numbers ---------- */

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t: number): number => 1 - (1 - clamp01(t)) ** 3;
export const frameToSec = (frame: number): number => frame / FPS;
export const secToFrame = (sec: number): number => Math.round(sec * FPS);

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/* ---------- seeded random numbers (mulberry32) ---------- */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  range(min: number, max: number): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  sign(): 1 | -1;
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    sign: () => (next() < 0.5 ? -1 : 1),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}

/** Stable 32-bit FNV-1a hash as 8 hex digits. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Hash a list of numbers (typed arrays included) without building a huge string. */
export function digestNumbers(values: ArrayLike<number>, decimals = 2): string {
  let h = 0x811c9dc5;
  const scale = 10 ** decimals;
  for (let i = 0; i < values.length; i++) {
    h ^= Math.round(values[i] * scale) | 0;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/* ---------- Canvas helpers ---------- */

export function fillBackdrop(
  ctx: CanvasRenderingContext2D,
  frame: number,
  colors: { top?: string; bottom?: string } = {},
): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, colors.top ?? PALETTE.bg1);
  g.addColorStop(1, colors.bottom ?? PALETTE.bg0);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const drift = Math.sin(frame / 90) * 0.5 + 0.5;
  const glow = ctx.createRadialGradient(W * (0.3 + 0.4 * drift), H * 0.42, 40, W * 0.5, H * 0.5, 1100);
  glow.addColorStop(0, "rgba(139,92,246,0.16)");
  glow.addColorStop(1, "rgba(139,92,246,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

/** Dark scrim behind the HUD so text stays readable over busy action. Covers the full width. */
export function fillHudScrims(ctx: CanvasRenderingContext2D, topHeight = 560, bottomHeight = 300): void {
  const top = ctx.createLinearGradient(0, 0, 0, topHeight);
  top.addColorStop(0, "rgba(5,7,11,0.82)");
  top.addColorStop(1, "rgba(5,7,11,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, topHeight);
  const bottom = ctx.createLinearGradient(0, H - bottomHeight, 0, H);
  bottom.addColorStop(0, "rgba(5,7,11,0)");
  bottom.addColorStop(1, "rgba(5,7,11,0.8)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, H - bottomHeight, W, bottomHeight);
}

function withShadow<T>(ctx: CanvasRenderingContext2D, draw: () => T): T {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 14;
  const out = draw();
  ctx.restore();
  return out;
}

/**
 * Split text into at most two balanced lines. A split right after a sentence end ("." or "?") is
 * preferred when both halves stay short, because a rule reads better one sentence per line.
 */
export function wrapQuestion(text: string, maxCharsPerLine = 22, sentenceMax = 50): string[] {
  if (text.length <= maxCharsPerLine) return [text];
  const words = text.split(" ");
  let best: string[] = [text];
  let bestScore = Number.POSITIVE_INFINITY;
  let bestSentence: string[] | null = null;
  let bestSentenceScore = Number.POSITIVE_INFINITY;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const score = Math.max(a.length, b.length);
    if (score < bestScore) {
      bestScore = score;
      best = [a, b];
    }
    if (/[.?]$/.test(words[i - 1]) && score <= sentenceMax && score < bestSentenceScore) {
      bestSentenceScore = score;
      bestSentence = [a, b];
    }
  }
  return bestSentence ?? best;
}

export interface ChromeLayout {
  /** Baseline y of the LAST rule line. Counters go below this. */
  ruleY: number;
  /** First free baseline y under the rule line for counters. */
  counterY: number;
}

/**
 * Where the chrome ends, without drawing anything. A painter that needs to place its HUD (or a
 * keep-clear zone) before it draws the chrome can ask for this; `drawChrome` returns the same numbers.
 */
export function chromeLayout(spec: HitSpec): ChromeLayout {
  const hookLines = wrapQuestion(spec.question);
  const ruleLines = wrapQuestion(spec.rule, HUD.ruleWrapChars);
  const firstRuleY = HUD.hookFirstY + (hookLines.length - 1) * HUD.hookLineGap + 58;
  const ruleY = firstRuleY + (ruleLines.length - 1) * HUD.ruleLineGap;
  return { ruleY, counterY: ruleY + 84 };
}

/**
 * Draws the frame-0 hook question, the rule line, the CTA and the seed footer.
 * Everything goes through `drawReelText`, so the safe-bounds assertion runs on every box.
 */
export function drawChrome(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  spec: HitSpec,
  extra: { ruleColor?: string } = {},
): ChromeLayout {
  const lines = wrapQuestion(spec.question);
  let y: number = HUD.hookFirstY;
  withShadow(ctx, () => {
    for (const line of lines) {
      drawReelText(ctx, boxes, line, SAFE_CENTER_X, y, {
        size: HUD.hookSize,
        weight: 800,
        align: "center",
        maxWidth: SAFE_WIDTH,
        color: PALETTE.ink,
      });
      y += HUD.hookLineGap;
    }
  });
  const firstRuleY = y - HUD.hookLineGap + 58;
  const ruleLines = wrapQuestion(spec.rule, HUD.ruleWrapChars);
  let ruleY = firstRuleY;
  withShadow(ctx, () => {
    ruleLines.forEach((line, i) => {
      ruleY = firstRuleY + i * HUD.ruleLineGap;
      drawReelText(ctx, boxes, line, SAFE_CENTER_X, ruleY, {
        size: HUD.ruleSize,
        weight: 600,
        align: "center",
        maxWidth: SAFE_WIDTH,
        color: extra.ruleColor ?? PALETTE.limeSoft,
      });
    });
  });
  withShadow(ctx, () => {
    drawReelText(ctx, boxes, CTA_LINES[0], SAFE_CENTER_X, HUD.ctaY1, {
      size: HUD.ctaSize,
      weight: 600,
      align: "center",
      maxWidth: SAFE_WIDTH,
      color: PALETTE.ink,
    });
    drawReelText(ctx, boxes, CTA_LINES[1], SAFE_CENTER_X, HUD.ctaY2, {
      size: HUD.ctaSize,
      weight: 700,
      align: "center",
      maxWidth: SAFE_WIDTH,
      color: PALETTE.limeSoft,
    });
    drawReelText(ctx, boxes, `seeded physics, not a benchmark · seed ${HIT_SEED}`, SAFE_CENTER_X, HUD.footerY, {
      size: HUD.footerSize,
      weight: 500,
      align: "center",
      maxWidth: SAFE_WIDTH,
      color: PALETTE.muted,
    });
  });
  return { ruleY, counterY: ruleY + 84 };
}

/** A label above a big value, for the climbing counters. Returns the value box. */
export function drawStat(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  stat: {
    label: string;
    value: string;
    x: number;
    y: number;
    align?: "left" | "center" | "right";
    color?: string;
    valueSize?: number;
    maxWidth?: number;
  },
): ReelBox {
  const align = stat.align ?? "center";
  const valueSize = stat.valueSize ?? 64;
  return withShadow(ctx, () => {
    drawReelText(ctx, boxes, stat.label, stat.x, stat.y - valueSize * 0.92, {
      size: 22,
      weight: 700,
      align,
      maxWidth: stat.maxWidth ?? SAFE_WIDTH,
      color: PALETTE.muted,
    });
    return drawReelText(ctx, boxes, stat.value, stat.x, stat.y, {
      size: valueSize,
      weight: 800,
      align,
      maxWidth: stat.maxWidth ?? SAFE_WIDTH,
      color: stat.color ?? PALETTE.lime,
    });
  });
}

/** Big centred result line, for the payoff. */
export function drawResult(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  text: string,
  y: number,
  opts: { size?: number; color?: string; alpha?: number } = {},
): ReelBox {
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 24;
  const box = drawReelText(ctx, boxes, text, SAFE_CENTER_X, y, {
    size: opts.size ?? 92,
    weight: 900,
    align: "center",
    maxWidth: SAFE_WIDTH,
    color: opts.color ?? PALETTE.lime,
  });
  ctx.restore();
  return box;
}
