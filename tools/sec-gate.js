#!/usr/bin/env node
// node tools/sec-gate.js [--ticks N] — §6.6 sec gate: actuator follows,
// burst dice, pressRead/pcore/spill/tankRate/inv, cav/pumps, SG heat, hold +
// primary relief, rupture disc + tank wreck, books + tank rules, SGTR +
// sodium reaction, margin loop, cond/turb latches, secondary vents, SG
// shells + drums, cond vent, turbine, radiator panels, secondary tanks.
// The probe replica drives the REAL extracted fns in tick order (dumper
// replicates, never reimplements); dump-kit inputs: solved outs as resolved
// values, field bags, transport artifacts, piece masks, structural tables.
// Dead tick-locals (`dump`, `flowFrac`, `spillSecKg`, `vented`,
// `boiled`/`boilQ`) are not compared. Bar: discrete/event exact, floats at
// sdig semantics (`pow`/`exp` flow through the UA laws). Writes
// tools/sec-baseline.json on pass.
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
const KEYS = ['A', 'B', 'C', 'tc', 'rhoc', 'p0', 'T0', 'n', 'pFloor', 'TFloor',
  'hfg', 'rho', 'cp', 'mu', 'muV', 'solidK', 'Tref'];

const M = headless('{PRE:()=>PLANTPRE,plantPreset,buildLayout,commission,P:()=>P,S:()=>S,D:()=>D,LAY:()=>LAY,step,' +
  'actFollow:(s,dt)=>actFollow(s,dt),boronFollow:(s,dt)=>boronFollow(s,dt),' +
  'pcoreStep:(s,p)=>pcoreStep(s,p),pressRead:(s,dt)=>pressRead(s,dt),' +
  'spillStep:(s,o)=>spillStep(s,o),tankRateStep:(s,o)=>tankRateStep(s,o),' +
  'burstDice:(s,dt,p)=>burstDice(s,dt,p),invStep:(s)=>invStep(s),' +
  'cavStep:(s,dt,p)=>cavStep(s,dt,p),pumpQStep:(s,r)=>pumpQStep(s,r),pumpCoastStep:(s,dt)=>pumpCoastStep(s,dt),' +
  'sgHeatStep:(s,dt,r,o,k,h)=>sgHeatStep(s,dt,r,o,k,h),holdReliefStep:(s,dt,p,o)=>holdReliefStep(s,dt,p,o),' +
  'discTankStep:(s,dt)=>discTankStep(s,dt),bookTailStep:(s,i)=>bookTailStep(s,i),' +
  'sgtrStep:(s,dt,o)=>sgtrStep(s,dt,o),marginStep:(s,p,h,k)=>marginStep(s,p,h,k),' +
  'condTurbStep:(s)=>condTurbStep(s),secVentStep:(s,dt,o)=>secVentStep(s,dt,o),' +
  'shellStep:(s,dt,o,v)=>shellStep(s,dt,o,v),condVentStep:(s,dt)=>condVentStep(s,dt),' +
  'turbStep:(s,o,c,b)=>turbStep(s,o,c,b),radPanelStep:(s,dt,r)=>radPanelStep(s,dt,r),secTankStep:(s,dt)=>secTankStep(s,dt),' +
  'DGEN:()=>DGEN,GW:()=>GW,GH:()=>GH,MPC:()=>MPC,LOG:()=>LOG,' +
  'ADV:()=>advectEdgeKg,ADL:(i)=>advectLanded(i),AOP:()=>advectOutPri,AOS:()=>advectOutSec,' +
  'HB:()=>HEATBAL,loopKg:()=>loopKg(),coreDT0:()=>coreDT0(),steamRise:()=>steamRise(),roomSteamH:()=>roomSteamH(),' +
  'condPDes:()=>condPDes(),PROMPT_F:()=>PROMPT_F,VALVE_RATE:()=>VALVE_RATE,LOAD_TAU:()=>LOAD_TAU,' +
  'FLOW_TAU:()=>FLOW_TAU,PUMP_FRIC_S:()=>PUMP_FRIC_S,CAV_TAU:()=>CAV_TAU,CAV_SPAN:()=>CAV_SPAN,' +
  'BOR_IN:()=>BOR_IN,BOR_OUT:()=>BOR_OUT,CORE_DT_QMIN:()=>CORE_DT_QMIN,COND_P0:()=>COND_P0,COND_ATM:()=>COND_ATM,' +
  'TURB_TRIP_P:()=>TURB_TRIP_P,TURB_RESET_K:()=>TURB_RESET_K,RAD_TDES:()=>RAD_TDES,T_SPACE:()=>T_SPACE,' +
  'SGTR_RATE:()=>SGTR_RATE,HOT_DUMP:()=>HOT_DUMP,UA_FLOW:()=>UA_FLOW,H_DATUM:()=>H_DATUM,' +
  'TANK_RATE_REF:()=>TANK_RATE_REF,T_FEED:()=>T_FEED,NET_DT:()=>NET_DT,SG_BURST_K:()=>SG_BURST_K,' +
  'PIPE_BURST_K:()=>PIPE_BURST_K,PORV_LIFT_K:()=>PORV_LIFT_K,PORV_RESEAT_K:()=>PORV_RESEAT_K,' +
  'LEDGER_EPS:()=>LEDGER_EPS,LEDGER_QUIET:()=>LEDGER_QUIET,CP_STEEL:()=>CP_STEEL,DRY_MIN_KG:()=>DRY_MIN_KG,' +
  'SG_EFW_OFF:()=>SG_EFW_OFF,SG_DRY:()=>SG_DRY,SGL_SET:()=>SGL_SET,SG_DOME:()=>SG_DOME,' +
  'coreIds:()=>coreIds(),pumpIds:()=>pumpIds(),boilerIds:()=>boilerIds(),sgIds:()=>sgIds(),drumIds:()=>drumIds(),' +
  'condIds:()=>condIds(),condSinks:()=>condSinks(),radIds:()=>radIds(),ihxIds:()=>ihxIds(),' +
  'secTankIds:()=>secTankIds(),holdTankIds:()=>holdTankIds(),tankIds:()=>tankIds(),' +
  'reliefFitIds:()=>reliefFitIds(),reliefPriIds:()=>reliefPriIds(),reliefSecIds:()=>reliefSecIds(),' +
  'primaryPump:(id)=>primaryPump(id),pumpResOf:(id)=>pumpResOf(id),pumpSucNode:(id)=>pumpSucNode(id),' +
  'pumpEdgeKey:(id)=>pumpEdgeKey(id),pumpRotor:(id)=>pumpRotor(id),' +
  'tankFluidAct:(id)=>tankFluid(id).act,tankInField:(id)=>tankInField(id),tankPrimary:(id)=>tankPrimary(id),' +
  'tankKg:(id)=>tankKg(id),reliefSet:(fid)=>{const s=reliefSet(fid); return [s.lift,s.reseat];},' +
  'fitSpring:(fid)=>fitSpring(fid),hasTarget:(fid)=>!!(P.net.fitTarget&&P.net.fitTarget[fid]),' +
  'loopOf:(id)=>loopOf(id),inCore:(nm)=>nodeGraph().inCore(nm),' +
  'coreCirc:()=>nodeGraph().coreCirc,coreCircs:()=>nodeGraph().coreCircs,' +
  'circOfNode:(nm)=>circOfNode(nm),coreOnCirc:(ci)=>coreOnCirc(ci),holdOnCirc:(ci)=>holdOnCirc(ci),' +
  'holdCircs:()=>holdCircs(),' +
  'tankCircuit:(id)=>tankCircuit(id),coreCircOf:(id)=>coreCircOf(id),primaryCore:()=>primaryCore(),' +
  'foldMap:()=>foldMap(),partOf:(id)=>{const p=partOf(id); return p?{id:p.id,role:p.role,x:p.x,y:p.y,w:p.w,h:p.h}:null;},' +
  'shellsOf:(fid)=>shellsOf(fid),shellsLive:(s,fid)=>shellsLive(s,fid),' +
  'shellNode:(id)=>shellNode(id),shellCirc:(id)=>shellCirc(id),sgPrimCirc:(id)=>sgPrimCirc(id),' +
  'reliefNodeOf:(net,fid)=>reliefNodeOf(net,fid),' +
  'primFaces:(id)=>{const IN=roleIns(partOf(id))[0]; return IN?[IN.a,IN.b]:null;},' +
  'holdLineSet:()=>holdLineSet(),isDrum:(id)=>isDrum(id),' +
  'pipeNetwork:()=>pipeNetwork(),runBurstP:(r)=>runBurstP(r),runNodeOf:(key)=>runNodeOf(key),' +
  'matTight:(k)=>{const m=matRow(D.mat[k].m); return !!m.tight;},' +
  'matBurstP:(x,y)=>matBurstP(x,y),FIRE:()=>FIRE,' +
  'circBurn:(ci)=>{const c=satOfCirc(ci); return c.burn||"";},' +
  'matRegions:()=>{const g=matRegions(); return {of:Array.from(g.of), n:g.regions.length};},' +
  'roleOfCond:()=>roleOf("cond"),condPDes:()=>condPDes(),condVesNode:(id)=>condVesNode(id),' +
  'boilerNode:(id)=>boilerNode(id),boilerCirc:(id)=>boilerCirc(id),feedNode:(id)=>feedNode(id),' +
  'sgDesignP:(id)=>sgDesignP(id),sgMassOf:(id)=>sgMassOf(id),sgBurstP:(id)=>sgBurstP(id),' +
  'sgActive:(id)=>sgActive(id),sgtrLive:(s,id)=>sgtrLive(s,id),' +
  'stageKeysOf:(id)=>stageKeysOf(id),stageInNbr:(s,id,k)=>{stageInNode(s,id,k); const nb=P.net.sgInNbr[id]; return nb?(nb[k]||[]):[];},' +
  'sgtrKeyOf:(id)=>sgtrKeyOf(id),ventKeyOf:(fid)=>ventKeyOf(fid),breakKeyOf:(id)=>breakKeyOf(id),' +
  'outKeysOf:(net)=>outKeysOf(net),flowMapsOf:(net)=>{const m=flowMapsOf(net); return {byKeys:m.byKeys,byPos:[...m.byPos],sgtrKeys:m.sgtrKeys,sgtrPos:[...m.sgtrPos]};},' +
  'satOfCirc:(ci)=>satOfCirc(ci),satWater:()=>SAT_WATER,' +
  'satBurn:(ci)=>{const c=satOfCirc(ci); return (c&&c.burn)||null;},' +
  'holdSetP:(ci)=>holdSetP(ci),circSetP:(nm)=>circSetP(nm),' +
  'condInA:(id)=>{const IN=condIN(id); return IN?IN.a:"";},' +
  'condVacuum:(id)=>condVacuum(id),condVolOf:(id)=>condVolOf(id),' +
  'cwPathsOf:(id)=>cwPathsOf(id).map(q=>({key:q.key,a:q.a,b:q.b})),' +
  'radUAOf:(id)=>radUAOf(id),radMass:(id)=>radMass(id),partVol:(id)=>partVol(id),' +
  'radCoatEmis:(id)=>radCoatOf(id).emis,radArea:(id)=>radArea(id),' +
  'tickRadKey:(id)=>tickRadKey(id),radInternal:()=>{const IN=ROLE.radiator.internal; return [IN.a,IN.b];},' +
  'radLive:(id)=>radLive(id),ihxUAOf:(id)=>ihxUAOf(id),' +
  'sgUAOf:(id)=>sgUAOf(id),tankP:(s,tid)=>{const t=D.tanks[tid]; return tankP(s,tid,t.hold?netPieces(P.net,s):undefined);},' +
  'holdLive:(s,ci)=>{const pc=netPieces(P.net,s); return holdLive(P.net,s,ci,pc)?1:0;},' +
  'stageFed:(s,id)=>stageFed(P.net,s,id)?1:0,' +
  'netPiecesOf:(s)=>Array.from(netPieces(P.net,s).of),' +
  'corePiecesOf:(s)=>{const pc=netPieces(P.net,s); return [...corePieces(P.net,s,pc)];},' +
  'netBooked:()=>Array.from(netBooked(P.net)),' +
  'inLoop:(ci,nm)=>inLoop(ci,nm)?1:0,loopNodes:(ci)=>{const s=loopNodes(ci); return s?[...s]:null;},' +
  'exhOpen:(s)=>exhOpen(s)?1:0,roleTurbAlive:()=>roleAlive("turb",S),' +
  'contRelPart:(s,pid)=>contRelPart(s,partOf(pid)),' +
  'advLandedSet:(i,v)=>{advectLandedBy[i]=v;},' +
  'outsNum:(o,i,l)=>outsNum(o,i,l),outsBag:(o,a,b,c,k)=>outsBag(o,a,b,c,k),outKg:(net,k)=>outKgOf(net,k),' +
  'bumpRoomPGen:()=>{roomPGen++;}}');

