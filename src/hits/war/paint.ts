import { drawReelText, type ReelBox } from "../../shared/reelUtils.ts";
import {
  chromeLayout,
  clamp01,
  drawChrome,
  easeOutCubic,
  fillBackdrop,
  FPS,
  PALETTE,
  SAFE,
  SAFE_CENTER_X,
  SAFE_WIDTH,
} from "../kit.ts";
import type { HitSpec } from "../types.ts";
import {
  BALL_R,
  CELL,
  CELLS,
  CLOCK_ZERO_FRAME,
  COLS,
  H,
  ROWS,
  TEAM_COLORS,
  TEAM_COUNT,
  TEAM_NAMES,
  TICK_FRAMES,
  W,
  type WarTrace,
} from "./sim.ts";

/**
 * ColourWarV4 painter: one full 1080 x 1920 frame from the pre-baked trace. It keeps no state between
 * frames (Remotion may render frames in any order) and batches everything: tiles go in one path and one
 * fill per colour per 8 x 8 block, ball bodies in a handful of fills.
 */

export const BANNER_FRAMES = 72; // 1.2 s
const TAU = Math.PI * 2;
const FLASH_ALPHA = [0.55, 0.34, 0.18, 0.08] as const;

type Rgb = readonly [number, number, number];
const hexToRgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const TEAM_RGB: readonly Rgb[] = TEAM_COLORS.map(hexToRgb);
const rgba = (c: Rgb, a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
/** Dark ink on the bright colours, white on violet: whichever contrasts more. */
const TEAM_INK: readonly string[] = TEAM_RGB.map((c) => {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  return lum > 0.3 ? "#07101c" : "#ffffff";
});

const UNOWNED_FILL = "#18222f";
const TILE_FILL: readonly string[] = [UNOWNED_FILL, ...TEAM_COLORS];

/* ---------- static tables (pure data, built once) ---------- */

const BLOCK = 8; // cells per block side: 10 block rows line up with a 6 x 10 grid of the canvas
const cellX = new Uint16Array(CELLS);
const cellY = new Uint16Array(CELLS);
const BLOCKS: Uint16Array[] = [];
for (let i = 0; i < CELLS; i++) {
  cellX[i] = (i % COLS) * CELL;
  cellY[i] = Math.floor(i / COLS) * CELL;
}
for (let br = 0; br < Math.ceil(ROWS / BLOCK); br++) {
  for (let bc = 0; bc < Math.ceil(COLS / BLOCK); bc++) {
    const list: number[] = [];
    for (let r = br * BLOCK; r < Math.min(ROWS, (br + 1) * BLOCK); r++) {
      for (let c = bc * BLOCK; c < Math.min(COLS, (bc + 1) * BLOCK); c++) list.push(r * COLS + c);
    }
    BLOCKS.push(Uint16Array.from(list));
  }
}

// scratch buffers, overwritten on every call
const bins: Uint16Array[] = [0, 1, 2, 3, 4].map(() => new Uint16Array(BLOCK * BLOCK));
const binN = new Uint16Array(5);
const ownedList = new Uint16Array(CELLS);

/* ---------- small helpers ---------- */

const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
};
const wrap = (v: number, m: number): number => ((v % m) + m) % m;

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function withShadow(ctx: CanvasRenderingContext2D, draw: () => void, blur = 12): void {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.78)";
  ctx.shadowBlur = blur;
  draw();
  ctx.restore();
}

/** The clock: one tick per real second from 0:22 down to 0:00, which it reaches at frame 1344 (22.4 s). */
export function clockText(frame: number): string {
  const remaining = Math.max(0, (CLOCK_ZERO_FRAME - frame) / FPS);
  const shown = Math.min(22, Math.ceil(remaining - 1e-9));
  return `0:${String(Math.max(0, shown)).padStart(2, "0")}`;
}

/** A slow ambient dot: deterministic from the trace and the frame number. */
export function ambientDotAt(
  trace: WarTrace,
  i: number,
  frame: number,
): { x: number; y: number; size: number; alpha: number } {
  const d = trace.dots;
  const t = frame / FPS;
  return {
    x: wrap(d[i * 6] + d[i * 6 + 2] * t, W),
    y: wrap(d[i * 6 + 1] + d[i * 6 + 3] * t, H),
    size: d[i * 6 + 4],
    alpha: 0.1 + 0.16 * (0.5 + 0.5 * Math.sin(t * 1.7 + d[i * 6 + 5])),
  };
}

