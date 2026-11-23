import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createStereoBuffer, measureStereoLufsAndPeak } from "../audio-reactive/synth.ts";
import { VIDEO } from "../settings.ts";
import { assertReelSafeBox, REEL_SAFE_BOUNDS } from "../shared/reelUtils.ts";
import {
  buildComebackAudio,
  buildComebackFeatures,
  clearComebackCaches,
  COMEBACK_COMPOSITIONS,
  paintComebackFrame,
  simulateComeback,
  synthesizeComebackWav,
  verifyComebackInvariants,
} from "./index.ts";
import type { ComebackTraceBase } from "./invariants.ts";
import { addShepardSuspenseRiser } from "./audio.ts";
import { reconstructSplitterAt, simulateSplitterFortress } from "./splitterFortress.ts";
import { reconstructLaneBallsAt, simulateVaultComeback } from "./towerVaults.ts";

function createMockCanvas2D() {
  const filledRects: { x: number; y: number; w: number; h: number }[] = [];
  const drawnText: { text: string; size: number }[] = [];
  let currentFont = "700 24px Inter";
  const gradientStub = { addColorStop() {} };

  const ctx = {
    fillStyle: "#000",
    strokeStyle: "#fff",
    shadowColor: "#000",
    shadowBlur: 0,
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    textAlign: "left",
    textBaseline: "alphabetic",
    get font() {
      return currentFont;
    },
    set font(v: string) {
      currentFont = v;
    },
    save() {},
    restore() {},
    clearRect() {},
    fillRect(x: number, y: number, w: number, h: number) {
      filledRects.push({ x, y, w, h });
    },
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    roundRect() {},
    fill() {},
    stroke() {},
    translate() {},
    rotate() {},
    scale() {},
    fillText(str: string) {
      const match = /(\d+(?:\.\d+)?)px/.exec(currentFont);
      drawnText.push({ text: str, size: match ? Number(match[1]) : 0 });
    },
    createLinearGradient() {
      return gradientStub;
    },
    createRadialGradient() {
      return gradientStub;
    },
    measureText(str: string) {
      const m = /(\d+(?:\.\d+)?)px/.exec(currentFont);
      const px = m ? Number(m[1]) : 24;
      const width = str.length * px * 0.54;
      return {
        width,
        actualBoundingBoxAscent: px * 0.76,
        actualBoundingBoxDescent: px * 0.22,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: width,
      };
    },
  } as unknown as CanvasRenderingContext2D;

  return { ctx, filledRects, drawnText };
}

test("snapshot reconstruction equals straight-through state across checkpoint boundaries and victory", () => {
  const boundaryFrames = [29, 30, 31, 59, 60];
  const splitter = simulateSplitterFortress();
  for (const frame of [...boundaryFrames, splitter.victoryFrame, splitter.victoryFrame + 1]) {
    assert.deepStrictEqual(
      reconstructSplitterAt(splitter, frame),
      reconstructSplitterAt(splitter, frame, true),
      `Splitter frame ${frame} differs from straight-through replay`,
    );
  }

  for (const slug of ["tower-linear-vs-exponential", "titan-hammer-vs-swarm"] as const) {
    const trace = simulateVaultComeback(slug);
    for (const side of ["left", "right"] as const) {
      for (const frame of [...boundaryFrames, trace.victoryFrame, trace.victoryFrame + 1]) {
        assert.deepStrictEqual(
          reconstructLaneBallsAt(trace, side, frame),
          reconstructLaneBallsAt(trace, side, frame, true),
          `${slug} ${side} frame ${frame} differs from straight-through replay`,
        );
      }
    }
  }
});

