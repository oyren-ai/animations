import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE_RATE, SAMPLES_PER_FRAME } from "../audio.ts";
import {
  renderConversionSound,
  renderFinishChime,
  renderSwarmLayers,
  renderTensionBed,
  scheduleConversionSounds,
  SWARM_AUDIO,
  SWARM_SOUND_KINDS,
  synthesizeSwarmWav,
  tensionCurve,
} from "./audio.ts";
import type { SwarmEvent, SwarmTrace } from "./sim.ts";
import { SWARM_DEFINITIONS, simulateSwarmDefinition } from "./themes.ts";

function readPcm(wav: Buffer): Float32Array {
  const samples = new Float32Array((wav.length - 44) / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = wav.readInt16LE(44 + i * 2) / 32767;
  return samples;
}

function rms(x: ArrayLike<number>, from = 0, to = x.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** Power at one frequency over `x[from, to)` (Goertzel). */
function tonePower(x: ArrayLike<number>, hz: number, from: number, to: number): number {
  const coeff = 2 * Math.cos((2 * Math.PI * hz) / SAMPLE_RATE);
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < to; i++) {
    const s0 = x[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (to - from) ** 2;
}

function fft(re: Float64Array, im: Float64Array) {
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
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
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

/** Spectral centroid (Hz), spread (octaves around it) and audible length (ms, down to 5 percent of the peak). */
function voiceFeatures(x: Float32Array) {
  const n = 8192;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const used = Math.min(n, x.length);
  for (let i = 0; i < used; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / used));
  fft(re, im);
  const power: number[] = [];
  const freq: number[] = [];
  let total = 0;
  let weighted = 0;
  for (let k = 1; k < n / 2; k++) {
    const hz = (k * SAMPLE_RATE) / n;
    if (hz < 60 || hz > 16000) continue;
    const p = re[k] * re[k] + im[k] * im[k];
    power.push(p);
    freq.push(hz);
    total += p;
    weighted += p * hz;
  }
  const centroid = weighted / total;
  let spread = 0;
  for (let i = 0; i < power.length; i++) spread += power[i] * Math.log2(freq[i] / centroid) ** 2;
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  let last = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.05 * peak) last = i;
  return { centroid, spread: Math.sqrt(spread / total), ms: (last / SAMPLE_RATE) * 1000, peak };
}

test("swarm WAVs are deterministic mono PCM16, frame-exact, with a calibrated peak and level", () => {
  for (const def of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(def.slug);
    const wav = synthesizeSwarmWav(trace, def);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 16), "WAVEfmt ");
    assert.equal(wav.readUInt16LE(20), 1, "PCM");
    assert.equal(wav.readUInt16LE(22), 1, "mono");
    assert.equal(wav.readUInt32LE(24), SAMPLE_RATE);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.length, 44 + trace.totalFrames * SAMPLES_PER_FRAME * 2, `${def.id} length`);
    assert.equal(wav.readUInt32LE(40), trace.totalFrames * SAMPLES_PER_FRAME * 2);
    assert.deepEqual(wav, synthesizeSwarmWav(trace, def), `${def.id} must replay identically`);

    const samples = readPcm(wav);
    let peak = 0;
    for (const v of samples) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.5 && peak < 0.95, `${def.id}: peak ${peak}`);
    const level = rms(samples);
    assert.ok(level > 0.04 && level < 0.2, `${def.id}: rms ${level}`);
  }
});

test("audio is never silent: every 250 ms window carries sound, from the first window through the hold", () => {
  for (const def of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(def.slug);
    const samples = readPcm(synthesizeSwarmWav(trace, def));
    const window = SAMPLE_RATE / 4;
    for (let from = 0; from + window <= samples.length; from += window) {
      const level = rms(samples, from, from + window);
      assert.ok(level > 0.006, `${def.id}: window at ${(from / SAMPLE_RATE).toFixed(2)} s is near silent (rms ${level})`);
    }
    // The hold after the win keeps ringing right up to the final fade.
    const win = trace.winFrame * SAMPLES_PER_FRAME;
    const lastSecond = samples.length - SAMPLE_RATE;
    assert.ok(rms(samples, win, win + SAMPLE_RATE / 2) > 0.05, `${def.id}: chime must be prominent`);
    assert.ok(rms(samples, lastSecond, samples.length) > 0.005, `${def.id}: last second must not be silent`);
  }
});

