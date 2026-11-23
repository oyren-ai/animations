// Timing map for AnimationsRepoShowcase. Every cut, caption and remix step is derived from the
// measured voice clips (voice.generated.ts), so picture and voice cannot drift. Pure and browser-safe.
import {
  SCENE_PLAN,
  SHOWCASE_LINES,
  type ScenePlanEntry,
  type ShowcaseLine,
  type ShowcaseLineId,
  type ShowcaseSceneId,
} from "./script.ts";
import { SHOWCASE_VOICE_DATA } from "./voice.generated.ts";

export const SHOWCASE_FPS = 60;

export const TIMING_RULES = {
  leadInSec: 0.3,
  gapSec: 0.2,
  endCardPauseSec: 0.12,
  endVoiceDelaySec: 0.35,
  endHoldSec: 1.2,
  cutLeadFrames: 3,
  cueLeadFrames: 3,
  cueTailFrames: 9,
  commandLeadFrames: 12,
  commandTypingFrames: 36,
} as const;

export interface TimedWord {
  readonly text: string;
  readonly charStart: number;
  readonly startFrame: number;
  readonly endFrame: number;
}

export interface LineTiming {
  readonly id: ShowcaseLineId;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly words: readonly TimedWord[];
}

export interface BeatWindow {
  readonly id: ShowcaseLineId;
  readonly fromFrame: number;
  readonly toFrame: number;
}

export interface CaptionCue {
  readonly lineId: ShowcaseLineId;
  readonly text: string;
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly words: readonly { readonly text: string; readonly startFrame: number; readonly endFrame: number }[];
}

export interface SceneSegment {
  readonly beat: ShowcaseLineId;
  readonly scene: ShowcaseSceneId;
  readonly variant: string | null;
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly sceneStartFrame: number;
  readonly speed: number;
  readonly scale: number;
  readonly offsetY: number;
}

export interface ShowcaseTiming {
  readonly fps: number;
  readonly totalFrames: number;
  readonly lines: readonly LineTiming[];
  readonly beats: readonly BeatWindow[];
  readonly cues: readonly CaptionCue[];
  readonly segments: readonly SceneSegment[];
  readonly remix: {
    readonly editFrame: number;
    readonly commandFrame: number;
    readonly progressFrame: number;
    readonly doneFrame: number;
  };
  readonly endCard: { readonly fromFrame: number };
}

const toFrame = (seconds: number) => Math.round(seconds * SHOWCASE_FPS);
const bareWord = (text: string) => text.replace(/\W+$/, "");

