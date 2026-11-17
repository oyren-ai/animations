import {
  circleCount, JUMP_SECONDS, JUMP_STAGES, SINGLE_SECONDS, SINGLE_STAGES, smooth, stageAt, TL, weightOf,
} from "./explainer.ts";

export const INK = "#f1f5f9";
export const MUTED = "#a7b6c5";
export const DIM = "#4d5e70";
export const LIME = "#c8ff85";
export const GOLD = "#ffd23f";
export const STEEL = "#6f8fa8";
export const NEW_RANGE = "#ffffff";
const PAIR_BASE = ["", "#3db8ff", "#ff8a3d", "#f45bc1", "#2dd4bf", "#9a86ff"] as const;

function channels(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const u = Math.max(0, Math.min(1, t));
  const part = (x: number, y: number) => Math.round(x + (y - x) * u).toString(16).padStart(2, "0");
  return "#" + part(ar, br) + part(ag, bg) + part(ab, bb);
}

/** One colour per harmonic: gold for c_0, a hue per pair |k| = 1..5, +k vivid and -k its pale tint, steel beyond. */
export function harmonicColor(k: number): string {
  const a = Math.abs(k);
  if (a === 0) return GOLD;
  const base = a <= 5 ? PAIR_BASE[a] : STEEL;
  return k < 0 ? mixHex(base, "#ffffff", 0.55) : base;
}

const col = (hex: string, body: string) => "\\textcolor{" + hex + "}{" + body + "}";
const expo = (k: number) => (k === 0 ? "" : "e^{" + (k < 0 ? "-" : "") + (Math.abs(k) === 1 ? "" : Math.abs(k)) + "it}");
/** The k-th term c_k e^{ikt}, e.g. c_{-2}e^{-2it}. */
export const termLatex = (k: number) => "c_{" + k + "}" + expo(k);
const lit = (k: number, sec: number) => mixHex(DIM, harmonicColor(k), k === 0 ? smooth((sec - TL.centre) / 0.6) : weightOf(k, sec));

export type Segment<T> = {
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly value: (sec: number) => T;
};

/** Cross-fade centred on the boundaries, so neighbouring segments overlap instead of dipping. */
export function segmentOpacity(sec: number, from: number, to: number, fade = 0.4): number {
  return smooth((sec - from) / fade + 0.5) * (1 - smooth((sec - to) / fade + 0.5));
}

const seg = <T>(key: string, from: number, to: number, value: (sec: number) => T): Segment<T> => ({ key, from, to, value });
const N_LIME = col(LIME, "N");

export const ROW_ONE: readonly Segment<string>[] = [
  seg("border", 1, TL.idea, () => "z(t)=x(t)+i\\,y(t)"),
  seg("model", TL.idea, Infinity, () =>
    "z(t)\\approx z_{" + N_LIME + "}(t)=\\sum_{k=-" + N_LIME + "}^{" + N_LIME + "}c_k\\,e^{ikt}"),
];

export const ROW_THREE: readonly Segment<string>[] = [
  seg("coefficients", TL.idea, Infinity, () => "c_k=\\frac{1}{2\\pi}\\int_0^{2\\pi}z(t)\\,e^{-ikt}\\,dt"),
];

/** Row two spells out which terms are being added; unlit terms stay grey until their circle starts to grow. */
export const ROW_TWO: readonly Segment<string>[] = (() => {
  const rows: Segment<string>[] = [
    seg("range", 2.4, TL.idea, () => col(MUTED, "0\\le t<2\\pi")),
    seg("n0", TL.centre, TL.plusOne, (sec) => "z_{0}(t)=" + col(lit(0, sec), "c_0")),
    seg("n1", TL.plusOne, TL.singles, (sec) =>
      "z_{1}(t)=" + col(lit(0, sec), "c_0") + "+" + col(lit(1, sec), termLatex(1)) + "+" + col(lit(-1, sec), termLatex(-1))),
  ];
  SINGLE_STAGES.forEach((n, i) => {
    const from = TL.singles + i * SINGLE_SECONDS;
    rows.push(seg("n" + n, from, from + SINGLE_SECONDS, (sec) =>
      "z_{" + n + "}(t)=z_{" + (n - 1) + "}(t)+" + col(lit(n, sec), termLatex(n)) + "+" + col(lit(-n, sec), termLatex(-n))));
  });
  JUMP_STAGES.forEach((n, i) => {
    const prev = i === 0 ? 5 : JUMP_STAGES[i - 1];
    const from = TL.jumps + i * JUMP_SECONDS;
    rows.push(seg("j" + n, from, from + JUMP_SECONDS, (sec) =>
      "z_{" + n + "}(t)=z_{" + prev + "}(t)+" +
      col(mixHex(DIM, NEW_RANGE, weightOf(prev + 1, sec)), "\\sum_{" + prev + "<|k|\\le " + n + "}c_k\\,e^{ikt}")));
  });
  rows.push(seg("final", TL.final, Infinity, () => "z_{240}(t)=\\sum_{k=-240}^{240}c_k\\,e^{ikt}"));
  return rows;
})();

