#!/usr/bin/env node
// node tools/sweep.js - env SWEEP_SECS/SWEEP_SEED/SWEEP_DICE; writes the sweep to stdout as JSON
"use strict";
const { Worker, isMainThread, workerData, parentPort } = require("worker_threads");

const SECS = Number(process.env.SWEEP_SECS) || 600;
const SEED = Number(process.env.SWEEP_SEED) || 1;
const DICE = process.env.SWEEP_DICE !== "off";

if(!isMainThread){
  const M = require("./bundle").headless(
    "{commission,step,derived,S:()=>S,D:()=>D,archPreset,coreD,buildLayout,buildStockPlumbing,seedRng}");
  const D = M.D(), BASE = JSON.parse(JSON.stringify(D));

  const set = o => { Object.assign(D, BASE);
    M.buildStockPlumbing({loops:1});
    M.archPreset(M.coreD("core"),o.arch); delete o.arch;
    for(const k in o) (["fuel","scram","cool","foll","refl","mod"].includes(k) ? M.coreD("core") : D)[k]=o[k];
    M.buildLayout(); M.commission();
    // after commission(), because that is where resetPlant() rolls its own
    const s = M.S(); M.seedRng(s, SEED); s.diceOff = !DICE; return s; };
  const run = (s,secs) => { for(let i=0;i<secs*50;i++){ M.step(0.02); if(s.breach) break; } return s; };

  const endState = s => [s.n,s.Tf,s.dnbr,s.rodPos,s.boron,s.P,s.vf,s.t]
    .map(v => Number(v).toPrecision(17)).join(",");

  // scram is simulated once: P.scram is read only on a plant that trips, and `guard` rechecks that
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

const os = require("os");

function cases(){
  const M = require("./bundle").headless(
    "{derived,warnRed,D:()=>D,ARCHPRE:()=>ARCHPRE,FUEL:()=>FUEL,archPreset,coreD,buildLayout,buildStockPlumbing}");
  const D = M.D(), BASE = JSON.parse(JSON.stringify(D));
  const ok = o => { Object.assign(D, BASE);
    M.buildStockPlumbing({loops:1});
    M.archPreset(M.coreD("core"),o.arch); const q = Object.assign({}, o); delete q.arch;
    for(const k in q) (["fuel","scram","cool","foll","refl","mod"].includes(k) ? M.coreD("core") : D)[k]=q[k]; M.buildLayout();
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
  const g = work.find(c => c.built.length === 3);
  if(!g){ console.error("sweep: no group is buildable at every scram setting"); process.exit(2); }
  g.guard = true;

  const N = Math.max(1, Math.min(os.cpus().length, work.length));
  const shards = Array.from({length:N}, () => []);
  // round-robin: the architectures that blow the mass budget are adjacent, so a contiguous split starves a thread
  work.forEach((c,k) => shards[k%N].push(c));

  const got = [];
  let live = N;
  const done = () => {
    got.sort((x,y) => x.i - y.i);
    const byI = new Map(got.map(r => [r.i, r]));
    const groups = all.map(c => Object.assign({ i:c.i, a:c.a, f:c.f, built:c.built },
                                              byI.get(c.i) || {}));
    process.stdout.write(JSON.stringify({ secs:SECS, seed:SEED, dice:DICE, workers:N, groups }));
  };
  for(const cs of shards){
    const w = new Worker(__filename, { workerData:{ cases:cs } });
    w.on("message", r => { got.push(...r); if(--live === 0) done(); });
    w.on("error", e => { console.error(e); process.exit(2); });
  }
}
main();
