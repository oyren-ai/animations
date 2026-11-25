import rawMelodyJson from "./arshin-melody-reconciled.json" with { type: "json" };
import type { MidiPiece } from "./pieces.ts";
import type { MidiWriteNote, MidiWriteTrack } from "./write.ts";

/**
 * Uzeyir Hajibeyov — Arshin Mal Alan (1913), Act II, No. 12 "Askar's Song" ("Əskərin nəğməsi").
 *
 * Accuracy & Originality Contract:
 * 1. Vocal melody (Track 1, "Askar Melody") is generated EXCLUSIVELY from `flat_full` (168 notes,
 *    48 bars = 768 x 1/32-note units) in `./arshin-melody-reconciled.json`, the reconciled transcription
 *    of the vocal line in the public-domain 1948 vocal score (IMSLP #402316); two independent readings
 *    of the scan agreed on all 48 bars.
 * 2. Octave choice: the printed vocal line is a tenor part in treble clef that sounds one octave lower.
 *    Track 1 uses exact sounding tenor pitch (`midi_if_tenor_octave_down = midi_written + ARSHIN_OCTAVE_SHIFT`,
 *    where `ARSHIN_OCTAVE_SHIFT = -12`, spanning G3..A4 = MIDI 55..69).
 * 3. Fermata: Coda bar `84.1.2` carries `"fermata": true` on its opening G5 (`start = 688, dur = 8`).
 *    Its onset is exact (`688` units), and its duration is held by `ARSHIN_FERMATA_FACTOR = 1.75`
 *    (`14` units = `+6` extra 1/32-note units), shifting the 3 remaining coda notes (`696, 700, 704`)
 *    by `+6` units while keeping their exact written durations (`4, 4, 36`).
 * 4. Everything else (2-bar original bazaar curtain-raiser intro, original A-modal bass/piano/naghara
 *    accompaniment, original Tar refrain doubling & vocal-rest interludes, and 1-bar loop-return coda)
 *    is 100% newly composed here from the melody's A natural-minor pitch set (A B C D E F G, one F# in
 *    the coda) + seeded PRNG.
 */

export const ARSHIN_OCTAVE_SHIFT = -12;
export const ARSHIN_FERMATA_FACTOR = 1.75; // 8 * 1.75 = 14 units (+6 extra 1/32-note units on the coda G fermata)
export const ARSHIN_QUARTER_BPM = 118;     // Allegro moderato (104..120 BPM) -> ~55.1 s total video for full 48-bar pass
export const ARSHIN_INTRO_UNITS = 32;      // 2-bar original curtain-raiser intro (32 x 1/32-units = 4.0 quarter-beats)
export const ARSHIN_OUTRO_UNITS = 16;      // 1-bar original loop-return tail extension after bar 84.3.2

export type ArshinSectionKind = "verse" | "refrain" | "episode" | "interlude" | "coda";

export interface FlatMelodyEntry {
  start: number;
  dur: number;
  pitch: string;
  midi_written: number;
  midi_if_tenor_octave_down: number;
  bars: string[];
  fermata: boolean;
}

export interface ReconciledMelodyNote {
  noteIndex: number;
  barId: string;
  writtenPitch: number;
  soundingPitch: number;
  /** Raw score onset in 1/32-note units from `flat_full[i].start`. */
  scoreStartUnits: number;
  /** Raw score duration in 1/32-note units from `flat_full[i].dur`. */
  scoreDurUnits: number;
  /** Performed onset in 1/32-note units from `playback[0]` (includes post-fermata offset after bar 84.1.2 G5). */
  performedOnsetUnits: number;
  /** Performed duration in 1/32-note units (`scoreDurUnits * ARSHIN_FERMATA_FACTOR` if `fermata`, else `scoreDurUnits`). */
  performedDurUnits: number;
  fermata: boolean;
  section: ArshinSectionKind;
  isRepeatPass: boolean;
}

