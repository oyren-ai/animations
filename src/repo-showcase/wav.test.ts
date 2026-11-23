import assert from "node:assert/strict";
import test from "node:test";
import { leadingSilenceMs, parsePcm16Wav } from "./wav.ts";

function chunk(id: string, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(8 + payload.length + (payload.length % 2));
  for (let i = 0; i < 4; i++) result[i] = id.charCodeAt(i);
  new DataView(result.buffer).setUint32(4, payload.length, true);
  result.set(payload, 8);
  return result;
}

function format(channels = 1, encoding = 1, bits = 16, sampleRate = 48000): Uint8Array {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, encoding, true);
  view.setUint16(2, channels, true);
  view.setUint32(4, sampleRate, true);
  view.setUint32(8, sampleRate * channels * bits / 8, true);
  view.setUint16(12, channels * bits / 8, true);
  view.setUint16(14, bits, true);
  return bytes;
}

function pcm(...samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return bytes;
}

function wave(...chunks: Uint8Array[]): Uint8Array {
  const length = 12 + chunks.reduce((total, entry) => total + entry.length, 0);
  const bytes = new Uint8Array(length);
  bytes.set([82, 73, 70, 70], 0); // RIFF
  new DataView(bytes.buffer).setUint32(4, length - 8, true);
  bytes.set([87, 65, 86, 69], 8); // WAVE
  let offset = 12;
  for (const entry of chunks) {
    bytes.set(entry, offset);
    offset += entry.length;
  }
  return bytes;
}

test("shared WAV parser handles data before fmt, odd chunk padding, and a sliced buffer", () => {
  const encoded = wave(chunk("JUNK", Uint8Array.of(7)), chunk("data", pcm(0, 0, 300, -800)), chunk("fmt ", format()));
  const wrapped = new Uint8Array(encoded.length + 2);
  wrapped.set(encoded, 1);
  const parsed = parsePcm16Wav(wrapped.subarray(1, -1));
  assert.deepEqual([parsed.format, parsed.channels, parsed.sampleRate, parsed.bitsPerSample, parsed.frames], [1, 1, 48000, 16, 4]);
  assert.deepEqual(Array.from(parsed.samples), [0, 0, 300, -800]);
  assert.equal(leadingSilenceMs(wrapped.subarray(1, -1)), 1000 * 2 / 48000);
});

test("shared WAV parser counts interleaved stereo frames", () => {
  const parsed = parsePcm16Wav(wave(chunk("fmt ", format(2)), chunk("data", pcm(100, -100, 200, -200))));
  assert.equal(parsed.frames, 2);
  assert.deepEqual(Array.from(parsed.samples), [100, -100, 200, -200]);
});

test("shared WAV parser rejects invalid and truncated input", () => {
  const valid = wave(chunk("fmt ", format()), chunk("data", pcm(100)));
  assert.throws(() => parsePcm16Wav(new Uint8Array(4)), /RIFF|WAVE/);
  assert.throws(() => parsePcm16Wav(valid.subarray(0, -1)), /truncated/);
  assert.throws(() => parsePcm16Wav(wave(chunk("fmt ", format(1, 3)), chunk("data", pcm(100)))), /PCM16/);
  assert.throws(() => parsePcm16Wav(wave(chunk("fmt ", format(3)), chunk("data", pcm(100, 200, 300)))), /mono or stereo/);
  assert.throws(() => parsePcm16Wav(wave(chunk("fmt ", format()), chunk("data", Uint8Array.of(4)))), /aligned/);
  assert.throws(() => parsePcm16Wav(wave(chunk("fmt ", format()))), /data/);
});
