#!/usr/bin/env node
// node --expose-gc tools/memwatch.js [preset] [--eps=N] [--warm=N] [--ticks=N]
//
// Zero-allocation steady-tick gate: churn (bytes made per tick), not retained growth.
// Warm up, gc twice, count collections via v8.GCProfiler across M bare step(0.02)
// ticks (perf_hooks gc entries never arrive on node 22, so GCProfiler is the
// tripwire, not PerformanceObserver). Pass iff 0 collections and heap delta <= EPS.
// On fail: throw a game-stopping Error with bytes/tick and gc count.
const v8 = require('v8');
const { headless } = require('./bundle');

const argv = process.argv.slice(2);
let pre = 0, EPS = 0, W = 500, M = 2000;
for (const a of argv) {
  if (/^--eps=/.test(a)) EPS = +a.split('=')[1];
  else if (/^--warm=/.test(a)) W = +a.split('=')[1];
  else if (/^--ticks=/.test(a)) M = +a.split('=')[1];
  else if (/^[0-9]+$/.test(a)) pre = +a;
}
if (!global.gc) throw new Error('memwatch: run under node --expose-gc');

const Mh = headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,ST:()=>ST,P:()=>P,step}');
Mh.plantPreset(pre); Mh.buildLayout(); Mh.commission();
Mh.ST().sc[SC_DICEOFF] = 1;
const name = Mh.PLANTPRE()[pre][0];
for (let k = 0; k < W; k++) Mh.step(0.02);
global.gc(); global.gc();

const prof = new v8.GCProfiler(); prof.start();
const m0 = process.memoryUsage().heapUsed;
for (let k = 0; k < M; k++) Mh.step(0.02);
const m1 = process.memoryUsage().heapUsed;
let freed = 0, ngc = 0;
for (const g of prof.stop().statistics) {
  ngc++;
  freed += g.beforeGC.heapStatistics.usedHeapSize - g.afterGC.heapStatistics.usedHeapSize;
}
const delta = m1 - m0 + freed;
const perTick = delta / M;
if (ngc === 0 && delta <= EPS) {
  console.log(name + ' ' + M + ' ticks  PASS  ' + delta + ' B (' + perTick.toFixed(1) + ' B/tick, ' + ngc + ' collections)');
  process.exit(0);
}
throw new Error('memwatch FAIL on ' + name + ': ' + delta + ' B over ' + M + ' ticks = ' + perTick.toFixed(1) + ' B/tick, ' + ngc + ' collections (' + freed + ' B freed), eps=' + EPS);
