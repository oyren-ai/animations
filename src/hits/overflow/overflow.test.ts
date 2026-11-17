import assert from "node:assert/strict";
import test from "node:test";
import { assertReelSafeBox } from "../../shared/reelUtils.ts";
import { HIT_SEED } from "../types.ts";
import { createMockCanvas } from "../mockCanvas.ts";
import { thinEvents } from "../voices.ts";
import { buildOverflowAudioEvents } from "./audio.ts";
import { overflowArena, OVERFLOW_SPEC } from "./index.ts";
import { paintOverflowFrame } from "./paint.ts";
import {
  ballRadius,
  frameRange,
  OVERFLOW_TARGET,
  POS_SCALE_X,
  POS_SCALE_Y,
  simulateOverflow,
} from "./sim.ts";

const trace = simulateOverflow(HIT_SEED);

test("the composition is a real one, not the stub", () => {
  assert.notEqual(overflowArena.status, "stub");
  assert.equal(overflowArena.spec, OVERFLOW_SPEC);
});

test("frame 0 holds exactly one big ball and the first split lands within 1 s", () => {
  assert.equal(trace.counts[0], 1);
  assert.ok(ballRadius(1) >= 100, "the single ball is big enough to read at frame 0");
  assert.ok(trace.firstSplitFrame >= 1 && trace.firstSplitFrame <= 60, `first split at frame ${trace.firstSplitFrame}`);
});

test("every split adds exactly one ball and the count never drops before the overflow", () => {
  let splitsSoFar = 0;
  let si = 0;
  for (let f = 0; f <= trace.overflowFrame; f++) {
    // counts[f] is recorded at the start of frame f, so it includes splits from frames before f
    while (si < trace.splits.length && trace.splits[si].frame < f) {
      splitsSoFar++;
      si++;
    }
    assert.equal(trace.counts[f], 1 + splitsSoFar, `frame ${f}`);
    if (f > 0) assert.ok(trace.counts[f] >= trace.counts[f - 1]);
  }
  for (let i = 1; i < trace.splits.length; i++) {
    assert.equal(trace.splits[i].n, trace.splits[i - 1].n + 1);
  }
});

test("the chamber reaches 10,000 balls and overflows between 17.5 s and 20.5 s", () => {
  assert.equal(OVERFLOW_TARGET, 10000);
  assert.equal(trace.counts[trace.overflowFrame], OVERFLOW_TARGET);
  const t = trace.overflowFrame / 60;
  assert.ok(t >= 17.5 && t <= 20.5, `overflow at ${t.toFixed(2)} s`);
  assert.ok(trace.overflowFrame + 60 * 2 <= trace.sceneFrames, "at least 2 s of burst and result remain");
});

test("balls shrink as they multiply so the chamber visibly fills", () => {
  let prev = Infinity;
  for (const n of [1, 2, 4, 16, 100, 1000, 10000]) {
    const r = ballRadius(n);
    assert.ok(r < prev);
    prev = r;
  }
  const fill = (n: number) => (n * Math.PI * ballRadius(n) ** 2) / (1080 * 1920);
  assert.ok(fill(10000) >= 0.5 && fill(10000) <= 0.72, `fill at 10,000 is ${fill(10000).toFixed(2)}`);
  assert.ok(fill(1) < 0.03);
});

test("every ball stays inside the canvas before the walls crack, then they spill out", () => {
  for (const f of [0, 30, 300, 600, 900, trace.overflowFrame - 1]) {
    const { start, end } = frameRange(trace, f);
    const r = trace.radius[f];
    for (let i = start; i < end; i++) {
      const x = trace.xs[i] / POS_SCALE_X;
      const y = trace.ys[i] / POS_SCALE_Y;
      assert.ok(x >= r - 1.5 && x <= 1080 - r + 1.5 && y >= r - 1.5 && y <= 1920 - r + 1.5, `ball ${i} at ${x},${y} frame ${f}`);
    }
  }
  const lastCount = trace.counts[trace.sceneFrames - 1];
  assert.ok(lastCount <= OVERFLOW_TARGET * 0.1, `${lastCount} balls still on screen at the end`);
});

test("the simulation is deterministic and the digest reacts to a different seed", () => {
  assert.equal(overflowArena.digest(trace), overflowArena.digest(simulateOverflow(HIT_SEED)));
  assert.notEqual(overflowArena.digest(trace), overflowArena.digest(simulateOverflow(HIT_SEED + 1)));
});

test("audio: a bell on every doubling, the rest thinned to a safe rate", () => {
  const events = buildOverflowAudioEvents(trace);
  const milestones = events.filter((e) => e.kind === "milestone");
  assert.equal(milestones.length, 13, "doublings 2, 4, ... 8192");
  const bells = events.filter((e) => e.kind === "bell");
  assert.ok(bells.length > 40, "the splits are audible");
  assert.equal(thinEvents(bells, 12).length, bells.length, "ordinary bells already respect 12 per second");
  for (const e of events) assert.ok(e.t >= 0 && e.t < OVERFLOW_SPEC.totalFrames / 60);
  assert.ok(events.some((e) => e.kind === "boom" && Math.abs(e.t - trace.overflowFrame / 60) < 0.05));
  assert.ok(events.some((e) => e.kind === "riser"));
});

test("painter: frame 0 shows the counter, the overflow frame shows the result, every box is safe", () => {
  const first = createMockCanvas();
  const boxes0 = paintOverflowFrame(first.ctx, trace, 0);
  assert.ok(first.texts.some((t) => t.text === "1"), "counter starts at 1");
  assert.ok(first.texts.some((t) => t.text.includes("BALLS")));
  for (const box of boxes0) assertReelSafeBox(box);

  const burst = createMockCanvas();
  const boxes1 = paintOverflowFrame(burst.ctx, trace, trace.overflowFrame + 45);
  assert.ok(burst.texts.some((t) => t.text.includes("OVERFLOW")), "result text after the burst");
  assert.ok(burst.texts.some((t) => t.text.includes("10,000")));
  for (const box of boxes1) assertReelSafeBox(box);

  const mid = createMockCanvas();
  paintOverflowFrame(mid.ctx, trace, 600);
  assert.ok(mid.coverageGrid(6, 10) >= 0.6, "mid-scene action reaches most of the canvas");
});
