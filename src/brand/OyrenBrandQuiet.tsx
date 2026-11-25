import type { CSSProperties } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme.ts";
import { OYREN_BRAND, OyrenWordmark } from "./OyrenBrand.tsx";

/**
 * Quiet Oyren brand layer for the v3 vertical clips: a subtle 30 px official wordmark centred on x = 540
 * near y = 110 (no pill, no button, no call to action, centred 12 px zero-offset dark halo <= 0.30 alpha).
 * Fades in via cosine ease from 0.8 s over 1.2 s to 0.70, rises in the final 2.5 s to 0.85 while a 16 px
 * cap-height "oyren.ai" (opacity 0.60) fades in beneath it, and fades completely out over the final 0.6 s.
 */
export const OYREN_QUIET_DEFAULTS = {
  topY: 110,
  markHeight: 30,
  baseOpacity: 0.7,
  endOpacity: 0.85,
  urlOpacity: 0.6,
  urlFontSize: 22, // Inter cap-height ~0.727 em -> 16.0 px cap height
  urlGapPx: 15,    // half a 30 px logo height clear below wordmark (y = 125 -> 140), leaving >= 18 px above y = 178 title
  fadeInStartSec: 0.8,
  fadeInDurSec: 1.2,
  endLiftSec: 2.5,
  endTransitionSec: 0.5,
  fadeOutSec: 0.6,
  glowBlurPx: 12,
  glowAlpha: 0.28,
} as const;

export type OyrenBrandQuietProps = {
  topY?: number;
  markHeight?: number;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const cosineEase = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(u));

export interface QuietBrandState {
  markOpacity: number;
  urlOpacity: number;
  markTop: number;
  markBottom: number;
  markWidth: number;
  urlTop: number;
}

export function computeQuietBrandState(
  frame: number,
  fps: number,
  durationInFrames: number,
  topY: number = OYREN_QUIET_DEFAULTS.topY,
  markHeight: number = OYREN_QUIET_DEFAULTS.markHeight,
): QuietBrandState {
  const D = OYREN_QUIET_DEFAULTS;
  const t = frame / fps;
  const endSec = Math.max(3.5, (durationInFrames - 1) / fps);

  const fadeIn = cosineEase((t - D.fadeInStartSec) / D.fadeInDurSec);
  const liftStart = endSec - D.endLiftSec;
  const lift = cosineEase((t - liftStart) / D.endTransitionSec);
  const fadeOut = 1 - cosineEase((t - (endSec - D.fadeOutSec)) / D.fadeOutSec);

  const rawMark = t < liftStart
    ? D.baseOpacity * fadeIn
    : D.baseOpacity + (D.endOpacity - D.baseOpacity) * lift;
  const markOpacity = Number((rawMark * fadeOut).toFixed(6));
  const urlOpacity = Number((D.urlOpacity * lift * fadeOut).toFixed(6));

  const markTop = topY - markHeight / 2;
  const markBottom = topY + markHeight / 2;
  const markWidth = (markHeight * OYREN_BRAND.markWidth) / OYREN_BRAND.markHeight;
  const urlTop = markBottom + D.urlGapPx;

  return { markOpacity, urlOpacity, markTop, markBottom, markWidth, urlTop };
}

export function OyrenBrandQuietView({
  frame,
  fps,
  durationInFrames,
  topY = OYREN_QUIET_DEFAULTS.topY,
  markHeight = OYREN_QUIET_DEFAULTS.markHeight,
}: OyrenBrandQuietProps & { frame: number; fps: number; durationInFrames: number }) {
  const D = OYREN_QUIET_DEFAULTS;
  const st = computeQuietBrandState(frame, fps, durationInFrames, topY, markHeight);
  const row: CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
    pointerEvents: "none",
  };
  const halo = `rgba(0,0,0,${D.glowAlpha})`;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", fontFamily: theme.fontFamily }}>
      {st.markOpacity > 0.001 ? (
        <div style={{ ...row, top: st.markTop, opacity: st.markOpacity }}>
          <OyrenWordmark
            height={markHeight}
            style={{ filter: `drop-shadow(0 0 ${D.glowBlurPx}px ${halo})` }}
          />
        </div>
      ) : null}
      {st.urlOpacity > 0.001 ? (
        <div
          style={{
            ...row,
            top: st.urlTop,
            height: 22,
            alignItems: "center",
            opacity: st.urlOpacity,
            fontSize: D.urlFontSize,
            fontWeight: 500,
            letterSpacing: 0.6,
            lineHeight: 1,
            color: OYREN_BRAND.white,
            textShadow: `0 0 ${D.glowBlurPx}px ${halo}`,
          }}
        >
          {OYREN_BRAND.url}
        </div>
      ) : null}
    </div>
  );
}

/** Place as the LAST child of the v3 compositions (`MidiMughamNocturne`, `MidiBakuNights`). */
export function OyrenBrandQuietLayer(props: OyrenBrandQuietProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  return <OyrenBrandQuietView {...props} frame={frame} fps={fps} durationInFrames={durationInFrames} />;
}
