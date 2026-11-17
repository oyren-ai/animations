import assert from "node:assert/strict";
import test from "node:test";
import { assertReelSafeBox, type ReelBox } from "../../shared/reelUtils.ts";
import { CTA_LINES } from "../kit.ts";
import { createMockCanvas } from "../mockCanvas.ts";
import { HIT_SEED } from "../types.ts";
import { planWarAudio } from "./audio.ts";
import { colourWarV4, WAR_SPEC } from "./index.ts";
import { ambientDotAt, BANNER_FRAMES, clockText } from "./paint.ts";
import {
  BALL_R,
  CELLS,
  CELL,
  CLOCK_ZERO_FRAME,
  COLS,
  H,
  pickUnderdog,
  ROWS,
  SCENE_FRAMES,
  simulateWar,
  TEAM_COUNT,
  TEAM_NAMES,
  TICK_FRAMES,
  W,
  type WarTrace,
} from "./sim.ts";

/**
 * Specific rules of ColourWarV4: one ball per colour, balls paint what they touch, and the only bonus
 * is the underdog rule on the rule line. Everything is read back from the pre-baked trace.
 */

let cached: WarTrace | undefined;
function getTrace(): WarTrace {
  cached ??= colourWarV4.simulate(HIT_SEED);
  return cached;
}

/** Index 0 is the unowned count, 1..4 the four teams. Counted straight from the ownership bytes. */
function cellCounts(trace: WarTrace, frame: number): number[] {
  const counts = [0, 0, 0, 0, 0];
  const base = frame * CELLS;
  for (let i = 0; i < CELLS; i++) counts[trace.own[base + i]]++;
  return counts;
}

function teamCells(trace: WarTrace, frame: number): number[] {
  return cellCounts(trace, frame).slice(1);
}

function ballCounts(trace: WarTrace, frame: number): number[] {
  const counts = new Array<number>(TEAM_COUNT).fill(0);
  for (let i = 0; i < trace.nBalls; i++) if (trace.ballBorn[i] <= frame) counts[trace.ballTeam[i]]++;
  return counts;
}

function argmax(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

function paintFrame(trace: WarTrace, frame: number) {
  const mock = createMockCanvas();
  const boxes: ReelBox[] = colourWarV4.paint(mock.ctx, trace, frame);
  return { mock, boxes, drawn: mock.texts.map((t) => t.text) };
}

test("the spec keeps its id, slug, question and scene length, and the rule line stays short", () => {
  assert.equal(WAR_SPEC.id, "ColourWarV4");
  assert.equal(WAR_SPEC.slug, "colour-war-v4");
  assert.equal(WAR_SPEC.question, "Which colour takes the board?");
  assert.equal(WAR_SPEC.sceneFrames, 24 * 60);
  assert.equal(SCENE_FRAMES, WAR_SPEC.sceneFrames);
  assert.ok(WAR_SPEC.rule.length <= 64);
  assert.notEqual(colourWarV4.status, "stub");
  assert.equal(COLS * ROWS, CELLS);
  assert.equal(COLS * CELL, W);
  assert.equal(ROWS * CELL, H);
  assert.equal(CELLS, 3600);
});

test("the simulation is deterministic, fast, and its digest follows the trace", () => {
  const t0 = performance.now();
  const a = colourWarV4.simulate(HIT_SEED);
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 10000, `simulate took ${elapsed.toFixed(0)} ms`);
  const b = colourWarV4.simulate(HIT_SEED);
  assert.equal(colourWarV4.digest(a), colourWarV4.digest(b));
  assert.deepEqual(a.own, b.own);
  assert.deepEqual(a.pos, b.pos);
  assert.match(colourWarV4.digest(a), /^[0-9a-f]{8}$/);
  assert.equal(colourWarV4.digest(colourWarV4.simulate()), colourWarV4.digest(a), "the default seed is the shared hit seed");

  const base = colourWarV4.digest(a);
  const own = a.own.slice();
  own[1000 * CELLS + 7] = (own[1000 * CELLS + 7] + 1) % 5;
  assert.notEqual(colourWarV4.digest({ ...a, own }), base, "digest follows ownership");
  const pos = a.pos.slice();
  pos[10] += 1;
  assert.notEqual(colourWarV4.digest({ ...a, pos }), base, "digest follows ball positions");
  assert.notEqual(colourWarV4.digest(simulateWar(HIT_SEED + 1)), base, "a different seed gives a different trace");
});

