#!/usr/bin/env node
// node tools/edge-gate.js [--ticks N] — §6.2f gate: edge terms.
// Real edgeG/edgeH in a single march-context pass on every preset vs sim-rs
// edge-probe replay: choke exact, h exact, C/g at sdig semantics. Writes
// tools/edge-baseline.json on pass.
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
const NF = 45;

const M = headless('{PRE:()=>PLANTPRE,plantPreset,buildLayout,commission,P:()=>P,S:()=>S,step,' +
  'netFieldUpdate,edgeCval,edgeG,edgeH,netMarching,CHOKE:()=>FLOWG_CHOKE,HEADK:()=>HEAD_K,' +
  'CASINGF:()=>CASING_F,PUMPH0:()=>PUMP_H0,' +
  'tankLive,portLive,reliefLive,sgtrLive,sgOpen,cellBroken,portWrecked,partWrecked,' +
  'condVacuum,condVentBore,condDumpOpen,condDumpKgs,TANK_RHO:()=>TANK_RHO,' +
  'turbCOf,sgtrC,sgWastOf,feedTrainC,coreState,pumpDrive,cavOf,pumpRhoK,pumpHead,poolH,tankKg,D:()=>D}');
const num = v => (v === undefined || v === null) ? NaN : v;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-gate-'));
const fIn = path.join(tmp, 'edge.bin');
const parts = [];
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); };
const i32a = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeInt32LE(a[i], i * 4); parts.push(b); };
const u32a = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeUInt32LE(a[i], i * 4); parts.push(b); };
const f64a = a => { const b = Buffer.alloc(8 * a.length); for (let i = 0; i < a.length; i++) b.writeDoubleLE(a[i], i * 8); parts.push(b); };
const u8a = a => parts.push(Buffer.from(a));
const opt3 = v => (v === undefined || v === null) ? -1 : v;

