import { reactionSnapshot } from "./reaction.js";
export const TALK_VERSION = "talk-v1";
export const COMMANDS = {
  come: { text: "こっちにおいで", explanation: "正面に目印を置く" },
  left: { text: "左を見て", explanation: "左側に目印を置く" },
  right: { text: "右を見て", explanation: "右側に目印を置く" },
  wait: {
    text: "少し待って",
    explanation: "目印を消して、残っている反応を見る",
  },
};
export function parseMessage(text) {
  if (typeof text !== "string" || text.length > 120)
    throw Error("120文字以内で入力してください");
  const t = text.normalize("NFKC").replace(/[\s、。！？!?]/g, "");
  const words = {
    come: ["こっちにおいで", "おいで", "前へ", "前に進んで", "こっちを見て"],
    left: ["左を見て", "左へ", "左に行って"],
    right: ["右を見て", "右へ", "右に行って"],
    wait: ["少し待って", "待って", "止まって", "おやすみ"],
  };
  const kind = Object.keys(words).find((k) => words[k].includes(t));
  if (!kind)
    throw Error(
      "この言葉はまだ刺激に変換できません。「こっちにおいで」「左を見て」「右を見て」「少し待って」を使えます",
    );
  return kind;
}
export function talkPools(neurons) {
  const sensory = [[], []],
    outputs = [[], [], []];
  neurons.forEach((r, i) => {
    const side = r[3] === "L" ? 0 : r[3] === "R" ? 1 : -1;
    if (r[1] === "LC9" && side >= 0) sensory[side].push(i);
    if (r[1] === "DNa02" && side >= 0) outputs[side].push(i);
    if (r[1] === "DNp09") outputs[2].push(i);
  });
  if ([...sensory, ...outputs].some((p) => !p.length))
    throw Error("会話に使う神経の注釈がありません");
  return { sensory, outputs };
}
export function targetFor(kind, pose) {
  if (!Object.hasOwn(COMMANDS, kind)) throw Error("未知の合図です");
  if (kind === "wait") return null;
  const a =
    pose.heading +
    (kind === "left" ? -Math.PI / 2 : kind === "right" ? Math.PI / 2 : 0);
  return {
    x: Math.max(12, Math.min(244, pose.x + 80 * Math.sin(a))),
    y: Math.max(12, Math.min(244, pose.y - 80 * Math.cos(a))),
  };
}
export function visualInput(target, pose) {
  if (!target) return [0, 0];
  const dx = target.x - pose.x,
    dy = target.y - pose.y;
  const bearing = Math.atan2(dx, -dy) - pose.heading,
    side = Math.sin(bearing),
    distance = Math.hypot(dx, dy);
  const gain =
    Math.min(1, distance / 16) * (0.65 + 0.35 * Math.max(0, Math.cos(bearing)));
  return [
    200 * gain * (1 - Math.max(0, side) * 0.85),
    200 * gain * (1 - Math.max(0, -side) * 0.85),
  ];
}
// 字幕は計算した出力だけから作る。ユーザーの文・目印の座標は渡さない。
export function translateOutput(motor) {
  if (
    !Array.isArray(motor) ||
    motor.length !== 3 ||
    motor.some((v) => !Number.isFinite(v) || v < 0)
  )
    throw Error("出力値が不正です");
  const [left, right, forward] = motor,
    delta = right - left;
  const speed = Math.min(1, forward / 120),
    turn = Math.max(-1, Math.min(1, delta / 80));
  let key = "quiet",
    text = "……",
    basis = "前進・旋回の出力が基準未満";
  if (Math.abs(delta) >= 8) {
    key = delta > 0 ? "right" : "left";
    text = delta > 0 ? "右かな" : "左かな";
    basis = `左右DNa02の発火率差 ${delta.toFixed(1)} Hz`;
  } else if (forward >= 10) {
    key = "forward";
    text = "前へ行こう";
    basis = `DNp09の平均発火率 ${forward.toFixed(1)} Hz`;
  } else if (left >= 8 && right >= 8) {
    key = "mixed";
    text = "……";
    basis = "左右の旋回出力が拮抗しています";
  }
  // 字幕の閾値と動きの閾値を揃え、字幕が無反応なら勝手に歩かせない。
  return {
    key,
    text,
    basis,
    motor,
    speed: forward >= 10 ? speed : 0,
    turn: Math.abs(delta) >= 8 ? turn : 0,
    label: "アプリの翻訳規則 / 主観の推定ではありません",
  };
}
export class TalkSession {
  constructor(brain) {
    this.brain = brain;
    this.pools = talkPools(brain.graph.neurons);
    this.reset(1, true);
  }
  reset(seed, propagation) {
    if (
      !Number.isInteger(seed) ||
      seed < 1 ||
      seed > 999999 ||
      typeof propagation !== "boolean"
    )
      throw Error("条件が不正です");
    this.brain.seed = seed;
    this.brain.reset();
    this.seed = seed;
    this.propagation = propagation;
    this.pose = { x: 128, y: 188, heading: 0 };
    this.target = null;
    this.window = [];
    this.step = 0;
  }
  command(kind) {
    this.target = targetFor(kind, this.pose);
  }
  frame() {
    const inputs = visualInput(this.target, this.pose),
      rates = new Float32Array(this.brain.n);
    this.pools.sensory.forEach((p, k) => {
      for (const i of p) rates[i] = inputs[k];
    });
    const result = this.brain.batch(200, rates, !this.propagation);
    const counts = this.pools.outputs.map((p) =>
      p.reduce((sum, i) => sum + result.counts[i], 0),
    );
    this.window.push(counts);
    if (this.window.length > 3) this.window.shift();
    const motor = counts.map(
      (_, k) =>
        (this.window.reduce((s, row) => s + row[k], 0) * 1000) /
        (this.window.length * 20 * this.pools.outputs[k].length),
    );
    const output = translateOutput(motor),
      before = { ...this.pose };
    this.pose.heading += output.turn * 0.15;
    this.pose.x = Math.max(
      12,
      Math.min(
        244,
        this.pose.x + Math.sin(this.pose.heading) * output.speed * 3,
      ),
    );
    this.pose.y = Math.max(
      12,
      Math.min(
        244,
        this.pose.y - Math.cos(this.pose.heading) * output.speed * 3,
      ),
    );
    return {
      step: ++this.step,
      tick: result.tick,
      phase: "talk",
      spikes: result.total,
      inputs,
      counts,
      motor,
      windowMs: this.window.length * 20,
      output,
      before,
      pose: { ...this.pose },
      target: this.target ? { ...this.target } : null,
      reaction: reactionSnapshot(this.brain.graph.neurons, result.counts, 200),
    };
  }
}
