import { panFromScreenX } from "../../audio-reactive/synth.ts";
import { FPS } from "../kit.ts";
import { OVERFLOW_SPEC } from "./spec.ts";
import { OVERFLOW_TARGET, type OverflowTrace } from "./sim.ts";
import type { HitAudio } from "../types.ts";
import {
  addBell,
  addBoom,
  addRiser,
  addSoftPad,
  addThud,
  addWhoosh,
  finishHitAudio,
  newHitBuffer,
  noteHz,
  PENTATONIC_MAJOR,
  scaleMidi,
  thinEvents,
} from "../voices.ts";

export type OverflowAudioKind = "bell" | "milestone" | "decade" | "riser" | "boom" | "whoosh";

export interface OverflowAudioEvent {
  t: number;
  kind: OverflowAudioKind;
  midi: number;
  gain: number;
  pan: number;
  durSec?: number;
}

const ORDINARY_BELLS_PER_SECOND = 12;

function isPowerOfTwo(n: number): boolean {
  return n > 1 && (n & (n - 1)) === 0;
}

/**
 * One event per audible thing. Every doubling gets a louder bell that climbs a pentatonic scale
 * (the count is audible). The other splits are thinned to at most 12 per second so ten thousand
 * splits never turn into a wall of noise.
 */
export function buildOverflowAudioEvents(trace: OverflowTrace): OverflowAudioEvent[] {
  const events: OverflowAudioEvent[] = [];
  const ordinary: OverflowAudioEvent[] = [];
  for (const s of trace.splits) {
    const pan = panFromScreenX(s.x);
    const k = Math.floor(Math.log2(s.n));
    if (isPowerOfTwo(s.n)) {
      events.push({
        t: s.t,
        kind: "milestone",
        midi: scaleMidi(55, PENTATONIC_MAJOR, k + 3),
        gain: 0.2,
        pan,
      });
    } else if (s.n === 10 || s.n === 100 || s.n === 1000) {
      events.push({
        t: s.t,
        kind: "decade",
        midi: scaleMidi(55, PENTATONIC_MAJOR, k + 5),
        gain: 0.16,
        pan,
      });
    } else {
      const wobble = (s.n * 7) % 3;
      ordinary.push({
        t: s.t,
        kind: "bell",
        midi: scaleMidi(55, PENTATONIC_MAJOR, k + wobble),
        gain: 0.075,
        pan,
      });
    }
  }
  events.push(...thinEvents(ordinary, ORDINARY_BELLS_PER_SECOND));

  const tOver = trace.overflowFrame / FPS;
  const tOpen = trace.openFrame / FPS;
  events.push({ t: tOver - 2.2, kind: "riser", midi: 0, gain: 0.14, pan: 0, durSec: 2.2 });
  events.push({ t: tOver, kind: "boom", midi: 0, gain: 0.5, pan: 0 });
  events.push({ t: tOpen, kind: "whoosh", midi: 0, gain: 0.28, pan: 0, durSec: 1.4 });
  events.sort((a, b) => a.t - b.t);
  return events;
}

const PAD_CHORDS: readonly (readonly number[])[] = [
  [45, 52, 57, 60], // Am
  [41, 48, 53, 57], // F
  [48, 55, 60, 64], // C
  [43, 50, 55, 59], // G
];

export function buildOverflowAudio(trace: OverflowTrace): HitAudio {
  const totalSec = OVERFLOW_SPEC.totalFrames / FPS;
  const buf = newHitBuffer(OVERFLOW_SPEC.totalFrames);

  // soft bed under everything, to the last frame; after the burst it settles on C major
  const tOver = trace.overflowFrame / FPS;
  const chordSec = 5.5;
  let t = 0;
  let idx = 0;
  while (t < tOver - 0.1) {
    const dur = Math.min(chordSec + 0.6, tOver - t + 0.4);
    addSoftPad(buf, {
      startSec: t,
      durSec: dur,
      freqs: PAD_CHORDS[idx % PAD_CHORDS.length].map(noteHz),
      gain: 0.055,
    });
    t += chordSec;
    idx++;
  }
  addSoftPad(buf, {
    startSec: tOver - 0.2,
    durSec: totalSec - (tOver - 0.2),
    freqs: [48, 55, 60, 64, 67].map(noteHz),
    gain: 0.075,
    attackSec: 0.35,
    releaseSec: 0.6,
  });

  for (const e of buildOverflowAudioEvents(trace)) {
    switch (e.kind) {
      case "bell":
        addBell(buf, { t: e.t, freq: noteHz(e.midi), gain: e.gain, pan: e.pan, decay: 8, durSec: 0.45 });
        break;
      case "milestone":
        addBell(buf, { t: e.t, freq: noteHz(e.midi), gain: e.gain, pan: e.pan, decay: 5.5, durSec: 0.8 });
        if (e.midi >= 69) addThud(buf, { t: e.t, gain: 0.22, pan: e.pan * 0.5, hz: 78 });
        break;
      case "decade":
        addBell(buf, { t: e.t, freq: noteHz(e.midi), gain: e.gain, pan: e.pan, decay: 4.5, durSec: 0.9 });
        addBell(buf, { t: e.t, freq: noteHz(e.midi + 7), gain: e.gain * 0.7, pan: -e.pan, decay: 4.5, durSec: 0.9 });
        addThud(buf, { t: e.t, gain: 0.3, hz: 70 });
        break;
      case "riser":
        addRiser(buf, { t: e.t, durSec: e.durSec ?? 2, gain: e.gain, fromHz: 160, toHz: 780 });
        break;
      case "boom":
        addBoom(buf, { t: e.t, gain: e.gain });
        break;
      case "whoosh":
        addWhoosh(buf, { t: e.t, durSec: e.durSec ?? 1.2, gain: e.gain, fromHz: 1100, toHz: 260, seed: 31 });
        break;
    }
  }
  return finishHitAudio(buf);
}

export { OVERFLOW_TARGET };
