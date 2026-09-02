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
     aF:a.aF, aM:d.aM, aV:d.aV, aX:d.aX, aS:d.aS, pwrDef:d.pwrDef, P0:d.P0, tsat0:a.tsat*Math.pow(d.P0/a.P0,.25),
     rated:D.power, dnbr0:d.dnbr, dnbLaw:a.dnbLaw, Fq0:d.Fq, xeW:d.xeW, scram:d.scram,
     /* The trip floor used to be a flat number per PUMPS[D.pumps] tier. It now
        scales with pump capacity actually on the grid: +.15 for every full
        unit of capacity bought beyond the bare minimum (one pump per
        generator), the identical +.15-per-spare progression the old
        three-tier table priced, just read off real components instead of a
        dropdown. sgCount() (layout.js) is the counted number of generators
        on the grid, never a stored D.loops - at the true baseline, one pump
        per generator at default size, corePumpCap() equals sgCount()
        exactly, so this returns the old NO SPARE floor (.30), not the old
        default of .45. corePumpCap() and not totalPumpCap(): this floor is
        about the water going past the FUEL, so a feedwater pump must not
        raise the setpoint of a plant whose core flow it cannot touch.
        graceK no longer carries a per-generator bonus either
        (design.js's own comment says why) - only the coolant/SG term and the
        layout's own inertia, and the SG half of it is sgInertiaK(), the one
        helper derived() reads too. */
     excess:d.excess, flowMin:clamp(0.30+0.15*(corePumpCap()-sgCount()),0.15,0.75),
     graceK:Math.pow(a.grace*sgInertiaK(),.6)*L.inertiaK,
     noise:CHAN[D.chan].noise, id:a.id, name:a.name,
     eff:d.eff, loadMax:d.loadMax, condCap:d.condCap,
     condK:f.condK, pzrK:holdDampK()*L.pzrK,
     flowK:L.flowK, dose:L.dose, radK:L.radK, bypass:condDumpMean()/Math.max(1e-9,plantSteam()),
     rps:D.rps, rpsm:D.rpsm, autorod:D.autorod, arLo:D.arLo, arHi:D.arHi, rodRate:D.rodSpd,
     /* IS THERE A VESSEL FOR THE FUEL TO BE IN. The lattice is drawn on its
        own surface, so D.power and every reactivity term above exist whether
        or not a reactor stands on the arrangement grid - see the kinetics
        block in step(). */
     vessel:!!roleOf("core"),
     catcher:LAY.parts.some(p=>p.role==="catcher"), contRel:LAY.parts.some(p=>p.role==="cont")?CONT[D.cont].rel:1, backup:BKP[D.bkp].bk,
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
  P.sat   = {p0:P.P0, T0:P.tsat0, n:coolSatN(a), pFloor:.05, hfg:a.hfg, cp:CP_W};
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
  // the same net with every bore at its own nominal - the frame P.netRef is
  // taken in, and the only thing that differs between the two
  P.netNom = withNomBore(() => netBuild());
  P.netRefByLoop = {};
  P.netRefByRun  = {};
  /* ══ AND THE SECONDARY'S REFERENCE IS NOT A WIDE-OPEN VALVE ══
     A feed regulating valve commissions wide and walks itself shut against
     the level it is holding, so a reference taken with it wide open prices
     the condensate line at what the pump can push through an unregulated
     train - 1151.6 kg/s on the stock plant, for a pipe that carries 646. The
     kilograms were right and the "% of rating" was not.
     Taken instead at the flow the plant is BUILT to feed, by walking the same
     valve the controller walks against the same solve. Only the secondary
     moves: a regulating head sits on a shell edge and the primary shares no
     node with it, so P.netRef - taken off the unregulated solve - is
     untouched.
     ══ AND EVERY PUMP ON ITS OWN CURVE ══
     A head-flow curve (pumpCurve(), pipenet.js) makes a head depend on the
     answer, so the two references close TOGETHER: a pump's swallow is read
     off the REGULATED solve, because that is the plant that commissions, and
     the valve is walked against the head that swallow leaves. Solved apart,
     the feed pump was priced through a wide-open train at 46 times its rating,
     came out with no head at all, and the plant commissioned with a dead feed
     pump. kg/s needs P.netRef, which is why this cannot live inside the solve:
     the conversion is what the solve is computing, so each pass converts on
     its own answer. resetPlant() seeds s.pumpQBy from the result, so tick one
     is the plant that was priced.
     UNDER-RELAXED, because head falling with flow overshoots: a machine past
     runout solves to no head, which solves to no flow, which restores full
     head. Half a step a pass lands it. */
  { const want = ratedSteam()/Math.max(1,sgCount());
    /* SECANT, not a rate-limited walk: the network is LINEAR in head, so one
       generator's flow is affine in its own valve and a handful of passes
       lands on the answer. The controller's own stroke rate is a property of a
       real valve moving in real time and has no business in a design-time
       reference - walked at that rate this cost 1.6 s of commissioning. */
    const fedOf = (outs,id) => invRate((outs.sgFeedBy && outs.sgFeedBy[id]) || 0)/100*loopKg();
    P.pumpQRef = {}; P.pumpQNom = {};
    for(const id of pumpIds()) P.pumpQRef[id] = P.pumpQNom[id] = pumpFlow(id);
    /* THE CIRCULATION REFERENCE IS THE NOMINAL PLANT, never the drawn one.
       Solved on the same arrangement piped at the bore every run and every
       fitting SHIPS at (withNomBore(), pipenet.js), so netFlowK() reads what
       this plant's OWN pipes cost it: re-bore a leg and total/P.netRef leaves
       1. Solved on P.net it was a figure divided by itself and the bore the
       designer set could not reach the physics at all - a cold leg taken from
       750 to 300 mm moved netFlowK by 2e-4.
       ON ITS OWN PUMP DUTY, or the frame is not geometric: a pump sits on its
       curve at the flow it develops, and reading that off the DRAWN plant let
       narrow pipes push the reference itself up 23 %. pumpQNom converges on
       the nominal net exactly the way pumpQRef converges on the drawn one.
       Per RUN the reference stays the drawn plant (P.netRefByRun, below) - a
       meter reads its own line against what that line actually carries. */
    for(let pass=0;pass<20;pass++){
      P.netRefByRun = {};
      const nomRun = {};
      P.netRef = netCoreFrac0(P.netNom, P.netRefByLoop, nomRun, {pumpQBy:P.pumpQNom});
      netCoreFrac0(P.net, null, P.netRefByRun, {pumpQBy:P.pumpQRef});
      const freg = {}, prev = {}, fedPrev = {};
      for(const id of sgIds()){ freg[id] = 0; prev[id] = 1; }
      { const o = {}; netCoreFrac0(P.net, null, null, {fregBy:prev, pumpQBy:P.pumpQRef}, o);
        for(const id of sgIds()) fedPrev[id] = fedOf(o,id); }
      for(let i=0;i<30;i++){
        const o = {}; netCoreFrac0(P.net, null, null, {fregBy:freg, pumpQBy:P.pumpQRef}, o);
        let worst = 0;
        for(const id of sgIds()){
          const fed = fedOf(o,id), slope = (fed - fedPrev[id])/((freg[id]-prev[id])||1e-9);
          worst = Math.max(worst, Math.abs(fed-want)/Math.max(want, FREG_SPAN));
          prev[id] = freg[id]; fedPrev[id] = fed;
          freg[id] = clamp(freg[id] + (Math.abs(slope)>1e-9 ? (want-fed)/slope : 0), 0, fregMax(id));
        }
        if(worst < 1e-4) break;
      }
      P.netRefByRun = {};
      netCoreFrac0(P.net, null, P.netRefByRun, {fregBy:prev, pumpQBy:P.pumpQRef});
      P.fregRef = prev;
      let moved = 0;
      for(const id of pumpIds()){
        const k = pumpEdgeKey(id); if(!k) continue;
        const was = P.pumpQRef[id], now = Math.max(0, netKgs(P.netRefByRun[k]||0));
        P.pumpQRef[id] = was + (now-was)*0.5;
        moved = Math.max(moved, Math.abs(now-was)/Math.max(now, pumpFlow(id), 1e-9));
        const wasN = P.pumpQNom[id], nowN = Math.max(0, netKgs(nomRun[k]||0));
        P.pumpQNom[id] = wasN + (nowN-wasN)*0.5;
        moved = Math.max(moved, Math.abs(nowN-wasN)/Math.max(nowN, pumpFlow(id), 1e-9));
      }
      if(moved < 1e-3) break;
    } }
  /* The cooling circuit's own reference, off the same solve - what this
     plant's circulating water pumps push through its condenser as
     commissioned. 0 is a plant with nothing turning that water, and cwK()
     reads it as no heat sink at all. */
  P.cwRef = cwFlowOf(P.netRefByRun);
  /* ══ AND THE SCALE REFERENCE, FOR A LINE NOTHING HAS CALLED FOR YET ══
     The solve above prices the plant AS COMMISSIONED, which is the right frame
     for the physics and leaves every DEMAND gate shut - a standby tank's rule,
     a relief valve. So the line behind one references exactly 0, runRatio()
     divides by it, and its parcels stand still forever while the sim carries
     real flow through it. Taken once more with those gates open (s.refOpen),
     and copied back ONLY where the line had no scale at all: a run the plant
     genuinely commissions with flow keeps its own figure, so the regulated
     feed reference above is untouched. A cross-tie is not in this - its shut
     position is how the plant is built, not a gate waiting to be asked.
     IT IS THE COMMISSIONED PLANT WITH THE GATE OPEN, and nothing else moved:
     the SAME regulated feed and the SAME pump swallows the block above closed
     on. Left to their defaults the regulating valve stood wide, the feed pump
     re-priced onto the unregulated train, and the EFW line referenced 37305
     kg/s - five times the reactor's own hot leg. */
  { const o = {}; netCoreFrac0(P.net, null, o,
      {refOpen:1, fregBy:P.fregRef, pumpQBy:P.pumpQRef});
    for(const k in P.netRefByRun) if(!P.netRefByRun[k] && o[k]) P.netRefByRun[k] = o[k]; }
  /* ══ AND EVERY RUN'S REFERENCE IN KILOGRAMS ══
     What this run carries as commissioned, kg/s. The meters used to normalise
     every liquid run on P.netRefRun - the mean of the HOT and COLD legs, a
     PRIMARY figure - and multiply it by an invented heat balance on the rated
     power. Measured on the stock plant: every liquid meter read 20 % high, a
     healthy hot leg read 103 % of its own rating, and the condensate line
     drew its packets at a NINTH of the speed of the steam line carrying the
     identical 664 kg/s. Water appeared to stop dead at the condenser.
     A run's own reference is the only honest scale, it is the same rule the
     steam side already keeps, and it deletes the nominal with it. */
  P.netRefKg = {};
  for(const k in P.netRefByRun) P.netRefKg[k] = netKgs(P.netRefByRun[k]);
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

     ══ THE SCALE AND THE CEILING ARE TWO NUMBERS ══
     P.steamRef is what this plant RAISES at 100 % load, kg/s - rated heat,
     limited by what the pipe run and pump head can carry. It is the scale the
     governor's demand is a fraction OF, so s.load = 1 means rated whatever
     turbine is fitted. P.swallow is what the fitted machines can TAKE wide
     open, and it is a ceiling, not a scale.
     They used to be one number because they were assumed equal. Once a turbine
     states its own swallow they are not: fit one twice the size and the plant
     commissioned at 200 % of rated and fell back, because the governor was
     demanding the MACHINE's nameplate instead of the boiler's output.

     The temperature difference is floored: a BWR's secondary sits only a few
     kelvin below its own primary programme, and a plant designed with none at
     all would divide by zero rather than tell anyone. */
  { const n = Math.max(1, sgCount());
    const dT0 = Math.max(5, P.Tref - tsatSec(sgDesignP()));
    /* ══ READ OFF THE DRAWING, NOT OFF THE RATING ══
       Both of these priced a machine's size out of the core's power, which is
       a stand-in for a machine nobody had stated. Every generator carries its
       own UA and every turbine its own swallow now, so P.rated goes back to
       being only the core's rating. The dT0 above is still what the SUGGESTION
       is anchored on, and it is where an untouched plant lands. */
    P.sgUA = totalSgUA()/n;
    /* AND EACH MACHINE'S OWN, because the heat term is per generator and was
       reading the plant MEAN: every shell got the same tubes while the flow
       through them was its own loop's, so the loop carrying 48 % of the water
       put it through 33 % of the tube area and settled over its own safety
       valve. P.sgUA stays the mean - it is what the second stage is priced
       off (P.ihxUA) - and one generator, or n identical ones, read the same
       number from either. */
    P.sgUABy = Object.fromEntries(sgIds().map(id=>[id, sgUAOf(id)]));
    P.steamRef = plantSteam();
    P.swallow  = totalTurbKgs(); }
  /* ── AND THE SAME ANCHOR FOR THE OTHER TWO MACHINES ──
     P.hTurb makes the enthalpy drop across design shell pressure to design
     condenser pressure exactly the feed-to-steam rise, so a turbine at its design point does the
     work P.eff always priced and only backpressure can move it.
     P.condUA is what the condenser you BOUGHT is worth: a unit sized at rated
     duty rejects rated duty at COND_DT0, so duty divides the terminal
     difference and an undersized machine sits hotter for the same heat. */
  P.hTurb   = steamRise()/Math.max(.05, 1-Math.pow(condPDes()/sgDesignP(),TURB_GAM));
  /* ── THE GOVERNOR VALVE, FITTED AT THE SAME ANCHOR ──
     Wide open, at design shell pressure against design backpressure, this
     machine passes exactly what it was bought to swallow. Every departure - a
     shell off its pressure, a condenser losing vacuum, a header throttled - is
     then the vapour network's answer and never a factor applied to one. */
  P.turbKv  = P.steamRef/Math.max(vapW(1, sgDesignP(), condPDes()), 1e-9);
  /* The circulating water flow, as a heat capacity rate: what it takes to
     carry rated rejection away on CW_RISE of temperature rise. It rides the
     condenser slider with everything else the machine is, so eps comes out
     CW_RISE/COND_DT0 whatever was bought and the design terminal difference is
     unmoved - the range is still the duty dividing it. */
  /* The condenser you BOUGHT, in kW/K, summed off the drawing - and the
     circulating water flow that goes with it, rather than the other way
     round. A plant with no condenser has a UA of exactly 0 and no flow. */
  P.condUA  = totalCondUA();
  P.cwC     = P.condUA/Math.log(COND_DT0/(COND_DT0-CW_RISE));
  P.tdmg  = f.tdmg; P.tmelt = f.tmelt;
  /* whether this fluid puts a steam atmosphere on hot clad at all - sodium,
     salt and helium never oxidise a rod, so their whole oxidation path is one
     false here rather than a temperature that happens never to be reached */
  P.oxid  = !!a.oxid;
  /* whether departure from nucleate boiling is a thing that can happen to
     this fluid's fuel at all - see dnbFilmK() */
  P.dryout= a.dnbLaw!=="temp" && !a.fuelInCoolant;
  P.TfRef = P.Tref + a.dTf*P.condK*P.n0/Math.max(P.feff0,.10);
  P.X0    = xeEq(P.n0);                                // xenon equilibrium at that power
  coreConst(P,d);                        // the core as a place: mesh, coupling, rods
  /* the zirconium in the core, kg, MEASURED off the drawing: the rod surface
     coreConst() just computed times the wall thickness that was drawn. Same
     currency the ECR is in, so hydrogen against oxide thickness against
     consumed metal is one identity rather than three estimates. */
  P.cladKg = ZR_RHO*P.aHeat*ROD_CLAD;
  P.dsig = designSig();                 // what this plant was built from
  P.dnbrK = 1; resetPlant();
  /* What THIS plant is subcooled by when nobody has touched it. The vital bar
     scales against it, because subcooling at rest is 22 K on a PWR and 1400 K
     on an HTGR - a fixed scale would peg four of the six architectures full and
     say nothing. P.dnbr0 is the same idea and was already here. */
  P.sc0 = S.sc;
  /* ── AND WHETHER THIS LOOP HAS A STEAM SPACE OF ITS OWN ──
     A pressurizer is a heater programme holding a SUBCOOLED loop; a loop whose
     hot leg is already at saturation does not need one, because it is its own
     steam space and saturation is what sets its pressure. Asked of the plant
     rather than of a family name, and asked of the same measurement P.sc0
     already is: at or above saturation means there is steam in the loop.
     Miles from the sign change on every preset (-12.7 K on a BWR, -4.7 on an
     RBMK, +22 on a PWR, +414 on an SFR), so this is not a coincidence test. */
  P.steam = P.sc0 <= 0;
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
  step(0.02);
  P.dnbrK = P.dnbr0/Math.max(S.dnbr,1e-9);
  /* AT THE FLOW THIS PLANT ACTUALLY CIRCULATES, the pinUA argument again:
     sgUASuggest() prices the tubes at the isothermal flow and the loop runs
     at S.flowNet of it once buoyancy is in - 1.06 on a sodium plant - so an
     untouched generator raised 5 % more steam than its turbine swallows and
     every once-through preset commissioned sitting on its own shell
     safeties. Only a SUGGESTED generator is refitted: a stated kW/K is the
     player's number. AND THROUGH THE FILM THE REST VOID LEAVES: a boiling
     plant's tubes see 1-0.85*vf of their conductance, so BWR/4 raised 91 %
     of its turbine's swallow and rested 3 % under design pressure. */
  for(const id of sgIds()) if(D.sgUA[id]==null)
    P.sgUABy[id] = sgUAOf(id)/Math.pow(Math.max(S.flowNet,.02),UA_FLOW)/(1-0.85*Math.min(clamp(P.vf0,0,1.5),1));
  { const ids=sgIds(); if(ids.length) P.sgUA = ids.reduce((t,id)=>t+P.sgUABy[id],0)/ids.length; }
  /* AND THE GOVERNOR AT THE PRESSURE THE LINE DELIVERS. Fitted at design
     shell pressure it ignored the drawing: the main steam line drops 2-3 %
     on the way, so the shells rested that much over design to push rated
     steam through it, and the pressure-mode dump cracked open on tick one
     (22 % of the bypass on MSRE). Scaled by how far the first rest sat over
     design - choked, the gate passes in proportion to its inlet pressure. The
     HIGHEST shell, because a header is a chain and the farthest shell sits
     highest: scaled on the mean, EPR's fourth generator rested 0.4 % over
     design and the dump passed 3.6 % of rated steam at rest.
     AND BY WHAT THE DUMP IS TAKING: over design the bypass opens on its band
     and absorbs the excess, so the shell reads 0.5 % over while the boilers
     raise 5 % more than the gate swallows - the gate is sized for the whole
     of it. Twice where it has to be: the tube refit above moves the rest the
     gate is read at. */
  { const ids=sgIds();
    for(let r=0;r<3;r++){ let k=0, to=0;
      if(P.turbKv>0) for(const id of ids){ k = Math.max(k, secP(S,id)/sgDesignP(id)); to += S.steamTo[id]||0; }
      k = (k>0 && S.turbWk>0) ? k*Math.max(to,S.turbWk)/S.turbWk : 1;
      if(r>0 && Math.abs(k-1) < 1e-3) break;
      P.turbKv *= k; resetPlant(); } }
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
  rps:{part:()=>roleId("ctrl"),label:"RPS",ann:"RPS BYPASS",name:"PROTECTION SYSTEM",
    fit:()=>autoCfg().rps,
    tip:"Reactor Protection System. Armed, it scrams the core on high flux, low DNBR, high pressure, high fuel temp, low flow, low pressure, core void or low subcooling. Bypass it to run past rated power - and to melt the core.",
    warn:"Automatic trips are defeated. Nothing will shut this reactor down for you."},
  rod:{part:()=>roleId("rods"),label:"AUTO ROD",ann:"ROD AUTO BYP",name:"AUTOMATIC ROD CONTROL",
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
  runback:{part:()=>roleId("turb"),label:"RUNBACK",ann:"RUNBACK BYP",name:"TURBINE RUNBACK",
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
  bkp:{part:()=>roleId("bkp"),label:"BACKUP",ann:"BACKUP PWR BYP",name:"BACKUP POWER",
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
   are on the same board, and a plant whose diesels carry its coolant pumps but
   not its feed pumps was a plant where buying a bigger supply made the
   blackout worse. Read ONCE, into every pump's own speed target below - a
   head that read it again was applying the blackout twice. */
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
  const p = partOf(id);
  return p ? partName(p) : id.toUpperCase();
};
const nameList = ids => ids.map(nameOf).join(", ");
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
const reliefRefP = fid => shellsOf(fid).length ? Math.min.apply(null, shellsOf(fid).map(sgDesignP))
                       : (P ? P.P0 : holdPSuggest(nodeGraph().coreCirc));
/* WHICH SHELLS THIS VALVE CAN ACTUALLY SEE RIGHT NOW. The primary's valve gets
   this for free - its vent is a solved edge and every run edge is gated by
   runPortsOpen() - so a shut port valve stopped the pressurizer's relief and
   did nothing at all to a shell's, which had no way to ask. shellsOf() walks
   the drawing with the shut runs cut out; the classification above stays on
   the drawing alone. */
const shellsLive = (s,fid) => shellsOf(fid, portDead(s));
/* AND THE SAME QUESTION FOR A HOLE. A severed steam line is a relief valve
   with no set point, so it is isolated the same way: the hole sits on the RUN,
   not on a node, and it blows off whichever END still has an open port valve
   and a walk back to the shell. Shut both and the pipe is cut out of the
   plant, which is exactly what a watch shuts a port valve to do.
   bk.shells is the design superset - a shut port can only ever remove one. */
const holeShells = (s,bk) => {
  const dead = portDead(s);
  if(!dead || !bk.ends) return bk.shells;
  const out = [];
  for(const id of bk.shells){ const seen = steamNodesOf(id, false, dead);
    if((!s.portShut[bk.pa] && seen[bk.ends[0]]) || (!s.portShut[bk.pb] && seen[bk.ends[1]]))
      out.push(id); }
  return out;
};
const reliefIso  = (s,fid) => shellsOf(fid).length>0 && shellsLive(s,fid).length===0;
const reliefAtP = (s,fid) => { const sh=shellsOf(fid);
  if(!sh.length) return s.P;
  const live=shellsLive(s,fid);
  /* ISOLATED: the stub between a shut port valve and this valve is fed by
     nothing, so there is no shell pressure standing in it and the valve cannot
     lift on one. Containment is what a dead leg open to its own valve holds. */
  if(!live.length) return P.Pcont;
  let pk=0; for(const id of live) pk=Math.max(pk,secP(s,id)); return pk; };
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
   The top end of the same tank whose bottom end starves the feed pumps - and
   that end is no longer a level at all: a pump losing suction is cavitation,
   measured at the pump (s.cavP), not a taper written about a tank. */
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
   RAD_TDES is the sink it was DESIGNED for. COND_P0 stays as the FLOOR: it is
   the best vacuum the plant can pull, and a condenser with margin sits on it.
   s.condT is fed forward, the same lag s.cavP and s.sgShare carry: what the
   condenser is rejecting comes out of this tick's steam balance, so it cannot
   also be an input to it. */
/* K - THE CANONICAL REFERENCE SINK, and it anchors P.hTurb, P.cwC, P.condUA
   and condPDes() and nothing else. It is NOT the sink the plant has - that is
   s.radTBy, off the panels actually drawn. Point these anchors at a real panel and a
   terrible radiator would move the design point with it and cost nothing.
   Derived backwards from a real turbine figure, never chosen to preserve
   output: tsatSec(TURB_TRIP_P) is 338.6 K, less an 18.6 K working margin puts
   the condenser at 320 K at rated, less COND_DT0 puts the radiator here.
   IT LIVES IN layout.js, beside SIGMA and the panels it sizes: the area a
   panel suggests is read while the arrangement is being built, which is
   before this file has been evaluated at all. */
/* ── AND THE CIRCULATING WATER IS A MACHINE, NOT A RESERVOIR ──
   UA against a constant is the m-dot -> infinity limit of the real exchanger:
   with a finite circulating water flow Q = mdot*CP_W*eps*(condT - RAD_TDES) and
   eps = 1 - e^(-UA/(mdot*CP_W)), and letting the flow grow gives UA*(condT -
   RAD_TDES) back exactly. So the old expression was not wrong, it was the limiting
   case - with no outlet temperature, no pumps and no way to fail.
   CW_RISE is the design temperature rise across a real surface condenser's
   circulating water, and it is the ONE new number: the flow is derived from it
   at commissioning and rides the condenser slider, exactly as the duty and the
   dump already do. At full flow eps is CW_RISE/COND_DT0 by construction, so a
   healthy plant reads the design terminal difference it always did. */
const CW_RISE=10;         // K, circulating water rise at the design point
/* ══ HOW MUCH CIRCULATING WATER IS ACTUALLY MOVING, OFF THE SOLVE ══
   It was `s.blackout ? 0 : 1` - a boolean standing in for a machine. The
   panels were plumbed, the cooling runs solved at a trickle of buoyancy and
   the rejection read full duty anyway, because nothing on this plant turned
   that water. There is a pump in the line now, so this is its own circuit's
   solved flow against the flow the plant commissioned with. A dead pump, a
   blackout, a severed cooling run and a plant that never bought a pump at all
   all arrive here as less flow, never as a factor on the answer.
   WHICH EDGES: the paths through a thermal SINK that hold no condensing
   volume - a surface condenser's water side, asked of ROLE and never of a
   name. A radiator declares one path and no anchor, so it is not one of
   these; it is what the water is being pushed THROUGH. */
const cwKeys = () => { const o=[];
  for(const p of LAY.parts){ const R=ROLE[p.role];
    if(!R || R.thermal!=="sink" || !Array.isArray(R.internal)) continue;
    for(const IN of R.internal) if(!IN.anch) o.push("comp:"+p.id+":"+IN.a+IN.b); }
  return o; };
const cwFlowOf = m => { let f=0; for(const k of cwKeys()) f += Math.abs(m[k]||0); return f; };
/* the solved pressure field, kept on S for next tick's readers (pumpFwd, the
   phase at a node) - REFILLED, never rebuilt */
const keepPField = (s, pf) => {
  for(const k in s.pBy) if(pf[k] === undefined) delete s.pBy[k];
  for(const k in pf) s.pBy[k] = pf[k]; };
/* THE WATER ARRIVING AT THE CONDENSER, off the field the panels have just
   chilled - the inlet face of each circulating water path, read along the
   solved flow's own direction. One expression for the tick and the seed. */
const cwInOf = (s, runFlow) => {
  const R = ROLE.cond, ids = LAY.parts.filter(p=>p.role==="cond").map(p=>p.id);
  let t = 0, n = 0;
  for(const id of ids) for(const IN of R.internal){ if(IN.anch) continue;
    const key = "comp:"+id+":"+IN.a+IN.b, ref = Math.abs(P.netRefByRun[key]||0);
    const r = ref > 1e-9 ? (runFlow[key]||0)/ref : 0;
    t += netTempAt(s, coreFold(id + (r >= 0 ? IN.a : IN.b))); n++; }
  return n ? t/n : undefined; };
const cwK = s => { if(!(P.cwRef>0)) return 0;
  return clamp((s.cwFlow===undefined ? P.cwRef : s.cwFlow)/P.cwRef, 0, 2); };
/* The terminal temperature difference a condenser bought at rated duty runs
   at, K - a real surface condenser figure, and the anchor P.condUA is fitted
   on. It is what gives the machine a RANGE: duty is a divisor here, so a
   half-size unit sits twice as far above the cooling water and pays for it in
   backpressure, and an oversized one runs down onto COND_P0 and stops. */
const COND_DT0=13;
/* The backpressure the plant was DESIGNED for - the design point, not the
   vacuum floor. P.hTurb is anchored here, so a turbine at its design point
   does the work P.eff prices and every departure is the condenser's doing. */
const condPDes = () => psatSec(RAD_TDES + COND_DT0);
/* WHERE THE SINK ACTUALLY DRAWN SITS AT A STATED REJECTION, K - the panels at
   the temperature the fleet sheds it, the tubes' approach off their fitted
   UA, the circulating water's own rise off the condenser's, and the terminal
   difference on top. The commissioning seed and the bench's CONDENSER MARGIN
   are this one expression, so the figure the player reads is the one the
   plant starts at. No panel that sees space: the design sink, as before. */
const condRest = qkW => {
  const t0 = radTAt(qkW), radT = isFinite(t0) ? t0 : RAD_TDES;
  let ra = 0; for(const id of radIds()) ra += radUAOf(id);
  const ua = totalCondUA(), cwC = ua>0 ? ua/Math.log(COND_DT0/(COND_DT0-CW_RISE)) : Infinity;
  const cwIn = radT + (ra>0 ? qkW/ra : 0) - qkW/cwC;
  return {radT, cwIn, condT: cwIn + (ua>0 ? qkW/(cwC*CW_RISE/COND_DT0) : COND_DT0)}; };
/* How much condenser there actually IS right now. Bought capacity, minus what
   is broken, minus tubes drowned in their own condensate. The circulating
   water has LEFT this expression - it is a flow now (cwK, above), on the other
   side of the exchanger, where losing it takes the sink away instead of
   scaling a conductance. It may be exactly 0: nothing divides by it, and a
   wrecked condenser rejecting nothing at all is the answer. */
const condK = s => Math.max(0, roleAlive("cond",s.dmgParts)*condFrac(s));
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
/* A CONDENSER IS NOT A PRESSURE VESSEL. Past atmospheric it relieves, and it
   does not get its vacuum back: the air is in, and there is no pump on this
   plant that pulls it out again. Latched, and it is the end of the heat sink -
   the steam backs up into the shells and they go to their safeties. */
const COND_ATM=0.101;     // MPa, and the pressure a lost condenser sits at
/* The exhaust pressure a turbine will not tolerate - a real figure, and about
   four times rated rejection, so no healthy plant is anywhere near it. */
const TURB_TRIP_P=0.02;   // MPa
const condP = s => Math.max(exhOpen(s) ? P.Pcont : 0, s.condLost ? COND_ATM : 0,
  s.condT===undefined ? COND_P0 : Math.max(COND_P0, psatSec(s.condT)));
/* What it is actually getting rid of, kW - the only place rejection is
   computed, so the readout and the balance cannot disagree. The effectiveness
   form: no circulating water is exactly no rejection, and a condenser running
   on part flow loses more than the flow it lost, because eps rises but the
   capacity rate it multiplies falls faster. */
const cwC = s => P.cwC*cwK(s);
/* THE COLD SIDE IS THE WATER ARRIVING, never a panel's temperature. Wiring it
   to s.radT made the condenser reject into whichever panels the plant owned
   whether or not one drop of water ran between them, which is the same
   by-role-name coupling that left a panel spliced anywhere else inert. */
const condRej = s => { const c = cwC(s);
  if(!(c>0)) return 0;
  const cold = s.cwInT===undefined ? RAD_TDES : s.cwInT;
  return Math.max(0, c*(1-Math.exp(-P.condUA*condK(s)/c))*((s.condT||cold)-cold)); };
/* WHERE THE HEAT ACTUALLY WENT: the temperature the circulating water leaves
   at. A readout, and the one number that says the sink is finite. */
const cwOut = s => { const c = cwC(s), cold = s.cwInT===undefined ? RAD_TDES : s.cwInT;
  return c>0 ? cold + condRej(s)/c : (s.condT||cold); };
/* ══ ONE POT ══
   Every thermal store in this sim is the same integrator: a temperature, a
   heat capacity, what goes in, what goes out, what the room takes, and the two
   ends it cannot pass. There were five copies of it and they had drifted -
   different floors, and only some of them guarded the capacity at all, so a
   plant with no generator gave the condenser a capacity near zero and its
   temperature ran away on the first tick. */
const potStep = (T, cap, qIn, qOut, skin, dt, lo, hi) =>
  clamp(T + (qIn - qOut - (skin||0))/Math.max(1, cap)*dt,
        lo===undefined ? -Infinity : lo, hi===undefined ? Infinity : hi);
/* Water and metal in the condenser, kJ/K. The hotwell it drains into is the
   yardstick the plant already sizes it by. */
const condCap_ = () => hotMass()*CP_W + hotMass()*0.6*CP_STEEL;
/* ══ THE SINK IS A RADIATOR, AND IT IS THE ONLY WAY HEAT LEAVES THIS SHIP ══
   The chain is PLUMBED, end to end: whatever pot heats a circuit, the water in
   that circuit carries it, and a panel standing in that water hands it to
   space. On the stock ship that reads s.sgTBy -> s.condT -> circulating water
   -> s.radTBy -> space; splice a panel into a cold leg instead and the first
   two hops are simply not there. Stefan-Boltzmann exact, because the T^4 IS
   the gameplay: rejection goes as the fourth power, so a panel sits at Q^(1/4)
   and the overload a plant can take is (ceiling/RAD_TDES)^4 - a number nobody
   types and panel area buys.
   PER INSTANCE, like every other machine's pot: two panels on two circuits are
   two temperatures, and one global figure could only ever answer for one of
   them. Fed forward one tick, the same lag s.condT and s.coreDT carry. */
const radTOf = (s,id) => { const v = s && s.radTBy && s.radTBy[id];
  return v===undefined ? RAD_TDES : v; };
/* The hottest panel on the ship - what an annunciator and a single-figure
   readout are actually asking, and the one that trips first. */
const radTMax = s => { let t = -Infinity;
  for(const p of LAY.parts) if(p.role==="radiator") t = Math.max(t, radTOf(s,p.id));
  return isFinite(t) ? t : RAD_TDES; };
/* A dead or a blind panel contributes exactly zero: radArea() already returns
   0 for one that cannot see space. kW, like every other rate in this file. */
const radRejOf = (s,id) => (s.dmgParts.indexOf(id)>=0) ? 0
  : Math.max(0, radCoatOf(id).emis*SIGMA*radArea(id)
      * (Math.pow(radTOf(s,id),4) - Math.pow(T_SPACE,4))/1000);
const radRej = s => { let w=0;
  for(const p of LAY.parts) if(p.role==="radiator") w += radRejOf(s,p.id);
  return w; };
/* THIS PANEL's own metal and the water it holds, kJ/K - ihxHeatCap()'s idiom.
   It used to be the condenser's hotwell, which was the honest figure while the
   fleet was one pot fed by that machine and is the wrong yardstick entirely
   now that a panel is plumbed to whatever the player ran a pipe to. */
const radCap_ = id => radMass(id)*1000*CP_STEEL + partVol(id)*1000*CP_W;
/* THE ENTHALPY THE TURBINE ACTUALLY GETS, off the pressure ratio across it -
   the two pressures being SOLVED now rather than pinned. P.hTurb is fitted at
   the same anchor as everything else on this side: at design shell pressure
   against design condenser pressure it is exactly the feed-to-steam rise, so the machine you
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
const mwE   = s => (s.turbWk||0)*turbDh(s.turbP||0, condP(s))*P.eff/1000;
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
    /* AND THE ORDER IN FLIGHT DIES WITH THEM. The jam freezes where the rods
       ARE; the demand went on standing wherever it was last dragged, so the
       panel showed a bank still travelling to a position nothing was going to
       take it to. Every demand adopts the actual - the same bumpless move
       setSplit() makes - so the board reads what the plant has. */
    hit:s=>{ s.rodJam=true; s.rodDem=s.rodPos; s.tiltDem=s.tilt;
             for(let b=0;b<P.NB;b++) s.rodZDem[b]=s.rodZ[b]; },
    fix:s=>s.rodJam=false},
  /* a stop valve slams, it does not stroke - so this writes the actual AND the
     demand, or the load lag would drag the turbine straight back up */
  turb:{msg:"TURBINE HIT",
    why:"Load rejected. The turbine is offline, so the reactor has nowhere to send its heat.",
    hit:s=>s.load=s.loadDem=0.05, fix:null},
  cond:{msg:"CONDENSER HIT",
    why:"Heat rejection lost. Steam has nowhere to condense.",
    hit:s=>s.load=s.loadDem=0.05, fix:null},
  radiator:{msg:"RADIATOR PANEL HIT",
    why:"That panel sheds nothing now. The ship's heat sink is whatever is left of the others, so the condenser climbs and the turbine trips on backpressure.",
    hit:null, fix:null},
  ctrl:{msg:"INSTRUMENT CABINET HIT",
    why:"Sensor channels lost. Every reading on the panel is now far less trustworthy.",
    hit:s=>s.noiseMul=3.5, fix:s=>s.noiseMul=1},
  bkp :{msg:"BACKUP POWER HIT",
    why:"Your emergency supply is gone. A blackout now means natural circulation only.",
    hit:s=>s.bkpLost=true, fix:s=>s.bkpLost=false},
  tank:{msg:"TANK HIT",
    why:"That tank's line is severed. Whatever it held is no longer reaching the loop. A tank that holds the circuit's pressure also loses its relief valve open, and it will not reseat.",
    /* A HOLD TANK CARRIES THE CIRCUIT'S RELIEF PATH, so a hit on one knocks
       that valve open - what a pressurizer took when it was its own role. Off
       the instance's own mode, never an id, and silently a no-op for an
       ordinary tank or a plant built with no relief path at all. */
    hit:(s,id)=>{ if(!tankHold(id)) return; const fid=primaryRelief(); if(!fid) return;
      s.reliefOpen[fid]=true; s.reliefStuck[fid]=true; s.reliefAuto[fid]=true; },
    fix:(s,id)=>{ if(!tankHold(id)) return; const fid=primaryRelief(); if(!fid) return;
      s.reliefStuck[fid]=false; s.reliefOpen[fid]=false; s.reliefAuto[fid]=false; }},
  pump:{msg:"PUMP HIT",
    why:"That pump is dead. It develops no head at all, and whatever it was pushing round is down to what the rest of the plant can do without it.",
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
  /* A PORT IS A TARGET NOW (portCellPart(), pipenet.js). What being wrecked
     MEANS for one is that it jams: ACT.portShut names it through `part`
     (record.js) and the order is not carried out, so the valve stays exactly
     where it stood. There is no hit/fix pair because there is no flag to set -
     the damage id IS the state. */
  port:{msg:"NOZZLE VALVE HIT",
    why:"That port's isolation valve is wrecked. It is jammed where it stood, so the run on it can no longer be cut out at the machine until a party has been out to it.",
    hit:null, fix:null},
  pipe:{msg:"PRIMARY PIPE RUPTURE",
    why:"A primary run has been severed. It carries nothing round the loop any more, and both cut ends are now open to containment - the loop is losing coolant and pressure through them until something stops it.",
    hit:null, fix:null}
};
const DMGANY={msg:"EQUIPMENT HIT", why:"A component has been knocked out.", hit:null, fix:null};
/* THIS PART first, then what it IS, then the id-prefix fallback. Role used to
   win, which made a per-part row unreachable for anything that had a role at
   all - DMGFX.feed was dead for exactly that reason, and a destroyed feed pump
   logged under the coolant pumps' message. A named part is the more specific
   statement, so it goes first; a tank's id is a slot number the player may
   rename and falls through to its role, which is where it belongs. */
const dmgFx = id => {
  const p = partOf(id);
  return DMGFX[id] || (p && DMGFX[p.role])
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
    if(typeof id==="string" && (id.indexOf("pipe:")===0 || id.indexOf("port:")===0)){
      if(s.dmgParts.includes(id)) return;
      p=dmgPart(id);
      if(!p) return;
    } else {
      p=partOf(id);
      if(!p||!canHit(p)) return;
    }
  } else {
    const parts=LAY.parts.filter(canHit);
    /* ONE TARGET PER PIPE CELL. A longer run really is more exposed pipe for a
       stray round to find, and that survives BETTER than it did: a long
       connection is literally more targets rather than one fatter one. */
    const runs=pipeCellIds().filter(k=>!s.dmgParts.includes(k)).map(dmgPart).filter(Boolean);
    /* ...AND ONE PER PORT, on the same per-cell rate: a nozzle valve stands in
       a cell of its own on the board, so it is exactly as findable as the pipe
       it terminates rather than being the one thing a round cannot hit. */
    const ports=portIds().map(pid=>"port:"+pid)
                  .filter(k=>!s.dmgParts.includes(k)).map(dmgPart).filter(Boolean);
    const targets=parts.concat(runs,ports);
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
  if(fx.hit) fx.hit(s, p.id);
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
      "The banks are being driven back together at "+(rodRate()*100).toFixed(1)+" %/s. They are still split until they arrive, and a scram overrides this at any point.");
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

   THE LOW DNBR CHANNEL TRIPS ON THE NODE MINIMUM, because s.dnbr IS the node
   minimum - a protection system watching anything but the worst point in the
   field is watching a number no pin lives at. */
/* The steam dump's proportional gain, share of rated steam per kelvin of
   programme error - fitted for a SCRAM, where the error is tens of kelvin. */
const DUMP_K=0.02;
const DUMP_COND_K=0.75;   // share of the backpressure trip the dump is permitted up to
/* ── AND ON A STEAM PLANT THE BYPASS IS A PRESSURE REGULATOR ──
   MEASURED: on a flat programme a BWR taking a load step to 70 % lifts its
   shell safeties in 12 s while Tavg has moved 0.03 K, and no gain closes that
   - 0.02, 0.1, 0.5, 2 and 10 per kelvin all lift the valves, because the fault
   is on the SHELL and the primary is the one thing still fine. A real BWR
   bypass is driven by the steam-line pressure regulator, and this is that
   machine. The band is DERIVED: wide open by the time the lowest safety valve
   actually drawn on this plant would lift, so the staging a real plant has -
   regulator first, safeties last - falls out of where the valves were set. At
   rest every shell sits BELOW its design pressure, so the term clamps to
   exactly 0 and nothing at full load can have moved. */
const sgBypBand = () => { let k=PORV_LIFT_K;
  // AS A FRACTION of what each valve protects: the setpoints are absolute MPa
  // now, and this band is a share of the shell design pressure
  for(const fid of reliefSecIds())
    k = Math.min(k, reliefSet(fid).lift/Math.max(reliefRefP(fid),1e-6));
  return Math.max(0.005, k-1); };
const sgOverFrac = s => { let k=0;
  for(const id of sgIds()) k=Math.max(k, secP(s,id)/sgDesignP(id)-1);
  return k; };
/* the dump's pressure mode, share of rated steam - one expression, because the
   commissioning walk has to open the same valve the tick will */
const dumpPOf = s => clamp(sgOverFrac(s)/sgBypBand(),0,1)*P.bypass;
/* CONDENSER AVAILABLE, the C-9 permissive: a dump into a condenser already
   near its backpressure trip is a dump that trips the turbine, so the valves
   are blocked and the shell goes to its safeties instead. MSRE's condenser
   sat at 0.012 MPa at rest against a 0.02 trip, and without the interlock a
   15 % load drop tripped its turbine in 56 s. */
const condAvail = s => condP(s) < TURB_TRIP_P*DUMP_COND_K;
const RPS_NEAR=0.03;                        // how close to a setpoint counts as "about to"
/* The share of its own commissioned margin a plant is allowed to lose before
   the DNBR channel drops, and the floor no protection system may be set
   under: DNBR 1.0 IS departure (dnbrOf()), so a setpoint below it protects
   nothing at all. */
const DNBR_TRIP_K=0.72, DNBR_ONSET=1.02;
const RPS_CH=[
  ["HIGH FLUX","FLUX",          +1, (P_,m)=>1.10+0.22*m,             s=>s.n],
  /* The PWR setpoint, or a fixed fraction under what THIS plant commissions
     at - whichever is lower, and never under departure itself. Same argument
     LOW SUBCOOLING and CORE VOID below already carry: a boiling channel
     commissions at 1.44 where a pressurised one commissions at 1.76, so a
     flat 1.124 left an RBMK three per cent of margin and tripped it on its
     own settling transient with nobody aboard. min(), so no plant that used
     to hold this channel can start failing it, and the stock PWR is exactly
     the number it always was. */
  ["LOW DNBR","DNBR",           -1, (P_,m)=>Math.max(DNBR_ONSET,
                                       Math.min(1.18-0.16*m, P_.dnbr0*DNBR_TRIP_K)), s=>s.dnbr],
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
/* ══ AND IT IS A PID, IN THE ONE FORM A ROD DRIVE CAN BE DRIVEN IN ══
   The output is a SPEED - a rod demand walks, it does not jump - so the law is
   the velocity form: u-dot = Kp*(e-dot + e/Ti + Td*e-dot-dot). It was already
   a PI in disguise, and saying so is most of this change: the old
   `arGain*(e + arLead*dTavg)` per tick is exactly Kp = 50*arGain*arLead and
   Ti = arLead, because dTavg IS the error's own derivative. What was missing
   is Td, and Td is what a plant whose T-avg answers slowly actually needs.
   AUTOROD_KP is that same 0.96 written down. */
const AUTOROD_KP=0.96;    // rod fraction per second, per K/s of error rate
const AUTOROD_TI=12;      // s, integral time - the old AUTOROD_LEAD, renamed to what it is
/* Three quarters of Ti, not the textbook quarter, and it is MEASURED: this
   loop's dead time is most of its period - a rod moves power at once and T-avg
   answers over a minute - so the rate term is what holds it and the integral
   is what rings it. At Ti/4 SFR still swung n 0.24 to 1.00 over 150 s; at
   3Ti/4 it holds 0.76 to 0.87, and every other family is tighter too. */
const AUTOROD_TD=9;       // s, derivative time
/* ══ AND THE TUNE IS SCALED TO THE PLANT IT IS FITTED TO ══
   How fast T-avg answers at all, K/s at a full-power imbalance - s.dTavg's own
   expression, asked as a property rather than integrated. A graphite pile
   carries six times the loop mass per megawatt of a pressurised plant, so its
   T-avg answers six times slower, and the controller fitted on the fast one
   winds rods out long past what the error asks: WINDSCALE turned 0.5 K of
   drift into 36 % of power in ten seconds and tripped itself on high flux with
   nobody touching a control. Frozen rods, the same core settles on its own.
   AUTOROD_R0 is what AUTOROD_GAIN was measured on, and the tune never sharpens
   PAST it - a plant quicker than the reference keeps the fitted numbers. */
/* AND ON WHAT ANSWERS THE ERROR IT IS ACTUALLY LOOKING AT. This controller
   acts on TEMPERATURE, so what opposes it is everything the core gives back
   per kelvin: the coolant and structure directly, and the fuel's own
   coefficients converted over the pellet's rise above the coolant. A
   pressurised plant is almost all coolant (-41 pcm/K); a helium pile has no
   coolant coefficient at all and holds itself through Doppler, which arrives
   after the pellet has heated and is the lag the overshoot lives in. There is
   no floor: a plant whose feedback is all on the slow axis gets a small gain,
   and that is the gain it can afford. */
const AUTOROD_R0=1.63;                  // K/s, the stock pressurised plant's own figure
const AUTOROD_A0=44;                    // pcm/K, the same plant's whole feedback on tempFb()'s measure
const tavgRate = () => P.rated*1000/(loopKg()*CP_W)/P.graceK;
const tempFb = () => Math.abs(P.aM+P.aS)+Math.abs(P.pwrDef)/Math.max(P.TfRef-P.Tref,1);
/* ══ AND THE TIMES STRETCH WITH THE LAG, BECAUSE THE LAG IS WHAT THEY ARE ══
   AUTOROD_LAG is how many times slower than the reference plant this one's
   T-avg answers. The gain was already divided by it; the two TIMES were not,
   so a plant four times slower integrated four times as much rod out before
   its own temperature came back and told the controller to stop. That is
   integral windup, and on SFR it was worth 0.30 of rated power - n 1.11
   against an n0 of 0.810, into the condenser's own trip. Capped, because a
   controller with an unbounded integral time is a controller with no integral
   at all. */
const AUTOROD_LAGMAX=8;
const autorodLag = () => clamp(AUTOROD_R0/tavgRate(), 1, AUTOROD_LAGMAX);
const autorodTune = () => { const lag=autorodLag();
  return {arKp: AUTOROD_KP/lag*Math.min(tempFb()/AUTOROD_A0, 1),
          arTi: AUTOROD_TI*lag, arTd: AUTOROD_TD*lag}; };
/* How fast a rod drive moves, ganged or split - one motor, one speed. It is a
   STATED quantity now (D.rodSpd, design.js), because a faster drive is a
   bigger motor and the mass budget says so. The tilt trim and the reganging
   walk are both derived from it, so retuning the drives cannot leave one of
   the three behind. P.scram replaces it on a trip. */
// P is null on the bench, where ctlFor()'s tilt tip asks for it; commission()
// copies the same D.rodSpd into P, so the two answers cannot differ
const rodRate = () => P ? P.rodRate : D.rodSpd;
/* actuator rates. Boration is charging-pump flow; dilution has to displace loop
   inventory, so it is slower. Poisoning yourself is easy, getting back out is not. */
const BOR_IN=60, BOR_OUT=35;            // pcm/s toward more / less boron
/* A motor-operated valve strokes end to end in roughly 17 s - 1/17 fraction
   of travel per second, the same shape as rodRate() above, just a slower
   motor. S.valve walks toward S.valveDem at this rate every tick; see the
   walk beside the boron one below. */
const VALVE_RATE=1/17;
/* How far above what it protects an undialled valve lifts, and how far above
   it reseats. A FRACTION here is right - it is what "sized against" means -
   but it is only the SUGGESTION now, and the setpoints themselves are real
   megapascals on the valve. The gap between them is the deadband: it lifts
   high and does not reseat until pressure is well back down, which is what
   stops it chattering on the setpoint. */
const PORV_LIFT_K=1.06, PORV_RESEAT_K=1.01;
/* ══ A RELIEF VALVE STATES ITS SETPOINTS IN MPa ══
   They were dimensionless multipliers on reliefRefP(), so the number on the
   panel was not the number on the valve and moving the primary's setpoint
   silently moved every relief valve with it. They are absolute now, and the
   ?? xSuggest() idiom carries the old behaviour where nobody has dialled one:
   an untouched valve is suggested a fraction above whatever it protects, so a
   plant nobody has touched lifts exactly where it always did.
   The one reader, written HERE and nowhere else, or the tick, the plant view
   and the auditor would each grow their own idea of what an unset field
   means. P is null on the bench, the same P?fallback:D idiom
   reliefFitIds() uses. */
const reliefLiftSuggest   = fid => reliefRefP(fid)*PORV_LIFT_K;
const reliefReseatSuggest = fid => reliefRefP(fid)*PORV_RESEAT_K;
function reliefSet(fid){
  const f=P?P.fittings:D.fittings, j=(f&&f[fid])||{};
  return {lift:   j.lift   || reliefLiftSuggest(fid),
          reseat: j.reseat || reliefReseatSuggest(fid)};
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
/* ══ WHAT A BOILER DUTY COSTS PER KILOGRAM IS THE RISE, NOT THE LATENT HEAT ══
   Each kilogram of steam a shell sends away is a kilogram of feedwater that
   arrived at T_FEED and had to be heated to saturation before any of it could
   boil. So the shell's steam term, the condenser's heat in and both plant-level
   steam scales are all the FEED-TO-STEAM RISE. They spent `hfg` on it - 1509 at
   6.9 MPa where the rise is 1843, and 1622 at 17 MPa where hfg is 858 - because
   four comments said the constant already spanned it. Asked of the shell's own
   circuit at the shell's own PRESSURE, since neither quantity is a constant.
   steamRise() (layout.js) is the same rise at the design point, for the plant-level anchors
   that have no one shell to ask. */
const riseSg = (id,p) => riseOfCirc(shellCirc(id), p);
// (steamRise(), layout.js, is the one definition - see the block above)
const SGL_SET=50;         // %, the level the feed controller holds
/* ── THE SHELL AS A POT ──
   Steel is what is left of the shell's heat capacity once its water is counted
   separately, and the water is counted at the LEVEL that is actually in there -
   a generator boiling dry loses its thermal mass with its inventory, which is
   why the small machine swings and the big one rides it out on one number
   instead of a fitted multiplier. */
const CP_STEEL=0.5;       // kJ/kg/K
/* T_FEED lives on the water curve now (pipenet.js) - it is a property of the
   feed system, and layout.js is asked for plantSteam() before this file has
   been evaluated. */
/* WHERE A SHELL LETS GO. There is NO invisible lid on this plant: if nothing
   was fitted to take the steam, the shell takes it, and at this multiple of
   its design pressure it bursts. Latched, like a rupture disc and like the
   vessel: a burst shell does not reseat.
   A relief path is a PLACED FITTING - one box, one bore, one set point, one
   stick-open die - and it is the same ROLE.fitting the primary already uses.
   The only thing that had to change is which pressure a valve asks about, and
   that is answered off where it was drawn (shellsOf(), layout.js). */
const SG_BURST_K=1.5;
/* HOW FAR FROM DESIGN TO BURST THE WARNING AND THE RED START, as a fraction of
   that span - the shell has no set point of its own to quote. */
const SG_P_WARN=0.15, SG_P_HI=0.6;
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
   and the shell simply sits colder. IHX_HOLD_PER_UA is the intermediate
   coolant it carries, which with its own steel (IHX_T_PER_UA, layout.js) is the pot's heat
   capacity - and the reason a second stage is also a second flywheel. */
const IHX_UA=2.5;
/* A bigger exchanger is a bigger flywheel as well as a bigger conductance, so
   the size scales the coolant it holds and the steel round it together. */
const ihxHeatCap=id=>{ const ua=ihxUAOf(id);
  return ua*IHX_HOLD_PER_UA*1000*CP_W + ua*IHX_T_PER_UA*1000*CP_STEEL; };
/* HOW HARD THE LEVEL ERROR PULLS ON THE FEED, in multiples of this machine's
   own RATED feed per unit of fractional level error. It was the shell's own
   inventory over a typed 30 s, and an inventory is not a rate: SGT states a
   water charge per generator TYPE, so a 55 MWt helium plant carries the same
   55 t as a 1198 MWt PWR and a one-per-cent level error asked it for half its
   boil rate. The loop then rang, and the ring grew until the shell burst at
   130 s. A feed system is sized by the feed it was bought to pass, so that is
   what paces it, and the gain follows the plant for free. 2.3 is what the
   stock PWR's 55 t over 30 s already was. */
const FEED_LVL_K=2.3;
/* THE FEED REGULATING VALVE, one generator's own. It is a back-pressure in
   MPa, so its travel is a PRESSURE and has to be measured against the pressure
   it is fitted to close against - the discharge head of the pumps that feed
   this shell, off the drawing. A typed 4 MPa was a hidden reference to the
   stock PWR: a sodium or helium plant rates its shell at SG_P_MAX, buys a
   23.5 MPa feed pump to reach it, and the valve then saturated wide the moment
   shell pressure fell - cold feedwater flooded in, cooled the shell, dropped
   the pressure further and fed itself. FREG_FLOOR is what is left for the
   spread between two shells on one header when no pump reaches either.
   FREG_STROKE is the seconds a full stroke takes, so a valve with more span
   is not a slower valve. FREG_SPAN floors the relative error's denominator so
   a generator asking for nothing does not divide by zero. */
const FREG_STROKE=4, FREG_FLOOR=4, FREG_SPAN=10;
const fregMax=id=>{ let h=FREG_FLOOR;
  for(const p of pumpIds()) if(secGensOf(p).includes(id)) h=Math.max(h, pumpHead(p));
  return h; };
/* Below this the tubes are uncovered and the generator stops being a heat sink.
   It was already the threshold the mimic's dry-out pulse and the LOW banner
   used; making removal read the same number is what closes the loop. */
const SG_DRY=25;          // %
/* The second step of the same alarm. SG_DRY is the tubes starting to uncover -
   recoverable, and the plant says so in amber. This is most of the bundle in
   steam with the core still making heat, and it reads red. Two numbers on one
   ladder, so the banner and the tile cannot disagree about which step it is on. */
const SG_DRY_LO=10;       // %
/* THE ALARM COMES FIRST, THE PUMP SECOND. This used to be SG_DRY as well, so
   emergency feedwater could not start without lighting its own alarm in the
   same tick - the board called DRYING for one frame and latched a master
   caution for a level the plant was already fixing. A warning ahead of the
   automatic action is the real ladder. */
const SG_LOW=35;          // %
/* WHERE EMERGENCY FEEDWATER STOPS. A feed train runs to a LEVEL, not to a
   switch point: shutting again the instant the start setpoint is cleared parks
   the plant on its own threshold, and every wobble there re-alarms. Above
   SG_LOW, or the restore would hand the board straight back its alarm. */
const SG_EFW_OFF=40;      // %
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
const ratedSteam=()=>P.rated*1000/steamRise();
/* 100 % on a steam line: one generator's worth for its own run, the whole
   plant's for the exhaust. The tick normalises the packet integral on it and
   the meter prints it as a full scale, so the digits and the packets read the
   same number - the rule every other run already keeps. */
const steamScale=(key,k)=>k==="exh" ? ratedSteam()
  : ratedSteam()*Math.max(1,steamFeeders(key,k).length)/Math.max(1,sgCount());
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
const isSink = id => { const p=partOf(id);
  return !!p && ROLE[p.role] && ROLE[p.role].thermal==="sink"; };
/* ══ AND A HEADER RUN HAS A GENERATOR AT NEITHER END ══
   Tee to tee is the main steam header, and "does end 0 raise steam" answers
   no for both ends, so every one of them read backwards - along with the run
   that hands the header to the turbine, which is a tee at one end and the
   machine at the other. Asked STRUCTURALLY instead, the way crossTies() asks
   its own question: cut this run and see which side can still reach a machine
   that swallows steam. That side is downstream. Nothing is named and no
   ordering is stored - a header re-plumbed backwards on the bench answers the
   new drawing. */
const swallowsSteam = pid => { const p=partOf(pid);
  return !!p && (p.role==="turb" || isSink(pid)); };
function steamSide(node, cut){
  const G=nodeGraph(), seen=G.reach((G.adj[node]||[]).filter(v=>!cut[v]), cut);
  return LAY.parts.some(p=>swallowsSteam(p.id) && (G.nodesOf[p.id]||[]).some(n=>seen[n]));
}
function steamDir(key,k){
  const ends = runEnds(key,k); if(!ends) return 1;
  const pid = n => n.slice(0,-1);
  if(k==="exh") return isSink(pid(ends[1])) ? 1 : -1;
  // a run ON a generator leaves it, whichever end the key happens to sort first
  if(S && S.steamTo){
    if(S.steamTo[pid(ends[0])]!==undefined) return 1;
    if(S.steamTo[pid(ends[1])]!==undefined) return -1;
  }
  /* A TAP DISCHARGES INTO ITS DEAD END, and the reach test below would say the
     opposite: the header side is the side that reaches the turbine, but a
     safety valve hanging off it passes steam OUT. runDeadEnd() (layout.js) is
     the same predicate that already keeps a branch from being named MAIN
     STEAM, asked here for the direction it implies. */
  const de = runDeadEnd(pid(ends[0]), pid(ends[1]));
  if(de) return de.id===pid(ends[1]) ? 1 : -1;
  const cut={}; cut[ends[0]]=1; cut[ends[1]]=1;
  if(steamSide(ends[1],cut)) return 1;
  if(steamSide(ends[0],cut)) return -1;
  return 1;
}
/* ══ WHOSE STEAM PASSES THIS RUN ══
   A HEADER ACCUMULATES. The segment nearest the turbine carries every
   generator behind it and the segment at the far end carries one, so "this
   run carries one machine's worth" was a one-generator plant's answer wearing
   a plant-wide name. Asked the same structural way steamDir() asks its own:
   cut the run, and the generators still reachable from the UPSTREAM side are
   the ones whose steam has to get past this point.
   A dead-ended branch is not a header segment at all - it is a valve on one
   shell, so it books that shell's VENT, and which shell is shellsOf(), the
   same predicate that decides a valve is a secondary one.
   Memoised on the graph window: it is a fact about the drawing, and the
   drawing cannot change while the plant runs. */
function steamBook(key,k){
  const slot=graphSlot("steamFeed"), was=slot.get(key); if(was) return was;
  const ends=runEnds(key,k), pid=n=>n.slice(0,-1);
  let out;
  if(k==="exh" || !ends) out={gens:sgIds(), taps:reliefSecIds(), vent:false};
  else {
    const de = runDeadEnd(pid(ends[0]), pid(ends[1]));
    if(de) out = {gens:shellsOf(de.id), taps:[de.id], vent:true};
    else {
      /* ON THE STEAM SIDE ONLY, and that is the whole of why nodeGraph()'s own
         reach() cannot answer it: the secondary is ONE circuit - shell, steam
         line, turbine, condenser, feed line, back into every other shell - so
         a walk that may leave the steam lines arrives at every generator on
         the plant from anywhere. This one crosses vapour runs and nothing
         else, treats a fitting as transparent (its faces are one box) and
         STOPS at a generator, which is where steam is made rather than
         passed. */
      const adj={}, add=(a,b)=>{ (adj[a]||(adj[a]=[])).push(b);
                                 (adj[b]||(adj[b]=[])).push(a); };
      const up = steamDir(key,k)>0 ? ends[0] : ends[1];
      const byPart={}, note=n=>(byPart[pid(n)]||(byPart[pid(n)]=[])).push(n);
      note(up);
      for(const r of pipeNetwork()){
        if(!RUN_VAPOUR[r.k] || r.key===key) continue;
        const e=runEnds(r.key,r.k); if(!e) continue;
        add(e[0],e[1]); note(e[0]); note(e[1]);
      }
      for(const p in byPart) if(isFitting(p))
        for(let i=1;i<byPart[p].length;i++) add(byPart[p][0],byPart[p][i]);
      const seen={}, st=[up]; seen[up]=1;
      while(st.length){ const n=st.pop();
        if(pid(n)!==pid(up) && sgIds().indexOf(pid(n))>=0) continue;   // a generator is a terminus
        for(const m of (adj[n]||[])) if(!seen[m]){ seen[m]=1; st.push(m); } }
      const on = id => Object.keys(seen).some(n=>pid(n)===id);
      const gens = sgIds().filter(on);
      out = {gens: gens.length ? gens : (sgIds().indexOf(pid(up))>=0 ? [pid(up)] : []),
             /* AND THE VALVES THAT HAVE ALREADY TAKEN THEIR SHARE. Steam that
                left through a safety valve upstream of this point is not in
                this pipe any more, and without the subtraction a tee with a
                valve on it passed out more than came in - the whole plant's
                steam down the header AND the same steam again out the stack. */
             taps: reliefSecIds().filter(on), vent:false};
    }
  }
  slot.set(key,out); return out;
}
const steamFeeders=(key,k)=>steamBook(key,k).gens;
/* What the shell is designed to sit at, where a relief valve set to this
   plant's default lifts, and where the shell itself lets go. */
/* sgDesignP() lives in layout.js now - a generator states the pressure its
   shell is built for, in MPa, and this file is one of its readers. */





const sgLiftP=fid=>fid===undefined ? sgDesignP()*PORV_LIFT_K : reliefSet(fid).lift;
const sgBurstP=id=>sgDesignP(id)*SG_BURST_K;
/* Specific heat of pressurised water at PWR conditions, kJ/kg/K. PHYSICAL,
   not fitted. With CORE_DT0 it turns rated power into the loop's rated mass
   flow, and that is the one bridge between a flow in % of loop inventory -
   invRate()'s currency, which is what an SGTR leak is measured in - and a
   flow in kg/s, which is what the secondary mass balance counts. Without it
   the two sides of a tube rupture are in units that cannot be added. */
/* ONE COPY. It was 5.5 here and 5.5 again in SAT_WATER.cp - two constants
   for one property of one fluid, in two files. */
const CP_W=SAT_WATER.cp;
const loopKg=()=>P.rated*1000/(CP_W*CORE_DT0)*LOOP_TRANSIT;
/* ══════════ JOB 4: ENTHALPY IS CARRIED ALONG THE FLOWS ══════════
   Every node has an enthalpy, and after the solve each one becomes the
   mass-weighted mix of what flowed into it. Nobody writes a rule about tees:
   MIXING IS WHAT THE ARITHMETIC DOES. What this replaces is a two-state tag -
   every "hot" node in the plant read s.Tavg + coreDT/2 and every "cold" node
   read s.Tavg - coreDT/2 - so a tee joining steam and water was not
   mis-modelled, it was not representable, and nothing could tell a turbine
   what arrived at its inlet.

   THE POTS ARE STILL THE ENERGY AUTHORITY. This is transport, not a second
   heat balance: the sweep shapes the PROFILE across a circuit and the pot sets
   its LEVEL (advectLevel below). One projection, per circuit, so the field and
   the pot can never book different energy - and the sources here only ever
   decide the shape.

   NO SECOND SOLVE AND NO ITERATION. One upwind donor-cell pass over the edge
   list the tick already solved. */
/* WHAT IS BEING PUT INTO THE FLUID AT A NODE, kW. One tick old, the s.coreDT
   idiom - the solve has to run before there are flows to carry anything
   along. Positive is heat in. */
function advectSrc(s){
  const src = {};
  const add = (nid, q) => { if(q) src[nid] = (src[nid]||0) + q; };
  add("core", (HEATBAL.heat||0)*P.rated*1000);
  for(const id of sgIds()){
    const q = HEATBAL.sgQBy[id] || 0;
    /* A GENERATOR IS A BARRIER, so the heat leaves the tube nodes and arrives
       on the shell nodes - ROLE.sg says which faces are which and this reads
       it rather than naming a face. */
    for(const IN of ROLE.sg.internal){
      const prim = !secondaryNode(id+IN.a);
      add(id+IN.a, (prim?-q:q)/2); add(id+IN.b, (prim?-q:q)/2);
    }
  }
  for(const id of ihxIds()) add(id+"l", -((s.ihxQBy&&s.ihxQBy[id])||0));
  /* A SINK IS A BARRIER TOO. A condenser gives its rejection to the water on
     its OTHER side - the path that declares no anchor, cwKeys()' own predicate
     - so the circulating water leaves hotter than it arrived instead of being
     pinned to the pot behind it. Split over the condensers there ARE, because
     condRej() prices the fleet. */
  { const n = condCount();
    if(n) for(const p of LAY.parts){ const R=ROLE[p.role];
      if(!R || R.thermal !== "sink" || !Array.isArray(R.internal)) continue;
      for(const IN of R.internal){ if(IN.anch) continue;
        add(coreFold(p.id+IN.a), condRej(s)/n/2);
        add(coreFold(p.id+IN.b), condRej(s)/n/2); } } }
  /* AND A PANEL TAKES HEAT OUT OF WHATEVER IS RUNNING THROUGH IT, wherever
     that is. This is the whole of "a heat sink cools what it is plumbed to":
     the panel used to ANCHOR these nodes to its own temperature, which showed
     cold water leaving it while removing not one joule from anything. */
  { const IN = ROLE.radiator.internal;
    for(const id of radIds()){ const q = (s.radQBy && s.radQBy[id]) || 0;
      add(coreFold(id+IN.a), -q/2); add(coreFold(id+IN.b), -q/2); } }
  return src;
}
/* ══ WHERE A POT MEETS THE FIELD ══
   Two shapes, and the difference is what the pot IS rather than a special
   case. A pot that is a MACHINE - a generator's shell, a condenser, a panel -
   is a place, so it anchors its own nodes and the pipes between two of them
   are free to carry a gradient. s.Tavg is not a place: it is the primary
   LOOP's mean by construction, so it sets that circuit's LEVEL and the
   transport keeps the shape. Anchoring a loop-mean at one node, or shifting a
   circuit that holds a boiler at one end and a condenser at the other, are
   both wrong and both were tried. */
/* TWO MAPS, AND THE DIFFERENCE IS LOAD-BEARING. `hold` is pinned every tick:
   the field must read that node off the pot. `seed` only says what a circuit's
   water was sitting at before anything flowed - what an EMPTY field is filled
   from. A machine that has a real heat term needs the second and must not have
   the first, or the pot reads its own answer back out of the field; a panel
   was both at once, which is how it came to show cold water leaving it while
   taking nothing out of anything. Seed is a superset of hold by construction. */
function advectAnchors(s){
  const hold = {}, seed = {};
  const at = (m, pid, faces, T) => { if(T === undefined || !isFinite(T)) return;
    for(const f of faces){ const n = coreFold(pid+f);
      if(P.net.index[n] !== undefined) m[n] = T; } };
  const FACES = ["t","r","b","l"];
  for(const id of sgIds()){
    // the SHELL only: the tubes are primary water and belong to the loop mean
    for(const f of FACES){ const n = coreFold(id+f);
      if(P.net.index[n] !== undefined && secondaryNode(id+f))
        hold[n] = seed[n] = s.sgTBy[id]; }
  }
  /* A SINK HOLDS ONLY THE PATH THAT DECLARES AN ANCHOR (IN.anch) - a
     condenser's STEAM side is the pot, and its circulating water is fluid like
     anything else. Every sink still SEEDS all of its faces, or a cooling
     circuit with no pot pinned on it falls back to s.Tavg and commissions with
     the primary's mean in it: 23 % steam at the CW pump, a buoyancy column
     that cancels its own pump, and no flow left to wash the seed out. */
  for(const p of LAY.parts){ const R=ROLE[p.role];
    if(!R || R.thermal !== "sink") continue;
    const T = partTemp(s,p); if(T === undefined || !isFinite(T)) continue;
    at(seed, p.id, FACES, T);
    for(const IN of (Array.isArray(R.internal) ? R.internal : []))
      if(IN.anch) at(hold, p.id, [IN.a, IN.b], T);
  }
  /* A TANK IS STORAGE, AND STORAGE IS WHAT IS IN IT. It sits on one line with
     nothing going through it, so the transport never reaches it and it kept
     whatever the commissioning seed left there - a reserve of condensate
     reading 583 K and nine per cent steam. What is in a tank is what was put
     in it, at the temperature its own FLUID states (the same figure its panel
     prints), and it is a pot of its own rather than part of any circuit's.
     T_FEED stood here and is the plant's feedwater, not this vessel's: a
     vented reserve seeded at 490 K is 100 K over its own saturation, so the
     pump drawing on it cavitated on tick one against a tank that was full. */
  /* A HOLD TANK IS NOT STORAGE. Its water is the circuit's own - a surge line
     carries the loop both ways - so it is left to the transport and takes the
     loop's temperature, which is also what the subcooling instrument standing
     on it is asking about. */
  for(const id of tankIds()){ if(D.tanks[id].hold) continue;
    const T = tankFluid(id).temp;
    at(hold, id, FACES, T); at(seed, id, FACES, T); }
  return {hold, seed};
}
/* HOW MANY TIMES THE COURANT GUARD BIT LAST TICK - a node too small for the
   flow through it, which the clamp below turns into "it simply equilibrates
   this tick" rather than an explicit blow-up. A READOUT, never on S: it is a
   fact about the arithmetic, not about the plant. */
let advectClamped = 0;
const advectClampCount = () => advectClamped;
function advectStep(s, dt, runFlow){
  const net = P && P.net;
  if(!net || !net.name || !s.hBy) return;
  const h = s.hBy;
  /* REFILLED, NEVER REBUILT - the s.spillBy idiom. Node names are a
     deterministic function of LAY.parts at commission time and the design
     cannot change while operating, so a key that has gone means the plant was
     re-commissioned under it. */
  for(const k in h) if(net.index[k] === undefined) delete h[k];

  const src = advectSrc(s), A = advectAnchors(s), anch = A.hold;
  const G = nodeGraph();
  /* ══ A NODE STARTS AT ITS OWN CIRCUIT'S TEMPERATURE ══
     s.Tavg is the PRIMARY's mean and nothing else's, so seeding every node
     with it put 773 K in WINDSCALE's circulating water: 23 % steam at the CW
     pump, a buoyancy column that cancelled the pump, and then no flow left to
     wash the seed out - the plant commissioned with no heat sink at all and
     took eighty seconds to find one. The anchors are what a circuit's own
     machines say they are sitting at, which is the same answer for a circuit
     that has one and no answer at all for the core's, where the loop mean IS
     the temperature. */
  /* AND IT IS THE NEAREST MACHINE'S, walked over the runs themselves. A
     circuit MEAN averaged a 559 K shell with a 312 K condenser and handed the
     answer to the condensate line: 422 K in a pipe sitting at 0.2 MPa, which
     is superheat, so a feed pump reading its own suction cavitated on tick one
     and then had no head left to wash the seed out. Walked, that line starts
     at the condenser it is plumbed to. Only when a node is missing, so a
     running plant pays nothing. */
  { let need = false;
    for(let i=0;i<net.n && !need;i++) if(h[net.name[i]] === undefined) need = true;
    if(need){
      const T = new Array(net.n), q = [], adj = {};
      for(const nm in A.seed){ const i = net.index[nm];
        if(i !== undefined && T[i] === undefined){ T[i] = A.seed[nm]; q.push(i); } }
      for(const ed of net.edges){ (adj[ed.u]||(adj[ed.u]=[])).push(ed.v);
                                  (adj[ed.v]||(adj[ed.v]=[])).push(ed.u); }
      for(let qi=0;qi<q.length;qi++){ const u = q[qi];
        for(const v of (adj[u]||[])) if(T[v] === undefined){ T[v] = T[u]; q.push(v); } }
      for(let i=0;i<net.n;i++){ const nm = net.name[i];
        if(h[nm] !== undefined) continue;
        const c = circOfNode(nm);
        h[nm] = hOfT(satOfCirc(c), (c !== G.coreCirc && T[i] !== undefined) ? T[i] : s.Tavg); } } }

  // held BEFORE the sweep as well as after, so a donor carries its pot's own
  // state into the pipe leaving it rather than last tick's
  for(const nm in anch) h[nm] = hOfT(satOfCirc(circOfNode(nm)), anch[nm]);
  const rho = Math.max(1, P.rho0 || 700);
  const mOut = new Float64Array(net.n), inH = new Float64Array(net.n), inM = new Float64Array(net.n);
  const kgs = netKgs;
  for(const ed of net.edges){
    const q = runFlow[ed.key];
    if(!q) continue;
    const m = kgs(q); if(!(m > 1e-9)) continue;
    const from = q > 0 ? ed.u : ed.v, to = q > 0 ? ed.v : ed.u;
    mOut[from] += m;
    inH[to] += m*h[net.name[from]];
    inM[to] += m;
  }
  /* ══ THE COURANT GUARD ══
     tau = holdup / inflow is how long this node takes to turn over. The blend
     is dt/tau and it is CLAMPED AT 1: a node too small for its flow simply
     equilibrates with its inlet in one tick, which is the stable limit and
     what a node that small physically does. There is no explicit blow-up
     available here by construction, and no sub-stepping to pay for. */
  advectClamped = 0;
  for(let i=0;i<net.n;i++){
    if(!(inM[i] > 1e-9) || anch[net.name[i]] !== undefined) continue;
    const mass = net.vol[i]*rho;
    let f = inM[i]*dt/mass;
    if(f >= 1){ f = 1; advectClamped++; }
    const nm = net.name[i];
    /* THE TARGET IS THE MIX PLUS WHAT THIS MACHINE PUTS IN PER KILOGRAM
       PASSING THROUGH. That is the steady state of the control volume written
       down directly, so a machine's own heat lands AT the machine rather than
       a node downstream of it, and the relaxation toward it cannot overshoot. */
    const target = (inH[i] + (src[nm]||0))/inM[i];
    h[nm] += f*(target - h[nm]);
  }
  /* ══ AND s.Tavg SETS THE CORE CIRCUIT'S LEVEL ══
     The one pot that is a mean rather than a place. Mass-weighted over the
     nodes the transport owns - an anchored node is somebody else's answer and
     is left out of both the average and the shift - so the field and the pot
     can never book different energy while the shape stays the transport's. */
  if(G.coreCirc >= 0 && s.Tavg !== undefined){
    let m = 0, hm = 0; const list = [];
    for(let i=0;i<net.n;i++){ const nm = net.name[i];
      if(anch[nm] !== undefined || circOfNode(nm) !== G.coreCirc) continue;
      /* OVER WHAT IS ACTUALLY CIRCULATING. s.Tavg is the mean of the water
         going round, and a tank hanging off the loop on one line is not going
         round - ninety cubic metres of stagnant reserve in the average pushed
         every pipe in the plant above it, which cancelled most of the
         buoyancy the profile was there to produce. */
      if(!(inM[i] > 1e-9)) continue;
      const mi = net.vol[i]*rho;
      m += mi; hm += mi*h[nm]; list.push(nm);
    }
    if(m > 0){ const d = hOfT(satOfCirc(G.coreCirc), s.Tavg) - hm/m;
      if(d) for(const nm of list) h[nm] += d; }
  }
}

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
  return v===undefined ? tsatSec(secPTarget(s,id), shellCirc(id)) : v; };
/* ONE exchanger's own intermediate temperature, K. No entry yet is a pot that
   has not been seeded, and a pot at loop temperature is what it seeds to. */
const ihxTemp=(s,id)=>{ const v=s&&s.ihxTBy&&s.ihxTBy[id];
  return v===undefined ? (s?s.Tavg:0) : v; };
/* WHAT THIS GENERATOR'S TUBES ARE HEATED BY - the core's own coolant, unless
   an intermediate exchanger stands in front of it, when it is that exchanger's
   pot. ONE reader, so the heat term, the readout and the T-HOT row cannot
   disagree about which stage a generator is on. */
const sgHot=(s,id)=>{ const h=ihxOf(id); return h ? ihxTemp(s,h) : s.Tavg; };
/* WHAT CROSSES ONE GENERATOR'S TUBES, kW, at a stated flow share and film -
   the one expression, read by the tick and by the commissioning settle. */
const sgQAt=(s,id,fl,filmK)=>((P.sgUABy && P.sgUABy[id]) || P.sgUA)*Math.pow(fl,UA_FLOW)*sgFill(s,id)*filmK
                            * Math.max(0, sgHot(s,id) - sgTemp(s,id));
/* IS WHAT IS IN THESE TUBES THE CORE'S OWN WATER? An intermediate exchanger is
   a BARRIER, and that is the whole reason the real machines exist: behind one,
   a tube rupture leaks the exchanger's coolant into the shell and costs no
   release at all. It still costs INVENTORY - the loop it drains is still a
   loop this plant needs to cool the core with - so only the activity is
   bought, which is exactly what the barrier is. */
const sgActive = id => !ihxOf(id);
/* The pot's heat capacity: the water actually in it plus the steel round it. */
const sgHeatCap=(s,id)=>sgRowOf(id).water*1000*(sgLvl(s,id)/100)*CP_W
                      + sgSteelT(id)*1000*CP_STEEL;
/* ONE generator's level as a number, for a reader that wants to print it.
   Defaults to SGL_SET rather than 0 for a generator with no entry yet - a
   bench with no sim running draws a half-full kettle, not an empty one. */
const sgLvl=(s,id)=>{ const v=s&&s.sglBy&&s.sglBy[id]; return v===undefined?SGL_SET:v; };
/* ══ THE SHELL HAS A STEAM SPACE, AND STEAM IN IT HAS MASS ══
   Without one, water that boiled but did not get away was not represented as
   anything: the feed controller replaced it out of the hotwell and the plant
   lost 4595 kg in 120 s with nothing venting (2 loops, dice off). Saturated
   water at the pressures these shells run at, and a vessel whose steam space
   at 100 % level is still 0.6 of the water volume - a level is read across a
   downcomer span, not across the whole drum. */
/* SG_RHO_W was 740 flat - saturated water at the 6.9 MPa anchor and 34 % heavy
   at 17 MPa, where three families' shells sit. It is the curve's own liquid
   density at the pressure the shell is actually at now (rhofOf(), pipenet.js). */
const sgRhoW=(s,id)=>rhofOf(satOfCirc(shellCirc(id)), tsatSec(secP(s,id), shellCirc(id)));
const SG_DOME=1.6;
/* How fast the shell settles back onto saturation, s. The surplus condenses
   into the water below it and a deficit flashes off it; the term cancels
   inside the shell, so it moves no mass out of the plant at any rate. */
const SG_FLASH_TAU=4;
const sgSteamVol=(s,id)=>Math.max(0.1, sgMassOf(id)/sgRhoW(s,id)*(SG_DOME-sgLvl(s,id)/100));
/* What saturation permits in that space at the pressure the pot is sitting at. */
const sgSteamEq=(s,id)=>sgSteamVol(s,id)*satRvl(secP(s,id))*sgRhoW(s,id);
const sgSteamKg=(s,id)=>{ const v=s&&s.sgSteamBy&&s.sgSteamBy[id];
  return v===undefined ? sgSteamEq(s,id) : v; };
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
// how long vapour takes to fill a pump's inlet, and to clear out of it again
const CAV_TAU=1.5;
// how fast a pump's own curve follows what it is passing (s.pumpQBy)
const PUMP_Q_TAU=1.0;
// the leak, in % of inventory per second, that takes the pressurizer's
// authority away entirely - a pinhole barely touches it, a LOCA ends it
const PZR_LOSE=2.0;
/* MPa of pressure programme per K of Tavg PER MPa OF SETPOINT. It was written
   as 0.17*(P.P0/15.5), which is a bare PWR pressure standing as a reference
   nobody could see; folded into one coefficient it is a real per-unit figure
   and the 15.5 is not a plant any more. */
const PZR_PROG_K=0.17/15.5;
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
   state, because margin is asked PER NODE from inside coreStep()'s loop, where
   that node's own rise, flux, channel flow and quality are all live
   (marginNode). One builder - the laws stay in one place and no caller reaches
   past it.
     law    which of the three                       dhSub inlet subcooling, kJ/kg
     dT     the rise the hot channel took, K         Tin   channel inlet, K
     Tf     fuel temperature to judge, K             q     heat flux, W/m2
     g      mass flux, kg/m2/s                       x     thermodynamic quality
     p      core pressure, MPa

   THE PLANT'S MARGIN IS THE NODE MINIMUM, and s.dnbr IS s.dnbrMin. DNB is a
   local event, so a plant figure that is not the worst point in the field is
   not a margin at all. */
function dnbrOf(m){
  if(m.law==="boil")
    return P.dnbrK*(m.dhSub/CP_W)/Math.max(m.dT,1e-3);
  if(m.law==="temp")
    return P.dnbrK*Math.max(P.tdmg-m.Tin,0)/Math.max(m.Tf-m.Tin,1e-3);
  return P.dnbrK*dnbW3(m.p,Math.max(m.g,1e-3),m.x,P.dh,m.dhSub)/Math.max(m.q,1);
}
/* ── AND WHAT LOSING THE MARGIN COSTS ──
   DNBR was computed, displayed and tripped on and then thrown away: crossing
   1.0 bought the player nothing, because the pellet's film conductance
   (core2d.js) degraded on VOID alone. The chain the damage block tells -
   margin lost, film collapses, clad climbs to the pellet, balloons, bursts -
   was missing its first link, so a core could sit at DNBR 0.77 with the clad
   still bolted to the coolant temperature and take no damage at all.

   The ONSET is physics: DNBR 1.0 is what departure means, and the ramp is
   priced on the node's own margin, which carries P.dnbrK, so 1.0 means the
   same departure on every family. DNB_FILM is physics too, roughly - past
   departure the wall is blanketed and the coefficient falls by about an order
   of magnitude, and that residual share is what is left.

   DNB_SPAN IS NOT PHYSICS AND IS NOT DERIVED. A real post-CHF transition is a
   wall-superheat problem, not a band on a margin ratio; the width exists so a
   hard switch at 1.0 cannot chatter against the lagged void and flow this loop
   already reads, which is the BURST_SPAN/CAV_SPAN idiom. The VALUE was chosen
   against the presets: no plant's rest-point node minimum may sit on the ramp,
   and RBMK binds it at 1.25, so the ceiling goes below that with room to spare.
   0.25 passes too and leaves RBMK 0.004 clear, which is noise rather than
   margin. Replacing this with a superheat criterion in the film term is the
   real fix and would delete the constant.

   P.dryout is which families departure is a real event for. Helium never
   boils, so a film that collapses is a fiction there; MSR's fuel is IN the
   coolant, so it has no film to lose either, and it is already receiving a
   burst and a melt it should not - this does not deepen that hole. */
const DNB_FILM=0.10, DNB_SPAN=0.15;
const dnbFilmK = d =>
  P.dryout ? DNB_FILM+(1-DNB_FILM)*clamp((d-1)/DNB_SPAN,0,1) : 1;
/* THE NODE's margin, called from inside coreStep()'s loop. Every operand is a
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
/* ── AND THE SAME PAIR FOR A MACHINE STANDING IN A HOT ROOM ──
   ROLE.tsurv (layout.js) is where each machine gives up; these two are the
   RAMP and the TIME, the identical BURST_SPAN/BURST_TAU idiom, so a part
   sitting exactly on its own limit cannot chatter in and out of the damage
   list. Neither is a published figure and neither pretends to be: a real
   answer is a thermal mass and a failure mechanism per component, which is a
   plan of its own. */
const ROOM_DMG_SPAN=60, ROOM_DMG_TAU=25;
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
// CORE_DT0 lives in pipenet.js: layout.js's pump-flow suggestion reads it, and
// that runs at module load, where a const declared in this file is still in TDZ
const CORE_DT_QMIN=0.004, CORE_DT_MAX=250;
// the rise at RATED flow, which is what a plant that has only just been
// commissioned already has in it
const coreDTRated = heat => CORE_DT0*heat;
/* ══ A SOLVED CURRENT IN KILOGRAMS ══
   The solve's currency is % of loop inventory per second; this is the one
   conversion out of it, and the whole sim already books tank flow and the
   secondary mass balance through it. It was a local inside advectStep() while
   the pipe meters were normalising on a per-KIND nominal of their own. */
const netKgs = q => Math.abs(invRate(q))/100*loopKg();
/* ══ THE INVENTORY LEDGER ══
   Every kilogram of water the plant holds, and every named way one leaves. A
   tick that does not close has lost or invented water, and the residual is the
   term nobody wrote down. A DEV INVARIANT: it warns, it never throws - killing
   a player's run over a book-keeping slip is worse than the slip.
   A HOLD TANK IS NOT A STORE. Its level is s.lvl, which netExpSurge() moves on
   thermal expansion rather than on mass, so booking it would open the ledger
   every time the loop warmed up. It is a pressure boundary; the water in it is
   already the loop's. An `inf` tank is not a store either - its level never
   moves (see the level loops below), so it is a boundary and books as a term. */
const LEDGER_EPS = 1e-7;               // fraction of M0 - a solved quantity never meets a bare compare
const ledgerKg = s => { let m = (s.inv||0)/100*loopKg();
  for(const id of tankIds()){ const t=D.tanks[id];
    if(!t.inf && !t.hold) m += (s.tank&&s.tank[id]!==undefined?s.tank[id]:t.level)/100*tankKg(id); }
  for(const id in s.sglBy){ const M=sgMassOf(id); if(M>0) m += s.sglBy[id]/100*M; }
  for(const id in s.sgSteamBy) m += s.sgSteamBy[id];
  return m; };
const ledgerOut = s => { let k=0; for(const n in s.massOut) k += s.massOut[n]; return k; };
// kg out of the plant, by name. Negative is a boundary feeding it.
const book = (s,name,kg) => { if(kg) s.massOut[name] = (s.massOut[name]||0) + kg; };
/* ══ EQUILIBRIUM IODINE AND XENON AT A FLUX ══
   Written once and asked three times: of the core average (P.X0), of the
   kinetics seed, and of each NODE in coreReset(), which is the only one of the
   three that is not the average. */
const ioEq = fl => P.gI*fl/P.lamI;
const xeEq = fl => (P.gI+P.gX)*fl/(P.lamX+P.sig*fl);
/* ══ THE KINETICS AT A COMMISSIONING POWER ══
   The five expressions that put a core on its own delayed-neutron equilibrium,
   out of the middle of resetPlant()'s state literal so they can be read as one
   thing. Raising P.n0 to the power the settled flow can actually carry was
   tried here and is WRONG: it steps a plant onto a power its flux trip has no
   margin for, and RBMK-1000 - positive void, and the least margin of the seven
   - tripped in half a second on the 14 % step it was handed. */
function seedPower(s, n0){
  s.n     = n0;
  s.C     = P.bet.map((b,i)=>b*n0/(P.LAM*P.lam[i]));
  s.I     = ioEq(n0);
  s.dec   = DEC_A.map(a=>a*n0);
  s.decay = DEC_A.reduce((t,a)=>t+a,0)*n0;
  s.heat  = s.n*PROMPT_F + s.decay;
}
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
const tiltRate = () => rodRate()/XTILTZ;
const tsat=p=>satT(P.sat,p);
/* The coolant temperature programme: where T-avg is meant to sit for the load
   the turbine is drawing. One function, because the rod controller walks to it,
   the steam dump trims to it, the TAVG DEV tile judges against it and the panel
   prints the deviation from it - and a PWR number hard-coded in any one of
   those lights the alarm on every plant that is not a PWR. Through a trip the
   runback takes the load off, so the programme drops to its no-load point; with
   the runback bypassed the turbine is still drawing, and the programme has to
   keep following it.
   A PLANT WHOSE PRESSURE IS ITS SATURATION TEMPERATURE HAS A FLAT PROGRAMME.
   The 18 K slope is a PWR's, and it is right there because a pressurizer holds
   the pressure up independently; under P.steam the same slope is 2.6 MPa of
   blowdown against a LOW PRESSURE setpoint 0.98 MPa below the design point. A
   real BWR holds its dome near 7 MPa at every load. At full load the two
   expressions give the same number, so no rest point moves. */
const TPROG_SPAN=18;                    // K of programme across the load range
const tProg=s=>(s.scrammed && autoLive("runback")) ? P.Tref-TPROG_SPAN
             : P.steam ? P.Tref : P.Tref-TPROG_SPAN + TPROG_SPAN*s.load;
/* WHAT THE TURBINE IS ACTUALLY TAKING, as a share of what this plant raises at
   full load - the steam side's own answer, not the governor's setting. */
const turbShare = s => P.steamRef>0 ? (s.turbWk||0)/P.steamRef : 0;
/* WHAT EVERY MACHINE'S GATE IS DOING, for vapSolve(): the governor as an
   OPENING of the fitted swallow, the bypass beside it. One door, because the
   tick and the commissioning settle must ask the same question of the same
   drawing. A MACHINE CANNOT PASS MORE THAN IT CAN SWALLOW, so the opening
   stops at P.swallow: the load slider stops at P.loadMax, but the limit is a
   property of the turbine and not of the widget. The BYPASS is a second gate
   on the same path and does no work; it is NOT passK-gated, because dumping
   is what a plant does after the turbine has tripped. */
const vapOpenAt = (s, dump) => {
  const passK = clamp(roleAlive("turb",s.dmgParts)*turbPiped()*(s.turbTrip?0:1), 0, 1);
  const swOpen = Math.min(s.load, P.swallow/Math.max(P.steamRef,1e-9));
  const o = {};
  for(const p of LAY.parts) if(ROLE[p.role] && ROLE[p.role].vapPath){
    const alive = clamp(roleAlive(p.role,s.dmgParts), 0, 1);
    o[p.id] = {work: P.turbKv*swOpen*passK, dump: P.turbKv*dump*alive}; }
  return o; };

/* ONE PUMP'S OWN STARTING SPEED. A coolant pump answers the plant-wide lever,
   so the bench sets one number for all of them; any other pump answers only
   for itself - the same two spans ctlFor()'s own slider already has. */
/* AND A STANDBY TRAIN COMMISSIONS STOPPED. Asked of the DRAWING (pumpStandby),
   never written into D.start: a preset's designForgetBags() clears that bag
   AFTER buildStockPlumbing() has run, so a starting position stated there is
   silently dropped and the machine comes up at rated. A default is derived,
   like every other suggestion on this plant, and any reserve pump the player
   pipes up behaves the same way without a row anywhere. */
const pumpDem0 = id => pumpStandby(id) ? 0 : 1;
const pumpStart = id => primaryPump(id) ? startOf("flowDem",1)
                                        : startOf(id+":pumpDem", pumpDem0(id));
const loadStart = () => Math.min(startOf("loadDem",1), P.loadMax);
function resetPlant(){
  const x0=startOf("rodCommon",RODX0);
  S={n:0,C:null,I:0,X:P.X0,
     Tf:P.TfRef,Tavg:P.Tref,rodPos:x0,rodDem:x0,rodJam:false,rodBand:false,scrammed:false,
     /* COMMISSIONED AT SOMETHING THE FITTED PLANT CAN DO. The starting position
        is the designer's (D.start), but a turbine that swallows half of what
        this boiler raises cannot be asked for all of it on tick one - the plant
        used to commission demanding twice the machine and trip on high flux
        about thirty seconds later. The ceiling is the machine's, so it applies
        to where the plant starts as much as to where the slider stops. */
     load:loadStart(),loadDem:loadStart(),flowNet:1,P:P.P0,lvl:54,inv:100,
     /* ONE SETPOINT PER NON-PRIMARY CIRCUIT THAT SOMETHING AUTHORS, keyed by
        circuit index. Seeded below, once the drawing is known: a circuit with
        no hold tank gets no entry at all. */
     PBy:Object.fromEntries(holdCircs().filter(ci=>ci!==nodeGraph().coreCirc)
                                       .map(ci=>[ci,holdSetP(ci)])),
     scBy:{},
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
     sgTBy:{}, steamBy:{}, steamTo:{},
     /* THE STEAM SIDE'S OWN PRESSURE FIELD, MPa by node name - refilled by
        vapSolve() and read back by it next tick, because a compressible
        conductance depends on the answer it is part of. Named rather than
        indexed, so it survives a snapshot like s.hBy does. */
     vapP:{}, vapQ:{},
     /* kg/s across the turbine wheels and the MPa it saw doing it. Plant
        level: a header mixes, so the steam reaching the machine has no
        generator's name on it. */
     turbWk:0, turbP:0,
     /* kg/s of secondary water going overboard through a machine that is open
        to atmosphere - a relieved condenser, a severed exhaust. A READOUT and
        a ledger entry: retK used to delete this mass instead of naming it. */
     condVent:0, condVentSeen:false,
     /* AND THE STEAM ITSELF, kg. The shell's second inventory: what boiled and
        has not left yet. Seeded below off saturation in the steam space, so a
        plant commissions on the mass its own pressure implies. REFILLED. */
     sgSteamBy:{},
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
     /* EACH PANEL's own temperature, K - the sink the plant HAS, as against
        RAD_TDES, the sink its machinery was designed for - and what each is
        pulling out of the water in it, kW. Per instance because a panel cools
        the circuit it is plumbed to and two panels need not be on one.
        REFILLED by step(), never rebuilt. */
     radTBy:{}, radQBy:{},
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
     /* the groups start in equilibrium with commissioning power (seedPower(),
        below), or the plant would spend its first minutes breeding heat it
        should already have */
     dec:null, decay:0,
     byp:Object.fromEntries(AUTOKEYS.map(k=>[k,!!startOf("byp:"+k,false)])),
     breach:false,melt:false,trip:"",
     /* Both LATCHED, and both about the same number: the turbine's stop valve
        once exhaust pressure got away from it, and the condenser once it went
        past atmospheric and relieved. */
     turbTrip:false, condLost:false,
     ev:{}, blackout:false, nat:0, release:0,
     /* the board's own lit set, refilled never rebuilt, and a count of every
        tile transition it has seen. Beside s.ev because it is the same kind of
        thing: a fact the tick establishes once and everything else reads. */
     annOn:{}, annRev:0,
     /* the cooling circuit's solved flow, fed forward like s.cavP - starts on
        the commissioned reference, so tick zero rejects at the design duty */
     cwFlow:P.cwRef||0,
     /* and the temperature that water arrives at, K - fed forward the same
        tick, because what the condenser rejects is what warms the water whose
        temperature decides what it can reject */
     cwInT:RAD_TDES,
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
     /* THE LEDGER'S OWN BOOK, kg out of the plant by named term - plain
        numbers, so snapVal() takes it, and cumulative, so a tick differences
        it rather than clearing it. */
     massOut:{}, massRes:0, massWarn:false,
     /* what each tank's own AUTORULE decided last tick. A rule with two
        setpoints has to know whether it is already running, and this is the
        only place that memory can live - on S, so it rides a snapshot. */
     tankAuto:Object.fromEntries(tankIds().map(k=>[k,false])),
     /* what each tank's own edge is carrying, % of loop inventory per second,
        tank-out-positive - a readout, REFILLED never rebuilt, because a
        renderer holds it across frames to meter that tank's own line */
     tankRate:{},
     /* ══ THE ENTHALPY FIELD, AND THE PRESSURES IT IS READ AGAINST ══
        Plain objects keyed by NODE NAME, because snapVal() (record.js) takes
        a plain object keyed by a string and node names are a deterministic
        function of LAY.parts at commission time - the design cannot change
        while a tick is running. Refilled by step(), never rebuilt. */
     hBy:{}, pBy:{},
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
     /* ONE ISOLATION VALVE PER PORT, and every one of them commissions OPEN.
        There is no starting position for these: they are the watch's own
        emergency handles, fitted with the nozzle, bought with the nozzle, and
        a plant nobody has isolated anything on is bit-identical to one with no
        port valves at all (portOpen(), pipenet.js). */
     portShut:Object.fromEntries(Object.keys(D.ports).map(k=>[k,false])),
     ...autorodTune(), arDE:0, arLo:P.arLo, arHi:P.arHi,
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
     /* one cavitation figure per PUMP, keyed by its own id and read at its own
        suction - s.cav beside it is the worst of them, which is what the
        annunciator and the panel want. A plain object, so snapVal() takes it
        for free. */
     cavP:Object.fromEntries(pumpIds().map(id=>[id,0])),
     /* AND ONE FLOW PER PUMP, kg/s, for its own head-flow curve (pumpCurve(),
        pipenet.js). Seeded off the REFERENCE's own converged answer, so tick
        one develops the head the plant was commissioned on rather than a duty
        head nothing on this drawing produces. */
     pumpQBy:Object.fromEntries(pumpIds().map(id=>[id,(P.pumpQRef&&P.pumpQRef[id])??pumpFlow(id)])),
     dose:0, crewDose:0, doseRate:P.dose, repRate:0, partySpent:false,
     bkpLost:false, dLvl:0,
     boron:0,boron0:0,boronDem:0,parts:{rod:0,dop:0,mod:0,exp:0,xe:0,bor:0,vd:0,tip:0},
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
     /* what each PRIMARY relief fitting is passing, % of loop inventory per
        second - the secondary's own s.reliefSteam already existed and this is
        its primary twin. A readout, refilled never rebuilt. It exists because
        a stuck-open PORV venting into the room is the TMI-2 sequence and the
        room had no way to ask what that valve was passing. */
     reliefVent:{},
     /* ══ THE ROOM ══
        Two fields on S, in the s.nDmg/s.nOx/s.nMelt shape: kelvin of air in
        every cell, and kilograms of hydrogen in every cell. They are STATE,
        unlike the radiation field, which is solved fresh every tick - heat
        that arrived has to still be here next tick, and a field with no
        memory leaves nothing for a cooling machine to remove. See
        src/data/room.js for why that difference is the whole design.
        The room starts at ambient, which is the hull the plant sits in. */
     roomT:new Float64Array(GW*GH).fill(T_HULL), roomH2:new Float64Array(GW*GH),
     /* AND THREE MORE, in the same shape and for the same reason. Oxygen is
        what makes "how violently" an answer rather than a curve somebody
        picked, so it is seeded at what air actually holds; the flame is how
        far a front has crossed each cell; the pressure is what breaks things.
        They are declared HERE and nowhere else - the snapshot cloner throws
        on anything it does not know, and a field left in a module global is
        exactly what that throw exists to catch. */
     roomO2:new Float64Array(GW*GH).fill(ROOM_O2_0),
     roomFlame:new Float64Array(GW*GH), roomP:new Float64Array(GW*GH),
     /* ONE EVENT PER EXPLOSION, not one per tick. A front at the flammability
        limit crawls for minutes and would never trip a per-tick gate, so the
        charge, the peak and what it took are accumulated while anything is
        burning and the line is written when the last flame goes out. */
     burnEv:{kg:0, p:0, blast:0, ids:[]},
     /* how far each machine is through being cooked by its own cell, 0..1 -
        MONOTONIC while it is over its limit, and cleared when a party fixes
        it, or a repair in a room still cooking would be undone the same tick
        it finished. Keyed by part id, refilled never rebuilt. */
     roomHurt:{},
     /* THE SKIN OF EACH MACHINE, K, and what its contents are giving up
        through it, kW. Seeded by roomStep() off partTemp() on the first tick
        rather than here: what a machine contains is not known until the pots
        exist. Keyed by part id, refilled never rebuilt. */
     partT:{}, skinQ:{},
     // readouts: the hottest cell, where it is, and what burned this tick
     roomMax:T_HULL, roomMaxAt:-1, roomBurnOn:0, roomPMax:0,
     // how fast the two shafts are turning, deg/s - see step()'s own note
     spinV:0,spinTV:0,dTavg:0,heat:0,sc:0,t:0,tick:0};
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
  /* AND A PLANT WITH NO VESSEL COMMISSIONS COLD. Seeded at P.n0 it started
     with a full core's worth of decay heat in the chains and spent the next
     hour shedding heat no reactor had made. Zero is not a special case - it is
     seedPower() asked for the power this plant is actually at. */
  seedPower(S, P.vessel ? P.n0 : 0);
  /* the rated-flow value of the same expression the tick uses - a plant on
     tick zero is at rated flow by construction, so its rise is coreDTRated()
     even though s.coreDT has not walked up to it yet */
  S.sc   = tsat(S.P) - (S.Tavg + coreDTRated(S.heat)/2);
  /* The shell starts where the old formula put it, so nothing pinned against a
     plant at rest moves. From here it is an integral. */
  for(const id of sgIds()) S.sgTBy[id] = tsatSec(secPTarget(S,id), shellCirc(id));
  /* The pot starts between the two stages it stands between, which is where a
     settled plant puts it anyway - starting it at Tavg would hand a generator
     the whole primary temperature for one tick and kick a transient nobody
     caused, the same argument s.coreDT's own seed makes. */
  for(const id of ihxIds())
    S.ihxTBy[id] = S.Tavg - (S.Tavg - tsatSec(secPTarget(S,ihxSgs(id)[0])))/(1+IHX_UA);
  /* ══ THE PANELS COMMISSION WHERE THIS PLANT'S HEAT PUTS THEM ══
     RAD_TDES is the DESIGN sink - the anchor P.condUA and condPDes() are
     fitted at - and it stays that. It is not where a given ship's panels
     actually sit: the fleet is drawn geometry priced off the stock plant, so
     a 55 MW pile carrying a 1200 MW ship's panels commissioned 800 MW above
     what it rejects and dumped the difference out of the pot's own stored
     heat in the first ten seconds. radTAt() is the bench's own expression. */
  /* ONE temperature over the fleet, because at rest every panel sits at the
     one where the fleet sheds the load: rejection is emis*area*T^4, so a
     common T is the solution whatever the mix of coatings and sizes. */
  { const q = P.rated*P.n0*(1-P.eff)*1000, r = condRest(q);
    for(const id in S.radTBy) if(!partOf(id)) delete S.radTBy[id];
    for(const id of radIds()) S.radTBy[id] = r.radT;
    /* AT REST A PANEL TAKES OUT WHAT IT SHEDS. Seeded, not left at 0: the
       transport is settled below with these terms live, and a panel absorbing
       nothing while the condenser pushed its full rejection into the same
       water commissioned the cooling circuit ten kelvin hot. */
    for(const id of radIds()) S.radQBy[id] = radRejOf(S,id);
    S.cwInT = r.cwIn;
    S.condT = r.condT; }
  /* Settle the flux shape first, then dial in the boron that actually makes
     THIS shape critical. Rod worth is emergent now, so a formula would leave
     the plant slightly off-critical and walk it into a trip nobody caused. */
  coreReset(S);
  /* ══ AND THE PLANT COMMISSIONS AT ITS OWN FLOW, NOT AT A TYPED 1 ══
     s.flowNet is the SOLVED flow over P.netRef, and P.netRef is deliberately
     ISOTHERMAL - a geometric figure that prices this plant's piping and its
     pumps and contains no buoyancy. On a pressurised water plant the two are
     within a percent of each other and a typed 1 was harmless. On a plant
     whose buoyancy is a real fraction of its drive - a hot gas column, a
     natural-circulation loop - they are not the same number at all: WINDSCALE
     commissioned at 1.00, its own first solve found 1.63, and that step
     cooled the fuel 22 K, added 159 pcm of Doppler and tripped it on high
     flux in 1.2 seconds. Nobody had touched a control.
     WHAT ACTUALLY TAKES THE SECOND: buoyancy is read off the ENTHALPY FIELD,
     and s.hBy starts uniform - every node at s.Tavg, no hot leg, no cold leg,
     so no column to weigh and the first solve reads exactly the isothermal
     reference. So the field is settled here, by running the transport against
     its own solve until the two stop moving - which is what a plant that has
     been running HAS.
     AT THE SIM'S OWN dt, and that is load-bearing. A big step looks cheaper
     and is unstable: the Courant blend clamps at 1, so one pass slams every
     node onto its donor, which slams the buoyancy, which slams the flow. Run
     that way the loop did not converge at all - the solve swung between 0 and
     5.1 times reference and never settled. At 0.02 it damps itself, because
     that is the damping the plant actually has.
     THE RISE IS core2d's OWN, never a formula written out twice: at dt 0
     every integral in coreStep() is a no-op and what is left is the algebra -
     the channel split, the ring shape, s.coreDT. */
  /* ══ ON THIS PLANT'S OWN HEAT, NOT THE LAST TICK'S ══
     advectSrc() reads HEATBAL, which step() writes, so the first settle of a
     fresh page moved no heat at all - no hot leg, no buoyancy, BN-600 found
     1.000 where its own tick finds 1.084 and the UA refit above divided by
     it - and every plant commissioned after it settled on the PREVIOUS
     plant's core power and generator heat. Seeded here from the same
     expressions the tick uses: the heat at the seeded power, and each
     generator's share of it at the flow the settle is finding. */
  const restHeat = (byLoop) => {
    const sh = sgShare(byLoop), n = Math.max(1, sgIds().length), filmK = 1-0.85*Math.min(clamp(S.vf,0,1.5),1);
    for(const id in HEATBAL.sgQBy) if(!(id in sh)) delete HEATBAL.sgQBy[id];
    for(const id in sh){ S.sgShare[id] = sh[id];
      HEATBAL.sgQBy[id] = sgQAt(S, id, Math.max(P.flowK*S.flowNet*sh[id]*n, 0.02), filmK); } };
  HEATBAL.heat = S.heat;
  /* WITH A PRESSURE FIELD, because the solve is keyed on last tick's: a
     standby train's check valve reads wide open until there is one
     (pumpFwd, pipenet.js), and a node's phase is read at s.P until there is
     one - so the settle put BN-600's 490 K feedwater at 0.2 MPa and ran the
     feed pump's water back down the reserve train into its tank, and the
     first real tick, field in hand, sent 40 % more feedwater to the shells
     than the seed had. */
  const outs = {noNat:true}, rf = {};
  { const DTS = 0.02;
    for(let i=0;i<300;i++){
      const pf = {}, k = netFlowK(S, rf, pf, outs);
      keepPField(S, pf);
      const was = S.flowNet;
      if(k > 0) S.flowNet = k;
      restHeat(outs.byLoop);
      coreStep(S, 0, S.heat, tsat(S.pCore), 0,
               P.flowK*S.flowNet, Math.max(S.flowNet, CORE_DT_QMIN));
      advectStep(S, DTS, rf);
      if(i > 20 && Math.abs(S.flowNet - was) < 1e-5) break;
    } }
  /* AND CRITICAL AT THE SETTLED POINT, NOT AT THE COLD ONE. coreReset()
     allocates the field and then dials the boron that makes THIS shape
     critical, so it has to see the rise the plant actually runs at - run once
     before the settle, it left the core off-critical by exactly the
     reactivity the settle had just moved. It reallocates rather than
     accumulates, so running it twice is running it once. */
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
  /* CRITICAL ON THE LEDGER THE FIRST TICK WILL READ, not on the seeded shape.
     coreRodWorth() on the bare solve missed every term the real step adds -
     the channel's own temperature profile, the node xenon, the rest void, and
     the flux they move - and the stock PWR commissioned 105 pcm subcritical, a
     14 % prompt drop on tick one that the coolant coefficient then hid. At dt 0
     coreStep() is the algebra alone, so this is the first tick's balance with
     nothing integrated; the void is seeded at its own target because a plant
     that has been running has its rest void already, and the pellet lands on
     the film that void leaves it. Five passes, because the void moves the
     shape, the shape moves the void, and the pellet follows both.
     BEFORE THE STEAM SIDE, because the tubes' film reads the rest void: a
     BWR seeded ahead of it raised 15 % more at the seed than on tick one. */
  { let o=null;
    for(let i=0;i<5;i++){
      o=coreStep(S,0,S.heat,tsat(S.pCore),0,P.flowK*S.flowNet,Math.max(S.flowNet,CORE_DT_QMIN));
      for(let k=0;k<XNN;k++) S.nV[k]=S.nVt[k]; }
    S.boron = S.boron0 = -(P.excess+o.rod+o.tip+o.dop+o.mod+o.exp+o.xe+o.vd);
    S.voidTh = S.vf = S.vNode; }        // the rest void P.vf0 is read off, not a 0 the first tick overwrites
  S.boronDem = S.boron;                 // start on demand, or it walks off commissioning
  /* ══ AND THE STEAM SIDE IS SEEDED, NOT DISCOVERED ══
     vapSolve() prices every conductance off last tick's field, and on tick
     one there was none: every free node started at the condenser's pressure,
     so the first solve saw the whole shell-to-condenser differential across
     the governor and passed 1 800-6 000 kg/s per shell for one tick. The
     steam space emptied, the shell fell 0.6 MPa, T-avg dipped and the rod
     controller pulled the bank for a minute chasing it.
     AND EACH SHELL SITS WHERE ITS OWN LINE PUTS IT. A header is a chain of
     tees, so at one common pressure the shell nearest the turbine pushed
     five times what the farthest did (BN-600, 537 / 212 / 105 kg/s against
     290 raised each) and the plant spent a minute re-levelling them. Each
     shell's pressure is walked to the one that pushes what it raises into
     the header it sees, on the solver's own conductance law, neighbours held,
     and the network re-solved until every shell agrees; the heat crossing
     follows the shell's own saturation as it moves. The readouts are then
     what tick one will read. */
  { const V = P.net && P.net.vap;
    let vap = null;
    // the field first, at the seeded pressure: a walk started from an empty field starts from the surge
    for(let i=0;i<50 && V;i++){
      const was = Object.assign({}, S.vapP);
      vap = vapSolve(S, vapOpenAt(S, condAvail(S) ? dumpPOf(S) : 0));
      if(!vap) break;
      let dmax = 0;
      for(const k in S.vapP)
        dmax = Math.max(dmax, Math.abs(S.vapP[k]-(was[k]??0))/Math.max(S.vapP[k],1e-4));
      if(dmax < 1e-6) break; }
    /* Newton on the shells' pressures, the residual being what each passes
       against what it raises, the Jacobian taken off the solve itself by
       finite difference. A shell-by-shell walk with its neighbours held was
       tried first and crawls: the header follows the shells almost one for
       one, so each pass moved the split and hardly the level. */
    const shells = V ? V.srcPart.slice() : [], n = shells.length;
    const pOf = () => shells.map(id => secP(S,id));
    const setP = p => shells.forEach((id,j) => { S.sgTBy[id] = tsatSec(p[j], shellCirc(id)); });
    const solve = () => { restHeat(outs.byLoop); vap = vapSolve(S, vapOpenAt(S, condAvail(S) ? dumpPOf(S) : 0));
      return shells.map(id => (vap.out[id]||0) - (HEATBAL.sgQBy[id]||0)/riseSg(id, secP(S,id))); };
    for(let i=0;i<40 && vap && n;i++){
      const p = pOf(), r0 = solve();
      let err = 0;
      shells.forEach((id,j) => { const w = (HEATBAL.sgQBy[id]||0)/riseSg(id, p[j]);
        if(w > 0) err = Math.max(err, Math.abs(r0[j])/w); });
      if(err < 1e-6) break;
      const J = [];
      for(let j=0;j<n;j++){ const dp = 1e-3*p[j], q = p.slice(); q[j] += dp; setP(q);
        const r1 = solve(); J.push(r1.map((v,i2) => (v - r0[i2])/dp)); }
      // J[j][i] is d r_i / d p_j; eliminate on the transpose for the step
      const A = [], b = r0.map(v => -v);
      for(let i2=0;i2<n;i2++){ A.push([]); for(let j=0;j<n;j++) A[i2].push(J[j][i2]); }
      for(let c=0;c<n;c++){ let piv = c;
        for(let r=c+1;r<n;r++) if(Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
        [A[c],A[piv]] = [A[piv],A[c]]; [b[c],b[piv]] = [b[piv],b[c]];
        if(!(Math.abs(A[c][c]) > 1e-12)) continue;
        for(let r=c+1;r<n;r++){ const f = A[r][c]/A[c][c];
          for(let k=c;k<n;k++) A[r][k] -= f*A[c][k]; b[r] -= f*b[c]; } }
      const d = new Array(n).fill(0);
      for(let c=n-1;c>=0;c--){ let s = b[c];
        for(let k=c+1;k<n;k++) s -= A[c][k]*d[k];
        d[c] = Math.abs(A[c][c]) > 1e-12 ? s/A[c][c] : 0; }
      setP(p.map((v,j) => Math.max(P.Pcont, v + clamp(d[j], -0.2*v, 0.2*v)))); }
    if(vap && n) solve();
    if(vap){ S.turbWk = vap.work; S.turbP = vap.pIn;
      for(const id of sgIds()){ S.steamTo[id] = vap.out[id]||0;
        S.steamBy[id] = (HEATBAL.sgQBy[id]||0)/riseSg(id, secP(S,id)); } } }
  /* ══ AND THE FEED VALVE IS WHERE THE CONTROLLER WOULD HAVE LEFT IT ══
     Wide open (0) is what a plant nobody has touched started at, and wide
     open is three times the boil-off on the stock plant and twenty on a
     once-through shell: BN-600 took 6 700 kg/s of feedwater per 7 t shell on
     tick one, cooled 2 K a tick, and that - not the steam line - is what ran
     its shells from 17.0 to 15.4 MPa in the first second. Each valve is
     bisected against the liquid solve to the back-pressure at which its own
     shell edge carries what the shell raises; the shells share a header, so
     the round is repeated until they agree. A pump that cannot make the flow
     at any position leaves its valve on the stop, which is the truth. */
  { const ids = sgIds();
    const solveFeed = () => { const o = {noNat:true}, pf = {}; netFlowK(S, rf, pf, o);
      keepPField(S, pf); return o; };
    const fedOf = id => { const o = solveFeed();
      return invRate((o.sgFeedBy && o.sgFeedBy[id]) || 0)/100*loopKg(); };
    for(let r=0;r<6 && ids.length;r++){
      let moved = 0;
      for(const id of ids){ const want = S.steamBy[id]||0; if(!(want > 0)) continue;
        const was = S.fregBy[id], f = v => { S.fregBy[id] = v; return fedOf(id) - want; };
        // regula falsi with the Illinois halving, on a bracket the valve's own stops give
        let a = 0, fa = f(a), b = fregMax(id), fb = f(b), side = 0;
        if(fa <= 0){ S.fregBy[id] = a; continue; }
        if(fb >= 0){ S.fregBy[id] = b; continue; }
        for(let k=0;k<30;k++){
          const c = (a*fb - b*fa)/(fb - fa), fc = f(c);
          if(Math.abs(fc) < 1e-6*want){ a = b = c; break; }
          if(fc > 0){ a = c; fa = fc; if(side === 1) fb /= 2; side = 1; }
          else       { b = c; fb = fc; if(side === -1) fa /= 2; side = -1; } }
        S.fregBy[id] = (a+b)/2;
        moved = Math.max(moved, Math.abs(S.fregBy[id]-was)/Math.max(fregMax(id),1e-9)); }
      if(moved < 1e-5) break; }
    // the field, the pumps' own flows and the pressures at the valves as finally left, not at the last trial
    if(ids.length) solveFeed(); }
  /* And the steam space starts full of saturated steam at the shell's own
     rest pressure. Seeded HERE and not on first use: a shell that grew its
     own charge out of nothing on tick one would put that mass into the
     plant's books as a gain. */
  for(const id of sgIds()) S.sgSteamBy[id] = sgSteamEq(S,id);
  /* ══ AND THE CONDENSER SITS ON THE WATER THAT ACTUALLY ARRIVES ══
     condRest() is the bench's estimate and the panels' seed; the circulating
     water's own temperature is what the settled field says it is, read the
     way the tick reads it, and the pot sits where that water and the steam
     the walk above sends it put it. Seeded on the estimate, the inlet read
     7 K colder than the field and the condenser's rejection halved on tick
     one (828 to 371 MW on BN-600). */
  { const t = cwInOf(S, rf); if(t !== undefined) S.cwInT = t;
    let boiled = 0; for(const id of sgIds()) boiled += S.steamTo[id]||0;
    const qIn = Math.max(0, boiled*steamRise() - S.turbWk*turbDh(S.turbP, condP(S))*P.eff);
    const c = cwC(S), eps = c>0 ? 1-Math.exp(-P.condUA*condK(S)/c) : 0;
    if(c>0 && eps>0) S.condT = S.cwInT + qIn/(c*eps); }
  /* THE SIM DOES NOT REQUIRE A DISPLAY. pipeReset()/fxReset() clear the pipe
     animation's and the ambient effects' smoothing, which only exist when
     something is being drawn - a headless runner (the auditors, a scenario
     run) loads no renderer at all. The guard is the honest shape of that: ask
     whether there is a display before telling it the clock moved. */
  /* the board is swept on a cadence from here on, so tick zero has to be swept
     by hand or a plant commissioned with a tile already lit reads blank until
     the fifth tick */
  laySettle(); annStep(S); layRelease();
  LOG=[]; initHist();
  if(typeof pipeReset==="function") pipeReset();
  if(typeof fxReset==="function") fxReset();
  logE("info","PLANT AT POWER",
    P.name+" commissioned at "+P.rated.toFixed(0)+" MWt, holding "+(P.n0*100).toFixed(1)+"% - pipe run and pump head decide how much of the rating the loop can actually carry. Everything that happens from here is logged with the reason.");
}
/* THE THREE RUNS WITH A CORRELATION OF THEIR OWN became TWO. `feed` is gone
   from here: feedwater is a solved flow through a real pump now, so the
   packets on it move on that run's own answer like every hot leg's do, and
   driving them off s.load was the animation showing a rate the sim was not
   performing - the exact fault audit-text.js already pins against the vent
   plume. hpi and surge keep theirs because both are tagged hot/cold for
   BUOYANCY rather than for circulation, so their tagged flow is not what
   the pipe carries. Out here rather than in step(): it is a constant, and one
   built per tick is one built two thousand times a second at max rate. */
const PIPE_CORR={hpi:1,surge:1};
function step(dt){
  const s=S; s.t+=dt; s.tick++;
  if(!s.massOut) s.massOut={};
  const ledgM0 = ledgerKg(s), ledgO0 = ledgerOut(s);
  /* Settle the node graph for this tick and hold it. Nothing below redraws the
     plant, and ~85 readers ask for it - see nodeGraph(), layout.js. The hold is
     dropped on the last line of this function, so it never outlives the tick. */
  laySettle();

  /* ── control rods ──
     T-avg error alone is two integrations away from rod position, so on a
     weakly self-limiting core (small moderator coefficient) the bank hunts and
     the swing grows until the RPS trips it. The rate term is the lead
     compensation a real rod controller uses: it stops pushing once T-avg is
     already moving the right way. Both the gain and the lead are the operator's
     to get wrong. Note s.dTavg is last tick's rate - it is computed further down
     - and that one-tick lag is part of the tune this was fitted with. */
  /* ══ AND THE POWER MISMATCH, WHICH IS WHAT A REAL ROD CONTROLLER RUNS ON ══
     A Westinghouse rod control system takes T-avg error AND the mismatch
     between nuclear power and TURBINE power, and the mismatch is what stops
     it: the reactor follows the machine drawing the steam. Without it this
     controller was a pure integrator against a setpoint a plant might not be
     able to reach, and it had no stop in it at all - WINDSCALE walked 0.13 of
     rod over seventy seconds chasing 3 K it never got back, which on that core
     is 250 pcm, and rode its own correction into the flux trip.
     IN KELVIN, through the programme's own slope: TPROG_SPAN is what a full
     load range is worth in T-avg, so it is the conversion the plant already
     states rather than a second gain to tune.
     ONE-SIDED, and that is the whole of it. It STOPS the bank going further
     out once the core is already making more than the machine is taking; it
     never pulls the bank out to chase a power the plant may not be able to
     raise. Two-sided it holds T-avg a permanent 2 K off programme on any plant
     whose loop cannot carry its own rating - which is every plant here - and
     that is an offset nobody asked for. A plant below its turbine's draw is
     bit-identical to one with no mismatch term at all. */
  /* THE ERROR THIS CONTROLLER IS ON, in kelvin, and the two differences the
     velocity form needs. s.dTavg is the plant's own answer for the first one
     and is exact; the second is differenced off it, which is why arDE is on S
     and not recomputed from a temperature history nobody keeps. */
  const arE = clamp(s.Tavg-tProg(s) + TPROG_SPAN*Math.max(0, s.n - turbShare(s)), -6, 6);
  const arDE = s.dTavg;
  const rodErr = s.arKp*(arDE + arE/s.arTi + s.arTd*(arDE - s.arDE)/Math.max(dt,1e-9))*dt;
  s.arDE = arDE;
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
    const r=s.scrammed?P.scram:rodRate();
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
      s.tilt+=Math.sign(d)*Math.min(Math.abs(d),tiltRate()*dt); }
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
  /* WHAT THE CIRCULATING WATER IS ACTUALLY DOING, off this tick's own solve -
     the condenser's heat balance below reads it through cwK(). */
  s.cwFlow = cwFlowOf(runFlow);
  /* THIS RUN AGAINST ITS OWN REFERENCE, signed. 1.0 is what it was built to
     carry; the direction is the solve's. Up here rather than beside the pipe
     animation that first needed it, because the panels' heat balance asks the
     same question of the same tick's solve. */
  const runRatio = key => { const r = Math.abs(P.netRefByRun[key]||0);
    return r > 1e-9 ? (runFlow[key]||0)/r : 0; };
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
    /* ONE CURRENCY. This used to rescale a non-primary tank into the
       secondary's own charge, because tankKg() did the same - and both were
       there only because a tank's size was a PERCENTAGE of whichever side it
       was piped to. A tank is cubic metres now, so there is one rate and it is
       the loop inventory the whole plant is already booked in. */
    const q = invRate(qTankBy[tid]||0);
    /* s.tankRate keeps the RAW signed figure: it is what the panels and the
       pipe gauges read, and a tank being filled reads negative there on
       purpose. Only the "is anything injecting" question needs the noise
       floor - see tankInjecting() (pipenet.js) for what a bare q>0 cost. */
    s.tankRate[tid] = q;
    /* inj is what the PRIMARY is taking - it feeds vessel fatigue and the
       injection log line, both of which are about this vessel. */
    if(tankPrimary(tid) && tankInjecting(tid, q)){ inj += q; injIds.push(tid); }
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
  /* ON THE CIRCUIT'S OWN CURVE (satOfCirc(), pipenet.js), never the primary's:
     the condensate line sits at 0.01 MPa and the two curves are 60 K apart
     there, so a feed pump asked about its own suction on the reactor's water
     read superheat where it had 18 K of subcooling. Latent until every pump
     reported - only primary nodes were ever asked before. */
  const scAt = n => tsatSec(pAt(n), circOfNode(coreFold(n))) - netTempAt(s, n);
  /* the vessel's own pressure, and an answer rather than a definition now.
     A readout, like s.sc and s.heat beside it - a pure function of the rest
     of S, on S because the panel prints it and a snapshot must carry what
     the panel was showing. */
  s.pCore = pAt(roleId("core"));
  /* ══ AND NOW THE FIELD ══ after the pressures are settled and before the
     SGTR, the feed train and the relief valves read a temperature anywhere. */
  keepPField(s, pField);
  /* ══ AND A RUN LETS GO AT ITS OWN WALL ══
     A wall is a real thickness and a real pressure it will take
     (runRating()/runBurstP(), pipenet.js), and until now nothing ever asked
     one: the bench printed RATED FOR in red and the pipe carried 15.5 MPa on
     4 mm of steel forever. It bursts where a HIT bursts it - one cell, pushed
     into s.dmgParts - so the hole, the plume, the inventory it costs, the
     repair party and the ledger are the mechanism the plant already had, and
     none of them needed a second kind of break. At the end doing the pushing,
     because that is where the hoop stress is. */
  /* AT A NODE THAT ACTUALLY HAS A PRESSURE, never pAt()'s fallback: pAt()
     answers s.P for anything the liquid solve does not carry, so every steam
     line on the plant was judged against the REACTOR's 15.5 MPa and the stock
     ship cut its own main steam line on tick one. The vapour network states
     its own field (s.vapP); a node in neither is a node nobody can say the
     pressure at, and a run with no pressure at either end is not judged. */
  const pBurstAt = n => { const f = coreFold(n);
    if(pField[f] !== undefined) return pField[f];
    const v = s.vapP && s.vapP[f];
    return v === undefined ? null : v; };
  for(const r of pipeNetwork()){
    if(!r.cells || !r.cells.length) continue;
    const ends = runEnds(r.key, r.k); if(!ends) continue;
    const qa = pBurstAt(ends[0]), qb = pBurstAt(ends[1]);
    if(qa === null && qb === null) continue;
    const pa = qa === null ? qb : qa, pb = qb === null ? qa : qb;
    if(Math.max(pa,pb) <= runBurstP(r)) continue;
    /* A RUN THAT IS ALREADY OPEN DOES NOT SPLIT TWICE. One hole is what the
       run has to say; without this the die is re-rolled every tick the line
       is still over its wall and eats the rest of the pipe cell by cell. */
    let open = false;
    for(const [cx,cy] of r.cells) if(cellBroken(s,cx,cy)){ open = true; break; }
    if(open) continue;
    /* WHERE it splits is a die (DICE.burstCell), rolled at the burst and not
       before: the hoop stress is the same the length of the run, so the flaw
       that goes first is not something the pipe's ends can tell you. Uniform
       over its own cells, so a long run fails somewhere you did not pick.
       Stood down (s.diceOff), it takes the end doing the pushing - a scenario
       that wants a particular cell stages it with the same act a hit uses. */
    const n = r.cells.length;
    const c = s.diceOff ? (pa >= pb ? r.cells[0] : r.cells[n-1])
                        : r.cells[Math.min(n-1, Math.floor(srand(s)*n))];
    const id = "pipe:"+c[0]+","+c[1];
    if(s.dmgParts.indexOf(id) >= 0) continue;
    s.dmgParts.push(id);
    const fx = dmgFx(id);
    logE("alarm","PIPE BURST / "+fx.msg,
      pipeName(r)+" has split at "+c[0]+","+c[1]+" - "+Math.max(pa,pb).toFixed(2)+
      " MPa against a wall rated for "+runRating(r).toFixed(2)+" MPa. "+fx.why);
  }
  advectStep(s, dt, runFlow);

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
    /* EVERY pump on the grid, at ITS OWN suction, keyed by its own id. It used
       to be keyed by LOOP and filled by primary pumps alone, so a feedwater
       pump - the one pump a real plant actually loses to cavitation - was
       structurally incapable of it, and two pumps on one loop shared the worse
       of their two suctions. Each one derates on its own now, which is what
       makes piping one badly (a long suction leg, a throttle on it, hung high)
       cost that machine and no other.
       The suction node is the casing's own a face (ROLE.pump), folded - never
       the literal "t", or a pump plumbed into a horizontal leg reads a face it
       does not have. */
    for(const id in s.cavP) if(!partOf(id)) delete s.cavP[id];
    /* AND IT FILLS AND CLEARS OVER A TIME, not inside one tick. A pump that
       lost its head instantly reversed its own flow, which restored its own
       suction, which restored the head - a two-tick limit cycle with the
       generator draining on the asymmetry. Vapour takes time to form and time
       to collapse; CAV_TAU is that time and it is what makes the runaway a
       runaway rather than a chatter. */
    const kc = Math.min(dt/CAV_TAU, 1);
    for(const id of pumpIds()){
      const want = clamp(-scAt(pumpSucNode(id))/CAV_SPAN, 0, 1);
      if(s.cavP[id]===undefined) s.cavP[id]=want;
      s.cavP[id] += (want - s.cavP[id])*kc;
      const c = s.cavP[id];
      if(c>worst) worst=c;
      /* WHICH pump, kept for the log alone. A local, deliberately: it is a
         pure function of this tick's field, so putting it on S would be a
         snapshot field that says nothing a resolve could not. */
      if(c>0.15) cavIds.push(id);
    }
    s.cav = worst; }
  /* ── what each pump is actually passing, for its own head-flow curve ──
     Off this tick's own solve, through the casing edge and no other: a pump
     with a run on every face still has ONE swallow. Smoothed on the same
     argument s.cavP is - a head that jumped with the flow it set would ring
     tick to tick - and fed to next tick's solve. */
  { for(const id in s.pumpQBy) if(!partOf(id)) delete s.pumpQBy[id];
    const kq = Math.min(dt/PUMP_Q_TAU, 1);
    for(const id of pumpIds()){
      const k = pumpEdgeKey(id); if(!k) continue;
      /* SIGNED, and floored at 0: netKgs() is a magnitude, so a pump being
         pushed backwards read as an enormous forward flow, took its own head
         off, and let itself be pushed harder - the reverse latched and the
         generators emptied into the condenser. */
      const q = runFlow[k] || 0;
      const want = q > 0 ? netKgs(q) : 0;
      if(s.pumpQBy[id]===undefined) s.pumpQBy[id]=want;
      s.pumpQBy[id] += (want - s.pumpQBy[id])*kq; } }
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
      /* A STANDBY PUMP RUNS WHEN ITS OWN RESERVE IS LINED UP. The tank's rule
         is already the one door answering "is the emergency feedwater armed",
         so the pump follows the VALVE rather than carrying a second rule - and
         s.tankByp defeats both with one switch. Asked of the drawing
         (pumpResOf), so any pump piped onto a reserve behaves this way. */
      { const r = pumpResOf(id);
        if(r.length) s.flowDemBy[id] = r.some(t=>tankOpen(s,t)) ? 1 : 0; }
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
  /* A secondary reserve that is armed adds a small dump while the reactor is
     scrammed, which is what runs the loop a few degrees cooler after a trip.
     It asks the TANKS, not a system row - and reads identically on a stock
     plant, where exactly one tank carries a rule. */
  /* ── THE BYPASS IS LIVE AT PART LOAD ON EVERY PLANT ──
     A real turbine bypass is open whenever the governor is closing, not only
     after a trip: BWR ~25 % of rated steam, PWR steam dump ~40 %. The fix
     above only ever landed for boiling plants: on a subcooled one dumpT was
     computed and thrown away, measured sitting at 0.22 unread while the shell
     safeties lifted and cooked the compartment. The rest-point error is
     exactly 0 on all six presets, so the clamp gives a literal 0 at full load.
     THE PRESSURE MODE IS ON EVERY PLANT. It was P.steam-gated, and a helium
     pile with a 330 kg shell behind a 47 MW core answered a 15 % load drop by
     running its shell from design to burst in twelve seconds while T-avg,
     behind a loop six times heavier per megawatt, had moved 0.2 K - the
     temperature mode cannot see a shell fault. A real dump has both modes on
     every plant, and the band is still derived off the valves actually drawn.
     THE RESERVE'S FLAT 0.08 STAYS SCRAM-GATED: it is proportional to nothing,
     and a permanent 8 % dump on every plant with a secondary reserve would be
     a machine nobody can see. */
  const dumpT = clamp((s.Tavg-Tprog)*DUMP_K,0,P.bypass);
  const dump = (condAvail(s) ? Math.max(dumpT,dumpPOf(s)) : 0)
             + ((s.scrammed && tankRuleAny(s,tankSecondary))?0.08:0);
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
    const q  = sgQAt(s,id,fl,filmK);
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
    const qIn = ihxUAOf(id)*served.length*Math.pow(fl,UA_FLOW)*filmK
              * Math.max(0, s.Tavg - ihxTemp(s,id));
    let qOut = 0; for(const g of served) qOut += sgQBy[g]||0;
    if(s.ihxTBy[id]===undefined) s.ihxTBy[id]=s.Tavg;
    s.ihxTBy[id] = potStep(s.ihxTBy[id], ihxHeatCap(id), qIn, qOut, skinQOf(s,id), dt, P.Tmin, P.Tmax);
    s.ihxQBy[id] = qIn; qTot += qIn;
  }
  /* ══ AND A PANEL COOLS WHAT IT IS PLUMBED TO ══
     The same conductance-times-a-difference every other exchanger on this
     plant is, against the water ARRIVING at it - which end that is comes off
     the solve's own sign and never off a face label, because ROLE.radiator
     folds t onto l and the stock drawing already names its condenser's water
     nozzles the other way round from ROLE.cond's.
     WHERE THE HEAT IS DEBITED IS THE CIRCUIT. On the core's, this is removal,
     exactly as a generator's crossing is; on any other, the water it chilled
     was warmed by a pot that has already been charged for it (a condenser
     rejecting into its circulating water), and charging that heat twice is
     what a second book always does. inCore() is the one predicate. */
  { const G = nodeGraph(), IN = ROLE.radiator.internal, key = k => "comp:"+k+":"+IN.a+IN.b;
    for(const id in s.radTBy) if(!partOf(id)) { delete s.radTBy[id]; delete s.radQBy[id]; }
    for(const id of radIds()){
      /* NO COMMISSIONED FLOW THROUGH IT, NO DUTY - cwK()'s own guard, and it
         is not optional. A panel hung off a loop on one line solves at 1e-14
         of reference, which is a difference of large numbers and not a flow;
         let it take the 0.02 stagnant floor every exchanger with a real
         circuit through it takes and a dead leg reads 176 MW of sink. */
      const ref = Math.abs(P.netRefByRun[key(id)]||0);
      const r = runRatio(key(id));
      const nIn = coreFold(id + (r >= 0 ? IN.a : IN.b));
      const fl = Math.max(Math.abs(r), 0.02);
      if(s.radTBy[id]===undefined) s.radTBy[id] = RAD_TDES;
      const q = (s.dmgParts.indexOf(id)>=0 || !radLive(id) || !(ref > 1e-9)) ? 0
        : radUAOf(id)*Math.pow(fl,UA_FLOW)*(1-0.85*clamp(netQualAt(s,nIn),0,1))
          * Math.max(0, netTempAt(s,nIn) - s.radTBy[id]);
      s.radQBy[id] = q;
      if(G.inCore(nIn)) qTot += q;
    } }
  const removal = qTot/(P.rated*1000);
  /* THE LOOP'S HEAT CAPACITY, not a typed 1.8. What is not removed goes into
     the water that is there: loopKg()*CP_W, both of which already exist and
     both of which follow the plant. graceK stays on top of it - that column is
     bought game balance and says so. */
  HEATBAL.prompt=s.n*PROMPT_F; HEATBAL.decay=s.decay;
  HEATBAL.heat=heat; HEATBAL.removal=removal;
  for(const id in HEATBAL.sgQBy) if(!(id in sgQBy)) delete HEATBAL.sgQBy[id];
  for(const id in sgQBy) HEATBAL.sgQBy[id]=sgQBy[id];
  /* AND WHAT THE VESSEL GIVES THE ROOM. The compartment used to be heated by
     the loop for nothing; the skin books it (skinQOf, room.js) and the loop
     pays it here. One tick old, the s.coreDT idiom - roomStep() runs after
     this. At rest it is tens of kilowatts against a gigawatt. */
  s.dTavg = (heat-removal)*P.rated*1000/(loopKg()*CP_W)/P.graceK
          - skinQRole(s,"core")/(loopKg()*CP_W);                    // K/s
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
    /* ── A BOILING PRIMARY IS A SATURATED POT, AND THE POT IS THE BOUNDARY ──
       The loop already IS a pot: s.dTavg is heat in against heat out over the
       water that is there (loopKg()*CP_W), the identical balance the shell
       integrates. What was missing was the second half of the shell's sentence
       - pressure is what SATURATION says about that temperature. So boiling
       finally pressurises, and a plant that has a steam space of its own does
       not care whether a pressurizer is plumbed to it or even fitted.
       As a RATE, off the curve's own derivative, for two reasons: the loop
       commissions a few kelvin below its saturation point (RBMK programmes 550
       against tsat 558), so the absolute curve would re-anchor every plant off
       its own design pressure; and every hole in the plant - the blowdown term
       below, a relief valve, a break - goes on moving s.P exactly as it did. */
    if(P.steam) s.P += satSlope(P.sat, s.P)*s.dTavg*dt;
    else {
      /* A PRESSURIZER WITH NO PIPE TO THE LOOP SETS NOTHING. Unplumbed it is a
         vessel welded shut beside the plant: no surge line means no steam bubble
         anywhere in a SUBCOOLED loop, so nothing is holding pressure up and it
         relaxes toward containment - the SAME anchor a real break already uses.
         It is reachability, not a stored run list, so shutting every valve
         between the core and the vessel is exactly as disconnected as cutting
         the line. Level already behaved: netExpSurge() has always returned zero
         with no surge line. */
      /* ONE PROGRAMME PER CIRCUIT SOMETHING HOLDS. Only the primary has a
         mean temperature to ride (s.Tavg), so a second hold circuit's demand
         is the flat setpoint its own vessel states - deliberately, until
         s.TavgBy exists to give it a real per-circuit source. */
      for(const ci of holdCircs()){
        const on = holdLive(P.net, s, ci), set = holdSetP(ci), now = loopP(s, ci);
        const prog = ci === nodeGraph().coreCirc
          ? (s.Tavg-P.Tref)*set*PZR_PROG_K*P.pRise/P.pzrK + (inj>0?0.5*P.pRise:0) : 0;
        const Pdem = on ? set + prog : P.Pcont;
        setLoopP(s, ci, now + (Pdem-now)*(0.30/P.pzrK)*(on?pzrAuth:1)*dt);
      }
    }
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
    for(const fid in s.reliefVent) delete s.reliefVent[fid];
    for(const fid of reliefPriIds()){
      const set=reliefSet(fid);
      s.reliefVent[fid]=0;
      if(!s.reliefOpen[fid] && porvLive(fid) && s.P > set.lift){
        s.reliefOpen[fid]=true; s.reliefAuto[fid]=true;
        s.reliefStuck[fid] = s.reliefArm[fid] || roll(s,"porvStick");
        s.reliefArm[fid]=false;
      }
      if(s.reliefOpen[fid] && s.reliefAuto[fid] && !s.reliefStuck[fid] && s.P < set.reseat){
        s.reliefOpen[fid]=false; s.reliefAuto[fid]=false;
      }
      if(!s.reliefOpen[fid] || s.reliefBlocked[fid]) continue;
      const rate = Math.max(0, invRate((netOut.reliefBy && netOut.reliefBy[fid]) || 0));
      const q = rate*dt;
      vented += q;
      s.reliefVent[fid]=rate;
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
    book(s,"reliefRoom", ventLoose/100*loopKg());
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
      book(s,"burstDisc", out/100*tankKg(tid));
      s.release = Math.min(100, s.release + out*b.rel*tankFluid(tid).act*P.dose*dt);
    }
  }
  s.inv -= spill*dt;
  book(s,"spillPri", spill*dt/100*loopKg());
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
    if(!tankPrimary(id)) continue;
    const out = invRate(qTankBy[id]||0);              // % of loop inventory per second, tank-out-positive
    const dPct = out*dt;
    // dPct is % of LOOP inventory; the tank's own level is that mass over its own
    // INEXHAUSTIBLE: the level does not move, so what it delivers or swallows
    // is not limited by what it holds. The inventory book still balances -
    // the plant loses or gains exactly what crossed the edge.
    if(!t.inf){ const raw = s.tank[id] - dPct/100*loopKg()/tankKg(id)*100;
      s.tank[id] = clamp(raw, 0, 100);
      book(s,"tankClampPri", (raw - s.tank[id])/100*tankKg(id)); }
    // an INEXHAUSTIBLE tank is a boundary, so what crossed its edge came from
    // outside the plant's books - negative is the plant being fed
    else book(s,"boundaryTank", -dPct/100*loopKg());
    s.inv += dPct;
    const bw = FLUID[t.fluid].boron;
    if(bw && dPct>0){ s.boron -= bw*dPct; s.boronDem -= bw*dPct; }
  }
  /* EACH RULE'S OWN STATE, fed forward like s.cavP and s.fregBy: this tick's
     answer is what the next tick's hysteresis reads, so nothing asking
     tankOpen() during a tick can see the rule change under it. */
  for(const id of tankIds()){
    const r = AUTORULE[D.tanks[id].auto];
    s.tankAuto[id] = !!(r && r.live(s,id));
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
  { const raw = s.inv; s.inv = clamp(s.inv,0,100);
    book(s,"invClamp", (raw - s.inv)/100*loopKg()); }

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
  /* AT THE INSTRUMENT'S OWN PLACE, once per circuit that has a vessel to
     stand on: a real plant measures at the pressurizer. Never the name
     "pzrb", and never one number for a plant that has two of them. REFILLED,
     never rebuilt - the s.sglBy idiom - and s.sc stays the PRIMARY's entry,
     which is the key the trip and the panel already address. */
  for(const ci of holdCircs()) s.scBy[ci] = scAt(holdOnCirc(ci)[0] || roleId("core"));
  const sc = s.scBy[nodeGraph().coreCirc];
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
  /* ── AND THE TWO THINGS BACKPRESSURE DOES WHEN IT GETS AWAY ──
     Latched here, ahead of the stop valve, because both of them ARE the stop
     valve's answer. A turbine will not run against 0.02 MPa of exhaust - the
     real figure, and about four times rated rejection - and a condenser past
     atmospheric has relieved and lost its vacuum for good. Neither resets:
     there is no pump on this plant that pulls the air back out, and the
     turbine trip is a latch until somebody rebuilds the plant. */
  if(!s.condLost && condP(s) >= COND_ATM){ s.condLost = true;
    logE("alarm","CONDENSER VACUUM LOST",
      "The condenser has reached atmospheric pressure and relieved. It is open to the room, it will not hold vacuum again, and it has stopped being a heat sink. What the bypass still passes into it goes overboard, and the rest backs up onto the generators' safety valves."); }
  if(!s.turbTrip && condP(s) > TURB_TRIP_P){ s.turbTrip = true;
    logE("alarm","TURBINE TRIP",
      "Exhaust pressure past what the machine will run against. The stop valve is shut. The reactor is still making heat and the turbine is no longer taking any of it."); }
  /* ── A HOLE IN THE EXHAUST BREAKS THE VACUUM, IT DOES NOT VENT A SHELL ──
     condP() carries it (exhOpen(), above), so the enthalpy drop, the stop
     valve and the MWe readout all price the same backpressure. What still
     crosses the turbine goes to the room instead of to the hotwell (`retK`
     below), so the condensate does not come back either. */
  const pCond  = condP(s);
  /* ══ THE GOVERNOR IS A VALVE, AND THE STEAM SIDE IS SOLVED ══
     `s.load` was the plant's total swallow in kg/s, shared out over the
     generators by what each was raising and gated per shell on a pressure
     ratio. Every one of those was a stand-in for a network: two shells could
     not push against each other, a header could not be throttled, and a shut
     isolation valve was not representable at all. It is an OPENING now - a
     fraction of the machine's own fitted capacity - and what actually passes
     is what vapSolve() (pipenet.js) says passes; vapOpenAt() is the gate. */
  const vap = vapSolve(s, vapOpenAt(s, dump));
  const vapOut = (vap && vap.out) || {};
  /* ── THE SHELL'S RELIEF VALVES, AND THEY ARE PLACED BOXES ──
     Identical machine to the primary's: its own bore, its own set point, its
     own stick-open die, its own block valve, its own bypass. The ONE thing
     that differs is the question it asks - a valve lifts on the pressure where
     it was DRAWN, and shellsOf() answers that off the drawing. A valve on a
     common header protects every shell it reaches, which is what a header is.
     It discharges to atmosphere: the vapour network's only sink is the
     condensing volume, so piping one into a tank is still a flow path nothing
     prices - named in the gaps rather than faked. */
  const secVent = {};                     // per shell: [{fid, cap}], kg/s each valve offers
  for(const id in s.reliefSteam) delete s.reliefSteam[id];
  for(const fid of reliefSecIds()){
    const shells = shellsLive(s,fid), set = reliefSet(fid), pk = reliefAtP(s,fid);
    if(!s.reliefOpen[fid] && porvLive(fid) && pk > set.lift){
      s.reliefOpen[fid]=true; s.reliefAuto[fid]=true;
      s.reliefStuck[fid] = s.reliefArm[fid] || roll(s,"porvStick");
      s.reliefArm[fid]=false;
      logE("warn",nameOf(fid)+" LIFTED",
        "Shell pressure reached this valve's set point and it is passing steam to atmosphere. The water going with it does not come back.");
    }
    if(s.reliefOpen[fid] && s.reliefAuto[fid] && !s.reliefStuck[fid]
       && pk < set.reseat){
      s.reliefOpen[fid]=false; s.reliefAuto[fid]=false;
    }
    s.reliefSteam[fid]=0;
    if(!s.reliefOpen[fid] || s.reliefBlocked[fid]) continue;
    /* Sized off its OWN bore against its OWN lift point, so the capacity is a
       property of the valve the player bought and not a plant-wide number. */
    const b = fitBoreK(fid), span = Math.max(0.05, set.lift-P.Pcont);
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
     WHY HERE AND NOT IN THE VAPOUR NETWORK: a hole discharges to the ROOM,
     which is not a node that network has - its only sink is the condensing
     volume. The mass is taken where its pressure actually lives. */
  const secHole = {};                     // per shell: kg/s the holes on it offer
  for(const bk of (P.net.steamBreaks||[])){
    if(bk.exh || !bk.cells.some(([x,y])=>cellBroken(s,x,y))) continue;
    const span = Math.max(0.05, sgDesignP()-P.Pcont);
    for(const id of holeShells(s,bk))
      secHole[id] = (secHole[id]||0) + SG_RELIEF_CAP*ratedSteam()*bk.bore*bk.bore
                                       *Math.max(0, secP(s,id)-P.Pcont)/span;
  }
  let boiled = 0;               // kg/s, summed for the mass balance below
  /* WHAT THE SOLVE MOVED THAT THE SHELL COULD NOT ACTUALLY GIVE. The vapour
     network answers off pressure alone; a shell whose steam space is empty
     has nothing to send whatever its pressure says, and the shortfall is
     taken off the shaft work rather than left to be made twice. */
  let starve = 0;
  for(const id in s.sgTBy)  if(!sgW.hasOwnProperty(id)) delete s.sgTBy[id];
  for(const id in s.sgSteamBy) if(!sgW.hasOwnProperty(id)) delete s.sgSteamBy[id];
  for(const id in s.sgBurst) if(!sgW.hasOwnProperty(id)) delete s.sgBurst[id];
  for(const id in s.steamBy)  delete s.steamBy[id];
  for(const id in s.steamTo)  delete s.steamTo[id];
  for(const id in s.sgVentBy) delete s.sgVentBy[id];
  if(ids.length) for(const id of ids){
    /* THIS MACHINE'S OWN SECONDARY WATER. Hoisted out of the loop it made a
       mixed fleet integrate every level against the first machine's charge -
       the once-through unit would never have run dry. */
    const M = sgMassOf(id); if(M<=0) continue;
    if(s.sglBy[id]===undefined) s.sglBy[id]=SGL_SET;                 // a generator placed mid-run starts full
    if(s.sgTBy[id]===undefined) s.sgTBy[id]=tsatSec(secPTarget(s,id), shellCirc(id));
    if(s.sgBurst[id]===undefined) s.sgBurst[id]=false;
    const lvl = s.sglBy[id];
    /* WHAT THIS MACHINE IS RAISING, and WHAT ACTUALLY LEAVES IT. The gap
       between them is trapped steam, and trapped steam is what the shell
       temperature below integrates - the whole of the bug this replaces. */
    const shellP = secP(s,id);
    /* The RISE, not the latent heat: a kilogram of steam is a kilogram of
       feedwater heated from T_FEED and then boiled, and both halves cross
       these tubes. */
    const rise = riseSg(id, shellP);
    const steamOut = (sgQBy[id]||0)/rise;                                 // kg/s raised in THIS generator
    /* ── AND IF NOTHING WAS FITTED TO TAKE IT, THE SHELL TAKES IT ──
       There is no lid that is not a placed box. Past this the shell is open to
       atmosphere: it flashes off what is in it, stops raising steam pressure
       at all (secP, pipenet.js, reads the same latch) and stops being a heat
       sink as it empties. Latched. */
    if(!s.sgBurst[id] && shellP > sgBurstP(id)){
      s.sgBurst[id]=true;
      logE("alarm",nameOf(id)+" SHELL BURST",
        "The secondary shell has ruptured. It was raising steam faster than anything fitted could get rid of, and nothing was fitted to get rid of it. What is in it is going to atmosphere, it will not hold pressure again, and it stops cooling its loop the moment it is empty.");
    }
    /* ── WHAT LEAVES THIS SHELL IS WHAT THE STEAM LINE CARRIES ──
       The solved flow out of this generator's own nozzle, off the vapour
       network. A shell that has burst is open to the room and pushes nothing
       down a pipe; a shell with no steam line drawn has no edge and solves at
       0 for free, which is what "nowhere to send it" now means without
       anything asking. NEGATIVE is steam arriving from a hotter machine down
       a shared header - real, and the whole reason a header equalises. */
    const steamTo = s.sgBurst[id] ? 0 : (vapOut[id] || 0);
    /* WHAT ITS OWN VALVES ARE PASSING, and never more water than is in there.
       Both the mass and its latent heat leave the balance, so a generator held
       on its valves uncovers its own tubes - which is the accident that makes
       the valve worth having, and the reason it is not free.
       A BURST SHELL IS AN OPENING, not a valve: it dumps at the same scale a
       full-bore valve would and does not reseat. */
    let cap = 0; for(const v of (secVent[id]||[])) cap += v.cap;
    if(s.sgBurst[id]) cap = SG_RELIEF_CAP*ratedSteam();      // a hole, not a valve
    cap += secHole[id]||0;                                   // a severed steam line is another
    let vent = Math.min(cap, lvl/100*M/Math.max(dt,1e-9));
    /* ── THE STEAM SIDE IS AN INVENTORY, NOT A PASS-THROUGH ──
       What boiled goes into the shell's steam space; what the line and the
       valves take comes out of it. Surplus over saturation condenses back into
       the water below and a deficit flashes off it, so the shell's two
       inventories exchange mass without any of it leaving the plant. This is
       the whole of the fix: the feed controller replaces what the WATER lost,
       not what the tubes raised. */
    if(s.sgSteamBy[id]===undefined) s.sgSteamBy[id]=sgSteamEq(s,id);
    const ms = s.sgSteamBy[id], water = lvl/100*M;
    const cond = clamp((ms - sgSteamEq(s,id))/SG_FLASH_TAU,
                       -water/Math.max(dt,1e-9), ms/Math.max(dt,1e-9)+steamOut);
    /* A SHELL WITH NOTHING IN ITS STEAM SPACE PASSES NOTHING. Taken as a scale
       on what leaves rather than as a clamp afterwards - a clamp would discard
       mass these books are counting. */
    const avail = ms/Math.max(dt,1e-9) + steamOut - cond;
    const k = (steamTo+vent) > avail ? Math.max(0,avail)/Math.max(steamTo+vent,1e-9) : 1;
    const outSteam = steamTo*k;
    vent *= k;
    starve += steamTo - outSteam;
    { const rawS = ms + (steamOut - outSteam - vent - cond)*dt;
      s.sgSteamBy[id] = Math.max(0, rawS);
      book(s,"sgSteamClamp", rawS - s.sgSteamBy[id]); }
    book(s,"sgVent", vent*dt);            // a safety valve blows to atmosphere and the water goes with it
    /* WHAT EACH VALVE IS ACTUALLY PASSING, not what it offered - the shell can
       only give up the water that is in it, and the panel has to print the
       number the tick caused. */
    if(cap>0) for(const v of (secVent[id]||[]))
      s.reliefSteam[v.fid] += vent*v.cap/cap;
    s.steamBy[id]=steamOut; s.steamTo[id]=outSteam;
    s.sgVentBy[id]=vent;
    /* ONE feed controller. Both pools answer to it - an emergency feed pump is
       a feed pump - so what a reserve delivers is what THIS generator is
       short, drawn against what is actually left in the reserve, rather than
       a flat fraction of rated steam that scaled with a number the tank has
       never had anything to do with. */
    const boilNet = steamOut - cond;                 // kg/s the WATER actually loses
    const want = Math.max(0, boilNet
      + (SGL_SET-lvl)/100*FEED_LVL_K*ratedSteam()/Math.max(1,sgCount()));
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
       nothing does not divide by zero. Rate-limited by FREG_STROKE, which is
       what makes it a valve rather than an algebraic answer. */
    const fed = invRate((netOut.sgFeedBy && netOut.sgFeedBy[id]) || 0)/100*loopKg();
    if(s.fregBy[id]===undefined) s.fregBy[id]=0;
    if(autoLive("feed")){ const e = (fed - want)/Math.max(want, FREG_SPAN), span = fregMax(id);
      s.fregBy[id] = clamp(s.fregBy[id] + clamp(e,-1,1)*span/FREG_STROKE*dt, 0, span); }
    /* ── WHAT ARRIVES IS THE SOLVED FLOW, NOT THE DEMAND ──
       `want` is what the controller asked for; this is what the network
       actually carried, and the two agree only when nothing is in the way.
       A damaged pump and a blackout are already IN the head (netBuild(),
       pipenet.js), so they arrive here as less flow rather than as a
       fraction applied to the answer - the same argument s.cavP makes, and
       every pump on the plant makes it the same way now.
       NO CEILING IS APPLIED HERE, and that is load-bearing: a ceiling would
       discard mass the solve had already moved and the secondary's books
       would stop closing (measured, 4365 kg in fifteen seconds). Every way of
       running out is in the HEAD instead - a hit pump, a dead switchboard, a
       suction that has gone to vapour (s.cavP) - and a reserve tank
       limits itself, because it is a fixed node whose own edge shuts when it
       is dry. Negative is a generator draining backwards up its own feed
       line: real, and the level integral's business. */
    /* Liquid leaves as steam that BOILED, less what condensed back onto it.
       Steam raised into a closed shell is still in the shell - and now it is
       kilograms there, so the water is not asked to pretend it never left. */
    const outKg = outSteam + vent;
    /* A FULL SHELL TAKES NO MORE. The clamp used to swallow it: feedwater kept
       arriving into a generator already at 100 %, and the sensible heat below
       kept charging against water that was not there - so a generator with
       nowhere to send steam went on being cooled by an infinite supply of cold
       water. What does not fit does not arrive. */
    const raw = lvl + 100*(fed-boilNet)/M*dt;
    s.sglBy[id] = clamp(raw, 0, 100);
    const fed_ = fed - (raw - s.sglBy[id])*M/100/Math.max(dt,1e-9);
    book(s,"sgClamp", (raw - s.sglBy[id])/100*M);
    /* ── THE SHELL'S OWN ENERGY BALANCE ──
       In across the tubes, out with the steam that left, and the sensible heat
       of the water that is NET accumulating - the replacement water is already
       charged through `rise`, which really does span feedwater to steam, so
       charging it twice would cool a healthy generator for nothing. Pressure is
       what saturation says about this temperature (secP), not a formula about
       load. */
    const C = Math.max(1, sgHeatCap(s,id));
    const qFeed = (fed_-boilNet)*CP_W*(s.sgTBy[id]-T_FEED);
    /* An OPEN pot boils at the room's pressure, whatever is still crossing the
       tubes into it - which is why a burst shell is a violent cooldown first
       and no heat sink at all a few seconds later, once it is dry. */
    s.sgTBy[id] = s.sgBurst[id] ? tsatSec(P.Pcont, shellCirc(id))
      : potStep(s.sgTBy[id], C, sgQBy[id]||0, outKg*rise + qFeed, skinQOf(s,id), dt, T_FEED*0.5);
    boiled += outSteam;
    /* A ruptured generator on its safety valve is putting primary water in the
       sky. Charged at the SGTR scale already used below, times the share of
       this machine's steam that is going overboard rather than to the
       condenser - clean unless these tubes are the ones that failed, and clean
       anyway behind an intermediate exchanger (sgActive()), where what crossed
       into this shell was never the core's water. */
    if(vent>0 && sgtrLive(s,id) && sgActive(id)){
      const shr = vent/Math.max(outSteam+vent,1e-9);
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
     two turbines and one exhaust cut loses both. */
  const retK = (exhOpen(s) || s.condLost) ? 0 : 1;
  /* ── AND IT IS AN OPENING, NOT A HOLE IN THE BOOKS ──
     retK USED TO DELETE THE MASS. Everything above it is exact - the shells
     debit what they raise, the pool is credited what came back - and then a
     factor of 0 threw away the difference with nothing named and nothing
     printed. Measured: BWR/4 with its condenser relieved passed 44 500 kg
     through the turbine bypass in five minutes and every kilogram vanished,
     which is the hotwell draining with no valve open and no way to see why.
     It is a real opening and it goes to atmosphere: the bypass discharges
     into a condenser that has relieved, or straight out of a severed exhaust.
     Booked here, in the one currency the rest of this balance counts in, so
     the secondary's books close whatever is broken. */
  s.condVent = Math.max(0, boiled*(1-retK));
  book(s,"condVent", s.condVent*dt);
  if(s.condVent > 0 && !s.condVentSeen){ s.condVentSeen = true;
    logE("warn","STEAM GOING OVERBOARD",
      "The turbine bypass is passing steam into a machine that is open to atmosphere, and the water going with it does not come back. The hotwell is draining and no valve on the plant is open."); }
  /* ── SHAFT WORK IS THE STEAM THAT CROSSED THE WHEELS ──
     One number for the plant, off the solve: what went round the machine
     through the bypass did no work, and what went through it did work at the
     pressure the STOP VALVE is actually seeing rather than at whichever
     shell's saturation the old per-generator book credited it to. A header
     mixes; the flow that reaches the turbine has no generator's name on it
     any more, and that is the point. */
  s.turbWk = Math.max(0, (vap ? vap.work : 0) - starve);
  s.turbP  = vap ? vap.pIn : pCond;
  const workKW = s.turbWk*turbDh(s.turbP, pCond)*P.eff;
  /* The 900 K clamp is gone: it was a silent ceiling on a pot that had no
     other way to fail, and the failure is a real one now. What bounds it
     instead is the machine - a relieved condenser is boiling at atmospheric,
     so it sits on that saturation temperature and no higher. */
  { const qIn = Math.max(0, boiled*retK*steamRise() - workKW);
    s.condT = potStep(s.condT, condCap_(), qIn, condRej(s), skinQRole(s,"cond"), dt, s.cwInT);
    if(s.condLost) s.condT = Math.min(s.condT, tsatSec(COND_ATM)); }
  /* NO RADIATOR SELF-LIMITS WITHOUT A CAP. Area 0 is radRej 0, so the panel
     climbs until it meets the water arriving and its own duty goes to 0 on the
     (Tin - Tpanel) term; whatever pot is behind that water then backs up and
     the chain stops itself. Floored at T_SPACE - a panel cannot radiate below
     the sky. IN is what it took out of its own coolant this tick, so the two
     ends of this pot are both the plant's and neither is a role name. */
  for(const id of radIds())
    s.radTBy[id] = potStep(s.radTBy[id], radCap_(id), s.radQBy[id]||0,
      radRejOf(s,id), skinQOf(s,id), dt, T_SPACE);
  /* Fed forward one tick, the s.cwFlow idiom directly above it: what this
     machine rejects is what warms the water whose temperature decides what
     it can reject. */
  { const t = cwInOf(s, runFlow); if(t !== undefined) s.cwInT = t; }
  /* ══ AND A RESERVE IS METERED AGAINST ITSELF ══
     Its OWN solved edge, signed, exactly the way every primary tank is already
     charged - not a share of one pool figure clamped at zero. Clamped, a
     reserve being BACKFILLED off the feedwater line read as delivering
     nothing, and the condensate the pool paid for went nowhere the books
     could see: measured, 1 600 kg/s vanishing for as long as the tie stood
     open. Tank-out-positive, so `in` is the negation. */
  const resKg = id => -invRate((netOut.qTankBy && netOut.qTankBy[id])||0)/100*loopKg();
  /* ══ AND WHAT THE HOTWELL PAID FOR IS THE CONDENSATE LINE ══
     Not what the generators swallowed. The condenser's outlet is a FIXED node
     - the feed pump's suction sits on its pressure and has to - so whatever
     the pump asks for crosses it, and until this line existed the difference
     between that and what actually condensed was created out of nothing.
     Measured on WINDSCALE away from the rest point: the pool went on reading
     level while the condensate line carried more than the exhaust brought in.
     The pool is charged HERE and nowhere else (outs.qCondBy, pipenet.js);
     charging it with the shells' own feed as well would be the same water
     debited twice. */
  const condOut = (()=>{ let k=0;
    for(const id in (netOut.qCondBy||{})) k += invRate(netOut.qCondBy[id])/100*loopKg();
    return k; })();
  /* ── the secondary as ONE closed system ──
     Steam raised leaves a generator, turns the turbine, condenses into the
     pool, and leaves it again down the condensate line. In a healthy plant at
     its rest point the two cancel exactly and the level sits still, which is
     why nothing pinned against a healthy plant moved when it landed.

     A tube rupture is where it stops being decorative: that is primary water
     crossing into the secondary, so the secondary total GROWS, and the water
     ends up here. It is the real operational problem at an SGTR. loopKg() is
     the one bridge between invRate()'s % of loop inventory and these kg.

     A RESERVE is one-way: what leaves it does not come back. */
  { const sgtrKg = Math.max(0, s.sgtrRate)/100*loopKg();
    const netKg = boiled*retK - condOut + sgtrKg - spillSecKg;
    const circCap = (()=>{ let c=0; for(const id of circ) c+=tankKg(id); return c; })();
    for(const id in s.tankOver) delete s.tankOver[id];
    for(const id of secTankIds()){
      const cap = Math.max(1, tankKg(id));
      /* The operator's own valve. It is the answer to a tube rupture filling
         the hotwell with primary water, and it never refuses: open it on a
         healthy plant and you dump the condensate the feed pumps need. */
      const dumped = s.tankDump[id] ? HOT_DUMP*Math.min(s.tank[id],100)/100 : 0;   // %/s
      /* Every tank in the CIRCUIT moves with the pool, in proportion to how
         much of it it is - so two hotwells behave as one hotwell of their
         combined size and neither drains first. A RESERVE is its own edge and
         nobody else's (resKg). */
      const inKg = circ.indexOf(id)>=0 ? netKg*cap/Math.max(circCap,1e-9) : resKg(id);
      const raw = s.tank[id] + (100*(inKg||0)/cap - dumped)*dt;
      /* Past full it overflows, and the overflow is gone - a tank that
         silently clamped would swallow a tube rupture's whole inventory and
         report nothing. What overflows an SGTR's hotwell is contaminated. */
      if(raw > 100) s.tankOver[id] = (raw-100)/100*cap/Math.max(dt,1e-9);          // kg/s
      if(!D.tanks[id].inf){ s.tank[id] = clamp(raw, 0, 100);
        book(s,"tankClampSec", (raw - s.tank[id])/100*cap);
        book(s,"tankDump", dumped*dt/100*cap); }
      // an INEXHAUSTIBLE pool is a boundary: its level does not move, so what
      // the plant handed it left the books entirely
      else book(s,"boundaryTank", (inKg||0)*dt);
    }
    // a hole in the secondary is a named opening; the pool it drains is above
    if(circ.length) book(s,"spillSec", spillSecKg*dt);
  }

  /* ── reactivity ── */
  const p=s.parts;
  p.rod=nod.rod; p.dop=nod.dop; p.mod=nod.mod; p.exp=nod.exp; p.xe=nod.xe; p.vd=nod.vd;
  p.tip=nod.tip; p.bor=s.boron;
  s.rho=P.excess+p.rod+p.dop+p.mod+p.exp+p.xe+p.bor+p.vd+p.tip;

  /* ══ FUEL THAT IS NOT IN A VESSEL IS NOT A REACTOR ══
     The lattice is its own drawing, so a plant with nothing on the arrangement
     grid still had a rating, an excess reactivity and a full set of feedback
     terms - and it made 134 MWt out of nothing, tripped itself and lit the
     board. There is no criticality without the machine: the population and its
     precursors are pinned at zero, and the decay chain above washes out on its
     own because it is driven by s.n. Nothing here refuses to commission - a
     blank grid is a legal plant, and this is what one does.
     P.vessel and not a live ask: a machine cannot be placed on a running
     plant, and a design edit re-commissions. */
  /* AT THE SAME FLOOR THE KINETICS ALREADY KEEPS, never a bare 0: the nodal
     core divides by the power it is given, so an exact zero put a NaN into
     every pellet temperature and the reactivity panel read NaN pcm. 1e-9 of
     1200 MWt is a microwatt, which is what every readout downstream prints. */
  if(!P.vessel){ s.n=1e-9; for(let i=0;i<6;i++) s.C[i]=0; }
  else {
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
  }

  /* ── thermal margin ── */
  /* DNBR IS LOCAL, so the plant's margin is the MINIMUM over the field and
     nothing else. What stood here evaluated W-3 at a state that exists at no
     point in the core: the peak node's flux against the exit node's quality,
     which on a boiling plant read 0.93 while no node was under 1.39. */
  s.dnbr=s.dnbrMin;

  /* ── damage: the consequences, not the integration ──
     s.dmg, s.meltFrac, s.oxMax and s.h2 were all settled by coreStep() above,
     node by node. What is left here is what a hurt core COSTS, and every one
     of these is continuous in how much of the core is hurt rather than a step
     on a latch: a core 3 % molten and one 90 % molten used to pay the same
     inventory, the same fatigue and the same release. */
  if(!s.melt && s.meltFrac>=MELT_LATCH){ s.melt=true; s.trip="CORE MELT"; }
  if(s.meltFrac>0 && !P.catcher){
    s.inv-=MELT_INV*s.meltFrac*dt;
    book(s,"melt", MELT_INV*s.meltFrac*dt/100*loopKg());
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

  /* ── the room: heat is a place too ──
     Beside the radiation block and for the same reason - both are fields over
     the same grid, both are read by a layer, and both want this tick's
     accident settled before they answer. The ONE difference is that this one
     is state: see s.roomT's own note in resetPlant() and the header of
     src/data/room.js.
     It reads the openings the block above already booked (s.spillBy,
     s.sgVentBy, s.reliefSteam, s.reliefVent) and writes nothing back into the
     plant except through the damage path below, which is the whole of what
     "the room bites" means. */
  roomStep(s, dt);
  /* ── and what the BLAST costs, which is a different question from the heat ──
     s.dmgParts gets its THIRD writer. INSTANTANEOUS, not integrated: a blast
     is not a cooking, so it borrows nothing from ROOM_DMG_TAU and a machine
     either survives the peak its own cells saw or it does not. Structure
     declares no pburst and is exempt exactly as it is exempt from tsurv; the
     hull and the keel are grid cells rather than parts, so nothing here even
     asks about them. A severed pipe cell is one array push and the existing
     break path takes over from there. */
  { /* THE BANG IS ITS OWN EVENT. The lines below name what it BROKE and the
       deflagration line at the end says what the whole passage cost, but an
       explosion is a thing that happened at a moment and neither of those is
       reported at that moment - a blast that breaks nothing wrote no line at
       all. Latched on s.burnEv so it fires once per passage, at the peak that
       first threatens the weakest machine on this plant. */
    if(!s.burnEv.blast && s.roomPMax >= minPburst()){
      s.burnEv.blast = 1;
      logE("alarm","EXPLOSION IN THE COMPARTMENT",
        "A hydrogen charge has gone off - "+s.roomPMax.toFixed(0)+
        " kPa above ambient, against the "+minPburst().toFixed(0)+
        " kPa the weakest machine on this plant is built for. The compartment relieves itself in about half a second, so what it costs is decided now.");
    }
    for(const p of LAY.parts){
      const lim = partPburst(p);
      if(!lim || !fitted(p) || s.dmgParts.indexOf(p.id) >= 0) continue;
      if(roomPAt(s,p) < lim) continue;
      s.dmgParts.push(p.id);
      s.burnEv.ids.push(p.name);
      const fx = dmgFx(p.id);
      if(fx.hit) fx.hit(s, p.id);
      logE("alarm","BLAST DAMAGE / "+fx.msg,
        p.name+" has been wrecked by a hydrogen explosion in the compartment - "+
        roomPAt(s,p).toFixed(0)+" kPa against the "+lim+" kPa it was built for. "+fx.why);
    }
    for(const k in D.pipes){
      const id = "pipe:"+k;
      if(s.dmgParts.indexOf(id) >= 0) continue;
      const c = k.indexOf(",");
      const x = +k.slice(0,c), y = +k.slice(c+1);
      if(s.roomP[y*GW+x] < PIPE_PBURST) continue;
      s.dmgParts.push(id);
      s.burnEv.ids.push("the run at "+k);
      const fx = dmgFx(id);
      logE("alarm","BLAST DAMAGE / "+fx.msg, "A hydrogen explosion has cut the pipe at "+k+". "+fx.why);
    }
  }
  /* ── AND WHAT ITS OWN CONTENTS COST ──
     The block above is the ROOM pushing IN. This is the plant pushing OUT, and
     nothing on this machine has ever been asked it: a thin space panel spliced
     into a 15.5 MPa primary held it for free, and a sink priced against a
     307 K condenser then shed 1.7 GW off the hot leg for nothing.
     THE CIRCUIT'S PRESSURE, NEVER netPAt(). The solve carries PIEZOMETRIC head
     - a pump's suction node sits below any gauge and its discharge above one -
     so a shell rating compared against it is two different quantities meeting.
     What a gauge would print is what the circuit is HELD at, and inCore() is
     the one predicate that says which circuit a node is on.
     A part with no rating is exempt, exactly as it is exempt from tsurv. */
  { const G = nodeGraph();
  for(const p of LAY.parts){
    const lim = partPdes(p);
    if(!lim || !fitted(p) || s.dmgParts.indexOf(p.id) >= 0) continue;
    let pk = 0, seen = false;
    for(const f of ["t","r","b","l"]){ const n = coreFold(p.id+f);
      if(P.net.index[n] === undefined) continue;
      seen = true;
      pk = Math.max(pk, G.inCore(n) ? s.P : condP(s));
    }
    if(!seen || pk < lim) continue;
    s.dmgParts.push(p.id);
    const fx = dmgFx(p.id);
    if(fx.hit) fx.hit(s, p.id);
    logE("alarm","SHELL FAILURE / "+fx.msg,
      p.name+" has burst. It is holding "+pk.toFixed(1)+" MPa against the "+
      lim.toFixed(1)+" MPa its own shell is built for. "+fx.why);
  } }
  /* ONE LINE FOR AN EXPLOSION, NOT ONE FOR A FLAME. A compartment already
     over the ignition temperature burns whatever crosses the flammability
     limit as it crosses it, which is a steady diffusion flame and is real -
     but it is a CONDITION, and the H2 FLAMMABLE tile is what says so. What
     earns a line in the log is a charge that had time to collect first.
     LATCHED, because the front is the whole point: a limit mixture crawls at
     0.05 m/s and burns 20-60 g a tick, so a per-tick gate never fired for the
     slow case and fired every two seconds for the standing one. The line goes
     out when the last flame does, and it says what the whole passage cost. */
  if(!s.roomBurnOn && s.burnEv.kg > 0){
    if(s.burnEv.kg > H2_BURN_EV)
      logE("alarm","HYDROGEN DEFLAGRATION",
        s.burnEv.kg.toFixed(1)+" kg of hydrogen has burned in the compartment, "+
        (s.burnEv.kg*H2_LHV/1000).toFixed(0)+" MJ of it into the air, peaking at "+
        s.burnEv.p.toFixed(0)+" kPa. "+
        (s.burnEv.ids.length ? "It took "+s.burnEv.ids.join(", ")+". " : "Nothing was broken by it. ")+
        "It came off the cladding, left the loop with the steam, collected under the deckhead and found something hot enough to light it. Nothing was needed but the heat that was already there.");
    s.burnEv = {kg:0, p:0, blast:0, ids:[]};
  }
  /* ── and what standing in it costs a machine ──
     s.dmgParts gets its SECOND WRITER. Until now combatHit() was the only one
     in all of src/, and no failure anywhere read a value at a part's own grid
     position - which is exactly what a field is for. A ramp rather than a
     switch, integrated rather than tripped, so a machine cooks over seconds
     and the picture has time to say so.
     A shield, a containment wall and a core catcher declare no tsurv: they
     are structure, they have no electronics and no bearings, and a
     temperature is not how they fail. */
  { const live={};
    for(const p of LAY.parts){
      const lim = partTsurv(p);
      if(!lim || !fitted(p)) continue;
      live[p.id]=1;
      if(s.dmgParts.indexOf(p.id) >= 0){ s.roomHurt[p.id]=0; continue; }
      const over = clamp((partSkin(s,p)-lim)/ROOM_DMG_SPAN, 0, 1);
      if(over <= 0) continue;
      const h = (s.roomHurt[p.id]||0) + over*dt/ROOM_DMG_TAU;
      s.roomHurt[p.id] = h;
      if(h < 1) continue;
      s.roomHurt[p.id]=0;
      s.dmgParts.push(p.id);
      const fx=dmgFx(p.id);
      if(fx.hit) fx.hit(s, p.id);
      /* p.name, not partName(): src/core/ui.js is deliberately outside the
         worker's own subset, and this line runs inside a scenario run. The
         same choice repairStart() makes, for the same reason. */
      logE("alarm","HEAT DAMAGE / "+fx.msg,
        p.name+" has been cooked by the compartment it is standing in - its own metal is at "+
        partSkin(s,p).toFixed(0)+" K against the "+lim+" K it was built for, in air at "+
        roomAt(s,p).toFixed(0)+" K. "+fx.why+
        "  Fixing it while the room is still this hot only buys the same seconds again.");
    }
    /* ── AND THE PIPEWORK COOKS TOO ──
       The loop above walks LAY.parts, and a pipe cell is not one - so a
       compartment hot enough to wreck every machine standing in it left the
       runs threading through the same air untouched, and the blast branch
       (above) was the only way a room could ever cut a pipe. PIPE_TSURV
       (layout.js) is PIPE_PBURST's mirror, for the same reason: a run has no
       role to state one. THE AIR, not a skin: what a run carries is its own
       fluid and is no measure of the fire around it. */
    for(const k in D.pipes){
      const id = "pipe:"+k;
      live[id] = 1;
      if(s.dmgParts.indexOf(id) >= 0){ s.roomHurt[id]=0; continue; }
      const c = k.indexOf(","), x = +k.slice(0,c), y = +k.slice(c+1);
      const air = s.roomT[y*GW+x];
      const over = clamp((air-PIPE_TSURV)/ROOM_DMG_SPAN, 0, 1);
      if(over <= 0) continue;
      const h = (s.roomHurt[id]||0) + over*dt/ROOM_DMG_TAU;
      s.roomHurt[id] = h;
      if(h < 1) continue;
      s.roomHurt[id] = 0;
      s.dmgParts.push(id);
      const fx = dmgFx(id);
      logE("alarm","HEAT DAMAGE / "+fx.msg,
        "The run at "+k+" has been cooked by the compartment it passes through - air at "+
        air.toFixed(0)+" K against the "+PIPE_TSURV+" K the pipe is good for. "+fx.why);
    }
    for(const id in s.roomHurt) if(!live[id]) delete s.roomHurt[id]; }

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
  /* Beside HIGH RADIATION IN THE SPACE and not latched, for the identical
     reason: the room cools once whatever was venting into it stops, and an
     operator who has just shut a valve needs to watch the number come down. */
  { const hotIds = roomOverIds(s);
    ev("hiroom",hotIds.length>0,"alarm","EQUIPMENT OVER TEMPERATURE",
      ()=>nameList(hotIds)+" "+isAre(hotIds)+" standing in air hotter than "+
          (hotIds.length>1?"they were":"it was")+" built for. The compartment peaks at "+
          s.roomMax.toFixed(0)+" K. Nothing in there survives it indefinitely - find what is putting heat into the room."); }
  ev("h2room",roomH2Peak(s)>=H2_LFL,"alarm","HYDROGEN IN THE COMPARTMENT",
    "Hydrogen off the cladding has left the primary with the steam and is now above its flammability limit somewhere in the room. It needs no spark, only something hot enough - and there is a great deal in there that is.");
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
    ()=>"Over "+H2_EV+" kg of hydrogen has come off the cladding. It is not water and it does not carry heat - and the moment any of it leaves the loop it is a flammable gas in the compartment, at 4% by volume and 773 K.",1);
  ev("melt",s.melt,"alarm","CORE MELT",
    ()=>"A quarter of the fuel is molten and "+s.dmg.toFixed(0)+"% of the cladding has failed. Unrecoverable.",1);
  /* here, beside the event latches, because it is the same pass over the same
     plant and both want the settled window step() is holding open */
  if(s.tick % ANN_TICKS === 0) annStep(s);

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
      const fix=dmgFx(k).fix; if(fix) fix(s, k);
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
  /* AND STEAM AND EXHAUST READ A SOLVED HYDRAULIC RATE, like every liquid run
     already does - normalised on steamScale(), which is the same figure the
     meter prints as its full scale. */
  const steamRun = key => {
    const k = P.net.byKey[key].k;
    if(!runEnds(key,k)) return 0;
    /* A DEAD-ENDED BRANCH IS A RELIEF BRANCH, and what it carries is what its
       own shell is VENTING - not what that shell raised, and not the solve
       either: a dead end is a dead end in a network and carries nothing.
       Asked of the shape of the run (runDeadEnd) and not of "does either end
       happen to be a fitting", which on a plant with a header was every main
       steam run there is. */
    const b = steamBook(key,k);
    if(b.vent){ let q = 0;
      for(const fid of b.taps) q += (s.reliefSteam && s.reliefSteam[fid]) || 0;
      return q*steamDir(key,k); }
    /* ── AND EVERY OTHER STEAM RUN READS THE SOLVE ──
       This used to assemble a rate by walking the drawing and adding books
       together, because there was no solved vapour transport to ask. There is
       one now (vapSolve, pipenet.js), and it is SIGNED along the run key's own
       canonical order - so the direction comes out of the answer instead of
       being decided beside it. */
    return (vap && vap.byKey[key]) || 0;
  };
  for(const key in d){
    const r = P.net.byKey[key];
    if(!r) continue;                           // a design change left a stale key
    /* A SHUT PORT VALVE IS A SHUT VALVE, AND THAT HAS TO REACH THE PICTURE.
       Most runs get it for free - their rate IS the solve's and netBuild()
       already dropped the edge - but the steam lines read a thermal book
       (s.steamTo) and hpi/surge read a correlation, so all four would go on
       counting up through a valve nobody has open, and the meter, which
       differentiates this integral, would print the flow to match. */
    if(!runPortsOpen(s,r)) continue;
    if(r.k==="steam"||r.k==="exh"){
      d[key] += sp*1.4*steamRun(key)/Math.max(1e-6, steamScale(key,r.k));
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
      d[key]+=sp*runRatio(key)*(tag?wet:1)*1.4;
    }
  }
  /* THE SHAFTS STATE A RATE, NOT AN ANGLE. Both used to be an angle kept %360
     and the drawing differenced two of them, which carries no direction at all
     once a frame is worth more than half a turn - at MAX the pumps jittered in
     place. A rate cannot be ambiguous, and it still stops dead with the sim,
     which is the whole reason the angle was on S. Driven by LOAD on the
     turbine - the pumps answer flow, the turbine answers the draw. */
  s.spinV=360*mflux;
  s.spinTV=360*Math.min(s.load,1.5);
  /* ══ AND THE BOOKS HAVE TO CLOSE ══
     What the stores lost this tick, less what the named terms say left. */
  { const res = (ledgM0 - ledgerKg(s)) - (ledgerOut(s) - ledgO0);
    s.massRes = res;
    if(Math.abs(res) > LEDGER_EPS*Math.max(ledgM0,1) && !s.massWarn){
      s.massWarn = true;
      console.warn("[ledger] tick "+s.tick+": "+res.toFixed(3)+" kg unattributed of "
        +ledgM0.toFixed(0)+" kg", JSON.parse(JSON.stringify(s.massOut))); } }
  layRelease();
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
 /* P.vessel first: "the reactor and the turbine are not in balance" is not a
    thing that can be true of a ship with no reactor on it. */
 ["TAVG DEV","amber",s=>P.vessel && Math.abs(s.Tavg-tProg(s))>4,
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
 ["SG LEVEL LO","amber",s=>sgIds().some(id=>sgLvl(s,id)<SG_LOW),
  "A steam generator is below "+SG_LOW+"% and falling. Nothing is uncovered yet: this is the warning ahead of it, and emergency feedwater does not start until "+SG_DRY+"%. Feed it - check the feed pump, the regulating valve and the hotwell before you assume the pump has failed.","sg"],
 ["SG DRY","red",s=>sgIds().some(id=>sgLvl(s,id)<SG_DRY_LO),
  "A steam generator is below "+SG_DRY_LO+"%. Most of the bundle is in steam and that loop is not cooling the core any more. If every generator reads this, the only heat sink left is what leaks out of the boundary.","sg"],
 ["HOTWELL FULL","red",s=>condFrac(s)<1,
  "The hotwell is above "+HOT_FLOOD+"% and the water in it is drowning the tubes that do the condensing. The condenser is losing capacity as it fills, so backpressure rises, the turbine takes less steam, and the shells pressurise behind it. Drain it or stop putting water into it.","cond"],
 ["TURBINE TRIP","red",s=>!!s.turbTrip,
  "Exhaust pressure got past what the machine will run against, so the stop valve is shut and the turbine is passing no steam. The reactor is still making heat. Find the heat sink: circulating water, a drowned hotwell, or a condenser that has been hit.","turb"],
 ["COND VACUUM LOST","red",s=>!!s.condLost,
  "The condenser reached atmospheric pressure and relieved. It is open to the room, it will not hold vacuum again, and it has stopped being a heat sink. Everything the generators raise now goes out of their safety valves, and the water goes with it.","cond"],
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
 /* Appended, like every row above them - help.js numbers the tiles by array
    index, so a row that belongs beside FUEL DMG by subject still goes on the
    end. Hosted on the CONTROL cabinet: the room is a plant-wide fact and the
    cabinet is where the plant-wide facts already light (NO RPS, HI AREA RAD). */
 ["HI ROOM TEMP","red",s=>roomOverIds(s).length>0,
  "A machine somewhere on the plant is standing in air hotter than it was built for, and it is being cooked at a rate you can watch. Heat is a place: it comes off every hot surface, it comes in a flood out of anything venting steam into the room rather than into a tank, it collects where a compact layout gives it nowhere to go, and the only sink is the hull. Find what is putting heat in, or fit something that takes it out.","ctrl"],
 ["H2 FLAMMABLE","red",s=>roomH2Peak(s)>=H2_LFL,
  "Hydrogen off the cladding has escaped the primary with the steam and is now over 4% by volume somewhere in the compartment. Above 773 K it lights itself - no spark needed - and it burns at 120 MJ per kilogram into the room it is standing in. This is the Fukushima sequence.","ctrl"],
 /* Appended, like every row above it. The panels ARE the heat sink out here,
    so this tile is the one that says the chain has come apart at the far end
    rather than in the plant. */
 ["NO HEAT SINK","red",s=>!radIds().some(id=>radLive(id)&&s.dmgParts.indexOf(id)<0),
  "Nothing on this ship is radiating. Every panel is destroyed, or walled in where it cannot see the skin, or there is no panel at all. Heat leaves this ship as light or it does not leave. The condenser will climb until it loses vacuum and the turbine trips, and after that the generators go to their safety valves.","cond"],
 ["PANEL OVERTEMP","amber",s=>radTMax(s)>tsatSec(TURB_TRIP_P)-COND_DT0,
  "The radiator is running hot enough that the condenser behind it is close to the pressure the turbine will not exhaust against. Rejection goes as the fourth power of panel temperature, so the last few kelvin cost far more than the first: cut reactor power, or accept the trip.","cond"],
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
/* ══ THE BOARD IS SWEPT ONCE, BY THE TICK, AND NOWHERE ELSE ══
   Thirteen of these rows walk the drawing, and every reader used to re-run the
   whole table: annLamp() alone is 42 predicates per part per frame, twice, and
   trVldCheck() was another 42 per tick with no picture to show for them. So the
   tick establishes the lit set and everything else reads it - the same move
   s.ev already is, and the same reason it is on S.

   s.annRev counts TRANSITIONS, so anything watching for "a tile moved" watches
   one integer instead of the table. EVERY FIFTH TICK, aligned with the trend
   sampler: a tile that lights and clears inside 0.1 s of plant time is under
   the grain of anything the board reports, and this is a picture of the plant
   rather than a protection system - tripCause() is the one that must not miss. */
const ANN_TICKS=5;
function annStep(s){
  const on=s.annOn;
  for(const a of ANN){ const v=a[2](s)?1:0; if(on[a[0]]!==v){ on[a[0]]=v; s.annRev++; } }
}
/* IS THIS NAMED TILE LIT. The mimic shouts some of these across the component
   they belong to, and a banner drawn off its own copy of the threshold is a
   second protection system that drifts from the board silently. One reader,
   one predicate, so the box and the tile are the same claim. */
const annLit = name => !!(S && S.annOn[name]);
function annLamp(id){
  let best=null;
  for(const a of ANN){
    const host = annHost(a[4]);
    if(!host || !id.startsWith(host) || !S.annOn[a[0]]) continue;
    if(a[1]==="red") return C.red;
    if(a[1]==="amber") best=C.amber;
    else if(!best) best=C.blue;
  }
  return best;
}
