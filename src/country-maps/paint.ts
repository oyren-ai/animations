import { spring } from "remotion";
import { assertSafeBox } from "../ball-drop/bounds.ts";
import { SCENE_FRAMES, VIDEO } from "../settings.ts";
import { easeIn, theme } from "../theme.ts";
import {
  evaluateEpicycleChain,
  HARMONIC_ORDERS,
  HARMONIC_TIERS,
  MAP_PANEL,
  type PreparedContourLoop,
  type PreparedCountryMap,
  tierStateAtFrame,
} from "./fourier.ts";

const C = theme.colors;

type TextAlignMode = "left" | "center" | "right";

function drawSafeText(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: TextAlignMode = "left",
  weight = 500,
): number {
  ctx.font = String(weight) + " " + size + "px " + JSON.stringify(theme.fontFamily);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(value);
  const left = align === "center" ? x - m.width / 2 : align === "right" ? x - m.width : x;
  assertSafeBox({
    left: left - m.actualBoundingBoxLeft,
    right: left + m.actualBoundingBoxRight,
    top: y - m.actualBoundingBoxAscent,
    bottom: y + m.actualBoundingBoxDescent,
  });
  ctx.fillStyle = color;
  ctx.fillText(value, left, y);
  return m.width;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function paintBackground(ctx: CanvasRenderingContext2D, frame: number) {
  const seconds = frame / VIDEO.fps;
  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
  const meshX = 480 + Math.sin(seconds * 0.42) * 75;
  const meshY = 930 + Math.cos(seconds * 0.33) * 55;
  const mesh = ctx.createRadialGradient(meshX, meshY, 0, 540, 960, 960);
  mesh.addColorStop(0, C.mesh);
  mesh.addColorStop(1, C.transparent);
  ctx.fillStyle = mesh;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
}

function paintFinishGrade(ctx: CanvasRenderingContext2D, frame: number) {
  ctx.save();
  ctx.fillStyle = C.grade;
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = C.grain;
  for (let k = 0; k < 420; k++) {
    ctx.fillRect((k * 197 + frame * 7) % VIDEO.width, (k * 277 + frame * 3) % VIDEO.height, 1, 1);
  }
  const vignette = ctx.createRadialGradient(540, 960, 520, 540, 960, 1260);
  vignette.addColorStop(0, C.transparent);
  vignette.addColorStop(1, C.vignette);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
  ctx.restore();
}

function chooseGridStepDegrees(spanDeg: number): number {
  if (spanDeg <= 5.5) return 1;
  if (spanDeg <= 13) return 2;
  if (spanDeg <= 23) return 4;
  return 6;
}

function formatLonLabel(lon: number): string {
  const abs = Math.abs(Math.round(lon));
  return abs + "°" + (lon >= 0 ? "E" : "W");
}

function formatLatLabel(lat: number): string {
  const abs = Math.abs(Math.round(lat));
  return abs + "°" + (lat >= 0 ? "N" : "S");
}

function paintMercatorGrid(ctx: CanvasRenderingContext2D, map: PreparedCountryMap) {
  const { projection } = map;
  const lonSpan = projection.lonMax - projection.lonMin;
  const latSpan = projection.latMax - projection.latMin;
  const lonStep = chooseGridStepDegrees(lonSpan);
  const latStep = chooseGridStepDegrees(latSpan);

  const startLon = Math.floor((projection.lonMin - lonStep * 2) / lonStep) * lonStep;
  const endLon = Math.ceil((projection.lonMax + lonStep * 2) / lonStep) * lonStep;
  const startLat = Math.floor((projection.latMin - latStep * 2) / latStep) * latStep;
  const endLat = Math.ceil((projection.latMax + latStep * 2) / latStep) * latStep;

  ctx.save();
  roundedRectPath(
    ctx,
    MAP_PANEL.left,
    MAP_PANEL.top,
    MAP_PANEL.right - MAP_PANEL.left,
    MAP_PANEL.bottom - MAP_PANEL.top,
    22,
  );
  ctx.clip();

  ctx.strokeStyle = C.faint;
  ctx.lineWidth = 1;
  for (let lon = startLon; lon <= endLon; lon += lonStep) {
    const x = projection.lonToScreenX(lon);
    if (x < MAP_PANEL.left + 8 || x > MAP_PANEL.right - 8) continue;
    ctx.beginPath();
    ctx.moveTo(x, MAP_PANEL.top);
    ctx.lineTo(x, MAP_PANEL.bottom);
    ctx.stroke();
  }
  for (let lat = startLat; lat <= endLat; lat += latStep) {
    const y = projection.latToScreenY(lat);
    if (y < MAP_PANEL.top + 8 || y > MAP_PANEL.bottom - 8) continue;
    ctx.beginPath();
    ctx.moveTo(MAP_PANEL.left, y);
    ctx.lineTo(MAP_PANEL.right, y);
    ctx.stroke();
  }
  ctx.restore();

  // Coordinate labels inside safe panel margins
  ctx.save();
  ctx.globalAlpha *= 0.72;
  let lastLonLabelX = -Infinity;
  for (let lon = startLon; lon <= endLon; lon += lonStep) {
    const x = projection.lonToScreenX(lon);
    if (x < MAP_PANEL.left + 88 || x > MAP_PANEL.right - 74) continue;
    if (x - lastLonLabelX < 84) continue;
    drawSafeText(ctx, formatLonLabel(lon), x, MAP_PANEL.top + 30, 19, C.muted, "center", 550);
    lastLonLabelX = x;
  }
  let lastLatLabelY = -Infinity;
  for (let lat = endLat; lat >= startLat; lat -= latStep) {
    const y = projection.latToScreenY(lat);
    if (y < MAP_PANEL.top + 68 || y > MAP_PANEL.bottom - 26) continue;
    if (y - lastLatLabelY < 62) continue;
    drawSafeText(ctx, formatLatLabel(lat), MAP_PANEL.left + 16, y - 6, 19, C.muted, "left", 550);
    lastLatLabelY = y;
  }
  ctx.restore();
}

function traceClosedLoopPath(
  ctx: CanvasRenderingContext2D,
  prevX: Float64Array,
  prevY: Float64Array,
  currX: Float64Array,
  currY: Float64Array,
  alpha: number,
) {
  const n = currX.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = prevX[i] + (currX[i] - prevX[i]) * alpha;
    const y = prevY[i] + (currY[i] - prevY[i]) * alpha;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function paintLoopWake(
  ctx: CanvasRenderingContext2D,
  loop: PreparedContourLoop,
  prevIdx: number,
  currIdx: number,
  morphAlpha: number,
  tracePhase: number,
  isPrimary: boolean,
) {
  const count = loop.sampleCount;
  const exactPos = ((tracePhase / (Math.PI * 2)) * count) % count;
  const headIdx = Math.floor(exactPos);
  const frac = exactPos - headIdx;
  const nextIdx = (headIdx + 1) % count;

  const samplePoint = (idx: number) => {
    const px = loop.tierX[prevIdx][idx];
    const py = loop.tierY[prevIdx][idx];
    const cx = loop.tierX[currIdx][idx];
    const cy = loop.tierY[currIdx][idx];
    return {
      x: px + (cx - px) * morphAlpha,
      y: py + (cy - py) * morphAlpha,
    };
  };

  const p0 = samplePoint(headIdx);
  const p1 = samplePoint(nextIdx);
  const tipX = p0.x + (p1.x - p0.x) * frac;
  const tipY = p0.y + (p1.y - p0.y) * frac;

  const wakeSteps = Math.max(12, Math.min(44, Math.round(count * 0.055)));
  ctx.save();
  ctx.lineCap = "round";
  for (let s = wakeSteps; s >= 1; s--) {
    const iA = (headIdx - s + count) % count;
    const iB = (headIdx - s + 1 + count) % count;
    const a = samplePoint(iA);
    const b = s === 1 ? { x: tipX, y: tipY } : samplePoint(iB);
    const progress = 1 - s / wakeSteps;
    ctx.globalAlpha = progress * progress * (isPrimary ? 0.88 : 0.68);
    ctx.strokeStyle = isPrimary ? C.tracerWake : C.secondaryWake;
    ctx.lineWidth = (isPrimary ? 1.8 : 1.4) + progress * (isPrimary ? 3.8 : 2.2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();

  return { x: tipX, y: tipY };
}

function paintSigmaGlyph(ctx: CanvasRenderingContext2D, x: number, centerY: number, size: number, color: string) {
  const halfH = size * 0.48;
  const w = size * 0.68;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.8;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + w, centerY - halfH + 3);
  ctx.lineTo(x + w, centerY - halfH);
  ctx.lineTo(x, centerY - halfH);
  ctx.lineTo(x + w * 0.56, centerY);
  ctx.lineTo(x, centerY + halfH);
  ctx.lineTo(x + w, centerY + halfH);
  ctx.lineTo(x + w, centerY + halfH - 3);
  ctx.stroke();
  ctx.restore();
  return w;
}

function paintFormulaCard(
  ctx: CanvasRenderingContext2D,
  frame: number,
  order: number,
  precisionPercent: number,
  stepPulse: number,
) {
  const cardLeft = 86;
  const cardRight = 994;
  const cardTop = 382;
  const cardHeight = 148;
  const entrance = spring({ frame: frame - 3, fps: VIDEO.fps, config: theme.spring.smooth });

  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, entrance));
  ctx.translate(0, (1 - entrance) * 18);

  roundedRectPath(ctx, cardLeft, cardTop, cardRight - cardLeft, cardHeight, 20);
  ctx.fillStyle = C.mapCard;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Row 1: f_N(t) = Σ_{k=-N..N} c_k · e^(i·k·t) with live N substituted
  const rowY = cardTop + 56;
  let cursorX = cardLeft + 30;
  cursorX += drawSafeText(ctx, "f", cursorX, rowY, 31, C.ink, "left", 700) + 2;
  cursorX += drawSafeText(ctx, String(order), cursorX, rowY + 7, 20, C.primary, "left", 750) + 3;
  cursorX += drawSafeText(ctx, "(t) = ", cursorX, rowY, 29, C.ink, "left", 600) + 6;
  cursorX += paintSigmaGlyph(ctx, cursorX, rowY - 10, 30, C.primary) + 10;

  const rangeBadge = "k = -" + order + " .. " + order;
  ctx.font = "650 22px " + JSON.stringify(theme.fontFamily);
  const rangeW = ctx.measureText(rangeBadge).width + 24;
  roundedRectPath(ctx, cursorX, rowY - 26, rangeW, 34, 10);
  ctx.fillStyle = C.surface;
  ctx.fill();
  ctx.strokeStyle = C.faint;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  drawSafeText(ctx, rangeBadge, cursorX + rangeW / 2, rowY - 2, 22, C.accent, "center", 650);
  cursorX += rangeW + 14;

  cursorX += drawSafeText(ctx, "c", cursorX, rowY, 30, C.ink, "left", 650) + 1;
  cursorX += drawSafeText(ctx, "k", cursorX, rowY + 6, 19, C.muted, "left", 650) + 6;
  cursorX += drawSafeText(ctx, "· e", cursorX, rowY, 30, C.ink, "left", 650) + 2;
  drawSafeText(ctx, "i·k·t", cursorX, rowY - 12, 20, C.accent, "left", 650);

  // Divider
  ctx.beginPath();
  ctx.moveTo(cardLeft + 28, cardTop + 86);
  ctx.lineTo(cardRight - 28, cardTop + 86);
  ctx.strokeStyle = C.faint;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Row 2: Harmonics: N = <order>  |  Precision: <XX.X>%
  const metricY = cardTop + 126;
  drawSafeText(ctx, "Harmonics:", cardLeft + 30, metricY, 26, C.muted, "left", 500);
  ctx.save();
  const popScale = 1 + stepPulse * 0.06;
  ctx.translate(cardLeft + 184, metricY - 9);
  ctx.scale(popScale, popScale);
  ctx.translate(-(cardLeft + 184), -(metricY - 9));
  drawSafeText(ctx, "N = " + order, cardLeft + 184, metricY, 28, C.primary, "left", 750);
  ctx.restore();

  drawSafeText(ctx, "Precision:", 660, metricY, 26, C.muted, "left", 500);
  const formattedPrecision = precisionPercent >= 99.95 ? "99.9%" : precisionPercent.toFixed(1) + "%";
  drawSafeText(ctx, formattedPrecision, cardRight - 30, metricY, 28, C.ink, "right", 750);

  ctx.restore();
}

function paintSpectrumPanel(
  ctx: CanvasRenderingContext2D,
  map: PreparedCountryMap,
  frame: number,
  tierIndex: number,
  order: number,
  morphAlpha: number,
) {
  const left = 86;
  const right = 994;
  const top = 1404;
  const height = 156;
  const entrance = spring({ frame: frame - 8, fps: VIDEO.fps, config: theme.spring.smooth });

  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, entrance));
  ctx.translate(0, (1 - entrance) * 20);

  roundedRectPath(ctx, left, top, right - left, height, 20);
  ctx.fillStyle = C.mapCard;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  drawSafeText(ctx, "HARMONIC SPECTRUM  |c_k|", left + 28, top + 34, 20, C.muted, "left", 650);
  drawSafeText(
    ctx,
    "TERMS: " + (2 * order + 1),
    right - 28,
    top + 34,
    20,
    C.accent,
    "right",
    650,
  );

  // 8 harmonic tier bands x 7 sub-bars = 56 bars across symmetric card margins
  const barsPerTier = 7;
  const totalBars = HARMONIC_ORDERS.length * barsPerTier;
  const chartLeft = left + 28;
  const chartRight = right - 28;
  const chartWidth = chartRight - chartLeft;
  const slotW = chartWidth / totalBars;
  const barW = Math.max(6, slotW - 4.5);
  const baseLineY = top + 114;
  const maxBarH = 60;

  let maxCompressed = 1e-6;
  const barValues = new Float64Array(totalBars);
  for (let tIdx = 0; tIdx < HARMONIC_ORDERS.length; tIdx++) {
    const startK = tIdx === 0 ? 1 : HARMONIC_ORDERS[tIdx - 1] + 1;
    const endK = HARMONIC_ORDERS[tIdx];
    const span = Math.max(1, endK - startK + 1);
    for (let sub = 0; sub < barsPerTier; sub++) {
      const kLo = startK + Math.floor((sub * span) / barsPerTier);
      const kHi = Math.max(kLo, startK + Math.floor(((sub + 1) * span) / barsPerTier) - 1);
      let sum = 0;
      let cnt = 0;
      for (let k = kLo; k <= kHi; k++) {
        sum += map.spectrumAmplitudes[Math.min(k - 1, map.spectrumAmplitudes.length - 1)];
        cnt++;
      }
      const compressed = Math.pow(cnt > 0 ? sum / cnt : 0, 0.34);
      barValues[tIdx * barsPerTier + sub] = compressed;
      maxCompressed = Math.max(maxCompressed, compressed);
    }
  }

  for (let b = 0; b < totalBars; b++) {
    const bandTier = Math.floor(b / barsPerTier);
    const norm = Math.max(0.16, barValues[b] / maxCompressed);
    const activeFactor =
      bandTier < tierIndex ? 1 : bandTier === tierIndex ? 0.3 + 0.7 * morphAlpha : 0.28;
    const h = Math.max(5, maxBarH * norm * activeFactor);
    const bx = chartLeft + b * slotW;
    const by = baseLineY - h;
    ctx.fillStyle =
      bandTier < tierIndex ? C.accent : bandTier === tierIndex ? C.primary : C.faint;
    roundedRectPath(ctx, bx, by, barW, h, 3);
    ctx.fill();
  }

  for (let tIdx = 0; tIdx < HARMONIC_ORDERS.length; tIdx++) {
    const groupCenter = chartLeft + (tIdx + 0.5) * barsPerTier * slotW - 2;
    const labelColor =
      tIdx === tierIndex ? C.primary : tIdx < tierIndex ? C.muted : C.line;
    drawSafeText(
      ctx,
      String(HARMONIC_ORDERS[tIdx]),
      groupCenter,
      top + 140,
      17,
      labelColor,
      "center",
      tIdx === tierIndex ? 750 : 600,
    );
  }

  ctx.restore();
}

