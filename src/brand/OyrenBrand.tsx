import type { CSSProperties } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme.ts";

/**
 * Oyren brand layer for the vertical clips. This is ONE shared file: keep it byte-identical in every branch.
 * The wordmark paths are the official logo, copied from docs/oyren-button.svg (lime O, white YREN).
 * Layout is symmetric about x = width / 2. Defaults assume a 1080 x 1920 frame whose title starts near y = 190.
 */
export const OYREN_BRAND = {
  lime: "#c8ff00",
  white: "#ffffff",
  ink: "#03080a",
  url: "oyren.ai",
  ctaLead: "Open this in",
  markWidth: 595.49,
  markHeight: 66.93,
} as const;

export const WORDMARK_PATHS: ReadonlyArray<{ d: string; fill: string }> = [
  { d: "M33.4337 0H95.0688C103.936 1.32263e-07 112.44 3.52598 118.71 9.80227C124.98 16.0786 128.503 24.591 128.503 33.467C128.503 42.3431 124.98 50.8555 118.71 57.1318C112.44 63.4081 103.936 66.9341 95.0688 66.9341H33.4337C24.5665 66.9341 16.0625 63.4081 9.7925 57.1318C3.52247 50.8555 0 42.3431 0 33.467C0 24.591 3.52247 16.0786 9.7925 9.80227C16.0625 3.52598 24.5665 1.32263e-07 33.4337 0ZM42.0256 21.0312H86.477C89.7719 21.0312 92.9318 22.3414 95.2617 24.6736C97.5915 27.0057 98.9004 30.1689 98.9004 33.467C98.9004 36.7652 97.5915 39.9283 95.2617 42.2605C92.9318 44.5927 89.7719 45.9029 86.477 45.9029H42.0256C38.7307 45.9029 35.5707 44.5927 33.2409 42.2605C30.911 39.9283 29.6021 36.7652 29.6021 33.467C29.6021 30.1689 30.911 27.0057 33.2409 24.6736C35.5707 22.3414 38.7307 21.0312 42.0256 21.0312Z", fill: OYREN_BRAND.lime },
  { d: "M191.178 65.4711H162.86V42.4282L120.383 1.46307H155.735L177.019 22.5857L198.303 1.46307H233.655L191.178 42.4282V65.4711Z", fill: OYREN_BRAND.white },
  { d: "M266.907 65.4711H238.588V1.46307H329.663C336.179 1.46307 341.173 2.91087 344.644 5.80647C348.116 8.70207 349.851 12.6797 349.851 17.7394C349.851 21.6408 348.664 24.8108 346.289 27.2492C343.914 29.6876 340.199 31.364 335.144 32.2784V34.1072C340.686 34.5948 344.858 36.1646 347.659 38.8163C350.46 41.4681 351.861 44.8971 351.861 49.1033V65.4711H322.264V50.0177C322.264 48.9204 321.929 48.0365 321.259 47.366C320.589 46.6954 319.676 46.3601 318.519 46.3601H266.907V65.4711ZM266.907 20.9398H316.692C317.727 20.9398 318.61 21.2751 319.341 21.9456C320.072 22.6162 320.437 23.622 320.437 24.9632C320.437 26.1824 320.102 27.1577 319.432 27.8892C318.762 28.6208 317.849 28.9865 316.692 28.9865H266.907V20.9398Z", fill: OYREN_BRAND.white },
  { d: "M473.355 65.4711H360.083V1.46307H473.355V19.934H388.401V25.6032H463.489V41.3309H388.401V47.0002H473.355V65.4711Z", fill: OYREN_BRAND.white },
  { d: "M510.533 65.4711H482.215V1.46307H510.168L567.17 36.7589V1.46307H595.488V65.4711H567.535L510.533 30.1752V65.4711Z", fill: OYREN_BRAND.white },
];

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeOut = (v: number) => 1 - (1 - Math.max(0, Math.min(1, v))) ** 3;

export function OyrenWordmark({ height, style }: { height: number; style?: CSSProperties }) {
  const width = (height * OYREN_BRAND.markWidth) / OYREN_BRAND.markHeight;
  return (
    <svg
      width={width}
      height={height}
      viewBox={"0 0 " + OYREN_BRAND.markWidth + " " + OYREN_BRAND.markHeight}
      role="img"
      aria-label="Oyren"
      style={{ display: "block", ...style }}
    >
      {WORDMARK_PATHS.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill} fillRule="evenodd" clipRule="evenodd" />
      ))}
    </svg>
  );
}

export type OyrenBrandLayerProps = {
  /** Centre line of the top wordmark, px from the top. */
  topY?: number;
  /** Height of the top wordmark in px (50 is about 445 px wide). */
  markHeight?: number;
  /** Centre line of the footer url and of the closing pill, px from the top. */
  footerY?: number;
  /** The closing "Open this in Oyren" pill replaces the plain url during the last this many seconds. */
  ctaSeconds?: number;
  /** false leaves out the footer url and the closing pill, so only the top wordmark remains. */
  footer?: boolean;
};

/** Pure frame input, so it also renders outside a Remotion timeline (tests, stills). */
export function OyrenBrandLayerView({
  frame,
  fps,
  durationInFrames,
  topY = 112,
  markHeight = 50,
  footerY = 1768,
  ctaSeconds = 2.5,
  footer = true,
}: OyrenBrandLayerProps & { frame: number; fps: number; durationInFrames: number }) {
  const t = frame / fps;
  const ctaStart = Math.max(0, durationInFrames / fps - ctaSeconds);
  const urlOpacity = 1 - interpolate(t, [ctaStart - 0.2, ctaStart + 0.1], [0, 1], clamp);
  const pill = easeOut(interpolate(t, [ctaStart, ctaStart + 0.35], [0, 1], clamp));
  const row: CSSProperties = { position: "absolute", left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" };
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", fontFamily: theme.fontFamily }}>
      <div style={{ ...row, top: topY - markHeight / 2 }}>
        <OyrenWordmark height={markHeight} style={{ filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.55))" }} />
      </div>
      {footer ? (
        <>
          <div
            style={{
              ...row,
              top: footerY - 20,
              height: 40,
              alignItems: "center",
              opacity: urlOpacity,
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: 0.5,
              color: "rgba(241,245,249,0.92)",
              textShadow: "0 2px 6px rgba(0,0,0,0.6)",
            }}
          >
            {OYREN_BRAND.url}
          </div>
          {pill > 0 ? (
            <div style={{ ...row, top: footerY - 56, height: 112, alignItems: "center" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 22,
                  height: 112,
                  padding: "0 44px",
                  boxSizing: "border-box",
                  borderRadius: 26,
                  background: "rgba(3,8,10,0.94)",
                  border: "3px solid rgba(200,255,0,0.55)",
                  color: OYREN_BRAND.white,
                  fontSize: 40,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  opacity: pill,
                  transform: "translateY(" + (1 - pill) * 14 + "px) scale(" + (0.94 + 0.06 * pill) + ")",
                }}
              >
                <span>{OYREN_BRAND.ctaLead}</span>
                <OyrenWordmark height={40} />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Put this as the LAST child of a composition so it sits on top of the scene. */
export function OyrenBrandLayer(props: OyrenBrandLayerProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  return <OyrenBrandLayerView {...props} frame={frame} fps={fps} durationInFrames={durationInFrames} />;
}
