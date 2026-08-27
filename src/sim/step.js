"use strict";
/* point kinetics, thermal, pressure, void, RPS */

/* ═══════════════ SIM ═══════════════ */
let P=null,S=null;
function commission(){
  const d=derived(),a=d.a,f=d.f,B=d.beta*1e-5,K=400,L=layoutMetrics();
  P={BETA:B,bet:[.033,.219,.196,.395,.115,.042].map(x=>x*B),
     lam:[.0124,.0305,.111,.301,1.14,3.01],LAM:a.Lam,
     aF:a.aF, aM:d.aM, aV:d.aV, P0:d.P0, tsat0:a.tsat*Math.pow(D.pdes,.25),
     rated:D.power, dnbr0:d.dnbr, Fq0:d.Fq, xeW:d.xeW, scram:d.scram,
     /* The trip floor used to be a flat number per PUMPS[D.pumps] tier. It now
        scales with pump capacity actually on the grid: +.15 for every full
        unit of capacity bought beyond the bare minimum (one pump per
        generator), the identical +.15-per-spare progression the old
        three-tier table priced, just read off real components instead of a
        dropdown. sgCount() (layout.js) is the counted number of generators
        on the grid, never a stored D.loops - at the true baseline, one pump
        per generator at default size, totalPumpCap() equals sgCount()
        exactly, so this returns the old NO SPARE floor (.30), not the old
        default of .45. graceK no longer carries a per-generator bonus either
        (design.js's own comment says why) - only the coolant/SG term and the
        layout's own inertia, and the SG half of it is sgInertiaK(), the one
        helper derived() reads too. */
     excess:d.excess, flowMin:clamp(0.30+0.15*(totalPumpCap()-sgCount()),0.15,0.75),
     graceK:Math.pow(a.grace*sgInertiaK(),.6)*L.inertiaK,
     noise:CHAN[D.chan].noise, id:a.id, name:a.name,
     eff:d.eff, loadMax:d.loadMax, condCap:d.condCap,
     condK:f.condK, pzrK:D.pzr*L.pzrK,
     flowK:L.flowK, dose:L.dose, radK:L.radK, bypass:.20+.60*D.condCap,
     rps:D.rps, rpsm:D.rpsm, autorod:D.autorod,
     catcher:LAY.parts.some(p=>p.role==="catcher"), contRel:D.contFit?CONT[D.cont].rel:1, backup:BKP[D.bkp].bk,
     turbFit:D.turbFit, condFit:D.condFit, fit:{...D.fit},
     loops:sgCount(), sdm:d.sdm, sdmB:d.sdmB, boronOp:d.boronOp, lay:L,
     lamI:Math.LN2/(6.57*3600)*K, lamX:Math.LN2/(9.14*3600)*K, gI:.0639, gX:.00237,
     /* the coolant's own density, in kg/m^3 - the pipe network weighs a
        column of it to get buoyancy (rhoAt(), pipenet.js) */
     rho0:a.dens*RHO_K};
  /* Hot full power is not 583 K / 900 K / 100% for every plant -- that is a PWR
     fit. Commissioning a 7 MPa core at 583 K starts it already boiling, and
     starting any core off its own heat balance kicks it into a transient the
     RPS then trips on. Derive the settling point instead and start there.
     Ahead of the network below, not after it: rhoAt() measures density about
     this temperature, and netCoreFrac0() solves the plant before this
     function returns. */
  P.Tref  = Math.min(583, P.tsat0-35);                 // coolant program temp, subcooled by design
  /* The pipe network: netFlowK() (pipenet.js) is what feeds pumpK below now,
     not a capacity-counting formula. netRef is the valves-shut (as
     commissioned), no-damage reference flow every later tick becomes a
     fraction of - see netCoreFrac0's own comment for why shut rather than
     open. It is >0 by construction (a fresh net always has at least one live
     pump path to ground), so a reading of 0 or worse is a bug to report, not
     a case to guard here. netRefByLoop is the same reference split per loop -
     netFlowK's own per-connected-group ceiling needs it, because the loops
     are not the same length. */
  P.net    = netBuild();
  P.netRefByLoop = {};
  P.netRefByRun  = {};
  P.netRef = netCoreFrac0(P.net, P.netRefByLoop, P.netRefByRun);
  /* ONE scale for every run to animate against, and it must not be the run's
     OWN reference. Dividing a run by itself is 1 for every healthy run, which
     normalises out exactly the thing the network was built to see: the stock
     loops are not the same length, so loop 0 really does carry more water than
     loop 3. Against a shared mean the plant still averages to the old rate -
     nothing on screen speeds up overall - but the legs finally differ from each
     other, which is the whole reason a run has its own integral. */
  { let sum=0, n=0;
    for(const k in P.netRefByRun)
      if(k.startsWith("hot:")||k.startsWith("cold:")){ sum+=P.netRefByRun[k]; n++; }
    P.netRefRun = n ? sum/n : 0; }
  P.sig=3.0*P.lamX; P.XEQ=(P.gI+P.gX)/(P.lamX+P.sig); P.KXE=P.xeW/P.XEQ;
  P.pRise = a.P0>3 ? 1.0 : 0.25;
  P.burstK = a.P0>3 ? 1.22 : 4.0;
  /* Where a loop that is no longer a loop ends up. Absolute, not a fraction of
     P0: containment sits near atmospheric whatever the plant was designed for. */
  P.Pcont = 0.15;
  P.feff0 = P.flowK;                                   // heat removal fraction at full flow, undamaged
  P.n0    = Math.min(1, P.feff0);                      // power at which removal balances heat
  P.TfRef = P.Tref + 320*P.condK*P.n0/Math.max(P.feff0,.10);
  P.X0    = (P.gI+P.gX)*P.n0/(P.lamX+P.sig*P.n0);      // xenon equilibrium at that power
  coreConst(P,d);                        // the core as a place: mesh, coupling, rods
  P.dsig = designSig();                 // what this plant was built from
  resetPlant();
  /* What THIS plant is subcooled by when nobody has touched it. The vital bar
     scales against it, because subcooling at rest is 22 K on a PWR and 1400 K
     on an HTGR - a fixed scale would peg four of the six architectures full and
     say nothing. P.dnbr0 is the same idea and was already here. */
  P.sc0 = S.sc;
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
    tip:"Walks the rods to hold average coolant temperature on programme, so it overrides the slider you just moved. It drives every bank that is on AUTO, and it may only work inside the travel band set on the rod-drive panel - widen that band and it has more authority and less shutdown margin. Bypass it and every bank goes exactly where you put it, and stays there.",
    warn:"The rods now go where you put them and nothing walks them back. Coolant temperature is yours to hold."},
  /* Not hosted on the pressurizer. The pressurizer has not owned a relief
     valve since one became a fitting with a tap of its own - the stock
     valve sits on a hot leg - so the pressurizer was carrying the bypass
     for a system nothing on it was part of. The relief tank is a placed
     part now (Stage 5a) and no longer answers "does a relief path exist" by
     its own presence, so this reads reliefFitIds() (the fittings
     themselves) instead: fit is not a flat true because with no relief
     fitting placed there is no automatic relief to arm, and bypRow() draws
     that as a dead "none" the way it already does for an RPS nobody
     bought. */
  /* part:null - this system has NO component host. Every relief valve now
     carries its own arming switch on its own glyph (pipeFitMarks(), plant.js),
     so a part-mounted row would be a second switch saying the same thing on a
     one-valve plant and an ambiguous one on a three-valve plant. The row stays:
     it still owns the label, the annunciator name, the warning and its AUTOEV
     entry - one table per concept, and the concept still exists. Only its host
     and its granularity moved. autoOn() must tolerate the null. */
  porv:{part:null,label:"PORV AUTO",ann:"PORV AUTO BYP",name:"AUTOMATIC RELIEF",
    fit:()=>reliefFitIds().length>0,
    /* One lamp for "automatic relief is defeated anywhere", because that is
       the question the watch reading the board is actually asking. */
    lit:s=>reliefFitIds().length>0 && (s.byp.porv || reliefFitIds().some(fid=>s.porvByp[fid])),
    tip:"Lifts each relief valve at its own setpoint, which is what stops a pressure transient reaching the vessel. Bypass it and nothing vents.",
    warn:"The relief valve will not lift. An overpressure now ends at the vessel, not at the valve."},
  runback:{part:"turb",label:"RUNBACK",ann:"RUNBACK BYP",name:"TURBINE RUNBACK",
    fit:()=>true,
    tip:"Drops turbine load to 5% the instant the reactor trips, so the turbine cannot draw heat out of a shut-down core. Bypass it and load stays wherever you left it right through a scram.",
    warn:"A trip no longer sheds load. The turbine will keep drawing steam from a dead core and chill the loop."},
  /* THERE IS NO "EMERGENCY FEEDWATER" ROW HERE, and that is the point. It was
     one named system mounted on the FEED PUMP - a switch on a component that
     was not part of it - standing in for what is really a rule on a tank. A
     tank carries its own arm switch on its own strip (s.tankByp, ACT.tankByp),
     so two reserves can be armed independently and neither is hosted on
     somebody else's box. Same move porv made when a relief valve became a
     fitting; this finishes it. */
  bkp:{part:"bkp",label:"BACKUP",ann:"BACKUP PWR BYP",name:"BACKUP POWER",
    fit:()=>P.backup>0,
    tip:"Picks the coolant pumps up automatically in a blackout. Bypass it and the pumps stay dead: natural circulation is all the core gets.",
    warn:"The backup supply will not pick up the pumps. A blackout now leaves natural circulation only."},
};
const AUTOKEYS = Object.keys(AUTOSYS);
/* One event key and one title per system, built once. step() raises these
   thirty times a second and has no business concatenating them each time. */
const AUTOEV = AUTOKEYS.map(k=>[k, "byp_"+k, AUTOSYS[k].name+" BYPASSED"]);
const autoFit   = k => !!AUTOSYS[k].fit();
const autoLive  = k => autoFit(k) && !S.byp[k];
const autoState = k => !autoFit(k) ? "NOT FITTED" : S.byp[k] ? "BYPASSED" : "ARMED";
/* which system, if any, is mounted on this component - the renderer asks this */
// AUTOSYS[k].part may be null (a system hosted on a fitting, not a component),
// so the null host must never match a component that was asked about.
const autoOn    = id => AUTOKEYS.find(k=>AUTOSYS[k].part!=null && AUTOSYS[k].part===id) || null;
function autoToggle(k){
  if(!autoFit(k)) return false;
  S.byp[k]=!S.byp[k];
  return true;
}
const rpsLive  = ()=> autoLive("rps");
const rpsState = ()=> autoState("rps");
/* ══════════ FITTINGS ══════════
   Fitted (placed, for a tee or a throttle - see D.fit, layout.js) and worked
   at the panel are two different questions, the same way a protection
   system is fitted and then armed - but a fitting is NOT in AUTOSYS, because
   nothing about it is automatic. There is no system acting on the plant
   behind your back to defeat: it is a valve, and the operator works it,
   either by hand (a tee's S.juncOpen) or by demand (a throttle's
   S.valveDem, walked toward at VALVE_RATE below). */
/* ── RELIEF FITTINGS: every valve rolls its own die ──
   Deleting the last relief fitting is a legal design choice (see the
   warning in derived(), design.js) - a plant can be built with nowhere for
   an overpressure to go, and the vessel bursting is then the player's own
   decision. So every reader below is written to answer "none fitted" with
   an empty list or a no-op, never a throw.
   reliefFitIds() walks P.fit in ITS OWN insertion order (fid keys are
   "f0","f1",... - not integer-index keys, so Object.keys preserves the
   order addFit() gave them) - deterministic, so which fitting is "primary"
   never depends on iteration order changing under a future engine.
   primaryRelief() is what the LEGACY, single-valve controls (ACT.porvBlock,
   ACT.porvArm, the pzr mimic and its readouts) still address: their exact
   signature has no id argument (see ACT, record.js), so they can only ever
   reach the one relief fitting a plant had before redundancy existed. A
   second or third relief path is worked through the generic fitting
   controls, the same way a second tee or throttle already is. */
// P is null on the design bench (nothing commissioned yet) - the mimic still
// draws there, so this asks D directly rather than throwing, the same
// P?fallback:D idiom pumpFloor() (plant.js) already uses.
const reliefFitIds = () => { const f=P?P.fit:D.fit;
  return Object.keys(f).filter(id=>f[id].mode==="relief"); };
const primaryRelief = () => reliefFitIds()[0];
// any relief fitting passing flow right now - what the annunciator, the
// surge-line animation and the event log all mean by "the relief valve is
// open", because any one of them venting is the same fact to a watch
// reading the board.
const reliefAnyOpen = s => reliefFitIds().some(id=>s.reliefOpen[id] && !s.reliefBlocked[id]);
// any relief fitting that lifted and did not reseat - the fact "PORV FAILED
// TO RESEAT" and the PORV OPEN annunciator both mean.
const reliefAnyStuck = s => reliefFitIds().some(id=>
  s.reliefOpen[id] && s.reliefAuto[id] && s.reliefStuck[id] && !s.reliefBlocked[id]);
/* ── HOW MUCH FLOW THE PUMPS THAT ARE LEFT ACTUALLY DELIVER ──
   Used to be a capacity-counting formula here: lose one pump out of three
   and the whole plant lost a third of its flow, as though every loop were
   already perfectly cross-tied and there were no way to make that better or
   worse, and an open junction bought a group min(groupSize, capacity) with
   no regard for which loops actually got tied together. netFlowK()
   (pipenet.js) replaced it with the solved pipe network, which sees that the
   loops are not all the same length and gives the short one more - it keeps
   the same min(groupSize, capacity) ceiling per connected group (a spare
   pump still cannot deliver more than its own loops' bore), applied on top
   of the solve rather than instead of it. See pipenet.js for the current
   comment; see git history for the formula this replaced. */
/* There are three ways a bank ends up going where the operator put it: the
   system was bypassed, the bank was switched to MANUAL while the banks are
   split, or a latch/jam took the drives away entirely. The precedence is
   written once, here, because the controller, the renderer and the inspector
   all have to agree on it. */
const bankAutoLive = b => autoLive("rod") && !S.scrammed && !S.rodJam
                          && (!S.split || S.bankAuto[b]);

/* A stop valve slams shut in well under a second, so a runback is the one
   place load moves without waiting for the governor: it writes both the
   actual and the demand, or the lag would wind the turbine straight back up. */
function runback(s){ if(autoLive("runback")) s.load=s.loadDem=Math.min(s.load,0.05); }

/* ── what the steam is worth once it leaves the plant ──────────────────────
   Every figure below is readout-side. The heat leaves the core at exactly the
   same rate whatever these say; they only decide how much of it becomes
   electricity. Nothing in removal, tProg or the trip logic reads them, which is
   why the whole physics invariant set survives untouched. */

