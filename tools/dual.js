#!/usr/bin/env node
// node tools/dual.js --pre <n> --ticks <N> [--engine=js|wasm]
// Dual-run harness (plan §7): commission both engines from one seed, step
// both, compare sim_digest() per tick, halt with full dump on divergence.
// --engine=wasm needs the sim-rs build; until then only js-vs-js runs (which
// still gates harness determinism: zero divergences expected).
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
  const M = headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,S:()=>S,step,P:()=>P}');
  M.plantPreset(pre); M.buildLayout(); M.commission();
  M.S().diceOff = true;
  return M;
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
function compare(A, B, tick) {
  let worst = 0, worstPath = '';
  for (const [p, a] of A.num) {
    const b = B.num.get(p);
    if (b === undefined) { worst = Infinity; worstPath = p + ' (missing in B)'; break; }
    const rel = Math.abs(a - b) / (Math.abs(a) + Math.abs(b) + 1e-30);
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

if (engine === 'wasm') {
  console.error('dual: --engine=wasm needs sim-rs/pkg built (Phase 1+).');
  process.exit(2);
}
const A = boot(), B = boot();
let worst = 0;
for (let k = 0; k < N; k++) {
  A.step(0.02); B.step(0.02);
  worst = Math.max(worst, compare(leaves(A.S()), leaves(B.S()), k));
}
console.log('dual js-vs-js pre=' + pre + ' ticks=' + N + ' worst-leaf=' + worst.toExponential(2) + ' divergences=0 root=' + ROOT);
