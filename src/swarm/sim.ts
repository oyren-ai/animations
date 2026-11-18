import { VIDEO } from "../settings.ts";

/**
 * Deterministic cyclic-chase swarm engine shared by every swarm composition.
 *
 * The engine only knows a rules matrix (who converts whom) and a few physical
 * knobs. Names, colours, icons and sounds live in `themes.ts` (the "skin"), so
 * a new game is a new matrix plus a new skin. Everything here is a pure
 * function of the config: a mulberry32 stream, a fixed 1/fps timestep, and
 * arithmetic that is exactly rounded (+ - * / sqrt) so Node and the renderer's
 * Chrome replay the same run bit for bit.
 */

export const SWARM_FPS = VIDEO.fps;
export const SWARM_DT = 1 / SWARM_FPS;
/** Every clip ends on exactly three seconds of winner caption. */
export const SWARM_HOLD_FRAMES = VIDEO.fps * 3;
/** Playfield in its own coordinates; the painter places it on the canvas. */
export const SWARM_ARENA = { width: 980, height: 1090 } as const;

/** `rules[a][b] === 1` means type `a` converts type `b` on contact. */
export type SwarmRules = readonly (readonly number[])[];

export interface SwarmPhysics {
  /** Cruising speed in px/s. */
  speed: number;
  /** Extra speed fraction while a prey is in sight. */
  chaseBoost: number;
  /** Sight radius in px for both prey and predators. */
  sight: number;
  /** Steering response in 1/s. */
  steerRate: number;
  /** Weight of the random heading noise. */
  wander: number;
  /** Weight of keeping the current heading. */
  holdWeight: number;
  chaseWeight: number;
  fleeWeight: number;
  separationWeight: number;
  /** Distance from a wall (px) inside which sprites are pushed back in. */
  wallMargin: number;
  wallWeight: number;
  /** Seconds before the anti-stall aggression ramp starts. */
  rampStartSec: number;
  /** Chaser speed (and sight) growth per second once the ramp runs. */
  rampPerSec: number;
}

export interface SwarmConfig {
  /** Stable id, used as part of the cache key. */
  readonly id: string;
  readonly seed: number;
  readonly count: number;
  readonly types: number;
  readonly rules: SwarmRules;
  /** Sprite radius in px; two sprites touch when closer than twice this. */
  readonly radius: number;
  readonly arena: { readonly width: number; readonly height: number };
  readonly physics: SwarmPhysics;
  /** The run is cut here if no type has won yet (the ramp makes this very rare). */
  readonly maxPlayFrames: number;
  readonly holdFrames: number;
}

export const DEFAULT_SWARM_PHYSICS: SwarmPhysics = {
  speed: 55,
  chaseBoost: 0.1,
  sight: 130,
  steerRate: 5,
  wander: 0.35,
  holdWeight: 1,
  chaseWeight: 1.2,
  fleeWeight: 1.4,
  separationWeight: 1.1,
  wallMargin: 70,
  wallWeight: 1.6,
  rampStartSec: 26,
  rampPerSec: 0.03,
};

