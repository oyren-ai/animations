// Offline seed search for the swarm compositions.
//   node --import tsx scripts/search-swarm-seed.ts <slug> [from=1] [to=1000] [top=8]
// Every seed is simulated without recording positions and scored with the same
// criteria the tests enforce (see `scoreSwarmArc`): lead changes, a late comeback
// of the eventual winner, and a final survivor late in the clip.
import { analyzeSwarm, scoreSwarmArc, simulateSwarm } from "../src/swarm/sim.ts";
import { getSwarmDefinition, SWARM_DEFINITIONS, type SwarmSlug } from "../src/swarm/themes.ts";

const [slugArg, fromArg = "1", toArg = "1000", topArg = "8"] = process.argv.slice(2);
if (!SWARM_DEFINITIONS.some((definition) => definition.slug === slugArg)) {
  throw new Error("usage: search-swarm-seed.ts <" + SWARM_DEFINITIONS.map((d) => d.slug).join("|") + "> [from] [to] [top]");
}
const definition = getSwarmDefinition(slugArg as SwarmSlug);
const from = Number(fromArg);
const to = Number(toArg);
const top = Number(topArg);

type Row = { seed: number; score: number; line: string };
const rows: Row[] = [];
let accepted = 0;
for (let seed = from; seed <= to; seed++) {
  const trace = simulateSwarm({ ...definition.config, seed }, { record: false });
  const metrics = analyzeSwarm(trace);
  const { ok, score } = scoreSwarmArc(trace, metrics, definition.arc);
  if (!ok) continue;
  accepted++;
  rows.push({
    seed,
    score,
    line:
      `seed ${seed}  score ${score.toFixed(2)}  winner ${definition.skin.types[trace.winner].name}  ` +
      `win ${metrics.winSeconds.toFixed(1)}s of ${metrics.totalSeconds.toFixed(1)}s  leadChanges ${metrics.leadChanges}  ` +
      `winnerLow ${metrics.winnerMinCount}/${trace.count} (${(metrics.winnerMinShare * 100).toFixed(1)}%) at ${(metrics.winnerMinFrame / 60).toFixed(1)}s`,
  });
}
rows.sort((a, b) => b.score - a.score || a.seed - b.seed);
console.log(`${definition.slug}: ${accepted} of ${to - from + 1} seeds meet the arc criteria`);
for (const row of rows.slice(0, top)) console.log(row.line);
