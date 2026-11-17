import { smoothstep } from "../midi/kit.ts";
import type { RippleEvent } from "./events.ts";

/**
 * Height field of the ripple tank. Every note is an expanding ring wave packet; the surface height at any
 * time is the plain analytic sum of those packets (and their mirror images in the tank walls), so there is
 * no state: frame 900 can be rendered before frame 100, on any worker. Only the annulus of cells near each
 * ring's radius is touched, and sources whose wave has faded are culled. DOM-free, runs unchanged in Node.
 */

/**
 * The tank: a glass box whose four walls the waves bounce off. Framing standard: centred on x = 540 (equal 48 px side
 * margins) and on y = 940, with the title above it (y 150-260) and nothing within 320 px of the bottom edge.
 */
export const TANK = { left: 48, right: 1032, top: 280, bottom: 1600, radius: 58 } as const;

export interface FieldGeometry {
  cols: number;
  rows: number;
  /** Canvas px per field cell. */
  scale: number;
  /** Canvas position of the top-left corner of cell (0, 0). The grid is centred on the tank with a spare cell around it. */
  originX: number;
  originY: number;
  /** The walls (canvas px) the waves reflect from: the tank edges. The mirror images are symmetric about the tank centre. */
  wallLeft: number;
  wallRight: number;
  wallTop: number;
  wallBottom: number;
}

export function fieldGeometry(scale = 3, tank: Pick<typeof TANK, "left" | "right" | "top" | "bottom"> = TANK): FieldGeometry {
  const cols = Math.ceil((tank.right - tank.left) / scale) + 2, rows = Math.ceil((tank.bottom - tank.top) / scale) + 2;
  return {
    cols, rows, scale,
    originX: (tank.left + tank.right) / 2 - (cols * scale) / 2, originY: (tank.top + tank.bottom) / 2 - (rows * scale) / 2,
    wallLeft: tank.left, wallRight: tank.right, wallTop: tank.top, wallBottom: tank.bottom,
  };
}

// Wave packet shape in units of one wavelength measured from the front crest (u = 0): a sharp leading crest and a
// decaying wake of trailing crests. Three wake lengths (soft notes: one clean ring; loud notes and climaxes: many
// crests and rich interference). The tables are the same for every note, only their scale (wavelength) changes.
export const PACKET_FRONT = 1;
const PACKET_RES = 48;
export interface PacketShape { back: number; offset: number; size: number; table: Float32Array }
function makePacket(back: number, sigmaBack: number): PacketShape {
  const size = Math.round((back + PACKET_FRONT) * PACKET_RES) + 2;
  const table = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const u = i / PACKET_RES - back;
    const envelope = u >= 0 ? Math.exp(-((u / 0.42) ** 2)) : Math.exp(-((u / sigmaBack) ** 2));
    const taper = smoothstep(-back, -back + 0.7, u) * (1 - smoothstep(PACKET_FRONT - 0.3, PACKET_FRONT, u));
    table[i] = envelope * taper * Math.cos(2 * Math.PI * u);
  }
  return { back, offset: back * PACKET_RES, size, table };
}
export const PACKETS: readonly PacketShape[] = [makePacket(2.4, 0.85), makePacket(3.1, 1.2), makePacket(3.9, 1.55)];

/** Radius (canvas px) over which a ring's amplitude has fallen to 1/sqrt(2) (the ~1/sqrt(r) spreading loss). */
const FALLOFF_R0 = 200;
/** Fraction of the amplitude that survives a bounce off a wall: sides, top and bottom. */
const REFLECT_SIDE = 0.72, REFLECT_END = 0.62;
/** Active sources are capped per frame (the loudest and youngest are kept) and faint ones are culled. */
export const MAX_SOURCES = 48;
const MIN_PEAK = 0.022;

/** Amplitude factor 0..1 of a wave of the given age and lifetime (fast decay, then a smooth fade to exactly zero). */
export function lifeEnvelope(age: number, life: number): number {
  if (age < 0 || age >= life) return 0;
  const x = age / life;
  return Math.exp(-1.6 * x) * (1 - smoothstep(0.6, 1, x));
}

/** Largest radius (canvas px) at which a note's front crest is still clearly visible (height above `threshold` after spreading loss). */
export function visibleRadius(ev: Pick<RippleEvent, "amplitude" | "speed" | "life">, threshold = 0.1): number {
  let reach = 0;
  for (let age = 0; age < ev.life; age += 0.02) {
    const radius = ev.speed * age;
    if (ev.amplitude * lifeEnvelope(age, ev.life) / Math.sqrt(1 + radius / FALLOFF_R0) >= threshold) reach = radius;
  }
  return reach;
}

