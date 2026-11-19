import type { MidiNote } from "./types.ts";

/**
 * A small Standard MIDI File writer. Pieces are authored in beats (quarter notes), then written to
 * format 0 or format 1 files, so the repo can generate its own .mid files from note arrays.
 */

export interface MidiWriteNote {
  /** Start in quarter notes from the beginning of the piece. */
  beat: number;
  durationBeats: number;
  pitch: number;
  /** 1..127 */
  velocity: number;
  /** Optional per-note pitch-bend offset in cents (-200..+200, standard +/-2 semitone wheel range). */
  pitchBendCents?: number;
}

export interface MidiWriteTrack {
  name?: string;
  /** 0..15; defaults to the track's position, skipping the percussion channel 9. */
  channel?: number;
  /** General MIDI program 0..127 (sent once at tick 0). */
  program?: number;
  notes: readonly MidiWriteNote[];
}

export interface MidiTempo { beat: number; bpm: number }

export interface MidiWriteOptions {
  /** 1 = one conductor track plus one track per voice (default); 0 = everything merged in one track. */
  format?: 0 | 1;
  /** Pulses per quarter note, default 480. */
  ticksPerQuarter?: number;
  /** Tempo changes in beats; default 120 BPM from the start. */
  tempos?: readonly MidiTempo[];
  tracks: readonly MidiWriteTrack[];
  /** Sequence name written to the conductor track. */
  title?: string;
  timeSignature?: readonly [number, number];
  /** Omit repeated status bytes (default true, as most real files do). */
  runningStatus?: boolean;
  /** Write note-offs as note-on with velocity 0 (default false). */
  zeroVelocityNoteOff?: boolean;
}

interface RawEvent { tick: number; order: number; bytes: number[] }

const ORDER_META = 0, ORDER_PROGRAM = 1, ORDER_OFF = 2, ORDER_BEND = 3, ORDER_ON = 4;

function vlq(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff) throw new RangeError("Invalid MIDI delta time " + value);
  const bytes = [value & 0x7f];
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) bytes.unshift((rest & 0x7f) | 0x80);
  return bytes;
}

function u16(value: number): number[] { return [(value >> 8) & 0xff, value & 0xff]; }
function u32(value: number): number[] { return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]; }

function textMeta(type: number, text: string): number[] {
  const bytes = Array.from(text, (char) => char.charCodeAt(0) & 0x7f);
  return [0xff, type, ...vlq(bytes.length), ...bytes];
}

function encodeTrack(events: RawEvent[], runningStatus: boolean): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let tick = 0;
  let status = -1;
  for (const event of events) {
    body.push(...vlq(event.tick - tick));
    tick = event.tick;
    const first = event.bytes[0];
    if (first >= 0x80 && first < 0xf0) { // channel message: optionally reuse the previous status byte
      if (runningStatus && first === status) body.push(...event.bytes.slice(1));
      else body.push(...event.bytes);
      status = first;
    } else {
      body.push(...event.bytes);
      status = -1; // meta and sysex events cancel running status
    }
  }
  body.push(...vlq(0), 0xff, 0x2f, 0x00);
  return [...[0x4d, 0x54, 0x72, 0x6b], ...u32(body.length), ...body];
}

function voiceEvents(track: MidiWriteTrack, channel: number, ppq: number, zeroOff: boolean, withName: boolean): RawEvent[] {
  const events: RawEvent[] = [];
  if (withName && track.name) events.push({ tick: 0, order: ORDER_META, bytes: textMeta(0x03, track.name) });
  if (track.program !== undefined) {
    if (!Number.isInteger(track.program) || track.program < 0 || track.program > 127) throw new RangeError("Invalid program " + track.program);
    events.push({ tick: 0, order: ORDER_PROGRAM, bytes: [0xc0 | channel, track.program] });
  }
  for (const note of track.notes) {
    if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) throw new RangeError("Invalid pitch " + note.pitch);
    if (!Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127) throw new RangeError("Invalid velocity " + note.velocity);
    if (!(note.beat >= 0) || !(note.durationBeats >= 0)) throw new RangeError("Invalid note timing " + note.beat + "+" + note.durationBeats);
    const on = Math.round(note.beat * ppq);
    const off = on + Math.max(1, Math.round(note.durationBeats * ppq)); // a zero-length note would sort its off before its on
    const cents = note.pitchBendCents ?? 0;
    if (Math.abs(cents) > 0.05) {
      const clamped = Math.max(-200, Math.min(200, cents));
      const bend14 = Math.max(0, Math.min(16383, Math.round(8192 + (clamped / 200) * 8192)));
      events.push({ tick: on, order: ORDER_BEND, bytes: [0xe0 | channel, bend14 & 0x7f, (bend14 >> 7) & 0x7f] });
      events.push({ tick: off, order: ORDER_OFF, bytes: [0xe0 | channel, 0, 64] });
    }
    events.push({ tick: on, order: ORDER_ON, bytes: [0x90 | channel, note.pitch, note.velocity] });
    events.push({ tick: off, order: ORDER_OFF, bytes: zeroOff ? [0x90 | channel, note.pitch, 0] : [0x80 | channel, note.pitch, 64] });
  }
  return events;
}

