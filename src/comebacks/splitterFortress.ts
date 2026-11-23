import type { FrameAudioFeatures } from "../audio-reactive/synth.ts";
import { CLOSING_FRAMES, VIDEO } from "../settings.ts";
import { type ReelBox } from "../shared/reelUtils.ts";
import { theme } from "../theme.ts";
import {
  createRng,
  nextXorshift32State,
  resolveComebackOutcome,
  drawBottomProgressPills,
  drawFullBleedDualChamber,
  drawHookHeaderCard,
  formatCompactInt,
  type ComebackEvent,
  type ComebackSide,
  type ComebackTraceBase,
  type DualChamberPalette,
} from "./invariants.ts";

export const FORTRESS_WALLS = 10;
export const FORTRESS_CEILING_Y = 44;
export const FORTRESS_FIRST_WALL_Y = 508;
export const FORTRESS_WALL_STEP_Y = 142; // Wall 9 at 508 + 9*142 = 1786
export const FORTRESS_WALL_HEIGHT = 36;
const BRICK_COLS = 12;
const BRICK_ROWS = 2;
const BRICKS_PER_WALL = BRICK_COLS * BRICK_ROWS; // 24 visual cells per wall
const MAX_DRAWN_SPLITTERS = 900;
const SNAP_EVERY = 30;
const SUBSTEPS = 4;

export function fortressWallY(index: number): number {
  return FORTRESS_FIRST_WALL_Y + index * FORTRESS_WALL_STEP_Y;
}

const FORTRESS_PALETTE: DualChamberPalette = theme.colors.comebackHudFortressPalette;
const FORTRESS_EFFECTS = theme.colors.comebackHudFortressEffects;

// Identical 10-wall brick counts on both Left and Right (total = 7,850 bricks). The steady 450 bricks/s laser finishes
// at 7,850 / 450 = 17.4 s, so the last wall is sized to leave it under 8% short when the Splitter breaks through.
export const FORTRESS_WALL_BRICKS = [
  240, 310, 390, 480, 590, 720, 880, 1080, 1340, 1820,
] as const;

export const LASER_BRICKS_PER_SEC = 450;
const SPLITTER_SPEED = 1640;
const SPLITTER_BRICKS_PER_HIT = 16.4;

interface SplitterState {
  rngState: number;
  logicalBalls: number;
  brokenWalls: number;
  wallRemBricks: Float64Array;
  nDrawn: number;
  bx: Float32Array;
  by: Float32Array;
  bvx: Float32Array;
  bvy: Float32Array;
}

interface SplitterSnapshot {
  rngState: number;
  logicalBalls: number;
  brokenWalls: number;
  wallRemBricks: Float64Array;
  nDrawn: number;
  bx: Float32Array;
  by: Float32Array;
  bvx: Float32Array;
  bvy: Float32Array;
}

export interface WallShatterBurst {
  frame: number;
  side: ComebackSide;
  wallIndex: number;
  y: number;
}

export interface SplitterComebackTrace extends ComebackTraceBase {
  slug: "splitter-wall-escape";
  victorySubstep: number;
  wallMaxBricks: Float64Array;
  leftBrokenPerFrame: Uint8Array;
  rightBrokenPerFrame: Uint8Array;
  leftActiveRemPerFrame: Float64Array;
  rightActiveRemPerFrame: Float64Array;
  leftTotalCutPerFrame: Float64Array;
  rightBallsPerFrame: Float64Array;
  bursts: WallShatterBurst[];
  rightSnapshots: Map<number, SplitterSnapshot>;
}

function nextSplitterRand(s: SplitterState): number {
  s.rngState = nextXorshift32State(s.rngState, 0x2468ace1);
  return (s.rngState >>> 0) / 4294967296;
}

function snapSplitter(s: SplitterState): SplitterSnapshot {
  return {
    rngState: s.rngState,
    logicalBalls: s.logicalBalls,
    brokenWalls: s.brokenWalls,
    wallRemBricks: new Float64Array(s.wallRemBricks),
    nDrawn: s.nDrawn,
    bx: s.bx.slice(0, s.nDrawn),
    by: s.by.slice(0, s.nDrawn),
    bvx: s.bvx.slice(0, s.nDrawn),
    bvy: s.bvy.slice(0, s.nDrawn),
  };
}

