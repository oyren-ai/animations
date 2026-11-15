import assert from "node:assert/strict";
import test from "node:test";
import { COUNTRY_CONTOURS } from "../data/countryContours.ts";
import { SCENE_FRAMES } from "../settings.ts";
import {
  COUNTRY_MAPS,
  evaluateEpicycleChain,
  HARMONIC_ORDERS,
  HARMONIC_TIERS,
  MAP_SAFE_BOUNDS,
  mercatorProject,
  prepareCountryMap,
  tierStateAtFrame,
} from "./fourier.ts";

test("all 5 country maps strictly reduce contour RMSE across the 8 harmonic tiers and converge below 0.006", () => {
  assert.equal(COUNTRY_MAPS.length, 5);
  assert.equal(HARMONIC_ORDERS.length, 8);
  assert.equal(HARMONIC_TIERS[0].startFrame, 0);
  assert.equal(HARMONIC_TIERS[HARMONIC_TIERS.length - 1].endFrame, SCENE_FRAMES);

  for (const item of COUNTRY_MAPS) {
    const map = prepareCountryMap(item.slug);
    assert.equal(map.tierMetrics.length, 8);
    for (let i = 0; i < map.tierMetrics.length - 1; i++) {
      const curr = map.tierMetrics[i];
      const next = map.tierMetrics[i + 1];
      assert.ok(
        curr.relativeRmse > next.relativeRmse,
        `${map.name}: expected relativeRmse(${curr.order})=${curr.relativeRmse} > relativeRmse(${next.order})=${next.relativeRmse}`,
      );
      assert.ok(
        curr.diagonalRmse > next.diagonalRmse,
        `${map.name}: expected diagonalRmse(${curr.order})=${curr.diagonalRmse} > diagonalRmse(${next.order})=${next.diagonalRmse}`,
      );
    }
    const finalTier = map.tierMetrics[map.tierMetrics.length - 1];
    assert.equal(finalTier.order, 240);
    assert.ok(
      finalTier.relativeRmse < 0.006,
      `${map.name}: final relativeRmse ${finalTier.relativeRmse} exceeded 0.006`,
    );
    assert.ok(
      finalTier.diagonalRmse < 0.006,
      `${map.name}: final diagonalRmse ${finalTier.diagonalRmse} exceeded 0.006`,
    );
  }
});

test("Mercator projection preserves cosine-latitude aspect ratio and keeps all 8 harmonic tiers inside safe bounds", () => {
  for (const item of COUNTRY_MAPS) {
    const map = prepareCountryMap(item.slug);
    const { projection } = map;
    const eps = 1e-4;
    const dxPerDegLon =
      Math.abs(projection.lonToScreenX(projection.lonMin + eps) - projection.lonToScreenX(projection.lonMin - eps)) /
      (2 * eps);
    const dyPerDegLat =
      Math.abs(projection.latToScreenY(projection.centerLat + eps) - projection.latToScreenY(projection.centerLat - eps)) /
      (2 * eps);
    const expectedSecant = 1 / Math.cos((projection.centerLat * Math.PI) / 180);
    assert.ok(
      Math.abs(dyPerDegLat / dxPerDegLon - expectedSecant) < 1e-4,
      `${map.name}: Mercator aspect ratio mismatch at ${projection.centerLat}°`,
    );

    for (const metric of map.tierMetrics) {
      assert.ok(
        metric.bounds.left >= MAP_SAFE_BOUNDS.left &&
          metric.bounds.right <= MAP_SAFE_BOUNDS.right &&
          metric.bounds.top >= MAP_SAFE_BOUNDS.top &&
          metric.bounds.bottom <= MAP_SAFE_BOUNDS.bottom,
        `${map.name} N=${metric.order} bounds ${JSON.stringify(metric.bounds)} escaped safe box`,
      );
    }
  }
  assert.throws(() => mercatorProject(Number.NaN, 40), /finite/);
});

