import { COUNTRY_CONTOURS, type CountryContourEntry } from "../data/countryContours.ts";
import { SCENE_FRAMES, VIDEO } from "../settings.ts";
import { easeOut } from "../theme.ts";

export type CountryMapId = CountryContourEntry["id"];
export type CountryMapSlug = CountryContourEntry["slug"];

export type HarmonicTier = {
  readonly index: number;
  readonly order: number;
  readonly startFrame: number;
  readonly endFrame: number;
};

export const HARMONIC_ORDERS = [1, 2, 4, 8, 18, 42, 96, 240] as const;
export const MAX_HARMONIC_ORDER = HARMONIC_ORDERS[HARMONIC_ORDERS.length - 1];

const TIER_BOUNDARIES_SECONDS = [0, 1.3, 2.6, 3.9, 5.2, 6.5, 7.8, 9.3, VIDEO.sceneSeconds] as const;

export const HARMONIC_TIERS: readonly HarmonicTier[] = HARMONIC_ORDERS.map((order, index) => ({
  index,
  order,
  startFrame: Math.round(TIER_BOUNDARIES_SECONDS[index] * VIDEO.fps),
  endFrame: Math.round(TIER_BOUNDARIES_SECONDS[index + 1] * VIDEO.fps),
}));

export const MAP_SAFE_BOUNDS = { left: 80, right: 1000, top: 420, bottom: 1420 } as const;
export const MAP_PANEL = { left: 86, right: 994, top: 552, bottom: 1384 } as const;
const MAP_INNER_PAD = { x: 74, y: 66 } as const;
export const MORPH_DURATION_SECONDS = 0.35;
export const MORPH_FRAMES = Math.round(MORPH_DURATION_SECONDS * VIDEO.fps);

export type ComplexMode = {
  readonly k: number;
  readonly re: number;
  readonly im: number;
  readonly amplitude: number;
};

export type PreparedContourLoop = {
  readonly name: string;
  readonly sampleCount: number;
  readonly exactX: Float64Array;
  readonly exactY: Float64Array;
  readonly center: { readonly x: number; readonly y: number };
  readonly modes: readonly ComplexMode[];
  readonly sortedNonZeroModes: readonly ComplexMode[];
  readonly tierX: readonly Float64Array[];
  readonly tierY: readonly Float64Array[];
};

export type MapProjection = {
  readonly lonMin: number;
  readonly lonMax: number;
  readonly latMin: number;
  readonly latMax: number;
  readonly centerLat: number;
  readonly mercMidX: number;
  readonly mercMidY: number;
  readonly scale: number;
  readonly screenCenterX: number;
  readonly screenCenterY: number;
  readonly lonToScreenX: (lonDeg: number) => number;
  readonly latToScreenY: (latDeg: number) => number;
};

export type TierMetrics = {
  readonly order: number;
  readonly relativeRmse: number;
  readonly diagonalRmse: number;
  readonly precisionPercent: number;
  readonly bounds: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
};

export type PreparedCountryMap = {
  readonly id: CountryMapId;
  readonly slug: CountryMapSlug;
  readonly name: string;
  readonly iso3: string;
  readonly projection: MapProjection;
  readonly loops: readonly PreparedContourLoop[];
  readonly tierMetrics: readonly TierMetrics[];
  readonly spectrumAmplitudes: Float64Array;
};

export type EpicycleJoint = {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly radius: number;
  readonly k: number;
};

/** Conformal spherical Mercator projection (exact cosine-latitude local aspect scaling). */
export function mercatorProject(lonDeg: number, latDeg: number): { x: number; y: number } {
  if (!Number.isFinite(lonDeg) || !Number.isFinite(latDeg)) {
    throw new RangeError("Geographic coordinates must be finite numbers");
  }
  const clampedLat = Math.max(-85, Math.min(85, latDeg));
  const lonRad = (lonDeg * Math.PI) / 180;
  const latRad = (clampedLat * Math.PI) / 180;
  return {
    x: lonRad,
    y: -Math.log(Math.tan(Math.PI / 4 + latRad / 2)),
  };
}

