import { VIDEO } from "../settings.ts";
import { computeLoopModes, prepareCountryMap } from "./fourier.ts";

/**
 * Long-form Fourier explainer for a single-loop border (MapOfIndia).
 *
 * Convention: the border is the closed curve z(t) = x(t) + i y(t), t in [0, 2 pi), drawn with the
 * imaginary axis pointing UP and traversed counter-clockwise, so the dominant circle is k = +1.
 * Coefficients come from the repo's own discrete transform:
 *   c_k = (1 / 2 pi) * integral_0^{2 pi} z(t) e^{-i k t} dt   (Riemann sum over the M border samples)
 * and z_N(t) = sum_{k=-N}^{N} c_k e^{i k t}. The chain adds terms in the order k = 0, +1, -1, +2, -2, ...
 */
export const EXPLAINER_SLUG = "map-of-india" as const;
export const N_MAX = 240;
export const K_COUNT = 2 * N_MAX + 1;
export const kIndex = (k: number) => k + N_MAX;

export const SINGLE_STAGES = [2, 3, 4, 5] as const;
export const JUMP_STAGES = [8, 16, 32, 64, 128, 240] as const;
export const SINGLE_SECONDS = 7;
export const JUMP_SECONDS = 5;
export const IDEA_REVOLUTION_SECONDS = 5;

/** Scene markers in seconds. */
export const TL = {
  borderStart: 0.6,
  borderEnd: 6,
  idea: 7,
  centre: 8.8,
  plusOne: 10.6,
  minusOne: 13.4,
  ellipse: 15.6,
  singles: 17,
  jumps: 45,
  final: 75,
  end: 82,
} as const;
export const EXPLAINER_FRAMES = Math.round(TL.end * VIDEO.fps);

export const LAYOUT = {
  /** Nothing important may sit in the top or bottom 150 px. */
  safe: { left: 24, right: 1056, top: 150, bottom: 1770 },
  header: { top: 160, height: 80 },
  rows: [
    { top: 246, height: 104 },
    { top: 352, height: 98 },
    { top: 452, height: 100 },
  ],
  panel: { left: 40, right: 1040, top: 566, bottom: 1462 },
  caption: { top: 1472, lineHeight: 52 },
  spectrum: { left: 60, right: 1020, top: 1598, baseline: 1698, maxHeight: 92, labelY: 1756 },
  scale: 1.15,
  centerX: 540,
  centerY: 1014,
} as const;

export type Stage = {
  readonly kind: "intro" | "idea" | "single" | "jump" | "final";
  readonly n: number;
  readonly prev: number;
  readonly start: number;
  readonly end: number;
};

export function stageAt(sec: number): Stage {
  if (sec < TL.idea) return { kind: "intro", n: 0, prev: 0, start: 0, end: TL.idea };
  if (sec < TL.plusOne) return { kind: "idea", n: 0, prev: 0, start: TL.idea, end: TL.plusOne };
  if (sec < TL.singles) return { kind: "idea", n: 1, prev: 0, start: TL.plusOne, end: TL.singles };
  if (sec < TL.jumps) {
    const i = Math.min(SINGLE_STAGES.length - 1, Math.floor((sec - TL.singles) / SINGLE_SECONDS));
    const n = SINGLE_STAGES[i];
    const start = TL.singles + i * SINGLE_SECONDS;
    return { kind: "single", n, prev: n - 1, start, end: start + SINGLE_SECONDS };
  }
  if (sec < TL.final) {
    const i = Math.min(JUMP_STAGES.length - 1, Math.floor((sec - TL.jumps) / JUMP_SECONDS));
    const start = TL.jumps + i * JUMP_SECONDS;
    return { kind: "jump", n: JUMP_STAGES[i], prev: i === 0 ? 5 : JUMP_STAGES[i - 1], start, end: start + JUMP_SECONDS };
  }
  return { kind: "final", n: N_MAX, prev: N_MAX, start: TL.final, end: TL.end };
}

export const circleCount = (n: number) => 2 * n + 1;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};

/** How far term k has grown in (0 = absent, 1 = full circle) at time `sec`. */
export function weightOf(k: number, sec: number): number {
  const a = Math.abs(k);
  if (a === 0) return 1;
  if (a === 1) return smooth((sec - (k > 0 ? TL.plusOne : TL.minusOne)) / 1);
  if (a <= 5) return smooth((sec - (TL.singles + (a - 2) * SINGLE_SECONDS + (k > 0 ? 0.4 : 1.4))) / 1);
  for (let i = 0; i < JUMP_STAGES.length; i++) {
    const prev = i === 0 ? 5 : JUMP_STAGES[i - 1];
    const n = JUMP_STAGES[i];
    if (a > prev && a <= n) {
      const start = TL.jumps + i * JUMP_SECONDS + 0.3 + (1.3 * (a - prev - 1)) / (n - prev);
      return smooth((sec - start) / 0.7);
    }
  }
  return 0;
}

