import { featuresOf } from "./echo-model.js";
import { reactionSnapshot } from "./reaction.js";
export const DRAW_VERSION = "draw-v1";
export const SIZE = 256;
export const VISUAL_TYPES = [
  "LC4",
  "LC6",
  "LC9",
  "LC11",
  "LC12",
  "LC15",
  "LC16",
  "LC17",
];
export const DIRECTIONS = Array.from({ length: 8 }, (_, i) => [
  Math.cos((i * Math.PI) / 4),
  Math.sin((i * Math.PI) / 4),
]);
export const SHAPES = {
  circle: {
    name: "丸",
    points: Array.from({ length: 97 }, (_, i) => [
      128 + 76 * Math.cos((i * Math.PI) / 48),
      128 + 76 * Math.sin((i * Math.PI) / 48),
    ]),
  },
  triangle: {
    name: "三角",
    points: [
      [128, 42],
      [218, 208],
      [38, 208],
      [128, 42],
    ],
  },
  wave: {
    name: "波線",
    points: Array.from({ length: 97 }, (_, i) => [
      28 + (i * 200) / 96,
      128 + 52 * Math.sin((i * Math.PI * 3) / 96),
    ]),
  },
  star: {
    name: "星（未練習）",
    points: Array.from({ length: 11 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5,
        r = i % 2 ? 34 : 85;
      return [128 + r * Math.cos(a), 128 + r * Math.sin(a)];
    }),
  },
};
export function validatePoints(points) {
  if (
    !Array.isArray(points) ||
    points.length < 2 ||
    points.length > 1500 ||
    points.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        p.some((x) => !Number.isFinite(x) || x < 8 || x > 248),
    )
  )
    throw Error(
      "お手本は用紙の内側に2点以上の線を描いてください（最大1500点）",
    );
  if (
    points.every(
      (p) => Math.hypot(p[0] - points[0][0], p[1] - points[0][1]) < 2,
    )
  )
    throw Error("もう少し長い線を描いてください");
  return points.map((p) => p.slice());
}
export function densify(points, spacing = 1) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing);
    for (let k = 1; k <= n; k++)
      out.push(a.map((v, j) => v + ((b[j] - v) * k) / n));
  }
  return out;
}
export function rasterize(points) {
  const image = new Uint8Array(SIZE * SIZE);
  for (const [x, y] of densify(validatePoints(points), 0.5))
    image[Math.round(y) * SIZE + Math.round(x)] = 1;
  return image;
}
export function initialPose(points) {
  const q = points.find(
    (p) => Math.hypot(p[0] - points[0][0], p[1] - points[0][1]) > 2,
  );
  return {
    x: points[0][0],
    y: points[0][1],
    heading: Math.atan2(q[1] - points[0][1], q[0] - points[0][0]),
  };
}
// 局所画素と直前の向きだけを見る人工的な8方向センサー。線の順番や終点は参照しない。
export function observe(image, pose) {
  return DIRECTIONS.map(([dx, dy]) => {
    if (dx * Math.cos(pose.heading) + dy * Math.sin(pose.heading) < -0.2)
      return 0;
    let value = 0;
    for (const radius of [6, 10]) {
      const x = Math.round(pose.x + radius * dx),
        y = Math.round(pose.y + radius * dy);
      for (let j = -3; j <= 3; j++)
        for (let i = -3; i <= 3; i++) {
          if (x + i < 0 || x + i >= SIZE || y + j < 0 || y + j >= SIZE)
            continue;
          if (image[(y + j) * SIZE + x + i])
            value = Math.max(value, Math.exp(-(i * i + j * j) / 5));
        }
    }
    return value;
  });
}
export function visualChannels(neurons) {
  const channels = DIRECTIONS.map(() => []),
    excluded = new Set();
  neurons.forEach((r, i) => {
    const k = VISUAL_TYPES.indexOf(r[1]);
    if (k >= 0) {
      excluded.add(i);
      channels[k].push(i);
    }
  });
  if (channels.some((c) => !c.length))
    throw Error("視覚入力用のLC神経がありません");
  return { channels, excluded };
}
export function sense(
  brain,
  inputs,
  sensors,
  { seed = 1, propagation = true, blind = false } = {},
  withReaction = true,
) {
  if (!Number.isInteger(seed) || seed < 1 || seed > 999999)
    throw Error("シードは1〜999999の整数にしてください");
  if (
    !Array.isArray(sensors) ||
    sensors.length !== 8 ||
    sensors.some((v) => !Number.isFinite(v) || v < 0 || v > 1)
  )
    throw Error("視覚入力が不正です");
  // 各観測を初期状態から20 ms計算。長期記憶や自然な視覚時間は再現しない。
  brain.seed = seed;
  brain.reset();
  const rates = new Float32Array(brain.n);
  if (!blind)
    inputs.channels.forEach((c, k) => {
      for (const i of c) rates[i] = 300 * sensors[k] ** 2;
    });
  const r = brain.batch(200, rates, !propagation);
  return {
    features: featuresOf(brain, inputs.excluded, r.counts),
    spikes: r.total,
    ...(withReaction
      ? { reaction: reactionSnapshot(brain.graph.neurons, r.counts, 200) }
      : {}),
  };
}
export function teachingExamples() {
  const examples = [];
  for (const key of ["circle", "triangle", "wave"]) {
    const points = SHAPES[key].points,
      dense = densify(points, 2),
      image = rasterize(points);
    for (let k = 0; k < 24; k++) {
      const i = Math.min(
          dense.length - 2,
          Math.floor((k * (dense.length - 2)) / 24),
        ),
        p = dense[i],
        q = dense[Math.min(i + 3, dense.length - 1)],
        heading = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const sensors = observe(image, { x: p[0], y: p[1], heading });
      const label = DIRECTIONS.map(
        ([x, y]) => x * Math.cos(heading) + y * Math.sin(heading),
      ).reduce((best, v, j, a) => (v > a[best] ? j : best), 0);
      examples.push({ sensors, label, shape: key });
    }
  }
  // 線が方向境界にある場合も練習する。正解方向は教師にだけ保持する。
  for (let direction = 0; direction < 8; direction++)
    for (const side of [-1, 1])
      for (const strength of [0.25, 0.65]) {
        const sensors = Array(8).fill(0);
        sensors[direction] = 1;
        sensors[(direction + side + 8) % 8] = strength;
        examples.push({
          sensors,
          label: direction,
          shape: "direction-practice",
        });
      }
  examples.push({ sensors: Array(8).fill(0), label: 8, shape: "blank" });
  return examples;
}
function checkFeatures(f) {
  if (
    !Array.isArray(f) ||
    f.length !== 192 ||
    f.some((v) => !Number.isFinite(v) || Math.abs(v) > 100)
  )
    throw Error("神経特徴量が不正です");
}
// 教師ありの正則化線形読み出し。学習時のみ正しい方向を与える。
export function fitDrawing(samples) {
  if (!Array.isArray(samples) || samples.length < 9 || samples.length > 160)
    throw Error("学習例の数が不正です");
  for (const s of samples) {
    checkFeatures(s.features);
    if (!Number.isInteger(s.label) || s.label < 0 || s.label > 8)
      throw Error("教師方向が不正です");
  }
  const n = samples.length,
    dim = 192,
    out = 9;
  const mean = Array.from(
    { length: dim },
    (_, j) => samples.reduce((s, r) => s + r.features[j], 0) / n,
  );
  const scale = mean.map((m, j) =>
    Math.max(
      0.00001,
      Math.sqrt(samples.reduce((s, r) => s + (r.features[j] - m) ** 2, 0) / n),
    ),
  );
  const x = samples.map((s) =>
    s.features.map((v, j) => (v - mean[j]) / scale[j]).concat(1),
  );
  const a = x.map((r, i) =>
    x
      .map(
        (q, k) => r.reduce((s, v, j) => s + v * q[j], 0) + (i === k ? 10 : 0),
      )
      .concat(
        Array.from({ length: out }, (_, j) => Number(samples[i].label === j)),
      ),
  );
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++)
      if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    const d = a[k][k];
    if (Math.abs(d) < 1e-12) throw Error("学習の計算が不安定です");
    for (let j = k; j < n + out; j++) a[k][j] /= d;
    for (let i = 0; i < n; i++)
      if (i !== k) {
        const f = a[i][k];
        for (let j = k; j < n + out; j++) a[i][j] -= f * a[k][j];
      }
  }
  return {
    version: DRAW_VERSION,
    mean,
    scale,
    weights: Array.from({ length: dim + 1 }, (_, j) =>
      Array.from({ length: out }, (_, o) =>
        x.reduce((s, r, i) => s + r[j] * a[i][n + o], 0),
      ),
    ),
    examples: n,
  };
}
export function validateDrawingModel(m) {
  if (!m || m.version !== DRAW_VERSION)
    throw Error("お絵かき学習の版が異なります");
  checkFeatures(m.mean);
  if (
    !Array.isArray(m.scale) ||
    m.scale.length !== 192 ||
    m.scale.some((v) => !Number.isFinite(v) || v <= 0 || v > 100) ||
    !Array.isArray(m.weights) ||
    m.weights.length !== 193 ||
    m.weights.some(
      (r) =>
        !Array.isArray(r) ||
        r.length !== 9 ||
        r.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e6),
    )
  )
    throw Error("学習係数が不正です");
  return m;
}
// 推論にはお手本、センサー、ペンの位置、形IDを渡さない。
export function predictPen(model, features) {
  checkFeatures(features);
  validateDrawingModel(model);
  if (features.every((v) => v === 0))
    return { dx: 0, dy: 0, down: false, direction: 8 };
  const x = features
    .map((v, j) => (v - model.mean[j]) / model.scale[j])
    .concat(1);
  const y = Array.from({ length: 9 }, (_, o) =>
    x.reduce((s, v, j) => s + v * model.weights[j][o], 0),
  );
  const best = y.reduce((b, v, i) => (v > y[b] ? i : b), 0);
  return {
    dx: best === 8 ? 0 : DIRECTIONS[best][0] * 3,
    dy: best === 8 ? 0 : DIRECTIONS[best][1] * 3,
    down: best !== 8,
    direction: best,
  };
}
export function movePen(pose, action) {
  return {
    x: Math.max(8, Math.min(248, pose.x + action.dx)),
    y: Math.max(8, Math.min(248, pose.y + action.dy)),
    heading: action.down ? Math.atan2(action.dy, action.dx) : pose.heading,
  };
}
export function measureDrawing(target, path) {
  const ref = densify(target, 2),
    marks = [];
  for (let i = 1; i < path.length; i++)
    if (path[i].down)
      marks.push(
        ...densify(
          [
            [path[i - 1].x, path[i - 1].y],
            [path[i].x, path[i].y],
          ],
          2,
        ),
      );
  if (!marks.length) return { distance: null, coverage: 0, ink: 0 };
  const nearest = (p, arr) =>
    arr.reduce(
      (d, q) => Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1])),
      Infinity,
    );
  return {
    distance:
      Math.round(
        (marks.reduce((s, p) => s + nearest(p, ref), 0) / marks.length) * 10,
      ) / 10,
    coverage: Math.round(
      (100 * ref.filter((p) => nearest(p, marks) <= 6).length) / ref.length,
    ),
    ink: marks.length,
  };
}
export function validateDrawingNote(note) {
  if (!note || note.version !== DRAW_VERSION)
    throw Error("お絵かきノートの版が異なります");
  return {
    version: DRAW_VERSION,
    model: validateDrawingModel(note.model),
    points: validatePoints(note.points),
  };
}
