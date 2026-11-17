import {
  PATATE_FRAME_STRETCH,
  PATATE_PACE,
  PATATE_SQUASH,
  PATATE_TIME_SCALE,
  type PatateImpact,
  type PatateImpactKind,
} from "./feel.ts";
import {
  getPatateComposition,
  PATATE_CLOSING_FRAMES,
  PATATE_COMPOSITIONS,
  PATATE_FLASK,
  PATATE_RADII,
  PATATE_SCENE_FRAMES,
  PATATE_SOLVER_SCENE_FRAMES,
  PATATE_TOTAL_FRAMES,
  type PatateCompositionSlug,
  type PatateCompositionSpec,
  type PatateVoiceStem,
} from "./themes.ts";

export interface PatateBodySnapshot {
  readonly id: number;
  readonly tier: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly theta: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly enteredFlask: boolean;
}

export interface PatateQueuedDrop {
  readonly id: number;
  readonly tier: 1 | 2 | 3;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly theta: number;
  readonly alpha: number;
}

export interface PatateShockwave {
  readonly x: number;
  readonly y: number;
  readonly baseR: number;
  readonly maxR: number;
  readonly progress: number; // 0..1
  readonly accent: string;
  readonly tier: number;
}

export interface PatateSparkle {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly alpha: number;
  readonly color: string;
}

export interface PatateCallout {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly accent: string;
  readonly tier: number;
  readonly progress: number; // 0..1 over the banner's lifetime (72 or 46 solver frames, stretched by the pace)
}

export interface PatateFrame {
  readonly frame: number;
  readonly bodies: readonly PatateBodySnapshot[];
  readonly queued: readonly PatateQueuedDrop[];
  readonly shockwaves: readonly PatateShockwave[];
  readonly sparkles: readonly PatateSparkle[];
  readonly callouts: readonly PatateCallout[];
  readonly score: number;
  readonly unlockedUpToFrame: readonly (number | null)[]; // length 8, frame when unlocked or null
}

export type PatateEvent =
  | {
      readonly type: "drop";
      readonly frame: number;
      readonly tier: 1 | 2 | 3;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: "bounce";
      readonly frame: number;
      readonly tier: number;
      readonly speed: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: "merge";
      readonly frame: number;
      readonly tier: 2 | 3 | 4 | 5 | 6 | 7 | 8;
      readonly stem: PatateVoiceStem;
      readonly playbackRate: number;
      readonly banner: string;
      readonly points: number;
      readonly isFirstUnlock: boolean;
      readonly x: number;
      readonly y: number;
    };

export interface PatateTrace {
  readonly spec: PatateCompositionSpec;
  readonly seed: number;
  readonly sceneFrames: number;
  readonly closingFrames: number;
  readonly totalFrames: number;
  readonly frames: readonly PatateFrame[];
  readonly events: readonly PatateEvent[];
  /** Every contact, merge pop and merge shiver, in frame order; the painter turns these into squash-and-stretch. */
  readonly impacts: readonly PatateImpact[];
  readonly unlockFrames: readonly (number | null)[];
  readonly bossMergeFrame: number | null;
  readonly maxScore: number;
}

interface LiveBody {
  id: number;
  tier: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  mass: number;
  theta: number;
  omega: number;
  spawnFrame: number;
  mergedAtFrame: number | null;
  enteredFlask: boolean;
  aimVx: number;
  aimApplied: boolean;
}

interface ActiveShockwave {
  startFrame: number;
  durationFrames: number;
  x: number;
  y: number;
  baseR: number;
  maxR: number;
  accent: string;
  tier: number;
}

interface ActiveSparkle {
  startFrame: number;
  durationFrames: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
}

interface ActiveCallout {
  startFrame: number;
  durationFrames: number;
  text: string;
  x: number;
  y: number;
  accent: string;
  tier: number;
}

const SUBSTEPS = 4;
const FPS = 60;
const DT = 1 / (FPS * SUBSTEPS);
const GRAVITY = 1160;
const RESTITUTION = 0.28;
// The solver steps SUBSTEPS times per solver frame, as it always did. A video frame takes PATATE_PACE.substepsPerFrame
// of those steps, so every rule below keeps counting in solver frames and the merge chain is exactly main's chain.
const SUBSTEPS_PER_VIDEO_FRAME = PATATE_PACE.substepsPerFrame;
const FRICTION = 0.32;
const GRACE_FRAMES = 6;

