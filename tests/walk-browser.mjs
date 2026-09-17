import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  acceptDownloads: true,
});
const base = (process.env.LAB_URL || "http://127.0.0.1:4389").replace(
  /\/$/,
  "",
);
const errors = [],
  requests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => requests.push(request.url()));
const results = {};
const state = () => page.evaluate(() => window.walkDiagnostics.state);
const advance = (ticks) =>
  page.evaluate((n) => window.walkDiagnostics.advance(n), ticks);
const command = (name) => page.locator(`[data-command=${name}]`).click();
const reset = () => page.locator("#reset").click();
const totalTurn = (records) =>
  records.slice(1).reduce((sum, item, i) => {
    const delta = item.yaw - records[i].yaw;
    return sum + Math.atan2(Math.sin(delta), Math.cos(delta));
  }, 0);
try {
  await page.goto(base + "/walk.html");
  assert.ok(await page.locator("#run").isDisabled());
  assert.ok(await page.locator("#seed").isDisabled());
  await page.locator("#load").click();
  await page.waitForFunction(() => window.walkDiagnostics.ready, null, {
    timeout: 120000,
  });
  assert.equal((await state()).tick, 0);

  // Actual physical trajectories, not position changes supplied by the renderer.
  for (const name of ["forward", "left", "right", "stop"]) {
    await reset();
    await command(name);
    await advance(20000);
    const result = await page.evaluate(() => window.walkDiagnostics.result);
    assert.equal(result.final.time, 2);
    assert.equal(result.records.length, 101);
    assert.ok(result.qpos.every(Number.isFinite));
    assert.ok(result.qvel.every(Number.isFinite));
    assert.ok(
      result.records.every((r) => r.position[2] > 0.5 && r.position[2] < 2),
    );
    assert.ok(
      result.records.some((r) => Object.values(r.contacts).some((n) => n > 0)),
    );
    results[name] = {
      displacement: result.final.displacement,
      distance: result.final.distance,
      totalTurn: totalTurn(result.records),
      final: result.final,
    };
    if (name === "forward") {
      assert.ok(result.final.displacement > 10);
      assert.ok(result.final.position[0] > result.records[0].position[0] + 10);
      await fs.writeFile(
        "artifacts/walk-forward-result.json",
        JSON.stringify(result, null, 2),
      );
      await page.screenshot({
        path: "artifacts/walk-desktop.png",
        fullPage: true,
      });
    }
  }
  assert.ok(results.left.totalTurn > 1);
  assert.ok(results.right.totalTurn < -1);
  assert.ok(results.stop.distance < results.forward.distance / 10);
  assert.ok(results.stop.displacement > 0); // Initial settling is not frozen animation.

  // Timed command changes, measured stopping, and reset determinism.
  const sequence = async () => {
    await reset();
    await command("forward");
    await advance(5000);
    await command("left");
    await advance(2000);
    await command("stop");
    await advance(5000);
    return page.evaluate(() => window.walkDiagnostics.result);
  };
  const first = await sequence(),
    second = await sequence();
  assert.deepEqual(second.events, first.events);
  assert.deepEqual(second.records, first.records);
  assert.deepEqual(second.qpos, first.qpos);
  const tail = second.records.slice(-11);
  const residual = Math.hypot(
    ...tail
      .at(-1)
      .position.slice(0, 2)
      .map((v, i) => v - tail[0].position[i]),
  );
  assert.ok(residual < 0.1, `Stop residual: ${residual} mm`);
  results.replay = {
    exact: true,
    ticks: second.final.tick,
    residualOverLast200ms: residual,
  };
  const contactSum = await page.locator("#contacts strong").allTextContents();
  assert.equal(
    contactSum.reduce((a, n) => a + Number(n), 0),
    Object.values(second.final.contacts).reduce((a, b) => a + b, 0),
  );

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export").click();
  await (await downloadPromise).saveAs("artifacts/fly-walking-export.json");
  const saved = JSON.parse(
    await fs.readFile("artifacts/fly-walking-export.json", "utf8"),
  );
  assert.equal(saved.brainConnected, false);
  assert.deepEqual(saved.qpos, second.qpos);
  assert.deepEqual(saved.events, first.events);

  // A different seed changes initial CPG phases; it must not be a fake selector.
  await page.locator("#seed").fill("2");
  await reset();
  await command("forward");
  await advance(5000);
  assert.notDeepEqual((await state()).position, first.records[25].position);
  await page.locator("#seed").fill("0");
  await reset();
  assert.ok(await page.locator("#error").isVisible());
  assert.equal((await state()).tick, 5000);
  await page.locator("#seed").fill("1");
  await reset();
  assert.ok(await page.locator("#error").isHidden());

  // Native buttons, keyboard control, wall-clock pause/resume, single stepping.
  await page.locator("#playground").focus();
  await page.keyboard.press("w");
  assert.equal((await state()).command, "forward");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.walkDiagnostics.state.tick > 100);
  await page.keyboard.press("Space");
  const paused = (await state()).tick;
  await page.waitForTimeout(300);
  assert.equal((await state()).tick, paused);
  await page.locator("#step").click();
  await page.waitForFunction(() => !window.walkDiagnostics.busy);
  assert.equal((await state()).tick, paused + 1000);
  await page.locator("#view").click();
  assert.match(await page.locator("#view").innerText(), /斜め/);
  await page.screenshot({ path: "artifacts/walk-top.png", fullPage: true });
  await page.locator("#view").click();

  // Reset invalidates an in-flight bounded calculation instead of finishing an old run.
  await page.evaluate(() => {
    window.walkDiagnostics.advance(20000);
  });
  await reset();
  await page.waitForTimeout(200);
  assert.equal((await state()).tick, 0);
  assert.equal(await page.evaluate(() => window.walkDiagnostics.busy), false);
  await page.locator("#run").click();
  await page.waitForFunction(() => window.walkDiagnostics.state.tick > 0);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.equal(
    await page.evaluate(() => window.walkDiagnostics.running),
    false,
  );

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Overflow at ${width}`,
    );
    if (width === 390)
      await page.screenshot({
        path: "artifacts/walk-mobile.png",
        fullPage: true,
      });
  }
  // The body page must not download the 79 MB neural dataset.
  assert.equal(
    requests.some(
      (url) => url.includes("/public/data/") && url.endsWith(".gz"),
    ),
    false,
  );

  // Missing runtime asset: actionable error followed by a working retry.
  await page.route("**/runtime/mujoco/mujoco.wasm", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await page.reload();
  await page.locator("#load").click();
  await page.waitForFunction(() => !document.querySelector("#error").hidden);
  assert.ok(await page.locator("#run").isDisabled());
  assert.ok(await page.locator("#load").isEnabled());
  await page.unroute("**/runtime/mujoco/mujoco.wasm");
  await page.locator("#load").click();
  await page.waitForFunction(() => window.walkDiagnostics.ready, null, {
    timeout: 120000,
  });
  assert.ok(await page.locator("#error").isHidden());
  assert.deepEqual(errors, []);
  results.errors = errors;
  results.base = base;
  await fs.writeFile(
    "artifacts/walk-browser-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log("Walking browser checks passed", JSON.stringify(results.replay));
} finally {
  await browser.close();
}
