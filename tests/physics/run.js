"use strict";
// node tests/physics/run.js <name ...> --why="<question>" [--plan=<plan file>]   every script runs in its own process under a 10 s timeout
const fs = require("fs"), path = require("path"), cp = require("child_process");
const {ASK, NOWHY, HARNESS, chunksOf, checkLine} = require("./lib.js");
const {batchEnd, batchReport} = require("./batch.js");
const DIR = __dirname, LIMIT = 10000;
const pick = process.argv.slice(2);
// no run-everything switch by design: the 10 s timeout caps one process, never the suite
if(!pick.length){
  console.error("run.js answers a named question. Name the scripts:\n" +
    '  node tests/physics/run.js decay xenon --why="..."    two scripts\n' +
    '  node tests/physics/presets.js 3 --why="..."          one chunk, one process\n' +
    "There is no flag for all of them.");
  process.exit(2);
}
if(!ASK.why){ console.error("run.js: " + NOWHY); process.exit(2); }
const files = fs.readdirSync(DIR).sort().filter(f => f.endsWith(".js") && !HARNESS.includes(f));
// a name that matches nothing would otherwise print a clean "0 pass, 0 fail" and exit 0
const bogus = pick.filter(n => !files.includes(n + ".js"));
if(bogus.length){
  console.error("run.js: no such check: " + bogus.join(" ") + "\nthe checks are:\n  " +
    files.map(f => f.slice(0, -3)).join(" "));
  process.exit(2);
}

const jobs = [];
for(const f of files){
  if(pick.includes(f.slice(0, -3))) for(const a of chunksOf(f)) jobs.push([f, a]);
}

const rows = [], landed = new Set();
let bad = 0;
for(const [f, args] of jobs){
  let more = true, round = 0;
  while(more){
    const t = Date.now(), r = cp.spawnSync(process.execPath, [path.join(DIR, f)].concat(args, round ? ["--resume"] : []),
      {encoding:"utf8", timeout:LIMIT, maxBuffer:64*1024*1024, env:Object.assign({}, process.env, {PHYSICS_RUNJS:"1", PHYSICS_PLAN:ASK.plan, PHYSICS_WHY:ASK.why})});
    more = false;
    const checks = [], m = /^@@BATCH (\S+) /m.exec(r.stdout || "");
    if(m) landed.add(m[1]);
    for(const line of (r.stdout || "").split("\n")){
      if(line === "@@MORE"){ more = true; round++; continue; }
      if(!line.startsWith("@@CHECK ")) continue;
      let c; try { c = JSON.parse(line.slice(8)); } catch(e){ continue; }
      rows.push(c); checks.push(c);
      if(!c.pass && !c.gap) bad++;
    }
    if(r.error || r.status !== 0){
      bad++; more = false;
      const end = r.error && r.error.code === "ETIMEDOUT" ? "killed" : "crashed", err = (r.stderr || "").trim().split("\n").slice(0, 3).join(" | ") ||
        (end === "killed" ? "killed by run.js at " + LIMIT/1000 + " s" : "exit " + r.status);
      // a child that died before it printed @@BATCH joined no batch, so there is no ledger to book it in
      if(m) batchEnd(m[1], r.pid, {end, err, ms:Date.now() - t, checks});
      rows.push({name:f + " " + args.join(" ") + " " + (end === "killed" ? "KILLED at " + LIMIT/1000 + " s" : "crashed"), pass:false, measured:"", truth:"", tol:"", source:err}); }
  }
}
for(const c of rows) console.log(checkLine(c));
console.log("\n" + rows.filter(c => c.pass).length + " pass, " + rows.filter(c => !c.pass && c.gap).length + " stated gaps, " + bad + " fail");
for(const id of landed) console.log("report    " + batchReport(id));
process.exitCode = bad ? 1 : 0;
