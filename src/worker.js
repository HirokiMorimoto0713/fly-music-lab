import { BrainCPU } from "../vendor/brain.js";
import { loadGraph } from "./graph.js";
import { buildPools } from "./mapping.js";
let brain,
  graph,
  pools,
  rate,
  pending = [],
  motorPools;
function snapshot(steps, propagation) {
  rate.fill(0);
  for (const p of pending)
    if (p.end > brain.tick)
      for (const i of pools.targets[p.target])
        rate[i] = Math.max(rate[i], p.strength);
  pending = pending.filter((p) => p.end > brain.tick);
  const start = performance.now();
  const result = brain.batch(steps, rate, !propagation);
  const sum = (ids) => ids.reduce((a, i) => a + result.counts[i], 0);
  const groups = pools.groups.map(sum);
  const motor = motorPools.map((ids) =>
    ids.length ? (sum(ids) * 1000) / (steps * 0.1 * ids.length) : 0,
  );
  const top = [];
  for (let i = 0; i < graph.n; i++)
    if (result.counts[i]) top.push([i, result.counts[i]]);
  top.sort((a, b) => b[1] - a[1]);
  return {
    tick: result.tick,
    total: result.total,
    groups,
    motor,
    elapsed: performance.now() - start,
    active: top.length,
    top: top
      .slice(0, 200)
      .map(([i, count]) => ({
        id: graph.neurons[i][0],
        type: graph.neurons[i][1],
        count,
        position: graph.neurons[i][6],
      })),
  };
}
onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      graph = await loadGraph((text) =>
        postMessage({ type: "progress", text }),
      );
      brain = new BrainCPU(graph);
      rate = new Float32Array(graph.n);
      pools = buildPools(graph.neurons);
      const types = [
        ["DNa02", "DNa11", "DNg13"],
        ["DNa02", "DNa11", "DNg13"],
        ["DNp09", "DNg100", "DNg97"],
        ["DNp01"],
      ];
      motorPools = types.map((types, p) =>
        graph.neurons.flatMap((r, i) =>
          types.includes(r[1]) &&
          (p > 1 ||
            String(r[3])
              .toLowerCase()
              .startsWith(p === 0 ? "l" : "r"))
            ? [i]
            : [],
        ),
      );
      const anatomy = graph.neurons
        .filter((r) => Array.isArray(r[6]))
        .filter((_, i) => i % 30 === 0)
        .map((r) => r[6]);
      postMessage({
        type: "ready",
        n: graph.n,
        edges: graph.sources.length,
        groups: pools.groups.map((g) => g.length),
        targets: Object.fromEntries(
          Object.entries(pools.targets).map(([k, v]) => [k, v.length]),
        ),
        anatomy,
      });
    } else if (data.type === "reset") {
      brain.seed = data.seed;
      brain.reset();
      pending = [];
      postMessage({ type: "reset", id: data.id });
    } else if (data.type === "frame") {
      for (const p of data.stimuli || []) {
        if (!pools.targets[p.target]) throw Error("未知の刺激です");
        pending.push({ ...p, end: brain.tick + 2000 });
      }
      postMessage({
        type: "frame",
        id: data.id,
        ...snapshot(200, data.propagation),
      });
    }
  } catch (error) {
    postMessage({ type: "error", text: error.message, id: data.id });
  }
};