test("frame 0: all 3,600 cells are unowned and there is exactly one ball per colour, each in its own corner area", () => {
  const trace = getTrace();
  assert.equal(trace.frames, SCENE_FRAMES);
  assert.deepEqual(cellCounts(trace, 0), [3600, 0, 0, 0, 0]);
  assert.deepEqual(ballCounts(trace, 0), [1, 1, 1, 1]);
  const corners = new Set<string>();
  for (let i = 0; i < trace.nBalls; i++) {
    if (trace.ballBorn[i] !== 0) continue;
    const x = trace.pos[i * 2];
    const y = trace.pos[i * 2 + 1];
    const inset = 140;
    const cx = x < W / 2 ? "L" : "R";
    const cy = y < H / 2 ? "T" : "B";
    assert.ok(Math.abs((cx === "L" ? x : W - x) - inset) < 40, `ball ${i} x ${x} is near its corner`);
    assert.ok(Math.abs((cy === "T" ? y : H - y) - inset) < 40, `ball ${i} y ${y} is near its corner`);
    corners.add(cx + cy);
    // seeded angles toward the middle: the first step moves the ball closer to the board centre
    const dx = trace.pos[(trace.nBalls + i) * 2] - x;
    const dy = trace.pos[(trace.nBalls + i) * 2 + 1] - y;
    assert.ok(dx * (W / 2 - x) + dy * (H / 2 - y) > 0, `ball ${i} heads toward the middle`);
  }
  assert.equal(corners.size, 4, "four different corner areas");
});

test("ownership always adds up: owned cells per team plus unowned equal 3,600 at every sampled frame", () => {
  const trace = getTrace();
  for (let f = 0; f < SCENE_FRAMES; f += 37) {
    const c = cellCounts(trace, f);
    assert.equal(c[0] + c[1] + c[2] + c[3] + c[4], CELLS, `frame ${f}`);
    for (let team = 0; team < TEAM_COUNT; team++) assert.equal(trace.counts[f * TEAM_COUNT + team], c[team + 1], `cached count, frame ${f} team ${team}`);
  }
  const last = cellCounts(trace, SCENE_FRAMES - 1);
  assert.equal(last[0] + last[1] + last[2] + last[3] + last[4], CELLS);
});

test("the board starts empty and the war really fills it: most cells are owned by the middle, nearly all by the end", () => {
  const trace = getTrace();
  const unownedAt = (sec: number) => cellCounts(trace, Math.round(sec * 60))[0] / CELLS;
  assert.ok(unownedAt(0.5) > 0.9, "still mostly empty after half a second");
  assert.ok(unownedAt(12) < 0.25, `12 s: ${(unownedAt(12) * 100).toFixed(1)}% unowned`);
  assert.ok(unownedAt(22.4) < 0.06, `end: ${(unownedAt(22.4) * 100).toFixed(1)}% unowned`);
});

test("pickUnderdog takes the smallest share and breaks ties toward the lowest team index", () => {
  assert.equal(pickUnderdog([10, 20, 30, 40]), 0);
  assert.equal(pickUnderdog([40, 5, 30, 20]), 1);
  assert.equal(pickUnderdog([40, 50, 7, 20]), 2);
  assert.equal(pickUnderdog([40, 50, 70, 3]), 3);
  assert.equal(pickUnderdog([9, 5, 5, 9]), 1);
  assert.equal(pickUnderdog([5, 5, 5, 5]), 0);
  assert.equal(pickUnderdog([0, 0, 0, 0]), 0);
});

