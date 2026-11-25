import type { MidiNote, MidiTrackInfo, ParsedMidi } from "./types.ts";

/** Seconds of ring-out after the last note ends (the synthesised WAV and the video both include it). */
export const MIDI_TAIL_SEC = 2;

/**
 * Name of the synthesised WAV (inside public/) for a file in public/midi. The asset script writes it and
 * every MIDI scene plays it back from the same name, so a dropped-in .mid only needs `pnpm assets`.
 */
export function midiAudioFile(midiFile: string): string {
  const base = midiFile.replace(/^.*[\\/]/, "").replace(/\.midi?$/i, "");
  return "generated/midi-" + base.toLowerCase().replace(/[^a-z0-9._-]+/g, "-") + ".wav";
}

export interface SceneTiming {
  fps: number;
  /** Frames of lead-in before piece time 0 (the first note-on). Integer, so audio and picture share a frame grid. */
  leadFrames: number;
  tailSec: number;
}

export function sceneFrameCount(pieceEndSec: number, timing: SceneTiming): number {
  return Math.max(1, Math.ceil((timing.leadFrames / timing.fps + pieceEndSec + timing.tailSec) * timing.fps - 1e-9));
}

/** Everything a MIDI scene needs, derived once from a parsed file. Piece time 0 is the file's tick 0. */
export interface MidiSceneData {
  midiFile: string;
  title: string;
  notes: readonly MidiNote[];
  tracks: readonly MidiTrackInfo[];
  tempoMap: ParsedMidi["tempoMap"];
  timeSignature: ParsedMidi["timeSignature"];
  fps: number;
  width: number;
  height: number;
  leadFrames: number;
  leadSec: number;
  /** Piece time at which the last note ends. */
  endSec: number;
  totalFrames: number;
  pitchMin: number;
  pitchMax: number;
}

export function prettifyFileName(midiFile: string): string {
  const base = midiFile.replace(/^.*[\\/]/, "").replace(/\.midi?$/i, "").replace(/[-_]+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "MIDI";
}

export function buildSceneData(
  parsed: ParsedMidi, midiFile: string, timing: SceneTiming, size: { width: number; height: number }, title?: string,
): MidiSceneData {
  const notes = parsed.notes;
  let pitchMin = 127, pitchMax = 0;
  for (const note of notes) { pitchMin = Math.min(pitchMin, note.pitch); pitchMax = Math.max(pitchMax, note.pitch); }
  if (!notes.length) { pitchMin = 60; pitchMax = 72; }
  const sequenceName = parsed.tracks[0]?.name; // the conductor track of a format 1 file, or the only track of format 0
  return {
    midiFile,
    title: title ?? sequenceName ?? prettifyFileName(midiFile),
    notes,
    tracks: parsed.tracks,
    tempoMap: parsed.tempoMap,
    timeSignature: parsed.timeSignature,
    fps: timing.fps,
    width: size.width,
    height: size.height,
    leadFrames: timing.leadFrames,
    leadSec: timing.leadFrames / timing.fps,
    endSec: parsed.durationSec,
    totalFrames: sceneFrameCount(parsed.durationSec, timing),
    pitchMin,
    pitchMax,
  };
}

/** Piece time (seconds from the first tick of the file) at a video frame; negative during the lead-in. */
export function pieceTime(scene: MidiSceneData, frame: number): number {
  return frame / scene.fps - scene.leadSec;
}

/** Length of one bar in seconds at the first tempo of the file (6/4 at 120 BPM is 3 s). */
export function barSeconds(scene: Pick<MidiSceneData, "tempoMap" | "timeSignature">): number {
  const quarterSec = (scene.tempoMap[0]?.microsecondsPerQuarter ?? 500000) / 1e6;
  return quarterSec * scene.timeSignature.numerator * 4 / scene.timeSignature.denominator;
}
