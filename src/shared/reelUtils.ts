export interface ReelBox {
  label: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const REEL_SAFE_BOUNDS = {
  left: 60,
  right: 900,
  top: 220,
  bottom: 1560,
} as const;

export function assertReelSafeBox(box: ReelBox): void {
  if (
    !Number.isFinite(box.left) ||
    !Number.isFinite(box.right) ||
    !Number.isFinite(box.top) ||
    !Number.isFinite(box.bottom) ||
    box.right < box.left ||
    box.bottom < box.top ||
    box.left < REEL_SAFE_BOUNDS.left - 0.5 ||
    box.right > REEL_SAFE_BOUNDS.right + 0.5 ||
    box.top < REEL_SAFE_BOUNDS.top - 0.5 ||
    box.bottom > REEL_SAFE_BOUNDS.bottom + 0.5
  ) {
    throw new RangeError(`Unsafe reel UI bounds: ${JSON.stringify(box)}`);
  }
}

export function drawReelText(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  str: string,
  x: number,
  y: number,
  opts: {
    size?: number;
    color?: string;
    align?: "left" | "center" | "right";
    maxWidth?: number;
    weight?: number;
    fontFamily?: string;
  } = {},
): ReelBox {
  const {
    size = 24,
    color = "#f4f5f7",
    align = "left",
    maxWidth = 820,
    weight = 600,
    fontFamily = '"Inter Variable", Inter, sans-serif',
  } = opts;

  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  let fontSize = size;
  let measured: TextMetrics;
  while (true) {
    ctx.font = `${weight} ${fontSize}px ${fontFamily}`;
    measured = ctx.measureText(str);
    if (measured.width <= maxWidth || fontSize <= 10) break;
    fontSize -= 0.5;
  }

  const px =
    align === "center"
      ? x - measured.width / 2
      : align === "right"
        ? x - measured.width
        : x;

  const ascent = measured.actualBoundingBoxAscent || fontSize * 0.78;
  const descent = measured.actualBoundingBoxDescent || fontSize * 0.22;
  const left = px - (measured.actualBoundingBoxLeft || 0);
  const right = px + (measured.actualBoundingBoxRight || measured.width);
  const box: ReelBox = {
    label: str,
    left,
    top: y - ascent,
    right,
    bottom: y + descent,
  };
  assertReelSafeBox(box);
  boxes.push(box);
  ctx.fillText(str, px, y);
  return box;
}

export interface VectorLogoEntry {
  width: number;
  height: number;
  paths: readonly {
    d: string;
    rule?: "nonzero" | "evenodd";
    color?: string;
  }[];
}

export type LocalLogoAtlas = Record<string, VectorLogoEntry>;

const PATH2D_CACHE = new Map<string, Path2D>();

function cachedPath2D(d: string): Path2D {
  let p = PATH2D_CACHE.get(d);
  if (!p) {
    p = new Path2D(d);
    PATH2D_CACHE.set(d, p);
  }
  return p;
}

function hashKey(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Renders either an optional local Path2D logo entry (when present in localLogoAtlas)
 * or a crisp MIT-clean procedural geometric + monogram emblem by default.
 */
export function drawEmblemPaths(
  ctx: CanvasRenderingContext2D,
  key: string,
  monogram: string,
  cx: number,
  cy: number,
  size: number,
  color: string,
  atlas?: LocalLogoAtlas | null,
): void {
  const custom = atlas?.[key];
  if (custom && typeof Path2D !== "undefined" && custom.paths.length > 0) {
    ctx.save();
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(size / custom.width, size / custom.height);
    for (const p of custom.paths) {
      ctx.fillStyle = p.color ?? color;
      ctx.fill(cachedPath2D(p.d), p.rule ?? "nonzero");
    }
    ctx.restore();
    return;
  }

  // Clean procedural geometric vector badge + crisp monogram (default in MIT repo)
  const variant = hashKey(key) % 5;
  const r = size * 0.48;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.4, size * 0.075);

  if (variant === 0) {
    // Hexagonal ring
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 3;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.35;
    ctx.stroke();
  } else if (variant === 1) {
    // Diamond facet
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.globalAlpha = 0.35;
    ctx.stroke();
  } else if (variant === 2) {
    // Dual orbital arcs
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.94, -0.7, 1.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.94, Math.PI - 0.7, Math.PI + 1.9);
    ctx.globalAlpha = 0.35;
    ctx.stroke();
  } else if (variant === 3) {
    // Octagonal star ticks
    ctx.globalAlpha = 0.32;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.stroke();
    }
  } else {
    // Concentric triangle frame
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.32;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  const fontSize = Math.max(9, Math.round(size * 0.48));
  ctx.font = `800 ${fontSize}px "Inter Variable", Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(monogram, 0, fontSize * 0.04);
  ctx.restore();
}
