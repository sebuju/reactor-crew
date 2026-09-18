#!/usr/bin/env node
// node tools/events-gate.js [--ticks N] — §6.6 events gate: radDoseStep then
// the stepMarch tail (blast, overpressure, burnFire, cook, evLatch+ann,
// repair, flowSpin, ledger) on every preset vs sim-rs events-probe replay.
// Masks/counts/strings exact, floats at sdig semantics. Dump-kit inputs:
// solved/transport artifacts as values, field bags, masks, structural tables.
// Writes tools/events-baseline.json on pass.
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

const M = headless('{PRE:()=>PLANTPRE,plantPreset,buildLayout,commission,P:()=>P,S:()=>S,D:()=>D,LAY:()=>LAY,step,' +
  'GW:()=>GW,GH:()=>GH,' +
  'coreIds:()=>coreIds(),sgIds:()=>sgIds(),boilerIds:()=>boilerIds(),pumpIds:()=>pumpIds(),tankIds:()=>tankIds(),' +
  'reliefFitIds:()=>reliefFitIds(),radIds:()=>radIds(),' +
  'coreSeenReset:()=>{seenS=null;seenBy=null;},' +
  'tickInj:()=>tickInjIds.slice(),tickCav:()=>tickCavIds.slice(),' +
  'blastStep:(s,dt)=>blastStep(s,dt),overpressureStep:(s)=>overpressureStep(s),' +
  'burnFireStep:(s)=>burnFireStep(s),cookStep:(s,dt)=>cookStep(s,dt),' +
  'evLatchStep:(s,cavIds,injIds)=>evLatchStep(s,cavIds,injIds),' +
  'repairStep:(s,dt)=>repairStep(s,dt),flowSpinStep:(s,dt,runFlow)=>flowSpinStep(s,dt,runFlow),' +
  'ledgerStep:(s,dt,ledgM0,ledgO0)=>ledgerStep(s,dt,ledgM0,ledgO0),' +
  'radDoseStep:(s,dt)=>radDoseStep(s,dt),' +
  'cellHazards:()=>cellHazards(),' +
  'layParts:()=>LAY.parts.map(p=>({id:p.id,x:p.x,y:p.y,w:p.w,h:p.h,role:p.role,name:p.name})),' +
  'pburst:(id)=>{const p=partOf(id); return p?partPburst(p):null;},' +
  'pdes:(id)=>{const p=partOf(id); return p?partPdes(p):0;},' +
  'ptsurv:(id)=>{const p=partOf(id); return p?partTsurv(p):0;},' +
  'faceNodes:(id)=>partFaceNode(id),' +
  'inCore:(n)=>nodeGraph().inCore(n),' +
  'netHas:(n)=>P.net.index[n]!==undefined,' +
  'netKeys:()=>Object.keys(P.net.index),' +
  'booked:()=>Array.from(netBooked(P.net)),' +
  'netN:()=>P.net.n,' +
  'runKeys:()=>flowMapsOf(P.net).runKeys,' +
  'runPos:()=>{const m={}; for(const [k,v] of flowMapsOf(P.net).runPos) m[k]=v; return m;},' +
  'runRec:(key)=>{const r=P.net.byKey[key]; return r?{k:r.k,pa:r.pa,pb:r.pb}:null;},' +
  'runTag:(key)=>P.net.tagByKey[key]||0,' +
  'runRef:(key)=>P.netRefByRun[key],' +
  'steamBook:(key)=>{const r=P.net.byKey[key]; if(!r) return null;' +
  ' const b=steamBook(key,r.k);' +
  ' return {vent:!!b.vent,taps:(b.taps||[]).slice(),dir:steamDir(key,r.k),' +
  ' gens:(b.gens||[]).slice(),ends:!!runEnds(key,r.k)};},' +
  'ratedSteam:()=>ratedSteam(),' +
  'sgLift:()=>sgDesignP()*PORV_LIFT_K,' +
  'circKey:(ci)=>circKey(ci),' +
  'coreCirc:()=>nodeGraph().coreCirc,' +
  'satTref:(ci)=>satOfCirc(ci).Tref,' +
  'coreCi:(id)=>{const K=P.cores&&P.cores[id]; return K?K.circ:-1;},' +
  'coreRated:(id)=>P.cores[id].rated,' +
  'coreNB:(id)=>P.cores[id].NB,' +
  'holdOf:(id)=>{const K=P.cores&&P.cores[id]; const h=K?holdOnCirc(K.circ):[]; return h.length?h[0]:"";},' +
  'coresTref:(id)=>P.cores[id].Tref,' +
  'coresSteam:(id)=>P.cores[id].steam,' +
  'tProgBase:()=>({tref:(S.K||P).Tref,steam:(S.K||P).steam}),' +
  'secP:(id)=>secP(S,id),' +
  'boilerLvl:(id)=>boilerLvl(S,id),' +
  'condFrac:()=>condFrac(S),' +
  'panelHit:()=>radTMax(S),' +
  'condP:()=>condP(S),' +
  'sumpKg:()=>sumpKg(S),' +
  'partSkin:(id)=>{const p=partOf(id); return p?partSkin(S,p):0;},' +
  'loopp:(id)=>{const K=P.cores&&P.cores[id]; return K?loopP(S,K.circ):S.P;},' +
  'contRel:(id)=>contRelPart(S,partOf(id)),' +
  'partyCells:(id)=>{const p=dmgPart(id); if(!p) return [];' +
  ' if(p.stand&&p.stand.length) return p.stand.map(c=>c[1]*GW+c[0]);' +
  ' const g=occupied(null,{pipes:false}); return freeAdj(p,g).map(c=>c[1]*GW+c[0]);},' +
  'crewRect:()=>{const p=roleOf("ctrl")||(primaryCore()?partOf(primaryCore()):null);' +
  ' return p?[p.x,p.y,p.w,p.h]:null;},' +
  'radK:()=>P.radK,' +
  'radPipe:()=>P.radK.pipe,' +
  'fuelInCoolant:()=>COOLANT[priD().cool].fuelInCoolant,' +
  'tankAct:(id)=>tankFluid(id).act,' +
  'tankKg:(id)=>tankKg(id),' +
  'tankInField:(id)=>tankInField(id),' +
  'waterAct:()=>FLUID.water.act,' +
  'primaryRelief:()=>primaryRelief()||"",' +
  'primaryPump:(id)=>primaryPump(id),' +
  'rps:()=>rpsState(),' +
  'sinkRunback:()=>!!sinkWired(S,"runback",null),' +
  'runbackLive:()=>runbackLive(),' +
  'tripNear:()=>!!tripNear(),' +
  'netDry:()=>netDryParts(S),' +
  'ledgerKg:()=>ledgerKg(S),' +
  'ledgerOut:()=>ledgerOut(S),' +
  'matOf:()=>Array.from(matRegions().of),' +
  'Pget:(k)=>P[k],' +
  'Dget:(k)=>D[k],' +
  'decLen:()=>DEC_A.length,' +
  'ROOM_CRUSH_K:()=>ROOM_CRUSH_K,ROOM_CRUSH_SPAN:()=>ROOM_CRUSH_SPAN,ROOM_CRUSH_TAU:()=>ROOM_CRUSH_TAU,' +
  'ROOM_DMG_SPAN:()=>ROOM_DMG_SPAN,ROOM_DMG_TAU:()=>ROOM_DMG_TAU,' +
  'PIPE_PBURST:()=>PIPE_PBURST,PIPE_TSURV:()=>PIPE_TSURV,' +
  'H2_BURN_EV:()=>H2_BURN_EV,H2_LHV:()=>H2_LHV,FIRE_EV_KG:()=>FIRE_EV_KG,' +
  'LEDGER_EPS:()=>LEDGER_EPS,LEDGER_QUIET:()=>LEDGER_QUIET,' +
  'H2_EV:()=>H2_EV,H2_LFL:()=>H2_LFL,' +
  'RAD_HI:()=>RAD_HI,RAD_FLOOR:()=>RAD_FLOOR,RAD_CEIL:()=>RAD_CEIL,' +
  'RAD_CREW_K:()=>RAD_CREW_K,RAD_DOSE_K:()=>RAD_DOSE_K,' +
  'RAD_BREACH:()=>RAD_BREACH,RAD_DMG:()=>RAD_DMG,RAD_MELT:()=>RAD_MELT,' +
  'RAD_SGTR:()=>RAD_SGTR,RAD_AIR:()=>RAD_AIR,RAD_TANK:()=>RAD_TANK,' +
  'RAD_SLOW:()=>RAD_SLOW,ANN_TICKS:()=>ANN_TICKS,DRAW_K:()=>DRAW_K,' +
  'PROMPT_F:()=>PROMPT_F,SG_LOW:()=>SG_LOW,SG_DRY_LO:()=>SG_DRY_LO,' +
  'TURB_TRIP_P:()=>TURB_TRIP_P,COND_DT0:()=>COND_DT0,TPROG_SPAN:()=>TPROG_SPAN,' +
  'T_HULL:()=>T_HULL,AIR_MMOL:()=>AIR_MMOL,H2_MMOL:()=>H2_MMOL,H2O_MMOL:()=>H2O_MMOL,' +
  'RAD_K:()=>RAD_K,' +
  'roomCgIt:()=>0,liqCgIt:()=>0,' +
  'primaryCore:()=>primaryCore(),' +
  'tankHold:(id)=>tankHold(id),' +
  'radLive:(id)=>radLive(id),' +
  'panelThresh:()=>tsatSec(TURB_TRIP_P)-COND_DT0,' +
  'netIndex:()=>Object.keys(P.net.index),' +
  'LOG:()=>LOG}');

