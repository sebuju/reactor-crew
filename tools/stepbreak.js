#!/usr/bin/env node
// node --expose-gc tools/stepbreak.js [pre] [steady|burst|shut|h2|pipe:<x,y>] [--split] [--ticks=N]
// Matrix (default): every preset x scenario, ms/tick split into engStep/logDrain/sample+scn/recTick,
//   plus trBench ms/tick, B/tick for simTick and engStep, snapshot bytes. --split: per-phase ms table
//   for one pre/scen (exact order copied from eStepMarch in src/eng/tick.js), self-checked against a
//   straight simTick run via eqS, plus a prefix-isolated (approximate) alloc column.
// WARM=N env: ticks marched after the damage and before the window (default 200).
const { headless, measure, pipeOnLoop } = require('./bundle');
const { performance: perf } = require('perf_hooks');

const argv = process.argv.slice(2);
const rest = argv.filter(a => a[0] !== '-');
const flag = k => { const a = argv.find(x => x === '--' + k || x.indexOf('--' + k + '=') === 0);
  return a === undefined ? null : (a.split('=')[1] ?? ''); };
const PRE = rest[0] === undefined ? null : +rest[0];
const SCEN = rest[1] || 'steady';
const SPLIT = flag('split') !== null;
const NTICK = +(flag('ticks') || 300);

const EXPORTS = '{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,simTick,step,engStep,' +
  'scnDue,logDrain,sample,recTick,trBench,snapS,restoreS,eqS,eqWhere,eLedgerKg,' +
  'ST:()=>ST,PT:()=>PT,IX:()=>IX,P:()=>P,TR:()=>TR,E_TK:()=>E_TK,' +
  'act,actId,eNetMarching,eLedgerA,eCtlPass,eActFollow,eCoreRodStep,eBoronFollow,eCoreDecayStep,' +
  'eCoreAgg,eMachPreSolve,eNetFlowKA,eCoreFlowRead,eCwFlowStep,eSpillStep,eTankRateStep,eNetCommitP,' +
  'eCorePRead,ePressRead,eBurstDice,eAdvectStep,eInvStep,eSumpStep,eCavStep,ePumpQStep,ePumpCoastStep,' +
  'eSgHeatStep,eHoldReliefStep,eDiscTankStep,eBookTailStep,eCoreFatigueStep,eSgtrStep,eCoreBurstStep,' +
  'eCoreVesselStep,eMarginStep,eCondTurbStep,eSecVentStep,eShellStep,eCondVentStep,eTurbStep,' +
  'eRadPanelStep,eSecTankStep,eCoreKineticsStep,eCoreMeltStep,eRadDose,eInjectFluid,eRoomStep,' +
  'eBlastStep,eOverpressureStep,eBurnFireStep,eCookStep,eEvLatchStep,eRepairStep,eFlowSpinStep,' +
  'PROMPT_F,E_TK_HEAT,E_INJ_FLUID,SAMP_TICKS,' +
  'SC_T,SC_TICK,SC_DICEOFF,SC_INJRATE,SC_INJKIND,SC_REPA,SC_N,SC_DECAY,SC_ROOMFIREON,SC_ROOMBURNON,SC_MASSRES,' +
  'STBYTES:()=>STBYTES,SX:()=>SX,GW:()=>GW,INJ_NAME,runOfCell:(x,y)=>pipeMap().cellOwner[x+","+y]||[]}';

