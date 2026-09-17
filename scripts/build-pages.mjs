import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
// 毎回新しい配信ディレクトリを作り、前回の成果物や作業中ファイルを残す。
const destination = await mkdtemp(path.join(artifacts, "pages-"));
const tracked = execFileSync("git", ["ls-files", "-z", "--", "src", "docs"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const manifest = JSON.parse(
  await readFile(path.join(root, "public/data/manifest.json"), "utf8"),
);
const provenance = JSON.parse(
  await readFile(path.join(root, "public/data/provenance.json"), "utf8"),
);
const dataFiles = [
  manifest.metadata,
  ...manifest.arrays.flatMap((array) => array.parts.map((part) => part.file)),
];
const bodyManifest = JSON.parse(
  await readFile(path.join(root, "public/embodied/manifest.json"), "utf8"),
);
if (
  bodyManifest.files.some(
    ({ file }) =>
      !/^(assets\/model\/[\w.-]+\.(xml|stl)|assets\/model_meta\.json|runtime\/(mujoco\/mujoco\.(js|wasm)|three\/three\.module\.js))$/.test(
        file,
      ),
  )
)
  throw Error("身体データのファイル名が不正です");
const bodyHashes = new Map(
  bodyManifest.files.map((item) => [
    "public/embodied/" + item.file,
    item.sha256,
  ]),
);
if (dataFiles.some((file) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.gz$/.test(file))) {
  throw Error("配線データのファイル名が不正です");
}
const files = [
  ...new Set([
    "index.html",
    "free.html",
    "draw.html",
    "talk.html",
    "walk.html",
    "README.md",
    ...tracked.filter(
      (file) =>
        file !== "docs/session-brief.md" &&
        /^(src\/[^/]+\.(js|css)|docs\/[^/]+\.(md|png))$/.test(file),
    ),
    "src/walk-model.js",
    "src/walk-view.js",
    "src/walk-ui.js",
    "src/walk.css",
    "docs/walking-guide.md",
    "public/embodied/manifest.json",
    ...bodyHashes.keys(),
    ...[
      "controller.js",
      "meshes.js",
      "NOTICE.md",
      "LICENSE",
      "LICENSE-mujoco",
      "LICENSE-three",
    ].map((file) => "vendor/neuromechfly/" + file),
    "public/favicon.svg",
    "public/data/manifest.json",
    "public/data/provenance.json",
    ...dataFiles.map((file) => "public/data/" + file),
    "vendor/brain.js",
    "vendor/LICENSE",
    "node_modules/three/build/three.module.js",
    "node_modules/three/build/three.core.js",
    "node_modules/three/LICENSE",
  ]),
];
const inventory = {};
for (const file of files) {
  const source = path.join(root, file);
  if (!(await lstat(source)).isFile())
    throw Error("通常ファイル以外は配信しません: " + file);
  const bytes = await readFile(source);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bodyHashes.has(file) && sha256 !== bodyHashes.get(file)) {
    throw Error("身体データの検証に失敗しました: " + file);
  }
  if (
    file.endsWith(".gz") &&
    sha256 !== provenance.files[path.basename(file)]?.sha256
  ) {
    throw Error("配線データの検証に失敗しました: " + file);
  }
  const output = path.join(destination, file);
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(source, output);
  inventory[file] = { bytes: bytes.length, sha256 };
}
await writeFile(path.join(destination, ".nojekyll"), "");
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
await writeFile(
  path.join(destination, "deployment.json"),
  JSON.stringify(
    {
      revision,
      dataRevision: provenance.revision,
      builtAt: new Date().toISOString(),
      files: inventory,
    },
    null,
    2,
  ) + "\n",
);
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, "path=" + destination + "\n");
}
console.log(
  JSON.stringify({
    path: destination,
    files: files.length,
    bytes: Object.values(inventory).reduce((sum, file) => sum + file.bytes, 0),
  }),
);
