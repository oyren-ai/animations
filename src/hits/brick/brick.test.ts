import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { measureStereoLufsAndPeak } from "../../audio-reactive/synth.ts";
import { assertReelSafeBox, type ReelBox } from "../../shared/reelUtils.ts";
import { createMockCanvas } from "../mockCanvas.ts";
import { HIT_SEED } from "../types.ts";
import { brightnessRatio, thinEvents } from "../voices.ts";
import { BRICK_NOTE_MIN_GAP, buildBrickAudio, buildBrickSchedule } from "./audio.ts";
import { BRICK_SPEC, brickEscape } from "./index.ts";
import { paintScene } from "./paint.ts";
import { BRICK, ODE_TO_JOY, SCENE_FRAMES, WALL, simulateBrick, type BrickTrace } from "./sim.ts";

const FIRST_15 = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62];

let cached: BrickTrace | undefined;
function trace(): BrickTrace {
  cached ??= brickEscape.simulate(HIT_SEED) as BrickTrace;
  return cached;
}

function escapeOf(t: BrickTrace) {
  assert.ok(t.escape, "the ball gets out");
  return t.escape;
}

test("brick: the spec keeps its id, slug, question and scene length, and is a real composition", () => {
  assert.equal(BRICK_SPEC.id, "BrickEscape");
  assert.equal(BRICK_SPEC.slug, "brick-escape");
  assert.equal(BRICK_SPEC.question, "Will it get out in time?");
  assert.equal(BRICK_SPEC.sceneFrames, 24 * 60);
  assert.equal(BRICK_SPEC.sceneFrames, SCENE_FRAMES);
  assert.ok(BRICK_SPEC.rule.length <= 64);
  assert.equal(brickEscape.spec, BRICK_SPEC);
});

test("brick: digest is deterministic for the seed and changes when the trace changes", () => {
  const a = brickEscape.digest(brickEscape.simulate(HIT_SEED));
  const b = brickEscape.digest(brickEscape.simulate(HIT_SEED));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.notEqual(a, brickEscape.digest(brickEscape.simulate(HIT_SEED + 1)));
  const tuned = simulateBrick(HIT_SEED, { ...BRICK.params, doorDelta: BRICK.params.doorDelta + 0.5 });
  assert.notEqual(a, brickEscape.digest(tuned));
});

test("brick: the launch is never axis aligned and the ball never moves more than 12 px per step", () => {
  const t = trace();
  assert.ok(Math.abs(t.launch.vx) > 400 && Math.abs(t.launch.vy) > 400, JSON.stringify(t.launch));
  assert.ok(BRICK.params.speed / BRICK.stepHz <= 12, "substep keeps the move under 12 px");
  assert.ok(Math.hypot(t.launch.vx, t.launch.vy) > 1800 && Math.hypot(t.launch.vx, t.launch.vy) < 2300, "about 2,000 px/s");
});

test("brick: one brick per wall bounce, none for the escape, profile and counters agree", () => {
  const t = trace();
  const e = escapeOf(t);
  assert.equal(t.bricks.length, t.bounces.length);
  const levels = t.profile.reduce((sum, wall) => sum + wall.reduce((s, v) => s + v, 0), 0);
  assert.equal(levels, t.bounces.length, "the sum of every slot level is the bounce count");
  assert.ok(t.bounces.every((b) => b.t < e.t), "no bounce is recorded after the ball is out");
  assert.equal(t.bricksAt[SCENE_FRAMES - 1], t.bounces.length, "the counter ends on the bounce count");
  assert.equal(e.bricks, t.bounces.length, "the escape adds no brick");
  for (let i = 1; i < t.bounces.length; i++) assert.ok(t.bounces[i].t >= t.bounces[i - 1].t);
  for (let f = 1; f < SCENE_FRAMES; f++) assert.ok(t.bricksAt[f] - t.bricksAt[f - 1] <= 4 && t.bricksAt[f] >= t.bricksAt[f - 1]);
  assert.ok(t.bounces.length >= 48, `only ${t.bounces.length} bounces`);
});

test("brick: bricks spread over all four walls and every wall bounce lands on a real slot", () => {
  const t = trace();
  for (const wall of [WALL.left, WALL.right, WALL.top, WALL.bottom]) {
    const count = t.bricks.filter((b) => b.wall === wall).length;
    assert.ok(count >= 5, `wall ${wall} has only ${count} bricks`);
  }
  for (const b of t.bricks) {
    const slots = b.wall < 2 ? BRICK.slotsV : BRICK.slotsH;
    assert.ok(b.slot >= 0 && b.slot < slots);
    assert.ok(b.level >= 1 && b.level <= BRICK.maxLevel);
  }
});

