#!/usr/bin/env node
// node tools/ctl-gate.js [--ticks N] — §6.5 gate: ctlPass + sinks. The probe
// replica drives the REAL blkEval in the REAL ctlOrder (dumper replicates,
// never reimplements); every tick sample is cross-checked against the REAL
// ctlPass on restored pre-state before dumping. Dump-kit inputs: source
// values at evaluation point (intra-tick sink feedback included), sink dead
// bits, scram blame strings, actuator pre-state. No transcendentals flow
// through control, so the bar is BIT-EXACT (like pieces). Writes
// tools/ctl-baseline.json on pass.
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
const DT = 0.02;

const M = headless('{PRE:()=>PLANTPRE,plantPreset,buildLayout,commission,P:()=>P,S:()=>S,step,D:()=>D,' +
  'ctlPass:(s,dt)=>ctlPass(s,dt),ctlOrder:(s)=>ctlOrder(s),' +
  'blkEval:(s,b,I,dt,ix)=>blkEval(s,b,I,dt,ix),' +
  'blkOutOf:(s,id)=>blkOutOf(s,id),blkDead:(s,b)=>blkDead(s,b),' +
  'blkBlame:(s,id)=>blkBlame(s,id),sinkDriver:(s,k,a)=>sinkDriver(s,k,a),' +
  'ctlLive:(s)=>ctlLive(s),' +
  'getIdx:()=>CTL_IDX,setIdx:(v)=>{CTL_IDX=v;},getIdk:()=>CTL_IDK,setIdk:(v)=>{CTL_IDK=v;},' +
  'bumpSink:()=>{ctlSinkGen++;},' +
  'TavgOf:(s,ci)=>TavgOf(s,ci),tProg:(s,K,cs)=>tProg(s,K,cs),rodRate:(K)=>rodRate(K),' +
  'rodsOf:(id)=>rodsOf(id),coreIds:()=>coreIds(),' +
  'setPartName:(id,n)=>setPartName(id,n)}');

const KNOB_KEYS = ['v', 'k', 'kp', 'ti', 'td', 'db', 'n', 'lo', 'hi', 'rate', 'tau', 'on', 'off'];
const MODE_OF = { source: 0, const: 1, math: 2, pid: 3, integ: 4, limit: 5, lag: 6, compare: 7, latch: 8, sel: 9, sink: 10 };
const MATH_OF = { add: 0, sub: 1, mul: 2, div: 3, min: 4, max: 5 };
const SEL_OF = { max: 0, min: 1, median: 2 };
const CMP_OF = { above: 0, below: 1 };
const SINK_OF = { rodStep: 0, freg: 1, relief: 2, flowDem: 3, loadDem: 4, boronDem: 5, valveDem: 6, tankOpen: 7, scram: 8, nearTrip: 9, runback: 10 };

const num = v => (v === undefined || v === null) ? NaN : v;
const isNullKnob = v => (v === undefined || v === null);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-gate-'));
const fIn = path.join(tmp, 'ctl.bin');
const parts = [];
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); parts.push(b); };
const i32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); };
const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v); parts.push(b); };
const f64 = v => { const b = Buffer.alloc(8); b.writeDoubleLE(v); parts.push(b); };
const f64a = a => { for (const v of a) f64(v); };
const u8 = v => parts.push(Buffer.from([v ? 1 : 0]));
const u8a = a => parts.push(Buffer.from(Array.from(a).map(v => v ? 1 : 0)));
const raw8a = a => parts.push(Buffer.from(Array.from(a).map(v => v & 0xFF)));
const str = s => { const b = Buffer.from(String(s === undefined || s === null ? '' : s), 'utf8'); u32(b.length); parts.push(b); };

