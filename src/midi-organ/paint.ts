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
  buildOrganPlan,
  organProgressAt,
  organSectionLabelAt,
  pipeStateAt,
  soundedCountAt,
  STAGE,
  type OrganPipe,
  type PipeState,
} from "./sim.ts";

export const ORGAN_DISPLAY_TITLE = "Toccata in D Minor";

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
    ctx.strokeStyle = progress > 0.55 ? "#c8ff00" : "#f59e0b";
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

function drawCathedralCase(ctx: CanvasRenderingContext2D, totalSpeaking: number, pulse: number) {
  ctx.save();
  const left = STAGE.caseLeft;
  const right = STAGE.caseRight;
  const top = STAGE.hudBottom + 14;
  const bot = STAGE.bottom - 14;
  const w = right - left;

  ctx.beginPath();
  ctx.roundRect(left, top, w, bot - top, 16);
  ctx.clip();

  // Deep cathedral interior slate-navy vault
  const bg = ctx.createLinearGradient(0, top, 0, bot);
  bg.addColorStop(0, "#080d18");
  bg.addColorStop(0.58, "#0b111c");
  bg.addColorStop(1, "#120c08");
  ctx.fillStyle = bg;
  ctx.fillRect(left, top, w, bot - top);

  // Subtle symmetric Gothic nave arches behind the pipes
  for (const offset of [-300, 0, 300]) {
    const ax = 540 + offset;
    const aw = offset === 0 ? 270 : 220;
    const aTop = STAGE.pipesTop + (offset === 0 ? 18 : 2);
    const aBot = STAGE.windchestTop;
    ctx.fillStyle = `rgba(245, 158, 11, ${(0.025 + 0.04 * clamp01(totalSpeaking / 6) + 0.025 * pulse).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(ax - aw / 2, aBot);
    ctx.lineTo(ax - aw / 2, aTop + 100);
    ctx.quadraticCurveTo(ax - aw / 2, aTop + 18, ax, aTop);
    ctx.quadraticCurveTo(ax + aw / 2, aTop + 18, ax + aw / 2, aTop + 100);
    ctx.lineTo(ax + aw / 2, aBot);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(180, 148, 98, 0.16)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // Carved oak side pillars flanking the pipe facade (strictly symmetric on x = 540)
  for (const side of [-1, 1] as const) {
    const px = side < 0 ? left + 2 : right - 20;
    const oak = ctx.createLinearGradient(px, 0, px + 18, 0);
    oak.addColorStop(0, "#241108");
    oak.addColorStop(0.5, "#5a2b14");
    oak.addColorStop(1, "#1c0c06");
    ctx.fillStyle = oak;
    ctx.fillRect(px, top + 6, 18, bot - top - 12);
    ctx.strokeStyle = "rgba(251, 191, 36, 0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px, top + 6, 18, bot - top - 12);
  }

  // Upper cathedral cornice beam & brass pipe-rack support bar
  const cornice = ctx.createLinearGradient(0, STAGE.pipesTop - 16, 0, STAGE.pipesTop + 6);
  cornice.addColorStop(0, "#5c2b14");
  cornice.addColorStop(0.5, "#361709");
  cornice.addColorStop(1, "#1a0a04");
  ctx.fillStyle = cornice;
  ctx.fillRect(left + 16, STAGE.pipesTop - 16, w - 32, 18);
  ctx.strokeStyle = "rgba(251, 191, 36, 0.34)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(left + 16, STAGE.pipesTop + 2);
  ctx.lineTo(right - 16, STAGE.pipesTop + 2);
  ctx.stroke();

  // Horizontal brushed-brass pipe stay rack across mid-facade
  ctx.fillStyle = "rgba(180, 134, 62, 0.42)";
  ctx.fillRect(left + 20, 796, w - 40, 7);
  ctx.fillStyle = "rgba(253, 230, 138, 0.3)";
  ctx.fillRect(left + 20, 796, w - 40, 1.5);

  // Recessed mechanical rollerboard chamber behind the tracker action
  ctx.fillStyle = "#070b12";
  ctx.fillRect(left + 20, STAGE.windchestBottom, w - 40, STAGE.manualTop - STAGE.windchestBottom);

  // Subtle horizontal oak rollerboard frame rails
  ctx.strokeStyle = "rgba(148, 163, 184, 0.14)";
  ctx.lineWidth = 1;
  for (let ry = STAGE.rollerTop + 26; ry < STAGE.rollerBottom; ry += 32) {
    ctx.beginPath();
    ctx.moveTo(left + 26, ry);
    ctx.lineTo(right - 26, ry);
    ctx.stroke();
  }

  // Windchest oak housing bar separating pipes from mechanical rollerboard
  const chest = ctx.createLinearGradient(0, STAGE.windchestTop, 0, STAGE.windchestBottom);
  chest.addColorStop(0, "#612f16");
  chest.addColorStop(0.5, "#3a190a");
  chest.addColorStop(1, "#200c05");
  ctx.fillStyle = chest;
  ctx.fillRect(left + 18, STAGE.windchestTop, w - 36, STAGE.windchestBottom - STAGE.windchestTop);
  ctx.strokeStyle = "rgba(251, 191, 36, 0.38)";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(left + 18, STAGE.windchestTop, w - 36, STAGE.windchestBottom - STAGE.windchestTop);

  // Warm lantern glow rising behind speaking pipes
  const glowA = 0.08 + 0.09 * clamp01(totalSpeaking / 7) + 0.04 * pulse;
  const g = ctx.createRadialGradient(540, 880, 40, 540, 860, 480);
  g.addColorStop(0, `rgba(245, 158, 11, ${glowA.toFixed(3)})`);
  g.addColorStop(0.55, `rgba(200, 255, 0, ${(glowA * 0.42).toFixed(3)})`);
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(left, top, w, STAGE.windchestTop - top);

  ctx.restore();

  // Crisp outer stage border
  ctx.save();
  ctx.strokeStyle = "rgba(251, 191, 36, 0.28)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(left, top, w, bot - top, 16);
  ctx.stroke();
  ctx.restore();
}

function drawPipe(ctx: CanvasRenderingContext2D, pipe: OrganPipe, state: PipeState, t: number) {
  const { pipeX: x, pipeWidth: w, pipeTopY: topY, mouthY, footY, hue } = pipe;
  const hw = w * 0.5;
  const sp = state.speaking;

  ctx.save();

  // 1. Conical brass pipe foot (resting in windchest toe-board)
  const footGrad = ctx.createLinearGradient(x - hw, 0, x + hw, 0);
  footGrad.addColorStop(0, "#4a3014");
  footGrad.addColorStop(0.42, sp > 0.05 ? "#fde68a" : "#b8873d");
  footGrad.addColorStop(0.78, "#754c1e");
  footGrad.addColorStop(1, "#2f1b0a");
  ctx.fillStyle = footGrad;
  ctx.beginPath();
  ctx.moveTo(x - hw * 0.36, footY);
  ctx.lineTo(x + hw * 0.36, footY);
  ctx.lineTo(x + hw, mouthY + 12);
  ctx.lineTo(x - hw, mouthY + 12);
  ctx.closePath();
  ctx.fill();

  // 2. Cylindrical tin-pewter & gilded-brass resonator body
  const bodyGrad = ctx.createLinearGradient(x - hw, 0, x + hw, 0);
  if (sp > 0.04) {
    bodyGrad.addColorStop(0, hsla(hue - 8, 0.48, lerp(0.24, 0.36, sp), 1));
    bodyGrad.addColorStop(0.35, hsla(hue, 0.85, lerp(0.56, 0.84, sp), 1));
    bodyGrad.addColorStop(0.68, hsla(hue - 4, 0.65, lerp(0.38, 0.58, sp), 1));
    bodyGrad.addColorStop(1, "#1e1a16");
  } else {
    // Burnished brushed-tin pewter at rest with gentle warm gold tint on outer tower pipes
    const warm = pipe.u < 0.35;
    bodyGrad.addColorStop(0, warm ? "#382c1d" : "#242c37");
    bodyGrad.addColorStop(0.36, warm ? "#b8965d" : "#93a3b5");
    bodyGrad.addColorStop(0.68, warm ? "#6d522c" : "#4b5868");
    bodyGrad.addColorStop(1, "#161a21");
  }
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(x - hw, topY, w, mouthY + 12 - topY);

  // Subtle side outline + gilded top crown band
  ctx.strokeStyle = sp > 0.05 ? hsla(hue, 0.9, 0.78, 0.72) : "rgba(15, 23, 42, 0.55)";
  ctx.lineWidth = sp > 0.05 ? 1.3 : 0.9;
  ctx.strokeRect(x - hw, topY, w, mouthY + 12 - topY);

  ctx.fillStyle = sp > 0.05 ? "#fef08a" : "#c79a4b";
  ctx.fillRect(x - hw - 0.6, topY - 2, w + 1.2, 4.5);

  // 3. Bevelled pipe mouth (labium) — dark wind aperture at rest, blazing amber-lime when air speaks
  const mouthW = w * 0.72;
  const mouthH = 14;
  ctx.fillStyle = sp > 0.05 ? hsla(hue, 0.95, lerp(0.55, 0.88, sp), 1) : "#0a0d12";
  ctx.fillRect(x - mouthW / 2, mouthY - mouthH / 2, mouthW, mouthH);

  // Triangular upper lip bay leaf above the mouth
  ctx.fillStyle = sp > 0.05 ? "#fef3c7" : "#d4af65";
  ctx.beginPath();
  ctx.moveTo(x - mouthW / 2, mouthY - mouthH / 2);
  ctx.lineTo(x + mouthW / 2, mouthY - mouthH / 2);
  ctx.lineTo(x, mouthY - mouthH / 2 - 12);
  ctx.closePath();
  ctx.fill();

  // 4. Visible pressurized wind column & acoustic mouth/crown ripples when the pipe is speaking!
  if (sp > 0.04) {
    const shimmer = 0.84 + 0.16 * Math.sin(t * 42 + pipe.index * 1.7);
    ctx.globalCompositeOperation = "lighter";

    // Luminous air stream rising inside & above the open mouth + open pipe crown
    const airGrad = ctx.createLinearGradient(0, mouthY, 0, topY - 34);
    airGrad.addColorStop(0, hsla(hue, 0.96, 0.74, 0.65 * sp * shimmer));
    airGrad.addColorStop(0.55, hsla(hue + 8, 0.92, 0.68, 0.28 * sp));
    airGrad.addColorStop(1, hsla(74, 0.96, 0.66, 0.0));
    ctx.fillStyle = airGrad;
    ctx.fillRect(x - hw * 0.62, topY - 34, w * 1.24, mouthY - (topY - 34));

    // Glowing mouth labium flare & top crown wind plume
    drawGlow(ctx, x, mouthY, 26 + 24 * sp, hue, 0.62 * sp * shimmer);
    drawGlow(ctx, x, topY - 6, 22 + 28 * sp, 74, 0.5 * sp * shimmer);

    // Expanding acoustic pressure ripple ring at onset
    if (state.onsetBurst > 0.06 && state.age >= 0 && state.age < 0.55) {
      const rMouth = 10 + state.age * 110;
      ctx.strokeStyle = hsla(hue, 0.96, 0.78, 0.58 * state.onsetBurst);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(x, mouthY, rMouth, 0, Math.PI * 2);
      ctx.stroke();

      const rTop = 8 + state.age * 88;
      ctx.strokeStyle = hsla(74, 0.98, 0.72, 0.45 * state.onsetBurst);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(x, topY, rTop, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.restore();
}

function drawTrackerAndPallet(ctx: CanvasRenderingContext2D, pipe: OrganPipe, state: PipeState) {
  const pull = state.keyDown * 6; // visible downward mechanical travel (px)
  const active = state.keyDown > 0.04;
  const palletY = STAGE.windchestBottom - 16;

  ctx.save();
  // 1. Hinged brass pallet valve inside windchest opening downward when pulled
  const valveW = Math.max(10, pipe.pipeWidth * 0.84);
  const hingeX = pipe.pipeX - valveW * 0.5;
  const openAngle = state.palletOpen * 0.56; // ~32 deg clearly visible mechanical flap tilt
  ctx.save();
  ctx.translate(hingeX, palletY);
  ctx.rotate(openAngle);
  ctx.fillStyle = active ? "#c8ff00" : "#9c783f";
  ctx.fillRect(0, -3.5, valveW, 7);
  ctx.restore();

  // 2. Three-segment physical tracker linkage:
  //    (a) Key pull-down rod: (keyX, manualTop + pull) -> (keyX, rollerY + pull)
  //    (b) Horizontal rollerboard arm: (keyX, rollerY + pull) -> (pipeX, rollerY + pull)
  //    (c) Pallet pull-down wire: (pipeX, rollerY + pull) -> (pipeX, palletY + 4 + pull * 0.5)
  ctx.strokeStyle = active
    ? hsla(pipe.hue, 0.95, 0.74, 0.92)
    : "rgba(180, 150, 102, 0.16)";
  ctx.lineWidth = active ? 2.4 : 0.95;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(pipe.keyX, STAGE.manualTop + 4 + pull);
  ctx.lineTo(pipe.keyX, pipe.rollerY + pull);
  ctx.lineTo(pipe.pipeX, pipe.rollerY + pull);
  ctx.lineTo(pipe.pipeX, palletY + 3 + pull * 0.45);
  ctx.stroke();

  if (active) {
    // Mechanical brass pivot joints at both ends of the roller arm
    ctx.fillStyle = "#fef08a";
    ctx.beginPath();
    ctx.arc(pipe.keyX, pipe.rollerY + pull, 3.2, 0, Math.PI * 2);
    ctx.arc(pipe.pipeX, pipe.rollerY + pull, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, pipe.pipeX, palletY + 2, 18, 74, 0.55 * state.palletOpen);
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.restore();
}

function drawOrganManual(ctx: CanvasRenderingContext2D, pipes: readonly OrganPipe[], states: readonly PipeState[]) {
  ctx.save();
  // Dark mahogany manual cheek-frame
  const frameLeft = STAGE.caseLeft + 10;
  const frameRight = STAGE.caseRight - 10;
  ctx.fillStyle = "#1c0e07";
  ctx.beginPath();
  ctx.roundRect(frameLeft, STAGE.manualTop - 6, frameRight - frameLeft, STAGE.manualBottom - STAGE.manualTop + 14, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(251, 191, 36, 0.34)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Pass 1: 26 ivory natural keys
  for (const pipe of pipes) {
    if (pipe.accidental) continue;
    const st = states[pipe.index];
    const pressY = st.keyDown * 10;
    const x = pipe.keyX - pipe.keyWidth / 2;
    const y = STAGE.manualTop + pressY;
    const h = STAGE.manualBottom - STAGE.manualTop - 4 - pressY * 0.45;

    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    if (st.keyDown > 0.04) {
      grad.addColorStop(0, hsla(pipe.hue, 0.86, 0.62, 1));
      grad.addColorStop(0.55, "#e7f7a1");
      grad.addColorStop(1, "#c8ff00");
    } else {
      grad.addColorStop(0, "#ede5d2");
      grad.addColorStop(0.84, "#d8ccb2");
      grad.addColorStop(1, "#a7987c");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, pipe.keyWidth, h, [2, 2, 5, 5]);
    ctx.fill();
    ctx.strokeStyle = st.keyDown > 0.04 ? "#c8ff00" : "#2e241b";
    ctx.lineWidth = st.keyDown > 0.04 ? 1.6 : 1;
    ctx.stroke();

    // Subtle octave D & A labels near bottom of natural keys
    if (pipe.pitch % 12 === 2 || pipe.pitch % 12 === 9) {
      ctx.fillStyle = st.keyDown > 0.04 ? "#0b141a" : "rgba(45, 32, 20, 0.72)";
      ctx.font = '700 13px "Inter Variable", Inter, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(pipe.label, pipe.keyX, y + h - 8);
    }
  }

  // Pass 2: 18 raised ebony accidental keys on top
  for (const pipe of pipes) {
    if (!pipe.accidental) continue;
    const st = states[pipe.index];
    const pressY = st.keyDown * 8;
    const x = pipe.keyX - pipe.keyWidth / 2;
    const y = STAGE.manualTop + pressY;
    const h = 132 - pressY * 0.4;

    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    if (st.keyDown > 0.04) {
      grad.addColorStop(0, "#f59e0b");
      grad.addColorStop(0.6, "#c8ff00");
      grad.addColorStop(1, "#65a30d");
    } else {
      grad.addColorStop(0, "#242830");
      grad.addColorStop(0.75, "#11151b");
      grad.addColorStop(1, "#07090d");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, pipe.keyWidth, h, [2, 2, 4, 4]);
    ctx.fill();
    ctx.strokeStyle = st.keyDown > 0.04 ? "#fef08a" : "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = st.keyDown > 0.04 ? 1.5 : 1;
    ctx.stroke();
  }

  ctx.restore();
}

export function createOrganPainter(scene: MidiSceneData, label: string): MidiPainter {
  const plan = buildOrganPlan(scene.notes);
  const accents = buildAccents(scene.notes, 0.05, 0.9, 3.6);
  const tailSec = scene.totalFrames / scene.fps - scene.leadSec - scene.endSec;

  return (ctx, frame) => {
    const { width: W, height: H } = scene;
    const t = pieceTime(scene, frame);
    const pulse = accentPulse(accents, t, 0.28);
    const kick = cameraKick(accents, t, 0.42);
    const progress = organProgressAt(t, scene.endSec, tailSec);

    // Precompute exact mechanical & speaking state for all 44 pipes
    const states: PipeState[] = new Array(plan.pipes.length);
    let totalSpeaking = 0;
    for (let i = 0; i < plan.pipes.length; i++) {
      const st = pipeStateAt(plan.byPipe[i], t);
      states[i] = st;
      totalSpeaking += st.speaking;
    }

    // 1. Deep ink backdrop
    ctx.fillStyle = "#04070d";
    ctx.fillRect(0, 0, W, H);
    drawSoft(ctx, 540, 880, 760, 38, 0.075 + 0.04 * clamp01(totalSpeaking / 6));
    drawVignette(ctx, W, H, 0.62);

    // 2. Subtle camera breathing centred on (540, 940)
    ctx.save();
    ctx.translate(540 + kick.dx * 0.45, 940 + kick.dy * 0.45);
    ctx.rotate(kick.rotation * 0.35);
    ctx.scale(1 + kick.zoom * 0.55, 1 + kick.zoom * 0.55);
    ctx.translate(-540, -940);

    // 3. Stage card HUD header (y = 290..366)
    ctx.save();
    ctx.fillStyle = "rgba(9, 13, 21, 0.92)";
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

    const sounded = soundedCountAt(plan.events, t);
    const padN = String(plan.events.length).length;
    ctx.font = '600 23px ui-monospace, "JetBrains Mono", monospace';
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#fde68a";
    ctx.fillText(`PIPES  ${String(sounded).padStart(padN, "0")} / ${plan.events.length}`, STAGE.left + 28, (STAGE.top + STAGE.hudBottom) / 2);

    drawProgressRing(ctx, 540, (STAGE.top + STAGE.hudBottom) / 2, 18, progress);

    ctx.textAlign = "right";
    ctx.fillStyle = progress > 0.78 ? "#c8ff00" : "#fbbf24";
    ctx.fillText(organSectionLabelAt(t, scene.endSec), STAGE.right - 28, (STAGE.top + STAGE.hudBottom) / 2);
    ctx.restore();

    // 4. Cathedral organ case, windchest, and rollerboard frame
    drawCathedralCase(ctx, totalSpeaking, pulse);

    // 5. Mechanical tracker rods & pallet valves (inactive pass first, active luminous pass on top!)
    for (let i = 0; i < plan.pipes.length; i++) {
      if (states[i].keyDown <= 0.04) drawTrackerAndPallet(ctx, plan.pipes[i], states[i]);
    }
    for (let i = 0; i < plan.pipes.length; i++) {
      if (states[i].keyDown > 0.04) drawTrackerAndPallet(ctx, plan.pipes[i], states[i]);
    }

    // 6. 44 graduated tin-and-brass cathedral organ pipes (inactive first, active speaking pipes on top!)
    for (let i = 0; i < plan.pipes.length; i++) {
      if (states[i].speaking <= 0.04) drawPipe(ctx, plan.pipes[i], states[i], t);
    }
    for (let i = 0; i < plan.pipes.length; i++) {
      if (states[i].speaking > 0.04) drawPipe(ctx, plan.pipes[i], states[i], t);
    }

    // 7. Lower 44-key chromatic organ manual
    drawOrganManual(ctx, plan.pipes, states);

    ctx.restore();

    // 8. Framing-standard title block cleanly below top OYREN wordmark
    drawSceneTitle(ctx, { ...scene, title: ORGAN_DISPLAY_TITLE }, label, frame);
  };
}
