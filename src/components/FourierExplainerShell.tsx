import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, useCurrentFrame, useVideoConfig } from "remotion";
import { borderPoint, borderProgress, explainerData, LAYOUT, phaseAt, smooth, TL, toScreenX, toScreenY } from "../country-maps/explainer.ts";
import { paintExplainer } from "../country-maps/explainer-paint.ts";
import {
  CAPTIONS, GOLD, headerAt, INK, LIME, MUTED, ROW_ONE, ROW_THREE, ROW_TWO, type Segment, segmentOpacity,
} from "../country-maps/explainer-text.ts";
import { VIDEO } from "../settings.ts";
import { theme } from "../theme.ts";
import { loadKatexFonts, Tex } from "./Tex.tsx";

const L = LAYOUT;
const FORMULA_SIZE = 63; // first-level subscripts and exponents (0.7 em) stay at 44 px
const CAPTION_SIZE = 46;
const FAMILY = JSON.stringify(theme.fontFamily) + ", sans-serif";

let fonts: Promise<unknown> | undefined;
function loadFonts() {
  fonts ??= Promise.all([
    document.fonts.load("600 46px " + JSON.stringify(theme.fontFamily)),
    document.fonts.load("700 64px " + JSON.stringify(theme.fontFamily)),
    loadKatexFonts(),
  ]);
  return fonts;
}

const fill = { position: "absolute", left: 0, width: VIDEO.width } as const;

function FormulaRow({ index, segments, sec }: { index: number; segments: readonly Segment<string>[]; sec: number }) {
  const row = L.rows[index];
  return <div style={{ ...fill, top: row.top, height: row.height }}>
    {segments.map((segment) => {
      const opacity = segmentOpacity(sec, segment.from, segment.to);
      if (opacity <= 0.002) return null;
      return <div key={segment.key} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity }}>
        <Tex latex={segment.value(sec)} size={FORMULA_SIZE} safe />
      </div>;
    })}
  </div>;
}

function Captions({ sec }: { sec: number }) {
  return <>
    {CAPTIONS.map((segment) => {
      const opacity = segmentOpacity(sec, segment.from, segment.to);
      if (opacity <= 0.002) return null;
      return <div key={segment.key} style={{ ...fill, top: L.caption.top, opacity, fontWeight: 600, fontSize: CAPTION_SIZE }}>
        {segment.value(sec).map((line, i) => <div key={i} data-safe="" style={{
          display: "flex", alignItems: "center", width: "fit-content", margin: "0 auto", height: L.caption.lineHeight, whiteSpace: "pre",
        }}>
          {line.map((piece, j) => piece.x
            ? <Tex key={j} latex={piece.x} size={CAPTION_SIZE} color={piece.c} />
            : <span key={j} style={{ color: piece.c }}>{piece.t}</span>)}
        </div>)}
      </div>;
    })}
  </>;
}

function Header({ sec }: { sec: number }) {
  const state = headerAt(sec);
  const title = smooth((sec - 0.3) / 0.5) * (1 - smooth((sec - TL.centre) / 0.4));
  const counter = smooth((sec - TL.centre) / 0.4);
  const phase = sec < TL.idea ? borderProgress(sec) * 2 * Math.PI : phaseAt(sec) % (2 * Math.PI);
  const readout = smooth((sec - 0.6) / 0.5) * (1 - smooth((sec - TL.final) / 0.5));
  const row = { position: "absolute", top: L.header.top, height: L.header.height, display: "flex", alignItems: "center", whiteSpace: "pre" } as const;
  return <>
    {title > 0.002 && <div data-safe="" style={{ ...row, left: 48, opacity: title, fontSize: 64, fontWeight: 700, color: INK }}>India’s border</div>}
    {counter > 0.002 && <div data-safe="" style={{
      ...row, left: 48, opacity: counter, fontSize: 64, fontWeight: 700, color: LIME,
      transform: "scale(" + (1 + 0.12 * state.pulse) + ")", transformOrigin: "left center",
    }}>
      N = {state.n}<span style={{ color: MUTED, fontSize: 52, fontWeight: 600 }}>{"  (" + state.circles + (state.circles === 1 ? " circle)" : " circles)")}</span>
    </div>}
    {readout > 0.002 && <div data-safe="" style={{
      ...row, right: VIDEO.width - 1032, opacity: readout, fontSize: 52, fontWeight: 600, color: MUTED, fontVariantNumeric: "tabular-nums",
    }}>t = {phase.toFixed(2)}</div>}
  </>;
}

