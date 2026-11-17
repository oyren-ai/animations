import assert from "node:assert/strict";
import test from "node:test";
import { assertReelSafeBox } from "../../shared/reelUtils.ts";
import { createMockCanvas } from "../mockCanvas.ts";
import { HIT_SEED } from "../types.ts";
import { buildMergeSchedule } from "./audio.ts";
import { CHAIN_IDLE, CHAIN_LINK_SEC, CHAIN_RESET_SEC, chainLive, chainOnMerge } from "./chain.ts";
import { funnelMerge, MERGE_SPEC } from "./index.ts";
import { AMBIENT_DOT_COUNT, clampPopupLeft } from "./paint.ts";
import {
  digestMerge,
  FLOOR_Y,
  PILE_GRACE_SEC,
  PILE_LIMIT_Y,
  POS_SCALE,
  simulateMerge,
  SUBSTEPS_PER_FRAME,
  TUNING,
  WORLD_W,
  type MergeTrace,
} from "./sim.ts";
import { FINAL_BANNER, TIERS, TIER_COUNT } from "./tiers.ts";

/**
 * FunnelMerge: only tier 1 drops from a top tube, two pieces of the same tier merge into the next,
 * chains stack a multiplier, and the first tier-7 piece is the final form.
 */

const t0 = performance.now();
const trace: MergeTrace = simulateMerge(HIT_SEED);
const simulateMs = performance.now() - t0;
const SUB = SUBSTEPS_PER_FRAME;

interface Rec {
  id: number;
  tier: number;
  x: number;
  y: number;
  r: number;
}

function records(tr: MergeTrace, frame: number): Rec[] {
  const out: Rec[] = [];
  for (let k = tr.frameStart[frame]; k < tr.frameStart[frame + 1]; k++) {
    out.push({
      id: tr.pid[k],
      tier: tr.ptier[k],
      x: tr.px[k] / POS_SCALE,
      y: tr.py[k] / POS_SCALE,
      r: tr.pr[k] / POS_SCALE,
    });
  }
  return out;
}

function find(tr: MergeTrace, frame: number, id: number): Rec | undefined {
  return records(tr, frame).find((r) => r.id === id);
}