export interface ReconciledBarInfo {
  playbackIndex: number;
  barId: string;
  scoreStartUnits: number;
  performedStartUnits: number;
  durationUnits: number;
  section: ArshinSectionKind;
  isRepeatPass: boolean;
}

export interface ArshinMelodyAnalysis {
  totalScoreUnits: number;
  totalPerformedUnits: number;
  fermataExtraUnits: number;
  notes: ReconciledMelodyNote[];
  barsInPass: ReconciledBarInfo[];
  tonicPc: number;
  scalePitchClasses: number[];
  uncertainIds: string[];
}

function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampVel = (v: number) => Math.max(1, Math.min(127, Math.round(v)));

/** Classify each bar ID of No. 12 "Askar's Song" into its musical/dramatic section. */
export function sectionForBarId(barId: string): ArshinSectionKind {
  if (barId === "79.3.1" || barId === "79.3.2" || barId === "82.3.2" || barId === "82.3.3" || barId === "82.4.1" || barId === "83.1.1") {
    return "interlude";
  }
  if (barId.startsWith("84.")) return "coda";
  // Refrain ("Gəl, gəl maralım gəl", 81.1.1..81.3.1) + soaring da-capo/payoff return ("Səni sevdim" climax, 83.3.2..83.4.2)
  if (barId === "81.1.1" || barId === "81.1.2" || barId === "81.2.1" || barId === "81.2.2" || barId === "81.3.1" ||
      barId === "83.3.2" || barId === "83.4.1" || barId === "83.4.2") {
    return "refrain";
  }
  if (barId.startsWith("81.3.") || barId.startsWith("81.4.") || barId.startsWith("82.") || barId.startsWith("83.")) {
    return "episode";
  }
  return "verse";
}

/** Determine whether a bar occurrence in the 48-bar `playback` pass is the answered/repeated statement. */
function isRepeatPlaybackIndex(playbackIdx: number, barId: string): boolean {
  if (playbackIdx >= 4 && playbackIdx <= 7) return true;   // 2nd statement of opening verse ("Axtarıb tapdım səni")
  if (playbackIdx >= 12 && playbackIdx <= 15) return true; // Repeat A, 2nd pass (80.2.2..80.4.2)
  if (playbackIdx >= 20 && playbackIdx <= 23) return true; // Repeat B refrain, 2nd pass (81.1.1..81.3.1)
  if (playbackIdx >= 28 && playbackIdx <= 31) return true; // 2nd 4-bar phrase of "Səni sevdim" (82.1.2..82.3.1)
  if (playbackIdx >= 40 && playbackIdx <= 42) return true; // 2nd 4-bar phrase before Coda (83.3.2..83.4.2)
  if (barId.startsWith("84.2") || barId.startsWith("84.3")) return true;
  return false;
}

