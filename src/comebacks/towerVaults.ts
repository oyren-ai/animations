import type { FrameAudioFeatures } from "../audio-reactive/synth.ts";
import { CLOSING_FRAMES, VIDEO } from "../settings.ts";
import { assertReelSafeBox, drawReelText, type ReelBox } from "../shared/reelUtils.ts";
import { theme } from "../theme.ts";
import {
  createRng,
  nextXorshift32State,
  drawBottomProgressPills,
  drawFullBleedDualChamber,
  drawHookHeaderCard,
  formatCompactInt,
  type ComebackEvent,
  type ComebackSide,
  type ComebackTraceBase,
  type DualChamberPalette,
} from "./invariants.ts";

export type VaultComebackSlug = "tower-linear-vs-exponential" | "titan-hammer-vs-swarm";

export const TOWER_FLOORS = 10;
export const VAULT_CEILING_Y = 44;
export const VAULT_FIRST_FLOOR_Y = 512;
export const VAULT_FLOOR_STEP_Y = 144; // Floor 9 sits at 512 + 9*144 = 1808 (full-bleed down to 1920!)
export const VAULT_FLOOR_THICKNESS = 24;
const MAX_DRAWN_BALLS = 900;
const SNAP_EVERY = 30;
const SUBSTEPS = 4;

export function vaultFloorY(index: number): number {
  return VAULT_FIRST_FLOOR_Y + index * VAULT_FLOOR_STEP_Y;
}

interface LaneMutState {
  rngState: number;
  logicalCount: number;
  spawnAccum: number;
  nextMultiplySec: number;
  titanDamage: number;
  titanBounces: number;
  brokenFloors: number;
  floorRemainingHp: Float64Array;
  nDrawn: number;
  bx: Float32Array;
  by: Float32Array;
  bvx: Float32Array;
  bvy: Float32Array;
}

interface LaneSnapshot {
  rngState: number;
  logicalCount: number;
  spawnAccum: number;
  nextMultiplySec: number;
  titanDamage: number;
  titanBounces: number;
  brokenFloors: number;
  floorRemainingHp: Float64Array;
  nDrawn: number;
  bx: Float32Array;
  by: Float32Array;
  bvx: Float32Array;
  bvy: Float32Array;
}

export interface FloorBreakVisual {
  frame: number;
  side: ComebackSide;
  floorIndex: number;
  y: number;
}

export interface ShockwaveVisual {
  frame: number;
  side: ComebackSide;
  x: number;
  y: number;
  strength: number; // 0..1
}

export interface VaultComebackTrace extends ComebackTraceBase {
  slug: VaultComebackSlug;
  victorySubstep: number;
  floorMaxHp: Float64Array;
  totalVaultHp: number;
  leftCountPerFrame: Float64Array;
  rightCountPerFrame: Float64Array;
  rightPowerPerFrame: Float64Array;
  leftBrokenPerFrame: Uint8Array;
  rightBrokenPerFrame: Uint8Array;
  leftActiveHpPerFrame: Float64Array;
  rightActiveHpPerFrame: Float64Array;
  floorBreaks: FloorBreakVisual[];
  shockwaves: ShockwaveVisual[];
  leftSnapshots: Map<number, LaneSnapshot>;
  rightSnapshots: Map<number, LaneSnapshot>;
  config: VaultSceneConfig;
}

interface VaultSceneConfig {
  slug: VaultComebackSlug;
  seed: number;
  raceFrames: number;
  floorMaxHp: readonly number[];
  leftInitialBalls: number;
  leftAddPerSec: number;
  leftBallSpeed: number;
  rightMode: "multiply-balls" | "titan-double-damage";
  rightInitialBalls: number;
  rightMultiplyEverySec: number;
  rightMultiplyFactor: number;
  rightBallSpeed: number;
  /** Titan mode only: speed multiplier applied after every bounce (the damage doubles on the same bounce). */
  titanSpeedGrowth: number;
  /** Titan mode only: speed cap in px/s. */
  titanMaxSpeed: number;
  palette: DualChamberPalette;
}

export type { VaultSceneConfig };

