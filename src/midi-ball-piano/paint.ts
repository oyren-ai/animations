import type { MidiPainter } from "../components/MidiShell.tsx";
import { accentPulse, buildAccents, cameraKick, clamp01, drawGlow, drawSceneTitle, drawSoft, drawVignette, endFade, hash01, hsla, smoothstep } from "../midi/kit.ts";
import { pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import {
  ballPose, buildBallEvents, keyLight, moodAt, SPARK_LIFE_SEC, sparkState, visibleRange, type BallEvent,
} from "./events.ts";
import { isBlackKey, planKeyboard, STAGE_TOP, type KeyboardLayout } from "./layout.ts";

const STAR_COUNT = 70;

function glowEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, hue: number, alpha: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  drawGlow(ctx, 0, 0, rx * 2, hue, alpha);
  ctx.restore();
}

function drawBall(ctx: CanvasRenderingContext2D, event: BallEvent, t: number) {
  const pose = ballPose(event, t);
  if (!pose) return;
  const r = event.radius, hue = event.hue;
  const impactPulse = pose.landed ? Math.exp(-pose.age / 0.09) : 0;
  ctx.globalCompositeOperation = "lighter";
  if (!pose.landed) {
    // Tapered motion streak behind a falling ball, plus a faint line down to its key.
    const length = Math.min(110, pose.speed * 0.075);
    const top = pose.y - r * pose.sy;
    const trail = ctx.createLinearGradient(0, pose.y, 0, pose.y - length);
    trail.addColorStop(0, hsla(hue, 0.9, 0.72, 0.5 * pose.alpha));
    trail.addColorStop(1, hsla(hue, 0.9, 0.6, 0));
    ctx.fillStyle = trail;
    ctx.beginPath();
    ctx.moveTo(event.x - r * 0.62 * pose.sx, pose.y);
    ctx.lineTo(event.x + r * 0.62 * pose.sx, pose.y);
    ctx.lineTo(event.x, top - length);
    ctx.closePath();
    ctx.fill();
    const bottom = pose.y + r * pose.sy;
    const guide = ctx.createLinearGradient(0, bottom, 0, event.keyTop);
    guide.addColorStop(0, hsla(hue, 0.9, 0.7, 0.22 * pose.alpha));
    guide.addColorStop(1, hsla(hue, 0.9, 0.7, 0.04 * pose.alpha));
    ctx.fillStyle = guide;
    ctx.fillRect(event.x - 1.1, bottom, 2.2, Math.max(0, event.keyTop - bottom));
  }
  drawGlow(ctx, pose.x, pose.y, r * (5 + 3 * impactPulse), hue, pose.alpha * (0.7 + 0.5 * impactPulse));
  if (impactPulse > 0.25) drawGlow(ctx, event.x, event.keyTop - r * 0.4, r * 9 * impactPulse, hue, Math.min(1, impactPulse * 1.2), 0.3); // impact pop
  ctx.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.globalAlpha = pose.alpha;
  ctx.translate(pose.x, pose.y);
  ctx.scale(pose.sx, pose.sy);
  const body = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.05, 0, 0, r);
  body.addColorStop(0, hsla(hue, 0.5, 0.97, 1));
  body.addColorStop(0.4, hsla(hue, 0.92, event.lightness + 0.08, 1));
  body.addColorStop(1, hsla(hue, 0.96, event.lightness - 0.2, 1));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.6 / Math.max(pose.sx, pose.sy);
  ctx.strokeStyle = hsla(hue, 1, 0.86, 0.6);
  ctx.stroke();
  ctx.restore();
}

