#!/usr/bin/env node
// node --expose-gc tools/ticktime.js [pre] [ticks] - without --expose-gc the heap figure is GC timing
const { headless } = require('./bundle');
const M = headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,ST:()=>ST,step}');
const argv = process.argv.slice(2).filter(a => !a.startsWith('--'));
const pre = +(argv[0] || 0), N = +(argv[1] || 3000);
const { performance: perf } = require('perf_hooks');
let t0 = perf.now(); M.plantPreset(pre); M.buildLayout(); M.commission(); const tc = perf.now() - t0;
M.ST().sc[SC_DICEOFF] = 1;
for (let k = 0; k < 200; k++) M.step(0.02);
if (global.gc) global.gc();
const mem0 = process.memoryUsage().heapUsed;
t0 = perf.now(); for (let k = 0; k < N; k++) M.step(0.02); const tt = perf.now() - t0;
if (global.gc) global.gc();
const mem1 = process.memoryUsage().heapUsed;
console.log(M.PLANTPRE()[pre][0].padEnd(12) + ' commission ' + tc.toFixed(0) + ' ms  tick ' +
  (tt / N).toFixed(3) + ' ms  heap ' + ((mem1 - mem0) / 1024).toFixed(0) + ' kB over ' + N + ' ticks');
