import {
  addBassNote,
  addHiHat,
  addKick,
  addPadChord,
  addPluck,
  calibrateStereoMaster,
  createStereoBuffer,
  encodeStereoPcm16Wav,
  extractFrameAudioFeatures,
  panFromScreenX,
  type FrameAudioFeatures,
  type StereoBuffer,
} from "../audio-reactive/synth.ts";
import { CLOSING_FRAMES, SCENE_FRAMES, TOTAL_FRAMES, VIDEO } from "../settings.ts";
import { assertReelSafeBox, drawReelText, type ReelBox } from "../shared/reelUtils.ts";

export const SORT_ITEM_COUNT = 96;
export const SORT_SCENE_FRAMES = SCENE_FRAMES; // 720
export const SORT_CLOSING_FRAMES = CLOSING_FRAMES; // 180
export const SORT_TOTAL_FRAMES = TOTAL_FRAMES; // 900

export type SortAlgoId = "radix" | "quick" | "heap";

export interface RecordedSortStep {
  values: Uint8Array;
  cursorA: number;
  cursorB: number;
  comparisons: number;
  writes: number;
  activeValue: number;
}

export interface AlgoFrameState {
  values: Uint8Array;
  cursorA: number;
  cursorB: number;
  comparisons: number;
  writes: number;
  activeValue: number;
  sorted: boolean;
  verifyIndex: number; // -1 before finish, 0..96 during sweep
}

export interface AlgoTimeline {
  id: SortAlgoId;
  title: string;
  complexity: string;
  accent: string;
  finishFrame: number;
  totalComparisons: number;
  totalWrites: number;
  frames: AlgoFrameState[];
}

export interface HarmonicSortingTrace {
  seed: number;
  initial: Uint8Array;
  algorithms: [AlgoTimeline, AlgoTimeline, AlgoTimeline];
}

function createSeededPermutation(n: number, seed: number): Uint8Array {
  const arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) arr[i] = i + 1;
  let s = seed | 0 || 0x2468ace1;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function recordRadixSortBase4(initial: Uint8Array): RecordedSortStep[] {
  const a = new Uint8Array(initial);
  const steps: RecordedSortStep[] = [];
  let writes = 0;

  // 4 base-4 digits cover 0..255 (96 <= 255)
  for (let shift = 0; shift < 8; shift += 2) {
    const buckets: number[][] = [[], [], [], []];
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      const digit = ((v - 1) >> shift) & 3;
      buckets[digit].push(v);
      steps.push({
        values: new Uint8Array(a),
        cursorA: i,
        cursorB: -1,
        comparisons: 0,
        writes,
        activeValue: v,
      });
    }
    let writeIdx = 0;
    for (let b = 0; b < 4; b++) {
      for (const v of buckets[b]) {
        a[writeIdx] = v;
        writes++;
        steps.push({
          values: new Uint8Array(a),
          cursorA: writeIdx,
          cursorB: Math.max(0, writeIdx - 1),
          comparisons: 0,
          writes,
          activeValue: v,
        });
        writeIdx++;
      }
    }
  }
  return steps;
}

function recordQuickSort(initial: Uint8Array): RecordedSortStep[] {
  const a = new Uint8Array(initial);
  const steps: RecordedSortStep[] = [];
  let comparisons = 0;
  let writes = 0;

  const swap = (i: number, j: number) => {
    if (i === j) return;
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
    writes += 2;
    steps.push({
      values: new Uint8Array(a),
      cursorA: i,
      cursorB: j,
      comparisons,
      writes,
      activeValue: a[i],
    });
  };

  const quick = (lo: number, hi: number) => {
    if (lo >= hi) return;
    const mid = (lo + hi) >> 1;
    // Median-of-3 pivot selection
    comparisons++;
    if (a[mid] < a[lo]) swap(lo, mid);
    comparisons++;
    if (a[hi] < a[lo]) swap(lo, hi);
    comparisons++;
    if (a[mid] < a[hi]) swap(mid, hi);

    const pivot = a[hi];
    let i = lo;
    for (let j = lo; j < hi; j++) {
      comparisons++;
      steps.push({
        values: new Uint8Array(a),
        cursorA: j,
        cursorB: hi,
        comparisons,
        writes,
        activeValue: a[j],
      });
      if (a[j] <= pivot) {
        swap(i, j);
        i++;
      }
    }
    swap(i, hi);
    quick(lo, i - 1);
    quick(i + 1, hi);
  };

  quick(0, a.length - 1);
  return steps;
}

