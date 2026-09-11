// 人工的な音符入力と、固定配線に追加する学習可能な読み出し器。
// decode() は神経特徴量と学習済み係数だけを受け取り、お手本を参照しない。
export const VERSION = "echo-v1";
export const PITCHES = [60, 62, 64, 65, 67, 69, 71];
export const NAMES = ["ド", "レ", "ミ", "ファ", "ソ", "ラ", "シ"];
export const PRESETS = [
  {
    name: "のぼる",
    notes: [
      [60, 1],
      [64, 1],
      [67, 2],
    ],
  },
  {
    name: "おりる",
    notes: [
      [67, 1],
      [64, 1],
      [60, 2],
    ],
  },
  {
    name: "呼びかけ",
    notes: [
      [60, 1],
      [60, 1],
      [67, 2],
      [64, 1],
    ],
  },
  {
    name: "寄り道",
    notes: [
      [62, 2],
      [65, 1],
      [64, 1],
      [69, 2],
    ],
  },
  {
    name: "階段",
    notes: [
      [60, 1],
      [62, 1],
      [64, 1],
      [65, 1],
      [67, 2],
    ],
  },
  {
    name: "ゆれる",
    notes: [
      [69, 2],
      [65, 1],
      [69, 1],
      [62, 2],
      [71, 1],
    ],
  },
  {
    name: "問いかけ",
    notes: [
      [64, 1],
      [71, 2],
      [67, 1],
      [62, 1],
    ],
  },
  {
    name: "ひと休み",
    notes: [
      [65, 2],
      [62, 2],
      [60, 1],
    ],
  },
].map((p) => ({
  ...p,
  notes: p.notes.map(([pitch, duration]) => ({ pitch, duration })),
}));
export function validateDraft(notes) {
  if (
    !Array.isArray(notes) ||
    notes.length > 5 ||
    notes.some(
      (n) => !n || !PITCHES.includes(n.pitch) || ![1, 2].includes(n.duration),
    )
  )
    throw Error("お手本はド〜シの3〜5音、長さは短い・長いから選んでください");
  return notes.map(({ pitch, duration }) => ({ pitch, duration }));
}
export function validateMelody(notes) {
  const valid = validateDraft(notes);
  if (valid.length < 3) throw Error("お手本は3〜5音にしてください");
  return valid;
}
export function noteEvents(notes) {
  let beat = 0;
  return notes.map((n) => {
    const e = {
      ...n,
      beat,
      duration: n.duration * 0.85,
      velocity: 85,
      group: 0,
    };
    beat += n.duration;
    return e;
  });
}
export function scoreMelody(expected, actual) {
  const count = Math.max(expected.length, actual.length);
  let pitch = 0,
    rhythm = 0,
    both = 0;
  for (let i = 0; i < count; i++) {
    const a = expected[i],
      b = actual[i];
    if (a && b) {
      pitch += a.pitch === b.pitch;
      rhythm += a.duration === b.duration;
      both += a.pitch === b.pitch && a.duration === b.duration;
    }
  }
  return {
    pitch: Math.round((100 * pitch) / count),
    rhythm: Math.round((100 * rhythm) / count),
    both: Math.round((100 * both) / count),
  };
}
export function channelsFor(neurons) {
  // JOという注釈を持つ細胞を7群へ等分。音階への割当はアプリ独自。
  const channels = PITCHES.map(() => []),
    excluded = new Set();
  neurons.forEach((r, i) => {
    if (String(r[1]).startsWith("JO-")) excluded.add(i);
  });
  [...excluded].forEach((i, k) => channels[k % 7].push(i));
  if (channels.some((c) => !c.length))
    throw Error("音符入力用のJO神経がありません");
  return { channels, excluded };
}
export function featuresOf(brain, excluded, counts) {
  const features = new Float64Array(192),
    sizes = new Uint32Array(64);
  for (let i = 0; i < brain.n; i++) {
    if (excluded.has(i)) continue;
    const bucket = (Math.imul(i + 1, 2654435761) >>> 0) % 64;
    sizes[bucket]++;
    features[bucket] += Math.tanh((brain.v[i] + 52) / 10);
    features[bucket + 64] += Math.tanh(brain.g[i] / 20);
    features[bucket + 128] += Math.log1p(counts[i]);
  }
  for (let k = 0; k < 192; k++) features[k] /= Math.max(1, sizes[k % 64]);
  return Array.from(features);
}
export function capture(
  brain,
  inputs,
  notes,
  { seed = 1, propagation = true, resetAfter = false } = {},
  progress = () => {},
) {
  validateMelody(notes);
  if (!Number.isInteger(seed) || seed < 1 || seed > 999999)
    throw Error("乱数シードが範囲外です");
  brain.seed = seed;
  brain.reset();
  const rates = new Float32Array(brain.n),
    trace = [];
  for (const note of notes) {
    rates.fill(0);
    for (const i of inputs.channels[PITCHES.indexOf(note.pitch)])
      rates[i] = 220;
    const r = brain.batch(150 * note.duration, rates, !propagation);
    trace.push({ phase: "listen", spikes: r.total, tick: r.tick });
    progress(trace.at(-1));
    rates.fill(0);
    brain.batch(30, rates, !propagation);
  }
  rates.fill(0);
  if (resetAfter) brain.reset();
  const tail = brain.batch(200, rates, !propagation);
  trace.push({ phase: "silent", spikes: tail.total, tick: tail.tick });
  progress(trace.at(-1));
  return {
    features: featuresOf(brain, inputs.excluded, tail.counts),
    trace,
    seed,
    propagation,
    resetAfter,
    neurons: brain.n,
    edges: brain.graph.sources.length,
  };
}
const OUT = 50;
function target(notes) {
  const y = new Array(OUT).fill(0);
  for (let slot = 0; slot < 5; slot++) {
    const n = notes[slot];
    y[slot * 10 + (n ? PITCHES.indexOf(n.pitch) + 1 : 0)] = 1;
    if (n) y[slot * 10 + 8 + n.duration - 1] = 1;
  }
  return y;
}
// 小さな正則化付き線形回帰。二重形式で学習し、推論用の係数へ変換する。
export function trainReadout(samples) {
  if (samples.length < 2 || samples.length > 24)
    throw Error("学習例は2〜24個必要です");
  samples.forEach((s) => {
    validateMelody(s.notes);
    checkFeatures(s.features);
  });
  const dim = 192,
    n = samples.length;
  const mean = Array.from(
    { length: dim },
    (_, j) => samples.reduce((a, s) => a + s.features[j], 0) / n,
  );
  const scale = mean.map((m, j) =>
    Math.max(
      0.00001,
      Math.sqrt(samples.reduce((a, s) => a + (s.features[j] - m) ** 2, 0) / n),
    ),
  );
  const x = samples.map((s) =>
    s.features.map((v, j) => (v - mean[j]) / scale[j]).concat(1),
  );
  const a = x.map((r, i) =>
    x
      .map(
        (q, k) =>
          r.reduce((sum, v, j) => sum + v * q[j], 0) + (i === k ? 1 : 0),
      )
      .concat(target(samples[i].notes)),
  );
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++)
      if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    const d = a[k][k];
    if (Math.abs(d) < 1e-12) throw Error("学習の計算が不安定です");
    for (let j = k; j < n + OUT; j++) a[k][j] /= d;
    for (let i = 0; i < n; i++)
      if (i !== k) {
        const f = a[i][k];
        for (let j = k; j < n + OUT; j++) a[i][j] -= f * a[k][j];
      }
  }
  const weights = Array.from({ length: dim + 1 }, (_, j) =>
    Array.from({ length: OUT }, (_, o) =>
      x.reduce((sum, r, i) => sum + r[j] * a[i][n + o], 0),
    ),
  );
  return { version: VERSION, mean, scale, weights };
}
function checkFeatures(f) {
  if (
    !Array.isArray(f) ||
    f.length !== 192 ||
    f.some((v) => !Number.isFinite(v) || Math.abs(v) > 100)
  )
    throw Error("神経特徴量が不正です");
}
export function validateReadout(m) {
  if (!m || m.version !== VERSION) throw Error("学習データの版が異なります");
  checkFeatures(m.mean);
  if (
    !Array.isArray(m.scale) ||
    m.scale.length !== 192 ||
    m.scale.some((v) => !Number.isFinite(v) || v <= 0 || v > 100)
  )
    throw Error("学習データのスケールが不正です");
  if (
    !Array.isArray(m.weights) ||
    m.weights.length !== 193 ||
    m.weights.some(
      (r) =>
        !Array.isArray(r) ||
        r.length !== OUT ||
        r.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e6),
    )
  )
    throw Error("学習データの係数が不正です");
  return m;
}
export function decode(model, features) {
  checkFeatures(features);
  // 状態が空なら、バイアスから曲を捏造せず無音を返す。
  if (!model || features.every((v) => v === 0)) return [];
  validateReadout(model);
  const x = features
    .map((v, j) => (v - model.mean[j]) / model.scale[j])
    .concat(1);
  const y = Array.from({ length: OUT }, (_, o) =>
    x.reduce((s, v, j) => s + v * model.weights[j][o], 0),
  );
  const notes = [];
  for (let slot = 0; slot < 5; slot++) {
    let best = 0;
    for (let c = 1; c < 8; c++)
      if (y[slot * 10 + c] > y[slot * 10 + best]) best = c;
    if (best === 0) break;
    notes.push({
      pitch: PITCHES[best - 1],
      duration: y[slot * 10 + 9] > y[slot * 10 + 8] ? 2 : 1,
    });
  }
  return notes;
}
