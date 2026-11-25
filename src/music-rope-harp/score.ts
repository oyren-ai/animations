import { VIDEO } from "../settings.ts";
import type {
  DroneSegment,
  DrumHit,
  Note,
  PieceScore,
  RiserCue,
} from "../music/types.ts";

export const ROPE_HARP_DURATION_SEC = 46;
export const ROPE_HARP_TOTAL_FRAMES = ROPE_HARP_DURATION_SEC * VIDEO.fps; // 2760 frames

interface MelodyEvent {
  readonly bar: number; // 0-indexed bar in 8-bar section
  readonly beat: number; // 0..3 in 3/4 time
  readonly durBeats: number;
  readonly midi: number;
}

// Traditional 16th-century Greensleeves (public domain) in A Dorian / A minor (A4 = 69)
// Verse A1 (8 bars, half-cadence on E4 = 64)
const VERSE_A1: readonly MelodyEvent[] = [
  { bar: 0, beat: 0.0, durBeats: 1.9, midi: 72 }, // C5
  { bar: 0, beat: 2.0, durBeats: 0.95, midi: 74 }, // D5
  { bar: 1, beat: 0.0, durBeats: 1.45, midi: 76 }, // E5
  { bar: 1, beat: 1.5, durBeats: 0.48, midi: 77 }, // F5
  { bar: 1, beat: 2.0, durBeats: 0.95, midi: 76 }, // E5
  { bar: 2, beat: 0.0, durBeats: 1.9, midi: 74 }, // D5
  { bar: 2, beat: 2.0, durBeats: 0.95, midi: 71 }, // B4
  { bar: 3, beat: 0.0, durBeats: 1.45, midi: 67 }, // G4
  { bar: 3, beat: 1.5, durBeats: 0.48, midi: 69 }, // A4
  { bar: 3, beat: 2.0, durBeats: 0.95, midi: 71 }, // B4
  { bar: 4, beat: 0.0, durBeats: 1.9, midi: 72 }, // C5
  { bar: 4, beat: 2.0, durBeats: 0.95, midi: 69 }, // A4
  { bar: 5, beat: 0.0, durBeats: 1.45, midi: 69 }, // A4
  { bar: 5, beat: 1.5, durBeats: 0.48, midi: 68 }, // G#4
  { bar: 5, beat: 2.0, durBeats: 0.95, midi: 69 }, // A4
  { bar: 6, beat: 0.0, durBeats: 1.9, midi: 71 }, // B4
  { bar: 6, beat: 2.0, durBeats: 0.95, midi: 68 }, // G#4
  { bar: 7, beat: 0.0, durBeats: 1.9, midi: 64 }, // E4
  { bar: 7, beat: 2.0, durBeats: 0.95, midi: 69 }, // pickup A4 into A2
];

// Verse A2 (8 bars, authentic cadence on A4 = 69)
const VERSE_A2: readonly MelodyEvent[] = [
  ...VERSE_A1.slice(0, 10),
  { bar: 4, beat: 0.0, durBeats: 1.45, midi: 72 }, // C5
  { bar: 4, beat: 1.5, durBeats: 0.48, midi: 71 }, // B4
  { bar: 4, beat: 2.0, durBeats: 0.95, midi: 69 }, // A4
  { bar: 5, beat: 0.0, durBeats: 1.45, midi: 68 }, // G#4
  { bar: 5, beat: 1.5, durBeats: 0.48, midi: 66 }, // F#4
  { bar: 5, beat: 2.0, durBeats: 0.95, midi: 68 }, // G#4
  { bar: 6, beat: 0.0, durBeats: 2.8, midi: 69 }, // A4
  { bar: 7, beat: 0.0, durBeats: 2.6, midi: 69 }, // A4 sustained
];