/** Parse `melody-reconciled.json` (`flat_full` + `playback` + `uncertain`). */
export function extractReconciledMelody(
  rawDoc: Record<string, unknown> = rawMelodyJson as unknown as Record<string, unknown>,
): ArshinMelodyAnalysis {
  const flatFull = rawDoc.flat_full as FlatMelodyEntry[] | undefined;
  if (!Array.isArray(flatFull) || flatFull.length === 0) {
    throw new Error("melody-reconciled.json is missing non-empty flat_full array");
  }
  const playback = (rawDoc.playback as string[] | undefined) ?? [];
  const barUnits = Number(rawDoc.bar_units ?? 16);
  const totalScoreUnits = Number(rawDoc.flat_full_total_units ?? playback.length * barUnits);

  // Build bar table first so every note maps cleanly to its playback occurrence
  let fermataScoreStart = Infinity;
  let fermataExtraUnits = 0;
  for (const item of flatFull) {
    if (item.fermata) {
      fermataScoreStart = Math.min(fermataScoreStart, item.start);
      fermataExtraUnits += Math.round(item.dur * (ARSHIN_FERMATA_FACTOR - 1));
    }
  }

  const barsInPass: ReconciledBarInfo[] = playback.map((barId, pIdx) => {
    const scoreStart = pIdx * barUnits;
    const shift = scoreStart > fermataScoreStart ? fermataExtraUnits : 0;
    const extraInside = scoreStart === fermataScoreStart ? fermataExtraUnits : 0;
    return {
      playbackIndex: pIdx,
      barId,
      scoreStartUnits: scoreStart,
      performedStartUnits: scoreStart + shift,
      durationUnits: barUnits + extraInside,
      section: sectionForBarId(barId),
      isRepeatPass: isRepeatPlaybackIndex(playbackIdxOrZero(pIdx), barId),
    };
  });

  const weights = new Array<number>(12).fill(0);
  let cumulativeExtra = 0;
  const notes: ReconciledMelodyNote[] = flatFull.map((entry, idx) => {
    const written = entry.midi_written;
    const sounding = written + ARSHIN_OCTAVE_SHIFT;
    const performedOnset = entry.start + cumulativeExtra;
    const performedDur = entry.fermata ? Math.round(entry.dur * ARSHIN_FERMATA_FACTOR) : entry.dur;
    if (entry.fermata) {
      cumulativeExtra += performedDur - entry.dur;
    }
    const pIdx = Math.min(Math.max(0, Math.floor(entry.start / barUnits)), Math.max(0, barsInPass.length - 1));
    const barId = entry.bars[0] ?? barsInPass[pIdx]?.barId ?? "";
    const section = sectionForBarId(barId);
    const isRepeatPass = isRepeatPlaybackIndex(pIdx, barId);
    weights[((sounding % 12) + 12) % 12] += entry.dur;

    return {
      noteIndex: idx,
      barId,
      writtenPitch: written,
      soundingPitch: sounding,
      scoreStartUnits: entry.start,
      scoreDurUnits: entry.dur,
      performedOnsetUnits: performedOnset,
      performedDurUnits: performedDur,
      fermata: Boolean(entry.fermata),
      section,
      isRepeatPass,
    };
  });

  const lastNote = notes[notes.length - 1];
  const tonicPc = ((lastNote.soundingPitch % 12) + 12) % 12; // A (9)
  const scalePitchClasses: number[] = [];
  for (let step = 0; step < 12; step++) {
    const pc = (tonicPc + step) % 12;
    if (weights[pc] > 0) scalePitchClasses.push(pc);
  }

  const uncertainRaw = Array.isArray(rawDoc.uncertain) ? (rawDoc.uncertain as Array<{ id?: string }>) : [];
  const uncertainIds = uncertainRaw.map((u) => String(u.id ?? "")).filter(Boolean);

  return {
    totalScoreUnits,
    totalPerformedUnits: totalScoreUnits + cumulativeExtra,
    fermataExtraUnits: cumulativeExtra,
    notes,
    barsInPass,
    tonicPc,
    scalePitchClasses,
    uncertainIds,
  };
}

function playbackIdxOrZero(n: number): number {
  return n;
}

/** Prevent same-pitch overlaps on accompaniment tracks ONLY (Track 1 vocal melody is never touched). */
function cleanAccompanimentTrack(raw: MidiWriteNote[]): MidiWriteNote[] {
  const sorted = [...raw].sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
  const lastByPitch = new Map<number, MidiWriteNote>();
  const out: MidiWriteNote[] = [];
  for (const current of sorted) {
    const prev = lastByPitch.get(current.pitch);
    if (prev) {
      if (Math.abs(current.beat - prev.beat) < 1e-5) {
        if (current.velocity > prev.velocity) prev.velocity = current.velocity;
        prev.durationBeats = Math.max(prev.durationBeats, current.durationBeats);
        continue;
      }
      if (prev.beat + prev.durationBeats > current.beat - 0.01) {
        prev.durationBeats = Math.max(0.04, current.beat - prev.beat - 0.01);
      }
    }
    const copy = { ...current };
    out.push(copy);
    lastByPitch.set(copy.pitch, copy);
  }
  return out;
}

