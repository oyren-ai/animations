import { drawChrome, fillBackdrop, fillHudScrims, fnv1a } from "./kit.ts";
import type { HitComposition, HitSpec } from "./types.ts";
import type { ReelBox } from "../shared/reelUtils.ts";
import { addSoftPad, finishHitAudio, newHitBuffer, noteHz } from "./voices.ts";

/**
 * A placeholder that satisfies only the structural contract (hook, rule, CTA, safe text, audio).
 * A real composition replaces its stub and drops `status: "stub"`.
 */
export function makeStubHit(spec: HitSpec): HitComposition<{ sceneFrames: number }> {
  return {
    spec,
    status: "stub",
    simulate: () => ({ sceneFrames: spec.sceneFrames }),
    digest: (trace) => fnv1a(JSON.stringify(trace)),
    buildAudio: () => {
      const buf = newHitBuffer(spec.totalFrames);
      addSoftPad(buf, {
        startSec: 0,
        durSec: spec.totalFrames / 60,
        freqs: [noteHz(48), noteHz(55), noteHz(64)],
        gain: 0.1,
      });
      return finishHitAudio(buf);
    },
    paint: (ctx, _trace, frame) => {
      const boxes: ReelBox[] = [];
      fillBackdrop(ctx, frame);
      fillHudScrims(ctx);
      drawChrome(ctx, boxes, spec);
      return boxes;
    },
  };
}
