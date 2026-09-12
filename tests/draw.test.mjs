import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadReal } from "./load-real.mjs";
import { BrainCPU } from "../vendor/brain.js";
import * as d from "../src/draw-model.js";
function drawing(brain, inputs, model, key, options = {}, limit = 160) {
  const points = d.SHAPES[key].points,
    image = d.rasterize(points);
  let pose = d.initialPose(points);
  const path = [{ ...pose, down: false }],
    trace = [];
  for (let i = 0; i < limit; i++) {
    const seen = d.observe(image, pose),
      r = d.sense(brain, inputs, seen, options, false),
      a = d.predictPen(model, r.features);
    pose = d.movePen(pose, a);
    path.push({ ...pose, down: a.down });
    trace.push(r);
    if (!a.down) break;
  }
  return { path, trace, metrics: d.measureDrawing(points, path) };
}
test("drawing input limits, local observation and geometry scoring", () => {
  assert.throws(() =>
    d.validatePoints([
      [1, 2],
      [3, 4],
    ]),
  );
  assert.throws(() =>
    d.validatePoints([
      [64, 64],
      [64, 64],
    ]),
  );
  assert.throws(() =>
    d.validatePoints([
      [64, 64],
      [NaN, 64],
    ]),
  );
  const pose = { x: 128, y: 128, heading: 0 };
  const a = d.rasterize([
      [100, 128],
      [150, 128],
    ]),
    b = a.slice();
  b[30 * 256 + 30] = 1;
  assert.deepEqual(
    d.observe(a, pose),
    d.observe(b, pose),
    "distant target pixels must not influence local observation",
  );
  assert.notDeepEqual(
    d.observe(a, pose),
    d.observe(new Uint8Array(256 * 256), pose),
  );
  const target = [
      [64, 64],
      [192, 64],
    ],
    path = [
      { x: 64, y: 64, down: false },
      { x: 192, y: 64, down: true },
    ];
  assert.equal(d.measureDrawing(target, path).coverage, 100);
  assert.equal(d.measureDrawing(target, path).distance, 0);
  assert.equal(d.measureDrawing(target, [path[0]]).coverage, 0);
  assert.deepEqual(
    d.observe(new Uint8Array(256 * 256), pose),
    Array(8).fill(0),
  );
});
test("full connectome drawing: learned pen actions, closed-loop replay, controls and saved readout", () => {
  const graph = loadReal(),
    brain = new BrainCPU(graph),
    inputs = d.visualChannels(graph.neurons),
    original = graph.counts.slice();
  assert.equal(brain.n, 166700);
  assert.equal(graph.sources.length, 25582938);
  assert.deepEqual(
    inputs.channels.map((c) => c.length),
    [126, 124, 219, 143, 498, 126, 182, 353],
  );
  const examples = d.teachingExamples(),
    samples = examples.map((e) => ({
      ...d.sense(brain, inputs, e.sensors, {}, false),
      label: e.label,
    })),
    model = d.fitDrawing(samples);
  const fit = samples.filter(
    (s) => d.predictPen(model, s.features).direction === s.label,
  ).length;
  assert.ok(
    fit > samples.length / 2,
    "learned readout should discriminate training directions",
  );
  const baseline = drawing(brain, inputs, model, "circle"),
    replay = drawing(brain, inputs, model, "circle");
  assert.deepEqual(baseline.path, replay.path);
  assert.ok(baseline.path.length > 2);
  assert.ok(baseline.metrics.coverage > 0);
  const seed2 = drawing(brain, inputs, model, "circle", { seed: 2 }),
    wave = drawing(brain, inputs, model, "wave"),
    triangle = drawing(brain, inputs, model, "triangle"),
    star = drawing(brain, inputs, model, "star");
  assert.notDeepEqual(seed2.trace[0].features, baseline.trace[0].features);
  const noPropagation = drawing(brain, inputs, model, "circle", {
      propagation: false,
    }),
    blind = drawing(brain, inputs, model, "circle", { blind: true });
  for (const r of [noPropagation, blind]) {
    assert.ok(r.trace.every((f) => f.features.every((v) => v === 0)));
    assert.equal(r.metrics.ink, 0);
    assert.equal(r.path[1].down, false);
  }
  assert.ok(
    noPropagation.trace[0].spikes > 0,
    "direct inputs still fire without transmission",
  );
  assert.equal(blind.trace[0].spikes, 0);
  const f = baseline.trace[0].features,
    a = d.predictPen(model, f);
  d.measureDrawing(d.SHAPES.star.points, baseline.path);
  assert.deepEqual(
    d.predictPen(model, f),
    a,
    "scoring another target cannot change inference",
  );
  const note = d.validateDrawingNote(
    JSON.parse(
      JSON.stringify({
        version: d.DRAW_VERSION,
        model,
        points: d.SHAPES.star.points,
      }),
    ),
  );
  assert.deepEqual(d.predictPen(note.model, f), a);
  assert.throws(() =>
    d.validateDrawingNote({
      ...note,
      model: { ...model, weights: [[Infinity]] },
    }),
  );
  assert.throws(() => d.sense(brain, inputs, examples[0].sensors, { seed: 0 }));
  assert.deepEqual(
    graph.counts,
    original,
    "full connectome weights stay fixed",
  );
  const report = {
    training: { correct: fit, total: samples.length },
    circle: baseline.metrics,
    seed2: seed2.metrics,
    wave: wave.metrics,
    triangle: triangle.metrics,
    star: star.metrics,
    noPropagation: noPropagation.metrics,
    blind: blind.metrics,
    channels: inputs.channels.map((c) => c.length),
  };
  fs.mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
  fs.writeFileSync(
    new URL("../artifacts/drawing-model-results.json", import.meta.url),
    JSON.stringify(report, null, 2),
  );
  console.log(report);
});
