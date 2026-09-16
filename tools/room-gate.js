#!/usr/bin/env node
// node tools/room-gate.js [--ticks N] — §6.6 room gate: sumpStep (spill
// landing + flood damage) then roomStep (gas CG solve, skins, jets, liquid
// call, inject, sodium fire, vent, diffuse, H2 burn, condense, scar) on every
// preset vs sim-rs room-probe replay. Masks/counts/strings exact, floats at
// sdig semantics (`pow` flows through hull radiation + liquid friction).
// Dump-kit inputs: solved/transport artifacts, tool orders, field bags.
// Writes tools/room-baseline.json on pass.
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
  'sumpStep:(s,dt)=>sumpStep(s,dt),roomStep:(s,dt)=>roomStep(s,dt),' +
  'coreIds:()=>coreIds(),boilerIds:()=>boilerIds(),sgIds:()=>sgIds(),reliefFitIds:()=>reliefFitIds(),' +
  'pumpIds:()=>pumpIds(),secTankIds:()=>secTankIds(),GW:()=>GW,GH:()=>GH,' +
  'reliefSecIds:()=>reliefSecIds(),reliefPriIds:()=>reliefPriIds(),tankIds:()=>tankIds(),' +
  'shellNode:(id)=>shellNode(id),ventKeyOf:(fid)=>ventKeyOf(fid),' +
  'circKey:(ci)=>circKey(ci),coreCirc:()=>nodeGraph().coreCirc,coreCircs:()=>nodeGraph().coreCircs,holdCircs:()=>holdCircs(),' +
  'circAuthored:(ci)=>circAuthored(ci)?1:0,circOfNode:(nm)=>circOfNode(nm),' +
  'holdSetP:(ci)=>holdSetP(ci),satOfCirc:(ci)=>satOfCirc(ci),satWater:()=>SAT_WATER,' +
  'partFaceNode:(id)=>partFaceNode(id),' +
  'roleInternal:(role)=>roleIns({role}).map(q=>[q.a,q.b]),' +
  'roleRow:(role)=>{const r=ROLE[role]; return r?{drown:!!r.drown,thermal:r.thermal||"none"}:null;},' +
  'roomGeom:()=>roomGeom(),matRegions:()=>{const g=matRegions(); return {of:Array.from(g.of), n:g.regions.length};},' +
  'portCell:(pid)=>portCell(pid),boreOf:(key)=>openBoreM(key),' +
  'matWall:(x,y)=>matWall(x,y)?1:0,COOLANT:()=>COOLANT,' +
  'circBurn:(ci)=>{const c=satOfCirc(ci); return (c&&c.burn)||"";},' +
  'runBoreByKey:(key)=>{const r=pipeNetwork().find(q=>q.key===key); return r?runBoreMm(r):0;},' +
  'pipeNetwork:()=>pipeNetwork(),matWall:(x,y)=>matWall(x,y)?1:0,' +
  'outKg:(net,k)=>outKgOf(net,k),outH2:(net,k)=>outH2Of(net,k),boreOf:(key)=>openBoreM(key),' +
  'FIRE:()=>FIRE,COOLANT:()=>COOLANT,' +
  'fireCoolDbg:()=>{const c=fireCool();return c?("cp="+c.cp+",dens="+c.dens+",bulk="+c.bulk+",burn="+c.burn):"null";},' +
  'fireCoolFresh:()=>{const co=COOLANT.filter(a=>a.burn===Object.keys(FIRE)[0])[0]||null;return co?("cp="+co.cp+",dens="+co.dens+",bulk="+co.bulk+",burn="+co.burn):"null";},' +
  'roomCgIt:()=>roomCgIt,liqCgIt:()=>liqCgIt,liqCgReset:()=>{liqCgIt=0;},roomPGen:()=>roomPGen,gsX:()=>Array.from(gsX||[]),' +
  'gsDisp:()=>Array.from(gsDisp||[]),' +
  'gsBv:()=>Array.from(gsB||[]),gsXv:()=>Array.from(gsX||[]),' +
  'gsPv:()=>Array.from(gsP||[]),gsFxv:()=>Array.from(gsFx||[]),gsFyv:()=>Array.from(gsFy||[]),' +
  'lqBv:()=>Array.from(lqB||[]),lqXv:()=>Array.from(lqX||[]),lqDIv:()=>Array.from(lqDI||[]),lqAxv:()=>Array.from(lqAx||[]),lqAyv:()=>Array.from(lqAy||[]),' +
  'lqFxv:()=>Array.from(lqFx||[]),lqFyv:()=>Array.from(lqFy||[]),' +
  'fireDbg:()=>{const s=S,N=GW*GH,o=[],f=fireRow(),cp=fireCp();' +
  'for(let i=0;i<N;i++){const m=s.roomPool[i];if(!(m>0))continue;' +
  'const A=Math.min(MPC*MPC,(m+(i+GW<N?s.roomPool[i+GW]:0))/(fireRho()*POOL_DMIN));' +
  'const Tp=poolT(m,s.roomPoolE[i]),fo2=roomO2Frac(s,i),open=i<GW||!(s.roomPool[i-GW]>0);' +
  'o.push(i+":open="+open+",Tp="+Tp.toFixed(3)+",ign="+f.ign+",fo2="+fo2.toFixed(5)+",loc="+f.loc+",m="+m.toFixed(4)+",o2="+(+s.roomO2[i]).toFixed(6)+",w="+(+s.roomWater[i]).toFixed(4)+",vap="+(+s.roomVap[i]).toFixed(4)+",wlhv="+f.wlhv+",wrate="+f.wrate);}' +
  'return o.join(" ");},' +
  'sumpDbg:()=>{const s=S,G=roomGeomLive(s),o=[];' +
  'for(const k in s.spillBy){if(!(outKgOf(P.net,k)>0))continue;const fl=openFluidH(s,k);if(!fl)continue;' +
  'const cells=roomOpenCells(s,G,k);if(!cells.length)continue;' +
  'const fx=openFlashX(s,fl,cells[0]);const kg=outKgOf(P.net,k)*(1-fx);' +
  'o.push(k+":kg="+kg.toFixed(3)+",fx="+fx.toFixed(4)+",h="+(+fl.h).toFixed(1)+",c0="+cells[0]+",rp="+(+s.roomP[cells[0]]).toFixed(1));}' +
  'return o.join(" ");},' +
  'jetDbg:()=>{const s=S,G=roomGeomLive(s),o=[];' +
  'for(const id of boilerIds()){let bv=0;for(const fid of (G.shellValves[id]||[]))bv+=s.reliefSteam[fid]||0;' +
  'const hole=Math.max(0,(s.sgVentBy[id]||0)-bv);' +
  'o.push(id+":hole="+hole+",cells="+roomCellsOf(G,id).slice(0,3).join("/")+",rs="+JSON.stringify(s.reliefSteam));}' +
  'return o.join(" ");},' +
  'liqLive:()=>{const s=S,G=roomGeomLive(s),out=[];' +
  'for(const qq of [liqWater(s),liqMetal(s)]){const q=qq,N=GW*GH;' +
  'const A=MPC*ROOM_DEPTH,rg=q.rho*G_SI;' +
  'const cap=new Float64Array(N),h=new Float64Array(N),hc=new Float64Array(N),gas=new Float64Array(N),p=new Float64Array(N);' +
  'const full=new Uint8Array(N),stand=new Uint8Array(N),stiff=new Uint8Array(N);' +
  'for(let i=0;i<N;i++){cap[i]=liqShut(G,i)?0:liqCap(q,i);hc[i]=cap[i]/(q.rho*A);h[i]=q.M[i]/(q.rho*A);' +
  'gas[i]=(ROOM_P0+s.roomP[i])*1000;full[i]=cap[i]>0&&q.M[i]>=cap[i]*LIQ_FULL_K?1:0;}' +
  'lqStandWalk(N,G,full,stand);' +
  'for(let i=0;i<N;i++)stiff[i]=full[i]&&stand[i]&&(i<GW||!liqRuns(G,i,i-GW)||h[i-GW]>LIQ_H_LO)?1:0;' +
  'for(let i=0;i<N;i++)p[i]=stiff[i]?ROOM_P0*1000+q.P[i]*1000:lqPFree(gas,rg,h,i);' +
  'const dLo=rg*LIQ_H_LO,livef=[];' +
  'for(let i=0;i<N;i++){const X=i%GW;' +
  'if(X<GW-1&&lqRunsX(cap,G,i)&&(h[i]>0||h[i+1]>0))livef.push(["x",i,lqDriveX(q,h,hc,stand,p,rg,gas,i,i+1),q.vu[i],h[i],h[i+1],p[i],p[i+1],gas[i],gas[i+1],stand[i],stand[i+1],stiff[i],stiff[i+1]]);' +
  'if(i<N-GW&&lqRunsY(cap,G,i)&&(h[i]>0||h[i+GW]>0)){const j=i+GW,d=p[i]-(full[j]?p[j]-rg*Math.min(h[j],hc[j]):gas[j]);' +
  'livef.push(["y",i,d,q.vv[i],h[i],h[j],p[i],p[j],gas[i],gas[j],stand[i],stand[j],stiff[i],stiff[j]]);}}' +
  'out.push(q.tag+":"+livef.length+":"+JSON.stringify(livef.slice(0,4)));}' +
  'return out.join(" ");},' +
  'LOG:()=>LOG,' +
  'MPC:()=>MPC,ROOM_MIX:()=>ROOM_MIX,ROOM_UP:()=>ROOM_UP,ROOM_BLOCK:()=>ROOM_BLOCK,' +
  'ROOM_H:()=>ROOM_H,T_HULL:()=>T_HULL,ROOM_P0:()=>ROOM_P0,ROOM_CGAME:()=>ROOM_CGAME,' +
  'ROOM_CP:()=>ROOM_CP,ROOM_RHO:()=>ROOM_RHO,ROOM_CV:()=>ROOM_CV,ROOM_SKIN_TAU:()=>ROOM_SKIN_TAU,' +
  'SKIN_PROC_K:()=>SKIN_PROC_K,ROOM_VENT_KGS:()=>ROOM_VENT_KGS,INERT_KGS:()=>INERT_KGS,' +
  'ROOM_ENTRAIN:()=>ROOM_ENTRAIN,ROOM_JET_TAU:()=>ROOM_JET_TAU,R_AIR:()=>R_AIR,R_SI:()=>R_SI,' +
  'WAVE_P_LO:()=>WAVE_P_LO,WAVE_U_LO:()=>WAVE_U_LO,CG_TOL:()=>CG_TOL,CG_MAX:()=>CG_MAX,' +
  'HIT_LO:()=>HIT_LO,WATER_RHO:()=>WATER_RHO,WATER_BULK:()=>WATER_BULK,G_MPA:()=>G_MPA,' +
  'LIQ_MANNING:()=>LIQ_MANNING,LIQ_CD:()=>LIQ_CD,LIQ_V_MAX:()=>LIQ_V_MAX,LIQ_REST:()=>LIQ_REST,' +
  'LIQ_H_LO:()=>LIQ_H_LO,LIQ_CG_TOL:()=>LIQ_CG_TOL,LIQ_CG_MAX:()=>LIQ_CG_MAX,' +
  'LIQ_FULL_K:()=>LIQ_FULL_K,FACE_TAIL:()=>FACE_TAIL,ADV_SWEEPS:()=>ADV_SWEEPS,' +
  'POOL_DMIN:()=>POOL_DMIN,SPRAY_WE0:()=>SPRAY_WE0,SPRAY_WE1:()=>SPRAY_WE1,R_VAP:()=>R_VAP,' +
  'PAN_DRAIN_KGS:()=>PAN_DRAIN_KGS,ROOM_VG_MIN:()=>ROOM_VG_MIN,ROOM_FR_MIN:()=>ROOM_FR_MIN,' +
  'H2_LFL:()=>H2_LFL,H2_UFL:()=>H2_UFL,H2_IGN:()=>H2_IGN,H2_LHV:()=>H2_LHV,' +
  'H2_MMOL:()=>H2_MMOL,AIR_MMOL:()=>AIR_MMOL,H2O_MMOL:()=>H2O_MMOL,' +
  'O2_FRAC0:()=>O2_FRAC0,O2_MMOL:()=>O2_MMOL,O2_LOC:()=>O2_LOC,H2_TURB:()=>H2_TURB,' +
  'FLOOD_DROWN:()=>FLOOD_DROWN,ROOM_TMAX:()=>ROOM_TMAX,T_SPACE:()=>T_SPACE,' +
  'SIGMA:()=>SIGMA,RHO_K:()=>RHO_K,CP_W:()=>CP_W,' +
  'loopKg:()=>loopKg(),steamRise:()=>steamRise(),roomSteamH:()=>roomSteamH(),' +
  'cgCapKeys:()=>Object.keys(cgCapWarned),' +
  'cgCapClear:()=>{for(const k in cgCapWarned)delete cgCapWarned[k];},' +
  'cgCapRestore:(ks)=>{for(const k in cgCapWarned)delete cgCapWarned[k];for(const k of ks)cgCapWarned[k]=true;}}');

