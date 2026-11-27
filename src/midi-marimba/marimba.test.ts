import assert from "node:assert/strict";
import test from "node:test";
import { parseMidi } from "../midi/parse.ts";
import { minuetInGMarimba, pieceBytes } from "../midi/pieces.ts";
import { buildSceneData, pieceTime } from "../midi/timeline.ts";
import { createMarimbaPainter, MARIMBA_DISPLAY_TITLE } from "./paint.ts";
import { MIDI_MINUET_MARIMBA } from "./scene.ts";
import { barMotionAt, buildMarimbaPlan, MALLETS, malletPoseAt, marimbaProgressAt, STAGE } from "./sim.ts";

const PARSED = parseMidi(pieceBytes(minuetInGMarimba()));
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

test("Marimba stage and bars are symmetric on x = 540, centred on y = 940, with 1-to-1 bar mapping", () => {
  const plan = buildMarimbaPlan(PARSED.notes);
  assert.equal((STAGE.left + STAGE.right) / 2, 540);
  assert.equal((STAGE.frameLeft + STAGE.frameRight) / 2, 540);
  assert.equal((STAGE.top + STAGE.bottom) / 2, 940);

  const firstNat = plan.naturalBars[0];
  const lastNat = plan.naturalBars[plan.naturalBars.length - 1];
  assert.ok(Math.abs(0.5 * (firstNat.x + lastNat.x) - 540) < 1e-6, "natural rosewood bars span symmetrically on x = 540");
  assert.ok(firstNat.resonatorBottomY > lastNat.resonatorBottomY, "bass resonators hang lower than treble resonators");
  assert.ok(plan.strikes.length >= 220, `expected >= 220 marimba bar strikes, got ${plan.strikes.length}`);

  // Every marimba strike hits an exact matching bar pitch
  for (const strike of plan.strikes) {
    assert.equal(strike.pitch, strike.note.pitch, `exact bar pitch for ${strike.note.pitch}`);
  }
});

test("every mallet reaches its exact bar at lift = 0 within one frame of note-on; progress resets on loop", () => {
  const tailSec = MIDI_MINUET_MARIMBA.tailSec ?? 2.6;
  const scene = buildSceneData(
    PARSED,
    "minuet-in-g-marimba.mid",
    { fps: FPS, leadFrames: MIDI_MINUET_MARIMBA.leadFrames, tailSec },
    { width: 1080, height: 1920 },
  );
  const plan = buildMarimbaPlan(PARSED.notes);

  for (const spec of MALLETS) {
    for (const strike of plan.byMallet[spec.id]) {
      const exact = malletPoseAt(spec, plan.byMallet[spec.id], strike.tOn, scene.endSec, tailSec);
      assert.ok(Math.abs(exact.headX - strike.x) < 1e-3, "mallet X lands on bar centre");
      assert.ok(Math.abs(exact.headY - strike.y) < 1e-3, "mallet Y lands on bar strike line");
      assert.ok(exact.lift <= 0.02, `mallet touches bar at note-on (lift=${exact.lift})`);

      const onFrame = scene.leadFrames + Math.ceil(strike.tOn * FPS - 1e-9);
      const motion = barMotionAt(plan.byBar[strike.barIndex], pieceTime(scene, onFrame));
      assert.ok(motion.glow > 0.5 && motion.age >= -1e-9 && motion.age <= 1 / FPS + 1e-6);
    }
  }

  assert.equal(marimbaProgressAt(-1, scene.endSec, tailSec), 0);
  assert.ok(marimbaProgressAt(scene.endSec * 0.7, scene.endSec, tailSec) > 0.65);
  assert.equal(marimbaProgressAt(scene.endSec + tailSec - 0.02, scene.endSec, tailSec), 0);
});

test("Marimba painter renders deterministically with title 'Minuet in G Major'", () => {
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const scene = buildSceneData(
    PARSED,
    "minuet-in-g-marimba.mid",
    { fps: FPS, leadFrames: MIDI_MINUET_MARIMBA.leadFrames, tailSec: MIDI_MINUET_MARIMBA.tailSec ?? 2.6 },
    { width: 1080, height: 1920 },
  );
  const painter = createMarimbaPainter(scene, MIDI_MINUET_MARIMBA.label);
  const { ctx, calls, texts } = mockContext();
  for (const f of [0, 66, 480, 1200, 2400, scene.totalFrames - 1]) painter(ctx, f);
  assert.ok((calls.roundRect ?? 0) > 0);
  assert.ok(texts.includes(MARIMBA_DISPLAY_TITLE));
});
