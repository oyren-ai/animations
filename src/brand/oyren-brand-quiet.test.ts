import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OYREN_BRAND, WORDMARK_PATHS } from "./OyrenBrand.tsx";
import {
  computeQuietBrandState,
  OYREN_QUIET_DEFAULTS,
  OyrenBrandQuietView,
} from "./OyrenBrandQuiet.tsx";

const FPS = 60;
const DURATION_SEC = 50;
const TOTAL_FRAMES = FPS * DURATION_SEC; // last frame = 2999 -> endSec = 49.9833s
const htmlAt = (frame: number) =>
  renderToStaticMarkup(createElement(OyrenBrandQuietView, { frame, fps: FPS, durationInFrames: TOTAL_FRAMES }));

test("quiet layer reuses the exact official wordmark paths at 30 px height centred on x = 540 with zero CTA pill", () => {
  assert.equal(WORDMARK_PATHS.length, 5);
  assert.equal(OYREN_QUIET_DEFAULTS.markHeight, 30);
  const st = computeQuietBrandState(300, FPS, TOTAL_FRAMES);
  assert.ok(Math.abs(st.markWidth - (30 * 595.49) / 66.93) < 1e-6);
  assert.equal(st.markTop, 95);
  assert.equal(st.markBottom, 125);
  // >= half a logo height (15 px) clear space above, below, and above the y = 178 title band
  assert.ok(st.urlTop - st.markBottom >= 15);
  assert.ok(178 - (st.urlTop + 18) >= 15);

  const midHtml = htmlAt(600);
  assert.ok(midHtml.includes('viewBox="0 0 595.49 66.93"'));
  assert.ok(midHtml.includes("justify-content:center"));
  assert.ok(!midHtml.includes(OYREN_BRAND.ctaLead), "never renders a CTA pill");
  assert.ok(midHtml.includes("drop-shadow(0 0 12px rgba(0,0,0,0.28))"), "zero-offset light dark glow only");
});

test("cosine fade-in (0.8..2.0s to 0.70), closing lift (last 2.5s to 0.85 + url 0.60), and clean 0.6s loop fade-out", () => {
  // Hidden before 0.8 s (including frame 0)
  assert.equal(computeQuietBrandState(0, FPS, TOTAL_FRAMES).markOpacity, 0);
  assert.equal(computeQuietBrandState(Math.floor(0.75 * FPS), FPS, TOTAL_FRAMES).markOpacity, 0);
  assert.equal(htmlAt(0), `<div style="position:absolute;inset:0;pointer-events:none;font-family:${"Inter Variable"}"></div>`);

  // Halfway through cosine fade-in at 1.4 s -> opacity ~0.35
  const midFadeIn = computeQuietBrandState(Math.round(1.4 * FPS), FPS, TOTAL_FRAMES);
  assert.ok(Math.abs(midFadeIn.markOpacity - 0.35) < 0.02);
  assert.equal(midFadeIn.urlOpacity, 0);

  // Steady hold from 2.0 s to T - 2.5 s: wordmark = 0.70, url = 0
  for (const sec of [2.1, 15, 30, 47.0]) {
    const st = computeQuietBrandState(Math.round(sec * FPS), FPS, TOTAL_FRAMES);
    assert.ok(Math.abs(st.markOpacity - 0.7) < 1e-4, `at ${sec}s markOpacity=${st.markOpacity}`);
    assert.equal(st.urlOpacity, 0);
  }

  // Inside the closing 2.5 s window before the final 0.6 s fade-out (e.g. T - 1.2 s): mark = 0.85, url = 0.60
  const closingPeak = computeQuietBrandState(TOTAL_FRAMES - 1 - Math.round(1.2 * FPS), FPS, TOTAL_FRAMES);
  assert.ok(Math.abs(closingPeak.markOpacity - 0.85) < 1e-3);
  assert.ok(Math.abs(closingPeak.urlOpacity - 0.6) < 1e-3);
  assert.ok(htmlAt(TOTAL_FRAMES - 1 - Math.round(1.2 * FPS)).includes(OYREN_BRAND.url));

  // Final frame reaches exact 0.0 opacity so loop back to frame 0 has zero jump
  const last = computeQuietBrandState(TOTAL_FRAMES - 1, FPS, TOTAL_FRAMES);
  assert.equal(last.markOpacity, 0);
  assert.equal(last.urlOpacity, 0);
});
