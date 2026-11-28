import { arshinMalAlan } from "./arshin.ts";
import { writeMidi, type MidiTempo, type MidiWriteNote, type MidiWriteOptions, type MidiWriteTrack } from "./write.ts";

/**
 * Three recognisable public-domain pieces authored as deterministic note data and written to
 * public/midi/*.mid by scripts/generate-midi-assets.ts:
 *   1. Flight of the Bumblebee — Nikolai Rimsky-Korsakov (1899–1900)
 *   2. Canon in D (five voices) — Johann Pachelbel (c. 1680)
 *   3. Für Elise (music box)    — Ludwig van Beethoven, WoO 59 (1810)
 * No downloaded MIDI files, recordings, or soundfonts are used.
 */

export interface MidiPiece {
  /** File name inside public/midi. */
  file: string;
  title: string;
  /** Composer credit shown below the title. */
  composer: string;
  /** Short credit line. */
  credit: string;
  options: MidiWriteOptions;
}

const clampVelocity = (value: number) => Math.max(1, Math.min(127, Math.round(value)));

function note(beat: number, durationBeats: number, pitch: number, velocity: number, pitchBendCents?: number): MidiWriteNote {
  const n: MidiWriteNote = { beat: Math.max(0, beat), durationBeats, pitch, velocity: clampVelocity(velocity) };
  if (pitchBendCents !== undefined && Math.abs(pitchBendCents) > 0.05) n.pitchBendCents = pitchBendCents;
  return n;
}

/** Deterministic mulberry32 PRNG for original modal improvisation and micro-timing humanisation. */
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

