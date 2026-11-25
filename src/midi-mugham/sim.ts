import { clamp, clamp01, hash01, lerp, smoothstep } from "../midi/kit.ts";
import type { MidiNote } from "../midi/types.ts";

/**
 * Framing-standard stage bounds: 980 px wide (x = 50..1030, centred on x = 540),
 * y = 295..1645 (height 1350 px, vertical centre y = 970, well clear of quiet logo y = 95..156 and title y = 178..248).
 */
export const STAGE = {
  left: 50,
  right: 1030,
  top: 295,
  hudBottom: 355,
  tarTop: 360,
  tarBottom: 890,
  medallionTop: 890,
  medallionBottom: 1045,
  pianoTop: 1045,
  pianoKeyTop: 1255,
  pianoBottom: 1405,
  bassTop: 1415,
  bottom: 1645,
} as const;

export const PITCH_AXIS_LEFT = 96;
export const PITCH_AXIS_RIGHT = 984;
export const MELODY_MIN_PITCH = 48; // C3
export const MELODY_MAX_PITCH = 86; // D6
export const BASS_MIN_PITCH = 36;   // C2
export const BASS_MAX_PITCH = 55;   // G3

export const MIZRAB_REST_X = 540;
export const MIZRAB_REST_Y = 588;
export const BOW_REST_X = 240;
export const BASS_HAND_REST_X = 540;

export type MughamRole = "tar" | "kamancha" | "piano" | "bass" | "brush";

export interface MughamNoteEvent {
  index: number;
  note: MidiNote;
  role: MughamRole;
  pitch: number;
  pitchBendCents: number;
  x: number;
  yTarget: number;
  stringIdx: number;
  vel01: number;
  hue: number;
  tPrep: number;
  tOn: number;
  tOff: number;
  seed: number;
}

/** Shared horizontal pitch coordinate across Tar fingerboard and Grand Piano action (centred on x = 540). */
export function melodyPitchToX(pitch: number, cents = 0): number {
  const u = clamp01((pitch + cents / 100 - MELODY_MIN_PITCH) / (MELODY_MAX_PITCH - MELODY_MIN_PITCH));
  return lerp(PITCH_AXIS_LEFT, PITCH_AXIS_RIGHT, u);
}

/** Horizontal pluck coordinate along the 4-string upright bass resonator deck. */
export function bassPitchToX(pitch: number): number {
  const u = clamp01((pitch - BASS_MIN_PITCH) / (BASS_MAX_PITCH - BASS_MIN_PITCH));
  return lerp(PITCH_AXIS_LEFT + 36, PITCH_AXIS_RIGHT - 36, u);
}

export function classifyMughamRole(note: MidiNote): MughamRole {
  if (note.channel === 9) return "brush";
  if (note.track === 1 || note.channel === 0) return "tar";
  if (note.track === 2 || note.channel === 1) return "kamancha";
  if (note.track === 4 || note.channel === 3 || note.pitch < 48) return "bass";
  return "piano";
}

export const TAR_COURSE_Y = [604, 640, 676] as const;
export const BASS_STRING_Y = [1468, 1508, 1548, 1588] as const;
export const KAMANCHA_Y = 508;
export const PIANO_STRIKE_Y = 1118;
export const MEDALLION_CX = 540;
export const MEDALLION_CY = 968;

/** Build 1-to-1 physical striker/bow/brush events for every MIDI note in the piece. */
export function buildMughamEvents(notes: readonly MidiNote[]): MughamNoteEvent[] {
  return notes.map((note, index) => {
    const role = classifyMughamRole(note);
    const cents = note.pitchBendCents ?? 0;
    const vel01 = clamp01(note.velocity / 127);
    let x = MEDALLION_CX;
    let yTarget = MEDALLION_CY;
    let stringIdx = 0;
    let hue = 42;
    let prepLead = 0.24;

    if (role === "tar") {
      x = melodyPitchToX(note.pitch, cents);
      stringIdx = note.pitch < 66 ? 2 : note.pitch < 74 ? 1 : 0;
      yTarget = TAR_COURSE_Y[stringIdx];
      // Warm amber-gold (38..48) shifting to luminous lime-turquoise (78) on +40c Shur microtonal ornaments
      hue = Math.abs(cents) > 10 ? 78 : lerp(36, 52, clamp01((note.pitch - 60) / 26));
      prepLead = 0.22;
    } else if (role === "kamancha") {
      x = melodyPitchToX(Math.max(MELODY_MIN_PITCH, note.pitch), cents);
      yTarget = KAMANCHA_Y;
      hue = 28; // warm saffron-amber bowed resin
      prepLead = 0.35;
    } else if (role === "piano") {
      x = melodyPitchToX(clamp(note.pitch, MELODY_MIN_PITCH, MELODY_MAX_PITCH), cents);
      yTarget = PIANO_STRIKE_Y;
      hue = lerp(192, 224, clamp01((note.pitch - 50) / 34)); // nocturnal Caspian sapphire-cyan
      prepLead = 0.26;
    } else if (role === "bass") {
      x = bassPitchToX(note.pitch);
      stringIdx = note.pitch < 40 ? 3 : note.pitch < 45 ? 2 : note.pitch < 50 ? 1 : 0;
      yTarget = BASS_STRING_Y[stringIdx];
      hue = 34; // deep copper-gold bass resonance
      prepLead = 0.28;
    } else {
      // Brush event on central 7/8 medallion
      x = MEDALLION_CX;
      yTarget = MEDALLION_CY;
      stringIdx = note.pitch === 39 ? 0 : note.pitch === 40 ? 1 : 2;
      hue = 50;
      prepLead = 0.16;
    }

    const dur = Math.max(0.08, note.durationSec);
    return {
      index,
      note,
      role,
      pitch: note.pitch,
      pitchBendCents: cents,
      x,
      yTarget,
      stringIdx,
      vel01,
      hue,
      tPrep: note.timeSec - prepLead,
      tOn: note.timeSec,
      tOff: note.timeSec + dur,
      seed: index * 4999 + 17,
    };
  });
}