const num = v => (v === undefined || v === null) ? NaN : v;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'events-gate-'));
const fIn = path.join(tmp, 'events.bin');
let parts = [];
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); parts.push(b); };
const i32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); };
const f64 = v => { const b = Buffer.alloc(8); b.writeDoubleLE(v); parts.push(b); };
const f64a = a => { const b = Buffer.alloc(8 * a.length); for (let i = 0; i < a.length; i++) b.writeDoubleLE(a[i], i * 8); parts.push(b); };
const i32a = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeInt32LE(a[i], i * 4); parts.push(b); };
const u8 = v => parts.push(Buffer.from([(v | 0) & 0xff]));
const u8a = a => parts.push(Buffer.from(Array.from(a).map(v => v ? 1 : 0)));
const u32a = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeUInt32LE(a[i] >>> 0, i * 4); parts.push(b); };
const str = s => { const b = Buffer.from(String(s === undefined || s === null ? '' : s), 'utf8'); u32(b.length); parts.push(b); };
const strsRaw = a => { for (const s of a) str(s); };
const strs = a => { u32(a.length); strsRaw(a); };
const u32b = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const fnum = v => (v === undefined || v === null) ? NaN : (typeof v === 'boolean' ? (v ? 1 : 0) : v);
const smap = o => {
  o = o || {};
  const ks = Object.keys(o).filter(k => o[k] !== undefined);
  u32(ks.length);
  for (const k of ks) { str(k); f64(fnum(o[k])); }
};
const strmapB = m => {
  m = m || {};
  const ks = Object.keys(m);
  u32(ks.length);
  for (const k of ks) { str(k); u8(m[k] ? 1 : 0); }
};
const snapVal = v => {
  if (v === undefined || v === null) return v;
  if (Array.isArray(v)) return v.slice();
  if (typeof v === 'object') return { ...v };
  return v;
};

// event codes mirrored from sim-rs/src/tick.rs; gate maps code -> [sev, msg prefix]
const EVMSG = {
  20: ['alarm', 'EXPLOSION IN THE COMPARTMENT'],
  21: ['alarm', 'BLAST DAMAGE / '],
  22: ['alarm', 'OVERPRESSURE DAMAGE / '],
  23: ['alarm', 'SHELL FAILURE / '],
  24: ['alarm', 'HYDROGEN DEFLAGRATION'],
  25: ['alarm', 'SODIUM FIRE'],
  26: ['alarm', 'HEAT DAMAGE / '],
  30: ['warn', 'POWER ABOVE 110%'],
  31: ['warn', 'DNBR BELOW 1.30'],
  32: ['alarm', 'DNBR BELOW 1.00 / CLADDING FAILING'],
  33: ['alarm', 'REACTOR TRIP / '],
  34: ['alarm', 'TRIPPED CORE GOING CRITICAL'],
  35: ['warn', 'COOLANT PUMP CAVITATION'],
  36: ['alarm', 'LINE RUN DRY'],
  37: ['warn', 'PUMPS ORDERED BELOW DESIGN FLOOR'],
  38: ['warn', 'PRIMARY OVERPRESSURE'],
  39: ['warn', 'RELIEF VALVE PASSING'],
  40: ['alarm', 'PORV FAILED TO RESEAT'],
  41: ['alarm', 'STEAM VOID IN CORE'],
  42: ['warn', 'HIGH RADIATION IN THE SPACE'],
  43: ['alarm', 'EQUIPMENT OVER TEMPERATURE'],
  44: ['alarm', 'HYDROGEN IN THE COMPARTMENT'],
  45: ['info', 'XENON PIT'],
  46: ['alarm', 'CONTROL RODS NOT RESPONDING'],
  47: ['warn', 'PROTECTION SYSTEM SWITCHED OFF'],
  48: ['warn', 'TURBINE RUNBACK SWITCHED OFF'],
  49: ['warn', 'NO PROTECTION SYSTEM FITTED'],
  50: ['info', 'INJECTING'],
  51: ['alarm', 'FUEL DAMAGE 1%'],
  52: ['alarm', 'FUEL DAMAGE 25%'],
  53: ['alarm', 'WATCH DOSE PAST 50%'],
  54: ['warn', 'VESSEL FATIGUE PAST 50%'],
  55: ['alarm', 'VESSEL RUPTURE'],
  56: ['alarm', 'CLAD OXIDATION SELF-SUSTAINING'],
  57: ['alarm', 'HYDROGEN IN THE PRIMARY'],
  58: ['alarm', 'CORE MELT'],
  61: ['alarm', 'REPAIR PARTY WITHDRAWN'],
  62: ['info', 'REPAIR COMPLETE / '],
};