test("brick: the door width never increases and equals w0 - delta x bricks at every frame", () => {
  const t = trace();
  const { doorW0, doorDelta } = BRICK.params;
  for (let f = 0; f < SCENE_FRAMES; f++) {
    assert.ok(Math.abs(t.doorW[f] - Math.max(0, doorW0 - doorDelta * t.bricksAt[f])) < 1e-6, `frame ${f}`);
    if (f > 0) assert.ok(t.doorW[f] <= t.doorW[f - 1] + 1e-9, `door grew at frame ${f}`);
  }
  assert.equal(t.doorW[0], doorW0);
});

test("brick: the ball gets out between 20.0 s and 22.5 s, never before 17 s, with the door nearly shut", () => {
  const t = trace();
  const e = escapeOf(t);
  const sec = e.frame / 60;
  assert.ok(sec >= 20.0 && sec <= 22.5, `escape at ${sec.toFixed(2)} s`);
  assert.ok(sec >= 17);
  assert.ok(e.doorW <= 1.35 * 2 * BRICK.ballR + 1e-9, `door ${e.doorW.toFixed(1)} px at the escape`);
  assert.ok(e.doorW >= 2 * BRICK.ballR, "the ball really fits");
  assert.ok(Math.abs(e.y - BRICK.doorY) <= e.doorW / 2 - BRICK.ballR + 1e-6, "the ball leaves through the door");
  assert.ok(SCENE_FRAMES - e.frame >= 90, "the payoff holds at least 1.5 s");
});

test("brick: no ball position outside the canvas before the escape, and the escape frame is the first frame out", () => {
  const t = trace();
  const e = escapeOf(t);
  for (let f = 0; f < e.frame; f++) {
    assert.ok(t.ballX[f] >= 0 && t.ballX[f] <= 1080 && t.ballY[f] >= 0 && t.ballY[f] <= 1920, `frame ${f}: ${t.ballX[f]}, ${t.ballY[f]}`);
  }
  assert.ok(t.ballX[e.frame] < 0, "the ball is through the door on the escape frame");
  for (let s = 0; s < e.step; s++) {
    assert.ok(t.stepX[s] >= BRICK.lining + BRICK.ballR - 2 || Math.abs(t.stepY[s] - BRICK.doorY) < 330, `step ${s} is inside the wall`);
  }
});

test("brick: thickness never goes above the cap and bricks stack in 40 px steps", () => {
  const t = trace();
  assert.ok(t.maxThickness <= BRICK.capPx, `thickness ${t.maxThickness}`);
  assert.ok(BRICK.lining + BRICK.brickDepth * BRICK.maxLevel <= BRICK.capPx);
  assert.equal(BRICK.brickDepth, 40);
  assert.equal(BRICK.capPx, 280);
  for (const wall of t.profile) for (const v of wall) assert.ok(v <= BRICK.maxLevel);
});

test("brick: the 30-note tune is Ode to Joy and each bounce plays the next note", () => {
  const t = trace();
  assert.equal(ODE_TO_JOY.length, 30);
  assert.deepEqual(ODE_TO_JOY.slice(0, 15), FIRST_15);
  assert.deepEqual(t.bounces.slice(0, 15).map((b) => b.note), FIRST_15);
  t.bounces.forEach((b, i) => assert.equal(b.note, ODE_TO_JOY[i % ODE_TO_JOY.length]));
  const schedule = buildBrickSchedule(t);
  assert.equal(schedule.notes.length, t.bounces.length, "notes played equal bounces");
  assert.deepEqual(schedule.notes.slice(0, 15).map((n) => n.midi), FIRST_15);
});

test("brick: the audio schedule has a bell at every bounce time and respects a rate cap", () => {
  const t = trace();
  const schedule = buildBrickSchedule(t);
  schedule.notes.forEach((n, i) => {
    const b = t.bounces[i];
    assert.ok(n.t >= b.t - 1e-9, `bell ${i} plays before its bounce`);
    assert.ok(n.t - b.t <= 0.25, `bell ${i} is ${(n.t - b.t).toFixed(3)} s late`);
    assert.ok(Math.abs(n.pan) <= 1);
  });
  for (let i = 1; i < schedule.notes.length; i++) {
    assert.ok(schedule.notes[i].t - schedule.notes[i - 1].t >= BRICK_NOTE_MIN_GAP - 1e-9, `bells ${i - 1} and ${i} are too close`);
  }
  assert.equal(thinEvents(schedule.notes, 1 / (BRICK_NOTE_MIN_GAP - 0.001)).length, schedule.notes.length, "the cap drops nothing");
  assert.ok(schedule.thuds.length > 0 && schedule.thuds.length <= schedule.notes.length);
  const e = escapeOf(t);
  assert.ok(schedule.escapeT !== null && Math.abs(schedule.escapeT - e.t) < 1e-9);
});

