import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE_RATE, SAMPLES_PER_FRAME } from "../audio.ts";
import { VIDEO } from "../settings.ts";
import { synthesizePatateWav } from "./audio.ts";
import { FLASK_JOIN_Y, PATATE_COMPOSITIONS, simulatePatate } from "./sim.ts";
import {
  PATATE_FLASK,
  PATATE_SCENE_FRAMES,
  PATATE_TOTAL_FRAMES,
} from "./themes.ts";

test("all three Patate Merge simulations are deterministic, finite, contained, and unlock Tiers 1..8 before 19.2s", () => {
  const seenSeeds = new Set<number>();

  for (const comp of PATATE_COMPOSITIONS) {
    assert.ok(!seenSeeds.has(comp.seed), `${comp.id} must have a unique seed`);
    seenSeeds.add(comp.seed);

    const trace = simulatePatate(comp.slug);
    const replay = simulatePatate(comp.slug, comp.seed);
    assert.equal(trace.totalFrames, PATATE_TOTAL_FRAMES);
    assert.equal(trace.sceneFrames, PATATE_SCENE_FRAMES);
    assert.equal(trace.frames.length, PATATE_SCENE_FRAMES + 1);
    assert.deepEqual(trace.events, replay.events);

    // Every tier 1..8 unlocked cleanly, with Boss Tier 8 before 19.2s (frame 1152)
    for (let t = 0; t < 8; t++) {
      assert.notEqual(
        trace.unlockFrames[t],
        null,
        `${comp.id}: tier ${t + 1} never unlocked`,
      );
    }
    assert.ok(
      trace.bossMergeFrame !== null &&
        trace.bossMergeFrame >= 900 &&
        trace.bossMergeFrame <= 1152,
      `${comp.id}: expected boss merge before 19.2s, got ${trace.bossMergeFrame}`,
    );

    // Monotonic displayed score and zero NaNs / flask containment
    let prevScore = 0;
    for (const f of trace.frames) {
      assert.ok(Number.isFinite(f.score) && f.score >= prevScore);
      prevScore = f.score;

      for (const b of f.bodies) {
        assert.ok(
          Number.isFinite(b.x) &&
            Number.isFinite(b.y) &&
            Number.isFinite(b.theta) &&
            Number.isFinite(b.scaleX) &&
            Number.isFinite(b.scaleY),
          `${comp.id} frame ${f.frame}: non-finite body state`,
        );

        // Chute / flask containment check (zero overflow out the top of the chute)
        assert.ok(
          b.y - b.r >= PATATE_FLASK.chuteTopY - 2,
          `${comp.id} frame ${f.frame}: potato overflowed top of chute (y=${b.y}, r=${b.r})`,
        );
        if (b.enteredFlask && b.y >= FLASK_JOIN_Y + b.r) {
          const dist = Math.hypot(b.x - PATATE_FLASK.cx, b.y - PATATE_FLASK.cy);
          const maxCenterDist = PATATE_FLASK.radius + 3;
          assert.ok(
            dist + b.r <= maxCenterDist,
            `${comp.id} frame ${f.frame}: body exceeded flask radius (dist+r=${dist + b.r})`,
          );
        }
      }

      // Callout horizontal safe-margin check
      for (const c of f.callouts) {
        assert.ok(c.x >= 200 && c.x <= VIDEO.width - 200);
      }
    }

    assert.ok(trace.maxScore >= 15000, `${comp.id}: expected high arcade score`);
  }
});

test("Patate Merge French pitch-scaled WAV synthesis is deterministic and properly calibrated", () => {
  for (const comp of PATATE_COMPOSITIONS) {
    const trace = simulatePatate(comp.slug);
    const wav = synthesizePatateWav(trace);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.readUInt32LE(24), SAMPLE_RATE);
    assert.equal(
      wav.length,
      44 + PATATE_TOTAL_FRAMES * SAMPLES_PER_FRAME * 2,
    );
    assert.deepEqual(wav, synthesizePatateWav(trace));

    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) {
      peak = Math.max(peak, Math.abs(wav.readInt16LE(i)) / 32767);
    }
    assert.ok(
      peak > 0.45 && peak <= 0.85,
      `${comp.id}: expected calibrated peak in (0.45, 0.85], got ${peak}`,
    );
  }
});
