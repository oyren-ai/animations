import { VIDEO } from "../settings.ts";

export const STRING_FPS = VIDEO.fps;
export const STRING_SUBSTEPS = 16;
export const STRING_DT = 1 / (STRING_FPS * STRING_SUBSTEPS);

export const REEL_SAFE = {
  left: 60,
  right: 900,
  top: 220,
  bottom: 1560,
} as const;

export const STRING_ARENA = {
  cx: 480,
  cy: 992,
  r: 414,
  ballR: 24,
  initialStrings: 12,
  maxStrings: 99,
} as const;

export const STRING_PHYSICS = {
  gravity: 0,
  stepSpeedCeiling: 520,
  inwardBounceFloor: 265,
  bounceSpeedFloor: 455,
} as const;

export const ROUND_HOLD_FRAMES = 78; // 1.3s crisp winner banner per round
export const COMBINED_CLOSING_FRAMES = 150; // 2.5s GetTheCodeEndCard

export const CONTENDER_COLORS = [
  "#ff984d",
  "#c8ff00",
  "#47a5ff",
  "#f5cf44",
  "#b96bff",
] as const;

export type StringRoundSlug =
  | "string-arena-coding-clis"
  | "string-arena-languages"
  | "string-arena-frameworks";

export interface StringRoundDefinition {
  slug: StringRoundSlug;
  id: string;
  roundNumber: 1 | 2 | 3;
  category: string;
  seed: number;
  names: readonly [string, string, string, string, string];
  logos: readonly [string, string, string, string, string];
  monograms: readonly [string, string, string, string, string];
}

export const STRING_ROUNDS: readonly StringRoundDefinition[] = [
  {
    slug: "string-arena-coding-clis",
    id: "StringArenaCodingClis",
    roundNumber: 1,
    category: "Coding CLIs",
    seed: 1120,
    names: ["Claude Code", "Codex", "Gemini", "Cursor", "Qwen"],
    logos: ["claude", "codex", "googlegemini", "cursor", "qwen"],
    monograms: ["CC", "CX", "GM", "CU", "QW"],
  },
  {
    slug: "string-arena-languages",
    id: "StringArenaLanguages",
    roundNumber: 2,
    category: "Languages",
    seed: 2213,
    names: ["Rust", "Python", "TypeScript", "Go", "C++"],
    logos: ["rust", "python", "typescript", "go", "cplusplus"],
    monograms: ["RS", "PY", "TS", "GO", "C+"],
  },
  {
    slug: "string-arena-frameworks",
    id: "StringArenaFrameworks",
    roundNumber: 3,
    category: "Frameworks",
    seed: 3274,
    names: ["React", "Vue", "Svelte", "Next.js", "Solid"],
    logos: ["react", "vuedotjs", "svelte", "nextdotjs", "solid"],
    monograms: ["RE", "VU", "SV", "NX", "SO"],
  },
] as const;

export interface RimAnchor {
  id: number;
  owner: number;
  x: number;
  y: number;
  bornFrame: number;
}

export interface ArenaBall {
  id: number;
  name: string;
  logo: string;
  monogram: string;
  color: string;
  r: number;
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type StringArenaEvent =
  | {
      kind: "gain";
      id: number;
      owner: number;
      frame: number;
      step: number;
      time: number;
      x: number;
      y: number;
      remaining: number;
    }
  | {
      kind: "body";
      a: number;
      b: number;
      frame: number;
      step: number;
      time: number;
      x: number;
      y: number;
    }
  | {
      kind: "cut";
      id: number;
      owner: number;
      cutter: number;
      frame: number;
      step: number;
      time: number;
      x: number;
      y: number;
      distance: number;
      remaining: number;
    }
  | {
      kind: "out";
      owner: number;
      frame: number;
      step: number;
      time: number;
      x: number;
      y: number;
    }
  | {
      kind: "finish";
      winnerId: number;
      frame: number;
      step: number;
      time: number;
      reason: "last survivor";
    };

export interface StringArenaFrame {
  frame: number;
  time: number;
  phase: "sim" | "winner";
  balls: ArenaBall[];
  stringsByOwner: number[][];
  hudCounts: number[];
}

export interface StringArenaTrace {
  definition: StringRoundDefinition;
  anchors: RimAnchor[];
  events: StringArenaEvent[];
  frames: StringArenaFrame[];
  finishFrame: number;
  finishTime: number;
  winnerId: number;
  holdFrames: number;
  totalRoundFrames: number;
  maxSubstepTravel: number;
  wallGains: number;
  bodyCollisions: number;
  cuts: number;
}

export interface CombinedStringTimeline {
  rounds: {
    startFrame: number;
    endFrame: number;
    trace: StringArenaTrace;
  }[];
  sceneFrames: number;
  closingFrames: number;
  totalFrames: number;
}

const EPS = 1e-10;

export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pointSegmentSquared(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const x = b.x - a.x;
  const y = b.y - a.y;
  const den = x * x + y * y;
  const t = den ? Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / den)) : 0;
  return (p.x - a.x - t * x) ** 2 + (p.y - a.y - t * y) ** 2;
}