function restoreSplitter(snap: SplitterSnapshot): SplitterState {
  const bx = new Float32Array(MAX_DRAWN_SPLITTERS);
  const by = new Float32Array(MAX_DRAWN_SPLITTERS);
  const bvx = new Float32Array(MAX_DRAWN_SPLITTERS);
  const bvy = new Float32Array(MAX_DRAWN_SPLITTERS);
  bx.set(snap.bx);
  by.set(snap.by);
  bvx.set(snap.bvx);
  bvy.set(snap.bvy);
  return {
    rngState: snap.rngState,
    logicalBalls: snap.logicalBalls,
    brokenWalls: snap.brokenWalls,
    wallRemBricks: new Float64Array(snap.wallRemBricks),
    nDrawn: snap.nDrawn,
    bx,
    by,
    bvx,
    bvy,
  };
}

function stepSplitterSubstep(
  s: SplitterState,
  dt: number,
  frame: number,
  onEvent?: (ev: ComebackEvent) => void,
  onBurst?: (wallIdx: number) => void,
): void {
  const minX = 558;
  const maxX = 1062;
  const r = 6.5;
  let weight = s.nDrawn > 0 ? s.logicalBalls / s.nDrawn : 1;

  const tripleSwarm = (brokenWallIdx: number) => {
    const prevDrawn = s.nDrawn;
    s.logicalBalls *= 3;
    const targetDrawn = Math.min(MAX_DRAWN_SPLITTERS, s.logicalBalls);
    const activeBottom =
      s.brokenWalls < FORTRESS_WALLS ? fortressWallY(s.brokenWalls) - 12 : VIDEO.height - 30;

    for (let idx = prevDrawn; idx < targetDrawn; idx++) {
      const parent = idx % Math.max(1, prevDrawn);
      s.bx[idx] = Math.max(
        minX + 14,
        Math.min(maxX - 14, s.bx[parent] + (nextSplitterRand(s) - 0.5) * 120),
      );
      s.by[idx] =
        FORTRESS_CEILING_Y +
        20 +
        nextSplitterRand(s) * Math.max(60, activeBottom - FORTRESS_CEILING_Y - 36);
      const ang = (nextSplitterRand(s) - 0.5) * 0.62;
      const dir = nextSplitterRand(s) < 0.65 ? 1 : -1;
      s.bvx[idx] = Math.sin(ang) * SPLITTER_SPEED;
      s.bvy[idx] = dir * Math.cos(ang) * SPLITTER_SPEED;
    }
    s.nDrawn = targetDrawn;
    weight = s.nDrawn > 0 ? s.logicalBalls / s.nDrawn : 1;

    onBurst?.(brokenWallIdx);
    onEvent?.({
      frame,
      side: "right",
      kind: "multiply",
      stageIndex: brokenWallIdx,
      intensity: Math.min(1, 0.35 + brokenWallIdx * 0.08),
      pitchStep: brokenWallIdx * 2,
    });
  };

  for (let i = 0; i < s.nDrawn; i++) {
    let x = s.bx[i] + s.bvx[i] * dt;
    let y = s.by[i] + s.bvy[i] * dt;
    let vx = s.bvx[i];
    let vy = s.bvy[i];

    if (x < minX + r) {
      x = minX + r;
      vx = Math.abs(vx);
    } else if (x > maxX - r) {
      x = maxX - r;
      vx = -Math.abs(vx);
    }

    if (y < FORTRESS_CEILING_Y + r) {
      y = FORTRESS_CEILING_Y + r;
      vy = Math.abs(vy);
    }

    if (s.brokenWalls < FORTRESS_WALLS) {
      const surfY = fortressWallY(s.brokenWalls) - r;
      if (y >= surfY && vy > 0) {
        y = surfY;
        vy = -Math.abs(vy);
        let dmg = SPLITTER_BRICKS_PER_HIT * weight;
        while (dmg > 0 && s.brokenWalls < FORTRESS_WALLS) {
          const wIdx = s.brokenWalls;
          if (dmg >= s.wallRemBricks[wIdx]) {
            dmg -= s.wallRemBricks[wIdx];
            s.wallRemBricks[wIdx] = 0;
            s.brokenWalls++;
            if (s.brokenWalls < FORTRESS_WALLS) {
              tripleSwarm(wIdx);
            } else {
              onBurst?.(wIdx);
              onEvent?.({
                frame,
                side: "right",
                kind: "stage-break",
                stageIndex: wIdx,
                intensity: 1,
                pitchStep: 18,
              });
            }
          } else {
            s.wallRemBricks[wIdx] -= dmg;
            dmg = 0;
          }
        }
      }
    } else if (y > VIDEO.height - 26 - r) {
      y = VIDEO.height - 26 - r;
      vy = -Math.abs(vy);
    }

    s.bx[i] = x;
    s.by[i] = y;
    s.bvx[i] = vx;
    s.bvy[i] = vy;
  }
}

