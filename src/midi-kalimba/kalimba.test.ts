import assert from "node:assert/strict";
import test from "node:test";
import { parseMidi } from "../midi/parse.ts";
import { pieceBytes, sugarPlumKalimba } from "../midi/pieces.ts";
import { buildSceneData, pieceTime } from "../midi/timeline.ts";
import { createKalimbaPainter, KALIMBA_DISPLAY_TITLE } from "./paint.ts";
import { MIDI_SUGAR_PLUM_KALIMBA } from "./scene.ts";
import {
  buildKalimbaPlan,
  KALIMBA_HIGH_PITCH,
  KALIMBA_LOW_PITCH,
  kalimbaProgressAt,
  STAGE,
  thumbPoseAt,
  THUMBS,
  tineMotionAt,
} from "./sim.ts";

const PARSED = parseMidi(pieceBytes(sugarPlumKalimba()));
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

test("Kalimba soundbox, soundhole, and 32-tine chromatic V-fan are symmetric on x = 540, centred on y = 940", () => {
  const plan = buildKalimbaPlan(PARSED.notes);
  assert.equal((STAGE.left + STAGE.right) / 2, 540);
  assert.equal((STAGE.bodyLeft + STAGE.bodyRight) / 2, 540);
  assert.equal((STAGE.top + STAGE.bottom) / 2, 940);
  assert.equal(STAGE.soundholeX, 540);
  assert.equal(plan.tines.length, KALIMBA_HIGH_PITCH - KALIMBA_LOW_PITCH + 1);

  // Center bass tine sits dead on x = 540 and extends farthest downward
  const centerBass = plan.naturalTines[0];
  const outerTreble = plan.naturalTines[plan.naturalTines.length - 1];
  assert.equal(centerBass.x, 540);
  assert.ok(centerBass.tipY > outerTreble.tipY, "center bass tine extends longer than outer treble tines");

  // Natural and accidental tines span symmetrically about x = 540
  const natMinX = Math.min(...plan.naturalTines.map((t) => t.x));
  const natMaxX = Math.max(...plan.naturalTines.map((t) => t.x));
  assert.ok(Math.abs(0.5 * (natMinX + natMaxX) - 540) < 1e-6, "natural tine fan symmetric on x = 540");

  const accMinX = Math.min(...plan.accidentalTines.map((t) => t.x));
  const accMaxX = Math.max(...plan.accidentalTines.map((t) => t.x));
  assert.ok(Math.abs(0.5 * (accMinX + accMaxX) - 540) < 1e-6, "accidental tine fan symmetric on x = 540");

  // 1-to-1 pitch mapping for every single MIDI note in the score
  assert.equal(plan.plucks.length, PARSED.notes.length, "every MIDI note maps to an exact physical steel tine");
  for (const pluck of plan.plucks) {
    assert.equal(pluck.pitch, pluck.note.pitch, `exact tine pitch for ${pluck.note.pitch}`);
  }
});

test("every plucking thumb lands on its tine tip at lift = 0 at exact note-on and releases into cantilever vibration", () => {
  const tailSec = MIDI_SUGAR_PLUM_KALIMBA.tailSec ?? 2.6;
  const scene = buildSceneData(
    PARSED,
    "sugar-plum-kalimba.mid",
    { fps: FPS, leadFrames: MIDI_SUGAR_PLUM_KALIMBA.leadFrames, tailSec },
    { width: 1080, height: 1920 },
  );
  const plan = buildKalimbaPlan(PARSED.notes);

  for (const spec of THUMBS) {
    for (const pluck of plan.byThumb[spec.id]) {
      const exact = thumbPoseAt(spec, plan.byThumb[spec.id], pluck.tOn, scene.endSec, tailSec);
      assert.ok(Math.abs(exact.tipX - pluck.x) < 1e-3, "thumb X lands on exact tine center");
      assert.ok(Math.abs(exact.tipY - pluck.y) < 1e-3, "thumb Y lands on exact tine pluck point");
      assert.ok(exact.lift <= 0.02, `thumb contacts tine at note-on (lift=${exact.lift})`);

      // Pre-pluck tension bend is visible 20 ms before note-on
      const pre = tineMotionAt(plan.tines[pluck.tineIndex], plan.byTine[pluck.tineIndex], pluck.tOn - 0.02);
      assert.ok(pre.preloadPx > 3, `tine deflects under thumb preload before note-on (preload=${pre.preloadPx})`);

      // Post-pluck vibration & glow peak on note-on frame
      const onFrame = scene.leadFrames + Math.ceil(pluck.tOn * FPS - 1e-9);
      const motion = tineMotionAt(plan.tines[pluck.tineIndex], plan.byTine[pluck.tineIndex], pieceTime(scene, onFrame));
      assert.ok(motion.glow > 0.5 && motion.vibEnv > 0.5 && motion.age >= -1e-9 && motion.age <= 1 / FPS + 1e-6);
    }
  }

  assert.equal(kalimbaProgressAt(-1, scene.endSec, tailSec), 0);
  assert.ok(kalimbaProgressAt(scene.endSec * 0.6, scene.endSec, tailSec) > 0.55);
  assert.equal(kalimbaProgressAt(scene.endSec + tailSec - 0.02, scene.endSec, tailSec), 0);
});

test("Kalimba painter renders deterministically with title 'Dance of the Sugar Plum Fairy'", () => {
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const scene = buildSceneData(
    PARSED,
    "sugar-plum-kalimba.mid",
    { fps: FPS, leadFrames: MIDI_SUGAR_PLUM_KALIMBA.leadFrames, tailSec: MIDI_SUGAR_PLUM_KALIMBA.tailSec ?? 2.6 },
    { width: 1080, height: 1920 },
  );
  const painter = createKalimbaPainter(scene, MIDI_SUGAR_PLUM_KALIMBA.label);
  const { ctx, calls, texts } = mockContext();
  for (const f of [0, 66, 360, 1200, 2400, scene.totalFrames - 1]) painter(ctx, f);
  assert.ok((calls.roundRect ?? 0) > 0);
  assert.ok(texts.includes(KALIMBA_DISPLAY_TITLE));
});
