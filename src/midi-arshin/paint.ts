import type { MidiPainter } from "../components/MidiShell.tsx";
import {
  accentPulse,
  buildAccents,
  cameraKick,
  clamp,
  clamp01,
  drawGlow,
  drawSceneTitle,
  drawSoft,
  drawVignette,
  hash01,
  hsla,
  lerp,
  lowerBound,
  smoothstep,
} from "../midi/kit.ts";
import { pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import {
  arshinEventStateAt,
  bassCordCoords,
  BOLT_X,
  buildArshinEvents,
  CHEST_X,
  CHEST_Y,
  HANGING_LINES_Y,
  jingleSparkAt,
  LANTERN_COUNT,
  lanternX,
  NAGHARA_CX,
  NAGHARA_CY,
  PEDDLER_BASE_Y,
  PEDDLER_X,
  peddlerPoseAt,
  RIBBON_SPEED,
  SHELF_HIGH_Y,
  SHELF_LOW_Y,
  silkHueForPitch,
  STAGE,
  type ArshinNoteEvent,
  type PeddlerPose,
} from "./sim.ts";

/** Quiet decorative almond-teardrop (boteh) corner inlay on the walnut stall frame. */
function drawBotehInlay(ctx: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number, alpha: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  ctx.strokeStyle = `rgba(251, 191, 36, ${alpha.toFixed(3)})`;
  ctx.fillStyle = `rgba(245, 158, 11, ${(alpha * 0.22).toFixed(3)})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.bezierCurveTo(12, 12, 19, 3, 17, -7);
  ctx.bezierCurveTo(15, -15, 5, -19, 2, -24);
  ctx.bezierCurveTo(-3, -15, -10, -7, -9, 3);
  ctx.bezierCurveTo(-7, 9, -3, 12, 0, 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Silhouetted balcony listener stepping onto an upper courtyard arch during the refrain. */
function drawBalconyListener(ctx: CanvasRenderingContext2D, cx: number, floorY: number, facing: number, presence: number) {
  if (presence <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = clamp01(presence);
  const shiftX = cx - facing * (1 - presence) * 18;
  ctx.fillStyle = "#0b1120";
  ctx.strokeStyle = "rgba(253, 224, 71, 0.42)";
  ctx.lineWidth = 1.4;
  // Coat / shoulders leaning gently toward the silk stall
  ctx.beginPath();
  ctx.moveTo(shiftX - 16, floorY);
  ctx.lineTo(shiftX - 13 + facing * 4, floorY - 52);
  ctx.lineTo(shiftX + 13 + facing * 4, floorY - 52);
  ctx.lineTo(shiftX + 16, floorY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Head
  ctx.beginPath();
  ctx.arc(shiftX + facing * 5, floorY - 65, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Draws the silhouetted Cloth Peddler behind the walnut counter wielding the brass Arshin stick and shears. */
function drawPeddlerAndArshinStick(ctx: CanvasRenderingContext2D, pose: PeddlerPose, loopPhase: number) {
  const { stickY, stickTilt, scissorSnap, foldPull } = pose;
  const sway = Math.sin(loopPhase * 4) * 2.2;
  const shoulderY = PEDDLER_BASE_Y - 124;

  ctx.save();
  // Peddler coat silhouette
  ctx.fillStyle = "#0b1120";
  ctx.strokeStyle = "rgba(251, 191, 36, 0.45)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(PEDDLER_X - 34, PEDDLER_BASE_Y + 4);
  ctx.lineTo(PEDDLER_X - 24 + sway * 0.4, shoulderY);
  ctx.lineTo(PEDDLER_X + 24 + sway * 0.4, shoulderY);
  ctx.lineTo(PEDDLER_X + 34, PEDDLER_BASE_Y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Head & traditional karakul lambswool hat silhouette
  ctx.beginPath();
  ctx.arc(PEDDLER_X + sway * 0.5, shoulderY - 16, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.roundRect(PEDDLER_X - 14 + sway * 0.5, shoulderY - 40, 28, 20, [7, 7, 3, 3]);
  ctx.fill();
  ctx.stroke();

  // Arms reaching to hold the brass Arshin measuring stick (or pulling left fold-cord during coda)
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(PEDDLER_X - 20, shoulderY + 12);
  ctx.lineTo(PEDDLER_X - 56 - foldPull * 38, lerp(stickY + 6, CHEST_Y - 14, foldPull * 0.5));
  ctx.moveTo(PEDDLER_X + 20, shoulderY + 12);
  ctx.lineTo(PEDDLER_X + 52, stickY + 4);
  ctx.stroke();

  // Engraved Brass Arshin Measuring Stick (224 px across x = 428..652, marked in 4 chereks & 16 girahs)
  ctx.save();
  ctx.translate(PEDDLER_X, stickY);
  ctx.rotate(stickTilt);
  const stickW = 224;
  const stickGrad = ctx.createLinearGradient(-stickW / 2, -6, stickW / 2, 6);
  stickGrad.addColorStop(0, "#b45309");
  stickGrad.addColorStop(0.5, "#fde047");
  stickGrad.addColorStop(1, "#b45309");
  ctx.fillStyle = stickGrad;
  ctx.strokeStyle = "#fef9c3";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(-stickW / 2, -5.5, stickW, 11, 3);
  ctx.fill();
  ctx.stroke();

  // 16 girah measurement notches along the brass Arshin stick
  ctx.strokeStyle = "#451a03";
  for (let g = 1; g < 16; g++) {
    const gx = -stickW / 2 + (g / 16) * stickW;
    const major = g % 4 === 0;
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(gx, -5);
    ctx.lineTo(gx, major ? 4.5 : 1.5);
    ctx.stroke();
  }
  ctx.restore();

  // Brass Tailor's Shears at (PEDDLER_X, stickY) snapping shut on every melody note!
  const openAngle = 0.36 * (1 - scissorSnap);
  ctx.save();
  ctx.translate(PEDDLER_X, stickY - 2);
  if (scissorSnap > 0.08) {
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, 0, 0, 74, 46, 0.65 * scissorSnap, 0.24);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.strokeStyle = "#fef08a";
  ctx.lineWidth = 3;
  for (const s of [-1, 1] as const) {
    ctx.save();
    ctx.rotate(s * openAngle - Math.PI * 0.5);
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(24, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-13, s * 4, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // Golden silk draw-cord pulled during coda fold-away
  if (foldPull > 0.02) {
    ctx.strokeStyle = `rgba(253, 224, 71, ${(0.75 * foldPull).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PEDDLER_X - 56 - foldPull * 38, lerp(stickY + 6, CHEST_Y - 14, foldPull * 0.5));
    ctx.lineTo(CHEST_X, HANGING_LINES_Y[1]);
    ctx.stroke();
  }
  ctx.restore();
}

export function createArshinPainter(scene: MidiSceneData, label: string): MidiPainter {
  const { events, melodyMinPitch, melodyMaxPitch, foldAwayStartSec } = buildArshinEvents(scene.notes);
  const melodyEvents = events.filter((e) => e.role === "melody");
  const tarEvents = events.filter((e) => e.role === "tar");
  const pianoEvents = events.filter((e) => e.role === "piano");
  const bassEvents = events.filter((e) => e.role === "bass");
  const drumEvents = events.filter((e) => e.role === "drum");

  const pianoByLantern = new Map<number, ArshinNoteEvent[]>();
  for (const ev of pianoEvents) {
    const list = pianoByLantern.get(ev.slotIndex);
    if (list) list.push(ev);
    else pianoByLantern.set(ev.slotIndex, [ev]);
  }

  const accents = buildAccents(scene.notes, 0.04, 0.8, 3.1);
  const tailSec = scene.totalFrames / scene.fps - scene.leadSec - scene.endSec;
  const { width: W, height: H } = scene;
  const stageW = STAGE.right - STAGE.left;

  const stars = Array.from({ length: 36 }, (_, i) => ({
    x: STAGE.left + 26 + hash01(i, 41) * (stageW - 52),
    y: STAGE.canopyTop + 16 + hash01(i, 42) * 210,
    r: 0.9 + 1.3 * hash01(i, 43),
    phase: hash01(i, 44) * Math.PI * 2,
  }));

  return (ctx, frame) => {
    const t = pieceTime(scene, frame);
    const loopPhase = (2 * Math.PI * frame) / Math.max(1, scene.totalFrames);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // Dark twilight background — strictly dark (< 0.015 luminance) across y = 0..282
    // so unchanged OyrenBrandQuietLayer maintains > 8.5:1 WCAG contrast on every frame!
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#05070f");
    bg.addColorStop(0.16, "#060914");
    bg.addColorStop(0.55, "#0a1020");
    bg.addColorStop(1, "#050811");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const kick = cameraKick(accents, t, 0.45);
    const pulse = accentPulse(accents, t, 0.2);

    // Measure current refrain / Tar energy for balcony listeners & unison silk ripple
    let tarEnergy = 0;
    const tWin0 = Math.max(0, lowerBound(scene.notes, t - 1.2) - 4);
    const tWin1 = Math.min(events.length, lowerBound(scene.notes, t + 0.2) + 4);
    for (let i = tWin0; i < tWin1; i++) {
      const ev = events[i];
      if (ev.role !== "tar") continue;
      const st = arshinEventStateAt(ev, t);
      if (st) tarEnergy = Math.max(tarEnergy, st.strike, st.glow);
    }
    const codaFold01 = smoothstep(foldAwayStartSec, scene.endSec + tailSec - 0.18, t);
    // Smooth balcony presence when refrain/coda Tar doubling is active, vanishing cleanly for loop return
    let nearRefrain = 0;
    for (const mev of melodyEvents) {
      if (mev.section !== "refrain" && mev.section !== "coda") continue;
      if (t >= mev.tOn - 0.6 && t <= mev.tOff + 0.8) {
        const w = smoothstep(mev.tOn - 0.6, mev.tOn + 0.1, t) * (1 - smoothstep(mev.tOff + 0.2, mev.tOff + 0.8, t));
        if (w > nearRefrain) nearRefrain = w;
      }
    }
    const listenerPresence = nearRefrain * (1 - smoothstep(0, 0.45, codaFold01));

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

    // Clip interior of street-market stall to STAGE (x = 50..1030, y = 295..1645)
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.top, stageW, STAGE.bottom - STAGE.top, 14);
    ctx.clip();

    // =========================================================================
    // 1. DUSK COURTYARD SKY, ARCHED BALCONIES & BRASS LANTERNS (y = 295..880)
    // =========================================================================
    const duskGrad = ctx.createLinearGradient(0, STAGE.top, 0, STAGE.counterTop);
    duskGrad.addColorStop(0, "#090e1f");
    duskGrad.addColorStop(0.42, "#131b36");
    duskGrad.addColorStop(0.82, "#24192c");
    duskGrad.addColorStop(1, "#181322");
    ctx.fillStyle = duskGrad;
    ctx.fillRect(STAGE.left, STAGE.top, stageW, STAGE.counterTop - STAGE.top);

    for (const s of stars) {
      const tw = 0.28 + 0.48 * (0.5 + 0.5 * Math.sin(loopPhase * 3 + s.phase));
      ctx.fillStyle = `rgba(248, 250, 252, ${tw.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Warm bazaar ambient glow growing as more silks hang overhead
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    drawSoft(ctx, 540, 660, 1280, 34, 0.12 + 0.14 * nearRefrain + 0.06 * Math.min(1, pulse));
    ctx.restore();

    // Three symmetric carved stone courtyard archways (left balcony, central market arch, right balcony)
    const arches = [
      { left: 96, right: 294, top: 432, balcony: true, facing: 1 },
      { left: 326, right: 754, top: 398, balcony: false, facing: 0 },
      { left: 786, right: 984, top: 432, balcony: true, facing: -1 },
    ];
    for (const arch of arches) {
      const aw = arch.right - arch.left;
      const acx = (arch.left + arch.right) / 2;
      ctx.fillStyle = "rgba(10, 15, 29, 0.72)";
      ctx.strokeStyle = "rgba(251, 191, 36, 0.28)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(arch.left, STAGE.counterTop);
      ctx.lineTo(arch.left, arch.top + aw * 0.42);
      ctx.quadraticCurveTo(acx, arch.top - 18, arch.right, arch.top + aw * 0.42);
      ctx.lineTo(arch.right, STAGE.counterTop);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (arch.balcony) {
        const balY = 588;
        drawBalconyListener(ctx, acx, balY, arch.facing, listenerPresence);
        // Wrought-iron balcony railing
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(arch.left + 8, balY, aw - 16, 7);
        ctx.strokeStyle = "rgba(251, 191, 36, 0.36)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(arch.left + 10, balY - 26, aw - 20, 26);
      }
    }

    // Carved wooden market eaves beam & 12 Pierced-Brass Oil Lanterns (1-to-1 with Piano harmony notes!)
    ctx.fillStyle = "#1c120c";
    ctx.fillRect(STAGE.left, STAGE.top, stageW, STAGE.eavesBottom - STAGE.top);
    ctx.strokeStyle = "rgba(245, 158, 11, 0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(STAGE.left, STAGE.eavesBottom);
    ctx.lineTo(STAGE.right, STAGE.eavesBottom);
    ctx.stroke();

    for (let l = 0; l < LANTERN_COUNT; l++) {
      const lx = lanternX(l);
      const list = pianoByLantern.get(l);
      let strike = 0;
      let glow = 0;
      if (list) {
        for (const ev of list) {
          const st = arshinEventStateAt(ev, t);
          if (!st) continue;
          strike = Math.max(strike, st.strike);
          glow = Math.max(glow, st.glow);
        }
      }
      const swing = strike * 0.32 * (l % 2 === 0 ? 1 : -1);
      ctx.save();
      ctx.translate(lx, STAGE.top + 14);
      ctx.rotate(swing);
      // Hanging chain + hexagonal brass lantern body + swinging clapper
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 14);
      ctx.stroke();

      ctx.fillStyle = glow > 0.04 ? hsla(40, 0.96, 0.56 + 0.25 * glow, 0.92) : "rgba(30, 41, 59, 0.78)";
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-10, 14);
      ctx.lineTo(10, 14);
      ctx.lineTo(13, 30);
      ctx.lineTo(0, 42);
      ctx.lineTo(-13, 30);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Visible brass clapper bead below lantern
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.arc(strike * 4 * (l % 2 === 0 ? 1 : -1), 46, 3.2, 0, Math.PI * 2);
      ctx.fill();

      if (glow > 0.04) {
        ctx.globalCompositeOperation = "lighter";
        drawGlow(ctx, 0, 28, 72 + 44 * strike, 40, 0.55 * glow, 0.22);
      }
      ctx.restore();
    }

    // =========================================================================
    // 2. THREE OVERHEAD SILK-HANGING LINES & DISPLAYED MEASURED CLOTHS
    // =========================================================================
    for (const ly of HANGING_LINES_Y) {
      ctx.strokeStyle = "rgba(253, 224, 71, 0.44)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(STAGE.left + 32, ly);
      ctx.quadraticCurveTo(540, ly + 8, STAGE.right - 32, ly);
      ctx.stroke();
    }

    // Render every measured melody silk cloth that has been cut (t >= ev.tOn) and not yet folded away!
    for (const ev of melodyEvents) {
      if (t < ev.tOn) continue;
      const hoistU = smoothstep(ev.tOn, ev.tOn + 0.34, t);
      const stagger = (ev.melodyOrdinal / Math.max(1, melodyEvents.length)) * 0.42;
      const foldU = smoothstep(
        foldAwayStartSec + stagger * 1.1,
        Math.min(scene.endSec + tailSec - 0.12, foldAwayStartSec + stagger * 1.1 + 1.15),
        t,
      );
      if (foldU >= 0.999) continue;

      // Current anchor position: rises from (540, ev.y) to (ev.hangX, ev.hangY), then folds into (CHEST_X, CHEST_Y)
      const hungX = lerp(PEDDLER_X, ev.hangX, hoistU);
      const hungY = lerp(ev.y, ev.hangY, hoistU) - 36 * Math.sin(Math.PI * hoistU);
      const curX = lerp(hungX, CHEST_X, foldU);
      const curY = lerp(hungY, CHEST_Y, foldU * foldU);
      const scaleFold = 1 - 0.72 * foldU;

      const w = ev.clothWidth * scaleFold;
      const h = ev.clothDrop * (0.45 + 0.55 * hoistU) * scaleFold;
      // Unison silk breeze wave during refrain/Tar passages + gentle ambient sway
      const ripple = Math.sin(loopPhase * 5 + ev.hangX * 0.025) * (2.5 + 8.5 * Math.max(nearRefrain, tarEnergy)) * hoistU * (1 - foldU);

      ctx.save();
      const silkGrad = ctx.createLinearGradient(curX - w / 2, curY, curX + w / 2 + ripple, curY + h);
      silkGrad.addColorStop(0, hsla(ev.hue, 0.88, 0.58, 0.94));
      silkGrad.addColorStop(0.65, hsla(ev.hue, 0.92, 0.46, 0.94));
      silkGrad.addColorStop(1, hsla((ev.hue + 16) % 360, 0.9, 0.38, 0.94));
      ctx.fillStyle = silkGrad;
      ctx.beginPath();
      ctx.moveTo(curX - w / 2, curY);
      ctx.lineTo(curX + w / 2, curY);
      ctx.quadraticCurveTo(curX + w / 2 + ripple, curY + h * 0.55, curX + w * 0.46 + ripple * 1.2, curY + h);
      ctx.lineTo(curX - w * 0.46 + ripple * 1.2, curY + h);
      ctx.quadraticCurveTo(curX - w / 2 + ripple, curY + h * 0.55, curX - w / 2, curY);
      ctx.closePath();
      ctx.fill();

      // Repeat-pass cloths get a bright double-gold woven hem border!
      ctx.strokeStyle = ev.isRepeatPass ? "rgba(254, 240, 138, 0.92)" : "rgba(255, 255, 255, 0.32)";
      ctx.lineWidth = ev.isRepeatPass ? 2.1 : 1.1;
      ctx.stroke();
      if (ev.isRepeatPass && h > 22) {
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(curX - w * 0.44 + ripple * 1.15, curY + h - 6);
        ctx.lineTo(curX + w * 0.44 + ripple * 1.15, curY + h - 6);
        ctx.stroke();
      }

      // Brass hanging clasp on the cord
      if (hoistU > 0.7 && foldU < 0.25) {
        ctx.fillStyle = "#fde047";
        ctx.fillRect(curX - 3, curY - 3, 6, 5);
      }
      ctx.restore();
    }

    // =========================================================================
    // 3. PITCHED SILK BOLT RACK, UNWINDING RIBBONS, PEDDLER & WALNUT COUNTER
    // =========================================================================
    // Right-hand Cedar Silk Bolt Rack (x = 896..994, y = 892..1176)
    ctx.fillStyle = "#23120b";
    ctx.strokeStyle = "rgba(245, 158, 11, 0.44)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(898, 892, 94, STAGE.counterTop - 892, [8, 8, 0, 0]);
    ctx.fill();
    ctx.stroke();

    const shelfCount = 8;
    for (let s = 0; s < shelfCount; s++) {
      const u = s / (shelfCount - 1);
      const sy = lerp(SHELF_LOW_Y, SHELF_HIGH_Y, u);
      const pApprox = Math.round(lerp(melodyMinPitch, melodyMaxPitch, u));
      const bHue = silkHueForPitch(pApprox);
      ctx.fillStyle = "#451a03";
      ctx.fillRect(902, sy + 8, 86, 4);
      // Rolled silk bolt cylinder
      ctx.fillStyle = hsla(bHue, 0.88, 0.54, 0.95);
      ctx.beginPath();
      ctx.roundRect(910, sy - 7, 68, 15, 7);
      ctx.fill();
      ctx.fillStyle = "#fde68a";
      ctx.beginPath();
      ctx.arc(914, sy + 0.5, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Left-hand Carved Cedar Folding Chest (x = 86..190, y = 1094..1176, symmetric counterpart!)
    const pose = peddlerPoseAt(melodyEvents, t, scene.leadSec, foldAwayStartSec, scene.endSec, tailSec);
    ctx.save();
    ctx.fillStyle = "#29140a";
    ctx.strokeStyle = "#d97706";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(88, 1102, 100, STAGE.counterTop - 1102, [4, 4, 0, 0]);
    ctx.fill();
    ctx.stroke();
    // Hinged chest lid opening smoothly during fold-away (`pose.foldPull`) and closing cleanly back to 0!
    ctx.translate(88, 1102);
    ctx.rotate(-0.62 * pose.foldPull);
    ctx.fillStyle = "#3b1d0e";
    ctx.beginPath();
    ctx.roundRect(0, -10, 102, 11, 4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Unwinding Raw Silk Ribbons approaching x = 540 from BOLT_X (942) at exact note duration length!
    for (const ev of melodyEvents) {
      const dur = Math.max(0.08, ev.tOff - ev.tOn);
      const headX = PEDDLER_X + (ev.tOn - t) * RIBBON_SPEED;
      const tailX = headX + dur * RIBBON_SPEED;
      const leftClamped = Math.max(PEDDLER_X, headX);
      const rightClamped = Math.min(BOLT_X, tailX);
      if (rightClamped - leftClamped < 2 || t > ev.tOff + 0.04) continue;

      const activeCut = t >= ev.tOn && t <= ev.tOff;
      ctx.save();
      const rGrad = ctx.createLinearGradient(leftClamped, ev.y - 7, rightClamped, ev.y + 7);
      rGrad.addColorStop(0, hsla(ev.hue, 0.96, activeCut ? 0.72 : 0.58, 0.96));
      rGrad.addColorStop(1, hsla(ev.hue, 0.88, 0.46, 0.9));
      ctx.fillStyle = rGrad;
      ctx.strokeStyle = activeCut ? "#fef08a" : "rgba(255,255,255,0.45)";
      ctx.lineWidth = activeCut ? 2 : 1.1;
      ctx.beginPath();
      ctx.roundRect(leftClamped, ev.y - 7, rightClamped - leftClamped, 14, 4);
      ctx.fill();
      ctx.stroke();

      if (activeCut) {
        ctx.globalCompositeOperation = "lighter";
        drawGlow(ctx, PEDDLER_X, ev.y, 68, ev.hue, 0.65, 0.22);
      }
      ctx.restore();
    }

    // Silhouetted Cloth Peddler + Engraved Brass Arshin Stick + Snapping Shears at x = 540
    drawPeddlerAndArshinStick(ctx, pose, loopPhase);

    // Polished Walnut Market Counter (y = 1176..1252) & Carved Plinth Archway
    const counterGrad = ctx.createLinearGradient(0, STAGE.counterTop, 0, STAGE.counterBottom);
    counterGrad.addColorStop(0, "#451a03");
    counterGrad.addColorStop(0.25, "#2b1206");
    counterGrad.addColorStop(1, "#170903");
    ctx.fillStyle = counterGrad;
    ctx.beginPath();
    ctx.roundRect(STAGE.left + 16, STAGE.counterTop, stageW - 32, STAGE.counterBottom - STAGE.counterTop, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.58)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Counter-front golden Tar chime inlays (1-to-1 flash for every Tar refrain/ornament note!)
    for (let k = 0; k < 13; k++) {
      const mx = lerp(240, 840, k / 12);
      ctx.fillStyle = "rgba(245, 158, 11, 0.28)";
      ctx.beginPath();
      ctx.arc(mx, STAGE.counterTop + 38, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const tev of tarEvents) {
      const st = arshinEventStateAt(tev, t);
      if (!st || st.glow <= 0.03) continue;
      drawGlow(ctx, tev.x, STAGE.counterTop + 38, 56 + 32 * st.strike, 45, 0.62 * st.glow, 0.24);
    }
    ctx.restore();

    // =========================================================================
    // 4. LOWER COURTYARD PLINTH: BRONZE BASS CORDS & NAGHARA FRAME DRUM
    // =========================================================================
    const plinthGrad = ctx.createLinearGradient(0, STAGE.counterBottom, 0, STAGE.bottom);
    plinthGrad.addColorStop(0, "#0b101e");
    plinthGrad.addColorStop(1, "#060913");
    ctx.fillStyle = plinthGrad;
    ctx.fillRect(STAGE.left, STAGE.counterBottom, stageW, STAGE.bottom - STAGE.counterBottom);

    // Carved walnut counter support pillars & recessed arcade panels (y = 1252..1376) grounding the stall
    ctx.fillStyle = "#190c06";
    ctx.fillRect(STAGE.left + 32, STAGE.counterBottom, stageW - 64, STAGE.plinthTop - STAGE.counterBottom);
    ctx.strokeStyle = "rgba(245, 158, 11, 0.28)";
    ctx.lineWidth = 1.6;
    for (const panel of [
      { l: 110, r: 356 },
      { l: 386, r: 694 },
      { l: 724, r: 970 },
    ]) {
      ctx.beginPath();
      ctx.roundRect(panel.l, STAGE.counterBottom + 14, panel.r - panel.l, STAGE.plinthTop - STAGE.counterBottom - 28, 8);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(251, 191, 36, 0.38)";
    ctx.beginPath();
    ctx.moveTo(STAGE.left + 20, STAGE.plinthTop);
    ctx.lineTo(STAGE.right - 20, STAGE.plinthTop);
    ctx.stroke();

    // 4 Symmetric Bronze Bass Cords + Bobbing Brass Weights (1-to-1 with Upright Bass notes!)
    const cordAmp = [0, 0, 0, 0];
    for (const bev of bassEvents) {
      const st = arshinEventStateAt(bev, t);
      if (!st) continue;
      cordAmp[bev.slotIndex] = Math.max(cordAmp[bev.slotIndex], st.strike, st.glow);
    }

    for (let c = 0; c < 4; c++) {
      const { x1, x2, y } = bassCordCoords(c);
      const amp = cordAmp[c];
      ctx.strokeStyle = amp > 0.04 ? hsla(36, 0.96, 0.66, 0.95) : "rgba(180, 83, 9, 0.62)";
      ctx.lineWidth = 2.8 + amp * 1.8;
      ctx.beginPath();
      if (amp > 0.03) {
        for (let sx = x1; sx <= x2; sx += 12) {
          const u = (sx - x1) / (x2 - x1);
          const wy = y + Math.sin(u * Math.PI) * Math.sin(frame * 0.6 + c) * 11 * amp;
          if (sx === x1) ctx.moveTo(sx, wy);
          else ctx.lineTo(sx, wy);
        }
      } else {
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
      }
      ctx.stroke();

      // Anchored brass loom-weight & plucking lever at midpoint
      const midX = (x1 + x2) / 2;
      const weightY = y + 18 + amp * 9;
      ctx.fillStyle = amp > 0.05 ? "#fde047" : "#b45309";
      ctx.beginPath();
      ctx.roundRect(midX - 8, weightY - 6, 16, 14, 4);
      ctx.fill();
      if (amp > 0.04) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        drawGlow(ctx, midX, y, 68, 36, 0.52 * amp, 0.24);
        ctx.restore();
      }
    }

    // Central Naghara / Daf Frame Drum at (540, 1506) (1-to-1 with Percussion notes!)
    let drumDum = 0;
    let drumTak = 0;
    for (const dev of drumEvents) {
      const st = arshinEventStateAt(dev, t);
      if (!st) continue;
      if (dev.slotIndex === 0) drumDum = Math.max(drumDum, st.strike, st.glow * 0.7);
      else drumTak = Math.max(drumTak, st.strike, st.glow * 0.7);
    }
    const drumGlow = Math.max(drumDum, drumTak);
    const drumR = 64 + 3.5 * drumDum;

    ctx.save();
    if (drumGlow > 0.03) {
      ctx.globalCompositeOperation = "lighter";
      drawGlow(ctx, NAGHARA_CX, NAGHARA_CY, drumR * 3.0, 42, 0.5 * drumGlow, 0.24);
      ctx.globalCompositeOperation = "source-over";
    }
    const headGrad = ctx.createRadialGradient(NAGHARA_CX, NAGHARA_CY, 4, NAGHARA_CX, NAGHARA_CY, drumR);
    headGrad.addColorStop(0, hsla(38, 0.55, 0.34 + 0.22 * drumDum, 0.96));
    headGrad.addColorStop(0.72, "#291811");
    headGrad.addColorStop(1, "#140c08");
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.arc(NAGHARA_CX, NAGHARA_CY, drumR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hsla(42, 0.92, 0.62, 0.65 + 0.35 * drumGlow);
    ctx.lineWidth = 4;
    ctx.stroke();

    // 8 Brass Rim Jingle Pairs (zillər) around the frame drum
    for (let j = 0; j < 8; j++) {
      const ang = (j / 8) * Math.PI * 2 + Math.PI / 8;
      const shake = drumTak * 3.5 * Math.sin(frame * 1.4 + j);
      const jx = NAGHARA_CX + Math.cos(ang) * (drumR + 2) + shake;
      const jy = NAGHARA_CY + Math.sin(ang) * (drumR + 2);
      ctx.fillStyle = drumTak > 0.08 ? "#fef08a" : "#d97706";
      ctx.beginPath();
      ctx.arc(jx, jy, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Two carved wooden Naghara beaters striking inward at exact drum onsets
    for (const side of [-1, 1] as const) {
      const hit = side < 0 ? drumDum : drumTak;
      ctx.save();
      ctx.translate(NAGHARA_CX + side * (56 - hit * 28), NAGHARA_CY + 34 - hit * 18);
      ctx.rotate(side * (-0.58 + hit * 0.34));
      ctx.strokeStyle = "#92400e";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(side * 42, 30);
      ctx.stroke();
      ctx.fillStyle = hit > 0.08 ? "#fef08a" : "#fbbf24";
      ctx.beginPath();
      ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Brass jingle sparks on drum strikes
    ctx.globalCompositeOperation = "lighter";
    for (const dev of drumEvents) {
      const age = t - dev.tOn;
      if (age < 0 || age > 0.4) continue;
      for (let k = 0; k < 8; k++) {
        const sp = jingleSparkAt(dev.seed, k, age);
        if (!sp) continue;
        drawGlow(ctx, NAGHARA_CX + sp.dx, NAGHARA_CY + sp.dy, 15, dev.hue, sp.alpha * 0.72, 0.28);
      }
    }
    ctx.restore();

    ctx.restore(); // end stage interior clip

    // Outer Stage Frame & Quiet Boteh Corner Inlays
    ctx.strokeStyle = "rgba(245, 158, 11, 0.36)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.top, stageW, STAGE.bottom - STAGE.top, 14);
    ctx.stroke();

    const cornerA = 0.46 + 0.16 * Math.sin(loopPhase);
    drawBotehInlay(ctx, STAGE.left + 26, STAGE.eavesBottom + 32, 1, 1, cornerA);
    drawBotehInlay(ctx, STAGE.right - 26, STAGE.eavesBottom + 32, -1, 1, cornerA);
    drawBotehInlay(ctx, STAGE.left + 26, STAGE.bottom - 30, 1, -1, cornerA);
    drawBotehInlay(ctx, STAGE.right - 26, STAGE.bottom - 30, -1, -1, cornerA);

    ctx.restore(); // end camera + y >= 282 clip

    drawVignette(ctx, W, H, 0.42);
    // Captions: strictly "Arshin Mal Alan" and "Uzeyir Hajibeyov, 1913" — nothing else!
    drawSceneTitle(ctx, scene, label, frame);
  };
}
