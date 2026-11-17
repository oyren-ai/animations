import { writeMidi, type MidiWriteNote, type MidiWriteOptions, type MidiWriteTrack } from "./write.ts";

/**
 * The three pieces shipped with the MIDI scenes, authored here as note data and written to
 * public/midi/*.mid by scripts/generate-midi-assets.ts. Two are public-domain compositions transcribed by
 * hand (Beethoven's "Ode to Joy" theme, Pachelbel's Canon ground bass and canon line); the third is an
 * original generative phasing piece. No recordings, soundfonts or downloads are involved.
 */

export interface MidiPiece {
  /** File name inside public/midi. */
  file: string;
  title: string;
  /** Short credit line, for example "Beethoven (public domain)". */
  credit: string;
  options: MidiWriteOptions;
}

const clampVelocity = (value: number) => Math.max(1, Math.min(127, Math.round(value)));

function note(beat: number, durationBeats: number, pitch: number, velocity: number): MidiWriteNote {
  return { beat, durationBeats, pitch, velocity: clampVelocity(velocity) };
}

// ---------------------------------------------------------------------------------------------------
// A. Beethoven, Symphony No. 9, finale: the "Ode to Joy" theme in D major, with an oom-pah left hand.
// ---------------------------------------------------------------------------------------------------

/** Melody as [MIDI pitch, beats] per bar of 4/4 (D major: D4 = 62, F#4 = 66, A4 = 69, A3 = 57). */
export const ODE_MELODY: readonly (readonly [number, number][])[] = [
  [[66, 1], [66, 1], [67, 1], [69, 1]],
  [[69, 1], [67, 1], [66, 1], [64, 1]],
  [[62, 1], [62, 1], [64, 1], [66, 1]],
  [[66, 1.5], [64, 0.5], [64, 2]],
  [[66, 1], [66, 1], [67, 1], [69, 1]],
  [[69, 1], [67, 1], [66, 1], [64, 1]],
  [[62, 1], [62, 1], [64, 1], [66, 1]],
  [[64, 1.5], [62, 0.5], [62, 2]],
  [[64, 1], [64, 1], [66, 1], [62, 1]],
  [[64, 1], [66, 0.5], [67, 0.5], [66, 1], [62, 1]],
  [[64, 1], [66, 0.5], [67, 0.5], [66, 1], [64, 1]],
  [[62, 1], [64, 1], [57, 2]],
  [[66, 1], [66, 1], [67, 1], [69, 1]],
  [[69, 1], [67, 1], [66, 1], [64, 1]],
  [[62, 1], [62, 1], [64, 1], [66, 1]],
  [[64, 1.5], [62, 0.5], [62, 2]],
];

type OdeChord = "D" | "A" | "A7";
const D: OdeChord = "D", A: OdeChord = "A", A7: OdeChord = "A7";
/** Harmony per beat for each of the 16 bars. */
const ODE_CHORDS: readonly (readonly OdeChord[])[] = [
  [D, D, D, D], [A7, A7, A7, A7], [D, D, D, D], [D, D, A, A],
  [D, D, D, D], [A7, A7, A7, A7], [D, D, D, D], [A, A, D, D],
  [A, A, D, D], [A7, A7, D, D], [A7, A7, A7, A7], [D, A, A, A],
  [D, D, D, D], [A7, A7, A7, A7], [D, D, D, D], [A, A, D, D],
];
const ODE_ROOT: Record<OdeChord, number> = { D: 50, A: 45, A7: 45 }; // D3, A2
const ODE_FIFTH: Record<OdeChord, number> = { D: 45, A: 52, A7: 52 }; // A2 (below), E3
const ODE_TRIAD: Record<OdeChord, readonly number[]> = { D: [54, 57, 62], A: [57, 61, 64], A7: [55, 61, 64] }; // upper chord tones
const ODE_TEMPOS = [{ beat: 0, bpm: 108 }, { beat: 56, bpm: 104 }, { beat: 60, bpm: 98 }, { beat: 62, bpm: 90 }, { beat: 63, bpm: 80 }, { beat: 64, bpm: 60 }];

