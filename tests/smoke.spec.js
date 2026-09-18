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
    const q = ST.sc;
    return { t: q[SC_T], P: q[SC_P], Tavg: q[SC_TAVG], inv: q[SC_INV], n: q[SC_N],
             mwE: eMWe(), sgP: ST.sgPBy[0] };
  });

  console.log(out);
  expect(errs).toEqual([]);
  for (const [k, v] of Object.entries(out)) expect(Number.isFinite(v), k).toBe(true);
  expect(out.Tavg).toBeGreaterThan(400);
  expect(out.mwE).toBeGreaterThan(0);
  record({ name: "smoke, stock PWR runs", t0, t1: Date.now() });
});
