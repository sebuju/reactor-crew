#!/usr/bin/env node
// node tools/step-gate.js [--ticks N] [--preset N|a,b,c] — §6.7 full-tick gate
// per tick on every preset vs sim-rs step-probe replay (all stages in tick
// order on one StepState + sync). Bar: sdig floats (1e-6), exact discretes.
// S0James: stage metas + canonical states + carried inits. Per tick: ctl
// Sample, reader-tail bundles, mid-tail trip_near, per-stage post states,
// LOG slice, warns. Writes tools/step-baseline.json on pass.
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
const TICKS = +(opt('ticks', '10'));
const DT = 0.02;
// --preset N or --preset a,b,c: commission only those presets (seeds and
// preset indices unchanged, so samples match full runs). Baseline file is
// only written for unfiltered runs.
const PRESET_ARG = opt('preset', '');
const PRESET_ONLY = PRESET_ARG === '' ? null : PRESET_ARG.split(',').map(s => s.trim());

const M = headless('{FREEZE,SIMSTATE,PRE:()=>PLANTPRE,plantPreset,buildLayout,commission,P:()=>P,S:()=>S,D:()=>D,step,' +
  'reliefFitIds:()=>reliefFitIds(),' +
  // march fns in tick order
  'ctlPass:(s,dt)=>ctlPass(s,dt),actFollow:(s,dt)=>actFollow(s,dt),boronFollow:(s,dt)=>boronFollow(s,dt),' +
  'spillStep:(s,o)=>spillStep(s,o),tankRateStep:(s,o)=>tankRateStep(s,o),' +
  'coreRodStep:(cs,K,id,dt)=>coreRodStep(cs,K,id,dt),coreDecayStep:(cs,dt)=>coreDecayStep(cs,dt),coreAgg:(s)=>coreAgg(s),' +
  'netFlowK:(s,runFlow,pField,netOut)=>netFlowK(s,runFlow,pField,netOut),' +
  'coreFlowNetStep:(cs,K,id,coreFN,netOut,pumpK)=>coreFlowNetStep(cs,K,id,coreFN,netOut,pumpK),' +
  'pcoreStep:(s,pField)=>pcoreStep(s,pField),pressRead:(s,dt)=>pressRead(s,dt),burstDice:(s,dt,pField)=>burstDice(s,dt,pField),' +
  'advectStep:(s,dt,runFlow,edgeKg)=>advectStep(s,dt,runFlow,edgeKg),invStep:(s)=>invStep(s),' +
  'sumpStep:(s,dt)=>sumpStep(s,dt),' +
  'cavStep:(s,dt,pField)=>cavStep(s,dt,pField),pumpQStep:(s,runFlow)=>pumpQStep(s,runFlow),pumpCoastStep:(s,dt)=>pumpCoastStep(s,dt),' +
  'sgHeatStep:(s,dt,runFlow,netOut,pumpK,heat)=>sgHeatStep(s,dt,runFlow,netOut,pumpK,heat),' +
  'holdReliefStep:(s,dt,pField,netOut)=>holdReliefStep(s,dt,pField,netOut),' +
  'discTankStep:(s,dt)=>discTankStep(s,dt),bookTailStep:(s,inj)=>bookTailStep(s,inj),' +
  'coreFatigueStep:(cs,dt,inj)=>coreFatigueStep(cs,dt,inj),' +
  'sgtrStep:(s,dt,netOut)=>sgtrStep(s,dt,netOut),' +
  'coreBurstStep:(cs,K,id)=>coreBurstStep(cs,K,id),coreVesselStep:(cs,K,id,dt,coreFN)=>coreVesselStep(cs,K,id,dt,coreFN),' +
  'marginStep:(s,pField,heat,pumpK)=>marginStep(s,pField,heat,pumpK),' +
  'condTurbStep:(s)=>condTurbStep(s),secVentStep:(s,dt,netOut)=>secVentStep(s,dt,netOut),' +
  'shellStep:(s,dt,netOut,secVent)=>shellStep(s,dt,netOut,secVent),condVentStep:(s,dt)=>condVentStep(s,dt),' +
  'turbStep:(s,netOut,pCond,bleedAll)=>turbStep(s,netOut,pCond,bleedAll),' +
  'radPanelStep:(s,dt,runFlow)=>radPanelStep(s,dt,runFlow),secTankStep:(s,dt)=>secTankStep(s,dt),' +
  'coreKineticsStep:(cs,K,dt)=>coreKineticsStep(cs,K,dt),coreMeltStep:(cs,K,id,dt)=>coreMeltStep(cs,K,id,dt),' +
  'radDoseStep:(s,dt)=>radDoseStep(s,dt),injectFluid:(s,dt)=>injectFluid(s,dt),roomStep:(s,dt)=>roomStep(s,dt),' +
  'blastStep:(s,dt)=>blastStep(s,dt),overpressureStep:(s)=>overpressureStep(s),' +
  'burnFireStep:(s)=>burnFireStep(s),cookStep:(s,dt)=>cookStep(s,dt),' +
  'evLatchStep:(s,cavIds,injIds)=>evLatchStep(s,cavIds,injIds),' +
  'repairStep:(s,dt)=>repairStep(s,dt),flowSpinStep:(s,dt,runFlow)=>flowSpinStep(s,dt,runFlow),' +
  'ledgerStep:(s,dt,ledgM0,ledgO0)=>ledgerStep(s,dt,ledgM0,ledgO0),' +
  // readers
  'ledgerKg:()=>ledgerKg(S),ledgerOut:()=>ledgerOut(S),' +
  'tripNear:()=>!!tripNear(),rps:()=>rpsState(),' +
  'sinkRunback:()=>!!sinkWired(S,"runback",null),runbackLive:()=>runbackLive(),' +
  'netDry:()=>netDryParts(S),condP:()=>condP(S),panelHit:()=>radTMax(S),condFrac:()=>condFrac(S),' +
  'secP:(id)=>secP(S,id),boilerLvl:(id)=>boilerLvl(S,id),' +
  'loopp:(id)=>{const K=P.cores&&P.cores[id]; return K?loopP(S,K.circ):S.P;},' +
  'contRel:(id)=>contRelPart(S,partOf(id)),' +
  'partyCells:(id)=>{const p=dmgPart(id); if(!p) return [];' +
  ' if(p.stand&&p.stand.length) return p.stand.map(c=>c[1]*GW+c[0]);' +
  ' const g=occupied(null,{pipes:false}); return freeAdj(p,g).map(c=>c[1]*GW+c[0]);},' +
  // solve readers (tail)
  'netPAt:(nm)=>netPAt(S,nm),netHAt:(nm)=>netHAt(S,nm),poolLvlOf:(i)=>poolLvlOf(P.net,S,i),' +
  'holdPOf:(id)=>holdPOf(S,id),holdSetP:(ci)=>holdSetP(ci),' +
  'tankP:(id)=>tankP(S,id),tankCapAt:(id)=>tankCapAt(S,id),condVacuum:(id)=>condVacuum(id),' +
  'condStoreC:(id)=>condStoreC(S,id),condStoreW:(id)=>condStoreW(S,id),condSatP:(id)=>condSatP(S,id),' +
  'partWrecked:(id)=>partWrecked(S,id),turbWorkFrac:(m)=>turbWorkFrac(S,m),' +
  'netLiveSig:()=>netLiveSig(P.net,S),' +
  // sig-verify sidecar (GATE_DBGFILE only, never the binary format):
  // per-run structural lists + per-tick live-sig segments at solve time.
  'sigLists:()=>JSON.stringify({tanks:tankIds().filter(id=>P.net.tankNode[id]!==undefined),fitIds:P.net.fitIds||[],fitMode:(P.net.fitIds||[]).map(fid=>P.net.fitMode[fid])}),' +
  'sigSeg:()=>JSON.stringify({tk:tankIds().filter(id=>P.net.tankNode[id]!==undefined).map(id=>tankLive(S,id)?1:0),' +
  'fit:(P.net.fitIds||[]).map(fid=>P.net.fitMode[fid]==="relief"?(reliefLive(S,fid)?1:0):((S.valve&&S.valve[fid]!==undefined)?(typeof S.valve[fid]==="number"&&isNaN(S.valve[fid])?"N":S.valve[fid]):"U")),' +
  'dmg:(S.dmgParts||[]).slice(),shut:Object.keys(S.portShut||{}).filter(k=>S.portShut[k]),' +
  'cor:coreIds().map(id=>{const cs=coreState(S,id)||S;return ((cs.breach?4:0)|(cs.tubesOpen>0?2:0)|(cs.cavRelief?1:0));}),' +
  'dry:netDrySig(P.net,S),diode:netDiodeSig(P.net,S),' +
  'flg:((S.turbTrip?1:0)|(S.condLost?2:0)|((S.load>0)?4:0))}),' +
  // transport readers
  'bookedKg:(i)=>bookedKg(P.net,S,i),advectSrc:(dt)=>Array.from(advectSrc(S,dt,P.runFlowH)),' +
  'tankFluidBoron:(tid)=>tankFluid(tid).boron,edgeCval:(e)=>edgeCval(P.net,P.net.edges[e],S),' +
  'edgeG:(e)=>edgeG(P.net,P.net.edges[e],S),' +
  'netFieldUpdate:(s)=>netFieldUpdate(P.net,s),' +
  // core readers
  'satT:(id)=>{const K=P.cores[id];return satT(K.sat,S.coreBy[id].pCore);},' +
  'coreInH:(id)=>coreInH(S,id),sinkRod:(id)=>sinkDriver(S,"rodStep",id)?1:0,' +
  'loopKg:()=>loopKg(),coreDTMax:()=>coreDT0()*8.3,tiltRate:(id)=>tiltRate(P.cores[id]),' +
  'dose:()=>P.dose,catcher:()=>!!P.catcher,' +
  'vLeak:(id)=>{const K=P.cores[id],cs=S.coreBy[id];const m=S.mBy.v[S.mBy.has?P.net.index[coreFold(id)]:-1];' +
  ' const rvl=satRvl(K.sat,cs.pCore);' +
  ' return (!(K.coreKg0>0)||m===undefined||(K.sat.tc&&K.Tref>K.sat.tc))?0:Math.max(0,(1-m/K.coreKg0)/Math.max(1-rvl,1e-3));},' +
  // room readers
  'boreOf:(key)=>openBoreM(key),' +
  // consts
  'PROMPT_F:()=>PROMPT_F,DGEN:()=>DGEN,' +
  'roomCgIt:()=>roomCgIt,liqCgIt:()=>liqCgIt,liqCgReset:()=>{liqCgIt=0;},roomPGen:()=>roomPGen,' +
  'netMarching:(v)=>netMarching(v),' +
  'coreCircOf:(id)=>coreCircOf(id),coreOnCirc:(ci)=>coreOnCirc(ci),' +
  'runKeys:()=>flowMapsOf(P.net).runKeys,' +
  'holdCircs:()=>holdCircs(),drumIds:()=>drumIds(),condIds:()=>condIds(),' +
  'cwFlowOf:(rf,id)=>cwFlowOf(rf,id),partOf:(id)=>partOf(id),' +
  'tankInField:(id)=>tankInField(id),tankKg:(id)=>tankKg(id),tankCircuit:(id)=>tankCircuit(id),' +
  'reliefSecIds:()=>reliefSecIds(),ventKeyOf:(fid)=>ventKeyOf(fid),' +
  'circOfNode:(nm)=>circOfNode(nm),holdTankIds:()=>holdTankIds(),' +
  'TavgOf:(s,ci)=>TavgOf(s,ci),dTavgOf:(s,ci)=>dTavgOf(s,ci),' +
  'nodeGraph:()=>nodeGraph(),netHole:(ed)=>netHole(ed),TRT:()=>TAVG_RATE_TAU,' +
  'getIdx:()=>CTL_IDX,setIdx:(v)=>{CTL_IDX=v;},getIdk:()=>CTL_IDK,setIdk:(v)=>{CTL_IDK=v;},' +
  'coreFold:(id)=>coreFold(id),STOREHELD:()=>netStoreHeld,' +
  'netPcont:(i)=>netPcont(P.net,S,i),tankStores:(id)=>tankStores(id),' +
  'tankLive:(id)=>tankLive(S,id),portLive:(id)=>portLive(S,id),' +
  'turbCOf:(id)=>turbCOf(S,id),sgtrLive:(id)=>sgtrLive(S,id),' +
  'sgtrC:()=>sgtrC(),sgWastOf:(id)=>sgWastOf(S,id),' +
  'cellBroken:(cx,cy)=>cellBroken(S,cx,cy),portWrecked:(id)=>portWrecked(S,id),' +
  'dbgEdgeC:(e)=>edgeCval(P.net,P.net.edges[e],S),' +
  'dbgFixN:()=>{const b=netFixed(P.net,S); let c=0; for(const v of b.has) c+=v; return c;},' +
  'dbgRunFluidT:(k)=>runFluidT(S,k),' +
  'dbgFixV:()=>{const b=netFixed(P.net,S); let s=0,mn=Infinity,mx=-Infinity; for(let i=0;i<b.v.length;i++) if(b.has[i]){const v=b.v[i]; s+=v; if(v<mn)mn=v; if(v>mx)mx=v;} return s.toFixed(6)+"/"+mn+"/"+mx;},' +
  'netRhoAt:(nid)=>netRhoAt(S,nid),' +
  'inLoopOf:(ci,nm)=>inLoop(ci,nm)?1:0,' +
  'sgOpen:(id)=>sgOpen(S,id),condVentBore:(id)=>condVentBore(id),' +
  'condDumpOpen:()=>condDumpOpen(S),condDumpKgs:()=>condDumpKgs(),' +
  'TANK_RHO:()=>TANK_RHO,coreState:(id)=>coreState(S,id),' +
  'pumpHead:(p)=>pumpHead(p),pumpDrive:(p)=>pumpDrive(S,p),' +
  'cavOf:(p)=>cavOf(S,p),pumpRhoK:(p)=>pumpRhoK(S,p),poolH:(i)=>poolH(P.net,S,i),' +
  'HEADK:()=>HEAD_K,CASINGF:()=>CASING_F,PUMPH0:()=>PUMP_H0,' +
  'reliefLive:(id)=>reliefLive(S,id),feedTrainC:()=>feedTrainC(),' +
  'laneEnv:()=>JSON.stringify({hold:netStoreHeld?1:0,ci:circOfNode("efwpt"),hsp1:holdSetP(1),hsp:Object.fromEntries([...Array(24).keys()].map(ci=>[ci,holdSetP(ci)])),rho:Object.fromEntries(pumpIds().map(pid=>{try{const r0=(P.pumpRho0||{})[pid];const nm=pumpSucNode(pid);const c=netSatOf(nm);return [pid,{k:pumpRhoK(S,pid),r0:r0===undefined?null:r0,r:netRhoAt(S,nm),p:netPAt(S,nm),h:netHAt(S,nm),sat:{p0:c.p0,T0:c.T0,cp:c.cp,rho:c.rho}}];}catch(e){return [pid,{err:String(e&&e.message||e)}]};}))}),' +
  'storeHeld:()=>netStoreHeld?1:0,' +
  'holdLiveOf:(id)=>{const pc=netPieces(P.net,S); return holdLive(P.net,S,tankCircuit(id),pc)?1:0;},' +
  'stageFedOf:(id)=>stageFed(P.net,S,id)?1:0,' +
  'tankPof:(tid)=>{const t=D.tanks[tid]; return tankP(S,tid,t.hold?netPieces(P.net,S):undefined);},' +
  'exhOpenOf:()=>exhOpen(S)?1:0,roleTurbAliveOf:()=>roleAlive("turb",S),' +
  'contRelOf:(pid)=>contRelPart(S,partOf(pid)),' +
  'shellsLiveOf:(fid)=>shellsLive(S,fid),' +
  'netPiecesOf:()=>Array.from(netPieces(P.net,S).of),' +
  'corePiecesOf:()=>{const pc=netPieces(P.net,S); return [...corePieces(P.net,S,pc)];},' +
  'outsBag:(a,b,c,k)=>outsBag(P.netOut,a,b,c,k),' +
  'circKey:(ci)=>circKey(ci),' +
  'HB:()=>HEATBAL,LOG:()=>LOG,' +
  '}');

