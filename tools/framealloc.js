#!/usr/bin/env node
// node --expose-gc tools/framealloc.js [screen] [pre] [frames] [pause|run|burst] [top] - bytes allocated per painted frame
// burst: a pipe on the core's loop is hit, and the plant runs on through it; top=N: heap sampler rows, self and inclusive, file:line
const path = require('path');
const { paintBoot, measure, bundleLoc } = require('./bundle');

const rest = process.argv.slice(2);
const scr = rest[0] || 'operate', pre = +(rest[1] || 0), N = +(rest[2] || 300),
      mode = rest[3] || 'pause', top = +(rest[4] || 0);

const { frame } = paintBoot(scr, pre, mode);

function total(){
  const [tot, nGc] = measure(() => { for (let k = 0; k < N; k++) frame(); });
  console.log(scr.padEnd(9) + ' pre' + pre + ' ' + mode.padEnd(5) + ' ' + N + ' frames  ' + tot + ' B  ' +
    (tot/N).toFixed(0) + ' B/frame  (' + nGc + ' collections)');
}

async function sampled(){
  const s = new (require('inspector').Session)(); s.connect();
  const post = (m, p) => new Promise((ok, no) => s.post(m, p || {}, (e, v) => e ? no(e) : ok(v)));
  await post('HeapProfiler.enable');
  await post('HeapProfiler.startSampling', {samplingInterval: 128,
    includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true});
  for (let k = 0; k < N; k++) frame();
  const {profile} = await post('HeapProfiler.stopSampling');
  const loc = ln => bundleLoc(ln).replace(/^src\//, '');
  const bytes = new Map(), self = new Map(), incl = new Map();
  for (const x of profile.samples) bytes.set(x.nodeId, (bytes.get(x.nodeId) || 0) + x.size);
  const add = (m, k, b) => m.set(k, (m.get(k) || 0) + b);
  const walk = (n, stack) => {
    const cf = n.callFrame;
    const nm = (cf.functionName || '(anon)') + ' ' + (cf.url ? path.basename(cf.url) + ':' + (cf.lineNumber + 1) : loc(cf.lineNumber));
    const b = bytes.get(n.id) || 0;
    if (b) { add(self, (stack.some(f => f.startsWith('simFrame ')) ? '[sim] ' : '') + nm + '  <- ' + stack.slice(-2).reverse().join(' <- '), b);
      for (const f of new Set(stack.concat(nm))) add(incl, f, b); }
    for (const c of n.children || []) walk(c, stack.concat(nm));
  };
  walk(profile.head, []);
  const show = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, top)
    .forEach(([k, b]) => console.log(String(Math.round(b/N)).padStart(8) + '  ' + k));
  console.log('--- self B/frame'); show(self);
  console.log('--- inclusive B/frame'); show(incl);
}

if (top) sampled(); else total();
