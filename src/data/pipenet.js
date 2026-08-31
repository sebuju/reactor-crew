"use strict";
/* the primary pipe network as a conductance graph - see .claude/CLAUDE.md and
   src/sim/net.js. netFlowK() (bottom of this file) is what feeds pumpK in
   step(); loopFlowK(), the capacity-counting formula it replaced, is gone. */

// Fitted once, for a RATIO - what a metre of pipe costs against a valve or a
// pump - never for a magnitude: netFlowK() only ever hands a caller a flow
// judged against its own reference, and that ratio is provably independent
// of PIPE_K (see the auditor block THE NETWORK IS PIPE_K-INVARIANT...).
// `let`, not `const`: the auditor sweeps it through setPipeK() to prove
// exactly that.
let PIPE_K = 0.006;
// bore of each primary line relative to a full-bore hot/cold leg; resistance
// scales as 1/bore^2, so a narrow branch (HPI, relief) chokes itself down
// without needing a PIPE_K of its own. relief is every relief fitting's own
// bore - see FIT.relief and reliefFullRate() below.
/* ══ A BORE IS A DIAMETER, IN MILLIMETRES ══
   These were dimensionless ratios, so no run had a VOLUME anywhere: bore was
   a number, r.L was metres, and nothing multiplied them into cubic metres. A
   real bore gives every run a holdup. 750 mm is a real hot-leg inside
   diameter for a plant this size and it is the reference every conductance
   was linearised about, so runBore() below still hands back exactly what it
   handed back. */
const BORE_REF = 750;
const PIPE_BORE_MM = {hot:750, cold:750, cw:750, surge:225, hpi:187.5, relief:150, boron:150};
/* A FITTING'S bore is still a fraction of the reference run it sits in, so
   this is the one conversion between the two - never a second table. */
const boreK = kind => (PIPE_BORE_MM[kind] !== undefined ? PIPE_BORE_MM[kind] : BORE_REF)/BORE_REF;
/* This table is a set of DEFAULTS, not permissions: every run carries
   conductance whether or not its kind has a row here (see netBuild()'s single
   edge loop, below) - PIPE_BORE_MM only ever picks the STARTING bore a fresh
   run of that kind gets, and D.bore[key] is the player's own choice.
   steam, feed and exh still have no row, and that is now a decision rather
   than an omission. A feedwater line really is narrower than a hot leg, but
   what a feed pump's head is actually spent on is its REGULATING TRAIN, and
   that is priced explicitly (FEED_LEN, above) rather than smuggled into a
   bore - so narrowing the pipe as well would charge the same restriction
   twice and re-fit FEED_DP against it. Steam and exhaust carry no solved flow
   at all (the solver knows liquid), so a bore for them would be a number with
   nothing behind it. Full-bore, identical to hot/cold, until someone measures
   one. Route every bore read through this resolver, never PIPE_BORE_MM[r.k]
   directly, or the fallback lives in two places and can disagree. */
const runBoreMm = r => (D.bore && D.bore[r.key] !== undefined) ? D.bore[r.key]
                     : (PIPE_BORE_MM[r.k] !== undefined ? PIPE_BORE_MM[r.k] : BORE_REF);
// DEFAULT: PIPE_BORE_MM picks a starting bore, never gates an edge's existence
const runBore = r => runBoreMm(r)/BORE_REF;
/* THE HOLDUP OF A RUN, m^3 - the thing a dimensionless bore could never give.
   r.L is metres, so this is the cylinder and nothing else. */
const runVol = r => Math.PI/4*Math.pow(runBoreMm(r)/1000, 2)*r.L;
/* ══ AND EVERY MACHINE STATES ITS HOLDUP ══
   m^3 of fluid. A node with no volume is a node with no time constant, and
   carrying an enthalpy along the flows needs one everywhere. Stated where the
   machine already states it - a tank IS cubic metres, a generator's shell is
   its own water charge - and taken off the BOX otherwise, which is the same
   honesty the radiator's area has: a bigger machine holds more.
   PART_VOL_CELL is the ship's own scale and is a free parameter, like
   RAD_AREA_CELL beside it. */
const PART_VOL_CELL = 0.35;
function partVol(pid){
  const p = partOf(pid); if(!p) return 0;
  if(p.role === "tank") return Math.max(0.1, (D.tanks[pid]||{vol:0}).vol);
  if(p.role === "sg")   return Math.max(0.1, sgRowOf(pid).water);
  return Math.max(0.1, p.w*p.h*PART_VOL_CELL);
}

/* WHAT A METRE OF PIPE WEIGHS, and it is a MASS term only - nothing here may
   ever reach a conductance, or PIPE_K stops cancelling.

   layMass used to charge a flat 1.6 t/m over every run, so a 0.2 MPa sodium
   line and a 15.5 MPa water line weighed the same and choosing a coolant was
   free outside the core. It is now length x bore x rate: bore because wall
   area follows diameter, and rate because pressure and material decide the
   wall.

   PIPE_WALL_P0 is the wall you build whatever the pressure - a pipe has a
   minimum schedule for handling, support and thermal shock, so the pressure
   term is a FLOOR PLUS P0 and never approaches zero. A bare P0 would price
   an atmospheric loop at a seventy-seventh of a PWR's, which is not a thin
   wall, it is no pipe at all.

   The SECONDARY is water whatever the primary is (tsatSec(), below), so it is
   priced at its own fixed rate and a sodium plant's steam lines are ordinary
   steel. PIPE_MASS_K is fitted ONCE, so the stock PWR's layMass does not
   move off the flat 1.6 t/m it read before: 23.52 primary metre-bores at
   21.5 plus 52.27 secondary at 13.0. */
const PIPE_WALL_P0 = 6;
const PIPE_MASS_K  = 0.111514;
const SEC_RATE     = 13.0;
// every kind that carries the primary coolant. Wider than layoutMetrics()'s
// `pipe` bucket on purpose: that one asks what is in the LOOP hydraulically,
// so a shut relief leg is dead there, and it still holds sodium.
const PRIMARY_K = {hot:1, cold:1, surge:1, hpi:1, relief:1, boron:1};
const pipeWallK   = c => c.pipeK * (PIPE_WALL_P0 + c.P0);
const runMassPerM = r => PIPE_MASS_K * runBore(r) *
  (PRIMARY_K[r.k] ? pipeWallK(COOLANT[D.cool]) : SEC_RATE);

// A coolant pump's developed head at rated speed, in MPa, before
// loopPumpCap() scales it for what is actually installed. Fitted once and
// stated as such - the RAD_K / BREAK_K idiom - at the head a real
// reactor coolant pump makes, because the solve is ABSOLUTE now: every
// potential it hands back is a pressure in MPa that a gauge prints, so this
// number sets how far pump discharge sits above the pressurizer and how much
// of that a throttle can take away. Nothing else derives from it.
//
// Head still cancels out of FLOW, but as a whole and no longer term by term:
// the system is linear in head, so scaling every h together scales every flow
// together and netFlowK() - which only ever consumes Q/P.netRef - cannot
// move. Scaling THIS alone does not, because buoyancy (buoyH, below) is a
// head that does not scale with it; that changes the pump-to-buoyancy ratio,
// which is a real change to the answer, not a bug. See the auditor.
let PUMP_H0 = 0.60;
/* A scale on EVERY head - the pump's and buoyancy's alike. It is 1 and the
   game never moves it; it exists because the invariance is the property, and
   a property nobody can sweep is a claim nobody has checked. The network is
   homogeneous in head, so scaling this scales every flow and every potential
   together and netFlowK() - which only consumes Q/P.netRef - cannot move.
   Sweeping PUMP_H0 ALONE is a different question and legitimately does move
   it, because buoyancy is not a common scale on every head; see the auditor.
   `let` plus a setter, the identical idiom PIPE_K already uses. */
let HEAD_K = 1;
function setPumpH0(v){ PUMP_H0 = v; }
function setHeadK(v){ HEAD_K = v; }

// Gravity, in MPa per (kg/m^3 x metre): 9.81 Pa per kg/m^3 per metre, over
// 1e6 Pa/MPa. The one place the unit conversion happens.
const G_MPA = 9.81e-6;
// COOLANT's `dens` is the coolant family's density on a scale where pressurised
// water is 100, so RHO_K turns it into kg/m^3 (PWR -> 700, hot water at
// 300 C). RHO_BETA is the linear expansion coefficient about P.Tref - the
// only thing buoyancy actually consumes, because the loop's static heads
// cancel exactly for any single density (see buoyH) and only the DIFFERENCE
// between a hot leg and a cold one can drive anything.
const RHO_K = 7, RHO_BETA = 2.4e-3;
/* Buoyancy head per kelvin of core rise, in kg/m^3 - and it is the SAME for
   every coolant family, which is not a fit but a collapse.

   The thermal model pins the core's rise at CORE_DT0 for every architecture
   (the 0-D split every trip and coefficient was calibrated against, see
   step.js), while a family's REAL rise scales as 1/dens: the same power has
   to leave in the same volume of a coolant that carries `dens` times as much
   heat per litre. Buoyancy is rho*beta*dT_real, and rho is proportional to
   dens, so dens cancels against the rise it forces and what is left is a
   constant. Read the other way round: what decides how hard a loop
   thermosiphons is not how dense its coolant is, because a dense coolant
   buys back in temperature rise exactly what it loses in expansion per
   kelvin.

   The STATIC column is a different question and keeps the family's real
   density (rhoAt, rhoDatum below) - a sodium loop's absolute pressure
   profile really is not a helium loop's. */
const BUOY_PER_K = RHO_K*100*RHO_BETA;
/* And one factor on top of that, fitted once and stated as a fit - the RAD_K
   idiom - because it is the price of solving a linear network.

   Every conductance in this graph is LINEARISED about rated flow, where the
   pumps put about 0.6 MPa across it. Real pipe friction is quadratic, so at
   the few percent of rated flow a thermosiphon actually runs at, the true
   resistance is roughly (Q/Q_rated) times the linear one - more than an
   order of magnitude lower. A linear network therefore under-predicts
   natural circulation, and without this a stock plant reads 1.4% of rated
   flow where a real PWR carries 4-5%. Fitted against that textbook figure,
   and it is what lets a real pump head (PUMP_H0) and a real coolant density
   (rhoAt) both keep their own values instead of one of them absorbing this.

   INSIDE the head, so every invariance holds unchanged: scaling every head
   still cancels exactly, an isothermal loop still develops identically zero,
   a shut valve still stops the thermosiphon dead, and a high steam generator
   still out-circulates a low one. */
const BUOY_LIN = 9;
const rhoAt = T => P.rho0 * (1 - RHO_BETA*(T - P.Tref));
// The loop at its own average temperature - the DATUM buoyancy is measured
// against, and the column netPressures() adds back to turn what the solve
// carries into a pressure.
const rhoDatum = s => rhoAt(s.Tavg === undefined ? P.Tref : s.Tavg);

// The path THROUGH a component's own body (sg tubes, pump casing) - priced
// as a short length of full-bore pipe, not a bare resistance, so it scales
// with PIPE_K exactly like every real run does. A resistance that did not
// share PIPE_K's scale would stop the whole graph being homogeneous in it,
// and a flow ratio would then depend on PIPE_K instead of cancelling it -
// see THE NETWORK IS PIPE_K-INVARIANT... in the auditor, which sweeps
// PIPE_K three orders of magnitude specifically to catch that.
const NET_COMP_LEN = 0.1;   // metres-equivalent, short against a real run
/* A GENERATOR'S OWN FEEDWATER PATH is not a short piece of full-bore pipe.
   Priced at NET_COMP_LEN it carried about 15,800 kg/s per MPa, so the 0.42 MPa
   secP() spread the stock loops legitimately develop swung feedwater by six
   thousand kg/s and no valve could settle against it - the regulator below
   went bang-bang at its own rate limit and stayed there. A real feedwater
   train (regulating valve, economizer, distribution ring) is where the pump's
   head is spent, and this is that length. Still a resist(), so it shares
   PIPE_K exactly like every other conductance and the invariance sweep is
   untouched; still STATIC, so it never enters netFactored()'s signature. */
const FEED_LEN = 400;

function setPipeK(v){ PIPE_K = v; }

// floored at NET_COMP_LEN rather than L itself: a degenerate zero-length run
// (two ports that landed on the same point) still needs a real, PIPE_K-
// scaled resistance, or it would reintroduce exactly the fixed, non-scaling
// term this stage is written to avoid. Module-level, not local to netBuild():
// FIT's own g() functions need it too, evaluated live off a length that can
// include a valve's equivalent length as well as a run's real one.
const resist = (bore, L) => (bore*bore)/(PIPE_K*Math.max(L,NET_COMP_LEN));

/* A tank's own delivery line - MEASURED, not assumed, to need its own scale.
   It sees the loop's full differential against the tank's own pressure, up
   to several MPa, never the ~0.6 MPa a pump develops - the identical
   mismatch BREAK_K's own comment documents for a severed run. Unlike a
   break this edge keeps its LENGTH term: injection is subsonic and
   friction-dominated at the bore this line runs, not a choked orifice, so a
   longer line still genuinely costs more - that argument survives Stage 5b
   intact, only the SCALE it is priced at changes. Priced at PIPE_K
   (resist(), above) the stock accumulator's own depressurised injRate
   measured at 16.6 %/s - an order of magnitude past anything the bench ever
   promised, the identical collapse FIT.relief.g's own comment found and for
   the identical reason. INJ_K is fitted once, the RAD_K/BREAK_K idiom, so
   that figure lands near 1.5 %/s instead - close to the pre-Stage-5b
   tankG() figure, which was itself a design choice rather than a measured
   truth, but a believable ANCHOR beats an unscaled one. */
const INJ_K = 0.066;
const injResist = (bore, L) => (bore*bore)/(INJ_K*Math.max(L,NET_COMP_LEN));

// A valve's own resistance, expressed as an EQUIVALENT LENGTH added to
// whatever run it sits on - never a multiplier on that run's conductance, or
// the same valve would cost more on a long run than a short one. Wide open
// (x>=1) this is exactly 0, so a run with a wide valve on it is bit-for-bit
// the same edge as a run with none - nothing has to be re-pinned the day a
// throttle is placed on a stock leg and left alone. VALVE_XMIN floors the
// denominator rather than letting x reach 0 here; x<=0 is handled by the
// caller omitting the edge outright (see FIT.throttle and netBuild()'s
// pushSeg), the same way a shut tee already is - a removed edge, not a huge
// one. Neither constant is fitted against a measured valve; nothing in the
// documented behaviour depends on either, because every existing design has
// no fittings at all and so never calls this.
const VALVE_LEQ=2, VALVE_XMIN=0.05;
const valveLeq = x => x>=1 ? 0 : VALVE_LEQ*(1/Math.max(x,VALVE_XMIN)**2 - 1);

// series resistance for a run of length L carrying zero or more throttles by
// id, in series - shared by a branch edge (always exactly one id) and an
// in-line run segment (zero or more, folded straight into the pipe it sits
// on) so the "wide open costs nothing, shut removes the edge" rule is
// written once. Any one throttle at x<=0 cuts the whole edge, same as a
// shut tee: a valve is a real break in the pipe, not a small leak.
// "no gate in this path" - shared, because a literal here is one array per
// edge per solve to say the same nothing
const NO_GATES = [];
const throttled = (s, bore, L, ids) => {
  let Ltot = L;
  for(const fid of ids){
    const x = s.valve && s.valve[fid];
    if(!(x>0)) return 0;
    Ltot += valveLeq(x);
  }
  return resist(bore, Ltot);
};

/* ══════════ A BREAK IS A HOLE, NOT A BLOCKAGE ══════════
   A severed run used to be modelled as a plugged pipe: conductance to zero
   and not one gram of coolant lost, which is the textbook large-break LOCA
   drawn as a blockage. It is an opening now, and so is a ruptured vessel -
   both are an EDGE to a fixed node at containment pressure, so where the
   break is, how big it is and when it stops all fall out of the same solve
   nothing new had to be invented for.

   BREAK_K is fitted once - the RAD_K idiom - and it is NOT resist(). It
   cannot be, and the reason is worth stating: every conductance
   in this graph is linearised about a PUMP head, about 0.6 MPa, where pipe
   friction really is close to linear in dP. A break sees the whole loop
   pressure, 15 MPa, and real break flow is CHOKED - proportional to the root
   of the differential, not to the differential. Pricing a hole as a length of
   pipe would therefore over-predict its flow by more than two orders of
   magnitude at the pressure a break actually sees. This is that curve
   linearised where it matters, fitted so a full-bore severance empties the
   loop at about the rate the old flat 2.4 %/s always did, and it deliberately
   does not share PIPE_K's scale - a break is not a pipe. */
const BREAK_K = 0.21;
// A ruptured vessel is a bigger hole than a severed leg, and it is the one
// break whose size is not read off a pipe's bore.
const BREACH_BORE = 1.6;
// How long the loop's whole inventory takes to pass one point at rated flow,
// in seconds - the one place a network FLOW becomes a percentage of loop
// INVENTORY, so a solved outflow, an injection and a vent are all charged to
// s.inv in the same units through the same constant.
const LOOP_TRANSIT = 12;
/* ONE HIT BREAKS ONE CELL. The id is "pipe:"+x+","+y - the "pipe:" prefix is
   kept deliberately, so netFactored()'s cache signature and dmgFx()'s prefix
   match (step.js) are both untouched by the move from whole runs to cells. */
/* THE BROKEN CELLS, AS A SET OF PACKED COORDINATES. This is asked once per
   pipe cell per edge per solve, and it used to build the key string "pipe:x,y"
   for every one of those and then walk s.dmgParts looking for it. Rebuilt when
   that array is REPLACED or GROWS, which is the whole of how it ever changes:
   a hit pushes to it and a repair filters it into a new one. */
const cellPack = (x,y) => x*4096 + y;
let brokeArr=null, brokeLen=-1, brokeSet=null;
const cellBroken = (s, x, y) => {
  const d = s.dmgParts;
  if(!d || !d.length) return false;
  if(brokeArr!==d || brokeLen!==d.length){
    brokeSet = new Set();
    for(let i=0;i<d.length;i++){ const id=d[i];
      if(id.lastIndexOf("pipe:",0)!==0) continue;
      const c = id.indexOf(",",5);
      brokeSet.add(cellPack(+id.slice(5,c), +id.slice(c+1))); }
    brokeArr=d; brokeLen=d.length; }
  return brokeSet.has(cellPack(x,y));
};
/* ══ EVERY PORT HAS A VALVE IN IT ══
   A nozzle on a real vessel carries an isolation valve at the shell, and it is
   the first thing a watch reaches for when a run has to be cut out. So it is
   not a design choice and it costs nothing to fit: every port has one, and
   every one of them commissions OPEN, which is why a plant nobody touches
   solves bit-identically to one with no port valves at all.
   SHUT IS AN ABSENT EDGE, never a large resistance - the same rule the gated
   fittings keep, and what netAssemble's g<=0 skip is there for. */
const portOpen    = (s, pid) => !(s.portShut && s.portShut[pid]);
const runPortsOpen = (s, r)  => portOpen(s, r.pa) && portOpen(s, r.pb);

/* ══════════ A TUBE RUPTURE IS A DIFFERENTIAL LEAK ══════════
   An SGTR is THE pressure-difference leak: a primary at 15.5 MPa bleeding
   into a secondary at about 7, at a rate set by nothing except that
   difference - and the standard operator answer is to depressurise the
   primary until it stops. None of that was reachable while it was a flat
   0.30 %/s that ran forever whatever anybody did.

   The secondary side does NOT get a solve. It gets a PRESSURE, which is all a
   boundary needs, and it is the same figure the steam generator's own STEAM
   PRESS row has always printed - one expression, two readers, so the panel
   and the leak cannot disagree. CLAUDE.md's rule that the secondary prices
   the heat and is not a physics path is intact.

   Per GENERATOR, gated on that generator's own damage rather than on the
   plant-wide s.sgtr flag: combatHit names a component, so the tubes that
   ruptured are the tubes of the one that was hit. */
/* ══ EVERY GENERATOR HAS ITS OWN SECONDARY PRESSURE (Stage 6b) ══
   This was one scalar of s.load applied to EVERY generator's fixed node.
   Stage 1A made the NODE per generator and then fixed all of them at the
   identical number, so an SGTR's driving differential could not differ loop
   to loop and CLAUDE.md's claim that per-loop asymmetry lives in the steam
   generators was not yet true. Measured on a 2-loop plant with pump0
   destroyed: sg0t and sg1t both read 6.975, bit-identical.

   Two things make it a generator's own now, and both were already on S:

   - ITS OWN HEAT LOAD. s.sgShare is that generator's share of the heat
     leaving the primary, measured off the per-loop flow the network solved
     (step.js). Scaled by the number of generators, so an even split reads
     exactly s.load and a symmetric plant is bit-identical to what this
     always returned.
   - ITS OWN INVENTORY. A generator boiling dry raises less steam, so its
     pressure falls - toward COND_P0, the header it is connected to, never to
     zero. sgFill() is 1 above SG_DRY, so again a healthy plant does not move.

   Both collapse to the old single expression on a healthy symmetric plant,
   which is why nothing pinned against one re-pinned. */
const secLoad = (s, id) => {
  const l = s.load===undefined ? 1 : s.load;
  if(id===undefined || !s.sgShare) return l;
  const n = Object.keys(s.sgShare).length, w = s.sgShare[id];
  return (n>0 && w!==undefined) ? l*n*w : l;
};
/* ══ ONE SATURATION CURVE, PER FLUID, NOT PER SIDE ══
   The same power law was written twice with different anchors. A curve is
   {p0,T0,n} plus the floor its own argument is clamped at; a fluid owns one.
   The primary's rides the architecture (P.sat, built in commission()) because
   its anchor moves with D.pdes; water's is a constant and lives here. */
const satT = (c,p) => c.T0*Math.pow(Math.max(p,c.pFloor)/c.p0, c.n);
const satP = (c,T) => c.p0*Math.pow(Math.max(T,c.TFloor)/c.T0, 1/c.n);
// dp/dT along that same curve, exact rather than differenced - a boiling
// primary is pressurised by its own temperature rate (step.js)
const satSlope = (c,p) => Math.max(p,c.pFloor)/(c.n*satT(c,p));