function stageCaptionForTier(tierIndex: number): string {
  if (tierIndex <= 1) return "Low harmonics find the compass tilt and overall mass.";
  if (tierIndex <= 3) return "Mid frequencies bend peninsulas, straits, and gulfs.";
  if (tierIndex <= 5) return "Higher modes carve capes, valleys, and island coasts.";
  return "240 harmonic pairs lock in the sovereign border.";
}

export function paintCountryMap(
  ctx: CanvasRenderingContext2D,
  map: PreparedCountryMap,
  frame: number,
) {
  paintBackground(ctx, frame);
  const state = tierStateAtFrame(map, frame);
  const fadeOut = 1 - easeIn((frame - (SCENE_FRAMES - VIDEO.fps * 0.17)) / (VIDEO.fps * 0.17));
  const seconds = frame / VIDEO.fps;

  ctx.save();
  ctx.globalAlpha = fadeOut;

  // 1. Header + Step pill
  const headerIn = spring({ frame, fps: VIDEO.fps, config: theme.spring.smooth });
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, headerIn));
  ctx.translate((1 - headerIn) * 16, (1 - headerIn) * 16 + Math.sin(seconds * 1.35) * 1.5);
  drawSafeText(ctx, map.name, 86, 308, 62, C.ink, "left", 750);
  drawSafeText(
    ctx,
    "Drawing the border with 1 math function",
    86,
    356,
    29,
    C.muted,
    "left",
    500,
  );
  roundedRectPath(ctx, 810, 260, 184, 50, 25);
  ctx.fillStyle = C.surface;
  ctx.fill();
  ctx.strokeStyle = state.tier.order === 240 ? C.primary : C.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawSafeText(
    ctx,
    "STEP " + (state.tier.index + 1) + " / " + HARMONIC_TIERS.length,
    902,
    293,
    21,
    state.tier.order === 240 ? C.primary : C.accent,
    "center",
    700,
  );
  ctx.restore();

  // 2. Live Formula & Precision Card
  paintFormulaCard(ctx, frame, state.tier.order, state.livePrecision, state.stepPulse);

  // 3. Map Viewport + Mercator Coordinate Grid
  const panelIn = spring({ frame: frame - 5, fps: VIDEO.fps, config: theme.spring.smooth });
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, panelIn));
  roundedRectPath(
    ctx,
    MAP_PANEL.left,
    MAP_PANEL.top,
    MAP_PANEL.right - MAP_PANEL.left,
    MAP_PANEL.bottom - MAP_PANEL.top,
    22,
  );
  ctx.fillStyle = C.mapViewport;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  paintMercatorGrid(ctx, map);

  const prevIdx = state.prevTier ? state.prevTier.index : state.tier.index;
  const currIdx = state.tier.index;
  const isFinalTier = state.tier.order === 240;

  // 3a. Subtle ghost contour of previous harmonic order z_{N_prev}(t)
  if (state.prevTier && state.ghostAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha *= state.ghostAlpha;
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = C.ghostStroke;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    for (const loop of map.loops) {
      traceClosedLoopPath(
        ctx,
        loop.tierX[prevIdx],
        loop.tierY[prevIdx],
        loop.tierX[prevIdx],
        loop.tierY[prevIdx],
        0,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // 3b. Active morphed closed loops (each island/exclave closed independently; zero bridge lines)
  for (const loop of map.loops) {
    traceClosedLoopPath(
      ctx,
      loop.tierX[prevIdx],
      loop.tierY[prevIdx],
      loop.tierX[currIdx],
      loop.tierY[currIdx],
      state.morphAlpha,
    );
    ctx.fillStyle = isFinalTier ? C.mapFillLocked : C.mapFill;
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = C.borderRim;
    ctx.lineWidth = 5.6;
    ctx.stroke();
    ctx.strokeStyle = isFinalTier ? C.primary : C.ink;
    ctx.lineWidth = isFinalTier ? 2.9 : 2.5;
    ctx.stroke();
  }

  // 3c. Live complex epicycle chain on primary contour + glowing tracers on every closed loop
  const primaryLoop = map.loops[0];
  const prevOrder = state.prevTier ? state.prevTier.order : state.tier.order;
  const chain = evaluateEpicycleChain(
    primaryLoop,
    prevOrder,
    state.tier.order,
    state.morphAlpha,
    state.tracePhase,
    9,
  );

  ctx.save();
  for (const joint of chain.joints) {
    if (joint.radius < 2.2) continue;
    ctx.beginPath();
    ctx.arc(joint.fromX, joint.fromY, joint.radius, 0, Math.PI * 2);
    ctx.strokeStyle = C.epicycleRing;
    ctx.lineWidth = 1.15;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(primaryLoop.center.x, primaryLoop.center.y);
  for (const joint of chain.joints) ctx.lineTo(joint.toX, joint.toY);
  ctx.lineTo(chain.tip.x, chain.tip.y);
  ctx.strokeStyle = C.epicycleArm;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(primaryLoop.center.x, primaryLoop.center.y, 3.6, 0, Math.PI * 2);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.restore();

  // Comet wakes + single hero glow on primary tracer tip
  map.loops.forEach((loop, loopIndex) => {
    const wakeTip = paintLoopWake(
      ctx,
      loop,
      prevIdx,
      currIdx,
      state.morphAlpha,
      state.tracePhase,
      loopIndex === 0,
    );
    const dotX = loopIndex === 0 ? chain.tip.x : wakeTip.x;
    const dotY = loopIndex === 0 ? chain.tip.y : wakeTip.y;
    if (loopIndex === 0) {
      const halo = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, 24);
      halo.addColorStop(0, C.tracerHalo);
      halo.addColorStop(1, C.transparent);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 24, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(dotX, dotY, 6.2, 0, Math.PI * 2);
      ctx.fillStyle = C.primary;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(dotX, dotY, 4.4, 0, Math.PI * 2);
      ctx.fillStyle = C.accent;
      ctx.fill();
    }
  });
  ctx.restore();

  // 4. Bottom Harmonic Spectrum Panel + Caption
  paintSpectrumPanel(
    ctx,
    map,
    frame,
    state.tier.index,
    state.tier.order,
    state.morphAlpha,
  );
  drawSafeText(
    ctx,
    stageCaptionForTier(state.tier.index),
    540,
    1608,
    25,
    C.muted,
    "center",
    500,
  );

  ctx.restore();
  paintFinishGrade(ctx, frame);
}