/** Type `i` beats the next `beatsEach` types around the circle (mod `types`). */
export function cyclicRules(types: number, beatsEach: number): number[][] {
  return Array.from({ length: types }, (_, a) =>
    Array.from({ length: types }, (_, b) => {
      const d = (b - a + types) % types;
      return d >= 1 && d <= beatsEach ? 1 : 0;
    }),
  );
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One contact: `by` converted `sprite` from `loser` into `winner` at the start of `frame`. */
export interface SwarmEvent {
  frame: number;
  sprite: number;
  by: number;
  x: number;
  y: number;
  winner: number;
  loser: number;
}

export interface SwarmTrace {
  readonly config: SwarmConfig;
  readonly seed: number;
  readonly count: number;
  readonly types: number;
  /** First frame on which a single type remains (or the cut-off frame). */
  readonly winFrame: number;
  /** `winFrame + holdFrames`: the whole clip. */
  readonly totalFrames: number;
  readonly winner: number;
  /** False only if `maxPlayFrames` was reached with several types alive. */
  readonly finished: boolean;
  /** Frame-major snapshots, `frame * count + sprite`. Empty when recorded without positions. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly angle: Float32Array;
  readonly type: Uint8Array;
  /** `frame * types + type`; always sums to `count`. */
  readonly counts: Uint16Array;
  readonly events: readonly SwarmEvent[];
  /** `eventStart[f]` is the index of the first event with `frame >= f`; length `totalFrames + 1`. */
  readonly eventStart: Uint32Array;
}

const traceCache = new Map<string, SwarmTrace>();

function spawnSprites(
  config: SwarmConfig,
  rand: () => number,
  px: Float64Array,
  py: Float64Array,
  type: Uint8Array,
) {
  const { count, types, radius: r } = config;
  const { width, height } = config.arena;
  const minGap = 2.4 * r;
  for (let i = 0; i < count; i++) {
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 40; tries++) {
      x = r + rand() * (width - 2 * r);
      y = r + rand() * (height - 2 * r);
      let clear = true;
      for (let j = 0; j < i && clear; j++) {
        const dx = px[j] - x;
        const dy = py[j] - y;
        clear = dx * dx + dy * dy >= minGap * minGap;
      }
      if (clear) break;
    }
    px[i] = x;
    py[i] = y;
  }
  // Even split of types, then a seeded Fisher-Yates shuffle.
  for (let i = 0; i < count; i++) type[i] = i % types;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = type[i];
    type[i] = type[j];
    type[j] = tmp;
  }
}

export function simulateSwarm(
  config: SwarmConfig,
  options: { record?: boolean } = {},
): SwarmTrace {
  const record = options.record ?? true;
  const key = JSON.stringify(config) + (record ? "" : "|lite");
  const cached = traceCache.get(key);
  if (cached) return cached;
  const trace = runSwarm(config, record);
  traceCache.set(key, trace);
  return trace;
}

