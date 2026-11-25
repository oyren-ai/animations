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
export const SWARM_ARENA = { width: 980, height: 1212 } as const;

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

interface ArmyRegionSpec {
  ax: number;
  ay: number;
  rx: number;
  ry: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  fromBottom?: boolean;
  mirrorFrom?: number;
  /** Optional target toward which `spearCount` connected hex-lattice steps extend from the main body. */
  spearX?: number;
  spearY?: number;
  spearCount?: number;
}

function getArmyRegions(types: number, width: number, height: number, r: number): ArmyRegionSpec[] {
  const pad = r + 2;
  if (types === 3) {
    // Symmetric triangle about x = width / 2:
    // 0 = rock (lower left), 1 = paper (lower right, mirrored), 2 = scissors (top centre).
    return [
      {
        ax: width * 0.132,
        ay: height * 0.735,
        rx: width * 0.275,
        ry: height * 0.3,
        minX: pad,
        maxX: width * 0.445,
        minY: height * 0.424,
        maxY: height - pad,
        fromBottom: true,
        spearX: 434,
        spearY: 514,
        spearCount: 7,
      },
      {
        ax: width * 0.868,
        ay: height * 0.735,
        rx: width * 0.275,
        ry: height * 0.3,
        minX: width * 0.555,
        maxX: width - pad,
        minY: height * 0.424,
        maxY: height - pad,
        fromBottom: true,
        mirrorFrom: 0,
      },
      {
        ax: width / 2,
        ay: height * 0.12,
        rx: width * 0.34,
        ry: height * 0.21,
        minX: width * 0.155,
        maxX: width * 0.845,
        minY: pad,
        maxY: height * 0.382,
        spearX: width / 2,
        spearY: 460,
        spearCount: 8,
      },
    ];
  }
  if (types === 5) {
    // Symmetric pentagon about x = width / 2 with vertex 0 at the top centre:
    // 0 = top centre, 1 = upper right, 2 = lower right, 3 = lower left, 4 = upper left.
    return [
      {
        ax: width / 2,
        ay: pad + 2,
        rx: width * 0.425,
        ry: height * 0.105,
        minX: width * 0.13,
        maxX: width * 0.87,
        minY: pad,
        maxY: height * 0.115,
      },
      {
        ax: width - pad - 2,
        ay: height * 0.456,
        rx: width * 0.092,
        ry: height * 0.315,
        minX: width - width * 0.175,
        maxX: width - pad,
        minY: height * 0.102,
        maxY: height * 0.735,
        mirrorFrom: 4,
      },
      {
        ax: width - width * 0.09,
        ay: height - pad - 2,
        rx: width * 0.285,
        ry: height * 0.142,
        minX: width - width * 0.37,
        maxX: width - pad,
        minY: height * 0.8,
        maxY: height - pad,
        fromBottom: true,
        mirrorFrom: 3,
      },
      {
        ax: width * 0.09,
        ay: height - pad - 2,
        rx: width * 0.285,
        ry: height * 0.142,
        minX: pad,
        maxX: width * 0.37,
        minY: height * 0.8,
        maxY: height - pad,
        fromBottom: true,
      },
      {
        ax: pad + 2,
        ay: height * 0.456,
        rx: width * 0.092,
        ry: height * 0.315,
        minX: pad,
        maxX: width * 0.175,
        minY: height * 0.102,
        maxY: height * 0.735,
        spearX: 164,
        spearY: 122,
        spearCount: 3,
      },
    ];
  }
  return Array.from({ length: types }, (_, k) => {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / types;
    const ax = width / 2 + Math.cos(a) * (width * 0.34);
    const ay = height / 2 + Math.sin(a) * (height * 0.36);
    return {
      ax,
      ay,
      rx: width * 0.22,
      ry: height * 0.22,
      minX: Math.max(pad, ax - width * 0.22),
      maxX: Math.min(width - pad, ax + width * 0.22),
      minY: Math.max(pad, ay - height * 0.22),
      maxY: Math.min(height - pad, ay + height * 0.22),
    };
  });
}

