import { BrainCPU } from "../vendor/brain.js";
import { loadGraph } from "./graph.js";
import {
  visualChannels,
  sense,
  teachingExamples,
  fitDrawing,
  predictPen,
  validateDrawingModel,
  validatePoints,
  rasterize,
  initialPose,
  observe,
  movePen,
  measureDrawing,
} from "./draw-model.js";
let brain, inputs;
onmessage = async ({ data }) => {
  try {
    if (!brain) {
      const graph = await loadGraph((text) =>
        postMessage({ type: "progress", text }),
      );
      brain = new BrainCPU(graph);
      inputs = visualChannels(graph.neurons);
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
    if (data.type === "train") {
      const examples = teachingExamples(),
        samples = [];
      for (let i = 0; i < examples.length; i++) {
        const e = examples[i],
          r = sense(brain, inputs, e.sensors, {}, false);
        samples.push({ features: r.features, label: e.label });
        postMessage({
          type: "progress",
          text: `読み出し器を練習中 ${i + 1} / ${examples.length}観測`,
        });
      }
      const model = fitDrawing(samples),
        correct = samples.filter(
          (s) => predictPen(model, s.features).direction === s.label,
        ).length;
      postMessage({ type: "trained", model, correct, total: samples.length });
    } else if (data.type === "draw") {
      const points = validatePoints(data.points),
        model = validateDrawingModel(data.model),
        image = rasterize(points);
      let pose = initialPose(points);
      const path = [{ ...pose, down: false }],
        trace = [];
      for (let i = 0; i < 160; i++) {
        const sensors = observe(image, pose),
          r = sense(brain, inputs, sensors, data.options),
          action = predictPen(model, r.features),
          before = { ...pose };
        pose = movePen(pose, action);
        path.push({ ...pose, down: action.down });
        const frame = {
          phase: "draw",
          blind: !!data.options.blind,
          step: i + 1,
          ...r,
          sensors: data.options.blind ? Array(8).fill(0) : sensors,
          pose: before,
          after: pose,
          action,
        };
        trace.push(frame);
        postMessage({ type: "frame", frame });
        if (!action.down) break;
      }
      postMessage({
        type: "result",
        result: {
          points,
          path,
          trace,
          options: data.options,
          metrics: measureDrawing(points, path),
          neurons: brain.n,
          edges: brain.graph.sources.length,
          reason: trace.at(-1).action.down ? "160筆の上限" : "ペンを上げて停止",
        },
      });
    }
  } catch (e) {
    postMessage({ type: "error", text: e.message });
  }
};
