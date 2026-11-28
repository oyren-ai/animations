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
 * SetPieceGlassFloors — "10 GLASS FLOORS: WILL IT REACH THE CORE?"
 *
 * Vertical tempered-glass breaker shaft centred on x = 540:
 * - Top magnetic jaws open at t = 0.22 s and drop 1 chrome striker ball.
 * - 10 descending tempered-glass decks with escalating HP (3 .. 4,500) crack
 *   visibly at exact ball impact points.
 * - Shattering a deck bursts glass shards and illuminates the x2 prism laser
 *   bar mounted directly underneath; every falling ball crossing that bar
 *   visibly flashes and splits into 2 (1 -> 2 -> 4 -> ... -> 512 balls).
 * - Shattering Floor 10 floods all 512 balls into the glowing Oyren-lime Core
 *   Vault at the bottom.
 *
 * Pure deterministic IEEE arithmetic (+ - * / sqrt) so Node audio and browser
 * Canvas video remain bit-identical.
 */

const FPS = SETPIECE_LAYOUT.fps;
const SUBSTEPS = 4;
const DT = 1 / (FPS * SUBSTEPS);
const MAX_BALLS = 512;
const HOLD_FRAMES = 210; // 3.5 s payoff celebration hold

const SHAFT = {
  left: 124,
  right: 956,
  top: 492,
  bottom: 1544,
  innerLeft: 136,
  innerRight: 944,
  coreTop: 1446,
} as const;

const FLOOR_COUNT = 10;
const FLOOR_START_Y = 598;
const FLOOR_STEP_Y = 86; // F0=598 .. F9=1372, leaving clean space for Gate 9 & Core Vault
const FLOOR_THICKNESS = 15;
const GATE_OFFSET_Y = 26;
const GRAVITY = 2150;
const BOUNCE_VY = -555;
const DROP_OPEN_FRAME = 14; // 0.23 s

export const GLASS_FLOORS_SEED = 20261128;

const FLOOR_MAX_HP = [3, 12, 26, 56, 118, 240, 490, 990, 2000, 4400] as const;

const FLOOR_COLORS = [
  "#38bdf8", // F1 sky
  "#22d3ee", // F2 cyan
  "#2dd4bf", // F3 teal
  "#60a5fa", // F4 azure
  "#818cf8", // F5 indigo
  "#a78bfa", // F6 violet
  "#c084fc", // F7 orchid
  "#f472b6", // F8 rose
  "#fbbf24", // F9 amber
  "#c8ff00", // F10 Oyren lime armored deck
] as const;

const BALL_RADIUS_BY_GEN = [16, 15, 14, 13, 12, 11, 10, 9.2, 8.4, 7.6] as const;

export interface FloorCrack {
  readonly floor: number;
  readonly frame: number;
  readonly x: number;
  readonly dx1: number;
  readonly dy1: number;
  readonly dx2: number;
  readonly dy2: number;
}

