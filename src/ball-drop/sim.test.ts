import assert from "node:assert/strict";
import test from "node:test";
import { auditTrace, BASE_RADIUS, mergePair, paddleAt, simulate, STYLES, type Trace } from "./sim.ts";
import { SCENE_FRAMES } from "../settings.ts";
import { bowlY } from "./bounds.ts";

const traces = new Map<string, Trace>();
for (const style of STYLES) {
  test(style.id + ": fixed seed, empty opening, full duration and conserved mass", () => {
    const trace = simulate(style.slug);
    traces.set(style.slug, trace);
    assert.equal(trace.seed, style.seed);
    assert.equal(trace.frames.length, SCENE_FRAMES);
    assert.deepEqual(trace.frames[0].balls, []);
    assert.equal(trace.events[0].frame, 1);
    assert.ok(trace.events.filter((event) => event.type === "spawn").length > 10);
    assert.deepEqual(auditTrace(trace), []);
    assert.ok(trace.events.some((event) => event.type === "hit"));
    if (style.slug === "split-lane-funnel-merge") {
      assert.ok(trace.events.some((event) => event.type === "merge"));
      assert.ok(trace.frames.at(-1)!.balls.some((ball) => ball.tier > 1));
    }
  });
}

test("the same seed reproduces every frame and sound cue", () => {
  assert.deepEqual(simulate("pinball-bumper-matrix"), traces.get("pinball-bumper-matrix"));
  assert.notDeepEqual(simulate("pinball-bumper-matrix", 1).events, traces.get("pinball-bumper-matrix")!.events);
});

for (const style of ["pinball-bumper-matrix", "pendulum-cascade"] as const) {
  test(style + ": falling scenes retain visible motion through their closing approach", () => {
    const trace = traces.get(style)!;
    assert.ok(trace.frames[630].balls.length > 0, "the scene must not drain into an empty final beat");
    assert.ok(trace.frames[690].balls.length > 0, "the last half-second still contains falling discs");
  });
}

test("equal-tier merges conserve mass, disc area and both momentum components", () => {
  const a = { id: 1, x: 10, y: 20, vx: 20, vy: 40, r: BASE_RADIUS, tier: 1, mass: 1 };
  const b = { ...a, id: 2, x: 30, vx: -10, vy: 20 };
  const merged = mergePair(a, b, 3)!;
  assert.equal(merged.mass, 2);
  assert.equal(merged.tier, 2);
  assert.equal(merged.x, 20);
  assert.equal(merged.vx, 5);
  assert.equal(merged.vy, 30);
  assert.ok(Math.abs(merged.r ** 2 - a.r ** 2 - b.r ** 2) < 1e-8);
  assert.equal(mergePair(a, { ...b, tier: 2 }, 3), null);
});

test("paddle contact velocity agrees with its analytic trajectory", () => {
  for (let index = 0; index < 4; index++) {
    const t = 0.37, h = 1e-5, p = paddleAt(index, t);
    const before = paddleAt(index, t - h), after = paddleAt(index, t + h);
    assert.ok(Math.abs((after.b.x - before.b.x) / (2 * h) + p.omega! * (p.b.y - p.a.y)) < 1e-5);
    assert.ok(Math.abs((after.b.y - before.b.y) / (2 * h) - p.omega! * (p.b.x - p.a.x)) < 1e-5);
  }
});

test("the audit rejects altered mass counters, duplicate identities and glass penetration", () => {
  const original = traces.get("split-lane-funnel-merge")!;
  const changed = structuredClone(original);
  changed.frames[1].spawned++;
  assert.ok(auditTrace(changed).includes("Mass ledger mismatch"));
  const duplicate = structuredClone(original), frame = duplicate.frames.find((item) => item.balls.length > 1)!;
  frame.balls[1].id = frame.balls[0].id;
  assert.ok(auditTrace(duplicate).includes("Duplicate body identity"));
  const glass = structuredClone(original), ball = glass.frames.at(-1)!.balls[0];
  ball.y = bowlY(ball.x);
  assert.ok(auditTrace(glass).includes("Disc crosses curved glass"));
});
