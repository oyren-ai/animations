import { Composition } from "remotion";
import { createMidiMetadata, createMidiShell, type MidiSceneSpec } from "../components/MidiShell.tsx";
import { MIDI_BUMBLEBEE } from "../midi-bumblebee/scene.ts";
import { MIDI_CANON_VOICES } from "../midi-canon/scene.ts";
import { MIDI_FUR_ELISE_MUSIC_BOX } from "../midi-music-box/scene.ts";
import { VIDEO } from "../settings.ts";

export interface MidiCompositionDef { id: string; spec: MidiSceneSpec; defaultMidi: string }

/** Three recognisable MIDI-driven scenes. Each takes a `midiFile` prop naming any file in public/midi. */
export const MIDI_COMPOSITION_DEFS: MidiCompositionDef[] = [
  { id: "MidiBumblebee", spec: MIDI_BUMBLEBEE, defaultMidi: "flight-of-the-bumblebee.mid" },
  { id: "MidiCanonVoices", spec: MIDI_CANON_VOICES, defaultMidi: "canon-in-d-five-voices.mid" },
  { id: "MidiFurEliseMusicBox", spec: MIDI_FUR_ELISE_MUSIC_BOX, defaultMidi: "fur-elise-music-box.mid" },
];

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
        durationInFrames={VIDEO.fps * 50}
        defaultProps={{ midiFile: def.defaultMidi }}
      />
    ))}
  </>;
}