export function weightsAt(sec: number, out: Float64Array = new Float64Array(K_COUNT)): Float64Array {
  out[kIndex(0)] = 1;
  for (let a = 1; a <= N_MAX; a++) {
    out[kIndex(a)] = weightOf(a, sec);
    out[kIndex(-a)] = weightOf(-a, sec);
  }
  return out;
}

/** The curve parameter t of the moving tip; every stage starts and ends on a whole revolution. */
export function phaseAt(sec: number): number {
  if (sec < TL.idea) return 0;
  let revolutions: number;
  if (sec < TL.singles) revolutions = (sec - TL.idea) / IDEA_REVOLUTION_SECONDS;
  else if (sec < TL.jumps) revolutions = ((sec - TL.singles) % SINGLE_SECONDS) / SINGLE_SECONDS;
  else revolutions = ((sec - TL.jumps) % JUMP_SECONDS) / JUMP_SECONDS;
  return 2 * Math.PI * revolutions;
}

/** Progress (0..1) of the opening pass that draws the exact border once. */
export const borderProgress = (sec: number) => clamp01((sec - TL.borderStart) / (TL.borderEnd - TL.borderStart));

export type ExplainerData = {
  readonly count: number;
  readonly zx: Float64Array;
  readonly zy: Float64Array;
  readonly cRe: Float64Array;
  readonly cIm: Float64Array;
  readonly amp: Float64Array;
  readonly ampMax: number;
  readonly center: { readonly x: number; readonly y: number };
  readonly origin: { readonly x: number; readonly y: number };
  readonly cosT: Float64Array;
  readonly sinT: Float64Array;
};

let dataCache: ExplainerData | undefined;

export function explainerData(): ExplainerData {
  if (dataCache) return dataCache;
  const loop = prepareCountryMap(EXPLAINER_SLUG).loops[0];
  const M = loop.sampleCount;
  const zx = new Float64Array(M);
  const zy = new Float64Array(M);
  for (let m = 0; m < M; m++) {
    const source = (M - m) % M; // reverse the traversal: counter-clockwise
    zx[m] = loop.exactX[source];
    zy[m] = -loop.exactY[source]; // screen y points down; the imaginary axis points up
  }
  const modes = computeLoopModes(zx, zy, N_MAX);
  const cRe = new Float64Array(K_COUNT);
  const cIm = new Float64Array(K_COUNT);
  const amp = new Float64Array(K_COUNT);
  for (const mode of modes) {
    cRe[kIndex(mode.k)] = mode.re;
    cIm[kIndex(mode.k)] = mode.im;
    amp[kIndex(mode.k)] = mode.amplitude;
  }
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, ampMax = 0;
  for (let m = 0; m < M; m++) {
    xMin = Math.min(xMin, zx[m]); xMax = Math.max(xMax, zx[m]);
    yMin = Math.min(yMin, zy[m]); yMax = Math.max(yMax, zy[m]);
  }
  for (let k = 1; k <= N_MAX; k++) ampMax = Math.max(ampMax, amp[kIndex(k)], amp[kIndex(-k)]);
  const cosT = new Float64Array(M);
  const sinT = new Float64Array(M);
  for (let j = 0; j < M; j++) {
    cosT[j] = Math.cos((2 * Math.PI * j) / M);
    sinT[j] = Math.sin((2 * Math.PI * j) / M);
  }
  dataCache = {
    count: M, zx, zy, cRe, cIm, amp, ampMax,
    center: { x: cRe[kIndex(0)], y: cIm[kIndex(0)] },
    origin: { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2 },
    cosT, sinT,
  };
  return dataCache;
}

/** The border point z(t) for t = 2 pi p, interpolated between the samples. */
export function borderPoint(d: ExplainerData, p: number): { x: number; y: number } {
  const u = (((p * d.count) % d.count) + d.count) % d.count;
  const i0 = Math.floor(u);
  const i1 = (i0 + 1) % d.count;
  const f = u - i0;
  return { x: d.zx[i0] + (d.zx[i1] - d.zx[i0]) * f, y: d.zy[i0] + (d.zy[i1] - d.zy[i0]) * f };
}

export const toScreenX = (d: ExplainerData, zx: number) => LAYOUT.centerX + (zx - d.origin.x) * LAYOUT.scale;
export const toScreenY = (d: ExplainerData, zy: number) => LAYOUT.centerY - (zy - d.origin.y) * LAYOUT.scale;

export type Curve = { x: Float64Array; y: Float64Array };

