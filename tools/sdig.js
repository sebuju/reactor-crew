#!/usr/bin/env node
// node tools/sdig.js <treeRoot> <pre> [ticks]            - hash S after N ticks (bit-identity gate)
// node tools/sdig.js <rootA> <rootB> <pre> [ticks] --leaf - numeric-leaf compare A vs B (the B-bar gate)
//
// The B acceptance bar (docs/plan-alloc-instruments.md): --leaf prints, per preset,
//   - the worst CONTINUOUS leaf drift (relative), which must stay under LEAF_TOL, and
//   - any DISCRETE flip (a burst/flood/trip/latch that is present on one side and not the other),
//     which must be ZERO. A discrete flip is a different plant history, never "a smaller number".
const LEAF_TOL = 1e-6;

function run(root, pre, N){
  Math.random = () => 0.4242424242;                 // resetPlant() seeds off it; every tree seeds alike
  const { headless } = require(root + '/tools/bundle');
  const M = headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,S:()=>S,step,P:()=>P}');
  M.plantPreset(pre); M.buildLayout(); M.commission();
  const s = M.S(); s.diceOff = true;
  for (let k = 0; k < N; k++) M.step(0.02);
  const net = M.P() && M.P().net;
  const canon = (v) => {                              // node state may be a name-keyed object OR a
    if (!v || !net || !net.name) return v;             // {v,has} pair of typed arrays (pfNew, pipenet.js);
    const wrap = v.v && ArrayBuffer.isView(v.v) && ArrayBuffer.isView(v.has);  // read out per NAME so
    const arr = wrap ? null : ArrayBuffer.isView(v);   // absence ("-") never compares equal to a real 0
    const vv = wrap ? v.v : v, hh = wrap ? v.has : null;
    const o = {};
    for (let i = 0; i < net.name.length; i++) {
      const nm = net.name[i];
      o[nm] = (wrap || arr) ? ((hh ? hh[i] : 1) ? vv[i] : '-')
                  : (Object.prototype.hasOwnProperty.call(v, nm) ? v[nm] : '-');
    }
    if (!wrap && !arr) for (const k in v) if (!(k in o)) o['?' + k] = v[k];
    return o;
  };
  if (s.mBy) s.mBy = canon(s.mBy);
  if (s.hBy) s.hBy = canon(s.hBy);
  if (s.pBy) s.pBy = canon(s.pBy);
  if (s.bBy) s.bBy = canon(s.bBy);
  if (s.h2By) s.h2By = canon(s.h2By);
  if (s.metalT) s.metalT = canon(s.metalT);
  return { s, name: M.PLANTPRE()[pre][0] };
}

function hashOf(s){
  let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 | 0, n = 0;
  const eat = t => { for (let i = 0; i < t.length; i++) {
    h1 = Math.imul(h1 ^ t.charCodeAt(i), 16777619) | 0;
    h2 = (Math.imul(h2 + t.charCodeAt(i), 31) ^ (h2 >>> 7)) | 0; } n++; };
  const seen = new WeakSet();
  (function walk(v, path) {
    const t = typeof v;
    if (v === null || t === 'undefined' || t === 'function') return;
    if (t === 'number' || t === 'boolean' || t === 'string') { eat(path); eat(':'); eat(String(v)); return; }
    if (t !== 'object') return;
    if (ArrayBuffer.isView(v)) { eat(path); for (let i = 0; i < v.length; i++) { eat(','); eat(String(v[i])); } return; }
    if (seen.has(v)) { eat(path); eat(':<cycle>'); return; }
    seen.add(v);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) walk(v[i], path + '[' + i + ']'); return; }
    if (v instanceof Map) { for (const k of [...v.keys()].map(String).sort()) walk(v.get(k), path + '{' + k + '}'); return; }
    if (v instanceof Set) { for (const k of [...v].map(String).sort()) eat(path + '#' + k); return; }
    for (const k of Object.keys(v).sort()) walk(v[k], path + '.' + k);
  })(s, 'S');
  return { n, h1: (h1 >>> 0).toString(16).padStart(8, '0'), h2: (h2 >>> 0).toString(16).padStart(8, '0') };
}

// flatten every numeric leaf to a path->number map, plus the discrete-state fingerprint
function leaves(s){
  const num = new Map(), disc = new Map();
  const seen = new WeakSet();
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

const args = process.argv.slice(2);
const leaf = args.includes('--leaf');
const rest = args.filter(a => a[0] !== '-');

if (!leaf) {
  const root = rest[0], pre = +(rest[1] || 0), N = +(rest[2] || 600);
  const { s, name } = run(root, pre, N);
  const f = (x, d) => (x === null || x === undefined || Number.isNaN(x)) ? '-' : (+x).toFixed(d);
  const h = hashOf(s);
  console.log(name.padEnd(12) + ' t=' + f(s.t, 2) + ' Tavg=' + f(s.Tavg, 6) + ' P=' + f(s.P, 8) +
    ' inv=' + f(s.inv, 6) + ' n=' + f(s.n, 8) + '  leaves=' + h.n + '  digest=' + h.h1 + h.h2);
} else {
  const rootA = rest[0], rootB = rest[1], pre = +(rest[2] || 0), N = +(rest[3] || 600);
  const A = leaves(run(rootA, pre, N).s), B = leaves(run(rootB, pre, N).s);
  const name = run(rootA, pre, 0).name;
  // continuous drift
  let worst = 0, worstPath = '';
  for (const [p, a] of A.num) {
    const b = B.num.has(p) ? B.num.get(p) : undefined;
    if (b === undefined) { worst = Infinity; worstPath = p + ' (missing in B)'; break; }
    const rel = Math.abs(a - b) / (Math.abs(a) + Math.abs(b) + 1e-30);
    if (rel > worst) { worst = rel; worstPath = p; }
  }
  for (const p of B.num.keys()) if (!A.num.has(p)) { worst = Infinity; worstPath = p + ' (missing in A)'; break; }
  // discrete flips
  const flips = [];
  const keys = new Set([...A.disc.keys(), ...B.disc.keys()]);
  for (const k of keys) {
    const a = A.disc.has(k) ? A.disc.get(k) : '-', b = B.disc.has(k) ? B.disc.get(k) : '-';
    if (a !== b) flips.push(k + ' ' + a + '->' + b);
  }
  const pass = worst <= LEAF_TOL && flips.length === 0;
  console.log(name.padEnd(12) + '  worst-leaf=' + (worst === Infinity ? 'INF' : worst.toExponential(2)) +
    ' @ ' + worstPath + '  discrete-flips=' + flips.length + '  ' + (pass ? 'PASS' : 'FAIL'));
  if (flips.length) for (const fl of flips.slice(0, 12)) console.log('    FLIP ' + fl);
}
