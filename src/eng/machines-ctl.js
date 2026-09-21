"use strict";
// exports: eCtlSeed eCtlSeedOut eCtlSeedOuts eCtlPass eCtlLive eSupplyK eSigRead eSinkRead eSinkPart eSinkDriver eSinkWired eBlkBlame eScramArm eRpsState eTripNear eResetVeto eRodDriven eRunbackLive eRunbackWired eRunbackNow eTProg eUnitFrac eTurbShare eReliefCmd eSigCode eSinkCode eBlkModeCode eBlkOpCode eBlkArgIndex E_SIG_KEYS E_SINK_KEYS E_BLK_MODES E_KN_N
// imports: eRodApply eScramSink eNearTrip eTavgOf eLoopP eTankLvl eH2Total eBoilerLvl eBoilerP eFeedWant eBleedPlant eRadTMax eSglMin eTankPoolPctHosted

const E_BLK_MODES = ["source","const","math","pid","integ","limit","lag","compare","latch","sel","sink"];
const E_BM_SOURCE=0, E_BM_CONST=1, E_BM_MATH=2, E_BM_PID=3, E_BM_INTEG=4, E_BM_LIMIT=5, E_BM_LAG=6, E_BM_COMPARE=7, E_BM_LATCH=8, E_BM_SEL=9, E_BM_SINK=10;
const E_OPS = {math:["add","sub","mul","div","min","max"], sel:["max","min","median"], compare:["above","below"]};
const E_KN_SIG=0, E_KN_ARG=1, E_KN_V=2, E_KN_OP=3, E_KN_K=4, E_KN_KP=5, E_KN_TI=6, E_KN_TD=7, E_KN_DB=8, E_KN_N_=9,
      E_KN_LO=10, E_KN_HI=11, E_KN_RATE=12, E_KN_TAU=13, E_KN_SINK=14, E_KN_ON=15, E_KN_OFF=16, E_KN_N=17;
const E_KN_NAMES = ["sig","arg","v","op","k","kp","ti","td","db","n","lo","hi","rate","tau","sink","on","off"];

const E_SIG_KEYS = ["pwr","dnbr","tf","tavg","th","tc","prs","sub","lvl","sgl","hot","inv","flow","load","rod","bor","xe","exp","dis",
  "fq","ao","ro","rho","vd","dmg","fat","cav","nat","rel","dec","rad","cdos","mlt","h2","rp","dnbm","radt",
  "nfr","tprog","dtavg","tfrac","rodd","trip","scc","heat","rpsset","rpsnear","sglv","sgp","sgst","sgfed","sgwant","sglo",
  "pumpq","pumpd","fitp","fitopen","fitlift","fitreseat","valve","tankl","loopp","loopset","supply","dark","turbtr","time",
  "cntp","slp","prsf"];
const E_SCOPE_PLANT=0, E_SCOPE_CORE=1, E_SCOPE_SG=2, E_SCOPE_PUMP=3, E_SCOPE_FIT=4, E_SCOPE_RPSCH=5, E_SCOPE_TANK=6, E_SCOPE_LOOP=7;
const E_SCOPE_NAMES = ["plant","core","sg","pump","fit","rpsch","tank","loop"];

const E_SINK_KEYS = ["rodStep","freg","relief","flowDem","loadDem","boronDem","valveDem","tankOpen","scram","nearTrip","runback"];
const E_SK_ROD=0, E_SK_FREG=1, E_SK_RELIEF=2, E_SK_FLOW=3, E_SK_LOAD=4, E_SK_BORON=5, E_SK_VALVE=6, E_SK_TANK=7, E_SK_SCRAM=8, E_SK_NEAR=9, E_SK_RUNBACK=10;
const E_SINK_SCOPE = [1,2,4,3,0,0,4,6,1,1,0];

const E_TPROG_SPAN = 18, E_RPS_NEAR = 0.03;
const E_RPS_ARMED = 0, E_RPS_BYPASSED = 1, E_RPS_NONE = 2;

