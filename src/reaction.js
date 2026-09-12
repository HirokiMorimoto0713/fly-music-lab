// 表示専用の集約。神経計算や音符推定には使わない。
export function reactionSnapshot(neurons, counts, steps) {
  const cells = [];
  let active = 0,
    withoutPosition = 0,
    total = 0;
  counts.forEach((count, i) => {
    total += count;
    if (!count) return;
    active++;
    const r = neurons[i],
      p = r[6];
    if (!Array.isArray(p) || p.length < 3 || !p.every(Number.isFinite)) {
      withoutPosition++;
      return;
    }
    cells.push({
      id: r[0],
      type: r[1],
      position: p,
      count,
      rate: (count * 1000) / (steps * 0.1),
    });
  });
  cells.sort((a, b) => b.count - a.count);
  return {
    cells: cells.slice(0, 500),
    active,
    withoutPosition,
    total,
    durationMs: steps * 0.1,
  };
}
export class ReactionView {
  constructor(canvas, options = {}) {
    this.options = options;
    this.canvas = canvas;
    this.frames = [];
    this.anatomy = [];
    this.selected = 0;
    this.selector = document.getElementById("reaction-frame");
    this.save = document.getElementById("reaction-png");
    this.selector.onchange = () => {
      this.selected = Number(this.selector.value);
      this.draw();
    };
    this.save.onclick = () =>
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a"),
          u = URL.createObjectURL(blob);
        a.href = u;
        a.download = "fly-brain-reaction.png";
        a.click();
        setTimeout(() => URL.revokeObjectURL(u), 1000);
      });
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(canvas);
    this.draw();
  }
  setAnatomy(points) {
    this.anatomy = points;
    this.draw();
  }
  start(label) {
    this.frames = [];
    this.label = label;
    this.refresh();
  }
  add(frame) {
    this.frames.push(frame);
    this.selected = this.frames.length - 1;
    this.refresh();
  }
  show(frames, label) {
    this.frames = frames;
    this.label = label;
    this.selected = Math.max(0, frames.length - 1);
    this.refresh();
  }
  refresh() {
    this.selector.replaceChildren();
    this.frames.forEach((f, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = this.options.labelFrame
        ? this.options.labelFrame(f, i)
        : f.phase === "silent"
          ? "音が止まったあと"
          : `${i + 1}音目を入力中`;
      this.selector.append(o);
    });
    this.selector.value = this.selected;
    this.selector.disabled = !this.frames.length;
    this.save.disabled = !this.frames.length;
    this.draw();
  }
  draw() {
    const canvas = this.canvas,
      w = Math.max(280, canvas.clientWidth),
      h = 340,
      dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const c = canvas.getContext("2d");
    c.scale(dpr, dpr);
    c.fillStyle = "#25342f";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#dce3d3";
    c.font = "12px sans-serif";
    c.fillText("MaleCNS · 脳と神経索の細胞体位置（XY投影）", 16, 24);
    const frame = this.frames[this.selected];
    canvas.dataset.active = frame?.reaction?.active ?? 0;
    if (!this.anatomy.length) {
      c.fillStyle = "#b3c2ac";
      c.fillText(
        this.options.emptyText ||
          "練習か返事の計算で、実際の反応がここに現れます",
        16,
        170,
      );
      return;
    }
    const points = this.anatomy;
    const min = [Infinity, Infinity],
      max = [-Infinity, -Infinity];
    for (const p of points)
      for (let k = 0; k < 2; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    const scale = Math.min(
      (w - 60) / (max[0] - min[0] || 1),
      220 / (max[1] - min[1] || 1),
    );
    const point = (p, r, color) => {
      c.fillStyle = color;
      c.beginPath();
      c.arc(
        w / 2 + (p[0] - (min[0] + max[0]) / 2) * scale,
        158 + (p[1] - (min[1] + max[1]) / 2) * scale,
        r,
        0,
        Math.PI * 2,
      );
      c.fill();
    };
    for (const p of points) point(p, 0.8, "#617969");
    for (const cell of frame?.reaction?.cells || [])
      point(
        cell.position,
        1.7 + Math.min(3, Math.log1p(cell.rate) / 2),
        "#ed9c66",
      );
    c.fillStyle = "#e4ebda";
    c.font = "12px sans-serif";
    c.fillText(this.label || "神経反応", 16, 284, w - 32);
    if (frame) {
      c.fillText(
        `${this.options.phaseName || (frame.phase === "silent" ? "入力停止後" : "音符入力中")} ${frame.reaction.durationMs} ms · ${frame.spikes.toLocaleString()}発火`,
        16,
        305,
      );
      c.fillStyle = "#b7c6af";
      c.font = "11px sans-serif";
      c.fillText(
        `発火細胞 ${frame.reaction.active} · 位置不明 ${frame.reaction.withoutPosition} · 表示 ${frame.reaction.cells.length}`,
        16,
        325,
      );
    }
    const summary = document.getElementById("reaction-summary");
    summary.textContent = frame
      ? `${this.label} — ${this.options.phaseName || (frame.phase === "silent" ? "音が止まったあと" : "音符入力中")}の${frame.reaction.durationMs} msに${frame.spikes.toLocaleString()}回発火。${frame.reaction.active}細胞が活動しました。`
      : "配線を読み込みました。反応を待っています";
  }
}
