import { VIDEO } from "../settings.ts";
import {
  clamp,
  createRng,
  lerp,
  MUSIC_STAGE,
  type PieceScore,
  type VisualNoteEvent,
  type VoiceId,
} from "../music/types.ts";
import { buildFireworkMountainKingScore } from "./score.ts";

export interface SparkSpec {
  readonly angle: number;
  readonly speed: number;
  readonly size: number;
  readonly colorShift: number;
  readonly decay: number;
}

export interface FireworkRocket {
  readonly noteIndex: number;
  readonly launchTime: number;
  readonly burstTime: number;
  readonly burstFrame: number;
  readonly xLaunch: number;
  readonly xBurst: number;
  readonly yLaunch: number;
  readonly yBurst: number;
  readonly midi: number;
  readonly velocity: number;
  readonly voice: VoiceId;
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly isFinale: boolean;
  readonly sparks: readonly SparkSpec[];
}

export interface FireworkSimulation {
  readonly score: PieceScore;
  readonly midiMin: number;
  readonly midiMax: number;
  readonly rockets: readonly FireworkRocket[];
  readonly visualEvents: readonly VisualNoteEvent[];
  readonly grandFinaleTime: number;
}

const VOICE_PALETTE: Record<VoiceId, readonly [string, string]> = {
  pizzicato: ["#38bdf8", "#a78bfa"], // icy Nordic cyan + violet
  lead: ["#fbbf24", "#fb7185"], // warm amber gold + coral rose
  brass: ["#f97316", "#fde047"], // blazing orange + solar gold
  bell: ["#fef08a", "#67e8f9"], // starlight gold + diamond cyan
  bass: ["#a855f7", "#ec4899"], // deep royal magenta +orchid
  harmony: ["#34d399", "#60a5fa"], // aurora emerald + sky blue
  arp: ["#67e8f9", "#c084fc"],
  tar: ["#f59e0b", "#ef4444"],
  kamancha: ["#fb7185", "#fde047"],
  chime: ["#38bdf8", "#fde047"],
};

let cachedSim: FireworkSimulation | null = null;

export function simulateFireworkMountainKing(): FireworkSimulation {
  if (cachedSim) return cachedSim;

  const score = buildFireworkMountainKingScore();
  let midiMin = 127;
  let midiMax = 0;
  for (const n of score.notes) {
    if (n.midi < midiMin) midiMin = n.midi;
    if (n.midi > midiMax) midiMax = n.midi;
  }

  const xLeft = MUSIC_STAGE.left + 48; // 102
  const xRight = MUSIC_STAGE.right - 48; // 978 -> symmetric around 540!
  const yLaunch = 1548;

  // Detect the grand finale chord cluster (highest note density + max velocity near end)
  let grandFinaleTime = score.durationSec * 0.85;
  for (const n of score.notes) {
    if (n.section === "payoff" && n.velocity >= 0.99) {
      grandFinaleTime = n.time;
      break;
    }
  }

  const rockets: FireworkRocket[] = [];
  const visualEvents: VisualNoteEvent[] = [];

  for (let i = 0; i < score.notes.length; i++) {
    const n = score.notes[i];
    const rng = createRng(((i + 1) * 2654435761 + n.midi * 131) >>> 0);
    const pitchNorm = (n.midi - midiMin) / Math.max(1, midiMax - midiMin);
    const xBase = lerp(xLeft, xRight, pitchNorm);
    const jitterX = (rng() - 0.5) * 18;
    const xLaunchPos = clamp(xBase, xLeft, xRight);
    const xBurstPos = clamp(xBase + jitterX, xLeft + 16, xRight - 16);

    // Velocity controls burst altitude: higher velocity -> higher in the sky
    const heightNorm = clamp((n.velocity - 0.35) / 0.65, 0.05, 1.0);
    const yBurstPos = lerp(1120, 430, heightNorm) + (rng() - 0.5) * 28;

    const flightDur = lerp(0.3, 0.48, heightNorm);
    // Allow wrap-around launch for opening notes if needed, handled cleanly in paint
    const launchTime = n.time - flightDur;
    const burstFrame = Math.min(
      score.totalFrames - 1,
      Math.max(0, Math.round(n.time * VIDEO.fps)),
    );

    const isFinale = Math.abs(n.time - grandFinaleTime) < 0.18;
    const sparkCount = isFinale
      ? 56
      : n.voice === "bass"
        ? 22
        : n.velocity > 0.8
          ? 36
          : 28;

    const sparks: SparkSpec[] = [];
    for (let s = 0; s < sparkCount; s++) {
      const baseAngle = (s / sparkCount) * Math.PI * 2 + (rng() - 0.5) * 0.18;
      const ringFactor =
        isFinale && s % 3 === 1 ? 0.62 : isFinale && s % 3 === 2 ? 0.36 : s % 2 === 1 ? 0.72 : 1.0;
      sparks.push({
        angle: baseAngle,
        speed:
          (isFinale ? 540 : lerp(225, 430, heightNorm)) *
          ringFactor *
          (0.86 + 0.28 * rng()),
        size: (isFinale ? 6.4 : lerp(3.6, 5.6, heightNorm)) * (0.85 + 0.3 * rng()),
        colorShift: rng(),
        decay: (isFinale ? 0.52 : 0.82) * (0.85 + 0.3 * rng()),
      });
    }

    const [c1, c2] = VOICE_PALETTE[n.voice];
    rockets.push({
      noteIndex: i,
      launchTime,
      burstTime: n.time,
      burstFrame,
      xLaunch: xLaunchPos,
      xBurst: xBurstPos,
      yLaunch,
      yBurst: yBurstPos,
      midi: n.midi,
      velocity: n.velocity,
      voice: n.voice,
      primaryColor: c1,
      secondaryColor: c2,
      isFinale,
      sparks,
    });

    visualEvents.push({
      noteIndex: i,
      frame: burstFrame,
      time: n.time,
      midi: n.midi,
      velocity: n.velocity,
      voice: n.voice,
    });
  }

  cachedSim = {
    score,
    midiMin,
    midiMax,
    rockets,
    visualEvents,
    grandFinaleTime,
  };
  return cachedSim;
}