function odeToJoy(): MidiPiece {
  const melody: MidiWriteNote[] = [];
  const left: MidiWriteNote[] = [];
  ODE_MELODY.forEach((bar, barIndex) => {
    const section = Math.floor(barIndex / 4); // 0 melody alone, 1 + bass, 2 + chords, 3 full
    let beat = barIndex * 4;
    for (const [pitch, length] of bar) {
      const downbeat = Math.abs(beat - barIndex * 4) < 1e-9;
      const loudness = [66, 72, 80, 92][section] + (downbeat ? 6 : 0) + (barIndex % 4 === 3 ? -4 : 0) + Math.min(8, barIndex % 4 * 2);
      const gate = barIndex === 15 && length === 2 ? 1 : 0.92;
      melody.push(note(beat, Math.max(0.2, length * gate), pitch, loudness));
      if (section === 3) melody.push(note(beat, Math.max(0.2, length * gate), pitch + 12, loudness - 18));
      beat += length;
    }
    for (let b = 0; b < 4; b++) {
      const chord = ODE_CHORDS[barIndex][b];
      const start = barIndex * 4 + b;
      // Oom-pah: bass on beats 1 and 3 (ending before the next bass note), chord tones on beats 2 and 4;
      // in the last section the chord is struck on every beat. No pitch ever overlaps itself.
      if (b % 2 === 0 && section >= 1) {
        // Root on beat 1; on beat 3 the root of a new chord, otherwise the fifth (so cadences land on the root).
        const pitch = b === 0 || chord !== ODE_CHORDS[barIndex][0] ? ODE_ROOT[chord] : ODE_FIFTH[chord];
        left.push(note(start, b === 0 ? 1.9 : 0.95, pitch, [0, 56, 64, 82][section] + (b === 0 ? 4 : 0)));
      }
      if (section === 3 || (section === 2 && b % 2 === 1)) {
        for (const pitch of ODE_TRIAD[chord]) left.push(note(start, 0.85, pitch, section === 2 ? 52 : b === 0 ? 72 : b === 2 ? 66 : 60));
      }
    }
  });
  // Final D major chord, rolled from the bottom and held.
  const finale = [50, 57, 62, 66, 69, 74, 78];
  finale.forEach((pitch, i) => (i < 3 ? left : melody).push(note(64 + i * 0.045, 3.2, pitch, 108 - i * 3)));
  const tracks: MidiWriteTrack[] = [
    { name: "Melody", channel: 0, program: 0, notes: melody },
    { name: "Left hand", channel: 1, program: 0, notes: left },
  ];
  return {
    file: "ode-to-joy.mid", title: "Ode to Joy", credit: "Beethoven (public domain), transcribed by hand",
    options: { format: 1, ticksPerQuarter: 480, tempos: ODE_TEMPOS, tracks, title: "Ode to Joy" },
  };
}

// ---------------------------------------------------------------------------------------------------
// B. Pachelbel, Canon in D: the eight-chord ground bass, arpeggios and the three-voice canon line.
// ---------------------------------------------------------------------------------------------------

/** Chords D A Bm F#m G D G A, two beats each, with the ground-bass note and four chord tones above it. */
export const CANON_CHORDS: readonly { name: string; bass: number; up: readonly number[] }[] = [
  { name: "D", bass: 50, up: [62, 66, 69, 74] },
  { name: "A", bass: 45, up: [64, 69, 73, 76] },
  { name: "Bm", bass: 47, up: [62, 66, 71, 74] },
  { name: "F#m", bass: 42, up: [61, 66, 69, 73] },
  { name: "G", bass: 43, up: [62, 67, 71, 74] },
  { name: "D", bass: 38, up: [62, 66, 69, 74] },
  { name: "G", bass: 43, up: [62, 67, 71, 74] },
  { name: "A", bass: 45, up: [61, 64, 69, 73] },
];
/** The canon line, one half note per chord: F#5 E5 D5 C#5 B4 A4 B4 C#5. */
export const CANON_LINE = [78, 76, 74, 73, 71, 69, 71, 73] as const;
const CANON_SIXTEENTHS = [0, 1, 2, 3, 2, 1, 2, 3] as const;
const CANON_TEMPOS = [{ beat: 0, bpm: 84 }, { beat: 60, bpm: 76 }, { beat: 62, bpm: 68 }, { beat: 63, bpm: 60 }, { beat: 64, bpm: 54 }];

