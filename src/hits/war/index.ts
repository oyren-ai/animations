import { HIT_SEED, makeHitSpec, type HitComposition } from "../types.ts";
import { buildWarAudio } from "./audio.ts";
import { paintWar } from "./paint.ts";
import { digestWar, simulateWar, type WarTrace } from "./sim.ts";

export const WAR_SPEC = makeHitSpec({
  id: "ColourWarV4",
  slug: "colour-war-v4",
  question: "Which colour takes the board?",
  rule: "Balls paint. Every 5 s the smallest colour doubles its balls.",
  sceneSeconds: 24,
  description:
    "Full-screen four-way territory war: one ball per colour paints the board, the smallest colour gets double balls every 5 s, the biggest share wins at 24 s.",
});

export const colourWarV4: HitComposition<WarTrace> = {
  spec: WAR_SPEC,
  simulate: (seed = HIT_SEED) => simulateWar(seed),
  digest: digestWar,
  buildAudio: buildWarAudio,
  paint: (ctx, trace, frame) => paintWar(ctx, WAR_SPEC, trace, frame),
};
