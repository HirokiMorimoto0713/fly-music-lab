import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const root = new URL("../artifacts/", import.meta.url);
await fs.mkdir(root, { recursive: true });
const base = "http://127.0.0.1:4389";
const idle = () =>
  page.waitForFunction(
    () => window.echoDiagnostics && !window.echoDiagnostics.busy,
    null,
    { timeout: 180000 },
  );
async function download(id, file) {
  const event = page.waitForEvent("download");
  await page.locator("#" + id).click();
  const d = await event;
  await d.saveAs(new URL(file, root).pathname);
  return fs.readFile(new URL(file, root));
}
try {
  await page.goto(base);
  await page.waitForFunction(() => window.echoDiagnostics?.three === true);
  assert.ok(await page.locator("#answer").isDisabled());
  await page.screenshot({ path: new URL("echo-preview.png", root).pathname });
  await page.screenshot({
    path: new URL("echo-initial.png", root).pathname,
    fullPage: true,
  });
  const old = await page.locator("#fly3d").screenshot();
  await page.locator("#angle").fill("90");
  const rotated = await page.locator("#fly3d").screenshot();
  assert.notDeepEqual(old, rotated, "real 3D viewpoint changes");
  await page.locator("#angle").fill("-20");
  await page.locator("#listen").click();
  await page.waitForFunction(() =>
    document.getElementById("fly-state").textContent.includes("聴いて"),
  );
  await page.locator("#cancel").click();
  await idle();
  await page.locator("#clear").click();
  assert.ok(await page.locator("#train").isDisabled());
  for (const p of [60, 64, 67]) {
    await page.locator(`[data-pitch="${p}"]`).click();
    await idle();
  }
  await page.locator("#editor button").nth(2).click();
  assert.equal(await page.locator("#length").innerText(), "3 / 5音");
  // 音を聴かせながらの練習と、途中停止も確認する。
  await page.locator("#train").click();
  await page.waitForFunction(() =>
    document.getElementById("fly-state").textContent.includes("聴いて"),
  );
  await page.locator("#cancel").click();
  await idle();
  assert.equal(await page.evaluate(() => window.echoDiagnostics.samples), 0);
  await page.locator("#audible").uncheck();
  await page.locator("#train").click();
  await idle();
  console.log("trained", await page.locator("#lesson-status").innerText());
  assert.equal(await page.evaluate(() => window.echoDiagnostics.samples), 8);
  assert.deepEqual(
    await page.evaluate(() => [
      window.echoDiagnostics.n,
      window.echoDiagnostics.edges,
    ]),
    [166700, 25582938],
  );
  await page.locator("#test-seed").fill("1");
  await page.locator("#answer").click();
  await idle();
  assert.equal(
    await page.evaluate(() => window.echoDiagnostics.result.score.both),
    100,
  );
  assert.equal(await page.locator("#reaction-frame option").count(), 4);
  const silent = await page.locator("#reaction-map").screenshot();
  await page.locator("#reaction-frame").selectOption("0");
  assert.notDeepEqual(await page.locator("#reaction-map").screenshot(), silent);
  const png = await download("reaction-png", "brain-reaction.png");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  await page
    .locator(".reaction-section")
    .screenshot({ path: new URL("reaction-section.png", root).pathname });
  const baseline = await page.evaluate(
    () => window.echoDiagnostics.result.reply,
  );
  const midi = await download("export-midi", "echo.mid");
  assert.equal(midi.subarray(0, 4).toString(), "MThd");
  const wav = await download("export-wav", "echo.wav");
  await idle();
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  let peak = 0;
  for (let i = 44; i < wav.length; i += 2)
    peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
  assert.ok(
    peak > 100 && peak < 32767,
    "WAV contains audible non-clipped signal",
  );
  const exp = JSON.parse(await download("export-json", "echo-experiment.json"));
  assert.deepEqual(exp.result.reply, baseline);
  assert.ok(
    exp.result.features.length === 192 &&
      exp.result.readout.weights.length === 193,
  );
  await download("save-notebook", "echo-notebook.json");
  await page.locator("#test-seed").fill("2");
  await page.locator("#compare").click();
  await idle();
  const controls = await page.evaluate(
    () => window.echoDiagnostics.comparisons,
  );
  assert.equal(controls.length, 3);
  assert.equal(controls[1].reply.length, 0);
  assert.equal(controls[2].reply.length, 0);
  await page.locator('[data-control-play="2"]').click();
  await idle();
  assert.equal(
    await page.locator("#reaction-map").getAttribute("data-active"),
    "0",
  );
  assert.ok(
    (await page.locator("#reaction-summary").innerText()).includes("0回発火"),
  );
  await page.screenshot({
    path: new URL("echo-result.png", root).pathname,
    fullPage: true,
  });
  await page.reload();
  await idle();
  assert.equal(await page.evaluate(() => window.echoDiagnostics.samples), 8);
  // 学習にない曲を作り、追加学習なしで返す。
  await page.locator("#clear").click();
  for (const p of [71, 60, 65]) {
    await page.locator(`[data-pitch="${p}"]`).click();
    await idle();
  }
  await page.locator("#answer").click();
  await idle();
  assert.ok((await page.locator("#test-kind").innerText()).includes("未学習"));
  assert.equal(await page.evaluate(() => window.echoDiagnostics.samples), 8);
  // 中断時は既存ノートを保持する。
  await page.locator("#train").click();
  await page.locator("#cancel").click();
  await idle();
  assert.equal(await page.evaluate(() => window.echoDiagnostics.samples), 8);
  // ノート復元・不正ファイル拒否。
  await page
    .locator("#import-notebook")
    .setInputFiles(new URL("echo-notebook.json", root).pathname);
  await idle();
  await page.locator("#import-notebook").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":"bad"}'),
  });
  await idle();
  assert.ok(await page.locator("#error").isVisible());
  assert.equal(await page.evaluate(() => window.echoDiagnostics.samples), 8);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `overflow ${width}`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: new URL("echo-mobile.png", root).pathname,
    fullPage: true,
  });
  // 編集途中の空のお手本でも学習データを失わない。
  await page.locator("#clear").click();
  await page.reload();
  await idle();
  assert.equal(await page.evaluate(() => window.echoDiagnostics.samples), 8);
  assert.equal(await page.locator("#length").innerText(), "0 / 5音");
  // データ取得失敗の表示と同一ページでの回復。3Dなしでも操作可能。
  const fallback = await browser.newPage();
  await fallback.route("**/src/fly3d.js", (r) => r.abort());
  await fallback.route("**/public/data/manifest.json", (r) =>
    r.fulfill({ status: 404, body: "missing" }),
  );
  await fallback.goto(base);
  await fallback.waitForFunction(() => window.echoDiagnostics?.three === false);
  await fallback.locator("#audible").uncheck();
  await fallback.locator("#train").click();
  await fallback.waitForFunction(() => !window.echoDiagnostics.busy);
  assert.ok(await fallback.locator("#error").isVisible());
  await fallback.unroute("**/public/data/manifest.json");
  await fallback.locator("#train").click();
  await fallback.waitForFunction(() => !window.echoDiagnostics.busy, null, {
    timeout: 180000,
  });
  assert.equal(
    await fallback.evaluate(() => window.echoDiagnostics.samples),
    8,
  );
  await fallback.close();
  assert.deepEqual(errors, []);
  await fs.writeFile(
    new URL("echo-browser-results.json", root),
    JSON.stringify(
      {
        controls: controls.map(({ label, score }) => ({ label, score })),
        three: true,
        errors,
        downloads: ["MIDI", "WAV", "experiment", "notebook"],
        restoredSamples: 8,
      },
      null,
      2,
    ),
  );
  console.log("Echo E2E passed");
} finally {
  await browser.close();
}
