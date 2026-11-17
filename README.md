<p align="center">
  <a href="https://oyren.ai/workspaces?product=development">
    <img src="docs/oyren-button.svg" alt="Open this in Oyren" width="280" />
  </a>
</p>

# animations

Twenty-two animations built from TypeScript, a canvas, and a clock: five foundational physics scenes, five complex-Fourier country-border reconstructions, four zero-gravity wall-bounce string-arena compositions, five bouncy arcade ball-drop and funnel-merge compositions, and three Suika-style Patate Merge boiling-flask compositions with pitch-coupled French voice announcements. Change the equations or physics, scrub to any frame, and render the result as a 60 fps video.

Every composition renders at 1080 × 1920 and 60 fps, closing with a code end card pointing to `github.com/oyren-ai/animations`. Shapes, sovereign map contours, cartoon potato costumes, and geometric vector emblems are drawn procedurally. Sound is synthesized and mixed locally from simulation events and self-generated voice stems. No stock footage, third-party logo files, or music downloads are needed.

## A few frames

| Bumper matrix | Pendulum cascade |
| --- | --- |
| <img src="docs/previews/PinballBumperMatrix.png" width="270" alt="Discs bouncing through a field of circular bumpers"> | <img src="docs/previews/PendulumCascade.png" width="270" alt="Falling discs meeting a cascade of swinging paddles"> |

| Vortex bowl | Funnel merge |
| --- | --- |
| <img src="docs/previews/VortexSpiralBowl.png" width="270" alt="A spiral flow field above a curved glass bowl"> | <img src="docs/previews/SplitLaneFunnelMerge.png" width="270" alt="Two inlets feeding geometric discs into a merging bowl"> |

| Pendulum wave | Azerbaijan (Fourier map) |
| --- | --- |
| <img src="docs/previews/PendulumWave.png" width="270" alt="Twelve pendulums forming a changing wave"> | <img src="docs/previews/MapOfAzerbaijan.png" width="270" alt="Sovereign borders of Azerbaijan reconstructed with complex Fourier harmonics"> |

| Turkey (Fourier map) | India (Fourier map) |
| --- | --- |
| <img src="docs/previews/MapOfTurkey.png" width="270" alt="Anatolia and Eastern Thrace reconstructed with complex Fourier harmonics"> | <img src="docs/previews/MapOfIndia.png" width="270" alt="India border reconstructed with complex Fourier harmonics"> |

| Italy (Fourier map) | Japan (Fourier map) |
| --- | --- |
| <img src="docs/previews/MapOfItaly.png" width="270" alt="Peninsular Italy, Sardinia, and Sicily reconstructed with complex Fourier harmonics"> | <img src="docs/previews/MapOfJapan.png" width="270" alt="Honshu, Kyushu, Hokkaido, and Shikoku reconstructed with complex Fourier harmonics"> |

| Zero-G string arenas (combined) | Bouncy 8-tier funnel merge |
| --- | --- |
| <img src="docs/previews/StringArenasCombined.png" width="270" alt="Five zero-gravity contenders gaining anchored strings on rim bounces and cutting rival lines"> | <img src="docs/previews/DropLogoFunnelMerge.png" width="270" alt="Jewel-toned orbs squishing, bouncing, and merging up an eight-tier parabolic funnel"> |

| Four-stage arcade ball drop | Patate Merge: Coding Agents |
| --- | --- |
| <img src="docs/previews/BallDropCombined.png" width="270" alt="Combined four-stage arcade ball drop showcase inside reel-safe bounds"> | <img src="docs/previews/PatateMergeCodingAgents.png" width="270" alt="Costumed coding-agent potatoes merging inside a rainbow-rimmed boiling flask"> |

| Patate Merge: World to Code | Patate Merge: Languages |
| --- | --- |
| <img src="docs/previews/PatateMergeWorldToCode.png" width="270" alt="World-cuisine potatoes merging into AI coding agents inside a rainbow-rimmed flask"> | <img src="docs/previews/PatateMergeLanguages.png" width="270" alt="Programming-language potatoes merging up to Lean 4 inside a rainbow-rimmed flask"> |

