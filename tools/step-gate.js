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

const M = headless('{PRE:()=>PLANTPRE,plantPreset,buildLayout,commission,P:()=>P,S:()=>S,D:()=>D,step,' +
  'GW:()=>GW,GH:()=>GH,' +
  'coreIds:()=>coreIds(),sgIds:()=>sgIds(),boilerIds:()=>boilerIds(),pumpIds:()=>pumpIds(),tankIds:()=>tankIds(),' +
  'reliefFitIds:()=>reliefFitIds(),radIds:()=>radIds(),' +
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
  'tickCav:()=>tickCavIds.slice(),tickInj:()=>tickInjIds.slice(),' +
  'ledgerKg:()=>ledgerKg(S),ledgerOut:()=>ledgerOut(S),sumpKg:()=>sumpKg(S),' +
  'tripNear:()=>!!tripNear(),rps:()=>rpsState(),' +
  'sinkRunback:()=>!!sinkWired(S,"runback",null),runbackLive:()=>runbackLive(),' +
  'netDry:()=>netDryParts(S),condP:()=>condP(S),panelHit:()=>radTMax(S),condFrac:()=>condFrac(S),' +
  'secP:(id)=>secP(S,id),boilerLvl:(id)=>boilerLvl(S,id),' +
  'loopp:(id)=>{const K=P.cores&&P.cores[id]; return K?loopP(S,K.circ):S.P;},' +
  'contRel:(id)=>contRelPart(S,partOf(id)),' +
  'partyCells:(id)=>{const p=dmgPart(id); if(!p) return [];' +
  ' if(p.stand&&p.stand.length) return p.stand.map(c=>c[1]*GW+c[0]);' +
  ' const g=occupied(null,{pipes:false}); return freeAdj(p,g).map(c=>c[1]*GW+c[0]);},' +
  'partSkin:(id)=>{const p=partOf(id); return p?partSkin(S,p):0;},' +
  'LOGlen:()=>LOG.length,LOGget:(i)=>LOG[i],' +
  // ctl sample readers
  'ctlLive:(s)=>ctlLive(s),ctlOrder:(s)=>ctlOrder(s),' +
  'blkOutOf:(s,id)=>blkOutOf(s,id),blkDead:(s,b)=>blkDead(s,b),' +
  'blkEval:(s,b,I,dt,ix)=>blkEval(s,b,I,dt,ix),' +
  'sinkDriver:(s,sink,arg)=>sinkDriver(s,sink,arg),blkBlame:(s,drv)=>blkBlame(s,drv),' +
  // solve readers (tail)
  'netPAt:(nm)=>netPAt(S,nm),netHAt:(nm)=>netHAt(S,nm),poolLvlOf:(i)=>poolLvlOf(P.net,S,i),' +
  'holdPOf:(id)=>holdPOf(S,id),holdSetP:(ci)=>holdSetP(tankCircuit(ci)),' +
  'tankP:(id)=>tankP(S,id),tankCapAt:(id)=>tankCapAt(S,id),' +
  'secP2:(id)=>secP(S,id),condP2:(id)=>condP(S,id),condVacuum:(id)=>condVacuum(id),' +
  'condStoreC:(id)=>condStoreC(S,id),condStoreW:(id)=>condStoreW(S,id),condSatP:(id)=>condSatP(S,id),' +
  'partWrecked:(id)=>partWrecked(S,id),turbWorkFrac:(m)=>turbWorkFrac(S,m),' +
  'netLiveSig:()=>netLiveSig(P.net,S),divSig:()=>P.net.AfTopo||"",holdLive:(ci)=>holdLive(P.net,S,ci),' +
  'stageFed:(id)=>stageFed(P.net,S,id),exhOpen:()=>exhOpen(S),roleTurbAlive:()=>roleAlive("turb",S),' +
  'shellsLive:(fid)=>shellsLive(S,fid),coreFlowNet:(id)=>{const K=P.cores[id]; return coreFlowNet(K,id,P.netOut,S.flowNet);},' +
  // transport readers
  'advectSrc:()=>Array.from(advectSrc(S,DT,P.runFlowH)),bookedKg:(i)=>bookedKg(P.net,S,i),' +
  'tankFluidBoron:(tid)=>tankFluid(tid).boron,edgeCval:(e)=>edgeCval(P.net,P.net.edges[e],S),' +
  'edgeG:(e)=>edgeG(P.net,P.net.edges[e],S),' +
  'netFieldUpdate:(s)=>netFieldUpdate(P.net,s),' +
  'dbgTavgDev:(id)=>{const o=coreSeen(S,id); const tp=tProg(o); return {tavg:o.Tavg, tp, dev:Math.abs(o.Tavg-tp)};},' +
  'inLoop:(ci,nm)=>inLoop(ci,nm),' +
  // core readers
  'satT:(id)=>{const K=P.cores[id];return satT(K.sat,S.coreBy[id].pCore);},' +
  'coreInH:(id)=>coreInH(S,id),sinkRod:(id)=>sinkDriver(S,"rodStep",id)?1:0,' +
  'loopKg:()=>loopKg(),coreDTMax:()=>coreDT0()*8.3,tiltRate:(id)=>tiltRate(P.cores[id]),' +
  'dose:()=>P.dose,catcher:()=>!!P.catcher,' +
  'vLeak:(id)=>{const K=P.cores[id],cs=S.coreBy[id];const m=S.mBy.v[S.mBy.has?P.net.index[coreFold(id)]:-1];' +
  ' const rvl=satRvl(K.sat,cs.pCore);' +
  ' return (!(K.coreKg0>0)||m===undefined||(K.sat.tc&&K.Tref>K.sat.tc))?0:Math.max(0,(1-m/K.coreKg0)/Math.max(1-rvl,1e-3));},' +
  // room readers
  'spillBy:()=>({...S.spillBy}),reliefVent:()=>({...S.reliefVent}),' +
  'outKg:(k)=>outKgOf(P.net,k),outH2:(k)=>outH2Of(P.net,k),boreOf:(key)=>openBoreM(key),' +
  // consts
  'PROMPT_F:()=>PROMPT_F,P0:()=>P.P0,netRef:()=>P.netRef,nLoops:()=>P.loops,' +
  'DGEN:()=>DGEN,' +
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
  'SG_LOW:()=>SG_LOW,SG_DRY_LO:()=>SG_DRY_LO,' +
  'SG_EFW_OFF:()=>SG_EFW_OFF,SG_DRY:()=>SG_DRY,SGL_SET:()=>SGL_SET,SG_DOME:()=>SG_DOME,' +
  'TURB_TRIP_P:()=>TURB_TRIP_P,COND_DT0:()=>COND_DT0,TPROG_SPAN:()=>TPROG_SPAN,' +
  'T_HULL:()=>T_HULL,AIR_MMOL:()=>AIR_MMOL,H2_MMOL:()=>H2_MMOL,H2O_MMOL:()=>H2O_MMOL,' +
  'RAD_K:()=>RAD_K,' +
  'roomCgIt:()=>roomCgIt,liqCgIt:()=>liqCgIt,liqCgReset:()=>{liqCgIt=0;},roomPGen:()=>roomPGen,' +
  'gsX:()=>Array.from(gsX||[]),gsDisp:()=>Array.from(gsDisp||[]),' +
  'CHOKE:()=>FLOWG_CHOKE,netMarching:(v)=>netMarching(v),' +
  // sec dumpMeta bindings (copied needs from sec-gate.js)
  'LAY:()=>LAY,coreCircOf:(id)=>coreCircOf(id),coreOnCirc:(ci)=>coreOnCirc(ci),holdOnCirc:(ci)=>holdOnCirc(ci),' +
  'primaryCore:()=>primaryCore(),shellsOf:(fid)=>shellsOf(fid),' +
  'flowMapsOf:(net)=>{const m=flowMapsOf(net); return {byKeys:m.byKeys,byPos:[...m.byPos],sgtrKeys:m.sgtrKeys,sgtrPos:[...m.sgtrPos]};},' +
  'netBooked:()=>Array.from(netBooked(P.net)),' +
  'layParts:()=>LAY.parts.map(p=>({id:p.id,x:p.x,y:p.y,w:p.w,h:p.h,role:p.role,name:p.name})),' +
  'pburst:(id)=>{const p=partOf(id); return p?partPburst(p):null;},' +
  'pdes:(id)=>{const p=partOf(id); return p?partPdes(p):0;},' +
  'ptsurv:(id)=>{const p=partOf(id); return p?partTsurv(p):0;},' +
  'faceNodes:(id)=>partFaceNode(id),' +
  'tankHold:(id)=>tankHold(id),' +
  'cellHazards:()=>cellHazards(),' +
  'coreRated:(id)=>P.cores[id].rated,coreNB:(id)=>P.cores[id].NB,' +
  'satTref:(ci)=>satOfCirc(ci).Tref,' +
  'holdOf:(id)=>{const K=P.cores&&P.cores[id]; const h=K?holdOnCirc(K.circ):[]; return h.length?h[0]:"";},' +
  'coresTref:(id)=>P.cores[id].Tref,coresSteam:(id)=>P.cores[id].steam,' +
  'Pget:(k)=>P[k],' +
  'tProgBase:()=>({tref:(S.K||P).Tref,steam:(S.K||P).steam}),' +
  'ratedSteam:()=>ratedSteam(),sgLift:()=>sgDesignP()*PORV_LIFT_K,' +
  'panelThresh:()=>tsatSec(TURB_TRIP_P)-COND_DT0,' +
  'fuelInCoolant:()=>COOLANT[priD().cool].fuelInCoolant,waterAct:()=>FLUID.water.act,' +
  'primaryRelief:()=>primaryRelief()||"",' +
  'tankAct:(id)=>tankFluid(id).act,' +
  'runKeys:()=>flowMapsOf(P.net).runKeys,' +
  'runPos:()=>{const m={}; for(const [k,v] of flowMapsOf(P.net).runPos) m[k]=v; return m;},' +
  'runRec:(key)=>{const r=P.net.byKey[key]; return r?{k:r.k,pa:r.pa,pb:r.pb}:null;},' +
  'runTag:(key)=>P.net.tagByKey[key]||0,' +
  'steamBook:(key)=>{const r=P.net.byKey[key]; if(!r) return null;' +
  ' const b=steamBook(key,r.k);' +
  ' return {vent:!!b.vent,taps:(b.taps||[]).slice(),dir:steamDir(key,r.k),' +
  ' gens:(b.gens||[]).slice(),ends:!!runEnds(key,r.k)};},' +
  'matOf:()=>Array.from(matRegions().of),' +
  'crewRect:()=>{const p=roleOf("ctrl")||(primaryCore()?partOf(primaryCore()):null);' +
  ' return p?[p.x,p.y,p.w,p.h]:null;},' +
  'radK:()=>P.radK,radPipe:()=>P.radK.pipe,' +
  'coreCirc:()=>nodeGraph().coreCirc,coreCircs:()=>nodeGraph().coreCircs,holdCircs:()=>holdCircs(),' +
  'drumIds:()=>drumIds(),loopOf:(id)=>loopOf(id),' +
  'condIds:()=>condIds(),condSinks:()=>condSinks(),' +
  'cwFlowOf:(rf,id)=>cwFlowOf(rf,id),partOf:(id)=>partOf(id),' +
  'tankFluidAct:(id)=>tankFluid(id).act,tankInField:(id)=>tankInField(id),' +
  'tankPrimary:(id)=>tankPrimary(id),tankKg:(id)=>tankKg(id),' +
  'primaryPump:(id)=>primaryPump(id),pumpResOf:(id)=>pumpResOf(id),pumpSucNode:(id)=>pumpSucNode(id),' +
  'pumpEdgeKey:(id)=>pumpEdgeKey(id),pumpRotor:(id)=>pumpRotor(id),' +
  'boilerNode:(id)=>boilerNode(id),boilerCirc:(id)=>boilerCirc(id),feedNode:(id)=>feedNode(id),' +
  'condSinks:()=>condSinks(),breakKeyOf:(id)=>breakKeyOf(id),' +
  'condInA:(id)=>{const IN=condIN(id); return IN?IN.a:"";},' +
  'condVacuum:(id)=>condVacuum(id),condVolOf:(id)=>condVolOf(id),' +
  'cwPathsOf:(id)=>cwPathsOf(id).map(q=>({key:q.key,a:q.a,b:q.b})),' +
  'radUAOf:(id)=>radUAOf(id),radMass:(id)=>radMass(id),partVol:(id)=>partVol(id),' +
  'radCoatEmis:(id)=>radCoatOf(id).emis,radArea:(id)=>radArea(id),' +
  'tickRadKey:(id)=>tickRadKey(id),radInternal:()=>{const IN=ROLE.radiator.internal; return [IN.a,IN.b];},' +
  'radLive:(id)=>radLive(id),ihxIds:()=>ihxIds(),ihxUAOf:(id)=>ihxUAOf(id),' +
  'isDrum:(id)=>isDrum(id),sgActive:(id)=>sgActive(id),' +
  'sgDesignP:(id)=>sgDesignP(id),sgMassOf:(id)=>sgMassOf(id),sgBurstP:(id)=>sgBurstP(id),' +
  'shellNode:(id)=>shellNode(id),shellCirc:(id)=>shellCirc(id),sgPrimCirc:(id)=>sgPrimCirc(id),' +
  'primFaces:(id)=>{const IN=roleIns(partOf(id))[0]; return IN?[IN.a,IN.b]:null;},' +
  'DRY_MIN_KG:()=>DRY_MIN_KG,inCore:(nm)=>nodeGraph().inCore(nm),' +
  'holdLineSet:()=>holdLineSet(),roleOfCond:()=>roleOf("cond"),condPDes:()=>condPDes(),' +
  'matRegions:()=>{const g=matRegions(); return {of:Array.from(g.of), n:g.regions.length};},' +
  'condVesNode:(id)=>condVesNode(id),' +
  'tankPrimary:(id)=>tankPrimary(id),tankCircuit:(id)=>tankCircuit(id),' +
  'reliefPriIds:()=>reliefPriIds(),reliefSecIds:()=>reliefSecIds(),' +
  'reliefSet:(fid)=>{const s=reliefSet(fid); return [s.lift,s.reseat];},' +
  'fitSpring:(fid)=>fitSpring(fid),hasTarget:(fid)=>!!(P.net.fitTarget&&P.net.fitTarget[fid]),' +
  'reliefNodeOf:(fid)=>reliefNodeOf(P.net,fid),' +
  'outKeysOf:()=>outKeysOf(P.net),' +
  'stageKeysOf:(id)=>stageKeysOf(id),stageInNbr:(s,id,k)=>{stageInNode(s,id,k); const nb=P.net.sgInNbr[id]; return nb?(nb[k]||[]):[];},' +
  'sgtrKeyOf:(id)=>sgtrKeyOf(id),ventKeyOf:(fid)=>ventKeyOf(fid),breakKeyOf:(id)=>breakKeyOf(id),' +
  'pipeNetwork:()=>pipeNetwork(),runBurstP:(r)=>runBurstP(r),runNodeOf:(key)=>runNodeOf(key),' +
  'matTight:(k)=>{const m=matRow(D.mat[k].m); return !!m.tight;},' +
  'matBurstP:(x,y)=>matBurstP(x,y),FIRE:()=>FIRE,' +
  'circOfNode:(nm)=>circOfNode(nm),foldMap:()=>foldMap(),' +
  'circBurn:(ci)=>{const c=satOfCirc(ci); return c.burn||"";},' +
  'steamRise:()=>steamRise(),roomSteamH:()=>roomSteamH(),loopKg:()=>loopKg(),coreDT0:()=>coreDT0(),' +
  'secTankIds:()=>secTankIds(),holdTankIds:()=>holdTankIds(),' +
  'satOfCirc:(ci)=>satOfCirc(ci),satWater:()=>SAT_WATER,holdSetP:(ci)=>holdSetP(ci),' +
  'TavgOf:(s,ci)=>TavgOf(s,ci),dTavgOf:(s,ci)=>dTavgOf(s,ci),tProg:(s,K,cs)=>tProg(s,K,cs),rodsOf:(id)=>rodsOf(id),rodRate:(K)=>rodRate(K),' +
  'netBookOf:(net)=>netBookOf(net),nodeGraph:()=>nodeGraph(),netHole:(ed)=>netHole(ed),' +
  'netInCore:(nm)=>netInCore(nm),netRefThru:()=>P.netRefThru,' +
  'tminmax:(key)=>{const K=(P.cores&&P.cores[key])||P; return [K.Tmin,K.Tmax];},' +
  'COND_P0:()=>COND_P0,CP_STEEL:()=>CP_STEEL,H2_RISE:()=>H2_RISE,DRYMIN:()=>DRY_MIN_KG,CDTQ:()=>CORE_DT_QMIN,TRT:()=>TAVG_RATE_TAU,' +
  'bookedKg:(i)=>bookedKg(P.net,S,i),advectSrc:(dt)=>Array.from(advectSrc(S,dt,P.runFlowH)),' +
  'tankFluidBoron:(tid)=>tankFluid(tid).boron,' +
  'runKeyOfNode:(nm)=>runKeyOfNode(nm),loopOfKey:(k)=>loopOfKey(k),' +
  'getIdx:()=>CTL_IDX,setIdx:(v)=>{CTL_IDX=v;},getIdk:()=>CTL_IDK,setIdk:(v)=>{CTL_IDK=v;},' +
  'coreFold:(id)=>coreFold(id),burstR:()=>burstR(),RHO_BETA:()=>RHO_BETA,' +
  'netLiveSig:()=>netLiveSig(P.net,S),STOREHELD:()=>netStoreHeld,' +
  'netPcont:(i)=>netPcont(P.net,S,i),tankStores:(id)=>tankStores(id),' +
  'tankLive:(id)=>tankLive(S,id),portLive:(id)=>portLive(S,id),' +
  'turbCOf:(id)=>turbCOf(S,id),sgtrLive:(id)=>sgtrLive(S,id),' +
  'sgtrC:()=>sgtrC(),sgWastOf:(id)=>sgWastOf(S,id),' +
  'cellBroken:(cx,cy)=>cellBroken(S,cx,cy),portWrecked:(id)=>portWrecked(S,id),' +
  'edgeCval:(e)=>edgeCval(P.net,P.net.edges[e],S),' +
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
  'holdLiveOf:(id)=>{const pc=netPieces(P.net,S); return holdLive(P.net,S,tankCircuit(id),pc)?1:0;},' +
  'stageFedOf:(id)=>stageFed(P.net,S,id)?1:0,' +
  'tankPof:(tid)=>{const t=D.tanks[tid]; return tankP(S,tid,t.hold?netPieces(P.net,S):undefined);},' +
  'exhOpenOf:()=>exhOpen(S)?1:0,roleTurbAliveOf:()=>roleAlive("turb",S),' +
  'contRelOf:(pid)=>contRelPart(S,partOf(pid)),' +
  'shellsLiveOf:(fid)=>shellsLive(S,fid),' +
  'netPiecesOf:()=>Array.from(netPieces(P.net,S).of),' +
  'corePiecesOf:()=>{const pc=netPieces(P.net,S); return [...corePieces(P.net,S,pc)];},' +
  'corePiecesOf:()=>{const pc=netPieces(P.net,S); return [...corePieces(P.net,S,pc)];},' +
  'inLoopOf:(ci,nm)=>inLoop(ci,nm)?1:0,' +
  'outsBag:(a,b,c,k)=>outsBag(P.netOut,a,b,c,k),' +
  'coreCi:(id)=>{const K=P.cores&&P.cores[id]; return K?K.circ:-1;},' +
  'netIndex:()=>Object.keys(P.net.index),booked:()=>Array.from(netBooked(P.net)),netN:()=>P.net.n,' +
  'MPC:()=>MPC,CP_W:()=>CP_W,' +
  'roleRow:(role)=>{const r=ROLE[role]; return r?{drown:!!r.drown,thermal:r.thermal||"none"}:null;},' +
  'roleInternal:(role)=>roleIns({role}).map(q=>[q.a,q.b]),' +
  'partFaceNode:(id)=>partFaceNode(id),circKey:(ci)=>circKey(ci),' +
  'circAuthored:(ci)=>circAuthored(ci),roomGeom:()=>roomGeom(),portCell:(pid)=>portCell(pid),' +
  'COOLANT:()=>COOLANT,matWall:(x,y)=>matWall(x,y),' +
  'HB:()=>HEATBAL,LOG:()=>LOG,bumpRoomPGen:()=>{roomPGen++;},' +
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
const u32an = a => { u32(a.length); u32a(a); };
const i32an = a => { u32(a.length); i32a(a); };
const str = s => { const b = Buffer.from(String(s), 'utf8'); u32(b.length); parts.push(b); };
const strs = a => { u32(a.length); strsRaw(a); };
const strsn = a => { u32(a.length); strsRaw(a); };
const strmap = o => { const k = Object.keys(o); u32(k.length); for (const x of k) { str(x); f64(num(o[x])); } };
const num = v => (v === undefined || v === null) ? NaN : (+v);
const padTo = (a, n) => { const o = a.slice(0, n); while (o.length < n) o.push(0); return o; };
const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v); parts.push(b); };
const strsRaw = a => { for (const s of a) str(s); };
const u8raw = a => parts.push(Buffer.from(Array.from(a).map(v => v & 0xFF)));

