#!/usr/bin/env node
// node --expose-gc tools/allocprobe.js [pre] [ticks] - bytes allocated per tick
/* No attribution mode: HeapProfiler sampling names the wrong frame. It billed 513 kB/tick to a
   pumpResOf stack entered 5 times a tick whose memo never misses, while reading the right total. */
const { headless } = require('./bundle');
const v8 = require('v8');

const rest = process.argv.slice(2).filter(a => a[0] !== '-');
const pre = +(rest[0] || 0), N = +(rest[1] || 1000);

const M = headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,S:()=>S,step}');
M.plantPreset(pre); M.buildLayout(); M.commission();
const s = M.S(); s.diceOff = true;
for (let k = 0; k < 200; k++) M.step(0.02);

/* heapUsed alone is not an allocation counter - one scavenge inside the window hides most of it,
   and perf_hooks' gc entries never arrive on node 22, so the collections are read back instead */
if (global.gc) global.gc(); else console.log('WARN no --expose-gc: the warm-up heap is in the figure');
const prof = new v8.GCProfiler(); prof.start();
const m0 = process.memoryUsage().heapUsed;
for (let k = 0; k < N; k++) M.step(0.02);
const m1 = process.memoryUsage().heapUsed;
const st = prof.stop().statistics;
let freed = 0;
for (const g of st)
  freed += g.beforeGC.heapStatistics.usedHeapSize - g.afterGC.heapStatistics.usedHeapSize;
const tot = (m1 - m0) + freed;
console.log(M.PLANTPRE()[pre][0].padEnd(12) + ' ' + N + ' ticks  ' + tot + ' B  ' +
  (tot / N).toFixed(1) + ' B/tick  (' + st.length + ' collections, ' + freed + ' B freed)');
