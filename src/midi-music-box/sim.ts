import { clamp, clamp01, hash01, lerp, lowerBound, smoothstep } from "../midi/kit.ts";
import type { MidiNote } from "../midi/types.ts";

/** Framing-standard stage bounds: x = 50..1030 (width 980, centred on 540), y = 290..1590 (centred on 940). */
export const STAGE = {
  left: 50,
  right: 1030,
  top: 290,
  hudBottom: 366,
  cylLeft: 96,
  cylRight: 984,
  cylTop: 382,
  cylCenterY: 716,
  contactY: 1050,
  combBedTop: 1492,
  combBedBottom: 1572,
  bottom: 1590,
} as const;

export const CYL_RADIUS = STAGE.contactY - STAGE.cylCenterY; // 334 px
export const FRONT_HALF_SEC = 3.5; // seconds for a pin to travel from the top horizon (phi = pi) to contactY (phi = 0)
export const OMEGA = Math.PI / FRONT_HALF_SEC;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function pitchName(pitch: number): string {
  const pc = ((pitch % 12) + 12) % 12;
  const oct = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[pc]}${oct}`;
}

export interface CombTooth {
  index: number;
  pitch: number;
  label: string;
  x: number;
  width: number;
  /** Y where the oscillating steel cantilever joins its tuned root step (bass longer, treble shorter). */
  rootY: number;
  hue: number;
}

export interface PinEvent {
  index: number;
  note: MidiNote;
  toothIndex: number;
  pitch: number;
  x: number;
  vel01: number;
  hue: number;
  tOn: number;
  seed: number;
}

export interface MusicBoxPlan {
  teeth: readonly CombTooth[];
  events: readonly PinEvent[];
  byTooth: readonly (readonly PinEvent[])[];
}

export function buildMusicBoxPlan(notes: readonly MidiNote[]): MusicBoxPlan {
  const used = new Set<number>();
  for (const n of notes) used.add(clamp(Math.round(n.pitch), 0, 127));
  // Ensure at least 18 teeth so even a tiny test file renders a recognisable comb
  if (used.size < 18) {
    const seedPitch = notes[0]?.pitch ?? 69;
    const scale = [0, 2, 3, 5, 7, 8, 11];
    for (let oct = -2; oct <= 2 && used.size < 20; oct++) {
      for (const st of scale) {
        const cand = clamp(seedPitch + oct * 12 + st, 36, 96);
        used.add(cand);
        if (used.size >= 20) break;
      }
    }
  }
  const sortedPitches = [...used].sort((a, b) => a - b);
  // If an arbitrary external MIDI file uses > 40 chromatic pitches, fold extremes into the central 36-pitch comb
  while (sortedPitches.length > 38) {
    if (sortedPitches.length % 2 === 0) sortedPitches.shift();
    else sortedPitches.pop();
  }

  const combLeft = 114;
  const combRight = 966; // (114 + 966) / 2 = 540.0 exact symmetry!
  const count = sortedPitches.length;
  const slotW = (combRight - combLeft) / count;
  const toothW = Math.max(10, slotW * 0.72);

  const teeth: CombTooth[] = sortedPitches.map((pitch, index) => {
    const u = count > 1 ? index / (count - 1) : 0.5;
    const x = combLeft + (index + 0.5) * slotW;
    return {
      index,
      pitch,
      label: pitchName(pitch),
      x,
      width: toothW,
      // Longer free cantilever on bass teeth (left), shorter stiffer tine on treble teeth (right)
      rootY: lerp(STAGE.combBedTop - 4, STAGE.combBedTop - 155, u),
      hue: lerp(38, 192, u), // warm antique gold in bass -> silver-cyan in treble
    };
  });

  const findNearestTooth = (pitch: number): number => {
    let best = 0;
    let bestDist = Math.abs(teeth[0].pitch - pitch);
    // Prefer octave-equivalent tooth if exact pitch was trimmed
    for (let i = 0; i < teeth.length; i++) {
      const d = Math.abs(teeth[i].pitch - pitch);
      if (d === 0) return i;
      if ((Math.abs(teeth[i].pitch - pitch) % 12 === 0) && d < bestDist + 6) {
        best = i;
        bestDist = d - 6;
      } else if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    }
    return best;
  };

  const events: PinEvent[] = notes.map((note, index) => {
    const toothIndex = findNearestTooth(note.pitch);
    const tooth = teeth[toothIndex];
    return {
      index,
      note,
      toothIndex,
      pitch: tooth.pitch,
      x: tooth.x,
      vel01: clamp01(note.velocity / 127),
      hue: tooth.hue,
      tOn: note.timeSec,
      seed: index * 4999 + 13,
    };
  });

  const byTooth = teeth.map((_, idx) => events.filter((e) => e.toothIndex === idx));
  return { teeth, events, byTooth };
}

export interface PinPose {
  x: number;
  y: number;
  phi: number;
  /** 0 at top/bottom horizons, 1 pointing straight toward camera at cylCenterY. */
  depth: number;
  justPlucked: boolean;
}

/** 3D orthographic projection of a cylinder pin at piece time t, or null when on the back half of the drum. */
export function pinPoseAt(ev: PinEvent, t: number): PinPose | null {
  const phi = (ev.tOn - t) * OMEGA;
  if (phi < -0.16 || phi > Math.PI) return null;
  const y = STAGE.cylCenterY + CYL_RADIUS * Math.cos(Math.max(0, phi));
  // After phi < 0, the pin sweeps slightly behind the bottom contact edge and disappears
  const yActual = phi < 0 ? STAGE.contactY - Math.sin(-phi) * 24 : y;
  const depth = phi >= 0 ? Math.sin(phi) : Math.max(0, 1 + phi * 5) * 0.18;
  return {
    x: ev.x,
    y: yActual,
    phi,
    depth,
    justPlucked: phi <= 0 && phi >= -0.08,
  };
}

export interface ToothMotion {
  /** Horizontal tip wobble in px (pre-pluck deflection + post-pluck damped vibration). */
  tipDx: number;
  /** Vertical tip lift/dip in px at the contact line. */
  tipDy: number;
  /** 0..1 ring glow intensity. */
  glow: number;
  /** Seconds since the latest pluck (>= 0 when ringing, -1 otherwise). */
  pluckAge: number;
  vel01: number;
}

/** Physical deflection & damped steel-tine vibration of one comb tooth at piece time t. */
export function toothMotionAt(toothEvents: readonly PinEvent[], t: number): ToothMotion {
  let tipDx = 0;
  let tipDy = 0;
  let glow = 0;
  let pluckAge = -1;
  let vel01 = 0;

  // Binary search near t
  let lo = 0;
  let hi = toothEvents.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (toothEvents[mid].tOn < t - 1.6) lo = mid + 1;
    else hi = mid;
  }

  for (let i = Math.max(0, lo - 1); i < toothEvents.length; i++) {
    const ev = toothEvents[i];
    const dt = ev.tOn - t;
    if (dt > 0.12) break;
    if (dt > 0) {
      // Pin is pushing the steel tip just before release (0..95 ms pre-pluck tension)
      const load = smoothstep(0.095, 0.0, dt);
      tipDy += 5.5 * load * (0.7 + 0.3 * ev.vel01);
      tipDx += 1.8 * load;
    } else {
      const age = -dt;
      if (age <= 1.5) {
        const env = Math.exp(-age / 0.48) * (0.6 + 0.4 * ev.vel01);
        // Visible 21 Hz damped steel tine oscillation
        tipDx += 6.2 * env * Math.cos(2 * Math.PI * 21 * age);
        tipDy -= 3.8 * Math.exp(-age / 0.18) * Math.cos(2 * Math.PI * 16 * age);
        const ring = Math.exp(-age / 0.55) * (0.45 + 0.55 * ev.vel01) + 0.55 * Math.exp(-age / 0.09);
        if (ring >= glow) {
          glow = ring;
          pluckAge = age;
          vel01 = ev.vel01;
        }
      }
    }
  }

  return {
    tipDx: clamp(tipDx, -8, 8),
    tipDy: clamp(tipDy, -6, 7),
    glow: clamp01(glow),
    pluckAge,
    vel01,
  };
}

/** Progress 0..1 through the piece, smoothly resetting to 0 across the final loop tail so frame N-1 matches frame 0. */
export function pieceProgressAt(t: number, endSec: number, tailSec: number): number {
  if (t <= 0 || endSec <= 0) return 0;
  const playProgress = clamp01(t / endSec);
  const reset = smoothstep(endSec + 0.6, endSec + Math.max(1.2, tailSec - 0.15), t);
  return clamp01(playProgress * (1 - reset));
}

export function pluckedCountAt(notes: readonly MidiNote[], t: number, endSec: number, tailSec: number): number {
  if (t < 0) return 0;
  const count = lowerBound(notes, t + 1e-6);
  const reset = smoothstep(endSec + 0.6, endSec + Math.max(1.2, tailSec - 0.15), t);
  return Math.round(count * (1 - reset));
}

export function pluckSparkAt(ev: PinEvent, k: number, age: number): { x: number; y: number; size: number; alpha: number } | null {
  const life = 0.25 + 0.32 * hash01(ev.seed, k * 3 + 1);
  if (age < 0 || age > life) return null;
  const angle = -Math.PI / 2 + (hash01(ev.seed, k * 3 + 2) - 0.5) * 2.4;
  const speed = (130 + 310 * hash01(ev.seed, k * 3 + 3)) * (0.65 + 0.5 * ev.vel01);
  const drag = 3.0;
  const grav = 780;
  const dec = (1 - Math.exp(-drag * age)) / drag;
  const x = ev.x + Math.cos(angle) * speed * dec;
  const y = STAGE.contactY + Math.sin(angle) * speed * dec + (grav * (age - dec)) / drag;
  const fade = 1 - age / life;
  return { x, y, size: 3 + 4 * hash01(ev.seed, k * 3 + 4), alpha: fade * fade };
}
