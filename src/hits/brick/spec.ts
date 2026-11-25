import { makeHitSpec } from "../types.ts";

/** Kept in its own module so the painter can draw the question and rule without importing the composition. */
export const BRICK_SPEC = makeHitSpec({
  id: "BrickEscape",
  slug: "brick-escape",
  question: "Will it get out in time?",
  rule: "Every bounce lays a brick. Every brick shrinks the exit.",
  sceneSeconds: 24,
  description:
    "Full-screen chamber: one ball, bricks pile up on every bounce, the exit shrinks, and each bounce plays the next note of a public-domain tune.",
});