/* ══ THE SECONDARY IS WATER, WHATEVER THE PRIMARY IS ══
   The PRIMARY curve is anchored on that architecture's own boiling point -
   sodium at 1150 K, salt at 1700 K. The shell is full of water on every plant,
   so it gets its own anchors: saturated steam at 6.9 MPa is 558 K. It inverts,
   which is what lets the shell be a pot: temperature in, pressure out.
   The exponent is fitted across the range this plant actually uses rather than
   copied off the primary curve: 6.9 MPa/558 K and 0.01 MPa/319 K are both real
   steam-table points, and 0.10 could not hold both - it put a condenser under
   vacuum at 290 K, which is colder than the river it rejects into. */
/* A CURVE WITHOUT ITS OWN hfg IS HALF A FLUID. 1510 kJ/kg is feedwater to
   saturated steam at these anchors, and it was a separate constant in step.js
   that nothing tied to the curve it belonged to. */
/* cp is CP_W (step.js) on BOTH curves, because that is the one specific heat
   this model already prices every loop's inventory at (loopKg()*CP_W). A curve
   with a cp of its own that disagreed with the pot integrating against it
   would be two answers to one question. */
const SAT_WATER = {p0:6.9, T0:558, n:0.0855, pFloor:1e-4, TFloor:1, hfg:1510, cp:5.5};
/* ══ ENTHALPY, ON THE CURVE THE CIRCUIT ACTUALLY CARRIES ══
   Specific enthalpy, kJ/kg, measured from H_DATUM. Three straight lines: a
   subcooled liquid rising at cp, a flat two-phase shelf that costs hfg to
   cross, and superheat rising at cp again. That is enough to MIX honestly -
   which is the whole point - without a steam table this game has no use for.
   satH()/satHg() are the two ends of the shelf at a stated pressure. */
const H_DATUM = 273.15;
const satH  = (c,p) => c.cp*(satT(c,p) - H_DATUM);
const satHg = (c,p) => satH(c,p) + c.hfg;
// what a fluid at this temperature is worth, taken as liquid: the seed and
// the way a pot's temperature enters the field
const hOfT  = (c,T) => c.cp*(T - H_DATUM);
/* And back. Below the shelf and above it a temperature is what the enthalpy
   says; ON the shelf every enthalpy is the same temperature, which is exactly
   what saturation means. */
const tOfH  = (c,p,h) => { const hf=satH(c,p);
  if(h <= hf) return H_DATUM + h/c.cp;
  const hg=hf+c.hfg;
  return h >= hg ? satT(c,p) + (h-hg)/c.cp : satT(c,p); };
/* STEAM QUALITY - the share of the mass that is vapour. Below the shelf it is
   0, above it 1, and in between it is where on the shelf you are. Nobody
   declares this anywhere: it falls out of what flowed in. */
const xOfH  = (c,p,h) => { const hf=satH(c,p);
  return clamp((h-hf)/c.hfg, 0, 1); };
/* ══ A FLUID IS A PROPERTY OF THE CIRCUIT ══
   These two used to read SAT_WATER unconditionally, which is the sentence "the
   secondary is water, whatever the primary is". They take a CIRCUIT INDEX now
   and this is the one place that answers it: the core's circuit rides the
   architecture (P.sat, built in commission()), and every other circuit is
   water until something says otherwise. No argument still means water, so a
   caller that genuinely has no circuit to hand reads what it always read. */
const satOfCirc = ci => (ci!==null && ci!==undefined && ci>=0 &&
  ci===nodeGraph().coreCirc && typeof P!=="undefined" && P && P.sat) ? P.sat : SAT_WATER;
const tsatSec = (p, ci) => satT(satOfCirc(ci), p);
const psatSec = (T, ci) => satP(satOfCirc(ci), T);
const hfgOfCirc = ci => satOfCirc(ci).hfg;

/* ══ STEAM OVER WATER, AT THE PRESSURE IT IS ACTUALLY AT ══
   The density ratio drift flux reads (core2d.js). It was a typed 0.05, which is
   the ratio at 6.9 MPa - so a PWR sitting at 15.5, where it is really 0.17, was
   making three times the void per unit of quality on the one plant every figure
   in this repo is pinned against. Two real steam-table points, 7 MPa/0.049 and
   15.5 MPa/0.172, interpolated in the distance left to the critical point,
   which is the variable that actually collapses the two densities together.
   It reaches 1 at 20 MPa on its own; the floor under the base is numerical
   headroom past critical, where the power has no real value at all. */
const RVL_PC=22.06, RVL_A=0.049, RVL_B=0.6827, RVL_N=-1.512;
const satRvl = p =>
  Math.min(1, RVL_A*Math.pow(Math.max(1-p/RVL_PC, 1e-3)/RVL_B, RVL_N));

/* THE FALLBACK ONLY. A shell with a temperature of its own is a saturated pot
   and secP() reads that; this is what a caller with no live S gets - the design
   bench, layoutMetrics(), a tick-zero seed. */
const secPTarget = (s, id) => {
  const base = P.P0*0.45*Math.pow(Math.max(secLoad(s,id),.05),.25);
  const fill = (id===undefined || !s.sglBy || s.sglBy[id]===undefined)
             ? 1 : clamp(s.sglBy[id]/SG_DRY,0,1);
  return COND_P0 + (base-COND_P0)*fill;
};
/* ══ THE SHELL IS A SATURATED POT ══
   Pressure is not a formula about load any more: it is what saturation says
   about the shell temperature step() integrates (s.sgTBy). Trapped steam
   raises it, which the old formula could not represent at all - it fell by
   half while the generator boiled into a closed vessel. */
const secP = (s, id) => {
  /* A BURST SHELL IS AN OPENING. It cannot hold pressure again whatever its
     temperature says, so it sits at the room's - the same anchor a break and a
     vent already relax to. Read here rather than at each caller, because every
     one of them (the feed pumps' fixed node, the SGTR differential, the panel)
     is asking the same question. */
  if(id!==undefined && s.sgBurst && s.sgBurst[id]) return P.Pcont;
  const T = id!==undefined && s.sgTBy ? s.sgTBy[id] : undefined;
  return T===undefined ? secPTarget(s,id) : Math.max(COND_P0, psatSec(T, id===undefined?undefined:shellCirc(id)));
};
// rated leak, in % of loop inventory per second, at the design differential -
// the flat rate this used to run at, kept as the scale and turned into a
// conductance so the differential can move it
const SGTR_RATE = 0.30;
const sgtrG = () => (SGTR_RATE/100)*P.netRef*LOOP_TRANSIT/Math.max(P.P0*0.55, 0.05);
const sgtrLive = (s, id) => !!(s.dmgParts && s.dmgParts.indexOf(id) >= 0);

/* ══════════ FLUID: a table of SUBSTANCES, not of components ══════════
   There is no such thing as "the HPI tank" any more. There is a tank, and
   there is what is in it. This table is the second half of that sentence -
   a real physical taxonomy, not a component list, and the thing that lets
   ONE tank component be four different tanks.

   There is deliberately no DENSITY row. The solve carries piezometric head
   about rhoDatum(), so a fixed node's own column is the DATUM's by
   definition, and the only other place a density could go is buoyH() - which
   is a TEMPERATURE anomaly, and where buoyancy strength being a collapse
   rather than a fit is pinned. A density field here would have had no honest
   consumer, and dead config reads as a second implementation of the thing it
   is named after.

     act    what a FULL tank of it reads as a radiation source (rad.js).
            Only contaminated carries any.
     boron  pcm of reactivity delivered per 1 % of loop inventory pushed into
            the loop. Zero for anything that is not poison, so the term is
            unconditional and there is no "is this the boron tank" test.
     temp   K at the tank's own liquid surface. DISPLAY ONLY, the same words
            netTempAt()'s condenser tag already carries: a tank is not a
            thermal path yet, and a number that looked like one would be
            read as one. */
const FLUID = {
  water:        {label:"WATER",        act:0, boron:0,   temp:310},
  /* A default tank of this (TANK_DEFAULT, below) is worth almost exactly the
     4000 pcm the old one-shot EMERG BORON button subtracted in a single tick
     - kept as the SCALE so the mechanic reads the same, while what changed is
     that it now arrives over the seconds the tank takes to empty against loop
     pressure, through the same solved edge every tank uses. */
  borated:      {label:"BORATED",      act:0, boron:100, temp:310},
  condensate:   {label:"CONDENSATE",   act:0, boron:0,   temp:320},
  contaminated: {label:"CONTAMINATED", act:1, boron:0,   temp:400},
};

/* ══════════ AUTORULE: when a tank opens itself ══════════
   Every tank has a valve the operator can open and shut (s.tankOpen). Some
   tanks also have a rule that opens it for them. EFW's "starts on low level,
   not on being armed" is a rule the player PICKS here, not a lambda welded to
   one named tank - which is what let an emergency pump overfill a healthy
   generator for as long as "armed" was the only gate.
   `live` is asked every tick and never latches: a rule that stopped being
   true shuts the valve again, and the operator's own switch is an OR beside
   it, never overridden. */
const AUTORULE = {
  manual: {label:"MANUAL ONLY",       live:()=>false},
  /* Locked open. This is what a relief header IS: what holds the relief tank
     shut is the RELIEF VALVE upstream of it (FIT.relief), not anything this
     tank's own edge could ask about honestly. A rule, not a special case -
     any tank may be given it. */
  always: {label:"ALWAYS OPEN",       live:()=>true},
  /* TWO SETPOINTS, because a feed train runs to a level. It starts below
     SG_DRY and keeps running until SG_EFW_OFF, off what it decided last tick
     (s.tankAuto, refilled by step()) - one setpoint parked the plant on its
     own threshold and re-alarmed on every wobble there. */
  sglow:  {label:"LOW SG LEVEL",      live:(s,id)=>sglMin(s) <
             ((s.tankAuto && s.tankAuto[id]) ? SG_EFW_OFF : SG_DRY)},
  plow:   {label:"LOW LOOP PRESSURE", live:s=>s.P < P.P0*0.55},
};

/* ══════════ A TANK ══════════
   Under a pressure field a tank is exactly five things: an ELEVATION (its own
   node's, live, off the grid like every other), a LEVEL 0..100, a PRESSURE
   that follows from that level and the gas above it, ONE EDGE into the
   network, and CONTENTS with an activity. SOURCE OR SINK IS NOT DECLARED -
   it is which way the solved differential points through that one edge.
   "The disc bursts" and "the tank runs dry" are the same mechanic seen at
   the two ends of one range.

   A TANK IS CLOSED, with a cover gas. State it, because it is what makes the
   pressure mean anything: a vented tank never pressurises, so it could have
   no back-pressure and no rupture disc. The gas space is what rises as a sink
   fills and falls as a source empties.

   The config for every instance lives in D.tanks[id] (design.js) - so it
   rides designSig(), the recording head and the save file for free - and all
   of it is free except `side`, which decides whether the tank gets a node at
   all. Neither mass nor node is config: mass follows from `vol`, and
   netBuild() writes the CURRENT node back every rebuild off the part's own
   declared ROLE.fixed and whatever pipeNetwork() actually routed that frame.

     side    "primary"   - a node in the graph and one solved edge
             "secondary" - a boundary, no node, no solve (CLAUDE.md: the
                           secondary is PRICED, not solved)
     vol     capacity, in % of that side's own reference inventory -
             loopKg() for the primary, hotMass() for the secondary. One
             conversion carries a solved flow into both a tank level and
             s.inv, so a tank cannot leak into the loop's books.
     level   0..100 at commissioning
     fluid   which FLUID row is in it
     gas     {p0,frac} cover gas, or null for a tank with no charge at all.
             ONE law, exact: p(l) = p0*frac/(frac + (level - l)/100), where
             `level` is the commissioning level the charge was set at. Both
             laws this replaces are that function at two commissioning
             levels - a full accumulator (level 100) and an empty relief tank
             (level 0).
     pump    {p,bus} - a machine that holds `p` MPa until the tank is dry and
             dies with `bus`. null for a passive tank, which is the one
             injection path a blackout does not kill.
     check   non-return valve on its own edge (the diode, below)
     auto    an AUTORULE key
     burst   {at,drain,rel} rupture disc, or null: it lets go at `at` MPa,
             puts the tank on the floor at `drain` %/s, and each point of
             level dumped costs `rel` of release. Latched - a burst disc does
             not reseat.
     cell    [x,y] on the grid, or null for a SECONDARY tank that has no node
             and therefore needs no cell: the hotwell lives inside the
             condenser it condenses into, and giving it a box of its own
             would be inventing hydraulics the secondary does not have. */
/* NO `side` ROW. Which side a tank is on is not config and never was a choice
   the designer should have been asked to make - it is read off the runs
   (tankCircuit(), layout.js). A new tank starts connected to nothing and is on
   no side at all until somebody draws a pipe to it. */
/* ══ A TANK'S SIZE IS A VOLUME, m^3 ══
   `vol` was a PERCENTAGE of whichever side's reference inventory the tank
   happened to be plumbed to, so the same tank changed size when somebody
   moved its pipe. It is cubic metres now and it is the same number wherever
   it is piped. */
const TANK_RHO = 1000;                 // kg/m^3 - cold water, which is what a tank holds
const TANK_DEFAULT = {
  vol:35, level:100, fluid:"water",
  gas:{p0:4.5, frac:0.35}, pump:null, check:true, auto:"manual", burst:null,
};
/* ══ ONE FITTING. No kinds, no presets, no special cases ══
   A tee, a branch throttle and a relief valve are one component with `mode`
   set differently - the identical contract TANK_DEFAULT above states for
   tanks. Every field is the player's; `cell` is written back by moveTo() and
   `mode` is what decides whether the thing has an edge at all.
   lift/reseat are carried unconditionally rather than behind a mode check: a
   fitting that is never "relief" simply holds two unread nulls, which is
   cheaper than a second branch in the one function every fitting is built
   through. null means "this plant's default" - reliefSet() (step.js) is the
   one place that answers what that is. */
const FIT_DEFAULT = {
  name:"VALVE", col:"#c8b060", cell:null, mode:"throttle", bore:0.55,
  lift:null, reseat:null,
  tip:"A fitting in the pipe. Say what it is on its own panel - a tee that joins two lines, a throttle you can close, or a relief valve that lifts on pressure.",
};
const tankIds   = () => Object.keys(D.tanks);
const secTankIds= () => tankIds().filter(id=>tankSecondary(id));
/* A tank with no cell has no box on the grid and no node - which is what a
   SECONDARY tank is allowed to be. It is HOSTED: the hotwell lives inside the
   condenser it condenses into, and the condenser draws it. */
const hostedTankIds = () => tankIds().filter(id=>!D.tanks[id].cell);
/* Which tanks could poison the loop - off what is IN them, never off a name.
   Zero of them is a legal plant; four is a legal plant, and four of them are
   worth four times one. */
const boronTankIds = () => tankIds().filter(id=>
  tankPrimary(id) && tankFluid(id).boron>0);
/* Kilograms, off the tank's own volume and nothing about where it is piped.
   There is one currency now: a tank on no circuit at all holds exactly what a
   tank of that size holds. */
const tankKg = id => D.tanks[id].vol*TANK_RHO;
/* Several tanks lined up together behave as one tank of their combined size.
   Two questions, one answer: how much is in the pool, and how full it is. */
const tankPoolKg = (s,list) => { let m=0;
  for(const id of list) m += (s.tank[id]||0)/100*tankKg(id); return m; };
const tankPoolPct = (s,list) => { let c=0, m=0;
  for(const id of list){ const k=tankKg(id); c+=k; m+=(s.tank[id]||0)/100*k; }
  return c>0 ? 100*m/c : 0; };
const tankFluid = id => FLUID[D.tanks[id].fluid] || FLUID.water;
const tankLvl   = (s,id) => (s.tank && s.tank[id] !== undefined) ? s.tank[id] : D.tanks[id].level;
/* ══ IS THERE ANYTHING IN IT, OR IS THAT THE INTEGRATOR'S OWN DUST ══
   tankInjecting()'s argument, one quantity over: a level is integrated from a
   SOLVED rate, so a tank at rest sits at ±1e-15 rather than at 0 and a bare
   `lvl > 0` answers both ways on alternate frames. Measured on a relief tank
   taking its first water: the mimic flashed between the empty colour and the
   holding colour every frame. The floor is a fraction of the level's OWN
   reference, which for a percentage is 100. Takes the VALUE, not (s,id), so
   the bench asks it of D.tanks[id].level through the same door. */
const TANK_LVL_EPS = 0.05;                    // % of full
const tankWet   = lvl => lvl > TANK_LVL_EPS;
/* A pump dies with its bus; a gas charge does not. A tank with neither reads
   zero, which is exactly what a pumped tank with no nitrogen behind it is
   worth in a blackout - and the whole of why an accumulator is worth buying. */
const tankPumpLive = s => !s.blackout || (!s.bkpLost && autoLive("bkp"));
function tankP(s,id){
  const t = D.tanks[id];
  if(!t) return 0;
  if(t.pump) return tankPumpLive(s) ? t.pump.p : 0;
  if(!t.gas) return 0;
  return t.gas.p0*t.gas.frac/(t.gas.frac + (t.level - clamp(tankLvl(s,id),0,100))/100);
}
/* What the bench quotes as this tank's rated delivery, in % of loop inventory
   per second. An OUTPUT the panel reads back off the model, never an input
   the solve consumes - the line is a real resist(bore,length) edge and this
   is only what that model measures at full differential against containment. */
const tankRateRef = id => (D.tanks[id] && D.tanks[id].pump) ? 1.6 : 2.6;
/* ══ IS THIS TANK INJECTING, OR IS THAT A FLOAT ══
   A solved edge on a balanced plant returns the difference of two large
   numbers, so a tank sitting shut against a loop at full pressure reads
   +1e-17 one tick and -1e-17 the next. Against a bare `q > 0` that is a tank
   injecting, half the time, forever: measured, the event log filled with 240
   INJECTING lines in 180 s on a plant where nothing was open and inventory
   never left 100.00 %. It was not only noise in the log - the same test adds
   half a pressure-programme step to Pdem, so an idle plant's pressure demand
   was being nudged every other tick by a rounding error.

   Judged against the tank's OWN full-scale rate, so this is a fraction and
   not a hidden absolute: eleven orders of magnitude above the noise and six
   below anything a player could see move. */
const tankInjecting = (id, q) => q > 1e-6 * tankRateRef(id);
/* ══ THE CHECK VALVE IS A MODE, NOT A NAME ══
   An injection line does not run backwards. A non-return valve is a DIODE,
   and this solve is LINEAR - a gate that depends on the answer cannot be
   part of the question - so it reads last tick's s.pCore rather than this
   tick's, and it is a BOOLEAN so the factorisation cache holds two states
   to key on, not a continuum (see netFactored's own signature, below).
   A tank with no check valve always answers open here; asking is free and
   costs nothing new for a tank this can never gate. */
const tankCheckOpen = (s, id) =>
  !D.tanks[id].check || (s.pCore === undefined || s.pCore < tankP(s, id));
/* THE OPERATOR'S OWN VALVE, or the rule that opens it for them. One question
   asked of every tank alike, in place of s.hpi, D.efw's "armed" flag and
   boronDump's one-shot latch. A tank that is empty is empty, which is the
   same refusal the latch used to express as a flag.
   The relief tank has no switch and no rule and still reads OPEN: what holds
   it shut is the RELIEF VALVE upstream of it (FIT.relief), not anything this
   tank's own edge could ask about honestly - so a tank with no check valve
   and no gas charge of its own to fight is one this can never gate. */
const tankOpen = (s,id) => {
  if(s.tankOpen && s.tankOpen[id]) return true;
  /* the operator may defeat the RULE without touching the valve - the same
     "fitted, then armed" pair every automatic system answers, per tank
     rather than as one flag over a named system */
  if(s.tankByp && s.tankByp[id]) return false;
  const r = AUTORULE[D.tanks[id].auto];
  return !!(r && r.live(s,id));
};
/* A tank that opens itself, and has not been bypassed. This is what
   "emergency feedwater is armed" MEANS now - there is no such system, there
   are tanks with rules - and it is what the steam dump after a trip and the
   reserve delivery both ask. `always` is the circuit, not a rule you arm. */
const tankRuleLive = (s,id) => {
  const a = D.tanks[id].auto;
  return a!=="manual" && a!=="always" && !(s.tankByp && s.tankByp[id]);
};
const tankRuleAny = (s,pick) => tankIds().some(id =>
  (!pick || pick(id)) && tankRuleLive(s,id));
/* Can this tank's own edge carry anything at all? Valve, diode, and one more:
   an EMPTY tank has nothing to give. Stated as "or the loop is above me", not
   as a bare level test, because a tank at 0 with the loop above it can still
   be FILLED - which is the entire life of a relief tank, and a bare level
   test would weld it shut at commissioning. A checked tank cannot reach that
   second clause anyway (the diode already demands the loop be BELOW it), so
   this is exactly the old HPI gate for a checked tank and a real capability
   for an unchecked one.
   BUT ONLY FOR A TANK YOU CAN FILL: you cannot backfill a tank through its own
   discharge pump, so a PUMPED tank is its pump - water left, and a bus to turn
   it. Without that split the clause asked s.pCore, the PRIMARY pressure, of a
   secondary tank: the stock EFW pump sits at 8.0 against a generator at 6.9,
   so 15.5 > 8.0 stood true forever and an EMPTY tank went on feeding - the
   solve holds a tank as a PRESSURE, and this predicate is the only thing that
   ever turns that pressure off. Measured: level frozen at 24.77 % and 84 %
   power ten minutes after the tank read 0.00. It also read live with the pump's
   bus dead, where tankP is 0 - a hole to vacuum that drained a generator in
   30 s against 60 s+ shut, while the tank's own level never moved. Both are one
   fault: the predicate disagreed with the pressure it was gating. */
const tankLive = (s,id) =>
  tankOpen(s,id) && tankCheckOpen(s,id) &&
  (D.tanks[id].pump ? (tankLvl(s,id) > 0 && tankPumpLive(s))
                    : (tankLvl(s,id) > 0 || (s.pCore !== undefined && s.pCore > tankP(s,id))));

