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

export function paintCarpetLoomFrame(
  ctx: CanvasRenderingContext2D,
  sim: CarpetLoomSimulation,
  frame: number,
): void {
  const sec = frame / VIDEO.fps;
  const dur = sim.score.durationSec;

  // Compute note accent energy & shuttle state
  let accentKick = 0;
  let activeKnotX: number = MUSIC_STAGE.cx;
  let activeKnotY: number = sim.carpetTop + sim.carpetHeight * 0.5;
  let activeYarnColor: string = CARPET_DYES.ochreBright;
  let hasActiveShuttle = false;

  for (const k of sim.knots) {
    let dt = sec - k.time;
    if (dt < -dur * 0.5) dt += dur;
    if (dt >= 0 && dt < 0.24) {
      const w = Math.exp(-dt * 15) * k.velocity;
      if (w > accentKick) {
        accentKick = w;
        activeKnotX = k.x;
        activeKnotY = k.baseY;
        activeYarnColor = k.yarnColor;
        hasActiveShuttle = true;
      }
    }
  }

  // Also pulse reed beater gently on Qaval frame-drum strokes (especially during 0-3.6s intro & 55.8-57.6s outro)
  let drumPulse = 0;
  for (const d of sim.score.drums) {
    let dt = sec - d.time;
    if (dt < -dur * 0.5) dt += dur;
    if (dt >= 0 && dt < 0.22) {
      const p = Math.exp(-dt * 14) * d.velocity * 0.65;
      if (p > drumPulse) drumPulse = p;
    }
  }
  if (!hasActiveShuttle && drumPulse > 0.05) {
    activeKnotY = lerp(sim.carpetTop + 48, sim.carpetTop + sim.carpetHeight - 48, clamp(sec / dur, 0, 1));
  }
  accentKick = Math.max(accentKick, drumPulse * 0.6);

  // Seamless loop weaving progress:
  // Builds from 0.11 (outer guard border at frame 0) -> 1.04 across [0 .. 95% of duration],
  // illuminates central medallion during payoff [75% .. 96.5%], then smoothly rolls/resets to 0.11 in 55.8-57.6s outro!
  const resetStart = 55.8;
  const buildProgress =
    sec < resetStart
      ? lerp(0.11, 1.04, smoothstep(0, 53.5, sec))
      : lerp(1.04, 0.11, smoothstep(resetStart, dur, sec));

  const medallionRadiance =
    sec >= sim.payoffTime && sec < resetStart
      ? smoothstep(sim.payoffTime, sim.payoffTime + 1.4, sec) *
        (0.72 + 0.28 * Math.sin((sec - sim.payoffTime) * 4.5))
      : sec >= resetStart
        ? (1 - smoothstep(resetStart, dur, sec)) * 0.75
        : 0;

  // Gentle vertical carpet scroll that returns cleanly to 0 at loop boundary
  const scrollOffset = Math.sin((sec / dur) * Math.PI * 2) * 18;
  const zoom = 1 + clamp(accentKick * 0.018 + medallionRadiance * 0.008, 0, 0.025);

  // Warm dark workshop / indigo-walnut background
  const bg = ctx.createLinearGradient(0, 0, 0, VIDEO.height);
  bg.addColorStop(0, "#0c0a09");
  bg.addColorStop(0.5, "#161110");
  bg.addColorStop(1, "#0a0807");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);

  // Centred Azerbaijani title & mode/instrument subtitle (y = 192 / 234, never overlaps loom >= 294)
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

  // 1. Handcrafted Walnut & Brass Vertical Carpet Loom Frame (x = 56..1024, y = 294..1592)
  ctx.save();
  // Side vertical loom posts (oxlar)
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

  // Upper Warp Roller Beam (ust ox, y = 294..334) & Lower Cloth Roller Beam (alt ox, y = 1550..1590)
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

    // Brass end caps
    ctx.fillStyle = CARPET_DYES.ochreBright;
    ctx.fillRect(L, by, 14, 40);
    ctx.fillRect(R - 14, by, 14, 40);
  }

  // Taut Ivory Vertical Warp Threads (aris ipleri) spanning full loom height
  ctx.strokeStyle = "rgba(245, 236, 215, 0.22)";
  ctx.lineWidth = 1.15;
  for (let col = 0; col < CARPET_COLS; col++) {
    const wx = sim.carpetLeft + (col + 0.5) * sim.cellW;
    ctx.beginPath();
    ctx.moveTo(wx, TOP + 40);
    ctx.lineTo(wx, BOT - 40);
    ctx.stroke();
  }
  ctx.restore();

  // 2. Clip carpet weaving bed & apply gentle vertical scroll
  ctx.save();
  ctx.beginPath();
  ctx.rect(sim.carpetLeft - 2, sim.carpetTop - 2, sim.carpetWidth + 4, sim.carpetHeight + 4);
  ctx.clip();

  // Subtle dark workshop shadow behind loom warp, then crisp taut ivory warp strings on top!
  ctx.fillStyle = "rgba(14, 11, 12, 0.82)";
  ctx.fillRect(sim.carpetLeft, sim.carpetTop, sim.carpetWidth, sim.carpetHeight);

  ctx.strokeStyle = "rgba(235, 222, 194, 0.24)";
  ctx.lineWidth = 1.25;
  for (let col = 0; col < CARPET_COLS; col++) {
    const wx = sim.carpetLeft + (col + 0.5) * sim.cellW;
    ctx.beginPath();
    ctx.moveTo(wx, sim.carpetTop);
    ctx.lineTo(wx, sim.carpetTop + sim.carpetHeight);
    ctx.stroke();
  }

  // Per-cell tuft brightness boosts from recently tied notes
  const knotBoost = new Float32Array(CARPET_COLS * CARPET_ROWS);
  const tiedByNote = new Uint8Array(CARPET_COLS * CARPET_ROWS);

  if (sec < resetStart) {
    for (const k of sim.knots) {
      if (k.time <= sec) {
        const idx1 = k.row * CARPET_COLS + k.col;
        const idx2 = k.row * CARPET_COLS + k.mirrorCol;
        tiedByNote[idx1] = 1;
        tiedByNote[idx2] = 1;
        const age = sec - k.time;
        if (age < 1.2) {
          const b = Math.exp(-age * 3.2) * (0.4 + 0.6 * k.velocity);
          if (b > knotBoost[idx1]) knotBoost[idx1] = b;
          if (b * 0.85 > knotBoost[idx2]) knotBoost[idx2] = b * 0.85;
        }
      }
    }
  }

  // Render carpet pile knots (edges-toward-centre + row-by-row progression + velocity tuft brightness)
  const cw = sim.cellW;
  const ch = sim.cellH;
  for (let i = 0; i < sim.cells.length; i++) {
    const cell = sim.cells[i];
    // Combine outer-to-inner medallion growth with gentle top/bottom row sweep
    const threshold =
      cell.edgeToCenterOrder * 0.82 + (cell.row / CARPET_ROWS) * 0.16;
    const isWoven = buildProgress >= threshold || tiedByNote[i] === 1;
    if (!isWoven) continue;

    const lockAge = clamp((buildProgress - threshold) * 9, 0.25, 1);
    const boost = knotBoost[i];
    const medGlow =
      medallionRadiance > 0 && (cell.isMedallion || cell.isButa)
        ? medallionRadiance * (cell.isMedallion ? 1.0 : 0.65)
        : 0;

    const x = sim.carpetLeft + cell.col * cw;
    const y = sim.carpetTop + cell.row * ch + scrollOffset * 0.35;

    ctx.fillStyle = boost > 0.18 || medGlow > 0.32 ? cell.brightHex : cell.hex;
    ctx.globalAlpha = lockAge;
    // Slight rounded woollen knot texture (leaving tiny 0.8px dark weft shadow between knots)
    ctx.fillRect(x + 0.45, y + 0.45, cw - 0.9, ch - 0.9);

    // Velocity-driven bright woollen tuft highlight
    if (boost > 0.08 || medGlow > 0.24) {
      ctx.fillStyle = "#fff9eb";
      ctx.globalAlpha = clamp(boost * 0.55 + medGlow * 0.22, 0, 0.65);
      ctx.fillRect(x + cw * 0.24, y + ch * 0.24, cw * 0.52, ch * 0.52);
    }
  }
  ctx.globalAlpha = 1;

  // 3. Central Medallion Payoff Radiance Halo (lights up on the final climax notes while preserving rich dye colors!)
  if (medallionRadiance > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const radGrad = ctx.createRadialGradient(
      MUSIC_STAGE.cx,
      MUSIC_STAGE.cy + scrollOffset * 0.35,
      16,
      MUSIC_STAGE.cx,
      MUSIC_STAGE.cy + scrollOffset * 0.35,
      350,
    );
    radGrad.addColorStop(0, `rgba(255, 236, 170, ${0.24 * medallionRadiance})`);
    radGrad.addColorStop(0.45, `rgba(244, 190, 68, ${0.16 * medallionRadiance})`);
    radGrad.addColorStop(0.8, `rgba(214, 54, 56, ${0.09 * medallionRadiance})`);
    radGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = radGrad;
    ctx.fillRect(sim.carpetLeft, sim.carpetTop, sim.carpetWidth, sim.carpetHeight);
    ctx.restore();
  }

  // 4. Active Horizontal Reed Beater Bar & Flying Wooden Yarn Shuttle on Note Onsets!
  const beaterY = clamp(
    activeKnotY + scrollOffset * 0.35,
    sim.carpetTop + 24,
    sim.carpetTop + sim.carpetHeight - 24,
  );
  ctx.save();
  ctx.fillStyle = "rgba(133, 70, 30, 0.52)";
  ctx.fillRect(sim.carpetLeft, beaterY - 3, sim.carpetWidth, 6);
  ctx.strokeStyle = "rgba(244, 190, 68, 0.55)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(sim.carpetLeft, beaterY);
  ctx.lineTo(sim.carpetLeft + sim.carpetWidth, beaterY);
  ctx.stroke();

  if (hasActiveShuttle) {
    // Trailing dyed wool weft thread across row
    ctx.strokeStyle = activeYarnColor;
    ctx.lineWidth = 2.6;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(MUSIC_STAGE.cx, beaterY);
    ctx.lineTo(activeKnotX, beaterY);
    ctx.stroke();

    // Boat-shaped polished walnut shuttle (mekik)
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#9a5223";
    ctx.strokeStyle = CARPET_DYES.ochreBright;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(activeKnotX - 28, beaterY);
    ctx.quadraticCurveTo(activeKnotX, beaterY - 10, activeKnotX + 28, beaterY);
    ctx.quadraticCurveTo(activeKnotX, beaterY + 10, activeKnotX - 28, beaterY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Additive knot-tie spark pop right at (activeKnotX, beaterY)
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = activeYarnColor;
    ctx.globalAlpha = clamp(accentKick * 0.9, 0, 0.95);
    ctx.beginPath();
    ctx.arc(activeKnotX, beaterY, 12 + 16 * accentKick, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.restore(); // end carpet clip

  // Centred subtle legend on lower cloth roller beam (x = 540, y = 1570)
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 17px ${MUSIC_FONT_STACK}`;
  ctx.fillStyle = "rgba(245, 236, 215, 0.84)";
  ctx.fillText(
    "TAR · KAMANÇA · QAVAL · PITCH ↔ WARP · TIME ↔ WEFT · VELOCITY ↔ DYE GLOW",
    MUSIC_STAGE.cx,
    BOT - 20,
  );
  ctx.restore();

  ctx.restore();
}
