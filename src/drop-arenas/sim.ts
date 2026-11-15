import { VIDEO } from "../settings.ts";

export const DROP_FPS = VIDEO.fps;
export const DROP_SUBSTEPS = 8;
export const DROP_DT = 1 / (DROP_FPS * DROP_SUBSTEPS);

export const DROP_WORLD = {
  left: 100,
  right: 860,
  top: 500,
  bottom: 1396,
  centerX: 480,
} as const;

export const DROP_SAFE = {
  left: 60,
  right: 900,
  top: 220,
  bottom: 1560,
} as const;

export type DropStyleSlug =
  | "drop-plinko-gates"
  | "drop-breakable-rings"
  | "drop-logo-funnel-merge"
  | "drop-pinball-bumpers";

export interface AiModelTierSpec {
  tier: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  name: string;
  shortLabel: string;
  logoKey: string;
  monogram: string;
  radius: number;
  orbFillInner: string;
  orbFillOuter: string;
  rimColor: string;
  iconColor: string;
}

/**
 * Pure 8-Tier AI-Model Progression Ladder:
 * Rich dark/saturated jewel-toned orbs guarantee >= 10:1 icon contrast (never white-on-white).
 */
export const AI_MODEL_TIERS: readonly AiModelTierSpec[] = [
  {
    tier: 1,
    name: "MiniMax",
    shortLabel: "MiniMax",
    logoKey: "minimax",
    monogram: "MM",
    radius: 17,
    orbFillInner: "#6e143b",
    orbFillOuter: "#36081c",
    rimColor: "#ff5c97",
    iconColor: "#ffffff",
  },
  {
    tier: 2,
    name: "GLM",
    shortLabel: "GLM",
    logoKey: "glm",
    monogram: "GL",
    radius: 22,
    orbFillInner: "#0f594f",
    orbFillOuter: "#062b26",
    rimColor: "#2dd4bf",
    iconColor: "#ffffff",
  },
  {
    tier: 3,
    name: "Mistral",
    shortLabel: "Mistral",
    logoKey: "mistral",
    monogram: "MI",
    radius: 27,
    orbFillInner: "#78320d",
    orbFillOuter: "#381504",
    rimColor: "#ff9436",
    iconColor: "#fff7ed",
  },
  {
    tier: 4,
    name: "Qwen",
    shortLabel: "Qwen",
    logoKey: "qwen",
    monogram: "QW",
    radius: 33,
    orbFillInner: "#332087",
    orbFillOuter: "#160d40",
    rimColor: "#9484ff",
    iconColor: "#ffffff",
  },
  {
    tier: 5,
    name: "Kimi",
    shortLabel: "Kimi",
    logoKey: "kimi",
    monogram: "KM",
    radius: 40,
    orbFillInner: "#103a7a",
    orbFillOuter: "#061938",
    rimColor: "#38bdf8",
    iconColor: "#ffffff",
  },
  {
    tier: 6,
    name: "DeepSeek",
    shortLabel: "DeepSeek",
    logoKey: "deepseek",
    monogram: "DS",
    radius: 48,
    orbFillInner: "#173282",
    orbFillOuter: "#081438",
    rimColor: "#60a5fa",
    iconColor: "#f0f7ff",
  },
  {
    tier: 7,
    name: "Claude",
    shortLabel: "Claude",
    logoKey: "claude_tier",
    monogram: "CL",
    radius: 58,
    orbFillInner: "#662914",
    orbFillOuter: "#2e1107",
    rimColor: "#fb923c",
    iconColor: "#ffedd5",
  },
  {
    tier: 8,
    name: "ChatGPT",
    shortLabel: "ChatGPT",
    logoKey: "chatgpt",
    monogram: "GP",
    radius: 72,
    orbFillInner: "#0d5740",
    orbFillOuter: "#042419",
    rimColor: "#c8ff5f",
    iconColor: "#ffffff",
  },
] as const;

export interface DropStyleDefinition {
  slug: DropStyleSlug;
  id: string;
  stageNumber: 1 | 2 | 3 | 4;
  seed: number;
  compactSeed: number;
  title: string;
  ruleLines: readonly [string, string];
}

