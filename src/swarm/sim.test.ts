import assert from "node:assert/strict";
import test from "node:test";
import { VIDEO } from "../settings.ts";
import {
  analyzeSwarm,
  cyclicRules,
  mulberry32,
  scoreSwarmArc,
  simulateSwarm,
  SWARM_HOLD_FRAMES,
  type SwarmConfig,
  type SwarmTrace,
} from "./sim.ts";
import { SWARM_DEFINITIONS, simulateSwarmDefinition } from "./themes.ts";

/** A copy that cannot hit the module cache, so replays are genuinely recomputed. */
function replayConfig(config: SwarmConfig): SwarmConfig {
  return { ...config, id: config.id + "-replay" };
}

function assertSameTrace(a: SwarmTrace, b: SwarmTrace) {
  assert.equal(a.winFrame, b.winFrame);
  assert.equal(a.totalFrames, b.totalFrames);
  assert.equal(a.winner, b.winner);
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.counts, b.counts);
  assert.deepEqual(a.x, b.x);
  assert.deepEqual(a.y, b.y);
  assert.deepEqual(a.type, b.type);
}

type Pt = { x: number; y: number };

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(pts: readonly Pt[]): Pt[] {
  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 1) return sorted;
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function hullsStrictlySeparated(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];
      const nx = -(p1.y - p0.y);
      const ny = p1.x - p0.x;
      let maxA = -Infinity;
      let minA = Infinity;
      for (const p of a) {
        const v = p.x * nx + p.y * ny;
        if (v > maxA) maxA = v;
        if (v < minA) minA = v;
      }
      let maxB = -Infinity;
      let minB = Infinity;
      for (const p of b) {
        const v = p.x * nx + p.y * ny;
        if (v > maxB) maxB = v;
        if (v < minB) minB = v;
      }
      if (maxA < minB - 1e-6 || maxB < minA - 1e-6) return true;
    }
  }
  return false;
}

