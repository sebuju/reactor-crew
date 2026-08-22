"use strict";
/* point kinetics, thermal, pressure, void, RPS */

/* ═══════════════ SIM ═══════════════ */
let P=null,S=null,lastN=1;
function commission(){
  const d=derived(),a=d.a,f=d.f,B=d.beta*1e-5,K=400,L=layoutMetrics();
  P={BETA:B,bet:[.033,.219,.196,.395,.115,.042].map(x=>x*B),
     lam:[.0124,.0305,.111,.301,1.14,3.01],LAM:a.Lam,
     aF:a.aF, aM:d.aM, aV:d.aV, P0:d.P0, tsat0:a.tsat*Math.pow(D.pdes,.25),
     rated:D.power, dnbr0:d.dnbr, Fq0:d.Fq, xeW:d.xeW, scram:d.scram,
     rodW:D.rodw, excess:d.excess, flowMin:PUMPS[D.pumps].floor,
     hpiRate:(D.accum?2.6:1.6)*L.hpiHead, graceK:Math.pow(a.grace*SGT[D.sg].graceK*(1+.12*(D.loops-2)),.6)*L.inertiaK,
     noise:CHAN[D.chan].noise, pumps:D.pumps, id:a.id, name:a.name,
     condK:f.condK, natCirc:d.natCirc*L.natK, pzrK:D.pzr*L.pzrK,
     flowK:L.flowK, dose:L.dose, exposure:L.exposure, bypass:.20+.60*D.bypassCap,
     rps:D.rps, rpsm:D.rpsm, autorod:D.autorod, boroninj:D.boroninj, efw:D.efw,
     catcher:D.catcher, contRel:CONT[D.cont].rel, backup:BKP[D.bkp].bk,
     loops:D.loops, sdm:d.sdm, boronOp:d.boronOp, lay:L,
     lamI:Math.LN2/(6.57*3600)*K, lamX:Math.LN2/(9.14*3600)*K, gI:.0639, gX:.00237};
  P.sig=3.0*P.lamX; P.XEQ=(P.gI+P.gX)/(P.lamX+P.sig); P.KXE=P.xeW/P.XEQ;
  P.pRise = a.P0>3 ? 1.0 : 0.25;
  P.burstK = a.P0>3 ? 1.22 : 4.0;
  /* Hot full power is not 583 K / 900 K / 100% for every plant -- that is a PWR
     fit. Commissioning a 7 MPa core at 583 K starts it already boiling, and
     starting any core off its own heat balance kicks it into a transient the
     RPS then trips on. Derive the settling point instead and start there. */
  P.Tref  = Math.min(583, P.tsat0-35);                 // coolant program temp, subcooled by design
  P.feff0 = Math.max(P.flowK, P.natCirc*(38/70));      // heat removal fraction at full flow, undamaged
  P.n0    = Math.min(1, P.feff0);                      // power at which removal balances heat
  P.TfRef = P.Tref + 320*P.condK*P.n0/Math.max(P.feff0,.10);
  P.X0    = (P.gI+P.gX)*P.n0/(P.lamX+P.sig*P.n0);      // xenon equilibrium at that power
  coreConst(P,d);                        // the core as a place: mesh, coupling, rods
  P.dsig = designSig();                 // what this plant was built from
  resetPlant();
  screen="operate"; layout();
}
/* ══════════ THE AUTOMATIC SYSTEMS ══════════
   Every system that acts on the plant without being asked, in one table.
   Fitted is a design-bench decision and cannot be undone at the panel;
   bypassed is the operator's, and the operator is allowed to be wrong - all of
   these can be switched off from the panel, including the ones that only ever
   help you. Each system is mounted on exactly one component, and that is where
   its bypass switch is drawn. */
