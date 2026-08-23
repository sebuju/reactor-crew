"use strict";
/* design parameters and the derived() model */

/* ═══════════════ DESIGN DATA ═══════════════ */
const ARCH=[
 {id:"PWR", name:"PRESSURISED WATER", tie:"WESTINGHOUSE / VVER", mass:340,
  P0:15.5,tsat:618,Lam:2.0e-5,aF:-2.8,aM:-45,aV:-900,dens:100,grace:1.0,dnbr:1.85,xe:1.0,flowMin:.30,
  good:"Dense, well understood, strongly self-limiting",
  bad:"15.5 MPa vessel is heavy; a breach depressurises violently"},
 {id:"BWR", name:"BOILING WATER", tie:"GE MARK I", mass:265,
  P0:7.0,tsat:559,Lam:2.0e-5,aF:-2.8,aM:-38,aV:-1400,dens:95,grace:0.9,dnbr:1.55,xe:1.0,flowMin:.30,
  good:"Direct cycle, lighter, power follows flow instantly",
  bad:"Turbine hall is radioactive; margin to dryout is thin"},
 {id:"LWGR",name:"GRAPHITE + WATER", tie:"RBMK-1000", mass:410,
  P0:6.9,tsat:558,Lam:2.2e-5,aF:-1.6,aM:-8,aV:+1500,dens:55,grace:1.2,dnbr:1.60,xe:1.0,flowMin:.30,
  good:"Cheap fuel, refuels online, huge core inertia",
  bad:"POSITIVE void coefficient - voiding adds power"},
 {id:"SFR", name:"SODIUM FAST", tie:"EBR-II / BN-800", mass:210,
  P0:0.2,tsat:1150,Lam:4.0e-7,aF:-1.2,aM:-12,aV:+400,dens:280,grace:6.0,dnbr:3.20,xe:0.85,flowMin:.20,
  good:"Atmospheric pressure, very light, huge boiling margin",
  bad:"Positive void in a big core; sodium burns on water contact"},
 {id:"MSR", name:"MOLTEN SALT", tie:"MSRE", mass:230,
  P0:0.2,tsat:1700,Lam:3.0e-5,aF:-3.5,aM:-60,aV:-300,dens:80,grace:9.0,dnbr:3.00,xe:0.15,flowMin:.20,
  good:"No pressure; gases stripped online, almost no xenon pit",
  bad:"Corrodes continuously; freezes solid if it gets cold"},
 {id:"HTGR",name:"HELIUM PEBBLE BED", tie:"HTR-PM", mass:520,
  P0:7.0,tsat:2000,Lam:5.0e-5,aF:-4.5,aM:-20,aV:0,dens:6,grace:40,dnbr:2.60,xe:1.0,flowMin:.15,
  good:"Cannot melt. Grace time in hours, not seconds",
  bad:"Six kW per litre - enormous for the power it makes"},
];
const FUEL=[
 {name:"UO2  3.2% LEU",beta:680,excess:4200,densK:.85,condK:1.0,mass:0,
  note:"Low enrichment. The most forgiving kinetics you can buy at 680 pcm of delayed neutrons, but a short campaign and modest power density."},
 {name:"UO2  4.9% LEU",beta:650,excess:5200,densK:1.0,condK:1.0,mass:8,
  note:"Standard commercial fuel. Balanced across every axis and the baseline everything else is measured against."},
 {name:"UO2 19.7% HEU",beta:640,excess:8200,densK:1.4,condK:1.0,mass:-18,
  note:"Naval-grade enrichment. Far more excess reactivity and power density, so the core is smaller, but you need a lot of rod worth and boron to hold it down."},
 {name:"MOX PLUTONIUM",beta:300,excess:6500,densK:1.6,condK:1.0,mass:-12,
  note:"Dense and hot. Beta collapses to 300 pcm, which halves the distance to prompt criticality. Every reactivity mistake is twice as fast."},
 {name:"U-ZR METALLIC",beta:640,excess:6000,densK:1.85,condK:.55,mass:-25,
  note:"Metal fuel conducts heat roughly twice as well as ceramic, so fuel runs far cooler for the same power. Melts at a lower temperature though."},
];
const REFL=[
 {name:"NONE",dRho:0,dV:0,mass:0,note:"Neutrons that leak out are lost. Simplest and lightest option."},
 {name:"STEEL",dRho:250,dV:0,mass:28,note:"Reflects some leakage back into the core, worth about 250 pcm."},
 {name:"BERYLLIUM",dRho:750,dV:120,mass:62,note:"The best reflector available, worth 750 pcm. Its (n,2n) reaction also pushes the void coefficient in the positive direction."},
 {name:"GRAPHITE",dRho:520,dV:60,mass:48,note:"Good reflector and cheap, with a mild positive shift to the void coefficient."},
];
const SCRAM=[
 {name:"GRAVITY DROP",rate:.45,mass:20,note:"Fail-safe on loss of power, but slow, and it slows further under hull acceleration."},
 {name:"SPRING ASSISTED",rate:.90,mass:45,note:"Twice as fast. Its accumulators must be kept charged to work."},
 {name:"BORON INJECTION",rate:2.5,mass:30,note:"Near instant. Irreversible: the loop stays poisoned for the rest of the mission."},
];
const FOLL=[
 {name:"WATER",tipRho:0,tipLen:0,mass:0,
  note:"Nothing below the absorber but coolant. Inserting the bank only ever removes reactivity, all the way in. The dull, safe, correct answer."},
 {name:"GRAPHITE DISPLACER",tipRho:1200,tipLen:8.0,mass:-14,
  note:"A graphite follower keeps water out of the channel below the absorber, so the core wastes fewer neutrons on coolant and the bank is lighter and quicker. It also means the first thing a scram does is drive graphite through the BOTTOM of the core, adding reactivity down there before any absorber arrives. This is the Chernobyl scram."},
 {name:"BORATED STEEL",tipRho:-420,tipLen:4.0,mass:34,
  note:"A poisoned follower. The bank bites early and there is no positive excursion anywhere in its travel, at the price of carrying that poison all campaign - and of the mass."},
];
const CHAN=[
 {name:"SINGLE CHANNEL",noise:1.0,mass:10,note:"One sensor per parameter. When it lies, nothing contradicts it."},
 {name:"TWO CHANNEL",noise:.45,mass:25,note:"Disagreement is visible, but you cannot tell which of the two is wrong."},
 {name:"THREE CHANNEL VOTE",noise:.10,mass:45,note:"Majority voting rejects a failed sensor outright and the readings hold still."},
];
const PUMPS=[
 {name:"N  / NO SPARE",floor:.30,mass:0,note:"Exactly enough pumps. Lose one and you lose that fraction of your flow permanently."},
 {name:"N+1 / ONE SPARE",floor:.45,mass:60,note:"One spare pump. Survives a single pump casualty with full flow."},
 {name:"N+2 / TWO SPARES",floor:.60,mass:115,note:"Two spares. Heavy, and almost impossible to starve of flow."},
];
const SGT=[
 {name:"U-TUBE",graceK:1.0,mass:70,note:"Large secondary water inventory acts as a heat sink for minutes after feedwater is lost. Heavy and slow to respond."},
 {name:"ONCE-THROUGH",graceK:.68,mass:42,note:"Very little water in it, so it responds instantly to load changes and boils dry almost as fast. Light."},
];
const CONT=[
 {name:"NONE",rel:1.0,mass:0,note:"No containment. Any fuel damage releases directly to the environment, and to your crew."},
 {name:"SUPPRESSION POOL",rel:.25,mass:40,note:"Compact pool that condenses released steam. Holds most of a release, and can be overwhelmed by a large break."},
 {name:"LARGE DRY",rel:.05,mass:110,note:"A big heavy volume around the whole plant. Holds essentially everything, at more than twice the mass."},
];
const BKP=[
 {name:"NONE",bk:0,mass:0,note:"Lose main power and the coolant pumps stop dead. Only natural circulation remains."},
 {name:"BATTERY BANK",bk:.5,mass:22,note:"Keeps one pump turning at half speed through a blackout."},
 {name:"DIESEL GENERATORS",bk:1.0,mass:58,note:"Full pump power independent of the plant. Heavy, and one more thing to maintain."},
];
ARCH.forEach(a=>a.note=a.tie+". "+a.good+", but "+a.bad.replace(/^[A-Z]/,c=>c.toLowerCase())+".");
const BUDGET=1500;
/* Where the control bank stands at commissioning. The plant is boronated to be
   critical here, the shutdown margin is measured from here, and resetPlant()
   starts the bank here - one number, because three copies of it would drift. */
