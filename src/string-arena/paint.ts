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
  burstParticles,
  STRING_ARENA,
  type StringArenaTrace,
} from "./sim.ts";

const C = theme.colors;

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

function paintBackdrop(ctx: CanvasRenderingContext2D, globalFrame: number) {
  const sec = globalFrame / VIDEO.fps;
  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);

  const mesh = ctx.createRadialGradient(
    480 + Math.sin(sec * 0.45) * 55,
    940,
    0,
    480,
    960,
    920,
  );
  mesh.addColorStop(0, "rgba(116, 185, 209, 0.13)");
  mesh.addColorStop(0.65, "rgba(20, 34, 48, 0.06)");
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

export function paintStringArenaFrame(
  ctx: CanvasRenderingContext2D,
  trace: StringArenaTrace,
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
  const clampedFrame = Math.max(0, Math.min(localFrame, trace.frames.length - 1));
  const state = trace.frames[clampedFrame];
  const def = trace.definition;

  paintBackdrop(ctx, globalFrame);

  // Smooth transition fade at round boundaries
  const enterFade = Math.min(1, (localFrame + 1) / 8);
  const exitWindow = fadeOutAtEnd ? 10 : 7;
  const exitFade =
    1 -
    easeIn(
      (localFrame - (trace.totalRoundFrames - exitWindow)) / exitWindow,
    );
  const alpha = Math.max(0, Math.min(1, enterFade * exitFade));

  ctx.save();
  ctx.globalAlpha = alpha;

  // --- 1. Top Header & Explicit Rule HUD (strictly inside x: 60..900, y: 220..555) ---
  const badgeX = 64;
  const badgeY = 228;
  const badgeH = 34;
  const badgeText = isCombined
    ? `ROUND ${def.roundNumber} / 3 · ${def.category.toUpperCase()}`
    : `STRING ARENA · ${def.category.toUpperCase()}`;
  ctx.font = `750 16px ${JSON.stringify(theme.fontFamily)}`;
  const badgeW = Math.min(440, Math.ceil(ctx.measureText(badgeText).width) + 28);
  pushSafeRect(boxes, "round-pill", badgeX, badgeY, badgeW, badgeH);
  roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 17);
  ctx.fillStyle = "rgba(20, 32, 45, 0.92)";
  ctx.fill();
  ctx.strokeStyle = "rgba(200, 255, 133, 0.48)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  drawReelText(ctx, boxes, badgeText, badgeX + 14, badgeY + 23, {
    size: 15.5,
    weight: 750,
    color: C.primary,
    maxWidth: badgeW - 24,
  });

  if (isCombined) {
    // 3-step round progress pips
    for (let r = 1; r <= 3; r++) {
      const pipX = badgeX + badgeW + 14 + (r - 1) * 20;
      const pipY = badgeY + badgeH / 2;
      pushSafeRect(boxes, `round-pip-${r}`, pipX - 6, pipY - 6, 12, 12);
      ctx.beginPath();
      ctx.arc(pipX, pipY, r === def.roundNumber ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle =
        r < def.roundNumber
          ? C.accent
          : r === def.roundNumber
            ? C.primary
            : "rgba(148, 163, 184, 0.35)";
      ctx.fill();
    }
  }

  // Elapsed round clock on right edge of safe zone (x <= 896)
  const clockSec = Math.min(trace.finishTime, state.time).toFixed(1) + "s";
  drawReelText(ctx, boxes, clockSec, 894, badgeY + 24, {
    size: 20,
    weight: 700,
    color: C.muted,
    align: "right",
    maxWidth: 120,
  });

  // Main title
  drawReelText(
    ctx,
    boxes,
    `${def.category} · Zero-G String Arena`,
    64,
    304,
    {
      size: 38,
      weight: 800,
      color: C.ink,
      maxWidth: 830,
    },
  );

  // Explicit rules from frame 0 (t3, t4)
  drawReelText(
    ctx,
    boxes,
    "Start with 12 lines · wall bounce +1 line · rival touch cuts · 0 = out",
    64,
    341,
    {
      size: 20.5,
      weight: 600,
      color: "#dbe6f2",
      maxWidth: 830,
    },
  );

  // Provenance subtitle (t4)
  drawReelText(
    ctx,
    boxes,
    `Seed #${def.seed} · Zero gravity · No ball-bounce transfers · Seeded physics · not a benchmark`,
    64,
    370,
    {
      size: 16.5,
      weight: 500,
      color: C.muted,
      maxWidth: 830,
    },
  );

  // --- 2. Five Contender HUD Cards (x: 64..896, y: 390..532) ---
  const cardW = 158;
  const cardGap = 10.5;
  const cardY = 390;
  const cardH = 140;

  for (let i = 0; i < 5; i++) {
    const ball = state.balls[i];
    const count = state.hudCounts[i];
    const alive = ball.alive && count > 0;
    const isWinner = state.phase === "winner" && i === trace.winnerId;
    const cardX = 64 + i * (cardW + cardGap);

    pushSafeRect(boxes, `contender-card-${i}`, cardX, cardY, cardW, cardH);

    ctx.save();
    roundRectPath(ctx, cardX, cardY, cardW, cardH, 16);
    ctx.fillStyle = isWinner
      ? "rgba(24, 42, 34, 0.95)"
      : alive
        ? "rgba(16, 27, 39, 0.9)"
        : "rgba(11, 18, 26, 0.65)";
    ctx.fill();
    ctx.strokeStyle = isWinner
      ? C.primary
      : alive
        ? ball.color
        : "rgba(71, 85, 105, 0.4)";
    ctx.lineWidth = isWinner ? 2.6 : alive ? 1.7 : 1.1;
    ctx.stroke();

    // Mini emblem disc inside card
    const iconCx = cardX + 26;
    const iconCy = cardY + 30;
    ctx.beginPath();
    ctx.arc(iconCx, iconCy, 16, 0, Math.PI * 2);
    ctx.fillStyle = alive ? "#0b1420" : "#090f17";
    ctx.fill();
    ctx.strokeStyle = alive ? ball.color : "#475569";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.globalAlpha = alpha * (alive ? 1 : 0.42);
    drawEmblemPaths(
      ctx,
      ball.logo,
      ball.monogram,
      iconCx,
      iconCy,
      19,
      alive ? "#ffffff" : "#94a3b8",
      atlas,
    );
    ctx.globalAlpha = alpha;

    // Live integer string count (matches exact live stringsByOwner[i].length)
    drawReelText(
      ctx,
      boxes,
      String(count),
      cardX + cardW - 12,
      cardY + 35,
      {
        size: 29,
        weight: 800,
        color: isWinner ? C.primary : alive ? ball.color : "#64748b",
        align: "right",
        maxWidth: 72,
      },
    );

    drawReelText(
      ctx,
      boxes,
      alive ? "LINES" : "OUT",
      cardX + cardW - 12,
      cardY + 53,
      {
        size: 11.5,
        weight: 700,
        color: alive ? "#94a3b8" : "#64748b",
        align: "right",
        maxWidth: 64,
      },
    );

    // Contender name
    drawReelText(
      ctx,
      boxes,
      ball.name,
      cardX + 12,
      cardY + 94,
      {
        size: 17.5,
        weight: 700,
        color: alive ? C.ink : "#64748b",
        maxWidth: cardW - 24,
      },
    );

    // Live line meter bar
    const barX = cardX + 12;
    const barY = cardY + 112;
    const barW = cardW - 24;
    const barH = 8;
    roundRectPath(ctx, barX, barY, barW, barH, 4);
    ctx.fillStyle = "rgba(30, 41, 59, 0.85)";
    ctx.fill();
    if (count > 0) {
      const fillRatio = Math.max(0.08, Math.min(1, count / 22));
      roundRectPath(ctx, barX, barY, barW * fillRatio, barH, 4);
      ctx.fillStyle = isWinner ? C.primary : ball.color;
      ctx.fill();
    }
    ctx.restore();
  }

  // --- 3. Circular Zero-Gravity String Arena (cx=480, cy=992, r=414 -> x: 66..894, y: 578..1406) ---
  const { cx, cy, r } = STRING_ARENA;
  pushSafeRect(boxes, "string-arena-circle", cx - r, cy - r, r * 2, r * 2);

  // Outer ambient halo
  const halo = ctx.createRadialGradient(cx, cy, r * 0.72, cx, cy, r + 24);
  halo.addColorStop(0, "rgba(12, 22, 33, 0)");
  halo.addColorStop(0.86, "rgba(116, 185, 209, 0.12)");
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 24, 0, Math.PI * 2);
  ctx.fill();

  // Arena disc fill
  const discGrad = ctx.createRadialGradient(cx, cy - 80, 20, cx, cy, r);
  discGrad.addColorStop(0, "#101c29");
  discGrad.addColorStop(0.75, "#0a121b");
  discGrad.addColorStop(1, "#070d14");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = discGrad;
  ctx.fill();

  // Subtle concentric target rings inside arena
  for (const frac of [0.34, 0.67]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * frac, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(67, 88, 105, 0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Clip interior chords & sparks cleanly inside the arena rim
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // 3a. Live anchored strings for each surviving contender
  for (const owner of state.balls) {
    if (!owner.alive) continue;
    const ownedIds = state.stringsByOwner[owner.id];
    for (const sid of ownedIds) {
      const anchor = trace.anchors[sid];
      const ageFrames = clampedFrame - anchor.bornFrame;
      const isFreshGain = anchor.bornFrame > 0 && ageFrames >= 0 && ageFrames <= 18;

      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(owner.x, owner.y);
      if (isFreshGain) {
        const flash = 1 - ageFrames / 18;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.4 + flash * 2.2;
        ctx.globalAlpha = alpha * (0.55 + 0.45 * flash);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(owner.x, owner.y);
      ctx.strokeStyle = owner.color;
      ctx.lineWidth = isFreshGain ? 2.4 : 1.75;
      ctx.globalAlpha = alpha * (isFreshGain ? 0.96 : 0.72);
      ctx.stroke();

      // Anchor pin on rim
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, isFreshGain ? 4.4 : 2.8, 0, Math.PI * 2);
      ctx.fillStyle = isFreshGain ? "#ffffff" : owner.color;
      ctx.globalAlpha = alpha * 0.95;
      ctx.fill();
    }
  }
  ctx.globalAlpha = alpha;

  // 3b. Transient arena events: wall-bounce +1 pulses, body-bounce neutral ripples, string cuts, & full-disc 0-string bursts
  for (const ev of trace.events) {
    const age = (clampedFrame - ev.frame) / VIDEO.fps;
    if (age < 0) continue;

    if (ev.kind === "gain" && age <= 0.36) {
      const p = easeOut(age / 0.36);
      const color = state.balls[ev.owner].color;
      ctx.save();
      ctx.globalAlpha = alpha * (1 - p) ** 1.5;
      ctx.beginPath();
      ctx.arc(ev.x, ev.y, 8 + p * 34, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.6;
      ctx.stroke();

      // Pull "+1" callout slightly inward toward arena center so it stays clearly legible
      const dx = cx - ev.x;
      const dy = cy - ev.y;
      const d = Math.hypot(dx, dy) || 1;
      const lx = ev.x + (dx / d) * (28 + p * 16);
      const ly = ev.y + (dy / d) * (28 + p * 16);
      ctx.font = `800 17px ${JSON.stringify(theme.fontFamily)}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.fillText("+1", lx, ly);
      ctx.restore();
    } else if (ev.kind === "body" && age <= 0.2) {
      // Neutral shock ring on ball-ball elastic bounce (zero string gain/transfer)
      const p = easeOut(age / 0.2);
      ctx.save();
      ctx.globalAlpha = alpha * (1 - p) * 0.55;
      ctx.beginPath();
      ctx.arc(ev.x, ev.y, 10 + p * 24, 0, Math.PI * 2);
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    } else if (ev.kind === "cut" && age <= 0.24) {
      const p = easeOut(age / 0.24);
      const color = state.balls[ev.owner].color;
      ctx.save();
      ctx.globalAlpha = alpha * (1 - p) ** 1.6;
      ctx.beginPath();
      ctx.arc(ev.x, ev.y, 4 + p * 22, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ev.x, ev.y, 2.5 + (1 - p) * 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
    } else if (ev.kind === "out" && age <= 0.68) {
      // Full-disc volume particle burst (including exact disc centre — zero hollow ring gap)
      const fade = (1 - age / 0.68) ** 1.45;
      const color = state.balls[ev.owner].color;
      const pts = burstParticles(ev, age);
      ctx.save();
      for (let idx = 0; idx < pts.length; idx++) {
        const pt = pts[idx];
        ctx.globalAlpha = alpha * fade * (idx < 9 ? 0.98 : 0.88);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
        ctx.fillStyle = idx === 0 || idx % 5 === 0 ? "#ffffff" : color;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // 3c. Motion wakes + Live Contender Balls
  for (const ball of state.balls) {
    if (!ball.alive) continue;
    for (let back = 6; back >= 2; back -= 2) {
      const prev = trace.frames[Math.max(0, clampedFrame - back)]?.balls[ball.id];
      if (prev && prev.alive) {
        ctx.beginPath();
        ctx.arc(prev.x, prev.y, ball.r * (0.58 - back * 0.05), 0, Math.PI * 2);
        ctx.fillStyle = ball.color;
        ctx.globalAlpha = alpha * (0.16 - back * 0.018);
        ctx.fill();
      }
    }
    ctx.globalAlpha = alpha;

    // Outer glow
    const glow = ctx.createRadialGradient(ball.x, ball.y, ball.r * 0.6, ball.x, ball.y, ball.r * 1.55);
    glow.addColorStop(0, ball.color + "55");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r * 1.55, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // High-contrast dark obsidian orb body
    const orbFill = ctx.createRadialGradient(
      ball.x - ball.r * 0.3,
      ball.y - ball.r * 0.32,
      2,
      ball.x,
      ball.y,
      ball.r,
    );
    orbFill.addColorStop(0, "#1e3246");
    orbFill.addColorStop(0.65, "#0d1824");
    orbFill.addColorStop(1, "#070d14");
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = orbFill;
    ctx.fill();
    ctx.strokeStyle = ball.color;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Crisp icon emblem
    drawEmblemPaths(
      ctx,
      ball.logo,
      ball.monogram,
      ball.x,
      ball.y,
      ball.r * 1.18,
      "#ffffff",
      atlas,
    );
  }

  ctx.restore(); // end arena clip

  // Arena structural rim
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#4c687d";
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(200, 255, 133, 0.22)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // --- 4. Round Winner Banner during winner hold ---
  if (state.phase === "winner") {
    const winner = state.balls[trace.winnerId];
    const winLines = state.hudCounts[trace.winnerId];
    const holdProgress = Math.min(1, (clampedFrame - trace.finishFrame + 1) / 12);
    const pop = easeOut(holdProgress);
    const bannerW = 640;
    const bannerH = 112;
    const bannerX = cx - bannerW / 2;
    const bannerY = cy - bannerH / 2;
    pushSafeRect(boxes, "winner-banner", bannerX, bannerY, bannerW, bannerH);

    ctx.save();
    ctx.globalAlpha = alpha * pop;
    roundRectPath(ctx, bannerX, bannerY, bannerW, bannerH, 24);
    ctx.fillStyle = "rgba(9, 17, 26, 0.94)";
    ctx.fill();
    ctx.strokeStyle = winner.color;
    ctx.lineWidth = 2.8;
    ctx.stroke();

    drawReelText(
      ctx,
      boxes,
      `ROUND ${def.roundNumber} WINNER · ${winner.name.toUpperCase()}`,
      cx,
      bannerY + 48,
      {
        size: 28,
        weight: 800,
        color: C.primary,
        align: "center",
        maxWidth: bannerW - 44,
      },
    );
    drawReelText(
      ctx,
      boxes,
      `${winLines} ${winLines === 1 ? "line" : "lines"} remaining · +${trace.wallGains} wall bounces · ${trace.cuts} cuts`,
      cx,
      bannerY + 84,
      {
        size: 18.5,
        weight: 600,
        color: "#dbe6f2",
        align: "center",
        maxWidth: bannerW - 44,
      },
    );
    ctx.restore();
  }

  // --- 5. Bottom Live Telemetry Footer (strictly y <= 1560) ---
  const aliveBalls = state.balls.filter((b) => b.alive).length;
  const activeLines = state.hudCounts.reduce((a, b) => a + b, 0);
  const gainsSoFar = trace.events.filter(
    (e) => e.kind === "gain" && e.frame <= clampedFrame,
  ).length;
  const cutsSoFar = trace.events.filter(
    (e) => e.kind === "cut" && e.frame <= clampedFrame,
  ).length;

  drawReelText(
    ctx,
    boxes,
    `ALIVE ${aliveBalls}/5   ·   ACTIVE LINES ${activeLines}   ·   WALL +1 GAINS ${gainsSoFar}   ·   CUTS ${cutsSoFar}`,
    480,
    1476,
    {
      size: 20,
      weight: 700,
      color: C.ink,
      align: "center",
      maxWidth: 824,
    },
  );

  drawReelText(
    ctx,
    boxes,
    "Code in oyren-ai/animations · 960 Hz swept-contact zero-gravity solver",
    480,
    1514,
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
