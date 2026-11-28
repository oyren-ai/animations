import type { MidiPainter } from "../components/MidiShell.tsx";
import {
  accentPulse,
  buildAccents,
  cameraKick,
  drawCenteredText,
  drawGlow,
  drawSceneTitle,
  drawSoft,
  drawVignette,
  hsla,
} from "../midi/kit.ts";
import { pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import {
  bellMotionAt,
  bellSparkAt,
  buildCarillonPlan,
  carillonProgressAt,
  haloEnergyAt,
  pealedCountAt,
  STAGE,
  type BellMotion,
  type BellStrike,
  type CarillonBell,
} from "./sim.ts";

export const CARILLON_DISPLAY_TITLE = "Ode to Joy";

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
    ctx.strokeStyle = progress > 0.6 ? "#c8ff00" : "#f59e0b";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();

    const tipX = cx + Math.cos(end) * radius;
    const tipY = cy + Math.sin(end) * radius;
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, tipX, tipY, 24, progress > 0.6 ? 74 : 42, 0.72);
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBelfryArchitecture(ctx: CanvasRenderingContext2D, haloEnergy: number, pulse: number) {
  ctx.save();
  const left = STAGE.belfryLeft;
  const right = STAGE.belfryRight;
  const top = STAGE.hudBottom + 14;
  const bot = STAGE.bottom - 14;
  const w = right - left;

  // Clip architectural belfry interior inside symmetric stage card.
  ctx.beginPath();
  ctx.roundRect(left, top, w, bot - top, 16);
  ctx.clip();

  // Midnight sky-vault behind the belfry louvers.
  const sky = ctx.createLinearGradient(0, top, 0, bot);
  sky.addColorStop(0, "#071020");
  sky.addColorStop(0.55, "#0b1424");
  sky.addColorStop(1, "#121010");
  ctx.fillStyle = sky;
  ctx.fillRect(left, top, w, bot - top);

  // Subtle symmetric gothic stone lancet windows & louvers behind the bells.
  for (const offsetX of [-290, 0, 290]) {
    const lx = 540 + offsetX;
    const lw = offsetX === 0 ? 250 : 210;
    const lTop = top + (offsetX === 0 ? 22 : 48);
    const lBot = STAGE.ropeRailY - 24;
    ctx.fillStyle = `rgba(251, 191, 36, ${(0.03 + 0.055 * haloEnergy + 0.03 * pulse).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(lx - lw / 2, lBot);
    ctx.lineTo(lx - lw / 2, lTop + 95);
    ctx.quadraticCurveTo(lx - lw / 2, lTop + 20, lx, lTop);
    ctx.quadraticCurveTo(lx + lw / 2, lTop + 20, lx + lw / 2, lTop + 95);
    ctx.lineTo(lx + lw / 2, lBot);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(148, 175, 204, 0.16)";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Horizontal belfry louver slats.
    ctx.strokeStyle = "rgba(148, 175, 204, 0.07)";
    ctx.lineWidth = 1;
    for (let ly = lTop + 105; ly < lBot; ly += 28) {
      ctx.beginPath();
      ctx.moveTo(lx - lw / 2 + 10, ly);
      ctx.lineTo(lx + lw / 2 - 10, ly);
      ctx.stroke();
    }
  }

  // Warm lantern uplight glowing from the stone belfry floor.
  const floorGlow = ctx.createRadialGradient(540, bot, 40, 540, bot - 80, 520);
  floorGlow.addColorStop(0, `rgba(245, 158, 11, ${(0.18 + 0.1 * haloEnergy + 0.06 * pulse).toFixed(3)})`);
  floorGlow.addColorStop(0.6, `rgba(200, 255, 0, ${(0.04 + 0.04 * haloEnergy).toFixed(3)})`);
  floorGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = floorGlow;
  ctx.fillRect(left, top, w, bot - top);

  // Symmetric carved stone side piers.
  for (const side of [-1, 1] as const) {
    const px = side < 0 ? left : right - 22;
    const stone = ctx.createLinearGradient(px, 0, px + 22, 0);
    stone.addColorStop(0, "#121a26");
    stone.addColorStop(0.5, "#1f2c3d");
    stone.addColorStop(1, "#0d131c");
    ctx.fillStyle = stone;
    ctx.fillRect(px, top, 22, bot - top);
  }

  // Three heavy riveted oak belfry cross-beams supporting the three bell tiers.
  for (const beamY of [STAGE.topBeamY, STAGE.midBeamY, STAGE.botBeamY]) {
    const bTop = beamY - 22;
    const bH = 24;
    const oak = ctx.createLinearGradient(0, bTop, 0, bTop + bH);
    oak.addColorStop(0, "#4e2d16");
    oak.addColorStop(0.45, "#331b0b");
    oak.addColorStop(1, "#1a0d05");
    ctx.fillStyle = oak;
    ctx.fillRect(left + 14, bTop, w - 28, bH);
    ctx.fillStyle = "rgba(253, 230, 138, 0.2)";
    ctx.fillRect(left + 14, bTop, w - 28, 1.5);
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(left + 14, bTop + bH, w - 28, 4);

    // Forged iron beam brackets at both stone piers.
    for (const bx of [left + 20, right - 34]) {
      ctx.fillStyle = "#334155";
      ctx.fillRect(bx, bTop - 3, 14, bH + 6);
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(bx + 7, bTop + bH / 2, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Lower brass bell-rope ringing gallery bar.
  const railGrad = ctx.createLinearGradient(0, STAGE.ropeRailY - 7, 0, STAGE.ropeRailY + 7);
  railGrad.addColorStop(0, "#fde68a");
  railGrad.addColorStop(0.5, "#b45309");
  railGrad.addColorStop(1, "#451a03");
  ctx.fillStyle = railGrad;
  ctx.beginPath();
  ctx.roundRect(left + 24, STAGE.ropeRailY - 6, w - 48, 12, 6);
  ctx.fill();

  ctx.restore();
}

function drawBellRopes(
  ctx: CanvasRenderingContext2D,
  bells: readonly CarillonBell[],
  motions: readonly BellMotion[],
) {
  ctx.save();
  // Draw braided pull ropes behind the bells, descending from each headstock wheel to the lower brass rail.
  for (const bell of bells) {
    const m = motions[bell.index];
    const ropeX = bell.x + (bell.tier === 0 ? -bell.mouthW * 0.28 : bell.tier === 1 ? bell.mouthW * 0.28 : -bell.mouthW * 0.24);
    const startY = bell.pivotY - 4;
    const endY = STAGE.ropeRailY;

    // Subtle braided rope strand (brightens gently when pulled).
    ctx.strokeStyle = m.ropePullPx > 2
      ? "rgba(253, 230, 138, 0.62)"
      : "rgba(180, 152, 114, 0.22)";
    ctx.lineWidth = m.ropePullPx > 2 ? 2.4 : 1.5;
    ctx.beginPath();
    ctx.moveTo(ropeX, startY);
    ctx.lineTo(ropeX, endY);
    ctx.stroke();

    // Woollen sally grip near the bottom ringing gallery (moves down visibly with ropePullPx!).
    const sallyY = STAGE.ropeRailY - 48 + m.ropePullPx;
    ctx.strokeStyle = m.glow > 0.2 ? "#c8ff00" : bell.tier === 1 ? "#f59e0b" : "#94a3b8";
    ctx.lineWidth = 4.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ropeX, sallyY - 11);
    ctx.lineTo(ropeX, sallyY + 11);
    ctx.stroke();

    // Brass grommet ring on the lower rail.
    ctx.fillStyle = "#fcd34d";
    ctx.beginPath();
    ctx.arc(ropeX, endY, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = "butt";
  ctx.restore();
}

function drawCastBronzeBell(ctx: CanvasRenderingContext2D, bell: CarillonBell, m: BellMotion) {
  const w = bell.mouthW;
  const h = bell.bellH;
  const halfW = w / 2;

  ctx.save();
  ctx.translate(bell.x, bell.pivotY);

  // Fixed wrought-iron mounting pin on the timber beam.
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.roundRect(-12, -16, 24, 18, 4);
  ctx.fill();

  // Rotate headstock + bell shell around the pivot axis!
  ctx.rotate(m.angle);

  // Heavy oak headstock yoke gripping the crown of the bell.
  const yokeW = w * 0.56;
  ctx.fillStyle = "#3f220e";
  ctx.strokeStyle = "#0b0806";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.roundRect(-yokeW / 2, -10, yokeW, 18, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.arc(0, -1, 4.2, 0, Math.PI * 2);
  ctx.fill();

  // Hanging brass clapper (drawn before front rim lip so it swings visibly inside the bell mouth!).
  ctx.save();
  ctx.rotate(m.clapperAngle - m.angle * 0.45);
  ctx.strokeStyle = "#92400e";
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.22);
  ctx.lineTo(0, h * 0.92);
  ctx.stroke();

  const ballR = Math.max(6.5, w * 0.115);
  const ballGrad = ctx.createRadialGradient(-2, h * 0.92 - 2, 1, 0, h * 0.92, ballR);
  ballGrad.addColorStop(0, m.glow > 0.25 ? "#ffffff" : "#fef08a");
  ballGrad.addColorStop(0.55, "#f59e0b");
  ballGrad.addColorStop(1, "#78350f");
  ctx.fillStyle = ballGrad;
  ctx.beginPath();
  ctx.arc(0, h * 0.92, ballR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#120904";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();

  // Sculpted European tower bell silhouette (crown -> concave waist -> flared sound-bow rim).
  const bellPath = () => {
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.34, 8);
    ctx.quadraticCurveTo(0, 2, halfW * 0.34, 8);
    ctx.bezierCurveTo(halfW * 0.54, h * 0.22, halfW * 0.58, h * 0.58, halfW, h * 0.86);
    ctx.lineTo(halfW * 0.96, h * 0.91);
    ctx.quadraticCurveTo(0, h * 0.96, -halfW * 0.96, h * 0.91);
    ctx.lineTo(-halfW, h * 0.86);
    ctx.bezierCurveTo(-halfW * 0.58, h * 0.58, -halfW * 0.54, h * 0.22, -halfW * 0.34, 8);
    ctx.closePath();
  };

  // Dark outer casing for razor-sharp contrast against the midnight belfry.
  bellPath();
  ctx.lineWidth = 4.2;
  ctx.strokeStyle = "#04080e";
  ctx.stroke();

  // 3D cylindrical burnished cast-bronze shading.
  const bronzeGrad = ctx.createLinearGradient(-halfW, 0, halfW, 0);
  if (bell.tier === 2) {
    // Deep antique bourdon bronze
    bronzeGrad.addColorStop(0, "#2b190b");
    bronzeGrad.addColorStop(0.26, "#7c4a1a");
    bronzeGrad.addColorStop(0.46, "#e6b85c");
    bronzeGrad.addColorStop(0.68, "#8c5319");
    bronzeGrad.addColorStop(1, "#221207");
  } else if (bell.tier === 1) {
    // Rich golden-bronze melody bell
    bronzeGrad.addColorStop(0, "#38200c");
    bronzeGrad.addColorStop(0.28, "#a6631c");
    bronzeGrad.addColorStop(0.47, "#fde08d");
    bronzeGrad.addColorStop(0.7, "#9a5916");
    bronzeGrad.addColorStop(1, "#261407");
  } else {
    // Bright gleaming treble bell
    bronzeGrad.addColorStop(0, "#42270e");
    bronzeGrad.addColorStop(0.28, "#c27c22");
    bronzeGrad.addColorStop(0.48, "#fef3c7");
    bronzeGrad.addColorStop(0.72, "#b46b1a");
    bronzeGrad.addColorStop(1, "#2c1708");
  }
  ctx.fillStyle = bronzeGrad;
  ctx.fill();

  // Decorative cast sound-bow rings around shoulder & waist.
  ctx.save();
  bellPath();
  ctx.clip();
  ctx.strokeStyle = "rgba(255, 245, 210, 0.35)";
  ctx.lineWidth = 1.6;
  for (const frac of [0.22, 0.72, 0.82]) {
    ctx.beginPath();
    ctx.moveTo(-halfW, h * frac);
    ctx.lineTo(halfW, h * frac);
    ctx.stroke();
  }

  // Luminous golden / Oyren-lime metallic resonance sheen when ringing!
  if (m.glow > 0.02) {
    ctx.globalCompositeOperation = "lighter";
    const glowGrad = ctx.createRadialGradient(0, h * 0.62, 4, 0, h * 0.62, halfW * 1.15);
    glowGrad.addColorStop(0, hsla(bell.hue, 1, 0.84, 0.78 * m.glow));
    glowGrad.addColorStop(0.55, hsla(bell.hue, 0.95, 0.6, 0.42 * m.glow));
    glowGrad.addColorStop(1, hsla(bell.hue, 0.9, 0.5, 0));
    ctx.fillStyle = glowGrad;
    ctx.fillRect(-halfW, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();

  // Highlighted rim stroke on active ring.
  if (m.glow > 0.12) {
    bellPath();
    ctx.strokeStyle = hsla(bell.hue, 1, 0.84, 0.82 * m.glow);
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  // Crisp engraved pitch label centred on the waist of the bell (high contrast over burnished bronze highlight).
  ctx.font = `800 ${bell.tier === 2 ? 17 : bell.tier === 1 ? 15 : 13}px "Inter Variable", Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(15, 9, 4, 0.82)";
  ctx.lineWidth = 3.2;
  ctx.strokeText(bell.label, 0, h * 0.52);
  ctx.fillStyle = m.glow > 0.22 ? "#ffffff" : "#fef3c7";
  ctx.fillText(bell.label, 0, h * 0.52);

  ctx.restore();
}

function drawAcousticShockwaves(
  ctx: CanvasRenderingContext2D,
  bells: readonly CarillonBell[],
  strikes: readonly BellStrike[],
  t: number,
) {
  ctx.save();
  // Clip shockwaves cleanly inside the symmetric belfry stage so margins stay exact 50/50 px.
  ctx.beginPath();
  ctx.roundRect(STAGE.left + 4, STAGE.hudBottom + 4, STAGE.right - STAGE.left - 8, STAGE.bottom - STAGE.hudBottom - 8, 16);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  for (let i = strikes.length - 1; i >= 0; i--) {
    const ev = strikes[i];
    const age = t - ev.tOn;
    if (age < 0) continue;
    if (age > 0.85) break;
    const bell = bells[ev.bellIndex];
    const u = age / 0.85;
    const baseR = bell.mouthW * 0.45;
    const radius = baseR + (bell.tier === 2 ? 175 : bell.tier === 1 ? 135 : 105) * (1 - (1 - u) ** 2.6);
    const alpha = (1 - u) ** 1.55 * (0.42 + 0.4 * ev.vel01);

    // Primary golden/lime acoustic shockwave ring centred on the bell's sound-bow rim.
    ctx.strokeStyle = hsla(ev.hue, 1, 0.76, alpha);
    ctx.lineWidth = 3.6 * (1 - u) + 0.9;
    ctx.beginPath();
    ctx.arc(ev.x, ev.rimY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Secondary harmonic overtone ring.
    if (age > 0.05) {
      const u2 = Math.min(1, (age - 0.05) / 0.8);
      ctx.strokeStyle = hsla(74, 1, 0.72, (1 - u2) ** 1.8 * 0.32 * ev.vel01);
      ctx.lineWidth = 1.8 * (1 - u2) + 0.5;
      ctx.beginPath();
      ctx.arc(ev.x, ev.rimY, baseR * 0.7 + radius * 0.66, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Bright strike flash where clapper strikes the inner bronze rim.
    if (age < 0.2) {
      const f = 1 - age / 0.2;
      drawGlow(ctx, ev.x + ev.dir * (bell.mouthW * 0.36), ev.rimY, 72 + 44 * f, ev.hue, 0.88 * f, 0.26);
    }

    // Incandescent bronze sparks flying off the sound-bow.
    for (let k = 0; k < 5; k++) {
      const sp = bellSparkAt(ev, k, age);
      if (!sp) continue;
      ctx.fillStyle = hsla(ev.hue, 1, 0.86, sp.alpha * 0.85);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function createCarillonPainter(scene: MidiSceneData, label: string): MidiPainter {
  const plan = buildCarillonPlan(scene.notes);
  const accents = buildAccents(scene.notes, 0.05, 0.8, 2.6);
  const tailSec = scene.totalFrames / scene.fps - scene.leadSec - scene.endSec;

  return (ctx, frame) => {
    const { width, height } = scene;
    const t = pieceTime(scene, frame);
    const pulse = accentPulse(accents, t, 0.42);
    const halo = haloEnergyAt(plan.haloNotes, t);
    const kick = cameraKick(accents, t, 0.32);

    // 1. Deep midnight cathedral sky backdrop.
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#04070f");
    bg.addColorStop(0.5, "#080d18");
    bg.addColorStop(1, "#04060c");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "lighter";
    drawSoft(ctx, 540, 880, 1200, 42, 0.16 + 0.1 * halo + 0.08 * pulse);
    drawSoft(ctx, 540, 1320, 920, 74, 0.06 + 0.06 * halo);
    ctx.globalCompositeOperation = "source-over";

    // 2. Stage block centred on (540, 940) with subtle accent camera kick.
    ctx.save();
    ctx.translate(540 + kick.dx * 0.35, 940 + kick.dy * 0.35);
    ctx.scale(1 + kick.zoom * 0.35, 1 + kick.zoom * 0.35);
    ctx.translate(-540, -940);

    ctx.fillStyle = "rgba(8, 12, 22, 0.78)";
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.top, STAGE.right - STAGE.left, STAGE.bottom - STAGE.top, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.32)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Top HUD strip (y = 290..366).
    ctx.fillStyle = "rgba(13, 18, 30, 0.9)";
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.top, STAGE.right - STAGE.left, STAGE.hudBottom - STAGE.top, 16);
    ctx.fill();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.36)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const progress = carillonProgressAt(t, scene.endSec, tailSec);
    const pealed = t >= scene.endSec ? plan.strikes.length : pealedCountAt(plan.strikes, t, scene.endSec, tailSec);
    const activePhase = t < 0 ? "READY" : t > scene.endSec * 0.62 ? "FULL PEAL" : "D MAJOR · 4/4";

    drawCenteredText(ctx, `PEALS  ${String(pealed).padStart(3, "0")} / ${plan.strikes.length}`, 336, {
      centerX: 256,
      size: 23,
      weight: 700,
      color: "#fde68a",
      maxWidth: 290,
      letterSpacing: 1.4,
    });
    drawProgressRing(ctx, 540, 328, 22, progress);
    drawCenteredText(ctx, activePhase, 336, {
      centerX: 824,
      size: 23,
      weight: 700,
      color: activePhase === "FULL PEAL" ? "#c8ff00" : "#cbd5e1",
      maxWidth: 290,
      letterSpacing: 1.4,
    });

    // 3. Belfry stone interior, ropes, 22 swinging cast-bronze bells, and shockwaves.
    const motions = plan.bells.map((bell, i) => bellMotionAt(bell, plan.byBell[i], t));
    drawBelfryArchitecture(ctx, halo, pulse);
    drawBellRopes(ctx, plan.bells, motions);
    for (const bell of plan.bells) {
      drawCastBronzeBell(ctx, bell, motions[bell.index]);
    }
    drawAcousticShockwaves(ctx, plan.bells, plan.strikes, t);

    ctx.restore();

    drawVignette(ctx, width, height, 0.44);
    drawSceneTitle(ctx, { ...scene, title: CARILLON_DISPLAY_TITLE }, label, frame);
  };
}