const num = v => (v === undefined || v === null) ? NaN : v;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'room-gate-'));
const fIn = path.join(tmp, 'room.bin');
// NOTE: grid dumps are MBs per sample: writers batch into one Buffer per
// array (never one Buffer per value), and presets stream straight to disk.
let parts = [];
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); parts.push(b); };
const i32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); };
const f64 = v => { const b = Buffer.alloc(8); b.writeDoubleLE(v); parts.push(b); };
const f32 = v => { const b = Buffer.alloc(4); b.writeFloatLE(v); parts.push(b); };
const f64a = a => { const b = Buffer.alloc(8 * a.length); for (let i = 0; i < a.length; i++) b.writeDoubleLE(a[i], i * 8); parts.push(b); };
const f32a = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeFloatLE(a[i], i * 4); parts.push(b); };
const u8 = v => parts.push(Buffer.from([(v | 0) & 0xff]));
const u8a = a => parts.push(Buffer.from(Array.from(a).map(v => v ? 1 : 0)));
const u8raw = a => parts.push(Buffer.from(Array.from(a).map(v => v & 0xff)));
const i32a = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeInt32LE(a[i], i * 4); parts.push(b); };
const u32a = a => { const b = Buffer.alloc(4 * a.length); for (let i = 0; i < a.length; i++) b.writeUInt32LE(a[i] >>> 0, i * 4); parts.push(b); };
const str = s => { const b = Buffer.from(String(s === undefined || s === null ? '' : s), 'utf8'); u32(b.length); parts.push(b); };
const strsRaw = a => { for (const s of a) str(s); };
const strs = a => { u32(a.length); strsRaw(a); };
const u8an = a => { u32(a.length); u8a(a); };
const f64an = a => { u32(a.length); f64a(a); };
const strmap = m => {
  const ks = Object.keys(m || {}).filter(k => m[k] !== undefined);
  u32(ks.length);
  for (const k of ks) { str(k); f64(m[k]); }
};

