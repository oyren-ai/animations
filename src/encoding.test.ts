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

test("scripts/render.mjs deduplicates overridden --crf and other default flags", async () => {
  const renderModUrl = new URL("../scripts/render.mjs", import.meta.url).href;
  const { buildRenderCliArgs } = (await import(renderModUrl)) as {
    buildRenderCliArgs: (cli: string, argv: string[]) => { output: string; args: string[] };
  };

  const defaults = buildRenderCliArgs("/bin/remotion", []);
  assert.deepEqual(defaults.args, [
    "/bin/remotion",
    "render",
    "src/index.ts",
    "PinballBumperMatrix",
    "out/pinball-bumper-matrix.mp4",
    "--codec=h264",
    "--pixel-format=yuv420p",
    "--crf=18",
    "--concurrency=1",
  ]);

  const gpuOverride = buildRenderCliArgs("/bin/remotion", [
    "CyberSynthShaderTunnel",
    "out/cyber-synth-shader-tunnel.mp4",
    "--gl=angle",
    "--crf=17",
    "--audio-codec=aac",
    "--audio-bitrate=192k",
  ]);
  const crfFlags = gpuOverride.args.filter((a) => a === "--crf" || a.startsWith("--crf="));
  assert.deepEqual(crfFlags, ["--crf=17"], "Expected --crf=17 only, without duplicate --crf=18");
  assert.ok(gpuOverride.args.includes("--codec=h264"));
  assert.ok(gpuOverride.args.includes("--pixel-format=yuv420p"));
  assert.ok(gpuOverride.args.includes("--concurrency=1"));

  const splitFlagOverride = buildRenderCliArgs("/bin/remotion", [
    "PolyphonicWallCascade",
    "out/wall.mp4",
    "--crf",
    "16",
    "--concurrency",
    "2",
  ]);
  assert.ok(!splitFlagOverride.args.includes("--crf=18"));
  assert.ok(!splitFlagOverride.args.includes("--concurrency=1"));
});
