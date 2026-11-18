import { VIDEO } from "../settings.ts";
import {
  clamp,
  drawCentredTitleBlock,
  lerp,
  MUSIC_FONT_STACK,
  MUSIC_STAGE,
  smoothstep,
} from "../music/types.ts";
import { CARPET_COLS, CARPET_DYES, CARPET_ROWS } from "./pattern.ts";
import type { CarpetLoomSimulation } from "./sim.ts";

function drawBeaterComb(
  ctx: CanvasRenderingContext2D,
  left: number,
  width: number,
  combBottomY: number,
  strikeFlash: number,
): void {
  const barH = 14;
  const teethH = 10;
  const barTop = combBottomY - teethH - barH;

  ctx.save();
  // Wooden comb spine (heve)
  const g = ctx.createLinearGradient(left, barTop, left, barTop + barH);
  g.addColorStop(0, "#5c2f14");
  g.addColorStop(0.5, "#9a5426");
  g.addColorStop(1, "#3b1b09");
  ctx.fillStyle = g;
  ctx.fillRect(left + 4, barTop, width - 8, barH);
  ctx.strokeStyle = strikeFlash > 0.1 ? "#fef08a" : CARPET_DYES.ochre;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(left + 4, barTop, width - 8, barH);

  // Brass/steel comb teeth slotting between every pair of warp threads
  ctx.strokeStyle = strikeFlash > 0.1 ? "#fffbeb" : "rgba(226, 232, 240, 0.72)";
  ctx.lineWidth = 1.5;
  const step = width / CARPET_COLS;
  for (let c = 0; c <= CARPET_COLS; c += 2) {
    const tx = left + c * step;
    ctx.beginPath();
    ctx.moveTo(tx, barTop + barH);
    ctx.lineTo(tx, combBottomY);
    ctx.stroke();
  }
  ctx.restore();
}

