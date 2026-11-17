import { VIDEO } from "../settings.ts";
import {
  clamp,
  createRng,
  drawCentredTitleBlock,
  lerp,
  MUSIC_FONT_STACK,
  MUSIC_STAGE,
  smoothstep,
} from "../music/types.ts";
import type { FireworkSimulation } from "./sim.ts";

interface StarDot {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly phase: number;
  readonly rate: number;
  readonly tint: string;
}

const NIGHT_STARS: readonly StarDot[] = (() => {
  const rng = createRng(918273645);
  const tints = ["#e2e8f0", "#bae6fd", "#fde68a", "#ddd6fe"];
  const list: StarDot[] = [];
  for (let i = 0; i < 96; i++) {
    // Place symmetrically in pairs so overall composition stays balanced around x = 540
    const dx = 30 + rng() * 448;
    const y = MUSIC_STAGE.top + 38 + rng() * (1020 - MUSIC_STAGE.top);
    const r = 1.0 + rng() * 1.6;
    const phase = rng() * Math.PI * 2;
    const rate = 1.2 + rng() * 2.2;
    const tint = tints[i % tints.length];
    list.push({ x: MUSIC_STAGE.cx - dx, y, r, phase, rate, tint });
    list.push({ x: MUSIC_STAGE.cx + dx, y: y + (rng() - 0.5) * 14, r, phase: phase + 0.9, rate, tint });
  }
  return list;
})();

