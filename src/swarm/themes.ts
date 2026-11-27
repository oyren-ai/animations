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
  | "hexagon"
  | "fire"
  | "water"
  | "leaf"
  | "king"
  | "queen"
  | "rook"
  | "bishop"
  | "knight"
  | "sword"
  | "axe"
  | "spear"
  | "sun"
  | "moon"
  | "planet"
  | "rocket"
  | "ufo";

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

export type SwarmSlug =
  | "swarm-rps-classic"
  | "swarm-five-rivals"
  | "swarm-elements"
  | "swarm-chess"
  | "swarm-weapons"
  | "swarm-cosmos";

export interface SwarmDefinition {
  slug: SwarmSlug;
  /** Remotion composition id. */
  id: string;
  label: string;
  /** Optional slim workspace title-bar label (`oyren / arena · ...`). */
  windowLabel?: string;
  /** Root of the tension bed in Hz. */
  rootHz: number;
  skin: SwarmSkin;
  config: SwarmConfig;
  /** What the chosen seed had to deliver (see `scripts/search-swarm-seed.ts`). */
  arc: SwarmArcCriteria;
}

const CLASSIC_SKIN: SwarmSkin = {
  title: "WHO WINS?",
  rules: "rock crushes scissors · scissors cut paper · paper covers rock",
  types: [
    { name: "rock", caption: "ROCK", color: "#64b5e5", icon: "rock", sound: "tok" },
    { name: "paper", caption: "PAPER", color: "#eef6fc", icon: "paper", sound: "fwip" },
    { name: "scissors", caption: "SCISSORS", color: "#c8ff00", icon: "scissors", sound: "snip" },
  ],
};

const FIVE_RIVALS_SKIN: SwarmSkin = {
  title: "WHO WINS?",
  rules: "every shape beats two rivals and loses to two others",
  types: [
    { name: "circle", caption: "CIRCLE", color: "#c8ff00", icon: "circle", sound: "bloop" },
    { name: "triangle", caption: "TRIANGLE", color: "#4db8ff", icon: "triangle", sound: "ting" },
    { name: "square", caption: "SQUARE", color: "#eef6fc", icon: "square", sound: "blip" },
    { name: "star", caption: "STAR", color: "#a86eff", icon: "star", sound: "twinkle" },
    { name: "hexagon", caption: "HEXAGON", color: "#ff7a59", icon: "hexagon", sound: "knock" },
  ],
};

const ELEMENTS_SKIN: SwarmSkin = {
  title: "WHO WINS?",
  rules: "fire burns leaf · leaf drinks water · water douses fire",
  types: [
    { name: "fire", caption: "FIRE", color: "#ff6b35", icon: "fire", sound: "twinkle" },
    { name: "water", caption: "WATER", color: "#38bdf8", icon: "water", sound: "bloop" },
    { name: "leaf", caption: "LEAF", color: "#c8ff00", icon: "leaf", sound: "fwip" },
  ],
};

const CHESS_SKIN: SwarmSkin = {
  title: "WHO WINS?",
  rules: "every piece takes two rivals and falls to two others",
  types: [
    { name: "king", caption: "KING", color: "#c8ff00", icon: "king", sound: "tok" },
    { name: "queen", caption: "QUEEN", color: "#ff7a59", icon: "queen", sound: "twinkle" },
    { name: "rook", caption: "ROOK", color: "#4db8ff", icon: "rook", sound: "knock" },
    { name: "bishop", caption: "BISHOP", color: "#a86eff", icon: "bishop", sound: "ting" },
    { name: "knight", caption: "KNIGHT", color: "#eef6fc", icon: "knight", sound: "bloop" },
  ],
};

const WEAPONS_SKIN: SwarmSkin = {
  title: "WHO WINS?",
  rules: "sword beats axe · axe breaks spear · spear beats sword",
  types: [
    { name: "sword", caption: "SWORD", color: "#c8ff00", icon: "sword", sound: "snip" },
    { name: "axe", caption: "AXE", color: "#ff6b35", icon: "axe", sound: "knock" },
    { name: "spear", caption: "SPEAR", color: "#38bdf8", icon: "spear", sound: "ting" },
  ],
};

const COSMOS_SKIN: SwarmSkin = {
  title: "WHO WINS?",
  rules: "every rival takes two others and falls to two",
  types: [
    { name: "sun", caption: "SUN", color: "#fbbf24", icon: "sun", sound: "twinkle" },
    { name: "moon", caption: "MOON", color: "#eef6fc", icon: "moon", sound: "ting" },
    { name: "planet", caption: "PLANET", color: "#a86eff", icon: "planet", sound: "bloop" },
    { name: "rocket", caption: "ROCKET", color: "#ff7a59", icon: "rocket", sound: "tok" },
    { name: "ufo", caption: "UFO", color: "#c8ff00", icon: "ufo", sound: "blip" },
  ],
};