function polyValue(p: readonly number[], t: number): number {
  return p.reduceRight((acc, c) => acc * t + c, 0);
}

/** Isolate all real roots on [0, 1], including double roots at derivative extrema. */
export function polynomialRoots(coefficients: readonly number[]): number[] {
  const p = [...coefficients];
  const scale = Math.max(1, ...p.map(Math.abs));
  while (p.length > 1 && Math.abs(p[p.length - 1]) < scale * 1e-14) p.pop();
  if (p.length === 1) return [];
  if (p.length === 2) {
    const t = -p[0] / p[1];
    return t >= -1e-11 && t <= 1 + 1e-11 ? [Math.max(0, Math.min(1, t))] : [];
  }
  const critical = polynomialRoots(p.slice(1).map((c, i) => c * (i + 1)));
  const bounds = [0, ...critical.filter((t) => t > 0 && t < 1), 1];
  const roots: number[] = [];
  const add = (t: number) => {
    if (!roots.some((r) => Math.abs(r - t) < 1e-9)) roots.push(t);
  };
  for (const t of bounds) {
    if (Math.abs(polyValue(p, t)) < scale * 1e-13) add(t);
  }
  for (let i = 1; i < bounds.length; i++) {
    let lo = bounds[i - 1];
    let hi = bounds[i];
    let flo = polyValue(p, lo);
    const fhi = polyValue(p, hi);
    if (flo * fhi >= 0) continue;
    for (let n = 0; n < 48; n++) {
      const mid = (lo + hi) / 2;
      const f = polyValue(p, mid);
      if (flo * f <= 0) {
        hi = mid;
      } else {
        lo = mid;
        flo = f;
      }
    }
    add((lo + hi) / 2);
  }
  return roots.sort((a, b) => a - b);
}

const cross = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x * b.y - a.y * b.x;
const dot = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x * b.x + a.y * b.y;
const sub = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: a.x - b.x, y: a.y - b.y });
const lerpPt = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

function squarePoly(p: readonly number[]): number[] {
  const q = Array<number>(p.length * 2 - 1).fill(0);
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < p.length; j++) q[i + j] += p[i] * p[j];
  }
  return q;
}

export function sweptStringContact(
  anchor: { x: number; y: number },
  owner0: { x: number; y: number },
  owner1: { x: number; y: number },
  ball0: { x: number; y: number },
  ball1: { x: number; y: number },
  radius: number,
): { time: number; distance: number } | null {
  const ownerTravel = Math.hypot(owner1.x - owner0.x, owner1.y - owner0.y);
  const ballTravel = Math.hypot(ball1.x - ball0.x, ball1.y - ball0.y);
  const start = pointSegmentSquared(ball0, anchor, owner0);
  const r2 = radius * radius;
  if (start > (radius + ownerTravel + ballTravel + 1e-6) ** 2) return null;

  const u = sub(owner0, anchor);
  const v = sub(owner1, owner0);
  const w = sub(ball0, anchor);
  const z = sub(ball1, ball0);
  const endRoots = (p: { x: number; y: number }, d: { x: number; y: number }) =>
    polynomialRoots([dot(p, p) - r2, 2 * dot(p, d), dot(d, d)]);
  const q = squarePoly([cross(u, w), cross(u, z) + cross(v, w), cross(v, z)]);
  q[0] -= r2 * dot(u, u);
  q[1] -= 2 * r2 * dot(u, v);
  q[2] -= r2 * dot(v, v);

  const candidates = [0, 1, ...endRoots(w, z), ...endRoots(sub(w, u), sub(z, v)), ...polynomialRoots(q)].sort(
    (a, b) => a - b,
  );
  for (const t of candidates) {
    const b = lerpPt(owner0, owner1, t);
    const p = lerpPt(ball0, ball1, t);
    const distance = Math.sqrt(pointSegmentSquared(p, anchor, b));
    if (distance <= radius + 2e-6) {
      return { time: t, distance };
    }
  }
  return null;
}

