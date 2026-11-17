import { VIDEO } from "../settings.ts";
import {
  clamp,
  drawCentredTitleBlock,
  lerp,
  MUSIC_FONT_STACK,
  MUSIC_STAGE,
  smoothstep,
} from "../music/types.ts";
import {
  CHUTE_ROLL_DURATION_SEC,
  FALL_DURATION_SEC,
  type RopeHarpSimulation,
} from "./sim.ts";

function drawScissors(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  snipProgress: number, // 0 = open approaching, 0.5 = closed snip!, 1 = opening & departing
  flipLeft: boolean,
): void {
  // Open angle closes sharply at snipProgress = 0.5
  const distFromSnip = Math.abs(snipProgress - 0.5) * 2; // 1 -> 0 -> 1
  const bladeAngle = 0.04 + 0.44 * Math.pow(distFromSnip, 0.75);
  const alpha =
    snipProgress < 0.18
      ? snipProgress / 0.18
      : snipProgress > 0.78
        ? (1 - snipProgress) / 0.22
        : 1;

  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.translate(x, y);
  if (flipLeft) ctx.scale(-1.32, 1.32);
  else ctx.scale(1.32, 1.32);

  // Upper & lower gleaming steel/gold blades pivoting at (0, 0)
  for (const sign of [-1, 1] as const) {
    ctx.save();
    ctx.rotate(sign * bladeAngle);

    // Blade pointing toward string at (0,0) from handle on right (+x)
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-22, 0);
    ctx.lineTo(14, sign * 5.5);
    ctx.lineTo(16, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Brass finger-ring handle
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(12, sign * 2);
    ctx.lineTo(28, sign * 9);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(35, sign * 12, 8.5, 6.2, sign * 0.25, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  // Brass pivot screw
  ctx.fillStyle = "#fde047";
  ctx.beginPath();
  ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
  ctx.fill();

  // Snip spark burst right at blade closure
  if (distFromSnip < 0.28) {
    const sp = 1 - distFromSnip / 0.28;
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#fef08a";
    ctx.lineWidth = 2;
    ctx.globalAlpha = sp * 0.9;
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3 + 0.25;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
      ctx.lineTo(Math.cos(a) * (10 + 14 * (1 - sp)), Math.sin(a) * (10 + 14 * (1 - sp)));
      ctx.stroke();
    }
  }

  ctx.restore();
}

export function paintRopeHarpFrame(
  ctx: CanvasRenderingContext2D,
  sim: RopeHarpSimulation,
  frame: number,
): void {
  const sec = frame / VIDEO.fps;
  const dur = sim.score.durationSec;

  // Compute accent camera pulse (strictly <= 2.2% zoom so within 3% standard!)
  let accentKick = 0;
  for (const w of sim.weights) {
    let dt = sec - w.impactTime;
    if (dt < -dur * 0.5) dt += dur;
    if (dt >= 0 && dt < 0.2) {
      const k = Math.exp(-dt * 18) * w.velocity * (w.voice === "bell" ? 1.0 : 0.65);
      if (k > accentKick) accentKick = k;
    }
  }
  const zoom = 1 + clamp(accentKick * 0.02, 0, 0.022);

  // Rich workshop / concert-hall background
  const bg = ctx.createLinearGradient(0, 0, 0, VIDEO.height);
  bg.addColorStop(0, "#090d18");
  bg.addColorStop(0.5, "#0f172a");
  bg.addColorStop(1, "#080c17");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);

  // Steady centred title & subtitle (y = 192 / 234, never overlaps art >= 296)
  drawCentredTitleBlock(ctx, sim.score.title, sim.score.subtitle, {
    titleColor: "#f8fafc",
    subtitleColor: "rgba(226, 232, 240, 0.75)",
    accentColor: "rgba(251, 191, 36, 0.36)",
  });

  ctx.save();
  ctx.translate(MUSIC_STAGE.cx, MUSIC_STAGE.cy);
  ctx.scale(zoom, zoom);
  ctx.translate(-MUSIC_STAGE.cx, -MUSIC_STAGE.cy);

  const L = MUSIC_STAGE.left; // 54
  const R = MUSIC_STAGE.right; // 1026
  const CX = MUSIC_STAGE.cx; // 540
  const TOP = 296;
  const BOT = 1590;

  // 1. Symmetrical Grand Brass Rope-Harp Frame (x = 56 .. 1024, y = 296 .. 1590)
  ctx.save();
  // Subtle warm acoustic backplane glow
  const backGlow = ctx.createRadialGradient(CX, 920, 40, CX, 920, 560);
  backGlow.addColorStop(0, "rgba(251, 191, 36, 0.075)");
  backGlow.addColorStop(0.6, "rgba(56, 189, 248, 0.04)");
  backGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = backGlow;
  ctx.fillRect(L, TOP, R - L, BOT - TOP);

  // Side mahogany & brass pillars
  for (const px of [L + 4, R - 18]) {
    const pGrad = ctx.createLinearGradient(px, TOP, px + 14, TOP);
    pGrad.addColorStop(0, "#451a03");
    pGrad.addColorStop(0.5, "#b45309");
    pGrad.addColorStop(1, "#451a03");
    ctx.fillStyle = pGrad;
    ctx.fillRect(px, TOP + 24, 14, BOT - TOP - 44);
    ctx.strokeStyle = "rgba(251, 191, 36, 0.42)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px, TOP + 24, 14, BOT - TOP - 44);
  }

  // Top Spool & Pulley Crown Beam (y = 298 .. 346)
  const crownGrad = ctx.createLinearGradient(L, TOP, L, TOP + 44);
  crownGrad.addColorStop(0, "#78350f");
  crownGrad.addColorStop(0.45, "#d97706");
  crownGrad.addColorStop(1, "#451a03");
  ctx.fillStyle = crownGrad;
  ctx.fillRect(L, TOP, R - L, 44);
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 2;
  ctx.strokeRect(L, TOP, R - L, 44);

  // Brass pulley wheels above every chime column
  for (const bar of sim.bars) {
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.arc(bar.cx, TOP + 34, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#451a03";
    ctx.beginPath();
    ctx.arc(bar.cx, TOP + 34, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Subtle background harp guide wires so every column reads clearly
  ctx.strokeStyle = "rgba(148, 163, 184, 0.11)";
  ctx.lineWidth = 1;
  for (const bar of sim.bars) {
    ctx.beginPath();
    ctx.moveTo(bar.cx, TOP + 42);
    ctx.lineTo(bar.cx, bar.yTop);
    ctx.stroke();
  }
  ctx.restore();

  // 2. Determine next upcoming weight per column + active falling/rolling weights
  // Show queued hanging weights within a 5.5s lookahead window so strings populate the upper frame cleanly!
  const lookaheadSec = 5.2;

  // Draw Hanging Ropes & Queued Weights + Snip Recoil + Falling Weights + Rolling Weights
  const bucketHits = new Float32Array(sim.buckets.length);
  const bucketCounts = new Int32Array(sim.buckets.length);
  const barGlow = new Float32Array(sim.bars.length);
  const barWobble = new Float32Array(sim.bars.length);

  // Pre-scan bar vibrations & bucket tallies
  for (const w of sim.weights) {
    if (w.impactTime + CHUTE_ROLL_DURATION_SEC <= sec) {
      bucketCounts[w.bucketIndex]++;
    }
    let dtImpact = sec - w.impactTime;
    if (dtImpact < -dur * 0.5) dtImpact += dur;
    if (dtImpact >= 0 && dtImpact < 0.95) {
      const g = Math.exp(-dtImpact * 4.2) * w.velocity;
      if (g > barGlow[w.barIndex]) barGlow[w.barIndex] = g;
      barWobble[w.barIndex] +=
        Math.sin(dtImpact * 58) * Math.exp(-dtImpact * 9.5) * 7.5 * w.velocity;
    }
    const dtBucket = dtImpact - CHUTE_ROLL_DURATION_SEC;
    if (dtBucket >= 0 && dtBucket < 0.45) {
      const bh = Math.exp(-dtBucket * 8) * w.velocity;
      if (bh > bucketHits[w.bucketIndex]) bucketHits[w.bucketIndex] = bh;
    }
  }

  // 3. Draw Symmetrical Brass Chutes (y = 1245 .. 1455) & 5 Collector Buckets (y = 1458 .. 1572)
  ctx.save();
  // Chute guide rails leading from chime rack into the 5 buckets
  ctx.strokeStyle = "rgba(251, 191, 36, 0.32)";
  ctx.lineWidth = 3;
  for (const b of sim.buckets) {
    const spanLeft = clamp(b.cx - 92, L + 18, R - 18);
    const spanRight = clamp(b.cx + 92, L + 18, R - 18);
    ctx.beginPath();
    ctx.moveTo(spanLeft, 1255);
    ctx.quadraticCurveTo(lerp(spanLeft, b.cx - 38, 0.5), 1375, b.cx - 42, b.yTop + 4);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(spanRight, 1255);
    ctx.quadraticCurveTo(lerp(spanRight, b.cx + 38, 0.5), 1375, b.cx + 42, b.yTop + 4);
    ctx.stroke();
  }

  // Draw the 5 symmetrical collector buckets
  for (const b of sim.buckets) {
    const flash = bucketHits[b.index];
    const topW = b.width;
    const botW = b.width * 0.78;
    const y0 = b.yTop;
    const y1 = b.yTop + b.height;

    const bGrad = ctx.createLinearGradient(b.cx - topW * 0.5, y0, b.cx + topW * 0.5, y1);
    bGrad.addColorStop(0, "#1e293b");
    bGrad.addColorStop(0.5, "#334155");
    bGrad.addColorStop(1, "#0f172a");

    ctx.fillStyle = bGrad;
    ctx.beginPath();
    ctx.moveTo(b.cx - topW * 0.5, y0);
    ctx.lineTo(b.cx + topW * 0.5, y0);
    ctx.lineTo(b.cx + botW * 0.5, y1);
    ctx.lineTo(b.cx - botW * 0.5, y1);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = flash > 0.05 ? "#fef08a" : b.color;
    ctx.lineWidth = 2.4 + flash * 2;
    ctx.stroke();

    // Rim highlight
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 0.45 + 0.45 * flash;
    ctx.fillRect(b.cx - topW * 0.5 - 3, y0 - 4, topW + 6, 7);
    ctx.globalAlpha = 1;

    // Smoothly drain bucket tally over the final 1.1s so loop joins frame 0 at 0 cleanly!
    const loopDrain = sec > dur - 1.1 ? 1 - smoothstep(dur - 1.1, dur - 0.05, sec) : 1;
    const displayedCount = Math.round(bucketCounts[b.index] * loopDrain);

    // Glowing collected orbs visible inside bucket + centred count
    const orbsShown = Math.min(8, displayedCount);
    for (let k = 0; k < orbsShown; k++) {
      const ox = b.cx + ((k % 4) - 1.5) * 18;
      const oy = y1 - 18 - Math.floor(k / 4) * 16;
      ctx.fillStyle = b.color;
      ctx.globalAlpha = 0.55 * loopDrain;
      ctx.beginPath();
      ctx.arc(ox, oy, 7.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = `700 22px ${MUSIC_FONT_STACK}`;
    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(displayedCount), b.cx, y0 + 44);
  }

  // Symmetrical bottom pedestal rail (y = 1574 .. 1590)
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(L, 1574, R - L, 16);
  ctx.strokeStyle = "rgba(251, 191, 36, 0.42)";
  ctx.lineWidth = 1.8;
  ctx.strokeRect(L, 1574, R - L, 16);
  ctx.restore();

  // 4. Draw Tuned Chime Bars & Symmetrical Cathedral Resonator Tubes (y = 1082 .. 1245)
  ctx.save();
  for (const bar of sim.bars) {
    const glow = barGlow[bar.barIndex];
    const wob = barWobble[bar.barIndex];

    // Brass resonator tube beneath chime bar
    const tubeW = bar.width * 0.64;
    const tubeGrad = ctx.createLinearGradient(
      bar.cx - tubeW * 0.5,
      bar.yTop + 22,
      bar.cx + tubeW * 0.5,
      bar.yTop + 22 + bar.tubeLength,
    );
    tubeGrad.addColorStop(0, "#334155");
    tubeGrad.addColorStop(0.5, "#64748b");
    tubeGrad.addColorStop(1, "#1e293b");
    ctx.fillStyle = tubeGrad;
    ctx.fillRect(bar.cx - tubeW * 0.5, bar.yTop + 22, tubeW, bar.tubeLength);
    ctx.strokeStyle = glow > 0.05 ? bar.glowColor : "rgba(148, 163, 184, 0.3)";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(bar.cx - tubeW * 0.5, bar.yTop + 22, tubeW, bar.tubeLength);

    // Chime bar body (depresses & wobbles on impact!)
    const bx = bar.cx - bar.width * 0.5;
    const by = bar.yTop + wob;
    ctx.fillStyle = glow > 0.08 ? bar.glowColor : bar.color;
    ctx.beginPath();
    ctx.roundRect(bx, by, bar.width, 20, 5);
    ctx.fill();

    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = glow > 0.1 ? 2.2 : 1.0;
    ctx.globalAlpha = 0.45 + 0.55 * clamp(glow, 0, 1);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Additive ring halo on strike
    if (glow > 0.03) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = clamp(glow * 0.65, 0, 0.75);
      ctx.fillStyle = bar.color;
      ctx.beginPath();
      ctx.ellipse(bar.cx, by + 10, bar.width * (0.9 + glow * 0.8), 22 + glow * 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Crisp note label centred on each chime bar
    ctx.font = `700 12px ${MUSIC_FONT_STACK}`;
    ctx.fillStyle = "#0f172a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(bar.label, bar.cx, by + 10.5);
  }
  ctx.restore();

  // 5. Draw Hanging Strings, Weights, Animated Scissors, Falling Weights & Rolling Weights!
  const activeScissors: { x: number; y: number; prog: number; flip: boolean }[] = [];

  for (const w of sim.weights) {
    // Seamless wrap-around relative to snipTime
    let dtSnip = sec - w.snipTime;
    if (dtSnip < -dur * 0.5) dtSnip += dur;
    if (dtSnip > dur * 0.5) dtSnip -= dur;

    if (dtSnip < 0 && dtSnip >= -lookaheadSec) {
      // Weight is hanging on its string waiting to be snipped!
      const appear = smoothstep(-lookaheadSec, -lookaheadSec + 0.55, dtSnip);
      // Descends gently from spool into hang position as its turn approaches
      const settle = smoothstep(-lookaheadSec, -0.45, dtSnip);
      const sway = Math.sin(sec * 2.6 + w.noteIndex * 0.9) * 2.5 * (1 - settle * 0.5);
      const curY = lerp(w.ySpool + 44, w.yHang, settle);
      const curX = w.x + sway;

      ctx.save();
      ctx.globalAlpha = 0.25 + 0.75 * appear;
      // Taut golden silk cord from top spool to weight
      ctx.strokeStyle = dtSnip > -0.35 ? "#fef08a" : "rgba(226, 232, 240, 0.58)";
      ctx.lineWidth = dtSnip > -0.35 ? 2.4 : 1.6;
      ctx.beginPath();
      ctx.moveTo(w.x, w.ySpool + 6);
      ctx.lineTo(curX, curY - 14);
      ctx.stroke();

      // Hanging brass/jewel weight
      const radius = w.voice === "bass" ? 15.5 : 13.5;
      ctx.fillStyle = w.color;
      ctx.beginPath();
      ctx.arc(curX, curY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f8fafc";
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Specular highlight
      ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
      ctx.beginPath();
      ctx.arc(curX - radius * 0.3, curY - radius * 0.32, radius * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Scissors glide in 0.18s before snip!
      if (dtSnip >= -0.18) {
        const prog = (dtSnip + 0.18) / 0.36; // 0 -> 0.5 at dtSnip=0!
        activeScissors.push({
          x: curX,
          y: curY - 46,
          prog,
          flip: w.barIndex >= sim.bars.length / 2,
        });
      }
    } else if (dtSnip >= 0 && dtSnip < FALL_DURATION_SEC) {
      // Weight has just been snipped and is accelerating downward onto its chime bar!
      const u = dtSnip / FALL_DURATION_SEC;
      const wy = lerp(w.yHang, w.yBar, u * u);
      const stretchY = 1 + 0.22 * u;
      const squashX = 1 / Math.sqrt(stretchY);
      const radius = w.voice === "bass" ? 15.5 : 13.5;

      // Recoiling upper severed string curling back toward spool
      const recoil = Math.min(1, dtSnip / 0.22);
      const stringEndY = lerp(w.yHang - 46, w.ySpool + 18, recoil * recoil);
      ctx.save();
      ctx.globalAlpha = 1 - recoil;
      ctx.strokeStyle = "#fef08a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w.x, w.ySpool + 6);
      ctx.quadraticCurveTo(
        w.x + Math.sin(dtSnip * 45) * 12,
        lerp(w.ySpool + 6, stringEndY, 0.6),
        w.x,
        stringEndY,
      );
      ctx.stroke();
      ctx.restore();

      // Motion trail + falling weight
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = w.color;
      ctx.globalAlpha = 0.48;
      ctx.lineWidth = radius * 1.1;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(w.x, Math.max(w.yHang, wy - 36 * u));
      ctx.lineTo(w.x, wy);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(w.x, wy);
      ctx.scale(squashX, stretchY);
      ctx.fillStyle = w.color;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      if (dtSnip <= 0.18) {
        const prog = (dtSnip + 0.18) / 0.36; // 0.5 -> 1.0 departing!
        activeScissors.push({
          x: w.x,
          y: w.yHang - 46,
          prog,
          flip: w.barIndex >= sim.bars.length / 2,
        });
      }
    } else if (
      dtSnip >= FALL_DURATION_SEC &&
      dtSnip < FALL_DURATION_SEC + CHUTE_ROLL_DURATION_SEC
    ) {
      // Weight struck chime bar at dtSnip == FALL_DURATION_SEC (sec == w.impactTime),
      // bounces & rolls down brass chute into its collector bucket!
      const dtRoll = dtSnip - FALL_DURATION_SEC;
      const u = dtRoll / CHUTE_ROLL_DURATION_SEC;
      const rx = lerp(w.x, w.xBucket, smoothstep(0.12, 0.95, u));
      // Bounce arc for first 0.22 of roll, then smooth gravity drop down chute into bucket
      const bounceOffset = u < 0.28 ? -Math.sin((u / 0.28) * Math.PI) * 34 : 0;
      const ry = lerp(w.yBar, w.yBucket, u * u) + bounceOffset;

      // Impact squash on first 60 ms
      const impactSquash = dtRoll < 0.065 ? (1 - dtRoll / 0.065) * 0.28 : 0;
      const sx = 1 + impactSquash;
      const sy = 1 - impactSquash * 0.75;
      const radius = w.voice === "bass" ? 14.5 : 12.5;

      // Impact shockwave ring at chime bar
      if (dtRoll < 0.22) {
        const p = dtRoll / 0.22;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = "#fef08a";
        ctx.lineWidth = 2.5 * (1 - p);
        ctx.globalAlpha = 0.85 * (1 - p);
        ctx.beginPath();
        ctx.arc(w.x, w.yBar + 8, 14 + 46 * p, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(rx, ry);
      ctx.scale(sx, sy);
      ctx.globalAlpha = u > 0.88 ? (1 - u) / 0.12 : 1;
      ctx.fillStyle = w.color;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f8fafc";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Render scissors on top of strings so blades are crisp & unmistakable
  for (const sc of activeScissors) {
    drawScissors(ctx, sc.x, sc.y, sc.prog, sc.flip);
  }

  ctx.restore();
}
