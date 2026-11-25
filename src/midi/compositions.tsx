import { Composition } from "remotion";
import { createMidiMetadata, createMidiShell, type MidiSceneSpec } from "../components/MidiShell.tsx";
import { MIDI_ARSHIN_MAL_ALAN } from "../midi-arshin/scene.ts";
import { MIDI_BAKU_NIGHTS } from "../midi-baku-nights/scene.ts";
import { MIDI_BUMBLEBEE } from "../midi-bumblebee/scene.ts";
import { MIDI_CANON_VOICES } from "../midi-canon/scene.ts";
import { MIDI_MUGHAM_NOCTURNE } from "../midi-mugham/scene.ts";
import { MIDI_FUR_ELISE_MUSIC_BOX } from "../midi-music-box/scene.ts";
import { VIDEO } from "../settings.ts";

export interface MidiCompositionDef { id: string; spec: MidiSceneSpec; defaultMidi: string }

/** Six MIDI-driven scenes (public-domain transcriptions + original compositions). */
export const MIDI_COMPOSITION_DEFS: MidiCompositionDef[] = [
  { id: "MidiBumblebee", spec: MIDI_BUMBLEBEE, defaultMidi: "flight-of-the-bumblebee.mid" },
  { id: "MidiCanonVoices", spec: MIDI_CANON_VOICES, defaultMidi: "canon-in-d-five-voices.mid" },
  { id: "MidiFurEliseMusicBox", spec: MIDI_FUR_ELISE_MUSIC_BOX, defaultMidi: "fur-elise-music-box.mid" },
  { id: "MidiMughamNocturne", spec: MIDI_MUGHAM_NOCTURNE, defaultMidi: "mugham-nocturne.mid" },
  { id: "MidiBakuNights", spec: MIDI_BAKU_NIGHTS, defaultMidi: "baku-nights.mid" },
  { id: "MidiArshinMalAlan", spec: MIDI_ARSHIN_MAL_ALAN, defaultMidi: "arshin-mal-alan-askars-song.mid" },
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
