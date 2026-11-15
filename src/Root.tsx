import { Composition } from "remotion";
import { STYLES } from "./ball-drop/sim.ts";
import { AnimationShell } from "./components/AnimationShell.tsx";
import { PatateShell } from "./components/PatateShell.tsx";
import { getReelArenaTiming, ReelArenaShell } from "./components/ReelArenaShell.tsx";
import { COUNTRY_MAPS } from "./country-maps/fourier.ts";
import { DROP_STYLES } from "./drop-arenas/sim.ts";
import { PATATE_COMPOSITIONS, PATATE_TOTAL_FRAMES } from "./patate/themes.ts";
import { STRING_ROUNDS } from "./string-arena/sim.ts";
import { TOTAL_FRAMES, VIDEO } from "./settings.ts";

export function Root() {
  const stringCombinedTiming = getReelArenaTiming({ kind: "string-combined" });
  const dropCombinedTiming = getReelArenaTiming({ kind: "drop-combined" });

  return <>
    {STYLES.map((style) => <Composition key={style.id} id={style.id} component={AnimationShell}
      width={VIDEO.width} height={VIDEO.height} fps={VIDEO.fps} durationInFrames={TOTAL_FRAMES}
      defaultProps={{ style: style.slug }} />)}
    <Composition id="PendulumWave" component={AnimationShell} width={VIDEO.width} height={VIDEO.height}
      fps={VIDEO.fps} durationInFrames={TOTAL_FRAMES} defaultProps={{}} />
    {COUNTRY_MAPS.map((map) => <Composition key={map.id} id={map.id} component={AnimationShell}
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
  </>;
}
