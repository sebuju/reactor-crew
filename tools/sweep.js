#!/usr/bin/env node
/* The design sweep, spread across every core.

   audit-physics.js asks one question of every plant the bench will let you
   build: left alone, with automatic rod control fitted, does it trip itself?
   That sweep is ~93% of everything the auditor does, and it was running on one
   core out of twelve.

   Every case is independent - set() rewrites D wholesale from BASE and
   commission() rebuilds P and S from scratch, so nothing carries over - which
   makes it embarrassingly parallel. headless() evaluates the bundle through
   `new Function`, so the page's top-level `const D` / `let S` / `let P` are
   function-scoped rather than global, and each worker thread therefore gets a
   completely separate plant with nothing shared and nothing to lock.

   This file is both halves. Run as the main thread it shards the work, waits,
   and writes the results to stdout as JSON; run as a worker it simulates its
   own shard. audit-physics.js invokes it with execFileSync, so from the
   auditor's point of view the sweep is still one blocking call in the middle
   of a linear script, and the report still prints in case order however the
   threads happened to finish.

   It reports raw data only. Every FAIL message is worded by audit-physics.js,
   which is the file that owns what the sweep means. */
"use strict";
const { Worker, isMainThread, workerData, parentPort } = require("worker_threads");

/* how long a plant is left alone for. Overridable exactly as probe.js and the
   sandbox are, so a run can be made to fit the 10 s script budget when what is
   being checked is that the sweep RUNS rather than what it finds. */
const SECS = Number(process.env.SWEEP_SECS) || 600;

/* ══════════ worker: simulate one shard ══════════ */
if(!isMainThread){
  const M = require("./bundle").headless(
    "{commission,step,derived,S:()=>S,D:()=>D,archPreset,latDefault,buildLayout,buildStockPlumbing}");
  const D = M.D(), BASE = JSON.parse(JSON.stringify(D));

  /* the same two helpers audit-physics.js uses, for the same reasons.
     THE GRID STARTS BLANK, so a case has to be BUILT before it can be
     commissioned: the stock ship's own plumbing, then the architecture as a
     PRESET (archPreset lays the lattice - there is no D.arch to type any
     more), then whatever the case overrides. */
  const set = o => { Object.assign(D, BASE);
    M.latDefault(); M.buildStockPlumbing({loops:1});
    M.archPreset(o.arch); delete o.arch;
    Object.assign(D, o); M.buildLayout(); M.commission(); return M.S(); };
  const run = (s,secs) => { for(let i=0;i<secs*50;i++){ M.step(0.02); if(s.breach) break; } return s; };

  /* the end state, to more digits than any physics could survive being wrong in */
  const endState = s => [s.n,s.Tf,s.dnbr,s.rodPos,s.boron,s.P,s.vf,s.t]
    .map(v => Number(v).toPrecision(17)).join(",");

  /* ── one (arch, fuel) group ──
     The third design axis, `scram`, is deliberately simulated only once.
     P.scram is read in exactly one place - `s.scrammed ? P.scram : ROD_RATE`
     in src/sim/step.js - so on a plant that never trips it is never read at
     all, and this sweep's whole assertion is that nothing trips.
     Pump count/size is not a fourth axis here at all any more - it is a
     placed component now, open-ended, not a fixed dropdown with a finite set
     of choices to cross the other two against. Every plant this sweep builds
     carries the one static pump per loop it is born with and nothing placed,
     which is the one pump configuration every design shares regardless of
     anything else it was built from.

     A scram system still carries mass, so it can push a design over the budget
     and change what is BUILDABLE. Every scram value is therefore still put to
     the bench; only the 30,000 ticks behind it are shared.

     `guard` is what keeps that from being a comment nobody rechecks: on one
     group it simulates all three anyway and hands back the end states, so
     audit-physics.js can assert they still match instead of trusting this. */
  const group = c => {
    const s = set({arch:c.a, fuel:c.f, scram:c.built[0], autorod:true});
    run(s, SECS);
    const r = { i:c.i, scram:c.built[0], trip: s.scrammed ? s.trip : null, t:s.t };
    if(c.guard) r.guard = c.built.map(sc => {
      const g = set({arch:c.a, fuel:c.f, scram:sc, autorod:true});
      run(g, SECS); return endState(g); });
    return r;
  };

  parentPort.postMessage(workerData.cases.map(group));
  return;
}

/* ══════════ main thread: shard, collect, emit ══════════ */
const os = require("os");

/* Every (arch, fuel) the bench offers, each carrying the list of scram
   choices the bench will actually build it with. The dimensions are read from
   the design tables rather than hard-coded, so adding an architecture widens
   the sweep without anyone having to remember this file.

   Buildability is settled here, on one thread, because it costs no ticks -
   derived() only, no commission - and because keeping it in one place stops
   the workers and the report disagreeing about what "buildable" counted. */
function cases(){
  const M = require("./bundle").headless(
    "{derived,warnRed,D:()=>D,ARCHPRE:()=>ARCHPRE,FUEL:()=>FUEL,archPreset,latDefault,buildLayout,buildStockPlumbing}");
  const D = M.D(), BASE = JSON.parse(JSON.stringify(D));
  const ok = o => { Object.assign(D, BASE);
    M.latDefault(); M.buildStockPlumbing({loops:1});
    M.archPreset(o.arch); const q = Object.assign({}, o); delete q.arch;
    Object.assign(D, q); M.buildLayout();
    return !M.derived().warn.some(M.warnRed); };
  const nA = M.ARCHPRE().length, nF = M.FUEL().length;
  const out = [];
  for(let a=0;a<nA;a++) for(let f=0;f<nF;f++){
    const built = [0,1,2].filter(sc => ok({arch:a, fuel:f, scram:sc, autorod:true}));
    out.push({ i:out.length, a, f, built });
  }
  return out;
}

function main(){
  const all = cases();
  const work = all.filter(c => c.built.length);
  /* The guard needs a group the bench will build all three ways, or it proves
     nothing. It costs two extra plants, so exactly one group carries it. */
  const g = work.find(c => c.built.length === 3);
  if(!g){ console.error("sweep: no group is buildable at every scram setting"); process.exit(2); }
  g.guard = true;

  const N = Math.max(1, Math.min(os.cpus().length, work.length));
  const shards = Array.from({length:N}, () => []);
  /* Round-robin, not contiguous. The architectures that blow the mass budget
     are adjacent in the list, so a contiguous split hands one thread nothing
     to do and another all of the real work. */
  work.forEach((c,k) => shards[k%N].push(c));

  const got = [];
  let live = N;
  const done = () => {
    got.sort((x,y) => x.i - y.i);
    /* every group, buildable or not, so the report can count what the bench
       offered as well as what was worth simulating */
    const byI = new Map(got.map(r => [r.i, r]));
    const groups = all.map(c => Object.assign({ i:c.i, a:c.a, f:c.f, built:c.built },
                                              byI.get(c.i) || {}));
    process.stdout.write(JSON.stringify({ secs:SECS, workers:N, groups }));
  };
  for(const cs of shards){
    const w = new Worker(__filename, { workerData:{ cases:cs } });
    w.on("message", r => { got.push(...r); if(--live === 0) done(); });
    w.on("error", e => { console.error(e); process.exit(2); });
  }
}
main();
