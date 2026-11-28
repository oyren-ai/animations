import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createKalimbaPainter, KALIMBA_DISPLAY_TITLE } from "./paint.ts";

/**
 * Pyotr Ilyich Tchaikovsky's Dance of the Sugar Plum Fairy (The Nutcracker, Op. 71) performed on a
 * carved two-tier chromatic mahogany concert kalimba: four articulated plucking thumbs bend each
 * spring-steel tine under tension before snapping it free into damped cantilever oscillation as
 * acoustic pressure ripples pulse out of the central mahogany soundhole.
 */
export const MIDI_SUGAR_PLUM_KALIMBA: MidiSceneSpec = {
  id: "MidiSugarPlumKalimba",
  defaultTitle: KALIMBA_DISPLAY_TITLE,
  label: "Pyotr Ilyich Tchaikovsky  \u00b7  Concert Kalimba",
  leadFrames: 66,
  tailSec: 2.6,
  createPainter: createKalimbaPainter,
};