const RODX0=.35;
const D={arch:0,fuel:1,refl:1,poison:400,pitch:1.0,hd:1.0,power:1200,
         loops:1,pumps:1,pdes:1.0,pzr:1.0,chim:.3,sg:0,
         scram:0,chan:1,rodw:2600,foll:0,nbank:4,rps:true,rpsm:.35,autorod:true,boroninj:false,
         cont:1,accum:false,efw:true,catcher:false,bkp:1,bypassCap:.5};

function derived(){
  const a=ARCH[D.arch],f=FUEL[D.fuel],rf=REFL[D.refl];
  const dens=a.dens*f.densK*(1.15-0.15*D.pitch);
  const coreMass=D.power/dens*22*(0.8+0.2*D.hd);
  const mass=a.mass+f.mass+rf.mass+SCRAM[D.scram].mass+CHAN[D.chan].mass
    +PUMPS[D.pumps].mass+SGT[D.sg].mass+CONT[D.cont].mass+BKP[D.bkp].mass
    +coreMass + D.loops*34 + (D.pdes-1)*220 + (D.pzr-1)*45 + D.chim*38
    + (D.rodw-1800)/100*4 + (D.accum?45:0)+(D.efw?38:0)+(D.catcher?66:0)+(D.boroninj?18:0)
    + (D.rps?55:0) + FOLL[D.foll].mass + (D.nbank-4)*9
    + (D.autorod?26:0) + D.bypassCap*40 + layMass;
  const aM=a.aM*(2-D.pitch), aV=a.aV+900*(D.pitch-1)+rf.dV;
  const leak=500*Math.pow(D.hd-1,2)*(D.hd>1?1:.6);
  const excess=f.excess+rf.dRho-D.poison-leak;
  const dnbr=a.dnbr*(.55+.45*D.pitch)*Math.pow(D.pdes,.35)*(1+.05*(D.loops-2));
  /* peaking is no longer a curve fitted to H/D: it is the peak of the flux
     shape this core actually settles into, solved on the nodal mesh */
  const core=corePredict({dens,rf});
  const Fq=core.FqCold;
  const natCirc=(.10+.22*D.hd+.30*D.chim)*(a.P0>3?1:1.3);
  const graceK=a.grace*SGT[D.sg].graceK*(1+.12*(D.loops-2));
  const xeW=2700*a.xe;
  /* The bank S-curve, written once: how much worth is bought by inserting to x.
     boronOp and the shutdown margin below both read it, so they cannot drift. */
  const rodS=x=>D.rodw*(x-Math.sin(2*Math.PI*x)/(2*Math.PI));
  const boronOp=-(excess-rodS(RODX0)-xeW);
  /* ── SHUTDOWN MARGIN ──
     Measured against the state a tripped core actually drifts into, not fitted
     to one. Three things move after a scram and then keep moving:
       - the bank travels from its operating position to fully in, which is only
         the worth it had not already spent,
       - the equilibrium xenon the plant was commissioned with decays away, and
         every pcm of that poison comes back as POSITIVE reactivity,
       - the fuel cools from operating temperature down to the coolant, and
         Doppler hands that back too.
     The old number was a polynomial in rod worth and the feedback coefficients
     that touched none of this. It sold margin that did not exist: a default PWR
     read +454 pcm and went critical again, bank fully inserted, about three
     minutes after a scram, then wrecked itself.
     Rods alone are not expected to win that argument - on a real plant they do
     not either, which is what the boron system is for. So the honest number is
     reported twice: what the bank holds on its own, and what it holds with the
     chemical system driven to its 6000 pcm limit. The first is a warning, the
     second is the one that decides whether the design is buildable at all. */
  const dopBack=Math.abs(a.aF)*320*f.condK;      // Doppler released as the fuel cools
  const sdm=rodS(1)-rodS(RODX0)-xeW-dopBack;     // bank only
  const sdmB=sdm+(6000+boronOp);                 // bank plus everything the boron system has left
  return {a,f,rf,dens,mass,over:mass>BUDGET,aM,aV,excess,dnbr,Fq,natCirc,xeW,core,
    boronOp,sdm,sdmB,leak,
    grace:graceK*25/Math.sqrt(D.power/1200)*(1+.4*D.chim),
    beta:f.beta,scram:SCRAM[D.scram].rate,P0:a.P0*D.pdes,
    warn:(()=>{const w=[];
      if(mass>BUDGET) w.push(["HARD","Over the "+BUDGET+" t mass budget by "+(mass-BUDGET).toFixed(0)+" t."]);
      if(sdmB<200) w.push(["HARD","Even full boration holds this core down by only "+sdmB.toFixed(0)+" pcm after a trip. Nothing on the plant can shut it down and keep it down - add control bank worth or burnable poison."]);
      else if(sdm<200) w.push(["SOFT","The bank alone holds this core down by only "+sdm.toFixed(0)+" pcm. Once the xenon decays after a trip the core goes critical again with the bank fully inserted. You must borate after every scram; full boron is worth "+sdmB.toFixed(0)+" pcm of margin."]);
      if(boronOp<-6000) w.push(["HARD","Boron demand "+boronOp.toFixed(0)+" pcm exceeds the 6000 pcm chemical system. Add burnable poison or drop enrichment."]);
      if(aV>0) w.push(["SOFT","Positive void coefficient ("+aV.toFixed(0)+" pcm). Steam in the core ADDS power. This is the Chernobyl feedback loop."]);
      if(aM>0) w.push(["SOFT","Positive moderator coefficient. The lattice is over-moderated: heating the coolant raises power instead of lowering it."]);
      if(dnbr<1.4) w.push(["SOFT","Thermal margin only "+dnbr.toFixed(2)+" DNBR. Very little headroom above rated power."]);
      if(f.beta<400) w.push(["SOFT","Beta "+f.beta+" pcm. Prompt criticality is half as far away as with uranium fuel."]);
      if(CONT[D.cont].rel>0.5) w.push(["SOFT","No containment. Any fuel damage releases straight to the crew."]);
      if(D.bkp===0) w.push(["SOFT","No backup power. A blackout stops the pumps entirely."]);
      if(FOLL[D.foll].tipRho>0 && aV>0) w.push(["SOFT","Graphite followers on a positive-void core. Inserting the bank pushes graphite through the bottom of the core, which ADDS reactivity there before the absorber removes any. A scram from a withdrawn bank is an excursion, not a shutdown."]);
      if(core.cz<0.35) w.push(["SOFT","Loosely coupled core (axial coupling "+core.cz.toFixed(2)+"). It is tall enough that one end can drift without the other noticing, so xenon can oscillate top to bottom on its own."]);
      if(Fq>3.0) w.push(["SOFT","Peaking factor "+Fq.toFixed(2)+". The hottest spot runs at "+Fq.toFixed(1)+"x the core average, and DNBR is set by that spot, not by the average."]);
      if(!D.rps) w.push(["SOFT","No reactor protection system. Nothing will scram this core for you - not high flux, not low DNBR, not a dry loop. Every trip is yours to call by hand."]);
      return w;})()};
}
