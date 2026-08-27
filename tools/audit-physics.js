#!/usr/bin/env node
/* reactor-crew physics auditor.
   Runs the sim headless. Two things it checks:
     1. no plant the bench will let you build trips itself while nobody touches it
     2. the documented behaviours in .claude/CLAUDE.md still hold
   Usage:  node tools/audit-physics.js
*/
const {execFileSync}=require('child_process');
const M=require('./bundle').headless(
 '{commission,resetPlant,step,derived,resetTrip,S:()=>S,P:()=>P,D:()=>D,'+
 'ARCH:()=>ARCH,FUEL:()=>FUEL,SCRAM:()=>SCRAM,ANN:()=>ANN,manualScram,combatHit,LAY:()=>LAY,moveTo,'+
 'setSplit,setCommon,bankAutoLive,tProg,ROD_RATE,AUTOROD_GAIN,AUTOROD_LEAD,AUTOROD_LO,AUTOROD_HI,'+
 'seedRng,srand,roll,DICE:()=>DICE,'+
 'pumpCap,totalPumpCap,placePart,removePart,addFit,removeFit,addRun,removeRun,fittableList,'+
 'loopOf,loopOfKey,loopPumpCap,portRoom,nearestFreePort,hasHeatSink,pzrLive,ROLE:()=>ROLE,'+
 'pipeNetwork,act,ctxItemsDesign,'+
 'LAT:()=>LAT,LQ,LIX,latDefault,latRevolve,latWarn,LM:()=>LM,'+
 'layoutMetrics,radAt,radSolve,radGeom,radSrc,radPeak,RAD_HI,repairStart,radWorkK,RAD_SLOW,'+
 'netBuild,netFlowK,setPipeK,setPumpH0,setHeadK,netPressures,netDrops,'+
 'VALVE_RATE,hittableRunKeys,pipeCells,pipePart,'+
 'primaryRelief,reliefFitIds,reliefAnyOpen,reliefAnyStuck,reliefRate,reliefFullRate,PIPE_BORE:()=>PIPE_BORE,'+
 'reliefSet,porvLive,PORV_LIFT0,PORV_RESEAT0,autoLive,AUTOSYS:()=>AUTOSYS,'+
 'paramsForFit,readoutsForFit,SGT:()=>SGT,sgCount,invRate,tankPoolPct,tankRuleAny,tanks:()=>D.tanks,FLUID:()=>FLUID,AUTORULE:()=>AUTORULE,tankLvl,tankP,tankLive,tankOpen,tankIds,tankKg,tankRateRef,tankFluid,hostedTankIds,boronTankIds,addTank,'+
 'sgIds,sglMin,sgLvl,sgShare,netExpSurge,secP,BETA_W,LVL_K}');
const {makeLoops}=require('./loopgen');
const HOT_NPSH_A=10;   // mirrors step.js's own HOT_NPSH - the suction taper this block asserts against
const D=M.D(), ARCH=M.ARCH(), FUEL=M.FUEL(), SCRAM=M.SCRAM(), ANN=M.ANN();
const BASE=JSON.parse(JSON.stringify(D));
/* THE LATTICE IS PART OF THE DESIGN NOW, so set() has to put it back as well
   as D, or one case's core leaks into the next. Order matters: BASE carries
   the seven fields the lattice MEASURES, and they are stale the moment the
   lattice differs - so latDefault() runs last and overwrites them with the
   truth. `o.lat` is a hook for a case that wants a different core: it runs
   after the reset and does its own latRevolve().
   BASE is COPIED on every reset rather than assigned from: D carries objects
   now (pumpSize, fit), and Object.assign hands over the reference, so a case
   that wrote through one would poison BASE and every case after it. set() does
   NOT touch placedParts (layout.js) - that is not a D field, so any case that
   places a pump has to remove it again itself, the same way it would restore
   any other module state set() does not own.
   `o.loops`, unlike every other field, is NOT a D field any more - D.loops
   was deleted in Stage 3b. It is a request this helper honours through the
   real mechanism (makeLoops(), loopgen.js): placed generators, placed pumps,
   real D.run entries, exactly what a player's ADD STEAM GENERATOR HERE +
   CONNECT would build. Every set() call re-syncs to the requested count,
   tearing down whatever a PRIOR call built first, so `loops` never needs
   its own restore the way a bare D field would. */
const set=o=>{
  o=o||{};
  const lat=o.lat; if(lat) { o=Object.assign({},o); delete o.lat; }
  const loops=o.loops; if(loops!=null){ o=Object.assign({},o); delete o.loops; }
  Object.assign(D,JSON.parse(JSON.stringify(BASE)),o);
  M.latDefault();
  if(lat) lat();
  makeLoops(M, loops||1);
  M.commission(); return M.S();
};
const run=(s,secs)=>{ for(let i=0;i<secs*50;i++){ M.step(0.02); if(s.breach) break; } return s; };

let fails=0;
const bad=m=>{ console.log('  FAIL '+m); fails++; };

/* With automatic rod control fitted, a plant nobody touches must hold. Without it
   the bank never moves, so xenon walks the core off its start point over the
   compressed clock and an eventual trip is the player's problem, not a bug.

   The ticks live in tools/sweep.js, which spreads them over every core - they
   were 93% of this auditor's runtime on one thread. It hands back raw results
   and this block is still the only place that says what they mean. */
console.log('=== UNTOUCHED PLANT WITH AUTO ROD CONTROL MUST NOT TRIP ITSELF (600 s) ===');
{ const sw=JSON.parse(execFileSync(process.execPath,[require.resolve('./sweep')],
                                   {maxBuffer:1<<24}).toString());
  let cases=0, sims=0;
  for(const g of sw.groups){
    cases+=g.built.length;
    if(!g.built.length) continue;
    sims++;
    if(g.trip) bad(`${ARCH[g.a].id}/${FUEL[g.f].name}/${SCRAM[g.scram].name}`+
                   ` tripped at t=${g.t.toFixed(1)}s: ${g.trip}`);
  }
  /* Why sims < cases: the scram system is the one design axis that cannot
     change an untouched plant, because P.scram is only read once the plant has
     scrammed and the assertion above is that it never does. The sweep still
     asks the bench about every scram choice - a heavier one can break the mass
     budget - but simulates each group once. This is the check that keeps that
     true: the group below was run at all three settings anyway. */
  const g=sw.groups.find(x=>x.guard);
  if(!g) bad('the sweep ran no scram-equivalence guard, so sharing a run per group is unproven');
  else if(new Set(g.guard).size!==1)
    bad('scram choice now changes an untouched plant - sweep.js must stop sharing one run per group');
  console.log(`  ${cases} buildable designs checked, ${sims} distinct plants simulated on ${sw.workers} threads`);
}

console.log('\n=== DOCUMENTED BEHAVIOUR ===');
{ const s=set({}); run(s,60);
  if(s.n<0.80||s.n>1.02) bad(`PWR settles at ${(s.n*100).toFixed(1)}%, expected 80..102%`);
  if(s.Tf<820||s.Tf>980)  bad(`PWR fuel temp ${s.Tf.toFixed(0)} K, expected 820..980`);
  if(s.dnbr<1.4)          bad(`PWR DNBR ${s.dnbr.toFixed(2)}, expected >1.4`);
  console.log(`  PWR at rest: n=${(s.n*100).toFixed(1)}% Tf=${s.Tf.toFixed(0)}K DNBR=${s.dnbr.toFixed(2)}`);
}
/* A plant sitting on its own commissioning point has nothing to alarm about,
   whatever it is built from. A tile lit at rest is a tile that was fitted
   against a PWR number instead of the plant's own. */
for(let a=0;a<ARCH.length;a++){
  const s=set({arch:a}); run(s,60);
  const lit=ANN.filter(t=>t[2](s)).map(t=>t[0]);
  if(lit.length) bad(`${ARCH[a].id} at rest lights ${lit.join(', ')}`);
}
console.log('  no annunciator lit at rest, every architecture');
{ const s=set({}); run(s,10);
  s.scrammed=true; s.rodDem=1; s.load=s.loadDem=0.05; run(s,120);
  if(s.n>0.02) bad(`after scram + 120 s power is ${(s.n*100).toFixed(2)}%, expected <2%`);
  console.log(`  scram + 120 s: n=${(s.n*100).toFixed(3)}%`);
}
{ const s=set({}); run(s,10);
  s.byp.rps=true; s.boron=0; s.boronDem=0; run(s,120);   // demand too, or the walk drags it back
  if(!s.melt && !s.breach) bad('boron dump + RPS bypass destroyed nothing');
  if(s.t>60)               bad(`boron dump + RPS bypass took ${s.t.toFixed(0)} s, expected well under 60`);
  console.log(`  boron dump + bypass: melt=${s.melt} breach=${s.breach} at t=${s.t.toFixed(0)}s`);
}
{ const s=set({arch:2}); run(s,10);
  s.byp.rps=true; s.flow=0.05; s.flowDem=0.05; run(s,400);   // power collapses, xenon burns out, then it runs away
  if(!s.melt) bad('RBMK low flow + bypass did not melt the core');
  console.log(`  RBMK low flow + bypass: melt=${s.melt} dmg=${s.dmg.toFixed(0)}`);
}
{ const s=set({arch:5}); run(s,10);
  s.byp.rps=true; s.flow=0.05; s.flowDem=0.05; run(s,300);
  if(s.melt) bad('HTGR melted on low flow + bypass; it is meant to survive');
  console.log(`  HTGR low flow + bypass: melt=${s.melt} dmg=${s.dmg.toFixed(0)}`);
}
/* the pump slider reaches zero: stopping the pumps is an order the panel
   accepts. Armed, the flow trip catches it before DNBR is anywhere near the
   limit, whatever redundancy was bought - the floor is a setpoint, not a
   stop. Bypassed, the core is left on buoyancy and must settle there instead
   of running away. Redundancy is placed spare pumps now, not a dial - zero,
   one and two of them, each a real component added before commissioning and
   removed again after, so it does not leak into the next case. */
for(const spares of [0,1,2]){
  set({});
  const added=[];
  for(let i=0;i<spares;i++) added.push(M.placePart(n=>
    ({id:'pumpX'+n,name:'RCP SPARE',w:1,h:1,x:9+i,y:5,col:'#57d38c',grp:'loop0',tip:'t',loop:0})));
  M.commission(); const s=M.S(); run(s,10);
  s.flowDem=0;
  for(let i=0;i<120*50 && !s.scrammed && !s.breach;i++) M.step(0.02);
  const floor=M.P().flowMin;
  if(!/LOW FLOW/.test(s.trip)) bad(`pumps commanded to zero with ${spares} spare(s) tripped on "${s.trip}", expected LOW FLOW`);
  if(s.flow>floor*1.05) bad(`pumps commanded to zero tripped at ${(s.flow*100).toFixed(1)}%, nowhere near the ${(floor*100).toFixed(0)}% floor`);
  console.log(`  pumps to zero, ${spares} spare(s): trip="${s.trip}" at flow=${(s.flow*100).toFixed(1)}% dnbr=${s.dnbr.toFixed(2)}`);
  for(const p of added) M.removePart(p.id);
}
/* Buoyancy removes heat but hardly moves the water, so it buys no DNBR. Stopping
   the pumps with the protection defeated must destroy the core, not settle into a
   comfortable low-power hum with more thermal margin than the plant had running. */
{ const s=set({}); run(s,10); s.byp.rps=true; s.flowDem=0; run(s,180);
  if(s.flow>0.01) bad(`pumps commanded to zero coasted to ${(s.flow*100).toFixed(1)}%, not to a stop`);
  if(!s.melt) bad(`pumps stopped with RPS bypassed left the core intact: dmg=${s.dmg.toFixed(0)} dnbr=${s.dnbr.toFixed(2)}`);
  if(s.dnbr>M.P().dnbr0) bad(`stopping the pumps IMPROVED DNBR to ${s.dnbr.toFixed(2)} from a rated ${M.P().dnbr0.toFixed(2)}`);
  console.log(`  pumps to zero, RPS bypassed: n=${(s.n*100).toFixed(1)}% nat=${(s.nat*100).toFixed(1)}% Tf=${s.Tf.toFixed(0)}K dnbr=${s.dnbr.toFixed(2)} dmg=${s.dmg.toFixed(1)} melt=${s.melt}`);
}

/* Xenon shuts a reactor down as hard as the bank does, and xenon decays. So a
   tripped core walks back to critical on its own with the rods still fully in,
   and nothing but boron holds it there. The bench used to sell +454 pcm of
   margin against that from a polynomial that touched none of it; it now reports
   what the model does. A negative bank-only margin is the honest answer, not a
   fault, and the design is only blocked when boration cannot win either. */
const scram=s=>{ s.scrammed=true; s.rodDem=1; s.trip="MANUAL SCRAM";
                 s.load=s.loadDem=Math.min(s.load,0.05); };
{ const d=M.derived();
  if(d.sdm>0) bad(`bench claims the bank alone holds a default PWR down (${d.sdm.toFixed(0)} pcm) - the model says otherwise`);
  if(d.sdmB<200) bad(`full boration cannot hold a default PWR down: ${d.sdmB.toFixed(0)} pcm`);
  const s=set({autorod:false}); run(s,10); scram(s); run(s,120);
  let peak=0;
  for(let i=0;i<480*50;i++){ M.step(0.02); if(s.n>peak) peak=s.n; if(s.breach) break; }
  if(peak<0.05) bad('a tripped core left alone stayed shut down; the xenon recriticality is gone');
  console.log(`  bank alone ${d.sdm.toFixed(0)} pcm: tripped core came back to ${(peak*100).toFixed(0)}%`);
}
{ const s=set({autorod:false}); run(s,10); scram(s);
  s.boron=s.boronDem=-6000;                    // the operator borates, as the bench told them to
  run(s,120);
  let peak=0;
  for(let i=0;i<480*50;i++){ M.step(0.02); if(s.n>peak) peak=s.n; if(s.breach) break; }
  if(peak>0.05) bad(`a borated trip still came back to ${(peak*100).toFixed(0)}%`);
  if(s.dmg>0.1) bad(`a borated trip still damaged the core: dmg=${s.dmg.toFixed(1)}`);
  console.log(`  borated: peak ${(peak*100).toFixed(2)}% dmg=${s.dmg.toFixed(1)} - boron is the answer, and it works`);
}

console.log('\n=== PROTECTION SYSTEM IS A DESIGN CHOICE ===');
{ const s=set({rps:true}); run(s,10);
  M.D().autorod=false; M.P().autorod=false; s.rodDem=0;                 // rods full out
  run(s,120);
  if(!s.scrammed)      bad('RPS fitted and armed did not trip on a rod withdrawal');
  console.log(`  RPS fitted:     ${s.trip||'no trip'} at t=${s.t.toFixed(1)}s`);
}
{ const s=set({rps:false}); run(s,10);
  M.D().autorod=false; M.P().autorod=false; s.rodDem=0;
  run(s,120);
  if(s.scrammed)       bad(`no RPS fitted but the plant scrammed itself: ${s.trip}`);
  console.log(`  RPS not fitted: ${s.trip||'no trip'} at t=${s.t.toFixed(1)}s n=${(s.n*100).toFixed(0)}%`);
}
{ /* Rod worth used to be a number you set. It is measured off the solve now,
     so this case has to BUILD a core worth about 5200 pcm instead of asking
     for one: hafnium clusters, and a lot of them, packed inward where the flux
     is. The assertion is unchanged and so is the point of it - withdraw a very
     heavy bank with nothing watching and the core destroys itself. */
  const s=set({rps:false, lat:()=>{
    const LAT=M.LAT(), LQ=M.LQ, LIX=M.LIX;
    LAT.abs=2;                                   // hafnium
    for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++)
      if(LAT.slot[LIX(u,v)] && (u+v)%2===0) LAT.rod[LIX(u,v)]=(u+v)%8<4?0:1;
    M.latRevolve();
  }});
  const built=D.rodw;
  if(built<3400) bad(`the heavy-bank core came to only ${built.toFixed(0)} pcm; hafnium alone is worth 1.34x the stock 2600`);
  if(built>4600) bad(`the heavy-bank core came to ${built.toFixed(0)} pcm - cluster count is buying worth again, so rodShape() stopped normalising`);
  run(s,10);
  M.D().autorod=false; M.P().autorod=false; s.rodDem=0;
  run(s,120);
  if(!s.melt && !s.breach) bad('no RPS fitted and a full rod withdrawal destroyed nothing');
  console.log(`  RPS not fitted, ${built.toFixed(0)} pcm of DRAWN bank worth: melt=${s.melt} breach=${s.breach} at t=${s.t.toFixed(0)}s`);
}
{ set({rps:false});
  const w=M.derived().warn;
  if(!w.some(x=>/protection/i.test(x[1]))) bad('no RPS fitted raises no warning on the bench');
  if(w.some(x=>x[0]==='HARD' && /protection/i.test(x[1]))) bad('missing RPS is a HARD block; it must only warn');
  console.log(`  bench warning: ${(w.find(x=>/protection/i.test(x[1]))||[,'(none)'])[1]}`);
}

console.log('\n=== TILT TRIM IS AN ACTUATOR, AND IT REACHES THE FLUX ===');
/* s.ro is (inner - outer)/(inner + outer). A settled core already sits well off
   centre, so the test is the SHIFT the trim causes, not the absolute value.
   Pushing the inner banks in - what +1 does - must drive ro further negative.
   Each direction starts from its own commissioned plant so they cannot
   contaminate each other. */
const tiltRun=t=>{ const s=set({}); s.tiltDem=t; run(s,60); return s; };
{ const s=set({});
  if(s.tilt!==0 || s.tiltDem!==0) bad('a commissioned plant does not start with zero tilt');
  s.tiltDem=1; M.step(0.02);
  if(s.tilt>0.05) bad(`tilt teleported to ${s.tilt.toFixed(3)} in one tick; it must walk`);
}
{ const r0=tiltRun(0).ro, rp=tiltRun(1), rm=tiltRun(-1);
  if(rp.tilt<0.95)  bad(`tilt did not reach +1 in 60 s (got ${rp.tilt.toFixed(3)})`);
  if(rm.tilt>-0.95) bad(`tilt did not reach -1 in 60 s (got ${rm.tilt.toFixed(3)})`);
  if(!(rp.ro<r0)) bad(`+1 tilt did not push power outward: ro ${r0.toFixed(4)} -> ${rp.ro.toFixed(4)}`);
  if(!(rm.ro>r0)) bad(`-1 tilt did not pull power inward: ro ${r0.toFixed(4)} -> ${rm.ro.toFixed(4)}`);
  console.log(`  radial offset at tilt -1 / 0 / +1: ${(rm.ro*100).toFixed(1)}% / ${(r0*100).toFixed(1)}% / ${(rp.ro*100).toFixed(1)}%`);
  /* A trim that cannot answer a real part of what the plant does to itself is
     decoration. A load transient swings the radial offset ~3.5 points on its
     own, so the trim has to be worth at least a third of that end to end -
     enough to fight a xenon tilt, not enough to cancel physics. */
  const auth=(rm.ro-rp.ro)*100;
  if(auth<1.2) bad(`tilt trim only moves the offset ${auth.toFixed(2)} points end to end; too weak to steer with`);
  console.log(`  trim authority: ${auth.toFixed(1)} points of radial offset, end to end`);
}
{ const s=set({}); s.rodJam=true; s.tiltDem=1; run(s,30);
  if(s.tilt!==0) bad(`a jammed bank still moved the tilt trim (${s.tilt.toFixed(3)})`);
  console.log(`  jammed bank: tilt stays ${s.tilt.toFixed(2)} however hard you ask`);
}

console.log('\n=== THE ROD DRIVES ARE A TARGET, AND THEY RIDE THE HEAD ===');
{ /* the hit is aimable now, so the old trick of narrowing LAY.parts to one element is gone */
  const s=set({}); run(s,5);
  M.combatHit('rods');
  if(!s.dmgParts.includes('rods')) bad('a hit on the rod drives was not recorded as damage');
  if(!s.rodJam) bad('a hit on the rod drives did not jam the bank');
  const at=s.rodPos; s.rodDem=0; run(s,10);
  if(s.rodPos!==at) bad(`a wrecked bank still answered the slider (${at.toFixed(3)} -> ${s.rodPos.toFixed(3)})`);
  M.manualScram();
  if(!s.rodJam) bad('SCRAM un-wrecked the rod drives - damage must need a repair party');
  run(s,10);
  if(s.rodPos!==at) bad(`a wrecked bank still dropped on a scram (${s.rodPos.toFixed(3)})`);
  console.log(`  drive hit: bank frozen at ${(at*100).toFixed(0)}%, slider and scram both ignored`);
  s.repair={id:'rods',t:0,need:0.01}; M.step(0.02); M.step(0.02);
  if(s.rodJam||s.dmgParts.includes('rods')) bad('a completed repair left the rod drives out of service');
  console.log('  repair complete: the drives answer again');
}
{ /* a sticky bank is not a wrecked one - the malfunction toggle still clears */
  const s=set({}); run(s,5); s.rodJam=true; M.manualScram();
  if(s.rodJam) bad('a scram no longer frees a merely sticky bank');
  console.log('  sticky bank, no damage: a scram still frees it');
}
{ /* the drives are bolted to the vessel head and are never sited on their own */
  const L=M.LAY(), core=L.parts.find(q=>q.id==='core'), rods=L.parts.find(q=>q.id==='rods');
  if(!rods.pin||rods.pin.to!=='core') bad('the rod drives are not pinned to the reactor');
  if(rods.w!==core.w) bad(`the drives are ${rods.w} cells wide on a ${core.w}-cell vessel head`);
  if(M.moveTo(rods,8,8)) bad('the rod drives were sited on their own');
  /* the top-left corner is clear on every loop count, so row 1 is a fair test of
     the head rule and row 0 can only fail for the reason being checked */
  if(!M.moveTo(core,0,1)) bad('the reactor could not be moved to a clear part of the grid');
  if(rods.x!==core.x||rods.y!==core.y-1)
    bad(`the drives came off the head (core ${core.x},${core.y} drives ${rods.x},${rods.y})`);
  if(M.moveTo(core,0,0)) bad('the reactor took row 0, leaving no row for its own drive head');
  if(!M.moveTo(core,2,4)) bad('the reactor could not be put back where it started');
  console.log('  drives follow the vessel head, and refuse to be sited alone');
}

console.log('\n=== NO FREE COOLING, NO FREE TRIP RESET ===');
{ const s=set({rps:false, bkp:0, chim:0}); run(s,10);
  M.D().autorod=false; M.P().autorod=false;
  s.flow=0; s.flowDem=0; s.blackout=true; s.bkpLost=true;                    // nothing turning, nothing to turn it
  const feff=[];
  for(let i=0;i<600*50;i++){ M.step(0.02); if(i%2500===0) feff.push(s.n); }
  if(s.dmg===0 && s.n>0.30) bad(`total loss of flow settled at ${(s.n*100).toFixed(0)}% with no damage`);
  console.log(`  blackout, no backup, no chimney: power=${(s.n*100).toFixed(1)}% Tf=${s.Tf.toFixed(0)}K dmg=${s.dmg.toFixed(1)}`);
}
{ const s=set({}); run(s,10);
  M.D().autorod=false; M.P().autorod=false; s.rodDem=0;
  for(let i=0;i<300*50;i++){ M.step(0.02); if(s.scrammed) break; }
  if(!s.scrammed) bad('setup: expected an RPS trip before testing the latch');
  s.rodDem=0.30;                                                 // what the rod slider does now
  run(s,2);
  if(!s.scrammed) bad('moving the rods cleared the trip latch on its own');
  /* the latch owns the bank: a slider nudge must not pull the rods back out */
  if(s.rodPos<0.85) bad(`rod slider pulled the bank out to ${(s.rodPos*100).toFixed(0)}% under a latched scram`);
  console.log(`  rod slider after a trip: scrammed stays ${s.scrammed}, bank at ${(s.rodPos*100).toFixed(0)}%`);
  const ok=M.resetTrip();
  console.log(`  resetTrip() with the condition gone: accepted=${ok} scrammed=${s.scrammed} trip="${s.trip}"`);
  if(!ok || s.scrammed) bad('resetTrip() refused even though no trip condition was live');
}
{ const s=set({}); run(s,10);
  s.scrammed=true; s.rodDem=1; s.trip="MANUAL SCRAM";
  s.P=M.P().P0*0.5;                                              // a LOW PRESSURE condition, live now
  const ok=M.resetTrip();
  if(ok || !s.scrammed) bad('resetTrip() accepted while a trip condition was still live');
  console.log(`  resetTrip() with LOW PRESSURE still live: accepted=${ok} (must be false)`);
}
/* The veto is the protection system's, so the bypass switch takes it off - the
   same abuse, the same condition, and only the switch different. */
{ const s=set({}); run(s,10);
  s.scrammed=true; s.rodDem=1; s.trip="MANUAL SCRAM";
  s.P=M.P().P0*0.5;
  s.byp.rps=true;
  const ok=M.resetTrip();
  if(!ok || s.scrammed) bad('resetTrip() refused with the RPS bypassed at the panel');
  console.log(`  resetTrip() with the same condition but RPS BYPASSED: accepted=${ok} (must be true)`);
}

/* Every automatic system can be switched off at the panel. Each check below
   proves the switch reaches the physics: the same abuse must land differently
   with the system armed and with it bypassed. */