export function computeLoopModes(xs: Float64Array, ys: Float64Array, maxOrder: number): ComplexMode[] {
  const M = xs.length;
  const limit = Math.min(maxOrder, Math.floor((M - 1) / 2));
  const stepAngle = (-2 * Math.PI) / M;
  const cosStep = new Float64Array(M);
  const sinStep = new Float64Array(M);
  for (let m = 0; m < M; m++) {
    const theta = stepAngle * m;
    cosStep[m] = Math.cos(theta);
    sinStep[m] = Math.sin(theta);
  }
  const curCos = new Float64Array(M).fill(1);
  const curSin = new Float64Array(M).fill(0);

  let sumX = 0;
  let sumY = 0;
  for (let m = 0; m < M; m++) {
    sumX += xs[m];
    sumY += ys[m];
  }
  const modes: ComplexMode[] = [
    { k: 0, re: sumX / M, im: sumY / M, amplitude: Math.hypot(sumX / M, sumY / M) },
  ];

  for (let k = 1; k <= limit; k++) {
    let posRe = 0;
    let posIm = 0;
    let negRe = 0;
    let negIm = 0;
    for (let m = 0; m < M; m++) {
      const nextCos = curCos[m] * cosStep[m] - curSin[m] * sinStep[m];
      const nextSin = curCos[m] * sinStep[m] + curSin[m] * cosStep[m];
      curCos[m] = nextCos;
      curSin[m] = nextSin;
      const x = xs[m];
      const y = ys[m];
      // e^(-i k t_m) = nextCos + i * nextSin (since stepAngle < 0)
      posRe += x * nextCos - y * nextSin;
      posIm += x * nextSin + y * nextCos;
      // e^(+i k t_m) = nextCos - i * nextSin -> mode -k uses e^(-i (-k) t_m) = e^(+i k t_m)
      negRe += x * nextCos + y * nextSin;
      negIm += -x * nextSin + y * nextCos;
    }
    posRe /= M;
    posIm /= M;
    negRe /= M;
    negIm /= M;
    modes.push({ k, re: posRe, im: posIm, amplitude: Math.hypot(posRe, posIm) });
    modes.push({ k: -k, re: negRe, im: negIm, amplitude: Math.hypot(negRe, negIm) });
  }
  return modes;
}

function reconstructGrid(modes: readonly ComplexMode[], sampleCount: number, order: number) {
  const outX = new Float64Array(sampleCount);
  const outY = new Float64Array(sampleCount);
  const active = modes.filter((mode) => Math.abs(mode.k) <= order);
  for (let m = 0; m < sampleCount; m++) {
    const t = (2 * Math.PI * m) / sampleCount;
    let re = 0;
    let im = 0;
    for (const mode of active) {
      if (mode.k === 0) {
        re += mode.re;
        im += mode.im;
      } else {
        const angle = mode.k * t;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        re += mode.re * c - mode.im * s;
        im += mode.re * s + mode.im * c;
      }
    }
    outX[m] = re;
    outY[m] = im;
  }
  return { outX, outY };
}

const preparedCache = new Map<CountryMapSlug, PreparedCountryMap>();

export const COUNTRY_MAPS = COUNTRY_CONTOURS.map((entry) => ({
  id: entry.id,
  slug: entry.slug,
  name: entry.name,
  iso3: entry.iso3,
}));