function runSwarm(config: SwarmConfig, record: boolean): SwarmTrace {
  const { count: N, types: K, radius: r, physics: phys } = config;
  const W = config.arena.width;
  const H = config.arena.height;
  const dt = SWARM_DT;
  const rand = mulberry32(config.seed);

  const beats = new Uint8Array(K * K);
  for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) beats[a * K + b] = config.rules[a][b] ? 1 : 0;

  const px = new Float64Array(N);
  const py = new Float64Array(N);
  const vx = new Float64Array(N);
  const vy = new Float64Array(N);
  const nvx = new Float64Array(N);
  const nvy = new Float64Array(N);
  const heading = new Float64Array(N);
  const personal = new Float64Array(N);
  const type = new Uint8Array(N);
  spawnSprites(config, rand, px, py, type);
  for (let i = 0; i < N; i++) {
    // Rejection-sampled unit direction: Math.sin/cos differ in the last bit
    // between Node and Chrome, which would fork the run, so the simulation
    // loop stays trig-free (sqrt is exactly rounded everywhere).
    let dx = 0;
    let dy = 0;
    let d2 = 0;
    do {
      dx = rand() * 2 - 1;
      dy = rand() * 2 - 1;
      d2 = dx * dx + dy * dy;
    } while (d2 > 1 || d2 < 1e-6);
    const inv = 1 / Math.sqrt(d2);
    vx[i] = dx * inv * phys.speed;
    vy[i] = dy * inv * phys.speed;
    heading[i] = Math.atan2(vy[i], vx[i]);
    personal[i] = 0.9 + rand() * 0.2;
  }

  const counts: number[] = [];
  const events: SwarmEvent[] = [];
  const snapX: Float32Array[] = [];
  const snapY: Float32Array[] = [];
  const snapA: Float32Array[] = [];
  const snapT: Uint8Array[] = [];

  const used = new Uint8Array(N);
  const cellX = new Int32Array(N);
  const cellY = new Int32Array(N);
  const cellStart = new Int32Array(32 * 32 + 2);
  const cellFill = new Int32Array(32 * 32 + 2);
  const items = new Int32Array(N);
  const typeCounts = new Int32Array(K);

  const snapshot = (frame: number) => {
    typeCounts.fill(0);
    for (let i = 0; i < N; i++) typeCounts[type[i]]++;
    for (let k = 0; k < K; k++) counts.push(typeCounts[k]);
    if (!record) return;
    const sx = new Float32Array(N);
    const sy = new Float32Array(N);
    const sa = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // Heading is presentation only: an eased atan2 of the velocity.
      const target = Math.atan2(vy[i], vx[i]);
      let delta = target - heading[i];
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      heading[i] += frame === 0 ? delta : delta * 0.22;
      sx[i] = px[i];
      sy[i] = py[i];
      sa[i] = heading[i];
    }
    snapX.push(sx);
    snapY.push(sy);
    snapA.push(sa);
    snapT.push(type.slice());
  };

  const aliveTypes = () => {
    let alive = 0;
    for (let k = 0; k < K; k++) if (typeCounts[k] > 0) alive++;
    return alive;
  };

  snapshot(0);
  let winFrame = -1;
  let frame = 0;
  while (frame < config.maxPlayFrames) {
    frame++;
    const sec = (frame - 1) * dt;
    const aggr = Math.max(0, sec - phys.rampStartSec) * phys.rampPerSec;
    const sight = phys.sight * (1 + 3 * aggr);
    const sight2 = sight * sight;

    // Spatial grid, cell size = current sight radius, stable counting sort.
    const gw = Math.min(31, Math.max(1, Math.floor(W / sight)));
    const gh = Math.min(31, Math.max(1, Math.floor(H / sight)));
    const cellW = W / gw;
    const cellH = H / gh;
    const cells = gw * gh;
    cellFill.fill(0, 0, cells + 1);
    for (let i = 0; i < N; i++) {
      const cx = Math.min(gw - 1, Math.max(0, Math.floor(px[i] / cellW)));
      const cy = Math.min(gh - 1, Math.max(0, Math.floor(py[i] / cellH)));
      cellX[i] = cx;
      cellY[i] = cy;
      cellFill[cy * gw + cx + 1]++;
    }
    for (let c = 0; c < cells; c++) cellFill[c + 1] += cellFill[c];
    for (let c = 0; c <= cells; c++) cellStart[c] = cellFill[c];
    for (let i = 0; i < N; i++) items[cellFill[cellY[i] * gw + cellX[i]]++] = i;

    const steer = Math.min(1, phys.steerRate * dt);
    const sepDist = 2.15 * r;
    for (let i = 0; i < N; i++) {
      const ti = type[i];
      const xi = px[i];
      const yi = py[i];
      let preyD2 = Infinity;
      let preyDx = 0;
      let preyDy = 0;
      let predD2 = Infinity;
      let predDx = 0;
      let predDy = 0;
      let sepX = 0;
      let sepY = 0;
      const cx0 = Math.max(0, cellX[i] - 1);
      const cx1 = Math.min(gw - 1, cellX[i] + 1);
      const cy0 = Math.max(0, cellY[i] - 1);
      const cy1 = Math.min(gh - 1, cellY[i] + 1);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = cy * gw + cx;
          for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
            const j = items[k];
            if (j === i) continue;
            const dx = px[j] - xi;
            const dy = py[j] - yi;
            const d2 = dx * dx + dy * dy;
            if (d2 > sight2) continue;
            const tj = type[j];
            if (tj === ti) {
              if (d2 < sepDist * sepDist && d2 > 1e-9) {
                const d = Math.sqrt(d2);
                const push = (sepDist - d) / sepDist;
                sepX -= (dx / d) * push;
                sepY -= (dy / d) * push;
              }
            } else if (beats[ti * K + tj]) {
              if (d2 < preyD2) {
                preyD2 = d2;
                preyDx = dx;
                preyDy = dy;
              }
            } else if (beats[tj * K + ti]) {
              if (d2 < predD2) {
                predD2 = d2;
                predDx = dx;
                predDy = dy;
              }
            }
          }
        }
      }

      const speedNow = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      let ax = 0;
      let ay = 0;
      if (speedNow > 1e-9) {
        ax += (phys.holdWeight * vx[i]) / speedNow;
        ay += (phys.holdWeight * vy[i]) / speedNow;
      }
      let chasing = false;
      if (preyD2 < Infinity) {
        const d = Math.sqrt(preyD2);
        chasing = true;
        ax += (phys.chaseWeight * preyDx) / d;
        ay += (phys.chaseWeight * preyDy) / d;
      }
      if (predD2 < Infinity) {
        const d = Math.sqrt(predD2);
        const urgency = 1 - d / sight;
        const w = phys.fleeWeight * (0.3 + 0.7 * urgency);
        ax -= (w * predDx) / d;
        ay -= (w * predDy) / d;
      }
      ax += phys.separationWeight * sepX;
      ay += phys.separationWeight * sepY;
      ax += phys.wander * (rand() * 2 - 1);
      ay += phys.wander * (rand() * 2 - 1);
      const m = phys.wallMargin;
      if (xi < m) ax += phys.wallWeight * (1 - xi / m);
      else if (xi > W - m) ax -= phys.wallWeight * (1 - (W - xi) / m);
      if (yi < m) ay += phys.wallWeight * (1 - yi / m);
      else if (yi > H - m) ay -= phys.wallWeight * (1 - (H - yi) / m);

      const len = Math.sqrt(ax * ax + ay * ay);
      const target = phys.speed * personal[i] * (chasing ? 1 + phys.chaseBoost + aggr : 1);
      let dvx = vx[i];
      let dvy = vy[i];
      if (len > 1e-9) {
        dvx = (ax / len) * target;
        dvy = (ay / len) * target;
      }
      let nx = vx[i] + (dvx - vx[i]) * steer;
      let ny = vy[i] + (dvy - vy[i]) * steer;
      const cap = phys.speed * personal[i] * (1 + phys.chaseBoost + aggr) * 1.05;
      const sp = Math.sqrt(nx * nx + ny * ny);
      if (sp > cap) {
        nx = (nx / sp) * cap;
        ny = (ny / sp) * cap;
      }
      nvx[i] = nx;
      nvy[i] = ny;
    }

    for (let i = 0; i < N; i++) {
      vx[i] = nvx[i];
      vy[i] = nvy[i];
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      if (px[i] < r) {
        px[i] = r;
        vx[i] = Math.abs(vx[i]);
      } else if (px[i] > W - r) {
        px[i] = W - r;
        vx[i] = -Math.abs(vx[i]);
      }
      if (py[i] < r) {
        py[i] = r;
        vy[i] = Math.abs(vy[i]);
      } else if (py[i] > H - r) {
        py[i] = H - r;
        vy[i] = -Math.abs(vy[i]);
      }
    }

    // Contacts on the new positions, resolved against the step-start types so a
    // fresh conversion cannot chain within the same step.
    used.fill(0);
    const pending: SwarmEvent[] = [];
    const reach2 = 4 * r * r;
    for (let i = 0; i < N; i++) {
      if (used[i]) continue;
      const ti = type[i];
      const cx0 = Math.max(0, cellX[i] - 1);
      const cx1 = Math.min(gw - 1, cellX[i] + 1);
      const cy0 = Math.max(0, cellY[i] - 1);
      const cy1 = Math.min(gh - 1, cellY[i] + 1);
      for (let cy = cy0; cy <= cy1 && !used[i]; cy++) {
        for (let cx = cx0; cx <= cx1 && !used[i]; cx++) {
          const c = cy * gw + cx;
          for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
            const j = items[k];
            if (j <= i || used[j]) continue;
            const dx = px[j] - px[i];
            const dy = py[j] - py[i];
            if (dx * dx + dy * dy >= reach2) continue;
            const tj = type[j];
            let winnerIdx = -1;
            let loserIdx = -1;
            if (tj !== ti && beats[ti * K + tj]) {
              winnerIdx = i;
              loserIdx = j;
            } else if (tj !== ti && beats[tj * K + ti]) {
              winnerIdx = j;
              loserIdx = i;
            }
            if (winnerIdx < 0) continue;
            used[i] = 1;
            used[j] = 1;
            pending.push({
              frame,
              sprite: loserIdx,
              by: winnerIdx,
              x: (px[i] + px[j]) / 2,
              y: (py[i] + py[j]) / 2,
              winner: type[winnerIdx],
              loser: type[loserIdx],
            });
            break;
          }
        }
      }
    }
    for (const event of pending) {
      type[event.sprite] = event.winner;
      events.push(event);
    }

    snapshot(frame);
    if (winFrame < 0 && aliveTypes() === 1) {
      winFrame = frame;
      break;
    }
  }

  let finished = winFrame >= 0;
  if (!finished) winFrame = frame;
  const totalFrames = winFrame + config.holdFrames;
  // Hold: the survivors keep roaming and nothing converts any more. (If the
  // cut-off was hit instead, the run is flagged unfinished and also just roams.)
  while (frame < totalFrames - 1) {
    frame++;
    stepFree(config, px, py, vx, vy, rand);
    snapshot(frame);
  }

  let winner = 0;
  let best = -1;
  for (let k = 0; k < K; k++) {
    if (typeCounts[k] > best) {
      best = typeCounts[k];
      winner = k;
    }
  }
  if (finished && aliveTypes() !== 1) finished = false;

  const eventStart = new Uint32Array(totalFrames + 1);
  let cursor = 0;
  for (let f = 0; f <= totalFrames; f++) {
    while (cursor < events.length && events[cursor].frame < f) cursor++;
    eventStart[f] = cursor;
  }

  const frames = totalFrames;
  const x = new Float32Array(record ? frames * N : 0);
  const y = new Float32Array(record ? frames * N : 0);
  const angle = new Float32Array(record ? frames * N : 0);
  const typeAll = new Uint8Array(record ? frames * N : 0);
  if (record) {
    for (let f = 0; f < frames; f++) {
      x.set(snapX[f], f * N);
      y.set(snapY[f], f * N);
      angle.set(snapA[f], f * N);
      typeAll.set(snapT[f], f * N);
    }
  }
  return {
    config,
    seed: config.seed,
    count: N,
    types: K,
    winFrame,
    totalFrames,
    winner,
    finished,
    x,
    y,
    angle,
    type: typeAll,
    counts: Uint16Array.from(counts.slice(0, frames * K)),
    events,
    eventStart,
  };
}