console.log('\n=== EVERY AUTOMATIC SYSTEM IS BYPASSABLE ===');
{ const s=set({});
  const keys=Object.keys(s.byp);
  const want=['rps','rod','porv','runback','bkp'];
  for(const k of want) if(!keys.includes(k)) bad(`no bypass switch for ${k}`);
  console.log(`  switches: ${keys.join(' ')}`);
}
{ /* auto rod control walks the bank back to its own band; bypassed, the bank
     stays exactly where the operator put it */
  const a=set({autorod:true}); run(a,10); a.rodDem=0.90; run(a,60);
  const b=set({autorod:true}); run(b,10); b.byp.rod=true; b.rodDem=0.90; run(b,60);
  if(a.rodPos>0.60) bad(`auto rod control armed let the bank reach ${(a.rodPos*100).toFixed(0)}%, expected it held back`);
  if(b.rodPos<0.85) bad(`auto rod control bypassed only reached ${(b.rodPos*100).toFixed(0)}%, expected ~90%`);
  console.log(`  AUTO ROD: armed holds bank at ${(a.rodPos*100).toFixed(0)}%, bypassed obeys ${(b.rodPos*100).toFixed(0)}%`);
}
{ /* the relief valve is what stops a pressure transient reaching the vessel.
     Hand the loop an overpressure it must answer, then ask whether it lifted.
     s.reliefOpen/etc are per-fitting now (Stage 5) - reliefAnyOpen() is the
     same fact the annunciator and the event log mean by "the relief valve
     is open" (step.js). */
  const a=set({}); run(a,10); a.P=M.P().P0*1.08; run(a,1);
  const b=set({}); run(b,10); b.byp.porv=true; b.P=M.P().P0*1.08; run(b,1);
  const aOpen=M.reliefAnyOpen(a), bOpen=M.reliefAnyOpen(b);
  if(!aOpen) bad('armed PORV did not lift at 108% of nominal pressure');
  if(bOpen)  bad('PORV lifted automatically while its bypass was in');
  if(b.P <= a.P)  bad(`PORV bypass did not hold pressure up (armed ${a.P.toFixed(2)}, bypassed ${b.P.toFixed(2)} MPa)`);
  console.log(`  PORV AUTO: armed lifted=${aOpen} at ${a.P.toFixed(2)} MPa, bypassed lifted=${bOpen} at ${b.P.toFixed(2)} MPa`);
}
{ /* runback sheds the turbine on a trip; bypassed, the turbine drains a dead core */
  const a=set({}); run(a,10); a.scrammed=true; a.rodDem=1; a.load=a.loadDem=Math.min(a.load,0.05); run(a,60);
  const b=set({}); run(b,10); b.byp.runback=true; b.scrammed=true; b.rodDem=1; run(b,60);
  if(b.load<0.5) bad(`runback bypassed still shed load to ${(b.load*100).toFixed(0)}%`);
  if(b.Tavg>=a.Tavg) bad(`runback bypassed did not overcool (armed ${a.Tavg.toFixed(0)} K, bypassed ${b.Tavg.toFixed(0)} K)`);
  console.log(`  RUNBACK: armed load ${(a.load*100).toFixed(0)}% Tavg ${a.Tavg.toFixed(0)}K, bypassed load ${(b.load*100).toFixed(0)}% Tavg ${b.Tavg.toFixed(0)}K`);
}
{ /* emergency feedwater is the decay heat sink after a trip */
  const a=set({}); run(a,10); a.scrammed=true; a.rodDem=1; a.load=a.loadDem=0.05; run(a,120);
  const b=set({}); run(b,10); for(const id in b.tankByp) b.tankByp[id]=true;
  b.scrammed=true; b.rodDem=1; b.load=b.loadDem=0.05; run(b,120);
  if(b.Tavg<=a.Tavg) bad(`emergency feedwater bypass did not run hotter (armed ${a.Tavg.toFixed(1)} K, bypassed ${b.Tavg.toFixed(1)} K)`);
  console.log(`  EMERG FEED: armed Tavg ${a.Tavg.toFixed(1)}K, bypassed Tavg ${b.Tavg.toFixed(1)}K after a trip`);
}
{ /* backup power is the only thing turning the pumps in a blackout. Bypassed,
     flow collapses to natural circulation and the protection system says so -
     the bypassed core ends up COLDER because the RPS shut it down.
     220 s, not 60: the default flow floor is lower now that it is read off
     pump capacity actually on the grid rather than a dropdown that used to
     default to "one spare" for free (commission(), step.js) - a plant with
     no spare pumps placed tolerates flow falling further before LOW FLOW is
     even armed, so on the true baseline the core has time to self-limit on
     feedback alone (power and fuel temperature both fall, DNBR stays healthy,
     nothing melts) before flow crosses that lower line. It still trips - on
     LOW DNBR once temperature and flow cross, same as the comment below
     always allowed for - just later. Measured directly before widening this:
     ~180 s to LOW DNBR, never melts, DNBR never drops below 1.5 on the way. */
  const a=set({bkp:2}); run(a,10); a.blackout=true; run(a,60);
  const b=set({bkp:2}); run(b,10); b.byp.bkp=true; b.blackout=true; run(b,220);
  if(a.scrammed) bad(`backup power armed still tripped in a blackout: ${a.trip}`);
  if(!b.scrammed) bad('backup power bypassed did not starve the loop; the plant rode the blackout out');
  /* the trip lands on LOW DNBR, not LOW FLOW: the pump slider is still at 100%,
     it is the supply behind it that is gone, and the fuel feels that first */
  if(!/LOW DNBR|LOW FLOW/.test(b.trip)) bad(`backup power bypassed tripped on "${b.trip}", expected a flow-starvation trip`);
  console.log(`  BACKUP: armed rides it out (Tf ${a.Tf.toFixed(0)}K), bypassed trips on "${b.trip}"`);
}
{ /* ══ A STATION BLACKOUT IS SURVIVED BY THE SUPPLY YOU BOUGHT, NOT BY THE
     ══ SIMULATION'S GOOD NATURE.
     THE SIM GIVES NO FREE HELP. What saves a plant here is a design decision -
     backup power, or generators hung high enough to thermosiphon - and never a
     floor the physics hands out to everybody. Natural circulation is solved off
     the plant's own geometry now; it used to be a fitted fraction of rated
     removal sitting beside the solve, which is exactly free help, and it meant
     all three BACKUP PWR settings rode a total blackout out indefinitely. The
     dial cost mass and bought only the trip it avoided.

     NOTHING NOTICED when that changed, which is the second reason this block
     exists. It is checked per setting now, so the next drift says which way it
     went.

     The bench's own text for NONE is "Lose main power and the coolant pumps
     stop dead. Only natural circulation remains", and a plant with no makeup
     and no power does damage its core. That is the promise being kept.

     If a plant should survive this, the lever is the ARRANGEMENT - raise the
     steam generators, which layoutMetrics().head measures and buoyH() actually
     solves. It is NOT BUOY_LIN or the enthalpy cap: those are one linearisation
     correction and one saturation limit, applied identically to every design,
     and neither hands a particular plant anything. Turning either into a
     survival dial would be putting the floor back under a different name.

     900 s of patience, offsite power cut once the plant has settled. Measured:
       NONE     melt at 302 s, VESSEL RUPTURE at 361 s, dmg 100
       BATTERY  survives, no damage, trips on LOW DNBR
       DIESEL   survives, no damage, never trips at all

     HOW it is lost, because the obvious guess is wrong and two attempts to
     break this check by flooring the flow proved it: buoyancy carries decay
     heat perfectly well. For 250 s DNBR CLIMBS, to 9.2, and fuel temperature
     falls to 604 K. What ends it is SUBCOOLING. Pressure decays with Tavg
     while the core's own rise grows as the flow drops (s.coreDT, step.js), the
     hot leg reaches saturation, the loop boils, DNBR collapses to 0.41 inside
     one sample, and the vessel bursts a minute later. A flow floor does not
     save it and should not be reached for; the thing that saves it is a supply
     that keeps a pump turning.
     Asserted as an ORDERING as well as three outcomes - whatever the numbers
     do, a bigger supply may never do worse than a smaller one. */
  const sbo = bkp => { const s=set({bkp}); run(s,60); s.blackout=true;
    let meltT=null;
    for(let i=0;i<50*900;i++){ M.step(0.02); if(s.melt&&meltT===null) meltT=s.t-60; }
    return {melt:s.melt, dmg:s.dmg, meltT, trip:s.trip, scrammed:s.scrammed}; };
  const none=sbo(0), batt=sbo(1), dies=sbo(2);
  if(!none.melt)
    bad(`no backup power rode a 900 s station blackout out undamaged (dmg=${none.dmg.toFixed(1)}) - the loop never lost subcooling, so the supply you buy costs mass and buys nothing`);
  if(batt.melt) bad(`a battery bank melted the core in a blackout at t=${batt.meltT&&batt.meltT.toFixed(0)}s - half pump flow is meant to be enough`);
  if(dies.melt) bad(`diesels melted the core in a blackout at t=${dies.meltT&&dies.meltT.toFixed(0)}s - full pump power is meant to be enough`);
  if(!(none.dmg > batt.dmg) || !(batt.dmg >= dies.dmg))
    bad(`a bigger supply did not do better: NONE ${none.dmg.toFixed(0)}% damage, BATTERY ${batt.dmg.toFixed(0)}%, DIESEL ${dies.dmg.toFixed(0)}%`);
  if(dies.scrammed) bad(`diesels still tripped the plant in a blackout: ${dies.trip}`);
  console.log(`  station blackout, 900 s: NONE melts at ${none.meltT===null?'-':none.meltT.toFixed(0)+'s'},`+
              ` BATTERY survives (${batt.dmg.toFixed(0)}% damage, "${batt.trip}"),`+
              ` DIESEL survives untripped`);
}
{ /* the bench sells diesels as full pump power, so a blackout on diesels must
     hold the flow the pumps had - above the floor of any pump set you bought.
     Redundancy is placed spares now, not a dial. */
  for(const spares of [0,1,2]){
    set({bkp:2});
    const added=[]; for(let i=0;i<spares;i++) added.push(M.placePart(n=>
      ({id:'pumpX'+n,name:'RCP SPARE',w:1,h:1,x:9+i,y:5,col:'#57d38c',grp:'loop0',tip:'t',loop:0})));
    M.commission(); const s=M.S(); run(s,10); s.blackout=true; run(s,60);
    if(s.scrammed) bad(`diesels fitted with ${spares} spare(s) still tripped in a blackout: ${s.trip} at flow ${(s.flow*100).toFixed(0)}%`);
    if(s.flow<0.95) bad(`diesels hold only ${(s.flow*100).toFixed(0)}% flow in a blackout, bench promised full pump power`);
    for(const p of added) M.removePart(p.id);
  }
  const s=set({bkp:1}); run(s,10); s.blackout=true; run(s,60);
  if(Math.abs(s.flow-0.5)>0.03) bad(`battery bank holds ${(s.flow*100).toFixed(0)}% flow in a blackout, bench promised half`);
  console.log(`  BACKUP: diesels hold full flow through a blackout, battery holds ${(s.flow*100).toFixed(0)}%`);
}

/* ══════════ RELIEF: THE VENT IS THE SOLVED EDGE FLOW, AND REDUNDANCY COSTS ══════════
   Stage 4. FIT.relief (pipenet.js) is a fitting whose g() is a live gate on
   S.reliefOpen/S.reliefBlocked now, the identical "tee" shape with a
   setpoint instead of a switch - so a SHUT relief valve is g<=0, never a row
   of the Laplacian, the same "shut is absent" identity every other shut edge
   already gets; an OPEN one genuinely enters the solve and genuinely moves
   netFlowK() by whatever it actually vents. ventK()/ventRefG()/
   RELIEF_REF_LEN are gone - there is no reference valve to judge a fitting's
   own branch against any more, because there is no second vent physics
   beside the network to keep in step with it. reliefRate() (pipenet.js) is
   the one reader of a fitting's own vent, in the same %-of-loop-inventory
   units invRate() already gives a break or an injection line, resolved off
   the identical solve netFlowK() runs. This block is the redundancy half:
   what changes when there is more than one relief path, and what happens
   when there is none. */
console.log('\n=== RELIEF: ONE PATH, THREE PATHS, NO PATH ===');
{ /* A SHUT relief valve is a removed edge, not a small one - netFlowK() must
     not move a hair for a fitting whose own g() is 0, the strongest
     statement available being exact equality against a plant with NO relief
     fitting at all, not a tolerance, because a vent that touched the
     Laplacian even by floating-point accident would still likely read
     "close". The valve is freshly commissioned and never lifted here - see
     the next block for what an OPEN one is allowed to move. */
  const withRelief=set({}); run(withRelief,5);
  M.D().fit={}; M.commission(); const noRelief=M.S(); run(noRelief,5);
  if(M.netFlowK(withRelief)!==M.netFlowK(noRelief))
    bad(`a shut relief fitting moved netFlowK: ${M.netFlowK(withRelief)} (with) vs ${M.netFlowK(noRelief)} (without) - it reached the Laplacian`);
  console.log(`  a SHUT relief fitting never moves netFlowK: ${(M.netFlowK(withRelief)*100).toFixed(1)}% with or without one fitted`);
}
{ /* the stock relief valve, isolated: armed, it lifts at 106%, reseats below
     101%, and vents a real, positive, solved rate once open - the same
     three facts the pre-Stage-4 PORV promised, now read off the fitting
     rather than a reference-valve ratio. set({}) first, or primaryRelief()
     would still be reading the empty D.fit the block above left behind. */
  const s=set({}); const fid=M.primaryRelief(); run(s,10); s.P=M.P().P0*1.10; run(s,1);
  if(!s.reliefOpen[fid]) bad('the stock relief fitting did not lift at 110% pressure');
  const rate=M.reliefRate(s,fid);
  if(!(rate>0)) bad(`the stock relief fitting is open but reliefRate is ${rate}, expected > 0`);
  console.log(`  one relief path: lifts at 110% (open=${s.reliefOpen[fid]}), vents ${rate.toFixed(4)} %/s of loop inventory`);
}
{ /* redundancy: two more relief valves, tapped onto the stock relief HEADER
     the way the design bench's own "ADD RELIEF VALVE HERE" does. Three taps
     that each roll their own die, p=0.18, over 200 forced lifts each -
     independent draws, so the OR of three is measured directly (count a
     trial "stuck" the moment any one of the three did) rather than derived
     from a single fitting's count, and checked against the closed form
     1-(1-0.18)^3 = 0.4486 with the same 3.3-sigma window the single-valve
     test above uses (n=200, p=0.4486: sigma=7.0, window ~67..113). */
  M.D().fit={};
  const f0=M.addFit('relief','hot:corer-sg0l',0.9,'relief:pzrt-reltkb',0.5,M.PIPE_BORE().relief);
  const f1=M.addFit('relief','cold:sg0b-pump0t',0.5,'relief:pzrt-reltkb',0.3,M.PIPE_BORE().relief);
  const f2=M.addFit('relief','cold:pump0b-coreb',0.5,'relief:pzrt-reltkb',0.7,M.PIPE_BORE().relief);
  M.commission(); const s=M.S(); s.byp.rps=true; run(s,5);
  const ids=[f0,f1,f2];
  let anyStuck=0;
  for(let i=0;i<200;i++){
    for(const id of ids){ s.reliefOpen[id]=false; s.reliefAuto[id]=false; s.reliefStuck[id]=false; }
    s.P=M.P().P0*1.10;
    M.step(0.02);
    if(ids.some(id=>s.reliefStuck[id])) anyStuck++;
  }
  const p1=M.DICE().porvStick.p, pOr=1-Math.pow(1-p1,3);
  const mean=200*pOr, sigma=Math.sqrt(200*pOr*(1-pOr)), lo=Math.round(mean-3.3*sigma), hi=Math.round(mean+3.3*sigma);
  if(anyStuck<lo||anyStuck>hi)
    bad(`3 relief paths: ${anyStuck} of 200 trials had one stick, expected ${lo}..${hi} (p=${pOr.toFixed(4)}, mean ${mean.toFixed(0)})`);
  console.log(`  three relief paths: ${anyStuck} of 200 trials stuck at least one valve, expected ${lo}..${hi} `+
              `(1-(1-${p1})^3=${pOr.toFixed(4)}, each path rolling its own die)`);
  M.D().fit={}; M.commission();
}
{ /* Stage 5a: the relief tank is a PLACED PART, never derived from D.fit's
     own content any more - clearing D.fit deletes the FITTING (the valve),
     not the tank it used to conjure. Buildable, not blocked either way:
     commission() must not throw with no relief fitting at all, a plant with
     no vent is a legal plant, just one where an overpressure ends at the
     vessel (see the pressure block, step.js) instead of a valve. */
  M.D().fit={};
  if(!M.LAY().parts.some(p=>p.id==='reltk'))
    bad('clearing D.fit removed the relief tank - it is a placed part now (Stage 5a), not derived from D.fit');
  let threw=false;
  try{ M.commission(); } catch(e){ threw=true; }
  if(threw) bad('a plant with no relief path refused to commission');
  else if(M.primaryRelief()) bad('primaryRelief() found one after every relief fitting was deleted');
  console.log('  no relief path: commissions anyway, P.fit carries no relief fitting, and the tank stays on the grid');
}
{ /* CHECKED (Stage 5a): a tank with no run to it has no vent - remove the
     header run itself (rather than the fitting), armed and open, and demand
     nothing reaches the tank: no fixed-node target for fitBKey() to resolve,
     so the branch falls back to venting straight to containment instead
     (netBuild()'s own contTarget fallback) - "vents somewhere" is not "vents
     into the tank it is drawn next to". */
  const s=set({}); const fid=M.primaryRelief();
  M.removeRun('relief'); M.commission();
  const s2=M.S(); s2.reliefOpen[fid]=true; s2.reliefBlocked[fid]=false;
  run(s2,5);
  if(M.tankLvl(s2,'reltk')>0)
    bad(`disconnecting the relief header still filled the tank: reltk level ${M.tankLvl(s2,'reltk')}`);
  if(!(M.reliefRate(s2,fid)>=0) || !isFinite(M.reliefRate(s2,fid)))
    bad(`disconnecting the relief header left reliefRate non-finite or negative: ${M.reliefRate(s2,fid)}`);
  console.log(`  a tank with no run to it never fills: reltk level stays ${M.tankLvl(s2,'reltk').toFixed(1)}% while the valve vents to containment instead`);
  M.D().run.relief={a:"pzr",af:null,b:"reltk",bf:null,k:"relief",bore:0.20}; M.commission();
}
{ /* ══ AN UNPLUMBED PRESSURIZER SETS NOTHING ══
     A vessel with no pipe to the loop has no steam bubble in the loop, so it
     cannot hold pressure. MEASURED BEFORE THE FIX, on this exact scenario:
     s.P sat at 15.521 MPa sixty seconds after the surge line was deleted -
     the plant ran on unchanged, which is what this exists to catch. The
     figure is recorded rather than re-injected because pzrLive() is a
     function of the network, not a flag a test can stand down.

     Off REACHABILITY, not off a D.run lookup, which the third case is what
     proves: the run is still declared and still drawn, and shutting the
     path is exactly as disconnected as deleting it. */
  const savedSurge=M.D().run.surge;
  set({}); M.commission();
  if(!M.pzrLive(M.P().net, M.S()))
    bad('the STOCK plant reads its pressurizer as unplumbed - pzrLive() is inverted or the datum face moved');
  const kIntact=M.netFlowK(M.S());

  delete M.D().run.surge; M.commission();
  if(M.pzrLive(M.P().net, M.S()))
    bad('the surge line was deleted and the pressurizer still reads plumbed');
  const sCut=M.S(); run(sCut,60);
  if(!(sCut.P < M.P().P0*0.5))
    bad(`surge line deleted and pressure held at ${sCut.P.toFixed(3)} MPa after 60 s (was 15.521 before this landed) - it must fall away`);
  const pCut=sCut.P;

  /* AND IT COMES BACK BIT-IDENTICAL. The whole risk of a new predicate in the
     tick is that it costs an intact plant a float; this is the check that says
     it did not. */
  M.D().run.surge=savedSurge; M.commission();
  const kBack=M.netFlowK(M.S());
  if(kBack!==kIntact)
    bad(`restoring the surge line did not restore netFlowK bit-identically: ${kIntact} -> ${kBack}`);
  const sBack=M.S(); run(sBack,60);
  if(!(Math.abs(sBack.P-M.P().P0) < 0.2))
    bad(`restoring the surge line left pressure at ${sBack.P.toFixed(3)} MPa, not back on programme`);
  console.log(`  surge line deleted: P ${pCut.toFixed(3)} MPa after 60 s (was 15.521 unfixed); restored: P ${sBack.P.toFixed(3)} MPa and netFlowK bit-identical at ${kBack}`);
}
{ /* the vent is the solved edge flow, read straight off reliefRate()
     (pipenet.js) - sever the fitting's own branch pipe (pipeExtraLen ->
     Infinity -> FIT.relief.g's own isFinite(len) gate -> 0, same idiom
     every other severed run uses, restated explicitly on this mode because
     it prices off bore alone and would otherwise never ask about length at
     all) and force a lift: no NaN in P, inv, or the fitting's own vent rate,
     whatever the network underneath is doing. Re-fit the stock relief
     afterward so no later case inherits an unrelieved plant. */
  const s=set({}); run(s,5);
  const fid=M.primaryRelief();
  s.dmgParts.push('pipe:xtie:'+fid);
  s.byp.rps=true; s.P=M.P().P0*1.20; run(s,20);
  const rate=M.reliefRate(s,fid);
  if(!isFinite(s.P)||!isFinite(s.inv)||!isFinite(rate))
    bad(`a severed relief branch produced a non-finite value: P=${s.P} inv=${s.inv} rate=${rate}`);
  if(rate!==0) bad(`a severed relief branch still vented at rate=${rate}, expected exactly 0`);
  console.log(`  a severed relief branch never produces NaN: rate=${rate}, P and inv stay finite (P=${s.P.toFixed(2)} MPa)`);
}
{ /* NEW: the tick's own vent (netOut.reliefBy, step.js) and reliefRate()'s
     off-tick reader (pipenet.js) are the SAME solve asked twice - bit for
     bit, not close, or the panel and the physics could quietly disagree the
     moment either one changed. */
  const s=set({}); const fid=M.primaryRelief(); run(s,10);
  s.reliefOpen[fid]=true; s.reliefBlocked[fid]=false;
  const outs={}; M.netFlowK(s,null,null,outs);
  const tickRate=Math.max(0, M.invRate((outs.reliefBy&&outs.reliefBy[fid])||0));
  const offTick=M.reliefRate(s,fid);
  if(Math.abs(tickRate-offTick)>1e-12)
    bad(`the tick's own vent (${tickRate}) and reliefRate() (${offTick}) disagree by more than 1e-12`);
  console.log(`  vent rate equals the solved edge flow to 1e-12: ${tickRate.toFixed(6)} %/s`);
}
{ /* NEW: a filling tank throttles the vent by its OWN gas ALONE - no second,
     hand-rolled back-pressure term beside the fixed-node pressure the
     Laplacian already solves against. Raise the relief tank's own level
     (its fixed pressure rises with it, RELTK_GAS) and demand the rate falls
     monotonically toward the same reference relief.P0-Pcont differential
     collapsing - never a discontinuity, never a rise. */
  const s=set({}); const fid=M.primaryRelief(); run(s,10);
  s.reliefOpen[fid]=true; s.reliefBlocked[fid]=false;
  const rateAt=lvl=>{ s.tank.reltk=lvl; const outs={}; M.netFlowK(s,null,null,outs);
    return Math.max(0, M.invRate((outs.reliefBy&&outs.reliefBy[fid])||0)); };
  const levels=[0,20,40,60,80,95], rates=levels.map(rateAt);
  let rose=false; for(let i=1;i<rates.length;i++) if(rates[i]>rates[i-1]+1e-12) rose=true;
  if(rose) bad(`a filling relief tank raised the vent rate somewhere in ${JSON.stringify(rates)}`);
  if(!(rates[0]>rates[rates.length-1])) bad('a full relief tank did not vent slower than an empty one');
  s.tank.reltk=0;
  console.log(`  a filling tank throttles the vent by its own gas alone: ${levels.map((l,i)=>l+'%='+rates[i].toFixed(3)).join(', ')}`);
}
{ /* NEW: venting to containment raises s.release and needs no part - a
     relief fitting whose header/tank never resolved (D.run.relief deleted)
     still vents, off pipenet.js's own containment fallback (a relief valve
     may never have nowhere to vent), straight into s.release rather than a
     tank that does not exist. */
  M.D().fit={}; const savedRelief=M.D().run.relief; delete M.D().run.relief;
  const fid=M.addFit('relief','hot:corer-sg0l',0.9,'relief:x',0.5);
  M.commission(); const s=M.S();
  if(M.P().net.fitTarget[fid]!==null)
    bad(`a relief fitting with no header resolved a tank target (${M.P().net.fitTarget[fid]}), expected null (containment)`);
  s.byp.rps=true; s.reliefOpen[fid]=true; s.reliefAuto[fid]=false; s.reliefBlocked[fid]=false;
  const lvl0=s.tank.reltk;
  run(s,5);
  if(!(s.release>0)) bad(`venting with no tank on the grid left s.release at ${s.release}, expected > 0`);
  if(s.tank.reltk!==lvl0)
    bad(`s.tank.reltk moved (${lvl0} -> ${s.tank.reltk}) venting to a plant with no relief tank part`);
  console.log(`  venting to containment with no tank raises s.release: ${s.release.toFixed(4)} after 5 s, needs no part`);
  M.D().fit={}; M.D().run.relief=savedRelief; M.commission();
}

console.log('\n=== A RELIEF VALVE CARRIES ITS OWN SETPOINTS AND ITS OWN ARM ===');
/* Three relief valves on the stock relief header, the same way the bench's own
   "ADD RELIEF VALVE HERE" taps one. Returns the ids in placement order. */
const threeReliefs=(a,b,c)=>{
  M.D().fit={};
  const f0=M.addFit('relief','hot:corer-sg0l',0.9,'relief:pzrt-reltkb',0.5,M.PIPE_BORE().relief,
                    a&&a[0],a&&a[1]);
  const f1=M.addFit('relief','cold:sg0b-pump0t',0.5,'relief:pzrt-reltkb',0.3,M.PIPE_BORE().relief,
                    b&&b[0],b&&b[1]);
  const f2=M.addFit('relief','cold:pump0b-coreb',0.5,'relief:pzrt-reltkb',0.7,M.PIPE_BORE().relief,
                    c&&c[0],c&&c[1]);
  M.commission();
  return [f0,f1,f2];
};
{ /* 1. THE FEATURE IS FREE. A fitting nobody dialled must lift and reseat at
     the identical pressures the single plant-wide constant always gave.
     Bit-equality, not a tolerance - that identity is the whole claim that no
     existing design moved. */
  const s=set({}); const fid=M.primaryRelief(), P0=M.P().P0;
  const r=M.reliefSet(fid);
  if(r.lift!==M.PORV_LIFT0) bad(`an undialled fitting's lift is ${r.lift}, not the default ${M.PORV_LIFT0}`);
  if(r.reseat!==M.PORV_RESEAT0) bad(`an undialled fitting's reseat is ${r.reseat}, not the default ${M.PORV_RESEAT0}`);
  /* And the same plant with the pair DIALLED to those defaults must fly bit
     for bit identically - a stronger statement than "the fields read right",
     because it covers every path the tick takes through them. */
  const fly=pair=>{
    M.D().fit={};
    const f=M.addFit('relief','hot:corer-sg0l',0.9,'relief:pzrt-reltkb',0.5,M.PIPE_BORE().relief,
                     pair&&pair[0],pair&&pair[1]);
    M.commission(); const t=M.S(); t.byp.rps=true; t.diceOff=true; run(t,5);
    const trace=[];
    for(let i=0;i<400;i++){ t.P=P0*(1.00+0.10*(i/399)); M.step(0.02);
      trace.push(t.P,t.inv,t.reliefOpen[f]?1:0); }
    return trace;
  };
  const a=fly(null), b=fly([M.PORV_LIFT0,M.PORV_RESEAT0]);
  const diff=a.findIndex((v,i)=>v!==b[i]);
  if(diff>=0) bad(`an undialled valve and one dialled to the defaults diverged at sample ${diff}: ${a[diff]} vs ${b[diff]}`);
  console.log(`  an undialled fitting is the old PORV exactly: lift=${r.lift} reseat=${r.reseat}, `+
              `and ${a.length} samples of a forced pressure ramp are identical bit for bit to a valve dialled to those same defaults`);
}
{ /* 2. EACH VALVE LIFTS AT ITS OWN SETPOINT. Two valves, different lifts:
     raise pressure between the two setpoints and exactly the lower one opens.
     This is the failure the single PORV_LIFT constant made impossible to see. */
  const [lo,hi]=threeReliefs([1.04,1.01],[1.12,1.06],[1.18,1.10]);
  const s=M.S(); s.byp.rps=true; run(s,5);
  const P0=M.P().P0;
  s.P=P0*1.08; M.step(0.02);
  if(!s.reliefOpen[lo]) bad('the 1.04 valve did not lift at 108% pressure');
  if(s.reliefOpen[hi]) bad('the 1.12 valve lifted at 108% pressure - it read another valve\'s setpoint');
  console.log(`  two setpoints, one pressure: at 108% the 1.04 valve is ${s.reliefOpen[lo]?'OPEN':'shut'} `+
              `and the 1.12 valve is ${s.reliefOpen[hi]?'OPEN':'shut'}`);
}
{ /* 3. ONE VALVE'S ARM IS ITS OWN. Bypass one of two identical valves, drive an
     overpressure, and exactly one opens - and the plant still vents. This is
     the entire point of moving arming off the plant-wide switch. */
  const [a,b]=threeReliefs([1.06,1.01],[1.06,1.01],[1.06,1.01]);
  const s=M.S(); s.byp.rps=true; run(s,5);
  M.act('porvByp',a);
  if(!s.porvByp[a]) bad('act(porvByp) did not bypass the valve it named');
  if(s.porvByp[b]) bad('bypassing one valve bypassed another');
  if(M.porvLive(a)) bad('porvLive() is true for a bypassed valve');
  const inv0=s.inv;
  s.P=M.P().P0*1.10; run(s,2);
  if(s.reliefOpen[a]) bad('a bypassed valve lifted anyway');
  if(!s.reliefOpen[b]) bad('bypassing one valve stopped its neighbour lifting');
  if(!(s.inv<inv0)) bad('one valve bypassed and the plant vented nothing at all');
  console.log(`  one valve bypassed, its neighbour armed: bypassed=${s.reliefOpen[a]?'OPEN':'shut'} `+
              `armed=${s.reliefOpen[b]?'OPEN':'shut'}, inventory still fell ${(inv0-s.inv).toFixed(2)}%`);
}
{ /* 4. THE MASTER STILL MEANS WHAT IT MEANT. act('byp','porv') is the signature
     every tape written before per-valve arming carries. It must still defeat
     EVERY valve, and arming it again must leave none of them individually
     bypassed - the master and the individuals can never disagree. */
  const ids=threeReliefs();
  const s=M.S(); s.byp.rps=true; run(s,5);
  M.act('byp','porv');
  if(!s.byp.porv) bad('act(byp,porv) did not set the master');
  if(!ids.every(f=>s.porvByp[f])) bad('the master bypass left a valve armed');
  if(ids.some(f=>M.porvLive(f))) bad('porvLive() is true for a valve under a master bypass');
  s.P=M.P().P0*1.20; run(s,2);
  if(ids.some(f=>s.reliefOpen[f])) bad('a valve lifted under a master bypass');
  M.act('byp','porv');
  if(ids.some(f=>s.porvByp[f])) bad('re-arming the master left a valve individually bypassed');
  console.log('  act(byp,porv) bypasses all three valves and nothing lifts at 120%; re-arming clears all three');
}
{ /* 5. THE DEADBAND IS REAL, AND IT IS A NUMBER. A wide band lifts once and
     clears the transient; a narrow one cycles. Counting the cycles is the check
     - "it cannot chatter" is an assertion, a cycle count is a measurement. The
     valve is walked through the same shape of pressure swing both times; only
     the width of its own band differs. A stuck valve is unstuck by hand, or the
     die decides the count instead of the deadband. */
  const cycles=(lift,reseat)=>{
    M.D().fit={};
    const f=M.addFit('relief','hot:corer-sg0l',0.9,'relief:pzrt-reltkb',0.5,M.PIPE_BORE().relief,lift,reseat);
    M.commission(); const s=M.S(); s.byp.rps=true; s.diceOff=true; run(s,5);
    const P0=M.P().P0; let n=0, was=false;
    /* ONE pressure swing, identical for both valves: up to 107% and back to
       103%. 103% is above the wide valve's reseat point and below the narrow
       one's, so the swing itself decides nothing - only the width of the band
       does. Held five ticks at each end so the reseat has somewhere to happen. */
    for(let i=0;i<300;i++){
      s.P = P0*(Math.floor(i/5)%2 ? 1.03 : 1.07);
      M.step(0.02);
      if(s.reliefOpen[f] && !was) n++;
      was=s.reliefOpen[f];
    }
    return n;
  };
  const wide=cycles(1.06,1.01), narrow=cycles(1.06,1.055);
  if(wide!==1) bad(`a 0.05 deadband lifted ${wide} times through one pressure swing, expected exactly 1`);
  if(!(narrow>wide)) bad(`a 0.005 deadband cycled ${narrow} times and a 0.05 deadband ${wide} - the band buys nothing`);
  console.log(`  the deadband is measured, not asserted: through the same 103-107% swing a 0.05 band lifts ${wide} time(s), a 0.005 band ${narrow}`);
}
{ /* 6. THE RANGE FORBIDS INVERSION. A valve that reseats at or above its own
     lift point has no shut state at all, so the bench must make that pair
     unreachable - dragged from either end, it comes back ordered. And if a
     design is forced inverted straight onto D, the tick still terminates
     rather than chattering forever. */
  M.D().fit={};
  const f=M.addFit('relief','hot:corer-sg0l',0.9,'relief:pzrt-reltkb',0.5,M.PIPE_BORE().relief,1.10,1.05);
  M.commission();
  const B=M.paramsForFit(f), row=t=>B.find(b=>b.title===t);
  row('RESEAT PRESSURE').key.set(1.19);          // drag reseat far above lift
  if(!(M.reliefSet(f).reseat < M.reliefSet(f).lift))
    bad(`the bench let reseat (${M.reliefSet(f).reseat}) reach lift (${M.reliefSet(f).lift})`);
  row('LIFT PRESSURE').key.set(1.02);            // now drag lift down under reseat
  if(!(M.reliefSet(f).reseat < M.reliefSet(f).lift))
    bad(`dragging lift below reseat left reseat (${M.reliefSet(f).reseat}) at or above lift (${M.reliefSet(f).lift})`);
  const dialled=`lift=${M.reliefSet(f).lift} reseat=${M.reliefSet(f).reseat}`;
  M.D().fit[f].lift=1.02; M.D().fit[f].reseat=1.15;   // forced, bypassing the bench entirely
  M.commission();
  const s=M.S(); s.byp.rps=true; run(s,5); s.P=M.P().P0*1.10; run(s,5);
  if(!isFinite(s.P)||!isFinite(s.inv)) bad('an inverted setpoint pair produced a non-finite P or inv');
  console.log(`  the bench cannot invert the pair (${dialled}); forced inverted onto D the tick still terminates, P=${s.P.toFixed(2)} MPa`);
}
{ /* 7. BOTH NEW ACTS REFUSE AN ID THIS DESIGN NEVER HAD - the same refusal
     ACT.junc and ACT.valveDem carry, for the same reason: a phantom key on S is
     snapshotted, restored and compared like a real one. Scoped by MODE too, so
     a tee's id cannot arm a relief valve that does not exist. */
  const [f0]=threeReliefs();
  const tee=M.addFit('tee','cold:sg1b-pump1t',0.5,'cold:sg2b-pump2t',0.5);
  M.commission(); const s=M.S();
  M.act('porvByp','doesNotExist');
  if('doesNotExist' in s.porvByp) bad('act(porvByp,...) put a phantom key on S for an id this design never had');
  M.act('porvBlockOf','doesNotExist');
  if('doesNotExist' in s.reliefBlocked) bad('act(porvBlockOf,...) put a phantom key on S for an id this design never had');
  M.act('porvByp',tee); M.act('porvBlockOf',tee);
  if((tee in s.porvByp)||(tee in s.reliefBlocked)) bad('a tee id reached a relief-only act');
  M.act('porvBlockOf',f0);
  if(!s.reliefBlocked[f0]) bad('act(porvBlockOf) did not work the valve it named');
  console.log('  act() refuses an unknown id and a wrong-mode id, on both porvByp and porvBlockOf');
}
{ /* 8 + 11. THREE VALVES, THREE PANELS. This is the failure the pressurizer
     panel had: six relief rows that every one of them resolved through
     primaryRelief(), so valve two and valve three were described by valve one's
     numbers. Each panel must carry its OWN lift, its OWN margin and its OWN
     arm - and the margin the panel prints must be the tick's own
     P0*reliefSet(fid).lift - s.P, never a second copy of the arithmetic. */
  const ids=threeReliefs([1.04,1.01],[1.12,1.06],[1.18,1.10]);
  const s=M.S(); s.byp.rps=true; run(s,5);
  const P0=M.P().P0;
  s.P=P0*1.08; M.step(0.02);
  M.act('porvByp',ids[2]);
  const seen=[];
  for(const fid of ids){
    const rows=M.readoutsForFit(fid,s), get=k=>{ const r=rows.find(q=>q[0]===k); return r&&r[1]; };
    const st=M.reliefSet(fid);
    const wantLift=(P0*st.lift).toFixed(2)+' MPa';
    if(get('LIFT SETPOINT')!==wantLift)
      bad(`${fid}: panel says LIFT SETPOINT ${get('LIFT SETPOINT')}, the tick lifts at ${wantLift}`);
    const wantMarg=(P0*st.lift-s.P).toFixed(2)+' MPa';
    if(get('MARGIN TO LIFT')!==wantMarg)
      bad(`${fid}: panel says MARGIN TO LIFT ${get('MARGIN TO LIFT')}, the tick's own margin is ${wantMarg}`);
    if(get('RESEAT SETPOINT')!==(P0*st.reseat).toFixed(2)+' MPa')
      bad(`${fid}: panel says RESEAT SETPOINT ${get('RESEAT SETPOINT')}, expected ${(P0*st.reseat).toFixed(2)} MPa`);
    seen.push(`${fid} ${get('LIFT SETPOINT')} ${get('PORV')} ${get('AUTO RELIEF')}`);
  }
  if(new Set(seen.map(t=>t.split(' ')[1])).size!==3)
    bad('three valves with three different setpoints produced fewer than three distinct panel readings');
  if(M.readoutsForFit(ids[2],s).find(r=>r[0]==='AUTO RELIEF')[1]!=='bypassed')
    bad('a bypassed valve own panel did not say so');
  console.log('  three valves, three panels: '+seen.join(' | '));
  M.D().fit={}; M.commission();
}

