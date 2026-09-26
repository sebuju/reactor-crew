"use strict";
// node tests/physics/run.js <name ...> --why="<question>" [--plan=<plan file>] [--blobs]   every chunk its own process, POOL at a time, killed at CHUNK_CAP; --blobs builds every snapshot blob its chunks want, paid for or not
const fs = require("fs"), path = require("path"), cp = require("child_process");
const {ASK, NOWHY, HARNESS, chunksOf, presetsOf, orderOf, checkLine} = require("./lib.js");
const {batchEnd, batchReport, batchRender, ledgerFile} = require("./batch.js");
const {REFUSED, snapChoose, snapBuild} = require("../../tools/snap.js");
const DIR = __dirname, CHUNK_CAP = 60000, POOL = 4;
const FORCE = process.argv.includes("--blobs"), pick = process.argv.slice(2).filter(a => a !== "--blobs");
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
for(const f of files) if(pick.includes(f.slice(0, -3))){ const pre = presetsOf(f), after = orderOf(f), first = jobs.length;
  chunksOf(f).forEach((a, k) => jobs.push({i:jobs.length, f, args:a, want:pre[k] === null ? "boot" : "p" + pre[k]}));
  for(const j of jobs.slice(first)){ const p = after[j.args.join(",")], k = p ? jobs.slice(first).findIndex(q => q.args.join(",") === p) : -1;
    if(p && k < 0) throw new Error(f + ": // order: names " + p + ", which is no chunk"); j.prev = k < 0 ? -1 : first + k; } }
const need = {};
for(const j of jobs) need[j.want] = (need[j.want] || 0) + 1;
const snap = snapChoose(need, FORCE), built = [];
// null: no blob; a pending promise while its build runs
const blob = {};
for(const w in snap.use) blob[w] = snap.build.includes(w) ? null : snap.use[w];

const env = Object.assign({}, process.env, {PHYSICS_RUNJS:"1", PHYSICS_PLAN:ASK.plan, PHYSICS_WHY:ASK.why});
function runOne(job, file){
  return new Promise(done => {
    const t = Date.now(), pre = file ? ["--snapshot-blob", file] : [];
    const ch = cp.spawn(process.execPath, pre.concat([path.join(DIR, job.f)], job.args), {env:Object.assign({}, env, {PHYSICS_T0:String(t)}, file ? {RC_SNAP_BLOB:file} : {})});
    let out = "", err = "", killed = false;
    ch.stdout.on("data", d => { out += d; });
    ch.stderr.on("data", d => { err += d; });
    const timer = setTimeout(() => { killed = true; ch.kill(); }, CHUNK_CAP);
    ch.on("close", code => {
      clearTimeout(timer);
      // a blob node would not load, or one refused before the check started: the chunk runs the plain way
      if(file && !/^@@SNAP /m.test(out)){ built.push({build:job.want, refused:job.f + " " + job.args.join(" "), err:err.trim().split("\n").slice(0, 2).join(" | ") || "exit " + code});
        return runOne(job, null).then(done); }
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
        rows.push({name:job.f + " " + job.args.join(" ") + " " + (killed ? "KILLED at " + CHUNK_CAP/1000 + " s" : "crashed"), pass:false, measured:"", truth:"", tol:"", source:why}); }
      done({rows, bad, batch:m && m[1]});
    });
  });
}

(async () => {
  const res = new Array(jobs.length), todo = snap.build.slice().sort((a, b) => need[b] - need[a]), queue = jobs.slice(), wait = {};
  const build = async w => { const r = await snapBuild(snap.dir, w);
    built.push({build:w, ms:r.ok ? r.ms : undefined, err:r.ok ? undefined : r.err, at:Date.now()});
    blob[w] = r.ok ? snap.use[w] : undefined; };
  for(const w of todo) wait[w] = new Promise(ok => { wait[w + "!"] = ok; });
  const ended = jobs.map(() => { let ok; const p = new Promise(r => { ok = r; }); p.ok = ok; return p; });
  const ready = j => (!(j.want in blob) || blob[j.want] !== null) && (!(j.prev >= 0) || res[j.prev] !== undefined);
  const lane = async () => { for(;;){
    const w = todo.shift();
    if(w){ await build(w); wait[w + "!"](); continue; }
    const k = queue.findIndex(ready);
    if(k >= 0){ const j = queue.splice(k, 1)[0]; res[j.i] = await runOne(j, blob[j.want] || null); ended[j.i].ok(); continue; }
    if(!queue.length) return;
    await Promise.race(queue.map(j => j.prev >= 0 && res[j.prev] === undefined ? ended[j.prev] : wait[j.want])); } };
  await Promise.all(Array.from({length:Math.min(POOL, jobs.length + todo.length)}, lane));
  const rows = res.flatMap(r => r.rows), bad = res.reduce((s, r) => s + r.bad, 0), landed = new Set(res.map(r => r.batch).filter(b => b));
  for(const c of rows) console.log(checkLine(c));
  console.log("\n" + rows.filter(c => c.pass).length + " pass, " + rows.filter(c => !c.pass && c.gap).length + " stated gaps, " + bad + " fail");
  for(const b of built) console.log("blob " + b.build + (b.refused ? " REFUSED for " + b.refused + ": " + b.err : b.err ? " build FAILED: " + b.err : " built in " + (b.ms/1000).toFixed(1) + " s"));
  for(const id of landed){ for(const b of built) fs.appendFileSync(ledgerFile(id), JSON.stringify(b) + "\n");
    batchRender(ledgerFile(id)); console.log("report    " + batchReport(id)); }
  process.exitCode = bad ? 1 : 0;
})();