const AUTOSYS={
  rps:{part:"ctrl",label:"RPS",ann:"RPS BYPASS",name:"PROTECTION SYSTEM",
    fit:()=>P.rps,
    tip:"Reactor Protection System. Armed, it scrams the core on high flux, low DNBR, high pressure, high fuel temp, low flow, low pressure, core void or low subcooling. Bypass it to run past rated power - and to melt the core.",
    warn:"Automatic trips are defeated. Nothing will shut this reactor down for you."},
  rod:{part:"rods",label:"AUTO ROD",ann:"ROD AUTO BYP",name:"AUTOMATIC ROD CONTROL",
    fit:()=>P.autorod,
    tip:"Walks the bank to hold average coolant temperature on programme, and it holds the bank near where it started - so it overrides the slider you just moved. Bypass it and the rods go exactly where you put them, and stay there.",
    warn:"The bank now goes where you put it and nothing walks it back. Coolant temperature is yours to hold."},
  porv:{part:"pzr",label:"PORV AUTO",ann:"PORV AUTO BYP",name:"AUTOMATIC RELIEF",
    fit:()=>true,
    tip:"Lifts the relief valve at 106% pressure, which is what stops a pressure transient reaching the vessel. Bypass it and nothing vents.",
    warn:"The relief valve will not lift. An overpressure now ends at the vessel, not at the valve."},
  runback:{part:"turb",label:"RUNBACK",ann:"RUNBACK BYP",name:"TURBINE RUNBACK",
    fit:()=>true,
    tip:"Drops turbine load to 5% the instant the reactor trips, so the turbine cannot draw heat out of a shut-down core. Bypass it and load stays wherever you left it right through a scram.",
    warn:"A trip no longer sheds load. The turbine will keep drawing steam from a dead core and chill the loop."},
  efw:{part:"feed",label:"EMERG FEED",ann:"EMERG FEED BYP",name:"EMERGENCY FEEDWATER",
    fit:()=>P.efw,
    tip:"Feeds the steam generator by itself after a trip, so decay heat still has somewhere to go. Bypass it and it will not start.",
    warn:"Nothing feeds the steam generator after a trip. Decay heat has no sink but the loop itself."},
  bkp:{part:"bkp",label:"BACKUP",ann:"BACKUP PWR BYP",name:"BACKUP POWER",
    fit:()=>P.backup>0,
    tip:"Picks the coolant pumps up automatically in a blackout. Bypass it and the pumps stay dead: natural circulation is all the core gets.",
    warn:"The backup supply will not pick up the pumps. A blackout now leaves natural circulation only."},
};
const AUTOKEYS = Object.keys(AUTOSYS);
const autoFit   = k => !!AUTOSYS[k].fit();
const autoLive  = k => autoFit(k) && !S.byp[k];
const autoState = k => !autoFit(k) ? "NOT FITTED" : S.byp[k] ? "BYPASSED" : "ARMED";
/* which system, if any, is mounted on this component - the renderer asks this */
const autoOn    = id => AUTOKEYS.find(k=>AUTOSYS[k].part===id) || null;
function autoToggle(k){
  if(!autoFit(k)) return false;
  S.byp[k]=!S.byp[k];
  return true;
}
const rpsLive  = ()=> autoLive("rps");
const rpsState = ()=> autoState("rps");

/* A stop valve slams shut in well under a second, so a runback is the one
   place load moves without waiting for the governor: it writes both the
   actual and the demand, or the lag would wind the turbine straight back up. */
function runback(s){ if(autoLive("runback")) s.load=s.loadDem=Math.min(s.load,0.05); }
/* A scram is the same act from the diagram and from the inspector, and the
   turbine runback that rides along with it is defeatable, so it lives here. */
function manualScram(){
  const s=S;
  s.scrammed=true; s.rodDem=1; s.rodJam=false; s.trip="MANUAL SCRAM";
  runback(s);
}
/* The eight conditions the protection system watches, in one place. The RPS
   asks this when it decides to trip; the trip reset asks the same list before
   it will agree to clear, so you cannot reset out of a hazard that is still on. */
