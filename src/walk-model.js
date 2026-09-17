import { WalkingController } from "../vendor/neuromechfly/controller.js";

export const COMMANDS = Object.freeze({
  stop: { label: "歩行指令を止める", gains: [0, 0] },
  forward: { label: "前へ歩く", gains: [1, 1] },
  left: { label: "左へ曲がる", gains: [0.4, 1.2] },
  right: { label: "右へ曲がる", gains: [1.2, 0.4] },
});
const BASE = new URL("../public/embodied/", import.meta.url);
export const MAX_TICKS = 300000; // 30 seconds of physics, bounded recording.

async function fetchAsset(file, kind = "text") {
  const response = await fetch(new URL(file, BASE), {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`${file} を読み込めません (${response.status})`);
  return response[kind]();
}

export async function loadWalking(onStage) {
  onStage("物理エンジンを読み込み中");
  const { default: loadMujoco } =
    await import("../public/embodied/runtime/mujoco/mujoco.js");
  // Fetch explicitly so an HTTP failure is caught before Emscripten initializes.
  const wasmBinary = await fetchAsset(
    "runtime/mujoco/mujoco.wasm",
    "arrayBuffer",
  );
  const mj = await loadMujoco({ wasmBinary });
  let model, data;
  try {
    onStage("ハエの身体と脚の軌道を読み込み中");
    const [xml, meta, provenance] = await Promise.all([
      fetchAsset("assets/model/fly.xml"),
      fetchAsset("assets/model_meta.json", "json"),
      fetchAsset("manifest.json", "json"),
    ]);
    mj.FS.mkdir("/work");
    mj.FS.writeFile("/work/fly.xml", xml);
    const files = [
      ...new Set(
        [...xml.matchAll(/<mesh[^>]*\bfile="([^"]+)"/g)].map((m) => m[1]),
      ),
    ];
    let loaded = 0;
    await Promise.all(
      files.map(async (file) => {
        if (!/^[a-zA-Z0-9_.-]+\.stl$/.test(file))
          throw Error("身体データのパスが不正です");
        const bytes = await fetchAsset(`assets/model/${file}`, "arrayBuffer");
        mj.FS.writeFile(`/work/${file}`, new Uint8Array(bytes));
        onStage(`身体の形を読み込み中 ${++loaded} / ${files.length}`);
      }),
    );
    onStage("関節と接触を準備中");
    model = mj.MjModel.from_xml_path("/work/fly.xml");
    data = new mj.MjData(model);
    return new WalkingSimulation(mj, model, data, meta, provenance);
  } catch (error) {
    data?.delete();
    model?.delete();
    throw error;
  }
}

export class WalkingSimulation {
  constructor(mj, model, data, meta, provenance) {
    Object.assign(this, { mj, model, data, meta, provenance });
    this.dt = meta.timestep;
    if (this.dt !== 0.0001) throw Error("想定した時間刻みと異なります");
    this.bodyId = Array.from(model.jnt_type).findIndex((v) => v === 0);
    if (this.bodyId < 0) throw Error("自由関節が見つかりません");
    this.bodyId = model.jnt_bodyid[this.bodyId];
    this.geomNames = Array.from(
      { length: model.ngeom },
      (_, i) => model.geom(i).name,
    );
    this.groundId = this.geomNames.indexOf("ground_plane");
    this.reset(1);
  }

  reset(seed = this.seed) {
    if (!Number.isInteger(seed) || seed < 1 || seed > 999999)
      throw Error("シードは1〜999999の整数です");
    this.seed = seed;
    this.controller = new WalkingController(this.meta, seed);
    this.mj.mj_resetDataKeyframe(this.model, this.data, 0);
    this.mj.mj_forward(this.model, this.data);
    this.tick = 0;
    this.command = "stop";
    this.events = [{ tick: 0, command: "stop" }];
    this.records = [];
    this.distance = 0;
    this.previousXY = Array.from(
      this.data.xpos.slice(this.bodyId * 3, this.bodyId * 3 + 2),
    );
    this.origin = this.previousXY.slice();
    this.record();
  }

  setCommand(command) {
    if (!Object.hasOwn(COMMANDS, command)) throw Error("未知の歩行指令です");
    if (this.command !== command) {
      this.command = command;
      this.events.push({ tick: this.tick, command });
    }
  }

  step(count) {
    if (!Number.isInteger(count) || count < 0 || count > 1000)
      throw Error("計算区間が不正です");
    const target = Math.min(this.tick + count, MAX_TICKS);
    for (; this.tick < target;) {
      this.controller.stepCPG(this.data.ctrl, ...COMMANDS[this.command].gains);
      const before = this.data.time;
      this.mj.mj_step(this.model, this.data);
      if (Math.abs(this.data.time - before - this.dt) > 1e-8)
        throw Error("物理計算が初期化されました。条件をリセットしてください");
      this.tick++;
      if (this.tick % 200 === 0) {
        if (
          !this.data.qpos.every(Number.isFinite) ||
          !this.data.qvel.every(Number.isFinite)
        ) {
          throw Error(
            "物理計算が不安定になりました。条件をリセットしてください",
          );
        }
        // mj_step leaves position-derived fields at the previous integration point.
        this.mj.mj_forward(this.model, this.data);
        const xy = this.data.xpos.slice(this.bodyId * 3, this.bodyId * 3 + 2);
        this.distance += Math.hypot(
          xy[0] - this.previousXY[0],
          xy[1] - this.previousXY[1],
        );
        this.previousXY = Array.from(xy);
        this.record();
      }
    }
    this.mj.mj_forward(this.model, this.data);
    return this.snapshot();
  }

  snapshot() {
    const d = this.data,
      b = this.bodyId;
    const position = Array.from(d.xpos.slice(3 * b, 3 * b + 3));
    const contacts = Object.fromEntries(
      this.meta.control.leg_order.map((leg) => [leg, 0]),
    );
    const points = [];
    for (let i = 0; i < d.ncon; i++) {
      const contact = d.contact.get(i);
      const [g1, g2] = contact.geom;
      if (g1 !== this.groundId && g2 !== this.groundId) continue;
      const name = this.geomNames[g1 === this.groundId ? g2 : g1];
      const leg = this.meta.control.leg_order.find((key) =>
        name.includes(`/${key.toLowerCase()}_`),
      );
      if (leg) contacts[leg]++;
      points.push(Array.from(contact.pos));
    }
    return {
      tick: this.tick,
      time: this.tick * this.dt,
      command: this.command,
      gains: [...COMMANDS[this.command].gains],
      position,
      yaw: Math.atan2(d.xmat[9 * b + 3], d.xmat[9 * b]),
      displacement: Math.hypot(
        position[0] - this.origin[0],
        position[1] - this.origin[1],
      ),
      distance: this.distance,
      contacts,
      contactPoints: points,
      totalContacts: d.ncon,
    };
  }

  record() {
    const state = this.snapshot();
    this.records.push({ ...state, ctrl: Array.from(this.data.ctrl) });
  }

  export() {
    return {
      format: "fly-walking-v1",
      model: "NeuroMechFly v2",
      brainConnected: false,
      source: this.provenance,
      seed: this.seed,
      dt: this.dt,
      controller: "CPG + preprogrammed steps; xorshift32 initial phases",
      units: { length: "mm", time: "s", angle: "radian" },
      sampleInterval: 0.02,
      events: this.events,
      records: this.records,
      final: this.snapshot(),
      qpos: Array.from(this.data.qpos),
      qvel: Array.from(this.data.qvel),
    };
  }

  dispose() {
    this.data.delete();
    this.model.delete();
  }
}
