import { HIT_SEED, type HitComposition } from "../types.ts";
import { buildBrickAudio } from "./audio.ts";
import { paintScene } from "./paint.ts";
import { digestBrickTrace, simulateBrick, type BrickTrace } from "./sim.ts";
import { BRICK_SPEC } from "./spec.ts";

export { BRICK_SPEC };

/**
 * BrickEscape: one ball in a sealed full-screen chamber. Every bounce lays a brick on the wall and plays the next
 * note of Ode to Joy; every brick shrinks the exit. Simulation, painter and audio live next to this file.
 */
export const brickEscape: HitComposition<BrickTrace> = {
  spec: BRICK_SPEC,
  simulate: (seed: number = HIT_SEED) => simulateBrick(seed),
  digest: digestBrickTrace,
  buildAudio: buildBrickAudio,
  paint: (ctx, trace, frame) => paintScene(ctx, trace, frame).boxes,
};