export const VAULT_CONFIGS: Record<VaultComebackSlug, VaultSceneConfig> = {
  "tower-linear-vs-exponential": {
    slug: "tower-linear-vs-exponential",
    seed: 20261117,
    raceFrames: 1620, // 27.0s race + 3.0s closing = 30.0s Short
    // Identical exponential-HP 10-floor vault on both Left and Right (sum = 181,430 HP).
    // The last floor is tuned so the linear side ends the race at ~92% of its 10th floor (photo finish).
    floorMaxHp: [520, 960, 1750, 3100, 5400, 9200, 15500, 26000, 44000, 75000],
    leftInitialBalls: 5000,
    leftAddPerSec: 600,
    leftBallSpeed: 1715,
    rightMode: "multiply-balls",
    rightInitialBalls: 1,
    rightMultiplyEverySec: 4.5,
    rightMultiplyFactor: 10,
    rightBallSpeed: 1660,
    titanSpeedGrowth: 1.068, // unused in multiply-balls mode
    titanMaxSpeed: 2750, // unused in multiply-balls mode
    palette: theme.colors.comebackHudTowerPalette,
  },
  "titan-hammer-vs-swarm": {
    slug: "titan-hammer-vs-swarm",
    seed: 20261118,
    raceFrames: 1200, // 20.0s race + 3.0s closing = 23.0s Short
    // Identical 10-floor armored vault on both Left and Right (sum = 56,550 HP). The Titan's damage doubles on every
    // bounce (1, 2, 4 ...), so it needs 16 bounces; speeds were solved against verifyComebackInvariants (early
    // blowout >= 0.5 at both checkpoints, overtake and victory inside [0.82, 0.96], swarm at ~99% of floor 10).
    floorMaxHp: [1380, 1770, 2280, 2940, 3780, 4860, 6250, 8040, 10340, 14910],
    leftInitialBalls: 4000,
    leftAddPerSec: 0,
    leftBallSpeed: 2125,
    rightMode: "titan-double-damage",
    rightInitialBalls: 1,
    rightMultiplyEverySec: 999,
    rightMultiplyFactor: 1,
    rightBallSpeed: 480,
    titanSpeedGrowth: 1.09,
    titanMaxSpeed: 2750,
    palette: theme.colors.comebackHudTitanPalette,
  },
};

function nextLaneRand(state: LaneMutState): number {
  state.rngState = nextXorshift32State(state.rngState, 0x13579bdf);
  return (state.rngState >>> 0) / 4294967296;
}

function cloneSnap(s: LaneMutState): LaneSnapshot {
  return {
    rngState: s.rngState,
    logicalCount: s.logicalCount,
    spawnAccum: s.spawnAccum,
    nextMultiplySec: s.nextMultiplySec,
    titanDamage: s.titanDamage,
    titanBounces: s.titanBounces,
    brokenFloors: s.brokenFloors,
    floorRemainingHp: new Float64Array(s.floorRemainingHp),
    nDrawn: s.nDrawn,
    bx: s.bx.slice(0, s.nDrawn),
    by: s.by.slice(0, s.nDrawn),
    bvx: s.bvx.slice(0, s.nDrawn),
    bvy: s.bvy.slice(0, s.nDrawn),
  };
}

function restoreSnap(snap: LaneSnapshot): LaneMutState {
  const bx = new Float32Array(MAX_DRAWN_BALLS);
  const by = new Float32Array(MAX_DRAWN_BALLS);
  const bvx = new Float32Array(MAX_DRAWN_BALLS);
  const bvy = new Float32Array(MAX_DRAWN_BALLS);
  bx.set(snap.bx);
  by.set(snap.by);
  bvx.set(snap.bvx);
  bvy.set(snap.bvy);
  return {
    rngState: snap.rngState,
    logicalCount: snap.logicalCount,
    spawnAccum: snap.spawnAccum,
    nextMultiplySec: snap.nextMultiplySec,
    titanDamage: snap.titanDamage,
    titanBounces: snap.titanBounces,
    brokenFloors: snap.brokenFloors,
    floorRemainingHp: new Float64Array(snap.floorRemainingHp),
    nDrawn: snap.nDrawn,
    bx,
    by,
    bvx,
    bvy,
  };
}

function laneXBounds(side: ComebackSide): { minX: number; maxX: number } {
  return side === "left" ? { minX: 18, maxX: 522 } : { minX: 558, maxX: 1062 };
}

function initLaneState(
  cfg: VaultSceneConfig,
  side: ComebackSide,
  seedOffset: number,
): LaneMutState {
  const rng = createRng(cfg.seed ^ seedOffset);
  const { minX, maxX } = laneXBounds(side);
  const initialCount = side === "left" ? cfg.leftInitialBalls : cfg.rightInitialBalls;
  const speed = side === "left" ? cfg.leftBallSpeed : cfg.rightBallSpeed;
  const nDrawn = Math.min(MAX_DRAWN_BALLS, initialCount);

  const bx = new Float32Array(MAX_DRAWN_BALLS);
  const by = new Float32Array(MAX_DRAWN_BALLS);
  const bvx = new Float32Array(MAX_DRAWN_BALLS);
  const bvy = new Float32Array(MAX_DRAWN_BALLS);

  const firstFloor = vaultFloorY(0) - 14;
  for (let i = 0; i < nDrawn; i++) {
    if (side === "right" && cfg.rightMode === "titan-double-damage") {
      bx[i] = (minX + maxX) * 0.5;
      by[i] = VAULT_CEILING_Y + 72;
      bvx[i] = 195;
      bvy[i] = speed;
    } else {
      bx[i] = minX + 16 + rng() * (maxX - minX - 32);
      by[i] = VAULT_CEILING_Y + 24 + rng() * (firstFloor - VAULT_CEILING_Y - 48);
      const angle = (rng() - 0.5) * 0.52;
      const dir = rng() < 0.58 ? 1 : -1;
      bvx[i] = Math.sin(angle) * speed;
      bvy[i] = dir * Math.cos(angle) * speed;
    }
  }

  return {
    rngState: Math.floor(rng() * 0x7fffffff) | 1,
    logicalCount: initialCount,
    spawnAccum: 0,
    nextMultiplySec: cfg.rightMultiplyEverySec,
    titanDamage: 1,
    titanBounces: 0,
    brokenFloors: 0,
    floorRemainingHp: Float64Array.from(cfg.floorMaxHp),
    nDrawn,
    bx,
    by,
    bvx,
    bvy,
  };
}

