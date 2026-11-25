import assert from "node:assert/strict";
import test from "node:test";
import { createRenderGate } from "./renderGate.ts";

test("a completed font load resumes its pending render once", () => {
  const resumed: number[] = [];
  let next = 0;
  const gate = createRenderGate(() => ++next, (handle) => resumed.push(handle), () => assert.fail("unexpected render cancellation"));
  gate.start();
  gate.release();
  gate.release(); // later unmount cleanup must be harmless
  assert.deepEqual(resumed, [1]);
});

test("an unmount during font loading releases its handle, including an effect replay", () => {
  const resumed: number[] = [];
  let next = 0;
  const gate = createRenderGate(() => ++next, (handle) => resumed.push(handle), () => assert.fail("unexpected render cancellation"));
  gate.start();
  gate.release(); // cleanup before the font promise settles
  gate.start(); // React can replay effects in development
  gate.release();
  assert.deepEqual(resumed, [1, 2]);
});

test("font failure cancels the render without a second release on unmount", () => {
  const resumed: number[] = [];
  const cancelled: Error[] = [];
  const gate = createRenderGate(() => 42, (handle) => resumed.push(handle), (error) => cancelled.push(error));
  const failure = new Error("font unavailable");
  gate.start();
  gate.fail(failure);
  gate.release();
  assert.deepEqual(resumed, []);
  assert.deepEqual(cancelled, [failure]);
});