/** Prevent same-pitch overlaps on a single track by trimming any earlier note that would collide. */
function cleanTrackNotes(raw: MidiWriteNote[]): MidiWriteNote[] {
  const sorted = [...raw].sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
  const lastByPitch = new Map<number, MidiWriteNote>();
  const out: MidiWriteNote[] = [];
  for (const current of sorted) {
    const prev = lastByPitch.get(current.pitch);
    if (prev) {
      if (Math.abs(current.beat - prev.beat) < 1e-6) {
        // Keep the louder/longer note if two identical pitches land on the exact same beat
        if (current.velocity > prev.velocity) {
          prev.velocity = current.velocity;
          prev.durationBeats = Math.max(prev.durationBeats, current.durationBeats);
        }
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

// ===================================================================================================
// A. Nikolai Rimsky-Korsakov — Flight of the Bumblebee (Act III, The Tale of Tsar Saltan, 2/4, Vivace)
//    Score-verified against independent reference (piano.org / IMSLP Act III orchestral reduction):
//    1. Opening bars 1..4 use the uninterrupted chromatic backstep figure E-D#-D-C#-D-C#-C-B...
//    2. Main theme uses the descending chromatic + fourth-leap figure A4-G#4-G4-F#4-F4-Bb4-A4-G#4 | A4-G#4-G4-F#4-F4-F#4-G4-G#4.
//    3. Steady Vivace tempo (~148 BPM) with dynamic hairpins instead of an artificial accelerando.
//    4. Clean piano + bowed-string horn counter-motif (no clacky marimba doubling).
// ===================================================================================================

/** Score-verified 6-bar opening chromatic descent from E6 (88) to E4 (64) and transition into A4 (69). */
export const BUMBLEBEE_INTRO_BARS: readonly (readonly number[])[] = [
  [88, 87, 86, 85, 86, 85, 84, 83], // Bar 1: E6 D#6 D6 C#6 | D6 C#6 C6 B5
  [82, 81, 80, 81, 80, 79, 78, 77], // Bar 2: Bb5 A5 G#5 A5 | G#5 G5 F#5 F5
  [76, 75, 74, 73, 74, 73, 72, 71], // Bar 3: E5 D#5 D5 C#5 | D5 C#5 C5 B4
  [70, 69, 68, 69, 68, 67, 66, 65], // Bar 4: Bb4 A4 G#4 A4 | G#4 G4 F#4 F4
  [64, 65, 64, 63, 64, 65, 66, 67], // Bar 5: E4 F4 E4 D#4 | E4 F4 F#4 G4
  [68, 69, 68, 67, 68, 69, 70, 68], // Bar 6: G#4 A4 G#4 G4 | G#4 A4 Bb4 G#4 -> A4 (69)
];

/**
 * Score-verified 2-bar (16-sixteenth) Bumblebee motif on `root` (69 = A4):
 * | root, -1, -2, -3, -4, +1, 0, -1 | root, -1, -2, -3, -4, -3, -2, -1 |
 * On A4: | A4 G#4 G4 F#4 F4 Bb4 A4 G#4 | A4 G#4 G4 F#4 F4 F#4 G4 G#4 |
 */
export function bumblebeeWave16(root: number): number[] {
  return [
    root, root - 1, root - 2, root - 3,
    root - 4, root + 1, root, root - 1,
    root, root - 1, root - 2, root - 3,
    root - 4, root - 3, root - 2, root - 1,
  ];
}

/** Score-verified 1-bar (8-sixteenth) tight turn figure around `root`: | root, -1, -2, -3, -4, +1, 0, -1 |. */
export function bumblebeeBuzz8(root: number): number[] {
  return [root, root - 1, root - 2, root - 3, root - 4, root + 1, root, root - 1];
}

/** Steady Vivace tempo (~148 BPM, +/-2 BPM natural phrase breath) matching Rimsky-Korsakov's score marking (1/4 = 144..152). */
export const BUMBLEBEE_TEMPOS: readonly MidiTempo[] = [
  { beat: 0, bpm: 148 },
  { beat: 44, bpm: 150 },
  { beat: 88, bpm: 152 },
];

function flightOfTheBumblebee(): MidiPiece {
  const lead: MidiWriteNote[] = [];
  const left: MidiWriteNote[] = [];
  const hornStrings: MidiWriteNote[] = [];

  const pushSixteenths = (startBeat: number, pitches: readonly number[], baseVel: number, hairpin = true) => {
    for (let i = 0; i < pitches.length; i++) {
      const b = startBeat + i * 0.25;
      const wave = hairpin ? Math.round(10 * Math.sin((Math.PI * (i % 8)) / 7)) : 0;
      const metric = i % 8 === 0 ? 5 : i % 4 === 0 ? 2 : 0;
      lead.push(note(b, 0.21, pitches[i], baseVel + wave + metric));
    }
  };

  const pushAccompBar = (barIndex: number, bassPitch: number, chordTriad: readonly number[], vel: number, octaveBass = false) => {
    const b0 = barIndex * 2;
    left.push(note(b0, 0.36, bassPitch, vel + 4));
    if (octaveBass) left.push(note(b0, 0.36, bassPitch - 12, vel));
    for (const p of chordTriad) left.push(note(b0 + 0.5, 0.28, p, vel - 10));
    left.push(note(b0 + 1.0, 0.36, bassPitch, vel));
    for (const p of chordTriad) left.push(note(b0 + 1.5, 0.28, p, vel - 12));
  };

  const AM_TRIAD = [57, 60, 64]; // A3 C4 E4
  const DM_TRIAD = [57, 62, 65]; // A3 D4 F4
  const E7_TRIAD = [56, 62, 64]; // G#3 D4 E4
  const C_TRIAD = [55, 60, 64];  // G3 C4 E4
  const F_TRIAD = [57, 60, 65];  // A3 C4 F4

  // --- Bars 0..5 (Beats 0..12): Opening fortissimo E stab + two-octave chromatic backstep descent ---
  left.push(note(0, 0.65, 40, 102));
  left.push(note(0, 0.65, 52, 106));
  for (let b = 0; b < 6; b++) {
    pushSixteenths(b * 2, BUMBLEBEE_INTRO_BARS[b], 92 - b * 2);
    if (b >= 2) {
      left.push(note(b * 2, 0.32, 52, 70));
      left.push(note(b * 2 + 1, 0.32, 52, 64));
    }
  }

  // --- Bars 6..13 (Beats 12..28): Main Theme in A minor -> D minor ---
  pushSixteenths(12, bumblebeeWave16(69), 80);
  pushAccompBar(6, 45, AM_TRIAD, 70);
  pushAccompBar(7, 45, AM_TRIAD, 70);

  pushSixteenths(16, bumblebeeWave16(69), 84);
  pushAccompBar(8, 45, AM_TRIAD, 72);
  pushAccompBar(9, 52, E7_TRIAD, 72);

  pushSixteenths(20, [69, 68, 67, 66, 65, 70, 69, 70, 71, 70, 71, 72, 73, 72, 73, 75], 86);
  pushAccompBar(10, 45, [55, 61, 64], 74);
  pushAccompBar(11, 45, [55, 61, 64], 76);

  pushSixteenths(24, bumblebeeWave16(74), 88);
  pushAccompBar(12, 50, DM_TRIAD, 76);
  pushAccompBar(13, 50, DM_TRIAD, 76);

  // --- Bars 14..21 (Beats 28..44): Return to A4 and high-register A5 echo ---
  pushSixteenths(28, [74, 73, 72, 71, 70, 75, 74, 73, 72, 71, 70, 69, 68, 67, 68, 70], 86);
  pushAccompBar(14, 50, DM_TRIAD, 74);
  pushAccompBar(15, 52, E7_TRIAD, 74);

  pushSixteenths(32, bumblebeeWave16(69), 84);
  pushAccompBar(16, 45, AM_TRIAD, 72);
  pushAccompBar(17, 45, AM_TRIAD, 74);

  pushSixteenths(36, bumblebeeWave16(81), 88);
  pushAccompBar(18, 45, AM_TRIAD, 74);
  pushAccompBar(19, 50, DM_TRIAD, 76);

  pushSixteenths(40, [81, 80, 79, 78, 77, 76, 75, 74, 73, 72, 73, 74, 75, 76, 77, 75], 88);
  pushAccompBar(20, 45, AM_TRIAD, 76);
  pushAccompBar(21, 52, E7_TRIAD, 78);

  // --- Bars 22..33 (Beats 44..68): Dominant Episode + Prince Gvidon Bowed-String Counter-Theme ---
  for (let k = 0; k < 3; k++) {
    const bar = 22 + k * 2;
    pushSixteenths(bar * 2, bumblebeeWave16(76), 88 + k * 2);
    pushAccompBar(bar, 52, E7_TRIAD, 78);
    pushAccompBar(bar + 1, 52, E7_TRIAD, 78);
  }
  const gvidonE: ReadonlyArray<readonly [number, number, number]> = [
    [44, 64, 0.46], [44.5, 65, 0.46], [45, 64, 0.46], [45.5, 63, 0.46],
    [46, 64, 0.46], [46.5, 67, 0.46], [47, 66, 0.46], [47.5, 65, 0.46], [48, 64, 1.4],
  ];
  for (const [hb, hp, hd] of gvidonE) hornStrings.push(note(hb, hd, hp, 86));

  for (let k = 0; k < 3; k++) {
    const bar = 28 + k * 2;
    pushSixteenths(bar * 2, bumblebeeWave16(k === 1 ? 74 : 69), 90 + k * 2);
    pushAccompBar(bar, k === 1 ? 50 : 45, k === 1 ? DM_TRIAD : AM_TRIAD, 80);
    pushAccompBar(bar + 1, k === 1 ? 50 : 45, k === 1 ? DM_TRIAD : AM_TRIAD, 80);
  }
  const gvidonA: ReadonlyArray<readonly [number, number, number]> = [
    [56, 69, 0.46], [56.5, 70, 0.46], [57, 69, 0.46], [57.5, 68, 0.46],
    [58, 69, 0.46], [58.5, 72, 0.46], [59, 71, 0.46], [59.5, 70, 0.46], [60, 69, 1.4],
  ];
  for (const [hb, hp, hd] of gvidonA) hornStrings.push(note(hb, hd, hp, 88));

  // --- Bars 34..43 (Beats 68..88): Sequential Harmonic Ascent (C -> Dm -> E7 -> F -> Am) ---
  const seqSteps: ReadonlyArray<[number, number, readonly number[]]> = [
    [72, 48, C_TRIAD],
    [74, 50, DM_TRIAD],
    [76, 52, E7_TRIAD],
    [77, 41, F_TRIAD],
    [81, 45, AM_TRIAD],
  ];
  seqSteps.forEach(([root, bass, triad], idx) => {
    const bar = 34 + idx * 2;
    pushSixteenths(bar * 2, bumblebeeWave16(root), 90 + idx * 3);
    pushAccompBar(bar, bass, triad, 80 + idx * 2, idx >= 2);
    pushAccompBar(bar + 1, bass, triad, 82 + idx * 2, idx >= 2);
  });

  // --- Bars 44..57 (Beats 88..116): Payoff High Reprise & Three-Octave Chromatic Finale ---
  pushSixteenths(88, bumblebeeWave16(81), 102);
  pushAccompBar(44, 45, AM_TRIAD, 88, true);
  pushAccompBar(45, 50, DM_TRIAD, 90, true);
  for (const [hb, hp, hd] of [[88, 76, 0.9], [89, 77, 0.9], [90, 76, 0.9], [91, 75, 0.9]] as const) {
    hornStrings.push(note(hb, hd, hp, 88));
  }

  pushSixteenths(92, bumblebeeWave16(81), 104);
  pushAccompBar(46, 45, AM_TRIAD, 90, true);
  pushAccompBar(47, 52, E7_TRIAD, 92, true);

  const plunge: number[] = [];
  for (let i = 0; i < 24; i++) plunge.push(81 - i);
  pushSixteenths(96, plunge, 98, false);
  pushAccompBar(48, 45, AM_TRIAD, 86, true);
  pushAccompBar(49, 52, E7_TRIAD, 86, true);
  pushAccompBar(50, 45, AM_TRIAD, 86, true);

  const rocket: number[] = [57, 56, 57, 56];
  for (let p = 57; p <= 92; p++) rocket.push(p);
  pushSixteenths(102, rocket, 104, false);
  for (let bar = 51; bar <= 55; bar++) {
    pushAccompBar(bar, bar % 2 === 0 ? 52 : 45, bar % 2 === 0 ? E7_TRIAD : AM_TRIAD, 88 + (bar - 51) * 2, true);
  }

  lead.push(note(112, 0.42, 93, 118));
  left.push(note(112, 0.42, 45, 108));
  left.push(note(112, 0.42, 57, 104));

  lead.push(note(113, 0.42, 88, 112));
  left.push(note(113, 0.42, 52, 106));
  left.push(note(113, 0.42, 64, 102));

  lead.push(note(114, 1.25, 81, 120));
  hornStrings.push(note(114, 1.15, 69, 94));
  for (const [i, p] of [45, 52, 57, 60, 64].entries()) {
    left.push(note(114 + i * 0.018, 1.25, p, 112 - i * 3));
  }

  const tracks: MidiWriteTrack[] = [
    { name: "Bumblebee Lead", channel: 0, program: 0, notes: cleanTrackNotes(lead) },
    { name: "Piano Accompaniment", channel: 1, program: 0, notes: cleanTrackNotes(left) },
    { name: "Muted Strings", channel: 2, program: 40, notes: cleanTrackNotes(hornStrings) },
  ];

  return {
    file: "flight-of-the-bumblebee.mid",
    title: "Flight of the Bumblebee",
    composer: "Nikolai Rimsky-Korsakov",
    credit: "Rimsky-Korsakov (public domain), score-verified Vivace piano & strings arrangement",
    options: {
      format: 1,
      ticksPerQuarter: 480,
      tempos: BUMBLEBEE_TEMPOS,
      tracks,
      title: "Flight of the Bumblebee",
      timeSignature: [2, 4],
    },
  };
}

// ===================================================================================================
// B. Johann Pachelbel — Canon in D, Five Voices (D major, 4/4, entering one voice per cycle)
// ===================================================================================================

export const CANON_PROGRESSION: readonly {
  name: string;
  bass: number;
  arpeggio: readonly [number, number, number, number];
  sixteenths: readonly [number, number, number, number, number, number, number, number];
}[] = [
  { name: "D",   bass: 50, arpeggio: [57, 62, 66, 69], sixteenths: [74, 73, 74, 66, 69, 71, 69, 66] },
  { name: "A",   bass: 45, arpeggio: [57, 61, 64, 69], sixteenths: [73, 71, 73, 64, 69, 71, 69, 64] },
  { name: "Bm",  bass: 47, arpeggio: [59, 62, 66, 71], sixteenths: [71, 69, 71, 66, 62, 66, 69, 71] },
  { name: "F#m", bass: 42, arpeggio: [57, 61, 66, 69], sixteenths: [69, 66, 69, 73, 76, 73, 69, 66] },
  { name: "G",   bass: 43, arpeggio: [59, 62, 67, 71], sixteenths: [71, 69, 67, 71, 74, 71, 69, 67] },
  { name: "D",   bass: 38, arpeggio: [57, 62, 66, 69], sixteenths: [66, 69, 74, 73, 74, 69, 66, 69] },
  { name: "G",   bass: 43, arpeggio: [59, 62, 67, 71], sixteenths: [67, 71, 74, 76, 74, 71, 69, 67] },
  { name: "A",   bass: 45, arpeggio: [57, 61, 64, 69], sixteenths: [69, 73, 76, 74, 73, 69, 64, 69] },
];

/** Iconic Pachelbel opening melody in quarter notes (two per 2-beat chord): F#4-D4 | E4-C#4 | D4-B3 | C#4-A3 | B3-D4 | A3-F#4 | B3-G4 | C#4-E4. */
export const CANON_OPENING_QUARTERS: readonly (readonly [number, number])[] = [
  [66, 62], [64, 61], [62, 59], [61, 57],
  [59, 62], [57, 66], [59, 67], [61, 64],
];

/** High singing Pachelbel canon line (F#5 E5 D5 C#5 B4 A4 B4 C#5) with graceful second-beat chord step. */
export const CANON_SOPRANO_QUARTERS: readonly (readonly [number, number])[] = [
  [78, 74], [76, 73], [74, 71], [73, 69],
  [71, 74], [69, 74], [71, 76], [73, 76],
];

function canonInDFiveVoices(): MidiPiece {
  const voice1: MidiWriteNote[] = []; // Enters Cycle 0 (beat 0): Lead Violin I
  const voice2: MidiWriteNote[] = []; // Enters Cycle 1 (beat 16): Ground Bass Cello
  const voice3: MidiWriteNote[] = []; // Enters Cycle 2 (beat 32): Flowing Harp/Piano Arpeggio
  const voice4: MidiWriteNote[] = []; // Enters Cycle 3 (beat 48): Running Sixteenth-Note Variation
  const voice5: MidiWriteNote[] = []; // Enters Cycle 4 (beat 64): High Descant Payoff

  const totalCycles = 6; // 6 cycles * 16 beats = 96 beats at 124 BPM (~46.45 s + cadence)
  const descantPairs: readonly (readonly [number, number])[] = [
    [81, 78], [81, 76], [78, 83], [81, 73],
    [79, 83], [78, 81], [79, 83], [81, 76],
  ];
  const climaxEighths: readonly (readonly [number, number, number, number])[] = [
    [86, 81, 78, 81], [85, 81, 76, 81], [83, 78, 74, 78], [81, 78, 73, 78],
    [79, 83, 86, 83], [81, 78, 74, 78], [79, 83, 79, 76], [76, 78, 79, 76],
  ];

  for (let cycle = 0; cycle < totalCycles; cycle++) {
    for (let c = 0; c < 8; c++) {
      const chord = CANON_PROGRESSION[c];
      const beat = (cycle * 8 + c) * 2;
      const dyn = Math.min(18, cycle * 3);

      // Voice 1 (active in every cycle 0..5)
      if (cycle === 0) {
        const [p0, p1] = CANON_OPENING_QUARTERS[c];
        voice1.push(note(beat, 0.94, p0, 82));
        voice1.push(note(beat + 1, 0.94, p1, 76));
      } else if (cycle === 1 || cycle === 2) {
        const [p0, p1] = CANON_SOPRANO_QUARTERS[c];
        voice1.push(note(beat, 0.95, p0, 84 + dyn));
        voice1.push(note(beat + 1, 0.95, p1, 78 + dyn));
      } else {
        // Cycles 3..5: warm lyrical sustained canon arch (F#5 E5 D5 C#5 B4 A4 B4 C#5)
        const arch = [78, 76, 74, 73, 71, 69, 71, 73][c];
        voice1.push(note(beat, 1.9, arch, 86 + dyn));
      }

      // Voice 2: Ground Bass (enters Cycle 1, beat 16)
      if (cycle >= 1) {
        if (cycle <= 2) {
          voice2.push(note(beat, 1.9, chord.bass, 80 + dyn));
        } else {
          // Octave cello pulse on beat 2 in fuller cycles
          voice2.push(note(beat, 0.95, chord.bass, 84 + dyn));
          voice2.push(note(beat + 1, 0.95, chord.bass + 12, 74 + dyn));
        }
      }

      // Voice 3: Arpeggio (enters Cycle 2, beat 32)
      if (cycle >= 2) {
        for (let i = 0; i < 4; i++) {
          voice3.push(note(beat + i * 0.5, 0.46, chord.arpeggio[i], 68 + (i === 0 ? 8 : 0) + dyn));
        }
      }

      // Voice 4: Running Sixteenths (enters Cycle 3, beat 48)
      if (cycle >= 3) {
        for (let i = 0; i < 8; i++) {
          voice4.push(note(beat + i * 0.25, 0.22, chord.sixteenths[i], 66 + (i % 4 === 0 ? 9 : 0) + Math.min(12, (cycle - 3) * 4)));
        }
      }

      // Voice 5: High Descant Payoff (enters Cycle 4, beat 64 — all 5 voices together!)
      if (cycle === 4) {
        const [d0, d1] = descantPairs[c];
        voice5.push(note(beat, 0.94, d0, 92));
        voice5.push(note(beat + 1, 0.94, d1, 86));
      } else if (cycle === 5) {
        const grp = climaxEighths[c];
        for (let i = 0; i < 4; i++) {
          // Gentle decrescendo across the final two chords (c = 6, 7) to prepare the loop cadence
          const taper = c >= 6 ? (c - 5) * 6 : 0;
          voice5.push(note(beat + i * 0.5, 0.46, grp[i], 94 - taper + (i === 0 ? 6 : 0)));
        }
      }
    }
  }

  // Final luminous D-major cadence at beat 96 (resolving cleanly back toward the opening F#4 register)
  voice2.push(note(96, 2.3, 50, 88)); // D3
  voice3.push(note(96.04, 2.2, 57, 78)); // A3
  voice4.push(note(96.08, 2.1, 62, 80)); // D4
  voice1.push(note(96.12, 2.2, 66, 90)); // F#4 (matches Voice 1's exact opening pitch!)
  voice5.push(note(96.16, 2.0, 74, 84)); // D5

  const tracks: MidiWriteTrack[] = [
    { name: "Voice 1 · Canon I", channel: 0, program: 40, notes: cleanTrackNotes(voice1) },
    { name: "Voice 2 · Ground Bass", channel: 1, program: 42, notes: cleanTrackNotes(voice2) },
    { name: "Voice 3 · Arpeggio", channel: 2, program: 108, notes: cleanTrackNotes(voice3) },
    { name: "Voice 4 · Sixteenths", channel: 3, program: 0, notes: cleanTrackNotes(voice4) },
    { name: "Voice 5 · Descant", channel: 4, program: 48, notes: cleanTrackNotes(voice5) },
  ];

  return {
    file: "canon-in-d-five-voices.mid",
    title: "Canon in D",
    composer: "Johann Pachelbel",
    credit: "Pachelbel (public domain), five-voice canon arrangement",
    options: {
      format: 1,
      ticksPerQuarter: 480,
      tempos: [
        { beat: 0, bpm: 124 },
        { beat: 92, bpm: 116 },
        { beat: 95, bpm: 104 },
      ],
      tracks,
      title: "Canon in D",
      timeSignature: [4, 4],
    },
  };
}

// ===================================================================================================
// C. Ludwig van Beethoven — Für Elise, WoO 59 (A minor, 3/8, voiced for tuned metal-comb music box)
// ===================================================================================================

/** The iconic 9-note opening phrase of Für Elise: E5 D#5 | E5 D#5 E5 B4 D5 C5 | A4. */
export const FUR_ELISE_OPENING_MOTIF = [76, 75, 76, 75, 76, 71, 74, 72, 69] as const;

function furEliseMusicBox(): MidiPiece {
  const melody: MidiWriteNote[] = [];
  const accomp: MidiWriteNote[] = [];
  const shimmer: MidiWriteNote[] = [];

  // 1 sixteenth = 0.5 beat, 1 bar of 3/8 = 6 sixteenths = 3.0 beats.
  // Pickup occupies 2 sixteenths = 1.0 beat [0, 1.0), so Bar 1 starts at beat 1.0!
  const sBeat = (barFrom1: number, sixteenth0to5: number) => 1.0 + (barFrom1 - 1) * 3.0 + sixteenth0to5 * 0.5;

  // Helper for Beethoven's signature 8-bar A-section (bars `startBar .. startBar + 7`)
  const writeASection = (startBar: number, mode: "first" | "repeat" | "payoff") => {
    const rich = mode === "payoff";
    const vBoost = rich ? 10 : mode === "repeat" ? 4 : 0;

    // Bar +0: E5 D#5 E5 B4 D5 C5
    const b1 = [76, 75, 76, 71, 74, 72];
    b1.forEach((p, i) => {
      melody.push(note(sBeat(startBar, i), 0.46, p, 86 + vBoost + (i === 0 ? 6 : 0)));
      if (rich && (i === 0 || i === 2 || i === 4)) shimmer.push(note(sBeat(startBar, i), 0.42, p + 12, 72));
    });
    if (rich) {
      accomp.push(note(sBeat(startBar, 0), 1.3, 57, 68)); // gentle A3 pedal chime
      accomp.push(note(sBeat(startBar, 3), 1.3, 64, 64)); // E4 fifth chime
    }

    // Bar +1 (Am): RH A4 [0], C4 [3], E4 [4], A4 [5]; LH A3 [0], E4 [1], A4->E4/C5
    // Keep LH in E3..E4 (52, 57, 64) so steel comb spans E3(52)..E6(88) cleanly with zero muddy bass!
    melody.push(note(sBeat(startBar + 1, 0), 1.35, 69, 90 + vBoost));
    accomp.push(note(sBeat(startBar + 1, 0), 0.46, 57, 70 + vBoost)); // A3
    accomp.push(note(sBeat(startBar + 1, 1), 0.46, 64, 68 + vBoost)); // E4
    accomp.push(note(sBeat(startBar + 1, 2), 0.46, 69, 66 + vBoost)); // A4 on accomp track
    melody.push(note(sBeat(startBar + 1, 3), 0.46, 60, 78 + vBoost)); // C4
    melody.push(note(sBeat(startBar + 1, 4), 0.46, 64, 80 + vBoost)); // E4
    melody.push(note(sBeat(startBar + 1, 5), 0.46, 69, 84 + vBoost)); // A4
    if (rich) shimmer.push(note(sBeat(startBar + 1, 0), 1.2, 81, 76));

    // Bar +2 (E major): RH B4 [0], E4 [3], G#4 [4], B4 [5]; LH E3 [0], B3 [1], G#3/E4 [2]
    melody.push(note(sBeat(startBar + 2, 0), 1.35, 71, 90 + vBoost));
    accomp.push(note(sBeat(startBar + 2, 0), 0.46, 52, 72 + vBoost)); // E3
    accomp.push(note(sBeat(startBar + 2, 1), 0.46, 59, 68 + vBoost)); // B3
    accomp.push(note(sBeat(startBar + 2, 2), 0.46, 68, 66 + vBoost)); // G#4
    melody.push(note(sBeat(startBar + 2, 3), 0.46, 64, 78 + vBoost)); // E4
    melody.push(note(sBeat(startBar + 2, 4), 0.46, 68, 82 + vBoost)); // G#4
    melody.push(note(sBeat(startBar + 2, 5), 0.46, 71, 84 + vBoost)); // B4
    if (rich) shimmer.push(note(sBeat(startBar + 2, 0), 1.2, 83, 76));

    // Bar +3 (Am): RH C5 [0], E4 [3], E5 [4], D#5 [5]
    melody.push(note(sBeat(startBar + 3, 0), 1.35, 72, 92 + vBoost));
    accomp.push(note(sBeat(startBar + 3, 0), 0.46, 57, 72 + vBoost));
    accomp.push(note(sBeat(startBar + 3, 1), 0.46, 64, 68 + vBoost));
    accomp.push(note(sBeat(startBar + 3, 2), 0.46, 69, 66 + vBoost));
    melody.push(note(sBeat(startBar + 3, 3), 0.46, 64, 78 + vBoost));
    melody.push(note(sBeat(startBar + 3, 4), 0.46, 76, 86 + vBoost));
    melody.push(note(sBeat(startBar + 3, 5), 0.46, 75, 84 + vBoost));
    if (rich) shimmer.push(note(sBeat(startBar + 3, 0), 1.2, 84, 78));

    // Bar +4: E5 D#5 E5 B4 D5 C5
    b1.forEach((p, i) => {
      melody.push(note(sBeat(startBar + 4, i), 0.46, p, 88 + vBoost + (i === 0 ? 6 : 0)));
      if (rich && (i === 0 || i === 3 || i === 5)) shimmer.push(note(sBeat(startBar + 4, i), 0.42, p + 12, 74));
    });
    if (rich) {
      accomp.push(note(sBeat(startBar + 4, 0), 1.3, 57, 68));
      accomp.push(note(sBeat(startBar + 4, 3), 1.3, 64, 64));
    }

    // Bar +5 (Am): RH A4 [0], C4 [3], E4 [4], A4 [5]
    melody.push(note(sBeat(startBar + 5, 0), 1.35, 69, 90 + vBoost));
    accomp.push(note(sBeat(startBar + 5, 0), 0.46, 57, 72 + vBoost));
    accomp.push(note(sBeat(startBar + 5, 1), 0.46, 64, 68 + vBoost));
    accomp.push(note(sBeat(startBar + 5, 2), 0.46, 69, 66 + vBoost));
    melody.push(note(sBeat(startBar + 5, 3), 0.46, 60, 78 + vBoost));
    melody.push(note(sBeat(startBar + 5, 4), 0.46, 64, 82 + vBoost));
    melody.push(note(sBeat(startBar + 5, 5), 0.46, 69, 86 + vBoost));
    if (rich) shimmer.push(note(sBeat(startBar + 5, 0), 1.2, 81, 76));

    // Bar +6 (E major cadence): RH B4 [0], E4 [3], C5 [4], B4 [5]
    melody.push(note(sBeat(startBar + 6, 0), 1.35, 71, 92 + vBoost));
    accomp.push(note(sBeat(startBar + 6, 0), 0.46, 52, 74 + vBoost));
    accomp.push(note(sBeat(startBar + 6, 1), 0.46, 59, 70 + vBoost));
    accomp.push(note(sBeat(startBar + 6, 2), 0.46, 68, 68 + vBoost));
    melody.push(note(sBeat(startBar + 6, 3), 0.46, 64, 80 + vBoost));
    melody.push(note(sBeat(startBar + 6, 4), 0.46, 72, 86 + vBoost)); // C5
    melody.push(note(sBeat(startBar + 6, 5), 0.46, 71, 84 + vBoost)); // B4
    if (rich) shimmer.push(note(sBeat(startBar + 6, 4), 0.9, 84, 76));

    // Bar +7 (Am resolution + pickup according to mode)
    melody.push(note(sBeat(startBar + 7, 0), 1.35, 69, 92 + vBoost));
    accomp.push(note(sBeat(startBar + 7, 0), 0.46, 57, 74 + vBoost));
    accomp.push(note(sBeat(startBar + 7, 1), 0.46, 64, 70 + vBoost));
    accomp.push(note(sBeat(startBar + 7, 2), 0.46, 69, 68 + vBoost));
    if (mode === "first") {
      // Pickup back to repeat of A: [4] E5, [5] D#5
      melody.push(note(sBeat(startBar + 7, 4), 0.46, 76, 86));
      melody.push(note(sBeat(startBar + 7, 5), 0.46, 75, 84));
    } else if (mode === "repeat") {
      // Beethoven's pickup into C-major Episode B: [3] B4, [4] C5, [5] D5
      melody.push(note(sBeat(startBar + 7, 3), 0.46, 71, 84));
      melody.push(note(sBeat(startBar + 7, 4), 0.46, 72, 86));
      melody.push(note(sBeat(startBar + 7, 5), 0.46, 74, 88));
    } else {
      // Payoff transitions into shimmering music-box coda
      melody.push(note(sBeat(startBar + 7, 3), 0.46, 72, 90));
      melody.push(note(sBeat(startBar + 7, 4), 0.46, 76, 92));
      melody.push(note(sBeat(startBar + 7, 5), 0.46, 81, 96));
    }
  };

  // Initial pickup [0, 0.5] = E5, D#5
  melody.push(note(0, 0.46, 76, 86));
  melody.push(note(0.5, 0.46, 75, 84));

  // Bars 1..8: First A section
  writeASection(1, "first");
  // Bars 9..16: Second A section -> transitions via B4-C5-D5 to C major
  writeASection(9, "repeat");

  // --- Bars 17..24: Lyrical C-major / G-major Episode B & E-octave suspense ---
  // Bar 17 (C major): E5 (dotted eighth), G4, F5, E5 over C4-G4-E4 Alberti arpeggio
  melody.push(note(sBeat(17, 0), 1.35, 76, 94));
  melody.push(note(sBeat(17, 3), 0.46, 67, 82));
  melody.push(note(sBeat(17, 4), 0.46, 77, 92));
  melody.push(note(sBeat(17, 5), 0.46, 76, 88));
  [60, 67, 64, 60, 67, 64].forEach((p, i) => accomp.push(note(sBeat(17, i), 0.44, p, 70)));

  // Bar 18 (G major): D5 (dotted eighth), F4, E5, D5 over G3-B3-D4
  melody.push(note(sBeat(18, 0), 1.35, 74, 92));
  melody.push(note(sBeat(18, 3), 0.46, 65, 82));
  melody.push(note(sBeat(18, 4), 0.46, 76, 90));
  melody.push(note(sBeat(18, 5), 0.46, 74, 86));
  [55, 59, 62, 55, 59, 62].forEach((p, i) => accomp.push(note(sBeat(18, i), 0.44, p, 70)));

  // Bar 19 (A minor): C5 (dotted eighth), E4, D5, C5 over A3-C4-E4
  melody.push(note(sBeat(19, 0), 1.35, 72, 92));
  melody.push(note(sBeat(19, 3), 0.46, 64, 80));
  melody.push(note(sBeat(19, 4), 0.46, 74, 88));
  melody.push(note(sBeat(19, 5), 0.46, 72, 86));
  [57, 60, 64, 57, 60, 64].forEach((p, i) => accomp.push(note(sBeat(19, i), 0.44, p, 70)));

  // Bar 20 (E major): B4 (eighth) + E4-E5 octave echoes
  melody.push(note(sBeat(20, 0), 0.92, 71, 90));
  accomp.push(note(sBeat(20, 0), 0.44, 52, 74));
  accomp.push(note(sBeat(20, 1), 0.44, 59, 70));
  melody.push(note(sBeat(20, 2), 0.46, 64, 80));
  melody.push(note(sBeat(20, 3), 0.46, 76, 86));
  melody.push(note(sBeat(20, 4), 0.46, 64, 82));
  melody.push(note(sBeat(20, 5), 0.46, 76, 90));

  // Bar 21: High E5-E6 music-box cascade -> D#5-E5
  melody.push(note(sBeat(21, 0), 0.46, 76, 90));
  melody.push(note(sBeat(21, 1), 0.46, 88, 98)); // Sparkling E6!
  melody.push(note(sBeat(21, 2), 0.46, 75, 86));
  melody.push(note(sBeat(21, 3), 0.46, 76, 90));
  melody.push(note(sBeat(21, 4), 0.46, 75, 88));
  melody.push(note(sBeat(21, 5), 0.46, 76, 92));

  // Bar 22: Beethoven's teasing D#5-E5 oscillation before the Payoff return
  [75, 76, 75, 76, 76, 75].forEach((p, i) => {
    melody.push(note(sBeat(22, i), 0.46, p, 86 + i * 2));
  });
  shimmer.push(note(sBeat(22, 0), 1.2, 88, 72));

  // --- Bars 23..30: PAYOFF REPRISE with Celesta Octave Shimmer ---
  writeASection(23, "payoff");

  // --- Bars 31..34: Delicate Music-Box Coda & Ascending A-minor Arpeggio ---
  // Bar 31 (Dm6/E7): F5-E5-D5-C5-B4-C5
  [77, 76, 74, 72, 71, 72].forEach((p, i) => {
    melody.push(note(sBeat(31, i), 0.46, p, 94 - i));
    if (i % 2 === 0) shimmer.push(note(sBeat(31, i), 0.42, p + 12, 76));
  });
  accomp.push(note(sBeat(31, 0), 1.3, 57, 76));
  accomp.push(note(sBeat(31, 3), 1.3, 52, 76));

  // Bar 32 (E7 -> Am): D5-E5-C5-B4-A4-G#4
  [74, 76, 72, 71, 69, 68].forEach((p, i) => {
    melody.push(note(sBeat(32, i), 0.46, p, 92 - i * 2));
  });
  accomp.push(note(sBeat(32, 0), 1.3, 52, 76));
  accomp.push(note(sBeat(32, 3), 1.3, 59, 72));

  // Bar 33: Crystalline ascending A-minor music-box comb sweep A3 -> C4 -> E4 -> A4 -> C5 -> E5
  [57, 60, 64, 69, 72, 76].forEach((p, i) => {
    melody.push(note(sBeat(33, i), 0.55, p, 84 + i * 3));
    if (p + 12 <= 88) shimmer.push(note(sBeat(33, i) + 0.04, 0.5, p + 12, 68 + i * 2));
  });

  // Bar 34: Final warm A-minor music-box chord (rolled gently like aligned comb pins, ringing cleanly)
  const finalBeat = sBeat(34, 0);
  [57, 64, 69, 72, 76, 81].forEach((p, i) => {
    const target = i < 3 ? accomp : i < 5 ? melody : shimmer;
    target.push(note(finalBeat + i * 0.06, 2.2, p, 96 - i * 3));
  });

  const tracks: MidiWriteTrack[] = [
    { name: "Comb Melody", channel: 0, program: 10, notes: cleanTrackNotes(melody) },
    { name: "Comb Accompaniment", channel: 1, program: 10, notes: cleanTrackNotes(accomp) },
    { name: "Comb Harmonics", channel: 2, program: 10, notes: cleanTrackNotes(shimmer) },
  ];

  return {
    file: "fur-elise-music-box.mid",
    title: "F\u00fcr Elise",
    composer: "Ludwig van Beethoven",
    credit: "Beethoven, WoO 59 (public domain), music-box arrangement",
    options: {
      format: 1,
      ticksPerQuarter: 480,
      tempos: [
        { beat: 0, bpm: 136 },
        { beat: sBeat(32, 0), bpm: 124 },
        { beat: sBeat(33, 0), bpm: 112 },
        { beat: sBeat(34, 0), bpm: 98 },
      ],
      tracks,
      title: "Fur Elise",
      timeSignature: [3, 4],
    },
  };
}

// ===================================================================================================
// M. Original Jazz-Mugham Piece — "Mugham Nocturne" (D Shur mode, rubato intro + 7/8 groove + climax)
//    100% original composition authored for this repository (MIT); zero borrowed melodies or bass lines.
//    D Shur 12-TET degrees: D (2), Eb (3, +40 cents microtonal bend on ornamental notes), F (5), G (7),
//    A (9), Bb (10), C (0), plus chromatic lower-neighbour approach tones (C#, F#, G#) in the jazz solo.
// ===================================================================================================

export const MUGHAM_SHUR_CLASSES = [2, 3, 5, 7, 9, 10, 0] as const;

export function mughamNocturne(): MidiPiece {
  const rng = seededRng(0x53485552); // deterministic humanisation & solo variation seed
  const tar: MidiWriteNote[] = [];
  const kamancha: MidiWriteNote[] = [];
  const piano: MidiWriteNote[] = [];
  const bass: MidiWriteNote[] = [];
  const brushes: MidiWriteNote[] = [];

  // Deterministic micro-timing (+/-9 ms at ~128 BPM -> +/-0.019 beats) & velocity (+/-5) humaniser
  const humanBeat = (b: number, maxBeats = 0.018) => (b <= 0.02 ? b : Math.max(0, b + (rng() * 2 - 1) * maxBeats));
  const humanVel = (v: number, span = 5) => clampVelocity(v + (rng() * 2 - 1) * span);
  const bendForShur = (pitch: number, ornamental = false) =>
    ornamental && ((pitch % 12) + 12) % 12 === 3 ? 40 : undefined; // +40c neutral-2nd inflection on Eb

  // --- (a) Free-time rubato introduction: beats 0..13 (~12.0 s across fluctuating 68->56->74->62 BPM) ---
  // Sustained D2/A2 drone + bowed Kamancha breath + ornamented Tar phrasing (grace notes, mordents, trills, slides)
  bass.push(note(0, 4.2, 38, 76));     // D2 drone pluck
  kamancha.push(note(0.15, 3.8, 50, 68)); // D3 bowed breath
  kamancha.push(note(2.2, 2.6, 57, 64));  // A3 fifth colour

  bass.push(note(4.5, 4.2, 38, 74));
  kamancha.push(note(4.7, 3.9, 55, 66));  // G3 Shur fourth colour
  bass.push(note(9.0, 3.8, 38, 78));
  kamancha.push(note(9.2, 3.4, 50, 70));

  // Original ornamented Tar rubato line over the D drone
  const introTar: ReadonlyArray<readonly [number, number, number, number, boolean?]> = [
    // Phrase 1: grace D4->G4, zengule mordent G4-Ab/A4-G4, settle through F4 & Eb4(+40c) to D4
    [0.55, 0.11, 62, 78], [0.68, 1.05, 67, 92],
    [1.82, 0.12, 69, 86], [1.96, 0.12, 70, 82], [2.10, 0.85, 69, 90],
    [3.05, 0.45, 67, 84], [3.55, 0.52, 65, 82], [4.12, 0.75, 63, 86, true],
    // Phrase 2: expressive slide F4->G4->A4->C5, rapid trill on A4-Bb4, descend to G4 & D4
    [5.05, 0.12, 65, 80], [5.19, 0.14, 67, 86], [5.35, 0.95, 69, 94],
    [6.40, 0.55, 72, 92], [7.02, 0.13, 69, 88], [7.16, 0.13, 70, 84], [7.30, 0.13, 69, 88], [7.44, 0.13, 70, 82],
    [7.60, 0.95, 67, 90], [8.65, 0.55, 65, 84],
    // Phrase 3: cadential sigh Eb4(+40c) -> D4 preparing the 7/8 groove launch
    [9.35, 0.12, 65, 82], [9.50, 0.85, 63, 90, true], [10.42, 0.14, 62, 84], [10.58, 0.14, 63, 80, true],
    [10.75, 1.85, 62, 92],
  ];
  for (const [b, dur, p, v, bent] of introTar) {
    tar.push(note(humanBeat(b, 0.01), dur, p, humanVel(v, 4), bendForShur(p, Boolean(bent))));
  }
  // Gentle whispered piano quartal shimmer near end of intro
  for (const [i, p] of [55, 60, 65, 69].entries()) {
    piano.push(note(11.4 + i * 0.08, 1.2, p, 62 - i * 2));
  }

  // --- (b) 7/8 Jazz-Mugham Groove (2 + 2 + 3 eighths = 3.5 quarter-beats per bar): beats 13..62 (14 bars) ---
  const grooveStart = 13.0;
  const barBeats = 3.5; // 7/8: beat 0 (2 eighths = 1.0), beat 1.0 (2 eighths = 1.0), beat 2.0 (3 eighths = 1.5)

  // Modal bass roots & quartal piano voicings cycling cleanly in original 4-bar harmonic loops (i - iv - bVII - i)
  const grooveHarmony: ReadonlyArray<{ bass: readonly [number, number, number, number]; chord: readonly number[] }> = [
    { bass: [38, 45, 48, 45], chord: [55, 60, 65] }, // D pedal + G-C-F quartal
    { bass: [43, 50, 53, 50], chord: [53, 58, 62] }, // G subdominant + F-Bb-D
    { bass: [36, 43, 46, 45], chord: [52, 57, 60] }, // C modal VII + E-A-C->Bb
    { bass: [38, 45, 50, 45], chord: [55, 58, 62] }, // D Shur tonic + G-Bb-D
  ];

  const pushGrooveRhythmBar = (barIdx: number, b0: number, energyBoost: number) => {
    const h = grooveHarmony[barIdx % 4];
    // Plucked upright double bass 2+2+3 ostinato
    bass.push(note(humanBeat(b0), 0.88, h.bass[0], humanVel(82 + energyBoost)));
    bass.push(note(humanBeat(b0 + 1.0), 0.88, h.bass[1], humanVel(76 + energyBoost)));
    bass.push(note(humanBeat(b0 + 2.0), 0.88, h.bass[2], humanVel(80 + energyBoost)));
    bass.push(note(humanBeat(b0 + 3.0), 0.44, h.bass[3], humanVel(72 + energyBoost)));

    // Noise-based jazz brushes in 2+2+3 (39 = swirl, 40 = tap, 42 = chick)
    brushes.push(note(humanBeat(b0, 0.01), 0.25, 39, humanVel(76 + energyBoost)));
    brushes.push(note(humanBeat(b0 + 1.0, 0.01), 0.18, 40, humanVel(68 + energyBoost)));
    brushes.push(note(humanBeat(b0 + 2.0, 0.01), 0.25, 39, humanVel(74 + energyBoost)));
    brushes.push(note(humanBeat(b0 + 2.5, 0.01), 0.15, 42, humanVel(60 + energyBoost)));
    brushes.push(note(humanBeat(b0 + 3.0, 0.01), 0.18, 40, humanVel(66 + energyBoost)));
  };

  // Bars 0..7 of groove: Sequential motif development & Call-and-Response between Tar and Jazz Piano!
  const callMotifs: ReadonlyArray<ReadonlyArray<readonly [number, number, number, boolean?]>> = [
    // Bar 0 (Tar call 1): original 7/8 motif D4-F4 | G4-A4 | Bb4-A4-G4
    [[0, 0.45, 62], [0.5, 0.45, 65], [1.0, 0.45, 67], [1.5, 0.45, 69], [2.0, 0.45, 70], [2.5, 0.45, 69], [3.0, 0.45, 67]],
    // Bar 2 (Tar call 2, sequenced up into upper Shur tetrachord): F4-G4 | A4-Bb4 | C5-Bb4-A4
    [[0, 0.45, 65], [0.5, 0.45, 67], [1.0, 0.45, 69], [1.5, 0.45, 70], [2.0, 0.45, 72], [2.5, 0.45, 70], [3.0, 0.45, 69]],
    // Bar 4 (Tar call 3, ornamented with mordent & +40c Eb4): A4-C5 | D5-C5 | Bb4-G4-Eb4(+40c)
    [[0, 0.45, 69], [0.5, 0.45, 72], [1.0, 0.22, 74], [1.25, 0.22, 75, true], [1.5, 0.45, 74], [2.0, 0.45, 70], [2.5, 0.45, 67], [3.0, 0.45, 63, true]],
    // Bar 6 (Tar call 4, resolving cadence): D4-G4 | F#4(approach)->G4 | A4-F4-D4
    [[0, 0.45, 62], [0.5, 0.45, 67], [1.0, 0.22, 66], [1.25, 0.7, 67], [2.0, 0.45, 69], [2.5, 0.45, 65], [3.0, 0.45, 62]],
  ];

  const pianoResponses: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
    // Bar 1 (Piano response 1, with chromatic approach F#4->G4):
    [[0, 0.45, 66], [0.5, 0.45, 67], [1.0, 0.45, 70], [1.5, 0.45, 69], [2.0, 0.45, 67], [2.5, 0.45, 65], [3.0, 0.45, 62]],
    // Bar 3 (Piano response 2, with chromatic approach C#5->D5):
    [[0, 0.45, 73], [0.5, 0.45, 74], [1.0, 0.45, 72], [1.5, 0.45, 70], [2.0, 0.45, 69], [2.5, 0.45, 67], [3.0, 0.45, 65]],
    // Bar 5 (Piano response 3, bebop-mugham run):
    [[0, 0.45, 68], [0.5, 0.45, 69], [1.0, 0.45, 72], [1.5, 0.45, 74], [2.0, 0.45, 72], [2.5, 0.45, 69], [3.0, 0.45, 67]],
    // Bar 7 (Piano response 4, ascending lead-in to solo):
    [[0, 0.45, 62], [0.5, 0.45, 65], [1.0, 0.45, 67], [1.5, 0.45, 69], [2.0, 0.45, 72], [2.5, 0.45, 73], [3.0, 0.45, 74]],
  ];

  for (let bar = 0; bar < 8; bar++) {
    const b0 = grooveStart + bar * barBeats;
    pushGrooveRhythmBar(bar, b0, 2);
    const chord = grooveHarmony[bar % 4].chord;
    if (bar % 2 === 0) {
      // Tar leads, Piano comps soft syncopated quartals on beats 0 and 2.0
      for (const p of chord) {
        piano.push(note(humanBeat(b0), 0.75, p, humanVel(60)));
        piano.push(note(humanBeat(b0 + 2.0), 0.95, p, humanVel(62)));
      }
      for (const [off, dur, p, bent] of callMotifs[bar >> 1]) {
        tar.push(note(humanBeat(b0 + off), dur, p, humanVel(90), bendForShur(p, Boolean(bent))));
      }
    } else {
      // Piano responds with melodic line + left-hand rootless shell, Tar holds resonant fifth punctuation
      tar.push(note(humanBeat(b0), 0.9, 62, humanVel(74)));
      for (const p of chord.slice(0, 2)) piano.push(note(humanBeat(b0), 0.85, p - 12, humanVel(58)));
      for (const [off, dur, p] of pianoResponses[bar >> 1]) {
        piano.push(note(humanBeat(b0 + off), dur, p, humanVel(88)));
      }
    }
  }

  // Bars 8..13 of groove (6 bars): Seeded modal improvisation trading rapid Shur + chromatic-approach cells!
  const shurScale = [62, 63, 65, 67, 69, 70, 72, 74, 75, 77, 79, 81]; // D4..A5 in D Shur
  let degIdx = 5; // start near Bb4/A4
  for (let bar = 8; bar < 14; bar++) {
    const b0 = grooveStart + bar * barBeats;
    pushGrooveRhythmBar(bar, b0, 6);
    const chord = grooveHarmony[bar % 4].chord;
    for (const p of chord) piano.push(note(humanBeat(b0 + 2.0), 1.1, p - (bar >= 11 ? 0 : 12), humanVel(64)));

    // 7 eighth-note slots with occasional chromatic approach sixteenth & Tar/Piano trading every half-bar
    const slots = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
    for (let s = 0; s < slots.length; s++) {
      const stepChoice = rng();
      if (stepChoice < 0.36) degIdx = Math.min(shurScale.length - 1, degIdx + 1);
      else if (stepChoice < 0.72) degIdx = Math.max(1, degIdx - 1);
      else degIdx = Math.max(1, Math.min(shurScale.length - 2, degIdx + (rng() < 0.5 ? 2 : -2)));

      const targetPitch = shurScale[degIdx];
      const slotBeat = b0 + slots[s];
      const useTar = (bar + (s >= 4 ? 1 : 0)) % 2 === 0;
      const dest = useTar ? tar : piano;

      // Chromatic lower-neighbour approach on strong beats into D, G, or A
      const pc = targetPitch % 12;
      if ((s === 0 || s === 4) && (pc === 2 || pc === 7 || pc === 9) && rng() < 0.65) {
        dest.push(note(humanBeat(slotBeat, 0.01), 0.21, targetPitch - 1, humanVel(84)));
        dest.push(note(humanBeat(slotBeat + 0.25, 0.01), 0.22, targetPitch, humanVel(94)));
      } else {
        dest.push(note(
          humanBeat(slotBeat),
          0.44,
          targetPitch,
          humanVel(90 + (s === 0 || s === 4 ? 6 : 0)),
          useTar ? bendForShur(targetPitch, true) : undefined,
        ));
      }
    }
  }

  // --- (c) Octave-Doubled Climax Payoff: beats 62..79.5 (5 bars of 7/8, rising to D6 = 86!) ---
  const climaxStart = grooveStart + 14 * barBeats; // beat 62.0
  const climaxBars: ReadonlyArray<readonly number[]> = [
    [74, 75, 77, 79, 81, 79, 77], // D5 Eb5 F5 G5 A5 G5 F5
    [77, 79, 81, 82, 84, 82, 81], // F5 G5 A5 Bb5 C6 Bb5 A5
    [79, 81, 82, 84, 86, 84, 82], // Peak on D6 (86)!
    [86, 84, 82, 81, 79, 77, 75], // Cascading descent from D6
    [74, 77, 75, 74, 72, 69, 67], // Resolving cascade toward D5/G4
  ];
  climaxBars.forEach((pitches, idx) => {
    const b0 = climaxStart + idx * barBeats;
    pushGrooveRhythmBar(14 + idx, b0, 12);
    const chord = grooveHarmony[idx % 4].chord;
    for (const p of chord) piano.push(note(humanBeat(b0), 1.3, p, humanVel(76)));
    // Soft bowed kamancha soaring pad underneath climax
    kamancha.push(note(b0, 3.2, idx < 3 ? 62 : 57, 72));

    pitches.forEach((p, s) => {
      const sb = b0 + s * 0.5;
      tar.push(note(humanBeat(sb, 0.012), 0.44, p, humanVel(102 + (s === 0 ? 6 : 0)), bendForShur(p, true)));
      piano.push(note(humanBeat(sb, 0.012), 0.44, p - 12, humanVel(96 + (s === 0 ? 6 : 0))));
    });
  });

  // --- (d) Return to Opening Drone: beats 79.5..85.5 (last ~4.8 s, slowing cleanly into loop state) ---
  const codaStart = climaxStart + 5 * barBeats; // beat 79.5
  bass.push(note(codaStart, 4.8, 38, 80)); // D2 drone matching beat 0!
  kamancha.push(note(codaStart + 0.1, 4.5, 50, 68)); // D3 bowed breath matching beat 0!
  brushes.push(note(codaStart, 0.3, 39, 62));
  tar.push(note(codaStart + 0.2, 0.85, 65, 84));
  tar.push(note(codaStart + 1.15, 0.95, 63, 82, 40)); // whispered Eb4 (+40c)
  tar.push(note(codaStart + 2.2, 2.5, 62, 86)); // final sustained D4 maye

  const tracks: MidiWriteTrack[] = [
    { name: "Tar Lead", channel: 0, program: 25, notes: cleanTrackNotes(tar) },
    { name: "Kamancha Intro", channel: 1, program: 40, notes: cleanTrackNotes(kamancha) },
    { name: "Jazz Piano", channel: 2, program: 0, notes: cleanTrackNotes(piano) },
    { name: "Double Bass", channel: 3, program: 32, notes: cleanTrackNotes(bass) },
    { name: "Jazz Brushes", channel: 9, program: 0, notes: cleanTrackNotes(brushes) },
  ];

  return {
    file: "mugham-nocturne.mid",
    title: "Mugham Nocturne",
    composer: "Original",
    credit: "Original composition written for this repository (D Shur jazz-mugham); MIT",
    options: {
      format: 1,
      ticksPerQuarter: 480,
      tempos: [
        { beat: 0, bpm: 68 },
        { beat: 4, bpm: 58 },
        { beat: 8, bpm: 74 },
        { beat: 10.5, bpm: 60 },
        { beat: grooveStart, bpm: 124 },
        { beat: climaxStart, bpm: 132 },
        { beat: codaStart, bpm: 84 },
        { beat: codaStart + 2, bpm: 66 },
      ],
      tracks,
      title: "Mugham Nocturne",
      timeSignature: [7, 8],
    },
  };
}

// ===================================================================================================
// N. Original Lyrical Nocturne — "Baku Nights" (C Rast-inspired mode, 78 BPM, 4/4 slow nocturnal groove)
//    100% original composition authored for this repository (MIT); title is only a title, unrelated to
//    any existing song. C Rast-inspired degrees: C (0), D (2), E (4, -20c warm third on strings), F (5),
//    G (7), A (9), B (11) ascending / Bb (10) descending modal colour.
// ===================================================================================================

export function bakuNights(): MidiPiece {
  const rng = seededRng(0x42414b55);
  const pianoLead: MidiWriteNote[] = [];
  const pianoChords: MidiWriteNote[] = [];
  const strings: MidiWriteNote[] = [];
  const bass: MidiWriteNote[] = [];
  const brushes: MidiWriteNote[] = [];

  const humanBeat = (b: number, maxBeats = 0.012) => (b <= 0.02 ? b : Math.max(0, b + (rng() * 2 - 1) * maxBeats));
  const humanVel = (v: number, span = 5) => clampVelocity(v + (rng() * 2 - 1) * span);

  // 15 bars of 4/4 at 78 BPM (60 beats = 46.15 s) + warm resolving Cmaj9 bar = ~48.4 s
  interface NocturneBar {
    bassRoot: number;
    bassFifth: number;
    voicing: readonly number[];
    stringPad: readonly [number, number?]; // [pitch, optional centsOffset]
    melody: ReadonlyArray<readonly [number, number, number]>; // [beatOffsetInBar, durBeats, pitch]
  }

  // Newly composed original nocturnal progression & lyrical melody in C Rast-inspired mode
  const bars: readonly NocturneBar[] = [
    // Section A (Bars 0..3): Intimate opening promenade — solo piano lamps over warm bass
    {
      bassRoot: 36, bassFifth: 43, voicing: [48, 55, 59, 62], stringPad: [64, -20],
      melody: [[0, 1.4, 67], [1.5, 0.48, 69], [2.0, 0.95, 72], [3.0, 0.95, 74]],
    },
    {
      bassRoot: 41, bassFifth: 48, voicing: [53, 57, 60, 64], stringPad: [69],
      melody: [[0, 1.4, 71], [1.5, 0.48, 69], [2.0, 1.2, 67], [3.33, 0.62, 64]],
    },
    {
      bassRoot: 43, bassFifth: 50, voicing: [55, 58, 62, 65], stringPad: [67], // Gm9 (descending Bb Rast colour!)
      melody: [[0, 0.95, 65], [1.0, 0.95, 67], [2.0, 0.95, 70], [3.0, 0.95, 69]],
    },
    {
      bassRoot: 36, bassFifth: 43, voicing: [48, 52, 55, 62], stringPad: [64, -20],
      melody: [[0, 1.9, 67], [2.0, 0.95, 64], [3.0, 0.95, 62]],
    },

    // Section B (Bars 4..7): Groove & bowed strings enter, skyline begins lighting up
    {
      bassRoot: 36, bassFifth: 43, voicing: [52, 55, 59, 62], stringPad: [72],
      melody: [[0, 0.95, 67], [1.0, 0.48, 72], [1.5, 0.48, 74], [2.0, 1.4, 76], [3.5, 0.48, 74]],
    },
    {
      bassRoot: 45, bassFifth: 52, voicing: [53, 57, 60, 64], stringPad: [76, -20],
      melody: [[0, 0.95, 72], [1.0, 0.95, 69], [2.0, 0.95, 71], [3.0, 0.95, 72]],
    },
    {
      bassRoot: 38, bassFifth: 45, voicing: [53, 57, 60, 65], stringPad: [74],
      melody: [[0, 0.95, 74], [1.0, 0.48, 72], [1.5, 0.48, 69], [2.0, 1.2, 65], [3.33, 0.62, 67]],
    },
    {
      bassRoot: 43, bassFifth: 50, voicing: [53, 57, 59, 62], stringPad: [71], // G13sus4 -> G9
      melody: [[0, 1.4, 69], [1.5, 0.48, 71], [2.0, 0.95, 74], [3.0, 0.95, 72]],
    },

    // Section C — Payoff (Bars 8..11, 60%..84%): Full warm nocturnal climax in upper register!
    {
      bassRoot: 36, bassFifth: 48, voicing: [52, 55, 59, 62], stringPad: [76, -20],
      melody: [[0, 0.95, 79], [1.0, 0.48, 81], [1.5, 0.48, 79], [2.0, 0.95, 76], [3.0, 0.95, 74]],
    },
    {
      bassRoot: 41, bassFifth: 48, voicing: [53, 57, 60, 64], stringPad: [77],
      melody: [[0, 0.95, 77], [1.0, 0.48, 76], [1.5, 0.48, 74], [2.0, 0.95, 72], [3.0, 0.95, 76]],
    },
    {
      bassRoot: 43, bassFifth: 50, voicing: [55, 58, 62, 65], stringPad: [79], // Gm9 modal glow
      melody: [[0, 0.65, 74], [0.67, 0.65, 77], [1.34, 0.65, 79], [2.0, 1.2, 82], [3.33, 0.62, 79]],
    },
    {
      bassRoot: 38, bassFifth: 43, voicing: [53, 57, 60, 64], stringPad: [74],
      melody: [[0, 0.95, 77], [1.0, 0.95, 76], [2.0, 0.95, 74], [3.0, 0.95, 71]],
    },

    // Section D — Gentle Nocturnal Descent & Loop Return (Bars 12..14)
    {
      bassRoot: 36, bassFifth: 43, voicing: [48, 55, 59, 62], stringPad: [72],
      melody: [[0, 1.4, 72], [1.5, 0.48, 69], [2.0, 0.95, 67], [3.0, 0.95, 64]],
    },
    {
      bassRoot: 41, bassFifth: 43, voicing: [50, 55, 59, 62], stringPad: [67],
      melody: [[0, 1.4, 65], [1.5, 0.48, 64], [2.0, 0.95, 62], [3.0, 0.95, 64]],
    },
    {
      bassRoot: 36, bassFifth: 43, voicing: [48, 52, 55, 59], stringPad: [64, -20],
      melody: [[0, 1.8, 67], [2.0, 2.2, 60]],
    },
  ];

  bars.forEach((bar, barIdx) => {
    const b0 = barIdx * 4;
    const isPayoff = barIdx >= 8 && barIdx <= 11;
    const isIntro = barIdx < 2;
    const isOutro = barIdx >= 13;
    const dyn = isPayoff ? 12 : barIdx >= 4 && !isOutro ? 5 : 0;

    // Upright bass: warm two-feel in intro/outro, gentle walking 4-feel in middle & payoff
    bass.push(note(humanBeat(b0), 1.85, bar.bassRoot, humanVel(78 + dyn)));
    bass.push(note(humanBeat(b0 + 2.0), 1.85, bar.bassFifth, humanVel(72 + dyn)));
    if (barIdx >= 4 && barIdx <= 11) {
      bass.push(note(humanBeat(b0 + 1.0), 0.9, bar.bassRoot + 7, humanVel(66 + dyn)));
      bass.push(note(humanBeat(b0 + 3.0), 0.9, bar.bassRoot + 5, humanVel(68 + dyn)));
    }

    // Rolled warm piano left-hand voicings (lighting skyline windows!)
    bar.voicing.forEach((vp, vi) => {
      pianoChords.push(note(humanBeat(b0 + vi * 0.06, 0.006), 1.85, vp, humanVel(62 + dyn - vi * 2)));
      if (!isOutro) {
        pianoChords.push(note(humanBeat(b0 + 2.0 + vi * 0.05, 0.006), 1.75, vp, humanVel(58 + dyn - vi * 2)));
      }
    });

    // Bowed string pad & soaring counter-harmony from bar 2 onward
    if (barIdx >= 2) {
      const [sp, sbend] = bar.stringPad;
      strings.push(note(humanBeat(b0 + 0.04), 3.75, sp, humanVel(66 + dyn), sbend));
      if (isPayoff) {
        strings.push(note(humanBeat(b0 + 2.0), 1.85, sp - 5, humanVel(64 + dyn)));
      }
    }

    // Soft nocturnal jazz brushes (12/8 swung whisper from bar 2..13)
    if (!isIntro && !isOutro) {
      brushes.push(note(humanBeat(b0, 0.008), 0.3, 39, humanVel(66 + Math.floor(dyn / 2))));
      brushes.push(note(humanBeat(b0 + 1.0, 0.008), 0.18, 40, humanVel(58)));
      brushes.push(note(humanBeat(b0 + 1.67, 0.008), 0.14, 42, humanVel(52)));
      brushes.push(note(humanBeat(b0 + 2.0, 0.008), 0.3, 39, humanVel(64 + Math.floor(dyn / 2))));
      brushes.push(note(humanBeat(b0 + 3.0, 0.008), 0.18, 40, humanVel(58)));
      brushes.push(note(humanBeat(b0 + 3.67, 0.008), 0.14, 42, humanVel(52)));
    }

    // Lyrical right-hand piano melody (1-to-1 boulevard lamps; octave-warmed during payoff!)
    for (const [off, dur, mp] of bar.melody) {
      pianoLead.push(note(humanBeat(b0 + off), dur, mp, humanVel(88 + dyn)));
      if (isPayoff) {
        pianoChords.push(note(humanBeat(b0 + off + 0.01, 0.005), dur * 0.9, mp - 12, humanVel(72)));
      }
    }
  });

  // Final whispered Cmaj9 nocturnal chord at beat 60 matching the opening harmonic state
  bass.push(note(60, 2.6, 36, 74));
  [48, 55, 59, 62].forEach((p, i) => pianoChords.push(note(60.05 + i * 0.06, 2.4, p, 60 - i * 2)));
  pianoLead.push(note(60.25, 2.3, 67, 82)); // G4 matching bar 0 beat 0!

  const tracks: MidiWriteTrack[] = [
    { name: "Nocturne Piano Lead", channel: 0, program: 0, notes: cleanTrackNotes(pianoLead) },
    { name: "Nocturne Piano Chords", channel: 1, program: 0, notes: cleanTrackNotes(pianoChords) },
    { name: "Bowed String Pad", channel: 2, program: 48, notes: cleanTrackNotes(strings) },
    { name: "Upright Bass", channel: 3, program: 32, notes: cleanTrackNotes(bass) },
    { name: "Night Brushes", channel: 9, program: 0, notes: cleanTrackNotes(brushes) },
  ];

  return {
    file: "baku-nights.mid",
    title: "Baku Nights",
    composer: "Original",
    credit: "Original composition written for this repository (C Rast-inspired nocturne); MIT",
    options: {
      format: 1,
      ticksPerQuarter: 480,
      tempos: [
        { beat: 0, bpm: 78 },
        { beat: 56, bpm: 73 },
        { beat: 59, bpm: 68 },
      ],
      tracks,
      title: "Baku Nights",
      timeSignature: [4, 4],
    },
  };
}

// ===================================================================================================
// F. Christian Petzold (attr. J. S. Bach) — Minuet in G Major, BWV Anh. 114 (1725, 3/4, G major)
//    Complete 32-bar Urtext transcription from the Notebook for Anna Magdalena Bach, arranged for
//    four-mallet concert rosewood marimba (melody, inner Baroque harmony, Urtext bass, and soft
//    woody resonator bass reinforcement on strong downbeats). Public domain melody & bass; MIT arr.
// ===================================================================================================

/** Opening 8 melody pitches of Minuet in G Major (Bars 1..2): D5 G4 A4 B4 C5 | D5 G4 G4. */
export const MINUET_G_OPENING_MOTIF = [74, 67, 69, 71, 72, 74, 67, 67] as const;

type BarEvent = readonly [offsetBeats: number, durBeats: number, pitch: number, velDelta?: number];

export function minuetInGMarimba(): MidiPiece {
  const melody: MidiWriteNote[] = [];
  const harmony: MidiWriteNote[] = [];
  const bass: MidiWriteNote[] = [];
  const subBass: MidiWriteNote[] = [];

  // 3/4 time: 1 bar = 3.0 beats. Exact 32-bar Urtext RH melody (bars 1..32).
  const rhBars: readonly (readonly BarEvent[])[] = [
    // Section A (Bars 1..16)
    [[0, 0.92, 74, 6], [1, 0.46, 67], [1.5, 0.46, 69], [2, 0.46, 71], [2.5, 0.46, 72]], // 1: D5 G4 A4 B4 C5
    [[0, 0.92, 74, 6], [1, 0.85, 67, -4], [2, 0.85, 67, -4]],                             // 2: D5 G4 G4
    [[0, 0.92, 76, 6], [1, 0.46, 72], [1.5, 0.46, 74], [2, 0.46, 76], [2.5, 0.46, 78]], // 3: E5 C5 D5 E5 F#5
    [[0, 0.92, 79, 8], [1, 0.85, 67, -4], [2, 0.85, 67, -4]],                             // 4: G5 G4 G4
    [[0, 0.92, 72, 5], [1, 0.46, 74], [1.5, 0.46, 72], [2, 0.46, 71], [2.5, 0.46, 69]], // 5: C5 D5 C5 B4 A4
    [[0, 0.92, 71, 4], [1, 0.46, 72], [1.5, 0.46, 71], [2, 0.46, 69], [2.5, 0.46, 67]], // 6: B4 C5 B4 A4 G4
    [[0, 0.92, 66, 4], [1, 0.46, 67], [1.5, 0.46, 69], [2, 0.46, 71], [2.5, 0.46, 67]], // 7: F#4 G4 A4 B4 G4
    [[0, 2.75, 69, 6]],                                                                   // 8: A4 (dotted half)
    [[0, 0.92, 74, 7], [1, 0.46, 67], [1.5, 0.46, 69], [2, 0.46, 71], [2.5, 0.46, 72]], // 9: D5 G4 A4 B4 C5
    [[0, 0.92, 74, 7], [1, 0.85, 67, -3], [2, 0.85, 67, -3]],                             // 10: D5 G4 G4
    [[0, 0.92, 76, 8], [1, 0.46, 72], [1.5, 0.46, 74], [2, 0.46, 76], [2.5, 0.46, 78]], // 11: E5 C5 D5 E5 F#5
    [[0, 0.92, 79, 9], [1, 0.85, 67, -3], [2, 0.85, 67, -3]],                             // 12: G5 G4 G4
    [[0, 0.92, 72, 6], [1, 0.46, 74], [1.5, 0.46, 72], [2, 0.46, 71], [2.5, 0.46, 69]], // 13: C5 D5 C5 B4 A4
    [[0, 0.92, 71, 5], [1, 0.46, 72], [1.5, 0.46, 71], [2, 0.46, 69], [2.5, 0.46, 67]], // 14: B4 C5 B4 A4 G4
    [[0, 0.92, 69, 5], [1, 0.46, 71], [1.5, 0.46, 69], [2, 0.46, 67], [2.5, 0.46, 66]], // 15: A4 B4 A4 G4 F#4
    [[0, 2.75, 67, 7]],                                                                   // 16: G4 (dotted half)

    // Section B (Bars 17..32)
    [[0, 0.92, 83, 9], [1, 0.46, 79], [1.5, 0.46, 81], [2, 0.46, 83], [2.5, 0.46, 79]], // 17: B5 G5 A5 B5 G5
    [[0, 0.92, 81, 8], [1, 0.46, 74], [1.5, 0.46, 76], [2, 0.46, 78], [2.5, 0.46, 74]], // 18: A5 D5 E5 F#5 D5
    [[0, 0.92, 79, 8], [1, 0.46, 76], [1.5, 0.46, 78], [2, 0.46, 79], [2.5, 0.46, 74]], // 19: G5 E5 F#5 G5 D5
    [[0, 0.92, 73, 7], [1, 0.46, 71], [1.5, 0.46, 73], [2, 0.92, 69, 3]],               // 20: C#5 B4 C#5 A4
    [[0, 0.46, 69, 4], [0.5, 0.46, 71], [1, 0.46, 73], [1.5, 0.46, 74], [2, 0.46, 76], [2.5, 0.46, 78]], // 21: A4..F#5
    [[0, 0.92, 79, 8], [1, 0.92, 78, 5], [2, 0.92, 76, 4]],                             // 22: G5 F#5 E5
    [[0, 0.92, 78, 8], [1, 0.92, 69, 3], [2, 0.92, 73, 5]],                             // 23: F#5 A4 C#5
    [[0, 2.75, 74, 8]],                                                                   // 24: D5 (dotted half)
    [[0, 0.92, 74, 7], [1, 0.46, 67], [1.5, 0.46, 66], [2, 0.92, 67, 2]],               // 25: D5 G4 F#4 G4
    [[0, 0.92, 76, 7], [1, 0.46, 67], [1.5, 0.46, 66], [2, 0.92, 67, 2]],               // 26: E5 G4 F#4 G4
    [[0, 0.92, 74, 7], [1, 0.92, 72, 4], [2, 0.92, 71, 3]],                             // 27: D5 C5 B4
    [[0, 0.46, 69, 5], [0.5, 0.46, 67], [1, 0.46, 66], [1.5, 0.46, 67], [2, 0.92, 69, 4]], // 28: A4 G4 F#4 G4 A4
    [[0, 0.46, 62, 4], [0.5, 0.46, 64], [1, 0.46, 66], [1.5, 0.46, 67], [2, 0.46, 69], [2.5, 0.46, 71]], // 29: D4..B4
    [[0, 0.92, 72, 7], [1, 0.92, 71, 5], [2, 0.92, 69, 4]],                             // 30: C5 B4 A4
    [[0, 0.46, 71, 6], [0.5, 0.46, 74, 7], [1, 0.92, 67, 4], [2, 0.92, 66, 5]],         // 31: B4 D5 G4 F#4
    [[0, 2.85, 67, 10]],                                                                  // 32: G4 (final tonic)
  ];

  // Exact 32-bar Urtext LH bass line (bars 1..32).
  const lhBars: readonly (readonly BarEvent[])[] = [
    [[0, 1.85, 55, 4], [2, 0.9, 57]],                                                     // 1: G3 A3
    [[0, 2.75, 59, 4]],                                                                   // 2: B3
    [[0, 2.75, 60, 4]],                                                                   // 3: C4
    [[0, 2.75, 59, 4]],                                                                   // 4: B3
    [[0, 2.75, 57, 4]],                                                                   // 5: A3
    [[0, 2.75, 55, 4]],                                                                   // 6: G3
    [[0, 0.92, 62, 4], [1, 0.92, 59], [2, 0.92, 55]],                                     // 7: D4 B3 G3
    [[0, 0.92, 62, 4], [1, 0.46, 50], [1.5, 0.46, 60], [2, 0.46, 59], [2.5, 0.46, 57]],  // 8: D4 D3 C4 B3 A3
    [[0, 1.85, 59, 5], [2, 0.9, 57]],                                                     // 9: B3 A3
    [[0, 0.92, 55, 5], [1, 0.92, 59], [2, 0.92, 55]],                                     // 10: G3 B3 G3
    [[0, 2.75, 60, 5]],                                                                   // 11: C4
    [[0, 0.92, 59, 5], [1, 0.46, 60], [1.5, 0.46, 59], [2, 0.46, 57], [2.5, 0.46, 55]],  // 12: B3 C4 B3 A3 G3
    [[0, 2.75, 57, 5]],                                                                   // 13: A3
    [[0, 2.75, 55, 5]],                                                                   // 14: G3
    [[0, 0.92, 60, 5], [1, 0.92, 62], [2, 0.92, 50]],                                     // 15: C4 D4 D3
    [[0, 1.85, 55, 6], [2, 0.9, 43]],                                                     // 16: G3 G2
    // Section B
    [[0, 2.75, 55, 6]],                                                                   // 17: G3
    [[0, 2.75, 54, 6]],                                                                   // 18: F#3
    [[0, 0.92, 52, 6], [1, 0.92, 55], [2, 0.92, 52]],                                     // 19: E3 G3 E3
    [[0, 0.92, 57, 6], [1, 0.92, 45], [2, 0.92, 57]],                                     // 20: A3 A2 A3
    [[0, 2.75, 57, 6]],                                                                   // 21: A3
    [[0, 0.92, 59, 6], [1, 0.92, 62], [2, 0.92, 61]],                                     // 22: B3 D4 C#4
    [[0, 0.92, 62, 6], [1, 0.92, 54], [2, 0.92, 57]],                                     // 23: D4 F#3 A3
    [[0, 0.92, 62, 6], [1, 0.92, 50], [2, 0.92, 60]],                                     // 24: D4 D3 C4
    [[0, 0.92, 59, 5], [1, 0.92, 62], [2, 0.92, 59]],                                     // 25: B3 D4 B3
    [[0, 0.92, 60, 5], [1, 0.92, 64], [2, 0.92, 60]],                                     // 26: C4 E4 C4
    [[0, 0.92, 59, 5], [1, 0.92, 57], [2, 0.92, 55]],                                     // 27: B3 A3 G3
    [[0, 2.75, 62, 6]],                                                                   // 28: D4
    [[0, 1.85, 50, 5], [2, 0.9, 54]],                                                     // 29: D3 F#3
    [[0, 0.92, 52, 6], [1, 0.92, 55], [2, 0.92, 54]],                                     // 30: E3 G3 F#3
    [[0, 0.92, 55, 6], [1, 0.92, 47], [2, 0.92, 50]],                                     // 31: G3 B2 D3
    [[0, 0.92, 43, 8], [1, 0.92, 50, 6], [2, 0.95, 55, 7]],                               // 32: G2 D3 G3
  ];

  // Four-mallet inner accompaniment triads (subtle Baroque waltz-minuet pulse on beats 1..3).
  const innerChords: readonly (readonly [number, number])[] = [
    [59, 62], [62, 67], [64, 67], [62, 67], [60, 64], [59, 62], [57, 62], [54, 57], // 1..8
    [62, 67], [62, 67], [64, 67], [62, 67], [60, 64], [59, 62], [60, 62], [59, 62], // 9..16
    [62, 67], [62, 66], [59, 64], [61, 64], [61, 64], [62, 67], [61, 66], [57, 62], // 17..24
    [62, 67], [64, 67], [62, 67], [57, 62], [57, 62], [60, 64], [59, 62], [59, 62], // 25..32
  ];

  for (let bar = 0; bar < 32; bar++) {
    const b0 = bar * 3;
    const isB = bar >= 16;
    const baseVel = isB ? 90 : bar >= 8 ? 86 : 82;

    for (const [off, dur, p, dv = 0] of rhBars[bar]) {
      melody.push(note(b0 + off, dur, p, baseVel + dv));
    }
    for (const [off, dur, p, dv = 0] of lhBars[bar]) {
      bass.push(note(b0 + off, dur, p, baseVel - 10 + dv));
    }

    // Inner four-mallet pulse (beats 1 & 2 soft harmonic chimes, beat 0 accent on dotted-half bars).
    const [h0, h1] = innerChords[bar];
    const isCadenceBar = bar === 7 || bar === 15 || bar === 23 || bar === 31;
    if (bar === 31) {
      harmony.push(note(b0, 2.8, 59, 78));
      harmony.push(note(b0, 2.8, 62, 82));
    } else if (isCadenceBar) {
      harmony.push(note(b0, 0.9, h0, 66));
      harmony.push(note(b0 + 1, 0.85, h1, 60));
      harmony.push(note(b0 + 2, 0.85, h0, 56));
    } else {
      harmony.push(note(b0 + 1, 0.65, h0, isB ? 66 : 58));
      harmony.push(note(b0 + 2, 0.65, h1, isB ? 64 : 56));
      if (isB && bar % 2 === 0) {
        harmony.push(note(b0, 0.72, h1, 68));
      }
    }

    // Subtle acoustic bass resonator warmth on bar downbeats (especially in Section B).
    const rootBass = lhBars[bar][0][2];
    const lowRoot = rootBass >= 55 ? rootBass - 12 : rootBass;
    subBass.push(note(b0, 1.4, lowRoot, isB ? 56 : 48));
  }

  // Final warm G-major resolving bar (beat 96..98.5) so the cadence rings cleanly before loop reset.
  bass.push(note(96, 2.2, 43, 84));     // G2
  harmony.push(note(96.04, 2.15, 59, 76)); // B3
  harmony.push(note(96.08, 2.1, 62, 78));  // D4
  melody.push(note(96.12, 2.1, 67, 92));   // G4
  melody.push(note(96.16, 2.0, 74, 86));   // D5 (matches Bar 1 beat 0 opening pitch for seamless loop!)
  subBass.push(note(96, 2.3, 43, 62));

  const tracks: MidiWriteTrack[] = [
    { name: "Marimba Melody", channel: 0, program: 12, notes: cleanTrackNotes(melody) },
    { name: "Marimba Harmony", channel: 1, program: 12, notes: cleanTrackNotes(harmony) },
    { name: "Marimba Bass", channel: 2, program: 12, notes: cleanTrackNotes(bass) },
    { name: "Resonator Warmth", channel: 3, program: 32, notes: cleanTrackNotes(subBass) },
  ];

  return {
    file: "minuet-in-g-marimba.mid",
    title: "Minuet in G Major",
    composer: "Christian Petzold",
    credit: "Christian Petzold, BWV Anh. 114 (1725, public domain); four-mallet concert marimba arrangement MIT",
    options: {
      format: 1,
      ticksPerQuarter: 480,
      tempos: [
        { beat: 0, bpm: 120 },
        { beat: 48, bpm: 122 },
        { beat: 90, bpm: 114 },
        { beat: 94, bpm: 100 },
      ],
      tracks,
      title: "Minuet in G Major",
      timeSignature: [3, 4],
    },
  };
}

// ===================================================================================================
// G. Ludwig van Beethoven — Ode to Joy (Symphony No. 9 in D minor, Op. 125, IV, 1824, D major, 4/4)
//    Own four-voice bronze carillon arrangement: Verse 1 (full 16-bar A A' B A'' theme over bourdon
//    bass bells) -> Verse 2 (triumphant octave-peal B + A'' repeat in four-part harmony) -> grand
//    two-bar D-major tower peal cadence. Public domain melody; MIT carillon arrangement.
// ===================================================================================================

/** Iconic 15-note opening phrase of Beethoven's Ode to Joy in D major (Bars 1..4). */
export const ODE_TO_JOY_OPENING_MOTIF = [
  66, 66, 67, 69, 69, 67, 66, 64, 62, 62, 64, 66, 66, 64, 64,
] as const;

export function odeToJoyCarillon(): MidiPiece {
  const treble: MidiWriteNote[] = [];
  const midBells: MidiWriteNote[] = [];
  const bourdon: MidiWriteNote[] = [];
  const haloStrings: MidiWriteNote[] = [];

  // Exact 16-bar Ode to Joy melody in D major (4/4: 1 bar = 4 beats).
  // Section A (bars 0..3), A' (bars 4..7), B (bars 8..11), A'' (bars 12..15).
  const themeBars: readonly (readonly BarEvent[])[] = [
    // A (1..4)
    [[0, 0.95, 66, 4], [1, 0.95, 66], [2, 0.95, 67, 2], [3, 0.95, 69, 5]],
    [[0, 0.95, 69, 5], [1, 0.95, 67, 2], [2, 0.95, 66], [3, 0.95, 64, -2]],
    [[0, 0.95, 62, 3], [1, 0.95, 62], [2, 0.95, 64, 2], [3, 0.95, 66, 4]],
    [[0, 1.45, 66, 5], [1.5, 0.48, 64, -2], [2, 1.9, 64, 2]],
    // A' (5..8)
    [[0, 0.95, 66, 5], [1, 0.95, 66], [2, 0.95, 67, 3], [3, 0.95, 69, 6]],
    [[0, 0.95, 69, 6], [1, 0.95, 67, 3], [2, 0.95, 66], [3, 0.95, 64, -1]],
    [[0, 0.95, 62, 4], [1, 0.95, 62], [2, 0.95, 64, 3], [3, 0.95, 66, 5]],
    [[0, 1.45, 64, 5], [1.5, 0.48, 62, -1], [2, 1.9, 62, 5]],
    // B (9..12): exact Beethoven Symphony No. 9 IV syncopation — beat 3 of bar 12 anticipates F#4 tied over barline into bar 13!
    [[0, 0.95, 64, 4], [1, 0.95, 64], [2, 0.95, 66, 3], [3, 0.95, 62, 2]],
    [[0, 0.95, 64, 4], [1, 0.48, 66, 3], [1.5, 0.48, 67, 4], [2, 0.95, 66, 4], [3, 0.95, 62, 2]],
    [[0, 0.95, 64, 5], [1, 0.48, 66, 3], [1.5, 0.48, 67, 5], [2, 0.95, 66, 5], [3, 0.95, 64, 2]],
    [[0, 0.95, 62, 4], [1, 0.95, 64, 3], [2, 0.95, 57, 6], [3, 1.92, 66, 7]],
    // A'' (13..16): beat 0 of bar 13 holds the tied F#4 from bar 12 beat 3; melody continues on beat 1!
    [[1, 0.95, 66], [2, 0.95, 67, 4], [3, 0.95, 69, 7]],
    [[0, 0.95, 69, 7], [1, 0.95, 67, 4], [2, 0.95, 66, 2], [3, 0.95, 64]],
    [[0, 0.95, 62, 5], [1, 0.95, 62], [2, 0.95, 64, 4], [3, 0.95, 66, 6]],
    [[0, 1.45, 64, 6], [1.5, 0.48, 62, 2], [2, 1.9, 62, 8]],
  ];

  // Bourdon bass & inner harmony plan per bar of the 16-bar theme (all strict D-major diatonic pitches).
  // Bass bells live in [A2(45), B2(47), C#3(49), D3(50), E3(52), F#3(54), G3(55)]; mid/alto in B3..A4.
  const barHarmony: readonly { bass0: number; bass2: number; alto0: number; alto2: number; tenor0: number }[] = [
    // A (1..4)
    { bass0: 50, bass2: 50, alto0: 62, alto2: 62, tenor0: 57 }, // D | D
    { bass0: 45, bass2: 45, alto0: 61, alto2: 61, tenor0: 57 }, // A | A
    { bass0: 50, bass2: 54, alto0: 57, alto2: 62, tenor0: 57 }, // D | D/F#
    { bass0: 50, bass2: 45, alto0: 62, alto2: 61, tenor0: 57 }, // D | A
    // A' (5..8)
    { bass0: 50, bass2: 55, alto0: 62, alto2: 62, tenor0: 57 }, // D | G
    { bass0: 54, bass2: 52, alto0: 62, alto2: 61, tenor0: 57 }, // D/F# | Em/A
    { bass0: 47, bass2: 50, alto0: 59, alto2: 62, tenor0: 54 }, // Bm | D
    { bass0: 45, bass2: 50, alto0: 61, alto2: 57, tenor0: 57 }, // A | D
    // B (9..12)
    { bass0: 45, bass2: 50, alto0: 61, alto2: 62, tenor0: 57 }, // A | D
    { bass0: 45, bass2: 50, alto0: 61, alto2: 62, tenor0: 57 }, // A | D
    { bass0: 45, bass2: 47, alto0: 61, alto2: 59, tenor0: 57 }, // A | Bm
    { bass0: 55, bass2: 45, alto0: 59, alto2: 61, tenor0: 55 }, // G | A
    // A'' (13..16)
    { bass0: 50, bass2: 55, alto0: 62, alto2: 62, tenor0: 57 }, // D | G
    { bass0: 54, bass2: 45, alto0: 62, alto2: 61, tenor0: 57 }, // D/F# | A
    { bass0: 47, bass2: 55, alto0: 59, alto2: 62, tenor0: 54 }, // Bm | G
    { bass0: 45, bass2: 50, alto0: 61, alto2: 57, tenor0: 57 }, // A | D
  ];

  // --- Verse 1 (Bars 1..16, beats 0..64): Pure bronze melody growing into 3-voice tower harmony ---
  // Note: Track 2 (Carillon Mid Bells) carries ONLY the pure single-line Beethoven melody!
  for (let bar = 0; bar < 16; bar++) {
    const b0 = bar * 4;
    const h = barHarmony[bar];
    const velBase = bar < 4 ? 82 : bar < 8 ? 86 : bar < 12 ? 88 : 92;

    for (const [off, dur, p, dv = 0] of themeBars[bar]) {
      midBells.push(note(b0 + off, dur, p, velBase + dv));
    }

    // Bourdon bass bells enter cleanly on downbeats from bar 0, doubling half-bar pulse from bar 4
    bourdon.push(note(b0, 1.9, h.bass0, bar < 4 ? 72 : 78));
    if (bar >= 4) {
      bourdon.push(note(b0 + 2, 1.85, h.bass2, 74));
    }

    // Warm inner alto & tenor chime voices enter from bar 8 (Section B) onward on bourdon/strings tracks
    if (bar >= 8) {
      bourdon.push(note(b0, 1.85, h.alto0, 68));
      bourdon.push(note(b0 + 2, 1.85, h.alto2, 66));
      haloStrings.push(note(b0, 1.85, h.alto0, 50));
      haloStrings.push(note(b0 + 2, 1.85, h.alto2, 48));
      if (bar >= 12) {
        const downbeatPitch = bar === 12 ? 78 : themeBars[bar][0][2] + 12;
        treble.push(note(bar === 12 ? b0 - 1 : b0, bar === 12 ? 1.92 : 1.8, downbeatPitch, 74));
        bourdon.push(note(b0 + 1, 0.9, h.tenor0, 64));
      }
    }
    if (bar >= 12) {
      haloStrings.push(note(b0, 3.85, h.bass0 + 12, 48));
    }
  }

  // --- Verse 2 (Bars 17..24, beats 64..96): Beethoven's own repeat of B + A'' in 4-voice carillon harmony ---
  // Ends directly on Beethoven's real Bar 24 tonic D-major cadence (zero invented coda bars!).
  for (let i = 0; i < 8; i++) {
    const srcBar = 8 + i; // B (8..11) + A'' (12..15)
    const b0 = 64 + i * 4;
    const h = barHarmony[srcBar];
    const isFinalA = i >= 4;
    const velBase = isFinalA ? 96 : 92;

    for (const [off, dur, p, dv = 0] of themeBars[srcBar]) {
      const isFinalTonic = i === 7 && off === 2;
      const d = isFinalTonic ? 2.8 : dur;
      midBells.push(note(b0 + off, d, p, velBase - 4 + dv));
      const upper = p === 57 ? 69 : p + 12; // keeps every treble pitch inside B4..A5
      treble.push(note(b0 + off, d, upper, velBase + dv));
    }

    // Driving bourdon bass + cathedral strings on Beethoven's real bars 17..24
    bourdon.push(note(b0, 1.85, h.bass0, 86));
    bourdon.push(note(b0 + 1, 0.9, h.tenor0, 72));
    if (i < 7) {
      bourdon.push(note(b0 + 2, 1.85, h.bass2, 84));
      bourdon.push(note(b0 + 3, 0.9, h.tenor0, 70));
      haloStrings.push(note(b0, 3.85, h.bass0 + 12, isFinalA ? 56 : 52));
      haloStrings.push(note(b0, 1.85, h.alto0, isFinalA ? 52 : 48));
      haloStrings.push(note(b0 + 2, 1.85, h.alto2, isFinalA ? 52 : 48));
    } else {
      // Bar 24 beat 2: resonant full-carillon D-major tonic chord directly on Beethoven's final half-note D4!
      bourdon.push(note(b0 + 2, 2.8, 50, 96));   // D3
      bourdon.push(note(b0 + 2, 2.8, 54, 84));   // F#3
      bourdon.push(note(b0 + 2, 2.8, 57, 86));   // A3
      treble.push(note(b0 + 2, 2.8, 78, 92));    // F#5
      treble.push(note(b0 + 2, 2.8, 81, 88));    // A5
      haloStrings.push(note(b0, 1.9, 57, 52));
      haloStrings.push(note(b0 + 2, 2.8, 62, 56));
      haloStrings.push(note(b0 + 2, 2.8, 66, 54));
    }
  }

  const tracks: MidiWriteTrack[] = [
    { name: "Carillon Treble Bells", channel: 0, program: 14, notes: cleanTrackNotes(treble) },
    { name: "Carillon Mid Bells", channel: 1, program: 14, notes: cleanTrackNotes(midBells) },
    { name: "Bourdon Bass Bells", channel: 2, program: 14, notes: cleanTrackNotes(bourdon) },
    { name: "Cathedral Strings", channel: 3, program: 48, notes: cleanTrackNotes(haloStrings) },
  ];

  return {
    file: "ode-to-joy-carillon.mid",
    title: "Ode to Joy",
    composer: "Ludwig van Beethoven",
    credit: "Beethoven, Symphony No. 9 IV (1824, public domain); four-voice belfry carillon arrangement MIT",
    options: {
      format: 1,
      ticksPerQuarter: 480,
      tempos: [
        { beat: 0, bpm: 112 },
        { beat: 64, bpm: 115 },
        { beat: 92, bpm: 100 },
        { beat: 94, bpm: 88 },
      ],
      tracks,
      title: "Ode to Joy",
      timeSignature: [4, 4],
    },
  };
}

/** Score-verified opening mordent + descending scale of J. S. Bach's Toccata in D Minor (BWV 565). */
export const TOCCATA_D_MINOR_OPENING_MOTIF = [81, 79, 81, 79, 77, 76, 74, 73, 74] as const;

/**
 * Johann Sebastian Bach (1685-1750), Toccata in D Minor, BWV 565 (c. 1703-1708, public domain).
 * Complete Toccata section (Bars 1-30, ending at Bach's real Bar 30 D-minor cadence before the Fugue),
 * transcribed directly from the Mutopia Project Bach-Gesellschaft Ausgabe 1867 LilyPond source
 * (https://www.mutopiaproject.org/ftp/BachJS/BWV565/ToccataFugue/ToccataFugue.ly).
 * Compass D2 (38) .. Bb5 (82) so every note maps 1-to-1 to a speaking cathedral pipe.
 */
export function toccataInDMinorOrgan(): MidiPiece {
  const great: MidiWriteNote[] = []; // Right hand / treble facade pipes (program 19)
  const choir: MidiWriteNote[] = []; // Left hand / mid accompaniment pipes (program 19)
  const pedal: MidiWriteNote[] = []; // Deep bass tower pipes (program 19)

  const pushTriplet = (b: number, p1: number, p2: number, p3: number, vel: number, doubleOctDown = true) => {
    const step = 1 / 6; // 16th-note triplet = 1/6 quarter beat
    const seq = [p1, p2, p3];
    for (let i = 0; i < 3; i++) {
      const p = seq[i];
      great.push(note(b + i * step, step * 0.92, p, vel + (i === 0 ? 4 : -2)));
      if (doubleOctDown && p - 12 >= 38) {
        choir.push(note(b + i * step, step * 0.92, p - 12, vel - 8));
      }
    }
  };

  // --- Bar 1: Flourish 1 (A5-G5-A5 | G5-F5-E5-D5-C#5-D5, doubled an octave lower) ---
  let b = 0;
  const pushFl1 = (start: number, hi: number, doubleOct: boolean, vel: number): number => {
    const evs: readonly [number, number, number][] = [
      [0.0, 0.14, hi],
      [0.16, 0.14, hi - 2],
      [0.32, 0.92, hi],
      [1.36, 0.2, hi - 2],
      [1.58, 0.2, hi - 4],
      [1.8, 0.2, hi - 5],
      [2.02, 0.2, hi - 7],
      [2.24, 0.3, hi - 8],
      [2.58, 1.05, hi - 7],
    ];
    for (const [off, dur, p] of evs) {
      (hi >= 69 ? great : choir).push(note(start + off, dur, p, vel));
      if (doubleOct && p - 12 >= 38) {
        (p - 12 >= 50 ? choir : pedal).push(note(start + off, dur, p - 12, vel - 6));
      }
    }
    return start + 3.85;
  };
  b = pushFl1(b, 81, true, 108); // A5/A4 -> D5/D4

  // --- Bar 1b: Flourish 2 (EXACT score: A4-G4-A4 | E4-F4-C#4-D4 — only 4 notes after A!, doubled octave lower) ---
  const fl2: readonly [number, number, number][] = [
    [0.0, 0.14, 69],    // A4
    [0.16, 0.14, 67],   // G4
    [0.32, 0.85, 69],   // A4 (fermata)
    [1.28, 0.2, 64],    // E4
    [1.5, 0.2, 65],     // F4
    [1.72, 0.3, 61],    // C#4
    [2.06, 1.05, 62],   // D4 (fermata)
  ];
  for (const [off, dur, p] of fl2) {
    great.push(note(b + off, dur, p, 104));
    choir.push(note(b + off, dur, p - 12, 98)); // A3 -> E3-F3-C#3-D3
  }
  b += 3.35;

  // --- Bar 2: Flourish 3 (A3-G3-A3 | G3-F3-E3-D3-C#3-D3) ---
  b = pushFl1(b, 57, false, 100);

  // --- Bar 2b-3: Deep D2 pedal + C#dim7 arpeggio resolving to D MAJOR with inner G4-E4-F#4 (bwv565.ly lines 41-43, 617-619) ---
  const bPedal = b;
  pedal.push(note(bPedal, 5.4, 38, 108)); // D2 pedal
  const dimChord: readonly [number, number, number][] = [
    [0.15, 2.35, 49], // C#3
    [0.45, 2.05, 52], // E3
    [0.75, 1.75, 55], // G3
    [1.05, 1.45, 58], // Bb3
    [1.35, 1.15, 61], // C#4
    [1.65, 0.85, 64], // E4
  ];
  for (const [off, dur, p] of dimChord) {
    (p >= 58 ? great : choir).push(note(bPedal + off, dur, p, 96));
  }
  // Bar 3 beat 0: D MAJOR resolution (D3, A3, D4, F#4, A4, D5) + Bach's exact inner G4(16th) -> E4(16th) -> F#4(8th)!
  const bRes = bPedal + 2.6;
  choir.push(note(bRes, 2.6, 50, 96));   // D3
  choir.push(note(bRes, 2.6, 57, 94));   // A3
  great.push(note(bRes, 2.6, 62, 100));  // D4
  great.push(note(bRes, 2.6, 69, 98));   // A4
  great.push(note(bRes, 2.6, 74, 104));  // D5
  // Moving inner third voice: G4(16th) -> E4(16th) -> F#4(held)
  choir.push(note(bRes, 0.28, 67, 96));        // G4
  choir.push(note(bRes + 0.3, 0.28, 64, 94));  // E4
  choir.push(note(bRes + 0.6, 2.0, 66, 100));  // F#4 (D MAJOR!)

  // --- Bars 4-10: Prestissimo (bwv565.ly lines 46-75 & 622-650) ---
  b = bRes + 3.0;
  const bPrestissimo = b;
  // Pickup C#4 / C#3
  great.push(note(b, 0.22, 61, 96));
  choir.push(note(b, 0.22, 49, 88));
  b += 0.25;

  // Bar 4: (D4 E4 C#4)x3 + D4 E4 | (F4 G4 E4)x3 + F4 G4 (both hands an octave apart)
  for (let k = 0; k < 3; k++) { pushTriplet(b, 62, 64, 61, 96); b += 0.5; }
  great.push(note(b, 0.23, 62, 96), note(b + 0.25, 0.23, 64, 96));
  choir.push(note(b, 0.23, 50, 88), note(b + 0.25, 0.23, 52, 88));
  b += 0.5;
  for (let k = 0; k < 3; k++) { pushTriplet(b, 65, 67, 64, 98); b += 0.5; }
  great.push(note(b, 0.23, 65, 98), note(b + 0.25, 0.23, 67, 98));
  choir.push(note(b, 0.23, 53, 90), note(b + 0.25, 0.23, 55, 90));
  b += 0.5;

  // Bar 5: (A4 Bb4 G4)x3 + A4 fermata + rest + pickup C#5/C#4
  for (let k = 0; k < 3; k++) { pushTriplet(b, 69, 70, 67, 100); b += 0.5; }
  great.push(note(b, 0.65, 69, 104));
  choir.push(note(b, 0.65, 57, 96));
  b += 1.25;
  great.push(note(b, 0.22, 73, 98));
  choir.push(note(b, 0.22, 61, 90));
  b += 0.25;

  // Bar 6: Octave higher! (D5 E5 C#5)x3 + D5 E5 | (F5 G5 E5)x3 + F5 G5
  for (let k = 0; k < 3; k++) { pushTriplet(b, 74, 76, 73, 100); b += 0.5; }
  great.push(note(b, 0.23, 74, 100), note(b + 0.25, 0.23, 76, 100));
  choir.push(note(b, 0.23, 62, 92), note(b + 0.25, 0.23, 64, 92));
  b += 0.5;
  for (let k = 0; k < 3; k++) { pushTriplet(b, 77, 79, 76, 102); b += 0.5; }
  great.push(note(b, 0.23, 77, 102), note(b + 0.25, 0.23, 79, 102));
  choir.push(note(b, 0.23, 65, 94), note(b + 0.25, 0.23, 67, 94));
  b += 0.5;

  // Bar 7: (A5 Bb5 G5)x3 + A5 fermata + rest + pickup A5/A4
  for (let k = 0; k < 3; k++) { pushTriplet(b, 81, 82, 79, 104); b += 0.5; }
  great.push(note(b, 0.65, 81, 108));
  choir.push(note(b, 0.65, 69, 98));
  b += 1.25;
  great.push(note(b, 0.22, 81, 102));
  choir.push(note(b, 0.22, 69, 94));
  b += 0.25;

  // Bars 8-10a: Falling 3-note broken-chord chain in both hands (bwv565.ly lines 65-72 & 641-648)
  const fallChain: readonly [number, number, number][] = [
    [79, 82, 76], // G5 Bb5 E5
    [77, 81, 74], // F5 A5 D5
    [76, 79, 72], // E5 G5 C5
    [74, 77, 70], // D5 F5 Bb4
    [72, 76, 69], // C5 E5 A4
    [70, 74, 67], // Bb4 D5 G4
    [69, 72, 65], // A4 C5 F4
    [67, 70, 64], // G4 Bb4 E4
    [65, 69, 62], // F4 A4 D4
    [64, 67, 61], // E4 G4 C#4
  ];
  for (const [p1, p2, p3] of fallChain) {
    pushTriplet(b, p1, p2, p3, 100); b += 0.5;
    pushTriplet(b, p1, p2, p3, 96); b += 0.5;
  }

  // Bar 10b-12a: Pedal D2 + C#dim7 chord + Bar 11 solo scale flourish -> Bar 12 D MINOR fermata (bwv565.ly lines 73-78, 449-454)
  b += 0.5;
  pedal.push(note(b, 4.4, 38, 108)); // D2
  choir.push(note(b, 3.0, 49, 92), note(b, 3.0, 52, 92), note(b, 3.0, 55, 92), note(b, 3.0, 58, 92));
  great.push(note(b, 1.4, 61, 94), note(b, 1.4, 64, 94), note(b, 1.4, 67, 94), note(b, 1.4, 70, 98));
  b += 1.5;
  // Bar 11 RH solo scale run: Bb4 -> A4 G4 F4 E4 D4 C#4 B3 C#4 A3 C#4 E4 G4 F4 E4
  const bar11Run: readonly [number, number][] = [
    [70, 0.2], [69, 0.16], [67, 0.16], [65, 0.16], [64, 0.16], [62, 0.16], [61, 0.16], [59, 0.16],
    [61, 0.2], [57, 0.2], [61, 0.2], [64, 0.16], [67, 0.16], [65, 0.35], [64, 0.22],
  ];
  for (const [p, d] of bar11Run) {
    great.push(note(b, d * 0.92, p, 98));
    b += d;
  }
  // Bar 12 beat 0: D MINOR fermata resolution!
  pedal.push(note(b, 1.15, 38, 108)); // D2
  choir.push(note(b, 1.15, 50, 96));  // D3
  great.push(note(b, 1.15, 62, 100), note(b, 1.15, 65, 104)); // D4 + F4 (D minor!)
  b += 1.5;

  // --- Bars 12b-15: Exact Bach 16th-note bariolage over A4 pedal-point (bwv565.ly lines 78-91 & 654-660) ---
  const bBariolage = b;
  const bar12_15: readonly number[] = [
    69, // pickup A4
    // Bar 12b: d e f d e f g e
    74, 76, 77, 74, 76, 77, 79, 76,
    // Bar 13: f g a f g a bes g a f g e f d e cis
    77, 79, 81, 77, 79, 81, 82, 79, 81, 77, 79, 76, 77, 74, 76, 73,
    // Bar 14: d a bes g a f g e f d g e f d e cis
    74, 69, 70, 67, 69, 65, 67, 64, 65, 62, 67, 64, 65, 62, 64, 61,
    // Bar 15: octave lower! d a bes g a f g e f d g e f d e cis
    62, 57, 58, 55, 57, 53, 55, 52, 53, 50, 55, 52, 53, 50, 52, 49,
  ];
  for (let i = 0; i < bar12_15.length; i++) {
    const p = bar12_15[i];
    (p >= 61 ? great : choir).push(note(b + i * 0.25, 0.22, p, 96 + (i % 4 === 0 ? 4 : -2)));
    // LH pulsing A4 / A3 pedal-point on off-sixteenths (bwv565.ly lines 654-660)
    if (i >= 1 && i % 2 === 1) {
      choir.push(note(b + i * 0.25, 0.2, i < 25 ? 69 : 57, 76));
    }
  }
  b += bar12_15.length * 0.25;

  // --- Bars 16-21: Real Bach contrapuntal exchanges & pedal descents (bwv565.ly lines 91-125 & 1177-1188) ---
  // Bar 16 & Bar 17: identical 4-beat exchange over D3-C3-Bb2-A2 pedal!
  for (let rep = 0; rep < 2; rep++) {
    if (rep === 0) choir.push(note(b, 0.45, 50, 98)); // D3 downbeat
    else great.push(note(b, 0.45, 64, 98), note(b, 0.45, 69, 100)); // [E4, A4] downbeat
    const fig: readonly [number, number][] = [
      [0.25, 65], [0.5, 70], [0.75, 65], [1.0, 64], [1.25, 69], [1.5, 64],
      [1.75, 62], [2.0, 67], [2.25, 62], [2.5, 64], [2.75, 69],
    ];
    for (const [off, p] of fig) great.push(note(b + off, 0.22, p, 96));
    // Ending chord hits [F4,Bb4], [E4,A4], [D4,G4]
    great.push(note(b + 3.0, 0.24, 65, 98), note(b + 3.0, 0.24, 70, 98));
    great.push(note(b + 3.35, 0.24, 64, 98), note(b + 3.35, 0.24, 69, 98));
    great.push(note(b + 3.7, 0.24, 62, 98), note(b + 3.7, 0.24, 67, 98));
    // Pedal D3 C3 Bb2 (and A2 downbeat of Bar 17)
    if (rep === 1) pedal.push(note(b, 0.45, 45, 102));
    pedal.push(note(b + 2.5, 0.45, 50, 100), note(b + 3.0, 0.45, 48, 98), note(b + 3.5, 0.45, 46, 98));
    b += 4.0;
  }

  // Bar 18: [E4,A4] -> 32nd-note scale flourish (bwv565.ly lines 98-106) over A2 pedal
  pedal.push(note(b, 1.5, 45, 104)); // A2
  choir.push(note(b, 0.9, 61, 92), note(b, 0.9, 64, 92));
  great.push(note(b, 0.9, 69, 100));
  const bar18Run: readonly number[] = [
    69, 67, 65, 64, 62, 61, 59, 61, 57, 59, 61, 62,
    64, 65, 67, 69, 67, 65, 64, 65, 62, 65, 69, 73,
  ];
  for (let i = 0; i < bar18Run.length; i++) {
    (bar18Run[i] >= 62 ? great : choir).push(note(b + 1.0 + i * 0.125, 0.115, bar18Run[i], 96));
  }
  b += 4.0;

  // Bar 19-20: Rising D5 scale to Bb5 + chordal descent over D3-C3-Bb2-A2-G#2 pedal (bwv565.ly lines 108-115)
  const bar19Run: readonly number[] = [74, 69, 71, 73, 74, 76, 77, 79, 81, 82];
  for (let i = 0; i < bar19Run.length; i++) great.push(note(b + i * 0.2, 0.18, bar19Run[i], 100));
  pedal.push(note(b + 1.5, 0.45, 50, 100), note(b + 2.0, 0.45, 48, 98), note(b + 2.5, 0.45, 46, 98), note(b + 3.0, 0.45, 45, 98));
  great.push(note(b + 2.25, 0.35, 77, 100), note(b + 2.25, 0.35, 82, 102));
  great.push(note(b + 2.75, 0.35, 76, 100), note(b + 2.75, 0.35, 81, 102));
  great.push(note(b + 3.25, 0.35, 74, 100), note(b + 3.25, 0.35, 79, 102));
  great.push(note(b + 3.65, 0.3, 73, 100), note(b + 3.65, 0.3, 76, 100), note(b + 3.65, 0.3, 81, 104));
  b += 4.0;

  // Bar 20-21: Descending chromatic/scalar cadence into G pedal (bwv565.ly lines 116-124)
  pedal.push(note(b + 0.0, 0.45, 50, 100), note(b + 0.5, 0.45, 48, 98), note(b + 1.0, 0.45, 46, 98), note(b + 1.5, 0.45, 45, 98), note(b + 2.0, 0.45, 44, 100));
  great.push(note(b + 0.0, 0.45, 76, 100), note(b + 0.5, 0.45, 74, 98), note(b + 1.0, 0.45, 72, 98), note(b + 1.5, 0.45, 70, 98));
  choir.push(note(b + 2.0, 0.45, 61, 96), note(b + 2.0, 0.45, 64, 96), note(b + 2.0, 0.45, 69, 98));
  b += 2.5;
  pedal.push(note(b, 2.0, 43, 104)); // G2 pedal (Bar 21)
  const bar21Run: readonly number[] = [
    61, 59, 57, 61, 64, 67, 70, 69, 67, 65, 64, 65, 64, 62, 61, 62, 60, 58, 57, 55, 53, 52, 50,
  ];
  for (let i = 0; i < bar21Run.length; i++) {
    (bar21Run[i] >= 61 ? great : choir).push(note(b + i * 0.15, 0.14, bar21Run[i], 98));
  }
  b += bar21Run.length * 0.15 + 0.15;

  // --- Bars 22-27a: Prestissimo diminished-7th triplet storm (bwv565.ly lines 126-138 & 691-706) ---
  const bStorm = b;
  pedal.push(note(b, 1.8, 55, 104)); // G3
  choir.push(note(b, 1.8, 61, 96), note(b, 1.8, 64, 96), note(b, 1.8, 67, 96));
  great.push(note(b, 1.8, 70, 100), note(b, 1.8, 73, 102), note(b, 1.8, 76, 104));
  b += 2.0;

  // Diminished-7th triplets descending then surging back up to Bar 27 climax!
  const stormPairs: readonly [readonly [number, number, number], readonly [number, number, number], number][] = [
    [[73, 76, 73], [70, 73, 70], 3], // Bar 22b-23a
    [[67, 70, 67], [64, 67, 64], 3], // Bar 23b-24a
    [[61, 64, 61], [58, 61, 58], 3], // Bar 24b-25a
    [[61, 64, 61], [64, 67, 64], 3], // Bar 25b-26a
    [[67, 70, 67], [70, 67, 70], 2], // Bar 26b
    [[73, 70, 73], [76, 73, 76], 2], // Bar 27a
  ];
  for (const [t1, t2, reps] of stormPairs) {
    for (let r = 0; r < reps; r++) {
      pushTriplet(b, t1[0], t1[1], t1[2], 102, true); b += 0.5;
      pushTriplet(b, t2[0], t2[1], t2[2], 100, true); b += 0.5;
    }
  }

  // --- Bars 27b-30: Monumental Bach Maestoso cadence ending in PURE D MINOR (bwv565.ly lines 138-144, 706-715, 1193-1199) ---
  const bCoda = b;
  // Bar 27 beat 2: A7/G -> beat 3: Dm/F
  pedal.push(note(b, 0.92, 43, 108)); // G2
  choir.push(note(b, 0.92, 57, 98), note(b, 0.92, 61, 96), note(b, 0.92, 64, 96));
  great.push(note(b, 0.92, 69, 104), note(b, 0.92, 73, 104), note(b, 0.92, 76, 106), note(b, 0.92, 81, 110));
  b += 1.0;

  pedal.push(note(b, 0.92, 41, 108)); // F2
  choir.push(note(b, 0.92, 57, 98), note(b, 0.92, 62, 98), note(b, 0.92, 65, 98));
  great.push(note(b, 0.92, 69, 104), note(b, 0.92, 74, 106), note(b, 0.92, 77, 106), note(b, 0.92, 81, 110));
  b += 1.0;

  // Bar 28: Gm/Bb -> A7/A with Bach's exact pedal line (Bb2 -> A2 G2 A2 -> E2 F2 D2 E2 C#2)
  pedal.push(note(b, 1.4, 46, 108), note(b + 1.5, 0.24, 45, 100), note(b + 1.75, 0.24, 43, 100));
  choir.push(note(b, 1.2, 62, 96), note(b, 1.2, 67, 98));
  great.push(note(b, 1.2, 70, 106), note(b, 1.2, 74, 106), note(b, 1.2, 79, 110));
  b += 2.0;

  pedal.push(note(b, 0.7, 45, 108), note(b + 0.75, 0.24, 40, 100), note(b + 1.0, 0.24, 41, 100), note(b + 1.25, 0.24, 38, 100), note(b + 1.5, 0.24, 40, 100), note(b + 1.75, 0.24, 49, 100));
  choir.push(note(b, 1.2, 61, 96), note(b, 1.2, 64, 98));
  great.push(note(b, 1.2, 69, 106), note(b, 1.2, 73, 106), note(b, 1.2, 76, 106), note(b, 1.2, 79, 110));
  b += 2.0;

  // Bar 29: Pedal cadence figure D2..A2 + RH suspension [A4,C#5] -> [F4,A4,D5] -> F4 -> E4
  const bar29Ped: readonly [number, number, number][] = [
    [0.0, 0.45, 50], [0.5, 0.45, 47], [1.0, 0.45, 49], [1.5, 0.45, 45],
    [2.0, 0.45, 53], [2.5, 0.45, 50], [3.0, 0.95, 45],
  ];
  for (const [off, dur, p] of bar29Ped) pedal.push(note(b + off, dur, p, 104));
  great.push(note(b + 1.5, 0.45, 69, 102), note(b + 1.5, 0.45, 73, 102));
  great.push(note(b + 2.0, 0.5, 65, 102), note(b + 2.0, 0.5, 69, 104), note(b + 2.0, 0.5, 74, 108));
  great.push(note(b + 2.5, 0.45, 65, 102));
  great.push(note(b + 3.0, 0.95, 64, 104)); // E4
  choir.push(note(b + 2.0, 0.95, 57, 98), note(b + 3.0, 0.95, 61, 100)); // A3 -> C#4 leading tone
  b += 4.0;

  // Bar 30: REAL BACH BAR 30 CADENCE IN PURE D MINOR (D2 + D3 + A3 + D4 + F4 + A4 + D5 — NO F#!)
  const finalDur = 3.2;
  pedal.push(note(b, finalDur, 38, 114));       // D2
  pedal.push(note(b + 0.02, finalDur - 0.02, 50, 104)); // D3
  choir.push(note(b + 0.04, finalDur - 0.04, 57, 100)); // A3
  choir.push(note(b + 0.06, finalDur - 0.06, 62, 102)); // D4
  great.push(note(b + 0.08, finalDur - 0.08, 65, 106)); // F4 (D MINOR!)
  great.push(note(b + 0.10, finalDur - 0.10, 69, 104)); // A4
  great.push(note(b + 0.12, finalDur - 0.12, 74, 110)); // D5

  const tracks: MidiWriteTrack[] = [
    { name: "Great Manual Pipes", channel: 0, program: 19, notes: cleanTrackNotes(great) },
    { name: "Choir Manual Pipes", channel: 1, program: 19, notes: cleanTrackNotes(choir) },
    { name: "Pedal Tower Pipes", channel: 2, program: 19, notes: cleanTrackNotes(pedal) },
  ];

  return {
    file: "toccata-in-d-minor-organ.mid",
    title: "Toccata in D Minor",
    composer: "Johann Sebastian Bach",
    credit: "J. S. Bach, Toccata in D Minor, BWV 565, mm. 1-30 (Bach-Gesellschaft 1867 / Mutopia, public domain); tracker organ arrangement MIT",
    options: {
      format: 1,
      ticksPerQuarter: 480,
      tempos: [
        { beat: 0, bpm: 86 },
        { beat: bPrestissimo, bpm: 138 },
        { beat: bBariolage, bpm: 144 },
        { beat: bStorm, bpm: 152 },
        { beat: bCoda, bpm: 112 },
        { beat: b, bpm: 84 },
      ],
      tracks,
      title: "Toccata in D Minor",
      timeSignature: [4, 4],
    },
  };
}

/** Score-verified opening melody pitches of Tchaikovsky's Dance of the Sugar Plum Fairy (E minor). */
export const SUGAR_PLUM_OPENING_MOTIF = [79, 76, 79, 78, 75, 76, 74, 74, 74] as const;

/**
 * Pyotr Ilyich Tchaikovsky (1840-1893), Dance of the Sugar Plum Fairy from The Nutcracker, Op. 71
 * (1892, public domain). Complete Part A (Bars 1-20, ending cleanly on the real Part A E-minor
 * cadence at Bar 20), transcribed directly from the 1922 G. Schirmer public-domain edition
 * (arr. Stepan Esipoff, NYPL / Archive.org: https://archive.org/details/nutcrackersuiteo00tcha, pp. 16-17).
 * Compass E3 (52) .. B5 (83) so every note maps 1-to-1 to a physical steel kalimba tine.
 */
export function sugarPlumKalimba(): MidiPiece {
  const melody: MidiWriteNote[] = [];  // Upper spring-steel tines (program 108 = kalimba)
  const harmony: MidiWriteNote[] = []; // Inner kalimba chord tines (program 108 = kalimba)
  const bass: MidiWriteNote[] = [];    // Low pizzicato resonator bass tines (program 32)

  type Ev = readonly [number, number, number, number?]; // [beatOff, durBeats, pitch, velOff?]

  const writeBar = (
    b0: number,
    melEvs: readonly Ev[],
    harmEvs: readonly Ev[],
    bassEvs: readonly Ev[],
    velBase: number,
  ) => {
    for (const [off, dur, p, dv = 0] of melEvs) melody.push(note(b0 + off, dur, p, velBase + dv));
    for (const [off, dur, p, dv = 0] of harmEvs) harmony.push(note(b0 + off, dur, p, velBase - 18 + dv));
    for (const [off, dur, p, dv = 0] of bassEvs) bass.push(note(b0 + off, dur, p, velBase - 12 + dv));
  };

  // --- Bars 1-4 (beats 0..8): Exact 4-bar pp leggero E-minor introduction (Schirmer 1922 p. 16 sys 1) ---
  for (let bar = 0; bar < 4; bar++) {
    const b0 = bar * 2.0;
    const isEven = bar % 2 === 0;
    // Bass pizzicato E3 on beats 0 and 1
    bass.push(note(b0 + 0.0, 0.36, 52, 74), note(b0 + 1.0, 0.36, 52, 72));
    if (isEven) {
      // Bars 1 & 3: [E4, G4, B4] on offbeats 0.5 & 1.5
      for (const off of [0.5, 1.5]) {
        harmony.push(note(b0 + off, 0.34, 64, 64), note(b0 + off, 0.34, 67, 66), note(b0 + off, 0.34, 71, 68));
      }
    } else {
      // Bars 2 & 4: [D#4, F#4, A4] on 0.5, [D4, F4, G#4] on 1.5
      harmony.push(note(b0 + 0.5, 0.34, 63, 64), note(b0 + 0.5, 0.34, 66, 66), note(b0 + 0.5, 0.34, 69, 68));
      harmony.push(note(b0 + 1.5, 0.34, 62, 64), note(b0 + 1.5, 0.34, 65, 66), note(b0 + 1.5, 0.34, 68, 68));
    }
  }

  // Helper: Phrase A1 (Score Bars 5-8 or Bars 13-16, 4 complete bars = 8 beats)
  // Exact score rhythm: rest(.5) G5(.25) E5(.25) G5(.5) F#5(.5) | D#5(.5) E5(.5) D5(.25) D5(.25) D5(.5) |
  //                     C#5(.25) C#5(.25) C#5(.5) C5(.25) C5(.25) C5(.5) | B4(.25) E5(.25) C5(.25) E5(.25) B4(.5) + bass turnaround
  const pushPhraseA1 = (b0: number, vel: number): number => {
    // Bar 5: rest(.5) G5(.25) E5(.25) G5(.5) F#5(.5)
    writeBar(
      b0 + 0,
      [[0.5, 0.21, 79, 8], [0.75, 0.21, 76, 4], [1.0, 0.42, 79, 8], [1.5, 0.42, 78, 7]],
      [[0.5, 0.21, 71], [0.75, 0.21, 67], [1.0, 0.4, 71], [1.5, 0.4, 69]],
      [[0.0, 0.36, 52, 4], [0.5, 0.34, 59], [1.0, 0.36, 52, 2], [1.5, 0.34, 64]],
      vel,
    );
    // Bar 6: D#5(.5) E5(.5) D5(.25) D5(.25) D5(.5)
    writeBar(
      b0 + 2,
      [[0.0, 0.42, 75, 6], [0.5, 0.42, 76, 8], [1.0, 0.21, 74, 6], [1.25, 0.21, 74, 3], [1.5, 0.42, 74, 7]],
      [[0.0, 0.4, 66], [0.5, 0.4, 67], [1.0, 0.21, 65], [1.25, 0.21, 68], [1.5, 0.4, 68]],
      [[0.0, 0.36, 52, 3], [0.5, 0.34, 63], [1.0, 0.36, 52, 2], [1.5, 0.34, 62]],
      vel,
    );
    // Bar 7: C#5(.25) C#5(.25) C#5(.5) C5(.25) C5(.25) C5(.5)
    writeBar(
      b0 + 4,
      [[0.0, 0.21, 73, 6], [0.25, 0.21, 73, 3], [0.5, 0.42, 73, 7], [1.0, 0.21, 72, 6], [1.25, 0.21, 72, 3], [1.5, 0.42, 72, 7]],
      [[0.0, 0.21, 67], [0.25, 0.21, 67], [0.5, 0.4, 67], [1.0, 0.21, 66], [1.25, 0.21, 66], [1.5, 0.4, 66]],
      [[0.0, 0.36, 55, 3], [0.5, 0.34, 61], [1.0, 0.36, 54, 3], [1.5, 0.34, 60]],
      vel,
    );
    // Bar 8: B4(.25) E5(.25) C5(.25) E5(.25) B4(.5) + bass-clarinet 32nd turnaround G4-F#4-E4-D#4 (inside E3..B5!)
    writeBar(
      b0 + 6,
      [[0.0, 0.21, 71, 6], [0.25, 0.21, 76, 8], [0.5, 0.21, 72, 6], [0.75, 0.21, 76, 8], [1.0, 0.44, 71, 7]],
      [[0.0, 0.21, 67], [0.25, 0.21, 67], [0.5, 0.21, 69], [0.75, 0.21, 69], [1.0, 0.42, 67]],
      [[0.0, 0.36, 59, 4], [0.5, 0.34, 57], [1.0, 0.36, 59, 4], [1.5, 0.11, 67, -2], [1.625, 0.11, 66, -2], [1.75, 0.11, 64, -2], [1.875, 0.11, 63, -2]],
      vel,
    );
    return b0 + 8;
  };

  // --- Bars 5-8 (beats 8..16): Phrase A1 ---
  let b = pushPhraseA1(8.0, 94);

  // --- Bars 9-12 (beats 16..24): Exact Score Phrase A2 (Schirmer 1922 p. 16 sys 3!) ---
  // Bar 9: rest(.5) G4(.25) E4(.25) G4(.5) F#4(.5) (printed an octave lower than Bar 5!)
  writeBar(
    b + 0,
    [[0.5, 0.21, 67, 6], [0.75, 0.21, 64, 3], [1.0, 0.42, 67, 7], [1.5, 0.42, 66, 6]],
    [[0.5, 0.21, 59], [0.75, 0.21, 55], [1.0, 0.4, 59], [1.5, 0.4, 57]],
    [[0.0, 0.36, 52, 2], [0.5, 0.34, 61], [1.0, 0.36, 52, 2], [1.5, 0.34, 60]],
    92,
  );
  // Bar 10: C5(.5) B4(.5) G5(.25) G5(.25) G5(.5)
  writeBar(
    b + 2,
    [[0.0, 0.42, 72, 7], [0.5, 0.42, 71, 6], [1.0, 0.21, 79, 9], [1.25, 0.21, 79, 6], [1.5, 0.42, 79, 10]],
    [[0.0, 0.4, 66], [0.5, 0.4, 64], [1.0, 0.21, 73], [1.25, 0.21, 73], [1.5, 0.4, 73], [1.0, 0.21, 70], [1.5, 0.4, 70]],
    [[0.0, 0.36, 57, 4], [0.5, 0.34, 63], [1.0, 0.36, 55, 4], [1.5, 0.34, 64]],
    95,
  );
  // Bar 11: F#5(.25) F#5(.25) F#5(.5) E5(.25) E5(.25) E5(.5)
  writeBar(
    b + 4,
    [[0.0, 0.21, 78, 8], [0.25, 0.21, 78, 5], [0.5, 0.42, 78, 9], [1.0, 0.21, 76, 8], [1.25, 0.21, 76, 5], [1.5, 0.42, 76, 9]],
    [[0.0, 0.21, 72], [0.25, 0.21, 72], [0.5, 0.4, 72], [1.0, 0.21, 71], [1.25, 0.21, 71], [1.5, 0.4, 71]],
    [[0.0, 0.36, 59, 4], [0.5, 0.34, 66], [1.0, 0.36, 58, 4], [1.5, 0.34, 67]],
    96,
  );
  // Bar 12: D#5(.25) F#5(.25) E5(.25) F#5(.25) D#5(.5) (stays open on D#5 over B major!) + turnaround
  writeBar(
    b + 6,
    [[0.0, 0.21, 75, 7], [0.25, 0.21, 78, 9], [0.5, 0.21, 76, 7], [0.75, 0.21, 78, 9], [1.0, 0.44, 75, 8]],
    [[0.0, 0.21, 71], [0.25, 0.21, 71], [0.5, 0.21, 70], [0.75, 0.21, 71], [1.0, 0.42, 71]],
    [[0.0, 0.36, 59, 5], [0.5, 0.34, 63], [1.0, 0.36, 59, 5], [1.5, 0.11, 59, -2], [1.625, 0.11, 57, -2], [1.75, 0.11, 55, -2], [1.875, 0.11, 54, -2]],
    95,
  );
  b += 8;

  // --- Bars 13-16 (beats 24..32): Exact Score Return of Phrase A1 (Schirmer 1922 p. 16 sys 4) ---
  b = pushPhraseA1(b, 98);

  // --- Bars 17-20 (beats 32..40): Exact Score Part A Closing Cadence (Schirmer 1922 p. 17 sys 1!) ---
  // Bar 17: rest(.5) E5(.25) C#5(.25) E5(.5) D#5(.5) + bass turnaround F4-E4-D#4-C#4
  writeBar(
    b + 0,
    [[0.5, 0.21, 76, 7], [0.75, 0.21, 73, 4], [1.0, 0.42, 76, 8], [1.5, 0.42, 75, 7]],
    [[0.5, 0.21, 70], [0.75, 0.21, 66], [1.0, 0.4, 70], [1.5, 0.4, 69]],
    [[0.0, 0.36, 61, 4], [0.5, 0.4, 59], [1.0, 0.11, 65, -2], [1.125, 0.11, 64, -2], [1.25, 0.11, 63, -2], [1.375, 0.11, 61, -2], [1.5, 0.36, 60, 2]],
    96,
  );
  // Bar 18: rest(.5) D5(.25) B4(.25) D5(.5) C#5(.5) + turnaround E4-D4-C#4-B3
  writeBar(
    b + 2,
    [[0.5, 0.21, 74, 7], [0.75, 0.21, 71, 4], [1.0, 0.42, 74, 8], [1.5, 0.42, 73, 7]],
    [[0.5, 0.21, 68], [0.75, 0.21, 64], [1.0, 0.4, 68], [1.5, 0.4, 67]],
    [[0.0, 0.45, 59, 4], [0.5, 0.36, 52], [1.0, 0.11, 64, -2], [1.125, 0.11, 62, -2], [1.25, 0.11, 61, -2], [1.375, 0.11, 59, -2], [1.5, 0.36, 59, 2]],
    95,
  );
  // Bar 19: rest(.5) C5(.25) A4(.25) C5(.5) B4(.5) + turnaround D4-C4-B3-A3
  writeBar(
    b + 4,
    [[0.5, 0.21, 72, 7], [0.75, 0.21, 69, 4], [1.0, 0.42, 72, 8], [1.5, 0.42, 71, 8]],
    [[0.5, 0.21, 66], [0.75, 0.21, 62], [1.0, 0.4, 66], [1.5, 0.4, 67]],
    [[0.0, 0.45, 57, 4], [0.5, 0.36, 52], [1.0, 0.11, 62, -2], [1.125, 0.11, 60, -2], [1.25, 0.11, 59, -2], [1.375, 0.11, 57, -2], [1.5, 0.36, 57, 2]],
    96,
  );
  // Bar 20: rest(.5) rising 32nd-note arpeggio B4-D#5-F#5-B5 -> resolving on rolled E-minor tonic cadence E5!
  writeBar(
    b + 6,
    [
      [0.5, 0.12, 71, 6],
      [0.625, 0.12, 75, 7],
      [0.75, 0.12, 78, 8],
      [0.875, 0.12, 83, 10],
      [1.0, 2.2, 76, 12], // E5 tonic resolution (real Part A cadence!)
    ],
    [
      [0.0, 0.42, 64],
      [0.5, 0.42, 67],
      [1.05, 2.15, 64, 4], // E4
      [1.1, 2.1, 67, 6],   // G4
      [1.15, 2.05, 71, 8], // B4
    ],
    [
      [0.0, 0.42, 59, 4],
      [0.5, 0.42, 59, 4],
      [1.0, 2.2, 52, 12],  // E3 tonic bass
      [1.05, 2.15, 59, 8], // B3
    ],
    98,
  );

  const tracks: MidiWriteTrack[] = [
    { name: "Kalimba Treble Tines", channel: 0, program: 108, notes: cleanTrackNotes(melody) },
    { name: "Kalimba Harmony Tines", channel: 1, program: 108, notes: cleanTrackNotes(harmony) },
    { name: "Kalimba Bass Tines", channel: 2, program: 32, notes: cleanTrackNotes(bass) },
  ];

  return {
    file: "sugar-plum-kalimba.mid",
    title: "Dance of the Sugar Plum Fairy",
    composer: "Pyotr Ilyich Tchaikovsky",
    credit: "P. I. Tchaikovsky, The Nutcracker Op. 71, mm. 1-20 (G. Schirmer 1922, public domain); kalimba arrangement MIT",
    options: {
      format: 1,
      ticksPerQuarter: 480,
      tempos: [
        { beat: 0, bpm: 54 },
        { beat: 16, bpm: 55 },
        { beat: 32, bpm: 54 },
        { beat: 38, bpm: 48 },
      ],
      tracks,
      title: "Dance of the Sugar Plum Fairy",
      timeSignature: [2, 4],
    },
  };
}

/** Score-verified opening melody pitches of Mozart's Rondo Alla Turca (K. 331, III, A minor). */
export const TURKISH_MARCH_OPENING_MOTIF = [71, 69, 68, 69, 72, 74, 72, 71, 72, 76, 77, 76, 75, 76] as const;

/**
 * Wolfgang Amadeus Mozart (1756-1791), Rondo Alla Turca ("Turkish March") from Piano Sonata No. 11
 * in A major, K. 331, III (Allegretto, 2/4 time, 1783, public domain).
 * Bars 1-32 with Mozart's written repeats (Section A x2, Section B + A-return, Section C A-major refrain x2),
 * ending on Mozart's real A-major cadence at the end of Section C, transcribed directly from Mutopia Project
 * (https://www.mutopiaproject.org/ftp/MozartWA/KV331/KV331_3_RondoAllaTurca/KV331_3_RondoAllaTurca-lys.zip).
 * Compass A2 (45) .. C#6 (85) so every note maps 1-to-1 to a physical brass string, wooden jack, and manual key.
 */
export function turkishMarchHarpsichord(): MidiPiece {
  const rh: MidiWriteNote[] = []; // Harpsichord right-hand treble (program 6)
  const lh: MidiWriteNote[] = []; // Harpsichord left-hand bass/chords (program 6)

  type MelEv = readonly [number, number, number, number?]; // [beatOff, durBeats, pitch, velOff?]

  const pushLhAlberti = (b: number, bassP: number, chord: readonly number[], vel: number, beats = 4) => {
    lh.push(note(b, 0.42, bassP, vel + 4));
    for (let k = 1; k < beats; k++) {
      for (const c of chord) lh.push(note(b + k * 0.5, 0.42, c, vel - 6 + (k === 2 ? 2 : 0)));
    }
  };

  // Helper: Mozart righta + lefta (Score Bars 1-8 + 1-beat pickup = 16 beats; ends on Bar 8 beat 0 E5 quarter)
  const pushSectionA = (bPickup: number, ending: "half" | "tonic", velBase: number): number => {
    // 1-beat pickup: B4 A4 G#4 A4 (h16 a gis a)
    const pk: readonly MelEv[] = [[0.0, 0.23, 71, 2], [0.25, 0.23, 69], [0.5, 0.23, 68], [0.75, 0.23, 69, 2]];
    for (const [off, dur, p, dv = 0] of pk) rh.push(note(bPickup + off, dur, p, velBase + dv));

    const b0 = bPickup + 1.0;
    // Bar 1: C5(0.5) rest(0.5) D5 C5 B4 C5 | LH: a8 <c' e'> <c' e'> <c' e'>
    for (const [off, dur, p, dv = 0] of [[0.0, 0.46, 72, 6], [1.0, 0.23, 74, 2], [1.25, 0.23, 72], [1.5, 0.23, 71], [1.75, 0.23, 72, 2]] as readonly MelEv[]) {
      rh.push(note(b0 + off, dur, p, velBase + dv));
    }
    pushLhAlberti(b0 + 0, 45, [60, 64], velBase - 14);

    // Bar 2: E5(0.5) rest(0.5) F5 E5 D#5 E5
    for (const [off, dur, p, dv = 0] of [[0.0, 0.46, 76, 8], [1.0, 0.23, 77, 2], [1.25, 0.23, 76], [1.5, 0.23, 75], [1.75, 0.23, 76, 2]] as readonly MelEv[]) {
      rh.push(note(b0 + 2 + off, dur, p, velBase + dv));
    }
    pushLhAlberti(b0 + 2, 45, [60, 64], velBase - 14);

    // Bar 3: B5 A5 G#5 A5 B5 A5 G#5 A5 | LH: a8 <c' e'> a8 <c' e'>
    for (const [off, p] of [[0.0, 83], [0.25, 81], [0.5, 80], [0.75, 81], [1.0, 83], [1.25, 81], [1.5, 80], [1.75, 81]] as const) {
      rh.push(note(b0 + 4 + off, 0.23, p, velBase + (off % 1 === 0 ? 6 : 2)));
    }
    lh.push(note(b0 + 4.0, 0.42, 45, velBase - 10), note(b0 + 4.5, 0.42, 60, velBase - 16), note(b0 + 4.5, 0.42, 64, velBase - 16));
    lh.push(note(b0 + 5.0, 0.42, 45, velBase - 10), note(b0 + 5.5, 0.42, 60, velBase - 16), note(b0 + 5.5, 0.42, 64, velBase - 16));

    if (ending === "half") {
      // Bar 4: C6(1.0) A5(0.5) C6(0.5)
      rh.push(note(b0 + 6.0, 0.92, 84, velBase + 10), note(b0 + 7.0, 0.46, 81, velBase + 4), note(b0 + 7.5, 0.46, 84, velBase + 6));
      pushLhAlberti(b0 + 6, 45, [60, 64], velBase - 12);
      // Bar 5: B5 <F#5 A5> <E5 G5> <F#5 A5> (righta line 39; melody B5 A5 G5 A5!)
      for (const [off, p] of [[0.0, 83], [0.5, 81], [1.0, 79], [1.5, 81]] as const) rh.push(note(b0 + 8 + off, 0.46, p, velBase + 4));
      pushLhAlberti(b0 + 8, 52, [59, 64], velBase - 14);
      // Bar 6: B5 A5 G5 A5
      for (const [off, p] of [[0.0, 83], [0.5, 81], [1.0, 79], [1.5, 81]] as const) rh.push(note(b0 + 10 + off, 0.46, p, velBase + 4));
      pushLhAlberti(b0 + 10, 52, [59, 64], velBase - 14);
      // Bar 7: B5 A5 G5 F#5 | LH: e8 <h e'> h,8 h8
      for (const [off, p] of [[0.0, 83], [0.5, 81], [1.0, 79], [1.5, 78]] as const) rh.push(note(b0 + 12 + off, 0.46, p, velBase + 5));
      lh.push(note(b0 + 12.0, 0.42, 52, velBase - 10), note(b0 + 12.5, 0.42, 59, velBase - 14), note(b0 + 12.5, 0.42, 64, velBase - 14));
      lh.push(note(b0 + 13.0, 0.42, 47, velBase - 10), note(b0 + 13.5, 0.42, 59, velBase - 12));
      // Bar 8 beat 0: E5(1.0) half-cadence in E minor (beat 1.0 will carry the next section's pickup!)
      rh.push(note(b0 + 14.0, 0.92, 76, velBase + 6));
      lh.push(note(b0 + 14.0, 0.92, 52, velBase - 10));
    } else {
      // rightaa + leftaa (Bars 20-24, closing on A minor!)
      // Bar 20: C6(1.0) A5(0.5) B5(0.5) | LH: f8 <a dis'> <a dis'> <a dis'>
      rh.push(note(b0 + 6.0, 0.92, 84, velBase + 10), note(b0 + 7.0, 0.46, 81, velBase + 4), note(b0 + 7.5, 0.46, 83, velBase + 5));
      pushLhAlberti(b0 + 6, 53, [57, 63], velBase - 12);
      // Bar 21: C6 B5 A5 G#5 | LH: e8 <a e'> d8 <f h>
      for (const [off, p] of [[0.0, 84], [0.5, 83], [1.0, 81], [1.5, 80]] as const) rh.push(note(b0 + 8 + off, 0.46, p, velBase + 5));
      lh.push(note(b0 + 8.0, 0.42, 52, velBase - 12), note(b0 + 8.5, 0.42, 57, velBase - 14), note(b0 + 8.5, 0.42, 64, velBase - 14));
      lh.push(note(b0 + 9.0, 0.42, 50, velBase - 12), note(b0 + 9.5, 0.42, 53, velBase - 14), note(b0 + 9.5, 0.42, 59, velBase - 14));
      // Bar 22: A5 E5 F5 D5 | LH: c8 <e a> d8 <f h>
      for (const [off, p] of [[0.0, 81], [0.5, 76], [1.0, 77], [1.5, 74]] as const) rh.push(note(b0 + 10 + off, 0.46, p, velBase + 5));
      lh.push(note(b0 + 10.0, 0.42, 48, velBase - 12), note(b0 + 10.5, 0.42, 52, velBase - 14), note(b0 + 10.5, 0.42, 57, velBase - 14));
      lh.push(note(b0 + 11.0, 0.42, 50, velBase - 12), note(b0 + 11.5, 0.42, 53, velBase - 14), note(b0 + 11.5, 0.42, 59, velBase - 14));
      // Bar 23: C5(1.0) B4(0.75) A4(0.125) B4(0.125) | LH: <e a> <e a> <e gis> <e gis>
      rh.push(note(b0 + 12.0, 0.92, 72, velBase + 6), note(b0 + 13.0, 0.72, 71, velBase + 5), note(b0 + 13.75, 0.12, 69, velBase + 3), note(b0 + 13.875, 0.12, 71, velBase + 4));
      lh.push(note(b0 + 12.0, 0.42, 52, velBase - 12), note(b0 + 12.0, 0.42, 57, velBase - 14), note(b0 + 12.5, 0.42, 52, velBase - 14), note(b0 + 12.5, 0.42, 57, velBase - 14));
      lh.push(note(b0 + 13.0, 0.42, 52, velBase - 12), note(b0 + 13.0, 0.42, 56, velBase - 14), note(b0 + 13.5, 0.42, 52, velBase - 14), note(b0 + 13.5, 0.42, 56, velBase - 14));
      // Bar 24 beat 0: A4(1.0) A-minor tonic cadence!
      rh.push(note(b0 + 14.0, 0.92, 69, velBase + 8));
      lh.push(note(b0 + 14.0, 0.92, 45, velBase - 8), note(b0 + 14.0, 0.92, 57, velBase - 10));
    }
    return b0 + 15.0; // beat 1.0 of Bar 8/24 where next pickup starts
  };

  // --- Section A (Bars 1-8) + written repeat (Bars 1-8 again) = 32 beats ---
  let b = pushSectionA(0.0, "half", 94);
  b = pushSectionA(b, "half", 96);

  // --- Section B (Bars 9-16, rightb + leftb, KV331_3_RondoAllaTurcaNotes.ly lines 56-66 & 187-190) ---
  // Pickup: <C5 E5>(0.5) <D5 F5>(0.5)
  const bSecB = b;
  const pushBHalf = (start: number, mel: readonly [number, number, number][], bassBar: readonly [number, number, number][], cadBass: number) => {
    for (const [off, dur, p] of mel) rh.push(note(start + off, dur, p, 96));
    for (const [off, dur, p] of bassBar) lh.push(note(start + off, dur, p, 84));
    lh.push(note(start + 3.0, 0.92, cadBass, 86));
  };
  // Bars 9-10: pickup E5 F5 | G5 G5 A5 G5 F5 E5 | D5 (C major -> G)
  pushBHalf(
    b,
    [[0.0, 0.46, 76], [0.5, 0.46, 77], [1.0, 0.46, 79], [1.5, 0.46, 79], [2.0, 0.23, 81], [2.25, 0.23, 79], [2.5, 0.23, 77], [2.75, 0.23, 76], [3.0, 0.92, 74]],
    [[1.0, 0.42, 48], [1.5, 0.42, 60], [2.0, 0.42, 52], [2.5, 0.42, 64]],
    55,
  );
  b += 4.0;
  // Bars 11-12: pickup E5 F5 | G5 G5 A5 G5 F5 E5 | D5
  pushBHalf(
    b,
    [[0.0, 0.46, 76], [0.5, 0.46, 77], [1.0, 0.46, 79], [1.5, 0.46, 79], [2.0, 0.23, 81], [2.25, 0.23, 79], [2.5, 0.23, 77], [2.75, 0.23, 76], [3.0, 0.92, 74]],
    [[1.0, 0.42, 48], [1.5, 0.42, 60], [2.0, 0.42, 52], [2.5, 0.42, 64]],
    55,
  );
  b += 4.0;
  // Bars 13-14: pickup C5 D5 | E5 E5 F5 E5 D5 C5 | B4 (A minor -> E)
  pushBHalf(
    b,
    [[0.0, 0.46, 72], [0.5, 0.46, 74], [1.0, 0.46, 76], [1.5, 0.46, 76], [2.0, 0.23, 77], [2.25, 0.23, 76], [2.5, 0.23, 74], [2.75, 0.23, 72], [3.0, 0.92, 71]],
    [[1.0, 0.42, 45], [1.5, 0.42, 57], [2.0, 0.42, 48], [2.5, 0.42, 60]],
    52,
  );
  b += 4.0;
  // Bars 15-16: pickup C5 D5 | E5 E5 F5 E5 D5 C5 | B4
  pushBHalf(
    b,
    [[0.0, 0.46, 72], [0.5, 0.46, 74], [1.0, 0.46, 76], [1.5, 0.46, 76], [2.0, 0.23, 77], [2.25, 0.23, 76], [2.5, 0.23, 74], [2.75, 0.23, 72], [3.0, 0.92, 71]],
    [[1.0, 0.42, 45], [1.5, 0.42, 57], [2.0, 0.42, 48], [2.5, 0.42, 60]],
    52,
  );
  b += 4.0;

  // --- Return of Section A (Bars 17-24, rightaa + leftaa, closing in A minor!) ---
  b = pushSectionA(b, "tonic", 98);

  // --- Section C: Exact Mozart A-Major Janissary Refrain (rightc + leftc, lines 68-75 & 192-218) x2 ---
  // Exact Mozart pitches: <A4 A5> <B4 B5> | <C#5 C#6>(1.0) <A4 A5> <B4 B5> | <C#5 C#6> <B4 B5> <A4 A5> <G#4 G#5> |
  //                       <F#4 F#5> <G#4 G#5> <A4 A5> <B4 B5> | <G#4 G#5> <E4 E5> <A4 A5> <B4 B5> |
  //                       <C#5 C#6>(1.0) <A4 A5> <B4 B5> | <C#5 C#6> <B4 B5> <A4 A5> <G#4 G#5> |
  //                       <F#4 F#5> <B4 B5> <G#4 G#5> <E4 E5> | <A4 A5>(1.0)
  const bSecC = b;
  const pushSectionC = (start: number, vel: number, isFinal: boolean): number => {
    const oct = (off: number, dur: number, lowP: number, dv = 0) => {
      rh.push(note(start + off, dur, lowP, vel + dv));
      rh.push(note(start + off, dur, lowP + 12, vel + 2 + dv));
    };
    // Pickup (beat 0..1): A4/A5(0.5) B4/B5(0.5)
    oct(0.0, 0.46, 69, 4); oct(0.5, 0.46, 71, 6);
    // Bar 25: C#5/C#6(1.0) A4/A5(0.5) B4/B5(0.5)
    oct(1.0, 0.92, 73, 10); oct(2.0, 0.46, 69, 4); oct(2.5, 0.46, 71, 6);
    // Bar 26: C#5/C#6 B4/B5 A4/A5 G#4/G#5
    oct(3.0, 0.46, 73, 8); oct(3.5, 0.46, 71, 4); oct(4.0, 0.46, 69, 4); oct(4.5, 0.46, 68, 4);
    // Bar 27: F#4/F#5 G#4/G#5 A4/A5 B4/B5
    oct(5.0, 0.46, 66, 6); oct(5.5, 0.46, 68, 4); oct(6.0, 0.46, 69, 6); oct(6.5, 0.46, 71, 6);
    // Bar 28: G#4/G#5 E4/E5 A4/A5 B4/B5
    oct(7.0, 0.46, 68, 6); oct(7.5, 0.46, 64, 4); oct(8.0, 0.46, 69, 4); oct(8.5, 0.46, 71, 6);
    // Bar 29: C#5/C#6(1.0) A4/A5(0.5) B4/B5(0.5)
    oct(9.0, 0.92, 73, 10); oct(10.0, 0.46, 69, 4); oct(10.5, 0.46, 71, 6);
    // Bar 30: C#5/C#6 B4/B5 A4/A5 G#4/G#5
    oct(11.0, 0.46, 73, 8); oct(11.5, 0.46, 71, 4); oct(12.0, 0.46, 69, 4); oct(12.5, 0.46, 68, 4);
    // Bar 31: F#4/F#5 B4/B5 G#4/G#5 E4/E5
    oct(13.0, 0.46, 66, 8); oct(13.5, 0.46, 71, 8); oct(14.0, 0.46, 68, 8); oct(14.5, 0.46, 64, 6);
    // Bar 32 beat 0: A4/A5(1.0 or held final cadence!)
    const finDur = isFinal ? 2.2 : 0.92;
    oct(15.0, finDur, 69, 12);

    // Exact leftc accompaniment (KV331_3_RondoAllaTurcaNotes.ly lines 192-218: stral, stral, strd, strdis, strel, stral, stral, strd, stre, a,4!)
    const pushStrum = (off: number, root: number, third: number, fifth: number, top: number, beatsCount: number) => {
      lh.push(note(start + off, 0.42, root, vel - 10), note(start + off, 0.42, third, vel - 14), note(start + off, 0.42, fifth, vel - 14), note(start + off, 0.42, top, vel - 12));
      for (let k = 1; k < beatsCount; k++) lh.push(note(start + off + k * 0.5, 0.42, top, vel - 14));
    };
    pushStrum(1.0, 45, 49, 52, 57, 4);  // Bar 25: A major
    pushStrum(3.0, 45, 49, 52, 57, 4);  // Bar 26: A major
    pushStrum(5.0, 50, 54, 57, 62, 2);  // Bar 27a: D major
    pushStrum(6.0, 51, 54, 57, 63, 2);  // Bar 27b: D# dim
    pushStrum(7.0, 52, 56, 59, 64, 4);  // Bar 28: E major
    pushStrum(9.0, 45, 49, 52, 57, 4);  // Bar 29: A major
    pushStrum(11.0, 45, 49, 52, 57, 4); // Bar 30: A major
    pushStrum(13.0, 50, 54, 57, 62, 2); // Bar 31a: D major
    pushStrum(14.0, 52, 56, 59, 64, 2); // Bar 31b: E major
    lh.push(note(start + 15.0, finDur, 45, vel - 6), note(start + 15.0, finDur, 52, vel - 10), note(start + 15.0, finDur, 57, vel - 8), note(start + 15.0, finDur, 61, vel - 10));
    return start + 16.0;
  };
  b = pushSectionC(b, 100, false);
  b = pushSectionC(b, 104, true);

  const tracks: MidiWriteTrack[] = [
    { name: "Harpsichord Treble", channel: 0, program: 6, notes: cleanTrackNotes(rh) },
    { name: "Harpsichord Bass", channel: 1, program: 6, notes: cleanTrackNotes(lh) },
  ];

  return {
    file: "turkish-march-harpsichord.mid",
    title: "Turkish March",
    composer: "Wolfgang Amadeus Mozart",
    credit: "W. A. Mozart, Piano Sonata No. 11 K. 331 III, mm. 1-32 (Mutopia Project, public domain); harpsichord arrangement MIT",
    options: {
      format: 1,
      ticksPerQuarter: 480,
      tempos: [
        { beat: 0, bpm: 122 },
        { beat: bSecB, bpm: 124 },
        { beat: bSecC, bpm: 128 },
        { beat: b - 3.0, bpm: 112 },
      ],
      tracks,
      title: "Turkish March",
      timeSignature: [2, 4],
    },
  };
}

/** Score-verified opening ritornello pitches of Vivaldi's Spring (Op. 8 No. 1, RV 269, I, E major). */
export const SPRING_OPENING_MOTIF = [76, 80, 80, 80, 78, 76, 83, 83, 81, 80] as const;

/**
 * Antonio Vivaldi (1678-1741), Spring ("La Primavera"), Concerto No. 1 in E major, Op. 8 No. 1,
 * RV 269, I. Allegro (4/4 time, 1725, public domain).
 * Complete Opening Ritornello + Birdsong Episode ("Canto dè gl' Vcelli") + Tutti Return (Bars 1-31 beat 1,
 * ending cleanly on Vivaldi's real E-major Tutti cadence at Bar 31 beat 1), transcribed directly from Mutopia Project
 * (https://www.mutopiaproject.org/ftp/VivaldiA/O8/spring/spring-lys.zip: spring1.ly, spring1a.ly, spring1b.ly, spring1c.ly, spring1d.ly).
 * Pure E-major diatonic compass E2 (40) .. E6 (88) matching all 29 concert pedal harp strings 1-to-1.
 */
export function springConcertHarp(): MidiPiece {
  const treble: MidiWriteNote[] = []; // Violin Principale / Violin I melody & birdsong (program 46)
  const mid: MidiWriteNote[] = [];    // Violin II + Viola inner harmony & birdsong counterpoint (program 46)
  const bass: MidiWriteNote[] = [];   // Cello / Continuo bass strings (program 46)

  type Ev = readonly [number, number, number, number?]; // [beatOff, durBeats, pitch, velOff?]

  // Pickup (beat 0.0): E5 (0.50 beat) + Violin II B4 + Viola G#4 + Cello E3 (spring1a..d line 10)
  treble.push(note(0.0, 0.46, 76, 98));
  mid.push(note(0.0, 0.46, 71, 78), note(0.0, 0.46, 68, 72));
  bass.push(note(0.0, 0.46, 52, 82));

  // Helper: Ritornello Part 1 (Bars 1-3 Forte or Bars 4-6 Piano, 12 beats, exact spring1a/b/c/d!)
  const pushRitornelloPart1 = (b0: number, vel: number, isPianoEcho: boolean): number => {
    const bar12: readonly Ev[] = [
      [0.0, 0.46, 80, 6], [0.5, 0.46, 80, 4], [1.0, 0.46, 80, 6],
      [1.5, 0.23, 78, 2], [1.75, 0.23, 76, 2],
      [2.0, 1.44, 83, 10], [3.5, 0.23, 83, 4], [3.75, 0.23, 81, 3],
    ];
    const bar3: readonly Ev[] = isPianoEcho
      // Bar 6 exact spring1a.ly line 17: gis8 a16 b a8 gis | fis4 r8 e8
      ? [
          [0.0, 0.46, 80, 6], [0.5, 0.23, 81, 4], [0.75, 0.23, 83, 6],
          [1.0, 0.46, 81, 4], [1.5, 0.46, 80, 4],
          [2.0, 0.92, 78, 6], [3.5, 0.46, 76, 8],
        ]
      // Bar 3 exact spring1a.ly line 13: gis8 a16 b a8 gis | fis dis b e
      : [
          [0.0, 0.46, 80, 6], [0.5, 0.23, 81, 4], [0.75, 0.23, 83, 6],
          [1.0, 0.46, 81, 4], [1.5, 0.46, 80, 4],
          [2.0, 0.46, 78, 6], [2.5, 0.46, 75, 4], [3.0, 0.46, 71, 4], [3.5, 0.46, 76, 4],
        ];
    for (const [off, dur, p, dv = 0] of bar12) treble.push(note(b0 + off, dur, p, vel + dv));
    for (const [off, dur, p, dv = 0] of bar12) treble.push(note(b0 + 4 + off, dur, p, vel + dv));
    for (const [off, dur, p, dv = 0] of bar3) treble.push(note(b0 + 8 + off, dur, p, vel + dv));

    // Violin II + Viola + Cello (exact spring1b/c/d lines 11-16; chromatic cello passing ais kept diatonic A2->B2 for E-major pedal harp)
    for (const barOff of [0, 4]) {
      for (const beat of [0, 1, 2, 3]) bass.push(note(b0 + barOff + beat, 0.9, beat % 2 === 0 ? 40 : 52, vel - 14));
      for (const [off, dur, p] of [[0.0, 0.46, 76], [0.5, 0.46, 76], [1.0, 0.46, 76], [1.5, 0.46, 76], [2.0, 1.44, 80], [3.5, 0.23, 80], [3.75, 0.23, 78]] as const) {
        mid.push(note(b0 + barOff + off, dur, p - 12, vel - 20)); // Violin II down octave into mid harp strings
      }
      mid.push(note(b0 + barOff + 0.0, 0.9, 59, vel - 24), note(b0 + barOff + 2.0, 1.4, 64, vel - 24));
    }
    // Bar 3/6 bass & mid: e8 e8 a, a, | b4 r8 e8
    bass.push(note(b0 + 8.0, 0.46, 52, vel - 14), note(b0 + 8.5, 0.46, 52, vel - 16), note(b0 + 9.0, 0.9, 45, vel - 14), note(b0 + 10.0, 0.92, 47, vel - 12), note(b0 + 11.5, 0.46, 52, vel - 14));
    mid.push(note(b0 + 8.0, 0.46, 64, vel - 20), note(b0 + 8.5, 0.23, 66, vel - 22), note(b0 + 8.75, 0.23, 68, vel - 22), note(b0 + 9.0, 0.46, 66, vel - 20), note(b0 + 9.5, 0.46, 64, vel - 20), note(b0 + 10.0, 0.92, 63, vel - 18), note(b0 + 11.5, 0.46, 68, vel - 20));
    return b0 + 12;
  };

  // Helper: Ritornello Part 2 (3 bars = 12 beats + downbeat resolution e4, exact spring1a.ly lines 18-20 / 28-30!)
  // Bar A/B: b'8 a16 gis a8 b | cis b4 e,8
  // Bar C:   cis'8 b4 a8 | gis fis16 e fis4
  const pushRitornelloPart2 = (b0: number, vel: number, endMode: "echo-pickup" | "birdsong" | "final-cadence"): number => {
    const barAB: readonly Ev[] = [
      [0.0, 0.46, 83, 8], [0.5, 0.23, 81, 4], [0.75, 0.23, 80, 4],
      [1.0, 0.46, 81, 5], [1.5, 0.46, 83, 7],
      [2.0, 0.46, 85, 9], [2.5, 0.94, 83, 8], [3.5, 0.46, 76, 4],
    ];
    const barC: readonly Ev[] = [
      [0.0, 0.46, 85, 9], [0.5, 0.94, 83, 8], [1.5, 0.46, 81, 6],
      [2.0, 0.46, 80, 6], [2.5, 0.23, 78, 5], [2.75, 0.23, 76, 5], [3.0, 0.94, 78, 8],
    ];
    for (const [off, dur, p, dv = 0] of barAB) treble.push(note(b0 + off, dur, p, vel + dv));
    for (const [off, dur, p, dv = 0] of barAB) treble.push(note(b0 + 4 + off, dur, p, vel + dv));
    for (const [off, dur, p, dv = 0] of barC) treble.push(note(b0 + 8 + off, dur, p, vel + dv));

    for (const barOff of [0, 4]) {
      for (const beat of [0, 1, 2, 3]) bass.push(note(b0 + barOff + beat, 0.9, beat % 2 === 0 ? 40 : 52, vel - 14));
      for (const [off, dur, p] of [[0.0, 0.46, 68], [0.5, 0.23, 66], [0.75, 0.23, 64], [1.0, 0.46, 66], [1.5, 0.46, 68], [2.0, 0.46, 69], [2.5, 0.94, 68], [3.5, 0.46, 68]] as const) {
        mid.push(note(b0 + barOff + off, dur, p, vel - 20));
      }
    }
    // Bar C accompaniment (spring1b/d lines 19): e4 e8 b e e, b'' b,
    bass.push(note(b0 + 8.0, 0.9, 52, vel - 14), note(b0 + 9.0, 0.46, 52, vel - 16), note(b0 + 9.5, 0.46, 47, vel - 14), note(b0 + 10.0, 0.46, 52, vel - 14), note(b0 + 10.5, 0.46, 40, vel - 12), note(b0 + 11.0, 0.46, 59, vel - 14), note(b0 + 11.5, 0.46, 47, vel - 12));
    mid.push(note(b0 + 8.0, 0.46, 69, vel - 20), note(b0 + 8.5, 0.94, 68, vel - 20), note(b0 + 9.5, 0.46, 66, vel - 20), note(b0 + 10.0, 0.92, 64, vel - 18), note(b0 + 11.0, 0.92, 63, vel - 18));

    if (endMode === "echo-pickup") {
      // Bar 10 beat 0..2: e4 r8 e8 (exact spring1a.ly line 22!)
      treble.push(note(b0 + 12.0, 0.92, 76, vel + 4), note(b0 + 13.5, 0.46, 76, vel - 14));
      mid.push(note(b0 + 12.0, 0.92, 64, vel - 18), note(b0 + 13.5, 0.46, 68, vel - 24));
      bass.push(note(b0 + 12.0, 0.92, 40, vel - 12), note(b0 + 13.5, 0.46, 52, vel - 22));
      return b0 + 14; // Bar 10 beat 2 where Piano Part 2 begins!
    }
    if (endMode === "birdsong") {
      // Bar 13 beat 0..2: E5 cadence downbeat (e4 + rest) before Solo Birdsong enters halfway through the bar!
      treble.push(note(b0 + 12.0, 0.92, 76, vel + 2));
      mid.push(note(b0 + 12.0, 0.92, 64, vel - 18), note(b0 + 12.0, 0.92, 68, vel - 20));
      bass.push(note(b0 + 12.0, 0.92, 40, vel - 14));
      return b0 + 14; // Bar 13 beat 2 (half-bar) where mark B Solo Birdsong starts!
    }
    // Final real Tutti cadence on Bar 31 beat 0 (spring1a..d): rolled E-major concert-harp cadence!
    const finDur = 2.8;
    bass.push(note(b0 + 12.0, finDur, 40, 106), note(b0 + 12.12, finDur - 0.12, 52, 98), note(b0 + 12.24, finDur - 0.24, 59, 94));
    mid.push(note(b0 + 12.36, finDur - 0.36, 64, 92), note(b0 + 12.48, finDur - 0.48, 68, 90), note(b0 + 12.6, finDur - 0.6, 71, 92));
    treble.push(note(b0 + 12.0, finDur, 76, 108), note(b0 + 12.24, finDur - 0.24, 80, 102), note(b0 + 12.48, finDur - 0.48, 83, 104), note(b0 + 12.72, finDur - 0.72, 88, 108));
    return b0 + 12 + finDur;
  };

  // --- Opening Ritornello (Bars 1-13, beats 0.5 .. 54.5, exact spring1a.ly lines 10-27!) ---
  let b = 0.5;
  b = pushRitornelloPart1(b, 98, false);       // Bars 1-3 Forte
  b = pushRitornelloPart1(b, 76, true);        // Bars 4-6 Piano echo
  b = pushRitornelloPart2(b, 98, "echo-pickup"); // Bars 7-10a Forte
  b = pushRitornelloPart2(b, 78, "birdsong");    // Bars 10b-13 Piano echo -> lands at Bar 13 beat 2 (b = 52.5)

  // --- Episode 1: Birdsong ("Canto dè gl' Vcelli", Bars 13b-27, exact spring1.ly + spring1a.ly + spring1b.ly!) ---
  const bBird = b;
  // Bar 13b-16: Solo B5 repeated mordent chirps + Violin II G#5 trill + descending E6-D#6-C#6-B5-A5-G#5-F#5-E5 cascade!
  // Bar 13b (2 beats): Solo b4 b4 (B5) over Violin II r16 a gis a gis4
  treble.push(note(b + 0.0, 0.9, 83, 94), note(b + 1.0, 0.9, 83, 92));
  mid.push(note(b + 0.25, 0.22, 69, 72), note(b + 0.5, 0.22, 68, 70), note(b + 0.75, 0.22, 69, 72), note(b + 1.0, 0.85, 68, 74));
  b += 2.0;

  // Bar 14 (4 beats): Solo b4 b4 b4 b4 | Vln II a-gis-a-gis trills (spring1.ly line 27 & spring1b.ly line 26)
  for (const off of [0, 1, 2, 3]) treble.push(note(b + off, 0.85, 83, 94 - (off % 2) * 4));
  for (const half of [0, 2]) {
    mid.push(note(b + half + 0.25, 0.22, 69, 72), note(b + half + 0.5, 0.22, 68, 70), note(b + half + 0.75, 0.22, 69, 72), note(b + half + 1.0, 0.85, 68, 74));
  }
  b += 4.0;

  // Bar 15 (4 beats): Solo 8th-note chirps B5 x8 | Vln II descending 32nd birdsong flick B5-A5-G#5-F#5-E5 x2 (spring1b.ly line 27)
  for (let k = 0; k < 8; k++) treble.push(note(b + k * 0.5, 0.38, 83, 94 + (k % 2 === 0 ? 4 : -4)));
  for (const half of [0, 2]) {
    for (const [off, p] of [[0.5, 71], [0.65, 69], [0.8, 68], [0.95, 66], [1.1, 64]] as const) {
      mid.push(note(b + half + off, off === 1.1 ? 0.75 : 0.14, p, 78));
    }
  }
  b += 4.0;

  // Bar 16 (4 beats): Solo B5 x7 + C#6(16th) D#6(16th) (spring1.ly line 30)
  for (let k = 0; k < 7; k++) treble.push(note(b + k * 0.5, 0.38, 83, 96));
  treble.push(note(b + 3.5, 0.22, 85, 96), note(b + 3.75, 0.22, 87, 98));
  mid.push(note(b + 0.25, 0.22, 69, 72), note(b + 0.5, 0.22, 68, 70), note(b + 0.75, 0.22, 69, 72), note(b + 1.0, 0.85, 68, 74));
  mid.push(note(b + 2.25, 0.22, 69, 72), note(b + 2.5, 0.22, 68, 70), note(b + 2.75, 0.22, 69, 72), note(b + 3.0, 0.85, 68, 74));
  b += 4.0;

  // Bar 17 (4 beats): Solo descending E-major scale E6-D#6-C#6-B5-A5-G#5-F#5-E5 (spring1.ly line 31) + Vln II answer
  const birdScale = [88, 87, 85, 83, 81, 80, 78, 76];
  for (let k = 0; k < birdScale.length; k++) treble.push(note(b + k * 0.25, 0.22, birdScale[k], 100 - k));
  for (const [off, p] of [[2.5, 71], [2.65, 69], [2.8, 68], [2.95, 66], [3.1, 64]] as const) {
    mid.push(note(b + off, off === 3.1 ? 0.75 : 0.14, p, 82));
  }
  b += 4.0;

  // Bar 18-19 (8 beats): High E6 repeated chirps answering E5 trill (spring1.ly lines 33-35 & spring1b.ly lines 30-31)
  for (const half of [0, 2]) {
    for (const [off, p] of [[0.5, 71], [0.65, 69], [0.8, 68], [0.95, 66], [1.1, 64]] as const) {
      mid.push(note(b + half + off, off === 1.1 ? 0.75 : 0.14, p, 80));
    }
  }
  // Bar 19: r4 r8 e'8 e e e e | Bar 20: e,4. e'8 e e e e
  treble.push(note(b + 1.5, 0.42, 88, 98), note(b + 2.0, 0.42, 88, 96), note(b + 2.5, 0.42, 88, 96), note(b + 3.0, 0.42, 88, 96), note(b + 3.5, 0.42, 88, 98));
  b += 4.0;
  // Bar 20: E5 trill (E5-F#5-E5-F#5-E5) -> high E6 x5
  for (let k = 0; k < 6; k++) treble.push(note(b + k * 0.25, 0.22, k % 2 === 0 ? 76 : 78, 88));
  treble.push(note(b + 1.5, 0.42, 88, 100), note(b + 2.0, 0.42, 88, 98), note(b + 2.5, 0.42, 88, 98), note(b + 3.0, 0.42, 88, 98), note(b + 3.5, 0.42, 88, 100));
  for (let k = 0; k < 8; k++) mid.push(note(b + k * 0.5, 0.42, k % 2 === 0 ? 68 : 69, 72));
  b += 4.0;

  // Bar 21-23 (12 beats): Iconic birdsong oscillation b16(e) b(cis) (spring1.ly lines 36-38 & spring1a.ly lines 39-42)
  // Bar 21: E5 trill (2 beats) | B5(1.0) + B5-E6-B5-C#6
  for (let k = 0; k < 4; k++) treble.push(note(b + k * 0.25, 0.22, k % 2 === 0 ? 76 : 78, 86));
  treble.push(note(b + 2.0, 0.92, 83, 98), note(b + 3.0, 0.23, 83, 94), note(b + 3.25, 0.23, 88, 102), note(b + 3.5, 0.23, 83, 94), note(b + 3.75, 0.23, 85, 98));
  for (const off of [0, 1, 2, 3]) mid.push(note(b + off, 0.45, 68, 72), note(b + off + 0.5, 0.45, 69, 72));
  b += 4.0;
  // Bar 22: B5(1.0) + B5-E6-B5-C#6 | B5-E6-B5-C#6 x2
  treble.push(note(b + 0.0, 0.92, 83, 98), note(b + 1.0, 0.23, 83, 94), note(b + 1.25, 0.23, 88, 102), note(b + 1.5, 0.23, 83, 94), note(b + 1.75, 0.23, 85, 98));
  for (const off of [2.0, 3.0]) {
    treble.push(note(b + off, 0.23, 83, 96), note(b + off + 0.25, 0.23, 88, 104), note(b + off + 0.5, 0.23, 83, 96), note(b + off + 0.75, 0.23, 85, 100));
  }
  for (const off of [0.0, 1.0, 2.0, 3.0]) mid.push(note(b + off, 0.45, 64, 74), note(b + off + 0.5, 0.45, 71, 74));
  b += 4.0;
  // Bar 23: B5-E6-B5-C#6 x2 | B5(0.5) E5(0.5) G#5 trill(1.0)
  for (const off of [0.0, 1.0]) {
    treble.push(note(b + off, 0.23, 83, 96), note(b + off + 0.25, 0.23, 88, 104), note(b + off + 0.5, 0.23, 83, 96), note(b + off + 0.75, 0.23, 85, 100));
  }
  treble.push(note(b + 2.0, 0.46, 83, 96), note(b + 2.5, 0.46, 76, 94), note(b + 3.0, 0.23, 80, 96), note(b + 3.25, 0.23, 81, 92), note(b + 3.5, 0.23, 80, 96), note(b + 3.75, 0.23, 81, 92));
  mid.push(note(b + 0.0, 0.9, 64, 74), note(b + 1.0, 0.9, 71, 74), note(b + 2.0, 0.9, 64, 74), note(b + 3.0, 0.9, 68, 76));
  b += 4.0;

  // Bar 24-27 (12 beats -> Bar 27 beat 3.5 Tutti pickup E5!, exact spring1.ly lines 39-43):
  // High E6 paired chirps + E6 trills leading directly into Tutti Ritornello Return!
  // Bar 24: G#5 trills (b+1, b+3) over gentle E-major harp bass
  for (const off of [0.0, 2.0]) {
    treble.push(note(b + off + 1.0, 0.23, 80, 92), note(b + off + 1.25, 0.23, 81, 88), note(b + off + 1.5, 0.23, 80, 92), note(b + off + 1.75, 0.23, 81, 88));
    mid.push(note(b + off + 0.0, 0.9, 64, 72), note(b + off + 1.0, 0.9, 68, 72));
  }
  b += 4.0;
  // Bar 25: E6(1.0) E6(1.0) | E6 trill(2.0) (spring1.ly lines 41-42)
  treble.push(note(b + 0.0, 0.85, 88, 100), note(b + 1.0, 0.85, 88, 98));
  for (let k = 0; k < 8; k++) treble.push(note(b + 2.0 + k * 0.25, 0.22, k % 2 === 0 ? 88 : 87, 94));
  bass.push(note(b + 0.0, 1.8, 52, 76), note(b + 2.0, 1.8, 52, 76));
  mid.push(note(b + 0.0, 0.9, 68, 76), note(b + 1.0, 0.9, 71, 76), note(b + 2.0, 1.8, 68, 78));
  b += 4.0;
  // Bar 26-27a: E6(1.0) E6(1.0) | E6 trill(1.0) + rest(0.5) + Tutti pickup E5(0.5)! (spring1.ly lines 42-43)
  treble.push(note(b + 0.0, 0.85, 88, 102), note(b + 1.0, 0.85, 88, 100));
  for (let k = 0; k < 4; k++) treble.push(note(b + 2.0 + k * 0.25, 0.22, k % 2 === 0 ? 88 : 87, 96));
  treble.push(note(b + 3.5, 0.46, 76, 102)); // Tutti pickup E5!
  mid.push(note(b + 0.0, 0.9, 68, 78), note(b + 1.0, 0.9, 71, 78), note(b + 2.0, 0.9, 68, 78), note(b + 3.5, 0.46, 64, 82));
  bass.push(note(b + 0.0, 1.8, 52, 80), note(b + 2.0, 0.9, 52, 80), note(b + 3.5, 0.46, 52, 86));
  b += 4.0;

  // --- Bars 28-31a: Real Vivaldi Tutti Ritornello Return ending on real E-major Bar 31 beat 1 cadence! ---
  const bTutti = b;
  b = pushRitornelloPart2(b, 104, "final-cadence");

  const tracks: MidiWriteTrack[] = [
    { name: "Harp Treble Strings", channel: 0, program: 46, notes: cleanTrackNotes(treble) },
    { name: "Harp Mid Strings", channel: 1, program: 46, notes: cleanTrackNotes(mid) },
    { name: "Harp Bass Strings", channel: 2, program: 46, notes: cleanTrackNotes(bass) },
  ];

  return {
    file: "spring-concert-harp.mid",
    title: "Spring",
    composer: "Antonio Vivaldi",
    credit: "A. Vivaldi, The Four Seasons Op. 8 No. 1 RV 269 I, mm. 1-31 (Mutopia Project, public domain); concert pedal harp arrangement MIT",
    options: {
      format: 1,
      ticksPerQuarter: 480,
      tempos: [
        { beat: 0, bpm: 132 },
        { beat: bBird, bpm: 134 },
        { beat: bTutti, bpm: 132 },
        { beat: bTutti + 10.0, bpm: 112 },
        { beat: bTutti + 12.0, bpm: 92 },
      ],
      tracks,
      title: "Spring",
      timeSignature: [4, 4],
    },
  };
}

/**
 * Johann Sebastian Bach, Toccata in D Minor, BWV 565 — Opening (Bars 1-12a only).
 * Ends cleanly on Bach's authentic Bar 12 D-minor fermata pause (~24.6 s of music),
 * transcribed directly from Mutopia Project Bach-Gesellschaft Ausgabe 1867 (ToccataFugue.ly).
 */
export function toccataOpeningOrgan(): MidiPiece {
  const great: MidiWriteNote[] = [];
  const choir: MidiWriteNote[] = [];
  const pedal: MidiWriteNote[] = [];

  const pushTriplet = (b: number, p1: number, p2: number, p3: number, vel: number, doubleOctDown = true) => {
    const step = 1 / 6;
    const seq = [p1, p2, p3];
    for (let i = 0; i < 3; i++) {
      const p = seq[i];
      great.push(note(b + i * step, step * 0.92, p, vel + (i === 0 ? 4 : -2)));
      if (doubleOctDown && p - 12 >= 38) {
        choir.push(note(b + i * step, step * 0.92, p - 12, vel - 8));
      }
    }
  };

  let b = 0;
  const pushFl1 = (start: number, hi: number, doubleOct: boolean, vel: number): number => {
    const evs: readonly [number, number, number][] = [
      [0.0, 0.14, hi],
      [0.16, 0.14, hi - 2],
      [0.32, 0.92, hi],
      [1.36, 0.2, hi - 2],
      [1.58, 0.2, hi - 4],
      [1.8, 0.2, hi - 5],
      [2.02, 0.2, hi - 7],
      [2.24, 0.3, hi - 8],
      [2.58, 1.05, hi - 7],
    ];
    for (const [off, dur, p] of evs) {
      (hi >= 69 ? great : choir).push(note(start + off, dur, p, vel));
      if (doubleOct && p - 12 >= 38) {
        (p - 12 >= 50 ? choir : pedal).push(note(start + off, dur, p - 12, vel - 6));
      }
    }
    return start + 3.85;
  };
  b = pushFl1(b, 81, true, 108);

  const fl2: readonly [number, number, number][] = [
    [0.0, 0.14, 69],
    [0.16, 0.14, 67],
    [0.32, 0.85, 69],
    [1.28, 0.2, 64],
    [1.5, 0.2, 65],
    [1.72, 0.3, 61],
    [2.06, 1.05, 62],
  ];
  for (const [off, dur, p] of fl2) {
    great.push(note(b + off, dur, p, 104));
    choir.push(note(b + off, dur, p - 12, 98));
  }
  b += 3.35;

  b = pushFl1(b, 57, false, 100);

  const bPedal = b;
  pedal.push(note(bPedal, 5.4, 38, 108));
  const dimChord: readonly [number, number, number][] = [
    [0.15, 2.35, 49],
    [0.45, 2.05, 52],
    [0.75, 1.75, 55],
    [1.05, 1.45, 58],
    [1.35, 1.15, 61],
    [1.65, 0.85, 64],
  ];
  for (const [off, dur, p] of dimChord) {
    (p >= 58 ? great : choir).push(note(bPedal + off, dur, p, 96));
  }
  const bRes = bPedal + 2.6;
  choir.push(note(bRes, 2.6, 50, 96));
  choir.push(note(bRes, 2.6, 57, 94));
  great.push(note(bRes, 2.6, 62, 100));
  great.push(note(bRes, 2.6, 69, 98));
  great.push(note(bRes, 2.6, 74, 104));
  choir.push(note(bRes, 0.28, 67, 96));
  choir.push(note(bRes + 0.3, 0.28, 64, 94));
  choir.push(note(bRes + 0.6, 2.0, 66, 100));

  b = bRes + 3.0;
  const bPrestissimo = b;
  great.push(note(b, 0.22, 61, 96));
  choir.push(note(b, 0.22, 49, 88));
  b += 0.25;

  for (let k = 0; k < 3; k++) { pushTriplet(b, 62, 64, 61, 96); b += 0.5; }
  great.push(note(b, 0.23, 62, 96), note(b + 0.25, 0.23, 64, 96));
  choir.push(note(b, 0.23, 50, 88), note(b + 0.25, 0.23, 52, 88));
  b += 0.5;
  for (let k = 0; k < 3; k++) { pushTriplet(b, 65, 67, 64, 98); b += 0.5; }
  great.push(note(b, 0.23, 65, 98), note(b + 0.25, 0.23, 67, 98));
  choir.push(note(b, 0.23, 53, 90), note(b + 0.25, 0.23, 55, 90));
  b += 0.5;

  for (let k = 0; k < 3; k++) { pushTriplet(b, 69, 70, 67, 100); b += 0.5; }
  great.push(note(b, 0.65, 69, 104));
  choir.push(note(b, 0.65, 57, 96));
  b += 1.25;
  great.push(note(b, 0.22, 73, 98));
  choir.push(note(b, 0.22, 61, 90));
  b += 0.25;

  for (let k = 0; k < 3; k++) { pushTriplet(b, 74, 76, 73, 100); b += 0.5; }
  great.push(note(b, 0.23, 74, 100), note(b + 0.25, 0.23, 76, 100));
  choir.push(note(b, 0.23, 62, 92), note(b + 0.25, 0.23, 64, 92));
  b += 0.5;
  for (let k = 0; k < 3; k++) { pushTriplet(b, 77, 79, 76, 102); b += 0.5; }
  great.push(note(b, 0.23, 77, 102), note(b + 0.25, 0.23, 79, 102));
  choir.push(note(b, 0.23, 65, 94), note(b + 0.25, 0.23, 67, 94));
  b += 0.5;

  for (let k = 0; k < 3; k++) { pushTriplet(b, 81, 82, 79, 104); b += 0.5; }
  great.push(note(b, 0.65, 81, 108));
  choir.push(note(b, 0.65, 69, 98));
  b += 1.25;
  great.push(note(b, 0.22, 81, 102));
  choir.push(note(b, 0.22, 69, 94));
  b += 0.25;

  const fallChain: readonly [number, number, number][] = [
    [79, 82, 76], [77, 81, 74], [76, 79, 72], [74, 77, 70], [72, 76, 69],
    [70, 74, 67], [69, 72, 65], [67, 70, 64], [65, 69, 62], [64, 67, 61],
  ];
  for (const [p1, p2, p3] of fallChain) {
    pushTriplet(b, p1, p2, p3, 100); b += 0.5;
    pushTriplet(b, p1, p2, p3, 96); b += 0.5;
  }

  b += 0.5;
  pedal.push(note(b, 4.4, 38, 108));
  choir.push(note(b, 3.0, 49, 92), note(b, 3.0, 52, 92), note(b, 3.0, 55, 92), note(b, 3.0, 58, 92));
  great.push(note(b, 1.4, 61, 94), note(b, 1.4, 64, 94), note(b, 1.4, 67, 94), note(b, 1.4, 70, 98));
  b += 1.5;
  const bar11Run: readonly [number, number][] = [
    [70, 0.2], [69, 0.16], [67, 0.16], [65, 0.16], [64, 0.16], [62, 0.16], [61, 0.16], [59, 0.16],
    [61, 0.2], [57, 0.2], [61, 0.2], [64, 0.16], [67, 0.16], [65, 0.35], [64, 0.22],
  ];
  for (const [p, d] of bar11Run) {
    great.push(note(b, d * 0.92, p, 98));
    b += d;
  }

  // Bar 12 beat 0: Authentic D MINOR fermata pause — clean ending cadence!
  const bCadence = b;
  pedal.push(note(bCadence, 2.2, 38, 108)); // D2
  choir.push(note(bCadence, 2.2, 50, 96), note(bCadence, 2.2, 57, 94)); // D3 + A3
  great.push(note(bCadence, 2.2, 62, 102), note(bCadence, 2.2, 65, 106)); // D4 + F4 (D minor!)

  const tracks: MidiWriteTrack[] = [
    { name: "Great Manual Pipes", channel: 0, program: 19, notes: cleanTrackNotes(great) },
    { name: "Choir Manual Pipes", channel: 1, program: 19, notes: cleanTrackNotes(choir) },
    { name: "Pedal Tower Pipes", channel: 2, program: 19, notes: cleanTrackNotes(pedal) },
  ];

  return {
    file: "toccata-opening-organ.mid",
    title: "Toccata in D Minor",
    composer: "Johann Sebastian Bach",
    credit: "J. S. Bach, Toccata in D Minor BWV 565, mm. 1-12a (Mutopia / Bach-Gesellschaft 1867, public domain); tracker organ arrangement MIT",
    options: {
      format: 1,
      ticksPerQuarter: 480,
      tempos: [
        { beat: 0, bpm: 86 },
        { beat: bPrestissimo, bpm: 138 },
        { beat: bCadence, bpm: 92 },
      ],
      tracks,
      title: "Toccata in D Minor",
      timeSignature: [4, 4],
    },
  };
}

/** Built-in pieces for public/midi/ and WAV generation. */
export function builtInPieces(): MidiPiece[] {
  return [
    flightOfTheBumblebee(),
    canonInDFiveVoices(),
    furEliseMusicBox(),
    mughamNocturne(),
    bakuNights(),
    arshinMalAlan(),
    minuetInGMarimba(),
    odeToJoyCarillon(),
    toccataInDMinorOrgan(),
    toccataOpeningOrgan(),
    sugarPlumKalimba(),
    turkishMarchHarpsichord(),
    springConcertHarp(),
  ];
}

export function pieceBytes(piece: MidiPiece): Uint8Array {
  return writeMidi(piece.options);
}