// ---- actuator snapshot (hand clone: NaN/undefined-preserving, no JSON) ----
function snapAct(s) {
  const P = M.P();
  const coreIds = M.coreIds().filter(id => s.coreBy && s.coreBy[id]);
  const cores = coreIds.map(id => {
    const cs = s.coreBy[id], K = P.cores[id];
    return {
      id, NB: K.NB, rodDem: cs.rodDem, rodZDem: Array.from(cs.rodZDem),
      rodBand: !!cs.rodBand, split: !!cs.split, reGang: !!cs.reGang,
      bankAuto: Array.from(cs.bankAuto), rodJam: !!cs.rodJam,
      scrammed: !!cs.scrammed, rpsHot: num(cs.rpsHot), rpsNear: !!cs.rpsNear,
      trip: cs.trip === undefined || cs.trip === null ? '' : String(cs.trip),
      rated: num(K.rated), rodRate: num(M.rodRate(K)),
      pinHot: Math.abs(M.TavgOf(s, K.circ) - M.tProg(s, K, cs)) > 0.5,
      dmgRod: (s.dmgParts || []).includes(M.rodsOf(id)),
    };
  });
  const keys = o => Object.keys(o || {});
  const fmap = o => { const k = keys(o); return { k, v: k.map(x => num(o[x])), ex: k.map(x => o[x] === undefined ? 0 : 1) }; };
  return {
    arLo: num(s.arLo), arHi: num(s.arHi),
    loadMax: num(P.loadMax), rpsLag: num(P.rpsLag), pRated: num(P.rated),
    load: num(s.load), loadDem: num(s.loadDem), boronDem: num(s.boronDem), rbHot: !!s.rbHot,
    freg: fmap(s.fregDemBy), flow: fmap(s.flowDemBy), valve: fmap(s.valveDem),
    tank: (() => { const k = keys(s.tankOpen); return { k, v: k.map(x => s.tankOpen[x] ? 1 : 0), ex: k.map(x => s.tankOpen[x] === undefined ? 0 : 1) }; })(),
    relief: (() => {
      const k = keys(s.reliefOpen);
      return {
        k,
        cell: k.map(fid => ({
          ex: s.reliefOpen[fid] === undefined ? 0 : 1,
          open: !!s.reliefOpen[fid], auto: !!s.reliefAuto[fid],
          stuck: !!s.reliefStuck[fid], arm: !!s.reliefArm[fid],
          spring: !!((P.fittings && P.fittings[fid] && P.fittings[fid].spring)),
        })),
      };
    })(),
    cores,
  };
}
function restoreAct(s, a) {
  s.arLo = a.arLo; s.arHi = a.arHi;
  s.load = a.load; s.loadDem = a.loadDem; s.boronDem = a.boronDem; s.rbHot = a.rbHot;
  const rmap = (o, m) => { for (let i = 0; i < m.k.length; i++) o[m.k[i]] = m.v[i]; };
  rmap(s.fregDemBy, a.freg); rmap(s.flowDemBy, a.flow); rmap(s.valveDem, a.valve);
  for (let i = 0; i < a.tank.k.length; i++) s.tankOpen[a.tank.k[i]] = !!a.tank.v[i];
  for (let i = 0; i < a.relief.k.length; i++) {
    const fid = a.relief.k[i], cl = a.relief.cell[i];
    s.reliefOpen[fid] = !!cl.open; s.reliefAuto[fid] = !!cl.auto;
    s.reliefStuck[fid] = !!cl.stuck; s.reliefArm[fid] = !!cl.arm;
  }
  for (const c of a.cores) {
    const cs = s.coreBy[c.id];
    cs.rodDem = c.rodDem; cs.rodZDem.set(c.rodZDem);
    cs.rodBand = c.rodBand; cs.split = c.split; cs.reGang = c.reGang;
    for (let i = 0; i < c.bankAuto.length; i++) cs.bankAuto[i] = c.bankAuto[i];
    cs.rodJam = c.rodJam; cs.scrammed = c.scrammed; cs.rpsHot = c.rpsHot;
    cs.rpsNear = c.rpsNear; cs.trip = c.trip;
  }
}
function cloneBlocks(blkBy) {
  const o = {};
  for (const id in blkBy) {
    const b = blkBy[id];
    o[id] = { ...b, in: b.in.slice() };
  }
  return o;
}
const eqNum = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b;
function eqAct(a, b) {
  if (!eqNum(a.load, b.load) || !eqNum(a.loadDem, b.loadDem) || !eqNum(a.boronDem, b.boronDem) || a.rbHot !== b.rbHot) return 'globals';
  for (const k of ['freg', 'flow', 'valve']) {
    if (a[k].v.length !== b[k].v.length) return k + '.len';
    for (let i = 0; i < a[k].v.length; i++) if (!eqNum(a[k].v[i], b[k].v[i])) return k + '[' + i + ']';
  }
  for (let i = 0; i < a.tank.v.length; i++) if (a.tank.v[i] !== b.tank.v[i]) return 'tank[' + i + ']';
  for (let i = 0; i < a.relief.cell.length; i++) {
    const x = a.relief.cell[i], y = b.relief.cell[i];
    if (x.open !== y.open || x.auto !== y.auto || x.stuck !== y.stuck || x.arm !== y.arm) return 'relief[' + i + ']';
  }
  for (let i = 0; i < a.cores.length; i++) {
    const x = a.cores[i], y = b.cores[i];
    if (!eqNum(x.rodDem, y.rodDem) || !eqNum(x.rpsHot, y.rpsHot) ||
      x.rodBand !== y.rodBand || x.scrammed !== y.scrammed || x.rpsNear !== y.rpsNear ||
      x.rodJam !== y.rodJam || x.trip !== y.trip) return 'core[' + i + ']';
    for (let j = 0; j < x.rodZDem.length; j++) if (!eqNum(x.rodZDem[j], y.rodZDem[j])) return 'coreZ[' + i + ',' + j + ']';
  }
  return null;
}

