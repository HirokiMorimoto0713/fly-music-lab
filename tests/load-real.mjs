import fs from "node:fs";
import zlib from "node:zlib";
const root = new URL("../public/data/", import.meta.url);
export function loadReal() {
  const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", root)));
  const neurons = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(new URL(manifest.metadata, root))),
  );
  const graph = {
    n: manifest.neurons,
    neurons,
    sign: Int32Array.from(neurons, (r) => r[5]),
  };
  for (const a of manifest.arrays) {
    const b = Buffer.concat(
      a.parts.map((p) =>
        zlib.gunzipSync(fs.readFileSync(new URL(p.file, root))),
      ),
    );
    graph[a.name] = new Uint32Array(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    );
  }
  return graph;
}
