#!/usr/bin/env node
// node tools/core-gate.js [--ticks N] — §6.4 gate: nodal core. Real
// coreRodStep/coreDecayStep/coreVesselStep(+tails)/coreKineticsStep/
// coreMeltStep/coreBurstStep/coreFatigueStep on every preset vs sim-rs
// core-probe replay, plus synthetic coreStep/kinetics/rod arg sets on
// snapshotted state. Masks/counts/strings exact, floats at sdig semantics.
// Plant-coupled reads are dump-kit inputs. Writes tools/core-baseline.json.
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
const XNN = 140, XNR = 14;

const M = headless('{PRE:()=>PLANTPRE,plantPreset,buildLayout,commission,P:()=>P,S:()=>S,step,' +
  'coreStep,coreKineticsStep,coreDecayStep,coreRodStep,coreVesselStep,coreMeltStep,coreBurstStep,coreFatigueStep,' +
  'coreInH,coreFlowNet,outsBag,sinkDriver,satT,satRvl,coreDTMax,loopKg,contRelPart,partOf,tiltRate,rodRate,netRhoAt,burstR,coreFold,' +
  'OBUF:()=>coreOBuf,D:()=>D,' +
  'PROMPT_F:()=>PROMPT_F,DEC_A:()=>DEC_A,DEC_L:()=>DEC_L,XTILTZ:()=>XTILTZ,XTAU_F:()=>XTAU_F,' +
  'ROD_D0:()=>ROD_D0,ROD_CLAD:()=>ROD_CLAD,ZR_RHO:()=>ZR_RHO,ZR_PBR:()=>ZR_PBR,ZR_QOX:()=>ZR_QOX,ZR_H2:()=>ZR_H2,' +
  'CLAD_DT0:()=>CLAD_DT0,H_POOL:()=>H_POOL,JL_K:()=>JL_K,JL_P:()=>JL_P,XC0:()=>XC0,XMIX_MAX:()=>XMIX_MAX,' +
  'SZ_LO:()=>SZ_LO,K_COOL:()=>K_COOL,DNB_FILM:()=>DNB_FILM,DT_LEID:()=>DT_LEID,' +
  'MELT_LATCH:()=>MELT_LATCH,MELT_INV:()=>MELT_INV,MELT_FAT:()=>MELT_FAT,FCI_TAU:()=>FCI_TAU,FCI_ETA:()=>FCI_ETA,' +
  'DISP_H:()=>DISP_H,DISP_SPAN:()=>DISP_SPAN,FUSE_KJ:()=>FUSE_KJ,FUEL_CP:()=>FUEL_CP,FUSE_DT:()=>FUSE_DT,T_STP:()=>T_STP,' +
  'BURST_TAU:()=>BURST_TAU,BURST_SPAN:()=>BURST_SPAN,BURST_LO:()=>BURST_LO,BURST_HI:()=>BURST_HI,' +
  'OX_CP:()=>OX_CP,OX_BJ:()=>OX_BJ,OX_TSW:()=>OX_TSW,OX_VMIN:()=>OX_VMIN,OX_T0:()=>OX_T0,OX_ECR_FAIL:()=>OX_ECR_FAIL,' +
  'P_FILL:()=>P_FILL,T_FILL:()=>T_FILL,REL_GAP:()=>REL_GAP,REL_OX:()=>REL_OX,REL_DISP:()=>REL_DISP,REL_MELT:()=>REL_MELT,' +
  'W3_P:()=>W3_P,W3_G:()=>W3_G,W3_D:()=>W3_D,W3_Q:()=>W3_Q,W3_H:()=>W3_H,W3_LIM:()=>W3_LIM,' +
  'SOR_SWEEPS:()=>SOR_SWEEPS,SOR_OM:()=>SOR_OM,RHO_BETA:()=>RHO_BETA,' +
  'DRYMIN:()=>DRY_MIN_KG,CDTQ:()=>CORE_DT_QMIN}');