// event codes mirrored from sim-rs/src/tick.rs; gate maps code -> [sev, msg prefix]
const EVMSG = {
  11: ['alarm', 'FLOODING / '],
};

// ---- const assertion (fails fast) ----
function assertConsts() {
  const want = {
    MPC: M.MPC(), ROOM_MIX: M.ROOM_MIX(), ROOM_UP: M.ROOM_UP(), ROOM_BLOCK: M.ROOM_BLOCK(),
    ROOM_H: M.ROOM_H(), T_HULL: M.T_HULL(), ROOM_P0: M.ROOM_P0(), ROOM_CGAME: M.ROOM_CGAME(),
    ROOM_CP: M.ROOM_CP(), ROOM_RHO: M.ROOM_RHO(), ROOM_CV: M.ROOM_CV(),
    ROOM_SKIN_TAU: M.ROOM_SKIN_TAU(), SKIN_PROC_K: M.SKIN_PROC_K(),
    ROOM_VENT_KGS: M.ROOM_VENT_KGS(), INERT_KGS: M.INERT_KGS(),
    ROOM_ENTRAIN: M.ROOM_ENTRAIN(), ROOM_JET_TAU: M.ROOM_JET_TAU(),
    R_AIR: M.R_AIR(), R_SI: M.R_SI(), WAVE_P_LO: M.WAVE_P_LO(), WAVE_U_LO: M.WAVE_U_LO(),
    CG_TOL: M.CG_TOL(), CG_MAX: M.CG_MAX(), HIT_LO: M.HIT_LO(),
    WATER_RHO: M.WATER_RHO(), WATER_BULK: M.WATER_BULK(), G_MPA: M.G_MPA(),
    LIQ_MANNING: M.LIQ_MANNING(), LIQ_CD: M.LIQ_CD(), LIQ_V_MAX: M.LIQ_V_MAX(),
    LIQ_REST: M.LIQ_REST(), LIQ_H_LO: M.LIQ_H_LO(), LIQ_CG_TOL: M.LIQ_CG_TOL(),
    LIQ_CG_MAX: M.LIQ_CG_MAX(), LIQ_FULL_K: M.LIQ_FULL_K(), FACE_TAIL: M.FACE_TAIL(),
    ADV_SWEEPS: M.ADV_SWEEPS(), POOL_DMIN: M.POOL_DMIN(), SPRAY_WE0: M.SPRAY_WE0(),
    SPRAY_WE1: M.SPRAY_WE1(), R_VAP: M.R_VAP(), PAN_DRAIN_KGS: M.PAN_DRAIN_KGS(),
    ROOM_VG_MIN: M.ROOM_VG_MIN(), ROOM_FR_MIN: M.ROOM_FR_MIN(),
    H2_LFL: M.H2_LFL(), H2_UFL: M.H2_UFL(), H2_IGN: M.H2_IGN(), H2_LHV: M.H2_LHV(),
    H2_MMOL: M.H2_MMOL(), AIR_MMOL: M.AIR_MMOL(), H2O_MMOL: M.H2O_MMOL(),
    O2_FRAC0: M.O2_FRAC0(), O2_MMOL: M.O2_MMOL(), O2_LOC: M.O2_LOC(), H2_TURB: M.H2_TURB(),
    FLOOD_DROWN: M.FLOOD_DROWN(), ROOM_TMAX: M.ROOM_TMAX(), T_SPACE: M.T_SPACE(),
    SIGMA: M.SIGMA(), RHO_K: M.RHO_K(), CP_W: M.CP_W(),
  };
  const ref = {
    MPC: 1.4 / 3, ROOM_MIX: 0.35, ROOM_UP: 3.0, ROOM_BLOCK: 0.12,
    ROOM_H: 6, T_HULL: 293, ROOM_P0: 101.3, ROOM_CGAME: 50,
    ROOM_CP: 1.0, ROOM_RHO: 1.2, ROOM_CV: 0.718,
    ROOM_SKIN_TAU: 45, SKIN_PROC_K: 20,
    ROOM_VENT_KGS: 50, INERT_KGS: 10,
    ROOM_ENTRAIN: 25, ROOM_JET_TAU: 1.0,
    R_AIR: 0.000287, R_SI: 287, WAVE_P_LO: 0.05, WAVE_U_LO: 0.01,
    CG_TOL: 1e-7, CG_MAX: 200, HIT_LO: 5,
    WATER_RHO: 1000, WATER_BULK: 2.2e9, G_MPA: 9.81e-6,
    LIQ_MANNING: 0.012, LIQ_CD: 0.6, LIQ_V_MAX: 30,
    LIQ_REST: 0.05, LIQ_H_LO: 0.001, LIQ_CG_TOL: 1e-9,
    LIQ_CG_MAX: 400, LIQ_FULL_K: 1 - 1e-4, FACE_TAIL: 16,
    ADV_SWEEPS: 4, POOL_DMIN: 0.01, SPRAY_WE0: 13,
    SPRAY_WE1: 40.3, R_VAP: 0.0004615, PAN_DRAIN_KGS: 20,
    ROOM_VG_MIN: 0.01, ROOM_FR_MIN: 0.1,
    H2_LFL: 0.04, H2_UFL: 0.75, H2_IGN: 773, H2_LHV: 120000,
    H2_MMOL: 0.002016, AIR_MMOL: 0.02896, H2O_MMOL: 0.018015,
    O2_FRAC0: 0.2095, O2_MMOL: 0.032, O2_LOC: 0.05, H2_TURB: 4,
    FLOOD_DROWN: 2 / 3, ROOM_TMAX: 20000, T_SPACE: 3,
    SIGMA: 5.670374419e-8, RHO_K: 7, CP_W: null,
  };
  for (const k of Object.keys(ref)) {
    if (ref[k] === null) { if (!(want[k] > 0)) { console.error('const ' + k + ' missing'); process.exit(2); } continue; }
    if (want[k] !== ref[k]) { console.error('const ' + k + ' = ' + want[k] + ' want ' + ref[k]); process.exit(2); }
  }
  return want;
}