function stepLaneSubstep(
  s: LaneMutState,
  cfg: VaultSceneConfig,
  side: ComebackSide,
  tSec: number,
  dt: number,
  frame: number,
  onEvent?: (ev: ComebackEvent) => void,
  onBreak?: (floorIdx: number) => void,
  onShockwave?: (x: number, y: number, strength: number) => void,
): void {
  const { minX, maxX } = laneXBounds(side);
  const baseSpeed = side === "left" ? cfg.leftBallSpeed : cfg.rightBallSpeed;
  const activeBottomY =
    s.brokenFloors < TOWER_FLOORS ? vaultFloorY(s.brokenFloors) - 10 : VIDEO.height - 28;

  // 1. Linear ball spawning (Left lane in TowerLinearVsExponential)
  if (side === "left" && cfg.leftAddPerSec > 0 && s.brokenFloors < TOWER_FLOORS) {
    s.spawnAccum += cfg.leftAddPerSec * dt;
    const addWhole = Math.floor(s.spawnAccum);
    if (addWhole > 0) {
      s.spawnAccum -= addWhole;
      s.logicalCount += addWhole;
      while (s.nDrawn < Math.min(MAX_DRAWN_BALLS, s.logicalCount)) {
        const idx = s.nDrawn++;
        s.bx[idx] = minX + 20 + nextLaneRand(s) * (maxX - minX - 40);
        s.by[idx] = VAULT_CEILING_Y + 18 + nextLaneRand(s) * 90;
        const ang = (nextLaneRand(s) - 0.5) * 0.48;
        s.bvx[idx] = Math.sin(ang) * baseSpeed;
        s.bvy[idx] = Math.cos(ang) * baseSpeed;
      }
    }
  }

  // 2. Exponential multiplication ticks (Right lane in TowerLinearVsExponential)
  if (
    side === "right" &&
    cfg.rightMode === "multiply-balls" &&
    s.brokenFloors < TOWER_FLOORS &&
    tSec >= s.nextMultiplySec - 1e-9
  ) {
    const prevDrawn = s.nDrawn;
    s.logicalCount *= cfg.rightMultiplyFactor;
    const stepNum = Math.round(s.nextMultiplySec / cfg.rightMultiplyEverySec);
    s.nextMultiplySec += cfg.rightMultiplyEverySec;

    const targetDrawn = Math.min(MAX_DRAWN_BALLS, s.logicalCount);
    for (let idx = prevDrawn; idx < targetDrawn; idx++) {
      const parent = idx % Math.max(1, prevDrawn);
      const jitterX = (nextLaneRand(s) - 0.5) * 90;
      s.bx[idx] = Math.max(minX + 14, Math.min(maxX - 14, s.bx[parent] + jitterX));
      // Distribute children throughout active shaft height heading both up and down for instant bite
      s.by[idx] =
        VAULT_CEILING_Y + 24 + nextLaneRand(s) * Math.max(60, activeBottomY - VAULT_CEILING_Y - 36);
      const ang = (nextLaneRand(s) - 0.5) * 0.58;
      const dir = nextLaneRand(s) < 0.62 ? 1 : -1;
      s.bvx[idx] = Math.sin(ang) * baseSpeed;
      s.bvy[idx] = dir * Math.cos(ang) * baseSpeed;
    }
    s.nDrawn = targetDrawn;

    onEvent?.({
      frame,
      side: "right",
      kind: "multiply",
      stageIndex: Math.min(9, stepNum),
      intensity: Math.min(1, 0.35 + stepNum * 0.14),
      pitchStep: stepNum * 2,
    });
    onShockwave?.((minX + maxX) * 0.5, Math.min(1500, activeBottomY * 0.65), Math.min(1, 0.35 + stepNum * 0.15));
  }

  // 3. Integrate balls & resolve wall + active-floor impacts
  const isTitan = side === "right" && cfg.rightMode === "titan-double-damage";
  const weightPerDrawn = s.nDrawn > 0 ? s.logicalCount / s.nDrawn : 1;

  for (let i = 0; i < s.nDrawn; i++) {
    let x = s.bx[i] + s.bvx[i] * dt;
    let y = s.by[i] + s.bvy[i] * dt;
    let vx = s.bvx[i];
    let vy = s.bvy[i];
    const r = isTitan ? Math.min(54, 15 + s.titanBounces * 2.1) : 6;

    if (x < minX + r) {
      x = minX + r;
      vx = Math.abs(vx);
    } else if (x > maxX - r) {
      x = maxX - r;
      vx = -Math.abs(vx);
    }

    if (y < VAULT_CEILING_Y + r) {
      y = VAULT_CEILING_Y + r;
      vy = Math.abs(vy);
    }

    if (s.brokenFloors < TOWER_FLOORS) {
      const floorSurfY = vaultFloorY(s.brokenFloors) - r;
      if (y >= floorSurfY && vy > 0) {
        if (isTitan) {
          // Titan Hammer: deal current titanDamage; cleave straight through if strike exceeds floor HP!
          let strikePool = s.titanDamage;
          let cleavedAny = false;
          while (strikePool > 0 && s.brokenFloors < TOWER_FLOORS) {
            const curIdx = s.brokenFloors;
            const rem = s.floorRemainingHp[curIdx];
            if (strikePool >= rem) {
              strikePool -= rem;
              s.floorRemainingHp[curIdx] = 0;
              s.brokenFloors++;
              cleavedAny = true;
              const brokeFloorY = vaultFloorY(curIdx);
              onBreak?.(curIdx);
              onShockwave?.(x, brokeFloorY, Math.min(1, 0.55 + curIdx * 0.05));
              onEvent?.({
                frame,
                side: "right",
                kind: "stage-break",
                stageIndex: curIdx,
                intensity: Math.min(1, 0.5 + curIdx * 0.05),
                pitchStep: curIdx + 4,
              });
            } else {
              s.floorRemainingHp[curIdx] = rem - strikePool;
              strikePool = 0;
              // Rebound upward and double Titan damage!
              y = vaultFloorY(curIdx) - r;
              s.titanBounces++;
              s.titanDamage *= 2;
              const boostedSpeed = Math.min(
                cfg.titanMaxSpeed,
                baseSpeed * Math.pow(cfg.titanSpeedGrowth, s.titanBounces),
              );
              vy = -boostedSpeed;
              vx = (vx >= 0 ? 1 : -1) * Math.min(340, 185 + s.titanBounces * 8);
              onShockwave?.(x, vaultFloorY(curIdx), Math.min(1, 0.25 + s.titanBounces * 0.045));
              onEvent?.({
                frame,
                side: "right",
                kind: "bounce-powerup",
                stageIndex: Math.min(9, curIdx),
                intensity: Math.min(1, 0.22 + s.titanBounces * 0.045),
                pitchStep: s.titanBounces,
              });
            }
          }
          if (s.brokenFloors >= TOWER_FLOORS && cleavedAny) {
            vy = Math.abs(vy) * 0.65;
          }
        } else {
          // Swarm / compounding balls: deal weighted damage to active floor and rebound upward
          const curIdx = s.brokenFloors;
          s.floorRemainingHp[curIdx] -= weightPerDrawn;
          y = floorSurfY;
          vy = -Math.abs(vy);
          if (s.floorRemainingHp[curIdx] <= 0) {
            let overflow = -s.floorRemainingHp[curIdx];
            s.floorRemainingHp[curIdx] = 0;
            s.brokenFloors++;
            onBreak?.(curIdx);
            onShockwave?.(
              (minX + maxX) * 0.5,
              vaultFloorY(curIdx),
              side === "right" ? 0.85 : 0.45,
            );
            onEvent?.({
              frame,
              side,
              kind: "stage-break",
              stageIndex: curIdx,
              intensity: side === "right" ? 0.78 : 0.42,
              pitchStep: curIdx,
            });
            while (overflow > 0 && s.brokenFloors < TOWER_FLOORS) {
              const nextIdx = s.brokenFloors;
              if (overflow >= s.floorRemainingHp[nextIdx]) {
                overflow -= s.floorRemainingHp[nextIdx];
                s.floorRemainingHp[nextIdx] = 0;
                s.brokenFloors++;
                onBreak?.(nextIdx);
                onEvent?.({
                  frame,
                  side,
                  kind: "stage-break",
                  stageIndex: nextIdx,
                  intensity: 0.85,
                  pitchStep: nextIdx,
                });
              } else {
                s.floorRemainingHp[nextIdx] -= overflow;
                overflow = 0;
              }
            }
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

function computeVaultProgress(s: LaneMutState, floorMaxHp: readonly number[]): number {
  if (s.brokenFloors >= TOWER_FLOORS) return 1;
  const curMax = floorMaxHp[s.brokenFloors];
  const curFrac = Math.max(0, Math.min(1, 1 - s.floorRemainingHp[s.brokenFloors] / curMax));
  return (s.brokenFloors + curFrac) / TOWER_FLOORS;
}

const TRACE_CACHE = new Map<VaultComebackSlug, VaultComebackTrace>();

export function clearVaultTraceCache(): void {
  TRACE_CACHE.clear();
}

export function simulateVaultComeback(slug: VaultComebackSlug): VaultComebackTrace {
  const cached = TRACE_CACHE.get(slug);
  if (cached) return cached;

  const cfg = VAULT_CONFIGS[slug];
  const { raceFrames } = cfg;
  const closingFrames = CLOSING_FRAMES;
  const totalFrames = raceFrames + closingFrames;
  const floorMaxHp = Float64Array.from(cfg.floorMaxHp);
  const totalVaultHp = cfg.floorMaxHp.reduce((a, b) => a + b, 0);

  const left = initLaneState(cfg, "left", 0x1111);
  const right = initLaneState(cfg, "right", 0x2222);

  const leftProgress = new Float32Array(raceFrames);
  const rightProgress = new Float32Array(raceFrames);
  const leftCountPerFrame = new Float64Array(raceFrames);
  const rightCountPerFrame = new Float64Array(raceFrames);
  const rightPowerPerFrame = new Float64Array(raceFrames);
  const leftBrokenPerFrame = new Uint8Array(raceFrames);
  const rightBrokenPerFrame = new Uint8Array(raceFrames);
  const leftActiveHpPerFrame = new Float64Array(raceFrames);
  const rightActiveHpPerFrame = new Float64Array(raceFrames);

  const events: ComebackEvent[] = [];
  const floorBreaks: FloorBreakVisual[] = [];
  const shockwaves: ShockwaveVisual[] = [];
  const leftSnapshots = new Map<number, LaneSnapshot>();
  const rightSnapshots = new Map<number, LaneSnapshot>();

  const dt = 1 / (VIDEO.fps * SUBSTEPS);
  let winner: ComebackSide | null = null;
  let victoryFrame = raceFrames - 1;
  let victorySubstep = SUBSTEPS - 1;

  for (let f = 0; f < raceFrames; f++) {
    if (f > 0 && winner === null) {
      for (let sub = 0; sub < SUBSTEPS; sub++) {
        const tSec = (f - 1) / VIDEO.fps + (sub + 1) * dt;
        stepLaneSubstep(
          left,
          cfg,
          "left",
          tSec,
          dt,
          f,
          (ev) => events.push(ev),
          (idx) => floorBreaks.push({ frame: f, side: "left", floorIndex: idx, y: vaultFloorY(idx) }),
          (x, y, strength) => shockwaves.push({ frame: f, side: "left", x, y, strength }),
        );
        stepLaneSubstep(
          right,
          cfg,
          "right",
          tSec,
          dt,
          f,
          (ev) => events.push(ev),
          (idx) => floorBreaks.push({ frame: f, side: "right", floorIndex: idx, y: vaultFloorY(idx) }),
          (x, y, strength) => shockwaves.push({ frame: f, side: "right", x, y, strength }),
        );

        if (right.brokenFloors >= TOWER_FLOORS || left.brokenFloors >= TOWER_FLOORS) {
          winner = right.brokenFloors >= TOWER_FLOORS ? "right" : "left";
          victoryFrame = f;
          victorySubstep = sub;
          events.push({
            frame: f,
            side: winner,
            kind: "victory",
            stageIndex: 9,
            intensity: 1,
            pitchStep: 12,
          });
          break;
        }
      }
    } else if (f > 0 && winner !== null) {
      // Gentle post-victory coasting for visual hold
      for (let sub = 0; sub < SUBSTEPS; sub++) {
        const tSec = (f - 1) / VIDEO.fps + (sub + 1) * dt;
        if (winner === "right") {
          stepLaneSubstep(right, cfg, "right", tSec, dt * 0.45, f);
        } else {
          stepLaneSubstep(left, cfg, "left", tSec, dt * 0.45, f);
        }
      }
    }

    leftProgress[f] = computeVaultProgress(left, cfg.floorMaxHp);
    rightProgress[f] = computeVaultProgress(right, cfg.floorMaxHp);
    leftCountPerFrame[f] = left.logicalCount;
    rightCountPerFrame[f] = right.logicalCount;
    rightPowerPerFrame[f] = right.titanDamage;
    leftBrokenPerFrame[f] = left.brokenFloors;
    rightBrokenPerFrame[f] = right.brokenFloors;
    leftActiveHpPerFrame[f] =
      left.brokenFloors < TOWER_FLOORS ? left.floorRemainingHp[left.brokenFloors] : 0;
    rightActiveHpPerFrame[f] =
      right.brokenFloors < TOWER_FLOORS ? right.floorRemainingHp[right.brokenFloors] : 0;
    if (f % SNAP_EVERY === 0) {
      leftSnapshots.set(f, cloneSnap(left));
      rightSnapshots.set(f, cloneSnap(right));
    }
  }

  const resolvedWinner: ComebackSide = winner ?? (rightProgress[raceFrames - 1] >= leftProgress[raceFrames - 1] ? "right" : "left");
  const earlyCheck = Math.floor(0.65 * victoryFrame);
  const earlyLeader: ComebackSide =
    leftProgress[earlyCheck] >= rightProgress[earlyCheck] ? "left" : "right";

  // Find final overtake frame where resolvedWinner takes and holds the lead
  let overtakeFrame = victoryFrame;
  for (let f = victoryFrame; f >= 1; f--) {
    const wProg = resolvedWinner === "right" ? rightProgress[f - 1] : leftProgress[f - 1];
    const lProg = resolvedWinner === "right" ? leftProgress[f - 1] : rightProgress[f - 1];
    if (wProg < lProg) {
      overtakeFrame = f;
      break;
    }
  }
  events.push({
    frame: overtakeFrame,
    side: resolvedWinner,
    kind: "overtake",
    stageIndex: 9,
    intensity: 1,
    pitchStep: 10,
  });
  events.sort((a, b) => a.frame - b.frame);

  const runnerUpRemHp =
    resolvedWinner === "right"
      ? leftActiveHpPerFrame[victoryFrame]
      : rightActiveHpPerFrame[victoryFrame];
  const runnerUpBroken =
    resolvedWinner === "right"
      ? leftBrokenPerFrame[victoryFrame]
      : rightBrokenPerFrame[victoryFrame];
  const runnerUpFinalStageRemainingRatio =
    runnerUpBroken === TOWER_FLOORS - 1
      ? runnerUpRemHp / cfg.floorMaxHp[TOWER_FLOORS - 1]
      : 1;

  const trace: VaultComebackTrace = {
    slug,
    seed: cfg.seed,
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
    floorMaxHp,
    totalVaultHp,
    leftCountPerFrame,
    rightCountPerFrame,
    rightPowerPerFrame,
    leftBrokenPerFrame,
    rightBrokenPerFrame,
    leftActiveHpPerFrame,
    rightActiveHpPerFrame,
    floorBreaks,
    shockwaves,
    leftSnapshots,
    rightSnapshots,
    config: cfg,
  };

  TRACE_CACHE.set(slug, trace);
  return trace;
}

export function reconstructLaneBallsAt(
  trace: VaultComebackTrace,
  side: ComebackSide,
  frame: number,
  fromStart = false,
): LaneMutState {
  const clamped = Math.max(0, Math.min(trace.raceFrames - 1, frame));
  const snapFrame = fromStart ? 0 : clamped - (clamped % SNAP_EVERY);
  const snaps = side === "left" ? trace.leftSnapshots : trace.rightSnapshots;
  const state = restoreSnap(snaps.get(snapFrame)!);
  const dt = 1 / (VIDEO.fps * SUBSTEPS);

  for (let f = snapFrame + 1; f <= clamped; f++) {
    const postVictory = f > trace.victoryFrame;
    if (postVictory && side !== trace.winner) break;
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      if (f === trace.victoryFrame && sub > trace.victorySubstep) break;
      const tSec = (f - 1) / VIDEO.fps + (sub + 1) * dt;
      stepLaneSubstep(state, trace.config, side, tSec, postVictory ? dt * 0.45 : dt, f);
    }
  }
  return state;
}

export function paintVaultComebackFrame(
  ctx: CanvasRenderingContext2D,
  trace: VaultComebackTrace,
  features: readonly FrameAudioFeatures[],
  frame: number,
  width = VIDEO.width,
  height = VIDEO.height,
): ReelBox[] {
  const f = Math.max(0, Math.min(trace.raceFrames - 1, frame));
  const feat = features[Math.min(features.length - 1, f)];
  const boxes: ReelBox[] = [];
  const cfg = trace.config;
  const overtaken = f >= trace.overtakeFrame;
  const won = f >= trace.victoryFrame;
  const leaderSide: ComebackSide =
    trace.rightProgress[f] >= trace.leftProgress[f] ? "right" : "left";

  // 1. Full-bleed 1080x1920 dual chamber
  drawFullBleedDualChamber(
    ctx,
    f,
    feat.kickImpulse,
    feat.bass,
    cfg.palette,
    overtaken ? trace.winner : null,
    width,
    height,
  );

  const leftState = reconstructLaneBallsAt(trace, "left", f);
  const rightState = reconstructLaneBallsAt(trace, "right", f);

  // 2. Draw all 10 vault floors across Left (x: 6..534) and Right (x: 546..1074)
  const drawLaneFloors = (
    side: ComebackSide,
    broken: number,
    activeRemHp: number,
    accent: string,
  ) => {
    const slabLeft = side === "left" ? 6 : 546;
    const slabW = 528;

    for (let idx = broken; idx < TOWER_FLOORS; idx++) {
      const y = vaultFloorY(idx);
      const maxHp = trace.floorMaxHp[idx];
      const remHp = idx === broken ? activeRemHp : maxHp;
      const hpRatio = Math.max(0, Math.min(1, remHp / maxHp));
      const isCurrent = idx === broken;

      // Dark armor base across full lane width
      ctx.fillStyle = theme.colors.comebackHudVaultEffects.floorArmor;
      ctx.fillRect(slabLeft, y, slabW, VAULT_FLOOR_THICKNESS);

      // Remaining HP neon fill bar
      ctx.fillStyle = isCurrent ? accent : theme.colors.comebackHudVaultEffects.futureFloor;
      ctx.globalAlpha = isCurrent ? 0.92 : 0.58;
      ctx.fillRect(slabLeft, y, slabW * hpRatio, VAULT_FLOOR_THICKNESS);
      ctx.globalAlpha = 1;

      // Crisp top specular edge
      ctx.fillStyle = isCurrent
        ? theme.colors.comebackHudPureWhite
        : theme.colors.comebackHudVaultEffects.futureSpecular;
      ctx.fillRect(slabLeft, y, slabW, isCurrent ? 3 : 1.5);

      // Large active-floor label; the first floor sits below the expanded hook card.
      if (isCurrent && y >= 480 && y <= 1400) {
        const textX = side === "left" ? 270 : 710;
        const tagTop = Math.max(592, y - 64);
        const hpStr = `F${idx + 1} · ${formatCompactInt(Math.ceil(remHp))} HP`;
        const tagBox: ReelBox = {
          label: `floor-hp-${side}-${idx}`,
          left: textX - 190,
          top: tagTop,
          right: textX + 190,
          bottom: tagTop + 62,
        };
        assertReelSafeBox(tagBox);
        ctx.fillStyle = theme.colors.comebackHudSurface;
        ctx.beginPath();
        ctx.roundRect(tagBox.left, tagBox.top, 380, 62, 14);
        ctx.fill();
        drawReelText(ctx, boxes, hpStr, textX, tagTop + 47, {
          size: 42,
          weight: 800,
          color: theme.colors.comebackHudInk,
          align: "center",
          maxWidth: 356,
        });
      }
    }
  };

  drawLaneFloors("left", trace.leftBrokenPerFrame[f], trace.leftActiveHpPerFrame[f], cfg.palette.leftAccent);
  drawLaneFloors("right", trace.rightBrokenPerFrame[f], trace.rightActiveHpPerFrame[f], cfg.palette.rightAccent);

  // 3. Draw shattering floor debris + shockwave rings
  for (const br of trace.floorBreaks) {
    const age = f - br.frame;
    if (age < 0 || age > 34) continue;
    const p = age / 34;
    const baseLeft = br.side === "left" ? 20 : 560;
    const color = br.side === "left" ? cfg.palette.leftAccent : cfg.palette.rightAccent;
    ctx.save();
    ctx.globalAlpha = (1 - p) * 0.9;
    ctx.fillStyle = color;
    for (let k = 0; k < 14; k++) {
      const sx = baseLeft + k * 36 + Math.sin(k * 2.1 + br.floorIndex) * age * 2.6;
      const sy = br.y + age * (3.2 + (k % 4) * 1.4) + 0.14 * age * age;
      ctx.fillRect(sx, sy, 18 * (1 - p * 0.5), 9 * (1 - p * 0.4));
    }
    ctx.restore();
  }

  for (const sw of trace.shockwaves) {
    const age = f - sw.frame;
    if (age < 0 || age > 26) continue;
    const p = age / 26;
    ctx.save();
    ctx.globalAlpha = (1 - p) * sw.strength * 0.78;
    ctx.strokeStyle = sw.side === "left"
      ? cfg.palette.leftAccent
      : theme.colors.comebackHudVaultEffects.titanShockwave;
    ctx.lineWidth = 4.5 * (1 - p) + 1.2;
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, 22 + p * 230 * sw.strength, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 4. Draw balls & Titan Hammer orb
  const drawSwarm = (s: LaneMutState, color: string) => {
    ctx.save();
    ctx.fillStyle = color;
    for (let i = 0; i < s.nDrawn; i++) {
      const x = s.bx[i];
      const y = s.by[i];
      const vy = s.bvy[i];
      const streakLen = Math.abs(vy) * 0.012;
      const streakTop = vy >= 0 ? y - streakLen : y;
      // Motion streak
      ctx.globalAlpha = 0.32;
      ctx.fillRect(x - 2.5, streakTop, 5, streakLen + 4);
      ctx.globalAlpha = 0.94;
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  drawSwarm(leftState, cfg.palette.leftAccent);

  if (cfg.rightMode === "titan-double-damage") {
    // Blazing Titan Hammer Orb with molten corona + plasma wake
    const tx = rightState.bx[0];
    const ty = rightState.by[0];
    const tvy = rightState.bvy[0];
    const r = Math.min(54, 15 + rightState.titanBounces * 2.1);

    ctx.save();
    // Vertical meteor plasma wake
    const wakeLen = Math.min(260, 40 + rightState.titanBounces * 13);
    const wakeTop = tvy >= 0 ? ty - wakeLen : ty;
    const wakeGrad = ctx.createLinearGradient(tx, wakeTop, tx, wakeTop + wakeLen);
    wakeGrad.addColorStop(
      0,
      tvy >= 0
        ? theme.colors.comebackHudVaultEffects.titanWakeClear
        : theme.colors.comebackHudVaultEffects.titanWakeBright,
    );
    wakeGrad.addColorStop(
      1,
      tvy >= 0
        ? theme.colors.comebackHudVaultEffects.titanWakeBright
        : theme.colors.comebackHudVaultEffects.titanWakeClear,
    );
    ctx.fillStyle = wakeGrad;
    ctx.fillRect(tx - r * 0.72, wakeTop, r * 1.44, wakeLen);

    // Outer corona ring
    ctx.globalAlpha = 0.35 + feat.kickImpulse * 0.35;
    ctx.fillStyle = theme.colors.comebackHudVaultEffects.titanCorona;
    ctx.beginPath();
    ctx.arc(tx, ty, r * 1.55, 0, Math.PI * 2);
    ctx.fill();

    // Solar core
    ctx.globalAlpha = 1;
    ctx.fillStyle = cfg.palette.rightAccent;
    ctx.beginPath();
    ctx.arc(tx, ty, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = theme.colors.comebackHudPureWhite;
    ctx.beginPath();
    ctx.arc(tx, ty, r * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    drawSwarm(rightState, cfg.palette.rightAccent);
  }

  // 5. Safe-zone Viral Hook Header & Bottom Progress Pills
  if (slugIsTowerLinear(trace.slug)) {
    drawHookHeaderCard(ctx, boxes, {
      highlightBadge: "1 BALL",
      hookLine1: "vs 5,000 BALLS:",
      hookLine2: "Which 10-floor vault falls first?",
      subline: "SAME VAULTS · LINEAR vs ×10",
      leftValue: `${formatCompactInt(trace.leftCountPerFrame[f])} balls`,
      leftFormula: "+600 BALLS/S",
      leftAccent: cfg.palette.leftAccent,
      rightValue: `${formatCompactInt(trace.rightCountPerFrame[f])} balls`,
      rightFormula: "×10 / 4.5 S",
      rightAccent: cfg.palette.rightAccent,
      leaderSide,
      overtaken,
    });
  } else {
    drawHookHeaderCard(ctx, boxes, {
      highlightBadge: "1 TITAN ORB",
      hookLine1: "vs 4,000 SWARM:",
      hookLine2: "×2 damage per bounce",
      subline: "SAME ARMOR · ORB vs SWARM",
      leftValue: "4,000 × 1 dmg",
      leftFormula: `${trace.leftBrokenPerFrame[f]}/10 CHAMBERS`,
      leftAccent: cfg.palette.leftAccent,
      rightValue: `${formatCompactInt(trace.rightPowerPerFrame[f])} dmg`,
      rightFormula: "×2 DMG / BOUNCE",
      rightAccent: cfg.palette.rightAccent,
      leaderSide,
      overtaken,
    });
  }

  const leftPct = Math.round(trace.leftProgress[f] * 100);
  const rightPct = Math.round(trace.rightProgress[f] * 100);
  const statusBanner = won
    ? `RIGHT WINS · ${leftPct}%:100%`
    : overtaken
      ? "RIGHT OVERTAKES!"
      : trace.leftBrokenPerFrame[f] >= 8
        ? `LEFT ${trace.leftBrokenPerFrame[f] + 1}/10 · CAN RIGHT WIN?`
        : undefined;

  drawBottomProgressPills(ctx, boxes, {
    leftLabel: `LEFT ${trace.leftBrokenPerFrame[f]}/10 · ${leftPct}%`,
    leftProgress: trace.leftProgress[f],
    leftAccent: cfg.palette.leftAccent,
    rightLabel: won
      ? "RIGHT 10/10 WIN"
      : `RIGHT ${trace.rightBrokenPerFrame[f]}/10 · ${rightPct}%`,
    rightProgress: trace.rightProgress[f],
    rightAccent: cfg.palette.rightAccent,
    statusBanner,
    bannerAccent: won || overtaken ? cfg.palette.rightAccent : undefined,
  });

  return boxes;
}

function slugIsTowerLinear(slug: VaultComebackSlug): boolean {
  return slug === "tower-linear-vs-exponential";
}
