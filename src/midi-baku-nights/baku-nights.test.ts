import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseMidi } from "../midi/parse.ts";
import { buildSceneData, pieceTime } from "../midi/timeline.ts";
import { createBakuNightsPainter } from "./paint.ts";
import { MIDI_BAKU_NIGHTS } from "./scene.ts";
import {
  bakuEventStateAt,
  buildBakuEvents,
  BUILDINGS,
  buildSkylineWindows,
  LAMPLIGHTER_X,
  lamplighterPoseAt,
  lampHeightForPitch,
  lampXAt,
  POLE_REST_TIP_X,
  POLE_REST_TIP_Y,
  STAGE,
} from "./sim.ts";

const MIDI_PATH = new URL("../../public/midi/baku-nights.mid", import.meta.url);
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

test("Baku Nights uses quiet brand layer, Original subtitle, and symmetric 96-window stage geometry", () => {
  assert.equal(MIDI_BAKU_NIGHTS.brand, "quiet");
  assert.equal(MIDI_BAKU_NIGHTS.defaultTitle, "Baku Nights");
  assert.equal(MIDI_BAKU_NIGHTS.label, "Original \u00b7 lyrical nocturne");
  assert.equal(STAGE.left, 50);
  assert.equal(STAGE.right, 1030);
  assert.equal((STAGE.left + STAGE.right) / 2, 540);
  assert.equal((STAGE.top + STAGE.bottom) / 2, 970);

  const windows = buildSkylineWindows();
  assert.equal(windows.length, 96);
  // Skyline buildings are strictly mirror-symmetric around x = 540
  for (let i = 0; i < BUILDINGS.length; i++) {
    const a = BUILDINGS[i];
    const b = BUILDINGS[BUILDINGS.length - 1 - i];
    assert.equal(a.left + b.right, 1080);
    assert.equal(a.right + b.left, 1080);
    assert.equal(a.top, b.top);
  }
});

test("1-to-1 streetlamp, skyline window, bass swell, and brush events ignite within one frame of note-on", () => {
  const scene = buildSceneData(
    PARSED,
    "baku-nights.mid",
    { fps: FPS, leadFrames: MIDI_BAKU_NIGHTS.leadFrames, tailSec: MIDI_BAKU_NIGHTS.tailSec ?? 2.2 },
    { width: 1080, height: 1920 },
    MIDI_BAKU_NIGHTS.defaultTitle,
  );
  const windows = buildSkylineWindows();
  const events = buildBakuEvents(PARSED.notes, windows);
  assert.equal(events.length, PARSED.notes.length, "exact 1-to-1 visual event count");

  for (const ev of events) {
    const onFrame = scene.leadFrames + Math.ceil(ev.tOn * FPS - 1e-9);
    const atOn = bakuEventStateAt(ev, pieceTime(scene, onFrame));
    const beforeOn = bakuEventStateAt(ev, pieceTime(scene, onFrame - 1));
    assert.ok(atOn && atOn.active, `event ${ev.index} (${ev.role}) active on landing frame ${onFrame}`);
    assert.equal(beforeOn, null, `event ${ev.index} not yet active one frame earlier`);
    if (ev.role === "lead") {
      // Streetlamp reaches x = 540 within < 3 px on its landing frame, and higher pitch = higher lantern (smaller y)
      assert.ok(Math.abs(lampXAt(ev, pieceTime(scene, onFrame)) - LAMPLIGHTER_X) < 3.0);
    }
  }
  assert.ok(lampHeightForPitch(80) < lampHeightForPitch(62), "higher pitch maps to taller streetlamp");
});

test("lamplighter brass pole kisses each lamp at onset and returns cleanly to loop rest pose", () => {
  const windows = buildSkylineWindows();
  const lead = buildBakuEvents(PARSED.notes, windows).filter((e) => e.role === "lead");
  const leadSec = MIDI_BAKU_NIGHTS.leadFrames / FPS;
  const tailSec = MIDI_BAKU_NIGHTS.tailSec ?? 2.2;

  const p0 = lamplighterPoseAt(lead, -leadSec, leadSec, PARSED.durationSec, tailSec, 0);
  const pEnd = lamplighterPoseAt(lead, PARSED.durationSec + tailSec - 1 / FPS, leadSec, PARSED.durationSec, tailSec, Math.PI * 2);
  assert.ok(Math.abs(p0.poleTipX - POLE_REST_TIP_X) < 1e-6 && Math.abs(p0.poleTipY - POLE_REST_TIP_Y) < 1e-6);
  assert.ok(Math.abs(pEnd.poleTipX - POLE_REST_TIP_X) < 1e-3 && Math.abs(pEnd.poleTipY - POLE_REST_TIP_Y) < 1e-3);

  // At each lead note onset, the brass pole tip meets the lantern height within a few pixels
  for (const ev of lead.slice(0, 12)) {
    const pose = lamplighterPoseAt(lead, ev.tOn, leadSec, PARSED.durationSec, tailSec, 0.5);
    assert.ok(Math.abs(pose.poleTipY - ev.y) < 2.0, `pole tip ${pose.poleTipY} meets lamp ${ev.y}`);
  }
});

test("Baku Nights painter is deterministic and renders cleanly across timeline", () => {
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const scene = buildSceneData(
    PARSED,
    "baku-nights.mid",
    { fps: FPS, leadFrames: MIDI_BAKU_NIGHTS.leadFrames, tailSec: MIDI_BAKU_NIGHTS.tailSec ?? 2.2 },
    { width: 1080, height: 1920 },
    MIDI_BAKU_NIGHTS.defaultTitle,
  );
  const painter = createBakuNightsPainter(scene, MIDI_BAKU_NIGHTS.label);
  const { ctx, calls, texts } = mockContext();
  for (const f of [0, 30, 60, 480, 1300, 2100, 2700, scene.totalFrames - 1]) painter(ctx, f);
  assert.ok((calls.fillRect ?? 0) > 0);
  assert.ok(texts.includes("Baku Nights") && texts.includes("Original \u00b7 lyrical nocturne"));
  for (const s of texts) assert.ok(!/shur|rast|segah/i.test(s), `on-video text must not name modes: ${s}`);
});
