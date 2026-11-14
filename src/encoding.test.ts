import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pngToBt709 } from "./encoding.ts";

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve("@remotion/cli/package.json"));
const renderer = dirname(cliRequire.resolve("@remotion/renderer/package.json"));
const { generateFfmpegArgs } = require(join(renderer, "dist/ffmpeg-args.js"));

test("the actual pinned renderer filter converts RGB without an incorrect input matrix", () => {
  const original = generateFfmpegArgs({
    hasPreencoded: false, proResProfileName: undefined, pixelFormat: "yuv420p",
    x264Preset: "fast", gopSize: null, codec: "h264", crf: 18,
    videoBitrate: null, encodingMaxRate: null, encodingBufferSize: null,
    colorSpace: "bt709", hardwareAcceleration: "disable", indent: false, logLevel: "error",
  }).flat();
  const before = [...original], converted = pngToBt709(original);
  assert.deepEqual(original, before, "the override does not mutate its input");
  const filter = converted[converted.indexOf("-vf") + 1];
  assert.ok(filter.includes("range=limited"));
  assert.ok(filter.includes("primariesin=709:transferin=709"));
  assert.ok(!filter.includes("matrixin="), "the PNG decoder supplies the RGB input matrix");
  for (const value of ["yuv420p", "bt709", "tv"]) assert.ok(converted.includes(value));
});

test("the final copy-only mux preserves the already converted stream", () => {
  const args = ["-i", "video.mp4", "-c:v", "copy", "final.mp4"];
  assert.deepEqual(pngToBt709(args), args);
});

test("unexpected encoder filters fail explicitly", () => {
  assert.throws(() => pngToBt709(["-c:v", "libx264"]), /filter/);
  assert.throws(() => pngToBt709(["-vf", "scale=540:960"]), /filter changed/);
});
