#!/usr/bin/env node
// node --expose-gc tools/framealloc.js [screen] [pre] [frames] [pause|run|burst] [top] - bytes allocated per painted frame
// burst: a pipe on the core's loop is hit, and the plant runs on through it; top=N: heap sampler rows, self and inclusive, file:line
const { paintBoot, measure, heapTop } = require('./bundle');

const rest = process.argv.slice(2);
const scr = rest[0] || 'operate', pre = +(rest[1] || 0), N = +(rest[2] || 300),
      mode = rest[3] || 'pause', top = +(rest[4] || 0);

const { frame } = paintBoot(scr, pre, mode);

function total(){
  const { performance: perf } = require('perf_hooks');
  for (let k = 0; k < 60; k++) frame(); // settle paint caches (hatch patterns, memo keys) before timing
  const t0 = perf.now(); for (let k = 0; k < N; k++) frame(); const ms = perf.now() - t0;
  const [tot, nGc] = measure(() => { for (let k = 0; k < N; k++) frame(); });
  console.log(scr.padEnd(9) + ' pre' + pre + ' ' + mode.padEnd(5) + ' ' + N + ' frames  ' +
    (ms/N).toFixed(2).padStart(7) + ' ms/frame  ' + tot + ' B  ' +
    (tot/N).toFixed(0) + ' B/frame  (' + nGc + ' collections)');
}

if (top) heapTop(frame, N, top, {mark: 'simFrame'}); else total();
