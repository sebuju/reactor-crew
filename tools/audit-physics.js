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
 'pumpCap,totalPumpCap,placePart,removePart,addFit,removeFit,pipeNetwork,act,'+
 'LAT:()=>LAT,LQ,LIX,latDefault,latRevolve,latWarn,LM:()=>LM,'+
 'layoutMetrics,radAt,radSolve,radGeom,radSrc,radPeak,RAD_HI,repairStart,radWorkK,RAD_SLOW,'+
 'netBuild,netFlowK,setPipeK,VALVE_RATE,hittableRunKeys,pipeCells,pipePart,'+
 'hasRelief,primaryRelief,reliefFitIds,reliefAnyOpen,reliefAnyStuck,ventK,reliefG,PIPE_BORE:()=>PIPE_BORE}');
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
   any other module state set() does not own. */
const set=o=>{
  o=o||{};
  const lat=o.lat; if(lat) { o=Object.assign({},o); delete o.lat; }
  Object.assign(D,JSON.parse(JSON.stringify(BASE)),o);
  M.latDefault();
  if(lat) lat();
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
  const want=['rps','rod','porv','runback','efw','bkp'];
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
  const a=set({efw:true}); run(a,10); a.scrammed=true; a.rodDem=1; a.load=a.loadDem=0.05; run(a,120);
  const b=set({efw:true}); run(b,10); b.byp.efw=true; b.scrammed=true; b.rodDem=1; b.load=b.loadDem=0.05; run(b,120);
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

/* ══════════ RELIEF: THE VENT IS A BOUNDARY CONDITION, AND REDUNDANCY COSTS ══════════
   Stage 5. FIT.relief (pipenet.js) is a fitting whose g() is a constant 0 -
   never a row of the Laplacian - so netFlowK() cannot see it at all; this is
   what proves the vent stayed a boundary condition rather than sneaking
   into the circulation solve. ventK() judges each fitting's own branch
   conductance against P.ventRef, and RELIEF_REF_LEN (pipenet.js) is fitted
   so the stock plant's own relief valve lands on exactly 1 - already proven
   above (EVERY AUTOMATIC SYSTEM IS BYPASSABLE reads 16.16/16.42 MPa, and THE
   SIM ROLLS NO LOOSE DICE reads the identical stick pattern, both bit for
   bit the pre-Stage-5 figures). This block is the redundancy half: what
   changes when there is more than one relief path, and what happens when
   there is none. */
console.log('\n=== RELIEF: ONE PATH, THREE PATHS, NO PATH ===');
{ /* netFlowK() must not move a hair for a fitting whose own g() never
     contributes an edge - the strongest statement available is exact
     equality against a plant with NO relief fitting at all, not a
     tolerance, because a vent that touched the Laplacian even by
     floating-point accident would still likely read "close". */
  const withRelief=set({}); run(withRelief,5);
  M.D().fit={}; M.commission(); const noRelief=M.S(); run(noRelief,5);
  if(M.netFlowK(withRelief)!==M.netFlowK(noRelief))
    bad(`a relief fitting moved netFlowK: ${M.netFlowK(withRelief)} (with) vs ${M.netFlowK(noRelief)} (without) - it reached the Laplacian`);
  console.log(`  a relief fitting never moves netFlowK: ${(M.netFlowK(withRelief)*100).toFixed(1)}% with or without one fitted`);
}
{ /* the stock relief valve, isolated: armed, it lifts at 106%, reseats below
     101%, and vents at exactly PORV_INV/PORV_DP (ventK===1) - the same
     three facts the pre-Stage-5 PORV promised, now read off the fitting.
     set({}) first, or primaryRelief() would still be reading the empty
     D.fit the block above left behind. */
  const s=set({}); const fid=M.primaryRelief(); run(s,10); s.P=M.P().P0*1.10; run(s,1);
  if(!s.reliefOpen[fid]) bad('the stock relief fitting did not lift at 110% pressure');
  const vk=M.ventK(s,fid);
  if(Math.abs(vk-1)>1e-9) bad(`the stock relief fitting's ventK is ${vk}, expected exactly 1`);
  console.log(`  one relief path: lifts at 110% (open=${s.reliefOpen[fid]}), ventK=${vk.toFixed(6)} - the pre-Stage-5 PORV rate exactly`);
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
{ /* deleting the last relief path is buildable, not blocked - only warned,
     the same SOFT/HARD shape every other bad-design choice on the bench
     gets (design.js). commission() must not throw either: a plant with no
     vent is a legal plant, just one where an overpressure ends at the
     vessel (see the pressure block, step.js) instead of a valve. */
  M.D().fit={};
  if(M.hasRelief()) bad('hasRelief() is true with an empty D.fit');
  const w=M.derived().warn;
  if(!w.some(x=>/no relief path/i.test(x[1])))
    bad('deleting the last relief fitting raised no bench warning');
  let threw=false;
  try{ M.commission(); } catch(e){ threw=true; }
  if(threw) bad('a plant with no relief path refused to commission');
  else if(M.primaryRelief()) bad('primaryRelief() found one after every relief fitting was deleted');
  console.log('  no relief path: warns at the bench, commissions anyway, and P.fit carries no relief fitting');
}
{ /* a vent is a boundary condition read straight off ventK() (pipenet.js) -
     sever the fitting's own branch pipe (pipeExtraLen -> Infinity -> g=0,
     same idiom every other severed run uses) and force a lift: no NaN in
     P, inv, or the fitting's own ventK, whatever the network underneath is
     doing. Re-fit the stock relief afterward so no later case inherits an
     unrelieved plant. */
  const s=set({}); run(s,5);
  const fid=M.primaryRelief();
  s.dmgParts.push('pipe:xtie:'+fid);
  s.byp.rps=true; s.P=M.P().P0*1.20; run(s,20);
  const vk=M.ventK(s,fid);
  if(!isFinite(s.P)||!isFinite(s.inv)||!isFinite(vk))
    bad(`a severed relief branch produced a non-finite value: P=${s.P} inv=${s.inv} ventK=${vk}`);
  if(vk!==0) bad(`a severed relief branch still vented at ventK=${vk}, expected exactly 0`);
  console.log(`  a severed relief branch never produces NaN: ventK=${vk}, P and inv stay finite (P=${s.P.toFixed(2)} MPa)`);
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
{ /* strict equality, not a tolerance: shut, a junction is a removed edge, so
     netFlowK() must fall back to exactly what each surviving loop's own
     P.netRefByloop contributes, on the nose - never an approximation of it.
     No spares fitted in this case on purpose - loopPumpCap() would then sum
     real hardware above 1.0 per loop, which is its own case below. */
  const {s,ids}=tieChain();
  const ref=M.P().netRefByLoop, tot=M.P().netRef;
  const expect=dmg=>{ let sum=0; for(let i=0;i<4;i++) if(!dmg.includes('pump'+i)) sum+=ref[i]; return sum/tot; };
  let drift=0;
  for(const dmg of [[],['pump1'],['pump0','pump3'],['pump0','pump1','pump2','pump3']]){
    s.dmgParts=dmg.slice();
    if(M.netFlowK(s)!==expect(dmg)) drift++;
  }
  if(drift) bad(`${drift} of 4 damage cases: a shut junction no longer gives exactly its surviving loops' own reference share`);
  else console.log('  shut junctions give exactly the surviving loops\' own reference share, 0..4 pumps lost');
  s.dmgParts=[];
  if(M.netFlowK(s)!==1) bad('a shut junction changed the flow of a plant with every pump running');
  s.juncOpen[ids[0]]=true; s.juncOpen[ids[1]]=true; s.juncOpen[ids[2]]=true;
  if(M.netFlowK(s)!==1) bad('opening a junction between healthy loops manufactured flow that was not there shut');
}
{ /* ── A JUNCTION ONLY HAS SOMETHING TO PROVE ONCE THERE IS SOMETHING TO SHARE ──
     loopPumpCap() sums real hardware - a pump at default size delivers
     exactly 1.0, its own loop's own ceiling, so a lone loop's own group
     ceiling never actually clamps anything when every pump on it is bare
     and default-sized. That is not a bug, it is "nobody gets flow for free"
     (netFlowK's own comment, pipenet.js) - a junction is a path for
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
  const sp1=M.placePart(n=>({id:'pumpX'+n,name:'RCP SPARE',w:1,h:1,x:9,y:5,col:'#57d38c',grp:'loop1',tip:'t',loop:1}));
  M.D().pumpSize[sp1.id]=0;
  const sp3=M.placePart(n=>({id:'pumpX'+n,name:'RCP SPARE',w:1,h:1,x:13,y:5,col:'#57d38c',grp:'loop3',tip:'t',loop:3}));
  M.commission(); const s=M.S();
  s.dmgParts=['pump0'];
  const alone=M.netFlowK(s);
  s.juncOpen[ids[0]]=true; const one=M.netFlowK(s);
  s.juncOpen[ids[1]]=true; s.juncOpen[ids[2]]=true; const all=M.netFlowK(s);
  if(!(one>alone)) bad('opening the junction beside a dead pump bought no flow at all');
  if(!(all>one))   bad('opening the rest of the chain bought nothing over one junction');
  console.log(`  4 loops, RCP 1 lost, 2 spares placed: shut ${(alone*100).toFixed(1)}%`+
              ` -> one junction ${(one*100).toFixed(1)}% -> chain ${(all*100).toFixed(1)}%`);
  M.removePart(sp1.id); M.removePart(sp3.id);
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
    const sp=M.placePart(n=>({id:'pumpX'+n,name:'RCP SPARE',w:1,h:1,x:9,y:5,col:'#57d38c',grp:'loop1',tip:'t',loop:1}));
    M.commission(); const s=M.S(); run(s,20);
    if(open) s.juncOpen[ids[0]]=true;
    s.dmgParts.push('pump0'); run(s,90);
    M.removePart(sp.id);
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
  const key=M.hittableRunKeys(M.P().net)[0];
  M.combatHit('pipe:'+key);
  M.repairStart('pipe:'+key);
  if(!s.repair) bad(`repair on a freshly hit, reachable run (${key}) was refused`);
  let n=0; while(s.repair && n<200000){ M.step(0.02); n++; }
  if(s.dmgParts.includes('pipe:'+key)) bad('a completed repair left the run marked damaged');
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
  const tight=SC.scnJudge(b.take,lim('power','pwr','>',90,0));
  const grace=SC.scnJudge(b.take,lim('power','pwr','>',90,2));
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
  page.D().turb=0.8; page.D().loops=3; page.commission();
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

  console.log('  a 3-loop plant rebuilds from its head in a module that never saw it, and runs identically');
  console.log('  a head that does not re-sign is refused, so a verdict is never about the wrong reactor');
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
     has real slack in it. */
  const s=set({}); run(s,10);
  s.byp.rps=true; s.flow=0.05; s.flowDem=0.05;
  let ticks=0; while(!s.melt && !s.breach && ticks<50*300){ M.step(0.02); ticks++; }
  if(!s.melt) bad('flow-kill + RPS bypass did not reach core melt inside 300 s of fault time; nothing to check the live field against');
  if(s.dmg<=25) bad(`core melted at only dmg=${s.dmg.toFixed(1)}%, expected well past 25%`);
  if(s.doseRate<=M.P().dose*3)
    bad(`live doseRate only reached ${(s.doseRate/M.P().dose).toFixed(2)}x P.dose at melt; expected >3x`);
  console.log(`  flow-kill + bypass, run to melt: dmg=${s.dmg.toFixed(0)}%, doseRate=${s.doseRate.toFixed(3)} (${(s.doseRate/M.P().dose).toFixed(1)}x the as-built figure)`);
}
{ /* CONTAINMENT REACHES THE FIELD: same fault, NONE (rel=1.0) against LARGE
     DRY (rel=.05) - P.contRel scales both the direct cladding-failure term
     and the rate the airborne term accumulates at, so the two containments
     have to read very different dose rates for identical damage. Sampled at
     60 s into the fault rather than at melt: dmg is already well past 25 by
     then (it plateaus inside 15 s), but RAD_MELT - a flat addition neither
     containment scales - is still well over 100 s away, so it cannot yet
     swamp the very difference this case exists to measure. */
  const doseAt=cont=>{ const s=set({cont,contFit:true}); run(s,10);
    s.byp.rps=true; s.flow=0.05; s.flowDem=0.05;
    for(let i=0;i<50*60;i++) M.step(0.02);
    return s.doseRate; };
  const none=doseAt(0), large=doseAt(2);
  if(none<large*5)
    bad(`containment NONE only read ${(none/large).toFixed(2)}x LARGE DRY 60 s into the same fault; expected >=5x`);
  console.log(`  containment reaches the field: NONE ${none.toFixed(4)} vs LARGE DRY ${large.toFixed(4)} (${(none/large).toFixed(1)}x), 60 s into the same fault`);
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
     dmg plateaus near 29% for a good two minutes before it starts climbing
     again toward melt around t=186s, so a job dispatched at t=40s has a
     wide, genuinely stable window to finish in -
     stable enough to clear the party without melt or the party itself being
     spent, but this case does NOT hold the field perfectly still the way
     COOL does (dmg is still creeping upward under it), so unlike COOL above
     it is only checked against the ratio below, not against the tick. */
  const hot=set({cont:0, contFit:true}); run(hot,10);
  hot.byp.rps=true; hot.flow=0.05; hot.flowDem=0.05;
  while(hot.t<40 && !hot.melt) M.step(0.02);
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

console.log(fails? `\n${fails} FAILURE(S)` : '\nall physics checks passed');
process.exit(fails?1:0);
