import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createHarpsichordPainter, HARPSICHORD_DISPLAY_TITLE } from "./paint.ts";

/**
 * Wolfgang Amadeus Mozart's Turkish March (Rondo Alla Turca, K. 331, III) performed on a cutaway
 * mechanical plucked concert harpsichord: reversed-colour ebony/ivory keys lift wooden jacks fitted
 * with crow-quill plectra to pluck 41 graduated brass strings into transverse standing waves.
 */
export const MIDI_TURKISH_MARCH_HARPSICHORD: MidiSceneSpec = {
  id: "MidiTurkishMarchHarpsichord",
  defaultTitle: HARPSICHORD_DISPLAY_TITLE,
  label: "Wolfgang Amadeus Mozart  \u00b7  Concert Harpsichord",
  leadFrames: 66,
  tailSec: 2.4,
  createPainter: createHarpsichordPainter,
};