/* codes for the UI and act(): the tick never sees a string */
const eSigCode = k => E_SIG_KEYS.indexOf(k);
const eSinkCode = k => E_SINK_KEYS.indexOf(k);
const eBlkModeCode = m => E_BLK_MODES.indexOf(m);
function eBlkOpCode(mode, op){ const l = E_OPS[mode]; return l ? Math.max(0, l.indexOf(op)) : 0; }
function eBlkArgIndex(scope, arg){
  if(arg == null) return -1;
  switch(scope){
    case "core": return IX.core.has(arg) ? IX.core.get(arg) : -1;
    case "sg": return IX.boiler.has(arg) ? IX.boiler.get(arg) : -1;
    case "pump": return IX.pump.has(arg) ? IX.pump.get(arg) : -1;
    case "fit": return IX.fit.has(arg) ? IX.fit.get(arg) : -1;
    case "tank": return IX.tank.has(arg) ? IX.tank.get(arg) : -1;
    case "rpsch": { for(let i=0;i<RPS_CH.length;i++) if(RPS_CH[i][0] === arg) return i; return -1; }
    case "loop": { const v = +arg; return isFinite(v) ? v : -1; }
  }
  return -1;
}
const eKnob = (k, q) => ST.blkKn[k*E_KN_N + q];

/* the design's blocks onto the state columns; a knob left blank is NaN, and a blank PID gain takes the plant's rod tune */
function eCtlSeed(){
  const nk = PT.n.block, ids = IX.blockId;
  ST.blkIn.fill(-1); ST.blkKn.fill(E_NAN);
  for(let k=0;k<nk;k++){ const b = D.blocks[ids[k]], mode = b.mode, m = BLK[mode], o = k*E_KN_N;
    for(let i=0;i<3;i++){ const src = b.in && b.in[i]; ST.blkIn[k*3+i] = (src && IX.block.has(src)) ? IX.block.get(src) : -1; }
    const knob = (name, dflt) => { const v = b[name] !== undefined ? b[name] : dflt; return v == null ? E_NAN : v; };
    if(m) for(const name in m.knobs){ const q = E_KN_NAMES.indexOf(name); if(q < 0) continue;
      const v = knob(name, m.knobs[name]);
      if(name === "sig") ST.blkKn[o+q] = eSigCode(v);
      else if(name === "sink") ST.blkKn[o+q] = eSinkCode(v);
      else if(name === "op") ST.blkKn[o+q] = eBlkOpCode(mode, v);
      else if(name === "arg") ST.blkKn[o+q] = -1;
      else if(name === "on") ST.blkKn[o+q] = typeof b.on === "number" ? b.on : m.knobs.on;
      else ST.blkKn[o+q] = typeof v === "number" ? v : E_NAN; }
    if(mode === "source"){ const r = SIGNAL[b.sig]; ST.blkKn[o+E_KN_ARG] = eBlkArgIndex(r ? r.scope : "plant", b.arg); }
    if(mode === "sink"){ const r = SINK[b.sink]; ST.blkKn[o+E_KN_ARG] = eBlkArgIndex(r ? r.scope : "plant", b.arg); }
    if(mode === "pid"){
      if(!(ST.blkKn[o+E_KN_KP] === ST.blkKn[o+E_KN_KP])) ST.blkKn[o+E_KN_KP] = PK[PK_ARKP];
      if(!(ST.blkKn[o+E_KN_TI] === ST.blkKn[o+E_KN_TI])) ST.blkKn[o+E_KN_TI] = PK[PK_ARTI];
      if(!(ST.blkKn[o+E_KN_TD] === ST.blkKn[o+E_KN_TD])) ST.blkKn[o+E_KN_TD] = PK[PK_ARTD]; }
    ST.blkOn[k] = b.on === false ? 0 : 1;
    ST.blkOutV[k] = 0; ST.blkOutF[k] = 0; }
}

const eSupplyK = () => ST.sc[SC_BLACKOUT] ? (ST.sc[SC_BKPLOST] ? 0 : PK[PK_BACKUP]) : 1;
const eCtlLive = () => PT.ctrlPart >= 0 && !ST.dmgBy[PT.ctrlPart] && eSupplyK() > 0;

