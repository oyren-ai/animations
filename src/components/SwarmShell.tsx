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
import { paintSwarmFrame } from "../swarm/paint.ts";
import { getSwarmDefinition, simulateSwarmDefinition, type SwarmSlug } from "../swarm/themes.ts";

let swarmFontsPromise: Promise<FontFace[][]> | undefined;
function ensureSwarmFontsLoaded() {
  const family = JSON.stringify(theme.fontFamily);
  swarmFontsPromise ??= Promise.all([
    document.fonts.load("500 28px " + family),
    document.fonts.load("600 28px " + family),
    document.fonts.load("800 66px " + family),
    document.fonts.load("900 124px " + family),
  ]);
  return swarmFontsPromise;
}

function SwarmCanvas({ slug }: { slug: SwarmSlug }) {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const definition = useMemo(() => getSwarmDefinition(slug), [slug]);
  // The whole run is simulated once per process; each frame only reads the snapshot.
  const trace = useMemo(() => simulateSwarmDefinition(slug), [slug]);

  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    paintSwarmFrame(ctx, definition, trace, frame);
  }, [frame, definition, trace]);

  return <canvas ref={canvasRef} width={VIDEO.width} height={VIDEO.height} style={{ width: "100%", height: "100%" }} />;
}

/** Cyclic-chase swarm clips: the run plays out, then the winner caption holds for 3 s. */
export function SwarmShell({ slug }: { slug: SwarmSlug }) {
  const { fps } = useVideoConfig();
  if (fps !== VIDEO.fps) {
    throw new Error("SwarmShell requires 60 fps");
  }
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender("Load bundled font for SwarmShell"));

  useEffect(() => {
    ensureSwarmFontsLoaded()
      .then((sets) => {
        if (!sets.every((set) => set.length > 0)) {
          throw new Error("Bundled font failed to load");
        }
        setReady(true);
        continueRender(handle);
      })
      .catch(cancelRender);
  }, [handle]);

  return (
    <AbsoluteFill style={{ background: "#03080a" }}>
      {ready && (
        <>
          <SwarmCanvas slug={slug} />
          <Audio src={staticFile("generated/" + slug + ".wav")} volume={1} />
          <OyrenBrandLayer />
        </>
      )}
    </AbsoluteFill>
  );
}