function addTerm(d: ExplainerData, k: number, weight: number, out: Curve) {
  const M = d.count;
  const ar = weight * d.cRe[kIndex(k)];
  const ai = weight * d.cIm[kIndex(k)];
  for (let m = 0; m < M; m++) {
    let idx = (k * m) % M;
    if (idx < 0) idx += M;
    const c = d.cosT[idx];
    const s = d.sinT[idx];
    out.x[m] += ar * c - ai * s;
    out.y[m] += ar * s + ai * c;
  }
}

const baseCache = new Map<number, Curve>();
/** z_n(t_m) with every pair up to n fully on (cached). */
export function baseCurve(d: ExplainerData, n: number): Curve {
  const hit = baseCache.get(n);
  if (hit) return hit;
  const curve: Curve = { x: new Float64Array(d.count), y: new Float64Array(d.count) };
  curve.x.fill(d.center.x);
  curve.y.fill(d.center.y);
  for (let a = 1; a <= n; a++) {
    addTerm(d, a, 1, curve);
    addTerm(d, -a, 1, curve);
  }
  baseCache.set(n, curve);
  return curve;
}

/** z_N(t_m) = c_0 + sum over k != 0 of w_k c_k e^{i k t_m} on the border sample grid. */
export function curveWithWeights(d: ExplainerData, w: Float64Array, out: Curve): Curve {
  let n0 = 0;
  while (n0 < N_MAX && w[kIndex(n0 + 1)] === 1 && w[kIndex(-(n0 + 1))] === 1) n0++;
  const base = baseCurve(d, n0);
  out.x.set(base.x);
  out.y.set(base.y);
  for (let a = n0 + 1; a <= N_MAX; a++) {
    const wp = w[kIndex(a)];
    const wn = w[kIndex(-a)];
    if (wp <= 0 && wn <= 0) break;
    if (wp > 0) addTerm(d, a, wp, out);
    if (wn > 0) addTerm(d, -a, wn, out);
  }
  return out;
}

export type Chain = {
  count: number;
  tipX: number;
  tipY: number;
  readonly fromX: Float64Array;
  readonly fromY: Float64Array;
  readonly toX: Float64Array;
  readonly toY: Float64Array;
  readonly radius: Float64Array;
  readonly k: Int16Array;
};

/** Tip-to-tail epicycles at curve parameter `phase`: ring k is centred where the previous arm ends. */
export const CHAIN_ORDER: readonly number[] = (() => {
  const order: number[] = [];
  for (let a = 1; a <= N_MAX; a++) order.push(a, -a);
  return order;
})();

const chainScratch: Chain = {
  count: 0, tipX: 0, tipY: 0,
  fromX: new Float64Array(2 * N_MAX), fromY: new Float64Array(2 * N_MAX),
  toX: new Float64Array(2 * N_MAX), toY: new Float64Array(2 * N_MAX),
  radius: new Float64Array(2 * N_MAX), k: new Int16Array(2 * N_MAX),
};

export function chainAt(d: ExplainerData, w: Float64Array, phase: number): Chain {
  const c = chainScratch;
  let x = d.center.x;
  let y = d.center.y;
  let n = 0;
  for (const k of CHAIN_ORDER) {
    const wk = w[kIndex(k)];
    if (wk <= 0) break;
    const angle = k * phase;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const re = d.cRe[kIndex(k)];
    const im = d.cIm[kIndex(k)];
    c.fromX[n] = x;
    c.fromY[n] = y;
    x += wk * (re * cos - im * sin);
    y += wk * (re * sin + im * cos);
    c.toX[n] = x;
    c.toY[n] = y;
    c.radius[n] = wk * d.amp[kIndex(k)];
    c.k[n] = k;
    n++;
  }
  c.count = n;
  c.tipX = x;
  c.tipY = y;
  return c;
}

/** Root-mean-square distance of z_N from the border samples, relative to the border's own spread about c_0. */
export function relativeRmse(d: ExplainerData, n: number): number {
  const w = new Float64Array(K_COUNT);
  w[kIndex(0)] = 1;
  for (let a = 1; a <= n; a++) { w[kIndex(a)] = 1; w[kIndex(-a)] = 1; }
  const curve = curveWithWeights(d, w, { x: new Float64Array(d.count), y: new Float64Array(d.count) });
  let err = 0, spread = 0;
  for (let m = 0; m < d.count; m++) {
    err += (curve.x[m] - d.zx[m]) ** 2 + (curve.y[m] - d.zy[m]) ** 2;
    spread += (d.zx[m] - d.center.x) ** 2 + (d.zy[m] - d.center.y) ** 2;
  }
  return Math.sqrt(err / spread);
}
