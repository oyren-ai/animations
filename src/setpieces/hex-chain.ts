import {
  addBell,
  addBoom,
  addRiser,
  addSoftPad,
  addThud,
  addTick,
  addWhoosh,
  finishHitAudio,
  newHitBuffer,
  noteHz,
  PENTATONIC_MAJOR,
  scaleMidi,
  thinEvents,
} from "../hits/voices.ts";
import {
  clamp,
  clamp01,
  createMulberry32,
  paintPayoffBanner,
  paintSetPieceBackdrop,
  paintSetPieceChrome,
  SETPIECE_LAYOUT,
  SP_COLORS,
} from "./chrome.ts";
import type { SetPieceAudioResult, SetPieceModule, SetPieceSpec } from "./types.ts";

/**
 * SetPieceHexChain — "120 CORES: WILL 1 BALL TRIGGER THEM ALL?"
 *
 * Symmetric regular hexagonal reactor chamber centred at (540, 1018):
 * - 120 faceted hexagonal crystal cores arranged in 6 exact 6-fold-symmetric
 *   rings (6 + 12 + 18 + 24 + 30 + 30 = 120) around a central chrome rebound hub.
 * - Outer Ring 6 starts lightly armored (3 HP) so Ball #1 shatters a core inside
 *   the first 2 seconds; armor climbs ring by ring toward the blazing inner
 *   Ring 1 guards protecting the reactor heart.
 * - Top mechanical spring plunger visibly compresses and snaps at t = 0.33 s to
 *   launch 1 chrome striker ball into the crystal field.
 * - Shattering any core bursts polygonal crystal shards and physically releases
 *   1 new glowing striker ball from its exact center (up to 121 active balls).
 *
 * Exact IEEE arithmetic (+ - * / sqrt) throughout physics so Node audio and
 * browser Canvas video stay bit-identical.
 */

const FPS = SETPIECE_LAYOUT.fps;
const SUBSTEPS = 4;
const DT = 1 / (FPS * SUBSTEPS);
const HOLD_FRAMES = 210; // 3.5 s payoff celebration hold

const CX = SETPIECE_LAYOUT.centerX;
const CY = 1018;
const CHAMBER_R = 492; // circumradius of pointy-top regular hexagon
const HEX_UNIT = 33.2; // center-to-center spacing = HEX_UNIT * sqrt(3) = 57.5 px -> Ring 6 fits cleanly inside apothem 426 px
const CORE_R = 23.0;
const HUB_R = 24;
const BALL_R = 9.5;
const LAUNCH_FRAME = 16; // 0.27 s plunger snap
const BALL_SPEED = 700;
const SQRT3 = Math.sqrt(3);
const HALF = 0.5;
const COS30 = SQRT3 * 0.5;

export const HEX_CHAIN_SEED = 20261129;

/** Ring 1 (innermost) .. Ring 6 (outermost) max HP: escalating crystalline siege! */
const RING_MAX_HP = [0, 58, 42, 32, 18, 9, 2] as const;

const RING_COLORS = [
  "",
  "#c8ff00", // R1 Oyren-lime reactor guards
  "#fbbf24", // R2 amber inner ring
  "#f472b6", // R3 rose mid-inner ring
  "#a78bfa", // R4 violet mid ring
  "#38bdf8", // R5 sky outer-mid ring
  "#22d3ee", // R6 cyan outer shell
] as const;

export interface HexCoreDef {
  readonly id: number;
  readonly q: number;
  readonly r: number;
  readonly ring: number; // 1..6
  readonly maxHp: number;
  readonly x: number;
  readonly y: number;
}

function build120Cores(): readonly HexCoreDef[] {
  const out: HexCoreDef[] = [];
  let id = 0;
  for (let ring = 1; ring <= 6; ring++) {
    for (let q = -ring; q <= ring; q++) {
      for (let r = -ring; r <= ring; r++) {
        const s = -q - r;
        const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
        if (dist !== ring) continue;
        // Omit the 6 outer axis tips of Ring 6 -> exact 6-fold-symmetric 120 cores!
        if (ring === 6 && (q === 0 || r === 0 || s === 0)) continue;
        const x = CX + HEX_UNIT * (SQRT3 * q + (SQRT3 * 0.5) * r);
        const y = CY + HEX_UNIT * (1.5 * r);
        out.push({ id: id++, q, r, ring, maxHp: RING_MAX_HP[ring], x, y });
      }
    }
  }
  return out;
}