/* ══════════ GROUNDING THE SECONDARY ══════════
   Stage 1 makes steam/feed/exh real edges, which reach nodes (condt, condr,
   and everything downstream of them) this graph never anchored before -
   without a fixed value somewhere in that reach, netFactor()'s zero-pivot
   fallback hands back an arbitrary potential, and pipeRunP() would print it
   on the PRESSURE layer as if it meant something. The condenser is the
   secondary's own low-pressure sink, the same role containment plays for a
   break, so it gets the same treatment: one constant, fitted once and stated
   as such (the RAD_K/BREAK_K idiom), never scaled by load or derived from
   a load formula. It is the FLOOR now rather than the whole answer - condP()
   (step.js) solves the condenser's own saturation pressure and can only sit
   above this - which is the best vacuum the plant can pull. It is the AIR
   IN-LEAKAGE limit and nothing else, so it sits BELOW the design point
   (COND_DT0, step.js) rather than on it: fitted onto the design point, every
   healthy condenser pinned to it and the whole slider was worth 1% of output.
   Only a bought-oversized unit reaches it now. */
const COND_P0 = 0.004;

/* THE DRIVE A FEEDWATER PUMP DEVELOPS, in MPa, ON TOP of the standing
   difference between the two fixed nodes it spans (see the secPumps pass in
   netBuild()). Fitted ONCE, the RAD_K / BREAK_K / BUOY_LIN idiom, and stated
   as such: it is what makes an undamaged stock plant deliver what its
   generators are boiling off, so the level holds at SGL_SET. Split off the
   standing term deliberately - that way this is a property of the PUMP and
   not of where the condenser happens to sit, and moving a generator does not
   silently re-fit it.
   FEED_HURT is DMGFX.feed's own promise: a hit feed pump makes a quarter of
   the drive, and the network decides what that costs rather than a fraction
   applied to the answer.
   EVERY WAY OF LOSING FEEDWATER IS IN THE HEAD, deliberately, and none of
   them is a ceiling on the answer: the pump is hit, the switchboard is dead
   (supplyK(), step.js - the coolant pumps read the identical expression), or
   its suction is running out. A ceiling applied afterwards would discard mass
   the solve had already moved and the secondary's books would stop closing -
   measured, 4365 kg out of them in fifteen seconds. HOT_NPSH tapers the
   drive over the last stretch of the CIRCUIT pool, which is the pool a feed
   pump draws on; a reserve tank is a fixed node in its own right and limits
   itself when it runs dry (tankLive()). Above the taper it is exactly 1, so a
   healthy plant is untouched. */
const FEED_DP   = 2.0;
const FEED_HURT = 0.25;
/* Level below which a feed pump starts losing suction, %. A pump does not
   run cleanly to the last drop; this is the taper. ONE constant - it used to
   be declared here and again in step.js, for the two halves of the same
   sentence. */
const HOT_NPSH = 10;
/* 100 when there is no S to ask - the reference solve (netCoreFrac0) runs on
   a synthetic state during commission(), and the reference plant is an
   untouched one with full tanks, so its taper is 1 by definition. */
const circPoolPct = s => s.tank
  ? tankPoolPct(s, secTankIds().filter(id=>D.tanks[id].auto==="always")) : 100;
/* ONE PUMP'S OWN SPEED, 0..1 - its ACTUAL, walked toward its own demand by
   step() with its own inertia. 1 when there is no S to ask, because the
   reference solve (netCoreFrac0) runs on a synthetic state and the reference
   plant is a plant at rated speed.
   s.flowScale is NOT sim state and is never on S: it is the per-solve override
   netFlowK() uses to run the same plant with its pumps stopped, so a ceiling
   written about pump capacity can be applied to the pumped share alone. Same
   standing as s.capScale beside it, and there for the same reason. */
const flowOf = (s, pid) =>
  (s.flowBy && s.flowBy[pid]!==undefined ? s.flowBy[pid] : 1)
  * (s.flowScale===undefined ? 1 : s.flowScale);
/* THE COOLANT PUMP ORDER, and what the coolant pumps are actually doing: the
   mean over the pumps that serve the core (primaryPump(), layout.js). One
   lever drives them all - ACT.flowDem writes every one of them - so on any
   plant nobody has reached into with ACT.pumpDem these are just that lever's
   own value read back. The slider, the annunciator, the trend and the
   inspector row all ask HERE rather than each averaging their own way.
   A plant with no coolant pump at all reads 1: there is nothing being ordered
   about, and a 0 would trip the low-flow floor on a design that has no pumps
   to order. What the CORE is actually getting is s.flowNet, measured off the
   solve, and that is a different question this must never be mistaken for. */
const flowMean = (s, map) => { const ids = pumpIds().filter(primaryPump);
  if(!ids.length) return 1;
  let t=0; for(const id of ids) t += (map && map[id]!==undefined) ? map[id] : 1;
  return t/ids.length; };
const flowPri    = s => flowMean(s, s.flowBy);
const flowDemPri = s => flowMean(s, s.flowDemBy);
const feedDrive = (s, pid) =>
  (s.dmgParts && s.dmgParts.indexOf(pid)>=0 ? FEED_HURT : 1) * supplyK(s)
  * clamp(circPoolPct(s)/HOT_NPSH, 0, 1) * flowOf(s, pid);

// A pipe hit (combatHit(), step.js) is a rupture, not a throttle: modelled as
// ADDITIVE equivalent length on the SAME resist() every other run already
// uses, never a multiplier on g - a multiplier could turn one bug into a
// negative conductance and an indefinite Laplacian; additive resistance
// cannot represent one. It is a SEVERANCE, not a partial restriction - every
// other row in DMGFX (step.js) is a binary hit/fix state, not a graduated
// one, and a pipe hit follows the same idiom rather than inventing a
// magnitude nothing else in the game has. The added length is Infinity,
// which resist() carries straight through to an exact 0 (finite/Infinity is
// 0, never NaN), so a severed run lands on the identical g<=0 path
// netAssemble already omits a shut valve through - no second mechanism, no
// new physics path.
// PER CELL now, and ANY broken cell severs the whole connection: a run is a
// chain of cells and a hole anywhere along it is a hole in that run.
/* Indexed rather than destructured: this is asked once per pipe edge per
   solve, and `for(const [x,y] of cells)` walks TWO iterators a cell. */
const pipeExtraLen = (s, cells) => {
  if(!cells) return 0;
  for(let i=0;i<cells.length;i++){ const c=cells[i]; if(cellBroken(s,c[0],c[1])) return Infinity; }
  return 0;
};

/* ══════════ FIT: one row per fitting BEHAVIOUR ══════════
   Same idiom as LAYERS (render/layers.js), DMGFX and AUTOSYS (sim/step.js):
   one table, one row per mode, adding a mode is adding a row. A mode with no
   row here is a mode with no edge, which is exactly what a tee is: its four
   faces fold onto one node. `g(s,id,bore,len)` prices the
   fitting's own edge in the same units resist() already uses, so a branch
   built off this table costs a plain resist(bore,len) call either way -
   only which one, and whether it is gated by a boolean or a live position,
   differs by mode. check is a later stage; this table is why adding one is
   adding a row instead of a second netBuild().

   RELIEF IS A MODE NOW, not a vent bolted on beside the Laplacian: the rule
   this table exists to state is "a mode differs only in what drives the
   valve's position", and a relief valve's position is S.reliefOpen exactly
   the way a throttle's is S.valve - a setpoint standing in for a hand on a
   gate. Shut (or blocked downstream,
   S.reliefBlocked - the operator's own last line against a valve that will
   not reseat) it is g<=0, the same "never a row of the Laplacian" every
   other shut edge already gets - so THE VENT IS THE SOLVED EDGE FLOW,
   through invRate() in step.js, exactly like a break or an injection line.
   No second, hand-rolled vent physics beside the solve any more.

   OPEN, it is NOT resist(bore,len) - MEASURED, not assumed: a plain
   resist() edge here prices the valve on PIPE_K, the scale every OTHER
   conductance in this graph is linearised about a ~0.6 MPa PUMP head. This
   edge sees the loop's full differential against containment-scale tank
   pressure - up to ~15 MPa - the identical mismatch BREAK_K's own comment
   documents for a severed run, and it is not smaller here: measured on the
   stock valve, resist(bore,len) in series with its own header segment
   solved to g=~3.25, which at a 15 MPa differential drags ~50 units of
   current through a plant whose entire circulation reference (P.netRef) is
   ~4.6 - core pressure collapsed from 15.5 to 9.3 MPa and netFlowK() went
   to exactly 0 the instant the valve lifted. So this reuses BREAK_K, the
   idiom already fitted for exactly this mismatch, rather than inventing a
   second constant for the same problem: an orifice's choked flow depends on
   its own AREA, not on the pipe downstream of it - which is why a break
   prices off bore alone too. `len` still gates it, the same as every other
   mode: the caller adds pipeExtraLen() onto it when the branch pipe itself
   is severed, and Infinity has to reach 0 here exactly as it does through
   resist() everywhere else, or a severed relief branch would go on venting
   at its full BREAK_K rate - a length this mode is otherwise right to
   ignore is still the ONE way that pipe gets to say "there is no pipe". */
/* ══ WHAT A FITTING'S OWN PATH CONDUCTS ══
   One row per MODE, and the mode is a knob on the instance. `tee` has no row
   because a tee has no edge at all: its four faces are one node (ROLE.fold),
   which is what a junction IS.
   The gated cross-tie that used to be `tee` is `throttle` now, and that merge
   is VERIFIED, not asserted: the old FIT.tee.g was resist(bore,len) open and
   0 shut, and valveLeq() is `x => x>=1 ? 0 : ...`, so a throttle at 1 is
   bit-identical to an open tee and at 0 to a shut one. Only the CONTROL ever
   differed - a two-position switch against a slider - and that is a panel
   question, not a solve one. */
/* A FITTING'S OWN EDGE HAS ONE NAME. It is the internal path through the box
   (netBuild()'s ROLE.internal loop), and eight readers across the tick, the
   renderers and the panels used to spell out the "xtie:"+id convention the
   branch RUN a fitting used to own once carried. Written here, beside the table whose modes it
   prices, so a reader cannot drift from the builder. */
const fitEdgeKey = fid => "comp:" + fid + ":lr";
const FIT = {
  throttle:{
    g:(s,id,bore,len)=>throttled(s,bore,len,[id]),
  },
  relief:{
    g:(s,id,bore,len)=>(s.reliefOpen && s.reliefOpen[id] && !(s.reliefBlocked && s.reliefBlocked[id]) && isFinite(len))
      ? BREAK_K*bore*bore : 0,
  },
};

/* ══ THE VENT IS THE SOLVED EDGE FLOW ══
   PORV_INV/PORV_DP/ventK()/ventKNow() are gone: there is no second, hand-
   rolled vent physics beside the network any more, and no separate
   back-pressure correction to keep in step with it - a filling relief tank
   throttles the vent by its OWN fixed-node pressure alone, because that
   pressure is one of the two potentials the Laplacian is solved against.
   reliefRate() is the one reader of a relief fitting's own vent, in the
   same %-of-loop-inventory-per-second units invRate() already gives a
   break or an injection line - resolved fresh off netCoreFracOf(), never on
   S, the same argument netDrops()/netPressures() make below. step.js reads
   it to charge s.inv/s.tank/s.release; the panel and the plume (plant.js)
   read the identical call, so neither can print a rate the sim is not
   performing. */
/* ONE SOLVE PER DRAWN FRAME, not one per valve. The solve fills reliefBy for
   EVERY fitting at once, and the mimic asks two or three of them plus the
   panel - each of which was assembling and factorising the whole network again
   for one row of the answer.
   ONLY INSIDE A FRAME, and that is the whole of the argument: S is frozen for
   the length of a paint and is not frozen anywhere else. A tick moves it every
   line, and an auditor pushes a tank up and asks again on the same object - so
   a cache that spanned either would answer for a plant that has moved on. It
   is keyed on the state it was solved against as well, because a replay frame
   draws a snapshot beside the live plant. */
let reliefOuts=null, reliefOutsFor=null, netPassLive=false;
const netPassStart=()=>{ netPassLive=true;  reliefOuts=null; reliefOutsFor=null; };
const netPassDrop =()=>{ netPassLive=false; reliefOuts=null; reliefOutsFor=null; };
function reliefRate(s, fid){
  if(!(P && P.net)) return 0;
  let o = (netPassLive && reliefOutsFor===s) ? reliefOuts : null;
  if(!o){ o={}; netCoreFracOf(P.net, s, null, null, null, null, o);
    if(netPassLive){ reliefOuts=o; reliefOutsFor=s; } }
  const q = o.reliefBy && o.reliefBy[fid];
  return q ? Math.max(0, invRate(q)) : 0;
}
/* DISPLAY ONLY, never a gate: what THIS fitting's own branch would pass if
   it were wide open against a full design differential (P.P0 to P.Pcont) -
   the scale reliefRate() is judged against for the plume and the panel's
   band, nothing more. Off the SAME BREAK_K*bore*bore FIT.relief.g itself
   prices its edge with (never resist() - see FIT's own comment for why a
   plain pipe-scaled conductance collapsed the whole loop the instant a
   valve lifted), so this stays the true ceiling reliefRate() can approach,
   never an unrelated number the display happens to divide by. The header's
   own downstream segment is left out of it on purpose: measured, its
   conductance (~3.8) is two orders of magnitude past the valve's own
   BREAK_K-scaled choke (~0.008), so it is not the series term that decides
   this ceiling and carrying it here would only add a length-of-header
   nuance too small to see against a rounding error. 0 for a fitting whose
   branch never routed - the same "not there" fallback every other reader of
   a missing run already uses. */
function reliefFullRate(s, fid){
  const f = (P && P.fittings && P.fittings[fid]) || D.fittings[fid];
  if(!f) return 0;
  const bore = f.bore;
  return Math.max(0, invRate(BREAK_K*bore*bore*(P.P0-P.Pcont)));
}

// pipeNetwork() keys a routed run "kind:aIdSide-bIdSide" (see layout.js's
// link()). Node identity in this graph IS that "partId+side" string
// verbatim, so splitting the key on its one '-' hands back the two node ids
// directly - no second naming scheme to invent or keep in sync. null for a
// run with no second half (surge, which drops onto another run's pipe
// rather than terminating at a port of its own).
function runEnds(key, kind){
  const rest = key.slice(kind.length + 1);
  const i = rest.indexOf("-");
  return i < 0 ? null : [rest.slice(0, i), rest.slice(i + 1)];
}

// core"r" and core"b" are the SAME node: today's lumped model has one core
// plenum, r_core=0, and that identity is what makes the no-junction sweep
// in the auditor exact - every loop becomes an independent core-to-core
// path with nothing else to disagree about. The argument lives on ROLE.core
// (layout.js, ROLE.fold) beside the row that makes it true; this is just the
// lookup, cached on the arrangement (laySig()) since it is asked once per
// edge and the set of folding parts never changes mid-frame.
function foldMap(){
  /* On the graph (graphSlot(), layout.js) rather than on laySig()+fittingSig():
     both of those are terms of the graph's own key, so the graph's identity
     answers the same question - including the one an arrangement-only key got
     wrong, a tee's single node handed back for a valve that now has two -
     without rebuilding two strings once per edge to ask it. */
  const slot=graphSlot("foldMap"), was=slot.get(1); if(was) return was;
  const m={};
  for(const p of LAY.parts){
    const f=foldFacesOf(p); if(!f) continue;
    // a LIST folds every face onto one node; a MAP folds each named face
    // onto another face of the same part, which is what gives a valve two
    // sides with its gate in between
    if(Array.isArray(f)) for(const face of f) m[p.id+face]=p.id;
    else for(const face in f) m[p.id+face]=p.id+f[face];
  }
  slot.set(1,m);
  return m;
}
const coreFold = raw => foldMap()[raw] || raw;
/* WHICH CIRCUIT A NODE IS ON. The graph is keyed on partId+face and a FOLDED
   node is the bare part id, so the face is stripped only when the whole name
   is not itself a part. Cached on the graph, because the advection sweep asks
   it once per node per tick. */
function circOfNode(nid){
  const G=nodeGraph(), slot=graphSlot("circOfNode");
  const hit=slot.get(nid); if(hit!==undefined) return hit;
  let c=G.circuit[nid];
  if(c===undefined){
    const p=partOf(nid) || partOf(nid.slice(0,-1));
    if(p) for(const n of (G.nodesOf[p.id]||[])){ if(n===nid || n.slice(0,-1)===p.id){ c=G.circuit[n]; break; } }
  }
  if(c===undefined) c=-1;
  slot.set(nid,c); return c;
}
/* WHICH RUNS CAN CARRY NOTHING. Both ends fold onto the SAME node, so there is
   no potential difference across the pipe and never can be. Legal to draw and
   the bench only says so; a run between two DIFFERENT faces of one part is a
   recirculation line and is not this. */
function selfRuns(){
  const out=[];
  for(const c of pipeMap().conns){
    const a=partOf(c.a), b=partOf(c.b); if(!a||!b) continue;
    if(coreFold(a.id+c.sa) === coreFold(b.id+c.sb)) out.push(c.key);
  }
  return out;
}

/* ══════════ ELEVATION: A NODE IS A HEIGHT AS WELL AS A NAME ══════════
   Metres above the bottom of the grid, taken from the GRID (p.y and MPC),
   NEVER from a pixel: elevation is a fact about the DESIGN, so it must not be
   derived from anything the view happens to be doing. A node is `partId+side`, so
   the face it sits on is the height it sits at - a nozzle on the top face
   really is higher than one on the bottom, and that is what gives a
   component's own internal path (comp:, below) a height to span. */
const zRow = row => (GH - row) * MPC;
const zFace = (p, side) => side === "t" ? zRow(p.y)
                         : side === "b" ? zRow(p.y + p.h)
                         : zRow(p.y + p.h/2);

/* Node temperature. Every node the primary touches is on the hot side of the
   loop, the cold side, or (the folded core, a cross-tie between the two) in
   between; the tag is built from the RUNS that touch it, so nothing has to
   name a component. s.coreDT is the core's own temperature rise - the same
   quantity the 0-D split has always been, generalised for flow (see step.js),
   so at rated flow this is exactly the Tavg +/- 15*heat the thermal model
   already uses, and at commissioning it is exactly 0 and buoyancy with it. */
const NT_HOT = 1, NT_COLD = 2;
/* Which side of the loop a run's own two ends sit on, BY DEFAULT - a run this
   table has no row for (steam, relief) tags neither end, which is
   honest: this stage has not modelled a real temperature for the secondary,
   and Stage 6 replaces this whole table with one SOLVED from the tick rather
   than guessed from a kind. A DEFAULT-PICKER, never a permission: every one
   of those runs still carries conductance, still taps, still hits and still
   spills whatever this table says about it.
   NO ROW FOR feed, steam OR relief, and adding one WOULD BREAK THE
   ISOTHERMAL INVARIANT. This array, and only this array, feeds buoyH(): a
   tagged node is a node with a temperature anomaly, and audit-physics.js
   requires every static head to be identically 0 when s.coreDT is 0. The
   secondary edges are untagged, so buoyH() on them is exactly 0 for any
   coreDT, and the static lift they DO owe arrives from the datum column
   inside the fixed-node values instead - where, for an open path between two
   fixed nodes at different heights, it does not telescope away. Elevation
   still pays and the invariant is untouched. Tag them and both stop being
   true at once.
   The original reason for leaving "feed" out is also gone and worth recording
   as gone: one feed run used to share the generator's "b" face with the
   primary cold leg, so tagging by kind would have retagged a PRIMARY node
   through a SECONDARY run. Feedwater lands on the generator's own "r" face
   now and there is no collision left - the reason above is the one that
   stands. See condDisplayT()/condTag below for how the condenser side is
   grounded, by NODE rather than by kind. */
const KIND_TEMP = {hot: NT_HOT, surge: NT_HOT, cold: NT_COLD, hpi: NT_COLD};


/* ══ THE FIELD, READ BACK ══
   Every node carries an ENTHALPY now (s.hBy, advected in step()), so a
   temperature is what that enthalpy says at that node's own pressure on that
   circuit's own curve. It used to be a two-state tag: every "hot" node in the
   plant read one number and every "cold" node another, so a tee joining steam
   and water was not mis-modelled, it was not representable.
   A node the field has not reached yet sits at Tavg, which is what "somewhere
   in the loop, unspecified" means and what the seed writes anyway. */
const netSatOf = nid => satOfCirc(circOfNode(nid));
function netHAt(s, nid){
  const h = s.hBy && s.hBy[nid];
  return h === undefined ? hOfT(netSatOf(nid), s.Tavg===undefined?P.Tref:s.Tavg) : h;
}
/* FLOORED AT THE PLANT'S OWN VACUUM. The solve carries PIEZOMETRIC head, so a
   pump's suction node legitimately sits below every pressure a gauge would
   print, and asking the saturation curve about 1e-4 MPa put a condensate line
   at 215 K - a phase reading off a number that is not a pressure. COND_P0 is
   the best vacuum this plant can ever pull and is the same floor secP()
   already applies. */
function netPAt(s, nid){
  const f = s.pBy && s.pBy[nid];
  return Math.max(COND_P0, f === undefined ? (s.P===undefined?P.P0:s.P) : f);
}
function netTempAt(s, nid){
  const c = netSatOf(nid);
  return tOfH(c, netPAt(s,nid), netHAt(s,nid));
}
/* Steam quality at a node, 0..1 - computed, never declared. */
function netQualAt(s, nid){
  const c = netSatOf(nid);
  return xOfH(c, netPAt(s,nid), netHAt(s,nid));
}

/* Is this node a steam space? net2.vapour's structural answer, asked by node
   id so a view never has to test a run's kind name. A node this graph does not
   carry is not one - the same default the no-edge case above takes. */
function netVapourAt(nid){
  const net = P && P.net;
  if(!net || !net.vapour) return false;
  const i = net.index[nid];
  return i !== undefined && !!net.vapour[i];
}

