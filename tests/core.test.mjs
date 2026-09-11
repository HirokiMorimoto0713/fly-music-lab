import test from "node:test";
import assert from "node:assert/strict";
import { BrainCPU } from "../vendor/brain.js";
import {
  DEFAULT_CONFIG,
  frameToNotes,
  frameToMotion,
  buildPools,
  validateConfig,
} from "../src/mapping.js";
import { experiment, validateExperiment } from "../src/experiment.js";
import { midiBytes, wavBytes } from "../src/audio.js";
import { loadReal } from "./load-real.mjs";
test("quiet network has no invented notes or motion", () => {
  const frame = { groups: [0, 0, 0, 0, 0], motor: [0, 0, 0, 0] };
  assert.deepEqual(frameToNotes(frame, DEFAULT_CONFIG, 0), []);
  assert.deepEqual(frameToMotion(frame), { speed: 0, turn: 0, wing: 0 });
});
test("JSON conditions roundtrip and hostile/invalid values rejected", () => {
  const e = experiment(
    DEFAULT_CONFIG,
    [{ frame: 0, target: "vision", strength: 160 }],
    16,
  );
  assert.deepEqual(validateExperiment(JSON.parse(JSON.stringify(e))), e);
  assert.throws(() => validateExperiment({ ...e, dataset: "unknown" }));
  assert.throws(() =>
    validateExperiment({
      ...e,
      stimuli: [{ frame: 0, target: "unknown", strength: 12 }],
    }),
  );
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, bpm: Infinity }));
  assert.throws(() =>
    validateConfig({ ...DEFAULT_CONFIG, scale: "__proto__" }),
  );
});
test("WAV and MIDI binary formats contain actual signal and timing", () => {
  const samples = Float32Array.from(
      { length: 100 },
      (_, i) => Math.sin(i / 10) * 0.3,
    ),
    wav = wavBytes(samples, 22050);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(new DataView(wav.buffer).getUint32(40, true), 200);
  assert.ok(wav.slice(44).some((v) => v !== 0));
  const midi = midiBytes(
    [{ beat: 0, duration: 1, pitch: 60, velocity: 80, group: 0 }],
    96,
  );
  assert.equal(new TextDecoder().decode(midi.slice(0, 4)), "MThd");
  assert.equal(new DataView(midi.buffer).getUint16(12), 480);
  assert.ok(
    midi.some((v, i) => v === 144 && midi[i + 1] === 60 && midi[i + 2] === 80),
  );
});
test("real MaleCNS: all graph retained, seeded replay, propagation control, no-input control", () => {
  const g = loadReal();
  assert.equal(g.n, 166700);
  assert.equal(g.sources.length, 25582938);
  assert.equal(g.offsets.length, 166701);
  assert.equal(g.offsets[g.n], g.sources.length);
  assert.ok(g.sources.every((i) => i < g.n));
  const pools = buildPools(g.neurons),
    brain = new BrainCPU(g),
    rates = new Float32Array(g.n);
  assert.ok(pools.targets.vision.length > 0);
  assert.equal(
    pools.groups.reduce((n, p) => n + p.length, 0),
    g.n,
  );
  assert.equal(brain.batch(200, rates).total, 0);
  function run(silenced = false, seed = 1) {
    brain.reset();
    brain.seed = seed;
    rates.fill(0);
    for (const i of pools.targets.vision) rates[i] = 160;
    return Array.from({ length: 4 }, () => {
      const r = brain.batch(200, rates, silenced);
      return {
        total: r.total,
        groups: pools.groups.map((ids) =>
          ids.reduce((a, i) => a + r.counts[i], 0),
        ),
      };
    });
  }
  const a = run(),
    b = run(),
    off = run(true),
    other = run(false, 2);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, off);
  assert.notDeepEqual(a, other);
  assert.ok(a.reduce((n, r) => n + r.groups[1], 0) > 0);
  assert.equal(
    off.reduce((n, r) => n + r.groups[1], 0),
    0,
  );
  console.log(JSON.stringify({ baseline: a, withoutPropagation: off }));
});