export const HEX_CORES: readonly HexCoreDef[] = build120Cores();
export const TOTAL_CORES = HEX_CORES.length; // 120
const MAX_BALLS = TOTAL_CORES + 1; // 121

const HEX_APOTHEM = CHAMBER_R * COS30;
const WALL_NORMALS: readonly (readonly [number, number])[] = [
  [HALF, -COS30],
  [1, 0],
  [HALF, COS30],
  [-HALF, COS30],
  [-1, 0],
  [-HALF, -COS30],
];

const HEX_VERTS: readonly (readonly [number, number])[] = [
  [CX, CY - CHAMBER_R],
  [CX + CHAMBER_R * COS30, CY - CHAMBER_R * HALF],
  [CX + CHAMBER_R * COS30, CY + CHAMBER_R * HALF],
  [CX, CY + CHAMBER_R],
  [CX - CHAMBER_R * COS30, CY + CHAMBER_R * HALF],
  [CX - CHAMBER_R * COS30, CY - CHAMBER_R * HALF],
];

export interface HexShard {
  readonly startFrame: number;
  readonly x0: number;
  readonly y0: number;
  readonly vx: number;
  readonly vy: number;
  readonly size: number;
  readonly rot0: number;
  readonly vrot: number;
  readonly color: string;
}

export interface HexHitEvent {
  readonly t: number;
  readonly x: number;
  readonly coreId: number;
  readonly hpLeft: number;
  readonly clearedNow: number;
}

export interface HexShatterEvent {
  readonly t: number;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly coreId: number;
  readonly ring: number;
  readonly clearedCount: number;
}

export interface HexChainTrace {
  readonly seed: number;
  readonly totalFrames: number;
  readonly payoffFrame: number;
  readonly holdFrames: number;
  readonly ballCounts: Uint16Array;
  readonly clearedCounts: Uint16Array;
  readonly ballX: Float32Array;
  readonly ballY: Float32Array;
  readonly coreHp: Uint16Array; // [frame * TOTAL_CORES + coreId]
  readonly shatterFrames: Int32Array;
  readonly shards: readonly HexShard[];
  readonly hitEvents: readonly HexHitEvent[];
  readonly shatterEvents: readonly HexShatterEvent[];
}

let cachedHexTrace: HexChainTrace | null = null;