// Refrain B1 ("Greensleeves was all my joy", 8 bars -> half-cadence on E4)
const REFRAIN_B1: readonly MelodyEvent[] = [
  { bar: 0, beat: 0.0, durBeats: 2.8, midi: 79 }, // G5
  { bar: 1, beat: 0.0, durBeats: 1.45, midi: 79 }, // G5
  { bar: 1, beat: 1.5, durBeats: 0.48, midi: 78 }, // F#5 (Renaissance Dorian!)
  { bar: 1, beat: 2.0, durBeats: 0.95, midi: 76 }, // E5
  { bar: 2, beat: 0.0, durBeats: 1.9, midi: 74 }, // D5
  { bar: 2, beat: 2.0, durBeats: 0.95, midi: 71 }, // B4
  { bar: 3, beat: 0.0, durBeats: 1.45, midi: 67 }, // G4
  { bar: 3, beat: 1.5, durBeats: 0.48, midi: 69 }, // A4
  { bar: 3, beat: 2.0, durBeats: 0.95, midi: 71 }, // B4
  { bar: 4, beat: 0.0, durBeats: 1.9, midi: 72 }, // C5
  { bar: 4, beat: 2.0, durBeats: 0.95, midi: 69 }, // A4
  { bar: 5, beat: 0.0, durBeats: 1.45, midi: 69 }, // A4
  { bar: 5, beat: 1.5, durBeats: 0.48, midi: 68 }, // G#4
  { bar: 5, beat: 2.0, durBeats: 0.95, midi: 69 }, // A4
  { bar: 6, beat: 0.0, durBeats: 1.9, midi: 71 }, // B4
  { bar: 6, beat: 2.0, durBeats: 0.95, midi: 68 }, // G#4
  { bar: 7, beat: 0.0, durBeats: 1.8, midi: 64 }, // E4 (before dramatic pre-payoff breath!)
];

// Refrain B2 Payoff ("Greensleeves was my heart of gold", 8 bars -> tonic A4/A5 resolution)
const REFRAIN_B2: readonly MelodyEvent[] = [
  ...REFRAIN_B1.slice(0, 9),
  { bar: 4, beat: 0.0, durBeats: 1.45, midi: 72 }, // C5
  { bar: 4, beat: 1.5, durBeats: 0.48, midi: 71 }, // B4
  { bar: 4, beat: 2.0, durBeats: 0.95, midi: 69 }, // A4
  { bar: 5, beat: 0.0, durBeats: 1.45, midi: 68 }, // G#4
  { bar: 5, beat: 1.5, durBeats: 0.48, midi: 66 }, // F#4
  { bar: 5, beat: 2.0, durBeats: 0.95, midi: 68 }, // G#4
  { bar: 6, beat: 0.0, durBeats: 2.8, midi: 69 }, // A4
  { bar: 7, beat: 0.0, durBeats: 2.4, midi: 81 }, // A5 radiant high bell payoff!
];

// Chord roots & harp triad tones per bar of each 8-bar phrase:
// Am | Am | G | G | Am | E | E | E (or Am | Am on authentic ending)
const HARMONY_A1: readonly (readonly [number, number, number])[] = [
  [57, 64, 69], // Am (A3, E4, A4)
  [57, 64, 72], // Am
  [55, 62, 67], // G (G3, D4, G4)
  [55, 62, 71], // G
  [57, 64, 72], // Am
  [52, 64, 68], // E (E3, E4, G#4)
  [52, 59, 68], // E
  [52, 59, 64], // E
];

const HARMONY_A2: readonly (readonly [number, number, number])[] = [
  [57, 64, 69],
  [57, 64, 72],
  [55, 62, 67],
  [55, 62, 71],
  [57, 64, 72],
  [52, 59, 68],
  [57, 64, 72], // Am
  [57, 64, 69], // Am
];

const HARMONY_B1: readonly (readonly [number, number, number])[] = [
  [60, 67, 72], // C (C4, G4, C5)
  [60, 67, 76], // C
  [55, 62, 67], // G
  [55, 62, 71], // G
  [57, 64, 72], // Am
  [52, 64, 68], // E
  [52, 59, 68], // E
  [52, 59, 64], // E
];

