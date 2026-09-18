const { test, expect } = require("@playwright/test");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { record } = require("./report");

// Step parity: the wasm build ingests the served preset-0 dump, freezes its
// tables, steps it in-browser, and must reproduce the native engine's digest
// on every tick. Native is pinned to the JS march by `step-probe --live`.
test.beforeAll(async () => {
  execFileSync("node", ["tools/wasm-parity-assets.js"], { timeout: 600000 });
}, { timeout: 660000 });

test("wasm engine steps preset-0 and matches native digest per tick", async ({ page }) => {
  const t0 = Date.now();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  const exp = JSON.parse(fs.readFileSync(path.join("tests", "out", "wasm-parity", "expected.json"), "utf8"));

  await page.goto("/?engine=wasm-parity");
  await page.waitForFunction(() => window.__wasmParity &&
    ["match", "mismatch", "error"].includes(window.__wasmParity.stage),
    null, { timeout: 120000 });
  const rep = await page.evaluate(() => window.__wasmParity);
  console.log(rep);
  expect(errs).toEqual([]);
  expect(rep.digest).toBe(rep.expected);
  expect(rep.ticks).toEqual(exp.ticks);
  expect(rep.stage).toBe("match");
  expect(rep.ok).toBe(true);
  record({ name: "wasm parity, " + exp.ticks.length + " ticks digest match", t0, t1: Date.now() });
});
