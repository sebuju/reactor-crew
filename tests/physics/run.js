"use strict";
// node tests/physics/run.js <name ...> --why="<question>" [--plan=<plan file>]   every script runs in its own process under a 10 s timeout
const fs = require("fs"), path = require("path"), cp = require("child_process");
const {ASK, NOWHY, HARNESS, chunksOf, checkLine, resultKey, inputHashes, gitHead, treeNote, writeReport} = require("./lib.js");
const DIR = __dirname;
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

const rows = [], done = [], t0 = Date.now();
let bad = 0;
for(const [f, args] of jobs){
  let more = true, round = 0;
  const job = {key:resultKey(f.slice(0, -3), args), t0:Date.now(), end:"done", checks:[]};
  while(more){
    const r = cp.spawnSync(process.execPath, [path.join(DIR, f)].concat(args, round ? ["--resume"] : []),
      {encoding:"utf8", timeout:10000, maxBuffer:64*1024*1024, env:Object.assign({}, process.env, {PHYSICS_RUNJS:"1", PHYSICS_PLAN:ASK.plan, PHYSICS_WHY:ASK.why})});
    more = false;
    if(r.error || r.status !== 0){
      bad++;
      job.end = r.error && r.error.code === "ETIMEDOUT" ? "KILLED at 10 s" : "crashed";
      const c = {name:f + " " + args.join(" ") + " " + job.end,
        pass:false, measured:"", truth:"", tol:"", source:(r.stderr || "").split("\n").slice(0, 3).join(" | ")};
      rows.push(c); job.checks.push(c);
      break; }
    for(const line of r.stdout.split("\n")){
      if(line === "@@MORE"){ more = true; round++; continue; }
      if(!line.startsWith("@@CHECK ")) continue;
      const c = JSON.parse(line.slice(8));
      rows.push(c); job.checks.push(c);
      if(!c.pass && !c.gap) bad++;
    }
  }
  job.ms = Date.now() - job.t0; done.push(job);
}
for(const c of rows) console.log(checkLine(c));
console.log("\n" + rows.filter(c => c.pass).length + " pass, " + rows.filter(c => !c.pass && c.gap).length + " stated gaps, " + bad + " fail");
console.log("report    " + writeReport({t0, t1:Date.now(), asked:"node tests/physics/run.js " + pick.join(" "),
  tree:treeNote(Object.assign({}, ...pick.map(inputHashes)), gitHead()), jobs:done}));
process.exitCode = bad ? 1 : 0;
