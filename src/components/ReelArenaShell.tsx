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
import { theme } from "../theme.ts";
import { REEL_SAFE_BOUNDS, type LocalLogoAtlas } from "../shared/reelUtils.ts";
import {
  buildCombinedStringTimeline,
  COMBINED_CLOSING_FRAMES,
  simulateStringRound,
  type StringRoundSlug,
} from "../string-arena/sim.ts";
import { paintStringArenaFrame } from "../string-arena/paint.ts";
import {
  buildCombinedDropTimeline,
  simulateDropArena,
  type DropStyleSlug,
} from "../drop-arenas/sim.ts";
import { paintDropArenaFrame } from "../drop-arenas/paint.ts";
import { END_CARD_COPY, GetTheCodeEndCard } from "./GetTheCodeEndCard.tsx";

export type ReelArenaMode =
  | { kind: "string-combined" }
  | { kind: "string-round"; slug: StringRoundSlug }
  | { kind: "drop-standalone"; slug: DropStyleSlug }
  | { kind: "drop-combined" };

let fontsPromise: Promise<FontFace[][]> | undefined;
function ensureFontsLoaded() {
  const family = JSON.stringify(theme.fontFamily);
  fontsPromise ??= Promise.all([
    document.fonts.load("500 24px " + family),
    document.fonts.load("700 28px " + family),
    document.fonts.load("800 44px " + family),
  ]);
  return fontsPromise;
}

let atlasPromise: Promise<LocalLogoAtlas> | undefined;
function ensureLogoAtlasLoaded(): Promise<LocalLogoAtlas> {
  atlasPromise ??= fetch(staticFile("generated/local-logos.json"))
    .then((res) => (res.ok ? (res.json() as Promise<LocalLogoAtlas>) : {}))
    .catch(() => ({}));
  return atlasPromise;
}

function ReelClosingCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <GetTheCodeEndCard
      frame={frame}
      fps={fps}
      heading={END_CARD_COPY.mapHeading}
      durationSeconds={2.5}
      safeBounds={REEL_SAFE_BOUNDS}
    />
  );
}

function ReelArenaCanvas({
  mode,
  atlas,
}: {
  mode: ReelArenaMode;
  atlas: LocalLogoAtlas;
}) {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stringCombined = useMemo(
    () => (mode.kind === "string-combined" ? buildCombinedStringTimeline() : null),
    [mode],
  );
  const stringRound = useMemo(
    () => (mode.kind === "string-round" ? simulateStringRound(mode.slug) : null),
    [mode],
  );
  const dropStandalone = useMemo(
    () =>
      mode.kind === "drop-standalone"
        ? simulateDropArena(mode.slug, "standalone")
        : null,
    [mode],
  );
  const dropCombined = useMemo(
    () => (mode.kind === "drop-combined" ? buildCombinedDropTimeline() : null),
    [mode],
  );

  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");

    if (stringCombined) {
      const active =
        stringCombined.rounds.find(
          (r) => frame >= r.startFrame && frame < r.endFrame,
        ) ?? stringCombined.rounds[stringCombined.rounds.length - 1];
      const isLast =
        active === stringCombined.rounds[stringCombined.rounds.length - 1];
      paintStringArenaFrame(ctx, active.trace, frame - active.startFrame, {
        isCombined: true,
        globalFrame: frame,
        atlas,
        fadeOutAtEnd: isLast,
      });
    } else if (stringRound) {
      paintStringArenaFrame(ctx, stringRound, frame, {
        isCombined: false,
        globalFrame: frame,
        atlas,
        fadeOutAtEnd: true,
      });
    } else if (dropStandalone) {
      paintDropArenaFrame(ctx, dropStandalone, frame, {
        isCombined: false,
        globalFrame: frame,
        atlas,
        fadeOutAtEnd: true,
      });
    } else if (dropCombined) {
      const active =
        dropCombined.stages.find(
          (s) => frame >= s.startFrame && frame < s.endFrame,
        ) ?? dropCombined.stages[dropCombined.stages.length - 1];
      const isLast =
        active === dropCombined.stages[dropCombined.stages.length - 1];
      paintDropArenaFrame(ctx, active.trace, frame - active.startFrame, {
        isCombined: true,
        globalFrame: frame,
        atlas,
        fadeOutAtEnd: isLast,
      });
    }
  }, [frame, atlas, stringCombined, stringRound, dropStandalone, dropCombined]);

  return (
    <canvas
      ref={canvasRef}
      width={VIDEO.width}
      height={VIDEO.height}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

export function getReelArenaTiming(mode: ReelArenaMode): {
  sceneFrames: number;
  closingFrames: number;
  totalFrames: number;
  audioSlug: string;
} {
  if (mode.kind === "string-combined") {
    const t = buildCombinedStringTimeline();
    return {
      sceneFrames: t.sceneFrames,
      closingFrames: t.closingFrames,
      totalFrames: t.totalFrames,
      audioSlug: "string-arenas-combined",
    };
  }
  if (mode.kind === "string-round") {
    const tr = simulateStringRound(mode.slug);
    return {
      sceneFrames: tr.totalRoundFrames,
      closingFrames: COMBINED_CLOSING_FRAMES,
      totalFrames: tr.totalRoundFrames + COMBINED_CLOSING_FRAMES,
      audioSlug: mode.slug,
    };
  }
  if (mode.kind === "drop-standalone") {
    const tr = simulateDropArena(mode.slug, "standalone");
    const sceneFrames = tr.frames.length - 1;
    return {
      sceneFrames,
      closingFrames: tr.closingFrames,
      totalFrames: tr.totalFrames,
      audioSlug: mode.slug,
    };
  }
  const t = buildCombinedDropTimeline();
  return {
    sceneFrames: t.sceneFrames,
    closingFrames: t.closingFrames,
    totalFrames: t.totalFrames,
    audioSlug: "ball-drop-combined",
  };
}

export function ReelArenaShell({ mode }: { mode: ReelArenaMode }) {
  const { fps } = useVideoConfig();
  if (fps !== VIDEO.fps) {
    throw new Error("ReelArenaShell requires 60 fps");
  }
  const [atlas, setAtlas] = useState<LocalLogoAtlas | null>(null);
  const [handle] = useState(() => delayRender("Load bundled font & emblem atlas"));

  useEffect(() => {
    Promise.all([ensureFontsLoaded(), ensureLogoAtlasLoaded()])
      .then(([loadedFonts, loadedAtlas]) => {
        if (!loadedFonts.every((set) => set.length > 0)) {
          throw new Error("Bundled display font failed to load");
        }
        setAtlas(loadedAtlas);
        continueRender(handle);
      })
      .catch(cancelRender);
  }, [handle]);

  const timing = useMemo(() => getReelArenaTiming(mode), [mode]);

  return (
    <AbsoluteFill style={{ background: theme.colors.background }}>
      {atlas !== null && (
        <>
          <Sequence durationInFrames={timing.sceneFrames}>
            <ReelArenaCanvas mode={mode} atlas={atlas} />
          </Sequence>
          <Sequence
            from={timing.sceneFrames}
            durationInFrames={timing.closingFrames}
          >
            <ReelClosingCard />
          </Sequence>
          <Audio
            src={staticFile("generated/" + timing.audioSlug + ".wav")}
            volume={1}
          />
        </>
      )}
    </AbsoluteFill>
  );
}
