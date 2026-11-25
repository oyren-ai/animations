import { PATATE_FRAME_STRETCH } from "./feel.ts";

export type PatateCompositionSlug =
  | "patate-merge-coding-agents"
  | "patate-merge-world-to-code"
  | "patate-merge-languages";

export type PatateVoiceStem =
  | "copilotienne"
  | "cursorienne"
  | "opencodienne"
  | "geminienne"
  | "codexienne"
  | "claude-codienne"
  | "oyrenienne"
  | "turque"
  | "mexicaine"
  | "italienne"
  | "francaise"
  | "bashienne"
  | "javascriptienne"
  | "pythonienne"
  | "typescriptienne"
  | "go-langienne"
  | "rustienne"
  | "lean-quatrienne";

export type PatateCostumeId =
  | "terminal"
  | "copilot"
  | "cursor"
  | "opencode"
  | "gemini"
  | "codex"
  | "claude-code"
  | "oyren"
  | "mini-fez"
  | "turque"
  | "mexicaine"
  | "italienne"
  | "francaise"
  | "codex-twist"
  | "claude-twist"
  | "binary"
  | "bash"
  | "javascript"
  | "python"
  | "typescript"
  | "golang"
  | "rust"
  | "lean4";

export interface PatateTierSpec {
  readonly tier: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  readonly radius: number;
  readonly label: string;
  readonly banner: string;
  readonly stem: PatateVoiceStem | null;
  readonly playbackRate: number;
  readonly mergePoints: number;
  readonly costume: PatateCostumeId;
  readonly accent: string;
  readonly skinTint: string;
}

export interface PatateCompositionSpec {
  readonly id:
    | "PatateMergeCodingAgents"
    | "PatateMergeWorldToCode"
    | "PatateMergeLanguages";
  readonly slug: PatateCompositionSlug;
  readonly badge: string;
  readonly hook: string;
  readonly seed: number;
  readonly closingRootHz: number;
  readonly tiers: readonly [
    PatateTierSpec,
    PatateTierSpec,
    PatateTierSpec,
    PatateTierSpec,
    PatateTierSpec,
    PatateTierSpec,
    PatateTierSpec,
    PatateTierSpec,
  ];
}

// The solver's scene is 1260 solver frames (21 s at 60 per second). PATATE_PACE stretches it onto more video frames,
// so this one place sets every length: scene 1680 frames (28 s) + 180 closing = 1860 frames = 31 s at 3 sub-steps per frame.
export const PATATE_SOLVER_SCENE_FRAMES = 1260;
export const PATATE_SCENE_FRAMES = Math.round(PATATE_SOLVER_SCENE_FRAMES * PATATE_FRAME_STRETCH);
export const PATATE_CLOSING_FRAMES = 180; // 3.0s @ 60fps
export const PATATE_TOTAL_FRAMES = PATATE_SCENE_FRAMES + PATATE_CLOSING_FRAMES;

export const PATATE_RADII = [32, 44, 58, 75, 95, 118, 145, 178] as const;
export const PATATE_PLAYBACK_RATES = [
  1.5, 1.38, 1.24, 1.1, 0.97, 0.85, 0.75, 0.64,
] as const;
export const PATATE_MERGE_POINTS = [
  0, 35, 90, 210, 480, 1150, 2800, 7200,
] as const;

export const PATATE_FLASK = {
  cx: 540,
  cy: 905,
  radius: 462,
  chuteHalfWidth: 62,
  chuteTopY: 84,
  wallThickness: 11,
} as const;