function recordHeapSort(initial: Uint8Array): RecordedSortStep[] {
  const a = new Uint8Array(initial);
  const steps: RecordedSortStep[] = [];
  let comparisons = 0;
  let writes = 0;

  const swap = (i: number, j: number) => {
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
    writes += 2;
    steps.push({
      values: new Uint8Array(a),
      cursorA: i,
      cursorB: j,
      comparisons,
      writes,
      activeValue: a[i],
    });
  };

  const siftDown = (root: number, end: number) => {
    let r = root;
    while (r * 2 + 1 <= end) {
      const child = r * 2 + 1;
      let swapIdx = r;
      comparisons++;
      if (a[swapIdx] < a[child]) swapIdx = child;
      if (child + 1 <= end) {
        comparisons++;
        if (a[swapIdx] < a[child + 1]) swapIdx = child + 1;
      }
      steps.push({
        values: new Uint8Array(a),
        cursorA: r,
        cursorB: swapIdx,
        comparisons,
        writes,
        activeValue: a[swapIdx],
      });
      if (swapIdx === r) return;
      swap(r, swapIdx);
      r = swapIdx;
    }
  };

  for (let start = (a.length >> 1) - 1; start >= 0; start--) {
    siftDown(start, a.length - 1);
  }
  for (let end = a.length - 1; end > 0; end--) {
    swap(end, 0);
    siftDown(0, end - 1);
  }
  return steps;
}

function sampleStepsToTimeline(
  id: SortAlgoId,
  title: string,
  complexity: string,
  accent: string,
  initial: Uint8Array,
  steps: RecordedSortStep[],
  finishFrame: number,
): AlgoTimeline {
  const frames: AlgoFrameState[] = [];
  const lastStep = steps[steps.length - 1];
  const sweepFrames = 32;

  for (let f = 0; f < SORT_SCENE_FRAMES; f++) {
    if (f === 0) {
      frames.push({
        values: new Uint8Array(initial),
        cursorA: 0,
        cursorB: -1,
        comparisons: 0,
        writes: 0,
        activeValue: initial[0],
        sorted: false,
        verifyIndex: -1,
      });
    } else if (f < finishFrame) {
      const stepIdx = Math.min(
        steps.length - 1,
        Math.floor((f / finishFrame) * steps.length),
      );
      const st = steps[stepIdx];
      frames.push({
        values: st.values,
        cursorA: st.cursorA,
        cursorB: st.cursorB,
        comparisons: st.comparisons,
        writes: st.writes,
        activeValue: st.activeValue,
        sorted: false,
        verifyIndex: -1,
      });
    } else {
      const after = f - finishFrame;
      const verifyIdx = Math.min(
        SORT_ITEM_COUNT,
        Math.floor((after / sweepFrames) * SORT_ITEM_COUNT),
      );
      const activeIdx = Math.min(SORT_ITEM_COUNT - 1, verifyIdx);
      frames.push({
        values: lastStep.values,
        cursorA: after < sweepFrames ? activeIdx : -1,
        cursorB: -1,
        comparisons: lastStep.comparisons,
        writes: lastStep.writes,
        activeValue: lastStep.values[activeIdx],
        sorted: true,
        verifyIndex: verifyIdx,
      });
    }
  }

  return {
    id,
    title,
    complexity,
    accent,
    finishFrame,
    totalComparisons: lastStep.comparisons,
    totalWrites: lastStep.writes,
    frames,
  };
}

let cachedSortTrace: HarmonicSortingTrace | null = null;
let cachedSortFeatures: { buffer: StereoBuffer; features: FrameAudioFeatures[] } | null = null;
let cachedSortAudio: { buffer: StereoBuffer; wav: Uint8Array; features: FrameAudioFeatures[] } | null = null;