export function simulateHexChain(): HexChainTrace {
  if (cachedHexTrace) return cachedHexTrace;

  const rand = createMulberry32(HEX_CHAIN_SEED);
  const maxSimFrames = 52 * FPS;

  const bx = new Float64Array(MAX_BALLS);
  const by = new Float64Array(MAX_BALLS);
  const bvx = new Float64Array(MAX_BALLS);
  const bvy = new Float64Array(MAX_BALLS);
  let activeBalls = 1;

  // Ball #1 sits directly below the top mechanical spring plunger
  const launchX = CX;
  const launchY = CY - CHAMBER_R + 54;
  bx[0] = launchX;
  by[0] = launchY;
  const initDx = 0.08;
  const initDy = Math.sqrt(1 - initDx * initDx);
  bvx[0] = initDx * BALL_SPEED;
  bvy[0] = initDy * BALL_SPEED;

  const hp = new Uint16Array(TOTAL_CORES);
  for (let c = 0; c < TOTAL_CORES; c++) hp[c] = HEX_CORES[c].maxHp;
  const shatterFrames = new Int32Array(TOTAL_CORES).fill(-1);
  let clearedCount = 0;

  const shards: HexShard[] = [];
  const hitEvents: HexHitEvent[] = [];
  const shatterEvents: HexShatterEvent[] = [];

  const tmpBallCounts: number[] = [];
  const tmpCleared: number[] = [];
  const tmpX: Float32Array[] = [];
  const tmpY: Float32Array[] = [];
  const tmpCoreHp: Uint16Array[] = [];

  let payoffFrame = -1;
  let totalFrames = maxSimFrames;

  const maxWallDist = HEX_APOTHEM - BALL_R - 4;
  const hitCoreDist = CORE_R + BALL_R;
  const hitCoreDist2 = hitCoreDist * hitCoreDist;
  const hitHubDist = HUB_R + BALL_R;
  const hitHubDist2 = hitHubDist * hitHubDist;

  for (let frame = 0; frame < maxSimFrames; frame++) {
    const fx = new Float32Array(activeBalls);
    const fy = new Float32Array(activeBalls);
    for (let i = 0; i < activeBalls; i++) {
      fx[i] = bx[i];
      fy[i] = by[i];
    }
    tmpBallCounts.push(activeBalls);
    tmpCleared.push(clearedCount);
    tmpX.push(fx);
    tmpY.push(fy);
    tmpCoreHp.push(Uint16Array.from(hp));

    if (payoffFrame >= 0 && frame >= payoffFrame + HOLD_FRAMES - 1) {
      totalFrames = frame + 1;
      break;
    }

    if (frame < LAUNCH_FRAME) {
      bx[0] = launchX;
      by[0] = launchY;
      continue;
    }

    const speedNow = BALL_SPEED * (1 + 0.28 * (clearedCount / TOTAL_CORES));

    for (let sub = 0; sub < SUBSTEPS; sub++) {
      const tSec = (frame + sub / SUBSTEPS) / FPS;
      const curBalls = activeBalls;

      for (let i = 0; i < curBalls; i++) {
        bx[i] += bvx[i] * DT;
        by[i] += bvy[i] * DT;

        // 1. Hexagonal chamber wall reflections
        const rx = bx[i] - CX;
        const ry = by[i] - CY;
        let hitWall = false;
        for (let w = 0; w < 6; w++) {
          const nx = WALL_NORMALS[w][0];
          const ny = WALL_NORMALS[w][1];
          const proj = rx * nx + ry * ny;
          if (proj > maxWallDist) {
            const pen = proj - maxWallDist;
            bx[i] -= nx * pen;
            by[i] -= ny * pen;
            const vn = bvx[i] * nx + bvy[i] * ny;
            if (vn > 0) {
              bvx[i] -= 2 * vn * nx;
              bvy[i] -= 2 * vn * ny;
              hitWall = true;
            }
          }
        }

        // Subtle wall-rebound centering bias so balls naturally flow inward toward remaining cores
        const remaining = TOTAL_CORES - clearedCount;
        if (hitWall && remaining > 0) {
          let targetX = CX;
          let targetY = CY;
          if (remaining <= 24) {
            let bestIdx = -1;
            let bestD2 = Number.POSITIVE_INFINITY;
            for (let c = 0; c < TOTAL_CORES; c++) {
              if (hp[c] === 0) continue;
              const dx = HEX_CORES[c].x - bx[i];
              const dy = HEX_CORES[c].y - by[i];
              const d2 = dx * dx + dy * dy;
              if (d2 < bestD2) {
                bestD2 = d2;
                bestIdx = c;
              }
            }
            if (bestIdx >= 0) {
              targetX = HEX_CORES[bestIdx].x;
              targetY = HEX_CORES[bestIdx].y;
            }
          }
          const tdx = targetX - bx[i];
          const tdy = targetY - by[i];
          const td = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
          const blend = remaining <= 6 ? 0.45 : remaining <= 24 ? 0.28 : 0.14;
          const curLen = Math.sqrt(bvx[i] * bvx[i] + bvy[i] * bvy[i]) || speedNow;
          const mx = (bvx[i] / curLen) * (1 - blend) + (tdx / td) * blend;
          const my = (bvy[i] / curLen) * (1 - blend) + (tdy / td) * blend;
          const mLen = Math.sqrt(mx * mx + my * my) || 1;
          bvx[i] = (mx / mLen) * speedNow;
          bvy[i] = (my / mLen) * speedNow;
        }

        // 2. Center chrome rebound hub collision
        const hdx = bx[i] - CX;
        const hdy = by[i] - CY;
        const hd2 = hdx * hdx + hdy * hdy;
        if (hd2 < hitHubDist2 && hd2 > 0.001) {
          const hd = Math.sqrt(hd2);
          const nx = hdx / hd;
          const ny = hdy / hd;
          bx[i] = CX + nx * hitHubDist;
          by[i] = CY + ny * hitHubDist;
          const vn = bvx[i] * nx + bvy[i] * ny;
          if (vn < 0) {
            bvx[i] -= 2 * vn * nx;
            bvy[i] -= 2 * vn * ny;
          }
        }

        // 3. Crystal core collisions
        if (clearedCount < TOTAL_CORES) {
          for (let c = 0; c < TOTAL_CORES; c++) {
            if (hp[c] === 0) continue;
            const core = HEX_CORES[c];
            const dx = bx[i] - core.x;
            const dy = by[i] - core.y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= hitCoreDist2) continue;

            const d = Math.sqrt(d2) || 0.001;
            const nx = dx / d;
            const ny = dy / d;
            bx[i] = core.x + nx * hitCoreDist;
            by[i] = core.y + ny * hitCoreDist;
            const vn = bvx[i] * nx + bvy[i] * ny;
            if (vn < 0) {
              bvx[i] -= 2 * vn * nx;
              bvy[i] -= 2 * vn * ny;
            }
            const twist = (rand() - 0.5) * 0.14;
            const nvx = bvx[i] - bvy[i] * twist;
            const nvy = bvy[i] + bvx[i] * twist;
            const nLen = Math.sqrt(nvx * nvx + nvy * nvy) || 1;
            bvx[i] = (nvx / nLen) * speedNow;
            bvy[i] = (nvy / nLen) * speedNow;

            hp[c] -= 1;
            hitEvents.push({
              t: tSec,
              x: core.x,
              coreId: c,
              hpLeft: hp[c],
              clearedNow: clearedCount,
            });

            if (hp[c] === 0) {
              clearedCount++;
              shatterFrames[c] = frame;
              shatterEvents.push({
                t: tSec,
                frame,
                x: core.x,
                y: core.y,
                coreId: c,
                ring: core.ring,
                clearedCount,
              });

              if (activeBalls < MAX_BALLS) {
                const idx = activeBalls++;
                bx[idx] = core.x;
                by[idx] = core.y;
                const sx = -nx + (rand() - 0.5) * 0.5;
                const sy = -ny + (rand() - 0.5) * 0.5;
                const sLen = Math.sqrt(sx * sx + sy * sy) || 1;
                bvx[idx] = (sx / sLen) * speedNow;
                bvy[idx] = (sy / sLen) * speedNow;
              }

              for (let s = 0; s < 6; s++) {
                const a = (s / 6) * 6.283185 + rand() * 0.4;
                const sp = 140 + rand() * 220;
                shards.push({
                  startFrame: frame,
                  x0: core.x,
                  y0: core.y,
                  vx: Math.cos(a) * sp,
                  vy: Math.sin(a) * sp,
                  size: 7 + rand() * 7,
                  rot0: a,
                  vrot: (rand() - 0.5) * 14,
                  color: s % 2 === 0 ? SP_COLORS.lime : RING_COLORS[core.ring],
                });
              }

              if (clearedCount === TOTAL_CORES && payoffFrame < 0) {
                payoffFrame = frame;
              }
            }
            break;
          }
        }

        const vLen = Math.sqrt(bvx[i] * bvx[i] + bvy[i] * bvy[i]) || 1;
        bvx[i] = (bvx[i] / vLen) * speedNow;
        bvy[i] = (bvy[i] / vLen) * speedNow;
      }
    }
  }

  const ballCounts = new Uint16Array(totalFrames);
  const clearedCounts = new Uint16Array(totalFrames);
  const ballX = new Float32Array(totalFrames * MAX_BALLS);
  const ballY = new Float32Array(totalFrames * MAX_BALLS);
  const coreHp = new Uint16Array(totalFrames * TOTAL_CORES);

  for (let f = 0; f < totalFrames; f++) {
    ballCounts[f] = tmpBallCounts[f];
    clearedCounts[f] = tmpCleared[f];
    ballX.set(tmpX[f], f * MAX_BALLS);
    ballY.set(tmpY[f], f * MAX_BALLS);
    coreHp.set(tmpCoreHp[f], f * TOTAL_CORES);
  }

  cachedHexTrace = {
    seed: HEX_CHAIN_SEED,
    totalFrames,
    payoffFrame: payoffFrame >= 0 ? payoffFrame : totalFrames - HOLD_FRAMES,
    holdFrames: HOLD_FRAMES,
    ballCounts,
    clearedCounts,
    ballX,
    ballY,
    coreHp,
    shatterFrames,
    shards,
    hitEvents,
    shatterEvents,
  };
  return cachedHexTrace;
}