const maxLifeCache = new WeakMap<readonly RippleEvent[], number>();
function maxLifeOf(events: readonly RippleEvent[]): number {
  let value = maxLifeCache.get(events);
  if (value === undefined) {
    value = 0;
    for (const event of events) value = Math.max(value, event.life);
    maxLifeCache.set(events, value);
  }
  return value;
}

/**
 * Light direction (towards the light, x right, y down, z out of the screen) and its half vector with a top-down view.
 * The light stands straight above the tank (x = 0) so the lighting is mirror-symmetric about the vertical axis.
 */
const LIGHT: readonly [number, number, number] = (() => {
  const x = 0, y = -0.78, z = 0.62, n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
})();
const HALF: readonly [number, number, number] = (() => {
  const x = LIGHT[0], y = LIGHT[1], z = LIGHT[2] + 1, n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
})();

export class RippleField {
  readonly geo: FieldGeometry;
  readonly cols: number;
  readonly rows: number;
  /** Per cell: height, sum of |contribution|, then the |contribution|-weighted r, g, b of the sources. */
  readonly acc: Float32Array;
  /** Resting water colour per cell (rgb, 0..1): a deep navy with a soft depth gradient. */
  private readonly rest: Float32Array;
  private readonly kFall: number;
  private selected = new Int32Array(0);
  private candidates: { index: number; peak: number }[] = [];
  /** Number of sources of the last evaluate() call (after culling and capping). */
  activeCount = 0;

  constructor(geo: FieldGeometry = fieldGeometry()) {
    this.geo = geo;
    this.cols = geo.cols;
    this.rows = geo.rows;
    this.acc = new Float32Array(geo.cols * geo.rows * 5);
    this.rest = new Float32Array(geo.cols * geo.rows * 3);
    this.kFall = geo.scale / FALLOFF_R0;
    for (let gy = 0; gy < geo.rows; gy++) {
      for (let gx = 0; gx < geo.cols; gx++) {
        const px = geo.originX + (gx + 0.5) * geo.scale, py = geo.originY + (gy + 0.5) * geo.scale;
        // Deep navy, a little lighter and bluer around the middle of the tank, darker towards the corners.
        const w = geo.wallRight - geo.wallLeft, h = geo.wallBottom - geo.wallTop;
        const d = Math.hypot((px - (geo.wallLeft + geo.wallRight) / 2) / w, (py - (geo.wallTop + geo.wallBottom) / 2) / h * 0.62);
        const glow = Math.max(0, 1 - d * 1.5) ** 2;
        const o = (gy * geo.cols + gx) * 3;
        this.rest[o] = 0.010 + 0.016 * glow;
        this.rest[o + 1] = 0.016 + 0.040 * glow;
        this.rest[o + 2] = 0.040 + 0.085 * glow;
      }
    }
  }

  /**
   * Fill the field for a video frame. `t` is the piece time of that frame (frame / fps - lead). An event is
   * live from its startFrame on, so nothing of a note shows before the frame its onset falls in.
   * Returns the number of sources summed.
   */
  evaluate(events: readonly RippleEvent[], frame: number, t: number, cap = MAX_SOURCES): number {
    this.acc.fill(0);
    const count = this.select(events, frame, t, cap);
    this.activeCount = count;
    const { geo } = this;
    for (let k = 0; k < count; k++) {
      const ev = events[this.selected[k]];
      const age = Math.max(0, t - ev.timeSec);
      // The first crest swells over about 80 ms (the splash flash carries the onset frame), so the impact dome never blows out to white.
      const amp = ev.amplitude * lifeEnvelope(age, ev.life) * (0.3 + 0.7 * smoothstep(0, 0.08, age));
      const R = ev.speed * age; // canvas px
      const reach = R + PACKET_FRONT * ev.wavelength;
      this.addRing(ev, ev.x, ev.y, R, amp);
      // Mirror images in the four tank walls: the bounced wave is the same ring from the image source, a bit weaker.
      // The walls are symmetric about the tank centre, so the images are too.
      if (reach > ev.x - geo.wallLeft) this.addRing(ev, 2 * geo.wallLeft - ev.x, ev.y, R, amp * REFLECT_SIDE);
      if (reach > geo.wallRight - ev.x) this.addRing(ev, 2 * geo.wallRight - ev.x, ev.y, R, amp * REFLECT_SIDE);
      if (reach > ev.y - geo.wallTop) this.addRing(ev, ev.x, 2 * geo.wallTop - ev.y, R, amp * REFLECT_END);
      if (reach > geo.wallBottom - ev.y) this.addRing(ev, ev.x, 2 * geo.wallBottom - ev.y, R, amp * REFLECT_END);
    }
    return count;
  }