test("underdog rule: at 5, 10, 15 and 20 s exactly the smallest colour doubles its balls, and no other ball count ever changes", () => {
  const trace = getTrace();
  assert.deepEqual([...TICK_FRAMES], [300, 600, 900, 1200]);
  for (let f = 1; f < SCENE_FRAMES; f++) {
    const before = ballCounts(trace, f - 1);
    const after = ballCounts(trace, f);
    if (!(TICK_FRAMES as readonly number[]).includes(f)) {
      assert.deepEqual(after, before, `ball counts changed at frame ${f} with no underdog tick`);
      continue;
    }
    const shares = teamCells(trace, f - 1); // the board just before the tick
    const underdog = shares.indexOf(Math.min(...shares)); // indexOf = lowest index wins ties
    const expected = before.map((n, team) => (team === underdog ? n * 2 : n));
    assert.deepEqual(after, expected, `tick at frame ${f}: ${TEAM_NAMES[underdog]} should double`);
    assert.equal(trace.tickTeam[TICK_FRAMES.indexOf(f as never)], underdog, "the trace records the same underdog");
  }
  const end = ballCounts(trace, SCENE_FRAMES - 1);
  assert.ok(end.every((n) => n >= 1) && end.reduce((a, b) => a + b, 0) <= 19);
});

test("balls paint what they touch: every flipped cell sits next to a live ball of its new owner", () => {
  const trace = getTrace();
  const reach = 34 + 14; // capture radius plus a little more than one frame of travel (10 px)
  for (let f = 1; f <= CLOCK_ZERO_FRAME; f += 3) {
    const now = f * CELLS;
    const prev = (f - 1) * CELLS;
    for (let i = 0; i < CELLS; i++) {
      const owner = trace.own[now + i];
      if (owner === trace.own[prev + i]) continue;
      assert.ok(owner >= 1 && owner <= 4, "a cell never becomes unowned again");
      const cx = ((i % COLS) + 0.5) * CELL;
      const cy = (Math.floor(i / COLS) + 0.5) * CELL;
      let near = false;
      for (let b = 0; b < trace.nBalls && !near; b++) {
        if (trace.ballBorn[b] > f || trace.ballTeam[b] !== owner - 1) continue;
        const bx = trace.pos[(f * trace.nBalls + b) * 2];
        const by = trace.pos[(f * trace.nBalls + b) * 2 + 1];
        near = Math.hypot(bx - cx, by - cy) <= reach;
        if (!near) {
          const px = trace.pos[((f - 1) * trace.nBalls + b) * 2];
          const py = trace.pos[((f - 1) * trace.nBalls + b) * 2 + 1];
          near = Math.hypot(px - cx, py - cy) <= reach;
        }
      }
      assert.ok(near, `frame ${f} cell ${i} changed to team ${owner - 1} with no ball of that team near`);
    }
  }
});

test("balls reflect off the canvas edges, never tunnel, and keep a steady pace", () => {
  const trace = getTrace();
  for (let f = 0; f <= CLOCK_ZERO_FRAME; f += 2) {
    for (let b = 0; b < trace.nBalls; b++) {
      if (trace.ballBorn[b] > f) continue;
      const x = trace.pos[(f * trace.nBalls + b) * 2];
      const y = trace.pos[(f * trace.nBalls + b) * 2 + 1];
      assert.ok(x >= BALL_R - 0.01 && x <= W - BALL_R + 0.01, `x ${x} at frame ${f}`);
      assert.ok(y >= BALL_R - 0.01 && y <= H - BALL_R + 0.01, `y ${y} at frame ${f}`);
      if (f > trace.ballBorn[b]) {
        const px = trace.pos[((f - 1) * trace.nBalls + b) * 2];
        const py = trace.pos[((f - 1) * trace.nBalls + b) * 2 + 1];
        assert.ok(Math.hypot(x - px, y - py) < 30, `ball ${b} jumped at frame ${f}`);
      }
    }
  }
  // the balls really do use the whole canvas: the four edges are all touched
  let minX: number = W;
  let maxX = 0;
  let minY: number = H;
  let maxY = 0;
  for (let f = 0; f <= CLOCK_ZERO_FRAME; f++) {
    for (let b = 0; b < trace.nBalls; b++) {
      if (trace.ballBorn[b] > f) continue;
      minX = Math.min(minX, trace.pos[(f * trace.nBalls + b) * 2]);
      maxX = Math.max(maxX, trace.pos[(f * trace.nBalls + b) * 2]);
      minY = Math.min(minY, trace.pos[(f * trace.nBalls + b) * 2 + 1]);
      maxY = Math.max(maxY, trace.pos[(f * trace.nBalls + b) * 2 + 1]);
    }
  }
  assert.ok(minX <= BALL_R + 1 && maxX >= W - BALL_R - 1 && minY <= BALL_R + 1 && maxY >= H - BALL_R - 1);
});

