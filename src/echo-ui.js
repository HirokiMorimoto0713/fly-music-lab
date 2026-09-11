import { AudioEngine, voice, midiBytes, renderWav } from "./audio.js";
import {
  VERSION,
  PRESETS,
  PITCHES,
  NAMES,
  validateDraft,
  validateMelody,
  noteEvents,
  scoreMelody,
  trainReadout,
  decode,
} from "./echo-model.js";
const $ = (id) => document.getElementById(id),
  audio = new AudioEngine(),
  KEY = "fly-music-echo-v1";
let melody = structuredClone(PRESETS[0].notes),
  samples = [],
  model = null,
  result = null,
  comparisons = [],
  busy = false,
  generation = 0,
  worker = null,
  pending = null,
  seq = 0,
  fly = null,
  playing = null;
window.echoDiagnostics = { version: VERSION };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const setStatus = (t) => ($("lesson-status").textContent = t);
function showError(e) {
  $("error").hidden = false;
  $("error").textContent = e.message || String(e);
}
function validBpm() {
  const n = Number($("tempo").value);
  if (!Number.isInteger(n) || n < 60 || n > 160)
    throw Error("テンポは60〜160 BPMにしてください");
  return n;
}
function validSeed() {
  const n = Number($("test-seed").value);
  if (!Number.isInteger(n) || n < 1 || n > 999999)
    throw Error("乱数シードは1〜999999にしてください");
  return n;
}
function sync() {
  for (const id of [
    "train",
    "listen",
    "clear",
    "undo",
    "preset",
    "tempo",
    "test-seed",
    "audible",
    "forget",
    "import-notebook",
  ])
    $(id).disabled = busy;
  for (const el of document.querySelectorAll("#keyboard button,#editor button"))
    el.disabled = busy || (el.dataset.pitch && melody.length >= 5);
  $("train").disabled = busy || melody.length < 3;
  $("listen").disabled = busy || !melody.length;
  $("undo").disabled = busy || !melody.length;
  $("answer").disabled = busy || !model || melody.length < 3;
  $("compare").disabled = busy || !model || melody.length < 3;
  $("cancel").disabled = !busy && !playing;
  for (const id of ["export-midi", "export-wav", "replay-answer"])
    $(id).disabled = busy || !result?.reply.length;
  $("export-json").disabled = busy || !result;
  $("save-notebook").disabled = busy || !model;
  document
    .querySelectorAll("[data-control-play]")
    .forEach(
      (b) =>
        (b.disabled =
          busy || !comparisons[Number(b.dataset.controlPlay)]?.reply.length),
    );
  $("learned").textContent = model
    ? `${samples.length}曲で読み出し器を学習済み · 練習シード1 · ハエの配線は固定`
    : "読み出し器は未学習です。先に練習してください。";
  window.echoDiagnostics = {
    ...window.echoDiagnostics,
    busy,
    samples: samples.length,
    result,
    comparisons,
  };
}
function drawScore(id, notes, reference) {
  const el = $(id);
  el.replaceChildren();
  if (!notes.length) {
    el.textContent = "返事は無音でした";
    return;
  }
  notes.forEach((n, i) => {
    const b = document.createElement("span");
    b.className =
      "score-note" +
      (n.duration === 2 ? " long" : "") +
      (reference && (!reference[i] || !same(n, reference[i])) ? " wrong" : "");
    b.textContent = NAMES[PITCHES.indexOf(n.pitch)];
    const small = document.createElement("small");
    small.textContent = n.duration === 2 ? "長い" : "短い";
    b.append(small);
    el.append(b);
  });
}
function renderEditor() {
  $("editor").replaceChildren();
  melody.forEach((n, i) => {
    const b = document.createElement("button");
    b.textContent = NAMES[PITCHES.indexOf(n.pitch)];
    const s = document.createElement("small");
    s.textContent = n.duration === 2 ? "長い" : "短い";
    b.append(s);
    b.setAttribute(
      "aria-label",
      `${i + 1}音目 ${b.textContent}。押すと長さを変更`,
    );
    b.onclick = () => {
      n.duration = n.duration === 1 ? 2 : 1;
      edit();
    };
    $("editor").append(b);
  });
  if (!melody.length)
    $("editor").textContent = "鍵盤で最初の音を選んでください";
  $("length").textContent = `${melody.length} / 5音`;
  drawScore("target-score", melody);
  sync();
}
function edit() {
  result = null;
  comparisons = [];
  $("metrics").replaceChildren();
  $("reply-score").textContent =
    "このお手本で「歌い返してもらう」を押してください";
  $("test-kind").textContent = "お手本を変更しました";
  $("controls-results").innerHTML =
    '<tr><td colspan="4">新しいお手本ではまだ比較していません</td></tr>';
  renderEditor();
  save();
}
function save() {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: VERSION, samples, melody }),
    );
    $("storage-status").textContent = "このブラウザに保存しました";
  } catch {
    $("storage-status").textContent =
      "ブラウザ保存が使えません。ノートを書き出して残してください";
  }
}
function notebook(raw) {
  if (
    !raw ||
    raw.version !== VERSION ||
    !Array.isArray(raw.samples) ||
    raw.samples.length < 2 ||
    raw.samples.length > 24
  )
    throw Error("このアプリの学習ノートではありません");
  const notes = validateDraft(raw.melody);
  const clean = raw.samples.map((s) => ({
    notes: validateMelody(s.notes),
    features: s.features,
  }));
  return { notes, clean, model: trainReadout(clean) };
}
try {
  const raw = JSON.parse(localStorage.getItem(KEY) || "null");
  if (raw?.samples?.length) {
    const n = notebook(raw);
    melody = n.notes;
    samples = n.clean;
    model = n.model;
    $("storage-status").textContent = "前回の学習ノートを読み込みました";
  } else if (raw?.melody) {
    if (
      Array.isArray(raw.melody) &&
      raw.melody.length <= 5 &&
      raw.melody.every(
        (n) => PITCHES.includes(n.pitch) && [1, 2].includes(n.duration),
      )
    )
      melody = raw.melody;
  }
} catch {
  $("storage-status").textContent =
    "前回の保存を読み込めませんでした。新しく練習するか、ノートを読み込んでください";
}
PITCHES.forEach((pitch, i) => {
  const b = document.createElement("button");
  b.textContent = NAMES[i];
  b.dataset.pitch = pitch;
  b.onclick = () => {
    if (melody.length < 5) {
      melody.push({ pitch, duration: 1 });
      edit();
      run(() => play([{ pitch, duration: 1 }], "listen", 100));
    }
  };
  $("keyboard").append(b);
});
PRESETS.forEach((p, i) => {
  const o = document.createElement("option");
  o.value = i;
  o.textContent = p.name;
  $("preset").append(o);
});
$("preset").onchange = () => {
  melody = structuredClone(PRESETS[Number($("preset").value)].notes);
  edit();
};
$("undo").onclick = () => {
  melody.pop();
  edit();
};
$("clear").onclick = () => {
  melody = [];
  edit();
};
$("volume").oninput = () => audio.setVolume(Number($("volume").value) / 100);
function stopPlayback() {
  if (playing) {
    clearInterval(playing.interval);
    clearTimeout(playing.timer);
    playing.resolve();
    playing = null;
  }
  audio.stop();
  fly?.set("idle");
  $("fly-state").textContent = "お手本を待っています";
  document
    .querySelectorAll(".current")
    .forEach((n) => n.classList.remove("current"));
}
async function play(notes, mode, bpm) {
  const token = generation;
  stopPlayback();
  await audio.unlock();
  if (token !== generation) return;
  audio.setVolume(Number($("volume").value) / 100);
  if (!notes.length) return;
  const events = noteEvents(notes),
    step = 60 / bpm / 2,
    start = audio.context.currentTime + 0.04;
  for (const n of events) {
    const node = voice(
      audio.context,
      audio.gain,
      n,
      start + n.beat * step,
      step,
    );
    audio.nodes.push(node);
  }
  $("fly-state").textContent =
    mode === "answer" ? "歌い返しています" : "お手本を聴いています";
  const duration =
    (notes.reduce((s, n) => s + n.duration, 0) * step + 0.12) * 1000;
  await new Promise((resolve) => {
    const interval = setInterval(() => {
      const elapsed = audio.context.currentTime - start;
      const i = events.findIndex(
        (n) =>
          elapsed >= n.beat * step && elapsed < (n.beat + n.duration) * step,
      );
      fly?.set(mode, $("quiet-motion").checked ? 0 : i >= 0 ? 0.85 : 0);
      const id = mode === "answer" ? "reply-score" : "target-score";
      document
        .querySelectorAll("#" + id + " .score-note")
        .forEach((n, k) => n.classList.toggle("current", k === i));
    }, 35);
    const timer = setTimeout(() => {
      stopPlayback();
      sync();
    }, duration);
    playing = { interval, timer, resolve };
    sync();
  });
}
function terminate() {
  worker?.terminate();
  worker = null;
  if (pending) {
    clearTimeout(pending.timer);
    pending.reject(Error("中断しました"));
    pending = null;
  }
}
function rpc(notes, options) {
  if (!worker) {
    worker = new Worker(new URL("./echo-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data: d }) => {
      if (d.type === "progress") setStatus(d.text);
      if (d.type === "loaded") {
        window.echoDiagnostics = {
          ...window.echoDiagnostics,
          n: d.n,
          edges: d.edges,
          channels: d.channels,
        };
      }
      if (d.type === "trace") {
        $("spikes").textContent = d.frame.spikes.toLocaleString() + " spikes";
        $("neural-phase").textContent =
          d.frame.phase === "silent"
            ? "入力停止後の20 ms"
            : "音符を刺激へ変換して計算";
      }
      if (
        pending &&
        d.id === pending.id &&
        (d.type === "result" || d.type === "error")
      ) {
        const p = pending;
        clearTimeout(p.timer);
        pending = null;
        d.type === "error" ? p.reject(Error(d.text)) : p.resolve(d.result);
      }
    };
    worker.onerror = () => {
      terminate();
      showError(Error("神経計算が停止しました。もう一度実行してください"));
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      terminate();
      showError(Error("計算が時間内に終わりませんでした。再実行してください"));
    }, 180000);
    pending = { id, resolve, reject, timer };
    worker.postMessage({ id, notes, options });
  });
}
async function run(task) {
  if (busy) return;
  const token = ++generation;
  busy = true;
  $("error").hidden = true;
  sync();
  const check = () => {
    if (token !== generation) throw Error("中断しました");
  };
  try {
    await task(check);
  } catch (e) {
    if (token === generation) {
      drawScore("target-score", result?.target || melody);
      showError(e);
    }
  } finally {
    if (token === generation) {
      busy = false;
      stopPlayback();
      sync();
    }
  }
}
$("cancel").onclick = () => {
  generation++;
  terminate();
  stopPlayback();
  busy = false;
  drawScore("target-score", result?.target || melody);
  setStatus("中断しました。完了済みの学習は残っています");
  sync();
};
$("listen").onclick = () => run(() => play(melody, "listen", validBpm()));
$("train").onclick = () =>
  run(async (check) => {
    const current = validateMelody(melody),
      bpm = validBpm();
    // 途中の中断では既存の学習を上書きしない。
    const training = samples.length
      ? samples.map((s) => s.notes)
      : PRESETS.map((p) => p.notes);
    if (!training.some((n) => same(n, current))) training.push(current);
    if (training.length > 24)
      throw Error("最大24曲です。ノートを保存してから学習を消去してください");
    const next = [];
    for (let i = 0; i < training.length; i++) {
      check();
      setStatus(
        `練習 ${i + 1} / ${training.length}曲 — 聴いたあとに残る状態を計算中`,
      );
      drawScore("target-score", training[i]);
      const sound = $("audible").checked
        ? play(training[i], "listen", bpm)
        : Promise.resolve();
      const [r] = await Promise.all([rpc(training[i], { seed: 1 }), sound]);
      check();
      next.push({ notes: structuredClone(training[i]), features: r.features });
    }
    check();
    const learned = trainReadout(next);
    model = learned;
    samples = next;
    result = null;
    comparisons = [];
    drawScore("target-score", melody);
    $("reply-score").textContent =
      "学習できました。「歌い返してもらう」で試しましょう";
    $("metrics").replaceChildren();
    $("test-kind").textContent = "新しい読み出し器で返事を試してください";
    $("controls-results").innerHTML =
      '<tr><td colspan="4">学習後の比較はまだありません</td></tr>';
    save();
    setStatus(
      "練習が終わりました。まずシード1で復習、そのあとシード2で試してみましょう",
    );
  });