export interface StrikerImpactState {
  /** True during the audible/active strike window starting at exact tOn. */
  active: boolean;
  /** 0..1 anticipatory drawback before tOn. */
  prep: number;
  /** 0..1 physical impact impulse peaking at tOn and decaying smoothly. */
  strike: number;
  /** 0..1 sustained string/skin glow over the held note duration. */
  sustain: number;
}

/** Exact closed-form state of a single striker event at piece time t (within 1 frame of note-on). */
export function eventStateAt(ev: MughamNoteEvent, t: number): StrikerImpactState | null {
  if (t < ev.tPrep || t > ev.tOff + 0.55) return null;
  if (t < ev.tOn) {
    const prep = smoothstep(ev.tPrep, ev.tOn, t);
    return { active: false, prep, strike: 0, sustain: 0 };
  }
  const age = t - ev.tOn;
  const dur = Math.max(0.08, ev.tOff - ev.tOn);
  const rel = smoothstep(dur, dur + 0.35, age);
  const strike = Math.exp(-age / 0.11) * (0.55 + 0.45 * ev.vel01);
  const sustain = clamp01((1 - rel) * (0.38 + 0.62 * Math.exp(-age / Math.max(0.25, dur * 0.9))) * (0.5 + 0.5 * ev.vel01));
  const active = age >= 0 && age <= dur + 0.08;
  return { active, prep: 0, strike: clamp01(strike), sustain };
}

export interface MizrabPose {
  x: number;
  y: number;
  fretX: number;
  fretY: number;
  angle: number;
  pluckDeflection: number;
  microtonalGlow: number;
}

/** Continuous deterministic trajectory of the Tar fretting hand and Mizrab plectrum, returning to rest at loop end. */
export function mizrabPoseAt(
  tarEvents: readonly MughamNoteEvent[],
  t: number,
  leadSec: number,
  endSec: number,
  tailSec: number,
): MizrabPose {
  if (!tarEvents.length) {
    return {
      x: MIZRAB_REST_X,
      y: MIZRAB_REST_Y,
      fretX: MIZRAB_REST_X,
      fretY: TAR_COURSE_Y[1],
      angle: -0.25,
      pluckDeflection: 0,
      microtonalGlow: 0,
    };
  }
  const first = tarEvents[0];
  const last = tarEvents[tarEvents.length - 1];

  if (t <= first.tOn) {
    const u = smoothstep(-leadSec, first.tOn, t);
    const cock = Math.sin(Math.PI * smoothstep(first.tOn - 0.28, first.tOn, t));
    return {
      x: lerp(MIZRAB_REST_X, first.x + 28, u),
      y: lerp(MIZRAB_REST_Y, first.yTarget, u) - cock * 26,
      fretX: lerp(MIZRAB_REST_X, first.x, u),
      fretY: lerp(TAR_COURSE_Y[1], first.yTarget, u),
      angle: -0.25 - cock * 0.32,
      pluckDeflection: 0,
      microtonalGlow: 0,
    };
  }

  const settleStart = last.tOff + 0.1;
  const settleEnd = endSec + tailSec - 0.06;
  if (t >= settleStart) {
    const u = smoothstep(settleStart, Math.max(settleStart + 0.25, settleEnd), t);
    return {
      x: lerp(last.x + 28, MIZRAB_REST_X, u),
      y: lerp(last.yTarget, MIZRAB_REST_Y, u) - 18 * Math.sin(Math.PI * u),
      fretX: lerp(last.x, MIZRAB_REST_X, u),
      fretY: lerp(last.yTarget, TAR_COURSE_Y[1], u),
      angle: -0.25,
      pluckDeflection: 0,
      microtonalGlow: 0,
    };
  }

  let lo = 0;
  let hi = tarEvents.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tarEvents[mid].tOn <= t) lo = mid;
    else hi = mid - 1;
  }
  const curr = tarEvents[lo];
  const next = tarEvents[Math.min(tarEvents.length - 1, lo + 1)];
  const span = Math.max(0.03, next.tOn - curr.tOn);
  const u = clamp01((t - curr.tOn) / span);
  const glide = smoothstep(0.18, 0.92, u);
  const age = t - curr.tOn;

  const fretX = lerp(curr.x, next.x, glide);
  const fretY = lerp(curr.yTarget, next.yTarget, glide);
  const downStroke = curr.index % 2 === 0 ? 1 : -1;
  const kick = downStroke * 22 * Math.exp(-age / 0.065) * Math.cos(age * 28);
  const prepLift = -16 * smoothstep(0.68, 0.98, u) * downStroke;
  const bendGlow = Math.abs(curr.pitchBendCents) > 10 ? Math.exp(-age / 0.55) : 0;
  const bendSlide = bendGlow * 6 * Math.sin(Math.min(Math.PI, age * 9));

  return {
    x: clamp(fretX + 32, PITCH_AXIS_LEFT + 12, PITCH_AXIS_RIGHT + 18),
    y: fretY + kick + prepLift,
    fretX,
    fretY: fretY - bendSlide,
    angle: -0.25 + clamp((kick + prepLift) * 0.015, -0.45, 0.45),
    pluckDeflection: Math.exp(-age / 0.18) * curr.vel01,
    microtonalGlow: clamp01(bendGlow),
  };
}

