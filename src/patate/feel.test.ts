import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE_RATE, SAMPLES_PER_FRAME } from "../audio.ts";
import { synthesizePatateWav } from "./audio.ts";
import {
  bodyDeformation,
  impactAmount,
  impactsByBody,
  impactSpring,
  NO_DEFORMATION,
  PATATE_PACE,
  PATATE_SQUASH,
  type Deformation,
  type PatateImpact,
} from "./feel.ts";
import { paintPatateFrame } from "./paint.ts";
import { PATATE_COMPOSITIONS, simulatePatate } from "./sim.ts";
import { PATATE_TOTAL_FRAMES } from "./themes.ts";

const det = (d: Deformation) => d.a * d.d - d.b * d.c;
const hit = (frame: number, nx: number, ny: number, speed: number, kind: "hit" | "pop" = "hit"): PatateImpact => ({
  frame,
  bodyId: 1,
  kind,
  nx,
  ny,
  speed,
});

// Mean body speed in px/s measured on main at 6c4e638, before this change (same seeds, same frames).
const BASELINE_MEAN_SPEED: Record<string, number> = {
  PatateMergeCodingAgents: 280,
  PatateMergeWorldToCode: 309,
  PatateMergeLanguages: 275,
};

function meanBodySpeed(trace: ReturnType<typeof simulatePatate>): number {
  let sum = 0;
  let count = 0;
  for (let f = 1; f < trace.frames.length; f++) {
    const previous = new Map(trace.frames[f - 1].bodies.map((body) => [body.id, body]));
    for (const body of trace.frames[f].bodies) {
      const before = previous.get(body.id);
      if (!before) continue;
      sum += Math.hypot(body.x - before.x, body.y - before.y) * 60;
      count++;
    }
  }
  return sum / Math.max(1, count);
}

test("the pace and feel constants are named and sane", () => {
  assert.ok(PATATE_PACE.gravityScale > 0.6 && PATATE_PACE.gravityScale < 1, "gravity must be lighter than before");
  assert.ok(PATATE_PACE.dropGapScale >= 1 && PATATE_PACE.dropGapScale <= 1.3);
  assert.ok(PATATE_PACE.restitution > 0.28 && PATATE_PACE.restitution <= 0.5, "bouncier than the old 0.28");
  assert.ok(PATATE_SQUASH.maxLogSquash > 0.15 && PATATE_SQUASH.maxLogSquash <= 0.4);
  assert.ok(PATATE_SQUASH.maxTotalLogSquash >= PATATE_SQUASH.maxLogSquash);
});

test("the spring squashes at impact, rebounds into a stretch, then settles to exactly nothing", () => {
  assert.equal(impactSpring(0), 1);
  const early = Array.from({ length: 14 }, (_, age) => impactSpring(age));
  assert.ok(Math.min(...early) < -0.2, "no rebound stretch after the squash");
  assert.equal(impactSpring(PATATE_SQUASH.settleFrames), 0);
  assert.equal(impactSpring(PATATE_SQUASH.settleFrames + 10), 0);
  let largestStep = 0;
  for (let age = 1; age <= PATATE_SQUASH.settleFrames; age++) {
    largestStep = Math.max(largestStep, Math.abs(impactSpring(age) - impactSpring(age - 1)));
  }
  assert.ok(largestStep < 0.35, `the spring jumps by ${largestStep} between two frames`);
});

test("impact strength grows with speed and slow touches leave no mark", () => {
  assert.equal(impactAmount(PATATE_SQUASH.minImpactSpeed - 1), 0);
  assert.ok(impactAmount(400) > 0 && impactAmount(400) < impactAmount(900));
  assert.equal(impactAmount(PATATE_SQUASH.fullImpactSpeed), PATATE_SQUASH.maxLogSquash);
  assert.equal(impactAmount(PATATE_SQUASH.fullImpactSpeed * 5), PATATE_SQUASH.maxLogSquash);
});

test("a vertical hit squashes along the contact, widens across it and keeps the volume", () => {
  const d = bodyDeformation([hit(100, 0, 1, 900)], 100);
  assert.ok(d.d < 0.8 && d.a > 1.25, `a=${d.a} d=${d.d}`);
  assert.ok(Math.abs(det(d) - 1) < 1e-9);
  assert.equal(d.b, d.c, "the deformation is symmetric");
  const sideways = bodyDeformation([hit(100, 1, 0, 900)], 100);
  assert.ok(sideways.a < 0.8 && sideways.d > 1.25, "a wall hit squashes sideways");
  const diagonal = bodyDeformation([hit(100, Math.SQRT1_2, Math.SQRT1_2, 900)], 100);
  assert.ok(Math.abs(diagonal.b) > 0.1, "a diagonal contact must shear, not just scale the axes");
  assert.ok(Math.abs(det(diagonal) - 1) < 1e-9);
});

