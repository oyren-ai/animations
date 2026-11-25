import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createArshinPainter } from "./paint.ts";

/**
 * Arshin Mal Alan (No. 12 "Askar's Song", Act II): a dusk street-market cloth peddler behind a walnut
 * counter at x = 540 measures and snips one jewel-toned silk cloth along an engraved brass arshin stick
 * for every vocal melody note, hanging the measured cloths across three overhead courtyard lines (first
 * pass left-to-centre, repeats right-to-centre with gold trim) before folding them away for a clean loop.
 */
export const MIDI_ARSHIN_MAL_ALAN: MidiSceneSpec = {
  id: "MidiArshinMalAlan",
  defaultTitle: "Arshin Mal Alan",
  label: "Uzeyir Hajibeyov, 1913",
  leadFrames: 42,
  tailSec: 2.2,
  brand: "quiet",
  createPainter: createArshinPainter,
};
