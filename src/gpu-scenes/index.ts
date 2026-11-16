import { TOTAL_FRAMES } from "../settings.ts";
import { buildCyberTunnelAudio } from "./cyberTunnel.ts";
import { buildHarmonicSortingAudio, simulateHarmonicSorting } from "./harmonicSorting.ts";
import { buildWallCascadeAudio, simulateWallCascade } from "./wallCascade.ts";

export type GpuAudioSceneSlug =
  | "cyber-synth-shader-tunnel"
  | "polyphonic-wall-cascade"
  | "harmonic-sorting-matrix";

export interface GpuAudioCompositionDef {
  id: "CyberSynthShaderTunnel" | "PolyphonicWallCascade" | "HarmonicSortingMatrix";
  slug: GpuAudioSceneSlug;
  totalFrames: number;
  description: string;
}

export const GPU_AUDIO_COMPOSITIONS: readonly GpuAudioCompositionDef[] = [
  {
    id: "CyberSynthShaderTunnel",
    slug: "cyber-synth-shader-tunnel",
    totalFrames: TOTAL_FRAMES,
    description:
      "Full-bleed 1080x1920 WebGL2 GLSL raymarched synthwave tunnel driven by a 124 BPM 48 kHz stereo score.",
  },
  {
    id: "PolyphonicWallCascade",
    slug: "polyphonic-wall-cascade",
    totalFrames: TOTAL_FRAMES,
    description:
      "Full-screen 1080x1920 edge-to-edge 8-string acoustic chamber with stereo-panned polyphonic plucks and wall rails.",
  },
  {
    id: "HarmonicSortingMatrix",
    slug: "harmonic-sorting-matrix",
    totalFrames: TOTAL_FRAMES,
    description:
      "Full-bleed 3-band 1080x1920 Radix vs Quick vs Heap Sort race with stereo Lydian-pentatonic arpeggio sonification.",
  },
] as const;

export function synthesizeGpuAudioSceneWav(slug: GpuAudioSceneSlug): Buffer {
  switch (slug) {
    case "cyber-synth-shader-tunnel":
      return buildCyberTunnelAudio().wav;
    case "polyphonic-wall-cascade":
      return buildWallCascadeAudio(simulateWallCascade()).wav;
    case "harmonic-sorting-matrix":
      return buildHarmonicSortingAudio(simulateHarmonicSorting()).wav;
  }
}