function eSinkPart(code, arg){
  switch(code){
    case E_SK_ROD: return arg >= 0 ? PT.coreRodsPart[arg] : -1;
    case E_SK_FREG: return arg >= 0 ? PT.boilerPart[arg] : -1;
    case E_SK_RELIEF: case E_SK_VALVE: return arg >= 0 ? PT.fitPart[arg] : -1;
    case E_SK_FLOW: return arg >= 0 ? PT.pumpPart[arg] : -1;
    case E_SK_LOAD: case E_SK_RUNBACK: return PT.turbRolePart;
    case E_SK_TANK: return arg >= 0 ? PT.tankPart[arg] : -1;
    case E_SK_SCRAM: case E_SK_NEAR: return arg >= 0 ? PT.corePart[arg] : -1;
  }
  return -1;
}
function eSinkRead(code, arg){
  const s = ST, sc = s.sc;
  switch(code){
    case E_SK_ROD: return arg >= 0 ? s.csRodDem[arg] : sc[SC_RODDEM];
    case E_SK_FREG: return arg >= 0 ? s.fregBy[arg] : 0;
    case E_SK_RELIEF: { const v = arg >= 0 ? PT.fitRelief[arg] : -1; return v >= 0 && s.reliefOpen[v] ? 1 : 0; }
    case E_SK_FLOW: return arg >= 0 ? s.flowDemBy[arg]*100 : 0;
    case E_SK_LOAD: return sc[SC_LOADDEM]*100;
    case E_SK_BORON: return sc[SC_BORONDEM];
    case E_SK_VALVE: { const w = arg >= 0 ? PT.fitThrottle[arg] : -1; return w >= 0 ? s.valveDem[w]*100 : 0; }
    case E_SK_TANK: return arg >= 0 && s.tankOpen[arg] ? 1 : 0;
    case E_SK_SCRAM: return (arg >= 0 ? s.csScrammed[arg] : sc[SC_SCRAMMED]) ? 1 : 0;
    case E_SK_NEAR: return arg >= 0 && s.csRpsNear[arg] ? 1 : 0;
    case E_SK_RUNBACK: return sc[SC_RBHOT] ? 1 : 0;
  }
  return 0;
}
/* a block switched off is still the block wired to this demand; a live block wins over a switched-off peer */
function eSinkWired(code, arg, onOnly){
  if(!eCtlLive()) return -1;
  const nk = PT.n.block; let off = -1;
  for(let k=0;k<nk;k++){
    if(PT.blkMode[k] !== E_BM_SINK || eKnob(k, E_KN_SINK) !== code) continue;
    const a = eKnob(k, E_KN_ARG); if(!(a < 0 || a === arg)) continue;
    if(ST.blkIn[k*3] < 0) continue;
    if(ST.blkOn[k]) return k;
    if(off < 0) off = k; }
  return onOnly ? -1 : off;
}
const eSinkDriver = (code, arg) => eSinkWired(code, arg, true);
const eRodDriven = c => eSinkDriver(E_SK_ROD, c) >= 0;
const eRunbackLive = () => eSinkDriver(E_SK_RUNBACK, -1) >= 0;
const eRunbackWired = () => eSinkWired(E_SK_RUNBACK, -1, false) + 1;

/* the deepest hot NAMED block upstream, so a trip's word comes out of the drawn graph; -1 when nothing named is hot */
let eBlameGen = 0;
function eBlkBlame(k){ eBlameGen++; return eBlameWalk(k); }
function eBlameWalk(k){
  if(k < 0 || SX.blkSeen[k] === eBlameGen) return -1;
  SX.blkSeen[k] = eBlameGen;
  const m = PT.blkMode[k];
  if(m === E_BM_SOURCE || m === E_BM_CONST) return -1;
  for(let i=0;i<3;i++){ const u = ST.blkIn[k*3+i];
    if(u < 0 || !(ST.blkOutV[u] > 0.5)) continue;
    const d = eBlameWalk(u); if(d >= 0) return d; }
  return PT.blkNamed[k] ? k : -1;
}

const E_CT = new Float64Array(4);
function eUnitFracA(){
  const x = E_CT[0];
  let live = 0;
  for(let c=0;c<PT.n.core;c++) if(!ST.csScrammed[c]) live += PT.coreRated[c];
  E_CT[0] = (live > 0 && live !== PK[PK_RATED]) ? Math.min(1, x*PK[PK_RATED]/live) : x;
}
const eUnitFrac = x => { E_CT[0] = x; eUnitFracA(); return E_CT[0]; };
function eTurbShareA(){ if(PK[PK_STEAMREF] > 0){ eBleedPlantA(); E_CT[1] = (ST.sc[SC_TURBWK] + E_BLD[0])/PK[PK_STEAMREF]; } else E_CT[1] = 0; }
const eTurbShare = () => { eTurbShareA(); return E_CT[1]; };
/* where T-avg is meant to sit for the load the turbine draws; c < 0 asks the plant */
function eTProgA(c){
  const sc = ST.sc, scr = c >= 0 ? ST.csScrammed[c] : sc[SC_SCRAMMED], Tref = c >= 0 ? PT.coreTprog[c] : PK[PK_TREF];
  if(scr && eRunbackLive()){ E_CT[2] = Tref - E_TPROG_SPAN; return; }
  if(c >= 0 ? PT.coreSteam[c] : P.steam){ E_CT[2] = Tref; return; }
  let f = sc[SC_LOAD];
  if(c >= 0){ E_CT[0] = f; eUnitFracA(); f = E_CT[0]; }
  E_CT[2] = Tref - E_TPROG_SPAN + E_TPROG_SPAN*f;
}
const eTProg = c => { eTProgA(c); return E_CT[2]; };
function eRunbackNow(){
  const sc = ST.sc; let live = 0;
  for(let c=0;c<PT.n.core;c++) if(!ST.csScrammed[c]) live += PT.coreRated[c];
  sc[SC_LOAD] = sc[SC_LOADDEM] = Math.min(sc[SC_LOAD], Math.max(0.05, PK[PK_RATED] > 0 ? live/PK[PK_RATED] : 0));
}