export interface FloorShard {
  readonly floor: number;
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

export interface SplitFlash {
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly gate: number;
}

export interface GlassHitEvent {
  readonly t: number;
  readonly x: number;
  readonly floor: number;
  readonly hpLeft: number;
}

export interface GlassShatterEvent {
  readonly t: number;
  readonly frame: number;
  readonly floor: number;
  readonly ballsNow: number;
}

export interface GlassSplitEvent {
  readonly t: number;
  readonly x: number;
  readonly gate: number;
  readonly totalBalls: number;
}

export interface GlassFloorsTrace {
  readonly seed: number;
  readonly totalFrames: number;
  readonly payoffFrame: number;
  readonly holdFrames: number;
  /** Per-frame active ball count. */
  readonly ballCounts: Uint16Array;
  /** Packed [frame * MAX_BALLS + i] ball x, y, r (radius 0 = inactive). */
  readonly ballX: Float32Array;
  readonly ballY: Float32Array;
  readonly ballR: Float32Array;
  /** Per-frame HP per floor: [frame * FLOOR_COUNT + f]. */
  readonly floorHp: Uint16Array;
  /** Frame each floor shattered (-1 if never). */
  readonly shatterFrames: Int32Array;
  /** Last frame each gate was crossed (for glow decay). */
  readonly gateActiveUntil: Int32Array;
  readonly cracks: readonly FloorCrack[];
  readonly shards: readonly FloorShard[];
  readonly flashes: readonly SplitFlash[];
  readonly hitEvents: readonly GlassHitEvent[];
  readonly shatterEvents: readonly GlassShatterEvent[];
  readonly splitEvents: readonly GlassSplitEvent[];
}

function floorY(i: number): number {
  return FLOOR_START_Y + i * FLOOR_STEP_Y;
}

let cachedTrace: GlassFloorsTrace | null = null;

export function simulateGlassFloors(): GlassFloorsTrace {
  if (cachedTrace) return cachedTrace;

  const rand = createMulberry32(GLASS_FLOORS_SEED);
  const maxSimFrames = 52 * FPS;

  // Live ball state (fixed arrays, exact IEEE ops)
  const bx = new Float64Array(MAX_BALLS);
  const by = new Float64Array(MAX_BALLS);
  const bvx = new Float64Array(MAX_BALLS);
  const bvy = new Float64Array(MAX_BALLS);
  const br = new Float64Array(MAX_BALLS);
  const bGate = new Int8Array(MAX_BALLS);
  const bGen = new Uint8Array(MAX_BALLS);
  let activeBalls = 1;

  // Ball #1 rests inside the top magnetic cradle
  bx[0] = SETPIECE_LAYOUT.centerX;
  by[0] = SHAFT.top + 18;
  bvx[0] = 68;
  bvy[0] = 0;
  br[0] = BALL_RADIUS_BY_GEN[0];
  bGate[0] = -1;
  bGen[0] = 0;

  const hp = new Int32Array(FLOOR_MAX_HP);
  const shatterFrames = new Int32Array(FLOOR_COUNT).fill(-1);
  const gateActiveUntil = new Int32Array(FLOOR_COUNT - 1).fill(-1);

  const cracks: FloorCrack[] = [];
  const shards: FloorShard[] = [];
  const flashes: SplitFlash[] = [];
  const hitEvents: GlassHitEvent[] = [];
  const shatterEvents: GlassShatterEvent[] = [];
  const splitEvents: GlassSplitEvent[] = [];

  // Temporary dynamic frame storage before trimming to exact totalFrames
  const tmpCounts: number[] = [];
  const tmpX: Float32Array[] = [];
  const tmpY: Float32Array[] = [];
  const tmpR: Float32Array[] = [];
  const tmpHp: Uint16Array[] = [];

  let payoffFrame = -1;
  let totalFrames = maxSimFrames;

  for (let frame = 0; frame < maxSimFrames; frame++) {
    // Snapshot start-of-frame state
    const fx = new Float32Array(activeBalls);
    const fy = new Float32Array(activeBalls);
    const fr = new Float32Array(activeBalls);
    for (let i = 0; i < activeBalls; i++) {
      fx[i] = bx[i];
      fy[i] = by[i];
      fr[i] = br[i];
    }
    tmpCounts.push(activeBalls);
    tmpX.push(fx);
    tmpY.push(fy);
    tmpR.push(fr);
    const fhp = new Uint16Array(FLOOR_COUNT);
    for (let f = 0; f < FLOOR_COUNT; f++) fhp[f] = hp[f] > 0 ? hp[f] : 0;
    tmpHp.push(fhp);

    if (payoffFrame >= 0 && frame >= payoffFrame + HOLD_FRAMES - 1) {
      totalFrames = frame + 1;
      break;
    }

    // Hold ball 0 inside top magnetic jaws until DROP_OPEN_FRAME
    if (frame < DROP_OPEN_FRAME) {
      bx[0] = SETPIECE_LAYOUT.centerX;
      by[0] = SHAFT.top + 18;
      continue;
    }

    // Integrate SUBSTEPS
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      const tSec = (frame + sub / SUBSTEPS) / FPS;

      // Determine current lowest intact floor index (highest in screen Y = smallest index still > 0)
      let topIntact = -1;
      for (let f = 0; f < FLOOR_COUNT; f++) {
        if (hp[f] > 0) {
          topIntact = f;
          break;
        }
      }

      // Update each ball
      const currentCount = activeBalls;
      for (let i = 0; i < currentCount; i++) {
        bvy[i] += GRAVITY * DT;
        bx[i] += bvx[i] * DT;
        by[i] += bvy[i] * DT;

        const r = br[i];
        // Side shaft walls
        if (bx[i] - r < SHAFT.innerLeft) {
          bx[i] = SHAFT.innerLeft + r;
          bvx[i] = Math.abs(bvx[i]) * 0.96 + 18;
        } else if (bx[i] + r > SHAFT.innerRight) {
          bx[i] = SHAFT.innerRight - r;
          bvx[i] = -Math.abs(bvx[i]) * 0.96 - 18;
        }

        // Top ceiling clamp
        if (by[i] - r < SHAFT.top + 28) {
          by[i] = SHAFT.top + 28 + r;
          bvy[i] = Math.abs(bvy[i]) * 0.5;
        }

        // Check x2 prism gates beneath shattered floors (gates 0..8)
        for (let g = bGate[i] + 1; g < FLOOR_COUNT - 1; g++) {
          if (hp[g] > 0) break;
          const gy = floorY(g) + GATE_OFFSET_Y;
          if (by[i] >= gy) {
            bGate[i] = g;
            gateActiveUntil[g] = Math.max(gateActiveUntil[g], frame + 36);
            if (activeBalls < MAX_BALLS) {
              const nextGen = Math.min(BALL_RADIUS_BY_GEN.length - 1, bGen[i] + 1);
              const nextR = BALL_RADIUS_BY_GEN[nextGen];
              br[i] = nextR;
              bGen[i] = nextGen;

              const kick = 105 + rand() * 110;
              const childIdx = activeBalls++;
              const dir = rand() < 0.5 ? 1 : -1;
              bx[childIdx] = clamp(bx[i] + dir * nextR * 0.75, SHAFT.innerLeft + nextR, SHAFT.innerRight - nextR);
              by[childIdx] = by[i] - 2;
              bvx[childIdx] = clamp(bvx[i] + dir * kick, -430, 430);
              bvy[childIdx] = bvy[i] * (0.88 + rand() * 0.22);
              br[childIdx] = nextR;
              bGate[childIdx] = g;
              bGen[childIdx] = nextGen;

              bvx[i] = clamp(bvx[i] - dir * kick * 0.85, -430, 430);

              if (flashes.length < 1800) {
                flashes.push({ frame, x: bx[i], y: gy, gate: g });
              }
              splitEvents.push({ t: tSec, x: bx[i], gate: g, totalBalls: activeBalls });
            }
          }
        }

        // Floor impact check against current top intact floor
        if (topIntact >= 0) {
          const deckTop = floorY(topIntact) - FLOOR_THICKNESS * 0.5;
          if (bvy[i] > 0 && by[i] + r >= deckTop) {
            by[i] = deckTop - r;
            // Energetic bounce so balls visibly hammer the glass without stalling
            const jitter = (rand() - 0.5) * 90;
            bvy[i] = BOUNCE_VY * (0.9 + rand() * 0.24);
            bvx[i] = clamp(bvx[i] * 0.92 + jitter, -420, 420);

            if (hp[topIntact] > 0) {
              hp[topIntact] -= 1;
              hitEvents.push({ t: tSec, x: bx[i], floor: topIntact, hpLeft: hp[topIntact] });

              // Record crisp visible glass crack segments (capped per floor so canvas stays super sharp)
              const maxCracksThisFloor = 38;
              let floorCrackCount = 0;
              for (let c = cracks.length - 1; c >= 0 && cracks[c].floor === topIntact; c--) {
                floorCrackCount++;
              }
              const crackStride = Math.max(1, Math.floor(FLOOR_MAX_HP[topIntact] / maxCracksThisFloor));
              if (hp[topIntact] % crackStride === 0 && floorCrackCount < maxCracksThisFloor) {
                cracks.push({
                  floor: topIntact,
                  frame,
                  x: clamp(bx[i], SHAFT.innerLeft + 18, SHAFT.innerRight - 18),
                  dx1: (rand() - 0.5) * 56,
                  dy1: 4 + rand() * 11,
                  dx2: (rand() - 0.5) * 92,
                  dy2: -5 + rand() * 10,
                });
              }

              // Floor SHATTER!
              if (hp[topIntact] === 0) {
                shatterFrames[topIntact] = frame;
                if (topIntact < FLOOR_COUNT - 1) {
                  gateActiveUntil[topIntact] = frame + 78;
                }
                shatterEvents.push({ t: tSec, frame, floor: topIntact, ballsNow: activeBalls });

                // Spawn 26 tumbling glass shards across the shattered deck
                const fyDeck = floorY(topIntact);
                for (let s = 0; s < 26; s++) {
                  const sx = SHAFT.innerLeft + 16 + ((s + rand() * 0.7) / 26) * (SHAFT.innerRight - SHAFT.innerLeft - 32);
                  shards.push({
                    floor: topIntact,
                    startFrame: frame,
                    x0: sx,
                    y0: fyDeck + (rand() - 0.5) * 10,
                    vx: (rand() - 0.5) * 340,
                    vy: -120 - rand() * 240,
                    size: 9 + rand() * 14,
                    rot0: rand() * 6.28,
                    vrot: (rand() - 0.5) * 12,
                    color: FLOOR_COLORS[topIntact],
                  });
                }

                // Floor 10 shattered -> PAYOFF!
                if (topIntact === FLOOR_COUNT - 1 && payoffFrame < 0) {
                  payoffFrame = frame;
                }
                // Re-scan next intact floor immediately for remaining balls in this substep
                topIntact = -1;
                for (let f = 0; f < FLOOR_COUNT; f++) {
                  if (hp[f] > 0) {
                    topIntact = f;
                    break;
                  }
                }
              }
            }
          }
        } else {
          // Bottom Core Vault chamber bounce (celebration cascade!)
          const vaultFloor = SHAFT.bottom - 10;
          if (by[i] + r >= vaultFloor) {
            by[i] = vaultFloor - r;
            bvy[i] = -Math.abs(bvy[i]) * 0.78 - 110 * rand();
            bvx[i] = clamp(bvx[i] + (rand() - 0.5) * 80, -380, 380);
          }
        }
      }

      // Light horizontal spread so dense swarms form an even sparkling curtain across the deck
      if (activeBalls >= 8 && sub === 0) {
        const stride = activeBalls > 128 ? 4 : 2;
        for (let i = 0; i < activeBalls; i += stride) {
          const j = (i + 7) % activeBalls;
          const dx = bx[j] - bx[i];
          const dy = by[j] - by[i];
          const d2 = dx * dx + dy * dy;
          const minD = br[i] + br[j] + 4;
          if (d2 > 0.01 && d2 < minD * minD) {
            const d = Math.sqrt(d2);
            const push = ((minD - d) / d) * 14;
            bvx[i] -= dx * push;
            bvx[j] += dx * push;
          }
        }
      }
    }
  }

