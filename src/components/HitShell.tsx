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
import { getHit } from "../hits/index.ts";
import { HIT_CLOSING_FRAMES, type AnyHitComposition } from "../hits/types.ts";
import { VIDEO } from "../settings.ts";
import { REEL_SAFE_BOUNDS } from "../shared/reelUtils.ts";
import { theme } from "../theme.ts";
import { END_CARD_COPY, GetTheCodeEndCard } from "./GetTheCodeEndCard.tsx";

let hitFontsPromise: Promise<FontFace[][]> | undefined;
function ensureHitFontsLoaded() {
  const family = JSON.stringify(theme.fontFamily);
  hitFontsPromise ??= Promise.all([
    document.fonts.load("500 20px " + family),
    document.fonts.load("600 20px " + family),
    document.fonts.load("700 24px " + family),
    document.fonts.load("800 32px " + family),
    document.fonts.load("900 64px " + family),
  ]);
  return hitFontsPromise;
}

function HitStage({ comp }: { comp: AnyHitComposition }) {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trace = useMemo(() => comp.simulate(), [comp]);

  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    comp.paint(ctx, trace, Math.min(frame, comp.spec.sceneFrames - 1));
  }, [comp, frame, trace]);

  return (
    <canvas
      ref={canvasRef}
      width={VIDEO.width}
      height={VIDEO.height}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

function HitClosingCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <GetTheCodeEndCard
      frame={frame}
      fps={fps}
      heading={END_CARD_COPY.heading}
      durationSeconds={HIT_CLOSING_FRAMES / VIDEO.fps}
      safeBounds={REEL_SAFE_BOUNDS}
    />
  );
}

/** One full-bleed canvas for the scene, the closing Oyren card, and the generated stereo WAV. */
export function HitShell({ slug }: { slug: string }) {
  const { fps } = useVideoConfig();
  if (fps !== VIDEO.fps) {
    throw new Error("HitShell requires 60 fps");
  }
  const comp = useMemo(() => getHit(slug), [slug]);
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender(`Load bundled font for ${slug}`));

  useEffect(() => {
    ensureHitFontsLoaded()
      .then((sets) => {
        if (!sets.every((s) => s.length > 0)) {
          throw new Error("Bundled font failed to load");
        }
        setReady(true);
        continueRender(handle);
      })
      .catch(cancelRender);
  }, [handle]);

  return (
    <AbsoluteFill style={{ background: "#05070b" }}>
      {ready && (
        <>
          <Sequence durationInFrames={comp.spec.sceneFrames}>
            <HitStage comp={comp} />
          </Sequence>
          <Sequence from={comp.spec.sceneFrames} durationInFrames={HIT_CLOSING_FRAMES}>
            <HitClosingCard />
          </Sequence>
          <Audio src={staticFile("generated/" + slug + ".wav")} volume={1} />
        </>
      )}
    </AbsoluteFill>
  );
}
