import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
});
const page = await browser.newPage();
try {
  await page.goto("http://127.0.0.1:4389");
  await page.locator("#start").click();
  await page.waitForFunction(() => window.labDiagnostics?.frames >= 3, null, {
    timeout: 120000,
  });
  await page.locator("#stop").click();
  // 準備中の中断で前の実験のseedを新しい値に書き換えない。
  await page.evaluate(() => {
    document.querySelector("#seed").value = 42;
    document.querySelector("#start").click();
    document.querySelector("#stop").click();
  });
  const downloaded = page.waitForEvent("download");
  await page.locator("#json").click();
  const file = await (await downloaded).path();
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).config.seed, 1);
  // 無刺激はUIでも無音。データを読み込めたことをランダム音で代替しない。
  await page.locator("#strength").fill("0");
  await page.locator("#start").click();
  await page.waitForFunction(
    () =>
      window.labDiagnostics?.frames >= 3 &&
      window.labDiagnostics.totalSpikes === 0,
  );
  await page.locator("#stop").click();
  assert.equal(await page.locator("#note-count").innerText(), "0 notes");
  assert.ok(await page.locator("#wav").isDisabled());
  assert.ok(await page.locator("#midi").isDisabled());
  // 通常の128ステップ終了まで確認する。
  await page.locator("#seed").fill("1");
  await page.locator("#strength").fill("160");
  await page.locator("#start").click();
  await page.waitForFunction(
    () =>
      window.labDiagnostics?.frames === 128 &&
      document
        .querySelector("#status")
        .textContent.startsWith("演奏が終わりました"),
    null,
    { timeout: 120000 },
  );
  assert.ok(await page.locator("#start").isEnabled());
  assert.ok(await page.locator("#stop").isDisabled());
  const results = await page.evaluate(() => ({
    frames: window.labDiagnostics.frames,
    spikes: window.labDiagnostics.totalSpikes,
    notes: window.labDiagnostics.noteCount,
  }));
  await fs.writeFile(
    new URL("../artifacts/lifecycle-results.json", import.meta.url),
    JSON.stringify({ pass: true, ...results }, null, 2),
  );
  console.log(
    "PASS cancellation preserves conditions, silent zero-input, full length",
    results,
  );
} finally {
  await browser.close();
}
