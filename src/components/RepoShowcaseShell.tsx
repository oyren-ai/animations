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
  useVideoConfig,
} from "remotion";
import { paintPhysics, paintWave } from "../ball-drop/paint.ts";
import { simulate, type Style } from "../ball-drop/sim.ts";
import { prepareCountryMap, type CountryMapSlug } from "../country-maps/fourier.ts";
import { paintCountryMap } from "../country-maps/paint.ts";
import { paintAurora } from "../repo-showcase/backdrop.ts";
import { paintShowcaseOverlay } from "../repo-showcase/overlay.ts";
import { SHOWCASE_TIMING, type SceneSegment } from "../repo-showcase/timing.ts";
import { VIDEO } from "../settings.ts";
import { paintStringArenaFrame } from "../string-arena/paint.ts";
import { simulateStringRound, type StringRoundSlug } from "../string-arena/sim.ts";
import { theme } from "../theme.ts";

let showcaseFontsPromise: Promise<FontFace[][]> | undefined;
function ensureShowcaseFontsLoaded() {
  const family = JSON.stringify(theme.fontFamily);
  showcaseFontsPromise ??= Promise.all([
    document.fonts.load("500 24px " + family),
    document.fonts.load("650 28px " + family),
    document.fonts.load("800 64px " + family),
  ]);
  return showcaseFontsPromise;
}

type ScenePainter = (ctx: CanvasRenderingContext2D, sceneFrame: number) => void;

const ballTraces = new Map<string, ReturnType<typeof simulate>>();
const stringTraces = new Map<string, ReturnType<typeof simulateStringRound>>();
const countryMaps = new Map<string, ReturnType<typeof prepareCountryMap>>();

function cached<T>(store: Map<string, T>, key: string, make: () => T): T {
  let value = store.get(key);
  if (value === undefined) {
    value = make();
    store.set(key, value);
  }
  return value;
}

// Every painter here is the same function the standalone composition uses, so the footage is the repo's own.
function scenePainter(segment: SceneSegment): ScenePainter {
  const variant = segment.variant ?? "";
  switch (segment.scene) {
    case "pendulum":
      return (ctx, sceneFrame) => paintWave(ctx, sceneFrame);
    case "ball-drop": {
      const trace = cached(ballTraces, variant, () => simulate(variant as Style));
      return (ctx, sceneFrame) => paintPhysics(ctx, trace, sceneFrame);
    }
    case "string-arena": {
      const trace = cached(stringTraces, variant, () => simulateStringRound(variant as StringRoundSlug));
      return (ctx, sceneFrame) =>
        paintStringArenaFrame(ctx, trace, sceneFrame, { isCombined: false, globalFrame: sceneFrame, atlas: null, fadeOutAtEnd: false });
    }
    case "country-map": {
      const map = cached(countryMaps, variant, () => prepareCountryMap(variant as CountryMapSlug));
      return (ctx, sceneFrame) => paintCountryMap(ctx, map, sceneFrame);
    }
  }
}

function BackdropLayer() {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    paintAurora(ctx, frame, VIDEO.width, VIDEO.height);
  }, [frame]);
  return <canvas ref={canvasRef} width={VIDEO.width} height={VIDEO.height} style={{ width: "100%", height: "100%", display: "block" }} />;
}

function SceneLayer({ segment }: { segment: SceneSegment }) {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paint = useMemo(() => scenePainter(segment), [segment]);
  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    paint(ctx, segment.sceneStartFrame + Math.floor(frame * segment.speed));
  }, [frame, paint, segment]);
  // Screen blend lets the aurora glow through the dark margins of each scene while its bright shapes stay intact.
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen" }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          transform: `translateY(${segment.offsetY}px) scale(${segment.scale})`,
          transformOrigin: "50% 11.5%",
        }}
      >
        <canvas ref={canvasRef} width={VIDEO.width} height={VIDEO.height} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
    </AbsoluteFill>
  );
}

function OverlayLayer() {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    paintShowcaseOverlay(ctx, frame, SHOWCASE_TIMING);
  }, [frame]);
  return (
    <AbsoluteFill>
      <canvas ref={canvasRef} width={VIDEO.width} height={VIDEO.height} style={{ width: "100%", height: "100%", display: "block" }} />
    </AbsoluteFill>
  );
}

export function RepoShowcaseShell() {
  const { fps } = useVideoConfig();
  if (fps !== VIDEO.fps) throw new Error("RepoShowcaseShell requires 60 fps");
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender("Load bundled font for AnimationsRepoShowcase"));

  useEffect(() => {
    ensureShowcaseFontsLoaded()
      .then((sets) => {
        if (!sets.every((set) => set.length > 0)) throw new Error("Bundled font failed to load");
        setReady(true);
        continueRender(handle);
      })
      .catch(cancelRender);
  }, [handle]);

  return (
    <AbsoluteFill style={{ background: "#05080d" }}>
      {ready && (
        <>
          <BackdropLayer />
          {SHOWCASE_TIMING.segments.map((segment) => (
            <Sequence key={segment.fromFrame} from={segment.fromFrame} durationInFrames={segment.toFrame - segment.fromFrame}>
              <SceneLayer segment={segment} />
            </Sequence>
          ))}
          <OverlayLayer />
          <Audio src={staticFile("generated/animations-repo-showcase.wav")} volume={1} />
        </>
      )}
    </AbsoluteFill>
  );
}
