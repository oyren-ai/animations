import { VIDEO } from "../settings.ts";
import { theme } from "../theme.ts";
import { FLASK_JOIN_Y, type PatateTrace } from "./sim.ts";
import {
  PATATE_FLASK,
  type PatateCostumeId,
  type PatateTierSpec,
} from "./themes.ts";

const RAINBOW_STOPS = [
  "#ff2ea6",
  "#3b82f6",
  "#10b981",
  "#facc15",
  "#f97316",
  "#a855f7",
] as const;

interface StarSpec {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly phase: number;
  readonly speed: number;
}

const STARS: readonly StarSpec[] = Array.from({ length: 72 }, (_, i) => {
  const s1 = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  const s2 = Math.sin(i * 93.9898 + 19.19) * 24634.6345;
  const fx = s1 - Math.floor(s1);
  const fy = s2 - Math.floor(s2);
  return {
    x: 24 + fx * (VIDEO.width - 48),
    y: 32 + fy * (VIDEO.height - 64),
    r: 0.9 + (i % 4) * 0.52,
    phase: i * 0.83,
    speed: 1.4 + (i % 5) * 0.45,
  };
});

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawPotatoBase(
  ctx: CanvasRenderingContext2D,
  r: number,
  skinTint: string,
  lineW: number,
) {
  ctx.beginPath();
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rad =
      r *
      (0.955 +
        0.028 * Math.cos(2 * a - 0.55) +
        0.016 * Math.sin(3 * a + 0.4));
    const px = Math.cos(a) * rad * 0.99;
    const py = Math.sin(a) * rad * 0.94;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.32, r * 0.1, 0, 0, r * 1.05);
  grad.addColorStop(0, "#fae29c");
  grad.addColorStop(0.55, skinTint);
  grad.addColorStop(1, "#9c6125");
  ctx.fillStyle = grad;
  ctx.fill();

  // Warm rim highlight
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "rgba(255, 250, 225, 0.28)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.28, -r * 0.34, r * 0.34, r * 0.2, -0.45, 0, Math.PI * 2);
  ctx.fill();

  // Cute subtle potato speckles
  ctx.fillStyle = "rgba(120, 68, 22, 0.28)";
  for (const [sx, sy, sr] of [
    [-0.52, 0.22, 0.055],
    [0.54, 0.28, 0.048],
    [0.38, 0.52, 0.04],
    [-0.34, 0.54, 0.042],
  ] as const) {
    ctx.beginPath();
    ctx.arc(r * sx, r * sy, Math.max(1.2, r * sr), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.lineWidth = lineW;
  ctx.strokeStyle = "#1c1209";
  ctx.stroke();
}

function drawCuteFace(
  ctx: CanvasRenderingContext2D,
  r: number,
  opts?: {
    hideEyes?: boolean;
    mustache?: "curled" | "bushy" | "handlebar" | "pencil";
    goofyTeeth?: boolean;
    bigSmile?: boolean;
  },
) {
  const eyeY = -r * 0.03;
  const eyeX = r * 0.27;

  // Rosy cheeks
  ctx.fillStyle = "rgba(251, 113, 133, 0.56)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.42, eyeY + r * 0.17, r * 0.14, r * 0.085, 0, 0, Math.PI * 2);
  ctx.ellipse(r * 0.42, eyeY + r * 0.17, r * 0.14, r * 0.085, 0, 0, Math.PI * 2);
  ctx.fill();

  if (!opts?.hideEyes) {
    const ew = Math.max(2.2, r * 0.105);
    const eh = Math.max(2.6, r * 0.135);
    ctx.fillStyle = "#14110f";
    ctx.beginPath();
    ctx.ellipse(-eyeX, eyeY, ew, eh, 0, 0, Math.PI * 2);
    ctx.ellipse(eyeX, eyeY, ew, eh, 0, 0, Math.PI * 2);
    ctx.fill();

    // Catchlights
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(-eyeX - ew * 0.28, eyeY - eh * 0.3, Math.max(1, ew * 0.36), 0, Math.PI * 2);
    ctx.arc(eyeX - ew * 0.28, eyeY - eh * 0.3, Math.max(1, ew * 0.36), 0, Math.PI * 2);
    ctx.fill();
  }

  // Mouth / Mustache
  const mouthY = eyeY + r * 0.22;
  if (opts?.goofyTeeth) {
    // Goofy Go-gopher two front teeth!
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#1c1209";
    ctx.lineWidth = Math.max(1.5, r * 0.04);
    roundedRectPath(ctx, -r * 0.13, mouthY - r * 0.02, r * 0.12, r * 0.16, r * 0.03);
    ctx.fill();
    ctx.stroke();
    roundedRectPath(ctx, r * 0.01, mouthY - r * 0.02, r * 0.12, r * 0.16, r * 0.03);
    ctx.fill();
    ctx.stroke();
  }

  ctx.strokeStyle = "#1c1209";
  ctx.lineWidth = Math.max(2, r * 0.055);
  ctx.lineCap = "round";
  ctx.beginPath();
  if (opts?.bigSmile) {
    ctx.arc(0, mouthY - r * 0.04, r * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
  } else {
    ctx.arc(0, mouthY - r * 0.03, r * 0.13, 0.18 * Math.PI, 0.82 * Math.PI);
  }
  ctx.stroke();

  if (opts?.mustache) {
    ctx.fillStyle = opts.mustache === "bushy" ? "#3b2313" : "#1c1209";
    const my = mouthY - r * 0.04;
    if (opts.mustache === "bushy") {
      ctx.beginPath();
      ctx.ellipse(-r * 0.18, my, r * 0.24, r * 0.1, -0.22, 0, Math.PI * 2);
      ctx.ellipse(r * 0.18, my, r * 0.24, r * 0.1, 0.22, 0, Math.PI * 2);
      ctx.fill();
    } else if (opts.mustache === "handlebar" || opts.mustache === "curled") {
      ctx.lineWidth = Math.max(2.4, r * 0.075);
      ctx.strokeStyle = "#1c1209";
      ctx.beginPath();
      ctx.moveTo(0, my);
      ctx.bezierCurveTo(-r * 0.16, my - r * 0.06, -r * 0.34, my + r * 0.08, -r * 0.38, my - r * 0.06);
      ctx.moveTo(0, my);
      ctx.bezierCurveTo(r * 0.16, my - r * 0.06, r * 0.34, my + r * 0.08, r * 0.38, my - r * 0.06);
      ctx.stroke();
    } else if (opts.mustache === "pencil") {
      ctx.lineWidth = Math.max(1.8, r * 0.045);
      ctx.beginPath();
      ctx.moveTo(-r * 0.26, my - r * 0.01);
      ctx.quadraticCurveTo(-r * 0.12, my - r * 0.06, -r * 0.03, my);
      ctx.moveTo(r * 0.26, my - r * 0.01);
      ctx.quadraticCurveTo(r * 0.12, my - r * 0.06, r * 0.03, my);
      ctx.stroke();
    }
  }
}

function drawBandText(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  r: number,
  bg: string,
  fg: string,
) {
  const bw = r * 0.84;
  const bh = r * 0.34;
  roundedRectPath(ctx, -bw * 0.5, y - bh * 0.5, bw, bh, bh * 0.32);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = Math.max(1.6, r * 0.045);
  ctx.strokeStyle = "#14110f";
  ctx.stroke();

  ctx.fillStyle = fg;
  ctx.font = `900 ${Math.max(9, Math.round(r * 0.24))}px ${theme.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, y + 1);
}

function drawCostume(
  ctx: CanvasRenderingContext2D,
  r: number,
  costume: PatateCostumeId,
  lineW: number,
) {
  switch (costume) {
    case "terminal": {
      drawCuteFace(ctx, r);
      // Neon green headband + dark >_ terminal plate
      roundedRectPath(ctx, -r * 0.88, -r * 0.58, r * 1.76, r * 0.24, r * 0.1);
      ctx.fillStyle = "#22c55e";
      ctx.fill();
      ctx.lineWidth = lineW * 0.85;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();
      drawBandText(ctx, ">_", -r * 0.46, r * 0.9, "#0f172a", "#4ade80");
      break;
    }

    case "copilot": {
      drawCuteFace(ctx, r);
      // Blue propeller cap + sky aviator goggles on forehead
      ctx.beginPath();
      ctx.arc(0, -r * 0.56, r * 0.58, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = "#0284c7";
      ctx.fill();
      ctx.lineWidth = lineW * 0.85;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();

      // Propeller stem + blades
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.14);
      ctx.lineTo(0, -r * 1.28);
      ctx.stroke();
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.ellipse(-r * 0.22, -r * 1.28, r * 0.22, r * 0.065, 0, 0, Math.PI * 2);
      ctx.ellipse(r * 0.22, -r * 1.28, r * 0.22, r * 0.065, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Aviator goggles on brow
      for (const gx of [-r * 0.28, r * 0.28]) {
        roundedRectPath(ctx, gx - r * 0.23, -r * 0.62, r * 0.46, r * 0.28, r * 0.1);
        ctx.fillStyle = "#38bdf8";
        ctx.fill();
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = Math.max(2, r * 0.055);
        ctx.stroke();
        ctx.strokeStyle = "#14110f";
        ctx.lineWidth = Math.max(1.4, r * 0.035);
        ctx.stroke();
      }
      break;
    }

    case "cursor": {
      drawCuteFace(ctx, r);
      // Sleek matte-black visor cap + white 3D cursor arrow emblem
      ctx.beginPath();
      ctx.arc(0, -r * 0.48, r * 0.66, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = "#0f172a";
      ctx.fill();
      ctx.lineWidth = lineW * 0.9;
      ctx.strokeStyle = "#f8fafc";
      ctx.stroke();

      // Cap brim
      roundedRectPath(ctx, -r * 0.72, -r * 0.52, r * 1.48, r * 0.16, r * 0.08);
      ctx.fillStyle = "#1e293b";
      ctx.fill();
      ctx.strokeStyle = "#0f172a";
      ctx.stroke();

      // Crisp white cursor arrow on crown
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, -r * 0.96);
      ctx.lineTo(r * 0.18, -r * 0.72);
      ctx.lineTo(r * 0.03, -r * 0.7);
      ctx.lineTo(r * 0.1, -r * 0.58);
      ctx.lineTo(-r * 0.01, -r * 0.54);
      ctx.lineTo(-r * 0.07, -r * 0.67);
      ctx.lineTo(-r * 0.16, -r * 0.61);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case "opencode": {
      drawCuteFace(ctx, r, { hideEyes: true, bigSmile: true });
      // Cyan hacker bandana
      roundedRectPath(ctx, -r * 0.9, -r * 0.62, r * 1.8, r * 0.25, r * 0.1);
      ctx.fillStyle = "#06b6d4";
      ctx.fill();
      ctx.lineWidth = lineW * 0.85;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();
      // Bandana knot tails on right
      ctx.beginPath();
      ctx.moveTo(r * 0.85, -r * 0.52);
      ctx.lineTo(r * 1.12, -r * 0.64);
      ctx.lineTo(r * 1.04, -r * 0.44);
      ctx.closePath();
      ctx.fillStyle = "#0891b2";
      ctx.fill();
      ctx.stroke();

      // Deal-with-it pixel shades
      ctx.fillStyle = "#090d16";
      ctx.fillRect(-r * 0.68, -r * 0.16, r * 1.36, r * 0.1);
      ctx.fillRect(-r * 0.58, -r * 0.08, r * 0.46, r * 0.22);
      ctx.fillRect(r * 0.12, -r * 0.08, r * 0.46, r * 0.22);
      ctx.fillStyle = "#67e8f9";
      ctx.fillRect(-r * 0.5, -r * 0.04, r * 0.16, r * 0.06);
      ctx.fillRect(r * 0.2, -r * 0.04, r * 0.16, r * 0.06);
      break;
    }

    case "gemini": {
      drawCuteFace(ctx, r, { bigSmile: true });
      // Twin-star cosmic blue-violet crown + 4-point sparkle gem
      ctx.beginPath();
      ctx.moveTo(-r * 0.64, -r * 0.54);
      ctx.lineTo(-r * 0.72, -r * 0.98);
      ctx.lineTo(-r * 0.32, -r * 0.74);
      ctx.lineTo(0, -r * 1.14);
      ctx.lineTo(r * 0.32, -r * 0.74);
      ctx.lineTo(r * 0.72, -r * 0.98);
      ctx.lineTo(r * 0.64, -r * 0.54);
      ctx.closePath();
      const cg = ctx.createLinearGradient(-r * 0.65, -r, r * 0.65, -r * 0.5);
      cg.addColorStop(0, "#3b82f6");
      cg.addColorStop(0.5, "#818cf8");
      cg.addColorStop(1, "#c084fc");
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.lineWidth = lineW * 0.85;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();

      // 4-point sparkle star in center
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      const sy = -r * 0.78;
      const sr = r * 0.2;
      ctx.moveTo(0, sy - sr);
      ctx.quadraticCurveTo(0, sy, sr, sy);
      ctx.quadraticCurveTo(0, sy, 0, sy + sr);
      ctx.quadraticCurveTo(0, sy, -sr, sy);
      ctx.quadraticCurveTo(0, sy, 0, sy - sr);
      ctx.fill();
      break;
    }

    case "codex":
    case "codex-twist": {
      drawCuteFace(ctx, r, { hideEyes: costume === "codex-twist", bigSmile: true });
      // Emerald hexagonal beret / chef crown
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.68, r * 0.76, r * 0.34, -0.1, 0, Math.PI * 2);
      ctx.fillStyle = "#059669";
      ctx.fill();
      ctx.lineWidth = lineW * 0.9;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();

      roundedRectPath(ctx, -r * 0.66, -r * 0.6, r * 1.32, r * 0.18, r * 0.06);
      ctx.fillStyle = "#0f172a";
      ctx.fill();
      ctx.stroke();

      // Hexagonal code emblem on beret
      ctx.strokeStyle = "#6ee7b7";
      ctx.lineWidth = Math.max(2, r * 0.045);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2 - Math.PI / 2;
        const hx = Math.cos(ang) * r * 0.18;
        const hy = -r * 0.76 + Math.sin(ang) * r * 0.18;
        if (k === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.stroke();

      if (costume === "codex") {
        // Crisp glowing emerald terminal monocle over right eye
        ctx.beginPath();
        ctx.arc(r * 0.28, -r * 0.03, r * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(16, 185, 129, 0.34)";
        ctx.fill();
        ctx.lineWidth = Math.max(2.2, r * 0.055);
        ctx.strokeStyle = "#34d399";
        ctx.stroke();
      } else {
        // Plot-twist glowing emerald cyber visor!
        roundedRectPath(ctx, -r * 0.62, -r * 0.18, r * 1.24, r * 0.3, r * 0.12);
        ctx.fillStyle = "#064e3b";
        ctx.fill();
        ctx.lineWidth = Math.max(2.2, r * 0.05);
        ctx.strokeStyle = "#34d399";
        ctx.stroke();
        ctx.fillStyle = "#6ee7b7";
        ctx.font = `900 ${Math.max(10, Math.round(r * 0.19))}px ${theme.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("CODEX", 0, -r * 0.02);
      }
      break;
    }

    case "claude-code":
    case "claude-twist": {
      drawCuteFace(ctx, r, { bigSmile: true });
      // French navy-and-cream striped scarf at base of potato!
      ctx.save();
      roundedRectPath(ctx, -r * 0.72, r * 0.42, r * 1.44, r * 0.26, r * 0.12);
      ctx.fillStyle = "#fef3c7";
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = "#1e3a8a";
      for (let sx = -r * 0.7; sx < r * 0.75; sx += r * 0.24) {
        ctx.fillRect(sx, r * 0.4, r * 0.12, r * 0.3);
      }
      ctx.restore();
      roundedRectPath(ctx, -r * 0.72, r * 0.42, r * 1.44, r * 0.26, r * 0.12);
      ctx.lineWidth = lineW * 0.8;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();

      // Warm terracotta-amber sunburst crown!
      ctx.beginPath();
      const rays = 7;
      ctx.moveTo(-r * 0.68, -r * 0.54);
      for (let k = 0; k < rays; k++) {
        const t0 = -0.64 + (k / rays) * 1.28;
        const tm = -0.64 + ((k + 0.5) / rays) * 1.28;
        const t1 = -0.64 + ((k + 1) / rays) * 1.28;
        ctx.lineTo(r * t0, -r * 0.58);
        ctx.lineTo(
          r * tm * 1.08,
          -r * (k === 3 ? 1.18 : k % 2 === 1 ? 1.04 : 0.94),
        );
        ctx.lineTo(r * t1, -r * 0.58);
      }
      ctx.closePath();
      const tg = ctx.createLinearGradient(0, -r * 1.18, 0, -r * 0.54);
      tg.addColorStop(0, "#fdba74");
      tg.addColorStop(0.5, "#f97316");
      tg.addColorStop(1, "#c2410c");
      ctx.fillStyle = tg;
      ctx.fill();
      ctx.lineWidth = lineW * 0.85;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();

      if (costume === "claude-twist") {
        // Glowing amber terminal halo above crown
        ctx.strokeStyle = "#fdba74";
        ctx.lineWidth = Math.max(2.5, r * 0.05);
        ctx.beginPath();
        ctx.ellipse(0, -r * 1.24, r * 0.52, r * 0.11, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case "oyren": {
      // BOSS TIER 8: Iconic Oyren 3D Mascot White-Box Visor Helmet + #c8ff00 Lime Rectangle Eyes + Lime Antenna + Violet Ear Caps + Black Ring Chest Badge!
      // Subtle golden boss radiance behind helmet
      ctx.save();
      const glow = ctx.createRadialGradient(0, -r * 0.08, r * 0.3, 0, -r * 0.08, r * 1.28);
      glow.addColorStop(0, "rgba(200, 255, 0, 0.34)");
      glow.addColorStop(1, "rgba(200, 255, 0, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, -r * 0.08, r * 1.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Happy rosy mouth visible on golden potato chin below the Oyren helmet visor!
      ctx.fillStyle = "rgba(251, 113, 133, 0.55)";
      ctx.beginPath();
      ctx.ellipse(-r * 0.44, r * 0.34, r * 0.13, r * 0.08, 0, 0, Math.PI * 2);
      ctx.ellipse(r * 0.44, r * 0.34, r * 0.13, r * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();

      // Black circular ring badge on lower potato chest
      ctx.beginPath();
      ctx.arc(0, r * 0.56, r * 0.17, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(3, r * 0.075);
      ctx.strokeStyle = "#0f172a";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, r * 0.56, r * 0.07, 0, Math.PI * 2);
      ctx.fillStyle = "#c8ff00";
      ctx.fill();

      // Antenna stem + glowing lime #c8ff00 ball on top
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = Math.max(3, r * 0.075);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.74);
      ctx.lineTo(0, -r * 1.04);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, -r * 1.12, r * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = "#c8ff00";
      ctx.fill();
      ctx.lineWidth = lineW * 0.85;
      ctx.strokeStyle = "#0f172a";
      ctx.stroke();

      // Violet ear caps (#8b5cf6) on left & right of helmet
      for (const side of [-1, 1]) {
        roundedRectPath(
          ctx,
          side * r * 0.68 - (side > 0 ? r * 0.04 : r * 0.14),
          -r * 0.42,
          r * 0.18,
          r * 0.38,
          r * 0.08,
        );
        ctx.fillStyle = "#8b5cf6";
        ctx.fill();
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = lineW * 0.85;
        ctx.stroke();
      }

      // White rounded-box 3D Oyren mascot visor helmet
      roundedRectPath(ctx, -r * 0.7, -r * 0.74, r * 1.4, r * 0.92, r * 0.28);
      const hg = ctx.createLinearGradient(0, -r * 0.74, 0, r * 0.18);
      hg.addColorStop(0, "#ffffff");
      hg.addColorStop(0.75, "#f1f5f9");
      hg.addColorStop(1, "#cbd5e1");
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.lineWidth = lineW;
      ctx.strokeStyle = "#0f172a";
      ctx.stroke();

      // Dark obsidian screen inset
      roundedRectPath(ctx, -r * 0.56, -r * 0.58, r * 1.12, r * 0.6, r * 0.18);
      ctx.fillStyle = "#090d16";
      ctx.fill();

      // Two glowing lime #c8ff00 rounded-rectangle Oyren eyes!
      ctx.fillStyle = "#c8ff00";
      ctx.shadowColor = "#c8ff00";
      ctx.shadowBlur = Math.max(4, r * 0.12);
      roundedRectPath(ctx, -r * 0.38, -r * 0.41, r * 0.24, r * 0.28, r * 0.06);
      ctx.fill();
      roundedRectPath(ctx, r * 0.14, -r * 0.41, r * 0.24, r * 0.28, r * 0.06);
      ctx.fill();
      ctx.shadowBlur = 0;
      break;
    }

    case "mini-fez": {
      drawCuteFace(ctx, r);
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, -r * 0.58);
      ctx.lineTo(-r * 0.22, -r * 0.98);
      ctx.lineTo(r * 0.22, -r * 0.98);
      ctx.lineTo(r * 0.3, -r * 0.58);
      ctx.closePath();
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.lineWidth = lineW * 0.85;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();
      break;
    }

    case "turque": {
      drawCuteFace(ctx, r, { mustache: "curled" });
      // Crimson Turkish fez + black tassel
      ctx.beginPath();
      ctx.moveTo(-r * 0.44, -r * 0.54);
      ctx.lineTo(-r * 0.33, -r * 1.1);
      ctx.lineTo(r * 0.33, -r * 1.1);
      ctx.lineTo(r * 0.44, -r * 0.54);
      ctx.closePath();
      ctx.fillStyle = "#dc2626";
      ctx.fill();
      ctx.lineWidth = lineW * 0.9;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();

      // Tassel
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = Math.max(2.2, r * 0.06);
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.1);
      ctx.quadraticCurveTo(r * 0.36, -r * 1.06, r * 0.42, -r * 0.72);
      ctx.stroke();
      break;
    }

    case "mexicaine": {
      drawCuteFace(ctx, r, { mustache: "bushy" });
      // Wide festive sombrero
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.56, r * 1.08, r * 0.24, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#facc15";
      ctx.fill();
      ctx.lineWidth = lineW * 0.85;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-r * 0.42, -r * 0.62);
      ctx.quadraticCurveTo(0, -r * 1.38, r * 0.42, -r * 0.62);
      ctx.closePath();
      ctx.fillStyle = "#eab308";
      ctx.fill();
      ctx.stroke();

      // Red & green trim stripe
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = Math.max(2.2, r * 0.055);
      ctx.beginPath();
      ctx.moveTo(-r * 0.72, -r * 0.55);
      ctx.lineTo(r * 0.72, -r * 0.55);
      ctx.stroke();
      break;
    }

    case "italienne": {
      drawCuteFace(ctx, r, { mustache: "handlebar" });
      // Puffy white chef toque + Italian green-white-red band
      ctx.fillStyle = "#f8fafc";
      ctx.strokeStyle = "#14110f";
      ctx.lineWidth = lineW * 0.85;
      ctx.beginPath();
      ctx.arc(-r * 0.28, -r * 0.86, r * 0.28, 0, Math.PI * 2);
      ctx.arc(r * 0.28, -r * 0.86, r * 0.28, 0, Math.PI * 2);
      ctx.arc(0, -r * 0.96, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Tricolor headband
      const bw = r * 1.08;
      const bh = r * 0.22;
      const bx = -bw * 0.5;
      const by = -r * 0.68;
      ctx.fillStyle = "#16a34a";
      ctx.fillRect(bx, by, bw / 3, bh);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(bx + bw / 3, by, bw / 3, bh);
      ctx.fillStyle = "#dc2626";
      ctx.fillRect(bx + (2 * bw) / 3, by, bw / 3, bh);
      ctx.strokeRect(bx, by, bw, bh);
      break;
    }

    case "francaise": {
      drawCuteFace(ctx, r, { mustache: "pencil" });
      // Tricolor neck scarf
      const sw = r * 1.24;
      const sh = r * 0.22;
      ctx.fillStyle = "#2563eb";
      ctx.fillRect(-sw * 0.5, r * 0.44, sw / 3, sh);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-sw * 0.5 + sw / 3, r * 0.44, sw / 3, sh);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(-sw * 0.5 + (2 * sw) / 3, r * 0.44, sw / 3, sh);
      ctx.strokeStyle = "#14110f";
      ctx.lineWidth = lineW * 0.8;
      ctx.strokeRect(-sw * 0.5, r * 0.44, sw, sh);

      // Tilted classic black French beret
      ctx.beginPath();
      ctx.ellipse(-r * 0.08, -r * 0.72, r * 0.78, r * 0.26, -0.18, 0, Math.PI * 2);
      ctx.fillStyle = "#1e293b";
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, -r * 0.96);
      ctx.lineTo(-r * 0.18, -r * 1.1);
      ctx.stroke();
      break;
    }

    case "binary": {
      drawCuteFace(ctx, r);
      roundedRectPath(ctx, -r * 0.86, -r * 0.58, r * 1.72, r * 0.24, r * 0.1);
      ctx.fillStyle = "#1e293b";
      ctx.fill();
      ctx.lineWidth = lineW * 0.85;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();
      drawBandText(ctx, "01", -r * 0.46, r * 0.9, "#052e16", "#4ade80");
      break;
    }

    case "bash": {
      drawCuteFace(ctx, r);
      ctx.beginPath();
      ctx.arc(0, -r * 0.48, r * 0.66, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = "#1e293b";
      ctx.fill();
      ctx.lineWidth = lineW * 0.85;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();
      drawBandText(ctx, "$_", -r * 0.72, r * 0.92, "#0f172a", "#38bdf8");
      break;
    }

    case "javascript": {
      drawCuteFace(ctx, r, { bigSmile: true });
      // Bright yellow sideways street cap with JS monogram
      ctx.beginPath();
      ctx.arc(0, -r * 0.48, r * 0.66, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = "#facc15";
      ctx.fill();
      ctx.lineWidth = lineW * 0.85;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();
      // Sideways brim to the right
      roundedRectPath(ctx, r * 0.1, -r * 0.58, r * 0.86, r * 0.16, r * 0.08);
      ctx.fillStyle = "#eab308";
      ctx.fill();
      ctx.stroke();
      drawBandText(ctx, "JS", -r * 0.74, r * 0.9, "#facc15", "#0f172a");
      break;
    }

    case "python": {
      drawCuteFace(ctx, r);
      // Blue & gold twin-serpent turban + ruby gem
      ctx.beginPath();
      ctx.ellipse(-r * 0.22, -r * 0.74, r * 0.48, r * 0.3, -0.2, 0, Math.PI * 2);
      ctx.fillStyle = "#2563eb";
      ctx.fill();
      ctx.lineWidth = lineW * 0.85;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(r * 0.22, -r * 0.74, r * 0.48, r * 0.3, 0.2, 0, Math.PI * 2);
      ctx.fillStyle = "#facc15";
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, -r * 0.72, r * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.stroke();
      break;
    }

    case "typescript": {
      drawCuteFace(ctx, r);
      // Royal blue wizard/conductor hat + TS badge + golden monocle
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.54, r * 0.84, r * 0.18, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#1d4ed8";
      ctx.fill();
      ctx.lineWidth = lineW * 0.85;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-r * 0.52, -r * 0.56);
      ctx.lineTo(0, -r * 1.24);
      ctx.lineTo(r * 0.52, -r * 0.56);
      ctx.closePath();
      ctx.fillStyle = "#2563eb";
      ctx.fill();
      ctx.stroke();

      drawBandText(ctx, "TS", -r * 0.76, r * 0.86, "#2563eb", "#ffffff");

      ctx.beginPath();
      ctx.arc(r * 0.28, -r * 0.03, r * 0.2, 0, Math.PI * 2);
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = Math.max(2, r * 0.05);
      ctx.stroke();
      break;
    }

    case "golang": {
      // Cyan gopher ears on top + big goofy front teeth!
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(side * r * 0.56, -r * 0.72, r * 0.24, 0, Math.PI * 2);
        ctx.fillStyle = "#22d3ee";
        ctx.fill();
        ctx.lineWidth = lineW * 0.85;
        ctx.strokeStyle = "#14110f";
        ctx.stroke();
      }
      roundedRectPath(ctx, -r * 0.68, -r * 0.64, r * 1.36, r * 0.2, r * 0.09);
      ctx.fillStyle = "#06b6d4";
      ctx.fill();
      ctx.stroke();
      drawCuteFace(ctx, r, { goofyTeeth: true });
      break;
    }

    case "rust": {
      drawCuteFace(ctx, r, { bigSmile: true });
      // Iron 5-tooth cog crown + fiery orange Ferris crab-claw side crests!
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(
          side * r * 0.84,
          -r * 0.42,
          r * 0.26,
          side < 0 ? 0.5 : Math.PI - 1.9,
          side < 0 ? 1.9 : Math.PI - 0.5,
          side > 0,
        );
        ctx.lineTo(side * r * 0.66, -r * 0.42);
        ctx.closePath();
        ctx.fillStyle = "#f97316";
        ctx.fill();
        ctx.lineWidth = lineW * 0.85;
        ctx.strokeStyle = "#14110f";
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(-r * 0.62, -r * 0.54);
      for (let k = 0; k < 5; k++) {
        const x0 = -r * 0.58 + k * r * 0.25;
        ctx.lineTo(x0, -r * 0.88);
        ctx.lineTo(x0 + r * 0.15, -r * 0.88);
        ctx.lineTo(x0 + r * 0.19, -r * 0.64);
      }
      ctx.lineTo(r * 0.62, -r * 0.54);
      ctx.closePath();
      ctx.fillStyle = "#475569";
      ctx.fill();
      ctx.stroke();
      break;
    }

    case "lean4": {
      drawCuteFace(ctx, r, { bigSmile: true });
      // Radiant golden theorem-prover halo + royal crown with ∀ symbol!
      ctx.save();
      const glow = ctx.createRadialGradient(0, -r * 0.2, r * 0.3, 0, -r * 0.2, r * 1.25);
      glow.addColorStop(0, "rgba(250, 204, 21, 0.35)");
      glow.addColorStop(1, "rgba(250, 204, 21, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r * 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = "#fde047";
      ctx.lineWidth = Math.max(3, r * 0.06);
      ctx.beginPath();
      ctx.ellipse(0, -r * 1.22, r * 0.62, r * 0.13, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-r * 0.68, -r * 0.52);
      ctx.lineTo(-r * 0.74, -r * 1.02);
      ctx.lineTo(-r * 0.34, -r * 0.74);
      ctx.lineTo(0, -r * 1.12);
      ctx.lineTo(r * 0.34, -r * 0.74);
      ctx.lineTo(r * 0.74, -r * 1.02);
      ctx.lineTo(r * 0.68, -r * 0.52);
      ctx.closePath();
      ctx.fillStyle = "#eab308";
      ctx.fill();
      ctx.lineWidth = lineW * 0.9;
      ctx.strokeStyle = "#14110f";
      ctx.stroke();

      drawBandText(ctx, "∀4", -r * 0.72, r * 0.85, "#0f172a", "#fde047");
      break;
    }
  }
}

export function drawPotatoCharacter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  theta: number,
  scaleX: number,
  scaleY: number,
  tierSpec: PatateTierSpec,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.rotate(theta);
  ctx.scale(scaleX, scaleY);

  const lineW = Math.max(2.4, r * 0.068);
  drawPotatoBase(ctx, r, tierSpec.skinTint, lineW);
  drawCostume(ctx, r, tierSpec.costume, lineW);
  ctx.restore();
}