/* Static head across an edge, in MPa - the weight of the fluid column between
   its two ends, and the whole of buoyancy. netFlows() computes
   Q = g*(p_u - p_v + h), so a positive h drives u->v; fluid falls, so the
   static term for u->v is +rho*g*(z_u - z_v), positive when u is the higher
   node. Sanity case: one edge, both ends at the same pressure, u above v ->
   flow goes downward.

   rho is the MEAN of the edge's two end nodes, never one end's value. Not
   because the mean is exact - it is the trapezoidal rule - but because one
   end's value is orientation-dependent: u and v are whichever way round
   netBuild() happened to push the edge, and a physical answer must not turn
   on that. The mean is symmetric under swapping them; either endpoint's is
   not.

   It is the ANOMALY from rhoDatum(), never the absolute column. Around a
   closed loop a single density sums to -g*rho*sum(dz), which is exactly zero
   in exact arithmetic and about 1e-13 in floating point - so an isothermal
   plant would circulate a little, out of rounding, at any elevation, and a
   check written to catch a manufactured thermosiphon would have to be
   loosened to tolerate one. Against the datum every static head is
   identically 0.0 when the loop is isothermal, so that solve is bit-for-bit
   the pump-only one and the check can stay strict.

   What the solve then carries is PIEZOMETRIC head, phi = p + rho_d*g*z, not
   pressure - identical flows, because the datum column is a pure function of
   elevation and so cannot drive anything. netPressures() takes the column
   back off, which is what makes a vessel hung below the pressurizer read
   HIGHER than it. */
/* ONE TICK OLD, deliberately - the field is advected along the flows this
   solve produces, so it cannot also be an input to it. The same s.coreDT
   idiom every other feed-forward in this sim uses. A plant whose nodes have
   all equilibrated reads dT identically 0 at every elevation, which is the
   isothermal property the auditor pins. */
const buoyH = (net, ed, s) => {
  const dz = net.z[ed.u] - net.z[ed.v];
  if(dz === 0) return 0;
  const T0 = s.Tavg === undefined ? P.Tref : s.Tavg;
  const dT = (netTempAt(s, net.name[ed.u]) + netTempAt(s, net.name[ed.v]))/2 - T0;
  if(dT === 0) return 0;
  return -BUOY_PER_K*BUOY_LIN*dT * G_MPA * dz;
};

/* Builds the compiled graph once per commission. Topology only - every edge
   but a fitting's own is still a plain number, so most of the matrix is
   fixed the moment this returns; a fitting's g is a function of live
   S.reliefOpen or S.valve (see the ROLE.internal loop below), which is
   exactly why netFactored() below has to key its cache on more than just
   this object. */