const num = v => (v === undefined || v === null) ? NaN : v;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-gate-'));
const fIn = path.join(tmp, 'sec.bin');
const parts = [];
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); parts.push(b); };
const i32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); };
const f64 = v => { const b = Buffer.alloc(8); b.writeDoubleLE(v); parts.push(b); };
const f64a = a => { for (const v of a) f64(v); };
const u8 = v => parts.push(Buffer.from([v ? 1 : 0]));
const u8a = a => parts.push(Buffer.from(Array.from(a).map(v => v ? 1 : 0)));
const i32a = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeInt32LE(a[i], i * 4); parts.push(b); };
const str = s => { const b = Buffer.from(String(s === undefined || s === null ? '' : s), 'utf8'); u32(b.length); parts.push(b); };
const strsRaw = a => { for (const s of a) str(s); };
const strs = a => { u32(a.length); strsRaw(a); };
const u8an = a => { u32(a.length); u8a(a); };
const f64an = a => { u32(a.length); f64a(a); };
const i32an = a => { u32(a.length); i32a(a); };
const u32an = a => { u32(a.length); const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeUInt32LE(a[i] >>> 0, i * 4); parts.push(b); };
const strmap = m => { const ks = Object.keys(m || {}).filter(k => m[k] !== undefined); u32(ks.length); for (const k of ks) { str(k); f64(m[k]); } };

