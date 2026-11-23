import assert from "node:assert/strict";
import test from "node:test";
import { measureStereoLufsAndPeak } from "../audio-reactive/synth.ts";
import { buildShowcaseAudio, decodeStereoPcm16Wav, loadShowcaseVoice } from "./audio.ts";
import { SHOWCASE_FPS, SHOWCASE_TIMING } from "./timing.ts";

const timing = SHOWCASE_TIMING;
const voice = loadShowcaseVoice();
const bundle = buildShowcaseAudio(voice, timing);
const decoded = decodeStereoPcm16Wav(bundle.wav);

function rmsDb(channel: Float32Array, fromFrame: number, toFrame: number): number {
  const from = Math.round((fromFrame / SHOWCASE_FPS) * 48000);
  const to = Math.round((toFrame / SHOWCASE_FPS) * 48000);
  let sum = 0;
  for (let i = from; i < to; i++) sum += channel[i] * channel[i];
  return 10 * Math.log10(sum / Math.max(1, to - from) + 1e-12);
}

test("the mix is 48 kHz stereo PCM16 and exactly as long as the video", () => {
  assert.equal(decoded.sampleRate, 48000);
  assert.equal(decoded.left.length, decoded.right.length);
  const expected = Math.round((timing.totalFrames / SHOWCASE_FPS) * 48000);
  assert.ok(Math.abs(decoded.left.length - expected) <= 1, `${decoded.left.length} vs ${expected} samples`);
  assert.equal(voice.length, 5);
});

test("integrated loudness is about -14 LUFS with true peak at or below -1.5 dBTP", () => {
  const { integratedLufs, truePeakDb } = measureStereoLufsAndPeak(decoded.left, decoded.right);
  assert.ok(integratedLufs >= -14.6 && integratedLufs <= -13.4, `${integratedLufs} LUFS`);
  assert.ok(truePeakDb <= -1.5, `${truePeakDb} dBTP`);
  assert.ok(Math.abs(integratedLufs - bundle.integratedLufs) < 0.3, "reported loudness matches the encoded file");
});

test("the synth bed sits 12 LU under the voice before mastering", () => {
  const gap = bundle.voiceLufs - bundle.bedLufs;
  assert.ok(gap >= 11.5 && gap <= 12.5, `bed is ${gap} LU under the voice`);
});

test("the voice is clearly audible in every line window and the bed alone is quieter", () => {
  for (const line of timing.lines) {
    const speaking = rmsDb(decoded.left, line.startFrame, line.endFrame);
    const before = rmsDb(decoded.left, Math.max(0, line.startFrame - 10), line.startFrame - 2);
    assert.ok(speaking - before >= 4, `${line.id}: voice only ${(speaking - before).toFixed(1)} dB above the bed`);
  }
});

test("both channels carry the music, so the mix is stereo and not a duplicated mono track", () => {
  let difference = 0;
  for (let i = 0; i < decoded.left.length; i += 17) difference += Math.abs(decoded.left[i] - decoded.right[i]);
  assert.ok(difference > 1, "left and right are identical");
});

test("building the mix twice gives identical bytes", () => {
  const again = buildShowcaseAudio(voice, timing);
  assert.equal(Buffer.from(again.wav).equals(Buffer.from(bundle.wav)), true);
});
