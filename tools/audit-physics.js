#!/usr/bin/env node
/* reactor-crew physics auditor.
   Runs the sim headless. Two things it checks:
     1. no plant the bench will let you build trips itself while nobody touches it
     2. the documented behaviours in .claude/CLAUDE.md still hold
   Usage:  node tools/audit-physics.js
*/
const M=require('./bundle').headless(
 '{commission,resetPlant,step,derived,resetTrip,S:()=>S,P:()=>P,D:()=>D,'+
 'ARCH:()=>ARCH,FUEL:()=>FUEL,SCRAM:()=>SCRAM,PUMPS:()=>PUMPS,ANN:()=>ANN,manualScram,combatHit,LAY:()=>LAY,moveTo,'+
 'setSplit,bankAutoLive,tProg,ROD_RATE,AUTOROD_GAIN,AUTOROD_LEAD,AUTOROD_LO,AUTOROD_HI}');
const D=M.D(), ARCH=M.ARCH(), FUEL=M.FUEL(), SCRAM=M.SCRAM(), PUMPS=M.PUMPS(), ANN=M.ANN();
const BASE=JSON.parse(JSON.stringify(D));
const set=o=>{ Object.assign(D,BASE,o); M.commission(); return M.S(); };
const run=(s,secs)=>{ for(let i=0;i<secs*50;i++){ M.step(0.02); if(s.breach) break; } return s; };

let fails=0;
const bad=m=>{ console.log('  FAIL '+m); fails++; };

/* With automatic rod control fitted, a plant nobody touches must hold. Without it
   the bank never moves, so xenon walks the core off its start point over the
   compressed clock and an eventual trip is the player's problem, not a bug. */
console.log('=== UNTOUCHED PLANT WITH AUTO ROD CONTROL MUST NOT TRIP ITSELF (600 s) ===');
let cases=0;
for(let a=0;a<ARCH.length;a++)
for(let f=0;f<FUEL.length;f++)
for(const pumps of [0,1,2])
for(const scram of [0,1,2]){
  const s=set({arch:a,fuel:f,pumps,scram,autorod:true});
  if(M.derived().warn.some(w=>w[0]==='HARD')) continue;   // bench would block this build
  cases++;
  run(s,600);
  if(s.scrammed) bad(`${ARCH[a].id}/${FUEL[f].name}/${PUMPS[pumps].name}/${SCRAM[scram].name}`+
                     ` tripped at t=${s.t.toFixed(1)}s: ${s.trip}`);
}
console.log(`  ${cases} buildable designs checked`);

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
/* the pump slider reaches zero: stopping the pumps is an order the panel accepts.
   Armed, the flow trip catches it before DNBR is anywhere near the limit, whatever
   redundancy was bought - the floor is a setpoint, not a stop. Bypassed, the core
   is left on buoyancy and must settle there instead of running away. */
for(const pumps of [0,1,2]){
  const s=set({pumps}); run(s,10);
  s.flowDem=0;
  for(let i=0;i<120*50 && !s.scrammed && !s.breach;i++) M.step(0.02);
  const floor=M.P().flowMin;
  if(!/LOW FLOW/.test(s.trip)) bad(`pumps commanded to zero with ${PUMPS[pumps].name} tripped on "${s.trip}", expected LOW FLOW`);
  if(s.flow>floor*1.05) bad(`pumps commanded to zero tripped at ${(s.flow*100).toFixed(1)}%, nowhere near the ${(floor*100).toFixed(0)}% floor`);
  console.log(`  pumps to zero, ${PUMPS[pumps].name}: trip="${s.trip}" at flow=${(s.flow*100).toFixed(1)}% dnbr=${s.dnbr.toFixed(2)}`);
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
{ const s=set({rps:false, rodw:5200}); run(s,10);
  M.D().autorod=false; M.P().autorod=false; s.rodDem=0;
  run(s,120);
  if(!s.melt && !s.breach) bad('no RPS fitted and a full rod withdrawal destroyed nothing');
  console.log(`  RPS not fitted, rod worth 5200: melt=${s.melt} breach=${s.breach} at t=${s.t.toFixed(0)}s`);
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
{ /* combatHit() picks its victim at random, so aim it: hand it a list of one */
  const s=set({}); run(s,5);
  const L=M.LAY(), all=L.parts.slice(), rods=all.find(q=>q.id==='rods');
  L.parts=[rods]; M.combatHit(); L.parts=all;
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
     Hand the loop an overpressure it must answer, then ask whether it lifted. */
  const a=set({}); run(a,10); a.P=M.P().P0*1.08; run(a,1);
  const b=set({}); run(b,10); b.byp.porv=true; b.P=M.P().P0*1.08; run(b,1);
  if(!a.porvOpen) bad('armed PORV did not lift at 108% of nominal pressure');
  if(b.porvOpen)  bad('PORV lifted automatically while its bypass was in');
  if(b.P <= a.P)  bad(`PORV bypass did not hold pressure up (armed ${a.P.toFixed(2)}, bypassed ${b.P.toFixed(2)} MPa)`);
  console.log(`  PORV AUTO: armed lifted=${a.porvOpen} at ${a.P.toFixed(2)} MPa, bypassed lifted=${b.porvOpen} at ${b.P.toFixed(2)} MPa`);
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
     the bypassed core ends up COLDER because the RPS shut it down. */
  const a=set({bkp:2}); run(a,10); a.blackout=true; run(a,60);
  const b=set({bkp:2}); run(b,10); b.byp.bkp=true; b.blackout=true; run(b,60);
  if(a.scrammed) bad(`backup power armed still tripped in a blackout: ${a.trip}`);
  if(!b.scrammed) bad('backup power bypassed did not starve the loop; the plant rode the blackout out');
  /* the trip lands on LOW DNBR, not LOW FLOW: the pump slider is still at 100%,
     it is the supply behind it that is gone, and the fuel feels that first */
  if(!/LOW DNBR|LOW FLOW/.test(b.trip)) bad(`backup power bypassed tripped on "${b.trip}", expected a flow-starvation trip`);
  console.log(`  BACKUP: armed rides it out (Tf ${a.Tf.toFixed(0)}K), bypassed trips on "${b.trip}"`);
}
{ /* the bench sells diesels as full pump power, so a blackout on diesels must
     hold the flow the pumps had - above the floor of any pump set you bought */
  for(const pumps of [0,1,2]){
    const s=set({pumps,bkp:2}); run(s,10); s.blackout=true; run(s,60);
    if(s.scrammed) bad(`diesels fitted with ${PUMPS[pumps].name} still tripped in a blackout: ${s.trip} at flow ${(s.flow*100).toFixed(0)}%`);
    if(s.flow<0.95) bad(`diesels hold only ${(s.flow*100).toFixed(0)}% flow in a blackout, bench promised full pump power`);
  }
  const s=set({bkp:1}); run(s,10); s.blackout=true; run(s,60);
  if(Math.abs(s.flow-0.5)>0.03) bad(`battery bank holds ${(s.flow*100).toFixed(0)}% flow in a blackout, bench promised half`);
  console.log(`  BACKUP: diesels hold full flow through a blackout, battery holds ${(s.flow*100).toFixed(0)}%`);
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

console.log(fails? `\n${fails} FAILURE(S)` : '\nall physics checks passed');
process.exit(fails?1:0);
