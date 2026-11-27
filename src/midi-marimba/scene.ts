import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createMarimbaPainter, MARIMBA_DISPLAY_TITLE } from "./paint.ts";

/**
 * Christian Petzold's Minuet in G Major (BWV Anh. 114) on a physical two-tier concert rosewood marimba:
 * four articulated Stevens-grip mallets wind up along parabolic arcs and strike each rosewood bar on the
 * exact frame of note-on, sending glowing acoustic pressure pulses down its tuned brass resonator tube.
 */
export const MIDI_MINUET_MARIMBA: MidiSceneSpec = {
  id: "MidiMinuetMarimba",
  defaultTitle: MARIMBA_DISPLAY_TITLE,
  label: "Christian Petzold  \u00b7  Concert Marimba",
  leadFrames: 66,
  tailSec: 2.6,
  createPainter: createMarimbaPainter,
};