/* Condenser backpressure. The unit is sized for a set fraction of rated steam.
   Push more through it than it can condense and exhaust pressure climbs, which
   costs the turbine work - so an undersized heat sink hands back the overload
   you paid mass for. */
function condPen(s){
  const ex = Math.max(0, Math.min(s.n,s.load) - P.condCap);
  return Math.max(0.6, 1 - 2.2*ex*ex);
}

/* Gross electrical output. The steam that reaches the turbine is the smaller of
   what the core is making and what the governor is passing; the steam dump goes
   straight to the condenser and does no work, so it is deliberately not in here.
   One helper, because the diagram tag and both inspectors read the same number.
   What is not electricity is rejected, so mwRej is the remainder rather than a
   second efficiency figure that could drift away from the first. */
const mwE   = s => (s.dmgParts.includes("turb") || !P.turbFit || !P.condFit) ? 0
  : Math.min(s.n,s.load)*P.rated*P.eff*condPen(s);
const mwRej = s => Math.min(s.n,s.load)*P.rated - mwE(s);
/* A scram is the same act from the diagram and from the inspector, and the
   turbine runback that rides along with it is defeatable, so it lives here. */
function manualScram(){
  const s=S;
  s.scrammed=true; s.rodDem=1; s.trip="MANUAL SCRAM";
  /* a scram frees a sticky bank, but not a wrecked one - once the drives have
     been shot away only a repair party puts them back */
  if(!s.dmgParts.includes("rods")) s.rodJam=false;
  runback(s);
}

/* ══════════ COMBAT DAMAGE ══════════
   ONE table, and that is the whole point of it. What a hit BREAKS and what a
   repair party PUTS BACK used to be two lists in two files - the effects in
   control-room.js, the undo down in step()'s repair block - so a part given an
   effect in one and not the other was damage that could never be undone. They
   are the same fact about a component, written once: msg/why is what the log
   says, hit() is what it does to the plant, fix() is what the party reverses.

   fix:null is deliberate and is NOT an oversight: for the vessel, the turbine,
   the condenser, the feed pumps and the HPI tank the only thing a repair
   restores is the component's presence, because their "effect" is either
   permanent (fatigue, lost inventory) or read straight off s.dmgParts by the
   physics, which stops reading it the moment the id comes out of the list.

   Matched by PREFIX, the way ANN matches its lamps: the loop count is a design
   parameter, so there is no fixed set of pump and steam-generator ids to
   enumerate and any enumeration would go stale the day someone builds a
   five-loop plant. */
const DMGFX={
  core:{msg:"REACTOR VESSEL HIT",
    why:"A penetration in the vessel wall. Coolant is leaking and the metal is permanently damaged.",
    hit:s=>{ s.inv-=6; s.fatigue=Math.min(100,s.fatigue+12); }, fix:null},
  rods:{msg:"ROD DRIVE HIT",
    why:"The drive mechanisms are wrecked. The bank is stuck where it stands and a scram will not move it. Boron is the only shutdown you have left.",
    hit:s=>s.rodJam=true, fix:s=>s.rodJam=false},
  pzr :{msg:"PRESSURIZER HIT",
    why:"The relief valve has been knocked open and will not reseat. Close the block valve on the mimic.",
    /* sticks whichever relief fitting the pressurizer owns (primaryRelief())
       - and refuses, silently, like every other hit/fix pair here, if there
       is none: a plant built with no relief path has nothing on the
       pressurizer for a hit to knock open. */
    hit:s=>{ const fid=primaryRelief(); if(!fid) return;
      s.reliefOpen[fid]=true; s.reliefStuck[fid]=true; s.reliefAuto[fid]=true; },
    fix:s=>{ const fid=primaryRelief(); if(!fid) return;
      s.reliefStuck[fid]=false; s.reliefOpen[fid]=false; s.reliefAuto[fid]=false; }},
  /* a stop valve slams, it does not stroke - so this writes the actual AND the
     demand, or the load lag would drag the turbine straight back up */
  turb:{msg:"TURBINE HIT",
    why:"Load rejected. The turbine is offline, so the reactor has nowhere to send its heat.",
    hit:s=>s.load=s.loadDem=0.05, fix:null},
  cond:{msg:"CONDENSER HIT",
    why:"Heat rejection lost. Steam has nowhere to condense.",
    hit:s=>s.load=s.loadDem=0.05, fix:null},
  feed:{msg:"FEED PUMP HIT",
    why:"Feedwater down to a quarter. The steam generator will boil dry if this is not fixed.",
    hit:null, fix:null},
  ctrl:{msg:"INSTRUMENT CABINET HIT",
    why:"Sensor channels lost. Every reading on the panel is now far less trustworthy.",
    hit:s=>s.noiseMul=3.5, fix:s=>s.noiseMul=1},
  bkp :{msg:"BACKUP POWER HIT",
    why:"Your emergency supply is gone. A blackout now means natural circulation only.",
    hit:s=>s.bkpLost=true, fix:s=>s.bkpLost=false},
  tank:{msg:"TANK HIT",
    why:"That tank's line is severed. Whatever it held is no longer reaching the loop.",
    hit:null, fix:null},
  pump:{msg:"COOLANT PUMP HIT",
    why:"That pump is dead. Loop flow drops by its share and thermal margin goes with it.",
    hit:null, fix:null},
  sg  :{msg:"STEAM GENERATOR TUBE RUPTURE",
    why:"Primary coolant is leaking into the secondary side and venting past containment. Inventory falls and activity escapes.",
    hit:s=>s.sgtr=true, fix:s=>s.sgtr=false},
  /* hit/fix are null for the same reason pump/hpi/feed are: the effect is
     read straight off s.dmgParts by the physics (pipeExtraLen(), pipenet.js)
     and stops the moment the id comes out of the list, so there is nothing
     left for a handler to do here. A run is severed, not throttled - see
     pipeExtraLen()'s own comment for why that is additive resistance taken
     to its limit rather than a second mechanism. */
  pipe:{msg:"PRIMARY PIPE RUPTURE",
    why:"A primary run has been severed. It carries nothing round the loop any more, and both cut ends are now open to containment - the loop is losing coolant and pressure through them until something stops it.",
    hit:null, fix:null}
};
const DMGANY={msg:"EQUIPMENT HIT", why:"A component has been knocked out.", hit:null, fix:null};
/* WHAT a component is comes first, then its id, then the id-prefix fallback.
   Role first because a tank's id is a slot number the player may rename and a
   prefix match on it would find nothing - and because "what happens when this
   is hit" is a fact about the kind of thing it is. Every part that matched by
   prefix before (pump0, sg0) has a role of the same name, so nothing else
   moves. */
const dmgFx = id => {
  const p = LAY.parts.find(q=>q.id===id);
  return (p && DMGFX[p.role]) || DMGFX[id]
      || DMGFX[Object.keys(DMGFX).find(k=>id.startsWith(k))] || DMGANY;
};

/* A hit is sim state and a scenario command, not a screen act, which is why it
   lives here rather than in control-room.js where the FAULTS button is.
   Aimed with an id, it hits exactly that component - and refuses silently if
   that component cannot be hit, because a script that names the shield column
   should get nothing, not the nearest thing to it. Unaimed, it draws its target
   from the same weighted pick as before, off srand() rather than Math.random(),
   so a recorded run takes the same hits when it is played back. The weighting is
   the layout talking: a cell on the hull edge is worth roughly ten times an
   interior one, which is what makes where you site a component a decision. */
function combatHit(id){
  const s=S;
  const canHit = q => q.grp!=="shield" && fitted(q) && !s.dmgParts.includes(q.id);
  const canHitRun = key => !s.dmgParts.includes("pipe:"+key);
  let p;
  if(id!==undefined && id!==null){
    /* a run is named "pipe:"+its own net key, never a raw key on its own -
       so an id that names a fitting or a component can never accidentally
       resolve as a run, and vice versa */
    if(typeof id==="string" && id.indexOf("pipe:")===0){
      const key=id.slice(5);
      if(!P.net.byKey[key] || !canHitRun(key)) return;
      p=pipePart(key);
    } else {
      p=LAY.parts.find(q=>q.id===id);
      if(!p||!canHit(p)) return;
    }
  } else {
    const parts=LAY.parts.filter(canHit);
    const runs=hittableRunKeys(P.net).filter(canHitRun).map(pipePart);
    const targets=parts.concat(runs);
    if(!targets.length) return;
    /* the layout talking, part and run alike: a cell on the hull edge is
       worth roughly ten times an interior one (HITW_HULL/HITW_BASE,
       pipenet.js). A part pays the flat rate once regardless of its own
       footprint; a run pays it once per cell of pipe, because a longer run
       really is more exposed pipe for a stray round to find - see runWgt()'s
       own comment for why that is the one deliberate difference. */
    const wgt=targets.map(q=>{
      if(q.isRun) return runWgt(q.cells);
      let e=0;
      for(let X=q.x;X<q.x+q.w;X++) for(let Y=q.y;Y<q.y+q.h;Y++)
        if(X===0||X===GW-1||Y===0||Y===GH-1) e++;
      return HITW_BASE + e*HITW_HULL;
    });
    let r=srand(s)*wgt.reduce((a,b)=>a+b,0), k=0;
    while(r>wgt[k] && k<wgt.length-1){ r-=wgt[k]; k++; }
    p=targets[k];
  }
  s.dmgParts.push(p.id);
  const fx=dmgFx(p.id);
  if(fx.hit) fx.hit(s);
  logE("alarm","COMBAT DAMAGE / "+fx.msg, fx.why+
    (p.access?"  A repair party can reach it.":"  IT IS WALLED IN - no repair is possible with this layout."));
}
/* ══════════ REPAIR ══════════
   Sending a party is sim mutation, so it lives here beside the hit it undoes,
   not in the screen that happens to carry a button for it. It is named by ID
   rather than handed the part object, because an act has to be serialisable:
   a tape and a scenario line both carry "sg2", never a reference to a member of
   LAY.parts. The part is looked up here, which is also the only place the two
   refusals are written - a component your layout has walled in can never be
   reached, and a party already out is not split in two. */
const repairNeed = p => 14 + p.w*p.h*4;
/* Either kind of job's live dose rate, through the one accessor: dmgPart()
   hands back a rectangle for a component and a cell list for a run, and
   radParty() reads whichever it is given. Two shapes, one definition of what
   standing next to a job costs - the alternative was a second copy of that
   formula, and a run and a component quietly disagreeing about dose. */
const repairRadRate = (f, id) => radParty(f, dmgPart(id), occupied(null));
function repairStart(id){
  const s=S;
  const p = dmgPart(id);
  /* partySpent is the fourth refusal, beside "not there", "walled in" and
     "already out": there is no second party this run, and the dispatch order
     is simply not carried out - a no-op, the same shape as every other
     refusal in this block, not a message about why the request was denied. */
  if(!p || !p.access || s.repair || s.partySpent) return;
  const need=repairNeed(p);
  s.repair={id:p.id,t:0,need};
  /* Seed repRate here rather than waiting for the next tick's radiation block.
     Two reasons, and the second is the one that matters: s.repRate is written
     only inside step(), so between the dispatch and the next tick it still
     holds the rate of a job that is already over - and the sentence below is
     composed in exactly that window. A dispatch that quotes the LAST job's
     field would be wrong in the one place the player is actually reading.
     The estimate is need/radWorkK, never need: the field does not change how
     much work a job is, it changes how fast the party can do it, and quoting
     the raw need would promise a time the sim will not honour. */
  const f=radSolve(P.radK,radSrc(s));
  s.repRate=repairRadRate(f,p.id);
  const eta=need/radWorkK(s.repRate);
  /* NOT partName(p): that lives in src/core/ui.js, which WORKER_SIM
     (runworker.js) deliberately excludes from the sim's own loaded subset -
     this call site runs inside the scenario worker too, and a scenario that
     dispatches a repair party would silently die there. p.name stays the
     honest, worker-safe choice until a player-renamed label has a home the
     sim can reach without reaching for the render layer. */
  logE("info","REPAIR PARTY DISPATCHED / "+p.name,
    "Estimated "+eta.toFixed(0)+" seconds at "+s.repRate.toFixed(2)+
    "x area dose - "+(s.repRate>RAD_SLOW
      ? "hot enough that the party works in short shifts, which is why this is longer than the "+need+" s the job itself takes."
      : "cool enough to work straight through, so this is the job's own "+need+" s.")+
    " It takes dose the whole time, at the rate of the cell it is standing in.");
}

/* ── ganging and splitting the banks ──
   The one act, because both directions have seeding rules that must not exist
   twice. Splitting is bumpless by construction: every bank simply adopts where
   it already stands as its own demand. Ganging is NOT bumpless if you just
   flip the flag - the gang derivation would overwrite rodZ in a single tick and
   step several hundred pcm into the core - so it sets reGang instead and the
   drives walk the banks together at their own rate. The mode does not actually
   change until they have arrived. */
/* ── the master bank demand, in every mode ──
   The bank slider is the control you reach for without looking, so it is never
   taken off the panel. What it MEANS is the same sentence in all three states:
   "move the whole stack to here". Ganged there is one stack; split there are NB
   of them and the slider carries them all by the same amount, so the spread the
   per-bank sliders set is untouched; reganging, s.rodDem IS the target the banks
   are walking to, so writing it steers the walk instead of being wiped by it.

   It moves a bank on MANUAL as well. MANUAL means the temperature controller is
   not driving that bank - it never meant the operator could not. This is the one
   writer; nothing else may set s.rodDem from the panel.

   The mean is refreshed here rather than waiting for the next tick, because the
   pointer can call this twice in one frame and a delta measured against a stale
   mean would be applied twice. */
function setCommon(v){
  const s=S;
  if(s.split && !s.reGang){
    const d=v-s.rodDem;
    let m=0; for(let b=0;b<P.NB;b++){ s.rodZDem[b]=clamp(s.rodZDem[b]+d,0,1); m+=s.rodZDem[b]; }
    s.rodDem=m/P.NB;
  } else s.rodDem=clamp(v,0,1);
}

function setSplit(on){
  const s=S;
  if(on && !s.split){
    s.rodZDem.set(s.rodZ); s.split=true; s.reGang=false;
    logE("warn","BANKS SPLIT",
      "The banks are now driven one at a time and the tilt trim is stood down - per-bank demand is the tilt handle from here. Each bank keeps its own AUTO or MANUAL setting, and the T-avg controller drives only the ones left on AUTO. Fewer banks on AUTO means less worth answering the same temperature error, so the loop gets slower, not just smaller.");
  } else if(!on && s.split && !s.reGang){
    /* Seed the target here, once. If it kept tracking the mean while the banks
       converge, the target would chase the banks that are chasing it. The target
       is s.rodDem rather than s.rodPos, so the master slider still steers the
       walk instead of being overwritten by it every tick. */
    let m=0; for(let b=0;b<P.NB;b++) m+=s.rodZ[b];
    s.rodPos=s.rodDem=m/P.NB;
    s.reGang=true;
    logE("info","BANKS GANGING",
      "The banks are being driven back together at "+(ROD_RATE*100).toFixed(1)+" %/s. They are still split until they arrive, and a scram overrides this at any point.");
  }
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
  if(s.flowNet<P.flowMin*1.02 && s.heat>0.3) return "LOW FLOW";
  if(s.P<P.P0*0.86)                         return "LOW PRESSURE";
  if(s.vf>0.30)                             return "CORE VOID";
  if(s.sc<3)                                return "LOW SUBCOOLING";
  return "";
}

