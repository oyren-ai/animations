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

function note(beat: number, durationBeats: number, pitch: number, velocity: number): MidiWriteNote {
  return { beat, durationBeats, pitch, velocity: clampVelocity(velocity) };
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
// A. Nikolai Rimsky-Korsakov — Flight of the Bumblebee (Act III, The Tale of Tsar Saltan, 2/4)
// ===================================================================================================

/** Opening chromatic plunge from E6 (88) down two octaves to E4 (64) and onto A4 (69). */
export const BUMBLEBEE_INTRO_BARS: readonly (readonly number[])[] = [
  // Bar 0: beat 1 = dramatic E6 strike (4 sixteenths = 1 beat), beat 2 = E6 D#6 D6 C#6
  [88, 87, 86, 85], // starts at beat 1.0 of bar 0
  [84, 83, 82, 81, 80, 79, 78, 77], // Bar 1: C6..F5
  [76, 79, 78, 77, 76, 75, 74, 73], // Bar 2: E5 turn + E5..C#5
  [72, 71, 70, 69, 68, 67, 66, 65], // Bar 3: C5..F4
  [64, 67, 66, 65, 64, 67, 66, 65], // Bar 4: E4 turn twice
  [64, 65, 66, 67, 68, 69, 70, 68], // Bar 5: chromatic climb into A4 (69)
];

/** Two-bar (16-sixteenth) main buzzing wave starting on a given root (69 = A4): climbs to +5, leaps to +8, descends. */
export function bumblebeeWave16(root: number): number[] {
  return [
    root, root + 1, root + 2, root + 3,
    root + 4, root + 5, root + 8, root + 7,
    root + 6, root + 5, root + 4, root + 3,
    root + 2, root + 1, root, root - 1,
  ];
}

/** One-bar (8-sixteenth) tight neighbour buzz around a given root: root, +1, 0, -1, 0, +3, +2, +1. */
export function bumblebeeBuzz8(root: number): number[] {
  return [root, root + 1, root, root - 1, root, root + 3, root + 2, root + 1];
}

/** Four-stage accelerando from 136 BPM to 212 BPM so "notes per second" visibly climbs to the finale. */
export const BUMBLEBEE_TEMPOS: readonly MidiTempo[] = [
  { beat: 0, bpm: 136 },   // Stage 1: crisp, clear opening plunge & A-minor theme (~10.5 notes/s)
  { beat: 36, bpm: 158 },  // Stage 2: dominant storm & horn stabs (~13.5 notes/s)
  { beat: 64, bpm: 180 },  // Stage 3: sequential chromatic climb (~16.5 notes/s)
  { beat: 92, bpm: 202 },  // Stage 4: payoff reprise (~20 notes/s)
  { beat: 108, bpm: 212 }, // Finale: 3-octave chromatic rocket (~22+ notes/s)
];

function flightOfTheBumblebee(): MidiPiece {
  const lead: MidiWriteNote[] = [];
  const left: MidiWriteNote[] = [];
  const sparkle: MidiWriteNote[] = [];

  const pushSixteenths = (startBeat: number, pitches: readonly number[], baseVel: number, octaveDouble = false) => {
    for (let i = 0; i < pitches.length; i++) {
      const b = startBeat + i * 0.25;
      const accent = i % 8 === 0 ? 10 : i % 4 === 0 ? 6 : 0;
      const v = baseVel + accent;
      lead.push(note(b, 0.22, pitches[i], v));
      if (octaveDouble && pitches[i] + 12 <= 96) {
        sparkle.push(note(b, 0.20, pitches[i] + 12, v - 16));
      }
    }
  };

  const pushOomPahBar = (barIndex: number, bassPitch: number, chordTriad: readonly number[], vel: number, dense = false) => {
    const b0 = barIndex * 2;
    // Beat 1 & Beat 2 eighth-note oom-pah: bass on 0 and 1.0, crisp staccato triad on 0.5 and 1.5
    left.push(note(b0, 0.42, bassPitch, vel + 6));
    for (const p of chordTriad) left.push(note(b0 + 0.5, 0.34, p, vel - 6));
    left.push(note(b0 + 1.0, 0.42, dense ? bassPitch + 12 : bassPitch, vel + 2));
    for (const p of chordTriad) left.push(note(b0 + 1.5, 0.34, p, vel - 8));
  };

  // --- Stage 1: Bars 0..17 (Beats 0..36) ---
  // Bar 0 opening fortissimo E octave stab + high E6 launch
  left.push(note(0, 0.85, 52, 108));
  left.push(note(0, 0.85, 64, 104));
  lead.push(note(0, 0.85, 88, 112));
  pushSixteenths(1.0, BUMBLEBEE_INTRO_BARS[0], 96);
  for (let b = 1; b <= 5; b++) {
    pushSixteenths(b * 2, BUMBLEBEE_INTRO_BARS[b], 92 - (b === 4 ? 6 : 0) + (b === 5 ? 6 : 0));
    if (b >= 2) {
      left.push(note(b * 2, 0.38, 52, 74));
      left.push(note(b * 2 + 1, 0.38, 52, 68));
    }
  }

  const AM_TRIAD = [57, 60, 64]; // A3 C4 E4
  const DM_TRIAD = [57, 62, 65]; // A3 D4 F4
  const E7_TRIAD = [56, 62, 64]; // G#3 D4 E4
  const C_TRIAD = [55, 60, 64];  // G3 C4 E4
  const F_TRIAD = [57, 60, 65];  // A3 C4 F4

  // Bars 6..13: Main A-minor theme
  pushSixteenths(12, bumblebeeWave16(69), 86);
  pushOomPahBar(6, 45, AM_TRIAD, 74);
  pushOomPahBar(7, 50, DM_TRIAD, 76);

  pushSixteenths(16, bumblebeeBuzz8(69), 84);
  pushOomPahBar(8, 45, AM_TRIAD, 72);
  pushSixteenths(18, bumblebeeBuzz8(69), 86);
  pushOomPahBar(9, 52, E7_TRIAD, 74);

  pushSixteenths(20, bumblebeeWave16(69), 88);
  pushOomPahBar(10, 45, AM_TRIAD, 76);
  pushOomPahBar(11, 50, DM_TRIAD, 78);

  pushSixteenths(24, bumblebeeBuzz8(69), 88);
  pushOomPahBar(12, 45, AM_TRIAD, 76);
  // Bar 13: chromatic bridge up to D5 (74)
  pushSixteenths(26, [69, 70, 71, 72, 71, 72, 73, 75], 90);
  pushOomPahBar(13, 45, [55, 61, 64], 78); // A7 -> Dm

  // Bars 14..17: D-minor subdominant answer
  pushSixteenths(28, bumblebeeWave16(74), 90);
  pushOomPahBar(14, 50, DM_TRIAD, 80);
  pushOomPahBar(15, 43, [55, 58, 62], 80); // Gm
  pushSixteenths(32, bumblebeeBuzz8(74), 88);
  pushOomPahBar(16, 50, DM_TRIAD, 78);
  pushSixteenths(34, [74, 75, 74, 73, 74, 75, 76, 75], 92);
  pushOomPahBar(17, 45, E7_TRIAD, 80);

  // --- Stage 2: Bars 18..31 (Beats 36..64) — Dominant storm & brass horn motif ---
  // Bars 18..21: E5 buzz with horn counter-motif (E4 - F4 - E4 - D#4 - E4)
  for (let k = 0; k < 4; k++) {
    const bar = 18 + k;
    const seq = k % 2 === 0 ? bumblebeeBuzz8(76) : [76, 77, 78, 79, 80, 79, 78, 77];
    pushSixteenths(bar * 2, seq, 92 + k);
    pushOomPahBar(bar, 52, E7_TRIAD, 80, true);
  }
  // Horn punctuation stabs in sparkle/marimba + mid-piano
  for (const [hb, hp] of [[36, 64], [36.5, 65], [37, 64], [37.5, 63], [38, 64], [40, 64], [40.5, 65], [41, 64], [41.5, 63], [42, 64]] as const) {
    sparkle.push(note(hb, 0.40, hp + 12, 86));
  }
  // Bars 22..25: A4/E5 interplay with A - Bb - A - G# - A horn motif
  pushSixteenths(44, bumblebeeWave16(69), 94);
  pushOomPahBar(22, 45, AM_TRIAD, 82, true);
  pushOomPahBar(23, 50, DM_TRIAD, 82, true);
  pushSixteenths(48, bumblebeeWave16(76), 95);
  pushOomPahBar(24, 52, E7_TRIAD, 84, true);
  pushOomPahBar(25, 45, AM_TRIAD, 84, true);
  for (const [hb, hp] of [[44, 69], [44.5, 70], [45, 69], [45.5, 68], [46, 69]] as const) {
    sparkle.push(note(hb, 0.40, hp + 12, 88));
  }
  // Bars 26..31: Modulation to C major / F major
  pushSixteenths(52, [69, 70, 71, 72, 73, 74, 73, 71], 94);
  pushOomPahBar(26, 43, [55, 59, 62], 82); // G7
  pushSixteenths(54, bumblebeeBuzz8(72), 95);
  pushOomPahBar(27, 48, C_TRIAD, 84);
  pushSixteenths(56, bumblebeeWave16(72), 96);
  pushOomPahBar(28, 48, C_TRIAD, 84, true);
  pushOomPahBar(29, 41, F_TRIAD, 86, true);
  pushSixteenths(60, bumblebeeBuzz8(72), 96);
  pushOomPahBar(30, 48, C_TRIAD, 84);
  pushSixteenths(62, [72, 71, 72, 73, 74, 75, 76, 73], 98);
  pushOomPahBar(31, 45, [55, 61, 64], 86);

  // --- Stage 3: Bars 32..45 (Beats 64..92) — Sequential Chromatic Climb ---
  const climbSteps: Array<[number, number, readonly number[]]> = [
    [74, 50, DM_TRIAD], // Bars 32-33: D5
    [76, 52, E7_TRIAD], // Bars 34-35: E5
    [77, 41, F_TRIAD],  // Bars 36-37: F5
    [79, 43, [55, 59, 62]], // Bars 38-39: G5
    [81, 45, AM_TRIAD], // Bars 40-41: A5
  ];
  climbSteps.forEach(([root, bass, triad], idx) => {
    const bar = 32 + idx * 2;
    pushSixteenths(bar * 2, bumblebeeWave16(root), 96 + idx * 2, idx >= 2);
    pushOomPahBar(bar, bass, triad, 84 + idx * 2, true);
    pushOomPahBar(bar + 1, bass, triad, 86 + idx * 2, true);
  });
  // Bars 42..45: Swirling descent and springboard on E7 into the Payoff!
  pushSixteenths(84, [81, 80, 79, 78, 77, 76, 75, 74], 102, true);
  pushOomPahBar(42, 52, E7_TRIAD, 88, true);
  pushSixteenths(86, [76, 79, 78, 77, 76, 75, 74, 73], 102, true);
  pushOomPahBar(43, 52, E7_TRIAD, 88, true);
  pushSixteenths(88, [76, 77, 76, 75, 76, 79, 78, 77], 104, true);
  pushOomPahBar(44, 52, E7_TRIAD, 90, true);
  pushSixteenths(90, [76, 77, 78, 79, 80, 81, 82, 80], 106, true);
  pushOomPahBar(45, 52, E7_TRIAD, 92, true);

  // --- Stage 4: Bars 46..63 (Beats 92..128) — PAYOFF REPRISE & 3-OCTAVE FINALE ROCKET ---
  // High-octave blazing A-minor reprise (A5 = 81!) with shimmering octave sparkle
  pushSixteenths(92, bumblebeeWave16(81), 106, true);
  pushOomPahBar(46, 45, AM_TRIAD, 92, true);
  pushOomPahBar(47, 50, DM_TRIAD, 94, true);

  pushSixteenths(96, bumblebeeBuzz8(81), 106, true);
  pushOomPahBar(48, 45, AM_TRIAD, 92, true);
  pushSixteenths(98, bumblebeeBuzz8(81), 108, true);
  pushOomPahBar(49, 52, E7_TRIAD, 94, true);

  pushSixteenths(100, bumblebeeWave16(81), 108, true);
  pushOomPahBar(50, 45, AM_TRIAD, 94, true);
  pushOomPahBar(51, 50, DM_TRIAD, 96, true);

  // Plunge to A3 (57) and launch the iconic 3-octave chromatic rocket (57..93 = A3..A6, 36 sixteenths + cadence!)
  pushSixteenths(104, [81, 80, 79, 78, 77, 76, 75, 74], 106);
  pushOomPahBar(52, 45, AM_TRIAD, 90, true);
  pushSixteenths(106, [73, 72, 71, 70, 69, 68, 67, 66], 104);
  pushOomPahBar(53, 52, E7_TRIAD, 90, true);
  pushSixteenths(108, [65, 64, 63, 62, 61, 60, 59, 58], 104);
  pushOomPahBar(54, 45, AM_TRIAD, 90, true);

  // Bars 55..59 (Beats 110..120 = 40 sixteenths): Unbroken 3-octave chromatic rocket A3 (57) -> A6 (93)!
  const rocket: number[] = [57, 58, 57, 56]; // 4-note launch coil around A3
  for (let p = 57; p <= 92; p++) rocket.push(p); // 36 chromatic steps straight up!
  pushSixteenths(110, rocket, 110, true);
  for (let bar = 55; bar <= 59; bar++) {
    pushOomPahBar(bar, bar % 2 === 0 ? 52 : 45, bar % 2 === 0 ? E7_TRIAD : AM_TRIAD, 94 + (bar - 55) * 2, true);
  }

  // Bar 60..61 (Beats 120..124): Peak A6 (93) snap + classical Tsar Saltan E5 -> A5 pizzicato/staccato cadence!
  lead.push(note(120, 0.45, 93, 122)); // High A6!
  sparkle.push(note(120, 0.45, 81, 114));
  left.push(note(120, 0.45, 45, 112));
  left.push(note(120, 0.45, 57, 108));

  // Dramatic beat 121: E5 (76) + E6 (88) dominant punctuation
  lead.push(note(121, 0.45, 88, 116));
  sparkle.push(note(121, 0.45, 76, 108));
  left.push(note(121, 0.45, 52, 110));
  left.push(note(121, 0.45, 64, 106));

  // Final tonic snap at beat 122: crisp A minor chord across the keyboard!
  lead.push(note(122, 1.3, 81, 124));
  sparkle.push(note(122, 1.1, 93, 110));
  for (const [i, p] of [45, 52, 57, 60, 64, 69].entries()) {
    left.push(note(122 + i * 0.02, 1.3, p, 116 - i * 3));
  }

  const tracks: MidiWriteTrack[] = [
    { name: "Bumblebee Lead", channel: 0, program: 0, notes: cleanTrackNotes(lead) },
    { name: "Piano Stride", channel: 1, program: 0, notes: cleanTrackNotes(left) },
    { name: "Xylophone Sparkle", channel: 2, program: 12, notes: cleanTrackNotes(sparkle) },
  ];

  return {
    file: "flight-of-the-bumblebee.mid",
    title: "Flight of the Bumblebee",
    composer: "Nikolai Rimsky-Korsakov",
    credit: "Rimsky-Korsakov (public domain), 4-stage accelerando arrangement",
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

/** Built-in pieces in scene order: Flight of the Bumblebee, Canon in D (five voices), Für Elise (music box). */
export function builtInPieces(): MidiPiece[] {
  return [flightOfTheBumblebee(), canonInDFiveVoices(), furEliseMusicBox()];
}

export function pieceBytes(piece: MidiPiece): Uint8Array {
  return writeMidi(piece.options);
}