// ---- stream writers ----
let parts = [];
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); parts.push(b); };
const i32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v | 0, 0); parts.push(b); };
const f64 = v => { const b = Buffer.alloc(8); b.writeDoubleLE(v, 0); parts.push(b); };
const u8 = v => parts.push(Buffer.from([v & 0xFF]));
const raw8a = a => parts.push(Buffer.from(a));
const u8a = a => parts.push(Buffer.from(a.map(x => x ? 1 : 0)));
const f64a = a => { for (const v of a) f64(v); };
const f64an = a => { u32(a.length); f64a(a); };
const u8an = a => { u32(a.length); raw8a(a); };
const i32a = a => { for (const v of a) i32(v); };
const u32a = a => { for (const v of a) u32(v); };
const str = s => { const b = Buffer.from(String(s), 'utf8'); u32(b.length); parts.push(b); };
const strsn = a => { u32(a.length); strsRaw(a); };
const strmap = o => { const k = Object.keys(o); u32(k.length); for (const x of k) { str(x); f64(num(o[x])); } };
const num = v => (v === undefined || v === null) ? NaN : (+v);
const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v); parts.push(b); };
const strsRaw = a => { for (const s of a) str(s); };

const GW = { u8, u16, u32, i32, f64, str };

// ---- events map (merged sec+room+events tables; sec-style matcher:
/// suffix(1)/exact/prefix('/ ') — copied from sec-gate.js mapEvent) ----
const SEVMAP = { alarm: 0, warn: 1, info: 2 };
const EVMSG = {
  1: ['alarm', 'PIPE BURST / '], 2: ['alarm', 'CONTAINMENT FAILURE / '],
  3: ['alarm', ' SHELL BURST', 1], 4: ['alarm', ' DISC BURST', 1],
  5: ['alarm', 'CONDENSER VACUUM LOST'], 6: ['alarm', 'TURBINE TRIP'],
  7: ['info', 'TURBINE RELATCHED'], 8: ['warn', 'STEAM GOING OVERBOARD'],
  9: ['warn', ' LIFTED', 1],
  11: ['alarm', 'FLOODING / '],
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
  63: ['alarm', 'FUEL CHANNEL RUPTURE / '],
  64: ['alarm', 'UPPER SHIELD LIFTED / '],
};
function mapEvent(e) {
  for (const code of Object.keys(EVMSG)) {
    const [sev, pat, suf] = EVMSG[code];
    if (e.sev !== sev) continue;
    const hit = suf ? e.msg.endsWith(pat) : (pat.endsWith('/ ') ? e.msg.startsWith(pat) : e.msg === pat);
    if (hit) return [SEVMAP[sev], +code];
  }
  console.error('unmapped events log: ' + e.sev + ' ' + e.msg);
  process.exit(2);
}

