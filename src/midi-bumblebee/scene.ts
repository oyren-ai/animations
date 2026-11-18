import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createBumblebeePainter } from "./paint.ts";

/**
 * Flight of the Bumblebee: falling MIDI note bars onto a full-width piano keyboard while a hero bumblebee
 * (and a growing swarm) flies along the melodic contour. A live notes-per-second readout climbs across
 * the four-stage accelerando up to the three-octave finale rocket, then settles cleanly to the opening hover.
 */
export const MIDI_BUMBLEBEE: MidiSceneSpec = {
  id: "MidiBumblebee",
  label: "Nikolai Rimsky-Korsakov  \u00b7  MIDI Speed Run",
  leadFrames: 72,
  tailSec: 2.1,
  createPainter: createBumblebeePainter,
};