function drawFlaskInteriorFill(ctx: CanvasRenderingContext2D) {
  const { cx, cy, radius, chuteHalfWidth, chuteTopY } = PATATE_FLASK;
  const gapAngle = Math.asin(chuteHalfWidth / radius);
  const startAngle = -Math.PI / 2 + gapAngle;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - chuteHalfWidth, chuteTopY);
  ctx.lineTo(cx - chuteHalfWidth, FLASK_JOIN_Y);
  ctx.arc(cx, cy, radius, -Math.PI / 2 - gapAngle, startAngle, true);
  ctx.lineTo(cx + chuteHalfWidth, chuteTopY);
  ctx.closePath();
  const glassGrad = ctx.createRadialGradient(cx, cy - 80, 50, cx, cy, radius);
  glassGrad.addColorStop(0, "rgba(30, 41, 75, 0.36)");
  glassGrad.addColorStop(0.75, "rgba(12, 16, 34, 0.56)");
  glassGrad.addColorStop(1, "rgba(255, 255, 255, 0.06)");
  ctx.fillStyle = glassGrad;
  ctx.fill();
  ctx.restore();
}

function drawFlaskAndChute(ctx: CanvasRenderingContext2D, frame: number) {
  const { cx, cy, radius, chuteHalfWidth, chuteTopY, wallThickness } = PATATE_FLASK;
  const gapAngle = Math.asin(chuteHalfWidth / radius);
  const startAngle = -Math.PI / 2 + gapAngle;
  const endAngle = Math.PI * 1.5 - gapAngle;

  // Smoothly hue-rotating rainbow circular wall (45 deg/sec)
  const rot = ((frame / VIDEO.fps) * Math.PI) / 4;
  ctx.save();
  ctx.lineCap = "round";

  const segments = 90;
  const totalSweep = endAngle - startAngle;
  // Outer soft glow pass + crisp 11px inner pass
  for (const [width, alpha] of [
    [wallThickness + 13, 0.24],
    [wallThickness, 1.0],
  ] as const) {
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    for (let i = 0; i < segments; i++) {
      const a0 = startAngle + (i / segments) * totalSweep;
      const a1 = startAngle + ((i + 1.04) / segments) * totalSweep;
      const hueDeg = (((a0 + rot) * 180) / Math.PI + 3600) % 360;
      ctx.strokeStyle = `hsl(${hueDeg.toFixed(1)} 95% 60%)`;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, a0, a1);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Crisp white vertical chemistry-flask neck chute walls
  ctx.save();
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 6.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Left neck wall + subtle top lip flare
  ctx.beginPath();
  ctx.moveTo(cx - chuteHalfWidth - 10, chuteTopY);
  ctx.quadraticCurveTo(
    cx - chuteHalfWidth,
    chuteTopY,
    cx - chuteHalfWidth,
    chuteTopY + 12,
  );
  ctx.lineTo(cx - chuteHalfWidth, FLASK_JOIN_Y + 2);
  ctx.stroke();

  // Right neck wall + subtle top lip flare
  ctx.beginPath();
  ctx.moveTo(cx + chuteHalfWidth + 10, chuteTopY);
  ctx.quadraticCurveTo(
    cx + chuteHalfWidth,
    chuteTopY,
    cx + chuteHalfWidth,
    chuteTopY + 12,
  );
  ctx.lineTo(cx + chuteHalfWidth, FLASK_JOIN_Y + 2);
  ctx.stroke();
  ctx.restore();
}

function drawTopBadge(ctx: CanvasRenderingContext2D, badge: string) {
  ctx.save();
  ctx.font = `900 26px ${theme.fontFamily}`;
  const tw = ctx.measureText(badge).width;
  const x = 58;
  const y = 112;
  const w = tw + 44;
  const h = 54;

  roundedRectPath(ctx, x, y, w, h, 27);
  const bg = ctx.createLinearGradient(x, y, x, y + h);
  bg.addColorStop(0, "#fb923c");
  bg.addColorStop(0.5, "#f97316");
  bg.addColorStop(1, "#ea580c");
  ctx.fillStyle = bg;
  ctx.fill();

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badge, x + w * 0.5, y + h * 0.5 + 1);
  ctx.restore();
}

