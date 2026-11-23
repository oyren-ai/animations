import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SHOWCASE_LINES, SHOWCASE_VOICE } from "./script.ts";
import { SHOWCASE_VOICE_DATA } from "./voice.generated.ts";

function wavInfo(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bits: view.getUint16(offset + 22, true),
      };
    }
    if (id === "data" && fmt) {
      return { ...fmt, samples: size / (fmt.bits / 8) / fmt.channels };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("wav without fmt/data chunks");
}

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
    const info = wavInfo(new Uint8Array(readFileSync(new URL(`../../public/${clip.file}`, import.meta.url))));
    assert.deepEqual([info.format, info.channels, info.sampleRate, info.bits], [1, 1, 48000, 16], clip.id);
    const wavMs = (info.samples / info.sampleRate) * 1000;
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
