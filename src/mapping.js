export const GROUPS = ["optic", "central", "descending", "motor", "other"];
export const LABELS = [
  "視覚の回路",
  "脳の内部",
  "下行性ニューロン",
  "運動ニューロン",
  "その他の回路",
];
export function groupOf(row) {
  const s = String(row[2]).toLowerCase();
  if (s.startsWith("ol_") || s.includes("optic") || s.includes("visual"))
    return 0;
  if (s.includes("descending")) return 2;
  if (s.includes("motor")) return 3;
  if (s.startsWith("cb_") || s.includes("central")) return 1;
  return 4;
}
export function buildPools(neurons) {
  const groups = GROUPS.map(() => []),
    targets = { vision: [], left: [], right: [], flight: [] };
  neurons.forEach((row, i) => {
    groups[groupOf(row)].push(i);
    const type = String(row[1] || ""),
      side = String(row[3] || "").toLowerCase();
    if (type === "LC9") targets.vision.push(i);
    if (type === "LC4") targets.flight.push(i);
    if (type === "DNa02" || type === "LC9") {
      if (side.startsWith("l")) targets.left.push(i);
      if (side.startsWith("r")) targets.right.push(i);
    }
  });
  return { groups, targets };
}
export const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  minor: [0, 3, 5, 7, 10],
  chromatic: [0, 1, 2, 3, 4],
};
export function frameToNotes(frame, config, beat) {
  // 配線の計算は変更せず、実際の発火数を音階の位置へ翻訳する。
  // log2で桁の差を圧縮し、mod 5で選んだ5音の範囲に収める。
  const scale = SCALES[config.scale];
  return frame.groups.flatMap((spikes, group) => {
    if (spikes === 0) return [];
    const velocity = Math.min(105, 32 + Math.round(Math.log2(1 + spikes) * 7));
    const degree = (group + Math.floor(Math.log2(spikes + 1) * 3)) % 5;
    return [
      {
        beat,
        duration: 0.82,
        pitch: 48 + scale[degree] + (group === 0 ? 12 : 0),
        velocity,
        group,
        spikes,
      },
    ];
  });
}
export function frameToMotion(frame) {
  // 選んだ下行性ニューロンの発火率を、描画用の速度へ変換する。
  const [left, right, forward, escape] = frame.motor;
  return {
    speed: Math.min(1, forward / 150),
    turn: Math.max(-1, Math.min(1, (right - left) / 120)),
    wing: Math.min(1, escape / 100),
  };
}
export const DEFAULT_CONFIG = {
  seed: 1,
  scale: "pentatonic",
  bpm: 96,
  strength: 160,
  propagation: true,
};
export function validateConfig(value) {
  if (
    !value ||
    !Number.isInteger(value.seed) ||
    value.seed < 1 ||
    value.seed > 999999 ||
    !Object.hasOwn(SCALES, value.scale) ||
    !Number.isFinite(value.bpm) ||
    value.bpm < 40 ||
    value.bpm > 180 ||
    !Number.isFinite(value.strength) ||
    value.strength < 0 ||
    value.strength > 300 ||
    typeof value.propagation !== "boolean"
  )
    throw Error("実験条件の値が範囲外です");
  return Object.fromEntries(
    Object.keys(DEFAULT_CONFIG).map((k) => [k, value[k]]),
  );
}