| Shared closing beat |  |
| --- | --- |
| <img src="docs/previews/code-end-card.png" width="270" alt="Get the code for this animation at github.com/oyren-ai/animations"> |  |

## The compositions

| Composition ID | What happens | Good first remix |
| --- | --- | --- |
| `PinballBumperMatrix` | Falling discs bounce through a matrix of circular bumpers. | Move the bumpers, change gravity, or adjust restitution. |
| `PendulumCascade` | Four driven pendulums exchange momentum with falling discs. | Change their periods, amplitude, or pivot positions. |
| `VortexSpiralBowl` | An art-directed vortex field pushes discs around a curved glass bowl. | Tune the swirl, drag, and bowl curvature. |
| `SplitLaneFunnelMerge` | Two inlets feed a bowl. Equal tiers merge, carrying their mass, area, and momentum forward. | Change the inlet spacing or maximum tier. |
| `PendulumWave` | Twelve closed-form oscillators drift out of alignment, then return after one loop. | Change the cycle counts or string lengths. |
| `MapOfAzerbaijan` | Sovereign mainland Azerbaijan and Nakhchivan sharpen across eight complex Fourier orders (`N = 1` to `240`). | Add another country polygon or change the harmonic schedule. |
| `MapOfTurkey` | Anatolia and Eastern Thrace emerge across eight harmonic orders with live epicycles and spectrum bars. | Adjust epicycle chain count or morph duration. |
| `MapOfIndia` | Complete India border converges from an `N = 1` ellipse to `N = 240` harmonic pairs. | Inspect individual frequency modes or grid spacing. |
| `MapOfItaly` | Peninsular Italy, Sardinia, and Sicily reconstruct simultaneously as separate closed Fourier loops. | Compare island convergence rates across low orders. |
| `MapOfJapan` | Honshu, Kyushu, Hokkaido, and Shikoku sharpen from four ellipses into archipelago coastlines. | Tune the harmonic bell chord voicings in `src/audio.ts`. |
| `StringArenasCombined` | Three back-to-back zero-gravity string-arena rounds (`Coding CLIs`, `Languages`, `Frameworks`) where rim bounces add `+1` anchored line and rival crossings cut lines. | Change `initialStrings`, arena radius, or round seeds in `src/string-arena/sim.ts`. |
| `StringArenaCodingClis` | Standalone Round 1 zero-gravity string arena (`Seed #1120`). | Adjust bounce speed floors or contender palette. |
| `StringArenaLanguages` | Standalone Round 2 zero-gravity string arena (`Seed #2213`). | Experiment with 6 contenders or wider starting fans. |
| `StringArenaFrameworks` | Standalone Round 3 zero-gravity string arena (`Seed #3274`). | Customize elimination burst particle density. |
| `DropPlinkoGates` | Peg-matrix cascade through `+2` and `x2` laser gates shattering five stacked energy shields. | Add new gate operators or shield thresholds. |
| `DropBreakableRings` | Six rotating segmented neon rings crack on impact until an orb enters the core and escapes to the goal. | Change ring rotation speeds or segment hit points. |
| `DropLogoFunnelMerge` | Bouncy, squishy jewel-toned orbs merge up an eight-tier progression ladder with a live 3.5 s Tier-8 celebration. | Tune spring-damped squash stiffness, restitution, or tier radii. |
| `DropPinballBumpers` | Five `+15` bumpers and twin `x2` rotors charge falling orbs to fill a wave-rippled neon score tank. | Reposition rotors or raise the tank target. |
| `BallDropCombined` | Four-stage combined arcade showcase chaining Plinko gates, breakable rings, bouncy 8-tier funnel merge, and pinball bumpers. | Reorder stages or tune compact stage seeds. |
| `PatateMergeCodingAgents` | Costumed coding-agent potatoes drop down a glass neck and merge up an 8-tier rainbow flask (*copilotienne* → *codexienne* → *claude-codienne* → *oyrenienne*) with pitch-scaled French voice callouts. | Swap tier playback rates, radii, or costumes in `src/patate/themes.ts`. |
| `PatateMergeWorldToCode` | Classic world-patate progression (*turque*, *mexicaine*, *italienne*, *française*) plot-twisting at Tier 6 into *codexienne*, *claude-codienne*, and *oyrenienne*. | Change drop cadence or chain-reaction radial impulse in `src/patate/sim.ts`. |
| `PatateMergeLanguages` | Eight-tier programming-language patate evolution (*bashienne* → *javascriptienne* → *pythonienne* → *typescriptienne* → *go-langienne* → *rustienne* → *lean-quatrienne*). | Add a new language costume in `src/patate/paint.ts` or adjust interrupt timing in `src/patate/audio.ts`. |