test("verifyComebackInvariants rejects non-comeback, early-win, and blowout-finish traces", () => {
  const makeDummy = (overrides: Partial<ComebackTraceBase>): ComebackTraceBase => {
    const raceFrames = 1000;
    const leftProgress = new Float32Array(raceFrames).fill(0.85);
    const rightProgress = new Float32Array(raceFrames).fill(0.2);
    leftProgress[900] = 0.96;
    rightProgress[900] = 1.0;
    return {
      slug: "titan-hammer-vs-swarm",
      seed: 1,
      fps: 60,
      raceFrames,
      closingFrames: 180,
      totalFrames: 1180,
      winner: "right",
      earlyLeader: "left",
      overtakeFrame: 890,
      victoryFrame: 900,
      leftProgress,
      rightProgress,
      runnerUpFinalStageRemainingRatio: 0.08,
      events: [],
      ...overrides,
    };
  };

  assert.doesNotThrow(() => verifyComebackInvariants(makeDummy({})));
  assert.throws(
    () => verifyComebackInvariants(makeDummy({ earlyLeader: "right" })),
    /earlyLeader !== winner/,
  );
  assert.throws(
    () => verifyComebackInvariants(makeDummy({ overtakeFrame: 700 })),
    /outside \[0\.82, 0\.96\]/,
  );
  assert.throws(
    () => verifyComebackInvariants(makeDummy({ runnerUpFinalStageRemainingRatio: 0.25 })),
    /expected < 0\.15/,
  );
});

test("All 4 comeback Shorts satisfy early-blowout, [0.82, 0.96] late-overtake, and >= 90% photo-finish invariants", () => {
  assert.equal(COMEBACK_COMPOSITIONS.length, 4);

  for (const comp of COMEBACK_COMPOSITIONS) {
    const trace = simulateComeback(comp.slug);
    assert.equal(trace.raceFrames, comp.raceFrames);
    assert.equal(trace.totalFrames, comp.totalFrames);

    const report = verifyComebackInvariants(trace);
    console.log(
      `[comeback-invariant] ${comp.id}: earlyMargin=${report.earlyMarginAtVictoryCheck.toFixed(3)} ` +
        `(mid=${report.earlyMarginAtMidRace.toFixed(3)}), overtake=${report.overtakeFrame}/${trace.raceFrames} ` +
        `(${report.overtakeRatio.toFixed(3)}), victory=${report.victoryFrame}/${trace.raceFrames} ` +
        `(${report.victoryRatio.toFixed(3)}), runnerUp=${report.runnerUpProgressAtVictory.toFixed(3)}, ` +
        `finalRem=${report.runnerUpFinalStageRemainingRatio.toFixed(3)}, hold=${report.victoryHoldFrames}f`,
    );

    assert.equal(trace.earlyLeader, "left");
    assert.equal(trace.winner, "right");
    assert.ok(report.earlyMarginAtVictoryCheck >= 0.5);
    assert.ok(report.earlyMarginAtMidRace >= 0.5);
    assert.ok(report.overtakeRatio >= 0.82 && report.overtakeRatio <= 0.96);
    assert.ok(report.victoryRatio >= 0.82 && report.victoryRatio <= 0.96);
    assert.ok(report.victoryHoldFrames >= 72, `${comp.id} expected >= 72 frames (1.2s) victory hold`);
    assert.ok(report.runnerUpProgressAtVictory >= 0.9);

    if (trace.slug === "afterburner-lap-comeback") {
      assert.ok(
        trace.leftLapsPerFrame[trace.victoryFrame] >= 94,
        `Expected >= 94/100 laps on runner-up, got ${trace.leftLapsPerFrame[trace.victoryFrame]}`,
      );
    } else {
      assert.ok(report.runnerUpFinalStageRemainingRatio < 0.15);
    }
  }
});

test("All 4 comeback Shorts render full-bleed 1080x1920 arenas and keep every HUD box inside REEL_SAFE_BOUNDS", () => {
  for (const comp of COMEBACK_COMPOSITIONS) {
    const trace = simulateComeback(comp.slug);
    const features = buildComebackFeatures(comp.slug);
    assert.equal(features.length, comp.totalFrames);

    const sampleFrames = [
      0,
      Math.floor(0.35 * trace.raceFrames),
      Math.floor(0.65 * trace.victoryFrame),
      Math.max(0, trace.overtakeFrame - 12),
      trace.overtakeFrame,
      trace.victoryFrame,
      trace.raceFrames - 1,
    ];

    for (const f of sampleFrames) {
      const { ctx, filledRects, drawnText } = createMockCanvas2D();
      const boxes = paintComebackFrame(ctx, trace, features, f, VIDEO.width, VIDEO.height);
      assert.ok(
        filledRects.some(
          (r) => r.x === 0 && r.y === 0 && r.w === VIDEO.width && r.h === VIDEO.height,
        ),
        `${comp.id} frame ${f} missing full-bleed 0..1080 x 0..1920 chamber fill`,
      );
      assert.ok(boxes.length >= 8, `${comp.id} frame ${f} expected HUD boxes`);
      for (const box of boxes) {
        assertReelSafeBox(box);
        assert.ok(box.left >= REEL_SAFE_BOUNDS.left - 0.5 && box.right <= REEL_SAFE_BOUNDS.right + 0.5);
        assert.ok(box.top >= REEL_SAFE_BOUNDS.top - 0.5 && box.bottom <= REEL_SAFE_BOUNDS.bottom + 0.5);
      }
      for (const item of drawnText) {
        assert.ok(
          item.size >= 42,
          `${comp.id} frame ${f}: "${item.text}" uses ${item.size}px source type (${(item.size * 390 / VIDEO.width).toFixed(1)}px at 390px playback)`,
        );
      }
    }
  }
});

