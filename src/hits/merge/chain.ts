/**
 * The CHAIN multiplier, as a pure function so it can be unit tested and shared by the simulation,
 * the audio schedule and the painter.
 *
 * - A merge within `CHAIN_LINK_SEC` of the previous merge raises the chain count by one (when it is linked to it).
 * - Any later or unlinked merge starts a new chain at 1.
 * - The chain is live (shown in the HUD) until `CHAIN_RESET_SEC` passes without a merge, then it resets to 0.
 */

export const CHAIN_LINK_SEC = 0.6;
export const CHAIN_RESET_SEC = 0.9;

/** Times come from 240 Hz substeps, so gaps can differ from the window by float noise; this keeps the edges exact. */
const EDGE = 1e-9;

export interface ChainState {
  readonly count: number;
  readonly lastT: number;
}

export const CHAIN_IDLE: ChainState = { count: 0, lastT: Number.NEGATIVE_INFINITY };

/**
 * State after a merge at time `t` (seconds). `linked` is false when the merge did not come from the previous
 * ones (a piece that no recent merge made); the simulation passes it so that only merges that trigger each
 * other build a chain. With the default `true` the rule is purely about time.
 */
export function chainOnMerge(prev: ChainState, t: number, linked = true): ChainState {
  if (linked && prev.count > 0 && t - prev.lastT <= CHAIN_LINK_SEC + EDGE) return { count: prev.count + 1, lastT: t };
  return { count: 1, lastT: t };
}

/** The chain count that is live at time `t`: 0 once `CHAIN_RESET_SEC` has passed since the last merge. */
export function chainLive(state: ChainState, t: number): number {
  return state.count > 0 && t - state.lastT < CHAIN_RESET_SEC - EDGE ? state.count : 0;
}
