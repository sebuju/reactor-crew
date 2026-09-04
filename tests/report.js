const fs = require("fs");
const path = require("path");
const { stampSec, stampFile } = require("../tools/stamp");

/* Every spec files one line here as it finishes; globalTeardown turns the
   pile into the report. A file rather than a module variable because
   Playwright gives each spec its own worker process. */
const OUT = path.join(__dirname, "out");
const RUNS = path.join(OUT, ".runs.jsonl");
const REPORTS = path.join(__dirname, "reports");
const STARTED = path.join(OUT, ".started");

function begin() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(RUNS, "");
  fs.writeFileSync(STARTED, String(Date.now()));
}

function record(row) {
  fs.appendFileSync(RUNS, JSON.stringify(row) + "\n");
}

const dur = ms => {
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s";
};
const mb = b => (b / 1048576).toFixed(2) + " MB";
const pad = (v, n) => String(v).padEnd(n);
const rpad = (v, n) => String(v).padStart(n);

function end() {
  if (!fs.existsSync(RUNS)) return;
  const rows = fs.readFileSync(RUNS, "utf8").trim().split("\n")
    .filter(Boolean).map(l => JSON.parse(l)).sort((a, b) => a.t0 - b.t0);
  if (!rows.length) return;

  const t0 = Number(fs.readFileSync(STARTED, "utf8"));
  const t1 = Date.now();
  const L = [];
  L.push("REACTOR-CREW  TEST RUN");
  L.push("");
  L.push("started   " + stampSec(new Date(t0)));
  L.push("ended     " + stampSec(new Date(t1)));
  L.push("duration  " + dur(t1 - t0));
  L.push("");
  L.push(pad("TEST", 34) + pad("DURATION", 10) + rpad("TARGETS", 8) +
         rpad("ROWS", 8) + rpad("COLS", 6) + rpad("SIZE", 11) + "  CSV");
  for (const r of rows)
    L.push(pad(r.name, 34) + pad(dur(r.t1 - r.t0), 10) + rpad(r.targets || "-", 8) +
           rpad(r.rows || "-", 8) + rpad(r.cols || "-", 6) +
           rpad(r.bytes ? mb(r.bytes) : "-", 11) + "  " +
           (r.file ? path.basename(r.file) : "-"));
  L.push("");
  const tot = rows.reduce((a, r) => a + (r.bytes || 0), 0);
  L.push(rows.length + " tests, " + rows.reduce((a, r) => a + (r.rows || 0), 0) +
         " rows, " + mb(tot) + " of CSV");
  L.push("");
  L.push("The CSVs in tests/out/ are the LATEST run only - each run overwrites");
  L.push("them. This report is kept.");

  fs.mkdirSync(REPORTS, { recursive: true });
  const file = path.join(REPORTS, "run_" + stampFile(new Date(t0)) + ".txt");
  fs.writeFileSync(file, L.join("\n") + "\n");
  console.log("\n" + L.join("\n") + "\nreport    " + file);
}

module.exports = { begin, record, end };