// ---- the replica: real ctlOrder + real blkEval, preamble mirrored ----
function replica(s, dt, rec) {
  if (!M.ctlLive(s)) return false;
  const ids = Object.keys(s.blkBy);
  let idx = M.getIdx(), idk = M.getIdk();
  let same = idx && idk && idk.length === ids.length && s.blkOutV && s.blkOutV.length === ids.length && s.blkOutF && s.blkOutF.length === ids.length;
  if (same) for (let i = 0; i < ids.length; i++) if (idk[i] !== ids[i]) { same = false; break; }
  if (!same) {
    if (idx && idk && s.blkOutV && s.blkOutF) for (let i = 0; i < idk.length; i++) {
      const b0 = s.blkBy[idk[i]]; if (!b0) continue;
      const ix = idx[idk[i]]; b0.out = s.blkOutV[ix]; b0.f = s.blkOutF[ix];
    }
    idx = Object.fromEntries(ids.map((id, i) => [id, i])); idk = ids.slice();
    M.setIdx(idx); M.setIdk(idk);
    s.blkOutV = new Float64Array(ids.length); s.blkOutF = new Float64Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      const b0 = s.blkBy[ids[i]];
      s.blkOutV[i] = b0.out === undefined ? 0 : b0.out; s.blkOutF[i] = b0.f;
    }
  }
  const ord = M.ctlOrder(s);
  rec.order = ord.slice();
  const I = [];
  for (const id of ord) {
    const b = s.blkBy[id], ix = idx[id];
    if (!b.on) continue; // falsy, exactly like the tick: a 0/null threshold disables
    const n = b.in.length; I.length = n;
    for (let i = 0; i < n; i++) { const v = M.blkOutOf(s, b.in[i]); I[i] = v === undefined ? 0 : v; }
    const dead = (b.mode === 'sink') ? (M.blkDead(s, b) ? 1 : 0) : 0;
    const v = M.blkEval(s, b, I, dt, ix);
    if (b.mode === 'source') rec.src[id] = v;
    if (b.mode === 'sink') {
      rec.dead[id] = dead;
      if (b.sink === 'scram') { const drv = M.sinkDriver(s, 'scram', b.arg); rec.blame[id] = drv ? M.blkBlame(s, drv) : ''; }
    }
    s.blkOutV[ix] = isFinite(v) ? v : s.blkOutV[ix];
  }
  return true;
}

