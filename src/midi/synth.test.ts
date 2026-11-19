import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNTH_SAMPLE_RATE,
  encodeWavPcm16,
  instrumentForProgram,
  renderKarplusStrong,
  renderNotes,
  synthesizeMidiToWav,
  type Instrument,
  type StereoAudio,
} from "./synth.ts";
import type { MidiNote, ParsedMidi } from "./types.ts";

const SR = SYNTH_SAMPLE_RATE;
const INSTRUMENTS: Instrument[] = ["piano", "bell", "marimba", "kalimba", "strings", "musicbox", "tar", "bass"];

function note(pitch: number, timeSec = 0.1, durationSec = 1.5, velocity = 100, track = 0, channel = 0): MidiNote {
  return { timeSec, durationSec, pitch, velocity, track, channel };
}

/** Renders one note on one instrument with the global level automation switched off so levels stay comparable. */
function renderSingle(instrument: Instrument, midiNote: MidiNote, extra: Parameters<typeof renderNotes>[1] = {}): StereoAudio {
  return renderNotes([midiNote], { instruments: { [midiNote.track]: instrument }, reverb: 0, maxGain: 1, tailSec: 1.5, ...extra });
}

function hz(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

function cents(measured: number, expected: number): number {
  return 1200 * Math.log2(measured / expected);
}

// ---------- small DSP helpers (test only) ----------

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/** Hann-windowed magnitude spectrum of x[start, start + size), zero-padded to size * pad (bins 0..N/2). */
function magnitudeSpectrum(x: ArrayLike<number>, start: number, size: number, pad = 4): Float64Array {
  const n = size * pad;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < size; i++) re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  fftInPlace(re, im);
  const mags = new Float64Array(n / 2 + 1);
  for (let k = 0; k < mags.length; k++) mags[k] = Math.hypot(re[k], im[k]);
  return mags;
}

/** Strongest peak within a band, refined by parabolic interpolation on the log magnitude. */
function peakInBand(mags: Float64Array, binHz: number, loHz: number, hiHz: number): { hz: number; mag: number } {
  let best = Math.max(1, Math.floor(loHz / binHz));
  const end = Math.min(mags.length - 2, Math.ceil(hiHz / binHz));
  for (let k = best; k <= end; k++) if (mags[k] > mags[best]) best = k;
  const a = Math.log(mags[best - 1] + 1e-30);
  const b = Math.log(mags[best] + 1e-30);
  const c = Math.log(mags[best + 1] + 1e-30);
  const denominator = a - 2 * b + c;
  const delta = denominator === 0 ? 0 : (0.5 * (a - c)) / denominator;
  return { hz: (best + delta) * binHz, mag: mags[best] };
}

/** Fundamental estimate near `expected` (within a semitone), plus the strongest peak anywhere above 40 Hz. */
function analysePitch(x: ArrayLike<number>, startSec: number, expected: number, window = 32768): { f0: number; f0Mag: number; globalHz: number; globalMag: number } {
  const mags = magnitudeSpectrum(x, Math.round(startSec * SR), window, 4);
  const binHz = SR / (window * 4);
  const near = peakInBand(mags, binHz, expected * 2 ** (-1 / 12), expected * 2 ** (1 / 12));
  const global = peakInBand(mags, binHz, 40, SR / 2 - 2 * binHz);
  return { f0: near.hz, f0Mag: near.mag, globalHz: global.hz, globalMag: global.mag };
}

function spectralCentroid(x: ArrayLike<number>, startSec: number, size = 2048): number {
  const mags = magnitudeSpectrum(x, Math.round(startSec * SR), size, 2);
  const binHz = SR / (size * 2);
  let weighted = 0;
  let total = 0;
  for (let k = 1; k < mags.length; k++) {
    const power = mags[k] * mags[k];
    weighted += power * k * binHz;
    total += power;
  }
  return weighted / total;
}

function peakAbs(x: ArrayLike<number>, from = 0, to = x.length): number {
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(x[i]));
  return peak;
}