test("opening layout: armies start packed on their own sides, centroids >= 600 px apart, symmetric, disjoint, with a fast charge", () => {
  for (const definition of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(definition.slug);
    const { count, types, config } = trace;
    const W = config.arena.width;
    const r = config.radius;
    assert.equal(W, 980);

    const byType: Pt[][] = Array.from({ length: types }, () => []);
    for (let i = 0; i < count; i++) {
      byType[trace.type[i]].push({ x: trace.x[i], y: trace.y[i] });
      for (let j = i + 1; j < count; j++) {
        const d = Math.hypot(trace.x[i] - trace.x[j], trace.y[i] - trace.y[j]);
        assert.ok(d >= 2 * r - 0.01, `${definition.id}: initial overlap (${d.toFixed(2)} px)`);
      }
    }

    for (const pts of byType) {
      for (let i = 0; i < pts.length; i++) {
        let nearest = Infinity;
        for (let j = 0; j < pts.length; j++) {
          if (i !== j) nearest = Math.min(nearest, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
        }
        assert.ok(nearest <= 2.35 * r, `${definition.id}: detached sprite in starting formation (${nearest.toFixed(1)} px)`);
      }
    }

    const centroids = byType.map((pts) => ({
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    }));
    const hulls = byType.map(convexHull);

    for (let a = 0; a < types; a++) {
      for (let b = a + 1; b < types; b++) {
        const dist = Math.hypot(centroids[a].x - centroids[b].x, centroids[a].y - centroids[b].y);
        assert.ok(dist >= 600, `${definition.id}: centroids ${a} and ${b} only ${dist.toFixed(1)} px apart (< 600 px)`);
        assert.ok(hullsStrictlySeparated(hulls[a], hulls[b]), `${definition.id}: army regions ${a} and ${b} overlap`);
      }
    }

    const midX = W / 2;
    if (types === 3) {
      assert.ok(Math.abs(centroids[2].x - midX) <= 3, `classic top army off-axis: ${centroids[2].x.toFixed(2)}`);
      assert.ok(centroids[0].x < midX && centroids[1].x > midX);
      assert.ok(Math.abs((centroids[0].x + centroids[1].x) / 2 - midX) <= 3, "classic lower armies not mirrored in x");
      assert.ok(Math.abs(centroids[0].y - centroids[1].y) <= 3, "classic lower armies not mirrored in y");
    } else if (types === 5) {
      assert.ok(Math.abs(centroids[0].x - midX) <= 3, `five-rivals top army off-axis: ${centroids[0].x.toFixed(2)}`);
      assert.ok(centroids[4].x < midX && centroids[1].x > midX);
      assert.ok(Math.abs((centroids[4].x + centroids[1].x) / 2 - midX) <= 3, "five-rivals upper pair not mirrored in x");
      assert.ok(Math.abs(centroids[4].y - centroids[1].y) <= 3, "five-rivals upper pair not mirrored in y");
      assert.ok(centroids[3].x < midX && centroids[2].x > midX);
      assert.ok(Math.abs((centroids[3].x + centroids[2].x) / 2 - midX) <= 3, "five-rivals lower pair not mirrored in x");
      assert.ok(Math.abs(centroids[3].y - centroids[2].y) <= 3, "five-rivals lower pair not mirrored in y");
    }

    assert.ok(trace.events.length > 0);
    const firstConversionSec = trace.events[0].frame / VIDEO.fps;
    assert.ok(
      firstConversionSec > 0 && firstConversionSec <= 1.5,
      `${definition.id}: first conversion at ${firstConversionSec.toFixed(2)} s (expected within 1.5 s)`,
    );
  }
});

test("mulberry32 is the standard stream and rules matrices are tournaments", () => {
  const rand = mulberry32(1);
  assert.equal(rand(), 0.6270739405881613);
  assert.equal(rand(), 0.002735721180215478);

  const five = cyclicRules(5, 2);
  for (let a = 0; a < 5; a++) {
    assert.equal(five[a].reduce((sum, v) => sum + v, 0), 2, "each type beats exactly two others");
    assert.equal(five.reduce((sum, row) => sum + row[a], 0), 2, "each type loses to exactly two others");
    for (let b = 0; b < 5; b++) assert.ok(a === b ? five[a][b] === 0 : five[a][b] + five[b][a] === 1);
  }
});

test("the same seed replays the same run and a different seed does not", () => {
  for (const definition of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(definition.slug);
    const replay = simulateSwarm(replayConfig(definition.config));
    assert.notEqual(trace, replay);
    assertSameTrace(trace, replay);

    const other = simulateSwarm({ ...definition.config, seed: definition.config.seed + 1 }, { record: false });
    assert.notDeepEqual(other.events, trace.events);
  }
});

test("sprites are conserved, only change type through events, and each takes part in at most one contact per step", () => {
  for (const definition of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(definition.slug);
    const { count, types, config } = trace;
    const rules = config.rules;
    const type = Uint8Array.from(trace.type.subarray(0, count));
    const counts = new Int32Array(types);
    for (const t of type) counts[t]++;
    assert.equal(count, config.count);
    assert.ok(count >= 150 && count <= 300, `${definition.id}: sprite total ${count} outside 150..300`);

    let cursor = 0;
    for (let f = 0; f < trace.totalFrames; f++) {
      const involved = new Set<number>();
      assert.equal(trace.eventStart[f], cursor, `${definition.id}: eventStart wrong at frame ${f}`);
      while (cursor < trace.events.length && trace.events[cursor].frame === f) {
        const event = trace.events[cursor++];
        assert.ok(f >= 1, "no conversion in the opening frame");
        assert.ok(!involved.has(event.sprite) && !involved.has(event.by), `${definition.id}: sprite reused in frame ${f}`);
        involved.add(event.sprite);
        involved.add(event.by);
        assert.equal(rules[event.winner][event.loser], 1, "winner must beat loser");
        assert.equal(type[event.sprite], event.loser, "loser had the loser type");
        assert.equal(type[event.by], event.winner, "converter had the winner type");
        type[event.sprite] = event.winner;
        counts[event.loser]--;
        counts[event.winner]++;
      }
      let total = 0;
      for (let k = 0; k < types; k++) {
        assert.equal(trace.counts[f * types + k], counts[k], `${definition.id}: count drift at frame ${f}`);
        total += trace.counts[f * types + k];
      }
      assert.equal(total, count);
      assert.deepEqual(trace.type.subarray(f * count, (f + 1) * count), type, `${definition.id}: type mismatch at frame ${f}`);
    }
    assert.equal(cursor, trace.events.length);
    assert.equal(trace.eventStart[trace.totalFrames], trace.events.length);
  }
});

test("conversions are real contacts and sprites stay inside the arena", () => {
  for (const definition of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(definition.slug);
    const { count, config } = trace;
    const r = config.radius;
    for (const event of trace.events) {
      const a = event.sprite;
      const b = event.by;
      const f = event.frame;
      const d = Math.hypot(trace.x[f * count + a] - trace.x[f * count + b], trace.y[f * count + a] - trace.y[f * count + b]);
      assert.ok(d < 2 * r + 0.5, `${definition.id}: conversion at distance ${d.toFixed(1)} px`);
    }
    for (let i = 0; i < trace.x.length; i++) {
      assert.ok(Number.isFinite(trace.x[i]) && Number.isFinite(trace.y[i]) && Number.isFinite(trace.angle[i]));
      assert.ok(trace.x[i] >= r - 0.01 && trace.x[i] <= config.arena.width - r + 0.01, "x inside the arena");
      assert.ok(trace.y[i] >= r - 0.01 && trace.y[i] <= config.arena.height - r + 0.01, "y inside the arena");
    }
  }
});

test("every composition ends in a single winner and a three second hold", () => {
  for (const definition of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(definition.slug);
    const { count, types } = trace;
    assert.ok(trace.finished, `${definition.id}: never reached a single survivor`);
    assert.equal(trace.totalFrames, trace.winFrame + SWARM_HOLD_FRAMES);
    assert.equal(SWARM_HOLD_FRAMES, 3 * VIDEO.fps);
    const seconds = trace.totalFrames / VIDEO.fps;
    assert.ok(seconds >= 30 && seconds <= 45, `${definition.id}: ${seconds.toFixed(1)} s is outside 30..45 s`);
    for (let f = trace.winFrame; f < trace.totalFrames; f++) {
      for (let k = 0; k < types; k++) {
        assert.equal(trace.counts[f * types + k], k === trace.winner ? count : 0, "one type holds every sprite from winFrame");
      }
    }
    assert.ok(trace.events.every((event) => event.frame <= trace.winFrame), "no conversions during the hold");
    const alive = (f: number) => Array.from({ length: types }, (_, k) => trace.counts[f * types + k]).filter((c) => c > 0).length;
    assert.equal(alive(trace.winFrame), 1);
    assert.ok(alive(trace.winFrame - 1) > 1, "winFrame is the first single-type frame");
  }
});

test("the chosen seeds deliver the arc: lead changes, a comeback, a late survivor", () => {
  for (const definition of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(definition.slug);
    const metrics = analyzeSwarm(trace);
    const { ok } = scoreSwarmArc(trace, metrics, definition.arc);
    assert.ok(ok, `${definition.id}: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.leadChanges >= 3, `${definition.id}: only ${metrics.leadChanges} lead changes`);
    assert.ok(metrics.winnerMinShare <= definition.arc.maxComebackShare, "the winner dipped low after 25% of the clip");
    assert.ok(metrics.winFraction >= 0.8 && metrics.winFraction <= 0.95, `${definition.id}: survivor at ${metrics.winFraction}`);
    assert.ok(metrics.winnerMinFrame >= Math.floor(trace.totalFrames * 0.25), "the dip happens after the first quarter");
  }
});
