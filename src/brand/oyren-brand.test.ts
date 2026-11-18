import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OYREN_BRAND, OyrenBrandLayerView, OyrenWordmark, WORDMARK_PATHS } from "./OyrenBrand.tsx";

const base = { fps: 60, durationInFrames: 60 * 40 };
const html = (extra: object) => renderToStaticMarkup(createElement(OyrenBrandLayerView, { ...base, ...extra } as never));
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

test("the wordmark is the official logo: a lime O and four white letters", () => {
  assert.equal(WORDMARK_PATHS.length, 5);
  assert.equal(WORDMARK_PATHS[0]?.fill, "#c8ff00");
  assert.ok(WORDMARK_PATHS.slice(1).every((p) => p.fill === "#ffffff"));
  const svg = renderToStaticMarkup(createElement(OyrenWordmark, { height: 50 }));
  assert.ok(svg.includes('viewBox="0 0 595.49 66.93"'));
  assert.equal(count(svg, "<path"), 5);
});

test("the first frame shows the top wordmark and the plain url, not the closing pill", () => {
  const out = html({ frame: 0 });
  assert.equal(count(out, "<svg"), 1);
  assert.ok(out.includes(OYREN_BRAND.url));
  assert.ok(!out.includes(OYREN_BRAND.ctaLead));
});

test("the last frame shows the closing pill with a second wordmark", () => {
  const out = html({ frame: base.durationInFrames - 1 });
  assert.equal(count(out, "<svg"), 2);
  assert.ok(out.includes(OYREN_BRAND.ctaLead));
});

test("footer false keeps only the top wordmark on every frame", () => {
  for (const frame of [0, 600, base.durationInFrames - 1]) {
    const out = html({ frame, footer: false });
    assert.equal(count(out, "<svg"), 1);
    assert.ok(!out.includes(OYREN_BRAND.url));
    assert.ok(!out.includes(OYREN_BRAND.ctaLead));
  }
});

test("the layer is deterministic and centred (symmetric rows, no horizontal offsets)", () => {
  assert.equal(html({ frame: 777 }), html({ frame: 777 }));
  const out = html({ frame: 0 });
  assert.ok(out.includes("left:0;right:0"));
  assert.ok(out.includes("justify-content:center"));
});
