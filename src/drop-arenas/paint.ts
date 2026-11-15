import { VIDEO } from "../settings.ts";
import { easeIn, easeOut, theme } from "../theme.ts";
import {
  assertReelSafeBox,
  drawEmblemPaths,
  drawReelText,
  type LocalLogoAtlas,
  type ReelBox,
} from "../shared/reelUtils.ts";
import {
  AI_MODEL_TIERS,
  BREAKABLE_RING_RADII,
  DROP_WORLD,
  funnelBowlY,
  PINBALL_BUMPERS,
  PINBALL_TANK,
  pinballSpinner,
  PLINKO_PEGS,
  RING_CENTER,
  RING_GOAL,
  RING_SEGMENTS,
  ringRotation,
  type DropTrace,
} from "./sim.ts";

const C = theme.colors;
const TAU = Math.PI * 2;

const RING_COLORS = [
  "#38bdf8",
  "#818cf8",
  "#c084fc",
  "#f472b6",
  "#fb923c",
  "#c8ff85",
] as const;

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function pushSafeRect(
  boxes: ReelBox[],
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const box: ReelBox = {
    label,
    left: x,
    top: y,
    right: x + w,
    bottom: y + h,
  };
  assertReelSafeBox(box);
  boxes.push(box);
}

function formatCompactInt(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return String(Math.round(n));
}

function paintBackdrop(ctx: CanvasRenderingContext2D, globalFrame: number) {
  const sec = globalFrame / VIDEO.fps;
  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);

  const mesh = ctx.createRadialGradient(
    480 + Math.cos(sec * 0.42) * 60,
    930,
    0,
    480,
    960,
    940,
  );
  mesh.addColorStop(0, "rgba(116, 185, 209, 0.13)");
  mesh.addColorStop(0.62, "rgba(18, 30, 44, 0.06)");
  mesh.addColorStop(1, C.transparent);
  ctx.fillStyle = mesh;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
}

function paintFilmFinish(ctx: CanvasRenderingContext2D, globalFrame: number) {
  ctx.save();
  ctx.fillStyle = C.grade;
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = C.grain;
  for (let k = 0; k < 320; k++) {
    ctx.fillRect(
      (k * 197 + globalFrame * 7) % VIDEO.width,
      (k * 277 + globalFrame * 3) % VIDEO.height,
      1,
      1,
    );
  }
  const v = ctx.createRadialGradient(540, 960, 520, 540, 960, 1260);
  v.addColorStop(0, C.transparent);
  v.addColorStop(1, C.vignette);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
  ctx.restore();
}

