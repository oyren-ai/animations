import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE_RATE, SAMPLES_PER_FRAME } from "../audio.ts";
import { scheduleFrenchVoices, synthesizePatateWav } from "./audio.ts";
import {
  bodyDeformation,
  impactAmount,
  impactsByBody,
  impactSpring,
  NO_DEFORMATION,
  PATATE_FRAME_STRETCH,
  PATATE_PACE,
  PATATE_SQUASH,
  type Deformation,
  type PatateImpact,
} from "./feel.ts";
import { paintPatateFrame } from "./paint.ts";
import { PATATE_COMPOSITIONS, simulatePatate } from "./sim.ts";
import { PATATE_CLOSING_FRAMES, PATATE_SCENE_FRAMES, PATATE_TOTAL_FRAMES } from "./themes.ts";

const det = (d: Deformation) => d.a * d.d - d.b * d.c;
const hit = (frame: number, nx: number, ny: number, speed: number, kind: "hit" | "pop" = "hit"): PatateImpact => ({
  frame,
  bodyId: 1,
  kind,
  nx,
  ny,
  speed,
});

// Unlock frames of tiers 1..8 on main at 6c4e638: the 24 s version, 60 solver frames per second. The last entry is the boss merge.
// The merge ladder is chaotic and fills its timeline, so the only safe way to slow it is to keep the solver identical and
// step it fewer times per video frame. These frames times the stretch are therefore exactly where the chain must land.
const MAIN_UNLOCKS: Record<string, readonly number[]> = {
  PatateMergeCodingAgents: [0, 107, 135, 299, 373, 518, 799, 1047],
  PatateMergeWorldToCode: [0, 109, 136, 306, 385, 501, 898, 1103],
  PatateMergeLanguages: [0, 108, 137, 299, 371, 484, 675, 1056],
};
// Locked on purpose, replacing the old lock on main's 1047 / 1103 / 1056: these are those boss frames times the 4/3 stretch.
// They only move if the solver or the pace changes, and the chain is chaotic (nudging gravity, bounce or drop spacing lost
// the boss merge in most compositions), so any change here must be re-verified against the boss window first.
const BOSS_FRAME_NOW: Record<string, number> = {
  PatateMergeCodingAgents: 1396,
  PatateMergeWorldToCode: 1471,
  PatateMergeLanguages: 1408,
};
// Mean body speed in px per video second on main at 6c4e638.
const MAIN_MEAN_SPEED: Record<string, number> = {
  PatateMergeCodingAgents: 280,
  PatateMergeWorldToCode: 309,
  PatateMergeLanguages: 275,
};

function meanBodySpeed(trace: ReturnType<typeof simulatePatate>): number {
  let sum = 0;
  let count = 0;
  for (let f = 1; f < trace.frames.length; f++) {
    const previous = new Map(trace.frames[f - 1].bodies.map((body) => [body.id, body]));
    for (const body of trace.frames[f].bodies) {
      const before = previous.get(body.id);
      if (!before) continue;
      sum += Math.hypot(body.x - before.x, body.y - before.y) * 60;
      count++;
    }
  }
  return sum / Math.max(1, count);
}

test("the pace and feel constants are named and sane", () => {
  assert.ok(Number.isInteger(PATATE_PACE.substepsPerFrame), "an integer keeps the 240 Hz solver step, and so the merge chain, unchanged");
  assert.ok(PATATE_PACE.substepsPerFrame >= 2 && PATATE_PACE.substepsPerFrame <= 3, "slower than the original 4 per frame, but not absurdly so");
  assert.ok(PATATE_FRAME_STRETCH >= 1.25 && PATATE_FRAME_STRETCH <= 1.5);
  assert.ok(PATATE_SQUASH.maxLogSquash > 0.15 && PATATE_SQUASH.maxLogSquash <= 0.4);
  assert.ok(PATATE_SQUASH.maxTotalLogSquash >= PATATE_SQUASH.maxLogSquash);
  assert.ok(PATATE_SQUASH.frequencyHz <= 2.6 && PATATE_SQUASH.settleFrames >= 60, "the squash springs follow the slowed motion");
});

test("the spring squashes at impact, rebounds into a stretch, then settles to exactly nothing", () => {
  assert.equal(impactSpring(0), 1);
  const early = Array.from({ length: 14 }, (_, age) => impactSpring(age));
  assert.ok(Math.min(...early) < -0.2, "no rebound stretch after the squash");
  assert.equal(impactSpring(PATATE_SQUASH.settleFrames), 0);
  assert.equal(impactSpring(PATATE_SQUASH.settleFrames + 10), 0);
  let largestStep = 0;
  for (let age = 1; age <= PATATE_SQUASH.settleFrames; age++) {
    largestStep = Math.max(largestStep, Math.abs(impactSpring(age) - impactSpring(age - 1)));
  }
  assert.ok(largestStep < 0.35, `the spring jumps by ${largestStep} between two frames`);
});

