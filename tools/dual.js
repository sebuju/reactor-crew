#!/usr/bin/env node
// node tools/dual.js --pre <n> --ticks <N> [--engine=js|wasm|apply]
// Dual-run harness (plan §7): commission both engines from one seed, step
// both, compare every S leaf per tick, halt with full dump on divergence.
// --engine=apply: one JS plant; every tick SIMSTATE.apply(SIMSTATE.state())
// must leave S and the sidecars exactly as they were, and write the same bytes.
'use strict';
const { headless, ROOT } = require('./bundle');

const args = process.argv.slice(2);
const opt = (k, d) => {
  const eq = args.find(a => a.startsWith('--' + k + '='));
  if (eq) return eq.slice(k.length + 3);
  const i = args.indexOf('--' + k);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return d;
};
const pre = +(opt('pre', '0')), N = +(opt('ticks', '600')), engine = opt('engine', 'js');

function boot() {
  Math.random = () => 0.4242424242;
  const M = headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,S:()=>S,step,P:()=>P,' +
    'SIMSTATE,FREEZE,WasmEngine,act,coreIds:()=>coreIds(),HB:()=>HEATBAL,LOG:()=>LOG,' +
    'G:()=>({advectOutPri,advectOutSec,advectLandedBy,advectEdgeKg,roomCgIt,roomPGen,gsX,gsDisp,FLOWG_CHOKE,divSig})}');
  M.plantPreset(pre); M.buildLayout(); M.commission();
  M.S().diceOff = true;
  return M;
}
// the plant state that is not on S: what the next tick's head reads back
function side(M) {
  const P = M.P(), net = P.net, sc = net.scr || {};
  const scr = {};
  for (const k of ['feedInHV', 'feedInHM', 'feedInMV', 'feedInMM', 'coreInHV', 'coreInHM',
    'outKgV', 'outKgM', 'outH2V', 'outH2M']) scr[k] = sc[k];
  return {
    HB: M.HB(), G: M.G(), pumpLive: P.pumpLive, scr,
    net: {
      F: net.F, wArr: net.wArr, fixV: net.fixV, stKp: net.stKp, stKh: net.stKh, stKm: net.stKm,
      stP0: net.stP0, stC: net.stC, pc: net.pc && { of: net.pc.of, n: net.pc.n, live: net.pc.live },
      pcSig: net.pcSig, AfTopo: net.AfTopo, natTick: net.natTick, natPBy: net.natPBy, natLoop: net.natLoop,
      fixMask: net.fixMask, fixGen: net.fixGen, burstP: net.burstP, burstGen: net.burstGen,
    },
  };
}
// sdig.js --leaf semantics: worst continuous leaf + discrete flips.
function leaves(s) {
  const num = new Map(), disc = new Map(), seen = new WeakSet();
  (function walk(v, path) {
    const t = typeof v;
    if (v === null || t === 'undefined' || t === 'function') return;
    if (t === 'number') { num.set(path, v); return; }
    if (t === 'boolean') { disc.set(path, v ? 1 : 0); return; }
    if (t === 'string') { disc.set(path, v); return; }
    if (t !== 'object') return;
    if (ArrayBuffer.isView(v)) { for (let i = 0; i < v.length; i++) num.set(path + '[' + i + ']', v[i]); return; }
    if (seen.has(v)) return; seen.add(v);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) walk(v[i], path + '[' + i + ']'); return; }
    if (v instanceof Set) { for (const k of [...v].map(String).sort()) disc.set(path + '#' + k, 1); return; }
    for (const k of Object.keys(v).sort()) walk(v[k], path + '.' + k);
  })(s, 'S');
  return { num, disc };
}
// a difference under ABS_FLOOR is rounding on a near-zero leaf; S.nat feeds only a bar and a trend and
// swings on rounding-level inputs, so it is reported beside the bar, not judged by it
const ABS_FLOOR = 1e-9, ASIDE = 'S.nat';
let asideWorst = 0;
function compare(A, B, tick) {
  let worst = 0, worstPath = '';
  for (const [p, a] of A.num) {
    const b = B.num.get(p);
    if (b === undefined) { worst = Infinity; worstPath = p + ' (missing in B)'; break; }
    if (Number.isNaN(a) !== Number.isNaN(b)) { worst = Infinity; worstPath = p + ' a=' + a + ' b=' + b; break; }
    if (!(Math.abs(a - b) > ABS_FLOOR)) continue;
    const rel = Math.abs(a - b) / (Math.abs(a) + Math.abs(b) + 1e-30);
    if (p === ASIDE) { asideWorst = Math.max(asideWorst, rel); continue; }
    if (rel > worst) { worst = rel; worstPath = p + ' a=' + a + ' b=' + b; }
  }
  const flips = [];
  for (const k of new Set([...A.disc.keys(), ...B.disc.keys()])) {
    const a = A.disc.has(k) ? A.disc.get(k) : '-', b = B.disc.has(k) ? B.disc.get(k) : '-';
    if (a !== b) flips.push(k + ' ' + a + '->' + b);
  }
  if (worst > 1e-6 || flips.length) {
    console.log('DIVERGENCE tick=' + tick + ' worst-leaf=' + worst.toExponential(2) + ' @ ' + worstPath);
    for (const f of flips.slice(0, 12)) console.log('  FLIP ' + f);
    process.exit(1);
  }
  return worst;
}
// bit-exact: every leaf on both sides, NaN equal to NaN, -0 distinct from 0
function exact(A, B, tick) {
  const bad = [];
  for (const m of ['num', 'disc'])
    for (const k of new Set([...A[m].keys(), ...B[m].keys()])) {
      const a = A[m].get(k), b = B[m].get(k);
      if (!Object.is(a, b)) bad.push(k + ' ' + a + ' -> ' + b);
    }
  if (bad.length) {
    console.log('APPLY CHANGED S tick=' + tick + ' leaves=' + bad.length);
    for (const f of bad.slice(0, 20)) console.log('  ' + f);
    process.exit(1);
  }
}
const stateBytes = (M, meta) => { const w = M.FREEZE.writer(); M.SIMSTATE.state(w, meta); return w.bytes(); };

