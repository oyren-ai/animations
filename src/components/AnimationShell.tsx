import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AbsoluteFill, Audio, cancelRender, continueRender, delayRender, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { SCENE_FRAMES, CLOSING_FRAMES, VIDEO } from "../settings.ts";
import { theme } from "../theme.ts";
import { paintPhysics, paintWave } from "../ball-drop/paint.ts";
import { simulate, type Style } from "../ball-drop/sim.ts";
import { prepareCountryMap, type CountryMapSlug } from "../country-maps/fourier.ts";
import { paintCountryMap } from "../country-maps/paint.ts";
import { END_CARD_COPY, GetTheCodeEndCard } from "./GetTheCodeEndCard.tsx";

const traces = new Map<Style, ReturnType<typeof simulate>>();
function traceFor(style: Style) {
  let trace = traces.get(style);
  if (!trace) { trace = simulate(style); traces.set(style, trace); }
  return trace;
}
let fonts: Promise<FontFace[][]> | undefined;
function loadFonts() {
  const family = JSON.stringify(theme.fontFamily);
  fonts ??= Promise.all([
    document.fonts.load("500 28px " + family),
    document.fonts.load("650 28px " + family),
    document.fonts.load("750 62px " + family),
  ]);
  return fonts;
}
function ClosingBeat({ heading }: { heading?: string }) {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  return <GetTheCodeEndCard frame={frame} fps={fps} heading={heading} />;
}

function SceneCanvas({ style, countryMap }: { style?: Style; countryMap?: CountryMapSlug }) {
  const frame = useCurrentFrame(), canvas = useRef<HTMLCanvasElement>(null);
  const trace = useMemo(() => style ? traceFor(style) : undefined, [style]);
  const map = useMemo(() => countryMap ? prepareCountryMap(countryMap) : undefined, [countryMap]);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) throw new Error("Canvas rendering is unavailable");
    if (map) paintCountryMap(ctx, map, frame);
    else if (trace) paintPhysics(ctx, trace, frame);
    else paintWave(ctx, frame);
  }, [map, trace, frame]);
  return <canvas ref={canvas} width={VIDEO.width} height={VIDEO.height} style={{ width: "100%", height: "100%" }} />;
}

export function AnimationShell({ style, countryMap }: { style?: Style; countryMap?: CountryMapSlug }) {
  const { fps } = useVideoConfig();
  if (fps !== VIDEO.fps) throw new Error("Use the declared 60 fps timeline for the simulation");
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender("Load bundled display font"));
  useEffect(() => {
    loadFonts().then((loaded) => {
      if (!loaded.every((set) => set.length > 0)) throw new Error("The bundled display font did not load");
      setReady(true); continueRender(handle);
    }).catch(cancelRender);
  }, [handle]);
  const audioSlug = countryMap ?? style ?? "pendulum-wave";
  const closingHeading = countryMap ? END_CARD_COPY.mapHeading : END_CARD_COPY.heading;
  return <AbsoluteFill style={{ background: theme.colors.background }}>
    {ready && <>
      <Sequence durationInFrames={SCENE_FRAMES}><SceneCanvas style={style} countryMap={countryMap} /></Sequence>
      <Sequence from={SCENE_FRAMES} durationInFrames={CLOSING_FRAMES}><ClosingBeat heading={closingHeading} /></Sequence>
      <Audio src={staticFile("generated/" + audioSlug + ".wav")} volume={1} />
    </>}
  </AbsoluteFill>;
}