// ---- per-preset structural meta (must match room-probe read_meta order) ----
function dumpMeta(C) {
  const P = M.P(), D = M.D(), S = M.S(), net = P.net;
  const GW = M.GW(), GH = M.GH(), n = GW * GH;
  u32(GW); u32(GH);
  f64(P.MPC !== undefined ? P.MPC : M.MPC());
  f64(P.Pcont); f64(M.loopKg()); f64(M.steamRise()); f64(M.roomSteamH()); f64(P.Tref);
  f64(M.CP_W());
  const layParts = M.LAY().parts;
  u32(layParts.length);
  for (const p of layParts) {
    str(p.id); str(p.role); i32(p.x); i32(p.y); i32(p.w); i32(p.h);
    const m = D.machines && D.machines[p.id];
    const on = m && m.on;
    u8(on ? 1 : 0); if (on) str(on);
  }
  {
    const roles = [...new Set(layParts.map(p => p.role))];
    u32(roles.length);
    for (const r of roles) {
      const rr = M.roleRow(r) || { drown: false, thermal: 'none' };
      str(r); u8(rr.drown ? 1 : 0); str(rr.thermal);
      const ins = M.roleInternal(r);
      u32(ins.length);
      for (const [a, b] of ins) { str(a); str(b); }
    }
  }
  {
    u32(layParts.length);
    for (const p of layParts) {
      const fn = M.partFaceNode(p.id);
      str(p.id); str(fn.t); str(fn.r); str(fn.b); str(fn.l);
    }
  }
  const coreIds = M.coreIds();
  strs(coreIds);
  u32(coreIds.length);
  for (const id of coreIds) { str(id); u32(P.cores[id].NB); }
  f64(D.bkp || 0);
  strs(M.reliefFitIds());
  strs(M.reliefSecIds());
  strs(M.boilerIds());
  {
    const sgIds = M.sgIds();
    u32(sgIds.length);
    for (const id of sgIds) { str(id); str(M.shellNode(id)); }
  }
  u32(layParts.length);
  for (const p of layParts) { str(p.id); str(p.role); }
  u32(layParts.length);
  for (const p of layParts) {
    const m = D.machines && D.machines[p.id];
    const on = m && m.on;
    str(p.id); u8(on ? 1 : 0); if (on) str(on);
  }
  {
    const tids = Object.keys(D.tanks || {});
    u32(tids.length);
    for (const tid of tids) { str(tid); u8(D.tanks[tid] && D.tanks[tid].hold ? 1 : 0); }
  }
  {
    const pri = M.reliefPriIds();
    u8(pri.length ? 1 : 0); if (pri.length) str(pri[0]);
  }
  {
    const rids = M.reliefFitIds();
    u32(rids.length);
    for (const fid of rids) { str(fid); str(M.ventKeyOf(fid) || ''); }
  }
  // circuit count covers every circuit any node/extra can name.
  const circVals = net.name.map(nm => M.circOfNode(nm));
  const nCirc = Math.max(0, ...circVals, M.coreCirc()) + 1;
  {
    u32(nCirc);
    for (let ci = 0; ci < nCirc; ci++) str(M.circBurn(ci));
  }
  {
    const tight = [];
    for (const k of Object.keys(D.mat || {})) {
      const c = k.indexOf(',');
      if (M.matWall(+k.slice(0, c), +k.slice(c + 1))) tight.push(k);
    }
    u32(tight.length);
    for (const k of tight) {
      const c = k.indexOf(',');
      i32(+k.slice(0, c)); i32(+k.slice(c + 1));
    }
  }
  {
    const reg = M.matRegions();
    u32(reg.of.length); i32a(Array.from(reg.of));
    u32(reg.n);
  }
  {
    const fr = M.FIRE();
    const fks = Object.keys(fr);
    u32(fks.length);
    for (const k of fks) {
      const r = fr[k];
      str(k);
      f64a([r.lhv, r.o2, r.ign, r.melt, r.boil, r.lf, r.rate, r.loc, r.emis,
        r.hConv, r.sigma, r.eta, r.wlhv, r.wh2, r.wh2o, r.wrate, r.wast, r.wastMax]);
    }
  }
  {
    const co = M.COOLANT().filter(a => a.burn === Object.keys(M.FIRE())[0])[0] || null;
    u8(co ? 1 : 0);
    if (co) { f64(co.cp); f64(co.dens); f64(co.bulk); }
  }
  {
    const byKey = P.net.byKey instanceof Map ? [...P.net.byKey.entries()] : Object.entries(P.net.byKey || {});
    u32(byKey.length);
    for (const [key, e] of byKey) {
      str(key);
      const cells = e.cells || [];
      u32(cells.length);
      for (const [x, y] of cells) { i32(x); i32(y); }
      str(e.pa || ''); str(e.pb || '');
    }
  }
  {
    const pids = Object.keys(D.ports || {});
    u32(pids.length);
    for (const pid of pids) {
      const c = M.portCell(pid);
      str(pid); u8(c ? 1 : 0);
      if (c) { i32(c[0]); i32(c[1]); }
    }
  }
  {
    const t = (P.net && P.net.fitTarget) || {};
    strs(Object.keys(t).filter(k => t[k]));
    const o = (P.net && P.net.fitVentOut) || {};
    strs(Object.keys(o).filter(k => o[k]));
  }
  strs(net.name);
  {
    u32(net.name.length);
    for (let i = 0; i < net.name.length; i++) { str(net.name[i]); u32(i); }
  }
  u8a(Array.from(net.vapour || new Uint8Array(net.n)));
  i32a(circVals.map(v => (v === undefined || v === null) ? -1 : v));
  {
    u32(nCirc);
    for (let ci = 0; ci < nCirc; ci++) str(M.circKey(ci) || '');
  }
  u8an([...Array(nCirc).keys()].map(ci => (M.coreCircs()[ci] ? 1 : 0)));
  u8a([...Array(nCirc).keys()].map(ci => (M.circAuthored(ci) ? 1 : 0)));
  // extra names the field readers ask: face nodes, run nodes, cavities.
  const extra = new Set();
  for (const p of layParts) {
    const fn = M.partFaceNode(p.id);
    for (const f of [fn.t, fn.r, fn.b, fn.l]) extra.add(f);
  }
  for (const k of Object.keys(S.spillBy || {})) {
    if (k.startsWith('break:') && k.slice(6).indexOf(':') >= 0) extra.add('run:' + k.slice(6));
  }
  for (const id of coreIds) extra.add('cav:' + id);
  {
    const xs = [...extra];
    u32(xs.length);
    for (const nm of xs) { str(nm); i32(M.circOfNode(nm)); }
  }
  // base G (static per preset; the live hole overlay is recomputed).
  {
    const G = M.roomGeom();
    if (process.env.GATE_DEBUG2) console.error('meta face04=' + Array.from(G.face.slice(0, 4)) + ' occ04=' + Array.from(G.occ.slice(0, 4)));
    u32(n);
    u8a(Array.from(G.occ)); u8a(Array.from(G.tight)); u8raw(Array.from(G.face));
    i32a(Array.from(G.own)); u8a(Array.from(G.pan)); f64a(Array.from(G.turb));
    u32(G.parts.length);
    for (const q of G.parts) { str(q.p.id); u32(q.cells.length); u32a(q.cells); }
    u32(G.runs.length);
    for (const r of G.runs) { str(r.key); u32(r.cells.length); u32a(r.cells); }
    {
      const sks = Object.keys(G.shellValves || {});
      u32(sks.length);
      for (const k of sks) { str(k); strs(G.shellValves[k]); }
    }
    f64a(Array.from(G.bx)); f64a(Array.from(G.by)); f64a(Array.from(G.gx));
    f64a(Array.from(G.gUp)); f64a(Array.from(G.gDn));
  }
  return { coreIds, n, layParts, nCirc };
}

