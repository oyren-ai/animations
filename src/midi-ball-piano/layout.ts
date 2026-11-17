/**
 * Keyboard geometry for the Ball Piano scene. Pure functions: the keyboard covers the piece's pitch range
 * (at least three octaves, at most about five, folding stray notes by octaves) inside the phone safe area.
 */

export const SAFE = { left: 60, right: 930, bottom: 1620 } as const;

/** Vertical placement of the keys (keyboard bottom stays above the 300 px bottom safe margin). */
export const KEY_TOP = 1366;
export const WHITE_HEIGHT = 250;
export const MIN_WHITE_KEYS = 22; // three octaves plus the closing key
export const MAX_WHITE_KEYS = 36;

const BLACK_CLASSES = [1, 3, 6, 8, 10];
export const isBlackKey = (pitch: number) => BLACK_CLASSES.includes(((pitch % 12) + 12) % 12);

/** Horizontal nudge of each black key from the boundary between its two white neighbours (fraction of a white key). */
const BLACK_OFFSET: Record<number, number> = { 1: -0.1, 3: 0.1, 6: -0.12, 8: 0, 10: 0.12 };

export interface KeyboardLayout {
  /** Lowest and highest MIDI pitch drawn; both are white keys. */
  lo: number;
  hi: number;
  whiteCount: number;
  keyWidth: number;
  left: number;
  right: number;
  top: number;
  whiteHeight: number;
  blackWidth: number;
  blackHeight: number;
  /** Shift a pitch by whole octaves into [lo, hi]. */
  fold: (pitch: number) => number;
  /** Centre x of the key for a pitch inside [lo, hi]. */
  keyCenterX: (pitch: number) => number;
  /** Left x and width of the drawn key rectangle for a pitch inside [lo, hi]. */
  keyRect: (pitch: number) => { x: number; width: number; height: number; black: boolean };
}

function nextWhiteUp(pitch: number): number { let p = pitch; while (isBlackKey(p)) p++; return p; }
function nextWhiteDown(pitch: number): number { let p = pitch; while (isBlackKey(p)) p--; return p; }
function countWhite(lo: number, hi: number): number {
  let count = 0;
  for (let p = lo; p <= hi; p++) if (!isBlackKey(p)) count++;
  return count;
}

export function planKeyboard(pitches: readonly number[]): KeyboardLayout {
  const sorted = [...pitches].sort((a, b) => a - b);
  let minPitch = sorted.length ? sorted[0] : 60, maxPitch = sorted.length ? sorted[sorted.length - 1] : 72;
  let lo = nextWhiteDown(minPitch), hi = nextWhiteUp(maxPitch);
  if (countWhite(lo, hi) > MAX_WHITE_KEYS && sorted.length > 4) { // use robust percentiles for very wide files
    minPitch = sorted[Math.floor(sorted.length * 0.02)];
    maxPitch = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.98))];
    lo = nextWhiteDown(minPitch); hi = nextWhiteUp(maxPitch);
  }
  while (countWhite(lo, hi) > MAX_WHITE_KEYS) { // still too wide: keep a window around the median
    const median = sorted.length ? sorted[sorted.length >> 1] : 66;
    if (median - lo > hi - median) lo = nextWhiteUp(lo + 1); else hi = nextWhiteDown(hi - 1);
  }
  let growUp = true;
  while (countWhite(lo, hi) < MIN_WHITE_KEYS) { // pad to at least three octaves, alternating up and down
    if ((growUp && hi < 108) || lo <= 21) hi = nextWhiteUp(hi + 1); else lo = nextWhiteDown(lo - 1);
    growUp = !growUp;
  }
  const whiteCount = countWhite(lo, hi);
  const keyWidth = Math.min(48, (SAFE.right - SAFE.left) / whiteCount);
  const width = keyWidth * whiteCount;
  const left = SAFE.left + (SAFE.right - SAFE.left - width) / 2;
  const whiteIndex = (pitch: number) => countWhite(lo, pitch - 1); // white keys strictly below this pitch
  const blackWidth = keyWidth * 0.62, blackHeight = WHITE_HEIGHT * 0.62;
  const fold = (pitch: number) => {
    let p = pitch;
    while (p < lo) p += 12;
    while (p > hi) p -= 12;
    return p;
  };
  const keyRect = (pitch: number) => {
    if (isBlackKey(pitch)) {
      const boundary = left + whiteIndex(pitch) * keyWidth; // left edge of the next white key
      const centre = boundary + (BLACK_OFFSET[((pitch % 12) + 12) % 12] ?? 0) * keyWidth;
      return { x: centre - blackWidth / 2, width: blackWidth, height: blackHeight, black: true };
    }
    return { x: left + whiteIndex(pitch) * keyWidth, width: keyWidth, height: WHITE_HEIGHT, black: false };
  };
  const keyCenterX = (pitch: number) => {
    const rect = keyRect(pitch);
    return rect.x + rect.width / 2;
  };
  return {
    lo, hi, whiteCount, keyWidth, left, right: left + width, top: KEY_TOP, whiteHeight: WHITE_HEIGHT,
    blackWidth, blackHeight, fold, keyCenterX, keyRect,
  };
}
