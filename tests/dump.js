const fs = require("fs");
const path = require("path");

/* The upset dumps share one column set and one writer. What differs between
   them is the target list and the one act() that stands for the upset. */
const TICKS = 50;
const SETTLE = 500;
/* MAP_MAX leaves out the cell fields (roomT and the 140-node core arrays) -
   they are 2040 and 140 columns wide and swamp the readings an upset moves. */
const MAP_MAX = 64;

/* Settles a stock PWR, fixes the column set off it and leaves the readers on
   window for every later evaluate() to use. */
async function prepare(page, opts) {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.commission === "function");
  await page.evaluate(([mapMax]) => {
    const num = v => typeof v === "number" ? v : v === true ? 1 : v === false ? 0 : null;
    window.__num = num;
    plantPreset(0); commission(); for (let i = 0; i < 50; i++) simTick();
    const cols = [];
    for (const k in S) {
      const v = S[k];
      if (typeof v === "number") cols.push([k, null]);
      else if (v && typeof v === "object" && !Array.isArray(v)) {
        const ks = Object.keys(v);
        if (!ks.length || ks.length > mapMax) continue;
        if (!ks.every(i => num(v[i]) !== null)) continue;
        for (const i of ks) cols.push([k, i]);
      }
    }
    window.__cols = cols;
    /* The solved network is not on S, so the per-run flow and the node
       pressure field have to be re-solved and read back the way every other
       reader does. noNat skips the second, pump-stopped solve - nothing here
       reads the NAT CIRC share. */
    window.__net = () => { const byRun = {}, byP = {};
      netFlowK(S, byRun, byP, {noNat: true}); return {byRun, byP}; };
    const seed = __net();
    window.__runs = Object.keys(seed.byRun).sort();
    window.__nodes = Object.keys(seed.byP).sort();
  }, [MAP_MAX]);

  return page.evaluate(() =>
    __cols.map(c => c[1] == null ? c[0] : c[0] + "." + c[1])
      .concat(__runs.map(k => "runFlow." + k))
      .concat(__nodes.map(k => "netP." + k)));
}

/* One target: a fresh plant, a settle, the upset, then TICKS rows. `upset` is
   the body of an act() call, given as source so it crosses into the page. */
function runTarget(page, arg, upsetSrc) {
  return page.evaluate(([arg, ticks, settle, src]) => {
    plantPreset(0);
    commission();
    for (let i = 0; i < settle; i++) simTick();
    (new Function("arg", src))(arg);
    const out = [];
    for (let i = 0; i < ticks; i++) {
      simTick();
      const n = __net();
      out.push(__cols.map(c => __num(c[1] == null ? S[c[0]] : S[c[0]][c[1]]))
        .concat(__runs.map(k => n.byRun[k] == null ? null : n.byRun[k]))
        .concat(__nodes.map(k => n.byP[k] == null ? null : n.byP[k])));
    }
    return out;
  }, [arg, TICKS, SETTLE, upsetSrc]);
}

/* 4 significant figures, trailing zeros stripped - a pressure needs 6 digits
   and a dose rate needs an exponent, and neither is worth a column of them. */
const round4 = v => v == null ? "" : v === 0 ? "0"
  : Number(Number(v).toPrecision(4)).toString();

/* A pipe cell target is named "pipe:x,y", so a key field carries a comma. */
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
