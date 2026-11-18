import assert from "node:assert/strict";
import test from "node:test";
import { VIDEO } from "../settings.ts";
import {
  buildCarpetLoomScore,
  CARPET_TOTAL_FRAMES,
} from "../music-carpet/score.ts";
import { CARPET_COLS, CARPET_ROWS } from "../music-carpet/pattern.ts";
import { createCarpetLoomSimulation, simulateCarpetLoom } from "../music-carpet/sim.ts";
import {
  buildFireworkMountainKingScore,
  FIREWORK_TOTAL_FRAMES,
} from "../music-fireworks/score.ts";
import { simulateFireworkMountainKing } from "../music-fireworks/sim.ts";
import {
  buildRopeHarpScore,
  ROPE_HARP_TOTAL_FRAMES,
} from "../music-rope-harp/score.ts";
import { simulateRopeHarp } from "../music-rope-harp/sim.ts";
import { SAMPLE_RATE, synthesizePieceWav } from "./synth.ts";
import { midiToHz, type PieceScore, type VoiceId } from "./types.ts";
import {
  decodeStereoPcm16Wav,
  measureNotePitchHz,
  verifyPieceWavAndSync,
} from "./verify.ts";

test("every synthesized music voice matches equal-temperament pitch within 0.8%", () => {
  const voices: readonly VoiceId[] = [
    "tar",
    "kamancha",
    "chime",
    "bell",
    "pizzicato",
    "brass",
    "lead",
    "bass",
    "arp",
    "harmony",
  ];
  const testMidis = [45, 57, 69, 76]; // A2 (110 Hz), A3 (220 Hz), A4 (440 Hz), E5 (659.26 Hz)

  for (const voice of voices) {
    for (const midi of testMidis) {
      if (voice === "bass" && midi > 64) continue;
      if ((voice === "bell" || voice === "chime") && midi < 52) continue;

      const singleNoteScore: PieceScore = {
        id: `VoiceTest_${voice}_${midi}`,
        slug: "voice-test",
        title: "Voice Test",
        subtitle: "",
        durationSec: 1.0,
        totalFrames: VIDEO.fps,
        notes: [
          {
            time: 0.1,
            duration: 0.55,
            midi,
            velocity: 0.85,
            voice,
          },
        ],
        drums: [],
        drones: [],
        risers: [],
      };
      const wav = synthesizePieceWav(singleNoteScore);
      const decoded = decodeStereoPcm16Wav(wav);
      const expectedHz = midiToHz(midi);
      const { fundamentalHz, dominantHz } = measureNotePitchHz(
        decoded.mono,
        0.1,
        0.55,
        expectedHz * 0.7,
        expectedHz * 2.2,
      );
      const bestHz =
        Math.abs(dominantHz - expectedHz) < Math.abs(fundamentalHz - expectedHz)
          ? dominantHz
          : fundamentalHz;
      const errPct = (Math.abs(bestHz - expectedHz) / expectedHz) * 100;
      assert.ok(
        errPct < 0.8,
        `Voice ${voice} midi ${midi}: expected ${expectedHz.toFixed(2)} Hz, got ${bestHz.toFixed(2)} Hz (${errPct.toFixed(3)}%)`,
      );
    }
  }
});