export const FLASK_JOIN_Y =
  PATATE_FLASK.cy -
  Math.sqrt(
    PATATE_FLASK.radius * PATATE_FLASK.radius -
      PATATE_FLASK.chuteHalfWidth * PATATE_FLASK.chuteHalfWidth,
  );

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A merged potato grows in from 68% and settles. The squash-and-stretch wobble on top of it is volume-preserving
// and comes from the merge's "pop" impact, which the painter turns into a deformation (see feel.ts).
function mergeSpringScale(ageFrames: number): number {
  if (ageFrames < 0 || ageFrames > 32) return 1;
  const t = ageFrames / 32;
  return 1 - 0.32 * Math.exp(-5.2 * t) * Math.cos(t * Math.PI * 3.1);
}

// Lighter potatoes take more of a collision's squash, heavier ones less.
function squashShare(otherMass: number, totalMass: number): number {
  return Math.min(1.7, Math.max(0.3, (2 * otherMass) / totalMass));
}

const MAX_IMPACTS_PER_BODY_FRAME = 3;

// Effect lifetimes are written in solver frames and shown for as many video frames as the pace stretches them to.
const videoFrames = (solverFrames: number) => Math.round(solverFrames * PATATE_FRAME_STRETCH);

const traceCache = new Map<string, PatateTrace>();