function netBuild(){
  const net = pipeNetwork();
  const byKey = {};
  for(const r of net) byKey[r.key] = r;
  // hoisted from the elevation pass (below) so the tank-edge test can use it
  // too: which PART a node belongs to, off the partId+side naming convention
  // every node in this graph already follows - never a stored face string.
  const byId = {};
  for(const q of LAY.parts) byId[q.id] = q;
  const partOfNode = nid => byId[nid.slice(0, -1)];
  /* Which TANK (if any) this node is priced by - derived from the PART the
     node's face belongs to and that part's own declared ROLE.fixed, the way
     it is derived from the drawing rather than from a face name authored
     once and left to go stale the moment the part moves.
     EVERY TANK ON THE GRID, both sides. This used to exclude a secondary
     tank, because the secondary was a boundary and a tank there could have no
     node to be fixed at. That is over: the generator's shell is in the graph,
     so an emergency reserve piped to it has a real edge, its own gas or pump
     pressure has to beat that generator's own secP() to deliver anything, and
     "a passive tank works in a blackout and a pumped one does not" is finally
     true on this side too. A tank with no CELL still has no node - the
     hotwell is condensate inside the condenser, not a hydraulic object - and
     that is a fact about the drawing, not about a side. */
  const tankIdOf = nid => {
    const p = partOfNode(nid), R = p && ROLE[p.role], t = p && D.tanks[p.id];
    return (R && R.fixed && R.fixed.type === "tank" && t) ? p.id : null;
  };

  const nodes = [], index = {};
  const nodeIdx = nid => { if(!(nid in index)){ index[nid] = nodes.length; nodes.push(nid); } return index[nid]; };
  /* The core is a node like any other now, NOT the ground. Its pressure is an
     answer rather than a definition, which is the whole point of an absolute
     solve - hang the pressurizer higher and the vessel genuinely sits at a
     higher pressure. netCoreFracOf() below identifies core flow by this index
     rather than by "touches ground", which is what it used to do. */
  const coreNode = nodeIdx("core");

  const edges = [];
  /* Hoisted up from the break pass (below) - a relief fitting whose header
     never resolved (no tank on the grid at all) needs a containment node to
     land its own branch on, built by the SAME resolver a break already uses,
     so "vent straight to the room" and "a break's own opening" are one
     mechanism rather than two. */
  const contNode = tag => nodeIdx("cont:" + tag);
  const breakIds = [];
  // the steam-side holes, for the shell balance step() runs - cells to ask
  // cellBroken() of, and the bore and shells that price what one passes
  const steamBreaks = [];
  /* A containment node whose height is NOT its edge's other end - a break at a
     pipe cell discharges at that cell, not at the machine the run happens to
     terminate on. Collected here and applied in the elevation pass below,
     which is where every other node's z is settled. */
  const contZ = {};

  /* WHICH FITTINGS ARE ON THE PLANT, AND WHAT EACH ONE IS. A fitting is a
     PART, so this is a read of the drawing - it replaces ~150 lines that had
     to split every run a fitting sat a fraction along, invent a node in the
     middle of it and then rebuild the run as a chain of series edges. The
     general ROLE.internal loop below already builds a fitting's own path,
     because a fitting is a box like any other.
     LAY.parts' own order, which is what makes primaryRelief() (step.js)
     deterministic without anybody sorting anything. */
  const fitIds = [], fitMode = {};
  for(const p of LAY.parts) if(p.role === "fitting"){
    fitIds.push(p.id); fitMode[p.id] = fitModeOf(p.id); }

  // every run is an edge now, full stop: the four lists that used to answer
  // "carries a conductance / may be tapped / may be hit / may spill" with
  // four different kind sets are gone, and what is left is a SPEC (bore,
  // runBore() above) rather than a permission. A run with no branch taps on
  // it keeps the single edge exactly as before (this is what the no-fitting
  // sweep in the auditor pins bit-for-bit) unless an in-line throttle sits on
  // it, in which case that one edge's g becomes a function of the throttle's
  // live position instead of a plain number - see pushSeg. A branch-tapped
  // run instead becomes a chain of series edges, one per tap sorted along the
  // run plus one to the far end - electrically the same run, just able to
  // disagree with itself about pressure at the point a branch actually
  // leaves it; any in-line throttle whose own t falls inside one of those
  // segments folds into THAT segment's edge, in series with the pipe either
  // side of it. resist()'s existing NET_COMP_LEN floor is what stops a
  // degenerate sliver (two taps landing on the same t, or one sitting at
  // exactly 0 or 1) from pricing out as a zero-resistance short - the same
  // floor a same-point run already relies on.
  for(const r of net){
    const ends = runEnds(r.key, r.k);
    if(!ends) continue;
    const u = nodeIdx(coreFold(ends[0])), v = nodeIdx(coreFold(ends[1]));
    /* A SELF-CONNECTION IS LEGAL AND MUST BE INERT. A run from a face back to
       itself is placeable and unguarded, and the edge only cancelled to zero
       because the arithmetic happened to - never rely on a solved quantity
       landing on exactly zero. The skip that used to live only on the internal
       paths below is asked of EVERY edge here. A run between two DIFFERENT
       faces of one part is not this case: it is a recirculation line, a real
       machine, and it stays and solves. */
    if(u === v) continue;
    const bore = runBore(r), L = r.L;
    const tid = tankIdOf(ends[0]) || tankIdOf(ends[1]);
    if(tid){
      /* Valve, diode and "is there anything left to give", asked of EVERY
         tank by the same predicate - see tankLive(). Nothing here knows
         which tank this is. */
      edges.push({u, v,
        g: s => (tankLive(s,tid) && runPortsOpen(s,r)) ? injResist(bore, L + pipeExtraLen(s, r.cells)) : 0,
        h: 0, kind: r.k, key: r.key}); // LABEL: carried onto the edge for rendering/lookup, never re-compared here
      continue;
    }
    /* r.k is a LABEL, carried onto the edge so a renderer or
       a renderer can read it back; nothing here branches on it.
       Always routed through throttled() with an empty id list, which is
       exactly resist(bore, L) - so an undamaged run is bit-identical to a
       plain number while still being LIVE against a hit that has not
       happened yet. */
    edges.push({u, v, g: s => runPortsOpen(s,r) ? throttled(s, bore, L + pipeExtraLen(s, r.cells), NO_GATES) : 0,
                h: 0, kind: r.k, key: r.key});
  }

  // internal component paths: continuity through a component a run merely
  // passes THROUGH. The pump is where head enters the loop - h is a
  // FUNCTION of s so a damaged pump's contribution tracks s.dmgParts live,
  // never baked in at build time. s.capScale, if the caller set one, is a
  // per-loop head multiplier - netCoreFrac0 (below) is the only caller that
  // does, to clamp a spare-loaded loop's OWN reference at its bore rather
  // than at whatever capacity happens to be installed. Live ticks never set
  // it (capScale defaults to 1): a solve can legitimately draw MORE than
  // capacity bookkeeping predicts once a junction is open (see netFlowK's
  // own comment), so the live solve always runs on raw, un-throttled head
  // and is judged against that clamped reference afterward instead.
  // ROLE[p.role].internal, not p.id.startsWith("sg")/"pump" - an edge THROUGH
  // a component is a fact about its role (tube path, pump casing), and which
  // faces it spans is stated on that row (layout.js) rather than guessed
  // from a name here. A path's own `head` layers a pump's developed head onto
  // the identical edge rather than building a second one, so "pump" is still
  // just "internal, and also a head source" - not a different shape.
  const secPumps = [];   // resolved once net2's fixed nodes exist - see below
  for(const p of LAY.parts){
    const R = ROLE[p.role];
    if(!R || !R.internal) continue;
    /* internal is a LIST - a component may carry more than one path through
       itself that does NOT join up inside it, which is exactly what a steam
       generator is: primary l<->b through the tubes, secondary r<->t around
       them, and no edge between the two (a leak between them is the sgtr edge
       and it is built elsewhere, deliberately). One row still writes one
       path, so the common case is unchanged. */
    for(const IN of (Array.isArray(R.internal) ? R.internal : [R.internal])){
    /* A TEE HAS NO EDGE. Its faces are one node (ROLE.fitting.fold), so this
       path's two ends resolve to the SAME index - a self-loop, which is not
       a resistance and must not be assembled as one. A junction that cost
       something would not be a junction. */
    /* coreFold() BEFORE nodeIdx(), or a tee's two ends are two nodes and the
       self-loop test below never fires: every run reaching it is folded onto
       one node (the run loop above), so the box would sit beside the plant
       carrying a shut edge nothing touched. */
    const ua = nodeIdx(coreFold(p.id+IN.a)), ub = nodeIdx(coreFold(p.id+IN.b));
    if(ua === ub) continue;
    const edge = {u: ua, v: ub,
                  g: resist(1,NET_COMP_LEN), h: 0, kind: IN.kind, key: "comp:"+p.id+":"+IN.a+IN.b};
    /* WHICH OF THIS PATH'S OWN FACES SITS IN A STEAM SPACE - see net2.vapour
       below. Per FACE and not per edge, because a generator's shell path is
       water at the feed nozzle and steam at the steam nozzle, and one answer
       for the whole edge could only ever be wrong at one end. */
    if(IN.vap){ edge.vapU = IN.vap.indexOf("a")>=0; edge.vapV = IN.vap.indexOf("b")>=0; }
    /* ── THE GATED PATH: A FITTING IS ITS OWN VALVE ──
       Every other component's internal path is a flat length of steel; a
       fitting's is whatever FIT[mode] says it is, priced off its own bore.
       This is the whole of what used to need ~150 lines of edge-splitting:
       a fitting was a FRACTION along a run, so the run had to be cut in two
       and a node invented in the middle of it. A fitting is a node now,
       because it is a box, so the general loop above already built it. */
    if(IN.gate){
      const row = FIT[fitModeOf(p.id)];
      if(!row) continue;                       // a mode with no edge (tee) - already skipped above
      const bore = D.fittings[p.id].bore;
      edge.g = s => row.g(s, p.id, bore, NET_COMP_LEN);
      edge.fit = p.id;
      edge.key = fitEdgeKey(p.id);
    }
    /* ── THE FEED REGULATING VALVE ──
       One pump and one header cannot hold two generators at level on their
       own: what each takes is set by its own secP() against a shared
       discharge, and the stock loops are different lengths on purpose, so a
       0.42 MPa spread meets a 0.043 MPa drive and one generator takes ten
       times its share. A real plant answers that with a regulating valve per
       generator and so does this.
       It is a HEAD, not a conductance, and that is load-bearing twice over: a
       head only ever reaches b (netAssemble), so a valve that moves every
       tick cannot bust netFactored()'s signature and force an O(n^3)
       elimination per tick; and a back-pressure cannot make the Laplacian
       indefinite the way a live g could. Wide open is exactly 0, so a
       generator whose valve never moves is bit-identical to one with no valve
       at all - the same standing the throttle fitting's own valveLeq() has.
       Signed against the path's INLET face: positive s.fregBy opposes flow
       INTO the shell. Which machine it belongs to is ROLE.sgtr - the same
       "can this part's tubes rupture" the sgtr edge is built from - and which
       PATH is the shell is asked of the drawing (secondaryNode), never of a
       face name. */
    if(R.sgtr && secondaryNode(p.id+IN.a)){
      edge.shellOf = p.id;
      edge.g = resist(1, FEED_LEN);
      edge.h = s => -((s.fregBy && s.fregBy[p.id]) || 0);
    }
    if(IN.head){
      /* A part with no run reaching ANY of its faces contributes NOTHING -
         no head, no capacity, no loop membership: the spare-pump bug this
         stage fixes, where a floating pumpX0 used to double loopPumpCap()
         anyway because p.loop (a proximity guess) said it belonged
         somewhere. net.usage (layout.js's pipeNetwork()) is the same port
         tally CONNECT's own "is this port free" check reads, so this is one
         source, not two. Left unrouted, edge.h simply never gets assigned -
         the literal 0 above stands, and the comp: edge is an isolated
         2-node island netFactor() already guards (no fixed node in it, so
         no current, whatever h a caller might have written). */
      const routed = net.usage && (net.usage[p.id+"t"]||net.usage[p.id+"b"]||net.usage[p.id+"l"]||net.usage[p.id+"r"]);
      if(routed){
        /* Which GENERATOR's own loop this pump pools capacity with, off the
           graph (loopOf(), layout.js) - never a stored p.loop. A pump this
           walk cannot trace to any generator (piped somewhere else entirely
           - Stage 3a's reactor-condenser-RCP-reactor loop, say) still
           develops its OWN head below; it just pools with nobody. */
        const li = loopOf(p.id);
        /* flowOf() - THIS pump's ACTUAL speed, walked toward its own demand with
           its own inertia in step() - is part of the head, not a multiplier applied
           to the answer afterwards. It has to be: once buoyancy is also a head,
           a plant whose pumps have coasted to a stop still circulates, and a
           factor outside the solve would multiply that thermosiphon by zero. */
        /* CAVITATION IS A HEAD LOSS, not a multiplier on the answer. A pump
           whose own suction has gone hot develops less head, the network sorts
           out what that does to the rest of the plant, and a runaway appears
           with no new machinery: that pump's suction goes hot, THAT pump loses
           head, loses flow, its suction pressure falls further, it cavitates
           harder. The same shape as the void feedback the core already has.
           s.cavP[i] is measured at THIS pump's own suction node (step.js), so
           piping one pump badly - a long suction leg, a throttle on it, hung
           high - finally costs something, which it could not while there was
           one cavitation number for the whole plant. A pump with no loop index
           has no group cavitation figure to read either, so it skips that term
           rather than reading a foreign loop's. */
        /* IS THIS A FEEDWATER PUMP? Asked of the drawing and of nothing else:
           a pump one of whose ends reaches a generator's SHELL - the part of
           it the core cannot reach - is pushing water into that generator,
           whatever it is called. Nobody declares it and nothing stores it, so
           a player who pipes a spare pump from the condenser to a generator
           has built a feed pump and a player who unpipes it has removed one.
           Asked with the pump's OWN casing edge cut, or every pump would
           reach the shell through itself and both ends would look like the
           discharge. */
        const gensA = li!=null ? [] : secGensFromNode(p.id+IN.a, {[p.id+IN.b]:1});
        const gensB = li!=null ? [] : secGensFromNode(p.id+IN.b, {[p.id+IN.a]:1});
        if(li==null && (gensA.length || gensB.length))
          secPumps.push({p, edge, dis: p.id+(gensA.length?IN.a:IN.b),
                                   suc: p.id+(gensA.length?IN.b:IN.a),
                                   gens: gensA.length?gensA:gensB});
        else edge.h = li!=null
          ? (s => PUMP_H0 * loopPumpCap(li, s.dmgParts) * (s.capScale ? (s.capScale[li]??1) : 1)
                          * flowOf(s, p.id)
                          /* 0.8 is GAME BALANCE: a fully vapour-bound pump is
                             still turning, so it keeps a fifth of its head
                             rather than none. Nothing measured says a fifth. */
                          * (1 - 0.8*((s.cavP && s.cavP[li]) || 0)))
          : (s => PUMP_H0 * pumpCapOf(p.id) * flowOf(s, p.id));
      }
    }
    edges.push(edge);
    }
  }

  /* ══ A RELIEF VALVE ALWAYS HAS SOMEWHERE TO VENT ══
     As a tap, the "no header resolved" case was a branch edge landed on a
     containment node. As a box it is simpler and more honest: if one side of
     the valve carries no run at all, that side is open to the room, and it
     gets the same containment anchor a break's own opening gets (P.Pcont, at
     its own elevation, registered into the same breakIds netFixed() walks).
     A face GROUP, not a face: t folds onto l and b onto r, so a valve plumbed
     vertically is the same valve. The stub itself is an ordinary component
     length - the choke is the valve's own gate, in series with it. */
  const reliefContNode = fid => { const i = contNode("relief:"+fid); breakIds.push(i); return i; };
  const faceUse = (fid, faces) => faces.reduce((n,f) => n + ((net.usage && net.usage[fid+f]) || 0), 0);
  /* WHERE the open side points, asked in the same loop that decides WHICH side
     is open so the two cannot disagree. A valve whose open face is against the
     skin discharges outside instead of into the compartment - the sky every
     real secondary safety has and this grid otherwise lacks. It is a second
     question, not a third value of fitTarget: a tank CATCHES a discharge, the
     skin lets it GO, and only the tank keeps it out of s.release. */
  const openSide = {}, fitVentOut = {};
  const OPENF = {l:["l","t"], r:["r","b"]};
  for(const fid of fitIds){
    if(fitMode[fid] !== "relief") continue;
    const inU = faceUse(fid, ["l","t"]), outU = faceUse(fid, ["r","b"]);
    if(!!inU === !!outU) continue;            // piped both sides, or plumbed to nothing at all
    const side = outU ? "l" : "r";
    const open = nodeIdx(fid + side);
    openSide[fid] = open;
    const q = byId[fid];
    fitVentOut[fid] = !!q && OPENF[side].some(f => hullCell(q.x+DIRV[f][0], q.y+DIRV[f][1]));
    edges.push({u: open, v: reliefContNode(fid), g: resist(D.fittings[fid].bore, NET_COMP_LEN),
                h: 0, kind: "vent", key: "vent:"+fid});   // LABEL: synthetic kind, for the z-pass below
  }

  /* ══ THE BREAK HAPPENS AT THE HOLE ══
     ONE CONTAINMENT NODE PER PIPE CELL, at that cell's own elevation, and one
     break edge from each of the connection's two end nodes to it. The break
     used to open at the run's ENDS, which put the plume at the machines and
     the discharge at their height - a fudge this file's own comment admitted
     to, and one a cell-keyed pipe simply does not need.
     Every edge is g exactly 0 until that cell is hit, so netAssemble skips it
     and an intact plant's matrix is bit-identical to one built before break
     edges existed; and the node SET is constant, which is what netFixSig() and
     the factorisation cache require. */
  // two steam walks per shell, hoisted: neither set depends on the run
  const shellIds = shellFaces().map(sh => sh.id), steamSeen = {}, headSeen = {};
  for(const id of shellIds){ steamSeen[id] = steamNodesOf(id); headSeen[id] = steamNodesOf(id, true); }
  for(const r of net){
    const ends = runEnds(r.key, r.k);
    if(!ends) continue;
    const bore = runBore(r), g = BREAK_K*bore*bore;
    /* WHICH SIDE OF THE TUBES THE HOLE IS ON, asked of the drawing and never
       of a run's name: both ends secondary is secondary water, so a hit on a
       feed line costs condensate, not primary inventory. A cross-tie has one
       primary end and stays primary - it can drain the loop. */
    const sec = secondaryNode(ends[0]) && secondaryNode(ends[1]);
    /* ...AND WHETHER IT STANDS IN A SHELL'S STEAM (steamNodesOf(), layout.js).
       What leaves through such a hole is STEAM, so it is charged at the shell
       it belongs to (step.js, secHole) and not here - this network prices
       liquid, and steam is a density this solve does not carry. Empty for the
       condensate side, which is why a feed line still answers `sec` alone. */
    const shells = sec ? shellIds.filter(id => steamSeen[id][ends[0]] || steamSeen[id][ends[1]]) : [];
    const steam = shells.length > 0;
    /* PAST THE TURBINE IT IS EXHAUST, and exhaust is not shell steam: it sits
       in the condenser's vacuum, so a hole there lets air IN rather than
       steam out. Two different accidents, priced apart in step(). */
    const exh = steam && !shells.some(id => headSeen[id][ends[0]] || headSeen[id][ends[1]]);
    if(steam) steamBreaks.push({cells: r.cells, bore, shells, exh});
    const ua = nodeIdx(coreFold(ends[0])), ub = nodeIdx(coreFold(ends[1]));
    for(const [x,y] of r.cells){
      const v = contNode("pipe:"+x+","+y);
      breakIds.push(v);
      contZ[v] = zRow(y);                  // the hole's own elevation, not a machine's
      for(const u of [ua,ub])
        edges.push({u, v, g: s => cellBroken(s,x,y) ? g : 0, h: 0, kind: "break", sec, steam, key: "break:"+r.key});
    }
  }
  /* one tube-rupture edge per steam generator, from its own primary outlet to
     a node fixed at its own secondary's pressure. Shut - g exactly 0, so the
     edge is not in the matrix at all - until that generator is hit. */
  const sgtrIds = [];
  /* Every generator's OWN steam port, fixed at the same secP(s) the synthetic
     sgtr node already uses - it is the same physical space, just reached by
     a real run (steam:sgNt-...) instead of only the tube-rupture leak.
     Ground it here or a steam line hangs off a node nothing anchors: its
     conductance is real now (Stage 1), so netField() answers with whatever
     netFactor()'s zero-pivot clamp invents, and pipeRunSc() (render/pipes.js)
     reads that straight into a subcooling figure it prints - measured, this
     produced -235 K on the PRESSURE/subcooling layers before this line
     existed, which is precisely "a lie dressed as data". Registered even if
     the steam run never routed (id+"t" then simply never enters `index`
     below), same as every other "or nothing" node in this build. */
  const secTIds = [], secTParts = [];   // parallel: a steam run may not have routed, so this is not sgtrParts
  // ROLE[q.role].sgtr, not /^sg\d+$/.test(q.id) - "can this part's tubes
  // rupture" is exactly the declared field name, not a guess off its id.
  const sgtrParts = [];
  for(const q of LAY.parts) if(ROLE[q.role] && ROLE[q.role].sgtr){
    const id = q.id, v = nodeIdx("sec:" + id);
    sgtrIds.push(v); sgtrParts.push(id);
    edges.push({u: nodeIdx(id+"b"), v, g: s => sgtrLive(s, id) ? sgtrG() : 0,
                h: 0, kind: "sgtr", key: "sgtr:"+id});
    if((id+"t") in index){ secTIds.push(index[id+"t"]); secTParts.push(id); }
  }

  /* the vessel's own opening. s.breach stays exactly the latched flag the
     board, the scenarios and tripCause() all read - what goes is the fixed
     2.4 %/s drain that ran at one rate forever whatever the operator did. */
  { const v = contNode("core");
    breakIds.push(v);
    edges.push({u: coreNode, v, g: s => s.breach ? BREAK_K*BREACH_BORE*BREACH_BORE : 0,
                h: 0, kind: "break", key: "break:core"}); }

  /* ══ WHICH TANK CATCHES THIS VALVE'S DISCHARGE ══
     step.js asks exactly one question of this: is there a tank to catch the
     vent at all, or is it going straight into the room. As a tap it was read
     off the far host run's own two ends; as a box it is a WALK from the
     valve's discharge side over the edges already built, stopping AT a tank
     and never crossing one - the same "reached, never crossed" rule
     runReach() and pzrLive() are written from.
     WHICH side is the discharge is asked of the graph, not stored: the side
     that does not reach the core is the one pointing away from the loop. A
     valve piped into the loop at BOTH ends reaches the core either way and
     catches nothing - it is a cross-tie somebody set to relief, and saying so
     is more honest than picking the first tank a loop walk stumbles into. */
  const fitTarget = {};
  {
    const adjn = Array.from({length: nodes.length}, () => []);
    for(const ed of edges){
      if(ed.fit) continue;                                    // never cross another valve's own gate
      if(ed.kind === "break" || ed.kind === "sgtr" || ed.kind === "vent") continue; // LABEL: synthetic edge kinds netBuild() itself invents, never a run's own
      adjn[ed.u].push(ed.v); adjn[ed.v].push(ed.u);
    }
    const walk = from => {
      const seen = new Set([from]), st = [from];
      let tank = null, core = false;
      while(st.length){
        const u = st.pop();
        if(u === coreNode) core = true;
        const tid = tankIdOf(nodes[u]);
        if(tid){ if(!tank) tank = tid; continue; }             // reached, never crossed
        for(const v of adjn[u]) if(!seen.has(v)){ seen.add(v); st.push(v); }
      }
      return {tank, core};
    };
    for(const fid of fitIds){
      fitTarget[fid] = null;
      if(fitMode[fid] !== "relief") continue;
      if(openSide[fid] !== undefined) continue;                // vents to the room; no tank to name
      const l = index[fid+"l"], r = index[fid+"r"];
      if(l === undefined || r === undefined) continue;
      const L = walk(l), R = walk(r);
      fitTarget[fid] = (!L.core && L.tank) || (!R.core && R.tank) || null;
    }
  }

  const net2 = {nodes, index, edges, core: coreNode, n: nodes.length, byKey, fitIds, fitMode,
                cont: breakIds, sec: sgtrIds, secT: secTIds, sgtrParts, secTParts, fitTarget, fitVentOut,
                steamBreaks,
                /* the surge run's own key, resolved once here rather than
                   re-found by a string scan every tick - step()'s level
                   integral reads this run's solved flow out of runFlow */
                surgeKey: (byKey && Object.keys(byKey).find(k=>k.indexOf("surge:")===0)) || null};

  /* ELEVATION, once per commission - geometry, not state, so nothing here is
     re-derived per tick. A part node takes the height of the FACE it sits on;
     a tap interpolates linearly between its host run's two end nodes, which
     is what makes a split run's static heads telescope back to exactly the
     unsplit run's. Anything this cannot resolve sits at the core's height, so
     it contributes no static head rather than a wrong one. */
  const coreP = byId.core;   // byId hoisted at the top of this function, for tankIdOf()
  const zCore = coreP ? zFace(coreP, "c") : 0;
  /* A FOLDED NODE IS THE BARE PART ID - the core's single plenum, and a tee's
     four faces. Looked up whole before the face is sliced off, or a node
     called "fit1" resolves as a part called "fit" and the box silently sits
     at the core's height whatever cell it was placed in. */
  const partZ = nid => {
    const whole = byId[nid];
    if(whole) return zFace(whole, "c");
    const q = byId[nid.slice(0, -1)];
    return q ? zFace(q, nid.slice(-1)) : null;
  };
  net2.z = new Float64Array(net2.n);
  const unplaced = [];
  for(let i=0;i<net2.n;i++){
    const z = partZ(nodes[i]);
    if(z === null) unplaced.push(i); else net2.z[i] = z;
  }
  /* a containment node sits at the height of the opening it is on the far
     side of, so the break edge spans no column and discharges where it is.
     "break"/"sgtr"/"vent" here are SYNTHETIC edge kinds this function itself
     invents (a containment stub, a tube-rupture leak, a relief valve with
     nowhere else to vent) - never a run's own declared kind. */
  for(const ed of edges) if(ed.kind === "break" || ed.kind === "sgtr" || ed.kind === "vent") net2.z[ed.v] = net2.z[ed.u]; // LABEL: synthetic edge kind this function invents
  for(const i of unplaced) net2.z[i] = zCore;   // set above if it is an opening; the core's height otherwise
  for(const i in contZ) net2.z[i] = contZ[i];   // ...and a pipe-cell break is at the CELL, not at either machine

  /* The node the loop's pressure is fixed at - ROLE.fixed.kind==="datum" (the
     pressurizer, today; there must be at most one). A plant without one
     falls back to the core, so the field always has exactly one anchor and
     never floats. Was a literal "pzrb" - now the declared face of whichever
     part's role claims the datum, so this stays correct if a different part
     ever carries that role instead of being re-hardcoded to its name. */
  net2.coreNode = coreNode;   // pzrLive() needs the loop end of the walk, and nothing else knew it
  net2.pzrNode = coreNode;
  /* WHETHER A PART CLAIMED THE DATUM AT ALL, kept apart from whether its node
     exists. The fallback to the core covers both cases and they are not the
     same plant: no pressurizer on the grid is a design, while a pressurizer on
     the grid whose own datum face is on no run is a vessel nobody plumbed.
     pzrLive() needs to tell them apart, and off the fallback alone it cannot. */
  net2.pzrDatum = false;
  for(const q of LAY.parts){
    const R = ROLE[q.role];
    if(R && R.fixed && R.fixed.type === "datum"){
      net2.pzrDatum = true;
      // coreFold(): the pressurizer's four faces are one node, so the face
      // its ROLE names the datum on is not itself a node id in this graph
      const nid = coreFold(q.id + R.fixed.face);
      if(nid in index) net2.pzrNode = index[nid];
      break;
    }
  }
  /* which node each TANK row actually landed on this frame, or nothing if
     that tank is not on this plant - tankIdOf() derives it from the PART and
     the RUN, never a stored face name (see its own comment, above). Also
     kept as net2.tankNid (id -> node NAME) as well: render/pipes.js mirrors
     this exact test (pipeFullScale/pipeUnit) to meter a tank-bound run in
     inventory rather than mass, and it reads the name. It lives on the built
     network rather than on the tank's own config, because D.tanks rides
     designSig() and a per-frame writeback there would churn it. */
  net2.tankNid = {};
  net2.tankNode = {};
  /* the same map read the other way. netCoreFracOf() walks EDGES, not tanks,
     so without this it would have to scan every tank per edge to answer
     "which tank, if any, does this edge belong to" - and the answer has to
     be per-tank now that more than one tank can drain. */
  net2.tankIdByNode = {};
  for(const nid in index){
    const tid2 = tankIdOf(nid);
    if(tid2 && net2.tankNode[tid2] === undefined){
      net2.tankNode[tid2] = index[nid]; net2.tankIdByNode[index[nid]] = tid2; net2.tankNid[tid2] = nid;
    }
  }
  /* The condenser's own two ports (see COND_P0 above) - "or nothing" applies
     here too. Each is its own node: the condenser has no comp: edge (only an
     sg or a pump gets one, above), so condt and condr are NOT electrically
     joined by anything this stage builds, and fixing only one would leave
     the other's whole branch exactly as ungrounded as before. A plant with
     no condenser, or one whose exhaust/feed lines never routed to it,
     genuinely has no anchor here - see netFixed(), which only fixes what is
     actually in this map, never invents an entry. */
  /* EVERY CONDENSER'S OWN PORTS, keyed by node id rather than by face, because
     there can be more than one of them now - this used to name "condt" and
     "condr" outright and so could only ever see a part called `cond`. Off
     ROLE.thermal === "sink", the same declared field hostPartOf() reads, never
     an id. */
  /* AND THE ANCHOR IS THE CONDENSING VOLUME, not the whole machine. A surface
     condenser says which of its paths holds that volume (`anch`); its
     circulating-water side is ordinary plumbing, and a radiator is no anchor
     at all - it sheds heat, it does not hold a saturated space. Fixing every
     face of every sink drove a real flow round a dead-ended cooling circuit,
     because two fixed nodes with different elevations are a pump. A sink that
     declares no path is one node and is taken whole, exactly as before. */
  /* ══ HOLDUP, PER NODE ══
     A part's own volume shared over the nodes it actually has, plus half of
     each run that lands on it - the ordinary staggered split, so no cubic
     metre is counted twice and none is lost. Floored, because a node with
     zero volume would divide by zero in the advection sweep and because a
     machine nobody piped still has water in it. */
  // index the other way: the advection sweep and buoyH() both address nodes
  // by NAME, because that is what survives a snapshot (snapVal(), record.js)
  net2.name = new Array(net2.n);
  for(const nid in index) net2.name[index[nid]] = nid;
  net2.vol = new Float64Array(net2.n);
  { const nodesOfPart = {};
    // a FOLDED node is the bare part id (the core's plenum, a tee), so ask
    // for the whole name first and only then strip a face off it
    const partOfNodeV = nid => byId[nid] || partOfNode(nid);
    for(const nid in index){ const q = partOfNodeV(nid);
      if(q) (nodesOfPart[q.id] || (nodesOfPart[q.id] = [])).push(index[nid]); }
    for(const pid in nodesOfPart){ const list = nodesOfPart[pid], v = partVol(pid)/list.length;
      for(const i of list) net2.vol[i] += v; }
    for(const r of net){ const ends = runEnds(r.key, r.k); if(!ends) continue;
      const u = index[coreFold(ends[0])], v = index[coreFold(ends[1])];
      const half = runVol(r)/2;
      if(u !== undefined) net2.vol[u] += half;
      if(v !== undefined) net2.vol[v] += half; }
    for(let i=0;i<net2.n;i++) if(!(net2.vol[i] > 1e-3)) net2.vol[i] = 1e-3; }

  net2.condNode = {};
  for(const q of LAY.parts){
    const R = ROLE[q.role];
    if(!R || R.thermal !== "sink") continue;
    const faces = [];
    if(R.internal){ for(const IN of (Array.isArray(R.internal) ? R.internal : [R.internal])){
      if(!IN.anch) continue;
      if(IN.anch.indexOf("a")>=0) faces.push(IN.a);
      if(IN.anch.indexOf("b")>=0) faces.push(IN.b); } }
    else faces.push("t","r","l","b");
    for(const f of faces) if((q.id+f) in index) net2.condNode[q.id+f] = index[q.id+f];
  }

  /* ══ AN EDGE BETWEEN TWO FIXED NODES IS NOT AN EDGE ══
     Both ends are boundary conditions, so nothing about the plant decides what
     crosses it - only the elevation between two numbers somebody else set,
     which showed up as tens of thousands of kilograms a second circulating
     inside the condenser and swamping the enthalpy sweep. It carried no
     information before this stage either: the two faces were one folded node
     and there was no edge at all. */
  { const fixed = net2.condNode;
    for(let i=edges.length-1;i>=0;i--)
      if(fixed[net2.name[edges[i].u]] !== undefined && fixed[net2.name[edges[i].v]] !== undefined)
        edges.splice(i,1); }

  /* Which side of the loop each node sits on, built from the RUNS that touch
     it so no component has to be named. A node the hot legs reach is hot, one
     the cold legs reach is cold, and one both reach - the folded core, a
     cross-tie between the two sides - is neither and sits at Tavg. This
     array, and ONLY this array, feeds buoyH() (via nodeT()) - it must stay
     exactly what it always was, or the isothermal invariant (every static
     head identically 0 at s.coreDT=0, audit-physics.js) breaks. */
  /* WHICH NODES ARE FULL OF VAPOUR, and it is STRUCTURAL: a node every edge
     touching it reaches through vapour is a steam space. Nothing is named -
     place a fitting in the steam line and its two sides are steam spaces too,
     because a fitting declares BOTH its faces transparent and the runs either
     side of it are what answer. A node with no edge at all is not one.
     This decides whether a datum column comes off a node (netFixed(), and the
     readout that has to agree with it), never what an edge conducts. */
  net2.vapour = new Uint8Array(net2.n);
  { const any = new Uint8Array(net2.n);
    net2.vapour.fill(1);
    for(const ed of edges){
      /* A BREAK, A VENT AND A TUBE LEAK ARE HOLES, NOT CONTENTS. They hang off
         every run alike and say nothing about what is inside it, so a hole in
         the exhaust line must not make it read as full of water. */
      if(ed.kind==="break" || ed.kind==="vent" || ed.kind==="sgtr") continue;
      any[ed.u]=1; any[ed.v]=1;
      // a run answers off its KIND (RUN_VAPOUR); a path through a component
      // answers per FACE, off the row that declared it (vapU/vapV, above)
      const k = RUN_VAPOUR[ed.kind];
      if(!(ed.vapU || k)) net2.vapour[ed.u]=0;
      if(!(ed.vapV || k)) net2.vapour[ed.v]=0;
    }
    for(let i=0;i<net2.n;i++) if(!any[i]) net2.vapour[i]=0; }
/* ══ net2.tag IS A LABEL NOW, AND ONLY A LABEL ══
     It used to be the plant's only answer to "how hot is it here", flooded
     onto nodes off the run KIND and read by nodeT() and through it by
     buoyancy. Every one of those readers is gone: a node carries a real
     enthalpy (s.hBy) and buoyH() reads the temperature that enthalpy says.
     What is left is a direction and animation label - which side of the core
     a run leaves by - and that IS a property of the kind, so it stays keyed
     on one. Nothing in the heat balance may read it again. */
  net2.tag = new Uint8Array(net2.n);
  for(const ed of edges){
    const b = KIND_TEMP[ed.kind] || 0;
    if(b){ net2.tag[ed.u] |= b; net2.tag[ed.v] |= b; }
  }
  for(let i=0;i<net2.n;i++) if(net2.tag[i] === (NT_HOT|NT_COLD)) net2.tag[i] = 0;
  /* ── WHAT A FEEDWATER PUMP HAS TO BEAT ──
     Two parts, and only the second is the pump doing anything. The first is
     the standing difference between the two FIXED nodes the pump spans - a
     generator's shell at secP() on one side, whatever its suction draws on
     (the condenser at COND_P0, or a secondary tank) on the other - which it
     must simply cancel before a single drop moves. The second is FEED_DP, the
     real drive. Split that way FEED_DP is a property of the PUMP rather than
     of where anybody put the condenser: hang the generator ten metres higher
     and the standing term grows to match, exactly as it does for a real pump,
     while the authority the operator has over level does not move.
     Highest generator against lowest supply - a pump serving two generators
     has to beat the harder one and the easier one simply takes more, which is
     what a real feedwater header does.
     The suction anchor is found by walking THIS graph out from the suction
     node with the pump's own casing edge cut, stopping AT a fixed node
     without crossing it - pzrLive()'s "reached, never crossed" idiom. Nothing
     is named: whatever fixed thing is actually plumbed to the suction is what
     the pump draws on. Resolved on the first solve and kept, because the
     fixed SET is constant for a given net (netFixed()'s own comment) even
     though every value in it moves each tick. */
  if(secPumps.length){
    const adj2 = {};
    for(const ed of edges){ (adj2[ed.u]||(adj2[ed.u]=[])).push([ed.v,ed]);
                            (adj2[ed.v]||(adj2[ed.v]=[])).push([ed.u,ed]); }
    for(const sp of secPumps){
      const disIdx = sp.gens.map(g=>index[g+"t"]).filter(i=>i!==undefined);
      const sucStart = index[sp.suc];
      /* h drives u -> v (netAssemble), so it is signed by which END of this
         pump's own casing edge the suction is on. A coolant pump draws on "t"
         and discharges to "b", a feed pump the other way round, and there is
         one pump role - so the orientation is read off the drawing here
         rather than declared twice on the role. */
      const sign = index[sp.suc] === sp.edge.u ? 1 : -1;
      let sucIdx = null;
      sp.edge.h = s => {
        /* the map THIS solve already built. Every caller computes it and
           hands it straight to netAssemble/netFlows, which is the only place
           a head is ever evaluated, so what is parked here is always this
           tick's - and building a second one per pump per solve is pure
           waste. Falls back rather than trusting that. */
        const f = net2.fixedNow || netFixed(net2, s);
        if(sucIdx === null){
          sucIdx = [];
          const seen = {}, stack = [sucStart]; seen[sucStart] = 1;
          while(stack.length){ const u = stack.pop();
            if(f[u] !== undefined){ sucIdx.push(u); continue; }   // reached, never crossed
            for(const [v,ed] of (adj2[u]||[])){
              if(ed === sp.edge || seen[v]) continue;
              seen[v] = 1; stack.push(v); } }
        }
        let dis = -Infinity, suc = Infinity;
        for(const i of disIdx) if(f[i] > dis) dis = f[i];
        for(const i of sucIdx) if(f[i] < suc) suc = f[i];
        if(!isFinite(dis) || !isFinite(suc)) return 0;   // nothing fixed either side: no standing term to beat
        return sign * ((dis - suc) + FEED_DP*feedDrive(s, sp.p.id));
      };
    }
  }

  /* Every edge's head gains its static term alongside whatever source pushed
     it. Done here, once, rather than at each push site: buoyancy is a property
     of an edge's two ends, so writing it into the pump's own closure and the
     pipe's and the fitting's would be the same expression three times. */
  for(const ed of edges){
    const src = ed.h;
    ed.h = typeof src === 'function' ? s => (src(s) + buoyH(net2, ed, s))*HEAD_K
         : src ? s => (src + buoyH(net2, ed, s))*HEAD_K
         : s => buoyH(net2, ed, s)*HEAD_K;
  }

  return net2;
}

/* ══════════ THE FIELD IS ABSOLUTE: WHICH NODES ARE KNOWN ══════════
   A FIXED node carries a pressure the solve is told rather than asked for.
   The pressurizer is one, because that is what a pressurizer IS: the
   component that sets the loop's pressure level. s.P keeps its own dynamics
   and stops being THE pressure - it is the pressure AT THAT NODE, and every
   other node's follows from head, elevation and flow.

   A single fixed node only sets the LEVEL: its value adds a uniform constant
   to every potential, and flows depend only on differences, so it cannot
   change a single flow. It is the SECOND fixed node - containment behind a
   break - that introduces a real driving term. */
/* The pressurizer's own piezometric head - what the solve is written ABOUT,
   so that node is fixed at exactly 0 and every other value is measured from
   it. Not cosmetic: a plant with no head source anywhere must produce an
   exactly uniform field, and 15.5 plus or minus one ulp against a conductance
   of 1e3 is a flow of 1e-12 where the answer is 0 - which is a thermosiphon
   manufactured out of rounding, at any elevation, on a dead plant. Every
   pressure is recovered by adding this straight back (netCoreFracOf). */
const phiRef = (net, s) =>
  (s.P === undefined ? P.P0 : s.P) + rhoDatum(s)*G_MPA*net.z[net.pzrNode];
/* ══ IS THE PRESSURIZER PLUMBED TO THE LOOP AT ALL ══
   Reachability from the core node to the datum node, over the edges the solve
   would actually assemble (g>0) - never a stored run list. A shut valve, a severed
   run and a run that was never drawn must all answer the same, which is the
   rule netAssemble already keeps: a shut branch is an absent branch.

   The walk does not pass THROUGH a fixed node. A boundary absorbs whatever it
   is given, so pressure does not propagate across one - and that is what stops
   the relief header counting as a path home: it runs from the vessel to a tank
   fixed at its own gas pressure, which is a dead end, not a way back to the
   loop. A break is the same: each opening gets its own containment node.

   Costs one pass over the edge list. Called once a tick from step(), not from a
   layer - a layer must not solve, and this walks the same conductances a solve
   would. */
