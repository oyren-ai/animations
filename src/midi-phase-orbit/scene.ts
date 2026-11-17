import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createOrbitPainter } from "./paint.ts";

/**
 * Phase Orbit: a radial piano roll for phasing music. Pitch is the ring (rank-based, like record grooves),
 * time is the angle (one bar = one revolution), notes are glowing arcs coloured by voice, and a playhead
 * sweeps once per bar, striking each arc with a white-hot flash and a burst of sparks. Voices that loop at
 * slightly different lengths visibly slide against each other and snap back into unison.
 *
 * The 66 lead-in frames (1.1 s) draw the rings in and start the playhead sweeping from 7 o'clock, so it
 * reaches 12 o'clock exactly on the first note.
 */
export const PHASE_ORBIT: MidiSceneSpec = {
  id: "MidiPhaseOrbit",
  label: "Phase Orbit",
  leadFrames: 66,
  createPainter: createOrbitPainter,
};