// event codes mirrored from sim-rs/src/tick.rs; gate maps code -> [sev, msg prefix/suffix]
const EVMSG = {
  1: ['alarm', 'PIPE BURST / '], 2: ['alarm', 'CONTAINMENT FAILURE / '],
  3: ['alarm', ' SHELL BURST', 1], 4: ['alarm', ' DISC BURST', 1],
  5: ['alarm', 'CONDENSER VACUUM LOST'], 6: ['alarm', 'TURBINE TRIP'],
  7: ['info', 'TURBINE RELATCHED'], 8: ['warn', 'STEAM GOING OVERBOARD'],
  9: ['warn', ' LIFTED', 1],
};

// ---- const assertion (fails fast, like the core gate's 72) ----
function assertConsts() {
  const P = M.P();
  const want = {
    VALVE_RATE: M.VALVE_RATE(), LOAD_TAU: M.LOAD_TAU(), FLOW_TAU: M.FLOW_TAU(),
    PUMP_FRIC_S: M.PUMP_FRIC_S(), CAV_TAU: M.CAV_TAU(), CAV_SPAN: M.CAV_SPAN(),
    BOR_IN: M.BOR_IN(), BOR_OUT: M.BOR_OUT(), CORE_DT_QMIN: M.CORE_DT_QMIN(),
    COND_P0: M.COND_P0(), COND_ATM: M.COND_ATM(), TURB_TRIP_P: M.TURB_TRIP_P(),
    TURB_RESET_K: M.TURB_RESET_K(), RAD_TDES: M.RAD_TDES(), T_SPACE: M.T_SPACE(),
    SGTR_RATE: M.SGTR_RATE(), HOT_DUMP: M.HOT_DUMP(), UA_FLOW: M.UA_FLOW(),
    H_DATUM: M.H_DATUM(), TANK_RATE_REF: M.TANK_RATE_REF(), T_FEED: M.T_FEED(),
    NET_DT: M.NET_DT(), SG_BURST_K: M.SG_BURST_K(), PIPE_BURST_K: M.PIPE_BURST_K(),
    PORV_LIFT_K: M.PORV_LIFT_K(), PORV_RESEAT_K: M.PORV_RESEAT_K(),
    LEDGER_EPS: M.LEDGER_EPS(), LEDGER_QUIET: M.LEDGER_QUIET(), CP_STEEL: M.CP_STEEL(),
    DRY_MIN_KG: M.DRY_MIN_KG(), SG_EFW_OFF: M.SG_EFW_OFF(), SG_DRY: M.SG_DRY(),
    SGL_SET: M.SGL_SET(), SG_DOME: M.SG_DOME(), PROMPT_F: M.PROMPT_F(),
    MPC: M.MPC(),
  };
  const ref = {
    VALVE_RATE: 1 / 17, LOAD_TAU: 2, FLOW_TAU: 5, PUMP_FRIC_S: 60,
    CAV_TAU: 1.5, CAV_SPAN: 12, BOR_IN: 60, BOR_OUT: 35, CORE_DT_QMIN: 0.004,
    COND_P0: 0.004, COND_ATM: 0.101, TURB_TRIP_P: 0.02, TURB_RESET_K: 0.75,
    RAD_TDES: 307, T_SPACE: 3, SGTR_RATE: 0.30, HOT_DUMP: 1.6, UA_FLOW: 0.8,
    H_DATUM: 273.15, TANK_RATE_REF: 2.6, T_FEED: 490, NET_DT: 0.02,
    SG_BURST_K: 1.5, PIPE_BURST_K: 1.5, PORV_LIFT_K: 1.06, PORV_RESEAT_K: 1.01,
    LEDGER_EPS: 1e-7, LEDGER_QUIET: 30, CP_STEEL: 0.5, DRY_MIN_KG: null,
    SG_EFW_OFF: 40, SG_DRY: 25, SGL_SET: 50, SG_DOME: 1.6, PROMPT_F: 0.935,
    MPC: 1.4 / 3,
  };
  for (const k of Object.keys(ref)) {
    if (ref[k] === null) { if (!(want[k] > 0)) { console.error('const ' + k + ' missing'); process.exit(2); } continue; }
    if (want[k] !== ref[k]) { console.error('const ' + k + ' = ' + want[k] + ' want ' + ref[k]); process.exit(2); }
  }
  return want;
}

