import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  cancelRender,
  continueRender,
  delayRender,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { OyrenBrandLayer } from "../brand/OyrenBrand.tsx";
import { VIDEO } from "../settings.ts";
import { theme } from "../theme.ts";
import { getSetPiece, type SetPieceSlug } from "../setpieces/index.ts";

let setPieceFontsPromise: Promise<FontFace[][]> | undefined;
function ensureSetPieceFontsLoaded() {
  const family = JSON.stringify(theme.fontFamily);
  setPieceFontsPromise ??= Promise.all([
    document.fonts.load("500 24px " + family),
    document.fonts.load("700 28px " + family),
    document.fonts.load("900 66px " + family),
  ]);
  return setPieceFontsPromise;
}

function SetPieceCanvas({ slug }: { slug: SetPieceSlug }) {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mod = useMemo(() => getSetPiece(slug), [slug]);
  const trace = useMemo(() => mod.simulate(), [mod]);

  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    mod.paint(ctx, trace, Math.min(frame, mod.spec.totalFrames - 1));
  }, [frame, mod, trace]);

  return (
    <canvas
      ref={canvasRef}
      width={VIDEO.width}
      height={VIDEO.height}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

/** Round 4 deterministic physics set pieces with the shared OyrenBrandLayer last. */
export function SetPieceShell({ slug }: { slug: SetPieceSlug }) {
  const { fps } = useVideoConfig();
  if (fps !== VIDEO.fps) {
    throw new Error("SetPieceShell requires 60 fps");
  }
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender(`Load bundled font for ${slug}`));

  useEffect(() => {
    ensureSetPieceFontsLoaded()
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
    <AbsoluteFill style={{ background: "#03070b" }}>
      {ready && (
        <>
          <SetPieceCanvas slug={slug} />
          <Audio src={staticFile("generated/" + slug + ".wav")} volume={1} />
          <OyrenBrandLayer />
        </>
      )}
    </AbsoluteFill>
  );
}
