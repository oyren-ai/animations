# Repo showcase video (`AnimationsRepoShowcase`)

A ~22 s, 1080x1920, 60 fps short that introduces this repo with a natural English AI voiceover. It is a different voice from the French `Patate*` Shorts.

## Claim rule

The voice, captions and end card claim only what `main` holds when the video is posted. Today that is TypeScript scenes for physics, pendulum waves, string arenas, ball-drop merges and Fourier country maps. Shader scenes (#6) and comebacks (#8) are not on `main`, so nothing in the video says the repo has them, and every scene shown is one a viewer can find in the repo.

## Script (voice is spoken exactly as written; cuts come from the measured clips)

| Beat | Spoken line | On screen (scene exists on `main`) |
| :-- | :-- | :-- |
| 1 hook | Every animation on your screen right now is TypeScript. And the whole repo is open source. | string arena, headline from frame 0 |
| 2 physics | Deterministic physics at 60 frames per second. Pendulum waves, ball drops, and string battles. Zero After Effects. | pendulum wave, ball drop, string arena |
| 3 math | Fourier epicycles redraw entire country borders from spinning circles. | country map (epicycles) |
| 4 remix | Open it in an Oyren Codespace, change a line, and render in your browser. No local setup. | editor + terminal with real repo commands |
| 5 end | Star it, fork it, remix it. | `github.com/oyren-ai/animations` + `oyren.ai/codespaces`, "AI-generated voiceover" |

## Voice and timing

- Voice: Speechify `simba-3.5`, voice `carly` (crisp, upbeat). One clip per line, generated once by `scripts/generate-showcase-voice.ts` (key from `SPEECHIFY_API_KEY`, never committed) and committed under `public/audio/showcase/`.
- Each clip's duration is measured with `ffprobe`; Speechify word marks drive captions. `src/repo-showcase/voice.generated.ts` holds the measured data and the cuts are derived from it, so picture and voice cannot drift.
- Captions sit in one panel inside `REEL_SAFE_BOUNDS` (x 60..900, y 220..1560). Frame 0 already shows the hook headline.

## Audio

48 kHz stereo. Voice plus a procedural synth bed 12 LU under the voice, mastered to about -14 LUFS with true peak at or below -1.5 dBTP. No browser module touches Node `Buffer`.

## Checks

`tsc --noEmit`, the unit tests (timing map, safe zone, no browser `Buffer`, loudness), `pnpm assets`, then a GPU render on Poblano with `ffprobe`, `ebur128`, pixel-fill and a contact sheet.