// ---- const assertion (fails fast) ----
function assertConsts() {
  const want = {
    ROOM_CRUSH_K: M.ROOM_CRUSH_K(), ROOM_CRUSH_SPAN: M.ROOM_CRUSH_SPAN(), ROOM_CRUSH_TAU: M.ROOM_CRUSH_TAU(),
    ROOM_DMG_SPAN: M.ROOM_DMG_SPAN(), ROOM_DMG_TAU: M.ROOM_DMG_TAU(),
    PIPE_PBURST: M.PIPE_PBURST(), PIPE_TSURV: M.PIPE_TSURV(),
    H2_BURN_EV: M.H2_BURN_EV(), H2_LHV: M.H2_LHV(), FIRE_EV_KG: M.FIRE_EV_KG(),
    LEDGER_EPS: M.LEDGER_EPS(), LEDGER_QUIET: M.LEDGER_QUIET(),
    H2_EV: M.H2_EV(), H2_LFL: M.H2_LFL(),
    RAD_HI: M.RAD_HI(), RAD_FLOOR: M.RAD_FLOOR(), RAD_CEIL: M.RAD_CEIL(),
    RAD_CREW_K: M.RAD_CREW_K(), RAD_DOSE_K: M.RAD_DOSE_K(),
    RAD_BREACH: M.RAD_BREACH(), RAD_DMG: M.RAD_DMG(), RAD_MELT: M.RAD_MELT(),
    RAD_SGTR: M.RAD_SGTR(), RAD_AIR: M.RAD_AIR(), RAD_TANK: M.RAD_TANK(),
    RAD_SLOW: M.RAD_SLOW(), ANN_TICKS: M.ANN_TICKS(), DRAW_K: M.DRAW_K(),
    PROMPT_F: M.PROMPT_F(), SG_LOW: M.SG_LOW(), SG_DRY_LO: M.SG_DRY_LO(),
    TURB_TRIP_P: M.TURB_TRIP_P(), COND_DT0: M.COND_DT0(), TPROG_SPAN: M.TPROG_SPAN(),
    T_HULL: M.T_HULL(), AIR_MMOL: M.AIR_MMOL(), H2_MMOL: M.H2_MMOL(), H2O_MMOL: M.H2O_MMOL(),
    RAD_K: M.RAD_K(),
  };
  const ref = {
    ROOM_CRUSH_K: 10, ROOM_CRUSH_SPAN: 0.5, ROOM_CRUSH_TAU: 60,
    ROOM_DMG_SPAN: 60, ROOM_DMG_TAU: 25,
    PIPE_PBURST: 120, PIPE_TSURV: 900,
    H2_BURN_EV: 1.0, H2_LHV: 120000, FIRE_EV_KG: 1.0,
    LEDGER_EPS: 1e-7, LEDGER_QUIET: 30,
    H2_EV: 20, H2_LFL: 0.04,
    RAD_HI: 1.0, RAD_FLOOR: 0.02, RAD_CEIL: 3,
    RAD_CREW_K: 0.33, RAD_DOSE_K: 0.25,
    RAD_BREACH: 3.0, RAD_DMG: 0.06, RAD_MELT: 4.0,
    RAD_SGTR: 1.2, RAD_AIR: 0.05, RAD_TANK: 0.03,
    RAD_SLOW: 0.5, ANN_TICKS: 5, DRAW_K: 8.375,
    PROMPT_F: 0.935, SG_LOW: 35, SG_DRY_LO: 10,
    TURB_TRIP_P: 0.02, COND_DT0: 13, TPROG_SPAN: 18,
    T_HULL: 293, AIR_MMOL: 0.02896, H2_MMOL: 0.002016, H2O_MMOL: 0.018015,
    RAD_K: 7.1583,
  };
  for (const k of Object.keys(ref)) {
    if (want[k] !== ref[k]) { console.error('const ' + k + ' = ' + want[k] + ' want ' + ref[k]); process.exit(2); }
  }
  return want;
}

const F64STATE = ['n', 'decay', 'heat', 'dmg', 'meltFrac', 'Tf', 'dnbr', 'vf', 'oxMax', 'qOx',
  'fatigue', 'rho', 'rodPos', 'P', 'Tavg', 'lvl', 'sc', 'cav', 'h2',
  'injRate', 'release', 'load', 'loadDem', 'flowNet', 'crewDose', 'dose', 'doseRate',
  'repRate', 'massRes', 'massWarn', 'roomPMax', 'roomBurnOn', 'roomFireOn',
  'roomBang', 'roomMax', 'spinV', 'spinTV'];
const U8KEYS = ['scrammed', 'breach', 'melt', 'rodJam', 'rodBand', 'blackout', 'turbTrip', 'condLost',
  'partySpent', 'bkpLost', 'sgtr'];
const I32KEYS = ['tick', 'massWarnT', 'annRev'];
const F64MAPS = ['tank', 'massOut', 'roomCrush', 'roomHurt', 'flowPos', 'reliefSteam',
  'flowDemBy', 'lvlBy', 'scBy', 'TavgBy'];