  // Pack contiguous frame buffers
  const ballCounts = new Uint16Array(totalFrames);
  const ballX = new Float32Array(totalFrames * MAX_BALLS);
  const ballY = new Float32Array(totalFrames * MAX_BALLS);
  const ballR = new Float32Array(totalFrames * MAX_BALLS);
  const floorHp = new Uint16Array(totalFrames * FLOOR_COUNT);

  for (let f = 0; f < totalFrames; f++) {
    const cnt = tmpCounts[f];
    ballCounts[f] = cnt;
    const base = f * MAX_BALLS;
    ballX.set(tmpX[f], base);
    ballY.set(tmpY[f], base);
    ballR.set(tmpR[f], base);
    floorHp.set(tmpHp[f], f * FLOOR_COUNT);
  }

  cachedTrace = {
    seed: GLASS_FLOORS_SEED,
    totalFrames,
    payoffFrame: payoffFrame >= 0 ? payoffFrame : totalFrames - HOLD_FRAMES,
    holdFrames: HOLD_FRAMES,
    ballCounts,
    ballX,
    ballY,
    ballR,
    floorHp,
    shatterFrames,
    gateActiveUntil,
    cracks,
    shards,
    flashes,
    hitEvents,
    shatterEvents,
    splitEvents,
  };
  return cachedTrace;
}