export const DROP_STYLES: readonly DropStyleDefinition[] = [
  {
    slug: "drop-plinko-gates",
    id: "DropPlinkoGates",
    stageNumber: 1,
    seed: 111401,
    compactSeed: 211434,
    title: "Plinko Multiplier Gates",
    ruleLines: [
      "+2 gate adds · x2 & x3 gates multiply ball value",
      "Shatter all 5 shields: 100 → 500 → 2K → 5K → 10K",
    ],
  },
  {
    slug: "drop-breakable-rings",
    id: "DropBreakableRings",
    stageNumber: 2,
    seed: 111402,
    compactSeed: 211407,
    title: "Concentric Breakable Rings",
    ruleLines: [
      "Every bounce cracks a rotating neon ring segment",
      "Reach the inner core, then escape to the bottom goal",
    ],
  },
  {
    slug: "drop-logo-funnel-merge",
    id: "DropLogoFunnelMerge",
    stageNumber: 3,
    seed: 111408,
    compactSeed: 211400,
    title: "Bouncy AI-Model Funnel",
    ruleLines: [
      "Drop MiniMax orbs · matching AI tiers merge & bounce",
      "Climb 8 tiers: MiniMax → GLM → Mistral → Qwen → Kimi → DeepSeek → Claude → ChatGPT",
    ],
  },
  {
    slug: "drop-pinball-bumpers",
    id: "DropPinballBumpers",
    stageNumber: 4,
    seed: 111405,
    compactSeed: 211412,
    title: "Neon Pinball Bumpers",
    ruleLines: [
      "Bumpers add +15 · twin rotors double value (x2)",
      "Landed orbs fill the neon score tank past 97%",
    ],
  },
] as const;

export const PLINKO_PEGS = Array.from({ length: 5 }, (_, row) =>
  Array.from({ length: 9 }, (_, col) => ({
    x: 155 + col * 78 + (row % 2) * 34,
    y: 635 + row * 70,
    r: 8,
  })),
)
  .flat()
  .filter((p) => p.x < 845);

export const PINBALL_BUMPERS = [
  { x: 290, y: 675, r: 56 },
  { x: 665, y: 720, r: 62 },
  { x: 465, y: 905, r: 64 },
  { x: 230, y: 1040, r: 48 },
  { x: 745, y: 1030, r: 48 },
] as const;

export const BREAKABLE_RING_RADII = [345, 295, 245, 195, 145, 95] as const;
export const RING_SEGMENTS = 18;
export const RING_CENTER = { x: 480, y: 950 } as const;
export const RING_GOAL = { left: 100, right: 860, top: 1352, bottom: 1396, entryY: 1374 } as const;
export const PINBALL_TANK = { x: 110, y: 1242, width: 740, height: 146, target: 10000 } as const;

export function funnelBowlY(x: number): number {
  return 1372 - 0.00275 * (x - 480) ** 2;
}

export function ringRotation(ringIndex: number, timeSeconds: number): number {
  return -Math.PI / 2 - Math.PI / RING_SEGMENTS + (0.22 + ringIndex * 0.025) * timeSeconds;
}

export function pinballSpinner(index: number, timeSeconds: number) {
  const x = index === 0 ? 475 : 480;
  const y = index === 0 ? 792 : 1118;
  const length = index === 0 ? 232 : 252;
  const omega = index === 0 ? 2.2 : Math.cos(timeSeconds * 1.8) * 1.15;
  const a = index === 0 ? timeSeconds * 2.2 + 0.3 : Math.sin(timeSeconds * 1.8) * 0.62;
  return {
    x,
    y,
    omega,
    ax: x - (Math.cos(a) * length) / 2,
    ay: y - (Math.sin(a) * length) / 2,
    bx: x + (Math.cos(a) * length) / 2,
    by: y + (Math.sin(a) * length) / 2,
  };
}

export interface DropOrb {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  tier: number;
  value: number;
  mass: number;
  entered: boolean;
  passed: number;
  /** Spring-damped squash-and-stretch scalar in [-0.28, 0.28]. scaleNormal = 1 - squash, scaleTangent = 1 / scaleNormal */
  squash: number;
  squashVel: number;
  squashAngle: number;
}

export interface DropEvent {
  frame: number;
  type: "spawn" | "merge" | "gate" | "upgrade" | "shield" | "ring" | "deposit" | "goal" | "climax" | "bounce";
  id?: number;
  parents?: [number, number];
  tier?: number;
  value?: number;
  mass?: number;
  x: number;
  y: number;
  target?: number;
  before?: number;
  after?: number;
  kind?: string;
}

export interface DropFrame {
  frame: number;
  balls: DropOrb[];
  spawned: number;
  removedMass: number;
  depositedValue: number;
  fill: number;
  shields: number[];
  rings: number[][];
  maxTierReached: number;
  climaxReached: boolean;
  climaxFrame: number | null;
}

