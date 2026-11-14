import assert from "node:assert/strict";
import test from "node:test";
import { bobAt, WAVE } from "./wave.ts";

test("every oscillator returns to its start after one loop", () => {
  for (let index = 0; index < WAVE.count; index++) {
    const start = bobAt(index, 0), end = bobAt(index, WAVE.period);
    assert.ok(Math.hypot(end.x - start.x, end.y - start.y) < 1e-8);
    assert.ok(Math.hypot(end.vx - start.vx, end.vy - start.vy) < 1e-8);
  }
});

test("the trajectory retains string length and its exact derivative", () => {
  for (let index = 0; index < WAVE.count; index++) {
    const time = 0.413, h = 1e-6, p = bobAt(index, time);
    assert.ok(Math.abs(Math.hypot(p.x - WAVE.pivot.x, p.y - WAVE.pivot.y) - p.length) < 1e-8);
    const a = bobAt(index, time - h), b = bobAt(index, time + h);
    assert.ok(Math.abs((b.x - a.x) / (2 * h) - p.vx) < 1e-5);
    assert.ok(Math.abs((b.y - a.y) / (2 * h) - p.vy) < 1e-5);
  }
});

test("invalid oscillator indices fail explicitly", () => {
  for (const index of [-1, WAVE.count, NaN, 1.5]) assert.throws(() => bobAt(index, 0), /index/);
});
