import {
  cyclicRules,
  DEFAULT_SWARM_PHYSICS,
  simulateSwarm,
  SWARM_ARENA,
  SWARM_HOLD_FRAMES,
  type SwarmArcCriteria,
  type SwarmConfig,
  type SwarmTrace,
} from "./sim.ts";

/** Vector sprite drawn for a type (see `sprites.ts`). */
export type SwarmIcon =
  | "rock"
  | "paper"
  | "scissors"
  | "circle"
  | "triangle"
  | "square"
  | "star"
  | "hexagon";

/** Conversion timbre played when this type wins a contact (see `audio.ts`). */
export type SwarmSound = "tok" | "fwip" | "snip" | "bloop" | "ting" | "blip" | "twinkle" | "knock";

export interface SwarmTypeSkin {
  /** Lower-case name used in rules text. */
  name: string;
  /** Upper-case caption word: `${caption} WINS`. */
  caption: string;
  color: string;
  icon: SwarmIcon;
  sound: SwarmSound;
}

export interface SwarmSkin {
  title: string;
  rules: string;
  types: readonly SwarmTypeSkin[];
}

export type SwarmSlug = "swarm-rps-classic" | "swarm-five-rivals";

export interface SwarmDefinition {
  slug: SwarmSlug;
  /** Remotion composition id. */
  id: string;
  label: string;
  /** Root of the tension bed in Hz. */
  rootHz: number;
  skin: SwarmSkin;
  config: SwarmConfig;
  /** What the chosen seed had to deliver (see `scripts/search-swarm-seed.ts`). */
  arc: SwarmArcCriteria;
}

const CLASSIC_SKIN: SwarmSkin = {
  title: "WHO WINS?",
  rules: "rock beats scissors · scissors beat paper · paper beats rock",
  types: [
    { name: "rock", caption: "ROCK", color: "#a3acb8", icon: "rock", sound: "tok" },
    { name: "paper", caption: "PAPER", color: "#dbe9ff", icon: "paper", sound: "fwip" },
    { name: "scissors", caption: "SCISSORS", color: "#ff5348", icon: "scissors", sound: "snip" },
  ],
};

const FIVE_RIVALS_SKIN: SwarmSkin = {
  title: "WHO WINS?",
  rules: "every shape beats two rivals and loses to two others",
  types: [
    { name: "circle", caption: "CIRCLE", color: "#3da5ff", icon: "circle", sound: "bloop" },
    { name: "triangle", caption: "TRIANGLE", color: "#ffc933", icon: "triangle", sound: "ting" },
    { name: "square", caption: "SQUARE", color: "#ff4d7d", icon: "square", sound: "blip" },
    { name: "star", caption: "STAR", color: "#7ee05a", icon: "star", sound: "twinkle" },
    { name: "hexagon", caption: "HEXAGON", color: "#b07cff", icon: "hexagon", sound: "knock" },
  ],
};

/** rock(0) beats scissors(2), paper(1) beats rock(0), scissors(2) beat paper(1). */
const CLASSIC_RULES = [
  [0, 0, 1],
  [1, 0, 0],
  [0, 1, 0],
];

export const SWARM_DEFINITIONS: readonly SwarmDefinition[] = [
  {
    slug: "swarm-rps-classic",
    id: "SwarmRpsClassic",
    label: "Rock Paper Scissors",
    rootHz: 110,
    skin: CLASSIC_SKIN,
    config: {
      id: "swarm-rps-classic",
      // Picked with scripts/search-swarm-seed.ts (seeds 1..1000): rock falls to 2 of 180 sprites at 23 s and still wins at 35.1 s.
      seed: 726,
      count: 180,
      types: 3,
      rules: CLASSIC_RULES,
      radius: 27.5,
      arena: SWARM_ARENA,
      physics: { ...DEFAULT_SWARM_PHYSICS },
      maxPlayFrames: 52 * 60,
      holdFrames: SWARM_HOLD_FRAMES,
    },
    arc: {
      minWinSeconds: 32,
      maxWinSeconds: 38,
      targetWinSeconds: 35,
      minLeadChanges: 4,
      maxLeadChanges: 10,
      maxComebackShare: 0.15,
    },
  },
  {
    slug: "swarm-five-rivals",
    id: "SwarmFiveRivals",
    label: "Five Rivals",
    rootHz: 146.83,
    skin: FIVE_RIVALS_SKIN,
    config: {
      id: "swarm-five-rivals",
      // Picked with scripts/search-swarm-seed.ts (seeds 1..1000): the circle falls to 1 of 200 sprites at 22.6 s and still wins at 34.5 s.
      seed: 463,
      count: 200,
      types: 5,
      rules: cyclicRules(5, 2),
      radius: 26.5,
      arena: SWARM_ARENA,
      physics: { ...DEFAULT_SWARM_PHYSICS, speed: 50, sight: 125 },
      maxPlayFrames: 52 * 60,
      holdFrames: SWARM_HOLD_FRAMES,
    },
    arc: {
      minWinSeconds: 32,
      maxWinSeconds: 38,
      targetWinSeconds: 35,
      minLeadChanges: 4,
      maxLeadChanges: 16,
      maxComebackShare: 0.1,
    },
  },
];

export function getSwarmDefinition(slug: SwarmSlug): SwarmDefinition {
  const found = SWARM_DEFINITIONS.find((definition) => definition.slug === slug);
  if (!found) throw new Error(`Unknown swarm composition: ${slug}`);
  return found;
}

/** Whole-run trace for a composition (module-level cache lives in `simulateSwarm`). */
export function simulateSwarmDefinition(slug: SwarmSlug): SwarmTrace {
  return simulateSwarm(getSwarmDefinition(slug).config);
}

export function getSwarmTiming(slug: SwarmSlug): { totalFrames: number; winFrame: number; holdFrames: number } {
  const trace = simulateSwarmDefinition(slug);
  return { totalFrames: trace.totalFrames, winFrame: trace.winFrame, holdFrames: trace.config.holdFrames };
}
