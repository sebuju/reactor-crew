#!/usr/bin/env node
/* audit-physics.js, spread across every core.
   Usage:  node tools/audit-par.js

   The auditor is ~154 independent checks run down one thread. Every one of them
   opens with set(), which rewrites D wholesale from BASE and re-commissions, so
   nothing carries from one to the next - the same argument sweep.js already
   makes about the design sweep, and the same reason this is embarrassingly
   parallel. headless() evaluates the bundle through `new Function`, so the
   page's top-level `const D` / `let S` / `let P` are function-scoped: each
   worker gets a completely separate plant with nothing shared and nothing to
   lock.

   IT RUNS THE REAL FILE, never a copy. audit-physics.js is read, its checks are
   found by tools/audit-split.js, and each shard is handed the same source with
   `if(__own[i]%__N===__K)` around the ones it owns. A check edited in
   audit-physics.js is a check this runs, immediately and without anyone
   remembering to sync anything.

   WHAT IT IS WORTH, measured rather than hoped: 177 s serial against 67-78 s
   here, run to run. It is NOT twelve times faster and it never will be - the
   sweep block alone is ~25 s and runs inside one shard, so that is the floor,
   and the spread between two identical runs is nearly ten seconds.

   OUTPUT IS IN FILE ORDER, not in the order the threads finished. Every line a
   check prints is tagged with the unit that printed it, and the section headers
   between units are tagged with the unit they precede, so the report reads
   exactly as the serial one does. That is checked, not asserted: run this and
   `node tools/audit-physics.js` and diff the two.

   `process.exit` is shimmed away inside the shard - the auditor ends on one,
   and in a worker that would take the whole run down with it. */
"use strict";
const { Worker, isMainThread, workerData, parentPort } = require("worker_threads");
const fs = require("fs"), path = require("path");
const { split, groups } = require("./audit-split");

const SRC = path.join(__dirname, "audit-physics.js");