## Run locally

Use Node.js 24 and pnpm 10.33.0. A Chromium browser is needed for rendering; Remotion can provision its browser when first used.

~~~sh
git clone https://github.com/oyren-ai/animations.git
cd animations
pnpm install --frozen-lockfile --ignore-scripts
pnpm studio
~~~

Studio opens the composition picker. Scrub through a scene, inspect a contact, or jump to the closing beat. Fonts are bundled through an installed font package; generated sound and manifests are rebuilt by the preview and render commands.

Render the default composition:

~~~sh
pnpm render
~~~

Choose a composition and output filename:

~~~sh
pnpm render SplitLaneFunnelMerge out/funnel.mp4
pnpm render PendulumWave out/wave.mp4
pnpm render MapOfAzerbaijan out/map-of-azerbaijan.mp4
~~~

The render command uses H.264, limited-range BT.709, yuv420p, and one render worker. PNG source frames preserve the intended palette through color conversion. Extra Remotion CLI flags follow the filename:

~~~sh
pnpm render VortexSpiralBowl out/vortex-preview.mp4 --scale=0.5
pnpm still PinballBumperMatrix out/pinball.png --frame=240
~~~

An existing compatible browser can be selected with `REMOTION_BROWSER_EXECUTABLE`. Output goes in `out/`; generated WAV files and the deterministic asset manifest go in `public/generated/`. Both directories are ignored by Git.

## Run & remix in an Oyren Codespace

<p align="center">
  <a href="https://oyren.ai/workspaces?product=development">
    <img src="docs/oyren-button-mark.svg" alt="Open this in Oyren" width="192" />
  </a>
</p>