function rms(x: ArrayLike<number>, from = 0, to = x.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** First sample (as seconds) where the 1 ms rectified moving average passes 10% of its own peak within 60 ms. */
function detectOnsetSec(x: ArrayLike<number>, approxSec: number): number {
  const window = Math.round(0.001 * SR);
  const from = Math.max(window, Math.round((approxSec - 0.02) * SR));
  const to = Math.round((approxSec + 0.06) * SR);
  const envelope = new Float64Array(to - from);
  let sum = 0;
  for (let i = from - window; i < from; i++) sum += Math.abs(x[i]);
  for (let i = from; i < to; i++) {
    sum += Math.abs(x[i]) - Math.abs(x[i - window]);
    envelope[i - from] = sum / window;
  }
  const peak = Math.max(...envelope);
  const first = envelope.findIndex((value) => value > 0.1 * peak);
  return (from + first) / SR;
}

// ---------- tests ----------

test("dense polyphony of all four voices is finite, audible and stays under the ceiling, also after PCM16 quantisation", () => {
  const notes: MidiNote[] = [];
  for (let i = 0; i < 40; i++) notes.push(note(36 + ((i * 7) % 60), 0.2, 1.2, 127, i % 4));
  const options = { instruments: { 0: "piano", 1: "bell", 2: "marimba", 3: "kalimba" } as Record<number, Instrument> };
  const audio = renderNotes(notes, options);
  for (const channel of [audio.left, audio.right]) {
    for (let i = 0; i < channel.length; i++) assert.ok(Number.isFinite(channel[i]), `non-finite sample at ${i}`);
    assert.ok(rms(channel) > 0.02, `rms ${rms(channel)}`);
    assert.ok(peakAbs(channel) < 0.95, `peak ${peakAbs(channel)}`);
    assert.ok(peakAbs(channel) <= 0.84 + 1e-6, "float peak must respect the ceiling");
  }
  const wav = encodeWavPcm16(audio);
  let maxInt = 0;
  for (let offset = 44; offset < wav.length; offset += 2) maxInt = Math.max(maxInt, Math.abs(wav.readInt16LE(offset)));
  assert.ok(maxInt / 32768 < 0.95, `quantised peak ${maxInt / 32768}`);
  assert.ok(maxInt / 32767 <= 0.84 + 1e-6, "quantised peak must respect the ceiling");
  assert.ok(maxInt / 32767 > 0.6, "loud passages should be normalised near the target, not left tiny");
  // A tighter custom ceiling is honoured too.
  assert.ok(peakAbs(renderNotes(notes, { ...options, ceiling: 0.5 }).left) <= 0.5 + 1e-6);
});

test("rendering is deterministic: identical WAV bytes across runs and across note array copies", () => {
  const notes: MidiNote[] = [];
  for (let i = 0; i < 24; i++) notes.push(note(48 + ((i * 5) % 30), 0.1 + i * 0.137, 0.3 + (i % 3) * 0.2, 50 + ((i * 11) % 70), i % 4));
  notes.push(note(38, 0.5, 0.1, 100, 4, 9));
  const options = { instruments: { 0: "piano", 1: "bell", 2: "marimba", 3: "kalimba" } as Record<number, Instrument> };
  const a = encodeWavPcm16(renderNotes(notes, options));
  const b = encodeWavPcm16(renderNotes(notes.map((n) => ({ ...n })), options));
  assert.ok(a.equals(b));
  assert.ok(a.length > 44);
});

test("pitch accuracy: A4, C3 and C6 are within 5 cents (piano) and 10 cents (bell, marimba, kalimba, strings, musicbox)", () => {
  const cases: Array<[Instrument, number]> = [
    ["piano", 5],
    ["marimba", 10],
    ["kalimba", 10],
    ["bell", 10],
    ["strings", 10],
    ["musicbox", 10],
    ["tar", 10],
    ["bass", 10],
  ];
  for (const [instrument, tolerance] of cases) {
    for (const pitch of [69, 48, 84]) {
      const audio = renderSingle(instrument, note(pitch, 0.1, 1.5), { tailSec: 1.5 });
      const found = analysePitch(audio.left, 0.15, hz(pitch));
      const error = cents(found.f0, hz(pitch));
      assert.ok(Math.abs(error) <= tolerance, `${instrument} pitch ${pitch}: ${found.f0.toFixed(2)} Hz is ${error.toFixed(2)} cents off`);
      // The fundamental must be audible, not just present: within 12 dB of the strongest peak.
      assert.ok(found.f0Mag >= found.globalMag * 10 ** (-12 / 20), `${instrument} ${pitch}: fundamental too weak`);
      if (instrument === "bell") {
        // While the modulation index is high (first ~0.4 s) the 2.5 f FM sideband can out-shine the carrier, as in any
        // Chowning bell. Once the index has decayed the long-term dominant spectral peak must be the carrier.
        const late = analysePitch(audio.left, 0.7, hz(pitch), 16384);
        assert.ok(Math.abs(cents(late.globalHz, hz(pitch))) <= 10, `bell ${pitch}: dominant peak at ${late.globalHz.toFixed(1)} Hz`);
      }
    }
  }
});

test("the Karplus-Strong string is tuned to a fraction of a cent across the range (fractional delay with loop-filter compensation)", () => {
  for (const pitch of [24, 36, 48, 57, 69, 77, 84, 96, 100]) {
    const x = renderKarplusStrong(hz(pitch), 1.4, { t60: 3 });
    const found = analysePitch(x, 0.05, hz(pitch), 32768);
    assert.ok(Math.abs(cents(found.f0, hz(pitch))) < 1, `pitch ${pitch}: ${cents(found.f0, hz(pitch)).toFixed(3)} cents`);
  }
});

test("onsets are sample accurate: the audible onset is within 5 ms of every note time, for every voice", () => {
  for (const instrument of INSTRUMENTS) {
    for (const [timeSec, pitch] of [[0.5, 60], [1.2345, 48], [2.0, 36], [0.7777, 84]] as const) {
      const audio = renderSingle(instrument, note(pitch, timeSec, 0.4, 90), { totalSec: timeSec + 1 });
      const onset = detectOnsetSec(audio.left, timeSec);
      const errorMs = (onset - timeSec) * 1000;
      assert.ok(errorMs >= -0.5 && errorMs <= 5, `${instrument} pitch ${pitch} at ${timeSec}: onset error ${errorMs.toFixed(2)} ms`);
      // Nothing may sound before the note: the leading samples are exactly silent up to the start sample.
      const startSample = Math.round(timeSec * SR);
      assert.equal(peakAbs(audio.left, 0, startSample), 0);
      assert.equal(peakAbs(audio.right, 0, startSample), 0);
      assert.ok(peakAbs(audio.left, startSample, startSample + Math.round(0.001 * SR)) + peakAbs(audio.right, startSample, startSample + Math.round(0.001 * SR)) > 0);
    }
  }
});

test("velocity changes both level and brightness for every voice", () => {
  for (const instrument of INSTRUMENTS) {
    const soft = renderSingle(instrument, note(69, 0.1, 1, 30));
    const loud = renderSingle(instrument, note(69, 0.1, 1, 120));
    assert.ok(peakAbs(loud.left) > 2.5 * peakAbs(soft.left), `${instrument}: peak ${peakAbs(soft.left)} vs ${peakAbs(loud.left)}`);
    // 43 ms right after the onset (a long Hann window would weight the attack, where the brightness lives, to zero).
    const softCentroid = spectralCentroid(soft.left, 0.1);
    const loudCentroid = spectralCentroid(loud.left, 0.1);
    assert.ok(loudCentroid > softCentroid * 1.05, `${instrument}: centroid ${softCentroid.toFixed(0)} Hz vs ${loudCentroid.toFixed(0)} Hz`);
  }
});

test("pitch pans slightly: very low notes lean left, very high notes lean right, within +/-0.35", () => {
  for (const instrument of INSTRUMENTS) {
    const low = renderSingle(instrument, note(24, 0.1, 1, 100));
    const high = renderSingle(instrument, note(105, 0.1, 1, 100));
    const balance = (audio: StereoAudio): number => {
      const l = rms(audio.left);
      const r = rms(audio.right);
      return (r - l) / (r + l);
    };
    assert.ok(balance(low) < -0.1 && balance(low) > -0.35, `${instrument} low balance ${balance(low)}`);
    assert.ok(balance(high) > 0.1 && balance(high) < 0.35, `${instrument} high balance ${balance(high)}`);
  }
  // With the default reverb (decorrelated and centred) the lean survives, just a little weaker.
  const lowWet = renderNotes([note(24, 0.1, 1, 100)], { maxGain: 1 });
  const highWet = renderNotes([note(105, 0.1, 1, 100)], { maxGain: 1 });
  assert.ok(rms(lowWet.left) > rms(lowWet.right));
  assert.ok(rms(highWet.right) > rms(highWet.left));
});

test("WAV header and sizes are correct, and totalSec fixes the length exactly", () => {
  const notes = [note(60, 0.2, 0.5), note(64, 0.4, 0.5), note(67, 0.6, 0.5)];
  for (const totalSec of [2, 3.3217, 0.9]) {
    const audio = renderNotes(notes, { totalSec });
    const frames = Math.round(totalSec * SR);
    assert.equal(audio.left.length, frames);
    assert.equal(audio.right.length, frames);
    assert.equal(audio.sampleRate, SR);
    const wav = encodeWavPcm16(audio);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.toString("ascii", 12, 16), "fmt ");
    assert.equal(wav.readUInt32LE(16), 16);
    assert.equal(wav.readUInt16LE(20), 1); // PCM
    assert.equal(wav.readUInt16LE(22), 2); // stereo
    assert.equal(wav.readUInt32LE(24), SR);
    assert.equal(wav.readUInt32LE(28), SR * 4);
    assert.equal(wav.readUInt16LE(32), 4);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.toString("ascii", 36, 40), "data");
    assert.equal(wav.readUInt32LE(40), frames * 4);
    assert.equal(wav.readUInt32LE(4), wav.length - 8);
    assert.equal(wav.length, 44 + frames * 4);
  }
  // Default length is last note end plus the tail (3 s unless told otherwise).
  assert.equal(renderNotes(notes).left.length, Math.round((1.1 + 3) * SR));
  assert.equal(renderNotes(notes, { tailSec: 1 }).left.length, Math.round(2.1 * SR));
  // A non-default sample rate is carried through to the header.
  const wav44 = encodeWavPcm16(renderNotes(notes, { sampleRate: 44100, totalSec: 1.5 }));
  assert.equal(wav44.readUInt32LE(24), 44100);
  assert.equal(wav44.readUInt32LE(40), Math.round(1.5 * 44100) * 4);
  assert.throws(() => encodeWavPcm16({ left: new Float32Array(3), right: new Float32Array(2), sampleRate: SR }), RangeError);
});

