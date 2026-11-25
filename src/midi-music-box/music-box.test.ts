import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseMidi } from "../midi/parse.ts";
import { buildSceneData, pieceTime } from "../midi/timeline.ts";
import { createMusicBoxPainter, MUSIC_BOX_DISPLAY_TITLE } from "./paint.ts";
import { MIDI_FUR_ELISE_MUSIC_BOX } from "./scene.ts";
import {
  buildMusicBoxPlan,
  pieceProgressAt,
  pinPoseAt,
  STAGE,
  toothMotionAt,
} from "./sim.ts";

const MIDI_PATH = new URL("../../public/midi/fur-elise-music-box.mid", import.meta.url);
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
      calls.fillText = (calls.fillText ?? 0) + 1;
      texts.push(text);
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

test("Music box comb and cylinder are symmetric on x = 540, centred on y = 940, with 1-to-1 pin events", () => {
  const plan = buildMusicBoxPlan(PARSED.notes);
  assert.equal(plan.events.length, PARSED.notes.length);
  assert.equal((STAGE.left + STAGE.right) / 2, 540);
  assert.equal((STAGE.cylLeft + STAGE.cylRight) / 2, 540);
  assert.equal((STAGE.top + STAGE.bottom) / 2, 940);

  const firstTooth = plan.teeth[0];
  const lastTooth = plan.teeth[plan.teeth.length - 1];
  assert.ok(Math.abs(0.5 * (firstTooth.x + lastTooth.x) - 540) < 1e-6, "comb teeth span symmetrically about x = 540");
  assert.ok(firstTooth.rootY > lastTooth.rootY, "bass teeth have longer free length than treble teeth");
});

test("every pin reaches contactY and plucks its tooth within one frame of note-on; progress resets on loop", () => {
  const tailSec = MIDI_FUR_ELISE_MUSIC_BOX.tailSec ?? 2.6;
  const scene = buildSceneData(
    PARSED,
    "fur-elise-music-box.mid",
    { fps: FPS, leadFrames: MIDI_FUR_ELISE_MUSIC_BOX.leadFrames, tailSec },
    { width: 1080, height: 1920 },
  );
  const plan = buildMusicBoxPlan(PARSED.notes);

  for (const ev of plan.events) {
    const exactPose = pinPoseAt(ev, ev.tOn);
    assert.ok(exactPose && Math.abs(exactPose.y - STAGE.contactY) < 1e-6, "pin hits contactY at exact note-on");

    const onFrame = scene.leadFrames + Math.ceil(ev.tOn * FPS - 1e-9);
    const toothEvents = plan.byTooth[ev.toothIndex];
    const motionAtOn = toothMotionAt(toothEvents, pieceTime(scene, onFrame));
    assert.ok(motionAtOn.glow > 0.5 && motionAtOn.pluckAge >= -1e-9 && motionAtOn.pluckAge <= 1 / FPS + 1e-6);
  }

  assert.equal(pieceProgressAt(-1, scene.endSec, tailSec), 0);
  assert.ok(pieceProgressAt(scene.endSec * 0.75, scene.endSec, tailSec) > 0.7);
  assert.equal(pieceProgressAt(scene.endSec + tailSec - 0.02, scene.endSec, tailSec), 0);
});

test("Music box painter displays 'Für Elise' with umlaut (ignoring ASCII SMF track name) and renders deterministically", () => {
  assert.equal(MIDI_FUR_ELISE_MUSIC_BOX.defaultTitle, "F\u00fcr Elise");
  assert.equal(MUSIC_BOX_DISPLAY_TITLE, "F\u00fcr Elise");
  assert.equal(PARSED.tracks[0]?.name, "Fur Elise", "SMF conductor track name is 7-bit ASCII");

  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const scene = buildSceneData(
    PARSED,
    "fur-elise-music-box.mid",
    { fps: FPS, leadFrames: MIDI_FUR_ELISE_MUSIC_BOX.leadFrames, tailSec: MIDI_FUR_ELISE_MUSIC_BOX.tailSec ?? 2.6 },
    { width: 1080, height: 1920 },
  );
  const painter = createMusicBoxPainter(scene, MIDI_FUR_ELISE_MUSIC_BOX.label);
  const { ctx, calls, texts } = mockContext();
  for (const f of [0, 33, 66, 600, 1500, 2400, scene.totalFrames - 1]) painter(ctx, f);
  assert.ok((calls.roundRect ?? 0) > 0);
  assert.ok(texts.includes("F\u00fcr Elise"), "draws 'Für Elise' with umlaut");
  assert.ok(!texts.includes("Fur Elise"), "never draws ASCII 'Fur Elise'");
});
