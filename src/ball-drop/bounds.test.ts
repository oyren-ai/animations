import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeBox, BOWL, bowlY, collideBowl, collideDisc, collideSegment, type Body } from "./bounds.ts";

test("disc contacts separate penetration and reverse inward velocity", () => {
  const ball = { x: 15, y: 0, vx: -100, vy: 0, r: 10 };
  assert.ok(collideDisc(ball, { x: 0, y: 0 }, 10, 1) > 0);
  assert.ok(ball.x >= 20 && ball.vx > 0);
  const centered = { x: 0, y: 0, vx: 0, vy: 50, r: 10 };
  collideDisc(centered, { x: 0, y: 0 }, 10);
  assert.ok(Object.values(centered).every(Number.isFinite));
  assert.ok(Math.hypot(centered.x, centered.y) >= 20);
});

test("moving segments resolve velocity relative to the moving contact", () => {
  const ball = { x: 0, y: -5, vx: 0, vy: 100, r: 5 };
  collideSegment(ball, { a: { x: -30, y: 0 }, b: { x: 30, y: 0 }, omega: 2 });
  assert.ok(ball.y <= -12);
  assert.ok(ball.vy < 60, "surface contact moves downward at 60 px/s");
  assert.throws(() => collideSegment(ball, { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }), /length/);
});

test("normal-offset bowl contacts keep the whole circumference above the glass", () => {
  for (const x of [160, 280, 540, 800, 920]) for (const r of [14, 56, 112]) {
    const ball: Body = { x, y: bowlY(x), r, vx: 0, vy: 200 };
    collideBowl(ball);
    for (let k = 0; k < 256; k++) {
      const angle = k * Math.PI * 2 / 256;
      assert.ok(ball.y + Math.sin(angle) * r <= bowlY(ball.x + Math.cos(angle) * r) + 1e-6);
    }
    const once = { ...ball };
    collideBowl(ball);
    assert.deepEqual(ball, once, "a separated contact stays separated");
  }
});

test("radii beyond the unique normal-offset range are rejected", () => {
  assert.throws(() => collideBowl({ x: 540, y: 1400, vx: 0, vy: 0, r: 1 / (2 * BOWL.curvature) }), /radius/);
  assert.throws(() => collideBowl({ x: 540, y: 1400, vx: 0, vy: 0, r: 0 }), /radius/);
});

const safe = { left: 72, right: 1008, top: 240, bottom: 1660 };
test("measured text can touch the safe boundary", () => assert.deepEqual(assertSafeBox(safe), safe));
for (const change of [{ left: 71 }, { right: 1009 }, { top: 239 }, { bottom: 1661 },
  { left: NaN }, { right: Infinity }, { left: 900, right: 800 }, { top: 900, bottom: 800 }]) {
  test("invalid measured bounds are rejected: " + JSON.stringify(change), () => {
    assert.throws(() => assertSafeBox({ ...safe, ...change }), /safe area/);
  });
}
