import { brickEscape } from "./brick/index.ts";
import { funnelMerge } from "./merge/index.ts";
import { overflowArena } from "./overflow/index.ts";
import type { AnyHitComposition } from "./types.ts";
import { colourWarV4 } from "./war/index.ts";

export type HitSlug = "overflow-arena" | "brick-escape" | "funnel-merge" | "colour-war-v4";

export const HIT_COMPOSITIONS: readonly AnyHitComposition[] = [
  overflowArena,
  brickEscape,
  funnelMerge,
  colourWarV4,
];

export function getHit(slug: string): AnyHitComposition {
  const hit = HIT_COMPOSITIONS.find((c) => c.spec.slug === slug);
  if (!hit) throw new Error(`Unknown hit composition: ${slug}`);
  return hit;
}

export function synthesizeHitWav(slug: string): Uint8Array {
  const hit = getHit(slug);
  return hit.buildAudio(hit.simulate()).wav;
}
