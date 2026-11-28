import assert from "node:assert/strict";
import test from "node:test";
import { parseMidi } from "../midi/parse.ts";
import { pieceBytes, springConcertHarp } from "../midi/pieces.ts";
import { buildSceneData, pieceTime } from "../midi/timeline.ts";
import { createHarpPainter, HARP_DISPLAY_TITLE } from "./paint.ts";
import { MIDI_SPRING_HARP } from "./scene.ts";
import {
  buildHarpPlan,
  fingerPoseAt,
  FINGERS,
  harpProgressAt,
  harpStringMotionAt,
  STAGE,
} from "./sim.ts";

const PARSED = parseMidi(pieceBytes(springConcertHarp()));
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

test("Concert pedal harp has 29 E-major strings symmetric on x = 540, centred on y = 940, with exact 1-to-1 pitch map", () => {
  const plan = buildHarpPlan(PARSED.notes);
  assert.equal((STAGE.left + STAGE.right) / 2, 540);
  assert.equal((STAGE.top + STAGE.bottom) / 2, 940);
  assert.equal((STAGE.stringLeftX + STAGE.stringRightX) / 2, 540);
  assert.equal(plan.strings.length, 29);

  // Bass E2 string is much longer than treble E6 string
  const bass = plan.strings[0];
  const treble = plan.strings[plan.strings.length - 1];
  assert.equal(bass.label, "E2");
  assert.equal(treble.label, "E6");
  assert.ok(bass.botY - bass.topY > (treble.botY - treble.topY) * 1.8, "bass string is much longer than treble string");

  // Authentic harp string colour coding: C# red, F# blue
  assert.equal(plan.strings.filter((s) => s.role === "red-c").length, 4);
  assert.equal(plan.strings.filter((s) => s.role === "blue-f").length, 4);

  // 1-to-1 pitch mapping for every single MIDI note in Vivaldi's Spring
  assert.equal(plan.plucks.length, PARSED.notes.length);
  for (const pluck of plan.plucks) {
    assert.equal(pluck.pitch, pluck.note.pitch, `exact harp string for pitch ${pluck.note.pitch}`);
  }
});

test("every plucking finger lands on its string at lift = 0 at exact note-on, pre-bends before tOn, and excites standing wave", () => {
  const tailSec = MIDI_SPRING_HARP.tailSec ?? 2.6;
  const scene = buildSceneData(
    PARSED,
    "spring-concert-harp.mid",
    { fps: FPS, leadFrames: MIDI_SPRING_HARP.leadFrames, tailSec },
    { width: 1080, height: 1920 },
  );
  const plan = buildHarpPlan(PARSED.notes);

  for (const spec of FINGERS) {
    for (const pluck of plan.byFinger[spec.id]) {
      const exact = fingerPoseAt(spec, plan.byFinger[spec.id], pluck.tOn, scene.endSec, tailSec);
      assert.ok(Math.abs(exact.tipX - pluck.x) < 1e-3, "finger X lands on exact string X");
      assert.ok(Math.abs(exact.tipY - pluck.y) < 1e-3, "finger Y lands on exact pluck Y");
      assert.ok(exact.lift <= 0.02, `finger contacts string at note-on (lift=${exact.lift})`);

      // Pre-pluck sideways string bend is visible 20 ms before note-on
      const pre = harpStringMotionAt(plan.strings[pluck.stringIndex], plan.byString[pluck.stringIndex], pluck.tOn - 0.02);
      assert.ok(Math.abs(pre.preloadPx) > 3, `string bends sideways under finger before tOn (${pre.preloadPx})`);

      // Post-pluck standing wave & glow peak on note-on frame
      const onFrame = scene.leadFrames + Math.ceil(pluck.tOn * FPS - 1e-9);
      const motion = harpStringMotionAt(plan.strings[pluck.stringIndex], plan.byString[pluck.stringIndex], pieceTime(scene, onFrame));
      assert.ok(motion.glow > 0.5 && motion.vibEnv > 0.5 && motion.age >= -1e-9 && motion.age <= 1 / FPS + 1e-6);
    }
  }

  assert.equal(harpProgressAt(-1, scene.endSec, tailSec), 0);
  assert.ok(harpProgressAt(scene.endSec * 0.6, scene.endSec, tailSec) > 0.55);
  assert.equal(harpProgressAt(scene.endSec + tailSec - 0.02, scene.endSec, tailSec), 0);
});

test("Concert harp painter renders deterministically with title 'Spring'", () => {
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const scene = buildSceneData(
    PARSED,
    "spring-concert-harp.mid",
    { fps: FPS, leadFrames: MIDI_SPRING_HARP.leadFrames, tailSec: MIDI_SPRING_HARP.tailSec ?? 2.6 },
    { width: 1080, height: 1920 },
  );
  const painter = createHarpPainter(scene, MIDI_SPRING_HARP.label);
  const { ctx, calls, texts } = mockContext();
  for (const f of [0, 66, 360, 1200, 2400, scene.totalFrames - 1]) painter(ctx, f);
  assert.ok((calls.roundRect ?? 0) > 0);
  assert.ok(texts.includes(HARP_DISPLAY_TITLE));
});
