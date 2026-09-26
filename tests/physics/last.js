"use strict";
// node tests/physics/last.js [name|name.chunk ...]   what each check said on its last run, and whether the tree still is that tree
// node tests/physics/last.js --budget               every declared chunk's newest wall time against the suite's 5 min on 4 processes
// node tests/physics/last.js --batches [N]            the newest N batches, one report each
const fs = require("fs");
const {HARNESS, inputHashes, treeId, treeNote, list, resultKey, resultFiles, chunksOf, checkLine} = require("./lib.js");
const {batchList, batchReport} = require("./batch.js");
const {stampSec} = require("../../tools/stamp.js");
const {dur} = require("../report.js");
const DIR = __dirname;
const scripts = fs.readdirSync(DIR).sort().filter(f => f.endsWith(".js") && !HARNESS.includes(f)).map(f => f.slice(0, -3));
const pick = process.argv.slice(2);
if(pick[0] === "--batches"){
  for(const s of batchList(/^\d+$/.test(pick[1] || "") ? +pick[1] : 10)){ const h = s.head;
    console.log("== " + stampSec(new Date(s.last)) + " | " + (h.plan || "no plan") + " | " + (h.why || "no question stated").slice(0, 100));
    console.log("   " + s.att.length + " attempts, " + s.open + " unfinished | busy " + dur(s.busy) + " | " + s.pass + " pass, " + s.gap + " stated gaps, " + s.fail + " fail");
    console.log("   report " + h.report + "\n"); }
  process.exit(0);
}
if(pick[0] === "--budget"){
  const TARGET = 300, CEIL = 600, POOL = 4, rows = [], none = [], stale = [];
  for(const s of scripts){ let now = null;
    for(const a of chunksOf(s + ".js")){ const key = resultKey(s, a), all = resultFiles(key);
      if(!all.length){ none.push(key); continue; }
      now ??= inputHashes(s);
      const r = all.find(f => f.id === treeId(now)) || all[0], lines = fs.readFileSync(r.file, "utf8").split("\n").filter(l => l).map(l => JSON.parse(l));
      const last = lines[lines.length - 1];
      if(typeof last.ms !== "number"){ none.push(key); continue; }
      if(r.id !== treeId(now)) stale.push(key);
      rows.push([key, last.ms]); } }
  const sum = rows.reduce((t, r) => t + r[1], 0)/1000, pool = sum/POOL;
  console.log("timed " + rows.length + " chunks: " + sum.toFixed(0) + " s of process time, " + pool.toFixed(0) + " s on " + POOL + " processes | target " + TARGET + " s, ceiling " + CEIL + " s" + (pool > TARGET ? " | OVER by " + (pool - TARGET).toFixed(0) + " s" : ""));
  console.log("\nslowest:");
  for(const [k, ms] of rows.sort((p, q) => q[1] - p[1]).slice(0, 15)) console.log("  " + (ms/1000).toFixed(1).padStart(6) + " s  " + k + (stale.includes(k) ? "  STALE" : ""));
  if(none.length) console.log("\nno timing (" + none.length + "): " + none.join(" "));
  if(stale.length) console.log("\nstale timing (" + stale.length + "): " + stale.join(" "));
  process.exit(pool > TARGET ? 1 : 0);
}
const bogus = pick.filter(n => !scripts.includes(n.split(".")[0]));
if(bogus.length){
  console.error("last.js: no such check: " + bogus.join(" ") + "\nthe checks are:\n  " + scripts.join(" "));
  process.exit(2);
}

const want = [];
for(const s of scripts){
  const named = pick.filter(n => n.split(".")[0] === s);
  if(pick.length && !named.length) continue;
  for(const a of chunksOf(s + ".js")){ const key = resultKey(s, a);
    if(!pick.length || named.includes(s) || named.includes(key)) want.push([s, key]); }
}

const cur = {};

let pass = 0, gap = 0, fail = 0, stale = 0, none = 0, open = 0;
for(const [s, key] of want){
  const all = resultFiles(key);
  if(!all.length){ if(pick.length){ none++; console.log("== " + key + " | NO RESULT\n"); } continue; }
  const now = cur[s] ??= inputHashes(s), id = treeId(now), r = all.find(f => f.id === id) || all[0];
  const lines = fs.readFileSync(r.file, "utf8").split("\n").filter(l => l).map(l => JSON.parse(l));
  const head = lines[0], checks = lines.filter(l => l.name !== undefined), last = lines[lines.length - 1];
  const end = last.end === "done" ? "done" : last.end === "crashed" ? "CRASHED " + (last.err || "exit " + last.code)
    : last.end === "more" ? "STOPPED between rounds" : "KILLED or still running";
  if(last.end !== "done") open++;
  const moved = Object.keys(Object.assign({}, head.inputs, now)).filter(f => head.inputs[f] !== now[f]).sort();
  const on = treeNote(head.inputs, head.commit);
  console.log("== " + key + " | " + end + " | " + (moved.length ? "STALE, changed since: " + list(moved, 6) : "FRESH") + " | " + head.at + " on " + on + (all.length > 1 ? " | " + (all.length - 1) + " other trees kept" : ""));
  if(head.plan || head.why) console.log("   asked by " + (head.plan || "no plan") + ": " + (head.why || "no question stated"));
  const rep = head.batch && batchReport(head.batch);
  if(rep) console.log("   report " + rep);
  if(moved.length) stale++;
  for(const c of checks){ console.log(checkLine(c)); if(!moved.length){ if(c.pass) pass++; else if(c.gap) gap++; else fail++; } }
  console.log("");
}
console.log("fresh: " + pass + " pass, " + gap + " stated gaps, " + fail + " fail | " + stale + " stale, " + open + " incomplete" + (pick.length ? ", " + none + " never run" : ""));
process.exitCode = stale || open || none ? 1 : 0;
