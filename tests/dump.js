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
    /* the solved network is not on S, so it is re-solved here; noNat skips the second, pump-stopped solve. */
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
      const n = __net();
      out.push(__cols.map(c => __num(c[1] == null ? S[c[0]] : S[c[0]][c[1]]))
        .concat(__runs.map(k => n.byRun[k] == null ? null : n.byRun[k]))
        .concat(__nodes.map(k => n.byP[k] == null ? null : n.byP[k])));
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
