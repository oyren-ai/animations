/**
 * The seven tiers of FunnelMerge. Only tier 1 ever drops from the tube; every higher tier is made by
 * two pieces of the tier below touching. Tier 7 is the final form and never merges again.
 * Colours run cool to warm (blue, teal, green, yellow, orange, rose) and end on the Oyren lime.
 */

export const TIER_COUNT = 7;

export interface TierInfo {
  readonly tier: number;
  /** Ladder and in-piece label. */
  readonly name: string;
  /** Physical and drawn radius in px. */
  readonly radius: number;
  /** Body colour. */
  readonly color: string;
  /** Rim and shade colour. */
  readonly dark: string;
  /** Highlight colour. */
  readonly light: string;
}

export const TIERS: readonly TierInfo[] = [
  { tier: 1, name: "bit", radius: 44, color: "#38bdf8", dark: "#0b4a6f", light: "#c4ecff" },
  { tier: 2, name: "byte", radius: 58, color: "#2dd4bf", dark: "#0f5f58", light: "#a6f7ea" },
  { tier: 3, name: "line", radius: 76, color: "#4ade80", dark: "#14632f", light: "#c5fbd8" },
  { tier: 4, name: "func", radius: 100, color: "#facc15", dark: "#85500c", light: "#fff0a0" },
  { tier: 5, name: "file", radius: 132, color: "#fb923c", dark: "#9a3410", light: "#ffd9b8" },
  { tier: 6, name: "repo", radius: 172, color: "#fb7185", dark: "#9f1239", light: "#ffd0d8" },
  { tier: 7, name: "agent", radius: 224, color: "#c8ff00", dark: "#4a7a00", light: "#f4ffc2" },
];

/** Text of the payoff banner, drawn in lime once the first tier-7 piece exists. */
export const FINAL_BANNER = "FINAL FORM: AGENT";

export function tierInfo(tier: number): TierInfo {
  return TIERS[Math.max(1, Math.min(TIER_COUNT, tier)) - 1];
}
