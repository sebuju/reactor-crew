const { test, expect } = require("@playwright/test");
const { execFileSync } = require("child_process");
const { record } = require("./report");

// Staged-engine probe: the wasm build ingests the served preset-0 dump
// in-browser and must reproduce the native digest bit-exactly. Stepping
// waits on sim_freeze + tail readers, so this asserts ingest+digest only.
test.beforeAll(async () => {
  execFileSync("node", ["tools/wasm-parity-assets.js"], { timeout: 600000 });
}, { timeout: 660000 });

test("wasm engine ingests preset-0 and matches native digest", async ({ page }) => {
  const t0 = Date.now();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });

  await page.goto("/?engine=wasm");
  await page.waitForFunction(() => window.__wasmParity &&
    ["match", "mismatch", "error"].includes(window.__wasmParity.stage),
    null, { timeout: 60000 });
  const rep = await page.evaluate(() => window.__wasmParity);
  console.log(rep);
  expect(errs).toEqual([]);
  expect(rep.stage).toBe("match");
  expect(rep.ok).toBe(true);
  expect(rep.digest).toBe(rep.expected);
  record({ name: "wasm parity, ingest digest match", t0, t1: Date.now() });
});