export interface DropTrace {
  style: DropStyleSlug;
  mode: "standalone" | "compact";
  definition: DropStyleDefinition;
  seed: number;
  fps: number;
  frames: DropFrame[];
  events: DropEvent[];
  climaxFrame: number;
  celebrationFrames: number;
  closingFrames: number;
  totalFrames: number;
  resultBanner: string;
}

export interface CombinedDropTimeline {
  stages: {
    startFrame: number;
    endFrame: number;
    trace: DropTrace;
  }[];
  sceneFrames: number;
  closingFrames: number;
  totalFrames: number;
}

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function triggerSquash(b: DropOrb, nx: number, ny: number, closingSpeed: number, boost = 1) {
  const amp = clamp((Math.abs(closingSpeed) / 470) * boost, 0.06, 0.26);
  if (amp > b.squash) {
    b.squash = amp;
    b.squashVel = Math.max(b.squashVel, amp * 7.5);
    b.squashAngle = Math.atan2(ny, nx);
  }
}

function stepSquashSpring(b: DropOrb, dt: number) {
  // Underdamped spring: omega_0 = 27 rad/s (~4.3 Hz), zeta = 0.21
  const accel = -729 * b.squash - 11.34 * b.squashVel;
  b.squashVel += accel * dt;
  b.squash = clamp(b.squash + b.squashVel * dt, -0.28, 0.28);
  // Subtle velocity-aligned stretch when airborne and spring has relaxed
  const speed = Math.hypot(b.vx, b.vy);
  if (Math.abs(b.squash) < 0.03 && speed > 420) {
    b.squashAngle = Math.atan2(b.vy, b.vx) + Math.PI / 2;
  }
}

function resolveWalls(b: DropOrb, restitution = 0.84) {
  if (b.x - b.r < DROP_WORLD.left) {
    const vn = b.vx;
    b.x = DROP_WORLD.left + b.r;
    b.vx = Math.abs(b.vx) * restitution;
    if (vn < -80) triggerSquash(b, 1, 0, -vn);
  } else if (b.x + b.r > DROP_WORLD.right) {
    const vn = b.vx;
    b.x = DROP_WORLD.right - b.r;
    b.vx = -Math.abs(b.vx) * restitution;
    if (vn > 80) triggerSquash(b, -1, 0, vn);
  }
  if (b.y - b.r < DROP_WORLD.top) {
    const vn = b.vy;
    b.y = DROP_WORLD.top + b.r;
    b.vy = Math.abs(b.vy) * restitution;
    if (vn < -80) triggerSquash(b, 0, 1, -vn);
  }
}

function collideStaticDisc(b: DropOrb, x: number, y: number, r: number, restitution: number): boolean {
  let dx = b.x - x;
  let dy = b.y - y;
  let d = Math.hypot(dx, dy);
  const sum = b.r + r;
  if (d >= sum) return false;
  if (d < 1e-8) {
    dx = 1;
    dy = 0;
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  b.x = x + nx * (sum + 0.02);
  b.y = y + ny * (sum + 0.02);
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + restitution) * vn * nx;
    b.vy -= (1 + restitution) * vn * ny;
    triggerSquash(b, nx, ny, -vn);
  }
  return true;
}

function collideSpinnerSegment(
  b: DropOrb,
  seg: { ax: number; ay: number; bx: number; by: number; x: number; y: number; omega: number },
): boolean {
  const dx = seg.bx - seg.ax;
  const dy = seg.by - seg.ay;
  const t = clamp(((b.x - seg.ax) * dx + (b.y - seg.ay) * dy) / (dx * dx + dy * dy), 0, 1);
  const px = seg.ax + dx * t;
  const py = seg.ay + dy * t;
  const ex = b.x - px;
  const ey = b.y - py;
  const d = Math.hypot(ex, ey);
  if (d >= b.r + 9) return false;
  const nx = d > 1e-8 ? ex / d : 0;
  const ny = d > 1e-8 ? ey / d : -1;
  b.x = px + nx * (b.r + 9.02);
  b.y = py + ny * (b.r + 9.02);
  const ux = -(py - seg.y) * seg.omega;
  const uy = (px - seg.x) * seg.omega;
  const vn = (b.vx - ux) * nx + (b.vy - uy) * ny;
  if (vn < 0) {
    b.vx -= 1.75 * vn * nx;
    b.vy -= 1.75 * vn * ny;
    triggerSquash(b, nx, ny, -vn);
  }
  return true;
}

/**
 * Exact closest-point contact against the parabolic funnel y = funnelBowlY(x),
 * preventing large orbs from penetrating sloped walls and giving bouncy restitution.
 */