function wallTime(b: ArenaBall, limit: number): number | null {
  const x = b.x - STRING_ARENA.cx;
  const y = b.y - STRING_ARENA.cy;
  const v2 = b.vx * b.vx + b.vy * b.vy;
  if (!v2) return null;
  const pv = x * b.vx + y * b.vy;
  const c = x * x + y * y - (STRING_ARENA.r - b.r) ** 2;
  if (c >= -1e-7 && pv > EPS) return 0;
  const t = (-pv + Math.sqrt(Math.max(0, pv * pv - v2 * c))) / v2;
  return t >= -EPS && t <= limit + EPS ? Math.max(0, t) : null;
}

function pairTime(a: ArenaBall, b: ArenaBall, limit: number): number | null {
  const x = b.x - a.x;
  const y = b.y - a.y;
  const vx = b.vx - a.vx;
  const vy = b.vy - a.vy;
  const pv = x * vx + y * vy;
  const v2 = vx * vx + vy * vy;
  const c = x * x + y * y - (a.r + b.r) ** 2;
  if (pv >= -EPS || !v2) return null;
  if (c <= 1e-7) return 0;
  const disc = pv * pv - v2 * c;
  if (disc < 0) return null;
  const t = (-pv - Math.sqrt(disc)) / v2;
  return t >= -EPS && t <= limit + EPS ? Math.max(0, t) : null;
}

type BodyEvent = { kind: "rim"; time: number; a: number } | { kind: "body"; time: number; a: number; b: number };
type SolverEvent = BodyEvent | { kind: "cut"; time: number; id: number; cutter: number };

function nextBodyContact(balls: readonly ArenaBall[], limit: number): BodyEvent | null {
  let best: BodyEvent | null = null;
  for (const a of balls) {
    if (!a.alive) continue;
    const wt = wallTime(a, limit);
    if (wt !== null && (!best || wt < best.time)) best = { kind: "rim", time: wt, a: a.id };
    for (const b of balls) {
      if (b.alive && b.id > a.id) {
        const pt = pairTime(a, b, limit);
        if (pt !== null && (!best || pt < best.time)) best = { kind: "body", time: pt, a: a.id, b: b.id };
      }
    }
  }
  return best;
}

