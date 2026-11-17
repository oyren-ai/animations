import type { MidiPainter } from "../components/MidiShell.tsx";
import {
  accentPulse, cameraKick, clamp01, drawGlow, drawSceneTitle, drawVignette, easeOutBack, easeOutCubic, endFade, hash01, hsla, smoothstep,
} from "../midi/kit.ts";
import { pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import { buildRippleAccents, buildRippleEvents, type RippleEvent } from "./events.ts";
import { fieldGeometry, RippleField } from "./field.ts";

const BACKGROUND = "#05060d";
/** Canvas px per field cell (3 = 360x640 over the picture, plus the overdraw margin). */
const GRID_SCALE = 3;
const GRID_MARGIN = 64;
/** The longest any overlay (splash flash, sparks, buoy fade-out) outlives the note-on. */
const OVERLAY_SEC = 4.5;

interface Surface { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData }

function makeSurface(width: number, height: number): Surface {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return { canvas, ctx, image: ctx.createImageData(width, height) };
}

/** Splash at the note-on: a hot flash with a squashed-then-stretched core, a bright front ring and seeded droplet sparks. */
function drawSplash(ctx: CanvasRenderingContext2D, ev: RippleEvent, age: number) {
  const { x, y, hue, vel, emphasis } = ev;
  if (age < 0.5) {
    const pop = easeOutCubic(age / 0.1);
    const diameter = (130 + 210 * vel + 170 * emphasis) * (0.4 + 0.6 * pop);
    const flash = (0.45 + 0.55 * vel) * Math.exp(-age / 0.11) * (0.7 + 0.3 * emphasis);
    // Squash and stretch: wide and flat on impact, then tall, settling by about a quarter of a second.
    const wobble = Math.exp(-age / 0.085) * Math.cos(age * 44);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 + 0.5 * wobble, 1 - 0.42 * wobble);
    drawGlow(ctx, 0, 0, diameter, hue, flash * 0.75);
    drawGlow(ctx, 0, 0, diameter * 0.34, hue, clamp01(flash * 0.5), 0.24);
    ctx.restore();
  }
  // Front ring: sits exactly on the leading crest of the wave for the first moments, so the crest is bright at birth.
  if (age < 0.75) {
    const q = age / 0.75;
    const radius = ev.speed * age + 10;
    const alpha = (0.35 + 0.65 * vel) * (1 - q) ** 1.7;
    ctx.lineWidth = 15 * (1 - q) + 5;
    ctx.strokeStyle = hsla(hue, 0.95, 0.62, 0.2 * alpha);
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3.2 * (1 - q) + 1.5;
    ctx.strokeStyle = hsla(hue, 0.85, 0.82, 0.95 * alpha);
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
  }
  // Droplets: position is a closed-form function of age (outward with drag, a little lift), no simulation.
  // They fade in over the first few frames so the clump at the source does not add up to a white blob.
  const sparks = ev.sparkCount;
  const tau = 0.21;
  const appear = 0.3 + 0.7 * smoothstep(0, 0.09, age);
  for (let j = 0; j < sparks; j++) {
    const life = 0.5 + 0.55 * hash01(ev.index, 30 + j);
    if (age >= life) continue;
    const angle = ((j + hash01(ev.index, 10 + j) * 0.8) / sparks) * Math.PI * 2;
    const speed = (380 + 520 * hash01(ev.index, 20 + j)) * (0.55 + 0.6 * vel) * (1 + 0.25 * emphasis);
    const start = 16 + 14 * hash01(ev.index, 60 + j); // droplets leave a ring around the impact, not its exact centre
    const q = age / life;
    const size = ((9 + 15 * hash01(ev.index, 40 + j)) * (0.7 + 0.6 * vel) + 3) * (1 - q) ** 0.8 * appear;
    const twinkle = 0.78 + 0.22 * Math.sin(age * 55 + j * 2.3);
    const alpha = 0.62 * (1 - q) ** 1.3 * twinkle * appear;
    const sparkHue = hue + (hash01(ev.index, 50 + j) - 0.5) * 50;
    for (let tail = 0; tail < 2; tail++) {
      const a = Math.max(0, age - tail * 0.026);
      const dist = start + speed * tau * (1 - Math.exp(-a / tau));
      const px = x + Math.cos(angle) * dist;
      const py = y + Math.sin(angle) * dist - 85 * a * (1 - a / (2 * life));
      drawGlow(ctx, px, py, size * (2.5 - 0.7 * tail), sparkHue, alpha * (1 - 0.4 * tail), 0.3);
    }
  }
}