function collideFunnelBowl(b: DropOrb, restitution = 0.72): number {
  // Sample local neighbourhood around b.x to find closest point on parabola
  let bestX = clamp(b.x, DROP_WORLD.left + 4, DROP_WORLD.right - 4);
  for (let iter = 0; iter < 5; iter++) {
    const yCurve = funnelBowlY(bestX);
    const dydx = -0.0055 * (bestX - 480);
    // Minimize f(u) = 0.5 * ((u - bx)^2 + (y(u) - by)^2)
    const grad = bestX - b.x + (yCurve - b.y) * dydx;
    const hess = 1 + dydx * dydx + (yCurve - b.y) * -0.0055;
    bestX = clamp(bestX - grad / Math.max(0.2, hess), DROP_WORLD.left + 4, DROP_WORLD.right - 4);
  }
  const cy = funnelBowlY(bestX);
  const dydx = -0.0055 * (bestX - 480);
  const invLen = 1 / Math.hypot(dydx, 1);
  // Upward-inward unit normal into the bowl interior
  const nx = dydx * invLen;
  const ny = -invLen;
  const signedDist = (b.x - bestX) * nx + (b.y - cy) * ny;
  if (signedDist >= b.r) return 0;

  const overlap = b.r - signedDist;
  b.x += nx * (overlap + 0.02);
  b.y += ny * (overlap + 0.02);
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + restitution) * vn * nx;
    b.vy -= (1 + restitution) * vn * ny;
    // Keep orbs lively & playful so they hop around instead of dead-settling
    const postVn = b.vx * nx + b.vy * ny;
    if (-vn > 150 && postVn < 165) {
      const lift = 165 - postVn;
      b.vx += lift * nx;
      b.vy += lift * ny;
    }
    triggerSquash(b, nx, ny, -vn, 1.15);
    return -vn;
  }
  return 0;
}

function resolveOrbPair(a: DropOrb, b: DropOrb, restitution: number) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  const sum = a.r + b.r;
  if (d >= sum) return;
  if (d < 1e-7) {
    dx = a.id % 2 === 0 ? 1 : -1;
    dy = 0;
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  const overlap = sum - d + 0.02;
  const total = a.mass + b.mass;
  a.x -= (nx * overlap * b.mass) / total;
  a.y -= (ny * overlap * b.mass) / total;
  b.x += (nx * overlap * a.mass) / total;
  b.y += (ny * overlap * a.mass) / total;
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel < 0) {
    const impulse = (-(1 + restitution) * rel) / (1 / a.mass + 1 / b.mass);
    a.vx -= (impulse * nx) / a.mass;
    a.vy -= (impulse * ny) / a.mass;
    b.vx += (impulse * nx) / b.mass;
    b.vy += (impulse * ny) / b.mass;
    triggerSquash(a, -nx, -ny, -rel, 1.05);
    triggerSquash(b, nx, ny, -rel, 1.05);
  }
}

function mergeEqualOrbs(a: DropOrb, b: DropOrb, nextId: number): DropOrb | null {
  if (a.tier !== b.tier || a.tier >= 8) return null;
  const nextTier = (a.tier + 1) as 2 | 3 | 4 | 5 | 6 | 7 | 8;
  const spec = AI_MODEL_TIERS[nextTier - 1];
  const mass = a.mass + b.mass;
  const vx = clamp((a.vx * a.mass + b.vx * b.mass) / mass, -460, 460);
  const baseVy = (a.vy * a.mass + b.vy * b.mass) / mass;
  // Joyful upward bounce pop on merge so newly forged model jumps visibly!
  const popVy = Math.min(baseVy, -295 - nextTier * 22);
  return {
    id: nextId,
    x: (a.x * a.mass + b.x * b.mass) / mass,
    y: (a.y * a.mass + b.y * b.mass) / mass - 4,
    vx,
    vy: popVy,
    r: spec.radius,
    tier: nextTier,
    value: a.value + b.value,
    mass,
    entered: false,
    passed: 0,
    squash: -0.22,
    squashVel: 3.8,
    squashAngle: -Math.PI / 2,
  };
}

