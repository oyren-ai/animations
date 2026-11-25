import { clamp, clamp01, lerp, smoothstep } from "../midi/kit.ts";
import type { MidiNote } from "../midi/types.ts";

/** Framing-standard stage bounds: x = 50..1030 (width 980, centred on 540), y = 290..1590 (centred on 940). */
export const STAGE = {
  left: 50,
  right: 1030,
  playheadX: 540,
  top: 290,
  hudBottom: 356,
  lanesTop: 368,
  bottom: 1590,
} as const;

export const VOICE_COUNT = 5;
export const PX_PER_SEC = 132; // +/- 3.71 s visible on each side of the x = 540 playhead
export const HALF_SPAN_SEC = (STAGE.right - STAGE.playheadX) / PX_PER_SEC;

export interface VoiceSpec {
  index: number; // 0..4
  number: number; // 1..5
  shortLabel: string;
  hue: number;
  laneTop: number;
  laneBottom: number;
  laneCenterY: number;
  pitchMin: number;
  pitchMax: number;
  firstOnsetSec: number;
}

export interface CanonNoteEvent {
  index: number;
  note: MidiNote;
  voiceIndex: number; // 0..4
  y: number;
  hue: number;
  vel01: number;
  tOn: number;
  tOff: number;
}

export interface CanonLayout {
  voices: readonly VoiceSpec[];
  events: readonly CanonNoteEvent[];
  byVoice: readonly (readonly CanonNoteEvent[])[];
}

const VOICE_PALETTE: ReadonlyArray<{ hue: number; shortLabel: string }> = [
  { hue: 196, shortLabel: "VOICE 1 \u00b7 CANON I" },
  { hue: 156, shortLabel: "VOICE 2 \u00b7 BASS" },
  { hue: 43,  shortLabel: "VOICE 3 \u00b7 ARPEGGIO" },
  { hue: 326, shortLabel: "VOICE 4 \u00b7 16THS" },
  { hue: 75,  shortLabel: "VOICE 5 \u00b7 DESCANT" },
];

/** Assigns every MIDI note deterministically to one of the 5 lanes (by track 1..5, or channel % 5 fallback). */
export function buildCanonLayout(notes: readonly MidiNote[]): CanonLayout {
  const gap = 12;
  const totalH = STAGE.bottom - STAGE.lanesTop;
  const laneH = (totalH - gap * (VOICE_COUNT - 1)) / VOICE_COUNT;

  const bucketed: MidiNote[][] = Array.from({ length: VOICE_COUNT }, () => []);
  const distinctTracks = [...new Set(notes.map((n) => n.track))].sort((a, b) => a - b);

  for (const n of notes) {
    let vIdx = distinctTracks.indexOf(n.track);
    if (vIdx < 0 || distinctTracks.length > VOICE_COUNT) vIdx = n.channel % VOICE_COUNT;
    vIdx = clamp(vIdx, 0, VOICE_COUNT - 1);
    bucketed[vIdx].push(n);
  }

  const voices: VoiceSpec[] = [];
  for (let v = 0; v < VOICE_COUNT; v++) {
    const laneTop = STAGE.lanesTop + v * (laneH + gap);
    const laneBottom = laneTop + laneH;
    const list = bucketed[v];
    let pMin = 127;
    let pMax = 0;
    for (const n of list) {
      pMin = Math.min(pMin, n.pitch);
      pMax = Math.max(pMax, n.pitch);
    }
    if (pMin > pMax) {
      pMin = 60;
      pMax = 72;
    }
    // Pad register by at least 6 semitones so single-octave lines sit comfortably inside the lane
    const mid = 0.5 * (pMin + pMax);
    const halfSpan = Math.max(5, 0.5 * (pMax - pMin) + 1.5);
    voices.push({
      index: v,
      number: v + 1,
      shortLabel: VOICE_PALETTE[v].shortLabel,
      hue: VOICE_PALETTE[v].hue,
      laneTop,
      laneBottom,
      laneCenterY: 0.5 * (laneTop + laneBottom),
      pitchMin: mid - halfSpan,
      pitchMax: mid + halfSpan,
      firstOnsetSec: list.length ? list[0].timeSec : Number.POSITIVE_INFINITY,
    });
  }

  const padY = 30;
  const pitchToY = (voice: VoiceSpec, pitch: number): number => {
    const u = clamp01((pitch - voice.pitchMin) / Math.max(1, voice.pitchMax - voice.pitchMin));
    return lerp(voice.laneBottom - padY, voice.laneTop + padY, u);
  };

  const events: CanonNoteEvent[] = notes.map((note, index) => {
    let vIdx = distinctTracks.indexOf(note.track);
    if (vIdx < 0 || distinctTracks.length > VOICE_COUNT) vIdx = note.channel % VOICE_COUNT;
    vIdx = clamp(vIdx, 0, VOICE_COUNT - 1);
    const voice = voices[vIdx];
    return {
      index,
      note,
      voiceIndex: vIdx,
      y: pitchToY(voice, note.pitch),
      hue: voice.hue,
      vel01: clamp01(note.velocity / 127),
      tOn: note.timeSec,
      tOff: note.timeSec + Math.max(0.08, note.durationSec),
    };
  });

  const byVoice = voices.map((_, v) => events.filter((e) => e.voiceIndex === v));
  return { voices, events, byVoice };
}

