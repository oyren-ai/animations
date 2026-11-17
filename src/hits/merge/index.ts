import { digestMerge, simulateMerge, type MergeTrace } from "./sim.ts";
import { HIT_SEED, type HitComposition } from "../types.ts";
import { buildMergeAudio } from "./audio.ts";
import { paintMerge } from "./paint.ts";
import { MERGE_SPEC } from "./spec.ts";

export { MERGE_SPEC };

/**
 * FunnelMerge: pieces leave a top tube at random angles, only tier 1 drops, two of the same tier merge
 * into the next, chains stack a CHAIN multiplier, and the first tier-7 piece is the final form.
 */
export const funnelMerge: HitComposition<MergeTrace> = {
  spec: MERGE_SPEC,
  simulate: (seed: number = HIT_SEED) => simulateMerge(seed),
  digest: digestMerge,
  buildAudio: buildMergeAudio,
  paint: paintMerge,
};