test("brick: audio is warm, stereo and mastered, and the bed runs to the last frame", () => {
  const t = trace();
  const audio = buildBrickAudio(t);
  const m = measureStereoLufsAndPeak(audio.buffer.left, audio.buffer.right);
  assert.ok(m.integratedLufs >= -15 && m.integratedLufs <= -13, `LUFS ${m.integratedLufs.toFixed(2)}`);
  assert.ok(m.truePeakDb <= -1.5, `true peak ${m.truePeakDb.toFixed(2)}`);
  assert.ok(brightnessRatio(audio.buffer) < 0.04);
  const tail = audio.buffer.left.length - 1;
  let rms = 0;
  for (let i = tail - 4800; i <= tail; i++) rms += audio.buffer.left[i] ** 2 + audio.buffer.right[i] ** 2;
  assert.ok(Math.sqrt(rms / 9602) > 0.002, "pad bed still sounds in the last 0.1 s");
});

test("brick: frame 0 draws zero bricks and exactly one ball, and no result text", () => {
  const t = trace();
  const mock = createMockCanvas();
  const { stats, boxes } = paintScene(mock.ctx, t, 0);
  assert.equal(stats.bricks, 0);
  assert.equal(stats.balls, 1);
  assert.ok(stats.dots >= 80, `${stats.dots} ambient dots`);
  assert.ok(boxes.length >= 7, "question, rule, two counters (4 boxes), CTA and footer");
  const drawn = mock.texts.map((x) => x.text);
  assert.ok(!drawn.includes("IT GOT OUT!"));
  assert.ok(drawn.includes("BRICKS") && drawn.includes("0"), "brick counter starts at 0");
  assert.ok(drawn.includes("EXIT") && drawn.includes(`${BRICK.params.doorW0} px`), "exit width starts at its full size");
});

test("brick: the escape frame draws IT GOT OUT! and nothing draws it earlier", () => {
  const t = trace();
  const e = escapeOf(t);
  const at = createMockCanvas();
  paintScene(at.ctx, t, e.frame);
  assert.ok(at.texts.some((x) => x.text === "IT GOT OUT!"));
  const before = createMockCanvas();
  paintScene(before.ctx, t, e.frame - 1);
  assert.ok(!before.texts.some((x) => x.text === "IT GOT OUT!"));
  const end = createMockCanvas();
  const last = paintScene(end.ctx, t, SCENE_FRAMES - 1);
  assert.ok(end.texts.some((x) => x.text === "IT GOT OUT!"), "the result holds to the last frame");
  assert.equal(last.stats.balls, 0, "the ball is gone");
  assert.equal(last.stats.bricks, t.bricks.length);
});

test("brick: the explain line fades in at 2.5 s and every text box stays inside the safe zone", () => {
  const t = trace();
  const early = createMockCanvas();
  paintScene(early.ctx, t, 60);
  assert.ok(!early.texts.some((x) => x.text.startsWith("Every bounce plays the next note")));
  const later = createMockCanvas();
  paintScene(later.ctx, t, 60 * 4);
  assert.ok(later.texts.some((x) => x.text === "Every bounce plays the next note. Name the song."));
  const e = escapeOf(t);
  const frames = [0, 1, 17, 60, 150, 151, 300, 600, 900, 1200, e.frame - 30, e.frame - 1, e.frame, e.frame + 1, e.frame + 30, e.frame + 90, SCENE_FRAMES - 1];
  for (const f of frames) {
    const mock = createMockCanvas();
    const { boxes } = paintScene(mock.ctx, t, f);
    for (const box of boxes as ReelBox[]) assertReelSafeBox(box);
    assert.ok(mock.fillRects.some((r) => r.w >= 1080 && r.h >= 1920), `frame ${f} paints a full backdrop`);
  }
});

