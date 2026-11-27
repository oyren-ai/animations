import assert from "node:assert/strict";
import test from "node:test";
import { parseMidi } from "../midi/parse.ts";
import { pieceBytes, toccataInDMinorOrgan } from "../midi/pieces.ts";
import { buildSceneData, pieceTime } from "../midi/timeline.ts";
import { createOrganPainter, ORGAN_DISPLAY_TITLE } from "./paint.ts";
import { MIDI_TOCCATA_ORGAN } from "./scene.ts";
import { buildOrganPlan, ORGAN_HIGH_PITCH, ORGAN_LOW_PITCH, organProgressAt, pipeStateAt, STAGE } from "./sim.ts";

const PARSED = parseMidi(pieceBytes(toccataInDMinorOrgan()));
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

test("Organ stage, 44-pipe facade, and chromatic manual are symmetric on x = 540, centred on y = 940", () => {
  const plan = buildOrganPlan(PARSED.notes);
  assert.equal((STAGE.left + STAGE.right) / 2, 540);
  assert.equal((STAGE.caseLeft + STAGE.caseRight) / 2, 540);
  assert.equal((STAGE.top + STAGE.bottom) / 2, 940);
  assert.equal(plan.pipes.length, ORGAN_HIGH_PITCH - ORGAN_LOW_PITCH + 1);

  // Facade outer towers are exact mirror images about x = 540
  const leftBass = plan.pipes[0];
  const rightBass = plan.pipes[1];
  assert.ok(Math.abs(0.5 * (leftBass.pipeX + rightBass.pipeX) - 540) < 1e-6, "outer bass towers mirrored on x = 540");
  assert.ok(leftBass.pipeTopY < plan.pipes[plan.pipes.length - 1].pipeTopY, "outer bass pipes stand taller than inner treble pipes");

  // Natural manual keys span symmetrically on x = 540
  const firstNat = plan.naturalPipes[0];
  const lastNat = plan.naturalPipes[plan.naturalPipes.length - 1];
  assert.ok(Math.abs(0.5 * (firstNat.keyX + lastNat.keyX) - 540) < 1e-6, "organ manual centred on x = 540");

  // 1-to-1 pitch mapping for every single MIDI note in the score
  assert.equal(plan.events.length, PARSED.notes.length, "every MIDI note maps to an exact physical pipe");
  for (const ev of plan.events) {
    assert.equal(ev.pitch, ev.note.pitch, `exact pipe pitch for ${ev.note.pitch}`);
  }
});

test("every note depresses its manual key, opens its pallet valve, and speaks at exact note-on; progress resets on loop", () => {
  const tailSec = MIDI_TOCCATA_ORGAN.tailSec ?? 2.8;
  const scene = buildSceneData(
    PARSED,
    "toccata-in-d-minor-organ.mid",
    { fps: FPS, leadFrames: MIDI_TOCCATA_ORGAN.leadFrames, tailSec },
    { width: 1080, height: 1920 },
  );
  const plan = buildOrganPlan(PARSED.notes);

  for (const ev of plan.events) {
    const onFrame = scene.leadFrames + Math.ceil(ev.tOn * FPS - 1e-9);
    const st = pipeStateAt(plan.byPipe[ev.pipeIndex], pieceTime(scene, onFrame));
    assert.ok(st.keyDown > 0.9, `key depressed at note-on (${st.keyDown})`);
    assert.ok(st.palletOpen > 0.9, `pallet valve open at note-on (${st.palletOpen})`);
    assert.ok(st.speaking > 0.5, `pipe speaking at note-on (${st.speaking})`);
  }

  assert.equal(organProgressAt(-1, scene.endSec, tailSec), 0);
  assert.ok(organProgressAt(scene.endSec * 0.5, scene.endSec, tailSec) > 0.45);
  assert.equal(organProgressAt(scene.endSec + tailSec - 0.02, scene.endSec, tailSec), 0);
});

test("Organ painter renders deterministically with title 'Toccata in D Minor'", () => {
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const scene = buildSceneData(
    PARSED,
    "toccata-in-d-minor-organ.mid",
    { fps: FPS, leadFrames: MIDI_TOCCATA_ORGAN.leadFrames, tailSec: MIDI_TOCCATA_ORGAN.tailSec ?? 2.8 },
    { width: 1080, height: 1920 },
  );
  const painter = createOrganPainter(scene, MIDI_TOCCATA_ORGAN.label);
  const { ctx, calls, texts } = mockContext();
  for (const f of [0, 66, 360, 1200, 2400, scene.totalFrames - 1]) painter(ctx, f);
  assert.ok((calls.roundRect ?? 0) > 0);
  assert.ok(texts.includes(ORGAN_DISPLAY_TITLE));
});
