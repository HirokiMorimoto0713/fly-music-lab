import { createRequire } from "node:module";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.LAB_URL || "http://127.0.0.1:4389";
const artifacts = new URL("../artifacts/", import.meta.url);
await fs.mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function download(id, name) {
  const p = page.waitForEvent("download");
  await page.locator("#" + id).click();
  const d = await p;
  const target = new URL(name, artifacts);
  await d.saveAs(target.pathname);
  return fs.readFile(target);
}
async function untilFrame(n) {
  await page.waitForFunction((n) => window.labDiagnostics?.frames >= n, n, {
    timeout: 120000,
  });
}
try {
  await page.goto(base);
  await page.screenshot({
    path: new URL("initial.png", artifacts).pathname,
    fullPage: true,
  });
  assert.ok(await page.locator("#start").isEnabled());
  const bounds = await page.locator("#start").boundingBox();
  assert.ok(
    bounds.y + bounds.height <= 800,
    "Start visible above fold on desktop",
  );
  await page.locator("#start").click();
  await untilFrame(3);
  console.log("real data loaded");
  assert.deepEqual(
    await page.evaluate(() => [
      window.labDiagnostics.n,
      window.labDiagnostics.edges,
    ]),
    [166700, 25582938],
  );
  await page.locator("[data-stim=left]").click();
  await untilFrame(6);
  await page.locator("[data-stim=right]").click();
  await untilFrame(9);
  await page.locator("[data-stim=flight]").click();
  await untilFrame(12);
  await page.locator("#stop").click();
  const diag = await page.evaluate(() => ({
    frames: window.labDiagnostics.frames,
    total: window.labDiagnostics.totalSpikes,
    notes: window.labDiagnostics.noteCount,
  }));
  await page.waitForTimeout(400);
  assert.deepEqual(
    await page.evaluate(() => ({
      frames: window.labDiagnostics.frames,
      total: window.labDiagnostics.totalSpikes,
      notes: window.labDiagnostics.noteCount,
    })),
    diag,
    "Stop freezes outputs",
  );
  assert.ok(diag.notes > 0);
  assert.ok(diag.total > 0);
  await page.screenshot({
    path: new URL("playing.png", artifacts).pathname,
    fullPage: true,
  });
  const originalMidi = await download("midi", "original.mid");
  const json = await download("json", "experiment.json");
  const exp = JSON.parse(json);
  assert.equal(exp.frames, diag.frames);
  assert.ok(exp.stimuli.some((s) => s.target === "left"));
  assert.ok(exp.stimuli.some((s) => s.target === "right"));
  assert.ok(exp.stimuli.some((s) => s.target === "flight"));
  const wav = await download("wav", "performance.wav");
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  let peak = 0,
    energy = 0;
  for (let i = 44; i < wav.length; i += 2) {
    const s = wav.readInt16LE(i);
    peak = Math.max(peak, Math.abs(s));
    energy += s * s;
  }
  assert.ok(
    peak > 100 && peak < 32767,
    "Audible, unclipped synthesized waveform",
  );
  assert.ok(energy > 0);
  await page.locator("#favorite").click();
  assert.equal(await page.locator(".saved-item").count(), 1);
  await page.locator("#replay").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#status")
        .textContent.startsWith("演奏が終わりました"),
    null,
    { timeout: 120000 },
  );
  const replayMidi = await download("midi", "replay.mid");
  assert.deepEqual(replayMidi, originalMidi, "Exact MIDI replay");
  await page.locator("#compare").click();
  await page.waitForFunction(
    () => window.labDiagnostics?.comparison?.length === 2,
    null,
    { timeout: 120000 },
  );
  const comparison = await page.evaluate(
    () => window.labDiagnostics.comparison,
  );
  assert.notEqual(comparison[0].total, comparison[1].total);
  console.log(
    "exports/replay/comparison",
    JSON.stringify({ diag, peak, wavBytes: wav.length, comparison }),
  );
  await page
    .locator("#import")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"format":"bad"}'),
    });
  assert.ok(await page.locator("#error").isVisible());
  await page
    .locator("#import")
    .setInputFiles(new URL("experiment.json", artifacts).pathname);
  assert.ok(await page.locator("#error").isHidden());
  assert.ok(await page.locator("#midi").isDisabled());
  await page.reload();
  assert.equal(await page.locator(".saved-item").count(), 1);
  await page
    .locator("#import")
    .setInputFiles(new URL("experiment.json", artifacts).pathname);
  await page.locator("#replay").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#status")
        .textContent.startsWith("演奏が終わりました"),
    null,
    { timeout: 120000 },
  );
  assert.deepEqual(
    await download("midi", "restored.mid"),
    originalMidi,
    "JSON restore replays same music",
  );
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await page.waitForTimeout(150);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "No overflow at " + width,
    );
    if (width === 390)
      await page.screenshot({
        path: new URL("mobile.png", artifacts).pathname,
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    path: new URL("desktop.png", artifacts).pathname,
    fullPage: true,
  });
  for (const target of ["docs/guide.md", "docs/model.md"])
    assert.equal((await page.request.get(base + "/" + target)).status(), 200);
  // データ欠落をブラウザ上で再現し、同じページから再試行できるか確認。
  const broken = await context.newPage();
  await broken.route("**/public/data/manifest.json", (r) =>
    r.fulfill({ status: 404, body: "missing" }),
  );
  await broken.goto(base);
  await broken.locator("#start").click();
  await broken.locator("#error").waitFor({ state: "visible", timeout: 30000 });
  assert.match(await broken.locator("#error").innerText(), /prepare:data/);
  await broken.unroute("**/public/data/manifest.json");
  await broken.locator("#start").click();
  await broken.waitForFunction(() => window.labDiagnostics?.frames >= 1, null, {
    timeout: 120000,
  });
  await broken.locator("#stop").click();
  await broken.close();
  assert.deepEqual(errors, []);
  await fs.writeFile(
    new URL("browser-results.json", artifacts),
    JSON.stringify(
      { pass: true, diag, peak, wavBytes: wav.length, comparison, errors },
      null,
      2,
    ),
  );
  console.log(
    "PASS browser core flow, all exports, seeded replay, restore, control, missing data recovery, four widths",
  );
} finally {
  await browser.close();
}