/** Small glowing source buoy that stays lit for the length of the note and then fades. */
function drawBuoy(ctx: CanvasRenderingContext2D, ev: RippleEvent, age: number) {
  const { x, y, hue, vel, emphasis } = ev;
  const hold = ev.holdSec;
  const fade = age < hold ? 1 : 1 - clamp01((age - hold) / 0.55);
  if (fade <= 0) return;
  const settle = 0.5 + 0.5 * Math.exp(-age / 1.1);
  const alpha = fade * settle;
  const pop = easeOutBack(age / 0.14, 2.2);
  const wobble = Math.exp(-age / 0.1) * Math.cos(age * 40);
  const size = (0.8 + 0.5 * vel + 0.3 * emphasis) * pop;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 + 0.4 * wobble, 1 - 0.35 * wobble);
  drawGlow(ctx, 0, 0, 74 * size, hue, 0.62 * alpha, 0.22);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = hsla(hue, 0.9, 0.84, 0.9 * alpha);
  ctx.beginPath(); ctx.arc(0, 0, 11 * size, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = hsla(hue, 0.5, 0.97, alpha);
  ctx.beginPath(); ctx.arc(0, 0, 3.6 * size, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** The scene's painter: a pure function of the frame number (no state carried between frames). */
export function createRipplePainter(scene: MidiSceneData, label: string): MidiPainter {
  const events = buildRippleEvents(scene);
  const accents = buildRippleAccents(scene.notes, events);
  const geo = fieldGeometry(scene.width, scene.height, GRID_SCALE, GRID_MARGIN);
  const field = new RippleField(geo);
  let surface: Surface | undefined;
  let bloom: Surface | undefined;
  const { width, height } = scene;

  return (ctx, frame) => {
    surface ??= makeSurface(geo.cols, geo.rows);
    bloom ??= makeSurface(Math.ceil(geo.cols / 3), Math.ceil(geo.rows / 3));
    const t = pieceTime(scene, frame);
    const pulse = clamp01(accentPulse(accents, t, 0.16));
    field.evaluate(events, frame, t);
    field.shade(surface.image.data, pulse);
    surface.ctx.putImageData(surface.image, 0, 0);
    bloom.ctx.imageSmoothingEnabled = true;
    bloom.ctx.imageSmoothingQuality = "high";
    bloom.ctx.drawImage(surface.canvas, 0, 0, bloom.canvas.width, bloom.canvas.height);

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, height);

    // Camera: punch-in and shake around the screen centre on loud chords. The water overdraws the canvas, so no edge shows.
    const kick = cameraKick(accents, t, 1.3);
    const zoom = 1 + kick.zoom;
    ctx.translate(width / 2 + kick.dx, height / 2 + kick.dy);
    ctx.rotate(kick.rotation);
    ctx.scale(zoom, zoom);
    ctx.translate(-width / 2, -height / 2);

    const waterW = geo.cols * geo.scale, waterH = geo.rows * geo.scale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(surface.canvas, geo.originX, geo.originY, waterW, waterH);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.24;
    ctx.drawImage(bloom.canvas, geo.originX, geo.originY, waterW, waterH);

    // Splashes, droplets and buoys of the notes that are still alive (events are in onset order).
    ctx.globalCompositeOperation = "lighter";
    let lo = 0, hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].timeSec < t - OVERLAY_SEC) lo = mid + 1; else hi = mid;
    }
    for (let i = lo; i < events.length; i++) {
      const ev = events[i];
      if (frame < ev.startFrame) break;
      const age = Math.max(0, t - ev.timeSec);
      ctx.globalAlpha = 1;
      drawSplash(ctx, ev, age);
      ctx.globalAlpha = 1;
      drawBuoy(ctx, ev, age);
    }
    ctx.restore();

    // Everything below is screen-fixed: a soft dark top for the title, vignette, title, end fade.
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    const top = ctx.createLinearGradient(0, 0, 0, 520);
    top.addColorStop(0, "rgba(5,6,13,0.8)");
    top.addColorStop(0.55, "rgba(5,6,13,0.55)");
    top.addColorStop(1, "rgba(5,6,13,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, width, 520);
    drawVignette(ctx, width, height, 0.55);
    drawSceneTitle(ctx, scene, label, frame);
    const fade = endFade(frame, scene.totalFrames, scene.fps, 0.7);
    if (fade > 0) {
      ctx.globalAlpha = fade;
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
  };
}
