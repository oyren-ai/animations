import type { FrameAudioFeatures } from "../audio-reactive/synth.ts";
import { CLOSING_FRAMES, VIDEO } from "../settings.ts";
import type { ReelBox } from "../shared/reelUtils.ts";
import {
  clearAfterburnerTraceCache,
  paintAfterburnerLapsFrame,
  simulateAfterburnerLaps,
  type AfterburnerComebackTrace,
} from "./afterburnerLaps.ts";
import {
  buildComebackAudioBundle,
  encodeComebackWavFromBundle,
  type ComebackAudioBundle,
} from "./audio.ts";
import { verifyComebackInvariants, type ComebackSlug } from "./invariants.ts";
import {
  clearSplitterTraceCache,
  paintSplitterFortressFrame,
  simulateSplitterFortress,
  type SplitterComebackTrace,
} from "./splitterFortress.ts";
import {
  clearVaultTraceCache,
  paintVaultComebackFrame,
  simulateVaultComeback,
  type VaultComebackTrace,
} from "./towerVaults.ts";

export type { ComebackSlug } from "./invariants.ts";
export { verifyComebackInvariants } from "./invariants.ts";

export type ComebackCompositionId =
  | "TowerLinearVsExponential"
  | "TitanHammerVsSwarm"
  | "SplitterWallEscape"
  | "AfterburnerLapComeback";

export interface ComebackCompositionDef {
  id: ComebackCompositionId;
  slug: ComebackSlug;
  raceFrames: number;
  closingFrames: number;
  totalFrames: number;
  description: string;
}

export const COMEBACK_COMPOSITIONS: readonly ComebackCompositionDef[] = [
  {
    id: "TowerLinearVsExponential",
    slug: "tower-linear-vs-exponential",
    raceFrames: 1620,
    closingFrames: CLOSING_FRAMES,
    totalFrames: 1620 + CLOSING_FRAMES,
    description:
      "Full-bleed 1080x1920 60fps twin 10-floor doubling-HP vaults: 5,000 linear (+600/s) vs 1 compounding (x10 every 4.5s) photo-finish comeback.",
  },
  {
    id: "TitanHammerVsSwarm",
    slug: "titan-hammer-vs-swarm",
    raceFrames: 1200,
    closingFrames: CLOSING_FRAMES,
    totalFrames: 1200 + CLOSING_FRAMES,
    description:
      "Full-bleed 1080x1920 60fps twin armored vaults: 4,000 micro balls (1 dmg) vs 1 Titan orb (x2 dmg/bounce) overkill cleave comeback.",
  },
  {
    id: "SplitterWallEscape",
    slug: "splitter-wall-escape",
    raceFrames: 1200,
    closingFrames: CLOSING_FRAMES,
    totalFrames: 1200 + CLOSING_FRAMES,
    description:
      "Full-bleed 1080x1920 60fps 10-layer brick fortress: steady 450 bricks/s laser cutter vs 1 Splitter orb (x3 balls per wall) avalanche escape.",
  },
  {
    id: "AfterburnerLapComeback",
    slug: "afterburner-lap-comeback",
    raceFrames: 1200,
    closingFrames: CLOSING_FRAMES,
    totalFrames: 1200 + CLOSING_FRAMES,
    description:
      "Full-bleed 1080x1920 60fps vertical 100-lap race: steady 900 km/h cruiser vs +18% speed per bounce relativistic overdrive.",
  },
] as const;

export type ComebackTrace =
  | VaultComebackTrace
  | SplitterComebackTrace
  | AfterburnerComebackTrace;

export function simulateComeback(slug: ComebackSlug): ComebackTrace {
  switch (slug) {
    case "tower-linear-vs-exponential":
    case "titan-hammer-vs-swarm":
      return simulateVaultComeback(slug);
    case "splitter-wall-escape":
      return simulateSplitterFortress();
    case "afterburner-lap-comeback":
      return simulateAfterburnerLaps();
  }
}

const AUDIO_BUNDLE_CACHE = new Map<ComebackSlug, ComebackAudioBundle>();

export function clearComebackCaches(): void {
  AUDIO_BUNDLE_CACHE.clear();
  clearVaultTraceCache();
  clearSplitterTraceCache();
  clearAfterburnerTraceCache();
}

export function buildComebackAudio(slug: ComebackSlug): ComebackAudioBundle {
  const cached = AUDIO_BUNDLE_CACHE.get(slug);
  if (cached) return cached;
  const trace = simulateComeback(slug);
  verifyComebackInvariants(trace);
  const bundle = buildComebackAudioBundle(trace);
  AUDIO_BUNDLE_CACHE.set(slug, bundle);
  return bundle;
}

export function buildComebackFeatures(slug: ComebackSlug): readonly FrameAudioFeatures[] {
  return buildComebackAudio(slug).features;
}

export function synthesizeComebackWav(slug: ComebackSlug): Uint8Array {
  return encodeComebackWavFromBundle(buildComebackAudio(slug));
}

export function paintComebackFrame(
  ctx: CanvasRenderingContext2D,
  trace: ComebackTrace,
  features: readonly FrameAudioFeatures[],
  frame: number,
  width = VIDEO.width,
  height = VIDEO.height,
): ReelBox[] {
  switch (trace.slug) {
    case "tower-linear-vs-exponential":
    case "titan-hammer-vs-swarm":
      return paintVaultComebackFrame(ctx, trace, features, frame, width, height);
    case "splitter-wall-escape":
      return paintSplitterFortressFrame(ctx, trace, features, frame, width, height);
    case "afterburner-lap-comeback":
      return paintAfterburnerLapsFrame(ctx, trace, features, frame, width, height);
  }
}