test("conversion sounds are rate limited, spaced, polyphony capped, and drawn from real events", () => {
  for (const def of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(def.slug);
    const kept = scheduleConversionSounds(trace);
    assert.deepEqual(kept, scheduleConversionSounds(trace), "schedule must be deterministic");
    assert.ok(kept.length > 20, `${def.id}: expected an audible stream of conversions`);
    assert.ok(kept.length < trace.events.length / 3, `${def.id}: the swarm must be thinned, kept ${kept.length}/${trace.events.length}`);

    const lastByType = new Map<number, number>();
    for (let i = 0; i < kept.length; i++) {
      const t = kept[i];
      const event = trace.events[t.eventIndex];
      assert.equal(t.frame, event.frame);
      assert.equal(t.winner, event.winner);
      assert.ok(Number.isFinite(t.gain) && t.gain > 0.5 && t.gain < 2);
      if (i > 0) {
        assert.ok(t.frame - kept[i - 1].frame >= SWARM_AUDIO.globalGapFrames, `${def.id}: gap at ${t.frame}`);
      }
      const prior = lastByType.get(t.winner);
      if (prior !== undefined) assert.ok(t.frame - prior >= SWARM_AUDIO.typeGapFrames, `${def.id}: type gap at ${t.frame}`);
      lastByType.set(t.winner, t.frame);

      // Sliding windows starting at every kept trigger.
      let inSecond = 0;
      let inVoice = 0;
      for (let j = i; j < kept.length && kept[j].frame < t.frame + SWARM_AUDIO.windowFrames; j++) inSecond++;
      for (let j = i; j < kept.length && kept[j].frame < t.frame + SWARM_AUDIO.voiceFrames; j++) inVoice++;
      assert.ok(inSecond <= SWARM_AUDIO.windowCap, `${def.id}: ${inSecond} triggers within one second at frame ${t.frame}`);
      assert.ok(inVoice <= SWARM_AUDIO.maxVoices, `${def.id}: ${inVoice} overlapping voices at frame ${t.frame}`);
    }
    assert.ok(SWARM_AUDIO.windowCap <= 14, "the brief caps triggers at about 12-14 per second");
    assert.ok(kept.some((t) => t.dropped > 0), "dropped conversions must lift the next kept voice");
    assert.ok(kept.some((t) => t.gain > 1.1), "busy passages play louder");
  }
});

test("conversion pitch varies: each winner uses several steps of the pentatonic ladder within about an octave", () => {
  for (const def of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(def.slug);
    const kept = scheduleConversionSounds(trace);
    const lowest = 2 ** (-6 / 12);
    const highest = 2 ** (8 / 12);
    const byWinner = new Map<number, Set<number>>();
    for (const t of kept) {
      assert.ok(t.pitch >= lowest && t.pitch <= highest, `${def.id}: pitch ratio ${t.pitch}`);
      assert.ok(Math.abs(2 ** (t.semitones / 12) - t.pitch) < 1e-9);
      const steps = byWinner.get(t.winner) ?? new Set<number>();
      steps.add(Math.round(t.semitones));
      byWinner.set(t.winner, steps);
    }
    for (const [winner, steps] of byWinner) {
      const count = kept.filter((t) => t.winner === winner).length;
      if (count >= 8) assert.ok(steps.size >= 3, `${def.id}: winner ${winner} used only ${steps.size} pitch steps over ${count} voices`);
    }
  }
});

test("all eight conversion voices are short, finite, deterministic and pairwise distinct in spectrum and shape", () => {
  const features = SWARM_SOUND_KINDS.map((kind) => {
    const voice = renderConversionSound(kind, 1, 3);
    assert.deepEqual(voice, renderConversionSound(kind, 1, 3), `${kind} must be deterministic`);
    assert.ok(voice.every(Number.isFinite), `${kind} must be finite`);
    assert.notDeepEqual(voice, renderConversionSound(kind, 1.5, 3), `${kind} must follow pitch`);
    const f = voiceFeatures(voice);
    assert.ok(f.peak > 0.25 && f.peak <= 1, `${kind}: peak ${f.peak}`);
    assert.ok(voice.length / SAMPLE_RATE <= 0.14 + 1e-9, `${kind}: voice must stay within 140 ms`);
    assert.ok(f.ms >= 40 && f.ms <= 140, `${kind}: audible length ${f.ms} ms`);
    return { kind, ...f };
  });
  for (let a = 0; a < features.length; a++) {
    for (let b = a + 1; b < features.length; b++) {
      const x = features[a];
      const y = features[b];
      const distance = Math.hypot(Math.log2(x.centroid / y.centroid), Math.log2(x.ms / y.ms), (x.spread - y.spread) * 2);
      assert.ok(distance > 0.6, `${x.kind} and ${y.kind} sound too alike (distance ${distance.toFixed(2)})`);
    }
  }
  // Rock is the lowest, scissors the brightest, as designed.
  const centroid = Object.fromEntries(features.map((f) => [f.kind, f.centroid]));
  assert.ok(centroid.tok < 300 && centroid.knock < 400 && centroid.snip > 4000);
});

