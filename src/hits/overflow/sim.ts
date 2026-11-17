import { clamp, createRng, digestNumbers, fnv1a, FPS, H, W } from "../kit.ts";
import { HIT_SEED } from "../types.ts";
import { OVERFLOW_SPEC } from "./spec.ts";

/**
 * OverflowArena simulation.
 * One big ball in a sealed full-screen chamber. A spinning turbine in the middle splits a ball on
 * every hit. Balls shrink as they multiply so the chamber visibly fills. At 10,000 balls the walls
 * crack and the balls spill out. The whole run is pre-baked into typed arrays.
 */

export const OVERFLOW_TARGET = 10_000;
export const SCENE_FRAMES = OVERFLOW_SPEC.sceneFrames;

/** Ball radius shrinks with the live count: r = R0 / N^R_EXP. */
export const R0 = 112;
export const R_EXP = 0.31;
export const R_MIN = 4.5;
export const BALL_SPEED = 680;

export const ROTOR = {
  cx: W / 2,
  cy: 960,
  bars: 3,
  arm: 380,
  half: 14,
  omega: 1.15,
  theta0: 0.3,
} as const;

export const SUBSTEPS = 2;
export const POS_SCALE_X = 60; // 1080 * 60 = 64,800 fits Uint16
export const POS_SCALE_Y = 34; // 1920 * 34 = 65,280 fits Uint16
export const BUCKETS = 6;
export const CRACK_FRAMES = 36;
const SPILL_SPEED = 520;
const SPLIT_COOLDOWN_SUBSTEPS = 8;
const CAPACITY = OVERFLOW_TARGET + 64;

export interface SplitEvent {
  frame: number;
  t: number;
  x: number;
  y: number;
  /** Ball count after this split. */
  n: number;
}

export interface OverflowTrace {
  seed: number;
  sceneFrames: number;
  /** Balls on screen at the start of each frame. */
  counts: Uint16Array;
  /** Ball radius at each frame (px). */
  radius: Float32Array;
  /** Index of the first ball of each frame in xs/ys/bucket; length sceneFrames + 1. */
  offsets: Uint32Array;
  xs: Uint16Array;
  ys: Uint16Array;
  bucket: Uint8Array;
  splits: SplitEvent[];
  firstSplitFrame: number;
  /** First frame that shows 10,000 balls. The walls start to crack here. */
  overflowFrame: number;
  /** Frame at which the walls are gone and the balls spill. */
  openFrame: number;
}

export function ballRadius(n: number): number {
  return clamp(R0 * Math.max(1, n) ** -R_EXP, R_MIN, R0);
}

export function rotorAngle(frame: number): number {
  return ROTOR.theta0 + (ROTOR.omega * frame) / FPS;
}

export function frameRange(trace: OverflowTrace, frame: number): { start: number; end: number } {
  const f = clamp(frame, 0, trace.sceneFrames - 1);
  return { start: trace.offsets[f], end: trace.offsets[f + 1] };
}