export function simulateHarmonicSorting(seed = 20261117): HarmonicSortingTrace {
  if (cachedSortTrace && cachedSortTrace.seed === seed) return cachedSortTrace;

  const initial = createSeededPermutation(SORT_ITEM_COUNT, seed);
  const radixSteps = recordRadixSortBase4(initial);
  const quickSteps = recordQuickSort(initial);
  const heapSteps = recordHeapSort(initial);

  const radixTimeline = sampleStepsToTimeline(
    "radix",
    "LSD RADIX SORT",
    "O(n·k) BUCKETS",
    "#c8ff85",
    initial,
    radixSteps,
    408, // 6.80s
  );
  const quickTimeline = sampleStepsToTimeline(
    "quick",
    "QUICK SORT",
    "O(n log n) PIVOT",
    "#38bdf8",
    initial,
    quickSteps,
    552, // 9.20s
  );
  const heapTimeline = sampleStepsToTimeline(
    "heap",
    "MAX-HEAP SORT",
    "O(n log n) SIFT",
    "#f472b6",
    initial,
    heapSteps,
    666, // 11.10s
  );

  cachedSortTrace = {
    seed,
    initial,
    algorithms: [radixTimeline, quickTimeline, heapTimeline],
  };
  return cachedSortTrace;
}

// 3-octave C-Lydian pentatonic ladder (C, D, E, F#, G, A) for crystalline non-fatiguing arpeggios
const LYDIAN_SCALE_HZ = [
  130.813, 146.832, 164.814, 184.997, 195.998, 220.0,
  261.626, 293.665, 329.628, 369.994, 391.995, 440.0,
  523.251, 587.33, 659.255, 739.989, 783.991, 880.0,
  1046.502, 1174.659, 1318.51, 1479.978, 1567.982, 1760.0,
] as const;

function valueToScaleHz(val: number): number {
  const norm = Math.max(0, Math.min(1, (val - 1) / (SORT_ITEM_COUNT - 1)));
  const idx = Math.min(LYDIAN_SCALE_HZ.length - 1, Math.floor(norm * LYDIAN_SCALE_HZ.length));
  return LYDIAN_SCALE_HZ[idx];
}

