import { FPS, H, W, createRng, digestNumbers, fnv1a } from "../kit.ts";
import { HIT_SEED } from "../types.ts";

/**
 * BrickEscape simulation: one ball in a sealed chamber (the canvas edges are the walls).
 * Every wall bounce lays one brick on the wall slot that was hit, every brick shrinks the exit.
 *
 * Model
 * - Each wall is a 1-D profile of brick levels over slots (48 px on the long walls, 1080/22 px on the short ones).
 *   A slot column is a rectangle `lining + 40 px x level` thick. The ball is a circle that collides with those
 *   rectangles, so it meets front faces, side faces and corners the way a viewer expects.
 * - The exit is a gap in the LEFT wall at y = 900. Its width is `doorW0 - doorDelta x bricks`; the two posts are
 *   the ends of the wall columns next to the gap, so a ball that grazes a post bounces (and lays a brick).
 * - Speed is constant, reflections only rotate the velocity, so the whole run is piecewise linear and every
 *   constant below can be tuned without touching the seed.
 * - The simulation runs on a fine step clock (360 Hz). A small online "last chance" slow motion maps video
 *   frames to fractional steps, so the final approach to the exit is readable. Physics never depends on it.
 */

export const SCENE_SECONDS = 24;
export const SCENE_FRAMES = SCENE_SECONDS * FPS;

/** Ode to Joy (Beethoven, public domain) in C major; each bounce plays the next note, looping. */
export const ODE_TO_JOY: readonly number[] = [
  64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62,
  64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60,
];

export const WALL = { left: 0, right: 1, top: 2, bottom: 3 } as const;

export interface BrickParams {
  /** Ball speed in px/s. */
  readonly speed: number;
  /** Launch angle away from the horizontal, in degrees; the seeded rng adds `angleJitterDeg` at most. */
  readonly angleDeg: number;
  readonly angleJitterDeg: number;
  /** Exit width at frame 0, and how much every brick takes off it, in px. */
  readonly doorW0: number;
  readonly doorDelta: number;
}

export const BRICK = {
  ballR: 30,
  stepHz: 360,
  slotsV: 40,
  slotsH: 22,
  lining: 12,
  brickDepth: 40,
  capPx: 280,
  maxLevel: 6,
  doorY: 900,
  popFrames: 6,
  trailLen: 14,
  /** Contacts on the same wall closer than this many fine steps count as one bounce (no brick, no note). */
  debounceSteps: 24,
  /** Last-chance slow motion: only when the exit is narrower than `slowGateW` and the ball heads for it. */
  slowGateW: 260,
  slowDistX: 560,
  slowMargin: 70,
  rateMin: 0.22,
  slowIn: 0.054,
  slowOut: 0.027,
  /** Tuned constants (see the report). */
  params: {
    speed: 2000,
    angleDeg: 43.318,
    angleJitterDeg: 3,
    doorW0: 600,
    doorDelta: 10.65,
  } as BrickParams,
} as const;

export const slotCount = (wall: number): number => (wall < 2 ? BRICK.slotsV : BRICK.slotsH);
export const slotSpan = (wall: number): number => (wall < 2 ? H / BRICK.slotsV : W / BRICK.slotsH);
export const levelThickness = (level: number): number => BRICK.lining + BRICK.brickDepth * level;

export interface BounceEvent {
  readonly index: number;
  /** Video seconds. */
  readonly t: number;
  /** First video frame that shows the bounce. */
  readonly frame: number;
  readonly wall: number;
  readonly slot: number;
  /** Level of the brick this bounce laid (1-based). */
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly speed: number;
  /** MIDI note of the tune. */
  readonly note: number;
}

export interface BrickRec {
  readonly wall: number;
  readonly slot: number;
  readonly level: number;
  readonly frame: number;
  readonly t: number;
}

export interface EscapeEvent {
  readonly t: number;
  /** First frame whose ball centre is outside the canvas. */
  readonly frame: number;
  readonly step: number;
  /** Ball centre y when it crosses the canvas edge. */
  readonly y: number;
  /** Exit width at that moment. */
  readonly doorW: number;
  readonly bricks: number;
}