const KEYS = ['A', 'B', 'C', 'tc', 'rhoc', 'p0', 'T0', 'n', 'pFloor', 'TFloor',
  'hfg', 'rho', 'cp', 'mu', 'muV', 'solidK', 'Tref'];
const num = v => (v === undefined || v === null) ? NaN : v;
const cp = a => Array.from(a);
const pad14 = a => { const o = cp(a || []); while (o.length < 14) o.push(NaN); return o.slice(0, 14); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'core-gate-'));
const fIn = path.join(tmp, 'core.bin');
const parts = [];
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); parts.push(b); };
const i32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); };
const f64 = v => { const b = Buffer.alloc(8); b.writeDoubleLE(v); parts.push(b); };
const f64a = a => { const b = Buffer.alloc(8 * a.length); for (let i = 0; i < a.length; i++) b.writeDoubleLE(a[i], i * 8); parts.push(b); };
const u8a = a => parts.push(Buffer.from(a));
const str = s => { const b = Buffer.from(String(s === undefined || s === null ? '' : s), 'utf8'); u32(b.length); parts.push(b); };

// ---- global const assertions (72 floats + SOR_SWEEPS + DRY/CDTQ) ----
const WL = M.W3_LIM();
const consts = [M.PROMPT_F(), ...M.DEC_A(), ...M.DEC_L(), M.XTILTZ(), M.XTAU_F(),
  M.ROD_D0(), M.ROD_CLAD(), M.ZR_RHO(), M.ZR_PBR(), M.ZR_QOX(), M.ZR_H2(), M.CLAD_DT0(), M.H_POOL(),
  M.JL_K(), M.JL_P(), M.XC0(), M.XMIX_MAX(), M.SZ_LO(), M.K_COOL(), M.DNB_FILM(), M.DT_LEID(),
  M.MELT_LATCH(), M.MELT_INV(), M.MELT_FAT(), M.FCI_TAU(), M.FCI_ETA(), M.DISP_H(), M.DISP_SPAN(),
  M.FUSE_KJ(), M.FUEL_CP(), M.FUSE_DT(), M.T_STP(), M.BURST_TAU(), M.BURST_SPAN(),
  M.BURST_LO().sig, M.BURST_LO().T, M.BURST_HI().sig, M.BURST_HI().T,
  M.OX_CP().a, M.OX_CP().b, M.OX_BJ().a, M.OX_BJ().b, M.OX_TSW(), M.OX_VMIN(), M.OX_T0(), M.OX_ECR_FAIL(),
  M.P_FILL(), M.T_FILL(), M.REL_GAP(), M.REL_OX(), M.REL_DISP(), M.REL_MELT(),
  M.W3_P(), M.W3_G(), M.W3_D(), M.W3_Q(), M.W3_H(),
  WL.p[0], WL.p[1], WL.g[0], WL.g[1], WL.d[0], WL.d[1], WL.x[0], WL.x[1], M.SOR_OM()];
if (consts.length !== 72) { console.error('consts len ' + consts.length); process.exit(2); }