// ---- sample encoding (must match sim-rs/src/bin/ctl-probe.rs) ----
let nSamples = 0;
const tags = [0, 0, 0];
const cov = { scramFire: 0, tripPrefix: 0, reliefMove: 0, sinkDead: 0, darkTick: 0 };
function dumpSample(tag, dt, live, blkBy, ids, idxOf, pre, rec, actPre, post, actPost) {
  const n = ids.length;
  u32(tag); f64(dt); u8(live ? 1 : 0);
  u32(n);
  for (const id of ids) str(id);
  const modeOf = id => (MODE_OF[blkBy[id].mode] === undefined ? 255 : MODE_OF[blkBy[id].mode]);
  raw8a(ids.map(id => modeOf(id)));
  u8a(ids.map(id => blkBy[id].on ? 1 : 0));
  for (const id of ids) {
    const ins = blkBy[id].in;
    u32(ins.length);
    for (const src of ins) i32(src === null || src === undefined ? -1 : (idxOf.has(src) ? idxOf.get(src) : -1));
  }
  f64a(ids.map((id, i) => pre.out[i]));
  f64a(ids.map((id, i) => pre.f[i]));
  for (const id of ids) {
    const b = blkBy[id];
    let mask = 0;
    const vals = KNOB_KEYS.map((k, ki) => {
      const v = b[k];
      if (isNullKnob(v)) { mask |= (1 << ki); return NaN; }
      return v;
    });
    f64a(vals);
    u16(mask);
  }
  raw8a(ids.map(id => { const b = blkBy[id]; return b.mode === 'math' ? (MATH_OF[b.op] === undefined ? 255 : MATH_OF[b.op]) : 0; }));
  raw8a(ids.map(id => { const b = blkBy[id]; return b.mode === 'sel' ? (SEL_OF[b.op] === undefined ? 255 : SEL_OF[b.op]) : 0; }));
  raw8a(ids.map(id => { const b = blkBy[id]; return b.mode === 'compare' ? (CMP_OF[b.op] === undefined ? 255 : CMP_OF[b.op]) : 0; }));
  f64a(ids.map(id => (blkBy[id].mode === 'source' && rec.src) ? num(rec.src[id]) : NaN));
  raw8a(ids.map(id => { const b = blkBy[id]; return b.mode === 'sink' ? (SINK_OF[b.sink] === undefined ? 255 : SINK_OF[b.sink]) : 255; }));
  const argIdx = id => {
    const b = blkBy[id];
    if (b.mode !== 'sink') return -1;
    const pick = l => { const i = l.indexOf(b.arg); return i < 0 ? -1 : i; };
    switch (b.sink) {
      case 'rodStep': case 'scram': case 'nearTrip': return pick(actPre.cores.map(c => c.id));
      case 'freg': return pick(actPre.freg.k);
      case 'flowDem': return pick(actPre.flow.k);
      case 'valveDem': return pick(actPre.valve.k);
      case 'tankOpen': return pick(actPre.tank.k);
      case 'relief': return pick(actPre.relief.k);
      default: return -1;
    }
  };
  for (const id of ids) i32(argIdx(id));
  u8a(ids.map(id => (rec.dead && rec.dead[id]) ? 1 : 0));
  for (const id of ids) str((rec.blame && rec.blame[id]) || '');
  const ord = (rec.order || []).map(id => idxOf.get(id));
  u32(ord.length);
  for (const i of ord) u32(i);
  f64(actPre.arLo); f64(actPre.arHi); f64(actPre.loadMax); f64(actPre.rpsLag);
  f64(actPre.pRated); f64(actPre.load); f64(actPre.loadDem); f64(actPre.boronDem);
  u8(actPre.rbHot ? 1 : 0);
  const wmap = m => { u32(m.v.length); f64a(m.v); u8a(m.ex); };
  wmap(actPre.freg); wmap(actPre.flow); wmap(actPre.valve);
  u32(actPre.tank.v.length); u8a(actPre.tank.v); u8a(actPre.tank.ex);
  u32(actPre.relief.cell.length);
  for (const cl of actPre.relief.cell) u8a([cl.ex, cl.open, cl.auto, cl.stuck, cl.arm, cl.spring]);
  u32(actPre.cores.length);
  for (const c of actPre.cores) {
    str(c.id); u32(c.NB); f64(c.rodDem); f64a(c.rodZDem);
    u8a([c.rodBand, c.split, c.reGang, c.rodJam, c.scrammed, c.rpsNear]);
    u8a(c.bankAuto);
    f64(c.rpsHot); f64(c.rated); f64(c.rodRate);
    u8a([c.pinHot, c.dmgRod]);
    str(c.trip);
  }
  f64a(post.out);
  f64a(post.f);
  f64(actPost.load); f64(actPost.loadDem); f64(actPost.boronDem); u8(actPost.rbHot ? 1 : 0);
  f64a(actPost.freg.v); f64a(actPost.flow.v); f64a(actPost.valve.v);
  u8a(actPost.tank.v);
  for (const cl of actPost.relief.cell) u8a([cl.open, cl.auto, cl.stuck, cl.arm]);
  for (const c of actPost.cores) {
    f64(c.rodDem); f64a(c.rodZDem);
    u8a([c.rodBand, c.scrammed, c.rpsNear, c.rodJam]);
    f64(c.rpsHot); str(c.trip);
  }
  for (const c of actPost.cores) {
    if (c.scrammed && !(actPre.cores.find(x => x.id === c.id) || {}).scrammed) cov.scramFire++;
    if ((c.trip || '').startsWith('RPS TRIP /')) cov.tripPrefix++;
  }
  for (let i = 0; i < actPost.relief.cell.length; i++)
    if (actPost.relief.cell[i].open !== actPre.relief.cell[i].open) cov.reliefMove++;
  for (const id of ids) if (rec.dead && rec.dead[id]) cov.sinkDead++;
  if (!live) cov.darkTick++;
  nSamples++;
  tags[tag]++;
}
const emptyAct = () => ({
  arLo: 0, arHi: 0, loadMax: 0, rpsLag: 0, pRated: 0, load: 0, loadDem: 0, boronDem: 0, rbHot: false,
  freg: { k: [], v: [], ex: [] }, flow: { k: [], v: [], ex: [] }, valve: { k: [], v: [], ex: [] },
  tank: { k: [], v: [], ex: [] }, relief: { k: [], cell: [] }, cores: [],
});

const presetNames = [];
const skipped = { dark: 0, noLive: 0 };