/* a PORV sticks only if armed; a stuck or hand-opened valve does not shut on an order. Returns whether anything moved */
function eReliefCmd(v, open){
  const s = ST;
  if(open){ if(s.reliefOpen[v]) return false;
    s.reliefOpen[v] = 1; s.reliefAuto[v] = 1; s.reliefStuck[v] = s.reliefArm[v]; s.reliefArm[v] = 0;
    if(PT.reliefSec[v]) eEvent(EV_SG_RELIEF_LIFT, v, 0);
    return true; }
  if(!(s.reliefOpen[v] && s.reliefAuto[v] && !s.reliefStuck[v])) return false;
  s.reliefOpen[v] = 0; s.reliefAuto[v] = 0; return true;
}

/* one plant quantity, of one machine where it has one; a core-scoped signal with arg < 0 reads the plant */
const E_SIG = new Float64Array(3);
function eSigReadA(sig, a){
  const s = ST, sc = s.sc, c = a, o = E_SIG;
  switch(sig){
    case 0: o[0] = (c >= 0 ? s.csN[c] : sc[SC_N])*100; return;
    case 1: o[0] = c >= 0 ? s.csDnbr[c] : sc[SC_DNBR]; return;
    case 2: o[0] = c >= 0 ? s.csTf[c] : sc[SC_TF]; return;
    case 3: eSigTavgA(c); o[0] = E_CT[3]; return;
    case 4: eSigTavgA(c); o[0] = E_CT[3] + (c >= 0 ? s.csCoreDT[c] : sc[SC_COREDT])/2; return;
    case 5: eSigTavgA(c); o[0] = E_CT[3] - (c >= 0 ? s.csCoreDT[c] : sc[SC_COREDT])/2; return;
    case 6: if(c >= 0){ eLoopPA(PT.coreCirc[c]); o[0] = E_LP[0]; } else o[0] = sc[SC_P]; return;
    case 7: { const ci = c >= 0 ? PT.coreCirc[c] : PT.coreCirc0;
      if(c >= 0){ eLoopPA(ci); E_SIG[1] = E_LP[0]; } else E_SIG[1] = sc[SC_P];
      satTA(eCircSat(ci), E_SIG, 1, 2); eSigTavgA(c);
      o[0] = E_SIG[2] - (E_CT[3] + (c >= 0 ? s.csCoreDT[c] : sc[SC_COREDT])/2); return; }
    case 8: { if(c >= 0){ const t = PT.circHold[PT.coreCirc[c]]; if(t >= 0){ o[0] = s.lvlBy[t]; return; } } o[0] = sc[SC_LVL]; return; }
    case 9: eSglMinA(); o[0] = E_MR[0]; return;
    case 10: eTankPoolPctHostedA(); o[0] = E_CF[1]; return;
    case 11: o[0] = c >= 0 && PT.circKeyed[PT.coreCirc[c]] ? s.invBy[PT.coreCirc[c]] : sc[SC_INV]; return;
    case 12: o[0] = (c >= 0 ? s.csFlowNet[c] : sc[SC_FLOWNET])*100; return;
    case 13: o[0] = sc[SC_LOAD]*100; return;
    case 14: o[0] = (c >= 0 ? s.csRodPos[c] : sc[SC_RODPOS])*100; return;
    case 15: o[0] = sc[SC_BORON]; return;
    case 16: o[0] = c >= 0 ? s.csParts[c*RP_N+RP_XE] : s.parts[RP_XE]; return;
    case 17: o[0] = c >= 0 ? s.csParts[c*RP_N+RP_EXP] : s.parts[RP_EXP]; return;
    case 18: o[0] = c >= 0 ? s.csParts[c*RP_N+RP_DIS] : s.parts[RP_DIS]; return;
    case 19: o[0] = c >= 0 ? s.csFq[c] : sc[SC_FQ]; return;
    case 20: o[0] = (c >= 0 ? s.csAo[c] : sc[SC_AO])*100; return;
    case 21: o[0] = (c >= 0 ? s.csRo[c] : sc[SC_RO])*100; return;
    case 22: o[0] = c >= 0 ? s.csRho[c] : sc[SC_RHO]; return;
    case 23: o[0] = c >= 0 ? s.csVf[c] : sc[SC_VF]; return;
    case 24: o[0] = c >= 0 ? s.csDmg[c] : sc[SC_DMG]; return;
    case 25: o[0] = c >= 0 ? s.csFatigue[c] : sc[SC_FATIGUE]; return;
    case 26: o[0] = sc[SC_CAV]; return;
    case 27: o[0] = sc[SC_NAT]*100; return;
    case 28: o[0] = sc[SC_RELEASE]; return;
    case 29: o[0] = (c >= 0 ? s.csDecay[c] : sc[SC_DECAY])*100; return;
    case 30: o[0] = sc[SC_DOSERATE]; return;
    case 31: o[0] = sc[SC_CREWDOSE]; return;
    case 32: o[0] = (c >= 0 ? s.csMeltFrac[c] : sc[SC_MELTFRAC])*100; return;
    case 33: eH2TotalA(); o[0] = E_H2T[0]; return;
    case 34: o[0] = sc[SC_ROOMPMAX]; return;
    case 35: { if(c >= 0){ o[0] = s.csDnbrMin[c]; return; }
      let m = E_INF; for(let k=0;k<PT.n.core;k++) if(s.csDnbrMin[k] < m) m = s.csDnbrMin[k];
      o[0] = m === E_INF ? PK[PK_DNBR0] : m; return; }
    case 36: eRadTMaxA(); o[0] = E_MR[2]; return;
    case 37: o[0] = c >= 0 ? s.csN[c] : sc[SC_N]; return;
    case 38: eTProgA(c); o[0] = E_CT[2]; return;
    case 39: o[0] = c >= 0 && PT.circKeyed[PT.coreCirc[c]] ? s.dTavgBy[PT.coreCirc[c]] : sc[SC_DTAVG]; return;
    case 40: eTurbShareA(); E_CT[0] = E_CT[1]; eUnitFracA(); o[0] = E_CT[0]; return;
    case 41: o[0] = (c >= 0 ? s.csRodDem[c] : sc[SC_RODDEM])*100; return;
    case 42: o[0] = (c >= 0 ? s.csScrammed[c] : sc[SC_SCRAMMED]) ? 1 : 0; return;
    case 43: o[0] = c >= 0 ? s.scBy[PT.coreCirc[c]] : sc[SC_SC]; return;
    case 44: o[0] = c >= 0 ? s.csHeat[c] : sc[SC_HEAT]; return;
    case 45: o[0] = a >= 0 ? PT.rpsSet[a] : 0; return;
    case 46: o[0] = a >= 0 ? PT.rpsNear[a] : 0; return;
    case 47: if(a >= 0){ eBoilerLvlA(a); o[0] = E_BL[0]; } else o[0] = 0; return;
    case 48: if(a >= 0){ eBoilerPA(a); o[0] = E_BP[0]; } else o[0] = 0; return;
    case 49: o[0] = a >= 0 ? s.steamBy[a] : 0; return;
    case 50: o[0] = a >= 0 ? s.sgFedBy[a] : 0; return;
    case 51: if(a >= 0){ eFeedWantA(a); o[0] = E_MR[1]; } else o[0] = 0; return;
    case 52: { let m = E_INF; for(let b=0;b<PT.n.boiler;b++){ eBoilerLvlA(b); const v = E_BL[0]; if(v < m) m = v; } o[0] = m; return; }
    case 53: o[0] = a >= 0 ? s.flowBy[a]*100 : 0; return;
    case 54: o[0] = a >= 0 ? s.flowDemBy[a]*100 : 0; return;
    case 55: { const v = a >= 0 ? PT.fitRelief[a] : -1, i = v >= 0 ? PT.reliefNode[v] : -1;
      if(i >= 0){ eNodePOfA(ST.pBy, i); o[0] = E_NP[0]; } else o[0] = sc[SC_P]; return; }
    case 56: { const v = a >= 0 ? PT.fitRelief[a] : -1; o[0] = v >= 0 && s.reliefOpen[v] ? 1 : 0; return; }
    case 57: { const v = a >= 0 ? PT.fitRelief[a] : -1; o[0] = v >= 0 ? PT.reliefLift[v] : 0; return; }
    case 58: { const v = a >= 0 ? PT.fitRelief[a] : -1; o[0] = v >= 0 ? PT.reliefReseat[v] : 0; return; }
    case 59: { const w = a >= 0 ? PT.fitThrottle[a] : -1; o[0] = w >= 0 ? s.valve[w]*100 : 0; return; }
    case 60: { if(a < 0){ o[0] = 0; return; } eTankLvlA(a); const l = E_TL[0]; o[0] = l < 0 ? 0 : l > 100 ? 100 : l; return; }
    case 61: eLoopPA(a); o[0] = E_LP[0]; return;
    case 62: o[0] = a >= 0 ? PT.circSetP[a] : 0; return;
    case 63: o[0] = eSupplyK(); return;
    case 64: o[0] = sc[SC_BLACKOUT] ? 1 : 0; return;
    case 65: o[0] = sc[SC_TURBTRIP] ? 1 : 0; return;
    case 66: o[0] = sc[SC_T]; return;
    case 67: { const k = c >= 0 ? c : 0, a0 = k < PT.n.core ? PT.corePart[k] : -1, i = a0 >= 0 ? PT.partCell[a0] : -1, r = i >= 0 ? PT.cellRegion[i] : -1;
      o[0] = r >= 0 ? SX.regPMean[r] : 0; return; }
    case 68: { let m = E_INF; for(let b=0;b<PT.n.boiler;b++){ eBoilerPA(b); const v = E_BP[0]/PT.boilerDesP[b]; if(v < m) m = v; } o[0] = m; return; }
    case 69: if(c >= 0){ eLoopPA(PT.coreCirc[c]); o[0] = E_LP[0]/PT.coreP0[c]; } else o[0] = sc[SC_P]/PK[PK_P0]; return;
  }
  o[0] = 0; return;
}
const eSigRead = (sig, a) => { eSigReadA(sig, a); return E_SIG[0]; };
function eSigTavgA(c){ if(c >= 0){ eTavgA(PT.coreCirc[c]); E_CT[3] = E_TA[0]; } else E_CT[3] = ST.sc[SC_TAVG]; }
const eSigTavg = c => { eSigTavgA(c); return E_CT[3]; };
const eSigDT = c => c >= 0 ? ST.csCoreDT[c] : ST.sc[SC_COREDT];

