import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE_RATE, SAMPLES_PER_FRAME, synthesize, tonesFor, waveTones } from "./audio.ts";
import { SCENE_FRAMES, TOTAL_FRAMES } from "./settings.ts";

test("procedural audio is deterministic PCM16 with exact frame-aligned duration", () => {
  const cues = tonesFor([{ frame: 1, type: "hit", x: 540, y: 900 }]);
  const wav = synthesize(cues);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 16), "WAVEfmt ");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(24), SAMPLE_RATE);
  assert.equal(wav.length, 44 + TOTAL_FRAMES * SAMPLES_PER_FRAME * 2);
  assert.deepEqual(wav, synthesize(cues));
  let peak = 0;
  for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)) / 32767);
  assert.ok(peak > 0.49 && peak < 0.51);
});

test("every composition has closing cues and invalid cue positions are rejected", () => {
  for (const tones of [tonesFor([]), waveTones()]) assert.ok(tones.some((tone) => tone.frame === SCENE_FRAMES));
  assert.throws(() => synthesize([{ frame: TOTAL_FRAMES, frequency: 440, amplitude: 1, length: 1 }]), /cue/);
  assert.throws(() => synthesize([{ frame: -1, frequency: 440, amplitude: 1, length: 1 }]), /cue/);
});