/* Why a reset would be refused right now, or "" if it would clear. The button
   and the panel readout ask the same helper, so the promise cannot drift from
   the act. The veto belongs to a LIVE protection system: bypassed is the
   operator taking the check off, exactly as it does for the trip itself. */
const resetVeto = ()=> (S.scrammed && rpsLive()) ? tripCause() : "";
/* Clearing a trip is a deliberate act, never a side effect of nudging a slider.
   With protection armed the plant holds a veto while a trip condition stands.
   Bypassed or never fitted, there is nothing to consult, and the risk is yours. */
function resetTrip(){
  const s=S;
  if(!s.scrammed) return false;
  const why = resetVeto();
  if(why){
    logE("warn","TRIP RESET REFUSED",
      why+" is still present. The latch will not clear until the condition does.");
    return false;
  }
  s.scrammed=false; s.trip="";
  logE("info","TRIP RESET",
    "Protection latch cleared by hand. The control bank answers demand again."+
    (rpsLive()?"":" Nothing checked the plant first - protection is "+rpsState().toLowerCase()+"."));
  return true;
}

/* ── the T-avg rod controller, as four numbers the operator can reach ──
   These are the commissioning tune, not a law. resetPlant() copies each one
   onto S, the panel drives it from there, and every tooltip quotes the const
   rather than a second copy of the number. */
const AUTOROD_LEAD=12;                  // seconds of lead
const AUTOROD_GAIN=0.0016;              // rod fraction per K of error per tick-second
/* How far the controller may walk the bank. Not a safety limit - it is what
   stops the bank wandering off the position the shutdown margin was measured
   from. Widen it and the controller has more authority and less margin. */
const AUTOROD_LO=0.20, AUTOROD_HI=0.50; // furthest out / furthest in, fraction inserted
/* How fast a rod drive moves, ganged or split - one motor, one speed. The tilt
   trim and the reganging walk are both derived from it below, so retuning the
   drives cannot leave one of the three behind. P.scram replaces it on a trip. */
const ROD_RATE=0.012;                   // fraction of travel per second
/* actuator rates. Boration is charging-pump flow; dilution has to displace loop
   inventory, so it is slower. Poisoning yourself is easy, getting back out is not. */
const BOR_IN=60, BOR_OUT=35;            // pcm/s toward more / less boron
/* A motor-operated valve strokes end to end in roughly 17 s - 1/17 fraction
   of travel per second, the same shape as ROD_RATE above, just a slower
   motor. S.valve walks toward S.valveDem at this rate every tick; see the
   walk beside the boron one below. */
const VALVE_RATE=1/17;
/* The lift and reseat setpoints, as fractions of P0. Named because the plant
   view now prints the margin to the lift point beside the valve, and a readout
   that carried its own copy of 1.06 would go on promising a setpoint the sim
   had moved. The gap between them is the valve's deadband: it lifts high and
   does not reseat until pressure is well back down, which is what stops it
   chattering on the setpoint. */
const PORV_LIFT0=1.06, PORV_RESEAT0=1.01;
/* The one reader of a relief fitting's own setpoints. A valve dialled at the
   bench carries its own pair in D.fit (addFit(), layout.js); an older design,
   or any fitting never dialled, carries null and gets the defaults above. The
   fallback is written HERE and nowhere else, or the tick, the plant view and
   the auditor would each grow their own idea of what an unset field means.
   P is null on the bench, the same P?fallback:D idiom reliefFitIds() uses. */
function reliefSet(fid){
  const f=P?P.fit:D.fit, j=(f&&f[fid])||{};
  return {lift: j.lift||PORV_LIFT0, reseat: j.reseat||PORV_RESEAT0};
}
/* "is THIS valve allowed to lift by itself" - the one predicate the tick may
   ask, exactly as autoLive(k) is the one predicate for a system bypass. The
   master switch and the valve's own arm both defeat it; nothing reads
   S.porvByp[fid] raw. */
const porvLive = fid => autoLive("porv") && !S.porvByp[fid];
/* How fast the pressurizer's steam bubble gives up, per unit of inventory
   leaving per second through ANY opening (a break, the vessel itself, or a
   relief valve - see its own comment where it is applied, below). Fitted
   once, against the flat 0.35/s the old vessel blowdown used at the rate a
   break drained, so a full vessel rupture still blows down in about the
   same dozen seconds, and everything smaller than one now takes
   proportionally longer instead of exactly as long. */
const BLOWDOWN_K=0.20;
/* pump rotational inertia, and the longer coastdown once the power is gone */
const FLOW_TAU=5, FLOW_TAU_COAST=12;    // seconds
const NAT_FLUX=0.12;                    // mass flux buoyancy gives per unit of heat removal
/* ── the secondary mass balance (Stage 6a) ──
   s.sgl used to be clamp(50+(heat-s.load)*40-(s.load-1)*14,0,100), recomputed
   from scratch every tick with no memory, so it could not run out however long
   the feed was gone. It is an INTEGRAL now: steam raised out, feedwater in.

   Steam raised is heat removed over the latent heat, which is the only new
   physics here - the tick already computes `removal`, so this is a mass
   balance and not a second solve. */
const H_FG=1510;          // kJ/kg, latent heat at the secondary's ~6.9 MPa
const SGL_SET=50;         // %, the level the feed controller holds
const FEED_TAU=30;        // s, how fast feedwater walks a level error out
const FEED_HURT=0.25;     // DMGFX.feed's own promise: "feedwater down to a quarter"
/* Below this the tubes are uncovered and the generator stops being a heat sink.
   It was already the threshold the mimic's dry-out pulse and the LOW banner
   used; making removal read the same number is what closes the loop. */
const SG_DRY=25;          // %
/* Level below which a feed pump starts losing suction, %. A pump does not run
   cleanly to the last drop; this is the taper, and it is above the hard mass
   limit rather than instead of it. */
const HOT_NPSH=10;
/* What a tank's overboard dump valve passes, in % of that tank per second.
   Sized off the plant it serves rather than picked: at the stock plant's steam
   rate it empties a full hotwell in about a minute, which is fast enough to
   stay ahead of a tube rupture and slow enough that opening it is a decision. */
const HOT_DUMP=1.6;
/* Loop volume over pressurizer volume, which is what turns a volumetric
   expansion (% of loop) into a level (% of pressurizer). NOT a free constant:
   it is exactly the figure the correlation this replaces implied, so the gauge
   does not re-pin. At a steady heating rate the whole expansion source arrives
   up the surge line, so LVL_K*100*BETA_W is the correlation's own 0.9 %/K.
   Re-derive: LVL_K = 0.9/(100*BETA_W). A real PWR is nearer 7.5. */
const LVL_K = 0.9/(100*BETA_W);
/* Kilograms of secondary water at 100 % level in ONE generator. */
const sgMass=()=>SGT[D.sg].water*1000;
/* Specific heat of pressurised water at PWR conditions, kJ/kg/K. PHYSICAL,
   not fitted. With CORE_DT0 it turns rated power into the loop's rated mass
   flow, and that is the one bridge between a flow in % of loop inventory -
   invRate()'s currency, which is what an SGTR leak is measured in - and a
   flow in kg/s, which is what the secondary mass balance counts. Without it
   the two sides of a tube rupture are in units that cannot be added. */
const CP_W=5.5;
const loopKg=()=>P.rated*1000/(CP_W*CORE_DT0)*LOOP_TRANSIT;
/* Kilograms of condensate the hotwell holds full. The plant's own generators
   are the yardstick - a condenser hotwell holds roughly what the generators
   it feeds do - so this needs no constant of its own and follows the
   generator type the player actually bought. */
const hotMass=()=>Math.max(1, sgCount()*SGT[D.sg].water*1000);
/* Every generator on the plant, by id, in LAY order. s.sglBy is keyed on
   these and so is every reader - a level belongs to a machine, not to the
   plant, which is the whole of the per-generator half of Stage 6a. */
const sgIds=()=>LAY.parts.filter(p=>p.role==="sg").map(p=>p.id);
/* How much of a heat sink ONE generator still is: 1 down to SG_DRY, then
   straight to nothing. A generator that is not on the plant, or a level that
   was never seeded, reads 1 - such a design is stopped by having no thermal
   path at all, not by a level it does not have. */
const sgFill=(s,id)=>{ const v=s.sglBy&&s.sglBy[id];
  return v===undefined?1:clamp(v/SG_DRY,0,1); };
/* ONE generator's level as a number, for a reader that wants to print it.
   Defaults to SGL_SET rather than 0 for a generator with no entry yet - a
   bench with no sim running draws a half-full kettle, not an empty one. */
const sgLvl=(s,id)=>{ const v=s&&s.sglBy&&s.sglBy[id]; return v===undefined?SGL_SET:v; };
/* The driest generator on the plant. The trend, the annunciator and the feed
   panel each want ONE number, and the dry one is the number that matters -
   an average would hide a generator boiling dry behind three healthy ones. */
const sglMin=s=>{ const ids=sgIds(); if(!ids.length) return 100;
  let m=100; for(const id of ids){ const v=s.sglBy&&s.sglBy[id];
    if(v!==undefined && v<m) m=v; } return m; };
/* Each generator's share of the heat leaving the primary, off the per-loop
   flow the network already solved (netFlowK fills outs.byLoop). Heat crosses
   into a generator in proportion to the water going through its own loop, so
   a throttled loop boils its own generator down more slowly and a loop with
   no flow at all boils nothing. Falls back to an equal split when the solve
   has nothing to say - a plant at rest before its first solve, or one whose
   generators sit on no loop at all. */
function sgShare(byLoop){
  const ids=sgIds(), out={};
  if(!ids.length) return out;
  let tot=0;
  for(const id of ids){ const i=loopOf(id);
    const q=(i!=null && byLoop && byLoop[i]>0) ? byLoop[i] : 0; out[id]=q; tot+=q; }
  if(tot>0){ for(const id of ids) out[id]/=tot; }
  else for(const id of ids) out[id]=1/ids.length;
  return out;
}
/* The outflow a full-bore severance makes at design pressure, in % of loop
   inventory per second - the scale every break EFFECT is drawn against, so a
   pinhole reads as a wisp and a guillotine reads as full. One number, in the
   sim, rather than a renderer inventing its own. */
const SPILL_FULL=8.0;
/* How far past zero subcooling a pump goes from full head to nothing. A
   transition width, not a threshold: cavitation BEGINS at zero subcooling and
   scAt() says where that is, but a pump does not lose all its head inside one
   kelvin. */
const CAV_SPAN=12;
// the leak, in % of inventory per second, that takes the pressurizer's
// authority away entirely - a pinhole barely touches it, a LOCA ends it
const PZR_LOSE=2.0;
/* The core's temperature rise at RATED flow and rated heat, in K: exactly the
   30 K the 0-D Tavg +/- 15*heat split has always given, so s.coreDT is that
   split and not a second opinion about it. QMIN floors the flow it is divided
   by and CORE_DT_MAX caps the answer - past that the hot leg is at saturation
   and the loop boils instead of getting hotter. TAU is the time the water
   takes to go round once and come back. */
const CORE_DT0=30, CORE_DT_TAU=6, CORE_DT_QMIN=0.004, CORE_DT_MAX=CORE_DT0/NAT_FLUX;
// the rise at RATED flow: what s.coreDT settles to, and what a plant that has
// only just been commissioned already has in it
const coreDTRated = heat => CORE_DT0*heat;
/* governor valve stroke plus steam-plant response */
const LOAD_TAU=2;                       // seconds
/* ── RADIATION: HOW FAST THE TWO CREWS ARE SPENT ──
   RAD_DOSE_K is deliberately the same 0.25 the old flat P.dose*0.25*dt line
   used - what changed with the live field is WHICH number it multiplies
   (s.repRate, the dose at the cell the party is actually standing in, not a
   commissioning-time figure for a room on the far side of the plant), never
   how fast a party spends itself once it is standing somewhere hot.
   RAD_CREW_K is new: it puts a watch pinned at the RAD_CEIL (3x) ceiling at
   100% dose in about 100 s, the same order as a serious accident's own
   timescale on this clock, so the number is something a player can read
   an emergency against rather than an arbitrary bar filling. */
const RAD_DOSE_K=0.25, RAD_CREW_K=0.33;
/* ── HOW A HOT FIELD SLOWS A REPAIR PARTY ──
   Pillar 4: the game never refuses an order on the grounds that it is a bad
   idea. A field too hot to work in does not turn the party back - it makes
   them slower, because they are working in short shifts from behind whatever
   cover the layout gave them rather than standing in the open the whole time.
   No penalty at or below RAD_SLOW (a well-shielded default plant is exactly
   as fast as it always was); half rate at 1.5x, a quarter at 3x, asymptotic
   to zero but never actually zero - there is always a shift short enough to
   make some progress in.
   One helper and not an inline expression because it is read from TWO places
   that must never be allowed to disagree: the repair block below DOES the
   slowdown (s.repair.t advances by dt*radWorkK(rate)) and the damage panel
   PROMISES it (its ETA is need/radWorkK(rate)). CLAUDE.md's own working-style
   rule is that the number a control displays must match the number it
   causes - two copies of this formula would let the panel's estimate and the
   sim's reality drift apart the first time either one was retuned. */
const RAD_SLOW=0.5;
const radWorkK = r => 1/(1+Math.max(0,r-RAD_SLOW)/RAD_SLOW);
/* ── DECAY HEAT ──
   Fission products keep making heat after the chain reaction stops, and they do
   NOT stop. A single lag chasing current power did: it fell to nothing about two
   minutes after a scram, which quietly made every drained-and-shut-down core
   impossible to damage. That is the accident that actually happens - Three Mile
   Island and Fukushima both melted from decay heat with the reactor already shut
   down and no water left.
   So decay heat is four exponential groups, the same maths as the delayed
   neutron precursors above: each group is bred by power and decays on its own
   clock. They sum to 6.4% at full power, ~2.6% at 100 s after a trip, and just
   under 1% an hour later, which is the shape of the real curve. The long group
   has a half-life of nine hours, so on any timescale this game cares about it is
   simply a floor that never goes away. */
const DEC_A=[.0299,.0212,.00947,.00380];        // share of rated power per group
const DEC_L=[.0994,.00477,4.11e-4,2.19e-5];     // 1/s
/* A tilt of 1.0 stands the innermost bank XTILTZ of core height clear of the
   outermost, and the drives that do it are the same drives that move the bank.
   So the trim walks at the bank rate divided by that span - derived, not typed,
   or the two drift apart the next time the span is retuned. */
