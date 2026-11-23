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
import {
  buildCyberTunnelFeatures,
  createCyberTunnelGlRenderer,
  paintCyberTunnelFallback2D,
  paintCyberTunnelHud,
  type CyberTunnelGlRenderer,
} from "../gpu-scenes/cyberTunnel.ts";
import {
  buildHarmonicSortingFeatures,
  paintHarmonicSortingFrame,
  simulateHarmonicSorting,
} from "../gpu-scenes/harmonicSorting.ts";
import type { GpuAudioSceneSlug } from "../gpu-scenes/index.ts";
import {
  buildWallCascadeFeatures,
  paintWallCascadeFrame,
  simulateWallCascade,
} from "../gpu-scenes/wallCascade.ts";
import { CLOSING_FRAMES, SCENE_FRAMES, VIDEO } from "../settings.ts";
import { REEL_SAFE_BOUNDS } from "../shared/reelUtils.ts";
import { theme } from "../theme.ts";
import { END_CARD_COPY, GetTheCodeEndCard } from "./GetTheCodeEndCard.tsx";

let gpuSceneFontsPromise: Promise<FontFace[][]> | undefined;
function ensureGpuSceneFontsLoaded() {
  const family = JSON.stringify(theme.fontFamily);
  gpuSceneFontsPromise ??= Promise.all([
    document.fonts.load("600 20px " + family),
    document.fonts.load("700 24px " + family),
    document.fonts.load("800 32px " + family),
  ]);
  return gpuSceneFontsPromise;
}

function SceneClosingCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <GetTheCodeEndCard
      frame={frame}
      fps={fps}
      heading={END_CARD_COPY.mapHeading}
      durationSeconds={CLOSING_FRAMES / VIDEO.fps}
      safeBounds={REEL_SAFE_BOUNDS}
    />
  );
}

function CyberTunnelStage() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const glRendererRef = useRef<CyberTunnelGlRenderer | null | undefined>(undefined);
  const bundle = useMemo(() => buildCyberTunnelFeatures(), []);

  useEffect(() => {
    return () => {
      glRendererRef.current?.dispose();
      glRendererRef.current = undefined;
    };
  }, []);

  useLayoutEffect(() => {
    const feature = bundle.features[Math.min(bundle.features.length - 1, Math.max(0, frame))];
    const glCanvas = glCanvasRef.current;
    const hudCanvas = hudCanvasRef.current;
    if (!glCanvas || !hudCanvas) return;

    if (glRendererRef.current === undefined) {
      glRendererRef.current = createCyberTunnelGlRenderer(glCanvas);
    }

    if (glRendererRef.current) {
      glRendererRef.current.renderFrame(frame, fps, feature);
    } else {
      const fallbackCtx = glCanvas.getContext("2d");
      if (fallbackCtx) {
        paintCyberTunnelFallback2D(fallbackCtx, frame, feature, VIDEO.width, VIDEO.height);
      }
    }

    const hudCtx = hudCanvas.getContext("2d");
    if (!hudCtx) throw new Error("2D HUD canvas context unavailable");
    paintCyberTunnelHud(hudCtx, frame, feature, VIDEO.width, VIDEO.height);
  }, [bundle, fps, frame]);

  return (
    <AbsoluteFill>
      <canvas
        ref={glCanvasRef}
        width={VIDEO.width}
        height={VIDEO.height}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      <canvas
        ref={hudCanvasRef}
        width={VIDEO.width}
        height={VIDEO.height}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />
    </AbsoluteFill>
  );
}

function WallCascadeStage() {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trace = useMemo(() => simulateWallCascade(), []);
  const audioBundle = useMemo(() => buildWallCascadeFeatures(trace), [trace]);

  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    paintWallCascadeFrame(ctx, trace, audioBundle.features, frame, VIDEO.width, VIDEO.height);
  }, [audioBundle.features, frame, trace]);

  return (
    <canvas
      ref={canvasRef}
      width={VIDEO.width}
      height={VIDEO.height}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

function HarmonicSortingStage() {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trace = useMemo(() => simulateHarmonicSorting(), []);
  const audioBundle = useMemo(() => buildHarmonicSortingFeatures(trace), [trace]);

  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    paintHarmonicSortingFrame(ctx, trace, audioBundle.features, frame, VIDEO.width, VIDEO.height);
  }, [audioBundle.features, frame, trace]);

  return (
    <canvas
      ref={canvasRef}
      width={VIDEO.width}
      height={VIDEO.height}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

export function GpuAudioSceneShell({ slug }: { slug: GpuAudioSceneSlug }) {
  const { fps } = useVideoConfig();
  if (fps !== VIDEO.fps) {
    throw new Error("GpuAudioSceneShell requires 60 fps");
  }
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender(`Load bundled font for ${slug}`));

  useEffect(() => {
    let cancelled = false;
    ensureGpuSceneFontsLoaded()
      .then((sets) => {
        if (cancelled) return;
        if (!sets.every((s) => s.length > 0)) {
          throw new Error("Bundled font failed to load");
        }
        setReady(true);
      })
      .catch((error) => {
        if (!cancelled) cancelRender(error);
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  // Child stages paint in useLayoutEffect during the ready commit before this effect resumes capture.
  useEffect(() => {
    if (ready) continueRender(handle);
  }, [ready, handle]);

  return (
    <AbsoluteFill style={{ background: theme.colors.gpuHud.shellBackground }}>
      {ready && (
        <>
          <Sequence durationInFrames={SCENE_FRAMES}>
            {slug === "cyber-synth-shader-tunnel" ? (
              <CyberTunnelStage />
            ) : slug === "polyphonic-wall-cascade" ? (
              <WallCascadeStage />
            ) : (
              <HarmonicSortingStage />
            )}
          </Sequence>
          <Sequence from={SCENE_FRAMES} durationInFrames={CLOSING_FRAMES}>
            <SceneClosingCard />
          </Sequence>
          <Audio src={staticFile("generated/" + slug + ".wav")} volume={1} />
        </>
      )}
    </AbsoluteFill>
  );
}
