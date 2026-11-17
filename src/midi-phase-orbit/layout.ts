import { buildAccents, clamp, clamp01, hash01, smoothstep, type Accent } from "../midi/kit.ts";
import { barSeconds, pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import type { MidiNote } from "../midi/types.ts";

/**
 * Pure geometry and timing for Phase Orbit, the radial piano roll: DOM-free so it can be unit tested in Node.
 *
 * Conventions: a "disc angle" is in radians, 0 at 12 o'clock and increasing clockwise, so a point at radius r
 * and disc angle a sits at (r sin a, -r cos a) from the hub. Time maps to disc angle with one bar = one
 * revolution, measured from tick 0 of the file. The whole disc is rotated afterwards by `discRotation`, so
 * everything measured here stays correct relative to the playhead.
 */

export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;

export const DISC = {
  /** Hub of the disc on the 1080x1920 canvas (phone safe area: right edge <= 930, nothing below y = 1620). */
  cx: 495, cy: 1010,
  /** Playhead starts here (just outside the hub glow). */
  rHub: 66,
  /** Centre line of the innermost and outermost pitch ring. */
  rIn: 108, rOut: 336,
  /** Outer rim circle and tick marks. */
  rim: 358,
  /** Nothing the disc draws (arcs with their glow, sparks, bloom, halo, ticks) reaches beyond this radius. */
  rMax: 396,
  /** Sparks stop their centre at this radius (a spark sprite is at most 12 px wide). */
  sparkReach: 384,
  /** Largest extra scale (breathing plus camera kick) and camera shift in px the painter applies. */
  maxZoom: 0.055, maxShift: 16,
  /** Distance from the hub to the nearest safe-area edge: right edge 930 - 495. */
  safeRadius: 435,
  /** One slow turn of the whole disc in this many seconds. */
  rotationSec: 90,
  /** Kaleidoscope halo band (the mirrored copy of the outer rings) and the climax bloom stay inside these. */
  haloIn: 345, haloOut: 381,
  bloomDiameter: 2 * 384,
} as const;

/** Window of notes shown around the playhead, in revolutions. */
export const WINDOW_BEHIND = 0.4;
export const WINDOW_AHEAD = 0.6;
/** At most this many arcs are drawn per frame, however dense the file is. */
export const MAX_ARCS = 560;
/** Distinct pitches up to this many are laid out by rank (evenly spaced rings); more is linear in pitch. */
export const RANKED_MAX = 24;

export interface TrackColour { name: string; hue: number; sat: number; light: number }

/** Marimba amber, kalimba cyan, bells magenta, bass royal blue, then lime, rose, gold, violet; cycled by track. */
export const PALETTE: readonly TrackColour[] = [
  { name: "amber", hue: 33, sat: 1, light: 0.56 },
  { name: "cyan", hue: 182, sat: 0.95, light: 0.54 },
  { name: "magenta", hue: 308, sat: 0.92, light: 0.63 },
  { name: "royal blue", hue: 226, sat: 0.97, light: 0.64 },
  { name: "lime", hue: 94, sat: 0.85, light: 0.52 },
  { name: "rose", hue: 349, sat: 0.95, light: 0.62 },
  { name: "gold", hue: 52, sat: 0.95, light: 0.56 },
  { name: "violet", hue: 266, sat: 0.9, light: 0.66 },
];

export const wrapAngle = (angle: number) => ((angle % TAU) + TAU) % TAU;
/** Signed shortest difference a - b in (-pi, pi]. */
export function angleDiff(a: number, b: number): number {
  const d = wrapAngle(a - b);
  return d > Math.PI ? d - TAU : d;
}

/** Position from the hub of a point at radius r and disc angle a (12 o'clock up, clockwise). */
export const polarX = (r: number, angle: number) => r * Math.sin(angle);
export const polarY = (r: number, angle: number) => -r * Math.cos(angle);

/** Disc angle of a note: 2 pi (timeSec mod P) / P. */
export function noteAngle(timeSec: number, period: number): number {
  return TAU * (((timeSec % period) + period) % period) / period;
}

/** Disc angle of the playhead at piece time t (unwrapped, so it is negative during the lead-in). */
export const playheadAngle = (t: number, period: number) => TAU * t / period;

/** Slow turn of the whole disc, counter to the sweep. */
export const discRotation = (t: number) => -TAU * t / DISC.rotationSec;

/** First video frame whose piece time is >= timeSec, i.e. the frame where the note's flash begins. */
export function onsetFrame(scene: MidiSceneData, timeSec: number): number {
  let frame = Math.ceil((timeSec + scene.leadSec) * scene.fps) - 1;
  while (pieceTime(scene, frame) < timeSec) frame++;
  return frame;
}

/** Revolution period in seconds: one bar at the first tempo, 4/4 when the file has no time signature. */
export function orbitPeriod(scene: Pick<MidiSceneData, "tempoMap" | "timeSignature">): number {
  const bar = barSeconds(scene);
  return Number.isFinite(bar) && bar > 0.2 ? bar : 2;
}

export interface RingMap {
  /** True when the distinct pitches are laid out by rank (evenly spaced), false for the linear fallback. */
  ranked: boolean;
  /** Distinct pitches used, ascending. */
  pitches: number[];
  /** Radius of each ring to draw as a guide: all of them when ranked, one per octave C otherwise. */
  guideRadii: number[];
  /** Smallest radial distance between two neighbouring used pitches; limits the arc thickness. */
  minGap: number;
  radiusOf(pitch: number): number;
  rankOf(pitch: number): number;
}

export function buildRingMap(notes: readonly MidiNote[], rIn: number = DISC.rIn, rOut: number = DISC.rOut): RingMap {
  const pitches = [...new Set(notes.map((n) => n.pitch))].sort((a, b) => a - b);
  const count = pitches.length;
  const rank = new Map(pitches.map((p, i) => [p, i] as const));
  if (count <= RANKED_MAX) {
    const radii = pitches.map((_, i) => (count === 1 ? (rIn + rOut) / 2 : rIn + (rOut - rIn) * i / (count - 1)));
    const minGap = count <= 1 ? rOut - rIn : (rOut - rIn) / (count - 1);
    return {
      ranked: true, pitches, guideRadii: radii, minGap,
      radiusOf: (pitch) => radii[rank.get(pitch) ?? 0] ?? (rIn + rOut) / 2,
      rankOf: (pitch) => rank.get(pitch) ?? 0,
    };
  }
  const lo = pitches[0], hi = pitches[count - 1];
  const perSemitone = (rOut - rIn) / Math.max(1, hi - lo);
  let minInterval = 127;
  for (let i = 1; i < count; i++) minInterval = Math.min(minInterval, pitches[i] - pitches[i - 1]);
  const radiusOf = (pitch: number) => rIn + (rOut - rIn) * clamp01((pitch - lo) / Math.max(1, hi - lo));
  const guideRadii: number[] = [];
  for (let p = lo; p <= hi; p++) if (p % 12 === 0) guideRadii.push(radiusOf(p));
  if (!guideRadii.length) guideRadii.push(radiusOf(lo), radiusOf(hi));
  return { ranked: false, pitches, guideRadii, minGap: perSemitone * minInterval, radiusOf, rankOf: (pitch) => rank.get(pitch) ?? 0 };
}

export interface OrbitEvent {
  /** Index into scene.notes (events are in the same order, one per note). */
  index: number;
  timeSec: number;
  /** End of the arc's visual duration (capped just below one revolution). */
  endSec: number;
  track: number;
  /** Palette slot: rank of the track among the tracks that have notes. */
  slot: number;
  pitch: number;
  ring: number;
  /** Ring centre-line radius with the small per-voice lane offset. */
  radius: number;
  /** Disc angle of the arc's leading edge (where the playhead is at the note onset). */
  angle: number;
  /** Cap-to-cap arc length in radians, proportional to the duration but never shorter than a dot. */
  length: number;
  /** 0..1 */
  vel: number;
  hue: number;
  sat: number;
  light: number;
  /** Arc thickness at rest in px. */
  thickness: number;
  seed: number;
  sparkCount: number;
  /** Multiplier on spark speed and life (stronger for the climax chord). */
  sparkPower: number;
  climax: boolean;
  /** Index of the next note of the same track when it follows within THREAD_GAP_SEC, else -1 (melodic thread). */
  next: number;
}

/** Notes of one voice closer together than this are joined by a thin thread. */
export const THREAD_GAP_SEC = 0.55;

export interface Coincidence {
  timeSec: number;
  angle: number;
  rMin: number;
  rMax: number;
  /** 0..1: more voices and a true unison (same pitch) are stronger. */
  strength: number;
  voices: number;
  unison: boolean;
  hue: number;
}

export interface Climax {
  timeSec: number;
  noteCount: number;
  /** 0..1 */
  strength: number;
  firstIndex: number;
  lastIndex: number;
}

export interface OrbitModel {
  period: number;
  events: OrbitEvent[];
  ringMap: RingMap;
  accents: Accent[];
  coincidences: Coincidence[];
  climax: Climax | null;
  /** Longest visual duration of any arc, seconds. */
  maxVisualSec: number;
  trackCount: number;
}

/**
 * The last rolled chord near the end of the piece (4+ notes, loud), which becomes the climax. Notes are
 * chained into a cluster while each onset is within 0.12 s of the previous one.
 */
export function findClimax(notes: readonly MidiNote[], endSec: number): Climax | null {
  let best: Climax | null = null;
  let i = 0;
  while (i < notes.length) {
    let j = i + 1;
    let loudness = (notes[i].velocity / 127) ** 2;
    while (j < notes.length && notes[j].timeSec - notes[j - 1].timeSec <= 0.12 && notes[j].timeSec - notes[i].timeSec <= 0.5) {
      loudness += (notes[j].velocity / 127) ** 2;
      j++;
    }
    const count = j - i;
    const start = notes[i].timeSec;
    if (count >= 4 && loudness >= 2 && endSec - start <= Math.max(8, 0.3 * endSec)) {
      best = { timeSec: start, noteCount: count, strength: smoothstep(1.2, 3.8, loudness), firstIndex: i, lastIndex: j - 1 };
    }
    i = j;
  }
  return best;
}

/** Strikes shared by two or more voices within 25 ms: the unison alignments of a phasing piece. */
export function findCoincidences(events: readonly OrbitEvent[], climax: Climax | null): Coincidence[] {
  const out: Coincidence[] = [];
  let i = 0;
  while (i < events.length) {
    let j = i + 1;
    while (j < events.length && events[j].timeSec - events[j - 1].timeSec <= 0.025 && events[j].timeSec - events[i].timeSec <= 0.06) j++;
    const first = events[i];
    const inClimax = climax !== null && first.timeSec >= climax.timeSec - 0.01 && first.timeSec <= climax.timeSec + 0.5;
    if (j - i >= 2 && !inClimax) {
      const tracks = new Set<number>();
      let rMin = Infinity, rMax = -Infinity, loudest = first, unison = false;
      for (let k = i; k < j; k++) {
        const ev = events[k];
        tracks.add(ev.track);
        rMin = Math.min(rMin, ev.radius);
        rMax = Math.max(rMax, ev.radius);
        if (ev.vel > loudest.vel) loudest = ev;
        for (let m = i; m < k; m++) if (events[m].track !== ev.track && events[m].pitch === ev.pitch) unison = true;
      }
      if (tracks.size >= 2) {
        const strength = clamp01(0.3 + 0.22 * (tracks.size - 2) + (unison ? 0.4 : 0));
        out.push({ timeSec: first.timeSec, angle: first.angle, rMin, rMax, strength, voices: tracks.size, unison, hue: loudest.hue });
      }
    }
    i = j;
  }
  return out;
}

/** Everything a frame needs, derived once from the parsed file. Works for 0, 1 or thousands of notes. */
export function buildOrbit(scene: MidiSceneData): OrbitModel {
  const notes = scene.notes;
  const period = orbitPeriod(scene);
  const ringMap = buildRingMap(notes);
  const trackIds = [...new Set(notes.map((n) => n.track))].sort((a, b) => a - b);
  const slotOf = new Map(trackIds.map((id, slot) => [id, slot] as const));
  const climax = findClimax(notes, scene.endSec);
  const baseThickness = clamp(ringMap.minGap * 0.86, 4, 20);
  const laneStep = clamp(ringMap.minGap * 0.2, 0, 4.5);
  const maxVisual = period * 0.96;
  let maxVisualSec = 0;

  const events: OrbitEvent[] = notes.map((note, index) => {
    const slot = slotOf.get(note.track) ?? 0;
    const colour = PALETTE[slot % PALETTE.length];
    const vel = clamp01(note.velocity / 127);
    const visual = Math.min(Math.max(note.durationSec, 0), maxVisual);
    maxVisualSec = Math.max(maxVisualSec, visual);
    const lane = ((slot % 3) - 1) * laneStep;
    const radius = ringMap.radiusOf(note.pitch) + lane;
    const thickness = baseThickness * (0.8 + 0.3 * vel);
    const inClimax = climax !== null && index >= climax.firstIndex && index <= climax.lastIndex;
    // Cap to cap: at least a pill 1.3 thicknesses long (a dot with round caps), at most almost a full turn.
    const length = clamp(TAU * visual / period, thickness * 1.3 / radius, TAU * 0.965);
    return {
      index, timeSec: note.timeSec, endSec: note.timeSec + visual, track: note.track, slot,
      pitch: note.pitch, ring: ringMap.rankOf(note.pitch), radius,
      angle: noteAngle(note.timeSec, period), length, vel,
      hue: colour.hue, sat: colour.sat, light: colour.light, thickness,
      seed: index, sparkCount: inClimax ? 18 : clamp(Math.round(4 + vel * 7), 5, 11), sparkPower: inClimax ? 1.35 : 1,
      climax: inClimax, next: -1,
    };
  });
  const lastOfTrack = new Map<number, number>();
  for (const ev of events) {
    const before = lastOfTrack.get(ev.track);
    if (before !== undefined && ev.timeSec - events[before].endSec <= THREAD_GAP_SEC && ev.timeSec >= events[before].endSec - 1e-9) {
      events[before].next = ev.index;
    }
    lastOfTrack.set(ev.track, ev.index);
  }

  return {
    period, events, ringMap,
    accents: buildAccents(notes, 0.13, 0.9, 2.2),
    coincidences: findCoincidences(events, climax),
    climax, maxVisualSec, trackCount: trackIds.length,
  };
}

/** Index of the first event with timeSec >= t (events sorted by onset). */
export function firstEventAtOrAfter(events: readonly { timeSec: number }[], t: number): number {
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].timeSec < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Half-open range [from, to) of events whose arcs can be visible at time t (0.4 turns behind, 0.6 ahead). */
export function visibleRange(model: Pick<OrbitModel, "events" | "period" | "maxVisualSec">, t: number): [number, number] {
  const from = firstEventAtOrAfter(model.events, t - WINDOW_BEHIND * model.period - model.maxVisualSec);
  const to = firstEventAtOrAfter(model.events, t + WINDOW_AHEAD * model.period);
  return [from, to];
}

export interface ArcState {
  visible: boolean;
  /** Body opacity 0..1 (upcoming notes dim, struck notes bright, then fading out behind the playhead). */
  alpha: number;
  /** Fraction of the arc the playhead has swept (0 while upcoming, 1 once the note is over). */
  lit: number;
  /** White-hot amount, 1 at the first frame of the crossing, fast decay. */
  flash: number;
  /** Damped spring, +1 at the crossing: drives thickness (pop) and a radial bump. */
  spring: number;
  /** Seconds since the crossing (negative before it). */
  age: number;
}

/**
 * Look of an arc at piece time t. `flare` (0..1) is the climax: every visible arc brightens and swells.
 * The flash starts exactly at the first frame where t >= timeSec.
 */
export function arcState(ev: OrbitEvent, t: number, period: number, flare = 0): ArcState {
  const age = t - ev.timeSec;
  const ahead = WINDOW_AHEAD * period;
  const behind = WINDOW_BEHIND * period;
  let alpha: number, lit = 0, flash = 0, spring = 0;
  if (age < 0) {
    const d = -age;
    const enter = 1 - smoothstep(ahead * 0.8, ahead, d);
    const charge = 1 - smoothstep(0, 0.26 * period, d);
    alpha = enter * (0.26 + 0.34 * charge);
  } else {
    const visual = ev.endSec - ev.timeSec;
    lit = visual <= 0 ? 1 : clamp01(age / visual);
    const fadeAge = Math.max(0, age - visual);
    alpha = Math.exp(-fadeAge / (0.17 * period)) * (1 - smoothstep(behind * 0.62, behind, fadeAge));
    flash = Math.exp(-age / 0.1);
    spring = Math.exp(-age * 10) * Math.cos(age * 28);
  }
  if (flare > 0) {
    alpha += (1 - alpha) * flare * 0.7;
    flash = Math.max(flash, flare * 0.55);
  }
  return { visible: alpha > 0.004, alpha, lit, flash, spring, age };
}

/** Pulse strength of the bar start (the playhead passing 12 o'clock): 1 at the downbeat, decaying. */
export function barPulse(t: number, period: number): number {
  if (t < 0) return 0;
  return Math.exp(-(t % period) / (0.16 * period));
}

/** Climax envelope: 0 before the chord, 1 at the onset (times the chord's strength), decaying over `tau` s. */
export function climaxEnvelope(climax: Climax | null, t: number, tau: number): number {
  if (!climax || t < climax.timeSec) return 0;
  return climax.strength * Math.exp(-(t - climax.timeSec) / tau);
}

/** Index of the first event with timeSec > t. */
export function firstEventAfter(events: readonly { timeSec: number }[], t: number): number {
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].timeSec <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Indices of the arcs to draw at time t, in onset order: everything inside the window, or, for very dense
 * files, an even stride through it (always keeping the notes just struck or about to be struck), capped at MAX_ARCS.
 */
export function pickVisible(model: Pick<OrbitModel, "events" | "period" | "maxVisualSec">, t: number, out: number[]): void {
  out.length = 0;
  const [from, to] = visibleRange(model, t);
  const count = to - from;
  const stride = Math.max(1, Math.ceil(count / MAX_ARCS));
  for (let i = from; i < to && out.length < MAX_ARCS; i++) {
    const near = model.events[i].timeSec <= t + 0.15 && model.events[i].timeSec >= t - 0.5;
    if (stride === 1 || near || (i - from) % stride === 0) out.push(i);
  }
}

/** Expanding shockwave ring of the climax: k-th ring `age` seconds after the final chord, or null. */
export function shockwave(age: number, k: number): { radius: number; alpha: number; width: number } | null {
  const u = (age - 0.16 * k) / 1.7;
  if (u < 0 || u >= 1) return null;
  const eased = 1 - (1 - u) ** 3;
  const width = 14 - 12 * u;
  return { radius: 36 + (DISC.rMax - 20 - width / 2 - 36) * eased, alpha: (1 - u) ** 1.7, width };
}

/** Diameter of the glow where the playhead strikes an arc. */
export const strikeGlowDiameter = (vel: number) => 44 + 70 * vel;

/**
 * Largest radius from the hub any arc (its glow stroke at maximum pop and flare, or the strike glow) can
 * reach, disc units.
 */
export function maxArcExtent(events: readonly OrbitEvent[]): number {
  let extent = 0;
  for (const ev of events) {
    const thickness = ev.thickness * (1 + 0.6) * 1.25; // spring pop and climax swell
    const stroke = ev.radius + 3 + thickness * 1.3; // radial bump 3 px, glow stroke 2.5x = 1.25x the half width
    extent = Math.max(extent, stroke, ev.radius + strikeGlowDiameter(ev.vel) / 2);
  }
  return extent;
}