// ---- per-preset curves (must match room-probe read_curves order) ----
function dumpCurves(meta) {
  const n = meta.nCirc;
  u32(n);
  for (let ci = 0; ci < n; ci++) f64a(KEYS.map(k => num(M.satOfCirc(ci)[k])));
  f64a(KEYS.map(k => num(M.satWater()[k])));
  f64a([...Array(n).keys()].map(ci => M.holdSetP(ci)));
}

// ---- samples ----
const F64KEYS = ['roomMax', 'roomPMax', 'roomBurnOn', 'roomFireOn', 'Tavg', 'h2',
  'load', 'loadDem', 'burnKg', 'burnP', 'burnBlast', 'fireKg', 'fireP', 'fireQ'];
// NOTE: burn*/fire* live on S as burnEv/fireEv latch objects; the rest are S scalars.
const U8KEYS = ['blackout', 'bkpLost', 'sgtr'];
const I32KEYS = ['roomMaxAt'];
const MAPKEYS = ['partT', 'skinQ', 'runT', 'panBy', 'TavgBy', 'reliefSteam', 'sgVentBy', 'sgH2By',
  'sgTBy', 'condTBy', 'radTBy'];
const BAGKEYS = ['mBy', 'hBy', 'pBy'];
const F64GRIDS = ['roomT', 'roomPool', 'roomPoolE', 'roomWater', 'roomWaterE'];
const F32GRIDS = ['roomM', 'roomH2', 'roomO2', 'roomVap', 'roomFlame', 'roomP', 'roomPPk',
  'roomScar', 'roomScarCur', 'roomPU', 'roomPV', 'roomPoolU', 'roomPoolV',
  'roomWU', 'roomWV', 'roomWP', 'roomPoolP'];
const fnum = v => (v === undefined || v === null) ? NaN : (typeof v === 'boolean' ? (v ? 1 : 0) : v);
const smap = o => {
  o = o || {};
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
  const S = M.S(), P = M.P();
  const snap = {
    f: {}, b: {}, i: {}, maps: {}, bags: {}, cores: {}, room: {},
    dmgParts: (S.dmgParts || []).slice(), dmgWhy: { ...(S.dmgWhy || {}) },
    massOut: { ...(S.massOut || {}) },
    burn: { ...(S.burnEv || {}) }, burnIds: ((S.burnEv && S.burnEv.ids) || []).slice(),
    fire: { ...(S.fireEv || {}) }, inject: S.inject,
  };
  for (const k of F64KEYS) {
    if (k.startsWith('burn')) snap.f[k] = snap.burn[k.slice(4).toLowerCase()];
    else if (k.startsWith('fire')) snap.f[k] = snap.fire[k.slice(4).toLowerCase()];
    else snap.f[k] = S[k];
  }
  for (const k of U8KEYS) snap.b[k] = S[k];
  for (const k of I32KEYS) snap.i[k] = S[k];
  for (const k of MAPKEYS) snap.maps[k] = S[k] === undefined ? undefined : { ...S[k] };
  for (const k of BAGKEYS) {
    const h = S[k];
    snap.bags[k] = !h || !h.v ? undefined : { v: Array.from(h.v), has: Array.from(h.has || []) };
  }
  for (const id of meta.coreIds) {
    const cs = S.coreBy && S.coreBy[id];
    snap.cores[id] = cs ? {
      rodJam: !!cs.rodJam, rodDem: cs.rodDem, tiltDem: cs.tiltDem,
      rodZDem: Array.from(cs.rodZDem || []), rodPos: cs.rodPos, tilt: cs.tilt,
      rodZ: Array.from(cs.rodZ || []),
    } : undefined;
  }
  const n = meta.n;
  for (const k of [...F64GRIDS, ...F32GRIDS]) snap.room[k] = S[k] ? Array.from(S[k]) : new Array(n).fill(0);
  snap.logLen = M.LOG().length;
  snap.warns = consoleWarns;
  return snap;
}

