#!/usr/bin/env node
// node --expose-gc tools/framealloc.js [screen] [pre] [frames] [pause|run|burst] [top] - bytes allocated per painted frame
// burst: a pipe on the core's loop is hit, and the plant runs on through it; top=N: heap sampler rows, self and inclusive, file:line
const path = require('path'), v8 = require('v8');
const { headless, bundleLoc, pipeOnLoop } = require('./bundle');

const rest = process.argv.slice(2);
const scr = rest[0] || 'operate', pre = +(rest[1] || 0), N = +(rest[2] || 300),
      mode = rest[3] || 'pause', top = +(rest[4] || 0);

const M = headless('{plantPreset,buildLayout,commission,tick,uiDirty,act,TR,ST:()=>ST,PT:()=>PT,IX:()=>IX,' +
  'runOfCell:(x,y)=>pipeMap().cellOwner[x+","+y]||[],setScreen:s=>{ screen=s; layout(); }}');
let wall = 1000;
global.performance = {now: () => wall};
M.plantPreset(pre); M.buildLayout(); M.commission();
M.ST().sc[SC_DICEOFF] = 1;
M.setScreen(scr);
M.TR.paused = mode === 'pause';
/* uiDirty() owes a paint, so every tick() below paints whatever the pacing would have skipped */
const frame = () => { wall += 1000/60; M.uiDirty(); M.tick(wall); };
for (let k = 0; k < 120; k++) frame();
if (mode === 'burst'){ const a = pipeOnLoop(M); console.log('hit ' + M.IX().partId[a]); M.act('hit', a);
  for (let k = 0; k < 120; k++) frame(); }

function total(){
  if (global.gc) { global.gc(); global.gc(); } else console.log('WARN no --expose-gc: the warm-up heap is in the figure');
  const prof = new v8.GCProfiler(); prof.start();
  const m0 = process.memoryUsage().heapUsed;
  for (let k = 0; k < N; k++) frame();
  const m1 = process.memoryUsage().heapUsed;
  const st = prof.stop().statistics;
  let freed = 0;
  for (const g of st) freed += g.beforeGC.heapStatistics.usedHeapSize - g.afterGC.heapStatistics.usedHeapSize;
  const tot = m1 - m0 + freed;
  console.log(scr.padEnd(9) + ' pre' + pre + ' ' + mode.padEnd(5) + ' ' + N + ' frames  ' + tot + ' B  ' +
    (tot/N).toFixed(0) + ' B/frame  (' + st.length + ' collections)');
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
    if (b) { add(self, nm + '  <- ' + stack.slice(-2).reverse().join(' <- '), b);
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
