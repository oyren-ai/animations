import { Easing } from "remotion";

export const theme = {
  colors: {
    background: "#080d12", surface: "#14202b", ink: "#f1f5f9", muted: "#a7b6c5",
    primary: "#c8ff85", accent: "#74b9d1", line: "#435869", faint: "#20303e",
    transparent: "rgba(0,0,0,0)", mesh: "rgba(116,185,209,0.14)",
    grade: "rgba(75,120,145,0.08)", grain: "rgba(241,245,249,0.035)",
    vignette: "rgba(0,0,0,0.3)", trail: "rgba(167,182,197,0.16)",
    mapViewport: "rgba(12,21,30,0.78)", mapCard: "rgba(18,30,41,0.88)",
    mapFill: "rgba(116,185,209,0.11)", mapFillLocked: "rgba(200,255,133,0.11)",
    borderRim: "rgba(116,185,209,0.24)", ghostStroke: "rgba(116,185,209,0.85)",
    epicycleRing: "rgba(116,185,209,0.26)", epicycleArm: "rgba(241,245,249,0.48)",
    tracerHalo: "rgba(200,255,133,0.42)", tracerWake: "rgba(200,255,133,0.82)",
    secondaryWake: "rgba(116,185,209,0.78)",
    comebackHudSurface: "rgba(7, 11, 22, 0.86)",
    comebackHudCounter: "rgba(15, 23, 42, 0.85)",
    comebackHudBanner: "rgba(7, 11, 22, 0.92)",
    comebackHudPill: "rgba(7, 11, 22, 0.88)",
    comebackHudBorder: "rgba(226, 232, 240, 0.28)",
    comebackHudCounterBorder: "rgba(148, 163, 184, 0.28)",
    comebackHudInk: "#f8fafc",
    comebackHudMuted: "#94a3b8",
    comebackHudSoftInk: "#cbd5e1",
    comebackHudHighlight: "#fde047",
    comebackHudHighlightInk: "#090d16",
    comebackHudTrack: "rgba(148, 163, 184, 0.22)",
    comebackDividerDark: "#060913",
    comebackDividerLight: "#e2e8f0",
  },
  fontFamily: "Inter Variable",
  ease: { out: Easing.bezier(0.16, 1, 0.3, 1), in: Easing.bezier(0.7, 0, 0.84, 0) },
  spring: {
    smooth: { damping: 22, stiffness: 100, mass: 0.8 },
    snappy: { damping: 18, stiffness: 170, mass: 0.65 },
  },
} as const;

export const easeOut = (value: number) => 1 - (1 - Math.max(0, Math.min(1, value))) ** 3;
export const easeIn = (value: number) => Math.max(0, Math.min(1, value)) ** 3;