/* ══════════ HPI: INJECTION IS A FUNCTION OF ITS OWN LINE (Stage 5b) ══════════
   tankG() is gone. The tank-edge branch (netBuild(), pipenet.js) prices the
   HPI line off injResist(bore, L+pipeExtraLen) now, the same
   bore-and-length shape every other run in this graph already carries -
   never a conductance picked so flow equalled a "rated delivery" the pipe
   never entered. TANK.hpi.rate() stops being an input and becomes what the
   bench reads back off the model this section pins. */
console.log('\n=== HPI: INJECTION IS A FUNCTION OF ITS OWN LINE ===');
{ /* injRate at three pressure points - re-pinned, not re-derived: the old
     tankG() figures (0, 0.44, 1.51) priced a rating, never a pipe, and this
     is what the pipe itself now gives. */
  const s=set({}); s.tankOpen.hpi=true;
  const at=P0=>{ s.P=P0; s.pCore=P0; const outs={}; M.netFlowK(s,null,null,outs);
    return M.invRate((outs.qTankBy&&outs.qTankBy.hpi)||0); };
  const full=at(M.P().P0), half=at(M.P().P0*0.5), dep=at(M.P().Pcont+0.5);
  if(full!==0) bad(`full pressure: injRate is ${full}, expected exactly 0 (the check valve shut)`);
  if(!(half>0)) bad(`half pressure: injRate is ${half}, expected > 0`);
  if(!(dep>half)) bad(`depressurised injRate (${dep}) is not greater than half-pressure's (${half})`);
  console.log(`  s.injRate: full pressure=0, half pressure=${half.toFixed(4)}, depressurised=${dep.toFixed(4)} %/s`);
}
{ /* two plants differing ONLY in the HPI line's own length inject at
     DIFFERENT rates - the measured defect this stage closes (moved +5 grid
     cells, previously bit-identical to the last bit). Moved to the nearest
     free cell in column x rather than a fixed offset, because groupFits()
     may refuse the literal +5 depending on what else is on the grid. */
  const s=set({}); s.tankOpen.hpi=true; s.P=M.P().Pcont+0.5; s.pCore=s.P;
  const rateNow=()=>{ const outs={}; M.netFlowK(s,null,null,outs); return M.invRate((outs.qTankBy&&outs.qTankBy.hpi)||0); };
  const home=rateNow();
  const p=M.LAY().parts.find(q=>q.id==='hpi'); const hx=p.x, hy=p.y;
  let moved=false;
  for(let ny=0; ny<9 && !moved; ny++){ if(ny!==hy && M.moveTo(p,hx,ny)) moved=true; }
  if(!moved) bad('could not move the HPI tank anywhere to test line-length sensitivity');
  M.commission();
  const away=rateNow();
  M.moveTo(p,hx,hy); M.commission();
  if(moved && away===home)
    bad(`moving the HPI tank left injRate bit-identical (${home}) - the line still buys nothing`);
  console.log(`  HPI tank moved (${hx},${hy}) -> (${hx},${moved?'elsewhere':hy}): injRate ${home.toFixed(6)} -> ${away.toFixed(6)}`);
}
{ /* severing the injection line is ADDITIVE (pipeExtraLen folded into the
     SAME injResist(bore,L+extra) call every undamaged run uses) rather than
     the old boolean "!pipeExtraLen(...) ? tankG : 0" gate - and the end
     state is identical either way: exactly zero. Read the EDGE'S OWN
     conductance directly, keyed "hpi:hpib-coreb", not qTankBy: severing this
     run ALSO opens a break at its own ends (the same s.dmgParts entry drives
     both - Stage 1's "no second signal" rule), and that break's own edges
     carry the DIFFERENT key "break:hpi:hpib-coreb" but still touch the same
     tank node (hpib) qTankBy sums flow over - conflating "the injection edge
     itself still conducts" with "the severed stub is now correctly spilling
     to containment", a different, already-covered fact. */
  const s=set({}); s.tankOpen.hpi=true; s.P=M.P().Pcont+0.5; s.pCore=s.P;
  M.netFlowK(s);
  const key='hpi:hpib-coreb';
  const edgeG=()=>{ const ed=M.P().net.edges.find(e=>e.key===key); return ed?(typeof ed.g==='function'?ed.g(s):ed.g):null; };
  const before=edgeG();
  s.dmgParts.push('pipe:'+key);
  const after=edgeG();
  const kflow=M.netFlowK(s);
  if(before===null||after===null) bad(`the HPI tank-edge (key ${key}) was not found in P.net.edges`);
  if(!isFinite(kflow)||!isFinite(after)) bad(`a severed HPI line produced a non-finite value: netFlowK=${kflow} g=${after}`);
  if(!(before>0)) bad('nothing to sever: the injection edge already conducted 0 before combat damage');
  if(after!==0) bad(`a severed HPI line's own edge still conducts at g=${after}, expected exactly 0`);
  s.dmgParts=[];
  console.log(`  severing the HPI line: edge conductance g ${before.toFixed(4)} -> ${after}, never NaN`);
}

/* ══════════ JUNCTIONS: FLOW IS PER LOOP NOW ══════════
   Two loops with an open junction between them are one shared-flow group, and
   a pump still turning can push into its neighbour's loop as well. With
   nothing placed - which is every plant in this file above, and every plant
   the sweep built - each group is a single loop and netFlowK() (the solved
   network, pipenet.js) is exactly that loop's own share of P.netRef; with
   junctions PLACED but SHUT, every group is STILL a single loop (a shut
   junction is a removed edge, not a small one - see netBuild()), so the
   identity is the same, just no longer the OLD (loops-lost)/loops formula:
   the loops are not the same length, so each one's own share is weighted by
   its own reference (P.netRefByLoop), not a flat 1/n. That per-loop identity
   is asserted directly below, against the implementation's own numbers
   rather than a formula that stopped applying the day the network went
   in - and it is asserted with junctions placed anywhere a real one can go
   now, not read off a fixed three-slot table. */
console.log('\n=== JUNCTIONS ===');
/* Ties every adjacent pair with a real junction, the same chain the old
   fixed xtie0/1/2 slots always offered - four loops, three junctions, each
   tap point found the exact way the right-click menu finds one. No spare
   pumps here - see the block below for why that is its own case. */
const tieChain=()=>{
  set({loops:4});
  const tap=k=>{ const r=M.pipeNetwork().find(x=>x.key&&x.key.startsWith(k)); return [r.key,0]; };
  const ids=[0,1,2].map(i=>M.addFit('tee',...tap('cold:sg'+i),...tap('cold:sg'+(i+1))));
  M.commission();               // re-bakes P.fit with the three junctions in it
  return {s:M.S(), ids};
};
{ /* Shut, a junction is a removed edge, so netFlowK() must fall back to what
     each surviving loop's own P.netRefByloop contributes and nothing else.
     Last-bit tolerance rather than strict equality, for one stated reason and
     no other: the surge line lands on hot leg 0 where it is drawn now, so
     that run is SPLIT into two series segments. Series resistance sums to
     exactly the unsplit run in algebra (K*L1 + K*L2 == K*L, resist()'s own
     identity) and to about 4e-15 off it in floating point, so every case
     naming loop 0 carries that one extra rounding and no case naming any
     other loop does. Measured: pump0+pump3 lost reads 0.47912978143962276
     against 0.47912978143962653. The claim is unchanged - it is still each
     surviving loop's OWN reference share, never a flat 1/n and never an
     approximation of a different quantity. No spares fitted in this case on
     purpose - loopPumpCap() would then sum real hardware above 1.0 per loop,
     which is its own case below. */
  const {s,ids}=tieChain();
  const ref=M.P().netRefByLoop, tot=M.P().netRef;
  const expect=dmg=>{ let sum=0; for(let i=0;i<4;i++) if(!dmg.includes('pump'+i)) sum+=ref[i]; return sum/tot; };
  let drift=0;
  for(const dmg of [[],['pump1'],['pump0','pump3'],['pump0','pump1','pump2','pump3']]){
    s.dmgParts=dmg.slice();
    if(Math.abs(M.netFlowK(s)-expect(dmg)) > 1e-12) drift++;
  }
  if(drift) bad(`${drift} of 4 damage cases: a shut junction no longer gives exactly its surviving loops' own reference share`);
  else console.log('  shut junctions give exactly the surviving loops\' own reference share, 0..4 pumps lost');
  s.dmgParts=[];
  if(M.netFlowK(s)!==1) bad('a shut junction changed the flow of a plant with every pump running');
  s.juncOpen[ids[0]]=true; s.juncOpen[ids[1]]=true; s.juncOpen[ids[2]]=true;
  if(M.netFlowK(s)!==1) bad('opening a junction between healthy loops manufactured flow that was not there shut');
}
/* A spare pump only pools capacity once it is genuinely PLUMBED - Stage
   3a-ii's own fix: loopPumpCap() used to sum p.loop, a field set by
   nearestLoop()'s proximity guess (or, in this very file, a bare `loop:i`
   literal on an otherwise unconnected part), so a spare with ZERO edges
   reaching it still doubled the ceiling. It reads the RUN GRAPH now
   (loopOf(), layout.js) - a spare has to be wired into its loop with real
   D.run entries (addRun(), the same primitive CONNECT uses) or it counts
   for nothing. plumbedSpare() below does that: ports into the target
   loop's own generator and back to the core, paralleling the stock cold
   leg - exactly what a player's CONNECT gesture would draw. */
const plumbedSpare=(loopIdx,x,y)=>{
  const p=M.placePart(n=>({id:'pumpX'+n,name:'RCP SPARE',w:1,h:1,x,y,col:'#57d38c',tip:'t',role:'pump'}));
  const runs=[M.addRun(p.id,'t','sg'+loopIdx,'b'), M.addRun(p.id,'b','core','b')];
  return {part:p, runs};
};
const removePlumbedSpare=sp=>{ M.removePart(sp.part.id); for(const r of sp.runs) M.removeRun(r); };
{ /* ── A JUNCTION ONLY HAS SOMETHING TO PROVE ONCE THERE IS SOMETHING TO SHARE ──
     loopPumpCap() sums real, PLUMBED hardware - a pump at default size
     delivers exactly 1.0, its own loop's own ceiling, so a lone loop's own
     group ceiling never actually clamps anything when every pump on it is
     bare and default-sized. That is not a bug, it is "nobody gets flow for
     free" (netFlowK's own comment, pipenet.js) - a junction is a path for
     capacity that already exists to travel, not a source of capacity on its
     own.
     So this case places two spares deliberately unequal, to keep three
     figures strictly increasing rather than two of them landing on the same
     ceiling: a SMALL one (sized to 0, capacity 0.7) on loop 1, reachable the
     moment the single junction j0 opens, and a FULL one (default size,
     capacity 1.0) on loop 3, reachable only once the whole chain is open -
     which is also what actually exercises the graph-connectivity
     generalisation loopFlowK() used to offer. The figures below are the
     network's own - they are not the old formula's 75.0% / 92.5% / 100.0%,
     because the loops are not the same length (see pipenet.js) and pump0's
     own loop is not an average loop; only the ordering (each rung strictly
     ahead of the last) is the claim. */
  set({loops:4});
  const tap=k=>{ const r=M.pipeNetwork().find(x=>x.key&&x.key.startsWith(k)); return [r.key,0]; };
  const ids=[0,1,2].map(i=>M.addFit('tee',...tap('cold:sg'+i),...tap('cold:sg'+(i+1))));
  const sp1=plumbedSpare(1,9,5); M.D().pumpSize[sp1.part.id]=0;
  const sp3=plumbedSpare(3,13,5);
  M.commission(); const s=M.S();
  s.dmgParts=['pump0'];
  const alone=M.netFlowK(s);
  s.juncOpen[ids[0]]=true; const one=M.netFlowK(s);
  s.juncOpen[ids[1]]=true; s.juncOpen[ids[2]]=true; const all=M.netFlowK(s);
  if(!(one>alone)) bad('opening the junction beside a dead pump bought no flow at all');
  if(!(all>one))   bad('opening the rest of the chain bought nothing over one junction');
  console.log(`  4 loops, RCP 1 lost, 2 spares placed: shut ${(alone*100).toFixed(1)}%`+
              ` -> one junction ${(one*100).toFixed(1)}% -> chain ${(all*100).toFixed(1)}%`);
  removePlumbedSpare(sp1); removePlumbedSpare(sp3);
}
{ /* ── AND IT REACHES THE FUEL, NOT JUST THE ARITHMETIC ──
     What a junction buys is POWER, and deliberately not DNBR. A plant that has
     lost a pump is flow-limited: heat removal balances heat lower down, so
     power falls to meet it and margin goes UP while output goes down. Give the
     flow back and the reactor carries the load again at the same fuel
     temperature, with DNBR settling back toward where it started - so asserting
     that a junction buys margin would be asserting the plant backwards.
     A spare on loop 1 (default size, reachable via j0 alone) is enough for
     this one - it only needs "open" to differ from "shut", not a third rung. */
  const hurt=open=>{
    const {ids}=tieChain();
    const sp=plumbedSpare(1,9,5);
    M.commission(); const s=M.S(); run(s,20);
    if(open) s.juncOpen[ids[0]]=true;
    s.dmgParts.push('pump0'); run(s,90);
    removePlumbedSpare(sp);
    return s;
  };
  const shut=hurt(false), open=hurt(true);
  if(!(open.n>shut.n))
    bad(`an open junction handed back no power with a pump down: ${(open.n*100).toFixed(1)}% vs ${(shut.n*100).toFixed(1)}%`);
  if(!(open.hotFlow>shut.hotFlow))
    bad('an open junction did not reach the hot channel');
  console.log(`  4 loops, RCP 1 lost: tie shut n=${(shut.n*100).toFixed(1)}%`+
              ` hot channel ${(shut.hotFlow*100).toFixed(0)}% DNBR ${shut.dnbr.toFixed(2)}`+
              ` -> chain open n=${(open.n*100).toFixed(1)}%`+
              ` hot channel ${(open.hotFlow*100).toFixed(0)}% DNBR ${open.dnbr.toFixed(2)}`);
}

/* ══════════ A PLACED PART CONTRIBUTES NOTHING UNTIL IT IS PLUMBED (Stage 3a-ii) ══════════
   loopOf()/loopPumpCap() (layout.js) read the RUN GRAPH now, never a stored
   p.loop - nearestLoop() (design-bench.js) was a Euclidean-distance guess
   and is gone outright. This block proves both halves: a spare with no run
   reaching it buys NOTHING (not even a stale `loop` field on the object can
   fool it), and the same spare wired in with real D.run entries (addRun(),
   the CONNECT primitive) DOES pool capacity - pinned as the two numbers the
   ceiling actually produces, not one clamp asserted by inspection. */
console.log('\n=== A PLACED PART CONTRIBUTES NOTHING UNTIL IT IS PLUMBED ===');
{
  set({loops:1}); M.commission();
  const baseline=M.netFlowK(M.S()), baseCap=M.loopPumpCap(0,[]);
  // an UNCONNECTED spare - no D.run entry names it at all, and it still
  // carries a `loop` field, the exact shape nearestLoop() used to hand it,
  // to prove that field is dead rather than merely absent from this case
  const sp=M.placePart(n=>({id:'pumpX'+n,name:'RCP SPARE',w:1,h:1,x:9,y:5,
    col:'#57d38c',tip:'t',role:'pump',loop:0}));
  M.commission();
  const li=M.loopOf(sp.id), capUnplumbed=M.loopPumpCap(0,[]), flowUnplumbed=M.netFlowK(M.S());
  if(li!==null) bad(`an unrouted spare pump reports loop ${li}, expected null (not plumbed, not a member)`);
  if(capUnplumbed!==baseCap) bad(`an unrouted spare pump changed loopPumpCap(0): ${baseCap} -> ${capUnplumbed}`);
  if(flowUnplumbed!==baseline) bad(`an unrouted spare pump changed netFlowK: ${baseline} -> ${flowUnplumbed}`);
  console.log(`  unrouted spare (stale loop:0 field): loopOf=${li}, loopPumpCap(0)=${capUnplumbed} (was ${baseCap}), netFlowK=${flowUnplumbed} (was ${baseline})`);

  // NOW plumb it - two addRun() calls, the identical primitive CONNECT
  // drives, paralleling the stock loop's own core<->pump<->generator path
  const r1=M.addRun(sp.id,'t','core','b'), r2=M.addRun(sp.id,'b','sg0','b');
  M.commission();
  const liOn=M.loopOf(sp.id), capOn=M.loopPumpCap(0,[]);
  if(liOn!==0) bad(`a plumbed spare on loop 0's own generator reports loop ${liOn}, expected 0`);
  if(!(capOn>baseCap)) bad(`a plumbed spare did not raise loopPumpCap(0): ${baseCap} -> ${capOn}`);
  const both=M.netFlowK(M.S());
  const sLost=M.S(); sLost.dmgParts=['pump0'];
  const withSpareLost=M.netFlowK(sLost);
  M.removeRun(r1); M.removeRun(r2); M.removePart(sp.id); M.commission();
  const sLostNoSpare=M.S(); sLostNoSpare.dmgParts=['pump0'];
  const noSpareLost=M.netFlowK(sLostNoSpare);
  /* THE TWO NUMBERS. Both pumps running: the group ceiling (min(groupSize,
     capacity)/groupSize, netFlowK's own comment) still bounds the total at
     the loop's own reference, so a second pump buys the plant nothing while
     the first is healthy - exactly bit-identical, not merely "close". Lose
     the ORIGINAL pump: with the spare plumbed in, the loop's own reference
     is still fully covered (0..4 pumps lost, both members of one loop,
     capacity >= groupSize=1 either way); with no spare, a 1-loop plant that
     loses its only pump is the "every pump lost" case netFlowK pins at
     exactly 0. */
  if(both!==baseline) bad(`a plumbed spare moved netFlowK with both pumps healthy: ${baseline} (1) vs ${both} (2) - redundancy is meant to buy survival, not flow`);
  if(withSpareLost<baseline-1e-9) bad(`losing the original pump did not hand the loop back with a spare plumbed in: ${withSpareLost} (want ${baseline})`);
  if(noSpareLost!==0) bad(`losing the only pump on a 1-loop plant with no spare gave ${noSpareLost}, expected exactly 0`);
  console.log(`  plumbed spare: loopPumpCap(0) ${baseCap} -> ${capOn}, netFlowK both running ${(both*100).toFixed(1)}% (want ${(baseline*100).toFixed(1)}%, unchanged)`);
  console.log(`  original pump lost: ${(noSpareLost*100).toFixed(1)}% with no spare -> ${(withSpareLost*100).toFixed(1)}% with the spare plumbed in (the loop bought back)`);
}
{ /* a port already carrying its capacity refuses a second pipe - ROLE.ports
     plus portRoom()'s one documented spare (PORT_SPARE, layout.js), which is
     the same ceiling the bench's own port handles read.

     THE CONDITION IS BUILT, NOT ASSUMED. This used to lean on the stock plant
     happening to spend the pressurizer's whole "*":2 budget on surge + relief,
     so it needed nothing built. That coincidence is gone the moment a design
     is allowed to be added to at all, and a check resting on a coincidence
     reports on the coincidence. Runs are added to the pressurizer until it
     reads full instead - which asserts the strictly stronger thing, that the
     ceiling is FINITE and enforced at all - and one is then taken away again,
     which is what proves the refusal tracks OCCUPANCY rather than "a
     pressurizer isn't a pump" or any other judgement about what the part is
     for: the same part, the same role, answering differently only because the
     count changed. */
  set({loops:1}); M.commission();
  const pzr=M.LAY().parts.find(q=>q.id==='pzr');
  const free=p=>Object.values(M.portRoom(p)).some(v=>v);
  const added=[];
  const CAP_SANE=12;                          // a ceiling that never arrives is the failure, not a hang
  while(free(pzr) && added.length<CAP_SANE){
    added.push(M.addRun('pzr','t','core','t'));
    M.commission();
  }
  const fullRoom=M.portRoom(pzr);
  if(Object.values(fullRoom).some(v=>v))
    bad(`pzr ports still read free after ${added.length} extra run(s): ${JSON.stringify(fullRoom)} - the ROLE.ports ceiling is not enforced at all`);
  M.removeRun(added.pop()); M.commission();
  const openRoom=M.portRoom(pzr);
  const anyFreeOpen=Object.values(openRoom).some(v=>v);
  for(const rid of added) M.removeRun(rid);
  M.commission();
  if(!anyFreeOpen) bad(`freeing one of pzr's "*" slots still reads full: ${JSON.stringify(openRoom)}`);
  console.log(`  pzr ports: full after ${added.length+1} run(s) land there (${JSON.stringify(fullRoom)}), free the moment one is removed (${JSON.stringify(openRoom)}) - occupancy, not purpose`);
}

/* ══════════ A STEAM GENERATOR IS A PLACED PART, D.loops IS GONE ══════════
   The finding this stage closes: a COUNT standing in for geometry the solve
   already has. D.loops is deleted as an input entirely - no formula in
   src/ may read a count of anything as a proxy for a solved quantity (DNBR,
   graceK), and every generator now carries its own SGT[D.sg].mass rather
   than one flat lump for the whole plant. */
console.log('\n=== A STEAM GENERATOR IS A PLACED PART, D.loops IS GONE ===');
{
  set({loops:1}); M.commission();
  if('loops' in M.D()) bad('D.loops still exists as a key on D - it must be deleted as an input');
  else console.log('  D.loops is not a key of D');

  /* SOURCE SCAN, seen to fail: the old correlations were shaped
     "(1+.NN*(count-2))" wherever `count` was a stored knob, never a solved
     quantity. Proven red by testing the regex against a synthetic re-
     injection of the exact deleted expression before trusting it clean on
     the real bundle. */
  const src=require('./bundle').bundle();
  const countProxyRe=/\(\s*1\s*\+\s*\.\d+\s*\*\s*\(\s*[A-Za-z_][A-Za-z0-9_.()]*\s*-\s*2\s*\)\s*\)/;
  if(!countProxyRe.test('dnbr=a.dnbr*(1+.05*(D.loops-2));'))
    bad('countProxyRe does not even catch the exact expression it exists to ban - the check is not testing what it claims to');
  else console.log('  (sentinel) the re-injected DNBR/graceK loop-count correlation is caught by the scan');
  const hit=countProxyRe.exec(src);
  if(hit) bad(`a count-as-proxy-for-a-solved-quantity expression survives in src/: "${hit[0]}"`);
  else console.log('  no formula in src/ reads a count of anything as a proxy for a solved quantity');

  /* MASS CARRIES ONE GENERATOR'S STEEL PER GENERATOR. An UNCONNECTED spare
     generator routes no new run (pipeNetwork() skips a part with nothing
     naming it), so every other mass term - piping, pumps, core - is
     unmoved; the entire delta has to be exactly SGT[D.sg].mass, not a flat
     per-loop lump and not zero (the bug this replaces: SGT[D.sg].mass used
     to be charged once for the whole plant, so a second generator was
     free). */
  const m0=M.derived().mass;
  const gen=M.placePart(n=>({id:'sgX'+n,name:'STEAM GEN SPARE',w:1,h:2,x:11,y:1,
    col:'#5fd2e2',grp:'sg',tip:'',role:'sg'}));
  const m1=M.derived().mass;
  const want=M.SGT()[M.D().sg].mass;
  if(Math.abs((m1-m0)-want)>1e-9)
    bad(`adding a second generator moved mass by ${(m1-m0).toFixed(3)} t, expected exactly SGT[D.sg].mass = ${want} t`);
  else console.log(`  a placed second generator raises mass by exactly SGT[D.sg].mass: ${(m1-m0).toFixed(3)} t`);
  M.removePart(gen.id); M.commission();

  /* NO MENU ITEM CREATES MORE THAN ONE PART. D.loops++ used to conjure a
     generator, a pump AND four routed runs in one act (Stage 7b's own
     finding) - walk every item ctxItemsDesign() offers at an empty cell and
     a placed part, run each fn(), and demand LAY.parts grew by at most one
     part (a run or a fitting is not a LAY.parts entry, so those items are
     free to add zero). */
  {
    M.layoutMetrics();
    const before=M.LAY().parts.length;
    const items=M.ctxItemsDesign({cell:{gx:11,gy:6},part:null,fitting:null,tapKey:null});
    let worst=-Infinity, worstLabel='';
    for(const it of items){
      /* layoutMetrics() forces the rebuild, on both sides of fn() - an item
         that only flips a D flag or edits placedParts/D.tanks does not itself
         call buildLayout(), so LAY.parts would read stale without this and
         the delta below would either miss a real +1 or, worse, carry a
         phantom part into the NEXT item's own n0 baseline. */
      M.layoutMetrics();
      const ids0=new Set(M.LAY().parts.map(q=>q.id));
      it.fn();
      M.layoutMetrics();
      const grew=M.LAY().parts.length-ids0.size;
      if(grew>worst){ worst=grew; worstLabel=it.label; }
      /* UNDO BY DIFF, not by label. Every item on this menu reads "ADD ..."
         now - a tank is not fitted, it is added - so a label test alone can no
         longer tell a placed instance from a fittable slot. Ask the table
         first: a row whose label matches is un-fit through its own set().
         Everything else placed something, and what it placed is whatever id
         is on the board that was not before - removePart() takes a tank or a
         placed part alike. */
      const f=M.fittableList().find(x=>'ADD '+x.label===it.label);
      if(f) f.set(false);
      else for(const q of M.LAY().parts.filter(q=>!ids0.has(q.id))) M.removePart(q.id);
      M.layoutMetrics();
    }
    if(worst>1) bad(`"${worstLabel}" added ${worst} parts in one act - no menu item may create more than one`);
    else console.log(`  every empty-cell menu item adds at most one part (worst: "${worstLabel}" +${worst})`);
    if(M.LAY().parts.length!==before) bad('the empty-cell menu sweep left the layout larger than it started');
  }
  set({loops:1});
}

/* ══════════ THROTTLES ══════════
   A tee is boolean; a throttle is Stage 3a's new mode, a live position
   0..1. Four things are new and unproven by the JUNCTIONS block above:
   wide open costs the run nothing at all (bit-identical to no fitting),
   closing it chokes flow monotonically, shut is a real break (exactly
   zero), and the position is an ACTUATOR - demand and actual converge at
   VALVE_RATE, never teleport. A fifth defends the refusal every ACT row
   in this stage owes a design that never had the id it was asked to work. */
