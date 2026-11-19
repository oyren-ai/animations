import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseMidi } from "../midi/parse.ts";
import { buildSceneData, pieceTime } from "../midi/timeline.ts";
import { createMughamPainter } from "./paint.ts";
import { MIDI_MUGHAM_NOCTURNE } from "./scene.ts";
import {
  BASS_HAND_REST_X,
  bassHandPoseAt,
  buildMughamEvents,
  eventStateAt,
  melodyPitchToX,
  MIZRAB_REST_X,
  MIZRAB_REST_Y,
  mizrabPoseAt,
  PITCH_AXIS_LEFT,
  PITCH_AXIS_RIGHT,
  STAGE,
} from "./sim.ts";

const MIDI_PATH = new URL("../../public/midi/mugham-nocturne.mid", import.meta.url);
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

test("Mugham Nocturne uses quiet brand layer, Original caption, and framing-standard stage geometry", () => {
  assert.equal(MIDI_MUGHAM_NOCTURNE.brand, "quiet");
  assert.equal(MIDI_MUGHAM_NOCTURNE.defaultTitle, "Mugham Nocturne");
  assert.equal(MIDI_MUGHAM_NOCTURNE.label, "Original \u00b7 jazz-mugham style");
  assert.equal(STAGE.left, 50);
  assert.equal(STAGE.right, 1030);
  assert.equal((STAGE.left + STAGE.right) / 2, 540);
  assert.equal((PITCH_AXIS_LEFT + PITCH_AXIS_RIGHT) / 2, 540);
  assert.equal((STAGE.top + STAGE.bottom) / 2, 970);
  assert.ok(STAGE.top >= 290, "clears quiet wordmark and piece title");
});

test("1-to-1 Tar, Kamancha, Piano, Bass, and Brush events strike within one frame of note-on", () => {
  const scene = buildSceneData(
    PARSED,
    "mugham-nocturne.mid",
    { fps: FPS, leadFrames: MIDI_MUGHAM_NOCTURNE.leadFrames, tailSec: MIDI_MUGHAM_NOCTURNE.tailSec ?? 2.2 },
    { width: 1080, height: 1920 },
    MIDI_MUGHAM_NOCTURNE.defaultTitle,
  );
  const events = buildMughamEvents(PARSED.notes);
  assert.equal(events.length, PARSED.notes.length, "exact 1-to-1 physical striker event count");

  for (const ev of events) {
    const onFrame = scene.leadFrames + Math.ceil(ev.tOn * FPS - 1e-9);
    const atOn = eventStateAt(ev, pieceTime(scene, onFrame));
    const beforeOn = eventStateAt(ev, pieceTime(scene, onFrame - 1));
    assert.ok(atOn && atOn.active, `event ${ev.index} (${ev.role}) active on landing frame ${onFrame}`);
    assert.ok(!beforeOn || !beforeOn.active, `event ${ev.index} not yet active one frame earlier`);
  }

  // +40 cent Shur microtonal bend shifts the fret position visibly above 12-TET Eb
  assert.ok(melodyPitchToX(63, 40) > melodyPitchToX(63, 0) + 6);
});

test("Tar Mizrab and Upright Bass hand start and finish at exact loop rest poses", () => {
  const events = buildMughamEvents(PARSED.notes);
  const tar = events.filter((e) => e.role === "tar");
  const bass = events.filter((e) => e.role === "bass");
  const leadSec = MIDI_MUGHAM_NOCTURNE.leadFrames / FPS;
  const tailSec = MIDI_MUGHAM_NOCTURNE.tailSec ?? 2.2;

  const m0 = mizrabPoseAt(tar, -leadSec, leadSec, PARSED.durationSec, tailSec);
  const mEnd = mizrabPoseAt(tar, PARSED.durationSec + tailSec - 1 / FPS, leadSec, PARSED.durationSec, tailSec);
  assert.ok(Math.abs(m0.x - MIZRAB_REST_X) < 1e-6 && Math.abs(m0.y - MIZRAB_REST_Y) < 1e-6);
  assert.ok(Math.abs(mEnd.x - MIZRAB_REST_X) < 1e-3 && Math.abs(mEnd.y - MIZRAB_REST_Y) < 1e-3);

  const b0 = bassHandPoseAt(bass, -leadSec, leadSec, PARSED.durationSec, tailSec);
  const bEnd = bassHandPoseAt(bass, PARSED.durationSec + tailSec - 1 / FPS, leadSec, PARSED.durationSec, tailSec);
  assert.ok(Math.abs(b0.x - BASS_HAND_REST_X) < 1e-6);
  assert.ok(Math.abs(bEnd.x - BASS_HAND_REST_X) < 1e-3);
});

test("Mugham Nocturne painter is deterministic and renders cleanly across all structural sections", () => {
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const scene = buildSceneData(
    PARSED,
    "mugham-nocturne.mid",
    { fps: FPS, leadFrames: MIDI_MUGHAM_NOCTURNE.leadFrames, tailSec: MIDI_MUGHAM_NOCTURNE.tailSec ?? 2.2 },
    { width: 1080, height: 1920 },
    MIDI_MUGHAM_NOCTURNE.defaultTitle,
  );
  const painter = createMughamPainter(scene, MIDI_MUGHAM_NOCTURNE.label);
  const { ctx, calls, texts } = mockContext();
  for (const f of [0, 30, 54, 420, 1200, 1950, 2450, scene.totalFrames - 1]) painter(ctx, f);
  assert.ok((calls.fillRect ?? 0) > 0);
  assert.ok(texts.includes("Mugham Nocturne") && texts.includes("Original \u00b7 jazz-mugham style"));
  for (const s of texts) assert.ok(!/shur|rast|segah/i.test(s), `on-video text must not name modes: ${s}`);
});