test("impact strength grows with speed and slow touches leave no mark", () => {
  assert.equal(impactAmount(PATATE_SQUASH.minImpactSpeed - 1), 0);
  assert.ok(impactAmount(400) > 0 && impactAmount(400) < impactAmount(900));
  assert.equal(impactAmount(PATATE_SQUASH.fullImpactSpeed), PATATE_SQUASH.maxLogSquash);
  assert.equal(impactAmount(PATATE_SQUASH.fullImpactSpeed * 5), PATATE_SQUASH.maxLogSquash);
});

test("a vertical hit squashes along the contact, widens across it and keeps the volume", () => {
  const d = bodyDeformation([hit(100, 0, 1, 900)], 100);
  assert.ok(d.d < 0.8 && d.a > 1.25, `a=${d.a} d=${d.d}`);
  assert.ok(Math.abs(det(d) - 1) < 1e-9);
  assert.equal(d.b, d.c, "the deformation is symmetric");
  const sideways = bodyDeformation([hit(100, 1, 0, 900)], 100);
  assert.ok(sideways.a < 0.8 && sideways.d > 1.25, "a wall hit squashes sideways");
  const diagonal = bodyDeformation([hit(100, Math.SQRT1_2, Math.SQRT1_2, 900)], 100);
  assert.ok(Math.abs(diagonal.b) > 0.1, "a diagonal contact must shear, not just scale the axes");
  assert.ok(Math.abs(det(diagonal) - 1) < 1e-9);
});

test("no impacts and slow impacts give no deformation", () => {
  assert.deepEqual(bodyDeformation([], 50), NO_DEFORMATION);
  assert.deepEqual(bodyDeformation(undefined, 50), NO_DEFORMATION);
  assert.deepEqual(bodyDeformation([hit(10, 0, 1, PATATE_SQUASH.minImpactSpeed - 5)], 10), NO_DEFORMATION);
  assert.deepEqual(bodyDeformation([hit(10, 0, 1, 900)], 10 + PATATE_SQUASH.settleFrames), NO_DEFORMATION);
});

test("a falling potato stretches along its path just before it hits; a merge pop does not", () => {
  const before = bodyDeformation([hit(100, 0, 1, 900)], 100 - 2);
  assert.ok(before.d > 1.03 && before.a < 0.97, `expected a stretch along the contact, got a=${before.a} d=${before.d}`);
  assert.ok(Math.abs(det(before) - 1) < 1e-9);
  assert.deepEqual(bodyDeformation([hit(100, 0, 1, 900, "pop")], 100 - 2), NO_DEFORMATION);
  assert.deepEqual(bodyDeformation([hit(100, 0, 1, 900)], 100 - PATATE_SQUASH.anticipationFrames - 3), NO_DEFORMATION);
});

test("overlapping impacts add up but stay capped, volume kept, and order does not matter", () => {
  const many = Array.from({ length: 12 }, (_, i) => hit(100 + (i % 3), Math.cos(i), Math.sin(i), 1200));
  const forward = bodyDeformation(many, 102);
  const backward = bodyDeformation([...many].reverse(), 102);
  for (const key of ["a", "b", "c", "d"] as const) assert.ok(Math.abs(forward[key] - backward[key]) < 1e-12, `${key} depends on the order`);
  assert.ok(Math.abs(det(forward) - 1) < 1e-9);
  const stretch = Math.max(forward.a, forward.d, 1 / forward.a, 1 / forward.d);
  assert.ok(stretch <= Math.exp(PATATE_SQUASH.maxTotalLogSquash) + 1e-9, `stretch ${stretch}`);
});

test("impacts are indexed by body for painting", () => {
  const index = impactsByBody([hit(5, 0, 1, 500), { ...hit(9, 1, 0, 700), bodyId: 2 }, hit(12, 0, 1, 400)]);
  assert.equal(index.get(1)?.length, 2);
  assert.equal(index.get(2)?.length, 1);
  assert.equal(index.get(3), undefined);
});

test("the video is 30 to 32 seconds and one constant sets every length", () => {
  assert.equal(PATATE_SCENE_FRAMES, Math.round(1260 * PATATE_FRAME_STRETCH));
  assert.equal(PATATE_TOTAL_FRAMES, PATATE_SCENE_FRAMES + PATATE_CLOSING_FRAMES);
  for (const comp of PATATE_COMPOSITIONS) {
    const trace = simulatePatate(comp.slug);
    assert.ok(trace.totalFrames >= 1800 && trace.totalFrames <= 1920, `${comp.id}: ${trace.totalFrames} frames is outside 1800..1920`);
    assert.equal(trace.totalFrames, PATATE_TOTAL_FRAMES);
    assert.equal(trace.sceneFrames + trace.closingFrames, trace.totalFrames);
    assert.equal(trace.frames.length, trace.sceneFrames + 1);
  }
});

