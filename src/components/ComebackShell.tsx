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
  buildComebackFeatures,
  COMEBACK_COMPOSITIONS,
  paintComebackFrame,
  simulateComeback,
  type ComebackSlug,
} from "../comebacks/index.ts";
import { VIDEO } from "../settings.ts";
import { REEL_SAFE_BOUNDS } from "../shared/reelUtils.ts";
import { theme } from "../theme.ts";
import { END_CARD_COPY, GetTheCodeEndCard } from "./GetTheCodeEndCard.tsx";

let comebackFontsPromise: Promise<FontFace[][]> | undefined;
function ensureComebackFontsLoaded() {
  const family = JSON.stringify(theme.fontFamily);
  comebackFontsPromise ??= Promise.all([
    document.fonts.load("600 18px " + family),
    document.fonts.load("700 22px " + family),
    document.fonts.load("800 28px " + family),
    document.fonts.load("900 36px " + family),
  ]);
  return comebackFontsPromise;
}

function ComebackClosingCard({ closingFrames }: { closingFrames: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <GetTheCodeEndCard
      frame={frame}
      fps={fps}
      heading={END_CARD_COPY.mapHeading}
      durationSeconds={closingFrames / VIDEO.fps}
      safeBounds={REEL_SAFE_BOUNDS}
    />
  );
}

function ComebackRaceStage({ slug }: { slug: ComebackSlug }) {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trace = useMemo(() => simulateComeback(slug), [slug]);
  const features = useMemo(() => buildComebackFeatures(slug), [slug]);

  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    paintComebackFrame(ctx, trace, features, frame, VIDEO.width, VIDEO.height);
  }, [features, frame, trace]);

  return (
    <canvas
      ref={canvasRef}
      width={VIDEO.width}
      height={VIDEO.height}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

export function ComebackShell({ slug }: { slug: ComebackSlug }) {
  const { fps } = useVideoConfig();
  if (fps !== VIDEO.fps) {
    throw new Error("ComebackShell requires 60 fps");
  }
  const def = COMEBACK_COMPOSITIONS.find((c) => c.slug === slug);
  if (!def) {
    throw new Error(`Unknown comeback composition slug: ${slug}`);
  }

  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender(`Load bundled font for ${slug}`));

  useEffect(() => {
    ensureComebackFontsLoaded()
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
    <AbsoluteFill style={{ background: theme.colors.comebackHudShellBackground }}>
      {ready && (
        <>
          <Sequence durationInFrames={def.raceFrames}>
            <ComebackRaceStage slug={slug} />
          </Sequence>
          <Sequence from={def.raceFrames} durationInFrames={def.closingFrames}>
            <ComebackClosingCard closingFrames={def.closingFrames} />
          </Sequence>
          <Audio src={staticFile("generated/" + slug + ".wav")} volume={1} />
        </>
      )}
    </AbsoluteFill>
  );
}
