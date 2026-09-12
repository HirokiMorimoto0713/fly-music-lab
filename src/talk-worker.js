import { BrainCPU } from "../vendor/brain.js";
import { loadGraph } from "./graph.js";
import { TalkSession } from "./talk-model.js";
let session;
onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      const graph = await loadGraph((text) =>
        postMessage({ type: "progress", text }),
      );
      session = new TalkSession(new BrainCPU(graph));
      session.reset(data.seed, data.propagation);
      postMessage({
        type: "ready",
        n: graph.n,
        edges: graph.sources.length,
        pools: session.pools.outputs.map((p) =>
          p.map((i) => ({
            id: graph.neurons[i][0],
            type: graph.neurons[i][1],
            side: graph.neurons[i][3],
          })),
        ),
        anatomy: graph.neurons
          .filter(
            (r) =>
              Array.isArray(r[6]) &&
              r[6].length === 3 &&
              r[6].every(Number.isFinite),
          )
          .filter((_, i) => i % 20 === 0)
          .map((r) => r[6]),
      });
    } else if (data.type === "frame") {
      if (data.command) session.command(data.command);
      postMessage({ type: "frame", frame: session.frame() });
    }
  } catch (e) {
    postMessage({ type: "error", text: e.message });
  }
};
