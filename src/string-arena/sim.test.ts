import assert from "node:assert/strict";
import test from "node:test";
import { REEL_SAFE_BOUNDS } from "../shared/reelUtils.ts";
import { paintStringArenaFrame } from "./paint.ts";
import {
  buildCombinedStringTimeline,
  burstParticles,
  COMBINED_CLOSING_FRAMES,
  simulateStringRound,
  STRING_ARENA,
  STRING_PHYSICS,
  STRING_ROUNDS,
} from "./sim.ts";

function makeMockCanvasContext(): CanvasRenderingContext2D {
  let currentFont = '600 20px "Inter Variable"';
  const gradientStub = { addColorStop() {} };
  const target: Record<string, unknown> = {
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "butt",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    textAlign: "left",
    textBaseline: "alphabetic",
    get font() {
      return currentFont;
    },
    set font(v: string) {
      currentFont = v;
    },
    measureText(str: string) {
      const match = /(\d+(?:\.\d+)?)px/.exec(currentFont);
      const size = match ? Number(match[1]) : 20;
      const width = str.length * size * 0.52;
      return {
        width,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: width,
        actualBoundingBoxAscent: size * 0.76,
        actualBoundingBoxDescent: size * 0.22,
      };
    },
    createRadialGradient: () => gradientStub,
    createLinearGradient: () => gradientStub,
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop as string];
      return () => {};
    },
    set(obj, prop, val) {
      obj[prop as string] = val;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

test("String Arena enforces zero gravity, 12 initial strings, rim-only +1 gains, zero ball-bounce gains, and 0-string elimination", () => {
  assert.equal(STRING_PHYSICS.gravity, 0, "gravity must be strictly 0");
  assert.equal(STRING_ARENA.initialStrings, 12, "each contender starts with 12 strings");

  for (const round of STRING_ROUNDS) {
    const trace = simulateStringRound(round.slug);
    assert.equal(trace.frames[0].balls.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.equal(trace.frames[0].hudCounts[i], 12, `${round.id}: contender ${i} must start at 12 lines`);
    }

    assert.ok(trace.wallGains >= 10, `${round.id}: expected active wall-bounce string gains`);
    assert.ok(trace.bodyCollisions >= 4, `${round.id}: expected ball-ball collisions`);
    assert.ok(trace.cuts >= 50, `${round.id}: expected rival string cuts`);

    // Every 'gain' anchor lies strictly on the circular rim
    for (const ev of trace.events) {
      if (ev.kind === "gain") {
        const dist = Math.hypot(ev.x - STRING_ARENA.cx, ev.y - STRING_ARENA.cy);
        assert.ok(Math.abs(dist - STRING_ARENA.r) < 1e-5, "gain anchor must sit on arena rim");
      }
      if (ev.kind === "cut") {
        assert.notEqual(ev.owner, ev.cutter, "a contender never cuts its own string");
        assert.ok(ev.distance <= STRING_ARENA.ballR + 1e-4, "swept string cut must occur within ball radius");
      }
    }

    // Verify per-contender string balance accounting: 12 + wallGains(i) - cuts(i) === final count
    const finalState = trace.frames[trace.finishFrame];
    for (let i = 0; i < 5; i++) {
      const gainsForI = trace.events.filter((e) => e.kind === "gain" && e.owner === i).length;
      const cutsOnI = trace.events.filter((e) => e.kind === "cut" && e.owner === i).length;
      assert.equal(
        12 + gainsForI - cutsOnI,
        finalState.hudCounts[i],
        `${round.id}: ball-ball collisions must never grant or transfer strings`,
      );
    }

    // Verify HUD counts match live string sets at every frame and no alive ball ever sits at 0 strings
    for (const st of trace.frames) {
      for (let i = 0; i < 5; i++) {
        assert.equal(st.hudCounts[i], st.stringsByOwner[i].length);
        if (st.balls[i].alive) {
          assert.ok(st.hudCounts[i] > 0, "alive ball must have >= 1 string");
        } else {
          assert.equal(st.hudCounts[i], 0, "eliminated ball must have 0 strings");
        }
      }
    }

    // Winner is the sole surviving contender
    const survivors = finalState.balls.filter((b) => b.alive);
    assert.equal(survivors.length, 1);
    assert.equal(survivors[0].id, trace.winnerId);
  }
});

test("Elimination particle burst fills the entire disc volume including exact centre (no hollow ring)", () => {
  for (const age of [0.05, 0.25, 0.55]) {
    const maxR = 10 + 118 * age;
    const pts = burstParticles({ x: 480, y: 992, owner: 2 }, age);
    const radii = pts.map((p) => Math.hypot(p.x - 480, p.y - 992));
    assert.equal(radii[0], 0, "exact centre particle must be present");
    assert.ok(radii.filter((r) => r <= maxR * 0.25).length >= 12, "inner core [0, 0.25R] must be densely populated");
    assert.ok(radii.filter((r) => r > maxR * 0.25 && r <= maxR * 0.5).length >= 10, "band (0.25R, 0.5R] populated");
    assert.ok(radii.filter((r) => r > maxR * 0.5 && r <= maxR * 0.75).length >= 12, "band (0.5R, 0.75R] populated");
    assert.ok(radii.filter((r) => r > maxR * 0.75 && r <= maxR + 1e-6).length >= 14, "outer band (0.75R, R] populated");
  }
});

test("Combined String Arena timeline & Canvas HUD stay strictly within reel safe zone x:60..900, y:220..1560", () => {
  const timeline = buildCombinedStringTimeline();
  assert.equal(timeline.rounds.length, 3);
  assert.equal(timeline.closingFrames, COMBINED_CLOSING_FRAMES);
  const totalSec = timeline.totalFrames / 60;
  assert.ok(totalSec >= 36 && totalSec <= 45, `Combined duration ${totalSec}s outside 36..45s window`);

  const ctx = makeMockCanvasContext();
  for (const seg of timeline.rounds) {
    const sampleFrames = [
      0,
      Math.floor(seg.trace.finishFrame / 2),
      seg.trace.finishFrame,
      seg.trace.totalRoundFrames - 1,
    ];
    for (const lf of sampleFrames) {
      const boxes = paintStringArenaFrame(ctx, seg.trace, lf, { isCombined: true });
      assert.ok(boxes.length >= 15);
      for (const b of boxes) {
        assert.ok(
          b.left >= REEL_SAFE_BOUNDS.left - 0.5 &&
            b.right <= REEL_SAFE_BOUNDS.right + 0.5 &&
            b.top >= REEL_SAFE_BOUNDS.top - 0.5 &&
            b.bottom <= REEL_SAFE_BOUNDS.bottom + 0.5,
          `Box escaped safe zone: ${JSON.stringify(b)}`,
        );
      }
    }
  }
});
