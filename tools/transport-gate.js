#!/usr/bin/env node
// node tools/transport-gate.js [--ticks N] — §6.3 gate: advectStep +
// injectFluid. Real advectSrc/advectStep on every preset vs sim-rs
// transport-probe replay: masks/counts exact, floats at sdig semantics.
// Plant-coupled reads are dump-kit inputs (src, bookedKg, fallbacks, Tavg
// context, rise areas); the gate covers the pure transport math. Writes
// tools/transport-baseline.json on pass.
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
const WANT = 4;
const DT = 0.02;

const M = headless('{PRE:()=>PLANTPRE,plantPreset,buildLayout,commission,P:()=>P,S:()=>S,step,' +
  'advectStep,advectSrc,advectClampCount,netPAt,netHAt,bookedKg,netBooked,netBookOf,' +
  'edgeCval,netHole,outKeysOf,circOfNode,inLoop,netRefThru:()=>P.netRefThru,' +
  'coreOnCirc,holdCircs,nodeGraph,TavgOf,dTavgOf,circKey,coreFold,netInCore,' +
  'boilerIds,coreIds,feedNode,satOfCirc,tankFluid,injectFluid,injectNode,' +
  'EDGEKG:()=>advectEdgeKg,LANDED:()=>advectLandedBy,' +
  'OUTPS:()=>advectOutPri+":"+advectOutSec,' +
  'STOREHELD:()=>netStoreHeld,D:()=>D,' +
  'COND_P0:()=>COND_P0,CP_STEEL:()=>CP_STEEL,H2_RISE:()=>H2_RISE,' +
  'DRYMIN:()=>DRY_MIN_KG,CDTQ:()=>CORE_DT_QMIN,TRT:()=>TAVG_RATE_TAU}');
const KEYS = ['A', 'B', 'C', 'tc', 'rhoc', 'p0', 'T0', 'n', 'pFloor', 'TFloor',
  'hfg', 'rho', 'cp', 'mu', 'muV', 'solidK', 'Tref'];
const num = v => (v === undefined || v === null) ? NaN : v;
const opt3 = v => (v === undefined || v === null) ? -1 : v;
const cp = a => Array.from(a);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'transport-gate-'));
const fIn = path.join(tmp, 'transport.bin');
const parts = [];
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); parts.push(b); };
const i32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); };
const f64 = v => { const b = Buffer.alloc(8); b.writeDoubleLE(v); parts.push(b); };
const i32a = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeInt32LE(a[i], i * 4); parts.push(b); };
const u32a = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeUInt32LE(a[i] >>> 0, i * 4); parts.push(b); };
const f64a = a => { const b = Buffer.alloc(8 * a.length); for (let i = 0; i < a.length; i++) b.writeDoubleLE(a[i], i * 8); parts.push(b); };
const u8a = a => parts.push(Buffer.from(a));

const presetNames = [];
let nSamples = 0, nInj = 0;
const skipped = { noEdgeKg: 0, held: 0, need: 0, seed: 0, ticks: 0 };
const presets = [];