// ---- per-preset traffic + tick samples ----
for (const k of Object.keys(M.PRE())) {
  M.plantPreset(+k); M.buildLayout(); M.commission();
  const S0 = M.S(); S0.diceOff = true;
  presetNames.push(M.PRE()[k][0]);
  const S = M.S();
  for (let t = 0; t < TICKS; t++) {
    if ((t > 4 && t % 40 === 0) || t === TICKS - 1) {
      // sample tick: pre, replica, then cross-check vs the REAL ctlPass on restored pre
      const ids = Object.keys(S.blkBy);
      const idxOf = new Map(ids.map((id, i) => [id, i]));
      const preAct = snapAct(S);
      const preBlk = cloneBlocks(S.blkBy);
      const seedOut = id => { const v = S.blkBy[id].out; return v === undefined ? 0 : v; };
      const seedF = id => S.blkBy[id].f;
      const preOut = S.blkOutV ? Array.from(S.blkOutV) : ids.map(seedOut);
      const preF = S.blkOutF ? Array.from(S.blkOutF) : ids.map(seedF);
      const preIdx = M.getIdx(), preIdk = M.getIdk() ? M.getIdk().slice() : null;
      const rec = { src: {}, dead: {}, blame: {}, order: [] };
      if (!replica(S, DT, rec)) { skipped.dark++; M.step(DT); continue; }
      const postOut = Array.from(S.blkOutV), postF = Array.from(S.blkOutF);
      const postAct = snapAct(S);
      // cross-check: restore pre, run the real ctlPass, compare bitwise
      S.blkBy = cloneBlocks(preBlk);
      S.blkOutV = new Float64Array(preOut); S.blkOutF = new Float64Array(preF);
      M.setIdx(preIdx); M.setIdk(preIdk);
      restoreAct(S, preAct);
      // coreSeen memoizes per (tick, sink-gen): the replica's views reflect
      // post-state, so bust the generation before the real re-run.
      M.bumpSink();
      M.ctlPass(S, DT);
      const chkOut = Array.from(S.blkOutV), chkF = Array.from(S.blkOutF);
      const chkAct = snapAct(S);
      let bad = '';
      for (let i = 0; i < postOut.length; i++)
        if (!eqNum(postOut[i], chkOut[i])) { bad = 'out[' + ids[i] + '] ' + postOut[i] + ' vs ' + chkOut[i]; break; }
      if (!bad) for (let i = 0; i < postF.length; i++)
        if (!eqNum(postF[i], chkF[i])) { bad = 'fv[' + ids[i] + ']'; break; }
      if (!bad) { const d = eqAct(postAct, chkAct); if (d) bad = 'act.' + d; }
      if (!bad && JSON.stringify(rec.order) !== JSON.stringify(M.ctlOrder(S))) bad = 'order';
      if (bad) { console.error('preset ' + k + ' tick ' + t + ': replica != ctlPass at ' + bad); process.exit(2); }
      dumpSample(0, DT, true, S.blkBy, ids, idxOf,
        { out: preOut, f: preF }, rec, preAct,
        { out: postOut, f: postF }, postAct);
      continue;
    }
    M.step(DT);
  }
  // dark-tick sample: blackout + backup lost => ctlLive false => no-op
  {
    const S2 = M.S();
    const wasLive = M.ctlLive(S2);
    const bo = S2.blackout, bl = S2.bkpLost;
    S2.blackout = true; S2.bkpLost = true;
    if (M.ctlLive(S2)) { console.error('preset ' + k + ' blackout did not darken ctl'); process.exit(2); }
    const ids = Object.keys(S2.blkBy);
    const idxOf = new Map(ids.map((id, i) => [id, i]));
    const preAct = snapAct(S2);
    const seedOut = id => { const v = S2.blkBy[id].out; return v === undefined ? 0 : v; };
    const preOut = S2.blkOutV ? Array.from(S2.blkOutV) : ids.map(seedOut);
    const preF = S2.blkOutF ? Array.from(S2.blkOutF) : ids.map(id => S2.blkBy[id].f);
    const rec = { src: {}, dead: {}, blame: {}, order: M.ctlOrder(S2) };
    if (replica(S2, DT, rec)) { console.error('preset ' + k + ' replica ran while dark'); process.exit(2); }
    const postOut = S2.blkOutV ? Array.from(S2.blkOutV) : [];
    const postF = S2.blkOutF ? Array.from(S2.blkOutF) : [];
    const postAct = snapAct(S2);
    let bad = '';
    for (let i = 0; i < preOut.length; i++) if (!eqNum(preOut[i], postOut[i])) bad = 'out[' + i + ']';
    for (let i = 0; i < preF.length; i++) if (!eqNum(preF[i], postF[i])) bad = 'fv[' + i + ']';
    if (eqAct(preAct, postAct)) bad = 'act.' + eqAct(preAct, postAct);
    if (bad) { console.error('preset ' + k + ' dark tick mutated ' + bad); process.exit(2); }
    S2.blackout = bo; S2.bkpLost = bl;
    if (wasLive) dumpSample(1, DT, false, S2.blkBy, ids, idxOf, { out: preOut, f: preF }, rec, preAct, { out: postOut, f: postF }, postAct);
    else skipped.noLive++;
  }
  // live-actuator sink exerciser: every sink kind against REAL keys, with
  // snap/restore per tick so traffic is unperturbed. Tick 2 flips the
  // drivers and wrecks the dead-test pump (dead-sink path).
  {
    const S2 = M.S(), P = M.P();
    const firstKey = o => Object.keys(o || {})[0];
    const coreId = M.coreIds().find(id => S2.coreBy && S2.coreBy[id]);
    const fregK = firstKey(S2.fregDemBy), flowK = firstKey(S2.flowDemBy),
      valveK = firstKey(S2.valveDem), tankK = firstKey(S2.tankOpen);
    const reliefKeys = Object.keys(S2.reliefOpen || {});
    const isSpring = fid => !!((P.fittings && P.fittings[fid] && P.fittings[fid].spring));
    const pore = reliefKeys.find(fid => !isSpring(fid));
    const springF = reliefKeys.find(isSpring);
    const specs = [];
    const CD = (id, v) => specs.push({ id, mode: 'const', knob: { v }, out: 0, f: NaN, in: [] });
    const SK = (id, sink, arg, drv) => specs.push({ id, mode: 'sink', knob: {}, out: 0, f: NaN, in: [drv], sink, arg });
    CD('dHi', 1); CD('dLo', 0); CD('dHalf', 0.7); CD('dNeg', -20); CD('dBig', 150); CD('dBor', 123);
    if (fregK) SK('sFreg', 'freg', fregK, 'dHalf');
    if (flowK) SK('sFlow', 'flowDem', flowK, 'dBig');
    if (valveK) SK('sValve', 'valveDem', valveK, 'dNeg');
    if (tankK) SK('sTank', 'tankOpen', tankK, 'dHi');
    SK('sLoad', 'loadDem', null, 'dBig');
    SK('sBor', 'boronDem', null, 'dBor');
    if (pore) SK('sRel', 'relief', pore, 'dHi');
    if (springF) SK('sRelSp', 'relief', springF, 'dHi');
    if (coreId) {
      SK('sRod', 'rodStep', coreId, 'dHalf');
      SK('sScram', 'scram', coreId, 'dHi');
      SK('sNear', 'nearTrip', coreId, 'dHi');
    }
    SK('sRun', 'runback', null, 'dHi');
    SK('sBogus', 'frobnicate', null, 'dHalf');
    if (flowK) SK('sDead', 'flowDem', flowK, 'dBig');
    if (specs.length > 7) {
      runGraph(specs, [DT, DT], {
        liveAct: true,
        wreck: [null, flowK || null],
        mut: (ti, by) => {
          if (ti === 1) {
            by.dHi.v = 0; by.dLo.v = 1; by.dHalf.v = 0.3;
            by.dNeg.v = 10; by.dBig.v = 50; by.dBor.v = -50;
          }
        },
      });
    }
    // named-blame trip: rpsHot pre-armed at the lag so the scram fires on
    // the tick, with the blame walk landing on the named mTrip block.
    if (coreId && isFinite(P.rpsLag)) {
      const cs = S2.coreBy[coreId];
      const truePre = snapAct(S2);
      // clear any trip the exerciser above already caused, arm the timer
      cs.scrammed = false; cs.trip = ''; cs.rpsHot = P.rpsLag;
      M.setPartName('mTrip', 'TRIPPER');
      runGraph([
        { id: 'hot', mode: 'const', knob: { v: 1 }, out: 0, f: NaN, in: [] },
        { id: 'mTrip', mode: 'math', knob: { k: 1 }, out: 1, f: NaN, in: ['hot', 'hot'], op: 'add' },
        { id: 'sScramC', mode: 'sink', knob: {}, out: 0, f: NaN, in: ['mTrip'], sink: 'scram', arg: coreId },
      ], [DT], { liveAct: true });
      if (M.D().name) delete M.D().name['mTrip'];
      restoreAct(S2, truePre);
    }
  }
}