const BOOLMAPS = ['reliefOpen', 'reliefBlocked', 'reliefStuck', 'reliefAuto', 'sgBurst'];
const VESSEL_F64 = ['n', 'decay', 'dmg', 'meltFrac', 'Tf', 'dnbr', 'vf', 'oxMax', 'qOx',
  'fatigue', 'rho', 'tilt', 'tiltDem', 'rodDem'];
const VESSEL_U8 = ['scrammed', 'breach', 'melt', 'rodJam', 'rodBand'];
const COREAGG_PRESERVE = ['rodDem', 'tiltDem', 'rodZ', 'rodZDem', 'bankAuto', 'split', 'reGang',
  'tilt', 'fq', 'ao', 'X', 'I', 'pCore', 'coreDT', 'voidTh', 'TfHot', 'parts'];

function snapState(meta) {
  const S = M.S();
  const snap = {
    f: {}, b: {}, i: {}, maps: {}, bmaps: {}, vessels: {}, room: {}, mby: null,
    dmgParts: (S.dmgParts || []).slice(), dmgWhy: { ...(S.dmgWhy || {}) },
    massOut: { ...(S.massOut || {}) },
    burn: { ...(S.burnEv || {}) }, burnIds: ((S.burnEv && S.burnEv.ids) || []).slice(),
    fire: { ...(S.fireEv || {}) }, repair: snapVal(S.repair),
    ev: { ...(S.ev || {}) }, annOn: { ...(S.annOn || {}) },
    dec: S.dec ? S.dec.slice() : S.dec,
    tripRaw: S.trip, portShut: { ...(S.portShut || {}) },
    partT: { ...(S.partT || {}) },
    agg: {},
  };
  for (const k of F64STATE) snap.f[k] = S[k];
  for (const k of U8KEYS) snap.b[k] = S[k];
  for (const k of I32KEYS) snap.i[k] = S[k];
  for (const k of F64MAPS) snap.maps[k] = S[k] === undefined ? undefined : { ...S[k] };
  for (const k of BOOLMAPS) snap.bmaps[k] = S[k] === undefined ? undefined : { ...S[k] };
  for (const id of meta.coreIds) {
    const cs = S.coreBy && S.coreBy[id];
    if (!cs) { snap.vessels[id] = undefined; continue; }
    const o = {};
    for (const k of [...VESSEL_F64, ...VESSEL_U8]) o[k] = cs[k];
    o.dec = cs.dec ? cs.dec.slice() : cs.dec;
    o.trip = cs.trip; o.rodPos = cs.rodPos;
    o.rodZ = cs.rodZ ? cs.rodZ.slice() : cs.rodZ;
    o.rodZDem = cs.rodZDem ? cs.rodZDem.slice() : cs.rodZDem;
    o.parts = snapVal(cs.parts);
    snap.vessels[id] = o;
  }
  const n = meta.n;
  for (const k of ['roomP', 'roomT', 'roomH2', 'roomM', 'roomVap']) snap.room[k] = S[k] ? Array.from(S[k]) : new Array(n).fill(0);
  const h = S.mBy;
  snap.mby = !h || !h.v ? undefined : { v: Array.from(h.v), has: Array.from(h.has || []) };
  for (const k of COREAGG_PRESERVE) snap.agg[k] = snapVal(S[k]);
  snap.agg.parts = snapVal(S.parts);
  snap.logLen = M.LOG().length;
  snap.warns = consoleWarns;
  return snap;
}

let consoleWarns = 0;
const realWarn = console.warn;
console.warn = (...a) => { consoleWarns++; return realWarn(...a); };
function restoreState(meta, snap) {
  const S = M.S();
  for (const k of F64STATE) { if (snap.f[k] === undefined) delete S[k]; else S[k] = snap.f[k]; }
  for (const k of U8KEYS) { if (snap.b[k] === undefined) delete S[k]; else S[k] = snap.b[k]; }
  S.tick = snap.i.tick; S.massWarnT = snap.i.massWarnT; S.annRev = snap.i.annRev;
  S.trip = snap.tripRaw;
  S.repair = snap.repair === undefined ? S.repair : (snap.repair ? { ...snap.repair } : snap.repair);
  if (!S.burnEv) S.burnEv = {};
  Object.assign(S.burnEv, snap.burn);
  S.burnEv.ids = snap.burnIds.slice();
  if (!S.fireEv) S.fireEv = {};
  Object.assign(S.fireEv, snap.fire);
  for (const k of F64MAPS) {
    if (snap.maps[k] === undefined) delete S[k];
    else { if (S[k] === undefined || S[k] === null) S[k] = {}; for (const x of Object.keys(S[k])) delete S[k][x]; Object.assign(S[k], snap.maps[k]); }
  }
  for (const k of BOOLMAPS) {
    if (snap.bmaps[k] === undefined) delete S[k];
    else { if (S[k] === undefined || S[k] === null) S[k] = {}; for (const x of Object.keys(S[k])) delete S[k][x]; Object.assign(S[k], snap.bmaps[k]); }
  }
  if (!S.portShut) S.portShut = {};
  for (const x of Object.keys(S.portShut)) delete S.portShut[x];
  Object.assign(S.portShut, snap.portShut);
  if (!S.ev) S.ev = {};
  for (const x of Object.keys(S.ev)) delete S.ev[x];
  Object.assign(S.ev, snap.ev);
  if (!S.annOn) S.annOn = {};
  for (const x of Object.keys(S.annOn)) delete S.annOn[x];
  Object.assign(S.annOn, snap.annOn);
  for (const id of meta.coreIds) {
    const w = snap.vessels[id];
    if (w === undefined) { if (S.coreBy) delete S.coreBy[id]; continue; }
    if (!S.coreBy) S.coreBy = {};
    if (!S.coreBy[id]) S.coreBy[id] = {};
    const cs = S.coreBy[id];
    for (const k of [...VESSEL_F64, ...VESSEL_U8]) cs[k] = w[k];
    cs.dec = w.dec ? w.dec.slice() : w.dec;
    cs.trip = w.trip; cs.rodPos = w.rodPos;
    cs.rodZ = w.rodZ ? w.rodZ.slice() : w.rodZ;
    cs.rodZDem = w.rodZDem ? w.rodZDem.slice() : w.rodZDem;
    cs.parts = snapVal(w.parts);
  }
  for (const k of ['roomP', 'roomT', 'roomH2', 'roomM', 'roomVap']) if (S[k]) S[k].set(snap.room[k]);
  if (snap.mby === undefined) delete S.mBy;
  else {
    if (!S.mBy || !S.mBy.v) S.mBy = { v: new Float64Array(snap.mby.v.length), has: new Uint8Array(snap.mby.v.length) };
    S.mBy.v.set(snap.mby.v); S.mBy.has.set(padTo(snap.mby.has, snap.mby.v.length));
  }
  S.dmgParts.length = 0;
  for (const x of snap.dmgParts) S.dmgParts.push(x);
  for (const x of Object.keys(S.dmgWhy)) delete S.dmgWhy[x];
  Object.assign(S.dmgWhy, snap.dmgWhy);
  for (const x of Object.keys(S.massOut)) delete S.massOut[x];
  Object.assign(S.massOut, snap.massOut);
  if (S.partT) { for (const x of Object.keys(S.partT)) delete S.partT[x]; Object.assign(S.partT, snap.partT); }
  for (const k of COREAGG_PRESERVE) S[k] = snap.agg[k];
  S.parts = snap.agg.parts;
  S.dec = snap.dec ? snap.dec.slice() : snap.dec;
  M.LOG().length = snap.logLen;
  consoleWarns = snap.warns;
}
const padTo = (a, n) => { const o = Array.from(a || []); while (o.length < n) o.push(0); return o.slice(0, n); };