function eSinkApply(k, code, arg, dt){
  const s = ST, sc = s.sc, v = E_SV[0];
  switch(code){
    case E_SK_ROD:
      if(arg >= 0) eRodApply(arg, dt); else for(let c=0;c<PT.n.core;c++) eRodApply(c, dt);
      return;
    case E_SK_FREG: if(arg >= 0) s.fregDemBy[arg] = v < 0 ? 0 : v > 1 ? 1 : v; return;
    case E_SK_RELIEF: { const r = arg >= 0 ? PT.fitRelief[arg] : -1;
      if(r >= 0 && !PT.reliefSpring[r]) eReliefCmd(r, v > 0.5); return; }
    case E_SK_FLOW: if(arg >= 0) s.flowDemBy[arg] = clamp(v/100, 0, 1.5); return;
    case E_SK_LOAD: sc[SC_LOADDEM] = clamp(v/100, 0, PK[PK_LOADMAX]); return;
    case E_SK_BORON: sc[SC_BORONDEM] = v; return;
    case E_SK_VALVE: { const w = arg >= 0 ? PT.fitThrottle[arg] : -1; if(w >= 0) s.valveDem[w] = clamp(v/100, 0, 1); return; }
    case E_SK_TANK: if(arg >= 0) s.tankOpen[arg] = v > 0.5 ? 1 : 0; return;
    case E_SK_SCRAM: {
      const c0 = arg >= 0 ? arg : 0, c1 = arg >= 0 ? arg+1 : PT.n.core;
      for(let c=c0;c<c1;c++){
        const fire = v > 0.5 && !s.csScrammed[c] && s.csRpsHot[c] + dt >= PK[PK_RPSLAG] - dt*0.5;
        eScramSink(c, dt, fire ? eBlkBlame(k) : -1); }
      return; }
    case E_SK_NEAR: if(arg >= 0) eNearTrip(arg); else for(let c=0;c<PT.n.core;c++) eNearTrip(c); return;
    case E_SK_RUNBACK: { const hot = v > 0.5; if(hot && !sc[SC_RBHOT]) eRunbackNow(); sc[SC_RBHOT] = hot ? 1 : 0; return; }
  }
}
const eSinkDead = (code, arg) => { const a = eSinkPart(code, arg); return a >= 0 && ST.dmgBy[a] !== 0; };