// ---- ctl tables (copied from ctl-gate.js) ----
const KNOB_KEYS = ['v', 'k', 'kp', 'ti', 'td', 'db', 'n', 'lo', 'hi', 'rate', 'tau', 'on', 'off'];
const MODE_OF = { source: 0, const: 1, math: 2, pid: 3, integ: 4, limit: 5, lag: 6, compare: 7, latch: 8, sel: 9, sink: 10 };
const MATH_OF = { add: 0, sub: 1, mul: 2, div: 3, min: 4, max: 5 };
const SEL_OF = { max: 0, min: 1, median: 2 };
const CMP_OF = { above: 0, below: 1 };
const SINK_OF = { rodStep: 0, freg: 1, relief: 2, flowDem: 3, loadDem: 4, boronDem: 5, valveDem: 6, tankOpen: 7, scram: 8, nearTrip: 9, runback: 10 };
const isNullKnob = v => (v === undefined || v === null);

// ---- actuator snapshot (copied from ctl-gate.js snapAct) ----
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

// ---- const assertion (copied from events-gate.js assertConsts) ----
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
    SG_EFW_OFF: M.SG_EFW_OFF(), SG_DRY: M.SG_DRY(), SGL_SET: M.SGL_SET(), SG_DOME: M.SG_DOME(),
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
    SG_EFW_OFF: 40, SG_DRY: 25, SGL_SET: 50, SG_DOME: 1.6,
    TURB_TRIP_P: 0.02, COND_DT0: 13, TPROG_SPAN: 18,
    T_HULL: 293, AIR_MMOL: 0.02896, H2_MMOL: 0.002016, H2O_MMOL: 0.018015,
    RAD_K: 7.1583,
  };
  for (const k of Object.keys(ref)) {
    if (want[k] !== ref[k]) { console.error('const ' + k + ' = ' + want[k] + ' want ' + ref[k]); process.exit(2); }
  }
  return want;
}

