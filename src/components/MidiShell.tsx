import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  cancelRender,
  continueRender,
  delayRender,
  Sequence,
  staticFile,
  useCurrentFrame,
  type CalculateMetadataFunction,
} from "remotion";
import { OyrenBrandLayer } from "../brand/OyrenBrand.tsx";
import { loadParsedMidi } from "../midi/load.ts";
import { buildSceneData, midiAudioFile, sceneFrameCount, type MidiSceneData } from "../midi/timeline.ts";
import { MIDI_TAIL_SEC } from "../midi/timeline.ts";
import { VIDEO } from "../settings.ts";
import { theme } from "../theme.ts";

/** Props of every MIDI composition. Any file in public/midi works: run `pnpm assets`, then pass its name. */
export type MidiSceneProps = {
  /** File name inside public/midi, for example "ode-to-joy.mid". */
  midiFile: string;
  /** Optional on-screen title; defaults to the sequence name stored in the file. */
  title?: string;
};

/** Draws one frame. Must be a pure function of the frame number (frames render in any order). */
export type MidiPainter = (ctx: CanvasRenderingContext2D, frame: number) => void;

export interface MidiSceneSpec {
  id: string;
  /** Default piece title shown above the subtitle when no `title` prop overrides it. */
  defaultTitle?: string;
  /** Scene name shown in the small title ("Ball Piano"). */
  label: string;
  /** Frames before the first note-on (long enough for the scene to introduce it, such as a falling ball). */
  leadFrames: number;
  tailSec?: number;
  /** Called once per loaded piece; return the per-frame painter (precompute layout and event tables here). */
  createPainter: (scene: MidiSceneData, label: string) => MidiPainter;
}

let fontsPromise: Promise<FontFace[][]> | undefined;
function ensureFontsLoaded() {
  const family = JSON.stringify(theme.fontFamily);
  fontsPromise ??= Promise.all([
    document.fonts.load("500 28px " + family),
    document.fonts.load("600 28px " + family),
    document.fonts.load("700 36px " + family),
  ]);
  return fontsPromise;
}

function MidiCanvas({ scene, spec }: { scene: MidiSceneData; spec: MidiSceneSpec }) {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painter = useMemo(() => spec.createPainter(scene, spec.label), [scene, spec]);
  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    painter(ctx, frame);
  }, [frame, painter]);
  return <canvas ref={canvasRef} width={VIDEO.width} height={VIDEO.height} style={{ width: "100%", height: "100%" }} />;
}

/** Component for one MIDI scene: loads the file, paints it per frame and plays the matching synthesised WAV. */
export function createMidiShell(spec: MidiSceneSpec) {
  return function MidiShell({ midiFile, title }: MidiSceneProps) {
    const [scene, setScene] = useState<MidiSceneData | null>(null);
    const [handle] = useState(() => delayRender("Load MIDI file and fonts for " + spec.id));
    useEffect(() => {
      Promise.all([loadParsedMidi(midiFile), ensureFontsLoaded()])
        .then(([parsed]) => {
          setScene(buildSceneData(parsed, midiFile,
            { fps: VIDEO.fps, leadFrames: spec.leadFrames, tailSec: spec.tailSec ?? MIDI_TAIL_SEC },
            { width: VIDEO.width, height: VIDEO.height }, title ?? spec.defaultTitle));
          continueRender(handle);
        })
        .catch(cancelRender);
    }, [handle, midiFile, title]);
    return (
      <AbsoluteFill style={{ background: "#05060d" }}>
        {scene && (
          <>
            <MidiCanvas scene={scene} spec={spec} />
            <Sequence from={spec.leadFrames} layout="none">
              <Audio src={staticFile(midiAudioFile(midiFile))} volume={1} />
            </Sequence>
          </>
        )}
        <OyrenBrandLayer />
      </AbsoluteFill>
    );
  };
}

/** Sets the composition length from the MIDI file, so any dropped-in file gets the right duration. */
export function createMidiMetadata(spec: MidiSceneSpec): CalculateMetadataFunction<MidiSceneProps> {
  return async ({ props }) => {
    const parsed = await loadParsedMidi(props.midiFile);
    return {
      durationInFrames: sceneFrameCount(parsed.durationSec, {
        fps: VIDEO.fps, leadFrames: spec.leadFrames, tailSec: spec.tailSec ?? MIDI_TAIL_SEC,
      }),
    };
  };
}
