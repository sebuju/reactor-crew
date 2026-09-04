const { test, expect } = require("@playwright/test");
const { TICKS, SETTLE, prepare, runTarget, writer } = require("./dump");
const { record } = require("./report");

/* Every machine on the stock PWR takes one aimed combat hit in turn, each on a
   plant commissioned from scratch, and so do every port and every pipe RUN - a
   run is one aimed shot at its middle cell rather than one shot per cell,
   because what is being measured is losing that connection and not the length
   of it. */
test("hit every machine, port and pipe run on the stock PWR", async ({ page }) => {
  test.setTimeout(60 * 60 * 1000);
  const t0 = Date.now();

  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });

  const head = await prepare(page);
  const targets = await page.evaluate(() => {
    /* combatHit() refuses a shield and an unfitted part, so a target it would
       decline is never offered - a row of fifty unchanged ticks says nothing. */
    const out = LAY.parts.filter(q => q.grp !== "shield" && fitted(q))
      .map(q => [q.id, partName(q), "machine"]);
    for (const pid of portIds()) out.push(["port:" + pid, portLabel(pid), "port"]);
    const M = pipeMap();
    for (const key of Object.keys(M.byKey).sort()) {
      const cells = M.byKey[key].cells;
      /* A run between two port-adjacent machines spans no pipe cell at all,
         so there is nothing on the board to aim at. */
      if (!cells.length) continue;
      const [x, y] = cells[Math.floor(cells.length / 2)];
      out.push(["pipe:" + x + "," + y, key, "run"]);
    }
    return out;
  });

  const w = writer("hit-all-targets.csv",
    "stock PWR, one aimed combat hit at tick 0 after " + SETTLE +
    " settle ticks, " + TICKS + " ticks each; a pipe run is one hit on its " +
    "middle cell", ["target", "label", "kind"], head);

  for (const [id, label, kind] of targets)
    w.block([id, label, kind], await runTarget(page, id, 'act("hit", arg);'));

  const bytes = w.close();
  expect(errs).toEqual([]);
  record({ name: "combat hit, every target", t0, t1: Date.now(), file: w.file,
           targets: targets.length, rows: targets.length * TICKS,
           cols: head.length, bytes });
});
