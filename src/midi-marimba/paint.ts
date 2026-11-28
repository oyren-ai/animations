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
  lerp,
} from "../midi/kit.ts";
import { pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import {
  barMotionAt,
  buildMarimbaPlan,
  MALLETS,
  malletPoseAt,
  marimbaProgressAt,
  marimbaSparkAt,
  STAGE,
  struckCountAt,
  type BarMotion,
  type MalletPose,
  type MalletSpec,
  type MarimbaBar,
  type MarimbaStrike,
} from "./sim.ts";

export const MARIMBA_DISPLAY_TITLE = "Minuet in G Major";

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
    ctx.strokeStyle = progress > 0.5 ? "#c8ff00" : "#fbbf24";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();

    const tipX = cx + Math.cos(end) * radius;
    const tipY = cy + Math.sin(end) * radius;
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, tipX, tipY, 24, progress > 0.5 ? 74 : 42, 0.72);
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAcousticBackdrop(ctx: CanvasRenderingContext2D, pulse: number) {
  // Subtle symmetric vertical concert-hall acoustic slats inside the upper stage (x = 50..1030, y = 376..1582).
  ctx.save();
  ctx.strokeStyle = "rgba(180, 140, 92, 0.08)";
  ctx.lineWidth = 1.2;
  for (let i = -9; i <= 9; i++) {
    const x = 540 + i * 48;
    ctx.beginPath();
    ctx.moveTo(x, STAGE.hudBottom + 16);
    ctx.lineTo(x, STAGE.bottom - 16);
    ctx.stroke();
  }

  // Concert arch accent behind the marimba upper sound gallery.
  const archGrad = ctx.createRadialGradient(540, 680, 60, 540, 740, 480);
  archGrad.addColorStop(0, `rgba(245, 158, 11, ${(0.1 + 0.06 * pulse).toFixed(3)})`);
  archGrad.addColorStop(0.6, `rgba(200, 255, 0, ${(0.03 + 0.03 * pulse).toFixed(3)})`);
  archGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = archGrad;
  ctx.fillRect(STAGE.left + 8, STAGE.hudBottom + 10, STAGE.right - STAGE.left - 16, STAGE.bottom - STAGE.hudBottom - 20);
  ctx.restore();
}