for (const k of Object.keys(M.PRE())) {
  M.plantPreset(+k); M.buildLayout(); M.commission();
  const S0 = M.S(); S0.diceOff = true;
  presetNames.push(M.PRE()[k][0]);
  const P = { samples: [], injects: [] };
  const D = M.D();
  const net0 = M.P().net, n0 = net0.n, ne0 = net0.edges.length;
  // ---- per-preset meta (structural) ----
  M.outKeysOf(net0);
  const nOut = net0.outKeys.length;
  const opos = net0.edges.map(ed => { const j = net0.outPos.get(ed.key); return j === undefined ? -1 : j; });
  const cmap = new Map(), curves = [];
  const curveOf = net0.satBy.map(c => {
    const key = KEYS.map(k2 => String(num(c[k2]))).join(',');
    if (!cmap.has(key)) { cmap.set(key, curves.length); curves.push(KEYS.map(k2 => num(c[k2]))); }
    return cmap.get(key);
  });
  const bookOf = M.netBookOf(net0), bids = new Map([["", 0]]);
  const bookId = net0.name.map((nm, i) => {
    const b = bookOf[i]; if (b === undefined) return 0;
    if (!bids.has(b)) bids.set(b, bids.size); return bids.get(b);
  });
  const G = M.nodeGraph();
  const circs = M.holdCircs().filter(ci => G.coreCircs[ci] === 1);
  const coreNids = circs.map(ci => new Set(M.coreOnCirc(ci).map(id => M.coreFold(id))));
  const tavgCircs = circs.map(ci => {
    const key = M.circKey(ci), K = (M.P().cores && M.P().cores[key]) || M.P();
    const ck = KEYS.map(k2 => String(num(M.satOfCirc(ci)[k2]))).join(',');
    if (!cmap.has(ck)) { cmap.set(ck, curves.length); curves.push(KEYS.map(k2 => num(M.satOfCirc(ci)[k2]))); }
    return { ci, curve: cmap.get(ck), tmin: num(K.Tmin), tmax: num(K.Tmax) };
  });
  const feedIdx = M.boilerIds().map(id => { const i = net0.index[M.feedNode(id)]; return i === undefined ? 0xFFFFFFFF : i; });
  const coreIdx = M.coreIds().map(id => { const i = net0.index[M.coreFold(id)]; return i === undefined ? 0xFFFFFFFF : i; });
  const riseE = net0.edges.filter(ed => !M.netHole(ed) && net0.z[ed.u] !== net0.z[ed.v]);
  P.meta = {
    n: n0, ne: ne0, eu: net0.edges.map(e => e.u), ev: net0.edges.map(e => e.v),
    vol: cp(net0.vol), z: cp(net0.z), booked: cp(M.netBooked(net0)), bookId,
    tankHas: net0.name.map((nm, i) => (net0.tankIdByNode && net0.tankIdByNode[i] !== undefined) ? 1 : 0),
    gasAt: net0.edges.map(e => opt3(e.gasAt)), liqAt: net0.edges.map(e => opt3(e.liqAt)),
    isBreak: net0.edges.map(e => e.kind === 'break' ? 1 : 0),
    isHole: net0.edges.map(e => (e.kind === 'break' || e.kind === 'vent') ? 1 : 0),
    steam: net0.edges.map(e => e.steam ? 1 : 0), sec: net0.edges.map(e => e.sec ? 1 : 0),
    opos, nOut,
    inCore: net0.name.map(nm => M.netInCore(nm) ? 1 : 0),
    circOf: net0.name.map(nm => { const v = M.circOfNode(nm); return v === undefined ? -999 : v; }),
    refThru: net0.name.map(nm => num((M.netRefThru() || {})[nm])),
    metalKg: net0.metalKg ? cp(net0.metalKg) : new Array(n0).fill(NaN),
    metalTau: net0.metalTau ? cp(net0.metalTau) : new Array(n0).fill(NaN),
    metalUA: net0.metalUA ? cp(net0.metalUA) : new Array(n0).fill(NaN),
    curves, curveOf, feedIdx, coreIdx, tavgCircs,
    coreNode: net0.coreNode === undefined ? -1 : net0.coreNode,
    coreCirc: G.coreCirc === undefined || G.coreCirc === null ? -1 : G.coreCirc,
    consts: [M.COND_P0(), M.CP_STEEL(), M.H2_RISE(), M.DRYMIN(), M.CDTQ(), M.TRT()],
    riseE: riseE.map(ed => net0.edges.indexOf(ed)),
  };
  // ---- traffic + sampling ----
  const S = M.S();
  for (let t = 0; t < TICKS && P.samples.length < WANT; t++) {
    M.step(DT);
    if (t < 1) continue;
    const net = M.P().net, n = net.n, ne = net.edges.length;
    if (n !== n0 || ne !== ne0) { skipped.ticks++; continue; }
    const runFlow = M.P().runFlowH, ekg = M.P().netOut && M.P().netOut.edgeKg;
    if (!ekg) { skipped.noEdgeKg++; continue; }
    if (M.STOREHELD()) { skipped.held++; continue; }
    let need = false;
    for (let i = 0; i < n && !need; i++) if (!S.hBy.has[i]) need = true;
    if (need) { skipped.need++; continue; }
    if (S.bBy) { let bs = false; for (let i = 0; i < n && !bs; i++) if (!S.bBy.has[i] || !S.h2By.has[i]) bs = true; if (bs) { skipped.seed++; continue; } }
    // plant reads first (advectSrc settles metalT; snapshot pre bags after)
    const src = cp(M.advectSrc(S, DT, runFlow));
    const samp = { dt: DT };
    samp.F = {};
    for (const f of ['p', 'x', 'rho', 'rhoG', 'rhoL', 'mu']) samp.F[f] = cp(net.F[f]);
    samp.F.wet = cp(net.F.wet); samp.F.void = cp(net.F.void);
    samp.hV = cp(S.hBy.v); samp.hH = cp(S.hBy.has);
    samp.mV = cp(S.mBy.v); samp.mH = cp(S.mBy.has);
    samp.pbV = cp(S.pBy.v); samp.pbH = cp(S.pBy.has);
    samp.fbP = net.name.map(nm => M.netPAt(S, nm)); samp.fbH = net.name.map(nm => M.netHAt(S, nm));
    samp.hasBoron = S.bBy ? 1 : 0;
    samp.bV = S.bBy ? cp(S.bBy.v) : new Array(n).fill(0);
    samp.bH = S.bBy ? cp(S.bBy.has) : new Array(n).fill(0);
    samp.cV = S.bBy ? cp(S.h2By.v) : new Array(n).fill(0);
    samp.cH = S.bBy ? cp(S.h2By.has) : new Array(n).fill(0);
    samp.metalV = S.metalT ? cp(S.metalT.v) : new Array(n).fill(0);
    samp.metalH = S.metalT ? cp(S.metalT.has) : new Array(n).fill(0);
    samp.src = src;
    samp.metalQV = cp(net.scr.metalQV); samp.metalQM = cp(net.scr.metalQM);
    samp.bookedKg = []; for (let i = 0; i < n; i++) samp.bookedKg.push(num(M.bookedKg(net, S, i)));
    samp.edgeKgIn = []; for (let e = 0; e < ne; e++) samp.edgeKgIn.push(num(ekg[e]));
    samp.boronPrev = num(S.boron); samp.boronDemPrev = num(S.boronDem); samp.h2Prev = num(S.h2);
    samp.tavgPrev = num(S.Tavg); samp.dtavgPrev = num(S.dTavg);
    samp.tavgPrevT = tavgCircs.map(({ ci }) => num(M.TavgOf(S, ci)));
    samp.tavgPrevDT = tavgCircs.map(({ ci }) => num(M.dTavgOf(S, ci)));
    samp.tavgInLoop = []; samp.tavgCoreMember = [];
    tavgCircs.forEach(({ ci }, t2) => {
      for (let i = 0; i < n; i++) {
        samp.tavgInLoop.push(M.inLoop(ci, net.name[i]) ? 1 : 0);
        samp.tavgCoreMember.push(coreNids[t2].has(net.name[i]) ? 1 : 0);
      }
    });
    samp.madvPre = num(S.massOut && S.massOut.advect);
    samp.boronPin = [];
    for (let i = 0; i < n; i++) {
      const tid = net.tankIdByNode && net.tankIdByNode[i];
      if (tid !== undefined && D.tanks[tid] && !D.tanks[tid].hold)
        samp.boronPin.push(num((S.boron0 || 0) - 100 * (num(M.tankFluid(tid).boron) || 0)));
      else samp.boronPin.push(NaN);
    }
    const clampPre = M.advectClampCount();
    void clampPre;
    M.advectStep(S, DT, runFlow, ekg);
    // metal books: exact-timing values are the recomputed post-call ones
    const mqvPost = cp(net.scr.metalQV), mqmPost = cp(net.scr.metalQM);
    for (let i = 0; i < n; i++) {
      if (samp.metalQV[i] !== mqvPost[i] || samp.metalQM[i] !== mqmPost[i]) {
        console.error('metalQ changed across advectStep at ' + i);
        process.exit(2);
      }
    }
    samp.metalQV = mqvPost; samp.metalQM = mqmPost;
    samp.exp = {
      hV: cp(S.hBy.v), hH: cp(S.hBy.has), mV: cp(S.mBy.v), mH: cp(S.mBy.has),
      bV: S.bBy ? cp(S.bBy.v) : samp.bV, bH: S.bBy ? cp(S.bBy.has) : samp.bH,
      cV: S.bBy ? cp(S.h2By.v) : samp.cV, cH: S.bBy ? cp(S.h2By.has) : samp.cH,
      metalV: S.metalT ? cp(S.metalT.v) : samp.metalV,
      edgeKg: cp(M.EDGEKG()), landed: cp(M.LANDED()),
      out: M.OUTPS().split(':').map(Number),
      oKV: cp(net.scr.outKgV), oKM: cp(net.scr.outKgM),
      oHV: cp(net.scr.outH2V), oHM: cp(net.scr.outH2M),
      fHV: cp(net.scr.feedInHV), fHM: cp(net.scr.feedInHM),
      fMV: cp(net.scr.feedInMV), fMM: cp(net.scr.feedInMM),
      cHV: cp(net.scr.coreInHV), cHM: cp(net.scr.coreInHM),
      takeV: cp(net.scr.h2TakeV), takeM: cp(net.scr.h2TakeM),
      clamped: M.advectClampCount(),
      tavgT: tavgCircs.map(({ ci }) => num(M.TavgOf(S, ci))),
      tavgDT: tavgCircs.map(({ ci }) => num(M.dTavgOf(S, ci))),
      tavg: num(S.Tavg), dtavg: num(S.dTavg),
      boron: num(S.boron), boronDem: num(S.boronDem), h2: num(S.h2),
      madv: num(S.massOut && S.massOut.advect),
    };
    samp.riseA = P.meta.riseE.map(e => num(M.edgeCval(net, net.edges[e], S)));
    if (net.riseE && net.riseE.length !== P.meta.riseE.length) {
      console.error('riseE filter mismatch: ' + net.riseE.length + ' vs ' + P.meta.riseE.length);
      process.exit(2);
    }
    P.samples.push(samp);
    nSamples++;
  }
  // ---- synthetic injectFluid cases on live S ----
  const net = M.P().net, n = net.n;
  const injTargets = [net.name[0], 'pipe:__bogus__', net.name[0], net.name[0]];
  const injRates = [100, 50, -1e9, 0];
  for (let j = 0; j < injTargets.length; j++) {
    const tgt = injTargets[j], rate = injRates[j];
    const keep = S.inject;
    S.inject = { kind: 'fluid', rate, target: tgt };
    const node = M.injectNode(tgt);
    const ni = node === null || node === undefined ? -1 : net.index[node];
    const hv = (ni >= 0 && S.mBy.has[ni]) ? S.mBy.v[ni] : undefined;
    const preB = num(S.massOut && S.massOut.inject);
    const preM = ni >= 0 ? S.mBy.v[ni] : NaN;
    M.injectFluid(S, DT);
    const postB = num(S.massOut && S.massOut.inject);
    const sameNum = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));
    const acted = (ni >= 0 && !sameNum(S.mBy.v[ni], preM)) || !sameNum(postB, preB);
    const booked = sameNum(postB, preB) ? 0 : postB - preB;
    P.injects.push({
      node: ni, haveNone: hv === undefined ? 1 : 0, have: num(hv), rate, dt: DT,
      acted: acted ? 1 : 0,
      expHave: ni >= 0 ? S.mBy.v[ni] : NaN, expBooked: booked,
    });
    nInj++;
    S.inject = keep;
  }
  presets.push(P);
}

