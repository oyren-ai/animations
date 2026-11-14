import { spring } from "remotion";
import { SCENE_FRAMES, VIDEO } from "../settings.ts";
import { easeIn, easeOut, theme } from "../theme.ts";
import { WAVE, bobAt } from "../pendulum-wave/wave.ts";
import { assertSafeBox, bowlY, WORLD } from "./bounds.ts";
import { BUMPERS, FUNNEL, paddleAt, STYLES, type Trace } from "./sim.ts";

const C = theme.colors;
const circle = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke?: string) => {
  ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
};
const line = (ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, color: string, width = 2) => {
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
};

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, center = false, weight = 500) {
  ctx.font = String(weight) + " " + size + "px " + JSON.stringify(theme.fontFamily);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(value), left = center ? x - m.width / 2 : x;
  assertSafeBox({ left: left - m.actualBoundingBoxLeft, right: left + m.actualBoundingBoxRight,
    top: y - m.actualBoundingBoxAscent, bottom: y + m.actualBoundingBoxDescent });
  ctx.fillStyle = color; ctx.fillText(value, left, y);
}

function background(ctx: CanvasRenderingContext2D, frame: number) {
  const seconds = frame / VIDEO.fps;
  ctx.fillStyle = C.background; ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
  const mesh = ctx.createRadialGradient(450 + Math.sin(seconds * 0.4) * 70, 900, 0, 540, 960, 930);
  mesh.addColorStop(0, C.mesh); mesh.addColorStop(1, C.transparent);
  ctx.fillStyle = mesh; ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
  for (let x = WORLD.left; x <= WORLD.right; x += 43) line(ctx, x, WORLD.top, x, WORLD.bottom, C.faint, 0.6);
  for (let y = WORLD.top; y <= WORLD.bottom; y += 43) line(ctx, WORLD.left, y, WORLD.right, y, C.faint, 0.6);
}

function finish(ctx: CanvasRenderingContext2D, frame: number) {
  ctx.save();
  ctx.fillStyle = C.grade; ctx.globalCompositeOperation = "soft-light";
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = C.grain;
  for (let k = 0; k < 400; k++) ctx.fillRect((k * 197 + frame * 7) % VIDEO.width, (k * 277 + frame * 3) % VIDEO.height, 1, 1);
  const v = ctx.createRadialGradient(540, 960, 500, 540, 960, 1250);
  v.addColorStop(0, C.transparent); v.addColorStop(1, C.vignette);
  ctx.fillStyle = v; ctx.fillRect(0, 0, VIDEO.width, VIDEO.height); ctx.restore();
}

function heading(ctx: CanvasRenderingContext2D, frame: number, title: string, caption: string) {
  const entrance = spring({ frame, fps: VIDEO.fps, config: theme.spring.smooth });
  ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, entrance));
  const seconds = frame / VIDEO.fps;
  ctx.translate((1 - entrance) * 18, (1 - entrance) * 18 + Math.sin(seconds * 1.4) * 1.5);
  text(ctx, title, 86, 320, 62, C.ink, false, 750);
  const words = caption.split(" "), lines: string[] = [];
  let current = "";
  ctx.font = "500 30px " + JSON.stringify(theme.fontFamily);
  for (const word of words) {
    const next = current ? current + " " + word : word;
    if (ctx.measureText(next).width > 875) { lines.push(current); current = word; } else current = next;
  }
  if (current) lines.push(current);
  lines.forEach((value, index) => text(ctx, value, 86, 380 + index * 42, 30, C.muted));
  ctx.restore();
}

function bowl(ctx: CanvasRenderingContext2D) {
  ctx.beginPath(); ctx.moveTo(WORLD.left, WORLD.top);
  ctx.lineTo(WORLD.left, bowlY(WORLD.left));
  for (let x = WORLD.left; x <= WORLD.right; x += 4) ctx.lineTo(x, bowlY(x));
  ctx.lineTo(WORLD.right, WORLD.top);
  ctx.strokeStyle = C.accent; ctx.lineWidth = 3; ctx.stroke();
}

