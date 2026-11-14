export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 60,
  sceneSeconds: 12,
  closingSeconds: 3,
} as const;

export const SCENE_FRAMES = VIDEO.fps * VIDEO.sceneSeconds;
export const CLOSING_FRAMES = VIDEO.fps * VIDEO.closingSeconds;
export const TOTAL_FRAMES = SCENE_FRAMES + CLOSING_FRAMES;