function resolveBodyOrRim(
  event: BodyEvent,
  balls: ArenaBall[],
): { kind: "rim"; a: number; rimX: number; rimY: number } | { kind: "body"; a: number; b: number; x: number; y: number } {
  const a = balls[event.a];
  if (event.kind === "rim") {
    const d = Math.hypot(a.x - STRING_ARENA.cx, a.y - STRING_ARENA.cy) || 1;
    const nx = (a.x - STRING_ARENA.cx) / d;
    const ny = (a.y - STRING_ARENA.cy) / d;
    a.x = STRING_ARENA.cx + nx * (STRING_ARENA.r - a.r);
    a.y = STRING_ARENA.cy + ny * (STRING_ARENA.r - a.r);
    const vn = a.vx * nx + a.vy * ny;
    if (vn > 0) {
      a.vx -= 2 * vn * nx;
      a.vy -= 2 * vn * ny;
    }
    const inward = a.vx * nx + a.vy * ny;
    if (inward > -STRING_PHYSICS.inwardBounceFloor) {
      const q = -STRING_PHYSICS.inwardBounceFloor - inward;
      a.vx += q * nx;
      a.vy += q * ny;
    }
    const speed = Math.hypot(a.vx, a.vy);
    if (speed < STRING_PHYSICS.bounceSpeedFloor) {
      const q = STRING_PHYSICS.bounceSpeedFloor / speed;
      a.vx *= q;
      a.vy *= q;
    } else if (speed > STRING_PHYSICS.stepSpeedCeiling) {
      const q = STRING_PHYSICS.stepSpeedCeiling / speed;
      a.vx *= q;
      a.vy *= q;
    }
    return {
      kind: "rim",
      a: a.id,
      rimX: STRING_ARENA.cx + nx * STRING_ARENA.r,
      rimY: STRING_ARENA.cy + ny * STRING_ARENA.r,
    };
  }

  const b = balls[event.b];
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (b.x - a.x) / d;
  const ny = (b.y - a.y) / d;
  const v = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (v < 0) {
    a.vx += v * nx;
    a.vy += v * ny;
    b.vx -= v * nx;
    b.vy -= v * ny;
  }
  // Enforce speed floor after elastic exchange so zero-gravity balls stay energetic
  for (const body of [a, b]) {
    const sp = Math.hypot(body.vx, body.vy);
    if (sp > 1e-6 && sp < STRING_PHYSICS.bounceSpeedFloor * 0.82) {
      const q = (STRING_PHYSICS.bounceSpeedFloor * 0.82) / sp;
      body.vx *= q;
      body.vy *= q;
    } else if (sp > STRING_PHYSICS.stepSpeedCeiling) {
      const q = STRING_PHYSICS.stepSpeedCeiling / sp;
      body.vx *= q;
      body.vy *= q;
    }
  }
  return { kind: "body", a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Full-disc volume particle burst on 0-string elimination (including exact disc centre).
 */
export function burstParticles(
  event: { x: number; y: number; owner: number },
  ageSeconds: number,
): { x: number; y: number; r: number }[] {
  const maxRadius = 10 + 118 * ageSeconds;
  const particles: { x: number; y: number; r: number }[] = [
    { x: event.x, y: event.y, r: 3.4 },
  ];
  // Inner core ring so the disc centre is always filled densely
  for (let c = 0; c < 8; c++) {
    const angle = (c * Math.PI) / 4 + event.owner * 0.5;
    const rad = Math.min(8, maxRadius * 0.12);
    particles.push({
      x: event.x + Math.cos(angle) * rad,
      y: event.y + Math.sin(angle) * rad,
      r: 2.6,
    });
  }
  // Golden-angle Fermat spiral filling the full radial disc [0, maxRadius]
  for (let k = 0; k < 64; k++) {
    const radius = maxRadius * Math.sqrt((k + 0.35) / 64);
    const angle = k * 2.399963229728653 + (event.owner + 1) * 0.7;
    particles.push({
      x: event.x + Math.cos(angle) * radius,
      y: event.y + Math.sin(angle) * radius,
      r: 1.8 + (k % 3) * 0.65,
    });
  }
  return particles;
}

const TRACE_CACHE = new Map<StringRoundSlug, StringArenaTrace>();

export function simulateStringRound(
  slug: StringRoundSlug,
  seedOverride?: number,
): StringArenaTrace {
  if (seedOverride === undefined) {
    const cached = TRACE_CACHE.get(slug);
    if (cached) return cached;
  }
  const baseDef = STRING_ROUNDS.find((r) => r.slug === slug);
  if (!baseDef) throw new Error(`Unknown string round: ${slug}`);
  const definition = seedOverride !== undefined ? { ...baseDef, seed: seedOverride } : baseDef;

  const rng = seededRandom(definition.seed);
  const anchors: RimAnchor[] = [];
  const strings = Array.from({ length: 5 }, () => new Set<number>());
  const events: StringArenaEvent[] = [];
  const frames: StringArenaFrame[] = [];

  const balls: ArenaBall[] = definition.names.map((name, id) => {
    const angle = -Math.PI / 2 + (id * Math.PI * 2) / 5;
    const heading = angle + Math.PI + (rng() - 0.5) * 0.95;
    const speed = 465 + rng() * 45;
    // Spread 12 initial strings across a wide 190-degree arc so chords cross the arena from frame 0
    for (let k = 0; k < STRING_ARENA.initialStrings; k++) {
      const spread = ((k + 0.5) / STRING_ARENA.initialStrings - 0.5) * (Math.PI * 1.08);
      const theta = angle + spread;
      const sid = anchors.length;
      anchors.push({
        id: sid,
        owner: id,
        x: STRING_ARENA.cx + Math.cos(theta) * STRING_ARENA.r,
        y: STRING_ARENA.cy + Math.sin(theta) * STRING_ARENA.r,
        bornFrame: 0,
      });
      strings[id].add(sid);
    }
    return {
      id,
      name,
      logo: definition.logos[id],
      monogram: definition.monograms[id],
      color: CONTENDER_COLORS[id],
      r: STRING_ARENA.ballR,
      alive: true,
      x: STRING_ARENA.cx + 228 * Math.cos(angle),
      y: STRING_ARENA.cy + 228 * Math.sin(angle),
      vx: speed * Math.cos(heading),
      vy: speed * Math.sin(heading),
    };
  });

  let frame = 0;
  let step = 0;
  let time = 0;
  let finishTime: number | null = null;
  let winnerId: number | null = null;
  let maxSubstepTravel = 0;
  let wallGains = 0;
  let bodyCollisions = 0;
  let cuts = 0;

  const copyBalls = () => balls.map((b) => ({ ...b }));
  const snapshot = (f: number, phase: "sim" | "winner"): StringArenaFrame => ({
    frame: f,
    time,
    phase,
    balls: copyBalls(),
    stringsByOwner: strings.map((s) => [...s]),
    hudCounts: strings.map((s) => s.size),
  });
  const liveCount = () => balls.filter((b) => b.alive).length;

  function cutString(id: number, cutter: number) {
    const anchor = anchors[id];
    const owner = balls[anchor.owner];
    const other = balls[cutter];
    if (!owner.alive || !other.alive || owner.id === cutter || !strings[owner.id].has(id)) {
      throw new Error("Invalid causal string cut");
    }
    strings[owner.id].delete(id);
    cuts++;
    const dx = owner.x - anchor.x;
    const dy = owner.y - anchor.y;
    const den = dx * dx + dy * dy;
    const t = den ? Math.max(0, Math.min(1, ((other.x - anchor.x) * dx + (other.y - anchor.y) * dy) / den)) : 0;
    events.push({
      kind: "cut",
      id,
      owner: owner.id,
      cutter,
      frame,
      step,
      time,
      x: anchor.x + dx * t,
      y: anchor.y + dy * t,
      distance: Math.sqrt(pointSegmentSquared(other, anchor, owner)),
      remaining: strings[owner.id].size,
    });
    if (strings[owner.id].size === 0) {
      owner.alive = false;
      owner.vx = 0;
      owner.vy = 0;
      events.push({
        kind: "out",
        owner: owner.id,
        frame,
        step,
        time,
        x: owner.x,
        y: owner.y,
      });
    }
    if (liveCount() === 1) {
      winnerId = balls.find((b) => b.alive)!.id;
      finishTime = time;
      events.push({
        kind: "finish",
        winnerId,
        frame,
        step,
        time,
        reason: "last survivor",
      });
    }
  }

  function cutTouchingStrings(): number {
    let count = 0;
    while (finishTime === null) {
      const contacts: { id: number; cutter: number; key: number[] }[] = [];
      for (const owner of balls) {
        if (!owner.alive) continue;
        for (const id of strings[owner.id]) {
          const a = anchors[id];
          for (const other of balls) {
            if (
              other.alive &&
              other.id !== owner.id &&
              pointSegmentSquared(other, a, owner) <= (other.r + 3e-6) ** 2
            ) {
              const dx = owner.x - a.x;
              const dy = owner.y - a.y;
              const den = dx * dx + dy * dy;
              const t = den ? Math.max(0, Math.min(1, ((other.x - a.x) * dx + (other.y - a.y) * dy) / den)) : 0;
              contacts.push({
                id,
                cutter: other.id,
                key: [a.x + dx * t, a.y + dy * t, owner.x, owner.y, other.x, other.y, a.x, a.y],
              });
            }
          }
        }
      }
      if (!contacts.length) break;
      contacts.sort((p, q) => {
        for (let k = 0; k < p.key.length; k++) {
          const d = p.key[k] - q.key[k];
          if (d) return d;
        }
        return 0;
      });
      cutString(contacts[0].id, contacts[0].cutter);
      count++;
    }
    return count;
  }

  // Ensure initial configuration has no pre-overlapping cuts before frame 1
  cutTouchingStrings();
  frames.push(snapshot(0, "sim"));

  const maxFrames = 60 * 35;
  while (finishTime === null && frame < maxFrames) {
    frame++;
    for (let sub = 0; sub < STRING_SUBSTEPS; sub++) {
      if (finishTime !== null) continue;
      step++;
      const travel = [0, 0, 0, 0, 0];
      for (const b of balls) {
        if (!b.alive) continue;
        b.vy += STRING_PHYSICS.gravity * STRING_DT;
        const v = Math.hypot(b.vx, b.vy);
        if (v > STRING_PHYSICS.stepSpeedCeiling) {
          b.vx *= STRING_PHYSICS.stepSpeedCeiling / v;
          b.vy *= STRING_PHYSICS.stepSpeedCeiling / v;
        }
      }
      let remaining = STRING_DT;
      let iterations = 0;
      while (remaining > 1e-12 && finishTime === null) {
        if (++iterations > 1200) throw new Error(`String solver stalled at step ${step}`);
        let event: SolverEvent | null = nextBodyContact(balls, remaining);
        for (const owner of balls) {
          if (!owner.alive) continue;
          for (const id of strings[owner.id]) {
            for (const other of balls) {
              if (!other.alive || other.id === owner.id) continue;
              const hit = sweptStringContact(
                anchors[id],
                owner,
                { x: owner.x + owner.vx * remaining, y: owner.y + owner.vy * remaining },
                other,
                { x: other.x + other.vx * remaining, y: other.y + other.vy * remaining },
                other.r,
              );
              if (hit && (!event || hit.time * remaining < event.time - 1e-12)) {
                event = { kind: "cut", id, cutter: other.id, time: hit.time * remaining };
              }
            }
          }
        }
        const duration = event ? Math.min(remaining, event.time) : remaining;
        for (const b of balls) {
          if (!b.alive) continue;
          b.x += b.vx * duration;
          b.y += b.vy * duration;
          travel[b.id] += Math.hypot(b.vx, b.vy) * duration;
        }
        time += duration;
        remaining -= duration;

        if (event && event.kind !== "cut") {
          const resolved = resolveBodyOrRim(event, balls);
          if (resolved.kind === "rim") {
            const owner = balls[resolved.a];
            // Wall-bounce string gain ONLY on arena rim impact (never on ball-ball impact)
            if (owner.alive && strings[owner.id].size < STRING_ARENA.maxStrings) {
              const sid = anchors.length;
              anchors.push({
                id: sid,
                owner: owner.id,
                x: resolved.rimX,
                y: resolved.rimY,
                bornFrame: frame,
              });
              strings[owner.id].add(sid);
              wallGains++;
              events.push({
                kind: "gain",
                id: sid,
                owner: owner.id,
                frame,
                step,
                time,
                x: resolved.rimX,
                y: resolved.rimY,
                remaining: strings[owner.id].size,
              });
            }
          } else {
            bodyCollisions++;
            events.push({
              kind: "body",
              a: resolved.a,
              b: resolved.b,
              frame,
              step,
              time,
              x: resolved.x,
              y: resolved.y,
            });
          }
        }
        const removed = cutTouchingStrings();
        if (event?.kind === "cut" && !removed) {
          throw new Error(`Swept string contact was not reached: ${event.id}`);
        }
      }
      cutTouchingStrings();
      maxSubstepTravel = Math.max(maxSubstepTravel, ...travel);
    }
    frames.push(snapshot(frame, finishTime === null ? "sim" : "winner"));
  }

  if (finishTime === null || winnerId === null) {
    throw new Error(`${definition.id} did not reach last-survivor finish within budget`);
  }

  const finishFrame = frame;
  for (let i = 1; i <= ROUND_HOLD_FRAMES; i++) {
    frames.push(snapshot(finishFrame + i, "winner"));
  }

  const trace: StringArenaTrace = {
    definition,
    anchors,
    events,
    frames,
    finishFrame,
    finishTime,
    winnerId,
    holdFrames: ROUND_HOLD_FRAMES,
    totalRoundFrames: frames.length,
    maxSubstepTravel,
    wallGains,
    bodyCollisions,
    cuts,
  };
  if (seedOverride === undefined) {
    TRACE_CACHE.set(slug, trace);
  }
  return trace;
}

let cachedCombined: CombinedStringTimeline | undefined;

export function buildCombinedStringTimeline(): CombinedStringTimeline {
  if (cachedCombined) return cachedCombined;
  let cursor = 0;
  const rounds = STRING_ROUNDS.map((def) => {
    const trace = simulateStringRound(def.slug);
    const startFrame = cursor;
    const endFrame = startFrame + trace.totalRoundFrames;
    cursor = endFrame;
    return { startFrame, endFrame, trace };
  });
  cachedCombined = {
    rounds,
    sceneFrames: cursor,
    closingFrames: COMBINED_CLOSING_FRAMES,
    totalFrames: cursor + COMBINED_CLOSING_FRAMES,
  };
  return cachedCombined;
}