function drawImpact(ctx: CanvasRenderingContext2D, event: BallEvent, t: number, kw: number) {
  const age = t - event.tOn;
  if (age < 0 || age > SPARK_LIFE_SEC) return;
  const hue = event.hue;
  ctx.globalCompositeOperation = "lighter";
  // Light beam rising from the key and a pool of light on the floor.
  const beam = 0.32 * event.vel01 * Math.exp(-age / 0.17);
  if (beam > 0.005) {
    const height = 380 + 260 * event.vel01;
    const g = ctx.createLinearGradient(0, event.keyTop - height, 0, event.keyTop);
    g.addColorStop(0, hsla(hue, 0.9, 0.6, 0));
    g.addColorStop(1, hsla(hue, 0.9, 0.72, beam));
    ctx.fillStyle = g;
    const width = kw * (0.9 + 0.5 * Math.exp(-age / 0.1));
    ctx.fillRect(event.x - width / 2, event.keyTop - height, width, height);
    glowEllipse(ctx, event.x, event.keyTop, kw * 4.2, kw * 1.1, hue, beam * 2.4);
  }
  // Two flattened shock rings.
  for (let k = 0; k < 2; k++) {
    const a = age - k * 0.07;
    if (a < 0 || a > 0.5) continue;
    const u = a / 0.5, grow = 1 - (1 - u) ** 3;
    const rx = kw * (0.6 + (5 - k * 1.4) * grow) * (0.8 + 0.5 * event.vel01);
    ctx.beginPath();
    ctx.ellipse(event.x, event.keyTop - 2, rx, rx * 0.26, 0, 0, Math.PI * 2);
    ctx.lineWidth = (5 - 3 * u) * (1 - 0.3 * k);
    ctx.strokeStyle = hsla(hue, 0.95, 0.78, (1 - u) ** 1.6 * 0.85);
    ctx.stroke();
  }
  for (let k = 0; k < event.sparkCount; k++) {
    const s = sparkState(event, k, age);
    if (!s) continue;
    drawGlow(ctx, s.x, s.y, s.size * 3.4, hue, s.alpha, 0.3);
  }
}

