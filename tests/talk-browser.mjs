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
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const idle = () =>
  page.waitForFunction(
    () => window.talkDiagnostics && !window.talkDiagnostics.busy,
    null,
    { timeout: 180000 },
  );
const base = "http://127.0.0.1:4389";
try {
  await page.goto(base + "/talk.html");
  await page.waitForFunction(() => window.talkDiagnostics?.three === true);
  await page.locator("#message").fill("こんにちは");
  await page.locator("#send").click();
  assert.ok(
    (await page.locator("#error").innerText()).includes("変換できません"),
  );
  assert.equal(
    await page.evaluate(() => window.talkDiagnostics.records.length),
    0,
  );
  await page.locator("[data-command=come]").click();
  await idle();
  let frames = await page.evaluate(
    () => window.talkDiagnostics.records[0].frames,
  );
  assert.equal(frames.length, 16);
  assert.ok(frames.some((f) => f.output.key === "forward"));
  assert.equal(await page.locator("#reaction-frame option").count(), 16);
  await page.screenshot({ path: "artifacts/talk-result.png", fullPage: true });
  await page.locator("[data-command=wait]").click();
  await idle();
  assert.equal(
    await page.evaluate(() => window.talkDiagnostics.last.tick),
    6400,
  );
  await page.locator("#reaction-frame").selectOption("0");
  assert.equal(
    await page.evaluate(() => window.talkDiagnostics.last.tick),
    3400,
  );
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const file = await download;
  await file.saveAs("artifacts/fly-conversation.json");
  const data = JSON.parse(await fs.readFile("artifacts/fly-conversation.json"));
  assert.equal(data.records.length, 2);
  assert.equal(data.records[1].frames[0].tick, 3400);
  await page.locator("#message").fill("右を見て");
  await page.locator("#message").press("Enter");
  await page.waitForFunction(() => window.talkDiagnostics.busy);
  await page.locator("#pause").click();
  await idle();
  const length = await page.evaluate(
    () => window.talkDiagnostics.records.at(-1).frames.length,
  );
  assert.ok(length < 16);
  await page.locator("[data-command=wait]").click();
  await idle();
  assert.equal(
    await page.evaluate(
      () => window.talkDiagnostics.records.at(-1).frames[0].tick,
    ),
    6400 + length * 200 + 200,
  );
  await page.locator("#propagation").uncheck();
  assert.ok(await page.locator("#send").isDisabled());
  await page.locator("#reset").click();
  await page.locator("[data-command=come]").click();
  await idle();
  assert.equal(await page.locator("#subtitle").innerText(), "……");
  assert.ok(
    await page.evaluate(() =>
      window.talkDiagnostics.records[0].frames.every((f) =>
        f.motor.every((v) => v === 0),
      ),
    ),
  );
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `overflow ${width}`,
    );
    await page.screenshot({
      path: `artifacts/talk-${width}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  const p = await browser.newPage();
  await p.route("**/public/data/manifest.json", (r) =>
    r.fulfill({ status: 404, body: "missing" }),
  );
  await p.goto(base + "/talk.html");
  await p.locator("[data-command=come]").click();
  await p.waitForFunction(() => !window.talkDiagnostics.busy);
  assert.ok((await p.locator("#error").innerText()).length > 0);
  await p.unroute("**/public/data/manifest.json");
  await p.locator("[data-command=come]").click();
  await p.waitForFunction(
    () => window.talkDiagnostics.records[0]?.complete,
    null,
    { timeout: 180000 },
  );
  await p.close();
  const fallback = await browser.newPage();
  await fallback.route("**/src/fly3d.js", (r) => r.abort());
  await fallback.goto(base + "/talk.html");
  await fallback.waitForFunction(() => window.talkDiagnostics?.three === false);
  await fallback.locator("[data-command=wait]").click();
  await fallback.waitForFunction(
    () => window.talkDiagnostics.records[0]?.complete,
    null,
    { timeout: 180000 },
  );
  assert.equal(
    await fallback.evaluate(() => window.talkDiagnostics.last.spikes),
    0,
  );
  await fallback.close();
  console.log("Talk E2E passed");
} finally {
  await browser.close();
}