function canonInD(): MidiPiece {
  const bass: MidiWriteNote[] = [], arpeggio: MidiWriteNote[] = [];
  const voice1: MidiWriteNote[] = [], voice2: MidiWriteNote[] = [], voice3: MidiWriteNote[] = [];
  const chords = 32; // four trips round the ground bass
  for (let c = 0; c < chords; c++) {
    const chord = CANON_CHORDS[c % 8];
    const start = c * 2, cycle = Math.floor(c / 8), swell = c / chords;
    bass.push(note(start, 1.95, chord.bass, 56 + swell * 22));
    if (cycle === 3) bass.push(note(start, 1.9, chord.bass + 12, 52));
    if (c >= 2 && c < 8) {
      [0, 2].forEach((index, i) => arpeggio.push(note(start + i, 0.95, chord.up[index], 46 + i * 3)));
    } else if (c >= 8 && c < 16) {
      for (let i = 0; i < 4; i++) arpeggio.push(note(start + i * 0.5, 0.48, chord.up[i], 54 + (i === 0 ? 8 : 0) + (c - 8) * 0.5));
    } else if (c >= 16) {
      for (let i = 0; i < 8; i++) {
        arpeggio.push(note(start + i * 0.25, 0.24, chord.up[CANON_SIXTEENTHS[i]], 56 + (i % 4 === 0 ? 9 : 0) + (c - 16) * 0.7));
      }
    }
    // The canon line enters in imitation: bell at chord 8, kalimba four chords later, soft piano a bar after that.
    if (c >= 8) voice1.push(note(start, 1.9, CANON_LINE[(c - 8) % 8], 92 + (c % 8 === 0 ? 6 : 0)));
    if (c >= 12) voice2.push(note(start, 1.9, CANON_LINE[(c - 12) % 8] - 12, 84));
    if (c >= 18) voice3.push(note(start, 1.9, CANON_LINE[(c - 18) % 8] - 12, 76));
  }
  // Final D major chord, rolled and held.
  const finale = [38, 50, 57, 62, 66, 69, 74, 78];
  const finalBass: MidiWriteNote[] = [], finalTop: MidiWriteNote[] = [];
  finale.forEach((pitch, i) => (i < 3 ? finalBass : finalTop).push(note(64 + i * 0.05, 3, pitch, 104 - i * 3)));
  const tracks: MidiWriteTrack[] = [
    { name: "Ground bass", channel: 0, program: 0, notes: [...bass, ...finalBass] },
    { name: "Arpeggio", channel: 1, program: 0, notes: arpeggio },
    { name: "Canon I", channel: 2, program: 9, notes: [...voice1, ...finalTop] },
    { name: "Canon II", channel: 3, program: 108, notes: voice2 },
    { name: "Canon III", channel: 4, program: 10, notes: voice3 },
  ];
  return {
    file: "canon-in-d.mid", title: "Canon in D", credit: "Pachelbel (public domain), ground bass and canon line",
    options: { format: 1, ticksPerQuarter: 480, tempos: CANON_TEMPOS, tracks, title: "Canon in D" },
  };
}

// ---------------------------------------------------------------------------------------------------
// C. Original minimal phasing piece: E minor pentatonic voices looping at slightly different lengths.
// ---------------------------------------------------------------------------------------------------

export const PHASE_BPM = 120;
const STEP_BEATS = 0.5; // one eighth note = 0.25 s at 120 BPM
export const PHASE_PATTERN_A = [64, 67, 71, 74, 71, 67, 69, 76, 74, 69, 67, 71] as const; // E4 G4 B4 D5 B4 G4 A4 E5 D5 A4 G4 B4
/** [step, pitch] inside the 13-step bell loop. */
export const PHASE_PATTERN_C: readonly (readonly [number, number])[] = [[0, 83], [2, 79], [5, 86], [7, 88], [9, 81], [11, 83]];
/** Voice A loops every 12 steps (3 s); voice B every 156/14 steps and voice C every 13 steps, so after 39 s all three realign. */
export const PHASE_LOOP_A = 12, PHASE_LOOP_B = 156 / 14, PHASE_LOOP_C = 13;
export const PHASE_REALIGN_SEC = 45;
export const PHASE_FINAL_SEC = 48;

