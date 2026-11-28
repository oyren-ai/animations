import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createHarpPainter, HARP_DISPLAY_TITLE } from "./paint.ts";

/**
 * Antonio Vivaldi's Spring (The Four Seasons, Op. 8 No. 1, RV 269, I. Allegro) performed on a
 * gilded 29-string E-major concert pedal harp: four articulated plucking fingers bend and snap
 * colour-coded strings (red C#, blue F#, pearl-gold gut) into shimmering transverse standing waves.
 */
export const MIDI_SPRING_HARP: MidiSceneSpec = {
  id: "MidiSpringHarp",
  defaultTitle: HARP_DISPLAY_TITLE,
  label: "Antonio Vivaldi  \u00b7  Concert Pedal Harp",
  leadFrames: 66,
  tailSec: 2.6,
  createPainter: createHarpPainter,
};
