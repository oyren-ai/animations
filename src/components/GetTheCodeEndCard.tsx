import type { CSSProperties } from "react";
import { AbsoluteFill, spring } from "remotion";
import { easeIn, theme } from "../theme.ts";
import { VIDEO } from "../settings.ts";

export const END_CARD_COPY = {
  heading: "Get the code for this animation",
  mapHeading: "Find the code in oyren-ai/animations",
  repository: "github.com/oyren-ai/animations",
  repositoryUrl: "https://github.com/oyren-ai/animations",
  attribution: "Built with Oyren · oyren.ai",
} as const;

/** Pure frame input also makes this component usable outside a Remotion timeline. */
export function GetTheCodeEndCard({
  frame,
  fps = VIDEO.fps,
  heading = END_CARD_COPY.heading,
}: {
  frame: number;
  fps?: number;
  heading?: string;
}) {
  const C = theme.colors;
  const exit = 1 - easeIn((frame / fps - (VIDEO.closingSeconds - 0.17)) / 0.17);
  const enter = (delay: number): CSSProperties => {
    const p = spring({ frame: frame - delay * fps, fps, config: theme.spring.smooth });
    return { opacity: Math.max(0, Math.min(1, p)) * exit,
      transform: "translateY(" + ((1 - p) * 28 + Math.sin(frame / fps * 1.5) * 1.5) + "px) scale(" + (0.96 + p * 0.04) + ")" };
  };
  return (
    <AbsoluteFill style={{ background: C.background, fontFamily: theme.fontFamily, color: C.ink, justifyContent: "center", alignItems: "center" }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 45% 45%, " + C.mesh + ", " + C.transparent + " 65%)" }} />
      <div style={{ position: "relative", width: 900, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 44 }}>
        <div style={{ ...enter(0), fontSize: 54, fontWeight: 700, lineHeight: 1.24, maxWidth: 860 }}>{heading}</div>
        <a href={END_CARD_COPY.repositoryUrl} style={{ ...enter(0.08), fontSize: 44, fontWeight: 750, letterSpacing: -0.8, color: C.primary, textDecoration: "none", whiteSpace: "nowrap", padding: "18px 36px", borderRadius: 999, background: C.surface, border: "1.5px solid " + C.line }}>{END_CARD_COPY.repository}</a>
        <div style={{ ...enter(0.16), fontSize: 32, color: C.muted, fontWeight: 500 }}>{END_CARD_COPY.attribution}</div>
      </div>
      <AbsoluteFill style={{ pointerEvents: "none", background: C.grade, mixBlendMode: "soft-light" }} />
      <AbsoluteFill style={{ pointerEvents: "none", backgroundImage: "repeating-linear-gradient(0deg, " + C.transparent + " 0px 3px, " + C.grain + " 3px 4px)", opacity: 0.2 }} />
      <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse at center, " + C.transparent + " 50%, " + C.vignette + " 100%)" }} />
    </AbsoluteFill>
  );
}
