# Programmatic Video, GPU Shader, and Audio-Reactive Stack

This document records the open-source agent skill repositories, programmatic GPU/3D libraries, and deterministic audio synthesis tools evaluated for `oyren-ai/animations`, along with what this repository adopts now and what stays queued for follow-up experiments.

---

## 1. Non-Negotiable Canvas & Audio Contract

1. **100% Full-Screen `1080×1920` Edge-to-Edge Visuals (`>= 95%` active frame fill)**
   - Every visual world (WebGL2 GLSL shaders, rectangular physics chambers, and vertical data matrices) spans the entire `0..1080 × 0..1920` canvas from `t = 0.0 s` with zero centered-circle dead margins or letterbox bars.
   - **Text and HUD badges only** remain inside `REEL_SAFE_BOUNDS` (`left: 60, right: 900, top: 220, bottom: 1560`) enforced at draw time by `assertReelSafeBox`, keeping titles and live counters clear of Reels, Shorts, and TikTok chrome while the background and primary motion fill every pixel.
2. **Deterministic 48 kHz Stereo Audio + Frame-Exact Envelope Coupling**
   - All soundtracks render offline in Node.js as **48 kHz stereo 16-bit PCM WAV** (`encodeStereoPcm16Wav`) with constant-power stereo panning (`cos`/`sin` pan law across `x ∈ [0, 1080]`), soft-clipping true-peak ceiling (`<= -1.5 dBTP`), and integrated loudness calibrated around `-14 LUFS` with a continuous harmonic bed through the closing card.
   - Visuals never rely on nondeterministic browser `AudioContext` / `AnalyserNode` FFT state. Instead, `extractFrameAudioFeatures()` computes deterministic per-frame `{ subBass, bass, mid, high, rms, kickImpulse, spectrumBins[32] }` directly from the exact PCM buffer so any scrubbed or parallel-rendered frame `f` produces bit-identical GPU shader uniforms and Canvas2D geometry.
3. **Cloud-CPU Authoring vs. Paired-Device GPU Rendering**
   - Lightweight TypeScript typechecking (`tsc --noEmit`), deterministic physics/DSP unit tests (`node --test`), and WAV generation (`pnpm assets`) run in seconds on any CPU container.
   - Full `1080×1920 @ 60 fps` WebGL2/Canvas renders, `ebur128` loudness verification, active-pixel coverage audits, and 8-frame contact-sheet proofs run on paired GPU hardware (**Poblano** via `--gl=angle`, H.264 `yuv420p`, limited-range BT.709).

---

## 2. Open-Source Video Agent Skills Evaluated

| Repository | License / Footprint | Key Capabilities | Adoption in `oyren-ai/animations` |
| --- | --- | --- | --- |
| `remotion-dev/skills` (`remotion-dev/claude-code-plugin`) | Official Remotion skills (13 modular packs, ~7.3k stars) | Canonical Remotion rules for `delayRender`/`continueRender`, `<Sequence>`, `staticFile()`, deterministic `useCurrentFrame()`, and `mediabunny` / studio workflows. | **Adopted (installed locally).** Used for deterministic frame lifecycle, font readiness gates, and BT.709 FFmpeg override hooks. |
| `haidrrrry/claude-remotion-skill` | MIT (~1.1k stars) | Motion-craft rules (`remotion-motion-graphics`): clamped springs over linear fades, 5-layer depth composition, procedural 16-bit WAV SFX synthesis in Node, and mandatory extracted-frame visual QA. | **Adopted (installed locally).** Drives our spring entrances, vignette/grain layering, and pure-Node WAV synthesis. |
| `kajisho5/ffmpeg-skill` & `kajisho5/remotion-ffmpeg-skill` | MIT (~6.6k stars) | 42 machine-checked FFmpeg operations: `ebur128` integrated LUFS / true-peak verification (`-14 LUFS`, `<= -1.5 dBTP`), `color_range=tv` BT.709 export, and tiled contact-sheet QA (`fps=1,tile=...`). | **Adopted in render QA.** Every Poblano GPU render runs `ffprobe`, `ebur128=peak=true`, full-bleed pixel coverage checks, and contact-sheet extraction. |
| `heygen-com/hyperframes` | Apache-2.0 (~85k stars) | Agent-native HTML/WebGL/Three.js deterministic `window.seek(seconds)` frame stepper and CLI renderer without React bundler lock-in. | **Pattern adopted; CLI evaluated for Phase 2.** Our WebGL2 shader scenes expose pure `(frame, fps, features) -> uniforms` state so shaders remain portable across Remotion and standalone `window.seek` harnesses. |
| `iart-ai/motion-skills` | MIT (~1.7k stars) | 56 motion skills across 19 packs covering WebGL shaders, kinetic typography, algorithmic data-viz, Reels safe zones, and Manim math scenes. | **Reference patterns adopted** for full-bleed GLSL tunnel raymarching and multi-lane sorting visualizers. |
| `VideoZero/skills` (`@motion-canvas/core`) | Apache-2.0 / MIT | Imperative generator-based (`yield*`) procedural vector/math timelines in Motion Canvas. | **Deferred.** Strong for step-by-step code walkthroughs, but keeping a single Remotion `4.0.484` root avoids splitting the studio and render pipeline. |
| `Yusuke710/manim-skill` | MIT (~200 stars) | Python + Cairo/OpenGL mathematical theorem animations. | **Deferred.** Separate Python/LaTeX native toolchain; complex Fourier and sorting scenes are already cleaner and faster in TypeScript + WebGL2/Canvas2D. |

