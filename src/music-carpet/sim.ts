import { VIDEO } from "../settings.ts";
import {
  clamp,
  lerp,
  MUSIC_STAGE,
  type PieceScore,
  type VisualNoteEvent,
  type VoiceId,
} from "../music/types.ts";
import {
  buildCarpetPatternGrid,
  CARPET_COLS,
  CARPET_DYES,
  CARPET_ROWS,
  type CarpetCell,
} from "./pattern.ts";
import { buildCarpetLoomScore } from "./score.ts";

export interface KnotTuftEvent {
  readonly noteIndex: number;
  readonly frame: number;
  readonly time: number;
  readonly col: number;
  readonly mirrorCol: number;
  readonly row: number;
  readonly x: number;
  readonly mirrorX: number;
  readonly baseY: number;
  readonly midi: number;
  readonly velocity: number;
  readonly voice: VoiceId;
  readonly yarnColor: string;
}

export interface CarpetLoomSimulation {
  readonly score: PieceScore;
  readonly cells: readonly CarpetCell[];
  readonly knots: readonly KnotTuftEvent[];
  readonly visualEvents: readonly VisualNoteEvent[];
  readonly carpetLeft: number;
  readonly carpetTop: number;
  readonly carpetWidth: number;
  readonly carpetHeight: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly payoffTime: number;
}

const VOICE_YARN_COLOR: Record<VoiceId, string> = {
  tar: CARPET_DYES.ochreBright,
  kamancha: CARPET_DYES.madderBright,
  bass: CARPET_DYES.indigo,
  arp: CARPET_DYES.ivory,
  harmony: CARPET_DYES.greenBright,
  lead: CARPET_DYES.ochreBright,
  chime: CARPET_DYES.ivory,
  bell: CARPET_DYES.ochreBright,
  brass: CARPET_DYES.madderBright,
  pizzicato: CARPET_DYES.greenBright,
};

export function createCarpetLoomSimulation(score: PieceScore): CarpetLoomSimulation {
  const cells = buildCarpetPatternGrid();

  // Symmetrical carpet bed inside walnut loom rails (centred on x = 540, y = 944!)
  const carpetLeft = MUSIC_STAGE.left + 36; // 90
  const carpetRight = MUSIC_STAGE.right - 36; // 990 -> width 900 px, symmetric!
  const carpetWidth = carpetRight - carpetLeft;
  const carpetTop = 342;
  const carpetBottom = 1542; // height 1200 px, centre y = 942!
  const carpetHeight = carpetBottom - carpetTop;

  const cellW = carpetWidth / CARPET_COLS;
  const cellH = carpetHeight / CARPET_ROWS;

  let midiMin = 127;
  let midiMax = 0;
  for (const n of score.notes) {
    if (n.midi < midiMin) midiMin = n.midi;
    if (n.midi > midiMax) midiMax = n.midi;
  }

  let payoffTime = score.durationSec * 0.76;
  for (const n of score.notes) {
    if (n.section === "payoff") {
      payoffTime = n.time;
      break;
    }
  }

  const knots: KnotTuftEvent[] = [];
  const visualEvents: VisualNoteEvent[] = [];

  for (let i = 0; i < score.notes.length; i++) {
    const n = score.notes[i];
    const pitchNorm = (n.midi - midiMin) / Math.max(1, midiMax - midiMin);
    const col = clamp(
      Math.round(lerp(4, CARPET_COLS - 5, pitchNorm)),
      0,
      CARPET_COLS - 1,
    );
    const mirrorCol = CARPET_COLS - 1 - col;
    const timeNorm = clamp(n.time / Math.max(0.1, score.durationSec * 0.94), 0, 1);
    const row = clamp(
      Math.round(lerp(3, CARPET_ROWS - 4, timeNorm)),
      0,
      CARPET_ROWS - 1,
    );

    const frame = Math.min(
      score.totalFrames - 1,
      Math.max(0, Math.round(n.time * VIDEO.fps)),
    );
    const x = carpetLeft + (col + 0.5) * cellW;
    const mirrorX = carpetLeft + (mirrorCol + 0.5) * cellW;
    const baseY = carpetTop + (row + 0.5) * cellH;
    const cell = cells[row * CARPET_COLS + col];

    knots.push({
      noteIndex: i,
      frame,
      time: n.time,
      col,
      mirrorCol,
      row,
      x,
      mirrorX,
      baseY,
      midi: n.midi,
      velocity: n.velocity,
      voice: n.voice,
      yarnColor: cell?.brightHex ?? VOICE_YARN_COLOR[n.voice],
    });

    visualEvents.push({
      noteIndex: i,
      frame,
      time: n.time,
      midi: n.midi,
      velocity: n.velocity,
      voice: n.voice,
    });
  }

  return {
    score,
    cells,
    knots,
    visualEvents,
    carpetLeft,
    carpetTop,
    carpetWidth,
    carpetHeight,
    cellW,
    cellH,
    payoffTime,
  };
}

let cachedCarpetSim: CarpetLoomSimulation | null = null;

export function simulateCarpetLoom(): CarpetLoomSimulation {
  if (!cachedCarpetSim) {
    cachedCarpetSim = createCarpetLoomSimulation(buildCarpetLoomScore());
  }
  return cachedCarpetSim;
}
