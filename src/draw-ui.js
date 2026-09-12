import {
  DRAW_VERSION,
  SHAPES,
  DIRECTIONS,
  validatePoints,
  rasterize,
  initialPose,
  validateDrawingNote,
} from "./draw-model.js";
import { ReactionView } from "./reaction.js";
const $ = (id) => document.getElementById(id),
  KEY = "fly-drawing-note-v1";
let points = structuredClone(SHAPES.circle.points),
  model = null,
  worker = null,
  pending = null,
  busy = false,
  result = null,
  comparisons = [],
  fly = null,
  livePath = [],
  latestFrame = null,
  pointer = null;
const reaction = new ReactionView($("reaction-map"), {
  labelFrame: (f) =>
    `${f.step}筆目 / ${f.action.down ? "ペンを下ろす" : "ペンを上げる"}`,
  phaseName: "周囲を観測",
  emptyText: "描いてもらうと、実際の反応がここに現れます",
});
window.drawDiagnostics = { busy: false, model: false };
function valid() {
  try {
    validatePoints(points);
    return true;
  } catch {
    return false;
  }
}
function sync() {
  window.drawDiagnostics = {
    ...window.drawDiagnostics,
    busy,
    model: !!model,
    result,
    comparisons,
  };
  for (const id of [
    "train",
    "shape",
    "clear",
    "seed",
    "import",
    "import-button",
  ])
    $(id).disabled = busy;
  $("draw").disabled = $("compare").disabled = busy || !model || !valid();
  $("cancel").disabled = !busy;
  $("png").disabled = $("json").disabled = busy || !result;
  $("note").disabled = busy || !model || !valid();
  $("reference").setAttribute("aria-disabled", String(busy));
  for (const button of $("comparisons").querySelectorAll("button"))
    button.disabled = busy;
  $("learned").textContent = model
    ? "読み出し器を練習済み · 脳の配線は固定"
    : "まず丸・三角・波線の局所的な見え方を練習します";
}
function save() {
  if (!model || !valid()) return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: DRAW_VERSION, model, points }),
    );
    $("storage").textContent = "このブラウザに学習とお手本を保存しました";
  } catch {
    $("storage").textContent =
      "ブラウザ保存が使えません。ノートを書き出して保存してください";
  }
}
function blank(canvas) {
  const c = canvas.getContext("2d");
  c.setTransform(2, 0, 0, 2, 0, 0);
  c.fillStyle = "#fbfaf5";
  c.fillRect(0, 0, 256, 256);
  return c;
}
function line(c, path, color, width = 1.6) {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  path.forEach((p, i) => {
    if (i && p.down) c.lineTo(p.x, p.y);
    else c.moveTo(p.x, p.y);
  });
  c.stroke();
}
function reference() {
  const c = blank($("reference"));
  line(
    c,
    points.map(([x, y], i) => ({ x, y, down: i > 0 })),
    "#7b8071",
    1.5,
  );
  if (points.length) {
    c.fillStyle = "#486951";
    c.beginPath();
    c.arc(...points[0], 3, 0, Math.PI * 2);
    c.fill();
  }
  if (latestFrame) {
    const p = latestFrame.pose;
    c.strokeStyle = "#486951";
    c.lineWidth = 0.7;
    c.strokeRect(p.x - 14, p.y - 14, 28, 28);
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(p.x + Math.cos(p.heading) * 8, p.y + Math.sin(p.heading) * 8);
    c.stroke();
  }
}
function painting(path, canvas = $("drawing"), cursor = true) {
  const c = blank(canvas);
  line(c, path, "#b84326");
  if (cursor && path.length) {
    const p = path.at(-1);
    c.fillStyle = p.down ? "#b84326" : "#486951";
    c.beginPath();
    c.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    c.fill();
  }
}
function vision(frame) {
  const c = $("vision").getContext("2d");
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = "#fbfaf5";
  c.fillRect(0, 0, 256, 256);
  if (!frame) return;
  const pose = frame.pose,
    image = rasterize(points);
  if (!frame.blind) {
    c.fillStyle = "#7b8071";
    for (let y = -14; y <= 14; y++)
      for (let x = -14; x <= 14; x++) {
        const a = Math.round(pose.x + x),
          b = Math.round(pose.y + y);
        if (a >= 0 && a < 256 && b >= 0 && b < 256 && image[b * 256 + a])
          c.fillRect(128 + x * 7, 128 + y * 7, 7, 7);
      }
  }
  DIRECTIONS.forEach(([x, y], i) => {
    c.fillStyle = `rgba(184,67,38,${0.12 + 0.88 * frame.sensors[i]})`;
    c.beginPath();
    c.arc(128 + x * 78, 128 + y * 78, 6 + frame.sensors[i] * 5, 0, Math.PI * 2);
    c.fill();
  });
  c.fillStyle = "#486951";
  c.beginPath();
  c.arc(128, 128, 4, 0, Math.PI * 2);
  c.fill();
  $("sensor-summary").textContent =
    `${frame.step}筆目 · 入力 ${frame.sensors.map((v) => v.toFixed(2)).join(" / ")}`;
}
function inspectFrame(frame, path) {
  latestFrame = frame;
  reference();
  painting(path);
  vision(frame);
  fly?.setStroke(frame.after, frame.action.down);
  $("steps").textContent = `${frame.step} / 160筆`;
}
function fresh() {
  result = null;
  comparisons = [];
  livePath = [];
  latestFrame = null;
  reaction.start("なぞり描き");
  reference();
  painting([]);
  vision(null);
  $("distance").textContent = $("coverage").textContent = "—";
  $("steps").textContent = "0 / 160筆";
  $("comparisons").replaceChildren();
  sync();
}
function display(r) {
  result = r;
  points = structuredClone(r.points);
  livePath = r.path;
  reaction.show(r.trace, r.label || "なぞり描き");
  inspectFrame(r.trace.at(-1), r.path);
  $("distance").textContent =
    r.metrics.distance === null ? "描線なし" : `${r.metrics.distance} px`;
  $("coverage").textContent = `${r.metrics.coverage}%`;
  $("artist-state").textContent = r.reason;
  for (const b of $("comparisons").querySelectorAll("button"))
    b.setAttribute(
      "aria-pressed",
      String(comparisons[Number(b.dataset.index)] === r),
    );
  sync();
}
$("reaction-frame").addEventListener("change", () => {
  const i = Number($("reaction-frame").value),
    frame = reaction.frames[i];
  if (frame) inspectFrame(frame, (result?.path || livePath).slice(0, i + 2));
});
function terminate() {
  worker?.terminate();
  worker = null;
  if (pending) {
    pending.reject(Error("cancelled"));
    pending = null;
  }
}
function rpc(type, extra = {}) {
  if (!worker) {
    worker = new Worker(new URL("./draw-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data: d }) => {
      if (d.type === "progress") $("status").textContent = d.text;
      if (d.type === "loaded") {
        reaction.setAnatomy(d.anatomy);
        Object.assign(window.drawDiagnostics, {
          neurons: d.n,
          edges: d.edges,
          channels: d.channels,
        });
      }
      if (d.type === "frame") {
        reaction.add(d.frame);
        livePath.push({ ...d.frame.after, down: d.frame.action.down });
        inspectFrame(d.frame, livePath);
        $("status").textContent =
          `周囲を観測して描画中 ${d.frame.step} / 160筆`;
        $("artist-state").textContent = d.frame.action.down
          ? "線を描いています"
          : "ペンを上げました";
      }
      if (d.type === "trained" || d.type === "result") {
        const p = pending;
        pending = null;
        p?.resolve(d);
      }
      if (d.type === "error") {
        const p = pending;
        pending = null;
        worker?.terminate();
        worker = null;
        p?.reject(Error(d.text));
      }
    };
    worker.onerror = () => {
      const p = pending;
      pending = null;
      worker?.terminate();
      worker = null;
      p?.reject(Error("計算が停止しました。再試行してください"));
    };
  }
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    worker.postMessage({ type, ...extra });
  });
}
async function run(fn) {
  if (busy) return;
  busy = true;
  $("error").textContent = "";
  sync();
  try {
    await fn();
  } catch (e) {
    if (e.message === "cancelled") {
      $("status").textContent = "中断しました。完了済みの学習は残っています";
      $("artist-state").textContent = "ひと休みしています";
    } else {
      $("error").textContent = e.message;
      $("status").textContent = "操作をやり直せます";
    }
  } finally {
    busy = false;
    sync();
  }
}
$("train").onclick = () =>
  run(async () => {
    const d = await rpc("train");
    model = d.model;
    save();
    $("status").textContent =
      `練習完了。同じ観測での方向一致 ${d.correct} / ${d.total}（未知の見え方への成績とは別です）`;
    $("artist-state").textContent = "描いてみようかな";
  });