function ringContact(
  b: DropOrb,
  ri: number,
  hp: number[],
  timeSeconds: number,
  onHit: (segment: number, approachSpeed: number) => void,
) {
  const R = BREAKABLE_RING_RADII[ri];
  const cx = RING_CENTER.x;
  const cy = RING_CENTER.y;
  const rot = ringRotation(ri, timeSeconds);
  const angle = Math.atan2(b.y - cy, b.x - cx);
  const local = (((angle - rot) % TAU) + TAU) % TAU;
  const index = Math.floor((local / TAU) * RING_SEGMENTS);
  for (let o = -1; o <= 1; o++) {
    // Allow a 2-segment gap (segments 0 and 1) in compact mode or 1-segment gap in standalone
    const k = (index + o + RING_SEGMENTS) % RING_SEGMENTS;
    if (hp[k] <= 0) continue;
    const a = rot + (k * TAU) / RING_SEGMENTS;
    const z = a + TAU / RING_SEGMENTS;
    let closest = angle;
    const rel = (((angle - a) % TAU) + TAU) % TAU;
    if (rel > TAU / RING_SEGMENTS) {
      const p0 = { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R };
      const p1 = { x: cx + Math.cos(z) * R, y: cy + Math.sin(z) * R };
      closest = Math.hypot(b.x - p0.x, b.y - p0.y) < Math.hypot(b.x - p1.x, b.y - p1.y) ? a : z;
    }
    const px = cx + Math.cos(closest) * R;
    const py = cy + Math.sin(closest) * R;
    const dx = b.x - px;
    const dy = b.y - py;
    const d = Math.hypot(dx, dy);
    if (d > b.r + 3.5) continue;
    const nx = d > 1e-8 ? dx / d : Math.cos(closest);
    const ny = d > 1e-8 ? dy / d : Math.sin(closest);
    b.x = px + nx * (b.r + 3.52);
    b.y = py + ny * (b.r + 3.52);
    const omega = 0.22 + ri * 0.025;
    const ux = -(py - cy) * omega;
    const uy = (px - cx) * omega;
    const vn = (b.vx - ux) * nx + (b.vy - uy) * ny;
    if (vn < 0) {
      b.vx -= 1.92 * vn * nx;
      b.vy -= 1.92 * vn * ny;
      triggerSquash(b, nx, ny, -vn);
      onHit(k, -vn);
    }
  }
}

const TRACE_CACHE = new Map<string, DropTrace>();