function makeTiers(
  defs: readonly [
    Omit<PatateTierSpec, "tier" | "radius" | "playbackRate" | "mergePoints">,
    Omit<PatateTierSpec, "tier" | "radius" | "playbackRate" | "mergePoints">,
    Omit<PatateTierSpec, "tier" | "radius" | "playbackRate" | "mergePoints">,
    Omit<PatateTierSpec, "tier" | "radius" | "playbackRate" | "mergePoints">,
    Omit<PatateTierSpec, "tier" | "radius" | "playbackRate" | "mergePoints">,
    Omit<PatateTierSpec, "tier" | "radius" | "playbackRate" | "mergePoints">,
    Omit<PatateTierSpec, "tier" | "radius" | "playbackRate" | "mergePoints">,
    Omit<PatateTierSpec, "tier" | "radius" | "playbackRate" | "mergePoints">,
  ],
): PatateCompositionSpec["tiers"] {
  return defs.map((d, idx) => ({
    ...d,
    tier: (idx + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
    radius: PATATE_RADII[idx],
    playbackRate: PATATE_PLAYBACK_RATES[idx],
    mergePoints: PATATE_MERGE_POINTS[idx],
  })) as unknown as PatateCompositionSpec["tiers"];
}

export const PATATE_COMPOSITIONS: readonly PatateCompositionSpec[] = [
  {
    id: "PatateMergeCodingAgents",
    slug: "patate-merge-coding-agents",
    badge: "PATATE MERGE #1",
    hook: "WHICH AI AGENT CODES BEST ?",
    seed: 1002,
    closingRootHz: 261.625565, // C4
    tiers: makeTiers([
      {
        label: "La patate terminale",
        banner: "LA PATATE TERMINALE",
        stem: null,
        costume: "terminal",
        accent: "#22c55e",
        skinTint: "#e3b36b",
      },
      {
        label: "La patate copilotienne !",
        banner: "LA PATATE COPILOTIENNE !",
        stem: "copilotienne",
        costume: "copilot",
        accent: "#38bdf8",
        skinTint: "#e6b86e",
      },
      {
        label: "La patate cursorienne !",
        banner: "LA PATATE CURSORIENNE !",
        stem: "cursorienne",
        costume: "cursor",
        accent: "#f8fafc",
        skinTint: "#dfa95d",
      },
      {
        label: "La patate opencodienne !",
        banner: "LA PATATE OPENCODIENNE !",
        stem: "opencodienne",
        costume: "opencode",
        accent: "#06b6d4",
        skinTint: "#e4b265",
      },
      {
        label: "La patate geminienne !",
        banner: "LA PATATE GEMINIENNE !",
        stem: "geminienne",
        costume: "gemini",
        accent: "#818cf8",
        skinTint: "#e8bb70",
      },
      {
        label: "La patate codexienne !",
        banner: "LA PATATE CODEXIENNE !",
        stem: "codexienne",
        costume: "codex",
        accent: "#10b981",
        skinTint: "#e2ae5e",
      },
      {
        label: "La patate claude-codienne !",
        banner: "LA PATATE CLAUDE-CODIENNE !",
        stem: "claude-codienne",
        costume: "claude-code",
        accent: "#f97316",
        skinTint: "#e9b969",
      },
      {
        label: "La patate oyrenienne !",
        banner: "LA PATATE OYRENIENNE !",
        stem: "oyrenienne",
        costume: "oyren",
        accent: "#c8ff00",
        skinTint: "#f3c969",
      },
    ]),
  },
  {
    id: "PatateMergeWorldToCode",
    slug: "patate-merge-world-to-code",
    badge: "PATATE MERGE #2",
    hook: "WAIT FOR THE MERGE...",
    seed: 1007,
    closingRootHz: 293.664768, // D4
    tiers: makeTiers([
      {
        label: "La mini patate",
        banner: "LA MINI PATATE",
        stem: null,
        costume: "mini-fez",
        accent: "#ef4444",
        skinTint: "#e5b66c",
      },
      {
        label: "La patate turque !",
        banner: "LA PATATE TURQUE !",
        stem: "turque",
        costume: "turque",
        accent: "#dc2626",
        skinTint: "#e3b064",
      },
      {
        label: "La patate mexicaine !",
        banner: "LA PATATE MEXICAINE !",
        stem: "mexicaine",
        costume: "mexicaine",
        accent: "#eab308",
        skinTint: "#e8bb6d",
      },
      {
        label: "La patate italienne !",
        banner: "LA PATATE ITALIENNE !",
        stem: "italienne",
        costume: "italienne",
        accent: "#16a34a",
        skinTint: "#e1ad5f",
      },
      {
        label: "La patate française !",
        banner: "LA PATATE FRANÇAISE !",
        stem: "francaise",
        costume: "francaise",
        accent: "#3b82f6",
        skinTint: "#e7b96b",
      },
      {
        label: "La patate codexienne !",
        banner: "LA PATATE CODEXIENNE !",
        stem: "codexienne",
        costume: "codex-twist",
        accent: "#10b981",
        skinTint: "#e2af60",
      },
      {
        label: "La patate claude-codienne !",
        banner: "LA PATATE CLAUDE-CODIENNE !",
        stem: "claude-codienne",
        costume: "claude-twist",
        accent: "#fb923c",
        skinTint: "#ebb968",
      },
      {
        label: "La patate oyrenienne !",
        banner: "LA PATATE OYRENIENNE !",
        stem: "oyrenienne",
        costume: "oyren",
        accent: "#c8ff00",
        skinTint: "#f3c969",
      },
    ]),
  },
  {
    id: "PatateMergeLanguages",
    slug: "patate-merge-languages",
    badge: "PATATE MERGE #3",
    hook: "WHICH LANGUAGE WINS ?",
    seed: 1183,
    closingRootHz: 329.627557, // E4
    tiers: makeTiers([
      {
        label: "La patate binaire",
        banner: "LA PATATE BINAIRE",
        stem: null,
        costume: "binary",
        accent: "#4ade80",
        skinTint: "#e2b268",
      },
      {
        label: "La patate bashienne !",
        banner: "LA PATATE BASHIENNE !",
        stem: "bashienne",
        costume: "bash",
        accent: "#94a3b8",
        skinTint: "#deb065",
      },
      {
        label: "La patate javascriptienne !",
        banner: "LA PATATE JAVASCRIPTIENNE !",
        stem: "javascriptienne",
        costume: "javascript",
        accent: "#facc15",
        skinTint: "#e9bc6c",
      },
      {
        label: "La patate pythonienne !",
        banner: "LA PATATE PYTHONIENNE !",
        stem: "pythonienne",
        costume: "python",
        accent: "#38bdf8",
        skinTint: "#e3b163",
      },
      {
        label: "La patate typescriptienne !",
        banner: "LA PATATE TYPESCRIPTIENNE !",
        stem: "typescriptienne",
        costume: "typescript",
        accent: "#2563eb",
        skinTint: "#e6b76b",
      },
      {
        label: "La patate go-langienne !",
        banner: "LA PATATE GO-LANGIENNE !",
        stem: "go-langienne",
        costume: "golang",
        accent: "#22d3ee",
        skinTint: "#e0ad5f",
      },
      {
        label: "La patate rustienne !",
        banner: "LA PATATE RUSTIENNE !",
        stem: "rustienne",
        costume: "rust",
        accent: "#f97316",
        skinTint: "#e8b666",
      },
      {
        label: "La patate lean-quatrienne !",
        banner: "LA PATATE LEAN-QUATRIENNE !",
        stem: "lean-quatrienne",
        costume: "lean4",
        accent: "#fde047",
        skinTint: "#f4cb6b",
      },
    ]),
  },
];

export function getPatateComposition(
  slug: PatateCompositionSlug,
): PatateCompositionSpec {
  const found = PATATE_COMPOSITIONS.find((c) => c.slug === slug);
  if (!found) {
    throw new Error(`Unknown Patate Merge composition slug: ${slug}`);
  }
  return found;
}