// [label, kind] in eStepMarch order; cond: checked live per tick. kind arg: 0 = (dt), 1 = fixed args
function phaseList(M) {
  const d = () => 0.02;
  return [
    ['tickHead', () => { const sc = M.ST().sc; sc[M.SC_T] += d(); sc[M.SC_TICK]++; }],
    ['eLedgerA0', () => M.eLedgerA(0, 0)],
    ['eCtlPass', () => M.eCtlPass(d())],
    ['eActFollow', () => M.eActFollow(d())],
    ['eCoreRodStep', () => M.eCoreRodStep(d())],
    ['eBoronFollow', () => M.eBoronFollow(d())],
    ['eCoreDecayStep', () => M.eCoreDecayStep(d())],
    ['eCoreAgg', () => M.eCoreAgg()],
    ['kinIn', () => { M.E_TK()[M.E_TK_HEAT] = M.ST().sc[M.SC_N] * M.PROMPT_F + M.ST().sc[M.SC_DECAY]; }],
    ['eMachPreSolve', () => M.eMachPreSolve()],
    ['eNetFlowKA', () => M.eNetFlowKA(0)],
    ['eCoreFlowRead', () => M.eCoreFlowRead()],
    ['eCwFlowStep', () => M.eCwFlowStep()],
    ['eSpillStep', () => M.eSpillStep()],
    ['eTankRateStep', () => M.eTankRateStep()],
    ['eNetCommitP', () => M.eNetCommitP()],
    ['eCorePRead', () => M.eCorePRead()],
    ['ePressRead', () => M.ePressRead(d())],
    ['eBurstDice', () => M.eBurstDice()],
    ['eAdvectStep', () => M.eAdvectStep(d())],
    ['eInvStep', () => M.eInvStep()],
    ['eSumpStep', () => M.eSumpStep(d())],
    ['eCavStep', () => M.eCavStep(d())],
    ['ePumpQStep', () => M.ePumpQStep()],
    ['ePumpCoastStep', () => M.ePumpCoastStep(d())],
    ['eSgHeatStep', () => M.eSgHeatStep()],
    ['eHoldReliefStep', () => M.eHoldReliefStep(d())],
    ['eDiscTankStep', () => M.eDiscTankStep(d())],
    ['eBookTailStep', () => M.eBookTailStep()],
    ['eCoreFatigueStep?', () => { if (M.ST().sc[M.SC_INJRATE] > 0) M.eCoreFatigueStep(d()); }],
    ['eSgtrStep', () => M.eSgtrStep(d())],
    ['eCoreBurstStep', () => M.eCoreBurstStep()],
    ['eCoreVesselStep', () => M.eCoreVesselStep(d())],
    ['eCoreAgg', () => M.eCoreAgg()],
    ['eMarginStep', () => M.eMarginStep()],
    ['eCondTurbStep', () => M.eCondTurbStep()],
    ['eSecVentStep', () => M.eSecVentStep(d())],
    ['eShellStep', () => M.eShellStep(d())],
    ['eCondVentStep', () => M.eCondVentStep(d())],
    ['eTurbStep', () => M.eTurbStep(d())],
    ['eRadPanelStep', () => M.eRadPanelStep(d())],
    ['eSecTankStep', () => M.eSecTankStep(d())],
    ['eCoreKineticsStep', () => M.eCoreKineticsStep(d())],
    ['eCoreMeltStep', () => M.eCoreMeltStep(d())],
    ['eCoreAgg', () => M.eCoreAgg()],
    ['eRadDose', () => M.eRadDose(d())],
    ['eInjectFluid?', () => { if (M.ST().sc[M.SC_INJKIND] === M.E_INJ_FLUID) M.eInjectFluid(d()); }],
    ['eRoomStep', () => M.eRoomStep(d())],
    ['eBlastStep', () => M.eBlastStep(d())],
    ['eOverpressureStep', () => M.eOverpressureStep()],
    ['eBurnFireStep', () => M.eBurnFireStep()],
    ['eCookStep', () => M.eCookStep(d())],
    ['eCoreAgg', () => M.eCoreAgg()],
    ['eEvLatchStep', () => M.eEvLatchStep()],
    ['eRepairStep?', () => { if (M.ST().sc[M.SC_REPA] >= 0) M.eRepairStep(d()); }],
    ['eFlowSpinStep', () => M.eFlowSpinStep(d())],
    ['eLedgerA1', () => M.eLedgerA(1, d())],
  ];
}

function boot(pre) {
  const M = headless(EXPORTS);
  const t0 = perf.now();
  M.plantPreset(pre); M.buildLayout(); M.commission();
  const tc = perf.now() - t0;
  M.ST().sc[M.SC_DICEOFF] = 1;
  for (let k = 0; k < 50; k++) M.simTick();
  return { M, tc };
}

function damage(M, scen) {
  let what = '';
  if (scen === 'burst') { const a = pipeOnLoop(M); what = M.IX().partId[a]; M.act('hit', a); }
  else if (scen.indexOf('pipe:') === 0) { what = scen; M.actId('hit', scen); }
  else if (scen === 'shut') { what = 'port ' + M.IX().portId[0]; M.act('portShut', 0); }
  else if (scen === 'h2') { const i = 12 * M.GW() + 30; what = 'H2 at cell ' + i; M.act('injectOn', M.INJ_NAME.indexOf('H2'), 2, i, -1); }
  return what;
}

const WARM = +(process.env.WARM || 200);
const SWARM = +(process.env.SWARM || 3000); // settled warm per measured entry (JIT needs thousands)
const SMEAS = +(process.env.SMEAS || 2000); // settled measure window
function settle(M, scen) {
  const what = damage(M, scen);
  for (let k = 0; k < WARM; k++) M.simTick();
  return what;
}

function timeLoop(N, fn) {
  const t0 = perf.now(); fn(); return perf.now() - t0;
}

