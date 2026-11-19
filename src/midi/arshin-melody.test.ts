import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  ARSHIN_FERMATA_FACTOR,
  ARSHIN_OCTAVE_SHIFT,
  arshinMalAlan,
  type FlatMelodyEntry,
} from "./arshin.ts";
import { parseMidi } from "./parse.ts";
import { pieceBytes } from "./pieces.ts";

/**
 * The reconciled vocal line is frozen: two independent readings of the 1948 vocal score agreed on all 48 bars, and
 * this proof was written against exactly that file. Any later correction to a note must be deliberate, so it has to
 * update this hash as well.
 */
const RECONCILED_SHA256 = "f412453b7b7e063d609a9c7bd0663a90d572bf3015d2ebc49de95c02739e67bd";
const REPO_RECONCILED_URL = new URL("./arshin-melody-reconciled.json", import.meta.url);
const PUBLIC_MIDI_URL = new URL("../../public/midi/arshin-mal-alan-askars-song.mid", import.meta.url);
const EXPORTED_MIDI_URL = new URL("../../midi/arshin-mal-alan-askars-song.mid", import.meta.url);

/**
 * Accuracy Proof for Arshin Mal Alan (No. 12 "Askar's Song", Act II):
 * - Octave choice: `ARSHIN_OCTAVE_SHIFT = -12` (tenor written in treble clef sounds one octave lower,
 *   matching `midi_if_tenor_octave_down` = `midi_written - 12` on every note).
 * - Fermata factor: `ARSHIN_FERMATA_FACTOR = 1.75` on the single `fermata: true` note (`bar 84.1.2`,
 *   coda opening G5 at `start = 688, dur = 8`), keeping its onset exact at `688` units, holding its
 *   duration to `8 * 1.75 = 14` units (`+6` extra 1/32-note units), and shifting the 3 subsequent
 *   coda notes (`696, 700, 704`) by `+6` units while preserving their exact written durations (`4, 4, 36`).
 */
test("Arshin Mal Alan lead track matches melody-reconciled.json flat_full (168 notes) verbatim in pitches, 1/32-unit onsets, and durations", () => {
  const rawText = readFileSync(REPO_RECONCILED_URL, "utf8");
  assert.equal(
    createHash("sha256").update(rawText).digest("hex"),
    RECONCILED_SHA256,
    "src/midi/arshin-melody-reconciled.json must be the reconciled transcription this accuracy proof was written against",
  );

  const rawJson = JSON.parse(rawText) as {
    standIn?: boolean;
    flat_full: FlatMelodyEntry[];
    flat_full_total_units: number;
    uncertain: Array<{ id: string }>;
  };
  assert.ok(!rawJson.standIn, "must use the real reconciled vocal score data, never a stand-in");
  assert.equal(rawJson.flat_full.length, 168, "complete 48-bar expanded pass has 168 notes");
  assert.equal(rawJson.flat_full_total_units, 768, "48 bars of 4/8 = 768 x 1/32-note units");
  assert.equal(rawJson.uncertain.length, 12, "12 uncertain bars documented in reconciled file");

  // Verify the exact MIDI bytes that drive both Remotion canvas picture and offline WAV sound
  const generatedBytes = Buffer.from(pieceBytes(arshinMalAlan()));
  assert.ok(existsSync(PUBLIC_MIDI_URL), "public/midi/arshin-mal-alan-askars-song.mid exists");
  assert.ok(existsSync(EXPORTED_MIDI_URL), "midi/arshin-mal-alan-askars-song.mid exists");
  assert.deepEqual(readFileSync(PUBLIC_MIDI_URL), generatedBytes);
  assert.deepEqual(readFileSync(EXPORTED_MIDI_URL), generatedBytes);

  const parsed = parseMidi(generatedBytes);
  assert.deepEqual(parsed.timeSignature, { numerator: 4, denominator: 8 });
  assert.equal(parsed.tempoMap.length, 1);
  const bpm = 60e6 / parsed.tempoMap[0].microsecondsPerQuarter;
  assert.ok(bpm >= 104 && bpm <= 120, `Allegro moderato tempo ${bpm.toFixed(2)} BPM inside 104..120`);

  const lead = parsed.notes.filter((n) => n.track === 1);
  assert.equal(
    lead.length,
    rawJson.flat_full.length,
    "exact 168-note count in playback order (nothing added to or dropped from the lead line)",
  );

  const unitsPerSec = (bpm / 60) * 8; // 1 quarter-note = 8 x 1/32-note units
  const firstMidiSec = lead[0].timeSec;
  const firstScoreStart = rawJson.flat_full[0].start;

  let postFermataOffsetUnits = 0;
  let fermataCount = 0;

  for (let i = 0; i < rawJson.flat_full.length; i++) {
    const exp = rawJson.flat_full[i];
    const got = lead[i];

    // 1. Exact pitch after documented -12 semitone tenor octave shift
    assert.equal(ARSHIN_OCTAVE_SHIFT, -12);
    assert.equal(got.pitch, exp.midi_if_tenor_octave_down, `note #${i} (${exp.bars[0]}): matches midi_if_tenor_octave_down`);
    assert.equal(got.pitch, exp.midi_written + ARSHIN_OCTAVE_SHIFT, `note #${i}: matches midi_written - 12`);

    // 2. Exact relative onset in 1/32-note units (exact score onset up through the fermata onset; +6 units after fermata)
    const gotRelOnset = (got.timeSec - firstMidiSec) * unitsPerSec;
    const expRelOnset = exp.start - firstScoreStart + postFermataOffsetUnits;
    assert.ok(
      Math.abs(gotRelOnset - expRelOnset) < 1e-4,
      `note #${i} (${exp.bars[0]}): relative onset ${gotRelOnset.toFixed(6)} != ${expRelOnset} (1/32 units)`,
    );

    // 3. Exact duration in 1/32-note units (fermata note held by ARSHIN_FERMATA_FACTOR = 1.75 -> 14 units > 8)
    const gotDur = got.durationSec * unitsPerSec;
    if (exp.fermata) {
      fermataCount++;
      const expFermataDur = exp.dur * ARSHIN_FERMATA_FACTOR;
      assert.ok(expFermataDur > exp.dur, "fermata note is held longer than written");
      assert.ok(
        Math.abs(gotDur - expFermataDur) < 1e-4,
        `fermata note #${i} (${exp.bars[0]}): duration ${gotDur.toFixed(6)} != ${expFermataDur} (factor ${ARSHIN_FERMATA_FACTOR})`,
      );
      postFermataOffsetUnits += expFermataDur - exp.dur;
    } else {
      assert.ok(
        Math.abs(gotDur - exp.dur) < 1e-4,
        `note #${i} (${exp.bars[0]}): duration ${gotDur.toFixed(6)} != ${exp.dur} (1/32 units)`,
      );
    }
  }
  assert.equal(fermataCount, 1, "exactly one fermata note (coda opening G5 in bar 84.1.2)");
});