export function buildHarmonicSortingFeatures(
  trace = simulateHarmonicSorting(),
): { buffer: StereoBuffer; features: FrameAudioFeatures[] } {
  if (cachedSortFeatures && trace === cachedSortTrace) return cachedSortFeatures;

  const buf = createStereoBuffer(SORT_TOTAL_FRAMES, VIDEO.fps);
  const totalSec = SORT_TOTAL_FRAMES / VIDEO.fps;

  // Warm C-Lydian / Am9 stereo pad bed across all 15s
  const chords = [
    [130.813, 195.998, 246.942, 293.665, 369.994],
    [110.0, 164.814, 220.0, 261.626, 329.628],
    [146.832, 220.0, 293.665, 369.994, 440.0],
  ] as const;

  for (let seg = 0; seg < 5; seg++) {
    const startSec = seg * 3.0;
    addPadChord(buf, {
      startSec,
      durationSec: Math.min(3.12, totalSec - startSec),
      frequencies: chords[seg % chords.length],
      gain: 0.16,
      stereoSpread: 0.72,
    });
  }

  // 120 BPM driving electro bass + kick pulse
  for (let eighth = 0; eighth < 60; eighth++) {
    const sec = eighth * 0.25;
    if (eighth % 2 === 0) {
      addKick(buf, {
        startSec: sec,
        gain: sec < 12.0 ? 0.48 : 0.32,
        startHz: 155,
        endHz: 54,
      });
    } else if (sec < 12.0) {
      addHiHat(buf, {
        startSec: sec,
        gain: 0.12,
        pan: eighth % 4 === 1 ? -0.4 : 0.4,
        seed: 5100 + eighth,
      });
    }
    if (sec < 12.0 || eighth % 2 === 0) {
      addBassNote(buf, {
        startSec: sec,
        durationSec: 0.22,
        frequency: eighth % 16 < 8 ? 65.406 : 73.416,
        gain: sec < 12.0 ? 0.26 : 0.2,
        brightness: eighth % 2 === 1 ? 1.2 : 0.85,
      });
    }
  }

  // Sample algorithmic cursor operations every 3 frames (20 Hz arpeggio grid = 16th-triplets)
  // cycling across active bands and celebrating each algorithm's completion sweep
  for (let f = 0; f < SORT_SCENE_FRAMES; f += 3) {
    const sec = f / VIDEO.fps;
    const bandOrder = [(f / 3) % 3, ((f / 3) + 1) % 3, ((f / 3) + 2) % 3];
    let chosenBand = trace.algorithms[bandOrder[0]];
    for (const bIdx of bandOrder) {
      const cand = trace.algorithms[bIdx];
      if (!cand.frames[f].sorted || f - cand.finishFrame < 32) {
        chosenBand = cand;
        break;
      }
    }

    const st = chosenBand.frames[f];
    if (st.cursorA >= 0) {
      const colX = ((st.cursorA + 0.5) / SORT_ITEM_COUNT) * VIDEO.width;
      const pan = panFromScreenX(colX, VIDEO.width, 0.85);
      const isSweep = st.sorted && f - chosenBand.finishFrame < 32;
      addPluck(buf, {
        startSec: sec,
        durationSec: isSweep ? 0.24 : 0.14,
        frequency: valueToScaleHz(st.activeValue),
        gain: isSweep ? 0.22 : 0.15,
        pan,
        fmIndex: isSweep ? 2.1 : 1.4,
      });
    }
  }

  // Victory resolution chords at each algorithm's exact finish frame + closing chime
  for (const algo of trace.algorithms) {
    const fSec = algo.finishFrame / VIDEO.fps;
    for (const [idx, freq] of [261.626, 329.628, 391.995, 587.33].entries()) {
      addPluck(buf, {
        startSec: fSec + idx * 0.045,
        durationSec: 0.65,
        frequency: freq,
        gain: 0.19,
        pan: (idx - 1.5) * 0.42,
        fmIndex: 1.6,
      });
    }
  }

  calibrateStereoMaster(buf, { targetLufs: -14.0, ceilingDbTp: -1.8 });
  const features = extractFrameAudioFeatures(buf.left, buf.right, VIDEO.fps);
  const out = { buffer: buf, features };
  if (trace === cachedSortTrace) cachedSortFeatures = out;
  return out;
}

export function buildHarmonicSortingAudio(
  trace = simulateHarmonicSorting(),
): { buffer: StereoBuffer; wav: Uint8Array; features: FrameAudioFeatures[] } {
  if (cachedSortAudio && trace === cachedSortTrace) return cachedSortAudio;
  const { buffer, features } = buildHarmonicSortingFeatures(trace);
  const wav = encodeStereoPcm16Wav(buffer.left, buffer.right);
  const out = { buffer, wav, features };
  if (trace === cachedSortTrace) cachedSortAudio = out;
  return out;
}