export function simulatePatate(
  slug: PatateCompositionSlug,
  seedOverride?: number,
): PatateTrace {
  const spec = getPatateComposition(slug);
  const actualSeed = seedOverride ?? spec.seed;
  const cacheKey = `${slug}:${actualSeed}`;
  const cached = traceCache.get(cacheKey);
  if (cached) return cached;

  const rng = mulberry32(actualSeed);
  const bodies: LiveBody[] = [];
  const events: PatateEvent[] = [];
  const frames: PatateFrame[] = [];
  const shockwaves: ActiveShockwave[] = [];
  const sparkles: ActiveSparkle[] = [];
  const callouts: ActiveCallout[] = [];
  const impacts: PatateImpact[] = [];
  const impactsThisFrame = new Map<number, { frame: number; count: number }>();

  // Solver sub-steps taken so far. The video frame an event belongs to is the one whose snapshot is taken at the
  // end of the sub-step it happens in, so events, impacts and effects carry video frames while every rule keeps
  // counting in solver frames.
  let globalSubstep = 0;
  const videoNow = () => Math.floor(globalSubstep / SUBSTEPS_PER_VIDEO_FRAME);

  // Records one contact or shock on one potato. Slow touches leave no mark, and a jammed potato
  // is capped per frame so the trace stays small.
  const recordImpact = (
    body: { id: number },
    kind: PatateImpactKind,
    nx: number,
    ny: number,
    speed: number,
  ) => {
    if (!(speed > PATATE_SQUASH.minImpactSpeed)) return;
    const length = Math.hypot(nx, ny);
    if (length < 1e-6) return;
    const frame = videoNow();
    const seen = impactsThisFrame.get(body.id);
    if (seen && seen.frame === frame) {
      if (seen.count >= MAX_IMPACTS_PER_BODY_FRAME) return;
      seen.count++;
    } else {
      impactsThisFrame.set(body.id, { frame, count: 1 });
    }
    impacts.push({ frame, bodyId: body.id, kind, nx: nx / length, ny: ny / length, speed });
  };

  const unlockFrames: (number | null)[] = [0, null, null, null, null, null, null, null];
  let score = 0;
  let displayScore = 0;
  let nextId = 1;
  let lastBounceFrame = -20;
  let bossMergeFrame: number | null = null;

  // Build deterministic drop schedule timestamps
  const dropFrames: number[] = [];
  let fCursor = 10;
  while (fCursor <= 1095) {
    dropFrames.push(fCursor);
    const progress = fCursor / 1095;
    // Fast brisk cadence (~21..26 frames = 0.35s..0.43s) so chains fire briskly
    const gap =
      fCursor < 140
        ? 24 + Math.floor(rng() * 5)
        : Math.round(20 + (1 - progress) * 5 + rng() * 4);
    fCursor += gap;
  }

  // Upcoming 2-item visual queue in chute
  interface PlannedDrop {
    id: number;
    tier: 1 | 2 | 3;
    chuteOffset: number;
    theta: number;
  }

  const pickDropPlan = (
    frame: number,
    dropIdx: number,
  ): { tier: 1 | 2 | 3; aimVx: number; chuteOffset: number } => {
    // Scripted early tutorial drops so Tier 2 & Tier 3 always pop crisply in the first 3.2 seconds!
    if (dropIdx === 0) return { tier: 1, aimVx: -28, chuteOffset: -8 };
    if (dropIdx === 1) return { tier: 1, aimVx: -22, chuteOffset: -6 };
    if (dropIdx === 2) return { tier: 2, aimVx: 36, chuteOffset: 6 };
    if (dropIdx === 3) return { tier: 1, aimVx: 28, chuteOffset: 5 };
    if (dropIdx === 4) return { tier: 1, aimVx: 32, chuteOffset: 5 };
    if (dropIdx === 5) return { tier: 3, aimVx: -18, chuteOffset: 0 };

    // Once Tier 8 Boss is forged, only drop occasional tiny celebratory potatoes away from chains
    if (bossMergeFrame !== null) {
      const side = dropIdx % 2 === 0 ? -1 : 1;
      return {
        tier: (dropIdx % 2 === 0 ? 1 : 2) as 1 | 2,
        aimVx: side * (170 + rng() * 60),
        chuteOffset: side * 8,
      };
    }

    // Smart Suika target-seeking AI: inspect exposed bodies in the flask
    // Prefer matching an exposed Tier 3 or Tier 2 or Tier 1 near the top of the pile so chain reactions cascade!
    const flaskBodies = bodies.filter((b) => b.enteredFlask && b.tier <= 3);
    // Find exposed bodies (no other body sitting directly on top of them)
    const exposed = flaskBodies.filter((cand) => {
      return !bodies.some(
        (other) =>
          other.id !== cand.id &&
          other.enteredFlask &&
          other.y < cand.y - cand.r * 0.35 &&
          Math.abs(other.x - cand.x) < (cand.r + other.r) * 0.78,
      );
    });

    const boardValue = bodies.reduce((acc, b) => acc + (1 << (b.tier - 1)), 0);
    // Count tiers currently on board to see what bridges a chain!
    const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const b of bodies) counts[b.tier]++;

    let chosenTier: 1 | 2 | 3 = 3;
    let targetBody: LiveBody | undefined;

    // If Tier 1 is stranded and exposed, pair it cleanly so board stays tidy!
    const exp1 = exposed.filter((b) => b.tier === 1).sort((a, b) => a.y - b.y);
    const exp2 = exposed.filter((b) => b.tier === 2).sort((a, b) => a.y - b.y);
    const exp3 = exposed.filter((b) => b.tier === 3).sort((a, b) => a.y - b.y);

    if (exp1.length > 0 && (counts[1] % 2 === 1 || frame < 260)) {
      chosenTier = 1;
      targetBody = exp1[0];
    } else if (exp3.length > 0 && frame >= 150) {
      chosenTier = 3;
      targetBody = exp3[0];
    } else if (exp2.length > 0 && (counts[2] % 2 === 1 || frame < 420 || rng() < 0.45)) {
      chosenTier = 2;
      targetBody = exp2[0];
    } else {
      // No direct tier 1..3 exposed: pick Tier 3 (fast progress toward Tier 8) or Tier 2 early,
      // and aim near the smallest higher-tier potato (Tier 4 or Tier 5) so newly merged potatoes sit adjacent!
      chosenTier = frame < 220 ? 2 : boardValue >= 124 && counts[2] > 0 ? 2 : 3;
      const higherTargets = bodies
        .filter((b) => b.enteredFlask && b.tier >= 4 && b.tier <= 7)
        .sort((a, b) => a.tier - b.tier || a.y - b.y);
      targetBody = higherTargets[0];
    }

    let aimVx = (rng() - 0.5) * 220;
    if (targetBody) {
      const dx = targetBody.x - PATATE_FLASK.cx;
      const dy = Math.max(120, targetBody.y - FLASK_JOIN_Y);
      const fallTime = Math.sqrt((2 * dy) / GRAVITY) * 0.92;
      const rawVx = dx / Math.max(0.18, fallTime);
      aimVx = Math.max(-340, Math.min(340, rawVx + (rng() - 0.5) * 28));
    }

    const maxOff = Math.max(0, PATATE_FLASK.chuteHalfWidth - PATATE_RADII[chosenTier - 1] - 2.5);
    const chuteOffset = Math.max(
      -maxOff,
      Math.min(maxOff, Math.sign(aimVx) * Math.min(maxOff, Math.abs(aimVx) * 0.04)),
    );

    return { tier: chosenTier, aimVx, chuteOffset };
  };

  let dropCursor = 0;
  let previewQueue: PlannedDrop[] = [
    { id: nextId++, tier: 1, chuteOffset: -8, theta: -0.08 },
    { id: nextId++, tier: 1, chuteOffset: -6, theta: 0.09 },
  ];
  let prevDropFrame = 0;

  // Builds the snapshot of the next video frame. `v` is its index and `solverNow` is the solver-frame time it shows.
  // (A snapshot used to be taken once per solver frame; now it is taken every SUBSTEPS_PER_VIDEO_FRAME sub-steps.)
  const emitSnapshot = (): void => {
    const v = frames.length;
    const solverNow = (v + 1) * PATATE_TIME_SCALE - 1;

    // Smoothly tick displayed score toward target score
    if (displayScore < score) {
      const diff = score - displayScore;
      displayScore += Math.max(1, Math.ceil(diff * 0.24));
      if (displayScore > score) displayScore = score;
    }

    // Compute animated visual queue positions in chute (in solver time, so it slows down with the world)
    const nextDropF = dropCursor < dropFrames.length ? dropFrames[dropCursor] : solverNow + 30;
    const span = Math.max(1, nextDropF - prevDropFrame);
    const slideT = Math.max(0, Math.min(1, (solverNow - prevDropFrame) / span));
    const easeSlide = slideT * slideT * (3 - 2 * slideT);

    const queuedSnapshots: PatateQueuedDrop[] =
      bossMergeFrame !== null
        ? []
        : [
            {
              id: previewQueue[0].id,
              tier: previewQueue[0].tier,
              x: PATATE_FLASK.cx + previewQueue[0].chuteOffset * 0.65,
              y: 138 + easeSlide * (232 - 138),
              r: PATATE_RADII[previewQueue[0].tier - 1] * 0.88,
              theta: previewQueue[0].theta,
              alpha: 0.96,
            },
            {
              id: previewQueue[1].id,
              tier: previewQueue[1].tier,
              x: PATATE_FLASK.cx + previewQueue[1].chuteOffset * 0.45,
              y: 96 + easeSlide * (138 - 96),
              r: PATATE_RADII[previewQueue[1].tier - 1] * 0.78,
              theta: previewQueue[1].theta,
              alpha: Math.min(0.9, 0.25 + easeSlide * 0.75),
            },
          ];

    const activeWaves: PatateShockwave[] = [];
    for (const sw of shockwaves) {
      const age = v - sw.startFrame;
      if (age >= 0 && age <= sw.durationFrames) {
        activeWaves.push({
          x: sw.x,
          y: sw.y,
          baseR: sw.baseR,
          maxR: sw.maxR,
          progress: age / sw.durationFrames,
          accent: sw.accent,
          tier: sw.tier,
        });
      }
    }

    const activeSparkles: PatateSparkle[] = [];
    for (const sp of sparkles) {
      const age = v - sp.startFrame;
      if (age >= 0 && age <= sp.durationFrames) {
        const p = age / sp.durationFrames;
        const sec = (age * PATATE_TIME_SCALE) / FPS; // sparkles fly in solver time, slowed with the world
        activeSparkles.push({
          x: sp.x0 + sp.vx * sec,
          y: sp.y0 + sp.vy * sec + 260 * sec * sec,
          size: sp.size * (1 - p * 0.55),
          alpha: (1 - p) * (1 - p),
          color: sp.color,
        });
      }
    }

    // Keep up to 2 newest callouts visible so rapid chain merges never turn into text soup
    const rawCallouts = callouts.filter(
      (c) => v >= c.startFrame && v <= c.startFrame + c.durationFrames,
    );
    const trimmedCallouts = rawCallouts.slice(-2);
    const activeCallouts: PatateCallout[] = trimmedCallouts.map((c, idx) => ({
      text: c.text,
      x: c.x,
      y:
        trimmedCallouts.length === 2 && idx === 0
          ? Math.max(495, c.y - 54)
          : c.y,
      accent: c.accent,
      tier: c.tier,
      progress: (v - c.startFrame) / c.durationFrames,
    }));

    frames.push({
      frame: v,
      bodies: bodies.map((b) => {
        const grow =
          b.mergedAtFrame !== null ? mergeSpringScale((v - b.mergedAtFrame) * PATATE_TIME_SCALE) : 1;
        return {
          id: b.id,
          tier: b.tier,
          x: b.x,
          y: b.y,
          r: b.r,
          theta: b.theta,
          scaleX: grow,
          scaleY: grow,
          enteredFlask: b.enteredFlask,
        };
      }),
      queued: queuedSnapshots,
      shockwaves: activeWaves,
      sparkles: activeSparkles,
      callouts: activeCallouts,
      score: v === PATATE_SCENE_FRAMES ? score : displayScore,
      unlockedUpToFrame: unlockFrames.map((uf) =>
        uf !== null && uf <= v ? uf : null,
      ),
    });
  };

  for (let frame = 0; frame <= PATATE_SOLVER_SCENE_FRAMES; frame++) {
    // Check scheduled drop
    if (
      dropCursor < dropFrames.length &&
      frame === dropFrames[dropCursor] &&
      bossMergeFrame === null
    ) {
      // Ensure chute exit isn't blocked
      const chuteBlocked = bodies.some(
        (b) => b.y < 330 && Math.abs(b.x - PATATE_FLASK.cx) < 70,
      );
      if (!chuteBlocked) {
        const currentQueued = previewQueue[0];
        const plan = pickDropPlan(frame, dropCursor);
        // For dropCursor >= 2, use the planned tier; keep visual queue synced by planning 2 ahead
        const spawnTier = dropCursor < 2 ? currentQueued.tier : currentQueued.tier;
        const r = PATATE_RADII[spawnTier - 1];
        const maxOff = Math.max(0, PATATE_FLASK.chuteHalfWidth - r - 2.5);
        const xOff = Math.max(-maxOff, Math.min(maxOff, plan.chuteOffset));
        const spawnX = PATATE_FLASK.cx + xOff;
        const spawnY = 232;

        bodies.push({
          id: currentQueued.id,
          tier: spawnTier,
          x: spawnX,
          y: spawnY,
          vx: 0,
          vy: 190,
          r,
          mass: r * r,
          theta: currentQueued.theta,
          omega: (rng() - 0.5) * 1.4,
          spawnFrame: frame,
          mergedAtFrame: null,
          enteredFlask: false,
          aimVx: plan.aimVx,
          aimApplied: false,
        });

        score += 12 * spawnTier;
        events.push({
          type: "drop",
          frame: videoNow(),
          tier: spawnTier,
          x: spawnX,
          y: spawnY,
        });

        // Advance visual queue and choose upcoming slot-1 tier based on live board heuristic
        const futurePlan = pickDropPlan(frame + 36, dropCursor + 2);
        previewQueue = [
          previewQueue[1],
          {
            id: nextId++,
            tier: futurePlan.tier,
            chuteOffset: futurePlan.chuteOffset,
            theta: (rng() - 0.5) * 0.24,
          },
        ];
        prevDropFrame = frame;
        dropCursor++;
      } else {
        // Defer by 6 frames if neck temporarily busy
        dropFrames[dropCursor] += 6;
      }
    }

    // Physics substeps (240 Hz)
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      for (const b of bodies) {
        b.vy += GRAVITY * DT;
        // Apply aimed lateral throw right as the potato clears the chute neck into the flask
        if (!b.aimApplied && b.y >= FLASK_JOIN_Y - 6) {
          b.vx += b.aimVx;
          b.omega += b.aimVx * 0.0085;
          b.aimApplied = true;
        }
        if (!b.enteredFlask && b.y >= FLASK_JOIN_Y + b.r + 14) {
          b.enteredFlask = true;
        }

        b.vx *= 0.9991;
        b.vy *= 0.9991;
        b.omega *= 0.992;

        // Weighted weeble-wobble righting torque on Tier 8 Boss so helmet stays upright & readable
        if (b.tier === 8) {
          b.omega -= b.theta * 18 * DT;
          b.omega *= 0.96;
        }

        b.x += b.vx * DT;
        b.y += b.vy * DT;
        b.theta += b.omega * DT;
        if (b.tier === 8) {
          b.theta = Math.max(-0.32, Math.min(0.32, b.theta));
        }
        // Keep angular speed comedic but readable
        b.omega = Math.max(-6.5, Math.min(6.5, b.omega));
      }

      // Iterative collision & wall resolution
      for (let iter = 0; iter < 3; iter++) {
        // 1. Chute & Flask wall constraints
        for (const b of bodies) {
          if (!b.enteredFlask && b.y < FLASK_JOIN_Y + 10) {
            const leftWall = PATATE_FLASK.cx - PATATE_FLASK.chuteHalfWidth + b.r;
            const rightWall = PATATE_FLASK.cx + PATATE_FLASK.chuteHalfWidth - b.r;
            if (b.x < leftWall) {
              b.x = leftWall;
              if (b.vx < 0) {
                recordImpact(b, "hit", 1, 0, -b.vx);
                b.vx = -b.vx * 0.22;
              }
            } else if (b.x > rightWall) {
              b.x = rightWall;
              if (b.vx > 0) {
                recordImpact(b, "hit", 1, 0, b.vx);
                b.vx = -b.vx * 0.22;
              }
            }
            if (b.y < PATATE_FLASK.chuteTopY + b.r) {
              b.y = PATATE_FLASK.chuteTopY + b.r;
              if (b.vy < 0) b.vy = 0;
            }
          } else {
            // Check neck lip points if still entering
            if (!b.enteredFlask) {
              for (const lipX of [
                PATATE_FLASK.cx - PATATE_FLASK.chuteHalfWidth,
                PATATE_FLASK.cx + PATATE_FLASK.chuteHalfWidth,
              ]) {
                const dx = b.x - lipX;
                const dy = b.y - FLASK_JOIN_Y;
                const d = Math.hypot(dx, dy);
                if (d > 1e-5 && d < b.r) {
                  const nx = dx / d;
                  const ny = dy / d;
                  b.x = lipX + nx * b.r;
                  b.y = FLASK_JOIN_Y + ny * b.r;
                  const vn = b.vx * nx + b.vy * ny;
                  if (vn < 0) {
                    recordImpact(b, "hit", nx, ny, -vn);
                    b.vx -= (1 + 0.25) * vn * nx;
                    b.vy -= (1 + 0.25) * vn * ny;
                  }
                }
              }
            }

            // Circular inner flask wall (cx, cy, R - r)
            const dx = b.x - PATATE_FLASK.cx;
            const dy = b.y - PATATE_FLASK.cy;
            const dist = Math.hypot(dx, dy);
            const maxDist = PATATE_FLASK.radius - PATATE_FLASK.wallThickness * 0.5 - b.r;
            // Allow top neck opening ONLY while !enteredFlask and inside chute x-span
            const inTopOpening =
              !b.enteredFlask &&
              b.y < FLASK_JOIN_Y + b.r &&
              Math.abs(dx) < PATATE_FLASK.chuteHalfWidth - 2;

            if (!inTopOpening && dist > maxDist && dist > 1e-5) {
              const nx = dx / dist; // outward normal
              const ny = dy / dist;
              b.x = PATATE_FLASK.cx + nx * maxDist;
              b.y = PATATE_FLASK.cy + ny * maxDist;

              const vn = b.vx * nx + b.vy * ny; // outward normal speed
              if (vn > 0) {
                const tx = -ny;
                const ty = nx;
                const vt = b.vx * tx + b.vy * ty + b.omega * b.r * 0.35;

                b.vx -= (1 + RESTITUTION) * vn * nx;
                b.vy -= (1 + RESTITUTION) * vn * ny;

                // Rolling friction along curved flask wall
                const fImp = Math.max(
                  -FRICTION * vn,
                  Math.min(FRICTION * vn, -vt * 0.35),
                );
                b.vx += fImp * tx;
                b.vy += fImp * ty;
                b.omega += (fImp / Math.max(24, b.r)) * 1.6;

                if (iter === 0) recordImpact(b, "hit", nx, ny, vn);
                if (iter === 0 && sub === 0 && vn > 195) {
                  if (frame - lastBounceFrame >= 7) {
                    lastBounceFrame = frame;
                    events.push({
                      type: "bounce",
                      frame: videoNow(),
                      tier: b.tier,
                      speed: vn,
                      x: b.x,
                      y: b.y,
                    });
                  }
                }
              }
            }
          }
        }

        // 2. Circle-circle collisions
        for (let i = 0; i < bodies.length; i++) {
          const a = bodies[i];
          for (let j = i + 1; j < bodies.length; j++) {
            const b = bodies[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            const minDist = a.r + b.r;
            if (dist < minDist) {
              const nx = dist > 1e-5 ? dx / dist : 1;
              const ny = dist > 1e-5 ? dy / dist : 0;
              const overlap = minDist - dist;
              const invMa = 1 / a.mass;
              const invMb = 1 / b.mass;
              const invSum = invMa + invMb;

              a.x -= nx * overlap * (invMa / invSum);
              a.y -= ny * overlap * (invMa / invSum);
              b.x += nx * overlap * (invMb / invSum);
              b.y += ny * overlap * (invMb / invSum);

              const rvx = b.vx - a.vx;
              const rvy = b.vy - a.vy;
              const vn = rvx * nx + rvy * ny;
              if (vn < 0) {
                const jImp = (-(1 + RESTITUTION) * vn) / invSum;
                a.vx -= jImp * invMa * nx;
                a.vy -= jImp * invMa * ny;
                b.vx += jImp * invMb * nx;
                b.vy += jImp * invMb * ny;

                // Tangential spin coupling
                const tx = -ny;
                const ty = nx;
                const vt =
                  rvx * tx + rvy * ty + (a.omega * a.r + b.omega * b.r) * 0.25;
                const jt = Math.max(
                  -FRICTION * jImp,
                  Math.min(FRICTION * jImp, (-vt / invSum) * 0.35),
                );
                a.vx -= jt * invMa * tx;
                a.vy -= jt * invMa * ty;
                b.vx += jt * invMb * tx;
                b.vy += jt * invMb * ty;
                a.omega -= (jt * invMa) / Math.max(24, a.r) * 1.4;
                b.omega -= (jt * invMb) / Math.max(24, b.r) * 1.4;

                if (iter === 0) {
                  const totalMass = a.mass + b.mass;
                  recordImpact(a, "hit", nx, ny, -vn * squashShare(b.mass, totalMass));
                  recordImpact(b, "hit", nx, ny, -vn * squashShare(a.mass, totalMass));
                }
                if (iter === 0 && sub === 0 && -vn > 210) {
                  if (frame - lastBounceFrame >= 8) {
                    lastBounceFrame = frame;
                    events.push({
                      type: "bounce",
                      frame: videoNow(),
                      tier: Math.max(a.tier, b.tier),
                      speed: -vn,
                      x: (a.x + b.x) * 0.5,
                      y: (a.y + b.y) * 0.5,
                    });
                  }
                }
              }
            }
          }
        }

        // Post-collision wall clamp so pair separations never push a potato past the inner flask wall
        for (const b of bodies) {
          if (!b.enteredFlask && b.y < FLASK_JOIN_Y + 10) {
            const leftWall = PATATE_FLASK.cx - PATATE_FLASK.chuteHalfWidth + b.r;
            const rightWall = PATATE_FLASK.cx + PATATE_FLASK.chuteHalfWidth - b.r;
            b.x = Math.max(leftWall, Math.min(rightWall, b.x));
            b.y = Math.max(PATATE_FLASK.chuteTopY + b.r, b.y);
          } else {
            const dx = b.x - PATATE_FLASK.cx;
            const dy = b.y - PATATE_FLASK.cy;
            const dist = Math.hypot(dx, dy);
            const maxDist =
              PATATE_FLASK.radius - PATATE_FLASK.wallThickness * 0.5 - b.r;
            const inTopOpening =
              !b.enteredFlask &&
              b.y < FLASK_JOIN_Y + b.r &&
              Math.abs(dx) < PATATE_FLASK.chuteHalfWidth - 2;
            if (!inTopOpening && dist > maxDist && dist > 1e-5) {
              b.x = PATATE_FLASK.cx + (dx / dist) * maxDist;
              b.y = PATATE_FLASK.cy + (dy / dist) * maxDist;
            }
          }
        }
      }

      // 3. Merge detection (at most 1 merge per substep for crisp audio/visual staggering)
      let mergedPair: [number, number] | null = null;
      for (let i = 0; i < bodies.length && !mergedPair; i++) {
        const a = bodies[i];
        if (a.tier >= 8 || frame - a.spawnFrame < GRACE_FRAMES) continue;
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j];
          if (b.tier !== a.tier || frame - b.spawnFrame < GRACE_FRAMES) continue;
          // Only merge inside flask (below neck)
          if (a.y < FLASK_JOIN_Y - 10 || b.y < FLASK_JOIN_Y - 10) continue;
          const dist = Math.hypot(b.x - a.x, b.y - a.y);
          if (dist <= a.r + b.r + 2.0) {
            mergedPair = [i, j];
            break;
          }
        }
      }

      if (mergedPair) {
        const [idxA, idxB] = mergedPair;
        const a = bodies[idxA];
        const b = bodies[idxB];
        const newTier = (a.tier + 1) as 2 | 3 | 4 | 5 | 6 | 7 | 8;
        const tierSpec = spec.tiers[newTier - 1];
        const newR = tierSpec.radius;

        let mx = (a.x + b.x) * 0.5;
        let my = (a.y + b.y) * 0.5;
        // Clamp new larger radius cleanly inside the circular flask
        const dx = mx - PATATE_FLASK.cx;
        const dy = my - PATATE_FLASK.cy;
        const d = Math.hypot(dx, dy);
        const maxDist = PATATE_FLASK.radius - PATATE_FLASK.wallThickness * 0.5 - newR;
        if (d > maxDist && d > 1e-5) {
          mx = PATATE_FLASK.cx + (dx / d) * maxDist;
          my = PATATE_FLASK.cy + (dy / d) * maxDist;
        }

        const mvx = (a.vx + b.vx) * 0.42;
        const mvy = Math.min(60, (a.vy + b.vy) * 0.35 - 75);
        const mOmega = Math.max(-2.6, Math.min(2.6, (a.omega + b.omega) * 0.4));

        // Remove idxB then idxA (idxB > idxA)
        bodies.splice(idxB, 1);
        bodies.splice(idxA, 1);

        // The two potatoes vanish this frame, so contact marks they got this frame would point at nothing.
        for (let i = impacts.length - 1; i >= 0 && impacts[i].frame === videoNow(); i--) {
          if (impacts[i].bodyId === a.id || impacts[i].bodyId === b.id) impacts.splice(i, 1);
        }

        const mergedBody: LiveBody = {
          id: nextId++,
          tier: newTier,
          x: mx,
          y: my,
          vx: mvx,
          vy: mvy,
          r: newR,
          mass: newR * newR,
          theta: (a.theta + b.theta) * 0.5 * 0.35,
          omega: mOmega,
          spawnFrame: frame,
          mergedAtFrame: videoNow(),
          enteredFlask: true,
          aimVx: 0,
          aimApplied: true,
        };
        bodies.push(mergedBody);
        // The new potato lands with a vertical squash that springs back (the painter turns this into a wobble).
        recordImpact(mergedBody, "pop", 0, 1, PATATE_SQUASH.popSpeed);

        // Mild outward radial pop to nearby potatoes to spark satisfying Suika chain reactions!
        const blastRadius = newR * 2.5 + 80;
        const popStrength = newTier === 8 ? 240 : 120 + newTier * 14;
        for (const other of bodies) {
          if (other.id === mergedBody.id) continue;
          const odx = other.x - mx;
          const ody = other.y - my;
          const od = Math.hypot(odx, ody);
          if (od > 1e-4 && od < blastRadius) {
            const falloff = 1 - od / blastRadius;
            other.vx += (odx / od) * popStrength * falloff;
            other.vy += ((ody / od) * popStrength - 35) * falloff;
            // Neighbours shiver along the line to the merge.
            recordImpact(other, "pop", odx / od, ody / od, popStrength * falloff * PATATE_SQUASH.popJiggleGain);
          }
        }

        const isFirstUnlock = unlockFrames[newTier - 1] === null;
        if (isFirstUnlock) {
          unlockFrames[newTier - 1] = videoNow();
        }
        if (newTier === 8 && bossMergeFrame === null) {
          bossMergeFrame = videoNow();
        }

        score += tierSpec.mergePoints;

        if (tierSpec.stem) {
          events.push({
            type: "merge",
            frame: videoNow(),
            tier: newTier,
            stem: tierSpec.stem,
            playbackRate: tierSpec.playbackRate,
            banner: tierSpec.banner,
            points: tierSpec.mergePoints,
            isFirstUnlock,
            x: mx,
            y: my,
          });
        }

        // Concentric shockwave(s)
        shockwaves.push({
          startFrame: videoNow(),
          durationFrames: videoFrames(newTier === 8 ? 44 : 28),
          x: mx,
          y: my,
          baseR: newR * 0.72,
          maxR: newR * (newTier === 8 ? 2.55 : 1.95),
          accent: tierSpec.accent,
          tier: newTier,
        });
        if (newTier >= 6) {
          shockwaves.push({
            startFrame: videoNow() + videoFrames(4),
            durationFrames: videoFrames(newTier === 8 ? 48 : 30),
            x: mx,
            y: my,
            baseR: newR * 0.55,
            maxR: newR * (newTier === 8 ? 2.95 : 2.25),
            accent: "#f8fafc",
            tier: newTier,
          });
        }

        // 14 radial sparkle particles
        const sparkleCount = newTier === 8 ? 22 : 14;
        for (let k = 0; k < sparkleCount; k++) {
          const ang = (k / sparkleCount) * Math.PI * 2 + rng() * 0.32;
          const spd = (150 + newTier * 26) * (0.75 + rng() * 0.55);
          sparkles.push({
            startFrame: videoNow(),
            durationFrames: videoFrames(24 + Math.floor(rng() * 14)),
            x0: mx + Math.cos(ang) * newR * 0.55,
            y0: my + Math.sin(ang) * newR * 0.55,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd - 40,
            size: (newTier === 8 ? 7.5 : 5.0) + rng() * 3.5,
            color: k % 3 === 0 ? "#ffffff" : tierSpec.accent,
          });
        }

        // Floating French title callout badge (keep only recent non-overlapping callouts readable)
        callouts.push({
          startFrame: videoNow(),
          durationFrames: videoFrames(newTier === 8 ? 72 : 46),
          text: tierSpec.banner,
          x: Math.max(250, Math.min(830, mx)),
          y: Math.max(515, Math.min(1230, my - newR * 0.65)),
          accent: tierSpec.accent,
          tier: newTier,
        });
      }

      // One video frame is SUBSTEPS_PER_VIDEO_FRAME solver sub-steps; take its snapshot when they are done.
      globalSubstep++;
      if (globalSubstep % SUBSTEPS_PER_VIDEO_FRAME === 0 && frames.length <= PATATE_SCENE_FRAMES) {
        emitSnapshot();
      }
    }
  }

  const trace: PatateTrace = {
    spec,
    seed: actualSeed,
    sceneFrames: PATATE_SCENE_FRAMES,
    closingFrames: PATATE_CLOSING_FRAMES,
    totalFrames: PATATE_TOTAL_FRAMES,
    frames,
    events,
    impacts,
    unlockFrames,
    bossMergeFrame,
    maxScore: score,
  };

  if (seedOverride === undefined) {
    traceCache.set(cacheKey, trace);
  }
  return trace;
}

export { PATATE_COMPOSITIONS };