const TILT_RATE=ROD_RATE/XTILTZ;
const tsat=p=>P.tsat0*Math.pow(Math.max(p,.05)/P.P0,.10);
/* The coolant temperature programme: where T-avg is meant to sit for the load
   the turbine is drawing. One function, because the rod controller walks to it,
   the steam dump trims to it, the TAVG DEV tile judges against it and the panel
   prints the deviation from it - and a PWR number hard-coded in any one of
   those lights the alarm on every plant that is not a PWR. Through a trip the
   runback takes the load off, so the programme drops to its no-load point; with
   the runback bypassed the turbine is still drawing, and the programme has to
   keep following it. */
const tProg=s=>P.Tref-18 + ((s.scrammed && autoLive("runback")) ? 0 : 18*s.load);

function resetPlant(){
  const x0=RODX0;
  S={n:P.n0,C:P.bet.map((b,i)=>b*P.n0/(P.LAM*P.lam[i])),I:P.gI*P.n0/P.lamI,X:P.X0,
     Tf:P.TfRef,Tavg:P.Tref,rodPos:x0,rodDem:x0,rodJam:false,scrammed:false,
     load:1,loadDem:1,flow:1,flowDem:1,flowNet:1,P:P.P0,lvl:54,inv:100,
     /* one level per generator, keyed by part id like s.sgtrBy - REFILLED by
        step(), never rebuilt, so a renderer may hold it across frames */
     sglBy:Object.fromEntries(sgIds().map(id=>[id,SGL_SET])),
     /* each generator's share of the heat leaving the primary, measured off
        the solve and read back by secP() next tick - like s.cavP */
     sgShare:Object.fromEntries(sgIds().map(id=>[id,1/Math.max(1,sgCount())])),
     /* last tick's void and inventory, so the two halves of the level that are
        still correlations can be differentiated into rates - the expansion
        half is the solve's own surge flow and needs no memory of its own */
     vf0:0, inv0:100,
     /* One map per relief fitting, keyed like S.valve/S.valveDem - seeded
        from P.fit rather than a fixed set of keys, so a plant with no
        relief path (a legal design choice, see the bench warning in
        design.js) simply seeds nothing and every reader above (all written
        against reliefFitIds()) finds an empty list rather than a phantom
        valve. reliefArm mirrors porvArm's old job, per fitting: the one-shot
        a scenario sets to command THAT fitting's next lift to stick. */
     reliefOpen:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     reliefAuto:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     reliefStuck:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     reliefBlocked:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     reliefArm:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     /* per-valve arming, seeded for RELIEF fittings only - a tee or a throttle
        has no automatic behaviour to defeat, and a phantom key here is a
        phantom key in every snapshot taken from now on. */
     porvByp:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     dmg:0,fatigue:0,dnbr:P.dnbr0,rho:0,voidTh:0,cav:0,vf:0,
     /* the groups start in equilibrium with commissioning power, or the plant
        would spend its first minutes breeding heat it should already have */
     dec:DEC_A.map(a=>a*P.n0), decay:DEC_A.reduce((t,a)=>t+a,0)*P.n0,
     byp:Object.fromEntries(AUTOKEYS.map(k=>[k,false])),
     breach:false,melt:false,trip:"",
     ev:{}, blackout:false, nat:0, release:0,
     /* EVERY tank, four plain objects keyed by tank id - so snapVal() takes
        them for free and adding a tank adds an entry to each rather than a
        field to S. Nothing here knows what any of these tanks IS.
          tank      level, 0..100, seeded from the tank's own commissioning level
          tankOpen  the operator's own valve (an AUTORULE may open it anyway)
          tankDump  its overboard dump valve
          tankByp   its own rule, defeated - the arm switch every automatic
                    system has, on the tank instead of on a system row
          burstBy   its rupture disc, once gone. Latched: a burst disc does
                    not reseat, and what was in the tank is on the floor.
          tankOver  what it is spilling past full, kg/s - a readout */
     tank:Object.fromEntries(tankIds().map(k=>[k,D.tanks[k].level])),
     tankOpen:Object.fromEntries(tankIds().map(k=>[k,false])),
     tankDump:Object.fromEntries(tankIds().map(k=>[k,false])),
     tankByp:Object.fromEntries(tankIds().map(k=>[k,false])),
     burstBy:Object.fromEntries(tankIds().map(k=>[k,false])),
     tankOver:{},
     /* what each tank's own edge is carrying, % of loop inventory per second,
        tank-out-positive - a readout, REFILLED never rebuilt, because a
        renderer holds it across frames to meter that tank's own line */
     tankRate:{},
     /* the controller's tune, copied from the commissioning constants so a
        RESET PLANT puts the operator's experiments back where they started */
     split:false, reGang:false,
     /* Shut, always, whatever tee was fitted. A branch you have to open by
        hand is one that cannot change the plant you just commissioned
        behind your back, and one that was never placed is the same plant to
        the flow model as one placed and left shut. */
     juncOpen:Object.fromEntries(Object.keys(P.fit).filter(k=>P.fit[k].mode==="tee").map(k=>[k,false])),
     /* A throttle's actual AND demand both start on the same as-commissioned
        default (every actuator's demand starts equal to its actual - see
        flow/rod/boron below): a BRANCH throttle shut, for the same reason a
        tee is - a branch you have to open by hand cannot change the plant
        behind your back. An IN-LINE throttle WIDE - it sits directly on a
        run every design already depends on, so shut-by-default would choke
        a main leg the moment it was fitted, which is not a conservative
        default, it is a broken one. */
     valve:Object.fromEntries(Object.keys(P.fit).filter(k=>P.fit[k].mode==="throttle")
       .map(k=>[k, P.fit[k].bKey?0:1])),
     valveDem:Object.fromEntries(Object.keys(P.fit).filter(k=>P.fit[k].mode==="throttle")
       .map(k=>[k, P.fit[k].bKey?0:1])),
     arGain:AUTOROD_GAIN, arLead:AUTOROD_LEAD, arLo:AUTOROD_LO, arHi:AUTOROD_HI,
     dmgParts:[], repair:null, sgtr:false, noiseMul:1,
     /* Two crews, two places. `dose` is the repair party's own integral - it
        takes whatever the cell it is STANDING in reads, via s.repRate below.
        `crewDose` is the control-room watch's, off the crew's own seat
        (P.radK.crew) - it accumulates whether or not anyone is out on a job,
        because the watch never leaves. Each gets a RATE as well as an
        INTEGRAL: the rate is what you steer by (it is what lights HI AREA RAD
        and what the panel prints this second), the integral is what you
        actually pay. doseRate starts on P.dose rather than 0 for the same
        reason every other actuator's demand starts equal to its actual -
        tick zero must not read a number this plant does not have yet. */
     /* one cavitation figure per PUMP, at its own suction - s.cav beside it
        is the worst of them, which is what the annunciator and the panel
        want. A plain object, so snapVal() takes it for free. */
     cavP:Object.fromEntries(Array.from({length:P.loops},(_,i)=>[i,0])),
     dose:0, crewDose:0, doseRate:P.dose, repRate:0, partySpent:false,
     bkpLost:false, dLvl:0,
     boron:0,boron0:0,boronDem:0,parts:{rod:0,dop:0,mod:0,xe:0,bor:0,vd:0,tip:0},
     /* One flow integral per RUN, not per kind - see the pipe-animation block
        below. Seeded from P.net's own key set (every run pipeNetwork() would
        draw, hot/cold/steam/feed/exh/surge/hpi and one per branch fitting)
        rather than a fixed kind table, so a four-loop plant gets four hot-leg
        integrals and a fitting that failed to route gets none. */
     flowPos:Object.fromEntries(Object.keys(P.net.byKey).map(k=>[k,0])),
     /* perN/perT/perV are the reactor-period differentiator's own state. They
        used to be module globals in trends.js; they are here because a
        snapshot is a clone of S and nothing the tick carries may sit outside
        it. s.tick is the recording's only index - s.t stays because forty
        things read it, but a float second cannot key a keyframe. */
     perN:P.n0, perT:0, perV:Infinity,
     /* seed/rng are the dice cursor (see rng.js); diceOff stands them down for
        a scripted run. */
     seed:0, rng:0, diceOff:false,
     /* The core's own temperature rise, in K, and the one thing buoyancy
        consumes (pipenet.js). Starts at 0 - a plant nobody has run yet is
        isothermal, and the loop takes seconds to establish a rise - which is
        also what keeps an undamaged, untouched plant's netFlowK() exactly 1
        against a reference built at the same isothermal state. */
     coreDT:0,
     /* the pressure in the vessel, MPa - a readout the tick fills, beside
        heat and sc, and no longer the same number as s.P */
     pCore:P.P0,
     /* what injection is actually delivering, % of loop inventory per second
        - a readout, and the number the panel prints and the packets run at,
        so neither can invent one of its own */
     injRate:0,
     /* what a ruptured generator is actually passing into its secondary,
        % of loop inventory per second - a readout, and the number the panel
        and the badge both print */
     sgtrRate:0,
     /* and the same per GENERATOR, so the jet lands on the machine that was
        hit - refilled, never rebuilt, exactly like spillBy */
     sgtrBy:{},
     /* every opening on the plant and what it is passing - refilled, never
        rebuilt, so a renderer holding it never reads a stale object */
     spillBy:{}, spillRate:0,
     spin:0,spinT:0,dTavg:0,heat:0,sc:0,t:0,tick:0};
  /* The ONE Math.random() the sim is allowed, and it is outside the tick: a
     new run picks a seed, and from there every die comes off s.rng, so the run
     replays from its own seed. Rolling inside step() instead would put numbers
     in the plant that are in no snapshot. */
  seedRng(S,(Math.random()*4294967296)>>>0);
  /* heat and subcooling used to start on two round numbers that were nowhere
     near the plant being commissioned - 35 K of subcooling on a gas core that
     actually sits 1400 K below saturation. They are derived from the state this
     function just built, by the same expressions step() uses, so the readouts
     and P.sc0 are right on tick zero instead of after the first tick. */
  S.heat = S.n*.935 + S.decay;
  /* the rated-flow value of the same expression the tick uses - a plant on
     tick zero is at rated flow by construction, so its rise is coreDTRated()
     even though s.coreDT has not walked up to it yet */
  S.sc   = tsat(S.P) - (S.Tavg + coreDTRated(S.heat)/2);
  /* Settle the flux shape first, then dial in the boron that actually makes
     THIS shape critical. Rod worth is emergent now, so a formula would leave
     the plant slightly off-critical and walk it into a trip nobody caused. */
  coreReset(S);
  S.boron = S.boron0 = -(P.excess+coreRodWorth(S)-P.KXE*P.X0);
  S.boronDem = S.boron;                 // start on demand, or it walks off commissioning
  /* THE SIM DOES NOT REQUIRE A DISPLAY. pipeReset()/fxReset() clear the pipe
     animation's and the ambient effects' smoothing, which only exist when
     something is being drawn - a headless runner (the auditors, a scenario
     run) loads no renderer at all. The guard is the honest shape of that: ask
     whether there is a display before telling it the clock moved. */
  LOG=[]; initHist();
  if(typeof pipeReset==="function") pipeReset();
  if(typeof fxReset==="function") fxReset();
  logE("info","PLANT AT POWER",
    P.name+" commissioned at "+P.rated.toFixed(0)+" MWt, holding "+(P.n0*100).toFixed(1)+"% - pipe run and pump head decide how much of the rating the loop can actually carry. Everything that happens from here is logged with the reason.");
}
function step(dt){
  const s=S; s.t+=dt; s.tick++;

  /* ── control rods ──
     T-avg error alone is two integrations away from rod position, so on a
     weakly self-limiting core (small moderator coefficient) the bank hunts and
     the swing grows until the RPS trips it. The rate term is the lead
     compensation a real rod controller uses: it stops pushing once T-avg is
     already moving the right way. Both the gain and the lead are the operator's
     to get wrong. Note s.dTavg is last tick's rate - it is computed further down
     - and that one-tick lag is part of the tune this was fitted with. */
  const rodErr = clamp(s.Tavg-tProg(s) + s.arLead*s.dTavg, -6, 6) * s.arGain*dt*50;
  /* The band is what stops the controller wandering off the position the
     shutdown margin was measured from. It is not a safety limit and the operator
     may open it all the way - but opening it does NOT free the bank, it gives
     the controller more room to move it. The only two ways out from under this
     controller are the bypass and per-bank MANUAL. lo/hi cannot invert, because
     the two setters clamp against each other. */
  const rodLo=clamp(s.arLo,0,1), rodHi=clamp(Math.max(s.arHi,s.arLo),0,1);

  if(!s.split && bankAutoLive(0))                 // ganged: one controller, one bank
    s.rodDem=clamp(s.rodDem+rodErr, rodLo, rodHi);

  /* ── ganging the banks back together ──
     The banks are driven together, never teleported: rodBanks() would otherwise
     overwrite every bank in a single tick. The mode stays SPLIT until they have
     all arrived, so the gang derivation is never handed a spread it did not
     produce. rodPos was frozen by setSplit() and is deliberately not tracking
     the mean here, or the target would chase the banks that are chasing it. */
  if(s.reGang){
    let done=true;
    for(let b=0;b<P.NB;b++){
      s.rodZDem[b]=clamp(s.rodDem+P.bankW[b]*XTILTZ*s.tilt,0,1);
      if(Math.abs(s.rodZ[b]-s.rodZDem[b])>1e-6) done=false;
    }
    if(done){ s.split=false; s.reGang=false; }
  } else if(s.split){
    /* Split: the same temperature error reaches every bank left on AUTO. It is
       deliberately NOT divided among them - two banks in manual means the two
       still answering carry the same error with less worth between them, so the
       loop genuinely gets slower. That is the cost of taking banks off auto,
       and it is emergent rather than charged. */
    for(let b=0;b<P.NB;b++)
      if(bankAutoLive(b)) s.rodZDem[b]=clamp(s.rodZDem[b]+rodErr, rodLo, rodHi);
  }

  /* A latched trip owns every bank, ganged or split, auto or manual. The slider
     can still be moved, but its demand does not reach the drives until the latch
     is reset by hand - otherwise a nudge on the slider pulled the rods straight
     back out of a scrammed core, and the reset then refused because the flux it
     caused was still high. This sits after the reganging block so a scram wins. */
  if(s.scrammed){ s.rodDem=1; s.rodZDem.fill(1); }

  /* One motor, one speed, whichever mode it is in. A jam freezes the lot. */
  if(!s.rodJam){
    const r=s.scrammed?P.scram:ROD_RATE;
    if(s.split) for(let b=0;b<P.NB;b++){ const d=s.rodZDem[b]-s.rodZ[b];
      s.rodZ[b]+=Math.sign(d)*Math.min(Math.abs(d),r*dt); }
    else { const d=s.rodDem-s.rodPos;
      s.rodPos+=Math.sign(d)*Math.min(Math.abs(d),r*dt); }

    /* ── radial tilt trim: an actuator too ──
       It biases the inner banks against the outer ones, and it is the one handle
       on a radial xenon tilt while the banks are ganged. Split, the per-bank
       demands are that handle, so the trim stands still rather than fighting
       them. A jammed bank takes the trim with it either way. */
    if(!s.split){ const d=s.tiltDem-s.tilt;
      s.tilt+=Math.sign(d)*Math.min(Math.abs(d),TILT_RATE*dt); }
  }
  /* Settle where each bank actually stands - the one place that decides it. */
  rodBanks(s);
  /* Split, the master pair is a readout rather than a state, so the ~8 places
     that print or plot "the bank" keep working without knowing about banks.
     Not while reganging: rodPos is the frozen target the banks are walking to. */
  if(s.split){
    let m=0; for(let b=0;b<P.NB;b++) m+=s.rodZ[b];
    s.rodPos=m/P.NB;                       // actual: the mean of where the banks are
    /* Demand is the master's own command while reganging - it is the target the
       walk is aimed at, so deriving it back off the banks would erase the order
       the moment it was given. Settled, it is the mean of the per-bank demands. */
    if(!s.reGang){ let d=0; for(let b=0;b<P.NB;b++) d+=s.rodZDem[b]; s.rodDem=d/P.NB; }
  }

  /* ── boron: an actuator, not a setting ──
     The slider writes demand; the loop gets there at the rate a charging pump
     can push. Same pattern as the bank above, and the reason its tooltip can
     finally say "slow" without lying. */
  { const db=s.boronDem-s.boron, rb=(db<0?BOR_IN:BOR_OUT)*dt;
    s.boron+=Math.sign(db)*Math.min(Math.abs(db),rb); }

  /* ── throttles: an actuator, not a switch ──
     Same pattern as the bank and the boron walk above: the panel writes
     demand, the motor gets there at VALVE_RATE. One walk for every throttle
     on the plant, keyed by id exactly like S.valve/S.valveDem themselves. */
  for(const id in s.valve){ const dv=s.valveDem[id]-s.valve[id];
    s.valve[id]+=Math.sign(dv)*Math.min(Math.abs(dv),VALVE_RATE*dt); }

  /* ── turbine load: the governor valves take a moment to stroke ── */
  s.load += (s.loadDem-s.load)*Math.min(dt/LOAD_TAU,1);

  /* ── decay heat: the core keeps making heat long after it shuts down ── */
  { let d=0;
    for(let i=0;i<DEC_A.length;i++){
      s.dec[i] += DEC_L[i]*(DEC_A[i]*s.n - s.dec[i])*dt;
      d += s.dec[i];
    }
    s.decay = d; }
  const heat = s.n*0.935 + s.decay;


  /* runFlow is filled by netFlowK() with this tick's real per-run flow -
     scratch, not sim state (it is rebuilt fresh every tick, the same way
     `heat` and `Tprog` below are), so it lives as a local rather than on S.
     The pipe-animation block near the end of this function reads it back. */
  const runFlow = {};
  /* THE PRESSURE FIELD, in MPa, one node at a time - taken off netFlowK()'s
     own solve so the tick pays for one solve and not two. Scratch, like
     runFlow: resolved fresh every tick and never on S, the same argument the
     radiation field makes. pAt() is how every reader below asks it. */
  const pField = {};
  /* what the solve found leaving the plant through every opening on it - a
     severed run's two ends, a ruptured vessel. Scratch, like runFlow. */
  const netOut = {};
  const pumpK = netFlowK(s, runFlow, pField, netOut);
  /* ── the break: a hole with a place and a size, not a schedule ──
     The solved outflow through every opening on the plant, charged to
     inventory through the one flow-to-inventory conversion. Where the break
     is is in it, because local pressure is genuinely higher at a pump's
     discharge than at its suction; how big it is is in it, because bore
     already prices the opening; and it stops on its own when local pressure
     reaches containment, instead of running at a fixed rate forever. */
  const spill = invRate(netOut.spill||0);
  /* WHAT EACH OPENING IS PASSING, in % of loop inventory per second, keyed by
     the opening's own key ("break:"+run key, or "break:core"). A readout, and
     the one every pressure-driven effect reads: an effect must be right, in
     the right place, at the right rate, and a boolean at the reactor is none
     of those when the thing that broke is a hot leg six metres away. */
  { const by = netOut.by || {};
    for(const k in s.spillBy) if(!(k in by)) delete s.spillBy[k];
    for(const k in by) s.spillBy[k] = invRate(by[k]); }
  s.spillRate = spill;
  /* ── injection: what the tank actually pushed, against the loop it is
     fighting ── s.hpi stays the operator's on/off. What goes is the idea that
     switching it on means a RATE: a loop at full pressure takes almost
     nothing from a tank charged to 4.5 MPa, and a depressurised one takes a
     surge, which is the entire mechanic high pressure injection is named
     after. Signed, because the same edge run backwards fills the tank. */
  const qTankBy = netOut.qTankBy || {};
  /* WHAT IS BEING INJECTED, over every primary tank at once - the positive
     half of the same signed figure the level loop below integrates. Positive
     only: a tank being FILLED is not injecting, and summing the two together
     would let one tank hide behind another. Nothing here names a tank. */
  let inj = 0;
  for(const k in s.tankRate) if(!D.tanks[k]) delete s.tankRate[k];
  for(const tid of tankIds()){
    const q = D.tanks[tid].side==="primary" ? invRate(qTankBy[tid]||0) : 0;
    s.tankRate[tid] = q;
    if(q>0) inj += q;
  }
  /* What is left of the pressurizer's authority. It only sets pressure while
     the loop is a closed boundary: past a real leak there is no steam bubble
     to work against, and this is what used to be a hard on/off gated on
     s.breach alone - which said a severed hot leg was a closed loop. */
  const pzrAuth = clamp(1 - spill/PZR_LOSE, 0, 1);
  const pAt = n => { const v = pField[n]; return v===undefined ? s.P : v; };
  /* SUBCOOLING AT A PLACE: how far the water THERE is below its own local
     boiling point. Subcooling and cavitation are the same physics asked at
     two locations, so they are one function called twice. */
  const scAt = n => tsat(pAt(n)) - netTempAt(s, n);
  /* the vessel's own pressure, and an answer rather than a definition now.
     A readout, like s.sc and s.heat beside it - a pure function of the rest
     of S, on S because the panel prints it and a snapshot must carry what
     the panel was showing. */
  s.pCore = pAt("core");

  /* ── pump cavitation: a pump stalls when the water it sucks stops being
     water, and it asks AT ITS OWN SUCTION ──
     There is no offset and no temperature window here any more. Cavitation
     begins when subcooling reaches zero - that is what cavitation IS - and
     scAt() answers that at whatever node is asked, so subcooling and
     cavitation are one function called at two places instead of a headline
     quantity and an unexplained correlation about it. CAV_SPAN is the only
     number left and it is a transition width, not a threshold: a pump does
     not go from full head to none inside one kelvin.
     Fed to NEXT tick's solve (the pump head reads s.cavP, pipenet.js), which
     is why it lives on S: a gate that depends on the answer cannot be part of
     the question. */
  { let worst=0;
    /* Off the real parts and the run graph, never off "pump"+i - a spare
       pump's own id doesn't match its loop's index, and once a generator can
       be placed rather than conjured at a fixed "pump"+i slot, that string
       stops being anything but coincidence. Every pump with ROLE.head reports
       at its own suction; a loop with more than one pump pooling capacity
       (loopOf()) takes the WORST of them, because that is the one head loss
       actually costs the group. */
    const byLoop={};
    for(const p of LAY.parts){
      if(!ROLE[p.role] || !ROLE[p.role].head) continue;
      const li=loopOf(p.id); if(li==null) continue;
      const c = clamp(-scAt(p.id+"t")/CAV_SPAN, 0, 1);
      if(!(li in byLoop) || c>byLoop[li]) byLoop[li]=c;
    }
    for(const li in s.cavP){ s.cavP[li]=byLoop[li]||0; if(s.cavP[li]>worst) worst=s.cavP[li]; }
    s.cav = worst; }
  const bkpUp = !s.bkpLost && autoLive("bkp");
  /* ── coolant flow: pumps have inertia ──
     Losing power does not stop a pump dead, it coasts. Blackout is the same lag
     with a longer time constant, so the grace time the brief promises is real. */
  /* The backup supply carries the share of pump power the bench sold: diesels
     are the full set, a battery bank is half of it. Scaled off demand, so what
     the operator asked for is still what the supply is trying to deliver. */
  { const tgt = s.blackout ? (bkpUp?P.backup*s.flowDem:0) : s.flowDem,
          tau = s.blackout ? FLOW_TAU_COAST : FLOW_TAU;
    s.flow += (tgt-s.flow)*Math.min(dt/tau,1); }

  /* ── the core's temperature rise: the same 0-D split, told about flow ──
     Tavg +/- 15*heat has always BEEN this quantity, at rated flow. The heat
     leaving the core has to leave in the water that is actually moving, so
     below rated flow the same heat needs a bigger rise - which is the whole
     of natural circulation: less flow, more buoyancy, more flow. Capped where
     the rise stops being a rise and the loop simply boils.
     LAGGED, not algebraic: the loop takes seconds to establish a new rise,
     and an algebraic value reading this tick's flow while this tick's flow
     reads it back is a fixed point that oscillates tick to tick rather than
     settling. */
  { const tgt = clamp(coreDTRated(heat)/Math.max(s.flowNet, CORE_DT_QMIN), 0, CORE_DT_MAX);
    s.coreDT += (tgt-s.coreDT)*Math.min(dt/CORE_DT_TAU,1); }
  /* s.flow is NOT a factor here any more: the pump's speed is part of its own
     head inside the solve (netBuild(), pipenet.js), so pumpK already carries
     it - and has to, or a coasted-down pump would multiply the thermosiphon
     the same solve produces by zero. At rated speed on an undamaged plant
     pumpK is exactly 1, so nothing about a running plant changes. */
  const driven = P.flowK * pumpK;
  /* Buoyancy is not a term beside the solve any more - it IS part of the
     solve, an edge head like a pump's (pipenet.js). What is left here is the
     READOUT: the share of this tick's flow the plant developed with every
     pump doing nothing. A correlation could never tell one steam generator
     from another, or notice that the valve between them was shut. */
  s.nat = netOut.nat || 0;
  /* How much of the primary is still liquid. Water is the only thing in the loop
     that carries heat or washes a fuel pin, so an empty vessel does neither, no
     matter how hard the pumps are told to turn. Full down to 70% inventory, then
     straight to nothing by 10%: a partly drained loop still circulates what is
     left. At rest this is exactly 1, so a plant that is not leaking never feels
     it, and commissioning is untouched. */
  const wet = clamp((s.inv-10)/60,0,1);
  /* Heat removal is flow TIMES the rise it carries away, not flow alone. The
     two are the same thing at rated flow - enth is exactly 1 there, so
     nothing about a running plant changes - and they part company under
     natural circulation, where very little water comes back very much
     colder. That is what NAT_FLUX has always asserted; it used to be a
     multiplier bolted onto a correlation, and it is the CAP on this ratio
     now, because past it the hot leg is at saturation and the loop boils
     instead of carrying more away. */
  const enth = clamp(s.coreDT/Math.max(coreDTRated(heat),1e-6), 1, 1/NAT_FLUX);
  /* no (1-0.8*cav) here, and none on mflux or the packet animation below:
     cavitation is inside the pump's own head now, so pumpK already carries
     it. Leaving one of the three behind would count it twice. */
  /* The other side's water, and the half that never existed. `wet` asks
     whether there is primary water to carry heat; this asks whether there is
     secondary water to carry it INTO. A generator boiled dry is a heat
     exchanger with nothing on the cold side, and until Stage 6a it went on
     removing full power forever.

     Last tick's level on purpose, the same argument s.coreDT carries: this
     tick's removal sets this tick's boil-off, which would set this tick's
     level, which would set this tick's removal. Lagged, that is a first-order
     filter; algebraic, it is a fixed point that oscillates.

     Flow-weighted across the generators, not averaged: a generator that is
     dry loses its OWN loop's share of the removal and no more, so three
     healthy generators go on cooling while the fourth boils dry. */
  const sgW = sgShare(netOut.byLoop);
  /* Fed to NEXT tick's solve, where secP() (pipenet.js) reads it to give each
     generator a secondary pressure of its own - the same lag s.cavP carries,
     and for the same reason: this tick's share comes out of this tick's solve,
     so it cannot also be an input to it. REFILLED, never rebuilt. */
  for(const k in s.sgShare) if(!sgW.hasOwnProperty(k)) delete s.sgShare[k];
  for(const k in sgW) s.sgShare[k] = sgW[k];
  let sgWet = 0; for(const id in sgW) sgWet += sgW[id]*sgFill(s,id);
  if(!sgIds().length) sgWet = 1;              // no generator: stopped by having no heat path, not by a level
  const feff = driven * wet * enth * sgWet;   // no water on either side, no removal
  /* Buoyancy flow is a heat-REMOVAL fraction, not a velocity. It gets away with
     moving very little water because that water comes back much colder, so the
     temperature rise across the core does the work the flow rate is not doing.
     A real PWR on natural circulation carries decay heat on roughly 3-5% of
     rated mass flux. DNBR does not care how much heat left the loop, only how
     fast the coolant is moving past the pin, so the boiling-crisis calculation
     is shown the flux and never the removal. Above the pump floor the two are
     identical, so nothing about a running plant changes. */
  /* How much of the primary is still liquid. Water is the only thing in the loop
     that carries heat or washes a fuel pin, so an empty vessel does neither, no
     matter how hard the pumps are told to turn. Full down to 70% inventory,
     then straight to nothing by 10%: a partly drained loop still circulates
     what is left. At rest this is exactly 1, so a plant that is not leaking
     never feels it. */
  /* DNBR does not care how much heat left the loop, only how fast the water
     is moving past the pin - so the boiling-crisis calculation is shown the
     flux and never the removal, and never the enthalpy gain that separates
     them. */
  const mflux = driven * wet;

  /* ── heat balance ── */
  /* With the runback bypassed the turbine keeps its load through a trip, so the
     temperature programme has to keep following that load: the loop is still
     being drained of heat by a machine that should have shed it. */
  const Tprog = tProg(s);
  const feedOK = !s.dmgParts.includes("feed");
  /* A secondary reserve that is armed adds a small dump while the reactor is
     scrammed, which is what runs the loop a few degrees cooler after a trip.
     It asks the TANKS, not a system row - and reads identically on a stock
     plant, where exactly one tank carries a rule. */
  const dump = s.scrammed ? clamp((s.Tavg-Tprog)*0.02,0,P.bypass)*(feedOK?1:.25)+(tankRuleAny(s,"secondary")?0.08:0) : 0;
  const vNow = clamp(s.vf,0,1.5);
  /* The void term is steam mixed INTO the water and bottoms out at 15%, because
     a bubbly loop still carries heat. Inventory is the other question entirely -
     whether there is any water left to be bubbly - and it has no floor. Without
     this an uncovered core removes 15% of rated heat against 2% of decay heat,
     and cools down while sitting in dry steam. */
  const removal = (s.load+dump)*feff*(1-0.85*Math.min(vNow,1));
  s.dTavg = (heat-removal)*1.8/P.graceK;               // K/s, for the rod controller's lead term
  s.Tavg = clamp(s.Tavg + s.dTavg*dt, 500, 1000);

  /* ── pressure: hot loop pressurises, relief valve lifts, vessel can burst ──
     The pressurizer only sets pressure while the loop is a closed boundary. Once
     the vessel is open the steam bubble is gone, so everything the pressurizer and
     its relief valve do stops mattering: the loop flashes down to containment and
     nothing on the panel can hold it up. */
  /* vented mass leaving through a relief valve, in %/s of loop inventory -
     declared here, outside the !s.breach block below, so the blowdown term
     after it (still zero-vented while breached, since nothing opens a
     relief valve's own gate there) can read it either way. */
  let vented = 0;
  if(!s.breach){
    const Pdem = P.P0 + (s.Tavg-P.Tref)*(0.17/P.pzrK)*(P.P0/15.5)*P.pRise + (inj>0?0.5*P.pRise:0);
    s.P += (Pdem-s.P)*(0.30/P.pzrK)*pzrAuth*dt;
    /* Every relief path rolls its own die, on its own lift - three redundant
       valves are three independent chances to stick, not one. Each fitting
       is otherwise the identical machine the single PORV always was: an
       auto-lift at 106%, a reseat below 101%, and a commanded stick
       (s.reliefArm[fid]) that beats the die and is CONSUMED by the lift it
       arms, or one scenario line would make that one valve permanently
       faulty.
       VENTED MASS IS THE SOLVED EDGE FLOW now - netOut.reliefBy[fid], off
       the identical netFlowK() solve this tick already ran, through the
       same invRate() a break or an injection line is charged through. No
       second, hand-rolled vent physics beside the network any more, and no
       separate back-pressure correction - a filling tank throttles the vent
       by its own fixed-node pressure alone, because that pressure is one of
       the two potentials the Laplacian was solved against. A fitting whose
       branch reaches a TANK (net.fitTarget, pipenet.js) fills that tank; one
       with nowhere else to vent - no header, no tank on the grid, routed to
       containment instead (pipenet.js's own fallback) - raises s.release
       straight, at the same primary-into-containment scale an SGTR leak
       already uses: what has left the loop is loose in the compartment's
       air, not behind a wall the tank would have been. */
    let ventLoose = 0;
    for(const fid of reliefFitIds()){
      const set=reliefSet(fid);
      if(!s.reliefOpen[fid] && porvLive(fid) && s.P > P.P0*set.lift){
        s.reliefOpen[fid]=true; s.reliefAuto[fid]=true;
        s.reliefStuck[fid] = s.reliefArm[fid] || roll(s,"porvStick");
        s.reliefArm[fid]=false;
      }
      if(s.reliefOpen[fid] && s.reliefAuto[fid] && !s.reliefStuck[fid] && s.P < P.P0*set.reseat){
        s.reliefOpen[fid]=false; s.reliefAuto[fid]=false;
      }
      if(!s.reliefOpen[fid] || s.reliefBlocked[fid]) continue;
      const rate = Math.max(0, invRate((netOut.reliefBy && netOut.reliefBy[fid]) || 0));
      const q = rate*dt;
      vented += q;
      /* A fitting that reaches a TANK fills nothing HERE: that tank's own
         node carries the identical current, and the level loop below charges
         it off the solve (qTankBy). Adding it a second time here would
         double it, and would miss any vent path that is not a relief
         fitting. net.fitTarget survives for exactly one question - is there
         a tank to catch this at all, or is it going straight into the room. */
      if(!(P.net.fitTarget && P.net.fitTarget[fid])){
        s.release = Math.min(100, s.release + (rate/SGTR_RATE)*0.02*P.dose*dt);
        /* ONLY the vent that reaches no tank is charged to inventory here.
           What a valve puts INTO a tank leaves the loop through that tank's
           own node, which the per-tank loop below already integrates off the
           same solve - subtracting it twice would drain the loop at double
           the rate the network actually found. `vented` stays the TOTAL,
           because the pressurizer's blowdown is about every hole alike. */
        ventLoose += q;
      }
    }
    s.inv -= ventLoose;
  }
  /* THE RUPTURE DISC, on any tank fitted with one. At TMI-2 it burst and put
     primary coolant on the containment floor, and this game already teaches
     TMI-2 and already makes a full tank of contaminated water a radiation
     source - the one piece missing was the pressure that connects them. Past
     its own setpoint the tank is an opening to containment: it drains onto
     the floor and what was contained is now in s.release. Latched, because a
     burst disc does not reseat.
     What it dumps costs release in proportion to the ACTIVITY of what was in
     it (FLUID), so a burst tank of clean water makes a mess and not an
     accident - which is the difference the old flat coefficient could not
     express, because it only ever ran on one tank. */
  for(const tid of tankIds()){
    const b = D.tanks[tid].burst;
    if(!b) continue;
    if(!s.burstBy[tid] && tankP(s,tid) >= b.at){
      s.burstBy[tid] = true;
      logE("alarm",D.tanks[tid].name+" DISC BURST",
        "The tank filled and its rupture disc let go. What was in it is on the containment floor and its activity is in the air, not behind a wall. This is the TMI-2 sequence.");
    }
    if(s.burstBy[tid] && s.tank[tid] > 0){
      const out = Math.min(s.tank[tid], b.drain*dt);
      s.tank[tid] -= out;
      s.release = Math.min(100, s.release + out*b.rel*tankFluid(tid).act*P.dose*dt);
    }
  }
  s.inv -= spill*dt;
  /* THE PRESSURIZER'S BUBBLE BLOWS DOWN AT A RATE SET BY HOW MUCH IS ACTUALLY
     LEAVING - a pinhole depressurises slowly and a guillotine violently,
     which one number could not tell apart, and a relief valve passing a
     trickle should not collapse the bubble at the same rate a severed hot
     leg does. s.P is a FIXED BOUNDARY the network is solved against, never
     an output of it, so nothing about a hole the network finds can feed
     back into this scalar on its own - MEASURED, twice: deleting this term
     outright left a breached vessel frozen at its pre-breach pressure
     forever (spillRate constant at its opening value for the full 240 s the
     auditor drives it, instead of collapsing with the hole), and left an
     armed relief valve holding pressure no lower than one bypassed and
     never lifting at all. Combined over EVERY opening - spill (a break, the
     vessel itself) and vented (a relief valve) alike - because both are the
     same fact, primary water leaving through a hole, and a plant venting
     through its relief valve alone deserves the identical physics a break
     already gets, not a second, unwritten one. Exactly zero with nothing
     open, so an intact, unvented plant is untouched. */
  if(spill+vented>0) s.P += (P.Pcont-s.P)*BLOWDOWN_K*(spill+vented)*dt;
  /* ── injection: what the tank actually pushed, against the loop it is
     fighting ── s.hpi stays the operator's on/off. What goes is the idea that
     switching it on means a RATE: a loop at full pressure takes almost
     nothing from a tank charged to 4.5 MPa, and a depressurised one takes a
     surge, which is the entire mechanic high pressure injection is named
     after. Signed, because the same edge run backwards fills the tank. */
  s.injRate = inj;
  /* EVERY PRIMARY TANK, off its OWN solved edge - not just the one an
     operator used to be able to switch on. Tank-out-positive
     (netCoreFracOf), so a tank being filled reads negative here and the same
     subtraction raises it: "the disc bursts" and "the tank runs dry" really
     are one range seen at two ends.
     What each one carries into the loop is charged to s.inv, and what its
     FLUID is worth in reactivity to the boron the loop is carrying. A tank of
     water has FLUID.boron 0, so the term is unconditional and nothing here
     asks which tank is the boron tank. Both s.boron and s.boronDem move,
     because the boron walk is an actuator and would otherwise dilute the
     poison straight back out at BOR_OUT. */
  for(const id of tankIds()){
    const t = D.tanks[id];
    if(t.side !== "primary") continue;
    const out = invRate(qTankBy[id]||0);              // % of loop inventory per second, tank-out-positive
    const dPct = out*dt;
    s.tank[id] = clamp(s.tank[id] - dPct*100/t.vol, 0, 100);
    s.inv += dPct;
    const bw = FLUID[t.fluid].boron;
    if(bw && dPct>0){ s.boron -= bw*dPct; s.boronDem -= bw*dPct; }
  }
  if(inj>0) s.fatigue += 0.35*dt*clamp(inj/1.6,0,2);
  /* ── a tube rupture, at whatever the differential says ──
     Bring the primary down to the secondary and it stops, which is the actual
     operator answer to an SGTR and was not reachable while this was a flat
     rate. Clamped at zero on the way out only for the release: water crossing
     back the other way carries no primary activity with it. */
  { const leak = Math.max(0, invRate(netOut.qSgtr||0));
    s.sgtrRate = leak;
    const sby = netOut.sgtrBy || {};
    for(const k in s.sgtrBy) if(!(k in sby)) delete s.sgtrBy[k];
    for(const k in sby) s.sgtrBy[k] = Math.max(0, invRate(sby[k]));
    s.inv -= leak*dt;
    if(leak>0) s.release = Math.min(100, s.release + (leak/0.30)*0.02*P.dose*dt); }
  const burst = P.P0*(P.burstK - 0.0028*s.fatigue);   // fatigue weakens the vessel
  /* asked at the VESSEL, not at the pressurizer: what bursts a vessel is the
     pressure inside it, and hanging the pressurizer high genuinely puts the
     core above the gauge that reports it */
  if(!s.breach && s.pCore > burst){ s.breach=true; s.trip="VESSEL RUPTURE"; }
  s.P = clamp(s.P, Math.min(P.P0*0.06,P.Pcont), P.P0*1.6);
  s.inv = clamp(s.inv,0,100);

  /* ── the core as a place: shape, hot channel, local boiling, local xenon ──
     This is where boiling actually happens now. It happens in particular
     nodes, in particular channels, and the channel that boils is the one
     that then loses the flow it needed. s.vf, s.Tf, s.X and s.I below are
     the whole-core aggregates of a field, not lumps in their own right. */
  /* the core boils at ITS OWN pressure, not at the pressurizer's */
  const sat = tsat(s.pCore), Th = s.Tavg + s.coreDT/2;
  const vLeak = Math.max(0,(95-s.inv)/25);
  const nod = coreStep(s,dt,feff,heat,sat,vLeak,mflux);
  s.voidTh = s.vNode;
  s.vf = clamp(Math.max(vLeak,s.voidTh)+0.3*Math.min(vLeak,s.voidTh),0,1.6);

  /* the LOW SUBCOOLING trip and its annunciator read the instrument's own
     location - a real plant measures pressurizer pressure, and putting the
     instrument where the instrument is is not a special case, it is the field
     being asked at a place. At rated flow this is exactly the tsat(s.P)
     minus hot-leg temperature it has always been. */
  const sc = scAt("pzrb");
  s.heat = heat; s.sc = sc;              // tripCause() reads these outside the tick
  /* What a flow meter in the loop would actually read, as opposed to what the
     pump dial was set to. They could not diverge before: nothing between the
     pump and the core could restrict it. A throttle can, and a severed run
     can, so LOW FLOW has to trip on the delivered figure or a player could
     shut every valve on the primary and the protection system would never
     notice - the pumps are still commanded to 100%. pumpK is exactly 1 on an
     undamaged plant with nothing throttled, which is why nothing re-pins. */
  s.flowNet = pumpK;
  /* ── PRESSURIZER LEVEL IS AN INTEGRAL (Stage 6c) ──
     It was clamp(54 + (Tref-Tavg)*-0.9 + vf*60 + (inv-100)*0.15, 0, 100): an
     algebraic function of three state variables, recomputed from scratch every
     tick, and s.dLvl was a finite difference OF that correlation which the
     surge animation then read as though it were a flow.

     The expansion half is a SOLVED FLOW now. expSrc() (pipenet.js) injects
     the loop's thermal expansion as a current at the core node and the network
     carries it to the pressurizer, which is its only compliance - so what this
     integrates is the surge line's own solved flow. What that buys, and no
     correlation could: shut the surge line and the gauge stops, because the
     water genuinely has nowhere to go. Sever it and the same. The correlation
     went on moving the needle through a valve nobody had opened.

     THE CALIBRATION IS DELIBERATELY UNCHANGED. LVL_K is the loop-volume-to-
     pressurizer-volume ratio the old correlation implies: at a steady heating
     rate the whole source arrives up the surge line, so LVL_K*100*BETA_W must
     equal the 0.9 %/K the correlation carried. Real plants are nearer 7.5 than
     3.6; keeping the correlation's own figure means the gauge does not re-pin
     and what Stage 6c changes is the STRUCTURE, which is what it is for.

     VOID AND INVENTORY ARE STILL CORRELATIONS, and this is honest rather than
     hidden: they are added here as explicit RATES with the same coefficients
     they always had, differentiated rather than solved. Void needs a steam
     volume the incompressible solve does not have; inventory needs the break
     to draw on a compliance the pressurizer only approximates. Both are named
     in the gaps list. */
  const lvl0 = s.lvl;
  /* NEGATED: the surge edge is oriented pressurizer -> loop, so a positive
     flow on it is water leaving the pressurizer and the level falling.
     Expansion pushes the other way. MEASURED at +0.1 K/s: netExpSurge returns
     -0.025 %/s of loop inventory, which is exactly 100*BETA_W*dTavg - the
     whole source arrives up the surge line, as it must when the pressurizer
     is the network's only compliance - and -LVL_K times that is +0.09 %/s,
     exactly the 0.9 %/K the correlation carried. */
  const dExp = -LVL_K*invRate(netExpSurge(P.net, s));       // %/s, SOLVED
  const dVoid = (s.vf - s.vf0)*60/Math.max(dt,1e-9);        // %/s, still a correlation
  const dInv = (s.inv - s.inv0)*0.15/Math.max(dt,1e-9);     // %/s, still a correlation
  s.vf0 = s.vf; s.inv0 = s.inv;
  s.lvl = clamp(lvl0 + (dExp + dVoid + dInv)*dt, 0, 100);
  /* Void can only push water up the surge line while there is a loop to push it
     into. Once the vessel is open the pressurizer drains into the break, and that
     overrides the void term that would otherwise peg this gauge full. */
  if(s.breach) s.lvl = Math.max(0, lvl0 - 14*dt);   // from last tick, or it never drains
  s.dLvl = dt>0 ? (s.lvl-lvl0)/dt : 0;   // %/s - a solved surge flow now, not a difference of a formula
  /* ── the secondary mass balance ──
     Steam raised is the heat that actually left the primary, over the latent
     heat: kg/s out. Feedwater is what the condensate system puts back, and a
     healthy one both matches the steam and walks the level back to setpoint,
     so an undamaged plant sits at SGL_SET and every figure pinned against a
     healthy plant is untouched. A hit feed pump delivers a quarter of the
     steam rate and the difference is what boils the generator dry.

     EFW is a separate source, not a multiplier on the main one: it is a
     different pump drawing on a different tank, and it works when the main
     feed does not. That is the whole reason it is on the board. It starts on
     LOW LEVEL, which is the real actuation signal - armed is not running, and
     an emergency pump that feeds a healthy generator would simply overfill
     it (measured: the once-through unit went to 82 % at rest).

     Per generator, off sgW - the same flow-weighted share removal itself was
     taken with, so what boils out of each machine is what crossed into it.
     REFILLED, never rebuilt, the same rule s.spillBy and s.sgtrBy carry: a
     renderer holds this object across frames, so a fresh one each tick would
     leave the mimic drawing a generator that is no longer on the plant. */
  const M = sgMass(), ids = sgIds();
  for(const id in s.sglBy) if(!sgW.hasOwnProperty(id)) delete s.sglBy[id];
  /* ── WHERE FEEDWATER COMES FROM ──
     Two pools, told apart by a RULE and never by a name. A tank whose valve
     stands open all the time IS the circuit - condensate comes back to it and
     the feed pumps draw on it. A tank that has to be opened is a RESERVE, and
     its own AUTORULE decides when: EFW starts on low generator level, not on
     being armed, because an emergency pump feeding a healthy generator
     overfills it - measured at 82 % on a once-through unit before the gate
     went in. Give a second tank the same rule and both feed; give the reserve
     "always" and it simply joins the circuit. */
  const circ = [], res = [];
  for(const id of secTankIds())
    (D.tanks[id].auto === "always" ? circ : res).push(id);
  const poolKg = list => tankPoolKg(s,list);
  const poolPct = list => tankPoolPct(s,list);
  /* A pump does not run cleanly to the last drop, and it cannot send on water
     that is not there. Two limits, and both are ceilings rather than terms:
     HOT_NPSH tapers delivery over the last stretch, and the pool mass is the
     hard one, shared between the generators drawing on it. Neither binds on a
     healthy plant (the taper is 1 above HOT_NPSH), which is why the setpoint
     still holds exactly. This is the SECOND way to lose feedwater; the first
     is the pump itself. */
  const circPct = poolPct(circ), circAvail = poolKg(circ);
  const suction = clamp(circPct/HOT_NPSH,0,1);
  /* A reserve is open only if its own rule says so, and only if that rule has
     not been bypassed on that tank - tankOpen() asks both. */
  const resOpen = res.filter(id=>tankOpen(s,id));
  const resAvail = poolKg(resOpen);
  let boiled = 0, fedCirc = 0, fedRes = 0;       // kg/s, summed for the mass balance below
  if(M > 0) for(const id of ids){
    if(s.sglBy[id]===undefined) s.sglBy[id]=SGL_SET;                 // a generator placed mid-run starts full
    const lvl = s.sglBy[id];
    const steamOut = removal*sgW[id]*P.rated*1000/H_FG;              // kg/s into THIS generator
    /* ONE feed controller. Both pools answer to it - an emergency feed pump is
       a feed pump - so what a reserve delivers is what THIS generator is
       short, drawn against what is actually left in the reserve, rather than
       a flat fraction of rated steam that scaled with a number the tank has
       never had anything to do with. */
    const want = Math.max(0, steamOut + (SGL_SET-lvl)/100*M/FEED_TAU);
    const share = Math.max(dt,1e-9)*Math.max(ids.length,1);
    const fromCirc = Math.min(circAvail/share, suction*(feedOK?1:FEED_HURT)*want);
    const fromRes  = Math.min(resAvail/share, Math.max(0, want - fromCirc));
    s.sglBy[id] = clamp(lvl + 100*(fromCirc+fromRes-steamOut)/M*dt, 0, 100);
    boiled += steamOut; fedCirc += fromCirc; fedRes += fromRes;
  }
  /* ── the secondary as ONE closed system ──
     Steam raised leaves a generator, turns the turbine, condenses, and
     arrives back in the circuit; feedwater leaves the circuit and goes back.
     In a healthy plant the two cancel exactly and the level sits still, which
     is why nothing pinned against a healthy plant moved when it landed.

     A tube rupture is where it stops being decorative: that is primary water
     crossing into the secondary, so the secondary total GROWS, and the water
     ends up here. It is the real operational problem at an SGTR. loopKg() is
     the one bridge between invRate()'s % of loop inventory and these kg.

     A RESERVE is one-way: what leaves it does not come back. */
  { const sgtrKg = Math.max(0, s.sgtrRate)/100*loopKg();
    const netKg = boiled - fedCirc + sgtrKg;
    const circCap = (()=>{ let c=0; for(const id of circ) c+=tankKg(id); return c; })();
    for(const id in s.tankOver) delete s.tankOver[id];
    for(const id of secTankIds()){
      const cap = Math.max(1, tankKg(id));
      /* The operator's own valve. It is the answer to a tube rupture filling
         the hotwell with primary water, and it never refuses: open it on a
         healthy plant and you dump the condensate the feed pumps need. */
      const dumped = s.tankDump[id] ? HOT_DUMP*Math.min(s.tank[id],100)/100 : 0;   // %/s
      /* Every tank in a pool moves together, in proportion to how much of
         that pool it is - so two hotwells behave as one hotwell of their
         combined size and neither drains first. */
      const inKg = circ.indexOf(id)>=0 ? netKg*cap/Math.max(circCap,1e-9)
                                       : -fedRes*(s.tank[id]/100*cap)/Math.max(poolKg(resOpen),1e-9);
      const raw = s.tank[id] + (100*(inKg||0)/cap - dumped)*dt;
      /* Past full it overflows, and the overflow is gone - a tank that
         silently clamped would swallow a tube rupture's whole inventory and
         report nothing. What overflows an SGTR's hotwell is contaminated. */
      if(raw > 100) s.tankOver[id] = (raw-100)/100*cap/Math.max(dt,1e-9);          // kg/s
      s.tank[id] = clamp(raw, 0, 100);
    }
  }

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
  s.dnbr=P.dnbr0*Math.pow(s.hotFlow,.6)*Math.pow(s.pCore/P.P0,.3)*Math.pow(subF,.4)
        /Math.max(.02,heat*(s.fq/2.66));

  /* ── damage ── */
  if(s.dnbr<1)     s.dmg+= (1-s.dnbr)*22*dt;
  if(s.Tf>1500)    s.dmg+= (s.Tf-1500)*0.012*dt;
  if(s.dmg>0) s.dmg=Math.min(100,s.dmg);
  if(!s.melt && s.dmg>=60){ s.melt=true; s.trip="CORE MELT"; }
  if(s.melt && !P.catcher){ s.inv-=0.35*dt; s.fatigue=Math.min(100,s.fatigue+1.6*dt); }
  if(s.dmg>0) s.release=Math.min(100,s.release+s.dmg*0.004*P.contRel*P.dose*dt);

  /* ── radiation: a live field, not a commissioning-time number ──
     Placed here rather than with the demand walks at the top of the tick:
     this is a derived READOUT, not an actuator, and it needs dmg, melt,
     breach, release, sgtr, n and decay all settled for THIS tick - which the
     block above just finished doing - so the event log and the annunciator
     tile below see the same accident this integrator does.
     THE FIELD ITSELF IS NEVER STORED. See the header comment in record.js:
     a snapshot of the plant is a clone of S and nothing else, and a
     Float64Array parked in a module global would not survive a restore -
     the futures would diverge and the auditor would have no field to name.
     So it is solved fresh every tick from radGeom() (memoised on the
     arrangement, via P.radK) and radSrc(s) (read live off the plant this
     instant), and only the handful of scalars this tick actually needs come
     off it before it is thrown away. Nothing here can drift out of step
     with a snapshot, because nothing here IS a snapshot. */
  { const f=radSolve(P.radK,radSrc(s));
    s.doseRate = radAt(f,P.radK.crew);
    s.crewDose = Math.min(100, s.crewDose + s.doseRate*RAD_CREW_K*dt);
    /* radParty() wants the coldest free cell next to the JOB, not the job's
       own footprint - a party works from behind whatever shielding is
       actually there. No party out, no rate: repRate is a readout of where
       someone is standing, and nobody is standing anywhere. */
    s.repRate  = s.repair ? repairRadRate(f, s.repair.id) : 0; }

  /* ── reactor protection system: trips unless it was never fitted, or is defeated ── */
  if(!s.scrammed && rpsLive()){
    const why=tripCause();
    if(why){ s.scrammed=true; s.rodDem=1; s.trip="RPS TRIP / "+why;
             runback(s); }
  }

  /* ── event log: every transition, with why ── */
  const E=s.ev, ev=(k,cond,sev,msg,why,latch)=>{
    /* `why` may be a thunk: several of these build their text with toFixed(),
       and a log line nobody is reading is not worth a string a tick. */
    if(cond && !E[k]){ E[k]=true; logE(sev,msg,typeof why==="function"?why():why); }
    else if(!cond && !latch) E[k]=false; };
  ev("hipow",s.n>1.10,"warn","POWER ABOVE 110%",
    "Running past rated output. Thermal margin is what pays for it, and DNBR is falling.");
  ev("dnbr13",s.dnbr<1.30,"warn","DNBR BELOW 1.30",
    "Coolant is approaching film boiling on the fuel pins. Raise pump flow or pressure, or cut power.");
  ev("dnbr10",s.dnbr<1.00,"alarm","DNBR BELOW 1.00 / CLADDING FAILING",
    "The fuel is now wrapped in insulating steam. Heat is not reaching the water and damage is accumulating this second.");
  /* THE CAUSE IS RAISED BEFORE ITS CONSEQUENCE. These fire in list order within
     one tick, and a manual scram sets s.scrammed and starts the bank moving in
     the same tick - so with recrit first the log read "TRIPPED CORE GOING
     CRITICAL" and only then "REACTOR TRIP", which is the story backwards. */
  ev("scram",s.scrammed,"alarm","REACTOR TRIP / "+(s.trip||"SCRAM"),
    "Rods fully inserted and the turbine tripped with them. Xenon now builds and will hold the reactor down for minutes.");
  /* ...and the rods have to actually BE in. The message says "the bank is in",
     and for the seconds the drives are still walking after a trip they are not:
     rho has not had time to go anywhere yet, so without this the alarm fires on
     every scram, latches, and is spent before the real re-criticality arrives. */
  ev("recrit",s.scrammed&&s.rodPos>.98&&s.rho>-200,"alarm","TRIPPED CORE GOING CRITICAL",
    ()=>"The bank is in and the reactor is climbing back to critical anyway. The xenon it was shut down by has decayed, and the bank alone is worth "+P.sdm.toFixed(0)+" pcm against it. Borate now - the boron system is worth "+P.sdmB.toFixed(0)+" pcm of margin.");
  ev("cav",s.cav>0.15,"warn","COOLANT PUMP CAVITATION",
    "Water arriving at the pumps is close to boiling, so they are churning vapour. Real flow is far below the bench setting.");
  ev("flowfloor",s.flowDem<P.flowMin,"warn","PUMPS ORDERED BELOW DESIGN FLOOR",
    ()=>"Flow demand is under the "+(P.flowMin*100).toFixed(0)+"% floor the pumps were built for. The protection system trips on LOW FLOW here. Defeat it and the core keeps running on buoyancy alone.");
  ev("hip",s.P>P.P0*1.05,"warn","PRIMARY OVERPRESSURE",
    ()=>"Loop pressure above 105% of nominal. The relief valve lifts at 106%, and the vessel bursts near "+burst.toFixed(1)+" MPa.");
  ev("porv",reliefAnyOpen(s),"warn","RELIEF VALVE PASSING",
    "A relief valve is open and venting to the tank. If nobody commanded it, primary coolant is leaving the loop.");
  ev("stuck",reliefAnyStuck(s),"alarm","PORV FAILED TO RESEAT",
    "It lifted on overpressure and did not shut again. Pressurizer level will read HIGH while the loop empties. Close the block valve.");
  ev("void",s.vf>0.15,"alarm","STEAM VOID IN CORE",
    "Steam is forming where liquid should be. It carries almost no heat, so fuel temperature climbs even while reactor power falls.");
  /* Not latched: the live field falls back below RAD_HI the moment the source
     that raised it does (a release stops, a repair closes off a jam), and an
     operator watching this number needs to see it fall, the same way COOLANT
     PUMP CAVITATION or PRIMARY OVERPRESSURE clear themselves above. */
  ev("hirad",s.doseRate>RAD_HI,"warn","HIGH RADIATION IN THE SPACE",
    ()=>"The crew's own seat is reading "+s.doseRate.toFixed(2)+"x background. A party out on the plant right now is taking "+(s.repRate*RAD_DOSE_K).toFixed(3)+" dose a second at the job it is standing next to.");
  ev("pit",-s.parts.xe>3200,"info","XENON PIT",
    "Xenon-135 past 3200 pcm. Raising power may be physically impossible until it decays, whatever you do with the rods.");
  ev("jam",s.rodJam,"alarm","CONTROL RODS NOT RESPONDING",
    "The bank is ignoring demand, a scram included. You are left with boron, flow and load.");
  for(const [k,evk,title] of AUTOEV)
    ev(evk, autoFit(k)&&s.byp[k], "warn", title, AUTOSYS[k].warn);
  ev("norps",!P.rps,"warn","NO PROTECTION SYSTEM FITTED",
    "This plant was commissioned without one. There are no automatic trips to defeat, and none to fall back on. Every scram is yours to call.",true);
  ev("inj",s.injRate>0,"info","INJECTING",
    "A tank is pushing water into the loop, and cold shock is ageing the vessel while it runs.");
  ev("d1",s.dmg>1,"alarm","FUEL DAMAGE 1%",
    "Cladding has started to fail and fission products are entering the coolant. Permanent.",1);
  ev("d25",s.dmg>25,"alarm","FUEL DAMAGE 25%",
    "A quarter of the fuel cladding has failed.",1);
  /* Latched like the fuel-damage and fatigue milestones above it: the watch
     does not get its dose back by the number dipping under 50% again, so the
     debrief should not either. */
  ev("crew50",s.crewDose>50,"alarm","WATCH DOSE PAST 50%",
    "The control-room watch has taken more than half its dose limit for this run. Nobody relieves them - that number only goes one way from here.",1);
  ev("fat50",s.fatigue>50,"warn","VESSEL FATIGUE PAST 50%",
    ()=>"Thermal shock has embrittled the vessel. Its burst pressure is now "+burst.toFixed(1)+" MPa instead of "+(P.P0*P.burstK).toFixed(1)+".",1);
  ev("brk",s.breach,"alarm","VESSEL RUPTURE",
    ()=>"The pressure vessel failed at "+s.P.toFixed(1)+" MPa. Coolant is leaving faster than anything can replace it. Unrecoverable.",1);
  ev("melt",s.melt,"alarm","CORE MELT",
    "Over 60% of the fuel has failed and the core is melting. Unrecoverable.",1);

  if(s.repair){
    /* Advanced by radWorkK(s.repRate)*dt, never plain dt: a hot field does not
       turn the party back (pillar 4 - no order is refused on the grounds it
       is a bad idea), it slows them down, because they are working short
       shifts from behind whatever cover the layout gives them. s.repair.need
       stays exactly what repairNeed() sold at dispatch - the slowdown lives
       entirely in how fast t catches up to it, so the panel's own estimate
       (need/radWorkK(rate)) and this advance can never read two different
       numbers for the same job. */
    s.repair.t += dt*radWorkK(s.repRate);
    /* The party takes the dose of the place it is STANDING IN, off s.repRate
       (computed above, off the live field), not the dose of a room on the
       other side of the plant. That is the whole feature: standing next to
       a molten core used to cost exactly what standing in the control room
       cost, because the old line charged the commissioning-time P.dose
       whatever job was running and wherever it was. */
    s.dose = Math.min(100, s.dose + s.repRate*RAD_DOSE_K*dt);
    if(s.dose>=100 && !s.partySpent){
      /* The party has taken its whole allowance for this run and is pulled
         out - permanently, the same way fuel damage and vessel fatigue above
         never heal. There is no second party, so whatever job it was on, and
         whatever else breaks later this run, is nobody's to fix again.
         repairStart() reads s.partySpent and refuses every dispatch after
         this fires, silently, the same shape as its other refusals. */
      s.partySpent=true;
      s.repair=null;
      logE("alarm","REPAIR PARTY WITHDRAWN",
        "The repair party has taken its full dose allowance for this run and is being pulled off the plant. There is no second party - whatever is still broken, on this job and any that follows, stays broken for the rest of this run.");
    } else if(s.repair.t >= s.repair.need){
      const k=s.repair.id;
      s.dmgParts = s.dmgParts.filter(q=>q!==k);
      /* the undo is the same row of DMGFX that did the damage, so a part can
         never be given an effect without also being given its reversal */
      const fix=dmgFx(k).fix; if(fix) fix(s);
      logE("info","REPAIR COMPLETE / "+k.toUpperCase(),
        "The component is back in service. It took "+s.repair.need.toFixed(0)+" seconds and cost the repair party dose.");
      s.repair=null;
    }
  }

  /* ── pipe animation ──
     s.flowPos[key] is how far the fluid in that RUN has TRAVELLED, in
     diagram pixels, counting up - keyed since Stage 3a by the run itself,
     not its kind, so a four-loop plant's four hot legs finally read four
     different numbers instead of one shared one. The renderer slides
     packets along it and differentiates it for the flow meters, so both come
     from this one integral and cannot disagree.

     Which runs the graph's OWN solved flow is honest for reads net.tag
     (pipenet.js) - the same hot-side/cold-side/neither answer buoyH() trusts
     for density, built from every run that touches a node - rather than
     re-deciding it here: a run whose own edge carries a tag is real primary
     circulation, and a cross-tie needs no case of its own, because its two
     tap nodes already inherit their tag off whichever leg they split.
     Three runs read a tag this way and are NOT real circulation, and are
     excluded by name - the one kind read this loop keeps, because nothing
     solved distinguishes "cold" from "never went through the core" yet:
     HPI and the surge line are tagged hot/cold for BUOYANCY only (a tank's
     or a pressurizer's own water); feed SHARES its discharge node with a
     cold leg (sg0b - see pipenet.js's own note on that collision) and would
     misread the leg's own tag as its own. Steam and exhaust carry no tag at
     all yet (Stage 6, nothing forces flow through the secondary) and read
     the flat design rate this file always gave them instead.

     A fitting branch is picked out the same way netBuild() names its own
     edges (STRUCTURAL - net.fitIds, never a prefix compared against r.k),
     because it alone skips the P.flowK/wet/1.4 shaping a main leg gets: a
     branch is a small, fast-equalising line and was never meant to carry
     that shaping.

     It has to stop when there is nothing left to move: an empty primary, a
     dry steam generator, a feed pump that no longer exists. Natural
     circulation is real flow and keeps moving. */
  const d=s.flowPos, sp=60*dt;
  const stm = s.load*sgWet*wet*1.6;            // no water either side, nothing boils - sgWet is the flow-weighted fill from the heat balance above
  /* the injection line reads the solve like every other run: a tank pushing
     hard against a depressurised loop visibly runs, one that has equalised
     visibly stops, and one running backwards runs backwards */
  const hpiFlow = sp*clamp(inj*1.2,-2,2);
  /* Surge line: positive is out of the pressurizer, which is the direction the
     pipe is drawn. A falling level is an outsurge; a relief valve passing flow
     pulls loop water the other way, up into the pressurizer and out of the top.
     Clamped below the hot leg's 1.24 - it is a small line and must not outrun it. */
  const surgeFlow = sp*wet*clamp(-s.dLvl*0.07-(reliefAnyOpen(s)?0.75:0),-1.2,1.2);
  const runRatio = key => P.netRefRun>0 ? (runFlow[key]||0)/P.netRefRun : 0;
  const PIPE_CORR={hpi:1,surge:1,feed:1};      // DEFAULT: tagged hot/cold for buoyancy only, not real circulation
  const PIPE_FLAT_STM={steam:1,exh:1};         // DEFAULT: no tag reaches these yet
  const xtieKeys=new Set(P.net.fitIds.map(fid=>"xtie:"+fid)); // LABEL: mirrors netBuild's own key convention for a fitting's own branch run
  for(const key in d){
    const r = P.net.byKey[key];
    if(!r) continue;                           // a design change left a stale key
    if(PIPE_CORR[r.k]){                        // DEFAULT: see the comment above
      if(r.k==="hpi") d[key]+=hpiFlow;          // DEFAULT: which correlation
      else if(r.k==="surge") d[key]+=surgeFlow; // DEFAULT: which correlation
      else d[key]+=sp*stm*(feedOK?1:0);         // DEFAULT: feed
      continue;
    }
    let tag=0;
    for(const ed of P.net.edges) if(ed.key===key) tag = tag||P.net.tag[ed.u]||P.net.tag[ed.v];
    if(tag){
      if(xtieKeys.has(key)) d[key]+=sp*runRatio(key);
      else /* the run's OWN solved flow, with no correlation floor under it -
              buoyancy is already in that solve, so a plant on natural
              circulation still visibly moves water and a plant with the
              valve shut visibly does not */
           d[key]+=sp*P.flowK*runRatio(key)*wet*1.4;
    } else if(PIPE_FLAT_STM[r.k]){             // DEFAULT: see the comment above
      d[key]+=sp*stm;
    }
  }
  s.spin=(s.spin+360*dt*feff)%360;
  /* the turbine's own shaft angle. It is on S beside the pump's for the same
     reason the pump's is: an angle integrated in the renderer would keep
     turning while the sim is paused, and would not replay. Driven by LOAD -
     the pumps answer flow, the turbine answers the draw. */
  s.spinT=(s.spinT+360*dt*Math.min(s.load,1.5))%360;
}
/* One pressure colour, for every readout that shows pressure. Both thresholds are
   the annunciator's own, so a gauge can never disagree with the alarm beside it:
   amber is LO PRESS, red is HI PRESS, and red is also where the relief valve is
   about to lift and the vessel starts counting down to burst. */