// ---- per-preset structural meta (must match sec-probe read_meta order) ----
function dumpMeta(C) {
  const P = M.P(), D = M.D(), S = M.S(), net = P.net;
  const coreIds = M.coreIds();
  strs(coreIds); // strsn
  i32a(coreIds.map(id => M.coreCircOf(id)));
  f64a(coreIds.map(id => num(P.cores[id].invKg0)));
  const nCirc = Math.max(0, ...coreIds.map(id => M.coreCircOf(id))) + 1;
  u32(nCirc);
  for (let ci = 0; ci < nCirc; ci++) {
    const ks = M.coreOnCirc(ci).concat(M.holdOnCirc(ci));
    str(ks.length ? ks[0] : '');
  }
  i32(M.coreCirc());
  u8an([...Array(nCirc).keys()].map(ci => (M.coreCircs()[ci] ? 1 : 0)));
  f64(P.backup);
  // NOTE: pressRead/marginStep iterate holdCircs(), NOT hold-tank circuits.
  const holdCircs = M.holdCircs();
  u32(holdCircs.length); i32a(holdCircs);
  u32(nCirc);
  for (let ci = 0; ci < nCirc; ci++) { const l = M.holdOnCirc(ci); u32(l.length); strsRaw(l); }
  const drumIds = M.drumIds(), boilerIds = M.boilerIds(), sgIds = M.sgIds();
  strs(drumIds);
  strs(boilerIds);
  strs(sgIds);
  u32(sgIds.length); i32a(sgIds.map(id => M.loopOf(id) === null ? -1 : M.loopOf(id)));
  const pumpIds = M.pumpIds();
  strs(pumpIds);
  u8a(pumpIds.map(id => M.primaryPump(id) ? 1 : 0));
  for (const id of pumpIds) {
    const r = M.pumpResOf(id); strs(r);
    str(M.pumpSucNode(id) || ''); str(M.pumpEdgeKey(id) || '');
  }
  f64a(pumpIds.map(id => M.pumpRotor(id)));
  const partIds = M.LAY().parts.map(p => p.id);
  strs(partIds);
  f64(C.SG_EFW_OFF); f64(C.SG_DRY); f64(C.SGL_SET); f64(C.SG_DOME);
  strsRaw(boilerIds.map(id => M.boilerNode(id)));
  u32(boilerIds.length); i32a(boilerIds.map(id => M.boilerCirc(id)));
  strsRaw(boilerIds.map(id => M.feedNode(id)));
  // sgtrLive is state-dependent (partWrecked): computed in Rust from dmgParts, not dumped.
  u32(net.edges.length);
  i32a(net.edges.map(e => e.gasAt === undefined ? -1 : e.gasAt));
  i32a(net.edges.map(e => e.u));
  strs(net.edges.map(e => e.kind || ''));
  strs(net.edges.map(e => e.key || ''));
  const condIds = M.condIds(), condSinks = M.condSinks();
  strs(condSinks.map(id => M.breakKeyOf(id)));
  const tankIds = M.tankIds();
  strs(tankIds.map(id => D.tanks[id].auto || 'manual'));
  strs(condIds);
  strs(condSinks);
  for (const id of condIds) str(M.condInA(id));
  u8a(condIds.map(id => M.condVacuum(id) ? 1 : 0));
  f64a(condIds.map(id => M.condVolOf(id)));
  for (const id of condIds) {
    const qs = M.cwPathsOf(id);
    u32(qs.length);
    for (const q of qs) { str(q.key); str(q.a); str(q.b); }
  }
  const radIds = M.radIds();
  strs(radIds);
  f64a(radIds.map(id => M.radUAOf(id)));
  f64a(radIds.map(id => M.radMass(id)));
  f64a(radIds.map(id => M.partVol(id)));
  f64a(radIds.map(id => M.radCoatEmis(id)));
  f64a(radIds.map(id => M.radArea(id)));
  strsRaw(radIds.map(id => M.tickRadKey(id)));
  for (const id of radIds) { const [a, b] = M.radInternal(); str(a); str(b); }
  u8a(radIds.map(id => M.radLive(id) ? 1 : 0));
  const ihxIds = M.ihxIds();
  strs(ihxIds);
  f64a(ihxIds.map(id => M.ihxUAOf(id)));
  u8a(boilerIds.map(id => M.isDrum(id) ? 1 : 0));
  u8a(ihxIds.map(id => M.sgActive(id) ? 1 : 0));
  f64(C.PROMPT_F);
  // sgQAt reads the live (P.sgUABy[id] || P.sgUA), which can lag sgUAOf.
  f64a(sgIds.map(id => num((P.sgUABy && P.sgUABy[id]) || P.sgUA)));
  f64a(sgIds.map(id => M.sgDesignP(id)));
  f64a(sgIds.map(id => M.sgMassOf(id)));
  f64a(sgIds.map(id => M.sgBurstP(id)));
  u8a(sgIds.map(id => M.sgActive(id) ? 1 : 0));
  strsRaw(sgIds.map(id => M.shellNode(id)));
  u32(sgIds.length); i32a(sgIds.map(id => M.shellCirc(id)));
  u32(sgIds.length); i32a(sgIds.map(id => M.sgPrimCirc(id)));
  {
    const ids = sgIds.filter(id => M.primFaces(id));
    u32(ids.length);
    for (const id of ids) { const [a, b] = M.primFaces(id); str(id); str(a); str(b); }
  }
  f64(M.DRY_MIN_KG()); f64(P.dose);
  u8an(net.name.map(nm => M.inCore(nm) ? 1 : 0));
  f64an(Array.from(net.vol));
  strs([...M.holdLineSet()]);
  { // probe read_meta order: cond role/region/grids/ves-node precede the tank block
    const reg = M.matRegions();
    i32(M.LAY().parts.indexOf(M.roleOfCond()));
    f64(M.condPDes());
    u32(reg.of.length); i32a(Array.from(reg.of));
    u32(reg.n);
    f64(P.Pcont); u32(M.GW()); u32(M.GH());
    strsRaw(condIds.map(id => M.condVesNode(id) || ''));
  }
  strs(tankIds);
  for (const tid of tankIds) {
    const t = D.tanks[tid];
    f64(t.vol); f64(t.level); str(t.fluid);
    u8(t.hold ? 1 : 0);
    u8(t.hold && t.hold.p !== undefined ? 1 : 0); if (t.hold && t.hold.p !== undefined) f64(t.hold.p);
    u8(t.inf ? 1 : 0); u8(t.cell ? 1 : 0);
    u8(t.gas ? 1 : 0); if (t.gas) f64(t.gas.p0);
    u8(t.burst ? 1 : 0); if (t.burst) { f64(t.burst.at); f64(t.burst.drain); f64(t.burst.rel); }
    str(t.auto || 'manual');
    u8(M.tankInField(tid) ? 1 : 0); u8(M.tankPrimary(tid) ? 1 : 0);
    i32(M.tankCircuit(tid) === null ? -1 : M.tankCircuit(tid));
  }
  f64a(tankIds.map(id => M.tankKg(id)));
  strsRaw(tankIds.map(id => { const n = P.net.tankNode[id]; return n === undefined ? '' : String(n); }));
  strsRaw(tankIds.map(id => M.breakKeyOf(id)));
  u8a(tankIds.map(() => 0)); // tank_gone: s.tankRate keys always subset (pruned on re-commission only)
  u8a(tankIds.map(id => M.tankPrimary(id) ? 1 : 0));
  str(M.primaryCore());
  u32(nCirc);
  for (let ci = 0; ci < nCirc; ci++) { const l = M.coreOnCirc(ci); u32(l.length); strsRaw(l); }
  u32(coreIds.length); i32a(coreIds.map(id => M.coreCircOf(id)));
  u32(coreIds.length); i32a(coreIds.map(id => { const v = P.net.coreNodes ? P.net.coreNodes[id] : undefined; return v === undefined ? -1 : v; }));
  i32(P.net.coreNode === undefined ? -1 : P.net.coreNode);
  f64(P.invKg0);
  u32an(M.secTankIds().map(id => tankIds.indexOf(id)));
  u32an(M.holdTankIds().map(id => tankIds.indexOf(id)));
  const reliefIds = M.reliefFitIds();
  strs(reliefIds);
  u32an(M.reliefPriIds().map(id => reliefIds.indexOf(id)));
  strs(M.reliefSecIds());
  strsRaw(reliefIds.map(id => M.reliefNodeOf(P.net, id) === undefined ? '' : M.reliefNodeOf(P.net, id)));
  for (const fid of reliefIds) {
    const [lift, reseat] = M.reliefSet(fid);
    f64(lift); f64(reseat);
    u8(M.fitSpring(fid) ? 1 : 0); u8(M.hasTarget(fid) ? 1 : 0);
  }
  for (const fid of reliefIds) str(M.ventKeyOf(fid));
  strs(M.outKeysOf(P.net));
  {
    const ents = [...P.net.outPos.entries()];
    u32(ents.length);
    for (const [k, v] of ents) { str(k); u32(v); }
  }
  {
    const ps = M.LAY().parts;
    u32(ps.length);
    for (let i = 0; i < ps.length; i++) { str(ps[i].id); u32(i); }
  }
  {
    const fids = M.reliefFitIds();
    u32(fids.length);
    for (const fid of fids) { const sh = M.shellsOf(fid); str(fid); u32(sh.length); strsRaw(sh); }
  }
  const fm = M.flowMapsOf(P.net);
  strs(fm.byKeys);
  strs(fm.sgtrKeys);
  strsRaw(sgIds.map(id => M.sgtrKeyOf(id)));
  {
    const ids = sgIds.concat(ihxIds);
    u32(ids.length);
    for (const id of ids) {
      const [k0, k1] = M.stageKeysOf(id);
      str(id); str(k0 || ''); str(k1 || '');
      const n0 = M.stageInNbr(S, id, 0), n1 = M.stageInNbr(S, id, 1);
      u32(n0.length); i32a(n0); u32(n1.length); i32a(n1);
    }
  }
  strmap(Object.fromEntries(Object.entries(P.netRefByRun || {})));
  {
    const runs = M.pipeNetwork();
    u32(runs.length);
    for (const r of runs) {
      str(r.key); u32(r.cells.length);
      for (const [x, y] of r.cells) { i32(x); i32(y); }
    }
    f64a(runs.map(r => M.runBurstP(r)));
    strsRaw(runs.map(r => M.runNodeOf(r.key) || ''));
  }
  {
    const ks = Object.keys(D.mat || {});
    u32(ks.length);
    for (const k of ks) {
      const c = k.indexOf(',');
      str(k); i32(+k.slice(0, c)); i32(+k.slice(c + 1));
      u8(M.matTight(k) ? 1 : 0); f64(M.matBurstP(+k.slice(0, c), +k.slice(c + 1)));
    }
  }
  strs(net.name);
  {
    u32(net.name.length);
    for (let i = 0; i < net.name.length; i++) { str(net.name[i]); u32(i); }
  }
  u8a(Array.from(net.vapour || new Uint8Array(net.n)));
  u8a(M.netBooked());
  i32a(net.name.map(nm => M.circOfNode(nm)));
  {
    const fm2 = M.foldMap();
    const ks = Object.keys(fm2);
    u32(ks.length);
    for (const k of ks) { str(k); str(fm2[k]); }
  }
  {
    const ps = M.LAY().parts;
    u32(ps.length);
    for (const p of ps) { str(p.id); str(p.role); i32(p.x); i32(p.y); i32(p.w); i32(p.h); }
  }
  {
    const F = M.FIRE();
    const ks = Object.keys(F);
    u32(ks.length);
    for (const k of ks) { const r = F[k]; str(k); f64(r.wlhv); f64(r.wh2); f64(r.wh2o); f64(r.wast); f64(r.wastMax); }
  }
  u32(nCirc);
  for (let ci = 0; ci < nCirc; ci++) str(M.circBurn(ci));
  f64(M.steamRise()); f64(M.roomSteamH()); f64(M.loopKg()); f64(M.coreDT0());
  f64(P.P0); f64(P.Tref); f64(P.rated); f64(P.flowK); f64(P.flowMin); f64(P.sat.cp);
  return { coreIds, pumpIds, boilerIds, sgIds, drumIds, partIds, nCirc, condIds, condSinks, tankIds, radIds, ihxIds, reliefIds };
}

