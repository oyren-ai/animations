/** One note read from (or written to) a MIDI file. Times are absolute seconds from the start of the file. */
export interface MidiNote {
  /** Note-on time in seconds, tempo map applied. */
  timeSec: number;
  /** Note-off minus note-on in seconds (never negative; 0 only for a note off at the same tick). */
  durationSec: number;
  /** MIDI note number, 0..127 (60 is middle C). */
  pitch: number;
  /** Note-on velocity, 1..127. */
  velocity: number;
  /** Zero-based index of the MTrk chunk the note came from (a format 1 conductor track is index 0). */
  track: number;
  /** MIDI channel, 0..15 (channel 9 is General MIDI percussion). */
  channel: number;
}

export interface MidiTrackInfo {
  index: number;
  /** Sequence/track name meta event (FF 03), or "" when absent. */
  name: string;
  /** Distinct General MIDI program numbers (0..127) selected on this track, in order of first use. */
  programs: number[];
  /** Distinct channels used by notes on this track. */
  channels: number[];
  /** First program selected on each channel of this track (format 0 files mix several instruments in one track). */
  channelPrograms?: Record<number, number>;
  noteCount: number;
}

export interface MidiTempoChange {
  tick: number;
  /** Absolute time of this tempo change in seconds. */
  timeSec: number;
  microsecondsPerQuarter: number;
}

export interface ParsedMidi {
  format: 0 | 1;
  /** Pulses per quarter note (SMPTE files report ticksPerFrame * fps per second / 2, see parse.ts). */
  ticksPerQuarter: number;
  tempoMap: MidiTempoChange[];
  /** First time-signature meta event (FF 58), 4/4 when the file has none. */
  timeSignature: { numerator: number; denominator: number };
  tracks: MidiTrackInfo[];
  /** Sorted by timeSec, then pitch, then track. */
  notes: MidiNote[];
  /** Time at which the last note ends. */
  durationSec: number;
}