function pentatonicPhase(): MidiPiece {
  const stepSec = STEP_BEATS * 60 / PHASE_BPM;
  const beatOf = (seconds: number) => seconds * PHASE_BPM / 60;
  const voiceA: MidiWriteNote[] = [], voiceB: MidiWriteNote[] = [], voiceC: MidiWriteNote[] = [], bass: MidiWriteNote[] = [];
  const accent = (step: number) => (step % 3 === 0 ? 10 : 0);

  // Voice A (marimba): a 12-step loop, three seconds long, from the start; slow crescendo.
  for (let loop = 0; loop < 16; loop++) { // sixteen loops: the last one, at 45 s, is the realigned finale
    PHASE_PATTERN_A.forEach((pitch, step) => {
      const t = (loop * PHASE_LOOP_A + step) * stepSec;
      voiceA.push(note(beatOf(t), 0.45, pitch, 62 + accent(step) + loop * 1.4));
    });
  }
  // Voice B (kalimba): the same pattern, a little faster (156/14 steps per loop), entering at 6 s in unison.
  for (let loop = 0; loop < 15; loop++) {
    PHASE_PATTERN_A.forEach((pitch, step) => {
      const t = 6 + (loop * PHASE_LOOP_B + step * PHASE_LOOP_B / PHASE_LOOP_A) * stepSec;
      if (t < PHASE_FINAL_SEC - 0.1) voiceB.push(note(beatOf(t), 0.45, pitch, 58 + accent(step) + loop * 1.2));
    });
  }
  // Voice C (bells): a sparse 13-step loop, slightly slower than voice A, audible from 15 s.
  for (let loop = 0; loop < 13; loop++) {
    PHASE_PATTERN_C.forEach(([step, pitch]) => {
      const t = 6 + (loop * PHASE_LOOP_C + step) * stepSec;
      if (t >= 15 - 1e-9 && t < PHASE_FINAL_SEC - 0.1) voiceC.push(note(beatOf(t), 0.9, pitch, 70 + (step === 0 ? 8 : 0)));
    });
  }
  // Bass pulses on every loop of voice A from 18 s, alternating E3 and B2, with a half-loop answer.
  for (let loop = 6; loop < 16; loop++) {
    const t = loop * PHASE_LOOP_A * stepSec;
    bass.push(note(beatOf(t), 2.5, 52, 78));
    if (t + 6 * stepSec < PHASE_FINAL_SEC - 0.1) bass.push(note(beatOf(t + 6 * stepSec), 2.2, 47, 64));
  }
  // Final chord: every voice has realigned; the pentatonic stack rings out.
  const stack = [40, 52, 59, 64, 67, 71, 76];
  stack.forEach((pitch, i) => (i < 2 ? bass : i < 6 ? voiceA : voiceC).push(note(beatOf(PHASE_FINAL_SEC) + i * 0.04, 3, pitch, 96 - i * 2)));
  const tracks: MidiWriteTrack[] = [
    { name: "Marimba", channel: 0, program: 12, notes: voiceA },
    { name: "Kalimba", channel: 1, program: 108, notes: voiceB },
    { name: "Bells", channel: 2, program: 9, notes: voiceC },
    { name: "Bass", channel: 3, program: 12, notes: bass },
  ];
  return {
    file: "pentatonic-phase.mid", title: "Pentatonic Phase", credit: "Original generative piece",
    options: { format: 1, ticksPerQuarter: 480, tempos: [{ beat: 0, bpm: PHASE_BPM }], tracks, title: "Pentatonic Phase", timeSignature: [6, 4] }, // one bar = one 3 s loop of voice A
  };
}

/** Built-in pieces in scene order: Ball Piano, Ripple Tank, Phase Orbit. */
export function builtInPieces(): MidiPiece[] {
  return [odeToJoy(), canonInD(), pentatonicPhase()];
}

export function pieceBytes(piece: MidiPiece): Uint8Array {
  return writeMidi(piece.options);
}