export function simulateDropArena(
  slug: DropStyleSlug,
  mode: "standalone" | "compact" = "standalone",
  seedOverride?: number,
): DropTrace {
  const cacheKey = `${slug}:${mode}`;
  if (seedOverride === undefined) {
    const hit = TRACE_CACHE.get(cacheKey);
    if (hit) return hit;
  }

  const definition = DROP_STYLES.find((s) => s.slug === slug);
  if (!definition) throw new Error(`Unknown drop style: ${slug}`);
  const isCompact = mode === "compact";
  const seed = seedOverride ?? (isCompact ? definition.compactSeed : definition.seed);
  const random = makeRng(seed);

  const isMerge = slug === "drop-logo-funnel-merge";
  const isPlinko = slug === "drop-plinko-gates";
  const isRings = slug === "drop-breakable-rings";
  const isPinball = slug === "drop-pinball-bumpers";

  const celebrationFrames = isMerge ? (isCompact ? 132 : 210) : isCompact ? 84 : 120;
  const closingFrames = 150; // 2.5s GetTheCodeEndCard for standalone

  const shields = isCompact ? [60, 240, 900, 2400, 5000] : [100, 500, 2000, 5000, 10000];
  const gapSegments = 1;
  const rings: number[][] = BREAKABLE_RING_RADII.map((_, ri) =>
    Array.from({ length: RING_SEGMENTS }, (__, seg) =>
      seg < gapSegments ? 0 : isCompact ? (ri < 4 ? 2 : 1) : 2,
    ),
  );
  const tankTarget = isCompact ? 4200 : PINBALL_TANK.target;

  const events: DropEvent[] = [];
  const frames: DropFrame[] = [];
  const balls: DropOrb[] = [];
  const contacts = new Map<number, Set<string>>();

  let nextId = 0;
  let spawned = 0;
  let removedMass = 0;
  let depositedValue = 0;
  let maxTierReached = 0;
  let climaxFrame: number | null = null;
  let resultBanner = "";

  const spawnInterval = isMerge
    ? isCompact
      ? 3
      : 11
    : isRings
      ? isCompact
        ? 14
        : 18
      : isPlinko
        ? isCompact
          ? 6
          : 10
        : isCompact
          ? 6
          : 10;

  const maxClimaxSearchFrames = (isCompact ? 16 : 36) * DROP_FPS;

  const snapshot = (frame: number) => {
    frames.push({
      frame,
      balls: balls.map((b) => ({ ...b })),
      spawned,
      removedMass,
      depositedValue,
      fill: Math.min(1, depositedValue / tankTarget),
      shields: [...shields],
      rings: rings.map((row) => [...row]),
      maxTierReached,
      climaxReached: climaxFrame !== null,
      climaxFrame,
    });
  };

  snapshot(0);

  let frame = 0;
  while (climaxFrame === null ? frame < maxClimaxSearchFrames : frame < climaxFrame + celebrationFrames) {
    frame++;

    // Spawn base orbs ONLY while climax has not yet been reached
    const maxLive = isMerge ? (isCompact ? 96 : 84) : isRings ? 55 : 110;
    if (
      climaxFrame === null &&
      frame >= 2 &&
      (frame - 2) % spawnInterval === 0 &&
      balls.length < maxLive
    ) {
      const streams = isMerge ? (isCompact ? [-76, 0, 76] : [-44, 44]) : [0];
      for (const offset of streams) {
        const r = isMerge ? AI_MODEL_TIERS[0].radius : 14;
        const x = DROP_WORLD.centerX + offset + (random() - 0.5) * (streams.length > 1 ? 22 : 38);
        const y = 524;
        if (!balls.some((b) => Math.hypot(x - b.x, y - b.y) < r + b.r + 2)) {
          const orb: DropOrb = {
            id: nextId++,
            x,
            y,
            vx: (random() - 0.5) * (isMerge ? 260 : 160),
            vy: isMerge ? 210 : 125,
            r,
            tier: 1,
            value: 1,
            mass: 1,
            entered: false,
            passed: 0,
            squash: -0.1,
            squashVel: 1.5,
            squashAngle: -Math.PI / 2,
          };
          balls.push(orb);
          spawned++;
          maxTierReached = Math.max(maxTierReached, 1);
          contacts.set(orb.id, new Set());
          events.push({ frame, type: "spawn", id: orb.id, tier: 1, value: 1, mass: 1, x, y });
        }
      }
    }

    for (let sub = 0; sub < DROP_SUBSTEPS; sub++) {
      const timeSeconds = (frame - 1 + (sub + 1) / DROP_SUBSTEPS) / DROP_FPS;

      for (const b of balls) {
        const gravity = isMerge ? 980 : 1060;
        b.vy += gravity * DROP_DT;
        const maxSpeed = isMerge ? 880 : 920;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > maxSpeed) {
          b.vx *= maxSpeed / sp;
          b.vy *= maxSpeed / sp;
        }
        const oldY = b.y;
        b.x += b.vx * DROP_DT;
        b.y += b.vy * DROP_DT;
        stepSquashSpring(b, DROP_DT);
        resolveWalls(b, isMerge ? 0.76 : 0.88);

        const touch = contacts.get(b.id)!;

        if (isPlinko) {
          for (const peg of PLINKO_PEGS) collideStaticDisc(b, peg.x, peg.y, peg.r, 0.86);
          const gates: readonly (readonly ["+2" | "x2" | "x3", number])[] = isCompact
            ? [
                ["+2", 965],
                ["x2", 1065],
                ["x3", 1155],
              ]
            : [
                ["+2", 985],
                ["x2", 1115],
              ];
          for (const [kind, gy] of gates) {
            if (oldY < gy && b.y >= gy) {
              const before = b.value;
              const after = kind === "+2" ? before + 2 : kind === "x2" ? before * 2 : before * 3;
              b.value = after;
              events.push({ frame, type: "gate", id: b.id, x: b.x, y: b.y, before, after, kind });
            }
          }
          const active = shields.findIndex((hp) => hp > 0);
          if (active >= 0) {
            const fy = 1250 + active * 16;
            const key = `shield:${active}`;
            if (b.y + b.r >= fy) {
              b.y = fy - b.r;
              if (b.vy > 0) {
                const impact = b.vy;
                b.vy = -Math.max(630, Math.abs(b.vy) * 0.96);
                triggerSquash(b, 0, -1, impact);
                if (!touch.has(key)) {
                  const before = shields[active];
                  const after = Math.max(0, before - b.value);
                  shields[active] = after;
                  events.push({
                    frame,
                    type: "shield",
                    id: b.id,
                    x: b.x,
                    y: b.y,
                    target: active,
                    before,
                    after,
                    value: b.value,
                  });
                  touch.add(key);
                }
              }
            } else if (b.y + b.r < fy - 3) {
              touch.delete(key);
            }
          }
        } else if (isRings) {
          for (let ri = 0; ri < rings.length; ri++) {
            ringContact(b, ri, rings[ri], timeSeconds, (seg, approachSpeed) => {
              const key = `ring:${ri}`;
              if (!touch.has(key)) {
                const before = rings[ri][seg];
                const after = Math.max(0, before - 1);
                rings[ri][seg] = after;
                events.push({
                  frame,
                  type: "ring",
                  id: b.id,
                  x: b.x,
                  y: b.y,
                  target: ri * RING_SEGMENTS + seg,
                  before,
                  after,
                  value: Math.round(approachSpeed),
                });
                touch.add(key);
              }
            });
            if (Math.abs(Math.hypot(b.x - RING_CENTER.x, b.y - RING_CENTER.y) - BREAKABLE_RING_RADII[ri]) > b.r + 8) {
              touch.delete(`ring:${ri}`);
            }
          }
          const dist = Math.hypot(b.x - RING_CENTER.x, b.y - RING_CENTER.y);
          if (!b.entered && dist < BREAKABLE_RING_RADII[5] - b.r - 2) {
            b.entered = true;
          }
          if (b.entered) {
            BREAKABLE_RING_RADII.forEach((rad, k) => {
              if (dist > rad + b.r + 2) b.passed |= 1 << k;
            });
          }
        } else if (isMerge) {
          const bounceSpeed = collideFunnelBowl(b, 0.74);
          if (bounceSpeed > 240 && sub === 0) {
            events.push({ frame, type: "bounce", id: b.id, tier: b.tier, x: b.x, y: b.y });
          }
          // During post-Tier-8 celebration, keep gentle energetic hops alive so ChatGPT dances!
          if (climaxFrame !== null && b.tier === 8 && bounceSpeed > 60 && b.vy > -280) {
            b.vy = -340;
            triggerSquash(b, 0, -1, 340, 1.25);
          }
        } else if (isPinball) {
          PINBALL_BUMPERS.forEach((peg, k) => {
            const key = `bumper:${k}`;
            if (collideStaticDisc(b, peg.x, peg.y, peg.r, 1.04)) {
              if (!touch.has(key)) {
                const before = b.value;
                b.value += 15;
                events.push({
                  frame,
                  type: "upgrade",
                  id: b.id,
                  x: b.x,
                  y: b.y,
                  target: k,
                  before,
                  after: b.value,
                  kind: "+15",
                });
                touch.add(key);
              }
            } else if (Math.hypot(b.x - peg.x, b.y - peg.y) > b.r + peg.r + 4) {
              touch.delete(key);
            }
          });
          for (let k = 0; k < 2; k++) {
            const key = `spinner:${k}`;
            if (collideSpinnerSegment(b, pinballSpinner(k, timeSeconds))) {
              if (!touch.has(key)) {
                const before = b.value;
                b.value *= 2;
                events.push({
                  frame,
                  type: "upgrade",
                  id: b.id,
                  x: b.x,
                  y: b.y,
                  target: k + 5,
                  before,
                  after: b.value,
                  kind: "x2",
                });
                touch.add(key);
              }
            } else {
              touch.delete(key);
            }
          }
        }
      }

      // Gentle same-tier resonance pull in funnel merge so matching AI models gravitate together while bouncing
      if (isMerge && climaxFrame === null) {
        for (let i = 0; i < balls.length; i++) {
          const p = balls[i];
          if (p.y < 760) continue;
          for (let j = i + 1; j < balls.length; j++) {
            const q = balls[j];
            if (p.tier !== q.tier || q.y < 760) continue;
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const dist = Math.hypot(dx, dy);
            if (dist > p.r + q.r && dist < 340) {
              const pull = (190 + p.tier * 48) * DROP_DT;
              const ux = dx / dist;
              const uy = dy / dist;
              p.vx += ux * pull;
              p.vy += uy * pull * 0.55;
              q.vx -= ux * pull;
              q.vy -= uy * pull * 0.55;
            }
          }
        }
      }

      // Pairwise orb interactions & bouncy merges
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const p = balls[i];
          const q = balls[j];
          if (Math.hypot(p.x - q.x, p.y - q.y) > p.r + q.r) continue;
          if (isMerge) {
            const merged = mergeEqualOrbs(p, q, nextId);
            if (merged) {
              nextId++;
              maxTierReached = Math.max(maxTierReached, merged.tier);
              events.push({
                frame,
                type: "merge",
                id: merged.id,
                parents: [p.id, q.id],
                tier: merged.tier,
                mass: merged.mass,
                value: merged.value,
                x: merged.x,
                y: merged.y,
              });
              contacts.delete(p.id);
              contacts.delete(q.id);
              contacts.set(merged.id, new Set());
              balls[i] = merged;
              balls.splice(j, 1);
              j = i;

              if (merged.tier === 8 && climaxFrame === null) {
                climaxFrame = frame;
                resultBanner = "TIER 8 REACHED · CHATGPT";
                events.push({
                  frame,
                  type: "climax",
                  id: merged.id,
                  tier: 8,
                  x: merged.x,
                  y: merged.y,
                });
                // Celebratory shockwave impulse to surrounding orbs so the whole bowl jumps!
                for (const other of balls) {
                  if (other.id === merged.id) continue;
                  const dx = other.x - merged.x;
                  const dy = other.y - merged.y;
                  const dist = Math.max(24, Math.hypot(dx, dy));
                  other.vx += (dx / dist) * 240;
                  other.vy = Math.min(other.vy - 260, -240);
                  triggerSquash(other, dx / dist, dy / dist, 320, 1.2);
                }
              }
              continue;
            }
          }
          resolveOrbPair(p, q, isMerge ? 0.72 : 0.68);
        }
      }

      // Enforce boundaries after pairwise resolution
      for (const b of balls) {
        resolveWalls(b, isMerge ? 0.76 : 0.88);
        if (isMerge) collideFunnelBowl(b, 0.74);
      }

      // Deposits, ring escapes, & floor bounces
      for (let k = balls.length - 1; k >= 0; k--) {
        const b = balls[k];
        const deposit = isPinball && climaxFrame === null && b.y + b.r >= 1236;
        const escaped = isRings && b.entered && b.passed === 63 && b.y + b.r >= RING_GOAL.entryY;
        if (deposit || escaped) {
          if (deposit) depositedValue += b.value;
          removedMass += b.mass;
          events.push({
            frame,
            type: deposit ? "deposit" : "goal",
            id: b.id,
            value: b.value,
            mass: b.mass,
            x: b.x,
            y: b.y,
          });
          contacts.delete(b.id);
          balls.splice(k, 1);
          if (escaped && climaxFrame === null) {
            climaxFrame = frame;
            resultBanner = "ALL 6 RINGS ESCAPED";
            events.push({ frame, type: "climax", x: b.x, y: b.y });
          }
        } else if (b.y + b.r > DROP_WORLD.bottom) {
          const impact = b.vy;
          b.y = DROP_WORLD.bottom - b.r;
          b.vy = -Math.max(540, Math.abs(b.vy) * 0.88);
          if (impact > 80) triggerSquash(b, 0, -1, impact);
        }
      }

      if (climaxFrame === null) {
        if (isPlinko && shields.every((hp) => hp === 0)) {
          climaxFrame = frame;
          resultBanner = "5 / 5 SHIELDS SHATTERED";
          events.push({ frame, type: "climax", x: 480, y: 1280 });
        } else if (isPinball && depositedValue / tankTarget >= 0.97) {
          climaxFrame = frame;
          const pct = Math.min(100, Math.floor((depositedValue / tankTarget) * 100));
          resultBanner = `NEON TANK FILLED · ${pct}%`;
          events.push({ frame, type: "climax", x: 480, y: 1300 });
        }
      }
    }

    snapshot(frame);
  }

  if (climaxFrame === null) {
    throw new Error(`${definition.id} (${mode}, seed=${seed}) did not reach climax within ${maxClimaxSearchFrames} frames`);
  }

  const trace: DropTrace = {
    style: slug,
    mode,
    definition,
    seed,
    fps: DROP_FPS,
    frames,
    events,
    climaxFrame,
    celebrationFrames,
    closingFrames,
    totalFrames: frames.length - 1 + closingFrames,
    resultBanner,
  };
  if (seedOverride === undefined) {
    TRACE_CACHE.set(cacheKey, trace);
  }
  return trace;
}

let cachedCombinedDrops: CombinedDropTimeline | undefined;

export function buildCombinedDropTimeline(): CombinedDropTimeline {
  if (cachedCombinedDrops) return cachedCombinedDrops;
  let cursor = 0;
  const stages = DROP_STYLES.map((def) => {
    const trace = simulateDropArena(def.slug, "compact");
    const stageDuration = trace.frames.length - 1;
    const startFrame = cursor;
    const endFrame = startFrame + stageDuration;
    cursor = endFrame;
    return { startFrame, endFrame, trace };
  });
  cachedCombinedDrops = {
    stages,
    sceneFrames: cursor,
    closingFrames: 150, // 2.5s GetTheCodeEndCard
    totalFrames: cursor + 150,
  };
  return cachedCombinedDrops;
}
