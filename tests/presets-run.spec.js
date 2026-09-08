const { test, expect } = require("@playwright/test");
const { record } = require("./report");

/* the AUTOSYS bypass tiles are not alarms: they say where a switch is standing, and every preset commissions with RPS defeated. */
const SECS = 60;
const TICKS = SECS * 50;   // simTick() steps a literal 0.02 s

test("every preset commissions and holds for 60 s with no alarm", async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  const t0 = Date.now();

  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });

  await page.goto("/");
  await page.waitForFunction(() => typeof window.commission === "function");
  const presets = await page.evaluate(() => PLANTPRE.map(p => p[0]));

  const flown = [];
  let bad = null;
  for (let i = 0; i < presets.length && !bad; i++) {
    const r = await page.evaluate(([i, ticks]) => {
      const skip = new Set(AUTOKEYS.map(k => AUTOSYS[k].ann));
      plantPreset(i);
      commission();
      for (let k = 0; k < ticks; k++) {
        simTick();
        const lit = Object.keys(S.annOn).filter(n => S.annOn[n] && !skip.has(n));
        if (lit.length) return { lit, tick: k + 1, t: S.t };
      }
      return { lit: [], tick: ticks, t: S.t };
    }, [i, TICKS]);
    r.name = presets[i];
    flown.push(r);
    console.log(r.name.padEnd(11) + (r.lit.length
      ? "ALARM  " + r.lit.join(", ") + "  at t=" + r.t.toFixed(2) + " s"
      : "clear  " + SECS + " s"));
    if (r.lit.length) bad = r;
  }

  record({ name: "presets, 60 s each", t0, t1: Date.now(), targets: flown.length });

  expect(errs).toEqual([]);
  expect(bad && bad.name + " lit " + bad.lit.join(", ") + " at t=" +
         bad.t.toFixed(2) + " s (tick " + bad.tick + " of " + TICKS + "); " +
         (presets.length - flown.length) + " of " + presets.length +
         " presets not flown").toBeNull();
});
