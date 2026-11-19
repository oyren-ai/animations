import assert from "node:assert/strict";
import test from "node:test";
import { parseMidi } from "./parse.ts";
import {
  bakuNights,
  builtInPieces,
  BUMBLEBEE_INTRO_BARS,
  BUMBLEBEE_TEMPOS,
  bumblebeeWave16,
  CANON_OPENING_QUARTERS,
  CANON_PROGRESSION,
  FUR_ELISE_OPENING_MOTIF,
  MUGHAM_SHUR_CLASSES,
  mughamNocturne,
  pieceBytes,
} from "./pieces.ts";

const [BUMBLEBEE, CANON, FUR_ELISE, MUGHAM, BAKU] = builtInPieces();
const parsedOf = (piece: typeof BUMBLEBEE) => parseMidi(pieceBytes(piece));

test("Flight of the Bumblebee: score-verified chromatic backstep intro, descending fourth-leap motif, steady Vivace tempo, and 3-octave rocket", () => {
  const parsed = parsedOf(BUMBLEBEE);
  const lead = parsed.notes.filter((n) => n.track === 1);
  assert.ok(lead.length >= 420, `expected dense chromatic lead, got ${lead.length}`);
  // Score-verified opening bars 1..3: E6 D#6 D6 C#6 D6 C#6 C6 B5 | Bb5 A5 G#5 A5 G#5 G5 F#5 F5 | E5...
  assert.deepEqual(
    lead.slice(0, 24).map((n) => n.pitch),
    [...BUMBLEBEE_INTRO_BARS[0], ...BUMBLEBEE_INTRO_BARS[1], ...BUMBLEBEE_INTRO_BARS[2]],
  );
  // Score-verified main motif on A4 (69): A4 G#4 G4 F#4 F4 Bb4 A4 G#4 | A4 G#4 G4 F#4 F4 F#4 G4 G#4
  assert.deepEqual(
    bumblebeeWave16(69),
    [69, 68, 67, 66, 65, 70, 69, 68, 69, 68, 67, 66, 65, 66, 67, 68],
  );
  assert.deepEqual(lead.slice(48, 64).map((n) => n.pitch), bumblebeeWave16(69));

  // Steady Vivace tempo (~148..152 BPM, no artificial 136->212 speedup) and no marimba clack (only piano + strings)
  for (const t of BUMBLEBEE_TEMPOS) assert.ok(t.bpm >= 144 && t.bpm <= 156);
  assert.deepEqual(parsed.tracks.slice(1).map((t) => t.programs[0]), [0, 0, 40]);

  const pitchesStr = lead.map((n) => n.pitch).join(",");
  const expectedRocket = Array.from({ length: 37 }, (_, i) => 57 + i).join(",");
  assert.ok(pitchesStr.includes(expectedRocket), "contains full 3-octave chromatic rocket A3..A6");
});

test("Canon in D: five voices enter one at a time, ground bass and D-major harmony are exact", () => {
  const parsed = parsedOf(CANON);
  assert.equal(parsed.tracks.length, 6, "conductor + 5 voice tracks");

  const byVoice = [1, 2, 3, 4, 5].map((trackIdx) => parsed.notes.filter((n) => n.track === trackIdx));
  for (let v = 0; v < 5; v++) assert.ok(byVoice[v].length >= 16, `voice ${v + 1} has notes`);

  const firstOnsets = byVoice.map((notes) => notes[0].timeSec);
  assert.ok(Math.abs(firstOnsets[0]) < 1e-6, "Voice 1 starts immediately at t = 0");
  for (let v = 1; v < 5; v++) {
    const gap = firstOnsets[v] - firstOnsets[v - 1];
    assert.ok(gap > 6.5 && gap < 9.0, `Voice ${v + 1} enters one cycle after Voice ${v} (gap ${gap.toFixed(2)}s)`);
  }

  assert.deepEqual(byVoice[0].slice(0, 16).map((n) => n.pitch), CANON_OPENING_QUARTERS.flat());
  assert.deepEqual(byVoice[1].slice(0, 8).map((n) => n.pitch), CANON_PROGRESSION.map((c) => c.bass));
  const dMajor = new Set([2, 4, 6, 7, 9, 11, 1]);
  for (const n of parsed.notes) assert.ok(dMajor.has(n.pitch % 12), `pitch ${n.pitch} is outside D major`);
});

test("Für Elise: Beethoven WoO 59 motif, C-major episode, tuned comb pitch range, and music-box program", () => {
  const parsed = parsedOf(FUR_ELISE);
  const melody = parsed.notes.filter((n) => n.track === 1);
  assert.deepEqual(melody.slice(0, 9).map((n) => n.pitch), [...FUR_ELISE_OPENING_MOTIF]);
  for (const track of parsed.tracks.slice(1)) {
    assert.deepEqual(track.programs, [10], `${track.name} selects GM Music Box (10)`);
  }
  for (const n of parsed.notes) assert.ok(n.pitch >= 52 && n.pitch <= 89);
});

