import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AbsoluteFill, Audio, cancelRender, continueRender, delayRender, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { SCENE_FRAMES, CLOSING_FRAMES, VIDEO } from "../settings.ts";
import { theme } from "../theme.ts";
import { paintPhysics, paintWave } from "../ball-drop/paint.ts";
import { simulate, type Style } from "../ball-drop/sim.ts";
import { GetTheCodeEndCard } from "./GetTheCodeEndCard.tsx";

const traces = new Map<Style, ReturnType<typeof simulate>>();
function traceFor(style: Style) {
  let trace = traces.get(style);
  if (!trace) { trace = simulate(style); traces.set(style, trace); }
  return trace;
}
let fonts: Promise<FontFace[]> | undefined;
function loadFonts() {
  fonts ??= document.fonts.load("700 62px " + JSON.stringify(theme.fontFamily));
  return fonts;
}
function ClosingBeat() {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  return <GetTheCodeEndCard frame={frame} fps={fps} />;
}

function SceneCanvas({ style }: { style?: Style }) {
  const frame = useCurrentFrame(), canvas = useRef<HTMLCanvasElement>(null);
  const trace = useMemo(() => style ? traceFor(style) : undefined, [style]);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) throw new Error("Canvas rendering is unavailable");
    if (trace) paintPhysics(ctx, trace, frame); else paintWave(ctx, frame);
  }, [trace, frame]);
  return <canvas ref={canvas} width={VIDEO.width} height={VIDEO.height} style={{ width: "100%", height: "100%" }} />;
}

export function AnimationShell({ style }: { style?: Style }) {
  const { fps } = useVideoConfig();
  if (fps !== VIDEO.fps) throw new Error("Use the declared 60 fps timeline for the simulation");
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender("Load bundled display font"));
  useEffect(() => {
    loadFonts().then((loaded) => {
      if (!loaded.length) throw new Error("The bundled display font did not load");
      setReady(true); continueRender(handle);
    }).catch(cancelRender);
  }, [handle]);
  return <AbsoluteFill style={{ background: theme.colors.background }}>
    {ready && <>
      <Sequence durationInFrames={SCENE_FRAMES}><SceneCanvas style={style} /></Sequence>
      <Sequence from={SCENE_FRAMES} durationInFrames={CLOSING_FRAMES}><ClosingBeat /></Sequence>
      <Audio src={staticFile("generated/" + (style ?? "pendulum-wave") + ".wav")} volume={1} />
    </>}
  </AbsoluteFill>;
}
