// Full-bleed animated backdrop for AnimationsRepoShowcase: a deep navy field, three slow glows in the
// brand colours and a drifting grid. Deterministic for a given frame, so a re-render is identical.

interface Glow {
  readonly rgb: string;
  readonly radius: number;
  readonly alpha: number;
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly speedX: number;
  readonly speedY: number;
  readonly phase: number;
}

const GLOWS: readonly Glow[] = [
  { rgb: "200,255,133", radius: 820, alpha: 0.3, cx: 230, cy: 520, rx: 240, ry: 300, speedX: 0.55, speedY: 0.4, phase: 0.2 },
  { rgb: "116,185,209", radius: 980, alpha: 0.34, cx: 880, cy: 1080, rx: 200, ry: 360, speedX: 0.42, speedY: 0.6, phase: 1.9 },
  { rgb: "140,104,255", radius: 800, alpha: 0.26, cx: 500, cy: 1660, rx: 320, ry: 190, speedX: 0.7, speedY: 0.35, phase: 3.7 },
];

const GRID_STEP = 120;

export function paintAurora(ctx: CanvasRenderingContext2D, frame: number, width: number, height: number): void {
  const seconds = frame / 60;
  ctx.fillStyle = "#05080d";
  ctx.fillRect(0, 0, width, height);

  for (const glow of GLOWS) {
    const x = glow.cx + glow.rx * Math.sin(seconds * glow.speedX + glow.phase);
    const y = glow.cy + glow.ry * Math.cos(seconds * glow.speedY + glow.phase * 1.7);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, glow.radius);
    gradient.addColorStop(0, `rgba(${glow.rgb},${glow.alpha})`);
    gradient.addColorStop(1, `rgba(${glow.rgb},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.strokeStyle = "rgba(116,185,209,0.07)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const drift = (seconds * 26) % GRID_STEP;
  for (let y = -GRID_STEP + drift; y <= height; y += GRID_STEP) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  for (let x = 0; x <= width; x += GRID_STEP) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  ctx.stroke();

  const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, height * 0.75);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}
