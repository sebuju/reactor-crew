#!/usr/bin/env node
// node --expose-gc tools/allocprobe.js [pre] [ticks] [steady|burst|shut|h2|pipe:<x,y>] - bytes allocated per simTick()
// WARM=N env: ticks marched after the damage and before the window (default 200)
/* No attribution mode: HeapProfiler sampling names the wrong frame; bisect the tick instead. */
const { headless } = require('./bundle');
const v8 = require('v8');

const rest = process.argv.slice(2).filter(a => a[0] !== '-');
const pre = +(rest[0] || 0), N = +(rest[1] || 1000), scen = rest[2] || 'steady';

const M = headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,simTick,act,actId,ST:()=>ST,PT:()=>PT,IX:()=>IX,' +
  'GW:()=>GW,INJ_NAME,runOfCell:(x,y)=>pipeMap().cellOwner[x+","+y]||[]}');
M.plantPreset(pre); M.buildLayout(); M.commission();
M.ST().sc[SC_DICEOFF] = 1;
for (let k = 0; k < 50; k++) M.simTick();

/* a hole on the core's own loop if the drawing has one: the damaged tick that matters is the one losing coolant */
function pipeOnLoop(){
  const ids = M.IX().partId, pt = M.PT();
  let any = -1;
  for (let a = 0; a < ids.length; a++){
    const id = ids[a]; if (id.indexOf('pipe:') !== 0 || !(pt.partHitW[a] > 0)) continue;
    const [x, y] = id.slice(5).split(',').map(Number);
    if (M.runOfCell(x, y).some(k => /^(hot|cold|loop|pri|core)/.test(k))) return a;
    if (any < 0) any = a; }
  return any;
}
let what = '';
if (scen === 'burst'){ const a = pipeOnLoop(); what = M.IX().partId[a]; M.act('hit', a); }
else if (scen.indexOf('pipe:') === 0){ what = scen; M.actId('hit', scen); }
else if (scen === 'shut'){ what = 'port ' + M.IX().portId[0]; M.act('portShut', 0); }
else if (scen === 'h2'){ const i = 12*M.GW() + 30; what = 'H2 at cell ' + i; M.act('injectOn', M.INJ_NAME.indexOf('H2'), 2, i, -1); }
const WARM = +(process.env.WARM || 200);
for (let k = 0; k < WARM; k++) M.simTick();

/* heapUsed alone is not an allocation counter - one scavenge inside the window hides most of it,
   and perf_hooks' gc entries never arrive on node 22, so the collections are read back instead */
if (global.gc) global.gc(); else console.log('WARN no --expose-gc: the warm-up heap is in the figure');
const prof = new v8.GCProfiler(); prof.start();
const m0 = process.memoryUsage().heapUsed;
for (let k = 0; k < N; k++) M.simTick();
const m1 = process.memoryUsage().heapUsed;
const st = prof.stop().statistics;
let freed = 0;
for (const g of st)
  freed += g.beforeGC.heapStatistics.usedHeapSize - g.afterGC.heapStatistics.usedHeapSize;
const tot = (m1 - m0) + freed;
const sc = M.ST().sc;
console.log(M.PLANTPRE()[pre][0].padEnd(12) + ' ' + scen.padEnd(7) + ' ' + N + ' ticks  ' + tot + ' B  ' +
  (tot / N).toFixed(1) + ' B/tick  (' + st.length + ' collections)' + (what ? '  ' + what : '') +
  (sc[SC_ROOMFIREON] > 0 ? '  metal fire' : '') + (sc[SC_ROOMBURNON] > 0 ? '  H2 burning' : ''));
