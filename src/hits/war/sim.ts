import { createRng, digestNumbers, fnv1a, FPS, H, PALETTE, W } from "../kit.ts";
import { HIT_SEED } from "../types.ts";

export { H, W };

/**
 * ColourWarV4 simulation: a 45 x 80 board of 24 px cells, four colours, one ball each.
 * Balls paint every cell whose centre is within the capture radius. The ONLY bonus is the underdog
 * rule on the rule line: at 5, 10, 15 and 20 s the colour with the smallest share doubles its balls.
 *
 * The trace is pre-baked (ownership per frame, ball positions per frame, capture lists, bounce events),
 * so the painter and the audio only read it. The main loop uses nothing but + - * / and sqrt (exact
 * IEEE operations); the only trigonometry is two constants, so the trace is identical on every machine.
 */

export const CELL = 24;
export const COLS = W / CELL; // 45
export const ROWS = H / CELL; // 80
export const CELLS = COLS * ROWS; // 3600
export const TEAM_COUNT = 4;
export const TEAM_NAMES = ["TEAL", "AMBER", "VIOLET", "CORAL"] as const;
export const TEAM_COLORS = [PALETTE.teal, PALETTE.amber, PALETTE.violet, PALETTE.coral] as const;

export const SCENE_SECONDS = 24;
export const SCENE_FRAMES = SCENE_SECONDS * FPS; // 1440
/** The clock reaches 0:00 here (22.4 s); the board is frozen from this frame on. */
export const CLOCK_ZERO_FRAME = Math.round(22.4 * FPS); // 1344
/** The underdog rule fires at the start of these frames (5, 10, 15, 20 s). */
export const TICK_FRAMES = [300, 600, 900, 1200] as const;

export const BALL_R = 16;
/** Upper bound of balls ever alive: 1 team doubling at every tick gives 16 + 3 others. */
export const MAX_BALLS = 19;
export const DOT_COUNT = 120;

export interface WarParams {
  /** Ball speed in px per second (kept constant after every bounce). */
  speed: number;
  /** A cell is painted when its centre is this close to a ball centre. */
  captureR: number;
  /** Physics steps per frame, so a 10 px move never skips over a 32 px collision. */
  substeps: number;
  /** Corner start inset in px. */
  inset: number;
  /** Heading scatter around "toward the middle": tan of the half angle (0.2 is about 22 degrees). */
  aimK: number;
  /** Which corner each colour starts in: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right. */
  cornerOrder: readonly number[];
}

/**
 * The tuned constants. Seeds are never touched; pacing is tuned here.
 * Scanned over speed 775..1100, inset 100..170, heading scatter 0.05..0.5 and all 24 corner assignments
 * (about 1,100 runs) for: a closing gap of 1.2 to 5 points, at least 3 lead changes in the last 10 s that
 * each last at least 0.4 s, the last one before 21.8 s so the viewer can read it, a mostly full board at
 * the end, no colour under 15 percent, and every underdog at least 1.0 point below the next colour at its
 * tick (more than one rounding step, so the integer labels on screen always show why it was picked).
 * Small scatter keeps the opening a clean X: all four balls converge on the middle at about 1 s and
 * collide there. At the brief's 600 px/s the board was still 10.6 percent dark at the end and 65 percent
 * dark at 5 s, which felt sluggish, so the balls run at 900 px/s.
 */
export const WAR_PARAMS: WarParams = {
  speed: 900,
  captureR: 34,
  substeps: 4,
  inset: 160,
  aimK: 0.05,
  // teal top-right, amber bottom-left, violet top-left, coral bottom-right
  cornerOrder: [1, 2, 0, 3],
};

// cos and sin of half the 25 degree split angle, as literals so no trig runs in the simulation
const COS_HALF_SPLIT = 0.976296007119933; // cos(12.5 deg)
const SIN_HALF_SPLIT = 0.2164396139381029; // sin(12.5 deg)