test("each conversion plays the voice of the winning type's skin", () => {
  for (const def of SWARM_DEFINITIONS) {
    const base = simulateSwarmDefinition(def.slug);
    const heard = new Set<string>();
    for (let winner = 0; winner < base.types; winner++) {
      const event: SwarmEvent = { frame: 100, sprite: 0, by: 1, x: 0, y: 0, winner, loser: (winner + 1) % base.types };
      const solo: SwarmTrace = { ...base, events: [event] };
      const { sounds, triggers } = renderSwarmLayers(solo, def);
      assert.equal(triggers.length, 1);
      const kind = def.skin.types[winner].sound;
      heard.add(kind);
      const expected = renderConversionSound(kind, triggers[0].pitch, 1);
      const start = 100 * SAMPLES_PER_FRAME;
      let worst = 0;
      for (let i = 0; i < expected.length; i++) {
        worst = Math.max(worst, Math.abs(sounds[start + i] - 0.55 * triggers[0].gain * expected[i]));
      }
      assert.ok(worst < 1e-5, `${def.id}: winner ${winner} should play ${kind} (max error ${worst})`);
      for (let i = 0; i < start; i++) assert.equal(sounds[i], 0);
    }
    assert.equal(heard.size, base.types, `${def.id}: every type needs its own voice`);
  }
});

test("the tension bed is quiet, never silent, and climbs as types disappear", () => {
  for (const def of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(def.slug);
    const { bed, sounds } = renderSwarmLayers(trace, def);
    const win = trace.winFrame * SAMPLES_PER_FRAME;
    const early = rms(bed, SAMPLE_RATE / 2, 3.5 * SAMPLE_RATE);
    const late = rms(bed, win - 3.5 * SAMPLE_RATE, win - SAMPLE_RATE / 2);
    assert.ok(early > 0.005, `${def.id}: the bed must sound from the start`);
    assert.ok(late > early * 1.2, `${def.id}: bed rms must rise (early ${early}, late ${late})`);
    assert.ok(rms(bed, 0, win) < 0.5 * rms(sounds, 0, win), `${def.id}: the bed must stay behind the conversions`);
    for (const v of bed) assert.ok(Math.abs(v) < 0.4);

    const tension = tensionCurve(trace);
    assert.equal(tension.length, trace.totalFrames);
    assert.ok(tension.every((v) => v >= 0 && v <= 1));
    assert.ok(tension[trace.winFrame] > 0.5, `${def.id}: tension must be high when one type is left`);
    assert.ok(tension[trace.totalFrames - 1] < tension[trace.winFrame], `${def.id}: the bed relaxes during the hold`);
    assert.deepEqual(renderTensionBed(trace, def), bed, "bed must be deterministic");
  }
});

test("a bell chime starts on the winning frame, resolves into a major triad and rings for over a second", () => {
  for (const def of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(def.slug);
    const { chime } = renderSwarmLayers(trace, def);
    const start = trace.winFrame * SAMPLES_PER_FRAME;
    for (let i = 0; i < start; i++) assert.equal(chime[i], 0, `${def.id}: chime leaked before the win`);
    let peak = 0;
    for (const v of chime) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.4, `${def.id}: chime peak ${peak}`);
    const attack = rms(chime, start, start + 0.3 * SAMPLE_RATE);
    assert.ok(attack > 3 * rms(chime, start + 1.5 * SAMPLE_RATE, start + 1.8 * SAMPLE_RATE), "chime must decay");
    assert.ok(rms(chime, start + SAMPLE_RATE, start + 1.3 * SAMPLE_RATE) > 0.01, "chime must still ring after one second");
    assert.deepEqual(renderFinishChime(def.rootHz), renderFinishChime(def.rootHz));

    // In the final mix the chime's major third and fifth appear on the winning frame.
    const samples = readPcm(synthesizeSwarmWav(trace, def));
    const third = def.rootHz * 4 * (5 / 4);
    const fifth = def.rootHz * 4 * (3 / 2);
    const after = [start + 0.3 * SAMPLE_RATE, start + 0.55 * SAMPLE_RATE] as const;
    const before = [start - 0.55 * SAMPLE_RATE, start - 0.3 * SAMPLE_RATE] as const;
    for (const hz of [third, fifth]) {
      const gain = tonePower(samples, hz, after[0], after[1]) / Math.max(1e-12, tonePower(samples, hz, before[0], before[1]));
      assert.ok(gain > 3, `${def.id}: ${hz.toFixed(0)} Hz must jump when the chime starts (x${gain.toFixed(1)})`);
    }
  }
});
