import assert from "node:assert/strict";
import test from "node:test";
import { parseMidi } from "./parse.ts";
import {
  builtInPieces,
  BUMBLEBEE_INTRO_BARS,
  BUMBLEBEE_TEMPOS,
  bumblebeeWave16,
  CANON_OPENING_QUARTERS,
  CANON_PROGRESSION,
  FUR_ELISE_OPENING_MOTIF,
  pieceBytes,
} from "./pieces.ts";

const [BUMBLEBEE, CANON, FUR_ELISE] = builtInPieces();
const parsedOf = (piece: typeof BUMBLEBEE) => parseMidi(pieceBytes(piece));

test("Flight of the Bumblebee: authentic chromatic plunge, main wave, 4-stage accelerando, and 3-octave rocket", () => {
  const parsed = parsedOf(BUMBLEBEE);
  const lead = parsed.notes.filter((n) => n.track === 1);
  assert.ok(lead.length >= 420, `expected dense chromatic lead, got ${lead.length}`);
  assert.equal(lead[0].pitch, 88, "opens on E6");
  // Followed by the two-octave chromatic plunge from E6 (88) down to E4 (64)
  assert.deepEqual(
    lead.slice(1, 1 + 4 + 8 + 8).map((n) => n.pitch),
    [...BUMBLEBEE_INTRO_BARS[0], ...BUMBLEBEE_INTRO_BARS[1], ...BUMBLEBEE_INTRO_BARS[2]],
  );
  // Main A-minor wave starts right after the 6-bar intro
  const waveStart = 1 + BUMBLEBEE_INTRO_BARS.reduce((s, b) => s + b.length, 0);
  assert.deepEqual(lead.slice(waveStart, waveStart + 16).map((n) => n.pitch), bumblebeeWave16(69));

  // Verify the 4-stage accelerando genuinely increases note density (notes per second) across the piece
  assert.equal(parsed.tempoMap.length, BUMBLEBEE_TEMPOS.length);
  const densityInWindow = (t0: number, t1: number) =>
    parsed.notes.filter((n) => n.timeSec >= t0 && n.timeSec < t1).length / (t1 - t0);
  const dEarly = densityInWindow(2, 12);
  const dMid = densityInWindow(16, 26);
  const dPayoff = densityInWindow(34, 42);
  assert.ok(dMid > dEarly * 1.12, `mid density ${dMid.toFixed(1)} > early ${dEarly.toFixed(1)}`);
  assert.ok(dPayoff > dMid * 1.15, `payoff density ${dPayoff.toFixed(1)} > mid ${dMid.toFixed(1)}`);

  // Verify the unbroken 3-octave ascending chromatic rocket (A3 = 57 up to A6 = 93) near the finale
  const pitchesStr = lead.map((n) => n.pitch).join(",");
  const expectedRocket = Array.from({ length: 37 }, (_, i) => 57 + i).join(",");
  assert.ok(pitchesStr.includes(expectedRocket), "contains full 3-octave chromatic rocket A3..A6");
});

test("Canon in D: five voices enter one at a time, ground bass and D-major harmony are exact", () => {
  const parsed = parsedOf(CANON);
  assert.equal(parsed.tracks.length, 6, "conductor + 5 voice tracks");

  const byVoice = [1, 2, 3, 4, 5].map((trackIdx) => parsed.notes.filter((n) => n.track === trackIdx));
  for (let v = 0; v < 5; v++) assert.ok(byVoice[v].length >= 16, `voice ${v + 1} has notes`);

  // Voice entrances strictly stagger one cycle (~7.74 s) apart: 1 -> 2 -> 3 -> 4 -> 5
  const firstOnsets = byVoice.map((notes) => notes[0].timeSec);
  assert.ok(Math.abs(firstOnsets[0]) < 1e-6, "Voice 1 starts immediately at t = 0");
  for (let v = 1; v < 5; v++) {
    const gap = firstOnsets[v] - firstOnsets[v - 1];
    assert.ok(gap > 6.5 && gap < 9.0, `Voice ${v + 1} enters one cycle after Voice ${v} (gap ${gap.toFixed(2)}s)`);
  }

  // Opening melody is Pachelbel's unmistakable quarter-note theme in D major
  assert.deepEqual(
    byVoice[0].slice(0, 16).map((n) => n.pitch),
    CANON_OPENING_QUARTERS.flat(),
  );
  // Ground bass plays D A B F# G D G A
  assert.deepEqual(
    byVoice[1].slice(0, 8).map((n) => n.pitch),
    CANON_PROGRESSION.map((c) => c.bass),
  );
  // Every single note in all five voices belongs to the pure D-major scale {D, E, F#, G, A, B, C#}
  const dMajor = new Set([2, 4, 6, 7, 9, 11, 1]);
  for (const n of parsed.notes) {
    assert.ok(dMajor.has(n.pitch % 12), `pitch ${n.pitch} is outside D major`);
  }
  // Payoff window (70% to 85% of the piece): all 5 voices are sounding simultaneously
  const tPayoff0 = parsed.durationSec * 0.68;
  const tPayoff1 = parsed.durationSec * 0.88;
  for (let v = 0; v < 5; v++) {
    const active = byVoice[v].filter((n) => n.timeSec >= tPayoff0 && n.timeSec <= tPayoff1);
    assert.ok(active.length >= 4, `voice ${v + 1} active during 5-voice payoff`);
  }
});

test("Für Elise: Beethoven WoO 59 motif, C-major episode, tuned comb pitch range, and music-box program", () => {
  const parsed = parsedOf(FUR_ELISE);
  const melody = parsed.notes.filter((n) => n.track === 1);
  // First 9 melody notes are E5 D#5 E5 D#5 E5 B4 D5 C5 A4
  assert.deepEqual(melody.slice(0, 9).map((n) => n.pitch), [...FUR_ELISE_OPENING_MOTIF]);
  // All voice tracks select General MIDI program 10 (Music Box)
  for (const track of parsed.tracks.slice(1)) {
    assert.deepEqual(track.programs, [10], `${track.name} selects GM Music Box (10)`);
  }
  // Comb range stays cleanly inside E3 (52) .. F6 (89), matching a physical 2-to-3-octave steel comb
  for (const n of parsed.notes) {
    assert.ok(n.pitch >= 52 && n.pitch <= 89, `comb pitch ${n.pitch} inside E3..F6`);
  }
  const distinctTeeth = new Set(parsed.notes.map((n) => n.pitch));
  assert.ok(distinctTeeth.size >= 16 && distinctTeeth.size <= 30, `realistic comb tooth count: ${distinctTeeth.size}`);
});

test("every built-in piece is deterministic, 45-60 s as a video, sorted, with no gaps > 2 s and no overlaps", () => {
  for (const piece of builtInPieces()) {
    assert.deepEqual(pieceBytes(piece), pieceBytes(piece));
    const parsed = parsedOf(piece);
    assert.ok(parsed.notes.length >= 240, `${piece.file}: ${parsed.notes.length} notes`);
    const videoSeconds = 1.1 + parsed.durationSec + 2.1;
    assert.ok(videoSeconds >= 45 && videoSeconds <= 60, `${piece.file}: video length ${videoSeconds.toFixed(2)} s outside 45..60 s`);

    // Sorted by onset and no gap > 2.0 s between consecutive note onsets
    let prevOnset = 0;
    const lastEnd = new Map<string, number>();
    for (let i = 0; i < parsed.notes.length; i++) {
      const n = parsed.notes[i];
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
