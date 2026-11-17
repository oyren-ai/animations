import type { MidiSceneSpec } from "../components/MidiShell.tsx";
import { createBallPianoPainter } from "./paint.ts";

/**
 * Ball Piano: every note is a glowing ball that falls from the top of the screen and lands on its key at
 * exactly the note-on time (release = note-on minus the fall time). The lead-in frames give the first ball
 * time to fall: 1.6 s of fall plus a short intro for the keyboard.
 */
export const BALL_PIANO: MidiSceneSpec = {
  id: "MidiBallPiano",
  label: "Ball Piano",
  leadFrames: 120,
  createPainter: createBallPianoPainter,
};
