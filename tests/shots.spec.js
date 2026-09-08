const { test } = require("@playwright/test");

/* generator, not a check: SHOTS=1 npx playwright test tests/shots.spec.js */
test.skip(!process.env.SHOTS, "set SHOTS=1 to regenerate README screenshots");

test.use({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });

const DIR = "screenshots/";

test("README screenshots", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.commission === "function");

  const whole = () => page.evaluate(() => { if (!zoomedOut()) zoomToggle(); });

  await page.evaluate(() => plantPreset(0));
  await whole();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: DIR + "design-bench.png" });

  await page.click('#tabs .tab[data-screen="operate"]');
  await page.waitForFunction(() => typeof S !== "undefined" && S && S.t > 7.5, null, { timeout: 60000 });
  await whole();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: DIR + "control-room.png" });

  await page.evaluate(() => { sel = roleId("ctrl"); uiDirty(); });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: DIR + "control-cabinet.png" });
});
