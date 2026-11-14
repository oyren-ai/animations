export type Point = { x: number; y: number };
export type Body = Point & { vx: number; vy: number; r: number };
export type Segment = { a: Point; b: Point; vx?: number; vy?: number; omega?: number };
export const WORLD = { left: 110, right: 970, top: 540, bottom: 1400 } as const;
export const SAFE_AREA = { left: 72, right: 1008, top: 240, bottom: 1660 } as const;
export const BOWL = { center: 540, floor: 1370, curvature: 0.0009 } as const;

export const bowlY = (x: number) =>
  BOWL.floor - BOWL.curvature * (x - BOWL.center) ** 2;

export function assertSafeBox(box: { left: number; right: number; top: number; bottom: number }) {
  if (![box.left, box.right, box.top, box.bottom].every(Number.isFinite) ||
      box.left > box.right || box.top > box.bottom ||
      box.left < SAFE_AREA.left || box.right > SAFE_AREA.right ||
      box.top < SAFE_AREA.top || box.bottom > SAFE_AREA.bottom) {
    throw new RangeError("Text outside the measured safe area");
  }
  return box;
}

/** Resolve a disc against another disc; return the inward approach speed. */
export function collideDisc(body: Body, center: Point, radius: number, restitution = 0.82) {
  let dx = body.x - center.x, dy = body.y - center.y;
  let distance = Math.hypot(dx, dy);
  const separation = body.r + radius;
  if (distance >= separation) return 0;
  if (distance < 1e-9) { dx = 0; dy = -1; distance = 1; }
  const nx = dx / distance, ny = dy / distance;
  body.x = center.x + nx * (separation + 0.001);
  body.y = center.y + ny * (separation + 0.001);
  const inward = body.vx * nx + body.vy * ny;
  if (inward < 0) {
    body.vx -= (1 + restitution) * inward * nx;
    body.vy -= (1 + restitution) * inward * ny;
  }
  return Math.max(0, -inward);
}

/** A rotating segment's contact velocity is omega cross its pivot-relative offset. */
export function collideSegment(body: Body, segment: Segment, radius = 7, restitution = 0.8) {
  const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) throw new RangeError("A segment needs nonzero length");
  const fraction = Math.max(0, Math.min(1,
    ((body.x - segment.a.x) * dx + (body.y - segment.a.y) * dy) / lengthSquared));
  const x = segment.a.x + fraction * dx, y = segment.a.y + fraction * dy;
  const ex = body.x - x, ey = body.y - y, distance = Math.hypot(ex, ey);
  if (distance >= body.r + radius) return 0;
  const nx = distance > 1e-9 ? ex / distance : -dy / Math.sqrt(lengthSquared);
  const ny = distance > 1e-9 ? ey / distance : dx / Math.sqrt(lengthSquared);
  body.x = x + nx * (body.r + radius + 0.001);
  body.y = y + ny * (body.r + radius + 0.001);
  const ux = (segment.vx ?? 0) - (y - segment.a.y) * (segment.omega ?? 0);
  const uy = (segment.vy ?? 0) + (x - segment.a.x) * (segment.omega ?? 0);
  const inward = (body.vx - ux) * nx + (body.vy - uy) * ny;
  if (inward < 0) {
    body.vx -= (1 + restitution) * inward * nx;
    body.vy -= (1 + restitution) * inward * ny;
  }
  return Math.max(0, -inward);
}

/**
 * Solve the inward normal offset of the parabola. Subtracting radius from f(x)
 * alone lets the sides of a disc cross a sloped floor.
 */
export function collideBowl(body: Body, reflect = true) {
  const curvature = 2 * BOWL.curvature;
  if (!(body.r > 0) || curvature * body.r >= 1) {
    throw new RangeError("Disc radius exceeds the bowl's unique-offset range");
  }
  if (body.y + body.r <= Math.min(bowlY(body.x - body.r), bowlY(body.x + body.r))) return 0;
  let q = body.x;
  for (let i = 0; i < 20; i++) {
    const slope = -curvature * (q - BOWL.center), length = Math.hypot(slope, 1);
    const delta = (q + body.r * slope / length - body.x) /
      (1 - curvature * body.r / length ** 3);
    q -= delta;
    if (Math.abs(delta) < 1e-10) break;
  }
  const slope = -curvature * (q - BOWL.center), length = Math.hypot(slope, 1);
  const limit = bowlY(q) - body.r / length;
  if (body.y <= limit) return 0;
  body.y = limit - 0.001;
  const nx = slope / length, ny = -1 / length;
  const inward = body.vx * nx + body.vy * ny;
  if (reflect && inward < 0) {
    body.vx -= 1.3 * inward * nx;
    body.vy -= 1.3 * inward * ny;
  }
  return Math.max(0, -inward);
}

export function collideWalls(body: Body) {
  if (body.x - body.r < WORLD.left) {
    body.x = WORLD.left + body.r; body.vx = Math.abs(body.vx) * 0.8;
  }
  if (body.x + body.r > WORLD.right) {
    body.x = WORLD.right - body.r; body.vx = -Math.abs(body.vx) * 0.8;
  }
  if (body.y - body.r < WORLD.top) {
    body.y = WORLD.top + body.r; body.vy = Math.abs(body.vy) * 0.8;
  }
}