/** Horizontal interval [xLeft, xRight] of a note capsule at piece time t, or null if outside STAGE.left..STAGE.right. */
export function noteSpanAt(ev: CanonNoteEvent, t: number): { left: number; right: number; active: boolean } | null {
  const rawLeft = STAGE.playheadX + (ev.tOn - t) * PX_PER_SEC;
  const rawRight = Math.max(rawLeft + 10, STAGE.playheadX + (ev.tOff - t) * PX_PER_SEC);
  if (rawRight <= STAGE.left || rawLeft >= STAGE.right) return null;
  const active = t >= ev.tOn && t <= ev.tOff + 0.02;
  return {
    left: Math.max(STAGE.left, rawLeft),
    right: Math.min(STAGE.right, rawRight),
    active,
  };
}

/** Smooth continuous Y contour of a voice at any piece time tau (interpolated between note events). */
export function voiceContourY(voiceEvents: readonly CanonNoteEvent[], voice: VoiceSpec, tau: number): number | null {
  if (!voiceEvents.length) return null;
  const first = voiceEvents[0];
  const last = voiceEvents[voiceEvents.length - 1];
  if (tau < first.tOn - 0.15 || tau > last.tOff + 0.35) return null;
  if (tau <= first.tOn) return first.y;
  if (tau >= last.tOn) return last.y;

  let lo = 0;
  let hi = voiceEvents.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (voiceEvents[mid].tOn <= tau) lo = mid;
    else hi = mid - 1;
  }
  const a = voiceEvents[lo];
  const b = voiceEvents[Math.min(voiceEvents.length - 1, lo + 1)];
  // Hold pitch across most of the note, then glide smoothly into the next pitch
  const span = Math.max(0.02, b.tOn - a.tOn);
  const u = smoothstep(0.55, 1.0, (tau - a.tOn) / span);
  return lerp(a.y, b.y, u);
}

/** Whether a voice pill (1..5) is lit at piece time t; fades back to Voice 1 preview at the loop tail. */
export function voiceLitStrength(voice: VoiceSpec, t: number, endSec: number): number {
  if (!Number.isFinite(voice.firstOnsetSec)) return 0;
  const enter = smoothstep(voice.firstOnsetSec - 0.08, voice.firstOnsetSec + 0.12, t);
  const reset = voice.index === 0 ? 0 : smoothstep(endSec + 1.2, endSec + 2.8, t);
  return clamp01(enter * (1 - reset));
}