function pzrLive(net, s){
  if(!net.pzrDatum) return true;                  // no pressurizer on the grid: nothing to disconnect
  // it claimed the datum and its own face is on no run at all - the vessel is
  // sitting there unplumbed, and the solve has already fallen back to the core
  if(net.pzrNode === net.coreNode) return false;
  const fixed = netFixed(net, s);
  const adj = new Array(net.n);
  for(let e=0;e<net.edges.length;e++){
    const ed = net.edges[e];
    const g = typeof ed.g === 'function' ? ed.g(s) : ed.g;
    if(!(g > 0)) continue;
    (adj[ed.u] || (adj[ed.u] = [])).push(ed.v);
    (adj[ed.v] || (adj[ed.v] = [])).push(ed.u);
  }
  const seen = new Uint8Array(net.n), stack = [net.coreNode];
  seen[net.coreNode] = 1;
  while(stack.length){
    const u = stack.pop();
    if(u === net.pzrNode) return true;
    if(u !== net.coreNode && fixed[u] !== undefined) continue;   // reached, never crossed
    const a = adj[u];
    if(a) for(let i=0;i<a.length;i++){ const v=a[i]; if(!seen[v]){ seen[v]=1; stack.push(v); } }
  }
  return false;
}
function netFixed(net, s){
  const f = {}, p0 = phiRef(net, s), rd0 = rhoDatum(s)*G_MPA;
  /* THE DATUM COLUMN A NODE ACTUALLY HAS. The solve carries piezometric head
     (phi = p + rho*g*z) for a network that used to be liquid throughout. A
     STEAM SPACE HAS NO COLUMN: three metres of exhaust line is worth 19 kPa of
     water and essentially nothing of steam, and 19 kPa is twice the whole
     pressure the condenser sits at. net.vapour is the structural answer to
     which nodes those are, and it must be read HERE as well as at the readout
     or the two disagree by exactly that column. */
  const rdz = i => net.vapour[i] ? 0 : rd0*net.z[i];
  f[net.pzrNode] = 0;
  /* CONTAINMENT, one node per opening, always fixed and usually attached to
     nothing: its edge's g is 0 until that break happens, so netAssemble skips
     the edge and the node contributes exactly nothing. Keeping the SET
     constant rather than adding a node when a break opens is what lets the
     factorisation cache key on the break's own live state (s.dmgParts and
     s.breach, netFactored below) instead of on a set that changes shape - and
     a break still busts that cache, which is the thing that matters: a fresh
     break solved against the intact plant's factors is a wrong answer, not a
     crash. */
  for(const i of net.cont) f[i] = P.Pcont + rdz(i) - p0;
  /* Every TANK's own node is fixed at the pressure its own gas space is
     holding. That is the whole of 2h and 2j: injection is then the SOLVED
     flow through the tank's one edge against the loop it is fighting, so a
     loop at full pressure takes almost nothing and a depressurised one takes
     a surge, and an emptying accumulator tapers because its gas is expanding.
     Fixed whether or not the edge is open - an isolated node costs nothing
     and keeps the fixed SET constant, so the factorisation cache keys on the
     valve instead of on a set that changes shape. */
  for(const id in net.tankNode) f[net.tankNode[id]] = tankP(s,id) + rdz(net.tankNode[id]) - p0;
  /* the secondary side of each steam generator - a boundary, not a solve.
     Fixes the synthetic sgtr node AND, since Stage 1, the generator's own
     real steam port (net.secT) at the identical pressure - one formula, two
     places it is physically true. */
  net.sec.forEach((i,k)=>{ f[i] = secP(s, net.sgtrParts[k]) + rdz(i) - p0; });
  net.secT.forEach((i,k)=>{ f[i] = secP(s, net.secTParts[k]) + rdz(i) - p0; });
  /* the condenser's own two ports, fixed at COND_P0 - the secondary's low-
     pressure sink, the same role P.Pcont plays for a break. Constant, so
     nothing here needs to enter netFactored()'s live signature beyond what
     Object.keys(fixed) already carries: the SET only changes when the net
     itself is rebuilt (a different plant), never tick to tick. */
  /* LIVE, not a constant: the condenser solves its own saturation pressure now
     (condP, step.js). A fixed node's VALUE is safe for the factorisation cache
     - only conductances enter netFactored()'s signature - so this may move
     every tick without busting it. */
  { const pc = condP(s);
    for(const k in net.condNode) f[net.condNode[k]] = pc + rdz(net.condNode[k]) - p0; }
  net.fixedNow = f;   // for a head that has to read another fixed node - see the secPumps pass
  return f;
}
/* WHICH nodes are fixed, never what they hold. A fixed node's VALUE only ever
   reaches b, so it may move every tick for free; whether a node is fixed at
   all changes the MATRIX, so it has to bust the factorisation cache. */
const netFixSig = fixed => Object.keys(fixed).join(',');

/* Factors A once per DISTINCT combination of fitting state and caches it
   there. The cache key is a signature of every fitting's live state, not the
   net instance alone: a relief valve's own edge is gated on live
   S.reliefOpen, and a throttle's a live function of S.valve (see netBuild()),
   so A itself can change tick to tick, and a factorisation left over from before a fitting moved would
   be a silent wrong answer, not a crash - the signature is checked on every
   call rather than trusted once. A throttle's position is continuous, so its
   own term is the exact value rather than a '0'/'1' flag: ANY change to it
   has to bust the cache, not just crossing some open/shut line. dmgParts
   never enters A (only a pump's head b does), so it plays no part in the
   signature. */
function netFactored(net, s, fixed){
  const sig = net.fitIds.map(fid => {
    const mode = net.fitMode[fid];
    /* relief is a mode too now, gated on S.reliefOpen/S.reliefBlocked rather
       than S.valve - either crossing changes A, so both enter the signature
       exactly like a throttle's own position does. */
    if(mode==="relief") return (s.reliefOpen && s.reliefOpen[fid] && !(s.reliefBlocked && s.reliefBlocked[fid])) ? '1' : '0';
    return String(s.valve && s.valve[fid]);   // throttle
  }).join('|')
  /* pipe damage is a third live input the edges above read (beside
     S.reliefOpen and S.valve) - leave it out of the signature and a hit or a
     repair reuses last tick's factorisation, solving the network as though
     the pipe on the grid were still the one it was before: a wrong answer,
     not a crash, so it is checked every call exactly like the other two. */
  + '|' + (s.dmgParts ? s.dmgParts.filter(k => k.indexOf("pipe:")===0).join(',') : '')
  /* and a port valve is the fifth: shutting one takes its run's edge out of A
     entirely (runPortsOpen(), above), which is the same class of change a
     severed cell is and has to bust the factorisation the same way. Only the
     SHUT ones are named, so a plant nobody has isolated anything on adds an
     empty field and keeps its key. */
  + '|' + (s.portShut ? Object.keys(s.portShut).filter(k => s.portShut[k]).join(',') : '')
  /* the fixed SET is the fourth live input to A. A break appearing puts a
     second known pressure into the matrix, not just into b, so reusing last
     tick's factors would solve the broken plant against the intact one's -
     a wrong answer, not a crash. */
  + '|' + netFixSig(fixed)
  /* a ruptured vessel opens a break edge the same way a severed run does, and
     unlike a severed run it is not in s.dmgParts */
  + '|' + (s.breach ? 'B' : '')
  /* a ruptured generator opens an edge to its own secondary, and that is a
     change to A, not to b - so it has to bust the factorisation too. Against
     net.sgtrParts (ROLE[role].sgtr, built once in netBuild()), not a regex
     on the id - a damage id is only ever "this part ruptured" for a part
     whose role can rupture at all. */
  + '|' + (s.dmgParts ? s.dmgParts.filter(k => net.sgtrParts.indexOf(k)>=0).join(',') : '')
  /* Every gate on every tank's own edge - the operator's valve, its auto
     rule, the diode and "is there anything left to give" - as ONE bit per
     tank, off the same tankLive() the edge itself is built from. Any of them
     crossing changes A, not just b. No tank is named here: adding a tank is
     adding a bit, and a tank whose gates never move never busts anything.
     Filtered on HAVING A NODE, not on being primary: a secondary tank has a
     real edge now, and it is a live g exactly like any other tank's. A tank
     with no cell has no node and so adds no bit, which is right - there is
     nothing about it for A to depend on. */
  + '|' + tankIds().filter(id=>net.tankNode[id]!==undefined).map(id=>tankLive(s,id)?'1':'0').join('');
  if(!net.Af || net.AfSig !== sig){
    /* ══ A FIXED NODE IS NOT IN THE MATRIX AT ALL ══
       netAssemble never writes a fixed node's row, its column or its b entry -
       a fixed value reaches the system through its free neighbours' b and
       nowhere else. So every fixed node contributes one zero pivot the guard
       then decouples, and a DENSE elimination pays for it as if it were real:
       276 of 312 nodes on a four-loop plant, most of them containment nodes
       for breaks that have not happened.
       Compacting to the free rows is exact rather than an approximation -
       there is nothing in those rows to drop. The fixed SET is already in the
       signature above, so this index is cached with the factors it belongs to
       and a break opening rebuilds both together. */
    const free = [];
    for(let i=0;i<net.n;i++) if(fixed[i]===undefined) free.push(i);
    const nf = free.length, row = new Int32Array(net.n);
    for(let a=0;a<nf;a++) row[free[a]] = a;
    net.Affree = Int32Array.from(free); net.Afrow = row; net.Afn = nf;
    const degC = new Uint8Array(nf);
    net.Af = netFactor(
      netAssemble(net.edges, net.n, fixed, s, null, null, null, row, nf).A, nf, degC);
    /* Scattered back to node index, because every reader of it is - and a
       fixed node stays 0, which is what its reader already required: the byP
       loop asks about deg only where fixed[i] is undefined. */
    net.Afdeg = new Uint8Array(net.n);
    for(let a=0;a<nf;a++) net.Afdeg[free[a]] = degC[a];
    net.AfSig = sig;
  }
  return net.Af;
}
/* Gather the free rows out of a full-length b, substitute against the
   compacted factors, and scatter the answer back - so nothing downstream has
   to know the matrix is smaller than the network. A fixed node lands at 0,
   exactly where netSubst() used to leave it. */
function netSubstFree(net, x){
  const free = net.Affree, nf = net.Afn, c = new Float64Array(nf);
  for(let a=0;a<nf;a++) c[a] = x[free[a]];
  netSubst(net.Af, c, nf);
  x.fill(0);
  for(let a=0;a<nf;a++) x[free[a]] = c[a];
  return x;
}

/* Assembles a fresh b for THIS s (cheap, O(n^2)), then substitutes against
   the cached factorization (also O(n^2)) - the O(n^3) elimination happens at
   most once per open-junction combination. Returns the total flow arriving
   at the core inlet: the magnitude of flow on every "cold" edge that touches
   ground, summed once each - "hot" edges touching ground are the same
   loop's flow leaving the core, not a second contribution, so counting them
   too would double it. byLoop, if given, is filled in place with the same
   sum bucketed by loopOfKey(edge.key) instead of pooled - netFlowK's
   per-connected-group ceiling (below) needs a loop's own raw flow, in its
   own physical units, never averaged flat across loops of different length.
   byRun, if given, is filled in place too, keyed by EVERY edge's own run key
   rather than pooled or bucketed by loop - the per-run flow animation in
   step() needs a run's own share, not the loop-wide or plant-wide total. A
   run split into series segments (a tap sits on it) shares one key across
   several edges; the LAST one written wins, which is the most-downstream
   segment - the one a throttle between it and the core has already acted
   on, so that is the number the animation should show. */
function netCoreFracOf(net, s, byLoop, byRun, byDrop, byP, outs){
  const fixed = netFixed(net, s);
  netFactored(net, s, fixed);
  const b = new Float64Array(net.n);
  netAssemble(net.edges, net.n, fixed, s, false, b);
  netSubstFree(net, b);
  netUnfix(b, fixed);
  /* phi -> p: the datum column comes off here, once, so every reader of the
     field gets a real pressure in MPa and nothing downstream has to know the
     solve worked in piezometric head at all. */
  /* phi -> p, and TWO things this must not print.
     A NODE WITH NO PATH TO GROUND HAS NO PRESSURE. netFactor()'s pivot guard
     decoupled it and handed back whatever b left there; printing that is the
     "large, plausible-looking wrong number" this file already refuses
     elsewhere. Shut a valve in the steam line and the turbine inlet is exactly
     that node. Fixed nodes are never dropped - netUnfix() has just written
     their known value over b, so a trivially-degenerate row there is not a
     missing answer, it is the answer.
     A STEAM LINE HAS NO WATER COLUMN IN IT. The solve carries piezometric head
     for a network that was all liquid, so taking the datum back off leaves a
     full column's worth of head on a pipe full of vapour - measured, 19 kPa
     over the three metres between the turbine and the condenser, which is
     twice the condenser's whole pressure and printed the exhaust line as 0
     while the condenser it runs into read 10 kPa. Steam is about a thirtieth
     the density, so on a vapour node the column is not there. */
  if(byP){ const rd = rhoDatum(s)*G_MPA, p0 = phiRef(net, s);
    const deg = net.Afdeg;
    for(let i=0;i<net.n;i++){
      if(deg && deg[i] && fixed[i]===undefined){ delete byP[net.nodes[i]]; continue; }
      byP[net.nodes[i]] = b[i] + p0 - (net.vapour[i] ? 0 : rd*net.z[i]);
    } }
  const q = new Float64Array(net.edges.length);
  netFlows(net.edges, b, fixed, q, s);
  /* b IS the solved PRESSURE at every node, in MPa, once netSubst() has run
     and netUnfix() has written the known nodes back over it. The scale is
     the SPAN across the whole network, highest node to lowest - not the
     highest alone, which is only the discharge above ground and leaves the
     suction side below zero, so a hard-throttled leg could report a drop of
     200% of it. Against the span, one edge can never lose more than all of
     them do, and the figure stays free of PIPE_K exactly the way netFlowK()
     is: the number a gauge prints must not move when a constant nobody can
     see is re-fitted. */
  let pmax = -Infinity, pmin = Infinity;
  for(let i=0;i<net.n;i++){
    /* free nodes only: a containment node sits 15 MPa below the loop whether
       or not anything is open to it, and letting it into the span would
       collapse every drop this scale exists to make legible. */
    if(fixed[i] !== undefined && i !== net.pzrNode) continue;
    if(b[i]>pmax) pmax=b[i]; if(b[i]<pmin) pmin=b[i];
  }
  const span = pmax - pmin;
  // every node a TANK row landed on - hoisted once so the core-flow test
  // below is a Set lookup, not a rebuilt object per edge
  const tankNodes = new Set(Object.values(net.tankNode));
  let core = 0, spill = 0, spillSec = 0;
  for(let e=0;e<net.edges.length;e++){
    const ed = net.edges[e];
    /* SIGNED, along the edge's own u->v order, which is the run key's own
       canonical order. It used to be Math.abs(), and the packet animation read
       it: three of the stock plant's four primary runs then ran BACKWARDS,
       because pipeMap() canonicalises a key by sorting part ids and that
       order has no reason to be the flow order - "sg0" sorts before "tee0", so
       the hot leg's second half read sg0 to tee0 and drew water arriving at the
       surge tee from both sides at once. Every caller that wants a MAGNITUDE
       now says so; the one that wants a direction can finally have it. */
    if(byRun && ed.key) byRun[ed.key] = q[e];
    /* SIGNED, PER TANK - identified by which NODE the edge touches
       (net.tankIdByNode), not by a kind label, so a run reaching that node
       any other way counts too. TANK-OUT-POSITIVE: positive is out of the
       tank, which for an injection line is into the loop. Signed off the
       TANK's own node rather than off the core's, because a tank whose far
       end is not the core (a relief header, a generator's feed line) has no
       core end for a core-relative sign to read, and would silently take
       whichever sign the node numbering happened to give it. A tank fills or
       drains depending on which way the solved differential points, and an
       absolute value cannot say which. */
    if(outs && net.tankIdByNode){
      const tu = net.tankIdByNode[ed.u], tv = net.tankIdByNode[ed.v];
      if(tu !== undefined || tv !== undefined){
        const by = outs.qTankBy || (outs.qTankBy = {});
        const tid3 = tu !== undefined ? tu : tv;
        by[tid3] = (by[tid3]||0) + (tu !== undefined ? q[e] : -q[e]);
      }
    }
    if(byDrop && ed.key) byDrop[ed.key] = span>0 ? Math.abs(b[ed.u]-b[ed.v])/span : 0;
    if(ed.kind === "break"){ // LABEL: synthetic edge kind this function invents
      /* charged to the side the hole is on (ed.sec/ed.steam, netBuild) - the
         plume is still booked in outs.by whichever side it is, because a hole
         is a hole. A steam-side hole is charged at its shell instead, so it
         is counted in NEITHER sum here: what leaves it is steam, and this
         solve carries one density. */
      if(!ed.steam){ if(ed.sec) spillSec += Math.abs(q[e]); else spill += Math.abs(q[e]); }
      /* per OPENING, because an effect has to be drawn where its own hole is:
         a severed run's two ends share one key and sum, the vessel has its
         own. This is what stops the breach plume being a boolean at the
         reactor whatever actually broke. */
      if(outs){ (outs.by || (outs.by = {}));
                outs.by[ed.key] = (outs.by[ed.key]||0) + Math.abs(q[e]); }
    }
    /* WHAT THIS GENERATOR IS ACTUALLY BEING FED, off its own shell edge and
       not off any pipe. Signed: positive is into the shell. Read off the
       machine rather than off a run key because how many pipes feed it, and
       what anyone called them, is the player's business - one feed line, two,
       or an emergency line as well all arrive here and sum. This is the
       ACTUAL the feed controller walks its valve against (step.js); `want` is
       the demand. */
    if(outs && ed.shellOf !== undefined){
      (outs.sgFeedBy || (outs.sgFeedBy = {}));
      outs.sgFeedBy[ed.shellOf] = (outs.sgFeedBy[ed.shellOf]||0) + q[e];
    }
    /* signed: primary into secondary is positive, and once the primary is
       brought DOWN to the secondary this reaches zero on its own */
    if(outs && ed.kind === "sgtr"){ // LABEL: synthetic edge kind this function invents
      outs.qSgtr = (outs.qSgtr||0) + q[e];
      /* per GENERATOR, the same argument outs.by makes for openings: the jet
         belongs on the machine whose tubes went, not on every machine in the
         row. Keyed by the edge's own key ("sgtr:"+part id). */
      (outs.sgtrBy || (outs.sgtrBy = {}));
      outs.sgtrBy[ed.key] = (outs.sgtrBy[ed.key]||0) + q[e];
    }
    /* A relief valve's own gated edge - carried on the edge itself (ed.fit,
       written by netBuild()'s ROLE.internal loop), never matched against a
       run's own kind string. This is the vent: whatever this edge carries, in
       either direction the fitting's own g() ever admits, is mass leaving
       the loop through THIS valve - the same figure reliefRate() (above)
       hands back to step.js and the panel, off the identical solve. */
    if(outs && ed.fit && net.fitMode[ed.fit]==="relief"){
      const fid = ed.fit;
      (outs.reliefBy || (outs.reliefBy = {}));
      outs.reliefBy[fid] = (outs.reliefBy[fid]||0) + Math.abs(q[e]);
    }
    /* Core flow, by NODE incidence rather than "kind cold": every edge
       touching the core node contributes its signed flow, normalised to
       positive-means-inflow (ed.v===core: u->v is arriving; ed.u===core:
       u->v is leaving, so negate). Summing only the positive contributions
       gives total inflow, which by conservation equals total outflow at a
       node with no accumulation of its own - a single well-defined number
       whichever edges happen to reach this node.
       Two exclusions survive, both still by what the edge structurally IS,
       never by a permission:
       - an edge incident on a TANK node (net.tankNode - HPI, today): this
         figure is the LOOP's own circulation, judged against a pump-derived
         P.netRef, and an injection line reaching the core directly is a
         real but DIFFERENT flow - already its own figure (outs.qTankBy,
         above). Sever every hot/cold run and HPI auto-opens on the crashing
         pressure; without this exclusion its injection would read as "the
         loop still carries flow" the moment every leg feeding it is cut.
       - a HOT-tagged edge (KIND_TEMP - the same DEFAULT-PICKER already
         labelling which side of the loop a run sits on, reused rather than
         a second raw "hot" string): by construction a hot leg carries flow
         AWAY from the core under every intended operating condition, so
         counting it positively here would either double what the matching
         cold leg already reports, or - the case this exists for - misread
         a REVERSED trickle as fresh circulation. Combat damage only cuts a
         tapped run's own LAST segment (pushSeg, above), so severing
         hot:corer-sg0l downstream of the surge tap leaves the short stub
         between the core and that tap electrically intact; with the
         pressurizer's own fixed node still pushing through the surge line
         and the severed cold leg's break edge open at the other side, real
         current crosses that stub - correctly counted as SPILL (outs.spill,
         above, already includes every break edge unconditionally), and
         wrongly counted as "the loop still circulates" without this line.
         Both readings are checked against the SAME "sever every primary
         run" case in audit-physics.js: spill rises, netFlowK stays 0. */
    const qTankEdge = tankNodes.has(ed.u) || tankNodes.has(ed.v);
    const awayFromCore = KIND_TEMP[ed.kind] === NT_HOT; // LABEL: reuses the hot/cold DEFAULT-PICKER as a direction label, not a permission
    if(!qTankEdge && !awayFromCore && (ed.u === net.core || ed.v === net.core)){
      const qin = ed.v === net.core ? q[e] : -q[e];
      if(qin > 0){
        core += qin;
        if(byLoop){ const i = loopOfKey(ed.key); if(i!=null) byLoop[i] = (byLoop[i]||0) + qin; }
      }
    }
  }
  if(outs){ outs.spill = spill; outs.spillSec = spillSec; }
  return core;
}

