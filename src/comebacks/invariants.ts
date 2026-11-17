import { VIDEO } from "../settings.ts";
import { assertReelSafeBox, drawReelText, type ReelBox } from "../shared/reelUtils.ts";

export type ComebackSlug =
  | "tower-linear-vs-exponential"
  | "titan-hammer-vs-swarm"
  | "splitter-wall-escape"
  | "afterburner-lap-comeback";

export type ComebackSide = "left" | "right";

export interface ComebackEvent {
  frame: number;
  side: ComebackSide;
  kind: "stage-break" | "multiply" | "bounce-powerup" | "overtake" | "victory";
  stageIndex: number; // 0..9 or lap milestone
  intensity: number; // 0..1
  pitchStep: number; // ascending scale index
}

export interface ComebackTraceBase {
  slug: ComebackSlug;
  seed: number;
  fps: number;
  raceFrames: number;
  closingFrames: number;
  totalFrames: number;
  winner: ComebackSide;
  earlyLeader: ComebackSide;
  overtakeFrame: number;
  victoryFrame: number;
  /** Progress in [0, 1] per frame (length === raceFrames) */
  leftProgress: Float32Array;
  rightProgress: Float32Array;
  /** For 10-stage vaults/walls, remaining HP fraction [0, 1] of the final stage at victoryFrame; for laps, 1 - progress */
  runnerUpFinalStageRemainingRatio: number;
  events: ComebackEvent[];
}

export interface ComebackInvariantReport {
  slug: ComebackSlug;
  earlyCheckFrame: number;
  midRaceCheckFrame: number;
  earlyLeaderAtVictoryCheck: ComebackSide;
  earlyMarginAtVictoryCheck: number;
  earlyMarginAtMidRace: number;
  overtakeFrame: number;
  overtakeRatio: number;
  victoryFrame: number;
  victoryRatio: number;
  victoryHoldFrames: number;
  runnerUpProgressAtVictory: number;
  runnerUpFinalStageRemainingRatio: number;
}

/**
 * Enforces the three non-negotiable mathematical comeback invariants:
 * 1. earlyLeader !== winner: at t = 0.65 * victoryFrame (and 0.65 * raceFrames),
 *    the eventual loser leads by >= 0.50 progress margin.
 * 2. lateOvertake: both overtakeFrame and victoryFrame lie within [0.82 * raceFrames, 0.96 * raceFrames],
 *    leaving >= 60 frames (>= 1.0s) victory hold before the 3s closing card.
 * 3. photoFinish: at victoryFrame, runner-up has reached >= 0.90 of total goal
 *    (and for 10-stage races, final stage has < 0.15 remaining HP).
 */
