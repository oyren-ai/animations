import { drawReelText, type ReelBox } from "../../shared/reelUtils.ts";
import {
  H,
  PALETTE,
  SAFE,
  SAFE_CENTER_X,
  SAFE_WIDTH,
  W,
  clamp01,
  createRng,
  drawChrome,
  drawResult,
  drawStat,
  easeOutCubic,
  fillBackdrop,
  fillHudScrims,
  formatCount,
} from "../kit.ts";
import { OVERFLOW_SPEC } from "./spec.ts";
import {
  BUCKETS,
  CRACK_FRAMES,
  OVERFLOW_TARGET,
  POS_SCALE_X,
  POS_SCALE_Y,
  ROTOR,
  frameRange,
  rotorAngle,
  type OverflowTrace,
} from "./sim.ts";

const BUCKET_COLORS = ["#c8ff00", "#22d3ee", "#f472b6", "#fbbf24", "#a78bfa", "#2dd4bf"] as const;

/** Ambient dots on a jittered lattice so the whole frame is alive from frame 0. */
const AMBIENT = (() => {
  const rng = createRng(4242);
  const dots: { x: number; y: number; r: number; a: number; speed: number }[] = [];
  const cols = 10;
  const rows = 16;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      dots.push({
        x: ((i + 0.15 + 0.7 * rng.next()) / cols) * W,
        y: ((j + 0.15 + 0.7 * rng.next()) / rows) * H,
        r: rng.range(2.5, 5.5),
        a: rng.range(0.1, 0.24),
        speed: rng.range(0.15, 0.5),
      });
    }
  }
  return dots;
})();