function display(r) {
  result = r;
  drawScore("target-score", r.target);
  drawScore("reply-score", r.reply, r.target);
  $("test-kind").textContent = r.kind;
  $("metrics").replaceChildren();
  for (const [key, label] of [
    ["pitch", "音程の一致"],
    ["rhythm", "長さの一致"],
    ["both", "両方の一致"],
  ]) {
    const box = document.createElement("div"),
      n = document.createElement("strong");
    n.textContent = r.score[key] + "%";
    box.append(n, label);
    $("metrics").append(box);
  }
  sync();
}
async function evaluate(notes, options) {
  const r = await rpc(notes, options);
  const reply = decode(model, r.features);
  return {
    ...r,
    target: structuredClone(notes),
    reply,
    score: scoreMelody(notes, reply),
    bpm: validBpm(),
    kind:
      (samples.some((s) => same(s.notes, notes))
        ? options.seed === 1
          ? "復習（練習と同じ条件）"
          : "練習済みの曲・別の乱数"
        : "未学習の曲") + ` / シード${options.seed}`,
    readout: structuredClone(model),
  };
}
$("answer").onclick = () =>
  run(async (check) => {
    const notes = validateMelody(melody),
      seed = validSeed(),
      bpm = validBpm();
    setStatus("お手本を入力して、そのあとの神経状態から返事を推定します");
    const [r] = await Promise.all([
      evaluate(notes, { seed }),
      play(notes, "listen", bpm),
    ]);
    check();
    display(r);
    setStatus(
      r.reply.length
        ? "入力を止めたあとの状態から推定した返事です"
        : "返事は無音でした。お手本や条件を変えて試してください",
    );
    await play(r.reply, "answer", bpm);
    check();
  });
