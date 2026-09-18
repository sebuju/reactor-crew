#!/usr/bin/env node
// node tools/live.js [preset] [secs] [every] [--seed=N] [--dice=off]
// the browser's own path: the page commissions and benches, then src/sim/runworker.js itself takes the head and flies it
const fs = require('fs'), path = require('path');
const { ROOT, headless, scriptPaths } = require('./bundle');

const argv = process.argv.slice(2), flag = k => { const a = argv.find(x => x.startsWith('--'+k+'=')); return a ? a.split('=')[1] : null; };
const pos = argv.filter(a => !a.startsWith('--'));
const pre = +(pos[0] || 0), secs = +(pos[1] || 170), every = +(pos[2] || 10);

const PG = headless('{plantPreset,layFresh,commissionGen,trBench,trRateFit,recHead,unpackVal,ST:()=>ST,PLANTPRE:()=>PLANTPRE}');
// a DEBUG > SAVE SNAPSHOT pair: the head the browser flew and its state, handed over as dumpApply() hands them
const snapStem = flag('snap') && path.resolve(ROOT, 'snapshots', flag('snap').replace(/(\.design)?\.json$/, ''));
const snap = snapStem ? PG.unpackVal(JSON.parse(fs.readFileSync(snapStem + '.json', 'utf8'))) : null;
let head;
if(snap) head = PG.unpackVal(JSON.parse(fs.readFileSync(snapStem + '.design.json', 'utf8')));
else {
  PG.plantPreset(pre); PG.layFresh();
  const g = PG.commissionGen(); while(!g.next().done);
  PG.trBench(); PG.trRateFit();
  head = structuredClone(PG.recHead());
}
const seed = flag('seed') !== null ? +flag('seed') >>> 0 : snap ? head.seed >>> 0 : PG.ST().sc[SC_SEED] >>> 0;

// runworker.js first, as the worker runs it before importScripts(); the file list is its own WORKER_SIM's pick
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const wsrc = read('src/sim/runworker.js');
const pick = new Function('self', wsrc + '; return WORKER_SIM;')({});
const posted = [], self = {postMessage: m => posted.push(m)};
global.XMLHttpRequest = function(){ this.open = () => {}; this.send = () => { this.status = 200; this.responseText = read('index.html'); }; };
global.importScripts = () => {};
global.setTimeout = () => 0;
global.MessageChannel = function(){ this.port1 = {}; this.port2 = {postMessage: () => {}}; };
const W = new Function('self', wsrc + '\n' + scriptPaths().filter(pick).map(read).join('\n') +
  '; return {tankIds,boilerIds,uiTankLvl,uiBoilerLvl,simFrame,logDrain,TR,ST:()=>ST,LOG:()=>LOG};')(self);

(async () => {
  self.onmessage({data: {t: 'init', base: ''}});
  self.onmessage({data: {t: 'live', head, seed, diceOff: flag('dice') === 'off', rate: 1, paused: true,
    snap: snap && snap.st, log: snap && snap.log}});
  await new Promise(r => setImmediate(r));
  const err = posted.find(m => m.t === 'err'); if(err) throw new Error('worker: ' + err.msg);

  const tanks = W.tankIds(), boils = W.boilerIds(), sc = W.ST().sc;
  const f = (v, d) => (+v).toFixed(d);
  const row = () => console.log(f(sc[SC_TICK]*0.02, 0).padEnd(7) + f(sc[SC_N]*100, 3).padEnd(9) +
    tanks.map(id => f(W.uiTankLvl(id), 3).padEnd(12)).join('') + boils.map(b => f(W.uiBoilerLvl(b), 2).padEnd(12)).join(''));
  console.log((snap ? path.basename(snapStem) : PG.PLANTPRE()[pre][0]) + '  seed ' + seed + (flag('dice') === 'off' ? '  dice off' : ''));
  console.log('t'.padEnd(7) + 'N%'.padEnd(9) + tanks.concat(boils.map(b => b + ' lvl')).map(s => s.padEnd(12)).join(''));
  row();
  W.TR.paused = false; W.TR.rate = 1;
  const per = Math.round(every*50), t0 = Date.now();
  for(let i = 1; i <= secs*50; i++){
    W.simFrame(0.02);
    if(i % per === 0) row();
    if(Date.now() - t0 > 8000){ console.log('stopped at ' + f(i*0.02, 1) + ' s (time budget)'); break; }
  }
  W.logDrain();
  for(const l of W.LOG().slice(-12)) console.log('  LOG ' + (typeof l === 'string' ? l : JSON.stringify(l)));
})().catch(e => { console.error(e); process.exit(1); });
