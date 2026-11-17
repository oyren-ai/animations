import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { RIPPLE_LEAD_FRAMES } from "./events.ts";
import { createRipplePainter } from "./paint.ts";

/**
 * Ripple Tank: every MIDI note drops into a neon water tank and sends out an expanding ring. Pitch sets the
 * source's x position and colour (teal low, amber high), velocity sets the ring's wavelength and height,
 * the voice sets its row, and chords make visible interference lattices. The surface is an analytic sum of
 * ring packets and their wall reflections, shaded as glossy water; loud chords and entrances kick the camera.
 */
export const RIPPLE_TANK: MidiSceneSpec = {
  id: "MidiRippleTank",
  label: "Ripple Tank",
  leadFrames: RIPPLE_LEAD_FRAMES,
  createPainter: createRipplePainter,
};
