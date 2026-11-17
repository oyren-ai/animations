import { Composition } from "remotion";
import { createMidiMetadata, createMidiShell, type MidiSceneSpec } from "../components/MidiShell.tsx";
import { BALL_PIANO } from "../midi-ball-piano/scene.ts";
import { PHASE_ORBIT } from "../midi-phase-orbit/scene.ts";
import { RIPPLE_TANK } from "../midi-ripple-tank/scene.ts";
import { VIDEO } from "../settings.ts";

export interface MidiCompositionDef { id: string; spec: MidiSceneSpec; defaultMidi: string }

/** Three MIDI-driven scenes. Each takes a `midiFile` prop naming any file in public/midi. */
export const MIDI_COMPOSITION_DEFS: MidiCompositionDef[] = [
  { id: "MidiBallPiano", spec: BALL_PIANO, defaultMidi: "ode-to-joy.mid" },
  { id: "MidiRippleTank", spec: RIPPLE_TANK, defaultMidi: "canon-in-d.mid" },
  { id: "MidiPhaseOrbit", spec: PHASE_ORBIT, defaultMidi: "pentatonic-phase.mid" },
];

const COMPONENTS = MIDI_COMPOSITION_DEFS.map((def) => ({ def, component: createMidiShell(def.spec), calculateMetadata: createMidiMetadata(def.spec) }));

export function MidiCompositions() {
  return <>
    {COMPONENTS.map(({ def, component, calculateMetadata }) => (
      <Composition
        key={def.id}
        id={def.id}
        component={component}
        calculateMetadata={calculateMetadata}
        width={VIDEO.width}
        height={VIDEO.height}
        fps={VIDEO.fps}
        durationInFrames={VIDEO.fps * 40}
        defaultProps={{ midiFile: def.defaultMidi }}
      />
    ))}
  </>;
}