// No damage, every fitting exactly as commissioned - a cross-tie shut and a
// spliced valve wide open, which is exactly what resetPlant() seeds (fitTies(),
// layout.js) - and every loop's OWN head clamped at 1.0 (capScale)
// regardless of what is actually installed on it. That clamp is the one
// thing this reference must NOT inherit from the live plant: a spare pump
// must not be able to inflate the 100% mark it will later be judged
// against, or it would buy the plant nothing the day it is actually needed
// (see netFlowK's own comment) - loopFlowK() never let an isolated loop's
// own capacity count for more than 1 either, spare or no spare. A loop
// built SMALLER than default (up<1) is not bumped up to 1 - that pump's own
// undersized reference is real and the plant's 100% mark is honestly lower
// for it, exactly as loopFlowK()'s min(1,up) always was.
// This is the one place the as-commissioned throttle default is asserted
// rather than read off S: a throttle omitted here would read s.valve as
// undefined, the g() gate would treat that exactly like fully shut, and
// every reference through a SPLICED valve would collapse to zero - wrong,
// because the live plant commissions that same valve wide open. It must be
// the SAME predicate resetPlant() uses, or the reference is a plant nobody
// commissioned.
// Taken on the net just built, not P.net, because commission() calls this
// before P.net is necessarily the last thing it assigned. byLoop/byRun, if
// given, are filled the same way netCoreFracOf fills them - this is
// P.netRefByLoop's and P.netRefByRun's own producer.
const netCoreFrac0 = (net, byLoop, byRun) => {
  /* THE REFERENCE STATE, stated rather than inherited. It is ISOTHERMAL
     (coreDT 0), so buoyancy in it is exactly zero and netRef stays what it
     has always been: a purely geometric figure that prices this plant's
     PIPING and its pumps, not how hot it happened to be when it was
     commissioned. A freshly reset plant is isothermal too (resetPlant()
     starts s.coreDT at 0, and the loop takes seconds to establish a rise),
     so an undamaged plant nobody has run still reads exactly 1 - and once it
     is hot, the buoyancy it develops is real extra flow that a geometric
     reference must NOT contain. Pump speed is rated, because that is what
     "as commissioned" means for a pump. */
  const s = {dmgParts:[], capScale:{}, valve:{}, flow:1, Tavg:P.Tref, coreDT:0, P:P.P0};
  for(const fid of net.fitIds) if(net.fitMode[fid]==="throttle")
    s.valve[fid] = fitTies(fid) ? 0 : 1;
  for(let i=0;i<P.loops;i++){
    const up = loopPumpCap(i, []);
    s.capScale[i] = up>1 ? 1/up : 1;
  }
  return netCoreFracOf(net, s, byLoop, byRun);
};

/* Head lost across every edge, as a fraction of pump discharge. Read-only and
   derived - the potentials themselves never leave this file, because a caller
   holding a node number would be holding a piece of the solve it could not
   keep in step with the tick that produced it.

   This is what makes a throttle legible. Flow already tells you a leg is
   quiet; only the drop tells you WHICH fitting is doing it, and a throttle
   with no differential beside it is a knob whose effect the player has to
   infer from a number three components away. */
function netDrops(s){
  const o = {};
  if(P && P.net) netCoreFracOf(P.net, s, null, null, o);
  return o;
}

/* One solve, both answers - the head lost across every run AND the pressure
   at every node. A renderer wants both in the same frame and they come off
   the same substitution, so asking for them separately would solve the plant
   twice a frame for one set of numbers. */
function netField(s, byDrop, byP){
  if(P && P.net) netCoreFracOf(P.net, s, null, null, byDrop, byP);
}

/* What a solved network flow costs the loop, in % of inventory per second.
   The one place a flow becomes a percentage, so a break, an injection and a
   vent are all charged against s.inv through the same conversion instead of
   three unrelated rates. */
/* P.netRef IS NOT ALWAYS POSITIVE, and commission()'s claim that it is "by
   construction" was true only while every plant had loop legs. Disconnect
   both of them on the bench - two DISCONNECTs, a gesture the player has - and
   the reference circulation is exactly 0, because there is no circuit. That
   made this 0/0: measured, s.lvl, s.inv, s.rho and nine more fields went
   non-finite on the FIRST tick, and the plant then sat at a NaN temperature
   forever rather than cooking, which is the one thing a sealed core must do.

   0 is the honest answer, not a papered-over one: with no path out of the
   vessel there is no loop for a flow to be a percentage OF. Nothing that has
   a loop can reach this branch, so no plant with a circuit moves by a float. */
const invRate = q => { const ref = P.netRef*LOOP_TRANSIT; return ref > 0 ? 100*q/ref : 0; };
/* ══ THERMAL EXPANSION IS A SOURCE, NOT A CORRELATION (Stage 6c) ══
   The inverse of invRate(): a rate in % of loop inventory per second, back
   into the current the solve is written in. One conversion, both directions.

   Loop water expands as it heats, and in an incompressible network that
   volume has nowhere to go but up the surge line. Injected at the CORE node,
   which is where the heat goes in. The pressurizer is the network's only
   compliance - it is a fixed node - so the whole source arrives there, which
   is exactly what a surge is.

   BETA_W is the volumetric thermal expansion coefficient of pressurised water
   near 300 C, 1/K. PHYSICAL, not fitted. s.dTavg is last tick's rate, the
   same lag every other feedback in this file carries: this tick's rate comes
   out of this tick's solve, so it cannot also be an input to it. */
const invQ = pct => pct/100*P.netRef*LOOP_TRANSIT;
const BETA_W = 0.0025;
function expSrc(net, s){
  const r = s && s.dTavg;
  if(!r || !isFinite(r) || net.core===undefined) return null;
  const src = new Float64Array(net.n);
  src[net.core] = invQ(100*BETA_W*r);
  return src;
}
/* The surge line's own flow due to expansion ALONE, as a SECOND substitution
   against the same factorisation - exactly the trick netFlowK() already uses
   to separate the pumped share from the thermosiphon, and for the same reason:
   the network is linear, so the full solve is the sum of the two.

   It has to be separate rather than a source added to the main b. Measured:
   injected into the main solve it lands on the core inlet flow too, so
   netFlowK() stops being a property of the plant's hydraulics and starts
   carrying a thermal term - "a repaired run left netFlowK at 1.0161944934550204,
   expected exactly 1.0162636178690743" went red the moment it went in, which
   is the auditor doing its job. Cheap: the factorisation depends on
   conductance, not on the right-hand side, so this costs one substitution and
   never a re-elimination. */
function netExpSurge(net, s){
  const src = expSrc(net, s);
  if(!src || !net.surgeKey) return 0;
  const fixed = netFixed(net, s);
  netFactored(net, s, fixed);
  const x = src.slice();   // a fixed node's delta is 0 by definition, and the gather never reads one
  netSubstFree(net, x);
  let q = 0;
  for(const ed of net.edges){
    if(ed.key !== net.surgeKey) continue;
    const g = typeof ed.g === 'function' ? ed.g(s) : ed.g;
    if(!(g > 0)) continue;
    q += g*((fixed[ed.u]!==undefined?0:x[ed.u]) - (fixed[ed.v]!==undefined?0:x[ed.v]));
  }
  return q;
}

/* THE FIELD. Pressure in MPa at every node, keyed by node id - the answer to
   "what is the pressure HERE", which is the whole point of solving absolutely.
   Read-only and resolved fresh, never on S: exactly the argument the radiation
   field makes, and for exactly the same reason - nothing here can drift out of
   step with a snapshot, because nothing here IS a snapshot.

   The tick does NOT call this. step() takes its field off netFlowK()'s own
   solve, so a tick pays for one solve and not two; this is for a reader
   asking off-tick (a renderer between frames, an auditor). */
function netPressures(s){
  const o = {};
  if(P && P.net) netCoreFracOf(P.net, s, null, null, null, o);
  return o;
}

/* The one seam a caller actually uses - wired into step() in place of
   loopFlowK(), which is gone.

   The live solve is run with RAW, un-throttled heads - loopPumpCap()
   straight, however much spare capacity that is - because a linear network
   can legitimately draw MORE current through a group than pure capacity
   bookkeeping predicts: opening a junction lowers a group's effective
   resistance, so the same heads push more total flow than either loop would
   give alone. Only the solved answer can see that, so nothing is
   pre-clamped going into the live solve (contrast netCoreFrac0 above, which
   DOES pre-clamp, because every one of its groups is a guaranteed singleton
   and there is no redistribution to under-predict).

   loopFlowK()'s old min(groupSize, capacity) ceiling - a spare pump cannot
   deliver more than its own loops' bore, however much head is behind it -
   still has to be enforced, so it is applied to the live OUTPUT instead, per
   connected group (same flood-fill loopFlowK() used): a group's raw share
   is capped at (min(groupSize, capacity)/groupSize) of the group's own
   COMBINED reference (P.netRefByLoop, summed over the group) - a fraction OF
   that group's own physical magnitude, never a flat "1 unit per loop",
   because the loops are not the same length and a short loop's own share is
   a bigger absolute flow than a long loop's. This is why the ceiling is
   judged per group and not per loop: capping each loop separately against
   its own isolated reference would erase exactly the length-weighting the
   network exists to add back (see the auditor's own note on that), while
   capping the group's SUM leaves the solve's own split between the group's
   loops untouched and only bounds the total.

   Undamaged with nothing open, every group is a singleton with capacity at
   least 1, so the ceiling equals the group's own reference exactly and raw
   matches it exactly too (identical conditions to P.netRef) - the clamp is a
   no-op. Undamaged with everything open, the ceiling still equals the
   group's own reference sum exactly (capacity is still >= groupSize), and a
   solved network can only draw AS MUCH OR MORE current through more paths,
   never less, so the clamp instead becomes the answer, pinning the total to
   P.netRef exactly either way. That is what keeps this === 1 whenever
   nothing is hurt, junctions open or shut.

   A solver that quietly substituted a plausible-looking number on failure
   would be one nobody could debug, so the one guard against a NaN/negative
   bug lives here, once, on the single scalar every caller consumes - never
   inside the solver itself.

   byRun, if given, is filled by netCoreFracOf() with this tick's real
   per-run flow - step()'s pipe-animation block reads it back, keyed off the
   same run keys pipeNetwork() hands out, so a throttled leg visibly slows
   instead of every loop showing the one pooled number this used to be. */
function netFlowK(s, byRun, byP, outs){
  const n = P.loops, byLoop = {}, natLoop = {};
  netCoreFracOf(P.net, s, byLoop, byRun, null, byP, outs);
  /* The same plant with its pumps stopped, so the group ceiling below can
     bound the PUMPED share and only that. The network is linear in head, so
     the full solve is exactly the sum of this one and a pump-only one -
     which is what lets a ceiling written about pump capacity be applied to
     the pump's own contribution without a second capacity model. Cheap: the
     factorisation depends on conductance, not head, so this costs one
     assemble and one substitution and never a re-elimination. Object.create
     rather than a spread, so a tick allocates one object and not forty
     copied fields. */
  const sNat = Object.create(s); sNat.flowScale = 0;
  netCoreFracOf(P.net, sNat, natLoop);
  /* WHICH LOOPS AN OPEN VALVE POOLS TOGETHER. A fitting is a box, so this is
     the loops of the RUNS that reach it - never a stored pair of tap keys.
     A tee never appears here and does not need to: it has no gate, so
     loopMap() (layout.js) already walks straight through it and the two
     sides are one loop before this function is ever asked. What is left is
     exactly the case loopMap() deliberately refuses to merge - a gated
     valve, where whether the two loops are one is a live question. */
  const adj = Array.from({length:n}, () => []);
  for(const fid of P.net.fitIds){
    if(P.net.fitMode[fid] !== "throttle") continue;   // a relief valve is a vent, not a tie
    if(!(s.valve && s.valve[fid] > 0)) continue;
    const ls = fitLoops(fid).filter(l => l < n);
    for(let i=0;i<ls.length;i++) for(let j=i+1;j<ls.length;j++){
      adj[ls[i]].push(ls[j]); adj[ls[j]].push(ls[i]); }
  }
  const seen = new Array(n).fill(false);
  let total = 0, natTot = 0;
  for(let i=0;i<n;i++){
    if(seen[i]) continue;
    const stack=[i], group=[]; seen[i]=true;
    while(stack.length){ const u=stack.pop(); group.push(u);
      for(const v of adj[u]) if(!seen[v]){ seen[v]=true; stack.push(v); } }
    let raw=0, ref=0, up=0, nat=0;
    for(const g of group){
      raw += byLoop[g]||0;
      nat += natLoop[g]||0;
      ref += P.netRefByLoop[g]||0;
      up  += loopPumpCap(g, s.dmgParts);
    }
    /* The ceiling is a statement about PUMPS - a spare pump cannot deliver
       more than its own loops' bore - so it bounds the pumped share and is
       carried past the buoyancy the same loops develop on their own. Leave
       the thermosiphon inside it and a group with every pump dead has a
       ceiling of exactly zero, which would clamp natural circulation out of
       existence: the plant would be back to a floor that ignores the plant,
       just at 0 instead of 0.24. */
    const ceil = ref>0 ? (Math.min(group.length, up)/group.length) * ref : 0;
    total += Math.min(raw, ceil + nat);
    natTot += nat;
  }
  /* the share of this flow the plant is developing on its own, with no pump
     doing anything - the thermosiphon, MEASURED off the same solve rather
     than predicted beside it. This is what the NAT CIRC bar reads. */
  if(outs){ const nk = natTot/P.netRef; outs.nat = isFinite(nk) && nk>=0 ? nk : 0;
    /* Per-loop flow, which this function has always computed and always thrown
       away. step()'s secondary mass balance needs it: heat leaves the primary
       at each generator in proportion to the water going through that
       generator's own loop, so a throttled loop boils its own generator down
       more slowly. RAW - before the group ceiling, which is a statement about
       pumps and applies to a GROUP, not to one loop's share of it. Every
       reader normalises against the sum, so a common scale cancels. */
    outs.byLoop = byLoop; }
  const k = total/P.netRef;
  return isFinite(k) && k>=0 ? k : 0;
}

/* ══════════ A PIPE CELL AS A HITTABLE TARGET, AND A PLACE TO STAND ══════════
   A pipe cell is not a part - no LAY.parts entry, so nothing hands combatHit()
   or repairStart() (step.js) a p.x/p.y/p.w/p.h rectangle to reason about, or a
   p.name to log. These give both the same shape a part already has: an id
   ("pipe:"+x+","+y, so DMGFX's existing prefix match picks it up for free -
   see step.js), a name, a 1x1 footprint for repairNeed(), and an access flag
   built from the SAME freeAdj() (layout.js) ring test every component uses. */

// freeAdj() (layout.js) run per crossed cell and unioned, minus any cell
// that is itself part of the run - standing "on" a leak is not standing
// "beside" it, the same distinction freeAdj() already draws between a
// part's own footprint and its ring.
function pipeStandCells(cells){
  const g=occupied(null,{pipes:false}), on={}, seen={}, out=[];
  for(const [x,y] of cells) on[x+","+y]=1;
  for(const [x,y] of cells) for(const c of freeAdj({x,y,w:1,h:1},g)){
    const k=c[0]+","+c[1];
    if(on[k]||seen[k]) continue;
    seen[k]=1; out.push(c);
  }
  return out;
}

function pipeName(r){
  const loop=loopOfKey(r.key);
  const kind = r.k.toUpperCase()+" LEG"; // LABEL: display name only
  return kind + (loop!=null ? " "+(loop+1) : "");
}
/* WHICH CONNECTIONS RUN THROUGH THIS CELL - a crossing belongs to two, so this
   is a list. Used to name a broken cell after the pipe it cut. */
const pipeCellRuns = (x,y) => pipeMap().cellOwner[x+","+y] || [];

// The pseudo-part combatHit()/repairStart() (step.js) consume in place of a
// LAY.parts entry - same shape (id, name, w, h, access) so repairNeed() and
// the DMGFX log line need no second code path for a pipe. ONE CELL, so w and h
// are 1: a hit breaks one cell of one run, and a longer run is simply more
// targets for a stray round to find. isRun tells combatHit()'s weighted pick
// which scoring rule applies without duck-typing on which fields exist.
function pipeCellPart(x,y){
  if(!D.pipes[x+","+y]) return null;
  const cells=[[x,y]], stand=pipeStandCells(cells);
  const keys=pipeCellRuns(x,y);
  const nm = keys.length ? pipeName({key:keys[0], k:keys[0].split(":")[0]}) : "PIPE";
  return {id:"pipe:"+x+","+y, name:nm, w:1, h:1,
          access: stand.length>0, cells, stand, isRun:true};
}

/* Anything s.dmgParts can hold, resolved to the one shape the repair path
   reads: id, name, access. A pipe cell is not in LAY.parts, so every caller
   that looked a damage id up directly got `undefined` for one and quietly
   rendered it as a raw id that could never be reached. Three readers (the
   dispatcher, the dose rate, the damage card), one resolver. */
function dmgPart(id){
  if(typeof id!=="string" || id.indexOf("pipe:")!==0)
    return partOf(id) || null;
  const k=id.slice(5), i=k.indexOf(",");
  return i<0 ? null : pipeCellPart(+k.slice(0,i), +k.slice(i+1));
}

// The two rates combatHit() (step.js) already weighs a component's own hull
// cells by - a run gets no separate scale to fit, just this shared table.
const HITW_BASE=0.15, HITW_HULL=1.6;

// ONE CELL'S own odds of being the thing an unaimed hit finds. A component
// pays HITW_BASE once per PART regardless of its footprint; a pipe pays it
// once per CELL, which is what "give more pipe for a hit to find"
// (design-bench.js) means - and it survives better than it did, because a long
// connection is now literally more targets rather than one fatter one. The
// hull bonus is unchanged, paid at the same rate per hull-ring cell.
function runWgt(cells){
  let w=0;
  for(const [x,y] of cells)
    w += HITW_BASE + (x===0||x===GW-1||y===0||y===GH-1 ? HITW_HULL : 0);
  return w;
}
// every pipe cell on the plant, as a hittable target
function pipeCellIds(){
  const out=[]; for(const k in D.pipes) out.push("pipe:"+k); return out;
}

/* ══════════════ THE REFERENCE PLANT, BUILT BY GESTURE ══════════════
   The stock plumbing used to be a hand-written literal in D (design.js) plus
   one load-time relief seed below it plus a third copy in tools/loopgen.js -
   three descriptions of one plant, free to drift from each other and from
   what the bench's own gestures actually produce. This is the one builder
   all three collapsed into: every line here goes through an authoring call
   a player has, so "the bench can rebuild the reference plant, gesture for
   gesture" stops being a claim an auditor checks case by case and becomes
   the way the plant is made.

   It lives in pipenet.js rather than layout.js because it needs TANK_DEFAULT
   and PIPE_BORE, and pipenet.js loads after layout.js (index.html) - which
   is already why the relief seed lived here.

   IDEMPOTENT: it clears D.pipes/D.ports/D.tanks/D.fittings first, so calling it twice gives
   one plant and not two, and an auditor building an n-loop plant calls the
   same thing a RESET DESIGN button would.

   KINDS ARE NOT PASSED - not one of them, now that the surge line is three
   ordinary runs through a tee. runKindFor() (layout.js) names every stock run
   off the pair of ROLES, resolving a fitting end THROUGH the fitting. If a
   kind ever needs an explicit argument here, that is a missing RUN_KIND row
   and the row is the fix. */
/* ══ THE STOCK PLANT'S GEOMETRY IS PLACED, NOT BAKED ══
   There is no table of pixel waypoints any more, and nothing to regenerate:
   ports are CELLS and pipes are CELLS, so the reference plant is written the
   way a hand would draw it - a port beside each nozzle, then a run of cells
   between two of them. seedRun() is the one authoring call, and it does
   exactly what the bench's own pipe drag does: step one cell out of each port,
   dogleg between those two, and stamp the shapes (pipeLay(), layout.js).
   `vias` are the corners a hand would have clicked, for the two runs whose
   plainest dogleg would cross a machine. */
function seedPort(partId,dx,dy){
  const pid=addPortAt(partId,dx,dy);
  if(pid==null) console.warn("stock port refused",partId,dx,dy);
  return pid;
}
function seedRun(pa,pb,vFirst,vias){
  if(pa==null||pb==null) return;
  const ca=portCell(pa), cb=portCell(pb);
  const da=portFaceOf(pa), db=portFaceOf(pb);
  if(!ca||!cb||!da||!db) return;
  const a1=[ca[0]+DIRV[da][0], ca[1]+DIRV[da][1]];
  const b1=[cb[0]+DIRV[db][0], cb[1]+DIRV[db][1]];
  if(a1[0]===cb[0] && a1[1]===cb[1]) return;   // shell to shell: a joint, no pipe
  const stops=[a1].concat(vias||[]).concat([b1]);
  let path=[a1];
  for(let i=1;i<stops.length;i++)
    path=path.concat(pipePath(path[path.length-1], stops[i], vFirst));
  pipeLay(path, ca, cb);
}
/* ══ A NOZZLE GOES ON THE MIDDLE OF THE FACE FIRST, THEN OUTWARD ══
   `n` cells of face, nozzle `i`, `step` cells apart. The stock plant used to
   count from index 0 on every face it touched, so a one-loop plant - the one
   everybody actually looks at - had its main steam line leaving the top-LEFT
   corner of a nine-cell turbine and its condensate leaving the corner of the
   condenser. That reads as a pipe that missed the machine. Centre-first
   fixes the picture for one loop without giving up the room a four-loop plant
   needs, because the spread is the same spread walked out from the middle
   instead of in from the edge.
   Nothing about this is a hydraulic decision: WHICH face a nozzle is on still
   is (a hot leg leaves high, a cold return comes back low), and that is why
   only the along-face index moved. */
const faceMid = (n, i, step) => { const k = step || 1;
  return Math.floor((n-1)/2) + (i%2 ? -k*Math.ceil(i/2) : k*Math.ceil(i/2)); };