function drawKnotterShuttle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  yarnColor: string,
  spoolX: number,
  spoolY: number,
  activeTie: number,
): void {
  ctx.save();

  // Trailing coloured wool yarn from overhead bobbin into the knotter tip!
  ctx.strokeStyle = yarnColor;
  ctx.lineWidth = 3.0;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.moveTo(spoolX, spoolY);
  const ctrlX = lerp(spoolX, x, 0.35) + (spoolX < x ? -18 : 18);
  const ctrlY = lerp(spoolY, y, 0.55);
  ctx.quadraticCurveTo(ctrlX, ctrlY, x, y);
  ctx.stroke();

  // Overhead yarn spool / bobbin on upper rail
  ctx.fillStyle = yarnColor;
  ctx.strokeStyle = "#fffbeb";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(spoolX, spoolY, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Bright angled weaver's knotter needle / shuttle right on the working row
  ctx.translate(x, y);
  const bob = activeTie > 0.05 ? Math.sin(activeTie * Math.PI * 4) * 3.5 : 0;
  ctx.translate(0, bob);

  // Additive knot-tying glow at needle tip
  if (activeTie > 0.04) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = yarnColor;
    ctx.globalAlpha = clamp(activeTie * 0.75, 0, 0.85);
    ctx.beginPath();
    ctx.arc(0, 0, 12 + 12 * activeTie, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Polished ivory-and-brass hooked knotter handle pointing down into the knot
  ctx.rotate(-0.38);
  ctx.fillStyle = "#fef3c7";
  ctx.strokeStyle = "#b45309";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 2); // sharp hook tip at (0, 2)
  ctx.lineTo(-7, -14);
  ctx.lineTo(-4, -36);
  ctx.lineTo(4, -36);
  ctx.lineTo(7, -14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Coloured yarn band around knotter collar
  ctx.fillStyle = yarnColor;
  ctx.fillRect(-5.5, -24, 11, 7);

  // Gleaming steel hook tip
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function paintCarpetLoomFrame(
  ctx: CanvasRenderingContext2D,
  sim: CarpetLoomSimulation,
  frame: number,
): void {
  const sec = frame / VIDEO.fps;
  const dur = sim.score.durationSec;

  // 1. Determine Beater Comb strike & 3 px finished-row compression on frame-drum hits
  let beaterDrop = 0; // 0 = parked above working row, 1 = striking working row!
  let beaterFlash = 0;
  let rowCompressPx = 0;

  for (const hit of sim.beaterHits) {
    const dt = sec - hit.time;
    if (dt >= -0.075 && dt < 0) {
      // Smooth downward swing right before drum impact
      const down = (dt + 0.075) / 0.075;
      beaterDrop = Math.max(beaterDrop, down * down);
    } else if (dt >= 0 && dt < 0.24) {
      // Impact thud at dt = 0, then lift back up
      const lift = 1 - smoothstep(0.02, 0.22, dt);
      beaterDrop = Math.max(beaterDrop, lift);
      const flash = Math.exp(-dt * 18) * hit.velocity;
      if (flash > beaterFlash) beaterFlash = flash;
      // 3 px downward compression of all finished rows beneath the beater!
      const comp = 3.2 * Math.exp(-dt * 14) * Math.max(0, Math.cos(dt * 26)) * hit.velocity;
      if (comp > rowCompressPx) rowCompressPx = comp;
    }
  }

  // 2. Determine current working row (0 = bottom .. CARPET_ROWS-1 = top)
  let activeWeaveRow = CARPET_ROWS - 1;
  for (let w = 0; w < sim.rowCompletions.length; w++) {
    if (sec < sim.rowCompletions[w].beatTime) {
      activeWeaveRow = sim.rowCompletions[w].weaveRow;
      break;
    }
  }
  const allRowsFinished =
    sim.rowCompletions.length === CARPET_ROWS &&
    sec >= sim.rowCompletions[CARPET_ROWS - 1].completedTime;
  const activeGridRow = CARPET_ROWS - 1 - activeWeaveRow;
  const workingRowY = sim.carpetTop + (activeGridRow + 0.5) * sim.cellH;

  // 3. Payoff pulse (after final chord completes top row) & rapid top-to-bottom unweave for seamless loop!
  const inPayoff = sec >= sim.finalChordTime && sec < sim.unweaveStartTime;
  const payoffPulse = inPayoff
    ? Math.sin(((sec - sim.finalChordTime) / Math.max(0.2, sim.unweaveStartTime - sim.finalChordTime)) * Math.PI)
    : 0;

  const isUnweaving = sec >= sim.unweaveStartTime;
  // Sweeps gridRow Cutoff from 0 (top) down to CARPET_ROWS (bottom) over [unweaveStartTime .. dur - 0.04]
  const unweaveCutoffRow = isUnweaving
    ? lerp(0, CARPET_ROWS + 1, smoothstep(sim.unweaveStartTime, dur - 0.04, sec))
    : -1;

  // 4. Locate active Knotter tool(s) across noteRuns so EVERY knot that pops has a visible knotter touching it!
  interface ActiveShuttlePose {
    readonly x: number;
    readonly y: number;
    readonly color: string;
    readonly strength: number;
  }
  const activeShuttles: ActiveShuttlePose[] = [];
  let accentKick = 0;
  let lastEndedRunIdx = -1;

  for (let i = 0; i < sim.noteRuns.length; i++) {
    const r = sim.noteRuns[i];
    if (r.time > sec) break;
    const dt = sec - r.time;
    if (dt >= 0 && dt < 0.22) {
      accentKick = Math.max(accentKick, Math.exp(-dt * 16) * r.velocity);
    }
    if (sec >= r.time && sec <= r.endTime + 0.03) {
      const u = clamp((sec - r.time) / Math.max(0.01, r.endTime - r.time), 0, 1);
      activeShuttles.push({
        x: lerp(r.startX, r.endX, u),
        y: r.baseY,
        color: r.yarnColor,
        strength: r.velocity * (1 - 0.2 * u),
      });
    }
    if (r.endTime <= sec) {
      lastEndedRunIdx = i;
    }
  }

  // When gliding between notes, keep the primary knotter visible as it travels to the next note's spot!
  if (activeShuttles.length === 0 && sim.noteRuns.length > 0) {
    if (lastEndedRunIdx >= 0 && lastEndedRunIdx + 1 < sim.noteRuns.length) {
      const prev = sim.noteRuns[lastEndedRunIdx];
      const nxt = sim.noteRuns[lastEndedRunIdx + 1];
      const gapDur = Math.max(0.01, nxt.time - prev.endTime);
      const u = smoothstep(0, 1, clamp((sec - prev.endTime) / gapDur, 0, 1));
      const arcHop = Math.sin(u * Math.PI) * Math.min(18, Math.abs(nxt.startX - prev.endX) * 0.06);
      activeShuttles.push({
        x: lerp(prev.endX, nxt.startX, u),
        y: lerp(prev.baseY, nxt.baseY, u) - arcHop,
        color: u > 0.5 ? nxt.yarnColor : prev.yarnColor,
        strength: 0,
      });
    } else {
      const fallback = sim.noteRuns[Math.max(0, lastEndedRunIdx)];
      activeShuttles.push({
        x: fallback.endX,
        y: fallback.baseY,
        color: fallback.yarnColor,
        strength: 0,
      });
    }
  }

  const zoom = 1 + clamp(accentKick * 0.014 + payoffPulse * 0.01 + beaterFlash * 0.008, 0, 0.024);

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, VIDEO.height);
  bg.addColorStop(0, "#0c0a09");
  bg.addColorStop(0.5, "#15100f");
  bg.addColorStop(1, "#0a0807");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);

  // Centred title & subtitle (y = 192 / 234, 28 px clear below Oyren top wordmark)
  drawCentredTitleBlock(ctx, sim.score.title, sim.score.subtitle, {
    titleColor: CARPET_DYES.ivory,
    subtitleColor: "rgba(245, 236, 215, 0.76)",
    accentColor: "rgba(219, 155, 39, 0.45)",
  });

  ctx.save();
  ctx.translate(MUSIC_STAGE.cx, MUSIC_STAGE.cy);
  ctx.scale(zoom, zoom);
  ctx.translate(-MUSIC_STAGE.cx, -MUSIC_STAGE.cy);

  const L = MUSIC_STAGE.left; // 54
  const R = MUSIC_STAGE.right; // 1026
  const TOP = 294;
  const BOT = 1592;

  // 5. Walnut & Brass Vertical Loom Frame
  ctx.save();
  for (const px of [L + 4, R - 26]) {
    const postGrad = ctx.createLinearGradient(px, TOP, px + 22, TOP);
    postGrad.addColorStop(0, "#291509");
    postGrad.addColorStop(0.45, "#6b3818");
    postGrad.addColorStop(1, "#241106");
    ctx.fillStyle = postGrad;
    ctx.fillRect(px, TOP + 16, 22, BOT - TOP - 32);
    ctx.strokeStyle = "rgba(219, 155, 39, 0.44)";
    ctx.lineWidth = 1.6;
    ctx.strokeRect(px, TOP + 16, 22, BOT - TOP - 32);
  }

  for (const by of [TOP, BOT - 40]) {
    const beamGrad = ctx.createLinearGradient(L, by, L, by + 40);
    beamGrad.addColorStop(0, "#3f1f0d");
    beamGrad.addColorStop(0.42, "#85461e");
    beamGrad.addColorStop(1, "#2a1306");
    ctx.fillStyle = beamGrad;
    ctx.fillRect(L, by, R - L, 40);
    ctx.strokeStyle = CARPET_DYES.ochre;
    ctx.lineWidth = 2;
    ctx.strokeRect(L, by, R - L, 40);

    ctx.fillStyle = CARPET_DYES.ochreBright;
    ctx.fillRect(L, by, 14, 40);
    ctx.fillRect(R - 14, by, 14, 40);
  }

  // Dark loom interior backing + crisp vertical ivory warp threads visible across the whole width from frame 0!
  ctx.fillStyle = "rgba(15, 12, 12, 0.88)";
  ctx.fillRect(sim.carpetLeft, TOP + 40, sim.carpetWidth, BOT - TOP - 80);

  for (let col = 0; col < CARPET_COLS; col++) {
    const wx = sim.carpetLeft + (col + 0.5) * sim.cellW;
    ctx.strokeStyle = col % 2 === 0 ? "rgba(242, 231, 207, 0.36)" : "rgba(214, 198, 168, 0.25)";
    ctx.lineWidth = 1.45;
    ctx.beginPath();
    ctx.moveTo(wx, TOP + 40);
    ctx.lineTo(wx, BOT - 40);
    ctx.stroke();
  }
  ctx.restore();

  // 6. Render Woven Carpet Knots (strictly bottom-to-top, with tuft squash-pop & fibre flicks!)
  ctx.save();
  ctx.beginPath();
  ctx.rect(sim.carpetLeft - 4, sim.carpetTop - 8, sim.carpetWidth + 8, sim.carpetHeight + 16);
  ctx.clip();

  const cw = sim.cellW;
  const ch = sim.cellH;
  const flickList: { x: number; y: number; color: string; age: number; angle: number; speed: number }[] = [];

  for (let i = 0; i < sim.cells.length; i++) {
    const knot = sim.cellKnots[i];
    if (!knot || knot.popTime > sec) continue;

    const cell = sim.cells[i];
    if (isUnweaving && cell.row < unweaveCutoffRow) continue;

    const age = sec - knot.popTime;
    // Finished rows below the current working row compress downward by rowCompressPx (up to 3.2 px) on drumbeats!
    const compressOffset =
      cell.row > activeGridRow
        ? rowCompressPx * ((cell.row - activeGridRow) / Math.max(1, CARPET_ROWS - activeGridRow))
        : 0;

    // Velocity-scaled dye glow when freshly tied + whole-carpet payoff pulse (medallion brightest!)
    const freshGlow = age < 0.65 ? Math.exp(-age * 5.2) * (0.35 + 0.65 * knot.velocity) : 0;
    const medWeight = cell.isMedallion ? 1.0 : cell.isButa ? 0.72 : 0.42;
    const totalGlow = freshGlow + payoffPulse * medWeight;

    // Tactile tuft squash-and-stretch on the first 120 ms of tying
    let sx = 1;
    let sy = 1;
    if (age < 0.12) {
      const p = 1 - age / 0.12;
      sx = 1 + 0.34 * p;
      sy = 1 - 0.26 * p;
    }

    const cx = sim.carpetLeft + (cell.col + 0.5) * cw;
    const cy = sim.carpetTop + (cell.row + 0.5) * ch + compressOffset;
    const w = (cw - 0.9) * sx;
    const h = (ch - 0.9) * sy;

    ctx.fillStyle = totalGlow > 0.22 ? cell.brightHex : cell.hex;
    ctx.fillRect(cx - w * 0.5, cy - h * 0.5, w, h);

    // Subtle woollen pile highlight in centre of tuft
    if (totalGlow > 0.1) {
      ctx.fillStyle = "#fffbeb";
      ctx.globalAlpha = clamp(totalGlow * 0.52, 0, 0.68);
      ctx.fillRect(cx - w * 0.26, cy - h * 0.26, w * 0.52, h * 0.52);
      ctx.globalAlpha = 1;
    }

    if (age < 0.24) {
      flickList.push({
        x: cx,
        y: cy,
        color: cell.brightHex,
        age,
        angle: knot.flickAngle,
        speed: knot.flickSpeed,
      });
    }
  }

  // Whole-carpet payoff halo centred on medallion when final row completes at 55.8 s
  if (payoffPulse > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const rad = ctx.createRadialGradient(
      MUSIC_STAGE.cx,
      MUSIC_STAGE.cy,
      20,
      MUSIC_STAGE.cx,
      MUSIC_STAGE.cy,
      440,
    );
    rad.addColorStop(0, `rgba(255, 244, 190, ${0.32 * payoffPulse})`);
    rad.addColorStop(0.5, `rgba(244, 190, 68, ${0.18 * payoffPulse})`);
    rad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = rad;
    ctx.fillRect(sim.carpetLeft, sim.carpetTop, sim.carpetWidth, sim.carpetHeight);
    ctx.restore();
  }

  // Unweaving sweep bar (top-to-bottom during 56.75s - 57.60s loop reset)
  if (isUnweaving && unweaveCutoffRow >= 0 && unweaveCutoffRow <= CARPET_ROWS) {
    const uy = sim.carpetTop + unweaveCutoffRow * ch;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#fde68a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sim.carpetLeft, uy);
    ctx.lineTo(sim.carpetLeft + sim.carpetWidth, uy);
    ctx.stroke();
    ctx.restore();
  }

  // 7. Working Row Marker, Beater Comb, Wool Fibre Flicks & Active Knotter!
  if (!allRowsFinished && !isUnweaving) {
    // Thin lit horizontal working-row weft guide bar
    ctx.save();
    ctx.fillStyle = "rgba(254, 240, 138, 0.16)";
    ctx.fillRect(sim.carpetLeft, workingRowY - ch * 0.5, sim.carpetWidth, ch);
    ctx.strokeStyle = "rgba(253, 224, 71, 0.78)";
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(sim.carpetLeft, workingRowY + ch * 0.5);
    ctx.lineTo(sim.carpetLeft + sim.carpetWidth, workingRowY + ch * 0.5);
    ctx.stroke();
    ctx.restore();

    // Wooden Beater Comb hovers 34 px above working row and drops onto working row on Qaval drum hits!
    const parkedY = Math.max(sim.carpetTop + 22, workingRowY - ch * 0.5 - 32);
    const strikeY = workingRowY - ch * 0.35 + rowCompressPx;
    const combBottomY = lerp(parkedY, strikeY, beaterDrop);
    drawBeaterComb(ctx, sim.carpetLeft, sim.carpetWidth, combBottomY, beaterFlash);

    // Tiny wool fibre flicks flying off newly knotted tufts
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const fl of flickList) {
      const u = fl.age / 0.24;
      const fx = fl.x + Math.cos(fl.angle) * fl.speed * fl.age;
      const fy = fl.y + Math.sin(fl.angle) * fl.speed * fl.age + 45 * fl.age * fl.age;
      ctx.strokeStyle = fl.color;
      ctx.lineWidth = 2.2 * (1 - u);
      ctx.globalAlpha = (1 - u) * 0.9;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx - Math.cos(fl.angle) * 6, fy - Math.sin(fl.angle) * 6);
      ctx.stroke();
    }
    ctx.restore();

    // Visible Knotter Shuttle(s) & Trailing Coloured Yarn Thread(s)
    const spoolY = sim.carpetTop + 6;
    for (const sh of activeShuttles) {
      const spoolX = lerp(MUSIC_STAGE.cx, sh.x, 0.68);
      drawKnotterShuttle(
        ctx,
        sh.x,
        sh.y,
        sh.color,
        spoolX,
        spoolY,
        sh.strength,
      );
    }
  }

  ctx.restore(); // end carpet clip

  // 8. Plain human-readable caption on the lower walnut beam (centred at x = 540)
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 18px ${MUSIC_FONT_STACK}`;
  ctx.fillStyle = "rgba(245, 236, 215, 0.88)";
  ctx.fillText(
    "every note ties knots on the row · every drumbeat packs the weft",
    MUSIC_STAGE.cx,
    BOT - 20,
  );
  ctx.restore();

  ctx.restore();
}
