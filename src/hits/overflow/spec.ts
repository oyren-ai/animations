import { makeHitSpec } from "../types.ts";

export const OVERFLOW_SPEC = makeHitSpec({
  id: "OverflowArena",
  slug: "overflow-arena",
  question: "Will it overflow?",
  rule: "Every hit splits the ball.",
  sceneSeconds: 22,
  description:
    "Full-screen sealed chamber: one ball, a spinning crusher, every hit splits a ball until 10,000 balls burst the walls.",
});
