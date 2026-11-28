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
  buildHarpsichordPlan,
  harpsichordProgressAt,
  harpsichordSectionLabelAt,
  harpsichordStringStateAt,
  pluckedCountAt,
  STAGE,
  type HarpsichordPlan,
  type HarpsichordString,
  type HarpsichordStringState,
} from "./sim.ts";

export const HARPSICHORD_DISPLAY_TITLE = "Turkish March";

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

function drawSoundboardAndCase(
  ctx: CanvasRenderingContext2D,
  plan: HarpsichordPlan,
  totalEnergy: number,
  pulse: number,
) {
  const { caseLeft: L, caseRight: R, boardTop: T, nutY, jackRailBottom, bottom } = STAGE;
  const W = R - L;

  ctx.save();
  // Outer deep crimson-mahogany lacquered case frame
  ctx.beginPath();
  ctx.roundRect(L, T - 12, W, bottom - 14 - (T - 12), 16);
  const caseGrad = ctx.createLinearGradient(L, T, R, bottom);
  caseGrad.addColorStop(0, "#3a0e14");
  caseGrad.addColorStop(0.5, "#23080c");
  caseGrad.addColorStop(1, "#140608");
  ctx.fillStyle = caseGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(251, 191, 36, 0.38)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Warm satin-spruce open soundboard clipped to the classic curved harpsichord bentside profile
  const first = plan.strings[0];
  const last = plan.strings[plan.strings.length - 1];
  const soundboardPath = () => {
    ctx.beginPath();
    ctx.moveTo(L + 14, nutY);
    ctx.lineTo(L + 14, first.bridgeY - 16);
    for (const s of plan.strings) {
      ctx.lineTo(s.stringX, s.bridgeY - 14);
    }
    ctx.lineTo(R - 14, last.bridgeY - 10);
    ctx.lineTo(R - 14, nutY);
    ctx.closePath();
  };

  const spruce = ctx.createLinearGradient(L, T, R, nutY);
  spruce.addColorStop(0, "#5e3315");
  spruce.addColorStop(0.45, "#7b451c");
  spruce.addColorStop(0.78, "#592f12");
  spruce.addColorStop(1, "#381c0a");
  soundboardPath();
  ctx.fillStyle = spruce;
  ctx.fill();

  // Fine spruce wood-grain + gilt decorative rose soundhole inside the soundboard
  ctx.save();
  soundboardPath();
  ctx.clip();
  ctx.strokeStyle = "rgba(253, 224, 158, 0.065)";
  ctx.lineWidth = 1.2;
  for (let gx = L + 22; gx < R - 16; gx += 18) {
    ctx.beginPath();
    ctx.moveTo(gx, T);
    ctx.lineTo(gx, nutY);
    ctx.stroke();
  }

  // Ornate Baroque gilded soundboard rose at (430, 815)
  const rx = 430;
  const ry = 815;
  const rr = 82;
  ctx.fillStyle = "#180a05";
  ctx.beginPath();
  ctx.arc(rx, ry, rr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(251, 191, 36, ${(0.45 + 0.3 * clamp01(totalEnergy / 5)).toFixed(3)})`;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(rx, ry, rr + 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(200, 255, 0, 0.32)";
  ctx.lineWidth = 1.4;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(rx + Math.cos(a) * 16, ry + Math.sin(a) * 16);
    ctx.lineTo(rx + Math.cos(a) * rr, ry + Math.sin(a) * rr);
    ctx.stroke();
  }
  ctx.strokeStyle = "#fde68a";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(rx, ry, 32, 0, Math.PI * 2);
  ctx.arc(rx, ry, 58, 0, Math.PI * 2);
  ctx.stroke();

  // Soundboard resonance warmth
  const glowA = 0.08 + 0.08 * clamp01(totalEnergy / 6) + 0.04 * pulse;
  const g = ctx.createRadialGradient(rx, ry, 20, 540, 840, 460);
  g.addColorStop(0, `rgba(245, 158, 11, ${glowA.toFixed(3)})`);
  g.addColorStop(0.6, `rgba(200, 255, 0, ${(glowA * 0.38).toFixed(3)})`);
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(L, T, W, nutY - T);
  ctx.restore();

  // Curved gilded beechwood bentside bridge molding & brass hitch pins
  ctx.strokeStyle = "#e6b95c";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  plan.strings.forEach((s, idx) => {
    if (idx === 0) ctx.moveTo(s.stringX, s.bridgeY);
    else ctx.lineTo(s.stringX, s.bridgeY);
  });
  ctx.stroke();
  ctx.strokeStyle = "#451f0a";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Horizontal mahogany lower nut & brass tuning-pin block
  const nutGrad = ctx.createLinearGradient(0, nutY - 10, 0, nutY + 10);
  nutGrad.addColorStop(0, "#5c2a12");
  nutGrad.addColorStop(0.5, "#331407");
  nutGrad.addColorStop(1, "#180803");
  ctx.fillStyle = nutGrad;
  ctx.fillRect(L + 12, nutY - 8, W - 24, 16);
  ctx.strokeStyle = "rgba(251, 191, 36, 0.4)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(L + 12, nutY - 8, W - 24, 16);

  // Dark cutaway mechanical jack-rail bay (y = 1126..1326)
  ctx.fillStyle = "#080b12";
  ctx.fillRect(L + 12, STAGE.jackRailTop + 2, W - 24, STAGE.manualTop - STAGE.jackRailTop - 6);

  // Brushed brass jack-guide mortise rails
  ctx.fillStyle = "rgba(180, 134, 62, 0.45)";
  ctx.fillRect(L + 14, STAGE.jackRailTop + 28, W - 28, 7);
  ctx.fillRect(L + 14, jackRailBottom - 16, W - 28, 7);

  ctx.restore();
}

function drawBrassString(ctx: CanvasRenderingContext2D, s: HarpsichordString, st: HarpsichordStringState) {
  const { stringX: x, bridgeY, pluckY, hue } = s;
  const botY = STAGE.nutY;
  const active = st.vibEnv > 0.03;

  ctx.save();
  // Hitch pin at curved bridge + tuning pin at lower nut
  ctx.fillStyle = active ? "#fef08a" : "#c89d4c";
  ctx.beginPath();
  ctx.arc(x, bridgeY, 3.1, 0, Math.PI * 2);
  ctx.arc(x, botY, 2.8, 0, Math.PI * 2);
  ctx.fill();

  if (active) {
    // Shimmering transverse standing-wave vibration along the full vibrating string length!
    const segs = 20;
    ctx.globalCompositeOperation = "lighter";
    // Motion-blur ghost envelope
    for (const dir of [-1, 1] as const) {
      ctx.strokeStyle = hsla(hue, 0.92, 0.72, 0.24 * st.vibEnv);
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      for (let k = 0; k <= segs; k++) {
        const v = k / segs;
        const py = lerp(bridgeY, botY, v);
        const envShape = Math.sin(Math.PI * v);
        const px = x + dir * envShape * st.vibEnv * lerp(6.8, 4.2, s.u);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";

    // Crisp instantaneous vibrating brass string
    ctx.strokeStyle = hsla(hue, 0.96, lerp(0.68, 0.92, st.vibEnv), 1);
    ctx.lineWidth = lerp(2.6, 1.8, s.u);
    ctx.beginPath();
    for (let k = 0; k <= segs; k++) {
      const v = k / segs;
      const py = lerp(bridgeY, botY, v);
      const px = x + Math.sin(Math.PI * v) * st.vibPx;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Quill-snap glint right at the plectrum crossing point
    if (st.pluckBurst > 0.05) {
      ctx.globalCompositeOperation = "lighter";
      drawGlow(ctx, x, pluckY, 20 + 22 * st.pluckBurst, hue, 0.65 * st.pluckBurst);
      if (st.age >= 0 && st.age < 0.32) {
        ctx.strokeStyle = hsla(hue, 0.96, 0.78, 0.55 * (1 - st.age / 0.32));
        ctx.lineWidth = 1.9;
        ctx.beginPath();
        ctx.arc(x, pluckY, 6 + st.age * 90, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }
  } else {
    // Resting taut brass string
    ctx.strokeStyle = s.u < 0.35 ? "rgba(217, 165, 82, 0.68)" : "rgba(203, 213, 225, 0.52)";
    ctx.lineWidth = lerp(2.1, 1.25, s.u);
    ctx.beginPath();
    ctx.moveTo(x, bridgeY);
    ctx.lineTo(x, botY);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWoodenJackAndLinkage(ctx: CanvasRenderingContext2D, s: HarpsichordString, st: HarpsichordStringState) {
  const active = st.keyDown > 0.04;
  const lift = st.keyDown * 20; // visible upward leap of the harpsichord jack!
  const jackTopY = STAGE.jackRailTop + 26 - lift;
  const jackH = 96;
  const jackW = 10.5;
  const x = s.stringX;

  ctx.save();
  // 1. Key-back-lever mechanical pushrod connecting manual key up to wooden jack bottom
  ctx.strokeStyle = active ? hsla(s.hue, 0.94, 0.74, 0.9) : "rgba(180, 148, 98, 0.18)";
  ctx.lineWidth = active ? 2.2 : 1;
  ctx.beginPath();
  ctx.moveTo(s.keyX, STAGE.manualTop + 4 + st.keyDown * 6);
  ctx.lineTo(s.keyX, STAGE.jackRailBottom + 26);
  ctx.lineTo(x, STAGE.jackRailBottom + 26);
  ctx.lineTo(x, jackTopY + jackH);
  ctx.stroke();

  // 2. Pearwood vertical jack sliding cleanly in its rail slot
  ctx.fillStyle = active ? "#eab308" : "#6b3d1e";
  ctx.beginPath();
  ctx.roundRect(x - jackW / 2, jackTopY, jackW, jackH, 2.5);
  ctx.fill();
  ctx.strokeStyle = active ? "#fef08a" : "rgba(15, 23, 42, 0.75)";
  ctx.lineWidth = active ? 1.4 : 0.9;
  ctx.stroke();

  // 3. White crow-quill plectrum tongue projecting sideways across the string line
  ctx.fillStyle = active ? "#ffffff" : "#cbd5e1";
  ctx.beginPath();
  ctx.moveTo(x + jackW / 2 - 1, jackTopY + 18);
  ctx.lineTo(x + jackW / 2 + 8, jackTopY + 13);
  ctx.lineTo(x + jackW / 2 - 1, jackTopY + 24);
  ctx.closePath();
  ctx.fill();

  // 4. Crimson felt damper flag at jack crown (rests down on string when idle, lifts cleanly when active)
  ctx.fillStyle = active ? "#ff6b6b" : "#b91c1c";
  ctx.fillRect(x - jackW / 2 - 2, jackTopY - 3, jackW + 4, 8);

  if (active) {
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, x, jackTopY + 16, 18, 74, 0.55 * st.keyDown);
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.restore();
}

function drawReversedHarpsichordManual(
  ctx: CanvasRenderingContext2D,
  strings: readonly HarpsichordString[],
  states: readonly HarpsichordStringState[],
) {
  ctx.save();
  // Gilded walnut manual frame
  const fl = STAGE.caseLeft + 10;
  const fr = STAGE.caseRight - 10;
  ctx.fillStyle = "#1a0b07";
  ctx.beginPath();
  ctx.roundRect(fl, STAGE.manualTop - 6, fr - fl, STAGE.manualBottom - STAGE.manualTop + 14, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(251, 191, 36, 0.36)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Pass 1: 24 authentic Baroque EBONY natural keys
  for (const s of strings) {
    if (s.accidental) continue;
    const st = states[s.index];
    const pressY = st.keyDown * 10;
    const x = s.keyX - s.keyWidth / 2;
    const y = STAGE.manualTop + pressY;
    const h = STAGE.manualBottom - STAGE.manualTop - 4 - pressY * 0.45;

    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    if (st.keyDown > 0.04) {
      grad.addColorStop(0, hsla(s.hue, 0.88, 0.56, 1));
      grad.addColorStop(0.6, "#c8ff00");
      grad.addColorStop(1, "#65a30d");
    } else {
      grad.addColorStop(0, "#2b303a");
      grad.addColorStop(0.8, "#161a21");
      grad.addColorStop(1, "#0b0d12");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, s.keyWidth, h, [2, 2, 5, 5]);
    ctx.fill();
    ctx.strokeStyle = st.keyDown > 0.04 ? "#fef08a" : "rgba(251, 191, 36, 0.22)";
    ctx.lineWidth = st.keyDown > 0.04 ? 1.6 : 1;
    ctx.stroke();

    // Subtle gilt octave labels (A & E)
    if (s.pitch % 12 === 9 || s.pitch % 12 === 4) {
      ctx.fillStyle = st.keyDown > 0.04 ? "#0b141a" : "rgba(253, 230, 138, 0.62)";
      ctx.font = '700 13px "Inter Variable", Inter, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(s.label, s.keyX, y + h - 8);
    }
  }

  // Pass 2: 17 authentic Baroque IVORY raised sharp/flat keys!
  for (const s of strings) {
    if (!s.accidental) continue;
    const st = states[s.index];
    const pressY = st.keyDown * 8;
    const x = s.keyX - s.keyWidth / 2;
    const y = STAGE.manualTop + pressY;
    const h = 134 - pressY * 0.4;

    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    if (st.keyDown > 0.04) {
      grad.addColorStop(0, "#fbbf24");
      grad.addColorStop(0.65, "#c8ff00");
      grad.addColorStop(1, "#a3e635");
    } else {
      grad.addColorStop(0, "#f5eedc");
      grad.addColorStop(0.8, "#dfd3b8");
      grad.addColorStop(1, "#a8987b");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, s.keyWidth, h, [2, 2, 4, 4]);
    ctx.fill();
    ctx.strokeStyle = st.keyDown > 0.04 ? "#ffffff" : "#241911";
    ctx.lineWidth = st.keyDown > 0.04 ? 1.6 : 1.1;
    ctx.stroke();
  }

  ctx.restore();
}

export function createHarpsichordPainter(scene: MidiSceneData, label: string): MidiPainter {
  const plan = buildHarpsichordPlan(scene.notes);
  const accents = buildAccents(scene.notes, 0.045, 0.85, 3.2);
  const tailSec = scene.totalFrames / scene.fps - scene.leadSec - scene.endSec;

  return (ctx, frame) => {
    const { width: W, height: H } = scene;
    const t = pieceTime(scene, frame);
    const pulse = accentPulse(accents, t, 0.25);
    const kick = cameraKick(accents, t, 0.34);
    const progress = harpsichordProgressAt(t, scene.endSec, tailSec);

    const states: HarpsichordStringState[] = new Array(plan.strings.length);
    let totalEnergy = 0;
    for (let i = 0; i < plan.strings.length; i++) {
      const st = harpsichordStringStateAt(plan.strings[i], plan.byString[i], t);
      states[i] = st;
      totalEnergy += st.vibEnv;
    }

    // 1. Deep ink backdrop
    ctx.fillStyle = "#04070d";
    ctx.fillRect(0, 0, W, H);
    drawSoft(ctx, 540, 880, 740, 34, 0.07 + 0.045 * clamp01(totalEnergy / 6));
    drawVignette(ctx, W, H, 0.62);

    // 2. Subtle camera breathing centred on (540, 940)
    ctx.save();
    ctx.translate(540 + kick.dx * 0.4, 940 + kick.dy * 0.4);
    ctx.rotate(kick.rotation * 0.3);
    ctx.scale(1 + kick.zoom * 0.48, 1 + kick.zoom * 0.48);
    ctx.translate(-540, -940);

    // 3. Stage card + HUD header
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

    const plucked = pluckedCountAt(plan.events, t);
    const padN = String(plan.events.length).length;
    ctx.font = '600 23px ui-monospace, "JetBrains Mono", monospace';
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#fde68a";
    ctx.fillText(`QUILLS  ${String(plucked).padStart(padN, "0")} / ${plan.events.length}`, STAGE.left + 28, (STAGE.top + STAGE.hudBottom) / 2);

    drawProgressRing(ctx, 540, (STAGE.top + STAGE.hudBottom) / 2, 18, progress);

    ctx.textAlign = "right";
    ctx.fillStyle = progress > 0.6 ? "#c8ff00" : "#fbbf24";
    ctx.fillText(harpsichordSectionLabelAt(t, scene.endSec), STAGE.right - 28, (STAGE.top + STAGE.hudBottom) / 2);
    ctx.restore();

    // 4. Harpsichord crimson case, open spruce soundboard, bentside bridge & jack bay
    drawSoundboardAndCase(ctx, plan, totalEnergy, pulse);

    // 5. 41 wooden jacks & key pushrods (idle first, active rising jacks on top)
    for (let i = 0; i < plan.strings.length; i++) {
      if (states[i].keyDown <= 0.04) drawWoodenJackAndLinkage(ctx, plan.strings[i], states[i]);
    }
    for (let i = 0; i < plan.strings.length; i++) {
      if (states[i].keyDown > 0.04) drawWoodenJackAndLinkage(ctx, plan.strings[i], states[i]);
    }

    // 6. 41 brass strings (resting first, active vibrating strings on top)
    for (let i = 0; i < plan.strings.length; i++) {
      if (states[i].vibEnv <= 0.03) drawBrassString(ctx, plan.strings[i], states[i]);
    }
    for (let i = 0; i < plan.strings.length; i++) {
      if (states[i].vibEnv > 0.03) drawBrassString(ctx, plan.strings[i], states[i]);
    }

    // 7. Reversed-colour Baroque harpsichord manual (ebony naturals + ivory sharps)
    drawReversedHarpsichordManual(ctx, plan.strings, states);

    ctx.restore();

    // 8. Framing-standard title block cleanly below top OYREN wordmark
    drawSceneTitle(ctx, { ...scene, title: HARPSICHORD_DISPLAY_TITLE }, label, frame);
  };
}
