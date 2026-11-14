import { SCENE_FRAMES, VIDEO } from "../settings.ts";
import { WORLD, bowlY, collideBowl, collideDisc, collideSegment, collideWalls, type Segment } from "./bounds.ts";

export type Style = "pinball-bumper-matrix" | "pendulum-cascade" | "vortex-spiral-bowl" | "split-lane-funnel-merge";
export type Ball = { id: number; x: number; y: number; vx: number; vy: number; r: number; mass: number; tier: number };
export type Cue = { frame: number; type: "spawn" | "hit" | "merge" | "collect"; x: number; y: number; mass?: number; parents?: number[] };
export type Snapshot = { frame: number; balls: Ball[]; spawned: number; collected: number };
export type Trace = { style: Style; seed: number; fps: number; frames: Snapshot[]; events: Cue[]; maxTravel: number };
export const STYLES = [
  { slug: "pinball-bumper-matrix", id: "PinballBumperMatrix", seed: 70231, title: "Pinball Bumper Matrix", caption: "Gravity, elastic contacts and a field of bumpers" },
  { slug: "pendulum-cascade", id: "PendulumCascade", seed: 70241, title: "Pendulum Cascade", caption: "Moving paddles exchange momentum with falling discs" },
  { slug: "vortex-spiral-bowl", id: "VortexSpiralBowl", seed: 70251, title: "Vortex Spiral Bowl", caption: "An art-directed swirl meets a curved glass boundary" },
  { slug: "split-lane-funnel-merge", id: "SplitLaneFunnelMerge", seed: 70261, title: "Split-Lane Funnel Merge", caption: "Equal tiers combine; disc area and momentum carry through" },
] as const;
export const SUBSTEPS = 8;
export const BASE_RADIUS = 14;
export const BUMPERS = Array.from({ length: 3 }, (_, row) =>
  Array.from({ length: 4 }, (_, col) => ({ x: 250 + col * 190 + (row % 2) * 25, y: 730 + row * 205, r: 36 }))).flat();
export const FUNNEL: Segment[] = [
  { a: { x: 140, y: 620 }, b: { x: 440, y: 1100 } },
  { a: { x: 940, y: 620 }, b: { x: 640, y: 1100 } },
];