/** After a win nobody can convert anyone; sprites keep roaming with plain wander physics. */
function stepFree(
  config: SwarmConfig,
  px: Float64Array,
  py: Float64Array,
  vx: Float64Array,
  vy: Float64Array,
  rand: () => number,
) {
  const { count: N, radius: r, physics: phys } = config;
  const W = config.arena.width;
  const H = config.arena.height;
  const dt = SWARM_DT;
  for (let i = 0; i < N; i++) {
    let ax = vx[i];
    let ay = vy[i];
    ax += (rand() * 2 - 1) * phys.speed * 0.18;
    ay += (rand() * 2 - 1) * phys.speed * 0.18;
    const sp = Math.sqrt(ax * ax + ay * ay);
    const target = phys.speed * 0.8;
    if (sp > 1e-9) {
      vx[i] = (ax / sp) * target;
      vy[i] = (ay / sp) * target;
    }
    px[i] += vx[i] * dt;
    py[i] += vy[i] * dt;
    if (px[i] < r) {
      px[i] = r;
      vx[i] = Math.abs(vx[i]);
    } else if (px[i] > W - r) {
      px[i] = W - r;
      vx[i] = -Math.abs(vx[i]);
    }
    if (py[i] < r) {
      py[i] = r;
      vy[i] = Math.abs(vy[i]);
    } else if (py[i] > H - r) {
      py[i] = H - r;
      vy[i] = -Math.abs(vy[i]);
    }
  }
}

