const { test, expect } = require("@playwright/test");
const { TICKS, SETTLE, prepare, runTarget, writer } = require("./dump");
const { record } = require("./report");

/* Every port on the stock PWR is shut in turn, each on a plant commissioned
   from scratch, and the next 50 ticks are dumped into one file. */
test("shut every port on the stock PWR in turn", async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  const t0 = Date.now();

  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });

  const head = await prepare(page);
  const ports = await page.evaluate(() =>
    portIds().map(p => [p, portLabel(p)]));

  const w = writer("shut-all-ports.csv",
    "stock PWR, one port shut at tick 0 after " + SETTLE + " settle ticks, " +
    TICKS + " ticks each", ["port", "label"], head);

  for (const [pid, label] of ports)
    w.block([pid, label], await runTarget(page, pid, 'act("portShut", arg);'));

  const bytes = w.close();
  expect(errs).toEqual([]);
  record({ name: "shut port, every port", t0, t1: Date.now(), file: w.file,
           targets: ports.length, rows: ports.length * TICKS,
           cols: head.length, bytes });
});