let consoleWarns = 0;
const realWarn = console.warn;
console.warn = (...a) => { consoleWarns++; return realWarn(...a); };
function restoreState(meta, snap) {
  const S = M.S(), P = M.P();
  for (const k of F64KEYS) {
    if (k.startsWith('burn') || k.startsWith('fire')) continue;
    if (snap.f[k] === undefined) delete S[k];
    else S[k] = snap.f[k];
  }
  Object.assign(S.burnEv, snap.burn);
  S.burnEv.ids.length = 0;
  for (const x of snap.burnIds) S.burnEv.ids.push(x);
  Object.assign(S.fireEv, snap.fire);
  for (const k of U8KEYS) {
    if (snap.b[k] === undefined) delete S[k];
    else S[k] = snap.b[k];
  }
  for (const k of I32KEYS) {
    if (snap.i[k] === undefined) delete S[k];
    else S[k] = snap.i[k];
  }
  for (const k of MAPKEYS) {
    if (snap.maps[k] === undefined) delete S[k];
    else {
      if (S[k] === undefined || S[k] === null) S[k] = {};
      for (const x of Object.keys(S[k])) delete S[k][x];
      Object.assign(S[k], snap.maps[k]);
    }
  }
  for (const k of BAGKEYS) {
    const was = snap.bags[k], h = S[k];
    if (was === undefined) continue;
    h.v.set(was.v);
    h.has.set(padTo(was.has, was.v.length));
  }
  for (const id of meta.coreIds) {
    const cs = S.coreBy && S.coreBy[id], w = snap.cores[id];
    if (cs && w) {
      cs.rodJam = w.rodJam; cs.rodDem = w.rodDem; cs.tiltDem = w.tiltDem;
      cs.rodZDem.set(w.rodZDem); cs.rodPos = w.rodPos; cs.tilt = w.tilt;
      cs.rodZ.set(w.rodZ);
    }
  }
  S.dmgParts.length = 0;
  for (const x of snap.dmgParts) S.dmgParts.push(x);
  for (const x of Object.keys(S.dmgWhy)) delete S.dmgWhy[x];
  Object.assign(S.dmgWhy, snap.dmgWhy);
  for (const x of Object.keys(S.massOut)) delete S.massOut[x];
  Object.assign(S.massOut, snap.massOut);
  for (const k of [...F64GRIDS, ...F32GRIDS]) if (S[k]) S[k].set(snap.room[k]);
  S.inject = snap.inject;
  M.LOG().length = snap.logLen;
  consoleWarns = snap.warns;
}

// probe read_state order.
function dumpState(meta, S, P) {
  const n = meta.n;
  u32(F64KEYS.length);
  for (const k of F64KEYS) {
    let v;
    if (k.startsWith('burn')) v = (S.burnEv || {})[k.slice(4).toLowerCase()];
    else if (k.startsWith('fire')) v = (S.fireEv || {})[k.slice(4).toLowerCase()];
    else v = S[k];
    str(k); f64(fnum(v));
  }
  u32(U8KEYS.length);
  for (const k of U8KEYS) { str(k); u8(S[k] ? 1 : 0); }
  u32(I32KEYS.length);
  for (const k of I32KEYS) { str(k); i32(S[k] | 0); }
  u32(MAPKEYS.length);
  for (const k of MAPKEYS) {
    const o = S[k] || {};
    const ks = Object.keys(o).filter(x => o[x] !== undefined);
    str(k); u32(ks.length); strsRaw(ks); f64a(ks.map(x => fnum(o[x])));
  }
  u32(BAGKEYS.length);
  for (const k of BAGKEYS) {
    const h = S[k];
    str(k);
    if (!h || !h.v) u32(0);
    else {
      const v = Array.from(h.v);
      u32(v.length); f64a(v); u8a(padTo(Array.from(h.has || []), v.length));
    }
  }
  for (const id of meta.coreIds) {
    const cs = S.coreBy && S.coreBy[id];
    const w = cs || {};
    u8(w.rodJam ? 1 : 0);
    f64(fnum(w.rodDem)); f64(fnum(w.tiltDem));
    const zd = w.rodZDem ? Array.from(w.rodZDem) : [];
    u32(zd.length); f64a(zd.map(num));
    f64(fnum(w.rodPos)); f64(fnum(w.tilt));
    const rz = w.rodZ ? Array.from(w.rodZ) : [];
    u32(rz.length); f64a(rz.map(num));
  }
  u32((S.dmgParts || []).length); strsRaw(S.dmgParts || []);
  {
    const ks = Object.keys(S.dmgWhy || {});
    u32(ks.length);
    for (const k of ks) { str(k); str(S.dmgWhy[k]); }
  }
  strmap(S.massOut || {});
  f64(fnum((S.burnEv || {}).kg)); f64(fnum((S.burnEv || {}).p)); f64(fnum((S.burnEv || {}).blast));
  {
    const ids = ((S.burnEv && S.burnEv.ids) || []);
    u32(ids.length); strsRaw(ids);
  }
  f64(fnum((S.fireEv || {}).kg)); f64(fnum((S.fireEv || {}).p)); f64(fnum((S.fireEv || {}).q));
  {
    const all = [...F64GRIDS.map(k => [k, 0]), ...F32GRIDS.map(k => [k, 1])];
    u32(all.length);
    for (const [k, ty] of all) {
      const v = S[k] ? Array.from(S[k]) : new Array(n).fill(0);
      str(k); u8(ty);
      u32(v.length);
      if (ty === 0) f64a(v); else f32a(v);
    }
  }
}