const MONO = 'ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace';

function traceHex(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 - Math.PI / 6;
    const vx = x + Math.cos(a) * r;
    const vy = y + Math.sin(a) * r;
    if (k === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
}

export function paintHexChainFrame(
  ctx: CanvasRenderingContext2D,
  trace: HexChainTrace,
  rawFrame: number,
): void {
  const frame = clamp(Math.floor(rawFrame), 0, trace.totalFrames - 1);
  const cleared = trace.clearedCounts[frame];
  const balls = trace.ballCounts[frame];
  const allCleared = cleared === TOTAL_CORES;
  const hpOff = frame * TOTAL_CORES;

  paintSetPieceBackdrop(ctx, frame, allCleared ? "200, 255, 0" : "167, 139, 250");

  paintSetPieceChrome(ctx, {
    questionPrefix: "120 CORES:",
    questionHighlight: "WILL 1 BALL TRIGGER THEM ALL?",
    ruleLine1: "1 ball launches. Breaking any core frees 1 new ball.",
    ruleLine2: "Inner rings carry stronger armor toward the heart.",
    counterText: allCleared ? "120 / 120" : `${cleared} / ${TOTAL_CORES}`,
    counterColor: allCleared ? SP_COLORS.lime : cleared >= 100 ? SP_COLORS.amber : SP_COLORS.ink,
    subCounterText: allCleared
      ? `ALL CORES CLEARED · ${balls} BALLS ACTIVE`
      : `CORES CLEARED · ${balls} ${balls === 1 ? "BALL" : "BALLS"} ACTIVE`,
    progress: cleared / TOTAL_CORES,
    seed: trace.seed,
  });

  // 1. Hexagonal reactor chamber boundary
  ctx.save();
  ctx.beginPath();
  HEX_VERTS.forEach(([vx, vy], idx) => {
    if (idx === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(6, 12, 20, 0.92)";
  ctx.fill();
  ctx.strokeStyle = allCleared ? SP_COLORS.lime : "rgba(167, 139, 250, 0.45)";
  ctx.lineWidth = allCleared ? 4.5 : 3;
  ctx.stroke();

  // Subtle concentric guide rings
  ctx.strokeStyle = "rgba(158, 178, 196, 0.08)";
  ctx.lineWidth = 1.5;
  for (const frac of [0.38, 0.68, 0.92]) {
    ctx.beginPath();
    HEX_VERTS.forEach(([vx, vy], idx) => {
      const px = CX + (vx - CX) * frac;
      const py = CY + (vy - CY) * frac;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();
  }

  // 2. Top Mechanical Spring Plunger
  const plungerY0 = CY - CHAMBER_R + 6;
  const compress = frame < LAUNCH_FRAME
    ? clamp01(frame / (LAUNCH_FRAME - 2))
    : Math.max(0, 1 - (frame - LAUNCH_FRAME) / 8);
  const pistonTipY = frame < LAUNCH_FRAME
    ? plungerY0 + 30 - compress * 14
    : plungerY0 + 38 * Math.exp(-(frame - LAUNCH_FRAME) * 0.22) + 14;

  ctx.strokeStyle = frame < LAUNCH_FRAME + 6 ? SP_COLORS.lime : "rgba(158, 178, 196, 0.45)";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  const coils = 5;
  for (let k = 0; k <= coils; k++) {
    const sy = plungerY0 + ((pistonTipY - 10 - plungerY0) * k) / coils;
    const sx = CX + (k % 2 === 0 ? -12 : 12);
    if (k === 0) ctx.moveTo(CX, plungerY0);
    else ctx.lineTo(sx, sy);
  }
  ctx.lineTo(CX, pistonTipY - 10);
  ctx.stroke();

  ctx.fillStyle = frame >= LAUNCH_FRAME && frame < LAUNCH_FRAME + 12 ? SP_COLORS.lime : "#cbd5e1";
  ctx.strokeStyle = "#03070b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(CX - 22, pistonTipY - 10, 44, 14, 5);
  ctx.fill();
  ctx.stroke();

  // 3. Central chrome reactor heart
  const heartPulse = allCleared ? 0.55 + 0.35 * Math.sin((frame - trace.payoffFrame) * 0.24) : 0.24;
  ctx.fillStyle = `rgba(200, 255, 0, ${heartPulse.toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(CX, CY, HUB_R + (allCleared ? 16 : 6), 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#162433";
  ctx.strokeStyle = allCleared ? SP_COLORS.lime : SP_COLORS.cyan;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(CX, CY, HUB_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = SP_COLORS.lime;
  ctx.beginPath();
  ctx.arc(CX, CY, 8, 0, Math.PI * 2);
  ctx.fill();

  // 4. 120 Crystal Cores with live integer HP & ring colours
  const ringRemaining = [0, 0, 0, 0, 0, 0];
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let c = 0; c < TOTAL_CORES; c++) {
    const core = HEX_CORES[c];
    const hp = trace.coreHp[hpOff + c];
    if (hp === 0) continue;
    ringRemaining[core.ring - 1]++;

    const col = RING_COLORS[core.ring];
    const dmg = 1 - hp / core.maxHp;

    traceHex(ctx, core.x, core.y, CORE_R);
    ctx.fillStyle = "#0b1420";
    ctx.fill();

    ctx.save();
    ctx.globalAlpha = 0.2 + 0.38 * dmg;
    ctx.fillStyle = col;
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = col;
    ctx.lineWidth = dmg > 0.65 ? 2.8 : 1.9;
    ctx.stroke();

    // Fracture cracks once damaged past 30%
    if (dmg > 0.3) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(core.x - 10, core.y - 9);
      ctx.lineTo(core.x - 2, core.y - 2);
      if (dmg > 0.65) {
        ctx.lineTo(core.x + 11, core.y - 7);
        ctx.moveTo(core.x - 2, core.y - 2);
        ctx.lineTo(core.x + 4, core.y + 11);
      }
      ctx.stroke();
    }

    // Crisp integer HP readout inside the hexagon
    ctx.font = hp >= 100 ? `800 13px ${MONO}` : `800 15px ${MONO}`;
    ctx.fillStyle = dmg > 0.65 ? "#ffffff" : col;
    ctx.fillText(String(hp), core.x, core.y + 1);
  }

  // 5. Shatter shockwave rings
  for (let c = 0; c < TOTAL_CORES; c++) {
    const sf = trace.shatterFrames[c];
    if (sf < 0 || frame < sf || frame > sf + 18) continue;
    const age = (frame - sf) / 18;
    const core = HEX_CORES[c];
    ctx.save();
    ctx.globalAlpha = (1 - age) * 0.85;
    ctx.strokeStyle = core.ring <= 2 ? SP_COLORS.lime : RING_COLORS[core.ring];
    ctx.lineWidth = 3 * (1 - age);
    ctx.beginPath();
    ctx.arc(core.x, core.y, CORE_R + age * 36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 6. Flying crystal shards
  for (let s = 0; s < trace.shards.length; s++) {
    const sh = trace.shards[s];
    if (frame < sh.startFrame || frame > sh.startFrame + 28) continue;
    const t = (frame - sh.startFrame) / FPS;
    const a = 1 - (frame - sh.startFrame) / 28;
    const sx = sh.x0 + sh.vx * t;
    const sy = sh.y0 + sh.vy * t;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(sh.rot0 + sh.vrot * t);
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = sh.color;
    ctx.beginPath();
    ctx.moveTo(0, -sh.size * 0.6);
    ctx.lineTo(sh.size * 0.55, sh.size * 0.35);
    ctx.lineTo(-sh.size * 0.5, sh.size * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 7. Striker balls
  const base = frame * MAX_BALLS;
  for (let i = 0; i < balls; i++) {
    const x = trace.ballX[base + i];
    const y = trace.ballY[base + i];
    ctx.fillStyle = allCleared ? SP_COLORS.lime : i === 0 ? "#ffffff" : i % 2 === 0 ? SP_COLORS.lime : "#e0f2fe";
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#03070b";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.arc(x - 2.5, y - 2.5, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 8. Payoff celebration banner
  if (allCleared) {
    paintPayoffBanner(
      ctx,
      CY,
      "ALL 120 CLEARED",
      `1 BALL BECAME ${balls} STRIKERS`,
      (frame - trace.payoffFrame) / 18,
    );
  }
  ctx.restore();

  // 9. Bottom 6-ring status pills (R6 outer -> R1 inner)
  const pillW = 128;
  const pillH = 28;
  const pillGap = 12;
  const totalW = 6 * pillW + 5 * pillGap;
  const startX = CX - totalW / 2;
  const pillY = SETPIECE_LAYOUT.footerBarY - pillH / 2;
  const ringOrder = [6, 5, 4, 3, 2, 1] as const;
  const ringTotals: Record<number, number> = { 1: 6, 2: 12, 3: 18, 4: 24, 5: 30, 6: 30 };

  ctx.save();
  ctx.font = `700 15px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ringOrder.forEach((ringNum, idx) => {
    const px = startX + idx * (pillW + pillGap);
    const total = ringTotals[ringNum];
    const done = ringRemaining[ringNum - 1] === 0;
    const clearedInRing = total - ringRemaining[ringNum - 1];
    ctx.fillStyle = done ? "rgba(200, 255, 0, 0.18)" : "rgba(15, 25, 36, 0.85)";
    ctx.strokeStyle = done ? SP_COLORS.lime : RING_COLORS[ringNum];
    ctx.lineWidth = done ? 2 : 1.4;
    ctx.beginPath();
    ctx.roundRect(px, pillY, pillW, pillH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = done ? SP_COLORS.lime : SP_COLORS.muted;
    ctx.fillText(`R${ringNum} ${clearedInRing}/${total}`, px + pillW / 2, pillY + pillH / 2 + 1);
  });
  ctx.restore();
}

export function synthesizeHexChainAudio(trace: HexChainTrace): SetPieceAudioResult {
  const buf = newHitBuffer(trace.totalFrames);
  const totalSec = trace.totalFrames / FPS;
  const payoffSec = trace.payoffFrame / FPS;

  addSoftPad(buf, {
    startSec: 0,
    durSec: payoffSec + 0.5,
    freqs: [noteHz(48), noteHz(55), noteHz(60)],
    gain: 0.045,
    attackSec: 0.4,
    releaseSec: 0.8,
  });

  addThud(buf, { t: LAUNCH_FRAME / FPS, gain: 0.36, hz: 135, durSec: 0.16 });
  addWhoosh(buf, { t: LAUNCH_FRAME / FPS, durSec: 0.18, gain: 0.16, fromHz: 320, toHz: 1150, seed: 31 });

  const keptHits = thinEvents(trace.hitEvents, 18);
  for (let i = 0; i < keptHits.length; i++) {
    const ev = keptHits[i];
    const pan = clamp(((ev.x - CX) / (CHAMBER_R * COS30)) * 0.8, -0.78, 0.78);
    const step = Math.floor((ev.clearedNow / TOTAL_CORES) * 10) + (i % 5);
    const midi = scaleMidi(60, PENTATONIC_MAJOR, step);
    addBell(buf, {
      t: ev.t,
      freq: noteHz(midi),
      gain: 0.11,
      pan,
      decay: 13,
      durSec: 0.16,
    });
    if (i % 2 === 0) {
      addTick(buf, { t: ev.t, gain: 0.08, pan, hz: 1120 + (ev.clearedNow % 12) * 35, durSec: 0.025 });
    }
  }

  const keptShatters = thinEvents(trace.shatterEvents, 12);
  for (let i = 0; i < keptShatters.length; i++) {
    const sh = keptShatters[i];
    const pan = clamp(((sh.x - CX) / (CHAMBER_R * COS30)) * 0.78, -0.75, 0.75);
    const midi = scaleMidi(67, PENTATONIC_MAJOR, Math.floor((sh.clearedCount / TOTAL_CORES) * 12));
    addThud(buf, { t: sh.t, gain: sh.ring <= 2 ? 0.32 : 0.22, pan, hz: sh.ring <= 2 ? 96 : 118, durSec: 0.14 });
    addBell(buf, { t: sh.t, freq: noteHz(midi), gain: 0.18, pan, decay: 6, durSec: 0.36 });
  }

  if (payoffSec > 2) {
    addRiser(buf, { t: Math.max(0, payoffSec - 1.6), durSec: 1.6, gain: 0.13, fromHz: 220, toHz: 940 });
  }
  addBoom(buf, { t: payoffSec, gain: 0.56, seed: 505 });
  const winChord = [60, 64, 67, 72, 76];
  winChord.forEach((m, idx) => {
    addBell(buf, {
      t: payoffSec + idx * 0.055,
      freq: noteHz(m),
      gain: 0.24,
      pan: (idx - 2) * 0.25,
      decay: 1.8,
      durSec: Math.min(2.6, Math.max(0.6, totalSec - payoffSec)),
    });
  });
  addSoftPad(buf, {
    startSec: payoffSec,
    durSec: Math.max(0.8, totalSec - payoffSec),
    freqs: [noteHz(48), noteHz(60), noteHz(64), noteHz(67)],
    gain: 0.09,
    attackSec: 0.18,
    releaseSec: 0.5,
  });

  const finished = finishHitAudio(buf);
  let peak = 0;
  let sq = 0;
  const n = finished.buffer.left.length;
  for (let i = 0; i < n; i++) {
    const l = finished.buffer.left[i];
    const r = finished.buffer.right[i];
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    sq += (l * l + r * r) * 0.5;
  }
  return {
    wav: finished.wav,
    peakDb: 20 * Math.log10(Math.max(1e-9, peak)),
    rmsDb: 20 * Math.log10(Math.max(1e-9, Math.sqrt(sq / n))),
  };
}

export function getHexChainSpec(): SetPieceSpec {
  const trace = simulateHexChain();
  return {
    id: "SetPieceHexChain",
    slug: "setpiece-hex-chain",
    title: "120 Crystal Cores",
    questionPrefix: "120 CORES:",
    questionHighlight: "WILL 1 BALL TRIGGER THEM ALL?",
    ruleLine1: "1 ball launches. Breaking any core frees 1 new ball.",
    ruleLine2: "Inner rings carry stronger armor toward the heart.",
    seed: trace.seed,
    totalFrames: trace.totalFrames,
    holdFrames: trace.holdFrames,
    payoffFrame: trace.payoffFrame,
  };
}

export const HEX_CHAIN_SETPIECE: SetPieceModule<HexChainTrace> = {
  get spec() {
    return getHexChainSpec();
  },
  simulate: simulateHexChain,
  paint: paintHexChainFrame,
  synthesizeAudio: synthesizeHexChainAudio,
};