let cachedSplitterTrace: SplitterComebackTrace | null = null;

export function clearSplitterTraceCache(): void {
  cachedSplitterTrace = null;
}

export function simulateSplitterFortress(): SplitterComebackTrace {
  if (cachedSplitterTrace) return cachedSplitterTrace;

  const seed = 20261119;
  const raceFrames = 1200; // 20.0s race + 3.0s closing
  const closingFrames = CLOSING_FRAMES;
  const totalFrames = raceFrames + closingFrames;
  const rng = createRng(seed);

  const wallMaxBricks = Float64Array.from(FORTRESS_WALL_BRICKS);
  const leftRemBricks = Float64Array.from(FORTRESS_WALL_BRICKS);
  let leftBroken = 0;
  let leftTotalCut = 0;

  const bx = new Float32Array(MAX_DRAWN_SPLITTERS);
  const by = new Float32Array(MAX_DRAWN_SPLITTERS);
  const bvx = new Float32Array(MAX_DRAWN_SPLITTERS);
  const bvy = new Float32Array(MAX_DRAWN_SPLITTERS);
  bx[0] = 810;
  by[0] = FORTRESS_CEILING_Y + 64;
  bvx[0] = 240;
  bvy[0] = SPLITTER_SPEED;

  const right: SplitterState = {
    rngState: Math.floor(rng() * 0x7fffffff) | 1,
    logicalBalls: 1,
    brokenWalls: 0,
    wallRemBricks: Float64Array.from(FORTRESS_WALL_BRICKS),
    nDrawn: 1,
    bx,
    by,
    bvx,
    bvy,
  };

  const leftProgress = new Float32Array(raceFrames);
  const rightProgress = new Float32Array(raceFrames);
  const leftBrokenPerFrame = new Uint8Array(raceFrames);
  const rightBrokenPerFrame = new Uint8Array(raceFrames);
  const leftActiveRemPerFrame = new Float64Array(raceFrames);
  const rightActiveRemPerFrame = new Float64Array(raceFrames);
  const leftTotalCutPerFrame = new Float64Array(raceFrames);
  const rightBallsPerFrame = new Float64Array(raceFrames);

  const events: ComebackEvent[] = [];
  const bursts: WallShatterBurst[] = [];
  const rightSnapshots = new Map<number, SplitterSnapshot>();

  const dt = 1 / (VIDEO.fps * SUBSTEPS);
  let winner: ComebackSide | null = null;
  let victoryFrame = raceFrames - 1;
  let victorySubstep = SUBSTEPS - 1;

  for (let f = 0; f < raceFrames; f++) {
    if (f > 0 && winner === null) {
      for (let sub = 0; sub < SUBSTEPS; sub++) {
        // Step Left steady laser cutter (450 bricks/s)
        let cut = LASER_BRICKS_PER_SEC * dt;
        leftTotalCut += cut;
        while (cut > 0 && leftBroken < FORTRESS_WALLS) {
          if (cut >= leftRemBricks[leftBroken]) {
            cut -= leftRemBricks[leftBroken];
            leftRemBricks[leftBroken] = 0;
            const brokeIdx = leftBroken++;
            bursts.push({ frame: f, side: "left", wallIndex: brokeIdx, y: fortressWallY(brokeIdx) });
            events.push({
              frame: f,
              side: "left",
              kind: "stage-break",
              stageIndex: brokeIdx,
              intensity: 0.42,
              pitchStep: brokeIdx,
            });
          } else {
            leftRemBricks[leftBroken] -= cut;
            cut = 0;
          }
        }

        // Step Right Splitter x3 ball swarm
        stepSplitterSubstep(
          right,
          dt,
          f,
          (ev) => events.push(ev),
          (wIdx) => bursts.push({ frame: f, side: "right", wallIndex: wIdx, y: fortressWallY(wIdx) }),
        );

        if (right.brokenWalls >= FORTRESS_WALLS || leftBroken >= FORTRESS_WALLS) {
          winner = right.brokenWalls >= FORTRESS_WALLS ? "right" : "left";
          victoryFrame = f;
          victorySubstep = sub;
          events.push({
            frame: f,
            side: winner,
            kind: "victory",
            stageIndex: 9,
            intensity: 1,
            pitchStep: 16,
          });
          break;
        }
      }
    } else if (f > 0 && winner === "right") {
      for (let sub = 0; sub < SUBSTEPS; sub++) {
        stepSplitterSubstep(right, dt * 0.4, f);
      }
    }

    leftProgress[f] =
      leftBroken >= FORTRESS_WALLS
        ? 1
        : (leftBroken + (1 - leftRemBricks[leftBroken] / wallMaxBricks[leftBroken])) /
          FORTRESS_WALLS;
    rightProgress[f] =
      right.brokenWalls >= FORTRESS_WALLS
        ? 1
        : (right.brokenWalls +
            (1 - right.wallRemBricks[right.brokenWalls] / wallMaxBricks[right.brokenWalls])) /
          FORTRESS_WALLS;

    leftBrokenPerFrame[f] = leftBroken;
    rightBrokenPerFrame[f] = right.brokenWalls;
    leftActiveRemPerFrame[f] = leftBroken < FORTRESS_WALLS ? leftRemBricks[leftBroken] : 0;
    rightActiveRemPerFrame[f] =
      right.brokenWalls < FORTRESS_WALLS ? right.wallRemBricks[right.brokenWalls] : 0;
    leftTotalCutPerFrame[f] = leftTotalCut;
    rightBallsPerFrame[f] = right.logicalBalls;
    if (f % SNAP_EVERY === 0) {
      rightSnapshots.set(f, snapSplitter(right));
    }
  }

  const { winner: resolvedWinner, earlyLeader, overtakeFrame } = resolveComebackOutcome({
    provisionalWinner: winner,
    victoryFrame,
    raceFrames,
    leftProgress,
    rightProgress,
    events,
    overtakePitchStep: 14,
  });

  const runnerUpRem =
    resolvedWinner === "right"
      ? leftActiveRemPerFrame[victoryFrame]
      : rightActiveRemPerFrame[victoryFrame];
  const runnerUpBroken =
    resolvedWinner === "right"
      ? leftBrokenPerFrame[victoryFrame]
      : rightBrokenPerFrame[victoryFrame];
  const runnerUpFinalStageRemainingRatio =
    runnerUpBroken === FORTRESS_WALLS - 1
      ? runnerUpRem / wallMaxBricks[FORTRESS_WALLS - 1]
      : 1;

  cachedSplitterTrace = {
    slug: "splitter-wall-escape",
    seed,
    fps: VIDEO.fps,
    raceFrames,
    closingFrames,
    totalFrames,
    winner: resolvedWinner,
    earlyLeader,
    overtakeFrame,
    victoryFrame,
    victorySubstep,
    leftProgress,
    rightProgress,
    runnerUpFinalStageRemainingRatio,
    events,
    wallMaxBricks,
    leftBrokenPerFrame,
    rightBrokenPerFrame,
    leftActiveRemPerFrame,
    rightActiveRemPerFrame,
    leftTotalCutPerFrame,
    rightBallsPerFrame,
    bursts,
    rightSnapshots,
  };
  return cachedSplitterTrace;
}