// probe read_inputs order.
const INJKINDS = { heat: 0, gas: 1, fluid: 2, h2: 3, o2: 4, steam: 5 };
function dumpInputs(meta) {
  const S = M.S(), P = M.P(), net = P.net;
  {
    const sk = Object.keys(S.spillBy || {});
    u32(sk.length); strsRaw(sk);
    f64a(sk.map(k => num(S.spillBy[k])));
  }
  {
    const rk = Object.keys(S.reliefVent || {});
    u32(rk.length); strsRaw(rk);
    f64a(rk.map(k => num(S.reliefVent[k])));
  }
  {
    const keys = [...new Set([
      ...Object.keys(S.spillBy || {}),
      ...Object.keys(S.reliefVent || {}).map(fid => M.ventKeyOf(fid)),
    ])];
    const o = {}, h = {}, b = {};
    for (const k of keys) { o[k] = num(M.outKg(net, k)); h[k] = num(M.outH2(net, k)); b[k] = num(M.boreOf(k)); }
    strmap(o); strmap(h); strmap(b);
  }
  {
    const q = S.inject;
    const ok = q && typeof q === 'object' && INJKINDS[q.kind] !== undefined && q.rate
      && typeof q.target === 'number' && q.target >= 0 && q.target < meta.n;
    if (process.env.GATE_DEBUG2) console.error('dumpInputs inj ok=' + !!ok + ' q=' + JSON.stringify(q));
    u8(ok ? 1 : 0);
    if (ok) { u8(INJKINDS[q.kind]); f64(num(q.rate)); i32(q.target); }
  }
  u32(M.roomCgIt() | 0); u32(M.roomPGen() | 0);
  {
    const gx = M.gsX();
    u32(gx.length); f64a(gx.map(num));
  }
  f64a(M.gsDisp().map(num));
}

const SEVMAP = { alarm: 0, warn: 1, info: 2 };
function mapEvent(e) {
  for (const code of Object.keys(EVMSG)) {
    const [sev, pat] = EVMSG[code];
    if (e.sev !== sev) continue;
    if (e.msg.startsWith(pat)) return [SEVMAP[sev], +code];
  }
  console.error('unmapped room log: ' + e.sev + ' ' + e.msg);
  process.exit(2);
}

// One sample: snapshot pre, dump inputs, run REAL sumpStep + roomStep,
// encode expected, dump post, restore.
function runSample(meta, tag, mut) {
  const S = M.S(), P = M.P();
  const clean = snapState(meta);
  let cleanup = null;
  if (mut) cleanup = mut(S, P) || null;
  u32(tag); f64(DT);
  if (process.env.GATE_DEBUG2) console.error('sample tag=' + tag + ' preW0=' + S.roomWater[0] + ' preT0=' + S.roomT[0] + ' W1116=' + S.roomWater[1116] + ' live=[' + M.liqLive() + ']');
  if (process.env.GATE_DEBUG) console.error('sample tag=' + tag + ' inputs');
  dumpInputs(meta);
  if (process.env.GATE_DEBUG) console.error('sample tag=' + tag + ' state');
  dumpState(meta, S, P);
  if (process.env.GATE_DEBUG) console.error('sample tag=' + tag + ' fns');
  const log0 = M.LOG().length;
  const cg0 = consoleWarns;
  const cwSave = M.cgCapKeys();
  M.cgCapClear();
  M.liqCgReset();
  M.sumpStep(S, DT);
  if (process.env.GATE_DEBUG) console.error('sample tag=' + tag + ' sump done');
  if (process.env.GATE_DEBUG2) console.error('sample tag=' + tag + ' postsump W1116=' + S.roomWater[1116] + ' live=[' + M.liqLive() + ']');
  if (process.env.GATE_DEBUG2) console.error('sample tag=' + tag + ' jets=[' + M.jetDbg() + ']');
  if (process.env.GATE_DEBUG2) console.error('sample tag=' + tag + ' sump=[' + M.sumpDbg() + ']');
  if (process.env.GATE_DEBUG2) console.error('sample tag=' + tag + ' pre1116=M' + S.roomM[1116] + ',V' + S.roomVap[1116] + ',T' + S.roomT[1116] + ',W' + S.roomWater[1116] + ',WE' + S.roomWaterE[1116]);
  if (process.env.GATE_DEBUG2 && tag === 6) console.error('sample tag=6 prePPk69=' + S.roomPPk[69] + ' preP69=' + S.roomP[69]);
  if (process.env.GATE_DEBUG2 && tag === 6) console.error('sample tag=6 preM69=' + S.roomM[69] + ' preT69=' + S.roomT[69] + ' preW69=' + S.roomWater[69]);
  if (process.env.GATE_DEBUG2) console.error('sample tag=' + tag + ' pre72=M' + S.roomM[72] + ',V' + S.roomVap[72] + ',T' + S.roomT[72] + ',P' + S.roomP[72] + ',W' + S.roomWater[72] + ',WE' + S.roomWaterE[72]);
  M.roomStep(S, DT);
  if (process.env.GATE_DEBUG) console.error('sample tag=' + tag + ' room done');
  const evs = M.LOG().slice(log0).map(mapEvent);
  const warns = consoleWarns - cg0;
  M.cgCapRestore(cwSave);
  u32(M.roomCgIt() | 0); u32(M.liqCgIt() | 0);
  u32(evs.length);
  for (const [sv2, code] of evs) { u8(sv2); u32(code); }
  u32(warns);
  if (process.env.GATE_DEBUG2) console.error('sample tag=' + tag + ' post1116=M' + S.roomM[1116] + ',V' + S.roomVap[1116] + ',T' + S.roomT[1116] + ',W' + S.roomWater[1116] + ',WE' + S.roomWaterE[1116]);
  if (process.env.GATE_DEBUG2 && tag === 4) console.error('sample tag=4 postFireKg=' + ((S.fireEv || {}).kg) + ' postFireOn=' + S.roomFireOn);
  if (process.env.GATE_DEBUG2 && tag === 6 && meta.presetIdx === 0) { console.error('POST69 M' + S.roomM[69] + ' T' + S.roomT[69] + ' W' + S.roomWater[69] + ' P' + S.roomP[69]); }
  if (process.env.GATE_DEBUG2 && tag === 4) console.error('sample tag=4 firedbg=[' + M.fireDbg() + ']');
  if (process.env.GATE_DEBUG2 && tag === 4) console.error('sample tag=4 preFireKg=' + ((M.S().fireEv || {}).kg) + ' preFireOn=' + M.S().roomFireOn);
  if (process.env.GATE_DEBUG2 && tag === 1) console.error('sample tag=1 c128post p' + meta.presetIdx + ' W' + S.roomWater[128] + ',WE' + S.roomWaterE[128] + ',T' + S.roomT[128] + ',M' + S.roomM[128]);
  if (process.env.GATE_DEBUG2 && tag === 1 && meta.presetIdx === 8) { fs.writeFileSync(path.join(os.tmpdir(), 'p8s1-js-b.txt'), M.lqBv().join(',')); fs.writeFileSync(path.join(os.tmpdir(), 'p8s1-js-x.txt'), M.lqXv().join(',')); fs.writeFileSync(path.join(os.tmpdir(), 'p8s1-js-fx.txt'), M.lqFxv().join(',')); fs.writeFileSync(path.join(os.tmpdir(), 'p8s1-js-fy.txt'), M.lqFyv().join(',')); fs.writeFileSync(path.join(os.tmpdir(), 'p8s1-js-di.txt'), M.lqDIv().join(',')); fs.writeFileSync(path.join(os.tmpdir(), 'p8s1-js-ax.txt'), M.lqAxv().join(',')); fs.writeFileSync(path.join(os.tmpdir(), 'p8s1-js-ay.txt'), M.lqAyv().join(',')); }
  if (process.env.GATE_DEBUG2 && tag === 1) console.error('sample tag=1 c128pre p' + meta.presetIdx + ' W' + S.roomWater[128] + ',WE' + S.roomWaterE[128] + ',T' + S.roomT[128] + ',M' + S.roomM[128]);
  if (process.env.GATE_DEBUG2 && tag === 1 && meta.presetIdx === 8) { fs.writeFileSync(path.join(os.tmpdir(), 'p8s1-js-w.txt'), Buffer.from(S.roomWater.buffer, S.roomWater.byteOffset, S.roomWater.byteLength)); fs.writeFileSync(path.join(os.tmpdir(), 'p8s1-js-we.txt'), Buffer.from(S.roomWaterE.buffer, S.roomWaterE.byteOffset, S.roomWaterE.byteLength)); }
  dumpState(meta, S, P);
  restoreState(meta, clean);
  if (cleanup) cleanup();
  return 1;
}

