import { buildAccents, clamp, clamp01, hash01, hslToRgb, lerp, smoothstep, type Accent } from "../midi/kit.ts";
import type { MidiSceneData } from "../midi/timeline.ts";
import type { MidiNote } from "../midi/types.ts";

/**
 * Per-note data for the Ripple Tank scene: where each note drops into the water, what colour and wavelength
 * its ring has, how loud (tall) the wave is and how long it lives. Pure and DOM-free (unit-testable in Node):
 * the field evaluation (field.ts) and the painter (paint.ts) only read these tables, so every frame is a pure
 * function of the frame number.
 */

/** Frames of lead-in before the first note-on: the title fades in over calm, dark water. */
export const RIPPLE_LEAD_FRAMES = 36;

/** Phone safe area for source points (canvas px): nothing important within 150 px of the right edge or 300 px of the bottom. */
export const SOURCE_AREA = { xMin: 160, xMax: 920, yMin: 430, yMax: 1520 } as const;

export interface RippleEvent {
  /** Index of the note in scene.notes (events are in the same order, one per note). */
  index: number;
  timeSec: number;
  /** First video frame on which this note is visible: leadFrames + ceil(timeSec * fps - 1e-9). Nothing of it is drawn earlier. */
  startFrame: number;
  /** Source point in canvas px. */
  x: number;
  y: number;
  pitch: number;
  /** 0 (lowest pitch of the piece) .. 1 (highest). */
  pitchNorm: number;
  hue: number;
  /** Neon colour of the ring, 0..1 per channel. */
  rgb: readonly [number, number, number];
  /** Velocity / 127. */
  vel: number;
  /** 0..1: how structural the note is (loud chords, entrances of a voice, the finale). Climax notes get taller, longer waves and bigger splashes. */
  emphasis: number;
  /** Voice rank by register within the piece: 0 is the lowest voice. */
  role: number;
  /** Wavelength of the ring in canvas px (louder = longer; low pitches a little longer than high ones). */
  wavelength: number;
  /** Ring expansion speed, canvas px / s. */
  speed: number;
  /** Peak height of the packet near the source (dimensionless; about 0.5 for a mezzo-forte note). */
  amplitude: number;
  /** Length of the wake behind the front crest: 0 short (one clean ring), 1 medium, 2 long (many crests, rich interference). */
  wake: 0 | 1 | 2;
  /** Seconds until the wave has fully faded. */
  life: number;
  /** Seconds the source buoy stays lit at full strength (the note's own length, capped). */
  holdSec: number;
  /** Number of droplet sparks thrown by the splash. */
  sparkCount: number;
}

/** Hue anchors (degrees) from the lowest pitch to the highest: teal, cyan, blue, violet, magenta, rose, coral, amber. */
const HUE_STOPS: readonly (readonly [number, number])[] = [[0, 172], [0.2, 197], [0.4, 228], [0.58, 272], [0.74, 318], [0.88, 352], [0.95, 14], [1, 38]];

/** Hue (degrees, 0..360) for a pitch position 0..1 along the piece's pitch range. */
export function pitchHue(pitchNorm: number): number {
  const p = clamp01(pitchNorm);
  for (let i = 1; i < HUE_STOPS.length; i++) {
    const [p1, h1] = HUE_STOPS[i];
    if (p <= p1) {
      const [p0, h0] = HUE_STOPS[i - 1];
      // Hues only ever increase along the gradient (coral at 14 is 374 on the way round from rose at 352).
      return (((lerp(h0, h1 < h0 ? h1 + 360 : h1, (p - p0) / (p1 - p0))) % 360) + 360) % 360;
    }
  }
  return HUE_STOPS[HUE_STOPS.length - 1][1] % 360;
}

/** Neon ring colour for a hue, 0..1 per channel. */
export function neonRgb(hue: number): [number, number, number] {
  const [r, g, b] = hslToRgb(hue, 0.96, 0.57);
  return [r / 255, g / 255, b / 255];
}