const NODAL = ['phi', 'xI', 'xX', 'nTf', 'nTc', 'nV', 'nRho', 'nVt', 'nTct', 'nCov', 'nFol', 'nDmg', 'nOx', 'nMelt', 'nDisp', 'nDnb'];
function dumpCs(cs, NB) {
  const o = {};
  o.nodal = NODAL.map(k => cp(cs[k]));
  o.chW = cp(cs.chW);
  o.n = num(cs.n); o.C = cp(cs.C); o.dec = cp(cs.dec);
  o.decay = num(cs.decay); o.heat = num(cs.heat);
  o.rodPos = num(cs.rodPos); o.rodDem = num(cs.rodDem);
  o.rodZ = cp(cs.rodZ).slice(0, NB); o.rodZDem = cp(cs.rodZDem).slice(0, NB);
  o.tilt = num(cs.tilt); o.tiltDem = num(cs.tiltDem);
  o.flags = [cs.split, cs.reGang, cs.rodJam, cs.scrammed, cs.rodBand].map(v => v ? 1 : 0);
  o.s14 = [cs.ao, cs.ro, cs.hotRing, cs.hotLev, cs.vNode, cs.hotFlow, cs.tipRho, cs.TfHot,
    cs.dmg, cs.meltFrac, cs.oxMax, cs.qOx, cs.fci, cs.TcladHot].map(num);
  o.s8 = [cs.dnbrMin, cs.dnbrRing, cs.dnbrLev, cs.fq, cs.vf, cs.voidTh, cs.coreDT, cs.dnbr].map(num);
  o.s9 = [cs.X, cs.I, cs.Tf, cs.parts.rod, cs.parts.dop, cs.parts.mod, cs.parts.exp, cs.parts.xe, cs.parts.vd].map(num);
  o.p2 = [cs.parts.tip, cs.parts.dis, cs.parts.bor].map(num);
  o.s4 = [cs.rho, cs.pCore, cs.flowNet, cs.fatigue].map(num);
  o.mb = [(cs.melt ? 1 : 0), (cs.breach ? 1 : 0)];
  o.trip = cs.trip === undefined || cs.trip === null ? '' : String(cs.trip);
  return o;
}
function writeCs(o, NB) {
  for (const a of o.nodal) f64a(a);
  f64a(o.chW);
  f64(o.n); f64a(o.C); f64a(o.dec); f64(o.decay); f64(o.heat);
  f64(o.rodPos); f64(o.rodDem); f64a(o.rodZ); f64a(o.rodZDem);
  f64(o.tilt); f64(o.tiltDem);
  u8a(o.flags);
  f64a(o.s14); f64a(o.s8); f64a(o.s9); f64a(o.p2); f64a(o.s4);
  u8a(o.mb);
}
function snapCs(cs, NB) {
  const s = dumpCs(cs, NB);
  s.trip = cs.trip;
  return s;
}
const setArr = (dst, src) => { if (dst.set) dst.set(src); else { dst.length = 0; for (const v of src) dst.push(v); } };
function restoreCs(cs, s) {
  for (let k = 0; k < NODAL.length; k++) cs[NODAL[k]].set(s.nodal[k]);
  cs.chW.set(s.chW);
  cs.n = s.n; setArr(cs.C, s.C); setArr(cs.dec, s.dec);
  cs.decay = s.decay; cs.heat = s.heat;
  cs.rodPos = s.rodPos; cs.rodDem = s.rodDem;
  cs.rodZ.set(s.rodZ); cs.rodZDem.set(s.rodZDem);
  cs.tilt = s.tilt; cs.tiltDem = s.tiltDem;
  cs.split = !!s.flags[0]; cs.reGang = !!s.flags[1]; cs.rodJam = !!s.flags[2];
  cs.scrammed = !!s.flags[3]; cs.rodBand = !!s.flags[4];
  [cs.ao, cs.ro, cs.hotRing, cs.hotLev, cs.vNode, cs.hotFlow, cs.tipRho, cs.TfHot,
    cs.dmg, cs.meltFrac, cs.oxMax, cs.qOx, cs.fci, cs.TcladHot] = s.s14;
  [cs.dnbrMin, cs.dnbrRing, cs.dnbrLev, cs.fq, cs.vf, cs.voidTh, cs.coreDT, cs.dnbr] = s.s8;
  [cs.X, cs.I, cs.Tf, cs.parts.rod, cs.parts.dop, cs.parts.mod, cs.parts.exp, cs.parts.xe, cs.parts.vd] = s.s9;
  [cs.parts.tip, cs.parts.dis, cs.parts.bor] = s.p2;
  [cs.rho, cs.pCore, cs.flowNet, cs.fatigue] = s.s4;
  cs.melt = !!s.mb[0]; cs.breach = !!s.mb[1];
  cs.trip = s.trip;
}
function dumpK(K, P) {
  const NB = K.NB;
  const f = [K.n0, K.TfRef, K.Tref, K.rodA, K.tipRho, K.tipLen, K.poison, K.mix, K.dT0, K.dh,
    K.aHeat, K.G0, K.filmPool, K.xSub, K.xSubLo, K.hfg, K.flowK, K.pinUA, K.gSolid, K.cladR,
    K.rodD, K.tmelt, K.KXE, K.aF, K.aM, K.aX, K.aS, K.aV, K.excess, K.dnbrK, K.tdmg, K.rated,
    K.scram, M.rodRate(K), K.burstK, K.P0, K.coreKg0, K.BETA, K.LAM, K.gI, K.lamI, K.gX, K.lamX,
    K.sig, K.cr, K.cz, K.albR, K.albT, K.albB, K.rinf, M.burstR(), P.rho0, M.RHO_BETA(), P.Tref,
    K.coreHgt].map(num);
  if (f.length !== 55) { console.error('K floats len ' + f.length); process.exit(2); }
  const law = K.dnbLaw === 'boil' ? 1 : K.dnbLaw === 'temp' ? 2 : 0;
  return { NB, f, sat: KEYS.map(k => num(K.sat[k])),
    flags: [(K.oxid ? 1 : 0), (K.dryout ? 1 : 0), (K.tube ? 1 : 0), law],
    poiG: pad14(K.poiG), nPen: pad14(K.nPen), enrRho: pad14(K.enrRho), rinfW: pad14(K.rinfW),
    bet: cp(K.bet).slice(0, 6), lam: cp(K.lam).slice(0, 6),
    bankR: cp(K.bankR).slice(0, NB), bankW: cp(K.bankW).slice(0, NB) };
}