export interface WarTrace {
  seed: number;
  frames: number;
  /** frames x CELLS: 0 unowned, 1..4 owned by team 0..3. */
  own: Uint8Array;
  /** frames x TEAM_COUNT: cells owned per team (a cache of `own`). */
  counts: Uint16Array;
  nBalls: number;
  ballTeam: Uint8Array;
  /** First frame a ball exists. Balls 0..3 are born at frame 0; the rest are underdog splits. */
  ballBorn: Uint16Array;
  /** frames x nBalls x 2: ball centre (x, y); balls not yet born hold 0. */
  pos: Float32Array;
  /** capStart[f]..capStart[f + 1] indexes the cells whose owner changed during frame f. */
  capStart: Uint32Array;
  capCell: Uint16Array;
  capTeam: Uint8Array;
  /** Underdog ticks: which team doubled, and its cells just before the tick. */
  tickTeam: Uint8Array;
  tickCells: Uint16Array;
  /** Bounce events (ball against ball, ball against the canvas edge). */
  bounceFrame: Uint16Array;
  bounceX: Float32Array;
  bounceY: Float32Array;
  /** 0 ball-ball, 1 wall. */
  bounceKind: Uint8Array;
  /** Closing speed of a ball-ball bounce, 0 for walls. */
  bouncePower: Float32Array;
  /** Ambient dots: x0, y0, vx, vy, size, phase per dot. */
  dots: Float32Array;
  winner: number;
}

/** The colour with the smallest share; ties go to the lowest team index. */
export function pickUnderdog(counts: ArrayLike<number>): number {
  let best = 0;
  for (let t = 1; t < counts.length; t++) if (counts[t] < counts[best]) best = t;
  return best;
}

