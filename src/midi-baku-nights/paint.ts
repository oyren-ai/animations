import type { MidiPainter } from "../components/MidiShell.tsx";
import {
  accentPulse,
  buildAccents,
  cameraKick,
  clamp,
  clamp01,
  drawCenteredText,
  drawGlow,
  drawSceneTitle,
  drawSoft,
  drawVignette,
  hash01,
  hsla,
  lerp,
  smoothstep,
} from "../midi/kit.ts";
import { pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import {
  bakuEventStateAt,
  buildBakuEvents,
  BUILDINGS,
  buildSkylineWindows,
  LAMPLIGHTER_FEET_Y,
  LAMPLIGHTER_X,
  lamplighterPoseAt,
  lampXAt,
  SCROLL_SPEED,
  STAGE,
  type BakuNoteEvent,
  type LamplighterPose,
} from "./sim.ts";

function activeBpmAt(scene: MidiSceneData, t: number): number {
  if (!scene.tempoMap.length) return 78;
  let mpq = scene.tempoMap[0].microsecondsPerQuarter;
  for (const change of scene.tempoMap) {
    if (change.timeSec <= Math.max(0, t)) mpq = change.microsecondsPerQuarter;
    else break;
  }
  return Math.round(60e6 / mpq);
}

/** Draws one cast-iron seaside boulevard streetlamp from promenade y = 1362 up to lantern y = lampY. */
function drawStreetlamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  lampY: number,
  litAmount: number,
  igniteFlash: number,
  hue: number,
) {
  const baseY = STAGE.walkwayTop + 4;
  ctx.save();

  // Cast-iron post + tapered plinth
  ctx.strokeStyle = litAmount > 0.05 ? "#334155" : "#1e293b";
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.lineTo(x, lampY + 20);
  ctx.stroke();

  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.roundRect(x - 8, baseY - 18, 16, 20, [4, 4, 1, 1]);
  ctx.fill();

  // Decorative scroll cross-bar beneath lantern
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 13, lampY + 22);
  ctx.lineTo(x + 13, lampY + 22);
  ctx.stroke();

  // Hexagonal glass lantern cage centred on (x, lampY)
  ctx.fillStyle = litAmount > 0.04
    ? hsla(hue, 0.96, lerp(0.54, 0.82, Math.max(litAmount * 0.5, igniteFlash)), 0.92)
    : "rgba(30, 41, 59, 0.68)";
  ctx.strokeStyle = litAmount > 0.04 ? "rgba(254, 240, 138, 0.92)" : "rgba(100, 116, 139, 0.65)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(x - 9, lampY + 18);
  ctx.lineTo(x - 13, lampY - 4);
  ctx.lineTo(x, lampY - 16);
  ctx.lineTo(x + 13, lampY - 4);
  ctx.lineTo(x + 9, lampY + 18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Lantern finial spike
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.moveTo(x - 6, lampY - 15);
  ctx.lineTo(x + 6, lampY - 15);
  ctx.lineTo(x, lampY - 25);
  ctx.closePath();
  ctx.fill();

  if (litAmount > 0.03) {
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, x, lampY, 118 + 75 * igniteFlash, hue, (0.52 + 0.45 * igniteFlash) * litAmount, 0.2);
    // Bright white-gold wick flame inside glass
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fef9c3";
    ctx.beginPath();
    ctx.ellipse(x, lampY + 3, 4.2, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Draws the silhouetted nocturnal lamplighter at x = 540 raising his ember-tipped brass pole. */
function drawLamplighter(ctx: CanvasRenderingContext2D, pose: LamplighterPose) {
  const { x, feetY, stridePhase, poleTipX, poleTipY, emberGlow } = pose;
  const bob = Math.abs(Math.sin(stridePhase)) * 3.2;
  const hipY = feetY - 44 - bob;
  const shoulderY = feetY - 82 - bob;
  const strideA = Math.sin(stridePhase) * 13;
  const strideB = -strideA;

  ctx.save();
  // Soft lantern rim-light around the lamplighter silhouette
  ctx.globalCompositeOperation = "lighter";
  drawGlow(ctx, poleTipX, poleTipY, 64 + 42 * emberGlow, 38, 0.58 * emberGlow, 0.22);
  ctx.globalCompositeOperation = "source-over";

  // Walking boots & legs
  ctx.strokeStyle = "#090d16";
  ctx.lineWidth = 6.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 3, hipY);
  ctx.lineTo(x - 3 + strideA, feetY);
  ctx.moveTo(x + 3, hipY);
  ctx.lineTo(x + 3 + strideB, feetY);
  ctx.stroke();

  // Tailored nocturnal overcoat silhouette with subtle amber rim highlight
  ctx.fillStyle = "#0b1120";
  ctx.strokeStyle = "rgba(251, 191, 36, 0.42)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 11, shoulderY);
  ctx.lineTo(x + 11, shoulderY);
  ctx.lineTo(x + 17 + strideA * 0.22, hipY + 14);
  ctx.lineTo(x - 16 + strideB * 0.22, hipY + 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Head & peaked cap
  ctx.fillStyle = "#0b1120";
  ctx.beginPath();
  ctx.arc(x + 1, shoulderY - 12, 9.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + 5, shoulderY - 17, 13, 4, -0.12, 0, Math.PI * 2);
  ctx.fill();

  // Long diagonal brass lighting pole held from hands up to (poleTipX, poleTipY)
  const handX = x + 8;
  const handY = shoulderY + 16;
  const poleGrad = ctx.createLinearGradient(handX - 12, handY + 18, poleTipX, poleTipY);
  poleGrad.addColorStop(0, "#78350f");
  poleGrad.addColorStop(0.7, "#d97706");
  poleGrad.addColorStop(1, "#fef08a");
  ctx.strokeStyle = poleGrad;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(handX - 12, handY + 20);
  ctx.lineTo(poleTipX, poleTipY + 4);
  ctx.stroke();

  // Arms gripping the brass pole
  ctx.strokeStyle = "#0b1120";
  ctx.lineWidth = 5.5;
  ctx.beginPath();
  ctx.moveTo(x - 4, shoulderY + 5);
  ctx.lineTo(handX - 4, handY + 10);
  ctx.moveTo(x + 5, shoulderY + 5);
  ctx.lineTo(handX + 4, handY);
  ctx.stroke();

  // Glowing brass hook & live ember wick at pole tip
  ctx.fillStyle = "#fef08a";
  ctx.beginPath();
  ctx.arc(poleTipX, poleTipY, 4.2 + 2 * emberGlow, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function createBakuNightsPainter(scene: MidiSceneData, label: string): MidiPainter {
  const windows = buildSkylineWindows();
  const events = buildBakuEvents(scene.notes, windows);
  const leadEvents = events.filter((e) => e.role === "lead");
  const stringEvents = events.filter((e) => e.role === "strings");
  const bassEvents = events.filter((e) => e.role === "bass");
  const brushEvents = events.filter((e) => e.role === "brush");

  // Precompute earliest activation time + per-window event lists so the 96-window skyline builds warmly!
  const eventsByWindow = new Map<number, BakuNoteEvent[]>();
  const firstLitByWindow = new Float64Array(windows.length).fill(Infinity);
  for (const ev of events) {
    if (ev.windowIdx < 0) continue;
    const list = eventsByWindow.get(ev.windowIdx);
    if (list) list.push(ev);
    else eventsByWindow.set(ev.windowIdx, [ev]);
    if (ev.tOn < firstLitByWindow[ev.windowIdx]) {
      firstLitByWindow[ev.windowIdx] = ev.tOn;
    }
  }

  const accents = buildAccents(scene.notes, 0.05, 0.75, 3.0);
  const tailSec = scene.totalFrames / scene.fps - scene.leadSec - scene.endSec;
  const totalSec = scene.totalFrames / scene.fps;
  const { width: W, height: H } = scene;
  const stageW = STAGE.right - STAGE.left;

  // Deterministic starfield inside sky band (y = 368..660)
  const stars = Array.from({ length: 52 }, (_, i) => ({
    x: STAGE.left + 22 + hash01(i, 31) * (stageW - 44),
    y: STAGE.skyTop + 14 + hash01(i, 32) * 280,
    r: 0.9 + 1.5 * hash01(i, 33),
    phase: hash01(i, 34) * Math.PI * 2,
  }));

  // Exact integer tile scroll cycles over totalFrames so promenade balustrade & stones loop seamlessly!
  const tileW = 70;
  const totalTileCycles = Math.max(1, Math.round((totalSec * SCROLL_SPEED) / tileW));

  return (ctx, frame) => {
    const t = pieceTime(scene, frame);
    const loopPhase = (2 * Math.PI * frame) / Math.max(1, scene.totalFrames);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // Nocturnal indigo canvas background — kept dark (< 0.015 luminance) across y = 0..282
    // so the quiet Oyren wordmark at y = 95..156 exceeds 11:1 WCAG contrast on every frame!
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#040710");
    bg.addColorStop(0.16, "#050914");
    bg.addColorStop(0.55, "#081022");
    bg.addColorStop(1, "#040812");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const kick = cameraKick(accents, t, 0.42);
    const pulse = accentPulse(accents, t, 0.24);
    const payoff01 = smoothstep(23.0, 27.5, t) * (1 - smoothstep(scene.endSec - 5.5, scene.endSec - 1.2, t));

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 282, W, H - 282);
    ctx.clip();

    const cx = 540;
    const cy = 970;
    ctx.translate(cx + kick.dx * 0.45, cy + kick.dy * 0.45);
    ctx.rotate(kick.rotation * 0.35);
    ctx.scale(1 + kick.zoom * 0.55, 1 + kick.zoom * 0.55);
    ctx.translate(-cx, -cy);

    // Clip scene interior to STAGE (x = 50..1030, y = 360..1645)
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.skyTop, stageW, STAGE.bottom - STAGE.skyTop, [6, 6, 14, 14]);
    ctx.clip();

    // =========================================================================
    // 1. NIGHT SKY, CRESCENT MOON & BOWED-STRING AURORA RIBBONS (y = 360..960)
    // =========================================================================
    const skyGrad = ctx.createLinearGradient(0, STAGE.skyTop, 0, STAGE.promenadeTop);
    skyGrad.addColorStop(0, "#060b19");
    skyGrad.addColorStop(0.55, "#0c1631");
    skyGrad.addColorStop(1, hsla(222, 0.52, 0.16 + 0.05 * payoff01, 1));
    ctx.fillStyle = skyGrad;
    ctx.fillRect(STAGE.left, STAGE.skyTop, stageW, STAGE.promenadeTop - STAGE.skyTop);

    // Twinkling stars
    for (const s of stars) {
      const tw = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(loopPhase * 3 + s.phase));
      ctx.fillStyle = `rgba(241, 245, 249, ${tw.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Crisp symmetric crescent moon centred at (540, 408)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    drawSoft(ctx, 540, 408, 260, 46, 0.18 + 0.08 * payoff01);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fef9c3";
    ctx.beginPath();
    ctx.arc(540, 408, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#070d1e";
    ctx.beginPath();
    ctx.arc(549, 403, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Bowed String Pad ribbons (1-to-1 with stringEvents, warming on -20c Rast thirds!)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const sev of stringEvents) {
      const st = bakuEventStateAt(sev, t);
      if (!st || st.glow <= 0.02) continue;
      const ribbonY = lerp(585, 445, clamp01((sev.pitch - 62) / 18));
      const ribbonHue = Math.abs(sev.pitchBendCents) > 10 ? 32 : 46;
      const g = ctx.createLinearGradient(STAGE.left, ribbonY, STAGE.right, ribbonY);
      g.addColorStop(0, hsla(ribbonHue, 0.9, 0.6, 0));
      g.addColorStop(0.5, hsla(ribbonHue, 0.95, 0.68, 0.28 * st.glow));
      g.addColorStop(1, hsla(ribbonHue, 0.9, 0.6, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 18 * st.glow;
      ctx.beginPath();
      for (let rx = STAGE.left; rx <= STAGE.right; rx += 24) {
        const u = (rx - STAGE.left) / stageW;
        const ry = ribbonY + Math.sin(u * Math.PI * 2 + loopPhase * 2 + sev.index) * 18;
        if (rx === STAGE.left) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.stroke();
    }
    ctx.restore();

    // =========================================================================
    // 2. SYMMETRIC TERRACED LIMESTONE SKYLINE (96 Arched Windows, y = 458..960)
    // =========================================================================
    // Warm backlight halo behind the old-city silhouette as payoff builds
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    drawSoft(ctx, 540, 740, 1220, 38, 0.10 + 0.22 * payoff01 + 0.05 * Math.min(1, pulse));
    ctx.restore();

    for (const b of BUILDINGS) {
      const bw = b.right - b.left;
      const bh = STAGE.promenadeTop - b.top;
      const bGrad = ctx.createLinearGradient(0, b.top, 0, STAGE.promenadeTop);
      bGrad.addColorStop(0, "#161f33");
      bGrad.addColorStop(1, "#0d1322");
      ctx.fillStyle = bGrad;
      ctx.strokeStyle = "rgba(251, 191, 36, 0.24)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(b.left, b.top, bw, bh, [6, 6, 0, 0]);
      ctx.fill();
      ctx.stroke();

      // Crenellated cornice + optional ribbed limestone dome
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(b.left - 3, b.top - 5, bw + 6, 6);
      if (b.domeRadius > 0) {
        const dcx = (b.left + b.right) / 2;
        ctx.fillStyle = "#172136";
        ctx.strokeStyle = "rgba(251, 191, 36, 0.34)";
        ctx.beginPath();
        ctx.arc(dcx, b.top - 5, b.domeRadius, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Spire finial
        ctx.beginPath();
        ctx.moveTo(dcx, b.top - 5 - b.domeRadius);
        ctx.lineTo(dcx, b.top - 17 - b.domeRadius);
        ctx.stroke();
      }
    }

    // Draw all 96 arched windows (1-to-1 chord/string flash + warm nocturnal accumulation + coda dim)
    let litWindowsCount = 0;
    const codaFadeStart = scene.endSec - 4.4;
    for (const win of windows) {
      const wEvents = eventsByWindow.get(win.index);
      let noteFlash = 0;
      let noteGlow = 0;
      let winHue = 40;
      if (wEvents) {
        for (const ev of wEvents) {
          const st = bakuEventStateAt(ev, t);
          if (!st) continue;
          if (st.flash > noteFlash) noteFlash = st.flash;
          if (st.glow >= noteGlow) {
            noteGlow = st.glow;
            winHue = ev.hue;
          }
        }
      }
      // Persistent warm interior light once first triggered, dimming smoothly during final 4.4 s coda!
      const tFirst = firstLitByWindow[win.index];
      let sustained = 0;
      if (t >= tFirst) {
        const fadeIn = smoothstep(tFirst, tFirst + 0.22, t);
        const stagger = hash01(win.index, 91) * 2.6;
        const fadeOut = 1 - smoothstep(codaFadeStart + stagger, codaFadeStart + stagger + 1.35, t);
        const flicker = 0.88 + 0.12 * Math.sin(loopPhase * 5 + win.index * 0.7);
        sustained = fadeIn * fadeOut * flicker * 0.78;
      }
      const totalLit = clamp01(Math.max(sustained, noteGlow, noteFlash));
      if (totalLit > 0.15) litWindowsCount++;

      const wx = win.x - win.w / 2;
      const wy = win.y - win.h / 2;
      ctx.fillStyle = totalLit > 0.03
        ? hsla(winHue, 0.95, lerp(0.46, 0.78, Math.max(totalLit * 0.65, noteFlash)), 0.28 + 0.7 * totalLit)
        : "rgba(15, 23, 42, 0.86)";
      ctx.strokeStyle = totalLit > 0.1 ? "rgba(253, 224, 71, 0.65)" : "rgba(71, 85, 105, 0.35)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(wx, wy, win.w, win.h, [win.w / 2, win.w / 2, 2, 2]);
      ctx.fill();
      ctx.stroke();

      if (noteFlash > 0.08 || totalLit > 0.45) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        drawGlow(ctx, win.x, win.y, 38 + 30 * noteFlash, winHue, 0.24 * totalLit + 0.42 * noteFlash, 0.24);
        ctx.restore();
      }
    }

    // =========================================================================
    // 3. SEASIDE BOULEVARD, SCROLLING LAMPS & LAMPLIGHTER (y = 924..1416)
    // =========================================================================
    // Terraced hillside backdrop between skyline base and promenade railing (y = 960..1362)
    const promBack = ctx.createLinearGradient(0, STAGE.promenadeTop, 0, STAGE.walkwayTop);
    promBack.addColorStop(0, "#090f1d");
    promBack.addColorStop(1, "#0f172a");
    ctx.fillStyle = promBack;
    ctx.fillRect(STAGE.left, STAGE.promenadeTop, stageW, STAGE.walkwayTop - STAGE.promenadeTop);

    // Loop-exact scrolling wrought-iron balustrade & stone walkway (y = 1318..1416)
    const scrollPx = (frame / Math.max(1, scene.totalFrames)) * totalTileCycles * tileW;
    const tileOffset = ((scrollPx % tileW) + tileW) % tileW;

    // Wrought-iron railing top & bottom bars + scrolling ornamental spindles
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(STAGE.left, STAGE.railingTop);
    ctx.lineTo(STAGE.right, STAGE.railingTop);
    ctx.moveTo(STAGE.left, STAGE.walkwayTop);
    ctx.lineTo(STAGE.right, STAGE.walkwayTop);
    ctx.stroke();

    ctx.strokeStyle = "rgba(100, 116, 139, 0.55)";
    ctx.lineWidth = 1.6;
    for (let rx = STAGE.left - tileOffset; rx <= STAGE.right + tileW; rx += tileW / 2) {
      ctx.beginPath();
      ctx.moveTo(rx, STAGE.railingTop);
      ctx.lineTo(rx, STAGE.walkwayTop);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rx + tileW / 4, (STAGE.railingTop + STAGE.walkwayTop) / 2, 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Paved limestone promenade deck (y = 1362..1416)
    const walkGrad = ctx.createLinearGradient(0, STAGE.walkwayTop, 0, STAGE.waterTop);
    walkGrad.addColorStop(0, "#1e293b");
    walkGrad.addColorStop(1, "#0f172a");
    ctx.fillStyle = walkGrad;
    ctx.fillRect(STAGE.left, STAGE.walkwayTop, stageW, STAGE.waterTop - STAGE.walkwayTop);

    ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
    ctx.lineWidth = 1.4;
    for (let sx = STAGE.left - tileOffset; sx <= STAGE.right + tileW; sx += tileW) {
      ctx.beginPath();
      ctx.moveTo(sx, STAGE.walkwayTop);
      ctx.lineTo(sx - 18, STAGE.waterTop);
      ctx.stroke();
    }

    // Collect visible boulevard streetlamps for current pass (t) AND loop-wrap incoming opening lamps (t - totalSec)
    const visibleLamps: { x: number; y: number; lit: number; flash: number; hue: number }[] = [];
    for (const shift of [0, -totalSec]) {
      const tLocal = t + shift;
      for (const ev of leadEvents) {
        const lx = lampXAt(ev, tLocal);
        if (lx < STAGE.left - 70 || lx > STAGE.right + 70) continue;
        // Wrapped next-cycle lamps in the final tail enter unlit from the right so frame N-1 == frame 0!
        const isLit = shift === 0 && tLocal >= ev.tOn;
        const age = tLocal - ev.tOn;
        const lit = isLit ? clamp01(smoothstep(0, 0.03, age)) : 0;
        const flash = isLit ? Math.exp(-age / 0.18) * (0.6 + 0.4 * ev.vel01) : 0;
        visibleLamps.push({ x: lx, y: ev.y, lit, flash, hue: ev.hue });
      }
    }

    for (const lamp of visibleLamps) {
      drawStreetlamp(ctx, lamp.x, lamp.y, lamp.lit, lamp.flash, lamp.hue);
    }

    // Ignition spark burst when a lamp ignites at (540, lampY)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const ev of leadEvents) {
      const age = t - ev.tOn;
      if (age < 0 || age > 0.42) continue;
      for (let k = 0; k < 7; k++) {
        const ang = hash01(ev.seed, k * 3 + 1) * Math.PI * 2;
        const spd = 45 + 115 * hash01(ev.seed, k * 3 + 2);
        const sx = LAMPLIGHTER_X + Math.cos(ang) * spd * age;
        const sy = ev.y + Math.sin(ang) * spd * age + 140 * age * age;
        const fade = (1 - age / 0.42) ** 2;
        drawGlow(ctx, sx, sy, 14, ev.hue, 0.85 * fade, 0.3);
      }
    }
    ctx.restore();

    // Silhouetted Lamplighter & glowing brass pole at x = 540
    const pose = lamplighterPoseAt(leadEvents, t, scene.leadSec, scene.endSec, tailSec, loopPhase);
    drawLamplighter(ctx, pose);

    // =========================================================================
    // 4. DARK HARBOUR WATER, REFLECTIONS, BASS SWELLS & BRUSH RIPPLES (y = 1416..1645)
    // =========================================================================
    const waterH = STAGE.bottom - STAGE.waterTop;
    const waterGrad = ctx.createLinearGradient(0, STAGE.waterTop, 0, STAGE.bottom);
    waterGrad.addColorStop(0, "#050d1d");
    waterGrad.addColorStop(0.5, "#07142b");
    waterGrad.addColorStop(1, "#030813");
    ctx.fillStyle = waterGrad;
    ctx.fillRect(STAGE.left, STAGE.waterTop, stageW, waterH);

    // Carved stone seawall lip at y = 1416
    ctx.fillStyle = "#334155";
    ctx.fillRect(STAGE.left, STAGE.waterTop - 3, stageW, 5);

    // Golden water reflection pillars under every lit streetlamp + skyline shimmer
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (litWindowsCount > 0) {
      const skyRefAlpha = clamp01(litWindowsCount / 96) * 0.18;
      drawSoft(ctx, 540, STAGE.waterTop + 80, 920, 40, skyRefAlpha);
    }
    for (const lamp of visibleLamps) {
      if (lamp.lit <= 0.04) continue;
      for (let r = 0; r < 9; r++) {
        const ry = STAGE.waterTop + 14 + r * 22;
        const rw = (14 + r * 3.8) * (0.85 + 0.25 * Math.sin(loopPhase * 6 + r + lamp.x * 0.03));
        const rx = lamp.x + Math.sin(loopPhase * 5 + r * 1.4) * 5;
        const a = (1 - r / 10) * 0.36 * lamp.lit;
        ctx.fillStyle = hsla(lamp.hue, 0.96, 0.66, a);
        ctx.fillRect(rx - rw / 2, ry, rw, 4.5);
      }
    }

    // Upright Bass Golden Harbour Swells (1-to-1 with bassEvents!)
    for (const bev of bassEvents) {
      const st = bakuEventStateAt(bev, t);
      if (!st) continue;
      const age = t - bev.tOn;
      const u = clamp01(age / 1.85);
      const rx = 24 + 210 * (1 - (1 - u) ** 2.4);
      const ry = 7 + 44 * (1 - (1 - u) ** 2.4);
      ctx.strokeStyle = hsla(bev.hue, 0.96, 0.68, (1 - u) ** 1.5 * 0.72 * (0.6 + 0.4 * bev.vel01));
      ctx.lineWidth = 3.2 * (1 - u * 0.7);
      ctx.beginPath();
      ctx.ellipse(bev.x, bev.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      // Seawall bass buoy flash at (bev.x, waterTop + 3)
      if (st.flash > 0.05) {
        drawGlow(ctx, bev.x, STAGE.waterTop + 4, 62, bev.hue, 0.58 * st.flash, 0.24);
      }
    }

    // Night Brush Silver Sea-Breeze Wavelets (1-to-1 with brushEvents!)
    for (const wv of brushEvents) {
      const st = bakuEventStateAt(wv, t);
      if (!st) continue;
      const age = t - wv.tOn;
      const u = clamp01(age / 1.15);
      const halfW = 18 + 68 * u;
      ctx.strokeStyle = hsla(198, 0.85, 0.78, (1 - u) ** 1.6 * 0.52);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(wv.x - halfW, wv.y);
      ctx.quadraticCurveTo(wv.x, wv.y - 5 * Math.sin(Math.PI * u), wv.x + halfW, wv.y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore(); // end stage interior clip

    // Crisp outer Stage Frame
    ctx.strokeStyle = "rgba(251, 191, 36, 0.34)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.skyTop, stageW, STAGE.bottom - STAGE.skyTop, [6, 6, 14, 14]);
    ctx.stroke();

    // --- Top Stage HUD Bar (x = 50..1030, y = 295..355) ---
    const hudH = STAGE.hudBottom - STAGE.top;
    const hudGrad = ctx.createLinearGradient(0, STAGE.top, 0, STAGE.hudBottom);
    hudGrad.addColorStop(0, "rgba(15, 23, 42, 0.94)");
    hudGrad.addColorStop(1, "rgba(9, 14, 28, 0.94)");
    ctx.fillStyle = hudGrad;
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.top, stageW, hudH, [12, 12, 4, 4]);
    ctx.fill();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.40)";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    const bpm = activeBpmAt(scene, t);
    drawCenteredText(ctx, `SKYLINE  ${litWindowsCount} / ${windows.length} WINDOWS`, STAGE.top + 39, {
      size: 20,
      weight: 700,
      color: payoff01 > 0.5 ? "#fde047" : "#f1f5f9",
      maxWidth: 360,
      letterSpacing: 1.1,
      centerX: 540,
    });
    drawCenteredText(ctx, "PIANO & STRINGS", STAGE.top + 38, {
      size: 17,
      weight: 700,
      color: "#fcd34d",
      maxWidth: 190,
      letterSpacing: 0.9,
      centerX: 235,
    });
    drawCenteredText(ctx, `4/4  \u00b7  ${bpm} BPM`, STAGE.top + 38, {
      size: 17,
      weight: 700,
      color: "#7dd3fc",
      maxWidth: 190,
      letterSpacing: 0.9,
      centerX: 845,
    });

    const prog = clamp01((frame / scene.fps) / Math.max(1, totalSec));
    const progHalf = (stageW - 24) * 0.5 * prog;
    ctx.fillStyle = "rgba(200, 255, 0, 0.48)";
    ctx.fillRect(540 - progHalf, STAGE.top + 2, progHalf * 2, 2);

    void LAMPLIGHTER_FEET_Y;
    ctx.restore(); // end camera + y >= 282 clip

    drawVignette(ctx, W, H, 0.42);
    drawSceneTitle(ctx, scene, label, frame);
  };
}
