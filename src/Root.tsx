import { Composition } from "remotion";
import { STYLES } from "./ball-drop/sim.ts";
import { COMEBACK_COMPOSITIONS } from "./comebacks/index.ts";
import { AnimationShell } from "./components/AnimationShell.tsx";
import { FourierExplainerShell } from "./components/FourierExplainerShell.tsx";
import { ComebackShell } from "./components/ComebackShell.tsx";
import { PatateShell } from "./components/PatateShell.tsx";
import { GpuAudioSceneShell } from "./components/GpuAudioSceneShell.tsx";
import { RepoShowcaseShell } from "./components/RepoShowcaseShell.tsx";
import { getReelArenaTiming, ReelArenaShell } from "./components/ReelArenaShell.tsx";
import { EXPLAINER_FRAMES, EXPLAINER_SLUG } from "./country-maps/explainer.ts";
import { SwarmShell } from "./components/SwarmShell.tsx";
import { COUNTRY_MAPS } from "./country-maps/fourier.ts";
import { DROP_STYLES } from "./drop-arenas/sim.ts";
import { GPU_AUDIO_COMPOSITIONS } from "./gpu-scenes/index.ts";
import { PATATE_COMPOSITIONS, PATATE_TOTAL_FRAMES } from "./patate/themes.ts";
import { SHOWCASE_TOTAL_FRAMES } from "./repo-showcase/timing.ts";
import { STRING_ROUNDS } from "./string-arena/sim.ts";
import { getSwarmTiming, SWARM_DEFINITIONS } from "./swarm/themes.ts";
import { TOTAL_FRAMES, VIDEO } from "./settings.ts";
import { MidiCompositions } from "./midi/compositions.tsx";
import { MusicShell } from "./music/MusicShell.tsx";
import { CARPET_TOTAL_FRAMES } from "./music-carpet/score.ts";
import { FIREWORK_TOTAL_FRAMES } from "./music-fireworks/score.ts";
import { ROPE_HARP_TOTAL_FRAMES } from "./music-rope-harp/score.ts";