export interface BrickTrace {
  readonly seed: number;
  readonly params: BrickParams;
  readonly sceneFrames: number;
  readonly launch: { readonly x: number; readonly y: number; readonly vx: number; readonly vy: number };
  /** Ball centre per fine step. */
  readonly stepX: Float32Array;
  readonly stepY: Float32Array;
  readonly stepCount: number;
  /** Fractional fine step shown by each video frame. */
  readonly frameStep: Float64Array;
  /** Playback rate at each frame: 1 is real time, below 1 is the last-chance slow motion. */
  readonly rate: Float32Array;
  readonly ballX: Float32Array;
  readonly ballY: Float32Array;
  /** Exit width at each frame, `w0 - delta x bricks`. */
  readonly doorW: Float64Array;
  readonly bricksAt: Uint16Array;
  readonly bounces: readonly BounceEvent[];
  readonly bricks: readonly BrickRec[];
  readonly escape: EscapeEvent | null;
  /** Final brick levels per wall and slot. */
  readonly profile: readonly Uint8Array[];
  readonly maxThickness: number;
  readonly minRate: number;
}

const BIG = 4000;
const q4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** Reflect `y` into the range the ball centre can occupy (used to guess where the ball will meet the left wall). */
function foldY(y: number, r: number): number {
  const lo = r + BRICK.lining;
  const span = H - 2 * (r + BRICK.lining);
  let u = (y - lo) % (2 * span);
  if (u < 0) u += 2 * span;
  return lo + (u <= span ? u : 2 * span - u);
}

interface Pending {
  wall: number;
  slot: number;
  level: number;
  x: number;
  y: number;
  speed: number;
}

