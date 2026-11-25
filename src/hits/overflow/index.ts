import { fnv1a } from "../kit.ts";
import { HIT_SEED, type HitComposition } from "../types.ts";
import { buildOverflowAudio } from "./audio.ts";
import { paintOverflowFrame } from "./paint.ts";
import { digestOverflow, simulateOverflow, type OverflowTrace } from "./sim.ts";
import { OVERFLOW_SPEC } from "./spec.ts";

export { OVERFLOW_SPEC };

/** The trace is large; keep the last two so the shell, the audio and the tests share one run. */
const cache = new Map<number, OverflowTrace>();
function cachedTrace(seed: number): OverflowTrace {
  const hit = cache.get(seed);
  if (hit) return hit;
  const trace = simulateOverflow(seed);
  if (cache.size >= 2) cache.delete(cache.keys().next().value as number);
  cache.set(seed, trace);
  return trace;
}

export const overflowArena: HitComposition<OverflowTrace> = {
  spec: OVERFLOW_SPEC,
  simulate: (seed = HIT_SEED) => cachedTrace(seed),
  digest: (trace) => fnv1a(digestOverflow(trace)),
  buildAudio: (trace) => buildOverflowAudio(trace),
  paint: (ctx, trace, frame) => paintOverflowFrame(ctx, trace, frame),
};
