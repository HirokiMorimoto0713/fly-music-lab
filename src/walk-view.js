import * as THREE from "three";
import { buildMeshes, syncMeshes } from "../vendor/neuromechfly/meshes.js";

export class WalkingView {
  constructor(stage, simulation, onLost) {
    this.stage = stage;
    this.simulation = simulation;
    this.top = false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor(0xe7e8dd);
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      onLost();
    });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const light = new THREE.DirectionalLight(0xfff7e8, 2);
    light.position.set(-4, -8, 12);
    this.scene.add(light);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 1000);
    this.camera.up.set(0, 0, 1);
    const tile = document.createElement("canvas");
    tile.width = tile.height = 128;
    const ink = tile.getContext("2d");
    ink.fillStyle = "#e7e8dd";
    ink.fillRect(0, 0, 128, 128);
    ink.strokeStyle = "#bcc3ac";
    ink.lineWidth = 3;
    ink.strokeRect(0, 0, 128, 128);
    this.floorTexture = new THREE.CanvasTexture(tile);
    this.floorTexture.colorSpace = THREE.SRGBColorSpace;
    this.floorTexture.wrapS = this.floorTexture.wrapT = THREE.RepeatWrapping;
    this.floorTexture.repeat.set(200, 200); // One tile per millimetre.
    this.floorTexture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshBasicMaterial({ map: this.floorTexture }),
    );
    this.ground.position.z = -0.03;
    this.scene.add(this.ground);
    this.meshes = buildMeshes(simulation.model, simulation.meta);
    for (const item of this.meshes.userData.items) {
      if (item.bodyId === 0) item.mesh.visible = false; // Non-colliding slalom decoration only.
    }
    this.scene.add(this.meshes);
    this.trailGeometry = new THREE.BufferGeometry();
    this.trailBuffer = new Float32Array(1502 * 3);
    this.trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.trailBuffer, 3),
    );
    this.trail = new THREE.Line(
      this.trailGeometry,
      new THREE.LineBasicMaterial({
        color: 0xb84326,
        transparent: true,
        opacity: 0.55,
      }),
    );
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
    this.contactDots = [];
    this.dotGeometry = new THREE.SphereGeometry(0.07, 8, 6);
    this.dotMaterial = new THREE.MeshBasicMaterial({
      color: 0xb84326,
      depthTest: false,
    });
    stage.append(this.renderer.domElement);
    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(stage);
    this.render();
  }

  render() {
    const { width, height } = this.stage.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const sim = this.simulation,
      state = sim.snapshot(),
      [x, y] = state.position;
    syncMeshes(this.meshes, sim.data);
    if (this.top) {
      this.camera.up.set(1, 0, 0);
      this.camera.position.set(x, y, 14);
    } else {
      this.camera.up.set(0, 0, 1);
      this.camera.position.set(x - 6, y - 9, 7);
    }
    this.camera.lookAt(x, y, 0.8);
    this.ground.position.x = Math.round(x / 10) * 10;
    this.ground.position.y = Math.round(y / 10) * 10;
    for (let i = 0; i < sim.records.length; i++) {
      const p = sim.records[i].position;
      this.trailBuffer.set([p[0], p[1], 0.025], i * 3);
    }
    this.trailGeometry.attributes.position.needsUpdate = true;
    this.trailGeometry.setDrawRange(0, sim.records.length);
    state.contactPoints.forEach((point, i) => {
      if (!this.contactDots[i]) {
        this.contactDots[i] = new THREE.Mesh(
          this.dotGeometry,
          this.dotMaterial,
        );
        this.scene.add(this.contactDots[i]);
      }
      this.contactDots[i].visible = true;
      this.contactDots[i].position.set(...point);
    });
    this.contactDots.slice(state.contactPoints.length).forEach((dot) => {
      dot.visible = false;
    });
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.observer.disconnect();
    this.scene.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    this.floorTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
