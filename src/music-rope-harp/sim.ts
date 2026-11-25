import { VIDEO } from "../settings.ts";
import {
  clamp,
  lerp,
  MUSIC_STAGE,
  type PieceScore,
  type VisualNoteEvent,
  type VoiceId,
} from "../music/types.ts";
import { buildRopeHarpScore } from "./score.ts";

export interface ChimeBarSpec {
  readonly barIndex: number;
  readonly midi: number;
  readonly label: string;
  readonly cx: number;
  readonly width: number;
  readonly yTop: number;
  readonly tubeLength: number;
  readonly color: string;
  readonly glowColor: string;
}

export interface RopeWeightEvent {
  readonly noteIndex: number;
  readonly barIndex: number;
  readonly x: number;
  readonly ySpool: number;
  readonly yHang: number;
  readonly yBar: number;
  readonly snipTime: number;
  readonly impactTime: number;
  readonly impactFrame: number;
  readonly bucketIndex: number;
  readonly xBucket: number;
  readonly yBucket: number;
  readonly midi: number;
  readonly velocity: number;
  readonly voice: VoiceId;
  readonly color: string;
}

export interface BucketSpec {
  readonly index: number;
  readonly cx: number;
  readonly yTop: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
}

export interface RopeHarpSimulation {
  readonly score: PieceScore;
  readonly bars: readonly ChimeBarSpec[];
  readonly weights: readonly RopeWeightEvent[];
  readonly buckets: readonly BucketSpec[];
  readonly visualEvents: readonly VisualNoteEvent[];
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

function midiToNoteLabel(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const oct = Math.floor(midi / 12) - 1;
  return `${name}${oct}`;
}

const BAR_PALETTE: readonly (readonly [string, string])[] = [
  ["#38bdf8", "#bae6fd"], // sky cyan
  ["#34d399", "#a7f3d0"], // emerald
  ["#fbbf24", "#fef08a"], // amber gold
  ["#fb7185", "#fecdd3"], // rose coral
  ["#a78bfa", "#ddd6fe"], // violet
  ["#f97316", "#fed7aa"], // tangerine
];

export const FALL_DURATION_SEC = 0.32;
export const CHUTE_ROLL_DURATION_SEC = 0.58;

let cachedRopeSim: RopeHarpSimulation | null = null;

export function simulateRopeHarp(): RopeHarpSimulation {
  if (cachedRopeSim) return cachedRopeSim;

  const score = buildRopeHarpScore();

  // Extract sorted unique MIDI pitches used in the score -> tuned chime bars!
  const uniqueMidis = Array.from(new Set(score.notes.map((n) => n.midi))).sort(
    (a, b) => a - b,
  );
  const barCount = uniqueMidis.length;
  const midiToBar = new Map<number, number>();
  uniqueMidis.forEach((m, idx) => midiToBar.set(m, idx));

  // Symmetrical chime bar rack spanning x = 74 .. 1006 (centred strictly on x = 540!)
  const rackLeft = MUSIC_STAGE.left + 20; // 74
  const rackRight = MUSIC_STAGE.right - 20; // 1006
  const rackWidth = rackRight - rackLeft; // 932 px
  const slotWidth = rackWidth / barCount;
  const barWidth = Math.max(26, slotWidth - 6);
  const yBarTop = 1082;

  const bars: ChimeBarSpec[] = uniqueMidis.map((midi, idx) => {
    const cx = rackLeft + (idx + 0.5) * slotWidth;
    // Symmetrical arch resonator tube profile (longest near edges & centre cathedral pipe style, or pitch-scaled)
    // Use cathedral organ-pipe V-arch symmetry so the physical instrument is visually symmetric around x = 540!
    const distFromCenter = Math.abs((idx + 0.5) / barCount - 0.5) * 2; // 0 at center, 1 at edges
    const tubeLength = Math.round(lerp(148, 86, distFromCenter));
    const [color, glowColor] = BAR_PALETTE[idx % BAR_PALETTE.length];
    return {
      barIndex: idx,
      midi,
      label: midiToNoteLabel(midi),
      cx,
      width: barWidth,
      yTop: yBarTop,
      tubeLength,
      color,
      glowColor,
    };
  });

  // Five symmetrical brass collector buckets along the bottom (centred on x = 540!)
  const bucketXs = [156, 348, 540, 732, 924];
  const buckets: BucketSpec[] = bucketXs.map((cx, index) => ({
    index,
    cx,
    yTop: 1458,
    width: 124,
    height: 112,
    color: BAR_PALETTE[index % BAR_PALETTE.length][0],
  }));

  const weights: RopeWeightEvent[] = [];
  const visualEvents: VisualNoteEvent[] = [];

  // Per-bar occurrence counter so queued weights stagger cleanly in height
  const barOccurrences = new Int32Array(barCount);

  for (let i = 0; i < score.notes.length; i++) {
    const n = score.notes[i];
    const barIdx = midiToBar.get(n.midi) ?? 0;
    const bar = bars[barIdx];
    const occ = barOccurrences[barIdx]++;

    // Hang height staggered deterministically between y = 610 and y = 750
    const yHang = 635 + ((occ * 37 + barIdx * 19) % 105);
    const ySpool = 334;
    const snipTime = n.time - FALL_DURATION_SEC;
    const impactFrame = Math.min(
      score.totalFrames - 1,
      Math.max(0, Math.round(n.time * VIDEO.fps)),
    );

    // Map bar index symmetrically to the nearest of the 5 collector buckets
    const bucketIndex = Math.min(
      buckets.length - 1,
      Math.floor((barIdx / barCount) * buckets.length),
    );
    const bucket = buckets[bucketIndex];

    const voiceColor =
      n.voice === "bell"
        ? "#fef08a"
        : n.voice === "chime"
          ? bar.color
          : n.voice === "arp"
            ? "#67e8f9"
            : "#c084fc";

    weights.push({
      noteIndex: i,
      barIndex: barIdx,
      x: bar.cx,
      ySpool,
      yHang,
      yBar: yBarTop - 16,
      snipTime,
      impactTime: n.time,
      impactFrame,
      bucketIndex,
      xBucket: clamp(bucket.cx + ((i % 5) - 2) * 8, bucket.cx - 32, bucket.cx + 32),
      yBucket: bucket.yTop + 28,
      midi: n.midi,
      velocity: n.velocity,
      voice: n.voice,
      color: voiceColor,
    });

    visualEvents.push({
      noteIndex: i,
      frame: impactFrame,
      time: n.time,
      midi: n.midi,
      velocity: n.velocity,
      voice: n.voice,
    });
  }

  cachedRopeSim = {
    score,
    bars,
    weights,
    buckets,
    visualEvents,
  };
  return cachedRopeSim;
}