// ---- sec dumpMeta (copied from sec-gate.js dumpMeta; adapted
// reliefNodeOf/outKeysOf/stageInNbr call shapes to step-gate M bindings) ----
function dumpSecMeta(C) {
  const P = M.P(), D = M.D(), S = M.S(), net = P.net;
  const coreIds = M.coreIds();
  strsn(coreIds);
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
  const holdCircs = M.holdCircs();
  u32(holdCircs.length); i32a(holdCircs);
  u32(nCirc);
  for (let ci = 0; ci < nCirc; ci++) { const l = M.holdOnCirc(ci); u32(l.length); strsRaw(l); }
  const drumIds = M.drumIds(), boilerIds = M.boilerIds(), sgIds = M.sgIds();
  strsn(drumIds);
  strsn(boilerIds);
  strsn(sgIds);
  u32(sgIds.length); i32a(sgIds.map(id => M.loopOf(id) === null ? -1 : M.loopOf(id)));
  const pumpIds = M.pumpIds();
  strsn(pumpIds);
  u8a(pumpIds.map(id => M.primaryPump(id) ? 1 : 0));
  for (const id of pumpIds) {
    const r = M.pumpResOf(id); strsn(r);
    str(M.pumpSucNode(id) || ''); str(M.pumpEdgeKey(id) || '');
  }
  f64a(pumpIds.map(id => M.pumpRotor(id)));
  if (process.env.GATE_DEBUG) console.error('secmeta@pumps ' + parts.reduce((a, b) => a + b.length, 0));
  const partIds = M.LAY().parts.map(p => p.id);
  strsn(partIds);
  if (process.env.GATE_DEBUG) {
    const byId = M.LAY().byId;
    const bk = byId ? [...byId.keys()] : [];
    console.error('partids-n=' + partIds.length + ' byid-n=' + bk.length + ' cond-in-parts=' + partIds.includes('cond') + ' cond-in-byid=' + bk.includes('cond'));
  }
  f64(C.SG_EFW_OFF); f64(C.SG_DRY); f64(C.SGL_SET); f64(C.SG_DOME);
  strsRaw(boilerIds.map(id => M.boilerNode(id)));
  u32(boilerIds.length); i32a(boilerIds.map(id => M.boilerCirc(id)));
  strsRaw(boilerIds.map(id => M.feedNode(id)));
  u32(net.edges.length);
  i32a(net.edges.map(e => e.gasAt === undefined ? -1 : e.gasAt));
  i32a(net.edges.map(e => e.u));
  strsn(net.edges.map(e => e.kind || ''));
  strsn(net.edges.map(e => e.key || ''));
  const condIds = M.condIds(), condSinks = M.condSinks();
  if (process.env.GATE_DEBUG) console.error('meta-condids ' + JSON.stringify(condIds));
  if (process.env.GATE_DEBUG) {
    const ve = [];
    for (let e = 0; e < net.edges.length; e++) {
      const ed = net.edges[e];
      if (ed.kind === 'vent') ve.push('e' + e + ':key=' + ed.key);
    }
    console.error('meta-ventedges ' + ve.join(' '));
    console.error('meta-ventkeys ' + M.reliefFitIds().map(fid => fid + '=' + M.ventKeyOf(fid)).join(' '));
  }
  strsn(condSinks.map(id => M.breakKeyOf(id)));
  const tankIds = M.tankIds();
  strsn(tankIds.map(id => D.tanks[id].auto || 'manual'));
  strsn(condIds);
  strsn(condSinks);
  for (const id of condIds) str(M.condInA(id));
  u8a(condIds.map(id => M.condVacuum(id) ? 1 : 0));
  f64a(condIds.map(id => M.condVolOf(id)));
  for (const id of condIds) {
    const qs = M.cwPathsOf(id);
    u32(qs.length);
    for (const q of qs) { str(q.key); str(q.a); str(q.b); }
  }
  const radIds = M.radIds();
  strsn(radIds);
  f64a(radIds.map(id => M.radUAOf(id)));
  f64a(radIds.map(id => M.radMass(id)));
  f64a(radIds.map(id => M.partVol(id)));
  f64a(radIds.map(id => M.radCoatEmis(id)));
  f64a(radIds.map(id => M.radArea(id)));
  strsRaw(radIds.map(id => M.tickRadKey(id)));
  for (const id of radIds) { const [a, b] = M.radInternal(); str(a); str(b); }
  u8a(radIds.map(id => M.radLive(id) ? 1 : 0));
  const ihxIds = M.ihxIds();
  strsn(ihxIds);
  f64a(ihxIds.map(id => M.ihxUAOf(id)));
  u8a(boilerIds.map(id => M.isDrum(id) ? 1 : 0));
  u8a(ihxIds.map(id => M.sgActive(id) ? 1 : 0));
  f64(C.PROMPT_F);
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
  strsn([...M.holdLineSet()]);
  {
    const reg = M.matRegions();
    i32(M.LAY().parts.indexOf(M.roleOfCond()));
    f64(M.condPDes());
    u32(reg.of.length); i32a(Array.from(reg.of));
    u32(reg.n);
    f64(P.Pcont); u32(M.GW()); u32(M.GH());
    strsRaw(condIds.map(id => M.condVesNode(id) || ''));
  }
  strsn(tankIds);
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
  u8a(tankIds.map(() => 0));
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
  strsn(reliefIds);
  u32an(M.reliefPriIds().map(id => reliefIds.indexOf(id)));
  strsn(M.reliefSecIds());
  strsRaw(reliefIds.map(id => M.reliefNodeOf(id) === undefined ? '' : M.reliefNodeOf(id)));
  for (const fid of reliefIds) {
    const [lift, reseat] = M.reliefSet(fid);
    f64(lift); f64(reseat);
    u8(M.fitSpring(fid) ? 1 : 0); u8(M.hasTarget(fid) ? 1 : 0);
  }
  for (const fid of reliefIds) str(M.ventKeyOf(fid) || '');
  strsn(M.outKeysOf());
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
  strsn(fm.byKeys);
  strsn(fm.sgtrKeys);
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
  strsn(net.name);
  {
    u32(net.name.length);
    for (let i = 0; i < net.name.length; i++) { str(net.name[i]); u32(i); }
  }
  u8a(Array.from(net.vapour || new Uint8Array(net.n)));
  raw8a(Array.from(M.netBooked()));
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
  for (let ci = 0; ci < nCirc; ci++) str(M.circBurn(ci) || '');
  f64(M.steamRise()); f64(M.roomSteamH()); f64(M.loopKg()); f64(M.coreDT0());
  f64(P.P0); f64(P.Tref); f64(P.rated); f64(P.flowK); f64(P.flowMin); f64(P.sat.cp);
  if (process.env.GATE_DEBUG) console.error('secmeta@end ' + parts.reduce((a, b) => a + b.length, 0));
  return { coreIds, pumpIds, boilerIds, sgIds, drumIds, partIds, nCirc, condIds, condSinks, tankIds, radIds, ihxIds, reliefIds };
}

// ---- sec curves (copied from sec-gate.js dumpCurves) ----
const SAT_KEYS = ['A', 'B', 'C', 'tc', 'rhoc', 'p0', 'T0', 'n', 'pFloor', 'TFloor',
  'hfg', 'rho', 'cp', 'mu', 'muV', 'solidK', 'Tref'];
function dumpSecCurves(meta) {
  const n = meta.nCirc;
  u32(n);
  for (let ci = 0; ci < n; ci++) f64a(SAT_KEYS.map(k => num(M.satOfCirc(ci)[k])));
  f64a(SAT_KEYS.map(k => num(M.satWater()[k])));
  f64a([...Array(n).keys()].map(ci => M.holdSetP(ci)));
}

// ---- room dumpMeta (copied verbatim from room-gate.js dumpMeta) ----
function dumpRoomMeta(C) {
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
  if (process.env.GATE_DEBUG) console.error('roommeta@parts ' + parts.reduce((a, b) => a + b.length, 0));
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
  strsn(coreIds);
  u32(coreIds.length);
  for (const id of coreIds) { str(id); u32(P.cores[id].NB); }
  f64(D.bkp || 0);
  strsn(M.reliefFitIds());
  strsn(M.reliefSecIds());
  strsn(M.boilerIds());
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
  const circVals = net.name.map(nm => M.circOfNode(nm));
  const nCirc = Math.max(0, ...circVals, M.coreCirc()) + 1;
  {
    u32(nCirc);
    for (let ci = 0; ci < nCirc; ci++) str(M.circBurn(ci) || '');
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
    strsn(Object.keys(t).filter(k => t[k]));
    const o = (P.net && P.net.fitVentOut) || {};
    strsn(Object.keys(o).filter(k => o[k]));
  }
  strsn(net.name);
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
  {
    const G = M.roomGeom();
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
      for (const k of sks) { str(k); strsn(G.shellValves[k]); }
    }
    f64a(Array.from(G.bx)); f64a(Array.from(G.by)); f64a(Array.from(G.gx));
    f64a(Array.from(G.gUp)); f64a(Array.from(G.gDn));
  }
  return { coreIds, n, layParts, nCirc };
}

