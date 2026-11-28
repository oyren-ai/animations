import { clamp, clamp01, hash01, lerp, lowerBound, smoothstep } from "../midi/kit.ts";
import type { MidiNote } from "../midi/types.ts";

/** Framing-standard stage bounds: x = 50..1030 (width 980, centred on 540), y = 290..1590 (centred on 940). */
export const STAGE = {
  left: 50,
  right: 1030,
  top: 290,
  hudBottom: 366,
  caseLeft: 68,
  caseRight: 1012,
  boardTop: 396,
  nutY: 1120,
  jackRailTop: 1126,
  jackRailBottom: 1264,
  manualTop: 1326,
  manualBottom: 1564,
  bottom: 1590,
} as const;

export const HARPSICHORD_LOW_PITCH = 45;  // A2
export const HARPSICHORD_HIGH_PITCH = 85; // C#6

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const ACCIDENTAL_PCS = new Set([1, 3, 6, 8, 10]);

export function isAccidentalPitch(pitch: number): boolean {
  return ACCIDENTAL_PCS.has(((pitch % 12) + 12) % 12);
}

export function pitchName(pitch: number): string {
  const pc = ((pitch % 12) + 12) % 12;
  const oct = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[pc]}${oct}`;
}

export interface HarpsichordString {
  index: number;
  pitch: number;
  label: string;
  accidental: boolean;
  /** Brass string & wooden jack X position (evenly distributed symmetrically about x = 540). */
  stringX: number;
  /** Top hitch/bridge Y on the graceful curved harpsichord bentside (long bass left -> short treble right). */
  bridgeY: number;
  /** Plucking point Y where the crow-quill plectrum crosses the brass string. */
  pluckY: number;
  /** Reversed-colour manual key X & width at bottom console. */
  keyX: number;
  keyWidth: number;
  /** Normalized pitch 0 (A2 bass) -> 1 (C#6 treble). */
  u: number;
  /** Visual standing-wave oscillation frequency in Hz. */
  vibHz: number;
  hue: number;
}

export interface PluckEvent {
  index: number;
  note: MidiNote;
  stringIndex: number;
  pitch: number;
  tOn: number;
  tOff: number;
  vel01: number;
  hue: number;
  seed: number;
}

export interface HarpsichordPlan {
  strings: readonly HarpsichordString[];
  naturalStrings: readonly HarpsichordString[];
  accidentalStrings: readonly HarpsichordString[];
  events: readonly PluckEvent[];
  byString: readonly (readonly PluckEvent[])[];
  stringByPitch: ReadonlyMap<number, number>;
}

/**
 * Build the 41-string mechanical plucked concert harpsichord (A2 = 45 .. C#6 = 85):
 * - Upper soundboard: 41 graduated brass strings terminating along a classic curved bentside bridge.
 * - Middle jack rail: 41 vertical wooden jacks with white crow-quill plectra & red felt dampers.
 * - Lower console: authentic reversed-colour Baroque manual (24 ebony naturals + 17 ivory sharps).
 */
export function buildHarpsichordPlan(notes: readonly MidiNote[]): HarpsichordPlan {
  const totalStrings = HARPSICHORD_HIGH_PITCH - HARPSICHORD_LOW_PITCH + 1; // 41
  const naturalPitches: number[] = [];
  for (let p = HARPSICHORD_LOW_PITCH; p <= HARPSICHORD_HIGH_PITCH; p++) {
    if (!isAccidentalPitch(p)) naturalPitches.push(p);
  }

  // Symmetric 24-natural-key manual deck spanning x = 88..992 (mid = 540.0)
  const keyDeckLeft = 88;
  const keyDeckRight = 992;
  const natSlotW = (keyDeckRight - keyDeckLeft) / naturalPitches.length;
  const natKeyW = natSlotW * 0.9;
  const accKeyW = natSlotW * 0.56;

  const naturalKeyX = new Map<number, number>();
  naturalPitches.forEach((pitch, idx) => {
    naturalKeyX.set(pitch, keyDeckLeft + (idx + 0.5) * natSlotW);
  });

  // 41 strings & jacks spanning symmetrically x = 94..986 (mid = 540.0)
  const strLeft = 94;
  const strRight = 986;

  const strings: HarpsichordString[] = [];
  const stringByPitch = new Map<number, number>();

  for (let i = 0; i < totalStrings; i++) {
    const pitch = HARPSICHORD_LOW_PITCH + i;
    const u = i / Math.max(1, totalStrings - 1);
    const acc = isAccidentalPitch(pitch);
    const stringX = lerp(strLeft, strRight, u);

    // Classic exponential harpsichord bentside curve: long bass left -> compact treble right
    const bridgeY = lerp(420, 774, 1 - Math.pow(1 - u, 1.65));
    const pluckY = STAGE.nutY - lerp(96, 52, u);

    let keyX: number;
    if (!acc) {
      keyX = naturalKeyX.get(pitch)!;
    } else {
      const loX = naturalKeyX.get(pitch - 1) ?? keyDeckLeft;
      const hiX = naturalKeyX.get(pitch + 1) ?? keyDeckRight;
      keyX = (loX + hiX) * 0.5;
    }

    const s: HarpsichordString = {
      index: i,
      pitch,
      label: pitchName(pitch),
      accidental: acc,
      stringX,
      bridgeY,
      pluckY,
      keyX,
      keyWidth: acc ? accKeyW : natKeyW,
      u,
      vibHz: lerp(14, 30, u),
      hue: lerp(34, 76, u),
    };
    stringByPitch.set(pitch, i);
    strings.push(s);
  }

  const sorted = [...notes].sort((a, b) => a.timeSec - b.timeSec || a.pitch - b.pitch);
  const byStringMut: PluckEvent[][] = strings.map(() => []);
  const events: PluckEvent[] = [];

  for (const n of sorted) {
    const clamped = clamp(Math.round(n.pitch), HARPSICHORD_LOW_PITCH, HARPSICHORD_HIGH_PITCH);
    const sIdx = stringByPitch.get(clamped);
    if (sIdx === undefined) continue;
    const s = strings[sIdx];
    const tOn = n.timeSec;
    const tOff = tOn + Math.max(0.075, n.durationSec);
    const ev: PluckEvent = {
      index: events.length,
      note: n,
      stringIndex: sIdx,
      pitch: s.pitch,
      tOn,
      tOff,
      vel01: clamp01(n.velocity / 127),
      hue: s.hue,
      seed: hash01(events.length, s.pitch),
    };
    events.push(ev);
    byStringMut[sIdx].push(ev);
  }

  return {
    strings,
    naturalStrings: strings.filter((s) => !s.accidental),
    accidentalStrings: strings.filter((s) => s.accidental),
    events,
    byString: byStringMut,
    stringByPitch,
  };
}

export interface HarpsichordStringState {
  /** 0..1 manual key depression & wooden jack upward leap. */
  keyDown: number;
  /** 0..1 red felt damper lifted off the string (1 while held, 0 damped at rest). */
  damperUp: number;
  /** Signed transverse string vibration displacement in px. */
  vibPx: number;
  /** 0..1 standing-wave vibration envelope & golden-lime string glow. */
  vibEnv: number;
  /** 0..1 sharp quill-snap pluck burst right at note-on. */
  pluckBurst: number;
  /** Seconds since most recent pluck (Infinity if none). */
  age: number;
}

/** Pure mechanical & string-oscillation state for one harpsichord key -> jack -> plectrum -> brass string. */
export function harpsichordStringStateAt(
  str: HarpsichordString,
  strEvents: readonly PluckEvent[],
  t: number,
): HarpsichordStringState {
  if (strEvents.length === 0) {
    return { keyDown: 0, damperUp: 0, vibPx: 0, vibEnv: 0, pluckBurst: 0, age: Infinity };
  }

  let lo = 0;
  let hi = strEvents.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strEvents[mid].tOn <= t + 0.015) lo = mid + 1;
    else hi = mid;
  }

  let keyDown = 0;
  let vibPx = 0;
  let vibEnv = 0;
  let pluckBurst = 0;
  let bestAge = Infinity;

  for (let i = Math.max(0, lo - 3); i < lo; i++) {
    const ev = strEvents[i];
    const age = t - ev.tOn;
    if (age < -0.015) continue;

    let k = 0;
    if (age < 0) {
      k = smoothstep(-0.015, 0, age) * 0.45;
    } else if (t <= ev.tOff) {
      k = 1;
    } else {
      const rel = t - ev.tOff;
      if (rel > 0.35) continue;
      k = Math.max(0, 1 - smoothstep(0, 0.055, rel));
    }

    if (age >= 0) {
      const freeTau = lerp(0.85, 0.42, str.u);
      let env = Math.exp(-age / freeTau) * (0.68 + 0.32 * ev.vel01);
      // Felt damper lands on the brass string when key releases -> rapid crisp damping!
      if (t > ev.tOff) {
        env *= Math.exp(-(t - ev.tOff) / 0.055);
      }
      if (env > vibEnv) {
        vibEnv = env;
        vibPx = Math.sin(age * str.vibHz * Math.PI * 2 + 0.4) * env * lerp(8.5, 5.2, str.u);
      }
      const burst = Math.exp(-age / 0.13) * (0.6 + 0.4 * ev.vel01);
      if (burst > pluckBurst) pluckBurst = burst;
      if (age < bestAge) bestAge = age;
    }

    if (k > keyDown) keyDown = k;
  }

  return {
    keyDown: clamp01(keyDown),
    damperUp: clamp01(smoothstep(0.1, 0.8, keyDown)),
    vibPx,
    vibEnv: clamp01(vibEnv),
    pluckBurst: clamp01(pluckBurst),
    age: bestAge,
  };
}

export function pluckedCountAt(events: readonly PluckEvent[], t: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].tOn <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function harpsichordProgressAt(t: number, endSec: number, tailSec: number): number {
  if (t <= 0 || endSec <= 0) return 0;
  if (t <= endSec) return clamp01(t / endSec);
  const resetStart = endSec + Math.max(0.35, tailSec - 0.5);
  const resetEnd = endSec + tailSec - 0.04;
  if (t <= resetStart) return 1;
  return 1 - smoothstep(resetStart, resetEnd, t);
}

export function harpsichordSectionLabelAt(t: number, endSec: number): string {
  const frac = endSec > 0 ? clamp01(t / endSec) : 0;
  if (frac < 0.21) return "A MINOR · THEME A";
  if (frac < 0.41) return "C MAJOR · EPISODE B";
  if (frac < 0.61) return "THEME A · RETURN";
  return "A MAJOR · JANISSARY";
}

export { lowerBound };