export function randomFromSeed(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let value = Math.imul(t ^ (t >>> 15), 1 | t);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function paddleAt(index: number, seconds: number): Segment {
  const cycles = 4 + index, omega = Math.PI * 2 * cycles / VIDEO.sceneSeconds;
  const phase = omega * seconds + index * 0.7;
  const angle = Math.sin(phase) * 0.8, speed = Math.cos(phase) * 0.8 * omega;
  const a = { x: index % 2 ? 700 : 380, y: 620 + index * 170 };
  return { a, b: { x: a.x + Math.sin(angle) * 190, y: a.y + Math.cos(angle) * 190 }, omega: -speed };
}

export function mergePair(a: Ball, b: Ball, id: number): Ball | null {
  if (a.tier !== b.tier || a.tier >= 7) return null;
  const mass = a.mass + b.mass;
  return {
    id, mass, tier: a.tier + 1, r: Math.sqrt(a.r ** 2 + b.r ** 2),
    x: (a.x * a.mass + b.x * b.mass) / mass,
    y: (a.y * a.mass + b.y * b.mass) / mass,
    vx: (a.vx * a.mass + b.vx * b.mass) / mass,
    vy: (a.vy * a.mass + b.vy * b.mass) / mass,
  };
}

function separatePair(a: Ball, b: Ball) {
  let dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
  const sum = a.r + b.r;
  if (distance >= sum) return;
  if (distance < 1e-8) { dx = a.id % 2 ? -1 : 1; dy = 0; distance = 1; }
  const nx = dx / distance, ny = dy / distance, overlap = sum - distance + 0.001;
  const mass = a.mass + b.mass;
  a.x -= nx * overlap * b.mass / mass; a.y -= ny * overlap * b.mass / mass;
  b.x += nx * overlap * a.mass / mass; b.y += ny * overlap * a.mass / mass;
  const inward = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (inward < 0) {
    const impulse = -1.65 * inward / (1 / a.mass + 1 / b.mass);
    a.vx -= impulse * nx / a.mass; a.vy -= impulse * ny / a.mass;
    b.vx += impulse * nx / b.mass; b.vy += impulse * ny / b.mass;
  }
}

/** Fixed substeps, stable iteration order and a local seeded PRNG; no wall clock. */
export function simulate(style: Style, seed?: number): Trace {
  const definition = STYLES.find((item) => item.slug === style);
  if (!definition) throw new RangeError("Unknown animation style");
  const selectedSeed = seed ?? definition.seed, random = randomFromSeed(selectedSeed);
  const balls: Ball[] = [], events: Cue[] = [], frames: Snapshot[] = [];
  const cooldown = new Map<string, number>();
  const isBowl = style === "vortex-spiral-bowl" || style === "split-lane-funnel-merge";
  const isMerge = style === "split-lane-funnel-merge";
  let id = 0, spawned = 0, collected = 0, maxTravel = 0;
  const dt = 1 / (VIDEO.fps * SUBSTEPS);
  const snapshot = (frame: number) =>
    frames.push({ frame, balls: balls.map((ball) => ({ ...ball })), spawned, collected });
  const hit = (frame: number, ball: Ball, key: string, speed: number) => {
    const token = String(ball.id) + ":" + key;
    if (speed > 35 && frame - (cooldown.get(token) ?? -100) >= VIDEO.fps * 0.1) {
      events.push({ frame, type: "hit", x: ball.x, y: ball.y });
      cooldown.set(token, frame);
    }
  };
  snapshot(0);
  for (let frame = 1; frame < SCENE_FRAMES; frame++) {
    if (frame < VIDEO.fps * 6 && (frame - 1) % 10 === 0) {
      const x = isMerge ? (spawned % 2 ? 820 : 260) + (random() - 0.5) * 24 : 230 + random() * 620;
      const ball: Ball = { id: id++, x, y: 565, vx: (random() - 0.5) * 100, vy: 40, r: BASE_RADIUS, mass: 1, tier: 1 };
      if (balls.every((other) => Math.hypot(ball.x - other.x, ball.y - other.y) > ball.r + other.r + 1)) {
        balls.push(ball); spawned++;
        events.push({ frame, type: "spawn", x: ball.x, y: ball.y, mass: 1 });
      }
    }
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      const time = (frame - 1 + (sub + 1) / SUBSTEPS) / VIDEO.fps;
      for (const ball of balls) {
        ball.vy += 900 * dt;
        if (style === "vortex-spiral-bowl") {
          const dx = ball.x - 540, dy = ball.y - 980;
          ball.vx += (-dy * 2.4 - dx * 0.5) * dt;
          ball.vy += (dx * 2.4 - dy * 0.5 - 500) * dt;
          ball.vx *= Math.exp(-0.45 * dt); ball.vy *= Math.exp(-0.45 * dt);
        }
        const speed = Math.hypot(ball.vx, ball.vy);
        if (speed > 720) { ball.vx *= 720 / speed; ball.vy *= 720 / speed; }
        maxTravel = Math.max(maxTravel, Math.hypot(ball.vx * dt, ball.vy * dt));
        ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        collideWalls(ball);
        if (style === "pinball-bumper-matrix") {
          BUMPERS.forEach((bumper, index) => hit(frame, ball, "bumper" + index, collideDisc(ball, bumper, bumper.r)));
        } else if (style === "pendulum-cascade") {
          for (let index = 0; index < 4; index++) hit(frame, ball, "paddle" + index, collideSegment(ball, paddleAt(index, time)));
        } else if (isMerge) {
          FUNNEL.forEach((segment, index) => hit(frame, ball, "funnel" + index, collideSegment(ball, segment)));
        }
        if (isBowl) hit(frame, ball, "bowl", collideBowl(ball));
      }
      for (let pass = 0; pass < 24; pass++) {
        for (let a = 0; a < balls.length; a++) {
          for (let b = a + 1; b < balls.length; b++) {
            const p = balls[a], q = balls[b];
            if (Math.hypot(p.x - q.x, p.y - q.y) >= p.r + q.r) continue;
            const merged = isMerge ? mergePair(p, q, id) : null;
            if (merged) {
              id++;
              events.push({ frame, type: "merge", x: merged.x, y: merged.y, mass: merged.mass, parents: [p.id, q.id] });
              balls[a] = merged; balls.splice(b, 1); b = a;
            } else {
              separatePair(p, q);
            }
          }
        }
        for (const ball of balls) {
          collideWalls(ball);
          if (isBowl) collideBowl(ball, false);
        }
      }
      if (!isBowl) for (let i = balls.length - 1; i >= 0; i--) {
        if (balls[i].y + balls[i].r >= WORLD.bottom) {
          const ball = balls[i]; collected += ball.mass;
          events.push({ frame, type: "collect", x: ball.x, y: WORLD.bottom, mass: ball.mass });
          balls.splice(i, 1);
        }
      }
    }
    snapshot(frame);
  }
  return { style, seed: selectedSeed, fps: VIDEO.fps, frames, events, maxTravel };
}

export function auditTrace(trace: Trace) {
  const errors = new Set<string>();
  if (trace.frames.length !== SCENE_FRAMES || trace.frames[0].balls.length !== 0) errors.add("Invalid empty opening or duration");
  if (trace.maxTravel > BASE_RADIUS / 2) errors.add("Substep exceeds half a radius");
  for (const frame of trace.frames) {
    if (frame.balls.reduce((mass, ball) => mass + ball.mass, 0) + frame.collected !== frame.spawned) errors.add("Mass ledger mismatch");
    if (new Set(frame.balls.map((ball) => ball.id)).size !== frame.balls.length) errors.add("Duplicate body identity");
    for (const ball of frame.balls) {
      if (![ball.x, ball.y, ball.vx, ball.vy, ball.r, ball.mass].every(Number.isFinite)) errors.add("Nonfinite body");
      if (ball.x - ball.r < WORLD.left - 0.1 || ball.x + ball.r > WORLD.right + 0.1 ||
          ball.y - ball.r < WORLD.top - 0.1 || ball.y + ball.r > WORLD.bottom + 0.1) errors.add("Body outside world");
      if (Math.abs(ball.r ** 2 - BASE_RADIUS ** 2 * ball.mass) > 1e-6) errors.add("Disc area mismatch");
      if (trace.style === "split-lane-funnel-merge" || trace.style === "vortex-spiral-bowl") {
        for (let k = 0; k < 64; k++) {
          const angle = k * Math.PI * 2 / 64;
          if (ball.y + Math.sin(angle) * ball.r > bowlY(ball.x + Math.cos(angle) * ball.r) + 0.1) errors.add("Disc crosses curved glass");
        }
      }
    }
  }
  return [...errors];
}
