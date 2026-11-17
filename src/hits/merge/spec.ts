import { makeHitSpec } from "../types.ts";

/** Kept in its own file so the painter and the audio can read the question and rule without importing the composition. */
export const MERGE_SPEC = makeHitSpec({
  id: "FunnelMerge",
  slug: "funnel-merge",
  question: "Will it merge into its final form?",
  rule: "Two of the same tier merge into the next. Only tier 1 drops.",
  sceneSeconds: 24,
  description:
    "Full-screen funnel: only tier-1 pieces drop, same-tier pieces merge into the next tier, chains stack a multiplier, and the final form appears.",
});
