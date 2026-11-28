import assert from "node:assert/strict";
import test from "node:test";
import { parseMidi } from "../midi/parse.ts";
import { odeToJoyCarillon, pieceBytes } from "../midi/pieces.ts";
import { buildSceneData, pieceTime } from "../midi/timeline.ts";
import { CARILLON_DISPLAY_TITLE, createCarillonPainter } from "./paint.ts";
import { MIDI_ODE_TO_JOY_CARILLON } from "./scene.ts";
import { bellMotionAt, buildCarillonPlan, carillonProgressAt, STAGE } from "./sim.ts";

const PARSED = parseMidi(pieceBytes(odeToJoyCarillon()));
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

test("Carillon belfry and three bell tiers are symmetric on x = 540, centred on y = 940, with 1-to-1 bell mapping", () => {
  const plan = buildCarillonPlan(PARSED.notes);
  assert.equal((STAGE.left + STAGE.right) / 2, 540);
  assert.equal((STAGE.belfryLeft + STAGE.belfryRight) / 2, 540);
  assert.equal((STAGE.top + STAGE.bottom) / 2, 940);
  assert.equal(plan.bells.length, 22, "7 treble + 8 melody + 7 bourdon bells");

  for (const tier of [0, 1, 2] as const) {
    const row = plan.bells.filter((b) => b.tier === tier);
    const meanX = row.reduce((s, b) => s + b.x, 0) / row.length;
    assert.ok(Math.abs(meanX - 540) < 1e-6, `tier ${tier} bells centred on x = 540`);
  }

  assert.ok(plan.strikes.length >= 200, `expected >= 200 bell strikes, got ${plan.strikes.length}`);
  for (const s of plan.strikes) {
    assert.equal(s.pitch, s.note.pitch, `exact 1-to-1 bell mapping for pitch ${s.note.pitch}`);
  }
});

test("every bell winds up before note-on and rings within one frame of note-on; progress resets on loop", () => {
  const tailSec = MIDI_ODE_TO_JOY_CARILLON.tailSec ?? 2.6;
  const scene = buildSceneData(
    PARSED,
    "ode-to-joy-carillon.mid",
    { fps: FPS, leadFrames: MIDI_ODE_TO_JOY_CARILLON.leadFrames, tailSec },
    { width: 1080, height: 1920 },
  );
  const plan = buildCarillonPlan(PARSED.notes);

  for (const strike of plan.strikes) {
    const bell = plan.bells[strike.bellIndex];
    const bellStrikes = plan.byBell[strike.bellIndex];
    const windup = bellMotionAt(bell, bellStrikes, strike.tOn - 0.04);
    assert.ok(windup.ropePullPx > 2, "braided rope pulls before strike");

    const onFrame = scene.leadFrames + Math.ceil(strike.tOn * FPS - 1e-9);
    const atOn = bellMotionAt(bell, bellStrikes, pieceTime(scene, onFrame));
    assert.ok(atOn.glow > 0.5 && atOn.age >= -1e-9 && atOn.age <= 1 / FPS + 1e-6);
  }

  assert.equal(carillonProgressAt(-1, scene.endSec, tailSec), 0);
  assert.ok(carillonProgressAt(scene.endSec * 0.7, scene.endSec, tailSec) > 0.65);
  assert.equal(carillonProgressAt(scene.endSec + tailSec - 0.02, scene.endSec, tailSec), 0);
});

test("Carillon painter renders deterministically with title 'Ode to Joy'", () => {
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const scene = buildSceneData(
    PARSED,
    "ode-to-joy-carillon.mid",
    { fps: FPS, leadFrames: MIDI_ODE_TO_JOY_CARILLON.leadFrames, tailSec: MIDI_ODE_TO_JOY_CARILLON.tailSec ?? 2.6 },
    { width: 1080, height: 1920 },
  );
  const painter = createCarillonPainter(scene, MIDI_ODE_TO_JOY_CARILLON.label);
  const { ctx, calls, texts } = mockContext();
  for (const f of [0, 66, 480, 1200, 2400, scene.totalFrames - 1]) painter(ctx, f);
  assert.ok((calls.roundRect ?? 0) > 0);
  assert.ok(texts.includes(CARILLON_DISPLAY_TITLE));
});
