import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MIDI_COMPOSITION_DEFS } from "../src/midi/compositions.tsx";
import { midiAudioFile } from "../src/midi/timeline.ts";
import { VIDEO } from "../src/settings.ts";

/**
 * Frame-exact render of a MIDI scene: render the picture with Remotion (muted), then mux the synthesised WAV
 * with ffmpeg. Remotion copies raw AAC into the MP4 without an edit list, so players hear its audio about
 * 43 ms (two AAC frames) late; encoding the audio with ffmpeg writes the priming offset and keeps it in sync.
 *
 *   node --import tsx scripts/render-midi.ts MidiBallPiano out/ball.mp4 [--props='{"midiFile":"x.mid"}'] [remotion flags]
 *
 * Needs the WAV from `pnpm assets` and an ffmpeg with the aac encoder on PATH (override with FFMPEG=/path/to/ffmpeg).
 */
const [composition, output, ...extra] = process.argv.slice(2);
const def = MIDI_COMPOSITION_DEFS.find((candidate) => candidate.id === composition);
if (!def || !output) {
  console.error("Usage: render-midi.ts <" + MIDI_COMPOSITION_DEFS.map((d) => d.id).join("|") + "> <out.mp4> [--props=JSON] [remotion flags]");
  process.exit(2);
}

let midiFile = def.defaultMidi;
const propsIndex = extra.findIndex((arg) => arg === "--props" || arg.startsWith("--props="));
if (propsIndex >= 0) {
  const raw = extra[propsIndex] === "--props" ? extra[propsIndex + 1] ?? "{}" : extra[propsIndex].slice("--props=".length);
  const parsed = JSON.parse(existsSync(raw) ? readFileSync(raw, "utf8") : raw) as { midiFile?: string };
  if (parsed.midiFile) midiFile = parsed.midiFile;
}
const wav = fileURLToPath(new URL("../public/" + midiAudioFile(midiFile), import.meta.url));
if (!existsSync(wav)) throw new Error(`${wav} is missing: run \`pnpm assets\` first`);

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("@remotion/cli/package.json")), "remotion-cli.js");
const work = mkdtempSync(join(tmpdir(), "render-midi-"));
const silent = join(work, "picture.mp4");
const muxed = join(work, "muxed.mp4"); // mux locally, then copy: faststart rewrites the file, which is slow on network drives
const out = resolve(output);
mkdirSync(dirname(out), { recursive: true });
try {
  const render = spawnSync(process.execPath, [
    cli, "render", "src/index.ts", composition, silent, "--codec=h264", "--pixel-format=yuv420p", "--crf=18", "--muted", ...extra,
  ], { stdio: "inherit", env: process.env, cwd: root });
  if (render.status !== 0) throw new Error("Remotion render failed");
  // Audio placed at the lead-in with sample accuracy (800 samples per frame at 48 kHz / 60 fps). The WAV ends with
  // the ring-out tail, so with the lead-in it reaches the end of the picture to within one frame.
  const delay = Math.round(def.spec.leadFrames * 48000 / VIDEO.fps) + "S";
  const mux = spawnSync(process.env.FFMPEG ?? "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", silent, "-i", wav,
    "-filter_complex", `[1:a]adelay=${delay}|${delay}[audio]`,
    "-map", "0:v", "-map", "[audio]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
    "-movflags", "+faststart", muxed,
  ], { stdio: "inherit" });
  if (mux.status !== 0) throw new Error("ffmpeg mux failed");
  copyFileSync(muxed, out);
  console.log("Wrote " + out);
} finally {
  rmSync(work, { recursive: true, force: true });
}