// ---- per-preset structural meta (must match events-probe read_meta order) ----
function dumpMeta(C) {
  const P = M.P(), D = M.D(), S = M.S();
  const GW = M.GW(), GH = M.GH(), n = GW * GH;
  u32(GW); u32(GH);
  const LPs = M.layParts();
  u32(LPs.length);
  for (const p of LPs) {
    str(p.id); i32(p.x); i32(p.y); i32(p.w); i32(p.h);
    str(p.role); str(p.name || '');
    const pb = M.pburst(p.id), pd = M.pdes(p.id), ts = M.ptsurv(p.id);
    f64(pb === null || pb === undefined ? 0 : pb);
    f64(pd === null || pd === undefined ? 0 : pd);
    f64(ts === null || ts === undefined ? 0 : ts);
    const fn = M.faceNodes(p.id) || {};
    str(fn.t || ''); str(fn.r || ''); str(fn.b || ''); str(fn.l || '');
    const m = (D.machines || {})[p.id];
    str((m && m.on) || '');
    u8(M.tankHold(p.id) ? 1 : 0);
  }
  const CHZ = M.cellHazards();
  u32(CHZ.length);
  for (const q of CHZ) {
    str(q.id); i32(q.x); i32(q.y); f64(q.lim || 0); str(q.what || '');
  }
  const coreIds = M.coreIds();
  strs(coreIds);
  str(M.primaryCore() || '');
  const cr = {};
  for (const id of coreIds) cr[id] = M.coreRated(id);
  u32(coreIds.length); for (const id of coreIds) { str(id); f64(cr[id]); }
  u32(coreIds.length); for (const id of coreIds) { str(id); u32(M.coreNB(id)); }
  const ciOf = {};
  for (const id of coreIds) ciOf[id] = M.coreCi(id);
  u32(coreIds.length); for (const id of coreIds) { str(id); i32(ciOf[id]); }
  const cis = [...new Set(Object.values(ciOf))].sort((a, b) => a - b);
  u32(cis.length); for (const ci of cis) { i32(ci); str(M.circKey(ci) || ''); }
  i32(M.coreCirc());
  u32(cis.length); for (const ci of cis) { i32(ci); f64(M.satTref(ci)); }
  u32(coreIds.length); for (const id of coreIds) { str(id); str(M.holdOf(id)); }
  u32(coreIds.length); for (const id of coreIds) { str(id); f64(M.coresTref(id)); }
  u32(coreIds.length); for (const id of coreIds) { str(id); f64(M.coresSteam(id)); }
  f64(M.Pget('TfRef')); f64(M.Pget('dnbr0'));
  const tb = M.tProgBase();
  f64(tb.tref); f64(tb.steam);
  f64(M.Pget('rated')); f64(M.Pget('flowMin')); f64(M.Pget('P0'));
  f64(M.ratedSteam()); f64(M.sgLift()); f64(M.panelThresh());
  f64(M.Pget('flowK')); f64(D.bkp || 0);
  u8(M.Pget('catcher') ? 1 : 0); u8(M.fuelInCoolant() ? 1 : 0); u8(M.Pget('vessel') ? 1 : 0);
  f64(M.waterAct());
  const sgIds = M.sgIds(), boilerIds = M.boilerIds(), pumpIds = M.pumpIds(),
    tankIds = M.tankIds(), reliefFitIds = M.reliefFitIds(), radIds = M.radIds();
  strs(sgIds); strs(boilerIds); strs(pumpIds); strs(tankIds); strs(reliefFitIds); strs(radIds);
  strs(pumpIds.filter(id => M.primaryPump(id)));
  u32(radIds.length); for (const id of radIds) { str(id); u8(M.radLive(id) ? 1 : 0); }
  str(M.primaryRelief());
  u32(tankIds.length);
  for (const id of tankIds) {
    const t = (D.tanks || {})[id] || {};
    str(id);
    u8(t.inf ? 1 : 0); u8(t.hold ? 1 : 0); u8(t.cell ? 1 : 0);
    f64(num(t.level)); f64(num(M.tankAct(id))); f64(num(M.tankKg(id)));
    u8(M.tankInField(id) ? 1 : 0);
  }
  const netKeys = M.netIndex();
  strs(netKeys);
  strs(netKeys.filter(nn => M.inCore(nn)));
  const nb = M.netN();
  u32(nb); parts.push(Buffer.from(Array.from(M.booked())));
  const runKeys = M.runKeys();
  strs(runKeys);
  const rpos = M.runPos();
  u32(runKeys.length); for (const k of runKeys) { str(k); u32(rpos[k] || 0); }
  u32(runKeys.length);
  for (const k of runKeys) {
    const r = M.runRec(k);
    str(k);
    if (!r) { u8(0); continue; }
    u8(1); str(r.k); str(r.pa); str(r.pb);
  }
  u32(runKeys.length); for (const k of runKeys) { str(k); i32(M.runTag(k)); }
  u32(runKeys.length); for (const k of runKeys) { str(k); f64(num(P.netRefByRun[k])); }
  u32(runKeys.length);
  for (const k of runKeys) {
    const b = M.steamBook(k);
    str(k);
    if (!b) { u8(0); continue; }
    u8(1); u8(b.vent ? 1 : 0); strs(b.taps); f64(b.dir); strs(b.gens); u8(b.ends ? 1 : 0);
  }
  const mo = M.matOf();
  u32(mo.length); i32a(Array.from(mo));
  const crew = M.crewRect();
  if (!crew) u8(0);
  else { u8(1); i32(crew[0]); i32(crew[1]); i32(crew[2]); i32(crew[3]); }
  const K = M.radK();
  u32(K.core.length);
  for (const t of K.core) { str(t.id); u32(t.k.length); f64a(Array.from(t.k)); }
  u32(K.sg.length);
  for (const k of K.sg) { u32(k.length); f64a(Array.from(k)); }
  u32(K.tank.length);
  for (const t of K.tank) { str(t.id); u32(t.k.length); f64a(Array.from(t.k)); }
  if (M.fuelInCoolant()) {
    const kp = M.radPipe();
    u8(1); u32(kp.length); f64a(Array.from(kp));
  } else u8(0);
  return { n, gw: GW, gh: GH, coreIds, sgIds, boilerIds, pumpIds, tankIds, runKeys, parts: LPs };
}