test("Firework Mountain King score, simulation, pitch, sync, and loudness pass all constraints", () => {
  const score = buildFireworkMountainKingScore();
  const sim1 = simulateFireworkMountainKing();
  const sim2 = simulateFireworkMountainKing();

  assert.equal(score.totalFrames, FIREWORK_TOTAL_FRAMES);
  assert.ok(score.durationSec >= 40 && score.durationSec <= 60);
  assert.ok(score.notes.length >= 180, `Expected rich arrangement, got ${score.notes.length} notes`);
  assert.deepEqual(sim1.visualEvents, sim2.visualEvents);

  // Ordering & hook inside first 1.5s & no >2.0s visual gap
  assert.ok(score.notes[0].time <= 1.0, "Hook note must arrive inside first 1.5s");
  for (let i = 1; i < score.notes.length; i++) {
    assert.ok(score.notes[i].time >= score.notes[i - 1].time, "Notes must be sorted by time");
    const gap = score.notes[i].time - score.notes[i - 1].time;
    assert.ok(gap <= 1.8, `Note gap ${gap.toFixed(2)}s exceeds 2.0s retention ceiling`);
  }

  const wav1 = synthesizePieceWav(score);
  const wav2 = synthesizePieceWav(score);
  assert.deepEqual(wav1, wav2, "WAV synthesis must be 100% deterministic");

  const report = verifyPieceWavAndSync(score, wav1, sim1.visualEvents, {
    allowedPauseWindow: [32.5, 36.5],
  });

  assert.equal(report.visualEventCount, report.noteCount);
  assert.ok(report.maxVisualFrameError <= 1);
  assert.ok(report.maxAudioOnsetFrameError <= 1);
  assert.ok(report.maxPitchErrorPct < 1.0, `Max pitch error ${report.maxPitchErrorPct}% >= 1%`);
  assert.ok(report.peak <= 0.95 && report.peak >= 0.5, `Unexpected peak ${report.peak}`);
  assert.ok(report.rmsDb >= -18 && report.rmsDb <= -12, `RMS ${report.rmsDb} dBFS outside [-18, -12]`);
  assert.equal(report.clippedSamples, 0);
  assert.ok(report.dcOffset < 0.001);
  assert.ok(report.maxSilentGapSec <= 1.5, `Unexpected silent gap ${report.maxSilentGapSec}s`);
  assert.equal(wav1.readUInt32LE(24), SAMPLE_RATE);
});

test("Rope Harp (Greensleeves) score, simulation, pitch, sync, and loudness pass all constraints", () => {
  const score = buildRopeHarpScore();
  const sim1 = simulateRopeHarp();
  const sim2 = simulateRopeHarp();

  assert.equal(score.totalFrames, ROPE_HARP_TOTAL_FRAMES);
  assert.ok(score.durationSec >= 40 && score.durationSec <= 60);
  assert.ok(score.notes.length >= 140, `Expected rich arrangement, got ${score.notes.length} notes`);
  assert.deepEqual(sim1.visualEvents, sim2.visualEvents);

  // Symmetrical chime bar rack around x = 540
  const leftMargin = sim1.bars[0].cx - sim1.bars[0].width * 0.5;
  const rightMargin =
    VIDEO.width -
    (sim1.bars[sim1.bars.length - 1].cx + sim1.bars[sim1.bars.length - 1].width * 0.5);
  assert.ok(Math.abs(leftMargin - rightMargin) < 2, "Chime bar rack must be horizontally symmetric");

  assert.ok(score.notes[0].time <= 1.0, "Hook note must arrive inside first 1.5s");
  for (let i = 1; i < score.notes.length; i++) {
    assert.ok(score.notes[i].time >= score.notes[i - 1].time);
    const gap = score.notes[i].time - score.notes[i - 1].time;
    assert.ok(gap <= 1.8, `Note gap ${gap.toFixed(2)}s exceeds 2.0s retention ceiling`);
  }

  const wav = synthesizePieceWav(score);
  const report = verifyPieceWavAndSync(score, wav, sim1.visualEvents, {
    allowedPauseWindow: [32.5, 35.0],
  });

  assert.equal(report.visualEventCount, report.noteCount);
  assert.ok(report.maxVisualFrameError <= 1);
  assert.ok(report.maxAudioOnsetFrameError <= 1);
  assert.ok(report.maxPitchErrorPct < 1.0, `Max pitch error ${report.maxPitchErrorPct}% >= 1%`);
  assert.ok(report.peak <= 0.95 && report.peak >= 0.5, `Unexpected peak ${report.peak}`);
  assert.ok(report.rmsDb >= -18 && report.rmsDb <= -12, `RMS ${report.rmsDb} dBFS outside [-18, -12]`);
  assert.equal(report.clippedSamples, 0);
  assert.ok(report.dcOffset < 0.001);
  assert.ok(report.maxSilentGapSec <= 1.5, `Unexpected silent gap ${report.maxSilentGapSec}s`);
});