/** rock(0) beats scissors(2), paper(1) beats rock(0), scissors(2) beat paper(1). */
const CLASSIC_RULES = [
  [0, 0, 1],
  [1, 0, 0],
  [0, 1, 0],
];

/** sword(0) beats axe(1), axe(1) breaks spear(2), spear(2) beats sword(0). */
const WEAPONS_RULES = [
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 0],
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
      // Picked with scripts/search-swarm-seed.ts (36 of 1000 seeds qualify): 7 lead changes, scissors drops to 2/180 at 20.9 s and wins at 33.0 s.
      seed: 76,
      count: 180,
      types: 3,
      rules: CLASSIC_RULES,
      radius: 25.5,
      arena: SWARM_ARENA,
      physics: { ...DEFAULT_SWARM_PHYSICS, speed: 64, chaseBoost: 0.16 },
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
      // Picked with scripts/search-swarm-seed.ts (92 of 1000 seeds qualify): 10 lead changes, hexagon drops to 1/160 at 21.7 s and wins at 34.2 s.
      seed: 479,
      count: 160,
      types: 5,
      rules: cyclicRules(5, 2),
      radius: 24.0,
      arena: SWARM_ARENA,
      physics: { ...DEFAULT_SWARM_PHYSICS, speed: 74, chaseBoost: 0.18, sight: 145 },
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
  {
    slug: "swarm-elements",
    id: "SwarmElements",
    label: "Fire Water Leaf",
    windowLabel: "oyren / arena · elements",
    rootHz: 130.81,
    skin: ELEMENTS_SKIN,
    config: {
      id: "swarm-elements",
      // Picked with scripts/search-swarm-seed.ts over 1001..2200 (47 of 1200 qualify): 8 lead changes, fire drops to 1/180 at 25.0 s and wins at 34.7 s.
      seed: 1881,
      count: 180,
      types: 3,
      rules: CLASSIC_RULES,
      radius: 25.5,
      arena: SWARM_ARENA,
      physics: { ...DEFAULT_SWARM_PHYSICS, speed: 66, chaseBoost: 0.17 },
      maxPlayFrames: 52 * 60,
      holdFrames: SWARM_HOLD_FRAMES,
    },
    arc: {
      minWinSeconds: 32,
      maxWinSeconds: 38,
      targetWinSeconds: 35,
      minLeadChanges: 4,
      maxLeadChanges: 12,
      maxComebackShare: 0.15,
    },
  },
  {
    slug: "swarm-chess",
    id: "SwarmChess",
    label: "Chess Rivals",
    windowLabel: "oyren / arena · chess",
    rootHz: 123.47,
    skin: CHESS_SKIN,
    config: {
      id: "swarm-chess",
      // Picked with scripts/search-swarm-seed.ts over 1001..1500: 7 lead changes, king drops to 1/160 at 16.0 s, first contact at 1.48 s, and wins at 36.4 s.
      seed: 1206,
      count: 160,
      types: 5,
      rules: cyclicRules(5, 2),
      radius: 24.0,
      arena: SWARM_ARENA,
      physics: { ...DEFAULT_SWARM_PHYSICS, speed: 75, chaseBoost: 0.18, sight: 146 },
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
  {
    slug: "swarm-weapons",
    id: "SwarmWeapons",
    label: "Sword Axe Spear",
    windowLabel: "oyren / arena · weapons",
    rootHz: 116.54,
    skin: WEAPONS_SKIN,
    config: {
      id: "swarm-weapons",
      // Picked over 2001..2900 (57 seeds qualify): 8 lead changes, spear drops to 1/180 (0.6%) at 23.8 s, first contact at 0.13 s, wins at 35.8 s.
      seed: 2550,
      count: 180,
      types: 3,
      rules: WEAPONS_RULES,
      radius: 25.5,
      arena: SWARM_ARENA,
      physics: { ...DEFAULT_SWARM_PHYSICS, speed: 67, chaseBoost: 0.17 },
      maxPlayFrames: 52 * 60,
      holdFrames: SWARM_HOLD_FRAMES,
    },
    arc: {
      minWinSeconds: 32,
      maxWinSeconds: 38,
      targetWinSeconds: 35,
      minLeadChanges: 4,
      maxLeadChanges: 12,
      maxComebackShare: 0.15,
    },
  },
  {
    slug: "swarm-cosmos",
    id: "SwarmCosmos",
    label: "Cosmos Rivals",
    windowLabel: "oyren / arena · cosmos",
    rootHz: 138.59,
    skin: COSMOS_SKIN,
    config: {
      id: "swarm-cosmos",
      // Picked over 2001..2900 (33 seeds qualify): 10 lead changes, moon drops to 1/160 (0.6%) at 21.5 s, first contact at 1.47 s, wins at 35.5 s.
      seed: 2461,
      count: 160,
      types: 5,
      rules: cyclicRules(5, 2),
      radius: 24.0,
      arena: SWARM_ARENA,
      physics: { ...DEFAULT_SWARM_PHYSICS, speed: 76, chaseBoost: 0.18, sight: 147 },
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