// ---- per-preset curves (must match sec-probe read_curves order) ----
function dumpCurves(meta) {
  const n = meta.nCirc;
  u32(n);
  for (let ci = 0; ci < n; ci++) f64a(KEYS.map(k => num(M.satOfCirc(ci)[k])));
  f64a(KEYS.map(k => num(M.satWater()[k])));
  f64a([...Array(n).keys()].map(ci => M.holdSetP(ci)));
}

// ---- samples: state snapshot/restore, inputs dump, perturbed synth states ----
const F64KEYS = ['P', 'Tavg', 'boron', 'boronDem', 'condT', 'condVent', 'cwInT', 'dLvl',
  'dTavg', 'decay', 'flowNet', 'h2', 'heat', 'injRate', 'inv', 'load', 'loadDem', 'lvl',
  'n', 'nat', 'pCore', 'release', 'sc', 'sgBurstGen', 'sgtrRate', 'spillRate', 'turbP', 'turbWk', 'cav', 'vf'];
const U8KEYS = ['bkpLost', 'blackout', 'breach', 'condLost', 'condVentSeen', 'refOpen', 'turbTrip'];
const MAPKEYS = ['PBy', 'TavgBy', 'cavP', 'condPBy', 'condTBy', 'cwInTBy', 'dLvlBy', 'flowBy',
  'flowDemBy', 'fregBy', 'fregDemBy', 'holdPBy', 'ihxQBy', 'invBy', 'lvlBy', 'pumpQBy', 'radQBy',
  'radTBy', 'reliefSteam', 'reliefVent', 'scBy', 'sgFedBy', 'sgH2By', 'sgPBy', 'sgPwQBy', 'sgShare',
  'sgSwQBy', 'sgTBy', 'sgVentBy', 'sgWastBy', 'sgtrBy', 'skinQ', 'spillBy', 'steamBy', 'tank',
  'tankOpen', 'tankOver', 'tankRate', 'valve', 'valveDem'];
const BMAPKEYS = ['burstBy', 'sgBurst', 'tankAuto'];
const BAGKEYS = ['mBy', 'hBy', 'pBy', 'bBy', 'h2By'];
const SCLEG = ['turbWk', 'turbWkP', 'turbWkA', 'qSgtr', 'spill', 'spillSec', 'nat'];
const fnum = v => (v === undefined || v === null) ? NaN : (typeof v === 'boolean' ? (v ? 1 : 0) : v);
const smap = o => {
  o = o || {};
// NOTE: undefined-valued keys are dropped (JS reads them as absent, so must Rust).
  const ks = Object.keys(o).filter(k => o[k] !== undefined);
  u32(ks.length); strsRaw(ks); f64a(ks.map(k => fnum(o[k])));
};
const strmapB = m => {
  const ks = Object.keys(m || {});
  u32(ks.length);
  for (const k of ks) { str(k); u8(m[k] ? 1 : 0); }
};
const u32b = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const padTo = (a, n) => { const o = Array.from(a || []); while (o.length < n) o.push(0); return o.slice(0, n); };

function snapState(meta) {
  const S = M.S(), P = M.P(), HB = M.HB();
  const snap = { f: {}, b: {}, maps: {}, bmaps: {}, bags: {}, relief: {}, cores: {}, room: {} };
  for (const k of F64KEYS) snap.f[k] = S[k];
  for (const k of U8KEYS) snap.b[k] = S[k];
  for (const k of MAPKEYS) snap.maps[k] = S[k] === undefined ? undefined : { ...S[k] };
  for (const k of BMAPKEYS) snap.bmaps[k] = S[k] === undefined ? undefined : { ...S[k] };
  for (const k of BAGKEYS) {
    const h = S[k];
    snap.bags[k] = !h || !h.v ? undefined : { v: Array.from(h.v), has: Array.from(h.has || []) };
  }
  for (const fid of meta.reliefIds) {
    snap.relief[fid] = [S.reliefOpen && S.reliefOpen[fid], S.reliefAuto && S.reliefAuto[fid],
      S.reliefStuck && S.reliefStuck[fid], S.reliefArm && S.reliefArm[fid],
      S.reliefBlocked && S.reliefBlocked[fid]].map(v => !!v);
  }
  for (const id of meta.coreIds) {
    const cs = S.coreBy && S.coreBy[id];
    snap.cores[id] = cs ? [cs.pCore, cs.flowNet] : [undefined, undefined];
  }
  snap.dmgParts = (S.dmgParts || []).slice();
  snap.dmgWhy = { ...(S.dmgWhy || {}) };
  snap.massOut = { ...(S.massOut || {}) };
  snap.hb = {
    prompt: HB.prompt, decay: HB.decay, heat: HB.heat, removal: HB.removal, dTavg: HB.dTavg,
    sgQBy: { ...HB.sgQBy }, heatBy: { ...HB.heatBy },
  };
  snap.pumpLive = { ...(P.pumpLive || {}) };
  snap.netBurstP = { ...(P.net.burstP || {}) };
  snap.netBurstGen = P.net.burstGen;
  snap.seed = S.seed; snap.rng = S.rng; snap.diceOff = S.diceOff;
  snap.tankByp = { ...(S.tankByp || {}) };
  snap.tankDump = { ...(S.tankDump || {}) };
  const n = M.GW() * M.GH();
  for (const k of ['roomP', 'roomWater', 'roomWP', 'roomPool', 'roomPoolP']) {
    snap.room[k] = S[k] ? Array.from(S[k]) : new Array(n).fill(0);
  }
  snap.logLen = M.LOG().length;
  return snap;
}

