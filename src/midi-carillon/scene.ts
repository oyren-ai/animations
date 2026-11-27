import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { CARILLON_DISPLAY_TITLE, createCarillonPainter } from "./paint.ts";

/**
 * Beethoven's Ode to Joy (Symphony No. 9, IV) played by a 22-bell cast-bronze belfry carillon:
 * braided ropes pull taut before each beat, swinging each bronze bell on its oak yoke while its brass
 * clapper strikes the sound-bow on the exact frame of note-on and radiates acoustic shockwaves.
 */
export const MIDI_ODE_TO_JOY_CARILLON: MidiSceneSpec = {
  id: "MidiOdeToJoyCarillon",
  defaultTitle: CARILLON_DISPLAY_TITLE,
  label: "Ludwig van Beethoven  \u00b7  Belfry Carillon",
  leadFrames: 66,
  tailSec: 2.6,
  createPainter: createCarillonPainter,
};
