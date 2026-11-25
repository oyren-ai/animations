import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createCanonPainter } from "./paint.ts";

/**
 * Canon in D, five voices: five horizontal lanes centred on x = 540 where Pachelbel's canon enters
 * one voice at a time (one thin melodic line growing into five layered counter-lines), with a live
 * "VOICES 1 2 3 4 5" indicator lighting up on each entrance up to the five-voice payoff.
 */
export const MIDI_CANON_VOICES: MidiSceneSpec = {
  id: "MidiCanonVoices",
  label: "Johann Pachelbel  \u00b7  Five Voices",
  leadFrames: 60,
  tailSec: 3.85,
  createPainter: createCanonPainter,
};
