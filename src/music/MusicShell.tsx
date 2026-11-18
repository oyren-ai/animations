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
import { VIDEO } from "../settings.ts";
import { OyrenBrandLayer } from "../brand/OyrenBrand.tsx";
import { paintCarpetLoomFrame } from "../music-carpet/paint.ts";
import { simulateCarpetLoom } from "../music-carpet/sim.ts";
import { paintFireworkKingFrame } from "../music-fireworks/paint.ts";
import { simulateFireworkMountainKing } from "../music-fireworks/sim.ts";
import { paintRopeHarpFrame } from "../music-rope-harp/paint.ts";
import { simulateRopeHarp } from "../music-rope-harp/sim.ts";
import { FONT_PRELOAD_SAMPLE } from "./types.ts";

export type MusicCompositionSlug =
  | "music-firework-king"
  | "music-rope-harp"
  | "music-carpet-loom";

export interface MusicPaintHook {
  paintCarpetLoom?: (ctx: CanvasRenderingContext2D, frame: number) => void;
}

const carpetRegistry: MusicPaintHook = {};

export function registerCarpetLoomPainter(
  fn: (ctx: CanvasRenderingContext2D, frame: number) => void,
): void {
  carpetRegistry.paintCarpetLoom = fn;
}

let musicFontsPromise: Promise<FontFace[][]> | undefined;
function ensureMusicFontsLoaded() {
  const family = '"Inter Variable"';
  // Pass FONT_PRELOAD_SAMPLE containing ASCII + Azerbaijani Latin-Ext glyphs (ƏəİıĞğŞşÇçÖöÜü)
  // so both inter-latin and inter-latin-ext woff2 subsets load before frame 0!
  musicFontsPromise ??= Promise.all([
    document.fonts.load(`500 22px ${family}`, FONT_PRELOAD_SAMPLE),
    document.fonts.load(`600 24px ${family}`, FONT_PRELOAD_SAMPLE),
    document.fonts.load(`600 30px ${family}`, FONT_PRELOAD_SAMPLE),
    document.fonts.load(`700 38px ${family}`, FONT_PRELOAD_SAMPLE),
    document.fonts.load(`700 40px ${family}`, FONT_PRELOAD_SAMPLE),
  ]);
  return musicFontsPromise;
}

function MusicCanvas({ slug }: { slug: MusicCompositionSlug }) {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fireworkSim = useMemo(
    () => (slug === "music-firework-king" ? simulateFireworkMountainKing() : null),
    [slug],
  );
  const ropeSim = useMemo(
    () => (slug === "music-rope-harp" ? simulateRopeHarp() : null),
    [slug],
  );
  const carpetSim = useMemo(
    () => (slug === "music-carpet-loom" ? simulateCarpetLoom() : null),
    [slug],
  );

  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");

    if (fireworkSim) {
      paintFireworkKingFrame(ctx, fireworkSim, frame);
    } else if (ropeSim) {
      paintRopeHarpFrame(ctx, ropeSim, frame);
    } else if (carpetSim) {
      paintCarpetLoomFrame(ctx, carpetSim, frame);
    } else if (slug === "music-carpet-loom" && carpetRegistry.paintCarpetLoom) {
      carpetRegistry.paintCarpetLoom(ctx, frame);
    }
  }, [frame, slug, fireworkSim, ropeSim, carpetSim]);

  return (
    <canvas
      ref={canvasRef}
      width={VIDEO.width}
      height={VIDEO.height}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

export function MusicShell({ slug }: { slug: MusicCompositionSlug }) {
  const { fps } = useVideoConfig();
  if (fps !== VIDEO.fps) {
    throw new Error("MusicShell requires 60 fps");
  }
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender("Load Inter latin + latin-ext fonts for MusicShell"));

  useEffect(() => {
    ensureMusicFontsLoaded()
      .then((sets) => {
        if (!sets.every((s) => s.length > 0)) {
          throw new Error("Bundled font subsets failed to load");
        }
        setReady(true);
        continueRender(handle);
      })
      .catch(cancelRender);
  }, [handle]);

  return (
    <AbsoluteFill style={{ background: "#060812" }}>
      {ready && (
        <>
          <MusicCanvas slug={slug} />
          <Audio src={staticFile(`generated/${slug}.wav`)} volume={1} />
          <OyrenBrandLayer />
        </>
      )}
    </AbsoluteFill>
  );
}
