#!/usr/bin/env node
// node tools/store-gate.js [--ticks N] — §6.2e gate: storage rows.
// Real netStore on every preset vs sim-rs store-probe replay: pins,
// nullness and memo exact, floats at sdig semantics. Writes
// tools/store-baseline.json on pass.
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
  'netFieldUpdate,netStore,netHAt,tankCapAt,tankP,condStoreC,condStoreW,condSatP,' +
  'partWrecked,condVacuum,drumIds,holdTankIds,STOREHELD:()=>netStoreHeld}');
const KEYS = ['A', 'B', 'C', 'tc', 'rhoc', 'p0', 'T0', 'n', 'pFloor', 'TFloor',
  'hfg', 'rho', 'cp', 'mu', 'muV', 'solidK', 'Tref'];
const num = v => (v === undefined || v === null || Number.isNaN(v)) ? NaN : v;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'store-gate-'));
const fIn = path.join(tmp, 'store.bin');
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
  const P = { samples: [] };
  for (let t = 0; t < TICKS; t++) {
    M.step(0.02);
    if (!SAMPLE_AT.includes(t)) continue;
    const net = M.P().net, n = net.n, F = net.F;
    M.netFieldUpdate(net, S);
    const pre = [net.stKp, net.stKh, net.stKm, net.stP0, net.stC].map(a => Array.from(a));
    const st = M.netStore(net, S);
    const fbH = new Array(n);
    for (let i = 0; i < n; i++) fbH[i] = M.netHAt(S, net.name[i]);
    const tanks = [];
    for (const id in net.tankNode) tanks.push([M.tankCapAt(S, id), M.tankP(S, id)]);
    const conds = (net.condV || []).map((i, k) => {
      const id = net.condParts[k];
      return [M.condStoreC(S, id), M.condStoreW(S, id), M.condSatP(S, id),
        M.partWrecked(S, id) ? 1 : 0, M.condVacuum(id) ? 1 : 0];
    });
    P.samples.push({
      Fp: Array.from(F.p), Frho: Array.from(F.rho), Fx: Array.from(F.x), Fb: Array.from(F.b),
      mbV: Array.from(S.mBy.v), mbH: Array.from(S.mBy.has),
      hbV: Array.from(S.hBy.v), hbH: Array.from(S.hBy.has), fbH,
      held: M.STOREHELD() ? 1 : 0, tanks, conds, pre,
      any: st ? 1 : 0,
      cap: st ? Array.from(st.cap) : new Array(n).fill(0),
      src: st ? Array.from(st.src) : new Array(n).fill(0),
      pin: st ? Array.from(st.pin) : new Array(n).fill(0),
      post: [net.stKp, net.stKh, net.stKm, net.stP0, net.stC].map(a => Array.from(a)),
    });
    nSamples++;
  }
  const net = M.P().net;
  const cmap = new Map(), curves = [];
  const curveOf = net.satBy.map(c => {
    const key = KEYS.map(k => String(num(c[k]))).join(',');
    if (!cmap.has(key)) { cmap.set(key, curves.length); curves.push(KEYS.map(k => num(c[k]))); }
    return cmap.get(key);
  });
  const tankIds = Object.keys(net.tankNode);
  P.meta = { n: net.n, vol: Array.from(net.vol), curves, curveOf,
    hold: M.holdTankIds().map(id => net.tankNode[id]).filter(i => i !== undefined),
    drums: M.drumIds().map(id => net.tankNode[id]).filter(i => i !== undefined),
    tanks: tankIds.map(id => net.tankNode[id]),
    conds: (net.condV || []).slice() };
  presets.push(P);
}
u32(presets.length);
for (const P of presets) {
  const m = P.meta;
  u32(m.n); u32(1);
  f64arr(m.vol);
  u32(m.curves.length);
  for (const c of m.curves) f64arr(c);
  u32arr(m.curveOf);
  u32(m.hold.length); u32arr(m.hold);
  u32(m.drums.length); u32arr(m.drums);
  u32(m.tanks.length); u32arr(m.tanks);
  u32(m.conds.length); u32arr(m.conds);
  u32(P.samples.length);
  for (const s of P.samples) {
    f64arr(s.Fp); f64arr(s.Frho); f64arr(s.Fx); f64arr(s.Fb);
    f64arr(s.mbV); u8arr(s.mbH); f64arr(s.hbV); u8arr(s.hbH); f64arr(s.fbH);
    u32(s.held);
    for (const [c, p] of s.tanks) { f64arr([c]); f64arr([p]); }
    for (const [c, w, p, wr, va] of s.conds) { f64arr([c]); f64arr([w]); f64arr([p]); u32(wr); u32(va); }
    for (const a of s.pre) f64arr(a);
    u32(s.any); f64arr(s.cap); f64arr(s.src); u8arr(s.pin);
    for (const a of s.post) f64arr(a);
  }
}
fs.writeFileSync(fIn, Buffer.concat(parts));

const out = execFileSync('cargo', ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'store-probe', '--', fIn],
  { cwd: ROOT, encoding: 'utf8' });
console.log(out.trim());
const pass = /FAILURES=0/.test(out);
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'store-baseline.json'), JSON.stringify({
    presets: presetNames, ticks: TICKS, samples: nSamples,
  }, null, 1) + '\n');
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