---

## 3. Audio DSP & GPU Rendering Libraries Evaluated

| Package / Stack | Version & Compatibility | Findings | Decision |
| --- | --- | --- | --- |
| **Native WebGL2 GLSL (`HTMLCanvasElement.getContext("webgl2")`) + 2D HUD Canvas** | Built into Chromium / ANGLE (`0` npm dependencies) | Compiles hardware fragment shaders (`#version 300 es`) directly on GPU with `preserveDrawingBuffer: true` + `gl.flush()`, avoiding `@react-three/fiber` (`>=8.0.0`) peer-dependency friction against `react@19.2.7` while keeping `pnpm install` tiny and deterministic. Includes a deterministic Canvas2D fallback when WebGL2 is absent. | **Adopted now** for `CyberSynthShaderTunnel` and future GPU fragment-shader worlds. |
| `@remotion/three` + `three` (`0.187.0`) | `@remotion/three@4.0.484` peers on `@react-three/fiber >= 8.0.0` | Great for imported `.glb` meshes, but `@react-three/fiber` adds React-reconciler version coupling against React 19 and ~35 MB of dependency weight unnecessary for procedural GLSL raymarching. | **Hold until `.glb` mesh scenes require it;** raw `WebGL2` (or direct `three` without R3F) is cleaner on React 19. |
| **In-Repo Stereo DSP + Envelope Extractor (`src/audio-reactive/synth.ts`)** | Pure TypeScript (`Float32Array`, `0` native addons) | Generates 48 kHz stereo PCM16 WAVs with pitch-swept kicks, resonant SVF basslines, stereo-panned FM/karplus-style plucks, lush detuned pads, soft-knee true-peak limiting, and exact 32-band Goertzel/DFT per-frame feature extraction (`extractFrameAudioFeatures`). | **Adopted now** across all three new full-screen scenes. |
| `@remotion/media-utils` (`visualizeAudio`) | `4.0.484` (MIT, pulls `mediabunny`) | Useful when analyzing external user-uploaded MP3/MP4 files inside the browser, but redundant when we synthesize the exact `Float32Array` buffer in TypeScript and can extract exact zero-latency per-frame envelopes directly. | **Optional for external audio files;** direct PCM feature extraction used for self-synthesized scenes. |
| `@elemaudio/core` + `@elemaudio/offline-renderer` (`4.0.x`) | MIT, pure JS/WASM functional DSP graph | Clean functional audio graph API; good candidate if future compositions need convolution reverb or complex modular filter routing beyond our built-in SVF/FM synth. | **Candidate for Phase 2.** |
| `tone` (`15.1.22`) / `strudel` | MIT (`standardized-audio-context`) | Tied to browser `OfflineAudioContext`, which cannot run in plain `node --test` / `pnpm assets` without a headless browser. | **Rejected for `pnpm assets`;** mini-notation pattern scheduling ideas are implemented purely in TypeScript instead. |

---

## 4. Compositions Added on This Stack

1. **`CyberSynthShaderTunnel`** — Hardware WebGL2 `#version 300 es` raymarched synthwave grid & geometric rib tunnel (`1080×1920` edge-to-edge) driven at 60 fps by a 124 BPM stereo synthwave track (`u_kick`, `u_bass`, `u_spectrum[32]`).
2. **`PolyphonicWallCascade`** — Full-bleed `1080×1920` rectangular neon acoustic chamber (`x: 0..1080`, `y: 0..1920`) with diagonal harmonic strings and high-speed orbs triggering stereo-panned polyphonic chords and edge-to-edge shockwave fields.
3. **`HarmonicSortingMatrix`** — Full-bleed `1080×1920` 3-band vertical color-field showdown racing **Radix Sort (LSD)**, **Quick Sort (Hoare/median-of-3)**, and **Heap Sort** across full-width horizontal neon bars with stereo-panned harmonic arpeggios mapped to active array accesses.