if (engine === 'apply') {
  const A = boot(), meta = A.SIMSTATE.meta(A.FREEZE.writer());
  let n = 0;
  for (let k = 0; k < N; k++) {
    A.step(0.02);
    const L0 = leaves({ S: A.S(), side: side(A) });
    const b = stateBytes(A, meta);
    A.SIMSTATE.apply(b);
    exact(L0, leaves({ S: A.S(), side: side(A) }), k);
    const b2 = stateBytes(A, meta);
    const at = b.findIndex((v, i) => v !== b2[i]);
    if (b.length !== b2.length || at >= 0) {
      console.log('STATE BYTES MOVED tick=' + k + ' len ' + b.length + ' vs ' + b2.length + ' first diff at ' + at);
      process.exit(1);
    }
    n = L0.num.size + L0.disc.size;
  }
  console.log('dual apply pre=' + pre + ' ticks=' + N + ' leaves=' + n + ' changed=0 bytes-equal');
  process.exit(0);
}
// the same inputs on both sides, through act(): a load change, then a rod demand
function inputs(k, sides) {
  if (k === 1000) for (const M of sides) M.act('loadDem', 0.9);
  if (k === 2000) {
    const v = sides[0].S().coreBy[sides[0].coreIds()[0]].rodDem - 0.02;
    for (const M of sides) M.act('rodCommon', v);
  }
}
const logText = M => M.LOG().map(e => e.tick + ' ' + e.sev + ' ' + e.msg + ' | ' + e.why);

(async () => {
  const A = boot(), B = boot();
  if (engine === 'wasm') {
    const pkg = require('path').join(ROOT, 'sim-rs', 'pkg', 'sim_rs.wasm');
    await B.WasmEngine.live(new Uint8Array(require('fs').readFileSync(pkg)));
  }
  let worst = 0;
  for (let k = 0; k < N; k++) {
    inputs(k, [A, B]);
    A.step(0.02); B.step(0.02);
    worst = Math.max(worst, compare(leaves(A.S()), leaves(B.S()), k));
  }
  const la = logText(A), lb = logText(B);
  const at = la.findIndex((l, i) => l !== lb[i]);
  if (la.length !== lb.length || at >= 0) {
    console.log('LOG DIFFERS lines ' + la.length + ' vs ' + lb.length + ' first at ' + at);
    console.log('  A: ' + la[at]); console.log('  B: ' + lb[at]);
    process.exit(1);
  }
  console.log('dual js-vs-' + engine + ' pre=' + pre + ' ticks=' + N + ' worst-leaf=' + worst.toExponential(2) +
    ' divergences=0 log-lines=' + la.length + ' ' + ASIDE + '-worst=' + asideWorst.toExponential(2));
})().catch(e => { console.error(e); process.exit(2); });