test("no impacts and slow impacts give no deformation", () => {
  assert.deepEqual(bodyDeformation([], 50), NO_DEFORMATION);
  assert.deepEqual(bodyDeformation(undefined, 50), NO_DEFORMATION);
  assert.deepEqual(bodyDeformation([hit(10, 0, 1, PATATE_SQUASH.minImpactSpeed - 5)], 10), NO_DEFORMATION);
  assert.deepEqual(bodyDeformation([hit(10, 0, 1, 900)], 10 + PATATE_SQUASH.settleFrames), NO_DEFORMATION);
});

test("a falling potato stretches along its path just before it hits; a merge pop does not", () => {
  const before = bodyDeformation([hit(100, 0, 1, 900)], 100 - 2);
  assert.ok(before.d > 1.03 && before.a < 0.97, `expected a stretch along the contact, got a=${before.a} d=${before.d}`);
  assert.ok(Math.abs(det(before) - 1) < 1e-9);
  assert.deepEqual(bodyDeformation([hit(100, 0, 1, 900, "pop")], 100 - 2), NO_DEFORMATION);
  assert.deepEqual(bodyDeformation([hit(100, 0, 1, 900)], 100 - PATATE_SQUASH.anticipationFrames - 3), NO_DEFORMATION);
});

test("overlapping impacts add up but stay capped, volume kept, and order does not matter", () => {
  const many = Array.from({ length: 12 }, (_, i) => hit(100 + (i % 3), Math.cos(i), Math.sin(i), 1200));
  const forward = bodyDeformation(many, 102);
  const backward = bodyDeformation([...many].reverse(), 102);
  assert.deepEqual(forward, backward);
  assert.ok(Math.abs(det(forward) - 1) < 1e-9);
  const stretch = Math.max(forward.a, forward.d, 1 / forward.a, 1 / forward.d);
  assert.ok(stretch <= Math.exp(PATATE_SQUASH.maxTotalLogSquash) + 1e-9, `stretch ${stretch}`);
});

test("impacts are indexed by body for painting", () => {
  const index = impactsByBody([hit(5, 0, 1, 500), { ...hit(9, 1, 0, 700), bodyId: 2 }, hit(12, 0, 1, 400)]);
  assert.equal(index.get(1)?.length, 2);
  assert.equal(index.get(2)?.length, 1);
  assert.equal(index.get(3), undefined);
});

test("the potatoes move slower than before on every composition, and every tier and the boss still land in time", () => {
  for (const comp of PATATE_COMPOSITIONS) {
    const trace = simulatePatate(comp.slug);
    const slower = meanBodySpeed(trace);
    assert.ok(slower <= BASELINE_MEAN_SPEED[comp.id] * 0.9, `${comp.id}: mean speed ${slower.toFixed(0)} px/s is not 10% below ${BASELINE_MEAN_SPEED[comp.id]}`);
    for (let tier = 0; tier < 8; tier++) assert.notEqual(trace.unlockFrames[tier], null, `${comp.id}: tier ${tier + 1}`);
    assert.ok(trace.bossMergeFrame !== null && trace.bossMergeFrame >= 900 && trace.bossMergeFrame <= 1140, `${comp.id}: boss at ${trace.bossMergeFrame}`);
    assert.equal(trace.totalFrames, PATATE_TOTAL_FRAMES);
    assert.equal(trace.totalFrames, 1440);
  }
});

