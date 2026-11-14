import { Config } from "@remotion/cli/config";
import { pngToBt709 } from "./src/encoding.ts";

Config.setVideoImageFormat("png");
Config.setColorSpace("bt709");
Config.setPixelFormat("yuv420p");
Config.overrideFfmpegCommand(({ args }) => pngToBt709(args));
Config.setOverwriteOutput(true);
Config.setConcurrency(1);
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
}