export function verifyComebackInvariants(trace: ComebackTraceBase): ComebackInvariantReport {
  const { raceFrames, winner, earlyLeader, overtakeFrame, victoryFrame } = trace;
  if (raceFrames < 600) {
    throw new RangeError(`${trace.slug}: raceFrames=${raceFrames} too short`);
  }
  if (earlyLeader === winner) {
    throw new Error(`${trace.slug}: expected earlyLeader !== winner, got both=${winner}`);
  }

  const loserProgressArr = winner === "right" ? trace.leftProgress : trace.rightProgress;
  const winnerProgressArr = winner === "right" ? trace.rightProgress : trace.leftProgress;

  const earlyCheckFrame = Math.floor(0.65 * victoryFrame);
  const midRaceCheckFrame = Math.floor(0.65 * raceFrames);

  const loserEarly = loserProgressArr[earlyCheckFrame];
  const winnerEarly = winnerProgressArr[earlyCheckFrame];
  const earlyMarginAtVictoryCheck = loserEarly - winnerEarly;
  const earlyLeaderAtVictoryCheck: ComebackSide =
    trace.leftProgress[earlyCheckFrame] >= trace.rightProgress[earlyCheckFrame] ? "left" : "right";

  if (earlyLeaderAtVictoryCheck === winner || earlyMarginAtVictoryCheck < 0.5) {
    throw new Error(
      `${trace.slug}: failed early blowout invariant at frame ${earlyCheckFrame}: ` +
        `loser=${loserEarly.toFixed(3)}, winner=${winnerEarly.toFixed(3)}, margin=${earlyMarginAtVictoryCheck.toFixed(3)} (< 0.50)`,
    );
  }

  const earlyMarginAtMidRace =
    loserProgressArr[midRaceCheckFrame] - winnerProgressArr[midRaceCheckFrame];
  if (earlyMarginAtMidRace < 0.5) {
    throw new Error(
      `${trace.slug}: failed 0.65*raceFrames blowout invariant at frame ${midRaceCheckFrame}: ` +
        `loser=${loserProgressArr[midRaceCheckFrame].toFixed(3)}, winner=${winnerProgressArr[midRaceCheckFrame].toFixed(3)}, ` +
        `margin=${earlyMarginAtMidRace.toFixed(3)} (< 0.50)`,
    );
  }

  const overtakeRatio = overtakeFrame / raceFrames;
  const victoryRatio = victoryFrame / raceFrames;
  if (overtakeRatio < 0.82 || overtakeRatio > 0.96) {
    throw new Error(
      `${trace.slug}: overtakeFrame=${overtakeFrame}/${raceFrames} (${overtakeRatio.toFixed(3)}) outside [0.82, 0.96]`,
    );
  }
  if (victoryRatio < 0.82 || victoryRatio > 0.96) {
    throw new Error(
      `${trace.slug}: victoryFrame=${victoryFrame}/${raceFrames} (${victoryRatio.toFixed(3)}) outside [0.82, 0.96]`,
    );
  }
  if (overtakeFrame > victoryFrame) {
    throw new Error(
      `${trace.slug}: overtakeFrame (${overtakeFrame}) must be <= victoryFrame (${victoryFrame})`,
    );
  }

  const victoryHoldFrames = raceFrames - victoryFrame;
  if (victoryHoldFrames < 60) {
    throw new Error(
      `${trace.slug}: victoryHoldFrames=${victoryHoldFrames} (< 60 frames / 1.0s hold)`,
    );
  }

  const runnerUpProgressAtVictory = loserProgressArr[victoryFrame];
  if (runnerUpProgressAtVictory < 0.9) {
    throw new Error(
      `${trace.slug}: runnerUpProgressAtVictory=${runnerUpProgressAtVictory.toFixed(3)} (< 0.90 photo-finish threshold)`,
    );
  }

  if (
    trace.slug !== "afterburner-lap-comeback" &&
    trace.runnerUpFinalStageRemainingRatio >= 0.15
  ) {
    throw new Error(
      `${trace.slug}: runnerUp final stage remaining HP ratio=${trace.runnerUpFinalStageRemainingRatio.toFixed(3)} (expected < 0.15 on stage 10/10)`,
    );
  }

  return {
    slug: trace.slug,
    earlyCheckFrame,
    midRaceCheckFrame,
    earlyLeaderAtVictoryCheck,
    earlyMarginAtVictoryCheck,
    earlyMarginAtMidRace,
    overtakeFrame,
    overtakeRatio,
    victoryFrame,
    victoryRatio,
    victoryHoldFrames,
    runnerUpProgressAtVictory,
    runnerUpFinalStageRemainingRatio: trace.runnerUpFinalStageRemainingRatio,
  };
}

