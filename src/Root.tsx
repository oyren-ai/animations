import { Composition } from "remotion";
import { STYLES } from "./ball-drop/sim.ts";
import { AnimationShell } from "./components/AnimationShell.tsx";
import { TOTAL_FRAMES, VIDEO } from "./settings.ts";

export function Root() {
  return <>
    {STYLES.map((style) => <Composition key={style.id} id={style.id} component={AnimationShell}
      width={VIDEO.width} height={VIDEO.height} fps={VIDEO.fps} durationInFrames={TOTAL_FRAMES}
      defaultProps={{ style: style.slug }} />)}
    <Composition id="PendulumWave" component={AnimationShell} width={VIDEO.width} height={VIDEO.height}
      fps={VIDEO.fps} durationInFrames={TOTAL_FRAMES} defaultProps={{}} />
  </>;
}
