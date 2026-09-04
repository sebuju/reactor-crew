const { test, expect } = require("@playwright/test");
const { record } = require("./report");

test("stock PWR commissions and runs", async ({ page }) => {
  const t0 = Date.now();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });

  await page.goto("/");
  await page.waitForFunction(() => typeof window.commission === "function");

  const out = await page.evaluate(() => {
    plantPreset(0);
    commission();
    for (let i = 0; i < 1500; i++) simTick();
    return { t: S.t, P: S.P, Tavg: S.Tavg, inv: S.inv, n: S.n,
             mwE: mwE(S), sgP: S.sgPBy[Object.keys(S.sgPBy)[0]] };
  });

  console.log(out);
  expect(errs).toEqual([]);
  for (const [k, v] of Object.entries(out)) expect(Number.isFinite(v), k).toBe(true);
  expect(out.Tavg).toBeGreaterThan(400);
  expect(out.mwE).toBeGreaterThan(0);
  record({ name: "smoke, stock PWR runs", t0, t1: Date.now() });
});