test("the trace records every contact, merge pop and merge shiver as an impact, deterministically", () => {
  for (const comp of PATATE_COMPOSITIONS) {
    const trace = simulatePatate(comp.slug);
    const replay = simulatePatate(comp.slug, comp.seed);
    assert.deepEqual(trace.impacts, replay.impacts);
    assert.ok(trace.impacts.length >= 60, `${comp.id}: only ${trace.impacts.length} impacts`);
    let previousFrame = -1;
    for (const impact of trace.impacts) {
      assert.ok(impact.frame >= previousFrame, "impacts are ordered by frame");
      previousFrame = impact.frame;
      assert.ok(Number.isFinite(impact.speed) && impact.speed > 0);
      assert.ok(Math.abs(Math.hypot(impact.nx, impact.ny) - 1) < 1e-6, "the contact direction is a unit vector");
      const bodies = trace.frames[impact.frame].bodies;
      assert.ok(bodies.some((body) => body.id === impact.bodyId), `${comp.id}: impact on body ${impact.bodyId} that is not on screen at frame ${impact.frame}`);
    }
    for (const event of trace.events) {
      if (event.type !== "merge") continue;
      const pops = trace.impacts.filter((impact) => impact.frame === event.frame && impact.kind === "pop");
      assert.ok(pops.length >= 1, `${comp.id}: merge at ${event.frame} has no pop`);
    }
    assert.ok(trace.impacts.some((impact) => impact.kind === "hit" && impact.speed > 500), `${comp.id}: no hard hit recorded`);
  }
});

function createMockCanvas2D() {
  const transforms: number[][] = [];
  let currentFont = "600 24px Inter";
  const base: Record<string, unknown> = {
    fillStyle: "#000",
    strokeStyle: "#fff",
    globalAlpha: 1,
    lineWidth: 1,
    get font() {
      return currentFont;
    },
    set font(value: string) {
      currentFont = value;
    },
    transform: (...args: number[]) => transforms.push(args),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText(text: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(currentFont)?.[1] ?? 24);
      return { width: text.length * px * 0.54, actualBoundingBoxAscent: px * 0.76, actualBoundingBoxDescent: px * 0.22 };
    },
  };
  const ctx = new Proxy(base, {
    get: (target, property) => (property in target ? target[property as string] : () => undefined),
    set: (target, property, value) => {
      target[property as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, transforms };
}

test("paint squashes each potato along its contact, keeps the volume, and leaves resting frames alone", () => {
  const trace = simulatePatate(PATATE_COMPOSITIONS[0].slug);
  const idle = createMockCanvas2D();
  paintPatateFrame(idle.ctx, trace, 0);
  assert.equal(idle.transforms.length, 0, "frame 0 has no impacts, so no deformation");

  const strong = trace.impacts.find((impact) => impact.kind === "hit" && impact.speed > 600);
  assert.ok(strong);
  const hitFrame = createMockCanvas2D();
  paintPatateFrame(hitFrame.ctx, trace, strong.frame);
  assert.ok(hitFrame.transforms.some(([a, b, c, d]) => Math.abs(a - 1) > 0.05 || Math.abs(d - 1) > 0.05 || Math.abs(b) > 0.05));

  let deformedFrames = 0;
  for (let frame = 0; frame <= trace.sceneFrames; frame += 3) {
    const { ctx, transforms } = createMockCanvas2D();
    paintPatateFrame(ctx, trace, frame);
    let deformed = false;
    for (const [a, b, c, d, e, f] of transforms) {
      assert.ok(Math.abs(a * d - b * c - 1) < 1e-6, `frame ${frame}: deformation changes the volume`);
      assert.equal(b, c);
      assert.equal(e, 0);
      assert.equal(f, 0);
      if (Math.abs(a - 1) > 0.03 || Math.abs(d - 1) > 0.03 || Math.abs(b) > 0.03) deformed = true;
    }
    if (deformed) deformedFrames++;
  }
  assert.ok(deformedFrames >= 120, `only ${deformedFrames} of ${Math.ceil(trace.sceneFrames / 3)} sampled frames show a squash`);
});

test("the sound follows the new timing: silent until the first event frame, present right after it", () => {
  for (const comp of PATATE_COMPOSITIONS) {
    const trace = simulatePatate(comp.slug);
    const wav = synthesizePatateWav(trace);
    assert.equal(wav.length, 44 + PATATE_TOTAL_FRAMES * SAMPLES_PER_FRAME * 2);
    const first = trace.events[0];
    const startByte = 44 + first.frame * SAMPLES_PER_FRAME * 2;
    for (let i = 44; i < startByte; i += 2) assert.equal(wav.readInt16LE(i), 0, `${comp.id}: sound before the first event`);
    let peak = 0;
    const windowEnd = startByte + Math.round(0.04 * SAMPLE_RATE) * 2;
    for (let i = startByte; i < windowEnd; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    assert.ok(peak > 300, `${comp.id}: nothing audible within 40 ms of the first event`);
  }
});
