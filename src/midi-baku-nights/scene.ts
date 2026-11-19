import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createBakuNightsPainter } from "./paint.ts";

/**
 * Baku Nights: an original slow lyrical nocturne in a C Rast-inspired mode (78 BPM, 4/4; title only,
 * unrelated to any existing song). A silhouetted lamplighter walks a seaside boulevard at night,
 * raising his glowing brass pole to light one streetlamp per piano melody note while a symmetric
 * 96-window stone skyline illuminates across the build and bass swells cross the dark harbour water.
 */
export const MIDI_BAKU_NIGHTS: MidiSceneSpec = {
  id: "MidiBakuNights",
  defaultTitle: "Baku Nights",
  label: "Original \u00b7 lyrical nocturne",
  leadFrames: 60,
  tailSec: 2.2,
  brand: "quiet",
  createPainter: createBakuNightsPainter,
};