function drawFrameAndRails(ctx: CanvasRenderingContext2D) {
  ctx.save();
  // Symmetric carved mahogany side end-cheeks & lower support pillars (x = 66..84 and x = 996..1014).
  for (const side of [-1, 1] as const) {
    const px = side < 0 ? STAGE.frameLeft : STAGE.frameRight - 18;
    const wood = ctx.createLinearGradient(px, 0, px + 18, 0);
    wood.addColorStop(0, "#2c140a");
    wood.addColorStop(0.45, "#6b2f17");
    wood.addColorStop(0.75, "#4a1e0e");
    wood.addColorStop(1, "#1e0c05");
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.roundRect(px, STAGE.upperBarTop - 20, 18, STAGE.resonatorBottom - STAGE.upperBarTop + 34, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(253, 230, 138, 0.28)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Brushed brass corner bosses.
    for (const by of [STAGE.upperBarTop - 2, STAGE.lowerBarTop + 14, STAGE.resonatorTop + 14, STAGE.resonatorBottom - 8]) {
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(px + 9, by, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Horizontal mahogany cross-rails separating the upper accidental deck, lower natural deck, and resonator bay.
  const drawRail = (y: number, h: number) => {
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, "#5c2713");
    grad.addColorStop(0.45, "#3a160a");
    grad.addColorStop(1, "#1c0a04");
    ctx.fillStyle = grad;
    ctx.fillRect(STAGE.frameLeft + 16, y, STAGE.frameRight - STAGE.frameLeft - 32, h);
    ctx.fillStyle = "rgba(253, 230, 138, 0.22)";
    ctx.fillRect(STAGE.frameLeft + 16, y, STAGE.frameRight - STAGE.frameLeft - 32, 1.5);
  };

  drawRail(STAGE.upperBarTop - 16, 12);
  drawRail(STAGE.upperBarBottom + 6, 14);
  drawRail(STAGE.lowerBarBottom + 2, 12);

  // Symmetric lower brass foot-rail beneath the resonator bay.
  const footGrad = ctx.createLinearGradient(0, STAGE.resonatorBottom, 0, STAGE.resonatorBottom + 14);
  footGrad.addColorStop(0, "#fcd34d");
  footGrad.addColorStop(0.5, "#b45309");
  footGrad.addColorStop(1, "#451a03");
  ctx.fillStyle = footGrad;
  ctx.beginPath();
  ctx.roundRect(STAGE.frameLeft + 12, STAGE.resonatorBottom + 2, STAGE.frameRight - STAGE.frameLeft - 24, 12, 5);
  ctx.fill();
  ctx.restore();
}

function drawResonators(
  ctx: CanvasRenderingContext2D,
  bars: readonly MarimbaBar[],
  motions: readonly BarMotion[],
) {
  ctx.save();
  // First draw accidental resonators slightly recessed behind natural resonators for realistic depth.
  const ordered = [...bars].sort((a, b) => Number(b.accidental) - Number(a.accidental));
  for (const bar of ordered) {
    const m = motions[bar.index];
    const tubeW = bar.accidental ? bar.width * 0.72 : bar.width * 0.76;
    const x = bar.x - tubeW / 2;
    const topY = STAGE.resonatorTop + (bar.accidental ? 4 : 10);
    const botY = bar.resonatorBottomY;
    const h = Math.max(40, botY - topY);

    // 3D cylindrical brass pipe shading.
    const pipeGrad = ctx.createLinearGradient(x, 0, x + tubeW, 0);
    const dim = bar.accidental ? 0.62 : 1;
    pipeGrad.addColorStop(0, bar.accidental ? "#291808" : "#422006");
    pipeGrad.addColorStop(0.28, bar.accidental ? "#7c4a12" : "#b45309");
    pipeGrad.addColorStop(0.52, bar.accidental ? "#c28c38" : "#fde68a");
    pipeGrad.addColorStop(0.78, bar.accidental ? "#6e3e0f" : "#92400e");
    pipeGrad.addColorStop(1, "#1f1004");

    ctx.globalAlpha = dim;
    ctx.fillStyle = pipeGrad;
    ctx.beginPath();
    ctx.roundRect(x, topY, tubeW, h, [3, 3, tubeW / 2, tubeW / 2]);
    ctx.fill();

    // Subtle brass rim ring at bottom bell opening.
    ctx.strokeStyle = "rgba(254, 243, 199, 0.34)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x + 2, botY - 8);
    ctx.lineTo(x + tubeW - 2, botY - 8);
    ctx.stroke();

    // Active acoustic pressure wave travelling down the brass resonator tube when its bar rings!
    if (m.resonatorPulse > 0.03) {
      ctx.globalCompositeOperation = "lighter";
      const waveU = m.age >= 0 ? clamp01(m.age / 0.32) : 1;
      const waveY = lerp(topY + 10, botY - 10, waveU);
      const colGrad = ctx.createLinearGradient(0, topY, 0, botY);
      colGrad.addColorStop(0, hsla(m.hue, 0.95, 0.66, 0.55 * m.resonatorPulse));
      colGrad.addColorStop(clamp01(waveU), hsla(m.hue, 1, 0.8, 0.72 * m.resonatorPulse));
      colGrad.addColorStop(1, hsla(m.hue, 0.9, 0.55, 0.16 * m.resonatorPulse));
      ctx.globalAlpha = 1;
      ctx.fillStyle = colGrad;
      ctx.beginPath();
      ctx.roundRect(x + 2, topY + 2, tubeW - 4, h - 4, [2, 2, tubeW / 2, tubeW / 2]);
      ctx.fill();

      drawGlow(ctx, bar.x, waveY, tubeW * 2.6, m.hue, 0.65 * m.resonatorPulse, 0.24);
      drawGlow(ctx, bar.x, botY, tubeW * 2.2, m.hue, 0.42 * m.resonatorPulse, 0.22);
      ctx.globalCompositeOperation = "source-over";
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawBarRank(
  ctx: CanvasRenderingContext2D,
  rank: readonly MarimbaBar[],
  motions: readonly BarMotion[],
) {
  ctx.save();
  // Taut braided nodal suspension cords running behind the rosewood bars.
  if (rank.length >= 2) {
    const yA = lerp(rank[0].topY, rank[0].bottomY, 0.22);
    const yB = lerp(rank[0].topY, rank[0].bottomY, 0.78);
    ctx.strokeStyle = "rgba(226, 200, 160, 0.32)";
    ctx.lineWidth = 2;
    for (const cy of [yA, yB]) {
      ctx.beginPath();
      ctx.moveTo(STAGE.frameLeft + 18, cy);
      ctx.lineTo(STAGE.frameRight - 18, cy);
      ctx.stroke();
    }
  }

  for (const bar of rank) {
    const m = motions[bar.index];
    const x = bar.x - bar.width / 2;
    const y = bar.topY + m.dipY;
    const h = bar.bottomY - bar.topY;

    // Drop shadow underneath each rosewood bar.
    ctx.fillStyle = "rgba(2, 4, 8, 0.62)";
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 6, bar.width, h, 5);
    ctx.fill();

    // Hand-rubbed Honduras rosewood vertical grain gradient (deeper dark walnut-crimson on accidentals, warm chestnut-rosewood on naturals).
    const grad = ctx.createLinearGradient(x, y, x + bar.width, y + h);
    if (bar.accidental) {
      grad.addColorStop(0, "#4a1d14");
      grad.addColorStop(0.45, "#722b1a");
      grad.addColorStop(0.72, "#541f14");
      grad.addColorStop(1, "#2b0f09");
    } else {
      grad.addColorStop(0, "#6e2c1a");
      grad.addColorStop(0.35, "#9c4224");
      grad.addColorStop(0.65, "#7d3119");
      grad.addColorStop(1, "#3f170c");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, bar.width, h, 5);
    ctx.fill();

    // Subtle wood-grain specular bevel along left edge.
    ctx.fillStyle = "rgba(255, 226, 184, 0.14)";
    ctx.fillRect(x + 2, y + 4, Math.max(2, bar.width * 0.18), h - 8);

    // Luminous excitation wash on struck rosewood bar.
    if (m.glow > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const glowGrad = ctx.createLinearGradient(0, y, 0, y + h);
      glowGrad.addColorStop(0, hsla(m.hue, 0.95, 0.58, 0.25 * m.glow));
      glowGrad.addColorStop(0.5, hsla(m.hue, 1, 0.72, 0.78 * m.glow));
      glowGrad.addColorStop(1, hsla(m.hue, 0.95, 0.58, 0.25 * m.glow));
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.roundRect(x, y, bar.width, h, 5);
      ctx.fill();

      drawGlow(ctx, bar.x, bar.strikeY + m.dipY, bar.width * 3.1, m.hue, 0.72 * m.glow, 0.24);
      ctx.restore();
    }

    // Crisp rim outline & two nodal cord brass pins.
    ctx.strokeStyle = m.glow > 0.12
      ? hsla(m.hue, 1, 0.84, 0.88)
      : "rgba(254, 215, 170, 0.28)";
    ctx.lineWidth = m.glow > 0.12 ? 2.1 : 1.1;
    ctx.beginPath();
    ctx.roundRect(x, y, bar.width, h, 5);
    ctx.stroke();

    ctx.fillStyle = "#d97706";
    for (const frac of [0.22, 0.78]) {
      ctx.beginPath();
      ctx.arc(bar.x, y + h * frac, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pitch labels on anchor notes (G, C, D) and any actively ringing bar.
    const pc = bar.pitch % 12;
    if (!bar.accidental && (pc === 7 || pc === 0 || m.glow > 0.25)) {
      ctx.fillStyle = m.glow > 0.25 ? "#ffffff" : "rgba(254, 243, 199, 0.62)";
      ctx.font = `700 ${bar.width > 26 ? 12 : 10}px "Inter Variable", Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(bar.label, bar.x, y + h - 16);
    }
  }
  ctx.restore();
}

function drawMallet(ctx: CanvasRenderingContext2D, spec: MalletSpec, pose: MalletPose) {
  ctx.save();
  // Lift simulates 3D height toward camera: head moves slightly upward in screen-Y, grows slightly,
  // and casts a softer offset shadow on the rosewood bars below.
  const liftOffsetY = -pose.lift * 34;
  const hx = pose.headX;
  const hy = pose.headY + liftOffsetY;
  const headScale = 1 + pose.lift * 0.24;

  // Cast shadow onto the rosewood bar plane.
  ctx.strokeStyle = `rgba(2, 4, 8, ${(0.44 * (1 - 0.55 * pose.lift)).toFixed(3)})`;
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(spec.pivotX + 8, spec.pivotY + 6);
  ctx.lineTo(pose.headX + 6 + pose.lift * 16, pose.headY + 8 + pose.lift * 14);
  ctx.stroke();

  ctx.fillStyle = `rgba(2, 4, 8, ${(0.52 * (1 - 0.55 * pose.lift)).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(
    pose.headX + 5 + pose.lift * 16,
    pose.headY + 7 + pose.lift * 14,
    13 * (1 - 0.15 * pose.lift),
    15 * (1 - 0.15 * pose.lift),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Tapered natural birch mallet shaft from wrist pivot up to yarn mallet head.
  const dx = hx - spec.pivotX;
  const dy = hy - spec.pivotY;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;

  const baseW = 4.6;
  const tipW = 2.8;
  ctx.beginPath();
  ctx.moveTo(spec.pivotX - nx * baseW, spec.pivotY - ny * baseW);
  ctx.lineTo(hx - nx * tipW, hy - ny * tipW);
  ctx.lineTo(hx + nx * tipW, hy + ny * tipW);
  ctx.lineTo(spec.pivotX + nx * baseW, spec.pivotY + ny * baseW);
  ctx.closePath();

  const shaftGrad = ctx.createLinearGradient(spec.pivotX, spec.pivotY, hx, hy);
  shaftGrad.addColorStop(0, "#7c5838");
  shaftGrad.addColorStop(0.45, "#d8b489");
  shaftGrad.addColorStop(0.85, "#f3dfc1");
  shaftGrad.addColorStop(1, "#c49a6c");
  ctx.fillStyle = shaftGrad;
  ctx.fill();
  ctx.strokeStyle = "#160d07";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Wrapped-yarn oval concert mallet head aligned with the shaft angle.
  const angle = Math.atan2(dy, dx) + Math.PI / 2;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(angle);
  ctx.scale(headScale, headScale);

  ctx.beginPath();
  ctx.ellipse(0, 0, 14.5, 18.5, 0, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#040a10";
  ctx.stroke();
  ctx.fillStyle = spec.headColor;
  ctx.fill();

  // Subtle crossed-yarn thread texture & top specular highlight.
  ctx.strokeStyle = "rgba(4, 10, 16, 0.24)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-9, -8);
  ctx.lineTo(9, 8);
  ctx.moveTo(9, -8);
  ctx.lineTo(-9, 8);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.beginPath();
  ctx.ellipse(-4, -5.5, 4.5, 7, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Impact flash ring at exact moment of mallet-to-bar contact.
  if (pose.impact > 0.05) {
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, pose.headX, pose.headY, 64 + 34 * pose.impact, spec.glowHue, 0.78 * pose.impact, 0.24);
    ctx.strokeStyle = hsla(spec.glowHue, 1, 0.85, 0.72 * pose.impact);
    ctx.lineWidth = 2.6 * pose.impact;
    ctx.beginPath();
    ctx.arc(pose.headX, pose.headY, 18 + 38 * (1 - pose.impact), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.restore();
}

function drawUpperHarmonicWave(
  ctx: CanvasRenderingContext2D,
  strikes: readonly MarimbaStrike[],
  t: number,
) {
  // Subtle visual resonance arcs rising into the concert-hall gallery above the upper bars.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(STAGE.left + 6, STAGE.hudBottom + 6, STAGE.right - STAGE.left - 12, STAGE.bottom - STAGE.hudBottom - 12, 14);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  for (let i = strikes.length - 1; i >= 0; i--) {
    const ev = strikes[i];
    const age = t - ev.tOn;
    if (age < 0) continue;
    if (age > 0.72) break;
    const u = age / 0.72;
    const radius = 22 + 150 * (1 - (1 - u) ** 2.4);
    const alpha = (1 - u) ** 1.45 * (0.42 + 0.36 * ev.vel01);
    ctx.strokeStyle = hsla(ev.hue, 0.98, 0.78, alpha);
    ctx.lineWidth = 3.0 * (1 - u) + 1.0;
    ctx.beginPath();
    ctx.arc(ev.x, STAGE.upperBarTop - 10, radius, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();

    // Rising spark motes on each strike.
    for (let k = 0; k < 5; k++) {
      const sp = marimbaSparkAt(ev, k, age);
      if (!sp) continue;
      ctx.fillStyle = hsla(ev.hue, 1, 0.86, sp.alpha * 0.9);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function createMarimbaPainter(scene: MidiSceneData, label: string): MidiPainter {
  const plan = buildMarimbaPlan(scene.notes);
  const accents = buildAccents(scene.notes, 0.05, 0.7, 2.2);
  const tailSec = scene.totalFrames / scene.fps - scene.leadSec - scene.endSec;

  return (ctx, frame) => {
    const { width, height } = scene;
    const t = pieceTime(scene, frame);
    const pulse = accentPulse(accents, t, 0.35);
    const kick = cameraKick(accents, t, 0.3);

    // 1. Deep warm obsidian concert-hall backdrop matching the Oyren vertical series.
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#05070e");
    bg.addColorStop(0.5, "#0d0b0a");
    bg.addColorStop(1, "#04060c");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "lighter";
    drawSoft(ctx, 540, 840, 1180, 36, 0.2 + 0.08 * pulse);
    drawSoft(ctx, 540, 1220, 960, 74, 0.07 + 0.05 * pulse);
    ctx.globalCompositeOperation = "source-over";

    // 2. Subtle stage camera kick centred on (540, 940).
    ctx.save();
    ctx.translate(540 + kick.dx * 0.35, 940 + kick.dy * 0.35);
    ctx.scale(1 + kick.zoom * 0.35, 1 + kick.zoom * 0.35);
    ctx.translate(-540, -940);

    // Outer symmetric stage enclosure (x = 50..1030, y = 290..1590 -> cx = 540, cy = 940).
    ctx.fillStyle = "rgba(8, 10, 16, 0.76)";
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.top, STAGE.right - STAGE.left, STAGE.bottom - STAGE.top, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.3)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Top HUD strip (y = 290..366).
    ctx.fillStyle = "rgba(18, 15, 14, 0.88)";
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.top, STAGE.right - STAGE.left, STAGE.hudBottom - STAGE.top, 16);
    ctx.fill();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.34)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const progress = marimbaProgressAt(t, scene.endSec, tailSec);
    const playProgress = t <= 0 || scene.endSec <= 0 ? 0 : clamp01(t / scene.endSec);
    const struck = t >= scene.endSec ? plan.strikes.length : struckCountAt(plan.strikes, t, scene.endSec, tailSec);
    const currentBar = t < 0 ? 1 : Math.min(32, Math.max(1, Math.floor(playProgress * 32) + 1));

    drawCenteredText(ctx, `NOTES  ${String(struck).padStart(3, "0")} / ${plan.strikes.length}`, 336, {
      centerX: 256,
      size: 23,
      weight: 700,
      color: "#fde68a",
      maxWidth: 290,
      letterSpacing: 1.4,
    });
    drawProgressRing(ctx, 540, 328, 22, progress);
    drawCenteredText(ctx, `BAR  ${String(currentBar).padStart(2, "0")} / 32`, 336, {
      centerX: 824,
      size: 23,
      weight: 700,
      color: "#c8ff00",
      maxWidth: 290,
      letterSpacing: 1.4,
    });

    // 3. Stage interior: backdrop slats, harmonic gallery, frame, resonators, bars, and 4 articulated mallets.
    const motions = plan.bars.map((_, i) => barMotionAt(plan.byBar[i], t));
    drawAcousticBackdrop(ctx, pulse);
    drawUpperHarmonicWave(ctx, plan.strikes, t);
    drawResonators(ctx, plan.bars, motions);
    drawFrameAndRails(ctx);
    drawBarRank(ctx, plan.accidentalBars, motions);
    drawBarRank(ctx, plan.naturalBars, motions);

    // Draw all four Stevens-grip concert mallets sweeping over the bars.
    for (const spec of MALLETS) {
      const pose = malletPoseAt(spec, plan.byMallet[spec.id], t, scene.endSec, tailSec);
      drawMallet(ctx, spec, pose);
    }

    ctx.restore();

    drawVignette(ctx, width, height, 0.44);
    drawSceneTitle(ctx, { ...scene, title: MARIMBA_DISPLAY_TITLE }, label, frame);
  };
}
