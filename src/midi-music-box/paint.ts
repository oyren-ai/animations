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
} from "../midi/kit.ts";
import { pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import {
  buildMusicBoxPlan,
  CYL_RADIUS,
  FRONT_HALF_SEC,
  pieceProgressAt,
  pinPoseAt,
  pluckedCountAt,
  pluckSparkAt,
  STAGE,
  toothMotionAt,
  type CombTooth,
  type PinEvent,
} from "./sim.ts";

function drawProgressRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, progress: number) {
  ctx.save();
  // Outer recessed ring
  ctx.strokeStyle = "rgba(148, 163, 184, 0.28)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (progress > 0.002) {
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * progress;
    ctx.strokeStyle = progress > 0.7 ? "#c8ff00" : "#fbbf24";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();

    const tipX = cx + Math.cos(end) * radius;
    const tipY = cy + Math.sin(end) * radius;
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, tipX, tipY, 26, progress > 0.7 ? 75 : 45, 0.75);
    ctx.globalCompositeOperation = "source-over";
  }

  // Tiny brass centre jewel
  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBrassCylinder(
  ctx: CanvasRenderingContext2D,
  teeth: readonly CombTooth[],
  events: readonly PinEvent[],
  t: number,
  totalSec: number,
  loopAngle: number,
) {
  const left = STAGE.cylLeft;
  const right = STAGE.cylRight;
  const width = right - left;
  const top = STAGE.cylTop;
  const height = STAGE.contactY - top;

  // Symmetric left & right machined brass journals & drive gears (x = 64..96 and x = 984..1016)
  for (const side of [-1, 1] as const) {
    const jx = side < 0 ? 64 : 984;
    const jGrad = ctx.createLinearGradient(0, top + 40, 0, STAGE.contactY - 40);
    jGrad.addColorStop(0, "#78350f");
    jGrad.addColorStop(0.32, "#f59e0b");
    jGrad.addColorStop(0.5, "#fef3c7");
    jGrad.addColorStop(0.75, "#b45309");
    jGrad.addColorStop(1, "#451a03");
    ctx.fillStyle = jGrad;
    ctx.beginPath();
    ctx.roundRect(jx, top + 36, 32, height - 72, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(254, 243, 199, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Animated gear teeth notches moving vertically with loopAngle
    ctx.fillStyle = "rgba(28, 25, 23, 0.65)";
    const gearTeeth = 18;
    for (let g = 0; g < gearTeeth; g++) {
      const phi = ((g / gearTeeth) * Math.PI * 2 + loopAngle) % (Math.PI * 2);
      if (phi > Math.PI) continue;
      const gy = STAGE.cylCenterY + (CYL_RADIUS - 38) * Math.cos(phi);
      const gh = Math.max(2, 7 * Math.sin(phi));
      ctx.fillRect(jx + 4, gy - gh / 2, 24, gh);
    }
  }

  // Main cylindrical brass barrel (3D vertical shading from top horizon -> specular equator -> bottom contact shadow)
  const cylGrad = ctx.createLinearGradient(0, top, 0, STAGE.contactY);
  cylGrad.addColorStop(0, "#3b210c");
  cylGrad.addColorStop(0.16, "#92400e");
  cylGrad.addColorStop(0.38, "#d97706");
  cylGrad.addColorStop(0.49, "#fde68a");
  cylGrad.addColorStop(0.62, "#b45309");
  cylGrad.addColorStop(0.88, "#78350f");
  cylGrad.addColorStop(1, "#291507");
  ctx.fillStyle = cylGrad;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 14);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 14);
  ctx.clip();

  // Circumferential pitch-track grooves aligned with every comb tooth
  ctx.strokeStyle = "rgba(41, 21, 7, 0.34)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (const tooth of teeth) {
    ctx.moveTo(tooth.x, top);
    ctx.lineTo(tooth.x, STAGE.contactY);
  }
  ctx.stroke();

  // Axial rotation seams sweeping down the cylinder face (exact integer turns per video -> seamless loop!)
  const axialSeams = 16;
  for (let s = 0; s < axialSeams; s++) {
    const phi = (((s / axialSeams) * Math.PI * 2 - loopAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    if (phi > Math.PI) continue;
    const sy = STAGE.cylCenterY + CYL_RADIUS * Math.cos(phi);
    const vis = Math.sin(phi);
    ctx.strokeStyle = `rgba(254, 243, 199, ${(0.05 + 0.14 * vis).toFixed(3)})`;
    ctx.lineWidth = 1 + vis;
    ctx.beginPath();
    ctx.moveTo(left, sy);
    ctx.lineTo(right, sy);
    ctx.stroke();
  }

  // Render pins on the front half of the brass drum (normal timeline + wrapped loop preview at the end)
  const drawPinsPass = (timeShift: number) => {
    const tLocal = t - timeShift;
    for (const ev of events) {
      if (ev.tOn < tLocal - 0.2) continue;
      if (ev.tOn > tLocal + FRONT_HALF_SEC + 0.1) break;
      const pose = pinPoseAt(ev, tLocal);
      if (!pose) continue;

      const pinR = 4.2 + 2.4 * pose.depth + 1.2 * ev.vel01;
      const protrudeY = 4.5 * pose.depth; // 3D pin tip relief

      // Cast shadow on the brass barrel
      ctx.fillStyle = `rgba(15, 10, 4, ${(0.45 + 0.35 * pose.depth).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(pose.x + 2, pose.y + 4, pinR * 1.05, Math.max(2.2, pinR * (0.45 + 0.55 * pose.depth)), 0, 0, Math.PI * 2);
      ctx.fill();

      // Glowing halo as the pin approaches the comb contact line (bottom 22% of drum)
      const nearContact = Math.max(0, 1 - Math.max(0, pose.phi) / 0.55);
      if (nearContact > 0.02) {
        ctx.globalCompositeOperation = "lighter";
        drawGlow(ctx, pose.x, pose.y, 34 + 28 * nearContact, ev.hue, 0.35 + 0.55 * nearContact, 0.25);
        ctx.globalCompositeOperation = "source-over";
      }

      // Machined brass/gold pin shank + bright specular tip
      ctx.fillStyle = nearContact > 0.6 ? "#fef9c3" : "#fbbf24";
      ctx.beginPath();
      ctx.ellipse(pose.x, pose.y - protrudeY * 0.25, pinR, Math.max(2.4, pinR * (0.4 + 0.6 * pose.depth)), 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(pose.x - pinR * 0.25, pose.y - protrudeY * 0.35 - 0.8, Math.max(1.2, pinR * 0.38), 0, Math.PI * 2);
      ctx.fill();
    }
  };

  drawPinsPass(0);
  if (t > totalSec - FRONT_HALF_SEC - 1.2) {
    drawPinsPass(totalSec);
  }

  ctx.restore(); // end cylinder clip

  // Crisp metallic cylinder rim & contact-line glow bar
  ctx.strokeStyle = "rgba(253, 230, 138, 0.52)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 14);
  ctx.stroke();

  ctx.fillStyle = "rgba(250, 204, 21, 0.48)";
  ctx.fillRect(left + 8, STAGE.contactY - 1.5, width - 16, 3);
}

export const MUSIC_BOX_DISPLAY_TITLE = "F\u00fcr Elise";

export function createMusicBoxPainter(scene: MidiSceneData, label: string): MidiPainter {
  const displayScene: MidiSceneData = {
    ...scene,
    title: scene.title && scene.title !== "Fur Elise" ? scene.title : MUSIC_BOX_DISPLAY_TITLE,
  };
  const plan = buildMusicBoxPlan(scene.notes);
  const accents = buildAccents(scene.notes, 0.04, 0.7, 2.8);
  const tailSec = (scene.totalFrames / scene.fps) - scene.leadSec - scene.endSec;
  const totalSec = scene.totalFrames / scene.fps;
  const { width: W, height: H } = scene;

  return (ctx, frame) => {
    const t = pieceTime(scene, frame);
    // Exact 8 revolutions across totalFrames so cylinder grooves match seamlessly from frame N-1 -> frame 0!
    const loopAngle = (2 * Math.PI * 8 * frame) / Math.max(1, scene.totalFrames);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#09080f");
    bg.addColorStop(0.5, "#07060c");
    bg.addColorStop(1, "#0b0912");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const kick = cameraKick(accents, t, 0.6);
    const pulse = accentPulse(accents, t, 0.2);
    const progress = pieceProgressAt(t, scene.endSec, tailSec);
    const plucked = pluckedCountAt(scene.notes, t, scene.endSec, tailSec);

    ctx.save();
    const cx = 540;
    const cy = 940;
    ctx.translate(cx + kick.dx * 0.5, cy + kick.dy * 0.5);
    ctx.scale(1 + kick.zoom * 0.65, 1 + kick.zoom * 0.65);
    ctx.translate(-cx, -cy);

    // Symmetric warm amber & silver-cyan ambient pools
    ctx.globalCompositeOperation = "lighter";
    drawSoft(ctx, 270, 820, 1280, 38, 0.14 + 0.08 * Math.min(1, pulse));
    drawSoft(ctx, 810, 820, 1280, 190, 0.12 + 0.08 * Math.min(1, pulse));
    drawSoft(ctx, 540, 1120, 1450, 46, 0.12 + 0.14 * progress);
    ctx.globalCompositeOperation = "source-over";

    // --- 1. Symmetric Walnut & Brass Music-Box Case (x = 50..1030, y = 370..1590) ---
    const caseW = STAGE.right - STAGE.left;
    const caseTop = 370;
    const caseH = STAGE.bottom - caseTop;
    const wood = ctx.createLinearGradient(0, caseTop, 0, STAGE.bottom);
    wood.addColorStop(0, "#1c1311");
    wood.addColorStop(0.55, "#140e0d");
    wood.addColorStop(1, "#1e1412");
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.roundRect(STAGE.left, caseTop, caseW, caseH, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(217, 119, 6, 0.52)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Recessed acoustic soundboard chamber behind the comb (y = 1052..1575) with symmetric twin rosettes!
    ctx.fillStyle = "rgba(10, 8, 12, 0.72)";
    ctx.beginPath();
    ctx.roundRect(STAGE.left + 20, STAGE.contactY + 2, caseW - 40, STAGE.bottom - STAGE.contactY - 18, 12);
    ctx.fill();

    for (const rx of [250, 830] as const) {
      const ry = 1380;
      ctx.strokeStyle = "rgba(217, 119, 6, 0.22)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rx, ry, 54, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rx, ry, 34, 0, Math.PI * 2);
      ctx.stroke();
    }

    // --- 2. Tuned Steel Comb & Vibrating Teeth (x = 84..996, y = 1052..1572) ---
    // Symmetric machined steel comb bedplate at bottom (x = 84..996, y = 1492..1572)
    const bedLeft = 84;
    const bedRight = 996;
    const bedGrad = ctx.createLinearGradient(0, STAGE.combBedTop, 0, STAGE.combBedBottom);
    bedGrad.addColorStop(0, "#cbd5e1");
    bedGrad.addColorStop(0.35, "#94a3b8");
    bedGrad.addColorStop(1, "#475569");
    ctx.fillStyle = bedGrad;
    ctx.beginPath();
    ctx.roundRect(bedLeft, STAGE.combBedTop, bedRight - bedLeft, STAGE.combBedBottom - STAGE.combBedTop, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(241, 245, 249, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Three symmetric brass bedplate bolts (x = 140, 540, 940)
    for (const bx of [140, 540, 940] as const) {
      const by = 0.5 * (STAGE.combBedTop + STAGE.combBedBottom);
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(bx, by, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fef3c7";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = "#451a03";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(bx - 7, by - 4);
      ctx.lineTo(bx + 7, by + 4);
      ctx.stroke();
    }

    // Draw each tuned steel tooth rising from combBedTop to contactY + 2
    for (let i = 0; i < plan.teeth.length; i++) {
      const tooth = plan.teeth[i];
      const motion = toothMotionAt(plan.byTooth[i], t);
      const baseY = STAGE.combBedTop + 2;
      const tipY = STAGE.contactY + 3 + motion.tipDy;
      const tipX = tooth.x + motion.tipDx;
      const halfW = tooth.width * 0.48;
      const tipHalfW = tooth.width * 0.34;

      // Rigid tuned root step from baseY up to tooth.rootY (shows physical tuning graduation!)
      if (baseY > tooth.rootY + 2) {
        ctx.fillStyle = "rgba(100, 116, 139, 0.65)";
        ctx.fillRect(tooth.x - halfW, tooth.rootY, halfW * 2, baseY - tooth.rootY);
      }

      // Flexible steel cantilever bending smoothly from (tooth.x, tooth.rootY) to (tipX, tipY)
      const tGrad = ctx.createLinearGradient(0, tipY, 0, tooth.rootY);
      if (motion.glow > 0.02) {
        tGrad.addColorStop(0, hsla(tooth.hue, 1, 0.85, 1));
        tGrad.addColorStop(0.55, hsla(tooth.hue, 0.85, 0.65, 0.95));
        tGrad.addColorStop(1, "#94a3b8");
      } else {
        tGrad.addColorStop(0, "#f1f5f9");
        tGrad.addColorStop(0.45, "#cbd5e1");
        tGrad.addColorStop(1, "#64748b");
      }
      ctx.fillStyle = tGrad;
      ctx.beginPath();
      ctx.moveTo(tooth.x - halfW, tooth.rootY);
      ctx.quadraticCurveTo(tooth.x - halfW * 0.85, 0.5 * (tooth.rootY + tipY), tipX - tipHalfW, tipY);
      ctx.lineTo(tipX + tipHalfW, tipY);
      ctx.quadraticCurveTo(tooth.x + halfW * 0.85, 0.5 * (tooth.rootY + tipY), tooth.x + halfW, tooth.rootY);
      ctx.closePath();
      ctx.fill();

      // Ghost motion-blur silhouette when vibrating rapidly right after pluck
      if (motion.glow > 0.2) {
        ctx.fillStyle = hsla(tooth.hue, 1, 0.75, 0.28 * motion.glow);
        ctx.beginPath();
        ctx.moveTo(tooth.x - halfW, tooth.rootY);
        ctx.lineTo(tooth.x - motion.tipDx - tipHalfW, tipY);
        ctx.lineTo(tooth.x - motion.tipDx + tipHalfW, tipY);
        ctx.lineTo(tooth.x + halfW, tooth.rootY);
        ctx.closePath();
        ctx.fill();

        ctx.globalCompositeOperation = "lighter";
        drawGlow(ctx, tipX, tipY + 6, 62 + 38 * motion.glow, tooth.hue, 0.72 * motion.glow, 0.24);
        if (motion.pluckAge >= 0 && motion.pluckAge < 0.42) {
          const u = motion.pluckAge / 0.42;
          const r = 10 + 52 * (1 - (1 - u) ** 3);
          ctx.strokeStyle = hsla(tooth.hue, 1, 0.82, (1 - u) ** 1.6 * 0.85);
          ctx.lineWidth = 2.8 * (1 - u);
          ctx.beginPath();
          ctx.arc(tooth.x, STAGE.contactY + 2, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      // Label every octave / landmark pitch neatly along the bedplate
      if (i === 0 || i === plan.teeth.length - 1 || tooth.pitch % 12 === 9 || tooth.pitch % 12 === 4) {
        if (plan.teeth.length <= 28 || i % 2 === 0) {
          ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
          ctx.font = '700 12px "Inter Variable", Inter, sans-serif';
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.fillText(tooth.label, tooth.x, STAGE.combBedTop + 18);
        }
      }
    }

    // --- 3. Rotating Pinned Brass Cylinder (x = 64..1016, y = 382..1050) ---
    drawBrassCylinder(ctx, plan.teeth, plan.events, t, totalSec, loopAngle);

    // Metallic pluck sparks flying off the comb tips
    ctx.globalCompositeOperation = "lighter";
    for (const ev of plan.events) {
      const age = t - ev.tOn;
      if (age < 0) break;
      if (age > 0.6) continue;
      for (let k = 0; k < 5; k++) {
        const sp = pluckSparkAt(ev, k, age);
        if (!sp) continue;
        drawGlow(ctx, sp.x, sp.y, sp.size * 3.1, ev.hue, sp.alpha * 0.85, 0.28);
      }
    }
    ctx.globalCompositeOperation = "source-over";

    // --- 4. Top Bezel with Centred Progress Ring & Pluck Counter (x = 50..1030, y = 290..366) ---
    const hudH = STAGE.hudBottom - STAGE.top;
    ctx.fillStyle = "rgba(20, 15, 16, 0.94)";
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.top, caseW, hudH, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(245, 158, 11, 0.48)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Centred Progress Ring at (540, 328)
    drawProgressRing(ctx, 540, STAGE.top + hudH / 2, 23, progress);

    // Mirror-symmetric left & right readouts (centerX = 260 and 820 -> 540 +/- 280!)
    drawCenteredText(ctx, `PINS  ${plucked} / ${plan.events.length}`, STAGE.top + 45, {
      size: 20,
      weight: 700,
      color: "#fde68a",
      maxWidth: 250,
      letterSpacing: 1.2,
      centerX: 260,
    });
    drawCenteredText(ctx, `REVOLUTION  ${Math.round(progress * 100)}%`, STAGE.top + 45, {
      size: 20,
      weight: 700,
      color: progress > 0.7 ? "#c8ff00" : "#e2e8f0",
      maxWidth: 250,
      letterSpacing: 1.2,
      centerX: 820,
    });

    ctx.restore(); // end camera transform

    drawVignette(ctx, W, H, 0.42);
    drawSceneTitle(ctx, displayScene, label, frame);
  };
}
