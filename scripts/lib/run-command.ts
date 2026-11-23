import { spawnSync } from "node:child_process";

/** Run local ffmpeg/ffprobe commands and retain the reason when they fail. */
export function runCommand(cmd: string, args: readonly string[]): string {
  const result = spawnSync(cmd, [...args], { encoding: "utf8" });
  if (result.status !== 0) {
    const reason = result.error?.message || result.stderr?.trim().slice(0, 300) ||
      (result.signal ? `signal ${result.signal}` : `exit status ${result.status}`);
    throw new Error(`${cmd} failed: ${reason}`);
  }
  return result.stdout.trim();
}