const HARMONY_B2: readonly (readonly [number, number, number])[] = [
  [60, 67, 72],
  [60, 67, 76],
  [55, 62, 67],
  [55, 62, 71],
  [57, 64, 72],
  [52, 59, 68],
  [57, 64, 72],
  [57, 64, 76], // Am radiant final bar
];

let cachedScore: PieceScore | null = null;

export function buildRopeHarpScore(): PieceScore {
  if (cachedScore) return cachedScore;

  const bpm = 132; // lively 3/4 waltz pulse (132 BPM -> 0.4545s/beat, 1.3636s/bar)
  const spb = 60 / bpm;
  const barSec = spb * 3;

  const notes: Note[] = [];
  const drums: DrumHit[] = [];

  // Hook inside first 1.5s: Scissors snip at t = 0.04s -> pickup A4 chime rings at t = 0.36s,
  // Bar 0 downbeat lands cleanly at t = 0.82s!
  const pickupTime = 0.36;
  const bar0Start = pickupTime + spb;

  notes.push({
    time: pickupTime,
    duration: spb * 0.95,
    midi: 69, // A4 pickup ("A-")
    velocity: 0.72,
    voice: "chime",
    section: "hook",
  });
  notes.push({
    time: pickupTime,
    duration: spb * 1.2,
    midi: 57, // A3 warm bass support on hook
    velocity: 0.58,
    voice: "bass",
    section: "hook",
  });

  const renderSection = (
    startSec: number,
    melody: readonly MelodyEvent[],
    harmony: readonly (readonly [number, number, number])[],
    velBase: number,
    velRise: number,
    opts: {
      section: Note["section"];
      arpDensity: "gentle" | "flowing" | "payoff";
      doubleBell?: boolean;
      drumsMode?: "none" | "soft" | "joyful";
      skipBar7ArpAfterBeat?: number;
    },
  ): number => {
    // Melody notes
    for (const m of melody) {
      const t = startSec + (m.bar * 3 + m.beat) * spb;
      const u = (m.bar * 3 + m.beat) / 24;
      const vel = Math.min(1, velBase + velRise * u);
      notes.push({
        time: t,
        duration: m.durBeats * spb,
        midi: m.midi,
        velocity: vel,
        voice: "chime",
        section: opts.section,
      });
      if (opts.doubleBell && (m.beat === 0 || m.durBeats >= 1.4)) {
        notes.push({
          time: t + 0.006,
          duration: m.durBeats * spb * 1.05,
          midi: m.midi,
          velocity: vel * 0.74,
          voice: "bell",
          section: opts.section,
        });
      }
    }

    // Bass & Harp Arpeggio Chime Bars
    for (let bar = 0; bar < 8; bar++) {
      const bStart = startSec + bar * barSec;
      const [root, fifth, upper] = harmony[bar];
      const u = bar / 8;
      const vel = (velBase + velRise * u) * 0.76;

      // Downbeat bass bar
      notes.push({
        time: bStart,
        duration: spb * 1.9,
        midi: root,
        velocity: vel * 0.92,
        voice: "bass",
        section: opts.section,
      });

      const allowBeat1 =
        opts.skipBar7ArpAfterBeat === undefined || bar < 7 || 1 < opts.skipBar7ArpAfterBeat;
      const allowBeat2 =
        opts.skipBar7ArpAfterBeat === undefined || bar < 7 || 2 < opts.skipBar7ArpAfterBeat;

      if (allowBeat1) {
        notes.push({
          time: bStart + spb,
          duration: spb * 0.95,
          midi: fifth,
          velocity: vel * 0.78,
          voice: "arp",
          section: opts.section,
        });
      }
      if (allowBeat2) {
        notes.push({
          time: bStart + spb * 2,
          duration: spb * 0.95,
          midi: upper,
          velocity: vel * 0.8,
          voice: "arp",
          section: opts.section,
        });
      }
      if (opts.arpDensity === "payoff" && allowBeat2) {
        notes.push({
          time: bStart + spb * 2.5,
          duration: spb * 0.65,
          midi: fifth,
          velocity: vel * 0.68,
          voice: "arp",
          section: opts.section,
        });
      }

      if (opts.drumsMode && opts.drumsMode !== "none") {
        const dVel = opts.drumsMode === "joyful" ? 0.65 : 0.42;
        drums.push({ time: bStart, kind: "kick", velocity: dVel });
        if (allowBeat1) {
          drums.push({ time: bStart + spb, kind: "hat", velocity: dVel * 0.65, pan: -0.15 });
        }
        if (allowBeat2) {
          drums.push({
            time: bStart + spb * 2,
            kind: opts.drumsMode === "joyful" && bar % 2 === 1 ? "snare" : "hat",
            velocity: dVel * 0.72,
            pan: 0.15,
          });
        }
      }
    }

    return startSec + 8 * barSec;
  };

  // 1. Verse A1 (0.82s -> 11.73s)
  const afterA1 = renderSection(bar0Start, VERSE_A1, HARMONY_A1, 0.66, 0.08, {
    section: "theme",
    arpDensity: "gentle",
    drumsMode: "none",
  });

  // 2. Verse A2 (11.73s -> 22.64s)
  const afterA2 = renderSection(afterA1, VERSE_A2, HARMONY_A2, 0.72, 0.09, {
    section: "build",
    arpDensity: "flowing",
    drumsMode: "soft",
  });

  // 3. Refrain B1 ("Greensleeves was all my joy", 22.64s -> 33.55s)
  // Leave beats 2 & 3 of Bar 7 open for the pre-payoff dramatic pause!
  const afterB1 = renderSection(afterA2, REFRAIN_B1, HARMONY_B1, 0.78, 0.1, {
    section: "build",
    arpDensity: "flowing",
    drumsMode: "soft",
    skipBar7ArpAfterBeat: 1.5,
  });

  // Half-bar near-silence + delicate riser right before B2 Payoff (~33.0s -> 34.15s, ~74% mark!)
  const pauseStart = afterB1 - spb * 1.15;
  const payoffStart = afterB1 + 0.55;
  const risers: RiserCue[] = [
    {
      startTime: pauseStart - 0.35,
      endTime: payoffStart - 0.12,
      startMidi: 64,
      endMidi: 79,
      gain: 0.12,
    },
  ];

  // 4. Payoff Refrain B2 (34.10s -> 45.01s, ~74% to 98%!)
  const afterB2 = renderSection(payoffStart, REFRAIN_B2, HARMONY_B2, 0.86, 0.12, {
    section: "payoff",
    arpDensity: "payoff",
    doubleBell: true,
    drumsMode: "joyful",
  });

  // 5. Seamless loop join chord/pickup (~45.0s -> 46.0s -> flows into pickup A4 at 0.36s!)
  if (afterB2 < ROPE_HARP_DURATION_SEC - 0.28) {
    notes.push({
      time: afterB2 + 0.05,
      duration: 0.55,
      midi: 64, // E4 dominant gentle lead-back into A4 opening!
      velocity: 0.62,
      voice: "arp",
      section: "loop",
    });
  }

  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
  drums.sort((a, b) => a.time - b.time);

  const drones: DroneSegment[] = [
    {
      startTime: 0,
      endTime: pauseStart,
      midi: 45, // A2 warm resonance
      gain: 0.028,
      withFifth: true,
    },
    {
      startTime: payoffStart,
      endTime: ROPE_HARP_DURATION_SEC,
      midi: 45,
      gain: 0.032,
      withFifth: true,
    },
  ];

  cachedScore = {
    id: "MusicRopeHarp",
    slug: "music-rope-harp",
    title: "Greensleeves",
    subtitle: "Traditional English Air · Tuned Rope Harp",
    durationSec: ROPE_HARP_DURATION_SEC,
    totalFrames: ROPE_HARP_TOTAL_FRAMES,
    notes,
    drums,
    drones,
    risers,
  };
  return cachedScore;
}