test("the merge chain is main's chain, only slower: every unlock and the boss land at main's frame times the stretch", () => {
  const windowStart = 900 * PATATE_FRAME_STRETCH;
  const windowEnd = 1152 * PATATE_FRAME_STRETCH;
  for (const comp of PATATE_COMPOSITIONS) {
    const trace = simulatePatate(comp.slug);
    MAIN_UNLOCKS[comp.id].forEach((mainFrame, index) => {
      const unlock = trace.unlockFrames[index];
      assert.notEqual(unlock, null, `${comp.id}: tier ${index + 1} never unlocked`);
      assert.ok(Math.abs((unlock as number) - mainFrame * PATATE_FRAME_STRETCH) <= 1.5, `${comp.id}: tier ${index + 1} at ${unlock}, main's ${mainFrame} stretched is ${(mainFrame * PATATE_FRAME_STRETCH).toFixed(1)}`);
    });
    assert.ok(trace.bossMergeFrame !== null && trace.bossMergeFrame >= windowStart && trace.bossMergeFrame <= windowEnd, `${comp.id}: boss at ${trace.bossMergeFrame}, window ${windowStart}..${windowEnd}`);
    assert.equal(trace.bossMergeFrame, BOSS_FRAME_NOW[comp.id], `${comp.id}: the boss merge moved; see the comment on BOSS_FRAME_NOW before changing it`);
  }
});

test("the physics genuinely run slower, not just the picture", () => {
  for (const comp of PATATE_COMPOSITIONS) {
    const slower = meanBodySpeed(simulatePatate(comp.slug));
    assert.ok(slower <= MAIN_MEAN_SPEED[comp.id] * 0.8, `${comp.id}: mean speed ${slower.toFixed(0)} px/s is not 20% below main's ${MAIN_MEAN_SPEED[comp.id]}`);
  }
});

test("merge banners and shockwaves follow the pace and stay on screen at least as long as before", () => {
  for (const comp of PATATE_COMPOSITIONS) {
    const trace = simulatePatate(comp.slug);
    // On main the boss banner showed for 73 frames and its shockwaves for about 53. Both now last about a third longer.
    const bannerFrames = trace.frames.filter((frame) => frame.callouts.some((callout) => callout.tier === 8)).length;
    assert.ok(bannerFrames >= Math.round(73 * 1.3), `${comp.id}: boss banner shows for only ${bannerFrames} frames`);
    const ringFrames = trace.frames.filter((frame) => frame.shockwaves.some((wave) => wave.tier === 8)).length;
    assert.ok(ringFrames >= Math.round(53 * 1.3), `${comp.id}: boss shockwaves show for only ${ringFrames} frames`);
  }
});

test("the trace records every contact, merge pop and merge shiver as an impact, deterministically", () => {
  for (const comp of PATATE_COMPOSITIONS) {
    const trace = simulatePatate(comp.slug);
    const replay = simulatePatate(comp.slug, comp.seed);
    assert.deepEqual(trace.impacts, replay.impacts);
    assert.ok(trace.impacts.length >= 60, `${comp.id}: only ${trace.impacts.length} impacts`);
    let previousFrame = -1;
    for (const impact of trace.impacts) {
      assert.ok(impact.frame >= previousFrame, "impacts are ordered by frame");
      previousFrame = impact.frame;
      assert.ok(Number.isFinite(impact.speed) && impact.speed > 0);
      assert.ok(Math.abs(Math.hypot(impact.nx, impact.ny) - 1) < 1e-6, "the contact direction is a unit vector");
      const bodies = trace.frames[impact.frame].bodies;
      assert.ok(bodies.some((body) => body.id === impact.bodyId), `${comp.id}: impact on body ${impact.bodyId} that is not on screen at frame ${impact.frame}`);
    }
    for (const event of trace.events) {
      if (event.type !== "merge") continue;
      const pops = trace.impacts.filter((impact) => impact.frame === event.frame && impact.kind === "pop");
      assert.ok(pops.length >= 1, `${comp.id}: merge at ${event.frame} has no pop`);
    }
    assert.ok(trace.impacts.some((impact) => impact.kind === "hit" && impact.speed > 500), `${comp.id}: no hard hit recorded`);
  }
});

