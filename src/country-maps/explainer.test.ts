import assert from "node:assert/strict";
import test from "node:test";
import katex from "katex";
import { VIDEO } from "../settings.ts";
import {
  baseCurve, chainAt, CHAIN_ORDER, curveWithWeights, EXPLAINER_FRAMES, explainerData, JUMP_SECONDS, JUMP_STAGES, K_COUNT, kIndex,
  N_MAX, phaseAt, relativeRmse, SINGLE_SECONDS, SINGLE_STAGES, stageAt, TL, weightOf, weightsAt,
} from "./explainer.ts";
import { prepareCountryMap } from "./fourier.ts";
import { CAPTIONS, ROW_ONE, ROW_THREE, ROW_TWO } from "./explainer-text.ts";

const d = explainerData();

test("c_k matches an independent evaluation of (1/2pi) * integral of z(t) e^(-ikt) dt on the border samples", () => {
  for (const k of [0, 1, -1, 2, -2, 5, -5, 37, -37, 240, -240]) {
    let re = 0;
    let im = 0;
    for (let m = 0; m < d.count; m++) {
      const angle = (-k * 2 * Math.PI * m) / d.count;
      re += d.zx[m] * Math.cos(angle) - d.zy[m] * Math.sin(angle);
      im += d.zx[m] * Math.sin(angle) + d.zy[m] * Math.cos(angle);
    }
    assert.ok(Math.abs(re / d.count - d.cRe[kIndex(k)]) < 1e-8, "Re c_" + k);
    assert.ok(Math.abs(im / d.count - d.cIm[kIndex(k)]) < 1e-8, "Im c_" + k);
  }
});

test("the border is traversed counter-clockwise with the imaginary axis up, so k = +1 is the dominant circle", () => {
  let area = 0;
  for (let m = 0; m < d.count; m++) {
    const n = (m + 1) % d.count;
    area += d.zx[m] * d.zy[n] - d.zx[n] * d.zy[m];
  }
  assert.ok(area > 0, "signed area must be positive");
  assert.ok(d.amp[kIndex(1)] > 5 * d.amp[kIndex(-1)]);
  assert.ok(d.amp[kIndex(1)] === d.ampMax);
});

test("N = 1 traces an ellipse with semi-axes |c_1| + |c_-1| and ||c_1| - |c_-1||", () => {
  const w = new Float64Array(K_COUNT);
  for (const k of [0, 1, -1]) w[kIndex(k)] = 1;
  const curve = curveWithWeights(d, w, { x: new Float64Array(d.count), y: new Float64Array(d.count) });
  const a = d.amp[kIndex(1)] + d.amp[kIndex(-1)];
  const b = Math.abs(d.amp[kIndex(1)] - d.amp[kIndex(-1)]);
  const alpha = (Math.atan2(d.cIm[kIndex(1)], d.cRe[kIndex(1)]) + Math.atan2(d.cIm[kIndex(-1)], d.cRe[kIndex(-1)])) / 2;
  for (let m = 0; m < d.count; m++) {
    const x = curve.x[m] - d.center.x;
    const y = curve.y[m] - d.center.y;
    const u = x * Math.cos(alpha) + y * Math.sin(alpha);
    const v = -x * Math.sin(alpha) + y * Math.cos(alpha);
    assert.ok(Math.abs((u / a) ** 2 + (v / b) ** 2 - 1) < 1e-9);
  }
});

test("partial sums, the epicycle chain tip and the repo's own tier metrics agree", () => {
  const w = weightsAt(TL.end);
  assert.ok(w.every((value) => value === 1));
  const full = curveWithWeights(d, w, { x: new Float64Array(d.count), y: new Float64Array(d.count) });
  for (const m of [0, 1, 333, 1279]) {
    const t = (2 * Math.PI * m) / d.count;
    const chain = chainAt(d, w, t);
    assert.equal(chain.count, 2 * N_MAX);
    assert.ok(Math.hypot(chain.tipX - full.x[m], chain.tipY - full.y[m]) < 1e-8);
  }
  const tiers = prepareCountryMap("map-of-india").tierMetrics;
  assert.ok(Math.abs(relativeRmse(d, 240) - tiers[tiers.length - 1].relativeRmse) < 1e-9);
  assert.ok(relativeRmse(d, 240) < 0.006);
  let last = Infinity;
  for (const n of [0, 1, 2, 3, 4, 5, ...JUMP_STAGES]) {
    const error = relativeRmse(d, n);
    assert.ok(error < last, "error must fall at N = " + n);
    last = error;
  }
  assert.equal(baseCurve(d, 0).x[7], d.center.x);
});

test("the timeline is slow, whole-revolution aligned, and adds circles tip to tail in chain order", () => {
  assert.equal(EXPLAINER_FRAMES, 82 * VIDEO.fps);
  assert.equal(TL.singles + SINGLE_STAGES.length * SINGLE_SECONDS, TL.jumps);
  assert.equal(TL.jumps + JUMP_STAGES.length * JUMP_SECONDS, TL.final);
  assert.ok(SINGLE_SECONDS >= 6 && SINGLE_SECONDS <= 8);
  const wholeTurn = (sec: number) => {
    const turns = phaseAt(sec) / (2 * Math.PI);
    return Math.abs(turns - Math.round(turns)) < 1e-9;
  };
  for (const start of [TL.singles, ...SINGLE_STAGES.map((_, i) => TL.singles + i * SINGLE_SECONDS), ...JUMP_STAGES.map((_, i) => TL.jumps + i * JUMP_SECONDS)]) {
    assert.ok(wholeTurn(start), "stage starts on a whole revolution at " + start);
  }
  assert.equal(stageAt(TL.jumps + 0.1).n, 8);
  assert.equal(stageAt(TL.final - 0.01).n, 240);
  for (let sec = 0; sec < TL.end; sec += 0.37) {
    const w = weightsAt(sec);
    const order = CHAIN_ORDER.map((k) => w[kIndex(k)]);
    for (let i = 1; i < order.length; i++) assert.ok(order[i] <= order[i - 1] + 1e-12, "weights fall along the chain at " + sec);
  }
  for (const n of [...SINGLE_STAGES, ...JUMP_STAGES]) {
    assert.equal(weightOf(n, stageAt(n <= 5 ? TL.singles + (n - 2) * SINGLE_SECONDS : TL.final).end), 1);
  }
});

test("every formula and caption in the explainer is valid KaTeX", () => {
  const rows = [...ROW_ONE, ...ROW_TWO, ...ROW_THREE];
  for (let sec = 0; sec <= TL.end; sec += 0.5) {
    for (const row of rows) {
      katex.renderToString(row.value(sec), { throwOnError: true, strict: "error", output: "html" });
    }
    for (const caption of CAPTIONS) {
      for (const line of caption.value(sec)) {
        for (const piece of line) if (piece.x) katex.renderToString(piece.x, { throwOnError: true, strict: "error", output: "html" });
      }
    }
  }
  assert.ok(CAPTIONS.some((caption) => caption.value(0).flat().some((piece) => piece.t === "github.com/oyren-ai/animations")));
});