// ---- warns hook (all scopes; counted per tick) ----
let consoleWarns = 0;
const realWarn = console.warn;
console.warn = (...a) => { consoleWarns++; return realWarn(...a); };

// ---- S0 + march ----
// Fresh piece components over live edges, mirroring netPieces() without
// touching its cache: live[e] = edgeG > 0, DFS in node-index order.
function freshPieces(net) {
  const n = net.n;
  const live = new Uint8Array(net.edges.length);
  const adj = new Array(n);
  for (let e = 0; e < net.edges.length; e++) {
    const ed = net.edges[e];
    const g = (typeof ed.g === 'function') ? M.edgeG(e) : ed.g;
    if (process.env.GATE_FRESH_DBG && +process.env.GATE_FRESH_DBG === e) {
      try {
        console.error('jsfresh e=' + e + ' g=' + g + ' w=' + net.wArr[ed.wi] + ' wet_u=' + net.F.wet[ed.u] + ' wet_v=' + net.F.wet[ed.v] + ' void_u=' + net.F.void[ed.u] + ' void_v=' + net.F.void[ed.v] + ' x_u=' + net.F.x[ed.u] + ' x_v=' + net.F.x[ed.v] + ' Cc=' + ed.Cc + ' u=' + ed.u + ' v=' + ed.v + ' dio=' + ed.diode);
      } catch (err) { console.error('jsfresh ERR ' + err.message); }
    }
    if (!(g > 0)) continue;
    live[e] = 1;
    (adj[ed.u] || (adj[ed.u] = [])).push(ed.v);
    (adj[ed.v] || (adj[ed.v] = [])).push(ed.u);
  }
  const of = new Int32Array(n).fill(-1);
  let c = 0;
  const st = [];
  for (let i = 0; i < n; i++) {
    if (of[i] >= 0) continue;
    st.length = 0; st.push(i); of[i] = c;
    while (st.length) {
      const a = adj[st.pop()];
      if (a) for (let k = 0; k < a.length; k++) {
        const v = a[k];
        if (of[v] < 0) { of[v] = c; st.push(v); }
      }
    }
    c++;
  }
  return { of: Array.from(of), n: c, live: Array.from(live) };
}
const presetNames = [];
const freezeBufs = [];
let nSamples = 0;
const skipped = { noNet: 0 };
// coreSeen-bust sequence for the evLatch window (monotonic, never reused).
let coreSeenSeq = 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'step-gate-'));
const fIn = path.join(tmp, 'step.bin');
const fd = fs.openSync(fIn, 'w');
if (process.env.GATE_DEBUG) console.error('tmp ' + fIn);
const writeParts = () => { for (const b of parts) fs.writeSync(fd, b); parts.length = 0; };

