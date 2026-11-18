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
import { pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import {
  barRectAt,
  beePoseAt,
  buildNoteBarEvents,
  FALL_SEC,
  FALL_SPEED,
  isBlackKey,
  keyStateAt,
  notesPerSecondAt,
  planBumblebeeKeyboard,
  SPARK_LIFE_SEC,
  sparkAt,
  STAGE,
  type KeyboardLayout,
  type NoteBarEvent,
} from "./sim.ts";

function activeBpmAt(scene: MidiSceneData, t: number): number {
  if (!scene.tempoMap.length) return 120;
  let mpq = scene.tempoMap[0].microsecondsPerQuarter;
  for (const change of scene.tempoMap) {
    if (change.timeSec <= Math.max(0, t)) mpq = change.microsecondsPerQuarter;
    else break;
  }
  return Math.round(60e6 / mpq);
}

/** Crisp vector bumblebee centred at (x, y) with animated translucent wings, golden-black stripes, and glow. */
function drawBeeSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  tilt: number,
  wingPhase: number,
  alpha: number,
) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  drawGlow(ctx, x, y, 78 * scale, 54, 0.48 * alpha, 0.22);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = clamp01(alpha);
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.scale(scale, scale);

  // Fluttering double wings (symmetric left & right)
  const flap = 0.55 + 0.45 * Math.sin(wingPhase);
  for (const side of [-1, 1] as const) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.rotate(-0.45 - 0.52 * flap);
    ctx.fillStyle = "rgba(226, 244, 255, 0.82)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(13, -12, 16, 8.5, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = "rgba(200, 255, 220, 0.62)";
    ctx.ellipse(9, -4, 11, 6, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Stinger at bottom/tail
  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.moveTo(-4, 18);
  ctx.lineTo(4, 18);
  ctx.lineTo(0, 26);
  ctx.closePath();
  ctx.fill();

  // Plump striped abdomen & thorax
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 2, 14.5, 18.5, 0, 0, Math.PI * 2);
  ctx.clip();
  const bodyGrad = ctx.createLinearGradient(-14, -16, 14, 18);
  bodyGrad.addColorStop(0, "#fde047");
  bodyGrad.addColorStop(0.55, "#facc15");
  bodyGrad.addColorStop(1, "#eab308");
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(-18, -22, 36, 44);

  // Bold dark velvet stripes
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(-18, -18, 36, 6.5);
  ctx.fillRect(-18, -5.5, 36, 5.5);
  ctx.fillRect(-18, 5.5, 36, 5.5);
  ctx.fillRect(-18, 15.5, 36, 6);
  ctx.restore();

  // Body outline + glossy highlight
  ctx.strokeStyle = "rgba(254, 240, 138, 0.85)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(0, 2, 14.5, 18.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Head & antennae
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(0, -16, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fef08a";
  ctx.beginPath();
  ctx.arc(-3.5, -17.5, 2.1, 0, Math.PI * 2);
  ctx.arc(3.5, -17.5, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fde047";
  ctx.lineWidth = 1.6;
  for (const s of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(s * 3, -23);
    ctx.quadraticCurveTo(s * 9, -30, s * 12, -28);
    ctx.stroke();
  }
  ctx.restore();
}

function drawKeyboard(ctx: CanvasRenderingContext2D, layout: KeyboardLayout, states: Map<number, ReturnType<typeof keyStateAt>>) {
  const { top, whiteHeight, keyWidth } = layout;
  ctx.fillStyle = "#060913";
  ctx.beginPath();
  ctx.roundRect(layout.left - 8, top - 6, layout.right - layout.left + 16, whiteHeight + 12, 12);
  ctx.fill();

  const whiteGrad = ctx.createLinearGradient(0, top, 0, top + whiteHeight);
  whiteGrad.addColorStop(0, "#f8fafc");
  whiteGrad.addColorStop(0.65, "#dbe4f3");
  whiteGrad.addColorStop(1, "#9fb0cc");

  for (let p = layout.lo; p <= layout.hi; p++) {
    if (isBlackKey(p)) continue;
    const rect = layout.keyRect(p);
    const st = states.get(p);
    const press = st ? st.press : 0;
    ctx.save();
    ctx.translate(0, press * 7);
    ctx.fillStyle = whiteGrad;
    ctx.beginPath();
    ctx.roundRect(rect.x + 1, top, rect.width - 2, rect.height - 6, [0, 0, 7, 7]);
    ctx.fill();
    if (st && st.glow > 0.01) {
      const tint = ctx.createLinearGradient(0, top, 0, top + rect.height - 6);
      tint.addColorStop(0, hsla(st.hue, 0.98, 0.56, Math.min(0.95, st.glow * 1.25)));
      tint.addColorStop(1, hsla(st.hue, 0.92, 0.62, 0.55 * st.glow));
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.roundRect(rect.x + 1, top, rect.width - 2, rect.height - 6, [0, 0, 7, 7]);
      ctx.fill();
    }
    ctx.restore();
  }

  for (let p = layout.lo; p <= layout.hi; p++) {
    if (!isBlackKey(p)) continue;
    const rect = layout.keyRect(p);
    const st = states.get(p);
    const press = st ? st.press : 0;
    ctx.save();
    ctx.translate(0, press * 5);
    const bg = ctx.createLinearGradient(0, top, 0, top + rect.height);
    bg.addColorStop(0, "#1e293b");
    bg.addColorStop(1, "#090d16");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(rect.x, top - 1, rect.width, rect.height, [0, 0, 5, 5]);
    ctx.fill();
    if (st && st.glow > 0.01) {
      ctx.fillStyle = hsla(st.hue, 1, 0.6, Math.min(0.95, st.glow * 1.35));
      ctx.beginPath();
      ctx.roundRect(rect.x, top - 1, rect.width, rect.height, [0, 0, 5, 5]);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(rect.x + rect.width * 0.2, top + 2, rect.width * 0.14, rect.height * 0.68);
    ctx.restore();
  }

  // Bright strike rail along keyTop
  ctx.fillStyle = "rgba(253, 224, 71, 0.55)";
  ctx.fillRect(layout.left, top - 2, layout.right - layout.left, 2.5);

  ctx.globalCompositeOperation = "lighter";
  for (const [p, st] of states) {
    if (!st || st.glow < 0.03) continue;
    const rect = layout.keyRect(p);
    drawGlow(ctx, rect.x + rect.width / 2, top + 4, keyWidth * 3.6, st.hue, 0.45 * st.glow);
  }
  ctx.globalCompositeOperation = "source-over";
}

export function createBumblebeePainter(scene: MidiSceneData, label: string): MidiPainter {
  const layout = planBumblebeeKeyboard(scene.notes.map((n) => n.pitch));
  const events = buildNoteBarEvents(scene.notes, layout);
  const leadEvents = events.filter((e) => e.isLead);
  const flightSource = leadEvents.length ? leadEvents : events;
  const byPitch = new Map<number, NoteBarEvent[]>();
  for (const ev of events) {
    const list = byPitch.get(ev.pitch);
    if (list) list.push(ev);
    else byPitch.set(ev.pitch, [ev]);
  }
  const accents = buildAccents(scene.notes, 0.035, 0.8, 3.2);
  const tailSec = (scene.totalFrames / scene.fps) - scene.leadSec - scene.endSec;
  const dust = Array.from({ length: 56 }, (_, i) => ({
    x: STAGE.left + 20 + hash01(i, 11) * (STAGE.right - STAGE.left - 40),
    y: STAGE.rollTop + hash01(i, 12) * (STAGE.keyTop - STAGE.rollTop),
    r: 1 + 1.8 * hash01(i, 13),
    phase: hash01(i, 14) * Math.PI * 2,
  }));
  const { width: W, height: H } = scene;
  const totalSec = scene.totalFrames / scene.fps;

  return (ctx, frame) => {
    const t = pieceTime(scene, frame);
    const loopPhase = (2 * Math.PI * frame) / Math.max(1, scene.totalFrames);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // Rich midnight-amber stage background (periodic in loopPhase so frame N-1 matches frame 0)
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#070b14");
    bg.addColorStop(0.55, "#050811");
    bg.addColorStop(1, "#090d18");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const nps = notesPerSecondAt(scene.notes, t, scene.endSec);
    const speed01 = clamp01(nps / 24);
    const kick = cameraKick(accents, t, 0.8);
    const pulse = accentPulse(accents, t, 0.16);

    ctx.save();
    const cx = 540;
    const cy = 940;
    ctx.translate(cx + kick.dx * 0.7, cy + kick.dy * 0.7);
    ctx.rotate(kick.rotation * 0.6);
    ctx.scale(1 + kick.zoom * 0.85, 1 + kick.zoom * 0.85);
    ctx.translate(-cx, -cy);

    // Symmetric ambient light pools behind the stage
    ctx.globalCompositeOperation = "lighter";
    const glowHue = lerp(46, 74, speed01);
    drawSoft(ctx, 270 + 30 * Math.sin(loopPhase), 860, 1250, glowHue, 0.11 + 0.22 * speed01);
    drawSoft(ctx, 810 - 30 * Math.sin(loopPhase), 860, 1250, glowHue, 0.11 + 0.22 * speed01);
    drawSoft(ctx, 540, 1340, 1500, 205, 0.12 + 0.14 * Math.min(1, pulse));
    ctx.globalCompositeOperation = "source-over";

    // --- 1. Piano-Roll Stage Panel (x = 50..1030, y = 358..1310) ---
    const rollH = STAGE.keyTop - STAGE.rollTop;
    const rollW = STAGE.right - STAGE.left;
    const rollBg = ctx.createLinearGradient(0, STAGE.rollTop, 0, STAGE.keyTop);
    rollBg.addColorStop(0, "rgba(15, 23, 42, 0.76)");
    rollBg.addColorStop(1, "rgba(10, 15, 30, 0.92)");
    ctx.fillStyle = rollBg;
    ctx.fillRect(STAGE.left, STAGE.rollTop, rollW, rollH);

    // Octave bands & white-key vertical lane guides (strictly symmetric across x = 50..1030)
    ctx.strokeStyle = "rgba(148, 163, 184, 0.13)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= layout.whiteCount; i++) {
      const x = Math.round(layout.left + i * layout.keyWidth) + 0.5;
      ctx.moveTo(x, STAGE.rollTop);
      ctx.lineTo(x, STAGE.keyTop);
    }
    ctx.stroke();

    // Subtle horizontal timing grid lines scrolling down at FALL_SPEED (periodic at loop ends via alpha envelope)
    const gridActive = smoothstep(-0.8, 0.2, t) * (1 - smoothstep(scene.endSec, scene.endSec + 1.2, t));
    if (gridActive > 0.01) {
      ctx.strokeStyle = `rgba(250, 204, 21, ${(0.08 * gridActive).toFixed(3)})`;
      ctx.beginPath();
      const stepPx = 190;
      const offset = (((t * FALL_SPEED) % stepPx) + stepPx) % stepPx;
      for (let y = STAGE.rollTop + offset; y < STAGE.keyTop; y += stepPx) {
        ctx.moveTo(STAGE.left, y);
        ctx.lineTo(STAGE.right, y);
      }
      ctx.stroke();
    }

    // Ambient golden pollen motes inside the roll
    for (const d of dust) {
      ctx.fillStyle = "rgba(253, 224, 71, 0.22)";
      const py = STAGE.rollTop + (((d.y - STAGE.rollTop + Math.sin(loopPhase + d.phase) * 18) % rollH + rollH) % rollH);
      ctx.beginPath();
      ctx.arc(d.x, py, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- 2. Visible Falling Note Bars (1-to-1 with MIDI notes) ---
    const winStart = lowerBound(scene.notes, t - 4.0);
    const winEnd = lowerBound(scene.notes, t + FALL_SEC + 0.15);

    ctx.save();
    ctx.beginPath();
    ctx.rect(STAGE.left, STAGE.rollTop, rollW, rollH);
    ctx.clip();

    for (let i = Math.max(0, winStart - 8); i < Math.min(events.length, winEnd + 4); i++) {
      const ev = events[i];
      const rect = barRectAt(ev, t);
      if (!rect) continue;
      const r = Math.min(6, rect.width * 0.35, (rect.bottom - rect.top) * 0.45);
      ctx.globalAlpha = rect.alpha;
      const fill = ctx.createLinearGradient(0, rect.top, 0, rect.bottom);
      const lTop = ev.isLead ? 0.56 : 0.48;
      const lBot = rect.active ? 0.82 : ev.isLead ? 0.68 : 0.58;
      fill.addColorStop(0, hsla(ev.hue, 0.92, lTop, 0.82));
      fill.addColorStop(1, hsla(ev.hue, 0.98, lBot, 0.98));
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.top, rect.width, rect.bottom - rect.top, r);
      ctx.fill();

      ctx.strokeStyle = hsla(ev.hue, 1, 0.86, rect.active ? 0.95 : 0.55);
      ctx.lineWidth = rect.active ? 2.2 : 1.2;
      ctx.stroke();

      if (ev.isLead || rect.active) {
        ctx.globalCompositeOperation = "lighter";
        drawGlow(ctx, ev.x, rect.bottom - 4, rect.width * (rect.active ? 3.4 : 2.1), ev.hue, rect.alpha * (rect.active ? 0.55 : 0.24));
        ctx.globalCompositeOperation = "source-over";
      }
    }
    ctx.globalAlpha = 1;

    // --- 3. Glowing Melodic Flight Trail & Growing Bumblebee Swarm ---
    const hero = beePoseAt(flightSource, t, scene.leadSec, scene.endSec, tailSec);
    const trailVisibility = smoothstep(-0.3, 0.3, t) * (1 - smoothstep(scene.endSec + 0.2, scene.endSec + 1.5, t));
    if (trailVisibility > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const samples = 26;
      const spanSec = 0.45 + 0.35 * hero.swarmBlend;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let s = samples; s >= 1; s--) {
        const dt0 = (s / samples) * spanSec;
        const dt1 = ((s - 1) / samples) * spanSec;
        const p0 = beePoseAt(flightSource, t - dt0, scene.leadSec, scene.endSec, tailSec);
        const p1 = beePoseAt(flightSource, t - dt1, scene.leadSec, scene.endSec, tailSec);
        // Trail rises with FALL_SPEED so it locks onto the rising wake of the music
        const y0 = p0.y - dt0 * FALL_SPEED * 0.52;
        const y1 = p1.y - dt1 * FALL_SPEED * 0.52;
        const fade = (1 - s / (samples + 1)) * trailVisibility;
        ctx.strokeStyle = hsla(lerp(48, 75, speed01), 1, 0.68, 0.55 * fade);
        ctx.lineWidth = (3 + 7 * fade) * (1 + 0.4 * hero.swarmBlend);
        ctx.beginPath();
        ctx.moveTo(p0.x, y0);
        ctx.lineTo(p1.x, y1);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Follower swarm bees flying in formation behind the hero bee as phrases build
    const wingBase = (frame / scene.fps) * Math.PI * 2 * 24; // 24 Hz integer cycles/sec -> seamless loop phase
    for (let m = hero.swarmCount - 1; m >= 1; m--) {
      const lag = m * 0.052;
      const pose = beePoseAt(flightSource, t - lag, scene.leadSec, scene.endSec, tailSec);
      const side = m % 2 === 0 ? 1 : -1;
      const rank = Math.ceil(m / 2);
      const ox = side * (18 + rank * 11) * Math.sin(loopPhase * 3 + m);
      const oy = -lag * FALL_SPEED * 0.38 - rank * 14;
      const appear = clamp01(trailVisibility * (0.65 + 0.35 * hero.swarmBlend));
      drawBeeSprite(
        ctx,
        clamp(pose.x + ox, STAGE.left + 26, STAGE.right - 26),
        clamp(pose.y + oy, STAGE.rollTop + 30, STAGE.keyTop - 20),
        0.64 - rank * 0.05,
        pose.tilt,
        wingBase + m * 1.3,
        appear * 0.88,
      );
    }

    ctx.restore(); // end roll clip

    // --- 4. Piano Keyboard (x = 50..1030, y = 1310..1590) + Key Strike Sparks ---
    const states = new Map<number, ReturnType<typeof keyStateAt>>();
    for (const [pitch, list] of byPitch) {
      const st = keyStateAt(list, t);
      if (st) states.set(pitch, st);
    }
    drawKeyboard(ctx, layout, states);

    // Impact shock rings & golden pollen sparks at keyTop
    ctx.globalCompositeOperation = "lighter";
    for (let i = Math.max(0, winStart - 4); i < Math.min(events.length, winEnd); i++) {
      const ev = events[i];
      const age = t - ev.tOn;
      if (age < 0 || age > SPARK_LIFE_SEC) continue;
      if (age < 0.32 && (ev.isLead || ev.vel01 > 0.65)) {
        const u = age / 0.32;
        const rx = layout.keyWidth * (0.6 + 2.8 * (1 - (1 - u) ** 3));
        ctx.strokeStyle = hsla(ev.hue, 1, 0.76, (1 - u) ** 1.6 * 0.75);
        ctx.lineWidth = 3 * (1 - u);
        ctx.beginPath();
        ctx.ellipse(ev.x, STAGE.keyTop - 2, rx, rx * 0.28, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      const sparkCount = ev.isLead ? 8 : 3;
      for (let k = 0; k < sparkCount; k++) {
        const sp = sparkAt(ev, k, age);
        if (!sp) continue;
        drawGlow(ctx, sp.x, sp.y, sp.size * 3.2, ev.hue, sp.alpha * 0.85, 0.28);
      }
    }
    ctx.globalCompositeOperation = "source-over";

    // Draw the Hero Bumblebee on top of the keyboard strike zone so it visibly kisses each key
    drawBeeSprite(ctx, hero.x, hero.y, 1.05 + 0.08 * speed01, hero.tilt, wingBase, 1);

    // Crisp symmetric stage border rails (x = 50..1030, y = 290..1590)
    ctx.strokeStyle = "rgba(250, 204, 21, 0.34)";
    ctx.lineWidth = 2;
    ctx.strokeRect(STAGE.left, STAGE.rollTop, rollW, STAGE.bottom - STAGE.rollTop);

    // --- 5. Top Speedometer & Swarm HUD Bar (x = 50..1030, y = 290..356) ---
    const hudH = STAGE.hudBottom - STAGE.top;
    const hudBg = ctx.createLinearGradient(0, STAGE.top, 0, STAGE.hudBottom);
    hudBg.addColorStop(0, "rgba(15, 23, 42, 0.92)");
    hudBg.addColorStop(1, "rgba(9, 14, 28, 0.92)");
    ctx.fillStyle = hudBg;
    ctx.beginPath();
    ctx.roundRect(STAGE.left, STAGE.top, rollW, hudH, [12, 12, 4, 4]);
    ctx.fill();
    ctx.strokeStyle = hsla(glowHue, 0.9, 0.62, 0.42 + 0.3 * speed01);
    ctx.lineWidth = 2;
    ctx.stroke();

    // Symmetric centre-out speed gauge bar along bottom of HUD
    const barHalf = (rollW - 24) * 0.5 * speed01;
    if (barHalf > 1) {
      const gBar = ctx.createLinearGradient(540 - barHalf, 0, 540 + barHalf, 0);
      gBar.addColorStop(0, "#eab308");
      gBar.addColorStop(0.5, "#c8ff00");
      gBar.addColorStop(1, "#eab308");
      ctx.fillStyle = gBar;
      ctx.fillRect(540 - barHalf, STAGE.hudBottom - 5, barHalf * 2, 3.5);
    }

    const npsColor = speed01 > 0.72 ? "#c8ff00" : speed01 > 0.4 ? "#fde047" : "#f8fafc";
    drawCenteredText(ctx, `${nps.toFixed(1)} NOTES / SEC`, STAGE.top + 43, {
      size: 28,
      weight: 800,
      color: npsColor,
      maxWidth: 340,
      letterSpacing: 1.2,
      centerX: 540,
    });
    drawCenteredText(ctx, `SWARM  \u00d7${hero.swarmCount}`, STAGE.top + 41, {
      size: 20,
      weight: 700,
      color: "#fcd34d",
      maxWidth: 210,
      letterSpacing: 1,
      centerX: 240,
    });
    const bpm = activeBpmAt(scene, t);
    drawCenteredText(ctx, `TEMPO  ${bpm} BPM`, STAGE.top + 41, {
      size: 20,
      weight: 700,
      color: "#93c5fd",
      maxWidth: 210,
      letterSpacing: 1,
      centerX: 840,
    });

    // Subtle overall progress hairline at very top of HUD (symmetric center-out)
    const prog = clamp01((frame / scene.fps) / Math.max(1, totalSec));
    const progHalf = (rollW - 24) * 0.5 * prog;
    ctx.fillStyle = "rgba(200, 255, 0, 0.5)";
    ctx.fillRect(540 - progHalf, STAGE.top + 2, progHalf * 2, 2);

    ctx.restore(); // end camera transform

    drawVignette(ctx, W, H, 0.42);
    drawSceneTitle(ctx, scene, label, frame);
  };
}
