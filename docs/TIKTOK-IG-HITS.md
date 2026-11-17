# Four proven-format hit videos (1080x1920, 60 fps, full screen)

`src/hits/` holds four new compositions. Each one copies the structure of a short-video format that already reaches millions of views for other accounts, and uses our own look, sounds and a rule that is spelled out on screen. Nothing in them is copied from another account: no names, no question lines, no colours, no tunes that are under copyright.

## What every video does

| Rule | How it is enforced |
| --- | --- |
| Frame 0 asks a yes/no or A/B question in plain words | text drawn at frame 0 inside `REEL_SAFE_BOUNDS` (x 60..900, y 220..1560), checked in the tests |
| The rule is on screen from frame 0 | a one-line rule under the question; nothing happens that the line does not explain |
| It starts empty or with one piece | no flash-forward of the ending, no dead time at the start |
| A counter climbs | balls, bricks, tier or board share, always visible |
| The payoff lands by about 22-24 s, then 3 s of the Oyren end card | total length 25-27 s, so the whole video fits the 18-28 s sweet spot |
| The world fills the whole 1080x1920 canvas | walls are the canvas edges; the background is painted edge to edge (target at least 95 percent active pixels, measured on the render) |
| Every hit has a sound | 48 kHz stereo, pan follows screen x, warm timbre, event rate capped, master -14 LUFS and at most -1.5 dBTP |
| Seeded and shown | seed 20261117 appears in the small footer line; tuning is done on the constants, never by picking a seed |
| Small CTA line | "Made by AI agents, with nothing installed on a computer." and "Create a Codespace at oyren.ai", inside the safe zone |

## The four compositions

| Composition | Slug | Question (frame 0) | Rule line | Climbing counter | Payoff | Sound |
| --- | --- | --- | --- | --- | --- | --- |
| `OverflowArena` | `overflow-arena` | Will it overflow? | Every hit splits the ball. | BALLS 1 -> 10,000 | the walls crack and the balls spill out | each split plays a bell on a rising pentatonic scale, rate-capped; a low boom at the burst |
| `BrickEscape` | `brick-escape` | Will it get out in time? | Every bounce lays a brick. Every brick shrinks the exit. | BRICKS and EXIT width | IT GOT OUT or WALLED IN | each bounce plays the next note of a public-domain tune (name the song) |
| `FunnelMerge` | `funnel-merge` | Will it merge into its final form? | Two of the same tier merge into the next. Only tier 1 drops. | TIER n of 8, CHAIN x | the final form appears and holds | the note of the merged tier; chains stack as a chord |
| `ColourWarV4` | `colour-war-v4` | Which colour takes the board? | Balls paint. Every 5 s the smallest colour doubles its balls. | four share bars | the colour with the biggest share at 24 s | a soft tick per captured cell, panned by x; a rising whoosh when the underdog rule fires |

## Files

- `src/hits/types.ts`, `src/hits/kit.ts`, `src/hits/voices.ts`: the shared contract, seeded random numbers, text and CTA helpers, and the warm voice kit.
- `src/hits/<slug>/`: `sim.ts` (deterministic simulation), `paint.ts` (Canvas 2D), `audio.ts` (offline stereo synthesis), and the tests.
- `src/components/HitShell.tsx`: one canvas, one WAV, the closing card.
- `scripts/generate-assets.ts` writes `public/generated/<slug>.wav`; `pnpm render <CompositionId> out/<slug>.mp4 --gl=angle` renders it.

## Render and checks (Poblano GPU)

`pnpm install`, `pnpm assets`, then render the four ids at 1080x1920, 60 fps, H.264 yuv420p, BT.709, CRF 17, stereo AAC. `video-check` runs `ffprobe`, `ebur128` (about -14 LUFS, at most -1.5 dBTP), the full-frame fill measurement and an 8-frame contact sheet for each file. Output goes to the private release `videos-1117-tiktok-ig-hits` on `oyren-ai/oyren-fleet`. Nothing is posted from this branch.