// ---- per-sample inputs (must match events-probe read_inputs order) ----
function dumpInputs(meta, cavIds, injIds, log0) {
  const S = M.S(), P = M.P();
  strs(cavIds); strs(injIds);
  const rf = P.runFlowH;
  const rv = rf && rf.v ? Array.from(rf.v) : [];
  u32(rv.length); f64a(rv.map(num));
  f64(M.ledgerKg()); f64(M.ledgerOut());
  f64(M.sumpKg()); f64(M.condP());
  str(M.rps()); u8(M.sinkRunback() ? 1 : 0); u8(M.runbackLive() ? 1 : 0);
  strs(M.netDry());
  u32(meta.parts.length); f64a(meta.parts.map(p => M.partSkin(p.id)));
  f64(M.panelHit()); f64(M.condFrac());
  u32(meta.sgIds.length); for (const id of meta.sgIds) { str(id); f64(M.secP(id)); }
  u32(meta.boilerIds.length); for (const id of meta.boilerIds) { str(id); f64(M.boilerLvl(id)); }
  u32(meta.coreIds.length); for (const id of meta.coreIds) { str(id); f64(M.loopp(id)); }
  u32(meta.coreIds.length); for (const id of meta.coreIds) { str(id); f64(M.contRel(id)); }
  const pc = S.repair && S.repair.id ? M.partyCells(S.repair.id) : [];
  u32(pc.length); u32a(pc);
  u32(log0);
}

// ---- state snapshot/restore, pre and post (must match read_state order) ----
function dumpState(meta, S, P) {
  for (const k of ['n', 'decay', 'heat', 'dmg', 'meltFrac', 'Tf', 'dnbr', 'vf', 'oxMax', 'qOx',
    'fatigue', 'rho', 'rodPos']) f64(fnum(S[k]));
  f64(fnum(S.parts && S.parts.xe));
  for (const k of ['P', 'Tavg', 'lvl', 'sc', 'cav', 'h2', 'injRate', 'release', 'load', 'loadDem',
    'flowNet', 'crewDose', 'dose', 'doseRate', 'repRate', 'massRes', 'massWarn',
    'roomPMax', 'roomBurnOn', 'roomFireOn', 'roomBang', 'roomMax', 'spinV', 'spinTV']) f64(fnum(S[k]));
  f64(fnum(S.burnEv && S.burnEv.kg)); f64(fnum(S.burnEv && S.burnEv.p));
  f64(fnum(S.fireEv && S.fireEv.kg)); f64(fnum(S.fireEv && S.fireEv.p)); f64(fnum(S.fireEv && S.fireEv.q));
  f64(fnum(S.repair && S.repair.t)); f64(fnum(S.repair && S.repair.need));
  for (const k of ['scrammed', 'breach', 'melt', 'rodJam', 'rodBand', 'blackout', 'turbTrip', 'condLost',
    'partySpent']) u8(S[k] ? 1 : 0);
  u8(S.burnEv && S.burnEv.blast ? 1 : 0);
  u8(S.repair ? 1 : 0);
  u8(S.bkpLost ? 1 : 0); u8(S.sgtr ? 1 : 0);
  i32(S.tick); i32(S.massWarnT); u32(S.annRev);
  str(S.trip || ''); str((S.repair && S.repair.id) || '');
  const dec = S.dec || [];
  u32(dec.length); f64a(dec.map(num));
  smap(S.tank); smap(S.massOut); smap(S.roomCrush); smap(S.roomHurt); smap(S.flowPos);
  strmapB(S.reliefOpen); strmapB(S.reliefBlocked); strmapB(S.reliefStuck); strmapB(S.reliefAuto);
  smap(S.reliefSteam);
  smap(S.flowDemBy); smap(S.lvlBy); smap(S.scBy); smap(S.TavgBy);
  strmapB(S.sgBurst);
  strs(Object.keys(S.portShut || {}).filter(k => S.portShut[k]).sort());
  const ev = S.ev || {};
  u32(Object.keys(ev).length);
  for (const k of Object.keys(ev)) { str(k); u8(ev[k] ? 1 : 0); }
  const ao = S.annOn || {};
  u32(Object.keys(ao).length);
  for (const k of Object.keys(ao)) { str(k); u8(ao[k] ? 1 : 0); }
  strs(S.dmgParts || []);
  const dw = S.dmgWhy || {};
  u32(Object.keys(dw).length);
  for (const k of Object.keys(dw)) { str(k); str(dw[k]); }
  const n = meta.n;
  for (const k of ['roomP', 'roomT', 'roomH2', 'roomM', 'roomVap']) {
    const a = S[k];
    if (!a) f64a(new Array(n).fill(0));
    else f64a(Array.from(a, Number));
  }
  u32(meta.coreIds.length);
  for (const id of meta.coreIds) {
    const cs = S.coreBy && S.coreBy[id];
    if (!cs) { console.error('vessel missing for ' + id); process.exit(2); }
    str(id);
    for (const k of ['n', 'decay', 'dmg', 'meltFrac']) f64(fnum(cs[k]));
    const dc = cs.dec || [];
    u32(dc.length); f64a(dc.map(num));
    for (const k of ['Tf', 'dnbr', 'vf', 'oxMax', 'qOx', 'fatigue']) f64(fnum(cs[k]));
    u8(cs.scrammed ? 1 : 0); u8(cs.breach ? 1 : 0); u8(cs.melt ? 1 : 0);
    str(cs.trip || '');
    f64(fnum(cs.rodPos));
    u8(cs.rodJam ? 1 : 0); u8(cs.rodBand ? 1 : 0);
    f64(fnum(cs.rho)); f64(cs.parts ? fnum(cs.parts.xe) : NaN); f64(fnum(cs.tilt));
    const rz = cs.rodZ || [];
    u32(rz.length); f64a(rz.map(num));
    const rzd = cs.rodZDem || [];
    u32(rzd.length); f64a(rzd.map(num));
    f64(fnum(cs.tiltDem)); f64(fnum(cs.rodDem));
  }
  strs((S.burnEv && S.burnEv.ids) || []);
  const h = S.mBy;
  if (!h || !h.v) u32(0);
  else {
    u32(h.v.length);
    parts.push(Buffer.from(padTo(Array.from(h.has || []), h.v.length).map(v => v ? 1 : 0)));
    f64a(Array.from(h.v, Number));
  }
}

