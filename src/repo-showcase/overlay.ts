// Text and UI layer for AnimationsRepoShowcase: hook headline, word-highlighted captions, the remix
// window and the end card. Every text draw goes through drawReelText, which throws if a box leaves
// REEL_SAFE_BOUNDS, and the painter returns the boxes so tests can check them. Pure and browser-safe.
import { VIDEO } from "../settings.ts";
import { drawReelText, type ReelBox } from "../shared/reelUtils.ts";
import { easeOut, theme } from "../theme.ts";
import { SHOWCASE_COPY } from "./script.ts";
import { beatAtFrame, cueAtFrame, SHOWCASE_TIMING, type ShowcaseTiming } from "./timing.ts";

export const CAPTION_PANEL = { left: 60, right: 900, top: 1290, bottom: 1540 } as const;
export const REMIX_WINDOW = { left: 60, right: 900, top: 250, bottom: 1230 } as const;

const SANS = '"Inter Variable", Inter, sans-serif';
const MONO = 'ui-monospace, "JetBrains Mono", "SF Mono", Consolas, "DejaVu Sans Mono", monospace';
const WHITE = "#f7fafc";
const MUTED = "rgba(241,245,249,0.5)";
const SOFT = "rgba(241,245,249,0.82)";
const LIME = theme.colors.primary;
const BLUE = theme.colors.accent;
const NAVY = "5,9,14";
const CENTER_X = 480;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

function fitSize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight: number): number {
  let fitted = size;
  for (;;) {
    ctx.font = `${weight} ${fitted}px ${SANS}`;
    if (ctx.measureText(text).width <= maxWidth || fitted <= 10) return fitted;
    fitted -= 0.5;
  }
}

