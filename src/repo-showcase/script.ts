// Script, scene plan and on-screen copy for AnimationsRepoShowcase.
// Pure data: no Node imports, so the browser bundle and the tests share one source of truth.

export const SHOWCASE_VOICE = { provider: "speechify", model: "simba-3.5", voiceId: "carly" } as const;

export type ShowcaseLineId = "l1" | "l2" | "l3" | "l4" | "l5";
export type ShowcaseSceneId = "string-arena" | "pendulum" | "ball-drop" | "country-map";

export interface ShowcaseLine {
  readonly id: ShowcaseLineId;
  /** Spoken exactly like this; it is also the text sent to the voice service. */
  readonly text: string;
  /** Caption phrases. Joined with single spaces they must equal `text`. */
  readonly phrases: readonly string[];
}

export const SHOWCASE_LINES: readonly ShowcaseLine[] = [
  {
    id: "l1",
    text: "Every animation on your screen right now is TypeScript. And the whole repo is open source.",
    phrases: ["Every animation on your screen", "right now is TypeScript.", "And the whole repo", "is open source."],
  },
  {
    id: "l2",
    text: "Pendulum waves. Ball drops. String battles. All deterministic, all 60 frames per second, zero After Effects.",
    phrases: [
      "Pendulum waves.",
      "Ball drops.",
      "String battles.",
      "All deterministic,",
      "all 60 frames per second,",
      "zero After Effects.",
    ],
  },
  {
    id: "l3",
    text: "Fourier epicycles redraw entire country borders from spinning circles.",
    phrases: ["Fourier epicycles redraw", "entire country borders", "from spinning circles."],
  },
  {
    id: "l4",
    text: "Open it in an Oyren Codespace, change a line, and render in your browser. No local setup.",
    phrases: ["Open it in an Oyren Codespace,", "change a line,", "and render in your browser.", "No local setup."],
  },
  {
    id: "l5",
    text: "Star it, fork it, remix it.",
    phrases: ["Star it, fork it, remix it."],
  },
];

export interface ScenePlanEntry {
  readonly line: ShowcaseLineId;
  /** The cut lands just before this spoken word; null means the start of the line's beat. */
  readonly atWord: string | null;
  readonly scene: ShowcaseSceneId;
  /** String round slug, drop style slug or country map slug. Pendulum waves have none. */
  readonly variant: string | null;
  /** Frame of the source scene that plays at the cut. */
  readonly sceneStartFrame: number;
  /** Source frames advanced per video frame. */
  readonly speed: number;
}

// Every scene here is a composition that lives on main, so a viewer can find each one in the repo.
export const SCENE_PLAN: readonly ScenePlanEntry[] = [
  { line: "l1", atWord: null, scene: "string-arena", variant: "string-arena-coding-clis", sceneStartFrame: 120, speed: 1 },
  { line: "l2", atWord: null, scene: "pendulum", variant: null, sceneStartFrame: 200, speed: 1 },
  { line: "l2", atWord: "Ball", scene: "ball-drop", variant: "vortex-spiral-bowl", sceneStartFrame: 150, speed: 1 },
  { line: "l2", atWord: "String", scene: "string-arena", variant: "string-arena-languages", sceneStartFrame: 200, speed: 1 },
  { line: "l2", atWord: "all", scene: "ball-drop", variant: "pinball-bumper-matrix", sceneStartFrame: 210, speed: 1 },
  { line: "l3", atWord: null, scene: "country-map", variant: "map-of-india", sceneStartFrame: 60, speed: 2 },
];

export const SHOWCASE_COPY = {
  hook: {
    lines: ["EVERY ANIMATION", "ON SCREEN IS", "TYPESCRIPT"],
    sub: "open source · github.com/oyren-ai/animations",
  },
  remix: {
    title: "Oyren Codespace · animations",
    file: "src/theme.ts",
    code: ["export const theme = {", "  colors: {", '    background: "#080d12",', '    primary: "#c8ff85",', '    accent: "#74b9d1",', "  },"],
    editLineIndex: 3,
    valueBefore: '"#c8ff85"',
    valueAfter: '"#ff7ad9"',
    command: "pnpm render PendulumWave out/pendulum-wave.mp4",
    done: "✓ 1080x1920 · 60 fps · out/pendulum-wave.mp4",
  },
  end: {
    url: "github.com/oyren-ai/animations",
    remix: "Remix it in an Oyren Codespace",
    cta: "oyren.ai/codespaces",
    disclosure: "Voiceover: AI-generated",
  },
} as const;