console.log('\n=== THROTTLES ===');
{
  set({loops:1}); M.commission();
  const bare=M.netFlowK(M.S());

  set({loops:1});
  const tap=()=>{ const r=M.pipeNetwork().find(x=>x.key&&x.key.startsWith('cold:sg0')); return [r.key,0.5]; };
  const tid=M.addFit('throttle',...tap(),null,null);   // in-line: bKey null
  M.commission();
  const s=M.S();
  if(s.valve[tid]!==1) bad(`an in-line throttle commissioned at ${s.valve[tid]}, expected wide open (1)`);
  if(s.valveDem[tid]!==1) bad('valveDem did not start equal to valve, like every other actuator');

  const wide=M.netFlowK(s);
  if(wide!==bare)
    bad(`a wide-open throttle changed flow: ${(wide*100).toFixed(4)}% vs no fitting at all ${(bare*100).toFixed(4)}%`);
  else console.log(`  wide open (x=1) is bit-identical to no fitting at all: ${(wide*100).toFixed(1)}%`);

  let prev=wide, monotone=true;
  for(const x of [0.9,0.75,0.5,0.25,0.1,0.05]){
    s.valve[tid]=x;
    const k=M.netFlowK(s);
    if(!(k<=prev)) monotone=false;
    prev=k;
  }
  if(!monotone) bad('closing a throttle did not reduce flow monotonically');
  else console.log(`  closing 1.0 -> 0.05: flow falls monotonically to ${(prev*100).toFixed(1)}%`);

  s.valve[tid]=0;
  const shutK=M.netFlowK(s);
  if(shutK!==0) bad(`a fully shut throttle left flow at ${shutK}, expected exactly 0`);
  else console.log('  fully shut (x=0) cuts the run to exactly zero');

  // the actuator: demand and actual converge at VALVE_RATE, from the
  // as-commissioned default, like every other slider on the plant - s.valve
  // was driven straight to 0 above to test the physics, so put it back to
  // where commissioning left it before testing the WALK toward a new demand
  s.valve[tid]=1; s.valveDem[tid]=1;
  s.valveDem[tid]=0;
  M.step(0.02);
  const want=1-M.VALVE_RATE*0.02;
  if(Math.abs(s.valve[tid]-want)>1e-9)
    bad(`one tick moved the valve to ${s.valve[tid]}, expected ${want} (VALVE_RATE*dt)`);
  let n=0; while(s.valve[tid]>0 && n<10000){ M.step(0.02); n++; }
  if(s.valve[tid]!==0) bad(`the valve did not settle exactly on its demand, stopped at ${s.valve[tid]}`);
  else console.log(`  valve strokes fully shut in ${(n*0.02).toFixed(1)} s at VALVE_RATE=${M.VALVE_RATE.toFixed(4)}/s`);

  // an id this design never had is refused, not phantom-keyed onto S
  M.act('junc','doesNotExist');
  if('doesNotExist' in M.S().juncOpen) bad('act(junc,...) put a phantom key on S for an id this design never had');
  M.act('valveDem','doesNotExist',0.5);
  if('doesNotExist' in M.S().valve) bad('act(valveDem,...) put a phantom key on S for an id this design never had');
  console.log('  act() refuses a fitting id this design never had, on both junc and valveDem');
}

/* ══════════ A PIPE RUN IS A HITTABLE TARGET (STAGE 4) ══════════
   combatHit() and repairStart() (step.js) now draw from LAY.parts AND from
   every run the solved network actually prices a resistance for
   (hittableRunKeys(), pipenet.js). A hit is a SEVERANCE: additive
   equivalent length taken to Infinity, which resist() (pipenet.js) carries
   straight through to an exact 0 conductance - the identical g<=0 path a
   shut valve already takes through netAssemble. See pipeExtraLen()'s own
   comment (pipenet.js) for why that is additive, never a multiplier, and
   why a severance rather than a graduated restriction. */
console.log('\n=== A PIPE RUN CAN BE HIT ===');
{ const s=set({}); run(s,5);
  const keys=M.hittableRunKeys(M.P().net);
  if(!keys.length) bad('a default PWR has no hittable pipe runs');
  const key=keys.find(k=>k.indexOf('cold:')===0)||keys[0];
  const before=M.netFlowK(s);
  M.combatHit('pipe:'+key);
  if(!s.dmgParts.includes('pipe:'+key)) bad(`combatHit('pipe:${key}') did not record damage`);
  const after=M.netFlowK(s);
  if(!(after<before)) bad(`severing ${key} did not reduce flow: ${(before*100).toFixed(1)}% -> ${(after*100).toFixed(1)}%`);
  else console.log(`  severing ${key}: flow ${(before*100).toFixed(1)}% -> ${(after*100).toFixed(1)}%`);
  M.combatHit('pipe:'+key);           // already severed: refused, not doubled
  if(s.dmgParts.filter(k=>k==='pipe:'+key).length!==1) bad('a second hit on an already-severed run was not refused');
  M.combatHit('pipe:doesNotExist');   // a run key this design never had: refused, not phantom-keyed
  if(s.dmgParts.includes('pipe:doesNotExist')) bad('a hit on a run key this design never had was not refused');
}
{ /* undamaged unaffected, and hit-then-repaired returns to EXACTLY the
     float netFlowK() started at - the network's own factorisation cache
     (netFactored(), pipenet.js) has to bust on both the hit and the repair,
     or one of the two would solve against a pipe that is no longer the one
     on the grid. */
  const s=set({}); run(s,5);
  const before=M.netFlowK(s);
  /* Held still, because the plant runs for minutes between the two readings
     and s.coreDT - the core's own temperature rise, and the whole of what
     buoyancy consumes - will not be the same number at the end of a repair
     as it was at the start. The claim being made here is about the
     FACTORISATION CACHE, so the thermal state has to be the one input that
     is not allowed to differ, or a genuine difference in buoyancy would read
     as a stale factorisation. */
  /* s.cavP too: it is what each pump's own head is derated by, and a loop
     that has spent minutes with a leg cut is not the same temperature as one
     that has not. Both are thermal state, and the claim here is about the
     FACTORISATION CACHE - a genuine difference in buoyancy or in cavitation
     would otherwise read as a stale factorisation. */
  const dt0=s.coreDT, cav0=JSON.stringify(s.cavP);
  const key=M.hittableRunKeys(M.P().net)[0];
  M.combatHit('pipe:'+key);
  M.repairStart('pipe:'+key);
  if(!s.repair) bad(`repair on a freshly hit, reachable run (${key}) was refused`);
  let n=0; while(s.repair && n<200000){ M.step(0.02); n++; }
  if(s.dmgParts.includes('pipe:'+key)) bad('a completed repair left the run marked damaged');
  s.coreDT=dt0; Object.assign(s.cavP, JSON.parse(cav0));
  const after=M.netFlowK(s);
  if(after!==before) bad(`a repaired run left netFlowK at ${after}, expected exactly ${before} (bit-identical to undamaged)`);
  else console.log(`  hit-and-repaired ${key}: flow returns to exactly ${(after*100).toFixed(1)}% in ${(n*0.02).toFixed(0)} s`);
}
{ /* walled in on every side: the same refusal a walled-in PART already gets
     (layoutMetrics()'s REPAIR ACCESS). LAY.parts is mutated directly rather
     than through placePart()/buildLayout(), which would re-route the run
     around the very obstruction this case is trying to build. */
  const s=set({}); run(s,5);
  const rk=M.hittableRunKeys(M.P().net), key=rk.find(k=>k.indexOf('cold:')===0)||rk[0];
  const r=M.P().net.byKey[key], cells=M.pipeCells(r.pts);
  const L=M.LAY(), blocked={}, added=[];
  for(const [x,y] of cells) blocked[x+','+y]=1;
  for(const [x,y] of cells) for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const gx=x+dx, gy=y+dy, k2=gx+','+gy;
    if(gx<0||gy<0||gx>=16||gy>=9||blocked[k2]) continue;
    blocked[k2]=1;
    const b={id:'blk'+added.length,name:'BLOCK',w:1,h:1,x:gx,y:gy,grp:'wall'};
    added.push(b); L.parts.push(b);
  }
  M.combatHit('pipe:'+key);
  M.repairStart('pipe:'+key);
  if(s.repair) bad(`a run walled in on every side still accepted a repair dispatch (${key})`);
  else console.log(`  ${key} walled in on every side: dispatch refused, same as a walled-in part`);
  L.parts.length -= added.length;     // undo the mutation or every later case inherits the wall
}
console.log('\n=== A SEVERED RUN NEVER PRODUCES NaN, ANY ARCHITECTURE ===');
{ for(let a=0;a<ARCH.length;a++){
    const s=set({arch:a}); run(s,5);
    const keys=M.hittableRunKeys(M.P().net);
    if(!keys.length) continue;
    for(const key of keys) M.combatHit('pipe:'+key);   // sever everything the graph prices for this plant
    run(s,30);
    const nums={n:s.n,Tf:s.Tf,dnbr:s.dnbr,flow:s.flow,nat:s.nat,P:s.P,Tavg:s.Tavg,k:M.netFlowK(s)};
    const bad_=Object.keys(nums).filter(k=>!isFinite(nums[k]));
    if(bad_.length) bad(`${ARCH[a].id}: severing every hittable run left ${bad_.join(',')} non-finite`);
  }
  console.log('  severing every hittable run, every architecture: no NaN - the plant falls back to whatever natural circulation gives it');
}

/* ══════════ THE PROTECTION SYSTEM MEASURES FLOW, IT DOES NOT READ THE DIAL ══════════
   A hole this feature OPENED and then closed. LOW FLOW used to trip on
   s.flow, the pump demand - and before an in-line valve existed, demand and
   delivery could not diverge, so nothing was wrong with that. A throttle can
   restrict a run, and a severed run can cut it outright, so a player could
   shut every valve on the primary with the pumps still commanded to 100% and
   the RPS would never have noticed. s.flowNet is what a flow meter in the
   loop actually reads, and pumpK is exactly 1 on an undamaged plant with
   nothing throttled - which is why nothing had to be re-pinned for this. */
console.log('\n=== LOW FLOW TRIPS ON DELIVERED FLOW, NOT THE PUMP DIAL ===');
{ set({loops:1});
  const cold=M.pipeNetwork().find(r=>r.key&&r.key.startsWith('cold:'));
  const th=M.addFit('throttle',cold.key,0.5,null,null);
  M.commission();
  const s=M.S(), floor=M.P().flowMin*1.02;
  run(s,2);
  if(s.trip) bad('a wide-open throttle tripped a plant nobody had touched: '+s.trip);
  s.valveDem[th]=0;                       // shut it. the pump demand never moves.
  for(let i=0;i<3000 && !s.trip;i++) M.step(0.02);
  if(!/LOW FLOW/.test(s.trip))
    bad(`shutting every valve on the primary did not trip LOW FLOW (trip="${s.trip}", delivered ${s.flowNet.toFixed(3)} vs floor ${floor.toFixed(3)})`);
  /* THE SENTINEL. Not decoration: this is the exact condition the OLD trip
     read, and it is still above the floor - so if anyone points LOW FLOW back
     at s.flow, the case above stops tripping and this line says why. */
  else if(!(s.flow>floor))
    bad('the pump dial fell below the floor too, so this case no longer proves the trip reads the delivered figure');
  else console.log(`  every valve shut, pumps still ordered to ${(s.flow*100).toFixed(0)}%: delivered ${(s.flowNet*100).toFixed(1)}% is under the ${(floor*100).toFixed(0)}% floor and "${s.trip}" fires - the dial alone would have missed it`);
  M.removeFit(th);
}

/* ══════════ THE BANKS SPLIT, AND THE CONTROLLER IS TUNED BY HAND ══════════
   Everything below defends one idea: a bank is a place, not a share of one
   number. The dangerous edge is the mode change itself - flipping s.split
   without walking the drives would overwrite every bank in a single tick and
   step several hundred pcm into a critical core. */
console.log('\n=== THE BANKS ARE SEVERAL PLACES, NOT ONE NUMBER ===');
const Zs = s => Array.from(s.rodZ).map(v=>v.toFixed(3)).join(' ');

{ /* a plant nobody has touched is ganged, all-auto, and sitting on its demand */
  const s=set({});
  if(s.split)  bad('a freshly commissioned plant came up with its banks split');
  if(s.reGang) bad('a freshly commissioned plant came up mid-regang');
  if(!s.bankAuto.every(Boolean)) bad(`a freshly commissioned plant has banks off auto: ${s.bankAuto}`);
  let d=0; for(let b=0;b<M.P().NB;b++) d=Math.max(d,Math.abs(s.rodZDem[b]-s.rodZ[b]));
  if(d!==0) bad(`per-bank demand does not equal actual at commissioning (off by ${d})`);
  console.log(`  commissioned ganged, ${s.bankAuto.length} banks on auto, demand on actual`);
}
{ /* Splitting must not move a single rod. The tilt is deliberately non-zero:
     the banks are spread when it happens, and adopting that spread as demand
     is the whole trick. One drive step of slack is allowed, nothing more. */
  const s=set({}); s.tiltDem=0.5; run(s,60);
  const was=Array.from(s.rodZ), rho0=s.rho;
  M.setSplit(true); M.step(0.02);
  const jump=Math.max(...was.map((v,i)=>Math.abs(v-s.rodZ[i]))), lim=M.ROD_RATE*0.02;
  if(!s.split) bad('setSplit(true) did not take');
  if(jump>lim*1.001) bad(`entering split moved a bank ${jump.toExponential(2)} in one tick, limit ${lim.toExponential(2)}`);
  if(Math.abs(s.rho-rho0)>1) bad(`entering split stepped reactivity by ${(s.rho-rho0).toFixed(1)} pcm`);
  console.log(`  entering split: worst bank moved ${jump.toExponential(1)} (one drive step), rho step ${(s.rho-rho0).toFixed(2)} pcm`);
}
{ /* And leaving must not either. This is the assertion the reGang walk exists
     for: drop it and flip s.split directly, and rodBanks() rewrites every bank
     from the master in one tick - this fails by three orders of magnitude. */
  const s=set({}); run(s,60); M.setSplit(true);
  s.rodZDem[0]=0.60; s.rodZDem[s.rodZ.length-1]=0.20; run(s,40);
  const spread=Math.max(...s.rodZ)-Math.min(...s.rodZ);
  if(spread<0.15) bad(`could not open a spread to regang from (only ${spread.toFixed(3)})`);
  M.setSplit(false);
  if(!s.reGang) bad('setSplit(false) flipped the mode instead of starting a walk');
  let worst=0, arrived=-1; const lim=M.ROD_RATE*0.02;
  for(let i=0;i<90*50;i++){
    const prev=Array.from(s.rodZ); M.step(0.02);
    for(let b=0;b<s.rodZ.length;b++) worst=Math.max(worst,Math.abs(s.rodZ[b]-prev[b]));
    if(arrived<0 && !s.split) arrived=i/50;
  }
  if(worst>lim*1.001) bad(`reganging teleported a bank ${worst.toExponential(3)} in one tick, limit ${lim.toExponential(3)}`);
  if(s.split||s.reGang) bad('the banks never finished ganging in 90 s');
  const left=Math.max(...s.rodZ)-Math.min(...s.rodZ);
  if(left>0.005) bad(`ganged banks still spread by ${left.toFixed(4)}`);
  console.log(`  leaving split: ${spread.toFixed(2)} of spread walked shut in ${arrived.toFixed(0)} s, worst tick ${worst.toExponential(1)} (drive limit ${lim.toExponential(1)})`);
}
{ /* One motor, one speed - and moving one bank must not disturb the others.
     Measured over a short window on purpose: drive a bank far enough and the
     plant answers with a real transient, and then it is the transient being
     timed rather than the drive. */
  const s=set({}); run(s,60); s.byp.rod=true; M.setSplit(true);
  const start=s.rodZ[0], others=Array.from(s.rodZ).slice(1);
  s.rodZDem[0]=1; run(s,5);
  const moved=s.rodZ[0]-start, want=M.ROD_RATE*5;
  if(Math.abs(moved-want)>1e-6) bad(`a split bank travelled ${moved.toFixed(5)} in 5 s, ROD_RATE says ${want.toFixed(5)}`);
  for(let b=1;b<s.rodZ.length;b++)
    if(s.rodZ[b]!==others[b-1]) bad(`driving bank 1 moved bank ${b+1} (${others[b-1]} -> ${s.rodZ[b]})`);
  console.log(`  driving one bank: ${(moved*100).toFixed(2)}% of travel in 5 s at ROD_RATE, the others did not move`);
}
{ /* The master slider is never taken off the panel, so it has to MEAN something
     in split - and the meaning is "move the whole stack", not "move bank 1".
     Bank 2 is put on MANUAL first: the master is the operator's handle, and
     MANUAL only stands a bank down from the TEMPERATURE CONTROLLER. If the
     master ever stopped carrying a manual bank the spread would open every time
     it was used, which is exactly the bug this asserts against. */
  const s=set({}); run(s,60); s.byp.rod=true; M.setSplit(true);
  s.bankAuto[1]=false;
  s.rodZDem[0]+=0.06; s.rodZDem[2]-=0.04;     // a spread the master must not disturb
  run(s,12);
  const before=Array.from(s.rodZDem), spread0=Math.max(...before)-Math.min(...before);
  M.setCommon(s.rodDem+0.10);
  const after=Array.from(s.rodZDem), spread1=Math.max(...after)-Math.min(...after);
  const step0=after[0]-before[0];
  for(let b=0;b<after.length;b++){
    const d=after[b]-before[b];
    if(Math.abs(d-step0)>1e-9) bad(`the master moved bank ${b+1} by ${d.toFixed(5)} and bank 1 by ${step0.toFixed(5)}`);
  }
  if(Math.abs(step0-0.10)>1e-9) bad(`the master was asked for +0.100 and delivered ${step0.toFixed(5)}`);
  if(Math.abs(spread1-spread0)>1e-9) bad(`the master changed the spread ${spread0.toFixed(5)} -> ${spread1.toFixed(5)}`);
  if(s.bankAuto[1]) bad('bank 2 was supposed to be on MANUAL for this case');
  console.log(`  the master in split: every bank +${(step0*100).toFixed(1)}%, bank 2 on MANUAL came too, spread held at ${(spread0*100).toFixed(1)} points`);
  /* and it still steers the walk while the banks are reganging, instead of the
     regang block overwriting it every tick */
  M.setSplit(false); const tgt=s.rodDem+0.05; M.setCommon(tgt); run(s,20);
  if(s.split) bad('the banks never finished ganging in 20 s');
  if(Math.abs(s.rodPos-tgt)>2e-3) bad(`ganged onto ${s.rodPos.toFixed(4)}, the master had asked for ${tgt.toFixed(4)}`);
  console.log(`  the master steers the regang walk: banks ganged onto ${(s.rodPos*100).toFixed(1)}%, asked for ${(tgt*100).toFixed(1)}%`);
}
{ /* Split has to reach the flux or it is decoration - the same bar the tilt
     trim is held to. Use the SAME spread the trim gets (XTILTZ) and the same
     zero-sum bankW shape, so this measures the handle and not the size of the
     shove. It does NOT beat the trim, and it is not supposed to: a spread is
     zero-sum in rod TRAVEL, never in rod WORTH, because the inner bank sits
     where the flux is. Widen it past XTILTZ and the net negative reactivity
     collapses power and the plant trips on LOW PRESSURE - measured. What split
     buys is per-bank MANUAL, not a bigger tilt. */
  const XT=0.30;                       // XTILTZ, the span the trim is allowed
  const lean=dir=>{ const s=set({}); run(s,60); s.byp.rod=true; M.setSplit(true);
    const z=s.rodZ[0], W=M.P().bankW;
    for(let b=0;b<M.P().NB;b++) s.rodZDem[b]=Math.max(0,Math.min(1,z+W[b]*XT*dir));
    run(s,90); return s; };
  const inn=lean(1), out=lean(-1);
  if(inn.scrammed||out.scrammed) bad(`a trim-sized split lean tripped the plant: ${inn.trip||out.trip}`);
  if(!(inn.ro<out.ro)) bad(`leaning the banks inward did not pull power outward: ro ${out.ro.toFixed(4)} -> ${inn.ro.toFixed(4)}`);
  const auth=(out.ro-inn.ro)*100;
  if(auth<1.2) bad(`split only moves the radial offset ${auth.toFixed(2)} points; weaker than the tilt trim it stands down`);
  console.log(`  radial offset, banks leaned in / out at the trim's own span: ${(inn.ro*100).toFixed(1)}% / ${(out.ro*100).toFixed(1)}%`);
  console.log(`  split authority: ${auth.toFixed(1)} points, against the tilt trim's 1.5 - the same handle, not a bigger one`);
}
{ /* the point of the feature: hold one bank by hand while the rest follow load */
  const s=set({}); run(s,60); M.setSplit(true); s.bankAuto[0]=false;
  const held=s.rodZ[0], was=Array.from(s.rodZ);
  s.loadDem=1.10; run(s,90);
  if(s.scrammed) bad(`the manual-bank case tripped before it could be measured: ${s.trip}`);
  if(s.rodZ[0]!==held) bad(`a bank on MANUAL moved anyway: ${held} -> ${s.rodZ[0]}`);
  let moved=false;
  for(let b=1;b<s.rodZ.length;b++) if(Math.abs(s.rodZ[b]-was[b])>0.01) moved=true;
  if(!moved) bad('no bank on AUTO answered a 110% load step, so the manual test proves nothing');
  if(!M.bankAutoLive(1)) bad('bank 2 should still be under the controller');
  if(M.bankAutoLive(0))  bad('bankAutoLive() still claims a MANUAL bank is being driven');
  console.log(`  bank 1 held on MANUAL at ${(held*100).toFixed(0)}% while the rest went to ${Zs(s)}`);
}
{ /* a latch outranks every one of those switches at once */
  const s=set({}); run(s,60); M.setSplit(true);
  s.bankAuto.fill(false); s.byp.rod=true;
  s.rodZDem[0]=0; s.rodZDem[1]=0.2;
  M.manualScram(); run(s,5);
  for(let b=0;b<s.rodZ.length;b++){
    if(s.rodZ[b]<0.99)   bad(`a scram left bank ${b+1} at ${s.rodZ[b].toFixed(3)} - manual must not outrank a latch`);
    if(s.rodZDem[b]!==1) bad(`a scram left bank ${b+1} demanding ${s.rodZDem[b]}`);
  }
  if(s.rodDem!==1) bad(`a scram left master demand at ${s.rodDem}`);
  console.log(`  scram with every bank split, manual and bypassed: banks ${Zs(s)}`);
}
{ /* and a jam outranks the scram, split or not - the drives are simply gone */
  const s=set({}); run(s,60); M.setSplit(true); run(s,1);
  s.rodJam=true; const was=Array.from(s.rodZ);
  s.rodZDem.fill(0); run(s,30);
  for(let b=0;b<s.rodZ.length;b++)
    if(s.rodZ[b]!==was[b]) bad(`a jammed drive still moved bank ${b+1} (${was[b]} -> ${s.rodZ[b]})`);
  console.log(`  jammed drives: banks frozen at ${Zs(s)} however hard you ask`);
}

console.log('\n=== THE ROD CONTROLLER IS TUNED FROM THE PANEL ===');
{ /* The lead term is the one that earns its five lines of comment: without it
     the bank hunts on a load step, the swing grows, and the plant trips itself.
     Gain is raised for both runs so the loop is fast enough to be unstable. */
  const swing=lead=>{ const s=set({}); run(s,60);
    s.arLead=lead; s.arGain=M.AUTOROD_GAIN*4; s.loadDem=1.10;
    let lo=1e9,hi=-1e9;
    for(let i=0;i<120*50;i++){ M.step(0.02); const d=s.Tavg-M.tProg(s); lo=Math.min(lo,d); hi=Math.max(hi,d); }
    return {pp:hi-lo, trip:s.trip}; };
  const off=swing(0), on=swing(M.AUTOROD_LEAD);
  if(!(off.pp>on.pp*3)) bad(`lead 0 swings ${off.pp.toFixed(2)} K vs ${on.pp.toFixed(2)} K with lead on; the lead term is not doing its job`);
  if(!off.trip) bad('a 4x-gain controller with no lead compensation rode out a load step; it is meant to hunt itself into a trip');
  if(on.trip)   bad(`the same gain WITH lead compensation still tripped: ${on.trip}`);
  console.log(`  lead 0: T-avg swings ${off.pp.toFixed(1)} K and trips on "${off.trip}"`);
  console.log(`  lead ${M.AUTOROD_LEAD} s: swings ${on.pp.toFixed(1)} K, no trip`);
}
{ /* Gain reaches the physics, but only below the point where the drives
     saturate: past roughly a quarter of the commissioning tune the bank is
     already moving as fast as ROD_RATE allows and more gain buys nothing. Both
     halves are asserted, because the panel tooltip claims both. */
  const dev=g=>{ const s=set({}); run(s,60); s.arGain=g; s.loadDem=1.10;
    let peak=0, gap=0;
    for(let i=0;i<60*50;i++){ M.step(0.02);
      peak=Math.max(peak,Math.abs(s.Tavg-M.tProg(s))); gap=Math.max(gap,Math.abs(s.rodDem-s.rodPos)); }
    return {peak,gap}; };
  const slow=dev(M.AUTOROD_GAIN/32), tune=dev(M.AUTOROD_GAIN), fast=dev(M.AUTOROD_GAIN*8);
  if(!(slow.peak>tune.peak*1.15)) bad(`detuning the gain 32x barely changed the transient: ${slow.peak.toFixed(3)} K vs ${tune.peak.toFixed(3)} K`);
  if(slow.gap>1e-9) bad('a detuned controller still outran the drives; the saturation claim is wrong');
  if(fast.gap<0.05) bad('an 8x gain did not outrun the drives; the "drives are the limit" claim is wrong');
  if(Math.abs(fast.peak-tune.peak)>0.05) bad(`past saturation the gain still changed the transient by ${Math.abs(fast.peak-tune.peak).toFixed(3)} K`);
  console.log(`  gain /32 -> peak deviation ${slow.peak.toFixed(2)} K, drives never behind demand`);
  console.log(`  gain x1 -> ${tune.peak.toFixed(2)} K, x8 -> ${fast.peak.toFixed(2)} K: past saturation the drives are the limit, not the gain`);
}
{ /* The band reaches the physics. Pinned, the controller cannot leave it;
     opened, it finds its own operating point. Note what this does NOT do:
     opening the band does not free the bank - only the bypass or MANUAL does. */
  const pin=(lo,hi)=>{ const s=set({}); run(s,60); s.arLo=lo; s.arHi=hi; run(s,90); return s.rodPos; };
  const narrow=pin(0.44,0.46), wide=pin(0,1);
  if(narrow<0.435||narrow>0.465) bad(`a band pinned to 44..46% left the bank at ${(narrow*100).toFixed(1)}%`);
  if(Math.abs(wide-narrow)<0.02) bad('opening the band all the way changed nothing; it does not reach the physics');
  console.log(`  band pinned 44..46%: bank sits at ${(narrow*100).toFixed(1)}%; band opened 0..100%: ${(wide*100).toFixed(1)}%`);
  const s=set({}); run(s,60); s.arLo=0; s.arHi=1; s.rodDem=0.90; run(s,90);
  if(Math.abs(s.rodPos-0.90)<0.05) bad('a wide band handed the bank to the operator; that is what the bypass is for');
  console.log(`  a wide band is authority, not freedom: demand 90% was walked back to ${(s.rodPos*100).toFixed(1)}%`);
}
{ /* lo and hi cannot cross. clamp(v,50,20) returns 50 with no complaint, which
     would pin the bank at the wrong end and say nothing about why. */
  const s=set({});
  s.arLo=Math.min(0.80,s.arHi);            // exactly what the panel setter does
  if(s.arLo>s.arHi) bad(`the OUT limit crossed the IN limit (${s.arLo} > ${s.arHi})`);
  s.arHi=Math.max(0.05,s.arLo);
  if(s.arHi<s.arLo) bad(`the IN limit crossed the OUT limit (${s.arHi} < ${s.arLo})`);
  console.log(`  the band cannot invert: dragging either limit past the other stops it at ${(s.arLo*100).toFixed(0)}%`);
}

/* ── the dice ──
   Every random outcome in the sim now comes off s.rng, so a run replays from
   its own seed and a scenario can command the outcome instead of rolling for
   it. Forcing 200 automatic lifts is the only die with a probability on it, so
   it is the one that can be measured: at p=0.18 the mean is 36 of 200 and the
   standard deviation sqrt(200*.18*.82) is 5.4, so a window of 18..56 is about
   3.3 sigma - wide enough that a legitimate seed never trips it, narrow enough
   that a die stuck on or off, or a p that has drifted by a third, does.
   The free-play count printed below is DIFFERENT EVERY RUN on purpose - that is
   the property under test, that resetPlant() draws a fresh seed - so it is the
   one line in this file that will not diff clean against a previous run. The
   two seeded runs beside it are the ones that must not move. */
console.log('\n=== THE SIM ROLLS NO LOOSE DICE ===');
{ /* One forced lift per call: put the pressure above the 106% setpoint, take a
     tick, read what the valve did, then reseat it by hand for the next one.
     The RPS is bypassed because a trip is not what is under test here and a
     scrammed plant would simply stop reaching the setpoint. Addresses the
     stock plant's ONE relief fitting directly (primaryRelief()) - its per-
     fitting fields (Stage 5) are the same shape the old global porv* fields
     were, just keyed by fid. */
  const fid=M.primaryRelief();
  if(!fid) bad('the stock plant has no relief fitting to test the dice against');
  const lifts=(s,n)=>{ let pat='';
    for(let i=0;i<n;i++){
      s.reliefOpen[fid]=false; s.reliefAuto[fid]=false; s.reliefStuck[fid]=false;
      s.P=M.P().P0*1.10;
      M.step(0.02);
      pat += s.reliefStuck[fid]?'1':'0';
    }
    return pat; };
  const stuck=p=>p.split('').filter(c=>c==='1').length;

  const s=set({}); s.byp.rps=true; run(s,5);
  const free=lifts(s,200), n=stuck(free);
  if(n<18||n>56) bad(`${n} of 200 automatic lifts stuck; p=${M.DICE().porvStick.p} should land in 18..56`);
  /* The COUNT is deliberately not printed: a fresh seed per resetPlant() is
     the property under test, so the number moves every run and this file is
     one people diff. bad() prints it when it matters, which is when it is
     outside the window. */
  console.log(`  free play: a fresh seed every reset, sticks inside 18..56 of 200 (p=${M.DICE().porvStick.p}, mean 36)`);

  /* The whole reason the cursor lives on S: the same seed has to give the same
     plant twice, or a recording is a different run that happens to start the
     same way. A second seed has to differ, or the "generator" is a constant. */
  const a=set({}); a.byp.rps=true; run(a,5); M.seedRng(a,20260824); const pa=lifts(a,200);
  const b=set({}); b.byp.rps=true; run(b,5); M.seedRng(b,20260824); const pb=lifts(b,200);
  const c=set({}); c.byp.rps=true; run(c,5); M.seedRng(c,20260825); const pc=lifts(c,200);
  if(pa!==pb) bad('two runs from the same seed stuck the valve on different lifts');
  if(pa===pc) bad('two different seeds gave the identical stick pattern; the seed is not reaching the die');
  console.log(`  seed 20260824 replays exactly (${stuck(pa)} sticks both times); seed 20260825 gives ${stuck(pc)}`);

  /* A scripted run rolls nothing at all, and gets the fault only when the
     script asks for it. porvArm is a ONE-SHOT: consumed by the lift it arms,
     or one line of script would make the valve permanently faulty. */
  const d=set({}); d.byp.rps=true; run(d,5); d.diceOff=true;
  const off=lifts(d,200);
  if(stuck(off)) bad(`${stuck(off)} of 200 lifts stuck with the dice stood down`);
  d.reliefArm[fid]=true;
  const armed=lifts(d,3);
  if(armed[0]!=='1') bad('an armed lift did not stick');
  if(armed.slice(1).includes('1')) bad('porvArm was not consumed; one command made the valve permanently faulty');
  console.log(`  dice off: 0 of 200 lifts stuck; armed once: pattern ${armed}`);

  /* Aimed, and aimed every time - the old block had to narrow LAY.parts to a
     single element to make the target predictable, which is a test rig standing
     in for a feature the sim owed a scenario anyway. */
  let jams=0;
  for(let i=0;i<20;i++){ const e=set({}); run(e,2); M.combatHit('rods');
    if(e.rodJam && e.dmgParts.length===1 && e.dmgParts[0]==='rods') jams++; }
  if(jams!==20) bad(`an aimed hit on the rod drives landed ${jams} times out of 20`);
  /* and it refuses rather than hitting something else, which is what stops a
     scenario naming an unbuilt component and silently wrecking the reactor */
  const e=set({}); run(e,2); M.combatHit('shld0'); M.combatHit('nosuchpart');
  if(e.dmgParts.length) bad(`an unhittable target still did damage: ${e.dmgParts.join(',')}`);
  console.log('  combatHit("rods") jams the bank 20 of 20; an unhittable id does nothing at all');
}

