import { clamp, clamp01, hash01, lerp, smoothstep } from "../midi/kit.ts";
import type { MidiNote } from "../midi/types.ts";

/** Framing-standard stage bounds: x = 50..1030 (width 980, centred on 540), y = 290..1590 (centred on 940). */
export const STAGE = {
  left: 50,
  right: 1030,
  top: 290,
  hudBottom: 366,
  belfryLeft: 66,
  belfryRight: 1014,
  topBeamY: 446,
  midBeamY: 748,
  botBeamY: 1104,
  ropeRailY: 1536,
  bottom: 1590,
} as const;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function pitchName(pitch: number): string {
  const pc = ((pitch % 12) + 12) % 12;
  const oct = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[pc]}${oct}`;
}

export interface CarillonBell {
  index: number;
  tier: 0 | 1 | 2; // 0 = treble (top), 1 = melody (mid), 2 = bourdon (bottom)
  pitch: number;
  label: string;
  /** Pivot centre (x, y) where the oak headstock hangs on the belfry cross-beam. */
  x: number;
  pivotY: number;
  /** Cast-bronze bell mouth width & total height in px. */
  mouthW: number;
  bellH: number;
  /** Natural damped swing frequency in Hz (heavy bourdon slower, bright treble quicker). */
  swingHz: number;
  /** Accent hue when struck (warm gold in bass -> bright lime-gold in treble). */
  hue: number;
}

export interface BellStrike {
  index: number;
  note: MidiNote;
  bellIndex: number;
  pitch: number;
  x: number;
  rimY: number;
  tOn: number;
  vel01: number;
  hue: number;
  /** Swing direction (+1 or -1), alternating on rapid repeats so the bell swings naturally. */
  dir: number;
  seed: number;
}

export interface CarillonPlan {
  bells: readonly CarillonBell[];
  strikes: readonly BellStrike[];
  byBell: readonly (readonly BellStrike[])[];
  bellByPitch: ReadonlyMap<number, number>;
  haloNotes: readonly MidiNote[];
}

const TREBLE_PITCHES = [71, 73, 74, 76, 78, 79, 81] as const; // B4..A5 (7 bells, centred on x = 540)
const MELODY_PITCHES = [57, 59, 61, 62, 64, 66, 67, 69] as const; // A3..A4 (8 bells, symmetric about x = 540)
const BOURDON_PITCHES = [45, 47, 49, 50, 52, 54, 55] as const; // A2..G3 (7 bells, centred on x = 540)

export function buildCarillonPlan(notes: readonly MidiNote[]): CarillonPlan {
  const bells: CarillonBell[] = [];
  const bellByPitch = new Map<number, number>();

  const addTier = (
    tier: 0 | 1 | 2,
    pitches: readonly number[],
    beamY: number,
    stepX: number,
    wRange: readonly [number, number],
    hRange: readonly [number, number],
    hzRange: readonly [number, number],
    hueRange: readonly [number, number],
  ) => {
    const mid = (pitches.length - 1) / 2;
    pitches.forEach((pitch, i) => {
      const u = pitches.length > 1 ? i / (pitches.length - 1) : 0.5;
      const x = 540 + (i - mid) * stepX;
      // Subtle symmetric Gothic arch rise toward the centre of each tier
      const archLift = Math.cos(((i - mid) / Math.max(1, mid)) * (Math.PI / 2)) * (tier === 0 ? 14 : tier === 1 ? 10 : 6);
      const bell: CarillonBell = {
        index: bells.length,
        tier,
        pitch,
        label: pitchName(pitch),
        x,
        pivotY: beamY - archLift,
        mouthW: lerp(wRange[0], wRange[1], u),
        bellH: lerp(hRange[0], hRange[1], u),
        swingHz: lerp(hzRange[0], hzRange[1], u),
        hue: lerp(hueRange[0], hueRange[1], u),
      };
      bellByPitch.set(pitch, bell.index);
      bells.push(bell);
    });
  };

  addTier(0, TREBLE_PITCHES, STAGE.topBeamY, 122, [90, 74], [122, 98], [3.0, 3.8], [62, 82]);
  addTier(1, MELODY_PITCHES, STAGE.midBeamY, 110, [104, 88], [150, 126], [2.3, 2.9], [46, 74]);
  addTier(2, BOURDON_PITCHES, STAGE.botBeamY, 124, [122, 102], [192, 160], [1.65, 2.1], [32, 46]);

  const findBell = (pitch: number): number => {
    const exact = bellByPitch.get(pitch);
    if (exact !== undefined) return exact;
    let best = 0;
    let bestDist = Infinity;
    for (const b of bells) {
      const d = Math.abs(b.pitch - pitch);
      if (d < bestDist) {
        best = b.index;
        bestDist = d;
      }
    }
    return best;
  };

  const bellNotes = notes.filter((n) => n.channel !== 3 && n.channel !== 9);
  const haloNotes = notes.filter((n) => n.channel === 3);
  const strikeCountPerBell = new Int32Array(bells.length);

  const strikes: BellStrike[] = bellNotes.map((note, index) => {
    const bellIndex = findBell(note.pitch);
    const bell = bells[bellIndex];
    const dir = strikeCountPerBell[bellIndex] % 2 === 0 ? 1 : -1;
    strikeCountPerBell[bellIndex]++;
    return {
      index,
      note,
      bellIndex,
      pitch: bell.pitch,
      x: bell.x,
      rimY: bell.pivotY + bell.bellH * 0.86,
      tOn: note.timeSec,
      vel01: clamp01(note.velocity / 127),
      hue: bell.hue,
      dir,
      seed: index * 6151 + 19,
    };
  });

  const byBell = bells.map((_, i) => strikes.filter((s) => s.bellIndex === i));
  return { bells, strikes, byBell, bellByPitch, haloNotes };
}

export interface BellMotion {
  /** Bell swing angle in radians (positive = tilted counter-clockwise). */
  angle: number;
  /** Clapper relative angle inside the bell (hits the sound-bow at exact t = tOn). */
  clapperAngle: number;
  /** Vertical rope pull displacement in px (0 at rest, up to +18 px just before strike). */
  ropePullPx: number;
  /** 0..1 metallic glow intensity. */
  glow: number;
  /** Seconds since latest strike (-1 when idle). */
  age: number;
  /** Latest strike direction (+1 or -1) for rim spark placement. */
  dir: number;
  vel01: number;
}

/** Deterministic physical pendulum & clapper motion for one cast-bronze bell at piece time t. */
export function bellMotionAt(bell: CarillonBell, strikes: readonly BellStrike[], t: number): BellMotion {
  let angle = 0;
  let clapperAngle = 0;
  let ropePullPx = 0;
  let glow = 0;
  let age = -1;
  let dir = 1;
  let vel01 = 0;

  let lo = 0;
  let hi = strikes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strikes[mid].tOn < t - 2.6) lo = mid + 1;
    else hi = mid;
  }

  for (let i = Math.max(0, lo - 1); i < strikes.length; i++) {
    const s = strikes[i];
    const dt = s.tOn - t;
    if (dt > 0.16) break;

    if (dt > 0) {
      // Pre-strike wind-up (0..140 ms before tOn): braided rope pulls down, tilting bell & clapper back.
      const pull = smoothstep(0.14, 0.0, dt);
      ropePullPx += 18 * pull * (0.7 + 0.3 * s.vel01);
      angle -= s.dir * 0.14 * pull * (0.7 + 0.3 * s.vel01);
      clapperAngle += s.dir * 0.22 * pull;
    } else {
      const a = -dt;
      if (a <= 2.4) {
        const amp = (0.16 + 0.14 * s.vel01) * (bell.tier === 2 ? 0.85 : 1);
        const tau = bell.tier === 2 ? 0.92 : bell.tier === 1 ? 0.72 : 0.56;
        const env = Math.exp(-a / tau);
        const w = 2 * Math.PI * bell.swingHz;
        angle += s.dir * amp * env * Math.cos(w * a);
        // Clapper strikes the bronze rim at a = 0 (max deflection = 0.26 rad), then lags behind the bell.
        const clapEnv = Math.exp(-a / (tau * 0.68));
        clapperAngle += s.dir * (0.26 * Math.exp(-a / 0.07) - 0.18 * clapEnv * Math.sin(w * a));
        ropePullPx += 12 * Math.exp(-a / 0.1) * Math.cos(w * a * 0.5);

        const g = Math.exp(-a / (tau * 0.82)) * (0.52 + 0.48 * s.vel01) + 0.55 * Math.exp(-a / 0.09);
        if (g >= glow) {
          glow = g;
          age = a;
          dir = s.dir;
          vel01 = s.vel01;
        }
      }
    }
  }

  return {
    angle: clamp(angle, -0.36, 0.36),
    clapperAngle: clamp(clapperAngle, -0.34, 0.34),
    ropePullPx: clamp(ropePullPx, -4, 22),
    glow: clamp01(glow),
    age,
    dir,
    vel01,
  };
}

export function carillonProgressAt(t: number, endSec: number, tailSec: number): number {
  if (t <= 0 || endSec <= 0) return 0;
  const play = clamp01(t / endSec);
  const reset = smoothstep(endSec + 0.6, endSec + Math.max(1.2, tailSec - 0.15), t);
  return clamp01(play * (1 - reset));
}

export function pealedCountAt(strikes: readonly BellStrike[], t: number, endSec: number, tailSec: number): number {
  if (t < 0) return 0;
  let lo = 0;
  let hi = strikes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strikes[mid].tOn <= t + 1e-6) lo = mid + 1;
    else hi = mid;
  }
  const reset = smoothstep(endSec + 0.6, endSec + Math.max(1.2, tailSec - 0.15), t);
  return Math.round(lo * (1 - reset));
}

export function haloEnergyAt(haloNotes: readonly MidiNote[], t: number): number {
  let e = 0;
  for (const n of haloNotes) {
    if (n.timeSec > t) break;
    if (t <= n.timeSec + n.durationSec + 0.4) {
      const fadeIn = smoothstep(n.timeSec, n.timeSec + 0.25, t);
      const fadeOut = 1 - smoothstep(n.timeSec + n.durationSec - 0.15, n.timeSec + n.durationSec + 0.4, t);
      e += (n.velocity / 127) * fadeIn * fadeOut;
    }
  }
  return clamp01(e * 0.75);
}

export function bellSparkAt(
  ev: BellStrike,
  k: number,
  age: number,
): { x: number; y: number; size: number; alpha: number } | null {
  const life = 0.24 + 0.34 * hash01(ev.seed, k * 7 + 1);
  if (age < 0 || age > life) return null;
  const baseAngle = ev.dir > 0 ? 0.2 : Math.PI - 0.2;
  const angle = baseAngle + (hash01(ev.seed, k * 7 + 2) - 0.5) * 1.65;
  const speed = (100 + 240 * hash01(ev.seed, k * 7 + 3)) * (0.65 + 0.45 * ev.vel01);
  const drag = 2.6;
  const dec = (1 - Math.exp(-drag * age)) / drag;
  const x = ev.x + ev.dir * 26 + Math.cos(angle) * speed * dec;
  const y = ev.rimY + Math.sin(angle) * speed * dec + 210 * age * age;
  const fade = 1 - age / life;
  return { x, y, size: 2.5 + 3.5 * hash01(ev.seed, k * 7 + 4), alpha: fade * fade };
}