function drawKeyboard(ctx: CanvasRenderingContext2D, layout: KeyboardLayout, lights: Map<number, ReturnType<typeof keyLight>>) {
  const { top, whiteHeight, keyWidth } = layout;
  // Fallboard shadow above the keys.
  const shade = ctx.createLinearGradient(0, top - 26, 0, top + 4);
  shade.addColorStop(0, "rgba(4,5,14,0)");
  shade.addColorStop(1, "rgba(4,5,14,0.9)");
  ctx.fillStyle = shade;
  ctx.fillRect(layout.left - 14, top - 26, layout.right - layout.left + 28, 30);
  // Base plate behind the keys.
  ctx.fillStyle = "#04050d";
  ctx.beginPath();
  ctx.roundRect(layout.left - 14, top - 6, layout.right - layout.left + 28, whiteHeight + 22, 12);
  ctx.fill();

  const whiteGradient = ctx.createLinearGradient(0, top, 0, top + whiteHeight);
  whiteGradient.addColorStop(0, "#f1f4ff");
  whiteGradient.addColorStop(0.55, "#d3d9ee");
  whiteGradient.addColorStop(1, "#a9b1cf");
  for (let pitch = layout.lo; pitch <= layout.hi; pitch++) {
    if (isBlackKey(pitch)) continue;
    const rect = layout.keyRect(pitch), light = lights.get(pitch);
    const press = light ? light.press : 0;
    ctx.save();
    ctx.translate(0, press * 9);
    ctx.fillStyle = whiteGradient;
    ctx.beginPath();
    ctx.roundRect(rect.x + 1, top, rect.width - 2, rect.height, [0, 0, 8, 8]);
    ctx.fill();
    if (light) {
      const tint = ctx.createLinearGradient(0, top, 0, top + rect.height);
      tint.addColorStop(0, hsla(light.hue, 1, 0.5, Math.min(1, light.glow * 1.25)));
      tint.addColorStop(1, hsla(light.hue, 0.95, 0.62, 0.55 * light.glow));
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.roundRect(rect.x + 1, top, rect.width - 2, rect.height, [0, 0, 8, 8]);
      ctx.fill();
    }
    ctx.restore();
  }
  for (let pitch = layout.lo; pitch <= layout.hi; pitch++) {
    if (!isBlackKey(pitch)) continue;
    const rect = layout.keyRect(pitch), light = lights.get(pitch);
    const press = light ? light.press : 0;
    ctx.save();
    ctx.translate(0, press * 6);
    const face = ctx.createLinearGradient(0, top, 0, top + rect.height);
    face.addColorStop(0, "#1d2034");
    face.addColorStop(1, "#080a16");
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.roundRect(rect.x, top - 2, rect.width, rect.height, [0, 0, 6, 6]);
    ctx.fill();
    if (light) {
      const tint = ctx.createLinearGradient(0, top, 0, top + rect.height);
      tint.addColorStop(0, hsla(light.hue, 1, 0.62, Math.min(1, light.glow * 1.6)));
      tint.addColorStop(1, hsla(light.hue, 0.95, 0.5, Math.min(1, light.glow * 1.1) * 0.7));
      ctx.fillStyle = tint;
      ctx.globalCompositeOperation = "lighter";
      ctx.beginPath();
      ctx.roundRect(rect.x, top - 2, rect.width, rect.height, [0, 0, 6, 6]);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(rect.x + rect.width * 0.18, top, rect.width * 0.1, rect.height * 0.7);
    ctx.restore();
  }
  // Bright rim on the top edge of the keys.
  ctx.fillStyle = "rgba(235,240,255,0.5)";
  ctx.fillRect(layout.left, top - 1, layout.right - layout.left, 1.5);
  // Light spilling up from lit keys.
  ctx.globalCompositeOperation = "lighter";
  for (const [pitch, light] of lights) {
    if (!light || light.glow < 0.02) continue;
    const rect = layout.keyRect(pitch);
    glowEllipse(ctx, rect.x + rect.width / 2, top + 4, keyWidth * 2.4, keyWidth * 0.9, light.hue, 0.55 * light.glow);
  }
  ctx.globalCompositeOperation = "source-over";
}

export function createBallPianoPainter(scene: MidiSceneData, label: string): MidiPainter {
  const layout = planKeyboard(scene.notes.map((note) => note.pitch));
  const events = buildBallEvents(scene.notes, layout);
  const byPitch = new Map<number, BallEvent[]>();
  for (const event of events) {
    const list = byPitch.get(event.pitch);
    if (list) list.push(event); else byPitch.set(event.pitch, [event]);
  }
  const accents = buildAccents(scene.notes);
  const stars = Array.from({ length: STAR_COUNT }, (_, i) => ({
    x: hash01(i, 1) * scene.width, y: hash01(i, 2) * scene.height, size: 0.7 + 1.6 * hash01(i, 3),
    drift: 6 + 14 * hash01(i, 4), phase: hash01(i, 5) * Math.PI * 2, base: 0.18 + 0.35 * hash01(i, 6),
  }));
  const { width: W, height: H } = scene;

  return (ctx, frame) => {
    const t = pieceTime(scene, frame);
    const seconds = frame / scene.fps;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#080a1a");
    bg.addColorStop(0.62, "#05060d");
    bg.addColorStop(1, "#0b0818");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const kick = cameraKick(accents, t);
    const pulse = accentPulse(accents, t, 0.2);
    ctx.save();
    const cx = W / 2, cy = 960; // zoom about the frame centre
    ctx.translate(cx + kick.dx, cy + kick.dy);
    ctx.rotate(kick.rotation);
    ctx.scale(1 + kick.zoom, 1 + kick.zoom);
    ctx.translate(-cx, -cy);

    // Colour of the music right now: big soft glows behind everything, breathing with loud passages.
    const mood = moodAt(events, t);
    // A slowly drifting indigo-to-magenta base palette, pulled 35% of the way towards the colour of the notes.
    const baseHue = 262 + 40 * Math.sin(seconds * 0.08);
    const pull = ((mood.hue - baseHue + 540) % 360) - 180;
    const hue = baseHue + 0.35 * pull * Math.min(1, mood.energy * 2);
    ctx.globalCompositeOperation = "lighter";
    const energy = Math.min(1, mood.energy / 2.2);
    const drift = seconds * 0.12;
    // Light pools are mirrored about the vertical axis (x = 540) so the frame stays symmetric.
    drawSoft(ctx, 250 + 50 * Math.sin(drift), 800 + 60 * Math.cos(drift * 1.3), 1400, hue - 28, 0.1 + 0.3 * energy);
    drawSoft(ctx, 830 - 50 * Math.sin(drift), 800 + 60 * Math.cos(drift * 1.3), 1400, hue + 34, 0.08 + 0.26 * energy);
    drawSoft(ctx, 540, 1420, 1800, hue, 0.12 + 0.4 * energy + 0.12 * Math.min(1, pulse));
    ctx.globalCompositeOperation = "source-over";

    // Slowly drifting, twinkling star dust.
    ctx.fillStyle = "#cfd8ff";
    for (const star of stars) {
      const y = (star.y + seconds * star.drift) % H;
      ctx.globalAlpha = star.base * (0.6 + 0.4 * Math.sin(seconds * 1.7 + star.phase));
      ctx.fillRect(star.x, y, star.size, star.size);
    }
    ctx.globalAlpha = 1;

    // Lanes: faint verticals at the white-key boundaries, fading in towards the keyboard.
    // A faint stage frame marks the fall zone (x 50..1030, from STAGE_TOP down to the keys), so the art is a centred,
    // full-width block and the frame never reads as empty between notes.
    const panel = ctx.createLinearGradient(0, STAGE_TOP, 0, layout.top);
    panel.addColorStop(0, "rgba(150,165,255,0.03)");
    panel.addColorStop(1, "rgba(150,165,255,0.10)");
    ctx.fillStyle = panel;
    ctx.fillRect(layout.left, STAGE_TOP, layout.right - layout.left, layout.top - STAGE_TOP);
    ctx.fillStyle = "rgba(175,190,255,0.34)";
    ctx.fillRect(layout.left, STAGE_TOP - 1, layout.right - layout.left, 2); // ceiling
    const rail = ctx.createLinearGradient(0, STAGE_TOP, 0, layout.top);
    rail.addColorStop(0, "rgba(175,190,255,0.30)");
    rail.addColorStop(1, "rgba(175,190,255,0.55)");
    ctx.fillStyle = rail;
    ctx.fillRect(layout.left - 1, STAGE_TOP, 2, layout.top - STAGE_TOP); // left rail
    ctx.fillRect(layout.right - 1, STAGE_TOP, 2, layout.top - STAGE_TOP); // right rail
    const lane = ctx.createLinearGradient(0, STAGE_TOP, 0, layout.top);
    lane.addColorStop(0, "rgba(160,175,255,0.10)");
    lane.addColorStop(1, "rgba(160,175,255,0.24)");
    ctx.strokeStyle = lane;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= layout.whiteCount; i++) {
      const x = Math.round(layout.left + i * layout.keyWidth) + 0.5;
      ctx.moveTo(x, STAGE_TOP);
      ctx.lineTo(x, layout.top);
    }
    ctx.stroke();

    // Background flash on loud chords.
    if (pulse > 0.01) {
      ctx.globalCompositeOperation = "lighter";
      const flash = ctx.createRadialGradient(cx, layout.top, 0, cx, layout.top, 1100);
      flash.addColorStop(0, `rgba(150,170,255,${Math.min(0.2, pulse * 0.1)})`);
      flash.addColorStop(1, "rgba(150,170,255,0)");
      ctx.fillStyle = flash;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
    }

    const [from, to] = visibleRange(events, t);
    // Keys first, then the balls and effects over them.
    const lights = new Map<number, ReturnType<typeof keyLight>>();
    for (const [pitch, list] of byPitch) {
      const light = keyLight(list, t);
      if (light) lights.set(pitch, light);
    }
    const intro = smoothstep(0.05, 0.7, seconds);
    ctx.save();
    ctx.globalAlpha = intro;
    ctx.translate(0, (1 - intro) * 90);
    drawKeyboard(ctx, layout, lights);
    ctx.restore();
    ctx.globalAlpha = 1;

    for (let i = from; i < to; i++) drawImpact(ctx, events[i], t, layout.keyWidth);
    for (let i = from; i < to; i++) drawBall(ctx, events[i], t);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.restore();

    drawVignette(ctx, W, H, 0.55);
    drawSceneTitle(ctx, scene, label, frame);
    const fade = endFade(frame, scene.totalFrames, scene.fps);
    if (fade > 0.001) {
      ctx.globalAlpha = clamp01(fade);
      ctx.fillStyle = "#05060d";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  };
}
