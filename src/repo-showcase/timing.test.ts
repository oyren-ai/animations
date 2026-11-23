import assert from "node:assert/strict";
import test from "node:test";
import { SCENE_PLAN, SHOWCASE_LINES } from "./script.ts";
import {
  beatAtFrame,
  cueAtFrame,
  segmentAtFrame,
  SHOWCASE_FPS,
  SHOWCASE_TIMING,
  SHOWCASE_TOTAL_FRAMES,
  TIMING_RULES,
} from "./timing.ts";
import { SHOWCASE_VOICE_DATA } from "./voice.generated.ts";

const timing = SHOWCASE_TIMING;
const sec = (frames: number) => frames / SHOWCASE_FPS;

test("the short is 60 fps and 20 to 26 seconds long", () => {
  assert.equal(timing.fps, 60);
  assert.equal(SHOWCASE_FPS, 60);
  assert.ok(Number.isInteger(SHOWCASE_TOTAL_FRAMES));
  assert.equal(SHOWCASE_TOTAL_FRAMES, timing.totalFrames);
  assert.ok(sec(timing.totalFrames) >= 20 && sec(timing.totalFrames) <= 26, `${sec(timing.totalFrames)} s`);
});

test("voice lines are chained in order with the measured durations and no long dead air", () => {
  assert.equal(timing.lines.length, SHOWCASE_LINES.length);
  assert.ok(sec(timing.lines[0].startFrame) >= 0.25 && sec(timing.lines[0].startFrame) <= 0.35, "first line starts right away");
  for (const [index, line] of timing.lines.entries()) {
    const clip = SHOWCASE_VOICE_DATA.lines[index];
    assert.equal(line.id, clip.id);
    const measured = sec(line.endFrame - line.startFrame);
    assert.ok(Math.abs(measured - clip.durationMs / 1000) <= 1 / SHOWCASE_FPS, `${line.id} drifts from the measured clip`);
    if (index > 0 && index < 4) {
      const gap = sec(line.startFrame - timing.lines[index - 1].endFrame);
      assert.ok(gap >= TIMING_RULES.gapSec - 0.03 && gap <= TIMING_RULES.gapSec + 0.03, `${line.id} gap ${gap}`);
    }
  }
});

test("beats are contiguous, cover the whole short and contain their voice line", () => {
  assert.equal(timing.beats[0].fromFrame, 0);
  assert.equal(timing.beats.at(-1)?.toFrame, timing.totalFrames);
  for (const [index, beat] of timing.beats.entries()) {
    if (index > 0) assert.equal(beat.fromFrame, timing.beats[index - 1].toFrame);
    const line = timing.lines[index];
    assert.equal(beat.id, line.id);
    assert.ok(line.startFrame >= beat.fromFrame && line.endFrame <= beat.toFrame, `${beat.id} voice outside its beat`);
  }
  assert.equal(beatAtFrame(timing, 0).id, "l1");
  assert.equal(beatAtFrame(timing, timing.totalFrames - 1).id, "l5");
});

test("scene segments tile each scene beat and cut just before the named word", () => {
  const sceneBeats = new Set(SCENE_PLAN.map((entry) => entry.line));
  assert.equal(timing.segments.length, SCENE_PLAN.length);
  for (const beatId of sceneBeats) {
    const beat = timing.beats.find((candidate) => candidate.id === beatId);
    assert.ok(beat);
    const inBeat = timing.segments.filter((segment) => segment.beat === beatId);
    assert.equal(inBeat[0].fromFrame, beat.fromFrame, `${beatId} starts with its beat`);
    assert.equal(inBeat.at(-1)?.toFrame, beat.toFrame, `${beatId} ends with its beat`);
    for (const [index, segment] of inBeat.entries()) {
      if (index > 0) assert.equal(segment.fromFrame, inBeat[index - 1].toFrame);
      assert.ok(segment.toFrame - segment.fromFrame >= 30, `${beatId} segment shorter than 0.5 s`);
    }
  }
  for (const [index, entry] of SCENE_PLAN.entries()) {
    if (entry.atWord === null) continue;
    const line = timing.lines.find((candidate) => candidate.id === entry.line);
    const word = line?.words.find((candidate) => candidate.text.replace(/\W+$/, "") === entry.atWord);
    assert.ok(word, `${entry.atWord} has a mark`);
    const lead = word.startFrame - timing.segments[index].fromFrame;
    assert.ok(lead >= 0 && lead <= 4, `${entry.atWord}: cut ${lead} frames before the word`);
  }
  assert.equal(segmentAtFrame(timing, 0)?.scene, "string-arena");
  assert.equal(segmentAtFrame(timing, timing.totalFrames - 1), null, "the end card has no scene layer");
});

test("one timing list supplies every audio accent and visual cut flash", () => {
  const remixBeat = timing.beats.find((beat) => beat.id === "l4");
  const expected = [...timing.segments.map((segment) => segment.fromFrame), remixBeat?.fromFrame ?? 0, timing.endCard.fromFrame]
    .filter((frame) => frame > 0);
  assert.deepEqual(timing.cutFrames, expected, "keep every boundary in its original order, including coincident accents");
});

test("every spoken word is captioned by its own phrase at the moment it is spoken", () => {
  for (const line of SHOWCASE_LINES) assert.ok(timing.cues.some((cue) => cue.lineId === line.id));
  const phraseCount = SHOWCASE_LINES.reduce((sum, line) => sum + line.phrases.length, 0);
  assert.equal(timing.cues.length, phraseCount);
  for (const [index, cue] of timing.cues.entries()) {
    if (index > 0) assert.ok(cue.fromFrame >= timing.cues[index - 1].toFrame - 1, "cues overlap");
    assert.ok(cue.toFrame - cue.fromFrame >= 15, `cue "${cue.text}" shorter than 0.25 s`);
  }
  for (const line of timing.lines) {
    for (const word of line.words) {
      const cue = cueAtFrame(timing, word.startFrame);
      assert.ok(cue, `no caption while "${word.text}" starts`);
      assert.ok(cue.text.includes(word.text.replace(/[^\w']/g, "")), `"${word.text}" not in "${cue.text}"`);
    }
  }
});

test("caption words carry their own frames so the spoken word can be highlighted", () => {
  for (const cue of timing.cues) {
    assert.equal(cue.words.map((word) => word.text).join(" "), cue.text);
    for (const [index, word] of cue.words.entries()) {
      assert.ok(word.endFrame >= word.startFrame);
      if (index > 0) assert.ok(word.startFrame >= cue.words[index - 1].startFrame);
    }
  }
});

test("the remix steps run in order inside the remix beat and the end card follows the voice", () => {
  const beat = timing.beats.find((candidate) => candidate.id === "l4");
  assert.ok(beat);
  const { remix } = timing;
  assert.ok(beat.fromFrame <= remix.editFrame && remix.editFrame < remix.commandFrame);
  assert.ok(remix.commandFrame < remix.progressFrame && remix.progressFrame < remix.doneFrame);
  assert.ok(remix.doneFrame < beat.toFrame);
  assert.ok(remix.doneFrame - remix.progressFrame >= 36, "render progress stays on screen for at least 0.6 s");
  const l4 = timing.lines[3];
  const l5 = timing.lines[4];
  assert.equal(timing.endCard.fromFrame, beat.toFrame);
  assert.ok(timing.endCard.fromFrame >= l4.endFrame && l5.startFrame > timing.endCard.fromFrame);
  assert.ok(sec(timing.totalFrames - l5.endFrame) >= 1.0, "the end card holds at least 1 s after the last word");
});
