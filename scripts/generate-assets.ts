import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { auditTrace, simulate, STYLES } from "../src/ball-drop/sim.ts";
import { synthesize, tonesFor, waveTones } from "../src/audio.ts";
import { TOTAL_FRAMES, VIDEO } from "../src/settings.ts";

const directory = fileURLToPath(new URL("../public/generated/", import.meta.url));
mkdirSync(directory, { recursive: true });
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
writeFileSync(new URL("../public/generated/manifest.json", import.meta.url), JSON.stringify({ fps: VIDEO.fps, results }, null, 2) + "\n");
console.log("Generated audio and manifest for five compositions.");
