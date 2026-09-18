#!/usr/bin/env node
// node --expose-gc tools/allocprobe.js [pre] [ticks] [steady|burst|shut|h2|pipe:<x,y>] [--reps=R] [--floor] [--deopts] - bytes allocated per simTick()
// WARM=N env: ticks marched after the damage and before the window (default 200, 20 with --reps)
// --reps=R: restore the settled snapshot, damage, warm, measure, R times; --floor: the same measurement around an empty loop;
// --deopts: re-run with the deopt trace switched on after repeat 2 and list what deopts
/* No attribution mode: HeapProfiler sampling names the wrong frame; bisect the tick instead. */
const { headless, pipeOnLoop, bundleLoc } = require('./bundle');
const v8 = require('v8');

const argv = process.argv.slice(2);
const rest = argv.filter(a => a[0] !== '-');
const flag = k => { const a = argv.find(x => x === '--' + k || x.indexOf('--' + k + '=') === 0);
  return a === undefined ? null : (a.split('=')[1] ?? ''); };
const pre = +(rest[0] || 0), N = +(rest[1] || 1000), scen = rest[2] || 'steady';
const reps = flag('reps') === null ? 0 : +flag('reps');

if (flag('deopts') !== null) deopts();
else run();

function measure(body){
  /* heapUsed alone is not an allocation counter - one scavenge inside the window hides most of it,
     and perf_hooks' gc entries never arrive on node 22, so the collections are read back instead */
  if (global.gc) global.gc(); else console.log('WARN no --expose-gc: the warm-up heap is in the figure');
  const prof = new v8.GCProfiler(); prof.start();
  const m0 = process.memoryUsage().heapUsed;
  body();
  const m1 = process.memoryUsage().heapUsed;
  const st = prof.stop().statistics;
  let freed = 0;
  for (const g of st)
    freed += g.beforeGC.heapStatistics.usedHeapSize - g.afterGC.heapStatistics.usedHeapSize;
  return [(m1 - m0) + freed, st.length];
}

function run(){
  if (flag('floor') !== null){
    const [tot, nc] = measure(() => { for (let k = 0; k < N; k++) {} });
    console.log('floor        ' + N + ' loops  ' + tot + ' B  ' + (tot / N).toFixed(1) + ' B/tick  (' + nc + ' collections)');
    return;
  }
  const M = headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,simTick,act,actId,snapS,restoreS,eLedgerKg,' +
    'ST:()=>ST,PT:()=>PT,IX:()=>IX,GW:()=>GW,INJ_NAME,runOfCell:(x,y)=>pipeMap().cellOwner[x+","+y]||[]}');
  M.plantPreset(pre); M.buildLayout(); M.commission();
  M.ST().sc[SC_DICEOFF] = 1;
  for (let k = 0; k < 50; k++) M.simTick();

  let what = '';
  const hit = () => {
    if (scen === 'burst'){ const a = pipeOnLoop(M); what = M.IX().partId[a]; M.act('hit', a); }
    else if (scen.indexOf('pipe:') === 0){ what = scen; M.actId('hit', scen); }
    else if (scen === 'shut'){ what = 'port ' + M.IX().portId[0]; M.act('portShut', 0); }
    else if (scen === 'h2'){ const i = 12*M.GW() + 30; what = 'H2 at cell ' + i; M.act('injectOn', M.INJ_NAME.indexOf('H2'), 2, i, -1); }
  };
  const WARM = +(process.env.WARM || (reps ? 20 : 200));
  const say = flag('trace') === null ? console.log : console.error;
  const once = r => {
    hit();
    for (let k = 0; k < WARM; k++) M.simTick();
    const [tot, nc] = measure(() => { for (let k = 0; k < N; k++) M.simTick(); });
    const sc = M.ST().sc;
    say(M.PLANTPRE()[pre][0].padEnd(12) + ' ' + scen.padEnd(7) + ' ' + N + ' ticks  ' + tot + ' B  ' +
      (tot / N).toFixed(1) + ' B/tick  (' + nc + ' collections)' + (what ? '  ' + what : '') +
      (sc[SC_ROOMFIREON] > 0 ? '  metal fire' : '') + (sc[SC_ROOMBURNON] > 0 ? '  H2 burning' : '') +
      (r ? '  rep ' + r + '  massres/kg ' + (Math.abs(sc[SC_MASSRES]) / M.eLedgerKg()).toExponential(1) : ''));
  };
  if (!reps){ once(0); return; }
  const snap = M.snapS();
  for (let r = 1; r <= reps; r++){ M.restoreS(snap); once(r); if (r === 2 && flag('trace') !== null) v8.setFlagsFromString('--trace-deopt-verbose'); }
}

function deopts(){
  const cp = require('child_process');
  if (reps < 3) { console.log('--deopts needs --reps=3 or more'); return; }
  /* V8's trace and console.log reach a pipe out of order: the child turns the trace on after repeat 2 and reports on stderr */
  const args = ['--expose-gc', __filename, '--trace'].concat(argv.filter(a => a.indexOf('--deopts') !== 0));
  const out = cp.spawnSync(process.execPath, args, {timeout: 9500, maxBuffer: 1 << 30, encoding: 'utf8'});
  if (out.error || out.status !== 0) console.log('child ' + (out.error ? out.error.code : 'exit ' + out.status));
  process.stdout.write(out.stderr || '');
  const rows = new Map();
  let fn = '', why = '', seen = 0;
  for (const ln of (out.stdout || '').split('\n')){
    const b = ln.match(/^\[bailout \(kind: [^,]+, reason: (.*)\): begin\. deoptimizing \S+ <JSFunction (\S+)/);
    if (b){ why = b[1]; fn = b[2]; seen = 1; continue; }
    const d = seen && ln.match(/;;; deoptimize at <unknown:(\d+):\d+>/);
    if (d){ seen = 0; const k = fn + '  ' + bundleLoc(+d[1]) + '  ' + why; rows.set(k, (rows.get(k) || 0) + 1); }
  }
  console.log('--- deopts after repeat 2');
  if (!rows.size) console.log('none');
  for (const [k, c] of [...rows].sort((a, b) => b[1] - a[1])) console.log(String(c).padStart(5) + '  ' + k);
}
