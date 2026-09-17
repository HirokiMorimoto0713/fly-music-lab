import { COMMANDS, MAX_TICKS, loadWalking } from "./walk-model.js";

const $ = (id) => document.getElementById(id);
let sim,
  view,
  running = false,
  busy = false,
  fault = false,
  operation = 0;
let previousWall,
  accumulator = 0,
  frames = 0,
  measuredSteps = 0,
  meterStart;
const buttons = [...document.querySelectorAll("[data-command]")];
const legs = [
  ["LF", "左前"],
  ["LM", "左中"],
  ["LH", "左後"],
  ["RF", "右前"],
  ["RM", "右中"],
  ["RH", "右後"],
];
$("playground").tabIndex = 0;
for (const [key, label] of legs) {
  const item = document.createElement("span");
  item.className = "foot";
  item.id = `foot-${key}`;
  const name = document.createElement("span");
  name.textContent = label;
  const count = document.createElement("strong");
  count.textContent = "—";
  item.append(name, count);
  $("contacts").append(item);
}

function controls() {
  const disabled = !sim || fault;
  buttons.forEach((button) => {
    button.disabled = disabled || busy;
  });
  $("run").disabled = disabled || busy || sim.tick >= MAX_TICKS;
  $("step").disabled = disabled || busy || running || sim.tick >= MAX_TICKS;
  $("reset").disabled = !sim;
  $("seed").disabled = !sim || busy || running;
  $("export").disabled = !sim;
  $("view").disabled = !view;
  $("run").textContent = running
    ? "一時停止"
    : sim?.tick
      ? "計算を再開"
      : "計算を始める";
}

function stop(message) {
  running = false;
  accumulator = 0;
  previousWall = undefined;
  if (message) $("status").textContent = message;
  controls();
}

function fail(error) {
  fault = true;
  busy = false;
  operation++;
  stop("計算を止めました");
  $("error").hidden = false;
  $("error").textContent = error.message || String(error);
}

function render() {
  if (!sim) return;
  const s = sim.snapshot();
  $("time").textContent = s.time.toFixed(3);
  $("displacement").textContent = s.displacement.toFixed(2);
  $("yaw").textContent = ((s.yaw * 180) / Math.PI).toFixed(1);
  $("height").textContent = s.position[2].toFixed(2);
  $("command").textContent =
    `${COMMANDS[s.command].label} / 左 ${s.gains[0].toFixed(1)} · 右 ${s.gains[1].toFixed(1)}`;
  buttons.forEach((button) =>
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.command === s.command),
    ),
  );
  for (const [key, label] of legs) {
    const foot = $(`foot-${key}`),
      count = s.contacts[key.toLowerCase()] ?? 0;
    foot.querySelector("strong").textContent = count;
    foot.classList.toggle("touching", count > 0);
    foot.setAttribute("aria-label", `${label}の接触 ${count}箇所`);
  }
  view?.render();
}

$("load").onclick = async () => {
  const token = ++operation;
  $("load").disabled = true;
  $("error").hidden = true;
  try {
    const { WalkingView } = await import("./walk-view.js");
    sim = await loadWalking((message) => {
      if (token === operation) $("status").textContent = message;
    });
    view = new WalkingView($("stage"), sim, () =>
      fail(Error("3D表示が失われました。ページを再読み込みしてください")),
    );
    $("welcome").hidden = true;
    fault = false;
    $("status").textContent = "前へを選び、計算を始めてください";
    controls();
    render();
  } catch (error) {
    view?.dispose();
    view = undefined;
    sim?.dispose();
    sim = undefined;
    fail(Error(`読み込みに失敗しました。再試行してください。${error.message}`));
    $("load").disabled = false;
    $("load").textContent = "読み込みを再試行";
  }
};

function command(key) {
  if (!sim || fault || busy) return;
  sim.setCommand(key);
  render();
}
buttons.forEach((button) => {
  button.onclick = () => command(button.dataset.command);
});