function options(extra = {}) {
  const seed = Number($("seed").value);
  if (!Number.isInteger(seed) || seed < 1 || seed > 999999)
    throw Error("シードは1〜999999の整数にしてください");
  return { seed, propagation: true, blind: false, ...extra };
}
async function drawOne(opts, label) {
  const target = validatePoints(points);
  result = null;
  livePath = [{ ...initialPose(target), down: false }];
  latestFrame = null;
  reaction.start(label);
  painting(livePath);
  $("distance").textContent = $("coverage").textContent = "—";
  const d = await rpc("draw", { points: target, model, options: opts });
  const r = { ...d.result, label, version: DRAW_VERSION };
  display(r);
  return r;
}
$("draw").onclick = () =>
  run(async () => {
    comparisons = [];
    $("comparisons").replaceChildren();
    const r = await drawOne(options(), `通常 / シード${$("seed").value}`);
    $("status").textContent = `描画が終わりました · ${r.reason}`;
    save();
  });
$("compare").onclick = () =>
  run(async () => {
    const opts = options();
    comparisons = [];
    $("comparisons").replaceChildren();
    for (const [label, extra] of [
      ["通常", {}],
      ["伝播なし", { propagation: false }],
      ["視覚入力なし", { blind: true }],
    ]) {
      const r = await drawOne(
        { ...opts, ...extra },
        `${label} / シード${opts.seed}`,
      );
      comparisons.push(r);
    }
    renderComparisons();
    display(comparisons[0]);
    $("status").textContent =
      "3条件の計算が終わりました。結果を選ぶと線と脳の反応を見られます";
  });
