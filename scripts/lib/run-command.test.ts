import assert from "node:assert/strict";
import test from "node:test";
import { runCommand } from "./run-command.ts";

test("voice-generator command wrapper returns trimmed output", () => {
  assert.equal(runCommand(process.execPath, ["-e", "process.stdout.write('  2.5  ')"]), "2.5");
});

test("voice-generator command wrapper reports a missing executable", () => {
  assert.throws(() => runCommand("showcase-command-that-does-not-exist", []), /ENOENT/);
});

test("voice-generator command wrapper reports stderr and termination signal", () => {
  assert.throws(() => runCommand(process.execPath, ["-e", "console.error('bad input'); process.exit(7)"]), /bad input/);
  assert.throws(() => runCommand(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"]), /signal SIGTERM/);
});