const presetNames = [];
let nSamples = 0;
const presets = [];
for (const k of Object.keys(M.PRE())) {
  M.plantPreset(+k); M.buildLayout(); M.commission();
  const S = M.S(); S.diceOff = true;
  presetNames.push(M.PRE()[k][0]);
  const P = { samples: [] };
  const D = M.D();
  for (let t = 0; t < TICKS; t++) {
    M.step(0.02);
    if (!SAMPLE_AT.includes(t)) continue;
    const net = M.P().net, n = net.n, ne = net.edges.length, F = net.F;
    M.netFieldUpdate(net, S);
    const kits = [], gates = [], exp = [];
    const initChoke = M.CHOKE() ? 1 : 0;
    M.netMarching(true);
    try {
      for (let e = 0; e < ne; e++) {
        const ed = net.edges[e];
        const hasW = net.wHas[ed.wi] ? 1 : 0;
        const w = hasW ? net.wArr[ed.wi] : NaN;
        const q = new Array(NF).fill(NaN);
        const Ck = ed.Ck === undefined ? -1 : ed.Ck;
        // Predicate kit: evaluated only for the Ck class that reads it
        // (pid-less edges would throw in pid predicates).
        if (Ck < 0) q[0] = num(typeof ed.C === 'function' ? ed.C(S) : ed.C);
        if (Ck >= 0 && ed.Cdead) q[1] = M.partWrecked(S, ed.Cdead) ? 1 : 0;
        q[2] = w; q[3] = hasW;
        if (Ck === 1) { q[4] = M.tankLive(S, ed.tid) ? 1 : 0; q[5] = M.portLive(S, ed.end) ? 1 : 0; }
        if (Ck === 2) q[5] = M.portLive(S, ed.end) ? 1 : 0;
        if (Ck === 4) { q[6] = num(S.fregBy && S.fregBy[ed.freg]); q[7] = M.feedTrainC(); }
        if (Ck === 5) q[8] = M.turbCOf(S, ed.pid);
        if (Ck === 6) { q[9] = M.sgtrLive(S, ed.pid) ? 1 : 0; q[10] = M.sgtrC() * M.sgWastOf(S, ed.pid); }
        if (Ck === 7) q[11] = M.cellBroken(S, ed.cx, ed.cy) ? 1 : 0;
        if (Ck === 8 || Ck === 10 || Ck === 12 || Ck === 15) q[12] = M.portWrecked(S, ed.pid) ? 1 : 0;
        if (Ck === 9) q[14] = M.sgOpen(S, ed.pid) ? 1 : 0;
        if (Ck === 10) {
          q[15] = (S.condLost && M.condVacuum(ed.pid)) ? 1 : 0;
          q[16] = q[15] ? M.condVentBore(ed.pid) : NaN;
          q[17] = M.condDumpOpen(S) ? 1 : 0;
          q[18] = M.condDumpKgs(); q[19] = M.TANK_RHO();
        }
        if (Ck === 11 || Ck === 14) q[20] = ((M.coreState(S, ed.pid) || S).breach) ? 1 : 0;
        if (Ck === 13 || Ck === 14) {
          const cs = M.coreState(S, ed.pid);
          q[21] = cs ? num(cs.tubesOpen) : NaN;
          q[22] = (cs && cs.cavRelief) ? 1 : 0;
        }
        if (Ck === 15) {
          q[23] = (S.burstBy && S.burstBy[ed.pid]) ? 1 : 0;
          const t = D.tanks[ed.pid] || {}, b = t.burst;
          q[24] = M.tankKg(ed.pid);
          q[25] = num(t.vol); q[26] = num(b && b.drain); q[27] = num(b && b.at);
          q[28] = b ? 1 : 0; q[29] = M.P().Pcont;
        }
        q[30] = M.CASINGF(); q[31] = M.PUMPH0();
        if (ed.pump) {
          q[32] = 1;
          q[33] = M.pumpHead(ed.pump);
          q[34] = M.pumpDrive(S, ed.pump);
          q[35] = M.cavOf(S, ed.pump);
          q[36] = M.pumpRhoK(S, ed.pump);
        } else q[32] = 0;
        q[37] = ed.poolAt !== undefined ? M.poolH(net, S, ed.poolAt) : 0;
        q[38] = M.HEADK();
        q[39] = typeof ed.h0 === 'function' ? ed.h0(S) : num(ed.h0);
        q[40] = ed.hSrc ? ed.hSrc(S) : 0;
        q[41] = num(ed.I);
        if (Ck === 3) {
          q[43] = ed.gateMode === 'throttle' ? 1 : 0;
          q[44] = M.reliefLive(S, ed.pid) ? 1 : 0;
        }
        const gateVals = [];
        if (ed.gateMode === 'throttle') for (const fid of (ed.gateIds || [])) gateVals.push(num(S.valve && S.valve[fid]));
        // edgeCval is choke-clean (fric/throttle math only): safe standalone.
        const cc = M.edgeCval(net, ed, S);
        // Replicate netSolve's gh loop EXACTLY: numeric g/h ride through
        // untouched (`|| 0`), only function ones evaluate.
        const gv = typeof ed.g === 'function' ? M.edgeG(net, ed, S) : ed.g;
        const g = gv || 0;
        const ch = M.CHOKE() ? 1 : 0;
        const h = typeof ed.h === 'function' ? M.edgeH(net, ed, S) : (ed.h || 0);
        kits.push(q); gates.push(gateVals); exp.push([cc, g, h, ch]);
      }
    } finally { M.netMarching(false); }
    P.samples.push({ kits, gates, exp, initChoke,
      Fp: Array.from(F.p), Fx: Array.from(F.x), Frho: Array.from(F.rho), FrhoD: Array.from(F.rhoD),
      FrhoG: Array.from(F.rhoG), FrhoL: Array.from(F.rhoL), Fmu: Array.from(F.mu),
      Fwet: Array.from(F.wet), Fvoid: Array.from(F.void),
      wArr: Array.from(net.wArr),
      choke: net.choke ? Array.from(net.choke) : null });
    nSamples++;
  }
  const net = M.P().net;
  P.meta = { n: net.n, ne: net.edges.length,
    eu: net.edges.map(e => e.u), ev: net.edges.map(e => e.v),
    wi: net.edges.map(e => e.wi === undefined ? -1 : e.wi),
    hasI: net.edges.map(e => e.i === undefined ? 0 : 1),
    ii: net.edges.map(e => e.i === undefined ? 0 : e.i),
    dz: net.edges.map(e => net.z[e.u] - net.z[e.v]),
    poolAt: net.edges.map(e => e.poolAt === undefined ? -1 : e.poolAt),
    chokeAt: net.edges.map(e => opt3(e.chokeAt)), gasAt: net.edges.map(e => opt3(e.gasAt)),
    liqAt: net.edges.map(e => opt3(e.liqAt)),     ck: net.edges.map(e => e.Ck === undefined ? -1 : e.Ck),
    diode: net.edges.map(e => num(e.diode)),
    bore: net.edges.map(e => num(e.bore)), llen: net.edges.map(e => num(e.llen)),
    k0: net.edges.map(e => num(e.k0)), hc: net.edges.map(e => num(e.hC)),
    cavN: net.edges.map(e => num(e.cavN)), cavOne: net.edges.map(e => num(e.cavOne)),
    cavRelief: net.edges.map(e => num(e.cavRelief)),
    cc0: net.edges.map(e => num(e.Cc)),
    gateN: net.edges.map(e => e.gateMode === 'throttle' ? (e.gateIds || []).length : 0),
    gIsFn: net.edges.map(e => typeof e.g === 'function' ? 1 : 0),
    hIsFn: net.edges.map(e => typeof e.h === 'function' ? 1 : 0),
    gScalar: net.edges.map(e => (typeof e.g === 'function' ? NaN : num(e.g))),
    hScalar: net.edges.map(e => (typeof e.h === 'function' ? NaN : num(e.h))) };
  presets.push(P);
}
u32(presets.length);
for (const P of presets) {
  const m = P.meta;
  u32(m.n); u32(m.ne); u32(1);
  u32a(m.eu); u32a(m.ev); i32a(m.wi); u8a(m.hasI); i32a(m.ii); f64a(m.dz); i32a(m.poolAt);
  i32a(m.chokeAt); i32a(m.gasAt); i32a(m.liqAt); i32a(m.ck); f64a(m.diode);
  f64a(m.bore); f64a(m.llen); f64a(m.k0); f64a(m.hc);
  f64a(m.cavN); f64a(m.cavOne); f64a(m.cavRelief); f64a(m.cc0);
  u32a(m.gateN);
  u8a(m.gIsFn); u8a(m.hIsFn); f64a(m.gScalar); f64a(m.hScalar);
  u32(P.samples.length);
  for (const s of P.samples) {
    f64a(s.Fp); f64a(s.Fx); f64a(s.Frho); f64a(s.FrhoD); f64a(s.FrhoG); f64a(s.FrhoL); f64a(s.Fmu);
    u8a(s.Fwet); u8a(s.Fvoid); f64a(s.wArr);
    u32(s.initChoke);
    u32(s.choke ? 1 : 0);
    if (s.choke) { u32(s.choke.length); f64a(s.choke); }
    for (let e = 0; e < m.ne; e++) {
      f64a(s.kits[e]); f64a(s.gates[e]);
      f64a(s.exp[e].slice(0, 3)); u32(s.exp[e][3]);
    }
  }
}
fs.writeFileSync(fIn, Buffer.concat(parts));

const out = execFileSync('cargo', ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'edge-probe', '--', fIn],
  { cwd: ROOT, encoding: 'utf8' });
console.log(out.trim());
const pass = /FAILURES=0/.test(out);
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'edge-baseline.json'), JSON.stringify({
    presets: presetNames, ticks: TICKS, samples: nSamples,
  }, null, 1) + '\n');
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