export function reconstructSplitterAt(
  trace: SplitterComebackTrace,
  frame: number,
  fromStart = false,
): SplitterState {
  const clamped = Math.max(0, Math.min(trace.raceFrames - 1, frame));
  const snapFrame = fromStart ? 0 : clamped - (clamped % SNAP_EVERY);
  const state = restoreSplitter(trace.rightSnapshots.get(snapFrame)!);
  const dt = 1 / (VIDEO.fps * SUBSTEPS);
  for (let f = snapFrame + 1; f <= clamped; f++) {
    const post = f > trace.victoryFrame;
    if (post && trace.winner !== "right") break;
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      if (f === trace.victoryFrame && sub > trace.victorySubstep) break;
      stepSplitterSubstep(state, post ? dt * 0.4 : dt, f);
    }
  }
  return state;
}

export function paintSplitterFortressFrame(
  ctx: CanvasRenderingContext2D,
  trace: SplitterComebackTrace,
  features: readonly FrameAudioFeatures[],
  frame: number,
  width = VIDEO.width,
  height = VIDEO.height,
): ReelBox[] {
  const f = Math.max(0, Math.min(trace.raceFrames - 1, frame));
  const feat = features[Math.min(features.length - 1, f)];
  const boxes: ReelBox[] = [];
  const overtaken = f >= trace.overtakeFrame;
  const won = f >= trace.victoryFrame;
  const leaderSide: ComebackSide =
    trace.rightProgress[f] >= trace.leftProgress[f] ? "right" : "left";

  // 1. Full-bleed 1080x1920 fortress chamber
  drawFullBleedDualChamber(
    ctx,
    f,
    feat.kickImpulse,
    feat.bass,
    FORTRESS_PALETTE,
    overtaken ? trace.winner : null,
    width,
    height,
  );

  // 2. Draw 10 multi-row neon brick walls on both sides (x: 8..532 and x: 548..1072)
  const drawFortressLaneWalls = (
    side: ComebackSide,
    broken: number,
    activeRem: number,
    accent: string,
  ): { laserTargetX: number; laserTargetY: number } => {
    const laneLeft = side === "left" ? 8 : 548;
    const laneW = 524;
    const cellW = laneW / BRICK_COLS;
    const cellH = FORTRESS_WALL_HEIGHT / BRICK_ROWS;
    let laserTargetX = laneLeft + laneW * 0.5;
    let laserTargetY = height - 20;

    for (let wIdx = broken; wIdx < FORTRESS_WALLS; wIdx++) {
      const wallTop = fortressWallY(wIdx);
      const maxB = trace.wallMaxBricks[wIdx];
      const remB = wIdx === broken ? activeRem : maxB;
      const aliveCells =
        wIdx === broken ? Math.max(1, Math.ceil((remB / maxB) * BRICKS_PER_WALL)) : BRICKS_PER_WALL;

      for (let cIdx = 0; cIdx < BRICKS_PER_WALL; cIdx++) {
        // Vaporize bricks from top-left to bottom-right
        const cellOrder = BRICKS_PER_WALL - 1 - cIdx;
        if (cellOrder >= aliveCells) continue;

        const row = Math.floor(cIdx / BRICK_COLS);
        const col = cIdx % BRICK_COLS;
        const bx = laneLeft + col * cellW + 1.5;
        const by = wallTop + row * cellH + 1.5;

        const isNextCut = wIdx === broken && cellOrder === aliveCells - 1;
        if (isNextCut) {
          laserTargetX = bx + (cellW - 3) * 0.5;
          laserTargetY = by + (cellH - 3) * 0.5;
        }

        ctx.fillStyle = isNextCut
          ? theme.colors.comebackHudPureWhite
          : wIdx === broken
            ? accent
            : FORTRESS_EFFECTS.futureWall;
        ctx.globalAlpha = wIdx === broken ? 0.92 : 0.55;
        ctx.fillRect(bx, by, cellW - 3, cellH - 3);
      }
      ctx.globalAlpha = 1;
    }

    return { laserTargetX, laserTargetY };
  };

  const leftTarget = drawFortressLaneWalls(
    "left",
    trace.leftBrokenPerFrame[f],
    trace.leftActiveRemPerFrame[f],
    FORTRESS_PALETTE.leftAccent,
  );
  drawFortressLaneWalls(
    "right",
    trace.rightBrokenPerFrame[f],
    trace.rightActiveRemPerFrame[f],
    FORTRESS_PALETTE.rightAccent,
  );

  // 3. Draw Left Lane's Dual High-Power Sweeping Magenta Lasers (from y=24 emitters to active brick!)
  if (trace.leftBrokenPerFrame[f] < FORTRESS_WALLS && !won) {
    const emitters = [148, 392];
    ctx.save();
    for (const ex of emitters) {
      // Wide outer plasma beam
      ctx.strokeStyle = FORTRESS_EFFECTS.laserGlow;
      ctx.lineWidth = 11 + feat.kickImpulse * 6;
      ctx.beginPath();
      ctx.moveTo(ex, 22);
      ctx.lineTo(leftTarget.laserTargetX, leftTarget.laserTargetY);
      ctx.stroke();

      // Core white-hot beam
      ctx.strokeStyle = FORTRESS_EFFECTS.laserCore;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(ex, 22);
      ctx.lineTo(leftTarget.laserTargetX, leftTarget.laserTargetY);
      ctx.stroke();
    }
    // Cutting spark flare at target brick
    ctx.fillStyle = theme.colors.comebackHudPureWhite;
    ctx.beginPath();
    ctx.arc(
      leftTarget.laserTargetX,
      leftTarget.laserTargetY,
      10 + (f % 4) * 2.5,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  // 4. Draw Right Lane's Splitter Swarm (1 -> 3 -> 9 -> ... -> 19,683 emerald orbs)
  const splitterState = reconstructSplitterAt(trace, f);
  ctx.save();
  ctx.fillStyle = FORTRESS_PALETTE.rightAccent;
  for (let i = 0; i < splitterState.nDrawn; i++) {
    const x = splitterState.bx[i];
    const y = splitterState.by[i];
    const vy = splitterState.bvy[i];
    const streakLen = Math.abs(vy) * 0.011;
    const streakTop = vy >= 0 ? y - streakLen : y;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(x - 2.5, streakTop, 5, streakLen + 4);
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(x, y, splitterState.nDrawn === 1 ? 11 : 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 5. Shattered brick debris bursts
  for (const b of trace.bursts) {
    const age = f - b.frame;
    if (age < 0 || age > 30) continue;
    const p = age / 30;
    const baseLeft = b.side === "left" ? 22 : 562;
    ctx.save();
    ctx.globalAlpha = (1 - p) * 0.88;
    ctx.fillStyle =
      b.side === "left" ? FORTRESS_PALETTE.leftAccent : FORTRESS_EFFECTS.rightDebris;
    for (let k = 0; k < 12; k++) {
      const px = baseLeft + k * 42 + Math.cos(k * 1.7 + b.wallIndex) * age * 3;
      const py = b.y + age * (2.8 + (k % 3) * 1.6) + 0.12 * age * age;
      ctx.fillRect(px, py, 16 * (1 - p * 0.4), 10 * (1 - p * 0.4));
    }
    ctx.restore();
  }

  // 6. Safe-zone Viral Hook Header & Progress Pills
  drawHookHeaderCard(ctx, boxes, {
    highlightBadge: "1 SPLITTER",
    hookLine1: "vs 450 BRICKS/S:",
    hookLine2: "Who breaks 10 walls first?",
    subline: "LASER vs ×3 BALLS PER WALL",
    leftValue: `${formatCompactInt(trace.leftTotalCutPerFrame[f])} cut`,
    leftFormula: "450 BRICKS/S",
    leftAccent: FORTRESS_PALETTE.leftAccent,
    rightValue: `${formatCompactInt(trace.rightBallsPerFrame[f])} balls`,
    rightFormula: "×3 / WALL",
    rightAccent: FORTRESS_PALETTE.rightAccent,
    leaderSide,
    overtaken,
  });

  const leftPct = Math.round(trace.leftProgress[f] * 100);
  const rightPct = Math.round(trace.rightProgress[f] * 100);
  const statusBanner = won
    ? `SPLITTER WINS · ${leftPct}%:100%`
    : overtaken
      ? "SPLITTER OVERTAKES!"
      : trace.leftBrokenPerFrame[f] >= 8
        ? `LASER ${trace.leftBrokenPerFrame[f] + 1}/10 · BALLS GROW`
        : undefined;

  drawBottomProgressPills(ctx, boxes, {
    leftLabel: `LASER ${trace.leftBrokenPerFrame[f]}/10 ${leftPct}%`,
    leftProgress: trace.leftProgress[f],
    leftAccent: FORTRESS_PALETTE.leftAccent,
    rightLabel: won
      ? "BALLS 10/10 WIN"
      : `BALLS ${trace.rightBrokenPerFrame[f]}/10 ${rightPct}%`,
    rightProgress: trace.rightProgress[f],
    rightAccent: FORTRESS_PALETTE.rightAccent,
    statusBanner,
    bannerAccent: won || overtaken ? FORTRESS_PALETTE.rightAccent : undefined,
  });

  return boxes;
}