export function buildShowcaseTiming(
  voice = SHOWCASE_VOICE_DATA,
  script: readonly ShowcaseLine[] = SHOWCASE_LINES,
  plan: readonly ScenePlanEntry[] = SCENE_PLAN,
): ShowcaseTiming {
  const rules = TIMING_RULES;
  const last = script.length - 1;
  const starts: number[] = [];
  const ends: number[] = [];
  const lines: LineTiming[] = script.map((line, index) => {
    const clip = voice.lines[index];
    if (!clip || clip.id !== line.id) throw new Error(`voice clip ${index} does not match script line ${line.id}`);
    const startSec =
      index === 0
        ? rules.leadInSec
        : index === last
          ? ends[index - 1] + rules.endCardPauseSec + rules.endVoiceDelaySec
          : ends[index - 1] + rules.gapSec;
    const endSec = startSec + clip.durationMs / 1000;
    starts.push(startSec);
    ends.push(endSec);
    return {
      id: line.id,
      startFrame: toFrame(startSec),
      endFrame: toFrame(endSec),
      words: clip.words.map((word) => ({
        text: word.text,
        charStart: word.charStart,
        startFrame: toFrame(startSec + word.startMs / 1000),
        endFrame: toFrame(startSec + word.endMs / 1000),
      })),
    };
  });

  const totalFrames = Math.ceil((ends[last] + rules.endHoldSec) * SHOWCASE_FPS);
  const cutAfter = (index: number) =>
    index + 1 === last ? toFrame(ends[index] + rules.endCardPauseSec) : toFrame((ends[index] + starts[index + 1]) / 2);
  const beats: BeatWindow[] = script.map((line, index) => ({
    id: line.id,
    fromFrame: index === 0 ? 0 : cutAfter(index - 1),
    toFrame: index === last ? totalFrames : cutAfter(index),
  }));

  const cues: CaptionCue[] = [];
  for (const [lineIndex, line] of script.entries()) {
    const timed = lines[lineIndex];
    let cursor = 0;
    const lineCues: CaptionCue[] = [];
    for (const phrase of line.phrases) {
      const charStart = line.text.indexOf(phrase, cursor);
      if (charStart < 0) throw new Error(`${line.id}: phrase "${phrase}" is not in the spoken text`);
      cursor = charStart + phrase.length;
      const words = timed.words.filter((word) => word.charStart >= charStart && word.charStart < cursor);
      if (words.length === 0) throw new Error(`${line.id}: no word marks for phrase "${phrase}"`);
      lineCues.push({
        lineId: line.id,
        text: phrase,
        fromFrame: Math.max(0, words[0].startFrame - rules.cueLeadFrames),
        toFrame: 0,
        words: words.map((word) => ({ text: word.text, startFrame: word.startFrame, endFrame: word.endFrame })),
      });
    }
    for (const [index, cue] of lineCues.entries()) {
      const next = lineCues[index + 1];
      cues.push({ ...cue, toFrame: next ? next.fromFrame : timed.endFrame + rules.cueTailFrames });
    }
  }

  const planFrom = plan.map((entry) => {
    const beat = beats.find((candidate) => candidate.id === entry.line);
    if (!beat) throw new Error(`scene plan names unknown line ${entry.line}`);
    if (entry.atWord === null) return beat.fromFrame;
    const timed = lines.find((candidate) => candidate.id === entry.line);
    const word = timed?.words.find((candidate) => bareWord(candidate.text) === entry.atWord);
    if (!word) throw new Error(`scene plan word "${entry.atWord}" has no mark in ${entry.line}`);
    return word.startFrame - rules.cutLeadFrames;
  });
  const segments: SceneSegment[] = plan.map((entry, index) => {
    const beat = beats.find((candidate) => candidate.id === entry.line)!;
    const nextInBeat = plan.findIndex((other, otherIndex) => otherIndex > index && other.line === entry.line);
    return {
      beat: entry.line,
      scene: entry.scene,
      variant: entry.variant,
      fromFrame: planFrom[index],
      toFrame: nextInBeat >= 0 ? planFrom[nextInBeat] : beat.toFrame,
      sceneStartFrame: entry.sceneStartFrame,
      speed: entry.speed,
      scale: entry.scale,
      offsetY: entry.offsetY,
    };
  });

  const remixLine = lines[lines.findIndex((candidate) => candidate.id === "l4")];
  const remixWord = (word: string) => {
    const found = remixLine.words.find((candidate) => bareWord(candidate.text) === word);
    if (!found) throw new Error(`remix beat needs the word "${word}"`);
    return found.startFrame;
  };
  const commandFrame = remixWord("render") - rules.commandLeadFrames;

  return {
    fps: SHOWCASE_FPS,
    totalFrames,
    lines,
    beats,
    cues,
    segments,
    remix: {
      editFrame: remixWord("change"),
      commandFrame,
      progressFrame: commandFrame + rules.commandTypingFrames,
      doneFrame: remixWord("local"),
    },
    endCard: { fromFrame: beats[last].fromFrame },
  };
}

export const SHOWCASE_TIMING: ShowcaseTiming = buildShowcaseTiming();
export const SHOWCASE_TOTAL_FRAMES = SHOWCASE_TIMING.totalFrames;

export function beatAtFrame(timing: ShowcaseTiming, frame: number): BeatWindow {
  return (
    timing.beats.find((beat) => frame >= beat.fromFrame && frame < beat.toFrame) ??
    (frame < 0 ? timing.beats[0] : timing.beats[timing.beats.length - 1])
  );
}

export function cueAtFrame(timing: ShowcaseTiming, frame: number): CaptionCue | null {
  return timing.cues.find((cue) => frame >= cue.fromFrame && frame < cue.toFrame) ?? null;
}

export function segmentAtFrame(timing: ShowcaseTiming, frame: number): SceneSegment | null {
  return timing.segments.find((segment) => frame >= segment.fromFrame && frame < segment.toFrame) ?? null;
}
