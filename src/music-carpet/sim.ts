import { VIDEO } from "../settings.ts";
import {
  clamp,
  createRng,
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

export interface TiedKnotSpec {
  readonly cellIndex: number;
  readonly gridRow: number;
  readonly weaveRow: number; // 0 = bottom row .. CARPET_ROWS-1 = top row
  readonly col: number;
  readonly noteIndex: number;
  /** Exact time when this individual knot in the note's run pops in */
  readonly popTime: number;
  readonly velocity: number;
  readonly flickAngle: number;
  readonly flickSpeed: number;
}

export interface NoteKnotRunEvent {
  readonly noteIndex: number;
  readonly frame: number;
  readonly time: number;
  readonly endTime: number;
  readonly midi: number;
  readonly duration: number;
  readonly velocity: number;
  readonly voice: VoiceId;
  readonly targetCol: number;
  /** Primary row (weaveRow 0 = bottom) where this note starts tying */
  readonly weaveRow: number;
  readonly gridRow: number;
  readonly startCol: number;
  readonly endCol: number;
  readonly startX: number;
  readonly endX: number;
  readonly baseY: number;
  readonly yarnColor: string;
  readonly knotCount: number;
}

export interface RowCompletionSpec {
  readonly weaveRow: number;
  readonly gridRow: number;
  readonly completedByNote: number;
  readonly completedTime: number;
  /** Frame-drum hit time that beats/packs this completed row (or immediate settle) */
  readonly beatTime: number;
}

export interface BeaterHitEvent {
  readonly time: number;
  readonly velocity: number;
  readonly settlesRow: number | null; // weaveRow settled by this hit, if any
}

export interface CarpetLoomSimulation {
  readonly score: PieceScore;
  readonly cells: readonly CarpetCell[];
  /** Per-cell lookup (length CARPET_COLS * CARPET_ROWS) of when & how that cell is knotted */
  readonly cellKnots: readonly TiedKnotSpec[];
  /** One visual knot-run event per pitched Note in score.notes */
  readonly noteRuns: readonly NoteKnotRunEvent[];
  readonly rowCompletions: readonly RowCompletionSpec[];
  readonly beaterHits: readonly BeaterHitEvent[];
  readonly visualEvents: readonly VisualNoteEvent[];
  readonly carpetLeft: number;
  readonly carpetTop: number;
  readonly carpetWidth: number;
  readonly carpetHeight: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly finalChordTime: number;
  readonly unweaveStartTime: number;
}

const VOICE_FALLBACK_COLOR: Record<VoiceId, string> = {
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

interface UnfilledRun {
  readonly start: number;
  readonly end: number; // inclusive
  readonly length: number;
}

function findUnfilledRuns(rowFilled: Uint8Array): UnfilledRun[] {
  const runs: UnfilledRun[] = [];
  let c = 0;
  while (c < CARPET_COLS) {
    if (rowFilled[c] === 0) {
      const start = c;
      while (c + 1 < CARPET_COLS && rowFilled[c + 1] === 0) {
        c++;
      }
      runs.push({ start, end: c, length: c - start + 1 });
    }
    c++;
  }
  return runs;
}

/**
 * Selects a contiguous slice of `take` columns inside `run` anchored nearest `targetCol`
 * so the melody's pitch contour directly steers where on the row the knotter works.
 */
function pickContiguousColumnsInRun(
  run: UnfilledRun,
  targetCol: number,
  take: number,
): number[] {
  if (take >= run.length) {
    // Sweep from whichever end is closer to targetCol
    const cols: number[] = [];
    if (Math.abs(targetCol - run.start) <= Math.abs(targetCol - run.end)) {
      for (let c = run.start; c <= run.end; c++) cols.push(c);
    } else {
      for (let c = run.end; c >= run.start; c--) cols.push(c);
    }
    return cols;
  }

  // Clamp window [winStart .. winStart + take - 1] inside [run.start .. run.end] centred near targetCol
  const idealStart = Math.round(targetCol - (take - 1) * 0.5);
  const winStart = clamp(idealStart, run.start, run.end - take + 1);
  const winEnd = winStart + take - 1;

  const cols: number[] = [];
  if (Math.abs(targetCol - winStart) <= Math.abs(targetCol - winEnd)) {
    for (let c = winStart; c <= winEnd; c++) cols.push(c);
  } else {
    for (let c = winEnd; c >= winStart; c--) cols.push(c);
  }
  return cols;
}

export function createCarpetLoomSimulation(score: PieceScore): CarpetLoomSimulation {
  const cells = buildCarpetPatternGrid();
  const totalKnots = CARPET_COLS * CARPET_ROWS;
  const noteCount = score.notes.length;
  if (noteCount === 0) {
    throw new Error("Carpet Loom requires at least one note");
  }

  // Symmetrical carpet bed inside walnut loom rails (centred on x = 540, y = 942)
  const carpetLeft = MUSIC_STAGE.left + 36; // 90
  const carpetRight = MUSIC_STAGE.right - 36; // 990 -> width 900 px
  const carpetWidth = carpetRight - carpetLeft;
  const carpetTop = 342;
  const carpetBottom = 1542; // height 1200 px
  const carpetHeight = carpetBottom - carpetTop;

  const cellW = carpetWidth / CARPET_COLS;
  const cellH = carpetHeight / CARPET_ROWS;

  let midiMin = 127;
  let midiMax = 0;
  for (const n of score.notes) {
    if (n.midi < midiMin) midiMin = n.midi;
    if (n.midi > midiMax) midiMax = n.midi;
  }

  // 1. Duration-weighted integer knot quotas summing to EXACTLY totalKnots (CARPET_COLS * CARPET_ROWS)
  // so every note ties >= 1 knot and the final row completes on the final chord!
  const weights = new Float64Array(noteCount);
  let weightSum = 0;
  for (let i = 0; i < noteCount; i++) {
    // Sublinear duration curve so short notes tie ~14-18 knots and long held notes tie ~32-44 knots
    const d = clamp(score.notes[i].duration, 0.12, 1.8);
    const w = Math.pow(d, 0.48);
    weights[i] = w;
    weightSum += w;
  }

  const quotas = new Int32Array(noteCount);
  let prevCum = 0;
  for (let i = 0; i < noteCount; i++) {
    let accW = 0;
    for (let k = 0; k <= i; k++) accW += weights[k];
    const targetCum =
      i === noteCount - 1
        ? totalKnots
        : clamp(
            Math.round((accW / weightSum) * totalKnots),
            prevCum + 1,
            totalKnots - (noteCount - 1 - i),
          );
    quotas[i] = targetCum - prevCum;
    prevCum = targetCum;
  }

  // 2. Simulate row-by-row weaving from bottom (weaveRow = 0, gridRow = CARPET_ROWS - 1)
  // up to top (weaveRow = CARPET_ROWS - 1, gridRow = 0)
  const filledByWeaveRow: Uint8Array[] = Array.from(
    { length: CARPET_ROWS },
    () => new Uint8Array(CARPET_COLS),
  );
  const cellKnots = new Array<TiedKnotSpec>(totalKnots);
  const noteRuns: NoteKnotRunEvent[] = [];
  const rowCompletions: RowCompletionSpec[] = [];
  const visualEvents: VisualNoteEvent[] = [];

  const rng = createRng(20261118);
  let curWeaveRow = 0;

  for (let i = 0; i < noteCount; i++) {
    const n = score.notes[i];
    const pitchNorm = (n.midi - midiMin) / Math.max(1, midiMax - midiMin);
    const targetCol = clamp(
      Math.round(lerp(2, CARPET_COLS - 3, pitchNorm)),
      0,
      CARPET_COLS - 1,
    );

    const nextTime =
      i + 1 < noteCount && score.notes[i + 1].time > n.time + 0.02
        ? score.notes[i + 1].time
        : n.time + Math.min(0.24, n.duration * 0.65);
    const sweepDur = clamp((nextTime - n.time) * 0.78, 0.04, 0.22);

    const startWeaveRow = Math.min(CARPET_ROWS - 1, curWeaveRow);
    const startGridRow = CARPET_ROWS - 1 - startWeaveRow;

    let rem = quotas[i];
    const tiedColsInPrimary: number[] = [];
    let primaryYarnColor: string = VOICE_FALLBACK_COLOR[n.voice];
    let seqIdx = 0;
    const totalForNote = rem;

    while (rem > 0 && curWeaveRow < CARPET_ROWS) {
      const rowArr = filledByWeaveRow[curWeaveRow];
      const runs = findUnfilledRuns(rowArr);
      if (runs.length === 0) {
        curWeaveRow++;
        continue;
      }

      // Pick the unfilled run nearest to targetCol!
      let bestRun = runs[0];
      let bestDist = Infinity;
      for (const r of runs) {
        const dist =
          targetCol >= r.start && targetCol <= r.end
            ? 0
            : Math.min(Math.abs(targetCol - r.start), Math.abs(targetCol - r.end));
        if (dist < bestDist || (dist === bestDist && r.length > bestRun.length)) {
          bestDist = dist;
          bestRun = r;
        }
      }

      const take = Math.min(rem, bestRun.length);
      const chosenCols = pickContiguousColumnsInRun(bestRun, targetCol, take);
      const gRow = CARPET_ROWS - 1 - curWeaveRow;

      for (const col of chosenCols) {
        rowArr[col] = 1;
        const cellIdx = gRow * CARPET_COLS + col;
        const popFrac = totalForNote > 1 ? seqIdx / (totalForNote - 1) : 0;
        const popTime = n.time + popFrac * sweepDur;
        if (seqIdx === Math.floor(totalForNote * 0.5)) {
          primaryYarnColor = cells[cellIdx]?.brightHex ?? primaryYarnColor;
        }
        cellKnots[cellIdx] = {
          cellIndex: cellIdx,
          gridRow: gRow,
          weaveRow: curWeaveRow,
          col,
          noteIndex: i,
          popTime,
          velocity: n.velocity,
          flickAngle: -Math.PI * 0.5 + (rng() - 0.5) * 1.3,
          flickSpeed: 38 + rng() * 54,
        };
        if (curWeaveRow === startWeaveRow) {
          tiedColsInPrimary.push(col);
        }
        seqIdx++;
      }

      rem -= take;

      // Check if curWeaveRow is now 100% complete!
      let allDone = true;
      for (let c = 0; c < CARPET_COLS; c++) {
        if (rowArr[c] === 0) {
          allDone = false;
          break;
        }
      }
      if (allDone) {
        const compTime = n.time + sweepDur * 0.85;
        // Find next frame-drum hit at or after compTime to beat & settle the completed row
        const nextDrum = score.drums.find(
          (d) => (d.kind === "frameDum" || d.kind === "frameTak") && d.time >= compTime,
        );
        const beatTime =
          nextDrum && nextDrum.time <= compTime + 0.6
            ? nextDrum.time
            : compTime + 0.06;
        rowCompletions.push({
          weaveRow: curWeaveRow,
          gridRow: gRow,
          completedByNote: i,
          completedTime: compTime,
          beatTime,
        });
        curWeaveRow++;
      }
    }

    const firstCol = tiedColsInPrimary[0] ?? targetCol;
    const lastCol = tiedColsInPrimary[tiedColsInPrimary.length - 1] ?? firstCol;
    const frame = Math.min(
      score.totalFrames - 1,
      Math.max(0, Math.round(n.time * VIDEO.fps)),
    );

    noteRuns.push({
      noteIndex: i,
      frame,
      time: n.time,
      endTime: n.time + sweepDur,
      midi: n.midi,
      duration: n.duration,
      velocity: n.velocity,
      voice: n.voice,
      targetCol,
      weaveRow: startWeaveRow,
      gridRow: startGridRow,
      startCol: firstCol,
      endCol: lastCol,
      startX: carpetLeft + (firstCol + 0.5) * cellW,
      endX: carpetLeft + (lastCol + 0.5) * cellW,
      baseY: carpetTop + (startGridRow + 0.5) * cellH,
      yarnColor: primaryYarnColor,
      knotCount: quotas[i],
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

  // 3. Build Beater Comb Hit Timeline from score.drums (so every Qaval frame-drum hit beats the weft!)
  const beaterHits: BeaterHitEvent[] = score.drums
    .filter((d) => d.kind === "frameDum" || d.kind === "frameTak")
    .map((d) => {
      // Check if a row just completed within [-0.45s, +0.08s] of this drumbeat
      const matchedRow = rowCompletions.find(
        (rc) => d.time >= rc.completedTime - 0.12 && d.time <= rc.completedTime + 0.55,
      );
      return {
        time: d.time,
        velocity: d.velocity,
        settlesRow: matchedRow ? matchedRow.weaveRow : null,
      };
    });

  const finalChordTime = score.notes[noteCount - 1].time; // 55.80 s
  const unweaveStartTime = Math.min(score.durationSec - 0.85, finalChordTime + 0.95); // ~56.75 s

  return {
    score,
    cells,
    cellKnots,
    noteRuns,
    rowCompletions,
    beaterHits,
    visualEvents,
    carpetLeft,
    carpetTop,
    carpetWidth,
    carpetHeight,
    cellW,
    cellH,
    finalChordTime,
    unweaveStartTime,
  };
}

let cachedCarpetSim: CarpetLoomSimulation | null = null;

export function simulateCarpetLoom(): CarpetLoomSimulation {
  if (!cachedCarpetSim) {
    cachedCarpetSim = createCarpetLoomSimulation(buildCarpetLoomScore());
  }
  return cachedCarpetSim;
}