function maxPerWindow(times: readonly number[], windowSec: number): number {
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < times.length; hi++) {
    while (times[hi] - times[lo] >= windowSec) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

/* ---------- table, spec ---------- */

test("merge: seven tiers, radii growing, names climb bit to agent, spec keeps its id, slug and rule", () => {
  assert.equal(TIER_COUNT, 7);
  assert.equal(TIERS.length, 7);
  assert.deepEqual(
    TIERS.map((t) => t.name),
    ["bit", "byte", "line", "func", "file", "repo", "agent"],
  );
  for (let i = 0; i < TIERS.length; i++) {
    assert.equal(TIERS[i].tier, i + 1);
    if (i > 0) assert.ok(TIERS[i].radius > TIERS[i - 1].radius * 1.2, "radii grow by a clear ratio");
  }
  assert.equal(new Set(TIERS.map((t) => t.color)).size, 7, "seven distinct colours");
  assert.equal(MERGE_SPEC.id, "FunnelMerge");
  assert.equal(MERGE_SPEC.slug, "funnel-merge");
  assert.equal(MERGE_SPEC.question, "Will it merge into its final form?");
  assert.equal(MERGE_SPEC.sceneFrames, 24 * 60);
  assert.ok(MERGE_SPEC.rule.length <= 64);
  assert.notEqual(funnelMerge.status, "stub");
});

/* ---------- chain (pure) ---------- */

test("merge: chain logic raises within 0.6 s, resets after 0.9 s without a merge", () => {
  assert.equal(CHAIN_LINK_SEC, 0.6);
  assert.equal(CHAIN_RESET_SEC, 0.9);
  assert.equal(chainLive(CHAIN_IDLE, 5), 0, "nothing live before any merge");
  const a = chainOnMerge(CHAIN_IDLE, 3.0);
  assert.deepEqual(a, { count: 1, lastT: 3.0 });
  const b = chainOnMerge(a, 3.4);
  assert.equal(b.count, 2, "0.4 s later raises the chain");
  const c = chainOnMerge(b, 3.4 + CHAIN_LINK_SEC);
  assert.equal(c.count, 3, "exactly at the link window still raises");
  const d = chainOnMerge(c, c.lastT + CHAIN_LINK_SEC + 0.05);
  assert.equal(d.count, 1, "a merge after the link window starts a new chain");
  assert.equal(chainLive(c, c.lastT + 0.5), 3);
  assert.equal(chainLive(c, c.lastT + CHAIN_RESET_SEC - 0.01), 3, "still live just before 0.9 s");
  assert.equal(chainLive(c, c.lastT + CHAIN_RESET_SEC), 0, "reset at 0.9 s without a merge");
  assert.equal(chainLive(c, c.lastT + 5), 0);
  const slow = chainOnMerge(chainOnMerge(CHAIN_IDLE, 1), 1.8);
  assert.equal(slow.count, 1, "0.8 s apart is not a chain");
});

/* ---------- determinism ---------- */

test("merge: the digest is deterministic and changes when the trace changes", () => {
  const again = simulateMerge(HIT_SEED);
  assert.equal(digestMerge(trace), digestMerge(again));
  assert.match(digestMerge(trace), /^[0-9a-f]{8}$/);
  assert.notEqual(digestMerge(trace), digestMerge(simulateMerge(HIT_SEED + 1)));
  const px = trace.px.slice();
  px[Math.floor(px.length / 2)] += 3;
  assert.notEqual(digestMerge({ ...trace, px }), digestMerge(trace), "a moved piece changes the digest");
  const merges = trace.merges.map((m, i) => (i === 3 ? { ...m, t: m.t + 0.01 } : m));
  assert.notEqual(digestMerge({ ...trace, merges }), digestMerge(trace), "a retimed merge changes the digest");
  assert.equal(composeDigest(), digestMerge(trace), "the composition digest is the sim digest");
});

function composeDigest(): string {
  return funnelMerge.digest(trace);
}

test("merge: simulate() stays well under the time budget", () => {
  assert.ok(simulateMs < 8000, `simulate took ${simulateMs.toFixed(0)} ms`);
});

/* ---------- start, drops, only tier 1 falls ---------- */

test("merge: frame 0 is empty and the first drop is at or before 0.2 s", () => {
  assert.equal(trace.frameStart[1] - trace.frameStart[0], 0, "no piece at frame 0");
  assert.ok(trace.spawns.length > 0);
  assert.ok(trace.spawns[0].t <= 0.2, `first drop at ${trace.spawns[0].t}`);
  assert.ok(trace.spawns[0].t >= 0.05, "a visible beat of charge, not on the very first frame");
});

test("merge: roughly 100 or more pieces drop, the interval shrinks from about 0.30 s to 0.16 s", () => {
  assert.ok(trace.spawns.length >= 100, `drops ${trace.spawns.length}`);
  const gaps = trace.spawns.slice(1).map((s, i) => s.t - trace.spawns[i].t);
  const early = gaps.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const late = gaps.slice(-5).reduce((a, b) => a + b, 0) / 5;
  assert.ok(early > 0.26 && early < 0.34, `early gap ${early}`);
  assert.ok(late > 0.13 && late < 0.2, `late gap ${late}`);
  // drops land on 240 Hz substeps, so a gap may wobble by one or two substeps but never grow for real
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] <= gaps[i - 1] + 0.0085, "gaps never grow");
  assert.ok(gaps[gaps.length - 1] < gaps[0] - 0.1, "the stream is much faster at the end");
});

test("merge: every spawn is tier 1 and every higher tier is earned by a merge", () => {
  const madeByMerge = new Set(trace.merges.map((m) => m.newId));
  const firstSeen = new Map<number, number>();
  for (let f = 0; f < trace.frames; f++) {
    for (const r of records(trace, f)) if (!firstSeen.has(r.id)) firstSeen.set(r.id, r.tier);
  }
  for (const [id, tier] of firstSeen) {
    if (!madeByMerge.has(id)) assert.equal(tier, 1, `piece ${id} was not made by a merge and must be tier 1`);
  }
  for (const s of trace.spawns) {
    const f = Math.floor(s.sub / SUB) + 1;
    if (f >= trace.frames) continue;
    assert.equal(find(trace, f, s.id)?.tier, 1, "spawned piece is tier 1");
    assert.ok(!madeByMerge.has(s.id));
  }
});