export function createRng(seed: number): () => number {
  let s = seed | 0 || 0x51f15e55;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function formatCompactInt(n: number): string {
  const v = Math.round(n);
  return v.toLocaleString("en-US");
}

export interface DualChamberPalette {
  leftBgTop: string;
  leftBgBottom: string;
  leftGrid: string;
  leftAccent: string;
  rightBgTop: string;
  rightBgBottom: string;
  rightGrid: string;
  rightAccent: string;
}

/**
 * Paints a 100% full-bleed 0..width x 0..height split twin-lane energy chamber
 * with animated parallax grids, top emitter rail, center divider, and bottom reactor core.
 * Every pixel has max(R,G,B) >= 22 so active frame fill is 100.0%.
 */
export function drawFullBleedDualChamber(
  ctx: CanvasRenderingContext2D,
  frame: number,
  kickImpulse: number,
  bass: number,
  palette: DualChamberPalette,
  winnerGlowSide: ComebackSide | null,
  width = VIDEO.width,
  height = VIDEO.height,
): void {
  const midX = width / 2; // 540

  // Guarantee an explicit 0..width x 0..height base fill first for deterministic mock/coverage checks
  ctx.fillStyle = palette.leftBgTop;
  ctx.fillRect(0, 0, width, height);

  // Left lane full-bleed vertical gradient (x: 0..540, y: 0..1920)
  const gradL = ctx.createLinearGradient(0, 0, 0, height);
  gradL.addColorStop(0, palette.leftBgTop);
  gradL.addColorStop(0.55, palette.leftBgBottom);
  gradL.addColorStop(1, palette.leftBgTop);
  ctx.fillStyle = gradL;
  ctx.fillRect(0, 0, midX, height);

  // Right lane full-bleed vertical gradient (x: 540..1080, y: 0..1920)
  const gradR = ctx.createLinearGradient(0, 0, 0, height);
  gradR.addColorStop(0, palette.rightBgTop);
  gradR.addColorStop(0.55, palette.rightBgBottom);
  gradR.addColorStop(1, palette.rightBgTop);
  ctx.fillStyle = gradR;
  ctx.fillRect(midX, 0, width - midX, height);

  // Animated vertical + horizontal plasma grid across all 1080x1920 pixels
  const scrollY = (frame * 2.4) % 64;
  ctx.lineWidth = 1;

  ctx.save();
  ctx.globalAlpha = 0.18 + bass * 0.14;
  ctx.strokeStyle = palette.leftGrid;
  for (let x = 24; x < midX; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = scrollY; y < height; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(midX, y);
    ctx.stroke();
  }

  ctx.strokeStyle = palette.rightGrid;
  for (let x = midX + 24; x < width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = (64 - scrollY) % 64; y < height; y += 64) {
    ctx.beginPath();
    ctx.moveTo(midX, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  // Winner lane aura wash when overtake/victory hits
  if (winnerGlowSide) {
    ctx.save();
    ctx.globalAlpha = 0.14 + kickImpulse * 0.16;
    ctx.fillStyle = winnerGlowSide === "left" ? palette.leftAccent : palette.rightAccent;
    ctx.fillRect(winnerGlowSide === "left" ? 0 : midX, 0, midX, height);
    ctx.restore();
  }

  // Full-bleed top emitter bar (y: 0..44) and bottom reactor bar (y: 1868..1920)
  ctx.save();
  ctx.globalAlpha = 0.34 + kickImpulse * 0.24;
  ctx.fillStyle = palette.leftAccent;
  ctx.fillRect(0, 0, midX - 4, 10);
  ctx.fillRect(0, height - 12, midX - 4, 12);
  ctx.fillStyle = palette.rightAccent;
  ctx.fillRect(midX + 4, 0, midX - 4, 10);
  ctx.fillRect(midX + 4, height - 12, midX - 4, 12);
  ctx.restore();

  // Center neon spine divider (x: 536..544, y: 0..1920)
  ctx.fillStyle = "#060913";
  ctx.fillRect(midX - 4, 0, 8, height);
  ctx.save();
  ctx.globalAlpha = 0.65 + kickImpulse * 0.3;
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(midX - 1, 0, 2, height);
  ctx.restore();
}

export interface HookHeaderSpec {
  hookLine1: string;
  highlightBadge: string;
  hookLine2: string;
  subline: string;
  leftValue: string;
  leftFormula: string;
  leftAccent: string;
  rightValue: string;
  rightFormula: string;
  rightAccent: string;
  leaderSide: ComebackSide;
  overtaken: boolean;
}

/**
 * Draws the viral hook header + split live counters strictly inside REEL_SAFE_BOUNDS
 * (x: 68..892, y: 226..444), keeping x: 900..1080 clear for Shorts/Reels right-rail icons.
 */
export function drawHookHeaderCard(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  spec: HookHeaderSpec,
): void {
  const card: ReelBox = {
    label: "comeback-hook-header",
    left: 66,
    top: 226,
    right: 894,
    bottom: 446,
  };
  assertReelSafeBox(card);

  ctx.save();
  ctx.fillStyle = "rgba(7, 11, 22, 0.86)";
  ctx.strokeStyle = spec.overtaken ? spec.rightAccent : "rgba(226, 232, 240, 0.28)";
  ctx.lineWidth = spec.overtaken ? 2.6 : 1.6;
  ctx.beginPath();
  ctx.roundRect(card.left, card.top, card.right - card.left, card.bottom - card.top, 20);
  ctx.fill();
  ctx.stroke();

  // Highlight pill at top-left of header (like viral reference yellow highlight badge)
  const pillBox: ReelBox = {
    label: `highlight-${spec.highlightBadge}`,
    left: 84,
    top: 240,
    right: 274,
    bottom: 278,
  };
  assertReelSafeBox(pillBox);
  ctx.fillStyle = "#fde047";
  ctx.beginPath();
  ctx.roundRect(
    pillBox.left,
    pillBox.top,
    pillBox.right - pillBox.left,
    pillBox.bottom - pillBox.top,
    9,
  );
  ctx.fill();

  drawReelText(ctx, boxes, spec.highlightBadge, 179, 267, {
    size: 22,
    weight: 900,
    color: "#090d16",
    align: "center",
    maxWidth: 176,
  });

  drawReelText(ctx, boxes, spec.hookLine1, 288, 268, {
    size: 27,
    weight: 800,
    color: "#f8fafc",
    maxWidth: 588,
  });

  drawReelText(ctx, boxes, spec.hookLine2, 86, 308, {
    size: 26,
    weight: 800,
    color: "#f8fafc",
    maxWidth: 790,
  });

  drawReelText(ctx, boxes, spec.subline, 86, 338, {
    size: 16.5,
    weight: 700,
    color: "#94a3b8",
    maxWidth: 790,
  });

  // Left live counter sub-card (x: 82..472, y: 350..434)
  const leftCard: ReelBox = {
    label: "left-live-counter",
    left: 82,
    top: 350,
    right: 472,
    bottom: 434,
  };
  assertReelSafeBox(leftCard);
  ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
  ctx.strokeStyle = spec.leaderSide === "left" ? spec.leftAccent : "rgba(148, 163, 184, 0.28)";
  ctx.lineWidth = spec.leaderSide === "left" ? 2.2 : 1.2;
  ctx.beginPath();
  ctx.roundRect(
    leftCard.left,
    leftCard.top,
    leftCard.right - leftCard.left,
    leftCard.bottom - leftCard.top,
    14,
  );
  ctx.fill();
  ctx.stroke();

  drawReelText(ctx, boxes, spec.leftValue, 98, 392, {
    size: 31,
    weight: 900,
    color: spec.leftAccent,
    maxWidth: 356,
  });
  drawReelText(ctx, boxes, spec.leftFormula, 98, 421, {
    size: 16.5,
    weight: 700,
    color: "#cbd5e1",
    maxWidth: 356,
  });

  // Right live counter sub-card (x: 488..878, y: 350..434)
  const rightCard: ReelBox = {
    label: "right-live-counter",
    left: 488,
    top: 350,
    right: 878,
    bottom: 434,
  };
  assertReelSafeBox(rightCard);
  ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
  ctx.strokeStyle = spec.leaderSide === "right" ? spec.rightAccent : "rgba(148, 163, 184, 0.28)";
  ctx.lineWidth = spec.leaderSide === "right" ? 2.5 : 1.2;
  ctx.beginPath();
  ctx.roundRect(
    rightCard.left,
    rightCard.top,
    rightCard.right - rightCard.left,
    rightCard.bottom - rightCard.top,
    14,
  );
  ctx.fill();
  ctx.stroke();

  drawReelText(ctx, boxes, spec.rightValue, 504, 392, {
    size: 31,
    weight: 900,
    color: spec.rightAccent,
    maxWidth: 356,
  });
  drawReelText(ctx, boxes, spec.rightFormula, 504, 421, {
    size: 16.5,
    weight: 700,
    color: "#cbd5e1",
    maxWidth: 356,
  });

  ctx.restore();
}

export interface BottomProgressSpec {
  leftLabel: string;
  leftProgress: number;
  leftAccent: string;
  rightLabel: string;
  rightProgress: number;
  rightAccent: string;
  statusBanner?: string;
  bannerAccent?: string;
}

/**
 * Draws twin live progress bars + optional OVERTAKE / PHOTO FINISH status banner
 * strictly inside REEL_SAFE_BOUNDS (x: 66..894, y: 1432..1550).
 */
export function drawBottomProgressPills(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  spec: BottomProgressSpec,
): void {
  ctx.save();

  if (spec.statusBanner) {
    const bannerBox: ReelBox = {
      label: "comeback-status-banner",
      left: 160,
      top: 1432,
      right: 800,
      bottom: 1476,
    };
    assertReelSafeBox(bannerBox);
    ctx.fillStyle = "rgba(7, 11, 22, 0.92)";
    ctx.strokeStyle = spec.bannerAccent ?? "#fde047";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.roundRect(
      bannerBox.left,
      bannerBox.top,
      bannerBox.right - bannerBox.left,
      bannerBox.bottom - bannerBox.top,
      999,
    );
    ctx.fill();
    ctx.stroke();

    drawReelText(ctx, boxes, spec.statusBanner, 480, 1462, {
      size: 21,
      weight: 900,
      color: spec.bannerAccent ?? "#fde047",
      align: "center",
      maxWidth: 600,
    });
  }

  const drawPill = (
    left: number,
    right: number,
    label: string,
    progress: number,
    accent: string,
    id: string,
  ) => {
    const pill: ReelBox = {
      label: id,
      left,
      top: 1486,
      right,
      bottom: 1550,
    };
    assertReelSafeBox(pill);
    const w = right - left;
    const h = pill.bottom - pill.top;
    const p = Math.max(0, Math.min(1, progress));

    ctx.fillStyle = "rgba(7, 11, 22, 0.88)";
    ctx.strokeStyle = p >= 0.999 ? "#fde047" : accent;
    ctx.lineWidth = p >= 0.999 ? 2.6 : 1.8;
    ctx.beginPath();
    ctx.roundRect(left, pill.top, w, h, 14);
    ctx.fill();
    ctx.stroke();

    // Progress fill track at bottom of pill
    const barLeft = left + 12;
    const barW = w - 24;
    ctx.fillStyle = "rgba(148, 163, 184, 0.22)";
    ctx.fillRect(barLeft, pill.bottom - 14, barW, 7);
    ctx.fillStyle = accent;
    ctx.fillRect(barLeft, pill.bottom - 14, barW * p, 7);

    drawReelText(ctx, boxes, label, left + 14, pill.top + 34, {
      size: 20,
      weight: 800,
      color: "#f8fafc",
      maxWidth: w - 28,
    });
  };

  drawPill(66, 472, spec.leftLabel, spec.leftProgress, spec.leftAccent, "left-progress-pill");
  drawPill(488, 894, spec.rightLabel, spec.rightProgress, spec.rightAccent, "right-progress-pill");

  ctx.restore();
}