test("the clock reaches 0:00 at 22.4 s and the board is frozen for the last 1.6 s", () => {
  const trace = getTrace();
  assert.equal(CLOCK_ZERO_FRAME, 1344);
  assert.equal(SCENE_FRAMES - CLOCK_ZERO_FRAME, 96);
  assert.equal(clockText(0), "0:22");
  assert.equal(clockText(83), "0:22");
  assert.equal(clockText(84), "0:21", "one tick per real second, the first after 1.4 s");
  assert.equal(clockText(CLOCK_ZERO_FRAME - 1), "0:01");
  assert.equal(clockText(CLOCK_ZERO_FRAME), "0:00");
  assert.equal(clockText(SCENE_FRAMES - 1), "0:00");
  for (let f = CLOCK_ZERO_FRAME; f < SCENE_FRAMES; f += 5) {
    for (let i = 0; i < CELLS; i += 11) assert.equal(trace.own[f * CELLS + i], trace.own[CLOCK_ZERO_FRAME * CELLS + i]);
  }
});

test("pacing: the top two finish within 1 to 8 points and the lead changes at least twice in the last 10 s", () => {
  const trace = getTrace();
  const finalShares = teamCells(trace, CLOCK_ZERO_FRAME).map((c) => (c / CELLS) * 100);
  const sorted = [...finalShares].sort((a, b) => b - a);
  const gap = sorted[0] - sorted[1];
  assert.ok(gap >= 1 && gap <= 8, `top-two gap ${gap.toFixed(2)} points (${finalShares.map((s) => s.toFixed(1)).join(" / ")})`);

  let leader = argmax(teamCells(trace, CLOCK_ZERO_FRAME - 600));
  let changes = 0;
  let lastChange = CLOCK_ZERO_FRAME - 600;
  let shortestLead = Infinity;
  for (let f = CLOCK_ZERO_FRAME - 599; f <= CLOCK_ZERO_FRAME; f++) {
    const shares = teamCells(trace, f);
    const top = argmax(shares);
    if (top !== leader && shares[top] > shares[leader]) {
      shortestLead = Math.min(shortestLead, f - lastChange);
      leader = top;
      lastChange = f;
      changes++;
    }
  }
  assert.ok(changes >= 2, `only ${changes} lead changes in the last 10 s`);
  assert.ok(shortestLead >= 20, `a lead that lasts ${shortestLead} frames is a flicker, not a lead change`);
  assert.equal(leader, argmax(finalShares), "the leader at the end is the winner");
});

test("the painter names the winner: the result text matches the argmax of the final shares, with its percent", () => {
  const trace = getTrace();
  const final = teamCells(trace, SCENE_FRAMES - 1);
  const winner = argmax(final);
  const percent = Math.round((final[winner] / CELLS) * 100);
  for (const f of [CLOCK_ZERO_FRAME, CLOCK_ZERO_FRAME + 30, SCENE_FRAMES - 1]) {
    const { drawn, boxes } = paintFrame(trace, f);
    assert.ok(drawn.includes(`${TEAM_NAMES[winner]} TAKES THE BOARD`), `frame ${f}: winner line (${drawn.join(" | ")})`);
    assert.ok(drawn.includes(`${percent}%`), `frame ${f}: winner percent ${percent}%`);
    for (const other of TEAM_NAMES) {
      if (other !== TEAM_NAMES[winner]) assert.ok(!drawn.includes(`${other} TAKES THE BOARD`));
    }
    for (const box of boxes) assertReelSafeBox(box);
  }
  const before = paintFrame(trace, CLOCK_ZERO_FRAME - 1);
  assert.ok(!before.drawn.some((t) => t.includes("TAKES THE BOARD")), "no flash-forward of the ending");
});

test("frame 0 shows the question, the rule, a 0:22 clock, four colour labels and one ball each", () => {
  const trace = getTrace();
  const { drawn, boxes } = paintFrame(trace, 0);
  assert.ok(drawn.join(" ").includes(WAR_SPEC.question));
  assert.ok(drawn.join(" ").includes(WAR_SPEC.rule), "the rule may wrap onto two lines");
  assert.ok(drawn.includes(CTA_LINES[0]) && drawn.includes(CTA_LINES[1]));
  assert.ok(drawn.includes("0:22"));
  for (const name of TEAM_NAMES) assert.ok(drawn.includes(`${name} 0%`), `${name} label at frame 0`);
  assert.equal(drawn.filter((t) => t === "x1").length, 4, "one ball each, shown as x1");
  assert.ok(!drawn.some((t) => t.startsWith("UNDERDOG")), "no banner at frame 0");
  for (const box of boxes) assertReelSafeBox(box);
});

