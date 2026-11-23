# Asymmetric comeback simulations and photo-finish invariants

`src/comebacks/` implements four deterministic `1080x1920 @ 60 fps` dual-lane race compositions where a linear or steady contender builds an early blowout lead before a compounding contender overtakes in the final seconds of the race. Every composition passes `verifyComebackInvariants()` in `src/comebacks/invariants.ts`, fills the full `0..1080 x 0..1920` viewport with active visuals, and pairs lane events with a 48 kHz stereo suspense-and-drop soundtrack calibrated to `-14 LUFS`.

## Mathematical comeback contract

`verifyComebackInvariants(trace)` rejects any seed or parameter set that violates three timing and margin bounds over `raceFrames` (`1200-1620` frames at `60 fps`, followed by `180` frames for `GetTheCodeEndCard`):

1. **Early blowout (`earlyLeader !== winner`)**: At `checkFrame = Math.floor(0.65 * victoryFrame)`, the eventual runner-up leads the eventual winner by at least `0.50` (`50%` of total goal progress, such as `8/10` floors broken against `1/10`).
2. **Late overtake window (`[0.82 * raceFrames, 0.96 * raceFrames]`)**: Both `overtakeFrame` (the final lead change) and `victoryFrame` (when the winner reaches `1.00` progress) fall inside `82%-96%` of `raceFrames`, leaving at least `72` frames (`1.2 s`) of victory hold before the closing card.
3. **Photo-finish tension (`runnerUpProgressAtVictory >= 0.90`)**: At `victoryFrame`, the runner-up has completed at least `90%` of the goal (for 10-stage vaults and walls, `9/10` stages cleared and the 10th stage below `15%` remaining HP; for the 100-lap race, at least `94/100` laps completed).

## Full-bleed canvas and safe-zone separation

All four compositions separate visual world bounds from typography bounds:

- **Edge-to-edge arena (`x: 0..1080`, `y: 0..1920`)**: Twin race shafts, brick fortresses, shockwave rings, laser beams, and energy grids span all `1080 x 1920` pixels (`>= 95%` active pixels with `max(R, G, B) > 8`, including top `y < 220` and bottom `y > 1560`).
- **Platform HUD safe zone (`x: 60..900`, `y: 220..1560`)**: Every hook headline, live counter, HP label, and progress pill passes through `drawReelText` and `assertReelSafeBox` in `src/shared/reelUtils.ts`, keeping `x: 900..1080` open for right-rail social chrome.
- **Phone readability**: On-screen text is at least `42px` in the `1080px` source frame (about `15px` when played at `390px` wide). Shorter rule and status copy keeps that size inside the safe zone.
- **Frame fidelity**: Ball-state checkpoints are saved after each checkpoint frame is stepped. Regression tests compare reconstruction with a straight-through replay at frames `29`, `30`, `31`, `59`, `60`, and around victory.

## Stereo suspense and overtake audio

`src/comebacks/audio.ts` synthesizes 48 kHz stereo 16-bit PCM WAV files offline via `src/audio-reactive/synth.ts` (`Uint8Array` and `DataView` only, with zero Node `Buffer` calls in browser-imported modules):

- **Spatial lane separation**: Left-lane hits pan to `-0.62` and right-lane hits pan to `+0.62` using constant-power `panGains()`.
- **Endgame tension riser**: Once the early leader reaches `0.80` progress, a heartbeat kick pulse and rising Shepard harmonic shimmer accelerate toward `overtakeFrame`.
- **Click-free octave wrap**: Each Shepard voice wraps while its spectral bell is silent; a sample-level regression checks both wrap points.
- **Overtake sub-bass drop**: At `overtakeFrame` and `victoryFrame`, a pitched sub-bass drop (`150 Hz -> 46 Hz`) and major-9th pad chord resolve into a steady `-14 LUFS` bed (`<= -1.5 dBTP` true peak) that carries smoothly under `GetTheCodeEndCard`.

## Compositions

| Composition ID | Slug | Left contender (linear / steady) | Right contender (compounding) | Goal |
| --- | --- | --- | --- | --- |
| `TowerLinearVsExponential` | `tower-linear-vs-exponential` | `5,000` balls (`+600/s`, `#a78bfa`) | `1` ball (`x10 every 4.5s`, `#c8ff85`) | Break 10 doubling-HP vault floors |
| `TitanHammerVsSwarm` | `titan-hammer-vs-swarm` | `4,000` micro balls (`1 dmg`, `#38bdf8`) | `1` Titan orb (`x2 dmg/bounce`, `#fbbf24`) | Shatter 10 armoured chambers |
| `SplitterWallEscape` | `splitter-wall-escape` | Laser cutter (`450 bricks/s`, `#f472b6`) | `1` Splitter orb (`x3 balls/wall`, `#34d399`) | Breach 10 neon brick fortress walls |
| `AfterburnerLapComeback` | `afterburner-lap-comeback` | Steady cruiser (`900 km/h`, `#a78bfa`) | Afterburner (`+18% speed/bounce`, `#22d3ee`) | Complete 100 vertical race laps |
