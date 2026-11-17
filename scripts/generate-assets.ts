import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { auditTrace, simulate, STYLES } from "../src/ball-drop/sim.ts";
import { COUNTRY_MAPS } from "../src/country-maps/fourier.ts";
import {
  buildCombinedStringTimeline,
  COMBINED_CLOSING_FRAMES,
  simulateStringRound,
  STRING_ROUNDS,
} from "../src/string-arena/sim.ts";
import {
  buildCombinedDropTimeline,
  DROP_STYLES,
  simulateDropArena,
} from "../src/drop-arenas/sim.ts";
import { PATATE_COMPOSITIONS, simulatePatate } from "../src/patate/sim.ts";
import { synthesizePatateWav } from "../src/patate/audio.ts";
import { GPU_AUDIO_COMPOSITIONS, synthesizeGpuAudioSceneWav } from "../src/gpu-scenes/index.ts";
import { synthesizeShowcaseWav } from "../src/repo-showcase/audio.ts";
import { SHOWCASE_TOTAL_FRAMES } from "../src/repo-showcase/timing.ts";
import {
  synthesize,
  synthesizeCountryMapWav,
  synthesizeDropArenaWav,
  synthesizeStringArenaWav,
  tonesFor,
  waveTones,
} from "../src/audio.ts";
import { TOTAL_FRAMES, VIDEO } from "../src/settings.ts";

const directory = fileURLToPath(new URL("../public/generated/", import.meta.url));
mkdirSync(directory, { recursive: true });

// Optional local vector emblem atlas (gitignored; defaults to empty {} for MIT procedural badges)
const customLogoJsonPath = process.env.OYREN_BRAND_LOGOS_JSON;
const localLogosPayload = customLogoJsonPath
  ? readFileSync(customLogoJsonPath, "utf8")
  : "{}\n";
writeFileSync(
  new URL("../public/generated/local-logos.json", import.meta.url),
  localLogosPayload,
);

const results = [];
for (const style of STYLES) {
  const trace = simulate(style.slug), errors = auditTrace(trace);
  if (errors.length) throw new Error(style.id + ": " + errors.join("; "));
  const wav = synthesize(tonesFor(trace.events));
  writeFileSync(new URL("../public/generated/" + style.slug + ".wav", import.meta.url), wav);
  results.push({ id: style.id, seed: style.seed, frames: TOTAL_FRAMES,
    eventDigest: createHash("sha256").update(JSON.stringify(trace.events)).digest("hex"),
    audioDigest: createHash("sha256").update(wav).digest("hex") });
  console.log(style.id + ": " + trace.events.length + " events; " + TOTAL_FRAMES + " frames");
}
const wave = synthesize(waveTones());
writeFileSync(new URL("../public/generated/pendulum-wave.wav", import.meta.url), wave);
results.push({ id: "PendulumWave", frames: TOTAL_FRAMES, audioDigest: createHash("sha256").update(wave).digest("hex") });

for (const map of COUNTRY_MAPS) {
  const wav = synthesizeCountryMapWav(map.slug);
  writeFileSync(new URL("../public/generated/" + map.slug + ".wav", import.meta.url), wav);
  results.push({ id: map.id, frames: TOTAL_FRAMES, audioDigest: createHash("sha256").update(wav).digest("hex") });
  console.log(map.id + ": harmonic audio synthesized; " + TOTAL_FRAMES + " frames");
}

for (const round of STRING_ROUNDS) {
  const trace = simulateStringRound(round.slug);
  const totalFrames = trace.totalRoundFrames + COMBINED_CLOSING_FRAMES;
  const wav = synthesizeStringArenaWav(
    [{ startFrame: 0, trace }],
    trace.totalRoundFrames,
    totalFrames,
  );
  writeFileSync(new URL("../public/generated/" + round.slug + ".wav", import.meta.url), wav);
  results.push({
    id: round.id,
    seed: round.seed,
    frames: totalFrames,
    audioDigest: createHash("sha256").update(wav).digest("hex"),
  });
  console.log(`${round.id}: ${trace.events.length} events; ${totalFrames} frames`);
}

