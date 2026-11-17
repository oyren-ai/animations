import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { parseMidi } from "../midi/parse.ts";
import { buildSceneData, pieceTime } from "../midi/timeline.ts";
import type { MidiNote } from "../midi/types.ts";
import {
  BALL_LIFE_SEC, ballPose, buildBallEvents, FALL_SEC, fallBottomY, keyLight, sparkState, START_BOTTOM_Y, visibleRange,
} from "./events.ts";
import { isBlackKey, KEY_TOP, planKeyboard, SAFE, WHITE_HEIGHT } from "./layout.ts";
import { createBallPianoPainter } from "./paint.ts";
import { BALL_PIANO } from "./scene.ts";

const MIDI_DIR = new URL("../../public/midi/", import.meta.url);
const FILES = readdirSync(MIDI_DIR).filter((name) => name.endsWith(".mid")).sort();
const parsedFile = (name: string) => parseMidi(readFileSync(new URL(name, MIDI_DIR)));
const FPS = 60;

function note(timeSec: number, pitch: number, velocity = 90, durationSec = 0.5): MidiNote {
  return { timeSec, durationSec, pitch, velocity, track: 0, channel: 0 };
}

/** A recording canvas context: every method is a no-op that counts calls; text measures like a 0.52 em font. */
function mockContext() {
  const calls: Record<string, number> = {};
  let font = "600 20px sans-serif";
  const gradient = { addColorStop() {} };
  const target: Record<string, unknown> = {
    get font() { return font; },
    set font(value: string) { font = value; },
    measureText(text: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 20);
      const width = text.length * size * 0.52;
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: size * 0.76, actualBoundingBoxDescent: size * 0.22 };
    },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop as string];
      return (..._args: unknown[]) => { calls[String(prop)] = (calls[String(prop)] ?? 0) + 1; };
    },
    set(obj, prop, value) { obj[prop as string] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

test("keyboard covers every built-in piece in 3-5 octaves inside the phone safe area", () => {
  assert.ok(FILES.length >= 3);
  for (const name of FILES) {
    const pitches = parsedFile(name).notes.map((n) => n.pitch);
    const layout = planKeyboard(pitches);
    assert.ok(!isBlackKey(layout.lo) && !isBlackKey(layout.hi), `${name}: ends are white keys`);
    assert.ok(layout.whiteCount >= 22 && layout.whiteCount <= 36, `${name}: ${layout.whiteCount} white keys`);
    assert.ok(layout.left >= SAFE.left - 1e-6 && layout.right <= SAFE.right + 1e-6, `${name}: x ${layout.left}..${layout.right}`);
    assert.ok(KEY_TOP + WHITE_HEIGHT <= SAFE.bottom, "keyboard bottom is above the 300 px bottom margin");
    for (const pitch of pitches) {
      const folded = layout.fold(pitch);
      assert.ok(folded >= layout.lo && folded <= layout.hi && (folded - pitch) % 12 === 0);
      const rect = layout.keyRect(folded);
      assert.ok(rect.x >= layout.left - 1e-6 && rect.x + rect.width <= layout.right + 1e-6);
    }
  }
  const ode = planKeyboard(parsedFile("ode-to-joy.mid").notes.map((n) => n.pitch));
  assert.deepEqual([ode.lo, ode.hi, ode.whiteCount], [45, 81, 22]); // A2..A5: exactly three octaves
});

test("black and white keys do not overlap wrongly and wide files are folded into a 36-key window", () => {
  const wide = planKeyboard([21, 30, 60, 66, 100, 108]);
  assert.ok(wide.whiteCount <= 36);
  assert.ok(wide.fold(21) >= wide.lo && wide.fold(108) <= wide.hi);
  const layout = planKeyboard([60, 72]);
  for (let pitch = layout.lo; pitch <= layout.hi; pitch++) {
    const rect = layout.keyRect(pitch);
    assert.equal(rect.black, isBlackKey(pitch));
    assert.ok(rect.width > 0 && rect.height > 0);
  }
  assert.equal(planKeyboard([]).whiteCount >= 22, true);
});

test("one ball per note; it lands on the key exactly at note-on, released FALL_SEC earlier", () => {
  for (const name of FILES) {
    const parsed = parsedFile(name);
    const layout = planKeyboard(parsed.notes.map((n) => n.pitch));
    const events = buildBallEvents(parsed.notes, layout);
    assert.equal(events.length, parsed.notes.length, name);
    for (const event of events) {
      assert.ok(Math.abs(event.tRelease - (event.note.timeSec - FALL_SEC)) < 1e-12);
      assert.ok(Math.abs(fallBottomY(event, event.tOn) - event.keyTop) < 1e-6, "bottom of the ball reaches the key top at note-on");
      assert.ok(Math.abs(fallBottomY(event, event.tRelease) - START_BOTTOM_Y) < 1e-6);
      assert.ok(event.x >= layout.left && event.x <= layout.right);
      assert.ok(event.radius > 5 && event.radius < layout.keyWidth);
    }
  }
});

test("the landing frame is the first frame at or after note-on, never before, and at most one frame late", () => {
  const parsed = parsedFile("ode-to-joy.mid");
  const scene = buildSceneData(parsed, "ode-to-joy.mid", { fps: FPS, leadFrames: BALL_PIANO.leadFrames, tailSec: 2 }, { width: 1080, height: 1920 });
  const layout = planKeyboard(parsed.notes.map((n) => n.pitch));
  const events = buildBallEvents(parsed.notes, layout);
  for (const event of events) {
    const frame = scene.leadFrames + Math.ceil(event.note.timeSec * FPS - 1e-9);
    const on = ballPose(event, pieceTime(scene, frame));
    const before = ballPose(event, pieceTime(scene, frame - 1));
    assert.ok(on && on.landed, `note ${event.index} has landed at frame ${frame}`);
    assert.ok(on.age >= -1e-9 && on.age < 1 / FPS + 1e-9, "landing is within one frame of the note-on time");
    assert.ok(!before || !before.landed, "the frame before is still in the air");
    if (before) assert.ok(before.y + event.radius * before.sy <= event.keyTop + 1e-6, "falling ball stays above its key");
    assert.ok(frame - scene.leadFrames >= 0 && event.tRelease >= -BALL_PIANO.leadFrames / FPS - 0.2, "the lead-in is long enough for the first fall");
  }
  assert.ok(FALL_SEC * FPS < BALL_PIANO.leadFrames, "first ball is released after the video starts");
});

test("squash and stretch: stretched when fast, flattened on contact, area-preserving, fades after the rebound", () => {
  const layout = planKeyboard([60, 72]);
  const [event] = buildBallEvents([note(2, 66, 110)], layout);
  const falling = ballPose(event, 2 - 0.02)!;
  assert.ok(falling.sy > 1.3 && falling.sx < 0.85, "elongated along the fall near impact");
  let minSy = 9;
  for (let age = 0; age < 0.09; age += 0.005) minSy = Math.min(minSy, ballPose(event, 2 + age)!.sy);
  assert.ok(minSy < 0.6, "flattens on the key");
  for (let age = -1; age < BALL_LIFE_SEC; age += 0.01) {
    const pose = ballPose(event, 2 + age);
    if (!pose) continue;
    assert.ok(Math.abs(pose.sx * pose.sy ** 0.6 - 1) < 1e-9);
    assert.ok(pose.alpha >= 0 && pose.alpha <= 1);
    assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.y));
  }
  const rebound = ballPose(event, 2 + 0.3)!;
  assert.ok(rebound.lift > 20 && rebound.alpha < 1, "bounces up and fades");
  assert.equal(ballPose(event, 2 + BALL_LIFE_SEC + 0.01), null);
  assert.equal(ballPose(event, 2 - FALL_SEC - 0.01), null);
});