test("empty, degenerate and invalid notes never throw and never produce NaN", () => {
  const empty = renderNotes([], { totalSec: 2 });
  assert.equal(empty.left.length, 2 * SR);
  assert.equal(peakAbs(empty.left) + peakAbs(empty.right), 0);
  assert.equal(renderNotes([]).left.length, 3 * SR);
  assert.equal(encodeWavPcm16(renderNotes([], { totalSec: 0 })).length, 44);
  assert.equal(renderNotes([note(60, 5, 1)], { totalSec: 1 }).left.length, SR); // note past the end is dropped, not an error

  const junk: MidiNote[] = [
    note(Number.NaN), note(60, Number.NaN), note(60, 0.1, Number.NaN), note(60, 0.1, 0.5, Number.NaN),
    note(60, Number.POSITIVE_INFINITY), note(200, 0.2, 0.5, 300), note(-5, 0.3, 0.5, 0), note(60, -0.5, 0.2, 100),
  ];
  const audio = renderNotes(junk, { totalSec: 2 });
  for (const channel of [audio.left, audio.right]) for (let i = 0; i < channel.length; i++) assert.ok(Number.isFinite(channel[i]));
  // totalSec shorter than the notes truncates cleanly: the last samples fade to (near) zero instead of clicking.
  const cut = renderNotes([note(60, 0.1, 5, 127)], { instruments: { 0: "bell" }, totalSec: 0.5 });
  assert.equal(cut.left.length, Math.round(0.5 * SR));
  assert.ok(Math.abs(cut.left[cut.left.length - 1]) < 1e-3);
  assert.ok(peakAbs(cut.left) > 0.1);
});

