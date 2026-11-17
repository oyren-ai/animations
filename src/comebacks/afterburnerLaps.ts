import type { FrameAudioFeatures } from "../audio-reactive/synth.ts";
import { CLOSING_FRAMES, VIDEO } from "../settings.ts";
import { assertReelSafeBox, drawReelText, type ReelBox } from "../shared/reelUtils.ts";
import {
  drawBottomProgressPills,
  drawFullBleedDualChamber,
  drawHookHeaderCard,
  formatCompactInt,
  type ComebackEvent,
  type ComebackSide,
  type ComebackTraceBase,
  type DualChamberPalette,
} from "./invariants.ts";

export const TARGET_LAPS = 100;
export const TRACK_TOP_Y = 52;
export const TRACK_BOTTOM_Y = 1868;
export const TRACK_LENGTH_PX = TRACK_BOTTOM_Y - TRACK_TOP_Y; // 1816 px full-screen straightaway

export const LEFT_STEADY_KMH = 900;
export const RIGHT_INITIAL_KMH = 65;
export const RIGHT_BOUNCE_MULTIPLIER = 1.18; // +18% speed every bounce
export const RIGHT_MAX_OVERDRIVE_KMH = 13000;
const KMH_TO_LAPS_PER_SEC = 5.22 / LEFT_STEADY_KMH; // 900 km/h => 5.22 laps/s
const SUBSTEPS = 16;

const SPEEDWAY_PALETTE: DualChamberPalette = {
  leftBgTop: "#140e2e",
  leftBgBottom: "#211548",
  leftGrid: "#8b5cf6",
  leftAccent: "#a78bfa",
  rightBgTop: "#071c2b",
  rightBgBottom: "#0b2e46",
  rightGrid: "#06b6d4",
  rightAccent: "#22d3ee",
};

export interface GateFlash {
  frame: number;
  side: ComebackSide;
  atTop: boolean;
  machRatio: number;
}

export interface AfterburnerComebackTrace extends ComebackTraceBase {
  slug: "afterburner-lap-comeback";
  leftLapsPerFrame: Uint8Array;
  rightLapsPerFrame: Uint8Array;
  leftYPerFrame: Float32Array;
  rightYPerFrame: Float32Array;
  leftDirPerFrame: Int8Array;
  rightDirPerFrame: Int8Array;
  rightKmhPerFrame: Float32Array;
  gateFlashes: GateFlash[];
}

interface RacerState {
  laps: number;
  posNorm: number; // 0 (top gate) .. 1 (bottom gate)
  dir: 1 | -1;
  speedKmh: number;
}

let cachedAfterburnerTrace: AfterburnerComebackTrace | null = null;