/* ══════════ A SNAPSHOT IS THE WHOLE PLANT ══════════
   The rule this proves: ALL SIM STATE LIVES ON S. Every other guarantee in the
   recording layer stands on it - a scrub, a branch, a replay and a scenario
   verdict are all "put S back and run on", so the day a tick starts reading
   something that a clone of S does not carry, all four go quietly wrong.

   The method needs no list of field names and therefore cannot fall behind the
   code: run the plant, snapshot, run a span, restore, run the SAME span again,
   and require the two futures to be identical to the last bit. State parked in
   a module global is not restored, so the futures diverge. A wall clock read
   inside the tick does the same - which is why this block builds its own
   module with {clock:true}. Under the frozen stub every other case uses, a
   wall-clock leak is a CONSTANT and this test would sail straight past it;
   that is exactly how s.jit sat in step() being written every tick and read by
   nobody. eqWhere() names the first field that differs, so a failure here is a
   lead and not just a red line. */
console.log('\n=== A SNAPSHOT IS THE WHOLE PLANT ===');
{
  const W=require('./bundle').headless(
    '{commission,step,combatHit,repairStart,snapS,restoreS,eqWhere,S:()=>S,D:()=>D,latDefault}',
    {clock:true});
  const WD=W.D(), WBASE=JSON.parse(JSON.stringify(WD));
  const wset=o=>{ Object.assign(WD,JSON.parse(JSON.stringify(WBASE)),o||{});
                  W.latDefault(); W.commission(); return W.S(); };
  const wrun=n=>{ for(let i=0;i<n;i++) W.step(0.02); };

  const trip=(label,o,prep)=>{
    wset(o); wrun(1000);                       // 20 s of settled plant
    if(prep) prep(W.S());
    const A=W.snapS(W.S());
    wrun(1000); const end1=W.snapS(W.S());     // the future it actually had
    W.restoreS(A);
    wrun(1000); const end2=W.snapS(W.S());     // the future it has again
    const w=W.eqWhere(end1,end2);
    if(w) bad(`${label}: restoring 20 s of plant gave a DIFFERENT next 20 s, first at ${w}`);
    return !w;
  };

  const okA=trip('default PWR',{});
  const okB=trip('RBMK (arch 2)',{arch:2});
  /* damage and repair carry their own fields - rodJam, dmgParts, reliefStuck,
     the repair timer - and they are the ones a hand-written snapshot list forgets */
  const okC=trip('after a combat hit',{},s=>{ W.combatHit('rods'); });
  if(okA&&okB&&okC) console.log('  three plants round-trip bit-for-bit under an ADVANCING wall clock');

  /* Stage 3 put five plain scalars on S (doseRate, crewDose, repRate,
     partySpent, and dose kept its name and meaning). The field they are
     read off is NEVER stored - see the header comment above the integrator
     in step.js - so the only things a snapshot carries are exactly these
     scalars, and this is the case that would catch one of them slipping
     into a module global instead: a fault live, a party out and taking
     dose at the moment of the snapshot, which is precisely the state that
     lives on s.repair/s.dose/s.repRate/s.crewDose read together. */
  const okD=trip('mid-accident with a repair party out',{},s=>{
    s.byp.rps=true; s.flow=0.05; s.flowDem=0.05;
    W.combatHit('rods'); W.repairStart('rods');
  });
  if(okD) console.log('  a plant mid-accident with a repair party taking dose round-trips bit-for-bit too');

  /* partySpent is a fifth Stage-6 scalar on S, and the moment it flips is
     exactly the moment step() also nulls s.repair and appends a log entry -
     three writes in the same tick that a hand-maintained field list would be
     three separate ways to get this case wrong. */
  const okE=trip('after the repair party is spent',{},s=>{
    W.combatHit('rods'); W.repairStart('rods'); s.dose=100;
    W.step(0.02);           // the tick the withdrawal itself fires on
  });
  if(okE) console.log('  a plant with the repair party already spent round-trips bit-for-bit too');

  /* THE CLONER IS GENERIC, NOT A FIELD LIST. This is the literal test of the
     promise that a future feature's state is recorded for free: invent a field
     nothing in the sim has ever heard of and require it back intact. */
  { const s=wset({}); wrun(100);
    s.__probe={a:[1,2], b:new Float64Array([3,4]), c:{d:Infinity, e:NaN}};
    const A=W.snapS(s);
    s.__probe.a[0]=99; s.__probe.b[0]=99; s.__probe.c.d=0;
    const back=W.restoreS(A);
    const q=back.__probe;
    const ok = q && q.a[0]===1 && q.b[0]===3 && (q.b instanceof Float64Array)
                 && q.c.d===Infinity && Number.isNaN(q.c.e);
    if(!ok) bad('a field invented by this test did not survive the round trip; the cloner is a field list, not generic');
    else console.log('  a field the sim has never heard of round-trips, typed arrays and Infinity included');
    delete back.__probe;
  }

  /* A RESTORE MUST CLONE ON THE WAY OUT. Hand the snapshot itself back and the
     next tick edits the keyframe, so the SECOND seek to it lands somewhere
     else - and the further back you scrub the more wrong it gets. */
  { const s=wset({}); wrun(100);
    const A=W.snapS(s), was=A.phi[0];
    W.restoreS(A);
    W.S().phi[0]=was+1;
    if(A.phi[0]!==was) bad('restoreS handed back the snapshot itself; running on rewrites the past');
    else console.log('  a restored state does not alias its snapshot');
  }

  /* s.t is what forty things read; s.tick is what the recording indexes by.
     They are two clocks and they must not drift, because a keyframe found by
     one is replayed against the other. */
  { const s=wset({}); wrun(30000);
    const d=Math.abs(s.t - s.tick*0.02);
    if(d>1e-6) bad(`s.t and s.tick disagree by ${d} after 30000 ticks`);
    else console.log(`  s.t and s.tick still agree after 30000 ticks (t=${s.t.toFixed(2)}s)`);
  }
}

/* ══════════ THE TAPE ══════════
   Everything the recording layer offers - a scrub, a branch, a debrief, a
   scenario verdict - is the same sentence twice: put S back and run the inputs
   on. So there are exactly two things to prove about it, and both are below.

   The plant is built through its own module with {clock:true} for the reason
   the snapshot block already documents: a wall clock leaking into the tick is a
   CONSTANT under the frozen stub, so a replay would agree with the run it
   replayed while quietly reading the wrong number.

   The run helper below is the frame loop main.js will have in phase 5 - step,
   sample on the sim clock, then offer the tick to the recorder - because a
   recording taken by any other loop is a recording of a different program. */
const R=require('./bundle').headless(
 '{commission,step,act,sample,recTick,recPlay,recBranch,seek,lineage,'+
 'snapS,eqWhere,REC,SAMP_TICKS,chAt,hlen:()=>hlen,S:()=>S,D:()=>D,latDefault}',
 {clock:true});
const RD=R.D(), RBASE=JSON.parse(JSON.stringify(RD));
const rrun=n=>{ for(let i=0;i<n;i++){ R.step(0.02);
  if(R.S().tick%R.SAMP_TICKS===0) R.sample(); R.recTick(); } };
let RPID=0, REND=null;

console.log('\n=== A BRANCH WITH NO NEW INPUT REPRODUCES ITS PARENT ===');
{ Object.assign(RD,JSON.parse(JSON.stringify(RBASE)));
  R.latDefault(); R.commission();
  /* THE ROOT IS LAZY. Nothing in step.js knows the recorder exists, so nobody
     announced this plant - the first recTick() after it appears has to notice
     there is no take to write to and open one off the live S. */
  if(R.REC.takes.length) bad('the recorder had a take before anything was recorded');
  R.recTick();
  if(R.REC.takes.length!==1) bad('the recorder did not root itself on the first tick');
  RPID=R.REC.cur;
  const par=R.REC.takes[RPID];

  /* 30 s with four acts on the track, two of them after the branch point */
  rrun(250); R.act('rodCommon',0.50);
  rrun(350); R.act('loadDem',0.85);
  rrun(300); R.act('boronDem',-300);
  rrun(350); R.act('flowDem',0.92);
  rrun(250);
  REND=R.snapS(R.S());
  if(R.S().tick!==1500) bad(`the recording ran to tick ${R.S().tick}, expected 1500`);
  if(par.evs.length!==4) bad(`four acts went down as ${par.evs.length} events`);

  /* A dragged slider is one input per tick, not one per frame: three writes to
     the same track on the same tick are one event holding the last value, and
     the fourth - a different bank - is its own event beside it. */
  { const was=par.evs.length;
    R.act('rodBank',0,0.41); R.act('rodBank',0,0.42); R.act('rodBank',0,0.43);
    R.act('rodBank',1,0.40);
    const got=par.evs.length-was, last=par.evs[par.evs.length-2];
    if(got!==2) bad(`a three-frame drag plus a second bank went down as ${got} events, expected 2`);
    if(last.a[1]!==0.43) bad(`coalescing kept ${last.a[1]}, the drag ended on 0.43`);
    par.evs.length=was;                       // off the tape again; the plant never stepped on them
  }

  const w0=R.seek(RPID,500);
  if(R.S().tick!==500) bad(`seek asked for tick 500 and landed on ${R.S().tick}`);
  if(R.REC.mode!=='replay') bad('a seek did not put the recorder into replay');
  if(!w0) bad('seek returned nothing');

  const kid=R.recBranch(RPID,500);
  if(!kid.assisted)          bad('a branched take is not marked assisted');
  if(kid.parent!==RPID)      bad('the branch did not hang off the take it was made from');
  if(R.REC.mode!=='live')    bad('branching did not put the recorder back on the air');
  /* Hand the child the parent's remaining inputs through act(), so the child
     RECORDS them too and the two tapes are the same tape. This is the assertion
     the whole branching model stands on: same base, same inputs, same plant. */
  while(R.S().tick<1500){
    const tk=R.S().tick;
    for(const ev of par.evs) if(ev.tick===tk) R.act(ev.k,...ev.a);
    R.step(0.02); if(R.S().tick%R.SAMP_TICKS===0) R.sample(); R.recTick();
  }
  const w=R.eqWhere(REND,R.snapS(R.S()));
  if(w) bad(`a branch replaying its parent's inputs landed elsewhere, first at ${w}`);
  if(kid.evs.length!==3) bad(`the child recorded ${kid.evs.length} of the 3 acts it was handed`);
  if(!w) console.log(`  parent: ${par.evs.length} acts over 30 s, ${par.keys.length} keyframes`+
                     `; branch at 10 s replays the rest onto its exact 30 s state`);

  /* WATCHING DOES NOT FORK. Seek the parent back and let its own tape drive it
     forward: same 30 s again, a full stop at the end of the track, and not one
     new take in the forest - or merely reviewing a run would litter the tree. */
  const takes0=R.REC.takes.filter(Boolean).length;
  R.seek(RPID,500);
  let guard=0;
  while(R.recPlay() && guard++<4000){
    R.step(0.02); if(R.S().tick%R.SAMP_TICKS===0) R.sample(); R.recTick(); }
  const w2=R.eqWhere(REND,R.snapS(R.S()));
  if(w2) bad(`replaying the parent forward did not reproduce it, first at ${w2}`);
  if(R.S().tick!==1500) bad(`a replay ran on to tick ${R.S().tick}; its tape ends at 1500`);
  if(R.REC.takes.filter(Boolean).length!==takes0) bad('watching a replay forked the tape');
  if(!w2) console.log(`  watching does not fork: replayed to tick 1500 and stopped, `+
                      `${takes0} takes before and after`);
}

console.log('\n=== THE KEYFRAMES ARE A CACHE ===');
{ /* The inputs are the recording; the keyframes only save re-simulating them.
     So take the eviction all the way - every key gone, base alone left - and
     require the same tick to come back as the same plant, bit for bit. If it
     does not, eviction is not a cache policy, it is data loss. */
  const par=R.REC.takes[RPID];
  const at=975;                              // a sample tick, so the chart lands on it exactly
  R.seek(RPID,at);
  const A=R.snapS(R.S()), keys0=par.keys.length, len0=R.hlen();
  const nearest=par.keys.filter(k=>k.tick<=at).pop();
  R.REC.keyCount-=par.keys.length; par.keys.length=0;
  R.seek(RPID,at);
  const B=R.snapS(R.S());
  const w=R.eqWhere(A,B);
  if(w) bad(`the same tick reached two ways gave two plants, first at ${w}`);
  else console.log(`  tick ${at} from the keyframe at ${nearest.tick} and from base alone:`+
                   ` the same plant (${keys0} keys dropped)`);

  /* And the strip chart comes back with it. histFill() reads the archive rather
     than re-sampling, so it does not care that the keyframes went. */
  if(R.hlen()!==len0) bad(`the strip chart came back ${R.hlen()} samples deep, was ${len0}`);
  if(Math.abs(R.chAt('pwr',R.hlen()-1)-R.S().n*100)>1e-9)
    bad('histFill put a strip chart back that does not end on the plant it seeked to');
  console.log(`  histFill: ${R.hlen()} samples restored from the archive, newest is the seek itself`);
}

/* ══════════ A SCENARIO RUNS THE SAME WAY TWICE ══════════
   The whole value of a scripted drill is that two people can be given the same
   one, so the first thing asked of a scenario is that it is a RUN and not a
   re-enactment: the same script, twice, has to land on the same plant to the
   last bit and earn the same verdict.

   It gets its own headless plant rather than sharing R's. R's forest holds the
   takes the two recording blocks above assert about, and REC_MAX_ROOTS is 8 -
   seven scenario runs stacked on top would start evicting the very takes those
   blocks are reading. */
const SC=require('./bundle').headless(
 '{commission,latDefault,scnRun,scnJudge,scnCompile,scnClone,scnNew,scnGest,scnLimit,'+
 'SCNPRE:()=>SCNPRE,GEST:()=>GEST,ACT:()=>ACT,snapS,eqWhere,S:()=>S,primaryRelief}',
 {clock:true});
/* A verdict as one comparable string: the pass, and for every limit whether it
   broke, where, and the worst the channel ever got. Comparing the objects would
   compare the limit rows by reference and report two verdicts as different
   because they were judged off two copies of the same list. */
const vsig=v=>(v.pass?'PASS':'FAIL')+' '+v.rows.map(r=>
  r.L.id+':'+(r.broke?'broke@'+r.tick:'ok')+':'+
  (r.worst===null?'-':r.worst.toFixed(6))+'@'+r.worstAt).join(' ');

console.log('\n=== A SCENARIO RUNS THE SAME WAY TWICE ===');
{ SC.latDefault(); SC.commission();

  /* `reset` throws the plant away, so a scenario must never be able to schedule
     it. scenario.js asserts that at load and throws - this is the other half:
     it checks the guard is not vacuous. A palette that passed because nothing
     is marked sched:false is a palette nobody is guarding. */
  const A=SC.ACT(), G=SC.GEST();
  const noSched=Object.keys(A).filter(k=>A[k].sched===false);
  if(!noSched.length)
    bad('no ACT row is marked sched:false, so the palette guard in scenario.js proves nothing');
  const leaked=Object.keys(G).filter(k=>G[k].act && noSched.includes(G[k].act));
  if(leaked.length) bad(`the gesture palette schedules ${leaked.join(', ')}, which ACT forbids`);
  console.log(`  ${Object.keys(G).length} gestures in the palette, `+
              `none of them scheduling ${noSched.join('/')}`);

  /* Built the way a player builds one - through the same three helpers the
     presets call - and it exercises all three shapes a gesture can take: a
     one-act event with an argument (a hit), a one-act toggle (a blackout), and
     the one gesture that is many acts (a ramp). */
  const mix=()=>{ const s=SC.scnNew('mix','MIXED');
    s.seed=20260824; s.secs=60;
    SC.scnGest(s, 5,'loadRamp',70,20);
    SC.scnGest(s,30,'blackout',true);
    SC.scnGest(s,40,'hit','turb');
    SC.scnGest(s,50,'blackout',false);
    SC.scnLimit(s,'no melt','melt','<',1,0);
    SC.scnLimit(s,'dnbr','dnbr','>',1.30,0.5);
    return s; };
  const track=SC.scnCompile(mix());
  const a=SC.scnRun(mix()), A1=SC.snapS(SC.S());
  const b=SC.scnRun(mix()), A2=SC.snapS(SC.S());
  const w=SC.eqWhere(A1,A2);
  if(w) bad(`the same scenario run twice landed on two plants, first at ${w}`);
  if(vsig(a.verdict)!==vsig(b.verdict))
    bad(`the same scenario run twice gave two verdicts: ${vsig(a.verdict)} / ${vsig(b.verdict)}`);
  /* Every compiled act reaches the tape, because scnDue() fires through act()
     and act() records. A scenario event that did not land on the tape is one a
     replay of this run would silently leave out. */
  if(a.take.evs.length!==track.length)
    bad(`${track.length} compiled acts went down as ${a.take.evs.length} events on the tape`);
  if(a.take.assisted) bad('an unattended run came back marked assisted');
  console.log(`  ${mix().gest.length} gestures compile to ${track.length} acts; `+
              `the run puts all ${a.take.evs.length} on the tape and ends on tick ${a.take.tickEnd}`);
  console.log(`  the same script twice: identical to the last bit, and ${vsig(a.verdict).split(' ')[0]} both times`);

  /* ── A SCRIPTED RUN ROLLS NOTHING ──
     s.diceOff stands every die down, so the only faults are the ones the script
     asked for. The cursor is the proof: srand() is the only thing that moves
     s.rng, so a run that ends with the cursor still on its seed rolled nothing
     at all - a stronger statement than counting outcomes that did not happen.
     Then the same script with one porvArm gesture in it, which commands the
     outcome DICE.porvStick would otherwise have rolled for. */
  const porv=arm=>{ const s=SC.scnNew('porv','PORV');
    s.seed=20260824; s.secs=60;
    SC.scnGest(s,0,'byp','rps');            // a trip would stop it reaching the setpoint
    if(arm) SC.scnGest(s,2,'porvArm');
    SC.scnGest(s,2,'loadStep',0);           // nowhere for the heat to go: the valve lifts
    return s; };
  SC.scnRun(porv(false)); const off=SC.S();
  const rfid=SC.primaryRelief();
  if(!rfid || !off.reliefAuto[rfid]) bad('the scripted overpressure never lifted the relief valve, so nothing was under test');
  if(rfid && off.reliefStuck[rfid]) bad('the relief valve stuck with the dice stood down');
  if(off.rng!==off.seed) bad('a scripted run moved the generator cursor; something rolled');
  SC.scnRun(porv(true)); const armed=SC.S();
  if(!rfid || !armed.reliefStuck[rfid]) bad('a porvArm gesture did not stick the lift it armed');
  console.log('  dice off: the valve lifts and reseats and the cursor never moves; '+
              'one porvArm gesture sticks the next lift');

  /* ── A LIMIT IS A QUESTION ASKED OF A RUN, AND YOU MAY CHANGE THE QUESTION ──
     Three verdicts off ONE take: a limit the run breaks, the same limit with
     enough grace to move exactly where it breaks, and one it never comes near.
     Nothing is simulated to answer any of them - same archive, same tick, same
     sample count afterwards - which is the property that lets a debrief edit a
     limit and re-judge instead of flying the drill again. */
  const lim=(id,ch,cmp,v,g)=>{ const s=SC.scnNew('l','L'); SC.scnLimit(s,id,ch,cmp,v,g); return s.limits; };
  const tick0=SC.S().tick, trN0=b.take.trN, end0=b.take.tickEnd;
  /* 200%, not 90%. Grace only moves a break by exactly its own window while
     the limit is broken CONTINUOUSLY - a limit the run crosses back over
     restarts the count, and the answer is then a property of the trace rather
     than of the grace. 90% used to sit under this plant's own resting power
     and now sits just above it (the injection line is a real pipe on the
     drawing since the HPI tank stopped appearing only when an accumulator was
     bought, so P.flowK and the power it settles at are both a little lower),
     which put the trace right on the threshold. 200% is a bar this plant
     never approaches, so the break is the first sample either way and the
     only thing between the two answers is the grace itself. */
  const tight=SC.scnJudge(b.take,lim('power','pwr','>',200,0));
  const grace=SC.scnJudge(b.take,lim('power','pwr','>',200,2));
  const slack=SC.scnJudge(b.take,lim('power','pwr','>',0.5,0));
  if(tight.pass) bad('a limit the run plainly breaks came back passed');
  if(slack.pass===false) bad('a limit the run never came near came back broken');
  if(tight.rows[0].tick===null) bad('a broken limit reported no tick');
  if(grace.rows[0].tick-tight.rows[0].tick!==100)
    bad(`2 s of grace moved the break by ${grace.rows[0].tick-tight.rows[0].tick} ticks, expected 100`);
  if(SC.S().tick!==tick0 || b.take.trN!==trN0 || b.take.tickEnd!==end0)
    bad('re-judging a finished run simulated something');
  console.log(`  the same ${trN0} samples judged three ways: 90% breaks at tick `+
              `${tight.rows[0].tick}, with 2 s of grace at ${grace.rows[0].tick}, 0.5% never`);

  /* ── THE PRESETS ARE PASSABLE BY THE PLANT THEY SHIP WITH ──
     Measured, not hoped. A preset the default plant cannot pass is a drill that
     teaches the player their reactor is broken. Each is cloned first, because a
     preset is never mutated. */
  for(const pre of SC.SCNPRE()){
    const r=SC.scnRun(SC.scnClone(pre));
    const broke=r.verdict.rows.filter(x=>x.broke).map(x=>x.L.id);
    if(!r.verdict.pass) bad(`preset ${pre.name} fails on the default plant: ${broke.join(', ')}`);
    console.log(`  ${pre.name.padEnd(17)} ${r.verdict.pass?'PASS':'FAIL'}  ${pre.secs} s, `+
                `${pre.gest.length} gestures, ${r.take.evs.length} acts, `+
                `${r.verdict.rows.length} limits`);
  }
}

/* ══════════ A DESIGN TRAVELS AS A HEAD ══════════
   recHead() is what a recording says about the plant it is a recording OF, and
   recApplyHead() is how something that is not that plant becomes it. One thing
   needs the pair today: src/sim/runworker.js runs a scenario on a thread of its
   own, and that thread starts from the stock defaults in design.js - it has
   never seen the reactor the player drew.

   The danger is specific and it is the worst thing this feature could do: a
   head that rebuilds ALMOST the right plant would hand back a confident PASS
   about a reactor nobody designed. So recApplyHead() re-signs the design and
   returns whether it matched, and the worker refuses rather than answering.
   This block pins both halves - that a non-stock design survives the round
   trip, and that the run it produces is the same run to the last bit. */
console.log('\n=== A DESIGN TRAVELS AS A HEAD ===');
{
  const B=require('./bundle');
  const EX='{commission,latDefault,layoutMetrics,scnRun,scnClone,SCNPRE:()=>SCNPRE,'+
           'recHead,recApplyHead,snapS,eqWhere,S:()=>S,D:()=>D,designSig}';
  /* the player's session, deliberately NOT the stock plant */
  const page=B.headless(EX);
  page.layoutMetrics(); page.latDefault(); page.commission();
  /* Stage 3b: a second/third generator is a PLACED part now, and placedParts
     is exactly the state recApplyHead() cannot carry (see its own comment,
     record.js) - proving that gap needs its own case, not this one. This
     case is about a plain-D change surviving the round trip, so it stays a
     plain-D change: turb alone is already non-stock. */
  page.D().turb=0.8; page.commission();
  const head=page.recHead();

  /* a fresh module that has never seen it */
  const w=B.headless(EX);
  w.layoutMetrics(); w.latDefault(); w.commission();
  if(w.designSig()===head.dsig)
    bad('the fresh module already matched the design, so this proves nothing');
  if(!w.recApplyHead(head)) bad('recApplyHead could not rebuild a design it was handed');
  if(w.designSig()!==head.dsig) bad('recApplyHead reported success on a design that did not match');
  w.commission();

  const a=page.scnRun(page.scnClone(page.SCNPRE()[2])), endA=page.snapS(page.S());
  const b=w.scnRun(w.scnClone(w.SCNPRE()[2])),          endB=w.snapS(w.S());
  if(a.verdict.pass!==b.verdict.pass) bad('the same scenario got two different verdicts');
  const where=page.eqWhere(endA,endB);
  if(where) bad('a run rebuilt from a head diverged at '+where);

  /* and a head that is WRONG has to be refused rather than half-applied */
  const bent=JSON.parse(JSON.stringify(head));
  bent.dsig=bent.dsig+'!';
  const w2=B.headless(EX); w2.layoutMetrics(); w2.latDefault(); w2.commission();
  if(w2.recApplyHead(bent)) bad('a head whose signature did not match was accepted anyway');

  console.log('  a non-stock plant rebuilds from its head in a module that never saw it, and runs identically');
  console.log('  a head that does not re-sign is refused, so a verdict is never about the wrong reactor');

  /* A PLACED PART TRAVELS NOW. This used to be a documented gap proved
     rather than fixed: placedParts was layout state recHead() did not carry,
     so a design with a spare generator on it could only ever be REFUSED,
     never rebuilt. Making every tank an instance forced the fix - a plant
     whose tanks are placed is every plant - so the head serialises the placed
     set whole and recApplyHead() puts it back before it re-signs. */
  const EX2=EX.replace('}', ',placePart,LAY:()=>LAY}');
  const page2=B.headless(EX2);
  page2.layoutMetrics(); page2.latDefault(); page2.commission();
  page2.placePart(()=>({id:'sgX0',name:'STEAM GEN SPARE',w:1,h:2,x:11,y:1,col:'#5fd2e2',
    grp:'sg',tip:'',role:'sg'}));
  page2.commission();
  const head2=page2.recHead();
  const w3=B.headless(EX2); w3.layoutMetrics(); w3.latDefault(); w3.commission();
  if(!w3.recApplyHead(head2))
    bad('recApplyHead() refused a head with a placed generator - the placed set is carried now, this must rebuild');
  else if(!w3.LAY().parts.some(q=>q.id==='sgX0'))
    bad('recApplyHead() re-signed a head with a placed generator without putting the generator back');
  else console.log('  a placed generator rebuilds from its head: the spare is on the board and the design re-signs');

  /* AND A TANK THE PLAYER DELETED STAYS DELETED. A fresh module ships three
     tanks; this head has one fewer. It rides D.tanks, which the head carries
     whole, so it rebuilds rather than being refused - which is the direction
     that used to break. */
  const EX3=EX2.replace('}', ',removePart,tanks:()=>D.tanks}');
  const page3=B.headless(EX3);
  page3.layoutMetrics(); page3.latDefault(); page3.commission();
  page3.removePart('reltk'); page3.commission();
  const head3=page3.recHead();
  const w4=B.headless(EX3); w4.layoutMetrics(); w4.latDefault(); w4.commission();
  if(!w4.recApplyHead(head3))
    bad('recApplyHead() refused a head with a tank removed - D.tanks rides the head, this must rebuild');
  else if(w4.tanks().reltk)
    bad('recApplyHead() re-signed a head with a tank removed and left the tank on the board');
  else console.log('  a deleted tank rebuilds from its head too: the fresh module ends up without it and re-signs');

  /* AND IT STILL REFUSES. A check that has never been seen to fail is not a
     check: drop ONE field out of the placed set and the head must go back to
     refusing, exactly as loudly as it used to for the whole class. */
  const bentPlaced=JSON.parse(JSON.stringify(head2));
  for(const q of bentPlaced.placed) delete q.y;
  const w5=B.headless(EX2); w5.layoutMetrics(); w5.latDefault(); w5.commission();
  if(w5.recApplyHead(bentPlaced))
    bad('a head whose placed set is missing a field was accepted anyway - the round trip is not checked, only trusted');
  else console.log('  inject: dropping `y` from the head\'s placed set IS refused - the round trip is checked, not trusted');
}

/* ══════════ TWO RUNNERS, ONE ANSWER ══════════
   scnRun() is the reference: it blocks, and every scenario figure in this file
   comes out of it. scnRunAsync() is what the RUN key actually presses, and it
   pays the same ticks in slices out of the frame loop so the tab still answers -
   or hands the whole job to a worker thread when one will start.

   They must land on the same plant, and this is the assertion that says so. It
   is here because two comments in scenario.js already CLAIMED it was, which is
   the worst state for a claim to be in: written down, believed, and untrue. If
   the slice ever drifts from the reference, the verdict the player is shown
   stops being the verdict this auditor measures, and every number above becomes
   a statement about a runner nobody uses.

   All three presets, because they exercise different act shapes - a ramp that
   compiles to hundreds of acts, a pair of blackout toggles, and an aimed hit
   followed by a repair. */