test("zero-length and tiny notes still sound, on every voice and on percussion, with no long internal gap", () => {
  const checks: Array<[string, MidiNote, Instrument]> = [];
  for (const instrument of INSTRUMENTS) {
    for (const durationSec of [0, 0.001, 0.01]) checks.push([`${instrument} dur ${durationSec}`, note(64, 0.1, durationSec, 100), instrument]);
  }
  for (const drum of [36, 38, 39, 40, 42, 46, 49, 45, 56]) checks.push([`drum ${drum}`, note(drum, 0.1, 0, 100, 0, 9), "piano"]);
  for (const [label, midiNote, instrument] of checks) {
    const audio = renderSingle(instrument, midiNote, { tailSec: 1 });
    const peak = peakAbs(audio.left) + peakAbs(audio.right);
    assert.ok(peak > 0.05, `${label}: peak ${peak}`);
    for (const channel of [audio.left, audio.right]) for (let i = 0; i < channel.length; i++) assert.ok(Number.isFinite(channel[i]), label);
    // The sound lasts: 10 ms RMS windows over the first 80 ms after the onset stay well above silence.
    const start = Math.round(0.1 * SR);
    const loudest = peakAbs(audio.left, start, start + Math.round(0.08 * SR));
    for (let window = 0; window < 8; window++) {
      const from = start + Math.round(window * 0.01 * SR);
      if (window === 0 && midiNote.channel === 9) continue; // the very first 10 ms of a hat can be mostly attack ramp
      const level = rms(audio.left, from, from + Math.round(0.01 * SR));
      assert.ok(level > 0.005 * loudest, `${label}: silent window ${window} (${level} vs ${loudest})`);
    }
  }
});