function restoreState(meta, snap) {
  const S = M.S(), P = M.P(), HB = M.HB();
  for (const k of F64KEYS) {
    if (snap.f[k] === undefined) delete S[k];
    else S[k] = snap.f[k];
  }
  for (const k of U8KEYS) {
    if (snap.b[k] === undefined) delete S[k];
    else S[k] = snap.b[k];
  }
  for (const k of MAPKEYS) {
    if (snap.maps[k] === undefined) delete S[k];
    else {
      if (S[k] === undefined || S[k] === null) S[k] = {};
      for (const x of Object.keys(S[k])) delete S[k][x];
      Object.assign(S[k], snap.maps[k]);
    }
  }
  for (const k of BMAPKEYS) {
    if (snap.bmaps[k] === undefined) delete S[k];
    else {
      if (S[k] === undefined || S[k] === null) S[k] = {};
      for (const x of Object.keys(S[k])) delete S[k][x];
      Object.assign(S[k], snap.bmaps[k]);
    }
  }
  for (const k of BAGKEYS) {
    const was = snap.bags[k], h = S[k];
    if (was === undefined) continue;
    h.v.set(was.v);
    h.has.set(padTo(was.has, was.v.length));
  }
  for (const fid of meta.reliefIds) {
    const v = snap.relief[fid];
    S.reliefOpen[fid] = v[0]; S.reliefAuto[fid] = v[1]; S.reliefStuck[fid] = v[2];
    S.reliefArm[fid] = v[3]; S.reliefBlocked[fid] = v[4];
  }
  for (const id of meta.coreIds) {
    const cs = S.coreBy && S.coreBy[id];
    if (cs) { cs.pCore = snap.cores[id][0]; cs.flowNet = snap.cores[id][1]; }
  }
  // NOTE: replace, never mutate in place: partWrecked() memos on (identity, length).
  S.dmgParts = snap.dmgParts.slice();
  for (const x of Object.keys(S.dmgWhy)) delete S.dmgWhy[x];
  Object.assign(S.dmgWhy, snap.dmgWhy);
  for (const x of Object.keys(S.massOut)) delete S.massOut[x];
  Object.assign(S.massOut, snap.massOut);
  HB.prompt = snap.hb.prompt; HB.decay = snap.hb.decay; HB.heat = snap.hb.heat;
  HB.removal = snap.hb.removal; HB.dTavg = snap.hb.dTavg;
  for (const x of Object.keys(HB.sgQBy)) delete HB.sgQBy[x];
  Object.assign(HB.sgQBy, snap.hb.sgQBy);
  for (const x of Object.keys(HB.heatBy)) delete HB.heatBy[x];
  Object.assign(HB.heatBy, snap.hb.heatBy);
  if (P.pumpLive) { for (const x of Object.keys(P.pumpLive)) delete P.pumpLive[x]; Object.assign(P.pumpLive, snap.pumpLive); }
  P.net.burstP = { ...snap.netBurstP };
  P.net.burstGen = snap.netBurstGen;
  S.seed = snap.seed; S.rng = snap.rng; S.diceOff = snap.diceOff;
  for (const x of Object.keys(S.tankByp)) delete S.tankByp[x];
  Object.assign(S.tankByp, snap.tankByp);
  for (const x of Object.keys(S.tankDump)) delete S.tankDump[x];
  Object.assign(S.tankDump, snap.tankDump);
  for (const k of ['roomP', 'roomWater', 'roomWP', 'roomPool', 'roomPoolP']) {
    if (S[k]) S[k].set(snap.room[k]);
  }
  M.bumpRoomPGen(); // restored grids must invalidate the region means memo
  M.LOG().length = snap.logLen;
}

// probe read_state order: f64s, u8s, maps, bmaps, bags, relief, cores,
// dmgParts/Why, massOut, heatbal, pumpLive, netBurstP, seed/rng/diceOff,
// tankByp/Dump, refOpen, netBurstGen, room grids x5.
function dumpState(meta, S, P, HB) {
  const n = M.GW() * M.GH();
  u32(F64KEYS.length);
  for (const k of F64KEYS) { str(k); f64(fnum(S[k])); }
  u32(U8KEYS.length);
  for (const k of U8KEYS) { str(k); u8(S[k] ? 1 : 0); }
  u32(MAPKEYS.length);
  for (const k of MAPKEYS) {
    const o = S[k] || {};
    const ks = Object.keys(o).filter(x => o[x] !== undefined);
    str(k); u32(ks.length); strsRaw(ks); f64a(ks.map(x => fnum(o[x])));
  }
  u32(BMAPKEYS.length);
  for (const k of BMAPKEYS) {
    const o = S[k] || {};
    const ks = Object.keys(o).filter(x => o[x] !== undefined);
    str(k); u32(ks.length); strsRaw(ks); u8a(ks.map(x => (o[x] ? 1 : 0)));
  }
  u32(BAGKEYS.length + 1);
  for (const k of BAGKEYS) {
    const h = S[k];
    str(k);
    if (!h || !h.v) u32(0);
    else {
      const v = Array.from(h.v);
      u32(v.length); f64a(v); u8a(padTo(Array.from(h.has || []), v.length));
    }
  }
  str('roomP');
  {
    const v = S.roomP ? Array.from(S.roomP) : new Array(n).fill(0);
    u32(v.length); f64a(v); u8a(new Array(v.length).fill(1));
  }
  u32(meta.reliefIds.length);
  for (const fid of meta.reliefIds) {
    str(fid);
    u8a([(S.reliefOpen && S.reliefOpen[fid] ? 1 : 0), (S.reliefAuto && S.reliefAuto[fid] ? 1 : 0),
      (S.reliefStuck && S.reliefStuck[fid] ? 1 : 0), (S.reliefArm && S.reliefArm[fid] ? 1 : 0),
      (S.reliefBlocked && S.reliefBlocked[fid] ? 1 : 0)]);
  }
  for (const id of meta.coreIds) {
    const cs = S.coreBy && S.coreBy[id];
    f64(cs ? fnum(cs.pCore) : NaN); f64(cs ? fnum(cs.flowNet) : NaN);
  }
  u32((S.dmgParts || []).length); strsRaw(S.dmgParts || []);
  {
    const ks = Object.keys(S.dmgWhy || {});
    u32(ks.length);
    for (const k of ks) { str(k); str(S.dmgWhy[k]); }
  }
  strmap(S.massOut || {});
  f64(fnum(HB.prompt)); f64(fnum(HB.decay)); f64(fnum(HB.heat));
  f64(fnum(HB.removal)); f64(fnum(HB.dTavg));
  smap(HB.sgQBy); smap(HB.heatBy);
  {
    const ks = Object.keys(P.pumpLive || {});
    u32(ks.length); strsRaw(ks);
  }
  strmap(P.net.burstP || {});
  u32((S.seed || 0) >>> 0); i32(S.rng | 0); u8(S.diceOff ? 1 : 0);
  strmapB(S.tankByp); strmapB(S.tankDump);
  u8(S.refOpen ? 1 : 0);
  f64(fnum(P.net.burstGen));
  for (const k of ['roomP', 'roomWater', 'roomWP', 'roomPool', 'roomPoolP']) {
    f64a(S[k] ? Array.from(S[k]) : new Array(n).fill(0));
  }
}