function tripCause(){
  const s=S, m=P.rpsm;
  if(s.n>1.10+0.22*m)                       return "HIGH FLUX";
  if(s.dnbr<1.18-0.16*m)                    return "LOW DNBR";
  if(s.P>P.P0*(1.06+0.07*m))                return "HIGH PRESSURE";
  if(s.Tf>1600+280*m)                       return "HIGH FUEL TEMP";
  if(s.flow<P.flowMin*1.02 && s.heat>0.3)   return "LOW FLOW";
  if(s.P<P.P0*0.86)                         return "LOW PRESSURE";
  if(s.vf>0.30)                             return "CORE VOID";
  if(s.sc<3)                                return "LOW SUBCOOLING";
  return "";
}

/* Clearing a trip is a deliberate act, never a side effect of nudging a slider.
   With protection fitted the plant holds a veto while a trip condition stands.
   With none fitted there is nothing to consult, and the risk is entirely yours. */
function resetTrip(){
  const s=S;
  if(!s.scrammed) return false;
  const why = P.rps ? tripCause() : "";
  if(why){
    logE("warn","TRIP RESET REFUSED",
      why+" is still present. The latch will not clear until the condition does.");
    return false;
  }
  s.scrammed=false; s.trip="";
  logE("info","TRIP RESET",
    "Protection latch cleared by hand. The control bank answers demand again."+
    (P.rps?"":" Nothing checked the plant first - none was fitted."));
  return true;
}

const AUTOROD_LEAD=12;                  // seconds of lead in the T-avg rod controller
/* actuator rates. Boration is charging-pump flow; dilution has to displace loop
   inventory, so it is slower. Poisoning yourself is easy, getting back out is not. */
const BOR_IN=60, BOR_OUT=35;            // pcm/s toward more / less boron
/* pump rotational inertia, and the longer coastdown once the power is gone */
const FLOW_TAU=5, FLOW_TAU_COAST=12;    // seconds
/* governor valve stroke plus steam-plant response */
const LOAD_TAU=2;                       // seconds
const rodWorth=x=>-P.rodW*(x-Math.sin(2*Math.PI*x)/(2*Math.PI));
const tsat=p=>P.tsat0*Math.pow(Math.max(p,.05)/P.P0,.10);

