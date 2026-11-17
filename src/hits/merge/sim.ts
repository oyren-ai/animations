import { createRng, digestNumbers, fnv1a } from "../kit.ts";
import { HIT_SEED } from "../types.ts";
import { CHAIN_IDLE, CHAIN_LINK_SEC, chainLive, chainOnMerge, type ChainState } from "./chain.ts";
import { TIER_COUNT, TIERS } from "./tiers.ts";

/**
 * Deterministic FunnelMerge simulation: a circle solver at a fixed 240 Hz, only tier-1 pieces drop,
 * two touching pieces of the same tier merge into the next tier, and the whole run is pre-baked into
 * a compact per-frame trace (quantised Uint16 positions, no per-frame objects).
 *
 * Only + - * / and Math.sqrt run inside the solver, so the trace is bit-identical in Node (audio) and
 * in the browser (video). Trigonometry is avoided on purpose: launch directions come from a tangent.
 */

export const WORLD_W = 1080;
/** The floor is the top edge of the deck that carries the CTA lines (y 1478 to 1548 are fixed by the kit), so the pile never sits behind text. */
export const FLOOR_Y = 1448;
/** The tube mouth. Pieces leave it, so the container below starts empty. */
export const MOUTH_X = 540;
export const MOUTH_Y = 632;
/** The settled pile must never rise above this line. */
export const PILE_LIMIT_Y = 700;
/** Pieces younger than this are still in flight and are not part of the pile. */
export const PILE_GRACE_SEC = 1.2;
export const SIM_FPS = 60;
export const SCENE_SECONDS = 24;
export const SCENE_FRAMES = SCENE_SECONDS * SIM_FPS;
export const SUBSTEPS_PER_FRAME = 4;
/** Positions and radii are stored in 1/16 px. */
export const POS_SCALE = 16;
/** Two consecutive substeps of contact trigger a merge. */
export const MERGE_CONTACT_SUBSTEPS = 2;

/** A merged piece never starts smaller than this share of its own radius. */
const MIN_START = 0.3;
const MAX_PIECES = 320;
const MAX_IDS = 1024;
const MAX_PAIRS = 4096;

export interface MergeTuning {
  /** px/s^2 */
  readonly gravity: number;
  readonly restitution: number;
  /** Approach speeds below this do not bounce (px/s). */
  readonly restThreshold: number;
  readonly frictionFloor: number;
  readonly frictionPair: number;
  readonly frictionWall: number;
  /** Solver passes per 240 Hz substep. */
  readonly iterations: number;
  /** Upward speed of a freshly merged piece (px/s). */
  readonly popSpeed: number;
  /** Random sideways speed added to a merged piece (px/s). */
  readonly popJitter: number;
  /** A merged piece grows from its parents' radius to its own over this time. */
  readonly growSec: number;
  /** A new piece cannot merge for this long, so a pop reads before it can chain. */
  readonly immunitySec: number;
  readonly firstDropSec: number;
  /** Drop interval at t = 0 and the interval it shrinks to after `dropRampSec`. */
  readonly dropStartSec: number;
  readonly dropEndSec: number;
  readonly dropRampSec: number;
  readonly speedMin: number;
  readonly speedMax: number;
  /** tan of the widest launch angle from vertical (35 degrees). */
  readonly tanMax: number;
  /** Approach speed that makes an audible wall or floor impact (px/s). */
  readonly impactMin: number;
  /** The two lower corners are 30-degree style ramps (a bowl): horizontal run of each ramp in px, 0 = flat floor. */
  readonly rampRun: number;
  /** Height of each ramp at its wall in px. */
  readonly rampRise: number;
  readonly radii: readonly number[];
}

export const TUNING: MergeTuning = {
  gravity: 2600,
  restitution: 0.25,
  restThreshold: 150,
  frictionFloor: 0.25,
  frictionPair: 0.1,
  frictionWall: 0.05,
  iterations: 8,
  popSpeed: 550,
  popJitter: 70,
  growSec: 0.12,
  immunitySec: 0.08,
  firstDropSec: 0.1,
  dropStartSec: 0.3,
  dropEndSec: 0.16,
  dropRampSec: 16,
  speedMin: 420,
  speedMax: 1100,
  tanMax: 0.70021,
  impactMin: 420,
  rampRun: 330,
  rampRise: 360,
  radii: TIERS.map((t) => t.radius),
};

