import { VIDEO } from "../settings.ts";
import {
  clamp,
  type DroneSegment,
  type DrumHit,
  type Note,
  type PieceScore,
  type RiserCue,
  type VoiceId,
} from "../music/types.ts";
import { SARI_GELIN_EVENTS, SARI_GELIN_TOTAL_SEC } from "./sariGelinData.ts";

export const CARPET_DURATION_SEC = SARI_GELIN_TOTAL_SEC; // 57.6 s
export const CARPET_TOTAL_FRAMES = Math.round(CARPET_DURATION_SEC * VIDEO.fps); // 3456 frames

let cachedCarpetScore: PieceScore | null = null;

export function buildCarpetLoomScore(): PieceScore {
  if (cachedCarpetScore) return cachedCarpetScore;

  const notes: Note[] = [];
  const drums: DrumHit[] = [];

  for (const ev of SARI_GELIN_EVENTS) {
    const vel = clamp(ev.velocity / 127, 0.12, 1.0);

    if (ev.track === "percussion") {
      const kind =
        ev.pitch === 64
          ? "frameDum"
          : ev.pitch === 54
            ? "hat"
            : "frameTak";
      drums.push({
        time: ev.timeSec,
        kind,
        velocity: vel * 0.88,
        pan: ev.pitch === 54 ? 0.22 : ev.pitch === 64 ? -0.06 : 0.12,
      });
      continue;
    }

    let voice: VoiceId;
    let pan: number | undefined;
    let dur = ev.durationSec;

    if (ev.track === "melody") {
      if (ev.timeSec < 12.6) {
        // Statement 1 Line 1: solo bowed kamancha
        voice = "kamancha";
        pan = 0.12;
      } else if (ev.timeSec < 25.2) {
        // Statement 1 "Bu sevda" phrase: plucked tar answered by kamancha
        voice = ev.timeSec < 18.0 ? "tar" : "kamancha";
        pan = voice === "tar" ? -0.14 : 0.14;
      } else {
        // Statement 2 (25.2s - 55.8s): upper octave on plucked tar, lower octave doubling on kamancha
        if (ev.pitch >= 74) {
          voice = "tar";
          pan = -0.16;
        } else {
          voice = "kamancha";
          pan = 0.18;
        }
      }
    } else {
      // Accompaniment track: root-fifth bass ostinato vs sustained chordal anchor plucks
      if (ev.pitch < 50) {
        voice = "bass";
        pan = -0.05;
      } else {
        voice = "tar";
        pan = -0.08;
        // Let sustained drone handle the 9s-12.6s hold while tar articulates the chord attack
        dur = Math.min(2.1, ev.durationSec);
      }
    }

    const section: Note["section"] =
      ev.timeSec < 3.6
        ? "hook"
        : ev.timeSec < 25.2
          ? "theme"
          : ev.timeSec < 43.2
            ? "build"
            : ev.timeSec < 55.8
              ? "payoff"
              : "loop";

    notes.push({
      time: ev.timeSec,
      duration: dur,
      midi: ev.pitch,
      velocity: vel,
      voice,
      pan,
      section,
    });
  }

  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
  drums.sort((a, b) => a.time - b.time);

  // Continuous D3 + A3 (D Sur tonic + fifth) warm drone across all 32 bars so 55.8-57.6s loops seamlessly into 0.0s
  const drones: DroneSegment[] = [
    {
      startTime: 0,
      endTime: CARPET_DURATION_SEC,
      midi: 50, // D3 (+ fifth A3 = 57)
      gain: 0.042,
      withFifth: true,
    },
  ];

  // Subtle risers into Statement 2 (25.2s) and into the climactic "amandır" / "sarı gəlin" payoff (43.2s / 50.4s)
  const risers: RiserCue[] = [
    {
      startTime: 23.6,
      endTime: 25.15,
      startMidi: 50,
      endMidi: 62,
      gain: 0.085,
    },
    {
      startTime: 49.0,
      endTime: 50.35,
      startMidi: 62,
      endMidi: 74,
      gain: 0.1,
    },
  ];

  cachedCarpetScore = {
    id: "MusicCarpetLoom",
    slug: "music-carpet-loom",
    title: "Sarı gəlin",
    subtitle: "Traditional Melody · D şur · Tar, Kamança & Qaval",
    durationSec: CARPET_DURATION_SEC,
    totalFrames: CARPET_TOTAL_FRAMES,
    notes,
    drums,
    drones,
    risers,
  };
  return cachedCarpetScore;
}