test("brick: the bricks are drawn from the trace and the counters follow it", () => {
  const t = trace();
  const mid = Math.floor(t.bounces[20].frame + 12);
  const mock = createMockCanvas();
  const { stats } = paintScene(mock.ctx, t, mid);
  assert.equal(stats.bricks, t.bricksAt[mid]);
  assert.ok(stats.bricks >= 20);
  assert.ok(mock.texts.some((x) => x.text === String(t.bricksAt[mid])));
  const grid = mock.coverageGrid(6, 10);
  assert.ok(grid >= 0.5, `grid coverage ${grid}`);
});

test("brick: with the door shut from the start the ball is walled in and the painter says so", () => {
  const walled = simulateBrick(HIT_SEED, { ...BRICK.params, doorW0: 0 });
  assert.equal(walled.escape, null);
  assert.ok(walled.bounces.length >= 48);
  const mock = createMockCanvas();
  const { stats, boxes } = paintScene(mock.ctx, walled, SCENE_FRAMES - 1);
  assert.ok(mock.texts.some((x) => x.text === "WALLED IN"));
  assert.equal(stats.balls, 1);
  for (const box of boxes) assertReelSafeBox(box);
});

test("brick: the last-chance slow motion slows the picture, keeps frames in order and stays short", () => {
  const t = trace();
  const e = escapeOf(t);
  assert.ok(t.minRate >= 0.2 && t.minRate <= 0.35, `slowest rate ${t.minRate}`);
  for (let f = 1; f < SCENE_FRAMES; f++) assert.ok(t.frameStep[f] > t.frameStep[f - 1], `frame ${f} does not move forward`);
  let slowFrames = 0;
  for (let f = 1; f < e.frame; f++) {
    if (t.rate[f] >= 0.5) continue;
    slowFrames += 1;
    const move = Math.hypot(t.ballX[f] - t.ballX[f - 1], t.ballY[f] - t.ballY[f - 1]);
    assert.ok(move <= 0.75 * (t.params.speed / 60), `frame ${f}: the ball still moves ${move.toFixed(1)} px per frame in slow motion`);
  }
  assert.ok(slowFrames >= 20, "the slow motion is visible");
  let total = 0;
  for (let f = 0; f < SCENE_FRAMES; f++) {
    if (t.rate[f] < 0.95) {
      total += 1;
      assert.ok(t.doorW[f] < BRICK.slowGateW + t.params.doorDelta, "slow motion only starts in the closing phase");
    }
  }
  assert.ok(total / 60 <= 2.5, `slow motion lasts ${(total / 60).toFixed(2)} s`);
});

test("brick: the escape is not knife-edge, a launch angle nudge of 0.004 degrees keeps it", () => {
  const t = trace();
  const e = escapeOf(t);
  for (const d of [-0.004, 0.004]) {
    const nudged = simulateBrick(HIT_SEED, { ...BRICK.params, angleDeg: BRICK.params.angleDeg + d });
    assert.ok(nudged.escape, `no escape at ${d}`);
    assert.ok(Math.abs(nudged.escape.frame - e.frame) <= 6, `escape moved to frame ${nudged.escape.frame}`);
    assert.equal(nudged.bounces.length, t.bounces.length);
  }
});

test("brick: bricks stay a slot away from the exit and neighbouring columns never differ by more than two levels", () => {
  const t = trace();
  const span = 1920 / BRICK.slotsV;
  t.bricks.forEach((b, i) => {
    if (b.wall !== WALL.left) return;
    const g = t.params.doorW0 - t.params.doorDelta * i;
    if (g <= 0) return;
    const y0 = b.slot * span;
    const y1 = y0 + span;
    assert.ok(y1 <= BRICK.doorY - g / 2 - span + 1e-6 || y0 >= BRICK.doorY + g / 2 + span - 1e-6, `brick ${i} sits next to the exit`);
  });
  for (const wall of t.profile) for (let s = 1; s < wall.length; s++) assert.ok(Math.abs(wall[s] - wall[s - 1]) <= 2);
});

test("brick: simulation is fast and the source avoids Math.random, Date, I/O and Buffer", () => {
  const t0 = performance.now();
  simulateBrick(HIT_SEED);
  assert.ok(performance.now() - t0 < 5000, "simulate() stays under about 5 s");
  for (const file of ["sim.ts", "paint.ts", "audio.ts", "index.ts"]) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.ok(!/Math\.random|Date\.now|new Date\b|\bBuffer\b|node:fs|fetch\(/.test(src), `${file} uses a forbidden API`);
  }
});