function resetPlant(){
  const x0=.35;
  S={n:P.n0,C:P.bet.map((b,i)=>b*P.n0/(P.LAM*P.lam[i])),I:P.gI*P.n0/P.lamI,X:P.X0,
     Tf:P.TfRef,Tavg:P.Tref,rodPos:x0,rodDem:x0,rodJam:false,scrammed:false,
     load:1,loadDem:1,flow:1,flowDem:1,P:P.P0,lvl:54,sgl:50,inv:100,hpi:false,
     porvOpen:false,porvBlocked:false,porvAuto:false,porvStuck:false,
     dmg:0,fatigue:0,dnbr:P.dnbr0,rho:0,decay:.065,voidTh:0,cav:0,vf:0,
     byp:Object.fromEntries(AUTOKEYS.map(k=>[k,false])),
     breach:false,melt:false,trip:"",
     ev:{}, blackout:false, nat:0, release:0, rodAuto:x0, borInjUsed:false,
     dmgParts:[], repair:null, sgtr:false, noiseMul:1, dose:0, bkpLost:false,
     boron:0,boron0:0,boronDem:0,parts:{rod:0,dop:0,mod:0,xe:0,bor:0,vd:0,tip:0},
     dash:{hot:0,cold:0,stm:0,fw:0,rel:0,hpi:0},spin:0,jit:0,dTavg:0,heat:1,sc:35,t:0};
  /* Settle the flux shape first, then dial in the boron that actually makes
     THIS shape critical. Rod worth is emergent now, so a formula would leave
     the plant slightly off-critical and walk it into a trip nobody caused. */
  coreReset(S);
  S.boron = S.boron0 = -(P.excess+coreRodWorth(S)-P.KXE*P.X0);
  S.boronDem = S.boron;                 // start on demand, or it walks off commissioning
  lastN=P.n0; LOG=[]; initHist();
  logE("info","PLANT AT POWER",
    P.name+" commissioned at "+P.rated+" MWt, holding "+(P.n0*100).toFixed(1)+"% - pipe run and pump head decide how much of the rating the loop can actually carry. Everything that happens from here is logged with the reason.");
}
function step(dt){
  const s=S; s.t+=dt;

  /* ── control rods ── */
  if(autoLive("rod") && !s.scrammed && !s.rodJam){   // holds T-avg on program
    /* T-avg error alone is two integrations away from rod position, so on a
       weakly self-limiting core (small moderator coefficient) the bank hunts
       and the swing grows until the RPS trips it. The rate term is the lead
       compensation a real rod controller uses: it stops pushing once T-avg is
       already moving the right way. */
    const err=s.Tavg-(P.Tref-18+18*s.load) + AUTOROD_LEAD*s.dTavg;
    s.rodDem=clamp(s.rodDem+clamp(err,-6,6)*0.0016*dt*50, clamp(s.rodAuto-0.15,0,1), clamp(s.rodAuto+0.15,0,1));
  }
  if(!s.rodJam){ const r=s.scrammed?P.scram:0.012, d=s.rodDem-s.rodPos;
    s.rodPos+=Math.sign(d)*Math.min(Math.abs(d),r*dt); }

  /* ── boron: an actuator, not a setting ──
     The slider writes demand; the loop gets there at the rate a charging pump
     can push. Same pattern as the bank above, and the reason its tooltip can
     finally say "slow" without lying. */
  { const db=s.boronDem-s.boron, rb=(db<0?BOR_IN:BOR_OUT)*dt;
    s.boron+=Math.sign(db)*Math.min(Math.abs(db),rb); }

  /* ── turbine load: the governor valves take a moment to stroke ── */
  s.load += (s.loadDem-s.load)*Math.min(dt/LOAD_TAU,1);

  /* ── decay heat: the core keeps making heat long after it shuts down ── */
  s.decay += (s.n*0.065 - s.decay)*dt/22;
  const heat = s.n*0.935 + s.decay;

  /* ── pump cavitation: pumps stall if the water they suck is near boiling ── */
  const sat0 = tsat(s.P), Tc0 = s.Tavg-15*heat;
  s.cav = clamp((Tc0-(sat0-6))/12,0,1);
  const lost = s.dmgParts.filter(k=>k.startsWith("pump")).length;
  const pumpK = Math.max(0,(P.loops-lost)/P.loops);
  const bkpUp = !s.bkpLost && autoLive("bkp");
  /* ── coolant flow: pumps have inertia ──
     Losing power does not stop a pump dead, it coasts. Blackout is the same lag
     with a longer time constant, so the grace time the brief promises is real. */
  { const tgt = s.blackout ? (bkpUp?P.backup*0.55:0) : s.flowDem,
          tau = s.blackout ? FLOW_TAU_COAST : FLOW_TAU;
    s.flow += (tgt-s.flow)*Math.min(dt/tau,1); }
  const driven = s.flow * P.flowK * pumpK;
  const nat = P.natCirc*clamp((s.Tavg-(P.Tref-38))/70,0,1);      // buoyancy-driven flow
  s.nat = nat;
  const feff = Math.max(driven*(1-0.8*s.cav), nat);    // no flow means no removal, floor included

  /* ── heat balance ── */
  /* With the runback bypassed the turbine keeps its load through a trip, so the
     temperature programme has to keep following that load: the loop is still
     being drained of heat by a machine that should have shed it. */
  const shed = s.scrammed && autoLive("runback");
  const Tprog = P.Tref-18 + (shed ? 0 : 18*s.load);
  const feedOK = !s.dmgParts.includes("feed");
  const dump = s.scrammed ? clamp((s.Tavg-Tprog)*0.02,0,P.bypass)*(feedOK?1:.25)+(autoLive("efw")?0.08:0) : 0;
  const vNow = clamp(s.vf,0,1.5);
  const removal = (s.load+dump)*feff*(1-0.85*Math.min(vNow,1));
  s.dTavg = (heat-removal)*1.8/P.graceK;               // K/s, for the rod controller's lead term
  s.Tavg = clamp(s.Tavg + s.dTavg*dt, 500, 1000);

  /* ── pressure: hot loop pressurises, relief valve lifts, vessel can burst ── */
  const Pdem = P.P0 + (s.Tavg-P.Tref)*(0.17/P.pzrK)*(P.P0/15.5)*P.pRise + (s.hpi?0.5*P.pRise:0);
  s.P += (Pdem-s.P)*(0.30/P.pzrK)*dt;
  if(!s.porvOpen && autoLive("porv") && s.P > P.P0*1.06){   // automatic lift
    s.porvOpen=true; s.porvAuto=true; s.porvStuck = Math.random()<0.18;
  }
  if(s.porvOpen && s.porvAuto && !s.porvStuck && s.P < P.P0*1.01){
    s.porvOpen=false; s.porvAuto=false;
  }
  if(s.porvOpen && !s.porvBlocked){ s.P -= 0.30*(P.P0/15.5)*dt; s.inv -= .55*dt; }
  if(s.hpi){ s.inv=Math.min(100,s.inv+P.hpiRate*dt); s.fatigue+=0.35*dt; }
  if(s.sgtr){ s.inv-=0.30*dt; s.release=Math.min(100,s.release+0.02*P.dose*dt); }
  const burst = P.P0*(P.burstK - 0.0028*s.fatigue);   // fatigue weakens the vessel
  if(!s.breach && s.P > burst){ s.breach=true; s.trip="VESSEL RUPTURE"; }
  if(s.breach){ s.P -= 1.4*(P.P0/15.5)*dt; s.inv -= 2.4*dt; }
  s.P = clamp(s.P, P.P0*0.06, P.P0*1.6);
  s.inv = clamp(s.inv,0,100);

  /* ── the core as a place: shape, hot channel, local boiling, local xenon ──
     This is where boiling actually happens now. It happens in particular
     nodes, in particular channels, and the channel that boils is the one
     that then loses the flow it needed. s.vf, s.Tf, s.X and s.I below are
     the whole-core aggregates of a field, not lumps in their own right. */
  const sat = tsat(s.P), Th = s.Tavg+15*heat;
  const vLeak = Math.max(0,(95-s.inv)/25);
  const nod = coreStep(s,dt,feff,heat,sat,vLeak);
  s.voidTh = s.vNode;
  s.vf = clamp(Math.max(vLeak,s.voidTh)+0.3*Math.min(vLeak,s.voidTh),0,1.6);

  const sc = sat - Th;
  s.heat = heat; s.sc = sc;              // tripCause() reads these outside the tick
  s.lvl = clamp(54+(P.Tref-s.Tavg)*-0.9+s.vf*60+(s.inv-100)*0.15,0,100);
  s.sgl = clamp(50+(heat-s.load)*40-(s.load-1)*14,0,100);

  /* ── reactivity ── */
  const p=s.parts;
  p.rod=nod.rod; p.dop=nod.dop; p.mod=nod.mod; p.xe=nod.xe; p.vd=nod.vd;
  p.tip=nod.tip; p.bor=s.boron;
  s.rho=P.excess+p.rod+p.dop+p.mod+p.xe+p.bor+p.vd+p.tip;

  const h=dt/4, rk=s.rho*1e-5;
  for(let k=0;k<4;k++){
    let num=0,den=0;
    for(let i=0;i<6;i++){ const dd=1+h*P.lam[i];
      num+=P.lam[i]*s.C[i]/dd; den+=P.lam[i]*h*P.bet[i]/P.LAM/dd; }
    const a=1-h*(rk-P.BETA)/P.LAM-h*den;
    let n=a>1e-6?(s.n+h*num+h*2e-9)/a:s.n*12;
    if(!isFinite(n)||n<0) n=s.n*12;
    s.n=Math.min(n,60);
    for(let i=0;i<6;i++) s.C[i]=(s.C[i]+h*P.bet[i]/P.LAM*s.n)/(1+h*P.lam[i]);
  }
  s.n=Math.max(s.n,1e-9);

  /* ── thermal margin ── */
  /* Peaking is the measured peak of the flux field, and the flow that counts
     is the flow through the channel that peak sits in - a starved channel can
     dry out while the core average still looks comfortable. */
  const subF=clamp(sc/20,.08,1.3);
  s.dnbr=P.dnbr0*Math.pow(s.hotFlow,.6)*Math.pow(s.P/P.P0,.3)*Math.pow(subF,.4)
        /Math.max(.02,heat*(s.fq/2.66));

  /* ── damage ── */
  if(s.dnbr<1)     s.dmg+= (1-s.dnbr)*22*dt;
  if(s.Tf>1500)    s.dmg+= (s.Tf-1500)*0.012*dt;
  if(s.dmg>0) s.dmg=Math.min(100,s.dmg);
  if(!s.melt && s.dmg>=60){ s.melt=true; s.trip="CORE MELT"; }
  if(s.melt && !P.catcher){ s.inv-=0.35*dt; s.fatigue=Math.min(100,s.fatigue+1.6*dt); }
  if(s.dmg>0) s.release=Math.min(100,s.release+s.dmg*0.004*P.contRel*P.dose*dt);

  /* ── reactor protection system: trips unless it was never fitted, or is defeated ── */
  if(!s.scrammed && rpsLive()){
    const why=tripCause();
    if(why){ s.scrammed=true; s.rodDem=1; s.trip="RPS TRIP / "+why;
             runback(s); }
  }

  /* ── event log: every transition, with why ── */
  const E=s.ev, ev=(k,cond,sev,msg,why,latch)=>{
    if(cond && !E[k]){ E[k]=true; logE(sev,msg,why); }
    else if(!cond && !latch) E[k]=false; };
  ev("hipow",s.n>1.10,"warn","POWER ABOVE 110%",
    "Running past rated output. Thermal margin is what pays for it, and DNBR is falling.");
  ev("dnbr13",s.dnbr<1.30,"warn","DNBR BELOW 1.30",
    "Coolant is approaching film boiling on the fuel pins. Raise pump flow or pressure, or cut power.");
  ev("dnbr10",s.dnbr<1.00,"alarm","DNBR BELOW 1.00 / CLADDING FAILING",
    "The fuel is now wrapped in insulating steam. Heat is not reaching the water and damage is accumulating this second.");
  ev("cav",s.cav>0.15,"warn","COOLANT PUMP CAVITATION",
    "Water arriving at the pumps is close to boiling, so they are churning vapour. Real flow is far below the bench setting.");
  ev("hip",s.P>P.P0*1.05,"warn","PRIMARY OVERPRESSURE",
    "Loop pressure above 105% of nominal. The relief valve lifts at 106%, and the vessel bursts near "+burst.toFixed(1)+" MPa.");
  ev("porv",s.porvOpen&&!s.porvBlocked,"warn","RELIEF VALVE PASSING",
    "The PORV is open and venting to the relief tank. If nobody commanded it, primary coolant is leaving the loop.");
  ev("stuck",s.porvOpen&&s.porvAuto&&s.porvStuck&&!s.porvBlocked,"alarm","PORV FAILED TO RESEAT",
    "It lifted on overpressure and did not shut again. Pressurizer level will read HIGH while the loop empties. Close the block valve.");
  ev("void",s.vf>0.15,"alarm","STEAM VOID IN CORE",
    "Steam is forming where liquid should be. It carries almost no heat, so fuel temperature climbs even while reactor power falls.");
  ev("pit",-s.parts.xe>3200,"info","XENON PIT",
    "Xenon-135 past 3200 pcm. Raising power may be physically impossible until it decays, whatever you do with the rods.");
  ev("jam",s.rodJam,"alarm","CONTROL RODS NOT RESPONDING",
    "The bank is ignoring demand, a scram included. You are left with boron, flow and load.");
  for(const k of AUTOKEYS)
    ev("byp_"+k, autoFit(k)&&s.byp[k], "warn", AUTOSYS[k].name+" BYPASSED", AUTOSYS[k].warn);
  ev("norps",!P.rps,"warn","NO PROTECTION SYSTEM FITTED",
    "This plant was commissioned without one. There are no automatic trips to defeat, and none to fall back on. Every scram is yours to call.",true);
  ev("hpi",s.hpi,"info","HPI INJECTING",
    "Emergency water is refilling the loop, and cold shock is ageing the vessel while it runs.");
  ev("scram",s.scrammed,"alarm","REACTOR TRIP / "+(s.trip||"SCRAM"),
    "Rods fully inserted and the turbine tripped with them. Xenon now builds and will hold the reactor down for minutes.");
  ev("d1",s.dmg>1,"alarm","FUEL DAMAGE 1%",
    "Cladding has started to fail and fission products are entering the coolant. Permanent.",1);
  ev("d25",s.dmg>25,"alarm","FUEL DAMAGE 25%",
    "A quarter of the fuel cladding has failed.",1);
  ev("fat50",s.fatigue>50,"warn","VESSEL FATIGUE PAST 50%",
    "Thermal shock has embrittled the vessel. Its burst pressure is now "+burst.toFixed(1)+" MPa instead of "+(P.P0*P.burstK).toFixed(1)+".",1);
  ev("brk",s.breach,"alarm","VESSEL RUPTURE",
    "The pressure vessel failed at "+s.P.toFixed(1)+" MPa. Coolant is leaving faster than anything can replace it. Unrecoverable.",1);
  ev("melt",s.melt,"alarm","CORE MELT",
    "Over 60% of the fuel has failed and the core is melting. Unrecoverable.",1);

  if(s.repair){
    s.repair.t += dt;
    s.dose = Math.min(100, s.dose + P.dose*0.25*dt);
    if(s.repair.t >= s.repair.need){
      const k=s.repair.id;
      s.dmgParts = s.dmgParts.filter(q=>q!==k);
      if(k==="pzr"){ s.porvStuck=false; s.porvOpen=false; s.porvAuto=false; }
      if(k.startsWith("sg")) s.sgtr=false;
      if(k==="ctrl") s.noiseMul=1;
      if(k==="bkp") s.bkpLost=false;
      logE("info","REPAIR COMPLETE / "+k.toUpperCase(),
        "The component is back in service. It took "+s.repair.need.toFixed(0)+" seconds and cost the repair party dose.");
      s.repair=null;
    }
  }

  const d=s.dash,sp=60*dt;
  d.hot-=sp*feff*1.4; d.cold-=sp*feff*1.4;
  d.stm-=sp*s.load*1.6; d.fw-=sp*s.load*1.6; d.rel-=sp*3; d.hpi-=sp*2;
  s.spin=(s.spin+360*dt*feff)%360;
  s.jit=Math.sin(performance.now()/70)*P.noise*(s.noiseMul||1);
}
const ANN=[
 ["HI FLUX","red",s=>s.n>1.12,
  "The reactor is making more than 112% of its rated power. You are outside the design envelope and the fuel is being pushed harder than it was built for. Reduce load or insert rods."],
 ["LO DNBR","red",s=>s.dnbr<1.30,
  "Thermal margin has fallen below 1.30. The cooling water is close to boiling into a continuous film on the fuel rods, which would stop heat transfer almost instantly. Raise pump flow, raise pressure, or cut power."],
 ["FUEL DMG","red",s=>s.dmg>0.1,
  "Fuel cladding has failed somewhere in the core. This is permanent, it puts radioactive fission products into the coolant, and it only gets worse. Nothing you do now un-breaks it."],
 ["LO PRESS","amber",s=>s.P<P.P0*.935,
  "Primary loop pressure has dropped below 93% of normal. Either you are leaking coolant, or the pressurizer sprays are overcooling the steam bubble. Pressure is what stops the loop boiling, so this matters."],
 ["HI PZR LVL","amber",s=>s.lvl>78,
  "Pressurizer water level above 78%. Either the loop genuinely has too much water in it, or steam forming in the core is pushing water up into the pressurizer while the loop actually empties. Check subcooling to tell which."],
 ["LO SUBCOOL","red",s=>(tsat(s.P)-(s.Tavg+15*s.n))<8,
  "Less than 8 degrees of margin before the coolant boils. This is the alarm that does not lie about inventory. If this is lit and pressurizer level looks fine, believe this one."],
 ["TAVG DEV","amber",s=>Math.abs(s.Tavg-(565+18*s.load))>4,
  "Average coolant temperature is more than 4 K away from where it should be for the current load. The reactor and the turbine are not in balance: one is making more heat than the other is taking."],
 ["XENON PIT","blue",s=>-s.parts.xe>3200,
  "Xenon-135 has built up past 3200 pcm of negative reactivity. This poison eats neutrons, and until it decays you may physically be unable to restart or raise power no matter how far you pull the rods."],
 ["ROD JAM","amber",s=>s.rodJam,
  "The control rods are not moving when commanded. Your fast reactivity handle is gone. You now control the reactor only with boron, coolant temperature and load."],
 ["PORV OPEN","red",s=>s.porvOpen&&!s.porvBlocked,
  "The pressure relief valve on top of the pressurizer is passing flow. If you did not command it open, you are dumping primary coolant overboard right now. Close the block valve."],
 ["CORE VOID","red",s=>s.inv<95,
  "Steam pockets are forming inside the core where liquid water should be. Steam cannot carry heat away, so fuel temperature climbs fast even though reactor power may be falling."],
 ["RX TRIP","red",s=>s.scrammed,
  "A scram has occurred and the control rods are fully inserted. The reactor is shut down. Expect a xenon buildup that will keep it shut down for the next few minutes."],
 ["HI PRESS","red",s=>s.P>P.P0*1.05,
  "Primary pressure above 105% of normal. The relief valve will lift shortly. Sustained overpressure past about 122% bursts the vessel outright, and every point of vessel fatigue lowers that threshold."],
 ["PUMP CAVITATION","amber",s=>s.cav>0.15,
  "The water arriving at the coolant pumps is close to boiling, so the pumps are churning vapour instead of liquid. Actual flow is far below what the bench says. Raise pressure or cool the loop."],
 ["NO RPS","amber",()=>!P.rps,
  "No protection system was fitted at the design bench. Nothing is watching flux, DNBR, pressure, fuel temperature, flow or void on your behalf. You are the protection system."],
 ["VESSEL BREACH","red",s=>s.breach,
  "The pressure vessel has ruptured. Coolant is leaving faster than anything can replace it. This is unrecoverable."],
 ["BLACKOUT","amber",s=>s.blackout,
  "Main power to the coolant pumps is lost. Flow is now limited to your backup power supply plus whatever natural circulation the core geometry generates."],
 ["CORE MELT","red",s=>s.melt,
  "More than 60% of the fuel has failed and the core is melting. Unrecoverable. Reset the plant."],
/* one tile per defeated automatic system, built from the same table the sim uses */
].concat(AUTOKEYS.map(k=>[AUTOSYS[k].ann,"amber",s=>autoFit(k)&&s.byp[k],
  AUTOSYS[k].name+" is switched off at the panel. "+AUTOSYS[k].warn]));