/**
 * Rolled chords (notes a few tens of ms apart) are one musical event: snap each such cluster onto its first
 * onset so kit.buildAccents sees one loud chord instead of eight quiet notes. Returns a copy; the input is untouched.
 */
export function snapRolledChords(notes: readonly MidiNote[], chainSec = 0.07, maxSpanSec = 0.5): MidiNote[] {
  const out: MidiNote[] = [];
  let groupStart = 0, previous = -Infinity;
  for (const note of notes) {
    if (note.timeSec - previous > chainSec || note.timeSec - groupStart > maxSpanSec) groupStart = note.timeSec;
    previous = note.timeSec;
    out.push({ ...note, timeSec: groupStart });
  }
  return out;
}

/** Per-note emphasis: loud chords, the entrance of a voice (first note of a track, or after a long rest) and the final chord. */
function noteEmphasis(notes: readonly MidiNote[]): Float32Array {
  const emphasis = new Float32Array(notes.length);
  const snapped = snapRolledChords(notes);
  // Chord groups on the snapped onsets: the chord's loudness decides its emphasis.
  let i = 0;
  let lastGroup: [number, number] = [0, 0];
  while (i < snapped.length) {
    let j = i, loudness = 0;
    while (j < snapped.length && snapped[j].timeSec - snapped[i].timeSec <= 0.045) { loudness += (snapped[j].velocity / 127) ** 2; j++; }
    const e = smoothstep(0.9, 3.4, loudness);
    for (let k = i; k < j; k++) emphasis[k] = e;
    lastGroup = [i, j];
    i = j;
  }
  // The finale: the last chord of the piece is the climax if it is a chord at all.
  if (notes.length && lastGroup[1] - lastGroup[0] >= 3) {
    for (let k = lastGroup[0]; k < lastGroup[1]; k++) emphasis[k] = Math.max(emphasis[k], 0.95);
  }
  // Entrances: the first note of each track and the first one after a rest of 6 s or more.
  const lastOnset = new Map<number, number>();
  for (let k = 0; k < notes.length; k++) {
    const note = notes[k];
    const before = lastOnset.get(note.track);
    if (before === undefined || note.timeSec - before >= 6) emphasis[k] = Math.max(emphasis[k], 0.78);
    lastOnset.set(note.track, note.timeSec);
  }
  return emphasis;
}

/** For each pitch used, the fraction of notes below it (ties split), 0..1. Empty for no notes. */
export function pitchRanks(notes: readonly MidiNote[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const note of notes) counts.set(note.pitch, (counts.get(note.pitch) ?? 0) + 1);
  const ranks = new Map<number, number>();
  let below = 0;
  for (const pitch of [...counts.keys()].sort((a, b) => a - b)) {
    const n = counts.get(pitch)!;
    ranks.set(pitch, (below + n / 2) / notes.length);
    below += n;
  }
  return ranks;
}

/** Voice rank by register: tracks sorted by mean pitch, lowest first (ties by track index). Tracks without notes get no rank. */
export function voiceRoles(notes: readonly MidiNote[]): { roleOfTrack: Map<number, number>; count: number } {
  const sums = new Map<number, { sum: number; count: number }>();
  for (const note of notes) {
    const entry = sums.get(note.track) ?? { sum: 0, count: 0 };
    entry.sum += note.pitch; entry.count++;
    sums.set(note.track, entry);
  }
  const ordered = [...sums.entries()].sort((a, b) => a[1].sum / a[1].count - b[1].sum / b[1].count || a[0] - b[0]);
  const roleOfTrack = new Map<number, number>();
  ordered.forEach(([track], rank) => roleOfTrack.set(track, rank));
  return { roleOfTrack, count: Math.max(1, ordered.length) };
}

