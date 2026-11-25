import { VIDEO } from "../settings.ts";
import { theme } from "../theme.ts";
import {
  baseCurve, borderProgress, chainAt, type Chain, curveWithWeights, type Curve, explainerData, type ExplainerData, K_COUNT,
  kIndex, LAYOUT, phaseAt, smooth, type Stage, stageAt, TL, toScreenX, toScreenY, weightsAt,
} from "./explainer.ts";
import { harmonicColor, LIME, MUTED, NEW_RANGE, STEEL } from "./explainer-text.ts";

const L = LAYOUT;
const TAU = Math.PI * 2;
const C = theme.colors;
const FONT = JSON.stringify(theme.fontFamily);

const weights = new Float64Array(K_COUNT);
let curve: Curve | undefined;

const rgba = (hex: string, alpha: number) => {
  const v = parseInt(hex.slice(1), 16);
  return "rgba(" + ((v >> 16) & 255) + "," + ((v >> 8) & 255) + "," + (v & 255) + "," + alpha + ")";
};

function panelPath(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.roundRect(L.panel.left, L.panel.top, L.panel.right - L.panel.left, L.panel.bottom - L.panel.top, 26);
}

function pathThrough(ctx: CanvasRenderingContext2D, d: ExplainerData, xs: Float64Array, ys: Float64Array, close: boolean) {
  ctx.beginPath();
  for (let m = 0; m < d.count; m++) {
    const x = toScreenX(d, xs[m]);
    const y = toScreenY(d, ys[m]);
    if (m === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if (close) ctx.closePath();
}

/** Point of a closed sample loop at a fractional index. */
function sampleAt(d: ExplainerData, xs: Float64Array, ys: Float64Array, index: number): [number, number] {
  const M = d.count;
  const u = ((index % M) + M) % M;
  const i0 = Math.floor(u);
  const i1 = (i0 + 1) % M;
  const f = u - i0;
  return [xs[i0] + (xs[i1] - xs[i0]) * f, ys[i0] + (ys[i1] - ys[i0]) * f];
}

function paintBackdrop(ctx: CanvasRenderingContext2D, sec: number) {
  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
  const mesh = ctx.createRadialGradient(480 + Math.sin(sec * 0.42) * 75, 930 + Math.cos(sec * 0.33) * 55, 0, 540, 960, 960);
  mesh.addColorStop(0, C.mesh);
  mesh.addColorStop(1, C.transparent);
  ctx.fillStyle = mesh;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
}

function paintGlowDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, radius: number) {
  const halo = ctx.createRadialGradient(x, y, 0, x, y, radius * 4);
  halo.addColorStop(0, rgba(color, 0.55));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, radius * 4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
}

/** Opening pass: the exact border is drawn once while a dot reads off x(t) and y(t). */
function paintBorderPass(ctx: CanvasRenderingContext2D, d: ExplainerData, sec: number) {
  const p = borderProgress(sec);
  const M = d.count;
  const solid = 1 - smooth((sec - 6.2) / 1);
  if (p > 0 && solid > 0.001) {
    const upTo = p * M;
    const whole = Math.floor(upTo);
    ctx.save();
    ctx.globalAlpha = solid;
    ctx.beginPath();
    for (let m = 0; m <= whole && m < M; m++) {
      const x = toScreenX(d, d.zx[m]);
      const y = toScreenY(d, d.zy[m]);
      if (m === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (p >= 1) ctx.closePath();
    else {
      const [tx, ty] = sampleAt(d, d.zx, d.zy, upTo);
      ctx.lineTo(toScreenX(d, tx), toScreenY(d, ty));
    }
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = C.borderRim;
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 3.6;
    ctx.stroke();
    if (p >= 1) {
      ctx.fillStyle = C.mapFill;
      ctx.fill();
    }
    ctx.restore();
  }
  if (p > 0 && p < 1) {
    const [tx, ty] = sampleAt(d, d.zx, d.zy, p * M);
    const x = toScreenX(d, tx);
    const y = toScreenY(d, ty);
    ctx.save();
    ctx.setLineDash([9, 9]);
    ctx.strokeStyle = rgba(LIME, 0.75);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(L.panel.left + 14, y);
    ctx.moveTo(x, y);
    ctx.lineTo(x, L.panel.bottom - 14);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [ax, ay] of [[L.panel.left + 14, y], [x, L.panel.bottom - 14]] as const) {
      ctx.fillStyle = LIME;
      ctx.beginPath();
      ctx.arc(ax, ay, 6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    paintGlowDot(ctx, x, y, LIME, 8);
  }
}

function paintGhost(ctx: CanvasRenderingContext2D, d: ExplainerData, sec: number) {
  const alpha = smooth((sec - 6.2) / 1) * (1 - smooth((sec - TL.final) / 1.5));
  if (alpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  pathThrough(ctx, d, d.zx, d.zy, true);
  ctx.fillStyle = "rgba(116,185,209,0.05)";
  ctx.fill();
  ctx.setLineDash([10, 9]);
  ctx.strokeStyle = rgba("#9fb4c7", 0.5);
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore();
}

function paintCurve(ctx: CanvasRenderingContext2D, d: ExplainerData, cv: Curve, emphasis: number, final: number) {
  pathThrough(ctx, d, cv.x, cv.y, true);
  ctx.lineJoin = "round";
  if (final > 0) {
    ctx.fillStyle = rgba(LIME, 0.1 * final);
    ctx.fill();
  }
  ctx.strokeStyle = rgba(LIME, 0.34 + 0.66 * emphasis);
  ctx.lineWidth = 2.6 + 1.8 * emphasis;
  ctx.stroke();
}

/** The last part of the curve behind the tip, brighter and thicker towards the tip. */
function paintTrail(ctx: CanvasRenderingContext2D, d: ExplainerData, cv: Curve, phase: number, tipX: number, tipY: number) {
  const M = d.count;
  const f = (phase / TAU) * M;
  const steps = 150;
  const span = 0.55 * M;
  ctx.save();
  ctx.lineCap = "round";
  let px = 0;
  let py = 0;
  for (let s = 0; s <= steps; s++) {
    let x: number;
    let y: number;
    if (s === steps) {
      x = toScreenX(d, tipX);
      y = toScreenY(d, tipY);
    } else {
      const [zx, zy] = sampleAt(d, cv.x, cv.y, f - span * (1 - s / steps));
      x = toScreenX(d, zx);
      y = toScreenY(d, zy);
    }
    if (s > 0) {
      const q = s / steps;
      ctx.globalAlpha = Math.pow(q, 1.6);
      ctx.strokeStyle = q > 0.9 ? "#f4ffe0" : LIME;
      ctx.lineWidth = 2.4 + 4.2 * q;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    px = x;
    py = y;
  }
  ctx.restore();
}

function paintChain(ctx: CanvasRenderingContext2D, d: ExplainerData, chain: Chain, stage: Stage, sec: number, alpha: number) {
  const S = L.scale;
  const growing = stage.kind === "single" || stage.kind === "jump";
  const pulse = growing ? Math.max(0, 1 - (sec - stage.start) / 2.4) : 0;
  const isNew = (k: number) => growing && Math.abs(k) > stage.prev && Math.abs(k) <= stage.n;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // The many small circles: one thin polyline for the arms, rings only where they are big enough to see.
  ctx.beginPath();
  ctx.moveTo(toScreenX(d, d.center.x), toScreenY(d, d.center.y));
  for (let i = 0; i < chain.count; i++) ctx.lineTo(toScreenX(d, chain.toX[i]), toScreenY(d, chain.toY[i]));
  ctx.strokeStyle = rgba(STEEL, 0.5);
  ctx.lineWidth = 1.1;
  ctx.stroke();
  for (let i = 0; i < chain.count; i++) {
    const k = chain.k[i];
    const a = Math.abs(k);
    const r = chain.radius[i] * S;
    const cx = toScreenX(d, chain.fromX[i]);
    const cy = toScreenY(d, chain.fromY[i]);
    const fresh = isNew(k);
    const color = stage.kind === "jump" && fresh ? NEW_RANGE : harmonicColor(k);
    const major = a <= 5;
    if (r >= 0.6) {
      ctx.save();
      ctx.globalAlpha = alpha * Math.min(1, r / 3) * (major ? 0.95 : fresh ? 0.9 : 0.62);
      if (major && fresh && pulse > 0) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 18 * pulse;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = (major ? 2.6 : 1.2) + (fresh ? 1.2 + 2.4 * pulse : 0);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (major) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(toScreenX(d, chain.toX[i]), toScreenY(d, chain.toY[i]));
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, 5.2, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function paintCentre(ctx: CanvasRenderingContext2D, d: ExplainerData, sec: number, alpha: number) {
  const a = smooth((sec - TL.centre) / 0.5) * alpha;
  if (a <= 0.001) return;
  const x = toScreenX(d, d.center.x);
  const y = toScreenY(d, d.center.y);
  const ping = Math.max(0, 1 - (sec - TL.centre) / 1.1);
  ctx.save();
  ctx.globalAlpha = a;
  if (ping > 0) {
    ctx.strokeStyle = rgba(harmonicColor(0), ping);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 14 + (1 - ping) * 70, 0, TAU);
    ctx.stroke();
  }
  paintGlowDot(ctx, x, y, harmonicColor(0), 9);
  ctx.restore();
}

function spectrumRange(sec: number, stage: Stage): number {
  const target = (n: number) => (n <= 5 ? 6.5 : n + 2);
  if (stage.kind !== "jump" && stage.kind !== "final") return 6.5;
  const from = Math.log(target(stage.prev));
  const to = Math.log(target(stage.n));
  return Math.exp(from + (to - from) * smooth((sec - stage.start) / 1.2));
}

function paintSpectrum(ctx: CanvasRenderingContext2D, d: ExplainerData, sec: number, stage: Stage) {
  const alpha = smooth((sec - (TL.plusOne - 0.6)) / 0.6) * (1 - smooth((sec - TL.final) / 1.5));
  if (alpha <= 0.001) return;
  const S = L.spectrum;
  const K = spectrumRange(sec, stage);
  const slot = (S.right - S.left) / (2 * K + 1);
  const xOf = (k: number) => S.left + (k + K) * slot;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(S.left, S.baseline + 2);
  ctx.lineTo(S.right, S.baseline + 2);
  ctx.stroke();
  const shown = Math.floor(K);
  const barW = Math.max(1, slot - (slot > 12 ? 10 : slot > 3 ? 1.2 : 0.4));
  for (let k = -shown; k <= shown; k++) {
    if (k === 0) continue;
    const idx = kIndex(k);
    const full = (d.amp[idx] / d.ampMax) * S.maxHeight;
    const w = weights[idx];
    const fresh = (stage.kind === "single" || stage.kind === "jump") && Math.abs(k) > stage.prev && Math.abs(k) <= stage.n;
    const color = stage.kind === "jump" && fresh ? NEW_RANGE : harmonicColor(k);
    const x = xOf(k) + (slot - barW) / 2;
    if (w < 1) {
      ctx.fillStyle = rgba(color, 0.2);
      ctx.fillRect(x, S.baseline - Math.max(1.5, full), barW, Math.max(1.5, full));
    }
    if (w > 0) {
      const h = Math.max(2.5, full * w);
      ctx.fillStyle = color;
      ctx.fillRect(x, S.baseline - h, barW, h);
    }
  }
  // c_0 is the centre, not a radius: mark its slot with a gold diamond on the axis.
  ctx.fillStyle = harmonicColor(0);
  ctx.beginPath();
  const cx0 = xOf(0) + slot / 2;
  ctx.moveTo(cx0, S.baseline - 9);
  ctx.lineTo(cx0 + 8, S.baseline - 1);
  ctx.lineTo(cx0, S.baseline + 7);
  ctx.lineTo(cx0 - 8, S.baseline - 1);
  ctx.closePath();
  ctx.fill();
  ctx.font = "600 44px " + FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const labelled = K <= 7.5 ? [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5] : [-stage.n, 0, stage.n];
  for (const k of labelled) {
    // While the axis rescales, an end label stays hidden until its slot has scrolled into view.
    const visible = Math.max(0, Math.min(1, K - Math.abs(k) + 1));
    if (visible <= 0) continue;
    ctx.globalAlpha = alpha * visible;
    ctx.fillStyle = k === 0 ? harmonicColor(0) : Math.abs(k) <= 5 ? harmonicColor(k) : MUTED;
    ctx.fillText((k > 0 ? "" : k < 0 ? "−" : "") + Math.abs(k), xOf(k) + slot / 2, S.labelY);
  }
  ctx.restore();
}

export function paintExplainer(ctx: CanvasRenderingContext2D, sec: number) {
  const d = explainerData();
  curve ??= { x: new Float64Array(d.count), y: new Float64Array(d.count) };
  paintBackdrop(ctx, sec);
  panelPath(ctx);
  ctx.fillStyle = C.mapViewport;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  const stage = stageAt(sec);
  weightsAt(sec, weights);
  const phase = phaseAt(sec);
  const chainAlpha = 1 - smooth((sec - TL.final) / 1.5);

  ctx.save();
  panelPath(ctx);
  ctx.clip();
  paintGhost(ctx, d, sec);
  paintBorderPass(ctx, d, sec);
  if (sec >= TL.idea && weights[kIndex(1)] > 0) {
    const cv = curveWithWeights(d, weights, curve);
    const emphasis = sec >= TL.ellipse && sec < TL.singles ? 1 : sec >= TL.final ? 1 : 0.55;
    const final = smooth((sec - TL.final) / 1.5);
    if (stage.kind === "single" || stage.kind === "jump") {
      // The curve of the previous stage fades out so the change made by the new pair stays visible.
      const before = 0.6 * (1 - smooth((sec - stage.start) / 3));
      if (before > 0.01) {
        const old = baseCurve(d, stage.prev);
        ctx.save();
        ctx.globalAlpha = before;
        pathThrough(ctx, d, old.x, old.y, true);
        ctx.setLineDash([12, 9]);
        ctx.strokeStyle = "#f1f5f9";
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.restore();
      }
    }
    paintCurve(ctx, d, cv, emphasis, final);
    const chain = chainAt(d, weights, phase);
    if (chainAlpha > 0.001) {
      paintTrail(ctx, d, cv, phase, chain.tipX, chain.tipY);
      paintChain(ctx, d, chain, stage, sec, chainAlpha);
      const x = toScreenX(d, chain.tipX);
      const y = toScreenY(d, chain.tipY);
      ctx.save();
      ctx.globalAlpha = chainAlpha;
      paintGlowDot(ctx, x, y, "#f4ffe0", 6.5);
      ctx.restore();
    }
  }
  if (sec >= TL.centre) paintCentre(ctx, d, sec, chainAlpha);
  ctx.restore();

  paintSpectrum(ctx, d, sec, stage);
}