/** Original geometry only: no downloaded symbols, logos or image assets. */
function emblem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tier: number, leading: boolean) {
  circle(ctx, x, y, r, leading ? C.primary : C.ink, leading ? C.primary : C.muted);
  ctx.beginPath();
  const sides = 3 + (tier - 1) % 6;
  for (let k = 0; k <= sides; k++) {
    const a = -Math.PI / 2 + k * Math.PI * 2 / sides;
    const px = x + Math.cos(a) * r * 0.52, py = y + Math.sin(a) * r * 0.52;
    k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.strokeStyle = C.background; ctx.lineWidth = Math.max(1.5, r * 0.06); ctx.stroke();
}

export function paintPhysics(ctx: CanvasRenderingContext2D, trace: Trace, frame: number) {
  background(ctx, frame);
  const state = trace.frames[Math.min(frame, trace.frames.length - 1)];
  const definition = STYLES.find((item) => item.slug === trace.style)!;
  const fade = 1 - easeIn((frame - (SCENE_FRAMES - VIDEO.fps * 0.17)) / (VIDEO.fps * 0.17));
  ctx.save(); ctx.globalAlpha = fade;
  heading(ctx, frame, definition.title, definition.caption);
  text(ctx, "SEED " + trace.seed + "  /  FIXED-STEP PHYSICS", 86, 480, 24, C.muted);
  line(ctx, WORLD.left, WORLD.top, WORLD.left, WORLD.bottom, C.line, 3);
  line(ctx, WORLD.right, WORLD.top, WORLD.right, WORLD.bottom, C.line, 3);
  if (trace.style === "pinball-bumper-matrix") {
    for (const bumper of BUMPERS) {
      circle(ctx, bumper.x, bumper.y, bumper.r + 7, C.surface);
      circle(ctx, bumper.x, bumper.y, bumper.r, C.surface, C.accent);
      circle(ctx, bumper.x, bumper.y, bumper.r * 0.35, C.faint);
    }
  } else if (trace.style === "pendulum-cascade") {
    for (let i = 0; i < 4; i++) {
      const p = paddleAt(i, frame / VIDEO.fps);
      line(ctx, p.a.x, p.a.y, p.b.x, p.b.y, C.accent, 14);
      circle(ctx, p.a.x, p.a.y, 10, C.ink);
      circle(ctx, p.b.x, p.b.y, 18, C.surface, C.muted);
    }
  } else {
    bowl(ctx);
    if (trace.style === "split-lane-funnel-merge") {
      for (const segment of FUNNEL) line(ctx, segment.a.x, segment.a.y, segment.b.x, segment.b.y, C.accent, 14);
      text(ctx, "LEFT INLET", 185, 525, 22, C.muted);
      text(ctx, "RIGHT INLET", 730, 525, 22, C.muted);
    } else {
      ctx.beginPath();
      for (let k = 0; k <= 240; k++) {
        const p = k / 240, angle = p * Math.PI * 5 + frame / VIDEO.fps * 0.15, r = 300 * (1 - p);
        const x = 540 + Math.cos(angle) * r, y = 970 + Math.sin(angle) * r * 0.7;
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  const leading = [...state.balls].sort((a, b) => b.tier - a.tier || a.id - b.id)[0]?.id;
  for (const ball of state.balls) {
    for (let age = 9; age >= 3; age -= 3) {
      const previous = trace.frames[Math.max(0, frame - age)]?.balls.find((b) => b.id === ball.id);
      if (previous) circle(ctx, previous.x, previous.y, ball.r * 0.45, C.trail);
    }
    emblem(ctx, ball.x, ball.y, ball.r, ball.tier, ball.id === leading);
  }
  for (const event of trace.events) {
    const age = (frame - event.frame) / VIDEO.fps;
    if (event.type !== "merge" || age < 0 || age > 0.35) continue;
    const p = easeOut(age / 0.35);
    ctx.save(); ctx.globalAlpha *= (1 - p) ** 2;
    ctx.beginPath(); ctx.arc(event.x, event.y, Math.max(1, p * 80), 0, Math.PI * 2);
    ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  }
  text(ctx, "LIVE MASS  " + (state.spawned - state.collected) + "     COLLECTED  " + state.collected, 540, 1510, 30, C.ink, true, 600);
  text(ctx, "Seeded motion. Every frame can be reproduced.", 540, 1570, 28, C.muted, true);
  ctx.restore(); finish(ctx, frame);
}

export function paintWave(ctx: CanvasRenderingContext2D, frame: number) {
  background(ctx, frame);
  const fade = 1 - easeIn((frame - (SCENE_FRAMES - VIDEO.fps * 0.17)) / (VIDEO.fps * 0.17));
  ctx.save(); ctx.globalAlpha = fade;
  heading(ctx, frame, "Pendulum Wave", "Twelve oscillators drift apart, then return to one shared phase");
  for (let i = WAVE.count - 1; i >= 0; i--) {
    const p = bobAt(i, frame / VIDEO.fps);
    line(ctx, WAVE.pivot.x, WAVE.pivot.y, p.x, p.y, C.line, 2);
    circle(ctx, p.x, p.y, 16, i === 0 ? C.primary : C.ink);
  }
  circle(ctx, WAVE.pivot.x, WAVE.pivot.y, 9, C.accent);
  text(ctx, "CYCLES PER LOOP   5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 / 16", 540, 1510, 23, C.ink, true, 600);
  text(ctx, "One closed formula. A twelve-second loop.", 540, 1570, 28, C.muted, true);
  ctx.restore(); finish(ctx, frame);
}
