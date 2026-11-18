import { VIDEO } from "../settings.ts";

export type VoiceId =
  | "lead"
  | "harmony"
  | "bass"
  | "arp"
  | "tar"
  | "kamancha"
  | "chime"
  | "bell"
  | "brass"
  | "pizzicato";

export type DrumKind =
  | "kick"
  | "snare"
  | "hat"
  | "openHat"
  | "frameDum"
  | "frameTak";

export interface Note {
  /** Onset time in seconds (>= 0, < durationSec) */
  readonly time: number;
  /** Note duration in seconds (> 0) */
  readonly duration: number;
  /** Equal-temperament MIDI pitch (69 = A4 = 440 Hz) */
  readonly midi: number;
  /** Normalized velocity in (0, 1] */
  readonly velocity: number;
  /** Instrument voice */
  readonly voice: VoiceId;
  /** Optional stereo pan in [-1, 1] */
  readonly pan?: number;
  /** Optional structural marker */
  readonly section?: "hook" | "theme" | "build" | "pause" | "payoff" | "loop";
}

export interface DrumHit {
  readonly time: number;
  readonly kind: DrumKind;
  readonly velocity: number;
  readonly pan?: number;
}

export interface DroneSegment {
  readonly startTime: number;
  readonly endTime: number;
  readonly midi: number;
  readonly gain: number;
  /** Optional fifth harmonic addition */
  readonly withFifth?: boolean;
}

export interface RiserCue {
  readonly startTime: number;
  readonly endTime: number;
  readonly startMidi: number;
  readonly endMidi: number;
  readonly gain: number;
}

export interface PieceScore {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly subtitle: string;
  readonly durationSec: number;
  readonly totalFrames: number;
  readonly notes: readonly Note[];
  readonly drums: readonly DrumHit[];
  readonly drones: readonly DroneSegment[];
  readonly risers: readonly RiserCue[];
}

export interface VisualNoteEvent {
  readonly noteIndex: number;
  readonly frame: number;
  readonly time: number;
  readonly midi: number;
  readonly velocity: number;
  readonly voice: VoiceId;
}

/**
 * Centred vertical-video framing geometry:
 * - Horizontal centre at x = 540 with equal margins (left = 54, right = 1026 -> 972 px wide)
 * - Main subject vertical bounds y = 290 .. 1600 -> vertical centre y = 945 (target 900..980),
 *   top band 290 px (< 350 px), bottom band 320 px (< 350 px and > 200 px clear of bottom)
 * - Centred title & subtitle inside central 840 px at y = 190..242, never overlapping main art.
 */
export const MUSIC_STAGE = {
  width: VIDEO.width,
  height: VIDEO.height,
  fps: VIDEO.fps,
  cx: 540,
  cy: 945,
  left: 54,
  right: 1026,
  artWidth: 972,
  top: 290,
  bottom: 1600,
  artHeight: 1310,
  titleY: 192,
  subtitleY: 234,
  maxTextWidth: 840,
} as const;

/** Glyph preload string covering ASCII + Azerbaijani Latin Extended characters */
export const FONT_PRELOAD_SAMPLE = "BESbswy 0123456789 ƏəİıĞğŞşÇçÖöÜü ·—";

export const MUSIC_FONT_STACK =
  '"Inter Variable", Inter, "DejaVu Sans", "Liberation Sans", sans-serif';

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Seeded deterministic Mulberry32 PRNG (no Math.random anywhere) */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Draws centred title and subtitle strictly inside central 840 px at y = 192 / 234,
 * well above MUSIC_STAGE.top (290) so text never overlaps the art.
 */
export function drawCentredTitleBlock(
  ctx: CanvasRenderingContext2D,
  title: string,
  subtitle: string,
  opts: {
    titleColor?: string;
    subtitleColor?: string;
    accentColor?: string;
    alpha?: number;
  } = {},
): void {
  const {
    titleColor = "#f8fafc",
    subtitleColor = "rgba(226, 232, 240, 0.72)",
    accentColor = "rgba(248, 250, 252, 0.28)",
    alpha = 1,
  } = opts;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  let titleSize = 36;
  while (titleSize > 20) {
    ctx.font = `700 ${titleSize}px ${MUSIC_FONT_STACK}`;
    if (ctx.measureText(title).width <= MUSIC_STAGE.maxTextWidth) break;
    titleSize -= 1;
  }
  ctx.fillStyle = titleColor;
  ctx.fillText(title, MUSIC_STAGE.cx, MUSIC_STAGE.titleY);

  if (subtitle) {
    let subSize = 21;
    while (subSize > 14) {
      ctx.font = `500 ${subSize}px ${MUSIC_FONT_STACK}`;
      if (ctx.measureText(subtitle).width <= MUSIC_STAGE.maxTextWidth) break;
      subSize -= 1;
    }
    ctx.fillStyle = subtitleColor;
    ctx.fillText(subtitle, MUSIC_STAGE.cx, MUSIC_STAGE.subtitleY);
  }

  // Subtle symmetric hairline divider under subtitle (centred on x = 540)
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(MUSIC_STAGE.cx - 84, MUSIC_STAGE.subtitleY + 18);
  ctx.lineTo(MUSIC_STAGE.cx + 84, MUSIC_STAGE.subtitleY + 18);
  ctx.stroke();

  ctx.restore();
}
