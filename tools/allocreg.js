#!/usr/bin/env node
// node --expose-gc --no-concurrent-marking --no-concurrent-sweeping tools/allocreg.js [pre] [ticks]
//
// Per-region bytes/tick, on top of the whole-tick total that tools/allocprobe.js prints.
// It reads the env-gated meter that the sim files expose via globalThis.__apMeter: a pass wraps
// its body in __apS()/__apE("name"). Those probes are INERT unless globalThis.__apOn is set here,
// so they ship in the tree at zero cost and the state digest is identical with them installed
// (proven: probes and memo-style restructures that do not touch loop bodies never move a leaf).
//
// Read depth-0 FAMILY grain only. Sub-phase splits seesaw under GC decorrelation and are a ranking
// hint, never a verdict. Verify every window: per-region call count matches, S/E depth returns to 0,
// region sum is within ~1% of the whole-tick total. A negative delta at family grain is the floor.
const v8 = require('v8');
const { headless } = require('./bundle');

const rest = process.argv.slice(2).filter(a => a[0] !== '-');
const pre = +(rest[0] || 0), N = +(rest[1] || 600);

const prof = new v8.GCProfiler();
const acc = new Map();
let depth = 0; const stack = [], kidG = [];
globalThis.__apMeter = {
  s(){ if(depth===0) prof.start(); stack.push(process.memoryUsage().heapUsed); kidG.push(0); depth++; },
  e(k){ if(depth===0) return; const m1 = process.memoryUsage().heapUsed; depth--;
    const start = stack.pop();
    let f = 0; if(depth===0){ for(const g of prof.stop().statistics)
      f += g.beforeGC.heapStatistics.usedHeapSize - g.afterGC.heapStatistics.usedHeapSize; }
    const kids = kidG.pop() || 0, w = m1 - start;
    let a = acc.get(k); if(!a){ a = {g:0,f:0,n:0}; acc.set(k,a); }
    a.g += (w - kids); a.f += f; a.n++;
    if(depth>0) kidG[depth-1] += w; }
};

const M = headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,S:()=>S,step}');
M.plantPreset(pre); M.buildLayout(); M.commission();
const s = M.S(); s.diceOff = true;
for (let k = 0; k < 200; k++) M.step(0.02);
if (global.gc) global.gc(); else console.log('WARN no --expose-gc');

const tp = new v8.GCProfiler(); tp.start();
const m0 = process.memoryUsage().heapUsed;
globalThis.__apOn = true;
for (let k = 0; k < N; k++) M.step(0.02);
globalThis.__apOn = false;
const m1 = process.memoryUsage().heapUsed;
let tf = 0; for (const g of tp.stop().statistics)
  tf += g.beforeGC.heapStatistics.usedHeapSize - g.afterGC.heapStatistics.usedHeapSize;
const total = (m1 - m0 + tf) / N / 1024;

const rows = [...acc.entries()].map(([k,a]) => [k, (a.g + a.f) / N / 1024, a.n / N]).sort((x,y) => y[1] - x[1]);
let sum = 0;
console.log(M.PLANTPRE()[pre][0].padEnd(12) + ' ' + N + ' ticks   TOTAL ' + total.toFixed(1) + ' kB/tick   depth=' + depth);
for (const [k, kb, n] of rows) { sum += kb;
  console.log('  ' + k.padEnd(16) + kb.toFixed(1).padStart(8) + ' kB/tick   x' + n.toFixed(2) + '/tick'); }
console.log('  ' + 'sum'.padEnd(16) + sum.toFixed(1).padStart(8) + ' kB/tick  (' + (100*sum/total).toFixed(0) + '% of total)');