export function simulateOverflow(seed: number = HIT_SEED): OverflowTrace {
  const rng = createRng(seed);
  const dt = 1 / (FPS * SUBSTEPS);

  const px = new Float64Array(CAPACITY);
  const py = new Float64Array(CAPACITY);
  const vx = new Float64Array(CAPACITY);
  const vy = new Float64Array(CAPACITY);
  const cool = new Int16Array(CAPACITY);
  const ids = new Uint32Array(CAPACITY);
  let n = 1;
  let nextId = 1;

  // Start: one big ball up-left, heading toward the turbine with a small seeded deviation.
  px[0] = 250;
  py[0] = 620;
  const aim = Math.atan2(ROTOR.cy - py[0], ROTOR.cx - px[0]) + rng.range(-0.2, 0.2);
  vx[0] = Math.cos(aim) * BALL_SPEED;
  vy[0] = Math.sin(aim) * BALL_SPEED;
  ids[0] = 0;

  const counts = new Uint16Array(SCENE_FRAMES);
  const radiusArr = new Float32Array(SCENE_FRAMES);
  const offsets = new Uint32Array(SCENE_FRAMES + 1);
  const MAX_ENTRIES = 3_400_000;
  const xs = new Uint16Array(MAX_ENTRIES);
  const ys = new Uint16Array(MAX_ENTRIES);
  const bucket = new Uint8Array(MAX_ENTRIES);
  let used = 0;

  const splits: SplitEvent[] = [];
  let firstSplitFrame = -1;
  let overflowFrame = -1;
  let openFrame = -1;
  let peak = 1;
  let walls = true;

  // spatial grid, sized for the smallest radius
  const GRID_MAX = 140 * 240;
  const head = new Int32Array(GRID_MAX);
  const next = new Int32Array(CAPACITY);

  const cosines = new Float64Array(ROTOR.bars);
  const sines = new Float64Array(ROTOR.bars);

  for (let frame = 0; frame < SCENE_FRAMES; frame++) {
    // ---- record this frame ----
    offsets[frame] = used;
    counts[frame] = n;
    peak = Math.max(peak, n);
    radiusArr[frame] = ballRadius(peak);
    for (let i = 0; i < n; i++) {
      xs[used] = Math.round(clamp(px[i], 0, W) * POS_SCALE_X);
      ys[used] = Math.round(clamp(py[i], 0, H) * POS_SCALE_Y);
      bucket[used] = ids[i] % BUCKETS;
      used++;
    }

    // ---- step ----
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      const tNow = (frame + sub / SUBSTEPS) / FPS;
      const r = ballRadius(peak);
      const theta = rotorAngle(frame + sub / SUBSTEPS);
      for (let b = 0; b < ROTOR.bars; b++) {
        const a = theta + (b * Math.PI) / ROTOR.bars;
        cosines[b] = Math.cos(a);
        sines[b] = Math.sin(a);
      }

      for (let i = 0; i < n; i++) {
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
        if (cool[i] > 0) cool[i]--;
      }

      // walls
      if (walls) {
        for (let i = 0; i < n; i++) {
          if (px[i] < r) {
            px[i] = r;
            if (vx[i] < 0) vx[i] = -vx[i];
          } else if (px[i] > W - r) {
            px[i] = W - r;
            if (vx[i] > 0) vx[i] = -vx[i];
          }
          if (py[i] < r) {
            py[i] = r;
            if (vy[i] < 0) vy[i] = -vy[i];
          } else if (py[i] > H - r) {
            py[i] = H - r;
            if (vy[i] > 0) vy[i] = -vy[i];
          }
        }
      }

      // turbine bars
      const reach = ROTOR.arm + r + 4;
      const count0 = n;
      for (let i = 0; i < count0; i++) {
        const dx = px[i] - ROTOR.cx;
        const dy = py[i] - ROTOR.cy;
        if (dx * dx + dy * dy > reach * reach) continue;
        for (let b = 0; b < ROTOR.bars; b++) {
          const c = cosines[b];
          const s = sines[b];
          const lx = c * dx + s * dy;
          const ly = -s * dx + c * dy;
          const qx = clamp(lx, -ROTOR.arm, ROTOR.arm);
          const qy = clamp(ly, -ROTOR.half, ROTOR.half);
          const ddx = lx - qx;
          const ddy = ly - qy;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 >= r * r) continue;
          let nlx: number;
          let nly: number;
          let depth: number;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2);
            nlx = ddx / d;
            nly = ddy / d;
            depth = r - d;
          } else {
            nlx = 0;
            nly = ly >= 0 ? 1 : -1;
            depth = r + ROTOR.half - Math.abs(ly);
          }
          const nx = c * nlx - s * nly;
          const ny = s * nlx + c * nly;
          px[i] += nx * depth;
          py[i] += ny * depth;
          const cxw = ROTOR.cx + c * qx - s * qy;
          const cyw = ROTOR.cy + s * qx + c * qy;
          const ux = -ROTOR.omega * (cyw - ROTOR.cy);
          const uy = ROTOR.omega * (cxw - ROTOR.cx);
          const vn = (vx[i] - ux) * nx + (vy[i] - uy) * ny;
          if (vn < 0) {
            vx[i] -= 2 * vn * nx;
            vy[i] -= 2 * vn * ny;
            if (cool[i] === 0 && n < OVERFLOW_TARGET && walls) {
              // split: parent and child leave in two directions 0.9 rad apart
              const j = n++;
              const ang = 0.45;
              const ca = Math.cos(ang);
              const sa = Math.sin(ang);
              const ovx = vx[i];
              const ovy = vy[i];
              vx[i] = ovx * ca + ovy * sa;
              vy[i] = -ovx * sa + ovy * ca;
              vx[j] = ovx * ca - ovy * sa;
              vy[j] = ovx * sa + ovy * ca;
              px[j] = px[i] + nx * r * 0.5;
              py[j] = py[i] + ny * r * 0.5;
              cool[i] = SPLIT_COOLDOWN_SUBSTEPS;
              cool[j] = SPLIT_COOLDOWN_SUBSTEPS;
              ids[j] = nextId++;
              if (firstSplitFrame < 0) firstSplitFrame = frame;
              splits.push({ frame, t: tNow, x: px[i], y: py[i], n });
            }
            break; // one bar per ball per substep
          }
        }
      }

      // ball-ball collisions on a uniform grid
      {
        const cs = Math.max(2 * r, 2);
        const gx = Math.ceil(W / cs) + 2;
        const gy = Math.ceil(H / cs) + 2;
        const cells = gx * gy;
        if (cells <= GRID_MAX) {
          head.fill(-1, 0, cells);
          for (let i = 0; i < n; i++) {
            const cx = Math.floor((px[i] + cs) / cs);
            const cy = Math.floor((py[i] + cs) / cs);
            if (cx < 0 || cx >= gx || cy < 0 || cy >= gy) {
              next[i] = -2;
              continue;
            }
            const cell = cx + cy * gx;
            next[i] = head[cell];
            head[cell] = i;
          }
          const diam = 2 * r;
          const diam2 = diam * diam;
          for (let i = 0; i < n; i++) {
            if (next[i] === -2) continue;
            const cx = Math.floor((px[i] + cs) / cs);
            const cy = Math.floor((py[i] + cs) / cs);
            for (let oy = -1; oy <= 1; oy++) {
              const yy = cy + oy;
              if (yy < 0 || yy >= gy) continue;
              for (let ox = -1; ox <= 1; ox++) {
                const xx = cx + ox;
                if (xx < 0 || xx >= gx) continue;
                for (let j = head[xx + yy * gx]; j >= 0; j = next[j]) {
                  if (j <= i) continue;
                  const ddx = px[i] - px[j];
                  const ddy = py[i] - py[j];
                  const d2 = ddx * ddx + ddy * ddy;
                  if (d2 >= diam2 || d2 === 0) continue;
                  const d = Math.sqrt(d2);
                  const nx = ddx / d;
                  const ny = ddy / d;
                  const push = (diam - d) * 0.5;
                  px[i] += nx * push;
                  py[i] += ny * push;
                  px[j] -= nx * push;
                  py[j] -= ny * push;
                  const rel = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
                  if (rel < 0) {
                    vx[i] -= rel * nx;
                    vy[i] -= rel * ny;
                    vx[j] += rel * nx;
                    vy[j] += rel * ny;
                  }
                }
              }
            }
          }
        }
      }

      // dense pushes can nudge a ball into a wall: clamp again so containment is exact
      if (walls) {
        for (let i = 0; i < n; i++) {
          px[i] = clamp(px[i], r, W - r);
          py[i] = clamp(py[i], r, H - r);
        }
      }

      // keep speeds in a lively band
      const lo = BALL_SPEED * 0.6;
      const hi = BALL_SPEED * 1.6;
      for (let i = 0; i < n; i++) {
        const sp = Math.hypot(vx[i], vy[i]);
        if (sp < lo) {
          const k = sp > 1e-6 ? lo / sp : 0;
          if (k === 0) {
            vx[i] = lo;
          } else {
            vx[i] *= k;
            vy[i] *= k;
          }
        } else if (sp > hi) {
          const k = hi / sp;
          vx[i] *= k;
          vy[i] *= k;
        }
      }

      // overflow bookkeeping
      if (overflowFrame < 0 && n >= OVERFLOW_TARGET) overflowFrame = frame + 1;
      if (walls && overflowFrame >= 0 && frame + 1 >= overflowFrame + CRACK_FRAMES) {
        walls = false;
        openFrame = frame + 1;
        for (let i = 0; i < n; i++) {
          const ox = px[i] - W / 2;
          const oy = py[i] - H / 2;
          const len = Math.hypot(ox, oy) || 1;
          const boost = SPILL_SPEED * (0.8 + 0.5 * rng.next());
          vx[i] += (ox / len) * boost;
          vy[i] += (oy / len) * boost;
        }
      }

      // balls that left the open chamber are gone
      if (!walls) {
        let i = 0;
        while (i < n) {
          if (px[i] < -r - 30 || px[i] > W + r + 30 || py[i] < -r - 30 || py[i] > H + r + 30) {
            n--;
            px[i] = px[n];
            py[i] = py[n];
            vx[i] = vx[n];
            vy[i] = vy[n];
            cool[i] = cool[n];
            ids[i] = ids[n];
          } else {
            i++;
          }
        }
      }
    }
  }
  offsets[SCENE_FRAMES] = used;

  return {
    seed,
    sceneFrames: SCENE_FRAMES,
    counts,
    radius: radiusArr,
    offsets,
    xs: xs.slice(0, used),
    ys: ys.slice(0, used),
    bucket: bucket.slice(0, used),
    splits,
    firstSplitFrame,
    overflowFrame,
    openFrame,
  };
}

export function digestOverflow(trace: OverflowTrace): string {
  return fnv1a(
    [
      digestNumbers(trace.counts, 0),
      digestNumbers(trace.xs.subarray(0, 6000), 0),
      digestNumbers(trace.ys.subarray(0, 6000), 0),
      String(trace.overflowFrame),
      String(trace.openFrame),
      String(trace.splits.length),
      String(trace.seed),
    ].join("|"),
  );
}