// ---- room curves (copied from room-gate.js dumpCurves) ----
function dumpRoomCurves(meta) {
  const n = meta.nCirc;
  if (process.env.GATE_DEBUG) console.error('roomcurves n=' + n);
  u32(n);
  for (let ci = 0; ci < n; ci++) f64a(SAT_KEYS.map(k => num(M.satOfCirc(ci)[k])));
  f64a(SAT_KEYS.map(k => num(M.satWater()[k])));
  f64a([...Array(n).keys()].map(ci => M.holdSetP(ci)));
}

// ---- room key registries ----
const ROOM_F64KEYS = ['roomMax', 'roomPMax', 'roomBurnOn', 'roomFireOn', 'Tavg', 'h2',
  'load', 'loadDem', 'burnKg', 'burnP', 'burnBlast', 'fireKg', 'fireP', 'fireQ'];
const ROOM_U8KEYS = ['blackout', 'bkpLost', 'sgtr'];
const ROOM_I32KEYS = ['roomMaxAt'];
const ROOM_MAPKEYS = ['partT', 'skinQ', 'runT', 'panBy', 'TavgBy', 'reliefSteam', 'sgVentBy', 'sgH2By',
  'sgTBy', 'condTBy', 'radTBy'];
const ROOM_BAGKEYS = ['mBy', 'hBy', 'pBy'];
const ROOM_F64GRIDS = ['roomT', 'roomPool', 'roomPoolE', 'roomWater', 'roomWaterE'];
const ROOM_F32GRIDS = ['roomM', 'roomH2', 'roomO2', 'roomVap', 'roomFlame', 'roomP', 'roomPPk',
  'roomScar', 'roomScarCur', 'roomPU', 'roomPV', 'roomPoolU', 'roomPoolV',
  'roomWU', 'roomWV', 'roomWP', 'roomPoolP'];

