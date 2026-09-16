#!/usr/bin/env node
// node tools/solvefull-gate.js [--ticks N] — full §6.2 gate: fixed-S solve
// pairs end to end. One faithful solve replication per sample on every
// preset (real JS functions, same order as netSolve), dumping every stage
// input; sim-rs solvefull-probe chains field→edges→pieces→fixed→store→
// linear→readP→readEdges and must reproduce b/q/byP/flows/outs. Floats at
// sdig semantics, discrete structure bit-exact. Writes
// tools/solvefull-baseline.json on pass.
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
  'netFieldUpdate,netFixed,netStore,netFactored,netAssemble,netSubstFree,netUnfix,netFlows,' +
  'netDiverge,netRef,netPieces,netLiveSig,corePieces,netBounds,netPcont,netPAt,netHAt,poolLvlOf,runKeyOfNode,' +
  'holdTankIds,drumIds,holdPOf,holdSetP,tankCircuit,tankInField,tankStores,tankP,secP,condP,condVacuum,' +
  'tankCapAt,condStoreC,condStoreW,condSatP,partWrecked,edgeCval,edgeG,edgeH,scratch,' +
  'netReadP,netReadEdges,flowMapsOf,loopOfKey,turbWorkFrac,coreState,' +
  'tankLive,portLive,reliefLive,sgtrLive,sgOpen,cellBroken,portWrecked,' +
  'condVentBore,condDumpOpen,condDumpKgs,TANK_RHO:()=>TANK_RHO,' +
  'turbCOf,sgtrC,sgWastOf,feedTrainC,pumpDrive,cavOf,pumpRhoK,pumpHead,poolH,tankKg,' +
  'netMarching,CHOKE:()=>FLOWG_CHOKE,HEADK:()=>HEAD_K,CASINGF:()=>CASING_F,PUMPH0:()=>PUMP_H0,' +
  'STOREHELD:()=>netStoreHeld,RO:()=>netReadOnly,D:()=>D,' +
  'tankIds,loopOfKey}');
const KEYS = ['A', 'B', 'C', 'tc', 'rhoc', 'p0', 'T0', 'n', 'pFloor', 'TFloor',
  'hfg', 'rho', 'cp', 'mu', 'muV', 'solidK', 'Tref'];
const num = v => (v === undefined || v === null) ? NaN : v;
const opt3 = v => (v === undefined || v === null) ? -1 : v;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solvefull-gate-'));
const fIn = path.join(tmp, 'full.bin');
const parts = [];
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); };
const i32a = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeInt32LE(a[i], i * 4); parts.push(b); };
const u32a = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeUInt32LE(a[i], i * 4); parts.push(b); };
const f64a = a => { const b = Buffer.alloc(8 * a.length); for (let i = 0; i < a.length; i++) b.writeDoubleLE(a[i], i * 8); parts.push(b); };
const u8a = a => parts.push(Buffer.from(a));
const pins = a => { u32(a.length); for (const [i, p] of a) { u32(i); f64a([p]); } };
const sortedLeg = o => Object.keys(o).sort().map(k => [k, o[k]]);

