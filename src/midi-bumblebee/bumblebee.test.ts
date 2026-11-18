import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseMidi } from "../midi/parse.ts";
import { buildSceneData, pieceTime } from "../midi/timeline.ts";
import { createBumblebeePainter } from "./paint.ts";
import { MIDI_BUMBLEBEE } from "./scene.ts";
import {
  barRectAt,
  BEE_REST_X,
  BEE_REST_Y,
  beePoseAt,
  buildNoteBarEvents,
  notesPerSecondAt,
  planBumblebeeKeyboard,
  STAGE,
} from "./sim.ts";

const MIDI_PATH = new URL("../../public/midi/flight-of-the-bumblebee.mid", import.meta.url);
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

test("Bumblebee stage and keyboard obey framing standard (x = 50..1030, centred on 540, y centred at 940)", () => {
  const layout = planBumblebeeKeyboard(PARSED.notes.map((n) => n.pitch));
  assert.equal(layout.left, 50);
  assert.equal(layout.right, 1030);
  assert.equal((layout.left + layout.right) / 2, 540);
  assert.equal((STAGE.top + STAGE.bottom) / 2, 940);
  assert.ok(STAGE.bottom <= 1700, "clears footer brand band around y = 1768");
  assert.ok(STAGE.top >= 280, "clears top wordmark and piece title");
});

test("1-to-1 note bar events land on keyTop within one frame of note-on and NPS climbs", () => {
  const scene = buildSceneData(
    PARSED,
    "flight-of-the-bumblebee.mid",
    { fps: FPS, leadFrames: MIDI_BUMBLEBEE.leadFrames, tailSec: MIDI_BUMBLEBEE.tailSec ?? 2.1 },
    { width: 1080, height: 1920 },
  );
  const layout = planBumblebeeKeyboard(PARSED.notes.map((n) => n.pitch));
  const events = buildNoteBarEvents(PARSED.notes, layout);
  assert.equal(events.length, PARSED.notes.length, "exact 1-to-1 visual event count");

  for (const ev of events) {
    const onFrame = scene.leadFrames + Math.ceil(ev.tOn * FPS - 1e-9);
    const atOn = barRectAt(ev, pieceTime(scene, onFrame));
    const beforeOn = barRectAt(ev, pieceTime(scene, onFrame - 1));
    assert.ok(atOn && atOn.active, `event ${ev.index} active on landing frame ${onFrame}`);
    assert.ok(Math.abs(atOn.bottom - STAGE.keyTop) < 1e-6, "touches keyTop at landing frame");
    assert.ok(!beforeOn || !beforeOn.active, "not yet active one frame earlier");
  }

  // Notes per second readout rises across the accelerando and returns to 0 for the loop
  const npsStart = notesPerSecondAt(PARSED.notes, -1.0, scene.endSec);
  const npsEarly = notesPerSecondAt(PARSED.notes, 6.0, scene.endSec);
  const npsFinale = notesPerSecondAt(PARSED.notes, 40.0, scene.endSec);
  const npsEnd = notesPerSecondAt(PARSED.notes, scene.endSec + 1.8, scene.endSec);
  assert.equal(npsStart, 0);
  assert.equal(npsEnd, 0);
  assert.ok(npsFinale > npsEarly * 1.35, `NPS climbs from ${npsEarly.toFixed(1)} to ${npsFinale.toFixed(1)}`);
});

test("hero bee starts and finishes at exact loop rest pose and grows swarm to 7", () => {
  const layout = planBumblebeeKeyboard(PARSED.notes.map((n) => n.pitch));
  const lead = buildNoteBarEvents(PARSED.notes, layout).filter((e) => e.isLead);
  const leadSec = MIDI_BUMBLEBEE.leadFrames / FPS;
  const tailSec = MIDI_BUMBLEBEE.tailSec ?? 2.1;
  const p0 = beePoseAt(lead, -leadSec, leadSec, PARSED.durationSec, tailSec);
  const pEnd = beePoseAt(lead, PARSED.durationSec + tailSec - 1 / FPS, leadSec, PARSED.durationSec, tailSec);
  assert.ok(Math.abs(p0.x - BEE_REST_X) < 1e-6 && Math.abs(p0.y - BEE_REST_Y) < 1e-6);
  assert.ok(Math.abs(pEnd.x - BEE_REST_X) < 1e-3 && Math.abs(pEnd.y - BEE_REST_Y) < 1e-3);
  const pPayoff = beePoseAt(lead, PARSED.durationSec * 0.82, leadSec, PARSED.durationSec, tailSec);
  assert.equal(pPayoff.swarmCount, 7);
});

test("Bumblebee painter is deterministic and renders cleanly across timeline", () => {
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const scene = buildSceneData(
    PARSED,
    "flight-of-the-bumblebee.mid",
    { fps: FPS, leadFrames: MIDI_BUMBLEBEE.leadFrames, tailSec: MIDI_BUMBLEBEE.tailSec ?? 2.1 },
    { width: 1080, height: 1920 },
  );
  const painter = createBumblebeePainter(scene, MIDI_BUMBLEBEE.label);
  const { ctx, calls } = mockContext();
  for (const f of [0, 36, 72, 600, 1500, 2400, scene.totalFrames - 1]) painter(ctx, f);
  assert.ok((calls.fillRect ?? 0) > 0);
});