/** x(t) and y(t) readouts during the opening pass, c_0 beside the centre, |c_k| beside the spectrum. */
function PictureLabels({ sec }: { sec: number }) {
  const d = explainerData();
  const p = borderProgress(sec);
  const opening = p > 0 && p < 1;
  const dot = borderPoint(d, p);
  const centre = smooth((sec - TL.centre) / 0.5) * (1 - smooth((sec - TL.singles) / 0.5));
  const spectrum = smooth((sec - (TL.plusOne - 0.6)) / 0.6) * (1 - smooth((sec - TL.final) / 1.5));
  return <>
    {opening && <>
      <div style={{ position: "absolute", left: L.panel.left + 26, top: toScreenY(d, dot.y) - 58 }}><Tex latex={"\\textcolor{" + LIME + "}{y(t)}"} size={50} safe /></div>
      <div style={{ position: "absolute", left: toScreenX(d, dot.x) + 16, top: L.panel.bottom - 64 }}><Tex latex={"\\textcolor{" + LIME + "}{x(t)}"} size={50} safe /></div>
    </>}
    {centre > 0.002 && <div style={{ position: "absolute", left: toScreenX(d, d.center.x) + 20, top: toScreenY(d, d.center.y) - 92, opacity: centre }}>
      <Tex latex={"\\textcolor{" + GOLD + "}{c_0}"} size={FORMULA_SIZE} safe />
    </div>}
    {spectrum > 0.002 && <div style={{ position: "absolute", left: L.spectrum.left - 8, top: L.spectrum.top - 14, opacity: spectrum }}>
      <Tex latex={"\\textcolor{" + MUTED + "}{|c_k|}"} size={FORMULA_SIZE} safe />
    </div>}
  </>;
}

/** Fails loudly in the render log if any marked text leaves the safe area (top and bottom 150 px stay free). */
function useSafeProbe(frame: number) {
  useLayoutEffect(() => {
    const s = L.safe;
    const bad: string[] = [];
    document.querySelectorAll<HTMLElement>("[data-safe]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.left < s.left - 0.5 || r.right > s.right + 0.5 || r.top < s.top - 0.5 || r.bottom > s.bottom + 0.5) {
        bad.push((el.textContent ?? "").slice(0, 24) + " [" + [r.left, r.top, r.right, r.bottom].map(Math.round).join(",") + "]");
      }
    });
    if (bad.length) console.error("SAFE_VIOLATION frame " + frame + ": " + bad.join(" | "));
  });
}

export function FourierExplainerShell() {
  const { fps } = useVideoConfig();
  if (fps !== VIDEO.fps) throw new Error("Use the declared 60 fps timeline for the explainer");
  const frame = useCurrentFrame();
  const sec = frame / fps;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender("Load Inter and the bundled KaTeX fonts"));
  useEffect(() => {
    loadFonts().then(() => { setReady(true); continueRender(handle); }).catch(cancelRender);
  }, [handle]);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) throw new Error("Canvas rendering is unavailable");
    if (ready) paintExplainer(ctx, sec);
  }, [ready, sec]);
  useSafeProbe(frame);
  return <AbsoluteFill style={{ background: theme.colors.background, color: INK, fontFamily: FAMILY }}>
    <canvas ref={canvas} width={VIDEO.width} height={VIDEO.height} style={{ width: "100%", height: "100%" }} />
    {ready && <>
      <Header sec={sec} />
      <FormulaRow index={0} segments={ROW_ONE} sec={sec} />
      <FormulaRow index={1} segments={ROW_TWO} sec={sec} />
      <FormulaRow index={2} segments={ROW_THREE} sec={sec} />
      <PictureLabels sec={sec} />
      <Captions sec={sec} />
    </>}
  </AbsoluteFill>;
}