export interface SwarmMetrics {
  /** Lead changes with hysteresis (a new leader must be ahead by `margin`). */
  leadChanges: number;
  /** Frame of each lead change. */
  leadChangeFrames: number[];
  /** Lowest share (0..1) the eventual winner reached after 25 percent of the clip. */
  winnerMinShare: number;
  /** Sprite count at that low point. */
  winnerMinCount: number;
  winnerMinFrame: number;
  /** `winFrame / totalFrames`. */
  winFraction: number;
  winSeconds: number;
  totalSeconds: number;
  /** Largest share any type held before the final frame. */
  peakShare: number;
  /** True when the eventual winner was not the leader at 60 percent of the run. */
  winnerTrailedLate: boolean;
}

export function analyzeSwarm(trace: SwarmTrace): SwarmMetrics {
  const { counts, types: K, count: N, totalFrames, winFrame, winner } = trace;
  const margin = Math.max(3, Math.round(N * 0.05));
  let leader = 0;
  let best = -1;
  for (let k = 0; k < K; k++) {
    if (counts[k] > best) {
      best = counts[k];
      leader = k;
    }
  }
  const leadChangeFrames: number[] = [];
  let peakShare = 0;
  for (let f = 1; f <= winFrame; f++) {
    let top = leader;
    for (let k = 0; k < K; k++) if (counts[f * K + k] > counts[f * K + top]) top = k;
    if (top !== leader && counts[f * K + top] >= counts[f * K + leader] + margin) {
      leader = top;
      leadChangeFrames.push(f);
    }
    if (f < winFrame) {
      for (let k = 0; k < K; k++) peakShare = Math.max(peakShare, counts[f * K + k] / N);
    }
  }
  const lateFrame = Math.floor(winFrame * 0.6);
  let lateLeader = 0;
  for (let k = 0; k < K; k++) if (counts[lateFrame * K + k] > counts[lateFrame * K + lateLeader]) lateLeader = k;
  const from = Math.floor(totalFrames * 0.25);
  let winnerMinShare = 1;
  let winnerMinCount = N;
  let winnerMinFrame = from;
  for (let f = from; f <= winFrame; f++) {
    const share = counts[f * K + winner] / N;
    if (share < winnerMinShare) {
      winnerMinShare = share;
      winnerMinCount = counts[f * K + winner];
      winnerMinFrame = f;
    }
  }
  return {
    leadChanges: leadChangeFrames.length,
    leadChangeFrames,
    winnerMinShare,
    winnerMinCount,
    winnerMinFrame,
    winFraction: winFrame / totalFrames,
    winSeconds: winFrame / SWARM_FPS,
    totalSeconds: totalFrames / SWARM_FPS,
    peakShare,
    winnerTrailedLate: lateLeader !== winner,
  };
}

