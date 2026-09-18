const fs = require("fs");
const path = require("path");

const TICKS = 50;
const SETTLE = 500;
/* keeps the cell fields (roomT, the core arrays) out: 2040 and 140 columns wide, they swamp what an upset moves. */
const MAP_MAX = 64;

async function prepare(page, opts) {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.commission === "function");
  await page.evaluate(([mapMax]) => {
    plantPreset(0); commission(); for (let i = 0; i < 50; i++) simTick();
    /* [field, element, label]: plant scalars by name, every other state row short enough to read, by instance id */
    const cols = [], plant = SCHEMA.filter(r => r[2] === "plant");
    plant.forEach((r, i) => cols.push(["sc", i, r[0]]));
    for (const r of SCHEMA) {
      if ((r[4] || "s") !== "s" || r[2] === "plant") continue;
      const v = ST[r[0]]; if (!v || v.length > mapMax) continue;
      const ids = IX[r[2] + "Id"];
      for (let i = 0; i < v.length; i++) cols.push([r[0], i, r[0] + "." + (ids && ids[i] !== undefined ? ids[i] : i)]);
    }
    window.__cols = cols;
    window.__runs = IX.keyId.slice().sort();
    window.__nodes = IX.nodeId.slice().sort();
  }, [MAP_MAX]);

  return page.evaluate(() =>
    __cols.map(c => c[2])
      .concat(__runs.map(k => "runFlow." + k))
      .concat(__nodes.map(k => "netP." + k)));
}

/* `upsetSrc` is the body of an act() call, given as source so it crosses into the page. */
function runTarget(page, arg, upsetSrc) {
  return page.evaluate(([arg, ticks, settle, src]) => {
    plantPreset(0);
    commission();
    for (let i = 0; i < settle; i++) simTick();
    (new Function("arg", src))(arg);
    const out = [];
    for (let i = 0; i < ticks; i++) {
      simTick();
      out.push(__cols.map(c => ST[c[0]][c[1]])
        .concat(__runs.map(k => uiRunKgs(k)))
        .concat(__nodes.map(k => { const v = uiNodeP(k); return v === undefined ? null : v; })));
    }
    return out;
  }, [arg, TICKS, SETTLE, upsetSrc]);
}

const round4 = v => v == null ? "" : v === 0 ? "0"
  : Number(Number(v).toPrecision(4)).toString();

/* a pipe cell target is named "pipe:x,y", so a key field carries a comma. */
const cell = v => /[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v;

function writer(name, comment, keyCols, head) {
  const dir = path.join(__dirname, "out");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const fd = fs.openSync(file, "w");
  fs.writeSync(fd, "# " + comment + "\n");
  fs.writeSync(fd, keyCols.join(",") + ",tick," + head.join(",") + "\n");
  return {
    file,
    block(keys, rows) {
      fs.writeSync(fd, rows.map((row, i) =>
        keys.map(cell).join(",") + "," + (i + 1) + "," +
        row.map(round4).join(",")).join("\n") + "\n");
    },
    close() { fs.closeSync(fd); return fs.statSync(file).size; },
  };
}

module.exports = { TICKS, SETTLE, MAP_MAX, prepare, runTarget, writer };
