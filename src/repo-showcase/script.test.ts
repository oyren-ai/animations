import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { STYLES } from "../ball-drop/sim.ts";
import { COUNTRY_MAPS } from "../country-maps/fourier.ts";
import { STRING_ROUNDS } from "../string-arena/sim.ts";
import { theme } from "../theme.ts";
import { SCENE_PLAN, SHOWCASE_COPY, SHOWCASE_LINES, SHOWCASE_VOICE } from "./script.ts";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, out);
  return out;
}

test("caption phrases rebuild each spoken line exactly", () => {
  assert.equal(SHOWCASE_LINES.length, 5);
  for (const line of SHOWCASE_LINES) {
    assert.equal(line.phrases.join(" "), line.text, `${line.id} phrases drift from the spoken text`);
  }
});

test("every caption phrase fits two caption lines", () => {
  for (const line of SHOWCASE_LINES) {
    for (const phrase of line.phrases) {
      assert.ok(phrase.length <= 42, `${line.id} phrase too long for two lines: ${phrase}`);
    }
  }
});

test("claim rule: nothing viewer-facing mentions what main does not hold (shaders, comebacks)", () => {
  const forbidden = /shader|webgl|glsl|comeback|audio-reactive|photo[- ]finish/i;
  const everything = [...SHOWCASE_LINES.map((line) => line.text), ...collectStrings(SHOWCASE_COPY)];
  assert.ok(everything.length > 15);
  for (const text of everything) {
    assert.doesNotMatch(text, forbidden, `claim not backed by main: ${text}`);
  }
});

test("every scene in the plan is a composition that exists on main", () => {
  const stringRounds = new Set<string>(STRING_ROUNDS.map((round) => round.slug));
  const dropStyles = new Set<string>(STYLES.map((style) => style.slug));
  const countryMaps = new Set<string>(COUNTRY_MAPS.map((map) => map.slug));
  for (const entry of SCENE_PLAN) {
    if (entry.scene === "string-arena") assert.ok(stringRounds.has(entry.variant ?? ""), `${entry.variant}`);
    if (entry.scene === "ball-drop") assert.ok(dropStyles.has(entry.variant ?? ""), `${entry.variant}`);
    if (entry.scene === "country-map") assert.ok(countryMaps.has(entry.variant ?? ""), `${entry.variant}`);
    if (entry.scene === "pendulum") assert.equal(entry.variant, null);
    assert.ok(entry.sceneStartFrame >= 0 && entry.speed > 0);
  }
  const first = SCENE_PLAN.find((entry) => entry.line === "l1");
  assert.equal(first?.atWord, null, "the hook scene must start with the beat, not on a word");
});

test("scene cuts name words that the spoken line really contains", () => {
  for (const entry of SCENE_PLAN) {
    if (entry.atWord === null) continue;
    const line = SHOWCASE_LINES.find((candidate) => candidate.id === entry.line);
    assert.ok(line, entry.line);
    assert.ok(new RegExp(`\\b${entry.atWord}\\b`).test(line.text), `${entry.atWord} not in ${entry.line}`);
  }
});

test("remix window shows real repo values and commands", () => {
  const { remix } = SHOWCASE_COPY;
  assert.equal(remix.valueBefore, `"${theme.colors.primary}"`);
  assert.ok(remix.code[remix.editLineIndex].includes(remix.valueBefore));
  for (const [index, line] of remix.code.entries()) {
    if (index === remix.editLineIndex) continue;
    const value = /"(#[0-9a-f]{6})"/i.exec(line)?.[1];
    if (value) assert.ok((Object.values(theme.colors) as string[]).includes(value), `${value} is not a theme colour`);
  }
  assert.equal(remix.file, "src/theme.ts");
  assert.ok(read("../theme.ts").includes("export const theme"));
  assert.match(read("../../package.json"), /"render": "pnpm assets && node scripts\/render\.mjs"/);
  assert.ok(remix.command.startsWith("pnpm render PendulumWave"));
  assert.ok(read("../Root.tsx").includes('id="PendulumWave"'));
});

test("the voiceover is an English Speechify voice, not the French Patate voice", () => {
  assert.equal(SHOWCASE_VOICE.provider, "speechify");
  assert.notEqual(SHOWCASE_VOICE.voiceId, "");
  for (const line of SHOWCASE_LINES) {
    assert.doesNotMatch(line.text, /[àâçéèêëîïôûùüÿœ]/i, `${line.id} contains French letters`);
  }
  assert.match(SHOWCASE_COPY.end.disclosure, /AI-generated/);
});
