import assert from "node:assert/strict";
import test from "node:test";
import { measureStereoLufsAndPeak } from "../audio-reactive/synth.ts";
import { assertReelSafeBox, REEL_SAFE_BOUNDS, type ReelBox } from "../shared/reelUtils.ts";
import {
  CTA_LINES,
  clamp,
  createRng,
  digestNumbers,
  drawChrome,
  fillBackdrop,
  fnv1a,
  formatCount,
  smoothstep,
  wrapQuestion,
} from "./kit.ts";
import { createMockCanvas } from "./mockCanvas.ts";
import { HIT_CLOSING_FRAMES, HIT_MAX_TOTAL_SECONDS, HIT_SEED, makeHitSpec } from "./types.ts";
import {
  addBell,
  addSoftPad,
  addThud,
  addTick,
  addWhoosh,
  brightnessRatio,
  finishHitAudio,
  newHitBuffer,
  noteHz,
  PENTATONIC_MAJOR,
  scaleMidi,
  thinEvents,
} from "./voices.ts";

test("createRng is deterministic, in range, and different seeds differ", () => {
  const a = createRng(HIT_SEED);
  const b = createRng(HIT_SEED);
  const c = createRng(HIT_SEED + 1);
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  const seqC = Array.from({ length: 50 }, () => c.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
  const r = createRng(5);
  for (let i = 0; i < 200; i++) {
    const x = r.range(-3, 7);
    assert.ok(x >= -3 && x < 7);
    const n = r.int(10);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 10);
    const s = r.sign();
    assert.ok(s === 1 || s === -1);
  }
  assert.equal(createRng(1).pick(["only"]), "only");
});

test("number helpers behave", () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.equal(formatCount(10000), "10,000");
  assert.equal(formatCount(1), "1");
  assert.equal(fnv1a("oyren"), fnv1a("oyren"));
  assert.notEqual(fnv1a("oyren"), fnv1a("oyrex"));
  assert.equal(fnv1a("").length, 8);
  assert.equal(digestNumbers(new Float32Array([1, 2, 3])), digestNumbers([1, 2, 3]));
  assert.notEqual(digestNumbers([1, 2, 3]), digestNumbers([1, 2, 4]));
});

test("noteHz and scaleMidi map notes the way a musician expects", () => {
  assert.equal(noteHz(69), 440);
  assert.ok(Math.abs(noteHz(81) - 880) < 1e-9);
  assert.equal(scaleMidi(60, PENTATONIC_MAJOR, 0), 60);
  assert.equal(scaleMidi(60, PENTATONIC_MAJOR, 4), 69);
  assert.equal(scaleMidi(60, PENTATONIC_MAJOR, 5), 72);
  assert.equal(scaleMidi(60, PENTATONIC_MAJOR, -1), 57);
});

test("wrapQuestion keeps short questions whole and splits long ones into two balanced lines", () => {
  assert.deepEqual(wrapQuestion("Will it overflow?"), ["Will it overflow?"]);
  const lines = wrapQuestion("Will it merge into its final form?");
  assert.equal(lines.length, 2);
  assert.equal(lines.join(" "), "Will it merge into its final form?");
  assert.ok(Math.abs(lines[0].length - lines[1].length) <= 8);
});

test("drawChrome draws the hook, the rule, the CTA and the seed inside the reel safe bounds", () => {
  const spec = makeHitSpec({
    id: "KitProbe",
    slug: "kit-probe",
    question: "Will it merge into its final form?",
    rule: "Two of the same tier merge into the next. Only tier 1 drops.",
    sceneSeconds: 20,
    description: "probe",
  });
  const { ctx, texts } = createMockCanvas();
  const boxes: ReelBox[] = [];
  const layout = drawChrome(ctx, boxes, spec);
  const drawn = texts.map((t) => t.text);
  assert.ok(drawn.join(" ").includes(spec.question), "question is on screen");
  assert.ok(drawn.includes(spec.rule), "rule line is on screen");
  assert.ok(drawn.includes(CTA_LINES[0]) && drawn.includes(CTA_LINES[1]), "CTA lines are on screen");
  assert.ok(drawn.some((t) => t.includes(`seed ${HIT_SEED}`)), "seed footer is on screen");
  assert.ok(boxes.length >= 5);
  for (const box of boxes) assertReelSafeBox(box);
  assert.ok(layout.counterY > layout.ruleY);
  assert.ok(layout.counterY < REEL_SAFE_BOUNDS.bottom - 400, "counters leave room above the CTA block");
});

test("fillBackdrop covers the whole 1080x1920 canvas", () => {
  const { ctx, fillRects } = createMockCanvas();
  fillBackdrop(ctx, 0);
  assert.ok(fillRects.some((r) => r.x === 0 && r.y === 0 && r.w === 1080 && r.h === 1920));
});

test("makeHitSpec adds the 3 s closing card and stays under the length cap", () => {
  const spec = makeHitSpec({
    id: "A",
    slug: "a",
    question: "q?",
    rule: "r.",
    sceneSeconds: 24,
    description: "d",
  });
  assert.equal(spec.sceneFrames, 1440);
  assert.equal(spec.totalFrames, 1440 + HIT_CLOSING_FRAMES);
  assert.ok(spec.totalFrames / 60 <= HIT_MAX_TOTAL_SECONDS);
});

test("thinEvents caps a dense burst and keeps time order", () => {
  const dense = Array.from({ length: 300 }, (_, i) => ({ t: i / 100 })); // 100 events per second for 3 s
  const thinned = thinEvents(dense, 10);
  assert.ok(thinned.length <= 31 && thinned.length >= 28, `kept ${thinned.length}`);
  for (let i = 1; i < thinned.length; i++) assert.ok(thinned[i].t - thinned[i - 1].t >= 0.1 - 1e-9);
});

test("a busy voice mix stays warm and masters to -14 LUFS with at most -1.5 dBTP", () => {
  const buf = newHitBuffer(600); // 10 s
  const rng = createRng(HIT_SEED);
  for (let i = 0; i < 60; i++) {
    const t = 0.2 + i * 0.15;
    addBell(buf, {
      t,
      freq: noteHz(scaleMidi(60, PENTATONIC_MAJOR, i % 12)),
      gain: 0.18,
      pan: rng.range(-0.8, 0.8),
    });
  }
  for (let i = 0; i < 20; i++) addTick(buf, { t: 0.3 + i * 0.45, pan: rng.range(-0.7, 0.7) });
  for (let i = 0; i < 6; i++) addThud(buf, { t: 0.5 + i * 1.5, gain: 0.4 });
  addWhoosh(buf, { t: 6, durSec: 2.5, gain: 0.25, fromHz: 200, toHz: 1400 });
  addSoftPad(buf, { startSec: 0, durSec: 10, freqs: [noteHz(48), noteHz(55), noteHz(64)], gain: 0.09 });
  assert.ok(brightnessRatio(buf) < 0.04, `too bright: ${brightnessRatio(buf)}`);
  const audio = finishHitAudio(buf);
  const m = measureStereoLufsAndPeak(audio.buffer.left, audio.buffer.right);
  assert.ok(m.integratedLufs >= -15 && m.integratedLufs <= -13, `LUFS ${m.integratedLufs}`);
  assert.ok(m.truePeakDb <= -1.5, `true peak ${m.truePeakDb}`);
  const view = new DataView(audio.wav.buffer, audio.wav.byteOffset, audio.wav.byteLength);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(audio.wav.byteLength, 44 + 10 * 48000 * 4);
});
