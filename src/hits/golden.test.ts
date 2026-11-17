import assert from "node:assert/strict";
import test from "node:test";
import { HIT_COMPOSITIONS } from "./index.ts";
import { HIT_SEED } from "./types.ts";

/**
 * Cross-platform tripwire for the picture-sound sync.
 *
 * The WAV of every hit video is built in Node, and the picture is simulated again in the render
 * browser. The two only line up if the simulation is bit-exact on both. These digests were taken on
 * Linux with Node 24 and must come out the same on every machine that renders. If a simulation is changed on
 * purpose, rerun it, check the new timeline in the preview, and replace the value here in the same commit.
 */
const GOLDEN: Readonly<Record<string, string>> = {
  "overflow-arena": "d065fb8b",
  "brick-escape": "b9ffd1ca",
  "funnel-merge": "014ed33c",
  "colour-war-v4": "020fed51",
};

test("every hit composition has a golden digest and no stray ones exist", () => {
  const slugs = HIT_COMPOSITIONS.map((c) => c.spec.slug).sort();
  assert.deepEqual(Object.keys(GOLDEN).sort(), slugs);
});

for (const comp of HIT_COMPOSITIONS) {
  test(`${comp.spec.id}: the trace digest for seed ${HIT_SEED} matches the golden value`, () => {
    const digest = comp.digest(comp.simulate(HIT_SEED));
    assert.equal(
      digest,
      GOLDEN[comp.spec.slug],
      `the ${comp.spec.slug} simulation computed a different trajectory (${digest}); its sound would drift from its picture`,
    );
  });
}