/**
 * Build the complete Arshin Mal Alan MidiPiece (`arshin-mal-alan-askars-song.mid`):
 * - Track 1 ("Askar Melody", bowed lead GM 40): 168 notes from `flat_full` verbatim in sounding tenor octave.
 * - Track 2 ("Courtyard Tar", plucked tar GM 25): refrain/coda bright octave doubling + original modal interludes.
 * - Track 3 ("Modal Piano", GM 0): original A natural-minor (Aeolian) off-beat chords.
 * - Track 4 ("Upright Bass", GM 32): original plucked modal root-fifth bass line.
 * - Track 5 ("Naghara Frame Drum", ch 9): original 4/8 courtyard frame-drum groove.
 */
export function arshinMalAlan(rawDoc?: Record<string, unknown>): MidiPiece {
  const analysis = extractReconciledMelody(rawDoc);
  const rng = seededRng(0x41525348);
  const bpm = ARSHIN_QUARTER_BPM;

  // +/-6.5 ms micro-timing humaniser applied ONLY to accompaniment tracks (Track 1 stays on exact 1/32-unit grid)
  const maxHumanBeats = 0.0065 * (bpm / 60);
  const hBeat = (b: number) => (b <= 0.02 ? b : Math.max(0, b + (rng() * 2 - 1) * maxHumanBeats));
  const hVel = (v: number, span = 5) => clampVel(v + (rng() * 2 - 1) * span);

  const vocalTrack: MidiWriteNote[] = [];
  const tarTrack: MidiWriteNote[] = [];
  const pianoTrack: MidiWriteNote[] = [];
  const bassTrack: MidiWriteNote[] = [];
  const drumTrack: MidiWriteNote[] = [];

  // A-modal pitch constants (derived from A = pitch class 9, natural minor collection)
  const A2 = 45, E2 = 40, D2 = 38, G2 = 43, C3 = 48;
  const MODAL_VOICINGS: Record<string, { bass1: number; bass2: number; chord: readonly [number, number, number] }> = {
    Am: { bass1: A2, bass2: E2, chord: [57, 60, 64] }, // A3 C4 E4
    Dm: { bass1: D2, bass2: A2, chord: [53, 57, 62] }, // F3 A3 D4
    G:  { bass1: G2, bass2: D2, chord: [55, 59, 62] }, // G3 B3 D4
    C:  { bass1: C3, bass2: G2, chord: [52, 55, 60] }, // E3 G3 C4
    E:  { bass1: E2, bass2: A2, chord: [52, 56, 59] }, // gentle modal dominant preparation
    Em: { bass1: E2, bass2: A2, chord: [52, 55, 59] }, // pure natural-minor v (E3 G3 B3)
  };

  // --- 1. Original 2-bar (32-unit = 4.0-beat) Bazaar Curtain-Raiser Intro (Tracks 2..5 ONLY) ---
  for (let bar = 0; bar < 2; bar++) {
    const b0 = bar * 2.0;
    bassTrack.push({ beat: b0 === 0 ? 0 : hBeat(b0), durationBeats: 0.9, pitch: A2, velocity: hVel(80) });
    bassTrack.push({ beat: hBeat(b0 + 1.0), durationBeats: 0.9, pitch: E2, velocity: hVel(74) });
    pianoTrack.push({ beat: hBeat(b0 + 0.5), durationBeats: 0.42, pitch: 57, velocity: hVel(60) });
    pianoTrack.push({ beat: hBeat(b0 + 0.5), durationBeats: 0.42, pitch: 64, velocity: hVel(58) });
    pianoTrack.push({ beat: hBeat(b0 + 1.5), durationBeats: 0.42, pitch: 60, velocity: hVel(58) });
    drumTrack.push({ beat: b0 === 0 ? 0 : hBeat(b0), durationBeats: 0.2, pitch: 60, velocity: hVel(78) });
    drumTrack.push({ beat: hBeat(b0 + 0.75), durationBeats: 0.14, pitch: 61, velocity: hVel(62) });
    drumTrack.push({ beat: hBeat(b0 + 1.0), durationBeats: 0.15, pitch: 61, velocity: hVel(68) });
    drumTrack.push({ beat: hBeat(b0 + 1.5), durationBeats: 0.15, pitch: 61, velocity: hVel(64) });
    // Original rising open-fifth Tar call (E4 -> A4 -> E5) inviting the singer
    const introTarPitches = bar === 0 ? [64, 69, 76] : [76, 74, 69];
    tarTrack.push({ beat: hBeat(b0 + 0.25), durationBeats: 0.42, pitch: introTarPitches[0], velocity: hVel(78) });
    tarTrack.push({ beat: hBeat(b0 + 0.75), durationBeats: 0.42, pitch: introTarPitches[1], velocity: hVel(80) });
    tarTrack.push({ beat: hBeat(b0 + 1.25), durationBeats: 0.68, pitch: introTarPitches[2], velocity: hVel(84) });
  }

  // --- 2. Track 1: Exact 168-Note Vocal Melody from `flat_full` + Refrain/Coda Tar Doubling ---
  for (const mNote of analysis.notes) {
    const beat = (ARSHIN_INTRO_UNITS + mNote.performedOnsetUnits) / 8;
    const durationBeats = mNote.performedDurUnits / 8;
    const isClimax = mNote.section === "coda" || mNote.section === "refrain";
    const vel = clampVel((mNote.fermata ? 102 : isClimax ? 96 : mNote.isRepeatPass ? 91 : 87) + (rng() * 2 - 1) * 4);

    // Track 1: 100% EXACT pitch, relative onset, and duration!
    vocalTrack.push({
      beat,
      durationBeats,
      pitch: mNote.soundingPitch,
      velocity: vel,
    });

    // Track 2: Plucked Tar doubles the melody at written octave on Refrain & Coda (and gently echoes long verse notes)
    if (mNote.section === "refrain" || (mNote.section === "coda" && !mNote.fermata)) {
      tarTrack.push({
        beat: hBeat(beat),
        durationBeats: Math.max(0.1, Math.min(1.2, durationBeats * 0.9)),
        pitch: mNote.writtenPitch,
        velocity: hVel(84 + (mNote.isRepeatPass ? 5 : 0)),
      });
      // Celebratory Tar tremolo-pluck sparkle on the final 36-unit held high A5 in the coda!
      if (mNote.performedDurUnits >= 32) {
        for (const off of [1.0, 2.0, 3.0]) {
          tarTrack.push({
            beat: hBeat(beat + off),
            durationBeats: 0.85,
            pitch: off === 2.0 ? mNote.writtenPitch - 5 : mNote.writtenPitch,
            velocity: hVel(86 - off * 3),
          });
        }
      }
    } else if (!mNote.fermata && mNote.performedDurUnits >= 8 && rng() < 0.75) {
      tarTrack.push({
        beat: hBeat(beat + 0.5),
        durationBeats: 0.42,
        pitch: mNote.soundingPitch + 12,
        velocity: hVel(70),
      });
    }
  }

  // --- 3. Bar-by-Bar Original Modal Accompaniment & Vocal-Rest Interludes (Tracks 2..5) ---
  const interludeScale = [69, 71, 72, 74, 76, 79, 81]; // A4..A5 modal steps for seeded original interludes
  let interludeIdx = 4;

  for (const bar of analysis.barsInPass) {
    const bStart = (ARSHIN_INTRO_UNITS + bar.performedStartUnits) / 8;

    // Special dramatic handling for Coda Fermata bar `84.1.2`: single chord on downbeat, then breathless silence!
    if (bar.barId === "84.1.2") {
      bassTrack.push({ beat: hBeat(bStart), durationBeats: 1.6, pitch: G2, velocity: hVel(84) });
      pianoTrack.push({ beat: hBeat(bStart + 0.03), durationBeats: 1.5, pitch: 55, velocity: hVel(68) });
      pianoTrack.push({ beat: hBeat(bStart + 0.06), durationBeats: 1.5, pitch: 59, velocity: hVel(66) });
      pianoTrack.push({ beat: hBeat(bStart + 0.09), durationBeats: 1.5, pitch: 62, velocity: hVel(66) });
      drumTrack.push({ beat: hBeat(bStart), durationBeats: 0.22, pitch: 60, velocity: hVel(78) });
      continue;
    }

    // Final rest bar `84.3.2`: gentle diminuendo into the loop-return tail
    if (bar.barId === "84.3.2") {
      bassTrack.push({ beat: hBeat(bStart), durationBeats: 1.8, pitch: A2, velocity: hVel(76) });
      pianoTrack.push({ beat: hBeat(bStart + 0.5), durationBeats: 1.2, pitch: 57, velocity: hVel(58) });
      pianoTrack.push({ beat: hBeat(bStart + 0.54), durationBeats: 1.2, pitch: 64, velocity: hVel(56) });
      drumTrack.push({ beat: hBeat(bStart), durationBeats: 0.2, pitch: 60, velocity: hVel(70) });
      drumTrack.push({ beat: hBeat(bStart + 1.0), durationBeats: 0.15, pitch: 39, velocity: hVel(56) });
      continue;
    }

    // Choose original modal harmony purely from the melody's local pitch target in this bar
    const barNotes = analysis.notes.filter(
      (n) => n.performedOnsetUnits >= bar.performedStartUnits && n.performedOnsetUnits < bar.performedStartUnits + bar.durationUnits,
    );
    let harmonyKey: keyof typeof MODAL_VOICINGS = "Am";
    if (barNotes.length > 0) {
      const lastP = barNotes[barNotes.length - 1].soundingPitch % 12;
      const firstP = barNotes[0].soundingPitch % 12;
      if (lastP === 2) harmonyKey = "Dm";          // D cadence (80.2.1, 80.2.2, 80.3.2)
      else if (lastP === 7) harmonyKey = "G";      // G subtonic descent (80.3.1, 81.1.2)
      else if (firstP === 5) harmonyKey = "Dm";    // F-led subdominant bar (79.2.3, 80.1.1, 80.1.2)
      else if (lastP === 4 && bar.isRepeatPass) harmonyKey = "Em";
      else if (firstP === 0 && lastP === 9) harmonyKey = "Em"; // C-B-A cadence -> v-i modal resolution
      else harmonyKey = "Am";
    } else if (bar.section === "interlude") {
      harmonyKey = bar.playbackIndex % 2 === 0 ? "Am" : "G";
    }
    void MODAL_VOICINGS.E;
    const h = MODAL_VOICINGS[harmonyKey];
    const lively = bar.section === "refrain" || bar.section === "interlude" || bar.section === "coda";
    const dyn = lively ? 8 : bar.isRepeatPass ? 4 : 0;

    // Plucked Upright Bass 4/8 pulse
    bassTrack.push({ beat: hBeat(bStart), durationBeats: 0.88, pitch: h.bass1, velocity: hVel(78 + dyn) });
    bassTrack.push({ beat: hBeat(bStart + 1.0), durationBeats: 0.88, pitch: h.bass2, velocity: hVel(72 + dyn) });

    // Off-beat Pierced-Lantern Modal Piano Shells
    pianoTrack.push({ beat: hBeat(bStart + 0.5), durationBeats: 0.4, pitch: h.chord[0], velocity: hVel(60 + dyn) });
    pianoTrack.push({ beat: hBeat(bStart + 0.5), durationBeats: 0.4, pitch: h.chord[2], velocity: hVel(58 + dyn) });
    pianoTrack.push({ beat: hBeat(bStart + 1.5), durationBeats: 0.4, pitch: h.chord[1], velocity: hVel(58 + dyn) });
    pianoTrack.push({ beat: hBeat(bStart + 1.5), durationBeats: 0.4, pitch: h.chord[2], velocity: hVel(56 + dyn) });

    // Courtyard Naghara Frame-Drum Rhythm
    drumTrack.push({ beat: hBeat(bStart), durationBeats: 0.2, pitch: 60, velocity: hVel(76 + dyn) });
    if (lively || bar.isRepeatPass) {
      drumTrack.push({ beat: hBeat(bStart + 0.75), durationBeats: 0.14, pitch: 61, velocity: hVel(60 + dyn) });
    }
    drumTrack.push({ beat: hBeat(bStart + 1.0), durationBeats: 0.15, pitch: 61, velocity: hVel(66 + dyn) });
    drumTrack.push({ beat: hBeat(bStart + 1.5), durationBeats: 0.15, pitch: lively ? 61 : 39, velocity: hVel(62 + dyn) });

    // Seeded Original Tar Bazaar Dance Motif during the Vocal-Rest Interludes (`79.3.1..2` & `82.3.2..83.1.1`)!
    if (bar.section === "interlude") {
      for (const sub of [0, 0.5, 1.0, 1.5]) {
        const r = rng();
        if (r < 0.42) interludeIdx = Math.min(interludeScale.length - 1, interludeIdx + 1);
        else if (r < 0.84) interludeIdx = Math.max(0, interludeIdx - 1);
        const tp = sub === 1.5 && bar.barId === "83.1.1" ? 76 : interludeScale[interludeIdx];
        tarTrack.push({
          beat: hBeat(bStart + sub),
          durationBeats: 0.42,
          pitch: tp,
          velocity: hVel(84 + (sub === 0 ? 5 : 0)),
        });
      }
    }
  }

  // --- 4. Original 1-bar (16-unit = 2.0-beat) Loop-Return Tonic Resolution (Tracks 2..5 ONLY) ---
  const outroBeat = (ARSHIN_INTRO_UNITS + analysis.totalPerformedUnits) / 8;
  bassTrack.push({ beat: hBeat(outroBeat), durationBeats: 1.9, pitch: A2, velocity: hVel(76) });
  pianoTrack.push({ beat: hBeat(outroBeat + 0.04), durationBeats: 1.8, pitch: 57, velocity: hVel(60) });
  pianoTrack.push({ beat: hBeat(outroBeat + 0.08), durationBeats: 1.8, pitch: 64, velocity: hVel(58) });
  tarTrack.push({ beat: hBeat(outroBeat + 0.12), durationBeats: 1.75, pitch: 69, velocity: hVel(78) });
  drumTrack.push({ beat: hBeat(outroBeat), durationBeats: 0.22, pitch: 60, velocity: hVel(68) });

  const tracks: MidiWriteTrack[] = [
    { name: "Askar Melody", channel: 0, program: 40, notes: vocalTrack },
    { name: "Courtyard Tar", channel: 1, program: 25, notes: cleanAccompanimentTrack(tarTrack) },
    { name: "Modal Piano", channel: 2, program: 0, notes: cleanAccompanimentTrack(pianoTrack) },
    { name: "Upright Bass", channel: 3, program: 32, notes: cleanAccompanimentTrack(bassTrack) },
    { name: "Naghara Frame Drum", channel: 9, program: 0, notes: cleanAccompanimentTrack(drumTrack) },
  ];

  return {
    file: "arshin-mal-alan-askars-song.mid",
    title: "Arshin Mal Alan",
    composer: "Uzeyir Hajibeyov",
    credit: "Uzeyir Hajibeyov (1913, public domain), Askar's Song; original arrangement (MIT)",
    options: {
      format: 1,
      ticksPerQuarter: 480,
      tempos: [{ beat: 0, bpm }],
      tracks,
      title: "Arshin Mal Alan",
      timeSignature: [4, 8],
    },
  };
}