$("replay-answer").onclick = () =>
  run(() => play(result.reply, "answer", result.bpm));
$("compare").onclick = () =>
  run(async (check) => {
    const notes = validateMelody(melody),
      seed = validSeed();
    validBpm();
    const rows = [];
    for (const [label, options] of [
      ["通常", { seed }],
      ["伝播なし", { seed, propagation: false }],
      ["聴いたあとにリセット", { seed, resetAfter: true }],
    ]) {
      check();
      setStatus(`${label}を計算中`);
      const r = await evaluate(notes, options);
      check();
      rows.push({ ...r, label });
    }
    comparisons = rows;
    $("controls-results").replaceChildren();
    rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      for (const t of [r.label, r.score.pitch + "%", r.score.rhythm + "%"]) {
        const td = document.createElement("td");
        td.textContent = t;
        tr.append(td);
      }
      const td = document.createElement("td"),
        b = document.createElement("button");
      b.textContent = r.reply.length ? "返事を聴く" : "無音";
      b.dataset.controlPlay = i;
      b.onclick = () =>
        run(async () => {
          display(r);
          await play(r.reply, "answer", r.bpm);
        });
      td.append(b);
      tr.append(td);
      $("controls-results").append(tr);
    });
    display(rows[0]);
    setStatus(
      "3条件を比較しました。同じ読み出し器で推定しています。通常の結果が必ず良くなるとは限りません",
    );
  });
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("export-midi").onclick = () =>
  download(
    midiBytes(noteEvents(result.reply), result.bpm),
    "fly-echo.mid",
    "audio/midi",
  );