function roundedPanel(
  ctx: CanvasRenderingContext2D,
  box: Box,
  radius: number | number[],
  fill: string | CanvasGradient,
  stroke?: string,
): void {
  ctx.beginPath();
  ctx.roundRect(box.left, box.top, box.right - box.left, box.bottom - box.top, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

interface CaptionWord {
  readonly text: string;
  readonly color: string;
}

function splitLines(ctx: CanvasRenderingContext2D, words: readonly CaptionWord[], maxWidth: number): CaptionWord[][] {
  const width = (list: readonly CaptionWord[]) => ctx.measureText(list.map((word) => word.text).join(" ")).width;
  if (width(words) <= maxWidth) return [words.slice()];
  let best: CaptionWord[][] | null = null;
  let bestWidth = Infinity;
  for (let split = 1; split < words.length; split++) {
    const first = words.slice(0, split);
    const second = words.slice(split);
    const widest = Math.max(width(first), width(second));
    if (widest <= maxWidth && widest < bestWidth) {
      best = [first, second];
      bestWidth = widest;
    }
  }
  if (best) return best;
  const lines: CaptionWord[][] = [];
  let current: CaptionWord[] = [];
  for (const word of words) {
    const next = [...current, word];
    if (current.length > 0 && width(next) > maxWidth) {
      lines.push(current);
      current = [word];
    } else {
      current = next;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Draws words centred on (centerX, centerY) in at most two balanced lines, one colour per word. */
function drawCaptionWords(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  words: readonly CaptionWord[],
  opts: { centerX: number; centerY: number; maxWidth: number; size: number; weight?: number },
): void {
  const weight = opts.weight ?? 800;
  let size = opts.size;
  let lines: CaptionWord[][];
  for (;;) {
    ctx.font = `${weight} ${size}px ${SANS}`;
    lines = splitLines(ctx, words, opts.maxWidth);
    if (lines.length <= 2 || size <= 30) break;
    size -= 2;
  }
  const lineHeight = size * 1.18;
  const blockTop = opts.centerY - (lines.length * lineHeight) / 2;
  for (const [index, line] of lines.entries()) {
    const baseline = blockTop + index * lineHeight + size * 0.86;
    ctx.font = `${weight} ${size}px ${SANS}`;
    let x = opts.centerX - ctx.measureText(line.map((word) => word.text).join(" ")).width / 2;
    for (const word of line) {
      drawReelText(ctx, boxes, word.text, x, baseline, { size, weight, color: word.color, maxWidth: opts.maxWidth });
      x += ctx.measureText(`${word.text} `).width;
    }
  }
}

function paintHook(ctx: CanvasRenderingContext2D, boxes: ReelBox[]): void {
  const scrim = ctx.createLinearGradient(0, 200, 0, 980);
  scrim.addColorStop(0, `rgba(${NAVY},0)`);
  scrim.addColorStop(0.14, `rgba(${NAVY},0.78)`);
  scrim.addColorStop(0.78, `rgba(${NAVY},0.78)`);
  scrim.addColorStop(1, `rgba(${NAVY},0)`);
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 200, VIDEO.width, 780);
  ctx.fillStyle = LIME;
  ctx.fillRect(80, 330, 120, 6);

  const { lines, sub } = SHOWCASE_COPY.hook;
  const size = Math.min(...lines.map((line) => fitSize(ctx, line, 820, 124, 800)));
  const step = size * 1.08;
  for (const [index, line] of lines.entries()) {
    drawReelText(ctx, boxes, line, 80, 450 + index * step, {
      size,
      weight: 800,
      color: index === lines.length - 1 ? LIME : WHITE,
      maxWidth: 820,
    });
  }
  drawReelText(ctx, boxes, sub, 80, 450 + lines.length * step + 20, { size: 30, weight: 600, color: SOFT, maxWidth: 820 });
}

function paintCaption(ctx: CanvasRenderingContext2D, boxes: ReelBox[], frame: number, timing: ShowcaseTiming): void {
  const cue = cueAtFrame(timing, frame);
  if (!cue) return;
  const lineCues = timing.cues.filter((candidate) => candidate.lineId === cue.lineId);
  const index = lineCues.indexOf(cue);
  const fadeIn = index === 0 ? clamp01((frame - cue.fromFrame + 1) / 5) : 1;
  const fadeOut = index === lineCues.length - 1 ? clamp01((cue.toFrame - frame) / 5) : 1;
  ctx.save();
  ctx.globalAlpha = Math.min(fadeIn, fadeOut);
  roundedPanel(ctx, CAPTION_PANEL, 40, `rgba(${NAVY},0.8)`, "rgba(200,255,133,0.38)");
  const words = cue.words.map((word) => ({
    text: word.text,
    color: frame < word.startFrame ? MUTED : frame < word.endFrame ? LIME : WHITE,
  }));
  drawCaptionWords(ctx, boxes, words, {
    centerX: (CAPTION_PANEL.left + CAPTION_PANEL.right) / 2,
    centerY: (CAPTION_PANEL.top + CAPTION_PANEL.bottom) / 2,
    maxWidth: 740,
    size: 64,
  });
  ctx.restore();
}

const CODE_SIZE = 34;
const EDIT_SELECT_FRAMES = 20;
const EDIT_FLASH_FRAMES = 24;

function drawCodeLine(
  ctx: CanvasRenderingContext2D,
  boxes: ReelBox[],
  line: string,
  x: number,
  baseline: number,
  edit: { value: string; selectAlpha: number } | null,
): number {
  const { valueBefore } = SHOWCASE_COPY.remix;
  let cursor = x;
  for (const token of line.match(/\b(?:export|const)\b|"[^"]*"|[A-Za-z_]\w*|\s+|./g) ?? []) {
    const shown = edit && token === valueBefore ? edit.value : token;
    ctx.font = `600 ${CODE_SIZE}px ${MONO}`;
    const width = ctx.measureText(shown).width;
    if (shown.trim() !== "") {
      if (edit && token === valueBefore && edit.selectAlpha > 0) {
        ctx.fillStyle = `rgba(116,185,209,${edit.selectAlpha})`;
        ctx.fillRect(cursor - 6, baseline - CODE_SIZE + 4, width + 12, CODE_SIZE + 12);
      }
      const color =
        token === "export" || token === "const" ? BLUE : shown.startsWith('"') ? LIME : /^[A-Za-z_]/.test(shown) ? WHITE : MUTED;
      drawReelText(ctx, boxes, shown, cursor, baseline, { size: CODE_SIZE, weight: 600, fontFamily: MONO, color, maxWidth: 760 });
    }
    cursor += width;
  }
  return cursor;
}

function paintRemix(ctx: CanvasRenderingContext2D, boxes: ReelBox[], frame: number, timing: ShowcaseTiming): void {
  const beat = timing.beats.find((candidate) => candidate.id === "l4");
  if (!beat) return;
  const { remix } = SHOWCASE_COPY;
  const { editFrame, commandFrame, progressFrame, doneFrame } = timing.remix;
  const enter = easeOut(clamp01((frame - beat.fromFrame) / 10));
  const W = REMIX_WINDOW;

  ctx.save();
  ctx.globalAlpha = enter;
  ctx.translate(0, (1 - enter) * 36);
  roundedPanel(ctx, W, 30, "rgba(7,12,18,0.95)", "rgba(116,185,209,0.4)");
  roundedPanel(ctx, { left: W.left, top: W.top, right: W.right, bottom: W.top + 70 }, [30, 30, 0, 0], "rgba(20,32,43,0.96)");
  for (const [index, color] of ["#ff5f57", "#febc2e", "#28c840"].entries()) {
    ctx.beginPath();
    ctx.arc(96 + index * 30, W.top + 35, 9, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  drawReelText(ctx, boxes, remix.title, CENTER_X + 40, W.top + 44, { size: 26, weight: 650, color: MUTED, align: "center", maxWidth: 520 });

  const tabWidth = drawReelText(ctx, boxes, remix.file, 96, W.top + 134, { size: 24, weight: 600, fontFamily: MONO, color: LIME, maxWidth: 400 });
  ctx.fillStyle = LIME;
  ctx.fillRect(96, W.top + 146, tabWidth.right - tabWidth.left, 3);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(W.left, W.top + 164, W.right - W.left, 1);

  const sinceEdit = frame - editFrame;
  const edited = sinceEdit >= EDIT_SELECT_FRAMES;
  const selectAlpha =
    sinceEdit < 0 ? 0 : edited ? 0.35 * (1 - clamp01((sinceEdit - EDIT_SELECT_FRAMES) / EDIT_FLASH_FRAMES)) : 0.35;
  for (const [index, line] of remix.code.entries()) {
    const baseline = W.top + 240 + index * 58;
    ctx.font = `600 26px ${MONO}`;
    drawReelText(ctx, boxes, String(index + 1), 96, baseline, { size: 26, weight: 600, fontFamily: MONO, color: MUTED, maxWidth: 40 });
    const isEdit = index === remix.editLineIndex;
    const end = drawCodeLine(ctx, boxes, line, 150, baseline, isEdit ? { value: edited ? remix.valueAfter : remix.valueBefore, selectAlpha } : null);
    const hex = /"(#[0-9a-f]{6})"/i.exec(line)?.[1];
    if (hex) {
      const chip = isEdit && edited ? remix.valueAfter.replaceAll('"', "") : hex;
      roundedPanel(ctx, { left: end + 22, top: baseline - 28, right: end + 52, bottom: baseline + 2 }, 8, chip, "rgba(255,255,255,0.25)");
    }
  }

  const terminalTop = W.top + 560;
  roundedPanel(ctx, { left: W.left, top: terminalTop, right: W.right, bottom: W.bottom }, [0, 0, 30, 30], "rgba(2,5,8,0.97)");
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillRect(W.left, terminalTop, W.right - W.left, 1);
  drawReelText(ctx, boxes, "TERMINAL", 96, terminalTop + 56, { size: 22, weight: 700, color: MUTED, maxWidth: 300 });
  const promptY = terminalTop + 126;
  drawReelText(ctx, boxes, "$", 96, promptY, { size: 30, weight: 700, fontFamily: MONO, color: LIME, maxWidth: 40 });
  const typed = Math.floor(clamp01((frame - commandFrame) / Math.max(1, progressFrame - commandFrame)) * remix.command.length);
  if (typed > 0) {
    drawReelText(ctx, boxes, remix.command.slice(0, typed), 134, promptY, { size: 28, weight: 600, fontFamily: MONO, color: WHITE, maxWidth: 740 });
  }

  if (frame >= progressFrame) {
    const pct = clamp01((frame - progressFrame) / Math.max(1, doneFrame - progressFrame));
    const barY = terminalTop + 222;
    drawReelText(ctx, boxes, "Rendering PendulumWave", 96, barY - 16, { size: 26, weight: 600, color: SOFT, maxWidth: 420 });
    drawReelText(ctx, boxes, `frame ${Math.round(pct * 900)}/900`, 804, barY - 16, { size: 26, weight: 600, fontFamily: MONO, color: MUTED, align: "right", maxWidth: 300 });
    roundedPanel(ctx, { left: 96, top: barY, right: 804, bottom: barY + 24 }, 12, "rgba(255,255,255,0.1)");
    if (pct > 0) {
      const fill = ctx.createLinearGradient(96, 0, 804, 0);
      fill.addColorStop(0, LIME);
      fill.addColorStop(1, BLUE);
      roundedPanel(ctx, { left: 96, top: barY, right: 96 + 708 * pct, bottom: barY + 24 }, 12, fill);
    }
  }

  if (frame >= doneFrame) {
    ctx.globalAlpha = enter * easeOut(clamp01((frame - doneFrame) / 6));
    const y = terminalTop + 342;
    ctx.strokeStyle = LIME;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(98, y - 12);
    ctx.lineTo(110, y);
    ctx.lineTo(130, y - 26);
    ctx.stroke();
    drawReelText(ctx, boxes, remix.done.replace(/^✓\s*/, ""), 146, y, { size: 28, weight: 600, fontFamily: MONO, color: LIME, maxWidth: 700 });
  }
  ctx.restore();
}

function paintEndCard(ctx: CanvasRenderingContext2D, boxes: ReelBox[], frame: number, timing: ShowcaseTiming): void {
  const local = frame - timing.endCard.fromFrame;
  const reveal = (order: number) => easeOut(clamp01((local - order * 6) / 14));
  const { end } = SHOWCASE_COPY;
  const cue = timing.cues.find((candidate) => candidate.lineId === "l5");

  const rise = (order: number, draw: () => void) => {
    const amount = reveal(order);
    ctx.save();
    ctx.globalAlpha = amount;
    ctx.translate(0, (1 - amount) * 24);
    draw();
    ctx.restore();
  };

  if (cue) {
    rise(0, () =>
      drawCaptionWords(
        ctx,
        boxes,
        cue.words.map((word) => ({ text: word.text, color: frame < word.startFrame ? MUTED : frame < word.endFrame ? LIME : WHITE })),
        { centerX: CENTER_X, centerY: 610, maxWidth: 760, size: 92 },
      ),
    );
  }
  rise(1, () => {
    ctx.fillStyle = LIME;
    ctx.fillRect(CENTER_X - 60, 790, 120, 6);
  });
  rise(2, () => drawReelText(ctx, boxes, end.url, CENTER_X, 900, { size: 60, weight: 800, color: LIME, align: "center", maxWidth: 800 }));
  rise(3, () => drawReelText(ctx, boxes, end.remix, CENTER_X, 995, { size: 42, weight: 650, color: WHITE, align: "center", maxWidth: 800 }));
  rise(4, () => drawReelText(ctx, boxes, end.cta, CENTER_X, 1105, { size: 54, weight: 800, color: BLUE, align: "center", maxWidth: 800 }));
  rise(5, () => drawReelText(ctx, boxes, end.disclosure, CENTER_X, 1490, { size: 28, weight: 600, color: MUTED, align: "center", maxWidth: 800 }));
}

function cutFlashAlpha(frame: number, timing: ShowcaseTiming): number {
  const remixBeat = timing.beats.find((candidate) => candidate.id === "l4");
  const boundaries = [...timing.segments.map((segment) => segment.fromFrame), remixBeat?.fromFrame ?? 0, timing.endCard.fromFrame];
  let alpha = 0;
  for (const boundary of boundaries) {
    const since = frame - boundary;
    if (boundary > 0 && since >= 0 && since < 5) alpha = Math.max(alpha, 0.34 * (1 - since / 5));
  }
  return alpha;
}

export function paintShowcaseOverlay(ctx: CanvasRenderingContext2D, frame: number, timing: ShowcaseTiming = SHOWCASE_TIMING): ReelBox[] {
  ctx.clearRect(0, 0, VIDEO.width, VIDEO.height);
  const boxes: ReelBox[] = [];
  const beat = beatAtFrame(timing, frame);

  if (beat.id === "l1") paintHook(ctx, boxes);
  if (beat.id === "l4") paintRemix(ctx, boxes, frame, timing);
  if (beat.id === "l5") paintEndCard(ctx, boxes, frame, timing);
  else paintCaption(ctx, boxes, frame, timing);

  const flash = cutFlashAlpha(frame, timing);
  if (flash > 0) {
    ctx.save();
    ctx.globalAlpha = flash;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
    ctx.restore();
  }
  return boxes;
}