test("Carpet Loom (Sarı gəlin) weaves row-by-row bottom-to-top and passes pitch, sync, and loudness checks", () => {
  const score = buildCarpetLoomScore();
  const sim1 = simulateCarpetLoom();
  const sim2 = createCarpetLoomSimulation(score);

  assert.equal(score.title, "Sarı gəlin");
  assert.equal(score.totalFrames, CARPET_TOTAL_FRAMES);
  assert.equal(score.durationSec, 57.6);
  assert.equal(score.notes.length, 280);
  assert.equal(score.drums.length, 174);
  assert.deepEqual(sim1.visualEvents, sim2.visualEvents);
  assert.deepEqual(sim1.noteRuns, sim2.noteRuns);
  assert.deepEqual(sim1.rowCompletions, sim2.rowCompletions);

  // 1. Knot run count equals note count, and total knots equal CARPET_COLS * CARPET_ROWS
  assert.equal(sim1.noteRuns.length, score.notes.length);
  const sumKnots = sim1.noteRuns.reduce((acc, r) => acc + r.knotCount, 0);
  assert.equal(sumKnots, CARPET_COLS * CARPET_ROWS);
  assert.equal(sim1.cellKnots.length, CARPET_COLS * CARPET_ROWS);
  for (let i = 0; i < sim1.cellKnots.length; i++) {
    assert.ok(sim1.cellKnots[i] !== undefined, `Cell ${i} was never knotted`);
  }

  // 2. Rows complete strictly in bottom-to-top order (weaveRow 0..79, gridRow 79..0)
  assert.equal(sim1.rowCompletions.length, CARPET_ROWS);
  for (let w = 0; w < CARPET_ROWS; w++) {
    const rc = sim1.rowCompletions[w];
    assert.equal(rc.weaveRow, w);
    assert.equal(rc.gridRow, CARPET_ROWS - 1 - w);
    if (w > 0) {
      assert.ok(
        rc.completedTime >= sim1.rowCompletions[w - 1].completedTime,
        `Row ${w} completed before row ${w - 1}`,
      );
      assert.ok(rc.completedByNote >= sim1.rowCompletions[w - 1].completedByNote);
    }
  }

  // 3. Final row completes at the final chord (last note at t = 55.8 s)
  const lastRow = sim1.rowCompletions[CARPET_ROWS - 1];
  const lastNote = score.notes[score.notes.length - 1];
  assert.equal(lastRow.completedByNote, score.notes.length - 1);
  assert.ok(
    Math.abs(lastRow.completedTime - lastNote.time) < 0.3,
    `Expected final row at last chord (${lastNote.time}s), got ${lastRow.completedTime}s`,
  );

  // Hook at t=0.0s & combined musical event cadence never leaves >2.0s gap
  assert.equal(score.notes[0].time, 0);
  const allTimes = [
    ...score.notes.map((n) => n.time),
    ...score.drums.map((d) => d.time),
  ].sort((a, b) => a - b);
  for (let i = 1; i < allTimes.length; i++) {
    assert.ok(
      allTimes[i] - allTimes[i - 1] <= 1.85,
      `Event gap ${(allTimes[i] - allTimes[i - 1]).toFixed(2)}s > 2.0s`,
    );
  }

  const wav1 = synthesizePieceWav(score);
  const wav2 = synthesizePieceWav(score);
  assert.deepEqual(wav1, wav2);

  const report = verifyPieceWavAndSync(score, wav1, sim1.visualEvents);

  assert.equal(report.visualEventCount, report.noteCount);
  assert.ok(report.maxVisualFrameError <= 1);
  assert.ok(report.maxAudioOnsetFrameError <= 1);
  assert.ok(report.maxPitchErrorPct < 1.0, `Max pitch error ${report.maxPitchErrorPct}% >= 1%`);
  assert.ok(report.peak <= 0.95 && report.peak >= 0.5, `Unexpected peak ${report.peak}`);
  assert.ok(report.rmsDb >= -18 && report.rmsDb <= -12, `RMS ${report.rmsDb} dBFS outside [-18, -12]`);
  assert.equal(report.clippedSamples, 0);
  assert.ok(report.dcOffset < 0.001);
  assert.ok(report.maxSilentGapSec <= 1.5, `Unexpected silent gap ${report.maxSilentGapSec}s`);
});
