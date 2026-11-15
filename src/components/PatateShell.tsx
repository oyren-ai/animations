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
import { VIDEO } from "../settings.ts";
import { REEL_SAFE_BOUNDS } from "../shared/reelUtils.ts";
import { theme } from "../theme.ts";
import { paintPatateFrame } from "../patate/paint.ts";
import { simulatePatate } from "../patate/sim.ts";
import {
  PATATE_CLOSING_FRAMES,
  PATATE_SCENE_FRAMES,
  type PatateCompositionSlug,
} from "../patate/themes.ts";
import { END_CARD_COPY, GetTheCodeEndCard } from "./GetTheCodeEndCard.tsx";

let patateFontsPromise: Promise<FontFace[][]> | undefined;
function ensurePatateFontsLoaded() {
  const family = JSON.stringify(theme.fontFamily);
  patateFontsPromise ??= Promise.all([
    document.fonts.load("500 28px " + family),
    document.fonts.load("700 36px " + family),
    document.fonts.load("900 50px " + family),
  ]);
  return patateFontsPromise;
}

function PatateClosingCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <GetTheCodeEndCard
      frame={frame}
      fps={fps}
      heading={END_CARD_COPY.mapHeading}
      durationSeconds={PATATE_CLOSING_FRAMES / VIDEO.fps}
      safeBounds={REEL_SAFE_BOUNDS}
    />
  );
}

function PatateCanvas({ slug }: { slug: PatateCompositionSlug }) {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trace = useMemo(() => simulatePatate(slug), [slug]);

  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    paintPatateFrame(ctx, trace, frame);
  }, [frame, trace]);

  return (
    <canvas
      ref={canvasRef}
      width={VIDEO.width}
      height={VIDEO.height}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

export function PatateShell({ slug }: { slug: PatateCompositionSlug }) {
  const { fps } = useVideoConfig();
  if (fps !== VIDEO.fps) {
    throw new Error("PatateShell requires 60 fps");
  }
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender("Load bundled font for PatateShell"));

  useEffect(() => {
    ensurePatateFontsLoaded()
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
    <AbsoluteFill style={{ background: "#080a16" }}>
      {ready && (
        <>
          <Sequence durationInFrames={PATATE_SCENE_FRAMES}>
            <PatateCanvas slug={slug} />
          </Sequence>
          <Sequence
            from={PATATE_SCENE_FRAMES}
            durationInFrames={PATATE_CLOSING_FRAMES}
          >
            <PatateClosingCard />
          </Sequence>
          <Audio
            src={staticFile("generated/" + slug + ".wav")}
            volume={1}
          />
        </>
      )}
    </AbsoluteFill>
  );
}