/* E_BV[0]: the block's output this tick */
const E_BV = new Float64Array(1);
function eBlkEval(k, dt){
  const s = ST, O = s.blkOutV, F = s.blkOutF, o = k*E_KN_N, kn = s.blkKn, In = s.blkIn, R = E_BV;
  const a = In[k*3], b = In[k*3+1], c = In[k*3+2];
  const i0 = a >= 0 ? O[a] : 0, i1 = b >= 0 ? O[b] : 0, i2 = c >= 0 ? O[c] : 0;
  switch(PT.blkMode[k]){
    case E_BM_SOURCE: eSigReadA(kn[o+E_KN_SIG], kn[o+E_KN_ARG]); R[0] = E_SIG[0]; return;
    case E_BM_CONST: R[0] = kn[o+E_KN_V]; return;
    case E_BM_MATH: { let r;
      switch(kn[o+E_KN_OP]){ case 0: r = i0+i1; break; case 1: r = i0-i1; break; case 2: r = i0*i1; break;
        case 3: r = i1 !== 0 ? i0/i1 : 0; break; case 4: r = Math.min(i0, i1); break; default: r = Math.max(i0, i1); }
      const g = kn[o+E_KN_K]; R[0] = g === 1 ? r : (g === g ? g : 1)*r; return; }
    case E_BM_PID: { const td = kn[o+E_KN_TD] || 0, nf = kn[o+E_KN_N_] || 8, ti = kn[o+E_KN_TI], db = kn[o+E_KN_DB] || 0;
      const f = F[k] + Math.min(dt/Math.max(td/nf, dt), 1)*(i1 - F[k]);
      const u = Math.abs(i0) < db ? 0 : kn[o+E_KN_KP]*(f + (ti > 0 ? i0/ti : 0) + td*(f - F[k])/Math.max(dt, 1e-9))*dt;
      F[k] = f; R[0] = u; return; }
    case E_BM_INTEG: { const lo = kn[o+E_KN_LO], hi = kn[o+E_KN_HI], v = O[k] + i0;
      R[0] = v < lo ? lo : v > hi ? hi : v; return; }
    case E_BM_LIMIT: { const lo = kn[o+E_KN_LO], hi = kn[o+E_KN_HI], rt = kn[o+E_KN_RATE], ov = O[k];
      let v = i0 < lo ? lo : i0 > hi ? hi : i0;
      if(rt === rt){ const d = v - ov; v = ov + Math.sign(d)*Math.min(Math.abs(d), rt*dt); }
      R[0] = v; return; }
    case E_BM_LAG: R[0] = O[k] + Math.min(dt/Math.max(kn[o+E_KN_TAU], dt), 1)*(i0 - O[k]); return;
    case E_BM_COMPARE: { const on = b >= 0 ? i1 : kn[o+E_KN_ON], off = c >= 0 ? i2 : kn[o+E_KN_OFF];
      R[0] = kn[o+E_KN_OP] === 1 ? (O[k] ? (i0 > off ? 0 : 1) : (i0 < on ? 1 : 0))
                                 : (O[k] ? (i0 < off ? 0 : 1) : (i0 > on ? 1 : 0)); return; }
    case E_BM_LATCH: R[0] = i1 > 0.5 ? 0 : i0 > 0.5 ? 1 : O[k]; return;
    case E_BM_SEL: { const w = SX.selW; let n = 0;
      if(a >= 0) w[n++] = i0;
      if(b >= 0) w[n++] = i1;
      if(c >= 0) w[n++] = i2;
      if(!n){ R[0] = 0; return; }
      const op = kn[o+E_KN_OP];
      if(op === 1){ let m = w[0]; for(let i=1;i<n;i++) if(w[i] < m) m = w[i]; R[0] = m; return; }
      if(op === 0){ let m = w[0]; for(let i=1;i<n;i++) if(w[i] > m) m = w[i]; R[0] = m; return; }
      for(let i=1;i<n;i++){ const x = w[i]; let j = i-1; while(j >= 0 && w[j] > x){ w[j+1] = w[j]; j--; } w[j+1] = x; }
      R[0] = w[(n-1)>>1]; return; }
    case E_BM_SINK: { const code = kn[o+E_KN_SINK], arg = kn[o+E_KN_ARG];
      if(code >= 0 && !eSinkDead(code, arg)){ E_SV[0] = i0; eSinkApply(k, code, arg, dt); }
      R[0] = i0; return; }
  }
  R[0] = O[k];
}

