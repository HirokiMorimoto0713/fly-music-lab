import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadReal } from "./load-real.mjs";
import { BrainCPU } from "../vendor/brain.js";
import {
  PRESETS,
  capture,
  channelsFor,
  decode,
  trainReadout,
  scoreMelody,
  validateMelody,
  validateReadout,
  noteEvents,
} from "../src/echo-model.js";
test("melody bounds, mismatched length scoring and export timing", () => {
  assert.throws(() => validateMelody([{ pitch: 60, duration: 1 }]));
  assert.throws(() =>
    validateMelody([{ pitch: 999, duration: 1 }, ...PRESETS[0].notes]),
  );
  assert.equal(scoreMelody(PRESETS[0].notes, []).pitch, 0);
  assert.equal(
    scoreMelody(
      PRESETS[0].notes,
      PRESETS[0].notes.concat({ pitch: 62, duration: 1 }),
    ).pitch,
    75,
  );
  assert.deepEqual(
    noteEvents(PRESETS[0].notes).map((n) => n.beat),
    [0, 1, 2],
  );
  assert.throws(() => validateReadout({ version: "unknown" }));
});
test("real graph: external readout, unseen inputs, state reset and transmission controls", () => {
  const graph = loadReal(),
    brain = new BrainCPU(graph),
    inputs = channelsFor(graph.neurons);
  assert.equal(graph.n, 166700);
  assert.equal(graph.sources.length, 25582938);
  assert.deepEqual(
    inputs.channels.map((c) => c.length),
    [96, 96, 96, 96, 96, 96, 96],
  );
  const weights = graph.counts.slice();
  const samples = PRESETS.map((p) => ({
    ...capture(brain, inputs, p.notes),
    notes: p.notes,
  }));
  const model = trainReadout(samples);
  assert.ok(model.weights.some((r) => r.some((v) => v !== 0)));
  // 訓練例への適合と一般化は別々に記録し、一般化の成功を捏造しない。
  const rehearsal = samples.map((s) =>
    scoreMelody(s.notes, decode(model, s.features)),
  );
  assert.ok(rehearsal.some((s) => s.both > 0));
  const notes = PRESETS[0].notes;
  assert.deepEqual(capture(brain, inputs, notes).features, samples[0].features);
  const noPropagation = capture(brain, inputs, notes, { propagation: false });
  const reset = capture(brain, inputs, notes, { resetAfter: true });
  assert.ok(
    noPropagation.features.every((v) => v === 0),
    "excluded input neurons must not leak into readout",
  );
  assert.ok(reset.features.every((v) => v === 0));
  assert.deepEqual(decode(model, reset.features), []);
  assert.deepEqual(decode(null, samples[0].features), []);
  assert.notDeepEqual(samples[0].features, samples[1].features);
  const seed2 = capture(brain, inputs, notes, { seed: 2 });
  assert.notDeepEqual(seed2.features, samples[0].features);
  const novel = [
    { pitch: 71, duration: 1 },
    { pitch: 60, duration: 2 },
    { pitch: 65, duration: 1 },
  ];
  assert.ok(
    !samples.some((s) => JSON.stringify(s.notes) === JSON.stringify(novel)),
  );
  const unseen = capture(brain, inputs, novel, { seed: 2 });
  // 同じ特徴なら別のお手本を採点しても推論自体は変わらない。
  const before = decode(model, seed2.features);
  scoreMelody(novel, before);
  assert.deepEqual(decode(model, seed2.features), before);
  assert.deepEqual(
    decode(JSON.parse(JSON.stringify(model)), seed2.features),
    before,
  );
  assert.throws(() => decode({ ...model, weights: [[NaN]] }, seed2.features));
  assert.deepEqual(
    graph.counts,
    weights,
    "connectome remains fixed after training",
  );
  const report = {
    rehearsal,
    seed2: scoreMelody(notes, before),
    unseen: scoreMelody(novel, decode(model, unseen.features)),
    noPropagation: scoreMelody(notes, decode(model, noPropagation.features)),
    reset: scoreMelody(notes, decode(model, reset.features)),
    channels: inputs.channels.map((c) => c.length),
  };
  fs.mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
  fs.writeFileSync(
    new URL("../artifacts/echo-model-results.json", import.meta.url),
    JSON.stringify(report, null, 2),
  );
  console.log(report);
});
