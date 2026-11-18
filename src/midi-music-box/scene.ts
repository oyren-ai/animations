import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createMusicBoxPainter } from "./paint.ts";

/**
 * Für Elise on a physical music box: a rotating brass pinned cylinder (time -> angle, pitch -> horizontal
 * position) plucks a tuned steel comb at the bottom edge of the drum. Each passing pin deflects and releases
 * its steel tooth, which wobbles and rings while a centred progress ring tracks the piece.
 */
export const MIDI_FUR_ELISE_MUSIC_BOX: MidiSceneSpec = {
  id: "MidiFurEliseMusicBox",
  label: "Ludwig van Beethoven  \u00b7  Music Box",
  leadFrames: 66,
  tailSec: 2.6,
  createPainter: createMusicBoxPainter,
};