export function simulateBrick(seed: number = HIT_SEED, params: BrickParams = BRICK.params): BrickTrace {
  const rng = createRng(seed);
  const r = BRICK.ballR;
  const dt = 1 / BRICK.stepHz;
  const stepsPerFrame = BRICK.stepHz / FPS;
  const doorY = BRICK.doorY;
  const spanV = slotSpan(WALL.left);
  const spanH = slotSpan(WALL.top);

  let bx = rng.range(300, 780);
  let by = rng.range(620, 1360);
  const sx = rng.sign();
  const sy = rng.sign();
  const angle = ((params.angleDeg + rng.range(-1, 1) * params.angleJitterDeg) * Math.PI) / 180;
  let vx = q4(sx * params.speed * Math.cos(angle));
  let vy = q4(sy * params.speed * Math.sin(angle));
  const launch = { x: bx, y: by, vx, vy };

  const levels: Uint8Array[] = [
    new Uint8Array(BRICK.slotsV),
    new Uint8Array(BRICK.slotsV),
    new Uint8Array(BRICK.slotsH),
    new Uint8Array(BRICK.slotsH),
  ];
  let bricks = 0;
  let maxLevelSeen = 0;
  const gapNow = (): number => params.doorW0 - params.doorDelta * bricks;
  const thick = (wall: number, s: number): number => levelThickness(levels[wall][s]);

  /**
   * Inner boundary of a wall for a ball whose centre is at `c` along that wall: the largest thickness over the
   * slots the ball overlaps. On the left wall the exit is cut out; `-Infinity` means the ball sits fully in the exit.
   */
  const boundary = (wall: number, c: number): number => {
    const span = wall < 2 ? spanV : spanH;
    const n = slotCount(wall);
    const lo = c - r;
    const hi = c + r;
    const s0 = Math.max(0, Math.floor(lo / span));
    const s1 = Math.min(n - 1, Math.floor(hi / span));
    const g = wall === WALL.left ? gapNow() : 0;
    const gapLo = doorY - g / 2;
    const gapHi = doorY + g / 2;
    let b = Number.NEGATIVE_INFINITY;
    for (let s = s0; s <= s1; s++) {
      if (g > 0) {
        const a0 = Math.max(lo, s * span);
        const a1 = Math.min(hi, (s + 1) * span);
        if (Math.min(a1, gapLo) - a0 <= 1e-9 && a1 - Math.max(a0, gapHi) <= 1e-9) continue;
      }
      const t = thick(wall, s);
      if (t > b) b = t;
    }
    return b;
  };

  /** A slot takes a brick unless it is capped or sits within one slot of the exit (the posts stay thin). */
  const slotFree = (wall: number, s: number): boolean => {
    if (levels[wall][s] >= BRICK.maxLevel) return false;
    if (wall === WALL.left) {
      const g = gapNow();
      if (g > 0) {
        const y0 = s * spanV;
        const y1 = y0 + spanV;
        if (y1 > doorY - g / 2 - spanV && y0 < doorY + g / 2 + spanV) return false;
      }
    }
    return true;
  };

  const pending: Pending[] = [];
  /**
   * Lay the brick of a bounce at the contact slot of `wall` (`along` is the contact coordinate on that wall).
   * If that column already stands two levels above a free slot the ball also touches, the brick goes on the lowest one,
   * so walls grow like a heap instead of spikes and the ball never meets a tall tower next to a deep notch.
   */
  const layBrick = (wall: number, along: number, cx: number, cy: number): void => {
    const n = slotCount(wall);
    const span = wall < 2 ? spanV : spanH;
    const slot = Math.max(0, Math.min(n - 1, Math.floor(along / span)));
    const lo = Math.max(0, Math.floor((along - r) / span));
    const hi = Math.min(n - 1, Math.floor((along + r) / span));
    let pick = -1;
    let lowest = BRICK.maxLevel + 1;
    for (let s = lo; s <= hi; s++) {
      if (!slotFree(wall, s)) continue;
      const lv = levels[wall][s];
      if (lv < lowest || (lv === lowest && Math.abs(s * span + span / 2 - along) < Math.abs(pick * span + span / 2 - along))) {
        lowest = lv;
        pick = s;
      }
    }
    if (pick >= 0 && slotFree(wall, slot) && levels[wall][slot] <= lowest + 1) pick = slot;
    for (let k = 0; pick < 0 && k < 2 * n; k++) {
      const cand = slot + ((k & 1) === 1 ? (k + 1) >> 1 : -(k >> 1));
      if (cand >= 0 && cand < n && slotFree(wall, cand)) pick = cand;
    }
    if (pick < 0) return;
    levels[wall][pick] += 1;
    bricks += 1;
    if (levels[wall][pick] > maxLevelSeen) maxLevelSeen = levels[wall][pick];
    pending.push({ wall, slot: pick, level: levels[wall][pick], x: cx, y: cy, speed: Math.hypot(vx, vy) });
  };

  /** One pass over the four walls. A wall only reacts to a ball that is moving into it. */
  const collide = (): boolean => {
    let hit = false;
    if (vx < 0) {
      const b = boundary(WALL.left, by);
      if (bx - r < b) {
        bx = b + r;
        vx = -vx;
        layBrick(WALL.left, by, b, by);
        hit = true;
      }
    } else if (vx > 0) {
      const b = boundary(WALL.right, by);
      if (bx + r > W - b) {
        bx = W - b - r;
        vx = -vx;
        layBrick(WALL.right, by, W - b, by);
        hit = true;
      }
    }
    if (vy < 0) {
      const b = boundary(WALL.top, bx);
      if (by - r < b) {
        by = b + r;
        vy = -vy;
        layBrick(WALL.top, bx, bx, b);
        hit = true;
      }
    } else if (vy > 0) {
      const b = boundary(WALL.bottom, bx);
      if (by + r > H - b) {
        by = H - b - r;
        vy = -vy;
        layBrick(WALL.bottom, bx, bx, H - b);
        hit = true;
      }
    }
    return hit;
  };

  const maxSteps = Math.ceil(SCENE_FRAMES * stepsPerFrame) + 8;
  const stepX = new Float32Array(maxSteps + 1);
  const stepY = new Float32Array(maxSteps + 1);
  stepX[0] = bx;
  stepY[0] = by;
  const frameStep = new Float64Array(SCENE_FRAMES);
  const rate = new Float32Array(SCENE_FRAMES);
  rate[0] = 1;

  type RawBounce = Pending & { t: number };
  const raw: RawBounce[] = [];
  let step = 0;
  let f = 1;
  let vt = 0;
  let slow = 0;
  let through = false;
  let escapeStep = -1;
  let escapeT = 0;
  let escapeY = 0;
  let escapeW = 0;
  let escapeBricks = 0;

  while (f < SCENE_FRAMES && step < maxSteps) {
    bx += vx * dt;
    by += vy * dt;
    pending.length = 0;
    if (!through) {
      for (let pass = 0; pass < 3 && collide(); pass++);
      // The ball is through the exit once its leading edge crosses the lining with the whole ball inside the gap.
      if (vx < 0 && bx - r < BRICK.lining && boundary(WALL.left, by) === Number.NEGATIVE_INFINITY) {
        through = true;
        escapeY = by;
        escapeW = Math.max(0, gapNow());
        escapeBricks = bricks;
      }
    }
    const g = gapNow();
    let target = 0;
    if (!through && g > 0 && g < BRICK.slowGateW && vx < 0 && bx < BRICK.slowDistX) {
      const tt = Math.max(0, (bx - r - BRICK.lining) / -vx);
      const yp = foldY(by + vy * tt, r);
      if (Math.abs(yp - doorY) < g / 2 + BRICK.slowMargin) target = 1;
    }
    slow += (target - slow) * (target > slow ? BRICK.slowIn : BRICK.slowOut);
    const stepRate = 1 - (1 - BRICK.rateMin) * slow;
    const dtv = stepRate * dt;
    vt += dtv;
    step += 1;
    stepX[step] = bx;
    stepY[step] = by;
    for (const p of pending) raw.push({ ...p, t: vt });
    if (through && escapeStep < 0 && bx < 0) {
      escapeStep = step;
      escapeT = vt;
    }
    while (f < SCENE_FRAMES && vt >= f / FPS) {
      frameStep[f] = step - (vt - f / FPS) / dtv;
      rate[f] = stepRate;
      f += 1;
    }
  }
  const lastStep = step;
  while (f < SCENE_FRAMES) {
    frameStep[f] = Math.min(lastStep, frameStep[f - 1] + stepsPerFrame);
    rate[f] = 1;
    f += 1;
  }

  const ballX = new Float32Array(SCENE_FRAMES);
  const ballY = new Float32Array(SCENE_FRAMES);
  for (let i = 0; i < SCENE_FRAMES; i++) {
    const sIdx = Math.min(frameStep[i], lastStep);
    const i0 = Math.min(lastStep - 1, Math.floor(sIdx));
    const fr = sIdx - i0;
    ballX[i] = stepX[i0] + (stepX[i0 + 1] - stepX[i0]) * fr;
    ballY[i] = stepY[i0] + (stepY[i0 + 1] - stepY[i0]) * fr;
  }

  const frameOf = (t: number): number => Math.min(SCENE_FRAMES - 1, Math.max(0, Math.ceil(t * FPS - 1e-9)));
  const bounces: BounceEvent[] = raw.map((b, i) => ({
    index: i,
    t: b.t,
    frame: frameOf(b.t),
    wall: b.wall,
    slot: b.slot,
    level: b.level,
    x: b.x,
    y: b.y,
    speed: b.speed,
    note: ODE_TO_JOY[i % ODE_TO_JOY.length],
  }));
  const brickRecs: BrickRec[] = bounces.map((b) => ({ wall: b.wall, slot: b.slot, level: b.level, frame: b.frame, t: b.t }));

  const bricksAt = new Uint16Array(SCENE_FRAMES);
  const doorW = new Float64Array(SCENE_FRAMES);
  let cursor = 0;
  for (let i = 0; i < SCENE_FRAMES; i++) {
    while (cursor < bounces.length && bounces[cursor].frame <= i) cursor += 1;
    bricksAt[i] = cursor;
    doorW[i] = Math.max(0, params.doorW0 - params.doorDelta * cursor);
  }

  let escape: EscapeEvent | null = null;
  if (escapeStep >= 0) {
    let first = SCENE_FRAMES - 1;
    for (let i = 0; i < SCENE_FRAMES; i++) {
      if (ballX[i] < 0) {
        first = i;
        break;
      }
    }
    escape = { t: escapeT, frame: first, step: escapeStep, y: escapeY, doorW: escapeW, bricks: escapeBricks };
  }

  let minRate = 1;
  for (let i = 0; i < SCENE_FRAMES; i++) minRate = Math.min(minRate, rate[i]);

  return {
    seed,
    params,
    sceneFrames: SCENE_FRAMES,
    launch,
    stepX,
    stepY,
    stepCount: lastStep + 1,
    frameStep,
    rate,
    ballX,
    ballY,
    doorW,
    bricksAt,
    bounces,
    bricks: brickRecs,
    escape,
    profile: levels,
    maxThickness: levelThickness(maxLevelSeen),
    minRate,
  };
}

export function digestBrickTrace(t: BrickTrace): string {
  const events: number[] = [];
  for (const b of t.bounces) events.push(b.frame, b.wall, b.slot, b.level, b.x, b.y, b.note);
  const parts = [
    digestNumbers(t.ballX),
    digestNumbers(t.ballY),
    digestNumbers(t.doorW),
    digestNumbers(t.bricksAt),
    digestNumbers(t.rate, 3),
    digestNumbers(events),
    digestNumbers([t.escape?.frame ?? -1, t.escape?.y ?? 0, t.escape?.doorW ?? 0, t.launch.vx, t.launch.vy]),
  ];
  return fnv1a(parts.join("|"));
}

/** Ball centre at a fractional fine step (clamped to the recorded range). */
export function ballAtStep(t: BrickTrace, s: number): { x: number; y: number } {
  const last = t.stepCount - 1;
  const c = Math.max(0, Math.min(last, s));
  const i0 = Math.min(last - 1, Math.floor(c));
  const fr = c - i0;
  return {
    x: t.stepX[i0] + (t.stepX[i0 + 1] - t.stepX[i0]) * fr,
    y: t.stepY[i0] + (t.stepY[i0 + 1] - t.stepY[i0]) * fr,
  };
}