  /** Pick the live, audible sources of a frame: at most `cap`, the strongest first dropped last; returned in note order. */
  private select(events: readonly RippleEvent[], frame: number, t: number, cap: number): number {
    const candidates = this.candidates;
    candidates.length = 0;
    const tMin = t - maxLifeOf(events);
    let lo = 0, hi = events.length;
    while (lo < hi) { // first event that can still be alive
      const mid = (lo + hi) >> 1;
      if (events[mid].timeSec < tMin) lo = mid + 1; else hi = mid;
    }
    for (let i = lo; i < events.length; i++) {
      const ev = events[i];
      if (frame < ev.startFrame) break; // events are in onset order, so nothing later has started either
      const age = Math.max(0, t - ev.timeSec);
      if (age >= ev.life) continue;
      const peak = ev.amplitude * lifeEnvelope(age, ev.life);
      if (peak >= MIN_PEAK) candidates.push({ index: i, peak });
    }
    if (candidates.length > cap) {
      candidates.sort((a, b) => b.peak - a.peak || a.index - b.index);
      candidates.length = cap;
    }
    candidates.sort((a, b) => a.index - b.index); // a fixed summation order: bit-identical results for any render order
    if (this.selected.length < candidates.length) this.selected = new Int32Array(Math.max(candidates.length, 64));
    for (let k = 0; k < candidates.length; k++) this.selected[k] = candidates[k].index;
    return candidates.length;
  }

  /** Add one ring packet centred on (cx, cy) canvas px with front radius R (canvas px) to the accumulators. */
  private addRing(ev: RippleEvent, cx: number, cy: number, R: number, amp: number) {
    if (amp < MIN_PEAK * 0.5) return;
    const { geo, cols, rows, acc } = this;
    const scale = geo.scale;
    const gcx = (cx - geo.originX) / scale - 0.5, gcy = (cy - geo.originY) / scale - 0.5;
    const lambda = ev.wavelength / scale;
    const Rg = R / scale;
    const shape = PACKETS[ev.wake];
    const outer = Rg + PACKET_FRONT * lambda;
    const inner = Rg - shape.back * lambda;
    const outer2 = outer * outer, inner2 = inner > 0 ? inner * inner : 0;
    const y0 = Math.max(0, Math.ceil(gcy - outer)), y1 = Math.min(rows - 1, Math.floor(gcy + outer));
    if (y0 > y1) return;
    const indexScale = PACKET_RES / lambda;
    const [cr, cg, cb] = ev.rgb;
    const kFall = this.kFall;
    for (let y = y0; y <= y1; y++) {
      const dy = y - gcy, dy2 = dy * dy;
      const rem = outer2 - dy2;
      if (rem <= 0) continue;
      const dxo = Math.sqrt(rem);
      const dxi = dy2 < inner2 ? Math.sqrt(inner2 - dy2) : 0;
      const rowBase = y * cols;
      if (dxi > 0) {
        this.fillSpan(shape, rowBase, Math.ceil(gcx - dxo), Math.floor(gcx - dxi), gcx, dy2, Rg, indexScale, amp, cr, cg, cb, kFall);
        this.fillSpan(shape, rowBase, Math.ceil(gcx + dxi), Math.floor(gcx + dxo), gcx, dy2, Rg, indexScale, amp, cr, cg, cb, kFall);
      } else {
        this.fillSpan(shape, rowBase, Math.ceil(gcx - dxo), Math.floor(gcx + dxo), gcx, dy2, Rg, indexScale, amp, cr, cg, cb, kFall);
      }
    }
  }

  private fillSpan(
    shape: PacketShape, rowBase: number, xa: number, xb: number, gcx: number, dy2: number, Rg: number, indexScale: number,
    amp: number, cr: number, cg: number, cb: number, kFall: number,
  ) {
    const acc = this.acc;
    const table = shape.table, offset = shape.offset, last = shape.size - 1;
    if (xa < 0) xa = 0;
    if (xb > this.cols - 1) xb = this.cols - 1;
    for (let x = xa; x <= xb; x++) {
      const dx = x - gcx;
      const r = Math.sqrt(dx * dx + dy2);
      const fi = (r - Rg) * indexScale + offset;
      if (fi < 0) continue;
      const i0 = fi | 0;
      if (i0 >= last) continue;
      const p = table[i0] + (table[i0 + 1] - table[i0]) * (fi - i0);
      const a = (amp * p) / Math.sqrt(1 + r * kFall);
      const w = a < 0 ? -a : a;
      const o = (rowBase + x) * 5;
      acc[o] += a;
      acc[o + 1] += w;
      acc[o + 2] += w * cr;
      acc[o + 3] += w * cg;
      acc[o + 4] += w * cb;
    }
  }