const presetNames = [];
let nSamples = 0;
const skipped = { noNet: 0, synthSkip: 0 };
const presets = [];
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
  if (process.env.GATE_DEBUG) console.error('preset ' + k + ' meta done');
  dumpCurves(meta);
  if (process.env.GATE_DEBUG) console.error('preset ' + k + ' curves done');
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
  const synths = [
    ['flood', s => { // deep water over the first machine row
      if (!s.roomWater) return false;
      for (let i = 0; i < s.roomWater.length; i++) s.roomWater[i] += 400;
    }],
    ['wallshot', s => { // breached wall cell (hole overlay)
      const ks = Object.keys(D.mat || {});
      if (!ks.length) return false;
      const k = ks[0], c = k.indexOf(',');
      s.dmgParts.push('mat:' + k); s.dmgWhy['mat:' + k] = 'BURST';
    }],
    ['h2burn', (s, Pv) => { // hydrogen + heat to light
      const n = s.roomH2.length;
      const i = (n / 2) | 0;
      s.roomH2[i] += 30; s.roomO2[i] += 30;
      s.roomT[i] = 900;
    }],
    ['pool', s => { // sodium pool + hot deck
      const n = s.roomPool.length;
      const i = (n / 2) | 0;
      s.roomPool[i] += 60; s.roomPoolE[i] += 2000;
      s.roomT[i] = 700;
    }],
    ['steam', s => { // steam over saturation (condense path)
      const n = s.roomVap.length;
      const i = (n / 4) | 0;
      s.roomVap[i] += 40; s.roomM[i] += 40;
    }],
    ['relief', s => { // relief steam jet into the room
      const fids = M.reliefSecIds();
      if (!fids.length) return false;
      s.reliefSteam[fids[0]] = (s.reliefSteam[fids[0]] || 0) + 25;
    }],
    ['blackout', s => { s.blackout = true; }],
    ['wreck', s => { // wrecked machine (vent skip + spark)
      const p = M.LAY().parts[0];
      if (!p) return false;
      s.dmgParts.push(p.id); s.dmgWhy[p.id] = 'WRECK';
    }],
    ['inject', s => { // INJECT fluid order onto mid deck
      s.inject = { kind: 'fluid', rate: 300, target: (s.roomWater.length / 2) | 0 };
    }],
    ['injectheat', s => {
      s.inject = { kind: 'heat', rate: 500, target: (s.roomWater.length / 3) | 0 };
    }],
    ['tankover', s => { // secondary tank overflow path
      const ids = M.secTankIds ? M.secTankIds() : [];
      if (!ids.length) return false;
      s.tank[ids[0]] = 99.99;
    }],
    ['cav', s => {
      const ids = M.pumpIds ? M.pumpIds() : [];
      if (!ids.length) return false;
      s.cavP[ids[0]] = 0.9;
    }],
    ['sgburst', s => {
      const ids = M.sgIds();
      if (!ids.length) return false;
      if (!s.sgBurst) return false;
      s.sgBurst[ids[0]] = true;
    }],
    ['flame', s => { // mid-burn front continuation
      const i = (s.roomFlame.length / 2) | 0;
      s.roomFlame[i] = 0.5; s.roomH2[i] += 5;
    }],
    ['scar', s => { // pre-scarred passage tracker
      const i = (s.roomScar.length / 3) | 0;
      s.roomScarCur[i] = 40; s.roomP[i] += 30;
    }],
  ];
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
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'room-probe', '--', fIn],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RUSTUP_TOOLCHAIN: '1.89.0-x86_64-pc-windows-gnu' } });
console.log(out.trim());
console.log('skipped=' + JSON.stringify(skipped));
const pass = /FAILURES=0/.test(out);
if (pass) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'room-baseline.json'), JSON.stringify({
    presets: presetNames, ticks: TICKS, samples: nSamples,
  }, null, 1) + '\n');
}
if (!process.env.KEEP_TMP) fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);