const SEVMAP = { alarm: 0, warn: 1, info: 2 };
function mapEvent(e) {
  for (const code of Object.keys(EVMSG)) {
    const [sev, pat] = EVMSG[code];
    if (e.sev !== sev) continue;
    if (e.msg.startsWith(pat)) return [SEVMAP[sev], +code];
  }
  console.error('unmapped events log: ' + e.sev + ' ' + e.msg);
  process.exit(2);
}

// One sample: snapshot pre, dump inputs, run the REAL 9-fn tail,
// encode expected, dump post, restore.
function runSample(meta, tag, mut) {
  const S = M.S(), P = M.P();
  const clean = snapState(meta);
  let cleanup = null;
  if (mut) cleanup = mut(S, P) || null;
  let cavIds = M.tickCav(), injIds = M.tickInj();
  if (mut && mut.cavIds) cavIds = mut.cavIds;
  if (mut && mut.injIds) injIds = mut.injIds;
  u32(tag); f64(DT);
  if (process.env.GATE_DEBUG) console.error('sample tag=' + tag + ' inputs');
  const log0 = M.LOG().length;
  const cg0 = consoleWarns;
  dumpInputs(meta, cavIds, injIds, log0);
  if (process.env.GATE_DEBUG) console.error('sample tag=' + tag + ' state');
  dumpState(meta, S, P);
  if (process.env.GATE_DEBUG) console.error('sample tag=' + tag + ' fns');
  M.coreSeenReset();
  const runFlow = P.runFlowH;
  M.radDoseStep(S, DT);
  M.blastStep(S, DT);
  M.overpressureStep(S);
  M.burnFireStep(S);
  M.cookStep(S, DT);
  M.evLatchStep(S, cavIds, injIds);
  // tripNear() reads live damage-adjacent state at annStep time (end of
  // evLatch: its coreAgg recomputes s.scrammed, which tripNear bails on), so
  // capture here - the latches after annStep touch only E.*. Streamed after
  // post-state (probe reads want before replaying, so a mid-stream slot
  // would misalign).
  const tripNearMid = M.tripNear() ? 1 : 0;
  M.repairStep(S, DT);
  M.flowSpinStep(S, DT, runFlow);
  const ledgM0 = M.ledgerKg(), ledgO0 = M.ledgerOut();
  M.ledgerStep(S, DT, ledgM0, ledgO0);
  if (process.env.GATE_DEBUG) console.error('sample tag=' + tag + ' tail done');
  dumpState(meta, S, P);
  u8(tripNearMid);
  const evs = M.LOG().slice(log0).map(mapEvent);
  const warns = consoleWarns - cg0;
  u32(evs.length);
  for (const [sv2, code] of evs) { u8(sv2); u32(code); }
  u32(warns);
  restoreState(meta, clean);
  if (cleanup) cleanup();
  return 1;
}

const presetNames = [];
const presets = [];
let nSamples = 0;
const skipped = { noNet: 0, synthSkip: 0 };
const fd = fs.openSync(fIn, 'w');
const writeParts = () => { for (const b of parts) fs.writeSync(fd, b); parts = []; };
{
  const np = Object.keys(M.PRE()).length;
  const hb = Buffer.alloc(8);
  hb.writeUInt32LE(np, 0); hb.writeUInt32LE(1, 4);
  fs.writeSync(fd, hb);
}

