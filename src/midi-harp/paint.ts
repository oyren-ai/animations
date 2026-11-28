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
  buildHarpPlan,
  fingerPoseAt,
  FINGERS,
  harmonicNeckY,
  harpProgressAt,
  harpSectionLabelAt,
  harpStringMotionAt,
  pluckedCountAt,
  soundboardEnergyAt,
  soundboardRibY,
  STAGE,
  type FingerPose,
  type FingerSpec,
  type HarpPlan,
  type HarpString,
  type HarpStringMotion,
} from "./sim.ts";

export const HARP_DISPLAY_TITLE = "Spring";

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
    ctx.strokeStyle = progress > 0.6 ? "#c8ff00" : "#38bdf8";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();

    const tipX = cx + Math.cos(end) * radius;
    const tipY = cy + Math.sin(end) * radius;
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, tipX, tipY, 24, progress > 0.6 ? 74 : 198, 0.72);
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawConcertHarpFrame(
  ctx: CanvasRenderingContext2D,
  plan: HarpPlan,
  energy: number,
  pulse: number,
) {
  const { pillarX, pillarTopY, pedestalY, stringLeftX, stringRightX } = STAGE;
  const kneeX = stringRightX + 38; // 958
  const kneeTopY = harmonicNeckY(1) + 4;
  const kneeBotY = soundboardRibY(1) - 10;

  ctx.save();

  // 1. Subtle luminous air-cavity wash inside the harp triangle
  const cavityGrad = ctx.createRadialGradient(540, 960, 40, 540, 960, 440);
  const washA = 0.075 + 0.085 * energy + 0.03 * pulse;
  cavityGrad.addColorStop(0, `rgba(251, 191, 36, ${washA.toFixed(3)})`);
  cavityGrad.addColorStop(0.55, `rgba(56, 189, 248, ${(washA * 0.48).toFixed(3)})`);
  cavityGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = cavityGrad;
  ctx.beginPath();
  ctx.moveTo(pillarX + 18, pillarTopY + 20);
  for (let k = 0; k <= 28; k++) {
    const u = k / 28;
    ctx.lineTo(lerp(stringLeftX, stringRightX, u), harmonicNeckY(u));
  }
  ctx.lineTo(kneeX - 10, kneeBotY);
  ctx.lineTo(pillarX + 18, pedestalY - 22);
  ctx.closePath();
  ctx.fill();

  // 2. Angled Sitka-spruce tapered concert soundbox (rising bottom-left to right knee)
  ctx.beginPath();
  ctx.moveTo(pillarX + 14, pedestalY - 8);
  ctx.lineTo(stringLeftX - 18, soundboardRibY(0) - 6);
  ctx.lineTo(kneeX - 6, kneeBotY - 12);
  ctx.lineTo(kneeX + 20, kneeBotY + 34);
  ctx.lineTo(stringLeftX + 86, pedestalY + 12);
  ctx.lineTo(pillarX + 14, pedestalY + 12);
  ctx.closePath();
  const spruce = ctx.createLinearGradient(pillarX, pedestalY, kneeX, kneeBotY);
  spruce.addColorStop(0, "#4e2812");
  spruce.addColorStop(0.42, "#8c5124");
  spruce.addColorStop(0.75, "#a6672e");
  spruce.addColorStop(1, "#5c3114");
  ctx.fillStyle = spruce;
  ctx.fill();
  ctx.strokeStyle = `rgba(253, 224, 158, ${(0.42 + 0.3 * energy).toFixed(3)})`;
  ctx.lineWidth = 2.4;
  ctx.stroke();

  // Central maple string-rib inlay running cleanly under all 29 string eyelets
  ctx.strokeStyle = "#fde68a";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(stringLeftX - 8, soundboardRibY(0));
  ctx.lineTo(stringRightX + 8, soundboardRibY(1));
  ctx.stroke();
  ctx.strokeStyle = "#3f1d0b";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Acoustic resonance shimmer ripple along the soundboard when strings vibrate
  if (energy > 0.04) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, 540, 1280, 140 + 80 * energy, 42, 0.24 * energy);
    drawGlow(ctx, 740, 1185, 95 + 50 * energy, 74, 0.16 * energy);
    ctx.restore();
  }

  // 3. Fluted Gilded Forepillar (vertical column at x = 118, left side of harp)
  const colGrad = ctx.createLinearGradient(pillarX - 24, 0, pillarX + 24, 0);
  colGrad.addColorStop(0, "#6e4710");
  colGrad.addColorStop(0.32, "#f6d379");
  colGrad.addColorStop(0.56, "#fff1c2");
  colGrad.addColorStop(0.82, "#c68e2e");
  colGrad.addColorStop(1, "#4d2f07");
  ctx.fillStyle = colGrad;
  ctx.beginPath();
  ctx.roundRect(pillarX - 20, pillarTopY + 18, 40, pedestalY - (pillarTopY + 18), 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 241, 194, 0.55)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Vertical neoclassical flutes along the gilded column
  ctx.strokeStyle = "rgba(69, 36, 7, 0.42)";
  ctx.lineWidth = 1.8;
  for (const fx of [-10, 0, 10]) {
    ctx.beginPath();
    ctx.moveTo(pillarX + fx, pillarTopY + 46);
    ctx.lineTo(pillarX + fx, pedestalY - 22);
    ctx.stroke();
  }

  // Carved Baroque gilded crown capital atop the forepillar
  ctx.fillStyle = colGrad;
  ctx.beginPath();
  ctx.roundRect(pillarX - 30, pillarTopY - 6, 60, 30, 10);
  ctx.fill();
  ctx.strokeStyle = "#fef08a";
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // 4. Right shoulder knee pillar joining harmonic neck to angled soundboard
  const kneeGrad = ctx.createLinearGradient(kneeX - 18, kneeTopY, kneeX + 22, kneeBotY);
  kneeGrad.addColorStop(0, "#7c471b");
  kneeGrad.addColorStop(0.45, "#d8a246");
  kneeGrad.addColorStop(1, "#4a230b");
  ctx.fillStyle = kneeGrad;
  ctx.beginPath();
  ctx.roundRect(kneeX - 16, kneeTopY - 12, 34, kneeBotY - kneeTopY + 46, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(253, 224, 158, 0.55)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 5. Iconic S-Curved Gilded Harmonic Neck + Brushed Brass Action Plate
  const neckTopPts: Array<[number, number]> = [[pillarX + 12, pillarTopY - 2]];
  const neckBotPts: Array<[number, number]> = [[pillarX + 12, pillarTopY + 42]];
  for (let k = 0; k <= 28; k++) {
    const u = k / 28;
    const x = lerp(stringLeftX, stringRightX, u);
    const y = harmonicNeckY(u);
    neckTopPts.push([x, y - 34]);
    neckBotPts.push([x, y + 12]);
  }
  neckTopPts.push([kneeX + 12, kneeTopY - 18]);
  neckBotPts.push([kneeX + 12, kneeTopY + 24]);

  ctx.beginPath();
  ctx.moveTo(neckTopPts[0][0], neckTopPts[0][1]);
  for (let i = 1; i < neckTopPts.length; i++) ctx.lineTo(neckTopPts[i][0], neckTopPts[i][1]);
  for (let i = neckBotPts.length - 1; i >= 0; i--) ctx.lineTo(neckBotPts[i][0], neckBotPts[i][1]);
  ctx.closePath();
  const neckWood = ctx.createLinearGradient(pillarX, pillarTopY, kneeX, kneeTopY);
  neckWood.addColorStop(0, "#5e2d10");
  neckWood.addColorStop(0.5, "#87441b");
  neckWood.addColorStop(1, "#4a210a");
  ctx.fillStyle = neckWood;
  ctx.fill();
  ctx.strokeStyle = "#f6d379";
  ctx.lineWidth = 2.6;
  ctx.stroke();

  // Brass action plate stripe carrying the tuning pins & fourchette discs
  ctx.strokeStyle = "rgba(251, 191, 36, 0.72)";
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  plan.strings.forEach((s, idx) => {
    if (idx === 0) ctx.moveTo(s.x, s.topY - 6);
    else ctx.lineTo(s.x, s.topY - 6);
  });
  ctx.stroke();

  // 6. Ornate Pedestal Base & 7 Concert Harp Foot Pedals (E major = C#, D#, F#, G# engaged!)
  const baseL = pillarX - 30;
  const baseR = 964;
  ctx.fillStyle = "#1c0e07";
  ctx.beginPath();
  ctx.roundRect(baseL, pedestalY - 4, baseR - baseL, 48, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(251, 191, 36, 0.45)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 7 pedals: D#, C#, B (left) | E, F#, G#, A (right)
  const pedals: readonly { label: string; sharp: boolean; x: number }[] = [
    { label: "D#", sharp: true, x: 244 },
    { label: "C#", sharp: true, x: 326 },
    { label: "B", sharp: false, x: 408 },
    { label: "E", sharp: false, x: 582 },
    { label: "F#", sharp: true, x: 664 },
    { label: "G#", sharp: true, x: 746 },
    { label: "A", sharp: false, x: 828 },
  ];
  for (const pd of pedals) {
    const py = pedestalY + (pd.sharp ? 22 : 12);
    ctx.fillStyle = pd.sharp ? "#c8ff00" : "#94a3b8";
    ctx.beginPath();
    ctx.roundRect(pd.x - 24, py, 48, 13, 5);
    ctx.fill();
    ctx.fillStyle = pd.sharp ? "#071014" : "#0b111b";
    ctx.font = '700 11px ui-monospace, "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pd.label, pd.x, py + 6.5);
  }

  ctx.restore();
}

function restingStringColor(role: HarpString["role"]): string {
  if (role === "red-c") return "rgba(239, 68, 68, 0.86)";
  if (role === "blue-f") return "rgba(56, 189, 248, 0.84)";
  if (role === "wire-bass") return "rgba(234, 179, 8, 0.72)";
  return "rgba(241, 245, 249, 0.62)";
}

function drawHarpString(ctx: CanvasRenderingContext2D, s: HarpString, m: HarpStringMotion) {
  const { x, topY, botY, pluckY, hue, role } = s;
  const active = m.vibEnv > 0.03;
  const preloading = Math.abs(m.preloadPx) > 0.35;
  const pluckU = (pluckY - topY) / Math.max(1, botY - topY);

  ctx.save();

  // Top brass tuning pin + action disc on harmonic neck, plus soundboard eyelet at bottom
  ctx.fillStyle = active ? "#fef08a" : role === "red-c" ? "#fca5a5" : role === "blue-f" ? "#7dd3fc" : "#d9a74a";
  ctx.beginPath();
  ctx.arc(x, topY - 8, 3.6, 0, Math.PI * 2);
  ctx.arc(x, topY + 2, 2.7, 0, Math.PI * 2);
  ctx.arc(x, botY, 3.2, 0, Math.PI * 2);
  ctx.fill();

  if (active || preloading) {
    const segs = 28;
    // Motion-blur vibration envelope halo when ringing
    if (active) {
      ctx.globalCompositeOperation = "lighter";
      const envAmp = m.vibEnv * lerp(9.5, 5.2, s.u);
      for (const dir of [-1, 1] as const) {
        ctx.strokeStyle = hsla(hue, 0.94, 0.72, 0.25 * m.vibEnv);
        ctx.lineWidth = 3.8;
        ctx.beginPath();
        for (let k = 0; k <= segs; k++) {
          const v = k / segs;
          const py = lerp(topY, botY, v);
          const px = x + dir * Math.sin(Math.PI * v) * envAmp;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // Crisp instantaneous deflected/vibrating string path:
    // Triangular kink during pre-pluck finger pull + fundamental & 2nd-harmonic standing wave after release!
    ctx.strokeStyle = active
      ? hsla(hue, 0.96, lerp(0.68, 0.94, m.vibEnv), 1)
      : role === "red-c"
        ? "#f87171"
        : role === "blue-f"
          ? "#7dd3fc"
          : "#fef08a";
    ctx.lineWidth = lerp(2.9, 1.85, s.u);
    ctx.beginPath();
    for (let k = 0; k <= segs; k++) {
      const v = k / segs;
      const py = lerp(topY, botY, v);
      const tri = v <= pluckU ? v / pluckU : (1 - v) / (1 - pluckU);
      const bend = tri * m.preloadPx;
      const wave = Math.sin(Math.PI * v) * m.oscPx + Math.sin(Math.PI * 2 * v) * m.overtonePx;
      const px = x + bend + wave;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Luminous pluck sparkle & acoustic ring right at the string pluck point
    if (m.glow > 0.05) {
      ctx.globalCompositeOperation = "lighter";
      drawGlow(ctx, x, pluckY, 22 + 28 * m.glow, hue, 0.68 * m.glow);
      if (m.age >= 0 && m.age < 0.36) {
        const ringA = 0.55 * (1 - m.age / 0.36);
        ctx.strokeStyle = hsla(hue, 0.95, 0.78, ringA);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, pluckY, 7 + m.age * 96, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }
  } else {
    // Resting taut concert harp string with authentic red-C# / blue-F# / pearl-gut colour coding
    ctx.strokeStyle = restingStringColor(role);
    ctx.lineWidth = role === "wire-bass" ? lerp(2.5, 2.0, s.u * 3) : lerp(1.9, 1.25, s.u);
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, botY);
    ctx.stroke();
  }

  // Pitch markings along the bottom maple rib for C# (red) and E (tonic) strings
  if (s.pitch % 12 === 4 || s.pitch % 12 === 1) {
    ctx.fillStyle = active ? "#c8ff00" : role === "red-c" ? "#fca5a5" : "rgba(253, 230, 138, 0.75)";
    ctx.font = '700 12px ui-monospace, "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(s.label, x, botY + 8);
  }

  ctx.restore();
}

function drawPluckingFinger(ctx: CanvasRenderingContext2D, spec: FingerSpec, pose: FingerPose) {
  const { knuckleX, knuckleY, accentColor, glowHue } = spec;
  const { tipX, tipY, lift, flick, active } = pose;

  const dx = tipX - knuckleX;
  const dy = tipY - knuckleY;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist;
  const ny = dx / dist;
  // Subtle natural finger-joint curvature + exact Bezier midpoint so hinge pin sits dead-center on shaft
  const bend = (spec.hand === "left" ? -1 : 1) * (24 + lift * 14);
  const ctrlX = lerp(knuckleX, tipX, 0.52) + nx * bend;
  const ctrlY = lerp(knuckleY, tipY, 0.52) + ny * bend;
  const jointX = 0.25 * knuckleX + 0.5 * ctrlX + 0.25 * tipX;
  const jointY = 0.25 * knuckleY + 0.5 * ctrlY + 0.25 * tipY;

  ctx.save();
  // Soft drop shadow when lifted above the string plane
  ctx.strokeStyle = "rgba(2, 6, 12, 0.58)";
  ctx.lineWidth = 17;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(knuckleX + 4, knuckleY + 8 + lift * 5);
  ctx.quadraticCurveTo(ctrlX + 4, ctrlY + 8 + lift * 5, tipX + 4, tipY + 8 + lift * 5);
  ctx.stroke();

  // Articulated brass-and-ivory mechanical harpist finger linkage
  const shaftGrad = ctx.createLinearGradient(knuckleX, knuckleY, tipX, tipY);
  shaftGrad.addColorStop(0, "rgba(100, 116, 139, 0.45)");
  shaftGrad.addColorStop(0.65, active ? "#e2e8f0" : "#94a3b8");
  shaftGrad.addColorStop(1, accentColor);
  ctx.strokeStyle = shaftGrad;
  ctx.lineWidth = 11.5;
  ctx.beginPath();
  ctx.moveTo(knuckleX, knuckleY);
  ctx.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
  ctx.stroke();

  // Inner specular highlight rod
  ctx.strokeStyle = "rgba(255, 255, 255, 0.48)";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(knuckleX, knuckleY);
  ctx.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
  ctx.stroke();

  // Brass pivot joint & wrist collar
  ctx.fillStyle = "#1e293b";
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(knuckleX, knuckleY, 9.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(jointX, jointY, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Sculpted plucking pad fingertip right at (tipX, tipY)
  const tipR = lerp(11.5, 9.2, lift);
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(tipX, tipY, tipR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();

  if (flick > 0.06) {
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, tipX, tipY, 26 + 18 * flick, glowHue, 0.62 * flick);
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.restore();
}

export function createHarpPainter(scene: MidiSceneData, label: string): MidiPainter {
  const plan = buildHarpPlan(scene.notes);
  const accents = buildAccents(scene.notes, 0.045, 0.85, 3.2);
  const tailSec = scene.totalFrames / scene.fps - scene.leadSec - scene.endSec;

  return (ctx, frame) => {
    const { width: W, height: H } = scene;
    const t = pieceTime(scene, frame);
    const pulse = accentPulse(accents, t, 0.28);
    const kick = cameraKick(accents, t, 0.3);
    const progress = harpProgressAt(t, scene.endSec, tailSec);
    const energy = soundboardEnergyAt(plan.plucks, t);

    const motions: HarpStringMotion[] = new Array(plan.strings.length);
    for (let i = 0; i < plan.strings.length; i++) {
      motions[i] = harpStringMotionAt(plan.strings[i], plan.byString[i], t);
    }

    // 1. Deep dark ink backdrop + warm golden concert hall radiance
    ctx.fillStyle = "#04070d";
    ctx.fillRect(0, 0, W, H);
    drawSoft(ctx, 540, 920, 740, 44, 0.075 + 0.05 * energy);
    drawVignette(ctx, W, H, 0.6);

    // 2. Gentle camera breathing centred on (540, 940)
    ctx.save();
    ctx.translate(540 + kick.dx * 0.35, 940 + kick.dy * 0.35);
    ctx.rotate(kick.rotation * 0.25);
    ctx.scale(1 + kick.zoom * 0.42, 1 + kick.zoom * 0.42);
    ctx.translate(-540, -940);

    // 3. Stage card + top HUD bar
    ctx.save();
    ctx.fillStyle = "rgba(8, 13, 22, 0.92)";
    ctx.strokeStyle = "rgba(251, 191, 36, 0.26)";
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
    ctx.fillStyle = progress > 0.6 ? "#c8ff00" : "#38bdf8";
    ctx.fillText(harpSectionLabelAt(t, scene.endSec), STAGE.right - 28, (STAGE.top + STAGE.hudBottom) / 2);
    ctx.restore();

    // 4. Sculpted gilded concert pedal harp frame (forepillar, S-neck, spruce soundbox, 7 pedals)
    drawConcertHarpFrame(ctx, plan, energy, pulse);

    // 5. 29 E-major diatonic strings (resting first, preloading/vibrating strings on top)
    for (let i = 0; i < plan.strings.length; i++) {
      if (motions[i].vibEnv <= 0.03 && Math.abs(motions[i].preloadPx) <= 0.35) {
        drawHarpString(ctx, plan.strings[i], motions[i]);
      }
    }
    for (let i = 0; i < plan.strings.length; i++) {
      if (motions[i].vibEnv > 0.03 || Math.abs(motions[i].preloadPx) > 0.35) {
        drawHarpString(ctx, plan.strings[i], motions[i]);
      }
    }

    // 6. Four articulated plucking fingers (2 left-hand bass/mid + 2 right-hand mid/treble)
    for (const spec of FINGERS) {
      const pose = fingerPoseAt(spec, plan.byFinger[spec.id], t, scene.endSec, tailSec);
      drawPluckingFinger(ctx, spec, pose);
    }

    ctx.restore();

    // 7. Framing-standard title block cleanly below top OYREN wordmark
    drawSceneTitle(ctx, { ...scene, title: HARP_DISPLAY_TITLE }, label, frame);
  };
}
