import assert from "node:assert/strict";
import test from "node:test";
import { REEL_SAFE_BOUNDS } from "../shared/reelUtils.ts";
import { paintDropArenaFrame } from "./paint.ts";
import {
  AI_MODEL_TIERS,
  buildCombinedDropTimeline,
  DROP_STYLES,
  simulateDropArena,
} from "./sim.ts";

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

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

test("AI_MODEL_TIERS defines pure 8-tier AI progression with zero JS/TS and >= 8:1 dark jewel contrast (including Kimi & ChatGPT)", () => {
  assert.equal(AI_MODEL_TIERS.length, 8);
  const names = AI_MODEL_TIERS.map((t) => t.name);
  assert.deepEqual(names, [
    "MiniMax",
    "GLM",
    "Mistral",
    "Qwen",
    "Kimi",
    "DeepSeek",
    "Claude",
    "ChatGPT",
  ]);

  for (let i = 0; i < AI_MODEL_TIERS.length; i++) {
    const spec = AI_MODEL_TIERS[i];
    assert.ok(!/^(JS|TS|JavaScript|TypeScript)$/i.test(spec.name));
    if (i > 0) {
      assert.ok(spec.radius > AI_MODEL_TIERS[i - 1].radius, "tier radii must increase strictly");
    }
    const innerLum = relativeLuminance(spec.orbFillInner);
    const outerLum = relativeLuminance(spec.orbFillOuter);
    const iconLum = relativeLuminance(spec.iconColor);
    const worstOrbLum = Math.max(innerLum, outerLum);
    const contrast = (iconLum + 0.05) / (worstOrbLum + 0.05);
    assert.ok(
      contrast >= 8.0,
      `${spec.name} orb contrast ${contrast.toFixed(2)}:1 must be >= 8:1 (no white-on-white)`,
    );
  }
});

test("DropLogoFunnelMerge features bouncy squash-and-stretch, mass conservation, and 3.5s (210f) live post-Tier-8 physics", () => {
  const mergeTrace = simulateDropArena("drop-logo-funnel-merge", "standalone");
  const totalSec = mergeTrace.totalFrames / 60;
  assert.ok(totalSec >= 28 && totalSec <= 34, `Standalone merge duration ${totalSec}s outside 28..34s`);
  assert.equal(mergeTrace.celebrationFrames, 210, "Must keep 3.5s (210f) of live post-Tier-8 physics");
  assert.equal(mergeTrace.frames.length - 1 - mergeTrace.climaxFrame, 210);

  let maxSquash = 0;
  for (const st of mergeTrace.frames) {
    const liveMass = st.balls.reduce((acc, b) => acc + b.mass, 0);
    assert.equal(liveMass + st.removedMass, st.spawned, `Mass conservation violated at frame ${st.frame}`);
    for (const b of st.balls) {
      maxSquash = Math.max(maxSquash, Math.abs(b.squash));
    }
  }
  assert.ok(maxSquash >= 0.2, `Expected visibly squishy elastic deformation, got ${maxSquash}`);

  // Verify Tier 8 ChatGPT orb is alive AND actively bouncing during the 210 post-climax frames (not frozen!)
  const postClimaxY: number[] = [];
  let postClimaxSquashRange = 0;
  for (let f = mergeTrace.climaxFrame; f < mergeTrace.frames.length; f++) {
    const chatgpt = mergeTrace.frames[f].balls.find((b) => b.tier === 8);
    assert.ok(chatgpt, `Tier 8 ChatGPT orb must remain on stage at frame ${f}`);
    postClimaxY.push(chatgpt.y);
    postClimaxSquashRange = Math.max(postClimaxSquashRange, Math.abs(chatgpt.squash));
  }
  const ySpan = Math.max(...postClimaxY) - Math.min(...postClimaxY);
  assert.ok(ySpan >= 30, `ChatGPT orb must bounce visibly after climax (ySpan=${ySpan.toFixed(1)}px)`);
  assert.ok(postClimaxSquashRange >= 0.12, "ChatGPT orb must continue squishing during celebration");
});

test("BallDropCombined chains all 4 styles cleanly inside 40..46s and keeps all HUD boxes in x:60..900, y:220..1560", () => {
  const combined = buildCombinedDropTimeline();
  assert.equal(combined.stages.length, 4);
  const totalSec = combined.totalFrames / 60;
  assert.ok(totalSec >= 40 && totalSec <= 46, `BallDropCombined ${totalSec}s outside 40..46s`);

  const ctx = makeMockCanvasContext();
  for (const seg of combined.stages) {
    // Also verify mass conservation across every compact stage
    for (const st of seg.trace.frames) {
      const liveMass = st.balls.reduce((acc, b) => acc + b.mass, 0);
      assert.equal(liveMass + st.removedMass, st.spawned);
    }

    const samples = [0, Math.floor(seg.trace.climaxFrame / 2), seg.trace.climaxFrame, seg.trace.frames.length - 1];
    for (const lf of samples) {
      const boxes = paintDropArenaFrame(ctx, seg.trace, lf, { isCombined: true });
      assert.ok(boxes.length >= 5);
      for (const b of boxes) {
        assert.ok(
          b.left >= REEL_SAFE_BOUNDS.left - 0.5 &&
            b.right <= REEL_SAFE_BOUNDS.right + 0.5 &&
            b.top >= REEL_SAFE_BOUNDS.top - 0.5 &&
            b.bottom <= REEL_SAFE_BOUNDS.bottom + 0.5,
          `Drop HUD box escaped safe zone: ${JSON.stringify(b)}`,
        );
      }
    }
  }

  // Verify standalone styles also complete cleanly
  for (const def of DROP_STYLES) {
    const tr = simulateDropArena(def.slug, "standalone");
    assert.ok(tr.climaxFrame > 0);
  }
});