test("merge: pieces leave the tube at random angles inside about 35 degrees with varied speeds", () => {
  const angles = trace.spawns.map((s) => (Math.atan2(s.vx, s.vy) * 180) / Math.PI);
  for (const a of angles) assert.ok(Math.abs(a) <= 35.5, `angle ${a.toFixed(1)}`);
  assert.ok(angles.some((a) => a > 12) && angles.some((a) => a < -12), "both sides are used");
  assert.ok(new Set(angles.map((a) => Math.round(a))).size >= 15, "angles are varied");
  const speeds = trace.spawns.map((s) => Math.hypot(s.vx, s.vy));
  assert.ok(Math.max(...speeds) - Math.min(...speeds) > 250, "speeds are varied");
  for (const s of trace.spawns) assert.ok(Math.abs(s.x - 540) < 40 && s.y < 700, "spawned at the tube mouth");
});

/* ---------- merges ---------- */

test("merge: each merge consumes exactly two same-tier pieces and creates one piece of the next tier", () => {
  assert.ok(trace.merges.length >= 60, `merges ${trace.merges.length}`);
  for (const m of trace.merges) {
    const fb = Math.floor(m.sub / SUB);
    const fa = fb + 1;
    if (fa >= trace.frames) continue;
    const a = find(trace, fb, m.aId);
    const b = find(trace, fb, m.bId);
    assert.ok(a && b, `parents of merge ${m.index} exist just before it`);
    assert.equal(a.tier, b.tier, "same tier");
    assert.notEqual(m.aId, m.bId);
    assert.equal(m.tier, a.tier + 1, "next tier");
    assert.ok(a.tier < TIER_COUNT, "tier 7 never merges");
    const made = find(trace, fa, m.newId);
    assert.ok(made, "the new piece exists just after");
    assert.equal(made.tier, a.tier + 1);
    assert.ok(!find(trace, fa, m.aId) && !find(trace, fa, m.bId), "both parents are gone");
    assert.ok(Math.abs(made.x - (a.x + b.x) / 2) < 25 && Math.abs(made.y - (a.y + b.y) / 2) < 40, "born at the centre of mass");
  }
  for (let f = 0; f < trace.frames; f += 7) {
    const sub = f * SUB;
    const spawned = trace.spawns.filter((s) => s.sub < sub).length;
    const merged = trace.merges.filter((m) => m.sub < sub).length;
    assert.equal(trace.frameStart[f + 1] - trace.frameStart[f], spawned - merged, `piece count at frame ${f}`);
  }
});

test("merge: tier 7 never merges and nothing above tier 7 exists", () => {
  for (const m of trace.merges) assert.ok(m.tier >= 2 && m.tier <= TIER_COUNT);
  for (let k = 0; k < trace.ptier.length; k++) assert.ok(trace.ptier[k] >= 1 && trace.ptier[k] <= TIER_COUNT);
  const finalIds = new Set(trace.merges.filter((m) => m.tier === TIER_COUNT).map((m) => m.newId));
  assert.ok(finalIds.size >= 1);
  const last = trace.frames - 1;
  for (const id of finalIds) assert.ok(find(trace, last, id), `tier-7 piece ${id} is still there at the end`);
});

test("merge: the first tier-7 piece appears between 18.5 s and 21.5 s and the final form is held for at least 2 s", () => {
  const first = trace.merges.find((m) => m.tier === TIER_COUNT);
  assert.ok(first, "a final form appears");
  assert.equal(trace.firstFinalT, first.t);
  assert.ok(first.t >= 18.5 && first.t <= 21.5, `first tier-7 at ${first.t.toFixed(2)} s`);
  assert.ok(MERGE_SPEC.sceneFrames / 60 - first.t >= 2, "held for at least 2 s");
  const rise = trace.merges.filter((m) => m.tier === 6).length;
  assert.ok(rise >= 2, "tier 6 is reached twice before");
});