export function prepareCountryMap(slugOrId: CountryMapSlug | CountryMapId): PreparedCountryMap {
  const entry = COUNTRY_CONTOURS.find((item) => item.slug === slugOrId || item.id === slugOrId);
  if (!entry) throw new RangeError("Unknown country map: " + slugOrId);
  const cached = preparedCache.get(entry.slug);
  if (cached) return cached;

  let lonMin = Infinity;
  let lonMax = -Infinity;
  let latMin = Infinity;
  let latMax = -Infinity;
  let mercMinX = Infinity;
  let mercMaxX = -Infinity;
  let mercMinY = Infinity;
  let mercMaxY = -Infinity;

  const rawMercLoops = entry.loops.map((loop) => {
    const count = loop.lonLatPairs.length / 2;
    const mx = new Float64Array(count);
    const my = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const lon = loop.lonLatPairs[i * 2];
      const lat = loop.lonLatPairs[i * 2 + 1];
      lonMin = Math.min(lonMin, lon);
      lonMax = Math.max(lonMax, lon);
      latMin = Math.min(latMin, lat);
      latMax = Math.max(latMax, lat);
      const p = mercatorProject(lon, lat);
      mx[i] = p.x;
      my[i] = p.y;
      mercMinX = Math.min(mercMinX, p.x);
      mercMaxX = Math.max(mercMaxX, p.x);
      mercMinY = Math.min(mercMinY, p.y);
      mercMaxY = Math.max(mercMaxY, p.y);
    }
    return { name: loop.name, count, mx, my };
  });

  const innerW = MAP_PANEL.right - MAP_PANEL.left - MAP_INNER_PAD.x * 2;
  const innerH = MAP_PANEL.bottom - MAP_PANEL.top - MAP_INNER_PAD.y * 2;
  const mercW = mercMaxX - mercMinX;
  const mercH = mercMaxY - mercMinY;
  const scale = Math.min(innerW / mercW, innerH / mercH);
  const mercMidX = (mercMinX + mercMaxX) / 2;
  const mercMidY = (mercMinY + mercMaxY) / 2;
  const screenCenterX = (MAP_PANEL.left + MAP_PANEL.right) / 2;
  const screenCenterY = (MAP_PANEL.top + MAP_PANEL.bottom) / 2;

  const projection: MapProjection = {
    lonMin,
    lonMax,
    latMin,
    latMax,
    centerLat: (latMin + latMax) / 2,
    mercMidX,
    mercMidY,
    scale,
    screenCenterX,
    screenCenterY,
    lonToScreenX: (lonDeg: number) => screenCenterX + (mercatorProject(lonDeg, 0).x - mercMidX) * scale,
    latToScreenY: (latDeg: number) => screenCenterY + (mercatorProject(0, latDeg).y - mercMidY) * scale,
  };

  const loops: PreparedContourLoop[] = rawMercLoops.map((raw) => {
    const exactX = new Float64Array(raw.count);
    const exactY = new Float64Array(raw.count);
    for (let i = 0; i < raw.count; i++) {
      exactX[i] = screenCenterX + (raw.mx[i] - mercMidX) * scale;
      exactY[i] = screenCenterY + (raw.my[i] - mercMidY) * scale;
    }
    const modes = computeLoopModes(exactX, exactY, MAX_HARMONIC_ORDER);
    const centerMode = modes[0];
    const sortedNonZeroModes = modes
      .filter((mode) => mode.k !== 0)
      .sort((a, b) => b.amplitude - a.amplitude || Math.abs(a.k) - Math.abs(b.k) || b.k - a.k);

    const tierX: Float64Array[] = [];
    const tierY: Float64Array[] = [];
    for (const order of HARMONIC_ORDERS) {
      const rec = reconstructGrid(modes, raw.count, order);
      tierX.push(rec.outX);
      tierY.push(rec.outY);
    }
    return {
      name: raw.name,
      sampleCount: raw.count,
      exactX,
      exactY,
      center: { x: centerMode.re, y: centerMode.im },
      modes,
      sortedNonZeroModes,
      tierX,
      tierY,
    };
  });

  // Compute reference variance and bounding diagonal for error metrics
  let centeredVarianceSum = 0;
  let totalSamples = 0;
  let exactLeft = Infinity;
  let exactRight = -Infinity;
  let exactTop = Infinity;
  let exactBottom = -Infinity;
  for (const loop of loops) {
    totalSamples += loop.sampleCount;
    for (let i = 0; i < loop.sampleCount; i++) {
      const dx = loop.exactX[i] - loop.center.x;
      const dy = loop.exactY[i] - loop.center.y;
      centeredVarianceSum += dx * dx + dy * dy;
      exactLeft = Math.min(exactLeft, loop.exactX[i]);
      exactRight = Math.max(exactRight, loop.exactX[i]);
      exactTop = Math.min(exactTop, loop.exactY[i]);
      exactBottom = Math.max(exactBottom, loop.exactY[i]);
    }
  }
  const exactDiagonal = Math.hypot(exactRight - exactLeft, exactBottom - exactTop);

  const tierMetrics: TierMetrics[] = HARMONIC_ORDERS.map((order, tierIndex) => {
    let sqErrorSum = 0;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const loop of loops) {
      const tx = loop.tierX[tierIndex];
      const ty = loop.tierY[tierIndex];
      for (let i = 0; i < loop.sampleCount; i++) {
        const ex = loop.exactX[i] - tx[i];
        const ey = loop.exactY[i] - ty[i];
        sqErrorSum += ex * ex + ey * ey;
        left = Math.min(left, tx[i]);
        right = Math.max(right, tx[i]);
        top = Math.min(top, ty[i]);
        bottom = Math.max(bottom, ty[i]);
      }
    }
    const relativeRmse = Math.sqrt(sqErrorSum / centeredVarianceSum);
    const diagonalRmse = Math.sqrt(sqErrorSum / totalSamples) / exactDiagonal;
    const precisionPercent = Math.max(0, Math.min(100, (1 - relativeRmse) * 100));
    return {
      order,
      relativeRmse,
      diagonalRmse,
      precisionPercent,
      bounds: { left, right, top, bottom },
    };
  });

  const spectrumAmplitudes = new Float64Array(MAX_HARMONIC_ORDER);
  for (let k = 1; k <= MAX_HARMONIC_ORDER; k++) {
    let energy = 0;
    for (const loop of loops) {
      for (const mode of loop.modes) {
        if (Math.abs(mode.k) === k) energy += mode.amplitude * mode.amplitude;
      }
    }
    spectrumAmplitudes[k - 1] = Math.sqrt(energy);
  }

  const prepared: PreparedCountryMap = {
    id: entry.id,
    slug: entry.slug,
    name: entry.name,
    iso3: entry.iso3,
    projection,
    loops,
    tierMetrics,
    spectrumAmplitudes,
  };
  preparedCache.set(entry.slug, prepared);
  return prepared;
}

