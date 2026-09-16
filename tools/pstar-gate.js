#!/usr/bin/env node
// node tools/pstar-gate.js [--vectors N] — netPStar + netKappa gate.
// Fuzzed (c,p0,h,rhoT[,r0,b0]) vs live JS netPStar (rel <= 1e-9, residual
// self-check on both sides) and (c,p,x) vs the kappa formula BIT-EXACT.
// Writes tools/pstar-baseline.json on pass.
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
const N = +(opt('vectors', '200000'));

const M = headless('{SAT_WATER,COOLANT,satCurveFor,mixState,netPStar,COND_P0:()=>COND_P0}');
let rngState = 0x51A5 >>> 0;
const rnd = () => {
  rngState = (rngState + 0x6D2B79F5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const KEYS = ['A', 'B', 'C', 'tc', 'rhoc', 'p0', 'T0', 'n', 'pFloor', 'TFloor',
  'hfg', 'rho', 'cp', 'mu', 'muV', 'solidK', 'Tref'];
const curves = [M.SAT_WATER];
for (const a of M.COOLANT) for (const p0 of [a.P0, a.P0 * 0.5]) curves.push(M.satCurveFor(a, p0));
const num = v => (v === undefined || v === null || Number.isNaN(v)) ? NaN : v;
const CP0 = M.COND_P0();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pstar-gate-'));
const fCur = path.join(tmp, 'curves.bin'), fVec = path.join(tmp, 'pstar.bin'), fOut = path.join(tmp, 'out.bin');
{ const b = Buffer.alloc(4 + curves.length * 17 * 8);
  b.writeUInt32LE(curves.length, 0);
  let o = 4;
  for (const c of curves) for (const k of KEYS) { b.writeDoubleLE(num(c[k]), o); o += 8; }
  fs.writeFileSync(fCur, b); }

const vecs = new Array(N);
{ const b = Buffer.alloc(4 + N * 58);
  b.writeUInt32LE(N, 0);
  const mx = new Float64Array(3);
  let o = 4;
  for (let i = 0; i < N; i++) {
    const ci = Math.floor(rnd() * curves.length), c = curves[ci];
    const p0 = Math.pow(10, -5 + rnd() * 6.5), h = -2000 + rnd() * 7000;
    let rhoT, hasR0 = 0, r0 = NaN, b0 = NaN;
    const kind = rnd();
    if (kind < 0.5) { // solvable: density at a random nearby state
      const p1 = Math.pow(10, -5 + rnd() * 6.5), h1 = -2000 + rnd() * 7000;
      M.mixState(c, p1, h1, mx);
      rhoT = mx[1];
    } else if (kind < 0.9) rhoT = Math.pow(10, -2 + rnd() * 5.3); // 0.01..2000, pins possible
    else rhoT = -rnd() * 10; // vacuum short-circuit
    if (rnd() < 0.5) { M.mixState(c, p0, h, mx); hasR0 = 1; r0 = mx[1]; b0 = mx[2]; }
    const kp = Math.pow(10, -5 + rnd() * 6.5), kx = -0.5 + rnd() * 2.0;
    vecs[i] = [ci, p0, h, rhoT, hasR0, r0, b0, kp, kx];
    b.writeUInt8(ci, o); o += 1;
    b.writeUInt8(hasR0, o); o += 1;
    for (const v of [p0, h, rhoT, r0, b0, kp, kx]) { b.writeDoubleLE(v, o); o += 8; }
  }
  fs.writeFileSync(fVec, b); }

// JS reference: real netPStar + replicated kappa formula.
const ref = new Array(N);
{ const mx = new Float64Array(3);
  for (let i = 0; i < N; i++) {
    const [ci, p0, h, rhoT, hasR0, r0, b0, kp, kx] = vecs[i], c = curves[ci];
    const ps = M.netPStar(c, p0, h, rhoT, hasR0 ? r0 : undefined, hasR0 ? b0 : undefined);
    const q = clamp(kx, 0, 1), g = 1 / Math.max(kp, CP0);
    const kf = 0.0025 / Math.max(1e-6, c.solidK || 1.4);
    ref[i] = [ps, q * g + (1 - q) * Math.min(g, kf)];
  } }

execFileSync('cargo', ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'eos-probe', '--', 'pstar', fCur, fVec, fOut],
  { cwd: ROOT, stdio: 'inherit' });

const ob = fs.readFileSync(fOut);
let worst = 0, worstAt = '', kappaBad = 0, residBad = 0, nonConv = 0, nonConvSpread = 0;
{ const mx = new Float64Array(3);
  for (let i = 0; i < N; i++) {
    const [ci, p0, h, rhoT] = vecs[i], c = curves[ci];
    const ps = ob.readDoubleLE(4 + i * 16), ka = ob.readDoubleLE(4 + i * 16 + 8);
    const [rps, rka] = ref[i];
    if (!Object.is(ka, rka)) kappaBad++;
    if (Object.is(ps, rps)) continue;
    if (Number.isNaN(ps) || Number.isNaN(rps)) { residBad++; worstAt = 'vec ' + i + ' NaN'; continue; }
    // Convergence classification first: the Newton contract only promises
    // the tolerance-bound answer when it converges. Joint non-convergence
    // (unreachable rhoT at this h) is an agreed answer; its spread is
    // recorded, not gated.
    if (rhoT > 0 && isFinite(rhoT)) {
      M.mixState(c, ps, h, mx);
      const rr = Math.abs(mx[1] - rhoT) <= 1e-6 * rhoT + 1e-9;
      M.mixState(c, rps, h, mx);
      const jr = Math.abs(mx[1] - rhoT) <= 1e-6 * rhoT + 1e-9;
      if (jr && !rr) { residBad++; if (!worstAt) worstAt = 'vec ' + i + ' js-converged rs-did-not'; }
      if (!jr && !rr) {
        nonConv++;
        const spread = Math.abs(ps - rps) / (Math.abs(ps) + Math.abs(rps) + 1e-300);
        if (spread > nonConvSpread) nonConvSpread = spread;
        continue;
      }
    }
    const rel = Math.abs(ps - rps) / (Math.abs(ps) + Math.abs(rps) + 1e-300);
    if (rel > worst) { worst = rel; worstAt = 'vec ' + i + ' js=' + rps + ' rs=' + ps; }
  } }
const pass = kappaBad === 0 && residBad === 0 && worst <= 1e-9;
console.log('vectors=' + N + ' pstar-worst-rel=' + worst.toExponential(2) + ' @ ' + worstAt +
  ' kappa-exact-fails=' + kappaBad + ' residual-fails=' + residBad +
  ' joint-nonconv=' + nonConv + ' nonconv-spread=' + nonConvSpread.toExponential(2) +
  ' ' + (pass ? 'PASS' : 'FAIL'));
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'pstar-baseline.json'), JSON.stringify({
    vectors: N, curves: curves.length, worstRel: +worst.toExponential(2), worstAt,
    jointNonConv: nonConv, nonConvSpread: +nonConvSpread.toExponential(2),
  }, null, 1) + '\n');
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