const combinedStrings = buildCombinedStringTimeline();
const combinedStringsWav = synthesizeStringArenaWav(
  combinedStrings.rounds,
  combinedStrings.sceneFrames,
  combinedStrings.totalFrames,
);
writeFileSync(
  new URL("../public/generated/string-arenas-combined.wav", import.meta.url),
  combinedStringsWav,
);
results.push({
  id: "StringArenasCombined",
  frames: combinedStrings.totalFrames,
  audioDigest: createHash("sha256").update(combinedStringsWav).digest("hex"),
});
console.log(`StringArenasCombined: ${combinedStrings.totalFrames} frames (${(combinedStrings.totalFrames / VIDEO.fps).toFixed(2)}s)`);

for (const drop of DROP_STYLES) {
  const trace = simulateDropArena(drop.slug, "standalone");
  const sceneFrames = trace.frames.length - 1;
  const wav = synthesizeDropArenaWav(
    [{ startFrame: 0, trace }],
    sceneFrames,
    trace.totalFrames,
  );
  writeFileSync(new URL("../public/generated/" + drop.slug + ".wav", import.meta.url), wav);
  results.push({
    id: drop.id,
    seed: trace.seed,
    frames: trace.totalFrames,
    audioDigest: createHash("sha256").update(wav).digest("hex"),
  });
  console.log(`${drop.id}: ${trace.events.length} events; ${trace.totalFrames} frames (${(trace.totalFrames / VIDEO.fps).toFixed(2)}s)`);
}

const combinedDrops = buildCombinedDropTimeline();
const combinedDropsWav = synthesizeDropArenaWav(
  combinedDrops.stages,
  combinedDrops.sceneFrames,
  combinedDrops.totalFrames,
);
writeFileSync(
  new URL("../public/generated/ball-drop-combined.wav", import.meta.url),
  combinedDropsWav,
);
results.push({
  id: "BallDropCombined",
  frames: combinedDrops.totalFrames,
  audioDigest: createHash("sha256").update(combinedDropsWav).digest("hex"),
});
console.log(`BallDropCombined: ${combinedDrops.totalFrames} frames (${(combinedDrops.totalFrames / VIDEO.fps).toFixed(2)}s)`);

for (const patate of PATATE_COMPOSITIONS) {
  const trace = simulatePatate(patate.slug);
  const wav = synthesizePatateWav(trace);
  writeFileSync(
    new URL("../public/generated/" + patate.slug + ".wav", import.meta.url),
    wav,
  );
  results.push({
    id: patate.id,
    seed: trace.seed,
    frames: trace.totalFrames,
    audioDigest: createHash("sha256").update(wav).digest("hex"),
  });
  console.log(
    `${patate.id}: ${trace.events.length} events; bossFrame=${trace.bossMergeFrame}; ${trace.totalFrames} frames (${(trace.totalFrames / VIDEO.fps).toFixed(2)}s)`,
  );
}

for (const gpuScene of GPU_AUDIO_COMPOSITIONS) {
  const wav = synthesizeGpuAudioSceneWav(gpuScene.slug);
  writeFileSync(
    new URL("../public/generated/" + gpuScene.slug + ".wav", import.meta.url),
    wav,
  );
  results.push({
    id: gpuScene.id,
    frames: gpuScene.totalFrames,
    channels: 2,
    sampleRate: 48000,
    audioDigest: createHash("sha256").update(wav).digest("hex"),
  });
  console.log(
    `${gpuScene.id}: 48 kHz stereo audio synthesized; ${gpuScene.totalFrames} frames (${(gpuScene.totalFrames / VIDEO.fps).toFixed(2)}s)`,
  );
}

const showcaseWav = synthesizeShowcaseWav();
writeFileSync(new URL("../public/generated/animations-repo-showcase.wav", import.meta.url), showcaseWav);
results.push({
  id: "AnimationsRepoShowcase",
  frames: SHOWCASE_TOTAL_FRAMES,
  channels: 2,
  sampleRate: 48000,
  audioDigest: createHash("sha256").update(showcaseWav).digest("hex"),
});
console.log(`AnimationsRepoShowcase: English voice + 48 kHz stereo bed; ${SHOWCASE_TOTAL_FRAMES} frames (${(SHOWCASE_TOTAL_FRAMES / VIDEO.fps).toFixed(2)}s)`);

writeFileSync(new URL("../public/generated/manifest.json", import.meta.url), JSON.stringify({ fps: VIDEO.fps, results }, null, 2) + "\n");
console.log("Generated audio and manifest for " + results.length + " compositions.");