// ---- events dumpMeta (copied verbatim from events-gate.js dumpMeta) ----
function dumpEventsMeta(C) {
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
  strsn(coreIds);
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
  strsn(sgIds); strsn(boilerIds); strsn(pumpIds); strsn(tankIds); strsn(reliefFitIds); strsn(radIds);
  strsn(pumpIds.filter(id => M.primaryPump(id)));
  u32(radIds.length); for (const id of radIds) { str(id); u8(M.radLive(id) ? 1 : 0); }
  str(M.primaryRelief() || '');
  u32(tankIds.length);
  for (const id of tankIds) {
    const t = (D.tanks || {})[id] || {};
    str(id);
    u8(t.inf ? 1 : 0); u8(t.hold ? 1 : 0); u8(t.cell ? 1 : 0);
    f64(num(t.level)); f64(num(M.tankAct(id))); f64(num(M.tankKg(id)));
    u8(M.tankInField(id) ? 1 : 0);
  }
  const netKeys = M.netIndex();
  strsn(netKeys);
  strsn(netKeys.filter(nn => M.inCore(nn)));
  const nb = M.netN();
  u32(nb); raw8a(Array.from(M.booked()));
  const runKeys = M.runKeys();
  strsn(runKeys);
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
    u8(1); u8(b.vent ? 1 : 0); strsn(b.taps); f64(b.dir); strsn(b.gens); u8(b.ends ? 1 : 0);
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

// ---- events key registries (copied from events-gate.js) ----
const EV_F64STATE = ['n', 'decay', 'heat', 'dmg', 'meltFrac', 'Tf', 'dnbr', 'vf', 'oxMax', 'qOx',
  'fatigue', 'rho', 'rodPos', 'P', 'Tavg', 'lvl', 'sc', 'cav', 'h2',
  'injRate', 'release', 'load', 'loadDem', 'flowNet', 'crewDose', 'dose', 'doseRate',
  'repRate', 'massRes', 'massWarn', 'roomPMax', 'roomBurnOn', 'roomFireOn',
  'roomBang', 'roomMax', 'spinV', 'spinTV'];
const EV_U8KEYS = ['scrammed', 'breach', 'melt', 'rodJam', 'rodBand', 'blackout', 'turbTrip', 'condLost',
  'partySpent', 'bkpLost', 'sgtr'];
const EV_I32KEYS = ['tick', 'massWarnT', 'annRev'];
const EV_F64MAPS = ['tank', 'massOut', 'roomCrush', 'roomHurt', 'flowPos', 'reliefSteam',
  'flowDemBy', 'lvlBy', 'scBy', 'tavgBy'];
const EV_BOOLMAPS = ['reliefOpen', 'reliefBlocked', 'reliefStuck', 'reliefAuto', 'sgBurst'];
const EV_VESSEL_F64 = ['n', 'decay', 'dmg', 'meltFrac', 'Tf', 'dnbr', 'vf', 'oxMax', 'qOx',
  'fatigue', 'rho', 'tilt', 'tiltDem', 'rodDem'];
const EV_VESSEL_U8 = ['scrammed', 'breach', 'melt', 'rodJam', 'rodBand'];
// ---- sec key registries (copied from sec-gate.js; wire order is canonical,
// defined by step-probe read_sec_state, NOT sec-gate dumpState order) ----
const SEC_F64KEYS = ['P', 'Tavg', 'boron', 'boronDem', 'condT', 'condVent', 'cwInT', 'dLvl',
  'dTavg', 'decay', 'flowNet', 'h2', 'heat', 'injRate', 'inv', 'load', 'loadDem', 'lvl',
  'n', 'nat', 'pCore', 'release', 'sc', 'sgBurstGen', 'sgtrRate', 'spillRate', 'turbP', 'turbWk', 'cav', 'vf'];
const SEC_U8KEYS = ['bkpLost', 'blackout', 'breach', 'condLost', 'condVentSeen', 'rbHot', 'refOpen', 'turbTrip'];
const SEC_MAPKEYS = ['PBy', 'TavgBy', 'cavP', 'condPBy', 'condTBy', 'cwInTBy', 'dLvlBy', 'flowBy',
  'flowDemBy', 'fregBy', 'fregDemBy', 'holdPBy', 'ihxQBy', 'invBy', 'lvlBy', 'pumpQBy', 'radQBy',
  'radTBy', 'reliefSteam', 'reliefVent', 'scBy', 'sgFedBy', 'sgH2By', 'sgPBy', 'sgPwQBy', 'sgShare',
  'sgSwQBy', 'sgTBy', 'sgVentBy', 'sgWastBy', 'sgtrBy', 'skinQ', 'spillBy', 'steamBy', 'tank',
  'tankOpen', 'tankOver', 'tankRate', 'valve', 'valveDem', 'cwFlowBy'];
const SEC_BMAPKEYS = ['burstBy', 'sgBurst', 'tankAuto'];
const SEC_BAGKEYS = ['mBy', 'hBy', 'pBy', 'bBy', 'h2By'];
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
// bags with absent-holder → n-length zeros (transport convention).
// extra grid bags [name, array] ride inside the same count (e.g. roomP).
function dumpBags(names, S, n, extra) {
  extra = extra || [];
  u32(names.length + extra.length);
  for (const k of names) {
    const h = S[k];
    str(k);
    if (!h || !h.v) {
      u32(n); f64a(new Array(n).fill(0)); u32(n); u8a(new Array(n).fill(0));
    } else {
      const v = Array.from(h.v);
      u32(v.length); f64a(v); u32(v.length); u8a(padTo(Array.from(h.has || []), v.length));
    }
  }
  for (const [k, arr] of extra) {
    const v = arr ? Array.from(arr) : new Array(n).fill(0);
    str(k);
    u32(v.length); f64a(v); u32(v.length); u8a(new Array(v.length).fill(1));
  }
}

// ---- transport dumpMeta (values from transport-gate.js P.meta; wire order
// matches step-probe read_trans_meta) ----
function dumpTransMeta() {
  const P = M.P(), net0 = P.net, n0 = net0.n, ne0 = net0.edges.length;
  const num0 = v => (v === undefined || v === null) ? NaN : v;
  const opt3 = v => (v === undefined || v === null) ? -1 : v;
  const cp = a => Array.from(a);
  u32(n0); u32(ne0);
  u32a(net0.edges.map(e => e.u)); u32a(net0.edges.map(e => e.v));
  f64a(cp(net0.vol)); f64a(cp(net0.z));
  raw8a(cp(M.netBooked()));
  if (process.env.GATE_DEBUG) console.error('booked62 ' + Array.from(M.netBooked()).slice(60, 72).join(','));
  const bookOf = M.netBookOf(net0), bids = new Map([['', 0]]);
  u32a(net0.name.map((nm, i) => {
    const b = bookOf[i]; if (b === undefined) return 0;
    if (!bids.has(b)) bids.set(b, bids.size); return bids.get(b);
  }));
  u8a(net0.name.map((nm, i) => (net0.tankIdByNode && net0.tankIdByNode[i] !== undefined) ? 1 : 0));
  i32a(net0.edges.map(e => opt3(e.gasAt))); i32a(net0.edges.map(e => opt3(e.liqAt)));
  u8a(net0.edges.map(e => e.kind === 'break' ? 1 : 0));
  u8a(net0.edges.map(e => (e.kind === 'break' || e.kind === 'vent') ? 1 : 0));
  u8a(net0.edges.map(e => e.steam ? 1 : 0)); u8a(net0.edges.map(e => e.sec ? 1 : 0));
  i32a(net0.edges.map(ed => { const j = net0.outPos.get(ed.key); return j === undefined ? -1 : j; }));
  M.outKeysOf(net0);
  u32(net0.outKeys.length);
  u8a(net0.name.map(nm => M.netInCore(nm) ? 1 : 0));
  i32a(net0.name.map(nm => { const v = M.circOfNode(nm); return v === undefined ? -999 : v; }));
  f64a(net0.name.map(nm => num0((M.netRefThru() || {})[nm])));
  u8a(new Array(n0).fill(0));
  f64a(net0.metalKg ? cp(net0.metalKg) : new Array(n0).fill(NaN));
  f64a(net0.metalTau ? cp(net0.metalTau) : new Array(n0).fill(NaN));
  f64a(net0.metalUA ? cp(net0.metalUA) : new Array(n0).fill(NaN));
  const cmap = new Map(), curves = [];
  const curveOf = net0.satBy.map(c => {
    const key = SAT_KEYS.map(k2 => String(num0(c[k2]))).join(',');
    if (!cmap.has(key)) { cmap.set(key, curves.length); curves.push(SAT_KEYS.map(k2 => num0(c[k2]))); }
    return cmap.get(key);
  });
  u32(curves.length);
  for (const cv of curves) f64a(cv);
  if (process.env.GATE_DEBUG) console.error('trans@curves ' + parts.reduce((a, b) => a + b.length, 0));
  u32a(curveOf);
  const feedIdx = M.boilerIds().map(id => { const i = net0.index[M.feedNode(id)]; return i === undefined ? 0xFFFFFFFF : i; });
  u32(feedIdx.length); u32a(feedIdx);
  const coreIdx = M.coreIds().map(id => { const i = net0.index[M.coreFold(id)]; return i === undefined ? 0xFFFFFFFF : i; });
  u32(coreIdx.length); u32a(coreIdx);
  if (process.env.GATE_DEBUG) console.error('trans@coreidx ' + parts.reduce((a, b) => a + b.length, 0));
  const G = M.nodeGraph();
  const circs = M.holdCircs().filter(ci => G.coreCircs[ci] === 1);
  const tavgCircs = circs;
  const coreNids = circs.map(ci => new Set(M.coreOnCirc(ci).map(id => M.coreFold(id))));
  u32(circs.length);
  for (const ci of circs) {
    const key = M.circKey(ci), K = (M.P().cores && M.P().cores[key]) || M.P();
    const ck = SAT_KEYS.map(k2 => String(num0(M.satOfCirc(ci)[k2]))).join(',');
    if (!cmap.has(ck)) { cmap.set(ck, curves.length); curves.push(SAT_KEYS.map(k2 => num0(M.satOfCirc(ci)[k2]))); }
    i32(ci); u32(cmap.get(ck));
    const [tmin, tmax] = M.tminmax(key);
    f64(num0(tmin)); f64(num0(tmax));
  }
  i32(net0.coreNode === undefined ? -1 : net0.coreNode);
  u8(M.S().bBy ? 1 : 0);
  i32(G.coreCirc === undefined || G.coreCirc === null ? -1 : G.coreCirc);
  f64a([M.COND_P0(), M.CP_STEEL(), M.H2_RISE(), M.DRYMIN(), M.CDTQ(), M.TRT()]);
  const riseE = net0.edges.filter(ed => !M.netHole(ed) && net0.z[ed.u] !== net0.z[ed.v]);
  const riseIdx = riseE.map(ed => net0.edges.indexOf(ed));
  u32(riseE.length); u32a(riseE.map(ed => ed.u)); u32a(riseE.map(ed => ed.v));
  return { n: n0, ne: ne0, tavgCircs, coreNids, riseE: riseIdx };
}

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
  if (process.env.GATE_DEBUG) console.error('tick ' + tag + ' log0=' + log0 + ' loglen=' + M.LOG().length);
  M.netMarching(true);
  // ---- ctlPass ----
  const actPre = snapAct(S);
  ensureBlk(S);
  const pre = { out: Array.from(S.blkOutV || []), f: Array.from(S.blkOutF || []) };
  M.ctlPass(S, DT);
  if (process.env.GATE_DEBUG && tag === 0) console.error('post-ctl fregDem=' + JSON.stringify(S.fregDemBy) + ' freg=' + JSON.stringify(S.fregBy));
  dumpCtlSample(S, P, DT, pre, actPre);
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
  for (let e = 0; e < ne; e++) {
    const ed = net.edges[e];
    const hasW = net.wHas[ed.wi] ? 1 : 0;
    const q = new Array(45).fill(NaN);
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
  const fsolve = {};
  {
    const F = net.F;
    const fsnap = {};
    for (const f of ['p', 'rho', 'x', 'b', 'rhoD', 'rhoG', 'rhoL', 'wet', 'void', 'mu', 'lp', 'lh', 'lm']) fsnap[f] = Array.from(F[f]);
    const gsn = F.gen, stn = net.store;
    M.netFieldUpdate(S);
    sigSolve = M.netLiveSig();
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
      try { fs.appendFileSync(process.env.GATE_DBGFILE, 'pcdec t=' + tag + ' reuse=' + reuse + ' sigPre=' + (pcPre && pcPre.sig) + ' sigSolve=' + sigSolve + '\n'); } catch (e) { }
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
  const bleedAll = M.shellStep(S, DT, netOut, secVentRes.secVent || secVentRes);
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
  const ledgM0 = M.ledgerKg(), ledgO0 = M.ledgerOut();
  M.ledgerStep(S, DT, ledgM0, ledgO0);
  M.netMarching(false);
  return { pumpK, heat, runFlow, pField, netOut, coreFN, cavIds, injIds: injRes.injIds, secVentRes, bleedAll, tubeMap, coreTails, h2PostVessel, log0, cg0, tripNearMid, annSecP, annBoilerLvl, fsolve };
}

// ---- core tail writer (probe read_core_tail order) ----
function dumpCoreTail(S, P, id, t) {
  f64(t.hIn); u8(t.sink ? 1 : 0);
  f64(t.sat); f64(t.vLeak); f64(t.relPart);
  f64(t.h2m2); u8(t.h2m2none ? 1 : 0); f64(t.h2pre); u8(t.h2preHas ? 1 : 0);
  f64(t.loopKg); f64(t.coreDTMax); f64(t.tiltRate);
  f64(t.dose); u8(t.catcher ? 1 : 0);
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
  dumpSecState(S, P, HB2, meta.sec);
  dumpRoomState(S, meta.room);
  u32(M.roomCgIt()); u32(M.liqCgIt()); u32(M.roomPGen());
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'pre-ev P=' + S.P + ' tkeys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
  dumpEventsState(S, meta.events);
  // evLatch-time ann inputs (sec-tail values are pre-transport stale).
  strmap(R.annSecP || {}); strmap(R.annBoilerLvl || {});
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'post-ev P=' + S.P + ' tkeys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
  u32(meta.coreIds.length);
  for (const id of meta.coreIds) { str(id); dumpCoreState(S, id); }
  dumpCanonBags(S, n);
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

function dumpCanonBags(S, n) {
  for (const k of CANON_BAGS) {
    const h = S[k];
    if (!h || !h.v) {
      u32(n); f64a(new Array(n).fill(0)); u32(n); u8a(new Array(n).fill(0));
    } else {
      const v = Array.from(h.v);
      u32(v.length); f64a(v); u32(v.length); u8a(padTo(Array.from(h.has || []), v.length));
    }
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
function dumpCtlSample(S, P, dt, pre, actPre) {
  const blkBy = S.blkBy || {};
  const ids = Object.keys(blkBy);
  const n = ids.length;
  ensureBlk(S);
  const idxOf = new Map(ids.map((id, i) => [id, i]));
  const live = M.ctlLive(S);
  f64(dt); u8(live ? 1 : 0);
  u32(n);
  for (const id of ids) str(id);
  raw8a(ids.map(id => { const m = blkBy[id].mode; return MODE_OF[m] === undefined ? 255 : MODE_OF[m]; }));
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
  f64a(ids.map((id, i) => (blkBy[id].mode === 'source') ? num(S.blkOutV[i]) : NaN));
  raw8a(ids.map(id => { const b = blkBy[id]; return b.mode === 'sink' ? (SINK_OF[b.sink] === undefined ? 255 : SINK_OF[b.sink]) : 255; }));
  for (const id of ids) {
    const b = blkBy[id];
    if (b.mode !== 'sink') { i32(-1); continue; }
    const pick = l => { const i = l.indexOf(b.arg); return i < 0 ? -1 : i; };
    let a = -1;
    switch (b.sink) {
      case 'rodStep': case 'scram': case 'nearTrip': a = pick(actPre.cores.map(c => c.id)); break;
      case 'freg': a = pick(actPre.freg.k); break;
      case 'flowDem': a = pick(actPre.flow.k); break;
      case 'valveDem': a = pick(actPre.valve.k); break;
      case 'tankOpen': a = pick(actPre.tank.k); break;
      case 'relief': a = pick(actPre.relief.k); break;
      default: a = -1;
    }
    i32(a);
  }
  u8a(ids.map(id => {
    const b = blkBy[id];
    return (b.mode === 'sink') ? (M.blkDead(S, b) ? 1 : 0) : 0;
  }));
  for (const id of ids) {
    const b = blkBy[id];
    if (b.mode === 'sink' && b.sink === 'scram') {
      const drv = M.sinkDriver(S, 'scram', b.arg);
      str(drv ? M.blkBlame(S, drv) : '');
    } else str('');
  }
  const ord = M.ctlOrder(S).map(id => idxOf.get(id));
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
  // want out/f (post-ctl blkOutV/F)
  f64a(Array.from(S.blkOutV));
  f64a(Array.from(S.blkOutF));
  // per-tick key lists (fan-out order = actPre orders)
  strsn(actPre.freg.k); strsn(actPre.flow.k); strsn(actPre.valve.k);
  strsn(actPre.tank.k); strsn(actPre.relief.k);
  strsn(actPre.cores.map(c => c.id));
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

// ---- canonical state writer (wire order matches step-probe readers exactly:
// read_sec_state, read_room_state, read_events_state, read_core_state) ----
function dumpSecState(S, P, HB, meta) {
  const n = M.GW() * M.GH();
  u32(SEC_F64KEYS.length);
  for (const k of SEC_F64KEYS) { str(k); f64(fnum(S[k])); }
  u32(SEC_U8KEYS.length);
  for (const k of SEC_U8KEYS) { str(k); u8(S[k] ? 1 : 0); }
  u32(0); // strings (trip synced driver-side; S0 empty)
  u32(SEC_MAPKEYS.length);
  for (const k of SEC_MAPKEYS) {
    const o = S[k] || {};
    const ks = Object.keys(o).filter(x => o[x] !== undefined);
    str(k); u32(ks.length); strsRaw(ks); f64a(ks.map(x => fnum(o[x])));
  }
  u32(SEC_BMAPKEYS.length);
  for (const k of SEC_BMAPKEYS) {
    const o = S[k] || {};
    const ks = Object.keys(o).filter(x => o[x] !== undefined);
    str(k); u32(ks.length); strsRaw(ks); u8a(ks.map(x => (o[x] ? 1 : 0)));
  }
  dumpBags(SEC_BAGKEYS.concat(['metalT']), S, P.net.n, [['roomP', S.roomP]]);
  u32(meta.reliefIds.length);
  for (const fid of meta.reliefIds) {
    str(fid);
    u8a([(S.reliefOpen && S.reliefOpen[fid] ? 1 : 0), (S.reliefAuto && S.reliefAuto[fid] ? 1 : 0),
      (S.reliefStuck && S.reliefStuck[fid] ? 1 : 0), (S.reliefArm && S.reliefArm[fid] ? 1 : 0),
      (S.reliefBlocked && S.reliefBlocked[fid] ? 1 : 0)]);
  }
  u32(meta.coreIds.length);
  for (const id of meta.coreIds) {
    const cs = S.coreBy && S.coreBy[id];
    str(id); f64(cs ? fnum(cs.pCore) : NaN); f64(cs ? fnum(cs.flowNet) : NaN);
  }
  u32((S.dmgParts || []).length); strsRaw(S.dmgParts || []);
  {
    const ks = Object.keys(S.dmgWhy || {});
    u32(ks.length);
    for (const k of ks) { str(k); str(S.dmgWhy[k]); }
  }
  {
    const mo = S.massOut || {};
    const mks = Object.keys(mo);
    u32(mks.length); strsRaw(mks); f64a(mks.map(k => fnum(mo[k])));
  }
  u32(Object.keys(S.massOut || {}).length); strsRaw(Object.keys(S.massOut || {}));
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
    f64an(S[k] ? Array.from(S[k]) : new Array(n).fill(0));
  }
}

function dumpRoomState(S, meta) {
  u32(ROOM_F64KEYS.length);
  for (const k of ROOM_F64KEYS) {
    str(k);
    let v = S[k];
    if (v === undefined && S.burnEv && k.startsWith('burn')) v = k === 'burnBlast' ? S.burnEv.blast : S.burnEv[k.slice(4).toLowerCase()];
    if (v === undefined && S.fireEv && k.startsWith('fire')) v = S.fireEv[k.slice(4).toLowerCase()];
    f64(fnum(v));
  }
  u32(ROOM_U8KEYS.length);
  for (const k of ROOM_U8KEYS) { str(k); u8(S[k] ? 1 : 0); }
  u32(ROOM_I32KEYS.length);
  for (const k of ROOM_I32KEYS) { str(k); i32(S[k] | 0); }
  u32(ROOM_MAPKEYS.length);
  for (const k of ROOM_MAPKEYS) {
    const o = S[k] || {};
    const ks = Object.keys(o).filter(x => o[x] !== undefined);
    str(k); u32(ks.length); strsRaw(ks); f64a(ks.map(x => fnum(o[x])));
  }
  dumpBags(ROOM_BAGKEYS, S, M.P().net.n);
  u32(meta.coreIds.length);
  for (const id of meta.coreIds) {
    const cs = S.coreBy && S.coreBy[id];
    str(id);
    u8(cs && cs.breach ? 1 : 0);
    const trip = (cs && cs.trip) || '';
    u8(trip ? 1 : 0); if (trip) str(trip);
    f64(fnum(cs && cs.fatigue));
    u8(cs && cs.rodJam ? 1 : 0);
    f64(fnum(cs && cs.rodDem)); f64(fnum(cs && cs.tiltDem));
    f64an(cs && cs.rodZDem ? Array.from(cs.rodZDem) : []);
    f64(fnum(cs && cs.rodPos)); f64(fnum(cs && cs.tilt));
    f64an(cs && cs.rodZ ? Array.from(cs.rodZ) : []);
  }
  u32((S.dmgParts || []).length); strsRaw(S.dmgParts || []);
  {
    const ks = Object.keys(S.dmgWhy || {});
    u32(ks.length);
    for (const k of ks) { str(k); str(S.dmgWhy[k]); }
  }
  {
    const mo = S.massOut || {};
    const mks = Object.keys(mo);
    u32(mks.length); strsRaw(mks); f64a(mks.map(k => fnum(mo[k])));
  }
  u32(Object.keys(S.massOut || {}).length); strsRaw(Object.keys(S.massOut || {}));
  f64(fnum(S.burnEv && S.burnEv.kg)); f64(fnum(S.burnEv && S.burnEv.p)); f64(fnum(S.burnEv && S.burnEv.blast));
  strsn((S.burnEv && S.burnEv.ids) || []);
  f64(fnum(S.fireEv && S.fireEv.kg)); f64(fnum(S.fireEv && S.fireEv.p)); f64(fnum(S.fireEv && S.fireEv.q));
  u32(ROOM_F64GRIDS.length);
  for (const k of ROOM_F64GRIDS) { str(k); f64an(S[k] ? Array.from(S[k], Number) : []); }
  u32(ROOM_F32GRIDS.length);
  for (const k of ROOM_F32GRIDS) { str(k); f64an(S[k] ? Array.from(S[k], Number) : []); }
}

// ---- events state writer (wire order matches step-probe read_events_state;
// S-access from events-gate.js dumpState) ----
function dumpEventsState(S, meta) {
  const n = meta.n;
  i32(S.tick | 0);
  for (const k of ['n', 'decay', 'heat', 'dmg', 'meltFrac', 'Tf', 'dnbr', 'vf', 'oxMax', 'qOx',
    'fatigue']) f64(fnum(S[k]));
  u8(S.scrammed ? 1 : 0); u8(S.breach ? 1 : 0); u8(S.melt ? 1 : 0);
  str(S.trip || '');
  f64(fnum(S.rodPos));
  u8(S.rodJam ? 1 : 0); u8(S.rodBand ? 1 : 0);
  f64(fnum(S.rho)); f64(fnum(S.parts && S.parts.xe));
  for (const k of ['P', 'Tavg', 'lvl', 'sc', 'cav', 'h2', 'injRate', 'release']) f64(fnum(S[k]));
  u8(S.blackout ? 1 : 0);
  f64(fnum(S.load)); f64(fnum(S.loadDem));
  u8(S.bkpLost ? 1 : 0); u8(S.sgtr ? 1 : 0);
  f64(fnum(S.flowNet));
  u8(S.turbTrip ? 1 : 0); u8(S.condLost ? 1 : 0);
  for (const k of ['crewDose', 'dose', 'doseRate', 'repRate']) f64(fnum(S[k]));
  u8(S.partySpent ? 1 : 0);
  f64(fnum(S.massRes)); f64(fnum(S.massWarn));
  i32(S.massWarnT | 0);
  for (const k of ['roomPMax', 'roomBurnOn', 'roomFireOn', 'roomBang', 'roomMax', 'spinV', 'spinTV']) f64(fnum(S[k]));
  u32(S.annRev >>> 0);
  u8(S.burnEv && S.burnEv.blast ? 1 : 0);
  f64(fnum(S.burnEv && S.burnEv.kg)); f64(fnum(S.burnEv && S.burnEv.p));
  f64(fnum(S.fireEv && S.fireEv.kg)); f64(fnum(S.fireEv && S.fireEv.p)); f64(fnum(S.fireEv && S.fireEv.q));
  u8(S.repair ? 1 : 0);
  f64(fnum(S.repair && S.repair.t)); f64(fnum(S.repair && S.repair.need));
  str((S.repair && S.repair.id) || '');
  f64an(S.dec ? Array.from(S.dec, Number) : []);
  strsn((S.burnEv && S.burnEv.ids) || []);
  for (const k of ['roomP', 'roomT', 'roomH2', 'roomM', 'roomVap']) {
    f64an(S[k] ? Array.from(S[k], Number) : new Array(n).fill(0));
  }
  u32(meta.coreIds.length);
  for (const id of meta.coreIds) {
    const cs = S.coreBy && S.coreBy[id];
    if (!cs) { console.error('vessel missing for ' + id); process.exit(2); }
    str(id);
    for (const k of ['n', 'decay', 'dmg', 'meltFrac']) f64(fnum(cs[k]));
    f64an(cs.dec ? Array.from(cs.dec, Number) : []);
    for (const k of ['Tf', 'dnbr', 'vf', 'oxMax', 'qOx', 'fatigue']) f64(fnum(cs[k]));
    u8(cs.scrammed ? 1 : 0); u8(cs.breach ? 1 : 0); u8(cs.melt ? 1 : 0);
    str(cs.trip || '');
    f64(fnum(cs.rodPos));
    u8(cs.rodJam ? 1 : 0); u8(cs.rodBand ? 1 : 0);
    f64(fnum(cs.rho)); f64(cs.parts ? fnum(cs.parts.xe) : NaN); f64(fnum(cs.tilt));
    f64an(cs.rodZ ? Array.from(cs.rodZ, Number) : []);
    f64an(cs.rodZDem ? Array.from(cs.rodZDem, Number) : []);
    f64(fnum(cs.tiltDem)); f64(fnum(cs.rodDem));
    f64(fnum(cs.rpsHot)); u8(cs.rpsNear ? 1 : 0);
  }
  smap(S.tank);
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'mid-ev1 tkeys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
  {
    const h = S.mBy;
    if (!h || !h.v) { u32(0); u32(0); }
    else {
      u8an(padTo(Array.from(h.has || []), h.v.length));
      f64an(Array.from(h.v, Number));
    }
  }
  smap(S.massOut || {});
  u32(Object.keys(S.massOut || {}).length); strsRaw(Object.keys(S.massOut || {}));
  strsn(S.dmgParts || []);
  {
    const ks = Object.keys(S.dmgWhy || {});
    u32(ks.length);
    for (const k of ks) { str(k); str(S.dmgWhy[k]); }
  }
  smap(S.roomCrush); smap(S.roomHurt); smap(S.flowPos);
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'mid-ev2 tkeys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
  {
    const ev = S.ev || {};
    u32(Object.keys(ev).length);
    for (const k of Object.keys(ev)) { str(k); u8(ev[k] ? 1 : 0); }
  }
  {
    const ao = S.annOn || {};
    u32(Object.keys(ao).length);
    for (const k of Object.keys(ao)) { str(k); u8(ao[k] ? 1 : 0); }
  }
  const boolmap = o => {
    const ks = Object.keys(o || {});
    u32(ks.length);
    for (const k of ks) { str(k); u8(o[k] ? 1 : 0); }
  };
  boolmap(S.reliefOpen); boolmap(S.reliefBlocked); boolmap(S.reliefStuck); boolmap(S.reliefAuto);
  smap(S.reliefSteam);
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'mid-ev3 tkeys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
  boolmap(S.sgBurst);
  strsn(Object.keys(S.portShut || {}).filter(k => S.portShut[k]).sort());
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'alias fd=' + (S.flowDemBy === S.tavgBy) + ' lv=' + (S.lvlBy === S.tavgBy) + ' sc=' + (S.scBy === S.tavgBy) + '\n'); } catch (e) { }
  }
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'mid-ev4 tkeys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
  smap(S.flowDemBy);
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'after-fd tkeys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
  smap(S.lvlBy);
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'after-lv tkeys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
  smap(S.scBy);
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'after-sc tkeys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
  const _preLen = parts.reduce((a, b) => a + b.length, 0);
  if (process.env.GATE_DBGFILE) {
    try { global.__tavgRef = S.TavgBy; fs.appendFileSync(process.env.GATE_DBGFILE, 'pre-smap ident=' + (S.TavgBy === global.__tavgRef) + ' keys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
  smap(S.TavgBy);
  if (process.env.GATE_DBGFILE) {
    try { fs.appendFileSync(process.env.GATE_DBGFILE, 'post-smap ident=' + (S.TavgBy === global.__tavgRef) + ' keys=' + JSON.stringify(Object.keys(S.TavgBy || {})) + '\n'); } catch (e) { }
  }
  if (process.env.GATE_DBGFILE) {
    try {
      const _k1 = JSON.stringify(Object.keys(S.TavgBy || {}));
      const _p = S.P;
      const _k2 = JSON.stringify(Object.keys(S.TavgBy || {}));
      const _t = S.tick;
      const _k3 = JSON.stringify(Object.keys(S.TavgBy || {}));
      fs.appendFileSync(process.env.GATE_DBGFILE, 'ev4 P=' + _p + ' tick=' + _t + ' k1=' + _k1 + ' k2=' + _k2 + ' k3=' + _k3 + '\n');
    } catch (e) { }
  }
  if (process.env.GATE_DEBUG) {
    const _o = S.TavgBy || {};
    try { fs.appendFileSync(process.env.GATE_DBGFILE || 'NUL', 'tavgby P=' + S.P + ' tick=' + S.tick + ' keys=' + JSON.stringify(Object.keys(_o)) + '\n'); } catch (e) { }
  }
  if (process.env.GATE_DEBUG) console.error('evmaps-o ' + parts.reduce((a, b) => a + b.length, 0));
  if (process.env.GATE_DEBUG) console.error('evmaps-src scBy=' + JSON.stringify(S.scBy) + ' tavgBy=' + JSON.stringify(S.TavgBy));
}

// ---- core state writer (wire order matches step-probe read_core_state) ----
const CORE_NODAL = ['phi', 'xI', 'xX', 'nTf', 'nTc', 'nV', 'nRho', 'nVt', 'nTct', 'nCov',
  'nFol', 'nDmg', 'nOx', 'nMelt', 'nDisp', 'nDnb', 'chW'];
function dumpCoreState(S, id) {
  const cs = S.coreBy && S.coreBy[id];
  const cp = a => (a ? Array.from(a, Number) : []);
  for (const k of CORE_NODAL) f64an(cp(cs && cs[k]));
  f64(fnum(cs && cs.n));
  f64an(cp(cs && cs.C)); f64an(cp(cs && cs.dec));
  f64(fnum(cs && cs.decay)); f64(fnum(cs && cs.heat));
  f64(fnum(cs && cs.rodPos)); f64(fnum(cs && cs.rodDem));
  f64an(cp(cs && cs.rodZ)); f64an(cp(cs && cs.rodZDem));
  f64(fnum(cs && cs.tilt)); f64(fnum(cs && cs.tiltDem));
  u8(cs && cs.split ? 1 : 0); u8(cs && cs.reGang ? 1 : 0);
  u8(cs && cs.rodJam ? 1 : 0); u8(cs && cs.scrammed ? 1 : 0); u8(cs && cs.rodBand ? 1 : 0);
  f64(fnum(cs && cs.dnbr)); f64(fnum(cs && cs.x)); f64(fnum(cs && cs.i));
  f64(fnum(cs && cs.Tf)); f64(fnum(cs && cs.ao)); f64(fnum(cs && cs.ro));
  f64(fnum(cs && cs.hotRing)); f64(fnum(cs && cs.hotLev)); f64(fnum(cs && cs.vNode));
  f64(fnum(cs && cs.hotFlow)); f64(fnum(cs && cs.tipRho)); f64(fnum(cs && cs.TfHot));
  f64(fnum(cs && cs.dmg)); f64(fnum(cs && cs.meltFrac)); f64(fnum(cs && cs.oxMax));
  f64(fnum(cs && cs.qOx)); f64(fnum(cs && cs.fci)); f64(fnum(cs && cs.tCladHot));
  f64(fnum(cs && cs.dnbrMin)); f64(fnum(cs && cs.dnbrRing)); f64(fnum(cs && cs.dnbrLev));
  f64(fnum(cs && cs.fq)); f64(fnum(cs && cs.vf)); f64(fnum(cs && cs.voidTh));
  f64(fnum(cs && cs.coreDT));
  {
    const p = (cs && cs.parts) || {};
    f64a([p.rod, p.dop, p.mod, p.exp, p.xe, p.vd, p.tip, p.dis, p.bor].map(fnum));
  }
  f64(fnum(cs && cs.rho)); f64(fnum(cs && cs.pCore)); f64(fnum(cs && cs.flowNet));
  f64(fnum(cs && cs.fatigue));
  u8(cs && cs.melt ? 1 : 0); u8(cs && cs.breach ? 1 : 0);
  u8an(cs && cs.nTube ? Array.from(cs.nTube) : []);
  f64(fnum(cs && cs.tubesOpen)); u8(cs && cs.cavRelief ? 1 : 0);
}

// ---- canonical node bags (fixed order; absent → n-length zeros) ----
const CANON_BAGS = ['mBy', 'hBy', 'pBy', 'bBy', 'h2By', 'metalT'];
function dumpCanonBags(S, n) {
  for (const k of CANON_BAGS) {
    const h = S[k];
    if (!h || !h.v) {
      u32(n); f64a(new Array(n).fill(0)); u32(n); u8a(new Array(n).fill(0));
    } else {
      const v = Array.from(h.v);
      u32(v.length); f64a(v); u32(v.length); u8a(padTo(Array.from(h.has || []), v.length));
    }
  }
}

// ---- coreK dump (copied from core-gate.js dumpK, per vessel) ----
function dumpCoreK(K, P) {
  const NB = K.NB;
  const pad14 = a => { const o = Array.from(a || []); while (o.length < 14) o.push(0); return o.slice(0, 14); };
  const cp = a => Array.from(a || []);
  const f = [K.n0, K.TfRef, K.Tref, K.rodA, K.tipRho, K.tipLen, K.poison, K.mix, K.dT0, K.dh,
    K.aHeat, K.G0, K.filmPool, K.xSub, K.xSubLo, K.hfg, K.flowK, K.pinUA, K.gSolid, K.cladR,
    K.rodD, K.tmelt, K.KXE, K.aF, K.aM, K.aX, K.aS, K.aV, K.excess, K.dnbrK, K.tdmg, K.rated,
    K.scram, M.rodRate(K), K.burstK, K.P0, K.coreKg0, K.BETA, K.LAM, K.gI, K.lamI, K.gX, K.lamX,
    K.sig, K.cr, K.cz, K.albR, K.albT, K.albB, K.rinf, M.burstR(), P.rho0, M.RHO_BETA(), P.Tref,
    K.coreHgt].map(num);
  if (f.length !== 55) { console.error('K floats len ' + f.length); process.exit(2); }
  const law = K.dnbLaw === 'boil' ? 1 : K.dnbLaw === 'temp' ? 2 : 0;
  u32(NB); f64a(f);
  f64a(SAT_KEYS.map(k => num(K.sat[k])));
  raw8a([(K.oxid ? 1 : 0), (K.dryout ? 1 : 0), (K.tube ? 1 : 0), law]);
  f64a(pad14(K.poiG)); f64a(pad14(K.nPen)); f64a(pad14(K.enrRho)); f64a(pad14(K.rinfW));
  f64a(cp(K.bet).slice(0, 6)); f64a(cp(K.lam).slice(0, 6));
  f64a(cp(K.bankR).slice(0, NB)); f64a(cp(K.bankW).slice(0, NB));
}

// ---- solve dumpMeta (values from solvefull-gate.js P.meta; wire order
// matches step-probe read_solve_frozen: n ne v1 nloops netref + tables) ----
function dumpSolveMeta() {
  const P = M.P(), D = M.D(), net = P.net, n = net.n;
  const num0 = v => (v === undefined || v === null) ? NaN : v;
  const opt3 = v => (v === undefined || v === null) ? -1 : v;
  u32(n); u32(net.edges.length); u32(1);
  u32(P.loops); f64(P.netRef);
  const cmap = new Map(), curves = [];
  const curveOf = net.satBy.map(c => {
    const key = SAT_KEYS.map(k => String(num0(c[k]))).join(',');
    if (!cmap.has(key)) { cmap.set(key, curves.length); curves.push(SAT_KEYS.map(k => num0(c[k]))); }
    return cmap.get(key);
  });
  u32(curves.length);
  for (const c of curves) f64a(c);
  u32a(curveOf);
  u32a(net.edges.map(e => e.u)); u32a(net.edges.map(e => e.v));
  i32a(net.edges.map(e => e.wi === undefined ? -1 : e.wi));
  u8a(net.edges.map(e => e.i === undefined ? 0 : 1));
  i32a(net.edges.map(e => e.i === undefined ? 0 : e.i));
  f64a(net.edges.map(e => net.z[e.u] - net.z[e.v]));
  i32a(net.edges.map(e => e.poolAt === undefined ? -1 : e.poolAt));
  i32a(net.edges.map(e => opt3(e.chokeAt))); i32a(net.edges.map(e => opt3(e.gasAt)));
  i32a(net.edges.map(e => opt3(e.liqAt))); i32a(net.edges.map(e => e.Ck === undefined ? -1 : e.Ck));
  f64a(net.edges.map(e => num0(e.diode)));
  f64a(net.edges.map(e => num0(e.bore))); f64a(net.edges.map(e => num0(e.llen)));
  f64a(net.edges.map(e => num0(e.k0))); f64a(net.edges.map(e => num0(e.hC)));
  f64a(net.edges.map(e => num0(e.cavN))); f64a(net.edges.map(e => num0(e.cavOne)));
  f64a(net.edges.map(e => num0(e.cavRelief))); f64a(net.edges.map(e => num0(e.Cc)));
  u32a(net.edges.map(e => e.gateMode === 'throttle' ? (e.gateIds || []).length : 0));
  u8a(net.edges.map(e => typeof e.g === 'function' ? 1 : 0));
  u8a(net.edges.map(e => typeof e.h === 'function' ? 1 : 0));
  f64a(net.edges.map(e => (typeof e.g === 'function' ? NaN : num0(e.g))));
  f64a(net.edges.map(e => (typeof e.h === 'function' ? NaN : num0(e.h))));
  const stable = [];
  const stab = s => {
    if (s === undefined || s === null) return -1;
    let i = stable.indexOf(s);
    if (i < 0) { i = stable.length; stable.push(s); }
    return i;
  };
  i32a(net.edges.map(e => stab(e.key)));
  u8a(net.edges.map(e => e.meter === false ? 0 : 1));
  i32a(net.edges.map(e => (e.pair && e.pair.i !== undefined) ? e.pair.i : -1));
  u8a(net.edges.map(e => e.kind === 'break' ? 1 : 0));
  u8a(net.edges.map(e => (e.kind === 'break' && e.steam) ? 1 : 0));
  u8a(net.edges.map(e => (e.kind === 'break' && e.sec) ? 1 : 0));
  u8a(net.edges.map(e => e.kind === 'sgtr' ? 1 : 0));
  i32a(net.edges.map(e => e.shellOf === undefined ? -1 : stab(e.shellOf)));
  u8a(net.edges.map(e => e.shellSign === -1 ? 1 : 0));
  u8a(net.edges.map(e => e.work ? 1 : 0));
  i32a(net.edges.map(e => e.fit === undefined ? -1 : stab(e.fit)));
  f64a(Array.from(net.vol));
  u8a(net.name.map(nm => M.runKeyOfNode(nm) !== null ? 1 : 0));
  const gas = net.gasNodes || [], liq = net.liqNodes || [], condV = net.condV || [];
  u32(gas.length); u32a(gas); u32(liq.length); u32a(liq);
  u32(condV.length); u32a(condV);
  u8a(net.name.map((nm, i) => (net.cont || []).includes(i) ? 1 : 0));
  u32((net.cont || []).length); u32a(net.cont || []);
  const tankOrder = Object.keys(net.tankNode).map(id => net.tankNode[id]);
  u32(tankOrder.length); u32a(tankOrder);
  u8a(Object.keys(net.tankNode).map(id => (D.tanks[id] && D.tanks[id].hold) ? 1 : 0));
  const holdNodes = M.holdTankIds().map(id => net.tankNode[id]).filter(i => i !== undefined);
  u32(holdNodes.length); u32a(holdNodes);
  const drumNodes = M.drumIds().map(id => net.tankNode[id]).filter(i => i !== undefined);
  u32(drumNodes.length); u32a(drumNodes);
  const secT = (net.secT || []).slice();
  u32(secT.length); u32a(secT);
  const coreNodes = Object.values(net.coreNodes || {});
  u32(coreNodes.length); u32a(coreNodes);
  u32(net.coreNode === undefined ? 0xFFFFFFFF : net.coreNode);
  const runKeys = [];
  for (const ed of net.edges) if (ed.key && ed.meter !== false && !runKeys.includes(ed.key)) runKeys.push(ed.key);
  const coreKeys = Object.keys(net.coreNodes || {});
  const tankKeys = [];
  for (const id in net.tankNode) if (!(D.tanks[id] && D.tanks[id].hold)) tankKeys.push(id);
  const shellKeys = [];
  for (const ed of net.edges) if (ed.shellOf !== undefined && !shellKeys.includes(ed.shellOf)) shellKeys.push(ed.shellOf);
  const sgtrKeys = [];
  for (const ed of net.edges) if (ed.kind === 'sgtr' && ed.key !== undefined && !sgtrKeys.includes(ed.key)) sgtrKeys.push(ed.key);
  const reliefKeys = (net.fitIds || []).filter(fid => net.fitMode[fid] === 'relief');
  const byKeys = [];
  for (const ed of net.edges) if (ed.kind === 'break' && ed.key !== undefined && !byKeys.includes(ed.key)) byKeys.push(ed.key);
  const tables = [runKeys, coreKeys, tankKeys, shellKeys, sgtrKeys, reliefKeys, byKeys].map(l => l.map(stab));
  for (const t of tables) { u32(t.length); i32a(t); }
  i32a(runKeys.map(k => { const v = M.loopOfKey(k); return v === undefined || v === null ? -1 : v; }));
  i32a(net.name.map((nm, i) => (net.coreOfNode && net.coreOfNode[i] !== undefined) ? coreKeys.indexOf(net.coreOfNode[i]) : -1));
  i32a(net.name.map((nm, i) => (net.tankIdByNode && net.tankIdByNode[i] !== undefined) ? tankKeys.indexOf(net.tankIdByNode[i]) : -1));
  i32a(net.name.map((nm, i) => (net.secTById && net.secTById[i] !== undefined) ? shellKeys.indexOf(net.secTById[i]) : -1));
  u8a(net.name.map((nm, i) => net.coreSet.has(i) ? 1 : 0));
  u32(stable.length);
  for (const s of stable) str(s);
  u32(runKeys.length); u32(coreKeys.length); u32(tankKeys.length); u32(shellKeys.length);
  u32(sgtrKeys.length); u32(reliefKeys.length); u32(byKeys.length);
  return { n, ne: net.edges.length };
}

// ---- main loop ----
{
  const allKeys = Object.keys(M.PRE());
  const keys = PRESET_ONLY === null ? allKeys : allKeys.filter(k => PRESET_ONLY.includes(k));
  if (keys.length === 0) { console.error('no presets match --preset ' + PRESET_ARG); process.exit(2); }
  const np = keys.length;
  const hb = Buffer.alloc(8);
  hb.writeUInt32LE(np, 0); hb.writeUInt32LE(1, 4);
  fs.writeSync(fd, hb);
}
for (const k of Object.keys(M.PRE())) {
  if (PRESET_ONLY !== null && !PRESET_ONLY.includes(k)) continue;
  M.plantPreset(+k); M.buildLayout(); M.commission();
  M.S().diceOff = true;
  M.S().seed = M.S().rng = (123456789 + 1000003 * +k) >>> 0;
  presetNames.push(M.PRE()[k][0]);
  const C = assertConsts();
  const secMeta = dumpSecMeta(C);
  if (process.env.GATE_DEBUG) console.error('post-secmeta-only ' + parts.reduce((a, b) => a + b.length, 0));
  dumpSecCurves(secMeta);
  if (process.env.GATE_DEBUG) console.error('post-secmeta ' + parts.reduce((a, b) => a + b.length, 0));
  const roomMeta = dumpRoomMeta(C); dumpRoomCurves(roomMeta);
  if (process.env.GATE_DEBUG) console.error('post-roommeta ' + parts.reduce((a, b) => a + b.length, 0));
  const eventsMeta = dumpEventsMeta(C);
  if (process.env.GATE_DEBUG) console.error('post-eventsmeta ' + parts.reduce((a, b) => a + b.length, 0));
  const coreIds = M.coreIds();
  u32(coreIds.length);
  for (const id of coreIds) { str(id); dumpCoreK(M.P().cores[id], M.P()); }
  if (process.env.GATE_DEBUG) console.error('post-coreK ' + parts.reduce((a, b) => a + b.length, 0));
  const solveMeta = dumpSolveMeta();
  if (process.env.GATE_DEBUG) console.error('post-solve ' + parts.reduce((a, b) => a + b.length, 0));
  dumpTransMeta();
  if (process.env.GATE_DEBUG) console.error('post-trans ' + parts.reduce((a, b) => a + b.length, 0));
  // S0 states
  const S = M.S(), P = M.P(), HB = M.HB(), net = P.net;
  dumpSecState(S, P, HB, secMeta);
  dumpRoomState(S, roomMeta);
  dumpEventsState(S, eventsMeta);
  u32(coreIds.length);
  for (const id of coreIds) { str(id); dumpCoreState(S, id); }
  if (process.env.GATE_DEBUG) console.error('S0-coren ' + coreIds.map(id => id + '=' + ((S.coreBy && S.coreBy[id] && S.coreBy[id].n))).join(' '));
  dumpCanonBags(S, net.n);
  if (process.env.GATE_DEBUG) console.error('S0-blk len=' + (S.blkOutV ? S.blkOutV.length : -1) + ' S0-P=' + S.P + ' S0-tick=' + S.tick + ' S0-tavgby=' + JSON.stringify(S.TavgBy));
  if (process.env.GATE_DEBUG) console.error('S0-names62 ' + [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71].map(i => i + '=' + net.name[i]).join(' '));
  if (process.env.GATE_DEBUG) console.error('S0-runT ' + JSON.stringify(S.runT));
  if (process.env.GATE_DEBUG) console.error('S0-hpix has=' + (P.net.index['run:hpi:coreb-hpir'] !== undefined));
  if (process.env.GATE_DEBUG) console.error('S0-hpix2 i=' + P.net.index['run:hpi:coreb-hpir']);
  f64an(S.blkOutV ? Array.from(S.blkOutV) : []);
  f64an(S.blkOutF ? Array.from(S.blkOutF) : []);
  f64(num(S.Tavg)); f64(num(S.dTavg));
  strmap(S.TavgBy || {}); strmap(S.dTavgBy || {});
  {
    const F = net.F;
    for (const f of ['p', 'rho', 'x', 'b', 'rhoD', 'rhoG', 'rhoL']) f64a(Array.from(F[f]));
    u8a(Array.from(F.wet)); u8a(Array.from(F.void));
    for (const f of ['mu', 'lp', 'lh', 'lm']) f64a(Array.from(F[f]));
  }
  f64a(net.wArr ? Array.from(net.wArr) : new Array(net.edges.length).fill(0));
  f64a(net.fixV ? Array.from(net.fixV) : new Array(net.n).fill(0));
  u8(M.CHOKE() ? 1 : 0);
  for (const a of [net.stKp, net.stKh, net.stKm, net.stP0, net.stC]) f64a(a ? Array.from(a) : new Array(net.n).fill(0));
  {
    const pc = net.pc || null;
    const of = pc && pc.of ? Array.from(pc.of) : [];
    const live = pc && pc.live ? Array.from(pc.live) : [];
    u32(of.length); i32a(of);
    u32(pc && pc.n !== undefined ? pc.n : 0);
    u32(live.length); u8a(live);
  }
  str(String((P.net && P.net.AfTopo) || ''));
  {
    const q = S.inject;
    const ok = q && q.kind !== undefined && q.rate && typeof q.target === 'number';
    u8(ok ? 1 : 0);
    if (ok) { u8({ heat: 0, gas: 1, fluid: 2, h2: 3, o2: 4, steam: 5 }[q.kind] || 0); f64(q.rate); i32(q.target); }
  }
  u32(M.roomCgIt()); u32(M.roomPGen());
  f64an(M.gsX()); f64an(M.gsDisp());
  {
    // S0 LOG: count + placeholders (pre-existing lines unmapped and never
    // compared — slices start at log0; keys unknown, coalesce N/A).
    const L = M.LOG();
    u32(L.length);
    for (let i = 0; i < L.length; i++) { u8(255); u32(0xFFFFFFFF); }
  }
  u32(S.tick >>> 0);
  const meta = {
    sec: secMeta, room: roomMeta, events: eventsMeta, coreIds,
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