const MONO = 'ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace';

export function paintGlassFloorsFrame(
  ctx: CanvasRenderingContext2D,
  trace: GlassFloorsTrace,
  rawFrame: number,
): void {
  const frame = clamp(Math.floor(rawFrame), 0, trace.totalFrames - 1);
  const ballCount = trace.ballCounts[frame];
  const hpOff = frame * FLOOR_COUNT;

  let brokenCount = 0;
  let activeFloor = FLOOR_COUNT - 1;
  for (let f = 0; f < FLOOR_COUNT; f++) {
    if (trace.floorHp[hpOff + f] === 0) brokenCount++;
    else {
      activeFloor = f;
      break;
    }
  }
  const coreReached = brokenCount === FLOOR_COUNT;

  // Overall progress: completed floors + fraction of active floor damaged
  let progress = brokenCount / FLOOR_COUNT;
  if (!coreReached) {
    const curHp = trace.floorHp[hpOff + activeFloor];
    const maxHp = FLOOR_MAX_HP[activeFloor];
    progress = (brokenCount + (1 - curHp / maxHp)) / FLOOR_COUNT;
  }

  // Subtle camera punch right after any floor shatter
  let shakeX = 0;
  let shakeY = 0;
  for (let f = 0; f < FLOOR_COUNT; f++) {
    const sf = trace.shatterFrames[f];
    if (sf >= 0 && frame >= sf && frame < sf + 14) {
      const decay = 1 - (frame - sf) / 14;
      const amp = (f === FLOOR_COUNT - 1 ? 10 : 4.5) * decay;
      shakeX += Math.sin(frame * 2.9 + f) * amp;
      shakeY += Math.cos(frame * 3.7 + f) * amp;
    }
  }

  paintSetPieceBackdrop(ctx, frame, coreReached ? "200, 255, 0" : "56, 189, 248");

  paintSetPieceChrome(ctx, {
    questionPrefix: "10 GLASS FLOORS:",
    questionHighlight: "WILL IT REACH THE CORE?",
    ruleLine1: "Balls bounce and crack each floor.",
    ruleLine2: "Breaking a floor splits every ball into 2.",
    counterText: coreReached
      ? "CORE REACHED"
      : `FLOOR ${brokenCount + 1} / ${FLOOR_COUNT}`,
    counterColor: coreReached ? SP_COLORS.lime : brokenCount >= 8 ? SP_COLORS.amber : SP_COLORS.ink,
    subCounterText: coreReached
      ? `${ballCount} BALLS IN CORE · 10 / 10 SHATTERED`
      : `${ballCount} ${ballCount === 1 ? "BALL" : "BALLS"} · DECK HP ${trace.floorHp[hpOff + activeFloor].toLocaleString("en-US")}`,
    progress,
    seed: trace.seed,
  });

  ctx.save();
  ctx.translate(shakeX, shakeY);

  // 1. Glass breaker shaft housing
  ctx.fillStyle = "rgba(6, 13, 21, 0.92)";
  ctx.strokeStyle = coreReached ? SP_COLORS.lime : "rgba(148, 179, 204, 0.34)";
  ctx.lineWidth = coreReached ? 3.5 : 2.5;
  ctx.beginPath();
  ctx.roundRect(SHAFT.left, SHAFT.top, SHAFT.right - SHAFT.left, SHAFT.bottom - SHAFT.top, 22);
  ctx.fill();
  ctx.stroke();

  // Inner subtle vertical rail lines
  ctx.strokeStyle = "rgba(148, 179, 204, 0.14)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(SHAFT.innerLeft, SHAFT.top + 24);
  ctx.lineTo(SHAFT.innerLeft, SHAFT.bottom - 14);
  ctx.moveTo(SHAFT.innerRight, SHAFT.top + 24);
  ctx.lineTo(SHAFT.innerRight, SHAFT.bottom - 14);
  ctx.stroke();

  // 2. Bottom Oyren Reactor Core Vault
  const corePulse = coreReached
    ? 0.55 + 0.35 * Math.sin((frame - trace.payoffFrame) * 0.22)
    : 0.16 + 0.08 * Math.sin(frame * 0.08);
  const coreGrad = ctx.createLinearGradient(0, SHAFT.coreTop, 0, SHAFT.bottom);
  coreGrad.addColorStop(0, `rgba(200, 255, 0, ${(corePulse * 0.35).toFixed(3)})`);
  coreGrad.addColorStop(1, `rgba(200, 255, 0, ${(corePulse * 0.85).toFixed(3)})`);
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.roundRect(
    SHAFT.innerLeft + 2,
    SHAFT.coreTop,
    SHAFT.innerRight - SHAFT.innerLeft - 4,
    SHAFT.bottom - SHAFT.coreTop - 6,
    14,
  );
  ctx.fill();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 26px ${MONO}`;
  ctx.fillStyle = coreReached ? "#04080c" : "rgba(200, 255, 0, 0.72)";
  ctx.fillText(
    coreReached ? "OYREN CORE UNLOCKED" : "REACTOR CORE VAULT",
    SETPIECE_LAYOUT.centerX,
    (SHAFT.coreTop + SHAFT.bottom) * 0.5,
  );

  // 3. Top magnetic release jaws (physically slide open at DROP_OPEN_FRAME)
  const jawOpen = clamp01((frame - DROP_OPEN_FRAME) / 14);
  const jawGap = 24 + jawOpen * 92;
  ctx.fillStyle = "#1a2836";
  ctx.strokeStyle = jawOpen > 0 && jawOpen < 1 ? SP_COLORS.lime : "rgba(158, 178, 196, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(SETPIECE_LAYOUT.centerX - jawGap - 66, SHAFT.top + 8, 66, 20, 6);
  ctx.roundRect(SETPIECE_LAYOUT.centerX + jawGap, SHAFT.top + 8, 66, 20, 6);
  ctx.fill();
  ctx.stroke();

  // 4. x2 Prism Splitter Gates (mounted below Floors 0..8)
  for (let g = 0; g < FLOOR_COUNT - 1; g++) {
    const gy = floorY(g) + GATE_OFFSET_Y;
    const shattered = trace.shatterFrames[g] >= 0 && frame >= trace.shatterFrames[g];
    const active = shattered && frame <= trace.gateActiveUntil[g] + 18;
    const beamAlpha = active
      ? 0.78
      : shattered
        ? 0.22
        : 0.08;

    // Emitter housings on left & right rails
    ctx.fillStyle = active ? SP_COLORS.lime : "#182430";
    ctx.fillRect(SHAFT.left + 3, gy - 6, 12, 12);
    ctx.fillRect(SHAFT.right - 15, gy - 6, 12, 12);

    // Horizontal prism beam
    if (shattered) {
      ctx.save();
      ctx.strokeStyle = active
        ? `rgba(200, 255, 0, ${beamAlpha})`
        : `rgba(56, 189, 248, ${beamAlpha})`;
      ctx.lineWidth = active ? 3.5 : 1.5;
      ctx.setLineDash([12, 10]);
      ctx.beginPath();
      ctx.moveTo(SHAFT.innerLeft + 4, gy);
      ctx.lineTo(SHAFT.innerRight - 4, gy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Tiny crisp "x2" pill on right rail
      ctx.font = `800 16px ${MONO}`;
      ctx.fillStyle = active ? SP_COLORS.lime : "rgba(158, 178, 196, 0.55)";
      ctx.textAlign = "right";
      ctx.fillText("x2", SHAFT.innerRight - 8, gy - 9);
      ctx.restore();
    }
  }

  // 5. Tempered Glass Floors (intact panes with real propagating cracks & HP badge)
  for (let f = 0; f < FLOOR_COUNT; f++) {
    const curHp = trace.floorHp[hpOff + f];
    const fy = floorY(f);
    const col = FLOOR_COLORS[f];

    // Left rail depth tick label
    ctx.font = `700 15px ${MONO}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = curHp === 0 ? "rgba(158, 178, 196, 0.28)" : f === activeFloor ? SP_COLORS.lime : SP_COLORS.dim;
    ctx.fillText(`F${f + 1}`, SHAFT.left - 10, fy);

    if (curHp <= 0) continue;

    const dmgRatio = 1 - curHp / FLOOR_MAX_HP[f];
    const deckW = SHAFT.innerRight - SHAFT.innerLeft;

    // Glowing glass pane body
    ctx.save();
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.24 + 0.22 * dmgRatio;
    ctx.beginPath();
    ctx.roundRect(SHAFT.innerLeft, fy - FLOOR_THICKNESS / 2, deckW, FLOOR_THICKNESS, 5);
    ctx.fill();

    // Crisp top/bottom glass highlights
    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = col;
    ctx.lineWidth = f === FLOOR_COUNT - 1 ? 3 : 2;
    ctx.stroke();

    // Real fracture cracks accumulated up to this frame
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.78;
    ctx.beginPath();
    for (let c = 0; c < trace.cracks.length; c++) {
      const cr = trace.cracks[c];
      if (cr.floor !== f || cr.frame > frame) continue;
      ctx.moveTo(cr.x, fy - FLOOR_THICKNESS * 0.45);
      ctx.lineTo(cr.x + cr.dx1, fy + cr.dy1 * 0.45);
      ctx.lineTo(cr.x + cr.dx2, fy + cr.dy2 * 0.5);
    }
    ctx.stroke();

    // Centered crisp HP pill embedded on the deck
    ctx.globalAlpha = 1;
    const hpLabel = curHp.toLocaleString("en-US");
    ctx.font = `800 18px ${MONO}`;
    const labelW = Math.max(66, ctx.measureText(hpLabel).width + 22);
    ctx.fillStyle = "#060e16";
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(SETPIECE_LAYOUT.centerX - labelW / 2, fy - 12, labelW, 24, 8);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = f === activeFloor ? SP_COLORS.ink : col;
    ctx.fillText(hpLabel, SETPIECE_LAYOUT.centerX, fy + 1);
    ctx.restore();
  }

  // 6. Shatter shockwaves & tumbling glass shards
  for (let f = 0; f < FLOOR_COUNT; f++) {
    const sf = trace.shatterFrames[f];
    if (sf < 0 || frame < sf || frame > sf + 32) continue;
    const age = (frame - sf) / 32;
    ctx.save();
    ctx.globalAlpha = (1 - age) * 0.75;
    ctx.strokeStyle = FLOOR_COLORS[f];
    ctx.lineWidth = 4 * (1 - age);
    const fy = floorY(f);
    ctx.beginPath();
    ctx.moveTo(SHAFT.innerLeft, fy);
    ctx.lineTo(SHAFT.innerRight, fy);
    ctx.stroke();
    ctx.restore();
  }

  for (let s = 0; s < trace.shards.length; s++) {
    const sh = trace.shards[s];
    if (frame < sh.startFrame || frame > sh.startFrame + 44) continue;
    const t = (frame - sh.startFrame) / FPS;
    const alpha = clamp01(1 - (frame - sh.startFrame) / 44);
    const sx = sh.x0 + sh.vx * t;
    const sy = sh.y0 + sh.vy * t + 1150 * t * t;
    if (sx < SHAFT.left || sx > SHAFT.right || sy > SHAFT.bottom) continue;
    const rot = sh.rot0 + sh.vrot * t;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rot);
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = sh.color;
    ctx.beginPath();
    ctx.moveTo(0, -sh.size * 0.6);
    ctx.lineTo(sh.size * 0.55, sh.size * 0.3);
    ctx.lineTo(-sh.size * 0.48, sh.size * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 7. Split diamond flashes along x2 gates
  for (let i = 0; i < trace.flashes.length; i++) {
    const fl = trace.flashes[i];
    if (frame < fl.frame || frame > fl.frame + 10) continue;
    const a = 1 - (frame - fl.frame) / 10;
    const rad = 10 + (1 - a) * 20;
    ctx.save();
    ctx.globalAlpha = a * 0.85;
    ctx.strokeStyle = SP_COLORS.lime;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(fl.x, fl.y, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 8. Glowing striker balls
  const base = frame * MAX_BALLS;
  for (let i = 0; i < ballCount; i++) {
    const x = trace.ballX[base + i];
    const y = trace.ballY[base + i];
    const r = trace.ballR[base + i];
    if (r <= 0) continue;

    // Alternating bright chrome-white and Oyren-lime tint so dense storms sparkle crisply
    const isLime = i % 3 === 0 || coreReached;
    ctx.fillStyle = isLime ? SP_COLORS.lime : "#eef6fc";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#03070b";
    ctx.lineWidth = r > 10 ? 1.8 : 1.1;
    ctx.stroke();

    // Specular glint
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.arc(x - r * 0.28, y - r * 0.28, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
  }

  // 9. Payoff celebration banner
  if (coreReached) {
    paintPayoffBanner(
      ctx,
      980,
      "CORE REACHED",
      `${ballCount} BALLS · ALL 10 FLOORS SHATTERED`,
      (frame - trace.payoffFrame) / 18,
    );
  }

  ctx.restore();

  // 10. Bottom 10-floor status pills
  const pillGap = 10;
  const pillW = 74;
  const pillH = 26;
  const totalRowW = FLOOR_COUNT * pillW + (FLOOR_COUNT - 1) * pillGap;
  const startX = SETPIECE_LAYOUT.centerX - totalRowW / 2;
  const pillY = SETPIECE_LAYOUT.footerBarY - pillH / 2;

  ctx.save();
  ctx.font = `700 15px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let f = 0; f < FLOOR_COUNT; f++) {
    const px = startX + f * (pillW + pillGap);
    const broken = trace.floorHp[hpOff + f] === 0;
    const isCurrent = !coreReached && f === activeFloor;
    ctx.fillStyle = coreReached
      ? "rgba(200, 255, 0, 0.24)"
      : broken
        ? "rgba(200, 255, 0, 0.14)"
        : isCurrent
          ? "rgba(56, 189, 248, 0.22)"
          : "rgba(15, 25, 36, 0.85)";
    ctx.strokeStyle = coreReached || broken
      ? SP_COLORS.lime
      : isCurrent
        ? FLOOR_COLORS[f]
        : "rgba(158, 178, 196, 0.22)";
    ctx.lineWidth = isCurrent ? 2.2 : 1.4;
    ctx.beginPath();
    ctx.roundRect(px, pillY, pillW, pillH, 7);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = coreReached || broken ? SP_COLORS.lime : isCurrent ? SP_COLORS.ink : SP_COLORS.dim;
    ctx.fillText(`F${f + 1}`, px + pillW / 2, pillY + pillH / 2 + 1);
  }
  ctx.restore();
}

export function synthesizeGlassFloorsAudio(trace: GlassFloorsTrace): SetPieceAudioResult {
  const buf = newHitBuffer(trace.totalFrames);
  const totalSec = trace.totalFrames / FPS;
  const payoffSec = trace.payoffFrame / FPS;

  // Warm evolving harmonic pad underneath
  addSoftPad(buf, {
    startSec: 0,
    durSec: payoffSec + 0.5,
    freqs: [noteHz(45), noteHz(52), noteHz(57)], // A2 E3 A3
    gain: 0.048,
    attackSec: 0.4,
    releaseSec: 0.8,
  });

  // Gate opening metallic click
  addThud(buf, { t: DROP_OPEN_FRAME / FPS, gain: 0.26, hz: 140, durSec: 0.14 });

  // Rate-capped crisp glass taps panned by screen x
  const keptHits = thinEvents(trace.hitEvents, 18);
  for (let i = 0; i < keptHits.length; i++) {
    const ev = keptHits[i];
    const pan = clamp(((ev.x - SHAFT.innerLeft) / (SHAFT.innerRight - SHAFT.innerLeft)) * 2 - 1, -0.75, 0.75);
    const midi = scaleMidi(60 + Math.min(12, ev.floor), PENTATONIC_MAJOR, i % 10);
    addBell(buf, {
      t: ev.t,
      freq: noteHz(midi),
      gain: 0.11,
      pan,
      decay: 13,
      durSec: 0.16,
    });
    if (i % 2 === 0) {
      addTick(buf, { t: ev.t, gain: 0.08, pan, hz: 980 + ev.floor * 55, durSec: 0.025 });
    }
  }

  // x2 prism split shimmering chimes (rate-capped)
  const keptSplits = thinEvents(trace.splitEvents, 14);
  for (let i = 0; i < keptSplits.length; i++) {
    const ev = keptSplits[i];
    const pan = clamp(((ev.x - SHAFT.innerLeft) / (SHAFT.innerRight - SHAFT.innerLeft)) * 2 - 1, -0.7, 0.7);
    const midi = scaleMidi(69, PENTATONIC_MAJOR, (ev.gate + i) % 8);
    addBell(buf, {
      t: ev.t,
      freq: noteHz(midi),
      gain: 0.13,
      pan,
      decay: 9,
      durSec: 0.26,
    });
  }

  // Floor shatters: unmistakable low crystalline burst + rising whoosh
  for (const sh of trace.shatterEvents) {
    const isFinal = sh.floor === FLOOR_COUNT - 1;
    addThud(buf, {
      t: sh.t,
      gain: isFinal ? 0.55 : 0.36,
      hz: isFinal ? 72 : 108 - sh.floor * 3,
      durSec: isFinal ? 0.35 : 0.22,
    });
    addWhoosh(buf, {
      t: sh.t,
      durSec: isFinal ? 0.75 : 0.32,
      gain: isFinal ? 0.26 : 0.14,
      fromHz: 420 + sh.floor * 50,
      toHz: isFinal ? 1500 : 1100,
      seed: 101 + sh.floor * 17,
    });
    const chordRoot = 57 + sh.floor;
    addBell(buf, { t: sh.t, freq: noteHz(chordRoot + 12), gain: 0.2, decay: 5, durSec: 0.45 });
  }

  // Final payoff riser + boom + triumphant resolving major chord
  if (payoffSec > 2) {
    addRiser(buf, { t: Math.max(0, payoffSec - 1.6), durSec: 1.6, gain: 0.12, fromHz: 200, toHz: 880 });
  }
  addBoom(buf, { t: payoffSec, gain: 0.58, seed: 404 });
  const winChord = [57, 64, 69, 73, 76]; // A major shimmering fanfare
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
    freqs: [noteHz(45), noteHz(57), noteHz(61), noteHz(64)],
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

export function getGlassFloorsSpec(): SetPieceSpec {
  const trace = simulateGlassFloors();
  return {
    id: "SetPieceGlassFloors",
    slug: "setpiece-glass-floors",
    title: "10 Glass Floors",
    questionPrefix: "10 GLASS FLOORS:",
    questionHighlight: "WILL IT REACH THE CORE?",
    ruleLine1: "Balls bounce and crack each floor.",
    ruleLine2: "Breaking a floor splits every ball into 2.",
    seed: trace.seed,
    totalFrames: trace.totalFrames,
    holdFrames: trace.holdFrames,
    payoffFrame: trace.payoffFrame,
  };
}

export const GLASS_FLOORS_SETPIECE: SetPieceModule<GlassFloorsTrace> = {
  get spec() {
    return getGlassFloorsSpec();
  },
  simulate: simulateGlassFloors,
  paint: paintGlassFloorsFrame,
  synthesizeAudio: synthesizeGlassFloorsAudio,
};
