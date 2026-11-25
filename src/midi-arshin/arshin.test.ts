import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseMidi } from "../midi/parse.ts";
import { buildSceneData, pieceTime } from "../midi/timeline.ts";
import { createArshinPainter } from "./paint.ts";
import { MIDI_ARSHIN_MAL_ALAN } from "./scene.ts";
import {
  arshinEventStateAt,
  buildArshinEvents,
  PEDDLER_X,
  peddlerPoseAt,
  STAGE,
  STICK_REST_Y,
} from "./sim.ts";

const MIDI_PATH = new URL("../../public/midi/arshin-mal-alan-askars-song.mid", import.meta.url);
const PARSED = parseMidi(readFileSync(MIDI_PATH));
const FPS = 60;

function mockContext() {
  const calls: Record<string, number> = {};
  const texts: string[] = [];
  let font = "600 20px sans-serif";
  const gradient = { addColorStop() {} };
  const target: Record<string, unknown> = {
    get font() { return font; },
    set font(v: string) { font = v; },
    measureText(text: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 20);
      return { width: text.length * size * 0.52 };
    },
    fillText(text: string) {
      texts.push(String(text));
      calls.fillText = (calls.fillText ?? 0) + 1;
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
  return { ctx, calls, texts };
}

test("Arshin Mal Alan uses unchanged quiet brand layer, exact two-line caption, and framing-standard stage", () => {
  assert.equal(MIDI_ARSHIN_MAL_ALAN.brand, "quiet");
  assert.equal(MIDI_ARSHIN_MAL_ALAN.defaultTitle, "Arshin Mal Alan");
  assert.equal(MIDI_ARSHIN_MAL_ALAN.label, "Uzeyir Hajibeyov, 1913");
  assert.equal(STAGE.left, 50);
  assert.equal(STAGE.right, 1030);
  assert.equal((STAGE.left + STAGE.right) / 2, 540);
  assert.equal(PEDDLER_X, 540);
  assert.equal((STAGE.top + STAGE.bottom) / 2, 970);
});

test("1-to-1 silk-snip, tar chime, brass lantern, bass cord, and naghara events fire within one frame of note-on", () => {
  const scene = buildSceneData(
    PARSED,
    "arshin-mal-alan-askars-song.mid",
    { fps: FPS, leadFrames: MIDI_ARSHIN_MAL_ALAN.leadFrames, tailSec: MIDI_ARSHIN_MAL_ALAN.tailSec ?? 2.2 },
    { width: 1080, height: 1920 },
    MIDI_ARSHIN_MAL_ALAN.defaultTitle,
  );
  const { events } = buildArshinEvents(PARSED.notes);
  assert.equal(events.length, PARSED.notes.length, "exact 1-to-1 physical event count");

  for (const ev of events) {
    const onFrame = scene.leadFrames + Math.ceil(ev.tOn * FPS - 1e-9);
    const atOn = arshinEventStateAt(ev, pieceTime(scene, onFrame));
    const beforeOn = arshinEventStateAt(ev, pieceTime(scene, onFrame - 1));
    assert.ok(atOn && atOn.active, `event ${ev.index} (${ev.role}) active on landing frame ${onFrame}`);
    assert.equal(beforeOn, null, `event ${ev.index} not yet active one frame earlier`);
  }
});

test("peddler brass arshin stick returns to exact loop rest pose and canvas renders ONLY the two required caption lines", () => {
  const { events, foldAwayStartSec } = buildArshinEvents(PARSED.notes);
  const melody = events.filter((e) => e.role === "melody");
  const leadSec = MIDI_ARSHIN_MAL_ALAN.leadFrames / FPS;
  const tailSec = MIDI_ARSHIN_MAL_ALAN.tailSec ?? 2.2;

  const p0 = peddlerPoseAt(melody, -leadSec, leadSec, foldAwayStartSec, PARSED.durationSec, tailSec);
  const pEnd = peddlerPoseAt(melody, PARSED.durationSec + tailSec - 1 / FPS, leadSec, foldAwayStartSec, PARSED.durationSec, tailSec);
  assert.ok(Math.abs(p0.stickY - STICK_REST_Y) < 1e-6 && Math.abs(p0.foldPull) < 1e-6);
  assert.ok(Math.abs(pEnd.stickY - STICK_REST_Y) < 1e-3 && Math.abs(pEnd.foldPull) < 1e-3);

  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const scene = buildSceneData(
    PARSED,
    "arshin-mal-alan-askars-song.mid",
    { fps: FPS, leadFrames: MIDI_ARSHIN_MAL_ALAN.leadFrames, tailSec },
    { width: 1080, height: 1920 },
    MIDI_ARSHIN_MAL_ALAN.defaultTitle,
  );
  const painter = createArshinPainter(scene, MIDI_ARSHIN_MAL_ALAN.label);
  const { ctx, calls, texts } = mockContext();
  for (const f of [0, 24, 42, 420, 1200, 2100, 2700, scene.totalFrames - 1]) painter(ctx, f);
  assert.ok((calls.fillRect ?? 0) > 0);

  // Brief rule: Captions: the title "Arshin Mal Alan" and a small second line "Uzeyir Hajibeyov, 1913". Nothing else.
  const uniqueTexts = [...new Set(texts)];
  assert.deepEqual(uniqueTexts, ["Arshin Mal Alan", "Uzeyir Hajibeyov, 1913"]);
});
