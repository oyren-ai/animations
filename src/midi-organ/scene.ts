import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createOrganPainter, ORGAN_DISPLAY_TITLE } from "./paint.ts";

/**
 * Johann Sebastian Bach's Toccata in D Minor (BWV 565) performed on a mechanical tracker pipe organ:
 * depressing chromatic manual keys visibly pull brass tracker rods through a rollerboard to swing open
 * pallet valves beneath a 44-pipe symmetric cathedral facade, sending luminous wind columns through every speaking pipe.
 */
export const MIDI_TOCCATA_ORGAN: MidiSceneSpec = {
  id: "MidiToccataOrgan",
  defaultTitle: ORGAN_DISPLAY_TITLE,
  label: "Johann Sebastian Bach  \u00b7  Tracker Pipe Organ",
  leadFrames: 66,
  tailSec: 2.8,
  createPainter: createOrganPainter,
};
