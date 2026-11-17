import { VIDEO } from "../settings.ts";
import type {
  DroneSegment,
  DrumHit,
  Note,
  PieceScore,
  RiserCue,
  VoiceId,
} from "../music/types.ts";

export const FIREWORK_DURATION_SEC = 48;
export const FIREWORK_TOTAL_FRAMES = FIREWORK_DURATION_SEC * VIDEO.fps; // 2880 frames

/**
 * Exact Grieg "In the Hall of the Mountain King" (Op. 46 No. 4, 1875, public domain)
 * melodic phrases in semitone offsets above tonic B:
 * - B = 0, C = 1, C# = 2, D = 3, E = 5, F(E#) = 6, F# = 7, G# = 9, A = 10, A# = 11, B(oct) = 12, C# = 14, D = 15
 */
interface PhraseStep {
  readonly beat: number;
  readonly durBeats: number;
  readonly semi: number;
}

// Bars 1-4 (A1: B minor -> D major half-cadence on A)
const PHRASE_A_TO_A: readonly PhraseStep[] = [
  // Bar 1: B C# D E | F# D F# -
  { beat: 0.0, durBeats: 0.45, semi: 0 },
  { beat: 0.5, durBeats: 0.45, semi: 2 },
  { beat: 1.0, durBeats: 0.45, semi: 3 },
  { beat: 1.5, durBeats: 0.45, semi: 5 },
  { beat: 2.0, durBeats: 0.45, semi: 7 },
  { beat: 2.5, durBeats: 0.45, semi: 3 },
  { beat: 3.0, durBeats: 0.9, semi: 7 },
  // Bar 2: F(nat) C#(Db) F - | E C(nat) E -
  { beat: 4.0, durBeats: 0.45, semi: 6 },
  { beat: 4.5, durBeats: 0.45, semi: 2 },
  { beat: 5.0, durBeats: 0.9, semi: 6 },
  { beat: 6.0, durBeats: 0.45, semi: 5 },
  { beat: 6.5, durBeats: 0.45, semi: 1 },
  { beat: 7.0, durBeats: 0.9, semi: 5 },
  // Bar 3: B C# D E | F# D F# B(oct)
  { beat: 8.0, durBeats: 0.45, semi: 0 },
  { beat: 8.5, durBeats: 0.45, semi: 2 },
  { beat: 9.0, durBeats: 0.45, semi: 3 },
  { beat: 9.5, durBeats: 0.45, semi: 5 },
  { beat: 10.0, durBeats: 0.45, semi: 7 },
  { beat: 10.5, durBeats: 0.45, semi: 3 },
  { beat: 11.0, durBeats: 0.45, semi: 7 },
  { beat: 11.5, durBeats: 0.45, semi: 12 },
  // Bar 4: A F# D F# | A - - -
  { beat: 12.0, durBeats: 0.45, semi: 10 },
  { beat: 12.5, durBeats: 0.45, semi: 7 },
  { beat: 13.0, durBeats: 0.45, semi: 3 },
  { beat: 13.5, durBeats: 0.45, semi: 7 },
  { beat: 14.0, durBeats: 1.75, semi: 10 },
];

// Bars 5-8 / final A (A2: B minor -> authentic tonic resolution on B via A#-F#-A#-C#-B)
const PHRASE_A_TO_B: readonly PhraseStep[] = [
  ...PHRASE_A_TO_A.slice(0, 21),
  // Bar 4 tonic cadence: A# F# A# C# | B - - -
  { beat: 12.0, durBeats: 0.45, semi: 11 },
  { beat: 12.5, durBeats: 0.45, semi: 7 },
  { beat: 13.0, durBeats: 0.45, semi: 11 },
  { beat: 13.5, durBeats: 0.45, semi: 14 },
  { beat: 14.0, durBeats: 1.75, semi: 12 },
];

// B section (4-bar unit in F# major: F# G# A# B C# A# C# - | D A# D - C# A# C# -)
const PHRASE_B_HALF: readonly PhraseStep[] = [
  { beat: 0.0, durBeats: 0.45, semi: 7 },
  { beat: 0.5, durBeats: 0.45, semi: 9 },
  { beat: 1.0, durBeats: 0.45, semi: 11 },
  { beat: 1.5, durBeats: 0.45, semi: 12 },
  { beat: 2.0, durBeats: 0.45, semi: 14 },
  { beat: 2.5, durBeats: 0.45, semi: 11 },
  { beat: 3.0, durBeats: 0.9, semi: 14 },
  { beat: 4.0, durBeats: 0.45, semi: 15 },
  { beat: 4.5, durBeats: 0.45, semi: 11 },
  { beat: 5.0, durBeats: 0.9, semi: 15 },
  { beat: 6.0, durBeats: 0.45, semi: 14 },
  { beat: 6.5, durBeats: 0.45, semi: 11 },
  { beat: 7.0, durBeats: 0.9, semi: 14 },
];

