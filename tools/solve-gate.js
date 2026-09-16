#!/usr/bin/env node
// node tools/solve-gate.js [--ticks N] — §6.2a gate: the pure linear core.
// Dumps real solve traffic (inputs + outputs) on every preset via the live
// JS, then sim-rs solve-probe replays order/assemble/factor/subst/unfix/
// flows and must reproduce b, q, order, deg and the diverge set BIT-EXACT.
// Writes tools/solve-baseline.json on pass.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { headless, ROOT } = require('./bundle');

const args = process.argv.slice(2);
const opt = (k, d) => {
  const eq = args.find(a => a.startsWith('--' + k + '='));
  if (eq) return eq.slice(k.length + 3);
  const i = args.indexOf('--' + k);
  return (i >= 0 && i + 1 < args.length) ? args[i + 1] : d;
};
const TICKS = +(opt('ticks', '120'));
const SAMPLE_AT = [1, 40, 80, 119].filter(t => t < TICKS);

const M = headless('{PRE:()=>PLANTPRE,plantPreset,buildLayout,commission,P:()=>P,S:()=>S,step,' +
  'netFieldUpdate,netFixed,edgeG,edgeH,scratch,netFactored,netAssemble,netSubstFree,' +
  'netUnfix,netFlows,netDiverge,netRO:()=>netReadOnly}');

// One faithful solve replication: the same real calls in the same order as
// netSolve(), but the gh loop also fills the dump arrays. A separate
// pre-pass would consume FLOWG_CHOKE and perturb the solve being dumped.
function dumpSolve(net, S) {
  net.sigLock = S; net.sigLockV = null;
  try {
    M.netFieldUpdate(net, S);
    const fixed = M.netFixed(net, S);
    const b = M.scratch(net, 'b', net.n, Float64Array, 0);
    const touch = M.scratch(net, 'touch', net.n, Uint8Array, 0);
    const ghG = M.scratch(net, 'ghG', net.edges.length, Float64Array, 0);
    const ghH = M.scratch(net, 'ghH', net.edges.length, Float64Array, 0);
    { const es = net.edges;
      for (let e = 0; e < es.length; e++) { const ed = es[e];
        const gv = typeof ed.g === 'function' ? M.edgeG(net, ed, S) : ed.g;
        ghG[e] = gv || 0;
        ghH[e] = typeof ed.h === 'function' ? M.edgeH(net, ed, S) : (ed.h || 0); } }
    M.netFactored(net, S, fixed, b, touch, ghG, ghH);
    // Capture the exact RHS the solve consumes: AfB true means the refactor
    // path ran (b filled with cap); false means factor reuse (cap-less
    // second assemble, replicated here).
    let withCap, bAsm;
    if (net.AfB) { withCap = 1; bAsm = Array.from(b); }
    else {
      withCap = 0;
      const b2 = new Float64Array(net.n);
      M.netAssemble(net.edges, net.n, fixed, S, false, b2, net.store && net.store.src,
        null, null, null, undefined, ghG, ghH);
      bAsm = Array.from(b2);
    }
    if (!net.AfB)
      M.netAssemble(net.edges, net.n, fixed, S, false, b, net.store && net.store.src,
        null, null, touch, undefined, ghG, ghH);
    M.netSubstFree(net, b);
    M.netUnfix(b, fixed, net.n);
    const q = new Float64Array(net.edges.length);
    M.netFlows(net.edges, b, fixed, q, S, ghG, ghH);
    if (!M.netRO()) { const wA = net.wArr, wH = net.wHas;
      for (let e = 0; e < net.edges.length; e++) { wA[e] = q[e]; wH[e] = 1; } }
    const warns = [];
    const realWarn = console.warn;
    console.warn = m => { if (String(m).startsWith('[divergence]')) warns.push(String(m)); };
    try { M.netDiverge(net, q, fixed, net.store, b); } finally { console.warn = realWarn; }
    return { fixed, ghG: Array.from(ghG), ghH: Array.from(ghH), withCap, bAsm,
      b: Array.from(b), q: Array.from(q), warns };
  } finally { net.sigLock = null; net.sigLockV = null; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solve-gate-'));
const fIn = path.join(tmp, 'samples.bin');
const parts = [];
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); };
const u32arr = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeUInt32LE(a[i], i * 4); parts.push(b); };
const f64arr = a => { const b = Buffer.alloc(8 * a.length); for (let i = 0; i < a.length; i++) b.writeDoubleLE(a[i], i * 8); parts.push(b); };
const u8arr = a => parts.push(Buffer.from(a));

const presetNames = [];
const samples = [];
for (const k of Object.keys(M.PRE())) {
  M.plantPreset(+k); M.buildLayout(); M.commission();
  const S = M.S(); S.diceOff = true;
  presetNames.push(M.PRE()[k][0]);
  for (let t = 0; t < TICKS; t++) {
    M.step(0.02);
    if (!SAMPLE_AT.includes(t)) continue;
    const net = M.P().net, n = net.n, ne = net.edges.length;
    const ds = dumpSolve(net, S);
    const fixed = ds.fixed;
    const uu = new Array(ne), vv = new Array(ne);
    for (let e = 0; e < ne; e++) { uu[e] = net.edges[e].u; vv[e] = net.edges[e].v; }
    const idx = {};
    for (let i = 0; i < n; i++) idx[net.nodes[i]] = i;
    const widx = [];
    for (const w of ds.warns) {
      const nm = w.slice('[divergence] '.length).split(' ')[0];
      if (idx[nm] !== undefined) widx.push(idx[nm]);
    }
    samples.push({ n, ne, uu, vv, ghG: ds.ghG, ghH: ds.ghH, withCap: ds.withCap, bAsm: ds.bAsm,
      fxV: Array.from(fixed.v), fxH: Array.from(fixed.has),
      store: net.store ? { cap: Array.from(net.store.cap), src: Array.from(net.store.src) } : null,
      b: ds.b, q: ds.q,
      order: net.orderFree ? Array.from(net.orderFree) : [],
      deg: net.Afdeg ? Array.from(net.Afdeg) : new Array(n).fill(0),
      widx });
    void ne;
  }
}
u32(samples.length);
for (const s of samples) {
  u32(s.n); u32(s.ne); u32(2); // format v2
  u32arr(s.uu); u32arr(s.vv);
  f64arr(s.ghG); f64arr(s.ghH); f64arr(s.fxV); u8arr(s.fxH);
  u32(s.store ? 1 : 0);
  if (s.store) { f64arr(s.store.cap); f64arr(s.store.src); }
  u32(s.withCap); f64arr(s.bAsm);
  f64arr(s.b); f64arr(s.q);
  u32(s.order.length); u32arr(s.order);
  u8arr(s.deg);
  u32(s.widx.length); u32arr(s.widx);
}
fs.writeFileSync(fIn, Buffer.concat(parts));

const out = execFileSync('cargo', ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'solve-probe', '--', fIn],
  { cwd: ROOT, encoding: 'utf8' });
console.log(out.trim());
const pass = /FAILURES=0/.test(out);
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'solve-baseline.json'), JSON.stringify({
    presets: presetNames, ticks: TICKS, samples: samples.length,
  }, null, 1) + '\n');
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