function winnerOf(trace: WarTrace): number {
  let best = 0;
  for (let t = 1; t < TEAM_COUNT; t++) {
    if (trace.counts[CLOCK_ZERO_FRAME * TEAM_COUNT + t] > trace.counts[CLOCK_ZERO_FRAME * TEAM_COUNT + best]) best = t;
  }
  return best;
}

/* ---------- board ---------- */

function paintTiles(ctx: CanvasRenderingContext2D, trace: WarTrace, f: number): void {
  const own = trace.own;
  const base = f * CELLS;
  let ownedN = 0;
  for (const cells of BLOCKS) {
    binN.fill(0);
    for (let k = 0; k < cells.length; k++) {
      const idx = cells[k];
      const o = own[base + idx];
      bins[o][binN[o]++] = idx;
    }
    for (let o = 0; o < 5; o++) {
      const n = binN[o];
      if (n === 0) continue;
      const bin = bins[o];
      ctx.fillStyle = TILE_FILL[o];
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const idx = bin[k];
        ctx.rect(cellX[idx] + 0.5, cellY[idx] + 0.5, CELL - 1, CELL - 1);
        if (o > 0) ownedList[ownedN++] = idx;
      }
      ctx.fill();
    }
  }
  // a little bevel on owned tiles: a light top edge and a dark bottom edge, two fills for the whole board
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  for (let k = 0; k < ownedN; k++) ctx.rect(cellX[ownedList[k]] + 1.5, cellY[ownedList[k]] + 1.5, CELL - 3, 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.17)";
  ctx.beginPath();
  for (let k = 0; k < ownedN; k++) ctx.rect(cellX[ownedList[k]] + 1.5, cellY[ownedList[k]] + CELL - 3.5, CELL - 3, 2);
  ctx.fill();
}

/** Tiles that just changed owner flash white and fade over 12 frames: every ball drags a bright comet tail. */
function paintCaptureFlash(ctx: CanvasRenderingContext2D, trace: WarTrace, f: number): void {
  const base = f * CELLS;
  for (let b = 0; b < FLASH_ALPHA.length; b++) {
    let any = false;
    ctx.beginPath();
    for (let age = b * 3; age < b * 3 + 3; age++) {
      const g = f - age;
      if (g < 1) break;
      for (let k = trace.capStart[g]; k < trace.capStart[g + 1]; k++) {
        const idx = trace.capCell[k];
        if (trace.own[base + idx] !== trace.capTeam[k] + 1) continue; // taken again since
        ctx.rect(cellX[idx] + 0.5, cellY[idx] + 0.5, CELL - 1, CELL - 1);
        any = true;
      }
    }
    if (any) {
      ctx.fillStyle = `rgba(255,255,255,${FLASH_ALPHA[b]})`;
      ctx.fill();
    }
  }
}

/** The board is frozen: the winner pulses, everything else dims. */
function paintWinnerPulse(ctx: CanvasRenderingContext2D, trace: WarTrace, f: number, winner: number): void {
  const endT = f - CLOCK_ZERO_FRAME;
  const dim = easeOutCubic(endT / 24);
  const base = f * CELLS;
  ctx.fillStyle = `rgba(5,7,11,${0.58 * dim})`;
  ctx.beginPath();
  for (let i = 0; i < CELLS; i++) if (trace.own[base + i] !== winner + 1) ctx.rect(cellX[i], cellY[i], CELL, CELL);
  ctx.fill();
  const pulse = 0.5 + 0.5 * Math.sin(endT * 0.21 - 1.2);
  ctx.fillStyle = `rgba(255,255,255,${(0.05 + 0.2 * pulse) * dim})`;
  ctx.beginPath();
  for (let i = 0; i < CELLS; i++) if (trace.own[base + i] === winner + 1) ctx.rect(cellX[i], cellY[i], CELL, CELL);
  ctx.fill();
}

function paintAmbient(ctx: CanvasRenderingContext2D, trace: WarTrace, f: number): void {
  const count = trace.dots.length / 6;
  for (let b = 1; b <= 3; b++) {
    ctx.fillStyle = `rgba(255,255,255,${(0.07 * b + 0.035).toFixed(3)})`;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const d = ambientDotAt(trace, i, f);
      if (Math.min(3, Math.floor(d.alpha / 0.07)) !== b) continue;
      ctx.moveTo(d.x + d.size, d.y);
      ctx.arc(d.x, d.y, d.size, 0, TAU);
    }
    ctx.fill();
  }
}

