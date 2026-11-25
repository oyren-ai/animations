import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SHOWCASE_LINES, SHOWCASE_VOICE } from "./script.ts";
import { SHOWCASE_VOICE_DATA } from "./voice.generated.ts";
import { parsePcm16Wav } from "./wav.ts";

test("generated voice data matches the script and the voice settings", () => {
  assert.equal(SHOWCASE_VOICE_DATA.voiceId, SHOWCASE_VOICE.voiceId);
  assert.equal(SHOWCASE_VOICE_DATA.model, SHOWCASE_VOICE.model);
  assert.equal(SHOWCASE_VOICE_DATA.lines.length, SHOWCASE_LINES.length);
  for (const [index, line] of SHOWCASE_LINES.entries()) {
    const clip = SHOWCASE_VOICE_DATA.lines[index];
    assert.equal(clip.id, line.id);
    assert.equal(clip.text, line.text, `${line.id}: script text changed, regenerate the voice`);
  }
});

test("each clip is 48 kHz mono PCM16 and its length matches the measured duration", () => {
  for (const clip of SHOWCASE_VOICE_DATA.lines) {
    const info = parsePcm16Wav(new Uint8Array(readFileSync(new URL(`../../public/${clip.file}`, import.meta.url))));
    assert.deepEqual([info.format, info.channels, info.sampleRate, info.bitsPerSample], [1, 1, 48000, 16], clip.id);
    const wavMs = (info.frames / info.sampleRate) * 1000;
    assert.ok(Math.abs(wavMs - clip.durationMs) <= 2, `${clip.id}: wav ${wavMs} ms vs measured ${clip.durationMs} ms`);
    assert.ok(clip.durationMs > 1000 && clip.durationMs < 8000, `${clip.id} duration`);
  }
});

test("word marks are ordered, inside the clip and aligned to the spoken text", () => {
  for (const clip of SHOWCASE_VOICE_DATA.lines) {
    assert.equal(clip.words.length, clip.text.split(/\s+/).length, `${clip.id}: one mark per spoken word`);
    let previousStart = -1;
    for (const word of clip.words) {
      assert.equal(clip.text.slice(word.charStart, word.charStart + word.text.length), word.text, clip.id);
      assert.ok(word.startMs >= previousStart, `${clip.id}: marks out of order at ${word.text}`);
      assert.ok(word.endMs >= word.startMs && word.endMs <= clip.durationMs, `${clip.id}: ${word.text} outside the clip`);
      previousStart = word.startMs;
    }
  }
});
