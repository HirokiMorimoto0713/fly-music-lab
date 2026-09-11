export async function loadGraph(progress = () => {}) {
  async function json(file) {
    const r = await fetch(new URL("../public/data/" + file, import.meta.url));
    if (!r.ok)
      throw Error("配線データを準備してください: npm run prepare:data");
    return r.json();
  }
  const [manifest, provenance] = await Promise.all([
    json("manifest.json"),
    json("provenance.json"),
  ]);
  async function unpack(file) {
    const r = await fetch(new URL("../public/data/" + file, import.meta.url));
    if (!r.ok) throw Error("データファイルがありません: " + file);
    const bytes = await r.arrayBuffer();
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (v) => v.toString(16).padStart(2, "0"),
    ).join("");
    if (hash !== provenance.files[file]?.sha256)
      throw Error("データの検証に失敗しました: " + file);
    return new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer();
  }
  progress("神経の名前と位置を読み込み中");
  const neurons = JSON.parse(
    new TextDecoder().decode(await unpack(manifest.metadata)),
  );
  const graph = {
    n: manifest.neurons,
    neurons,
    manifest,
    sign: Int32Array.from(neurons, (r) => r[5]),
  };
  let done = 0;
  for (const array of manifest.arrays) {
    const values = new Uint32Array(array.length);
    let offset = 0;
    for (const part of array.parts) {
      const chunk = new Uint32Array(await unpack(part.file));
      values.set(chunk, offset);
      offset += chunk.length;
      progress(`配線を検証中 ${++done} / 27`);
    }
    if (offset !== values.length) throw Error("配線の長さが一致しません");
    graph[array.name] = values;
  }
  if (
    neurons.length !== graph.n ||
    graph.offsets[graph.n] !== graph.sources.length
  )
    throw Error("神経数または接続数が一致しません");
  return graph;
}