// probe read_inputs order. All S-derived reads are pre-call (caller snapshots first).
function dumpInputs(meta) {
  const S = M.S(), P = M.P(), net = P.net;
  const netOut = P.netOut || {}, runFlow = P.runFlowH;
  const FM = M.flowMapsOf(net);
  f64a([0, 1, 2, 3, 4, 5, 6].map(i => num(M.outsNum(netOut, i, SCLEG[i]))));
  const byT = !!(netOut && netOut.byV);
  u8(byT ? 1 : 0);
  if (byT) f64a(padTo(Array.from(netOut.byV), FM.byKeys.length));
  else strmap(netOut.by || {});
  {
    const o = {};
    for (const tid of meta.tankIds) {
      const v = M.outsBag(netOut, 'qTankV', 'qTankBy', 'qTankPos', tid);
      if (v !== undefined) o[tid] = num(v);
    }
    strmap(o);
  }
  {
    const o = {};
    for (const fid of meta.reliefIds) {
      const v = M.outsBag(netOut, 'reliefV', 'reliefBy', 'reliefPos', fid);
      if (v !== undefined) o[fid] = num(v);
    }
    strmap(o);
  }
  const sgT = !!(netOut && netOut.sgtrV);
  u8(sgT ? 1 : 0);
  if (sgT) f64a(padTo(Array.from(netOut.sgtrV), FM.sgtrKeys.length));
  else strmap(netOut.sgtrBy || {});
  {
    const o = {};
    for (const id of meta.sgIds.concat(meta.drumIds)) {
      const v = M.outsBag(netOut, 'sgFeedV', 'sgFeedBy', 'sgFeedPos', id);
      if (v !== undefined) o[id] = num(v);
    }
    strmap(o);
  }
  {
    const o = {};
    for (const id of meta.sgIds) {
      const v = M.outsBag(netOut, 'sgSteamV', 'sgSteamOutBy', 'sgSteamPos', id);
      if (v !== undefined) o[id] = num(v);
    }
    strmap(o);
  }
  {
    const o = {};
    for (const [k, v] of Object.entries(netOut.byLoop || {})) o[k] = num(v);
    strmap(o);
  }
  {
    const rk = runFlow && runFlow.pos ? [...runFlow.pos.keys()] : [];
    u32(rk.length); strsRaw(rk);
    f64a(rk.map(k => num(runFlow.pos.get(k) === undefined ? 0 : runFlow.v[runFlow.pos.get(k)])));
  }
  f64(num(M.AOP())); f64(num(M.AOS()));
  {
    const o = {};
    for (let i = 0; i < net.n; i++) o[String(i)] = num(M.ADL(i));
    strmap(o);
  }
  {
    const ekg = M.ADV() ? Array.from(M.ADV()) : [];
    u32(ekg.length); f64a(ekg.map(num));
  }
  {
    const o = {};
    if (net.outPos) for (const k of net.outPos.keys()) o[k] = num(M.outKg(net, k));
    strmap(o);
  }
  {
    const fids = M.reliefSecIds();
    u32(fids.length);
    for (const fid of fids) {
      const sh = M.shellsLive(S, fid);
      str(fid); u32(sh.length); strsRaw(sh);
    }
  }
  {
    const ekg = M.ADV() ? Array.from(M.ADV()) : [];
    const ve = [];
    for (let e = 0; e < net.edges.length; e++) {
      const ed = net.edges[e];
      if (ed.kind === 'vent' && ekg[e] > 0 && ed.key !== undefined) ve.push([ed.key, ekg[e]]);
    }
    u32(ve.length);
    for (const [k, v] of ve) { str(k); f64(num(v)); }
  }
  f64(num(M.DGEN())); f64(num(net.burstGen));
  {
    const pc = M.netPiecesOf(S);
    u32(pc.length); i32a(pc);
    i32(net.coreNode === undefined ? -1 : (pc[net.coreNode] === undefined ? -1 : pc[net.coreNode]));
    const cps = M.corePiecesOf(S);
    u32(cps.length); i32a(cps);
  }
  strmap({ ...M.HB().heatBy });
  u32(meta.nCirc);
  for (let ci = 0; ci < meta.nCirc; ci++) {
    u32(net.name.length);
    u8a(net.name.map(nm => (M.inLoop(ci, nm) ? 1 : 0)));
  }
  u8a(M.holdTankIds().map(id => (M.holdLive(S, M.tankCircuit(id)) ? 1 : 0)));
  {
    const stIds = meta.sgIds.concat(meta.ihxIds);
    u32(stIds.length);
    u8a(stIds.map(id => (M.stageFed(S, id) ? 1 : 0)));
  }
  strmap({ ...P.coreFN });
  f64a(meta.tankIds.map(tid => M.tankP(S, tid)));
  u8(M.exhOpen(S)); i32(M.roleTurbAlive());
  {
    const o = {};
    for (const fid of meta.reliefIds) o['relief:' + fid] = num(M.contRelPart(S, fid));
    for (const tid of meta.tankIds) o['tank:' + tid] = num(M.contRelPart(S, tid));
    for (const id of meta.sgIds) o['sg:' + id] = num(M.contRelPart(S, id));
    strmap(o);
  }
  // feedInMV/HV/HM are solve scratch, recomputed per tick: per-sample inputs, never meta.
  f64an(Array.from((P.net.scr && P.net.scr.feedInMV) || []));
  f64an(Array.from((P.net.scr && P.net.scr.feedInHV) || []));
  {
    const hm = (P.net.scr && P.net.scr.feedInHM) ? Array.from(P.net.scr.feedInHM) : [];
    u32(hm.length); u8a(hm.map(v => (v ? 1 : 0)));
  }
}

const SEVMAP = { alarm: 0, warn: 1, info: 2 };
function mapEvent(e) {
  for (const code of Object.keys(EVMSG)) {
    const [sev, pat, suf] = EVMSG[code];
    if (e.sev !== sev) continue;
    const hit = suf ? e.msg.endsWith(pat) : (pat.endsWith('/ ') ? e.msg.startsWith(pat) : e.msg === pat);
    if (hit) return [SEVMAP[sev], +code];
  }
  console.error('unmapped sec log: ' + e.sev + ' ' + e.msg);
  process.exit(2);
}