/** What makes a run worth publishing; the seed search and the tests share it. */
export interface SwarmArcCriteria {
  minWinSeconds: number;
  maxWinSeconds: number;
  /** Seconds the score prefers for the final survivor. */
  targetWinSeconds: number;
  minLeadChanges: number;
  maxLeadChanges: number;
  /** The eventual winner must drop to this share or lower after 25 percent of the clip. */
  maxComebackShare: number;
}

export function scoreSwarmArc(
  trace: SwarmTrace,
  metrics: SwarmMetrics,
  criteria: SwarmArcCriteria,
): { ok: boolean; score: number } {
  const ok =
    trace.finished &&
    metrics.winSeconds >= criteria.minWinSeconds &&
    metrics.winSeconds <= criteria.maxWinSeconds &&
    metrics.winFraction >= 0.8 &&
    metrics.winFraction <= 0.95 &&
    metrics.leadChanges >= criteria.minLeadChanges &&
    metrics.leadChanges <= criteria.maxLeadChanges &&
    metrics.winnerMinShare <= criteria.maxComebackShare;
  if (!ok) return { ok, score: -1 };
  const leads = Math.min(metrics.leadChanges, 8);
  const comeback = Math.max(0, 1 - metrics.winnerMinShare / criteria.maxComebackShare) * 3;
  const timing = 2 - Math.min(2, Math.abs(metrics.winSeconds - criteria.targetWinSeconds) / 3);
  const lateTwist = metrics.winnerTrailedLate ? 2 : 0;
  return { ok, score: leads + comeback + timing + lateTwist };
}
