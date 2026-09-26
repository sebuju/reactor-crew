"use strict";
// node tests/physics/run.js <name ...> --why="<question>" [--plan=<plan file>]   every chunk its own process, POOL at a time, killed at CHUNK_CAP
const fs = require("fs"), path = require("path"), cp = require("child_process");
const {ASK, NOWHY, HARNESS, chunksOf, checkLine} = require("./lib.js");
const {batchEnd, batchReport, batchRender, ledgerFile} = require("./batch.js");
const DIR = __dirname, CHUNK_CAP = 60000, POOL = 4;
const pick = process.argv.slice(2);
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
for(const f of files) if(pick.includes(f.slice(0, -3))) for(const a of chunksOf(f)) jobs.push([f, a]);

const env = Object.assign({}, process.env, {PHYSICS_RUNJS:"1", PHYSICS_PLAN:ASK.plan, PHYSICS_WHY:ASK.why});
function runOne([f, args]){
  return new Promise(done => {
    const t = Date.now(), ch = cp.spawn(process.execPath, [path.join(DIR, f)].concat(args), {env});
    let out = "", err = "", killed = false;
    ch.stdout.on("data", d => { out += d; });
    ch.stderr.on("data", d => { err += d; });
    const timer = setTimeout(() => { killed = true; ch.kill(); }, CHUNK_CAP);
    ch.on("close", code => {
      clearTimeout(timer);
      const rows = [], m = /^@@BATCH (\S+) /m.exec(out);
      for(const line of out.split("\n")){ if(!line.startsWith("@@CHECK ")) continue;
        try { rows.push(JSON.parse(line.slice(8))); } catch(e){} }
      let bad = rows.filter(c => !c.pass && !c.gap).length;
      if(killed || code !== 0){
        bad++;
        const end = killed ? "killed" : "crashed", why = err.trim().split("\n").slice(0, 3).join(" | ") ||
          (killed ? "killed by run.js at " + CHUNK_CAP/1000 + " s" : "exit " + code);
        // a child that died before it printed @@BATCH joined no batch, so there is no ledger to book it in
        if(m) batchEnd(m[1], ch.pid, {end, err:why, ms:Date.now() - t, checks:rows});
        rows.push({name:f + " " + args.join(" ") + " " + (killed ? "KILLED at " + CHUNK_CAP/1000 + " s" : "crashed"), pass:false, measured:"", truth:"", tol:"", source:why}); }
      done({rows, bad, batch:m && m[1]});
    });
  });
}

(async () => {
  const res = new Array(jobs.length);
  let next = 0;
  const lane = async () => { while(next < jobs.length){ const i = next++; res[i] = await runOne(jobs[i]); } };
  await Promise.all(Array.from({length:Math.min(POOL, jobs.length)}, lane));
  const rows = res.flatMap(r => r.rows), bad = res.reduce((s, r) => s + r.bad, 0), landed = new Set(res.map(r => r.batch).filter(b => b));
  for(const c of rows) console.log(checkLine(c));
  console.log("\n" + rows.filter(c => c.pass).length + " pass, " + rows.filter(c => !c.pass && c.gap).length + " stated gaps, " + bad + " fail");
  for(const id of landed){ batchRender(ledgerFile(id)); console.log("report    " + batchReport(id)); }
  process.exitCode = bad ? 1 : 0;
})();