function matrix(pre, scen) {
  const { M, tc } = boot(pre);
  const what = settle(M, scen);
  const name = M.PLANTPRE()[pre][0];
  const N = NTICK;
  // the alloc number that matters is the JIT-settled one: settling takes thousands of ticks,
  // so the measured entry is warmed on its own before the window (see 22/09/26 notes)
  for (let k = 0; k < 3000; k++) M.simTick();
  const snap = M.snapS();
  const snapKB = (M.STBYTES().length + M.SX().bytes.length) / 1024;
  const n = M.PT().n;
  const topo = 'n' + n.node + '/e' + n.edge;

  M.restoreS(snap);
  const tEng = timeLoop(N, () => { for (let k = 0; k < N; k++) M.engStep(0.02); });
  M.restoreS(snap);
  const tStep = timeLoop(N, () => { for (let k = 0; k < N; k++) M.step(0.02); });
  M.restoreS(snap);
  const tTick = timeLoop(N, () => { for (let k = 0; k < N; k++) M.simTick(); });
  M.restoreS(snap);
  const tRec = timeLoop(N, () => { for (let k = 0; k < N; k++) { M.simTick(); M.recTick(); } });

  M.restoreS(snap);
  for (let k = 0; k < SWARM; k++) M.simTick();
  const [bTick, gTick] = cmeasure(() => { for (let k = 0; k < SMEAS; k++) M.simTick(); });
  M.restoreS(snap);
  for (let k = 0; k < SWARM; k++) M.engStep(0.02);
  const [bEng, gEng] = cmeasure(() => { for (let k = 0; k < SMEAS; k++) M.engStep(0.02); });

  M.restoreS(snap);
  for (let k = 0; k < 50; k++) M.simTick();
  const keepClock = global.performance;
  global.performance = perf; // headless stubs the clock; trBench needs the wall
  try { M.trBench(); } finally { global.performance = keepClock; }
  const tickMs = M.TR().tickMs, tps = M.TR().tps;

  const sc = M.ST().sc;
  const flags = (sc[M.SC_ROOMFIREON] > 0 ? ' metalfire' : '') + (sc[M.SC_ROOMBURNON] > 0 ? ' H2burn' : '');
  console.log(
    name.padEnd(12) + ' ' + scen.padEnd(7) +
    ' commiss ' + String(Math.round(tc)).padStart(5) + 'ms' +
    ' snap ' + snapKB.toFixed(0).padStart(4) + 'kB' +
    ' tick ' + (tTick / N).toFixed(3).padStart(7) + 'ms' +
    ' eng ' + (tEng / N).toFixed(3).padStart(7) +
    ' drain ' + ((tStep - tEng) / N).toFixed(4).padStart(8) +
    ' smp ' + ((tTick - tStep) / N).toFixed(4).padStart(8) +
    ' rec ' + ((tRec - tTick) / N).toFixed(4).padStart(8) +
    ' bench ' + (tickMs === null ? '   n/a' : tickMs.toFixed(3).padStart(6) + 'ms') +
    ' alloc ' + (bTick / SMEAS).toFixed(0).padStart(6) + 'B/t[' + gTick + ']' +
    ' engA ' + (bEng / SMEAS).toFixed(0).padStart(6) + 'B/t[' + gEng + ']' +
    ' ' + topo +
    ' massres ' + Math.abs(sc[M.SC_MASSRES] / M.eLedgerKg()).toExponential(1) +
    (what ? '  ' + what : '') + flags);
}

