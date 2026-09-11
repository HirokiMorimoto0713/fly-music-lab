import {
  DEFAULT_CONFIG,
  LABELS,
  frameToNotes,
  frameToMotion,
  validateConfig,
} from "./mapping.js";
import { AudioEngine, midiBytes, renderWav } from "./audio.js";
import { experiment, validateExperiment } from "./experiment.js";
import { Visuals } from "./visuals.js";
const $ = (id) => document.getElementById(id),
  visuals = new Visuals(),
  audio = new AudioEngine();
let worker,
  ready = false,
  loading = false,
  running = false,
  busy = false,
  request = 0,
  pendingRequests = new Map(),
  runId = 0;
let config = { ...DEFAULT_CONFIG },
  notes = [],
  frames = [],
  stimuli = [],
  queue = [],
  take = null,
  totalSpikes = 0,
  saved = [];
const controls = ["scale", "bpm", "strength", "seed", "propagation"];
const STIM_NAMES = {
  vision: "両側LC9",
  left: "左LC9 + DNa02",
  right: "右LC9 + DNa02",
  flight: "両側LC4",
};
const activity = $("activity");
LABELS.forEach((label, i) => {
  const row = document.createElement("div");
  row.className = "activity-row";
  row.innerHTML = `<span>${label}</span><div class="activity-bar"><i id="bar-${i}"></i></div><span class="activity-count" id="count-${i}">0</span>`;
  activity.append(row);
});
function status(text) {
  $("status").textContent = text;
}
function error(e) {
  $("error").textContent = e.message || String(e);
  $("error").hidden = false;
}
function clearError() {
  $("error").hidden = true;
}
function sync() {
  $("start").disabled = loading || busy || running;
  $("start").innerHTML =
    (notes.length ? "新しい実験をはじめる" : "実験をはじめる") +
    ' <span aria-hidden="true">▶</span>';
  $("stop").disabled = !running && !busy;
  for (const id of controls) $(id).disabled = running || busy || loading;
  for (const b of document.querySelectorAll("[data-stim]"))
    b.disabled = !running || busy;
  for (const id of ["replay", "compare", "favorite", "json"])
    $(id).disabled = !take || running || busy || loading;
  for (const id of ["wav", "midi"])
    $(id).disabled = !notes.length || running || busy || loading;
  $("import").disabled = running || busy || loading;
  for (const b of document.querySelectorAll("[data-saved]"))
    b.disabled = running || busy || loading;
  $("status-dot").classList.toggle("live", running || busy);
  $("workspace").setAttribute("aria-busy", String(loading));
  $("status").setAttribute("aria-live", running ? "off" : "polite");
}
function readConfig() {
  return validateConfig({
    seed: Number($("seed").value),
    scale: $("scale").value,
    bpm: Number($("bpm").value),
    strength: Number($("strength").value),
    propagation: $("propagation").checked,
  });
}
function setConfig(c) {
  $("seed").value = c.seed;
  $("scale").value = c.scale;
  $("bpm").value = c.bpm;
  $("strength").value = c.strength;
  $("propagation").checked = c.propagation;
  updateLabels();
}
function updateLabels() {
  $("bpm-value").textContent = $("bpm").value + " BPM";
  $("strength-value").textContent = $("strength").value + " Hz";
}
for (const id of ["bpm", "strength"]) $(id).oninput = updateLabels;
$("volume").oninput = () => {
  const v = Number($("volume").value);
  $("volume-value").textContent = v + "%";
  audio.setVolume(v / 100);
};
async function load() {
  if (ready) return;
  loading = true;
  sync();
  clearError();
  try {
    worker?.terminate();
    worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            Error("読み込みが時間内に完了しませんでした。再度はじめてください"),
          ),
        120000,
      );
      worker.onerror = () => {
        clearTimeout(timeout);
        ready = false;
        const failure = Error("神経計算が停止しました。再度はじめてください");
        for (const pending of pendingRequests.values()) {
          clearTimeout(pending.timer);
          pending.reject(failure);
        }
        pendingRequests.clear();
        reject(failure);
      };
      worker.onmessage = ({ data: d }) => {
        if (d.type === "progress") status(d.text);
        if (d.type === "ready") {
          clearTimeout(timeout);
          ready = true;
          visuals.setAnatomy(d.anatomy);
          window.labDiagnostics = {
            n: d.n,
            edges: d.edges,
            targets: d.targets,
            groups: d.groups,
          };
          resolve();
        }
        if (d.type === "error") {
          clearTimeout(timeout);
          const p = pendingRequests.get(d.id);
          if (p) {
            pendingRequests.delete(d.id);
            clearTimeout(p.timer);
            p.reject(Error(d.text));
          } else reject(Error(d.text));
        }
        const p = pendingRequests.get(d.id);
        if (p && d.type !== "error") {
          pendingRequests.delete(d.id);
          clearTimeout(p.timer);
          p.resolve(d);
        }
      };
      worker.postMessage({ type: "load" });
    });
  } finally {
    loading = false;
    sync();
  }
}
function rpc(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++request,
      timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(Error("計算が応答しません。ページを再読み込みしてください"));
      }, 30000);
    pendingRequests.set(id, { resolve, reject, timer });
    worker.postMessage({ type, id, ...payload });
  });
}
function resetView() {
  notes = [];
  frames = [];
  totalSpikes = 0;
  visuals.reset();
  $("note-count").textContent = "0 notes";
  $("spike-total").textContent = "累計 0 spikes";
  $("neural-time").textContent = "神経時間 0 ms";
  $("neuron-list").textContent = "発火した神経を待っています";
  for (let i = 0; i < 5; i++) {
    $("bar-" + i).style.transform = "scaleX(0)";
    $("count-" + i).textContent = "0";
  }
}
function showFrame(f, index) {
  const n = frameToNotes(f, config, index);
  notes.push(...n);
  frames.push(f);
  totalSpikes += f.total;
  const motion = frameToMotion(f);
  visuals.frame(f, n, motion);
  audio.play(n, config.bpm);
  $("note-count").textContent = notes.length + " notes";
  $("spike-total").textContent =
    "累計 " + totalSpikes.toLocaleString() + " spikes";
  $("neural-time").textContent = "神経時間 " + Math.round(f.tick * 0.1) + " ms";
  $("motion-readout").textContent =
    `歩行 ${motion.speed.toFixed(2)} / 旋回 ${motion.turn.toFixed(2)}`;
  f.groups.forEach((v, i) => {
    $("bar-" + i).style.transform =
      `scaleX(${Math.min(1, Math.log10(v + 1) / 4)})`;
    $("count-" + i).textContent = v.toLocaleString();
  });
  $("neuron-list").textContent = f.top
    .slice(0, 15)
    .map((n) => `${n.id}  ${n.type || "型名なし"}  ${n.count} spikes`)
    .join("\n");
  window.labDiagnostics = {
    ...window.labDiagnostics,
    last: f,
    noteCount: notes.length,
    frames: frames.length,
    totalSpikes,
  };
}
function stop() {
  // 計算の準備中や比較中には、前の演奏の条件を書き換えない。
  const wasRunning = running;
  runId++;
  running = false;
  busy = false;
  visuals.running = false;
  audio.stop();
  if (wasRunning && frames.length)
    take = experiment(
      config,
      stimuli.filter((s) => s.frame < frames.length),
      frames.length,
    );
  status("停止中 · 演奏を保存するか、新しい条件で試せます");
  sync();
}
$("stop").onclick = stop;
async function start(replay = null) {
  if (running || busy || loading) return;
  clearError();
  const token = ++runId;
  busy = true;
  sync();
  try {
    config = replay ? validateExperiment(replay).config : readConfig();
    await audio.unlock();
    audio.setVolume(Number($("volume").value) / 100);
    await load();
    if (token !== runId) return;
    await rpc("reset", { seed: config.seed });
    if (token !== runId) return;
    resetView();
    take = null;
    stimuli = [];
    queue = [];
    busy = false;
    running = true;
    visuals.running = true;
    setConfig(config);
    sync();
    const max = replay ? replay.frames : 128;
    const planned = replay
      ? replay.stimuli
      : [{ frame: 0, target: "vision", strength: config.strength }];
    for (let i = 0; i < max && token === runId; i++) {
      const time = performance.now(),
        current = [
          ...planned.filter((s) => s.frame === i),
          ...queue.splice(0).map((s) => ({ ...s, frame: i })),
        ];
      stimuli.push(...current);
      const f = await rpc("frame", {
        stimuli: current,
        propagation: config.propagation,
      });
      if (token !== runId) break;
      showFrame(f, i);
      take = experiment(config, stimuli, i + 1);
      status(
        `${replay ? "再実行" : "演奏中"} · ${i + 1} / ${max} · 計算 ${Math.round(f.elapsed)} ms`,
      );
      await new Promise((r) =>
        setTimeout(
          r,
          Math.max(0, 30000 / config.bpm - (performance.now() - time)),
        ),
      );
    }
    if (token === runId) {
      running = false;
      visuals.running = false;
      status("演奏が終わりました · 気に入ったフレーズを持ち帰れます");
      sync();
    }
  } catch (e) {
    if (token === runId) {
      stop();
      error(e);
    }
  }
}
$("start").onclick = () => start();
$("replay").onclick = () => start(take);
function stimulate(target) {
  if (!running || busy) return;
  queue.push({ target, strength: config.strength });
  $("stimulus-info").textContent =
    `${STIM_NAMES[target]}へ ${config.strength} Hz · 次の計算から神経時間200 msの刺激`;
}
for (const b of document.querySelectorAll("[data-stim]"))
  b.onclick = () => stimulate(b.dataset.stim);
