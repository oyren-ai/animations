import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createBumblebeePainter } from "./paint.ts";

/**
 * Flight of the Bumblebee: falling MIDI note bars onto a full-width piano keyboard while a hero bumblebee
 * (and a growing swarm) flies along Rimsky-Korsakov's score-verified chromatic melody at steady Vivace tempo,
 * building to the three-octave finale rocket before settling cleanly to the opening hover.
 */
export const MIDI_BUMBLEBEE: MidiSceneSpec = {
  id: "MidiBumblebee",
  defaultTitle: "Flight of the Bumblebee",
  label: "Nikolai Rimsky-Korsakov  \u00b7  Vivace",
  leadFrames: 72,
  tailSec: 2.1,
  createPainter: createBumblebeePainter,
};