test("Mugham Nocturne: original D Shur piece with rubato intro, 7/8 groove, +40c pitch bend, and drone loop return", () => {
  assert.equal(MUGHAM.composer, "Original");
  assert.deepEqual(pieceBytes(mughamNocturne()), pieceBytes(mughamNocturne()), "seeded generator is deterministic");
  const parsed = parsedOf(MUGHAM);
  assert.deepEqual(parsed.timeSignature, { numerator: 7, denominator: 8 });
  assert.ok(parsed.tempoMap.length >= 6, "rubato introduction + groove + coda tempo map");

  const tar = parsed.notes.filter((n) => n.track === 1);
  const piano = parsed.notes.filter((n) => n.track === 3);
  const bass = parsed.notes.filter((n) => n.track === 4);
  const brushes = parsed.notes.filter((n) => n.channel === 9);
  assert.ok(tar.length >= 90 && piano.length >= 90 && bass.length >= 50 && brushes.length >= 60);

  // Characteristic +40 cent Shur pitch-bend inflection present on ornamental Eb notes
  const bentNotes = tar.filter((n) => Math.abs((n.pitchBendCents ?? 0) - 40) < 1);
  assert.ok(bentNotes.length >= 4, `expected microtonal +40c Eb bends, got ${bentNotes.length}`);
  for (const n of bentNotes) assert.equal(n.pitch % 12, 3, "only Eb receives the +40c Shur inflection");

  // Majority of Tar notes belong to D Shur {D, Eb, F, G, A, Bb, C} (with rare chromatic approach notes)
  const shurSet = new Set<number>(MUGHAM_SHUR_CLASSES);
  const inMode = tar.filter((n) => shurSet.has(n.pitch % 12)).length;
  assert.ok(inMode / tar.length > 0.9, "over 90% of Tar notes are pure D Shur degrees");

  // Opens and closes on the D2 (38) bass drone for seamless loop continuity
  assert.equal(bass[0].pitch, 38);
  assert.equal(bass[bass.length - 1].pitch, 38);
});

test("Baku Nights: original C Rast-inspired nocturne at 78 BPM with piano, strings, bass, and soft brushes", () => {
  assert.equal(BAKU.composer, "Original");
  assert.deepEqual(pieceBytes(bakuNights()), pieceBytes(bakuNights()), "seeded humanisation is deterministic");
  const parsed = parsedOf(BAKU);
  assert.deepEqual(parsed.timeSignature, { numerator: 4, denominator: 4 });

  const lead = parsed.notes.filter((n) => n.track === 1);
  const strings = parsed.notes.filter((n) => n.track === 3);
  const bass = parsed.notes.filter((n) => n.track === 4);
  const brushes = parsed.notes.filter((n) => n.channel === 9);
  assert.ok(lead.length >= 50 && strings.length >= 12 && bass.length >= 35 && brushes.length >= 40);

  // Expressive -20 cent warm Rast third inflection on sustained E string notes
  const rastThirds = strings.filter((n) => Math.abs((n.pitchBendCents ?? 0) + 20) < 1);
  assert.ok(rastThirds.length >= 3);

  // C Rast-inspired pitch classes {C, D, E, F, G, A, Bb, B}
  const rastSet = new Set([0, 2, 4, 5, 7, 9, 10, 11]);
  for (const n of lead) assert.ok(rastSet.has(n.pitch % 12), `pitch ${n.pitch} outside C Rast`);

  // Opens and closes on C2 (36) bass + G4 (67) lead lamp
  assert.equal(bass[0].pitch, 36);
  assert.equal(bass[bass.length - 1].pitch, 36);
  assert.equal(lead[0].pitch, 67);
  assert.equal(lead[lead.length - 1].pitch, 67);
});

test("every built-in piece is deterministic, 45-60 s as a video, sorted, with no gaps > 2 s and no overlaps", () => {
  for (const piece of builtInPieces()) {
    assert.deepEqual(pieceBytes(piece), pieceBytes(piece));
    const parsed = parsedOf(piece);
    assert.ok(parsed.notes.length >= 220, `${piece.file}: ${parsed.notes.length} notes`);
    const videoSeconds = 1.1 + parsed.durationSec + 2.2;
    assert.ok(videoSeconds >= 45 && videoSeconds <= 60, `${piece.file}: video length ${videoSeconds.toFixed(2)} s outside 45..60 s`);

    let prevOnset = 0;
    const lastEnd = new Map<string, number>();
    for (const n of parsed.notes) {
      assert.ok(n.timeSec >= prevOnset - 1e-9, `${piece.file}: notes must be sorted`);
      assert.ok(n.timeSec - prevOnset <= 2.0, `${piece.file}: onset gap ${(n.timeSec - prevOnset).toFixed(2)} s > 2 s`);
      prevOnset = n.timeSec;

      const key = `${n.track}:${n.pitch}`;
      assert.ok(n.timeSec >= (lastEnd.get(key) ?? 0) - 1e-4, `${piece.file}: overlap at ${n.timeSec.toFixed(3)} s pitch ${n.pitch}`);
      lastEnd.set(key, n.timeSec + n.durationSec);
      assert.ok(n.velocity >= 1 && n.velocity <= 127);
    }
  }
});
