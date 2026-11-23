import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { measureStereoLufsAndPeak } from "../audio-reactive/synth.ts";
import { VIDEO } from "../settings.ts";
import { assertReelSafeBox, REEL_SAFE_BOUNDS } from "../shared/reelUtils.ts";
import {
  buildCyberTunnelAudio,
  CYBER_TUNNEL_FRAGMENT_SHADER,
  CYBER_TUNNEL_VERTEX_SHADER,
  paintCyberTunnelFallback2D,
  paintCyberTunnelHud,
} from "./cyberTunnel.ts";
import {
  buildHarmonicSortingAudio,
  buildHarmonicSortingFeatures,
  paintHarmonicSortingFrame,
  simulateHarmonicSorting,
  SORT_ITEM_COUNT,
} from "./harmonicSorting.ts";
import { GPU_AUDIO_COMPOSITIONS, synthesizeGpuAudioSceneWav } from "./index.ts";
import {
  buildWallCascadeAudio,
  buildWallCascadeFeatures,
  HARMONIC_STRINGS,
  paintWallCascadeFrame,
  simulateWallCascade,
  WALL_CASCADE_BOUNDS,
} from "./wallCascade.ts";

function createMockCanvas2D() {
  const filledRects: { x: number; y: number; w: number; h: number }[] = [];
  let currentFont = "600 24px Inter";

  const gradientStub = {
    addColorStop() {},
  };

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
    fillText() {},
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

  return { ctx, filledRects };
}

test("CyberSynthShaderTunnel GLSL shaders, 48 kHz stereo audio, and full-bleed HUD bounds pass", () => {
  assert.ok(CYBER_TUNNEL_VERTEX_SHADER.startsWith("#version 300 es"));
  assert.ok(CYBER_TUNNEL_FRAGMENT_SHADER.startsWith("#version 300 es"));
  for (const uniformName of [
    "u_resolution",
    "u_time",
    "u_kick",
    "u_bass",
    "u_mid",
    "u_high",
    "u_rms",
    "u_spectrum[32]",
  ]) {
    assert.ok(
      CYBER_TUNNEL_FRAGMENT_SHADER.includes(uniformName),
      `Missing shader uniform ${uniformName}`,
    );
  }

  const audio = buildCyberTunnelAudio();
  assert.equal(audio.features.length, 900);
  const metrics = measureStereoLufsAndPeak(audio.buffer.left, audio.buffer.right);
  assert.ok(metrics.integratedLufs >= -15.0 && metrics.integratedLufs <= -13.0);
  assert.ok(metrics.truePeakDb <= -1.5);

  for (const f of [0, 60, 240, 480, 719]) {
    const { ctx, filledRects } = createMockCanvas2D();
    paintCyberTunnelFallback2D(ctx, f, audio.features[f]);
    assert.ok(
      filledRects.some((r) => r.x === 0 && r.y === 0 && r.w === VIDEO.width && r.h === VIDEO.height),
      "Expected full-bleed 0..1080 x 0..1920 background fill",
    );
    const hudBoxes = paintCyberTunnelHud(ctx, f, audio.features[f]);
    assert.ok(hudBoxes.length >= 4);
    for (const box of hudBoxes) assertReelSafeBox(box);
  }
});

test("PolyphonicWallCascade reaches all 4 true 1080x1920 edges, plucks all 8 strings, and keeps HUD in safe bounds", () => {
  const traceA = simulateWallCascade(20261116);
  const traceB = simulateWallCascade(20261116);
  assert.deepEqual(traceA.events, traceB.events);

  assert.ok(traceA.minXReached <= WALL_CASCADE_BOUNDS.left + 1);
  assert.ok(traceA.maxXReached >= WALL_CASCADE_BOUNDS.right - 1);
  assert.ok(traceA.minYReached <= WALL_CASCADE_BOUNDS.top + 1);
  assert.ok(traceA.maxYReached >= WALL_CASCADE_BOUNDS.bottom - 1);

  const wallsHit = new Set(traceA.events.filter((e) => e.kind === "wall").map((e) => e.wall));
  assert.deepEqual([...wallsHit].sort(), ["bottom", "left", "right", "top"]);

  const stringsHit = new Set(
    traceA.events.filter((e) => e.kind === "string").map((e) => e.stringIndex),
  );
  assert.equal(stringsHit.size, HARMONIC_STRINGS.length);

  const audio = buildWallCascadeAudio(traceA);
  const metrics = measureStereoLufsAndPeak(audio.buffer.left, audio.buffer.right);
  assert.ok(metrics.integratedLufs >= -15.0 && metrics.integratedLufs <= -13.0);
  assert.ok(metrics.truePeakDb <= -1.5);

  for (const f of [0, 90, 300, 540, 719]) {
    const { ctx, filledRects } = createMockCanvas2D();
    const boxes = paintWallCascadeFrame(ctx, traceA, audio.features, f);
    assert.ok(
      filledRects.some((r) => r.x === 0 && r.y === 0 && r.w === VIDEO.width && r.h === VIDEO.height),
    );
    for (const box of boxes) assertReelSafeBox(box);
  }
});

