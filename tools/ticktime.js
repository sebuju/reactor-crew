#!/usr/bin/env node
/* Wall time of one tick and one commission, per preset, plus heap growth over
   the run. Prints; asserts nothing. `node tools/ticktime.js [pre] [ticks]`,
   default stock and 3 000 ticks (60 s). --expose-gc makes the heap figure mean
   something; without it the number is garbage-collector timing. */
const path = require('path');
const { headless } = require('./bundle');
const M = headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,S:()=>S,step}');
const pre = +(process.argv[2] || 0), N = +(process.argv[3] || 3000);
const { performance: perf } = require('perf_hooks');
let t0 = perf.now(); M.plantPreset(pre); M.buildLayout(); M.commission(); const tc = perf.now() - t0;
const s = M.S(); s.diceOff = true;
for (let k = 0; k < 200; k++) M.step(0.02);
if (global.gc) global.gc();
const mem0 = process.memoryUsage().heapUsed;
t0 = perf.now(); for (let k = 0; k < N; k++) M.step(0.02); const tt = perf.now() - t0;
if (global.gc) global.gc();
const mem1 = process.memoryUsage().heapUsed;
console.log(M.PLANTPRE()[pre][0].padEnd(12) + ' commission ' + tc.toFixed(0) + ' ms  tick ' +
  (tt / N).toFixed(3) + ' ms  heap ' + ((mem1 - mem0) / 1024).toFixed(0) + ' kB over ' + N + ' ticks');