// ---- synthetic graphs: modes/ops the stock automation may not wire ----
// Blocks: {id, mode, on, in:[ids], knob:{...}, op, out, f}.
// blkEval runs against swapped s.blkOutV/F so pid/filter/hold state is local;
// order comes from the REAL ctlOrder via a blkBy swap.
// Shared synthetic runner: spec blocks run against swapped-in live objects so
// blkEval reads b.in (compare wired check) and s.blkOutV/F (holds, pid)
// off them. opt.liveAct snapshots/restores real actuator state per tick,
// letting sink blocks drive REAL keys; opt.wreck[ti] is pushed to dmgParts
// for that tick (dead-sink path); opt.mut flips drivers between ticks.
function runGraph(blocks, dts, opt) {
  opt = opt || {};
  const S = M.S();
  const ids = blocks.map(b => b.id);
  const idxOf = new Map(ids.map((id, i) => [id, i]));
  const inIdx = blocks.map(b => b.in.map(s => (s === null || s === undefined) ? -1 : (idxOf.has(s) ? idxOf.get(s) : -1)));
  const keepBy = S.blkBy, keepV = S.blkOutV, keepF = S.blkOutF;
  // NOTE: block-enabled `on` and the compare threshold knob are ONE field
  // live (blkSeed quirk) — so for compare the knob wins, else the spec flag.
  // The knob loop below must not clobber it back.
  const synBy = Object.fromEntries(blocks.map(b => {
    const knob = b.knob || {};
    const on = b.mode === 'compare' && 'on' in knob ? knob.on
      : b.on !== undefined ? b.on : true;
    const o = { mode: b.mode, on, in: b.in.slice(), out: b.out, f: b.f, op: b.op };
    for (const k of KNOB_KEYS) if (k !== 'on') o[k] = knob[k];
    o.on = on;
    if (b.sink !== undefined) o.sink = b.sink;
    if (b.arg !== undefined) o.arg = b.arg;
    return [b.id, o];
  }));
  S.blkBy = synBy;
  const ordIds = M.ctlOrder(S);
  const ord = ordIds.map(id => idxOf.get(id));
  let OUT = blocks.map(b => b.out === undefined ? 0 : b.out);
  let FV = blocks.map(b => b.f === undefined ? NaN : b.f);
  dts.forEach((dt, ti) => {
    if (opt.mut) opt.mut(ti, synBy);
    if (opt.wreck && opt.wreck[ti]) S.dmgParts.push(opt.wreck[ti]);
    const preAct = opt.liveAct ? snapAct(S) : emptyAct();
    const preOut = OUT.slice(), preF = FV.slice();
    S.blkOutV = Float64Array.from(OUT); S.blkOutF = Float64Array.from(FV);
    const I = [];
    const rec = { src: {}, dead: {}, blame: {}, order: ordIds.slice() };
    for (const ix of ord) {
      const b = synBy[ids[ix]];
      if (!b.on) continue; // falsy, exactly like the tick
      const n = inIdx[ix].length; I.length = n;
      for (let i = 0; i < n; i++) I[i] = inIdx[ix][i] < 0 ? 0 : OUT[inIdx[ix][i]];
      if (b.mode === 'sink') rec.dead[ids[ix]] = M.blkDead(S, b) ? 1 : 0;
      const v = M.blkEval(S, b, I, dt, ix);
      if (b.mode === 'sink' && b.sink === 'scram') {
        const drv = M.sinkDriver(S, 'scram', b.arg);
        rec.blame[ids[ix]] = drv ? M.blkBlame(S, drv) : '';
      }
      OUT[ix] = isFinite(v) ? v : OUT[ix];
    }
    FV = Array.from(S.blkOutF);
    const postAct = opt.liveAct ? snapAct(S) : emptyAct();
    dumpSample(2, dt, true, synBy, ids, idxOf,
      { out: preOut, f: preF }, rec, preAct,
      { out: OUT.slice(), f: FV.slice() }, postAct);
    if (opt.liveAct) restoreAct(S, preAct);
    if (opt.wreck && opt.wreck[ti]) S.dmgParts.pop();
  });
  S.blkBy = keepBy; S.blkOutV = keepV; S.blkOutF = keepF;
}
function synthCase(blocks, ticks, mut) {
  runGraph(blocks, ticks, { mut });
}
const C = (id, mode, knob, extra) => Object.assign({ id, mode, in: [], knob: knob || {}, out: 0, f: NaN }, extra || {});
{
  // `on` defaults true like a live block (mintBlock); only an explicit null
  // tests the blank threshold, which the real tick skips over (falsy).
  const K = (v, k) => Object.assign({ v: 0, k: 1, kp: null, ti: null, td: null, db: 0, n: 8, lo: null, hi: null, rate: null, tau: 1, on: true, off: null }, k || {});
  // lag: tau=1 over three dts, tau=0, tau blank, dt=0
  synthCase([C('c', 'const', K(1)), C('l', 'lag', K(0, { tau: 1 }), { in: ['c'] })], [0.02, 0.02, 5]);
  synthCase([C('c', 'const', K(1)), C('l0', 'lag', K(0, { tau: 0 }), { in: ['c'] }), C('ln', 'lag', K(0, { tau: null }), { in: ['c'] })], [0.02]);
  synthCase([C('c', 'const', K(1)), C('l', 'lag', K(0.5, { tau: 1 }), { in: ['c'], out: 0.5 })], [0]);
  // latch: set / hold / reset / both-hot (reset wins) / hold-0
  synthCase([
    C('s', 'const', K(1)), C('r', 'const', K(0)),
    C('L', 'latch', K(0), { in: ['s', 'r'] }),
  ], [0.02, 0.02, 0.02, 0.02, 0.02], (ti, by) => {
    const seq = [[1, 0], [0, 0], [0, 1], [1, 1], [0, 0]][ti];
    by.s.v = seq[0]; by.r.v = seq[1];
  });
  // sel: max/min/median over three, single-wired, none-wired, unwired slot
  synthCase([
    C('a', 'const', K(1)), C('b', 'const', K(3)), C('c', 'const', K(2)),
    C('mx', 'sel', K(0, {}), { in: ['a', 'b', 'c'], op: 'max' }),
    C('mn', 'sel', K(0, {}), { in: ['a', 'b', 'c'], op: 'min' }),
    C('md', 'sel', K(0, {}), { in: ['a', 'b', 'c'], op: 'median' }),
    C('p1', 'sel', K(0, {}), { in: ['b'], op: 'max' }),
    C('p0', 'sel', K(0, {}), { in: [], op: 'max' }),
    C('uw', 'sel', K(0, {}), { in: ['a', null, 'c'], op: 'median' }),
    C('bogus', 'sel', K(0, {}), { in: ['a', 'b'], op: 'avg' }),
  ], [0.02]);
  // math: min, div, div-by-zero, k gain, blank k, unknown op
  synthCase([
    C('a', 'const', K(6)), C('b', 'const', K(2)), C('z', 'const', K(0)),
    C('mn', 'math', K(0, {}), { in: ['a', 'b'], op: 'min' }),
    C('dv', 'math', K(0, {}), { in: ['a', 'b'], op: 'div' }),
    C('dz', 'math', K(0, {}), { in: ['a', 'z'], op: 'div' }),
    C('g2', 'math', K(0, { k: 2 }), { in: ['a', 'b'], op: 'sub' }),
    C('gn', 'math', K(0, { k: null }), { in: ['a', 'b'], op: 'add' }),
    C('bo', 'math', K(0, {}), { in: ['a', 'b'], op: 'pow' }),
  ], [0.02]);
  // integ: clamp accumulate, blank bounds running negative
  synthCase([
    C('h', 'const', K(0.5)), C('nh', 'const', K(-4)),
    C('i1', 'integ', K(0, { lo: 0, hi: 1 }), { in: ['h'] }),
    C('i2', 'integ', K(0, {}), { in: ['nh'] }),
    C('i3', 'integ', K(0, { lo: 2 }), { in: ['nh'], out: 5 }),
  ], [0.02, 0.02, 0.02]);
  // limit: rate ramp, blank rate, blank lo
  synthCase([
    C('stp', 'const', K(10)),
    C('r1', 'limit', K(0, { lo: 0, hi: 5, rate: 1 }), { in: ['stp'] }),
    C('r2', 'limit', K(0, { lo: 0, hi: 5 }), { in: ['stp'] }),
    C('r3', 'limit', K(0, { hi: 5, rate: 100 }), { in: ['stp'] }),
  ], [0.02, 0.02, 1]);
  // pid: blank kp (outputs 0), deadband, ti=0, td=0, blank n, normal evolution
  synthCase([
    C('e', 'const', K(1)), C('rt', 'const', K(0.5)),
    C('p0', 'pid', K(0, { kp: null, ti: 10, td: 1 }), { in: ['e', 'rt'] }),
    C('pdb', 'pid', K(0, { kp: 2, ti: 10, td: 1, db: 2 }), { in: ['e', 'rt'] }),
    C('pti', 'pid', K(0, { kp: 2, ti: 0, td: 1 }), { in: ['e', 'rt'] }),
    C('ptd', 'pid', K(0, { kp: 2, ti: 10, td: 0 }), { in: ['e', 'rt'] }),
    C('pn', 'pid', K(0, { kp: 2, ti: 10, td: 1, n: null }), { in: ['e', 'rt'] }),
    C('pok', 'pid', K(0, { kp: 2, ti: 10, td: 1 }), { in: ['e', 'rt'] }),
  ], [0.02, 0.02]);
  // compare: above/below knob thresholds with hold, wired on/off, blank knobs
  synthCase([
    C('x', 'const', K(0.5)),
    C('on', 'const', K(2)), C('off', 'const', K(1)),
    C('ca', 'compare', K(0, { op: 'above', on: 1, off: 0 }), { in: ['x'] }),
    C('cb', 'compare', K(0, { op: 'below', on: 1, off: 0 }), { in: ['x'] }),
    C('cw', 'compare', K(0, { op: 'above' }), { in: ['x', 'on', 'off'] }),
    C('cn', 'compare', K(0, { op: 'above' }), { in: ['x'] }),
    C('ch', 'compare', K(0, { op: 'above', on: 1, off: 0 }), { in: ['x'], out: 1 }),
  ], [0.02, 0.02, 0.02], (ti, by) => {
    by.x.v = [0.5, 1.5, 0.5][ti];
  });
  // cycle: A<->B plus driver; leftover order must still evaluate once each
  synthCase([
    C('c', 'const', K(1)),
    C('A', 'math', K(0, {}), { in: ['B', 'c'], op: 'add' }),
    C('B', 'math', K(0, {}), { in: ['A', 'c'], op: 'add' }),
  ], [0.02, 0.02]);
  // off block holds; downstream reads the held value
  synthCase([
    C('c', 'const', K(4)),
    C('m', 'math', K(7, {}), { in: ['c', 'c'], op: 'add', on: false, out: 7 }),
    C('d', 'math', K(0, {}), { in: ['m', 'c'], op: 'add' }),
  ], [0.02]);
}

{
  const h1 = Buffer.alloc(4); h1.writeUInt32LE(nSamples);
  const h2 = Buffer.alloc(4); h2.writeUInt32LE(1);
  parts.unshift(h2); parts.unshift(h1);
}
fs.writeFileSync(fIn, Buffer.concat(parts));

const CARGO = (() => {
  try {
    const p = path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
    fs.accessSync(p); return p;
  } catch { return 'cargo'; }
})();
const out = execFileSync(CARGO, ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'ctl-probe', '--', fIn],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RUSTUP_TOOLCHAIN: '1.89.0-x86_64-pc-windows-gnu' } });
console.log(out.trim());
console.log('skipped=' + JSON.stringify(skipped) + ' cov=' + JSON.stringify(cov));
const pass = /FAILURES=0/.test(out);
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'ctl-baseline.json'), JSON.stringify({
    presets: presetNames, ticks: TICKS, samples: nSamples, tags,
  }, null, 1) + '\n');
}
if (!process.env.KEEP_TMP) fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