function valueColor(val: number, sortedVerified: boolean, active: boolean): string {
  if (active) return "#ffffff";
  const norm = (val - 1) / (SORT_ITEM_COUNT - 1);
  const hue = Math.round(188 + norm * 135) % 360; // cyan -> indigo -> magenta -> lime
  const sat = sortedVerified ? 92 : 84;
  const light = sortedVerified ? 64 : 55;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function valueBackdropColor(val: number, kick: number): string {
  const norm = (val - 1) / (SORT_ITEM_COUNT - 1);
  const hue = Math.round(192 + norm * 130) % 360;
  const light = Math.round(11 + kick * 6);
  return `hsl(${hue} 58% ${light}%)`;
}

export function paintHarmonicSortingFrame(
  ctx: CanvasRenderingContext2D,
  trace: HarmonicSortingTrace,
  features: readonly FrameAudioFeatures[],
  frame: number,
  width = VIDEO.width,
  height = VIDEO.height,
): ReelBox[] {
  const clampedFrame = Math.max(0, Math.min(SORT_SCENE_FRAMES - 1, frame));
  const feat = features[Math.min(features.length - 1, clampedFrame)];
  const bandH = height / 3; // 640 px each across 1920 px
  const colW = width / SORT_ITEM_COUNT; // 11.25 px across 1080 px (0..1080 edge-to-edge)
  const boxes: ReelBox[] = [];

  // Safe-zone HUD Y anchors per band (Band 0 >= 220, Band 2 <= 1560!)
  const hudTops = [234, 666, 1306] as const;

  for (let bIdx = 0; bIdx < 3; bIdx++) {
    const algo = trace.algorithms[bIdx];
    const st = algo.frames[clampedFrame];
    const bandTop = bIdx * bandH;
    const bandBottom = bandTop + bandH;

    // 1. Full-bleed edge-to-edge vertical color-field aura per column (fills 100% of 1080x640 band)
    for (let i = 0; i < SORT_ITEM_COUNT; i++) {
      const val = st.values[i];
      const x = i * colW;
      ctx.fillStyle = valueBackdropColor(val, feat.kickImpulse);
      ctx.fillRect(x, bandTop, colW + 0.6, bandH);

      // Value bar anchored to bandBottom (leaves zero side margins, spans x=0..1080)
      const norm = val / SORT_ITEM_COUNT;
      const barH = 54 + norm * (bandH - 96);
      const isCursor = i === st.cursorA || i === st.cursorB;
      const isVerified = st.sorted && i <= st.verifyIndex;

      ctx.fillStyle = valueColor(val, isVerified, isCursor);
      ctx.fillRect(x + 0.8, bandBottom - barH, Math.max(2, colW - 1.6), barH);

      // Bright top cap on every bar
      ctx.fillStyle = isCursor ? "#ffffff" : isVerified ? "#c8ff85" : "rgba(255,255,255,0.72)";
      ctx.fillRect(x + 0.8, bandBottom - barH, Math.max(2, colW - 1.6), 4);

      // Full-band vertical laser beam on active read/write cursors
      if (isCursor) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.24)";
        ctx.fillRect(x, bandTop, colW, bandH);
      }
    }

    // Crisp horizontal divider line between full-bleed bands
    if (bIdx > 0) {
      ctx.fillStyle = "rgba(248, 250, 252, 0.35)";
      ctx.fillRect(0, bandTop - 1.5, width, 3);
    }

    // 2. Reel-safe HUD card strictly inside x: 60..900, y: 220..1560
    const cardTop = hudTops[bIdx];
    const cardBox: ReelBox = {
      label: `sort-hud-${algo.id}`,
      left: 68,
      top: cardTop,
      right: 836,
      bottom: cardTop + 94,
    };
    assertReelSafeBox(cardBox);

    ctx.save();
    ctx.fillStyle = "rgba(8, 13, 24, 0.78)";
    ctx.strokeStyle = st.sorted ? "#c8ff85" : algo.accent;
    ctx.lineWidth = st.sorted ? 2.5 : 1.8;
    ctx.beginPath();
    ctx.roundRect(
      cardBox.left,
      cardBox.top,
      cardBox.right - cardBox.left,
      cardBox.bottom - cardBox.top,
      16,
    );
    ctx.fill();
    ctx.stroke();

    const statusBadge = st.sorted ? " · SORTED" : "";
    drawReelText(ctx, boxes, `${algo.title} (${algo.complexity})${statusBadge}`, 90, cardTop + 42, {
      size: 25,
      weight: 800,
      color: st.sorted ? "#c8ff85" : "#f8fafc",
      maxWidth: 720,
    });

    const statsLine =
      algo.id === "radix"
        ? `BUCKET WRITES ${st.writes}   ·   96 FULL-BLEED CHANNELS`
        : `COMPARISONS ${st.comparisons}   ·   WRITES ${st.writes}`;
    drawReelText(ctx, boxes, statsLine, 90, cardTop + 76, {
      size: 19,
      weight: 600,
      color: "#cbd5e1",
      maxWidth: 720,
    });
    ctx.restore();
  }

  return boxes;
}