test("the reverb adds a decorrelated tail after the notes and reverb 0 adds none", () => {
  const dry = renderNotes([note(72, 0.1, 0.3, 110)], { instruments: { 0: "marimba" }, reverb: 0, maxGain: 1, totalSec: 3 });
  const wet = renderNotes([note(72, 0.1, 0.3, 110)], { instruments: { 0: "marimba" }, reverb: 0.4, maxGain: 1, totalSec: 3 });
  const from = Math.round(1.0 * SR);
  const to = Math.round(2.0 * SR);
  assert.ok(rms(dry.left, from, to) + rms(dry.right, from, to) < 1e-9, "the marimba has stopped by 1 s, so a dry render is silent there");
  assert.ok(rms(wet.left, from, to) > 1e-4 && rms(wet.right, from, to) > 1e-4, "the reverb tail should still be audible at 1-2 s");
  let identical = true;
  for (let i = from; i < to; i += 97) if (Math.abs(wet.left[i] - wet.right[i]) > 1e-9) identical = false;
  assert.equal(identical, false, "left and right tails must be decorrelated");
  // Decaying, roughly RT60 of 1.5-2 s: the tail at 2.5-3 s is much weaker than at 1-1.5 s.
  assert.ok(rms(wet.left, Math.round(2.5 * SR), Math.round(3 * SR)) < 0.5 * rms(wet.left, from, Math.round(1.5 * SR)));
});

test("the output has no DC offset and the General MIDI program map picks the right voice", () => {
  const notes: MidiNote[] = [];
  for (let i = 0; i < 30; i++) notes.push(note(30 + ((i * 11) % 64), 0.1 + i * 0.09, 0.5, 70 + (i % 5) * 10, i % 4));
  for (const instrument of INSTRUMENTS) {
    const audio = renderNotes(notes.map((n) => ({ ...n, track: 0 })), { instruments: { 0: instrument } });
    for (const channel of [audio.left, audio.right]) {
      let sum = 0;
      for (let i = 0; i < channel.length; i++) sum += channel[i];
      assert.ok(Math.abs(sum / channel.length) < 2e-4, `${instrument} dc ${sum / channel.length}`);
    }
  }
  const expected: Array<[number, Instrument]> = [
    [0, "piano"], [1, "piano"], [7, "piano"], [24, "piano"], [127, "piano"],
    [8, "bell"], [9, "bell"], [14, "bell"], [98, "bell"], [112, "bell"], [119, "bell"],
    [10, "musicbox"],
    [11, "marimba"], [12, "marimba"], [13, "marimba"],
    [25, "tar"], [26, "tar"],
    [32, "bass"], [33, "bass"],
    [40, "strings"], [41, "strings"], [42, "strings"], [48, "strings"], [49, "strings"],
    [105, "kalimba"], [106, "kalimba"], [107, "kalimba"], [108, "kalimba"],
    [15, "piano"], [45, "piano"], [97, "piano"], [99, "piano"], [104, "piano"], [109, "piano"], [111, "piano"], [120, "piano"],
  ];
  for (const [program, instrument] of expected) assert.equal(instrumentForProgram(program), instrument, `program ${program}`);
});

