"use strict";
/* point kinetics, thermal, pressure, void, RPS */

/* ═══════════════ SIM ═══════════════ */
let P=null,S=null;
function commission(){
  /* K is the XENON CLOCK: a deliberate 400x time compression, so a scram costs
     ~3 min of lockout rather than ~20 h. Game balance, and the central mechanic. */
  const d=derived(),a=d.a,f=d.f,B=d.beta*1e-5,K=400,L=layoutMetrics();
  P={BETA:B,bet:[.033,.219,.196,.395,.115,.042].map(x=>x*B),
     lam:[.0124,.0305,.111,.301,1.14,3.01],LAM:d.Lam,
     aF:a.aF, aM:d.aM, aV:d.aV, P0:d.P0, tsat0:a.tsat*Math.pow(D.pdes,.25),
     rated:D.power, dnbr0:d.dnbr, dnbLaw:a.dnbLaw, Fq0:d.Fq, xeW:d.xeW, scram:d.scram,
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
     flowK:L.flowK, dose:L.dose, radK:L.radK, bypass:.20+.60*condSizeMean(),
     rps:D.rps, rpsm:D.rpsm, autorod:D.autorod, arLo:D.arLo, arHi:D.arHi,
     catcher:LAY.parts.some(p=>p.role==="catcher"), contRel:D.contFit?CONT[D.cont].rel:1, backup:BKP[D.bkp].bk,
     fittings:JSON.parse(JSON.stringify(D.fittings)),
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
  P.sat   = {p0:P.P0, T0:P.tsat0, n:coolSatN(a), pFloor:.05};
  P.hfg   = a.hfg;                                     // THIS coolant's latent heat, kJ/kg
  /* A PLANT MAY COMMISSION SATURATED. The ceiling used to be tsat0-35, a hard
     35 K of subcooling with no derivation, and it is why no reactor here could
     be a BWR: the COOLANT row already says Tref 559 against tsat 559 and this
     line overruled it. Saturation itself is the ceiling now - past it the
     programme is superheat, which this model has no enthalpy for. */
  P.Tref  = Math.min(a.Tref, P.tsat0);
  /* Numerical headroom, never behaviour: a clamp a healthy plant can reach is
     a modelling decision wearing a guard's clothes, and the old flat 500/1000
     was water's band applied to a salt plant at 922 K. */
  P.Tmin  = P.Tref - 350;
  P.Tmax  = P.tsat0 + 400;
  /* The pipe network: netFlowK() (pipenet.js) is what feeds pumpK below now,
     not a capacity-counting formula. netRef is the valves-shut (as
     commissioned), no-damage reference flow every later tick becomes a
     fraction of - see netCoreFrac0's own comment for why shut rather than
     open. It is >0 by construction (a fresh net always has at least one live
     pump path to ground), so a reading of 0 or worse is a bug to report, not
     a case to guard here. netRefByLoop is the same reference split per loop -
     netFlowK's own per-connected-group ceiling needs it, because the loops
     are not the same length. */
  /* Where a loop that is no longer a loop ends up. Absolute, not a fraction of
     P0: containment sits near atmospheric whatever the plant was designed for.
     AHEAD OF THE NETWORK, and it has to be: netCoreFrac0() below solves the
     plant, and every containment node is FIXED at this value. It used to sit
     forty lines further down and get away with it, because the only edges
     reaching containment were break edges and a break edge is g exactly 0 in
     the reference - netAssemble skips it, so an undefined pressure never
     entered the matrix. A relief valve venting to the room has a LIVE stub
     edge to that same anchor, so it does, and the whole reference solve came
     back NaN: netRef 0, and every figure derived from it with it. */
  P.Pcont = 0.15;
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
     other, which is the whole reason a run has its own integral.

     A RUN THAT CARRIES NOTHING IS NOT IN THE MEAN. A dead-end leg - a spare
     steam generator plumbed to the core with no return path, which is what a
     half-finished second loop looks like - is a hot leg by kind and by role,
     so it counted, and it contributed a zero. Measured: it pulled the shared
     scale 4.5982 -> 3.7193, and since every packet's speed is ref/netRefRun,
     the whole plant's flow animation sped up 24% the moment a pipe that moves
     no water was drawn. Nothing about the actual flow had changed.

     The gate is a NUMERICAL NOISE FLOOR, not a physical threshold: a genuine
     dead end solves to ~1e-15 against a live leg's ~5, so there are fifteen
     orders of magnitude between the two cases and nothing to tune. Relative
     to the largest reference on this plant, so it cannot become a hidden
     absolute scale. A plant whose legs all carry flow keeps every one of
     them, which is why no stock figure moves. */
  /* MAGNITUDES. P.netRefByRun is signed (see netCoreFracOf) and a scale has no
     direction - a leg carrying the reference flow the other way round is still
     carrying it. */
  { let big=0;
    for(const k in P.netRefByRun)
      if(k.startsWith("hot:")||k.startsWith("cold:")) big=Math.max(big,Math.abs(P.netRefByRun[k]));
    let sum=0, n=0;
    for(const k in P.netRefByRun)
      if((k.startsWith("hot:")||k.startsWith("cold:")) && Math.abs(P.netRefByRun[k]) > 1e-9*big){
        sum+=Math.abs(P.netRefByRun[k]); n++; }
    P.netRefRun = n ? sum/n : 0; }
  /* xenon burnout, sigma*phi at rated flux, in units of the decay constant. */
  P.sig=3.0*P.lamX; P.XEQ=(P.gI+P.gX)/(P.lamX+P.sig); P.KXE=P.xeW/P.XEQ;
  P.pRise = a.P0>3 ? 1.0 : 0.25;
  P.burstK = a.P0>3 ? 1.22 : 4.0;
  P.feff0 = P.flowK;                                   // the share of rated flow this pipe run can carry
  P.n0    = Math.min(1, P.feff0);                      // power at which removal balances heat
  /* ── THE TWO SIZING FIGURES OF THE STEAM SIDE, FITTED AT ONE ANCHOR ──
     The plant at rest is the anchor and both figures are read off it, so
     nothing pinned against a plant at rest moves.

     P.sgUA is what ONE generator's tubes are worth, in kW/K, at rated flow
     against the shell temperature the design shell pressure implies. Read off
     today's removal, which is what makes the at-rest heat balance identical to
     the demand-driven one it replaces.

     P.swallow is what the turbine passes wide open at design shell pressure,
     in kg/s. The machine is sized for the plant it was bought for, so this is
     what the plant can actually raise - not the nameplate. Without it the
     governor would demand rated steam from a loop that can only carry 82 % of
     it, and the shell would blow down on tick one.

     The temperature difference is floored: a BWR's secondary sits only a few
     kelvin below its own primary programme, and a plant designed with none at
     all would divide by zero rather than tell anyone. */
  { const n = Math.max(1, sgCount());
    const dT0 = Math.max(5, P.Tref - tsatSec(P.P0*0.45));
    P.sgUA = (P.n0*P.rated*1000)/(n*Math.pow(Math.max(P.flowK,.02),UA_FLOW)*dT0);
    P.swallow = P.n0*P.rated*1000/H_FG;
    /* The second stage is priced off the first and not off a second anchor:
       what an exchanger is worth is a MULTIPLE of the generator behind it, so a
       plant that buys one keeps the same rest point and pays for the extra
       stage in shell temperature. Per generator, like P.sgUA - the tick
       multiplies by how many that exchanger actually feeds. */
    P.ihxUA = P.sgUA*IHX_UA; }
  /* ── AND THE SAME ANCHOR FOR THE OTHER TWO MACHINES ──
     P.hTurb makes the enthalpy drop across design shell pressure to design
     condenser pressure exactly H_FG, so a turbine at its design point does the
     work P.eff always priced and only backpressure can move it.
     P.condUA is what the condenser you BOUGHT is worth: a unit sized at rated
     duty rejects rated duty at the design terminal difference, so the stock
     plant sits on COND_P0 with margin in hand and an undersized one does not. */
  P.hTurb   = H_FG/Math.max(.05, 1-Math.pow(COND_P0/(P.P0*0.45),TURB_GAM));
  P.condUA  = P.rated*1000*(1-P.eff)/Math.max(5, tsatSec(COND_P0)-T_CW)*P.condCap;
  P.tdmg  = f.tdmg; P.tmelt = f.tmelt;
  /* whether this fluid puts a steam atmosphere on hot clad at all - sodium,
     salt and helium never oxidise a rod, so their whole oxidation path is one
     false here rather than a temperature that happens never to be reached */
  P.oxid  = !!a.oxid;
  P.TfRef = P.Tref + a.dTf*P.condK*P.n0/Math.max(P.feff0,.10);
  P.X0    = (P.gI+P.gX)*P.n0/(P.lamX+P.sig*P.n0);      // xenon equilibrium at that power
  coreConst(P,d);                        // the core as a place: mesh, coupling, rods
  /* the zirconium in the core, kg, MEASURED off the drawing: the rod surface
     coreConst() just computed times the wall thickness that was drawn. Same
     currency the ECR is in, so hydrogen against oxide thickness against
     consumed metal is one identity rather than three estimates. */
  P.cladKg = ZR_RHO*P.aHeat*ROD_CLAD;
  P.dsig = designSig();                 // what this plant was built from
  resetPlant();
  /* What THIS plant is subcooled by when nobody has touched it. The vital bar
     scales against it, because subcooling at rest is 22 K on a PWR and 1400 K
     on an HTGR - a fixed scale would peg four of the six architectures full and
     say nothing. P.dnbr0 is the same idea and was already here. */
  P.sc0 = S.sc;
  /* and what it VOIDS by at rest, for the same reason. Subcooled boiling means
     rest void need not be zero, so the CORE VOID trip cannot go on reading a
     typed 0.30 against a solved quantity - it is the one row of RPS_CH left
     that had no reference of its own. */
  P.vf0 = S.vf;
  /* and what W-3 has to be worth for this plant to read the margin its coolant
     row sells at the condition it COMMISSIONS in - see dnbrOf(). All five of
     W-3's inputs come off one real step, because the hot node's quality is
     walked inside coreStep() and cannot be had from outside it; the step is
     then thrown away and the plant commissions on a fresh reset. */
  P.dnbrK = 1;
  step(0.02);
  P.dnbrK = P.dnbr0/Math.max(S.dnbr,1e-9);
  resetPlant();
  S.dnbr  = P.dnbr0;
  screen="operate"; layout();
}
/* ══════════ THE AUTOMATIC SYSTEMS ══════════
   Every system that acts on the plant without being asked, in one table.
   Fitted is a design-bench decision and cannot be undone at the panel;
   bypassed is the operator's, and the operator is allowed to be wrong - all of
   these can be switched off from the panel, including the ones that only ever
   help you. Each system is mounted on exactly one component, and that is where
   its bypass switch is drawn. */
/* WHETHER A SYSTEM WAS FITTED IS A DESIGN QUESTION, so it must be answerable
   with no commissioned plant at all - the bench draws these switches too now
   (a bypass is a STARTING POSITION, see D.start). P is the commissioned copy
   of exactly these D fields, so it is preferred when there is one and D is the
   fallback, the same standing secPTarget() has for a caller with no live S. */
const autoCfg = () => P || D;
const AUTOSYS={
  rps:{part:"ctrl",label:"RPS",ann:"RPS BYPASS",name:"PROTECTION SYSTEM",
    fit:()=>autoCfg().rps,
    tip:"Reactor Protection System. Armed, it scrams the core on high flux, low DNBR, high pressure, high fuel temp, low flow, low pressure, core void or low subcooling. Bypass it to run past rated power - and to melt the core.",
    warn:"Automatic trips are defeated. Nothing will shut this reactor down for you."},
  rod:{part:"rods",label:"AUTO ROD",ann:"ROD AUTO BYP",name:"AUTOMATIC ROD CONTROL",
    fit:()=>autoCfg().autorod,
    tip:"Walks the rods to hold average coolant temperature on programme, so it overrides the slider you just moved. It drives every bank that is on AUTO, and it may only work inside the travel band the rod drives were commissioned with - widen that band at the design bench and it has more authority and less shutdown margin. Bypass it and every bank goes exactly where you put it, and stays there.",
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
  /* THE FEED CONTROLLER. Fitted when there is a pump on the grid that reaches
     a generator's shell - asked of the drawing (secGensOf(), layout.js), so a
     plant with no feedwater path honestly reads NOT FITTED rather than
     offering a switch for a system nobody built. Mounted on the first such
     pump, because that is the box the switch belongs on.
     Bypassed, every regulating valve FREEZES where it stands; it does not
     slam open, because a valve that lost its controller is a valve nobody is
     moving. What is left is the pump's own demand, which is a real control
     the operator has (ACT.pumpDem) - so this is manual feedwater, not no
     feedwater. */
  /* part:null - no COMPONENT host, the same choice porv makes and for the same
     reason: this system is per-instance. There is one regulating valve per
     generator, so hanging the master switch on one pump's 1x1 box would put a
     plant-wide control on a machine that owns one part of it, and there is no
     room on that box for a slider, a value and a switch at once. */
  feed:{part:null,
    label:"FEED CTRL",ann:"FEED CTRL BYP",name:"FEEDWATER CONTROL",
    fit:()=>pumpIds().some(id=>secGensOf(id).length>0),
    tip:"Holds each steam generator at its own level setpoint by throttling its feed regulating valve. Bypass it and the valves stop where they are - you feed by hand, on the pump's own demand.",
    warn:"Feedwater is on manual. Every regulating valve is frozen where it stands and the generators will drift off setpoint."},
  bkp:{part:"bkp",label:"BACKUP",ann:"BACKUP PWR BYP",name:"BACKUP POWER",
    fit:()=>(P?P.backup:D.bkp)>0,
    tip:"Picks the coolant pumps up automatically in a blackout. Bypass it and the pumps stay dead: natural circulation is all the core gets.",
    warn:"The backup supply will not pick up the pumps. A blackout now leaves natural circulation only."},
};
const AUTOKEYS = Object.keys(AUTOSYS);
/* One event key and one title per system, built once. step() raises these
   thirty times a second and has no business concatenating them each time. */
const AUTOEV = AUTOKEYS.map(k=>[k, "byp_"+k, AUTOSYS[k].name+" BYPASSED"]);
const autoFit   = k => !!AUTOSYS[k].fit();
const autoLive  = k => autoFit(k) && !S.byp[k];
/* WHAT THE SWITCHBOARD IS ACTUALLY DELIVERING, as a share of normal: 1 with
   the grid up, the backup's own capacity in a blackout, 0 with no backup on
   the plant. ONE expression, because the coolant pumps and the feedwater pump
   are on the same board - the feed head reads it too (feedDrive, pipenet.js),
   and a plant whose diesels carry its coolant pumps but not its feed pumps
   was a plant where buying a bigger supply made the blackout worse. */
const supplyK = s => s.blackout ? ((!s.bkpLost && autoLive("bkp")) ? P.backup : 0) : 1;
const autoState = k => !autoFit(k) ? "NOT FITTED" : S.byp[k] ? "BYPASSED" : "ARMED";
/* which system, if any, is mounted on this component - the renderer asks this */
// AUTOSYS[k].part may be null (a system hosted on a fitting, not a component),
// so the null host must never match a component that was asked about.
/* WHICH COMPONENT HOSTS THIS SYSTEM. A row may state it (rps sits on the
   control station and always will) or ANSWER it off the drawing - the feed
   controller is mounted on whichever pump actually feeds a generator, which
   is a question only the graph can settle, and stating an id there would be
   the stored-flag mistake this codebase keeps deleting. */
const autoPart  = k => { const v=AUTOSYS[k].part; return typeof v==="function" ? v() : v; };
const autoOn    = id => AUTOKEYS.find(k=>{ const h=autoPart(k); return h!=null && h===id; }) || null;
function autoToggle(k){
  if(!autoFit(k)) return false;
  S.byp[k]=!S.byp[k];
  return true;
}
const rpsLive  = ()=> autoLive("rps");
const rpsState = ()=> autoState("rps");
/* ══════════ FITTINGS ══════════
   Placed (a box in a cell - see D.fittings, layout.js) and worked at the
   panel are two different questions, the same way a protection system is
   fitted and then armed - but a fitting is NOT in AUTOSYS, because nothing
   about it is automatic. There is no system acting on the plant behind your
   back to defeat: it is a valve, and the operator works it by demand
   (S.valveDem, walked toward at VALVE_RATE below). */
/* ── RELIEF FITTINGS: every valve rolls its own die ──
   Deleting the last relief fitting is a legal design choice (see the
   warning in derived(), design.js) - a plant can be built with nowhere for
   an overpressure to go, and the vessel bursting is then the player's own
   decision. So every reader below is written to answer "none fitted" with
   an empty list or a no-op, never a throw.
   reliefFitIds() walks P.fittings in ITS OWN insertion order (fitting ids
   are never integer-index keys, so Object.keys preserves the order they were
   placed in) - deterministic, so which fitting is "primary" never depends on
   iteration order changing under a future engine.
   primaryRelief() is what the LEGACY, single-valve controls (ACT.porvBlock,
   ACT.porvArm, the pzr mimic and its readouts) still address: their exact
   signature has no id argument (see ACT, record.js), so they can only ever
   reach the one relief fitting a plant had before redundancy existed. A
   second or third relief path is worked through the generic fitting
   controls, the same way a second throttle already is. */
// P is null on the design bench (nothing commissioned yet) - the mimic still
// draws there, so this asks D directly rather than throwing, the same
// P?fallback:D idiom pumpFloor() (plant.js) already uses.
/* NAME THE THING. "A tank is pushing water into the loop" is a sentence about
   a plant that has one tank; on a plant with four it has told you nothing, and
   the same goes for four pumps and three relief valves. One helper so every
   machine is named the same way wherever it appears, and so partName() - what
   the player RENAMED it to - is read rather than the internal id. A fitting is
   a part, so it needs no second branch. Module level, because the event log is
   not the only thing that names a machine any more. */
const nameOf = id => {
  const p = LAY.parts.find(q=>q.id===id);
  return p ? partName(p) : id.toUpperCase();
};
const nameList = ids => ids.map(nameOf).join(", ");
/* A fitting's own bore, off the commissioned copy when there is one - the same
   P?fallback:D idiom reliefSet() uses. */
const fitBore = fid => { const f=P?P.fittings:D.fittings;
  return (f && f[fid] && f[fid].bore) || FIT_DEFAULT.bore; };
const reliefFitIds = () => { const f=P?P.fittings:D.fittings;
  return Object.keys(f).filter(id=>f[id].mode==="relief"); };
/* WHICH SIDE A RELIEF VALVE IS ON, asked of the DRAWING and never stored.
   The two sides are two different machines wearing one role: a primary valve
   lifts on s.P and vents inventory through the solved network; a secondary one
   lifts on the shell it was placed against and blows steam to atmosphere,
   because the steam side has no solved hydraulics to carry it anywhere else.
   shellsOf() (layout.js) is the one predicate - a valve that reaches a shell
   on the steam side protects it, and one that reaches none is primary. */
const reliefSecIds = () => reliefFitIds().filter(id=>shellsOf(id).length>0);
const reliefPriIds = () => reliefFitIds().filter(id=>shellsOf(id).length===0);
/* and the same question from the generator's end, for the bench warning */
const reliefsOnShell = sgid => reliefFitIds().some(id=>shellsOf(id).indexOf(sgid)>=0);
const primaryRelief = () => reliefPriIds()[0];
/* WHICH PRESSURE A RELIEF VALVE IS JUDGED AGAINST, and which one it is
   actually sitting in. ONE pair, read by the tick and by the panel, because
   the rule this plant is built on is that the number a control displays is the
   number it causes - and a valve whose panel quoted primary pressure while it
   lifted on a shell would be two different machines on one box.
   A valve protecting several shells is judged on the WORST of them, which is
   what a valve on a common header actually sees. */
const reliefRefP = fid => shellsOf(fid).length ? sgDesignP() : P.P0;
const reliefAtP = (s,fid) => { const sh=shellsOf(fid);
  if(!sh.length) return s.P;
  let pk=0; for(const id of sh) pk=Math.max(pk,secP(s,id)); return pk; };
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

/* Level at which a condenser's tubes start to drown in their own condensate.
   The top-end twin of HOT_NPSH (pipenet.js), which is where a feed pump loses
   suction: one tank, two ends, and the middle of it costs nothing. */
const HOT_FLOOD=90;       // %
/* HOW MUCH HEAT SINK THERE ACTUALLY IS RIGHT NOW. P.condCap is what was
   BOUGHT. A condenser only condenses because it can drain, so a hotwell that
   has filled up drowns the tubes doing the work and takes the capacity with
   them - which is why "the turbine went on exhausting into a full condenser
   for nothing" was possible at all: the hotwell had ONE reader in the whole
   build (a red OVERFLOW label) and no physics read it anywhere.
   Off the POOL, not one tank, so two condensers are two hotwells behaving as
   one - the same tankPoolPct() every other reserve question asks. Exactly 1
   below HOT_FLOOD, so a healthy plant is bit-identical. */
const condFrac = s => { const h=hostedTankIds(); if(!h.length) return 1;
  return clamp((100 - tankPoolPct(s,h))/(100-HOT_FLOOD), 0, 1); };
/* ══ THE CONDENSER IS A HEAT EXCHANGER, NOT A PENALTY CURVE ══
   condPen() is gone, hand-picked 0.6 floor and all. Backpressure is the
   condenser's OWN saturation temperature: whatever it cannot reject raises the
   temperature of the water it rejects into, and psatSec() turns that back into
   a pressure the turbine has to exhaust against.
   An ISOLATED condenser, a FLOODED one and an OVERLOADED one are then one
   behaviour - rejection down, pressure up, enthalpy drop down, steam backs up,
   the shell pressurises - with no factor naming any of the three.
   T_CW is the cooling water it draws on. COND_P0 stays as the FLOOR: it is the
   best vacuum the plant can pull, and a condenser with margin sits on it, which
   is what keeps a healthy plant bit-identical to the constant this replaces.
   s.condT is fed forward, the same lag s.cavP and s.sgShare carry: what the
   condenser is rejecting comes out of this tick's steam balance, so it cannot
   also be an input to it. */
const T_CW=300;           // K, circulating water inlet
/* How much condenser there actually IS right now. Bought capacity, minus what
   is broken, minus tubes drowned in their own condensate, minus the
   circulating water pumps when the switchboard is dead - a blackout is the one
   way this plant had of losing them and it used to cost nothing. It may be
   exactly 0: nothing divides by it, and a wrecked condenser rejecting nothing
   at all is the answer, not a division by zero. */
const condK = s => Math.max(0, roleAlive("cond",s.dmgParts)*condFrac(s)
                              * (s.blackout?0.25:1));
/* THE CONDENSER IS A POT TOO, and for the same reason the shell is: a machine
   that cannot reject has to be able to sit there getting hotter with nothing
   flowing through it. Priced off the same q/UA balance at rest, so the steady
   answer is unchanged; what the integral buys is the transient and the dead
   end. It is fed forward one tick (s.condT is state), the same lag s.cavP and
   s.coreDT carry, and it needs no filter of its own because the thermal mass
   IS the filter. */
/* IS THE EXHAUST OPEN TO THE ROOM. A severed exhaust run (net.steamBreaks,
   pipenet.js) sits in the vacuum, so what a hole there passes is air going
   IN - the accident is the backpressure, not a vent. One predicate, because
   the work term, the readouts and the stop valve all have to agree about
   which pressure the turbine exhausts against. */
const exhOpen = s => !!(P && P.net && (P.net.steamBreaks||[]).some(bk =>
  bk.exh && bk.cells.some(([x,y])=>cellBroken(s,x,y))));
const condP = s => Math.max(exhOpen(s) ? P.Pcont : 0,
  s.condT===undefined ? COND_P0 : Math.max(COND_P0, psatSec(s.condT)));
/* What it is actually getting rid of, kW - the only place rejection is
   computed, so the readout and the balance cannot disagree. */
const condRej = s => Math.max(0, P.condUA*condK(s)*((s.condT||T_CW)-T_CW));
/* Water and metal in the condenser, kJ/K. The hotwell it drains into is the
   yardstick the plant already sizes it by. */
const condCap_ = () => hotMass()*CP_W + hotMass()*0.6*CP_STEEL;
/* THE ENTHALPY THE TURBINE ACTUALLY GETS, off the pressure ratio across it -
   the two pressures being SOLVED now rather than pinned. P.hTurb is fitted at
   the same anchor as everything else on this side: at design shell pressure
   against design condenser pressure it is exactly H_FG, so the machine you
   bought does what it always did and only backpressure moves it. */
const TURB_GAM=0.19;                 // (gamma-1)/gamma for steam
const turbDh = (ps,pc) =>
  P.hTurb*(1-Math.pow(clamp(pc/Math.max(ps,1e-4),0,1),TURB_GAM));

/* Gross electrical output. The steam that reaches the turbine is the smaller of
   what the core is making and what the governor is passing; the steam dump goes
   straight to the condenser and does no work, so it is deliberately not in here.
   One helper, because the diagram tag and both inspectors read the same number.
   What is not electricity is rejected, so mwRej is the remainder rather than a
   second efficiency figure that could drift away from the first. */
/* COUNTED, not flagged, and a SHARE rather than a name test. It used to read
   s.dmgParts.includes("turb") and P.turbFit: one turbine, present or absent,
   and a hit on it zeroed the plant. With two on the grid, losing one costs
   half the output and losing one condenser costs half the heat sink - which
   is what redundancy is FOR, and the reason it was worth paying mass for was
   invisible while a flag stood in for a count. No turbine or no condenser at
   all is still exactly 0, and still a legal design the bench warns about. */
/* turbPiped() multiplies roleAlive rather than replacing it: broken and never
   piped up are different questions, and a machine can be both. */
/* SHAFT WORK IS STEAM TIMES AN ENTHALPY DROP. roleAlive("turb"), roleAlive(
   "cond") and turbPiped() have all LEFT this expression: a broken or unpiped
   turbine passes no steam (see the swallow, below), so it makes no work by
   itself, and that is the last flag in the output path. Per generator, because
   each shell has its own pressure and so its own drop. */
const mwE   = s => { const pc=condP(s); let w=0;
  for(const id in (s.steamWk||{})) w += s.steamWk[id]*turbDh(secP(s,id),pc);
  return w*P.eff/1000; };
/* What is not work is rejected, and the condenser's own balance is what
   integrates it - so this is a readout of that number, never a second one. */
const mwRej = s => condRej(s)/1000;
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
  let p;
  if(id!==undefined && id!==null){
    /* a pipe cell is named "pipe:"+x+","+y, never a raw cell key on its own -
       so an id that names a fitting or a component can never accidentally
       resolve as a pipe, and vice versa */
    if(typeof id==="string" && id.indexOf("pipe:")===0){
      if(s.dmgParts.includes(id)) return;
      p=dmgPart(id);
      if(!p) return;
    } else {
      p=LAY.parts.find(q=>q.id===id);
      if(!p||!canHit(p)) return;
    }
  } else {
    const parts=LAY.parts.filter(canHit);
    /* ONE TARGET PER PIPE CELL. A longer run really is more exposed pipe for a
       stray round to find, and that survives BETTER than it did: a long
       connection is literally more targets rather than one fatter one. */
    const runs=pipeCellIds().filter(k=>!s.dmgParts.includes(k)).map(dmgPart).filter(Boolean);
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
/* ══ THE EIGHT PROTECTION CHANNELS, AS ONE TABLE ══
   Each row is a name, the ONE WORD a banner has room for, which way the limit
   points (+1 trips above it, -1 below), the setpoint as a function of the
   margin knob, the measurement, and an optional gate.

   A table because there are three readers now and they must not drift: the RPS
   itself, the trip reset (which refuses to clear a condition still standing),
   and tripNear(), which asks the SAME comparison a few per cent early so the
   plant can shout before the latch drops rather than after. Written as eight
   `if`s, "about to trip" would have been a second, hand-copied ladder.

   THE LOW DNBR CHANNEL READS s.dnbr AND NOTHING ELSE. s.dnbrMin is the node
   field's own answer and it is a READOUT: wiring it in here would change the
   protection system on every plant in the game in one line, and re-pin every
   figure measured against the trip at the same time. */
const RPS_NEAR=0.03;                        // how close to a setpoint counts as "about to"
const RPS_CH=[
  ["HIGH FLUX","FLUX",          +1, (P_,m)=>1.10+0.22*m,             s=>s.n],
  ["LOW DNBR","DNBR",           -1, (P_,m)=>1.18-0.16*m,             s=>s.dnbr],
  ["HIGH PRESSURE","PRESSURE",  +1, (P_,m)=>P_.P0*(1.06+0.07*m),     s=>s.P],
  ["HIGH FUEL TEMP","FUEL",     +1, (P_,m)=>P_.tdmg+100+280*m,       s=>s.Tf],
  ["LOW FLOW","FLOW",           -1, P_=>P_.flowMin*1.02,             s=>s.flowNet, s=>s.heat>0.3],
  ["LOW PRESSURE","PRESSURE",   -1, P_=>P_.P0*0.86,                  s=>s.P],
  ["CORE VOID","VOID",          +1, (P_,m)=>Math.max(.30,P_.vf0+.20)+.15*m, s=>s.vf],
  /* 3 K absolute, or 3 K below what this plant was COMMISSIONED subcooled by -
     whichever is lower. A plant designed saturated has no 3 K to lose. */
  ["LOW SUBCOOLING","SUBCOOL",  -1, P_=>Math.min(3,P_.sc0-3),        s=>s.sc],
];
/* `slack` shifts the setpoint toward the plant, so 0 is the real limit and
   RPS_NEAR is the warning band. Proportional, because every setpoint on the
   table is a positive quantity and a flat offset would mean something
   different on each one. */
function rpsHit(slack){
  const s=S, m=P.rpsm;
  for(const [name,word,dir,thr,val,gate] of RPS_CH){
    if(gate && !gate(s)) continue;
    const t=thr(P,m)*(1-dir*slack);
    if(dir>0 ? val(s)>t : val(s)<t) return {name,word};
  }
  return null;
}
function tripCause(){ const h=rpsHit(0); return h?h.name:""; }
/* The one word for a plant that has NOT tripped yet but is inside the band.
   Null once it actually trips - at that point the latch owns the picture. */
function tripNear(){
  if(S.scrammed || rpsHit(0)) return null;
  const h=rpsHit(RPS_NEAR);
  return h?h.word:null;
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
   bench carries its own pair in D.fittings (layout.js); an older design,
   or any fitting never dialled, carries null and gets the defaults above. The
   fallback is written HERE and nowhere else, or the tick, the plant view and
   the auditor would each grow their own idea of what an unset field means.
   P is null on the bench, the same P?fallback:D idiom reliefFitIds() uses. */
function reliefSet(fid){
  const f=P?P.fittings:D.fittings, j=(f&&f[fid])||{};
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
/* ── the secondary mass balance (Stage 6a) ──
   s.sgl used to be clamp(50+(heat-s.load)*40-(s.load-1)*14,0,100), recomputed
   from scratch every tick with no memory, so it could not run out however long
   the feed was gone. It is an INTEGRAL now: steam raised out, feedwater in.

   Steam raised is heat removed over the latent heat, which is the only new
   physics here - the tick already computes `removal`, so this is a mass
   balance and not a second solve. */
const H_FG=1510;          // kJ/kg, feedwater to saturated steam at the secondary's ~6.9 MPa
const SGL_SET=50;         // %, the level the feed controller holds
/* ── THE SHELL AS A POT ──
   Steel is what is left of the shell's heat capacity once its water is counted
   separately, and the water is counted at the LEVEL that is actually in there -
   a generator boiling dry loses its thermal mass with its inventory, which is
   why the small machine swings and the big one rides it out on one number
   instead of a fitted multiplier. */
const CP_STEEL=0.5;       // kJ/kg/K
/* Feedwater arrives at a real temperature, not at the shell's. Only the NET
   water accumulating is charged sensible heat here - what boils off is charged
   through H_FG, which already spans feedwater to steam, so charging both would
   count the same kilogram twice. */
const T_FEED=490;         // K
/* WHERE A SHELL LETS GO. There is NO invisible lid on this plant: if nothing
   was fitted to take the steam, the shell takes it, and at this multiple of
   its design pressure it bursts. Latched, like a rupture disc and like the
   vessel: a burst shell does not reseat.
   A relief path is a PLACED FITTING - one box, one bore, one set point, one
   stick-open die - and it is the same ROLE.fitting the primary already uses.
   The only thing that had to change is which pressure a valve asks about, and
   that is answered off where it was drawn (shellsOf(), layout.js). */
const SG_BURST_K=1.5;
/* WHAT A FULL-BORE RELIEF VALVE PASSES AT ITS OWN LIFT POINT, in multiples of
   rated steam. NOT a free constant and not plant-wide: it is the sizing rule,
   and what any particular valve passes is this times its own bore squared
   times how far over the set point its shell actually is. The stock 0.55 bore
   is worth about nine tenths of rated steam at lift - enough to hold a healthy
   plant, not enough to save a careless one, which is what makes the bore a
   decision. */
const SG_RELIEF_CAP=3.0;
/* Dittus-Boelter: the tube-side film goes as flow^0.8. PHYSICAL, not fitted. */
const UA_FLOW=0.8;
/* ── AND THE SAME POT ONE STAGE EARLIER ──
   IHX_UA is what one intermediate exchanger's tubes are worth against the
   generator it feeds. Bigger, because the temperature difference it has to
   work across is the one it just gave away - a real intermediate exchanger is
   oversized for exactly that reason. In series the pair is worth
   1/(1/IHX_UA + 1) of the generator alone, so buying a second stage costs
   OUTPUT rather than temperature: the rods hold Tavg on programme either way,
   and the shell simply sits colder. IHX_HOLD is the intermediate coolant it
   carries, which with its own steel (IHX_MASS, layout.js) is the pot's heat
   capacity - and the reason a second stage is also a second flywheel. */
const IHX_UA=2.5;
const IHX_HOLD=90;        // t of intermediate coolant
/* A bigger exchanger is a bigger flywheel as well as a bigger conductance, so
   the size scales the coolant it holds and the steel round it together. */
const ihxHeatCap=id=>{ const k=ihxCap(ihxSizeOf(id));
  return k*IHX_HOLD*1000*CP_W + k*IHX_MASS*1000*CP_STEEL; };
const FEED_TAU=30;        // s, how fast feedwater walks a level error out
/* THE FEED REGULATING VALVE, one generator's own. FREG_RATE is how fast it
   strokes, in MPa of back-pressure per second at full error - a valve, not an
   algebraic answer, so a step change in demand is followed over a second and
   not inside one tick. FREG_MAX has to exceed the worst secP() spread a legal
   plant can develop, or the valve saturates and the generator nearest the
   pump takes the lot; the stock four-loop plant spreads about 1.1 MPa.
   FREG_SPAN floors the relative error's denominator so a generator asking for
   nothing does not divide by zero - a kg/s figure, small against any real
   steam rate. */
const FREG_RATE=1.0, FREG_MAX=4, FREG_SPAN=10;
/* Below this the tubes are uncovered and the generator stops being a heat sink.
   It was already the threshold the mimic's dry-out pulse and the LOW banner
   used; making removal read the same number is what closes the loop. */
const SG_DRY=25;          // %
/* The second step of the same alarm. SG_DRY is the tubes starting to uncover -
   recoverable, and the plant says so in amber. This is most of the bundle in
   steam with the core still making heat, and it reads red. Two numbers on one
   ladder, so the banner and the tile cannot disagree about which step it is on. */
const SG_DRY_LO=10;       // %
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
const sgMassOf=id=>sgRowOf(id).water*1000;
/* Rated steam for the WHOLE plant, kg/s - the sizing figure every secondary
   rate is a fraction of. */
const ratedSteam=()=>P.rated*1000/H_FG;
/* 100 % on a steam line: one generator's worth for its own run, the whole
   plant's for the exhaust. The tick normalises the packet integral on it and
   the meter prints it as a full scale, so the digits and the packets read the
   same number - the rule every other run already keeps. */
const steamScale=k=>k==="exh" ? ratedSteam() : ratedSteam()/Math.max(1,sgCount());
/* ══ WHICH WAY ALONG THE PIPE THE STEAM ACTUALLY GOES ══
   A run's key names its two ends in a CANONICAL order (pipeMap() sorts by
   part id, then face) so the key is the same string whichever end a hand drew
   from. That order is not the flow order and has no reason to be: "cond" sorts
   before "turb", so the exhaust's canonical direction is condenser to turbine
   and driving its packets positive ran them backwards up their own pipe.
   The primary runs get away with it by luck - core before tee0, pump0 before
   sg0 - and nothing noticed while the secondary carried no rate at all.
   +1 means the steam runs the way the key reads. A steam run leaves its
   GENERATOR; the exhaust arrives at the SINK. */
const isSink = id => { const p=LAY.parts.find(q=>q.id===id);
  return !!p && ROLE[p.role] && ROLE[p.role].thermal==="sink"; };
function steamDir(key,k){
  const ends = runEnds(key,k); if(!ends) return 1;
  const pid = n => n.slice(0,-1);
  if(k==="exh") return isSink(pid(ends[1])) ? 1 : -1;
  return (S && S.steamTo && S.steamTo[pid(ends[0])]!==undefined) ? 1 : -1;
}
/* What the shell is designed to sit at, where a relief valve set to this
   plant's default lifts, and where the shell itself lets go. */
const sgDesignP=()=>P.P0*0.45;
const sgLiftP=fid=>sgDesignP()*(fid===undefined?PORV_LIFT0:reliefSet(fid).lift);
const sgBurstP=()=>sgDesignP()*SG_BURST_K;
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
const hotMass=()=>{ let m=0;
  for(const id of sgIds()) m+=sgRowOf(id).water*1000;
  return Math.max(1,m); };
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
/* ONE generator's own shell temperature, K. A caller with no live shell - the
   bench, a tick-zero seed - gets the fallback curve's answer instead. */
const sgTemp=(s,id)=>{ const v=s&&s.sgTBy&&s.sgTBy[id];
  return v===undefined ? tsatSec(secPTarget(s,id)) : v; };
/* ONE exchanger's own intermediate temperature, K. No entry yet is a pot that
   has not been seeded, and a pot at loop temperature is what it seeds to. */
const ihxTemp=(s,id)=>{ const v=s&&s.ihxTBy&&s.ihxTBy[id];
  return v===undefined ? (s?s.Tavg:0) : v; };
/* WHAT THIS GENERATOR'S TUBES ARE HEATED BY - the core's own coolant, unless
   an intermediate exchanger stands in front of it, when it is that exchanger's
   pot. ONE reader, so the heat term, the readout and the T-HOT row cannot
   disagree about which stage a generator is on. */
const sgHot=(s,id)=>{ const h=ihxOf(id); return h ? ihxTemp(s,h) : s.Tavg; };
/* IS WHAT IS IN THESE TUBES THE CORE'S OWN WATER? An intermediate exchanger is
   a BARRIER, and that is the whole reason the real machines exist: behind one,
   a tube rupture leaks the exchanger's coolant into the shell and costs no
   release at all. It still costs INVENTORY - the loop it drains is still a
   loop this plant needs to cool the core with - so only the activity is
   bought, which is exactly what the barrier is. */
const sgActive = id => !ihxOf(id);
/* The pot's heat capacity: the water actually in it plus the steel round it. */
const sgHeatCap=(s,id)=>sgRowOf(id).water*1000*(sgLvl(s,id)/100)*CP_W
                      + sgRowOf(id).mass*1000*CP_STEEL;
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
/* ── DNBR OFF A PUBLISHED CORRELATION ──
   What stood here was five invented exponents over a hand-picked peaking
   factor of 2.66: hotFlow^.6, (p/P0)^.3, (sc/20)^.4. W-3 (Tong, 1967) is the
   correlation the industry actually uses for this, and after the bundle got
   pins there is nothing left to invent - it wants real heat flux, real mass
   flux, quality, hydraulic diameter and pressure, and all five are measured.

   The paper's coefficients are in the paper's units, so the conversion happens
   once at the door and nowhere else: psia, lb/hr/ft2, inches, BTU/lb, and an
   answer in BTU/hr/ft2. W3_LIM is the correlation's OWN validity range, not a
   guard invented here - past it the first bracket's exponential runs away and
   the answer stops being W-3 at all. The stock water families all land inside
   it: 15.5 MPa is 2248 psia, the stock bundle is 0.46 in, and rated G is
   2.0e6 lb/hr/ft2. A sodium or salt plant at 0.2 MPa does not, and no longer
   asks - see dnbrOf(). */
const W3_P=145.038, W3_G=737.338, W3_D=39.3701, W3_Q=3.15459, W3_H=2.326;
const W3_LIM={p:[1000,2300], g:[1.0,5.0], d:[0.2,0.7], x:[-0.15,0.15]};
function dnbW3(pMPa,gSI,x,dhM,dhSub){
  const p=clamp(pMPa*W3_P,W3_LIM.p[0],W3_LIM.p[1]);
  const g=clamp(gSI*W3_G/1e6,W3_LIM.g[0],W3_LIM.g[1]);
  const de=clamp(dhM*W3_D,W3_LIM.d[0],W3_LIM.d[1]);
  const q=clamp(x,W3_LIM.x[0],W3_LIM.x[1]);
  const hs=Math.max(dhSub,0)/W3_H;
  return 1e6*W3_Q
    *((2.022-4.302e-4*p)+(0.1722-9.84e-5*p)*Math.exp((18.177-4.129e-3*p)*q))
    *((0.1484-1.596*q+0.1729*q*Math.abs(q))*g+1.037)
    *(1.157-0.869*q)
    *(0.2664+0.8357*Math.exp(-3.151*de))
    *(0.8258+7.94e-4*hs);
}
/* ── ONE MARGIN LAW PER FAMILY ──
   DNB is not the limit for a fluid that cannot boil. Sodium at 0.2 MPa sits
   430 K below saturation and a real SFR is designed against BOILING ONSET;
   helium never boils at all and a real gas core is designed against FUEL
   TEMPERATURE. Feeding either to a clamped W-3 gave them water's shape in
   pressure - the answer read plausible and stopped moving. So P.dnbLaw picks
   the law off what the fluid IS (COOLANT, design.js) and each law is a margin
   ratio of the same currency: what the core could stand over what it is doing.

   boil is measured end to end - the hot channel's rise is s.coreDT peaked by
   s.fq, and the room it has is how far the inlet sits below saturation, so
   losing flow, raising power or depressurising all cut it directly.
   temp is the same shape against the fuel's own damage temperature, which
   P.tdmg already carries and the damage block already reads.

   W-3 gives the SHAPE; the COOLANT row's own dnbr column still gives the
   LEVEL, which is the one thing about thermal margin that was never a shape
   you could draw. P.dnbrK is the P.pinUA idiom: solved once in commission()
   so that this plant at RATED power and RATED mass flux reads exactly
   P.dnbr0 - and it anchors all three laws, so no plant's rest point moves.
   One helper, because the anchor and the tick must not drift.

   It takes an ARGUMENT BUNDLE rather than reading s.coreDT/s.fq/s.TfHot off
   state, because margin is now asked TWICE with different arguments: once for
   the plant, off the peak scalars, exactly as before (marginCore); and once
   per NODE from inside coreStep()'s loop, where that node's own rise, flux,
   channel flow and quality are all live (marginNode). Two builders and no
   third - the laws stay in one place and neither caller reaches past it.
     law    which of the three                       dhSub inlet subcooling, kJ/kg
     dT     the rise the hot channel took, K         Tin   channel inlet, K
     Tf     fuel temperature to judge, K             q     heat flux, W/m2
     g      mass flux, kg/m2/s                       x     thermodynamic quality
     p      core pressure, MPa

   THE END STATE IS THE NODE MINIMUM. s.dnbr and s.dnbrMin are kept apart today
   only because the auditor refit has not happened: moving the quantity the RPS
   trips on, the LO DNBR tile lights on and every pinned figure is measured
   against, all in the same change that introduces the field, would leave
   nothing able to say which number moved for a good reason. */
function dnbrOf(m){
  if(m.law==="boil")
    return P.dnbrK*(m.dhSub/CP_W)/Math.max(m.dT,1e-3);
  if(m.law==="temp")
    return P.dnbrK*Math.max(P.tdmg-m.Tin,0)/Math.max(m.Tf-m.Tin,1e-3);
  return P.dnbrK*dnbW3(m.p,Math.max(m.g,1e-3),m.x,P.dh,m.dhSub)/Math.max(m.q,1);
}
/* The PLANT's margin, off the peak scalars - the same five operands the old
   positional dnbrOf() was called with, in the same arithmetic, so this number
   does not move by a bit. */
function marginCore(s,heat,sat){
  return dnbrOf({law:P.dnbLaw, dhSub:CP_W*(sat-(s.Tavg-s.coreDT/2)),
    dT:s.coreDT*s.fq, Tin:s.Tavg-s.coreDT/2, Tf:s.TfHot,
    q:heat*P.rated*1e6/Math.max(P.aHeat,1e-6)*Math.max(s.fq,1e-3),
    g:P.G0*s.hotFlow, x:s.xHot, p:s.pCore});
}
/* ONE NODE's margin, called from inside coreStep()'s loop. Every operand is a
   local that loop already had, so nothing new is measured - the loop simply
   stops throwing it away. `rise` in particular is the enthalpy actually
   carried to this node rather than the core rise peaked by a FLUX factor,
   which is the conservatism CLAUDE.md names in the boil law. */
function marginNode(s,heat,pw,rise,Tin,Tf,gShare,x,dhSub){
  return dnbrOf({law:P.dnbLaw, dhSub, dT:rise, Tin, Tf,
    q:heat*P.rated*1e6/Math.max(P.aHeat,1e-6)*Math.max(pw,1e-3),
    g:P.G0*gShare, x, p:s.pCore});
}
/* ══════════ HOW FUEL FAILS, IN STAGES ══════════
   What stood here was two literals growing one scalar out of the core AVERAGE
   fuel temperature and a single hot-channel DNBR:

     if(s.dnbr<1)    s.dmg += (1-s.dnbr)*22*dt;
     if(s.Tf>P.tdmg) s.dmg += (s.Tf-P.tdmg)*0.012*dt;

   A centre channel melting and a uniformly warm core read identically, and
   40 % was a mood rather than a count of pins. Both rates are DELETED rather
   than renamed, because each was standing in for a path this model can now
   walk: margin is lost, the film collapses, the clad climbs to the pellet, it
   balloons against its own fill gas and it bursts. The RATE is an outcome now.

   Damage is three per-node fields (s.nDmg, s.nOx, s.nMelt - core2d.js), all
   three monotonic integrals, and A STAGE IS DERIVED off them and never stored
   - the same rule runKindFor() and sgActive() keep. Monotonic buys three
   things at once: "permanent" is a property of the integrator rather than a
   Math.min bolted on, a restore lands exactly where the snapshot was, and the
   ordering below is enforceable.

   s.dmg and s.melt survive unchanged as the aggregates, so the trends, both
   ev() milestones, the ANN tile, the vessel hatch, radSrc() and scnLimit() all
   keep reading exactly the numbers they read before. */
const FAIL=[
 {k:"intact",lab:"INTACT",    col:()=>C.cyan},
 {k:"burst", lab:"CLAD BURST",col:()=>C.amber},
 {k:"oxid",  lab:"OXIDISED",  col:()=>C.red},
 {k:"molten",lab:"FUEL MELT", col:()=>C.bright},
];
/* ── WHAT EACH STAGE PUTS PAST THE FUEL BOUNDARY ──
   One coefficient used to do this for every kind of failure at once, and it
   was wrong in a nameable way: a burst clad vents the GAP and then stops,
   which NUREG-1465 puts at a few per cent of the volatile inventory, while a
   molten pellet releases the volatiles themselves at 25-35 %. Two orders of
   magnitude apart, and 0.004 was their geometric mean wearing one number's
   clothes.
   REL_GAP is the ANCHOR and is fitted, not published: it is exactly the old
   0.004*100, so a core that is 100 % burst and 0 % molten releases at today's
   rate to the bit. The other two are the published RATIOS above it - the same
   split W-3 has, where the correlation gives the shape and a bought column
   gives the level. */
const REL_GAP=0.40, REL_OX=0.80, REL_MELT=2.40;
const RELK={intact:0, burst:REL_GAP, oxid:REL_OX, molten:REL_MELT};
/* ── WHEN A ROD BURSTS ──
   Ballooning is a hoop stress question, not a temperature one: the rod is
   pressurised with helium at fabrication, that pressure rises with absolute
   clad temperature, and what bursts it is the DIFFERENCE against the loop.
   That is why a depressurised core fails its clad hundreds of kelvin lower
   than one still at pressure, and why a plant that holds pressure gets no
   ballooning at all - two behaviours this model could not tell apart while the
   criterion was a flat P.tdmg.
     P_FILL/T_FILL  the as-built helium charge, 2.2 MPa cold
     BURST_R        mean radius over wall, so hoop stress is BURST_R*dP
   BURST_LO/BURST_HI are NUREG-0630's fast-ramp burst curve reduced to its two
   ends and interpolated in log stress - A FIT to a published SHAPE, not the
   published correlation, and it is the first thing to replace if this reads
   wrong. BURST_TAU is a fit too and says what it is: real ballooning and
   rupture take seconds, not one tick, and BURST_SPAN is the transition width
   that keeps the criterion from being a cliff - the same idiom CAV_SPAN has. */
const P_FILL=2.2, T_FILL=300, BURST_R=(ROD_D/2-ROD_CLAD)/ROD_CLAD;
const BURST_LO={sig:20,T:1477}, BURST_HI={sig:140,T:1030};
const BURST_TAU=8, BURST_SPAN=50;
function burstT(dP){
  const sig=BURST_R*Math.max(dP,0);
  if(sig<=BURST_LO.sig) return BURST_LO.T;
  const f=Math.log(sig/BURST_LO.sig)/Math.log(BURST_HI.sig/BURST_LO.sig);
  return Math.max(BURST_HI.T, BURST_LO.T-(BURST_LO.T-BURST_HI.T)*f);
}
/* ── ZIRCALOY-STEAM OXIDATION ──
   The prize, and the thing that made TMI and Fukushima what they were: past
   about 1500 K of clad this term makes more heat than the decay heat that
   started it, and nothing on the plant can switch it off.

   Parabolic, and integrated on the SQUARE in closed form:
     nOx = sqrt(nOx^2 + A*exp(-B/T)*dt)
   The differential form divides by the thickness and blows up at zero. The
   squared form is exact over the step, unconditionally stable and monotonic by
   construction, and it needs no floor.

   TWO correlations with a domain switch, the same standing W3_LIM has - a
   correlation's own stated range, never a guard invented here. Cathcart-Pawel
   is the measurement and is stated to 1773 K; Baker-Just is the CONSERVATIVE
   licensing correlation above it, and is the one the 17 % ECR limit is defined
   against in the first place. Both are quoted here as rate constants on OXIDE
   THICKNESS SQUARED, in m2/s, which is the conversion that has to be got right:
     CP  0.02252 cm2/s * exp(-35890/(1.987*T))  ->  2.252e-6 m2/s, B = 18063 K
     BJ  3.3e7 (mg/cm2)^2/s * exp(-45500/(1.987*T)), divided by (1000*ZR_RHO/1e3)^2
         to reach metal thickness and multiplied by ZR_PBR^2 to reach oxide
         ->  1.867e-4 m2/s, B = 22899 K
   OX_T0 is the real onset - zircaloy oxidation is a corrosion below about
   800 C and a reaction above it - and it is also what makes this term EXACTLY
   zero at every preset's commissioning point rather than merely small there.
   That matters more than it looks: commission() runs one real step() to solve
   P.dnbrK, so a term that is only ALMOST zero at rest anchors the whole plant
   against a core that was quietly burning, and the reset afterwards wipes the
   evidence. OX_VMIN is a fit and a small one: metal under liquid water is not
   at 1073 K, but the gate should say so rather than rely on the temperature to
   imply it.

   DELIBERATELY NOT MODELLED: steam starvation. Real oxidation in a blocked
   channel runs out of steam and self-limits, and that needs a per-channel steam
   mass balance this solver does not carry - the "unless it is heavy to compute"
   clause, invoked out loud rather than quietly. */
const OX_CP={a:2.252e-6,b:18063}, OX_BJ={a:1.867e-4,b:22899}, OX_TSW=1850;
const OX_VMIN=0.02, OX_T0=1073;
const oxRate = T => { const c = T<OX_TSW ? OX_CP : OX_BJ;
  return c.a*Math.exp(-c.b/Math.max(T,300)); };
/* ── HOW MUCH WALL IS LEFT ──
   ECR is equivalent clad reacted: the metal the oxide ate, over the 0.57 mm
   that was drawn. 0.17 is 10 CFR 50.46's licensing limit and is where a node
   stops being merely burst and starts being OXIDISED; 1.0 is no metal left at
   all, and a node with no clad has nothing holding pellet geometry, so that is
   the second way nDmg reaches 1. Both are measured off the drawing. */
const OX_ECR_FAIL=0.17;
const ecrOf = ox => ox/ZR_PBR/ROD_CLAD;
/* ── MELT WITHOUT A RATE FIT ──
   A node at tmelt absorbs power WITHOUT rising until its latent heat is paid,
   and then rises again. That is one accumulator, one fewer fitted rate, and
   the melt plateau comes free - the same move as "void is quality, s.vf is a
   MEASUREMENT". FUSE_DT is that latent heat expressed as the temperature rise
   it displaces: UO2's 277 kJ/kg of fusion over its ~0.33 kJ/kg/K specific heat
   at temperature, both real. A node cannot melt before its clad has failed,
   which is physically true and makes s.meltFrac <= s.dmg/100 a THEOREM. */
const FUSE_DT=840;
/* CORE MELT latches on a quarter of the fuel volume actually molten. The 60 it
   replaces was 60 % of a scalar that meant clad failure, which is a different
   quantity - and because melt cannot outrun burst, this makes "dmg > 25 at
   melt" true by construction rather than by coincidence. */
const MELT_LATCH=0.25;
/* What a melting core costs with no catcher under it: inventory in % per
   second and vessel fatigue in points per second, both the literals they
   replace, and both scaled by HOW MUCH is molten rather than switched on by a
   latch. A core 3 % molten and one 90 % molten used to cost the same. */
const MELT_INV=0.35, MELT_FAT=1.6;
/* the hydrogen milestone, kg. A stock core carries ~8 t of zircaloy and would
   yield ~370 kg fully burnt, so this is a few per cent of the wall gone. */
const H2_EV=20;
/* The core's temperature rise at RATED flow and rated heat, in K. It is the
   SIZING figure now, not the answer: coreStep() integrates enthalpy up each
   channel and hands back what the channels actually did, and this is what says
   how much water a rated channel carries. QMIN floors the flow it is divided
   by. CORE_DT_TAU is gone with the correlation - a lag existed to break an
   algebraic loop there is no longer one of. CORE_DT_MAX stays: past it the
   channel is boiling rather than getting hotter, so the figure stops being a
   temperature rise, and buoyancy is the one thing that reads it. */
const CORE_DT0=30, CORE_DT_QMIN=0.004, CORE_DT_MAX=250;
// the rise at RATED flow, which is what a plant that has only just been
// commissioned already has in it
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
/* step()'s own heat balance, published for the ledger to draw - not a second
   derivation of it, and not on S: it is a pure function of S, resolved fresh
   every tick, the same standing display smoothing and the solved network have.
   sgQBy is REFILLED, never rebuilt - a renderer holds the reference. */
const HEATBAL={prompt:0,decay:0,heat:0,removal:0,dTavg:0,sgQBy:{}};
/* A tilt of 1.0 stands the innermost bank XTILTZ of core height clear of the
   outermost, and the drives that do it are the same drives that move the bank.
   So the trim walks at the bank rate divided by that span - derived, not typed,
   or the two drift apart the next time the span is retuned. */
const TILT_RATE=ROD_RATE/XTILTZ;
const tsat=p=>satT(P.sat,p);
/* The coolant temperature programme: where T-avg is meant to sit for the load
   the turbine is drawing. One function, because the rod controller walks to it,
   the steam dump trims to it, the TAVG DEV tile judges against it and the panel
   prints the deviation from it - and a PWR number hard-coded in any one of
   those lights the alarm on every plant that is not a PWR. Through a trip the
   runback takes the load off, so the programme drops to its no-load point; with
   the runback bypassed the turbine is still drawing, and the programme has to
   keep following it. */
const tProg=s=>P.Tref-18 + ((s.scrammed && autoLive("runback")) ? 0 : 18*s.load);

/* ONE PUMP'S OWN STARTING SPEED. A coolant pump answers the plant-wide lever,
   so the bench sets one number for all of them; any other pump answers only
   for itself - the same two spans ctlFor()'s own slider already has. */
const pumpStart = id => primaryPump(id) ? startOf("flowDem",1) : startOf(id+":pumpDem",1);
function resetPlant(){
  const x0=startOf("rodCommon",RODX0);
  S={n:P.n0,C:P.bet.map((b,i)=>b*P.n0/(P.LAM*P.lam[i])),I:P.gI*P.n0/P.lamI,X:P.X0,
     Tf:P.TfRef,Tavg:P.Tref,rodPos:x0,rodDem:x0,rodJam:false,rodBand:false,scrammed:false,
     load:startOf("loadDem",1),loadDem:startOf("loadDem",1),flowNet:1,P:P.P0,lvl:54,inv:100,
     /* ONE DEMAND AND ONE ACTUAL PER PUMP, keyed by part id like s.sglBy and
        s.tank[id] - REFILLED by step(), never rebuilt. There is one pump role
        now, so one global speed would be the odd control out: what a coolant
        pump is told and what a feedwater pump is told are different orders to
        different machines that happen to share a role. Demand starts equal to
        actual, which is the rule every actuator on this plant owes. */
     flowBy:Object.fromEntries(pumpIds().map(id=>[id,pumpStart(id)])),
     flowDemBy:Object.fromEntries(pumpIds().map(id=>[id,pumpStart(id)])),
     /* one level per generator, keyed by part id like s.sgtrBy - REFILLED by
        step(), never rebuilt, so a renderer may hold it across frames */
     sglBy:Object.fromEntries(sgIds().map(id=>[id,SGL_SET])),
     /* each generator's own feed regulating valve, in MPa of back-pressure -
        an ACTUATOR, walked toward what the controller is asking for, never
        written to the answer directly. 0 is wide open, which is what an
        untouched plant starts at and what makes its first tick identical to a
        plant with no valve. Keyed and refilled exactly like s.sglBy. */
     fregBy:Object.fromEntries(sgIds().map(id=>[id,0])),
     /* each generator's share of the heat leaving the primary, measured off
        the solve and read back by secP() next tick - like s.cavP */
     sgShare:Object.fromEntries(sgIds().map(id=>[id,1/Math.max(1,sgCount())])),
     /* ONE GENERATOR'S SHELL, as a pot: the temperature it is sitting at, what
        it is raising, and what actually gets away down the steam line. The gap
        between the last two IS the trapped steam, which is what the shell
        temperature integrates. Seeded below, once S exists, off the fallback
        curve - so tick zero is bit-identical to the formula this replaces.
        REFILLED by step(), never rebuilt: a renderer holds them across frames. */
     sgTBy:{}, steamBy:{}, steamTo:{}, steamWk:{},
     /* AND THE SAME TWO FIELDS ONE STAGE EARLIER, per intermediate exchanger:
        the temperature its pot is sitting at, and what is crossing into it.
        Seeded below off the loop's own temperature. REFILLED by step(). */
     ihxTBy:{}, ihxQBy:{},
     /* kg/s a generator's own relief valves are passing - a readout, refilled */
     sgVentBy:{},
     /* and whether its shell has let go. LATCHED, like a rupture disc: a burst
        shell does not reseat. Keyed and refilled exactly like s.sglBy. */
     sgBurst:Object.fromEntries(sgIds().map(id=>[id,false])),
     /* kg/s each SECONDARY relief valve is passing - a readout, refilled never
        rebuilt, so its panel holds the reference across frames */
     reliefSteam:{},
     /* the condenser's own temperature, K - what its backpressure is the
        saturation pressure of. Starts on the design vacuum, which is where the
        balance below puts it on a healthy plant anyway. */
     condT:0,
     /* last tick's void and inventory, so the two halves of the level that are
        still correlations can be differentiated into rates - the expansion
        half is the solve's own surge flow and needs no memory of its own */
     vf0:0, inv0:100,
     /* One map per relief fitting, keyed like S.valve/S.valveDem - seeded
        from P.fittings rather than a fixed set of keys, so a plant with no
        relief path (a legal design choice, see the bench warning in
        design.js) simply seeds nothing and every reader above (all written
        against reliefFitIds()) finds an empty list rather than a phantom
        valve. reliefArm mirrors porvArm's old job, per fitting: the one-shot
        a scenario sets to command THAT fitting's next lift to stick. */
     reliefOpen:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     reliefAuto:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     reliefStuck:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     reliefBlocked:Object.fromEntries(reliefFitIds().map(k=>[k,!!startOf(k+":porvBlock",false)])),
     reliefArm:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     /* per-valve arming, seeded for RELIEF fittings only - a throttle has no
        automatic behaviour to defeat, and a phantom key here is a
        phantom key in every snapshot taken from now on. */
     porvByp:Object.fromEntries(reliefFitIds().map(k=>[k,!!startOf(k+":porvByp",false)])),
     dmg:0,fatigue:0,dnbr:P.dnbr0,rho:0,voidTh:0,cav:0,vf:0,
     /* the groups start in equilibrium with commissioning power, or the plant
        would spend its first minutes breeding heat it should already have */
     dec:DEC_A.map(a=>a*P.n0), decay:DEC_A.reduce((t,a)=>t+a,0)*P.n0,
     byp:Object.fromEntries(AUTOKEYS.map(k=>[k,!!startOf("byp:"+k,false)])),
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
     tankOpen:Object.fromEntries(tankIds().map(k=>[k,!!startOf(k+":tankOpen",false)])),
     tankDump:Object.fromEntries(tankIds().map(k=>[k,!!startOf(k+":tankDump",false)])),
     tankByp:Object.fromEntries(tankIds().map(k=>[k,!!startOf(k+":tankByp",false)])),
     burstBy:Object.fromEntries(tankIds().map(k=>[k,false])),
     tankOver:{},
     /* what each tank's own edge is carrying, % of loop inventory per second,
        tank-out-positive - a readout, REFILLED never rebuilt, because a
        renderer holds it across frames to meter that tank's own line */
     tankRate:{},
     /* the controller's tune, copied from the commissioning constants so a
        RESET PLANT puts the operator's experiments back where they started */
     split:false, reGang:false,
     /* A THROTTLE'S ACTUAL AND DEMAND both start on the same as-commissioned
        default (every actuator's demand starts equal to its actual - see
        flow/rod/boron below), and WHICH default is a structural question:
        a CROSS-TIE starts SHUT, because a branch you have to open by hand
        cannot change the plant you just commissioned behind your back; a
        valve spliced INTO a line the design already depends on starts WIDE,
        because shut-by-default would choke a main leg the moment it was
        placed, which is not a conservative default but a broken one.
        fitTies() (layout.js) is the one predicate for the difference - a
        cross-tie is a valve whose two sides belong to different loops - and
        it replaces the old `bKey` test, which asked about the SHAPE of a tap
        rather than about the plant. Wide open is bit-identical to no valve at
        all (valveLeq(1) is exactly 0), so a spliced valve nobody touches
        moves no pinned figure. */
     valve:Object.fromEntries(Object.keys(P.fittings).filter(k=>P.fittings[k].mode==="throttle")
       .map(k=>[k, startOf(k+":valve", fitTies(k)?0:1)])),
     valveDem:Object.fromEntries(Object.keys(P.fittings).filter(k=>P.fittings[k].mode==="throttle")
       .map(k=>[k, startOf(k+":valve", fitTies(k)?0:1)])),
     arGain:AUTOROD_GAIN, arLead:AUTOROD_LEAD, arLo:P.arLo, arHi:P.arHi,
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
        also what a plant already at power has in it: the rise is MEASURED up
        each channel now, so starting at zero would put the whole core 15 K
        cold for the first tick and kick a moderator transient nobody caused. */
     coreDT:CORE_DT0*P.n0,
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
  S.heat = S.n*PROMPT_F + S.decay;
  /* the rated-flow value of the same expression the tick uses - a plant on
     tick zero is at rated flow by construction, so its rise is coreDTRated()
     even though s.coreDT has not walked up to it yet */
  S.sc   = tsat(S.P) - (S.Tavg + coreDTRated(S.heat)/2);
  /* the same subcooling read as a thermodynamic quality, which is the currency
     W-3 asks in - negative on a subcooled plant, positive on a saturated one */
  S.xHot = -CP_W*S.sc/P.hfg;
  /* The shell starts where the old formula put it, so nothing pinned against a
     plant at rest moves. From here it is an integral. */
  for(const id of sgIds()) S.sgTBy[id] = tsatSec(secPTarget(S,id));
  /* The pot starts between the two stages it stands between, which is where a
     settled plant puts it anyway - starting it at Tavg would hand a generator
     the whole primary temperature for one tick and kick a transient nobody
     caused, the same argument s.coreDT's own seed makes. */
  for(const id of ihxIds())
    S.ihxTBy[id] = S.Tavg - (S.Tavg - tsatSec(secPTarget(S,ihxSgs(id)[0])))/(1+IHX_UA);
  S.condT = tsatSec(COND_P0);
  /* Settle the flux shape first, then dial in the boron that actually makes
     THIS shape critical. Rod worth is emergent now, so a formula would leave
     the plant slightly off-critical and walk it into a trip nobody caused. */
  coreReset(S);
  /* THE PER-BANK STARTING POSITIONS, after coreReset() - that is what
     allocates the P.NB-sized arrays, so nothing bank-shaped can be seeded
     before it. Each falls back to the common position, so an untouched design
     is bit-identical to the ganged plant this replaces. */
  for(let b=0;b<P.NB;b++){
    S.rodZ[b] = S.rodZDem[b] = startOf("rodBank:"+b, x0);
    S.bankAuto[b] = !startOf("bankAuto:"+b, false);
  }
  { let m=0; for(let b=0;b<P.NB;b++) m+=S.rodZ[b];
    S.rodPos = S.rodDem = m/P.NB; }
  S.tilt = S.tiltDem = startOf("tiltDem",0);
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
  /* Settle the node graph for this tick and hold it. Nothing below redraws the
     plant, and ~85 readers ask for it - see nodeGraph(), layout.js. The hold is
     dropped on the last line of this function, so it never outlives the tick. */
  nodeGraphHold(false); pipeMapHold(false);
  pipeTrace(); pipeMap(); nodeGraph();
  nodeGraphHold(true); pipeMapHold(true);

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

  /* THE CONTROLLER OUT OF AUTHORITY. Set where the clamp actually bites, not
     inferred from the position afterwards: a bank parked on the band edge with
     T-avg on programme is obeying, and only a bank being pushed further into
     the stop is a controller that cannot do its job. The half-kelvin gate is
     what keeps it off during the ordinary hunt across the setpoint. */
  s.rodBand=false;
  const pinned=(want,got)=>{
    if(Math.abs(want-got)>1e-9 && Math.abs(s.Tavg-tProg(s))>0.5) s.rodBand=true; };

  if(!s.split && bankAutoLive(0)){                // ganged: one controller, one bank
    const want=s.rodDem+rodErr;
    s.rodDem=clamp(want, rodLo, rodHi);
    pinned(want,s.rodDem);
  }

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
      if(bankAutoLive(b)){ const want=s.rodZDem[b]+rodErr;
        s.rodZDem[b]=clamp(want, rodLo, rodHi);
        pinned(want,s.rodZDem[b]); }
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
  const heat = s.n*PROMPT_F + s.decay;


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
  /* A HOLE IN THE SECONDARY SPILLS SECONDARY WATER. Kept apart from `spill`
     at the edge (ed.sec, pipenet.js) because everything below charges spill
     to s.inv and blows the pressurizer bubble down with it - which is how a
     hit on the condensate line used to drain the primary. Kilograms, the
     currency the condensate balance counts in. */
  const spillSecKg = invRate(netOut.spillSec||0)/100*loopKg();
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
  const injIds = [];               // WHICH tanks, for the log - a local, never on S
  for(const k in s.tankRate) if(!D.tanks[k]) delete s.tankRate[k];
  for(const tid of tankIds()){
    /* IN THAT TANK'S OWN CURRENCY. A secondary tank has a solved edge now, so
       reading 0 here would print a still gauge on a tank that is emptying;
       invRate() speaks % of LOOP inventory, and a reserve on the other side of
       the tubes is a share of the SECONDARY charge instead. tankKg() makes the
       same switch and for the same reason. */
    const raw = invRate(qTankBy[tid]||0);
    const q = tankSide(tid)==="primary" ? raw : raw*loopKg()/hotMass();
    /* s.tankRate keeps the RAW signed figure: it is what the panels and the
       pipe gauges read, and a tank being filled reads negative there on
       purpose. Only the "is anything injecting" question needs the noise
       floor - see tankInjecting() (pipenet.js) for what a bare q>0 cost. */
    s.tankRate[tid] = q;
    /* inj is what the PRIMARY is taking - it feeds vessel fatigue and the
       injection log line, both of which are about this vessel. */
    if(tankSide(tid)==="primary" && tankInjecting(tid, q)){ inj += q; injIds.push(tid); }
  }
  /* What is left of the pressurizer's authority. It only sets pressure while
     the loop is a closed boundary: past a real leak there is no steam bubble
     to work against, and this is what used to be a hard on/off gated on
     s.breach alone - which said a severed hot leg was a closed loop. */
  const pzrAuth = clamp(1 - spill/PZR_LOSE, 0, 1);
  // coreFold() first: a folded part (the core's plenum, the pressurizer's
  // shell, a tee's four faces) has ONE node under its bare id, so a caller
  // naming a face would otherwise fall through to the s.P default and read a
  // plant-wide number where it asked for a place.
  const pAt = n => { const v = pField[coreFold(n)]; return v===undefined ? s.P : v; };
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
  const cavIds = [];               // WHICH pumps, for the log - a local, never on S
  { let worst=0;
    /* Off the real parts and the run graph, never off "pump"+i - a spare
       pump's own id doesn't match its loop's index, and once a generator can
       be placed rather than conjured at a fixed "pump"+i slot, that string
       stops being anything but coincidence. Every PRIMARY pump reports at its
       own suction; a loop with more than one pump pooling capacity (loopOf())
       takes the WORST of them, because that is the one head loss actually
       costs the group. primaryPump() is the shared predicate (layout.js) - a
       feedwater pump is a ROLE.pump too, and s.cavP is keyed by primary loop,
       so one that read this block would be derated by a foreign suction. */
    const byLoop={};
    for(const p of LAY.parts){
      if(!primaryPump(p.id)) continue;
      const li=loopOf(p.id);
      const c = clamp(-scAt(p.id+"t")/CAV_SPAN, 0, 1);
      if(!(li in byLoop) || c>byLoop[li]) byLoop[li]=c;
      /* WHICH pump, kept for the log alone. s.cavP is keyed by LOOP because
         that is what the head derate applies to, so the id was thrown away
         here and "COOLANT PUMP CAVITATION" could not say which pump on a
         four-loop plant. A local, deliberately: it is a pure function of this
         tick's field, so putting it on S would be a snapshot field that says
         nothing a resolve could not. */
      if(c>0.15) cavIds.push(p.id);
    }
    for(const li in s.cavP){ s.cavP[li]=byLoop[li]||0; if(s.cavP[li]>worst) worst=s.cavP[li]; }
    s.cav = worst; }
  /* ── coolant flow: pumps have inertia ──
     Losing power does not stop a pump dead, it coasts. Blackout is the same lag
     with a longer time constant, so the grace time the brief promises is real. */
  /* The backup supply carries the share of pump power the bench sold: diesels
     are the full set, a battery bank is half of it. Scaled off demand, so what
     the operator asked for is still what the supply is trying to deliver. */
  { const tau = s.blackout ? FLOW_TAU_COAST : FLOW_TAU, k = Math.min(dt/tau,1);
    const live = {};
    for(const id of pumpIds()){ live[id]=1;
      if(s.flowDemBy[id]===undefined) s.flowDemBy[id]=1;             // a pump placed mid-run arrives at rated
      if(s.flowBy[id]===undefined) s.flowBy[id]=s.flowDemBy[id];
      s.flowBy[id] += (supplyK(s)*s.flowDemBy[id] - s.flowBy[id])*k; }
    for(const id in s.flowBy) if(!live[id]){ delete s.flowBy[id]; delete s.flowDemBy[id]; } }

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
  /* no (1-0.8*cav) here, and none on mflux or the packet animation below:
     cavitation is inside the pump's own head now, so pumpK already carries
     it. Leaving one of the three behind would count it twice. */
  /* Each generator's share of the primary flow, and so of the heat. Last
     tick's level rides inside it (sgFill, below): this tick's heat sets this
     tick's boil-off, which would set this tick's level, which would set this
     tick's heat. Lagged, that is a first-order filter; algebraic, it is a
     fixed point that oscillates. */
  const sgW = sgShare(netOut.byLoop);
  /* Fed to NEXT tick's solve, where secP() (pipenet.js) reads it to give each
     generator a secondary pressure of its own - the same lag s.cavP carries,
     and for the same reason: this tick's share comes out of this tick's solve,
     so it cannot also be an input to it. REFILLED, never rebuilt. */
  for(const k in s.sgShare) if(!sgW.hasOwnProperty(k)) delete s.sgShare[k];
  for(const k in sgW) s.sgShare[k] = sgW[k];
  /* WHAT SHARE OF RATED MASS FLOW IS ACTUALLY GOING THROUGH THE CORE. It is
     the one flow figure the enthalpy rise is divided by, and `enth` is gone
     with the correlation it corrected: the rise is measured up each channel
     now, so a loop on natural circulation gets a big rise because very little
     water is carrying the heat, not because a factor said so. */
  const flowFrac = Math.max(s.flowNet, CORE_DT_QMIN) * wet;
  /* DNBR does not care how much heat left the loop, only how fast the water
     is moving past the pin - so the boiling-crisis calculation is shown the
     flux and never the removal. It is also the film coefficient the pellet
     balance uses, which is the same question about the same water. */
  const mflux = driven * wet;

  /* ── heat balance ── */
  /* With the runback bypassed the turbine keeps its load through a trip, so the
     temperature programme has to keep following that load: the loop is still
     being drained of heat by a machine that should have shed it. */
  const Tprog = tProg(s);
  /* EVERY FEED PUMP STILL STANDING, asked of the DRAWING - a pump reaching a
     generator's shell (secGensOf(), layout.js), never the stock pump's id
     "feed". Delete that pump and place your own and this read OK forever;
     place two and losing one read nothing at all. */
  const feedOK = pumpIds().every(id => !secGensOf(id).length || !s.dmgParts.includes(id));
  /* A secondary reserve that is armed adds a small dump while the reactor is
     scrammed, which is what runs the loop a few degrees cooler after a trip.
     It asks the TANKS, not a system row - and reads identically on a stock
     plant, where exactly one tank carries a rule. */
  const dump = s.scrammed ? clamp((s.Tavg-Tprog)*0.02,0,P.bypass)*(feedOK?1:.25)+(tankRuleAny(s,"secondary")?0.08:0) : 0;
  const vNow = clamp(s.vf,0,1.5);
  /* ── HEAT CROSSES ON A TEMPERATURE DIFFERENCE ──
     `removal` was (s.load+dump)*feff: a DEMAND multiplied by penalty factors.
     It is a conductance times a difference now. s.load stops being the heat
     sink and becomes what it physically is - how much steam the turbine
     swallows, which sets s.steamTo, which cools the shell, which opens dT.

     Every one of the old multipliers is still here, and every one of them has
     moved to where it belongs. Slow water carries heat into the tube wall worse
     (flow^0.8, Dittus-Boelter); an empty primary carries none (wet, inside
     driven*wet); a bubbly one carries less (the void term, once 1-0.85*vf on
     the answer and now on the film); a dry shell is not a heat exchanger
     (sgFill). Each was a factor on a demand; each is a property of the
     conductance.

     P.sgUA is fitted at ONE anchor - see commission(). A generator with nowhere
     to send its steam is no longer flagged: its shell simply heats to Tavg and
     the difference closes. */
  const nSG = Math.max(1, Object.keys(sgW).length);
  const filmK = (1-0.85*Math.min(vNow,1));
  const sgQBy = {}, ihxFl = {};
  let qTot = 0;
  for(const id in sgW){
    const fl = Math.max(driven*wet*sgW[id]*nSG, 0.02);
    /* sgHot(), not s.Tavg: with an intermediate exchanger in front of it this
       generator is heated by that exchanger's pot, and the primary temperature
       is a stage away. Every other term is a property of THESE tubes and does
       not care which stage feeds them. */
    const q  = P.sgUA*Math.pow(fl,UA_FLOW)*sgFill(s,id)*filmK
             * Math.max(0, sgHot(s,id) - sgTemp(s,id));
    sgQBy[id] = q;
    /* HEAT LEAVING THE CORE IS WHAT CROSSES THE FIRST STAGE, never the second.
       With an exchanger in front, the primary gives its heat to the pot and the
       pot gives it to the shell - charging the core with the shell's own
       crossing would spend the stage that is storing it. */
    const h = ihxOf(id);
    if(h) ihxFl[h] = (ihxFl[h]||0) + fl;
    else qTot += q;
  }
  /* ── THE POT BETWEEN THE TWO STAGES ──
     The shell's own sentence said once earlier: in on a temperature difference
     across a conductance, out with whatever the shells behind it are taking,
     and the difference is stored. One more integrator and no new mechanism.
     REFILLED, never rebuilt - a renderer holds these across frames. */
  for(const id in s.ihxTBy) if(!ihxSgs(id).length) delete s.ihxTBy[id];
  for(const id in s.ihxQBy) delete s.ihxQBy[id];
  for(const id of ihxIds()){
    const served = ihxSgs(id); if(!served.length) continue;
    const fl = Math.max((ihxFl[id]||0)/served.length, 0.02);
    const qIn = P.ihxUA*ihxCap(ihxSizeOf(id))*served.length*Math.pow(fl,UA_FLOW)*filmK
              * Math.max(0, s.Tavg - ihxTemp(s,id));
    let qOut = 0; for(const g of served) qOut += sgQBy[g]||0;
    if(s.ihxTBy[id]===undefined) s.ihxTBy[id]=s.Tavg;
    s.ihxTBy[id] = clamp(s.ihxTBy[id] + (qIn-qOut)/ihxHeatCap(id)*dt, P.Tmin, P.Tmax);
    s.ihxQBy[id] = qIn; qTot += qIn;
  }
  const removal = qTot/(P.rated*1000);
  /* THE LOOP'S HEAT CAPACITY, not a typed 1.8. What is not removed goes into
     the water that is there: loopKg()*CP_W, both of which already exist and
     both of which follow the plant. graceK stays on top of it - that column is
     bought game balance and says so. */
  HEATBAL.prompt=s.n*PROMPT_F; HEATBAL.decay=s.decay;
  HEATBAL.heat=heat; HEATBAL.removal=removal;
  for(const id in HEATBAL.sgQBy) if(!(id in sgQBy)) delete HEATBAL.sgQBy[id];
  for(const id in sgQBy) HEATBAL.sgQBy[id]=sgQBy[id];
  s.dTavg = (heat-removal)*P.rated*1000/(loopKg()*CP_W)/P.graceK;   // K/s
  HEATBAL.dTavg=s.dTavg;
  s.Tavg = clamp(s.Tavg + s.dTavg*dt, P.Tmin, P.Tmax);

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
    /* A PRESSURIZER WITH NO PIPE TO THE LOOP SETS NOTHING. Unplumbed it is a
       vessel welded shut beside the plant: no surge line means no steam bubble
       anywhere in the loop, so nothing is holding pressure up and it relaxes
       toward containment - the SAME anchor a real break already uses, and
       deliberately the same approximation rather than a saturation curve the
       tick does not carry (see the plan in docs/). It is reachability, not a
       stored run list, so shutting every valve between the core and the vessel is
       exactly as disconnected as cutting the line. Level already behaved:
       netExpSurge() has always returned zero with no surge line. */
    const pzrOn = pzrLive(P.net, s);
    const Pdem = pzrOn
      ? P.P0 + (s.Tavg-P.Tref)*(0.17/P.pzrK)*(P.P0/15.5)*P.pRise + (inj>0?0.5*P.pRise:0)
      : P.Pcont;
    s.P += (Pdem-s.P)*(0.30/P.pzrK)*(pzrOn?pzrAuth:1)*dt;
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
    for(const fid of reliefPriIds()){
      const set=reliefSet(fid);
      if(!s.reliefOpen[fid] && porvLive(fid) && s.P > reliefRefP(fid)*set.lift){
        s.reliefOpen[fid]=true; s.reliefAuto[fid]=true;
        s.reliefStuck[fid] = s.reliefArm[fid] || roll(s,"porvStick");
        s.reliefArm[fid]=false;
      }
      if(s.reliefOpen[fid] && s.reliefAuto[fid] && !s.reliefStuck[fid] && s.P < reliefRefP(fid)*set.reseat){
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
    if(tankSide(id) !== "primary") continue;
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
    /* CHARGED PER GENERATOR, not off the aggregate: what costs release is the
       share of the leak coming out of tubes that hold the core's own water
       (sgActive()), and a plant can have one generator behind an exchanger and
       one not. The whole leak still comes off inventory above. */
    let hot = 0;
    for(const k in s.sgtrBy) if(sgActive(k.slice(5))) hot += s.sgtrBy[k];
    if(hot>0) s.release = Math.min(100, s.release + (hot/0.30)*0.02*P.dose*dt); }
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
  /* WHAT IS LEFT OF THE INVENTORY IS WHERE THE STEAM IS. A fixed volume that
     has lost mass is a mixture, and the void fraction of that mixture falls
     straight out of the two densities: (1 - m/m0)/(1 - rvl). The typed
     (95-inv)/25 said the same thing with the wrong slope and a 5 % dead band,
     and it could not say that a depressurising loop voids further for the
     same mass lost - which is exactly what rvl carries. */
  const vLeak = Math.max(0,(1-s.inv/100)/Math.max(1-satRvl(s.pCore),1e-3));
  const nod = coreStep(s,dt,heat,sat,vLeak,mflux,flowFrac);
  s.voidTh = s.vNode;
  /* A MEASUREMENT OF THE FIELD, plus the one thing the field cannot say. The
     node void already carries vLeak (coreStep floors every node on it), so the
     two used to be added to each other on top of that - a third opinion about
     the same steam. What is left is the OVERSHOOT: a node fraction stops at 1
     and vLeak runs past it on purpose, because s.vf is what says how far past
     empty the loop is. */
  s.vf = clamp(Math.max(vLeak, s.voidTh), 0, 1.6);

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
  const ids = sgIds();
  for(const id in s.sglBy) if(!sgW.hasOwnProperty(id)) delete s.sglBy[id];
  for(const id in s.fregBy) if(!sgW.hasOwnProperty(id)) delete s.fregBy[id];
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
  /* A pump does not run cleanly to the last drop. That taper is HOT_NPSH,
     and it lives in the pump's own HEAD (feedDrive, pipenet.js) rather than
     as a ceiling here - see the delivery below for why a ceiling costs the
     books. This is the SECOND way to lose feedwater; the first is the pump
     itself and the third is the switchboard.
     A reserve is open only if its own rule says so, and only if that rule has
     not been bypassed on that tank - tankOpen() asks both. */
  const resOpen = res.filter(id=>tankOpen(s,id));
  /* ── WHAT THE FAR END WILL SWALLOW ──
     The governor is a stop valve, not a wish: what passes it goes as the shell
     pressure behind it, so a shell that blows down passes less and recovers.
     Steam that cannot reach a sink at all passes nothing - which is one
     question (secCircuitOf, off the drawing) and not a factor on the heat.
     condFrac is the other end of the same sentence: a drowned condenser cannot
     take it either. Neither stops the boiling any more; both back it up. */
  /* A BROKEN OR UNPIPED TURBINE PASSES NO STEAM. That is the same deletion the
     heat side just made: the flag leaves the output path and becomes a stop
     valve, so the steam backs up behind it instead of vanishing. The dump goes
     round the turbine straight to the condenser, so it does not care. */
  const passK = clamp(roleAlive("turb",s.dmgParts)*turbPiped(), 0, 1);
  const perSG = Math.max(1, ids.length);
  const swWork = s.load*passK*P.swallow/perSG;
  const swDump = dump*P.swallow/perSG;
  /* ── A HOLE IN THE EXHAUST BREAKS THE VACUUM, IT DOES NOT VENT A SHELL ──
     condP() carries it (exhOpen(), above), so the enthalpy drop, the stop
     valve and the MWe readout all price the same backpressure. What still
     crosses the turbine goes to the room instead of to the hotwell (`retK`
     below), so the condensate does not come back either. */
  const pCond  = condP(s);
  /* ── THE SHELL'S RELIEF VALVES, AND THEY ARE PLACED BOXES ──
     Identical machine to the primary's: its own bore, its own set point, its
     own stick-open die, its own block valve, its own bypass. The ONE thing
     that differs is the question it asks - a valve lifts on the pressure where
     it was DRAWN, and shellsOf() answers that off the drawing. A valve on a
     common header protects every shell it reaches, which is what a header is.
     It discharges to atmosphere. The steam side carries no solved hydraulics,
     so piping one into a tank would be inventing a flow path this solver
     cannot price - named in the gaps rather than faked. */
  const secVent = {};                     // per shell: [{fid, cap}], kg/s each valve offers
  for(const id in s.reliefSteam) delete s.reliefSteam[id];
  for(const fid of reliefSecIds()){
    const shells = shellsOf(fid), set = reliefSet(fid), pk = reliefAtP(s,fid);
    if(!s.reliefOpen[fid] && porvLive(fid) && pk > reliefRefP(fid)*set.lift){
      s.reliefOpen[fid]=true; s.reliefAuto[fid]=true;
      s.reliefStuck[fid] = s.reliefArm[fid] || roll(s,"porvStick");
      s.reliefArm[fid]=false;
      logE("warn",nameOf(fid)+" LIFTED",
        "Shell pressure reached this valve's set point and it is passing steam to atmosphere. The water going with it does not come back.");
    }
    if(s.reliefOpen[fid] && s.reliefAuto[fid] && !s.reliefStuck[fid]
       && pk < reliefRefP(fid)*set.reseat){
      s.reliefOpen[fid]=false; s.reliefAuto[fid]=false;
    }
    s.reliefSteam[fid]=0;
    if(!s.reliefOpen[fid] || s.reliefBlocked[fid]) continue;
    /* Sized off its OWN bore against its OWN lift point, so the capacity is a
       property of the valve the player bought and not a plant-wide number. */
    const b = fitBore(fid), span = Math.max(0.05, reliefRefP(fid)*set.lift-P.Pcont);
    for(const id of shells)
      (secVent[id]||(secVent[id]=[])).push({fid, cap:
        SG_RELIEF_CAP*ratedSteam()*b*b*Math.max(0, secP(s,id)-P.Pcont)/span});
  }
  /* ── A SEVERED STEAM LINE IS AN OPENING ON THE SHELL BEHIND IT ──
     Same shape as a valve's capacity and deliberately so: a hole passing
     steam is what a relief valve is, minus the set point and minus the
     reseat. It is priced against the shell's DESIGN pressure because a hole
     has no lift point of its own, and off the RUN's bore, so a severed main
     steam line dumps more than a full-bore valve and a small tap dumps less.
     Kept out of secVent because that list is split back over the valves that
     earned it (s.reliefSteam, per fitting) and a hole is no fitting - it
     raises the shell's total capacity and nothing prints it as a valve.
     WHY HERE AND NOT IN THE NETWORK: the steam side carries no solved
     hydraulics, so the mass is taken where its pressure actually lives. */
  const secHole = {};                     // per shell: kg/s the holes on it offer
  for(const bk of (P.net.steamBreaks||[])){
    if(bk.exh || !bk.cells.some(([x,y])=>cellBroken(s,x,y))) continue;
    const span = Math.max(0.05, sgDesignP()-P.Pcont);
    for(const id of bk.shells)
      secHole[id] = (secHole[id]||0) + SG_RELIEF_CAP*ratedSteam()*bk.bore*bk.bore
                                       *Math.max(0, secP(s,id)-P.Pcont)/span;
  }
  let boiled = 0, fedTot = 0, fedCirc = 0, fedRes = 0;   // kg/s, summed for the mass balance below
  let sgVented = 0, workKW = 0;                          // relief valves, and shaft work
  for(const id in s.sgTBy)  if(!sgW.hasOwnProperty(id)) delete s.sgTBy[id];
  for(const id in s.sgBurst) if(!sgW.hasOwnProperty(id)) delete s.sgBurst[id];
  for(const id in s.steamBy)  delete s.steamBy[id];
  for(const id in s.steamTo)  delete s.steamTo[id];
  for(const id in s.steamWk)  delete s.steamWk[id];
  for(const id in s.sgVentBy) delete s.sgVentBy[id];
  if(ids.length) for(const id of ids){
    /* THIS MACHINE'S OWN SECONDARY WATER. Hoisted out of the loop it made a
       mixed fleet integrate every level against the first machine's charge -
       the once-through unit would never have run dry. */
    const M = sgMassOf(id); if(M<=0) continue;
    if(s.sglBy[id]===undefined) s.sglBy[id]=SGL_SET;                 // a generator placed mid-run starts full
    if(s.sgTBy[id]===undefined) s.sgTBy[id]=tsatSec(secPTarget(s,id));
    if(s.sgBurst[id]===undefined) s.sgBurst[id]=false;
    const lvl = s.sglBy[id];
    /* WHAT THIS MACHINE IS RAISING, and WHAT ACTUALLY LEAVES IT. The gap
       between them is trapped steam, and trapped steam is what the shell
       temperature below integrates - the whole of the bug this replaces. */
    const steamOut = (sgQBy[id]||0)/H_FG;                            // kg/s raised in THIS generator
    const shellP = secP(s,id);
    /* ── AND IF NOTHING WAS FITTED TO TAKE IT, THE SHELL TAKES IT ──
       There is no lid that is not a placed box. Past this the shell is open to
       atmosphere: it flashes off what is in it, stops raising steam pressure
       at all (secP, pipenet.js, reads the same latch) and stops being a heat
       sink as it empties. Latched. */
    if(!s.sgBurst[id] && shellP > sgBurstP()){
      s.sgBurst[id]=true;
      logE("alarm",nameOf(id)+" SHELL BURST",
        "The secondary shell has ruptured. It was raising steam faster than anything fitted could get rid of, and nothing was fitted to get rid of it. What is in it is going to atmosphere, it will not hold pressure again, and it stops cooling its loop the moment it is empty.");
    }
    /* WHAT A STOP VALVE PASSES, off the pressure across it. Mass goes as the
       pressure BEHIND it, and stops when the pressure in front catches up -
       which is what makes a condenser losing its vacuum back the steam up
       instead of costing an efficiency factor. Nowhere to send it at all
       (secCircuitOf, off the drawing) passes nothing. */
    const gate = (sgSteams(id) && !s.sgBurst[id]) ? Math.sqrt(Math.max(0,
      1-Math.pow(clamp(pCond/Math.max(shellP,1e-4),0,1),2))) : 0;
    const ratio = shellP/sgDesignP();
    const steamWk = Math.max(0, swWork*ratio*gate);
    const steamTo = steamWk + Math.max(0, swDump*ratio*gate);
    /* WHAT ITS OWN VALVES ARE PASSING, and never more water than is in there.
       Both the mass and its latent heat leave the balance, so a generator held
       on its valves uncovers its own tubes - which is the accident that makes
       the valve worth having, and the reason it is not free.
       A BURST SHELL IS AN OPENING, not a valve: it dumps at the same scale a
       full-bore valve would and does not reseat. */
    let cap = 0; for(const v of (secVent[id]||[])) cap += v.cap;
    if(s.sgBurst[id]) cap = SG_RELIEF_CAP*ratedSteam();      // a hole, not a valve
    cap += secHole[id]||0;                                   // a severed steam line is another
    const vent = Math.min(cap, lvl/100*M/Math.max(dt,1e-9));
    /* WHAT EACH VALVE IS ACTUALLY PASSING, not what it offered - the shell can
       only give up the water that is in it, and the panel has to print the
       number the tick caused. */
    if(cap>0) for(const v of (secVent[id]||[]))
      s.reliefSteam[v.fid] += vent*v.cap/cap;
    s.steamBy[id]=steamOut; s.steamTo[id]=steamTo; s.steamWk[id]=steamWk;
    s.sgVentBy[id]=vent;
    workKW += steamWk*turbDh(shellP,pCond)*P.eff;
    /* ONE feed controller. Both pools answer to it - an emergency feed pump is
       a feed pump - so what a reserve delivers is what THIS generator is
       short, drawn against what is actually left in the reserve, rather than
       a flat fraction of rated steam that scaled with a number the tank has
       never had anything to do with. */
    const want = Math.max(0, steamOut + (SGL_SET-lvl)/100*M/FEED_TAU);
    /* ── THE FEED REGULATING VALVE IS AN ACTUATOR ──
       `want` is the DEMAND; what this generator's own shell edge actually
       carried this tick is the ACTUAL, and the valve is walked between them.
       Fed forward, like s.cavP and s.sgShare: this tick's answer sets next
       tick's valve, because a gate that depends on the answer cannot be part
       of the question. Nothing here writes flow - it writes a valve, and the
       network decides what that is worth.
       The error is RELATIVE to what this machine is boiling off, so one gain
       serves a 55 t recirculating unit and a 7 t once-through one; against an
       absolute kg/s error the same gain would be violent on the small
       machine. FREG_SPAN floors the denominator so a generator asking for
       nothing does not divide by zero. Rate-limited by FREG_RATE, which is
       what makes it a valve rather than an algebraic answer. */
    const fed = invRate((netOut.sgFeedBy && netOut.sgFeedBy[id]) || 0)/100*loopKg();
    if(s.fregBy[id]===undefined) s.fregBy[id]=0;
    if(autoLive("feed")){ const e = (fed - want)/Math.max(want, FREG_SPAN);
      s.fregBy[id] = clamp(s.fregBy[id] + clamp(e,-1,1)*FREG_RATE*dt, 0, FREG_MAX); }
    /* ── WHAT ARRIVES IS THE SOLVED FLOW, NOT THE DEMAND ──
       `want` is what the controller asked for; this is what the network
       actually carried, and the two agree only when nothing is in the way.
       A damaged pump and a blackout are already IN the head (feedDrive,
       pipenet.js), so they arrive here as less flow rather than as a
       fraction applied to the answer - the same argument s.cavP makes for a
       coolant pump.
       NO CEILING IS APPLIED HERE, and that is load-bearing: a ceiling would
       discard mass the solve had already moved and the secondary's books
       would stop closing (measured, 4365 kg in fifteen seconds). Every way of
       running out is in the HEAD instead - a hit pump, a dead switchboard, a
       suction pool going empty (feedDrive, pipenet.js) - and a reserve tank
       limits itself, because it is a fixed node whose own edge shuts when it
       is dry. Negative is a generator draining backwards up its own feed
       line: real, and the level integral's business. */
    /* Liquid leaves as steam that GOT AWAY, plus whatever the valve blew off.
       Steam raised into a closed shell is still in the shell. */
    const outKg = steamTo + vent;
    /* A FULL SHELL TAKES NO MORE. The clamp used to swallow it: feedwater kept
       arriving into a generator already at 100 %, and the sensible heat below
       kept charging against water that was not there - so a generator with
       nowhere to send steam went on being cooled by an infinite supply of cold
       water. What does not fit does not arrive. */
    const raw = lvl + 100*(fed-outKg)/M*dt;
    s.sglBy[id] = clamp(raw, 0, 100);
    const fed_ = fed - (raw - s.sglBy[id])*M/100/Math.max(dt,1e-9);
    /* ── THE SHELL'S OWN ENERGY BALANCE ──
       In across the tubes, out with the steam that left, and the sensible heat
       of the water that is NET accumulating - what boils is already charged
       through H_FG, which spans feedwater to steam, so charging it twice would
       cool a healthy generator for nothing. Pressure is what saturation says
       about this temperature (secP, pipenet.js), not a formula about load. */
    const C = Math.max(1, sgHeatCap(s,id));
    const qFeed = (fed_-outKg)*CP_W*(s.sgTBy[id]-T_FEED);
    /* An OPEN pot boils at the room's pressure, whatever is still crossing the
       tubes into it - which is why a burst shell is a violent cooldown first
       and no heat sink at all a few seconds later, once it is dry. */
    s.sgTBy[id] = s.sgBurst[id] ? tsatSec(P.Pcont)
      : Math.max(T_FEED*0.5,
          s.sgTBy[id] + ((sgQBy[id]||0) - outKg*H_FG - qFeed)/C*dt);
    boiled += steamTo; fedTot += fed_; sgVented += vent;
    /* A ruptured generator on its safety valve is putting primary water in the
       sky. Charged at the SGTR scale already used below, times the share of
       this machine's steam that is going overboard rather than to the
       condenser - clean unless these tubes are the ones that failed, and clean
       anyway behind an intermediate exchanger (sgActive()), where what crossed
       into this shell was never the core's water. */
    if(vent>0 && sgtrLive(s,id) && sgActive(id)){
      const shr = vent/Math.max(steamTo+vent,1e-9);
      s.release = Math.min(100, s.release
        + shr*(Math.max(0,s.sgtrRate)/SGTR_RATE)*0.02*P.dose*dt); }
  }
  /* What the condenser has to get rid of: everything that reached it, less the
     work the shaft took out. LAGGED, the same argument s.coreDT carries: this
     tick's backpressure is priced off it and it is priced off this tick's
     steam, so fed straight forward the two ring against each other tick by
     tick (measured: a destroyed condenser oscillated between passing rated
     steam and none). COND_TAU is the shell and tubes it has to warm up first,
     which is why the lag is a property and not a filter. */
  /* WHAT ACTUALLY GOT BACK. Steam crossing a turbine that is exhausting to
     the room reaches neither the condenser nor the hotwell - so the pot has
     nothing to reject and the pool has nothing to return. Plant-level,
     because the condenser IS one pot and pCond one backpressure: a plant with
     two turbines and one exhaust cut loses both. Named in the gaps. */
  const retK = exhOpen(s) ? 0 : 1;
  { const qIn = Math.max(0, boiled*retK*H_FG - workKW);
    s.condT += (qIn - condRej(s))/Math.max(1, condCap_())*dt;
    s.condT = clamp(s.condT, T_CW, 900); }
  /* WHICH POOL PAID FOR IT. The reserve's share is its own tanks' solved
     outflow - the same qTankBy every primary tank is already charged through,
     asked of the secondary ones for the first time - and the circuit paid for
     the rest. Split at plant level rather than per generator: a shared header
     genuinely does mix them, and there is no per-generator answer to give. */
  { let k=0;
    for(const id of resOpen) k += Math.max(0, invRate((netOut.qTankBy && netOut.qTankBy[id])||0)/100*loopKg());
    fedRes = k; fedCirc = fedTot - fedRes; }
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
    const netKg = boiled*retK - fedCirc + sgtrKg - spillSecKg;
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
  s.dnbr=marginCore(s,heat,sat);

  /* ── damage: the consequences, not the integration ──
     s.dmg, s.meltFrac, s.oxMax and s.h2 were all settled by coreStep() above,
     node by node. What is left here is what a hurt core COSTS, and every one
     of these is continuous in how much of the core is hurt rather than a step
     on a latch: a core 3 % molten and one 90 % molten used to pay the same
     inventory, the same fatigue and the same release. */
  if(!s.melt && s.meltFrac>=MELT_LATCH){ s.melt=true; s.trip="CORE MELT"; }
  if(s.meltFrac>0 && !P.catcher){
    s.inv-=MELT_INV*s.meltFrac*dt;
    s.fatigue=Math.min(100,s.fatigue+MELT_FAT*s.meltFrac*dt); }
  { const st=fuelStages(s); let rel=0;
    for(let q=0;q<FAIL.length;q++) rel+=st[q]*RELK[FAIL[q].k];
    if(rel>0) s.release=Math.min(100,s.release+rel*P.contRel*P.dose*dt); }

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
  // naming the machines means the verb has to agree with how many there were
  const isAre = ids => ids.length>1 ? "are" : "is";
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
    ()=>"Water arriving at "+(cavIds.length?nameList(cavIds):"the pumps")+
        " is close to boiling, so "+(cavIds.length>1?"they are":"it is")+
        " churning vapour. Real flow is far below the bench setting.");
  ev("flowfloor",flowDemPri(s)<P.flowMin,"warn","PUMPS ORDERED BELOW DESIGN FLOOR",
    ()=>"Flow demand is under the "+(P.flowMin*100).toFixed(0)+"% floor the pumps were built for. The protection system trips on LOW FLOW here. Defeat it and the core keeps running on buoyancy alone.");
  ev("hip",s.P>P.P0*1.05,"warn","PRIMARY OVERPRESSURE",
    ()=>"Loop pressure above 105% of nominal. The relief valve lifts at 106%, and the vessel bursts near "+burst.toFixed(1)+" MPa.");
  ev("porv",reliefAnyOpen(s),"warn","RELIEF VALVE PASSING",
    ()=>{ const open=reliefFitIds().filter(id=>s.reliefOpen[id]&&!s.reliefBlocked[id]);
      return nameList(open)+" "+isAre(open)+" open and venting. If nobody commanded it, primary coolant is leaving the loop."; });
  ev("stuck",reliefAnyStuck(s),"alarm","PORV FAILED TO RESEAT",
    ()=>nameList(reliefFitIds().filter(id=>s.reliefStuck[id]))+
        " lifted on overpressure and did not shut again. Pressurizer level will read HIGH while the loop empties. Close its block valve.");
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
  ev("inj",injIds.length>0,"info","INJECTING",
    ()=>nameList(injIds)+" "+isAre(injIds)+" pushing water into the loop at "+
        s.injRate.toFixed(2)+" %/s, and cold shock is ageing the vessel while it runs.");
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
  /* A RATIO, not a threshold: the moment the metal makes more heat than the
     chain reaction does is the moment nothing on the plant can turn it off,
     and it is the TMI and Fukushima moment. Stated against fission power, so
     it self-scales across every plant size on the bench rather than pinning a
     megawatt figure a small core could never reach. */
  ev("ox",s.qOx>s.n*PROMPT_F,"alarm","CLAD OXIDATION SELF-SUSTAINING",
    ()=>"Steam is burning the cladding faster than the reactor is making heat: "+
        (s.qOx*100).toFixed(1)+"% of rated against "+(s.n*PROMPT_F*100).toFixed(1)+
        "% from fission. Nothing on this ship switches that reaction off - it stops when the metal is gone.",1);
  ev("h2",s.h2>H2_EV,"alarm","HYDROGEN IN THE PRIMARY",
    ()=>"Over "+H2_EV+" kg of hydrogen has come off the cladding. It is not modelled as burning, but it is not water and it does not carry heat.",1);
  ev("melt",s.melt,"alarm","CORE MELT",
    ()=>"A quarter of the fuel is molten and "+s.dmg.toFixed(0)+"% of the cladding has failed. Unrecoverable.",1);

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
  /* THE THREE RUNS WITH A CORRELATION OF THEIR OWN became TWO. `feed` is gone
     from here: feedwater is a solved flow through a real pump now, so the
     packets on it move on that run's own answer like every hot leg's do, and
     driving them off s.load was the animation showing a rate the sim was not
     performing - the exact fault audit-text.js already pins against the vent
     plume. hpi and surge keep theirs because both are tagged hot/cold for
     BUOYANCY rather than for circulation, so their tagged flow is not what
     the pipe carries. */
  const PIPE_CORR={hpi:1,surge:1};
  /* AND STEAM AND EXHAUST GET THEIR RATE BACK. They stood still for as long as
     nothing solved one; step() solves a kg/s per generator now, so the packets
     run on it - normalised on steamScale(), which is the same figure the meter
     prints as its full scale. This is a THERMAL rate, not a hydraulic one: the
     steam runs still carry no solved pressure drop, and that is a different
     claim from the one being made here. */
  /* SIGNED, so the packets run the way the steam does and not the way the key
     happens to read - see steamDir(). */
  const steamRun = key => {
    const k = P.net.byKey[key].k, ends = runEnds(key,k);
    if(!ends) return 0;
    let q = 0;
    /* A STEAM RUN THAT REACHES A FITTING IS A RELIEF BRANCH, and what it
       carries is what that generator is VENTING - not the whole of what it
       raised, which is what reading the same book as the main steam line
       would have it claim. */
    const book = ends.some(n=>isFitting(n.slice(0,-1))) ? s.sgVentBy : s.steamTo;
    if(k==="exh"){ for(const id in (s.steamTo||{})) q += s.steamTo[id]; }
    else for(const n of ends){ const id=n.slice(0,-1);
      if(book && book[id]!==undefined){ q = book[id]; break; } }
    return q*steamDir(key,k);
  };
  for(const key in d){
    const r = P.net.byKey[key];
    if(!r) continue;                           // a design change left a stale key
    if(r.k==="steam"||r.k==="exh"){
      d[key] += sp*1.4*steamRun(key)/Math.max(1e-6, steamScale(r.k));
      continue;
    }
    if(PIPE_CORR[r.k]){                        // DEFAULT: see the comment above
      d[key] += r.k==="hpi" ? hpiFlow : surgeFlow;   // DEFAULT: which correlation
      continue;
    }
    let tag=0;
    for(const ed of P.net.edges) if(ed.key===key) tag = tag||P.net.tag[ed.u]||P.net.tag[ed.v];
    /* HAVING A SOLVED REFERENCE is the test, not carrying a temperature tag.
       KIND_TEMP is about BUOYANCY and deliberately says nothing about the
       secondary (see its own comment), so gating the animation on it left the
       feedwater line - which has a real reference and a real solved flow -
       falling through to a made-up rate. `wet` is a PRIMARY inventory factor
       and only a primary run owes it. */
    if(tag || P.netRefByRun[key]!==undefined){
      /* the run's OWN solved flow, with no correlation floor under it -
         buoyancy is already in that solve, so a plant on natural circulation
         still visibly moves water and a plant with a valve shut in the line
         visibly does not. Every key here is a RUN now - a fitting's own edge
         is inside its box and has no polyline to animate. */
      d[key]+=sp*P.flowK*runRatio(key)*(tag?wet:1)*1.4;
    }
  }
  s.spin=(s.spin+360*dt*mflux)%360;
  /* the turbine's own shaft angle. It is on S beside the pump's for the same
     reason the pump's is: an angle integrated in the renderer would keep
     turning while the sim is paused, and would not replay. Driven by LOAD -
     the pumps answer flow, the turbine answers the draw. */
  s.spinT=(s.spinT+360*dt*Math.min(s.load,1.5))%360;
  nodeGraphHold(false); pipeMapHold(false);
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
  "A quarter of the fuel is molten. Unrecoverable. Reset the plant.","core"],
 /* appended after every existing entry so no earlier tile's index moves.
    Reads s.doseRate, the LIVE field at the crew's own seat - not P.dose,
    the as-built figure the bench quotes. What lit it is both what has
    FAILED (a release, a melt, a stuck relief valve venting past
    containment) and where the shielding was actually PLACED at the bench:
    the same layout that reads comfortable at rest can read this the moment
    the core starts shining, because nothing about the geometry changed,
    only the source term did. */
 /* A shell above the set point, whether or not anything was fitted to answer
    it - which is exactly the case worth being told about, because on that
    plant the next thing that gives is the shell. */
 ["HI STEAM PRESS","red",s=>sgIds().some(id=>secP(s,id)>sgLiftP()),
  "A steam generator is over its design shell pressure. If a relief valve is fitted it is passing steam to atmosphere, and the water going with it is not coming back. If one is NOT fitted, the shell bursts at 1.5x design. Find what is stopping the steam: a shut steam line, a drowned or isolated condenser, or a turbine that is not passing.","sg"],
 ["SG SHELL BURST","red",s=>sgIds().some(id=>s.sgBurst&&s.sgBurst[id]),
  "A secondary shell has ruptured. It is open to atmosphere, it will not hold pressure again, and it stops cooling its loop the moment it is empty. If those tubes were leaking, what is going out of the hole is primary water.","sg"],
 /* The two steps of boiling a shell dry, on the same numbers the mimic's own
    banner and the removal term read. Plant-wide, like every other row here:
    the lamp says "here", the board says "what". */
 ["SG LEVEL LO","amber",s=>sgIds().some(id=>sgLvl(s,id)<SG_DRY),
  "A steam generator is below "+SG_DRY+"% and its tubes are starting to uncover. That generator is losing its grip on the core. Feed it - check the feed pump, the regulating valve and the hotwell before you assume the pump has failed.","sg"],
 ["SG DRY","red",s=>sgIds().some(id=>sgLvl(s,id)<SG_DRY_LO),
  "A steam generator is below "+SG_DRY_LO+"%. Most of the bundle is in steam and that loop is not cooling the core any more. If every generator reads this, the only heat sink left is what leaks out of the boundary.","sg"],
 ["HOTWELL FULL","red",s=>condFrac(s)<1,
  "The hotwell is above "+HOT_FLOOD+"% and the water in it is drowning the tubes that do the condensing. The condenser is losing capacity as it fills, so backpressure rises, the turbine takes less steam, and the shells pressurise behind it. Drain it or stop putting water into it.","cond"],
 ["ROD AT LIMIT","amber",s=>s.rodBand,
  "The automatic rod controller is asking for rod travel the commissioned band will not give it, and coolant temperature is off programme because of it. It has no authority left in that direction. Move load, move boron, or widen the band at the design bench - the band is not a safety limit, it is how much room the controller was given.","rods"],
 ["NEAR TRIP","amber",()=>!!tripNear(),
  "A protection setpoint is within "+(RPS_NEAR*100).toFixed(0)+"% of tripping the reactor. The component itself names which one. This is a warning, not the trip: nothing has latched yet and the condition is still yours to clear.","core"],
 ["HI AREA RAD","amber",s=>s.doseRate>RAD_HI,
  "The control room is reading above 1x background. That number is set both by what has failed on the plant and by where you put the shielding at the bench - a well-shielded control room can sit this out through a release that would light this tile instantly on a poorly sited one. A repair party out on the plant right now is being spent while this is lit, faster the closer the job sits to whatever is shining.","ctrl"],
 /* Appended at the very end, after every existing entry, because help.js
    numbers the tiles by array index - inserting these beside FUEL DMG where
    they belong by subject would renumber every tile from 3 onward. */
 ["CLAD OXIDATION","red",s=>s.qOx>0&&s.qOx>s.n*PROMPT_F,
  "Steam is burning the zirconium cladding, and it is now making more heat than the chain reaction is. This reaction feeds itself: the hotter the metal gets the faster it burns, and no rod, no pump and no valve on this ship stops it. It ends when the cladding is gone. It also makes hydrogen.","core"],
 ["FUEL MELT","red",s=>s.meltFrac>0,
  "Fuel pellets somewhere in the core are liquid. This is past cladding failure - the fuel itself has gone, and the damage map on the reactor panel says which part of the core. CORE MELT latches when a quarter of it is molten.","core"],
/* one tile per defeated automatic system, built from the same table the sim uses */
].concat(AUTOKEYS.map(k=>[AUTOSYS[k].ann,"amber",AUTOSYS[k].lit||(s=>autoFit(k)&&s.byp[k]),
  AUTOSYS[k].name+" is switched off at the panel. "+AUTOSYS[k].warn,
  /* LAZY, because a host that is read off the drawing cannot be resolved
     while this table is being built - LAY does not exist yet. annHost()
     below is the one place a row's host is turned into an id. */
  ()=>autoPart(k)]));

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
const annHost = h => typeof h==="function" ? h() : h;
/* IS THIS NAMED TILE LIT. The mimic shouts some of these across the component
   they belong to, and a banner drawn off its own copy of the threshold is a
   second protection system that drifts from the board silently. One reader,
   one predicate, so the box and the tile are the same claim. */
const annLit = name => { const a=ANN.find(r=>r[0]===name); return !!a && !!a[2](S); };
function annLamp(id){
  let best=null;
  for(const a of ANN){
    const host = annHost(a[4]);
    if(!host || !id.startsWith(host) || !a[2](S)) continue;
    if(a[1]==="red") return C.red;
    if(a[1]==="amber") best=C.amber;
    else if(!best) best=C.blue;
  }
  return best;
}