function drawOpeningHook(
  ctx: CanvasRenderingContext2D,
  hook: string,
  frame: number,
) {
  const maxHookFrame = 144; // 2.40s
  if (frame > maxHookFrame) return;

  const alpha =
    frame <= 108 ? 1 : Math.max(0, 1 - (frame - 108) / (maxHookFrame - 108));
  const pop = frame < 14 ? 0.94 + 0.06 * (frame / 14) : 1;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(PATATE_FLASK.cx, 608);
  ctx.scale(pop, pop);

  ctx.font = `900 44px ${theme.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Split into 2 balanced lines if wider than 620px
  const words = hook.split(" ");
  let lines = [hook];
  if (ctx.measureText(hook).width > 610 && words.length >= 3) {
    const mid = Math.ceil(words.length / 2);
    lines = [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }

  ctx.lineJoin = "round";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(8, 10, 22, 0.92)";
  ctx.fillStyle = "#ffffff";

  lines.forEach((line, idx) => {
    const ly = (idx - (lines.length - 1) * 0.5) * 54;
    ctx.strokeText(line, 0, ly);
    ctx.fillText(line, 0, ly);
  });
  ctx.restore();
}

function drawBottomHud(
  ctx: CanvasRenderingContext2D,
  trace: PatateTrace,
  frame: number,
) {
  const f = trace.frames[Math.min(frame, trace.frames.length - 1)];

  // 1. Score readout (y = 1432)
  ctx.save();
  const scoreText = `SCORE: ${f.score.toLocaleString("en-US")}`;
  ctx.font = `900 50px ${theme.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(5, 8, 18, 0.9)";
  ctx.strokeText(scoreText, 540, 1432);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(scoreText, 540, 1432);
  ctx.restore();

  // 2. 8-Slot Evolution Bar (y = 1528)
  const slotR = 30;
  const gap = 12;
  const totalW = 8 * (slotR * 2) + 7 * gap; // 564px -> x: 258..822
  const startX = 540 - totalW * 0.5 + slotR;
  const slotY = 1528;

  for (let i = 0; i < 8; i++) {
    const tierSpec = trace.spec.tiers[i];
    const unlockF = f.unlockedUpToFrame[i];
    const sx = startX + i * (slotR * 2 + gap);

    ctx.save();
    let pulseScale = 1;
    let flashAlpha = 0;
    if (unlockF !== null && unlockF > 0) {
      const age = frame - unlockF;
      if (age >= 0 && age <= 38) {
        const p = age / 38;
        pulseScale = 1 + 0.24 * Math.sin(p * Math.PI) * (1 - p * 0.4);
        flashAlpha = (1 - p) * 0.95;
      }
    }

    ctx.translate(sx, slotY);
    ctx.scale(pulseScale, pulseScale);

    if (flashAlpha > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, slotR + 9, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(200, 255, 0, ${flashAlpha.toFixed(3)})`;
      ctx.lineWidth = 5;
      ctx.stroke();
    }

    // Slot circle background
    ctx.beginPath();
    ctx.arc(0, 0, slotR, 0, Math.PI * 2);
    ctx.fillStyle = unlockF !== null ? "#172036" : "#0e1424";
    ctx.fill();

    if (unlockF !== null) {
      ctx.save();
      ctx.clip();
      // Draw mini potato portrait inside unlocked slot!
      drawPotatoCharacter(ctx, 0, 5, 18.5, 0, 1, 1, tierSpec, 1);
      ctx.restore();

      ctx.beginPath();
      ctx.arc(0, 0, slotR, 0, Math.PI * 2);
      ctx.lineWidth = i === 7 ? 3.8 : 3.0;
      ctx.strokeStyle = tierSpec.accent;
      ctx.stroke();
    } else {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#334155";
      ctx.stroke();

      ctx.fillStyle = "#64748b";
      ctx.font = `900 28px ${theme.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", 0, 2);
    }

    ctx.restore();
  }
}

export function paintPatateFrame(
  ctx: CanvasRenderingContext2D,
  trace: PatateTrace,
  rawFrame: number,
) {
  const frame = Math.max(0, Math.min(trace.frames.length - 1, rawFrame));
  const f = trace.frames[frame];

  // 1. Deep midnight space background (#080a16) + twinkling star dust
  ctx.fillStyle = "#080a16";
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);

  const bgGlow = ctx.createRadialGradient(540, 905, 60, 540, 905, 660);
  bgGlow.addColorStop(0, "rgba(56, 189, 248, 0.08)");
  bgGlow.addColorStop(0.6, "rgba(139, 92, 246, 0.04)");
  bgGlow.addColorStop(1, "rgba(8, 10, 22, 0)");
  ctx.fillStyle = bgGlow;
  ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);

  const sec = frame / VIDEO.fps;
  for (const st of STARS) {
    const tw = 0.32 + 0.55 * (0.5 + 0.5 * Math.sin(sec * st.speed + st.phase));
    ctx.fillStyle = `rgba(226, 232, 240, ${tw.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Flask interior glass + queued chute potatoes + active rigid-body potatoes
  drawFlaskInteriorFill(ctx);

  // Draw queued preview potatoes first so chute walls sit crisply around them
  for (const q of f.queued) {
    drawPotatoCharacter(
      ctx,
      q.x,
      q.y,
      q.r,
      q.theta,
      1,
      1,
      trace.spec.tiers[q.tier - 1],
      q.alpha,
    );
  }

  // Draw active potatoes sorted smaller-first so giant boss potatoes command foreground presence
  const sortedBodies = [...f.bodies].sort((a, b) => a.tier - b.tier || a.id - b.id);
  for (const b of sortedBodies) {
    drawPotatoCharacter(
      ctx,
      b.x,
      b.y,
      b.r,
      b.theta,
      b.scaleX,
      b.scaleY,
      trace.spec.tiers[b.tier - 1],
      1,
    );
  }

  // 3. Merge shockwaves & radial sparkles
  for (const sw of f.shockwaves) {
    const curR = sw.baseR + (sw.maxR - sw.baseR) * (1 - Math.pow(1 - sw.progress, 2.2));
    const alpha = Math.pow(1 - sw.progress, 1.45);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, curR, 0, Math.PI * 2);
    ctx.strokeStyle = sw.accent;
    ctx.lineWidth = Math.max(2, (sw.tier === 8 ? 12 : 7.5) * (1 - sw.progress * 0.65));
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(sw.x, sw.y, curR * 0.84, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.5, 3.5 * (1 - sw.progress));
    ctx.stroke();
    ctx.restore();
  }

  for (const sp of f.sparkles) {
    ctx.save();
    ctx.globalAlpha = sp.alpha;
    ctx.fillStyle = sp.color;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 4. Flask rainbow ring & crisp white neck chute walls over top edge
  drawFlaskAndChute(ctx, frame);

  // 5. Floating French merge callouts ("LA PATATE CODEXIENNE !")
  for (const c of f.callouts) {
    const p = c.progress;
    const pop =
      p < 0.16
        ? 0.65 + 0.45 * (p / 0.16)
        : p < 0.28
          ? 1.1 - 0.1 * ((p - 0.16) / 0.12)
          : 1.0;
    const alpha = p < 0.72 ? 1 : Math.max(0, 1 - (p - 0.72) / 0.28);
    const floatY = c.y - p * 34;

    ctx.save();
    ctx.globalAlpha = alpha;
    const fontPx = c.tier === 8 ? 30 : c.tier >= 6 ? 26 : 23;
    ctx.font = `900 ${fontPx}px ${theme.fontFamily}`;
    const tw = ctx.measureText(c.text).width;
    const pw = tw + 34;
    const ph = fontPx + 20;
    const clampedX = Math.max(64 + pw * 0.5, Math.min(VIDEO.width - 64 - pw * 0.5, c.x));

    ctx.translate(clampedX, floatY);
    ctx.scale(pop, pop);

    roundedRectPath(ctx, -pw * 0.5, -ph * 0.5, pw, ph, ph * 0.5);
    ctx.fillStyle = "rgba(8, 10, 22, 0.88)";
    ctx.fill();
    ctx.lineWidth = c.tier >= 7 ? 3.2 : 2.4;
    ctx.strokeStyle = c.accent;
    ctx.stroke();

    ctx.fillStyle = c.tier === 8 ? "#c8ff00" : "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(c.text, 0, 1);
    ctx.restore();
  }

  // 6. Top-left badge, frame-0 hook question, and bottom Score + 8-slot evolution bar
  drawTopBadge(ctx, trace.spec.badge);
  drawOpeningHook(ctx, trace.spec.hook, frame);
  drawBottomHud(ctx, trace, frame);

  // Subtle smooth fade-out over final 12 frames into the closing end card
  if (frame >= trace.sceneFrames - 12) {
    const fade = (frame - (trace.sceneFrames - 12)) / 12;
    ctx.fillStyle = `rgba(8, 10, 22, ${Math.min(1, fade).toFixed(3)})`;
    ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
  }
}

export { RAINBOW_STOPS };