/* Kahn over the live wiring, every tick: the wiring is state and a snapshot may carry any of it; a block on a cycle reads last tick's outputs */
function eCtlOrder(){
  const nk = PT.n.block, deg = SX.ctlDeg, q = SX.ctlOrd, In = ST.blkIn;
  for(let k=0;k<nk;k++){ let d = 0; for(let i=0;i<3;i++) if(In[k*3+i] >= 0) d++; deg[k] = d; }
  let head = 0, n = 0;
  for(let k=0;k<nk;k++) if(deg[k] === 0) q[n++] = k;
  while(head < n){ const u = q[head++];
    for(let k=0;k<nk;k++) for(let i=0;i<3;i++) if(In[k*3+i] === u && --deg[k] === 0) q[n++] = k; }
  for(let k=0;k<nk;k++) if(deg[k] > 0) q[n++] = k;
  return n;
}
function eCtlPass(dt){
  if(!eCtlLive()) return;
  const n = eCtlOrder(), q = SX.ctlOrd, O = ST.blkOutV;
  for(let j=0;j<n;j++){ const k = q[j];
    if(!ST.blkOn[k]) continue;
    eBlkEval(k, dt);
    const v = E_BV[0];
    if(isFinite(v)) O[k] = v; }
}
/* bumpless: a position-holding block starts where the sink it feeds already stands */
function eCtlSeedOut(k){
  if(PT.blkMode[k] !== E_BM_SINK) return;
  const u = ST.blkIn[k*3]; if(u < 0) return;
  const code = eKnob(k, E_KN_SINK), m = PT.blkMode[u];
  if(code < 0 || code === E_SK_ROD) return;
  if(m === E_BM_INTEG || m === E_BM_LIMIT || m === E_BM_LAG){
    const v = eSinkRead(code, eKnob(k, E_KN_ARG)); if(isFinite(v)) ST.blkOutV[u] = v; }
}
const eCtlSeedOuts = () => { for(let k=0;k<PT.n.block;k++) eCtlSeedOut(k); };