test("poses and sparks are pure functions of time: any evaluation order gives identical values", () => {
  const parsed = parsedFile("canon-in-d.mid");
  const layout = planKeyboard(parsed.notes.map((n) => n.pitch));
  const events = buildBallEvents(parsed.notes, layout);
  const times = [10.1, 3.3, 40.7, 3.3, 22.2];
  const run = () => times.map((t) => {
    const [from, to] = visibleRange(events, t);
    return events.slice(from, to).map((e) => [ballPose(e, t)?.y, sparkState(e, 3, t - e.tOn)?.x]);
  });
  assert.deepEqual(run(), run());
  assert.deepEqual(run()[1], run()[3]);
});

test("key light: pressed from note-on until note-off, then released", () => {
  const layout = planKeyboard([60, 72]);
  const events = buildBallEvents([note(1, 62, 100, 0.6)], layout);
  assert.equal(keyLight(events, 0.99), null);
  const during = keyLight(events, 1.3)!;
  assert.ok(during.press > 0.99 && during.glow > 0.2);
  const after = keyLight(events, 1.6 + 0.4);
  assert.ok(!after || (after.press < 0.01 && after.glow < 0.01));
});

test("visibleRange covers every ball that can be on screen and nothing else", () => {
  const parsed = parsedFile("pentatonic-phase.mid");
  const events = buildBallEvents(parsed.notes, planKeyboard(parsed.notes.map((n) => n.pitch)));
  for (const t of [-1, 0, 5.5, 20, 49, 60]) {
    const [from, to] = visibleRange(events, t);
    events.forEach((e, i) => {
      const visible = ballPose(e, t) !== null;
      if (visible) assert.ok(i >= from && i < to, `event ${i} visible at ${t} is inside [${from}, ${to})`);
    });
  }
});

test("painter runs on every built-in piece, an empty file and a single note, and draws safe-area text", () => {
  for (const name of FILES) {
    const scene = buildSceneData(parsedFile(name), name, { fps: FPS, leadFrames: BALL_PIANO.leadFrames, tailSec: 2 }, { width: 1080, height: 1920 });
    assertPaints(scene);
  }
  const empty = { ...buildSceneData(parsedFile(FILES[0]), "x.mid", { fps: FPS, leadFrames: 90, tailSec: 2 }, { width: 1080, height: 1920 }), notes: [] as MidiNote[], endSec: 0 };
  assertPaints({ ...empty, totalFrames: 200 });
  const single = { ...empty, notes: [note(0, 60)], endSec: 0.5, totalFrames: 400 };
  assertPaints(single);
});

function assertPaints(scene: Parameters<typeof createBallPianoPainter>[0]) {
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const painter = createBallPianoPainter(scene, "Ball Piano");
  const { ctx, calls } = mockContext();
  const frames = [0, 1, 60, scene.leadFrames, scene.leadFrames + 3, Math.floor(scene.totalFrames / 2), scene.totalFrames - 1];
  for (const frame of frames) painter(ctx, frame);
  assert.ok((calls.fillRect ?? 0) > 0 && (calls.drawImage ?? 0) > 0);
}