for (const k of Object.keys(M.PRE())) {
  if (process.env.GATE_DEBUG) console.error('preset ' + k + ' start');
  M.plantPreset(+k); M.buildLayout(); M.commission();
  M.S().diceOff = true;
  M.S().seed = M.S().rng = (123456789 + 1000003 * +k) >>> 0;
  presetNames.push(M.PRE()[k][0]);
  const C = assertConsts();
  const meta = dumpMeta(C);
  meta.presetIdx = presetNames.length - 1;
  const nsAt = parts.length;
  const P = { n: 0 };
  for (let t = 0; t < TICKS; t++) {
    if (process.env.GATE_DEBUG) console.error('preset ' + k + ' tick ' + t);
    M.step(DT);
    if (t < 1) continue;
    if (!M.P().net) { skipped.noNet++; continue; }
    if ((t - 1) % 30 === 0 && !process.env.NOSAMPLE) { nSamples += runSample(meta, 0, null); P.n++; }
  }
  const D = M.D();
  const partByRole = role => (meta.parts.find(p => p.role === role) || {}).id;
  const hazByPrefix = pre => (M.cellHazards().find(q => q.id.indexOf(pre) === 0) || {}).id;
  const synths = [
    ['blastAll', s => {
      s.roomPMax = 1e6; s.roomBurnOn = 1;
      for (const q of M.cellHazards()) s.roomP[q.y * meta.gw + q.x] += 500;
    }],
    ['crushTrip', s => {
      const ids = meta.parts.slice(0, 2).map(p => p.id).concat([hazByPrefix('pipe:'), hazByPrefix('port:'), hazByPrefix('mat:')].filter(Boolean));
      for (const id of ids) s.roomCrush[id] = 0.999;
      s.roomPMax = 1e6;
      for (const q of M.cellHazards()) s.roomP[q.y * meta.gw + q.x] += 500;
    }],
    ['overpressure', s => { s.P = 1000; }],
    ['burnClose', s => {
      s.burnEv = { kg: 10, p: 500, blast: 0, ids: [] };
      s.fireEv = { kg: 10, p: 5, q: 1e6 };
      s.roomBurnOn = 0; s.roomFireOn = 0;
    }],
    ['burnOpen', s => {
      s.burnEv = { kg: 10, p: 500, blast: 0, ids: [] };
      s.roomBurnOn = 1;
    }],
    ['cookAll', s => {
      if (!s.partT) s.partT = {};
      for (const p of meta.parts) s.partT[p.id] = 2000;
      if (s.roomT) for (let i = 0; i < s.roomT.length; i++) s.roomT[i] = 2000;
    }],
    ['cookTrip', s => {
      const ids = meta.parts.slice(0, 2).map(p => p.id).concat([hazByPrefix('pipe:')].filter(Boolean));
      for (const id of ids) s.roomHurt[id] = 0.999;
      if (s.roomT) for (let i = 0; i < s.roomT.length; i++) s.roomT[i] = 2000;
    }],
    ['flagsA', s => {
      s.n = 1.2; s.dnbr = 0.9;
      for (const id of meta.coreIds) { const cs = s.coreBy && s.coreBy[id]; if (cs) { cs.scrammed = true; } }
      s.rodPos = 1; s.rho = 0; s.cav = 0.5;
      if (!s.flowDemBy) s.flowDemBy = {};
      for (const id of meta.pumpIds) s.flowDemBy[id] = 0;
      s.P = (M.Pget('P0') || 15) * 1.1;
      const rfids = M.reliefFitIds();
      if (rfids.length) { if (!s.reliefOpen) s.reliefOpen = {}; s.reliefOpen[rfids[0]] = true; }
      s.vf = 0.3; s.doseRate = 2;
    }],
    ['flagsB', s => {
      for (const id of meta.coreIds) {
        const cs = s.coreBy && s.coreBy[id]; if (!cs) continue;
        cs.dmg = 50; cs.breach = true; cs.melt = true; cs.meltFrac = 0.3;
        cs.n = 1.2; cs.dnbr = 0.9; cs.rodJam = true; cs.fatigue = 60;
      }
      s.parts = { xe: -4000 };
      s.crewDose = 60; s.h2 = 99; s.qOx = 9999;
      if (s.roomH2) for (let i = 100; i < 200 && i < s.roomH2.length; i++) s.roomH2[i] += 50;
      s.roomBurnOn = 1; s.roomFireOn = 1; s.blackout = true; s.turbTrip = true;
      for (const id of meta.sgIds) { if (!s.sgBurst) s.sgBurst = {}; s.sgBurst[id] = true; }
    }],
    ['evSeed', s => {
      if (!s.ev) s.ev = {};
      for (const kk of ['hipow', 'dnbr13', 'scram', 'norps', 'd1', 'melt']) s.ev[kk] = true;
      if (!s.annOn) s.annOn = {};
      for (const kk of Object.keys(s.annOn)) s.annOn[kk] = 0;
      s.tick -= ((s.tick % 5) + 5) % 5;
    }],
    ['ledger', s => {
      if (!s.massOut) s.massOut = {};
      s.massOut.__test = 0.001;
      s.massWarn = 0; s.massWarnT = 0;
    }],
    ['rad', s => {
      s.release = 5; s.sgtr = true; s.dose = 10;
      for (const id of meta.tankIds) { if (!s.tank) s.tank = {}; s.tank[id] = 100; }
      const pid = partByRole('pump') || partByRole('core') || meta.parts[0].id;
      s.repair = { t: 0, need: 99999, id: pid };
    }],
    ['stuck', s => {
      const rfids = M.reliefFitIds();
      const fid = rfids[0];
      if (!fid) return false;
      if (!s.reliefOpen) s.reliefOpen = {};
      if (!s.reliefAuto) s.reliefAuto = {};
      if (!s.reliefStuck) s.reliefStuck = {};
      s.reliefOpen[fid] = true; s.reliefAuto[fid] = true; s.reliefStuck[fid] = true;
    }],
  ];
  // repair synths: one per DMGFX row present, plus dose paths
  const dmgRows = [
    ['core', meta.coreIds[0]], ['rods', meta.coreIds[0]],
    ['turb', partByRole('turb')], ['cond', partByRole('cond')],
    ['bkp', partByRole('bkp')], ['tank', partByRole('tank')],
    ['sg', partByRole('sg')], ['pump', partByRole('pump')],
    ['radiator', partByRole('radiator')], ['ctrl', partByRole('ctrl')],
    ['pipe', hazByPrefix('pipe:')], ['port', hazByPrefix('port:')], ['mat', hazByPrefix('mat:')],
  ];
  for (const [row, id] of dmgRows) {
    if (!id) { continue; }
    synths.push(['repair-' + row, ((rid) => (s => {
      s.repair = { t: 0, need: 1e-6, id: rid };
      if (!s.dmgParts) s.dmgParts = [];
      if (s.dmgParts.indexOf(rid) < 0) s.dmgParts.push(rid);
      if (!s.dmgWhy) s.dmgWhy = {};
      s.dmgWhy[rid] = 'SYNTH';
    }))(id)]);
  }
  synths.push(['repair-doseout', s => {
    const id = meta.coreIds[0] || (meta.parts[0] && meta.parts[0].id);
    if (!id) return false;
    s.repair = { t: 0, need: 1e9, id };
    if (!s.dmgParts) s.dmgParts = [];
    if (s.dmgParts.indexOf(id) < 0) s.dmgParts.push(id);
    s.dose = 100; s.partySpent = false;
  }]);
  synths.push(['injForce', Object.assign((s => { s.injRate = 5; }), {
    injIds: meta.tankIds.slice(0, 2), cavIds: meta.pumpIds.slice(0, 1),
  })]);
  let tag = 1;
  for (const [, mut] of synths) {
    const preS = snapState(meta);
    const r = mut(M.S(), M.P());
    if (r === false) { restoreState(meta, preS); skipped.synthSkip++; tag++; continue; }
    restoreState(meta, preS);
    if (typeof r === 'function') r();
    nSamples += runSample(meta, tag, mut);
    P.n++;
    tag++;
  }
  parts.splice(nsAt, 0, u32b(P.n));
  presets.push(P);
  writeParts();
}
fs.closeSync(fd);

const CARGO = (() => {
  try {
    const p = path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
    fs.accessSync(p); return p;
  } catch { return 'cargo'; }
})();
const out = execFileSync(CARGO, ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'events-probe', '--', fIn],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RUSTUP_TOOLCHAIN: '1.89.0-x86_64-pc-windows-gnu' } });
console.log(out.trim());
console.log('skipped=' + JSON.stringify(skipped));
const pass = /FAILURES=0/.test(out);
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'events-baseline.json'), JSON.stringify({
    presets: presetNames, ticks: TICKS, samples: nSamples,
  }, null, 1) + '\n');
}
if (!process.env.KEEP_TMP) fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