test("Shepard riser crosses both octave wraps without a sample pop", () => {
  const buffer = createStereoBuffer(240, 60);
  addShepardSuspenseRiser(buffer, 0, 4, 0.16);
  for (const wrap of [1, 2]) {
    const sample = Math.round((4 * buffer.sampleRate * wrap) / 2.2);
    for (const channel of [buffer.left, buffer.right]) {
      let maxJump = 0;
      for (let i = sample - 3; i <= sample + 3; i++) {
        maxJump = Math.max(maxJump, Math.abs(channel[i] - channel[i - 1]));
      }
      assert.ok(maxJump < 0.01, `wrap ${wrap} has ${maxJump.toFixed(4)} sample jump`);
    }
  }
});

test("48 kHz stereo comeback audio hits -14 LUFS, <= -1.5 dBTP, stereo width, and 0 Node Buffer calls", () => {
  const savedBuffer = (globalThis as Record<string, unknown>).Buffer;
  try {
    clearComebackCaches();
    (globalThis as Record<string, unknown>).Buffer = undefined;

    for (const comp of COMEBACK_COMPOSITIONS) {
      const trace = simulateComeback(comp.slug);
      const bundle = buildComebackAudio(comp.slug);
      const wav = synthesizeComebackWav(comp.slug);

      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      assert.equal(view.getUint16(22, true), 2); // Stereo
      assert.equal(view.getUint32(24, true), 48000); // 48 kHz
      assert.equal(wav.byteLength, 44 + (comp.totalFrames / VIDEO.fps) * 48000 * 4);

      const metrics = measureStereoLufsAndPeak(bundle.buffer.left, bundle.buffer.right);
      assert.ok(
        metrics.integratedLufs >= -15.0 && metrics.integratedLufs <= -13.0,
        `${comp.id} LUFS out of target range: ${metrics.integratedLufs}`,
      );
      assert.ok(
        metrics.truePeakDb <= -1.5,
        `${comp.id} true peak exceeded -1.5 dBTP: ${metrics.truePeakDb}`,
      );

      // Check stereo decorrelation across race frames
      const meanStereoWidth =
        bundle.features
          .slice(0, trace.raceFrames)
          .reduce((acc, item) => acc + item.stereoWidth, 0) / trace.raceFrames;
      assert.ok(meanStereoWidth > 0.05, `${comp.id} expected true stereo separation`);

      // Check overtake drop energy
      const overtakeFeat = bundle.features[trace.overtakeFrame];
      assert.ok(
        overtakeFeat.subBass > 0.25 || overtakeFeat.kickImpulse > 0.25,
        `${comp.id} expected strong sub-bass / kick drop at overtakeFrame=${trace.overtakeFrame}`,
      );
    }
  } finally {
    (globalThis as Record<string, unknown>).Buffer = savedBuffer;
  }
});

test("browser-imported comeback modules never reference Node Buffer", () => {
  const files = [
    "afterburnerLaps.ts",
    "audio.ts",
    "index.ts",
    "invariants.ts",
    "splitterFortress.ts",
    "towerVaults.ts",
    "../components/ComebackShell.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!/\bBuffer\b/.test(source), `${file} must use Uint8Array and DataView, not Node Buffer`);
  }
});
