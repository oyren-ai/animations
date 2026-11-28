import type { MidiPainter } from "../components/MidiShell.tsx";
import {
  accentPulse,
  buildAccents,
  cameraKick,
  clamp01,
  drawGlow,
  drawSceneTitle,
  drawSoft,
  drawVignette,
  hsla,
  lerp,
} from "../midi/kit.ts";
import { pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import {
  buildKalimbaPlan,
  kalimbaProgressAt,
  kalimbaSectionLabelAt,
  pluckedCountAt,
  soundholeEnergyAt,
  STAGE,
  thumbPoseAt,
  THUMBS,
  tineMotionAt,
  type KalimbaPluck,
  type KalimbaTine,
  type ThumbPose,
  type ThumbSpec,
  type TineMotion,
} from "./sim.ts";

export const KALIMBA_DISPLAY_TITLE = "Dance of the Sugar Plum Fairy";

function drawProgressRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, progress: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.28)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (progress > 0.002) {
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * progress;
    ctx.strokeStyle = progress > 0.55 ? "#c8ff00" : "#fbbf24";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();

    const tipX = cx + Math.cos(end) * radius;
    const tipY = cy + Math.sin(end) * radius;
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, tipX, tipY, 24, progress > 0.55 ? 74 : 42, 0.72);
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMahoganyBody(ctx: CanvasRenderingContext2D, holeEnergy: number, plucks: readonly KalimbaPluck[], t: number) {
  const { bodyLeft: L, bodyRight: R, bodyTop: T, bodyBottom: B, soundholeX: cx, soundholeY: cy, soundholeR: sr } = STAGE;
  const W = R - L;
  const H = B - T;

  ctx.save();

  // Outer carved mahogany soundbox silhouette (subtle acoustic shoulder contour centred on x = 540)
  const bodyPath = () => {
    ctx.beginPath();
    ctx.roundRect(L, T, W, H, [52, 52, 86, 86]);
  };

  // Warm drop glow behind body
  ctx.globalCompositeOperation = "lighter";
  drawSoft(ctx, 540, 960, 560, 34, 0.08 + 0.06 * holeEnergy);
  ctx.globalCompositeOperation = "source-over";

  // Rich satin mahogany wood gradient
  const wood = ctx.createLinearGradient(L, T, R, B);
  wood.addColorStop(0, "#4e2112");
  wood.addColorStop(0.28, "#6a2e18");
  wood.addColorStop(0.5, "#552312");
  wood.addColorStop(0.76, "#3a160b");
  wood.addColorStop(1, "#230c05");
  bodyPath();
  ctx.fillStyle = wood;
  ctx.fill();

  // Subtle book-matched vertical mahogany grain & sheen inside the body clip
  ctx.save();
  bodyPath();
  ctx.clip();

  for (let i = -14; i <= 14; i++) {
    const gx = 540 + i * 31;
    const alpha = 0.035 + (Math.abs(i) % 3) * 0.018;
    ctx.strokeStyle = i % 2 === 0 ? `rgba(255, 196, 140, ${alpha.toFixed(3)})` : `rgba(12, 4, 2, ${(alpha * 1.5).toFixed(3)})`;
    ctx.lineWidth = i % 3 === 0 ? 5 : 2.2;
    ctx.beginPath();
    ctx.moveTo(gx, T);
    ctx.bezierCurveTo(gx + Math.sin(i * 0.9) * 8, T + H * 0.35, gx - Math.sin(i * 0.9) * 8, T + H * 0.7, gx, B);
    ctx.stroke();
  }

  // Satin top highlight across upper soundboard
  const sheen = ctx.createRadialGradient(540, 620, 60, 540, 820, 520);
  sheen.addColorStop(0, `rgba(253, 211, 150, ${(0.12 + 0.06 * holeEnergy).toFixed(3)})`);
  sheen.addColorStop(0.6, "rgba(253, 211, 150, 0.03)");
  sheen.addColorStop(1, "rgba(0, 0, 0, 0.28)");
  ctx.fillStyle = sheen;
  ctx.fillRect(L, T, W, H);
  ctx.restore();

  // Outer carved bevel & cream-gold purfling border inlay
  bodyPath();
  ctx.strokeStyle = "rgba(253, 224, 158, 0.42)";
  ctx.lineWidth = 2.4;
  ctx.stroke();

  ctx.beginPath();
  ctx.roundRect(L + 14, T + 14, W - 28, H - 28, [42, 42, 74, 74]);
  ctx.strokeStyle = "rgba(251, 191, 36, 0.22)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Central carved circular acoustic soundhole & inlaid rosette
  // Outer rosette decorative rings
  ctx.strokeStyle = "rgba(253, 230, 138, 0.48)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, sr + 16, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = `rgba(200, 255, 0, ${(0.22 + 0.45 * holeEnergy).toFixed(3)})`;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(cx, cy, sr + 9, 0, Math.PI * 2);
  ctx.stroke();

  // Deep acoustic cavity interior
  const holeGrad = ctx.createRadialGradient(cx, cy - 18, 12, cx, cy, sr);
  holeGrad.addColorStop(0, "#120906");
  holeGrad.addColorStop(0.75, "#070302");
  holeGrad.addColorStop(1, "#020101");
  ctx.fillStyle = holeGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, sr, 0, Math.PI * 2);
  ctx.fill();

  // Warm resonance bloom inside the soundhole driven by active plucks
  if (holeEnergy > 0.03) {
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, cx, cy, sr * (1.1 + 0.45 * holeEnergy), 56, 0.48 * holeEnergy);
    ctx.globalCompositeOperation = "source-over";
  }

  // Concentric acoustic pressure ripples radiating outward from the circular soundhole on every pluck!
  const endIdx = pluckedCountAt(plucks, t);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = endIdx - 1; i >= Math.max(0, endIdx - 10); i--) {
    const p = plucks[i];
    const age = t - p.tOn;
    if (age < 0 || age > 0.65) continue;
    const prog = age / 0.65;
    const rad = sr * 0.42 + prog * (sr * 1.45);
    const alpha = (1 - prog) * (1 - prog) * (0.28 + 0.3 * p.vel01);
    ctx.strokeStyle = hsla(p.hue, 0.92, 0.72, alpha);
    ctx.lineWidth = lerp(2.8, 0.9, prog);
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Soundhole carved wood inner rim edge
  ctx.strokeStyle = "rgba(180, 118, 68, 0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, sr, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawPressureBarAndBridge(
  ctx: CanvasRenderingContext2D,
  barY: number,
  bridgeY: number,
  spanLeft: number,
  spanRight: number,
  screwCount: number,
  isBrass: boolean,
) {
  ctx.save();
  const w = spanRight - spanLeft;

  // Carved walnut rear saddle & front bridge bolster
  const woodGrad = ctx.createLinearGradient(0, bridgeY - 12, 0, bridgeY + 12);
  woodGrad.addColorStop(0, "#3d1a0b");
  woodGrad.addColorStop(0.5, "#260f06");
  woodGrad.addColorStop(1, "#120602");
  ctx.fillStyle = woodGrad;
  ctx.beginPath();
  ctx.roundRect(spanLeft - 10, bridgeY - 8, w + 20, 16, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(253, 224, 158, 0.25)";
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // Bolted steel / brushed-brass z-bar clamping the tines
  const barGrad = ctx.createLinearGradient(0, barY - 14, 0, barY + 14);
  if (isBrass) {
    barGrad.addColorStop(0, "#855821");
    barGrad.addColorStop(0.35, "#f7d486");
    barGrad.addColorStop(0.68, "#b37c2e");
    barGrad.addColorStop(1, "#4a2e0d");
  } else {
    barGrad.addColorStop(0, "#515f70");
    barGrad.addColorStop(0.35, "#e2ecf5");
    barGrad.addColorStop(0.68, "#8c9eb0");
    barGrad.addColorStop(1, "#2d3743");
  }
  ctx.fillStyle = barGrad;
  ctx.beginPath();
  ctx.roundRect(spanLeft, barY - 12, w, 24, 7);
  ctx.fill();
  ctx.strokeStyle = "rgba(10, 14, 20, 0.72)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Symmetric slotted mounting screws
  for (let i = 0; i < screwCount; i++) {
    const sx = lerp(spanLeft + 26, spanRight - 26, i / Math.max(1, screwCount - 1));
    ctx.fillStyle = "#1e2530";
    ctx.beginPath();
    ctx.arc(sx, barY, 7.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isBrass ? "#fde68a" : "#cbd5e1";
    ctx.beginPath();
    ctx.arc(sx, barY, 5.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#18202a";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(sx - 3.6, barY - 2.2);
    ctx.lineTo(sx + 3.6, barY + 2.2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawSpringSteelTine(ctx: CanvasRenderingContext2D, tine: KalimbaTine, motion: TineMotion) {
  const { x, width: w, bridgeY, tipY, hue } = tine;
  const hw = w * 0.5;
  const bend = motion.preloadPx + motion.oscPx; // positive = bent downward
  const curTipY = tipY + bend * 0.45;
  const vibSpread = motion.vibEnv * 7.5;
  const glow = motion.glow;

  ctx.save();

  // 1. Cast shadow on mahogany soundboard (shifts closer when thumb presses the tine downward!)
  const shadowDrop = Math.max(2, 9 - motion.preloadPx * 0.45);
  ctx.fillStyle = "rgba(6, 2, 1, 0.44)";
  ctx.beginPath();
  ctx.roundRect(x - hw + 3, bridgeY + 2, w, curTipY - bridgeY + shadowDrop, [2, 2, hw, hw]);
  ctx.fill();

  // 2. High-frequency vibrating steel cantilever ghost envelope when ringing after release
  if (vibSpread > 0.6) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const dir of [-1, 1] as const) {
      ctx.fillStyle = hsla(hue, 0.9, 0.76, 0.24 * motion.vibEnv);
      ctx.beginPath();
      ctx.moveTo(x - hw, bridgeY);
      ctx.lineTo(x + hw, bridgeY);
      ctx.quadraticCurveTo(x + hw + dir * vibSpread * 0.45, (bridgeY + curTipY) * 0.5, x + hw + dir * vibSpread, curTipY - hw);
      ctx.arc(x + dir * vibSpread, curTipY - hw, hw, 0, Math.PI, false);
      ctx.quadraticCurveTo(x - hw + dir * vibSpread * 0.45, (bridgeY + curTipY) * 0.5, x - hw, bridgeY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 3. Spring-steel tine body (curved slightly sideways on oscillation, compressed when thumb-loaded)
  const tipShiftX = motion.oscPx * 0.38;
  const tinePath = () => {
    ctx.beginPath();
    ctx.moveTo(x - hw, bridgeY - 4);
    ctx.lineTo(x + hw, bridgeY - 4);
    ctx.quadraticCurveTo(x + hw + tipShiftX * 0.35, lerp(bridgeY, curTipY, 0.58), x + hw + tipShiftX, curTipY - hw);
    ctx.arc(x + tipShiftX, curTipY - hw, hw, 0, Math.PI, false);
    ctx.quadraticCurveTo(x - hw + tipShiftX * 0.35, lerp(bridgeY, curTipY, 0.58), x - hw, bridgeY - 4);
    ctx.closePath();
  };

  const steel = ctx.createLinearGradient(x - hw, 0, x + hw, 0);
  if (glow > 0.04) {
    steel.addColorStop(0, hsla(hue - 10, 0.55, lerp(0.42, 0.56, glow), 1));
    steel.addColorStop(0.38, hsla(hue, 0.94, lerp(0.74, 0.92, glow), 1));
    steel.addColorStop(0.72, hsla(hue - 6, 0.75, lerp(0.55, 0.72, glow), 1));
    steel.addColorStop(1, "#334155");
  } else if (motion.preloadPx > 0.5) {
    // Slightly darkened under thumb tension right before release
    steel.addColorStop(0, "#475569");
    steel.addColorStop(0.4, "#cbd5e1");
    steel.addColorStop(0.75, "#94a3b8");
    steel.addColorStop(1, "#334155");
  } else {
    steel.addColorStop(0, "#5c6b7c");
    steel.addColorStop(0.38, "#e6eef6");
    steel.addColorStop(0.72, "#9aaaba");
    steel.addColorStop(1, "#364150");
  }
  tinePath();
  ctx.fillStyle = steel;
  ctx.fill();

  ctx.strokeStyle = glow > 0.05 ? "#fef08a" : "rgba(15, 23, 42, 0.72)";
  ctx.lineWidth = glow > 0.05 ? 1.7 : 1.1;
  ctx.stroke();

  // Bent ergonomic tip ridge glint
  ctx.strokeStyle = glow > 0.05 ? "#ffffff" : "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - hw * 0.58 + tipShiftX, curTipY - hw * 0.7);
  ctx.lineTo(x + hw * 0.58 + tipShiftX, curTipY - hw * 0.7);
  ctx.stroke();

  // Etched pitch stamp near tine tip
  ctx.fillStyle = glow > 0.08 ? "#0b141a" : "rgba(15, 23, 42, 0.74)";
  ctx.font = `700 ${tine.accidental ? 11 : 12}px "Inter Variable", Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(tine.label, x + tipShiftX, curTipY - hw - 14);

  // Luminous pluck spark & metallic shimmer halo at tine tip right after snap release
  if (glow > 0.05) {
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, x + tipShiftX, curTipY - hw * 0.5, 24 + 26 * glow, hue, 0.65 * glow);
    if (motion.age >= 0 && motion.age < 0.34) {
      const r = 8 + motion.age * 105;
      ctx.strokeStyle = hsla(hue, 0.96, 0.78, 0.55 * (1 - motion.age / 0.34));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + tipShiftX, curTipY - hw * 0.5, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.restore();
}

function drawPluckingThumb(ctx: CanvasRenderingContext2D, spec: ThumbSpec, pose: ThumbPose) {
  const { tipX, tipY, lift, flick } = pose;
  const dx = tipX - spec.pivotX;
  const dy = tipY - spec.pivotY;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;

  // Lift gently elevates the thumb off the tines with cast shadow underneath
  const shadowOff = 6 + lift * 16;

  ctx.save();
  ctx.lineCap = "round";

  // 1. Cast shadow on soundbox
  ctx.strokeStyle = `rgba(5, 2, 1, ${(0.34 - lift * 0.14).toFixed(3)})`;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(spec.pivotX + 6, spec.pivotY + 6);
  ctx.lineTo(tipX + shadowOff * 0.45, tipY + shadowOff);
  ctx.stroke();

  // 2. Articulated walnut-and-brass mechanical plucking arm
  const armGrad = ctx.createLinearGradient(spec.pivotX, spec.pivotY, tipX, tipY);
  armGrad.addColorStop(0, "#3b1b0d");
  armGrad.addColorStop(0.6, "#854d27");
  armGrad.addColorStop(0.88, "#d4a44e");
  armGrad.addColorStop(1, spec.pickColor);
  ctx.strokeStyle = armGrad;
  ctx.lineWidth = 8.5;
  ctx.beginPath();
  ctx.moveTo(spec.pivotX, spec.pivotY);
  ctx.lineTo(tipX - ux * 16, tipY - uy * 16);
  ctx.stroke();

  // Slim specular highlight along arm
  ctx.strokeStyle = "rgba(255, 245, 215, 0.36)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(spec.pivotX, spec.pivotY);
  ctx.lineTo(tipX - ux * 18, tipY - uy * 18);
  ctx.stroke();

  // Brass pivot joint mount on lower mahogany frame
  ctx.fillStyle = "#1c120a";
  ctx.beginPath();
  ctx.arc(spec.pivotX, spec.pivotY, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d99b38";
  ctx.beginPath();
  ctx.arc(spec.pivotX, spec.pivotY, 8.2, 0, Math.PI * 2);
  ctx.fill();

  // 3. Sculpted thumb-pick head with brass ferrule & luminous accent
  const headR = lerp(13.5, 15.5, lift);
  ctx.fillStyle = "#080d14";
  ctx.beginPath();
  ctx.arc(tipX, tipY, headR + 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = spec.pickColor;
  ctx.beginPath();
  ctx.arc(tipX, tipY, headR, 0, Math.PI * 2);
  ctx.fill();

  // Crisp highlight crescent on pick tip
  ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
  ctx.beginPath();
  ctx.arc(tipX - 3.5, tipY - 3.5, headR * 0.36, 0, Math.PI * 2);
  ctx.fill();

  if (flick > 0.08) {
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, tipX, tipY, 26 + 22 * flick, spec.glowHue, 0.6 * flick);
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.restore();
}

export function createKalimbaPainter(scene: MidiSceneData, label: string): MidiPainter {
  const plan = buildKalimbaPlan(scene.notes);
  const accents = buildAccents(scene.notes, 0.045, 0.8, 3.0);
  const tailSec = scene.totalFrames / scene.fps - scene.leadSec - scene.endSec;

  return (ctx, frame) => {
    const { width: W, height: H } = scene;
    const t = pieceTime(scene, frame);
    const pulse = accentPulse(accents, t, 0.25);
    const kick = cameraKick(accents, t, 0.32);
    const progress = kalimbaProgressAt(t, scene.endSec, tailSec);
    const holeEnergy = soundholeEnergyAt(plan.plucks, t);

    // 1. Deep ink concert backdrop
    ctx.fillStyle = "#04070d";
    ctx.fillRect(0, 0, W, H);
    drawSoft(ctx, 540, 940, 740, 38, 0.06 + 0.045 * holeEnergy + 0.03 * pulse);
    drawVignette(ctx, W, H, 0.62);

    // 2. Subtle camera breathing centred on (540, 940)
    ctx.save();
    ctx.translate(540 + kick.dx * 0.4, 940 + kick.dy * 0.4);
    ctx.rotate(kick.rotation * 0.3);
    ctx.scale(1 + kick.zoom * 0.48, 1 + kick.zoom * 0.48);
    ctx.translate(-540, -940);

    // 3. Stage card + HUD header (y = 290..366)
    ctx.save();
    ctx.fillStyle = "rgba(9, 13, 21, 0.9)";
    ctx.strokeStyle = "rgba(251, 191, 36, 0.28)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.top, STAGE.right - STAGE.left, STAGE.bottom - STAGE.top, 20);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(251, 191, 36, 0.2)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(STAGE.left, STAGE.hudBottom);
    ctx.lineTo(STAGE.right, STAGE.hudBottom);
    ctx.stroke();

    const plucked = pluckedCountAt(plan.plucks, t);
    const padN = String(plan.plucks.length).length;
    ctx.font = '600 23px ui-monospace, "JetBrains Mono", monospace';
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#fde68a";
    ctx.fillText(`PLUCKS  ${String(plucked).padStart(padN, "0")} / ${plan.plucks.length}`, STAGE.left + 28, (STAGE.top + STAGE.hudBottom) / 2);

    drawProgressRing(ctx, 540, (STAGE.top + STAGE.hudBottom) / 2, 18, progress);

    ctx.textAlign = "right";
    ctx.fillStyle = progress > 0.65 ? "#c8ff00" : "#fbbf24";
    ctx.fillText(kalimbaSectionLabelAt(t, scene.endSec), STAGE.right - 28, (STAGE.top + STAGE.hudBottom) / 2);
    ctx.restore();

    // 4. Carved mahogany soundbox + central circular soundhole + acoustic ripples
    drawMahoganyBody(ctx, holeEnergy, plan.plucks, t);

    // 5. Upper chromatic rank (13 sharp/flat spring-steel tines + raised brass bar)
    drawPressureBarAndBridge(ctx, STAGE.upperBarY, STAGE.upperBridgeY, 168, 912, 5, true);
    for (const tine of plan.accidentalTines) {
      const m = tineMotionAt(tine, plan.byTine[tine.index], t);
      drawSpringSteelTine(ctx, tine, m);
    }

    // 6. Lower diatonic rank (19 natural spring-steel tines in symmetric V-fan + main bolted steel bar)
    drawPressureBarAndBridge(ctx, STAGE.mainBarY, STAGE.mainBridgeY, 122, 958, 5, false);
    for (const tine of plan.naturalTines) {
      const m = tineMotionAt(tine, plan.byTine[tine.index], t);
      drawSpringSteelTine(ctx, tine, m);
    }

    // 7. Four articulated plucking thumbs bending & snapping each tine on the beat
    for (const spec of THUMBS) {
      const pose = thumbPoseAt(spec, plan.byThumb[spec.id], t, scene.endSec, tailSec);
      drawPluckingThumb(ctx, spec, pose);
    }

    ctx.restore();

    // 8. Framing-standard title block cleanly below top OYREN wordmark
    drawSceneTitle(ctx, { ...scene, title: KALIMBA_DISPLAY_TITLE }, label, frame);
  };
}
