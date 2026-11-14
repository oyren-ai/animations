import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("@remotion/cli/package.json")), "remotion-cli.js");
const [composition = "PinballBumperMatrix", output = "out/pinball-bumper-matrix.mp4", ...extra] = process.argv.slice(2);
mkdirSync(dirname(output), { recursive: true });
const result = spawnSync(process.execPath, [
  cli, "render", "src/index.ts", composition, output, "--codec=h264",
  "--pixel-format=yuv420p", "--crf=18", "--concurrency=1", ...extra,
], { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