/* ── the source, with each shard's own units gated in ── */
function shardSource(){
  /* the shebang is a comment to a shell and a syntax error to new Function */
  const src = fs.readFileSync(SRC, "utf8").replace(/\r/g, "").replace(/^#!.*\n/, "\n");
  const r = split(src);
  const lines = r.lines.slice();
  const inUnit = new Uint8Array(lines.length);
  for(const u of r.units) for(let i = u.from; i <= u.to; i++) inUnit[i] = 1;

  /* a header printed between units belongs just before the unit that follows
     it, which is what keeps the report in file order once the threads have
     shuffled the units among themselves */
  const nextAt = new Int32Array(lines.length);
  for(let i = lines.length - 1, seen = r.units.length; i >= 0; i--){
    const u = r.units.find(x => x.from === i);
    if(u) seen = u.i;
    nextAt[i] = seen;
  }
  for(let i = 0; i < lines.length; i++){
    if(inUnit[i]) continue;
    /* the auditor's own closing summary counts THIS shard's failures, which is
       a number about a twelfth of the run - main prints the real one */
    if(/^console\.log\(fails/.test(r.bare[i])){ lines[i] = ""; continue; }
    if(/^console\.log/.test(r.bare[i])) lines[i] = "__at(" + (nextAt[i] - 0.5) + "); " + lines[i];
  }
  /* SHARD BY GROUP, NOT BY UNIT. Two units share a recording through a
     top-level `let`, so they have to land on the same thread - audit-split.js
     works out which those are. */
  const g = groups(src);
  const owner = new Int32Array(r.units.length);
  g.groups.forEach((members, gi) => { for(const u of members) owner[u] = gi; });
  for(const u of r.units){
    lines[u.from] = "if(__own[" + u.i + "]%__N===__K){ __at(" + u.i + "); __t0(); " + lines[u.from];
    /* back to a HALF key the moment the unit closes. What prints between units
       is scaffolding every shard runs - a container's own helpers do print -
       and only a half key tells main to take it from shard 0 alone. Leave the
       key on the unit that just ended and six shards each hand back the same
       line under an integer key, which main has no way to tell apart. */
    lines[u.to] = lines[u.to] + " __t1(" + u.i + "); } __at(" + (u.i + 0.5) + ");";
  }
  return { body: lines.join("\n"), units: r.units.length, owner, groups: g.groups.length, odd: r.odd,
           at: r.units.map(u => u.from) };
}

/* ══════════ worker: run this shard's units ══════════ */
if(!isMainThread){
  const { body, owner } = shardSource();
  const N = workerData.n, K = workerData.k;
  const out = [];
  let key = -0.5, seq = 0;
  const shim = {
    log: (...a) => { out.push({ key, seq: seq++, text: a.map(String).join(" ") }); },
    error: (...a) => { out.push({ key, seq: seq++, text: a.map(String).join(" ") }); }
  };
  /* process.exit is the one call that must not do what it says here */
  const proc = Object.create(process);
  proc.exit = () => {};
  const pre = "const __N=" + N + ", __K=" + K + ";\n" +
              "const __own=[" + Array.from(owner).join(",") + "];\n" +
              "const __at=k=>{ __key(k); };\n";
  const cost = {};
  let mark = 0n;
  const fn = new Function("require", "console", "process", "__key", "__report", "__t0", "__t1",
                          pre + body + "\n__report(typeof fails==='number'?fails:0);");
  fn(require, shim, proc,
     k => { key = k; },
     f => { parentPort.postMessage({ fails: f, out, cost, k: K }); },
     () => { mark = process.hrtime.bigint(); },
     i => { cost[i] = Number(process.hrtime.bigint() - mark) / 1e6; });
  return;
}

/* ══════════ main: shard, collect, print in file order ══════════ */
function main(){
  const info = shardSource();
  if(info.odd.length > 2){
    console.error("audit-par: audit-physics.js grew a top-level statement that is neither a unit");
    console.error("nor a declaration, so it would run once per shard. Run tools/audit-split.js.");
    process.exit(2);
  }
  /* SIX, not os.cpus(). That call counts LOGICAL cores, and one of these shards
     is the block that runs tools/sweep.js, which spawns a full set of its own
     inside a child process - so asking for twelve asks for twenty-four. It
     oversubscribes badly: measured, each check ran ~3x slower under a full
     twelve than it does on its own, and the longest single check - the floor no
     number of threads can go under - grew with it. THREADS overrides this on a
     machine with a different core count. */
  const N = Math.max(1, Math.min(Number(process.env.THREADS) || 6, info.groups));
  const t0 = Date.now();
  const got = [];
  let live = N, fails = 0;

  const done = () => {
    /* one owner per unit; the half-keys (the headers) come from shard 0 alone,
       because every shard runs the scaffolding between units */
    const rows = [];
    for(const w of got) for(const r of w.out){
      if(Number.isInteger(r.key) || w.k === 0) rows.push({ key: r.key, k: w.k, seq: r.seq, text: r.text });
    }
    rows.sort((a, b) => a.key - b.key || a.seq - b.seq);
    for(const r of rows) console.log(r.text);
    console.log(fails ? `\n${fails} FAILURE(S)` : "\nall physics checks passed");
    console.log(`  ${info.units} checks in ${info.groups} groups on ${N} threads in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if(process.env.COST){
      /* what one thread carried, and what the longest single check costs - the
         floor no amount of threads can go under */
      const cost = {};
      for(const w of got) for(const k in w.cost) cost[k] = w.cost[k];
      const rows = Object.entries(cost).sort((a, b) => b[1] - a[1]);
      const sum = rows.reduce((a, r) => a + r[1], 0);
      console.log(`  serial work ${(sum / 1000).toFixed(1)} s, longest check ${(rows[0][1] / 1000).toFixed(1)} s`);
      for(const [i, ms] of rows.slice(0, 8))
        console.log(`    ${(ms / 1000).toFixed(1).padStart(6)} s  unit ${i}  (line ${info.at[i] + 1})`);
    }
    process.exit(fails ? 1 : 0);
  };

  for(let k = 0; k < N; k++){
    const w = new Worker(__filename, { workerData: { n: N, k } });
    w.on("message", r => { got.push(r); fails += r.fails; if(--live === 0) done(); });
    w.on("error", e => { console.error(e); process.exit(2); });
  }
}
main();