test("merge: a visible chain happens (merges that trigger each other)", () => {
  const maxChain = Math.max(...trace.merges.map((m) => m.chain));
  assert.ok(maxChain >= 3, `max chain ${maxChain}`);
  let state = CHAIN_IDLE;
  for (const m of trace.merges) {
    state = chainOnMerge(state, m.t, m.linked);
    assert.equal(m.chain, state.count, `chain of merge ${m.index}`);
    if (m.chain > 1) assert.ok(m.linked, "a chain is only raised by a merge that a recent merge triggered");
  }
  for (let f = 0; f < trace.frames; f += 11) {
    let s = CHAIN_IDLE;
    for (const m of trace.merges) if (m.sub < f * SUB) s = chainOnMerge(s, m.t, m.linked);
    assert.equal(trace.chainLive[f], chainLive(s, (f * SUB) / (SUB * 60)), `live chain at frame ${f}`);
  }
});

test("merge: the HUD arrays follow the merges", () => {
  assert.equal(trace.topTier[0], 0, "nothing reached at frame 0");
  assert.equal(trace.mergeCount[0], 0);
  for (let f = 0; f < trace.frames; f += 13) {
    const sub = f * SUB;
    const merged = trace.merges.filter((m) => m.sub < sub);
    assert.equal(trace.mergeCount[f], merged.length);
    const anyDrop = trace.spawns.some((s) => s.sub < sub);
    const expected = Math.max(anyDrop ? 1 : 0, ...merged.map((m) => m.tier));
    assert.equal(trace.topTier[f], expected, `tier at frame ${f}`);
  }
  assert.equal(trace.topTier[trace.frames - 1], TIER_COUNT);
});

/* ---------- physics ---------- */

test("merge: the pile never rises above y = 700 and nothing sinks through the floor", () => {
  assert.equal(PILE_LIMIT_Y, 700);
  assert.equal(FLOOR_Y, 1448);
  let highest = Infinity;
  for (let f = 0; f < trace.frames; f++) {
    for (let k = trace.frameStart[f]; k < trace.frameStart[f + 1]; k++) {
      const id = trace.pid[k];
      const y = trace.py[k] / POS_SCALE;
      const r = trace.pr[k] / POS_SCALE;
      const age = (f - trace.bornFrame[id]) / 60;
      if (age >= PILE_GRACE_SEC) highest = Math.min(highest, y - r);
      assert.ok(y + r <= FLOOR_Y + 6, `frame ${f}: piece ${id} below the floor`);
    }
  }
  assert.ok(highest >= PILE_LIMIT_Y, `highest settled top ${highest.toFixed(0)}`);
  assert.ok(Number.isFinite(highest));
  assert.ok(trace.stats.pileTopMinY >= PILE_LIMIT_Y);
});