const presetNames = [];
let nSamples = 0;
const skipped = { noOuts: 0 };
const presets = [];

for (const k of Object.keys(M.PRE())) {
  M.plantPreset(+k); M.buildLayout(); M.commission();
  const S0 = M.S(); S0.diceOff = true;
  presetNames.push(M.PRE()[k][0]);
  const P = { cores: [], samples: [] };
  const D = M.D(), Pv = M.P();
  const coreIds = Object.keys(Pv.cores || {});
  for (const id of coreIds) P.cores.push({ id, NB: Pv.cores[id].NB, K: dumpK(Pv.cores[id], Pv) });
  const S = M.S();
  for (let t = 0; t < TICKS && !P.samples.length; t++) {
    M.step(DT);
    if (t < 1) continue;
    for (let ci = 0; ci < coreIds.length; ci++) {
      const id = coreIds[ci], K = M.P().cores[id], cs = S.coreBy[id];
      if (!cs) continue;
      const NB = K.NB, netOut = M.P().netOut;
      const outsOk = K.netRef > 0 && netOut && (netOut.coreKgV || netOut.coreKgBy);
      if (!outsOk) { skipped.noOuts++; continue; }
      const coreFNval = M.coreFlowNet(K, id, netOut, 0);
      const sink = M.sinkDriver(S, 'rodStep', id) ? 1 : 0;
      const tiltRate = num(M.tiltRate(K));
      const inj = num(S.injRate);
      // ---- TICK sample: real fns in tick order ----
      const samp = { tag: 0, ci, dt: DT };
      samp.pre = dumpCs(cs, NB);
      samp.tripPre = samp.pre.trip;
      M.coreRodStep(cs, K, id, DT);
      M.coreDecayStep(cs, DT);
      samp.args = [num(cs.heat), num(M.satT(K.sat, cs.pCore)), 0, 0, 0, 0, num(M.coreDTMax()), tiltRate];
      { // vLeak + mflux + flowFrac + hIn as the tick derives them
        const nid = M.coreFold(id), ni = M.P().net ? M.P().net.index[nid] : undefined;
        const m = (ni !== undefined && S.mBy.has[ni]) ? S.mBy.v[ni] : undefined;
        const rvl = M.satRvl(K.sat, cs.pCore);
        samp.args[2] = (!(K.coreKg0 > 0) || m === undefined || (K.sat.tc && K.Tref > K.sat.tc)) ? 0 :
          Math.max(0, (1 - m / K.coreKg0) / Math.max(1 - rvl, 1e-3));
        samp.args[3] = num(K.flowK * coreFNval);
        samp.args[4] = Math.max(cs.flowNet, M.CDTQ());
        samp.args[5] = num(M.coreInH(S, id));
      }
      samp.sink = sink; samp.inj = inj;
      samp.loopKg = num(M.loopKg());
      { const nid = M.coreFold(id), ni = M.P().net ? M.P().net.index[nid] : undefined;
        samp.meltNode = ni === undefined ? -1 : ni;
        const hv = (ni !== undefined && ni >= 0 && S.mBy.has[ni]) ? S.mBy.v[ni] : undefined;
        samp.haveNone = hv === undefined ? 1 : 0; samp.have = num(hv); }
      samp.relPart = num(M.contRelPart(S, M.partOf(id)));
      samp.dose = num(M.P().dose); samp.catcher = M.P().catcher ? 1 : 0;
      samp.boronS = num(S.boron);
      { const nid = M.coreFold(id), net = M.P().net;
        const ni = net ? net.index[nid] : undefined;
        if (!S.h2By || ni === undefined) { samp.h2node = -1; samp.h2m2none = 1; samp.h2m2 = NaN; samp.h2pre = NaN; samp.h2preHas = 0; }
        else {
          samp.h2node = ni;
          const hv = S.mBy.has[ni] ? S.mBy.v[ni] : undefined;
          samp.h2m2none = 0;
          samp.h2m2 = hv !== undefined ? hv : num(net.vol[ni] * M.netRhoAt(S, nid));
          samp.h2pre = num(S.h2By.v[ni]); samp.h2preHas = S.h2By.has[ni] ? 1 : 0;
        } }
      samp.releasePre = num(S.release);
      if (inj > 0) M.coreFatigueStep(cs, DT, inj);
      M.coreBurstStep(cs, K, id);
      M.coreVesselStep(cs, K, id, DT, { [id]: coreFNval });
      samp.oExp = cp(M.OBUF());
      M.coreKineticsStep(cs, K, DT);
      M.coreMeltStep(cs, K, id, DT);
      samp.post = dumpCs(cs, NB);
      samp.tripPost = samp.post.trip;
      samp.e_h2node = samp.h2node >= 0 ? num(S.h2By.v[samp.h2node]) : NaN;
      samp.e_h2has = samp.h2node >= 0 ? (S.h2By.has[samp.h2node] ? 1 : 0) : 0;
      samp.e_release = num(S.release);
      samp.e_meltMass = samp.meltNode >= 0 ? num(S.mBy.v[samp.meltNode]) : NaN;
      samp.e_meltBook = num(S.massOut && S.massOut.melt);
      samp.e_trip = samp.tripPost;
      P.samples.push(samp);
      nSamples++;
      // ---- SYNTH samples on snapshot/restore ----
      const snap = snapCs(cs, NB);
      const synthNod = (mut, dt) => {
        const s2 = { tag: 1, ci, dt, pre: dumpCs(cs, NB), tripPre: cs.trip === undefined ? '' : String(cs.trip) };
        Object.assign(s2, mut);
        const o = M.coreStep(K, cs, dt, s2.heat, s2.sat, s2.vLeak, s2.mflux, s2.flowFrac, s2.hIn);
        s2.args = [s2.heat, s2.sat, s2.vLeak, s2.mflux, s2.flowFrac, s2.hIn, s2.coreDtMax, tiltRate];
        s2.post = dumpCs(cs, NB); s2.tripPost = s2.post.trip; s2.oExp = cp(o);
        P.samples.push(s2); nSamples++;
        restoreCs(cs, snap);
      };
      const base = { heat: samp.args[0], sat: samp.args[1], vLeak: samp.args[2], mflux: samp.args[3], flowFrac: samp.args[4], hIn: samp.args[5], coreDtMax: samp.args[6] };
      synthNod({ ...base }, 0);
      synthNod({ ...base, heat: base.heat > 0 ? base.heat * 4 : 2, mflux: 0, flowFrac: 0.02, vLeak: 0.9 }, DT);
      synthNod({ ...base, heat: Math.max(base.heat * 0.05, 1e-4), flowFrac: 1.5, vLeak: 0 }, DT);
      for (const rho of [1500, -1500]) {
        const s3 = { tag: 2, ci, dt: DT, rhoSyn: rho, n0: num(cs.n), c0: cp(cs.C) };
        const sn = cs.n, sC = cp(cs.C), srho = cs.rho;
        cs.rho = rho;
        M.coreKineticsStep(cs, K, DT);
        s3.e_n = num(cs.n); s3.e_c = cp(cs.C);
        cs.n = sn; setArr(cs.C, sC); cs.rho = srho;
        P.samples.push(s3); nSamples++;
      }
      { cs.scrammed = true;
        const s4 = { tag: 3, ci, dt: DT, pre: dumpCs(cs, NB), tripPre: cs.trip === undefined ? '' : String(cs.trip) };
        s4.sink = sink; s4.tiltRate = tiltRate;
        M.coreRodStep(cs, K, id, DT);
        s4.post = dumpCs(cs, NB); s4.tripPost = s4.post.trip;
        P.samples.push(s4); nSamples++;
        restoreCs(cs, snap); }
      restoreCs(cs, snap);
    }
  }
  presets.push(P);
}

