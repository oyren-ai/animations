import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { VIDEO } from "../settings.ts";
import { assertReelSafeBox, REEL_SAFE_BOUNDS, type ReelBox } from "../shared/reelUtils.ts";
import { paintAurora } from "./backdrop.ts";
import { CAPTION_PANEL, paintShowcaseOverlay, REMIX_WINDOW, SHOWCASE_SURFACES } from "./overlay.ts";
import { SHOWCASE_COPY } from "./script.ts";
import { cueAtFrame, SHOWCASE_TIMING } from "./timing.ts";

const timing = SHOWCASE_TIMING;

/** A 2D context that records nothing but measures text like the repo's other tests (0.54 em per character). */
function createMockCanvas2D(): CanvasRenderingContext2D {
  let currentFont = "600 24px Inter";
  const base: Record<string, unknown> = {
    fillStyle: "#000",
    strokeStyle: "#fff",
    globalAlpha: 1,
    lineWidth: 1,
    textAlign: "left",
    textBaseline: "alphabetic",
    get font() {
      return currentFont;
    },
    set font(value: string) {
      currentFont = value;
    },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText(text: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(currentFont)?.[1] ?? 24);
      const width = text.length * px * 0.54;
      return {
        width,
        actualBoundingBoxAscent: px * 0.76,
        actualBoundingBoxDescent: px * 0.22,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: width,
      };
    },
  };
  return new Proxy(base, {
    get: (target, property) => (property in target ? target[property as string] : () => undefined),
    set: (target, property, value) => {
      target[property as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function paintAt(frame: number): ReelBox[] {
  return paintShowcaseOverlay(createMockCanvas2D(), frame, timing);
}

test("text is on screen on frame 0 and stays inside the reel safe zone for the whole short", () => {
  const first = paintAt(0).map((box) => box.label);
  assert.ok(first.includes("EVERY ANIMATION") && first.includes("TYPESCRIPT"), `frame 0 labels: ${first.join(" | ")}`);
  for (let frame = 0; frame < timing.totalFrames; frame += 7) {
    for (const box of paintAt(frame)) assertReelSafeBox(box);
  }
  for (const box of paintAt(timing.totalFrames - 1)) assertReelSafeBox(box);
});

test("panels are inside the safe zone", () => {
  for (const panel of [CAPTION_PANEL, REMIX_WINDOW]) {
    assert.ok(panel.left >= REEL_SAFE_BOUNDS.left && panel.right <= REEL_SAFE_BOUNDS.right);
    assert.ok(panel.top >= REEL_SAFE_BOUNDS.top && panel.bottom <= REEL_SAFE_BOUNDS.bottom);
  }
  assert.ok(REMIX_WINDOW.bottom < CAPTION_PANEL.top, "the remix window never covers the caption panel");
});

test("no UI surface is near-black, so the pixel-fill gate (max channel above 8) holds even inside panels", () => {
  const darkestAurora = 13; // the backdrop base #05080d has a max channel of 13
  for (const [name, fill] of Object.entries(SHOWCASE_SURFACES)) {
    const match = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(fill);
    assert.ok(match, `${name} is not an rgba() fill`);
    const alpha = Number(match[4]);
    const worst = alpha * Math.max(Number(match[1]), Number(match[2]), Number(match[3])) + (1 - alpha) * darkestAurora;
    assert.ok(worst > 9, `${name} blends to a max channel of ${worst.toFixed(1)}, which the gate counts as empty`);
  }
});

test("the caption shows the spoken phrase while it is spoken, word by word", () => {
  for (const cue of timing.cues) {
    const frame = Math.floor((cue.fromFrame + cue.toFrame) / 2);
    assert.equal(cueAtFrame(timing, frame), cue);
    const labels = paintAt(frame).map((box) => box.label);
    for (const word of cue.words) assert.ok(labels.includes(word.text), `"${word.text}" missing while "${cue.text}" is shown`);
  }
});

test("the remix window shows the edit, the typed command, the progress and the result in order", () => {
  const { remix } = timing;
  const before = paintAt(remix.editFrame - 2).map((box) => box.label);
  assert.ok(before.some((label) => label.includes(SHOWCASE_COPY.remix.valueBefore)));
  const after = paintAt(remix.editFrame + 40).map((box) => box.label);
  assert.ok(after.some((label) => label.includes(SHOWCASE_COPY.remix.valueAfter)));
  assert.ok(!paintAt(remix.commandFrame - 2).some((box) => box.label.startsWith("pnpm")));
  assert.ok(paintAt(remix.progressFrame + 2).some((box) => box.label === SHOWCASE_COPY.remix.command));
  assert.ok(paintAt(remix.doneFrame + 4).some((box) => box.label.includes("out/pendulum-wave.mp4") && box.label.includes("1080x1920")));
});

test("the end card names the repo, the remix link and the AI voice disclosure", () => {
  const labels = paintAt(timing.totalFrames - 1).map((box) => box.label);
  for (const text of [SHOWCASE_COPY.end.url, SHOWCASE_COPY.end.remix, SHOWCASE_COPY.end.cta, SHOWCASE_COPY.end.disclosure]) {
    assert.ok(labels.includes(text), `end card is missing "${text}"`);
  }
});

test("the overlay does not claim unshown shaders or comeback scenes", () => {
  const forbidden = /shader|webgl|glsl|comeback|audio-reactive|photo[- ]finish/i;
  for (let frame = 0; frame < timing.totalFrames; frame += 11) {
    for (const box of paintAt(frame)) assert.doesNotMatch(box.label, forbidden, `frame ${frame}: ${box.label}`);
  }
});

test("showcase production modules and shell use shared theme color tokens", () => {
  for (const file of ["backdrop.ts", "overlay.ts", "script.ts", "../components/RepoShowcaseShell.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!/(?:#[\da-f]{3,8}\b|rgba?\s*\()/i.test(source), `${file} has a raw color outside theme.ts`);
  }
});

test("painting needs no Node Buffer and the aurora backdrop paints every frame without text", () => {
  const original = globalThis.Buffer;
  // @ts-expect-error simulate the browser bundle, where Buffer does not exist
  globalThis.Buffer = undefined;
  try {
    for (const frame of [0, 300, 700, 1100, timing.totalFrames - 1]) {
      paintShowcaseOverlay(createMockCanvas2D(), frame, timing);
      paintAurora(createMockCanvas2D(), frame, VIDEO.width, VIDEO.height);
    }
  } finally {
    globalThis.Buffer = original;
  }
});

test("browser-bundled showcase modules import no Node built-ins and never name Buffer", () => {
  const nodeOnly = new Set(["audio.ts"]);
  const directory = new URL("./", import.meta.url);
  for (const file of readdirSync(directory)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts") || nodeOnly.has(file)) continue;
    const source = readFileSync(new URL(file, directory), "utf8");
    assert.doesNotMatch(source, /from "node:/, `${file} imports a Node built-in`);
    assert.doesNotMatch(source, /\bBuffer\b/, `${file} names Buffer`);
  }
  const shell = readFileSync(new URL("../components/RepoShowcaseShell.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(shell, /from "node:|\bBuffer\b/);
});