// One sample: snapshot pre, dump inputs, run the REAL 22 fns in tick order,
// encode expected, dump post, restore. Mut is an optional pre-run perturbation.
function runSample(meta, tag, mut) {
  const S = M.S(), P = M.P(), HB = M.HB();
  const netOut = P.netOut || {}, runFlow = P.runFlowH;
  const clean = snapState(meta); // pre-mut: samples restore here, never to the mutated pre
  let cleanup = null;
  if (mut) cleanup = mut(S, P) || null;
  const heat = num(S.n) * M.PROMPT_F() + num(S.decay);
  const pumpK = num(S.flowNet);
  const pField = S.pBy;
  u32(tag); f64(DT); f64(pumpK);
  dumpInputs(meta);
  dumpState(meta, S, P, HB);
  const log0 = M.LOG().length;
  M.actFollow(S, DT);
  M.boronFollow(S, DT);
  M.spillStep(S, netOut);
  const tr = M.tankRateStep(S, netOut);
  const inj = tr.inj, injIds = tr.injIds.slice();
  M.pcoreStep(S, pField);
  M.pressRead(S, DT);
  M.burstDice(S, DT, pField);
  M.invStep(S);
  const cavIds = M.cavStep(S, DT, pField).slice();
  M.pumpQStep(S, runFlow);
  M.pumpCoastStep(S, DT);
  M.sgHeatStep(S, DT, runFlow, netOut, pumpK, heat);
  M.holdReliefStep(S, DT, pField, netOut);
  M.discTankStep(S, DT);
  M.bookTailStep(S, inj);
  M.sgtrStep(S, DT, netOut);
  M.marginStep(S, pField, heat, pumpK);
  M.condTurbStep(S);
  const sv = M.secVentStep(S, DT, netOut);
  // tickSecVent never deletes: filter stale keys of removed generators.
  const boW = new Set(meta.boilerIds);
  const secVent = {};
  for (const [k, v] of Object.entries(sv.secVent)) if (boW.has(k)) secVent[k] = v;
  for (const id of meta.boilerIds) if (!(id in secVent)) secVent[id] = 0;
  const pCond = sv.pCond;
  const sh = M.shellStep(S, DT, netOut, sv.secVent);
  const bleedAll = sh.bleedAll;
  M.condVentStep(S, DT);
  M.turbStep(S, netOut, pCond, bleedAll);
  M.radPanelStep(S, DT, runFlow);
  M.secTankStep(S, DT);
  const evs = M.LOG().slice(log0).map(mapEvent);
  f64(inj);
  u32(injIds.length); strsRaw(injIds);
  u32(cavIds.length); strsRaw(cavIds);
  strmap(secVent);
  f64(pCond); f64(bleedAll);
  u32(evs.length);
  for (const [sv2, code] of evs) { u8(sv2); u32(code); }
  u32(0);
  dumpState(meta, S, P, HB);
  restoreState(meta, clean);
  if (cleanup) cleanup();
  return 1;
}

const presetNames = [];
let nSamples = 0;
const skipped = { noNet: 0, synthSkip: 0 };
const presets = [];
for (const k of Object.keys(M.PRE())) {
  M.plantPreset(+k); M.buildLayout(); M.commission();
  M.S().diceOff = true;
  M.S().seed = M.S().rng = (123456789 + 1000003 * +k) >>> 0; // pinned: commission seeds off Math.random
  presetNames.push(M.PRE()[k][0]);
  const C = assertConsts();
  const meta = dumpMeta(C);
  dumpCurves(meta);
  const nsAt = parts.length; // sample count spliced in after the preset loop
  const P = { n: 0 };
  const S = M.S();
  for (let t = 0; t < TICKS; t++) {
    M.step(DT);
    if (t < 1) continue;
    if (!M.P().netOut || !M.P().runFlowH) { skipped.noNet++; continue; }
    if ((t - 1) % 30 === 0) { nSamples += runSample(meta, 0, null); P.n++; }
  }
  // ---- perturbed synth states (each restored after) ----
  const D = M.D();
  const synths = [
    ['burst', (s, Pv) => { // forced burst dice: spiked field + room load, dice live
      s.diceOff = false;
      const h = s.pBy;
      if (h && h.v) for (let i = 0; i < h.v.length; i++) if (h.has[i]) h.v[i] *= 5;
      if (s.roomP) for (let i = 0; i < s.roomP.length; i++) s.roomP[i] += 5000;
      M.bumpRoomPGen(); // spiking roomP behind roomStep's back must invalidate the region means memo
    }],
    ['relief', s => {
      const fids = M.reliefPriIds();
      if (!fids.length) return false;
      s.reliefOpen[fids[0]] = true; s.reliefAuto[fids[0]] = true;
    }],
    ['disc', s => {
      const tid = meta.tankIds.find(t => D.tanks[t] && D.tanks[t].burst);
      if (!tid) return false;
      s.burstBy[tid] = true;
    }],
    ['sgtr', (s, Pv) => { // patched solve: ruptured-tube outflow the replay must honor
      const o = Pv.netOut || {};
      if (o.scV) { const was = o.scV[3]; o.scV[3] += 200; return () => { o.scV[3] = was; }; }
      const was = o.qSgtr || 0; o.qSgtr = was + 200; return () => { o.qSgtr = was; };
    }],
    ['wreck', s => {
      const tid = meta.tankIds[0];
      if (!tid) return false;
      s.dmgParts.push(tid); s.dmgWhy[tid] = 'WRECK';
      if (s.tank) s.tank[tid] = 80;
    }],
    ['sgwreck', s => {
      const id = meta.sgIds[0];
      if (!id) return false;
      s.dmgParts.push(id); s.dmgWhy[id] = 'WRECK';
    }],
    ['overflow', s => {
      const ids = M.secTankIds();
      if (!ids.length) return false;
      s.tank[ids[0]] = 99.99;
    }],
    ['condlost', s => { s.condLost = true; }],
    ['condvent', s => { s.condLost = true; s.condVentSeen = false; }],
    ['sgburst', s => {
      const id = meta.sgIds[0];
      if (!id) return false;
      if (!s.sgBurst) return false;
      s.sgBurst[id] = true;
    }],
    ['cav', s => {
      const ids = M.pumpIds();
      if (!ids.length) return false;
      s.cavP[ids[0]] = 0.9;
    }],
    ['tankauto', s => {
      const tid = meta.tankIds[0];
      if (!tid) return false;
      s.tankAuto[tid] = !s.tankAuto[tid];
    }],
    ['fregprune', s => {
      s.fregBy.__bogus__ = 1; s.fregDemBy.__bogus__ = 2;
    }],
    ['fregundef', s => {
      const bids = M.boilerIds();
      if (bids.length) s.fregDemBy[bids[0]] = undefined;
      const vk = Object.keys(s.valve || {});
      if (vk.length) s.valveDem[vk[0]] = undefined;
      else if (!bids.length) return false;
    }],
    ['blackout', s => { s.blackout = true; s.bkpLost = false; }],
    ['blackoutlost', s => { s.blackout = true; s.bkpLost = true; }],
    ['breach', s => { s.breach = true; }],
  ];
  let tag = 1;
  for (const [, mut] of synths) {
    const preS = snapState(meta);
    const r = mut(M.S(), M.P());
    if (r === false) { restoreState(meta, preS); skipped.synthSkip++; tag++; continue; }
    restoreState(meta, preS); // undo the probe; runSample applies it once, cleanly
    if (typeof r === 'function') r(); // undo non-S side effects (netOut patch)
    nSamples += runSample(meta, tag, mut);
    P.n++;
    tag++;
  }
  parts.splice(nsAt, 0, u32b(P.n));
  presets.push(P);
}

// ---- encode: meta/curves/samples streamed above in preset order; prepend the header ----
{
  const body = Buffer.concat(parts);
  parts.length = 0;
  u32(presets.length); u32(1);
  fs.writeFileSync(fIn, Buffer.concat([Buffer.concat(parts), body]));
}

const CARGO = (() => {
  try {
    const p = path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
    fs.accessSync(p); return p;
  } catch { return 'cargo'; }
})();
const out = execFileSync(CARGO, ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'sec-probe', '--', fIn],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RUSTUP_TOOLCHAIN: '1.89.0-x86_64-pc-windows-gnu' } });
console.log(out.trim());
console.log('skipped=' + JSON.stringify(skipped));
const pass = /FAILURES=0/.test(out);
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'sec-baseline.json'), JSON.stringify({
    presets: presetNames, ticks: TICKS, samples: nSamples,
  }, null, 1) + '\n');
}
if (!process.env.KEEP_TMP) fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
