import { staticFile } from "remotion";
import { parseMidi } from "./parse.ts";
import type { ParsedMidi } from "./types.ts";

const cache = new Map<string, Promise<ParsedMidi>>();

/** Fetch and parse a file from public/midi (browser, inside a Remotion bundle). Cached per file name. */
export function loadParsedMidi(midiFile: string): Promise<ParsedMidi> {
  let promise = cache.get(midiFile);
  if (!promise) {
    promise = fetch(staticFile("midi/" + midiFile)).then(async (response) => {
      if (!response.ok) throw new Error(`public/midi/${midiFile} not found (HTTP ${response.status})`);
      return parseMidi(new Uint8Array(await response.arrayBuffer()));
    });
    cache.set(midiFile, promise);
  }
  return promise;
}
