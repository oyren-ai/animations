import { Composition } from "remotion";
import { createMidiMetadata, createMidiShell, type MidiSceneSpec } from "../components/MidiShell.tsx";
import { VIDEO } from "../settings.ts";

export interface MidiCompositionDef { id: string; spec: MidiSceneSpec; defaultMidi: string }

/** MIDI-driven scenes. Each takes a `midiFile` prop naming any file in public/midi. */
export const MIDI_COMPOSITION_DEFS: MidiCompositionDef[] = [];

const COMPONENTS = MIDI_COMPOSITION_DEFS.map((def) => ({
  def,
  component: createMidiShell(def.spec),
  calculateMetadata: createMidiMetadata(def.spec),
}));

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
