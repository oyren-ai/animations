import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cameraKick, mulberry32 } from "../midi/kit.ts";
import { parseMidi } from "../midi/parse.ts";
import { buildSceneData, MIDI_TAIL_SEC, pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import type { MidiNote, ParsedMidi } from "../midi/types.ts";
import { buildRippleAccents, buildRippleEvents, pitchHue, RIPPLE_LEAD_FRAMES, SOURCE_AREA } from "./events.ts";
import { fieldGeometry, MAX_SOURCES, RippleField } from "./field.ts";
import { RIPPLE_TANK } from "./scene.ts";

const FPS = 60;
const FILES = ["canon-in-d.mid", "ode-to-joy.mid", "pentatonic-phase.mid"];
const midiPath = (file: string) => new URL("../../public/midi/" + file, import.meta.url);

function loadScene(file: string): MidiSceneData {
  const parsed = parseMidi(new Uint8Array(readFileSync(midiPath(file))));
  return buildSceneData(parsed, file, { fps: FPS, leadFrames: RIPPLE_LEAD_FRAMES, tailSec: MIDI_TAIL_SEC }, { width: 1080, height: 1920 });
}

function note(timeSec: number, pitch: number, velocity: number, track = 1, durationSec = 0.5): MidiNote {
  return { timeSec, durationSec, pitch, velocity, track, channel: track };
}

/** A scene built from hand-made notes (any number of tracks), the way the shell builds one from a parsed file. */
function syntheticScene(notes: MidiNote[]): MidiSceneData {
  const sorted = [...notes].sort((a, b) => a.timeSec - b.timeSec || a.pitch - b.pitch);
  const trackIds = [...new Set(sorted.map((n) => n.track))].sort((a, b) => a - b);
  const parsed: ParsedMidi = {
    format: 1, ticksPerQuarter: 480,
    tempoMap: [{ tick: 0, timeSec: 0, microsecondsPerQuarter: 500000 }],
    timeSignature: { numerator: 4, denominator: 4 },
    tracks: trackIds.map((index) => ({ index, name: "", programs: [], channels: [0], noteCount: sorted.filter((n) => n.track === index).length })),
    notes: sorted,
    durationSec: sorted.reduce((end, n) => Math.max(end, n.timeSec + n.durationSec), 0),
  };
  return buildSceneData(parsed, "synthetic.mid", { fps: FPS, leadFrames: RIPPLE_LEAD_FRAMES, tailSec: MIDI_TAIL_SEC }, { width: 1080, height: 1920 });
}

/** A coarse field (8 px cells) keeps the per-note tests fast; the shipped painter uses 3 px cells. */
const coarse = () => new RippleField(fieldGeometry(1080, 1920, 8, 64));
const energy = (field: RippleField) => field.acc.reduce((sum, value, i) => sum + (i % 5 === 1 ? value : 0), 0);

const CANON = loadScene("canon-in-d.mid");

test("there is one visual event per note, in note order, for every shipped piece", () => {
  for (const file of FILES) {
    const scene = file === "canon-in-d.mid" ? CANON : loadScene(file);
    const events = buildRippleEvents(scene);
    assert.equal(events.length, scene.notes.length, file);
    events.forEach((event, i) => {
      assert.equal(event.index, i);
      assert.equal(event.timeSec, scene.notes[i].timeSec);
      assert.equal(event.pitch, scene.notes[i].pitch);
    });
  }
  assert.equal(buildRippleEvents(CANON).length, 278);
});

test("a note's first visible frame is leadFrames + ceil(t * 60), and nothing of it shows before", () => {
  const events = buildRippleEvents(CANON);
  const field = coarse();
  events.forEach((event) => {
    assert.equal(event.startFrame, RIPPLE_LEAD_FRAMES + Math.ceil(event.timeSec * FPS - 1e-9));
    // The frame at which the audio's onset falls: first frame with pieceTime >= timeSec (within float noise).
    const firstFrame = Math.ceil(RIPPLE_LEAD_FRAMES + event.timeSec * FPS - 1e-9);
    assert.ok(Math.abs(firstFrame - event.startFrame) <= 1);
    assert.ok(pieceTime(CANON, event.startFrame) >= event.timeSec - 1e-9, "the start frame is at or after the onset");
    assert.ok(pieceTime(CANON, event.startFrame - 1) < event.timeSec, "the previous frame is before the onset");
  });
  // Isolate individual notes (alone in their scene): nothing at startFrame - 1, something at startFrame.
  for (let i = 0; i < CANON.notes.length; i += 3) {
    const scene = syntheticScene([CANON.notes[i]]);
    const [only] = buildRippleEvents(scene);
    field.evaluate([only], only.startFrame - 1, pieceTime(scene, only.startFrame - 1));
    assert.equal(field.activeCount, 0, `note ${i} visible a frame early`);
    assert.equal(energy(field), 0);
    field.evaluate([only], only.startFrame, pieceTime(scene, only.startFrame));
    assert.equal(field.activeCount, 1, `note ${i} not visible on its first frame`);
    assert.ok(energy(field) > 0);
  }
});

test("source points stay inside the phone safe area for all shipped pieces", () => {
  for (const file of FILES) {
    for (const event of buildRippleEvents(loadScene(file))) {
      assert.ok(event.x >= 150 && event.x <= 930, `${file}: x ${event.x}`);
      assert.ok(event.y >= 380 && event.y <= 1560, `${file}: y ${event.y}`);
      assert.ok(event.x >= SOURCE_AREA.xMin && event.x <= SOURCE_AREA.xMax && event.y >= SOURCE_AREA.yMin && event.y <= SOURCE_AREA.yMax);
      assert.ok(Number.isFinite(event.hue) && event.hue >= 0 && event.hue < 360);
      assert.ok(event.wavelength > 20 && event.speed > 50 && event.life > 0.5 && event.amplitude > 0);
    }
  }
});

test("x and colour follow pitch, loudness sets height and wavelength, voices get their own rows", () => {
  // One voice: an opening note (entrances are emphasised, so it is left out of the comparison), then three pitches
  // from low to high at three velocities from soft to loud.
  const scene = syntheticScene([note(0, 40, 60, 1), note(1, 40, 50, 1), note(2, 52, 80, 1), note(3, 64, 110, 1)]);
  const [, soft, medium, loud] = buildRippleEvents(scene);
  assert.ok(soft.x < medium.x && medium.x < loud.x, "low notes left, high notes right");
  assert.ok(soft.amplitude < medium.amplitude && medium.amplitude < loud.amplitude, "louder is taller");
  assert.ok(soft.wavelength * soft.speed < loud.wavelength * loud.speed && soft.life < loud.life, "louder rings are longer, faster and last longer");
  const sameKind = buildRippleEvents(syntheticScene([note(0, 60, 80, 1), note(1, 60, 40, 1), note(2, 60, 120, 1)]));
  assert.ok(sameKind[1].wavelength < sameKind[2].wavelength, "louder is a longer wavelength");
  assert.ok(sameKind[1].amplitude < sameKind[2].amplitude);
  const hues = [40, 52, 64].map((pitch) => pitchHue((pitch - 40) / 24));
  assert.ok(new Set(hues.map((h) => Math.round(h / 20))).size === 3, "distinct colours along the range");
  // Voices by register: the track with the lowest mean pitch sits lowest on screen (largest y), the highest voice on top.
  const voices = buildRippleEvents(syntheticScene([
    note(0, 40, 80, 1), note(1, 40, 80, 1), note(0.5, 60, 80, 2), note(1.5, 60, 80, 2), note(0.2, 80, 80, 3), note(1.2, 80, 80, 3),
  ]));
  const byPitch = (pitch: number) => voices.filter((e) => e.pitch === pitch).reduce((s, e, _i, all) => s + e.y / all.length, 0);
  assert.ok(byPitch(40) > byPitch(60) && byPitch(60) > byPitch(80), "bass row below arpeggio row below melody row");
  // The same pitch struck twice does not stack on the same spot.
  const twice = buildRippleEvents(syntheticScene([note(0, 60, 80, 1), note(1, 60, 80, 1), note(2, 60, 80, 1)]));
  assert.ok(new Set(twice.map((e) => e.x.toFixed(2) + ":" + e.y.toFixed(2))).size === 3);
});

test("the field is a stateless function of the frame: any order, same bits", () => {
  const events = buildRippleEvents(CANON);
  const frameOf = (seconds: number) => RIPPLE_LEAD_FRAMES + Math.round(seconds * FPS);
  const geo = fieldGeometry(1080, 1920, 6, 64);
  const snapshot = (field: RippleField, frame: number) => {
    field.evaluate(events, frame, pieceTime(CANON, frame));
    const rgba = new Uint8ClampedArray(field.cols * field.rows * 4);
    field.shade(rgba, 0.3);
    return { acc: Buffer.from(field.acc.buffer.slice(0)), rgba: Buffer.from(rgba.buffer.slice(0)) };
  };
  const shared = new RippleField(geo);
  const first = snapshot(shared, frameOf(15));
  const later = snapshot(shared, frameOf(30));
  const again = snapshot(shared, frameOf(15)); // same instance, evaluated after another frame
  const fresh = snapshot(new RippleField(geo), frameOf(15)); // brand new instance, evaluated cold
  assert.ok(Buffer.compare(first.acc, again.acc) === 0 && Buffer.compare(first.rgba, again.rgba) === 0);
  assert.ok(Buffer.compare(first.acc, fresh.acc) === 0 && Buffer.compare(first.rgba, fresh.rgba) === 0);
  assert.ok(Buffer.compare(first.acc, later.acc) !== 0, "different frames do differ");
  // The exact scenario from the brief: frame 900 after frame 100 equals frame 900 first.
  const a = new RippleField(geo), b = new RippleField(geo);
  snapshot(a, 100);
  const after = snapshot(a, 900), direct = snapshot(b, 900);
  assert.ok(Buffer.compare(after.acc, direct.acc) === 0 && Buffer.compare(after.rgba, direct.rgba) === 0);
});

test("field values and shaded pixels are finite across the whole piece", () => {
  const events = buildRippleEvents(CANON);
  const field = new RippleField(fieldGeometry(1080, 1920, 8, 64));
  const rgba = new Uint8ClampedArray(field.cols * field.rows * 4);
  let busiest = 0;
  for (let frame = 0; frame < CANON.totalFrames; frame += 37) {
    field.evaluate(events, frame, pieceTime(CANON, frame));
    busiest = Math.max(busiest, field.activeCount);
    for (const value of field.acc) assert.ok(Number.isFinite(value), `non-finite field value at frame ${frame}`);
    field.shade(rgba, 1);
    for (let i = 0; i < rgba.length; i += 4) assert.ok(rgba[i + 3] === 255);
  }
  assert.ok(busiest >= 10 && busiest <= MAX_SOURCES, `busiest frame has ${busiest} sources`);
  // Waves have fully died away before the end of the video (so the fade-out is a clean calm tank).
  field.evaluate(events, CANON.totalFrames - 1, pieceTime(CANON, CANON.totalFrames - 1));
  assert.equal(field.activeCount, 0);
});

test("empty and one-note pieces work", () => {
  const empty = syntheticScene([]);
  const none = buildRippleEvents(empty);
  assert.deepEqual(none, []);
  assert.deepEqual(buildRippleAccents(empty.notes, none), []);
  const field = coarse();
  const rgba = new Uint8ClampedArray(field.cols * field.rows * 4);
  field.evaluate(none, 40, pieceTime(empty, 40));
  field.shade(rgba, 0);
  assert.equal(field.activeCount, 0);
  assert.equal(energy(field), 0);
  assert.ok(rgba.every((v, i) => i % 4 !== 3 || v === 255));

  const single = syntheticScene([note(1, 64, 100, 7)]); // one note on track 7 only
  const [event] = buildRippleEvents(single);
  assert.equal(buildRippleEvents(single).length, 1);
  assert.equal(single.pitchMin, single.pitchMax);
  assert.ok(Math.abs(event.x - 540) <= 30, "a lone pitch sits in the middle of the tank");
  for (const frame of [0, event.startFrame - 1, event.startFrame, event.startFrame + 30, event.startFrame + 400]) {
    field.evaluate([event], frame, pieceTime(single, frame));
    field.shade(rgba, 0);
    for (const value of field.acc) assert.ok(Number.isFinite(value));
  }
  assert.ok(buildRippleAccents(single.notes, [event]).length >= 1);
});

test("thousands of notes cap the active sources and stay fast", () => {
  const random = mulberry32(7);
  const notes: MidiNote[] = [];
  for (let i = 0; i < 4000; i++) notes.push(note(i * 0.015 + random() * 0.01, 30 + Math.floor(random() * 60), 40 + Math.floor(random() * 80), i % 4, 0.3));
  const scene = syntheticScene(notes);
  const events = buildRippleEvents(scene);
  assert.equal(events.length, 4000);
  const field = new RippleField(fieldGeometry(1080, 1920, 6, 64));
  const frame = RIPPLE_LEAD_FRAMES + 30 * FPS;
  const started = performance.now();
  for (let k = 0; k < 4; k++) field.evaluate(events, frame + k, pieceTime(scene, frame + k));
  const perFrame = (performance.now() - started) / 4;
  assert.equal(field.activeCount, MAX_SOURCES);
  assert.ok(perFrame < 600, `${perFrame.toFixed(0)} ms per frame with 4000 notes`);
});

test("camera and accents: the final chord is the strongest kick, voice entrances are marked", () => {
  const events = buildRippleEvents(CANON);
  const accents = buildRippleAccents(CANON.notes, events);
  const finalChordStart = CANON.notes[CANON.notes.length - 8].timeSec;
  const finale = accents.find((a) => Math.abs(a.timeSec - finalChordStart) < 0.01);
  assert.ok(finale && finale.strength >= 0.9, "the rolled final chord counts as one loud chord");
  const kick = cameraKick(accents, finalChordStart + 0.02);
  assert.ok(kick.zoom > 0.012, `final chord punch-in ${kick.zoom}`);
  assert.equal(cameraKick(accents, -1).zoom, 0);
  // Entrances (Canon I enters on chord 8, about 11.4 s) carry a strong accent.
  const entrance = accents.find((a) => Math.abs(a.timeSec - 11.43) < 0.05);
  assert.ok(entrance && entrance.strength >= 0.5);
  for (let i = 1; i < accents.length; i++) assert.ok(accents[i].timeSec >= accents[i - 1].timeSec);
  // Climax notes are taller and last longer than ordinary ones.
  const ordinary = events.find((e) => e.emphasis < 0.1)!;
  const climax = events[events.length - 1];
  assert.ok(climax.emphasis > 0.9 && climax.amplitude > ordinary.amplitude && climax.life > ordinary.life);
});

test("average field time per dense frame stays well inside the painter budget", (t) => {
  const events = buildRippleEvents(CANON);
  const field = new RippleField(fieldGeometry()); // the shipped geometry
  const rgba = new Uint8ClampedArray(field.cols * field.rows * 4);
  const start = RIPPLE_LEAD_FRAMES + 30 * FPS; // dense arpeggio plus three canon voices
  const run = (frames: number) => {
    let sources = 0;
    const began = performance.now();
    for (let k = 0; k < frames; k++) {
      const frame = start + k * 3;
      field.evaluate(events, frame, pieceTime(CANON, frame));
      field.shade(rgba, 0.2);
      sources += field.activeCount;
    }
    return { ms: (performance.now() - began) / frames, sources: sources / frames };
  };
  run(4); // warm up the JIT
  const { ms, sources } = run(24);
  t.diagnostic(`dense frames: ${ms.toFixed(1)} ms per frame (evaluate + shade), ${sources.toFixed(1)} sources on average`);
  assert.ok(sources >= 8, "the measured frames are dense");
  assert.ok(ms < 250, `${ms.toFixed(1)} ms per frame`); // the budget is ~120 ms for the whole painter; the threshold is generous on purpose
});

test("the scene spec is wired up", () => {
  assert.equal(RIPPLE_TANK.label, "Ripple Tank");
  assert.equal(RIPPLE_TANK.leadFrames, RIPPLE_LEAD_FRAMES);
  assert.ok(RIPPLE_TANK.leadFrames >= 30 && RIPPLE_TANK.leadFrames <= 45);
  assert.equal(typeof RIPPLE_TANK.createPainter, "function");
});

/** Minimal recording 2D context, enough to run the painter in Node and look at what it draws. */
function mockContext() {
  const state: Record<string, unknown> = { globalAlpha: 1, globalCompositeOperation: "source-over", fillStyle: "" };
  const calls: { name: string; args: unknown[]; alpha: number; op: string }[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      if (prop in state) return state[prop];
      if (prop === "measureText") return (text: string) => ({ width: text.length * 12, actualBoundingBoxAscent: 20, actualBoundingBoxDescent: 5, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 12 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop() {} });
      if (prop === "createImageData") return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      return (...args: unknown[]) => { calls.push({ name: prop, args, alpha: state.globalAlpha as number, op: state.globalCompositeOperation as string }); };
    },
    set(_target, prop: string, value) { state[prop] = value; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, state };
}

test("the painter runs on every kind of frame and ends on a clean fade", () => {
  const globals = globalThis as { document?: unknown };
  const saved = globals.document;
  globals.document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  try {
    const painter = RIPPLE_TANK.createPainter(CANON, RIPPLE_TANK.label);
    const finalChord = RIPPLE_LEAD_FRAMES + Math.ceil(CANON.notes[CANON.notes.length - 8].timeSec * FPS);
    for (const frame of [0, RIPPLE_LEAD_FRAMES - 1, RIPPLE_LEAD_FRAMES, 400, 1836, finalChord, finalChord + 90, CANON.totalFrames - 20, CANON.totalFrames - 1]) {
      const { ctx, calls } = mockContext();
      painter(ctx, frame);
      assert.ok(calls.some((c) => c.name === "drawImage"), `frame ${frame} draws the water`);
      if (frame === CANON.totalFrames - 1) {
        const last = calls.filter((c) => c.name === "fillRect").pop()!;
        assert.deepEqual(last.args, [0, 0, 1080, 1920]);
        assert.equal(last.alpha, 1, "the last frame is fully faded out");
      }
    }
  } finally {
    globals.document = saved;
  }
});