let cachedScore: PieceScore | null = null;

export function buildFireworkMountainKingScore(): PieceScore {
  if (cachedScore) return cachedScore;

  const notes: Note[] = [];
  const drums: DrumHit[] = [];

  // Continuous accelerando beat-to-seconds mapper: BPM rises from 112 -> 196 across the piece
  let cursorSec = 0.34; // Hook rocket launches at t=0.04s, detonates at t=0.34s (< 1.5s hook!)

  const advanceBeatMap = (
    totalBeats: number,
    bpmStart: number,
    bpmEnd: number,
  ): ((beat: number) => { time: number; secPerBeat: number }) => {
    const startSec = cursorSec;
    const steps = 256;
    const times = new Float64Array(steps + 1);
    let t = startSec;
    times[0] = t;
    for (let i = 1; i <= steps; i++) {
      const u = (i - 0.5) / steps;
      const bpm = bpmStart + (bpmEnd - bpmStart) * u;
      const db = totalBeats / steps;
      t += (db * 60) / bpm;
      times[i] = t;
    }
    cursorSec = times[steps];
    return (beat: number) => {
      const clamped = Math.max(0, Math.min(totalBeats, beat));
      const pos = (clamped / totalBeats) * steps;
      const idx = Math.min(steps - 1, Math.floor(pos));
      const frac = pos - idx;
      const time = times[idx] + (times[idx + 1] - times[idx]) * frac;
      const u = clamped / totalBeats;
      const bpm = bpmStart + (bpmEnd - bpmStart) * u;
      return { time, secPerBeat: 60 / bpm };
    };
  };

  const addPhrase = (
    steps: readonly PhraseStep[],
    totalBeats: number,
    bpmStart: number,
    bpmEnd: number,
    rootMidi: number,
    leadVoice: VoiceId,
    velStart: number,
    velEnd: number,
    opts: {
      section: Note["section"];
      bassMode: "sparse" | "oompah" | "fsharpPedal" | "tutti";
      doubleOctaveVoice?: VoiceId;
      addDrums?: "light" | "driving" | "finale";
    },
  ) => {
    const mapBeat = advanceBeatMap(totalBeats, bpmStart, bpmEnd);

    for (const s of steps) {
      const { time, secPerBeat } = mapBeat(s.beat);
      const u = s.beat / totalBeats;
      const vel = velStart + (velEnd - velStart) * u;
      const dur = Math.max(0.12, s.durBeats * secPerBeat);

      notes.push({
        time,
        duration: dur,
        midi: rootMidi + s.semi,
        velocity: Math.min(1, vel),
        voice: leadVoice,
        section: opts.section,
      });

      if (opts.doubleOctaveVoice) {
        notes.push({
          time: time + 0.004,
          duration: dur * 0.95,
          midi: rootMidi + 12 + s.semi,
          velocity: Math.min(1, vel * 0.82),
          voice: opts.doubleOctaveVoice,
          section: opts.section,
        });
      }
    }

    // Bass & harmonic accompaniment
    const bars = Math.round(totalBeats / 4);
    for (let bar = 0; bar < bars; bar++) {
      for (let b = 0; b < 4; b++) {
        const beat = bar * 4 + b;
        const { time, secPerBeat } = mapBeat(beat);
        const u = beat / totalBeats;
        const vel = (velStart + (velEnd - velStart) * u) * 0.82;

        if (opts.bassMode === "sparse") {
          if (b === 0 || b === 2) {
            const isD = bar === 3 && steps === PHRASE_A_TO_A;
            const bassMidi = isD ? (b === 0 ? 38 : 45) : b === 0 ? 35 : 42; // B1 / F#2 or D2 / A2
            notes.push({
              time,
              duration: secPerBeat * 0.55,
              midi: bassMidi,
              velocity: vel * 0.85,
              voice: "pizzicato",
              section: opts.section,
            });
          }
        } else if (opts.bassMode === "fsharpPedal") {
          const midi = b % 2 === 0 ? 42 : 49; // F#2 - C#3 alternating fifths
          notes.push({
            time,
            duration: secPerBeat * 0.55,
            midi,
            velocity: vel * 0.86,
            voice: "bass",
            section: opts.section,
          });
          if (b === 1 || b === 3) {
            notes.push({
              time,
              duration: secPerBeat * 0.45,
              midi: 58, // A#3 horn third
              velocity: vel * 0.68,
              voice: "harmony",
              section: opts.section,
            });
          }
        } else if (opts.bassMode === "oompah" || opts.bassMode === "tutti") {
          const isD = bar === 3 && steps === PHRASE_A_TO_A;
          if (b % 2 === 0) {
            notes.push({
              time,
              duration: secPerBeat * 0.58,
              midi: isD ? 38 : 35, // D2 or B1
              velocity: Math.min(1, vel * (opts.bassMode === "tutti" ? 0.96 : 0.85)),
              voice: "bass",
              section: opts.section,
            });
          } else {
            // Off-beat chord stab
            const chordMidis =
              bar === 1
                ? b === 1
                  ? [53, 59] // F3 + B3 chromatic tension
                  : [52, 60] // E3 + C4
                : isD
                  ? [50, 57] // D3 + A3
                  : [54, 59]; // F#3 + B3
            for (const cm of chordMidis) {
              notes.push({
                time,
                duration: secPerBeat * 0.44,
                midi: cm,
                velocity: vel * 0.72,
                voice: opts.bassMode === "tutti" ? "brass" : "harmony",
                section: opts.section,
              });
            }
          }
        }

        // Light orchestral/cinematic percussion
        if (opts.addDrums) {
          const dVel = opts.addDrums === "finale" ? 0.85 : opts.addDrums === "driving" ? 0.62 : 0.42;
          if (b === 0 || b === 2) {
            drums.push({ time, kind: "kick", velocity: dVel });
          } else {
            drums.push({
              time,
              kind: opts.addDrums === "light" ? "hat" : "snare",
              velocity: dVel * 0.78,
              pan: 0.12,
            });
          }
          if (opts.addDrums !== "light") {
            const off = mapBeat(beat + 0.5);
            drums.push({
              time: off.time,
              kind: "hat",
              velocity: dVel * 0.55,
              pan: -0.18,
            });
          }
        }
      }
    }
  };

  // --- PASS 1: Stealthy Pizzicato & Low Woodwinds (0.34s -> ~16.0s, 112 -> 128 BPM) ---
  // Hook + Theme A1 (B3 tonic = 59)
  addPhrase(PHRASE_A_TO_A, 16, 112, 120, 47, "pizzicato", 0.48, 0.58, {
    section: "hook",
    bassMode: "sparse",
  });
  // Consequent A2 resolving to B3 (with woodwind lead doubling octave B3=59)
  addPhrase(PHRASE_A_TO_B, 16, 120, 130, 59, "lead", 0.56, 0.66, {
    section: "theme",
    bassMode: "oompah",
    addDrums: "light",
  });

  // --- PASS 2: F# Major Middle Section B + Rising Build (~16.0s -> ~28.8s, 132 -> 158 BPM) ---
  const PHRASE_B_FULL: PhraseStep[] = [
    ...PHRASE_B_HALF,
    ...PHRASE_B_HALF.map((s) => ({ ...s, beat: s.beat + 8 })),
  ];
  addPhrase(PHRASE_B_FULL, 16, 132, 146, 59, "lead", 0.65, 0.76, {
    section: "build",
    bassMode: "fsharpPedal",
    addDrums: "light",
  });

  // Rising orchestral brass A3 build (148 -> 168 BPM)
  addPhrase(PHRASE_A_TO_A, 16, 148, 168, 59, "brass", 0.74, 0.86, {
    section: "build",
    bassMode: "oompah",
    doubleOctaveVoice: "lead",
    addDrums: "driving",
  });

  // --- RISER + HALF-BAR PRE-PAYOFF PAUSE (~33.2s -> ~34.9s, ~72% mark!) ---
  const riserStart = cursorSec + 0.05;
  // Dramatic rising F# dominant pedal roll before sudden half-bar breath!
  for (let k = 0; k < 4; k++) {
    const tRoll = cursorSec + k * 0.22;
    notes.push({
      time: tRoll,
      duration: 0.18,
      midi: 54 + k * 3, // F#3 -> A3 -> C4 -> D#4 diminished tension climb!
      velocity: 0.68 + k * 0.07,
      voice: "brass",
      section: "pause",
    });
    drums.push({ time: tRoll, kind: "snare", velocity: 0.55 + k * 0.1 });
  }
  const pauseStart = cursorSec + 0.92;
  const pauseEnd = pauseStart + 0.72; // ~half-bar dramatic breath of near silence while rockets streak up!
  cursorSec = pauseEnd;

  const risers: RiserCue[] = [
    {
      startTime: riserStart,
      endTime: pauseEnd - 0.12,
      startMidi: 54,
      endMidi: 78,
      gain: 0.14,
    },
  ];

  // --- PAYOFF & PRESTO FINALE (~34.9s -> ~45.4s, 174 -> 196 BPM, ~73% to 95%!) ---
  addPhrase(PHRASE_A_TO_B, 16, 174, 192, 59, "brass", 0.86, 0.98, {
    section: "payoff",
    bassMode: "tutti",
    doubleOctaveVoice: "bell",
    addDrums: "finale",
  });

  // Iconic Grieg Finale Coda: rapid ascending B-minor scale run + crashing sforzando chords!
  const codaScale = [59, 61, 62, 64, 66, 68, 70, 71]; // B3 melodic minor run to B4!
  for (let i = 0; i < codaScale.length; i++) {
    const tRun = cursorSec + i * 0.135;
    notes.push({
      time: tRun,
      duration: 0.14,
      midi: codaScale[i],
      velocity: 0.82 + i * 0.022,
      voice: "brass",
      section: "payoff",
    });
    if (i % 2 === 0) {
      drums.push({ time: tRun, kind: "snare", velocity: 0.72 });
    }
  }
  cursorSec += codaScale.length * 0.135 + 0.08;

  // Three punctuated orchestral hits (F#7 -> Bm -> HUGE GRAND FINALE Bm CHORD!)
  const hit1Time = cursorSec;
  for (const m of [42, 54, 66, 70, 73]) {
    // F# major dominant hit
    notes.push({
      time: hit1Time,
      duration: 0.36,
      midi: m,
      velocity: 0.92,
      voice: m < 55 ? "bass" : "brass",
      section: "payoff",
    });
  }
  drums.push({ time: hit1Time, kind: "kick", velocity: 0.92 });
  drums.push({ time: hit1Time, kind: "openHat", velocity: 0.8 });

  const hit2Time = hit1Time + 0.46;
  for (const m of [35, 47, 59, 62, 66, 71]) {
    notes.push({
      time: hit2Time,
      duration: 0.38,
      midi: m,
      velocity: 0.95,
      voice: m < 50 ? "bass" : "brass",
      section: "payoff",
    });
  }
  drums.push({ time: hit2Time, kind: "kick", velocity: 0.95 });
  drums.push({ time: hit2Time, kind: "snare", velocity: 0.88 });

  // GRAND FINALE CHORD BURST (~43.2s)
  const grandChordTime = hit2Time + 0.52;
  const grandMidis = [35, 47, 54, 59, 62, 66, 71, 74, 83]; // Full 4-octave B minor orchestra + bells!
  grandMidis.forEach((m, idx) => {
    notes.push({
      time: grandChordTime + idx * 0.008,
      duration: 1.85,
      midi: m,
      velocity: 1.0,
      voice: m < 50 ? "bass" : m >= 71 ? "bell" : "brass",
      section: "payoff",
    });
  });
  drums.push({ time: grandChordTime, kind: "kick", velocity: 1.0 });
  drums.push({ time: grandChordTime, kind: "snare", velocity: 0.95 });
  drums.push({ time: grandChordTime, kind: "openHat", velocity: 0.9 });

  // --- SEAMLESS LOOP BRIDGE (~44.6s -> 47.7s -> wraps cleanly into 0.34s B-minor opening!) ---
  // Stealthy pizzicato walkdown from high B back to low F#2 -> B1/F#2 pickup so loop joins seamlessly!
  const loopBridgeNotes: readonly { dt: number; midi: number; vel: number }[] = [
    { dt: 1.35, midi: 71, vel: 0.62 },
    { dt: 1.95, midi: 66, vel: 0.56 },
    { dt: 2.5, midi: 59, vel: 0.52 },
    { dt: 3.05, midi: 54, vel: 0.48 },
    { dt: 3.55, midi: 47, vel: 0.46 },
    { dt: 4.02, midi: 42, vel: 0.45 }, // Dominant F#2 pickup right before loop returns to B!
  ];
  for (const bn of loopBridgeNotes) {
    const t = grandChordTime + bn.dt;
    if (t < FIREWORK_DURATION_SEC - 0.22) {
      notes.push({
        time: t,
        duration: 0.38,
        midi: bn.midi,
        velocity: bn.vel,
        voice: "pizzicato",
        section: "loop",
      });
    }
  }

  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
  drums.sort((a, b) => a.time - b.time);

  // Subtle nocturnal B1/F#2 ambient pedal across loop (dips during dramatic pause!)
  const drones: DroneSegment[] = [
    {
      startTime: 0,
      endTime: pauseStart - 0.04,
      midi: 35, // B1
      gain: 0.032,
      withFifth: true,
    },
    {
      startTime: pauseEnd,
      endTime: FIREWORK_DURATION_SEC,
      midi: 35, // B1
      gain: 0.036,
      withFifth: true,
    },
  ];

  cachedScore = {
    id: "MusicFireworkKing",
    slug: "music-firework-king",
    title: "In the Hall of the Mountain King",
    subtitle: "Edvard Grieg · Op. 46 No. 4",
    durationSec: FIREWORK_DURATION_SEC,
    totalFrames: FIREWORK_TOTAL_FRAMES,
    notes,
    drums,
    drones,
    risers,
  };
  return cachedScore;
}