/* ---------- balls and underdog rings ---------- */

function paintRings(ctx: CanvasRenderingContext2D, trace: WarTrace, f: number): void {
  const n = trace.nBalls;
  for (let j = 0; j < TICK_FRAMES.length; j++) {
    const tick = TICK_FRAMES[j];
    const age = f - tick;
    if (age < 0 || age >= 50) continue;
    const team = trace.tickTeam[j];
    for (let i = 0; i < n; i++) {
      if (trace.ballBorn[i] !== tick) continue;
      const cx = trace.pos[(tick * n + i) * 2];
      const cy = trace.pos[(tick * n + i) * 2 + 1];
      if (age < 16) {
        const a = 1 - age / 16;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 120);
        g.addColorStop(0, `rgba(255,255,255,${(0.75 * a).toFixed(3)})`);
        g.addColorStop(0.35, rgba(TEAM_RGB[team], 0.55 * a));
        g.addColorStop(1, rgba(TEAM_RGB[team], 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, 120, 0, TAU);
        ctx.fill();
      }
      for (let ring = 0; ring < 2; ring++) {
        const p = (age - ring * 9) / 50;
        if (p <= 0 || p >= 1) continue;
        ctx.lineWidth = 3 + 9 * (1 - p);
        ctx.strokeStyle = ring === 0 ? rgba(TEAM_RGB[team], (1 - p) ** 1.3) : `rgba(255,255,255,${((1 - p) ** 1.5 * 0.85).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx, cy, 24 + 150 * easeOutCubic(p), 0, TAU);
        ctx.stroke();
      }
    }
  }
}

function paintBalls(ctx: CanvasRenderingContext2D, trace: WarTrace, f: number): void {
  const n = trace.nBalls;
  const endT = f - CLOCK_ZERO_FRAME;
  const grow = endT > 0 ? 1 - clamp01(endT / 18) : 1;
  if (grow <= 0) return;
  const at = (frame: number, i: number): [number, number] => [trace.pos[(frame * n + i) * 2], trace.pos[(frame * n + i) * 2 + 1]];

  // ghost trail: three fading copies behind each ball
  const ghostAlpha = [0.3, 0.18, 0.09];
  for (let g = 1; g <= 3; g++) {
    ctx.fillStyle = `rgba(255,255,255,${ghostAlpha[g - 1] * grow})`;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (trace.ballBorn[i] > f - g) continue;
      const [x, y] = at(f - g, i);
      const r = (BALL_R - g * 1.6) * grow;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
    ctx.fill();
  }

  // colour halo, extra large in the first second so the four starting balls read at frame 0
  const haloR = (60 + 80 * Math.max(0, 1 - f / 50)) * grow;
  for (let i = 0; i < n; i++) {
    if (trace.ballBorn[i] > f) continue;
    const [x, y] = at(f, i);
    const team = trace.ballTeam[i];
    const g = ctx.createRadialGradient(x, y, 4, x, y, haloR);
    g.addColorStop(0, rgba(TEAM_RGB[team], 0.78));
    g.addColorStop(1, rgba(TEAM_RGB[team], 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, haloR, 0, TAU);
    ctx.fill();
  }

  // body: dark outline, white ring, colour core, glint. Each layer is one fill for all balls (cores: one per team).
  const discs = (radius: number, fill: string, dx = 0, dy = 0, team = -1): void => {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (trace.ballBorn[i] > f || (team >= 0 && trace.ballTeam[i] !== team)) continue;
      const [x, y] = at(f, i);
      const r = radius * grow;
      ctx.moveTo(x + dx * grow + r, y + dy * grow);
      ctx.arc(x + dx * grow, y + dy * grow, r, 0, TAU);
      any = true;
    }
    if (any) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
  };
  discs(BALL_R + 4, "rgba(5,7,11,0.88)");
  discs(BALL_R + 1.5, "#ffffff");
  for (let team = 0; team < TEAM_COUNT; team++) discs(BALL_R - 3.5, TEAM_COLORS[team], 0, 0, team);
  discs(3.6, "rgba(255,255,255,0.9)", -4, -5);
}

/* ---------- HUD ---------- */

/**
 * The HUD, banner and ending below are laid out for a chrome whose counters start at y 506. The shared
 * chrome now has a bigger hook and a two-line rule, so the painter shifts them by the difference.
 */
const HUD_BASE_COUNTER_Y = 506;

const HUD_Y = {
  clockLabel: 478,
  clock: 552,
  bar: 580,
  barH: 34,
  label: 662,
  count: 700,
} as const;

function paintScrims(ctx: CanvasRenderingContext2D): void {
  const top = ctx.createLinearGradient(0, 0, 0, 560);
  top.addColorStop(0, "rgba(5,7,11,0.2)");
  top.addColorStop(0.4, "rgba(5,7,11,0.56)");
  top.addColorStop(0.62, "rgba(5,7,11,0.68)");
  top.addColorStop(0.84, "rgba(5,7,11,0.45)");
  top.addColorStop(1, "rgba(5,7,11,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 560);
  const bottom = ctx.createLinearGradient(0, 1400, 0, H);
  bottom.addColorStop(0, "rgba(5,7,11,0)");
  bottom.addColorStop(0.3, "rgba(5,7,11,0.5)");
  bottom.addColorStop(1, "rgba(5,7,11,0.8)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 1400, W, H - 1400);
}

function paintHud(ctx: CanvasRenderingContext2D, boxes: ReelBox[], trace: WarTrace, f: number): void {
  const cells = [0, 1, 2, 3].map((t) => trace.counts[f * TEAM_COUNT + t]);
  const leader = cells.indexOf(Math.max(...cells));
  const balls = new Array<number>(TEAM_COUNT).fill(0);
  for (let i = 0; i < trace.nBalls; i++) if (trace.ballBorn[i] <= f) balls[trace.ballTeam[i]]++;

  // scoreboard card: tiles stay visible through it, and the team-coloured labels never sit on their own colour
  ctx.fillStyle = "rgba(6,9,15,0.6)";
  roundRectPath(ctx, 48, 452, 864, 276, 34);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // clock, pulsing on every digit change in the last 3 s
  const left = Math.max(0, (CLOCK_ZERO_FRAME - f) / FPS);
  const sinceDigit = (((f - CLOCK_ZERO_FRAME) % 60) + 60) % 60;
  const beat = left <= 3 && f <= CLOCK_ZERO_FRAME ? Math.max(0, 1 - sinceDigit / 14) : 0;
  withShadow(ctx, () => {
    drawReelText(ctx, boxes, "TIME LEFT", SAFE_CENTER_X, HUD_Y.clockLabel, {
      size: 22,
      weight: 700,
      align: "center",
      color: PALETTE.muted,
    });
    drawReelText(ctx, boxes, clockText(f), SAFE_CENTER_X, HUD_Y.clock, {
      size: 78 + 12 * beat,
      weight: 900,
      align: "center",
      color: beat > 0.45 ? "#ffffff" : PALETTE.lime,
    });
  });

  // one stacked share bar across the safe width; the unclaimed rest of the board stays an empty track
  const barX = SAFE.left;
  const barY = HUD_Y.bar;
  const barH = HUD_Y.barH;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRectPath(ctx, barX, barY, SAFE_WIDTH, barH, barH / 2);
  ctx.fill();
  ctx.save();
  roundRectPath(ctx, barX, barY, SAFE_WIDTH, barH, barH / 2);
  ctx.clip();
  let cursor = barX;
  for (let t = 0; t < TEAM_COUNT; t++) {
    const w = (cells[t] / CELLS) * SAFE_WIDTH;
    if (w <= 0) continue;
    ctx.fillStyle = TEAM_COLORS[t];
    ctx.fillRect(cursor, barY, w, barH);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fillRect(cursor, barY, w, 5);
    ctx.fillStyle = "rgba(5,7,11,0.9)";
    ctx.fillRect(cursor + w - 2, barY, 2, barH);
    cursor += w;
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  roundRectPath(ctx, barX, barY, SAFE_WIDTH, barH, barH / 2);
  ctx.stroke();

  // the most recent underdog tick lights up the colour's ball count
  let pulseTeam = -1;
  let pulse = 0;
  for (let j = 0; j < TICK_FRAMES.length; j++) {
    const age = f - TICK_FRAMES[j];
    if (age >= 0 && age < 60) {
      pulseTeam = trace.tickTeam[j];
      pulse = 1 - age / 60;
    }
  }

  const colW = SAFE_WIDTH / TEAM_COUNT;
  for (let t = 0; t < TEAM_COUNT; t++) {
    const cx = SAFE.left + colW * (t + 0.5);
    const pct = Math.round((cells[t] / CELLS) * 100);
    withShadow(ctx, () => {
      drawReelText(ctx, boxes, `${TEAM_NAMES[t]} ${pct}%`, cx, HUD_Y.label, {
        size: t === leader && cells[t] > 0 ? 33 : 30,
        weight: 800,
        align: "center",
        maxWidth: colW - 10,
        color: TEAM_COLORS[t],
      });
    });
    const lit = t === pulseTeam;
    if (lit) {
      ctx.fillStyle = rgba(TEAM_RGB[t], 0.95 * Math.sqrt(pulse));
      roundRectPath(ctx, cx - 54, HUD_Y.count - 31, 108, 44, 22);
      ctx.fill();
    }
    // a small ball marker beside the count
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx - 24, HUD_Y.count - 10, 10, 0, TAU);
    ctx.fill();
    ctx.fillStyle = TEAM_COLORS[t];
    ctx.beginPath();
    ctx.arc(cx - 24, HUD_Y.count - 10, 6.5, 0, TAU);
    ctx.fill();
    withShadow(ctx, () => {
      drawReelText(ctx, boxes, `x${balls[t]}`, cx + 14, HUD_Y.count, {
        size: 28,
        weight: 800,
        align: "center",
        maxWidth: 70,
        color: lit && pulse > 0.35 ? TEAM_INK[t] : PALETTE.ink,
      });
    }, lit ? 0 : 10);
  }
}

/** The last 3 s pulse with the audio beats (a soft lime vignette each clock second); the buzzer flashes white. */
function paintBeats(ctx: CanvasRenderingContext2D, f: number): void {
  const endT = f - CLOCK_ZERO_FRAME;
  if (endT >= 0) {
    if (endT < 9) {
      ctx.fillStyle = `rgba(255,255,255,${(0.3 * (1 - endT / 9) ** 2).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    return;
  }
  if (-endT > 180) return;
  const since = (((f - CLOCK_ZERO_FRAME) % 60) + 60) % 60; // frames since the clock digit changed
  const a = 0.34 * Math.max(0, 1 - since / 16) ** 2;
  if (a < 0.01) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, 520, W / 2, H / 2, 1180);
  g.addColorStop(0, "rgba(200,255,0,0)");
  g.addColorStop(1, `rgba(200,255,0,${a.toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* ---------- announcements ---------- */

function paintBanner(ctx: CanvasRenderingContext2D, boxes: ReelBox[], trace: WarTrace, f: number): void {
  for (let j = 0; j < TICK_FRAMES.length; j++) {
    const age = f - TICK_FRAMES[j];
    if (age < 0 || age >= BANNER_FRAMES) continue;
    const team = trace.tickTeam[j];
    const scale = 0.7 + 0.3 * easeOutBack(age / 12);
    const alpha = clamp01(age / 5) * clamp01((BANNER_FRAMES - age) / 10);
    const cx = SAFE_CENTER_X;
    const cy = 800;
    const w = 740 * scale;
    const h = 108 * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = rgba(TEAM_RGB[team], 0.85);
    ctx.shadowBlur = 38;
    ctx.fillStyle = TEAM_COLORS[team];
    roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.24)";
    roundRectPath(ctx, cx - w / 2 + 8, cy - h / 2 + 6, w - 16, h * 0.34, h * 0.17);
    ctx.fill();
    drawReelText(ctx, boxes, `UNDERDOG: ${TEAM_NAMES[team]} x2`, cx, cy + 19 * scale, {
      size: 56 * scale,
      weight: 900,
      align: "center",
      maxWidth: 700,
      color: TEAM_INK[team],
    });
    // the reason, on a dark capsule so it reads over any tiles
    ctx.fillStyle = "rgba(5,7,11,0.78)";
    roundRectPath(ctx, cx - 350 * scale, cy + h / 2 + 12, 700 * scale, 54, 27);
    ctx.fill();
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 6;
    const pct = Math.round((trace.tickCells[j] / CELLS) * 100);
    drawReelText(ctx, boxes, `smallest share: ${pct}%. Its balls double.`, cx, cy + h / 2 + 49, {
      size: 30 * scale,
      weight: 700,
      align: "center",
      maxWidth: 680,
      color: PALETTE.ink,
    });
    ctx.restore();
  }
}

function paintConfetti(
  ctx: CanvasRenderingContext2D,
  trace: WarTrace,
  endT: number,
  winner: number,
  dy: number,
): void {
  const count = Math.min(90, trace.dots.length / 6);
  const t = endT / FPS;
  const fade = clamp01(1 - (endT - 36) / 56);
  if (fade <= 0) return;
  const colours = [TEAM_COLORS[winner], "#ffffff", PALETTE.lime];
  for (let c = 0; c < colours.length; c++) {
    ctx.fillStyle = colours[c];
    ctx.globalAlpha = fade;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const k = i % 7 < 4 ? 0 : i % 7 < 6 ? 1 : 2;
      if (k !== c) continue;
      const angle = trace.dots[i * 6 + 5];
      const speed = 700 + trace.dots[i * 6 + 4] * 260;
      const dist = (speed * (1 - Math.exp(-3.2 * t))) / 3.2;
      const x = SAFE_CENTER_X + Math.cos(angle) * dist;
      const y = 960 + Math.sin(angle) * dist + 300 * t * t;
      const r = 4 + trace.dots[i * 6 + 4] * 1.3;
      if ((y > 440 + dy && y < 740 + dy) || y > 1460) continue; // the scoreboard card and the CTA lines stay clean
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintEnding(ctx: CanvasRenderingContext2D, boxes: ReelBox[], trace: WarTrace, f: number, winner: number): void {
  const endT = f - CLOCK_ZERO_FRAME;
  if (endT < 0) return;
  const pop = easeOutBack(endT / 16);
  const alpha = clamp01(endT / 6);
  const shares = [0, 1, 2, 3].map((t) => trace.counts[f * TEAM_COUNT + t]);
  const pct = Math.round((shares[winner] / CELLS) * 100);
  // the percent in the winner's colour, lifted toward white so violet still reads on the dark panel
  const lift = TEAM_RGB[winner].map((v) => Math.round(v + (255 - v) * 0.38));

  ctx.save();
  ctx.globalAlpha = alpha * 0.92;
  ctx.fillStyle = "rgba(5,7,11,0.78)";
  roundRectPath(ctx, 66, 764, 828, 392, 46);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = TEAM_COLORS[winner];
  ctx.lineWidth = 6;
  roundRectPath(ctx, 66, 764, 828, 392, 46);
  ctx.stroke();
  ctx.restore();

  // lime result line (same look as the kit's result style), kept clear of the panel edges
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 20;
  drawReelText(ctx, boxes, `${TEAM_NAMES[winner]} TAKES THE BOARD`, SAFE_CENTER_X, 866, {
    size: 70 * (0.7 + 0.3 * pop),
    weight: 900,
    align: "center",
    maxWidth: 740,
    color: PALETTE.lime,
  });
  ctx.shadowColor = rgba(TEAM_RGB[winner], 0.8);
  ctx.shadowBlur = 36;
  drawReelText(ctx, boxes, `${pct}%`, SAFE_CENTER_X, 1044, {
    size: 180 * (0.6 + 0.4 * pop),
    weight: 900,
    align: "center",
    maxWidth: 700,
    color: `rgb(${lift[0]},${lift[1]},${lift[2]})`,
  });
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 8;
  drawReelText(ctx, boxes, "of the board", SAFE_CENTER_X, 1108, {
    size: 34,
    weight: 700,
    align: "center",
    maxWidth: 600,
    color: PALETTE.ink,
  });
  ctx.restore();
}

/* ---------- the frame ---------- */

export function paintWar(ctx: CanvasRenderingContext2D, spec: HitSpec, trace: WarTrace, frame: number): ReelBox[] {
  const boxes: ReelBox[] = [];
  const f = Math.max(0, Math.min(Math.round(frame), trace.frames - 1));
  const dy = chromeLayout(spec).counterY - HUD_BASE_COUNTER_Y;
  fillBackdrop(ctx, f, { top: "#090e16", bottom: "#05070b" });
  paintTiles(ctx, trace, f);
  if (f <= CLOCK_ZERO_FRAME + 12) paintCaptureFlash(ctx, trace, f);
  const winner = winnerOf(trace);
  if (f >= CLOCK_ZERO_FRAME) paintWinnerPulse(ctx, trace, f, winner);
  paintAmbient(ctx, trace, f);
  paintRings(ctx, trace, f);
  paintBalls(ctx, trace, f);
  if (f >= CLOCK_ZERO_FRAME) paintConfetti(ctx, trace, f - CLOCK_ZERO_FRAME, winner, dy);
  paintBeats(ctx, f);
  paintScrims(ctx);
  drawChrome(ctx, boxes, spec);
  ctx.save();
  ctx.translate(0, dy);
  paintHud(ctx, boxes, trace, f);
  paintBanner(ctx, boxes, trace, f);
  paintEnding(ctx, boxes, trace, f, winner);
  ctx.restore();
  return boxes;
}
