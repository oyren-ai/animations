import { clamp } from "../music/types.ts";

/**
 * Traditional Azerbaijani natural carpet dye palette:
 * - Madder red (boyaqotu), deep indigo (surmeyi), ivory wool, weld ochre, pomegranate-indigo green.
 * Pure geometric & botanical (buta / gol) textile ornament; no flags, maps, or political symbols.
 */
export const CARPET_DYES = {
  madder: "#ad1f24",
  madderBright: "#d63638",
  indigo: "#162955",
  indigoDeep: "#0e1b3a",
  ivory: "#f5ecd7",
  ochre: "#db9b27",
  ochreBright: "#f4be44",
  green: "#1c613e",
  greenBright: "#2a8457",
  walnutWarp: "#dfd3b8",
} as const;

export type DyeName =
  | "madder"
  | "indigo"
  | "ivory"
  | "ochre"
  | "green";

export const CARPET_COLS = 72;
export const CARPET_ROWS = 80;

export interface CarpetCell {
  readonly col: number;
  readonly row: number;
  readonly dye: DyeName;
  readonly hex: string;
  readonly brightHex: string;
  /** Normalized radial distance from carpet centre (1 at outer border -> 0 at heart of medallion) */
  readonly edgeToCenterOrder: number;
  readonly isMedallion: boolean;
  readonly isButa: boolean;
}

const DYE_HEX: Record<DyeName, readonly [string, string]> = {
  madder: [CARPET_DYES.madder, CARPET_DYES.madderBright],
  indigo: [CARPET_DYES.indigo, "#294c96"],
  ivory: [CARPET_DYES.ivory, "#fffdf5"],
  ochre: [CARPET_DYES.ochre, CARPET_DYES.ochreBright],
  green: [CARPET_DYES.green, CARPET_DYES.greenBright],
};

/**
 * Evaluates a traditional hooked/curved Azerbaijani "buta" (paisley almond) motif
 * in local quadrant coordinates (bx, by) roughly in [-1, 1].
 */
function sampleButaMotif(bx: number, by: number): DyeName | null {
  // Classic Azerbaijani curved teardrop paisley ("buta") with distinct curled apex hook!
  // Upper half curves inward toward the central medallion (bx < 0)
  const t = clamp((0.88 - by) / 1.82, 0, 1); // 0 at round bottom, 1 at hooked tip
  const spineX = -0.34 * Math.pow(t, 2.3) + 0.12 * Math.sin(t * Math.PI);
  // Curled tip hook at very top (t > 0.82)
  if (t > 0.82) {
    const hu = (t - 0.82) / 0.18;
    const hx = spineX + 0.24 * hu * hu;
    const hr = 0.16 * (1 - 0.45 * hu);
    const hd = Math.hypot(bx - hx, (by - (0.88 - 1.82 * t)) * 0.85);
    if (hd <= hr) return hd > hr * 0.55 ? "ivory" : "ochre";
  }
  const radius = 0.62 * Math.sin(Math.pow(t, 0.72) * Math.PI) * (1 - 0.18 * t);
  if (t <= 0.01 || t >= 0.96 || radius <= 0.05) return null;
  const d = Math.abs(bx - spineX) / radius;
  if (d > 1.0) return null;
  if (d > 0.78) return "ivory"; // crisp stepped ivory outline
  if (d > 0.56) return "ochre";
  if (d > 0.32) return "green";
  return "indigo";
}

let cachedGrid: readonly CarpetCell[] | null = null;