test("synthesizeMidiToWav maps each track's first program to a voice unless overridden", () => {
  const midi: ParsedMidi = {
    format: 1,
    ticksPerQuarter: 480,
    tempoMap: [],
    timeSignature: { numerator: 4, denominator: 4 },
    tracks: [
      { index: 0, name: "", programs: [], channels: [], noteCount: 0 },
      { index: 1, name: "marimba", programs: [12, 0], channels: [0], noteCount: 1 },
      { index: 2, name: "bells", programs: [9], channels: [1], noteCount: 1 },
    ],
    notes: [note(60, 0.1, 0.5, 100, 1, 0), note(72, 0.8, 0.5, 100, 2, 1)],
    durationSec: 1.3,
  };
  const viaMidi = synthesizeMidiToWav(midi, { totalSec: 3 });
  const manual = encodeWavPcm16(renderNotes(midi.notes, { instruments: { 1: "marimba", 2: "bell" }, totalSec: 3 }));
  assert.ok(viaMidi.equals(manual));
  const overridden = synthesizeMidiToWav(midi, { totalSec: 3, instruments: { 1: "kalimba" } });
  const manualOverride = encodeWavPcm16(renderNotes(midi.notes, { instruments: { 1: "kalimba", 2: "bell" }, totalSec: 3 }));
  assert.ok(overridden.equals(manualOverride));
  assert.ok(!overridden.equals(viaMidi));
  const programOverride = synthesizeMidiToWav(midi, { totalSec: 3, programs: { 1: 0 } });
  assert.ok(programOverride.equals(encodeWavPcm16(renderNotes(midi.notes, { instruments: { 1: "piano", 2: "bell" }, totalSec: 3 }))));
  assert.equal(viaMidi.readUInt32LE(40), 3 * SR * 4);
});

test("synthesizeMidiToWav picks the voice per channel for format 0 files (one track, several programs)", () => {
  const midi: ParsedMidi = {
    format: 0, ticksPerQuarter: 480, tempoMap: [], timeSignature: { numerator: 4, denominator: 4 },
    tracks: [{ index: 0, name: "mixed", programs: [0, 9], channels: [0, 1], channelPrograms: { 0: 0, 1: 9 }, noteCount: 2 }],
    notes: [note(60, 0.1, 0.5, 100, 0, 0), note(84, 0.8, 0.5, 100, 0, 1)], durationSec: 1.3,
  };
  const viaMidi = synthesizeMidiToWav(midi, { totalSec: 3 });
  const asChannels = encodeWavPcm16(renderNotes(midi.notes, { channelPrograms: { "0:0": 0, "0:1": 9 }, totalSec: 3 }));
  assert.ok(viaMidi.equals(asChannels));
  const allPiano = encodeWavPcm16(renderNotes(midi.notes, { instruments: { 0: "piano" }, totalSec: 3 }));
  assert.ok(!viaMidi.equals(allPiano), "the second channel is a bell, not a piano");
});

test("a 60 s, 500-note piece renders quickly", (t) => {
  const notes: MidiNote[] = [];
  for (let i = 0; i < 500; i++) notes.push(note(40 + ((i * 7) % 52), (i / 500) * 57 + (i % 7) * 0.013, 0.15 + (i % 5) * 0.2, 40 + ((i * 13) % 80), i % 4));
  const started = process.hrtime.bigint();
  const wav = encodeWavPcm16(renderNotes(notes, { instruments: { 0: "piano", 1: "bell", 2: "marimba", 3: "kalimba" } }));
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  t.diagnostic(`500 notes / ${((wav.length - 44) / 4 / SR).toFixed(1)} s of audio rendered and encoded in ${seconds.toFixed(2)} s`);
  assert.ok(seconds < 30, `took ${seconds} s`);
  assert.equal(wav.length, 44 + Math.round((notes.reduce((m, n) => Math.max(m, n.timeSec + n.durationSec), 0) + 3) * SR) * 4);
});

test("microtonal pitchBendCents shifts rendered fundamental frequency accurately", () => {
  const bent: MidiNote = { timeSec: 0.1, durationSec: 1.4, pitch: 63, velocity: 100, track: 0, channel: 0, pitchBendCents: 42 };
  const audio = renderSingle("tar", bent, { tailSec: 1.2 });
  const expectedHz = hz(63 + 0.42);
  const found = analysePitch(audio.left, 0.15, expectedHz);
  assert.ok(Math.abs(cents(found.f0, expectedHz)) <= 6, `expected +42c shift, got ${cents(found.f0, hz(63)).toFixed(2)}c`);
});
