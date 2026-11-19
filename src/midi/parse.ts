import type { MidiNote, MidiTempoChange, MidiTrackInfo, ParsedMidi } from "./types.ts";

/**
 * Standard MIDI File (SMF) reader for format 0 and format 1 files.
 *
 * Handles running status, variable-length delta times, tempo changes anywhere in the file (the tempo map
 * is merged across tracks), note-on with velocity 0 as note-off, unmatched note-ons (closed at the end of
 * their track), unknown chunks and meta/sysex events. SMPTE time division is supported too.
 * Only Uint8Array/DataView are used, so the parser runs unchanged in Node and in the browser.
 */

const DEFAULT_TEMPO = 500000; // 120 BPM, the SMF default until a tempo meta event says otherwise

interface RawNoteEvent { tick: number; on: boolean; channel: number; pitch: number; velocity: number; bendCents: number }

interface RawTrack {
  index: number;
  name: string;
  programs: number[];
  channelPrograms: Record<number, number>;
  notes: RawNoteEvent[];
  endTick: number;
}

class Reader {
  pos: number;
  constructor(readonly data: Uint8Array, pos: number, readonly end: number) { this.pos = pos; }
  u8(): number {
    if (this.pos >= this.end) throw new RangeError("Unexpected end of MIDI data at byte " + this.pos);
    return this.data[this.pos++];
  }
  vlq(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.u8();
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new RangeError("Variable-length quantity longer than four bytes at byte " + this.pos);
  }
  skip(count: number): void {
    if (count < 0 || this.pos + count > this.end) throw new RangeError("MIDI event runs past the end of its chunk at byte " + this.pos);
    this.pos += count;
  }
  get done(): boolean { return this.pos >= this.end; }
}

function ascii(data: Uint8Array, from: number, to: number): string {
  let text = "";
  for (let i = from; i < to; i++) text += String.fromCharCode(data[i]);
  return text;
}

function decodeText(data: Uint8Array, from: number, length: number): string {
  // Track names are 7-bit ASCII in practice; fall back to Latin-1 for anything else.
  return ascii(data, from, from + length).replace(/\0+$/, "").trim();
}

function parseTrack(
  data: Uint8Array, from: number, to: number, index: number, tempos: { tick: number; mpq: number }[],
  meter: { numerator: number; denominator: number; found: boolean },
): RawTrack {
  const reader = new Reader(data, from, to);
  const track: RawTrack = { index, name: "", programs: [], channelPrograms: {}, notes: [], endTick: 0 };
  const channelBendCents = new Float64Array(16);
  let tick = 0;
  let running = 0;
  while (!reader.done) {
    tick += reader.vlq();
    let status = reader.u8();
    if (status < 0x80) {
      if (!running) throw new RangeError("MIDI data byte without running status at byte " + (reader.pos - 1));
      reader.pos--; // the byte we read is the first data byte of the running-status message
      status = running;
    } else if (status < 0xf0) {
      running = status;
    }
    if (status === 0xff) {
      running = 0;
      const type = reader.u8();
      const length = reader.vlq();
      const start = reader.pos;
      reader.skip(length);
      if (type === 0x03 && !track.name) track.name = decodeText(data, start, length);
      else if (type === 0x51 && length === 3) {
        tempos.push({ tick, mpq: (data[start] << 16) | (data[start + 1] << 8) | data[start + 2] });
      } else if (type === 0x58 && length >= 2 && !meter.found) {
        meter.numerator = data[start] || 4;
        meter.denominator = 2 ** Math.min(data[start + 1], 6);
        meter.found = true;
      } else if (type === 0x2f) break;
    } else if (status === 0xf0 || status === 0xf7) {
      running = 0;
      reader.skip(reader.vlq());
    } else if (status >= 0xf1) {
      // System common/real-time bytes never appear in files; skip the known data lengths defensively.
      reader.skip(status === 0xf2 ? 2 : status === 0xf1 || status === 0xf3 ? 1 : 0);
    } else {
      const kind = status & 0xf0, channel = status & 0x0f;
      const a = reader.u8();
      if (kind === 0xc0) {
        if (!track.programs.includes(a)) track.programs.push(a);
        track.channelPrograms[channel] ??= a;
      } else if (kind === 0xd0) {
        // channel pressure: one data byte, ignored
      } else {
        const b = reader.u8();
        if (kind === 0xe0) {
          const bend14 = ((b & 0x7f) << 7) | (a & 0x7f);
          channelBendCents[channel] = Math.round(((bend14 - 8192) / 8192) * 200 * 100) / 100;
        } else if (kind === 0x90 || kind === 0x80) {
          const on = kind === 0x90 && b > 0; // note-on with velocity 0 means note-off
          track.notes.push({ tick, on, channel, pitch: a & 0x7f, velocity: on ? b & 0x7f : 0, bendCents: channelBendCents[channel] });
        }
      }
    }
  }
  track.endTick = tick;
  return track;
}