console.log('\n=== TWO RUNNERS, ONE ANSWER ===');
{
  /* its own module, as the scenario blocks above have: these two runners both
     call resetPlant() and open roots, and doing that in the module every other
     case shares would hand the next block a plant it did not build. */
  const SR=require('./bundle').headless(
    '{commission,latDefault,scnRun,scnRunAsync,scnDrain,scnBusy,scnClone,'+
    'SCNPRE:()=>SCNPRE,snapS,eqWhere,S:()=>S}');
  SR.latDefault(); SR.commission();
  let same = 0;
  for(const pre of SR.SCNPRE()){
    const a = SR.scnRun(SR.scnClone(pre));
    const endA = SR.snapS(SR.S());

    let got = null;
    SR.scnRunAsync(SR.scnClone(pre), null, r => { got = r; });
    let guard = 0;
    while(SR.scnBusy() && guard++ < 200000) SR.scnDrain();
    const endB = SR.snapS(SR.S());

    if(!got){ bad(`${pre.name}: the sliced runner never finished`); continue; }
    if(got.verdict.pass !== a.verdict.pass)
      bad(`${pre.name}: blocking says ${a.verdict.pass?'PASS':'FAIL'} and sliced says ${got.verdict.pass?'PASS':'FAIL'}`);
    const where = SR.eqWhere(endA, endB);
    if(where) bad(`${pre.name}: the two runners diverged at ${where}`);
    else same++;
  }
  if(same === SR.SCNPRE().length)
    console.log(`  all ${same} presets: the sliced runner lands on the reference runner's plant, bit for bit`);
}

/* ══════════ THE CREW DOSE IS A SOLVED FIELD, NOT A BOUNDING BOX ══════════
   layoutMetrics() used to charge for every shield whose CENTRE fell inside
   the core-to-ctrl bounding box, inflated by one cell, whether or not it
   stood in the beam - on the stock layout that billed all three shields
   when the ray only actually crosses one of them. rad.js replaces the whole
   thing with a solved field: every source cell casts 1/r^2, attenuated over
   the EXACT chord each straight ray crosses through every cell in its path
   (Amanatides-Woo), and P.dose is now that field read at the room the crew
   sit in - the same number layoutMetrics() bakes into P.radK for a renderer
   to read identically. */
console.log('\n=== CREW DOSE IS A SOLVED FIELD, NOT A BOUNDING BOX ===');
{ /* the scalar is not a second computation that happens to agree with the
     field today - it IS radAt() on P.radK, literally, at commissioning time */
  set({});
  const f=M.radSolve(M.P().radK, M.radSrc(null));
  const d=M.radAt(f, M.P().radK.crew);
  if(Math.abs(M.P().dose-d)>1e-12) bad(`P.dose (${M.P().dose}) and radAt() on P.radK (${d}) disagree`);
  console.log(`  P.dose === radAt(radSolve(P.radK,radSrc(null)),P.radK.crew): ${d.toFixed(6)}`);
}
{ /* pins RAD_K and the whole radMu table at once - this is the exact figure
     every s.release growth line in step.js (~713, ~777) was already tuned
     against before the field existed; drifting it rescales every release
     figure in the game */
  set({});
  if(M.P().dose<0.045||M.P().dose>0.052) bad(`default PWR P.dose is ${M.P().dose.toFixed(4)}, expected 0.045..0.052`);
  console.log(`  default PWR P.dose = ${M.P().dose.toFixed(4)}`);
}
{ /* move all three shields clear of the beam and the crew must read a lot
     more dose - measured at ~6.1x on the stock layout, so 4x is a floor with
     real margin that still fails hard the day the field quietly stops
     shielding anything */
  set({});
  const base=M.P().dose;
  const L=M.LAY(), sh=['shld0','shld1','shld2'].map(id=>L.parts.find(p=>p.id===id));
  const at=sh.map(p=>[p.x,p.y]);
  if(!M.moveTo(sh[0],13,0)||!M.moveTo(sh[1],14,0)||!M.moveTo(sh[2],15,0))
    bad('could not clear the stock shields off the beam to test with');
  M.commission();
  const clear=M.P().dose;
  if(clear<base*4) bad(`clearing every shield off the beam only raised dose ${base.toFixed(4)} -> ${clear.toFixed(4)}, expected >=4x`);
  else console.log(`  all three shields off the beam: dose ${base.toFixed(4)} -> ${clear.toFixed(4)} (${(clear/base).toFixed(1)}x)`);
  for(let i=0;i<sh.length;i++) M.moveTo(sh[i],at[i][0],at[i][1]);
  M.commission();
  if(Math.abs(M.P().dose-base)>1e-9) bad('putting the shields back did not restore the original dose');
}
{ /* THE CASE THE OLD FORMULA COULD NEVER PASS. A shield parked in a corner
     of the old inflated bounding box, nowhere near the actual core->crew
     ray, must cost the crew nothing - the box-counting formula would have
     charged for it purely on being inside the box. Move that SAME shield
     onto the ray afterwards and the dose has to fall, or "the ray" is
     decoration and the field is secretly still reading the box. Corner
     (1,4) and on-ray point (2,7) are specific to the stock layout (core
     3x3 at (2,4), ctrl 2x1 at (1,8)) and are asserted as found, not
     re-derived every run, so a future default-layout change fails this
     loudly instead of silently walking to a different corner. */
  set({});
  const L=M.LAY(), sh=['shld0','shld1','shld2'].map(id=>L.parts.find(p=>p.id===id));
  const at=sh.map(p=>[p.x,p.y]);
  M.moveTo(sh[0],13,0); M.moveTo(sh[1],14,0); M.moveTo(sh[2],15,0);
  M.commission();
  const none=M.P().dose;
  if(!M.moveTo(sh[0],1,4)) bad('could not place the corner shield for the off-line case');
  M.commission();
  const corner=M.P().dose;
  if(Math.abs(corner-none)>1e-9)
    bad(`a shield in the old bbox's corner, off the ray, moved dose ${none.toFixed(6)} -> ${corner.toFixed(6)}; a ray model must ignore it`);
  if(!M.moveTo(sh[0],2,7)) bad('could not place the shield back onto the ray');
  M.commission();
  const online=M.P().dose;
  if(!(online<corner*0.5))
    bad(`the same shield moved onto the ray only took dose ${corner.toFixed(4)} -> ${online.toFixed(4)}, expected at least half`);
  console.log(`  corner of the old bbox, off the ray: dose unchanged at ${corner.toFixed(4)}; the same shield ON the ray: ${online.toFixed(4)}`);
  for(let i=0;i<sh.length;i++) M.moveTo(sh[i],at[i][0],at[i][1]);
  M.commission();
}
{ /* Manhattan distance is a routing metric, not a radiation one. Two control
     room placements the same 7.5 cells away by taxicab distance but at
     different Euclidean range must not read the same dose, or the field has
     quietly fallen back to the old formula's notion of distance. */
  set({});
  const L=M.LAY(), ctrl=L.parts.find(p=>p.id==='ctrl'), at=[ctrl.x,ctrl.y];
  const doseAt=(x,y)=>{ if(!M.moveTo(ctrl,x,y)) return null; M.commission(); return M.P().dose; };
  const near=doseAt(0,0), far=doseAt(9,4);   // both 7.5 cells from the core centre by |dx|+|dy|
  M.moveTo(ctrl,at[0],at[1]); M.commission();
  if(near===null||far===null) bad('could not place the control room for the Manhattan-vs-Euclidean case');
  else if(Math.abs(near-far)<1e-6)
    bad(`two ctrl placements at equal taxicab distance gave the same dose (${near.toFixed(4)}); distance is not really Euclidean`);
  else console.log(`  equal taxicab distance (7.5 cells), unequal dose: (0,0) ${near.toFixed(4)} vs (9,4) ${far.toFixed(4)}`);
}
{ /* the RAD_FLOOR..RAD_CEIL clamp in radAt() has to hold across a real sweep
     of placements, not just the one layout the rest of this file measures */
  set({});
  const L=M.LAY(), ctrl=L.parts.find(p=>p.id==='ctrl'), at=[ctrl.x,ctrl.y];
  let checked=0;
  for(const [x,y] of [[0,0],[0,8],[9,4],[8,3],[6,7],[1,1],[0,4],[5,4]]){
    if(!M.moveTo(ctrl,x,y)) continue;
    M.commission(); checked++;
    if(M.P().dose<0.02||M.P().dose>3) bad(`ctrl at (${x},${y}) gave P.dose=${M.P().dose}, outside 0.02..3`);
  }
  M.moveTo(ctrl,at[0],at[1]); M.commission();
  if(checked<4) bad('the dose-bounds sweep placed too few layouts to mean anything');
  else console.log(`  P.dose stayed inside 0.02..3 across ${checked} control-room placements`);
}
{ /* guards the freeAdj() extraction: layoutMetrics() used to compute repair
     access inline, and a wrong inside/edge predicate makes default designs
     unbuildable - REPAIR ACCESS < 1 is a HARD block at commissioning, so a
     mistake here silently fails the whole design sweep at the top of this
     file rather than showing up as its own line. */
  set({});
  const acc=M.layoutMetrics().access;
  if(Math.abs(acc-1)>1e-9) bad(`default layout repair access is ${acc}, expected exactly 1.0`);
  else console.log(`  default layout repair access: ${(acc*100).toFixed(0)}%`);
}

/* ══════════ RADIATION IS LIVE, NOT A COMMISSIONING-TIME NUMBER ══════════
   Everything above this line asks what an ARRANGEMENT costs the crew at
   rating - P.dose, baked in once at commission() and never touched again.
   s.doseRate is the same field asked a different question every tick: what
   does THIS plant, right now, damaged or not, actually cost. The two had
   better agree at the one instant they are defined to (tick zero, before
   the plant has done anything) and had better diverge hard the moment an
   accident gives the source term something P.dose was never told about. */
console.log('\n=== RADIATION IS LIVE, NOT A COMMISSIONING-TIME NUMBER ===');
{ /* Every other actuator's demand starts equal to its actual so tick zero
     never reads a number the plant does not have yet (see the boron/rod/
     flow demands in resetPlant()) - doseRate is the same convention applied
     to a readout instead of an actuator. This is the assertion that catches
     the day somebody "simplifies" the initialiser back to 0. */
  const s=set({});
  if(Math.abs(s.doseRate-M.P().dose)>1e-9)
    bad(`clean plant doseRate (${s.doseRate}) disagrees with P.dose (${M.P().dose}) at tick zero`);
  console.log(`  clean plant, tick zero: s.doseRate === P.dose === ${s.doseRate.toFixed(4)}`);
}
{ /* THE FIELD IS LIVE: the same flow-kill fault the DOCUMENTED BEHAVIOUR
     block above already uses to break a plant, run far enough to melt the
     core. dmg is certain to be well past 25 long before that (it plateaus
     around 29% inside 15 s of the fault landing) - melt is the point the
     field cannot possibly still agree with a frozen P.dose, because RAD_MELT
     enters the source term the moment s.melt goes true and nothing about
     P.dose knows the core is molten. A static readout would sail through
     this unmoved; measured margin here is more than 5x, so the >3x floor
     has real slack in it.

     Run 30 s PAST melt before reading, which it did not have to be before.
     Losing the pumps is a much faster way to wreck a core than it was: the
     thermosiphon is solved off the plant's own geometry now instead of being
     floored at a fitted 24% of rated removal, so 5% pump flow reaches melt in
     about 6 s rather than about 160. The airborne term needs a moment to
     accumulate after that, and reading the instant melt latches is a race,
     not a measurement. */
  const s=set({}); run(s,10);
  s.byp.rps=true; s.flow=0.05; s.flowDem=0.05;
  let ticks=0; while(!s.melt && !s.breach && ticks<50*300){ M.step(0.02); ticks++; }
  if(!s.melt) bad('flow-kill + RPS bypass did not reach core melt inside 300 s of fault time; nothing to check the live field against');
  if(s.dmg<=25) bad(`core melted at only dmg=${s.dmg.toFixed(1)}%, expected well past 25%`);
  for(let i=0;i<50*30 && !s.breach;i++) M.step(0.02);
  if(s.doseRate<=M.P().dose*3)
    bad(`live doseRate only reached ${(s.doseRate/M.P().dose).toFixed(2)}x P.dose at melt; expected >3x`);
  console.log(`  flow-kill + bypass, run to melt + 30 s: dmg=${s.dmg.toFixed(0)}%, doseRate=${s.doseRate.toFixed(3)} (${(s.doseRate/M.P().dose).toFixed(1)}x the as-built figure)`);
}
{ /* CONTAINMENT REACHES THE FIELD: same fault, NONE (rel=1.0) against LARGE
     DRY (rel=.05) - P.contRel scales both the direct cladding-failure term
     and the rate the airborne term accumulates at, so the two containments
     have to read very different dose rates for identical damage. Sampled at
     60 s into the fault, on a fault chosen to STAY short of melt: RAD_MELT is
     a flat addition neither containment scales, so a molten core swamps the
     very difference this case exists to measure.
     42% pump flow, not 5%. It used to be 5%, which plateaued near 29% damage
     for well over a minute; with the thermosiphon solved off the plant rather
     than floored at a fitted 24%, 5% flow now melts in about 6 s. 42% is the
     same fault at the severity this case has always wanted: measured, damage
     is near 50% at 40 s and melt is still ahead of it, so the sample is taken
     at 40 s and both runs are asserted short of melt - a drift that starts
     melting this fault should say so, not report a bad ratio.

     Measured as the EXCESS over the plant's own as-built shine, not as a raw
     ratio of doseRate. A reactor at power lights its own room whatever
     containment is bolted round it - P.contRel scales the release, and
     nothing scales the operating source - so a raw ratio measures the
     containment's effect diluted by a term it cannot touch, and the dilution
     grows as the release shrinks. The excess is the containment's own
     contribution and nothing else, which is what this case has always been
     about.

     The baseline is each run's OWN shine at its own power, taken by clearing
     s.dmg and s.release and stepping once - not P.dose, which is the as-built
     figure at full power and is bigger than the shine of a plant this fault
     has knocked down to half of it. Subtracting the wrong baseline gives a
     negative excess, which is how this was caught. */
  const doseAt=cont=>{ const s=set({cont,contFit:true}); run(s,10);
    s.byp.rps=true; s.flow=0.42; s.flowDem=0.42;
    for(let i=0;i<50*40;i++) M.step(0.02);
    if(s.melt) bad(`the containment case's own fault melted the core before its sample - it can no longer measure what it exists to measure`);
    if(s.dmg<10) bad(`the containment case's own fault only reached ${s.dmg.toFixed(1)}% damage - there is no release to tell two containments apart by`);
    const hurt=s.doseRate;
    s.dmg=0; s.release=0; M.step(0.02);
    return hurt - s.doseRate; };
  const none=doseAt(0), large=doseAt(2);
  if(!(large>0)) bad(`LARGE DRY read no excess at all over its own as-built shine (${large}) - this case has nothing to divide by`);
  else if(none<large*5)
    bad(`containment NONE only read ${(none/large).toFixed(2)}x LARGE DRY's excess over its own shine, 40 s into the same fault; expected >=5x`);
  console.log(`  containment reaches the field: excess over each run's own shine, NONE ${none.toFixed(4)} vs LARGE DRY ${large.toFixed(4)} (${(none/large).toFixed(1)}x), 40 s into the same fault`);
}
{ /* NOTHING LIT AT REST, EVERY ARCHITECTURE - HI AREA RAD's own guard, named
     rather than folded into the blanket "no annunciator lit at rest" sweep
     near the top of this file, so a regression here says WHICH number moved
     instead of just which tile lit. It is safe by construction: the design
     source term is 1 by fiat (see radSrc() in rad.js), so P.dose is purely
     geometric and nowhere near RAD_HI - but "safe by construction" is a
     claim, and this is the check, not the assumption. */
  let worst=0, worstArch='';
  for(let a=0;a<ARCH.length;a++){
    const s=set({arch:a}); run(s,60);
    if(s.doseRate>worst){ worst=s.doseRate; worstArch=ARCH[a].id; }
    if(s.doseRate>=M.RAD_HI) bad(`${ARCH[a].id} at rest reads doseRate=${s.doseRate.toFixed(3)}, at or past RAD_HI (${M.RAD_HI})`);
  }
  console.log(`  HI AREA RAD dark at rest on every architecture; worst is ${worstArch} at ${worst.toFixed(4)} (RAD_HI=${M.RAD_HI})`);
}

/* ══════════ DOSE HAS TEETH ══════════
   Pillar 4 again, aimed at the repair party rather than an operator's switch:
   a hot field is never a reason the sim refuses a dispatch, only a reason it
   costs more. What it costs is TIME, via radWorkK() (step.js), and the panel's
   own ETA reads the identical helper - so there is exactly one formula and it
   cannot lie to itself. */
console.log('\n=== DOSE HAS TEETH: A HOT FIELD SLOWS A REPAIR PARTY, IT NEVER REFUSES ONE ===');
{
  /* COOL: the stock plant at rest, sent to the rod drives - the case the
     CLAUDE.md brief calls out by name. The default plant sits near 0.05x,
     far under RAD_SLOW (0.5x), so radWorkK() must return exactly 1 here and
     the job must run at the speed it always did. This plant is fully
     settled and nothing on it is evolving, so it is also the one case where
     the field a party stands in genuinely holds still for the whole job -
     which is what lets this same case check the advertised ETA below to
     the tick, not just the ratio. s.repRate is only ever written inside
     step()'s radiation block, so the tick right after a dispatch still
     holds whatever it read the last time a party was out (0, if none was) -
     one step lets the field catch up before anything is measured. */
  const cool=set({}); run(cool,5);
  M.repairStart('rods');
  if(!cool.repair) bad('dispatch on an undamaged, accessible component at rest was refused');
  const need=cool.repair.need;
  M.step(0.02); let ticksCool=1;
  const rate0=cool.repRate, k0=M.radWorkK(rate0);
  if(rate0>M.RAD_SLOW) bad(`the "cool" case reads repRate=${rate0.toFixed(3)}x, at or above RAD_SLOW - pick a colder case to prove the no-penalty floor`);
  if(Math.abs(k0-1)>1e-9) bad(`radWorkK(${rate0.toFixed(3)}) = ${k0}, expected exactly 1 at or below RAD_SLOW`);
  while(cool.repair && ticksCool<50*600) { M.step(0.02); ticksCool++; }
  if(cool.repair) bad('a repair job at rest never completed inside 600 s');
  const tCool=ticksCool*0.02;
  console.log(`  cool: repRate=${rate0.toFixed(3)}x, radWorkK=${k0.toFixed(3)}, job took ${tCool.toFixed(2)}s`);
  const est=need/k0;
  if(Math.abs(tCool-est)>0.021)
    bad(`advertised ETA need/radWorkK(rate) = ${est.toFixed(3)}s disagrees with the measured ${tCool.toFixed(3)}s by more than a tick`);
  else console.log(`  advertised ETA need/radWorkK(rate)=${est.toFixed(2)}s matches the measured ${tCool.toFixed(2)}s to within a tick`);

  /* HOT: the same flow-kill + RPS-bypass fault the RADIATION IS LIVE block
     already trusts, with containment stripped (rel=1.0, see the CONTAINMENT
     REACHES THE FIELD case above) so the field is strong enough to clear
     RAD_SLOW well before the core is anywhere near melting, and the party
     sent straight to the reactor vessel itself - the worst reachable spot
     on this or any plant. MEASURED, not assumed: with no containment fitted,
     dmg plateaus near 33% for about a minute before it climbs again toward
     melt. HALF pump flow, not 5%: the thermosiphon is solved off the plant's
     own geometry now rather than floored at a fitted 24% of rated removal, so
     5% flow reaches melt in about 6 s and there is no window left to finish a
     job in at all. Measured on the fault this case uses now: damage holds
     near 35% indefinitely and the core never melts, which is what it always
     wanted - the old 5% case survived only because it happened to plateau,
     and its window had already been whittled to 6 s by two components moving.
     This case does NOT hold the field perfectly still the way COOL does, so
     unlike COOL above it is only checked against the ratio below, not against
     the tick. */
  const hot=set({cont:0, contFit:true}); run(hot,10);
  hot.byp.rps=true; hot.flow=0.50; hot.flowDem=0.50;
  while(hot.t<10 && !hot.melt) M.step(0.02);
  if(hot.melt) bad('the no-containment fault reached melt before this case could even dispatch a party into it');
  M.repairStart('core');
  if(!hot.repair) bad('dispatch to the reactor vessel on an active, uncontained fault was refused - dose must slow a party, never turn it back');
  M.step(0.02);
  const rateHot=hot.repRate, kHot=M.radWorkK(rateHot);
  if(rateHot<=M.RAD_SLOW) bad(`even the reactor vessel on an uncontained fault only reads repRate=${rateHot.toFixed(3)}x - expected well past RAD_SLOW`);
  let ticksHot=1;
  while(hot.repair && !hot.partySpent && !hot.melt && ticksHot<50*300) { M.step(0.02); ticksHot++; }
  if(hot.melt) bad('the fault reached melt before this job finished - too tight a window to show a completed, merely slower, job');
  if(hot.partySpent) bad('the party was spent before this job finished - too severe a case to show a completed, merely slower, job');
  if(hot.repair) bad('a repair job into an active fault never completed inside a generous budget');
  const tHot=ticksHot*0.02;
  console.log(`  hot (reactor vessel, no containment, uncontained fault): repRate=${rateHot.toFixed(3)}x, radWorkK=${kHot.toFixed(3)}, job took ${tHot.toFixed(2)}s`);

  if(tHot < tCool*1.8)
    bad(`hot job (${tHot.toFixed(2)}s) was not even 1.8x the cool one (${tCool.toFixed(2)}s) - dose is not slowing the party enough to matter`);
  else console.log(`  neither dispatch was refused, both jobs completed, hot took ${(tHot/tCool).toFixed(1)}x as long as cool`);
}

/* radPeak() (rad.js) IS "where does it hurt most", the exact field the live
   doseRate/repRate readouts already trust - so asking it for the worst
   reachable spot, rather than guessing an id, is what makes the case below
   measure the real mechanic instead of a number this auditor made up. */
const hotSpot = s => M.radPeak(M.radSolve(M.radGeom(), M.radSrc(s))).who.id;

console.log('\n=== THE REPAIR PARTY CAN BE SPENT, AND IT IS PERMANENT ===');
{
  /* Drive s.dose to 100 for real: no containment, RPS bypassed, flow killed,
     run to melt, then a party sent to the worst spot the field itself names
     and left there - the accident this game is actually built to let happen,
     not an injected number. */
  const s=set({cont:0, contFit:true}); run(s,10);
  s.byp.rps=true; s.flow=0.05; s.flowDem=0.05;
  let mt=0; while(!s.melt && mt<50*300) { M.step(0.02); mt++; }
  if(!s.melt) bad('setup fault did not reach melt before this case could show a spent party');
  const spot=hotSpot(s);
  M.combatHit(spot);
  if(!s.dmgParts.includes(spot)) bad(`combatHit(${spot}) did not damage the very component this case sends the party to`);
  M.repairStart(spot);
  if(!s.repair) bad('the dispatch this case depends on was refused');
  let ticks=0;
  while(!s.partySpent && ticks<50*2000) { M.step(0.02); ticks++; }
  if(!s.partySpent) bad('s.dose never reached 100 and withdrew the party inside a generous budget');
  if(s.dose!==100) bad(`partySpent latched at s.dose=${s.dose}, expected exactly 100`);
  if(s.repair!==null) bad('the party was spent but s.repair was not cleared');
  if(!s.dmgParts.includes(spot)) bad(`the party was spent mid-job and ${spot}, the job it never finished, came back fixed anyway`);
  const dmgBefore=s.dmgParts.length, doseBefore=s.dose;
  M.repairStart(spot);
  if(s.repair) bad('a dispatch after the party was spent was carried out - it must be a silent no-op');
  if(s.dose!==doseBefore || s.dmgParts.length!==dmgBefore)
    bad('a refused dispatch after the party was spent still changed plant state');
  console.log(`  s.dose reached 100 on the ${spot} job: party withdrawn permanently, s.repair=null, ${spot} still in dmgParts, a second dispatch is a no-op`);

  M.resetPlant();
  if(M.S().partySpent!==false) bad('resetPlant() did not clear partySpent back to false');
  else console.log('  resetPlant() clears partySpent back to false');
}

/* ══════════ THE NETWORK IS PIPE_K-INVARIANT, AND KNOWS A SHORT LOOP FROM A LONG ONE ══════════
   netFlowK() (src/data/pipenet.js) is what feeds pumpK in step() now -
   loopFlowK(), the capacity-counting formula it replaced, is gone. This is
   what earns that.

   PIPE_K is a common scale on every resistance in the graph and the linear
   system is homogeneous in it, so whatever netFlowK() hands back has to be
   identical whichever PIPE_K the plant happened to be commissioned with -
   the whole calibration argument (pipenet.js's own note on PIPE_K) rests on
   that. It is checked two ways: with no damage or every pump lost, the
   answer is pinned exactly (1 or 0, no tolerance, over the same PIPE_K x
   loops x damage sweep Stage 1 used); for a fixed, partially-damaged plant,
   PIPE_K is swept three orders of magnitude and the result may drift only
   in the last few bits (1e-12), never move - if it ever moves more than
   that, someone put an ADDITIVE term into a conductance.

   The stock steam generators sit in a row (x = 7 + i*2), so the four loops'
   own primary pipe runs are NOT the same length - short to long, loop 0
   through loop 3 - and a solved network correctly gives the short loop more
   flow, because it is less resistance for the same head. loopFlowK() could
   never see this (a capacity count cannot tell which loop died); netFlowK()
   does, and that is the property that makes solving the network worth doing
   at all - killing the shortest loop's own pump must cost strictly more
   than killing the longest's. */
console.log('\n=== THE NETWORK IS PIPE_K-INVARIANT, AND KNOWS A SHORT LOOP FROM A LONG ONE ===');
{
  const dmgCases = n => [[], ['pump0'], ['pump0','pump1'], Array.from({length:n},(_,i)=>'pump'+i)]
    .filter(dmg => dmg.every(id => +id.slice(4) < n));   // drop cases that name a pump this loop count doesn't have
  let checked=0, refChecked=0;
  for(const k of [0.0006, 0.006, 0.06]){
    M.setPipeK(k);
    for(let n=1;n<=4;n++){
      const s = set({loops:n});
      if(!(M.P().netRef>0)) bad(`PIPE_K=${k} loops=${n}: P.netRef=${M.P().netRef}, expected >0`);
      else refChecked++;
      for(const dmg of dmgCases(n)){
        s.dmgParts = dmg;
        const nf = M.netFlowK(s);
        checked++;
        if(nf<0 || nf>1) bad(`PIPE_K=${k} loops=${n} dmg=[${dmg}]: netFlowK=${nf}, outside [0,1]`);
        if(dmg.length===0 && nf!==1) bad(`PIPE_K=${k} loops=${n}: no damage gave netFlowK=${nf}, expected exactly 1`);
        if(dmg.length===n && nf!==0) bad(`PIPE_K=${k} loops=${n}: every pump lost gave netFlowK=${nf}, expected exactly 0`);
      }
    }
  }
  console.log(`  no damage -> netFlowK===1 exactly, every pump lost -> netFlowK===0 exactly, always in [0,1]:`+
              ` ${checked} (PIPE_K x loops x damage) cases; P.netRef>0 on all ${refChecked} builds`);

  /* One fixed plant, one fixed (partial) damage set, PIPE_K swept three
     orders of magnitude - a tolerance rather than strict equality because
     netFactor()'s elimination runs on a differently-SCALED matrix each time
     (net.js), and floating point does not promise the same last bit off a
     different scale even when the algebra is exact. */
  const vals = [0.0006, 0.006, 0.06].map(k => { M.setPipeK(k);
    const s = set({loops:4}); s.dmgParts=['pump1']; return M.netFlowK(s); });
  M.setPipeK(0.006);   // restore the default so no later case in this run inherits a swept value
  const drift = Math.max(...vals) - Math.min(...vals);
  if(drift > 1e-12) bad(`netFlowK drifted ${drift} across a 100x PIPE_K sweep - an additive term crept into a conductance`);
  console.log(`  PIPE_K-invariant to ${drift.toExponential(2)} across a 100x sweep (pump1 dead, 4 loops)`);

  { const s = set({loops:4});
    s.dmgParts=['pump0']; const short = M.netFlowK(s);
    s.dmgParts=['pump3']; const long  = M.netFlowK(s);
    if(!(short < long))
      bad(`killing the shortest loop's pump (${(short*100).toFixed(1)}%) did not cost more than the longest's (${(long*100).toFixed(1)}%)`);
    console.log(`  4 loops, no junctions: shortest loop's pump lost -> ${(short*100).toFixed(1)}%,`+
                ` longest loop's pump lost -> ${(long*100).toFixed(1)}%`);
  }

  let archChecked=0;
  for(let a=0;a<ARCH.length;a++){
    set({arch:a});
    if(!(M.P().netRef>0)) bad(`${ARCH[a].id}: P.netRef=${M.P().netRef}, expected >0`);
    else archChecked++;
  }
  console.log(`  P.netRef>0 on all ${archChecked} architectures`);
}

/* ══════════ PRESSURE IS A PLACE, NOT A NUMBER ══════════
   The solve is ABSOLUTE now: every potential it hands back is a pressure in
   MPa, the pressurizer is the node that fixes the level, and elevation and
   density are in every edge's head. This block is what earns that.

   Read the head-invariance cases together, because the obvious version of the
   first one fails a CORRECT implementation. The network is homogeneous in
   head, so scaling EVERY head by k scales every flow by k and netFlowK() -
   which only ever consumes Q/P.netRef - cannot move. That holds under two
   conditions, and both are checked here rather than assumed:

     1. All heads together, not one term. Buoyancy does not scale with
        PUMP_H0, so sweeping PUMP_H0 alone changes the pump-to-buoyancy RATIO,
        which legitimately changes the flow split. It still cancels on an
        ISOTHERMAL plant, where buoyancy is exactly zero - that is a useful
        check and it is not the general one.
     2. A closed loop. A second fixed node (containment behind a break) is
        driven by an absolute difference that does not scale with head at all.

   A sweep of PUMP_H0 alone on a hot plant is not a bug report. It is the
   ratio changing, as it should. */