function regionSlotScore(spec: ArmyRegionSpec, x: number, y: number): number {
  return ((x - spec.ax) / spec.rx) ** 2 + ((y - spec.ay) / spec.ry) ** 2;
}

function buildRegionSlots(spec: ArmyRegionSpec, needed: number, r: number, width: number): { x: number; y: number }[] {
  const spearCount = Math.min(spec.spearCount ?? 0, Math.max(0, needed - 4));
  const mainNeeded = needed - spearCount;

  const dx = 2.16 * r;
  // sqrt(3) / 2 expressed via Math.sqrt(0.75) so Node and Chrome round identically.
  const dy = dx * Math.sqrt(0.75);
  const candidates: { x: number; y: number; score: number }[] = [];
  const axisCentered = Math.abs(spec.ax - width / 2) < 1e-6;
  for (let row = 0; ; row++) {
    const y = spec.fromBottom ? spec.maxY - row * dy : spec.minY + row * dy;
    if (spec.fromBottom ? y < spec.minY - 1e-6 : y > spec.maxY + 1e-6) break;
    if (axisCentered) {
      if (row % 2 === 0) {
        for (let m = 0; ; m++) {
          const xs = m === 0 ? [width / 2] : [width / 2 - m * dx, width / 2 + m * dx];
          let any = false;
          for (const x of xs) {
            if (x >= spec.minX - 1e-6 && x <= spec.maxX + 1e-6) {
              candidates.push({ x, y, score: regionSlotScore(spec, x, y) });
              any = true;
            }
          }
          if (!any && m * dx > width) break;
        }
      } else {
        for (let m = 0; ; m++) {
          const off = (m + 0.5) * dx;
          const xs = [width / 2 - off, width / 2 + off];
          let any = false;
          for (const x of xs) {
            if (x >= spec.minX - 1e-6 && x <= spec.maxX + 1e-6) {
              candidates.push({ x, y, score: regionSlotScore(spec, x, y) });
              any = true;
            }
          }
          if (!any && off > width) break;
        }
      }
    } else {
      const offset = (row % 2) * (dx * 0.5);
      for (let col = 0; ; col++) {
        const x = spec.minX + offset + col * dx;
        if (x > spec.maxX + 1e-6) break;
        candidates.push({ x, y, score: regionSlotScore(spec, x, y) });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.y - b.y || Math.abs(a.x - width / 2) - Math.abs(b.x - width / 2));
  if (candidates.length < mainNeeded) {
    throw new Error(`Swarm region only has ${candidates.length} slots for ${mainNeeded} sprites`);
  }
  const connectDist2 = (2.22 * r) ** 2;
  const isConnectedTo = (pool: readonly { x: number; y: number }[], p: { x: number; y: number }) =>
    pool.some((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= connectDist2);
  const pickedKey = (p: { x: number; y: number }) => `${Math.round(p.x * 100)}|${Math.round(p.y * 100)}`;

  if (axisCentered) {
    const centers = candidates.filter((c) => Math.abs(c.x - width / 2) < 1e-6);
    const lefts = candidates.filter((c) => c.x < width / 2 - 1e-6);
    const chosen: { x: number; y: number }[] = [];
    let ci = 0;
    let li = 0;
    if (mainNeeded % 2 === 1 && centers.length > 0) chosen.push({ x: centers[ci].x, y: centers[ci++].y });
    while (chosen.length < mainNeeded) {
      const nextPairScore = li < lefts.length ? lefts[li].score : Infinity;
      const nextCenterPairScore = ci + 1 < centers.length ? (centers[ci].score + centers[ci + 1].score) / 2 : Infinity;
      if (chosen.length + 2 <= mainNeeded && nextPairScore <= nextCenterPairScore && li < lefts.length) {
        const p = lefts[li++];
        chosen.push({ x: p.x, y: p.y }, { x: width - p.x, y: p.y });
      } else if (chosen.length + 2 <= mainNeeded && ci + 1 < centers.length) {
        const a = centers[ci++];
        const b = centers[ci++];
        chosen.push({ x: a.x, y: a.y }, { x: b.x, y: b.y });
      } else if (ci < centers.length) {
        const a = centers[ci++];
        chosen.push({ x: a.x, y: a.y });
      } else {
        break;
      }
    }
    if (spearCount > 0 && spec.spearX !== undefined && spec.spearY !== undefined) {
      const used = new Set(chosen.map(pickedKey));
      while (chosen.length < needed) {
        const rem = needed - chosen.length;
        // Pick the best symmetric pair (or axis point) connected to `chosen` and closest to `(spearX, spearY)`.
        let bestPts: { x: number; y: number }[] | null = null;
        let bestDist = Infinity;
        for (const c of centers) {
          if (used.has(pickedKey(c)) || !isConnectedTo(chosen, c)) continue;
          if (rem === 1 || rem >= 2) {
            const d = (c.x - spec.spearX) ** 2 + (c.y - spec.spearY) ** 2;
            if (d < bestDist && (rem === 1 || rem % 2 === 1)) {
              bestDist = d;
              bestPts = [{ x: c.x, y: c.y }];
            }
          }
        }
        if (rem >= 2) {
          for (const l of lefts) {
            const rPt = { x: width - l.x, y: l.y };
            if (used.has(pickedKey(l)) || used.has(pickedKey(rPt)) || !isConnectedTo(chosen, l)) continue;
            const d = (l.x - spec.spearX) ** 2 + (l.y - spec.spearY) ** 2;
            if (d < bestDist) {
              bestDist = d;
              bestPts = [{ x: l.x, y: l.y }, rPt];
            }
          }
        }
        if (!bestPts) {
          // Fallback to any remaining axis/pair candidate
          if (rem >= 2 && li < lefts.length) {
            const p = lefts[li++];
            bestPts = [{ x: p.x, y: p.y }, { x: width - p.x, y: p.y }];
          } else if (ci < centers.length) {
            const a = centers[ci++];
            bestPts = [{ x: a.x, y: a.y }];
          } else break;
        }
        for (const p of bestPts) {
          used.add(pickedKey(p));
          chosen.push(p);
        }
      }
    }
    return chosen.slice(0, needed);
  }

  const chosen = candidates.slice(0, mainNeeded).map((c) => ({ x: c.x, y: c.y }));
  if (spearCount > 0 && spec.spearX !== undefined && spec.spearY !== undefined) {
    const used = new Set(chosen.map(pickedKey));
    while (chosen.length < needed) {
      let best: { x: number; y: number } | null = null;
      let bestDist = Infinity;
      for (const c of candidates) {
        if (used.has(pickedKey(c)) || !isConnectedTo(chosen, c)) continue;
        const d = (c.x - spec.spearX) ** 2 + (c.y - spec.spearY) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = { x: c.x, y: c.y };
        }
      }
      if (!best) {
        const next = candidates.find((c) => !used.has(pickedKey(c)));
        if (!next) break;
        best = { x: next.x, y: next.y };
      }
      used.add(pickedKey(best));
      chosen.push(best);
    }
  }
  return chosen.slice(0, needed);
}

const regionSlotsCache = new Map<string, { x: number; y: number }[][]>();

function getBaseSlotsByType(config: SwarmConfig): { x: number; y: number }[][] {
  const { count, types, radius: r } = config;
  const { width, height } = config.arena;
  const key = `${count}|${types}|${r}|${width}|${height}`;
  const cached = regionSlotsCache.get(key);
  if (cached) return cached;

  const specs = getArmyRegions(types, width, height, r);
  const countsByType = new Int32Array(types);
  for (let i = 0; i < count; i++) countsByType[i % types]++;

  const slotsByType: { x: number; y: number }[][] = new Array(types);
  for (let k = 0; k < types; k++) {
    if (specs[k].mirrorFrom === undefined) {
      slotsByType[k] = buildRegionSlots(specs[k], countsByType[k], r, width);
    }
  }
  for (let k = 0; k < types; k++) {
    const m = specs[k].mirrorFrom;
    if (m !== undefined) {
      const base = slotsByType[m];
      const needed = countsByType[k];
      slotsByType[k] =
        base.length === needed
          ? base.map((p) => ({ x: width - p.x, y: p.y }))
          : buildRegionSlots(specs[k], needed, r, width);
    }
  }
  regionSlotsCache.set(key, slotsByType);
  return slotsByType;
}

function spawnSprites(
  config: SwarmConfig,
  rand: () => number,
  px: Float64Array,
  py: Float64Array,
  type: Uint8Array,
) {
  const { count, types, radius: r } = config;
  const { width, height } = config.arena;

  // Even split of types across sprite indices, shuffled so index order is unbiased.
  for (let i = 0; i < count; i++) type[i] = i % types;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = type[i];
    type[i] = type[j];
    type[j] = tmp;
  }

  const baseSlots = getBaseSlotsByType(config);
  const slotsByType = baseSlots.map((slots) => slots.slice());

  // Shuffle slot assignments within each army and apply small seeded jitter inside the region.
  const jitter = 0.05 * r;
  for (let k = 0; k < types; k++) {
    const slots = slotsByType[k];
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = slots[i];
      slots[i] = slots[j];
      slots[j] = tmp;
    }
  }
  const cursorByType = new Int32Array(types);
  for (let i = 0; i < count; i++) {
    const k = type[i];
    const slot = slotsByType[k][cursorByType[k]++];
    const jx = (rand() * 2 - 1) * jitter;
    const jy = (rand() * 2 - 1) * jitter;
    px[i] = Math.min(width - r, Math.max(r, slot.x + jx));
    py[i] = Math.min(height - r, Math.max(r, slot.y + jy));
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
  const startCx = new Float64Array(K);
  const startCy = new Float64Array(K);
  const startCount = new Int32Array(K);
  for (let i = 0; i < N; i++) {
    const ti = type[i];
    startCx[ti] += px[i];
    startCy[ti] += py[i];
    startCount[ti]++;
  }
  for (let k = 0; k < K; k++) {
    if (startCount[k] > 0) {
      startCx[k] /= startCount[k];
      startCy[k] /= startCount[k];
    }
  }
  const startPrey = new Int32Array(K).fill(-1);
  for (let a = 0; a < K; a++) {
    let bestD2 = Infinity;
    for (let b = 0; b < K; b++) {
      if (a === b || !beats[a * K + b]) continue;
      const dx = startCx[b] - startCx[a];
      const dy = startCy[b] - startCy[a];
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        startPrey[a] = b;
      }
    }
  }
  for (let i = 0; i < N; i++) {
    // Rejection-sampled unit direction: Math.sin/cos differ in the last bit
    // between Node and Chrome, which would fork the run, so the simulation
    // loop stays trig-free (sqrt is exactly rounded everywhere).
    let rx = 0;
    let ry = 0;
    let r2 = 0;
    do {
      rx = rand() * 2 - 1;
      ry = rand() * 2 - 1;
      r2 = rx * rx + ry * ry;
    } while (r2 > 1 || r2 < 1e-6);
    const rInv = 1 / Math.sqrt(r2);
    let dx = rx * rInv;
    let dy = ry * rInv;
    const ti = type[i];
    let bestPreyD2 = Infinity;
    let targetX = W * 0.5;
    let targetY = H * 0.45;
    for (let j = 0; j < N; j++) {
      if (!beats[ti * K + type[j]]) continue;
      const pdx = px[j] - px[i];
      const pdy = py[j] - py[i];
      const pd2 = pdx * pdx + pdy * pdy;
      if (pd2 < bestPreyD2) {
        bestPreyD2 = pd2;
        targetX = px[j];
        targetY = py[j];
      }
    }
    const tx = targetX - px[i];
    const ty = targetY - py[i];
    const td = Math.sqrt(tx * tx + ty * ty);
    if (td > 1e-6) {
      dx = (tx / td) * 0.94 + dx * 0.2;
      dy = (ty / td) * 0.94 + dy * 0.2;
      const n = Math.sqrt(dx * dx + dy * dy);
      if (n > 1e-6) {
        dx /= n;
        dy /= n;
      }
    }
    const openSpeed = phys.speed * (1 + phys.chaseBoost);
    vx[i] = dx * openSpeed;
    vy[i] = dy * openSpeed;
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