export function parseMidi(input: Uint8Array | ArrayBuffer): ParsedMidi {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (data.length < 14 || ascii(data, 0, 4) !== "MThd") throw new RangeError("Not a Standard MIDI File (missing MThd)");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerLength = view.getUint32(4);
  const format = view.getUint16(8);
  const division = view.getUint16(12);
  if (headerLength < 6) throw new RangeError("Invalid MThd length " + headerLength);
  if (format !== 0 && format !== 1) throw new RangeError("Unsupported MIDI format " + format + " (only formats 0 and 1)");
  if (division === 0) throw new RangeError("Invalid time division 0");

  const tempos: { tick: number; mpq: number }[] = [];
  const meter = { numerator: 4, denominator: 4, found: false };
  const rawTracks: RawTrack[] = [];
  let pos = 8 + headerLength;
  while (pos + 8 <= data.length) { // the header's track count is advisory; read every MTrk chunk present
    const id = ascii(data, pos, pos + 4);
    const length = view.getUint32(pos + 4);
    const bodyStart = pos + 8;
    const bodyEnd = Math.min(data.length, bodyStart + length);
    if (id === "MTrk") rawTracks.push(parseTrack(data, bodyStart, bodyEnd, rawTracks.length, tempos, meter));
    pos = bodyStart + length;
  }
  if (!rawTracks.length) throw new RangeError("MIDI file has no MTrk chunks");

  const smpte = (division & 0x8000) !== 0;
  let ticksPerQuarter = division;
  let secondsPerTick = 0;
  if (smpte) {
    const framesCode = 256 - (division >> 8);
    const fps = framesCode === 29 ? 30000 / 1001 : framesCode;
    const ticksPerFrame = division & 0xff;
    if (!(fps > 0) || ticksPerFrame === 0) throw new RangeError("Invalid SMPTE time division");
    secondsPerTick = 1 / (fps * ticksPerFrame);
    ticksPerQuarter = Math.round(0.5 / secondsPerTick); // equivalent quarter at the default 120 BPM
  }

  // Tempo map: sorted by tick, last event wins on a tie, default tempo until the first event.
  tempos.sort((a, b) => a.tick - b.tick);
  const merged: { tick: number; mpq: number }[] = [];
  for (const tempo of tempos) {
    if (merged.length && merged[merged.length - 1].tick === tempo.tick) merged[merged.length - 1] = tempo;
    else merged.push(tempo);
  }
  if (!merged.length || merged[0].tick > 0) merged.unshift({ tick: 0, mpq: DEFAULT_TEMPO });
  const tempoMap: MidiTempoChange[] = [];
  let elapsed = 0;
  for (let i = 0; i < merged.length; i++) {
    if (i > 0) {
      const prev = merged[i - 1];
      elapsed += smpte ? (merged[i].tick - prev.tick) * secondsPerTick
        : (merged[i].tick - prev.tick) * prev.mpq / (1e6 * division);
    }
    tempoMap.push({ tick: merged[i].tick, timeSec: elapsed, microsecondsPerQuarter: merged[i].mpq });
  }
  const tickToSec = (tick: number): number => {
    if (smpte) return tick * secondsPerTick;
    let lo = 0, hi = tempoMap.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tempoMap[mid].tick <= tick) lo = mid; else hi = mid - 1;
    }
    const change = tempoMap[lo];
    return change.timeSec + (tick - change.tick) * change.microsecondsPerQuarter / (1e6 * division);
  };

  const notes: MidiNote[] = [];
  const tracks: MidiTrackInfo[] = [];
  for (const raw of rawTracks) {
    const open = new Map<number, { tick: number; velocity: number; bendCents: number }[]>();
    const channels: number[] = [];
    let noteCount = 0;
    const emit = (onTick: number, offTick: number, channel: number, pitch: number, velocity: number, bendCents: number) => {
      const start = tickToSec(onTick);
      const item: MidiNote = { timeSec: start, durationSec: Math.max(0, tickToSec(offTick) - start), pitch, velocity, track: raw.index, channel };
      if (Math.abs(bendCents) > 0.05) item.pitchBendCents = bendCents;
      notes.push(item);
      noteCount++;
      if (!channels.includes(channel)) channels.push(channel);
    };
    for (const event of raw.notes) {
      const key = event.channel * 128 + event.pitch;
      if (event.on) {
        const queue = open.get(key);
        if (queue) queue.push({ tick: event.tick, velocity: event.velocity, bendCents: event.bendCents });
        else open.set(key, [{ tick: event.tick, velocity: event.velocity, bendCents: event.bendCents }]);
      } else {
        const started = open.get(key)?.shift(); // FIFO: the earliest sounding note of this pitch ends first
        if (started) emit(started.tick, event.tick, event.channel, event.pitch, started.velocity, started.bendCents);
      }
    }
    for (const [key, queue] of open) for (const started of queue) emit(started.tick, raw.endTick, key >> 7, key & 127, started.velocity, started.bendCents);
    tracks.push({
      index: raw.index, name: raw.name, programs: raw.programs, channels: channels.sort((a, b) => a - b),
      channelPrograms: raw.channelPrograms, noteCount,
    });
  }
  notes.sort((a, b) => a.timeSec - b.timeSec || a.pitch - b.pitch || a.track - b.track || a.channel - b.channel);
  let durationSec = 0;
  for (const note of notes) durationSec = Math.max(durationSec, note.timeSec + note.durationSec);
  return {
    format: format as 0 | 1, ticksPerQuarter, tempoMap, timeSignature: { numerator: meter.numerator, denominator: meter.denominator },
    tracks, notes, durationSec,
  };
}
