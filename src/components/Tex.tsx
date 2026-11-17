import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";

const KATEX_FONTS = [
  "400 1em KaTeX_Main", "italic 400 1em KaTeX_Main", "700 1em KaTeX_Main", "italic 400 1em KaTeX_Math",
  "400 1em KaTeX_AMS", "400 1em KaTeX_Size1", "400 1em KaTeX_Size2", "400 1em KaTeX_Size3", "400 1em KaTeX_Size4",
];

/** The bundled KaTeX fonts load lazily; wait for them so every rendered frame is typeset the same way. */
export function loadKatexFonts() {
  return Promise.all(KATEX_FONTS.map((font) => document.fonts.load(font)));
}

/** True mathematical typesetting. KaTeX scales its root by 1.21, so `size` is the real base font size in px. */
export function Tex({ latex, size, color, safe = false }: { latex: string; size: number; color?: string; safe?: boolean }) {
  const html = useMemo(() => katex.renderToString(latex, { throwOnError: true, strict: "error", output: "html" }), [latex]);
  return <span data-safe={safe ? "" : undefined} style={{ fontSize: size / 1.21, color, whiteSpace: "nowrap" }}
    dangerouslySetInnerHTML={{ __html: html }} />;
}