document.addEventListener("keydown", (e) => {
  if (
    ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(e.target.tagName) ||
    e.altKey ||
    e.ctrlKey ||
    e.metaKey
  )
    return;
  const target = ["vision", "left", "right", "flight"][Number(e.key) - 1];
  if (target && !e.repeat) {
    e.preventDefault();
    stimulate(target);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (running || busy)) {
    stop();
    status("別の画面へ移ったため停止しました");
  }
});
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$("midi").onclick = () =>
  download(midiBytes(notes, take.config.bpm), "fly-music.mid", "audio/midi");
$("json").onclick = () =>
  download(
    JSON.stringify(take, null, 2),
    "fly-experiment.json",
    "application/json",
  );
$("wav").onclick = async () => {
  busy = true;
  sync();
  try {
    download(
      await renderWav(notes, take.config.bpm),
      "fly-music.wav",
      "audio/wav",
    );
    $("save-status").textContent =
      "WAVを書き出しました。MIDIと同じ音符から合成しています。";
  } catch (e) {
    error(e);
  } finally {
    busy = false;
    sync();
  }
};
$("import").onchange = async (e) => {
  clearError();
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 200000) throw Error("実験ファイルが大きすぎます");
    take = validateExperiment(JSON.parse(await file.text()));
    resetView();
    setConfig(take.config);
    $("save-status").textContent =
      "実験条件を読み込みました。「同じ条件で再実行」で音と動きを再計算します。";
    status("実験を読み込みました");
    sync();
  } catch (e) {
    error(e);
  } finally {
    $("import").value = "";
  }
};
function renderSaved() {
  const host = $("saved-takes");
  host.replaceChildren();
  saved.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "saved-item";
    const label = document.createElement("span");
    label.textContent = `${item.date} · seed ${item.take.config.seed} · ${item.take.frames} steps`;
    const b = document.createElement("button");
    b.textContent = "再実行";
    b.dataset.saved = i;
    b.onclick = () => start(item.take);
    row.append(label, b);
    host.append(row);
  });
  sync();
}
try {
  saved = JSON.parse(localStorage.getItem("fly-music-takes") || "[]")
    .slice(0, 5)
    .map((item) => ({
      date: String(item.date).slice(0, 50),
      take: validateExperiment(item.take),
    }));
} catch {
  saved = [];
}
$("favorite").onclick = () => {
  try {
    const next = [
      { date: new Date().toLocaleString("ja-JP"), take: structuredClone(take) },
      ...saved,
    ].slice(0, 5);
    localStorage.setItem("fly-music-takes", JSON.stringify(next));
    saved = next;
    renderSaved();
    $("save-status").textContent =
      "このブラウザに保存しました（最新5件）。この操作では神経の接続は変わりません。";
  } catch {
    error(
      Error("ブラウザに保存できません。実験JSONをダウンロードしてください。"),
    );
  }
};
$("compare").onclick = async () => {
  if (!take) return;
  busy = true;
  const token = ++runId;
  sync();
  clearError();
  const source = structuredClone(take),
    count = Math.min(16, source.frames),
    results = [];
  try {
    await load();
    for (const propagation of [true, false]) {
      await rpc("reset", { seed: source.config.seed });
      let total = 0,
        groupCounts = [0, 0, 0, 0, 0];
      for (let i = 0; i < count; i++) {
        if (token !== runId) return;
        status(
          `比較中 · 伝播${propagation ? "あり" : "なし"} ${i + 1}/${count}`,
        );
        const f = await rpc("frame", {
          stimuli: source.stimuli.filter((s) => s.frame === i),
          propagation,
        });
        total += f.total;
        f.groups.forEach((v, j) => (groupCounts[j] += v));
      }
      results.push({ propagation, total, groups: groupCounts });
    }
    if (token !== runId) return;
    const host = $("comparison-result");
    host.replaceChildren();
    const max = Math.max(1, ...results.map((r) => r.total));
    for (const r of results) {
      const row = document.createElement("div");
      row.className = "compare-row";
      const label = document.createElement("span");
      label.textContent = "伝播" + (r.propagation ? "あり" : "なし");
      const bar = document.createElement("i");
      bar.style.width = (r.total / max) * 100 + "%";
      const value = document.createElement("span");
      value.textContent = r.total.toLocaleString() + " 発火";
      row.append(label, bar, value);
      host.append(row);
    }
    const p = document.createElement("p");
    p.className = "fine";
    p.textContent = `同じ刺激とseed ${source.config.seed} / ${count * 20} ms。差が小さい場合も結果です。学習や音楽の良さを測る比較ではありません。`;
    host.append(p);
    window.labDiagnostics.comparison = results;
    status("比較が終わりました · 演奏と書き出しデータは保持しています");
  } catch (e) {
    error(e);
  } finally {
    if (token === runId) {
      busy = false;
      sync();
    }
  }
};
renderSaved();
visuals.drawScore();
visuals.drawAnatomy();
