#!/usr/bin/env node
// node --expose-gc tools/memwatch.js [preset] [--eps=N] [--warm=N] [--ticks=N]
//
// Zero-allocation steady-tick gate: churn (bytes made per tick), not retained growth.
// Warm up, gc twice, count collections via v8.GCProfiler across M bare step(0.02)
// ticks (perf_hooks gc entries never arrive on node 22, so GCProfiler is the
// tripwire, not PerformanceObserver). Pass iff 0 collections and heap delta <= EPS.
// On fail: throw a game-stopping Error with bytes/tick, gc count, and top
// attributed code points from a second pass run with globalThis.__apOn.
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

const Mh = headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,S:()=>S,P:()=>P,step}');
Mh.plantPreset(pre); Mh.buildLayout(); Mh.commission();
const s = Mh.S(); s.diceOff = true;
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
let attr = '';
try {
  const acc = new Map();
  let depth = 0; const stack = [], kidG = [];
  globalThis.__apMeter = {
    s(){ if (depth === 0) prof.start(); stack.push(process.memoryUsage().heapUsed); kidG.push(0); depth++; },
    e(k){ if (depth === 0) return; const mm1 = process.memoryUsage().heapUsed; depth--;
      const start = stack.pop();
      let f = 0; if (depth === 0) { try { for (const g of prof.stop().statistics) f += g.beforeGC.heapStatistics.usedHeapSize - g.afterGC.heapStatistics.usedHeapSize; } catch (e) {} }
      const kids = kidG.pop() || 0, w = mm1 - start;
      let a = acc.get(k); if (!a) { a = { g: 0, f: 0, n: 0 }; acc.set(k, a); }
      a.g += (w - kids); a.f += f; a.n++;
      if (depth > 0) kidG[depth - 1] += w; }
  };
  for (let k = 0; k < 100; k++) Mh.step(0.02);
  const N2 = Math.min(M, 600);
  globalThis.__apOn = true;
  for (let k = 0; k < N2; k++) Mh.step(0.02);
  globalThis.__apOn = false;
  const rows = [...acc.entries()].map(([k, a]) => [k, (a.g + a.f) / N2, a.n / N2]).sort((x, y) => y[1] - x[1]).slice(0, 8);
  attr = '  attributed (B/tick): ' + rows.map(r => r[0] + '=' + (r[1] / 1024).toFixed(1) + 'kB').join(' ');
} catch (e) { attr = '  attribution failed: ' + e.message; }
throw new Error('memwatch FAIL on ' + name + ': ' + delta + ' B over ' + M + ' ticks = ' + perTick.toFixed(1) + ' B/tick, ' + ngc + ' collections (' + freed + ' B freed), eps=' + EPS + '\n' + attr);