function marchTick(meta, tag) {
  const S = M.S(), P = M.P(), HB = M.HB(), net = P.net;
  const n = net.n, ne = net.edges.length;
  u32(tag); f64(DT);
  if (process.env.GATE_DEBUG && tag === 0) console.error('tick0-pre P=' + S.P + ' n=' + S.n + ' mBy0=' + (S.mBy && S.mBy.v ? S.mBy.v[0] : 'n/a') + ' TavgBy=' + JSON.stringify(S.TavgBy) + ' bridgeTavgOf=' + M.TavgOf(S, 0) + ' sameS=' + (M.S() === S) + ' ck0=' + JSON.stringify(M.circKey(0)) + ' STavg=' + S.Tavg);
  if (process.env.GATE_DEBUG && tag === 0) {
    let s = 0;
    const wa = P.net.wArr || [];
    for (const v of wa) s += v;
    console.error('tick0-pre warrsum=' + s + ' warrlen=' + wa.length);
  }
  const log0 = M.LOG().length;
  const cg0 = consoleWarns;
  const ledgM0 = M.ledgerKg(), ledgO0 = M.ledgerOut();
  if (process.env.GATE_DEBUG) console.error('tick ' + tag + ' log0=' + log0 + ' loglen=' + M.LOG().length);
  M.netMarching(true);
  if (process.env.GATE_DBGFILE && tag === 0) {
    try {
      const ix = P.net.index['efwpt'];
      const pb = S.pBy;
      fs.appendFileSync(process.env.GATE_DBGFILE, 'pby42 prectl ix=' + ix + ' has=' + (pb && pb.has && pb.has[ix]) + ' v=' + (pb && pb.v && pb.v[ix]) + '\n');
    } catch (e) { }
  }
  // ---- ctlPass ----
  const actPre = M.FREEZE.snapAct(S);
  ensureBlk(S);
  const pre = { out: Array.from(S.blkOutV || []), f: Array.from(S.blkOutF || []) };
  M.ctlPass(S, DT);
  if (process.env.GATE_DEBUG && tag === 0) console.error('post-ctl fregDem=' + JSON.stringify(S.fregDemBy) + ' freg=' + JSON.stringify(S.fregBy));
  dumpCtlSample(S, DT, pre, actPre);
  // ---- act/boron/rod/decay/agg ----
  M.actFollow(S, DT);
  M.boronFollow(S, DT);
  for (const id of meta.coreIds) M.coreRodStep(S.coreBy[id], P.cores[id], id, DT);
  for (const id of meta.coreIds) M.coreDecayStep(S.coreBy[id], DT);
  M.coreAgg(S);
  const heat = S.n * M.PROMPT_F() + S.decay;
  // ---- solve tail build (pre-netFlowK reads) ----
  const tail = {};
  tail.fbP = net.name.map(nm => M.netPAt(nm));
  tail.fbH = net.name.map(nm => M.netHAt(nm));
  tail.pool = (net.condV || []).map(i => { const l = M.poolLvlOf(i); return l === undefined ? NaN : l; });
  tail.cont = net.cont.map(i => [i, M.netPcont(i)]);
  tail.contP = net.name.map((nm, i) => M.netPcont(i));
  tail.held = M.STOREHELD() ? 1 : 0;
  tail.holdPins = M.holdTankIds().map(id => [net.tankNode[id], M.holdPOf(id)]).filter(([i]) => i !== undefined);
  tail.drumPins = M.drumIds().map(id => [net.tankNode[id], M.holdSetP(M.tankCircuit(id))]).filter(([i]) => i !== undefined);
  tail.tankPins = [];
  for (const id in net.tankNode) {
    const i = net.tankNode[id];
    if (M.D().tanks[id] && M.D().tanks[id].hold) continue;
    if (M.tankInField(id)) continue;
    if (M.tankStores(id)) continue;
    tail.tankPins.push([i, M.tankP(id)]);
  }
  tail.secPins = (net.secT || []).map((i, sk) => [i, M.secP(net.secTParts[sk])]);
  tail.condPins = (net.condParts || []).map((id, ck) => [net.condV[ck], M.condP()])
    .filter((x, ck) => M.condVacuum(net.condParts[ck]));
  tail.tanks = [];
  for (const id in net.tankNode) tail.tanks.push([M.tankCapAt(id), M.tankP(id)]);
  tail.conds = (net.condV || []).map((i, k) => {
    const id = net.condParts[k];
    return [M.condStoreC(id), M.condStoreW(id), M.condSatP(id),
      M.partWrecked(id) ? 1 : 0, M.condVacuum(id) ? 1 : 0];
  });
  tail.edgeQ = []; tail.edgeGates = [];
  if (process.env.GATE_DBGFILE && tag === 0) {
    try {
      const ix = P.net.index['efwpt'];
      const pb = S.pBy;
      fs.appendFileSync(process.env.GATE_DBGFILE, 'pby42 pretail ix=' + ix + ' has=' + (pb && pb.has && pb.has[ix]) + ' v=' + (pb && pb.v && pb.v[ix]) + '\n');
    } catch (e) { }
  }
  for (let e = 0; e < ne; e++) {
    const ed = net.edges[e];
    const hasW = net.wHas[ed.wi] ? 1 : 0;    const q = new Array(45).fill(NaN);
    const Ck = ed.Ck === undefined ? -1 : ed.Ck;
    if (Ck < 0) q[0] = num(typeof ed.C === 'function' ? ed.C(S) : ed.C);
    if (Ck >= 0 && ed.Cdead) q[1] = M.partWrecked(ed.Cdead) ? 1 : 0;
    q[2] = hasW ? net.wArr[ed.wi] : NaN; q[3] = hasW;
    if (Ck === 1) { q[4] = M.tankLive(ed.tid) ? 1 : 0; q[5] = M.portLive(ed.end) ? 1 : 0; }
    if (Ck === 2) q[5] = M.portLive(ed.end) ? 1 : 0;
    if (Ck === 4) { q[6] = num(S.fregBy && S.fregBy[ed.freg]); q[7] = M.feedTrainC(); }
    if (Ck === 5) q[8] = M.turbCOf(ed.pid);
    if (Ck === 6) { q[9] = M.sgtrLive(ed.pid) ? 1 : 0; q[10] = M.sgtrC() * M.sgWastOf(ed.pid); }
    if (Ck === 7) q[11] = M.cellBroken(ed.cx, ed.cy) ? 1 : 0;
    if (Ck === 8 || Ck === 10 || Ck === 12 || Ck === 15) q[12] = M.portWrecked(ed.pid) ? 1 : 0;
    if (Ck === 9) q[14] = M.sgOpen(ed.pid) ? 1 : 0;
    if (Ck === 10) {
      q[15] = (S.condLost && M.condVacuum(ed.pid)) ? 1 : 0;
      q[16] = q[15] ? M.condVentBore(ed.pid) : NaN;
      q[17] = M.condDumpOpen() ? 1 : 0;
      q[18] = M.condDumpKgs(); q[19] = M.TANK_RHO();
    }
    if (Ck === 11 || Ck === 14) q[20] = ((M.coreState(ed.pid) || S).breach) ? 1 : 0;
    if (Ck === 13 || Ck === 14) {
      const cs = M.coreState(ed.pid);
      q[21] = cs ? num(cs.tubesOpen) : NaN;
      q[22] = (cs && cs.cavRelief) ? 1 : 0;
    }
    if (Ck === 15) {
      q[23] = (S.burstBy && S.burstBy[ed.pid]) ? 1 : 0;
      const t = M.D().tanks[ed.pid] || {}, b = t.burst;
      q[24] = M.tankKg(ed.pid);
      q[25] = num(t.vol); q[26] = num(b && b.drain); q[27] = num(b && b.at);
      q[28] = b ? 1 : 0; q[29] = M.P().Pcont;
    }
    q[30] = M.CASINGF(); q[31] = M.PUMPH0();
    if (ed.pump) {
      q[32] = 1;
      q[33] = M.pumpHead(ed.pump); q[34] = M.pumpDrive(ed.pump);
      q[35] = M.cavOf(ed.pump); q[36] = M.pumpRhoK(ed.pump);
    } else q[32] = 0;
    q[37] = ed.poolAt !== undefined ? M.poolH(ed.poolAt) : 0;
    q[38] = M.HEADK();
    q[39] = typeof ed.h0 === 'function' ? ed.h0(S) : num(ed.h0);
    q[40] = ed.hSrc ? ed.hSrc(S) : 0;
    q[41] = num(ed.I);
    if (Ck === 3) { q[43] = ed.gateMode === 'throttle' ? 1 : 0; q[44] = M.reliefLive(ed.pid) ? 1 : 0; }
    const gateVals = [];
    if (ed.gateMode === 'throttle') for (const fid of (ed.gateIds || [])) gateVals.push(num(S.valve && S.valve[fid]));
    tail.edgeQ.push(q); tail.edgeGates.push(gateVals);
    if (process.env.GATE_EDGE_DBG && +process.env.GATE_EDGE_DBG === e) {
      try {
        const gg = (typeof ed.g === 'function') ? M.edgeG(e) : ed.g;
        console.error('jsedge e=' + e + ' Ck=' + Ck + ' g=' + gg + ' w=' + net.wArr[ed.wi] + ' mu_u=' + net.F.mu[ed.u] + ' mu_v=' + net.F.mu[ed.v] + ' p_u=' + net.F.p[ed.u] + ' p_v=' + net.F.p[ed.v] + ' dio=' + ed.diode + ' wet_u=' + net.F.wet[ed.u] + ' wet_v=' + net.F.wet[ed.v] + ' void_u=' + net.F.void[ed.u] + ' void_v=' + net.F.void[ed.v] + ' Cc=' + ed.Cc + ' u=' + ed.u + ' v=' + ed.v);
      } catch (err) { console.error('jsedge ERR ' + err.message); }
    }
  }
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'laneenv t=' + tag + ' ' + M.laneEnv() + '\n'); } catch (e) { }
  }
  tail.workFr = net.edges.map(ed => ed.work ? M.turbWorkFrac(ed.machine) : NaN);
  if (process.env.GATE_DEBUG) console.error('tailq o=' + parts.reduce((a, b) => a + b.length, 0));
  tail.withCap = 1; // march matrix builds always include store cap (netFactored)
  tail.widx = []; // v1: div-set compare vacuous (warns total still compared)
  // ---- run solve (live P-side advances) ----
  // pre-solve piece cache: the solve reuses it iff the post-field-update live
  // sig still matches its key (net.pcSig).
  const pcPre = net.pc
    ? { of: Array.from(net.pc.of), n: net.pc.n, live: Array.from(net.pc.live), sig: String(net.pcSig || '') }
    : null;
  // Exact solve-time live sig: run the solve's own field update on identical
  // inputs, read the sig, then restore F/store/gen bit-exact. Post-hoc F is
  // polluted by netNatCirc's extra updates, so a post-hoc sig misdecides.
  // The recomputed field IS the solve-time field: capture it for the dump,
  // since post-tick net.F is natCirc-flavored on full-natCirc ticks.
  let sigSolve = null;
  let sigsegNow = null;
  const fsolve = {};
  {
    const F = net.F;
    const fsnap = {};
    for (const f of ['p', 'rho', 'x', 'b', 'rhoD', 'rhoG', 'rhoL', 'wet', 'void', 'mu', 'lp', 'lh', 'lm']) fsnap[f] = Array.from(F[f]);
    const gsn = F.gen, stn = net.store;
    M.netFieldUpdate(S);
    sigSolve = M.netLiveSig();
    // Solve-time segments for the sig-verify sidecar: F is solve-time here.
    if (process.env.GATE_DBGFILE) { try { sigsegNow = M.sigSeg(); } catch (e) { sigsegNow = 'ERR:' + e.message; } }
    for (const f of ['p', 'rho', 'x', 'b', 'rhoD', 'rhoG', 'rhoL', 'wet', 'void', 'mu', 'lp', 'lh', 'lm']) fsolve[f] = Array.from(F[f]);
    for (const f of ['p', 'rho', 'x', 'b', 'rhoD', 'rhoG', 'rhoL', 'wet', 'void', 'mu', 'lp', 'lh', 'lm']) F[f].set(fsnap[f]);
    F.gen = gsn; net.store = stn;
  }
  const FM0 = (P.flowMapsOfNet || P.net.flowMaps || null);
  let runFlow = P.runFlowH;
  {
    // replicate stepMarch 3766-3790 setup with local holders
    const rk = M.runKeys();
    runFlow = { v: new Float64Array(rk.length), pos: new Map(rk.map((k, i) => [k, i])), n: rk.length };
  }
  const pField = { v: new Float64Array(n), has: new Uint8Array(n) };
  const netOut = {};
  const pumpK = M.netFlowK(S, runFlow, pField, netOut);
  // solve-time pieces: on cache hit the solve reused the pre-solve snapshot;
  // on miss it rebuilt fresh with s. netNatCirc (inside netFlowK) may rebuild
  // net.pc afterwards with pump-off sNat, so never read post-solve net.pc.
  // g>0 structure is S-determined, so a post-hoc fresh BFS is exact.
  {
    const reuse = pcPre && sigSolve === pcPre.sig;
    if (reuse) {
      tail.pcOf = pcPre.of; tail.pcN = pcPre.n; tail.pcLive = pcPre.live;
    } else {
      const fr = freshPieces(net);
      tail.pcOf = fr.of; tail.pcN = fr.n; tail.pcLive = fr.live;
    }
    if (process.env.GATE_DBGFILE) {
      try {
        fs.appendFileSync(process.env.GATE_DBGFILE, 'pcdec t=' + tag + ' reuse=' + reuse + ' sigPre=' + (pcPre && pcPre.sig) + ' sigSolve=' + sigSolve + '\n');
        fs.appendFileSync(process.env.GATE_DBGFILE, 'hold t=' + tag + ' ' + M.storeHeld() + '\n');
        fs.appendFileSync(process.env.GATE_DBGFILE, 'sigseg t=' + tag + ' ' + sigsegNow + '\n');
        if (tag === 0) fs.appendFileSync(process.env.GATE_DBGFILE, 'siglists P=' + S.P + ' ' + M.sigLists() + '\n');
      } catch (e) { }
    }
  }
  if (process.env.GATE_DEBUG && tag === 0) console.error('tick-condids ' + JSON.stringify(M.condIds()) + ' cwkeys=' + JSON.stringify(Object.keys(S.cwFlowBy || {})));
  P.runFlowH = runFlow; P.netOut = netOut;
  S.pBy = pField;
  if (process.env.GATE_DEBUG && tag === 0) console.error('post-solve TavgBy=' + JSON.stringify(S.TavgBy));
  if (process.env.GATE_DEBUG && tag === 0) {
    const nm62 = net.name[62];
    console.error('seed62 pAt=' + M.netPAt(nm62) + ' hAt=' + M.netHAt(nm62) + ' vol=' + net.vol[62] + ' mhas=' + (S.mBy.has[62] || 0) + ' netRho=' + M.netRhoAt(nm62));
  }
  if (process.env.GATE_DEBUG) {
    let mn = Infinity, mx = -Infinity;
    for (const v of pField.v) { if (v < mn) mn = v; if (v > mx) mx = v; }
    console.error('jspfield [' + mn + ',' + mx + '] q0=' + (netOut.edgeKg ? netOut.edgeKg[0] : 'n/a'));
    if (netOut.edgeKg) console.error('jsekg ' + Array.from(netOut.edgeKg.slice(0, 6)).join(','));
    if (netOut.scV) console.error('jssc ' + Array.from(netOut.scV).join(','));
    {
      const sc = net.scr || {};
      const stat = a => { if (!a) return 'n/a'; let s = 0, mn = Infinity, mx = -Infinity; for (const v of a) { s += v; if (v < mn) mn = v; if (v > mx) mx = v; } return s.toExponential(6) + ' [' + mn + ',' + mx + ']'; };
      console.error('jsgh G=' + stat(sc.ghG) + ' H=' + stat(sc.ghH) + ' b=' + stat(sc.b));
      {
        let tc = 0;
        const tch = sc.touch;
        if (tch) for (const v of tch) tc += v;
      console.error('jstouch ' + tc + '/' + (tch ? tch.length : -1));
      console.error('jsaf AfB=' + P.net.AfB + ' AfSig=' + P.net.AfSig);
      {
        const Af = P.net.Af;
        if (Af) {
          let s = 0;
          for (const v of Af) s += v;
          console.error('jsAf sum=' + s + ' Af0=' + Af[0] + ' Af1=' + Af[1] + ' len=' + Af.length);
        } else console.error('jsAf none');
      {
        const Af = P.net.Af, nf = P.net.Afn;
        if (Af && nf) {
          const dg = [];
          for (let i = 0; i < nf; i++) dg.push(Af[i * nf + i]);
          console.error('jsdiag ' + dg.map(v => v.toExponential(3)).join(','));
        }
      }
      }
    }
      {
        let bi = 0, bv = 0;
        for (let e = 0; e < sc.ghG.length; e++) if (sc.ghG[e] > bv) { bv = sc.ghG[e]; bi = e; }
        console.error('jsmaxg e=' + bi + ' g=' + bv);
        const n45 = [];
        for (let e = 0; e < net.edges.length; e++) {
          if (net.edges[e].u === 45 || net.edges[e].v === 45) n45.push('e' + e + ':g=' + sc.ghG[e] + ' h=' + sc.ghH[e]);
        }
        console.error('jsn45 ' + n45.join(' '));
        {
          const nxx = [];
          for (let e = 0; e < net.edges.length; e++) {
            const u = net.edges[e].u, v = net.edges[e].v;
            if (u === 41 || v === 41 || u === 43 || v === 43) nxx.push('e' + e + ':u=' + u + ' v=' + v + ' g=' + sc.ghG[e] + ' h=' + sc.ghH[e]);
          }
          console.error('jsn4143 ' + nxx.join(' '));
          const stc = P.net.store;
          console.error('jscap41 cap41=' + (stc.cap[41]) + ' src41=' + (stc.src[41]) + ' cap43=' + (stc.cap[43]) + ' src43=' + (stc.src[43]) + ' cap45=' + (stc.cap[45]) + ' src45=' + (stc.src[45]));
        }
        console.error('jsg51 g51=' + sc.ghG[51] + ' h51=' + sc.ghH[51] + ' g39=' + sc.ghG[39]);
        console.error('jse39 C39=' + M.dbgEdgeC(39) + ' H39=' + sc.ghH[39]);
      }
    }
    const st0 = P.net.store;
    if (st0) {
      let cs = 0, ss = 0;
      for (const v of (st0.cap || [])) cs += v;
      for (const v of (st0.src || [])) ss += v;
      console.error('jsstore capsum=' + cs + ' srcsum=' + ss);
    }
    console.error('jsfix fixn=' + M.dbgFixN() + ' edgec5=' + M.dbgEdgeC(5) + ' orderlen=' + (P.net.orderFree ? P.net.orderFree.length : -1) + ' order0=' + (P.net.orderFree ? Array.from(P.net.orderFree.slice(0, 8)).join(',') : '') + ' fixv=' + M.dbgFixV());
    {
      let mn = Infinity, mx = -Infinity;
      for (const v of net.F.p) { if (v < mn) mn = v; if (v > mx) mx = v; }
      console.error('jsfield p[' + mn + ',' + mx + ']');
    }
  }
  tail.natLoop = Array.from(P.flowNatScr || []);
  tail.divSig = String(P.net.AfTopo || '');
  const pcSigNow = String(net.pcSig || '');
  void pcSigNow;
  dumpSolveTail(S, P, net, tail);
  // ---- coreFlowNet + spill + tankRate + pcore + pressRead + burstDice ----
  const coreFN = P.coreFN || (P.coreFN = {});
  for (const id of meta.coreIds) M.coreFlowNetStep(S.coreBy[id], P.cores[id], id, coreFN, netOut, pumpK);
  { for (const id in S.cwFlowBy) if (!M.partOf(id)) delete S.cwFlowBy[id];
    for (const id of M.condIds()) S.cwFlowBy[id] = M.cwFlowOf(runFlow, id); }
  M.spillStep(S, netOut);
  const injRes = M.tankRateStep(S, netOut);
  M.pcoreStep(S, pField);
  M.pressRead(S, DT);
  M.burstDice(S, DT, pField);
  // ---- sec tail (post-solve/pre-advect readers that need S) ----
  const st = {};
  st.holdLive = M.holdTankIds().map(id => M.holdLiveOf(id));
  {
    const ids = meta.sec.sgIds.concat(meta.sec.ihxIds || []);
    st.stageFed = ids.map(id => M.stageFedOf(id));
  }
  st.tankP = meta.sec.tankIds.map(tid => M.tankPof(tid));
  st.coreFn = {};
  for (const id of meta.coreIds) st.coreFn[id] = coreFN[id];
  st.exhOpen = M.exhOpenOf() ? 1 : 0;
  st.roleTurbAlive = M.roleTurbAliveOf();
  st.contRel = {};
  for (const fid of M.reliefFitIds()) st.contRel['relief:' + fid] = M.contRelOf(fid);
  for (const tid of meta.sec.tankIds) st.contRel['tank:' + tid] = M.contRelOf(tid);
  for (const id of meta.sec.sgIds) st.contRel['sg:' + id] = M.contRelOf(id);
  st.shellsLive = {};
  for (const fid of M.reliefSecIds()) st.shellsLive[fid] = M.shellsLiveOf(fid);
  if (process.env.GATE_DEBUG && tag === 0) console.error('shellslive ' + JSON.stringify(st.shellsLive));
  st.mByPiece = M.netPiecesOf();
  st.corePiece = (P.net.coreNode === undefined || st.mByPiece[P.net.coreNode] === undefined) ? -1 : st.mByPiece[P.net.coreNode];
  st.corePieces = M.corePiecesOf();
  st.inLoopBits = [];
  {
    const nCirc = Math.max(0, ...meta.coreIds.map(id => M.coreCircOf(id))) + 1;
    for (let ci = 0; ci < nCirc; ci++) st.inLoopBits.push(net.name.map(nm => M.inLoopOf(ci, nm) ? 1 : 0));
  }
  st.dgen = M.DGEN(); st.netBurstGen = P.net.burstGen;
  st.condP = M.condP(); st.panelHit = M.panelHit(); st.condFrac = M.condFrac();
  st.secP = {}; for (const id of meta.sec.sgIds) st.secP[id] = M.secP(id);
  st.boilerLvl = {}; for (const id of meta.sec.boilerIds) st.boilerLvl[id] = M.boilerLvl(id);
  st.loopp = {}; for (const id of meta.coreIds) st.loopp[id] = M.loopp(id);
  st.qTank = {}; for (const tid of meta.sec.tankIds) st.qTank[tid] = M.outsBag('qTankV', 'qTankBy', 'qTankPos', tid);
  st.reliefV = {}; for (const fid of M.reliefFitIds()) st.reliefV[fid] = M.outsBag('reliefV', 'reliefBy', 'reliefPos', fid);
  st.sgFeed = {}; st.sgSteam = {};
  for (const id of meta.sec.sgIds.concat(meta.sec.drumIds || [])) st.sgFeed[id] = M.outsBag('sgFeedV', 'sgFeedBy', 'sgFeedPos', id);
  for (const id of meta.sec.sgIds) st.sgSteam[id] = M.outsBag('sgSteamV', 'sgSteamOutBy', 'sgSteamPos', id);
  st.runFlowKeys = [...runFlow.pos.keys()];
  dumpSecTail(S, P, st);
  // ---- advectStep (transport tail pre, then run) ----
  const tt = {};
  tt.src = M.advectSrc(DT);
  tt.metalQV = Array.from(P.net.scr.metalQV); tt.metalQM = Array.from(P.net.scr.metalQM);
  tt.bookedKg = []; for (let i = 0; i < n; i++) tt.bookedKg.push(num(M.bookedKg(i)));
  tt.boronPin = [];
  for (let i = 0; i < n; i++) {
    const tid = net.tankIdByNode && net.tankIdByNode[i];
    if (tid !== undefined && M.D().tanks[tid] && !M.D().tanks[tid].hold)
      tt.boronPin.push(num((S.boron0 || 0) - 100 * (num(M.tankFluidBoron(tid)) || 0)));
    else tt.boronPin.push(NaN);
  }
  tt.fbP = net.name.map(nm => M.netPAt(nm)); tt.fbH = net.name.map(nm => M.netHAt(nm));
  tt.tavgPrevT = meta.transTavgCircs.map(ci => num(M.TavgOf(S, ci)));
  tt.tavgPrevDT = meta.transTavgCircs.map(ci => num(M.dTavgOf(S, ci)));
  if (process.env.GATE_DEBUG && tag === 0) console.error('tavgcircs n=' + meta.transTavgCircs.length);
  if (process.env.GATE_DEBUG && tag === 0) console.error('tavgflt dwas=' + meta.transTavgCircs.map(ci => M.dTavgOf(S, ci)).join(',') + ' TRT=' + M.TRT() + ' raw=' + JSON.stringify(S.dTavgBy) + ' ck=' + meta.transTavgCircs.map(ci => JSON.stringify(M.circKey(ci))).join(',') + ' prevt=' + meta.transTavgCircs.map(ci => M.TavgOf(S, ci)).join(','));
  tt.tavgInLoop = []; tt.tavgCoreMember = [];
  meta.transTavgCircs.forEach((ci, t2) => {
    for (let i = 0; i < n; i++) {
      tt.tavgInLoop.push(M.inLoopOf(ci, net.name[i]) ? 1 : 0);
      tt.tavgCoreMember.push(meta.transCoreNids[t2].has(net.name[i]) ? 1 : 0);
    }
  });
  tt.riseA = meta.transRiseE.map(e => num(M.edgeCval(e)));
  dumpTransTail(S, P, net, tt);
  M.advectStep(S, DT, runFlow, netOut.edgeKg);
  if (process.env.GATE_DEBUG && tag === 0) {
    console.error('post-advect TavgBy=' + JSON.stringify(S.TavgBy) + ' dTavgBy=' + JSON.stringify(S.dTavgBy));
    const out = [];
    for (let e = 0; e < net.edges.length; e++) {
      const u = net.edges[e].u, v = net.edges[e].v;
      if ((u >= 62 && u < 72) || (v >= 62 && v < 72)) out.push('e' + e + ':' + u + '>' + v + ':q=' + netOut.edgeKg[e]);
    }
    console.error('jsq62 ' + out.join(' '));
    console.error('jsm62 ' + [62, 63, 64, 65, 66, 67, 68, 69, 70, 71].map(i => S.mBy.v[i]).join(','));
    console.error('jshpix p=' + S.pBy.v[17] + ' ph=' + S.pBy.has[17] + ' h=' + S.hBy.v[17] + ' hh=' + S.hBy.has[17]);
    console.error('jsTfHPI ' + M.dbgRunFluidT('hpi:coreb-hpir'));
    console.error('jsCircHPI ' + M.circOfNode('run:hpi:coreb-hpir'));
    console.error('jsh62 ' + [62, 63, 64, 65, 66, 67, 68, 69, 70, 71].map(i => S.hBy.v[i]).join(','));
  }
  // ---- invStep + sumpStep ----
  M.invStep(S);
  M.sumpStep(S, DT);
  // ---- cav → secTank ----
  const cavIds = M.cavStep(S, DT, pField);
  M.pumpQStep(S, runFlow);
  M.pumpCoastStep(S, DT);
  const heat2 = S.n * M.PROMPT_F() + S.decay;
  M.sgHeatStep(S, DT, runFlow, netOut, pumpK, heat2);
  M.holdReliefStep(S, DT, pField, netOut);
  M.discTankStep(S, DT);
  M.bookTailStep(S, injRes.inj);
  if (injRes.inj > 0) for (const id of meta.coreIds) M.coreFatigueStep(S.coreBy[id], DT, injRes.inj);
  M.sgtrStep(S, DT, netOut);
  // ---- core burst/vessel per vessel (+tube outcomes, +vessel tails) ----
  const tubeMap = {};
  for (const id of meta.coreIds) {
    const cs = S.coreBy[id], K = P.cores[id];
    const burst_p = K.P0 * (K.burstK - 0.0028 * cs.fatigue);
    if (K.tube) {
      const pre = { tubesOpen: cs.tubesOpen || 0, trip: cs.trip || '' };
      M.coreBurstStep(cs, K, id);
      const taken = (cs.tubesOpen || 0) > pre.tubesOpen || (cs.trip || '') !== pre.trip;
      tubeMap[id] = { taken, cs };
    } else {
      M.coreBurstStep(cs, K, id);
    }
  }
  for (const id of meta.coreIds) M.coreVesselStep(S.coreBy[id], P.cores[id], id, DT, coreFN);
  M.coreAgg(S);
  // ---- margin → secTank ----
  M.marginStep(S, pField, S.n * M.PROMPT_F() + S.decay, pumpK);
  M.condTurbStep(S);
  const secVentRes = M.secVentStep(S, DT, netOut);
  const { bleedAll } = M.shellStep(S, DT, netOut, secVentRes.secVent || secVentRes);
  M.condVentStep(S, DT);
  M.turbStep(S, netOut, secVentRes.pCond !== undefined ? secVentRes.pCond : secVentRes, bleedAll);
  M.radPanelStep(S, DT, runFlow);
  M.secTankStep(S, DT);
  // ---- kinetics/melt per vessel (+core tails) ----
  const coreTails = {};
  for (const id of meta.coreIds) {
    const cs = S.coreBy[id], K = P.cores[id];
    if (process.env.GATE_DEBUG && tag === 0) console.error('jskin-pre ' + id + ' n=' + cs.n + ' rho=' + cs.rho + ' rodPos=' + cs.rodPos);
    M.coreKineticsStep(cs, K, DT);
    if (process.env.GATE_DEBUG && tag === 0) console.error('jskin-post ' + id + ' n=' + cs.n + ' rho=' + cs.rho);
    coreTails[id] = {
      hIn: M.coreInH(id), sink: M.sinkRod(id) ? 1 : 0,
      sat: M.satT(id), vLeak: M.vLeak(id), relPart: M.contRelOf(id),
      h2m2: 0, h2m2none: 1, h2pre: NaN, h2preHas: 0,
      loopKg: M.loopKg(), coreDTMax: M.coreDTMax(), tiltRate: M.tiltRate(id),
      dose: M.dose(), catcher: M.catcher() ? 1 : 0,
    };
    {
      const nid = M.coreFold(id), ni = net.index[nid];
      if (ni !== undefined) {
        coreTails[id].h2m2none = 0;
        coreTails[id].h2m2 = S.mBy.has[ni]
          ? S.mBy.v[ni]
          : num(net.vol[ni] * M.netRhoAt(nid));
        coreTails[id].h2pre = S.h2By.v[ni];
        coreTails[id].h2preHas = S.h2By.has[ni] ? 1 : 0;
      }
    }
    M.coreMeltStep(cs, K, id, DT);
  }
  M.coreAgg(S);
  const h2PostVessel = num(S.h2);
  // ---- radDose + inject + room ----
  M.radDoseStep(S, DT);
  M.injectFluid(S, DT);
  M.roomStep(S, DT);
  // ---- blast → ledger (trip capture post-evLatch) ----
  M.blastStep(S, DT);
  M.overpressureStep(S);
  M.burnFireStep(S);
  M.cookStep(S, DT);
  // ann predicates read live SG pressures/levels; the sec-tail dump is
  // pre-transport. Capture evLatch-time values like coreTails.
  const annSecP = {}, annBoilerLvl = {};
  for (const id of meta.sec.sgIds) annSecP[id] = M.secP(id);
  for (const id of meta.sec.boilerIds) annBoilerLvl[id] = M.boilerLvl(id);
  // coreSeen() memoizes per (s.tick, ctlSinkGen); march never advances S.tick
  // so evLatchStep would read stale ctlPass-time views (notably Tavg) while
  // the replay reads live post-tick state. Bump by a fresh multiple of 5 per
  // window (gating by s.tick%ANN_TICKS is invariant; a constant bump would
  // collide with the previous window when gen is static) to force fresh
  // views, then restore. NOTE: no coreSeen() reads inside this window except
  // evLatchStep's own, or the memo is perturbed for the next phase.
  const csBump = 5 * (++coreSeenSeq);
  S.tick += csBump;
  M.evLatchStep(S, cavIds, injRes.injIds);
  S.tick -= csBump;
  const tripNearMid = M.tripNear() ? 1 : 0;
  M.repairStep(S, DT);
  const runFlow2 = P.runFlowH;
  M.flowSpinStep(S, DT, runFlow2);
  M.ledgerStep(S, DT, ledgM0, ledgO0);
  M.netMarching(false);
  return { pumpK, heat, runFlow, pField, netOut, coreFN, cavIds, injIds: injRes.injIds, secVentRes, bleedAll, tubeMap, coreTails, h2PostVessel, log0, cg0, tripNearMid, annSecP, annBoilerLvl, fsolve };
}

