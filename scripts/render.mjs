import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const hasFlag = (extra, flag) =>
  extra.some((arg) => arg === flag || arg.startsWith(`${flag}=`));

export function buildRenderCliArgs(cli, argv = []) {
  const [
    composition = "PinballBumperMatrix",
    output = "out/pinball-bumper-matrix.mp4",
    ...extra
  ] = argv;
  const defaults = [
    ...(hasFlag(extra, "--codec") ? [] : ["--codec=h264"]),
    ...(hasFlag(extra, "--pixel-format") ? [] : ["--pixel-format=yuv420p"]),
    ...(hasFlag(extra, "--crf") ? [] : ["--crf=18"]),
    ...(hasFlag(extra, "--concurrency") ? [] : ["--concurrency=1"]),
  ];
  return {
    output,
    args: [cli, "render", "src/index.ts", composition, output, ...defaults, ...extra],
  };
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("@remotion/cli/package.json")), "remotion-cli.js");
  const { output, args } = buildRenderCliArgs(cli, process.argv.slice(2));
  mkdirSync(dirname(output), { recursive: true });
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
