// Preview frames of a hit composition without a browser, GPU or Remotion render.
//
//   node --import tsx scripts/preview-hit.mjs <slug> <frame,frame,...> <out.png> [scale]
//   e.g. node --import tsx scripts/preview-hit.mjs overflow-arena 0,40,420,900,1180 /tmp/overflow.png 0.25
//
// It runs the real simulate() and paint() of the composition on a software Skia canvas and writes a
// contact sheet. It also prints the active-pixel fill (max(R,G,B) > 8) of every frame, the same rule
// the render QA uses. The canvas package is optional and not a dependency of this repo:
//   pnpm add -D @napi-rs/canvas
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [slug, frameArg, outPath, scaleArg] = process.argv.slice(2);
if (!slug || !frameArg || !outPath) {
  console.error("usage: node --import tsx scripts/preview-hit.mjs <slug> <frames> <out.png> [scale]");
  process.exit(2);
}

let canvasLib;
try {
  canvasLib = await import("@napi-rs/canvas");
} catch {
  console.error("This preview needs the optional package @napi-rs/canvas. Install it with: pnpm add -D @napi-rs/canvas");
  process.exit(3);
}
const { createCanvas, GlobalFonts } = canvasLib;

const scale = Number(scaleArg ?? 0.25);
const frames = frameArg.split(",").map((n) => Number(n.trim()));
GlobalFonts.registerFromPath(
  join(root, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
  "Inter Variable",
);

const { getHit } = await import(pathToFileURL(join(root, "src/hits/index.ts")).href);
const comp = getHit(slug);
const trace = comp.simulate();

const cw = Math.round(1080 * scale);
const ch = Math.round(1920 * scale);
const pad = 10;
const label = 26;
const sheet = createCanvas(frames.length * (cw + pad) + pad, ch + pad * 2 + label);
const sctx = sheet.getContext("2d");
sctx.fillStyle = "#222";
sctx.fillRect(0, 0, sheet.width, sheet.height);

frames.forEach((f, i) => {
  const canvas = createCanvas(1080, 1920);
  const ctx = canvas.getContext("2d");
  const boxes = comp.paint(ctx, trace, f);
  const data = ctx.getImageData(0, 0, 1080, 1920).data;
  let all = 0;
  let top = 0;
  let bottom = 0;
  for (let y = 0; y < 1920; y++) {
    let row = 0;
    for (let x = 0; x < 1080; x++) {
      const o = (y * 1080 + x) * 4;
      if (Math.max(data[o], data[o + 1], data[o + 2]) > 8) row++;
    }
    all += row;
    if (y < 220) top += row;
    if (y > 1560) bottom += row;
  }
  console.log(
    `f${f}: fill ${((all / (1080 * 1920)) * 100).toFixed(1)}%  top ${((top / (1080 * 220)) * 100).toFixed(1)}%  bottom ${((bottom / (1080 * 359)) * 100).toFixed(1)}%  ${boxes.length} text boxes`,
  );
  const x = pad + i * (cw + pad);
  sctx.drawImage(canvas, x, pad + label, cw, ch);
  sctx.fillStyle = "#fff";
  sctx.font = "16px sans-serif";
  sctx.fillText(`f${f} (${(f / 60).toFixed(1)}s)`, x, pad + 16);
});

writeFileSync(outPath, sheet.toBuffer("image/png"));
console.log("wrote", outPath, `${sheet.width}x${sheet.height}`);
