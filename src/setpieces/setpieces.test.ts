import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMockCanvas } from "../hits/mockCanvas.ts";
import {
  getGlassFloorsSpec,
  paintGlassFloorsFrame,
  simulateGlassFloors,
  synthesizeGlassFloorsAudio,
} from "./glass-floors.ts";
import {
  getHexChainSpec,
  HEX_CORES,
  paintHexChainFrame,
  simulateHexChain,
  synthesizeHexChainAudio,
  TOTAL_CORES,
} from "./hex-chain.ts";
import { SETPIECE_COMPOSITIONS } from "./index.ts";

describe("Round 4 physics set pieces", () => {
  it("SetPieceGlassFloors shatters all 10 floors, splits 1 -> 512 balls, and reaches the Core cleanly", () => {
    const trace = simulateGlassFloors();
    const spec = getGlassFloorsSpec();
    assert.equal(spec.slug, "setpiece-glass-floors");
    assert.equal(trace.shatterEvents.length, 10, "all 10 floors must shatter");
    assert.ok(trace.shatterEvents[0].t <= 2.2, `Floor 1 must break inside hook window (got ${trace.shatterEvents[0].t}s)`);
    assert.equal(trace.ballCounts[0], 1, "starts with exactly 1 ball");
    assert.equal(trace.ballCounts[trace.totalFrames - 1], 512, "reaches 512 balls across 9 x2 gates");
    assert.ok(trace.totalFrames >= 35 * 60 && trace.totalFrames <= 50 * 60, `duration ${trace.totalFrames / 60}s in 35..50s`);

    const audio = synthesizeGlassFloorsAudio(trace);
    assert.equal(Buffer.from(audio.wav.subarray(0, 4)).toString("ascii"), "RIFF");
    assert.ok(audio.peakDb <= -1.4 && audio.peakDb >= -12, `peak ${audio.peakDb} dBFS in healthy range`);
    assert.ok(audio.rmsDb <= -8 && audio.rmsDb >= -26, `rms ${audio.rmsDb} dBFS in healthy range`);

    const ctx = createMockCanvas().ctx;
    for (const f of [0, 30, Math.floor(trace.payoffFrame * 0.5), trace.payoffFrame, trace.totalFrames - 1]) {
      paintGlassFloorsFrame(ctx as unknown as CanvasRenderingContext2D, trace, f);
    }
  });

  it("SetPieceHexChain has 120 6-fold-symmetric cores, clears all 120 -> 121 balls, and triggers inside 2.5 s", () => {
    assert.equal(TOTAL_CORES, 120);
    assert.equal(HEX_CORES.length, 120);
    const trace = simulateHexChain();
    const spec = getHexChainSpec();
    assert.equal(spec.slug, "setpiece-hex-chain");
    assert.equal(trace.clearedCounts[0], 0);
    assert.equal(trace.clearedCounts[trace.totalFrames - 1], 120, "all 120 cores must clear");
    assert.equal(trace.ballCounts[0], 1, "starts with 1 ball");
    assert.equal(trace.ballCounts[trace.totalFrames - 1], 121, "ends with 121 balls");
    assert.ok(trace.shatterEvents[0].t <= 2.5, `first core must break quickly (got ${trace.shatterEvents[0].t}s)`);
    assert.ok(trace.totalFrames >= 34 * 60 && trace.totalFrames <= 50 * 60, `duration ${trace.totalFrames / 60}s in 34..50s`);

    const audio = synthesizeHexChainAudio(trace);
    assert.equal(Buffer.from(audio.wav.subarray(0, 4)).toString("ascii"), "RIFF");
    assert.ok(audio.peakDb <= -1.4 && audio.peakDb >= -12, `peak ${audio.peakDb} dBFS in healthy range`);
    assert.ok(audio.rmsDb <= -8 && audio.rmsDb >= -26, `rms ${audio.rmsDb} dBFS in healthy range`);

    const ctx = createMockCanvas().ctx;
    for (const f of [0, 30, Math.floor(trace.payoffFrame * 0.5), trace.payoffFrame, trace.totalFrames - 1]) {
      paintHexChainFrame(ctx as unknown as CanvasRenderingContext2D, trace, f);
    }
  });

  it("SETPIECE_COMPOSITIONS exports both Round 4 set pieces with unique slugs and ids", () => {
    assert.equal(SETPIECE_COMPOSITIONS.length, 2);
    assert.deepEqual(
      SETPIECE_COMPOSITIONS.map((c) => c.spec.id),
      ["SetPieceGlassFloors", "SetPieceHexChain"],
    );
  });
});
