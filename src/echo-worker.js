import { BrainCPU } from "../vendor/brain.js";
import { loadGraph } from "./graph.js";
import { channelsFor, capture } from "./echo-model.js";
let brain, inputs;
onmessage = async ({ data }) => {
  try {
    if (!brain) {
      const graph = await loadGraph((text) =>
        postMessage({ type: "progress", text }),
      );
      brain = new BrainCPU(graph);
      inputs = channelsFor(graph.neurons);
      postMessage({
        type: "loaded",
        n: graph.n,
        edges: graph.sources.length,
        channels: inputs.channels.map((c) => c.length),
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
    }
    const result = capture(brain, inputs, data.notes, data.options, (frame) =>
      postMessage({ type: "trace", frame }),
    );
    postMessage({ type: "result", id: data.id, result });
  } catch (e) {
    postMessage({ type: "error", id: data.id, text: e.message });
  }
};