test("multi-loop sovereign component counts and geopolitical boundary extents are exact with zero bridge jumps", () => {
  const aze = prepareCountryMap("MapOfAzerbaijan");
  const tur = prepareCountryMap("MapOfTurkey");
  const ind = prepareCountryMap("MapOfIndia");
  const ita = prepareCountryMap("MapOfItaly");
  const jpn = prepareCountryMap("MapOfJapan");

  assert.ok(aze.loops.length >= 2, "Azerbaijan must include Mainland + Nakhchivan as separate loops");
  assert.ok(tur.loops.length >= 2, "Turkey must include Anatolia + Eastern Thrace as separate loops");
  assert.ok(ind.loops.length >= 1, "India must include full official mainland border");
  assert.ok(ita.loops.length >= 3, "Italy must include Peninsula + Sardinia + Sicily");
  assert.ok(jpn.loops.length >= 4, "Japan must include Honshu + Kyushu + Hokkaido + Shikoku");

  // Geopolitical extent checks on raw WGS84 contours
  const azeRaw = COUNTRY_CONTOURS.find((c) => c.id === "MapOfAzerbaijan")!;
  const nakhchivanLons = azeRaw.loops[1].lonLatPairs.filter((_, idx) => idx % 2 === 0);
  assert.ok(Math.min(...nakhchivanLons) < 44.9 && Math.max(...nakhchivanLons) < 46.3, "Nakhchivan loop extent verified");

  const indRaw = COUNTRY_CONTOURS.find((c) => c.id === "MapOfIndia")!;
  const indLons = indRaw.loops[0].lonLatPairs.filter((_, idx) => idx % 2 === 0);
  const indLats = indRaw.loops[0].lonLatPairs.filter((_, idx) => idx % 2 === 1);
  assert.ok(Math.max(...indLats) > 36.9, "India northern crown includes full Jammu & Kashmir / Gilgit-Baltistan");
  assert.ok(Math.max(...indLons) > 97.1, "India eastern extent includes full Arunachal Pradesh");

  // Verify every loop is smooth and closed without any bridge jump across disjoint territories
  for (const item of COUNTRY_MAPS) {
    const map = prepareCountryMap(item.slug);
    for (const loop of map.loops) {
      let maxStep = 0;
      for (let i = 0; i < loop.sampleCount; i++) {
        const next = (i + 1) % loop.sampleCount;
        const step = Math.hypot(loop.exactX[next] - loop.exactX[i], loop.exactY[next] - loop.exactY[i]);
        maxStep = Math.max(maxStep, step);
      }
      assert.ok(maxStep < 18, `${map.name} (${loop.name}) has unexpected bridge jump of ${maxStep}px`);
    }
  }
});

test("epicycle vector chain tip matches the morphed Fourier contour to floating-point precision", () => {
  const map = prepareCountryMap("MapOfAzerbaijan");
  const loop = map.loops[0];
  const state = tierStateAtFrame(map, 320); // mid-morph into N=18
  const prevOrder = state.prevTier ? state.prevTier.order : state.tier.order;
  const sampleIndex = 137;
  const t = (2 * Math.PI * sampleIndex) / loop.sampleCount;
  const chain = evaluateEpicycleChain(loop, prevOrder, state.tier.order, state.morphAlpha, t, 8);

  const prevIdx = state.prevTier ? state.prevTier.index : state.tier.index;
  const currIdx = state.tier.index;
  const expectedX =
    loop.tierX[prevIdx][sampleIndex] * (1 - state.morphAlpha) +
    loop.tierX[currIdx][sampleIndex] * state.morphAlpha;
  const expectedY =
    loop.tierY[prevIdx][sampleIndex] * (1 - state.morphAlpha) +
    loop.tierY[currIdx][sampleIndex] * state.morphAlpha;

  assert.ok(Math.hypot(chain.tip.x - expectedX, chain.tip.y - expectedY) < 1e-8);
  assert.equal(chain.joints.length, 8);
});