test("HUD labels follow the trace: percents and ball counts match the board at the sampled frames", () => {
  const trace = getTrace();
  for (const f of [200, 450, 800, 1100, 1300]) {
    const { drawn } = paintFrame(trace, f);
    const cells = teamCells(trace, f);
    const balls = ballCounts(trace, f);
    TEAM_NAMES.forEach((name, team) => {
      const label = `${name} ${Math.round((cells[team] / CELLS) * 100)}%`;
      assert.ok(drawn.includes(label), `frame ${f}: ${label} in ${drawn.join(" | ")}`);
    });
    for (const n of new Set(balls)) {
      assert.equal(drawn.filter((t) => t === `x${n}`).length, balls.filter((b) => b === n).length, `frame ${f}: x${n} labels`);
    }
  }
});

test("the underdog banner is announced on screen for 1.2 s at each tick, naming the colour that doubled", () => {
  const trace = getTrace();
  assert.equal(BANNER_FRAMES, 72);
  for (const tick of TICK_FRAMES) {
    const shares = teamCells(trace, tick - 1);
    const underdog = shares.indexOf(Math.min(...shares));
    const text = `UNDERDOG: ${TEAM_NAMES[underdog]} x2`;
    for (const f of [tick, tick + 1, tick + 36, tick + BANNER_FRAMES - 2]) {
      const { drawn, boxes } = paintFrame(trace, f);
      assert.ok(drawn.includes(text), `frame ${f} should show "${text}"`);
      for (const box of boxes) assertReelSafeBox(box);
    }
    for (const f of [tick - 1, tick + BANNER_FRAMES + 2]) {
      const { drawn } = paintFrame(trace, f);
      assert.ok(!drawn.some((t) => t.startsWith("UNDERDOG")), `frame ${f} should show no banner`);
    }
  }
});

test("every text box stays inside the reel safe bounds at the frames that matter", () => {
  const trace = getTrace();
  const frames = [0, 1, 59, 299, 300, 301, 330, 371, 372, 599, 600, 640, 899, 900, 1199, 1200, 1250, 1341, 1342, 1343, 1344, 1345, 1400, 1439];
  for (const f of frames) {
    const { boxes } = paintFrame(trace, f);
    assert.ok(boxes.length >= 8, `frame ${f} draws the HUD`);
    for (const box of boxes) assertReelSafeBox(box);
  }
});

test("the board is on screen edge to edge from frame 0 and the painter is a pure function of the frame", () => {
  const trace = getTrace();
  for (const f of [0, 20, 90, 400, 1300, 1439]) {
    const { mock } = paintFrame(trace, f);
    assert.ok(mock.coverageGrid(6, 10) >= 0.8, `frame ${f}: ${(mock.coverageGrid(6, 10) * 100).toFixed(0)}% of a 6x10 grid`);
  }
  const fresh = paintFrame(trace, 700);
  paintFrame(trace, 1200);
  paintFrame(trace, 5);
  const again = paintFrame(trace, 700);
  assert.deepEqual(again.mock.texts, fresh.mock.texts);
  assert.deepEqual(again.mock.fillRects, fresh.mock.fillRects);
  assert.equal(again.mock.shapes.length, fresh.mock.shapes.length);
});

test("an ambient layer of at least 80 drifting dots keeps the whole frame alive", () => {
  const trace = getTrace();
  const count = trace.dots.length / 6;
  assert.ok(count >= 80, `${count} dots`);
  let moved = 0;
  for (let i = 0; i < count; i++) {
    const a = ambientDotAt(trace, i, 0);
    const b = ambientDotAt(trace, i, 120);
    for (const d of [a, b]) {
      assert.ok(d.x >= 0 && d.x <= W && d.y >= 0 && d.y <= H, "dots stay on the canvas");
      assert.ok(d.alpha >= 0 && d.alpha <= 1 && d.size > 0);
    }
    if (Math.hypot(a.x - b.x, a.y - b.y) > 1) moved++;
  }
  assert.ok(moved >= count * 0.9, `${moved} of ${count} dots drift`);
});

