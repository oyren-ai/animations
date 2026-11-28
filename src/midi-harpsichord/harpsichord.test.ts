import assert from "node:assert/strict";
import test from "node:test";
import { parseMidi } from "../midi/parse.ts";
import { pieceBytes, turkishMarchHarpsichord } from "../midi/pieces.ts";
import { buildSceneData, pieceTime } from "../midi/timeline.ts";
import { createHarpsichordPainter, HARPSICHORD_DISPLAY_TITLE } from "./paint.ts";
import { MIDI_TURKISH_MARCH_HARPSICHORD } from "./scene.ts";
import {
  buildHarpsichordPlan,
  HARPSICHORD_HIGH_PITCH,
  HARPSICHORD_LOW_PITCH,
  harpsichordProgressAt,
  harpsichordStringStateAt,
  STAGE,
} from "./sim.ts";

const PARSED = parseMidi(pieceBytes(turkishMarchHarpsichord()));
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

test("Harpsichord stage, 41 brass strings, and reversed manual are symmetric on x = 540, centred on y = 940", () => {
  const plan = buildHarpsichordPlan(PARSED.notes);
  assert.equal((STAGE.left + STAGE.right) / 2, 540);
  assert.equal((STAGE.caseLeft + STAGE.caseRight) / 2, 540);
  assert.equal((STAGE.top + STAGE.bottom) / 2, 940);
  assert.equal(plan.strings.length, HARPSICHORD_HIGH_PITCH - HARPSICHORD_LOW_PITCH + 1);

  const first = plan.strings[0];
  const last = plan.strings[plan.strings.length - 1];
  assert.ok(Math.abs(0.5 * (first.stringX + last.stringX) - 540) < 1e-6, "strings span symmetrically on x = 540");
  assert.ok(first.bridgeY < last.bridgeY, "bass strings are longer than treble strings along the bentside");

  const firstNat = plan.naturalStrings[0];
  const lastNat = plan.naturalStrings[plan.naturalStrings.length - 1];
  assert.ok(Math.abs(0.5 * (firstNat.keyX + lastNat.keyX) - 540) < 1e-6, "manual centred on x = 540");

  assert.equal(plan.events.length, PARSED.notes.length, "every MIDI note maps 1-to-1 to a brass string");
  for (const ev of plan.events) assert.equal(ev.pitch, ev.note.pitch);
});

test("every note depresses its key, lifts its wooden jack, and excites standing-wave vibration at note-on", () => {
  const tailSec = MIDI_TURKISH_MARCH_HARPSICHORD.tailSec ?? 2.4;
  const scene = buildSceneData(
    PARSED,
    "turkish-march-harpsichord.mid",
    { fps: FPS, leadFrames: MIDI_TURKISH_MARCH_HARPSICHORD.leadFrames, tailSec },
    { width: 1080, height: 1920 },
  );
  const plan = buildHarpsichordPlan(PARSED.notes);

  for (const ev of plan.events) {
    const onFrame = scene.leadFrames + Math.ceil(ev.tOn * FPS - 1e-9);
    const st = harpsichordStringStateAt(plan.strings[ev.stringIndex], plan.byString[ev.stringIndex], pieceTime(scene, onFrame));
    assert.ok(st.keyDown > 0.9, `key & jack lifted at note-on (${st.keyDown})`);
    assert.ok(st.damperUp > 0.9, `damper lifted at note-on (${st.damperUp})`);
    assert.ok(st.vibEnv > 0.5, `string vibrating at note-on (${st.vibEnv})`);
  }

  assert.equal(harpsichordProgressAt(-1, scene.endSec, tailSec), 0);
  assert.ok(harpsichordProgressAt(scene.endSec * 0.5, scene.endSec, tailSec) > 0.45);
  assert.equal(harpsichordProgressAt(scene.endSec + tailSec - 0.02, scene.endSec, tailSec), 0);
});

test("Harpsichord painter renders deterministically with title 'Turkish March'", () => {
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const scene = buildSceneData(
    PARSED,
    "turkish-march-harpsichord.mid",
    { fps: FPS, leadFrames: MIDI_TURKISH_MARCH_HARPSICHORD.leadFrames, tailSec: MIDI_TURKISH_MARCH_HARPSICHORD.tailSec ?? 2.4 },
    { width: 1080, height: 1920 },
  );
  const painter = createHarpsichordPainter(scene, MIDI_TURKISH_MARCH_HARPSICHORD.label);
  const { ctx, calls, texts } = mockContext();
  for (const f of [0, 66, 480, 1200, 2400, scene.totalFrames - 1]) painter(ctx, f);
  assert.ok((calls.roundRect ?? 0) > 0);
  assert.ok(texts.includes(HARPSICHORD_DISPLAY_TITLE));
});