export type FrameTierState = {
  readonly tier: HarmonicTier;
  readonly prevTier: HarmonicTier | null;
  readonly morphAlpha: number;
  readonly ghostAlpha: number;
  readonly stepPulse: number;
  readonly livePrecision: number;
  readonly tracePhase: number;
};

export function tierStateAtFrame(map: PreparedCountryMap, rawFrame: number): FrameTierState {
  const frame = Math.max(0, Math.min(SCENE_FRAMES - 1, rawFrame));
  let tier = HARMONIC_TIERS[HARMONIC_TIERS.length - 1];
  for (const candidate of HARMONIC_TIERS) {
    if (frame >= candidate.startFrame && frame < candidate.endFrame) {
      tier = candidate;
      break;
    }
  }
  const prevTier = tier.index > 0 ? HARMONIC_TIERS[tier.index - 1] : null;
  const elapsedFrames = frame - tier.startFrame;
  const morphAlpha = prevTier ? easeOut(elapsedFrames / MORPH_FRAMES) : 1;
  const tierSpan = Math.max(1, tier.endFrame - tier.startFrame);
  const ghostDecay = 1 - Math.min(1, elapsedFrames / (tierSpan * 0.88));
  const ghostAlpha = prevTier ? 0.14 + 0.34 * ghostDecay : 0;
  const stepPulse = Math.max(0, 1 - elapsedFrames / (VIDEO.fps * 0.45));

  const currPrecision = map.tierMetrics[tier.index].precisionPercent;
  const prevPrecision = prevTier ? map.tierMetrics[prevTier.index].precisionPercent : currPrecision;
  const livePrecision = prevPrecision + (currPrecision - prevPrecision) * morphAlpha;

  // Smooth continuous border trace (~2.5s per full revolution = ~4.8 sweeps over 12s)
  const seconds = frame / VIDEO.fps;
  const tracePhase = ((seconds / 2.5) * Math.PI * 2) % (Math.PI * 2);

  return {
    tier,
    prevTier,
    morphAlpha,
    ghostAlpha,
    stepPulse,
    livePrecision,
    tracePhase,
  };
}

/**
 * Evaluate the live complex Fourier epicycle chain at parameter t in [0, 2pi),
 * returning the visible largest circle joints and the exact active border point.
 */
export function evaluateEpicycleChain(
  loop: PreparedContourLoop,
  prevOrder: number,
  order: number,
  morphAlpha: number,
  t: number,
  maxVisibleJoints = 10,
): { joints: readonly EpicycleJoint[]; tip: { x: number; y: number } } {
  let x = loop.center.x;
  let y = loop.center.y;
  const joints: EpicycleJoint[] = [];
  for (const mode of loop.sortedNonZeroModes) {
    const absK = Math.abs(mode.k);
    if (absK > order) continue;
    const weight = absK <= prevOrder ? 1 : morphAlpha;
    if (weight <= 0) continue;
    const angle = mode.k * t;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const dx = (mode.re * c - mode.im * s) * weight;
    const dy = (mode.re * s + mode.im * c) * weight;
    const nextX = x + dx;
    const nextY = y + dy;
    if (joints.length < maxVisibleJoints) {
      joints.push({
        fromX: x,
        fromY: y,
        toX: nextX,
        toY: nextY,
        radius: mode.amplitude * weight,
        k: mode.k,
      });
    }
    x = nextX;
    y = nextY;
  }
  return { joints, tip: { x, y } };
}