export function buildCarpetPatternGrid(): readonly CarpetCell[] {
  if (cachedGrid) return cachedGrid;

  const cells: CarpetCell[] = [];

  for (let row = 0; row < CARPET_ROWS; row++) {
    // Symmetric integer grid coordinates from centre
    const symColDistMax = CARPET_COLS / 2 - 0.5;
    const symRowDistMax = CARPET_ROWS / 2 - 0.5;
    const ny = (row - symRowDistMax) / symRowDistMax; // [-1, 1]
    const ay = Math.abs(ny);
    const iy = Math.floor(Math.abs(row - symRowDistMax));

    for (let col = 0; col < CARPET_COLS; col++) {
      const nx = (col - symColDistMax) / symColDistMax; // [-1, 1]
      const ax = Math.abs(nx);
      const ix = Math.floor(Math.abs(col - symColDistMax));

      const borderCoord = Math.max(ax, ay);
      const diamondDist = ax * 0.95 + ay * 1.12;
      const octDist = Math.max(ax * 0.96, ay * 1.08, (ax + ay) * 0.72);

      let dye: DyeName = "madder";
      let isMedallion = false;
      let isButa = false;

      // 1. Outer Indigo Guard Stripe (su)
      if (ax > 0.92 || ay > 0.93) {
        dye = (col + row) % 3 === 0 ? "ivory" : "indigo";
      }
      // 2. Inner Guard Reciprocal Sawtooth
      else if (
        (ax > 0.87 && ax <= 0.92) ||
        (ay > 0.89 && ay <= 0.93) ||
        (ax > 0.69 && ax <= 0.74 && ay <= 0.89) ||
        (ay > 0.75 && ay <= 0.79 && ax <= 0.87)
      ) {
        dye = (ix + iy) % 2 === 0 ? "ochre" : "green";
      }
      // 3. Main Stepped Geometric Rosette Border (ana hasiye)
      else if (ax > 0.74 || ay > 0.79) {
        const rx = col % 8;
        const ry = row % 8;
        const dx = Math.abs(rx - 3.5);
        const dy = Math.abs(ry - 3.5);
        const manh = dx + dy;
        if (manh < 1.5) {
          dye = ((Math.floor(col / 8) + Math.floor(row / 8)) % 2 === 0) ? "ochre" : "green";
        } else if (manh < 2.8) {
          dye = "madder";
        } else if (dx < 1.2 || dy < 1.2) {
          dye = "indigo";
        } else {
          dye = "ivory";
        }
      }
      // 4. Stepped Central Medallion (gol / xonca) around (0, 0)
      else if (octDist < 0.43) {
        isMedallion = true;
        if (octDist < 0.08) {
          dye = "ivory";
        } else if (octDist < 0.16) {
          dye = "ochre";
        } else if (octDist < 0.25) {
          dye = ix === iy || ix < 2 || iy < 2 ? "madder" : "green";
        } else if (octDist < 0.36) {
          // 8-pointed star petals inside indigo medallion
          const star = Math.abs(ix - iy) <= 2 || ix <= 2 || iy <= 2;
          dye = star ? "ochre" : "indigo";
        } else {
          // Stepped ivory latch-hook medallion frame
          dye = (ix + iy) % 2 === 0 ? "ivory" : "indigo";
        }
      }
      // 5. Top & Bottom Pendant Palmettes (ketebe / basliq) along x = 0 axis
      else if (ax < 0.16 && ay >= 0.45 && ay <= 0.68) {
        isMedallion = true;
        const py = (ay - 0.565) / 0.115;
        const px = ax / 0.16;
        if (px + Math.abs(py) < 0.55) dye = "ochre";
        else if (px + Math.abs(py) < 0.92) dye = "indigo";
        else dye = "ivory";
      }
      // 6. Corner Stepped Spandrels (lecek)
      else if (ax + ay > 1.18) {
        if (Math.abs(ax + ay - 1.21) < 0.035) {
          dye = "ivory";
        } else if ((ix + iy) % 4 === 0) {
          dye = "ochre";
        } else {
          dye = (ix % 3 === 0 && iy % 3 === 0) ? "madder" : "green";
        }
      }
      // 7. Symmetric Quadrant Buta (Paisley) Motifs on Madder Red Field
      else {
        const qx = (ax - 0.42) / 0.19;
        const qy = (ay - 0.44) / 0.19;
        const butaDye = sampleButaMotif(qx, qy);
        if (butaDye !== null) {
          isButa = true;
          dye = butaDye;
        } else {
          // Rich madder field with delicate symmetric star blossoms
          const blossom =
            (Math.abs(ax - 0.48) < 0.045 && ay < 0.11) ||
            (ax < 0.07 && Math.abs(ay - 0.38) < 0.035);
          if (blossom) {
            dye = (ix + iy) % 2 === 0 ? "ivory" : "ochre";
          } else {
            dye = diamondDist > 0.44 && diamondDist < 0.465 ? "ivory" : "madder";
          }
        }
      }

      // Edge-to-centre growth metric: 0 = outermost border (weaves first), 1 = very heart of medallion (lights up at climax!)
      const edgeToCenterOrder = clamp(1 - borderCoord * 0.62 - octDist * 0.42, 0, 1);
      const [hex, brightHex] = DYE_HEX[dye];

      cells.push({
        col,
        row,
        dye,
        hex,
        brightHex,
        edgeToCenterOrder,
        isMedallion,
        isButa,
      });
    }
  }

  cachedGrid = cells;
  return cachedGrid;
}