/** Smooth horizontal pose of the upright-bass pizzicato plucking hand, settling cleanly for loops. */
export function bassHandPoseAt(
  bassEvents: readonly MughamNoteEvent[],
  t: number,
  leadSec: number,
  endSec: number,
  tailSec: number,
): { x: number; y: number; pluck: number } {
  if (!bassEvents.length) return { x: BASS_HAND_REST_X, y: BASS_STRING_Y[2], pluck: 0 };
  const first = bassEvents[0];
  const last = bassEvents[bassEvents.length - 1];
  if (t <= first.tOn) {
    const u = smoothstep(-leadSec, first.tOn, t);
    const cock = Math.sin(Math.PI * smoothstep(first.tOn - 0.25, first.tOn, t));
    return {
      x: lerp(BASS_HAND_REST_X, first.x, u),
      y: lerp(BASS_STRING_Y[2], first.yTarget, u) - cock * 14,
      pluck: 0,
    };
  }
  const settleStart = last.tOff + 0.05;
  const settleEnd = endSec + tailSec - 0.06;
  if (t >= settleStart) {
    const u = smoothstep(settleStart, Math.max(settleStart + 0.25, settleEnd), t);
    return {
      x: lerp(last.x, BASS_HAND_REST_X, u),
      y: lerp(last.yTarget, BASS_STRING_Y[2], u),
      pluck: 0,
    };
  }
  let lo = 0;
  let hi = bassEvents.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bassEvents[mid].tOn <= t) lo = mid;
    else hi = mid - 1;
  }
  const curr = bassEvents[lo];
  const next = bassEvents[Math.min(bassEvents.length - 1, lo + 1)];
  const span = Math.max(0.05, next.tOn - curr.tOn);
  const u = smoothstep(0.25, 0.92, clamp01((t - curr.tOn) / span));
  const age = t - curr.tOn;
  return {
    x: lerp(curr.x, next.x, u),
    y: lerp(curr.yTarget, next.yTarget, u) + 11 * Math.exp(-age / 0.09) * Math.sin(age * 32),
    pluck: clamp01(Math.exp(-age / 0.22) * curr.vel01),
  };
}

/** Section label for the top HUD strip based on piece time. */
export function mughamSectionLabelAt(t: number, endSec: number): { section: string; groove78: boolean } {
  if (t < 11.8) return { section: "RUBATO INTRO  \u00b7  FREE TIME", groove78: false };
  if (t < 28.4) return { section: "7/8 CALL & RESPONSE  (2+2+3)", groove78: true };
  if (t < 38.6) return { section: "MODAL SOLO  \u00b7  7/8", groove78: true };
  if (t < endSec - 4.7) return { section: "OCTAVE UNISON CLIMAX", groove78: true };
  return { section: "DRONE RETURN", groove78: false };
}

export function brushParticleAt(seed: number, k: number, age: number): { dx: number; dy: number; alpha: number; r: number } | null {
  const life = 0.24 + 0.22 * hash01(seed, k * 5 + 1);
  if (age < 0 || age > life) return null;
  const ang = hash01(seed, k * 5 + 2) * Math.PI * 2;
  const spd = 70 + 160 * hash01(seed, k * 5 + 3);
  const dist = spd * (1 - Math.exp(-3.2 * age)) / 3.2;
  const fade = 1 - age / life;
  return {
    dx: Math.cos(ang) * dist,
    dy: Math.sin(ang) * dist,
    alpha: fade * fade,
    r: 2 + 2.5 * hash01(seed, k * 5 + 4),
  };
}
