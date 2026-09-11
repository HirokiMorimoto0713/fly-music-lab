const ink = "#30362e",
  accent = "#b84326",
  muted = "#9aab97";
function canvasContext(canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2),
    r = canvas.getBoundingClientRect();
  const w = Math.round(r.width),
    h = Math.round(r.height);
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, w, h };
}
export class Visuals {
  constructor() {
    this.creature = document.querySelector("#creature");
    this.score = document.querySelector("#score");
    this.anatomy = document.querySelector("#anatomy");
    this.notes = [];
    this.points = [];
    this.top = [];
    this.motion = { speed: 0, turn: 0, wing: 0 };
    this.x = 0;
    this.y = 0;
    this.angle = -0.5;
    this.phase = 0;
    this.last = 0;
    this.running = false;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }
  reset() {
    this.notes = [];
    this.top = [];
    this.motion = { speed: 0, turn: 0, wing: 0 };
    this.x = 0;
    this.y = 0;
    this.angle = -0.5;
    this.phase = 0;
    this.drawScore();
    this.drawAnatomy();
  }
  frame(frame, notes, motion) {
    this.top = frame.top;
    this.notes.push(...notes);
    this.motion = motion;
    this.drawScore();
    this.drawAnatomy();
  }
  setAnatomy(points) {
    this.points = points;
    const xs = points.map((p) => p[0]).sort((a, b) => a - b),
      ys = points.map((p) => p[1]).sort((a, b) => a - b);
    this.bounds = [
      xs[Math.floor(xs.length * 0.01)],
      xs[Math.floor(xs.length * 0.99)],
      ys[Math.floor(ys.length * 0.01)],
      ys[Math.floor(ys.length * 0.99)],
    ];
    this.drawAnatomy();
  }
  loop(t) {
    const dt = Math.min(0.04, (t - this.last) / 1000 || 0);
    this.last = t;
    if (!document.hidden) {
      this.drawFly(dt);
      if (this.lastWidth !== innerWidth) {
        this.lastWidth = innerWidth;
        this.drawScore();
        this.drawAnatomy();
      }
    }
    requestAnimationFrame(this.loop);
  }
  drawFly(dt) {
    const { c, w, h } = canvasContext(this.creature);
    c.clearRect(0, 0, w, h);
    c.strokeStyle = "#e4e5d9";
    c.lineWidth = 1;
    for (let x = 12; x < w; x += 24)
      for (let y = 12; y < h; y += 24) {
        c.beginPath();
        c.arc(x, y, 0.65, 0, Math.PI * 2);
        c.stroke();
      }
    c.save();
    c.translate(w / 2, h / 2);
    c.scale(1, 0.52);
    c.beginPath();
    c.ellipse(0, 25, w * 0.31, h * 0.47, 0, 0, Math.PI * 2);
    c.strokeStyle = "#d4d8c8";
    c.stroke();
    c.restore();
    const moving = this.running && !this.reduced;
    if (moving) {
      this.angle += this.motion.turn * dt * 1.1;
      this.x += Math.cos(this.angle) * this.motion.speed * dt * 23;
      this.y += Math.sin(this.angle) * this.motion.speed * dt * 15;
      this.phase += dt * this.motion.speed * 13;
    }
    const limit = w * 0.23;
    if (Math.abs(this.x) > limit) this.x = Math.sign(this.x) * limit;
    if (Math.abs(this.y) > h * 0.22) this.y = Math.sign(this.y) * h * 0.22;
    c.save();
    c.translate(w / 2 + this.x, h / 2 + this.y + 24);
    c.scale(1, 0.28);
    c.fillStyle = "rgba(45,60,43,.09)";
    c.beginPath();
    c.ellipse(0, 0, 54, 30, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.save();
    c.translate(w / 2 + this.x, h / 2 + this.y - this.motion.wing * 12);
    c.rotate(this.angle + 0.9);
    const size = Math.min(w / 430, 1.05);
    c.scale(size, size);
    // 6本の脚の軌道は描画用。関節や筋肉の物理シミュレーションではない。
    c.lineCap = "round";
    for (let side of [-1, 1])
      for (let i = 0; i < 3; i++) {
        const step =
          Math.sin(this.phase + i * 2.1 + (side === 1 ? Math.PI : 0)) *
          this.motion.speed *
          9;
        c.strokeStyle = ink;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(side * 9, (i - 1) * 17);
        c.lineTo(side * (29 + i * 3), (i - 1) * 28 + step);
        c.lineTo(side * (46 + i * 2), (i - 1) * 41 + 14 + step);
        c.stroke();
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(side * (46 + i * 2), (i - 1) * 41 + 14 + step);
        c.lineTo(side * (53 + i * 2), (i - 1) * 41 + 17 + step);
        c.stroke();
      }
    for (let side of [-1, 1]) {
      c.save();
      c.translate(side * 9, -8);
      c.rotate(
        side *
          (0.37 +
            this.motion.wing * 0.45 +
            (moving
              ? Math.sin(this.last * 0.06) * this.motion.wing * 0.08
              : 0)),
      );
      c.fillStyle = "rgba(230,235,224,.82)";
      c.strokeStyle = "#aab7a2";
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(side * 18, 32, 18, 46, side * -0.18, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.strokeStyle = "#c0cbbb";
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(side * 24, 70);
      c.moveTo(side * 10, 28);
      c.lineTo(side * 32, 45);
      c.moveTo(side * 15, 44);
      c.lineTo(side * 30, 58);
      c.stroke();
      c.restore();
    }
    c.fillStyle = "#6d7961";
    c.beginPath();
    c.ellipse(0, 23, 13, 29, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#454f3d";
    c.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.moveTo(-10, 12 + i * 8);
      c.quadraticCurveTo(0, 17 + i * 8, 10, 12 + i * 8);
      c.stroke();
    }
    c.fillStyle = ink;
    c.beginPath();
    c.ellipse(0, -5, 15, 20, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#4b5644";
    c.beginPath();
    c.ellipse(0, -29, 18, 13, 0, 0, Math.PI * 2);
    c.fill();
    for (let side of [-1, 1]) {
      c.fillStyle = accent;
      c.beginPath();
      c.ellipse(side * 12, -31, 8, 10, side * 0.35, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = ink;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(side * 5, -39);
      c.lineTo(side * 10, -49);
      c.lineTo(side * 14, -50);
      c.stroke();
    }
    c.restore();
    c.fillStyle = "#778270";
    c.font = "9px monospace";
    c.fillText("ILLUSTRATIVE BODY", 12, h - 12);
    c.fillText("× " + (1 + this.motion.wing * 0.5).toFixed(1), w - 42, h - 12);
  }
  drawScore() {
    const { c, w, h } = canvasContext(this.score);
    c.fillStyle = "#eeeee4";
    c.fillRect(0, 0, w, h);
    c.font = "9px monospace";
    const yFor = (p) => h - 15 - ((p - 48) / 24) * (h - 35);
    for (const [pitch, name] of [
      [72, "C5"],
      [67, "G4"],
      [60, "C4"],
      [55, "G3"],
      [48, "C3"],
    ]) {
      const y = yFor(pitch);
      c.strokeStyle = "#d9ddce";
      c.beginPath();
      c.moveTo(30, y);
      c.lineTo(w, y);
      c.stroke();
      c.fillStyle = "#7e8974";
      c.fillText(name, 5, y + 3);
    }
    const last = Math.max(31, ...this.notes.map((n) => n.beat)),
      first = Math.max(0, last - 31);
    for (let i = 0; i < 32; i++) {
      const x = 35 + (i * (w - 40)) / 32;
      c.strokeStyle = i % 4 === 0 ? "#d1d8c6" : "#e0e4d7";
      c.beginPath();
      c.moveTo(x, 6);
      c.lineTo(x, h - 6);
      c.stroke();
    }
    for (const n of this.notes) {
      if (n.beat < first) continue;
      const x = 35 + ((n.beat - first) * (w - 40)) / 32,
        y = yFor(n.pitch);
      c.fillStyle = `rgba(184,67,38,${0.35 + n.velocity / 180})`;
      c.fillRect(x, y - 3, Math.max(3, ((w - 40) / 32) * 0.82), 6);
    }
    if (!this.notes.length) {
      c.fillStyle = "#778270";
      c.font = "11px sans-serif";
      c.fillText("最初の刺激を待っています", 45, h / 2);
    }
  }
  drawAnatomy() {
    const { c, w, h } = canvasContext(this.anatomy);
    c.fillStyle = "#25342f";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#94a78d";
    c.font = "9px monospace";
    c.fillText("MaleCNS / SOMA PROJECTION", 15, 22);
    if (!this.bounds) {
      c.fillStyle = "#afbdab";
      c.font = "12px sans-serif";
      c.fillText("配線を読み込むと神経の位置が見えます", 20, h / 2);
      return;
    }
    const [x0, x1, y0, y1] = this.bounds,
      scale = Math.min((w - 40) / (x1 - x0), (h - 50) / (y1 - y0));
    const draw = (p, r) => {
      if (!p) return;
      const x = w / 2 + (p[0] - (x0 + x1) / 2) * scale,
        y = h / 2 + (p[1] - (y0 + y1) / 2) * scale;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    };
    c.fillStyle = "rgba(147,177,145,.35)";
    for (const p of this.points) draw(p, 0.6);
    c.fillStyle = "#ef9c68";
    for (const n of this.top) draw(n.position, 1.3);
  }
}