test("audio plan: capture ticks respect the event cap, one pitch per colour, panned by x", () => {
  const trace = getTrace();
  const plan = planWarAudio(trace);
  const ticks = plan.captures;
  assert.ok(ticks.length > 100, `only ${ticks.length} capture ticks`);
  for (let i = 0; i < ticks.length; i++) {
    let inWindow = 0;
    for (let j = i; j < ticks.length && ticks[j].t < ticks[i].t + 1 - 1e-9; j++) inWindow++;
    assert.ok(inWindow <= 20, `${inWindow} capture ticks inside one second starting at ${ticks[i].t.toFixed(2)} s`);
    if (i > 0) assert.ok(ticks[i].t >= ticks[i - 1].t, "time order");
  }
  assert.ok(ticks[0].t >= 0 && ticks[ticks.length - 1].t <= CLOCK_ZERO_FRAME / 60 + 0.01, "ticks only while the board is live");
  const pitchByTeam = new Map<number, Set<number>>();
  for (const e of ticks) {
    assert.ok(e.pan >= -1 && e.pan <= 1);
    const set = pitchByTeam.get(e.team) ?? new Set<number>();
    set.add(e.midi);
    pitchByTeam.set(e.team, set);
  }
  assert.equal(pitchByTeam.size, 4, "all four colours are heard");
  for (const set of pitchByTeam.values()) assert.equal(set.size, 1, "one pitch per team");
  const allPitches = new Set([...pitchByTeam.values()].map((set) => [...set][0]));
  assert.equal(allPitches.size, 4, "four different pitches");
  const perTeam = [0, 1, 2, 3].map((t) => ticks.filter((e) => e.team === t).length);
  assert.ok(Math.min(...perTeam) > ticks.length * 0.1, `every team is audible: ${perTeam.join("/")}`);
  // quieter collisions stay sparse too
  for (const list of [plan.clacks, plan.walls]) {
    for (let i = 0; i < list.length; i++) {
      let inWindow = 0;
      for (let j = i; j < list.length && list[j].t < list[i].t + 1 - 1e-9; j++) inWindow++;
      assert.ok(inWindow <= 6, `${inWindow} collision sounds inside one second`);
    }
  }
});

test("audio plan: the underdog fires a whoosh and a thud on the exact frame, the last 3 s beat once a second, the end plays the winner's chord", () => {
  const trace = getTrace();
  const plan = planWarAudio(trace);
  assert.deepEqual(plan.underdogs.map((u) => u.t), TICK_FRAMES.map((f) => f / 60));
  assert.deepEqual(plan.underdogs.map((u) => u.team), [...trace.tickTeam]);
  assert.equal(plan.beats.length, 3);
  assert.deepEqual(plan.beats.map((b) => b.t), [19.4, 20.4, 21.4].map((t) => Math.round(t * 60) / 60));
  assert.ok(plan.beats[0].midi < plan.beats[1].midi && plan.beats[1].midi < plan.beats[2].midi, "the pitch rises each second");
  const final = teamCells(trace, CLOCK_ZERO_FRAME);
  assert.equal(plan.end.team, argmax(final));
  assert.equal(plan.end.t, CLOCK_ZERO_FRAME / 60);
  assert.ok(plan.end.riserStart < plan.end.t && plan.end.t - plan.end.riserStart >= 1, "a riser builds before the chord");
  assert.ok(plan.end.midis.length >= 3, "a chord, not a single note");
});

test("audio: master level, warmth, length and browser safety hold for the real mix", () => {
  const saved = (globalThis as Record<string, unknown>).Buffer;
  try {
    (globalThis as Record<string, unknown>).Buffer = undefined;
    const audio = colourWarV4.buildAudio(getTrace());
    assert.equal(audio.wav.byteLength, 44 + (WAR_SPEC.totalFrames / 60) * 48000 * 4);
    // the pad bed runs to the last frame: the last 0.2 s are not silent
    const tail = audio.buffer.left.subarray(audio.buffer.left.length - 9600);
    let peak = 0;
    for (const v of tail) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.002, `the bed is still playing at the end (peak ${peak})`);
  } finally {
    (globalThis as Record<string, unknown>).Buffer = saved;
  }
});
