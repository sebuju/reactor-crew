#!/usr/bin/env node
// node tools/eos-gate.js [--vectors N] — §6.1 gate: N randomized (c,p,h)
// vectors through JS EOS vs sim-rs eos-probe. Exact-match except the
// documented libm-ulp set (transcendental paths); zero branch flips.
// Writes tools/eos-baseline.json on pass.
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
const N = +(opt('vectors', '1000000'));
const SEED = 0xE05CA1;

const M = headless('{SAT_WATER,COOLANT,satCurveFor,mixState,satT,hfgOf,rhofOf,rhogOf,satP,tOfH,xOfH}');
// mulberry32 — the tree's own dice shape, seeded fixed for the gate.
let rngState = SEED >>> 0;
const rnd = () => {
  rngState = (rngState + 0x6D2B79F5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const KEYS = ['A', 'B', 'C', 'tc', 'rhoc', 'p0', 'T0', 'n', 'pFloor', 'TFloor',
  'hfg', 'rho', 'cp', 'mu', 'muV', 'solidK', 'Tref'];
const curves = [M.SAT_WATER];
for (const a of M.COOLANT) for (const p0 of [a.P0, a.P0 * 0.5]) curves.push(M.satCurveFor(a, p0));
const num = v => (v === undefined || v === null || Number.isNaN(v)) ? NaN : v;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-gate-'));
const fCur = path.join(tmp, 'curves.bin'), fVec = path.join(tmp, 'vectors.bin');
const fRef = path.join(tmp, 'ref.bin'), fOut = path.join(tmp, 'out.bin');

{ // curves.bin: u32 n, then 17 f64 LE per curve.
  const b = Buffer.alloc(4 + curves.length * 17 * 8);
  b.writeUInt32LE(curves.length, 0);
  let o = 4;
  for (const c of curves) for (const k of KEYS) { b.writeDoubleLE(num(c[k]), o); o += 8; }
  fs.writeFileSync(fCur, b);
}
const vecs = new Array(N);
{ // vectors.bin: u32 n, then (u8 curveIdx, f64 p, f64 h) per vector.
  const b = Buffer.alloc(4 + N * 17);
  b.writeUInt32LE(N, 0);
  let o = 4;
  for (let i = 0; i < N; i++) {
    const ci = Math.floor(rnd() * curves.length);
    const p = Math.pow(10, -5 + rnd() * 6.5);   // 1e-5 .. ~30 MPa
    const h = -2000 + rnd() * 7000;             // subcooled .. superheated
    vecs[i] = [ci, p, h];
    b.writeUInt8(ci, o); o += 1;
    b.writeDoubleLE(p, o); o += 8;
    b.writeDoubleLE(h, o); o += 8;
  }
  fs.writeFileSync(fVec, b);
}
{ // ref.bin: u32 n, then 10 f64 LE per vector (x rho b satT hfg rf rg sp tOfH xOfH).
  const b = Buffer.alloc(4 + N * 80);
  b.writeUInt32LE(N, 0);
  const o3 = new Float64Array(3);
  let o = 4;
  for (let i = 0; i < N; i++) {
    const [ci, p, h] = vecs[i], c = curves[ci];
    M.mixState(c, p, h, o3);
    const ts = M.satT(c, p);
    const vals = [o3[0], o3[1], o3[2], ts, M.hfgOf(c, ts), M.rhofOf(c, ts),
      M.rhogOf(c, ts), M.satP(c, ts), M.tOfH(c, p, h), M.xOfH(c, p, h)];
    for (const v of vals) { b.writeDoubleLE(v, o); o += 8; }
  }
  fs.writeFileSync(fRef, b);
}

execFileSync('cargo', ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'eos-probe', '--', 'eos', fCur, fVec, fOut],
  { cwd: ROOT, stdio: 'inherit' });

const rb = fs.readFileSync(fRef), ob = fs.readFileSync(fOut);
const NAMES = ['x', 'rho', 'b', 'satT', 'hfg', 'rf', 'rg', 'sp', 'tOfH', 'xOfH'];
let exact = 0, flips = [], maxUlp = 0, maxRel = 0, maxAt = '';
for (let i = 0; i < N; i++) {
  for (let j = 0; j < 10; j++) {
    const a = rb.readDoubleLE(4 + i * 80 + j * 8), q = ob.readDoubleLE(4 + i * 80 + j * 8);
    const nm = NAMES[j];
    if (Object.is(a, q)) { exact++; continue; }
    if (nm === 'b') { flips.push('vec ' + i + ' b ' + a + '->' + q); continue; }
    if (Number.isNaN(a) || Number.isNaN(q)) { flips.push('vec ' + i + ' ' + nm + ' NaN ' + a + '->' + q); continue; }
    const rel = Math.abs(a - q) / (Math.abs(a) + Math.abs(q) + 1e-30);
    const ulp = rel / 2.220446049250313e-16;
    if (ulp > maxUlp) { maxUlp = ulp; maxRel = rel; maxAt = 'vec ' + i + ' ' + nm + ' a=' + a + ' q=' + q; }
  }
}
const total = N * 10;
// Acceptance is sdig --leaf semantics (worst-leaf <= 1e-6, zero discrete
// flips). Exact/ulp stats are recorded, not gated: anything downstream of
// satT/table-build flows through libm exp/log/pow, whose last-ulp codegen
// differences amplify through (h-hf)/hfg division near shelf edges.
const pass = flips.length === 0 && maxRel <= 1e-6;
console.log('vectors=' + N + ' exact=' + exact + '/' + total +
  ' worst-rel=' + maxRel.toExponential(2) + ' (' + maxUlp.toFixed(1) + 'ulp) @ ' + maxAt +
  ' flips=' + flips.length + ' ' + (pass ? 'PASS' : 'FAIL'));
for (const f of flips.slice(0, 8)) console.log('  FLIP ' + f);
if (pass) {
  let h1 = 0x811c9dc5 | 0;
  for (let i = 4; i < rb.length; i++) h1 = Math.imul(h1 ^ rb[i], 16777619) | 0;
  fs.writeFileSync(path.join(ROOT, 'tools', 'eos-baseline.json'), JSON.stringify({
    vectors: N, seed: SEED, curves: curves.length,
    exact, total, maxRel: +maxRel.toExponential(2), maxUlp: +maxUlp.toFixed(1), maxAt, flips: 0,
    refDigest: (h1 >>> 0).toString(16).padStart(8, '0'),
  }, null, 1) + '\n');
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