/** A caption piece: plain text (`t`) or LaTeX (`x`), in colour `c`. */
export type Piece = { readonly t?: string; readonly x?: string; readonly c: string };
export type CaptionLine = readonly Piece[];

const T = (t: string, c = INK): Piece => ({ t, c });
const X = (x: string, c = INK): Piece => ({ x, c });
const caption = (key: string, from: number, to: number, ...lines: CaptionLine[]) =>
  seg<readonly CaptionLine[]>(key, from, to, () => lines);

const JUMP_NOTES: Readonly<Record<number, string>> = {
  8: "higher k: faster, smaller circles",
  16: "the coastline starts to sharpen",
  32: "most circles are already tiny",
  64: "high-k radii fall below a pixel",
  128: "past k = 64 they are mere dots",
  240: "481 circles trace the whole border",
};

export const CAPTIONS: readonly Segment<readonly CaptionLine[]>[] = [
  caption("border", 0.8, TL.idea, [T("A border is a closed curve,")], [T("so it is one complex function of "), X("t")]),
  caption("idea", TL.idea, TL.centre, [T("Idea: write "), X("z(t)"), T(" as a sum of")], [T("circles turning at whole-number speeds")]),
  caption("centre", TL.centre, TL.plusOne, [T("The centre", GOLD)], [T("is the average of the whole border")]),
  caption("plus1", TL.plusOne, TL.minusOne, [X("k=+1", harmonicColor(1)), T(": one turn per loop,", harmonicColor(1))], [T("counterclockwise", harmonicColor(1))]),
  caption("minus1", TL.minusOne, TL.ellipse, [X("k=-1", harmonicColor(-1)), T(": one turn per loop,", harmonicColor(-1))], [T("clockwise", harmonicColor(-1))]),
  caption("ellipse", TL.ellipse, TL.singles, [X("N=1", LIME), T(": two opposite circles")], [T("trace an ellipse")]),
  ...SINGLE_STAGES.map((n, i) => {
    const from = TL.singles + i * SINGLE_SECONDS;
    return caption("s" + n, from, from + SINGLE_SECONDS,
      [X("k=+" + n, harmonicColor(n)), T(": " + n + " turns, counterclockwise", harmonicColor(n))],
      [X("k=-" + n, harmonicColor(-n)), T(": " + n + " turns, clockwise", harmonicColor(-n))]);
  }),
  ...JUMP_STAGES.map((n, i) => {
    const prev = i === 0 ? 5 : JUMP_STAGES[i - 1];
    const from = TL.jumps + i * JUMP_SECONDS;
    return caption("c" + n, from, from + JUMP_SECONDS,
      [T((n - prev) + " new pairs: "), X("k=\\pm" + (prev + 1) + ",\\dots,\\pm" + n)],
      [T(JUMP_NOTES[n], MUTED)]);
  }),
  caption("licence", TL.final + 0.8, Infinity, [T("MIT licensed:")], [T("github.com/oyren-ai/animations", LIME)]),
];

export type HeaderState = {
  readonly mode: "title" | "counter";
  readonly n: number;
  readonly circles: number;
  readonly pulse: number;
};

export function headerAt(sec: number): HeaderState {
  const stage = stageAt(sec);
  const mode = sec < TL.centre ? "title" : "counter";
  const pulse = stage.kind === "single" || stage.kind === "jump" ? Math.max(0, 1 - (sec - stage.start) / 0.5) : 0;
  return { mode, n: stage.n, circles: circleCount(stage.n), pulse };
}