function paintAmbient(ctx: CanvasRenderingContext2D, frame: number): void {
  ctx.fillStyle = "#9db4ff";
  for (const d of AMBIENT) {
    const y = (d.y + frame * d.speed) % H;
    ctx.globalAlpha = d.a;
    ctx.beginPath();
    ctx.arc(d.x, y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function fillFraction(n: number, r: number): number {
  return (n * Math.PI * r * r) / (W * H);
}

function paintWalls(ctx: CanvasRenderingContext2D, pressure: number, alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, PALETTE.violet);
  g.addColorStop(0.5, PALETTE.cyan);
  g.addColorStop(1, PALETTE.violet);
  ctx.strokeStyle = g;
  ctx.lineWidth = 16;
  ctx.shadowColor = PALETTE.cyan;
  ctx.shadowBlur = 10 + 28 * pressure;
  ctx.strokeRect(8, 8, W - 16, H - 16);
  ctx.restore();
}

function paintCracks(ctx: CanvasRenderingContext2D, progress: number, alpha: number): void {
  if (progress <= 0 || alpha <= 0) return;
  const rng = createRng(777);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.shadowColor = PALETTE.lime;
  ctx.shadowBlur = 16;
  const starts: [number, number, number, number][] = [];
  for (let k = 0; k < 6; k++) {
    starts.push([rng.range(80, W - 80), 8, 0, 1]);
    starts.push([rng.range(80, W - 80), H - 8, 0, -1]);
  }
  for (let k = 0; k < 9; k++) {
    starts.push([8, rng.range(120, H - 120), 1, 0]);
    starts.push([W - 8, rng.range(120, H - 120), -1, 0]);
  }
  for (const [sx, sy, dx, dy] of starts) {
    const len = rng.range(160, 380) * easeOutCubic(progress);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    let x = sx;
    let y = sy;
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const jitter = rng.range(-28, 28);
      x += dx * (len / steps) + (dx === 0 ? jitter : 0);
      y += dy * (len / steps) + (dy === 0 ? jitter : 0);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function paintTurbine(ctx: CanvasRenderingContext2D, frame: number, alpha: number): void {
  const theta = rotorAngle(frame);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(ROTOR.cx, ROTOR.cy);
  ctx.shadowColor = PALETTE.lime;
  ctx.shadowBlur = 22;
  for (let b = 0; b < ROTOR.bars; b++) {
    ctx.save();
    ctx.rotate(theta + (b * Math.PI) / ROTOR.bars);
    const g = ctx.createLinearGradient(-ROTOR.arm, 0, ROTOR.arm, 0);
    g.addColorStop(0, "#7c3aed");
    g.addColorStop(0.5, "#e9ffb0");
    g.addColorStop(1, "#7c3aed");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(-ROTOR.arm, -ROTOR.half, ROTOR.arm * 2, ROTOR.half * 2, ROTOR.half);
    ctx.fill();
    ctx.restore();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#0a0a0a";
  ctx.strokeStyle = PALETTE.lime;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function paintBalls(ctx: CanvasRenderingContext2D, trace: OverflowTrace, frame: number): void {
  const { start, end } = frameRange(trace, frame);
  const r = trace.radius[Math.min(frame, trace.sceneFrames - 1)];
  const count = end - start;
  if (count === 0) return;
  if (count <= 3) {
    // the hero ball and its first children: big, glowing, easy to follow
    for (let i = start; i < end; i++) {
      const x = trace.xs[i] / POS_SCALE_X;
      const y = trace.ys[i] / POS_SCALE_Y;
      ctx.save();
      ctx.shadowColor = BUCKET_COLORS[trace.bucket[i]];
      ctx.shadowBlur = 36;
      ctx.fillStyle = BUCKET_COLORS[trace.bucket[i]];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  for (let b = 0; b < BUCKETS; b++) {
    ctx.fillStyle = BUCKET_COLORS[b];
    ctx.beginPath();
    for (let i = start; i < end; i++) {
      if (trace.bucket[i] !== b) continue;
      const x = trace.xs[i] / POS_SCALE_X;
      const y = trace.ys[i] / POS_SCALE_Y;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  if (r >= 11) {
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath();
    for (let i = start; i < end; i++) {
      const x = trace.xs[i] / POS_SCALE_X - r * 0.3;
      const y = trace.ys[i] / POS_SCALE_Y - r * 0.3;
      ctx.moveTo(x + r * 0.25, y);
      ctx.arc(x, y, r * 0.25, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

function paintSplitFlashes(ctx: CanvasRenderingContext2D, trace: OverflowTrace, frame: number): void {
  // newest first, at most 24 rings, each lives 10 frames
  let drawn = 0;
  let lo = 0;
  let hi = trace.splits.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (trace.splits[mid].frame <= frame) lo = mid;
    else hi = mid - 1;
  }
  ctx.save();
  ctx.lineWidth = 4;
  for (let i = lo; i >= 0 && drawn < 24; i--) {
    const s = trace.splits[i];
    const age = frame - s.frame;
    if (age > 10) break;
    if (age < 0) continue;
    const r = trace.radius[Math.min(frame, trace.sceneFrames - 1)];
    ctx.globalAlpha = (1 - age / 10) * 0.9;
    ctx.strokeStyle = PALETTE.lime;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * (1.1 + (age / 10) * 2.6), 0, Math.PI * 2);
    ctx.stroke();
    drawn++;
  }
  ctx.restore();
}

export function paintOverflowFrame(
  ctx: CanvasRenderingContext2D,
  trace: OverflowTrace,
  frame: number,
): ReelBox[] {
  const f = Math.max(0, Math.min(frame, trace.sceneFrames - 1));
  const boxes: ReelBox[] = [];
  const sinceOver = f - trace.overflowFrame;
  const n = trace.counts[f];
  /** The counter freezes at 10,000 once the walls crack, even while balls leave the screen. */
  const shown = sinceOver >= 0 ? OVERFLOW_TARGET : n;
  const r = trace.radius[f];
  const fillFrac = fillFraction(shown, r);
  const opened = f >= trace.openFrame;

  fillBackdrop(ctx, f, { top: "#0c1226", bottom: "#05070b" });
  paintAmbient(ctx, f);

  const wallAlpha = sinceOver < 0 ? 1 : opened ? clamp01(1 - (f - trace.openFrame) / 24) : 1;
  paintWalls(ctx, clamp01(fillFrac / 0.6), wallAlpha);
  paintTurbine(ctx, f, opened ? 0.55 : 1);
  paintBalls(ctx, trace, f);
  paintSplitFlashes(ctx, trace, f);

  if (sinceOver >= 0) {
    paintCracks(ctx, clamp01(sinceOver / CRACK_FRAMES), opened ? clamp01(1 - (f - trace.openFrame) / 20) : 1);
    if (sinceOver < 8) {
      ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - sinceOver / 8)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (opened) {
      const ringR = (f - trace.openFrame) * 26;
      ctx.save();
      ctx.globalAlpha = clamp01(1 - ringR / 1500);
      ctx.strokeStyle = PALETTE.lime;
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  fillHudScrims(ctx);
  const layout = drawChrome(ctx, boxes, OVERFLOW_SPEC);

  drawStat(ctx, boxes, {
    label: "BALLS · OVERFLOW AT 10,000",
    value: formatCount(shown),
    x: SAFE_CENTER_X,
    y: layout.counterY + 100,
    valueSize: 120,
    color: sinceOver >= 0 ? PALETTE.amber : PALETTE.lime,
  });

  // capacity bar: the question made visible
  const barY = layout.counterY + 122;
  const barH = 14;
  const p = clamp01(shown / OVERFLOW_TARGET);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.roundRect(SAFE.left, barY, SAFE_WIDTH, barH, barH / 2);
  ctx.fill();
  const g = ctx.createLinearGradient(SAFE.left, 0, SAFE.right, 0);
  g.addColorStop(0, PALETTE.cyan);
  g.addColorStop(1, PALETTE.lime);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(SAFE.left, barY, Math.max(barH, SAFE_WIDTH * p), barH, barH / 2);
  ctx.fill();
  if (sinceOver >= 18) {
    const k = easeOutCubic((sinceOver - 18) / 14);
    drawResult(ctx, boxes, "OVERFLOW!", 960, { size: 124, alpha: k });
    ctx.save();
    ctx.globalAlpha = k;
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 20;
    drawReelText(ctx, boxes, "1 ball became 10,000", SAFE_CENTER_X, 1052, {
      size: 44,
      weight: 700,
      align: "center",
      color: PALETTE.ink,
    });
    ctx.restore();
  }

  return boxes;
}
