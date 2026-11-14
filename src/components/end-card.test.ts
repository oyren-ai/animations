import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { END_CARD_COPY, GetTheCodeEndCard } from "./GetTheCodeEndCard.tsx";

test("the rendered code end card contains the exact repository link and attribution", () => {
  const html = renderToStaticMarkup(createElement(GetTheCodeEndCard, { frame: 60 }));
  assert.ok(html.includes("Get the code for this animation"));
  assert.ok(html.includes('href="https://github.com/oyren-ai/animations"'));
  assert.ok(html.includes("github.com/oyren-ai/animations"));
  assert.ok(html.includes("Built with Oyren · oyren.ai"));
  assert.equal(END_CARD_COPY.repositoryUrl, "https://" + END_CARD_COPY.repository);
});