// ---- per-tick post section (probe order: core tails, bore, events tail,
// trip/inj/h2/tube, posts, LOG, warns, div) ----
function writeTickPost(meta, S, P, HB, net, R) {
  const n = net.n;
  for (const id of meta.coreIds) {
    const t = R.coreTails[id];
    str(id);
    dumpCoreTail(S, P, id, t);
  }
  {
    const keys = [...new Set([...Object.keys(S.spillBy || {}), ...Object.keys(S.reliefVent || {}).map(fid => M.ventKeyOf(fid)).filter(k => k)])];
    const bore = {};
    for (const k of keys) bore[k] = M.boreOf(k);
    u32(keys.length);
    for (const k of keys) { str(k); f64(bore[k]); }
  }
  {
    const et = {};
    et.rpsState = M.rps(); et.sinkRunback = M.sinkRunback(); et.runbackLive = M.runbackLive();
    et.dryIds = M.netDry();
    et.panelHit = M.panelHit(); et.condFrac = M.condFrac();
    et.contRel = {};
    for (const id of meta.coreIds) et.contRel[id] = M.contRel(id);
    const rid = S.repair && S.repair.id;
    et.partyCells = rid ? M.partyCells(rid) : [];
    dumpEventsTail(S, et);
  }
  u8(R.tripNearMid ? 1 : 0);
  {
    const q = S.inject;
    str(q && typeof q.target === 'string' ? q.target : '');
  }
  f64(R.h2PostVessel);
  {
    const ids = Object.keys(R.tubeMap);
    u32(ids.length);
    for (const id of ids) {
      const t = R.tubeMap[id];
      str(id);
      u8(t.taken ? 1 : 0);
      if (!t.taken) continue;
      const cs = S.coreBy[id];
      u8an(Array.from(cs.nTube || []));
      f64(num(cs.tubesOpen)); str(cs.trip || '');
      u8(cs.cavRelief ? 1 : 0); u8(cs.breach ? 1 : 0);
      f64(num(S.roomBang));
      f64an(Array.from(S.roomP || []));
      const msgs = M.LOG().slice(R.log0).map(e => e.msg || '');
      u8(msgs.some(m => m.startsWith('FUEL CHANNEL RUPTURE / ')) ? 1 : 0);
      u8(msgs.some(m => m.startsWith('UPPER SHIELD LIFTED / ')) ? 1 : 0);
    }
  }
  const HB2 = M.HB();
  M.SIMSTATE.secState(GW, S, HB2, meta.sec);
  M.SIMSTATE.roomState(GW, S, meta.room);
  u32(M.roomCgIt()); u32(M.liqCgIt()); u32(M.roomPGen());
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'pre-ev P=' + S.P + ' tkeys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
  M.SIMSTATE.eventsState(GW, S, meta.events);
  // evLatch-time ann inputs (sec-tail values are pre-transport stale).
  strmap(R.annSecP || {}); strmap(R.annBoilerLvl || {});
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'post-ev P=' + S.P + ' tkeys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
  u32(meta.coreIds.length);
  for (const id of meta.coreIds) { str(id); M.SIMSTATE.coreState(GW, S, id); }
  M.SIMSTATE.canonBags(GW, S, n);
  if (process.env.GATE_DEBUG) console.error('post-blk len=' + (S.blkOutV ? S.blkOutV.length : -1) + '/' + (S.blkOutF ? S.blkOutF.length : -1));
  if (process.env.GATE_DEBUG) console.error('post-tavg Tavg=' + S.Tavg + ' dTavg=' + S.dTavg + ' TavgBy=' + JSON.stringify(S.TavgBy));
  if (process.env.GATE_DEBUG) console.error('post-cw ' + JSON.stringify(S.cwFlowBy));
  if (process.env.GATE_DEBUG) console.error('post-mo ' + JSON.stringify(S.massOut));
  if (process.env.GATE_DEBUG) console.error('post-flowfn tail=' + JSON.stringify(R.coreFN) + ' P=' + JSON.stringify(P.coreFN) + ' cs=' + meta.coreIds.map(id => S.coreBy[id].flowNet).join(','));
  f64an(S.blkOutV ? Array.from(S.blkOutV) : []);
  f64an(S.blkOutF ? Array.from(S.blkOutF) : []);
  f64(num(S.Tavg)); f64(num(S.dTavg));
  strmap(S.TavgBy || {}); strmap(S.dTavgBy || {});
  {
    // Solve-time field (R.fsolve): post-tick net.F is natCirc-flavored on
    // full-natCirc ticks, which the replay (solve-time only) cannot match.
    const F = R.fsolve || net.F;
    for (const f of ['p', 'rho', 'x', 'b', 'rhoD', 'rhoG', 'rhoL']) f64a(Array.from(F[f]));
    u8a(Array.from(F.wet)); u8a(Array.from(F.void));
    for (const f of ['mu', 'lp', 'lh', 'lm']) f64a(Array.from(F[f]));
  }
  for (const a of [net.stKp, net.stKh, net.stKm, net.stP0, net.stC]) f64a(Array.from(a));
  f64a(Array.from(net.wArr || []));
  {
    const evs = M.LOG().slice(R.log0).map(mapEvent);
    u32(evs.length);
    for (const [sv, code] of evs) { u8(sv); u32(code); }
  }
  u32(consoleWarns - R.cg0);
  {
    const divs = [];
    u32(divs.length);
    for (const d of divs) u32(d);
  }
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'endpost P=' + S.P + ' tick=' + S.tick + ' tkeys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
}