// ---- encode ----
u32(presets.length); u32(1);
u32(consts.length); f64a(consts);
u32(M.SOR_SWEEPS()); f64(M.DRYMIN()); f64(M.CDTQ());
for (const P of presets) {
  u32(P.cores.length);
  for (const c of P.cores) {
    u32(c.NB); f64a(c.K.f); f64a(c.K.sat); u8a(c.K.flags);
    f64a(c.K.poiG); f64a(c.K.nPen); f64a(c.K.enrRho); f64a(c.K.rinfW);
    f64a(c.K.bet); f64a(c.K.lam); f64a(c.K.bankR); f64a(c.K.bankW);
  }
  u32(P.samples.length);
  for (const s of P.samples) {
    u32(s.tag); u32(s.ci); f64(s.dt);
    if (s.tag === 2) {
      f64(s.rhoSyn); f64(s.n0); f64a(s.c0); f64(s.e_n); f64a(s.e_c);
      continue;
    }
    if (s.tag === 3) {
      writeCs(s.pre, P.cores[s.ci].NB);
      u32(s.sink); f64(s.tiltRate);
      writeCs(s.post, P.cores[s.ci].NB);
      str(s.tripPre); str(s.tripPost);
      continue;
    }
    writeCs(s.pre, P.cores[s.ci].NB);
    str(s.tripPre);
    f64a(s.args);
    writeCs(s.post, P.cores[s.ci].NB);
    str(s.tripPost);
    f64a(s.oExp);
    if (s.tag === 1) continue;
    u32(s.sink); f64(s.inj); f64(s.loopKg);
    u32(s.haveNone); f64(s.have); f64(s.relPart); f64(s.dose); u32(s.catcher); f64(s.boronS);
    i32(s.h2node); u32(s.h2m2none); f64(s.h2m2); f64(s.h2pre); u32(s.h2preHas);
    f64(s.e_h2node); u32(s.e_h2has);
    f64(s.e_release); f64(s.releasePre);
    i32(s.meltNode); f64(s.e_meltMass); f64(s.e_meltBook);
    str(s.e_trip);
  }
}
fs.writeFileSync(fIn, Buffer.concat(parts));

const CARGO = (() => { try {
  const p = path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
  fs.accessSync(p); return p;
} catch { return 'cargo'; } })();
const out = execFileSync(CARGO, ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'core-probe', '--', fIn],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RUSTUP_TOOLCHAIN: '1.89.0-x86_64-pc-windows-gnu' } });
console.log(out.trim());
console.log('skipped=' + JSON.stringify(skipped));
const pass = /FAILURES=0/.test(out);
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'core-baseline.json'), JSON.stringify({
    presets: presetNames, ticks: TICKS, samples: nSamples,
  }, null, 1) + '\n');
}
if (!process.env.KEEP_TMP) fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