  /**
   * Turn the accumulated field into glossy neon water: height-gradient lighting (a specular line along each
   * crest, darker troughs), the colour of the rings mixed by each source's local contribution, and a dot lattice
   * seen through the surface that bends with the waves. Writes RGBA bytes (cols * rows * 4) into `out`.
   * `pulse` (0..1) briefly lifts the exposure on loud chords.
   */
  shade(out: Uint8ClampedArray, pulse = 0): void {
    const { cols, rows, acc, rest, geo } = this;
    const scale = geo.scale;
    const exposure = 1.45 + 0.35 * pulse;
    // Dot lattice: 9 x 12 cells, one dot in the middle of each, so it is symmetric about the tank's vertical axis.
    const cellX = (geo.wallRight - geo.wallLeft) / 9, cellY = (geo.wallBottom - geo.wallTop) / 12, dotRadius2 = 30 * 30;
    for (let gy = 0; gy < rows; gy++) {
      const up = gy > 0 ? -cols : 0, down = gy < rows - 1 ? cols : 0;
      const py = geo.originY + (gy + 0.5) * scale;
      for (let gx = 0; gx < cols; gx++) {
        const i = gy * cols + gx;
        const a = i * 5, o = i * 4, rc = i * 3;
        const h = acc[a], w = acc[a + 1];
        const sx = (acc[(i + (gx < cols - 1 ? 1 : 0)) * 5] - acc[(i - (gx > 0 ? 1 : 0)) * 5]) * 0.5;
        const sy = (acc[(i + down) * 5] - acc[(i + up) * 5]) * 0.5;
        const px = geo.originX + (gx + 0.5) * scale;
        // Dot lattice seen through the water: refracted by the surface slope.
        const lx = (px + sx * 90 - geo.wallLeft) / cellX, ly = (py + sy * 90 - geo.wallTop) / cellY;
        const fx = (lx - Math.floor(lx) - 0.5) * cellX, fy = (ly - Math.floor(ly) - 0.5) * cellY;
        const d2 = (fx * fx + fy * fy) / dotRadius2;
        const dot = d2 < 1 ? (1 - d2) ** 2 : 0;
        let r = rest[rc], g = rest[rc + 1], b = rest[rc + 2];
        let tr = 0.5, tg = 0.7, tb = 1;
        let body = 0, spec = 0, dark = 1;
        if (w > 1e-4) {
          const inv = 1 / w;
          tr = acc[a + 2] * inv; tg = acc[a + 3] * inv; tb = acc[a + 4] * inv;
          const hs = h / (1 + 0.85 * Math.abs(h)); // soft clip: tall chord waves stay coloured instead of blowing out to white
          const crest = hs > 0 ? hs : 0;
          const trough = hs < 0 ? -hs : 0;
          const lit = sy * 1.9; // light from straight above: slopes facing up are lit, left and right are treated alike
          const litPos = lit > 0 ? lit / (1 + lit) : 0;
          const nx = -sx * 2.6, ny = -sy * 2.6;
          const nd = (nx * HALF[0] + ny * HALF[1] + HALF[2]) / Math.sqrt(nx * nx + ny * ny + 1);
          if (nd > 0.9) { const s = (nd - 0.9) * 10; spec = s * s; } // zero on flat water (nd = 0.894), peak where the normal meets the half vector
          body = 3 * crest ** 2.1 + 0.5 * litPos ** 1.4 + 0.045 * Math.min(w, 1.5);
          dark = 1 - 0.6 * Math.min(1, trough * 1.4);
        }
        r *= dark; g *= dark; b *= dark;
        r += tr * body; g += tg * body; b += tb * body;
        const whiteness = spec * 0.95;
        r += whiteness * (0.5 + 0.5 * tr); g += whiteness * (0.5 + 0.5 * tg); b += whiteness * (0.5 + 0.5 * tb);
        const act = Math.min(1, w);
        const lattice = dot * (0.05 + 0.2 * act);
        r += lattice * (0.55 + 0.45 * tr * act); g += lattice * (0.75 + 0.25 * tg * act); b += lattice * (1 - 0.1 * act + 0.1 * tb * act);
        out[o] = 255 * (1 - Math.exp(-r * exposure));
        out[o + 1] = 255 * (1 - Math.exp(-g * exposure));
        out[o + 2] = 255 * (1 - Math.exp(-b * exposure));
        out[o + 3] = 255;
      }
    }
  }
}
