import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMidi } from "../src/midi/parse.ts";
import { builtInPieces, pieceBytes } from "../src/midi/pieces.ts";
import { synthesizeMidiToWav } from "../src/midi/synth.ts";
import { MIDI_TAIL_SEC, midiAudioFile } from "../src/midi/timeline.ts";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const repoMidiDir = fileURLToPath(new URL("../midi/", import.meta.url));

const REPO_MIDI_EXPORT_NAME: Record<string, string> = {
  "mugham-nocturne.mid": "mugham-nocturne.mid",
  "baku-nights.mid": "baku-nights.mid",
  "canon-in-d-five-voices.mid": "canon-five-voices.mid",
  "fur-elise-music-box.mid": "fur-elise.mid",
  "flight-of-the-bumblebee.mid": "flight-of-the-bumblebee.mid",
  "arshin-mal-alan-askars-song.mid": "arshin-mal-alan-askars-song.mid",
  "minuet-in-g-marimba.mid": "minuet-in-g-marimba.mid",
  "ode-to-joy-carillon.mid": "ode-to-joy-carillon.mid",
  "toccata-in-d-minor-organ.mid": "toccata-in-d-minor-organ.mid",
  "toccata-opening-organ.mid": "toccata-opening-organ.mid",
  "sugar-plum-kalimba.mid": "sugar-plum-kalimba.mid",
  "turkish-march-harpsichord.mid": "turkish-march-harpsichord.mid",
  "spring-concert-harp.mid": "spring-concert-harp.mid",
};

export interface MidiAssetResult { file: string; wav: string; notes: number; durationSec: number; midiDigest: string; audioDigest: string }

function writeIfChanged(path: string, bytes: Buffer): void {
  if (!existsSync(path) || !readFileSync(path).equals(bytes)) writeFileSync(path, bytes);
}

/**
 * 1. Write the built-in pieces (authored in src/midi/pieces.ts) to public/midi/*.mid and midi/*.mid.
 * 2. Synthesise a WAV for every .mid in public/midi, built-in or dropped in by hand, to
 *    public/generated/midi-<name>.wav. The MIDI scenes play that WAV, so a new file only needs `pnpm assets`.
 */
export function generateMidiAssets(): MidiAssetResult[] {
  const midiDir = publicDir + "midi/";
  mkdirSync(midiDir, { recursive: true });
  mkdirSync(repoMidiDir, { recursive: true });
  mkdirSync(publicDir + "generated/", { recursive: true });
  for (const piece of builtInPieces()) {
    const bytes = Buffer.from(pieceBytes(piece));
    writeIfChanged(midiDir + piece.file, bytes);
    const exportedName = REPO_MIDI_EXPORT_NAME[piece.file];
    if (exportedName) writeIfChanged(repoMidiDir + exportedName, bytes);
  }
  const results: MidiAssetResult[] = [];
  for (const file of readdirSync(midiDir).filter((name) => /\.midi?$/i.test(name)).sort()) {
    const bytes = readFileSync(midiDir + file);
    const parsed = parseMidi(bytes);
    const wav = synthesizeMidiToWav(parsed, { tailSec: MIDI_TAIL_SEC });
    writeIfChanged(publicDir + midiAudioFile(file), wav);
    results.push({
      file, wav: midiAudioFile(file), notes: parsed.notes.length, durationSec: parsed.durationSec,
      midiDigest: createHash("sha256").update(bytes).digest("hex"),
      audioDigest: createHash("sha256").update(wav).digest("hex"),
    });
    console.log(`public/midi/${file}: ${parsed.notes.length} notes, ${parsed.durationSec.toFixed(2)} s -> ${midiAudioFile(file)}`);
  }
  return results;
}

// Allow `node --import tsx scripts/generate-midi-assets.ts` on its own.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) generateMidiAssets();