console.log('\n=== PRESSURE IS A PLACE, NOT A NUMBER ===');
{
  /* A plant that has actually been run, so s.coreDT is a real temperature
     rise and buoyancy is genuinely in the heads. Every case below that says
     "hot" means this state; "isothermal" means s.coreDT forced to 0, which is
     also exactly what a freshly commissioned plant is. */
  const hot=()=>{ const s=set({loops:4}); run(s,90); return s; };
  /* RE-COMMISSIONED inside the sweep, exactly the way the PIPE_K sweep above
     already does it. P.netRef is built at commission with whatever head the
     pumps had then, and netFlowK() is a ratio against it - sweep the head
     without rebuilding the reference and the ratio moves for that reason
     alone, which is bookkeeping and not a physics claim. The thermal state is
     then written back on, so every point in the sweep is the same plant at
     the same temperature and only the head differs. */
  const atHead=(setter,v,dt)=>{ setter(v); const t=set({loops:4}); t.coreDT=dt; return M.netFlowK(t); };

  { const s=hot();
    if(!(s.coreDT>5)) bad(`the hot case never developed a core temperature rise (coreDT=${s.coreDT}) - every buoyancy check below would be vacuous`);
    const dt=s.coreDT;
    const vals=[0.1,1,10].map(k=>atHead(M.setHeadK,k,dt));
    M.setHeadK(1); set({loops:4});
    const drift=Math.max(...vals)-Math.min(...vals);
    if(drift>1e-12) bad(`netFlowK drifted ${drift} across a 100x sweep of EVERY head - a head with an additive term in it`);
    console.log(`  every head scaled 100x: netFlowK invariant to ${drift.toExponential(2)} (coreDT=${dt.toFixed(1)} K)`);
  }

  { /* PUMP_H0 alone: invariant while isothermal, and it MUST NOT be invariant
       once the plant is hot. The second half is the one that matters - it is
       what proves buoyancy is actually contributing rather than being
       accidentally zero, which is the failure mode every other check here
       would sail straight through. */
    const warm=hot().coreDT;
    const iso=[0.2,0.6,3].map(v=>atHead(M.setPumpH0,v,0));
    const hotv=[0.2,0.6,3].map(v=>atHead(M.setPumpH0,v,warm));
    M.setPumpH0(0.60); set({loops:4});
    const isoDrift=Math.max(...iso)-Math.min(...iso);
    const hotDrift=Math.max(...hotv)-Math.min(...hotv);
    if(isoDrift>1e-12) bad(`isothermal, PUMP_H0 alone moved netFlowK by ${isoDrift} - buoyancy is not zero on an isothermal plant`);
    if(!(hotDrift>1e-9)) bad(`hot, PUMP_H0 alone left netFlowK unmoved (${hotDrift}) - buoyancy is contributing nothing, so every elevation case below is vacuous`);
    console.log(`  PUMP_H0 alone: isothermal invariant to ${isoDrift.toExponential(2)}, hot NOT invariant (${hotDrift.toExponential(2)}) - the pump-to-buoyancy ratio, as it should be`);
  }

  { /* AN ISOTHERMAL PLANT HAS NO BUOYANCY, AT ANY ELEVATION. Stronger than a
       flat plant and the check that actually matters: the elevations stay
       wild and only the temperature difference goes. A formulation that leaks
       here manufactures circulation out of geometry alone, which looks
       plausible and is a perpetual motion machine. Every static head must be
       identically 0.0 - not small - so the answer is bit-for-bit the
       pump-only one. */
    const s=set({loops:4});
    const net=M.P().net;
    let spread=0;
    for(let i=0;i<net.n;i++) spread=Math.max(spread,Math.abs(net.z[i]-net.z[net.core]));
    if(!(spread>3)) bad(`the layout is nearly flat (${spread.toFixed(2)} m of spread) - the isothermal case proves nothing on it`);
    s.coreDT=0;
    let anyStatic=0;
    for(const ed of net.edges) if(ed.kind!=='pump')
      anyStatic=Math.max(anyStatic,Math.abs(typeof ed.h==='function'?ed.h(s):(ed.h||0)));
    if(anyStatic!==0) bad(`isothermal, ${spread.toFixed(1)} m of elevation spread still produced a static head of ${anyStatic} - buoyancy is being read off the absolute column, not the anomaly`);
    if(M.netFlowK(s)!==1) bad(`isothermal, undamaged: netFlowK=${M.netFlowK(s)}, expected exactly 1`);
    console.log(`  isothermal over ${spread.toFixed(1)} m of elevation: every static head identically 0, netFlowK exactly 1`);
  }

  { /* NOTHING SILENTLY BECAME ZERO WHEN GROUND WENT AWAY. Both of the two
       places that used to special-case the ground node fail without throwing:
       netFlows() would read the core as being at zero pressure, and
       netCoreFracOf() would find no core edges at all and hand back 0. The
       first is caught by the core's own pressure being a real number well
       away from 0; the second by netFlowK() still being exactly 1. */
    const s=set({loops:4});
    if(M.netFlowK(s)!==1) bad(`undamaged plant after the ground node went away: netFlowK=${M.netFlowK(s)}, expected exactly 1`);
    const f=M.netPressures(s);
    if(!(f.core>1)) bad(`the core reads ${f.core} MPa - netFlows() is still treating it as the zero-potential ground node`);
    console.log(`  core is a node, not a ground: netFlowK still exactly 1, core reads ${f.core.toFixed(3)} MPa`);
  }

  { /* THE PRESSURIZER READS ITSELF. The P.dose identity, and the one check
       that catches a wrong anchor: whatever else the field does, the node
       whose pressure the solve is TOLD must hand that number back. */
    for(const n of [1,4]){
      const s=set({loops:n});
      for(const pres of [12, 15.5, 17.2]){
        s.P=pres;
        const got=M.netPressures(s).pzrb;
        if(Math.abs(got-pres)>1e-12) bad(`${n} loops, s.P=${pres}: the pressurizer node reads ${got}, expected its own pressure`);
      }
    }
    console.log('  pAt(pzr) === s.P to 1e-12, 1 and 4 loops, three pressures');
  }

  { /* PRESSURE FALLS THE RIGHT WAY ROUND THE LOOP. Highest at pump discharge,
       lowest at its suction - the one thing a reader of this field will check
       by eye, so it is checked here by measurement. */
    const s=set({loops:4}); run(s,60);
    const f=M.netPressures(s);
    for(let i=0;i<4;i++){
      if(!(f['pump'+i+'b']>f['pump'+i+'t']))
        bad(`pump${i}: discharge ${f['pump'+i+'b']} is not above suction ${f['pump'+i+'t']}`);
      if(!(f['pump'+i+'b']>f['sg'+i+'l']))
        bad(`pump${i} discharge ${f['pump'+i+'b']} is not above the far side of the loop (sg${i}l ${f['sg'+i+'l']})`);
    }
    console.log(`  round loop 0: discharge ${f.pump0b.toFixed(3)} -> core ${f.core.toFixed(3)}`+
                ` -> sg inlet ${f.sg0l.toFixed(3)} -> suction ${f.pump0t.toFixed(3)} MPa`);
  }

  { /* ELEVATION ROUTES THE THERMOSIPHON. Two steam generators, one hung high
       and one low, pumps stopped: the high one must carry more flow. This is
       the gap the pipe-network handover doc names and the one thing a
       correlation beside the solve can never close, however it is fitted -
       s.nat is one number for the whole plant and cannot tell one generator
       from another. */
    const s=set({loops:2});
    const sg0=M.LAY().parts.find(p=>p.id==='sg0'), sg1=M.LAY().parts.find(p=>p.id==='sg1');
    const y0=sg0.y, y1=sg1.y;
    M.moveTo(sg1, sg1.x, Math.min(8-sg1.h, y1+2));
    M.commission();
    const t=M.S();
    const net=M.P().net;
    const hi=net.z[net.index.sg0l], lo=net.z[net.index.sg1l];
    if(!(hi>lo)) bad(`the two generators did not end up at different heights (${hi} vs ${lo}) - this case proves nothing`);
    t.flow=0; t.coreDT=60;
    const byRun={};
    M.netFlowK(t, byRun);
    const q0=byRun['hot:corer-sg0l']||0, q1=byRun['hot:corer-sg1l']||0;
    if(!(q0>q1)) bad(`pumps dead, sg0 hung ${(hi-lo).toFixed(1)} m above sg1: sg0 carried ${q0} and sg1 ${q1} - elevation is not routing the thermosiphon`);
    else console.log(`  pumps dead, sg0 hung ${(hi-lo).toFixed(1)} m above sg1: sg0 carries ${(q0/q1).toFixed(2)}x sg1's buoyancy flow`);
    M.moveTo(sg1, sg1.x, y1); M.moveTo(sg0, sg0.x, y0); M.commission();
  }

  { /* A BREAK BREAKS THE INVARIANT, CORRECTLY. Said out loud because someone
       will later find a sweep that does not hold and "fix" it. A second fixed
       node - containment behind a hole - is driven by an ABSOLUTE difference
       between the loop and containment, and that does not scale with head at
       all. Scaling every head therefore genuinely changes the split between
       what goes round the loop and what goes out of the hole. */
    const vals=[0.5,1,2].map(k=>{ M.setHeadK(k); const t=set({loops:2});
      t.coreDT=25; t.dmgParts=['pipe:hot:corer-sg0l']; return M.netFlowK(t); });
    M.setHeadK(1); set({loops:2});
    const drift=Math.max(...vals)-Math.min(...vals);
    if(!(drift>1e-9)) bad(`a BREACHED plant stayed head-invariant (${drift}) - the break is not a second fixed node, it is still a blockage`);
    console.log(`  a break correctly breaks head-invariance: ${drift.toExponential(2)} across a 4x head sweep, because a hole is driven by an absolute difference`);
  }

  { /* A SEVERED PIPE LEAKS. Against HEAD this failed hard: cutting a primary
       hot leg lost no inventory at all, because a severance was modelled as a
       plugged pipe - the textbook large-break LOCA drawn as a blockage. */
    const s=set({loops:2}); run(s,10);
    const inv0=s.inv;
    M.combatHit('pipe:hot:corer-sg0l');
    for(let i=0;i<50*20;i++) M.step(0.02);
    if(!(s.inv < inv0-5)) bad(`a severed hot leg lost ${(inv0-s.inv).toFixed(2)}% of inventory in 20 s - a cut pipe is still being modelled as a plugged one`);
    if(!(s.P < 12)) bad(`a severed hot leg left the loop at ${s.P.toFixed(1)} MPa - a hole does not depressurise it`);
    console.log(`  a severed hot leg leaks: inventory ${inv0.toFixed(0)}% -> ${s.inv.toFixed(0)}% and pressure -> ${s.P.toFixed(1)} MPa in 20 s`);
  }

  { /* BREAK SIZE MATTERS, because bore already prices the opening. A full-bore
       hot leg against the relief-bore cross-tie the bench can place. */
    const drain=(key,secs)=>{ const s=set({loops:2}); run(s,10);
      const i0=s.inv; s.dmgParts.push('pipe:'+key);
      for(let i=0;i<50*secs;i++) M.step(0.02);
      return i0-s.inv; };
    const big=drain('hot:corer-sg0l',6), small=drain('hpi:hpib-coreb',6);
    if(!(big>small*2)) bad(`a full-bore hot leg (${big.toFixed(2)}%) did not drain more than twice as fast as the narrow injection line (${small.toFixed(2)}%) - bore is not pricing the opening`);
    console.log(`  break size matters: 6 s of a full-bore hot leg costs ${big.toFixed(1)}%, the 0.25-bore injection line ${small.toFixed(2)}%`);
  }

  { /* TWO OPEN ENDS. A cut pipe spills from both, so severing a run costs more
       than one opening of the same bore. Measured against the vessel's own
       single-ended breach, scaled by nothing - the claim is only that two ends
       beat one, and it is checked on the SOLVE rather than on a run, so
       nothing else about the plant can drift into the answer. */
    const s=set({loops:2}); run(s,10);
    const one={}, two={};
    s.dmgParts=[]; s.breach=true;  M.netFlowK(s,null,null,one);
    s.breach=false; s.dmgParts=['pipe:cold:sg0b-pump0t']; M.netFlowK(s,null,null,two);
    const edges=M.P().net.edges.filter(e=>e.kind==='break'&&e.key==='break:cold:sg0b-pump0t');
    if(edges.length!==2) bad(`a severed run offered ${edges.length} break edge(s), expected exactly 2 - a cut pipe has two open ends`);
    if(!(two.spill>0)) bad('a severed run spilled nothing at all');
    console.log(`  two open ends: a severed run carries ${edges.length} break edges and spills ${two.spill.toFixed(2)} against the vessel's ${one.spill.toFixed(2)} through one`);
  }

  { /* A BREAK STOPS WHEN IT EQUALISES. It used to run at a flat 2.4 %/s
       forever, whatever the pressure was, so an empty loop at containment
       pressure went on "draining". */
    const s=set({loops:2}); run(s,10);
    s.breach=true;
    let peak=0;
    for(let i=0;i<50*4;i++){ M.step(0.02); const o={}; M.netFlowK(s,null,null,o); peak=Math.max(peak,o.spill); }
    for(let i=0;i<50*300;i++) M.step(0.02);
    const o={}; M.netFlowK(s,null,null,o);
    if(!(peak>0)) bad('a ruptured vessel never spilled anything');
    if(!(o.spill < peak*0.25))
      bad(`a break still passing ${o.spill.toFixed(3)} against a peak of ${peak.toFixed(3)} after the loop has drained - it is a schedule, not a hole`);
    console.log(`  a break stops when it equalises: peak outflow ${peak.toFixed(2)} -> ${o.spill.toFixed(3)} at ${s.P.toFixed(2)} MPa against containment's ${M.P().Pcont}`);
  }

  { /* SHUT EVERY PRIMARY VALVE AND THE CORE COOKS. This FAILED against HEAD,
       and watching it fail is the point: the network correctly reported zero
       flow while the core went on being cooled, because natural circulation
       was a correlation that never looked at the plant. Measured on HEAD: a
       2-loop plant read netFlowK 0.000 with nat 0.243, tripped on LOW DNBR
       and survived. */
    const s0=set({loops:2});
    const runs=M.pipeNetwork().filter(r=>r.key&&(r.key.startsWith('hot:')||r.key.startsWith('cold:')));
    const ids=runs.map(r=>M.addFit('throttle', r.key, 0.5));
    M.commission();
    const s=M.S(); run(s,10);
    for(const id of ids){ s.valve[id]=0; s.valveDem[id]=0; }
    s.byp.rps=true;
    for(let i=0;i<50*400 && !s.melt;i++) M.step(0.02);
    if(!(M.netFlowK(s)===0)) bad(`every primary valve shut still gave netFlowK=${M.netFlowK(s)}, expected exactly 0`);
    if(!s.melt) bad(`every primary valve on the plant shut and the core did not melt (dmg=${s.dmg.toFixed(0)}%) - it is being cooled through pipes that are welded shut`);
    console.log(`  shut every primary valve: netFlowK exactly 0, nat ${s.nat.toFixed(3)}, and the core melts (dmg ${s.dmg.toFixed(0)}%)`);
    for(const id of ids) M.removeFit(id);
    M.commission();
  }

  { /* SEVER EVERY PRIMARY RUN AND THE CORE COOKS, AND THE LOOP DRAINS. Two
       gaps propping each other up, and both FAILED against HEAD: nat stayed
       at 0.243 and inventory stayed at 100%, because a severance did not
       leak. Measured there: it survived. */
    const s=set({loops:2}); run(s,10);
    for(const k of M.hittableRunKeys(M.P().net))
      if(k.startsWith('hot:')||k.startsWith('cold:')) s.dmgParts.push('pipe:'+k);
    s.byp.rps=true;
    /* run the whole window, not "until it melts": melt arrives first now and
       the loop goes on emptying through the holes afterwards, which is the
       half of this case HEAD could not do at all */
    for(let i=0;i<50*300;i++) M.step(0.02);
    if(!(M.netFlowK(s)===0)) bad(`every primary run severed still gave netFlowK=${M.netFlowK(s)}`);
    if(!(s.inv < 50)) bad(`every primary run severed left inventory at ${s.inv.toFixed(0)}% - a severed pipe is still not a hole`);
    if(!s.melt) bad(`every primary run severed and the core did not melt (dmg=${s.dmg.toFixed(0)}%)`);
    console.log(`  sever every primary run: netFlowK exactly 0, inventory ${s.inv.toFixed(0)}%, core melts`);
  }

  { /* A BADLY PIPED PUMP CAVITATES FIRST, and only that one. Two identical
       pumps; one gets a throttle on its own suction leg, so its suction
       pressure is genuinely lower and its water genuinely closer to flashing.
       This could not happen at all while cavitation was one scalar computed
       from s.P for the whole plant. */
    set({loops:2});
    const id=M.addFit('throttle','cold:sg0b-pump0t',0.5);
    M.commission();
    const s=M.S(); run(s,20);
    s.valve[id]=s.valveDem[id]=0.10;
    s.byp.rps=true;
    /* Depressurise, because that is what actually brings a loop to cavitation
       - the water does not get hotter, its boiling point comes down to meet
       it. Held down by hand each tick rather than waited for, so the case
       measures WHICH pump goes first and not how long a stuck relief valve
       takes to get there. */
    let firstBad=null, firstGood=null;
    for(let pset=15.5; pset>4 && firstGood===null; pset-=0.05){
      for(let i=0;i<10;i++){ s.P=pset; M.step(0.02); }
      if(firstBad===null && s.cavP[0]>0.02) firstBad=pset;
      if(firstGood===null && s.cavP[1]>0.02) firstGood=pset;
    }
    if(firstBad===null) bad('neither pump ever cavitated - this case measured nothing');
    else if(!(firstBad>firstGood))
      bad(`the throttled pump started cavitating at ${firstBad} MPa and its healthy twin at ${firstGood} - cavitation is not local to the pump that is piped badly`);
    else console.log(`  a badly piped pump cavitates first: the throttled one starts at ${firstBad.toFixed(2)} MPa, its identical twin only at ${firstGood.toFixed(2)} MPa`);
    M.removeFit(id); M.commission();
  }

  { /* CAVITATION CARRIES NO CONSTANTS OF ITS OWN. A source scan, because this
       is the check that stops the correlation growing back: the 6 K offset and
       the 12 K window that used to sit in s.cav were standing in for a fact
       the field states directly - cavitation begins when subcooling reaches
       zero - and the expression has to name the thing that says so. */
    const src=require('./bundle').bundle();
    const m=/s\.cavP\[i\][\s\S]{0,200}?;/.exec(src) || /const c = ([^;]*);/.exec(src);
    const line=(/const c = clamp\([^;]*\);/.exec(src)||[''])[0];
    if(!line) bad('could not find the cavitation expression at all to scan it');
    else {
      if(line.indexOf('scAt')<0) bad(`the cavitation expression does not name scAt: ${line}`);
      if(/[^A-Za-z_](6|12)[^0-9]/.test(line.replace('CAV_SPAN','')))
        bad(`the cavitation expression still carries a bare constant of its own: ${line}`);
      console.log(`  cavitation names the field and carries no constants of its own: ${line.trim()}`);
    }
  }

  { /* A THROTTLE SHOWS A REAL PRESSURE DROP, and it grows as the valve shuts.
       Today's readout is a fraction of a span; the differential a gauge would
       print is a number of MPa, and it has to move the right way. */
    const s0=set({loops:2});
    const tap=k=>{ const r=M.pipeNetwork().find(x=>x.key&&x.key.startsWith(k)); return [r.key,0.5]; };
    const id=M.addFit('throttle',...tap('hot:corer-sg0l'));
    M.commission();
    const s=M.S(); run(s,30);
    let last=-1, mono=true;
    const seen=[];
    for(const x of [1,0.5,0.25,0.12]){
      s.valve[id]=s.valveDem[id]=x;
      const f=M.netPressures(s);
      const drop=f.core - f.sg0l;
      seen.push(drop);
      if(last>=0 && !(drop>last)) mono=false;
      last=drop;
    }
    if(!mono) bad(`throttling hot leg 0 did not raise the core-to-generator drop monotonically: ${seen.map(v=>v.toFixed(4)).join(' -> ')} MPa`);
    else console.log(`  throttling hot leg 0 1.00 -> 0.12: core-to-generator drop ${seen.map(v=>v.toFixed(3)).join(' -> ')} MPa`);
    M.removeFit(id); M.commission();
  }
}


console.log('\n=== STAGE 5D: A SYSTEM WITH MASS IS A PART, NOT A CHECKBOX ===');
{ /* SOURCE RULE over derived()'s mass expression (design.js): every additive
     term must resolve to a part actually on the grid (partMass(), a count
     off LAY.parts/D.fit), a lattice/layout fact (coreMass, layMass,
     latMass()), or a term on the EXPLICIT exception list below, each with
     its own reason. This is the "checked, not trusted" half of Stage 5d -
     EFW/catcher/boroninj were each a flag with nothing on the grid for two
     stages running (the "+26 t toggle", "fuel labels off by 10x") before
     anyone wrote a check that could have caught it the day it landed.
     A regex scan of the SOURCE, not a behavioural probe, on purpose: a
     behavioural test can only ask about the terms it already knows to ask
     about, while this reads whatever derived() actually contains today and
     refuses anything it cannot place. */
  const fsM=require('fs'), pathM=require('path');
  const ROOTM=require('./bundle').ROOT;
  const stripComments=t=>t.replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g,' '))
                          .replace(/\/\/[^\n]*/g,m=>m.replace(/[^\n]/g,' '));
  // top-level '+' only - depth-aware, so a '+' inside a ?: or a call's own
  // parens never splits that term in half
  const splitTerms=expr=>{
    const out=[]; let depth=0, start=0;
    for(let i=0;i<expr.length;i++){ const c=expr[i];
      if('([{'.includes(c)) depth++;
      else if(')]}'.includes(c)) depth--;
      else if(c==='+' && depth===0){ out.push(expr.slice(start,i).trim()); start=i+1; } }
    out.push(expr.slice(start).trim());
    return out.filter(Boolean);
  };
  // PART: names a part on the grid, counted off LAY.parts or D.fit, never a
  // D flag. MEASURED: a lattice/layout fact, not a toggle at all. EXCEPTION:
  // a flag that sizes or upgrades a part whose own EXISTENCE is already
  // tracked elsewhere (contFit/turbFit/condFit gate the box itself in
  // buildLayout());
  // rps/autorod/scram/chan/foll/nbank/pdes/pzr/chim are quality or size
  // dials on core/rods/pzr/ctrl, which are always on the grid) - listed by
  // name, not inferred, so a NEW flag-only term can never hide in this set.
  const PART=new Set(['totalPumpCap()*PUMP_MASS','sgCount()*SGT[D.sg].mass',
    'partMass("catcher")',
    /* Per tank INSTANCE, off that instance's own vol and off whether it has a
       cell on the grid at all - so four tanks cost four tanks and a tank with
       no box (a hotwell, inside the condenser that is already priced) costs
       nothing twice. It replaced four flat per-name figures and D.accum's own
       +45 t, which between them priced the stock plant at exactly what this
       does. A widening of the PART set, not a weakening: it still resolves to
       boxes on the grid, just to a variable number of them. */
    'tankMass()',
    'Object.keys(D.fit).length*FIT_MASS']);
  const MEASURED=new Set(['coreMass','layMass','latMass()']);
  const EXCEPTION=new Set(['a.mass','f.mass','SCRAM[D.scram].mass','CHAN[D.chan].mass',
    '(D.contFit?CONT[D.cont].mass:0)','BKP[D.bkp].mass',
    '(D.pdes-1)*220','(D.pzr-1)*45','D.chim*38',
    '(D.rps?55:0)','FOLL[D.foll].mass','(D.nbank-4)*9',
    '(D.autorod?26:0)','(D.turbFit?D.turb*50:0)','(D.condFit?D.condCap*40:0)']);
  const classify=(designSrc)=>{
    const src=stripComments(designSrc);
    const m=/const mass\s*=([\s\S]*?);/.exec(src);
    if(!m) return {terms:null};
    const terms=splitTerms(m[1]);
    const unknown=terms.filter(t=>!PART.has(t)&&!MEASURED.has(t)&&!EXCEPTION.has(t));
    return {terms,unknown};
  };
  const designSrc=fsM.readFileSync(pathM.join(ROOTM,'src/data/design.js'),'utf8');
  const {terms,unknown}=classify(designSrc);
  if(!terms) bad('could not find "const mass=...;" in design.js to check - the source rule has nothing to scan');
  else if(unknown.length) bad(`derived()'s mass expression has a term this source rule cannot place: ${unknown.join(' | ')}`);
  else console.log(`  every one of ${terms.length} terms in derived()'s mass expression is a part, a measured fact, or a listed exception`);
  // FAULT INJECTION, on a string in memory only - never the real file. Puts
  // back the exact shape the "+26 t toggle"/EFW bugs had: a flag priced with
  // nothing on the grid behind it, and no exception entry naming it.
  const injected=designSrc.replace('const mass=a.mass','const mass=(D.efw2?38:0)+a.mass');
  const {unknown:injUnknown}=classify(injected);
  if(!injUnknown.length) bad('re-injecting (D.efw2?38:0) with no part behind it was NOT caught by the source rule - it is not checked, only trusted');
  else console.log(`  fault injection: re-adding "(D.efw2?38:0)" with no part or exception behind it IS caught: ${injUnknown.join(' | ')}`);
}
{ /* EVERY FITTED TOGGLE MOVES THE FIGURE ITS OWN TOOLTIP NAMES. Flip each
     one design-time (fitted vs not, never the runtime bypass switches
     already covered above) and measure the exact figure the tooltip claims
     - this is the shape of check that would have caught EFW's false "grace
     time" label, the +26 t toggle that did nothing, and the 10x fuel
     labels: all three were a claim nobody ever measured against the sim. */
  /* catcher and emergency feed get their own direct case rather than a
     shared table - each names a different kind of figure (an inventory, a
     coolant temperature) and forcing them through one shape would hide more
     than it would share. */
  const stockFig=(o,mk)=>{ set(o); if(mk) mk(); M.commission();
    const s=M.S();                      // commission() builds a FRESH S - the one set() handed back is stale
    run(s,10); s.scrammed=true; s.rodDem=1; run(s,120); return s; };
  { /* EMERGENCY FEED: "runs the loop a few degrees cooler after a trip"
       (inspector.js) - NOT grace time. It is a TANK now, so "not fitted" is
       the tank not being there, and nothing here names it: what makes a tank
       emergency feed is that it is on the secondary and opens itself on low
       generator level. */
    const efwIds=()=>M.tankIds().filter(id=>M.tanks()[id].side==='secondary' && M.tanks()[id].auto==='sglow');
    const on=stockFig({});
    const nOn=efwIds().length;
    const off=stockFig({}, ()=>{ for(const id of efwIds()) delete M.tanks()[id]; });
    if(!nOn) bad('the stock plant ships no emergency feed tank - nothing for this check to remove');
    if(!(on.Tavg<off.Tavg))
      bad(`EFW fitted did not run the loop cooler after a trip: off ${off.Tavg.toFixed(1)} K, on ${on.Tavg.toFixed(1)} K`);
    else console.log(`  EMERG FEED: no tank ${off.Tavg.toFixed(1)} K -> ${nOn} tank ${on.Tavg.toFixed(1)} K after a trip (its tooltip's own claim, not grace time)`);
    set({});
  }
  { /* CATCHER: "stops a melted core burning through and breaching the
       vessel" - step.js only drains s.inv on a melt when P.catcher is
       false (the burn-through itself), so inventory held after a long melt
       is exactly what the tooltip claims. */
    const run_=catcher=>{ const s=set({catcher}); s.melt=true; run(s,60); return s.inv; };
    const invOff=run_(false), invOn=run_(true);
    if(!(invOn>invOff))
      bad(`CORE CATCHER fitted did not hold inventory after a melt: off ${invOff.toFixed(1)}, on ${invOn.toFixed(1)}`);
    else console.log(`  CATCHER: inventory after a melt off=${invOff.toFixed(1)}% -> on=${invOn.toFixed(1)}% (its tooltip's own claim)`);
  }
}

console.log('\n=== ONE TANK. NO KINDS, NO PRESETS, NO SPECIAL CASES ===');
/* Add a tank, put boron in it, plumb it to the core. Nothing about this is a
   named system: it is TANK_DEFAULT with two knobs turned. */
const boronPlant=(n)=>{
  const s=set({});
  const ids=[];
  for(let i=0;i<n;i++){
    const id=M.addTank(0, 1+i);
    const t=M.tanks()[id];
    t.fluid='borated'; t.check=true; t.auto='manual';
    t.pump={p:11.0,bus:'bkp'}; t.gas=null;
    M.D().run['bor'+i]={a:id,af:null,b:'core',bf:'b',k:'boron',bore:0.20};
    ids.push(id);
  }
  M.commission();
  return {s:M.S(), ids};
};
/* Depressurised, so a tank charged above the loop actually delivers - the
   whole mechanic, and the thing an instant 4000 pcm never had to obey. */
