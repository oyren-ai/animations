/**
 * A recording stand-in for CanvasRenderingContext2D, used only by tests.
 * Unknown methods are accepted as no-ops, so painters can use any Canvas 2D call.
 * It records what was drawn so tests can check full-bleed coverage and the text in the HUD.
 */
export interface MockText {
  text: string;
  x: number;
  y: number;
  font: string;
}

export interface MockShape {
  kind: "arc" | "rect" | "poly";
  cx: number;
  cy: number;
  /** Half extents of the shape's bounding box. */
  hw: number;
  hh: number;
}

export interface MockCanvas {
  ctx: CanvasRenderingContext2D;
  fillRects: { x: number; y: number; w: number; h: number }[];
  texts: MockText[];
  shapes: MockShape[];
  /** Total number of fill or stroke calls. */
  paintCalls: () => number;
  /** Fraction of the cols x rows grid cells that contain the centre of at least one non-background shape. */
  coverageGrid: (cols: number, rows: number, width?: number, height?: number) => number;
}

export function createMockCanvas(): MockCanvas {
  const fillRects: MockCanvas["fillRects"] = [];
  const texts: MockText[] = [];
  const shapes: MockShape[] = [];
  /** Individual arc and rect primitives, so batched paths still count where each piece sits. */
  const prims: MockShape[] = [];
  let paints = 0;
  let font = "600 24px Inter";
  let pathMinX = Infinity;
  let pathMaxX = -Infinity;
  let pathMinY = Infinity;
  let pathMaxY = -Infinity;

  const resetPath = () => {
    pathMinX = Infinity;
    pathMaxX = -Infinity;
    pathMinY = Infinity;
    pathMaxY = -Infinity;
  };
  const addPoint = (x: number, y: number) => {
    pathMinX = Math.min(pathMinX, x);
    pathMaxX = Math.max(pathMaxX, x);
    pathMinY = Math.min(pathMinY, y);
    pathMaxY = Math.max(pathMaxY, y);
  };
  const flushPath = () => {
    if (pathMaxX >= pathMinX && pathMaxY >= pathMinY) {
      shapes.push({
        kind: "poly",
        cx: (pathMinX + pathMaxX) / 2,
        cy: (pathMinY + pathMaxY) / 2,
        hw: (pathMaxX - pathMinX) / 2,
        hh: (pathMaxY - pathMinY) / 2,
      });
    }
  };

  const gradient = { addColorStop() {} };
  const target: Record<string | symbol, unknown> = {
    fillStyle: "#000",
    strokeStyle: "#fff",
    shadowColor: "#000",
    shadowBlur: 0,
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalCompositeOperation: "source-over",
    save() {},
    restore() {},
    clearRect() {},
    fillRect(x: number, y: number, w: number, h: number) {
      fillRects.push({ x, y, w, h });
      paints++;
      shapes.push({ kind: "rect", cx: x + w / 2, cy: y + h / 2, hw: w / 2, hh: h / 2 });
    },
    beginPath() {
      resetPath();
    },
    closePath() {},
    moveTo(x: number, y: number) {
      addPoint(x, y);
    },
    lineTo(x: number, y: number) {
      addPoint(x, y);
    },
    quadraticCurveTo(_cx: number, _cy: number, x: number, y: number) {
      addPoint(x, y);
    },
    bezierCurveTo(_a: number, _b: number, _c: number, _d: number, x: number, y: number) {
      addPoint(x, y);
    },
    arc(x: number, y: number, r: number) {
      addPoint(x - r, y - r);
      addPoint(x + r, y + r);
      prims.push({ kind: "arc", cx: x, cy: y, hw: r, hh: r });
    },
    rect(x: number, y: number, w: number, h: number) {
      addPoint(x, y);
      addPoint(x + w, y + h);
      prims.push({ kind: "rect", cx: x + w / 2, cy: y + h / 2, hw: w / 2, hh: h / 2 });
    },
    roundRect(x: number, y: number, w: number, h: number) {
      addPoint(x, y);
      addPoint(x + w, y + h);
      prims.push({ kind: "rect", cx: x + w / 2, cy: y + h / 2, hw: w / 2, hh: h / 2 });
    },
    fill() {
      paints++;
      flushPath();
    },
    stroke() {
      paints++;
      flushPath();
    },
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    transform() {},
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, font });
    },
    strokeText() {},
    createLinearGradient() {
      return gradient;
    },
    createRadialGradient() {
      return gradient;
    },
    measureText(str: string) {
      const m = /(\d+(?:\.\d+)?)px/.exec(font);
      const px = m ? Number(m[1]) : 24;
      const width = str.length * px * 0.54;
      return {
        width,
        actualBoundingBoxAscent: px * 0.76,
        actualBoundingBoxDescent: px * 0.22,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: width,
      };
    },
  };
  Object.defineProperty(target, "font", {
    get: () => font,
    set: (v: string) => {
      font = v;
    },
    enumerable: true,
  });

  const ctx = new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      return () => undefined;
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  const coverageGrid = (cols: number, rows: number, width = 1080, height = 1920): number => {
    const hit = new Set<number>();
    for (const s of [...shapes, ...prims]) {
      // Skip full-width bands (backdrops and HUD scrims); they are not the action.
      if (s.kind === "rect" && s.hw * 2 >= width * 0.9) continue;
      const c = Math.floor((s.cx / width) * cols);
      const r = Math.floor((s.cy / height) * rows);
      if (c >= 0 && c < cols && r >= 0 && r < rows) hit.add(r * cols + c);
    }
    return hit.size / (cols * rows);
  };

  return { ctx, fillRects, texts, shapes, paintCalls: () => paints, coverageGrid };
}
