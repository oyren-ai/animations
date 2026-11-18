import assert from "node:assert/strict";
import test from "node:test";
import { barSegments, paintSwarmFrame, SWARM_LAYOUT, swarmBoxIsSafe, TITLE_CAP_HEIGHT, TITLE_FONT_SIZE, TITLE_MIN_FONT_SIZE } from "./paint.ts";
import { SWARM_DEFINITIONS, simulateSwarmDefinition } from "./themes.ts";

function makeMockCanvasContext(): CanvasRenderingContext2D {
  let currentFont = '600 20px "Inter Variable"';
  const gradientStub = { addColorStop() {} };
  const target: Record<string, unknown> = {
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    shadowColor: "rgba(0,0,0,0)",
    shadowBlur: 0,
    textAlign: "left",
    textBaseline: "alphabetic",
    get font() {
      return currentFont;
    },
    set font(v: string) {
      currentFont = v;
    },
    measureText(str: string) {
      const match = /(\d+(?:\.\d+)?)px/.exec(currentFont);
      const size = match ? Number(match[1]) : 20;
      const width = str.length * size * 0.52;
      return {
        width,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: width,
        actualBoundingBoxAscent: size * 0.76,
        actualBoundingBoxDescent: size * 0.22,
      };
    },
    createRadialGradient: () => gradientStub,
    createLinearGradient: () => gradientStub,
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop as string];
      return () => {};
    },
    set(obj, prop, val) {
      obj[prop as string] = val;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const inSafeZone = swarmBoxIsSafe;
const centreX = (b: { left: number; right: number }) => (b.left + b.right) / 2;

test("swarm HUD, title and caption sit in the framing zone, centred on x = 540, with a 110 px+ title", () => {
  assert.ok(TITLE_MIN_FONT_SIZE >= 110 && TITLE_FONT_SIZE >= TITLE_MIN_FONT_SIZE);
  assert.ok(TITLE_CAP_HEIGHT >= 110, "drawn cap height, not only the font size, is 110 px or more");
  const ctx = makeMockCanvasContext();
  for (const definition of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(definition.slug);
    const frames = [0, Math.floor(trace.winFrame / 2), trace.winFrame - 1, trace.winFrame, trace.totalFrames - 1];
    for (const frame of frames) {
      const boxes = paintSwarmFrame(ctx, definition, trace, frame);
      for (const box of boxes) assert.ok(inSafeZone(box), `${definition.id} f${frame}: ${JSON.stringify(box)} escaped the safe zone`);
      const title = boxes.find((b) => b.label === definition.skin.title);
      assert.ok(title, `${definition.id}: title missing`);
      assert.ok(title.bottom - title.top >= TITLE_MIN_FONT_SIZE, `${definition.id}: title shorter than ${TITLE_MIN_FONT_SIZE}px`);
      assert.ok(boxes.some((b) => b.label === definition.skin.rules), `${definition.id}: rules line missing`);
      assert.ok(boxes.some((b) => b.label === "bar"));
      // Framing standard: title, rules line, bar and caption are centred on x = 540, text stays in the central 840 px.
      const centred = boxes.filter((b) => b.label === definition.skin.title || b.label === definition.skin.rules || b.label === "bar" || /WINS$/.test(b.label));
      for (const box of centred) assert.ok(Math.abs(centreX(box) - 540) <= 2, `${definition.id} f${frame}: "${box.label}" centred at ${centreX(box).toFixed(1)}`);
      for (const box of boxes) if (box.label !== "bar") assert.ok(box.left >= 120 - 0.5 && box.right <= 960 + 0.5, `${definition.id} f${frame}: "${box.label}" leaves the central 840 px`);
      const bar = boxes.find((b) => b.label === "bar");
      assert.ok(bar && Math.abs(bar.left - (1080 - bar.right)) < 0.5, "equal bar margins");
    }
  }
});

test("the caption reads '<TYPE> WINS' from the winning frame to the end of the 3 s hold, never before", () => {
  const ctx = makeMockCanvasContext();
  for (const definition of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(definition.slug);
    const expected = `${definition.skin.types[trace.winner].caption} WINS`;
    const caption = (frame: number) => paintSwarmFrame(ctx, definition, trace, frame).filter((b) => /WINS$/.test(b.label) && b.label !== definition.skin.title);
    assert.equal(caption(trace.winFrame - 1).length, 0, `${definition.id}: caption shown before the win`);
    for (const frame of [trace.winFrame, trace.winFrame + 20, trace.totalFrames - 1]) {
      const found = caption(frame);
      assert.equal(found.length, 1);
      assert.equal(found[0].label, expected);
    }
    assert.equal(trace.totalFrames - trace.winFrame, trace.config.holdFrames);
  }
});

test("the painted counters always add up to the sprite total and match the trace", () => {
  const ctx = makeMockCanvasContext();
  for (const definition of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(definition.slug);
    for (let frame = 0; frame < trace.totalFrames; frame += 97) {
      const boxes = paintSwarmFrame(ctx, definition, trace, frame);
      const numbers = boxes.filter((b) => /^\d+$/.test(b.label)).map((b) => Number(b.label));
      assert.equal(numbers.length, trace.types);
      // The counter row (icons and numbers) is centred on x = 540 whatever the digits are.
      const row = boxes.filter((b) => /icon$/.test(b.label) || /^\d+$/.test(b.label));
      const rowLeft = Math.min(...row.map((b) => b.left));
      const rowRight = Math.max(...row.map((b) => b.right));
      assert.ok(Math.abs((rowLeft + rowRight) / 2 - 540) <= 8, `${definition.id} f${frame}: counter row centred at ${((rowLeft + rowRight) / 2).toFixed(1)}`);
      assert.equal(numbers.reduce((a, b) => a + b, 0), trace.count, `${definition.id} f${frame}`);
      assert.deepEqual(numbers, Array.from(trace.counts.subarray(frame * trace.types, (frame + 1) * trace.types)));
    }
  }
});

test("barSegments are exactly proportional to the counts, contiguous, and zero for empty types", () => {
  const counts = [70, 53, 27, 0, 60];
  const segments = barSegments(counts, SWARM_LAYOUT.barLeft, SWARM_LAYOUT.barWidth);
  const total = counts.reduce((a, b) => a + b, 0);
  assert.equal(segments.length, counts.length);
  assert.equal(segments[0].x, SWARM_LAYOUT.barLeft);
  let width = 0;
  segments.forEach((segment, k) => {
    assert.ok(Math.abs(segment.width - (SWARM_LAYOUT.barWidth * counts[k]) / total) < 1e-9, `segment ${k}`);
    if (k > 0) assert.ok(Math.abs(segment.x - (segments[k - 1].x + segments[k - 1].width)) < 1e-9, "contiguous");
    width += segment.width;
  });
  assert.equal(segments[3].width, 0);
  assert.ok(Math.abs(width - SWARM_LAYOUT.barWidth) < 1e-9);
  assert.ok(Math.abs(segments[4].x + segments[4].width - (SWARM_LAYOUT.barLeft + SWARM_LAYOUT.barWidth)) < 1e-9);
  assert.deepEqual(barSegments([0, 0, 0], 60, 840).map((s) => s.width), [0, 0, 0]);
  assert.deepEqual(barSegments([5, 0, 0], 60, 840).map((s) => s.width), [840, 0, 0]);
});

test("painting is a pure function of the frame", () => {
  const definition = SWARM_DEFINITIONS[0];
  const trace = simulateSwarmDefinition(definition.slug);
  const a = paintSwarmFrame(makeMockCanvasContext(), definition, trace, 123);
  const b = paintSwarmFrame(makeMockCanvasContext(), definition, trace, 123);
  assert.deepEqual(a, b);
});

test("restyle uses Oyren lime accents, team-coloured tabular counters, and no legacy cyan glow", () => {
  for (const definition of SWARM_DEFINITIONS) {
    const trace = simulateSwarmDefinition(definition.slug);
    const seenFills = new Set<string>();
    const seenStrokes = new Set<string>();
    const baseCtx = makeMockCanvasContext();
    const ctx = new Proxy(baseCtx as unknown as Record<string, unknown>, {
      get(obj, prop) {
        return obj[prop as string];
      },
      set(obj, prop, val) {
        if (prop === "fillStyle" && typeof val === "string") seenFills.add(val.toLowerCase());
        if (prop === "strokeStyle" && typeof val === "string") seenStrokes.add(val.toLowerCase());
        obj[prop as string] = val;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;

    paintSwarmFrame(ctx, definition, trace, trace.winFrame + 10);
    assert.ok(seenFills.has("#c8ff00"), `${definition.id}: expected Oyren lime fill (#c8ff00)`);
    assert.ok(seenStrokes.has("#c8ff00"), `${definition.id}: expected Oyren lime border (#c8ff00)`);
    assert.ok(!seenFills.has("#26e0ff") && !seenStrokes.has("#26e0ff"), "legacy cyan glow must be gone");
    for (const skin of definition.skin.types) {
      assert.ok(seenFills.has(skin.color.toLowerCase()), `${definition.id}: expected team colour ${skin.color}`);
    }
  }
});
