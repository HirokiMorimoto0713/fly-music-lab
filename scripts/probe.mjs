import { loadReal } from "../tests/load-real.mjs";
import { BrainCPU } from "../vendor/brain.js";
import { buildPools } from "../src/mapping.js";
const graph = loadReal(),
  brain = new BrainCPU(graph),
  pools = buildPools(graph.neurons),
  rates = new Float32Array(graph.n);
console.log(
  "groups",
  pools.groups.map((g) => g.length),
  "targets",
  Object.fromEntries(
    Object.entries(pools.targets).map(([k, v]) => [k, v.length]),
  ),
);
for (const i of pools.targets.vision) rates[i] = 160;
for (let frame = 0; frame < 12; frame++) {
  const start = performance.now(),
    r = brain.batch(200, rates);
  console.log(
    frame,
    Math.round(performance.now() - start) + "ms",
    r.total,
    pools.groups.map((g) => g.reduce((s, i) => s + r.counts[i], 0)),
  );
}
