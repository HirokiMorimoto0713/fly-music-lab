import * as T from "../node_modules/three/build/three.module.js";
// 独自の立体イラスト。身体の演技は再生中の音に同期し、生理の再現とは区別する。
export class HeadphoneFly {
  constructor(canvas) {
    this.canvas = canvas;
    this.level = 0;
    this.mode = "idle";
    this.angle = -0.35;
    this.scene = new T.Scene();
    this.scene.background = new T.Color("#e8e9df");
    this.camera = new T.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(2.7, 2.4, 5.1);
    this.camera.lookAt(0, 1, 0);
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.scene.add(new T.HemisphereLight(0xfff8ea, 0x657566, 3));
    const light = new T.DirectionalLight(0xfff5df, 4);
    light.position.set(-3, 6, 5);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    this.scene.add(light);
    this.fly = new T.Group();
    this.scene.add(this.fly);
    const dark = new T.MeshStandardMaterial({
      color: 0x38483e,
      roughness: 0.55,
    });
    const eye = new T.MeshStandardMaterial({
      color: 0x9c3f2e,
      roughness: 0.32,
      metalness: 0.15,
    });
    const pad = new T.MeshStandardMaterial({ color: 0x24342b, roughness: 0.9 });
    const orange = new T.MeshStandardMaterial({
      color: 0xc86236,
      roughness: 0.45,
      metalness: 0.2,
    });
    const cream = new T.MeshStandardMaterial({
      color: 0xf6edd8,
      roughness: 0.65,
    });
    const ell = (parent, mat, pos, scale) => {
      const m = new T.Mesh(new T.SphereGeometry(1, 32, 24), mat);
      m.position.set(...pos);
      m.scale.set(...scale);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const line = (parent, pts, r, mat) => {
      const curve = new T.CatmullRomCurve3(pts.map((p) => new T.Vector3(...p)));
      const m = new T.Mesh(new T.TubeGeometry(curve, 32, r, 8, false), mat);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    ell(this.fly, dark, [0, 1.02, -0.45], [0.43, 0.46, 0.7]);
    ell(this.fly, dark, [0, 1.18, 0.12], [0.43, 0.42, 0.43]);
    this.head = new T.Group();
    this.head.position.set(0, 1.57, 0.5);
    this.fly.add(this.head);
    ell(this.head, dark, [0, 0, 0], [0.48, 0.43, 0.4]);
    for (const side of [-1, 1]) {
      ell(this.head, eye, [side * 0.29, 0.03, 0.29], [0.24, 0.3, 0.16]);
      ell(this.head, cream, [side * 0.28, 0.14, 0.43], [0.047, 0.065, 0.02]);
      ell(this.head, pad, [side * 0.48, 0, 0], [0.11, 0.3, 0.26]);
      ell(this.head, orange, [side * 0.57, 0, 0], [0.08, 0.25, 0.22]);
      ell(this.head, cream, [side * 0.63, 0, 0], [0.016, 0.09, 0.09]);
      line(
        this.head,
        [
          [side * 0.12, 0.23, 0.3],
          [side * 0.17, 0.5, 0.43],
          [side * 0.28, 0.58, 0.39],
        ],
        0.022,
        dark,
      );
      for (let k = 0; k < 3; k++)
        line(
          this.fly,
          [
            [side * 0.27, 1.1, -0.45 + k * 0.32],
            [side * (0.72 + 0.05 * k), 0.55, -0.75 + k * 0.62],
            [side * 0.95, 0.13, -0.95 + k * 0.86],
          ],
          0.029,
          dark,
        );
    }
    const band = [];
    for (let i = 0; i <= 20; i++) {
      const a = (i * Math.PI) / 20;
      band.push([Math.cos(a) * 0.58, Math.sin(a) * 0.64, 0]);
    }
    line(this.head, band, 0.067, orange);
    this.mouth = ell(this.head, pad, [0, -0.2, 0.38], [0.06, 0.04, 0.04]);
    this.wings = [];
    const wingmat = new T.MeshPhysicalMaterial({
      color: 0xf7f4df,
      transparent: true,
      opacity: 0.6,
      roughness: 0.28,
      side: T.DoubleSide,
    });
    for (const side of [-1, 1]) {
      const wing = new T.Group();
      wing.position.set(side * 0.18, 1.42, -0.02);
      this.fly.add(wing);
      const shell = ell(
        wing,
        wingmat,
        [side * 0.46, 0, -0.45],
        [0.35, 0.035, 0.78],
      );
      shell.rotation.y = side * -0.5;
      line(
        wing,
        [
          [0, 0.02, 0],
          [side * 0.36, 0.02, -0.5],
          [side * 0.73, 0.02, -0.98],
        ],
        0.009,
        cream,
      );
      this.wings.push(wing);
    }
    const floor = new T.Mesh(
      new T.CylinderGeometry(1.65, 1.75, 0.13, 64),
      new T.MeshStandardMaterial({ color: 0xd6dacb, roughness: 1 }),
    );
    floor.position.y = -0.015;
    floor.receiveShadow = true;
    this.scene.add(floor);
    let pointer;
    canvas.addEventListener("pointerdown", (e) => {
      pointer = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (pointer !== undefined) {
        this.angle += (e.clientX - pointer) * 0.012;
        pointer = e.clientX;
        this.draw();
      }
    });
    canvas.addEventListener("pointerup", () => (pointer = undefined));
    canvas.addEventListener("pointercancel", () => (pointer = undefined));
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.visible = true;
    this.visibilityObserver = new IntersectionObserver((entries) => {
      this.visible = entries[0].isIntersecting;
    });
    this.visibilityObserver.observe(canvas);
    window.addEventListener(
      "pagehide",
      () => {
        cancelAnimationFrame(this.frame);
        this.observer.disconnect();
        this.visibilityObserver.disconnect();
        this.renderer.dispose();
      },
      { once: true },
    );
    this.reduce = matchMedia("(prefers-reduced-motion: reduce)");
    this.animate = (t) => {
      if (!document.hidden && this.visible && (this.level > 0 || this.wasActive)) {
        const l = this.reduce.matches ? 0 : this.level;
        this.head.rotation.z = Math.sin(t / 160) * l * 0.09;
        this.mouth.scale.y = this.mode === "answer" ? 0.04 + l * 0.09 : 0.04;
        this.wings.forEach(
          (w, i) => (w.rotation.z = (i ? 1 : -1) * Math.sin(t / 75) * l * 0.12),
        );
        this.draw();
        this.wasActive = this.level > 0;
      }
      this.frame = requestAnimationFrame(this.animate);
    };
    this.resize();
    this.frame = requestAnimationFrame(this.animate);
    canvas.dataset.rendered = "true";
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      cancelAnimationFrame(this.frame);
      canvas.dataset.rendered = "false";
      document.getElementById("three-status").textContent =
        "3D表示が停止しました。実験と音は利用できます。再読み込みで復旧できます";
    });
  }
  resize() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.draw();
  }
  draw() {
    this.fly.rotation.y = this.angle;
    this.renderer.render(this.scene, this.camera);
  }
  set(mode, level = 0) {
    this.mode = mode;
    this.level = level;
  }
}
