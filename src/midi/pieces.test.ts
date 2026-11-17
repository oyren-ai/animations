import assert from "node:assert/strict";
import test from "node:test";
import { parseMidi } from "./parse.ts";
import { builtInPieces, CANON_CHORDS, CANON_LINE, ODE_MELODY, PHASE_PATTERN_A, pieceBytes } from "./pieces.ts";
import type { MidiNote } from "./types.ts";

const [ODE, CANON, PHASE] = builtInPieces();
const parsedOf = (piece: typeof ODE) => parseMidi(pieceBytes(piece));
const near = (actual: number, expected: number, epsilon: number) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} vs ${expected} (+/- ${epsilon})`);

/** Major-scale degree of a pitch relative to a tonic: "3" = mediant, "5," = dominant an octave below. */
function degree(pitch: number, tonic: number): string {
  const offset = pitch - tonic, octave = Math.floor(offset / 12);
  const index = [0, 2, 4, 5, 7, 9, 11].indexOf(offset - 12 * octave);
  assert.ok(index >= 0, `pitch ${pitch} is not in the major scale`);
  return String(index + 1) + (octave < 0 ? "," : octave > 0 ? "'" : "");
}

test("Ode to Joy melody is the standard theme (checked as scale degrees, independent of the transposition)", () => {
  const expected = [
    "3 3 4 5 5 4 3 2 1 1 2 3 3 2 2", // bars 1-4
    "3 3 4 5 5 4 3 2 1 1 2 3 2 1 1", // bars 5-8
    "2 2 3 1 2 3 4 3 1 2 3 4 3 2 1 2 5,", // bars 9-12
    "3 3 4 5 5 4 3 2 1 1 2 3 2 1 1", // bars 13-16
  ].join(" ").split(" ");
  const actual = ODE_MELODY.flat().map(([pitch]) => degree(pitch, 62));
  assert.deepEqual(actual, expected);
  assert.equal(ODE_MELODY.length, 16);
  ODE_MELODY.forEach((bar, i) => assert.equal(bar.reduce((sum, [, beats]) => sum + beats, 0), 4, `bar ${i + 1} is 4 beats`));
  // The written file contains that melody as its first-track notes, with an octave doubling in the last section.
  const melody = parsedOf(ODE).notes.filter((n) => n.track === 1 && n.timeSec < 52 && n.pitch < 72).map((n) => n.pitch);
  assert.deepEqual(melody.slice(0, 15), ODE_MELODY.slice(0, 4).flat().map(([pitch]) => pitch));
});

test("Ode to Joy accompaniment only uses tones of the chord named for the bar", () => {
  const parsed = parsedOf(ODE);
  assert.equal(parsed.tracks[2].name, "Left hand");
  const classes = new Set(parsed.notes.filter((n) => n.track === 2 && n.timeSec < 40).map((n) => n.pitch % 12));
  // D major: D E F# A and the dominant chord A C# E G
  for (const pc of classes) assert.ok([2, 4, 6, 9, 1, 7].includes(pc), `unexpected pitch class ${pc}`);
  assert.ok(classes.has(2) && classes.has(9) && classes.has(1), "both tonic and dominant harmony are present");
  assert.ok(parsed.tempoMap.length >= 5, "ends with a ritardando");
});

test("Canon in D: ground bass, chord tones and the canon line", () => {
  const parsed = parsedOf(CANON);
  const bass = parsed.notes.filter((n) => n.track === 1 && n.pitch < 52).slice(0, 8).map((n) => n.pitch);
  assert.deepEqual(bass, [50, 45, 47, 42, 43, 38, 43, 45]); // D A B F# G D G A
  const line = parsed.notes.filter((n) => n.track === 3).slice(0, 8).map((n) => n.pitch);
  assert.deepEqual(line, [...CANON_LINE]); // F# E D C# B A B C#
  const roots = [2, 9, 11, 6, 7, 2, 7, 9];
  const thirds = [[6, 9], [1, 4], [2, 6], [9, 1], [11, 2], [6, 9], [11, 2], [1, 4]]; // other chord tones above the root
  CANON_CHORDS.forEach((chord, i) => {
    assert.equal(chord.bass % 12, roots[i]);
    for (const pitch of chord.up) assert.ok([roots[i], ...thirds[i]].includes(pitch % 12), `${chord.name} tone ${pitch}`);
  });
  for (const pitch of CANON_LINE) assert.ok([2, 4, 6, 7, 9, 11, 1].includes(pitch % 12)); // D major scale
  assert.ok(parsed.notes.filter((n) => n.track === 2).length > 100, "arpeggio voice is busy");
});

test("Pentatonic Phase: pentatonic pitches, realignment at 45 s and a drifting middle", () => {
  const parsed = parsedOf(PHASE);
  const pentatonic = [4, 7, 9, 11, 2];
  for (const note of parsed.notes) assert.ok(pentatonic.includes(note.pitch % 12), `pitch ${note.pitch} outside E minor pentatonic`);
  const voice = (track: number) => parsed.notes.filter((n) => n.track === track);
  const [a, b, c] = [voice(1), voice(2), voice(3)];
  const startsNear = (notes: MidiNote[], t: number) => notes.find((n) => Math.abs(n.timeSec - t) < 0.002);
  assert.ok(startsNear(a, 45) && startsNear(b, 45) && startsNear(c, 45), "all three loops restart together at 45 s");
  assert.ok(startsNear(a, 6) && startsNear(b, 6), "voice B enters in unison with voice A at 6 s");
  // Voice B's n-th loop start drifts earlier than voice A's by 3 - 156/14/4 s per loop.
  const loopStartsB = b.filter((n) => n.pitch === PHASE_PATTERN_A[0] && n.timeSec > 5.9).map((n) => n.timeSec);
  const driftPerLoop = 3 - (156 / 14) * 0.25;
  near(loopStartsB[1] - loopStartsB[0], (156 / 14) * 0.25, 0.01);
  assert.ok(driftPerLoop > 0.2);
  near(a.find((n) => n.timeSec >= 23.99)!.timeSec, 24, 0.002); // voice A's loops start on multiples of 3 s
  assert.ok(parsed.durationSec > 48 && parsed.durationSec < 54);
});

test("every built-in piece is deterministic, 30-60 s with lead and tail, and has no same-pitch overlaps", () => {
  for (const piece of builtInPieces()) {
    assert.deepEqual(pieceBytes(piece), pieceBytes(piece));
    const parsed = parsedOf(piece);
    assert.ok(parsed.notes.length >= 150, piece.file);
    const videoSeconds = parsed.durationSec + 3 + 1.5; // generous lead-in and the default 3 s tail
    assert.ok(videoSeconds > 30 && videoSeconds < 60, `${piece.file}: ${videoSeconds.toFixed(1)} s`);
    const lastEnd = new Map<string, number>();
    for (const note of parsed.notes) {
      const key = `${note.track}:${note.pitch}`;
      assert.ok(note.timeSec >= (lastEnd.get(key) ?? 0) - 1e-6, `${piece.file}: overlapping notes at ${note.timeSec.toFixed(3)} s pitch ${note.pitch}`);
      lastEnd.set(key, note.timeSec + note.durationSec);
      assert.ok(note.velocity >= 1 && note.velocity <= 127);
    }
  }
});