test("merge: penetration at sampled frames is at most 6 px (pieces, walls, floor)", () => {
  let worst = 0;
  for (let f = 0; f < trace.frames; f += 17) {
    const rs = records(trace, f);
    for (let i = 0; i < rs.length; i++) {
      const a = rs[i];
      worst = Math.max(worst, a.r - a.x, a.x + a.r - WORLD_W, a.y + a.r - FLOOR_Y);
      for (let j = i + 1; j < rs.length; j++) {
        const b = rs[j];
        worst = Math.max(worst, a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
  }
  assert.ok(worst <= 6, `worst penetration ${worst.toFixed(2)} px`);
});

test("merge: the two corner ramps of the funnel hold the pieces up (no piece sinks into a ramp)", () => {
  const run = TUNING.rampRun;
  const rise = TUNING.rampRise;
  assert.ok(run > 0 && rise > 0, "the funnel has ramps");
  const len = Math.hypot(run, rise);
  const y0 = FLOOR_Y - rise;
  let worst = 0;
  let onRamp = 0;
  for (let f = 0; f < trace.frames; f += 9) {
    for (const r of records(trace, f)) {
      // signed distance from the ramp lines; the playfield is on the positive side
      const left = (r.x * rise + (r.y - y0) * -run) / len;
      const right = ((WORLD_W - r.x) * rise + (r.y - y0) * -run) / len;
      worst = Math.max(worst, r.r - left, r.r - right);
      if (Math.abs(left - r.r) < 3 || Math.abs(right - r.r) < 3) onRamp++;
    }
  }
  assert.ok(worst <= 6, `worst ramp penetration ${worst.toFixed(2)} px`);
  assert.ok(onRamp >= 20, "pieces really rest on the ramps");
  assert.ok(trace.stats.maxOverlap <= 6, `worst overlap at any frame ${trace.stats.maxOverlap.toFixed(2)} px`);
});

test("merge: pieces stay inside the canvas and the world is not frozen", () => {
  for (let f = 0; f < trace.frames; f += 29) {
    for (const r of records(trace, f)) {
      assert.ok(r.x >= 0 && r.x <= WORLD_W, "inside the walls");
      assert.ok(r.y > 400 && r.y < FLOOR_Y + 1);
    }
  }
  // pieces keep moving through the hold: some piece changes position in the last second
  const f0 = trace.frames - 61;
  const a = records(trace, f0);
  const b = records(trace, trace.frames - 1);
  let moved = 0;
  for (const r of b) {
    const p = a.find((q) => q.id === r.id);
    if (p && Math.hypot(p.x - r.x, p.y - r.y) > 2) moved++;
  }
  assert.ok(moved >= 2 || b.length > a.length, "pieces keep moving after the final form");
});

/* ---------- audio schedule ---------- */

test("merge: audio schedule respects the caps and climbs with the tier", () => {
  const s = buildMergeSchedule(trace);
  assert.ok(maxPerWindow(s.ticks.map((e) => e.t), 1) <= 8, "ticks at most 8/s");
  assert.ok(maxPerWindow(s.thuds.map((e) => e.t), 1) <= 6, "thuds at most 6/s");
  assert.ok(maxPerWindow(s.bells.map((e) => e.t), 1) <= 10, "bells at most 10/s");
  assert.ok(s.bells.length >= 40 && s.ticks.length >= 60 && s.thuds.length >= 10);
  const byTier = new Map<number, number>();
  for (const b of s.bells) if (b.chainNote === 0) byTier.set(b.tier, b.midi);
  const tiers = [...byTier.keys()].sort((a, b) => a - b);
  for (let i = 1; i < tiers.length; i++) assert.ok(byTier.get(tiers[i])! > byTier.get(tiers[i - 1])!, "pitch rises with the tier");
  for (const b of s.bells) assert.ok(b.chainNote >= 0 && b.chainNote <= 2, "a chain adds at most two notes");
  const chained = s.bells.filter((b) => b.chainNote > 0);
  assert.ok(chained.length >= 2, "chains add notes above");
  for (const c of chained) {
    const main = s.bells.find((b) => b.chainNote === 0 && b.tier === c.tier && Math.abs(c.t - b.t - 0.04 * c.chainNote) < 1e-6);
    assert.ok(main || c.chainNote === 2, "a chain note follows its main bell by 40 ms steps");
    assert.ok(c.midi > (main?.midi ?? 0));
  }
  for (const e of s.thuds) assert.ok(e.gain > 0 && e.gain <= 0.2, "thuds are soft");
  for (const e of s.ticks) assert.ok(e.gain > 0 && e.gain <= 0.08, "ticks are very soft");
});

test("merge: the final form has a riser before it, a boom and a C major add9 fanfare on it", () => {
  const s = buildMergeSchedule(trace);
  assert.ok(s.final);
  assert.equal(s.final.t, trace.firstFinalT);
  assert.ok(s.final.riserStart < s.final.t - 0.8, "a riser builds before the final form");
  assert.ok(s.final.riserStart >= 0);
  assert.deepEqual(
    s.final.chordMidi.map((m) => m % 12).sort((a, b) => a - b),
    [0, 2, 4, 7],
    "C, D, E, G: C major add9",
  );
});

test("merge: the mastered mix is warm, mastered and runs to the last frame", () => {
  const audio = funnelMerge.buildAudio(trace);
  const left = audio.buffer.left;
  const tail = left.subarray(left.length - 4800);
  let energy = 0;
  for (const v of tail) energy += v * v;
  assert.ok(energy / tail.length > 1e-8, "the pad bed is still sounding on the last frame");
});

/* ---------- painter ---------- */

test("merge: the painter keeps every text box safe on sampled frames, including chain popups", () => {
  const chained = trace.merges.filter((m) => m.chain >= 2);
  const frames = new Set<number>([0, 1, 6, 30, 300, 600, 900, 1200, 1380, MERGE_SPEC.sceneFrames - 1]);
  for (const m of chained.slice(0, 40)) {
    frames.add(m.frame + 1);
    frames.add(m.frame + 12);
    frames.add(m.frame + 30);
  }
  for (let f = 0; f < MERGE_SPEC.sceneFrames; f += 5) frames.add(f);
  for (const f of frames) {
    if (f >= MERGE_SPEC.sceneFrames) continue;
    const mock = createMockCanvas();
    const boxes = funnelMerge.paint(mock.ctx, trace, f);
    assert.ok(boxes.length >= 5);
    for (const box of boxes) assertReelSafeBox(box);
    for (const t of mock.texts) assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
  }
});

test("merge: popups clamp inside the safe text bounds", () => {
  assert.equal(clampPopupLeft(10, 80), 60 + 6);
  assert.equal(clampPopupLeft(2000, 80), 900 - 80 - 6);
  assert.equal(clampPopupLeft(480, 80), 480);
  for (const w of [30, 80, 200]) {
    for (const x of [-500, 0, 60, 300, 899, 1080, 5000]) {
      const left = clampPopupLeft(x, w);
      assert.ok(left >= 60 && left + w <= 900, `popup ${w} px wide at ${x} fits`);
    }
  }
});

test("merge: frame 0 shows the rule, the empty ladder and the nozzle; the HUD counters climb", () => {
  const mock0 = createMockCanvas();
  funnelMerge.paint(mock0.ctx, trace, 0);
  const t0s = mock0.texts.map((t) => t.text);
  assert.ok(t0s.includes(MERGE_SPEC.rule));
  for (const name of ["bit", "byte", "line", "func", "file", "repo", "agent"]) assert.ok(t0s.includes(name), `ladder shows ${name}`);
  assert.ok(t0s.includes("TIER") && t0s.includes("0/7"), "tier counter starts at 0/7");
  assert.ok(t0s.includes("MERGES") && t0s.includes("0"));
  assert.ok(!t0s.some((t) => t.includes("FINAL FORM")), "no flash-forward of the ending");
  assert.ok(!t0s.includes("CHAIN"), "no chain before a chain");

  const mid = Math.round(trace.frames * 0.5);
  const mockMid = createMockCanvas();
  funnelMerge.paint(mockMid.ctx, trace, mid);
  const texts = mockMid.texts.map((t) => t.text);
  assert.ok(texts.includes(`${trace.topTier[mid]}/7`), "tier counter shows the highest reached tier");
  assert.ok(texts.includes(String(trace.mergeCount[mid])), "merge counter shows the count");
});

test("merge: the chain chip shows while a chain is live and the final frame draws FINAL FORM", () => {
  const m = trace.merges.find((x) => x.chain >= 3);
  assert.ok(m);
  const f = m.frame + 3;
  const mock = createMockCanvas();
  funnelMerge.paint(mock.ctx, trace, f);
  const texts = mock.texts.map((t) => t.text);
  assert.ok(texts.includes("CHAIN"), "chain label while live");
  assert.ok(texts.some((t) => t === `x${trace.chainLive[f]}`), "chain count shown");

  const finalFrame = Math.ceil(trace.firstFinalT * 60);
  const before = createMockCanvas();
  funnelMerge.paint(before.ctx, trace, finalFrame - 4);
  assert.ok(!before.texts.some((t) => t.text.includes("FINAL FORM")), "the banner waits for the merge");
  for (const ff of [finalFrame + 30, MERGE_SPEC.sceneFrames - 1]) {
    const after = createMockCanvas();
    const boxes = funnelMerge.paint(after.ctx, trace, ff);
    assert.ok(after.texts.some((t) => t.text === FINAL_BANNER), `frame ${ff} draws ${FINAL_BANNER}`);
    for (const box of boxes) assertReelSafeBox(box);
  }
});

test("merge: an ambient layer of at least 80 drifting dots keeps the whole frame alive", () => {
  assert.ok(AMBIENT_DOT_COUNT >= 80);
  const a = createMockCanvas();
  const b = createMockCanvas();
  funnelMerge.paint(a.ctx, trace, 100);
  funnelMerge.paint(b.ctx, trace, 101);
  assert.ok(a.shapes.length > 60, "many separate shapes");
  const c = createMockCanvas();
  funnelMerge.paint(c.ctx, trace, 700);
  assert.ok(c.coverageGrid(6, 10) >= 0.8, `coverage ${c.coverageGrid(6, 10)}`);
});