// ---- ctl Sample (post-pass capture; replica-equivalent without re-eval:
// sources read post blkOutV (plant static during ctlPass), dead/blame are
// pure post-pass reads; scram-blame staleness risk documented) ----
// ensure blkOutV/F parallel to ids (copied from ctl-gate.js replica preamble;
// runs before pre-capture so pre.out is what eval starts from, like JS).
function ensureBlk(S) {
  const blkBy = S.blkBy || {};
  const ids = Object.keys(blkBy);
  let idx = M.getIdx(), idk = M.getIdk();
  let same = idx && idk && idk.length === ids.length && S.blkOutV && S.blkOutV.length === ids.length && S.blkOutF && S.blkOutF.length === ids.length;
  if (same) for (let i = 0; i < ids.length; i++) if (idk[i] !== ids[i]) { same = false; break; }
  if (!same) {
    if (idx && idk && S.blkOutV && S.blkOutF) for (let i = 0; i < idk.length; i++) {
      const b0 = blkBy[idk[i]]; if (!b0) continue;
      const ix = idx[idk[i]]; b0.out = S.blkOutV[ix]; b0.f = S.blkOutF[ix];
    }
    idx = Object.fromEntries(ids.map((id, i) => [id, i])); idk = ids.slice();
    M.setIdx(idx); M.setIdk(idk);
    S.blkOutV = new Float64Array(ids.length); S.blkOutF = new Float64Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      const b0 = blkBy[ids[i]];
      S.blkOutV[i] = b0.out === undefined ? 0 : b0.out; S.blkOutF[i] = b0.f;
    }
  }
}
function dumpCtlSample(S, dt, pre, actPre) {
  M.FREEZE.ctlSample(GW, S, dt, pre, actPre, i => S.blkOutV[i]);
  f64a(Array.from(S.blkOutV));
  f64a(Array.from(S.blkOutF));
  M.FREEZE.ctlKeys(GW, actPre);
}

