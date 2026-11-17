import type { MidiPainter } from "../components/MidiShell.tsx";
import {
  accentPulse, cameraKick, clamp, clamp01, drawGlow, drawSceneTitle, drawVignette, easeOutCubic, endFade, hsla, lerp, smoothstep,
} from "../midi/kit.ts";
import { pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import {
  arcState, barPulse, buildOrbit, climaxEnvelope, DISC, discRotation, firstEventAfter, firstEventAtOrAfter, HALF_PI, pickVisible,
  playheadAngle, polarX, polarY, shockwave, strikeGlowDiameter, TAU, type ArcState, type OrbitEvent, type OrbitModel,
} from "./layout.ts";
import { DUST_COUNT, dustAt, SPARK_MAX_LIFE, sparkAt, type DustPoint, type SparkPoint } from "./particles.ts";

/**
 * Canvas painter for Phase Orbit. All state is derived from the frame number: no simulation, no randomness
 * beyond the seeded hashes in particles.ts, so any frame can be rendered on its own.
 */

const BG = "#05060d";
const MAX_SPARKS = 420;
const HALO_SIZE = 208;
const SIX = TAU / 6;

/** Colour of the playhead, hub and guides: a cool lavender white. */
const COOL_HUE = 228;

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D canvas context unavailable");
  return [canvas, g];
}

/** Static backdrop: deep navy, a soft nebula glow around the disc, a faint warm/cool wash top and bottom. */
function makeBackground(width: number, height: number): HTMLCanvasElement {
  const [canvas, g] = makeCanvas(width, height);
  g.fillStyle = BG;
  g.fillRect(0, 0, width, height);
  const nebula = g.createRadialGradient(DISC.cx, DISC.cy, 30, DISC.cx, DISC.cy, 960);
  nebula.addColorStop(0, "rgba(40, 32, 96, 0.64)");
  nebula.addColorStop(0.28, "rgba(26, 22, 74, 0.46)");
  nebula.addColorStop(0.58, "rgba(14, 14, 42, 0.26)");
  nebula.addColorStop(1, "rgba(5, 6, 13, 0)");
  g.fillStyle = nebula;
  g.fillRect(0, 0, width, height);
  const wash = g.createLinearGradient(0, 0, 0, height);
  wash.addColorStop(0, "rgba(40, 12, 56, 0.18)");
  wash.addColorStop(0.35, "rgba(0, 0, 0, 0)");
  wash.addColorStop(0.8, "rgba(0, 0, 0, 0)");
  wash.addColorStop(1, "rgba(6, 30, 50, 0.2)");
  g.fillStyle = wash;
  g.fillRect(0, 0, width, height);
  return canvas;
}