export function Root() {
  const stringCombinedTiming = getReelArenaTiming({ kind: "string-combined" });
  const dropCombinedTiming = getReelArenaTiming({ kind: "drop-combined" });

  return <>
    {STYLES.map((style) => <Composition key={style.id} id={style.id} component={AnimationShell}
      width={VIDEO.width} height={VIDEO.height} fps={VIDEO.fps} durationInFrames={TOTAL_FRAMES}
      defaultProps={{ style: style.slug }} />)}
    <Composition id="PendulumWave" component={AnimationShell} width={VIDEO.width} height={VIDEO.height}
      fps={VIDEO.fps} durationInFrames={TOTAL_FRAMES} defaultProps={{}} />
    {COUNTRY_MAPS.map((map) => map.slug === EXPLAINER_SLUG
      ? <Composition key={map.id} id={map.id} component={FourierExplainerShell}
        width={VIDEO.width} height={VIDEO.height} fps={VIDEO.fps} durationInFrames={EXPLAINER_FRAMES} />
      : <Composition key={map.id} id={map.id} component={AnimationShell}
        width={VIDEO.width} height={VIDEO.height} fps={VIDEO.fps} durationInFrames={TOTAL_FRAMES}
        defaultProps={{ countryMap: map.slug }} />)}

    <Composition
      id="StringArenasCombined"
      component={ReelArenaShell}
      width={VIDEO.width}
      height={VIDEO.height}
      fps={VIDEO.fps}
      durationInFrames={stringCombinedTiming.totalFrames}
      defaultProps={{ mode: { kind: "string-combined" } }}
    />
    {STRING_ROUNDS.map((round) => {
      const timing = getReelArenaTiming({ kind: "string-round", slug: round.slug });
      return (
        <Composition
          key={round.id}
          id={round.id}
          component={ReelArenaShell}
          width={VIDEO.width}
          height={VIDEO.height}
          fps={VIDEO.fps}
          durationInFrames={timing.totalFrames}
          defaultProps={{ mode: { kind: "string-round", slug: round.slug } }}
        />
      );
    })}

    {DROP_STYLES.map((drop) => {
      const timing = getReelArenaTiming({ kind: "drop-standalone", slug: drop.slug });
      return (
        <Composition
          key={drop.id}
          id={drop.id}
          component={ReelArenaShell}
          width={VIDEO.width}
          height={VIDEO.height}
          fps={VIDEO.fps}
          durationInFrames={timing.totalFrames}
          defaultProps={{ mode: { kind: "drop-standalone", slug: drop.slug } }}
        />
      );
    })}
    <Composition
      id="BallDropCombined"
      component={ReelArenaShell}
      width={VIDEO.width}
      height={VIDEO.height}
      fps={VIDEO.fps}
      durationInFrames={dropCombinedTiming.totalFrames}
      defaultProps={{ mode: { kind: "drop-combined" } }}
    />

    {PATATE_COMPOSITIONS.map((patate) => (
      <Composition
        key={patate.id}
        id={patate.id}
        component={PatateShell}
        width={VIDEO.width}
        height={VIDEO.height}
        fps={VIDEO.fps}
        durationInFrames={PATATE_TOTAL_FRAMES}
        defaultProps={{ slug: patate.slug }}
      />
    ))}

    {GPU_AUDIO_COMPOSITIONS.map((gpuScene) => (
      <Composition
        key={gpuScene.id}
        id={gpuScene.id}
        component={GpuAudioSceneShell}
        width={VIDEO.width}
        height={VIDEO.height}
        fps={VIDEO.fps}
        durationInFrames={gpuScene.totalFrames}
        defaultProps={{ slug: gpuScene.slug }}
      />
    ))}

    {COMEBACK_COMPOSITIONS.map((comeback) => (
      <Composition
        key={comeback.id}
        id={comeback.id}
        component={ComebackShell}
        width={VIDEO.width}
        height={VIDEO.height}
        fps={VIDEO.fps}
        durationInFrames={comeback.totalFrames}
        defaultProps={{ slug: comeback.slug }}
      />
    ))}

    <Composition
      id="AnimationsRepoShowcase"
      component={RepoShowcaseShell}
      width={VIDEO.width}
      height={VIDEO.height}
      fps={VIDEO.fps}
      durationInFrames={SHOWCASE_TOTAL_FRAMES}
      defaultProps={{}}
    />
    <MidiCompositions />
    {SWARM_DEFINITIONS.map((swarm) => (
      <Composition
        key={swarm.id}
        id={swarm.id}
        component={SwarmShell}
        width={VIDEO.width}
        height={VIDEO.height}
        fps={VIDEO.fps}
        durationInFrames={getSwarmTiming(swarm.slug).totalFrames}
        defaultProps={{ slug: swarm.slug }}
      />
    ))}
    <Composition
      id="MusicCarpetLoom"
      component={MusicShell}
      width={VIDEO.width}
      height={VIDEO.height}
      fps={VIDEO.fps}
      durationInFrames={CARPET_TOTAL_FRAMES}
      defaultProps={{ slug: "music-carpet-loom" }}
    />
    <Composition
      id="MusicFireworkKing"
      component={MusicShell}
      width={VIDEO.width}
      height={VIDEO.height}
      fps={VIDEO.fps}
      durationInFrames={FIREWORK_TOTAL_FRAMES}
      defaultProps={{ slug: "music-firework-king" }}
    />
    <Composition
      id="MusicRopeHarp"
      component={MusicShell}
      width={VIDEO.width}
      height={VIDEO.height}
      fps={VIDEO.fps}
      durationInFrames={ROPE_HARP_TOTAL_FRAMES}
      defaultProps={{ slug: "music-rope-harp" }}
    />
  </>;
}
