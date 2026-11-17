import { makeStubHit } from "../stub.ts";
import { makeHitSpec } from "../types.ts";

export const BRICK_SPEC = makeHitSpec({
  id: "BrickEscape",
  slug: "brick-escape",
  question: "Will it get out in time?",
  rule: "Every bounce lays a brick. Every brick shrinks the exit.",
  sceneSeconds: 24,
  description:
    "Full-screen chamber: one ball, bricks pile up on every bounce, the exit shrinks, and each bounce plays the next note of a public-domain tune.",
});

export const brickEscape = makeStubHit(BRICK_SPEC);