[Open an Oyren Codespace](https://oyren.ai/codespaces) to work on the animations in a cloud Linux environment with a terminal and browser preview.

1. Create a Codespace, open its terminal, and clone this repository using the commands above.
2. Install the dependencies and run `pnpm studio`.
3. Expose Studio on port 3000 through the Codespace preview:

   ~~~sh
   oyren route add / 3000 "Animation Studio"
   ~~~

4. Open the preview from the Codespace. Use a configured terminal coding agent, such as Claude Code, Codex, Gemini CLI, or opencode, to edit the physics and render a new MP4.

Try a bounded prompt:

> In PinballBumperMatrix, make the bumper grid wider and lower gravity by 15%. Keep the seeded simulation, conservation tests, safe text bounds, and code end card. Run the tests, then render a 60 fps preview.

Commit and push remixes to keep them across machine changes. Leave the source link in the closing beat so the next person can find the code.

## How the simulation works

The ball scenes use a local seeded pseudorandom generator and eight fixed integration substeps per video frame. Each contact resolves penetration and the inward normal velocity. Moving paddle contacts use the paddle's velocity at the contact point.

The bowl uses the inward normal offset of a parabola. Simply subtracting a disc's radius from the floor height would allow the disc's sides to cross a sloped wall. The solver finds the actual tangent contact; tests sample the full circumference.

Matching funnel discs combine by mass-weighted position and velocity. The new radius is the square root of the sum of squared radii, preserving disc area. Other contacts use a restitution impulse. The vortex and pendulum drives are deliberate visual forces; their parameters are exposed in source.

The pendulum wave uses an analytic trajectory. Each successive oscillator completes one extra cycle in the same twelve-second interval, so all return to their opening positions together.

The country-map scenes project Natural Earth `10m` closed sovereign rings with spherical Mercator coordinates so east-west distances match cosine-latitude aspect ratios. Each closed loop is decomposed by exact complex discrete Fourier transform across modes `k = -240 .. 240`, then reconstructed through eight progressive harmonic orders (`N = 1, 2, 4, 8, 18, 42, 96, 240`) with smooth order morphing, rotating epicycle vectors, and live normalized `L2` contour precision.

The zero-gravity string arenas integrate 16 substeps per video frame (`960 Hz`) and solve exact swept polynomial contacts between moving contender discs and anchored chords. Each contender opens with 12 rim-anchored lines, gains `+1` line anchored at the exact rim impact point on wall bounces (never on ball-ball collisions), cuts rival lines on contact, and bursts across a centre-filled Fermat disc when its line count reaches zero.

The four-stage arcade ball-drop scenes pair 480 Hz fixed-step collision resolution with an underdamped squash-and-stretch spring (`scaleNormal = 1 - s`, `scaleTangent = 1 / (1 - s)`) aligned to each impact normal while keeping emblems upright, plus live post-climax physics across the celebration window.

The Patate Merge scenes integrate 240 Hz rigid-body circle dynamics with rotational friction inside a narrow top neck chute joined to a circular boiling flask (`R = 462 px`). Identical tiers (`1` through `7`) merge into the next tier (`32 px` up to `178 px`), triggering concentric shockwaves, radial impulses, 8-slot portrait unlocks, and Catmull-Rom coupled pitch-and-speed resampled French announcements (`1.38×` down to `0.64×`) with chain-merge vocal interrupts.

## Where to change things

| File | Responsibility |
| --- | --- |
| `src/settings.ts` | Dimensions, frame rate, scene length, and end-card length |
| `src/theme.ts` | Palette, typography, easing, and spring settings |
| `src/ball-drop/sim.ts` | Seeds, spawn rules, bumpers, moving paddles, vortex forces, and merges |
| `src/ball-drop/bounds.ts` | Disc, segment, world, bowl, and measured text bounds |
| `src/ball-drop/paint.ts` | The canvas frame renderer and procedural geometric emblems |
| `src/pendulum-wave/wave.ts` | The closed-form oscillator |
| `src/data/countryContours.ts` | Arc-length resampled WGS84 sovereign border loops for the five countries |
| `src/country-maps/fourier.ts` | Spherical Mercator projection, complex DFT, harmonic tiers, and epicycle evaluation |
| `src/country-maps/paint.ts` | Canvas map renderer, coordinate grid, formula telemetry, and harmonic spectrum |
| `src/string-arena/sim.ts` | Zero-gravity 960 Hz swept-contact string solver, rim-gain rules, and three-round timeline |
| `src/string-arena/paint.ts` | Reel-safe (`x: 60..900`, `y: 220..1560`) string-arena HUD, chords, and full-disc bursts |
| `src/drop-arenas/sim.ts` | Plinko gates, breakable rings, bouncy 8-tier funnel merge, pinball bumpers, and squash springs |
| `src/drop-arenas/paint.ts` | High-contrast jewel-toned orb renderer, 8-tier progression strip, and arcade obstacles |
| `src/patate/themes.ts` | Patate Merge tier ladders, radii, coupled pitch rates, French stems, and costume IDs |
| `src/patate/sim.ts` | 240 Hz boiling-flask + chute rigid-body solver, rolling spin, and Suika chain merges |
| `src/patate/paint.ts` | Rotating rainbow flask wall, 23 cartoon potato costumes, shockwaves, and 8-slot HUD |
| `src/patate/audio.ts` | Coupled `asetrate` French voice resampler, chain-interrupt fades, and tactile SFX mixer |
| `src/shared/reelUtils.ts` | Reel safe-zone bounds assertions and procedural geometric emblem renderer |
| `src/audio.ts` | Event-to-tone mapping, harmonic map chords, arena soundtracks, and PCM synthesis |
| `src/encoding.ts` | Explicit PNG-to-BT.709 conversion for the pinned renderer |
| `src/components/GetTheCodeEndCard.tsx` | Shared closing copy and repository link |

## Verify a remix

~~~sh
pnpm typecheck
pnpm test
pnpm assets
~~~

Tests cover seeded replay, mass and disc-area conservation, moving contacts, curved boundaries, safe text bounds, exact oscillator derivatives, monotonic Fourier contour convergence and Mercator bounds, deterministic audio duration and peak levels, and the rendered end-card link. Run these checks locally on Node.js 24 before sharing a remix.

Render and inspect frames after changing the layout or motion. A passing typecheck does not inspect pixels.

## MIDI scenes

Three scenes are driven by MIDI note data (onset, duration, pitch, velocity, track). The same notes feed the picture and a locally synthesised WAV, so sound and animation share one timeline (frame-exact with `pnpm render:midi`, see below). Every frame is a pure function of the notes and the frame number, so frames can be rendered in any order and in parallel. A small TypeScript MIDI kit reads and writes Standard MIDI Files and synthesises piano, bell, marimba and kalimba voices; it adds no runtime dependency. The built-in pieces are two public-domain compositions transcribed by hand as note data (Beethoven's "Ode to Joy" theme and the Pachelbel Canon ground bass with its canon line) and one original generative phasing piece. No recordings, soundfonts or downloads are used. These scenes fade out after the last note and do not append the shared code end card.

| Ball Piano | Ripple Tank | Phase Orbit |
| --- | --- | --- |
| <img src="docs/previews/MidiBallPiano.jpg" width="270" alt="Glowing balls landing on a piano keyboard with ring and spark bursts"> | <img src="docs/previews/MidiRippleTank.jpg" width="270" alt="Neon ripples from a canon interfering on a dark water surface"> | <img src="docs/previews/MidiPhaseOrbit.jpg" width="270" alt="A radial piano roll with colour-coded voices and a sweeping playhead"> |

| Composition ID | What happens | Good first remix |
| --- | --- | --- |
| `MidiBallPiano` | "Ode to Joy" (`public/midi/ode-to-joy.mid`). Every note is a glowing ball that falls from the top and lands on its key exactly at note-on time. It squashes on impact, the key presses and lights up, a ring and sparks burst out, and the ball bounces and fades. Loud chords kick the camera. | Change `FALL_SEC` (fall time), the bounce and squash constants in `src/midi-ball-piano/events.ts`, or the hue wheel in `ballHue`. |
| `MidiRippleTank` | "Canon in D" (`public/midi/canon-in-d.mid`). Every note drops into a dark neon water tank and sends out an expanding ring. Pitch sets the horizontal position and colour (teal low, through violet and magenta, to amber high), velocity sets the wavelength and height of the ring, and each voice gets its own row, so chords make visible interference lattices. The surface is a stateless analytic sum of ring packets plus their wall reflections, shaded as glossy water at reduced resolution and upscaled. Note-ons add a squashed splash flash, droplet sparks and a fading buoy; loud chords and voice entrances kick the camera. | Change the wave speed, ring lifetime or wavelength mapping in `src/midi-ripple-tank/events.ts`, or the packet shape in `src/midi-ripple-tank/field.ts`. |
| `MidiPhaseOrbit` | "Pentatonic Phase" (`public/midi/pentatonic-phase.mid`). A radial piano roll for phasing music: pitch sets the ring (evenly spaced like record grooves), time sets the angle (one 6/4 bar is one turn), and notes are neon arcs coloured by voice. A comet-tailed playhead strikes each arc with a white-hot flash, a jelly pop and a burst of sparks. Three voices loop at slightly different lengths, so they visibly slide against each other on the same rings and snap back into unison at 45 s, where the final chord flares every arc. The disc breathes on each bar and rotates slowly, the camera kicks on loud chords, and a six-fold corona sparkles around the rim. | Change the loop lengths and patterns in `src/midi/pieces.ts`, or the ring layout and palette in `src/midi-phase-orbit/layout.ts`. |

### Use your own MIDI file

Any `.mid` file dropped into `public/midi` works with all three scenes through the `midiFile` prop:

~~~sh
cp my-song.mid public/midi/
pnpm assets
pnpm render MidiBallPiano out/my-song.mp4 --props='{"midiFile":"my-song.mid"}'
~~~

For frame-exact sound use `pnpm render:midi MidiBallPiano out/my-song.mp4 --props='{"midiFile":"my-song.mid"}'`. `pnpm render` also works, but Remotion copies its raw AAC audio into the MP4 without an edit list, so players hear it about 43 ms (two AAC frames) late. `render:midi` renders the picture muted and muxes the synthesised WAV with ffmpeg (an ffmpeg with the `aac` encoder must be on `PATH`, or set `FFMPEG`), which writes the priming offset into the file.

`pnpm assets` writes the built-in pieces to `public/midi/` and synthesises `public/generated/midi-<name>.wav` for every `.mid` in that folder. The composition length follows the file (lead-in, last note, and a short ring-out), and the on-screen title defaults to the sequence name in the file; pass `"title"` to override it. Format 0 and 1 files, running status, tempo changes and note-on velocity 0 are supported. The keyboard and the ring layout adapt to the pitch range of the file.

### The MIDI kit

| File | Responsibility |
| --- | --- |
| `src/midi/parse.ts` | Standard MIDI File reader: formats 0 and 1, running status, tempo map, time signature, SMPTE division, note-on velocity 0 as note-off, track names and programs |
| `src/midi/write.ts` | MIDI writer used to generate the built-in files from note arrays authored in beats |
| `src/midi/synth.ts` | Offline synthesiser: Karplus-Strong piano, FM bell, marimba and kalimba voices, velocity-dependent brightness, pitch-dependent pan, Schroeder reverb, look-ahead limiter, stereo PCM16 WAV |
| `src/midi/pieces.ts` | The three built-in pieces as note data |
| `src/midi/timeline.ts` | Scene timing (lead-in, ring-out), audio file naming, and the derived scene data |
| `src/midi/kit.ts` | Seeded random numbers, easing, colour, chord accents, camera kick, glow sprites, and the shared title and end fade |
| `src/components/MidiShell.tsx` | Loads the MIDI file, sets the composition length, paints each frame and plays the matching WAV |
| `scripts/generate-midi-assets.ts` | Writes the built-in `.mid` files and one WAV per `.mid` in `public/midi` |
| `scripts/render-midi.ts` | Muted Remotion render plus an ffmpeg audio mux for frame-exact sound (`pnpm render:midi`) |
| `src/midi-ball-piano/`, `src/midi-ripple-tank/`, `src/midi-phase-orbit/` | The three scenes: layout and event tables (pure, unit-tested) plus the canvas painter |

Good first remix for the kit: add a fourth piece to `src/midi/pieces.ts` (notes in beats, one track per voice, and a General MIDI program per track picks the voice: piano `0`, bell `9`, marimba `12`, kalimba `108`), run `pnpm assets`, and render any of the three scenes with that file name as `midiFile`.

## License

The source in this repository is [MIT licensed](LICENSE), copyright 2026 Oyren. Dependencies retain their own licenses, including [Remotion's licensing terms](https://www.remotion.dev/license).