const pColor = v => v > P.P0*1.05 ? C.red : v < P.P0*0.935 ? C.amber : C.cyan;
const ANN=[
 ["HI FLUX","red",s=>s.n>1.12,
  "The reactor is making more than 112% of its rated power. You are outside the design envelope and the fuel is being pushed harder than it was built for. Reduce load or insert rods.","core"],
 ["LO DNBR","red",s=>s.dnbr<1.30,
  "Departure from Nucleate Boiling Ratio has fallen below 1.30. The cooling water is close to boiling into a continuous film on the fuel rods, which would stop heat transfer almost instantly. Raise pump flow, raise pressure, or cut power. Note that flow means PUMP flow: buoyancy circulation removes heat but barely moves the water, so it buys almost no DNBR.","core"],
 ["FUEL DMG","red",s=>s.dmg>0.1,
  "Fuel cladding has failed somewhere in the core. This is permanent, it puts radioactive fission products into the coolant, and it only gets worse. Nothing you do now un-breaks it.","core"],
 ["LO PRESS","amber",s=>s.P<P.P0*.935,
  "Primary loop pressure has dropped below 93% of normal. Either you are leaking coolant, or the pressurizer sprays are overcooling the steam bubble. Pressure is what stops the loop boiling, so this matters.","pzr"],
 ["HI PZR LVL","amber",s=>s.lvl>78,
  "Pressurizer water level above 78%. Either the loop genuinely has too much water in it, or steam forming in the core is pushing water up into the pressurizer while the loop actually empties. Check subcooling to tell which.","pzr"],
 ["LO SUBCOOL","red",s=>s.sc<8,
  "Less than 8 degrees of margin before the coolant boils. This is the alarm that does not lie about inventory. If this is lit and pressurizer level looks fine, believe this one.","pzr"],
 ["TAVG DEV","amber",s=>Math.abs(s.Tavg-tProg(s))>4,
  "Average coolant temperature is more than 4 K away from where it should be for the current load. The reactor and the turbine are not in balance: one is making more heat than the other is taking.","rods"],
 ["XENON PIT","blue",s=>-s.parts.xe>3200,
  "Xenon-135 has built up past 3200 pcm of negative reactivity. This poison eats neutrons, and until it decays you may physically be unable to restart or raise power no matter how far you pull the rods.","core"],
 ["RECRITICAL","red",s=>s.scrammed&&s.rho>-200,
  "A tripped core is on its way back to critical with the bank fully inserted. Xenon shut this reactor down as much as the rods did, and xenon decays. Nothing but boron will hold it now, and if it gets there before you do it will come back to power against a turbine that is not taking any.","core"],
 ["ROD JAM","amber",s=>s.rodJam,
  "The control rods are not moving when commanded. Your fast reactivity handle is gone. You now control the reactor only with boron, coolant temperature and load.","rods"],
 ["PORV OPEN","red",s=>reliefAnyOpen(s),
  "The pressure relief valve on top of the pressurizer is passing flow. If you did not command it open, you are dumping primary coolant overboard right now. Close the block valve.","pzr"],
 ["CORE VOID","red",s=>s.vf>0.15,
  "Steam pockets are forming inside the core where liquid water should be. Steam cannot carry heat away, so fuel temperature climbs fast even though reactor power may be falling.","core"],
 ["RX TRIP","red",s=>s.scrammed,
  "A scram has occurred and the control rods are fully inserted. The reactor is shut down. Expect a xenon buildup that will keep it shut down for the next few minutes.","rods"],
 ["HI PRESS","red",s=>s.P>P.P0*1.05,
  "Primary pressure above 105% of normal. The relief valve will lift shortly. Sustained overpressure past about 122% bursts the vessel outright, and every point of vessel fatigue lowers that threshold.","pzr"],
 ["PUMP CAVITATION","amber",s=>s.cav>0.15,
  "The water arriving at the coolant pumps is close to boiling, so the pumps are churning vapour instead of liquid. Actual flow is far below what the bench says. Raise pressure or cool the loop.","pump"],
 /* no heat guard here, unlike tripCause(): the trip refuses to fire on a shut-down
    plant, but the tile is information and the operator wants it most when the
    protection has been defeated and the flow is simply gone. */
 ["LO FLOW","amber",s=>s.flowNet<P.flowMin,
  "Coolant flow is below the design floor for the pumps fitted. With protection armed the reactor trips here. Bypassed, the fuel is cooled by buoyancy alone, and that is all the cooling there is.","pump"],
 ["NO RPS","amber",()=>!P.rps,
  "No protection system was fitted at the design bench. Nothing is watching flux, DNBR, pressure, fuel temperature, flow or void on your behalf. You are the protection system.","ctrl"],
 ["VESSEL BREACH","red",s=>s.breach,
  "The pressure vessel has ruptured. Coolant is leaving faster than anything can replace it. This is unrecoverable.","core"],
 ["BLACKOUT","amber",s=>s.blackout,
  "Main power to the coolant pumps is lost. Flow is now limited to your backup power supply plus whatever natural circulation the core geometry generates.",null],
 ["CORE MELT","red",s=>s.melt,
  "More than 60% of the fuel has failed and the core is melting. Unrecoverable. Reset the plant.","core"],
 /* appended after every existing entry so no earlier tile's index moves.
    Reads s.doseRate, the LIVE field at the crew's own seat - not P.dose,
    the as-built figure the bench quotes. What lit it is both what has
    FAILED (a release, a melt, a stuck relief valve venting past
    containment) and where the shielding was actually PLACED at the bench:
    the same layout that reads comfortable at rest can read this the moment
    the core starts shining, because nothing about the geometry changed,
    only the source term did. */
 ["HI AREA RAD","amber",s=>s.doseRate>RAD_HI,
  "The control room is reading above 1x background. That number is set both by what has failed on the plant and by where you put the shielding at the bench - a well-shielded control room can sit this out through a release that would light this tile instantly on a poorly sited one. A repair party out on the plant right now is being spent while this is lit, faster the closer the job sits to whatever is shining.","ctrl"],
/* one tile per defeated automatic system, built from the same table the sim uses */
].concat(AUTOKEYS.map(k=>[AUTOSYS[k].ann,"amber",AUTOSYS[k].lit||(s=>autoFit(k)&&s.byp[k]),
  AUTOSYS[k].name+" is switched off at the panel. "+AUTOSYS[k].warn, AUTOSYS[k].part]));

/* ── one lamp per component ──
   Built from the same table the board is built from, so a tile cannot exist
   that no component owns and a lamp cannot light for something that is not on
   the board. Eight of the twenty-six belong to the reactor and six to the
   pressurizer, which is why the component carries ONE lamp and not a row of
   tiles: a 1x2 pressurizer has no room to say six things, and it does not need
   to. The lamp says "here", the board says "what".
   The id is matched by PREFIX, so the two unindexed pump alarms light every
   pump you fitted - the sim keeps one cavitation number for the whole plant
   and it would be a lie to point at one loop. Red beats amber beats blue; a
   tile with no component at all (BLACKOUT is the only one) lights nothing. */
function annLamp(id){
  let best=null;
  for(const a of ANN){
    if(!a[4] || !id.startsWith(a[4]) || !a[2](S)) continue;
    if(a[1]==="red") return C.red;
    if(a[1]==="amber") best=C.amber;
    else if(!best) best=C.blue;
  }
  return best;
}