export function paintDropArenaFrame(
  ctx: CanvasRenderingContext2D,
  trace: DropTrace,
  localFrame: number,
  opts: {
    isCombined?: boolean;
    globalFrame?: number;
    atlas?: LocalLogoAtlas | null;
    fadeOutAtEnd?: boolean;
  } = {},
): ReelBox[] {
  const {
    isCombined = false,
    globalFrame = localFrame,
    atlas = null,
    fadeOutAtEnd = false,
  } = opts;

  const boxes: ReelBox[] = [];
  const maxIdx = trace.frames.length - 1;
  const clampedFrame = Math.max(0, Math.min(localFrame, maxIdx));
  const state = trace.frames[clampedFrame];
  const def = trace.definition;
  const timeSeconds = clampedFrame / trace.fps;

  paintBackdrop(ctx, globalFrame);

  const enterFade = Math.min(1, (localFrame + 1) / 8);
  const exitWindow = fadeOutAtEnd ? 10 : 7;
  const exitFade = 1 - easeIn((localFrame - (maxIdx - exitWindow)) / exitWindow);
  const alpha = Math.max(0, Math.min(1, enterFade * exitFade));

  ctx.save();
  ctx.globalAlpha = alpha;

  // --- 1. Header, Explicit Rules & Provenance (strictly x: 60..900, y: 220..490) ---
  const badgeX = 64;
  const badgeY = 226;
  const badgeH = 34;
  const badgeLabel = isCombined
    ? `STAGE ${def.stageNumber} / 4 · ${def.title.toUpperCase()}`
    : `BALL DROP · ${def.title.toUpperCase()}`;
  ctx.font = `750 15.5px ${JSON.stringify(theme.fontFamily)}`;
  const badgeW = Math.min(540, Math.ceil(ctx.measureText(badgeLabel).width) + 28);
  pushSafeRect(boxes, "stage-pill", badgeX, badgeY, badgeW, badgeH);
  roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 17);
  ctx.fillStyle = "rgba(20, 32, 45, 0.92)";
  ctx.fill();
  ctx.strokeStyle = "rgba(200, 255, 133, 0.48)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  drawReelText(ctx, boxes, badgeLabel, badgeX + 14, badgeY + 23, {
    size: 15,
    weight: 750,
    color: C.primary,
    maxWidth: badgeW - 24,
  });

  if (isCombined) {
    for (let s = 1; s <= 4; s++) {
      const pipX = badgeX + badgeW + 14 + (s - 1) * 18;
      const pipY = badgeY + badgeH / 2;
      pushSafeRect(boxes, `stage-pip-${s}`, pipX - 6, pipY - 6, 12, 12);
      ctx.beginPath();
      ctx.arc(pipX, pipY, s === def.stageNumber ? 5.5 : 4, 0, TAU);
      ctx.fillStyle =
        s < def.stageNumber
          ? C.accent
          : s === def.stageNumber
            ? C.primary
            : "rgba(148, 163, 184, 0.35)";
      ctx.fill();
    }
  }

  drawReelText(ctx, boxes, `${timeSeconds.toFixed(1)}s`, 894, badgeY + 24, {
    size: 20,
    weight: 700,
    color: C.muted,
    align: "right",
    maxWidth: 110,
  });

  // Stage Title
  drawReelText(ctx, boxes, def.title, 64, 298, {
    size: 38,
    weight: 800,
    color: C.ink,
    maxWidth: 830,
  });

  // Two-line explicit rules from frame 0 (t4)
  drawReelText(ctx, boxes, def.ruleLines[0], 64, 333, {
    size: 19.5,
    weight: 600,
    color: "#dbe6f2",
    maxWidth: 830,
  });
  drawReelText(ctx, boxes, def.ruleLines[1], 64, 359, {
    size: 17.5,
    weight: 550,
    color: "#b8c7d9",
    maxWidth: 830,
  });

  // Provenance subtitle (t4)
  const provenance =
    trace.style === "drop-logo-funnel-merge"
      ? `Seed #${trace.seed} · Bouncy squash-and-stretch · Seeded physics · not a benchmark`
      : `Seed #${trace.seed} · 480 Hz fixed-step physics · Seeded simulation`;
  drawReelText(ctx, boxes, provenance, 64, 385, {
    size: 16,
    weight: 500,
    color: C.muted,
    maxWidth: 830,
  });

  // --- 2. Top Progress / Legend Strip (y: 400..484, strictly above DROP_WORLD.top = 500) ---
  if (trace.style === "drop-logo-funnel-merge") {
    // 8-Tier AI-Model Progression Ladder Strip (1 MiniMax -> ... -> 8 ChatGPT)
    const cardW = 98;
    const gap = 6.85;
    const cardY = 402;
    const cardH = 82;
    for (let idx = 0; idx < AI_MODEL_TIERS.length; idx++) {
      const spec = AI_MODEL_TIERS[idx];
      const unlocked = state.maxTierReached >= spec.tier;
      const isTopTier = spec.tier === 8 && state.climaxReached;
      const cardX = 64 + idx * (cardW + gap);
      pushSafeRect(boxes, `tier-legend-${spec.tier}`, cardX, cardY, cardW, cardH);

      roundRectPath(ctx, cardX, cardY, cardW, cardH, 12);
      ctx.fillStyle = isTopTier
        ? "rgba(16, 48, 36, 0.96)"
        : unlocked
          ? "rgba(16, 28, 42, 0.92)"
          : "rgba(11, 18, 26, 0.65)";
      ctx.fill();
      ctx.strokeStyle = isTopTier
        ? C.primary
        : unlocked
          ? spec.rimColor
          : "rgba(71, 85, 105, 0.38)";
      ctx.lineWidth = isTopTier ? 2.2 : unlocked ? 1.5 : 1;
      ctx.stroke();

      // Mini jewel orb preview
      const ox = cardX + 24;
      const oy = cardY + 27;
      const mr = 14;
      const miniGrad = ctx.createRadialGradient(ox - 4, oy - 4, 2, ox, oy, mr);
      miniGrad.addColorStop(0, spec.orbFillInner);
      miniGrad.addColorStop(1, spec.orbFillOuter);
      ctx.beginPath();
      ctx.arc(ox, oy, mr, 0, TAU);
      ctx.fillStyle = miniGrad;
      ctx.fill();
      ctx.strokeStyle = spec.rimColor;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.save();
      ctx.globalAlpha = alpha * (unlocked ? 1 : 0.55);
      drawEmblemPaths(
        ctx,
        spec.logoKey,
        spec.monogram,
        ox,
        oy,
        16.5,
        spec.iconColor,
        atlas,
      );
      ctx.restore();

      drawReelText(ctx, boxes, `T${spec.tier}`, cardX + cardW - 10, cardY + 32, {
        size: 14.5,
        weight: 800,
        color: unlocked ? spec.rimColor : "#64748b",
        align: "right",
        maxWidth: 42,
      });

      drawReelText(ctx, boxes, spec.shortLabel, cardX + cardW / 2, cardY + 69, {
        size: 13.5,
        weight: 700,
        color: unlocked ? C.ink : "#64748b",
        align: "center",
        maxWidth: cardW - 10,
      });
    }
  } else if (trace.style === "drop-plinko-gates") {
    const initShields = trace.frames[0].shields;
    const pillW = 158;
    const gap = 10.5;
    const pillY = 408;
    const pillH = 70;
    for (let i = 0; i < state.shields.length; i++) {
      const hp = state.shields[i];
      const maxHp = initShields[i];
      const broken = hp <= 0;
      const activeIdx = state.shields.findIndex((v) => v > 0);
      const isCurrent = i === activeIdx;
      const px = 64 + i * (pillW + gap);
      pushSafeRect(boxes, `shield-pill-${i}`, px, pillY, pillW, pillH);

      roundRectPath(ctx, px, pillY, pillW, pillH, 12);
      ctx.fillStyle = broken
        ? "rgba(20, 42, 32, 0.85)"
        : isCurrent
          ? "rgba(22, 34, 49, 0.95)"
          : "rgba(13, 22, 32, 0.78)";
      ctx.fill();
      ctx.strokeStyle = broken
        ? C.primary
        : isCurrent
          ? "#38bdf8"
          : "rgba(71, 85, 105, 0.45)";
      ctx.lineWidth = isCurrent ? 2 : 1.3;
      ctx.stroke();

      drawReelText(ctx, boxes, `SHIELD ${i + 1}`, px + 12, pillY + 26, {
        size: 12.5,
        weight: 700,
        color: broken ? C.primary : "#94a3b8",
        maxWidth: pillW - 24,
      });
      drawReelText(
        ctx,
        boxes,
        broken ? "SHATTERED" : `${formatCompactInt(hp)} / ${formatCompactInt(maxHp)}`,
        px + 12,
        pillY + 53,
        {
          size: 17.5,
          weight: 800,
          color: broken ? C.primary : C.ink,
          maxWidth: pillW - 24,
        },
      );
    }
  } else if (trace.style === "drop-breakable-rings") {
    const pillW = 130;
    const gap = 10.4;
    const pillY = 408;
    const pillH = 70;
    for (let ri = 0; ri < 6; ri++) {
      const intact = state.rings[ri].filter((hp) => hp > 0).length;
      const px = 64 + ri * (pillW + gap);
      pushSafeRect(boxes, `ring-pill-${ri}`, px, pillY, pillW, pillH);

      roundRectPath(ctx, px, pillY, pillW, pillH, 12);
      ctx.fillStyle = "rgba(15, 25, 36, 0.9)";
      ctx.fill();
      ctx.strokeStyle = RING_COLORS[ri];
      ctx.lineWidth = 1.5;
      ctx.stroke();

      drawReelText(ctx, boxes, `RING ${ri + 1}`, px + 12, pillY + 26, {
        size: 12.5,
        weight: 750,
        color: RING_COLORS[ri],
        maxWidth: pillW - 24,
      });
      drawReelText(ctx, boxes, `${intact}/${RING_SEGMENTS} INTACT`, px + 12, pillY + 53, {
        size: 15.5,
        weight: 750,
        color: C.ink,
        maxWidth: pillW - 24,
      });
    }
  } else if (trace.style === "drop-pinball-bumpers") {
    const barX = 64;
    const barY = 412;
    const barW = 832;
    const barH = 64;
    pushSafeRect(boxes, "pinball-top-meter", barX, barY, barW, barH);
    roundRectPath(ctx, barX, barY, barW, barH, 14);
    ctx.fillStyle = "rgba(14, 24, 35, 0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(116, 185, 209, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const pct = Math.min(100, Math.round(state.fill * 100));
    const fillW = Math.max(0, (barW - 12) * Math.min(1, state.fill));
    if (fillW > 4) {
      roundRectPath(ctx, barX + 6, barY + 6, fillW, barH - 12, 10);
      const barGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      barGrad.addColorStop(0, "rgba(56, 189, 248, 0.36)");
      barGrad.addColorStop(1, "rgba(200, 255, 133, 0.48)");
      ctx.fillStyle = barGrad;
      ctx.fill();
    }
    drawReelText(
      ctx,
      boxes,
      `NEON SCORE TANK · ${formatCompactInt(state.depositedValue)} PTS`,
      barX + 18,
      barY + 40,
      {
        size: 20,
        weight: 800,
        color: C.ink,
        maxWidth: 580,
      },
    );
    drawReelText(ctx, boxes, `${pct}%`, barX + barW - 18, barY + 41, {
      size: 24,
      weight: 800,
      color: state.climaxReached ? C.primary : "#38bdf8",
      align: "right",
      maxWidth: 120,
    });
  }

  // --- 3. Chamber Frame & Grid (x: 100..860, y: 500..1396) ---
  const W = DROP_WORLD;
  pushSafeRect(
    boxes,
    "drop-chamber",
    W.left - 4,
    W.top - 4,
    W.right - W.left + 8,
    W.bottom - W.top + 8,
  );

  roundRectPath(ctx, W.left, W.top, W.right - W.left, W.bottom - W.top, 20);
  ctx.fillStyle = "rgba(9, 16, 24, 0.82)";
  ctx.fill();

  ctx.save();
  roundRectPath(ctx, W.left, W.top, W.right - W.left, W.bottom - W.top, 20);
  ctx.clip();

  // Subtle metric grid inside chamber
  ctx.strokeStyle = "rgba(42, 62, 80, 0.35)";
  ctx.lineWidth = 0.8;
  for (let gx = W.left + 38; gx < W.right; gx += 38) {
    ctx.beginPath();
    ctx.moveTo(gx, W.top);
    ctx.lineTo(gx, W.bottom);
    ctx.stroke();
  }
  for (let gy = W.top + 38; gy < W.bottom; gy += 38) {
    ctx.beginPath();
    ctx.moveTo(W.left, gy);
    ctx.lineTo(W.right, gy);
    ctx.stroke();
  }

  // --- 3a. Stage Obstacles ---
  if (trace.style === "drop-plinko-gates") {
    // Pegs
    for (const peg of PLINKO_PEGS) {
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.r + 4, 0, TAU);
      ctx.fillStyle = "rgba(116, 185, 209, 0.16)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.r, 0, TAU);
      ctx.fillStyle = "#dbeafe";
      ctx.fill();
    }

    // Multiplier laser gates
    const gates: readonly (readonly [string, number, string])[] =
      trace.mode === "compact"
        ? [
            ["+2 VALUE GATE", 965, "#34d399"],
            ["x2 MULTIPLIER GATE", 1065, "#38bdf8"],
            ["x3 HYPER GATE", 1155, "#facc15"],
          ]
        : [
            ["+2 VALUE GATE", 985, "#34d399"],
            ["x2 MULTIPLIER GATE", 1115, "#38bdf8"],
          ];
    for (const [label, gy, color] of gates) {
      ctx.fillStyle = color + "22";
      ctx.fillRect(W.left + 8, gy - 14, W.right - W.left - 16, 28);
      ctx.beginPath();
      ctx.moveTo(W.left + 8, gy);
      ctx.lineTo(W.right - 8, gy);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.font = `800 15px ${JSON.stringify(theme.fontFamily)}`;
      ctx.fillStyle = color;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(label, W.right - 18, gy - 4);
    }

    // Stacked energy shields at bottom
    const initShields = trace.frames[0].shields;
    for (let s = state.shields.length - 1; s >= 0; s--) {
      const hp = state.shields[s];
      if (hp <= 0) continue;
      const sy = 1250 + s * 16;
      const ratio = hp / initShields[s];
      roundRectPath(ctx, W.left + 12, sy, W.right - W.left - 24, 13, 6);
      ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
      ctx.fill();
      roundRectPath(
        ctx,
        W.left + 12,
        sy,
        Math.max(16, (W.right - W.left - 24) * ratio),
        13,
        6,
      );
      ctx.fillStyle = s === 0 ? "#38bdf8" : s < 3 ? "#818cf8" : "#c8ff85";
      ctx.fill();
    }
  } else if (trace.style === "drop-breakable-rings") {
    // Inner core beacon
    const coreGrad = ctx.createRadialGradient(
      RING_CENTER.x,
      RING_CENTER.y,
      4,
      RING_CENTER.x,
      RING_CENTER.y,
      54,
    );
    coreGrad.addColorStop(0, "rgba(200, 255, 133, 0.28)");
    coreGrad.addColorStop(1, "rgba(200, 255, 133, 0)");
    ctx.beginPath();
    ctx.arc(RING_CENTER.x, RING_CENTER.y, 54, 0, TAU);
    ctx.fillStyle = coreGrad;
    ctx.fill();
    ctx.font = `800 15px ${JSON.stringify(theme.fontFamily)}`;
    ctx.fillStyle = C.primary;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CORE", RING_CENTER.x, RING_CENTER.y);

    // 6 Rotating concentric breakable rings
    for (let ri = 0; ri < BREAKABLE_RING_RADII.length; ri++) {
      const R = BREAKABLE_RING_RADII[ri];
      const rot = ringRotation(ri, timeSeconds);
      const segSpan = TAU / RING_SEGMENTS;
      const ringColor = RING_COLORS[ri];
      for (let k = 0; k < RING_SEGMENTS; k++) {
        const hp = state.rings[ri][k];
        if (hp <= 0) continue;
        const a0 = rot + k * segSpan + 0.018;
        const a1 = rot + (k + 1) * segSpan - 0.018;
        ctx.beginPath();
        ctx.arc(RING_CENTER.x, RING_CENTER.y, R, a0, a1);
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = hp > 1 ? 8 : 5;
        ctx.globalAlpha = alpha * (hp > 1 ? 0.95 : 0.68);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = alpha;

    // Escape goal zone at chamber bottom
    ctx.fillStyle = "rgba(200, 255, 133, 0.14)";
    ctx.fillRect(
      RING_GOAL.left,
      RING_GOAL.top,
      RING_GOAL.right - RING_GOAL.left,
      RING_GOAL.bottom - RING_GOAL.top,
    );
    ctx.beginPath();
    ctx.moveTo(RING_GOAL.left, RING_GOAL.top);
    ctx.lineTo(RING_GOAL.right, RING_GOAL.top);
    ctx.strokeStyle = C.primary;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.font = `800 16px ${JSON.stringify(theme.fontFamily)}`;
    ctx.fillStyle = C.primary;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CORE ESCAPE GOAL", 480, (RING_GOAL.top + RING_GOAL.bottom) / 2);
  } else if (trace.style === "drop-logo-funnel-merge") {
    // Dropper inlet nozzles at chamber ceiling
    const nozzles = trace.mode === "compact" ? [-68, 0, 68] : [-44, 44];
    for (const offset of nozzles) {
      const nx = W.centerX + offset;
      roundRectPath(ctx, nx - 16, W.top - 2, 32, 18, 6);
      ctx.fillStyle = "#1e293b";
      ctx.fill();
      ctx.strokeStyle = "#ff5c97";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // Shaded area below parabolic funnel bowl
    ctx.beginPath();
    ctx.moveTo(W.left, W.bottom);
    for (let x = W.left; x <= W.right; x += 4) {
      ctx.lineTo(x, funnelBowlY(x));
    }
    ctx.lineTo(W.right, W.bottom);
    ctx.closePath();
    const bowlShade = ctx.createLinearGradient(0, 960, 0, W.bottom);
    bowlShade.addColorStop(0, "rgba(30, 58, 95, 0.25)");
    bowlShade.addColorStop(1, "rgba(7, 13, 22, 0.92)");
    ctx.fillStyle = bowlShade;
    ctx.fill();

    // Glowing parabolic funnel curve
    ctx.beginPath();
    for (let x = W.left; x <= W.right; x += 4) {
      const y = funnelBowlY(x);
      if (x === W.left) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
    ctx.lineWidth = 10;
    ctx.stroke();

    ctx.beginPath();
    for (let x = W.left; x <= W.right; x += 4) {
      const y = funnelBowlY(x);
      if (x === W.left) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 3.5;
    ctx.stroke();
  } else if (trace.style === "drop-pinball-bumpers") {
    // Score tank at bottom
    roundRectPath(
      ctx,
      PINBALL_TANK.x,
      PINBALL_TANK.y,
      PINBALL_TANK.width,
      PINBALL_TANK.height,
      16,
    );
    ctx.fillStyle = "rgba(12, 22, 34, 0.85)";
    ctx.fill();

    const fillH = PINBALL_TANK.height * Math.min(1, state.fill);
    if (fillH > 2) {
      ctx.save();
      roundRectPath(
        ctx,
        PINBALL_TANK.x,
        PINBALL_TANK.y,
        PINBALL_TANK.width,
        PINBALL_TANK.height,
        16,
      );
      ctx.clip();
      const liqY = PINBALL_TANK.y + PINBALL_TANK.height - fillH;
      const liqGrad = ctx.createLinearGradient(0, liqY, 0, PINBALL_TANK.y + PINBALL_TANK.height);
      liqGrad.addColorStop(0, "rgba(200, 255, 133, 0.62)");
      liqGrad.addColorStop(1, "rgba(56, 189, 248, 0.42)");
      ctx.beginPath();
      ctx.moveTo(PINBALL_TANK.x, PINBALL_TANK.y + PINBALL_TANK.height);
      for (let x = PINBALL_TANK.x; x <= PINBALL_TANK.x + PINBALL_TANK.width; x += 12) {
        const wave = Math.sin(x * 0.03 + timeSeconds * 6) * 3.5;
        ctx.lineTo(x, liqY + wave);
      }
      ctx.lineTo(PINBALL_TANK.x + PINBALL_TANK.width, PINBALL_TANK.y + PINBALL_TANK.height);
      ctx.closePath();
      ctx.fillStyle = liqGrad;
      ctx.fill();
      ctx.restore();
    }

    roundRectPath(
      ctx,
      PINBALL_TANK.x,
      PINBALL_TANK.y,
      PINBALL_TANK.width,
      PINBALL_TANK.height,
      16,
    );
    ctx.strokeStyle = "rgba(116, 185, 209, 0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Bumpers (+15)
    PINBALL_BUMPERS.forEach((peg, idx) => {
      const hitRecently = trace.events.some(
        (ev) =>
          ev.type === "upgrade" &&
          ev.target === idx &&
          clampedFrame >= ev.frame &&
          clampedFrame - ev.frame <= 10,
      );
      const pulse = hitRecently ? 1.1 : 1;
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, (peg.r + 8) * pulse, 0, TAU);
      ctx.fillStyle = hitRecently
        ? "rgba(200, 255, 133, 0.28)"
        : "rgba(56, 189, 248, 0.14)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.r * pulse, 0, TAU);
      ctx.fillStyle = "#112030";
      ctx.fill();
      ctx.strokeStyle = hitRecently ? C.primary : C.accent;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.font = `800 20px ${JSON.stringify(theme.fontFamily)}`;
      ctx.fillStyle = hitRecently ? C.primary : C.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("+15", peg.x, peg.y);
    });

    // Twin x2 rotor paddles
    for (let k = 0; k < 2; k++) {
      const sp = pinballSpinner(k, timeSeconds);
      ctx.beginPath();
      ctx.moveTo(sp.ax, sp.ay);
      ctx.lineTo(sp.bx, sp.by);
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 14;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.lineCap = "butt";

      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 17, 0, TAU);
      ctx.fillStyle = "#0f172a";
      ctx.fill();
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.font = `800 13px ${JSON.stringify(theme.fontFamily)}`;
      ctx.fillStyle = "#facc15";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("x2", sp.x, sp.y + 0.5);
    }
  }

  // --- 3b. Transient Merge / Upgrade / Climax Shockwaves ---
  for (const ev of trace.events) {
    const age = (clampedFrame - ev.frame) / trace.fps;
    if (age < 0) continue;
    if (ev.type === "merge" && age <= 0.42 && ev.tier) {
      const p = easeOut(age / 0.42);
      const spec = AI_MODEL_TIERS[ev.tier - 1];
      ctx.save();
      ctx.globalAlpha = alpha * (1 - p) ** 1.5;
      ctx.beginPath();
      ctx.arc(ev.x, ev.y, spec.radius * 0.7 + p * (spec.radius * 1.45), 0, TAU);
      ctx.strokeStyle = spec.rimColor;
      ctx.lineWidth = ev.tier === 8 ? 4.5 : 2.6;
      ctx.stroke();
      ctx.restore();
    } else if (ev.type === "climax" && age <= 1.2) {
      const p = easeOut(age / 1.2);
      ctx.save();
      ctx.globalAlpha = alpha * (1 - p) ** 1.4;
      ctx.beginPath();
      ctx.arc(ev.x, ev.y, 30 + p * 260, 0, TAU);
      ctx.strokeStyle = C.primary;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- 3c. Live Bouncy, Squishy Orbs ---
  const sortedBalls = [...state.balls].sort((a, b) => a.tier - b.tier || a.id - b.id);
  for (const b of sortedBalls) {
    // Area-preserving elastic squash-and-stretch oriented along collision normal while keeping icon upright!
    const scaleNormal = Math.max(0.73, Math.min(1.32, 1 - b.squash));
    const scaleTangent = 1 / scaleNormal;

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.squashAngle);
    ctx.scale(scaleNormal, scaleTangent);
    ctx.rotate(-b.squashAngle);

    if (trace.style === "drop-logo-funnel-merge") {
      const spec = AI_MODEL_TIERS[Math.max(0, Math.min(7, b.tier - 1))];
      const isTier8 = b.tier === 8;

      if (isTier8) {
        // Celebratory luminous halo behind ChatGPT orb so it shines during the 3.5s bouncy finale
        const pulse = 1 + 0.08 * Math.sin(timeSeconds * 9);
        const halo = ctx.createRadialGradient(0, 0, b.r * 0.75, 0, 0, b.r * 1.65 * pulse);
        halo.addColorStop(0, "rgba(200, 255, 95, 0.45)");
        halo.addColorStop(1, "rgba(200, 255, 95, 0)");
        ctx.beginPath();
        ctx.arc(0, 0, b.r * 1.65 * pulse, 0, TAU);
        ctx.fillStyle = halo;
        ctx.fill();
      }

      // Dark jewel-toned radial fill (high contrast >= 10:1 against white/cyan emblems, esp. Kimi & ChatGPT!)
      const grad = ctx.createRadialGradient(
        -b.r * 0.28,
        -b.r * 0.32,
        b.r * 0.12,
        0,
        0,
        b.r,
      );
      grad.addColorStop(0, spec.orbFillInner);
      grad.addColorStop(1, spec.orbFillOuter);
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, TAU);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = spec.rimColor;
      ctx.lineWidth = isTier8 ? 4 : b.r >= 40 ? 3 : 2.3;
      ctx.stroke();

      // Subtle top-left glass rim highlight (never touches center emblem)
      ctx.beginPath();
      ctx.arc(0, 0, b.r * 0.86, -Math.PI * 0.82, -Math.PI * 0.26);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
      ctx.lineWidth = Math.max(1.5, b.r * 0.055);
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.lineCap = "butt";

      const showLabel = b.r >= 32;
      const iconY = showLabel ? -b.r * 0.13 : 0;
      const iconSize = showLabel ? b.r * 0.96 : b.r * 1.12;
      drawEmblemPaths(
        ctx,
        spec.logoKey,
        spec.monogram,
        0,
        iconY,
        iconSize,
        spec.iconColor,
        atlas,
      );

      if (showLabel) {
        const labelFont = Math.max(10, Math.round(b.r * 0.22));
        ctx.font = `800 ${labelFont}px ${JSON.stringify(theme.fontFamily)}`;
        ctx.fillStyle = "#f8fafc";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(spec.shortLabel, 0, b.r * 0.62);
      }
    } else {
      // Crisp arcade value/core orb
      const isCoreReady = trace.style === "drop-breakable-rings" && b.entered;
      const orbGrad = ctx.createRadialGradient(-b.r * 0.3, -b.r * 0.3, 2, 0, 0, b.r);
      orbGrad.addColorStop(0, isCoreReady ? "#365314" : "#1e3a5f");
      orbGrad.addColorStop(1, isCoreReady ? "#142608" : "#0b1727");
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, TAU);
      ctx.fillStyle = orbGrad;
      ctx.fill();
      ctx.strokeStyle = isCoreReady || b.value >= 16 ? C.primary : "#38bdf8";
      ctx.lineWidth = 2.2;
      ctx.stroke();

      if (trace.style !== "drop-breakable-rings") {
        const valStr = formatCompactInt(b.value);
        ctx.font = `800 ${valStr.length >= 3 ? 9.5 : 11}px ${JSON.stringify(theme.fontFamily)}`;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(valStr, 0, 0.5);
      }
    }

    ctx.restore();
  }

  ctx.restore(); // end chamber clip

  // Chamber border
  roundRectPath(ctx, W.left, W.top, W.right - W.left, W.bottom - W.top, 20);
  ctx.strokeStyle = "#435869";
  ctx.lineWidth = 2.6;
  ctx.stroke();

  // --- 4. Post-Climax Live Celebration Banner (placed near top of chamber so bouncing bowl stays 100% visible!) ---
  if (state.climaxReached && state.climaxFrame !== null) {
    const celebAge = clampedFrame - state.climaxFrame;
    const pop = easeOut(Math.min(1, (celebAge + 1) / 12));
    const bannerW = 620;
    const bannerH = 92;
    const bannerX = 480 - bannerW / 2;
    const bannerY = 524;
    pushSafeRect(boxes, "climax-banner", bannerX, bannerY, bannerW, bannerH);

    ctx.save();
    ctx.globalAlpha = alpha * pop;
    roundRectPath(ctx, bannerX, bannerY, bannerW, bannerH, 20);
    ctx.fillStyle = "rgba(10, 24, 20, 0.93)";
    ctx.fill();
    ctx.strokeStyle = C.primary;
    ctx.lineWidth = 2.6;
    ctx.stroke();

    drawReelText(ctx, boxes, trace.resultBanner, 480, bannerY + 41, {
      size: 26,
      weight: 800,
      color: C.primary,
      align: "center",
      maxWidth: bannerW - 36,
    });
    const subCopy =
      trace.style === "drop-logo-funnel-merge"
        ? "All 8 AI tiers unlocked · Live bouncy physics celebration"
        : isCombined && def.stageNumber < 4
          ? `Stage ${def.stageNumber} complete · Advancing to Stage ${def.stageNumber + 1}`
          : "Goal completed · Deterministic seeded arcade run";
    drawReelText(ctx, boxes, subCopy, 480, bannerY + 72, {
      size: 16.5,
      weight: 600,
      color: "#dbe6f2",
      align: "center",
      maxWidth: bannerW - 36,
    });
    ctx.restore();
  }

  // --- 5. Bottom Live Telemetry Footer (strictly y <= 1560) ---
  const liveMass = state.balls.reduce((acc, b) => acc + b.mass, 0);
  const highestModel =
    AI_MODEL_TIERS[Math.max(0, Math.min(7, state.maxTierReached - 1))]?.name ?? "MiniMax";
  const footerLine1 =
    trace.style === "drop-logo-funnel-merge"
      ? `ORBS IN BOWL ${state.balls.length}   ·   TOTAL MASS ${liveMass}   ·   HIGHEST TIER T${Math.max(1, state.maxTierReached)} (${highestModel.toUpperCase()})`
      : `LIVE ORBS ${state.balls.length}   ·   SPAWNED ${state.spawned}   ·   CLEARED ${state.removedMass}`;

  drawReelText(ctx, boxes, footerLine1, 480, 1468, {
    size: 19.5,
    weight: 700,
    color: C.ink,
    align: "center",
    maxWidth: 824,
  });

  drawReelText(
    ctx,
    boxes,
    "Code in oyren-ai/animations · Deterministic fixed-step physics",
    480,
    1506,
    {
      size: 17.5,
      weight: 500,
      color: C.muted,
      align: "center",
      maxWidth: 824,
    },
  );

  ctx.restore();
  paintFilmFinish(ctx, globalFrame);
  return boxes;
}
