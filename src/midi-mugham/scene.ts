import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createMughamPainter } from "./paint.ts";

/**
 * Mugham Nocturne: an original jazz-mugham composition in D Shur (with +40c microtonal Eb bends),
 * pairing a fretted horizontal Tar + sympathetic strings above with exposed grand-piano felt hammers +
 * upright double bass below across a shared pitch axis and a central 7/8 (2+2+3) jazz-brush medallion.
 */
export const MIDI_MUGHAM_NOCTURNE: MidiSceneSpec = {
  id: "MidiMughamNocturne",
  defaultTitle: "Mugham Nocturne",
  label: "Original \u00b7 jazz-mugham style",
  leadFrames: 54,
  tailSec: 2.2,
  brand: "quiet",
  createPainter: createMughamPainter,
};