// ---- per-tick tails (wire order matches step-probe tail readers) ----
function dumpSolveTail(S, P, net, tail) {
  const n = net.n, ne = net.edges.length;
  f64a(tail.fbP);
  f64a(tail.fbH);
  f64a(tail.pool);
  u32(tail.cont.length);
  for (const [i, p] of tail.cont) { u32(i); f64(p); }
  u8(tail.held ? 1 : 0);
  f64a(tail.contP);
  const pins = l => { u32(l.length); for (const [i, p] of l) { u32(i); f64(p); } };
  pins(tail.holdPins); pins(tail.drumPins); pins(tail.tankPins); pins(tail.secPins); pins(tail.condPins);
  for (const [c, p] of tail.tanks) { f64(c); f64(p); }
  for (const [c, w, p0, wr, va] of tail.conds) { f64(c); f64(w); f64(p0); u8(wr ? 1 : 0); u8(va ? 1 : 0); }
  if (process.env.GATE_DEBUG) console.error('edgeq o=' + parts.reduce((a, b) => a + b.length, 0));
  for (let e = 0; e < tail.edgeQ.length; e++) {
    f64a(tail.edgeQ[e]);
    const gv = tail.edgeGates[e] || [];
    u32(gv.length); f64a(gv);
  }
  u8(tail.withCap ? 1 : 0);
  u32(tail.widx.length); u32a(tail.widx);
  f64a(tail.workFr);
  u32(tail.pcOf.length); i32a(tail.pcOf);
  u32(tail.pcN);
  u32(tail.pcLive.length); u8a(tail.pcLive);
  f64a(tail.natLoop);
  str(tail.divSig);
}

