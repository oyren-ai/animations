import { GLASS_FLOORS_SETPIECE } from "./glass-floors.ts";
import { HEX_CHAIN_SETPIECE } from "./hex-chain.ts";
import type { SetPieceModule, SetPieceSpec } from "./types.ts";

export type SetPieceSlug = SetPieceSpec["slug"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SETPIECE_COMPOSITIONS: readonly SetPieceModule<any>[] = [
  GLASS_FLOORS_SETPIECE,
  HEX_CHAIN_SETPIECE,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSetPiece(slug: SetPieceSlug): SetPieceModule<any> {
  const found = SETPIECE_COMPOSITIONS.find((c) => c.spec.slug === slug);
  if (!found) throw new Error(`Unknown set piece: ${slug}`);
  return found;
}