/** One visual event per note, in note order. Works for any piece: the pitch range and the voices come from the notes. */
export function buildRippleEvents(scene: Pick<MidiSceneData, "notes" | "pitchMin" | "pitchMax" | "fps" | "leadFrames">): RippleEvent[] {
  const { notes, pitchMin, pitchMax, fps, leadFrames } = scene;
  const emphasis = noteEmphasis(notes);
  const { roleOfTrack, count: roleCount } = voiceRoles(notes);
  const span = Math.max(1, pitchMax - pitchMin);
  const bandHeight = (SOURCE_AREA.yMax - SOURCE_AREA.yMin) / roleCount;
  const jitterY = clamp(0.3 * bandHeight, 26, 300);
  // Colour follows pitch monotonically, but most of it is the pitch's rank among the piece's notes, so a piece that
  // lives in a narrow register still uses the whole palette instead of one muddy corner of it.
  const rank = pitchRanks(notes);
  return notes.map((note, index) => {
    const pitchNorm = pitchMax > pitchMin ? clamp01((note.pitch - pitchMin) / span) : 0.5;
    const hueNorm = 0.3 * pitchNorm + 0.7 * (rank.get(note.pitch) ?? 0.5);
    const vel = clamp01(note.velocity / 127);
    const e = emphasis[index];
    const role = roleOfTrack.get(note.track) ?? 0;
    // x from pitch, y from the voice (lowest voice at the bottom), plus a small seeded jitter so equal pitches do not stack.
    const xBase = lerp(SOURCE_AREA.xMin + 12, SOURCE_AREA.xMax - 12, pitchNorm);
    const yBase = SOURCE_AREA.yMax - (role + 0.5) * bandHeight;
    const x = clamp(xBase + (hash01(index, 1) - 0.5) * 24, SOURCE_AREA.xMin, SOURCE_AREA.xMax);
    const y = clamp(yBase + (hash01(index, 2) - 0.5) * 2 * jitterY, SOURCE_AREA.yMin, SOURCE_AREA.yMax);
    const hue = pitchHue(hueNorm);
    // Louder notes make longer, taller waves; low notes are a little broader than high ones.
    const wavelength = lerp(54, 112, vel ** 0.9) * lerp(1.16, 0.88, pitchNorm) * (1 + 0.12 * e);
    const speed = 36 * Math.sqrt(wavelength);
    const holdSec = clamp(note.durationSec, 0.12, 2);
    const amplitude = (0.5 + 1.0 * vel ** 1.3) * (1 + 0.5 * e);
    const life = 1.1 + 2.1 * vel ** 1.2 + 0.4 * holdSec + 1.5 * e;
    const wake = (vel + 0.35 * e < 0.46 ? 0 : vel + 0.35 * e < 0.74 ? 1 : 2) as 0 | 1 | 2;
    return {
      index, timeSec: note.timeSec,
      startFrame: leadFrames + Math.ceil(note.timeSec * fps - 1e-9),
      x, y, pitch: note.pitch, pitchNorm, hue, rgb: neonRgb(hue), vel, emphasis: e, role,
      wavelength, speed, amplitude, wake, life, holdSec,
      sparkCount: Math.min(11, Math.round(3 + 4 * vel + 4 * e)),
    };
  });
}

/**
 * Accents for the camera kick and the water pulse: kit.buildAccents on the rolled-chord-snapped notes, plus a
 * strong accent at every voice entrance (emphasis >= 0.7 with a note that is not already part of a loud chord).
 */
export function buildRippleAccents(notes: readonly MidiNote[], events: readonly RippleEvent[]): Accent[] {
  const accents = buildAccents(snapRolledChords(notes));
  const extra: Accent[] = [];
  for (const event of events) {
    if (event.emphasis < 0.7) continue;
    // Last chord that started at or before this note (accents are in time order).
    let lo = 0, hi = accents.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (accents[mid].timeSec <= event.timeSec + 1e-9) lo = mid + 1; else hi = mid; }
    const near = lo > 0 && event.timeSec - accents[lo - 1].timeSec <= 0.5 ? accents[lo - 1] : undefined;
    if (near) near.strength = Math.max(near.strength, 0.75 * event.emphasis);
    else extra.push({ timeSec: event.timeSec, noteCount: 1, loudness: 0, strength: 0.75 * event.emphasis });
  }
  return [...accents, ...extra].sort((a, b) => a.timeSec - b.timeSec);
}