test("HarmonicSortingMatrix sorts all 96 channels across Radix, Quick, and Heap full-bleed bands with safe HUDs", () => {
  const trace = simulateHarmonicSorting(20261117);
  const [radix, quick, heap] = trace.algorithms;
  assert.ok(radix.finishFrame < quick.finishFrame);
  assert.ok(quick.finishFrame < heap.finishFrame);
  assert.ok(heap.finishFrame < 720);

  const expectedSorted = Uint8Array.from({ length: SORT_ITEM_COUNT }, (_, i) => i + 1);
  for (const algo of trace.algorithms) {
    const finalValues = algo.frames[719].values;
    assert.deepEqual(finalValues, expectedSorted, `${algo.id} did not end sorted 1..96`);
    assert.equal(algo.frames[719].sorted, true);
  }

  const audio = buildHarmonicSortingAudio(trace);
  const metrics = measureStereoLufsAndPeak(audio.buffer.left, audio.buffer.right);
  assert.ok(metrics.integratedLufs >= -15.0 && metrics.integratedLufs <= -13.0);
  assert.ok(metrics.truePeakDb <= -1.5);

  for (const f of [0, 200, 420, 560, 700]) {
    const { ctx, filledRects } = createMockCanvas2D();
    const boxes = paintHarmonicSortingFrame(ctx, trace, audio.features, f);
    // Verify columns cover left edge x=0, right edge x~1080, top y=0, and bottom y=1920
    const minRectX = Math.min(...filledRects.map((r) => r.x));
    const maxRectRight = Math.max(...filledRects.map((r) => r.x + r.w));
    const minRectY = Math.min(...filledRects.map((r) => r.y));
    const maxRectBottom = Math.max(...filledRects.map((r) => r.y + r.h));
    assert.ok(minRectX <= 0.5 && maxRectRight >= VIDEO.width - 0.5);
    assert.ok(minRectY <= 0.5 && maxRectBottom >= VIDEO.height - 0.5);

    for (const box of boxes) {
      assertReelSafeBox(box);
      assert.ok(box.top >= REEL_SAFE_BOUNDS.top && box.bottom <= REEL_SAFE_BOUNDS.bottom);
    }
  }
});

test("GPU_AUDIO_COMPOSITIONS and browser feature builders run cleanly without Node Buffer", () => {
  assert.equal(GPU_AUDIO_COMPOSITIONS.length, 3);
  const savedBuffer = (globalThis as Record<string, unknown>).Buffer;
  try {
    (globalThis as Record<string, unknown>).Buffer = undefined;
    for (const comp of GPU_AUDIO_COMPOSITIONS) {
      const wav = synthesizeGpuAudioSceneWav(comp.slug);
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      assert.equal(view.getUint16(22, true), 2); // Stereo
      assert.equal(view.getUint32(24, true), 48000); // 48 kHz
      assert.equal(wav.byteLength, 44 + (comp.totalFrames / VIDEO.fps) * 48000 * 4);
    }
  } finally {
    (globalThis as Record<string, unknown>).Buffer = savedBuffer;
  }
});

test("changing the sorting seed invalidates both feature and encoded-audio caches", () => {
  const traceA = simulateHarmonicSorting(20261117);
  const featuresA = buildHarmonicSortingFeatures(traceA);
  const audioA = buildHarmonicSortingAudio(traceA);
  const traceB = simulateHarmonicSorting(20261119);
  assert.notDeepEqual(traceB.initial, traceA.initial);
  const featuresB = buildHarmonicSortingFeatures(traceB);
  const audioB = buildHarmonicSortingAudio(traceB);
  assert.ok(featuresB !== featuresA, "new seed reused earlier sorting features");
  assert.ok(audioB !== audioA, "new seed reused earlier sorting WAV");
  assert.strictEqual(audioB.buffer, featuresB.buffer);
});

test("changing the cascade seed invalidates both feature and encoded-audio caches", () => {
  const traceA = simulateWallCascade(20261116);
  const featuresA = buildWallCascadeFeatures(traceA);
  const audioA = buildWallCascadeAudio(traceA);
  const traceB = simulateWallCascade(20261119);
  assert.notStrictEqual(traceB, traceA);
  const featuresB = buildWallCascadeFeatures(traceB);
  const audioB = buildWallCascadeAudio(traceB);
  assert.ok(featuresB !== featuresA, "new seed reused earlier cascade features");
  assert.ok(audioB !== audioA, "new seed reused earlier cascade WAV");
  assert.strictEqual(audioB.buffer, featuresB.buffer);
});

test("tunnel radius guards near-axis angle and division", () => {
  const radius = CYBER_TUNNEL_FRAGMENT_SHADER.split("float tunnelRadius(vec3 p) {")[1]?.split("vec3 evalScene")[0];
  assert.ok(radius, "tunnelRadius shader function missing");
  assert.match(radius, /float r = length\(q\);/);
  assert.match(radius, /r > 1e-5 \? atan\(q\.y, q\.x\) : 0\.0/);
  assert.match(radius, /r > 1e-5 \? max\(0\.9238795, octMetric \/ r\) : 1\.0/);
  assert.doesNotMatch(radius, /length\(q\) \+ 1e-4/);
});

test("GPU shell resumes Remotion after the ready stage commits and cancels unmounted font loads", () => {
  const shell = readFileSync(new URL("../components/GpuAudioSceneShell.tsx", import.meta.url), "utf8");
  const loadingEffect = shell.slice(shell.lastIndexOf("ensureGpuSceneFontsLoaded()")).split("}, [handle]);")[0];
  assert.ok(loadingEffect, "font loading effect missing");
  assert.doesNotMatch(loadingEffect, /continueRender\(handle\)/);
  assert.match(loadingEffect, /cancelled/);
  assert.match(shell, /if \(ready\) continueRender\(handle\)/);
});
