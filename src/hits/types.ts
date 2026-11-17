import type { StereoBuffer } from "../audio-reactive/synth.ts";
import type { ReelBox } from "../shared/reelUtils.ts";
import { CLOSING_FRAMES, VIDEO } from "../settings.ts";

/** One seed for every hit video. It is shown on screen; tuning is done on constants, never by picking a seed. */
export const HIT_SEED = 20261117;

/** The 3 s Oyren end card that follows every hit scene. */
export const HIT_CLOSING_FRAMES = CLOSING_FRAMES;

/** Total length must stay inside the 18-28 s short-video sweet spot. */
export const HIT_MAX_TOTAL_SECONDS = 28;
export const HIT_MIN_SCENE_SECONDS = 18;

export interface HitSpec {
  /** Remotion composition id, for example `OverflowArena`. */
  readonly id: string;
  /** File-name slug, for example `overflow-arena`. */
  readonly slug: string;
  /** Frame-0 yes/no or A/B question, drawn inside the reel safe bounds. */
  readonly question: string;
  /** One rule line under the question; nothing may happen that this line does not explain. */
  readonly rule: string;
  readonly sceneFrames: number;
  /** `sceneFrames` plus the closing card. */
  readonly totalFrames: number;
  readonly description: string;
}

export interface HitAudio {
  readonly buffer: StereoBuffer;
  /** 48 kHz stereo PCM16 WAV, built from `Uint8Array` and `DataView` only (no Node `Buffer`). */
  readonly wav: Uint8Array;
}

export interface HitComposition<Trace = unknown> {
  readonly spec: HitSpec;
  /** `stub` is a placeholder that only satisfies the structural contract; `ready` must pass every check. Default `ready`. */
  readonly status?: "stub" | "ready";
  /** Deterministic: the same seed must give the same trace on every run and machine. */
  simulate(seed?: number): Trace;
  /** Short stable hash of the trace, used to prove determinism. */
  digest(trace: Trace): string;
  /** Offline stereo synthesis, mastered to about -14 LUFS and at most -1.5 dBTP. */
  buildAudio(trace: Trace): HitAudio;
  /**
   * Paint one full 1080x1920 frame (the scene part only; the closing card is a React component).
   * Returns every text box it drew; each one must sit inside `REEL_SAFE_BOUNDS`.
   */
  paint(ctx: CanvasRenderingContext2D, trace: Trace, frame: number): ReelBox[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyHitComposition = HitComposition<any>;

export function makeHitSpec(input: {
  id: string;
  slug: string;
  question: string;
  rule: string;
  sceneSeconds: number;
  description: string;
}): HitSpec {
  const sceneFrames = Math.round(input.sceneSeconds * VIDEO.fps);
  return {
    id: input.id,
    slug: input.slug,
    question: input.question,
    rule: input.rule,
    sceneFrames,
    totalFrames: sceneFrames + HIT_CLOSING_FRAMES,
    description: input.description,
  };
}