export function simulateAfterburnerLaps(): AfterburnerComebackTrace {
  if (cachedAfterburnerTrace) return cachedAfterburnerTrace;

  const seed = 20261120;
  const raceFrames = 1200; // 20.0s race + 3.0s closing
  const closingFrames = CLOSING_FRAMES;
  const totalFrames = raceFrames + closingFrames;

  const left: RacerState = {
    laps: 0,
    posNorm: 0,
    dir: 1,
    speedKmh: LEFT_STEADY_KMH,
  };
  const right: RacerState = {
    laps: 0,
    posNorm: 0,
    dir: 1,
    speedKmh: RIGHT_INITIAL_KMH,
  };

  const leftProgress = new Float32Array(raceFrames);
  const rightProgress = new Float32Array(raceFrames);
  const leftLapsPerFrame = new Uint8Array(raceFrames);
  const rightLapsPerFrame = new Uint8Array(raceFrames);
  const leftYPerFrame = new Float32Array(raceFrames);
  const rightYPerFrame = new Float32Array(raceFrames);
  const leftDirPerFrame = new Int8Array(raceFrames);
  const rightDirPerFrame = new Int8Array(raceFrames);
  const rightKmhPerFrame = new Float32Array(raceFrames);

  const events: ComebackEvent[] = [];
  const gateFlashes: GateFlash[] = [];

  const stepRacer = (r: RacerState, side: ComebackSide, dt: number, f: number) => {
    let remNorm = r.speedKmh * KMH_TO_LAPS_PER_SEC * dt;
    let guard = 0;
    while (remNorm > 0 && r.laps < TARGET_LAPS && guard++ < 16) {
      const distToGate = r.dir === 1 ? 1 - r.posNorm : r.posNorm;
      if (remNorm >= distToGate) {
        remNorm -= distToGate;
        r.posNorm = r.dir === 1 ? 1 : 0;
        const hitTop = r.posNorm === 0;
        r.dir = r.dir === 1 ? -1 : 1;
        r.laps++;

        if (side === "right") {
          r.speedKmh = Math.min(RIGHT_MAX_OVERDRIVE_KMH, r.speedKmh * RIGHT_BOUNCE_MULTIPLIER);
        }

        const machRatio = Math.min(1, r.speedKmh / RIGHT_MAX_OVERDRIVE_KMH);
        if (side === "left" || r.laps <= 32 || r.laps % 4 === 0 || r.laps >= 96) {
          gateFlashes.push({ frame: f, side, atTop: hitTop, machRatio });
        }

        if (side === "right" && (r.laps <= 24 || r.laps % 5 === 0)) {
          events.push({
            frame: f,
            side: "right",
            kind: "bounce-powerup",
            stageIndex: Math.min(9, Math.floor(r.laps / 10)),
            intensity: Math.min(1, 0.25 + machRatio * 0.75),
            pitchStep: Math.min(24, Math.floor(r.laps * 0.28)),
          });
        } else if (side === "left" && r.laps % 10 === 0) {
          events.push({
            frame: f,
            side: "left",
            kind: "stage-break",
            stageIndex: Math.min(9, Math.floor(r.laps / 10) - 1),
            intensity: 0.36,
            pitchStep: Math.floor(r.laps / 10),
          });
        }
      } else {
        r.posNorm += r.dir * remNorm;
        remNorm = 0;
      }
    }
  };

  const dt = 1 / (VIDEO.fps * SUBSTEPS);
  let winner: ComebackSide | null = null;
  let victoryFrame = raceFrames - 1;

  for (let f = 0; f < raceFrames; f++) {
    if (f > 0 && winner === null) {
      for (let sub = 0; sub < SUBSTEPS; sub++) {
        stepRacer(left, "left", dt, f);
        stepRacer(right, "right", dt, f);

        if (right.laps >= TARGET_LAPS || left.laps >= TARGET_LAPS) {
          winner = right.laps >= TARGET_LAPS ? "right" : "left";
          victoryFrame = f;
          events.push({
            frame: f,
            side: winner,
            kind: "victory",
            stageIndex: 9,
            intensity: 1,
            pitchStep: 20,
          });
          break;
        }
      }
    } else if (f > 0 && winner !== null) {
      // Gentle post-victory coasting lap visual
      const coastRacer = winner === "right" ? right : left;
      coastRacer.posNorm += coastRacer.dir * 0.028;
      if (coastRacer.posNorm >= 1) {
        coastRacer.posNorm = 1;
        coastRacer.dir = -1;
      } else if (coastRacer.posNorm <= 0) {
        coastRacer.posNorm = 0;
        coastRacer.dir = 1;
      }
    }

    const leftFrac = left.dir === 1 ? left.posNorm : 1 - left.posNorm;
    const rightFrac = right.dir === 1 ? right.posNorm : 1 - right.posNorm;

    leftProgress[f] =
      left.laps >= TARGET_LAPS ? 1 : Math.min(1, (left.laps + leftFrac) / TARGET_LAPS);
    rightProgress[f] =
      right.laps >= TARGET_LAPS ? 1 : Math.min(1, (right.laps + rightFrac) / TARGET_LAPS);

    leftLapsPerFrame[f] = Math.min(TARGET_LAPS, left.laps);
    rightLapsPerFrame[f] = Math.min(TARGET_LAPS, right.laps);
    leftYPerFrame[f] = TRACK_TOP_Y + left.posNorm * TRACK_LENGTH_PX;
    rightYPerFrame[f] = TRACK_TOP_Y + right.posNorm * TRACK_LENGTH_PX;
    leftDirPerFrame[f] = left.dir;
    rightDirPerFrame[f] = right.dir;
    rightKmhPerFrame[f] = right.speedKmh;
  }

  const resolvedWinner: ComebackSide =
    winner ?? (rightProgress[raceFrames - 1] >= leftProgress[raceFrames - 1] ? "right" : "left");
  const earlyCheck = Math.floor(0.65 * victoryFrame);
  const earlyLeader: ComebackSide =
    leftProgress[earlyCheck] >= rightProgress[earlyCheck] ? "left" : "right";

  let overtakeFrame = victoryFrame;
  for (let f = victoryFrame; f >= 1; f--) {
    const wProg = resolvedWinner === "right" ? rightProgress[f - 1] : leftProgress[f - 1];
    const lProg = resolvedWinner === "right" ? leftProgress[f - 1] : rightProgress[f - 1];
    if (wProg < lProg) {
      overtakeFrame = f;
      break;
    }
  }
  events.push({
    frame: overtakeFrame,
    side: resolvedWinner,
    kind: "overtake",
    stageIndex: 9,
    intensity: 1,
    pitchStep: 18,
  });
  events.sort((a, b) => a.frame - b.frame);

  const runnerUpProg =
    resolvedWinner === "right" ? leftProgress[victoryFrame] : rightProgress[victoryFrame];

  cachedAfterburnerTrace = {
    slug: "afterburner-lap-comeback",
    seed,
    fps: VIDEO.fps,
    raceFrames,
    closingFrames,
    totalFrames,
    winner: resolvedWinner,
    earlyLeader,
    overtakeFrame,
    victoryFrame,
    leftProgress,
    rightProgress,
    runnerUpFinalStageRemainingRatio: Math.max(0, 1 - runnerUpProg),
    events,
    leftLapsPerFrame,
    rightLapsPerFrame,
    leftYPerFrame,
    rightYPerFrame,
    leftDirPerFrame,
    rightDirPerFrame,
    rightKmhPerFrame,
    gateFlashes,
  };
  return cachedAfterburnerTrace;
}

