import assert from "node:assert/strict";
import test from "node:test";
import {
  addBassNote,
  addHiHat,
  addKick,
  addPadChord,
  addPluck,
  addSnare,
  calibrateStereoMaster,
  createStereoBuffer,
  encodeStereoPcm16Wav,
  extractFrameAudioFeatures,
  measureStereoLufsAndPeak,
  panGains,
  STEREO_SAMPLE_RATE,
} from "./synth.ts";

test("panGains preserves constant power across [-1, 1]", () => {
  for (const pan of [-1, -0.65, -0.2, 0, 0.35, 0.8, 1]) {
    const { left, right } = panGains(pan);
    const power = left * left + right * right;
    assert.ok(Math.abs(power - 1) < 1e-6, `Expected unit power at pan=${pan}, got ${power}`);
  }
  const hardLeft = panGains(-1);
  assert.ok(hardLeft.left > 0.999 && hardLeft.right < 1e-6);
  const hardRight = panGains(1);
  assert.ok(hardRight.right > 0.999 && hardRight.left < 1e-6);
});

test("encodeStereoPcm16Wav writes a valid 48 kHz 2-channel 16-bit RIFF header and works without Node Buffer", () => {
  const frames = 60; // 1.0s at 60 fps
  const buf = createStereoBuffer(frames, 60);
  assert.equal(buf.left.length, STEREO_SAMPLE_RATE);
  assert.equal(buf.right.length, STEREO_SAMPLE_RATE);

  buf.left[0] = 0.5;
  buf.right[0] = -0.5;

  const savedBuffer = (globalThis as Record<string, unknown>).Buffer;
  let wav: Uint8Array;
  try {
    (globalThis as Record<string, unknown>).Buffer = undefined;
    wav = encodeStereoPcm16Wav(buf.left, buf.right);
  } finally {
    (globalThis as Record<string, unknown>).Buffer = savedBuffer;
  }

  const ascii = new TextDecoder("ascii");
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(ascii.decode(wav.subarray(0, 4)), "RIFF");
  assert.equal(ascii.decode(wav.subarray(8, 16)), "WAVEfmt ");
  assert.equal(view.getUint16(20, true), 1); // PCM
  assert.equal(view.getUint16(22, true), 2); // Stereo
  assert.equal(view.getUint32(24, true), 48000); // 48 kHz
  assert.equal(view.getUint32(28, true), 48000 * 4); // byteRate
  assert.equal(view.getUint16(32, true), 4); // blockAlign
  assert.equal(view.getUint16(34, true), 16); // bitsPerSample
  assert.equal(view.getUint32(40, true), STEREO_SAMPLE_RATE * 4);
  assert.equal(wav.byteLength, 44 + STEREO_SAMPLE_RATE * 4);
  assert.equal(view.getInt16(44, true), Math.round(0.5 * 32767));
  assert.equal(view.getInt16(46, true), Math.round(-0.5 * 32767));
});

test("calibrateStereoMaster hits ~-14 LUFS target, keeps true peak <= -1.5 dBTP, and stays deterministic", () => {
  const fps = 60;
  const totalFrames = 240; // 4 seconds
  const build = () => {
    const buf = createStereoBuffer(totalFrames, fps);
    addPadChord(buf, {
      startSec: 0,
      durationSec: 4,
      frequencies: [130.81, 196.0, 246.94, 293.66],
      gain: 0.18,
      stereoSpread: 0.65,
    });
    for (let beat = 0; beat < 8; beat++) {
      const sec = beat * 0.5;
      addKick(buf, { startSec: sec, gain: 0.55 });
      if (beat % 2 === 1) addSnare(buf, { startSec: sec, gain: 0.28, seed: 100 + beat });
      addHiHat(buf, { startSec: sec + 0.25, gain: 0.14, pan: beat % 2 === 0 ? -0.35 : 0.35, seed: 200 + beat });
      addBassNote(buf, { startSec: sec, durationSec: 0.45, frequency: beat < 4 ? 65.41 : 73.42, gain: 0.32 });
      addPluck(buf, {
        startSec: sec + 0.125,
        durationSec: 0.35,
        frequency: 261.63 * (1 + (beat % 4) * 0.25),
        gain: 0.22,
        pan: -0.6 + (beat % 5) * 0.3,
      });
    }
    calibrateStereoMaster(buf, { targetLufs: -14.0, ceilingDbTp: -1.8 });
    return buf;
  };

  const a = build();
  const b = build();
  assert.deepEqual(encodeStereoPcm16Wav(a.left, a.right), encodeStereoPcm16Wav(b.left, b.right));

  const metrics = measureStereoLufsAndPeak(a.left, a.right);
  assert.ok(
    metrics.integratedLufs >= -15.0 && metrics.integratedLufs <= -13.0,
    `Expected integrated LUFS near -14, got ${metrics.integratedLufs.toFixed(2)}`,
  );
  assert.ok(
    metrics.truePeakDb <= -1.5,
    `Expected oversampled true peak <= -1.5 dBTP, got ${metrics.truePeakDb.toFixed(2)} dBTP`,
  );
});

test("extractFrameAudioFeatures separates kick sub-bass from high-frequency plucks deterministically", () => {
  const fps = 60;
  const totalFrames = 120; // 2.0s
  const buf = createStereoBuffer(totalFrames, fps);

  // Kick at t = 0.25s (frame 15)
  addKick(buf, { startSec: 0.25, gain: 0.8 });
  // Bright high-pitched pluck + hi-hat at t = 1.25s (frame 75), panned hard right
  addPluck(buf, { startSec: 1.25, durationSec: 0.25, frequency: 2093.0, gain: 0.45, pan: 0.85 });
  addHiHat(buf, { startSec: 1.25, durationSec: 0.12, gain: 0.35, pan: 0.85, seed: 42 });

  const featuresA = extractFrameAudioFeatures(buf.left, buf.right, fps);
  const featuresB = extractFrameAudioFeatures(buf.left, buf.right, fps);
  assert.equal(featuresA.length, totalFrames);

  for (let i = 0; i < totalFrames; i++) {
    assert.equal(featuresA[i].spectrumBins.length, 32);
    assert.equal(featuresA[i].kickImpulse, featuresB[i].kickImpulse);
    assert.deepEqual(featuresA[i].spectrumBins, featuresB[i].spectrumBins);
  }

  const kickFrame = featuresA[16];
  const quietFrame = featuresA[55];
  const highFrame = featuresA[76];

  assert.ok(
    kickFrame.subBass > quietFrame.subBass + 0.35 && kickFrame.kickImpulse > 0.45,
    `Expected strong kick impulse/subBass near frame 16, got subBass=${kickFrame.subBass}, kick=${kickFrame.kickImpulse}`,
  );
  assert.ok(
    highFrame.high > kickFrame.high && highFrame.stereoWidth > kickFrame.stereoWidth,
    `Expected brighter high band and wider stereo field on panned pluck at frame 76`,
  );
});