// One faithful solve replication (same real calls, same order as netSolve),
// capturing every stage input plus reader outputs with tick containers.
function dumpSample(net, S, D) {
  const n = net.n, ne = net.edges.length, F = net.F;
  net.sigLock = S; net.sigLockV = null;
  try {
    // ---- field inputs (pre-update F seeded by the probe's carry) ----
    const samp = {};
    samp.Fpre = {};
    for (const f of ['p', 'rho', 'x', 'b', 'rhoD', 'rhoG', 'rhoL', 'mu', 'lp', 'lh', 'lm'])
      samp.Fpre[f] = Array.from(F[f]);
    samp.Fpre.wet = Array.from(F.wet); samp.Fpre.void = Array.from(F.void);
    samp.pbV = Array.from(S.pBy.v); samp.pbH = Array.from(S.pBy.has);
    samp.hbV = Array.from(S.hBy.v); samp.hbH = Array.from(S.hBy.has);
    samp.mbV = Array.from(S.mBy.v); samp.mbH = Array.from(S.mBy.has);
    samp.wArrPre = Array.from(net.wArr);
    samp.memoPre = [net.stKp, net.stKh, net.stKm, net.stP0, net.stC].map(a => Array.from(a));
    M.netFieldUpdate(net, S);
    samp.storeAny = net.store ? 1 : 0;
    samp.storeCap = net.store ? Array.from(net.store.cap) : new Array(n).fill(0);
    samp.storeSrc = net.store ? Array.from(net.store.src) : new Array(n).fill(0);
    samp.storePin = net.store ? Array.from(net.store.pin) : new Array(n).fill(0);
    samp.fbP = new Array(n); samp.fbH = new Array(n);
    for (let i = 0; i < n; i++) { samp.fbP[i] = M.netPAt(S, net.name[i]); samp.fbH[i] = M.netHAt(S, net.name[i]); }
    samp.pool = (net.condV || []).map(i => { const l = M.poolLvlOf(net, S, i); return l === undefined ? NaN : l; });
    samp.Fpost = {};
    for (const f of ['p', 'rho', 'x', 'b', 'rhoD', 'rhoG', 'rhoL', 'mu', 'lp', 'lh', 'lm'])
      samp.Fpost[f] = Array.from(F[f]);
    samp.Fpost.wet = Array.from(F.wet); samp.Fpost.void = Array.from(F.void);
    // ---- store memo pre ----
    samp.memoPre = [net.stKp, net.stKh, net.stKm, net.stP0, net.stC].map(a => Array.from(a));
    // ---- fixed ----
    const ref = M.netRef(net, S);
    samp.refAnchor = Array.from(ref.anchor); samp.refP0 = Array.from(ref.p0);
    samp.sP = S.P === undefined ? NaN : S.P; samp.p0p = M.P().P0;
    samp.preV = net.fixV ? Array.from(net.fixV) : new Array(n).fill(0);
    const fixed = M.netFixed(net, S);
    samp.fxV = Array.from(fixed.v); samp.fxH = Array.from(fixed.has);
    if (process.env.GATE_DEBUG) {
      let fx0 = 0;
      for (let i = 0; i < n; i++) if (!fixed.has[i]) fx0++;
      console.log('fixed-at-capture free=' + fx0);
    }
    samp.cont = net.cont.map(i => [i, M.netPcont(net, S, i)]);
    samp.contP = net.name.map((nm, i) => M.netPcont(net, S, i));
    samp.held = M.STOREHELD() ? 1 : 0;
    samp.holdPins = M.holdTankIds().map(id => [net.tankNode[id], M.holdPOf(S, id)]).filter(([i]) => i !== undefined);
    samp.drumPins = M.drumIds().map(id => [net.tankNode[id], M.holdSetP(M.tankCircuit(id))]).filter(([i]) => i !== undefined);
    samp.tankPins = [];
    for (const id in net.tankNode) {
      const i = net.tankNode[id];
      if (D.tanks[id] && D.tanks[id].hold) continue;
      if (M.tankInField(id)) continue;
      if (M.tankStores(id)) continue;
      samp.tankPins.push([i, M.tankP(S, id)]);
    }
    samp.secPins = (net.secT || []).map((i, sk) => [i, M.secP(S, net.secTParts[sk])]);
    samp.condPins = (net.condParts || []).map((id, ck) => [net.condV[ck], M.condP(S)])
      .filter((x, ck) => M.condVacuum(net.condParts[ck]));
    const bnd = M.netBounds(net, S);
    samp.bndV = Array.from(bnd.v); samp.bndH = Array.from(bnd.has);
    samp.storing = [];
    for (const id in net.tankNode) if (M.tankStores(id) && !M.tankInField(id)) samp.storing.push(net.tankNode[id]);
    // ---- store rows ----
    samp.tanks = [];
    for (const id in net.tankNode) samp.tanks.push([M.tankCapAt(S, id), M.tankP(S, id)]);
    samp.conds = (net.condV || []).map((i, k) => {
      const id = net.condParts[k];
      return [M.condStoreC(S, id), M.condStoreW(S, id), M.condSatP(S, id),
        M.partWrecked(S, id) ? 1 : 0, M.condVacuum(id) ? 1 : 0];
    });
    // ---- edge kits (march context, single pass) ----
    samp.kits = []; samp.gates = []; samp.edgeExp = [];
    samp.initChoke = M.CHOKE() ? 1 : 0;
    M.netMarching(true);
    try {
      for (let e = 0; e < ne; e++) {
        const ed = net.edges[e];
        const hasW = net.wHas[ed.wi] ? 1 : 0;
        const q = new Array(NF).fill(NaN);
        const Ck = ed.Ck === undefined ? -1 : ed.Ck;
        if (Ck < 0) q[0] = num(typeof ed.C === 'function' ? ed.C(S) : ed.C);
        if (Ck >= 0 && ed.Cdead) q[1] = M.partWrecked(S, ed.Cdead) ? 1 : 0;
        q[2] = hasW ? net.wArr[ed.wi] : NaN; q[3] = hasW;
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
          q[33] = M.pumpHead(ed.pump); q[34] = M.pumpDrive(S, ed.pump);
          q[35] = M.cavOf(S, ed.pump); q[36] = M.pumpRhoK(S, ed.pump);
        } else q[32] = 0;
        q[37] = ed.poolAt !== undefined ? M.poolH(net, S, ed.poolAt) : 0;
        q[38] = M.HEADK();
        q[39] = typeof ed.h0 === 'function' ? ed.h0(S) : num(ed.h0);
        q[40] = ed.hSrc ? ed.hSrc(S) : 0;
        q[41] = num(ed.I);
        if (Ck === 3) { q[43] = ed.gateMode === 'throttle' ? 1 : 0; q[44] = M.reliefLive(S, ed.pid) ? 1 : 0; }
        const gateVals = [];
        if (ed.gateMode === 'throttle') for (const fid of (ed.gateIds || [])) gateVals.push(num(S.valve && S.valve[fid]));
        const cc = M.edgeCval(net, ed, S);
        const gv = typeof ed.g === 'function' ? M.edgeG(net, ed, S) : ed.g;
        const g = gv || 0;
        const ch = M.CHOKE() ? 1 : 0;
        const h = typeof ed.h === 'function' ? M.edgeH(net, ed, S) : (ed.h || 0);
        samp.kits.push(q); samp.gates.push(gateVals); samp.edgeExp.push([cc, g, h, ch]);
      }
    } finally { M.netMarching(false); }
    // ---- pieces/live come from the replayed gh; dump expected ----
    const pc = M.netPieces(net, S);
    samp.pcOf = Array.from(pc.of); samp.pcN = pc.n; samp.pcLive = Array.from(pc.live);
    samp.pcHit = (net.pc && net.pcSig === M.netLiveSig(net, S)) ? 1 : 0;
    samp.pcSig = String(net.pcSig);
    samp.cset = [...M.corePieces(net, S)].sort((a, b) => a - b);
    // ---- linear: replicate tail of netSolve with the captured gh ----
    // Reset the shared holder first: pin evaluation above calls tankP, whose
    // holdLive->netBounds path mutates net.fixF in place (bounds markers).
    // The real solve factors pure netFixed output.
    M.netFixed(net, S);
    const b = M.scratch(net, 'b', n, Float64Array, 0);
    const touch = M.scratch(net, 'touch', n, Uint8Array, 0);
    const ghG = M.scratch(net, 'ghG', ne, Float64Array, 0);
    const ghH = M.scratch(net, 'ghH', ne, Float64Array, 0);
    // The edge loop's own answers, re-stamped (same numbers, same order).
    for (let e = 0; e < ne; e++) { ghG[e] = samp.edgeExp[e][1]; ghH[e] = samp.edgeExp[e][2]; }
    M.netFactored(net, S, fixed, b, touch, ghG, ghH);
    if (process.env.GATE_DEBUG) {
      let fx = 0;
      for (let i = 0; i < n; i++) if (fixed.has[i]) fx++;
      console.log('factored free=' + (n - fx) + ' orderFree=' + (net.orderFree || []).length +
        ' AfB=' + net.AfB + ' fixGenMatch=' + (net.fixMask ? 'y' : 'n'));
      const cap = samp.fxH;
      for (let i = 0; i < n; i++) if (!!cap[i] !== !!fixed.has[i])
        console.log('  maskflip i=' + i + ' ' + net.name[i] + ' ' + cap[i] + '->' + fixed.has[i] +
          ' v=' + fixed.v[i].toPrecision(6));
    }
    let withCap;
    if (net.AfB) { withCap = 1; samp.bAsm = Array.from(b); }
    else {
      withCap = 0;
      const b2 = new Float64Array(n);
      M.netAssemble(net.edges, n, fixed, S, false, b2, net.store && net.store.src,
        null, null, null, undefined, ghG, ghH);
      samp.bAsm = Array.from(b2);
    }
    samp.withCap = withCap;
    if (!net.AfB)
      M.netAssemble(net.edges, n, fixed, S, false, b, net.store && net.store.src,
        null, null, touch, undefined, ghG, ghH);
    M.netSubstFree(net, b);
    M.netUnfix(b, fixed, n);
    const q = new Float64Array(ne);
    M.netFlows(net.edges, b, fixed, q, S, ghG, ghH);
    if (!M.RO()) { const wA = net.wArr, wH = net.wHas;
      for (let e = 0; e < ne; e++) { wA[e] = q[e]; wH[e] = 1; } }
    samp.wArrPost = Array.from(net.wArr);
    const warns = [];
    const realWarn = console.warn;
    console.warn = m => { if (String(m).startsWith('[divergence]')) warns.push(String(m)); };
    try { M.netDiverge(net, q, fixed, net.store, b); } finally { console.warn = realWarn; }
    samp.b = Array.from(b); samp.q = Array.from(q);
    samp.AfTopo = String(net.AfTopo);
    samp.warned = warns.length > 0 ? 1 : 0;
    samp.order = net.orderFree ? Array.from(net.orderFree) : [];
    samp.deg = net.Afdeg ? Array.from(net.Afdeg) : new Array(n).fill(0);
    samp.touch = Array.from(touch);
    const idx = {};
    for (let i = 0; i < n; i++) idx[net.nodes[i]] = i;
    samp.widx = [];
    for (const w of warns) {
      const nm = w.slice('[divergence] '.length).split(' ')[0];
      if (idx[nm] !== undefined) samp.widx.push(idx[nm]);
    }
    samp.memoPost = [net.stKp, net.stKh, net.stKm, net.stP0, net.stC].map(a => Array.from(a));
    // ---- readers with tick containers ----
    const FM = M.flowMapsOf(net);
    const byP = { v: new Float64Array(n), has: new Uint8Array(n) };
    M.netReadP({ net, s: S, b, fixed, touch, ref: net.refNow, store: net.store }, byP);
    samp.byPV = Array.from(byP.v); samp.byPH = Array.from(byP.has);
    const byRun = { v: new Float64Array(FM.runKeys.length), pos: FM.runPos };
    const byLoop = {}, byDrop = {}, outs = {};
    const core = M.netReadEdges({ net, s: S, b, q, fixed, ref: net.refNow }, byLoop, byRun, byDrop, outs);
    samp.byRunV = Array.from(byRun.v);
    samp.byLoop = sortedLeg(byLoop); samp.byDrop = sortedLeg(byDrop);
    samp.core = core;
    samp.outs = {};
    for (const k of ['coreKgV', 'qTankV', 'sgSteamV', 'byV', 'sgFeedV', 'sgtrV', 'reliefV', 'scV'])
      samp.outs[k] = outs[k] ? Array.from(outs[k]) : null;
    for (const k of ['coreKgBy', 'qTankBy', 'sgSteamOutBy', 'by', 'sgFeedBy', 'sgtrBy', 'reliefBy'])
      samp.outs[k] = outs[k] ? sortedLeg(outs[k]) : null;
    for (const k of ['turbWk', 'turbWkP', 'turbWkA', 'qSgtr', 'spill', 'spillSec'])
      samp.outs[k] = outs[k] || 0;
    samp.tankMask = Array.from(net.tankNodeMask || []);
    // work fractions per work edge (turbWorkFrac readings inside the reader)
    samp.workFr = net.edges.map(ed => ed.work ? M.turbWorkFrac(S, ed.machine) : NaN);
    return samp;
  } finally { net.sigLock = null; net.sigLockV = null; }
}

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
    P.samples.push(dumpSample(M.P().net, S, D));
    nSamples++;
  }
  const net = M.P().net, n = net.n;
  // ---- curves interned (field/store inputs) ----
  const cmap = new Map(), curves = [];
  const curveOf = net.satBy.map(c => {
    const key = KEYS.map(k => String(num(c[k]))).join(',');
    if (!cmap.has(key)) { cmap.set(key, curves.length); curves.push(KEYS.map(k => num(c[k]))); }
    return cmap.get(key);
  });
  // ---- string interning (ids only; numbers stay numeric) ----
  const stable = [];
  const stab = s => {
    if (s === undefined || s === null) return -1;
    let i = stable.indexOf(s);
    if (i < 0) { i = stable.length; stable.push(s); }
    return i;
  };
  const runKeys = [];
  for (const ed of net.edges) if (ed.key && ed.meter !== false && !runKeys.includes(ed.key)) runKeys.push(ed.key);
  const coreKeys = Object.keys(net.coreNodes || {});
  // flowMapsOf rule: for-in tankNode order, hold tanks excluded.
  const tankKeys = [];
  for (const id in net.tankNode) if (!(D.tanks[id] && D.tanks[id].hold)) tankKeys.push(id);
  const shellKeys = [];
  for (const ed of net.edges) if (ed.shellOf !== undefined && !shellKeys.includes(ed.shellOf)) shellKeys.push(ed.shellOf);
  const sgtrKeys = [];
  for (const ed of net.edges) if (ed.kind === 'sgtr' && ed.key !== undefined && !sgtrKeys.includes(ed.key)) sgtrKeys.push(ed.key);
  const reliefKeys = (net.fitIds || []).filter(fid => net.fitMode[fid] === 'relief');
  const byKeys = [];
  for (const ed of net.edges) if (ed.kind === 'break' && ed.key !== undefined && !byKeys.includes(ed.key)) byKeys.push(ed.key);
  const FM = M.flowMapsOf(net);
  P.meta = {
    n, ne: net.edges.length,
    curves, curveOf,
    eu: net.edges.map(e => e.u), ev: net.edges.map(e => e.v),
    wi: net.edges.map(e => e.wi === undefined ? -1 : e.wi),
    hasI: net.edges.map(e => e.i === undefined ? 0 : 1),
    ii: net.edges.map(e => e.i === undefined ? 0 : e.i),
    dz: net.edges.map(e => net.z[e.u] - net.z[e.v]),
    poolAt: net.edges.map(e => e.poolAt === undefined ? -1 : e.poolAt),
    chokeAt: net.edges.map(e => opt3(e.chokeAt)), gasAt: net.edges.map(e => opt3(e.gasAt)),
    liqAt: net.edges.map(e => opt3(e.liqAt)), ck: net.edges.map(e => e.Ck === undefined ? -1 : e.Ck),
    diode: net.edges.map(e => num(e.diode)),
    bore: net.edges.map(e => num(e.bore)), llen: net.edges.map(e => num(e.llen)),
    k0: net.edges.map(e => num(e.k0)), hc: net.edges.map(e => num(e.hC)),
    cavN: net.edges.map(e => num(e.cavN)), cavOne: net.edges.map(e => num(e.cavOne)),
    cavRelief: net.edges.map(e => num(e.cavRelief)), cc0: net.edges.map(e => num(e.Cc)),
    gateN: net.edges.map(e => e.gateMode === 'throttle' ? (e.gateIds || []).length : 0),
    gIsFn: net.edges.map(e => typeof e.g === 'function' ? 1 : 0),
    hIsFn: net.edges.map(e => typeof e.h === 'function' ? 1 : 0),
    gScalar: net.edges.map(e => (typeof e.g === 'function' ? NaN : num(e.g))),
    hScalar: net.edges.map(e => (typeof e.h === 'function' ? NaN : num(e.h))),
    ekey: net.edges.map(e => stab(e.key)), meter: net.edges.map(e => e.meter === false ? 0 : 1),
    pair: net.edges.map(e => (e.pair && e.pair.i !== undefined) ? e.pair.i : -1),
    isBreak: net.edges.map(e => e.kind === 'break' ? 1 : 0),
    breakSteam: net.edges.map(e => (e.kind === 'break' && e.steam) ? 1 : 0),
    breakSec: net.edges.map(e => (e.kind === 'break' && e.sec) ? 1 : 0),
    isSgtr: net.edges.map(e => e.kind === 'sgtr' ? 1 : 0),
    shellOf: net.edges.map(e => e.shellOf === undefined ? -1 : stab(e.shellOf)),
    shellSign: net.edges.map(e => e.shellSign === -1 ? 1 : 0),
    work: net.edges.map(e => e.work ? 1 : 0),
    fit: net.edges.map(e => e.fit === undefined ? -1 : stab(e.fit)),
    vol: Array.from(net.vol),
    runMask: net.name.map(nm => M.runKeyOfNode(nm) !== null ? 1 : 0),
    gas: net.gasNodes || [], liq: net.liqNodes || [], condV: net.condV || [],
    cont: net.name.map((nm, i) => (net.cont || []).includes(i) ? 1 : 0),
    contList: net.cont.map(i => i),
    tankOrder: Object.keys(net.tankNode).map(id => net.tankNode[id]),
    tankHold: Object.keys(net.tankNode).map(id => (D.tanks[id] && D.tanks[id].hold) ? 1 : 0),
    holdNodes: M.holdTankIds().map(id => net.tankNode[id]).filter(i => i !== undefined),
    drumNodes: M.drumIds().map(id => net.tankNode[id]).filter(i => i !== undefined),
    secT: (net.secT || []).slice(),
    coreNodes: Object.values(net.coreNodes || {}), coreNode: net.coreNode,
    runKeys: runKeys.map(stab), coreKeys: coreKeys.map(stab), tankKeys: tankKeys.map(stab),
    shellKeys: shellKeys.map(stab), sgtrKeys: sgtrKeys.map(stab),
    reliefKeys: reliefKeys.map(stab), byKeys: byKeys.map(stab),
    loopOfRun: runKeys.map(k => { const v = M.loopOfKey(k); return v === undefined || v === null ? -1 : v; }),
    coreOfNode: net.name.map((nm, i) => (net.coreOfNode && net.coreOfNode[i] !== undefined)
      ? coreKeys.indexOf(net.coreOfNode[i]) : -1),
    tankIdOfNode: net.name.map((nm, i) => (net.tankIdByNode && net.tankIdByNode[i] !== undefined)
      ? tankKeys.indexOf(net.tankIdByNode[i]) : -1),
    secShellOfNode: net.name.map((nm, i) => (net.secTById && net.secTById[i] !== undefined)
      ? shellKeys.indexOf(net.secTById[i]) : -1),
    coreSet: net.name.map((nm, i) => net.coreSet.has(i) ? 1 : 0),
    strings: stable.slice(),
    fmRunN: FM.runKeys.length, fmCoreN: FM.coreKeys.length, fmTankN: FM.tankKeys.length,
    fmShellN: FM.shellKeys.length, fmSgtrN: FM.sgtrKeys.length,
    fmReliefN: FM.reliefKeys.length, fmByN: FM.byKeys.length,
  };
  P.meta.runKeyStrs = runKeys.slice();
  presets.push(P);
}
u32(presets.length);
const marks = {};
const mark = k => {
  if (process.env.GATE_DEBUG && !marks[k]) marks[k] = parts.reduce((a, b) => a + b.length, 0);
};
for (const P of presets) {
  const m = P.meta;
  u32(m.n); u32(m.ne); u32(1);
  u32(m.curves.length);
  for (const c of m.curves) f64a(c);
  u32a(m.curveOf);
  u32a(m.eu); u32a(m.ev); i32a(m.wi); u8a(m.hasI); i32a(m.ii); f64a(m.dz); i32a(m.poolAt);
  i32a(m.chokeAt); i32a(m.gasAt); i32a(m.liqAt); i32a(m.ck); f64a(m.diode);
  f64a(m.bore); f64a(m.llen); f64a(m.k0); f64a(m.hc);
  f64a(m.cavN); f64a(m.cavOne); f64a(m.cavRelief); f64a(m.cc0);
  u32a(m.gateN);
  u8a(m.gIsFn); u8a(m.hIsFn); f64a(m.gScalar); f64a(m.hScalar);
  i32a(m.ekey); u8a(m.meter); i32a(m.pair);
  u8a(m.isBreak); u8a(m.breakSteam); u8a(m.breakSec); u8a(m.isSgtr);
  i32a(m.shellOf); u8a(m.shellSign); u8a(m.work); i32a(m.fit);
  f64a(m.vol); u8a(m.runMask);
  u32(m.gas.length); u32a(m.gas); u32(m.liq.length); u32a(m.liq);
  u32(m.condV.length); u32a(m.condV);
  u8a(m.cont); u32(m.contList.length); u32a(m.contList);
  u32(m.tankOrder.length); u32a(m.tankOrder); u8a(m.tankHold);
  u32(m.holdNodes.length); u32a(m.holdNodes);
  u32(m.drumNodes.length); u32a(m.drumNodes);
  u32(m.secT.length); u32a(m.secT);
  u32(m.coreNodes.length); u32a(m.coreNodes);
  u32(m.coreNode === undefined ? 4294967295 : m.coreNode);
  for (const k of ['runKeys', 'coreKeys', 'tankKeys', 'shellKeys', 'sgtrKeys', 'reliefKeys', 'byKeys']) {
    u32(m[k].length); i32a(m[k]);
  }
  i32a(m.loopOfRun); i32a(m.coreOfNode); i32a(m.tankIdOfNode); i32a(m.secShellOfNode); u8a(m.coreSet);
  u32(m.strings.length);
  for (const s of m.strings) {
    const b = Buffer.from(s, 'utf8');
    u32(b.length); parts.push(b);
  }
  u32(m.fmRunN); u32(m.fmCoreN); u32(m.fmTankN); u32(m.fmShellN);
  u32(m.fmSgtrN); u32(m.fmReliefN); u32(m.fmByN);
  mark('meta');
  u32(P.samples.length);
  for (const s of P.samples) {
    // field inputs
    f64a(s.pbV); u8a(s.pbH); f64a(s.hbV); u8a(s.hbH); f64a(s.mbV); u8a(s.mbH);
    f64a(s.wArrPre); f64a(s.fbP); f64a(s.fbH); f64a(s.pool);
    // F pre-seed (first sample carries full F; later samples carry on)
    if (s === P.samples[0]) {
      for (const f of ['p', 'rho', 'x', 'b', 'rhoD', 'rhoG', 'rhoL', 'mu', 'lp', 'lh', 'lm']) f64a(s.Fpre[f]);
      u8a(s.Fpre.wet); u8a(s.Fpre.void);
    }
    // fixed/store inputs (ref frame dumped after the edge section: the
    // probe replays it from replayed pieces and compares there)
    f64a([s.sP]); f64a([s.p0p]);
    f64a(s.preV);
    pins(s.cont); u32(s.held);
    f64a(s.contP);
    pins(s.holdPins); pins(s.drumPins); pins(s.tankPins); pins(s.secPins); pins(s.condPins);
    for (const [c, p] of s.tanks) { f64a([c]); f64a([p]); }
    for (const [c, w, p, wr, va] of s.conds) { f64a([c]); f64a([w]); f64a([p]); u32(wr); u32(va); }
    for (const a of s.memoPre) f64a(a);
    mark('field');
    u32(s.storeAny); f64a(s.storeCap); f64a(s.storeSrc); u8a(s.storePin);
    mark('storeExp');
    // edge kits (initChoke first: the probe threads it through the loop)
    u32(s.initChoke);
    mark('initchoke');
    for (let e = 0; e < m.ne; e++) {
      f64a(s.kits[e]); f64a(s.gates[e]);
      f64a(s.edgeExp[e].slice(0, 3)); u32(s.edgeExp[e][3]);
    }
    mark('kits');
    // linear + readers expected
    u32(s.withCap); f64a(s.bAsm);
    f64a(s.b); f64a(s.q);
    u32(s.warned);
    { const t = Buffer.from(s.AfTopo, 'utf8'); u32(t.length); parts.push(t); }
    u32(s.order.length); u32a(s.order);
    u8a(s.deg);
    f64a(s.byPV); u8a(s.byPH);
    f64a(s.byRunV);
    mark('byrun');
    u32(s.byLoop.length);
    for (const [k, v] of s.byLoop) { u32(+k); f64a([v]); }
    u32(s.byDrop.length);
    for (const [k, v] of s.byDrop) { u32(P.meta.runKeyStrs.indexOf(k)); f64a([v]); }
    f64a([s.core]);
    for (const k of ['coreKgV', 'qTankV', 'sgSteamV', 'byV', 'sgFeedV', 'sgtrV', 'reliefV', 'scV'])
      f64a(s.outs[k] || []);
    for (const k of ['turbWk', 'turbWkP', 'turbWkA', 'qSgtr', 'spill', 'spillSec']) f64a([s.outs[k]]);
    f64a(s.workFr);
    f64a(s.wArrPost);
    for (const a of s.memoPost) f64a(a);
    // F post + pieces/fixed/store expected
    const p = s.Fpost;
    f64a(p.p); f64a(p.rho); f64a(p.x); f64a(p.b); f64a(p.rhoD);
    f64a(p.rhoG); f64a(p.rhoL); u8a(p.wet); u8a(p.void); f64a(p.mu);
    f64a(p.lp); f64a(p.lh); f64a(p.lm);
    i32a(s.pcOf); u32(s.pcN); u8a(s.pcLive);
    u32(s.pcHit);
    { const b = Buffer.from(s.pcSig, 'utf8'); u32(b.length); parts.push(b); }
    i32a(s.refAnchor); f64a(s.refP0);
    f64a(s.fxV); u8a(s.fxH);
    u32(s.touch.length); u8a(s.touch);
    u32(s.widx.length); u32a(s.widx);
  }
}
fs.writeFileSync(fIn, Buffer.concat(parts));
if (process.env.GATE_DEBUG) console.log('marks ' + JSON.stringify(marks));

const out = execFileSync('cargo', ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'solvefull-probe', '--', fIn],
  { cwd: ROOT, encoding: 'utf8' });
console.log(out.trim());
const pass = /FAILURES=0/.test(out);
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'solvefull-baseline.json'), JSON.stringify({
    presets: presetNames, ticks: TICKS, samples: nSamples,
  }, null, 1) + '\n');
}
if (process.env.KEEP_TMP) console.log('kept ' + tmp);
else fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);

