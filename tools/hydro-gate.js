#!/usr/bin/env node
// node tools/hydro-gate.js [--queries N] — §6.2b gate: hydraulics leaves.
// Fuzzed field + edge params through JS fricOf/pipeC/holeC/flowW/flowG vs
// sim-rs hydro-probe. sdig semantics (worst-leaf <= 1e-6, zero bool flips);
// bool outputs (choke) must match exactly. Writes tools/hydro-baseline.json.
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
const NQ = +(opt('queries', '500000'));
const NN = 64;
const NONE = 0xffffffff;

const M = headless('{fricOf,pipeC,holeC,flowW,flowG,CHOKE:()=>FLOWG_CHOKE}');
let rngState = 0x0941;
const rnd = () => {
  rngState = (rngState + 0x6D2B79F5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// Field distributions shaped like the real thing: pressures MPa, quality
// across all branches, densities kg/m^3, wet mostly 1, occasional voids.
const F = {};
{
  const R = (n, f) => Array.from({ length: n }, f);
  F.p = R(NN, () => Math.pow(10, -3 + rnd() * 4.5));
  F.x = R(NN, () => -0.3 + rnd() * 1.6);
  F.rhoD = R(NN, () => Math.pow(10, -2 + rnd() * 3.5));
  F.rhoG = R(NN, () => Math.pow(10, -2 + rnd() * 3));
  F.rhoL = R(NN, () => 400 + rnd() * 800);
  F.mu = R(NN, () => Math.pow(10, -5 + rnd() * 2));
  F.wet = R(NN, () => (rnd() < 0.9 ? 1 : 0));
  F.void = R(NN, () => (rnd() < 0.1 ? 1 : 0));
}
const fieldObj = () => ({ p: F.p, x: F.x, wet: F.wet, void: F.void, rhoD: F.rhoD, rhoG: F.rhoG, rhoL: F.rhoL });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hydro-gate-'));
const fIn = path.join(tmp, 'hydro.bin'), fOut = path.join(tmp, 'out.bin');
const parts = [];
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); };
const f64a = a => { const b = Buffer.alloc(8 * a.length); for (let i = 0; i < a.length; i++) b.writeDoubleLE(a[i], i * 8); parts.push(b); };
const u8a = a => parts.push(Buffer.from(a));
u32(NN);
f64a(F.p); f64a(F.x); f64a(F.rhoD); f64a(F.rhoG); f64a(F.rhoL); f64a(F.mu);
u8a(F.wet); u8a(F.void);

const queries = new Array(NQ);
const pick = () => { const r = rnd(); return r < 0.15 ? NONE : Math.floor(rnd() * NN); };
u32(NQ);
for (let i = 0; i < NQ; i++) {
  const bore = Math.pow(10, -2 + rnd() * 2);       // 0.01..1 of BORE_REF
  const hasW = rnd() < 0.85 ? 1 : 0;
  const w = (rnd() - 0.5) * 4000;
  const L = Math.pow(10, -2 + rnd() * 3);
  const K0 = rnd() < 0.5 ? 0 : rnd() * 20;
  const hasF = rnd() < 0.7 ? 1 : 0, fF = 0.005 + rnd() * 0.1;
  const Cq = rnd() < 0.1 ? 0 : Math.pow(10, -8 + rnd() * 4);
  const rhoQ = Math.pow(10, -2 + rnd() * 3.5);
  const pHiQ = Math.pow(10, -3 + rnd() * 4.5), pLoQ = pHiQ - rnd() * pHiQ * 2;
  const gC = rnd() < 0.1 ? 0 : Math.pow(10, -8 + rnd() * 4);
  const hG = (rnd() - 0.5) * 4;
  const diode = rnd() < 0.7 ? 0 : (rnd() < 0.5 ? 1 : -1);
  const hSrc = rnd() < 0.7 ? 0 : rnd() * 2;
  const u = Math.floor(rnd() * NN);
  let v = Math.floor(rnd() * NN);
  if (v === u) v = (v + 1) % NN;
  const q = { bore, w, hasW, L, K0, hasF, fF, Cq, rhoQ, pHiQ, pLoQ, gC, hG, diode, hSrc, u, v,
    chokeAt: pick(), gasAt: pick(), liqAt: pick() };
  queries[i] = q;
  f64a([bore, w, hasW, L, K0, hasF, fF, Cq, rhoQ, pHiQ, pLoQ, gC, hG, diode, hSrc]);
  u32(q.u); u32(q.v); u32(q.chokeAt); u32(q.gasAt); u32(q.liqAt);
}
fs.writeFileSync(fIn, Buffer.concat(parts));

// JS reference (real functions; flowG's module choke flag read off directly).
const ref = new Array(NQ);
{
  const Fobj = fieldObj();
  for (let i = 0; i < NQ; i++) {
    const q = queries[i];
    const fr = M.fricOf(q.bore, q.hasW ? q.w : undefined, F.mu[q.u]);
    const pc = M.pipeC(q.bore, q.L, q.K0, q.hasF ? q.fF : undefined);
    const hc = M.holeC(q.bore);
    const fw = M.flowW(q.Cq, q.rhoQ, q.pHiQ, q.pLoQ);
    const g = M.flowG(q.gC, Fobj, q.u, q.v, q.hG, q.diode, q.hSrc,
      q.chokeAt === NONE ? undefined : q.chokeAt,
      q.gasAt === NONE ? undefined : q.gasAt,
      q.liqAt === NONE ? undefined : q.liqAt);
    ref[i] = [fr, pc, hc, fw, g, M.CHOKE() ? 1 : 0];
  }
}

execFileSync('cargo', ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'hydro-probe', '--', fIn, fOut],
  { cwd: ROOT, stdio: 'inherit' });

const ob = fs.readFileSync(fOut);
const NAMES = ['fric', 'pipeC', 'holeC', 'flowW', 'flowG', 'choke'];
let exact = 0, flips = 0, worst = 0, worstAt = '';
for (let i = 0; i < NQ; i++) {
  for (let j = 0; j < 6; j++) {
    const a = ref[i][j], q = ob.readDoubleLE(4 + i * 48 + j * 8), nm = NAMES[j];
    if (Object.is(a, q)) { exact++; continue; }
    if (nm === 'choke') { flips++; if (flips < 8) console.log('  FLIP vec ' + i + ' choke ' + a + '->' + q); continue; }
    if (Number.isNaN(a) || Number.isNaN(q)) { flips++; continue; }
    const rel = Math.abs(a - q) / (Math.abs(a) + Math.abs(q) + 1e-30);
    if (rel > worst) { worst = rel; worstAt = 'vec ' + i + ' ' + nm + ' a=' + a + ' q=' + q; }
  }
}
const total = NQ * 6, pass = flips === 0 && worst <= 1e-6;
console.log('queries=' + NQ + ' exact=' + exact + '/' + total +
  ' worst-rel=' + worst.toExponential(2) + ' @ ' + worstAt + ' flips=' + flips +
  ' ' + (pass ? 'PASS' : 'FAIL'));
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'hydro-baseline.json'), JSON.stringify({
    queries: NQ, exact, total, worstRel: +worst.toExponential(2), worstAt, flips: 0,
  }, null, 1) + '\n');
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