function dumpSecTail(S, P, tail) {
  u8a(tail.holdLive);
  u32(tail.stageFed.length); u8a(tail.stageFed);
  f64a(tail.tankP);
  strmap(tail.coreFn);
  u8(tail.exhOpen ? 1 : 0);
  i32(tail.roleTurbAlive);
  strmap(tail.contRel);
  {
    const ks = Object.keys(tail.shellsLive);
    u32(ks.length);
    for (const k of ks) { str(k); strsn(tail.shellsLive[k]); }
  }
  u32(tail.mByPiece.length); i32a(tail.mByPiece);
  i32(tail.corePiece); u32(tail.corePieces.length); i32a(tail.corePieces);
  u32(tail.inLoopBits.length);
  for (const row of tail.inLoopBits) { u32(row.length); u8a(row.map(v => v ? 1 : 0)); }
  f64(tail.dgen); f64(tail.netBurstGen);
  f64(tail.condP); f64(tail.panelHit); f64(tail.condFrac);
  strmap(tail.secP); strmap(tail.boilerLvl); strmap(tail.loopp);
  strmap(tail.qTank); strmap(tail.reliefV); strmap(tail.sgFeed); strmap(tail.sgSteam);
  strsn(tail.runFlowKeys);
}

function dumpTransTail(S, P, net, tail) {
  const n = net.n, ne = net.edges.length;
  f64a(tail.src);
  f64a(tail.metalQV); u8a(tail.metalQM);
  f64a(tail.bookedKg);
  f64a(tail.boronPin);
  f64a(tail.fbP); f64a(tail.fbH);
  f64a(tail.tavgPrevT); f64a(tail.tavgPrevDT);
  u8an(tail.tavgInLoop); u8an(tail.tavgCoreMember);
  f64a(tail.riseA);
}

function dumpCoreTail(S, P, id, tail) {
  f64(tail.hIn); u8(tail.sink ? 1 : 0);
  f64(tail.sat); f64(tail.vLeak); f64(tail.relPart);
  f64(tail.h2m2); u8(tail.h2m2none ? 1 : 0); f64(tail.h2pre); u8(tail.h2preHas ? 1 : 0);
  f64(tail.loopKg); f64(tail.coreDTMax); f64(tail.tiltRate);
  f64(tail.dose); u8(tail.catcher ? 1 : 0);
}

function dumpEventsTail(S, tail) {
  str(tail.rpsState);
  u8(tail.sinkRunback ? 1 : 0); u8(tail.runbackLive ? 1 : 0);
  strsn(tail.dryIds);
  f64(tail.panelHit); f64(tail.condFrac);
  strmap(tail.contRel);
  u32(tail.partyCells.length); u32a(tail.partyCells);
}

// ---- main loop ----
{
  const allKeys = Object.keys(M.PRE());
  const keys = PRESET_ONLY === null ? allKeys : allKeys.filter(k => PRESET_ONLY.includes(k));
  if (keys.length === 0) { console.error('no presets match --preset ' + PRESET_ARG); process.exit(2); }
  const np = keys.length;
  const hb = Buffer.alloc(8);
  hb.writeUInt32LE(np, 0); hb.writeUInt32LE(M.SIMSTATE.VERSION, 4);
  fs.writeSync(fd, hb);
}
for (const k of Object.keys(M.PRE())) {
  if (PRESET_ONLY !== null && !PRESET_ONLY.includes(k)) continue;
  M.plantPreset(+k); M.buildLayout(); M.commission();
  M.S().diceOff = true;
  M.S().seed = M.S().rng = (123456789 + 1000003 * +k) >>> 0;
  presetNames.push(M.PRE()[k][0]);
  freezeBufs.push(Buffer.from(M.FREEZE.build()));
  const m0 = M.SIMSTATE.meta(GW);
  M.SIMSTATE.state(GW, m0);
  const P = M.P(), net = P.net;
  const coreIds = m0.coreIds;
  const meta = {
    sec: m0.sec, room: m0.room, events: m0.events, coreIds,
    transTavgCircs: [], transCoreNids: [], transRiseE: [],
  };
  // NOTE: trans meta tables needed by marchTick tails; re-derive cheaply
  {
    const G = M.nodeGraph();
    const circs = M.holdCircs().filter(ci => G.coreCircs[ci] === 1);
    meta.transTavgCircs = circs;
    meta.transCoreNids = circs.map(ci => new Set(M.coreOnCirc(ci).map(id => M.coreFold(id))));
    meta.transRiseE = net.edges.filter(ed => !M.netHole(ed) && net.z[ed.u] !== net.z[ed.v])
      .map(ed => net.edges.indexOf(ed));
  }
  u32(TICKS);
  // Fresh-process semantics: liqCgIt is a sticky module readout (not reset on
  // dry ticks); reset per preset so sequential presets don't leak counts.
  M.liqCgReset();
  for (let t = 0; t < TICKS; t++) {
    if (!M.P().net) { skipped.noNet++; continue; }
    const R = marchTick(meta, t);
    writeTickPost(meta, M.S(), M.P(), M.HB(), M.P().net, R);
    nSamples++;
    for (const b of parts.splice(0)) fs.writeSync(fd, b);
  }
  for (const b of parts.splice(0)) fs.writeSync(fd, b);
}
fs.closeSync(fd);
const freezePath = path.join(tmp, 'freeze.bin');
fs.writeFileSync(freezePath, Buffer.concat(freezeBufs));
console.log('freeze ' + freezePath);

// ---- probe run ----
const CARGO = (() => {
  try {
    const p = path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
    fs.accessSync(p); return p;
  } catch { return 'cargo'; }
})();
const out = execFileSync(CARGO, ['run', '--quiet', '--release', '--manifest-path',
  path.join(ROOT, 'sim-rs', 'Cargo.toml'), '--bin', 'step-probe', '--', fIn],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RUSTUP_TOOLCHAIN: '1.89.0-x86_64-pc-windows-gnu' } });
console.log(out.trim());
console.log('skipped=' + JSON.stringify(skipped));
const pass = /FAILURES=0/.test(out);
if (pass && PRESET_ONLY === null) {
  fs.writeFileSync(path.join(ROOT, 'tools', 'step-baseline.json'), JSON.stringify({
    presets: presetNames, ticks: TICKS, samples: nSamples,
  }, null, 1) + '\n');
}
if (!process.env.KEEP_TMP) fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
