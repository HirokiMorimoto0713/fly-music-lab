import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BrainCPU } from "../vendor/brain.js";
import { loadReal } from "./load-real.mjs";
import {
  TalkSession,
  parseMessage,
  translateOutput,
} from "../src/talk-model.js";
test("translator and text conversion have separate boundaries", () => {
  assert.equal(parseMessage("こっちにおいで！"), "come");
  assert.equal(parseMessage("右を見て"), "right");
  assert.throws(() => parseMessage("右へは行かないで"));
  assert.throws(() => parseMessage("<script>alert(1)</script>"));
  assert.equal(translateOutput([0, 0, 0]).key, "quiet");
  assert.equal(translateOutput([0, 0, 20]).text, "前へ行こう");
  assert.equal(translateOutput([0, 30, 0]).key, "right");
  assert.equal(translateOutput([30, 0, 0]).key, "left");
  assert.equal(translateOutput([20, 20, 0]).key, "mixed");
  assert.throws(() => translateOutput([NaN, 0, 0]));
});
test("full connectome conversation preserves state and grounds subtitles in measured output", () => {
  const g = loadReal(),
    s = new TalkSession(new BrainCPU(g));
  assert.equal(g.n, 166700);
  assert.equal(g.sources.length, 25582938);
  assert.deepEqual(
    s.pools.outputs.map((p) => p.length),
    [1, 1, 2],
  );
  s.command("come");
  const frames = Array.from({ length: 16 }, () => s.frame());
  assert.ok(frames.some((f) => f.output.key === "forward"));
  assert.equal(frames.at(-1).tick, 3200);
  frames.forEach((f) => assert.deepEqual(f.output, translateOutput(f.motor)));
  s.command("wait");
  const after = s.frame();
  assert.equal(after.tick, 3400);
  assert.deepEqual(after.inputs, [0, 0]);
  assert.ok(after.spikes > 0, "state is retained after removing stimulus");
  s.reset(1, true);
  s.command("come");
  assert.deepEqual(
    Array.from({ length: 16 }, () => s.frame()),
    frames,
    "seed replay includes trajectory, output and reactions",
  );
  s.reset(1, false);
  s.command("come");
  const controls = Array.from({ length: 16 }, () => s.frame());
  assert.ok(controls.some((f) => f.spikes > 0));
  assert.ok(
    controls.every(
      (f) => f.motor.every((v) => v === 0) && f.output.key === "quiet",
    ),
  );
  assert.equal(s.pose.y, 188);
  s.reset(1, true);
  s.command("wait");
  assert.equal(s.frame().spikes, 0);
  assert.throws(() => s.reset(0, true));
  const summary = {
    pools: s.pools.outputs.map((p) => p.map((i) => g.neurons[i].slice(0, 4))),
    captions: frames.map((f) => f.output.text),
    finalPose: frames.at(-1).pose,
    afterWait: { spikes: after.spikes, motor: after.motor },
    controlOutput: controls.at(-1).output,
  };
  fs.mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
  fs.writeFileSync(
    new URL("../artifacts/talk-model-results.json", import.meta.url),
    JSON.stringify(summary, null, 2),
  );
  console.log(summary);
});
