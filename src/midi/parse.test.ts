import assert from "node:assert/strict";
import test from "node:test";
import { parseMidi } from "./parse.ts";
import type { MidiNote } from "./types.ts";
import { notesToWriteTracks, writeMidi, type MidiWriteTrack } from "./write.ts";

/** Hand-assembled SMF bytes so the parser is tested independently of the writer. */
function smf(format: number, division: number, tracks: number[][]): Uint8Array {
  const out: number[] = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, (tracks.length >> 8) & 255, tracks.length & 255, division >> 8, division & 255];
  for (const body of tracks) {
    const withEnd = [...body, 0x00, 0xff, 0x2f, 0x00];
    out.push(0x4d, 0x54, 0x72, 0x6b, (withEnd.length >>> 24) & 255, (withEnd.length >>> 16) & 255, (withEnd.length >>> 8) & 255, withEnd.length & 255, ...withEnd);
  }
  return Uint8Array.from(out);
}

const near = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} vs ${expected}`);

const TRACKS: MidiWriteTrack[] = [
  {
    name: "Right hand", channel: 0, program: 0,
    notes: [
      { beat: 0, durationBeats: 1, pitch: 66, velocity: 80 },
      { beat: 1, durationBeats: 0.5, pitch: 67, velocity: 90 },
      { beat: 1.5, durationBeats: 2.5, pitch: 69, velocity: 100 },
      { beat: 4, durationBeats: 1, pitch: 66, velocity: 1 },
    ],
  },
  {
    name: "Bells", channel: 3, program: 9,
    notes: [
      { beat: 0.25, durationBeats: 0.25, pitch: 90, velocity: 127 },
      { beat: 1, durationBeats: 4, pitch: 38, velocity: 64 },
      { beat: 1, durationBeats: 4, pitch: 50, velocity: 64 },
    ],
  },
];

/** Expected parser output for TRACKS at 100 BPM (quarter = 0.6 s) with a conductor track at index 0. */
function expectedNotes(format: 0 | 1): MidiNote[] {
  const out: MidiNote[] = [];
  TRACKS.forEach((track, index) => {
    for (const note of track.notes) {
      out.push({
        timeSec: note.beat * 0.6, durationSec: note.durationBeats * 0.6, pitch: note.pitch, velocity: note.velocity,
        track: format === 1 ? index + 1 : 0, channel: track.channel ?? 0,
      });
    }
  });
  return out.sort((a, b) => a.timeSec - b.timeSec || a.pitch - b.pitch || a.track - b.track);
}

function assertSameNotes(actual: MidiNote[], expected: MidiNote[]) {
  assert.equal(actual.length, expected.length);
  actual.forEach((note, i) => {
    near(note.timeSec, expected[i].timeSec);
    near(note.durationSec, expected[i].durationSec);
    assert.equal(note.pitch, expected[i].pitch);
    assert.equal(note.velocity, expected[i].velocity);
    assert.equal(note.track, expected[i].track);
    assert.equal(note.channel, expected[i].channel);
  });
}

test("writer then parser round trip returns the input notes (formats 0 and 1, all writer options)", () => {
  for (const format of [1, 0] as const) {
    for (const runningStatus of [true, false]) {
      for (const zeroVelocityNoteOff of [true, false]) {
        const bytes = writeMidi({ format, tracks: TRACKS, tempos: [{ beat: 0, bpm: 100 }], title: "Round trip", runningStatus, zeroVelocityNoteOff });
        const parsed = parseMidi(bytes);
        assert.equal(parsed.format, format);
        assert.equal(parsed.ticksPerQuarter, 480);
        assertSameNotes(parsed.notes, expectedNotes(format));
        near(parsed.durationSec, 5 * 0.6); // the last note ends at beat 5 (100 BPM)
      }
    }
  }
});

test("format 1 keeps track names, programs and channels; running status makes files smaller", () => {
  const plain = writeMidi({ tracks: TRACKS, runningStatus: false });
  const compact = writeMidi({ tracks: TRACKS, runningStatus: true });
  assert.ok(compact.length < plain.length);
  const parsed = parseMidi(compact);
  assert.deepEqual(parsed.tracks.map((t) => t.name), ["", "Right hand", "Bells"]);
  assert.deepEqual(parsed.tracks.map((t) => t.programs), [[], [0], [9]]);
  assert.deepEqual(parsed.tracks.map((t) => t.channels), [[], [0], [3]]);
  assert.deepEqual(parsed.tracks.map((t) => t.noteCount), [0, 4, 3]);
});

test("notes written from seconds survive notesToWriteTracks and a second parse", () => {
  const first = parseMidi(writeMidi({ tracks: TRACKS, tempos: [{ beat: 0, bpm: 90 }] }));
  const rewritten = parseMidi(writeMidi({ tracks: notesToWriteTracks(first.notes, 90), tempos: [{ beat: 0, bpm: 90 }] }));
  assert.equal(rewritten.notes.length, first.notes.length);
  first.notes.forEach((note, i) => {
    near(rewritten.notes[i].timeSec, note.timeSec, 1e-6);
    near(rewritten.notes[i].durationSec, note.durationSec, 1e-6);
    assert.equal(rewritten.notes[i].pitch, note.pitch);
  });
});

test("tempo changes move later notes by the integral of the tempo map", () => {
  // 120 BPM for 4 beats (2 s), 60 BPM for 2 beats (2 s), then 240 BPM.
  const bytes = writeMidi({
    tempos: [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 60 }, { beat: 6, bpm: 240 }],
    tracks: [{ notes: [0, 2, 4, 5, 6, 8].map((beat) => ({ beat, durationBeats: 1, pitch: 60, velocity: 80 })) }],
  });
  const parsed = parseMidi(bytes);
  assert.deepEqual(parsed.tempoMap.map((t) => t.microsecondsPerQuarter), [500000, 1000000, 250000]);
  [0, 1, 2, 3, 4, 4.5].forEach((expected, i) => near(parsed.notes[i].timeSec, expected));
  near(parsed.notes[1].durationSec, 0.5); // a one-beat note at 120 BPM
  near(parsed.notes[3].durationSec, 1); // beat 5 at 60 BPM
  near(parsed.notes[5].durationSec, 0.25); // beat 8 at 240 BPM
  near(parsed.durationSec, 4.75);
});

test("a tempo event in a non-conductor track is merged into the global tempo map", () => {
  const bytes = smf(1, 96, [
    [0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0, 0x00, 0x90, 62, 100, 0x60, 0x80, 62, 0], // 96 ticks = 1 beat
    [0x60, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40], // at tick 96: 1,000,000 us per quarter
  ]);
  const parsed = parseMidi(bytes);
  assert.equal(parsed.notes.length, 2);
  near(parsed.notes[0].timeSec, 0);
  near(parsed.notes[0].durationSec, 0.5); // 96 ticks at the default 120 BPM
  near(parsed.notes[1].timeSec, 0.5);
  near(parsed.notes[1].durationSec, 1); // the second beat runs at 60 BPM
});

test("note-on with velocity 0 ends a note, with and without running status", () => {
  const bytes = smf(0, 480, [[
    0x00, 0x90, 60, 100, // note on C4
    0x83, 0x60, 0x90, 60, 0, // 480 ticks later: note on velocity 0 = off
    0x00, 0x90, 64, 90, // E4 on
    0x81, 0x70, 64, 0, // running status (0x90): 240 ticks later E4 with velocity 0 = off
  ]]);
  const parsed = parseMidi(bytes);
  assert.equal(parsed.notes.length, 2);
  assert.deepEqual(parsed.notes.map((n) => [n.pitch, n.velocity, n.timeSec, n.durationSec]), [[60, 100, 0, 0.5], [64, 90, 0.5, 0.25]]);
});

test("running status carries channel messages but not across meta events; channels stay separate", () => {
  const bytes = smf(0, 480, [[
    0x00, 0x91, 60, 80, // note on, channel 1
    0x00, 62, 81, // running status: another note on, channel 1
    0x00, 0xc2, 5, // program change on channel 2 (one data byte)
    0x00, 0x92, 70, 70, // channel 2 note on
    0x60, 0x81, 60, 0, // channel 1 note off after 96 ticks
    0x00, 62, 0, // running status 0x81: note off
    0x00, 0xff, 0x03, 0x02, 0x41, 0x42, // meta resets running status (track name "AB")
    0x00, 0x82, 70, 0, // explicit status again: channel 2 note off
  ]]);
  const parsed = parseMidi(bytes);
  assert.deepEqual(parsed.notes.map((n) => [n.pitch, n.channel, n.velocity]), [[60, 1, 80], [62, 1, 81], [70, 2, 70]]);
  assert.deepEqual(parsed.tracks[0].programs, [5]);
  assert.equal(parsed.tracks[0].name, "AB");
  assert.deepEqual(parsed.tracks[0].channels, [1, 2]);
  assert.throws(() => parseMidi(smf(0, 480, [[0x00, 60, 80]])), /running status/);
});

test("overlapping same-pitch notes pair first-on with first-off; unterminated notes end with the track", () => {
  const bytes = smf(0, 480, [[
    0x00, 0x90, 60, 50, // A on at 0
    0x60, 0x90, 60, 60, // B on at 96 (same pitch while A sounds)
    0x60, 0x80, 60, 0, // first off at 192 ends A
    0x60, 0x80, 60, 0, // second off at 288 ends B
    0x00, 0x90, 72, 100, // never turned off
    0x83, 0x60, 0xff, 0x01, 0x00, // meta at tick 768 (text event) pushes the end of the track
  ]]);
  const parsed = parseMidi(bytes);
  const rows = parsed.notes.map((n) => [n.pitch, n.velocity, n.timeSec, n.durationSec]);
  const expected = [[60, 50, 0, 0.2], [60, 60, 0.1, 0.2], [72, 100, 0.3, 0.5]];
  assert.equal(rows.length, expected.length);
  rows.forEach((row, i) => row.forEach((value, j) => near(value, expected[i][j])));
});

test("SMPTE time division, unknown chunks and bad input", () => {
  // 25 fps, 40 ticks per frame: 1000 ticks per second.
  const bytes = smf(0, (0xe7 << 8) | 40, [[0x00, 0x90, 60, 100, 0x87, 0x68, 0x80, 60, 0]]); // 0x87 0x68 = 1000 ticks
  const smpte = parseMidi(bytes);
  near(smpte.notes[0].durationSec, 1);
  const extra = Uint8Array.from([0x58, 0x58, 0x58, 0x58, 0, 0, 0, 3, 1, 2, 3]); // unknown chunk "XXXX"
  const original = smf(0, 480, [[0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0]]);
  const joined = Uint8Array.from([...original.slice(0, 14), ...extra, ...original.slice(14)]);
  assert.equal(parseMidi(joined).notes.length, 1);
  assert.throws(() => parseMidi(Uint8Array.from([1, 2, 3])), /MThd/);
  assert.throws(() => parseMidi(smf(2, 480, [[]])), /format/);
  assert.throws(() => parseMidi(original.slice(0, original.length - 6)), /RangeError|end of|past/i);
});

test("time signature meta event is read (6/4 here) and defaults to 4/4", () => {
  const six = parseMidi(writeMidi({ tracks: TRACKS, timeSignature: [6, 4] }));
  assert.deepEqual(six.timeSignature, { numerator: 6, denominator: 4 });
  const eight = parseMidi(writeMidi({ tracks: TRACKS, timeSignature: [7, 8] }));
  assert.deepEqual(eight.timeSignature, { numerator: 7, denominator: 8 });
  assert.deepEqual(parseMidi(smf(0, 480, [[0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0]])).timeSignature, { numerator: 4, denominator: 4 });
});

test("format 0 files report the first program of each channel", () => {
  const bytes = smf(0, 480, [[
    0x00, 0xc0, 0, 0x00, 0xc1, 12, 0x00, 0xc1, 40, // channel 0 piano, channel 1 marimba (a later change on channel 1 is ignored here)
    0x00, 0x90, 60, 80, 0x00, 0x91, 48, 80, 0x60, 0x80, 60, 0, 0x00, 0x81, 48, 0,
  ]]);
  const parsed = parseMidi(bytes);
  assert.deepEqual(parsed.tracks[0].channelPrograms, { 0: 0, 1: 12 });
  assert.deepEqual(parsed.tracks[0].programs, [0, 12, 40]);
});

test("per-note microtonal pitchBendCents round-trips through MIDI pitch-bend wheel events", () => {
  const bytes = writeMidi({
    tracks: [{
      name: "Tar",
      channel: 0,
      program: 25,
      notes: [
        { beat: 0, durationBeats: 1, pitch: 63, velocity: 96, pitchBendCents: 40 },
        { beat: 1, durationBeats: 1, pitch: 62, velocity: 90 },
      ],
    }],
  });
  const parsed = parseMidi(bytes);
  assert.equal(parsed.notes.length, 2);
  near(parsed.notes[0].pitchBendCents ?? 0, 40, 0.2);
  assert.equal(parsed.notes[1].pitchBendCents, undefined);
});