const dumpWorth=(n,secs)=>{
  const {s,ids}=boronPlant(n);
  run(s,2);
  s.P=1.0; s.pCore=1.0;
  const b0=s.boron;
  for(const id of ids) s.tankOpen[id]=true;
  run(s,secs);
  return {d:b0-s.boron, s, ids};
};
{ const one=dumpWorth(1,60);
  if(!(one.d>0)) bad(`one boron tank delivered nothing: s.boron moved ${one.d.toFixed(0)} pcm`);
  else console.log(`  one boron tank, opened against a depressurised loop: ${one.d.toFixed(0)} pcm over 60 s, tank at ${one.s.tank[one.ids[0]].toFixed(0)} %`);
  /* Four tanks, four levels, four solved deliveries. Worth is per instance
     and additive - nothing caps the count and nothing sums a hardcoded 4000. */
  const four=dumpWorth(4,60);
  const ratio=one.d>0 ? four.d/one.d : 0;
  if(!(ratio>2.5))
    bad(`four boron tanks were not worth several times one: one ${one.d.toFixed(0)} pcm, four ${four.d.toFixed(0)} pcm (x${ratio.toFixed(2)})`);
  else console.log(`  four boron tanks: ${four.d.toFixed(0)} pcm, x${ratio.toFixed(2)} one tank's - additive, with four separate levels [${four.ids.map(i=>four.s.tank[i].toFixed(0)).join(', ')}] %`);
  /* And it is not instantaneous. An instant 4000 pcm was a number with no
     tank behind it; this arrives over the seconds the tank takes to empty. */
  const brief=dumpWorth(1,2);
  if(!(brief.d < one.d*0.9))
    bad(`a boron tank delivered its whole worth at once: 2 s gave ${brief.d.toFixed(0)} pcm against 60 s giving ${one.d.toFixed(0)} pcm`);
  else console.log(`  it takes time: 2 s of open valve is ${brief.d.toFixed(0)} pcm against ${one.d.toFixed(0)} pcm over 60 s`);
  set({});
}
{ /* A TANK WITH NO RUN TO IT DELIVERS NOTHING, visibly and in the solve -
     the same rule Stage 5a proved for relief. Disconnect the boron tank's
     own line into the core and demand no run reaches its node at all. */
  const {s,ids}=boronPlant(1); run(s,5);
  const nid=ids[0];
  const before=M.pipeNetwork().some(r=>r.key.indexOf(nid)>=0);
  if(!before) bad('the boron tank is on the grid but its own run never routed - nothing to disconnect for this check');
  M.removeRun('bor0'); M.commission();
  const after=M.pipeNetwork().some(r=>r.key.indexOf(nid)>=0);
  if(after) bad('removing the run left one still reaching the boron tank\'s own node');
  else console.log('  a disconnected boron tank routes no run at all - DISCONNECT is a real removal, not a cosmetic one');
  set({});
}
{ /* ZERO TANKS IS A LEGAL PLANT. A bad design, not a crash: it must still
     build, still solve, still commission and still run. */
  set({});
  for(const id of M.tankIds()) delete M.tanks()[id];
  M.commission();
  const s=M.S(); run(s,20);
  if(!(M.netFlowK(s)>0)) bad(`a plant with no tanks does not solve: netFlowK=${M.netFlowK(s)}`);
  else if(!(s.n>0.5)) bad(`a plant with no tanks does not run: n=${(s.n*100).toFixed(1)} %`);
  else console.log(`  zero tanks: the plant builds, solves and runs - netFlowK=${M.netFlowK(s).toFixed(3)}, n=${(s.n*100).toFixed(1)} %`);
  set({});
}
{ /* NOTHING KNOWS A TANK BY NAME. Rename every tank id and demand every
     figure this file pins comes back bit-identical. This is the one claim
     the whole refactor makes, and it goes red on any surviving hardcode. */
  const fig=()=>{ const s=set({}); run(s,10);
    return [s.n, s.Tf, s.dnbr, M.P().dose, M.P().flowK, M.netFlowK(s)]; };
  const before=fig();
  const T=M.tanks(), old=Object.keys(T), ren={};
  for(let i=0;i<old.length;i++) ren['zz'+i]=T[old[i]];
  /* the runs that pointed at them have to follow - a run names a PART, and
     renaming a part without its pipe is renaming half a plant */
  const R=M.D().run;
  for(let i=0;i<old.length;i++) for(const k in R){
    if(R[k].a===old[i]) R[k].a='zz'+i;
    if(R[k].b===old[i]) R[k].b='zz'+i;
  }
  for(const k of old) delete T[k];
  Object.assign(T, ren);
  M.commission();
  const s=M.S(); run(s,10);
  const after=[s.n, s.Tf, s.dnbr, M.P().dose, M.P().flowK, M.netFlowK(s)];
  const names=['n','Tf','dnbr','P.dose','P.flowK','netFlowK'];
  let moved=null;
  for(let i=0;i<after.length;i++) if(after[i]!==before[i]) moved=`${names[i]}: ${before[i]} -> ${after[i]}`;
  if(moved) bad(`renaming every tank moved a pinned figure - a hardcode survived. ${moved}`);
  else console.log(`  every tank id renamed (${old.join(', ')} -> ${Object.keys(ren).join(', ')}): n, Tf, DNBR, P.dose, P.flowK and netFlowK all bit-identical`);
  set({});
}
{ /* NOTHING REMEMBERS WHAT A TANK "WAS". Take the stock plant's own
     injection tank and switch it to boron; then take a tank added BLANK and
     set it to the same eight settings, standing in the same slot under the
     same id on the same pipe. Same id, same position, same order in
     D.tanks - the only thing that differs is which object the config started
     life as, and if that changes anything at all then something is
     remembering a kind that is not supposed to exist. */
  const CFG={side:'primary', vol:40, level:100, fluid:'borated',
             gas:null, pump:{p:11.0,bus:'bkp'}, check:true, auto:'manual', burst:null,
             name:'X', col:'#5aa9d6', cell:[0,1], tip:''};
  const worth=(mk)=>{ set({}); mk(); M.commission();
    const t=M.S(); run(t,2); t.P=1.0; t.pCore=1.0; const b0=t.boron;
    t.tankOpen.hpi=true; run(t,30); return b0-t.boron; };
  /* the stock injection tank, reconfigured in place */
  const reused=worth(()=>{ Object.assign(M.tanks().hpi, JSON.parse(JSON.stringify(CFG))); });
  /* a tank added blank through the bench's own ADD TANK, then given the same
     settings and moved into the same slot in D.tanks under the same id */
  const fresh=worth(()=>{
    const T=M.tanks(), order=Object.keys(T);
    const nid=M.addTank(0,1);
    const blank=T[nid]; delete T[nid];
    Object.assign(blank, JSON.parse(JSON.stringify(CFG)));
    const rebuilt={};
    for(const k of order) rebuilt[k] = k==='hpi' ? blank : T[k];
    for(const k of Object.keys(T)) delete T[k];
    Object.assign(T, rebuilt);
  });
  if(Math.abs(reused-fresh) > 1e-9)
    bad(`a reconfigured tank did not behave like a fresh one: reused ${reused.toFixed(6)} pcm, fresh ${fresh.toFixed(6)} pcm`);
  else console.log(`  the stock injection tank switched to boron delivers exactly what a blank tank set to boron does: ${reused.toFixed(3)} pcm, identical to 1e-9`);
  set({});
}


/* THE HOTWELL IS A TANK. It has no cell of its own - it lives inside the
   condenser it condenses into - which is exactly what hostedTankIds() names,
   and nothing here knows it by any other description. Two hosted tanks pool
   and read as one, the same way the plant treats them. */
const HW = s => M.tankPoolPct(s, M.hostedTankIds());
const HWO = s => { let q=0; for(const id of M.hostedTankIds()) q += (s.tankOver&&s.tankOver[id])||0; return q; };

/* ══════════ THE SECONDARY CONSERVES WATER (Stage 6a) ══════════
   s.sgl was clamp(50+(heat-s.load)*40-(s.load-1)*14,0,100) - recomputed from
   scratch every tick, with no memory, so it could not run out however long the
   feedwater was gone. Measured on the old code: combatHit('feed') then 600 s
   left it steady at 44.118 forever, on BOTH generator types identically, while
   DMGFX.feed's own text promised "the steam generator will boil dry if this is
   not fixed".

   Nothing pinned s.sgl or P.graceK before this block existed. */
console.log('\n=== SECONDARY INVENTORY ===');
{ const SGT=M.SGT();
  /* The whole re-pin argument in one check: the feed controller holds the
     setpoint exactly, so an undamaged plant's sgWet is exactly 1, so heat
     removal is bit-identical to what it was before the secondary had a mass
     balance at all. Every other figure this auditor pins rests on this one. */
  let held=[];
  for(const sg of [0,1]){ const s=set({sg}); run(s,600);
    if(Math.abs(M.sglMin(s)-50) > 1e-9) held.push(SGT[sg].name+' drifted to '+M.sglMin(s).toFixed(6)); }
  if(held.length) bad('an undamaged plant does not hold the feed setpoint: '+held.join('; '));
  else console.log('  an undamaged plant holds 50.000000 % for 600 s on both generator types - sgWet is exactly 1, so removal is untouched');

  /* MEMORY. The old level was a pure function of (heat, load) with no dt in
     it, so two plants alike in everything but their level history collapsed
     onto the same number in a single tick. An integral keeps them apart. This
     is the structural claim; the boil-dry numbers below are its consequence. */
  /* Same plant, same heat, same load, two levels: an integral moves each by
     at most one tick's worth and leaves them ~60 points apart. */
  { const s=set({}); run(s,60);
    const g=M.sgIds()[0];
    s.sglBy[g]=20; M.step(0.02); const after20=s.sglBy[g];
    s.sglBy[g]=80; M.step(0.02); const after80=s.sglBy[g];
    if(Math.abs(after80-after20) < 50)
      bad('s.sgl has no memory: two levels 60 points apart collapsed to '+
          after20.toFixed(3)+' / '+after80.toFixed(3)+' in one tick - that is a correlation, not an integral');
    else console.log('  s.sgl remembers: 20 % and 80 % stay '+(after80-after20).toFixed(3)+
                     ' points apart after a tick, where a correlation would collapse them');
  }

  /* The mechanic the bench has always sold in prose, now measured. SGT.water
     is the only thing that differs between these two runs, and the drain rate
     has to track it: a once-through unit holds ~8x less water and empties ~8x
     faster. graceK is deliberately NOT what does this any more.

     Measured over THREE seconds, and the window is load-bearing: a
     once-through unit is through SG_DRY inside ten, and past it removal
     collapses and the drain slows itself down. Average over twenty and the
     ratio reads 2.7x - the feedback, not the inventory. */
  const drain=sg=>{ const s=set({sg}); run(s,10); M.combatHit('feed');
                    const from=M.sglMin(s); run(s,3); return (from-M.sglMin(s))/3; };   // %/s
  const dU=drain(0), dO=drain(1);
  const wRatio=SGT[0].water/SGT[1].water;
  if(!(dU>0.05)) bad('a hit feed pump does not drain a U-TUBE generator at all ('+dU.toFixed(4)+' %/s) - DMGFX.feed is still a promise the code cannot keep');
  else if(Math.abs(dO/dU - wRatio)/wRatio > 0.15)
    bad('the drain ratio is '+(dO/dU).toFixed(2)+'x where SGT.water says '+wRatio.toFixed(2)+
        'x - the boil-dry rate is not being set by the inventory (U-TUBE '+dU.toFixed(3)+', ONCE-THROUGH '+dO.toFixed(3)+' %/s)');
  else console.log('  a hit feed pump drains U-TUBE at '+dU.toFixed(3)+' %/s and ONCE-THROUGH at '+
                   dO.toFixed(3)+' %/s - a ratio of '+(dO/dU).toFixed(2)+'x against SGT.water\'s '+wRatio.toFixed(2)+'x');

  /* THE FEEDBACK, and the half that never existed. A generator with no water
     in it is a heat exchanger with nothing on the cold side. Before this, a
     boiled-dry generator went on removing full rated power for ever.

     Against a CONTROL held wet at the setpoint, not against a bare threshold.
     Automatic rod control fights the runaway - it sees the temperature climb
     and runs the reactor back, so the absolute rise is small (3.3 K) while the
     power it had to give up to get there is most of the plant. The pair is
     what isolates the secondary; either one alone measures the controller. */
  { const held=lvl=>{ const s=set({}); run(s,10); const T0=s.Tavg, n0=s.n;
      for(let i=0;i<50*60;i++){ for(const g of M.sgIds()) s.sglBy[g]=lvl; M.step(0.02); }
      return {dT:s.Tavg-T0, dn:s.n-n0}; };
    const dry=held(0), wet=held(50);
    if(!(dry.dT > wet.dT+2 && dry.dn < wet.dn-0.2))
      bad('a generator held at 0 % level still removes heat: dry Tavg '+dry.dT.toFixed(2)+
          ' K / power '+dry.dn.toFixed(3)+' against wet '+wet.dT.toFixed(2)+' K / '+wet.dn.toFixed(3));
    else console.log('  a generator held dry stops being a heat sink: Tavg +'+dry.dT.toFixed(1)+
                     ' K and power '+dry.dn.toFixed(2)+' in 60 s, against '+wet.dT.toFixed(1)+
                     ' K and '+wet.dn.toFixed(2)+' held wet');
  }

  /* EFW refills something real. It was 0.08 bolted onto the steam dump and
     touched no inventory at all. It starts on LOW LEVEL, not on being armed -
     an emergency pump feeding a healthy generator would overfill it (measured
     at 82 % on a once-through unit before the gate went in).

     THREE THINGS CHANGED ABOUT THIS MEASUREMENT, and each is a consequence of
     the reserve being a real tank rather than a fraction of rated steam:
     - AFTER A TRIP, with the load actually shed. Its own tooltip says decay
       heat is what it is for, and a 1200 MW generator at full power boils a
       whole reserve away in about three seconds. That is not a bug in the
       tank, it is the size of the machine.
     - WHILE THE TANK STILL HAS WATER (15 s). Past that the reserve is spent
       and the level settles wherever the crippled main feed balances the
       steam - and it settles LOWER with the reserve than without, because a
       generator that is still wet is still a heat sink and boils faster. The
       end-of-window level measures that feedback, not the reserve.
     - AT THE GATE, not above it. The level being held at exactly SG_DRY is
       the "starts on low level, not on being armed" rule doing its job. */
  { const at15=efw=>{ const s=set({sg:1}); run(s,10);
      for(const id in s.tankByp) s.tankByp[id]=!efw; M.combatHit('feed');
      s.scrammed=true; s.rodDem=1; s.load=s.loadDem=0.05;
      run(s,15);
      const t=M.tankIds().find(id=>M.tanks()[id].auto==='sglow');
      return {lvl:M.sglMin(s), left:t?s.tank[t]:100}; };
    const offR=at15(false), onR=at15(true);
    const off=offR.lvl, on=onR.lvl;
    if(!(on > off+0.5)) bad('EMERG FEED refills nothing: level sits at '+off.toFixed(2)+' without it and '+on.toFixed(2)+' with it');
    else if(!(onR.left < 90)) bad('EMERG FEED held the level without spending any of its own tank: '+onR.left.toFixed(1)+' % left');
    else console.log('  EMERG FEED holds a hit plant at '+on.toFixed(2)+' % where it sits at '+off.toFixed(2)+
                     ' % without it, and it pays for it out of its own tank ('+onR.left.toFixed(0)+' % left, from 100)');
  }

  /* INJECTION - the boil-dry difference must come from SGT.water and nothing
     else. Make the two rows hold the same water and the check above has to go
     red, or it is reading graceK or a count by accident. */
  { const keep=SGT[1].water; SGT[1].water=SGT[0].water;
    const d2=(sg=>{ const s=set({sg}); run(s,10); M.combatHit('feed');
                    const from=M.sglMin(s); run(s,3); return (from-M.sglMin(s))/3; })(1);
    SGT[1].water=keep; set({});
    if(d2 > dU*3) bad('inject: SGT.water equalised and ONCE-THROUGH still drained '+(d2/dU).toFixed(1)+'x faster - the drain check is reading something other than the water');
    else console.log('  inject: SGT.water equalised   caught by "a hit feed pump drains ... off SGT.water alone" ('+(d2/dU).toFixed(2)+'x, was '+(dO/dU).toFixed(1)+'x)');
  }
  /* graceK USED TO BE COMPUTED TWICE, independently, from the same raw inputs
     - once in derived() and once in commission() - so a partial fix succeeded
     in one file and silently did not in the other. sgInertiaK() is the one
     helper both read now, and this is the check that says so: move SGT[].mass
     and BOTH figures have to follow it. One that moves alone means the
     duplicate is back.

     The old SGT[].graceK field is gone. It was charging for the boil-dry time
     that SGT[].water now buys outright. U-TUBE normalises to exactly 1.0, so
     the stock plant's P.graceK - and every trip calibrated against it - does
     not move; only ONCE-THROUGH does, 0.68 -> 0.60. */
  { if(SGT.some(r=>'graceK' in r))
      bad('SGT still carries a graceK field - it double-charges the boil-dry time SGT.water now buys');
    const read=sg=>{ set({sg}); return {P:M.P().graceK, d:M.derived().grace}; };
    const u=read(0), keep=SGT[1].mass;
    SGT[1].mass=SGT[0].mass;
    const same=read(1);
    SGT[1].mass=keep;
    const diff=read(1);
    set({});
    if(Math.abs(same.P-u.P)>1e-12 || Math.abs(same.d-u.d)>1e-9)
      bad('SGT[].mass equalised and the two generator types still disagree on grace ('+
          same.P.toFixed(4)+'/'+same.d.toFixed(2)+' against '+u.P.toFixed(4)+'/'+u.d.toFixed(2)+
          ') - something other than sgInertiaK() is still setting it');
    else if(!(Math.abs(diff.P-u.P)>1e-6 && Math.abs(diff.d-u.d)>1e-6))
      bad('SGT[].mass restored and only '+(Math.abs(diff.P-u.P)>1e-6?'commission()':'derived()')+
          ' followed it - graceK is computed twice again');
    else console.log('  sgInertiaK() is the one grace helper: SGT[].mass moves P.graceK '+
                     u.P.toFixed(4)+' -> '+diff.P.toFixed(4)+' AND derived().grace '+
                     u.d.toFixed(1)+' -> '+diff.d.toFixed(1)+' s together, and equalising it collapses both');
  }
  /* THE POINT OF SPLITTING IT. plant.js printed one global s.sgl on every
     generator's panel whichever one you clicked, which is the bug per-generator
     exists to fix. Two generators, one loop's pump destroyed: heat crosses into
     a generator in proportion to the flow through its OWN loop (sgShare(), off
     the netOut.byLoop the solve already computed and used to throw away), so
     the starved loop's generator boils down slower than its twin.

     CLAUDE.md's core rule still holds and this does not break it: the core
     stays axisymmetric and total flow is what it sees. The asymmetry lives in
     the generators, which is exactly where the file says per-loop asymmetry
     belongs. */
  { const s=set({loops:2}); run(s,10);
    const ids=M.sgIds();
    if(ids.length<2) bad('a 2-loop plant built only '+ids.length+' generator(s) - nothing to tell apart');
    else {
      const w=M.sgShare(null);
      s.dmgParts=['pump0']; M.combatHit('feed');
      const from=ids.map(id=>M.sgLvl(s,id));
      run(s,15);
      const drop=ids.map((id,i)=>from[i]-M.sgLvl(s,id));
      if(!(Math.abs(drop[0]-drop[1]) > 0.5))
        bad('two generators on a plant with one loop starved boiled down the same: '+
            drop.map(d=>d.toFixed(2)).join(' / ')+' - s.sglBy is split but nothing feeds the halves differently');
      else console.log('  a starved loop boils its OWN generator down slower: '+
            ids.map((id,i)=>id+' '+drop[i].toFixed(2)).join(', ')+' %, off sgShare() (equal split reads '+
            ids.map(id=>w[id].toFixed(2)).join('/')+')');
    }
    set({});
  }
  /* ── THE HOTWELL: the secondary as ONE closed system ──
     Not a TANK row, deliberately: a TANK row is a hydraulic object with an
     elevation, a node and an edge into the solve, and the secondary still has
     no solve, only a boundary. A hotwell with a node would invent the very
     thing CLAUDE.md says is not there. It is a MASS balance instead, in the
     same kilograms the generators are counted in - which is what makes the
     conservation check below possible at all. */
  { const s=set({}); run(s,300);
    if(Math.abs(HW(s)-50) > 1e-9)
      bad('an undamaged plant does not hold its hotwell still: 50 -> '+HW(s).toFixed(6)+
          ' over 300 s - steam raised and feedwater returned are not cancelling');
    else console.log('  a closed secondary holds its hotwell at 50.000000 % for 300 s - what boils out comes back');
  }
  /* CONSERVATION, and the reason the secondary inventory is worth having at
     all. Water that leaves a generator has to arrive somewhere.

     THE WHOLE SIDE, not just one pair. The emergency reserve is a tank on
     this side too, and its water goes through the generator and ends up in
     the hotwell exactly like the generator's own - so a balance drawn round
     the generator and the hotwell alone reads the reserve's contribution as
     water arriving from nowhere. Measured on exactly that mistake: 21463 kg
     out of the generator against 40713 kg into the hotwell, the difference
     being the reserve emptying itself.

     Everything is in the same kg (sgMass() and tankKg()), so this is an
     equality and not a correlation: with nothing overflowing and no dump
     valve open, the TOTAL cannot move at all. */
  { const s=set({}); run(s,10);
    const genKg=st=>{ let m=0; for(const g of M.sgIds()) m += M.sgLvl(st,g)/100*SGT[M.D().sg].water*1000; return m; };
    const tankKgOf=st=>{ let m=0;
      for(const id of M.tankIds()) if(M.tanks()[id].side==='secondary') m += st.tank[id]/100*M.tankKg(id);
      return m; };
    const total=st=>genKg(st)+tankKgOf(st);
    const t0=total(s), g0=genKg(s);
    M.combatHit('feed'); run(s,90);
    const moved=Math.abs(g0-genKg(s)), err=Math.abs(total(s)-t0);
    if(!(moved>1000)) bad('the feed hit moved almost no water at all ('+moved.toFixed(0)+' kg) - nothing to conserve');
    else if(HWO(s)>0 || HW(s)>=100)
      bad('the hotwell overflowed inside the conservation window - this window has to be one where nothing leaves the plant');
    else if(err/moved > 0.01)
      bad('the secondary does not conserve water: '+moved.toFixed(0)+' kg left the generators and the books are '+
          err.toFixed(0)+' kg out');
    else console.log('  the secondary conserves as ONE closed system: '+moved.toFixed(0)+
          ' kg left the generators, every kg of it is still on the secondary side, total out by '+
          (100*err/Math.max(t0,1)).toFixed(4)+' %');
  }
  /* A TUBE RUPTURE IS A LEAK INTO THE SECONDARY, so the secondary total GROWS
     and the water ends up here. This is the operational problem the game could
     not pose before: the hotwell fills and has to go somewhere. */
  { const s=set({}); run(s,10); const h0=HW(s);
    M.combatHit('sg0'); run(s,200);
    if(!(HW(s) > h0+10))
      bad('a tube rupture does not fill the hotwell: '+h0.toFixed(1)+' -> '+HW(s).toFixed(1)+
          ' % - primary water is crossing into the secondary and going nowhere');
    else if(!(HWO(s) > 0))
      bad('the hotwell reached '+HW(s).toFixed(1)+' % and overflowed nothing - a clamp that swallows a rupture reports nothing');
    else console.log('  a tube rupture fills the hotwell '+h0.toFixed(0)+' -> '+HW(s).toFixed(0)+
          ' % and then overflows it at '+HWO(s).toFixed(0)+' kg/s');
    set({});
  }
  /* THE OPERATOR'S ANSWER. A hotwell that only ever overflowed posed the
     problem without offering the move. HOTWELL DUMP is an ACT like any other -
     recorded, scrubbed, scriptable - and it never refuses: open it on a healthy
     plant and the feed pumps lose the water they live on. */
  { const s=set({}); run(s,10);
    M.combatHit('sg0'); run(s,200);
    if(!(HWO(s) > 0)) bad('the SGTR did not overflow the hotwell - nothing for the dump to answer');
    else {
      const full=HW(s);
      for(const t of M.hostedTankIds()) M.act('tankDump',t); run(s,120);
      if(!(HW(s) < full-10) || HWO(s) > 0)
        bad('HOTWELL DUMP did not empty it: '+full.toFixed(1)+' -> '+HW(s).toFixed(1)+
            ' %, still overflowing at '+HWO(s).toFixed(0)+' kg/s');
      else console.log('  HOTWELL DUMP answers a tube rupture: '+full.toFixed(0)+' -> '+
            HW(s).toFixed(0)+' % and the overflow stops');
    }
    /* and it never refuses a bad order */
    const h=set({}); run(h,10); const g0=M.sglMin(h);
    for(const t of M.hostedTankIds()) M.act('tankDump',t); run(h,120);
    /* Not "it empties": it settles where the dump balances what the closed
       loop still condenses back, and that point is BELOW HOT_NPSH - so the
       feed pumps are on tapered suction and the generator is losing water.
       That is the cost, and the game charges it without ever refusing. */
    if(!(HW(h) < HOT_NPSH_A && M.sglMin(h) < g0-1))
      bad('HOTWELL DUMP on a healthy plant left '+HW(h).toFixed(1)+' % with the generator at '+
          M.sglMin(h).toFixed(1)+' (from '+g0.toFixed(1)+') - the game refused a bad order');
    else console.log('  ...and it never refuses a bad order: dumped on a healthy plant it settles at '+
          HW(h).toFixed(1)+' %, under the '+HOT_NPSH_A+' % suction limit, and the generator falls '+
          g0.toFixed(1)+' -> '+M.sglMin(h).toFixed(1)+' %');
    set({});
  }

  /* ── EVERY GENERATOR HAS ITS OWN SECONDARY PRESSURE (Stage 6b) ──
     secP() was one scalar of s.load applied to every generator's fixed node.
     Stage 1A made the NODE per generator and then fixed all of them at the
     identical number, so an SGTR's driving differential could not differ loop
     to loop - and CLAUDE.md's claim that per-loop asymmetry lives in the steam
     generators was not yet true. MEASURED on the old code, 2-loop plant with
     pump0 destroyed, 20 s: sg0t 6.975, sg1t 6.975, bit-identical. */
  { const s=set({loops:2}); run(s,10);
    const before=M.netPressures(s);
    /* NOT an equality on the untouched plant, and that is the point. CLAUDE.md
       states the stock loops are NOT the same length - generators sit in a row
       at x = 7 + i*2, so loop 0 is the short one and carries more flow. That
       asymmetry has been in the solve since the network landed and could not
       reach the generators while secP() was one scalar. Now it does: the short
       loop's generator sits higher. Asserting equality here would have been
       asserting a premise this project explicitly calls physically false. */
    if(before.sg0t===undefined || before.sg1t===undefined)
      bad('a 2-loop plant has no sg0t/sg1t node to read - Stage 1A per-generator steam port is missing');
    else if(!(before.sg0t > before.sg1t + 0.01))
      bad('the short loop generator does not sit above the long one ('+
          before.sg0t.toFixed(4)+' / '+before.sg1t.toFixed(4)+
          ') - loop length reaches the flow but still not the secondary');
    else {
      const gap0=before.sg0t-before.sg1t;
      s.dmgParts=['pump0']; run(s,20);
      const f=M.netPressures(s);
      if(!(f.sg0t < f.sg1t))
        bad('pump0 destroyed and its own generator still sits above its neighbour ('+
            f.sg0t.toFixed(4)+' / '+f.sg1t.toFixed(4)+') - secP() is not reading this loop own flow');
      else console.log('  each generator carries its own secondary pressure: untouched, the SHORT loop leads by '+
            gap0.toFixed(3)+' MPa ('+before.sg0t.toFixed(3)+'/'+before.sg1t.toFixed(3)+
            '); starve loop 0 and it reverses to '+f.sg0t.toFixed(3)+'/'+f.sg1t.toFixed(3)+
            ' MPa - one scalar for all of them could do neither');
    }
    set({});
  }
  /* ── PRESSURIZER LEVEL IS AN INTEGRAL (Stage 6c) ──
     THE TRAP THIS BLOCK EXISTS TO AVOID. The obvious check - "heat the loop at
     constant inventory and see the level move" - PASSES ON THE UNFIXED CODE.
     Measured on the old correlation: Tavg +10 K with s.inv pinned moved s.lvl
     54.059 -> 63.058, exactly its -0.9 coefficient, by direct algebraic
     substitution, integrating nothing. A check that goes green either way is
     not a check.

     So this asserts the STRUCTURE instead: the level is the integral of a
     SOLVED CONDUCTANCE FLOW, which means severing the surge line has to stop
     the gauge dead. A correlation goes on moving the needle through a pipe
     that is not there - it never asked. */
  { const s=set({}); run(s,30);
    /* a real thermal transient: drop the load and the programme cools the loop */
    const l0=s.lvl, T0=s.Tavg; s.load=0.8; s.loadDem=0.8; run(s,60);
    const moved=Math.abs(s.lvl-l0);
    if(!(moved > 1))
      bad('a 60 s cooldown moved the pressurizer level only '+moved.toFixed(3)+' points - nothing to tell apart');
    else {
      /* CALIBRATION, deliberately unchanged: LVL_K is the loop/pressurizer
         volume ratio the old correlation implied, so the same transient still
         reads the same 0.9 %/K it always did. What changed is where the number
         comes from, not what it is. */
      const want=0.9*Math.abs(s.Tavg-T0);
      if(Math.abs(moved-want)/Math.max(want,1e-9) > 0.02)
        bad('the level integral no longer matches the correlation it replaces: '+
            moved.toFixed(3)+' points against '+want.toFixed(3)+' (0.9 %/K over '+
            Math.abs(s.Tavg-T0).toFixed(2)+' K) - LVL_K is not 0.9/(100*BETA_W)');
      else console.log('  the level integral reproduces the correlation exactly: '+moved.toFixed(2)+
            ' points over '+Math.abs(s.Tavg-T0).toFixed(2)+' K, against 0.9 %/K = '+want.toFixed(2));
      /* THE STRUCTURAL CLAIM: MEMORY. The old level was an algebraic function
         of (Tavg, vf, inv) recomputed from scratch, so two plants alike in all
         three collapsed onto the same number in a single tick whatever their
         history. An integral keeps them apart. This is the same shape as the
         s.sgl memory check above and it is decisive in the same way - it
         cannot go green on the correlation.

         NOT a "heat it and watch it move" check: measured on the OLD code,
         Tavg +10 K at pinned inventory moved s.lvl 54.059 -> 63.058, exactly
         its -0.9 coefficient, integrating nothing. That check passes either
         way and proves nothing. */
      const s2=set({}); run(s2,30);
      s2.lvl=30; M.step(0.02); const lo=s2.lvl;
      s2.lvl=70; M.step(0.02); const hi=s2.lvl;
      if(Math.abs(hi-lo) < 35)
        bad('s.lvl has no memory: 30 % and 70 % collapsed to '+lo.toFixed(3)+' / '+hi.toFixed(3)+
            ' in one tick - that is a correlation, not an integral');
      else console.log('  s.lvl remembers: 30 % and 70 % stay '+(hi-lo).toFixed(3)+
            ' points apart after a tick, where the correlation collapsed them onto one number');
      /* THE STRUCTURAL CLAIM, and it is provable now. Sever the surge line and
         the expansion has nowhere to go, so the term is exactly 0 - a
         correlation would go on reporting it through a pipe that is not there.

         Read on netExpSurge() rather than on s.lvl, because a severed run is
         also a HOLE (two break edges): the plant drains and the gauge falls
         46 points for a reason that has nothing to do with expansion.

         THIS CHECK COULD NOT BE WRITTEN UNTIL THE SURGE EDGE WAS LIVE. It was
         a static resist(bore,len) - a number, not a function of s - so it never
         read pipeExtraLen() and the hit was decorative, while hittableRunKeys()
         offered it as a target the whole time. Measured before that fix:
         -0.024890 severed against -0.025000 intact. */
      const s3=set({}); run(s3,30);
      s3.dTavg=0.1;
      const open=M.invRate(M.netExpSurge(M.P().net, s3));
      if(Math.abs(open - -100*M.BETA_W*0.1) > 1e-9)
        bad('the whole expansion source does not arrive up the surge line: '+open.toExponential(4)+
            ' against '+(-100*M.BETA_W*0.1).toExponential(4)+' - the pressurizer is meant to be the only compliance');
      s3.dmgParts=['pipe:'+M.P().net.surgeKey];
      const cut=M.invRate(M.netExpSurge(M.P().net, s3));
      if(cut !== 0)
        bad('the surge line was severed and expansion still reported '+cut.toExponential(4)+
            ' %/s - that edge is not live against pipe damage');
      else console.log('  sever the surge line and expansion stops dead: '+open.toExponential(3)+
            ' %/s intact (exactly -100*BETA_W*dTavg) against exactly 0 severed');

    }
    set({});
  }




}

console.log(fails? `\n${fails} FAILURE(S)` : '\nall physics checks passed');
process.exit(fails?1:0);