/* the block feeding a core's live scram sink: the trip condition before the latch */
function eScramArm(c){ const k = eSinkDriver(E_SK_SCRAM, c); return k < 0 ? -1 : ST.blkIn[k*3]; }
function eRpsState(){
  let fitted = false, armed = false;
  for(let c=0;c<PT.n.core;c++){ if(eSinkWired(E_SK_SCRAM, c, false) >= 0) fitted = true; if(eScramArm(c) >= 0) armed = true; }
  return !fitted ? E_RPS_NONE : armed ? E_RPS_ARMED : E_RPS_BYPASSED;
}
/* the named block lighting the near-trip lamp, plus one; 0 once the trip itself owns the picture */
function eTripNear(){
  if(ST.sc[SC_SCRAMMED]) return 0;
  for(let c=0;c<PT.n.core;c++){ if(!ST.csRpsNear[c]) continue;
    const a = eScramArm(c); if(a >= 0 && ST.blkOutV[a] > 0.5) return 0;
    const w = eBlkBlame(eSinkDriver(E_SK_NEAR, c)); if(w >= 0) return w+1; }
  return 0;
}
/* -1 when a reset would clear; else the named block still holding the trip, or -2 for an unnamed one */
function eResetVeto(){
  for(let c=0;c<PT.n.core;c++){ if(!ST.csScrammed[c]) continue;
    const a = eScramArm(c);
    if(a >= 0 && ST.blkOutV[a] > 0.5){ const w = eBlkBlame(eSinkDriver(E_SK_SCRAM, c)); return w >= 0 ? w : -2; } }
  return -1;
}
