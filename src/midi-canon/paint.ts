import type { MidiPainter } from "../components/MidiShell.tsx";
import {
  accentPulse,
  buildAccents,
  cameraKick,
  clamp01,
  drawCenteredText,
  drawGlow,
  drawSceneTitle,
  drawSoft,
  drawVignette,
  hsla,
  smoothstep,
} from "../midi/kit.ts";
import { pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import {
  buildCanonLayout,
  HALF_SPAN_SEC,
  noteSpanAt,
  PX_PER_SEC,
  STAGE,
  VOICE_COUNT,
  voiceContourY,
  voiceLitStrength,
  type CanonNoteEvent,
  type VoiceSpec,
} from "./sim.ts";

function drawVoiceLane(
  ctx: CanvasRenderingContext2D,
  voice: VoiceSpec,
  voiceEvents: readonly CanonNoteEvent[],
  t: number,
  endSec: number,
  totalSec: number,
) {
  const laneW = STAGE.right - STAGE.left;
  const laneH = voice.laneBottom - voice.laneTop;
  const lit = voiceLitStrength(voice, t, endSec);
  const entryFlash = Number.isFinite(voice.firstOnsetSec) && t >= voice.firstOnsetSec
    ? Math.exp(-(t - voice.firstOnsetSec) / 0.45)
    : 0;

  // Lane card background (symmetric x = 50..1030)
  const bg = ctx.createLinearGradient(0, voice.laneTop, 0, voice.laneBottom);
  bg.addColorStop(0, hsla(voice.hue, 0.35, 0.09 + 0.04 * lit, 0.88));
  bg.addColorStop(1, hsla(voice.hue, 0.35, 0.06 + 0.03 * lit, 0.92));
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(STAGE.left, voice.laneTop, laneW, laneH, 14);
  ctx.fill();

  // Five faint musical staff lines across the lane
  ctx.strokeStyle = hsla(voice.hue, 0.35, 0.65, 0.08 + 0.08 * lit);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let s = 0; s < 5; s++) {
    const sy = voice.laneTop + 34 + ((laneH - 68) * s) / 4;
    ctx.moveTo(STAGE.left + 14, sy);
    ctx.lineTo(STAGE.right - 14, sy);
  }
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(STAGE.left, voice.laneTop, laneW, laneH, 14);
  ctx.clip();

  // Helper to render a set of shifted events (normal timeline shift = 0, plus Voice 1 loop-wrap preview at shift = totalSec)
  const renderPass = (timeShift: number) => {
    const tLocal = t - timeShift;
    // 1. Played melodic ribbon on the left half (x = 50..540) + incoming contour thread on the right (x = 540..1030)
    const stepPx = 6;
    const leftPts: Array<[number, number]> = [];
    for (let x = STAGE.left; x <= STAGE.playheadX; x += stepPx) {
      const tau = tLocal + (x - STAGE.playheadX) / PX_PER_SEC;
      const y = voiceContourY(voiceEvents, voice, tau);
      if (y !== null) leftPts.push([x, y]);
    }
    if (leftPts.length >= 2) {
      // Translucent layered curtain down to lane baseline so all five voices look rich and sculptural
      const ribGrad = ctx.createLinearGradient(STAGE.left, 0, STAGE.playheadX, 0);
      ribGrad.addColorStop(0, hsla(voice.hue, 0.9, 0.55, 0.04));
      ribGrad.addColorStop(1, hsla(voice.hue, 0.95, 0.6, 0.24));
      ctx.fillStyle = ribGrad;
      ctx.beginPath();
      ctx.moveTo(leftPts[0][0], voice.laneBottom - 12);
      for (const [px, py] of leftPts) ctx.lineTo(px, py);
      ctx.lineTo(leftPts[leftPts.length - 1][0], voice.laneBottom - 12);
      ctx.closePath();
      ctx.fill();

      // Luminous melodic contour line
      ctx.strokeStyle = hsla(voice.hue, 1, 0.72, 0.92);
      ctx.lineWidth = 3.6;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      leftPts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.stroke();
    }

    // Incoming preview contour thread on the right half (x = 540..1030)
    const rightPts: Array<[number, number]> = [];
    for (let x = STAGE.playheadX; x <= STAGE.right; x += stepPx) {
      const tau = tLocal + (x - STAGE.playheadX) / PX_PER_SEC;
      const y = voiceContourY(voiceEvents, voice, tau);
      if (y !== null) rightPts.push([x, y]);
    }
    if (rightPts.length >= 2) {
      ctx.strokeStyle = hsla(voice.hue, 0.85, 0.68, 0.34);
      ctx.lineWidth = 2;
      ctx.beginPath();
      rightPts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.stroke();
    }

    // 2. Individual MIDI note capsules (exact 1-to-1 correspondence with voiceEvents)
    let activeY: number | null = null;
    let activeVel = 0;
    let onsetAge = 99;

    for (const ev of voiceEvents) {
      if (ev.tOff < tLocal - HALF_SPAN_SEC - 0.2) continue;
      if (ev.tOn > tLocal + HALF_SPAN_SEC + 0.2) break;
      const span = noteSpanAt(ev, tLocal);
      if (!span) continue;
      const h = span.active ? 15 : 11;
      const w = Math.max(8, span.right - span.left - 2);
      const played = ev.tOff < tLocal;
      ctx.fillStyle = hsla(
        voice.hue,
        0.95,
        span.active ? 0.82 : played ? 0.62 : 0.56,
        span.active ? 0.98 : played ? 0.62 : 0.86,
      );
      ctx.beginPath();
      ctx.roundRect(span.left + 1, ev.y - h / 2, w, h, h / 2);
      ctx.fill();

      ctx.strokeStyle = hsla(voice.hue, 1, 0.9, span.active ? 0.95 : 0.45);
      ctx.lineWidth = span.active ? 2 : 1;
      ctx.stroke();

      if (span.active) {
        activeY = ev.y;
        activeVel = Math.max(activeVel, ev.vel01);
        onsetAge = Math.min(onsetAge, Math.max(0, tLocal - ev.tOn));
      }
    }

    // 3. Singing orb + harmonic ripple at x = 540 when a note sounds on the playhead
    if (activeY !== null) {
      ctx.globalCompositeOperation = "lighter";
      const burst = Math.exp(-onsetAge / 0.14);
      drawGlow(ctx, STAGE.playheadX, activeY, 68 + 44 * burst, voice.hue, 0.72 + 0.28 * burst, 0.24);
      if (onsetAge < 0.36) {
        const u = onsetAge / 0.36;
        const r = 12 + 44 * (1 - (1 - u) ** 3);
        ctx.strokeStyle = hsla(voice.hue, 1, 0.82, (1 - u) ** 1.5 * 0.85);
        ctx.lineWidth = 3 * (1 - u);
        ctx.beginPath();
        ctx.arc(STAGE.playheadX, activeY, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(STAGE.playheadX, activeY, 6.5 + 2.5 * activeVel, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  renderPass(0);
  // Seamless loop wrap: during the final 3.8 s tail, Voice 1's opening bars scroll in from the right edge to x = 672
  if (voice.index === 0 && t > totalSec - HALF_SPAN_SEC - 1.2) {
    renderPass(totalSec);
  }

  ctx.restore(); // end lane clip

  // Symmetric lane border & subtle centred voice label near top of lane
  ctx.strokeStyle = hsla(voice.hue, 0.85, 0.62, 0.2 + 0.42 * lit + 0.35 * entryFlash);
  ctx.lineWidth = 1.6 + 1.2 * lit;
  ctx.beginPath();
  ctx.roundRect(STAGE.left, voice.laneTop, laneW, laneH, 14);
  ctx.stroke();

  // Symmetric left & right lane corner tags (kept strictly inside x = 120..960 and symmetric!)
  const tagAlpha = 0.38 + 0.52 * lit;
  drawCenteredText(ctx, voice.shortLabel, voice.laneTop + 24, {
    size: 15,
    weight: 700,
    color: hsla(voice.hue, 0.85, 0.82, tagAlpha),
    maxWidth: 260,
    letterSpacing: 1.4,
    centerX: 255,
  });
  const stateLabel = lit > 0.5 ? "ACTIVE" : "WAITING";
  drawCenteredText(ctx, stateLabel, voice.laneTop + 24, {
    size: 15,
    weight: 700,
    color: hsla(voice.hue, 0.75, lit > 0.5 ? 0.8 : 0.55, tagAlpha * 0.9),
    maxWidth: 180,
    letterSpacing: 1.6,
    centerX: 825,
  });
}

export function createCanonPainter(scene: MidiSceneData, label: string): MidiPainter {
  const canon = buildCanonLayout(scene.notes);
  const accents = buildAccents(scene.notes, 0.04, 0.9, 3.4);
  const { width: W, height: H } = scene;
  const totalSec = scene.totalFrames / scene.fps;

  return (ctx, frame) => {
    const t = pieceTime(scene, frame);
    const loopPhase = (2 * Math.PI * frame) / Math.max(1, scene.totalFrames);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#060b14");
    bg.addColorStop(0.5, "#04070f");
    bg.addColorStop(1, "#070c17");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const litValues = canon.voices.map((v) => voiceLitStrength(v, t, scene.endSec));
    const litCount = Math.max(1, litValues.filter((v) => v >= 0.5).length);
    const tutti = smoothstep(4.2, 5.0, litValues.reduce((a, b) => a + b, 0));

    const kick = cameraKick(accents, t, 0.65);
    const pulse = accentPulse(accents, t, 0.22);

    ctx.save();
    const cx = 540;
    const cy = 940;
    ctx.translate(cx + kick.dx * 0.5, cy + kick.dy * 0.5);
    ctx.scale(1 + kick.zoom * 0.7, 1 + kick.zoom * 0.7);
    ctx.translate(-cx, -cy);

    // Symmetric ambient glow pools growing richer as more voices enter
    ctx.globalCompositeOperation = "lighter";
    drawSoft(ctx, 260 + 25 * Math.sin(loopPhase), 880, 1300, 196, 0.1 + 0.14 * (litCount / 5));
    drawSoft(ctx, 820 - 25 * Math.sin(loopPhase), 880, 1300, 156 + 160 * tutti, 0.1 + 0.14 * (litCount / 5));
    if (tutti > 0.05) {
      drawSoft(ctx, 540, 960, 1600, 72, 0.16 * tutti + 0.08 * Math.min(1, pulse));
    }
    ctx.globalCompositeOperation = "source-over";

    // --- 1. Draw All Five Voice Lanes (x = 50..1030, y = 368..1590) ---
    for (let v = 0; v < VOICE_COUNT; v++) {
      drawVoiceLane(ctx, canon.voices[v], canon.byVoice[v], t, scene.endSec, totalSec);
    }

    // --- 2. Central Vertical Playhead String (x = 540, spanning all 5 lanes) ---
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const lineGrad = ctx.createLinearGradient(0, STAGE.lanesTop, 0, STAGE.bottom);
    lineGrad.addColorStop(0, "rgba(200, 255, 0, 0.25)");
    lineGrad.addColorStop(0.5, `rgba(241, 245, 249, ${(0.55 + 0.3 * tutti).toFixed(3)})`);
    lineGrad.addColorStop(1, "rgba(56, 189, 248, 0.25)");
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2.5 + 1.5 * tutti;
    ctx.beginPath();
    ctx.moveTo(STAGE.playheadX, STAGE.lanesTop - 4);
    ctx.lineTo(STAGE.playheadX, STAGE.bottom + 4);
    ctx.stroke();
    ctx.restore();

    // --- 3. Top "VOICES: 1 2 3 4 5" Indicator Header (x = 50..1030, y = 290..356) ---
    const hudW = STAGE.right - STAGE.left;
    const hudH = STAGE.hudBottom - STAGE.top;
    ctx.fillStyle = "rgba(12, 19, 34, 0.93)";
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.top, hudW, hudH, 12);
    ctx.fill();
    ctx.strokeStyle = tutti > 0.5 ? "rgba(200, 255, 0, 0.65)" : "rgba(148, 163, 184, 0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Symmetric left & right labels around the 5 voice pills
    drawCenteredText(ctx, "VOICES", STAGE.top + 41, {
      size: 20,
      weight: 800,
      color: "#cbd5e1",
      maxWidth: 160,
      letterSpacing: 2,
      centerX: 215,
    });
    drawCenteredText(ctx, tutti > 0.6 ? "ALL 5 TOGETHER" : `${litCount} OF 5 ACTIVE`, STAGE.top + 41, {
      size: 19,
      weight: 800,
      color: tutti > 0.6 ? "#c8ff00" : "#94a3b8",
      maxWidth: 200,
      letterSpacing: 1.2,
      centerX: 865,
    });

    // Five numbered pills at x = 400, 470, 540, 610, 680 (exact mirror symmetry about x = 540)
    const pillW = 54;
    const pillH = 40;
    const pillTop = STAGE.top + (hudH - pillH) / 2;
    for (let v = 0; v < VOICE_COUNT; v++) {
      const voice = canon.voices[v];
      const px = 540 + (v - 2) * 70;
      const lit = litValues[v];
      if (lit > 0.05) {
        ctx.globalCompositeOperation = "lighter";
        drawGlow(ctx, px, pillTop + pillH / 2, 74, voice.hue, 0.42 * lit);
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.fillStyle = lit > 0.1
        ? hsla(voice.hue, 0.92, 0.48, 0.25 + 0.7 * lit)
        : "rgba(30, 41, 59, 0.7)";
      ctx.beginPath();
      ctx.roundRect(px - pillW / 2, pillTop, pillW, pillH, 10);
      ctx.fill();
      ctx.strokeStyle = lit > 0.1 ? hsla(voice.hue, 1, 0.76, 0.95) : "rgba(100, 116, 139, 0.45)";
      ctx.lineWidth = lit > 0.1 ? 2.2 : 1.4;
      ctx.stroke();

      drawCenteredText(ctx, String(v + 1), pillTop + 28, {
        size: 23,
        weight: 800,
        color: lit > 0.3 ? "#ffffff" : "#64748b",
        maxWidth: 44,
        centerX: px,
      });
    }

    ctx.restore(); // end camera transform

    drawVignette(ctx, W, H, 0.4);
    drawSceneTitle(ctx, scene, label, frame);
  };
}