export interface SpawnEvent {
  id: number;
  /** 240 Hz substep index. */
  sub: number;
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface MergeEvent {
  index: number;
  /** Substep after whose physics the merge ran. */
  sub: number;
  /** Time the merge completed: (sub + 1) / 240. */
  t: number;
  /** First frame whose snapshot shows the new piece. */
  frame: number;
  x: number;
  y: number;
  /** Tier of the NEW piece. */
  tier: number;
  aId: number;
  bId: number;
  newId: number;
  /** Chain count including this merge. */
  chain: number;
  /** True when a parent was itself made by a merge within the link window (merges triggering each other). */
  linked: boolean;
}

export interface ImpactEvent {
  sub: number;
  t: number;
  x: number;
  y: number;
  /** Approach speed along the wall or floor normal, px/s. */
  speed: number;
  /** 0 = side wall, 1 = floor. */
  kind: 0 | 1;
  tier: number;
}

export interface MergeStats {
  drops: number;
  merges: number;
  maxChain: number;
  peakPieces: number;
  /** Highest point (smallest y - r) of any settled piece. */
  pileTopMinY: number;
  /** First time (s) tier k = index + 1 exists, or -1. */
  firstTierT: number[];
  /** Worst overlap in px seen at any frame snapshot (pieces, walls, floor). */
  maxOverlap: number;
}

export interface MergeTrace {
  seed: number;
  frames: number;
  /** CSR layout: the pieces of frame f are the records frameStart[f] .. frameStart[f + 1] - 1. */
  frameStart: Uint32Array;
  pid: Uint16Array;
  ptier: Uint8Array;
  px: Uint16Array;
  py: Uint16Array;
  /** Physical radius, 1/16 px. */
  pr: Uint16Array;
  /** Per piece id: the first frame whose snapshot shows it. */
  bornFrame: Uint16Array;
  spawns: SpawnEvent[];
  merges: MergeEvent[];
  impacts: ImpactEvent[];
  /** Per frame: highest tier reached so far (0 before the first drop). */
  topTier: Uint8Array;
  /** Per frame: merges completed so far. */
  mergeCount: Uint16Array;
  /** Per frame: live chain count (0 when none). */
  chainLive: Uint8Array;
  /** Time of the first tier-7 piece, or -1. */
  firstFinalT: number;
  stats: MergeStats;
}

function grow16(a: Uint16Array, n: number): Uint16Array {
  const b = new Uint16Array(n);
  b.set(a);
  return b;
}

function grow8(a: Uint8Array, n: number): Uint8Array {
  const b = new Uint8Array(n);
  b.set(a);
  return b;
}

const q16 = (v: number): number => Math.max(0, Math.min(65535, Math.round(v * POS_SCALE)));

export function simulateMerge(seed: number = HIT_SEED, overrides: Partial<MergeTuning> = {}): MergeTrace {
  const T: MergeTuning = { ...TUNING, ...overrides };
  const rng = createRng(seed);
  const frames = SCENE_FRAMES;
  const dt = 1 / (SIM_FPS * SUBSTEPS_PER_FRAME);
  const immunitySubs = Math.round(T.immunitySec / dt);
  const impactCooldownSubs = Math.round(0.15 / dt);
  const radii = T.radii;
  const G = T.gravity;
  const REST = T.restitution;
  const REST_V = T.restThreshold;
  const SLOP = 0.05;
  const BETA = 0.85;
  const MARGIN = 14;
  const MAX_SPEED = 3600;

  // piece slots (struct of arrays)
  const x = new Float64Array(MAX_PIECES);
  const y = new Float64Array(MAX_PIECES);
  const vx = new Float64Array(MAX_PIECES);
  const vy = new Float64Array(MAX_PIECES);
  const rad = new Float64Array(MAX_PIECES);
  const radT = new Float64Array(MAX_PIECES);
  const growRate = new Float64Array(MAX_PIECES);
  const invM = new Float64Array(MAX_PIECES);
  const tier = new Uint8Array(MAX_PIECES);
  const alive = new Uint8Array(MAX_PIECES);
  const pidOf = new Uint16Array(MAX_PIECES);
  const bornSub = new Int32Array(MAX_PIECES);
  /** Substep of the merge that made the piece, or -1 for a dropped piece. */
  const madeSub = new Int32Array(MAX_PIECES);
  const lastImpact = new Int32Array(MAX_PIECES);
  const act = new Int32Array(MAX_PIECES);
  const freeSlots: number[] = [];
  let slotsUsed = 0;
  let nAct = 0;
  let nextId = 1;

  const pairA = new Int32Array(MAX_PAIRS);
  const pairB = new Int32Array(MAX_PAIRS);
  let nPairs = 0;

  // trace outputs
  const frameStart = new Uint32Array(frames + 1);
  let cap = frames * 64;
  let oPid = new Uint16Array(cap);
  let oTier = new Uint8Array(cap);
  let oX = new Uint16Array(cap);
  let oY = new Uint16Array(cap);
  let oR = new Uint16Array(cap);
  let nRec = 0;
  const bornFrame = new Uint16Array(MAX_IDS);
  const topTierArr = new Uint8Array(frames);
  const mergeCountArr = new Uint16Array(frames);
  const chainLiveArr = new Uint8Array(frames);
  const spawns: SpawnEvent[] = [];
  const merges: MergeEvent[] = [];
  const impacts: ImpactEvent[] = [];
  const firstTierT: number[] = new Array<number>(TIER_COUNT).fill(-1);

  let chain: ChainState = CHAIN_IDLE;
  let topTierNow = 0;
  let maxChain = 0;
  let peakPieces = 0;
  let pileTopMinY = Number.POSITIVE_INFINITY;
  let maxOverlap = 0;
  let curSub = 0;

  // same-tier contacts that persisted since the previous substep
  let prevKeys: number[] = [];
  let prevCnt: number[] = [];

  const pileGraceSubs = Math.round(PILE_GRACE_SEC / dt);

  const allocSlot = (): number => {
    const s = freeSlots.length > 0 ? (freeSlots.pop() as number) : slotsUsed++;
    alive[s] = 1;
    return s;
  };

  const dropInterval = (t: number): number => {
    const k = Math.max(0, Math.min(1, t / T.dropRampSec));
    return T.dropStartSec + (T.dropEndSec - T.dropStartSec) * k;
  };

  const spawn = (sub: number): void => {
    const u = rng.range(-1, 1);
    const speed = rng.range(T.speedMin, T.speedMax);
    const tanA = T.tanMax * u;
    const norm = Math.sqrt(1 + tanA * tanA);
    const dirX = tanA / norm;
    const dirY = 1 / norm;
    const s = allocSlot();
    const id = nextId++;
    pidOf[s] = id;
    tier[s] = 1;
    radT[s] = radii[0];
    rad[s] = radii[0];
    growRate[s] = 0;
    invM[s] = 900 / (radii[0] * radii[0]);
    x[s] = MOUTH_X + dirX * 6;
    y[s] = MOUTH_Y + 2;
    vx[s] = dirX * speed;
    vy[s] = dirY * speed;
    bornSub[s] = sub;
    madeSub[s] = -1;
    lastImpact[s] = -1_000_000;
    if (topTierNow < 1) topTierNow = 1;
    if (firstTierT[0] < 0) firstTierT[0] = sub * dt;
    bornFrame[id] = Math.floor(sub / SUBSTEPS_PER_FRAME) + 1;
    spawns.push({ id, sub, t: sub * dt, x: x[s], y: y[s], vx: vx[s], vy: vy[s] });
  };

  const noteImpact = (i: number, px: number, py: number, speed: number, kind: 0 | 1): void => {
    if (speed < T.impactMin || curSub - lastImpact[i] < impactCooldownSubs) return;
    lastImpact[i] = curSub;
    impacts.push({ sub: curSub, t: curSub * dt, x: px, y: py, speed, kind, tier: tier[i] });
  };

  // The playfield is convex: side walls, flat floor and two corner ramps are half-planes n.p - off >= r.
  const planeNx: number[] = [1, -1, 0];
  const planeNy: number[] = [0, 0, -1];
  const planeOff: number[] = [0, -WORLD_W, -FLOOR_Y];
  const planeMu: number[] = [T.frictionWall, T.frictionWall, T.frictionFloor];
  const planeKind: (0 | 1)[] = [0, 0, 1];
  if (T.rampRun > 0) {
    const len = Math.sqrt(T.rampRun * T.rampRun + T.rampRise * T.rampRise);
    const y0 = FLOOR_Y - T.rampRise;
    // left ramp: through (0, y0) and (run, floor), normal points up and right
    planeNx.push(T.rampRise / len);
    planeNy.push(-T.rampRun / len);
    planeOff.push((-T.rampRun / len) * y0);
    planeMu.push(T.frictionFloor);
    planeKind.push(1);
    // right ramp: through (W, y0) and (W - run, floor), normal points up and left
    planeNx.push(-T.rampRise / len);
    planeNy.push(-T.rampRun / len);
    planeOff.push((-T.rampRise / len) * WORLD_W + (-T.rampRun / len) * y0);
    planeMu.push(T.frictionFloor);
    planeKind.push(1);
  }
  const nPlanes = planeNx.length;

  const halfPlane = (i: number, k: number): void => {
    const nx = planeNx[k];
    const ny = planeNy[k];
    const r = rad[i];
    const dist = x[i] * nx + y[i] * ny - planeOff[k];
    if (dist >= r) return;
    const push = r - dist;
    x[i] += nx * push;
    y[i] += ny * push;
    const vn = vx[i] * nx + vy[i] * ny;
    if (vn >= 0) return;
    const vin = -vn;
    const vout = vin > REST_V ? vin * REST : 0;
    vx[i] += nx * (vin + vout);
    vy[i] += ny * (vin + vout);
    const tx = -ny;
    const ty = nx;
    const vt = vx[i] * tx + vy[i] * ty;
    const dv = Math.min(Math.abs(vt), planeMu[k] * (vin + vout));
    const sdv = vt > 0 ? dv : -dv;
    vx[i] -= tx * sdv;
    vy[i] -= ty * sdv;
    if (planeKind[k] === 0) noteImpact(i, nx > 0 ? 0 : WORLD_W, y[i], vin, 0);
    else noteImpact(i, x[i], y[i] + r, vin, 1);
  };

  const walls = (i: number): void => {
    for (let k = 0; k < nPlanes; k++) halfPlane(i, k);
  };

  const pair = (i: number, j: number): void => {
    const dx = x[j] - x[i];
    const dy = y[j] - y[i];
    const rs = rad[i] + rad[j];
    const d2 = dx * dx + dy * dy;
    if (d2 >= rs * rs) return;
    let nx = 0;
    let ny = 1;
    let d = 0;
    if (d2 > 1e-12) {
      d = Math.sqrt(d2);
      nx = dx / d;
      ny = dy / d;
    }
    const wi = invM[i];
    const wj = invM[j];
    const ws = wi + wj;
    const pen = rs - d;
    if (pen > SLOP) {
      const corr = ((pen - SLOP) * BETA) / ws;
      x[i] -= nx * corr * wi;
      y[i] -= ny * corr * wi;
      x[j] += nx * corr * wj;
      y[j] += ny * corr * wj;
    }
    const vn = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny;
    if (vn < 0) {
      const e = -vn > REST_V ? REST : 0;
      const jn = (-(1 + e) * vn) / ws;
      vx[i] -= jn * nx * wi;
      vy[i] -= jn * ny * wi;
      vx[j] += jn * nx * wj;
      vy[j] += jn * ny * wj;
      const tx = -ny;
      const ty = nx;
      const vt = (vx[j] - vx[i]) * tx + (vy[j] - vy[i]) * ty;
      const maxJt = T.frictionPair * jn;
      let jt = -vt / ws;
      if (jt > maxJt) jt = maxJt;
      else if (jt < -maxJt) jt = -maxJt;
      vx[i] -= jt * tx * wi;
      vy[i] -= jt * ty * wi;
      vx[j] += jt * tx * wj;
      vy[j] += jt * ty * wj;
    }
  };

  const snapshot = (f: number): void => {
    frameStart[f] = nRec;
    const sub = f * SUBSTEPS_PER_FRAME;
    nAct = 0;
    for (let i = 0; i < slotsUsed; i++) if (alive[i]) act[nAct++] = i;
    if (nRec + nAct > cap) {
      cap *= 2;
      oPid = grow16(oPid, cap);
      oTier = grow8(oTier, cap);
      oX = grow16(oX, cap);
      oY = grow16(oY, cap);
      oR = grow16(oR, cap);
    }
    for (let a = 0; a < nAct; a++) {
      const i = act[a];
      oPid[nRec] = pidOf[i];
      oTier[nRec] = tier[i];
      oX[nRec] = q16(x[i]);
      oY[nRec] = q16(y[i]);
      oR[nRec] = q16(rad[i]);
      nRec++;
      if (sub - bornSub[i] >= pileGraceSubs) pileTopMinY = Math.min(pileTopMinY, y[i] - rad[i]);
      for (let k = 0; k < nPlanes; k++) maxOverlap = Math.max(maxOverlap, rad[i] - (x[i] * planeNx[k] + y[i] * planeNy[k] - planeOff[k]));
      for (let b = a + 1; b < nAct; b++) {
        const j = act[b];
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const rs = rad[i] + rad[j];
        if (dx * dx + dy * dy < rs * rs) maxOverlap = Math.max(maxOverlap, rs - Math.sqrt(dx * dx + dy * dy));
      }
    }
    peakPieces = Math.max(peakPieces, nAct);
    topTierArr[f] = topTierNow;
    mergeCountArr[f] = merges.length;
    chainLiveArr[f] = chainLive(chain, f / SIM_FPS);
  };

  let nextDropT = T.firstDropSec;

  for (let f = 0; f < frames; f++) {
    snapshot(f);
    for (let s = 0; s < SUBSTEPS_PER_FRAME; s++) {
      const sub = f * SUBSTEPS_PER_FRAME + s;
      curSub = sub;
      const now = sub * dt;

      // drops are due at the first substep at or after their scheduled time
      while (now >= nextDropT - 1e-9) {
        spawn(sub);
        nextDropT += dropInterval(nextDropT);
      }

      // active list, integration
      nAct = 0;
      for (let i = 0; i < slotsUsed; i++) if (alive[i]) act[nAct++] = i;
      for (let a = 0; a < nAct; a++) {
        const i = act[a];
        vy[i] += G * dt;
        if (vx[i] > MAX_SPEED) vx[i] = MAX_SPEED;
        else if (vx[i] < -MAX_SPEED) vx[i] = -MAX_SPEED;
        if (vy[i] > MAX_SPEED) vy[i] = MAX_SPEED;
        else if (vy[i] < -MAX_SPEED) vy[i] = -MAX_SPEED;
        x[i] += vx[i] * dt;
        y[i] += vy[i] * dt;
        if (rad[i] < radT[i]) rad[i] = Math.min(radT[i], rad[i] + growRate[i] * dt);
      }

      // broad phase
      nPairs = 0;
      for (let a = 0; a < nAct; a++) {
        const i = act[a];
        for (let b = a + 1; b < nAct; b++) {
          const j = act[b];
          const dx = x[j] - x[i];
          const dy = y[j] - y[i];
          const rs = rad[i] + rad[j] + MARGIN;
          if (dx * dx + dy * dy < rs * rs && nPairs < MAX_PAIRS) {
            pairA[nPairs] = i;
            pairB[nPairs] = j;
            nPairs++;
          }
        }
      }

      // solver passes
      for (let it = 0; it < T.iterations; it++) {
        for (let a = 0; a < nAct; a++) walls(act[a]);
        for (let p = 0; p < nPairs; p++) pair(pairA[p], pairB[p]);
      }
      for (let a = 0; a < nAct; a++) walls(act[a]);

      // merges: same tier, touching (centre distance <= ra + rb + 1) for two consecutive substeps
      const curKeys: number[] = [];
      const curCnt: number[] = [];
      for (let p = 0; p < nPairs; p++) {
        const i = pairA[p];
        const j = pairB[p];
        if (tier[i] !== tier[j] || tier[i] >= TIER_COUNT) continue;
        if (sub - bornSub[i] < immunitySubs || sub - bornSub[j] < immunitySubs) continue;
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const lim = rad[i] + rad[j] + 1;
        if (dx * dx + dy * dy > lim * lim) continue;
        const key = i * MAX_PIECES + j;
        const at = prevKeys.indexOf(key);
        curKeys.push(key);
        curCnt.push(at >= 0 ? prevCnt[at] + 1 : 1);
      }
      for (let c = 0; c < curKeys.length; c++) {
        if (curCnt[c] < MERGE_CONTACT_SUBSTEPS) continue;
        const i = Math.floor(curKeys[c] / MAX_PIECES);
        const j = curKeys[c] % MAX_PIECES;
        if (!alive[i] || !alive[j] || tier[i] !== tier[j]) continue;
        const newTier = tier[i] + 1;
        const t = (sub + 1) * dt;
        const mx = (x[i] + x[j]) / 2;
        const my = (y[i] + y[j]) / 2;
        const aId = pidOf[i];
        const bId = pidOf[j];
        const avx = (vx[i] + vx[j]) / 2;
        const avy = (vy[i] + vy[j]) / 2;
        const parentR = Math.max(rad[i], rad[j]);
        const linkSubs = Math.round(CHAIN_LINK_SEC / dt);
        const linked =
          (madeSub[i] >= 0 && sub - madeSub[i] <= linkSubs) || (madeSub[j] >= 0 && sub - madeSub[j] <= linkSubs);
        alive[j] = 0;
        freeSlots.push(j);
        const id = nextId++;
        pidOf[i] = id;
        tier[i] = newTier;
        radT[i] = radii[newTier - 1];
        // The new piece starts no bigger than its parents and no bigger than the free space around the
        // merge point, then grows to its tier radius, pushing neighbours aside while it does.
        let clear = parentR;
        for (let a = 0; a < nAct; a++) {
          const k = act[a];
          if (k === i || k === j || !alive[k]) continue;
          const kx = x[k] - mx;
          const ky = y[k] - my;
          const free = Math.sqrt(kx * kx + ky * ky) - rad[k];
          if (free < clear) clear = free;
        }
        for (let k = 0; k < nPlanes; k++) {
          const free = mx * planeNx[k] + my * planeNy[k] - planeOff[k];
          if (free < clear) clear = free;
        }
        const startR = Math.max(MIN_START * radT[i], Math.min(parentR, clear - 0.5));
        rad[i] = startR;
        growRate[i] = (radT[i] - startR) / T.growSec;
        invM[i] = 900 / (radT[i] * radT[i]);
        x[i] = mx;
        y[i] = my;
        vx[i] = avx + rng.range(-T.popJitter, T.popJitter);
        vy[i] = Math.min(avy * 0.5, 0) - T.popSpeed;
        bornSub[i] = sub;
        madeSub[i] = sub;
        lastImpact[i] = -1_000_000;
        chain = chainOnMerge(chain, t, linked);
        maxChain = Math.max(maxChain, chain.count);
        if (newTier > topTierNow) topTierNow = newTier;
        if (firstTierT[newTier - 1] < 0) firstTierT[newTier - 1] = t;
        const frame = Math.floor(sub / SUBSTEPS_PER_FRAME) + 1;
        bornFrame[id] = frame;
        merges.push({
          index: merges.length,
          sub,
          t,
          frame,
          x: mx,
          y: my,
          tier: newTier,
          aId,
          bId,
          newId: id,
          chain: chain.count,
          linked,
        });
        // contacts of the consumed pieces cannot continue
        for (let d = c + 1; d < curKeys.length; d++) {
          const ki = Math.floor(curKeys[d] / MAX_PIECES);
          const kj = curKeys[d] % MAX_PIECES;
          if (ki === i || kj === i || ki === j || kj === j) curCnt[d] = 0;
        }
      }
      prevKeys = curKeys;
      prevCnt = curCnt;
    }
  }
  frameStart[frames] = nRec;

  const finalMerge = merges.find((m) => m.tier === TIER_COUNT);
  return {
    seed,
    frames,
    frameStart,
    pid: oPid.slice(0, nRec),
    ptier: oTier.slice(0, nRec),
    px: oX.slice(0, nRec),
    py: oY.slice(0, nRec),
    pr: oR.slice(0, nRec),
    bornFrame: bornFrame.slice(0, nextId),
    spawns,
    merges,
    impacts,
    topTier: topTierArr,
    mergeCount: mergeCountArr,
    chainLive: chainLiveArr,
    firstFinalT: finalMerge ? finalMerge.t : -1,
    stats: {
      drops: spawns.length,
      merges: merges.length,
      maxChain,
      peakPieces,
      pileTopMinY,
      firstTierT,
      maxOverlap,
    },
  };
}

/** Short stable hash of everything that defines the run. */
export function digestMerge(trace: MergeTrace): string {
  const parts = [
    digestNumbers(trace.frameStart, 0),
    digestNumbers(trace.pid, 0),
    digestNumbers(trace.ptier, 0),
    digestNumbers(trace.px, 0),
    digestNumbers(trace.py, 0),
    digestNumbers(trace.pr, 0),
    digestNumbers(trace.merges.map((m) => m.t), 4),
    digestNumbers(trace.merges.map((m) => m.tier * 1000 + m.chain), 0),
    digestNumbers(trace.merges.map((m) => m.x + m.y * 2048), 1),
    digestNumbers(trace.spawns.map((s) => s.t), 4),
    digestNumbers(trace.impacts.map((e) => e.t + e.speed * 1e-3), 4),
    digestNumbers(trace.chainLive, 0),
    digestNumbers(trace.topTier, 0),
    String(trace.firstFinalT.toFixed(4)),
  ];
  return fnv1a(parts.join("|"));
}