function renderComparisons() {
  $("comparisons").replaceChildren();
  comparisons.forEach((r, i) => {
    const b = document.createElement("button");
    b.dataset.index = i;
    b.setAttribute("aria-pressed", "false");
    const title = document.createElement("strong"),
      text = document.createElement("span");
    title.textContent = r.label;
    text.textContent = `範囲 ${r.metrics.coverage}% · ${r.metrics.distance === null ? "描線なし" : `平均 ${r.metrics.distance} px`}`;
    b.append(title, text);
    b.onclick = () => display(r);
    $("comparisons").append(b);
  });
}
$("cancel").onclick = () => {
  terminate();
};
$("shape").onchange = () => {
  points =
    $("shape").value === "custom"
      ? []
      : structuredClone(SHAPES[$("shape").value].points);
  fresh();
  save();
  $("input-help").textContent =
    $("shape").value === "custom"
      ? "用紙の内側をドラッグして一筆の線を描いてください。矢印キーでも描画、Enterで完了。もう一度描くと置き換えます"
      : "緑の点から開始。枠は次の一筆で見る範囲です。最大160筆で終了します";
};
$("clear").onclick = () => {
  $("shape").value = "custom";
  points = [];
  fresh();
  $("input-help").textContent =
    "ドラッグして新しい一筆の線を描いてください。矢印キーでも描画できます";
};
function pos(e) {
  const r = $("reference").getBoundingClientRect();
  return [
    Math.max(8, Math.min(248, ((e.clientX - r.left) * 256) / r.width)),
    Math.max(8, Math.min(248, ((e.clientY - r.top) * 256) / r.height)),
  ];
}
$("reference").onpointerdown = (e) => {
  if (busy || $("shape").value !== "custom") return;
  pointer = e.pointerId;
  points = [pos(e)];
  fresh();
  $("reference").setPointerCapture(pointer);
};
$("reference").onpointermove = (e) => {
  if (pointer !== e.pointerId || busy) return;
  const p = pos(e);
  if (
    points.length < 1500 &&
    Math.hypot(p[0] - points.at(-1)[0], p[1] - points.at(-1)[1]) >= 1
  ) {
    points.push(p);
    reference();
  }
};
function finish() {
  pointer = null;
  sync();
  save();
}
$("reference").onpointerup = finish;
$("reference").onpointercancel = finish;
$("reference").onkeydown = (e) => {
  if (busy || $("shape").value !== "custom") return;
  const moves = {
    ArrowUp: [0, -4],
    ArrowDown: [0, 4],
    ArrowLeft: [-4, 0],
    ArrowRight: [4, 0],
  };
  if (e.key === "Enter") {
    finish();
    return;
  }
  if (!moves[e.key]) return;
  e.preventDefault();
  if (!points.length) points = [[64, 128]];
  const last = points.at(-1),
    d = moves[e.key];
  if (points.length < 1500)
    points.push(last.map((v, i) => Math.max(8, Math.min(248, v + d[i]))));
  fresh();
  save();
};
function download(data, name, type) {
  const blob = new Blob([data], { type }),
    u = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
$("png").onclick = () => {
  if (!result) return;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  painting(result.path, canvas, false);
  canvas.toBlob((b) => {
    if (b) download(b, "fly-drawing.png", "image/png");
  });
};
$("json").onclick = () =>
  download(
    JSON.stringify({ ...result, model, comparisons }, null, 2),
    "fly-drawing-experiment.json",
    "application/json",
  );
$("note").onclick = () =>
  download(
    JSON.stringify({ version: DRAW_VERSION, model, points }, null, 2),
    "fly-drawing-note.json",
    "application/json",
  );
$("import-button").onclick = () => $("import").click();
$("import").onchange = () => {
  const file = $("import").files[0];
  if (!file) return;
  run(async () => {
    try {
      if (file.size > 500000) throw Error("ノートは500 KB以下にしてください");
      const note = validateDrawingNote(JSON.parse(await file.text()));
      model = note.model;
      points = note.points;
      $("shape").value = "custom";
      fresh();
      save();
      $("status").textContent = "学習とお手本をノートから復元しました";
    } finally {
      $("import").value = "";
    }
  });
};
try {
  const stored = localStorage.getItem(KEY);
  if (stored) {
    const note = validateDrawingNote(JSON.parse(stored));
    model = note.model;
    points = note.points;
    $("shape").value = "custom";
    $("status").textContent = "前回の学習とお手本を復元しました";
  }
} catch {
  $("storage").textContent =
    "保存データを読み込めませんでした。新しく練習するかノートを読み込めます";
}
import("./fly3d.js")
  .then(({ HeadphoneFly }) => {
    fly = new HeadphoneFly($("fly3d"), { drawing: true });
    $("three-status").textContent = "ドラッグで回転できます";
    window.drawDiagnostics.three = true;
  })
  .catch(() => {
    $("three-status").textContent =
      "3Dを表示できません。お絵かきと反応図は使えます";
    window.drawDiagnostics.three = false;
  });
$("angle").oninput = () => {
  if (fly) {
    fly.angle = (Number($("angle").value) * Math.PI) / 180;
    fly.draw();
  }
};
window.addEventListener("pagehide", () => worker?.terminate());
reference();
painting([]);
vision(null);
sync();