export function writeMidi(options: MidiWriteOptions): Uint8Array {
  const format = options.format ?? 1;
  const ppq = options.ticksPerQuarter ?? 480;
  if (!Number.isInteger(ppq) || ppq < 1 || ppq > 0x7fff) throw new RangeError("Invalid ticksPerQuarter " + ppq);
  const runningStatus = options.runningStatus ?? true;
  const zeroOff = options.zeroVelocityNoteOff ?? false;
  const [numerator, denominator] = options.timeSignature ?? [4, 4];

  const conductor: RawEvent[] = [];
  if (options.title) conductor.push({ tick: 0, order: ORDER_META, bytes: textMeta(0x03, options.title) });
  conductor.push({
    tick: 0, order: ORDER_META,
    bytes: [0xff, 0x58, 0x04, numerator, Math.round(Math.log2(denominator)), 24, 8],
  });
  const tempos = options.tempos?.length ? [...options.tempos] : [{ beat: 0, bpm: 120 }];
  for (const tempo of tempos) {
    if (!(tempo.bpm > 0)) throw new RangeError("Invalid tempo " + tempo.bpm);
    const mpq = Math.round(60e6 / tempo.bpm);
    conductor.push({
      tick: Math.round(tempo.beat * ppq), order: ORDER_META,
      bytes: [0xff, 0x51, 0x03, (mpq >> 16) & 0xff, (mpq >> 8) & 0xff, mpq & 0xff],
    });
  }

  let nextChannel = 0;
  const channelFor = (track: MidiWriteTrack): number => {
    if (track.channel !== undefined) {
      if (!Number.isInteger(track.channel) || track.channel < 0 || track.channel > 15) throw new RangeError("Invalid channel " + track.channel);
      return track.channel;
    }
    if (nextChannel === 9) nextChannel++;
    return nextChannel++ & 15;
  };
  const voices = options.tracks.map((track) => voiceEvents(track, channelFor(track), ppq, zeroOff, format === 1));

  const chunks: number[][] = [];
  if (format === 0) chunks.push(encodeTrack([...conductor, ...voices.flat()], runningStatus));
  else {
    chunks.push(encodeTrack(conductor, runningStatus));
    for (const events of voices) chunks.push(encodeTrack(events, runningStatus));
  }
  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(format), ...u16(chunks.length), ...u16(ppq)];
  return Uint8Array.from([...header, ...chunks.flat()]);
}

/**
 * Convert seconds-based notes (such as parser output) into writer tracks at a constant tempo: one voice
 * track per distinct (track, channel) pair, ordered by track then channel.
 */
export function notesToWriteTracks(notes: readonly MidiNote[], bpm = 120): MidiWriteTrack[] {
  const beatsPerSecond = bpm / 60;
  const groups = new Map<string, { track: MidiWriteTrack; sort: number }>();
  for (const note of notes) {
    const key = note.track + ":" + note.channel;
    let group = groups.get(key);
    if (!group) {
      group = { track: { channel: note.channel, notes: [] }, sort: note.track * 16 + note.channel };
      groups.set(key, group);
    }
    (group.track.notes as MidiWriteNote[]).push({
      beat: note.timeSec * beatsPerSecond,
      durationBeats: note.durationSec * beatsPerSecond,
      pitch: note.pitch,
      velocity: note.velocity,
    });
  }
  return [...groups.values()].sort((a, b) => a.sort - b.sort).map((group) => group.track);
}