$("export-wav").onclick = () =>
  run(async () => {
    download(
      await renderWav(noteEvents(result.reply), result.bpm),
      "fly-echo.wav",
      "audio/wav",
    );
  });
$("export-json").onclick = () =>
  download(
    JSON.stringify(
      {
        version: VERSION,
        result,
        comparisons,
        training: samples,
        limitations:
          "Fixed connectome; trained external linear readout. Not evidence of musical understanding.",
      },
      null,
      2,
    ),
    "fly-echo-experiment.json",
    "application/json",
  );
$("save-notebook").onclick = () =>
  download(
    JSON.stringify({ version: VERSION, samples, melody }, null, 2),
    "fly-echo-notebook.json",
    "application/json",
  );
$("import-notebook").onchange = () =>
  run(async () => {
    const f = $("import-notebook").files[0];
    if (!f) return;
    if (f.size > 2000000) throw Error("ノートは2 MB以下にしてください");
    const n = notebook(JSON.parse(await f.text()));
    melody = n.notes;
    samples = n.clean;
    model = n.model;
    edit();
    setStatus("学習ノートを読み込みました。歌い返してもらえます");
    $("import-notebook").value = "";
  });
$("forget").onclick = () => {
  samples = [];
  model = null;
  edit();
  save();
  setStatus("学習を消去しました。お手本を選んで練習をはじめてください");
};
$("angle").oninput = () => {
  if (fly) {
    fly.angle = (Number($("angle").value) * Math.PI) / 180;
    fly.draw();
  }
};
$("quiet-motion").onchange = () => {
  if ($("quiet-motion").checked) fly?.set("idle");
};
import("./fly3d.js")
  .then(({ HeadphoneFly }) => {
    fly = new HeadphoneFly($("fly3d"));
    $("three-status").textContent = "ドラッグで回転";
    window.echoDiagnostics.three = true;
  })
  .catch(() => {
    $("three-status").textContent =
      "3D表示が使えません。実験と音は利用できます（npm ciとWebGL2を確認）";
    window.echoDiagnostics.three = false;
  });
window.addEventListener("pagehide", () => {
  terminate();
  stopPlayback();
});
renderEditor();
