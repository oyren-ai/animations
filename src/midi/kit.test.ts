import assert from "node:assert/strict";
import test from "node:test";
import {
  accentPulse, buildAccents, cameraKick, clamp01, drawCenteredText, drawSceneTitle, easeOutBack, endFade, hash01, hslToRgb, lowerBound,
  mulberry32, pitchClassHue, smoothstep,
} from "./kit.ts";
import { barSeconds, buildSceneData, midiAudioFile, pieceTime, prettifyFileName, sceneFrameCount } from "./timeline.ts";
import type { MidiNote, ParsedMidi } from "./types.ts";

const note = (timeSec: number, pitch = 60, velocity = 90): MidiNote => ({ timeSec, durationSec: 0.3, pitch, velocity, track: 0, channel: 0 });

test("seeded random helpers are deterministic and uniform enough", () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
  let sum = 0;
  for (let i = 0; i < 2000; i++) {
    const v = hash01(i, 7);
    assert.ok(v >= 0 && v < 1);
    assert.equal(v, hash01(i, 7));
    sum += v;
  }
  assert.ok(Math.abs(sum / 2000 - 0.5) < 0.03);
});

test("easing and colour helpers behave", () => {
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.ok(Math.abs(smoothstep(0, 1, 0.5) - 0.5) < 1e-12);
  assert.ok(Math.abs(easeOutBack(0)) < 1e-12);
  assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-12);
  assert.ok(easeOutBack(0.7) > 1, "overshoots");
  assert.equal(clamp01(3), 1);
  assert.deepEqual(hslToRgb(0, 1, 0.5).map(Math.round), [255, 0, 0]);
  assert.deepEqual(hslToRgb(120, 1, 0.5).map(Math.round), [0, 255, 0]);
  assert.equal(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((p) => Math.round(pitchClassHue(p)))).size, 12);
  assert.equal(pitchClassHue(60), pitchClassHue(72)); // octaves share a colour
});

test("lowerBound finds the first onset at or after a time", () => {
  const notes = [note(0), note(1), note(1), note(2.5), note(4)];
  assert.equal(lowerBound(notes, -1), 0);
  assert.equal(lowerBound(notes, 1), 1);
  assert.equal(lowerBound(notes, 1.0001), 3);
  assert.equal(lowerBound(notes, 9), 5);
});

test("accents group chords and rate loud chords above single notes", () => {
  const notes = [
    note(0, 60, 70),
    note(1, 60, 110), note(1.01, 64, 110), note(1.02, 67, 110), note(1.03, 72, 110), note(1.035, 76, 110),
    note(2, 60, 120),
  ];
  const accents = buildAccents(notes);
  assert.equal(accents.length, 3);
  assert.deepEqual(accents.map((a) => a.noteCount), [1, 5, 1]);
  assert.ok(accents[1].strength > 0.9 && accents[0].strength === 0 && accents[2].strength < 0.1);
  assert.ok(accentPulse(accents, 1.001, 0.2) > 0.9);
  assert.ok(accentPulse(accents, 1.6, 0.2) < accentPulse(accents, 1.1, 0.2));
  assert.equal(accentPulse(accents, 0.5, 0.2), 0);
  assert.equal(accentPulse(accents, 30, 0.2), 0);
  const kick = cameraKick(accents, 1.02);
  assert.ok(kick.zoom > 0.005);
  const rest = cameraKick(accents, 1.9);
  assert.ok(Math.abs(rest.zoom) < 1e-3 && Math.abs(rest.dx) < 0.01 && Math.abs(rest.dy) < 0.01, "the kick has died away");
  assert.deepEqual(cameraKick(accents, 3), { zoom: 0, dx: 0, dy: 0, rotation: 0 });
  assert.deepEqual(cameraKick(accents, 1.02), kick, "pure function of time");
  assert.deepEqual(buildAccents([]), []);
});

