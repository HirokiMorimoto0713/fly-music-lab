import { DATA_REVISION } from "./experiment.js";
import { COMMANDS, parseMessage, TALK_VERSION } from "./talk-model.js";
import { ReactionView } from "./reaction.js";
const $ = (id) => document.getElementById(id);
let worker = null,
  pending = null,
  busy = false,
  loaded = false,
  stop = false,
  fly = null,
  records = [],
  current = [],
  last = null,
  config = null,
  sessionCount = 0;
const reaction = new ReactionView($("reaction-map"), {
  labelFrame: (f) => `${f.step}区間目 / ${f.output.text}`,
  phaseName: "視覚入力",
  emptyText: "話しかけると、反応がここに現れます",
});
window.talkDiagnostics = { busy: false, loaded: false, records };
function sync() {
  const changed =
    loaded &&
    (Number($("seed").value) !== config.seed ||
      $("propagation").checked !== config.propagation);
  for (const id of ["send", "message", "seed", "propagation", "reset"])
    $(id).disabled = busy;
  $("send").disabled = busy || changed || records.length >= 40;
  for (const b of document.querySelectorAll("[data-command]"))
    b.disabled = $("send").disabled;
  $("pause").disabled = !busy;
  $("export").disabled = busy || !records.length;
  Object.assign(window.talkDiagnostics, {
    busy,
    loaded,
    records,
    last,
    config,
  });
  if (records.length >= 40)
    $("status").textContent =
      "40回分を記録しました。保存してから新しいセッションを始めてください";
  if (changed)
    $("status").textContent =
      "条件を変更しました。「新しいセッション」で適用してください";
}
function error(text = "") {
  $("error").textContent = text;
  $("error").hidden = !text;
}
function add(role, text, detail) {
  const a = document.createElement("article");
  a.className = role;
  const label = document.createElement("strong"),
    p = document.createElement("p"),
    small = document.createElement("p");
  label.textContent = role === "user" ? "あなた" : "ハエさん / 出力の字幕";
  p.className = "utterance";
  p.textContent = text;
  small.textContent = detail;
  a.append(label, p, small);
  $("messages").append(a);
  $("messages").scrollTop = $("messages").scrollHeight;
}
function arena(frame) {
  const c = $("arena").getContext("2d");
  c.setTransform(2, 0, 0, 2, 0, 0);
  c.fillStyle = "#fbfaf5";
  c.fillRect(0, 0, 256, 256);
  const p = frame?.pose || { x: 128, y: 188, heading: 0 };
  if (frame?.target) {
    c.fillStyle = "#b84326";
    c.beginPath();
    c.arc(frame.target.x, frame.target.y, 5, 0, Math.PI * 2);
    c.fill();
  }
  c.save();
  c.translate(p.x, p.y);
  c.rotate(p.heading);
  c.strokeStyle = "#486951";
  c.lineWidth = 1.2;
  for (let y = -4; y <= 4; y += 4) {
    c.beginPath();
    c.moveTo(-4, y);
    c.lineTo(-9, y + 3);
    c.moveTo(4, y);
    c.lineTo(9, y + 3);
    c.stroke();
  }
  c.fillStyle = "#486951";
  c.beginPath();
  c.ellipse(0, 0, 4, 7, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#b84326";
  c.beginPath();
  c.arc(0, -7, 3, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
function show(frame) {
  const o = frame.output;
  last = frame;
  $("subtitle").textContent = o.text;
  $("basis").textContent = `${o.basis} · 直近${frame.windowMs} ms`;
  ["left-rate", "right-rate", "forward-rate"].forEach(
    (id, i) => ($(id).textContent = `${frame.motor[i].toFixed(1)} Hz`),
  );
  arena(frame);
  if (fly && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    fly.angle = -0.35 + frame.pose.heading;
    fly.fly.position.x = (frame.pose.x - 128) / 180;
    fly.fly.position.z = (frame.pose.y - 188) / 180;
    fly.draw();
  }
  window.talkDiagnostics.last = frame;
}
$("reaction-frame").addEventListener("change", () => {
  const f = reaction.frames[Number($("reaction-frame").value)];
  if (f) show(f);
});
function dispose() {
  worker?.terminate();
  worker = null;
  loaded = false;
  if (pending) {
    pending.reject(Error("cancelled"));
    pending = null;
  }
}
function rpc(data) {
  if (!worker) {
    worker = new Worker(new URL("./talk-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data: d }) => {
      if (d.type === "progress") {
        $("status").textContent = d.text;
        return;
      }
      if (d.type === "ready") {
        loaded = true;
        reaction.setAnatomy(d.anatomy);
        $("network").textContent =
          `${d.n.toLocaleString()}神経 / ${d.edges.toLocaleString()}接続 · DNa02左右とDNp09を読出し`;
        window.talkDiagnostics.network = d;
      }
      const p = pending;
      pending = null;
      if (d.type === "error") {
        worker.terminate();
        worker = null;
        loaded = false;
        p?.reject(Error(d.text));
      } else p?.resolve(d);
    };
    worker.onerror = () => {
      const p = pending;
      pending = null;
      dispose();
      p?.reject(
        Error("計算が停止しました。もう一度送信すると新しく読み込みます"),
      );
    };
  }
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    worker.postMessage(data);
  });
}
async function send(text) {
  if (busy) return;
  let command;
  try {
    command = parseMessage(text);
  } catch (e) {
    error(e.message);
    return;
  }
  busy = true;
  stop = false;
  error();
  sync();
  let record = null;
  try {
    if (!loaded) {
      const seed = Number($("seed").value);
      if (!Number.isInteger(seed) || seed < 1 || seed > 999999)
        throw Error("シードは1〜999999の整数にしてください");
      config = { seed, propagation: $("propagation").checked };
      await rpc({ type: "load", ...config });
      sessionCount++;
    }
    if (stop) return;
    $("messages").querySelector(".welcome")?.remove();
    add("user", text, COMMANDS[command].explanation);
    record = {
      session: sessionCount,
      text,
      command,
      config: { ...config },
      frames: [],
      complete: false,
    };
    records.push(record);
    current = record.frames;
    reaction.start(
      `やり取り${records.length} / ${COMMANDS[command].explanation}`,
    );
    $("conversion").textContent =
      `入力の変換: ${COMMANDS[command].explanation}`;
    let previous = null;
    for (let i = 0; i < 16 && !stop; i++) {
      const d = await rpc({ type: "frame", ...(i === 0 ? { command } : {}) });
      current.push(d.frame);
      show(d.frame);
      reaction.add(d.frame);
      if (d.frame.output.key !== previous) {
        add(
          "fly",
          d.frame.output.text,
          `${d.frame.output.basis} · 神経時間${d.frame.tick / 10} ms / 平均${d.frame.windowMs} ms`,
        );
        previous = d.frame.output.key;
      }
      $("status").textContent = `反応を観測中 ${i + 1} / 16区間`;
      await new Promise((r) => setTimeout(r, 80));
    }
    record.complete = current.length === 16;
    $("status").textContent = stop
      ? "ここで計算を休止しました。次の送信で同じ状態から続きます"
      : "次の言葉を待っています。脳の状態はこのセッション内で保持します";
    $("message").value = "";
  } catch (e) {
    error(
      e.message === "cancelled"
        ? "読み込みを中断しました。次の送信で読み直します"
        : e.message,
    );
    if (record) record.interrupted = true;
  } finally {
    busy = false;
    sync();
  }
}
$("send-form").onsubmit = (e) => {
  e.preventDefault();
  if (!$("send").disabled) send($("message").value);
};
for (const b of document.querySelectorAll("[data-command]"))
  b.onclick = () => send(COMMANDS[b.dataset.command].text);
$("pause").onclick = () => {
  stop = true;
  if (!loaded) dispose();
};
function reset() {
  if (busy) return;
  dispose();
  records = [];
  current = [];
  last = null;
  config = null;
  reaction.start("新しいセッション");
  $("messages").replaceChildren();
  $("subtitle").textContent = "……";
  $("basis").textContent = "次の送信で新しい脳の計算を始めます";
  $("status").textContent =
    "新しいセッション。過去の神経状態と会話記録をリセットしました";
  for (const id of ["left-rate", "right-rate", "forward-rate"])
    $(id).textContent = "—";
  arena(null);
  error();
  sync();
}
$("reset").onclick = reset;
$("seed").onchange = $("propagation").onchange = sync;
$("export").onclick = () => {
  const blob = new Blob(
      [
        JSON.stringify(
          {
            version: TALK_VERSION,
            dataset: DATA_REVISION,
            outputPools: window.talkDiagnostics.network?.pools,
            records,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    u = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = u;
  a.download = "fly-conversation.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
};
import("./fly3d.js")
  .then(({ HeadphoneFly }) => {
    fly = new HeadphoneFly($("fly3d"));
    $("three-status").textContent = "ドラッグで回転できます";
    window.talkDiagnostics.three = true;
  })
  .catch(() => {
    $("three-status").textContent =
      "3Dを表示できません。会話と位置の図は使えます";
    window.talkDiagnostics.three = false;
  });
$("angle").oninput = () => {
  if (fly) {
    fly.angle = (Number($("angle").value) * Math.PI) / 180;
    fly.draw();
  }
};
window.addEventListener("pagehide", () => worker?.terminate());
arena(null);
sync();