$("run").onclick = () => {
  if (running) return stop("物理時間を一時停止しています");
  if (!sim || fault || busy || sim.tick >= MAX_TICKS) return;
  running = true;
  previousWall = undefined;
  accumulator = 0;
  frames = measuredSteps = 0;
  meterStart = undefined;
  $("status").textContent = "計算中 · 実時間の0.1倍速を目標に再生します";
  controls();
};

// The same bounded stepping route serves the UI and exact-tick browser checks.
async function advance(ticks) {
  if (!sim || fault || running || busy)
    throw Error("計算を一時停止してから進めてください");
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 20000)
    throw Error("計測区間が不正です");
  const token = ++operation,
    target = Math.min(sim.tick + ticks, MAX_TICKS);
  busy = true;
  controls();
  try {
    while (sim.tick < target && token === operation) {
      sim.step(Math.min(60, target - sim.tick));
      if (sim.tick % 600 === 0 || sim.tick === target) render();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (token === operation)
      $("status").textContent = "指定した物理時間を進めました";
  } catch (error) {
    fail(error);
    throw error;
  } finally {
    if (token === operation) {
      busy = false;
      controls();
    }
  }
}
$("step").onclick = () => advance(1000).catch(() => {});
$("reset").onclick = () => {
  const seed = Number($("seed").value);
  if (!Number.isInteger(seed) || seed < 1 || seed > 999999) {
    $("error").hidden = false;
    $("error").textContent = "シードは1〜999999の整数で指定してください";
    return;
  }
  operation++;
  busy = false;
  running = false;
  fault = false;
  $("error").hidden = true;
  try {
    sim.reset(seed);
    stop("同じシードで初期状態へ戻しました");
    $("performance").textContent = "計算前";
    render();
  } catch (error) {
    fail(error);
  }
};
$("view").onclick = () => {
  view.top = !view.top;
  $("view").textContent = view.top ? "斜めから見る" : "真上から見る";
  render();
};
$("seed").addEventListener("input", () => {
  $("status").textContent = "シードの変更は「初めから」で反映されます";
});
$("export").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(sim.export(), null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "fly-walking.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("playground").addEventListener("keydown", (event) => {
  if (
    event.target.matches("input,select,textarea") ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.repeat
  )
    return;
  const key = event.key.toLowerCase();
  const move = { w: "forward", a: "left", d: "right", q: "stop" }[key];
  if (move) {
    event.preventDefault();
    command(move);
  }
  if (key === " " && event.target === $("playground")) {
    event.preventDefault();
    $("run").click();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseAway();
});
window.addEventListener("blur", pauseAway);
function pauseAway() {
  if (!running && !busy) return;
  operation++;
  busy = false;
  stop("画面を離れたため一時停止しました");
}

function frame(now) {
  try {
    if (running) {
      const elapsed =
        previousWall === undefined
          ? 0
          : Math.min((now - previousWall) / 1000, 0.1);
      previousWall = now;
      accumulator += elapsed * 0.1;
      const wanted = Math.floor(accumulator / sim.dt),
        count = Math.min(wanted, 60);
      accumulator = wanted > 60 ? 0 : accumulator - count * sim.dt;
      const tick = sim.tick;
      sim.step(count);
      render();
      measuredSteps += sim.tick - tick;
      frames++;
      meterStart ??= now;
      if (now - meterStart >= 750) {
        const secs = (now - meterStart) / 1000;
        $("performance").textContent =
          `${Math.round(frames / secs)} fps · ${((measuredSteps * sim.dt) / secs).toFixed(2)}倍速`;
        frames = measuredSteps = 0;
        meterStart = now;
      }
      if (sim.tick >= MAX_TICKS)
        stop("物理時間30秒で休止しました。保存するか、初めから試せます");
    }
  } catch (error) {
    fail(error);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
controls();
window.walkDiagnostics = {
  get ready() {
    return Boolean(sim && view && !fault);
  },
  get running() {
    return running;
  },
  get busy() {
    return busy;
  },
  get state() {
    return sim?.snapshot();
  },
  get result() {
    return sim?.export();
  },
  advance,
};
