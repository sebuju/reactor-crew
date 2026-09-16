#!/usr/bin/env node
// node tools/field-gate.js [--ticks N] — §6.2c gate: nodal field update.
// Replays field_update per sample on every preset via sim-rs field-probe:
// u8 arrays exact, floats at sdig semantics. Writes tools/field-baseline.json.
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
  'netFieldUpdate,netPAt,netHAt,poolLvlOf,runKeyOfNode}');
const KEYS = ['A', 'B', 'C', 'tc', 'rhoc', 'p0', 'T0', 'n', 'pFloor', 'TFloor',
  'hfg', 'rho', 'cp', 'mu', 'muV', 'solidK', 'Tref'];
const num = v => (v === undefined || v === null || Number.isNaN(v)) ? NaN : v;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'field-gate-'));
const fIn = path.join(tmp, 'field.bin');
const parts = [];
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); };
const u32arr = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeUInt32LE(a[i], i * 4); parts.push(b); };
const f64arr = a => { const b = Buffer.alloc(8 * a.length); for (let i = 0; i < a.length; i++) b.writeDoubleLE(a[i], i * 8); parts.push(b); };
const u8arr = a => parts.push(Buffer.from(a));

const presetNames = [];
let nSamples = 0;
const presets = [];
for (const k of Object.keys(M.PRE())) {
  M.plantPreset(+k); M.buildLayout(); M.commission();
  const S = M.S(); S.diceOff = true;
  presetNames.push(M.PRE()[k][0]);
  const P = {};
  for (let t = 0; t < TICKS; t++) {
    M.step(0.02);
    if (!SAMPLE_AT.includes(t)) continue;
    const net = M.P().net, n = net.n, ne = net.edges.length, F = net.F;
    const pre = {};
    for (const f of ['p', 'rho', 'x', 'b', 'rhoD', 'rhoG', 'rhoL', 'mu', 'lp', 'lh', 'lm'])
      pre[f] = Array.from(F[f]);
    pre.wet = Array.from(F.wet); pre.wetU8 = pre.wet;
    pre.void = Array.from(F.void);
    M.netFieldUpdate(net, S);
    const fbP = new Array(n), fbH = new Array(n);
    for (let i = 0; i < n; i++) { fbP[i] = M.netPAt(S, net.name[i]); fbH[i] = M.netHAt(S, net.name[i]); }
    const pool = (net.condV || []).map(i => {
      const l = M.poolLvlOf(net, S, i);
      return l === undefined ? NaN : l;
    });
    (P.samples || (P.samples = [])).push({
      pbV: Array.from(S.pBy.v), pbH: Array.from(S.pBy.has),
      hbV: Array.from(S.hBy.v), hbH: Array.from(S.hBy.has),
      mbV: Array.from(S.mBy.v), mbH: Array.from(S.mBy.has),
      wArr: Array.from(net.wArr), fbP, fbH, pool, pre,
      post: { p: Array.from(F.p), rho: Array.from(F.rho), x: Array.from(F.x), b: Array.from(F.b),
        rhoD: Array.from(F.rhoD), rhoG: Array.from(F.rhoG), rhoL: Array.from(F.rhoL),
        wet: Array.from(F.wet), void: Array.from(F.void), mu: Array.from(F.mu),
        lp: Array.from(F.lp), lh: Array.from(F.lh), lm: Array.from(F.lm) },
    });
    nSamples++;
  }
  // Structural, settled on this commission.
  const net = M.P().net, n = net.n;
  const cmap = new Map(), curves = [];
  const curveOf = net.satBy.map(c => {
    const key = KEYS.map(k => String(num(c[k]))).join(',');
    if (!cmap.has(key)) { cmap.set(key, curves.length); curves.push(KEYS.map(k => num(c[k]))); }
    return cmap.get(key);
  });
  P.meta = { n, ne: net.edges.length,
    vol: Array.from(net.vol),
    runMask: net.name.map(nm => M.runKeyOfNode(nm) !== null ? 1 : 0),
    curves, curveOf,
    gas: net.gasNodes || [], liq: net.liqNodes || [], condV: net.condV || [],
    cont: net.name.map((nm, i) => (net.cont || []).includes(i) ? 1 : 0),
    eu: net.edges.map(e => e.u), ev: net.edges.map(e => e.v) };
  presets.push(P);
}
u32(presets.length);
for (const P of presets) {
  const m = P.meta;
  u32(m.n); u32(m.ne); u32(1);
  f64arr(m.vol); u8arr(m.runMask);
  u32(m.curves.length);
  for (const c of m.curves) f64arr(c);
  u32arr(m.curveOf);
  u32(m.gas.length); u32arr(m.gas);
  u32(m.liq.length); u32arr(m.liq);
  u32(m.condV.length); u32arr(m.condV);
  u8arr(m.cont);
  u32arr(m.eu); u32arr(m.ev);
  const F0 = P.samples[0].pre;
  f64arr(F0.p); f64arr(F0.rho); f64arr(F0.x); f64arr(F0.b); f64arr(F0.rhoD);
  f64arr(F0.rhoG); f64arr(F0.rhoL); u8arr(F0.wet); u8arr(F0.void); f64arr(F0.mu);
  f64arr(F0.lp); f64arr(F0.lh); f64arr(F0.lm);
  u32(P.samples.length);
  for (const s of P.samples) {
    f64arr(s.pbV); u8arr(s.pbH); f64arr(s.hbV); u8arr(s.hbH); f64arr(s.mbV); u8arr(s.mbH);
    f64arr(s.wArr); f64arr(s.fbP); f64arr(s.fbH); f64arr(s.pool);
    const p = s.post;
    f64arr(p.p); f64arr(p.rho); f64arr(p.x); f64arr(p.b); f64arr(p.rhoD);
    f64arr(p.rhoG); f64arr(p.rhoL); u8arr(p.wet); u8arr(p.void); f64arr(p.mu);
    f64arr(p.lp); f64arr(p.lh); f64arr(p.lm);
  }
}
fs.writeFileSync(fIn, Buffer.concat(parts));

const out = execFileSync('cargo', ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'field-probe', '--', fIn],
  { cwd: ROOT, encoding: 'utf8' });
console.log(out.trim());
const pass = /FAILURES=0/.test(out);
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'field-baseline.json'), JSON.stringify({
    presets: presetNames, ticks: TICKS, samples: nSamples,
  }, null, 1) + '\n');
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