function buildStockPlumbing(opt){
  const loops = (opt && opt.loops) || 1;
  /* THE HULL THIS PLANT NEEDS. The engine room stands aft of the last loop
     (buildLayout()), so a four-loop reference plant is a longer ship - and it
     says so here rather than leaving its own turbine standing outside the
     skin. The player may still drag it either way afterwards. */
  D.gw = 60 + 7*(loops-1); D.gh = 34;
  for(const k   in D.pipes) delete D.pipes[k];
  for(const pid in D.ports) delete D.ports[pid];
  for(const id  in D.tanks) delete D.tanks[id];
  for(const id  in D.fittings) delete D.fittings[id];
  /* Loops 1..3's generators and pumps are PLACED parts, so they survive a
     rebuild of D and have to be torn down by hand - the same sweep
     makeLoops() did, for the same reason. Loop 0's sg0/pump0 are fixed slots
     buildLayout() places unconditionally and are never touched. */
  const placed = id => LAY && LAY.parts.some(p => p.id === id);
  for(let i=1;i<=3;i++){
    if(placed("sg"+i))   removePart("sg"+i);
    if(placed("pump"+i)) removePart("pump"+i);
  }

  /* ══ THE TANKS ══
     A STARTING DESIGN, exactly like the default rod count - not code. Every
     field is the player's (see the tank contract above); nothing anywhere
     may ask which one of these is "the HPI tank", because there is no such
     thing. Each starts from TANK_DEFAULT through mintTank() and is then set
     the way its own bench panel would set it. */
  const tank = (id,x,y,cfg) => { mintTank(id,x,y); Object.assign(D.tanks[id],cfg); };
  const fitting = (id,x,y,cfg) => { mintFitting(id,x,y); Object.assign(D.fittings[id],cfg); return id; };

  tank("hpi",1,19,{ name:"HPI TANK", col:"#5aa9d6",
    tip:"Emergency injection water, and its one line into the loop. Mount it HIGH: its own column is real head, and it only injects while it is winning against the pressure in the loop.",
    vol:57, level:100, fluid:"water",
    /* Pumped, and no nitrogen charge behind it - so it is worth exactly
       nothing in a blackout. Give it a `gas` and drop the pump and it is a
       passive accumulator, which is the one injection path a blackout does
       not kill. That choice is a knob on THIS tank, not a global flag about
       a named one. */
    gas:null, pump:{p:11.0, bus:"bkp"}, check:true, auto:"manual", burst:null});

  tank("reltk",23,0,{ name:"RELIEF TANK", col:"#8a6cd0",
    tip:"Catches what the relief valve vents. It fills as the valve passes flow, and a full tank is a place a repair party would rather not stand.",
    vol:35, level:0, fluid:"contaminated",
    /* At rest the gas sits at containment pressure, which is what makes an
       empty tank cost the relief path exactly nothing. frac is 25/23 because
       the law this replaces compressed at 0.92 per unit level, and
       1/0.92 = 25/23. */
    gas:{p0:0.15, frac:25/23}, pump:null, check:false, auto:"always",
    burst:{at:1.4, drain:6.0, rel:0.004}});

  /* BESIDE THE FEED PUMP, TIED INTO THE FEEDWATER LINE. It used to have its own
     nozzle on generator 1 and its own line across the ship, which is a lane
     every added loop needs and a second nozzle in the one gap that has no room
     for one. On the line it reaches whatever the feed pump reaches - which is
     what an emergency feedwater tie IS. */
  tank("efw",26+7*loops+Math.max(3,loops)+1,18,{ name:"EFW TANK", col:"#5aa9d6",
    tip:"Independent feedwater reserve and pump, tied into the feedwater line. It starts on LOW GENERATOR LEVEL, not on being armed - an emergency pump feeding a healthy generator overfills it.",
    vol:19, level:100, fluid:"condensate",
    /* Its own pump, on the backup bus, at a real discharge pressure. 8.0 MPa
       clears a generator's shell at any level it can be needed at; what keeps
       it shut on a healthy plant is its AUTORULE, not its pressure, because
       "starts on LOW GENERATOR LEVEL, not on being armed" is a rule and not a
       coincidence of numbers. */
    gas:null, pump:{p:8.0, bus:"bkp"}, check:false, auto:"sglow", burst:null});

  /* No cell: a SECONDARY tank has no node, so it needs none, and the hotwell
     lives inside the condenser it condenses into. Giving it a box would be
     inventing hydraulics the secondary does not have. */
  tank("hotwell",null,null,{ name:"HOTWELL", col:"#5aa9d6",
    tip:"Condensate returning from the condenser, and what the feed pumps draw on. A tube rupture puts primary water in here and it has to go somewhere.",
    /* Half again what the generators themselves hold - it has to be able to
       take a generator's WHOLE charge back plus what an emergency reserve
       pushes through it, or the answer to losing feedwater is to overflow the
       condensate over the side. */
    vol:83, level:50, fluid:"condensate",
    gas:null, pump:null, check:false, auto:"always", burst:null});

  /* ══ THE FITTINGS ══
     A STARTING DESIGN, exactly like the tanks: every field is the player's,
     and nothing anywhere may ask which one of these is "the surge tee". */
  const tee0 = fitting("tee0",20,14,{ name:"SURGE TEE", mode:"tee", bore:1,
    tip:"The junction where the pressurizer meets the loop. A tee costs nothing and closes nothing - it is one node with four faces." });
  const rv0  = fitting("rv0",20,2,{ name:"RELIEF VALVE", mode:"relief", bore:boreK("relief"),
    tip:"Lifts on pressure and blows the loop down through whatever is piped behind it. Pipe its outlet to a tank, or it vents straight into the room." });
  /* ONE SAFETY VALVE PER GENERATOR, on its steam nozzle - a real plant has
     them per machine and so does this one. It is the SAME relief fitting the
     pressurizer has; what makes it a secondary valve is only where it was
     placed, which is what shellsOf() (layout.js) reads back. There is no
     invisible lid: a shell with nothing fitted to relieve it bursts, so the
     reference plant has to carry the thing it teaches. It taps the NOZZLE and
     is not spliced into the main steam line: a valve in the line would be shut
     off with the line, which is the one case it exists for. */
  const svTip="The steam generator's own safety valve. It lifts on SHELL pressure and blows steam to atmosphere - the water goes with it and does not come back, so a shell held on its valve boils itself dry. Without one the shell bursts instead. It stands against the skin, so what it blows goes outside; move it inboard and the same steam lands in the engine room.";

  /* ══ EVERY LOOP'S MACHINERY, THEN EVERY LOOP'S PLUMBING ══
     Loop 0 used to be laid first and the rest bolted on afterwards, which is
     why its own main steam line ran down the row every other loop needed and
     an added generator could not reach the turbine at all. The generators and
     the pumps go on the board FIRST - so buildLayout() knows how far aft the
     engine room stands - and then one pass lays the same six runs per loop. */
  const X = i => 26+7*i;                     // a loop's own column
  const AFT = 46+7*(loops-1), FEEDX = 26+7*loops;
  for(let i=1;i<loops;i++){
    placePart(() => ({id:"sg"+i, name:"STEAM GEN "+(i+1), w:3, h:6, x:X(i), y:5,
      col:"#5fd2e2", grp:"loop"+i, tip:"", role:"sg"}));
    placePart(() => ({id:"pump"+i, name:"RCP "+(i+1), w:3, h:5, x:X(i), y:18,
      col:"#57d38c", grp:"loop"+i, tip:"", role:"pump"}));
  }
  /* ══ ONE MAIN STEAM HEADER, ONE TEE PER GENERATOR ══
     A line per generator cannot be drawn: the safety valves must stand on the
     top hull, so they own the two rows a second and third steam lane would
     need. A header is what the real machine has anyway, and it is built out of
     the fitting the bench already hands you. The tee stands two rows over its
     own generator, so its BOTTOM port faces the steam nozzle across a cell
     boundary - two ports facing each other are a joint and need no pipe - and
     its TOP port carries the safety valve the same way. */
  // where the emergency reserve meets the feedwater line, one cell forward of
  // the feed pump's own column so it is on the lane whatever the loop count
  const efwtee = fitting("efwtee", FEEDX, 12, { name:"EFW TIE", mode:"tee", bore:boreK("feed"),
    tip:"Where the emergency reserve meets the feedwater line. A tee closes nothing: the reserve waits behind its own check valve until the line pressure falls under it." });
  const mstee=[], svf=[];
  for(let i=0;i<loops;i++){
    mstee[i]=fitting("mstee"+i, X(i)+1, 2, { name:"STEAM TEE "+(i+1), mode:"tee", bore:boreK("steam"),
      tip:"Where this generator's steam meets the main header, and where its safety valve stands." });
    /* ONE CELL CLEAR OF THE TEE, not against it: two ports in adjacent cells
       are a joint only when they FACE each other, and this valve's own port
       looks along the hull rather than down at the tee. The cell between them
       is the tap. */
    svf[i]=fitting("sv"+i, X(i)+3, 0, { name:"SG SAFETY "+(i+1), mode:"relief", bore:0.55, tip:svTip });
  }
  buildLayout();                     // the boxes have to be on the grid before a port can sit beside one

  /* ══ THE PORTS AND THE RUNS ══
     Order matters only in one place: a run laid over an existing straight at
     right angles becomes a CROSS, so the line that goes through is laid first
     and the line that crosses it second. */
  /* THE CORE'S OWN NOZZLES, one cell apart along the faces its ROLE
     whitelists - the hot legs up the right side, the injection line and every
     cold return along the bottom. Spread rather than stacked, because a port
     is a CELL now and two of them cannot share one. */
  /* ONE ROW PER LOOP, ADJACENT. Two cells apart put loop 3's hot leg on row 20,
     which is the pumps' own band - a lane that cannot be laid at all. Adjacent
     rows give four lanes between the vessel and the pumps, and the run is what
     needs the room, not the nozzle. */
  /* ══ ONE LANE PER RUN, AND THE TABLE IS THE PROOF ══
     Between the shells and the pumps there are seven rows, and eight lines
     want one: four hot legs and four feedwater lines. Row 14 carries two
     because loop 0's hot leg is three cells long and stops at the surge tee,
     west of where any feed line begins - the one legal overlap on the board.
     A lane that shares a row with anything else MERGES with it, which is how a
     hot leg came to land on a generator's feedwater nozzle.
     FEED_ROW starts at 12: row 11 carries every generator's own cold-leg
     nozzle, and a lane laid across a port cell stops dead at it. */
  /* loop 3 leaves the vessel at its FLOOR: row 13 is blocked at one cell by
     the surge tee's own nozzle, and one port cell stops a lane as dead as a
     machine does. */
  const HOT_ROW =[14,15,16,24];      // out of the vessel, east to its own riser
  const HOT_COL =[null,29,36,43];    // the gap forward of the generator
  const FEED_ROW=[12,14,16,15];      // from the feed pump, west to its own riser
  const feedCol = i => X(i)+5;       // the column it climbs, two clear of the shell
  const COLD_ROW=[26,27,28,29];      // one bilge row per loop
  const KEEL=GH-1;
  const coreHot  = i => seedPort("core",9,HOT_ROW[i]-13);
  // centred on the vessel's own floor, two cells apart
  const coreCold = i => seedPort("core",faceMid(9,i,2),12);
  const coreBilge = i => 6+faceMid(9,i,2);      // the cell that return lands under
  const pCoreHot  = coreHot(0);
  /* dx 1, not the corner: the fourth cold return IS the corner (faceMid spreads
     4,2,6,0), and two ports cannot share a cell - so a four-loop plant used to
     lose its injection line to its own last loop. */
  const pCoreHpi  = seedPort("core",1,12);
  const pPzrSurge = seedPort("pzr",1,6);
  const pPzrRel   = seedPort("pzr",3,1);
  const pTeeL     = seedPort(tee0,-1,0);
  const pTeeT     = seedPort(tee0,0,-1);
  const pTeeR     = seedPort(tee0,1,0);
  const pRvL      = seedPort(rv0,-1,0);
  const pRvR      = seedPort(rv0,1,0);
  const pRelTk    = seedPort("reltk",-1,2);
  const pHpi      = seedPort("hpi",3,2);
  const pEfw      = seedPort("efw",0,-1);      // out of the top, up and along into the tie
  // ONE steam nozzle, because there is one main steam HEADER - see the tees below
  const pTurbT    = seedPort("turb",4,-1);
  const pTurbB    = seedPort("turb",faceMid(9,0),7);
  const pCondT    = seedPort("cond",faceMid(9,0),-1);
  const pCondR    = seedPort("cond",9,faceMid(5,0));
  /* THE COOLING CIRCUIT. A panel is plumbed now, so the condenser's water side
     runs down into it and the two are their own connected component - which is
     all "COOLING" means. The second panel ships as a SPARE with no nozzle: it
     still radiates, because radArea() is geometry, and the bench can pipe it.
     There is no circulating-water pump in the stock loadout, so the circuit
     solves at zero flow: legal, and exactly what a plant that never bought one
     should read. */
  const pCondCwO  = seedPort("cond",-1,4);
  const pRad0L    = seedPort("rad0",-1,1);
  const pRad0R    = seedPort("rad0",5,1);
  const pRad1L    = seedPort("rad1",-1,1);
  const pRad1R    = seedPort("rad1",5,1);
  const pCondCwI  = seedPort("cond",4,5);
  // one discharge nozzle per generator - the pump is as wide as it has loops
  const feedT     = i => seedPort("feed",i,-1);
  /* dx 0, not the middle: the condensate rises in this port's OWN column, and
     the middle of the pump is exactly the column the cooling water has to turn
     down in on its way to the panels - two runs, one corner, and the second
     one silently butts. */
  const pFeedB    = seedPort("feed",0,5);

  /* THE HOT NOZZLE SITS LOW ON AN ADDED LOOP. ROLE.sg gives the primary ONE
     left-face port, so the run has to reach that cell and no other - and the
     cell beside the shell's top is reachable only up the column the feed line
     rises in, which merges the two. Low, the hot leg comes in along the row
     under the generators, which is the one band nothing else crosses. */
  /* THE HOT NOZZLE SITS LOW ON AN ADDED LOOP. ROLE.sg gives the primary ONE
     left-face port, so the run has to reach that cell and no other - and the
     cell beside the shell's top is reachable only up the column the feed line
     rises in, which merges the two. Low, the hot leg comes in along the row
     under the generators, which is the one band nothing else crosses.
     Loop 0 keeps the high nozzle: its hot leg arrives from the surge tee. */
  const sgPorts = i => ({
    l:     seedPort("sg"+i,-1,1),
    b:     seedPort("sg"+i,1,6),
    steam: seedPort("sg"+i,1,-1),
    feed:  seedPort("sg"+i,3,0),
  });
  /* ══ ONE LANE PER RUN, AND THE TABLE IS THE PROOF ══
     Between the shells and the pumps there are seven rows, and eight lines
     want one: four hot legs and four feedwater lines. Row 14 carries two
     because loop 0's hot leg is three cells long and stops at the surge tee,
     west of where any feed line begins - the one legal overlap on the board.
     A lane that shares a row with anything else MERGES with it, which is how a
     hot leg came to land on a generator's feedwater nozzle. */
  seedRun(pCoreHot, pTeeL);                       // the hot leg out of the vessel
  seedRun(pPzrSurge, pTeeT);                      // the surge line, down onto the tee
  seedRun(pPzrRel, pRvL);                         // relief: vessel to valve...
  seedRun(pRvR, pRelTk);                          // ...and valve to tank
  seedRun(pHpi, pCoreHpi, true);                  // injection, onto the vessel's floor
  seedRun(pTurbB, pCondT, true);                  // exhaust
  seedRun(pCondR, pFeedB, false, [[AFT+10,KEEL],[FEEDX,KEEL]]);   // condensate, along the keel
  /* AFT OF THE LAST PUMP, so it never meets a bilge run: the engine room moves
     back with the loop count and the cold returns do not. */
  seedRun(pCondCwO, pRad0L, false, [[AFT-2,29],[AFT-12,29]]);   // circulating water out to the first panel
  seedRun(pRad0R, pRad1L);                        // ...through the second, in series...
  seedRun(pRad1R, pCondCwI);                      // ...and back into the condenser's water side

  /* ══ ONE PASS, ONE LOOP AT A TIME ══
     Six runs each, and the same six whether the loop is the fixed slot or a
     placed pair - which is what makes "the bench can rebuild this, gesture for
     gesture" true of a four-loop plant and not just of the reference one. */
  const pTieL = seedPort(efwtee,-1,0), pTieR = seedPort(efwtee,1,0), pTieB = seedPort(efwtee,0,1);
  let prevTeeR = null;
  for(let i=0;i<loops;i++){
    const g = sgPorts(i);
    const pT = seedPort("pump"+i,1,-1), pB = seedPort("pump"+i,1,5);
    const teeB = seedPort(mstee[i],0,1), teeT = seedPort(mstee[i],0,-1);
    const teeL = i? seedPort(mstee[i],-1,0) : null;
    const teeR = seedPort(mstee[i],1,0);
    const pSv  = seedPort(svf[i],-1,0);
    // primary: vessel to shell, shell to pump, pump back along its own bilge row
    if(i) seedRun(coreHot(i), g.l, false, [[HOT_COL[i],HOT_ROW[i]],[HOT_COL[i],6]]);
    else  seedRun(pTeeR, g.l, true);
    seedRun(g.b, pT, true);
    seedRun(pB, coreCold(i), false, [[X(i)+1,COLD_ROW[i]],[coreBilge(i),COLD_ROW[i]]]);
    // secondary: the nozzle faces the tee's own port across one cell - a joint,
    // no pipe - and so does the safety valve above it
    seedRun(g.steam, teeB);
    seedRun(teeT, pSv);
    if(prevTeeR) seedRun(prevTeeR, teeL);         // ...and the header, tee to tee
    prevTeeR = teeR;
    /* LOOP 0'S FEED LINE IS THE ONE THE RESERVE IS TIED INTO, so it is two
       runs through the tie rather than one straight through it. */
    if(i) seedRun(feedT(i), g.feed, false, [[FEEDX+i,FEED_ROW[i]],[feedCol(i),FEED_ROW[i]],[feedCol(i),5]]);
    else { seedRun(feedT(0), pTieB);
           seedRun(pTieL, g.feed, false, [[feedCol(0),FEED_ROW[0]],[feedCol(0),5]]); }
  }
  // the header's aft end, down onto the turbine's one steam nozzle
  seedRun(prevTeeR, pTurbT, false, [[AFT+4,2]]);
  seedRun(pEfw, pTieR, false, [[FEEDX+Math.max(3,loops)+1,12]]);   // the reserve, up and into the tie

  buildLayout();
}
buildStockPlumbing();

/* ══ WHOLE PLANTS YOU CAN START FROM ══
   ARCHPRE buys a reactor and redraws its core; this buys the SHIP around it.
   Every field below is either a plain D write a bench panel already makes or a
   call the bench already has - archPreset(), latPreset(), buildStockPlumbing()
   - so a preset cannot describe a plant the player could not have built.

   It lives here rather than in lattice.js for the reason buildStockPlumbing()
   does: it is mostly plumbing. archPreset() resolves at CALL time, so lattice.js
   loading after this file (index.html) costs nothing.

   `lat` is only ever given to a family that lays no moderator blocks - latPreset()
   does not call latLayMod(), so handing it to RBMK or HTGR would quietly take
   the graphite back out. */
const PLANTPRE=[
 ["NUSCALE",{loops:1,arch:0,lat:1,d:{cont:1,bkp:1,sg:0,pzr:0.8,chim:0.5}},
  "A small compact PWR module: one loop, a tall tight core, a suppression pool and a battery. Light, cheap and slow to bite. The real module circulates by itself and has no pump at all; this one keeps its RCP."],
 ["BWR/4",{loops:2,arch:1,d:{cont:1,bkp:1,sg:0,pzr:0.7,chim:0.4}},
  "Two recirculation loops boiling at 7 MPa - the Fukushima Daiichi machine. Power follows flow instantly and margin to dryout is thin, so it will not forgive a flow transient the way a pressurised plant does."],
 ["BN-600",{loops:3,arch:3,d:{cont:2,bkp:2,sg:1,pzr:0.6,chim:0.4}},
  "Three primary sodium loops at atmospheric pressure, once-through steam generators, diesels and a large dry containment. Enormous boiling margin and a prompt lifetime forty times shorter than water - it answers a rod before you have finished moving it."],
 ["EPR",{loops:4,arch:0,lat:2,d:{cont:2,bkp:2,catcher:true,sg:0,pzr:1.3,chim:0.3}},
  "Four loops round a wide squat core, large dry containment, diesels and a core catcher. The heavy one, and the one with margin everywhere: low peaking, high DNBR, minutes of generator water after feedwater is lost."],
 ["RBMK-1000",{loops:2,arch:2,d:{cont:0,bkp:1,sg:1,pzr:1.0,chim:0.3}},
  "Two coolant loops through a graphite pile, gravity scram and no containment - because the real one had none that would hold. Boiling the water ADDS reactivity here, so the plant hunts itself and the slow rods arrive late."],
 ["MSRE",{loops:1,arch:4,d:{cont:1,bkp:1,sg:1,pzr:0.5,chim:0.6}},
  "Molten salt through a graphite matrix at no pressure at all, one loop, once-through boiler. Almost no xenon pit and hours of grace; what it will do instead is freeze solid if you let it get cold."],
 ["WINDSCALE",{loops:1,arch:5,d:{cont:0,bkp:0,sg:1,pzr:0.5,chim:0.2},
   tanks:{hpi:{gas:null,pump:null,vol:12},reltk:{vol:8},efw:{vol:5}}},
  "A graphite pile with no containment, no backup power and an injection tank that has nothing behind it to push with. It runs perfectly well and every single fault is uncovered - lose the bus and the pumps stop, lift the relief and the tank is full, and the water you would inject with will not move. Fly it to see what the safeguards on every other preset are FOR."],
];
function plantPreset(i){
  const q=PLANTPRE[i][1];
  archPreset(q.arch);                    // buys the materials and redraws the core
  if(q.lat!=null) latPreset(q.lat);
  Object.assign(D,q.d);
  buildStockPlumbing({loops:q.loops});   // tears the old loops down and lays the new ones
  for(const id in (q.tanks||{})) if(D.tanks[id]) Object.assign(D.tanks[id],q.tanks[id]);
  dTouch();
  LAY=null; layoutMetrics();             // re-fit the arrangement once, not per gesture
}