// ---- encode ----
u32(presets.length);
for (const P of presets) {
  const m = P.meta, n = m.n, ne = m.ne;
  u32(n); u32(ne); u32(1);
  u32a(m.eu); u32a(m.ev); f64a(m.vol); f64a(m.z);
  u8a(m.booked); u32a(m.bookId);
  u8a(m.tankHas);
  i32a(m.gasAt); i32a(m.liqAt);
  u8a(m.isBreak); u8a(m.isHole); u8a(m.steam); u8a(m.sec);
  i32a(m.opos); u32(m.nOut);
  u8a(m.inCore); i32a(m.circOf); f64a(m.refThru); u8a(new Array(n).fill(0));
  f64a(m.metalKg); f64a(m.metalTau); f64a(m.metalUA);
  u32(m.curves.length);
  for (const c of m.curves) f64a(c);
  u32a(m.curveOf);
  u32(m.feedIdx.length); u32a(m.feedIdx);
  u32(m.coreIdx.length); u32a(m.coreIdx);
  u32(m.tavgCircs.length);
  for (const t of m.tavgCircs) { i32(t.ci); u32(t.curve); f64(t.tmin); f64(t.tmax); }
  i32(m.coreNode); u32(P.samples.length ? P.samples[0].hasBoron : 0); i32(m.coreCirc);
  f64a(m.consts);
  u32(m.riseE.length);
  u32a(m.riseE.map(e => m.eu[e])); u32a(m.riseE.map(e => m.ev[e]));
  u32(P.samples.length);
  for (const s of P.samples) {
    f64(s.dt);
    f64a(s.F.p); f64a(s.F.x); f64a(s.F.rho); f64a(s.F.rhoG); f64a(s.F.rhoL); f64a(s.F.mu);
    u8a(s.F.wet); u8a(s.F.void);
    f64a(s.hV); f64a(s.mV); f64a(s.pbV); f64a(s.fbP); f64a(s.fbH);
    u8a(s.hH); u8a(s.mH); u8a(s.pbH);
    f64a(s.bV); f64a(s.cV); f64a(s.metalV); f64a(s.src); f64a(s.metalQV);
    u8a(s.bH); u8a(s.cH); u8a(s.metalH); u8a(s.metalQM);
    f64a(s.bookedKg); f64a(s.edgeKgIn);
    f64(s.boronPrev); f64(s.boronDemPrev); f64(s.h2Prev); f64(s.tavgPrev); f64(s.dtavgPrev);
    f64a(s.tavgPrevT); f64a(s.tavgPrevDT);
    u8a(s.tavgInLoop); u8a(s.tavgCoreMember);
    f64a(s.boronPin);
    f64(s.madvPre);
    const e = s.exp;
    f64a(e.hV); f64a(e.mV); f64a(e.bV); f64a(e.cV); f64a(e.metalV); f64a(e.edgeKg); f64a(e.landed);
    u8a(e.hH); u8a(e.mH); u8a(e.bH); u8a(e.cH);
    f64a([e.out[0], e.out[1], e.madv - s.madvPre, e.boron, e.boronDem, e.h2, e.tavg, e.dtavg]);
    f64a(e.oKV); f64a(e.oHV); f64a(e.fHV); f64a(e.fMV); f64a(e.cHV); f64a(e.takeV);
    u8a(e.oKM); u8a(e.oHM); u8a(e.fHM); u8a(e.fMM); u8a(e.cHM); u8a(e.takeM);
    f64a(e.tavgT); f64a(e.tavgDT);
    u32(e.clamped);
    f64(e.madv);
    f64a(s.riseA);
  }
  u32(P.injects.length);
  for (const j of P.injects) {
    i32(j.node); u32(j.haveNone); f64(j.have); f64(j.rate); f64(j.dt);
    u32(j.acted); f64(j.expHave); f64(j.expBooked);
  }
}
fs.writeFileSync(fIn, Buffer.concat(parts));

const CARGO = (() => { try {
  const p = path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
  fs.accessSync(p); return p;
} catch { return 'cargo'; } })();
const out = execFileSync(CARGO, ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'transport-probe', '--', fIn],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RUSTUP_TOOLCHAIN: '1.89.0-x86_64-pc-windows-gnu' } });
console.log(out.trim());
console.log('skipped=' + JSON.stringify(skipped));
const pass = /FAILURES=0/.test(out);
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'transport-baseline.json'), JSON.stringify({
    presets: presetNames, ticks: TICKS, samples: nSamples, injects: nInj,
  }, null, 1) + '\n');
}
if (!process.env.KEEP_TMP) fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