export function simulateWar(seed: number = HIT_SEED, overrides: Partial<WarParams> = {}): WarTrace {
  const P: WarParams = { ...WAR_PARAMS, ...overrides };
  const rng = createRng(seed);
  const dt = 1 / (FPS * P.substeps);
  const minDist = BALL_R * 2;
  const minDist2 = minDist * minDist;
  const capR2 = P.captureR * P.captureR;

  const bx = new Float64Array(MAX_BALLS);
  const by = new Float64Array(MAX_BALLS);
  const bvx = new Float64Array(MAX_BALLS);
  const bvy = new Float64Array(MAX_BALLS);
  const bTeam = new Uint8Array(MAX_BALLS);
  const bBorn = new Uint16Array(MAX_BALLS);
  let n = 0;

  // one ball per colour, one per corner, heading toward the middle with a seeded scatter
  const corners: [number, number][] = [
    [P.inset, P.inset],
    [W - P.inset, P.inset],
    [P.inset, H - P.inset],
    [W - P.inset, H - P.inset],
  ];
  for (let team = 0; team < TEAM_COUNT; team++) {
    const [sx, sy] = corners[P.cornerOrder[team]];
    const dx = W / 2 - sx;
    const dy = H / 2 - sy;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / len;
    const uy = dy / len;
    const k = rng.range(-P.aimK, P.aimK);
    const c = (1 - k * k) / (1 + k * k);
    const s = (2 * k) / (1 + k * k);
    bx[n] = sx;
    by[n] = sy;
    bvx[n] = (ux * c - uy * s) * P.speed;
    bvy[n] = (ux * s + uy * c) * P.speed;
    bTeam[n] = team;
    bBorn[n] = 0;
    n++;
  }

  const cur = new Uint8Array(CELLS);
  const own = new Uint8Array(SCENE_FRAMES * CELLS);
  const counts = new Uint16Array(SCENE_FRAMES * TEAM_COUNT);
  const posTmp = new Float32Array(SCENE_FRAMES * MAX_BALLS * 2);
  const capStart = new Uint32Array(SCENE_FRAMES + 1);
  const capCellList: number[] = [];
  const capTeamList: number[] = [];
  const tickTeam = new Uint8Array(TICK_FRAMES.length);
  const tickCells = new Uint16Array(TICK_FRAMES.length);
  const bounceFrame: number[] = [];
  const bounceX: number[] = [];
  const bounceY: number[] = [];
  const bounceKind: number[] = [];
  const bouncePower: number[] = [];

  const normalise = (i: number): void => {
    const sp = Math.sqrt(bvx[i] * bvx[i] + bvy[i] * bvy[i]);
    if (sp > 0) {
      bvx[i] = (bvx[i] / sp) * P.speed;
      bvy[i] = (bvy[i] / sp) * P.speed;
    }
  };

  const wallBounce = (i: number, f: number): void => {
    let hit = false;
    if (bx[i] < BALL_R) {
      bx[i] = BALL_R;
      bvx[i] = Math.abs(bvx[i]);
      hit = true;
    } else if (bx[i] > W - BALL_R) {
      bx[i] = W - BALL_R;
      bvx[i] = -Math.abs(bvx[i]);
      hit = true;
    }
    if (by[i] < BALL_R) {
      by[i] = BALL_R;
      bvy[i] = Math.abs(bvy[i]);
      hit = true;
    } else if (by[i] > H - BALL_R) {
      by[i] = H - BALL_R;
      bvy[i] = -Math.abs(bvy[i]);
      hit = true;
    }
    if (hit) {
      bounceFrame.push(f);
      bounceX.push(bx[i]);
      bounceY.push(by[i]);
      bounceKind.push(1);
      bouncePower.push(0);
    }
  };

  const paintAround = (i: number): void => {
    const c0 = Math.max(0, Math.floor((bx[i] - P.captureR) / CELL));
    const c1 = Math.min(COLS - 1, Math.floor((bx[i] + P.captureR) / CELL));
    const r0 = Math.max(0, Math.floor((by[i] - P.captureR) / CELL));
    const r1 = Math.min(ROWS - 1, Math.floor((by[i] + P.captureR) / CELL));
    const mark = bTeam[i] + 1;
    for (let r = r0; r <= r1; r++) {
      const cy = (r + 0.5) * CELL - by[i];
      for (let c = c0; c <= c1; c++) {
        const cx = (c + 0.5) * CELL - bx[i];
        if (cx * cx + cy * cy <= capR2) cur[r * COLS + c] = mark;
      }
    }
  };

  let step = 0;
  for (let f = 0; f < SCENE_FRAMES; f++) {
    capStart[f] = capCellList.length;
    if (f > 0 && f <= CLOCK_ZERO_FRAME) {
      const tickIndex = (TICK_FRAMES as readonly number[]).indexOf(f);
      if (tickIndex >= 0) {
        // the underdog rule: the smallest share just before the tick doubles its balls
        const before = counts.subarray((f - 1) * TEAM_COUNT, f * TEAM_COUNT);
        const underdog = pickUnderdog(before);
        tickTeam[tickIndex] = underdog;
        tickCells[tickIndex] = before[underdog];
        const parents = n;
        for (let i = 0; i < parents; i++) {
          if (bTeam[i] !== underdog) continue;
          if (n >= MAX_BALLS) throw new Error("ball cap exceeded");
          const vx = bvx[i];
          const vy = bvy[i];
          bx[n] = bx[i];
          by[n] = by[i];
          bvx[n] = vx * COS_HALF_SPLIT + vy * SIN_HALF_SPLIT; // rotated by -12.5 degrees
          bvy[n] = -vx * SIN_HALF_SPLIT + vy * COS_HALF_SPLIT;
          bvx[i] = vx * COS_HALF_SPLIT - vy * SIN_HALF_SPLIT; // rotated by +12.5 degrees
          bvy[i] = vx * SIN_HALF_SPLIT + vy * COS_HALF_SPLIT;
          bTeam[n] = underdog;
          bBorn[n] = f;
          n++;
        }
      }
      for (let s = 0; s < P.substeps; s++) {
        for (let i = 0; i < n; i++) {
          bx[i] += bvx[i] * dt;
          by[i] += bvy[i] * dt;
          wallBounce(i, f);
        }
        // different colours bounce off each other: an equal-mass elastic exchange along the contact line
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            if (bTeam[i] === bTeam[j]) continue;
            const dx = bx[j] - bx[i];
            const dy = by[j] - by[i];
            const d2 = dx * dx + dy * dy;
            if (d2 >= minDist2 || d2 === 0) continue;
            const d = Math.sqrt(d2);
            const nx = dx / d;
            const ny = dy / d;
            const closing = (bvx[i] - bvx[j]) * nx + (bvy[i] - bvy[j]) * ny;
            const push = (minDist - d) / 2;
            bx[i] -= nx * push;
            by[i] -= ny * push;
            bx[j] += nx * push;
            by[j] += ny * push;
            if (closing > 0) {
              bvx[i] -= closing * nx;
              bvy[i] -= closing * ny;
              bvx[j] += closing * nx;
              bvy[j] += closing * ny;
              normalise(i);
              normalise(j);
              bounceFrame.push(f);
              bounceX.push((bx[i] + bx[j]) / 2);
              bounceY.push((by[i] + by[j]) / 2);
              bounceKind.push(0);
              bouncePower.push(closing);
            }
            wallBounce(i, f);
            wallBounce(j, f);
          }
        }
        // paint; the start index rotates so no colour always wins a cell two balls reach in the same step
        for (let k = 0; k < n; k++) paintAround((k + step) % n);
        step++;
      }
    }

    // record the frame
    own.set(cur, f * CELLS);
    if (f > 0) {
      const base = f * CELLS;
      const prev = base - CELLS;
      for (let i = 0; i < CELLS; i++) {
        if (own[base + i] !== own[prev + i]) {
          capCellList.push(i);
          capTeamList.push(own[base + i] - 1);
        }
      }
    }
    const c4 = f * TEAM_COUNT;
    for (let i = 0; i < CELLS; i++) {
      const o = cur[i];
      if (o > 0) counts[c4 + o - 1]++;
    }
    for (let i = 0; i < n; i++) {
      posTmp[(f * MAX_BALLS + i) * 2] = bx[i];
      posTmp[(f * MAX_BALLS + i) * 2 + 1] = by[i];
    }
  }
  capStart[SCENE_FRAMES] = capCellList.length;

  const pos = new Float32Array(SCENE_FRAMES * n * 2);
  for (let f = 0; f < SCENE_FRAMES; f++) {
    for (let i = 0; i < n; i++) {
      pos[(f * n + i) * 2] = posTmp[(f * MAX_BALLS + i) * 2];
      pos[(f * n + i) * 2 + 1] = posTmp[(f * MAX_BALLS + i) * 2 + 1];
    }
  }

  // ambient dots: slow drifters, deterministic from the seed and the frame number
  const dotRng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const dots = new Float32Array(DOT_COUNT * 6);
  for (let i = 0; i < DOT_COUNT; i++) {
    dots[i * 6] = dotRng.range(0, W);
    dots[i * 6 + 1] = dotRng.range(0, H);
    dots[i * 6 + 2] = dotRng.range(-24, 24); // px per second
    dots[i * 6 + 3] = dotRng.range(-34, 8); // a slight upward drift
    dots[i * 6 + 4] = dotRng.range(2, 5.2);
    dots[i * 6 + 5] = dotRng.range(0, 6.28);
  }

  const finalCounts = counts.subarray(CLOCK_ZERO_FRAME * TEAM_COUNT, (CLOCK_ZERO_FRAME + 1) * TEAM_COUNT);
  let winner = 0;
  for (let t = 1; t < TEAM_COUNT; t++) if (finalCounts[t] > finalCounts[winner]) winner = t;

  return {
    seed,
    frames: SCENE_FRAMES,
    own,
    counts,
    nBalls: n,
    ballTeam: bTeam.slice(0, n),
    ballBorn: bBorn.slice(0, n),
    pos,
    capStart,
    capCell: Uint16Array.from(capCellList),
    capTeam: Uint8Array.from(capTeamList),
    tickTeam,
    tickCells,
    bounceFrame: Uint16Array.from(bounceFrame),
    bounceX: Float32Array.from(bounceX),
    bounceY: Float32Array.from(bounceY),
    bounceKind: Uint8Array.from(bounceKind),
    bouncePower: Float32Array.from(bouncePower),
    dots,
    winner,
  };
}

export function digestWar(trace: WarTrace): string {
  return fnv1a(
    [
      String(trace.seed),
      digestNumbers(trace.own, 0),
      digestNumbers(trace.counts, 0),
      digestNumbers(trace.pos, 1),
      digestNumbers(trace.ballTeam, 0),
      digestNumbers(trace.ballBorn, 0),
      digestNumbers(trace.capCell, 0),
      digestNumbers(trace.tickTeam, 0),
      digestNumbers(trace.bounceFrame, 0),
      digestNumbers(trace.dots, 1),
    ].join("|"),
  );
}

/** Number of live balls per team at a frame. */
export function ballCountsAt(trace: WarTrace, frame: number): number[] {
  const out = new Array<number>(TEAM_COUNT).fill(0);
  for (let i = 0; i < trace.nBalls; i++) if (trace.ballBorn[i] <= frame) out[trace.ballTeam[i]]++;
  return out;
}

/** Cells per team at a frame, read from the cached counts. */
export function cellsAt(trace: WarTrace, frame: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < TEAM_COUNT; t++) out.push(trace.counts[frame * TEAM_COUNT + t]);
  return out;
}
