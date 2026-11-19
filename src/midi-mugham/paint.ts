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
  lowerBound,
  smoothstep,
} from "../midi/kit.ts";
import { MUGHAM_SHUR_CLASSES } from "../midi/pieces.ts";
import { pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import {
  BASS_STRING_Y,
  bassHandPoseAt,
  brushParticleAt,
  buildMughamEvents,
  eventStateAt,
  KAMANCHA_Y,
  MEDALLION_CX,
  MEDALLION_CY,
  MELODY_MAX_PITCH,
  MELODY_MIN_PITCH,
  melodyPitchToX,
  mizrabPoseAt,
  mughamSectionLabelAt,
  PIANO_STRIKE_Y,
  PITCH_AXIS_LEFT,
  PITCH_AXIS_RIGHT,
  STAGE,
  TAR_COURSE_Y,
  type MughamNoteEvent,
} from "./sim.ts";

const BLACK_CLASSES = new Set([1, 3, 6, 8, 10]);
const SHUR_SET = new Set<number>(MUGHAM_SHUR_CLASSES);

function activeBpmAt(scene: MidiSceneData, t: number): number {
  if (!scene.tempoMap.length) return 120;
  let mpq = scene.tempoMap[0].microsecondsPerQuarter;
  for (const change of scene.tempoMap) {
    if (change.timeSec <= Math.max(0, t)) mpq = change.microsecondsPerQuarter;
    else break;
  }
  return Math.round(60e6 / mpq);
}

/** Quiet decorative boteh (almond-teardrop) filigree motif for stage corners. */
function drawBotehCorner(ctx: CanvasRenderingContext2D, x: number, y: number, flipX: number, flipY: number, alpha: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flipX, flipY);
  ctx.strokeStyle = `rgba(245, 158, 11, ${alpha.toFixed(3)})`;
  ctx.fillStyle = `rgba(245, 158, 11, ${(alpha * 0.24).toFixed(3)})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, 14);
  ctx.bezierCurveTo(14, 14, 22, 4, 20, -8);
  ctx.bezierCurveTo(18, -18, 6, -22, 2, -28);
  ctx.bezierCurveTo(-4, -18, -12, -8, -10, 4);
  ctx.bezierCurveTo(-8, 11, -4, 14, 0, 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(4, -2, 4.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Draws the brass/ebony Mizrab plectrum + sculpted plucking hand silhouette at (x, y). */
function drawMizrab(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, glow01: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (glow01 > 0.02) {
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, -10, 8, 68, 44, 0.45 * glow01, 0.22);
    ctx.globalCompositeOperation = "source-over";
  }
  // Sculpted brass-and-wax mizrab loop + tapered pick tip pointing to (-14, 14)
  const g = ctx.createLinearGradient(-16, 16, 18, -22);
  g.addColorStop(0, "#fef08a");
  g.addColorStop(0.5, "#f59e0b");
  g.addColorStop(1, "#78350f");
  ctx.fillStyle = g;
  ctx.strokeStyle = "rgba(254, 249, 195, 0.9)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-16, 14);
  ctx.quadraticCurveTo(-2, -6, 16, -20);
  ctx.arc(18, -14, 9, -Math.PI * 0.65, Math.PI * 0.45);
  ctx.quadraticCurveTo(6, 6, -16, 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Inner finger ring hole
  ctx.fillStyle = "#0b1120";
  ctx.beginPath();
  ctx.arc(14, -12, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Draws two fanned steel-wire jazz brushes sweeping across the central 7/8 snare medallion. */
function drawJazzBrushes(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  swirlPhase: number,
  tapSnap: number,
  activeGlow: number,
) {
  for (const side of [-1, 1] as const) {
    ctx.save();
    const orbit = swirlPhase + (side > 0 ? 0 : Math.PI);
    const rad = 20 - tapSnap * 11;
    const tipX = cx + Math.cos(orbit) * rad * 0.65 - side * 8;
    const tipY = cy + Math.sin(orbit) * rad * 0.55;
    ctx.translate(tipX, tipY);
    ctx.rotate(side * (-0.62 + 0.22 * Math.sin(swirlPhase) + tapSnap * 0.28));

    // Fanned steel wires (11 fine bristles)
    ctx.strokeStyle = `rgba(226, 232, 240, ${(0.62 + 0.34 * activeGlow).toFixed(3)})`;
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    for (let w = -5; w <= 5; w++) {
      const a = w * 0.068;
      ctx.moveTo(side * 34, 26);
      ctx.lineTo(side * 34 - side * Math.cos(a) * 38, 26 - Math.sin(a + 0.65) * 38);
    }
    ctx.stroke();

    // Rubber-sleeved brush handle
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 5.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(side * 34, 26);
    ctx.lineTo(side * 66, 52);
    ctx.stroke();
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.restore();
  }
}

export function createMughamPainter(scene: MidiSceneData, label: string): MidiPainter {
  const events = buildMughamEvents(scene.notes);
  const tarEvents = events.filter((e) => e.role === "tar");
  const kamanchaEvents = events.filter((e) => e.role === "kamancha");
  const pianoEvents = events.filter((e) => e.role === "piano");
  const bassEvents = events.filter((e) => e.role === "bass");
  const brushEvents = events.filter((e) => e.role === "brush");

  const pianoByPitch = new Map<number, MughamNoteEvent[]>();
  for (const ev of pianoEvents) {
    const p = clamp(ev.pitch, MELODY_MIN_PITCH, MELODY_MAX_PITCH);
    const list = pianoByPitch.get(p);
    if (list) list.push(ev);
    else pianoByPitch.set(p, [ev]);
  }

  const accents = buildAccents(scene.notes, 0.04, 0.85, 3.3);
  const tailSec = scene.totalFrames / scene.fps - scene.leadSec - scene.endSec;
  const totalSec = scene.totalFrames / scene.fps;
  const { width: W, height: H } = scene;
  const stageW = STAGE.right - STAGE.left;

  const motes = Array.from({ length: 44 }, (_, i) => ({
    x: STAGE.left + 26 + hash01(i, 21) * (stageW - 52),
    y: STAGE.tarTop + 20 + hash01(i, 22) * (STAGE.bottom - STAGE.tarTop - 40),
    r: 1.1 + 1.6 * hash01(i, 23),
    phase: hash01(i, 24) * Math.PI * 2,
    hue: i % 3 === 0 ? 198 : 42,
  }));

  return (ctx, frame) => {
    const t = pieceTime(scene, frame);
    const loopPhase = (2 * Math.PI * frame) / Math.max(1, scene.totalFrames);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // Deep nocturnal Baku-slate background — kept strictly dark (< 0.015 luminance) across y = 0..280
    // so the quiet Oyren wordmark at y = 95..156 maintains > 11:1 WCAG contrast on every frame!
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#05070e");
    bg.addColorStop(0.16, "#060913");
    bg.addColorStop(0.55, "#080d1a");
    bg.addColorStop(1, "#050811");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const kick = cameraKick(accents, t, 0.55);
    const pulse = accentPulse(accents, t, 0.2);
    const climax01 = smoothstep(35.0, 38.5, t) * (1 - smoothstep(scene.endSec - 5.2, scene.endSec - 3.6, t));

    ctx.save();
    // Clip ambient stage glows below y = 285 so top brand header contrast is never diluted
    ctx.beginPath();
    ctx.rect(0, 282, W, H - 282);
    ctx.clip();

    const cx = 540;
    const cy = 970;
    ctx.translate(cx + kick.dx * 0.55, cy + kick.dy * 0.55);
    ctx.rotate(kick.rotation * 0.45);
    ctx.scale(1 + kick.zoom * 0.65, 1 + kick.zoom * 0.65);
    ctx.translate(-cx, -cy);

    // Warm amber Tar glow above + cool sapphire Jazz Piano glow below
    ctx.globalCompositeOperation = "lighter";
    drawSoft(ctx, 540 + 28 * Math.sin(loopPhase), 640, 1280, 38, 0.13 + 0.14 * climax01 + 0.06 * Math.min(1, pulse));
    drawSoft(ctx, 540 - 28 * Math.sin(loopPhase), 1240, 1280, 204, 0.12 + 0.14 * climax01 + 0.06 * Math.min(1, pulse));
    ctx.globalCompositeOperation = "source-over";

    // --- Stage Backdrop Panel (x = 50..1030, y = 360..1645) ---
    const panelGrad = ctx.createLinearGradient(0, STAGE.tarTop, 0, STAGE.bottom);
    panelGrad.addColorStop(0, "rgba(17, 14, 24, 0.90)");
    panelGrad.addColorStop(0.42, "rgba(12, 18, 32, 0.92)");
    panelGrad.addColorStop(1, "rgba(9, 14, 26, 0.94)");
    ctx.fillStyle = panelGrad;
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.tarTop, stageW, STAGE.bottom - STAGE.tarTop, [6, 6, 14, 14]);
    ctx.fill();

    // Subtle vertical semitone guide hairlines uniting Tar frets and Grand Piano hammers along x = 96..984
    for (let p = MELODY_MIN_PITCH; p <= MELODY_MAX_PITCH; p++) {
      const x = melodyPitchToX(p);
      const isTonic = p % 12 === 2; // D
      const isShur = SHUR_SET.has(p % 12);
      ctx.strokeStyle = isTonic
        ? "rgba(251, 191, 36, 0.19)"
        : isShur
          ? "rgba(148, 163, 184, 0.08)"
          : "rgba(71, 85, 105, 0.04)";
      ctx.lineWidth = isTonic ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(x, STAGE.tarTop + 80);
      ctx.lineTo(x, STAGE.pianoKeyTop);
      ctx.stroke();
    }

    // Floating warm dust motes (strictly periodic in loopPhase)
    for (const m of motes) {
      const py = STAGE.tarTop + 20 + (((m.y - STAGE.tarTop - 20 + Math.sin(loopPhase + m.phase) * 16) % 1220 + 1220) % 1220);
      ctx.fillStyle = hsla(m.hue, 0.85, 0.72, 0.18);
      ctx.beginPath();
      ctx.arc(m.x, py, m.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // =========================================================================
    // 1. UPPER DECK: Horizontal Tar & Bowed Kamancha Resonator (y = 360..890)
    // =========================================================================
    // Section label subtle watermark inside upper deck
    drawCenteredText(ctx, "TAR  \u00b7  FRETTED NECK & SYMPATHETIC STRINGS", 408, {
      size: 16,
      weight: 600,
      color: "rgba(253, 224, 71, 0.56)",
      letterSpacing: 2.4,
    });

    // Bowed Kamancha drone rail (y = 508)
    ctx.strokeStyle = "rgba(217, 119, 6, 0.55)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(PITCH_AXIS_LEFT - 14, KAMANCHA_Y);
    ctx.lineTo(PITCH_AXIS_RIGHT + 14, KAMANCHA_Y);
    ctx.stroke();

    // Active Kamancha bowed vibration + gliding horsehair bow
    let bowX = 220 + 14 * Math.sin(loopPhase);
    let bowActive = 0;
    let bowStroke = 0;
    for (const ev of kamanchaEvents) {
      const st = eventStateAt(ev, t);
      if (!st) continue;
      const w = Math.max(st.prep * 0.6, st.sustain, st.strike);
      if (w > bowActive) {
        bowActive = w;
        bowX = ev.x;
        const age = Math.max(0, t - ev.tOn);
        bowStroke = st.active ? Math.sin(age * 3.8) * 28 : -20 * (1 - st.prep);
      }
      if (st.active || st.sustain > 0.03) {
        const amp = 7 * st.sustain;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = hsla(28, 0.95, 0.66, 0.75 * st.sustain);
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        for (let sx = ev.x; sx <= PITCH_AXIS_RIGHT; sx += 12) {
          const u = (sx - ev.x) / Math.max(24, PITCH_AXIS_RIGHT - ev.x);
          const wy = KAMANCHA_Y + Math.sin(u * Math.PI * 3 + t * 44) * Math.sin(u * Math.PI) * amp;
          if (sx === ev.x) ctx.moveTo(sx, wy);
          else ctx.lineTo(sx, wy);
        }
        ctx.stroke();
        drawGlow(ctx, ev.x, KAMANCHA_Y, 76, 30, 0.48 * st.sustain);
        ctx.restore();
      }
    }

    // Horsehair Kamancha bow sprite at (bowX, KAMANCHA_Y)
    ctx.save();
    ctx.translate(bowX + bowStroke, KAMANCHA_Y);
    ctx.globalAlpha = 0.34 + 0.66 * bowActive;
    ctx.strokeStyle = "#fde68a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-58, -8);
    ctx.lineTo(58, 8);
    ctx.stroke();
    ctx.strokeStyle = "#92400e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-60, -14);
    ctx.quadraticCurveTo(0, -24, 60, -2);
    ctx.stroke();
    ctx.restore();

    // Sculpted symmetric Tar resonator silhouette (left peghead + mulberry neck + right figure-eight soundbox)
    const neckTop = 574;
    const neckBot = 706;
    ctx.save();
    // Double-bowl mulberry soundbox at right end (x = 858..1010) & balancing carved scroll at left (x = 68..134)
    ctx.fillStyle = "rgba(69, 26, 3, 0.55)";
    ctx.strokeStyle = "rgba(245, 158, 11, 0.38)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(956, 640, 50, 78, 0, 0, Math.PI * 2);
    ctx.ellipse(886, 640, 36, 56, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(72, neckTop + 14, 52, neckBot - neckTop - 28, 14);
    ctx.fill();
    ctx.stroke();

    // Long pearl-inlaid walnut fingerboard (x = 96..984, y = 574..706)
    const neckGrad = ctx.createLinearGradient(0, neckTop, 0, neckBot);
    neckGrad.addColorStop(0, "#291509");
    neckGrad.addColorStop(0.5, "#3b1d0b");
    neckGrad.addColorStop(1, "#1f1007");
    ctx.fillStyle = neckGrad;
    ctx.beginPath();
    ctx.roundRect(PITCH_AXIS_LEFT - 8, neckTop, PITCH_AXIS_RIGHT - PITCH_AXIS_LEFT + 16, neckBot - neckTop, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.45)";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Tied gut frets along the Tar neck + microtonal +40c Shur Eb fret markers!
    for (let p = MELODY_MIN_PITCH; p <= MELODY_MAX_PITCH; p++) {
      const fx = melodyPitchToX(p);
      const pc = p % 12;
      const isTonic = pc === 2;
      const isShur = SHUR_SET.has(pc);
      ctx.strokeStyle = isTonic
        ? "rgba(253, 224, 71, 0.82)"
        : isShur
          ? "rgba(248, 250, 252, 0.46)"
          : "rgba(148, 163, 184, 0.18)";
      ctx.lineWidth = isTonic ? 2.4 : isShur ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(fx, neckTop + 3);
      ctx.lineTo(fx, neckBot - 3);
      ctx.stroke();

      if (isTonic) {
        // Mother-of-pearl diamond inlay on D octaves (D3, D4, D5, D6)
        ctx.fillStyle = "rgba(254, 240, 138, 0.72)";
        ctx.beginPath();
        ctx.moveTo(fx, 632);
        ctx.lineTo(fx + 5, 640);
        ctx.lineTo(fx, 648);
        ctx.lineTo(fx - 5, 640);
        ctx.closePath();
        ctx.fill();
      }
      // Dashed microtonal +40c Shur neutral-second fret next to Eb4 (63) and Eb5 (75)
      if (p === 63 || p === 75) {
        const microX = melodyPitchToX(p, 40);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(200, 255, 0, 0.68)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(microX, neckTop + 5);
        ctx.lineTo(microX, neckBot - 5);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();

    // Compute active Tar strikes for string standing waves and sympathetic shimmer
    const winTarStart = Math.max(0, lowerBound(scene.notes, t - 2.4) - 8);
    const winTarEnd = Math.min(events.length, lowerBound(scene.notes, t + 0.45) + 4);
    let sympatheticEnergy = 0;
    const courseAmp = [0, 0, 0];
    const courseFretX = [PITCH_AXIS_LEFT, PITCH_AXIS_LEFT, PITCH_AXIS_LEFT];
    const courseHue = [42, 42, 42];

    for (let i = winTarStart; i < winTarEnd; i++) {
      const ev = events[i];
      if (ev.role !== "tar") continue;
      const st = eventStateAt(ev, t);
      if (!st || !st.active) continue;
      const e = Math.max(st.strike, st.sustain);
      sympatheticEnergy += e * (Math.abs(ev.pitchBendCents) > 10 ? 1.45 : 0.75);
      if (e >= courseAmp[ev.stringIdx]) {
        courseAmp[ev.stringIdx] = e;
        courseFretX[ev.stringIdx] = ev.x;
        courseHue[ev.stringIdx] = ev.hue;
      }
    }
    sympatheticEnergy = clamp01(sympatheticEnergy);

    // Draw the 3 paired melodic Tar courses (y = 604, 640, 676)
    for (let c = 0; c < 3; c++) {
      const cyCourse = TAR_COURSE_Y[c];
      const amp = courseAmp[c];
      const fx = courseFretX[c];

      // Unvibrating left segment [left..fx] + paired strings
      ctx.strokeStyle = c === 0 ? "rgba(248, 250, 252, 0.72)" : c === 1 ? "rgba(253, 224, 71, 0.72)" : "rgba(217, 119, 6, 0.78)";
      ctx.lineWidth = 1.5;
      for (const dy of [-2.2, 2.2]) {
        ctx.beginPath();
        ctx.moveTo(PITCH_AXIS_LEFT - 12, cyCourse + dy);
        ctx.lineTo(amp > 0.02 ? fx : PITCH_AXIS_RIGHT + 14, cyCourse + dy);
        ctx.stroke();
      }

      if (amp > 0.02) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = hsla(courseHue[c], 0.98, 0.72, 0.45 + 0.55 * amp);
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        for (let sx = fx; sx <= PITCH_AXIS_RIGHT + 12; sx += 10) {
          const u = clamp01((sx - fx) / Math.max(24, PITCH_AXIS_RIGHT + 12 - fx));
          const wy = cyCourse + Math.sin(u * Math.PI) * Math.sin(u * Math.PI * 4 + frame * 0.85) * 11 * amp;
          if (sx === fx) ctx.moveTo(sx, wy);
          else ctx.lineTo(sx, wy);
        }
        ctx.stroke();
        drawGlow(ctx, fx, cyCourse, 64 + 34 * amp, courseHue[c], 0.62 * amp, 0.22);
        ctx.restore();
      }
    }

    // 7 Fine Sympathetic Strings (Zəng / Kök Simlər, y = 736..844) shimmering on ornaments & bends!
    for (let s = 0; s < 7; s++) {
      const sy = 736 + s * 18;
      const sh = clamp01(sympatheticEnergy * (0.55 + 0.45 * Math.sin(frame * 0.42 + s * 1.1)));
      ctx.strokeStyle = sh > 0.05
        ? hsla(lerp(42, 78, sh), 0.95, 0.7, 0.28 + 0.58 * sh)
        : "rgba(148, 163, 184, 0.22)";
      ctx.lineWidth = 1 + 1.2 * sh;
      ctx.beginPath();
      if (sh > 0.06) {
        for (let sx = PITCH_AXIS_LEFT; sx <= PITCH_AXIS_RIGHT; sx += 18) {
          const u = (sx - PITCH_AXIS_LEFT) / (PITCH_AXIS_RIGHT - PITCH_AXIS_LEFT);
          const wy = sy + Math.sin(u * Math.PI * (2 + (s % 3)) + frame * 0.65 + s) * 4.5 * sh;
          if (sx === PITCH_AXIS_LEFT) ctx.moveTo(sx, wy);
          else ctx.lineTo(sx, wy);
        }
      } else {
        ctx.moveTo(PITCH_AXIS_LEFT, sy);
        ctx.lineTo(PITCH_AXIS_RIGHT, sy);
      }
      ctx.stroke();
    }

    // Fretting finger marker + swinging Mizrab plectrum on the Tar!
    const mizrab = mizrabPoseAt(tarEvents, t, scene.leadSec, scene.endSec, tailSec);
    ctx.save();
    const fretHue = mizrab.microtonalGlow > 0.1 ? 78 : 44;
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, mizrab.fretX, mizrab.fretY, 46 + 38 * mizrab.microtonalGlow, fretHue, 0.42 + 0.45 * mizrab.pluckDeflection);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = mizrab.microtonalGlow > 0.1 ? "#c8ff00" : "#fde047";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mizrab.fretX, mizrab.fretY, 8.5 + 3 * mizrab.microtonalGlow, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (mizrab.microtonalGlow > 0.18) {
      drawCenteredText(ctx, "+40\u00a2 BEND", mizrab.fretY - 20, {
        size: 14,
        weight: 700,
        color: "#c8ff00",
        maxWidth: 120,
        centerX: clamp(mizrab.fretX, 195, 885),
      });
    }
    ctx.restore();
    drawMizrab(ctx, mizrab.x, mizrab.y, mizrab.angle, mizrab.pluckDeflection);

    // =========================================================================
    // 2. CENTRAL BRIDGE: Call-and-Response Arcs + 7/8 Jazz-Brush Medallion
    // =========================================================================
    // Harmonic dialogue ribbons linking recent Tar notes <-> Piano notes (and simultaneous octave climax pairs!)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = winTarStart; i < winTarEnd; i++) {
      const ev = events[i];
      if (ev.role !== "tar" && ev.role !== "piano") continue;
      const age = t - ev.tOn;
      if (age < 0 || age > 0.55) continue;
      // Find closest complementary instrument note within 0.65 s
      const partnerPool = ev.role === "tar" ? pianoEvents : tarEvents;
      const pIdx = lowerBound(
        partnerPool.map((p) => p.note),
        ev.tOn - 0.55,
      );
      for (let k = Math.max(0, pIdx - 2); k < Math.min(partnerPool.length, pIdx + 4); k++) {
        const other = partnerPool[k];
        const dt = Math.abs(ev.tOn - other.tOn);
        if (dt > 0.55) continue;
        const isOctaveUnison = dt < 0.05 && Math.abs(Math.abs(ev.pitch - other.pitch) - 12) <= 1;
        const fade = (1 - age / 0.55) * (1 - dt / 0.6) * (isOctaveUnison ? 0.85 : 0.34);
        if (fade <= 0.02) continue;
        const tx = ev.role === "tar" ? ev.x : other.x;
        const ty = ev.role === "tar" ? ev.yTarget : other.yTarget;
        const px = ev.role === "piano" ? ev.x : other.x;
        const py = PIANO_STRIKE_Y;
        const grad = ctx.createLinearGradient(tx, ty, px, py);
        grad.addColorStop(0, hsla(44, 0.98, 0.68, fade));
        grad.addColorStop(0.5, hsla(isOctaveUnison ? 78 : 168, 0.95, 0.72, fade * 0.9));
        grad.addColorStop(1, hsla(200, 0.98, 0.68, fade));
        ctx.strokeStyle = grad;
        ctx.lineWidth = isOctaveUnison ? 3.2 : 1.8;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.bezierCurveTo(lerp(tx, 540, 0.25), 885, lerp(px, 540, 0.25), 1048, px, py);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();

    // Central horizontal divider rail & symmetric 2+2+3 rhythm pulse lanterns
    ctx.strokeStyle = "rgba(251, 191, 36, 0.26)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(STAGE.left + 24, MEDALLION_CY);
    ctx.lineTo(MEDALLION_CX - 78, MEDALLION_CY);
    ctx.moveTo(MEDALLION_CX + 78, MEDALLION_CY);
    ctx.lineTo(STAGE.right - 24, MEDALLION_CY);
    ctx.stroke();

    // Active brush impact state for the snare medallion & 2+2+3 step indicator
    let brushGlow = 0;
    let brushTapSnap = 0;
    let brushCountSoFar = 0;
    for (const bev of brushEvents) {
      if (bev.tOn <= t) brushCountSoFar++;
      const st = eventStateAt(bev, t);
      if (!st) continue;
      brushGlow = Math.max(brushGlow, st.strike, st.sustain * 0.8);
      if (bev.stringIdx > 0 && st.active) brushTapSnap = Math.max(brushTapSnap, st.strike);
    }

    // Symmetric 2 + 2 + 3 heptagonal pulse dots on left & right of medallion (5 pulse hits per 7/8 bar -> highlight group)
    const activeGroup = brushCountSoFar === 0 ? -1 : (brushCountSoFar - 1) % 5; // 0:[1,2], 1:[3,4], 2..4:[5,6,7]
    const pulseOffsets = [-285, -255, -210, -180, -135, -110, -85];
    const subIdxToHit = [0, 0, 1, 1, 2, 3, 4];
    for (const mirror of [-1, 1] as const) {
      pulseOffsets.forEach((off, idx) => {
        const lx = MEDALLION_CX + mirror * Math.abs(off);
        const lit = subIdxToHit[idx] === activeGroup && brushGlow > 0.08 ? brushGlow : 0;
        ctx.fillStyle = lit > 0.05 ? hsla(48, 1, 0.72, 0.45 + 0.55 * lit) : "rgba(148, 163, 184, 0.24)";
        ctx.beginPath();
        ctx.arc(lx, MEDALLION_CY, idx === 0 || idx === 2 || idx === 4 ? 5.2 : 3.6, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Coated calfskin snare medallion at (540, 968)
    const medR = 56;
    ctx.save();
    if (brushGlow > 0.02) {
      ctx.globalCompositeOperation = "lighter";
      drawGlow(ctx, MEDALLION_CX, MEDALLION_CY, medR * 3.1, 46, 0.46 * brushGlow, 0.25);
      ctx.globalCompositeOperation = "source-over";
    }
    const skinGrad = ctx.createRadialGradient(MEDALLION_CX, MEDALLION_CY, 4, MEDALLION_CX, MEDALLION_CY, medR);
    skinGrad.addColorStop(0, hsla(44, 0.45, 0.26 + 0.16 * brushGlow, 0.96));
    skinGrad.addColorStop(0.75, "#1e293b");
    skinGrad.addColorStop(1, "#0f172a");
    ctx.fillStyle = skinGrad;
    ctx.beginPath();
    ctx.arc(MEDALLION_CX, MEDALLION_CY, medR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hsla(44, 0.9, 0.64, 0.55 + 0.4 * brushGlow);
    ctx.lineWidth = 3;
    ctx.stroke();

    // Brushed swirl rings + radial brush-tap sparks
    ctx.strokeStyle = `rgba(226, 232, 240, ${(0.18 + 0.35 * brushGlow).toFixed(3)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(MEDALLION_CX, MEDALLION_CY, 34, loopPhase * 4, loopPhase * 4 + Math.PI * 1.45);
    ctx.stroke();

    ctx.globalCompositeOperation = "lighter";
    for (const bev of brushEvents) {
      const age = t - bev.tOn;
      if (age < 0 || age > 0.5) continue;
      for (let k = 0; k < 6; k++) {
        const sp = brushParticleAt(bev.seed, k, age);
        if (!sp) continue;
        drawGlow(ctx, MEDALLION_CX + sp.dx, MEDALLION_CY + sp.dy, sp.r * 3.4, 48, sp.alpha * 0.72, 0.28);
      }
    }
    ctx.restore();

    const swirlAngle = loopPhase * 6 + brushCountSoFar * 0.55;
    drawJazzBrushes(ctx, MEDALLION_CX, MEDALLION_CY, swirlAngle, brushTapSnap, brushGlow);

    // =========================================================================
    // 3. LOWER DECK: Exposed Grand-Piano Hammers & Upright Bass (y = 1045..1645)
    // =========================================================================
    drawCenteredText(ctx, "JAZZ PIANO HAMMERS  \u00b7  UPRIGHT DOUBLE BASS", 1084, {
      size: 16,
      weight: 600,
      color: "rgba(125, 211, 252, 0.60)",
      letterSpacing: 2.4,
    });

    // Horizontal bronze piano string strike rail (y = 1118)
    ctx.strokeStyle = "rgba(56, 189, 248, 0.52)";
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(PITCH_AXIS_LEFT - 12, PIANO_STRIKE_Y);
    ctx.lineTo(PITCH_AXIS_RIGHT + 12, PIANO_STRIKE_Y);
    ctx.stroke();

    // Precompute per-semitone piano hammer & key states (p = 48..86)
    const hammerRestY = 1212;
    const keySpanW = (PITCH_AXIS_RIGHT - PITCH_AXIS_LEFT) / (MELODY_MAX_PITCH - MELODY_MIN_PITCH + 1);
    const activePianoStates = new Map<number, { travel: number; glow: number; hue: number }>();

    for (let p = MELODY_MIN_PITCH; p <= MELODY_MAX_PITCH; p++) {
      const list = pianoByPitch.get(p);
      if (!list) continue;
      let travel = 0;
      let glow = 0;
      let hue = 202;
      for (const ev of list) {
        const st = eventStateAt(ev, t);
        if (!st) continue;
        // Cock down slightly on prep, snap to 1.0 at exact tOn, rebound cleanly
        const tr = st.active
          ? Math.exp(-(t - ev.tOn) / 0.075)
          : -0.18 * Math.sin(Math.PI * st.prep);
        if (Math.abs(tr) > Math.abs(travel)) travel = tr;
        const g = Math.max(st.strike, st.sustain);
        if (g >= glow) {
          glow = g;
          hue = ev.hue;
        }
      }
      if (Math.abs(travel) > 0.004 || glow > 0.01) {
        activePianoStates.set(p, { travel, glow, hue });
      }
    }

    // Draw all 39 exposed mahogany & felt grand-piano hammers (aligned 1-to-1 with pitch axis!)
    for (let p = MELODY_MIN_PITCH; p <= MELODY_MAX_PITCH; p++) {
      const hx = melodyPitchToX(p);
      const st = activePianoStates.get(p);
      const travel = st ? st.travel : 0;
      const glow = st ? st.glow : 0;
      const headY = lerp(hammerRestY, PIANO_STRIKE_Y + 8, travel);

      // Wooden hammer shank
      ctx.strokeStyle = glow > 0.05 ? "rgba(186, 230, 253, 0.75)" : "rgba(148, 163, 184, 0.28)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx, STAGE.pianoKeyTop - 8);
      ctx.lineTo(hx, headY + 8);
      ctx.stroke();

      // Tapered wool-felt hammer head
      ctx.fillStyle = glow > 0.05 ? hsla(st!.hue, 0.95, 0.68, 0.95) : BLACK_CLASSES.has(p % 12) ? "#334155" : "#cbd5e1";
      ctx.beginPath();
      ctx.roundRect(hx - 6.5, headY - 8, 13, 16, [6, 6, 3, 3]);
      ctx.fill();
      // Crimson/cyan crown felt strip
      ctx.fillStyle = glow > 0.05 ? "#f8fafc" : "#0284c7";
      ctx.fillRect(hx - 5.5, headY - 8, 11, 3.5);

      if (glow > 0.04) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        drawGlow(ctx, hx, PIANO_STRIKE_Y + 4, 58 + 30 * glow, st!.hue, 0.56 * glow, 0.2);
        ctx.restore();
      }
    }

    // Compact Grand-Piano Keybed (y = 1255..1398)
    const keyBedLeft = PITCH_AXIS_LEFT - 12;
    const keyBedRight = PITCH_AXIS_RIGHT + 12;
    const keyH = STAGE.pianoBottom - STAGE.pianoKeyTop;
    ctx.fillStyle = "#060a14";
    ctx.beginPath();
    ctx.roundRect(keyBedLeft - 6, STAGE.pianoKeyTop - 4, keyBedRight - keyBedLeft + 12, keyH + 8, 8);
    ctx.fill();

    // White keys first, then black keys
    let whiteCount = 0;
    for (let p = MELODY_MIN_PITCH; p <= MELODY_MAX_PITCH; p++) if (!BLACK_CLASSES.has(p % 12)) whiteCount++;
    const whiteW = (keyBedRight - keyBedLeft) / whiteCount;
    let wIdx = 0;
    for (let p = MELODY_MIN_PITCH; p <= MELODY_MAX_PITCH; p++) {
      if (BLACK_CLASSES.has(p % 12)) continue;
      const kx = keyBedLeft + wIdx * whiteW;
      const st = activePianoStates.get(p);
      const glow = st ? st.glow : 0;
      const press = clamp01(glow * 1.2) * 5;
      ctx.save();
      ctx.translate(0, press);
      ctx.fillStyle = glow > 0.03 ? hsla(st!.hue, 0.9, 0.74, 0.95) : "#e2e8f0";
      ctx.beginPath();
      ctx.roundRect(kx + 1, STAGE.pianoKeyTop, whiteW - 2, keyH - 6, [0, 0, 5, 5]);
      ctx.fill();
      ctx.restore();
      wIdx++;
    }
    wIdx = 0;
    for (let p = MELODY_MIN_PITCH; p <= MELODY_MAX_PITCH; p++) {
      if (!BLACK_CLASSES.has(p % 12)) {
        wIdx++;
        continue;
      }
      const bw = whiteW * 0.6;
      const kx = keyBedLeft + wIdx * whiteW - bw / 2;
      const st = activePianoStates.get(p);
      const glow = st ? st.glow : 0;
      const press = clamp01(glow * 1.2) * 4;
      ctx.save();
      ctx.translate(0, press);
      ctx.fillStyle = glow > 0.03 ? hsla(st!.hue, 0.96, 0.62, 0.96) : "#0f172a";
      ctx.beginPath();
      ctx.roundRect(kx, STAGE.pianoKeyTop - 1, bw, keyH * 0.6, [0, 0, 4, 4]);
      ctx.fill();
      ctx.restore();
    }
    void keySpanW;

    // 4 Copper-Wound Upright Double-Bass Strings (y = 1468, 1508, 1548, 1588) + Carved Bridge at x = 540
    ctx.save();
    ctx.fillStyle = "rgba(69, 26, 3, 0.62)";
    ctx.strokeStyle = "rgba(217, 119, 6, 0.44)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(514, 1446, 52, 166, 12);
    ctx.fill();
    ctx.stroke();
    // Classic f-hole scrolls flanking x = 540
    for (const s of [-1, 1] as const) {
      ctx.strokeStyle = "rgba(245, 158, 11, 0.32)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(540 + s * 78, 1470);
      ctx.bezierCurveTo(540 + s * 62, 1510, 540 + s * 94, 1546, 540 + s * 78, 1588);
      ctx.stroke();
    }
    ctx.restore();

    const bassAmp = [0, 0, 0, 0];
    const bassPluckX = [540, 540, 540, 540];
    for (const ev of bassEvents) {
      const st = eventStateAt(ev, t);
      if (!st || (!st.active && st.sustain <= 0.02)) continue;
      const e = Math.max(st.strike, st.sustain);
      if (e >= bassAmp[ev.stringIdx]) {
        bassAmp[ev.stringIdx] = e;
        bassPluckX[ev.stringIdx] = ev.x;
      }
    }

    for (let s = 0; s < 4; s++) {
      const by = BASS_STRING_Y[s];
      const amp = bassAmp[s];
      ctx.strokeStyle = amp > 0.03 ? hsla(34, 0.95, 0.64, 0.92) : "rgba(180, 83, 9, 0.62)";
      ctx.lineWidth = 2.4 + s * 0.55 + amp * 1.8;
      ctx.beginPath();
      if (amp > 0.02) {
        for (let sx = PITCH_AXIS_LEFT + 8; sx <= PITCH_AXIS_RIGHT - 8; sx += 14) {
          const u = (sx - (PITCH_AXIS_LEFT + 8)) / (PITCH_AXIS_RIGHT - PITCH_AXIS_LEFT - 16);
          const wy = by + Math.sin(u * Math.PI) * Math.sin(frame * 0.52 + s) * 12 * amp;
          if (sx === PITCH_AXIS_LEFT + 8) ctx.moveTo(sx, wy);
          else ctx.lineTo(sx, wy);
        }
      } else {
        ctx.moveTo(PITCH_AXIS_LEFT + 8, by);
        ctx.lineTo(PITCH_AXIS_RIGHT - 8, by);
      }
      ctx.stroke();

      if (amp > 0.04) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        drawGlow(ctx, bassPluckX[s], by, 72 + 36 * amp, 34, 0.52 * amp, 0.24);
        ctx.restore();
      }
    }

    // Upright Bass Pizzicato Plucking Striker
    const bassHand = bassHandPoseAt(bassEvents, t, scene.leadSec, scene.endSec, tailSec);
    ctx.save();
    ctx.fillStyle = bassHand.pluck > 0.08 ? "#fbbf24" : "#cbd5e1";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(bassHand.x, bassHand.y - 6, 12, 8, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Outer Stage Frame & Quiet Boteh Filigree Corners
    ctx.strokeStyle = "rgba(245, 158, 11, 0.34)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.tarTop, stageW, STAGE.bottom - STAGE.tarTop, [6, 6, 14, 14]);
    ctx.stroke();

    const cornerAlpha = 0.48 + 0.18 * Math.sin(loopPhase);
    drawBotehCorner(ctx, STAGE.left + 26, STAGE.tarTop + 34, 1, 1, cornerAlpha);
    drawBotehCorner(ctx, STAGE.right - 26, STAGE.tarTop + 34, -1, 1, cornerAlpha);
    drawBotehCorner(ctx, STAGE.left + 26, STAGE.bottom - 34, 1, -1, cornerAlpha);
    drawBotehCorner(ctx, STAGE.right - 26, STAGE.bottom - 34, -1, -1, cornerAlpha);

    // --- Top Stage HUD Bar (x = 50..1030, y = 295..355) ---
    const hudH = STAGE.hudBottom - STAGE.top;
    const hudGrad = ctx.createLinearGradient(0, STAGE.top, 0, STAGE.hudBottom);
    hudGrad.addColorStop(0, "rgba(15, 23, 42, 0.94)");
    hudGrad.addColorStop(1, "rgba(10, 15, 28, 0.94)");
    ctx.fillStyle = hudGrad;
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.top, stageW, hudH, [12, 12, 4, 4]);
    ctx.fill();
    ctx.strokeStyle = "rgba(245, 158, 11, 0.42)";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    const { section } = mughamSectionLabelAt(t, scene.endSec);
    const bpm = activeBpmAt(scene, t);
    drawCenteredText(ctx, section, STAGE.top + 39, {
      size: 21,
      weight: 700,
      color: climax01 > 0.5 ? "#c8ff00" : "#fde68a",
      maxWidth: 380,
      letterSpacing: 1.1,
      centerX: 540,
    });
    drawCenteredText(ctx, "TAR & TRIO", STAGE.top + 38, {
      size: 17,
      weight: 700,
      color: "#fcd34d",
      maxWidth: 190,
      letterSpacing: 0.9,
      centerX: 235,
    });
    drawCenteredText(ctx, `7/8  \u00b7  ${bpm} BPM`, STAGE.top + 38, {
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

    ctx.restore(); // end camera + stage clip

    drawVignette(ctx, W, H, 0.42);
    drawSceneTitle(ctx, scene, label, frame);
  };
}
