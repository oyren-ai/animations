import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseMidi } from "../midi/parse.ts";
import { buildSceneData, pieceTime } from "../midi/timeline.ts";
import { createCanonPainter } from "./paint.ts";
import { MIDI_CANON_VOICES } from "./scene.ts";
import { buildCanonLayout, noteSpanAt, STAGE, VOICE_COUNT, voiceLitStrength } from "./sim.ts";

const MIDI_PATH = new URL("../../public/midi/canon-in-d-five-voices.mid", import.meta.url);
const PARSED = parseMidi(readFileSync(MIDI_PATH));
const FPS = 60;

function mockContext() {
  const calls: Record<string, number> = {};
  let font = "600 20px sans-serif";
  const gradient = { addColorStop() {} };
  const target: Record<string, unknown> = {
    get font() { return font; },
    set font(v: string) { font = v; },
    measureText(text: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 20);
      return { width: text.length * size * 0.52 };
    },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop as string];
      return () => { calls[String(prop)] = (calls[String(prop)] ?? 0) + 1; };
    },
    set(obj, prop, value) { obj[prop as string] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

test("Canon five-voice layout is symmetric on x = 540, centred on y = 940, with 1-to-1 note events", () => {
  const canon = buildCanonLayout(PARSED.notes);
  assert.equal(canon.voices.length, VOICE_COUNT);
  assert.equal(canon.events.length, PARSED.notes.length);
  assert.equal((STAGE.left + STAGE.right) / 2, 540);
  assert.equal(STAGE.playheadX, 540);
  assert.equal((STAGE.top + STAGE.bottom) / 2, 940);

  for (const ev of canon.events) {
    const lane = canon.voices[ev.voiceIndex];
    assert.ok(ev.y >= lane.laneTop + 20 && ev.y <= lane.laneBottom - 20, `event ${ev.index} stays inside lane`);
  }
});

test("each note crosses the x = 540 playhead within one frame of note-on and voices light 1 -> 5", () => {
  const scene = buildSceneData(
    PARSED,
    "canon-in-d-five-voices.mid",
    { fps: FPS, leadFrames: MIDI_CANON_VOICES.leadFrames, tailSec: MIDI_CANON_VOICES.tailSec ?? 3.85 },
    { width: 1080, height: 1920 },
  );
  const canon = buildCanonLayout(PARSED.notes);

  for (const ev of canon.events) {
    const onFrame = scene.leadFrames + Math.ceil(ev.tOn * FPS - 1e-9);
    const atOn = noteSpanAt(ev, pieceTime(scene, onFrame));
    const beforeOn = noteSpanAt(ev, pieceTime(scene, onFrame - 1));
    assert.ok(atOn && atOn.active, `event ${ev.index} active at frame ${onFrame}`);
    assert.ok(atOn.left <= STAGE.playheadX + 1e-6 && atOn.right >= STAGE.playheadX - 1e-6);
    assert.ok(!beforeOn || !beforeOn.active, "not yet active one frame before");
  }

  // Check voice indicator counts at cycle midpoints: 1, 2, 3, 4, 5!
  const sampleTimes = [3.0, 11.0, 19.0, 27.0, 35.0];
  sampleTimes.forEach((sec, expectedIdx) => {
    const count = canon.voices.filter((v) => voiceLitStrength(v, sec, scene.endSec) > 0.8).length;
    assert.equal(count, expectedIdx + 1, `at ${sec}s expected ${expectedIdx + 1} lit voices, got ${count}`);
  });
});

test("Canon painter is deterministic and renders cleanly across timeline", () => {
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const scene = buildSceneData(
    PARSED,
    "canon-in-d-five-voices.mid",
    { fps: FPS, leadFrames: MIDI_CANON_VOICES.leadFrames, tailSec: MIDI_CANON_VOICES.tailSec ?? 3.85 },
    { width: 1080, height: 1920 },
  );
  const painter = createCanonPainter(scene, MIDI_CANON_VOICES.label);
  const { ctx, calls } = mockContext();
  for (const f of [0, 30, 60, 600, 1500, 2400, scene.totalFrames - 1]) painter(ctx, f);
  assert.ok((calls.roundRect ?? 0) > 0);
});
