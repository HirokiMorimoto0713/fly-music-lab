import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
});
const base = "http://127.0.0.1:4389",
  root = new URL("../artifacts/", import.meta.url);
await fs.mkdir(root, { recursive: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const idle = () =>
  page.waitForFunction(
    () => window.drawDiagnostics && !window.drawDiagnostics.busy,
    null,
    { timeout: 180000 },
  );
async function download(id, name) {
  const event = page.waitForEvent("download");
  await page.locator("#" + id).click();
  const d = await event;
  await d.saveAs(new URL(name, root).pathname);
  return fs.readFile(new URL(name, root));
}
try {
  await page.goto(base + "/draw.html");
  await page.waitForFunction(() => window.drawDiagnostics?.three === true);
  assert.ok(await page.locator("#draw").isDisabled());
  await page.screenshot({
    path: new URL("drawing-initial.png", root).pathname,
  });
  const before = await page.locator("#fly3d").screenshot();
  await page.locator("#angle").fill("90");
  assert.notDeepEqual(await page.locator("#fly3d").screenshot(), before);
  await page.locator("#angle").fill("-20");
  await page.locator("#train").click();
  await idle();
  assert.equal(await page.evaluate(() => window.drawDiagnostics.model), true);
  assert.equal(
    await page.evaluate(() => window.drawDiagnostics.neurons),
    166700,
  );
  await page.locator("#shape").selectOption("wave");
  await page.locator("#draw").click();
  await idle();
  const baseline = await page.evaluate(() => window.drawDiagnostics.result);
  assert.ok(baseline.path.some((p) => p.down));
  assert.ok(baseline.metrics.coverage > 0);
  assert.equal(
    await page.locator("#reaction-frame option").count(),
    baseline.trace.length,
  );
  await page.screenshot({
    path: new URL("drawing-result.png", root).pathname,
    fullPage: true,
  });
  await page.locator("#reaction-frame").selectOption("0");
  assert.equal(await page.locator("#steps").innerText(), "1 / 160筆");
  const png = await download("png", "drawing.png");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  const reaction = await download("reaction-png", "drawing-reaction.png");
  assert.equal(reaction.subarray(1, 4).toString(), "PNG");
  const json = JSON.parse(await download("json", "drawing-experiment.json"));
  assert.deepEqual(json.path, baseline.path);
  assert.equal(json.trace[0].features.length, 192);
  const note = await download("note", "drawing-note.json");
  assert.equal(JSON.parse(note).version, "draw-v1");
  await page.reload();
  await idle();
  assert.ok(!(await page.locator("#draw").isDisabled()));
  await page.locator("#draw").click();
  await idle();
  assert.deepEqual(
    await page.evaluate(() => window.drawDiagnostics.result.path),
    baseline.path,
  );
  await page.locator("#seed").fill("2");
  await page.locator("#compare").click();
  await idle();
  const comparisons = await page.evaluate(
    () => window.drawDiagnostics.comparisons,
  );
  assert.equal(comparisons.length, 3);
  assert.equal(comparisons[1].metrics.ink, 0);
  assert.equal(comparisons[2].trace[0].spikes, 0);
  await page.locator("#comparisons button").nth(2).click();
  assert.equal(
    await page.locator("#reaction-map").getAttribute("data-active"),
    "0",
  );
  assert.equal(await page.locator("#distance").innerText(), "描線なし");
  await page.locator("#comparisons button").nth(0).click();
  // 中断は学習を保持し、未完了の絵を完了した作品として保存しない。
  await page.locator("#draw").click();
  await page.waitForFunction(() => window.drawDiagnostics.busy);
  await page.locator("#cancel").click();
  await idle();
  assert.equal(await page.evaluate(() => window.drawDiagnostics.model), true);
  assert.ok(await page.locator("#png").isDisabled());
  await page.locator("#train").click();
  await page.waitForFunction(() => window.drawDiagnostics.busy);
  await page.locator("#cancel").click();
  await idle();
  assert.equal(await page.evaluate(() => window.drawDiagnostics.model), true);
  await page.locator("#clear").click();
  assert.ok(await page.locator("#draw").isDisabled());
  const canvas = page.locator("#reference"),
    box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.4);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++)
    await page.mouse.move(
      box.x + box.width * (0.25 + i * 0.03),
      box.y + box.height * (0.4 + i * 0.01),
    );
  await page.mouse.up();
  assert.ok(!(await page.locator("#draw").isDisabled()));
  await page.locator("#draw").click();
  await idle();
  const custom = await page.evaluate(() => window.drawDiagnostics.result);
  assert.equal(custom.points.length, 16);
  // 不正ファイルでは元の学習を保護、正しいノートで復旧。
  await page
    .locator("#import")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":"wrong"}'),
    });
  await idle();
  assert.ok((await page.locator("#error").innerText()).includes("版"));
  assert.equal(await page.evaluate(() => window.drawDiagnostics.model), true);
  await page
    .locator("#import")
    .setInputFiles({
      name: "note.json",
      mimeType: "application/json",
      buffer: note,
    });
  await idle();
  assert.equal(await page.evaluate(() => window.drawDiagnostics.model), true);
  await page.locator("#clear").click();
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.ok(!(await page.locator("#draw").isDisabled()));
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `overflow ${width}`,
    );
    await page.screenshot({
      path: new URL(`drawing-${width}.png`, root).pathname,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  // 全配線データ欠落から同じページで再試行できる。
  const other = await browser.newPage();
  await other.route("**/public/data/manifest.json", (r) =>
    r.fulfill({ status: 404, body: "missing" }),
  );
  await other.goto(base + "/draw.html");
  await other.locator("#train").click();
  await other.waitForFunction(() => !window.drawDiagnostics.busy);
  assert.ok((await other.locator("#error").innerText()).length > 0);
  await other.unroute("**/public/data/manifest.json");
  await other.locator("#train").click();
  await other.waitForFunction(() => window.drawDiagnostics.model, null, {
    timeout: 180000,
  });
  await other.close();
  // 3Dの失敗は計算機能を止めない。
  const fallback = await browser.newPage();
  await fallback.route("**/src/fly3d.js", (r) => r.abort());
  await fallback.goto(base + "/draw.html");
  await fallback.waitForFunction(() => window.drawDiagnostics?.three === false);
  await fallback
    .locator("#import")
    .setInputFiles({
      name: "note.json",
      mimeType: "application/json",
      buffer: note,
    });
  await fallback.waitForFunction(() => window.drawDiagnostics.model);
  await fallback.locator("#draw").click();
  await fallback.waitForFunction(() => window.drawDiagnostics.result, null, {
    timeout: 180000,
  });
  await fallback.close();
  console.log("Drawing E2E passed");
} finally {
  await browser.close();
}
