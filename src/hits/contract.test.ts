import assert from "node:assert/strict";
import test from "node:test";
import { measureStereoLufsAndPeak } from "../audio-reactive/synth.ts";
import { assertReelSafeBox, type ReelBox } from "../shared/reelUtils.ts";
import { HIT_COMPOSITIONS, getHit, synthesizeHitWav } from "./index.ts";
import { CTA_LINES } from "./kit.ts";
import { createMockCanvas } from "./mockCanvas.ts";
import {
  HIT_CLOSING_FRAMES,
  HIT_MAX_TOTAL_SECONDS,
  HIT_MIN_SCENE_SECONDS,
  HIT_SEED,
  type AnyHitComposition,
} from "./types.ts";
import { brightnessRatio } from "./voices.ts";

/**
 * The universal acceptance gate. Every hit composition must pass these rules before its own
 * specific tests matter: a frame-0 hook, a rule on screen, full-bleed art, safe text,
 * deterministic simulation, and warm stereo audio at -14 LUFS.
 */

const traceCache = new Map<string, unknown>();
function built(comp: AnyHitComposition): { trace: unknown } {
  if (!traceCache.has(comp.spec.slug)) traceCache.set(comp.spec.slug, comp.simulate(HIT_SEED));
  return { trace: traceCache.get(comp.spec.slug) };
}

test("the registry lists exactly four hit compositions with unique ids and slugs", () => {
  assert.equal(HIT_COMPOSITIONS.length, 4);
  assert.equal(new Set(HIT_COMPOSITIONS.map((c) => c.spec.id)).size, 4);
  assert.equal(new Set(HIT_COMPOSITIONS.map((c) => c.spec.slug)).size, 4);
  for (const comp of HIT_COMPOSITIONS) assert.equal(getHit(comp.spec.slug), comp);
  assert.throws(() => getHit("no-such-hit"));
  const first = HIT_COMPOSITIONS[0];
  assert.equal(synthesizeHitWav(first.spec.slug).byteLength, 44 + (first.spec.totalFrames / 60) * 48000 * 4);
});

for (const comp of HIT_COMPOSITIONS) {
  const { spec } = comp;

  test(`${spec.id}: length fits the short-video window and ends on the 3 s Oyren card`, () => {
    assert.equal(spec.totalFrames, spec.sceneFrames + HIT_CLOSING_FRAMES);
    assert.ok(spec.sceneFrames / 60 >= HIT_MIN_SCENE_SECONDS, `scene ${spec.sceneFrames / 60} s is too short`);
    assert.ok(spec.totalFrames / 60 <= HIT_MAX_TOTAL_SECONDS, `total ${spec.totalFrames / 60} s is too long`);
    assert.ok(spec.question.endsWith("?"), "frame 0 asks a question");
    assert.ok(spec.rule.length > 10 && spec.rule.length <= 64, "one short rule line that stays readable at 24 px or more");
  });

  test(`${spec.id}: the simulation is deterministic for the fixed seed`, () => {
    const a = comp.digest(comp.simulate(HIT_SEED));
    const b = comp.digest(comp.simulate(HIT_SEED));
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{8}$/);
  });

  test(`${spec.id}: frame 0 shows the question, the rule, the CTA and the seed inside the safe bounds on a full-canvas backdrop`, () => {
    const { trace } = built(comp);
    const mock = createMockCanvas();
    const boxes = comp.paint(mock.ctx, trace, 0);
    const drawn = mock.texts.map((t) => t.text);
    assert.ok(drawn.join(" ").includes(spec.question), "question is drawn at frame 0");
    assert.ok(drawn.join(" ").includes(spec.rule), "rule is drawn at frame 0 (it may wrap onto two lines)");
    assert.ok(drawn.includes(CTA_LINES[0]) && drawn.includes(CTA_LINES[1]), "small CTA line is drawn");
    assert.ok(drawn.some((t) => t.includes(`seed ${HIT_SEED}`)), "seed is shown");
    assert.ok(
      mock.fillRects.some((r) => r.x <= 0 && r.y <= 0 && r.w >= 1080 && r.h >= 1920),
      "a 0..1080 x 0..1920 backdrop is painted",
    );
    assert.ok(boxes.length >= 5);
    for (const box of boxes) assertReelSafeBox(box);
  });

  test(`${spec.id}: sampled frames keep every text box safe and, once ready, fill the whole canvas`, () => {
    const { trace } = built(comp);
    const frames = [0, 30, Math.round(spec.sceneFrames * 0.25), Math.round(spec.sceneFrames * 0.5),
      Math.round(spec.sceneFrames * 0.75), spec.sceneFrames - 90, spec.sceneFrames - 1];
    for (const f of frames) {
      const mock = createMockCanvas();
      const boxes: ReelBox[] = comp.paint(mock.ctx, trace, f);
      for (const box of boxes) assertReelSafeBox(box);
      assert.ok(mock.fillRects.some((r) => r.w >= 1080 && r.h >= 1920), `frame ${f} paints a full backdrop`);
      if (f >= spec.sceneFrames * 0.5) {
        const coverage = mock.coverageGrid(6, 10);
        assert.ok(coverage >= 0.5, `frame ${f}: action reaches only ${(coverage * 100).toFixed(0)}% of a 6x10 grid`);
      }
    }
  });

  test(`${spec.id}: audio is 48 kHz stereo at about -14 LUFS, at most -1.5 dBTP, warm, and browser-safe`, () => {
    const saved = (globalThis as Record<string, unknown>).Buffer;
    try {
      (globalThis as Record<string, unknown>).Buffer = undefined;
      const trace = comp.simulate(HIT_SEED);
      const audio = comp.buildAudio(trace);
      const view = new DataView(audio.wav.buffer, audio.wav.byteOffset, audio.wav.byteLength);
      assert.equal(view.getUint16(22, true), 2, "stereo");
      assert.equal(view.getUint32(24, true), 48000, "48 kHz");
      assert.equal(audio.wav.byteLength, 44 + (spec.totalFrames / 60) * 48000 * 4, "covers the whole video");
      const m = measureStereoLufsAndPeak(audio.buffer.left, audio.buffer.right);
      assert.ok(m.integratedLufs >= -15 && m.integratedLufs <= -13, `LUFS ${m.integratedLufs.toFixed(2)}`);
      assert.ok(m.truePeakDb <= -1.5, `true peak ${m.truePeakDb.toFixed(2)} dBTP`);
      assert.ok(brightnessRatio(audio.buffer) < 0.04, `too bright: ${brightnessRatio(audio.buffer).toFixed(4)}`);
    } finally {
      (globalThis as Record<string, unknown>).Buffer = saved;
    }
  });
}
