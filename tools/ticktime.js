#!/usr/bin/env node
// node --expose-gc tools/ticktime.js [pre] [ticks] [--engine=wasm] - without --expose-gc the heap figure is GC timing
const fs = require('fs');
const path = require('path');
const { headless, ROOT } = require('./bundle');
const M = headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,S:()=>S,step,WasmEngine}');
const argv = process.argv.slice(2).filter(a => !a.startsWith('--'));
const wasm = process.argv.includes('--engine=wasm');
const pre = +(argv[0] || 0), N = +(argv[1] || 3000);
const { performance: perf } = require('perf_hooks');
// bundle.js freezes the clock for determinism; the breakdown needs the real one
global.performance = perf;
(async () => {
  let t0 = perf.now(); M.plantPreset(pre); M.buildLayout(); M.commission(); const tc = perf.now() - t0;
  const s = M.S(); s.diceOff = true;
  if (wasm) await M.WasmEngine.live(new Uint8Array(fs.readFileSync(path.join(ROOT, 'sim-rs', 'pkg', 'sim_rs.wasm'))));
  for (let k = 0; k < 200; k++) M.step(0.02);
  const T = M.WasmEngine.TIME, T0 = Object.assign({}, T);
  if (global.gc) global.gc();
  const mem0 = process.memoryUsage().heapUsed;
  t0 = perf.now(); for (let k = 0; k < N; k++) M.step(0.02); const tt = perf.now() - t0;
  if (global.gc) global.gc();
  const mem1 = process.memoryUsage().heapUsed;
  const part = k => ((T[k] - T0[k]) / N).toFixed(3);
  console.log(M.PLANTPRE()[pre][0].padEnd(12) + (wasm ? ' wasm' : ' js  ') + ' commission ' + tc.toFixed(0) + ' ms  tick ' +
    (tt / N).toFixed(3) + ' ms  heap ' + ((mem1 - mem0) / 1024).toFixed(0) + ' kB over ' + N + ' ticks' +
    (wasm ? '  (restore ' + part('restore') + ', step ' + part('step') + ', snapshot ' + part('snapshot') + ', apply ' + part('apply') + ')' : ''));
})();