function createMockCanvas2D() {
  const transforms: number[][] = [];
  let currentFont = "600 24px Inter";
  const base: Record<string, unknown> = {
    fillStyle: "#000",
    strokeStyle: "#fff",
    globalAlpha: 1,
    lineWidth: 1,
    get font() {
      return currentFont;
    },
    set font(value: string) {
      currentFont = value;
    },
    transform: (...args: number[]) => transforms.push(args),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText(text: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(currentFont)?.[1] ?? 24);
      return { width: text.length * px * 0.54, actualBoundingBoxAscent: px * 0.76, actualBoundingBoxDescent: px * 0.22 };
    },
  };
  const ctx = new Proxy(base, {
    get: (target, property) => (property in target ? target[property as string] : () => undefined),
    set: (target, property, value) => {
      target[property as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, transforms };
}

test("paint squashes each potato along its contact, keeps the volume, and leaves resting frames alone", () => {
  const trace = simulatePatate(PATATE_COMPOSITIONS[0].slug);
  const idle = createMockCanvas2D();
  paintPatateFrame(idle.ctx, trace, 0);
  assert.equal(idle.transforms.length, 0, "frame 0 has no impacts, so no deformation");

  const strong = trace.impacts.find((impact) => impact.kind === "hit" && impact.speed > 600);
  assert.ok(strong);
  const hitFrame = createMockCanvas2D();
  paintPatateFrame(hitFrame.ctx, trace, strong.frame);
  assert.ok(hitFrame.transforms.some(([a, b, c, d]) => Math.abs(a - 1) > 0.05 || Math.abs(d - 1) > 0.05 || Math.abs(b) > 0.05));

  let deformedFrames = 0;
  for (let frame = 0; frame <= trace.sceneFrames; frame += 3) {
    const { ctx, transforms } = createMockCanvas2D();
    paintPatateFrame(ctx, trace, frame);
    let deformed = false;
    for (const [a, b, c, d, e, f] of transforms) {
      assert.ok(Math.abs(a * d - b * c - 1) < 1e-6, `frame ${frame}: deformation changes the volume`);
      assert.equal(b, c);
      assert.equal(e, 0);
      assert.equal(f, 0);
      if (Math.abs(a - 1) > 0.03 || Math.abs(d - 1) > 0.03 || Math.abs(b) > 0.03) deformed = true;
    }
    if (deformed) deformedFrames++;
  }
  assert.ok(deformedFrames >= 120, `only ${deformedFrames} of ${Math.ceil(trace.sceneFrames / 3)} sampled frames show a squash`);
});

test("French voice lines never overlap and the soundtrack is exactly as long as the video", () => {
  for (const comp of PATATE_COMPOSITIONS) {
    const trace = simulatePatate(comp.slug);
    const wav = synthesizePatateWav(trace);
    assert.equal(wav.length, 44 + trace.totalFrames * SAMPLES_PER_FRAME * 2, `${comp.id}: audio length differs from the video`);
    assert.ok(trace.totalFrames / 60 >= 30 && trace.totalFrames / 60 <= 32);

    const clips = scheduleFrenchVoices(trace);
    assert.ok(clips.length >= 6, `${comp.id}: only ${clips.length} voice lines`);
    for (let i = 1; i < clips.length; i++) {
      assert.ok(clips[i].startSample >= clips[i - 1].endSample, `${comp.id}: voice ${i} starts ${clips[i - 1].endSample - clips[i].startSample} samples before the previous one ends`);
    }
    for (const clip of clips) {
      assert.ok(clip.endSample - clip.startSample >= 0.2 * SAMPLE_RATE, `${comp.id}: a voice line is cut shorter than 0.2 s`);
      assert.ok(clip.endSample <= trace.sceneFrames * SAMPLES_PER_FRAME, `${comp.id}: a voice line runs into the end card`);
    }
  }
});

test("the sound follows the new timing: silent until the first event frame, present right after it", () => {
  for (const comp of PATATE_COMPOSITIONS) {
    const trace = simulatePatate(comp.slug);
    const wav = synthesizePatateWav(trace);
    assert.equal(wav.length, 44 + PATATE_TOTAL_FRAMES * SAMPLES_PER_FRAME * 2);
    const first = trace.events[0];
    const startByte = 44 + first.frame * SAMPLES_PER_FRAME * 2;
    for (let i = 44; i < startByte; i += 2) assert.equal(wav.readInt16LE(i), 0, `${comp.id}: sound before the first event`);
    let peak = 0;
    const windowEnd = startByte + Math.round(0.04 * SAMPLE_RATE) * 2;
    for (let i = startByte; i < windowEnd; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    assert.ok(peak > 300, `${comp.id}: nothing audible within 40 ms of the first event`);
  }
});