export function paintAfterburnerLapsFrame(
  ctx: CanvasRenderingContext2D,
  trace: AfterburnerComebackTrace,
  features: readonly FrameAudioFeatures[],
  frame: number,
  width = VIDEO.width,
  height = VIDEO.height,
): ReelBox[] {
  const f = Math.max(0, Math.min(trace.raceFrames - 1, frame));
  const feat = features[Math.min(features.length - 1, f)];
  const boxes: ReelBox[] = [];
  const overtaken = f >= trace.overtakeFrame;
  const won = f >= trace.victoryFrame;
  const leaderSide: ComebackSide =
    trace.rightProgress[f] >= trace.leftProgress[f] ? "right" : "left";

  // 1. Full-bleed 1080x1920 twin speedway arena
  drawFullBleedDualChamber(
    ctx,
    f,
    feat.kickImpulse,
    feat.bass,
    SPEEDWAY_PALETTE,
    overtaken ? trace.winner : null,
    width,
    height,
  );

  const leftCenterX = 270;
  const rightCenterX = 810;

  // 2. Full-height neon guide rails & bounce gates (y: 44..1876 across x: 0..1080)
  const drawSpeedwayTrack = (cx: number, accent: string, side: ComebackSide) => {
    const laneLeft = side === "left" ? 16 : 556;
    const laneRight = side === "left" ? 524 : 1064;

    ctx.save();
    // Side speedway curbs
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(laneLeft, TRACK_TOP_Y, 8, TRACK_LENGTH_PX);
    ctx.fillRect(laneRight - 8, TRACK_TOP_Y, 8, TRACK_LENGTH_PX);

    // Center dashed telemetry spine
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.24;
    for (let k = 0; k < 20; k++) {
      const y0 = TRACK_TOP_Y + k * (TRACK_LENGTH_PX / 20) + 8;
      ctx.beginPath();
      ctx.moveTo(cx, y0);
      ctx.lineTo(cx, y0 + 52);
      ctx.stroke();
    }

    // Top & bottom afterburner bounce pads
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = accent;
    ctx.fillRect(laneLeft, TRACK_TOP_Y - 10, laneRight - laneLeft, 12);
    ctx.fillRect(laneLeft, TRACK_BOTTOM_Y - 2, laneRight - laneLeft, 12);
    ctx.restore();
  };

  drawSpeedwayTrack(leftCenterX, SPEEDWAY_PALETTE.leftAccent, "left");
  drawSpeedwayTrack(rightCenterX, SPEEDWAY_PALETTE.rightAccent, "right");

  // Gate bounce flash rings
  for (const gf of trace.gateFlashes) {
    const age = f - gf.frame;
    if (age < 0 || age > 18) continue;
    const p = age / 18;
    const gx = gf.side === "left" ? leftCenterX : rightCenterX;
    const gy = gf.atTop ? TRACK_TOP_Y : TRACK_BOTTOM_Y;
    ctx.save();
    ctx.globalAlpha = (1 - p) * (0.45 + gf.machRatio * 0.5);
    ctx.strokeStyle = gf.side === "left" ? SPEEDWAY_PALETTE.leftAccent : "#ffffff";
    ctx.lineWidth = 4 * (1 - p) + 1;
    ctx.beginPath();
    ctx.arc(gx, gy, 24 + p * 180, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 3. Draw Left Steady Cruiser (900 km/h)
  const ly = trace.leftYPerFrame[f];
  const lDir = trace.leftDirPerFrame[f];
  ctx.save();
  const leftTrailLen = 190;
  const lTrailTop = lDir === 1 ? Math.max(TRACK_TOP_Y, ly - leftTrailLen) : ly;
  const lTrailBot = lDir === 1 ? ly : Math.min(TRACK_BOTTOM_Y, ly + leftTrailLen);
  const lGrad = ctx.createLinearGradient(
    leftCenterX,
    lTrailTop,
    leftCenterX,
    Math.max(lTrailTop + 1, lTrailBot),
  );
  lGrad.addColorStop(0, lDir === 1 ? "rgba(167, 139, 250, 0)" : "rgba(167, 139, 250, 0.75)");
  lGrad.addColorStop(1, lDir === 1 ? "rgba(167, 139, 250, 0.75)" : "rgba(167, 139, 250, 0)");
  ctx.fillStyle = lGrad;
  ctx.fillRect(leftCenterX - 18, lTrailTop, 36, Math.max(4, lTrailBot - lTrailTop));

  ctx.fillStyle = SPEEDWAY_PALETTE.leftAccent;
  ctx.beginPath();
  ctx.arc(leftCenterX, ly, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(leftCenterX, ly, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 4. Draw Right Afterburner Plasma Craft (+18% every bounce -> relativistic ribbonblur!)
  const ry = trace.rightYPerFrame[f];
  const rDir = trace.rightDirPerFrame[f];
  const rightKmh = trace.rightKmhPerFrame[f];
  const machNorm = Math.min(1, rightKmh / RIGHT_MAX_OVERDRIVE_KMH);

  ctx.save();
  if (machNorm > 0.35) {
    // Full-track relativistic plasma ribbon wake when supersonic!
    ctx.globalAlpha = Math.min(0.68, (machNorm - 0.3) * 0.85);
    const ribGrad = ctx.createLinearGradient(rightCenterX - 90, 0, rightCenterX + 90, 0);
    ribGrad.addColorStop(0, "rgba(34, 211, 238, 0)");
    ribGrad.addColorStop(0.5, "#22d3ee");
    ribGrad.addColorStop(1, "rgba(34, 211, 238, 0)");
    ctx.fillStyle = ribGrad;
    ctx.fillRect(rightCenterX - 90, TRACK_TOP_Y, 180, TRACK_LENGTH_PX);
  }

  ctx.globalAlpha = 1;
  const rTrailLen = Math.min(900, 55 + machNorm * 850);
  const rTrailTop = rDir === 1 ? Math.max(TRACK_TOP_Y, ry - rTrailLen) : ry;
  const rTrailBot = rDir === 1 ? ry : Math.min(TRACK_BOTTOM_Y, ry + rTrailLen);
  const rGrad = ctx.createLinearGradient(
    rightCenterX,
    rTrailTop,
    rightCenterX,
    Math.max(rTrailTop + 1, rTrailBot),
  );
  rGrad.addColorStop(0, rDir === 1 ? "rgba(34, 211, 238, 0)" : "rgba(255, 255, 255, 0.92)");
  rGrad.addColorStop(1, rDir === 1 ? "rgba(255, 255, 255, 0.92)" : "rgba(34, 211, 238, 0)");
  ctx.fillStyle = rGrad;
  const beamHalfW = 14 + machNorm * 28;
  ctx.fillRect(
    rightCenterX - beamHalfW,
    rTrailTop,
    beamHalfW * 2,
    Math.max(6, rTrailBot - rTrailTop),
  );

  // Mach shock cone V-wings
  if (rightKmh >= 900) {
    ctx.strokeStyle = "#fde047";
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(rightCenterX - 58, ry - rDir * 44);
    ctx.lineTo(rightCenterX, ry + rDir * 16);
    ctx.lineTo(rightCenterX + 58, ry - rDir * 44);
    ctx.stroke();
  }

  ctx.fillStyle = SPEEDWAY_PALETTE.rightAccent;
  ctx.beginPath();
  ctx.arc(rightCenterX, ry, 20 + machNorm * 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(rightCenterX, ry, 10 + machNorm * 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 5. Mid-screen large safe-zone Lap Scoreboard badge (x: 190..770, y: 890..984)
  const scoreCard: ReelBox = {
    label: "lap-live-scoreboard",
    left: 170,
    top: 896,
    right: 790,
    bottom: 982,
  };
  assertReelSafeBox(scoreCard);
  ctx.save();
  ctx.fillStyle = "rgba(7, 11, 22, 0.84)";
  ctx.strokeStyle = overtaken ? SPEEDWAY_PALETTE.rightAccent : "rgba(226, 232, 240, 0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(
    scoreCard.left,
    scoreCard.top,
    scoreCard.right - scoreCard.left,
    scoreCard.bottom - scoreCard.top,
    18,
  );
  ctx.fill();
  ctx.stroke();

  drawReelText(
    ctx,
    boxes,
    `LAPS   ${trace.leftLapsPerFrame[f]}   vs   ${trace.rightLapsPerFrame[f]}   / 100`,
    480,
    952,
    {
      size: 36,
      weight: 900,
      color: overtaken ? SPEEDWAY_PALETTE.rightAccent : "#f8fafc",
      align: "center",
      maxWidth: 580,
    },
  );
  ctx.restore();

  // 6. Safe-zone Viral Hook Header & Bottom Progress Pills
  drawHookHeaderCard(ctx, boxes, {
    highlightBadge: "+18% BOUNCE",
    hookLine1: "vs STEADY 900 KM/H:",
    hookLine2: "First racer to 100 vertical laps!",
    subline: "LEFT CONSTANT CRUISER  ·  RIGHT COMPOUNDS +18% / GATE",
    leftValue: "900 km/h",
    leftFormula: `LAP ${trace.leftLapsPerFrame[f]} / 100`,
    leftAccent: SPEEDWAY_PALETTE.leftAccent,
    rightValue: `${formatCompactInt(rightKmh)} km/h`,
    rightFormula: `LAP ${trace.rightLapsPerFrame[f]} / 100`,
    rightAccent: SPEEDWAY_PALETTE.rightAccent,
    leaderSide,
    overtaken,
  });

  const statusBanner = won
    ? `AFTERBURNER WINS ${trace.rightLapsPerFrame[f]} TO ${trace.leftLapsPerFrame[f]}!`
    : overtaken
      ? "RELATIVISTIC MACH OVERTAKE!"
      : trace.leftLapsPerFrame[f] >= 80
        ? `LEFT AT ${trace.leftLapsPerFrame[f]}/100 LAPS · AFTERBURNER IGNITING!`
        : undefined;

  drawBottomProgressPills(ctx, boxes, {
    leftLabel: `CRUISER ${trace.leftLapsPerFrame[f]}/100 LAPS`,
    leftProgress: trace.leftProgress[f],
    leftAccent: SPEEDWAY_PALETTE.leftAccent,
    rightLabel: won
      ? "AFTERBURNER 100/100 · WINNER!"
      : `AFTERBURNER ${trace.rightLapsPerFrame[f]}/100`,
    rightProgress: trace.rightProgress[f],
    rightAccent: SPEEDWAY_PALETTE.rightAccent,
    statusBanner,
    bannerAccent: won || overtaken ? SPEEDWAY_PALETTE.rightAccent : "#fde047",
  });

  return boxes;
}