function drawMountainAmphitheatre(
  ctx: CanvasRenderingContext2D,
  sec: number,
  energy: number,
  progress: number,
): void {
  const L = MUSIC_STAGE.left; // 54
  const R = MUSIC_STAGE.right; // 1026
  const CX = MUSIC_STAGE.cx; // 540
  const TOP = MUSIC_STAGE.top; // 290
  const BOT = MUSIC_STAGE.bottom; // 1600

  // 1. Aurora borealis ribbons across upper/mid sky (y = 350 .. 1180) so sky is rich & alive
  ctx.save();
  for (let band = 0; band < 3; band++) {
    const baseY = 470 + band * 215;
    const grad = ctx.createLinearGradient(L, baseY - 90, R, baseY + 90);
    const a = 0.075 + 0.065 * energy;
    if (band === 0) {
      grad.addColorStop(0, "rgba(56, 189, 248, 0)");
      grad.addColorStop(0.25, `rgba(52, 211, 153, ${a})`);
      grad.addColorStop(0.5, `rgba(56, 189, 248, ${a * 1.2})`);
      grad.addColorStop(0.75, `rgba(52, 211, 153, ${a})`);
      grad.addColorStop(1, "rgba(56, 189, 248, 0)");
    } else if (band === 1) {
      grad.addColorStop(0, "rgba(168, 85, 247, 0)");
      grad.addColorStop(0.3, `rgba(168, 85, 247, ${a * 0.95})`);
      grad.addColorStop(0.5, `rgba(251, 191, 36, ${a * 0.78})`);
      grad.addColorStop(0.7, `rgba(168, 85, 247, ${a * 0.95})`);
      grad.addColorStop(1, "rgba(168, 85, 247, 0)");
    } else {
      grad.addColorStop(0, "rgba(59, 130, 246, 0)");
      grad.addColorStop(0.3, `rgba(56, 189, 248, ${a * 0.85})`);
      grad.addColorStop(0.5, `rgba(244, 114, 182, ${a * 0.75})`);
      grad.addColorStop(0.7, `rgba(56, 189, 248, ${a * 0.85})`);
      grad.addColorStop(1, "rgba(59, 130, 246, 0)");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = lerp(L + 10, R - 10, u);
      const sym = Math.cos((u - 0.5) * Math.PI * 2.4) * 26;
      const wave = Math.sin(u * Math.PI * 4 + sec * 0.9 + band * 1.7) * 14;
      const y = baseY + sym + wave;
      if (i === 0) ctx.moveTo(x, y - 48);
      else ctx.lineTo(x, y - 48);
    }
    for (let i = steps; i >= 0; i--) {
      const u = i / steps;
      const x = lerp(L + 10, R - 10, u);
      const sym = Math.cos((u - 0.5) * Math.PI * 2.4) * 26;
      const wave = Math.sin(u * Math.PI * 4 + sec * 0.9 + band * 1.7) * 14;
      const y = baseY + sym + wave;
      ctx.lineTo(x, y + 48);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 2. Symmetrical Nordic Stars
  ctx.save();
  for (const s of NIGHT_STARS) {
    const tw = 0.45 + 0.55 * Math.sin(sec * s.rate + s.phase);
    ctx.globalAlpha = 0.28 + 0.52 * tw;
    ctx.fillStyle = s.tint;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 3. Top Celestial Tempo & Pitch Arch (y = 296 .. 346, x = 58 .. 1022)
  ctx.save();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.34)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(L + 6, TOP + 48);
  ctx.quadraticCurveTo(CX, TOP + 6, R - 6, TOP + 48);
  ctx.stroke();

  // Active accelerando progress arc along the top proscenium
  const progHalfSpan = (R - L - 12) * 0.5 * clamp(0.12 + 0.88 * progress, 0, 1);
  const arcGrad = ctx.createLinearGradient(CX - progHalfSpan, TOP, CX + progHalfSpan, TOP);
  arcGrad.addColorStop(0, "#38bdf8");
  arcGrad.addColorStop(0.5, "#fde047");
  arcGrad.addColorStop(1, "#38bdf8");
  ctx.strokeStyle = arcGrad;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  const segs = 28;
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const x = lerp(CX - progHalfSpan, CX + progHalfSpan, u);
    const norm = (x - (L + 6)) / (R - L - 12);
    const y = (1 - norm) * (1 - norm) * (TOP + 48) + 2 * (1 - norm) * norm * (TOP + 6) + norm * norm * (TOP + 48);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Symmetric side proscenium altitude rails (x = 58 and x = 1022, y = 338 .. 1580)
  ctx.strokeStyle = "rgba(148, 163, 184, 0.24)";
  ctx.lineWidth = 1.8;
  for (const sideX of [L + 6, R - 6]) {
    ctx.beginPath();
    ctx.moveTo(sideX, TOP + 48);
    ctx.lineTo(sideX, BOT - 16);
    ctx.stroke();
    const dir = sideX < CX ? 1 : -1;
    for (let ty = TOP + 110; ty <= BOT - 80; ty += 110) {
      ctx.beginPath();
      ctx.moveTo(sideX, ty);
      ctx.lineTo(sideX + dir * 12, ty);
      ctx.stroke();
    }
  }
  ctx.restore();

  // 4. Symmetrical Nordic Mountain Peaks & Illuminated Mountain King Hall (y = 1230 .. 1555)
  ctx.save();
  // Distant symmetric ridge
  ctx.fillStyle = "#111a2e";
  ctx.beginPath();
  ctx.moveTo(L + 6, 1548);
  const ridgeProfile: readonly [number, number][] = [
    [0.0, 1420],
    [0.12, 1315],
    [0.24, 1375],
    [0.37, 1255],
    [0.5, 1195],
    [0.63, 1255],
    [0.76, 1375],
    [0.88, 1315],
    [1.0, 1420],
  ];
  for (const [u, ry] of ridgeProfile) {
    ctx.lineTo(lerp(L + 6, R - 6, u), ry);
  }
  ctx.lineTo(R - 6, 1548);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = `rgba(125, 211, 252, ${0.22 + 0.24 * energy})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Foreground symmetric Mountain Hall colonnade
  ctx.fillStyle = "#0b1222";
  ctx.beginPath();
  ctx.moveTo(L + 6, 1588);
  ctx.lineTo(L + 6, 1480);
  ctx.lineTo(CX - 250, 1435);
  ctx.lineTo(CX - 150, 1365);
  ctx.lineTo(CX, 1320);
  ctx.lineTo(CX + 150, 1365);
  ctx.lineTo(CX + 250, 1435);
  ctx.lineTo(R - 6, 1480);
  ctx.lineTo(R - 6, 1588);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = `rgba(251, 191, 36, ${0.28 + 0.35 * energy})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Warm glowing hall arch windows centred around x = 540
  for (let arch = -3; arch <= 3; arch++) {
    const ax = CX + arch * 54;
    const ay = 1445 + Math.abs(arch) * 14;
    const archH = arch === 0 ? 44 : 32;
    const archW = arch === 0 ? 22 : 16;
    ctx.fillStyle = `rgba(251, 191, 36, ${0.38 + 0.45 * energy})`;
    ctx.beginPath();
    ctx.arc(ax, ay - archH * 0.5, archW * 0.5, Math.PI, 0);
    ctx.lineTo(ax + archW * 0.5, ay);
    ctx.lineTo(ax - archW * 0.5, ay);
    ctx.closePath();
    ctx.fill();
  }

  // 5. Symmetrical Brass Mortar Rack Base (y = 1546 .. 1592, x = 60 .. 1020)
  const rackGrad = ctx.createLinearGradient(L + 6, 1546, L + 6, 1592);
  rackGrad.addColorStop(0, "#1e293b");
  rackGrad.addColorStop(1, "#0f172a");
  ctx.fillStyle = rackGrad;
  ctx.fillRect(L + 6, 1548, R - L - 12, 42);
  ctx.strokeStyle = "rgba(251, 191, 36, 0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(L + 6, 1548, R - L - 12, 42);

  // 25 symmetrical mortar tubes along the rack
  for (let m = 0; m < 25; m++) {
    const mx = lerp(L + 48, R - 48, m / 24);
    ctx.fillStyle = "#334155";
    ctx.fillRect(mx - 5, 1534, 10, 18);
    ctx.fillStyle = "rgba(251, 191, 36, 0.55)";
    ctx.fillRect(mx - 6, 1532, 12, 3);
  }
  ctx.restore();
}

export function paintFireworkKingFrame(
  ctx: CanvasRenderingContext2D,
  sim: FireworkSimulation,
  frame: number,
): void {
  const sec = frame / VIDEO.fps;
  const dur = sim.score.durationSec;

  // Compute instantaneous accent energy & gentle zoom kick (strictly in [1.000, 1.026], within 3%!)
  let accentKick = 0;
  let skyGlow = 0;
  let activeVoiceColor = "#fbbf24";

  for (const r of sim.rockets) {
    // Handle wrap-around bursts near loop seam
    let dt = sec - r.burstTime;
    if (dt < -dur * 0.5) dt += dur;
    if (dt >= 0 && dt < 0.85) {
      const w = Math.exp(-dt * (r.isFinale ? 3.2 : 7.5)) * r.velocity;
      if (w > skyGlow) {
        skyGlow = w;
        activeVoiceColor = r.primaryColor;
      }
      if (dt < 0.26) {
        const k = Math.exp(-dt * 15) * (r.isFinale ? 1.0 : r.velocity * 0.55);
        if (k > accentKick) accentKick = k;
      }
    }
  }

  // Loop-seamless normalized progress (rises to peak near grandFinaleTime, returns smoothly to 0 at end)
  const rawProgress =
    sec <= sim.grandFinaleTime
      ? sec / sim.grandFinaleTime
      : 1 - smoothstep(sim.grandFinaleTime, dur, sec);

  const zoom = 1 + clamp(0.01 * rawProgress + 0.016 * accentKick, 0, 0.026);

  // Deep nocturnal sky background
  const bg = ctx.createLinearGradient(0, 0, 0, VIDEO.height);
  bg.addColorStop(0, "#050814");
  bg.addColorStop(0.55, "#091024");
  bg.addColorStop(1, "#050812");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);

  // Centred title & subtitle (always steady and unzoomed at y = 192 / 234, never overlapping art)
  drawCentredTitleBlock(ctx, sim.score.title, sim.score.subtitle, {
    titleColor: "#f8fafc",
    subtitleColor: "rgba(226, 232, 240, 0.76)",
    accentColor: "rgba(251, 191, 36, 0.36)",
  });

  // Main stage transform centred on (540, 945) with zoom strictly <= 1.026
  ctx.save();
  ctx.translate(MUSIC_STAGE.cx, MUSIC_STAGE.cy);
  ctx.scale(zoom, zoom);
  ctx.translate(-MUSIC_STAGE.cx, -MUSIC_STAGE.cy);

  drawMountainAmphitheatre(ctx, sec, clamp(skyGlow, 0, 1), rawProgress);

  // Additive screen glow in the sky on bursts
  if (skyGlow > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const glowGrad = ctx.createRadialGradient(
      MUSIC_STAGE.cx,
      780,
      30,
      MUSIC_STAGE.cx,
      860,
      460,
    );
    glowGrad.addColorStop(0, activeVoiceColor);
    glowGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.globalAlpha = clamp(skyGlow * 0.16, 0, 0.22);
    ctx.fillStyle = glowGrad;
    ctx.fillRect(MUSIC_STAGE.left, MUSIC_STAGE.top + 20, MUSIC_STAGE.artWidth, 1220);
    ctx.restore();
  }

  // Render rising rockets (anticipation) & exploding bursts (on-beat payoff)
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (const r of sim.rockets) {
    // Check flight phase (supporting seamless wrap-around at loop seam!)
    let tRelLaunch = sec - r.launchTime;
    if (tRelLaunch < -dur * 0.5) tRelLaunch += dur;
    if (tRelLaunch > dur * 0.5) tRelLaunch -= dur;
    const flightDur = r.burstTime - r.launchTime;

    if (tRelLaunch >= 0 && tRelLaunch < flightDur) {
      const u = tRelLaunch / Math.max(0.01, flightDur);
      const easeU = 1 - Math.pow(1 - u, 1.65);
      const rx = lerp(r.xLaunch, r.xBurst, easeU);
      const ry = lerp(r.yLaunch, r.yBurst, easeU);

      // Mortar flash at launch
      if (u < 0.22) {
        const mf = 1 - u / 0.22;
        ctx.globalAlpha = 0.65 * mf;
        ctx.fillStyle = r.secondaryColor;
        ctx.beginPath();
        ctx.arc(r.xLaunch, r.yLaunch - 10, 12 * mf + 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Continuous glowing tapered comet ribbon trail + bright head
      const tailU = Math.max(0, u - 0.24);
      const tailE = 1 - Math.pow(1 - tailU, 1.65);
      const tx0 = lerp(r.xLaunch, r.xBurst, tailE);
      const ty0 = lerp(r.yLaunch, r.yBurst, tailE);

      const trailGrad = ctx.createLinearGradient(tx0, ty0, rx, ry);
      trailGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
      trailGrad.addColorStop(0.65, r.primaryColor);
      trailGrad.addColorStop(1, "#ffffff");
      ctx.strokeStyle = trailGrad;
      ctx.lineWidth = r.isFinale ? 6.5 : 4.4;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.moveTo(tx0, ty0);
      ctx.lineTo(rx, ry);
      ctx.stroke();

      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(rx, ry, r.isFinale ? 6.2 : 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Burst phase (starts on exact note.time / burstFrame!)
    let dtBurst = sec - r.burstTime;
    if (dtBurst < -dur * 0.5) dtBurst += dur;
    const maxBurstLife = r.isFinale ? 3.1 : 1.65;

    if (dtBurst >= 0 && dtBurst < maxBurstLife) {
      const life = dtBurst / maxBurstLife;

      // Soft warm bloom halo behind burst
      if (dtBurst < 0.85) {
        const bloom = Math.exp(-dtBurst * (r.isFinale ? 2.4 : 4.2));
        ctx.globalAlpha = bloom * (r.isFinale ? 0.32 : 0.22);
        const bgGlow = ctx.createRadialGradient(
          r.xBurst,
          r.yBurst,
          6,
          r.xBurst,
          r.yBurst,
          r.isFinale ? 240 : 130,
        );
        bgGlow.addColorStop(0, r.primaryColor);
        bgGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = bgGlow;
        ctx.beginPath();
        ctx.arc(r.xBurst, r.yBurst, r.isFinale ? 240 : 130, 0, Math.PI * 2);
        ctx.fill();
      }

      // Crisp core flash + expanding shockwave ring on note onset
      if (dtBurst < 0.26) {
        const flash = 1 - dtBurst / 0.26;
        ctx.globalAlpha = 0.92 * flash;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(r.xBurst, r.yBurst, (r.isFinale ? 58 : 28) * flash + 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = r.secondaryColor;
        ctx.lineWidth = r.isFinale ? 4.2 : 2.6;
        ctx.globalAlpha = 0.75 * flash;
        ctx.beginPath();
        ctx.arc(
          r.xBurst,
          r.yBurst,
          (r.isFinale ? 210 : 98) * (1 - flash * flash) + 10,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }

      // Radiating gravity-drooping chrysanthemum sparks with lush willow streaks
      const gravity = r.isFinale ? 125 : 145;
      for (const sp of r.sparks) {
        const drag = (1 - Math.exp(-dtBurst * 2.1)) / 2.1;
        const sx = clamp(
          r.xBurst + Math.cos(sp.angle) * sp.speed * drag,
          MUSIC_STAGE.left + 14,
          MUSIC_STAGE.right - 14,
        );
        const sy = clamp(
          r.yBurst + Math.sin(sp.angle) * sp.speed * drag + 0.5 * gravity * dtBurst * dtBurst,
          MUSIC_STAGE.top + 20,
          MUSIC_STAGE.bottom - 20,
        );
        const fade = Math.pow(1 - life, sp.decay * 1.35);
        if (fade <= 0.02) continue;

        // Lush willow spark ribbon streak
        const prevDt = Math.max(0, dtBurst - 0.095);
        const prevDrag = (1 - Math.exp(-prevDt * 2.1)) / 2.1;
        const px = clamp(
          r.xBurst + Math.cos(sp.angle) * sp.speed * prevDrag,
          MUSIC_STAGE.left + 14,
          MUSIC_STAGE.right - 14,
        );
        const py = clamp(
          r.yBurst + Math.sin(sp.angle) * sp.speed * prevDrag + 0.5 * gravity * prevDt * prevDt,
          MUSIC_STAGE.top + 20,
          MUSIC_STAGE.bottom - 20,
        );

        ctx.strokeStyle = sp.colorShift > 0.45 ? r.primaryColor : r.secondaryColor;
        ctx.lineWidth = Math.max(1.8, sp.size * 0.72 * fade);
        ctx.lineCap = "round";
        ctx.globalAlpha = fade * 0.85;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();

        // Twinkling starlight tip
        const twinkle = dtBurst > 0.35 ? 0.68 + 0.32 * Math.sin(dtBurst * 28 + sp.angle * 7) : 1;
        ctx.globalAlpha = fade * twinkle;
        ctx.fillStyle = dtBurst < 0.12 ? "#ffffff" : sp.colorShift > 0.45 ? r.primaryColor : r.secondaryColor;
        ctx.beginPath();
        ctx.arc(sx, sy, sp.size * (0.5 + 0.5 * fade), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();

  // Centred legend / tempo badge inside bottom hall frieze (centred on x = 540, y = 1575)
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 18px ${MUSIC_FONT_STACK}`;
  ctx.fillStyle = "rgba(226, 232, 240, 0.78)";
  const approxBpm = Math.round(lerp(112, 196, rawProgress));
  ctx.fillText(
    `ACCELERANDO · ${approxBpm} BPM · PITCH ↔ MORTAR · VELOCITY ↔ ALTITUDE`,
    MUSIC_STAGE.cx,
    1570,
  );
  ctx.restore();

  ctx.restore();
}