test("timeline helpers: audio file names, frame counts and the end fade", () => {
  assert.equal(midiAudioFile("ode-to-joy.mid"), "generated/midi-ode-to-joy.wav");
  assert.equal(midiAudioFile("My Song (v2).MIDI"), "generated/midi-my-song-v2-.wav");
  assert.equal(prettifyFileName("pentatonic-phase.mid"), "Pentatonic phase");
  assert.equal(sceneFrameCount(10, { fps: 60, leadFrames: 90, tailSec: 2 }), Math.ceil((1.5 + 10 + 2) * 60));
  assert.equal(sceneFrameCount(0, { fps: 60, leadFrames: 0, tailSec: 0 }), 1);
  assert.equal(endFade(0, 1000, 60), 0);
  assert.equal(endFade(999, 1000, 60), 1);
  assert.ok(endFade(985, 1000, 60) > 0 && endFade(985, 1000, 60) < 1);
});

test("buildSceneData derives title, range, timing and the bar length", () => {
  const parsed: ParsedMidi = {
    format: 1, ticksPerQuarter: 480, tempoMap: [{ tick: 0, timeSec: 0, microsecondsPerQuarter: 500000 }],
    timeSignature: { numerator: 6, denominator: 4 },
    tracks: [{ index: 0, name: "My piece", programs: [], channels: [], noteCount: 0 }, { index: 1, name: "Lead", programs: [0], channels: [0], noteCount: 2 }],
    notes: [note(0, 50), note(1, 80)], durationSec: 1.3,
  };
  const scene = buildSceneData(parsed, "x.mid", { fps: 60, leadFrames: 60, tailSec: 2 }, { width: 1080, height: 1920 });
  assert.equal(scene.title, "My piece");
  assert.deepEqual([scene.pitchMin, scene.pitchMax], [50, 80]);
  assert.equal(scene.leadSec, 1);
  assert.equal(scene.totalFrames, Math.ceil((1 + 1.3 + 2) * 60));
  assert.equal(pieceTime(scene, 60), 0);
  assert.equal(pieceTime(scene, 0), -1);
  assert.equal(barSeconds(scene), 3);
  assert.equal(buildSceneData(parsed, "x.mid", { fps: 60, leadFrames: 0, tailSec: 0 }, { width: 1, height: 1 }, "Custom").title, "Custom");
});

function textContext(): CanvasRenderingContext2D {
  let font = "600 20px sans-serif";
  const target: Record<string, unknown> = {
    get font() { return font; },
    set font(value: string) { font = value; },
    measureText(text: string) { return { width: text.length * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 20) * 0.55 }; },
  };
  return new Proxy(target, {
    get: (obj, prop) => (prop in obj ? obj[prop as string] : () => undefined),
    set: (obj, prop, value) => { obj[prop as string] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

test("framing standard: titles are centred on x = 540 inside the central 840 px, camera kicks stay under 3 percent", () => {
  const scene = buildSceneData({
    format: 1, ticksPerQuarter: 480, tempoMap: [], timeSignature: { numerator: 4, denominator: 4 },
    tracks: [{ index: 0, name: "A very long piece name that has to shrink to fit the central column of the frame", programs: [], channels: [], noteCount: 0 }],
    notes: [note(0)], durationSec: 1,
  }, "x.mid", { fps: 60, leadFrames: 60, tailSec: 1 }, { width: 1080, height: 1920 });
  for (const title of [scene.title, "Ode to Joy"]) {
    const boxes = drawSceneTitle(textContext(), { ...scene, title }, "Ball Piano", 120);
    assert.equal(boxes.length, 2);
    for (const box of boxes) {
      assert.ok(Math.abs((box.left + box.right) / 2 - 540) < 1, `${box.label} is centred`);
      assert.ok(box.left >= 120 && box.right <= 960, `${box.label} stays in the central 840 px`);
      assert.ok(box.top >= 150 && box.bottom <= 330, `${box.label} sits at y 150-330`);
    }
  }
  assert.throws(() => drawCenteredText(textContext(), "x".repeat(10), 200, { centerX: 100 }), /central 840/);
  const accents = buildAccents(Array.from({ length: 12 }, (_, i) => note(1 + i * 0.01, 60 + i, 127)));
  for (let t = 0.9; t < 3; t += 0.01) assert.ok(cameraKick(accents, t).zoom <= 0.03 + 1e-12);
});