function split(pre, scen) {
  const { M } = boot(pre);
  const what = settle(M, scen);
  const name = M.PLANTPRE()[pre][0];
  const PH = phaseList(M);
  const N = 200, K = 60;

  // self-check: straight simTicks vs phased replication, compared over the STATE region only.
  // The scratch region is allowed to differ: even straight-vs-straight from the same restored
  // snapshot disagrees on ~15 SX bytes over 60 ticks (measured 22/09/26), while ST agrees exactly.
  const snap = M.snapS();
  const stLen = M.STBYTES().length;
  const stName = off => {
    const SZ = { f64: 8, f32: 4, i32: 4, u8: 1 };
    for (const [nm, ty, len, o] of M.ST().layout.rows)
      if (off >= o && off < o + len * SZ[ty]) return nm + '[' + (((off - o) / SZ[ty]) | 0) + ']';
    return 'pad@' + off;
  };
  const stCmp = (A, B) => {
    for (let i = 0; i < stLen; i++) if (A[i] !== B[i]) return 'MISMATCH ' + stName(i);
    return 'MATCH(ST)';
  };
  M.restoreS(snap);
  for (let k = 0; k < K; k++) M.simTick();
  const A = M.snapS();
  M.restoreS(snap);
  for (let k = 0; k < K; k++) phasedTick(M, PH);
  const B = M.snapS();
  console.log(name + ' ' + scen + ' phased-vs-straight ' + stCmp(A, B) + (what ? '  ' + what : ''));

  // per-phase timing
  M.restoreS(snap);
  const acc = new Float64Array(PH.length);
  for (let k = 0; k < N; k++) {
    M.scnDue(M.ST().sc[M.SC_TICK]);
    const was = M.eNetMarching(1);
    for (let i = 0; i < PH.length; i++) { const t0 = perf.now(); PH[i][1](); acc[i] += perf.now() - t0; }
    M.eNetMarching(was);
    M.logDrain();
    if (M.ST().sc[M.SC_TICK] % M.SAMP_TICKS === 0) M.sample();
  }
  const tot = acc.reduce((a, b) => a + b, 0) / N;
  console.log('--- ms/tick per phase, ' + N + ' ticks (eNetMarching/logDrain/scnDue/sample overhead excluded from rows)');
  const rows = PH.map((p, i) => [p[0], acc[i] / N]).sort((a, b) => b[1] - a[1]);
  for (const [n, v] of rows)
    console.log('  ' + n.padEnd(20) + v.toFixed(4).padStart(9) + '  ' + (v / tot * 100).toFixed(1).padStart(5) + '%');
  console.log('  ' + 'PHASE SUM'.padEnd(20) + tot.toFixed(4).padStart(9));

  // settled alloc per entry: each entry warmed on its own (JIT settling takes thousands of
  // ticks), then a 1000-tick measured window. Retained (trailing-gc) separates true retention.
  console.log('--- settled B/tick per entry (warm 2000 + window 1000, [collections])');
  const W = 2000, NN = 1000;
  const retained = fn => {
    M.restoreS(snap); global.gc(); global.gc();
    const m0 = process.memoryUsage().heapUsed; fn(); global.gc(); global.gc();
    return process.memoryUsage().heapUsed - m0;
  };
  const rep = (label, fn) => {
    M.restoreS(snap); for (let k = 0; k < W; k++) fn();
    const [b, g] = cmeasure(() => { for (let k = 0; k < NN; k++) fn(); });
    const r = retained(() => { for (let k = 0; k < NN; k++) fn(); });
    console.log('  ' + label.padEnd(18) + (b / NN).toFixed(0).padStart(8) + '  [' + g + ']  retained ' + (r / NN).toFixed(0).padStart(6) + 'B/t'); };
  rep('engStep', () => M.engStep(0.02));
  rep('step', () => M.step(0.02));
  rep('simTick', () => M.simTick());
  rep('simTick+recTick', () => { M.simTick(); M.recTick(); });
}

function phasedTick(M, PH) {
  M.scnDue(M.ST().sc[M.SC_TICK]);
  const was = M.eNetMarching(1);
  for (const p of PH) p[1]();
  M.eNetMarching(was);
  M.logDrain();
  if (M.ST().sc[M.SC_TICK] % M.SAMP_TICKS === 0) M.sample();
}

function cmeasure(body) {
  global.gc(); global.gc(); global.gc(); // one pre-gc leaves freed-during-window contamination; three do not
  return measure(body);
}

function phaseAlloc(pre, scen) {
  const { M } = boot(pre);
  const what = settle(M, scen);
  const name = M.PLANTPRE()[pre][0];
  const PH = phaseList(M);
  const snap = M.snapS();
  console.log(name + ' ' + scen + ' per-phase alloc (frozen state locator: 300 phased warm ticks, then 500 direct calls)' + (what ? '  ' + what : ''));
  for (const [n, f] of PH) {
    M.restoreS(snap);
    for (let k = 0; k < 300; k++) phasedTick(M, PH);
    const [b, g] = cmeasure(() => { for (let k = 0; k < 500; k++) f(); });
    console.log('  ' + n.padEnd(20) + (b / 500).toFixed(1).padStart(10) + '  [' + g + ']');
  }
}

if (flag('phasealloc') !== null) {
  if (PRE === null) { console.error('stepbreak --phasealloc needs a preset'); process.exit(1); }
  phaseAlloc(PRE, SCEN);
} else if (SPLIT) {
  if (PRE === null) { console.error('stepbreak --split needs a preset'); process.exit(1); }
  split(PRE, SCEN);
} else if (PRE === null) {
  const n = headless('{PLANTPRE:()=>PLANTPRE}').PLANTPRE().length;
  for (let p = 0; p < n; p++) matrix(p, SCEN);
} else matrix(PRE, SCEN);