/** The record itself: a dark, slightly bluish disc with a darker label area, blitted under the rings. */
function makePlate(): { canvas: HTMLCanvasElement; radius: number } {
  const radius = DISC.rim + 26;
  const [canvas, g] = makeCanvas(radius * 2, radius * 2);
  const gradient = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  const at = (r: number) => clamp01(r / radius);
  gradient.addColorStop(0, "rgba(5, 7, 20, 0.7)");
  gradient.addColorStop(at(DISC.rHub), "rgba(8, 10, 28, 0.62)");
  gradient.addColorStop(at(DISC.rIn - 24), "rgba(12, 15, 40, 0.5)");
  gradient.addColorStop(at(DISC.rOut + 10), "rgba(18, 22, 56, 0.5)");
  gradient.addColorStop(at(DISC.rim + 4), "rgba(30, 34, 82, 0.46)");
  gradient.addColorStop(1, "rgba(30, 34, 82, 0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, radius * 2, radius * 2);
  return { canvas, radius };
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, diameter: number, hue: number, alpha: number, core = 0.16) {
  if (alpha <= 0.003) return;
  drawGlow(ctx, x, y, diameter, hue, alpha, core);
  ctx.globalAlpha = 1;
}

function arcPath(ctx: CanvasRenderingContext2D, radius: number, from: number, to: number) {
  ctx.beginPath();
  ctx.arc(0, 0, radius, from, to);
}

/** Rings, grooves, rim and the twelve tick marks. `intro` draws the rings in clockwise during the lead-in. */
function drawGuides(ctx: CanvasRenderingContext2D, model: OrbitModel, frame: number, lead: number, appear: number, bar: number) {
  const radii = model.ringMap.guideRadii;
  ctx.lineCap = "butt";
  ctx.lineWidth = 1;
  ctx.strokeStyle = hsla(COOL_HUE, 0.5, 0.7, 0.04 * appear);
  ctx.beginPath();
  for (let i = 0; i + 1 < radii.length; i++) {
    const r = (radii[i] + radii[i + 1]) / 2;
    ctx.moveTo(r, 0);
    ctx.arc(0, 0, r, 0, TAU);
  }
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = hsla(COOL_HUE, 0.6, 0.76, 0.13 * appear);
  radii.forEach((r, i) => {
    const sweep = TAU * easeOutCubic((frame - i * 1.4) / (0.62 * lead));
    if (sweep <= 0.001) return;
    arcPath(ctx, r, -HALF_PI, -HALF_PI + sweep);
    ctx.stroke();
  });
  const rimSweep = TAU * easeOutCubic((frame - 4) / (0.7 * lead));
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = hsla(COOL_HUE, 0.6, 0.78, 0.26 * appear);
  arcPath(ctx, DISC.rim, -HALF_PI, -HALF_PI + rimSweep);
  ctx.stroke();
  // twelve ticks: one per eighth of a 6/4 bar, longer at the half-bar, longest at the bar line
  ctx.lineWidth = 2;
  ctx.strokeStyle = hsla(COOL_HUE, 0.5, 0.8, 0.3 * appear);
  ctx.beginPath();
  for (let k = 1; k < 12; k++) {
    const a = k * TAU / 12;
    const len = k === 6 ? 16 : k % 3 === 0 ? 12 : 8;
    ctx.moveTo(polarX(DISC.rim + 4, a), polarY(DISC.rim + 4, a));
    ctx.lineTo(polarX(DISC.rim + 4 + len, a), polarY(DISC.rim + 4 + len, a));
  }
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.strokeStyle = hsla(COOL_HUE, 0.7, 0.86, (0.34 + 0.66 * bar) * appear);
  ctx.beginPath();
  ctx.moveTo(0, -(DISC.rim + 4));
  ctx.lineTo(0, -(DISC.rim + 4 + 22));
  ctx.stroke();
}

/** One note as a neon tube: wide faint glow, body, bright core, swept (lit) part and the white-hot flash. */
function drawArc(ctx: CanvasRenderingContext2D, ev: OrbitEvent, st: ArcState, flare: number) {
  const velF = 0.6 + 0.4 * ev.vel;
  const thick = ev.thickness * clamp(1 + 0.55 * st.spring, 0.72, 1.6) * (1 + 0.22 * flare);
  const radius = ev.radius + 3 * Math.max(0, st.spring);
  const half = thick / 2;
  const start = ev.angle - HALF_PI;
  const lengthPx = ev.length * ev.radius * (1 - 0.1 * st.spring);
  const a0 = start + half / radius;
  const a1 = Math.max(a0 + 0.0008, start + (lengthPx - half) / radius);
  const alpha = clamp01(st.alpha * velF);
  const struck = st.age >= 0;
  const aLit = struck ? lerp(a0, a1, st.lit) : a0;
  const { hue, sat, light } = ev;
  ctx.lineCap = "round";

  // wide soft glow
  ctx.lineWidth = thick * 2.5;
  ctx.strokeStyle = hsla(hue, sat, light, 0.12 * alpha + 0.1 * st.flash * velF);
  arcPath(ctx, radius, a0, a1);
  ctx.stroke();
  // body: dim while upcoming, full once struck; the not yet swept remainder of a sounding note stays dim
  ctx.lineWidth = thick;
  if (!struck) {
    ctx.strokeStyle = hsla(hue, sat, light, alpha);
    arcPath(ctx, radius, a0, a1);
    ctx.stroke();
    return;
  }
  if (st.lit < 1) {
    ctx.strokeStyle = hsla(hue, sat, light, 0.42 * velF);
    arcPath(ctx, radius, aLit, a1);
    ctx.stroke();
  }
  ctx.strokeStyle = hsla(hue, sat * (1 - 0.3 * st.flash), light + (0.9 - light) * 0.4 * st.flash, alpha);
  arcPath(ctx, radius, a0, Math.max(a0 + 0.0008, aLit));
  ctx.stroke();
  // bright core along the swept part
  ctx.lineWidth = thick * 0.4;
  ctx.strokeStyle = hsla(hue, 0.8, 0.84, 0.85 * alpha);
  arcPath(ctx, radius, a0, Math.max(a0 + 0.0008, aLit));
  ctx.stroke();
  // white-hot flash over the whole arc
  if (st.flash > 0.01) {
    ctx.lineWidth = thick * (0.8 + 0.22 * st.flash);
    ctx.strokeStyle = hsla(hue, 0.85, 0.92, clamp01(st.flash * 0.92 * (0.5 + 0.5 * velF)));
    arcPath(ctx, radius, a0, a1);
    ctx.stroke();
  }
}

/**
 * Thin thread joining a note to the next note of the same voice (a polar curve from the end of one arc to the
 * start of the next), lit up by the playhead as it sweeps along it. Together the threads draw each voice's
 * melody as a ribbon winding around the disc, so a drifting voice is seen sliding against the other.
 */
function drawThread(ctx: CanvasRenderingContext2D, ev: OrbitEvent, next: OrbitEvent, t: number, period: number, stCur: ArcState, stNext: ArcState) {
  const base = (stCur.alpha + stNext.alpha) * 0.5;
  if (base < 0.02) return;
  const from = ev.angle + ev.length - ev.thickness * 0.5 / ev.radius;
  const to = ev.angle + TAU * (next.timeSec - ev.timeSec) / period + next.thickness * 0.5 / next.radius;
  const gap = Math.max(1e-6, next.timeSec - ev.endSec);
  const lit = clamp01((t - ev.endSec) / gap);
  const segments = 7;
  const point = (u: number, out: number[]) => {
    const eased = u * u * (3 - 2 * u);
    const r = ev.radius + (next.radius - ev.radius) * eased;
    const a = from + (to - from) * u;
    out[0] = polarX(r, a);
    out[1] = polarY(r, a);
  };
  const p = [0, 0];
  ctx.lineCap = "round";
  ctx.lineWidth = 2.2;
  for (let pass = 0; pass < 2; pass++) {
    const end = pass === 0 ? 1 : lit;
    if (end <= 0) continue;
    ctx.strokeStyle = hsla(next.hue, 0.75, pass === 0 ? 0.7 : 0.86, (pass === 0 ? 0.14 : 0.7) * base);
    ctx.beginPath();
    point(0, p);
    ctx.moveTo(p[0], p[1]);
    const steps = Math.max(2, Math.ceil(segments * end));
    for (let k = 1; k <= steps; k++) {
      point(end * k / steps, p);
      ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
  }
}

/** Glow where the playhead strikes the arc, and a small ripple ring around that point. */
function drawStrike(ctx: CanvasRenderingContext2D, ev: OrbitEvent, st: ArcState) {
  if (st.age < 0 || st.age > 0.5) return;
  const a = ev.angle + (ev.thickness * 0.5) / ev.radius;
  const x = polarX(ev.radius, a), y = polarY(ev.radius, a);
  const fast = Math.exp(-st.age / 0.07);
  glow(ctx, x, y, strikeGlowDiameter(ev.vel), ev.hue, 0.85 * fast * (0.6 + 0.4 * ev.vel));
  const u = st.age / 0.42;
  if (u < 1) {
    ctx.lineWidth = 2.2 * (1 - u) + 0.6;
    ctx.strokeStyle = hsla(ev.hue, 0.8, 0.75, 0.55 * ev.vel * (1 - u) ** 2);
    ctx.beginPath();
    ctx.arc(x, y, 7 + 40 * easeOutCubic(u), 0, TAU);
    ctx.stroke();
  }
}

function drawSparks(ctx: CanvasRenderingContext2D, model: OrbitModel, t: number, spark: SparkPoint, prev: SparkPoint) {
  const events = model.events;
  const from = firstEventAtOrAfter(events, t - SPARK_MAX_LIFE);
  const to = firstEventAfter(events, t);
  let budget = MAX_SPARKS;
  ctx.lineCap = "round";
  for (let i = to - 1; i >= from && budget > 0; i--) {
    const ev = events[i];
    const age = t - ev.timeSec;
    for (let j = 0; j < ev.sparkCount && budget > 0; j++) {
      if (!sparkAt(ev, j, age, spark)) continue;
      budget--;
      if (age < 0.4) { // short streak along the flight direction while the spark is fast
        const hasPrev = sparkAt(ev, j, Math.max(0, age - 0.035), prev);
        if (hasPrev) {
          ctx.lineWidth = Math.max(1.6, spark.size * 0.36);
          ctx.strokeStyle = hsla(ev.hue, 0.8, 0.82, 0.6 * spark.alpha);
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(spark.x, spark.y);
          ctx.stroke();
        }
      }
      glow(ctx, spark.x, spark.y, spark.size * 2.9, ev.hue, 0.95 * spark.alpha, 0.24);
    }
  }
}

function drawPlayhead(ctx: CanvasRenderingContext2D, angle: number, appear: number, hit: number) {
  const tip = DISC.rOut + 26;
  const a = angle - HALF_PI;
  ctx.save();
  ctx.rotate(a);
  ctx.globalCompositeOperation = "lighter";
  // comet tail: a long faint wedge and a short bright one, both fading away behind the line. The gradient
  // starts a little before the wedge edge so no seam line shows.
  for (const [tail, peak, hue] of [[1.6, 0.17, COOL_HUE], [0.55, 0.42, COOL_HUE + 10]] as const) {
    const span = tail + 0.12;
    const gradient = ctx.createConicGradient(-span, 0, 0);
    const f = span / TAU;
    const level = peak * appear;
    gradient.addColorStop(0, hsla(hue, 0.85, 0.8, 0));
    gradient.addColorStop(f * 0.5, hsla(hue, 0.85, 0.8, level * 0.1));
    gradient.addColorStop(f * 0.82, hsla(hue, 0.85, 0.82, level * 0.42));
    gradient.addColorStop(f, hsla(hue, 0.8, 0.88, level));
    gradient.addColorStop(1, hsla(hue, 0.8, 0.88, level));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, tip - 4, -tail, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.lineCap = "round";
  const line = (width: number, alpha: number, lightness: number) => {
    ctx.lineWidth = width;
    ctx.strokeStyle = hsla(COOL_HUE, 0.6, lightness, alpha * appear);
    ctx.beginPath();
    ctx.moveTo(DISC.rHub, 0);
    ctx.lineTo(tip, 0);
    ctx.stroke();
  };
  line(18, 0.07 + 0.05 * hit, 0.7);
  line(7, 0.3 + 0.12 * hit, 0.8);
  line(2.6, 0.95, 0.96);
  glow(ctx, tip, 0, 52, COOL_HUE, 0.8 * appear);
  ctx.restore();
}

/** Core glow at the hub, bar and unison pulses. */
function drawHub(ctx: CanvasRenderingContext2D, model: OrbitModel, t: number, appear: number, bar: number, accent: number, bloom: number) {
  const breathe = 0.5 + 0.5 * Math.sin(t * 1.3);
  glow(ctx, 0, 0, 230 + 60 * bar + 70 * Math.min(1, accent) + 70 * bloom, 246, (0.4 + 0.12 * breathe + 0.2 * bar - 0.1 * bloom) * appear);
  glow(ctx, 0, 0, 108 + 30 * bar + 30 * bloom, 214, (0.6 + 0.25 * bar - 0.15 * bloom) * appear, 0.3);
  ctx.lineCap = "round";
  ctx.lineWidth = 2;
  ctx.strokeStyle = hsla(COOL_HUE, 0.6, 0.8, (0.3 + 0.25 * bar) * appear);
  ctx.beginPath();
  ctx.arc(0, 0, DISC.rHub - 14, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = hsla(COOL_HUE, 0.6, 0.8, 0.16 * appear);
  ctx.beginPath();
  ctx.arc(0, 0, DISC.rHub - 30, 0, TAU);
  ctx.stroke();

  // unison pulses: a ring leaving the hub and a ghost spoke linking the coinciding voices
  const co = model.coincidences;
  const to = firstEventAfter(co, t);
  const from = Math.max(firstEventAtOrAfter(co, t - 1.35), to - 24);
  for (let i = from; i < to; i++) {
    const c = co[i];
    const age = t - c.timeSec;
    const u = age / 0.9;
    if (u >= 1 && !(c.strength >= 0.65 && age < 1.3)) continue;
    if (u < 1) {
      ctx.lineWidth = 1.5 + 3 * c.strength * (1 - u);
      ctx.strokeStyle = hsla(c.hue, 0.5, 0.86, 0.7 * c.strength * (1 - u) ** 2);
      ctx.beginPath();
      ctx.arc(0, 0, 26 + 76 * easeOutCubic(u), 0, TAU);
      ctx.stroke();
    }
    glow(ctx, 0, 0, 120 + 100 * c.strength, c.hue, 0.5 * c.strength * Math.exp(-age / 0.18), 0.3);
    if (c.strength >= 0.65 && age < 1.3) {
      const w = age / 1.3;
      ctx.lineWidth = 2 + 6 * (1 - w);
      ctx.strokeStyle = hsla(c.hue, 0.45, 0.88, 0.5 * c.strength * (1 - w) ** 2);
      ctx.beginPath();
      ctx.arc(0, 0, 40 + (DISC.rim - 46) * easeOutCubic(w), 0, TAU);
      ctx.stroke();
    }
    const fade = Math.exp(-age / 0.32) * c.strength;
    if (fade > 0.02 && c.rMax > c.rMin + 1) {
      ctx.lineWidth = 2 + 2 * c.strength;
      ctx.strokeStyle = hsla(c.hue, 0.45, 0.92, 0.75 * fade);
      ctx.beginPath();
      ctx.moveTo(polarX(c.rMin, c.angle), polarY(c.rMin, c.angle));
      ctx.lineTo(polarX(c.rMax, c.angle), polarY(c.rMax, c.angle));
      ctx.stroke();
      glow(ctx, polarX(c.rMin, c.angle), polarY(c.rMin, c.angle), 40 * (0.6 + c.strength), c.hue, 0.7 * fade);
      glow(ctx, polarX(c.rMax, c.angle), polarY(c.rMax, c.angle), 40 * (0.6 + c.strength), c.hue, 0.7 * fade);
    }
  }
}

/** Bloom and shockwaves of the final chord. */
function drawClimax(ctx: CanvasRenderingContext2D, model: OrbitModel, t: number) {
  const climax = model.climax;
  if (!climax || t < climax.timeSec) return;
  const age = t - climax.timeSec;
  const env = Math.exp(-age / 0.75) * climax.strength;
  glow(ctx, 0, 0, DISC.bloomDiameter * (0.62 + 0.38 * easeOutCubic(age / 0.5)), 38, 0.4 * env, 0.3);
  glow(ctx, 0, 0, 300 + 160 * easeOutCubic(age / 0.7), 280, 0.42 * env);
  ctx.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    const wave = shockwave(age, k);
    if (!wave) continue;
    ctx.lineWidth = wave.width;
    ctx.strokeStyle = hsla(k === 0 ? 45 : k === 1 ? 190 : 300, 0.7, k === 0 ? 0.9 : 0.78, 0.8 * wave.alpha * climax.strength);
    ctx.beginPath();
    ctx.arc(0, 0, wave.radius, 0, TAU);
    ctx.stroke();
  }
}

interface LegendEntry {
  name: string;
  hue: number;
  sat: number;
  light: number;
  /** Onset times of the voice, ascending. */
  onsets: number[];
  width: number;
}

const LEGEND_FONT = '600 21px "Inter Variable", Inter, sans-serif';

/** One entry per voice (at most six): a glowing dot and the track name, lighting up whenever the voice plays. */
function buildLegend(scene: MidiSceneData, model: OrbitModel): LegendEntry[] {
  const byTrack = new Map<number, LegendEntry>();
  for (const ev of model.events) {
    let entry = byTrack.get(ev.track);
    if (!entry) {
      const info = scene.tracks.find((track) => track.index === ev.track);
      const name = (info?.name || "Voice " + (ev.slot + 1)).toUpperCase().slice(0, 14);
      entry = { name, hue: ev.hue, sat: ev.sat, light: ev.light, onsets: [], width: 0 };
      byTrack.set(ev.track, entry);
    }
    entry.onsets.push(ev.timeSec);
  }
  return [...byTrack.values()].slice(0, 6);
}

/** Entries per row, wrapping greedily so a row is never wider than `maxWidth` (the reel safe area). */
function legendRows(entries: LegendEntry[], gap: number, maxWidth: number): LegendEntry[][] {
  const rows: LegendEntry[][] = [[]];
  let used = 0;
  for (const entry of entries) {
    const row = rows[rows.length - 1];
    if (row.length && used + gap + entry.width > maxWidth) { rows.push([entry]); used = entry.width; }
    else { row.push(entry); used += (row.length > 1 ? gap : 0) + entry.width; }
  }
  return rows;
}

function drawLegend(ctx: CanvasRenderingContext2D, entries: LegendEntry[], t: number, appear: number) {
  if (!entries.length) return;
  const letterSpaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  ctx.save();
  ctx.font = LEGEND_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  letterSpaced.letterSpacing = "3px";
  const gap = 34, dot = 22;
  for (const entry of entries) if (!entry.width) entry.width = ctx.measureText(entry.name).width + dot;
  const rows = legendRows(entries, gap, 760);
  rows.forEach((row, rowIndex) => {
    const total = row.reduce((sum, entry) => sum + entry.width, 0) + gap * (row.length - 1);
    let x = DISC.cx - total / 2;
    const y = 1496 + rowIndex * 38;
    for (const entry of row) {
      const first = entry.onsets[0];
      const enter = smoothstep(first - 0.5, first + 0.3, t) * appear;
      let lo = 0, hi = entry.onsets.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (entry.onsets[mid] <= t) lo = mid + 1; else hi = mid; }
      const pulse = lo > 0 ? Math.exp(-(t - entry.onsets[lo - 1]) / 0.2) : 0;
      if (enter > 0.01) {
        ctx.globalCompositeOperation = "lighter";
        glow(ctx, x + 5, y - 7, 26 + 14 * pulse, entry.hue, enter * (0.5 + 0.5 * pulse));
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = hsla(entry.hue, 0.9, 0.7, enter * (0.7 + 0.3 * pulse));
        ctx.beginPath();
        ctx.arc(x + 5, y - 7, 4.5 + 1.5 * pulse, 0, TAU);
        ctx.fill();
        ctx.fillStyle = hsla(228, 0.35, 0.82, enter * (0.42 + 0.4 * pulse));
        ctx.fillText(entry.name, x + dot, y);
      }
      x += entry.width + gap;
    }
  });
  letterSpaced.letterSpacing = "0px";
  ctx.restore();
}

/**
 * Kaleidoscope halo: the notes struck in the last moments, mirrored six-fold into a corona band just outside the
 * outer ring. Drawn small and blown up with smoothing so it comes out soft, dim and cheap. Only fresh strikes
 * feed it, so it is a symmetric firework that follows the playhead and never covers the data.
 */
function drawKaleidoscope(
  ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, h: CanvasRenderingContext2D, model: OrbitModel,
  t: number, appear: number, bar: number, bloom: number,
) {
  const events = model.events;
  h.setTransform(1, 0, 0, 1, 0, 0);
  h.clearRect(0, 0, HALO_SIZE, HALO_SIZE);
  h.globalCompositeOperation = "lighter";
  h.lineCap = "round";
  const hk = (HALO_SIZE / 2) / DISC.rMax;
  const half = HALO_SIZE / 2;
  const ringSpan = Math.max(1, DISC.rOut - DISC.rIn);
  const from = firstEventAtOrAfter(events, t - 1.6);
  let budget = 72;
  for (let i = firstEventAfter(events, t) - 1; i >= from && budget > 0; i--) {
    const ev = events[i];
    const age = t - ev.timeSec;
    const level = ev.vel * Math.exp(-age / (ev.climax ? 0.8 : 0.3)) * (ev.climax ? 1.5 : 1);
    if (level < 0.04) continue;
    budget--;
    const rr = (DISC.haloIn + (DISC.haloOut - DISC.haloIn) * clamp01((ev.radius - DISC.rIn) / ringSpan)) * hk;
    h.lineWidth = Math.max(2, ev.thickness * 1.1 * hk);
    h.strokeStyle = hsla(ev.hue, ev.sat, ev.light, clamp01(level));
    const dash = Math.min(ev.length, ev.climax ? 0.6 : 0.26);
    const mid = ev.angle + ev.length / 2;
    h.beginPath();
    for (let m = 0; m < 6; m++) {
      for (let mirror = 0; mirror < 2; mirror++) {
        const a0 = (mirror ? -(mid + dash / 2) : mid - dash / 2) + m * SIX - HALF_PI;
        const a1 = (mirror ? -(mid - dash / 2) : mid + dash / 2) + m * SIX - HALF_PI;
        h.moveTo(half + rr * Math.cos(a0), half + rr * Math.sin(a0));
        h.arc(half, half, rr, a0, a1);
      }
    }
    h.stroke();
  }
  ctx.globalCompositeOperation = "lighter";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalAlpha = clamp01((0.55 + 0.5 * bloom + 0.15 * bar) * appear);
  ctx.drawImage(canvas, -DISC.rMax, -DISC.rMax, DISC.rMax * 2, DISC.rMax * 2);
  ctx.globalAlpha = 1;
}

export function createOrbitPainter(scene: MidiSceneData, label: string): MidiPainter {
  const model = buildOrbit(scene);
  const { events, period } = model;
  const width = scene.width, height = scene.height;
  let background: HTMLCanvasElement | undefined;
  let plate: { canvas: HTMLCanvasElement; radius: number } | undefined;
  let halo: [HTMLCanvasElement, CanvasRenderingContext2D] | undefined;
  const legend = buildLegend(scene, model);
  const picked: number[] = [];
  const states: ArcState[] = [];
  const spark: SparkPoint = { x: 0, y: 0, alpha: 0, size: 0 };
  const prev: SparkPoint = { x: 0, y: 0, alpha: 0, size: 0 };
  const dust: DustPoint = { x: 0, y: 0, alpha: 0, size: 0, hue: 0, depth: 0 };

  return (ctx, frame) => {
    background ??= makeBackground(width, height);
    plate ??= makePlate();
    halo ??= makeCanvas(HALO_SIZE, HALO_SIZE);
    const [haloCanvas, h] = halo;
    const t = pieceTime(scene, frame);
    const lead = Math.max(1, scene.leadFrames);
    const appear = easeOutCubic(frame / (lead * 0.9));

    const bar = barPulse(t, period);
    const accent = accentPulse(model.accents, t, 0.13);
    const kick = cameraKick(model.accents, t, 1);
    const bloom = climaxEnvelope(model.climax, t, 0.75);
    const flare = climaxEnvelope(model.climax, t, 1.4);
    const dx = clamp(kick.dx, -11, 11), dy = clamp(kick.dy, -11, 11);
    const zoom = clamp(kick.zoom + 0.011 * bar + 0.012 * Math.min(1, accent) + 0.012 * bloom, 0, DISC.maxZoom);
    const scale = lerp(0.93, 1, appear) * (1 + zoom);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(background, 0, 0);

    // star dust and a few big soft bokeh discs, drifting slowly with a little parallax on the camera kick
    ctx.globalCompositeOperation = "lighter";
    const dustBoost = (0.55 + 0.45 * appear) * (1 + 0.35 * bar + 1.2 * bloom);
    for (let i = 0; i < DUST_COUNT; i++) {
      dustAt(i, t, width, height, dust);
      glow(ctx, dust.x + dx * dust.depth * 0.6, dust.y + dy * dust.depth * 0.6, dust.size * 3.2, dust.hue, dust.alpha * dustBoost * 0.8, 0.28);
    }
    for (let i = 0; i < 9; i++) {
      dustAt(1000 + i, t, width, height, dust);
      glow(ctx, dust.x, dust.y, dust.size * 15, dust.hue, 0.09 * (0.4 + dust.alpha) * dustBoost, 0.05);
    }

    // the disc: everything below is in disc coordinates, rotated together and scaled by the breathing and kick
    ctx.save();
    ctx.translate(DISC.cx + dx, DISC.cy + dy);
    ctx.rotate(kick.rotation);
    ctx.scale(scale, scale);
    ctx.rotate(discRotation(t));

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = appear;
    ctx.drawImage(plate.canvas, -plate.radius, -plate.radius);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";

    pickVisible(model, t, picked);
    states.length = 0;
    const introFade = smoothstep(0.08, 0.85, frame / lead);
    for (const index of picked) {
      const st = arcState(events[index], t, period, flare);
      st.alpha *= introFade;
      states.push(st);
    }

    drawKaleidoscope(ctx, haloCanvas, h, model, t, appear, bar, bloom);
    drawGuides(ctx, model, frame, lead, appear, bar);

    // melodic threads under the arcs
    ctx.globalCompositeOperation = "lighter";
    for (let n = 0; n < picked.length; n++) {
      const ev = events[picked[n]];
      if (ev.next < 0 || !states[n].visible) continue;
      const next = events[ev.next];
      drawThread(ctx, ev, next, t, period, states[n], arcState(next, t, period, flare));
    }

    // notes: upcoming ones dim, struck ones bright with flash, pop and a glow where the playhead hit them
    let hit = 0;
    for (let n = 0; n < picked.length; n++) {
      const st = states[n];
      if (!st.visible) continue;
      drawArc(ctx, events[picked[n]], st, flare);
      if (st.age >= 0 && st.age < 0.12) hit = Math.max(hit, st.flash * events[picked[n]].vel);
    }
    for (let n = 0; n < picked.length; n++) if (states[n].visible) drawStrike(ctx, events[picked[n]], states[n]);

    drawSparks(ctx, model, t, spark, prev);
    drawPlayhead(ctx, playheadAngle(t, period), appear, hit);
    ctx.globalCompositeOperation = "lighter";
    drawHub(ctx, model, t, appear, bar, accent, bloom);
    drawClimax(ctx, model, t);
    ctx.restore();

    // finishing: vignette, title, end fade
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    drawVignette(ctx, width, height, 0.55);
    drawSceneTitle(ctx, scene, label, frame);
    drawLegend(ctx, legend, t, appear);
    const fade = endFade(frame, scene.totalFrames, scene.fps, 0.7);
    if (fade > 0.001) {
      ctx.globalAlpha = fade;
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }
  };
}
