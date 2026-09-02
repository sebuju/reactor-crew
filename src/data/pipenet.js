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
const PIPE_BORE_MM = {hot:750, cold:750, cw:750, feed:1125, surge:225, hpi:187.5, relief:150, boron:150};
const boreMm = kind => PIPE_BORE_MM[kind] !== undefined ? PIPE_BORE_MM[kind] : BORE_REF;
/* ══ THE ONE CONVERSION BETWEEN MILLIMETRES AND THE SOLVE'S OWN BORE ══
   Every conductance in this file is written in a dimensionless bore against
   BORE_REF. Every MACHINE states millimetres. This is the one place the two
   meet - never a second table, and never a second unit on a second
   component: a fitting used to state its bore as a fraction of a full-bore
   leg while the pipe it sat in stated millimetres, which is two units for
   one quantity on two things a player places side by side. */
const boreK = kind => boreMm(kind)/BORE_REF;
/* A FITTING'S OWN BORE, mm, and the same figure the solve wants. P is the
   commissioned snapshot and D is the bench - the P?fallback:D idiom
   reliefSet() (step.js) uses, because a fitting resized after commissioning
   must not move the plant that is running. */
const fitBoreMm = fid => { if(BORE_NOM) return FIT_DEFAULT.bore;
  const f = (typeof P!=="undefined" && P) ? P.fittings : D.fittings;
  return (f && f[fid] && f[fid].bore) || FIT_DEFAULT.bore; };
const fitBoreK  = fid => fitBoreMm(fid)/BORE_REF;
/* This table is a set of DEFAULTS, not permissions: every run carries
   conductance whether or not its kind has a row here (see netBuild()'s single
   edge loop, below) - PIPE_BORE_MM only ever picks the STARTING bore a fresh
   run of that kind gets, and D.bore[key] is the player's own choice.
   steam, feed and exh still have no row, and that is now a decision rather
   than an omission. A feedwater line really is narrower than a hot leg, but
   what a feed pump's head is actually spent on is its REGULATING TRAIN, and
   that is priced explicitly (FEED_LEN, above) rather than smuggled into a
   bore - so narrowing the pipe as well would charge the same restriction
   twice. Steam and exhaust DO carry a solved
   flow now, but their bore is a MULTIPLIER on a per-kind anchor (vapPipeKv,
   below) rather than a duct area: a real exhaust neck is a room and a real
   main steam line is a pipe, and one figure here cannot be both.
   Route every bore read through this resolver, never PIPE_BORE_MM[r.k]
   directly, or the fallback lives in two places and can disagree. */
/* ══ AND THE REFERENCE PLANT IS PIPED AT THE NOMINAL BORE ══
   P.netRef used to be solved on the SAME pipes the plant is drawn with, so
   every bore cancelled against itself: a cold leg narrowed 750 -> 300 mm
   moved netFlowK by 2e-4 and the plant ran on regardless. The reference is
   this plant's arrangement piped at the bore each run and each fitting SHIPS
   at; deviating from it is what the solve then charges for. Layout, gates,
   lengths and pumps are untouched by the flag, so everything except bore
   still cancels exactly as before, and a plant nobody has re-bored reads 1. */
let BORE_NOM = false;
const withNomBore = fn => { BORE_NOM = true; try { return fn(); } finally { BORE_NOM = false; } };
const runBoreMm = r => (!BORE_NOM && D.bore && D.bore[r.key] !== undefined) ? D.bore[r.key]
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
   ══ AND IT IS GEOMETRY NOW, NOT THREE FITTED COEFFICIENTS ══
   PIPE_MASS_K, PIPE_WALL_P0 and SEC_RATE were one fitted rate, one pressure
   proxy and one flat secondary figure - and there was no wall thickness
   variable anywhere in the repo, so a pipe's wall could only ever be half its
   own bore in the drawing and a coefficient in the mass. Both are real
   millimetres now and the mass is the shell they describe.
   STEEL_S and STEEL_RHO are published figures, against three fitted ones
   deleted, and COOLANT[].pipeK stops being a mass multiplier: it is a
   MATERIAL PENALTY ON ALLOWABLE STRESS, so a sodium or salt line needs a
   better alloy, needs more wall for the same pressure, and then costs more
   mass BECAUSE IT IS THICKER. WALL_CORR is the corrosion and handling
   allowance - what PIPE_WALL_P0's own comment was already reaching for. */
const STEEL_RHO = 7850;    // kg/m^3
const STEEL_S   = 138;     // MPa allowable stress, carbon steel at temperature
const STEEL_A   = 1.8e-5;  // 1/K linear expansion, austenitic steel
const WALL_CORR = 3;       // mm of corrosion/handling allowance under any pressure
// every kind that carries the primary coolant. Wider than layoutMetrics()'s
// `pipe` bucket on purpose: that one asks what is in the LOOP hydraulically,
// so a shut relief leg is dead there, and it still holds sodium.
const PRIMARY_K = {hot:1, cold:1, surge:1, hpi:1, relief:1, boron:1};
// Barlow, the published thin-wall hoop relation: t = P*D/(2*S).
const wallSuggestMm = (boreMm, pMPa, c) =>
  pMPa*boreMm/(2*STEEL_S/((c&&c.pipeK)||1)) + WALL_CORR;
/* What a run is HELD AT, MPa - the circuit's own setpoint where something
   authors one, the secondary's design shell pressure otherwise. A run that
   pays for pressure at all is the whole of bug 1: pipeWallK() read the
   coolant NOMINAL, so raising design pressure bought the vessel 220 t and
   the pipes nothing. */
/* ══ AND A FEED LINE IS RATED FOR THE PUMP, NOT FOR THE SHELL ══
   The secondary's number was the shell's design pressure alone, so the stock
   condensate line was walled for 6.9 MPa while its own feed pump discharges
   into that shell at 10.0 - it is the pump's head that the pipe between them
   holds. Nothing noticed while a wall was only a mass; a run that BURSTS
   (step.js) cut the stock plant's feed line in 4 s. The GREATER of the two,
   never the sum: a feed pump's head is already the whole lift out of a
   condenser at 0.01 MPa, so adding it to the shell counts that lift twice and
   walls the condensate line at 16.8 MPa. Asked of the drawing (secGensOf())
   like every other question about what a pump is for. */
const feedHeadMax = () => { let h = 0;
  for(const id of pumpIds()) if(secGensOf(id).length) h = Math.max(h, pumpHead(id));
  return h; };
const runDesignP = r => PRIMARY_K[r.k] ? holdSetP(nodeGraph().coreCirc)
                                       : Math.max(sgDesignP(), feedHeadMax());
const runWallMm = r => (D.wall && D.wall[r.key] !== undefined) ? D.wall[r.key]
                     : wallSuggestMm(runBoreMm(r), runDesignP(r),
                                     PRIMARY_K[r.k] ? COOLANT[D.cool] : null);
// t/m of a cylindrical shell: pi * mean diameter * wall * density
const shellTPerM = (boreMm, wallMm) =>
  Math.PI*(boreMm+wallMm)/1000*(wallMm/1000)*STEEL_RHO/1000;
const runMassPerM = r => shellTPerM(runBoreMm(r), runWallMm(r));
/* ══ AND THE VESSEL WEIGHS ITS OWN WALL TOO ══
   The lattice's own envelope plus a downcomer annulus, at the wall Barlow
   says the setpoint needs. VESSEL_CLR is the gap between the outer fuel and
   the shell, in metres of radius; VESSEL_HEAD_K is how much thicker a head
   is than the side, both real figures rather than fitted ones. */
const VESSEL_CLR = 0.55, VESSEL_HEAD_K = 1.6;
function vesselShellMass(p0, c){
  const L = (typeof latRevolve === "function") ? latRevolve() : null;
  const dM = ((L && L.dia) || 3) + 2*VESSEL_CLR, hM = ((L && L.hgt) || 4) + 2*VESSEL_CLR;
  const w = wallSuggestMm(dM*1000, p0, c)/1000;
  const area = Math.PI*dM*hM + 2*(Math.PI/4)*dM*dM*VESSEL_HEAD_K;
  return area*w*STEEL_RHO/1000;
}

// The head the network was linearised about, in MPa - so it is what a pump
// nobody has sized SUGGESTS (pumpHeadSuggest(), layout.js) and nothing else.
// Fitted once and stated as such - the RAD_K / BREAK_K idiom - at the head a
// real reactor coolant pump makes, because the solve is ABSOLUTE now: every
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
   its anchor moves with the primary setpoint; water's is a constant and lives here. */
/* A CURVE MAY BE A POWER LAW OR AN ANTOINE, AND IT SAYS WHICH BY CARRYING A.
   A two-anchor power law cannot hold water's shape: fitted at 0.01 and 6.9 MPa
   it read 602.7 K at 17 MPa against a real 625.9, and 17 MPa is where every
   high-temperature family's shell sits (SG_P_MAX). Antoine holds the whole
   range to 1.8 K and still inverts in closed form, which is what lets the
   shell be a pot. The primary curves stay the power law: each is anchored on
   its own fluid's boiling point over a narrow span, and coolSatN() derives the
   exponent from Clausius-Clapeyron. */
const satT = (c,p) => c.A ? c.C + c.B/(c.A - Math.log(Math.max(p,c.pFloor)))
                          : c.T0*Math.pow(Math.max(p,c.pFloor)/c.p0, c.n);
const satP = (c,T) => c.A ? Math.exp(c.A - c.B/Math.max(T-c.C, 1))
                          : c.p0*Math.pow(Math.max(T,c.TFloor)/c.T0, 1/c.n);
// dp/dT along that same curve, exact rather than differenced - a boiling
// primary is pressurised by its own temperature rate (step.js)
const satSlope = (c,p) => { const q = Math.max(p,c.pFloor);
  if(!c.A) return q/(c.n*satT(c,q));
  const d = Math.max(satT(c,q)-c.C, 1); return q*c.B/(d*d); };

/* ══ THE SECONDARY IS WATER, WHATEVER THE PRIMARY IS ══
   The PRIMARY curve is anchored on that architecture's own boiling point -
   sodium at 1150 K, salt at 1700 K. The shell is full of water on every plant,
   so it gets its own anchors: saturated steam at 6.9 MPa is 558 K. It inverts,
   which is what lets the shell be a pot: temperature in, pressure out.
   The exponent is fitted across the range this plant actually uses rather than
   copied off the primary curve: 6.9 MPa/558 K and 0.01 MPa/319 K are both real
   steam-table points, and 0.10 could not hold both - it put a condenser under
   vacuum at 290 K, which is colder than the river it rejects into. */
/* A CURVE WITHOUT ITS OWN hfg IS HALF A FLUID. `hfg` is the LATENT HEAT at the
   curve's own anchor - 1509 kJ/kg at 6.9 MPa, a steam-table figure. It used to
   be documented as "feedwater to saturated steam", which is 1843 at that
   anchor, and four call sites spent it as if it were. Both quantities exist
   below and neither is the other: hfgOf() is latent, hRise() is the rise. */
/* cp is CP_W (step.js) on BOTH curves, because that is the one specific heat
   this model already prices every loop's inventory at (loopKg()*CP_W). A curve
   with a cp of its own that disagreed with the pot integrating against it
   would be two answers to one question. It is water's value near the 6.9 MPa
   anchor and is flat everywhere else, which is a real error at 17 MPa (5.5
   against 8.6) and is NOT fixed here - it is aliased into the primary's own
   inventory and the core's enthalpy walk, so it is a job of its own. */
/* tc is the critical temperature, the one place latent heat and liquid density
   both have to go to a known value; A/B/C are Antoine, fitted to the real
   steam-table points at 0.004, 6.9 and 17 MPa. */
const SAT_WATER = {A:9.844309, B:4174.5246, C:30.4331, tc:647.096,
                   p0:6.9, T0:558, n:0.0855, pFloor:1e-4, TFloor:1,
                   hfg:1509, rho:740, cp:5.5};
/* WHERE FEEDWATER ARRIVES, K. It lives with the fluid rather than in step.js
   for the reason CORE_DT0 below does: layout.js is asked for plantSteam()
   during buildStockPlumbing(), at module load, when a const in step.js has not
   been initialised yet - a real ReferenceError, not a style point. */
const T_FEED = 490;
/* ══ LATENT HEAT FALLS TO ZERO AT THE CRITICAL POINT ══
   Watson's relation, published, with its own 0.38 exponent - the one thing a
   flat 1509 could not do. It was 76 % high at 17 MPa and 38 % low at condenser
   vacuum, both on the same constant. A curve with no tc has no second point to
   fall to, so it keeps its scalar: the primary fluids state a real hfg per row
   already (COOLANT, design.js) and none of them is asked near its own
   critical point. */
const WATSON = 0.38;
const hfgOf = (c,T) => c.tc ? c.hfg*Math.pow(clamp((c.tc-T)/(c.tc-c.T0),0,6), WATSON)
                            : c.hfg;
/* AND SO DOES THE DIFFERENCE BETWEEN THE TWO DENSITIES. Same shape, same
   reason, and the exponent is the published critical one. 740 kg/m3 flat was
   water at the 6.9 MPa anchor and 34 % heavy at 17 MPa, which sized every
   shell's steam space off the wrong fluid. */
const RHO_CRIT = 322, RHO_N = 0.35;
const rhofOf = (c,T) => c.tc
  ? RHO_CRIT + (c.rho-RHO_CRIT)*Math.pow(clamp((c.tc-T)/(c.tc-c.T0),0,6), RHO_N)
  : c.rho;
/* THE CORE'S DESIGN TEMPERATURE RISE, K. It belongs with the fluid rather
   than in step.js because layout.js's pump-flow suggestion is asked during
   buildStockPlumbing(), at module load, when a const in step.js has not been
   initialised yet - a real ReferenceError, not a style point. */
const CORE_DT0 = 30;
/* ══ ENTHALPY, ON THE CURVE THE CIRCUIT ACTUALLY CARRIES ══
   Specific enthalpy, kJ/kg, measured from H_DATUM. Three straight lines: a
   subcooled liquid rising at cp, a flat two-phase shelf that costs hfg to
   cross, and superheat rising at cp again. That is enough to MIX honestly -
   which is the whole point - without a steam table this game has no use for.
   satH()/satHg() are the two ends of the shelf at a stated pressure. */
const H_DATUM = 273.15;
const satH  = (c,p) => c.cp*(satT(c,p) - H_DATUM);
const satHg = (c,p) => satH(c,p) + hfgOf(c, satT(c,p));
/* ══ WHAT IT COSTS TO TURN A KILOGRAM OF FEEDWATER INTO STEAM ══
   Latent heat is NOT this and never was: at 6.9 MPa the rise is 1843 against a
   latent 1509, and the gap is the sensible heat from T_FEED up to saturation.
   Four call sites spent `hfg` on this question - the shell's steam term, the
   condenser's heat in, plantSteam() and ratedSteam() - and the comment beside
   each said the constant already spanned it. It did not. */
const hRise = (c,p) => satHg(c,p) - hOfT(c, T_FEED);
// what a fluid at this temperature is worth, taken as liquid: the seed and
// the way a pot's temperature enters the field
const hOfT  = (c,T) => c.cp*(T - H_DATUM);
/* And back. Below the shelf and above it a temperature is what the enthalpy
   says; ON the shelf every enthalpy is the same temperature, which is exactly
   what saturation means. */
const tOfH  = (c,p,h) => { const hf=satH(c,p);
  if(h <= hf) return H_DATUM + h/c.cp;
  const hg=hf+hfgOf(c, satT(c,p));
  return h >= hg ? satT(c,p) + (h-hg)/c.cp : satT(c,p); };
/* STEAM QUALITY - the share of the mass that is vapour. Below the shelf it is
   0, above it 1, and in between it is where on the shelf you are. Nobody
   declares this anywhere: it falls out of what flowed in. */
const xOfH  = (c,p,h) => { const hf=satH(c,p);
  return clamp((h-hf)/Math.max(hfgOf(c, satT(c,p)), 1e-6), 0, 1); };
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
/* Latent heat on that circuit's own curve, at the pressure it is at - a
   PRESSURE now, because latent heat is not a constant of a fluid. */
const hfgOfCirc  = (ci,p) => { const c=satOfCirc(ci); return hfgOf(c, satT(c,p)); };
/* And the feed-to-steam rise on the same curve. The shell and the condenser
   want this one; nothing wants a bare hfg for a boiler duty. */
const riseOfCirc = (ci,p) => hRise(satOfCirc(ci), p);
/* ══ PRESSURE IS A PROPERTY OF THE CIRCUIT TOO ══
   The move satOfCirc() already made for fluid. s.P stays the PRIMARY's entry -
   it is a named key stored scenarios and recordings address, and holding the
   primary in both s.P and s.PBy would be two writers and one truth. Every
   other circuit's setpoint lives in s.PBy, a plain object keyed by circuit
   index (the s.sglBy idiom: refilled, never rebuilt), and a circuit nothing
   authors has NO entry - it relaxes to containment, which is honest. */
const loopP    = (s, ci) => ci === nodeGraph().coreCirc ? (s.P === undefined ? P.P0 : s.P)
                          : (s.PBy && s.PBy[ci] !== undefined ? s.PBy[ci] : P.Pcont);
const setLoopP = (s, ci, v) => { if(ci === nodeGraph().coreCirc) s.P = v;
                                 else (s.PBy || (s.PBy = {}))[ci] = v; };
/* ══ WHAT A HOLD TANK SUGGESTS IT SHOULD SIT AT, MPa ══
   A real quantity in its own units, the ?? xSuggest() idiom: the coolant
   family already states the pressure it is meant to be worked at, so the
   primary's suggestion is that figure and nothing hidden. Any other circuit
   is suggested the highest saturated boundary standing on it - a generator
   shell - because that is the pressure something on that circuit is already
   built to hold, and containment where there is none. */
const holdPSuggest = ci => {
  if(ci === nodeGraph().coreCirc) return COOLANT[D.cool].P0;
  let p = 0;
  for(const id of sgIds()) if(shellCirc(id)===ci) p = Math.max(p, sgDesignP(id));
  return p || (typeof P!=="undefined" && P ? P.Pcont : 0.1);
};
// the LOWEST-id hold tank on the circuit states it - the same one netRef()
// anchors on, so the setpoint and the anchor cannot name different vessels
const holdSetP = ci => { const h = holdOnCirc(ci)[0];
  const v = h && D.tanks[h].hold && D.tanks[h].hold.p;
  return v || holdPSuggest(ci); };
/* ══ WHAT THE WEAKEST THING ON THIS CIRCUIT WILL TAKE, MPa ══
   Every run and every vessel on it derives a rating from its own wall
   (wallSuggestMm() is the inverse), so this is the minimum of those - and a
   setpoint above it is a plant built to burst somewhere. The bench SOFT-warns
   and never refuses, which is the rule the whole bench keeps. */
const runRating = r => 2*(STEEL_S/((PRIMARY_K[r.k] ? COOLANT[D.cool].pipeK : 1)))
                     * Math.max(runWallMm(r)-WALL_CORR, 0) / Math.max(runBoreMm(r), 1);
/* ══ AND WHERE IT ACTUALLY LETS GO ══
   A rating is an ALLOWABLE stress with a margin already inside it, so a pipe
   held past its rating is not a pipe that is open yet. The same sentence the
   shell makes (SG_BURST_K, step.js) and the same figure, so the two pressure
   boundaries on this plant do not each carry their own margin. Past this the
   run is cut - one cell, the hole a hit makes (pipeBurst(), step.js). */
const PIPE_BURST_K = 1.5;
const runBurstP = r => runRating(r)*PIPE_BURST_K;
const tankRating = id => 2*STEEL_S*Math.max(tankWallMm(id)-WALL_CORR, 0)
                       / Math.max(Math.cbrt(6*Math.max(D.tanks[id].vol,0.1)/Math.PI)*1000, 1);
function plantRating(ci){
  let lo = Infinity;
  for(const r of pipeNetwork()){ const ends = runEnds(r.key, r.k); if(!ends) continue;
    if(circOfNode(coreFold(ends[0])) !== ci) continue;
    lo = Math.min(lo, runRating(r)); }
  for(const id of tankIds()) if(tankCircuit(id)===ci) lo = Math.min(lo, tankRating(id));
  return isFinite(lo) ? lo : 0;
}
/* ══ HOW HARD A PRESSURE SWING IS DAMPED ══
   The steam bubble, in m^3: the vessel's own volume above the water in it. It
   was D.pzr, a 0.5-2x multiplier around a reference nobody could see; it is
   the tank's own geometry now. HOLD_VOL_REF is the stock vessel's gas space,
   so an untouched plant reads exactly 1 and commissions on the figure the old
   midpoint stood for. Zero hold tanks reads 1 too - a plant with no
   pressurizer is not a plant with an infinitely stiff one. */
const HOLD_VOL_REF = 23;                                  // m^3, the stock 50 m^3 vessel at 54 %
const holdBubbleM3 = id => { const t=D.tanks[id];
  return Math.max(0.1, t.vol*(100-clamp(t.level,0,100))/100); };
function holdDampK(){
  const h = holdTankIds();
  if(!h.length) return 1;
  let v = 0; for(const id of h) v += holdBubbleM3(id);
  return v/HOLD_VOL_REF;
}
/* EVERY CIRCUIT WITH A PRESSURE OF ITS OWN. The primary is always one of
   them, fitted or not: a plant with no pressurizer still has a programme, it
   simply has nothing holding it to it. */
function holdCircs(){
  const out = [nodeGraph().coreCirc];
  for(const id of holdTankIds()){ const ci = tankCircuit(id);
    if(ci !== null && ci !== undefined && ci >= 0 && out.indexOf(ci) < 0) out.push(ci); }
  return out;
}

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
  const base = sgDesignP(id)*Math.pow(Math.max(secLoad(s,id),.05),.25);
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
// THE REAL DESIGN DIFFERENTIAL, primary setpoint less shell design pressure -
// it was P.P0*0.55, a second fitted fraction that only ever meant "one minus
// the 0.45", so the two could drift apart with nothing to catch it
const sgtrG = () => (SGTR_RATE/100)*P.netRef*LOOP_TRANSIT/Math.max(holdSetP(nodeGraph().coreCirc)-sgDesignP(), 0.05);
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
  // ON THE TANK'S OWN CIRCUIT, never the primary's: a reserve piped to the
  // secondary was watching the reactor's pressure to decide when to open
  plow:   {label:"LOW LOOP PRESSURE", live:(s,id)=>{ const ci=tankCircuit(id);
    return loopP(s,ci) < holdSetP(ci)*0.55; }},
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
/* ══ `hold` IS WHAT MAKES A TANK A PRESSURIZER ══
   {p} MPa, or null for an ordinary tank. A hold tank's gas law is not
   consulted at all - that is what CONTROLLED means - and its node is the one
   its circuit's whole pressure field is measured from. p null means "the
   suggestion", the ?? xSuggest() idiom every other machine size follows.
   tsurv/pburst are null for the role's own figure; a heavy vessel states its
   own, through partTsurv()/partPburst(). */
const TANK_DEFAULT = {
  vol:35, level:100, fluid:"water",
  gas:{p0:4.5, frac:0.35}, check:true, auto:"manual", burst:null,
  hold:null, tsurv:null, pburst:null, aspect:1,
  /* INEXHAUSTIBLE - a level that never moves, so the tank is an infinite
     source or an infinite sink depending on what pressure is behind it. It is
     a SANDBOX INSTRUMENT (tools/sandbox.js): the one honest way to isolate a
     piece of the plant is to give it a boundary that cannot run out. No
     inspector row, deliberately - it is not a machine anybody may buy. */
  inf:false,
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
  name:"VALVE", col:"#c8b060", cell:null, mode:"throttle", bore:412.5,
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
/* ONE LEVEL, NOT TWO. A hold tank's level IS s.lvl - what netExpSurge() moves
   and what the pressure programme reads - so this reads it back rather than
   letting s.tank[id] become a second, silently disagreeing copy. */
const tankLvl   = (s,id) => D.tanks[id] && D.tanks[id].hold && s.lvl !== undefined ? s.lvl
                : (s.tank && s.tank[id] !== undefined) ? s.tank[id] : D.tanks[id].level;
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
/* ══ AND A VENTED TANK IS NOT A VACUUM ══
   A vessel with nothing behind it is open to the compartment, which is where
   every other opening on this plant already sits (P.Pcont). It read 0 MPa
   absolute - a hard vacuum a pump could not lift out of - because the only
   thing that had ever held one up was a PUMP FIELD ON THE TANK, and a pump is
   a part on the grid now. */
function tankP(s,id){
  const t = D.tanks[id];
  if(!t) return 0;
  // CONTROLLED, so no gas law is consulted: a hold tank holds its circuit's
  // own setpoint, and the setpoint is what step() integrates
  if(t.hold) return loopP(s, tankCircuit(id));
  return Math.max(P.Pcont, !t.gas ? 0
    : t.gas.p0*t.gas.frac/(t.gas.frac + (t.level - clamp(tankLvl(s,id),0,100))/100));
}
/* ══ WHAT THIS VESSEL'S OWN SHELL IS BUILT FOR, MPa ══
   The highest pressure the tank can see: what it holds itself, and what the
   circuit it is plumbed to can push back into it. A design-time question - no
   S - so it reads setpoints and charges, never a solved field. */
const tankDesignP = id => { const t=D.tanks[id]; if(!t) return 0;
  const ci = tankCircuit(id);
  const own = t.hold ? holdSetP(ci) : t.gas ? t.gas.p0 : 0;
  const line = (ci===null || ci===undefined || ci<0) ? 0 : holdSetP(ci);
  return Math.max(own, line, 0.1); };
/* What the bench quotes as this tank's rated delivery, in % of loop inventory
   per second. An OUTPUT the panel reads back off the model, never an input
   the solve consumes - the line is a real resist(bore,length) edge and this
   is only what that model measures at full differential against containment. */
/* One law now: a tank's line is injResist() and nothing else, because a pump
   in series with it is a pump on the grid. The pumped case read 1.6 and what
   it was reading was the casing. */
const TANK_RATE_REF = 2.6;                   // % of loop inventory per second
const tankRateRef = id => TANK_RATE_REF;     // keeps id: a threshold is per-quantity
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
/* THE LAST PER-TANK s.pCore, and it is right where it stands: a checked tank
   is an INJECTION line, and what an injection line is fighting is the loop it
   injects into. A reserve behind a PUMP is checked at the pump's own discharge
   instead (pumpCheckOpen), which is where a real train puts the valve. */
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
  if(s.refOpen || (s.tankOpen && s.tankOpen[id])) return true;
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
   second clause anyway (the diode already demands the loop be BELOW it).
   ══ AND A POOL WITH NOTHING IN IT FEEDS NOTHING ══
   condLive()'s sentence, asked of a tank with a box. The fill clause is a
   CATCH tank's whole life and may not be reached by a tank a PUMP DRAWS ON: a
   node fixed at containment pressure has infinite inventory, so a dry reserve
   on a suction is a hole that never runs out. Which it is, is asked of the
   DRAWING (pumpResOf) and never stored - that field is what this deleted. And
   the fill clause asks the tank's OWN circuit, never s.pCore: the stock EFW
   tank sat at 8.0 against a generator at 6.9, so 15.5 > 8.0 stood true forever
   and an EMPTY tank went on feeding. */
const tankFillable = (s,id) => { const ci = tankCircuit(id);
  return ci !== null && ci !== undefined && ci >= 0 && loopP(s,ci) > tankP(s,id); };
const tankSuction = id => pumpIds().some(p => pumpResOf(p).includes(id));
const tankLive = (s,id) =>
  /* A HOLD TANK IS LIVE WHENEVER IT IS OPEN, stated rather than left to the
     clause below - which answers correctly today by coincidence, not by
     saying anything true. Surge goes both ways by definition and there is no
     level at which the vessel stops being the plant's pressure boundary. */
  D.tanks[id].hold ? tankOpen(s,id) :
  tankOpen(s,id) && tankCheckOpen(s,id) &&
  (tankWet(tankLvl(s,id)) || (!tankSuction(id) && tankFillable(s,id)));

/* ══ AND THE CONDENSATE OUTLET IS A POOL, NOT A SOURCE ══
   The same sentence tankLive() makes, asked of the hotwell: a pool with
   nothing left in it cannot feed a pump. A condenser with no hosted tank has
   no pool to run down and is unchanged, and so is a caller with no S - the
   reference solve is a plant with a full hotwell by definition. */
const condLive = s => { const h = hostedTankIds();
  return !h.length || !s.tank || tankWet(tankPoolPct(s,h)); };

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

/* HOW MUCH HEAD A FULLY VAPOUR-BOUND PUMP LOSES. Game balance: a pump full
   of vapour is still turning, so it keeps a fifth of its head rather than
   none. Nothing measured says a fifth. */
const CAV_DERATE = 0.8;
/* ══ A PUMP HAS A HEAD-FLOW CURVE, AND IT IS WHY IT CANNOT RUN OUT ══
   Shutoff head is (1+PUMP_DROOP) of the machine's stated duty head, the head
   falls linearly with what it is passing, and it is exactly the stated head at
   the stated flow - so a plant sitting at its duty point is bit-identical and
   the reference solve, which has no flow to read yet, seeds on that point.
   Past duty the head goes with the flow and reaches zero at 1+1/PUMP_DROOP of
   rated, which is the runout a real machine has and this one had none of: the
   BN-600 feed pump passed 320 times its rated flow against nothing but its own
   casing.
   s.pumpQBy is LAGGED one tick, and it must be - a head that depended on this
   tick's answer would be part of the question - the same standing s.cavP has,
   and it is smoothed for the same reason that one is. */
const PUMP_DROOP = 0.25;
const pumpQOf = (s, pid) => (s && s.pumpQBy && s.pumpQBy[pid]!==undefined)
  ? s.pumpQBy[pid] : pumpFlow(pid);
const pumpCurve = (s, pid) => Math.max(0,
  1 + PUMP_DROOP*(1 - pumpQOf(s,pid)/Math.max(pumpFlow(pid),1e-9)));
/* THE CASING IS THE MACHINE'S OWN CHARACTERISTIC, and every machine with a head has one:
   an ideal head source in series with a resistance IS a linear head-flow curve - shutoff
   head at no flow, falling as it passes more - which is what stops a real machine running
   out. Priced off the RATIO the machine states, head per rated kg/s, against the reference
   machine's own, so the runout multiple is the same everywhere instead of scaling with
   head. A TANK's pump is one of these too: given a head and no swallow it was an unlimited
   source, and a 19 t reserve referenced 8965 kg/s - enough to empty itself in two seconds. */
const pumpCasingG = (h, q) =>
  resist(1, NET_COMP_LEN*(PUMP_FLOW_REF/Math.max(q,1e-9))*(h/PUMP_H0));
/* ONE PUMP'S OWN SPEED, 0..1 - its ACTUAL, walked toward its own demand by
   step() with its own inertia. 1 when there is no S to ask, because the
   reference solve (netCoreFrac0) runs on a synthetic state and the reference
   plant is a plant at rated speed.
   s.flowScale is NOT sim state and is never on S: it is the per-solve override
   netFlowK() uses to run the same plant with its pumps stopped, which is how
   the thermosiphon is measured rather than predicted. */
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
/* WHAT ANY PUMP IS TURNING AT: its own speed, and nothing if it is hit. The
   switchboard is NOT here - a dead bus is already in s.flowBy's own target
   (step.js), so reading supplyK() again applied the blackout twice. */
const pumpDrive = (s, pid) =>
  (s.dmgParts && s.dmgParts.indexOf(pid)>=0 ? 0 : 1) * flowOf(s, pid);
/* HOW BADLY THIS PUMP'S OWN SUCTION IS BOILING, 0..1 - measured at its own
   suction node (step.js) and keyed by PUMP, so every pump on the grid can
   lose head to its own bad suction leg. */
const cavOf = (s, pid) => (s.cavP && s.cavP[pid]) || 0;
/* ══ A STANDBY TRAIN, AND WHETHER ITS CHECK VALVE IS PASSING ══
   Standby is asked of the DRAWING: a pump that draws on a tank is a reserve
   train (pumpResOf, layout.js) and has a discharge check valve. Passing is
   asked of LAST TICK's field - what the machine can develop against what its
   own discharge is already holding - so the diode is a boolean the solve is
   keyed on rather than a condition inside it. No field yet (the reference
   solve) is a valve wide open, which is what a commissioned plant has. */
const pumpStandby = id => pumpResOf(id).length > 0;
function pumpFwd(s, id){
  const P_ = s && s.pBy; if(!P_) return true;
  const a = P_[pumpSucNode(id)], b = P_[pumpDisNode(id)];
  if(a === undefined || b === undefined) return true;
  return b - a <= pumpHead(id)*pumpDrive(s,id)*pumpCurve(s,id)*(1 - CAV_DERATE*cavOf(s,id));
}

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
/* ONE DOOR, because netFactored()'s signature reads this too: spelled out in both places, a
   gate and the cache key it busts can disagree and the solve reuses factors taken with the
   valve shut - a wrong answer, not a crash. s.refOpen stands a DEMAND gate open (see
   netCoreFrac0); a valve blocked in is not one waiting to be asked. */
const reliefLive = (s,id) => !!((s.refOpen || (s.reliefOpen && s.reliefOpen[id]))
                             && !(s.reliefBlocked && s.reliefBlocked[id]));
const FIT = {
  throttle:{
    g:(s,id,bore,len)=>throttled(s,bore,len,[id]),
  },
  relief:{
    g:(s,id,bore,len)=>(reliefLive(s,id) && isFinite(len)) ? BREAK_K*bore*bore : 0,
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
  if(!((P && P.fittings && P.fittings[fid]) || D.fittings[fid])) return 0;
  const bore = fitBoreK(fid);
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
// A NODE THAT IS NOT THERE IS NOT A PLACE. A blank grid has no vessel, so a
// reader that asks "at the core" is asking about nothing and gets nothing.
const coreFold = raw => raw==null ? null : (foldMap()[raw] || raw);
/* WHICH CIRCUIT A NODE IS ON. The graph is keyed on partId+face and a FOLDED
   node is the bare part id, so the face is stripped only when the whole name
   is not itself a part. Cached on the graph, because the advection sweep asks
   it once per node per tick. */
function circOfNode(nid){
  if(nid==null) return -1;
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
  /* A FOLDED NODE IS THE BARE PART ID - the core's plenum, a tee's four
     faces, and now a tank's - so the whole name is looked up before a face is
     sliced off it. Without this a folded tank resolved as a part called
     "pz" and got no node in net.tankNode at all. */
  const partOfNode = nid => byId[nid] || byId[nid.slice(0, -1)];
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
      /* A SURGE LINE IS ORDINARY PIPE, not an injection line. INJ_K is 11x
         PIPE_K and exists so a short pumped injection line can deliver at
         all; a hold tank's surge line is a leg of the loop and must be priced
         like one, or the vessel swallows the plant. Known inconsistency,
         stated: the rule reads the TANK'S MODE rather than the line's own
         hardware, because the more principled "a checked line takes the
         injection scale" makes the relief and EFW tanks 11x freer and
         FEED_LEN was fitted to stop exactly that. Resolved at build time - a
         design fact, so it stays out of the cache signature. */
      const tk = D.tanks[tid] && D.tanks[tid].hold ? resist : injResist;
      edges.push({u, v,
        g: s => (tankLive(s,tid) && runPortsOpen(s,r))
                ? tk(bore, L + pipeExtraLen(s, r.cells)) : 0,
        h: 0, kind: r.k, key: r.key}); // LABEL: carried onto the edge for rendering/lookup, never re-compared here
      continue;
    }
    /* r.k is a LABEL, carried onto the edge so a renderer or
       a renderer can read it back; nothing here branches on it.
       Always routed through throttled() with an empty id list, which is
       exactly resist(bore, L) - so an undamaged run is bit-identical to a
       plain number while still being LIVE against a hit that has not
       happened yet. */
    /* ══ AND A STEAM LINE CARRIES NO LIQUID ══
       THIS solver knows liquid. A vapour run is a real pipe with a bore and a
       mass and it carries a real solved flow - in the VAPOUR network
       (vapBuild/vapSolve, below), which is a different law and a different
       matrix. Priced like water here it tied every generator's TOP together,
       and those nodes are FIXED at their own shell's saturation pressure, so
       two shells a few tenths of a MPa apart drove twenty times the primary's
       flow backwards up the header into the cooler generator.
       g 0 rather than no edge at all: netAssemble already omits an edge that
       cannot conduct, and this edge carries the SPEC (bore, length, cells) the
       vapour build reads back off it. */
    if(RUN_VAPOUR[r.k]){
      edges.push({u, v, g: 0, h: 0, kind: r.k, key: r.key, vapBore: bore, vapLen: L, vapRun: r});
      continue;
    }
    edges.push({u, v, g: s => runPortsOpen(s,r) ? throttled(s, bore, L + pipeExtraLen(s, r.cells), NO_GATES) : 0,
                h: 0, kind: r.k, key: r.key});
  }

  // internal component paths: continuity through a component a run merely
  // passes THROUGH. The pump is where head enters the loop - h is a
  // FUNCTION of s so a damaged pump's contribution tracks s.dmgParts live,
  // never baked in at build time.
  // ROLE[p.role].internal, not p.id.startsWith("sg")/"pump" - an edge THROUGH
  // a component is a fact about its role (tube path, pump casing), and which
  // faces it spans is stated on that row (layout.js) rather than guessed
  // from a name here. A path's own `head` layers a pump's developed head onto
  // the identical edge rather than building a second one, so "pump" is still
  // just "internal, and also a head source" - not a different shape.
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
      const bore = fitBoreK(p.id);
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
      /* ══ ONE HEAD LAW, EVERY PUMP ON THE GRID ══
         The machine's own stated head, at its own actual speed, less what its
         own suction is costing it. Signed a -> b by the CASING (ROLE.pump's
         internal path) and by nothing else: a real centrifugal pump takes
         suction at the impeller eye and discharges at the volute throat, so
         plumb it backwards and it pumps backwards. There used to be five
         paths through here - pooled loop capacity, a pressure-matching servo
         for a pump that reached a generator shell, a bare per-pump head, and
         two ways of losing it - and which one a machine got was decided
         silently by where it happened to be piped.
         flowOf() is IN the head, not a multiplier on the answer: once
         buoyancy is also a head, a plant whose pumps have coasted to a stop
         still circulates, and a factor outside the solve would multiply that
         thermosiphon by zero. Cavitation is a head loss for the same reason,
         and it is what makes the runaway appear with no new machinery - the
         suction goes hot, the pump loses head, loses flow, and its suction
         pressure falls further.
         A part with no run reaching ANY of its faces contributes NOTHING.
         That is not a branch in the law, it is the absence of a circuit: the
         edge is built and carries no head, exactly like a pump ordered to
         zero speed. net.usage (layout.js's pipeNetwork()) is the same port
         tally the bench's own "is this port free" check reads. */
      const routed = net.usage && (net.usage[p.id+"t"]||net.usage[p.id+"b"]||net.usage[p.id+"l"]||net.usage[p.id+"r"]);
      if(routed) edge.h = s => pumpHead(p.id) * pumpDrive(s, p.id)
                               * pumpCurve(s, p.id)
                               * (1 - CAV_DERATE*cavOf(s, p.id));
      /* ══ AND THE CASING IS THE PUMP'S OWN CHARACTERISTIC ══
         An ideal head source in series with a resistance IS a linear head-flow
         curve - shutoff head at no flow, falling as it passes more - which is
         what a real machine has and what stops one running out. The resistance
         is therefore priced off the RATIO the machine states, head per rated
         kg/s, against the reference machine's own: the runout multiple is then
         the same for every pump on the grid instead of scaling with head.
         Priced off flow alone it did not: the 23.5 MPa / 345 kg/s feed pump
         passed 21 700 kg/s on commissioning, emptied the hotwell in a second,
         cavitated, and the generators then pushed water backwards down the
         feed line into it. */
      /* ══ AND A STANDBY TRAIN HAS A DISCHARGE CHECK VALVE ══
         Every real one does, and it is the whole of why a stopped machine is
         not a hole: a bare casing is an open path from the header it
         discharges into straight back down its own suction, so an emergency
         feed pump commissioned STOPPED drained its generator into its own
         vented reserve. Asked of the DRAWING - a pump that draws on a tank
         (pumpResOf) is a standby train - and NOT of every pump, because a
         reactor coolant pump deliberately has no such valve: natural
         circulation goes through it after a blackout and a diode would weld
         the loop shut. A DIODE reads LAST TICK's field, since a gate that
         depends on the answer cannot be part of the question, and it is a
         BOOLEAN so netFactored() keys on two states and not a continuum. */
      const gc = pumpCasingG(pumpHead(p.id), pumpFlow(p.id));
      edge.g = pumpStandby(p.id)
        ? s => pumpFwd(s, p.id) ? gc : 0
        : gc;
    }
    /* ══ AND A WRECKED MACHINE PASSES NOTHING ══
       Only a PUMP ever noticed being destroyed (it lost its head, above), so
       water went on circulating through a condenser, a generator or a tank
       that the board draws as torn open - two wrecks at the ends of a run and
       a full flow between them. A wreck is not a length of pipe: its path is
       gone. g<=0 is an ABSENT edge (netAssemble), so this is a break in the
       line and never a large resistance, and a plant with nothing damaged
       assembles exactly the matrix it did before.
       The SHELL path of a ruptured generator goes with it - the leak is the
       sgtr edge, built elsewhere, and it still reaches the primary face the
       hot leg lands on, so a tube rupture still empties the loop into the
       secondary with nothing flowing THROUGH the machine. */
    { const g0 = edge.g, pid = p.id;
      const dead = s => !!(s.dmgParts && s.dmgParts.indexOf(pid) >= 0);
      edge.g = typeof g0 === "function" ? s => dead(s) ? 0 : g0(s)
                                        : s => dead(s) ? 0 : g0; }
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
    edges.push({u: open, v: reliefContNode(fid), g: resist(fitBoreK(fid), NET_COMP_LEN),
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
    /* ends AND the run's own two port valves: which shells a hole is actually
       blowing off is a LIVE question (holeShells(), step.js) and `shells` is
       only ever its design-time superset - a shut port cannot add a shell. */
    if(steam) steamBreaks.push({cells: r.cells, bore, shells, exh, ends, pa: r.pa, pb: r.pb});
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

  net2.coreNode = coreNode;   // holdLive() needs the loop end of the walk, and nothing else knew it
  /* THE FALLBACK ANCHOR, and only the fallback. There is no datum ROLE any
     more: a pressurizer is a tank whose gas space is controlled, and which
     node each component is measured from is decided per SOLVE (netRef()) off
     the hold tanks that are live at the time. A plant with no hold tank at
     all still needs a reference frame that is a real node, so the core keeps
     that job and the field never floats. */
  net2.pzrNode = coreNode;
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

  /* ══ WHICH OF THOSE TWO ANCHORS IS THE POOL'S OWN DOOR ══
     A surface condenser anchors both ends of its steam path. The `vap` end is
     the saturated space the turbine exhausts against and is a true boundary;
     the other end is where the hotwell drains out, and what crosses it is the
     pool's own water and nothing else. Fixed still - the pressure is real and
     the feed pump's suction sits on it - but BOOKED (outs.qCondBy) and SHUT
     when the pool is empty, which is the tank contract and the only thing
     that makes a fixed node an accounting entry rather than an invention.
     Asked of the declaration, never of a face name: a sink with no anchored
     vapour side (a radiator) names no outlet and is untouched. */
  net2.condOutNode = {};
  for(const q of LAY.parts){
    const R = ROLE[q.role];
    if(!R || R.thermal !== "sink" || !R.internal) continue;
    for(const IN of (Array.isArray(R.internal) ? R.internal : [R.internal])){
      if(!IN.anch || !IN.vap) continue;
      const liq = IN.vap.indexOf("a")>=0 ? "b" : "a";
      if(IN.anch.indexOf(liq)<0) continue;
      const nid = q.id + IN[liq];
      if(nid in index) net2.condOutNode[index[nid]] = q.id;
    }
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

  /* Every edge reaching a condensate outlet carries the pool's water, so it
     answers to the pool: gated on condLive() and signed onto the condenser it
     belongs to. Applied to the ASSEMBLED edges rather than in the run loop, so
     a tapped segment or an internal path landing on that node is caught by the
     same line. Positive is OUT of the condenser, the tank convention. */
  for(const ed of edges){
    const cu = net2.condOutNode[ed.u], cv = net2.condOutNode[ed.v];
    if(cu === undefined && cv === undefined) continue;
    ed.condOf  = cu !== undefined ? cu : cv;
    ed.condOut = cu !== undefined ? 1 : -1;
    const g0 = ed.g;
    ed.g = typeof g0 === "function" ? (s => condLive(s) ? g0(s) : 0)
                                    : (s => condLive(s) ? g0 : 0);
  }

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
  /* A BREAK, A VENT AND A TUBE LEAK ARE HOLES. One list, because the two
     passes that must skip them - contents, and static head - refuse them for
     the one reason: a hole is an opening to a place, not a run between two
     points of a circuit. */
  const isHole = ed => ed.kind==="break" || ed.kind==="vent" || ed.kind==="sgtr";
  net2.vapour = new Uint8Array(net2.n);
  { const any = new Uint8Array(net2.n);
    net2.vapour.fill(1);
    for(const ed of edges){
      /* A BREAK, A VENT AND A TUBE LEAK ARE HOLES, NOT CONTENTS. They hang off
         every run alike and say nothing about what is inside it, so a hole in
         the exhaust line must not make it read as full of water. */
      if(isHole(ed)) continue;
      any[ed.u]=1; any[ed.v]=1;
      // a run answers off its KIND (RUN_VAPOUR); a path through a component
      // answers per FACE, off the row that declared it (vapU/vapV, above)
      const k = RUN_VAPOUR[ed.kind];
      if(!(ed.vapU || k)) net2.vapour[ed.u]=0;
      if(!(ed.vapV || k)) net2.vapour[ed.v]=0;
    }
    /* AND A HOLE'S OWN NODE IS FULL OF WHAT IT PIERCES. The loop above skips
       break and vent edges so a hole cannot make the run it opens read as
       water - which left the hole's OWN node touched by nothing at all, so the
       "no edge" line below called it water and hung a full datum column on a
       steam relief stub. One live edge then equalised piezometric head between
       a node that has a column and one that has none, and the vapour side went
       NEGATIVE once the datum was heavy enough: sv0r solved at -0.113 MPa on a
       sodium plant, where rhoDatum() is 1960 against water's 700. It takes the
       contents of what it pierces, by the same all-edges-vapour rule.
       The sgtr node is deliberately not in here: it is not a hole to a place,
       it is the generator's own secondary held at secP. */
    const hole = new Uint8Array(net2.n);
    for(const ed of edges){
      if(ed.kind!=="break" && ed.kind!=="vent") continue;
      if(any[ed.u] && !any[ed.v]){ hole[ed.v]=1; if(!net2.vapour[ed.u]) net2.vapour[ed.v]=0; }
      if(any[ed.v] && !any[ed.u]){ hole[ed.u]=1; if(!net2.vapour[ed.v]) net2.vapour[ed.u]=0; }
    }
    for(let i=0;i<net2.n;i++) if(!any[i] && !hole[i]) net2.vapour[i]=0; }
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
  net2.vap = vapBuild(net2, index, edges, fitIds, fitMode, secTIds, secTParts);

  /* Every edge's head gains its static term alongside whatever source pushed
     it. Done here, once, rather than at each push site: buoyancy is a property
     of an edge's two ends, so writing it into the pump's own closure and the
     pipe's and the fitting's would be the same expression three times.
     EXCEPT A HOLE. Buoyancy is what a LEG of a circulating loop develops
     between its two ends; a break, a vent and a tube leak are holes to a
     place, and there is no closed path for a column to drive round. Charged
     one anyway, the relief valve's own discharge stub carried 0.398 MPa of
     invented head against the containment node it vents into, and printed
     -0.248 MPa - below absolute zero - on a plant whose datum is sodium. The
     same three kinds the vapour pass already refuses, for the same reason it
     refuses them: a hole is not contents, and it is not a leg either. */
  for(const ed of edges){
    if(isHole(ed)) continue;
    const src = ed.h;
    ed.h = typeof src === 'function' ? s => (src(s) + buoyH(net2, ed, s))*HEAD_K
         : src ? s => (src + buoyH(net2, ed, s))*HEAD_K
         : s => buoyH(net2, ed, s)*HEAD_K;
  }

  /* ══ WHAT FRAME IS THIS NODE MEASURED IN ══
     Connected components over the STRUCTURAL edge list - ed.u/ed.v only,
     never ed.g. A shut valve makes the live graph finer than this; that is
     intended, because a reference frame must not jump when an operator turns
     a handwheel, and because netFactored()'s signature keys on live
     conductances alone and so can never see this move. */
  net2.comp = new Int32Array(net2.n).fill(-1);
  { const adj = new Array(net2.n);
    for(const ed of edges){ (adj[ed.u] || (adj[ed.u]=[])).push(ed.v); (adj[ed.v] || (adj[ed.v]=[])).push(ed.u); }
    let c = 0;
    for(let i=0;i<net2.n;i++){
      if(net2.comp[i] >= 0) continue;
      const st = [i]; net2.comp[i] = c;
      while(st.length){ const u = st.pop(); const nb = adj[u]; if(!nb) continue;
        for(let k=0;k<nb.length;k++){ const v = nb[k]; if(net2.comp[v] < 0){ net2.comp[v] = c; st.push(v); } } }
      c++;
    }
    net2.nComp = c;
  }
  /* the DESIGN circuit each component belongs to, off the first node in it
     that names one - a synthetic node (containment, sgtr, a vent stub) is on
     no circuit and answers -1, so it is skipped rather than allowed to name
     the component. */
  net2.compCirc = new Int32Array(net2.nComp).fill(-1);
  for(let i=0;i<net2.n;i++){
    const c = net2.comp[i];
    if(net2.compCirc[c] >= 0) continue;
    const ci = circOfNode(coreFold(net2.name[i]));
    if(ci >= 0) net2.compCirc[c] = ci;
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
/* THE SEED IS THE GENERALISATION. The old walk started at the core and
   exempted the core from its own fixed test; a walk seeded anywhere else has
   to re-state that exemption against ITS OWN seed, or the seed kills the
   walk before it leaves. Seeded by CIRCUIT, not by component: a shut valve
   makes the live graph finer, and that is precisely the disconnection this
   is asked to detect. A component with no free node but the tank is holding
   nothing - which is the same answer the old pzrNode===coreNode guard gave
   for a vessel nobody plumbed. */
/* ══ IS THIS VESSEL SETTING ANYTHING ══
   Walked FROM THE TANK, and the question is not "does it reach the core" - a
   seed somewhere else on the circuit is a seed the walk may not be able to
   leave at all (a steam tee is a free liquid node with no live liquid edge),
   and it made a plainly-plumbed secondary vessel read as disconnected.

   A hold tank is LIVE when its own node reaches at least one FREE node. A
   free node is a place the pressure is SOLVED, so touching one is exactly
   what "this vessel is setting the level here" means. Every other path out of
   it lands on another boundary, which absorbs whatever it is given and
   propagates no pressure - the "reached, never crossed" rule this walk has
   always kept, now asked from the other end and needing no exemption for its
   own start.
   It answers the primary identically: pzr -> the surge tee is a free node, so
   the stock plant is live, and cutting the surge line or shutting any valve
   in it leaves nothing but boundaries and it is not.

   Costs one pass over the edge list. Called once a tick from step(), not from
   a layer - a layer must not solve, and this walks the same conductances a
   solve would. */
function holdLive(net, s, ci){
  const holds = holdOnCirc(ci);
  if(!holds.length) return true;                  // nothing on this circuit to disconnect
  const t = net.tankNode[holds[0]];
  if(t === undefined) return false;               // a vessel sitting there unplumbed
  const fixed = netFixed(net, s);
  const adj = new Array(net.n);
  for(let e=0;e<net.edges.length;e++){
    const ed = net.edges[e];
    const g = typeof ed.g === 'function' ? ed.g(s) : ed.g;
    if(!(g > 0)) continue;
    (adj[ed.u] || (adj[ed.u] = [])).push(ed.v);
    (adj[ed.v] || (adj[ed.v] = [])).push(ed.u);
  }
  const seen = new Uint8Array(net.n), stack = [t];
  seen[t] = 1;
  while(stack.length){
    const u = stack.pop();
    if(u !== t){
      if(fixed[u] !== undefined) continue;         // reached, never crossed
      return true;                                 // a solved node: it is setting this
    }
    const a = adj[u];
    if(a) for(let i=0;i<a.length;i++){ const v=a[i]; if(!seen[v]){ seen[v]=1; stack.push(v); } }
  }
  return false;
}
const pzrLive = (net, s) => holdLive(net, s, nodeGraph().coreCirc);
/* ══════════ THE VAPOUR SIDE IS ITS OWN NETWORK ══════════
   TWO NETWORKS, NEVER ONE GRAPH. The pressures are in the same units and the
   laws are not: water goes as the DIFFERENCE of two pressures and steam goes
   as the difference of their SQUARES, and it CHOKES - past a critical ratio a
   restriction passes what the upstream pressure alone says and the downstream
   pressure stops mattering at all. A generator is the BOUNDARY between the
   two, not a path across it, so the liquid matrix never sees a vapour node
   and this one never sees a liquid one.
   The solver is still linear, so the compressible law arrives as a
   CONDUCTANCE re-evaluated each tick off last tick's field (s.vapP) - the
   same shape FIT[mode].g already uses for a valve, and never a second
   solver. */
const VAP_RCRIT  = 0.55;    // critical pressure ratio for steam - past it a restriction is choked
/* ── WHAT A LINE OF THIS KIND IS SIZED FOR ──
   An engineer sizes a duct for the flow it must pass AT THE PRESSURE IT RUNS
   AT, which is the whole reason a turbine's main steam line is a pipe and its
   exhaust neck is a room: the same kilograms at a two-hundredth of the density
   want two hundred times the area. The grid draws both one cell wide and the
   bore table is one figure for every steam run, so the ANCHOR is stated per
   kind here and the drawn bore is a multiplier on it. An absolute choked mass
   flux was tried first and is wrong for exactly this reason - it read the
   schematic bore as a real duct and choked the exhaust at 0.79 MPa.
   VAP_LINE is how many times rated a full-bore line passes: the pipe is not
   meant to be the restriction, the governor is, but halve the bore and it
   starts to be one. */
const VAP_LINE   = 8;
const VAP_FRIC   = 0.02;    // Darcy friction factor, so a long line is worth less than a short one
/* The differential a conductance is floored on, as a fraction of the pressure
   it is a fraction OF - never an absolute, and never a bare zero: w/dp goes to
   infinity as the two ends equalise, which is the one way this shape can blow
   up. */
const VAP_DPMIN  = 0.02;
const vapW = (kv, pu, pv) => {
  if(!(kv>0) || !(pu>0)) return 0;
  const r = clamp(pv/pu, 0, 1);
  return kv*pu*Math.sqrt(Math.max(0, 1 - Math.max(r,VAP_RCRIT)*Math.max(r,VAP_RCRIT)));
};
/* THE FLOOR IS ON THE DIFFERENTIAL, NOT ON THE ANSWER, and it has to be
   applied to BOTH ends of the ratio: priced at the real dp over a floored one,
   an edge whose two ends had equalised read a conductance of exactly 0 - so
   the node decoupled, dropped to nothing, and re-equalised next tick. A dead
   end pulsed between the header's pressure and zero. */
const vapG = (kv, pa, pb) => {
  const pu = Math.max(pa,pb), pv = Math.min(pa,pb);
  const dp = Math.max(pu-pv, VAP_DPMIN*Math.max(pu,1e-4));
  return vapW(kv, pu, pu-dp)/dp;
};
const vapRefP = kind => kind==="exh" ? condPDes() : sgDesignP();
const vapPipeKv = (kind, bore, L) =>
  VAP_LINE*P.steamRef/Math.max(vapW(1, vapRefP(kind), 0), 1e-9)
  * bore*bore/Math.sqrt(1 + VAP_FRIC*L/Math.max(bore*BORE_REF/1000, 0.05));

/* Built once with the net it belongs to. Its NODES are the liquid net's own
   node numbers, so a reader that has one has the other, and its EDGES are the
   vapour runs (which the liquid solve already carries at g 0, deliberately),
   every gate spliced into them, and every machine that declares a vapPath. */
function vapBuild(net2, index, edges, fitIds, fitMode, secTIds, secTParts){
  const ve = [];
  for(const ed of edges) if(ed.vapBore !== undefined)
    ve.push({u:ed.u, v:ed.v, key:ed.key, kind:ed.kind, bore:ed.vapBore, len:ed.vapLen, run:ed.vapRun});
  /* A VALVE IN THE STEAM LINE IS THE MAIN STEAM ISOLATION VALVE, and it is
     the ordinary fitting the bench already hands you - shut it and that
     generator's shell pressurises onto its own safety, which is the accident
     the machine exists for. Off the same l/r pair the liquid gate uses, so a
     valve plumbed vertically is the same valve. */
  for(const fid of fitIds){
    if(fitMode[fid] !== "throttle") continue;
    const a = index[fid+"l"], b = index[fid+"r"];
    if(a === undefined || b === undefined || !net2.vapour[a] || !net2.vapour[b]) continue;
    ve.push({u:a, v:b, key:fitEdgeKey(fid), fit:fid});
  }
  for(const p of LAY.parts){
    const R = ROLE[p.role]; if(!R || !R.vapPath) continue;
    const a = index[p.id+R.vapPath.a], b = index[p.id+R.vapPath.b];
    if(a === undefined || b === undefined) continue;
    ve.push({u:a, v:b, key:"vap:"+p.id, machine:p.id, work:!!R.vapPath.work});
  }
  /* THE BOUNDARIES: every generator's own steam nozzle, at the saturation
     pressure its shell pot is sitting at, and every condensing volume, at the
     backpressure it is holding. Exactly the two nodes the liquid net already
     fixes for the same physical reason - a shell and a condenser are places
     where a pressure is KNOWN, not solved. */
  const src = [], srcPart = [], sink = [];
  const used = [], mark = new Uint8Array(net2.n);
  for(const e of ve){ mark[e.u]=1; mark[e.v]=1; }
  for(let i=0;i<net2.n;i++) if(mark[i]) used.push(i);
  for(let k=0;k<secTIds.length;k++) if(mark[secTIds[k]]){
    src.push(secTIds[k]); srcPart.push(secTParts[k]); }
  for(const nid in net2.condNode){ const i = net2.condNode[nid];
    if(mark[i] && net2.vapour[i]) sink.push(i); }
  return {edges:ve, src, srcPart, sink, used, n:net2.n, name:net2.name};
}
/* ONE SOLVE OF THE STEAM SIDE, in kg/s and MPa - no datum column, because a
   steam space has none. `open` carries what each machine's own gate is doing
   this tick (step() owns the governor and the bypass); everything else is on
   the drawing. */
function vapSolve(s, open){
  const V = P.net && P.net.vap;
  if(!V || !V.edges.length || !V.src.length) return null;
  const n = V.n, ne = V.edges.length;
  const fx = new Float64Array(n), isFx = new Uint8Array(n);
  for(let k=0;k<V.src.length;k++){ fx[V.src[k]] = secP(s, V.srcPart[k]); isFx[V.src[k]] = 1; }
  const pc = condP(s);
  for(const i of V.sink){ fx[i] = pc; isFx[i] = 1; }
  if(!s.vapP) s.vapP = {};
  const pl = new Float64Array(n);
  for(const i of V.used){ const v = s.vapP[V.name[i]];
    pl[i] = isFx[i] ? fx[i] : (v===undefined ? pc : v); }
  const g = new Float64Array(ne), kv = new Float64Array(ne), kw = new Float64Array(ne);
  for(let e=0;e<ne;e++){ const ed = V.edges[e];
    let k = 0, w = 0;
    if(ed.run){ k = runPortsOpen(s, ed.run)
      ? vapPipeKv(ed.kind, ed.bore, ed.len + pipeExtraLen(s, ed.run.cells)) : 0; }
    else if(ed.fit){ k = vapPipeKv("steam", fitBoreK(ed.fit), NET_COMP_LEN)
      * clamp((s.valve && s.valve[ed.fit]!==undefined) ? s.valve[ed.fit] : 1, 0, 1); }
    else if(ed.machine){ const o = (open && open[ed.machine]) || {};
      w = Math.max(0, o.work||0); k = w + Math.max(0, o.dump||0); }
    kv[e] = k; kw[e] = w;
    g[e] = vapG(k, pl[ed.u], pl[ed.v]);
  }
  const row = new Int32Array(n), free = [];
  for(const i of V.used) if(!isFx[i]){ row[i] = free.length; free.push(i); }
  const nf = free.length;
  const b = new Float64Array(nf);
  if(nf){
    const A = new Float64Array(nf*nf);
    for(let e=0;e<ne;e++){ const gg = g[e]; if(!(gg>0)) continue;
      const u = V.edges[e].u, v = V.edges[e].v;
      if(isFx[u] && isFx[v]) continue;
      if(isFx[u]){ const c=row[v]; A[c*nf+c]+=gg; b[c]+=gg*fx[u]; }
      else if(isFx[v]){ const a=row[u]; A[a*nf+a]+=gg; b[a]+=gg*fx[v]; }
      else { const a=row[u], c=row[v];
        A[a*nf+a]+=gg; A[c*nf+c]+=gg; A[a*nf+c]-=gg; A[c*nf+a]-=gg; } }
    netFactor(A, nf); netSubst(A, b, nf);
  }
  const p = new Float64Array(n);
  for(const i of V.used) p[i] = isFx[i] ? fx[i] : b[row[i]];
  for(const k in s.vapP) delete s.vapP[k];
  for(const i of V.used) s.vapP[V.name[i]] = p[i];
  /* WHAT EACH SHELL IS ACTUALLY PASSING - the sum over its own node's edges,
     signed out of the shell. Negative is steam arriving from a hotter machine
     down the same header, which is a real thing a common header does and
     which the old plant-level demand share could not represent at all. */
  /* kg/s per run key, SIGNED along that key's own canonical order. On S and
     refilled, never rebuilt, because a renderer holds it across frames - the
     same standing s.spillBy and s.sgtrBy carry. It is the steam side's answer
     to runFlow, and it is what the meters and the packets read. */
  if(!s.vapQ) s.vapQ = {};
  const out = {}, byKey = s.vapQ;
  for(const k in byKey) delete byKey[k];
  let work = 0, workP = 0, sink = 0;
  const q = new Float64Array(ne);
  for(let e=0;e<ne;e++) q[e] = g[e]>0 ? g[e]*(p[V.edges[e].u]-p[V.edges[e].v]) : 0;
  for(let e=0;e<ne;e++){ const ed = V.edges[e];
    if(ed.key) byKey[ed.key] = (byKey[ed.key]||0) + q[e];
    /* the share of a machine's path that crossed the WHEELS rather than the
       bypass around them: one edge, two gates, and only one of them does work */
    if(ed.machine && kv[e]>0 && kw[e]>0){
      work += q[e]*kw[e]/kv[e]; workP += p[ed.u]*Math.abs(q[e])*kw[e]/kv[e]; }
    for(const i of V.sink) if(ed.u===i) sink -= q[e]; else if(ed.v===i) sink += q[e];
  }
  for(let k=0;k<V.src.length;k++){ const i = V.src[k]; let f = 0;
    for(let e=0;e<ne;e++){ const ed = V.edges[e];
      if(ed.u===i) f += q[e]; else if(ed.v===i) f -= q[e]; }
    out[V.srcPart[k]] = f; }
  return {out, byKey, work, sink, pIn: work>1e-9 ? workP/Math.abs(work) : pc, p, kv};
}
/* ══ ONE REFERENCE FRAME PER COMPONENT ══
   phiRef() is the level ONE anchor sets, and it cancels out of every flow -
   but it does not cancel in floating point, so a component with no anchor of
   its own keeps the plant's global value rather than an invented zero. p0[c]
   is what netCoreFracOf() adds straight back; anchor[c] is the node fixed at
   exactly p0[c], or -1 where the component has none. */
/* ══ THE ANCHOR RULE, AS ONE PREDICATE ══
   A component is anchored at the lowest-index node in it that is a LIVE hold
   tank's node; failing that at net.pzrNode if it is that node's component;
   failing that at nothing, which needs no code at all - netFactor()'s pivot
   guard decouples an unanchored component and net.Afdeg deletes its nodes
   from byP.
   TWO HOLD TANKS ON ONE COMPONENT: the lowest node wins and the rest are
   demoted to ordinary tanks. Letting both anchor fixes two nodes at the same
   pressure and different elevations, which is a manufactured thermosiphon of
   exactly the kind phiRef() exists to prevent. */
function netRef(net, s){
  const g = phiRef(net, s);
  const p0 = new Float64Array(net.nComp).fill(g);
  const anchor = new Int32Array(net.nComp).fill(-1);
  const rd0 = rhoDatum(s)*G_MPA;
  /* p0 IS THE ANCHOR'S OWN ABSOLUTE PRESSURE PLUS ITS OWN COLUMN. That is the
     whole definition of the frame, so the anchor's fixed value is exactly 0
     by construction rather than by a coincidence - including on a VAPOUR
     anchor, which the old literal f[pzrNode]=0 was only ever right about
     because the pressurizer never was one. */
  for(const id of holdTankIds()){
    const i = net.tankNode[id];
    if(i === undefined || !tankLive(s,id)) continue;
    const c = net.comp[i];
    if(anchor[c] >= 0 && anchor[c] <= i) continue;
    anchor[c] = i;
    p0[c] = loopP(s, net.compCirc[c]) + (net.vapour[i] ? 0 : rd0*net.z[i]);
  }
  const c0 = net.comp[net.pzrNode];
  if(c0 >= 0 && anchor[c0] < 0) anchor[c0] = net.pzrNode;   // p0 is already the global level
  return {p0, anchor};
}
function netFixed(net, s){
  const ref = netRef(net, s), rd0 = rhoDatum(s)*G_MPA;
  const f = {};
  net.refNow = ref;
  const p0OF = i => ref.p0[net.comp[i]];
  /* THE DATUM COLUMN A NODE ACTUALLY HAS. The solve carries piezometric head
     (phi = p + rho*g*z) for a network that used to be liquid throughout. A
     STEAM SPACE HAS NO COLUMN: three metres of exhaust line is worth 19 kPa of
     water and essentially nothing of steam, and 19 kPa is twice the whole
     pressure the condenser sits at. net.vapour is the structural answer to
     which nodes those are, and it must be read HERE as well as at the readout
     or the two disagree by exactly that column. */
  const rdz = i => net.vapour[i] ? 0 : rd0*net.z[i];
  /* EVERY COMPONENT'S ANCHOR, at its circuit's own setpoint plus its own
     column - which is exactly what p0 was built from, so this is 0 to the
     last bit and no special case is needed to make it one. */
  for(let c=0;c<net.nComp;c++) if(ref.anchor[c] >= 0) f[ref.anchor[c]] = 0;
  /* CONTAINMENT, one node per opening, always fixed and usually attached to
     nothing: its edge's g is 0 until that break happens, so netAssemble skips
     the edge and the node contributes exactly nothing. Keeping the SET
     constant rather than adding a node when a break opens is what lets the
     factorisation cache key on the break's own live state (s.dmgParts and
     s.breach, netFactored below) instead of on a set that changes shape - and
     a break still busts that cache, which is the thing that matters: a fresh
     break solved against the intact plant's factors is a wrong answer, not a
     crash. */
  for(const i of net.cont) f[i] = P.Pcont + rdz(i) - p0OF(i);
  /* Every TANK's own node is fixed at the pressure its own gas space is
     holding. That is the whole of 2h and 2j: injection is then the SOLVED
     flow through the tank's one edge against the loop it is fighting, so a
     loop at full pressure takes almost nothing and a depressurised one takes
     a surge, and an emptying accumulator tapers because its gas is expanding.
     Fixed whether or not the edge is open - an isolated node costs nothing
     and keeps the fixed SET constant, so the factorisation cache keys on the
     valve instead of on a set that changes shape. */
  /* A HOLD TANK IS ITS COMPONENT'S ANCHOR, above, and this loop would
     overwrite that with the same number measured in the wrong frame. */
  for(const id in net.tankNode){ const i = net.tankNode[id];
    if(D.tanks[id] && D.tanks[id].hold) continue;
    f[i] = tankP(s,id) + rdz(i) - p0OF(i); }
  /* the secondary side of each steam generator - a boundary, not a solve.
     Fixes the synthetic sgtr node AND, since Stage 1, the generator's own
     real steam port (net.secT) at the identical pressure - one formula, two
     places it is physically true. */
  net.sec.forEach((i,k)=>{ f[i] = secP(s, net.sgtrParts[k]) + rdz(i) - p0OF(i); });
  net.secT.forEach((i,k)=>{ f[i] = secP(s, net.secTParts[k]) + rdz(i) - p0OF(i); });
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
    for(const k in net.condNode){ const i = net.condNode[k]; f[i] = pc + rdz(i) - p0OF(i); } }
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
   has to bust the cache, not just crossing some open/shut line. */
function netFactored(net, s, fixed){
  const sig = net.fitIds.map(fid => {
    const mode = net.fitMode[fid];
    /* relief is a mode too now, gated on S.reliefOpen/S.reliefBlocked rather
       than S.valve - either crossing changes A, so both enter the signature
       exactly like a throttle's own position does. */
    if(mode==="relief") return reliefLive(s,fid) ? '1' : '0';
    return String(s.valve && s.valve[fid]);   // throttle
  }).join('|')
  /* DAMAGE is a third live input the edges above read (beside S.reliefOpen
     and S.valve) - leave it out of the signature and a hit or a repair reuses
     last tick's factorisation, solving the network as though the plant were
     still the one it was before: a wrong answer, not a crash, so it is checked
     every call exactly like the other two. THE WHOLE LIST, not the severed
     cells alone: a wrecked machine's own internal path is gone now, so any
     damage id can change A. It subsumes the ruptured-generator field this
     used to carry separately. */
  + '|' + (s.dmgParts ? s.dmgParts.join(',') : '')
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
  /* Every gate on every tank's own edge - the operator's valve, its auto
     rule, the diode and "is there anything left to give" - as ONE bit per
     tank, off the same tankLive() the edge itself is built from. Any of them
     crossing changes A, not just b. No tank is named here: adding a tank is
     adding a bit, and a tank whose gates never move never busts anything.
     Filtered on HAVING A NODE, not on being primary: a secondary tank has a
     real edge now, and it is a live g exactly like any other tank's. A tank
     with no cell has no node and so adds no bit, which is right - there is
     nothing about it for A to depend on. */
  + '|' + tankIds().filter(id=>net.tankNode[id]!==undefined).map(id=>tankLive(s,id)?'1':'0').join('')
  /* the hotwell running dry shuts the condensate edge, which is a change to A
     exactly as a tank running dry is. One bit for the plant - the pool is one
     pool (hostedTankIds()), so there is no per-condenser answer to give. */
  + '|' + (condLive(s)?'1':'0')
  // and every standby train's own discharge check - one bit each, and a plant
  // with no standby pump adds none
  + '|' + pumpIds().filter(pumpStandby).map(id=>pumpFwd(s,id)?'1':'0').join('');
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
/* ══ AND NOTHING MAY APPEAR AT A NODE NOBODY SOLVED FOR ══
   A FREE node's incident flows sum to zero by construction, so a residue there
   is an assembly bug and nothing else - an edge written into the matrix at one
   pair of nodes and evaluated at another. A FIXED node's imbalance IS the
   boundary flow and is meant to be non-zero, so it is not asked about here.
   ONLY WHEN THE TOPOLOGY MOVES: netFactored() rebuilds on net.AfSig, and
   between two rebuilds the guarantee cannot lapse - an O(E) pass every tick
   would be felt at MAX and would buy nothing. A DEV INVARIANT: it warns. */
let divSig = null;
function netDiverge(net, q, fixed){
  if(net.AfSig === divSig) return;
  divSig = net.AfSig;
  const d = new Float64Array(net.n);
  let qmax = 0;
  for(let e=0;e<net.edges.length;e++){ const ed=net.edges[e], f=q[e];
    d[ed.u] -= f; d[ed.v] += f;
    const a=Math.abs(f); if(a>qmax) qmax=a; }
  if(!(qmax>0)) return;
  for(let i=0;i<net.n;i++){
    if(fixed[i] !== undefined) continue;
    if(net.Afdeg && net.Afdeg[i]) continue;     // no path to ground: no answer to check
    if(Math.abs(d[i]) > 1e-6*qmax)
      console.warn("[divergence] "+net.nodes[i]+" "+d[i].toExponential(2)
        +" of "+qmax.toExponential(2));
  }
}
function netCoreFracOf(net, s, byLoop, byRun, byDrop, byP, outs){
  const fixed = netFixed(net, s);
  netFactored(net, s, fixed);
  const b = new Float64Array(net.n);
  /* which nodes an edge that conducts actually reached this pass - the byP
     block below needs it to tell a fixed node that is PINNING something from
     one hanging off a shut break, and the conductances are evaluated here. */
  const touch = new Uint8Array(net.n);
  netAssemble(net.edges, net.n, fixed, s, false, b, null, null, null, touch);
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
  /* ══ A CIRCUIT NOTHING PINS SITS ON THE SHIP, NOT ON THE REACTOR ══
     p0 for a component with no fixed node at all was the plant's GLOBAL level,
     which is the reactor's setpoint. That is right for the core's own circuit
     with no pressurizer on it - it is the whole of the bit-identical guarantee
     - and it is arbitrary for anything else: the stock cooling loop read
     14.95 MPa of circulating water on a PWR, and on a sodium plant, whose
     global level is 0.08 MPa, the same loop's pump suction solved at
     -0.27 MPa. tsatSec() answered 215 K for that, so the pump read 80 K of
     SUPERHEAT, cavitated inside a second and took the condenser's heat sink
     with it - the whole of why SFR tripped on backpressure.
     Every closed cooling loop has an expansion tank open to the compartment,
     and that is what this is: the component is floated so its LOWEST node sits
     at the pressure the ship holds. A frame cancels out of every flow by
     construction, so nothing solved moves - only the absolute level, which is
     the one quantity that had no answer before. A component with an anchor of
     its own, the core's included, is untouched. */
  /* A FIXED NODE ONLY PINS ANYTHING IF AN EDGE REACHES IT. Every component
     carries a containment node, fixed at P.Pcont and hanging off an edge whose
     g is 0 until that break opens - and a fixed node is never a free row, so
     Afdeg cannot say so. `touch` can: open the break and the component is
     pinned at containment pressure, which is exactly what a hole in it means.
     The fixed nodes themselves are written in the ORIGINAL frame, because
     netFixed() built their values against it - that is what keeps a shut
     containment reading exactly P.Pcont on a component this has floated. */
  if(byP){ const rd = rhoDatum(s)*G_MPA, ref = net.refNow;
    const deg = net.Afdeg;
    const col = i => net.vapour[i] ? 0 : rd*net.z[i];
    const lo = new Float64Array(net.nComp).fill(Infinity);
    const free = new Uint8Array(net.nComp).fill(1);
    for(let i=0;i<net.n;i++){ const c = net.comp[i];
      if(fixed[i]!==undefined){ if(touch[i]) free[c]=0; continue; }
      if(deg && deg[i]) continue;
      const v = b[i] - col(i); if(v < lo[c]) lo[c] = v; }
    for(let i=0;i<net.n;i++){
      if(deg && deg[i] && fixed[i]===undefined){ delete byP[net.nodes[i]]; continue; }
      const c = net.comp[i];
      const p0 = (free[c] && fixed[i]===undefined && isFinite(lo[c]))
        ? P.Pcont - lo[c] : ref.p0[c];
      byP[net.nodes[i]] = b[i] + p0 - col(i);
    } }
  const q = new Float64Array(net.edges.length);
  netFlows(net.edges, b, fixed, q, s);
  netDiverge(net, q, fixed);
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
  const isAnchor = new Uint8Array(net.n);
  for(let c=0;c<net.nComp;c++) if(net.refNow.anchor[c] >= 0) isAnchor[net.refNow.anchor[c]] = 1;
  for(let i=0;i<net.n;i++){
    /* free nodes only: a containment node sits 15 MPa below the loop whether
       or not anything is open to it, and letting it into the span would
       collapse every drop this scale exists to make legible. */
    if(fixed[i] !== undefined && !isAnchor[i]) continue;
    if(b[i]>pmax) pmax=b[i]; if(b[i]<pmin) pmin=b[i];
  }
  const span = pmax - pmin;
  // every node a TANK row landed on - hoisted once so the core-flow test
  // below is a Set lookup, not a rebuilt object per edge
  /* A HOLD TANK IS NOT A SOURCE OR A SINK - it is where the circuit's own
     water goes when it expands. Counted here, qTankEdge would delete the
     surge line from the core-circulation figure and the mimic would start
     printing the pressurizer as INJECTING, which feeds tankInjecting()'s own
     +0.5*P.pRise straight back into the pressure that just moved it. */
  const tankNodes = new Set();
  for(const id in net.tankNode) if(!(D.tanks[id] && D.tanks[id].hold)) tankNodes.add(net.tankNode[id]);
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
      const tu = tankNodes.has(ed.u) ? net.tankIdByNode[ed.u] : undefined,
            tv = tankNodes.has(ed.v) ? net.tankIdByNode[ed.v] : undefined;
      if(tu !== undefined || tv !== undefined){
        const by = outs.qTankBy || (outs.qTankBy = {});
        const tid3 = tu !== undefined ? tu : tv;
        by[tid3] = (by[tid3]||0) + (tu !== undefined ? q[e] : -q[e]);
      }
    }
    /* SIGNED, PER CONDENSER, POSITIVE OUT OF THE POOL - the tank line above,
       asked of the condensate outlet. This is the ONE charge against the
       hotwell (step.js); anything else charging it would make the pipe and
       the pool two separate stories about the same water. */
    if(outs && ed.condOf !== undefined){
      const by = outs.qCondBy || (outs.qCondBy = {});
      by[ed.condOf] = (by[ed.condOf]||0) + ed.condOut*q[e];
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
// layout.js). Nothing clamps a pump here any more: head is per-machine and
// never pooled, so a spare pump raises this reference by exactly what it
// raises the live plant by, and the 100% mark it is judged against moves with
// it rather than having to be defended from it.
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
const netCoreFrac0 = (net, byLoop, byRun, over, outs) => {
  /* THE REFERENCE STATE, stated rather than inherited. It is ISOTHERMAL
     (coreDT 0), so buoyancy in it is exactly zero and netRef stays what it
     has always been: a purely geometric figure that prices this plant's
     PIPING and its pumps, not how hot it happened to be when it was
     commissioned. A freshly reset plant is isothermal too (resetPlant()
     starts s.coreDT at 0, and the loop takes seconds to establish a rise),
     so an undamaged plant nobody has run still reads exactly 1 - and once it
     is hot, the buoyancy it develops is real extra flow that a geometric
     reference must NOT contain. Pump speed is rated, because that is what
     "as commissioned" means for a pump. `pCore` is the pressure the line
     above already names, spelled the way tankLive() and tankCheckOpen() read
     it - left undefined they were asked about a plant with no pressure in it.
     `over` is EVERY field a caller may state instead of that default, one
     door rather than a positional per question. `fregBy`: a feed regulating
     valve commissions WIDE and then walks itself onto the level it holds, so
     what that valve is worth is a question about the plant's rated feed
     rather than about this reference's own geometry. `pumpQBy`: a pump sits
     on its own head-flow curve (pumpCurve()) at the flow it is actually
     developing; left out, the reference priced every pump at its duty head
     while the plant one tick later derated to what it really passes, so cwK()
     read 0.42 on MSRE against a flow the plant could never have. `refOpen`:
     see the scale reference in commission(). */
  const s = Object.assign({dmgParts:[], valve:{}, flow:1, Tavg:P.Tref,
                           coreDT:0, P:P.P0, pCore:P.P0}, over);
  for(const fid of net.fitIds) if(net.fitMode[fid]==="throttle")
    s.valve[fid] = fitTies(fid) ? 0 : 1;
  return netCoreFracOf(net, s, byLoop, byRun, null, null, outs);
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

   NOTHING IS CLAMPED HERE ANY MORE. The ceiling this used to apply - a
   group's raw flow against the pump capacity installed on it - was a second
   capacity model standing beside the head, and it only existed because head
   was POOLED over a loop's pumps: two pumps in one loop each developed the
   sum, so something afterwards had to take back what the sum invented. A
   pump develops its own stated head now (netBuild()), so a spare pump adds
   exactly what a spare pump adds and the solve is already the answer.

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
  /* The same plant with its pumps stopped: what it circulates on its own is
     a reading this function can take for free, because the network is linear
     in head and the factorisation depends on conductance alone - one
     assemble and one substitution, never a re-elimination. Object.create
     rather than a spread, so a tick allocates one object and not forty
     copied fields. */
  // the commissioning settle asks hundreds of times and reads no NAT CIRC bar
  if(!(outs && outs.noNat)){ const sNat = Object.create(s); sNat.flowScale = 0;
    netCoreFracOf(P.net, sNat, natLoop); }
  let total = 0, natTot = 0;
  for(let i=0;i<n;i++){ total += byLoop[i]||0; natTot += natLoop[i]||0; }
  /* the share of this flow the plant is developing on its own, with no pump
     doing anything - the thermosiphon, MEASURED off the same solve rather
     than predicted beside it. This is what the NAT CIRC bar reads. */
  if(outs){ const nk = natTot/P.netRef; outs.nat = isFinite(nk) && nk>=0 ? nk : 0;
    /* Per-loop flow, which this function has always computed and always thrown
       away. step()'s secondary mass balance needs it: heat leaves the primary
       at each generator in proportion to the water going through that
       generator's own loop, so a throttled loop boils its own generator down
       more slowly. Every reader normalises against the sum, so a common scale
       cancels. */
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

/* ══ AND A PORT IS A TARGET TOO ══
   The one thing on the board a shot could not touch: a nozzle valve is the
   first handle a watch reaches for when a run has to be cut out, and it could
   never be the thing that fails. Same pseudo-part shape a pipe cell takes, so
   the dispatcher, the dose rate, the damage card and the repair party need no
   third code path - it occupies one cell, so it is one target and one small
   job. What being wrecked MEANS is that it jams where it stands (ACT.portShut
   refuses, record.js): a valve nobody can work is worse than a shut one. */
function portCellPart(pid){
  const c = (typeof portCell === "function") ? portCell(pid) : null;
  if(!c) return null;
  const cells=[c], stand=pipeStandCells(cells);
  return {id:"port:"+pid, name:portLabel(pid), w:1, h:1,
          access: stand.length>0, cells, stand, isRun:true, isPort:true};
}
const portIds = () => Object.keys(D.ports);
/* Anything s.dmgParts can hold, resolved to the one shape the repair path
   reads: id, name, access. A pipe cell is not in LAY.parts, so every caller
   that looked a damage id up directly got `undefined` for one and quietly
   rendered it as a raw id that could never be reached. Three readers (the
   dispatcher, the dose rate, the damage card), one resolver. */
function dmgPart(id){
  if(typeof id !== "string") return partOf(id) || null;
  if(id.indexOf("port:")===0) return portCellPart(id.slice(5));
  if(id.indexOf("pipe:")!==0) return partOf(id) || null;
  const k=id.slice(5), i=k.indexOf(",");
  return i<0 ? null : pipeCellPart(+k.slice(0,i), +k.slice(i+1));
}
/* IS THIS PORT WRECKED - the one predicate, so the act that refuses, the
   colour that says so and the list that reports it cannot disagree. NOT
   portDead() (layout.js): that one is the set of nodes a SHUT valve kills,
   which is a different question about the same box. */
const portWrecked = (s,pid) => !!(s && s.dmgParts && s.dmgParts.indexOf("port:"+pid) >= 0);

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
  /* THE HAND-PICKED LANE FIRST, THE SEARCH ONLY WHEN IT DOES NOT FIT. Every
     run on the reference ship is laid exactly where its own comment says, and
     a plant this arrangement has no room for gets a route found for it rather
     than a line drawn through a machine. */
  if(pathBlocked(path, ca, cb)){
    const r = pipeRoute(a1, b1, ca, cb);
    if(r) path=[a1].concat(r);
    /* A RUN THAT COULD NOT BE LAID SAYS SO. pipeLay() drops the cells it
       cannot have and leaves a line with a hole in it, which reads downstream
       as a circuit that simply is not there - the quietest failure on the
       board. The nozzle refusal beside it has warned since the day it was
       written; this is its other half. */
    else console.warn("stock run refused",
      (D.ports[pa]||{}).p+"@"+ca, "->", (D.ports[pb]||{}).p+"@"+cb);
  }
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
  /* ══ HOW MANY REACTORS, AND HOW MANY ENGINE ROOMS ══
     A UNIT is a reactor and the loops around it; a SET is a turbine, its
     condenser and the feed pump under it. They are counted separately because
     a real multi-unit station shares the engine room and not the water: four
     units against two sets is the drawing this exists to be able to make.
     Both default to 1, and at 1 every offset below is 0 and every id keeps the
     bare name it always had - so the reference ship is this same code and is
     bit-identical by construction, not by a second branch. */
  const units = (opt && opt.units) || 1;
  const sets  = (opt && opt.sets)  || 1;
  const perSet = Math.max(1, Math.ceil(units/sets));
  const setOf  = u => Math.min(sets-1, Math.floor(u/perSet));
  const multi  = units>1 || sets>1;
  /* ══ A UNIT GETS ITS OWN BAND, NEVER A COLUMN BESIDE ANOTHER ══
     Two units side by side cannot be plumbed: the rod drives fill the rows
     above a vessel and the vessel fills the rows below them, so the only
     west-east lane across a band is the one the main steam header needs - and
     the second unit's pressurizer stands in it. Measured, not guessed: the
     header simply never reached the turbine.
     Stacked, every band is the reference ship's own arrangement, which already
     routes, and a set reaches its second unit down the aft columns where there
     is nothing at all. */
  const BAND=40;
  const uOX = u => 0;
  const uOY = u => u * BAND;
  const sOY = s => s * perSet * BAND;   // a set stands in the band of its first unit
  /* THE HULL THIS PLANT NEEDS. The engine room stands aft of the last loop, so
     a four-loop reference plant is a longer ship - and it says so here rather
     than leaving its own turbine standing outside the skin. A multi-unit ship
     is as wide as its widest band and as tall as its sets, and the player may
     still drag it either way afterwards. */
  if(multi){ D.gw = 60 + 7*(loops-1) + 12; D.gh = BAND*units; }
  else     { D.gw = 60 + 7*(loops-1);      D.gh = 34; }
  /* WHAT THIS SHIP DOES NOT CARRY. A preset that placed an injection tank and
     a relief valve and then took them off again had built a plant it did not
     mean; this simply never places them, and every nozzle and run that would
     have gone to one is skipped with it. */
  const drop = new Set((opt && opt.drop) || []), has = id => !drop.has(id);
  for(const k   in D.pipes) delete D.pipes[k];
  for(const pid in D.ports) delete D.ports[pid];
  for(const id  in D.tanks) delete D.tanks[id];
  for(const id  in D.fittings) delete D.fittings[id];
  /* AND EVERY MACHINE, because a preset is the whole ship. There is no fixed
     slot left for a rebuild to conjure back, so the plant being torn down goes
     away completely and the one being built is placed gesture for gesture. */
  for(const id  in D.machines) delete D.machines[id];
  for(const id  in D.name)     delete D.name[id];
  buildLayout();

  /* ══ THE MACHINERY, PLACED ══
     Every box below goes on the board through mintMachine() - the same call
     ADD MACHINE makes - so a preset cannot describe a plant the player could
     not have built, and every one of them can be dragged or taken off again.
     ORDER IS THE NAMING: an ordinal is read off the drawing in board order
     (buildLayout()), so the coolant pumps are minted before the feed and
     circulating water pumps and read RCP 1..n. */
  const GHc=D.gh, BOT=GHc-4;
  /* THE FIRST OF ANYTHING KEEPS THE BARE NAME. A machine id carries no meaning
     (mintMachine()), so this is only about the reference ship coming out of
     this pass with the identical dictionary it always had. */
  const sfx = n => n ? String(n) : "";
  /* A LOOP'S OWN COLUMN, in its unit's own frame. TWO CELLS FURTHER AFT on a
     banded ship: the main steam header arrives from the WEST there, so the
     steam tee needs a free cell on that side - and at the reference spacing
     that cell is the relief tank's last column. The reference ship never asked
     for the port, because its first tee has nothing to its west. */
  const X  = i => (multi?28:26)+7*i;
  const uX = (u,i) => X(i) + uOX(u);         // ...and on the board
  // stacked units share their columns, so the engine room stands where it
  // always did - only further apart, band by band
  const AFT   = 46+7*(loops-1) + (multi?2:0);
  const FEEDX = 26+7*loops + (multi?2:0);
  /* A SET'S OWN ROWS. On a single-band ship these are the literals the
     reference plant was drawn at; on a banded one the engine room is stacked
     inside its own band, aft of every unit that feeds it. */
  const turbY = s => multi ?  3+sOY(s) : 11;
  const condY = s => multi ? 13+sOY(s) : 24;
  /* THE FEED PUMP'S LEFT FACE IS THE FEEDWATER LANE, one nozzle per line, so
     where it stands IS which rows those lines run along. Below every vessel in
     the band and below the bilge rows the cold returns take. */
  const feedY = s => multi ? 30+sOY(s) : GHc-5;
  // a set's condensate runs along its OWN band's floor, never the ship's
  const setKeel = s => multi ? sOY(s)+BAND-1 : GH-1;
  for(let u=0;u<units;u++){
    const U=sfx(u), ox=uOX(u), oy=uOY(u);
    mintMachine("core"+U,"core",6+ox,13+oy);   // and its rod drives, which ride the head
    for(let i=0;i<loops;i++) mintMachine("sg"+(u*loops+i),"sg",uX(u,i),5+oy);
    for(let i=0;i<loops;i++) mintMachine("pump"+(u*loops+i),"pump",uX(u,i),18+oy);
  }
  /* ══ AND IT STANDS BELOW WHAT IT DRAWS ON ══
     A pump takes suction on the face its casing says (ROLE.pump), and static
     head is real in the solve - so a feed pump hung level with the turbine had
     to LIFT its own condensate nine metres out of a condenser sitting at
     0.008 MPa, pulled its own suction below zero and cavitated on a plant
     nobody had touched. It sits under the condenser's outlet instead, which is
     where a real one is and for the identical reason. */
  for(let s=0;s<sets;s++){
    const S=sfx(s);
    mintMachine("turb"+S,"turb",AFT,turbY(s));
    mintMachine("cond"+S,"cond",AFT,condY(s));
    mintMachine("feed"+S,"pump",FEEDX,feedY(s));
    setPartName("feed"+S,"FEED PUMP");
  }
  mintMachine("ctrl","ctrl",0,BOT);
  if(has("cont")) mintMachine("cont","cont",10,BOT);
  /* ON THE KEEL WHEN THERE IS MORE THAN ONE SET. It stands beside the turbine
     on the reference ship, and that is the row a banded ship's condenser puts
     its own cooling nozzle on - the backup supply landed on the condensate
     line and the set had no feedwater at all. It is one machine for the ship
     either way, so it goes where the rest of the ship's own gear is. */
  mintMachine("bkp","bkp",AFT+10, multi ? GHc-12 : 11);
  /* ══ THE PANELS, ON THE KEEL ══
     Two of them rather than one because a radiator is what gets shot, and the
     hull ring is already ten times more likely to be hit - a STARTING DESIGN,
     not a count in code. SPACED, not shoulder to shoulder: sitting directly
     under the condenser they had no usable nozzle at all.
     ANCHORED BY THE BOTTOM EDGE, which is what the cell stores for a panel
     (cellStore()), so its face stays on the skin whatever area it is given. */
  const radAt=(id,x)=>{ mintMachine(id,"radiator",x,0);
    D.machines[id].cell=[x,BOT+3]; buildLayout(); };
  radAt("rad0",AFT-10); radAt("rad1",AFT-2);
  /* ── AND SOMETHING HAS TO TURN THE CIRCULATING WATER ──
     The condenser rejects into a loop, and a loop with nothing pushing it
     carries nothing. It is a pump like every other pump: hit it, or lose the
     board it feeds off, and the sink goes.
     FOUR ROWS ABOVE THE PANEL'S OWN TOP, never a fixed row. The joint below it
     is two nozzles meeting across a cell boundary, so it needs exactly one
     free row each. It KEEPS ITS COLUMN and takes its suction on the RIGHT
     FACE: a full-height pump standing here reaches up into the reserve tank's
     rows, so a top nozzle has no cell to stand in. */
  mintMachine("cwp","pump",AFT-9,BOT+1-partOf("rad0").h-pumpH("cwp"));
  setPartName("cwp","CIRC WATER PUMP");
  /* ══ THE STOCK SHIELDING ══
     Three blocks between the reactor and the control room, placed exactly the
     way ADD SHIELD places one. */
  for(let i=0;i<3;i++) mintMachine("shld"+i,"shield",18+3*i,GHc-4);

  /* ══ THE TANKS ══
     A STARTING DESIGN, exactly like the default rod count - not code. Every
     field is the player's (see the tank contract above); nothing anywhere
     may ask which one of these is "the HPI tank", because there is no such
     thing. Each starts from TANK_DEFAULT through mintTank() and is then set
     the way its own bench panel would set it. */
  // buildLayout AFTER the assign as well: a tank's BOX follows its `vol`, so
  // mintTank()'s own rebuild is against the default size, not this one's
  /* WHAT A PRESET DOES NOT CARRY IS NAMED ONCE, BY ITS BASE. `drop` lists the
     kind of thing a ship goes without - its injection water, its relief valve
     - and a four-unit station goes without it on every unit or on none, so the
     test is on the base name and the unit's suffix is added after. */
  const tank = (base,U,x,y,cfg) => { if(!has(base)) return null;
    const id=base+U; mintTank(id,x,y); Object.assign(D.tanks[id],cfg); buildLayout(); return id; };
  const fitting = (base,U,x,y,cfg) => { if(!has(base)) return null;
    const id=base+U; mintFitting(id,x,y); Object.assign(D.fittings[id],cfg); return id; };
  // a nozzle and a run are skipped with the machine they were going to: a
  // line with one end missing is not a shorter line, it is no line
  const port = (pid,dx,dy) => pid && partOf(pid) ? seedPort(pid,dx,dy) : null;
  const run  = (a,b,...rest) => (a && b) ? seedRun(a,b,...rest) : null;

  /* ══ ONE UNIT'S OWN GEAR, ONCE PER UNIT ══
     Everything below belongs to a reactor rather than to the ship: its
     injection water, its pressurizer, the relief path behind it, its surge
     tee and one steam tee and safety valve per generator. At units 1 the
     offsets are 0 and the suffix is empty, so this lays the reference plant
     cell for cell. */
  const UN=[];                       // one bag of ids per unit, for the runs below
  for(let u=0;u<units;u++){
  const U=sfx(u), ox=uOX(u), oy=uOY(u);
  // the reserve's own column - off X() so it follows the loop columns rather
  // than repeating their spacing, or a banded ship stands its pump on its tie
  // ...and it walks aft with its own tie, or a later unit stands its reserve
  // pump on the tee that pump is supposed to feed
  const EFWX = ox + X(loops) + Math.max(3,loops) + 1 + (multi?u:0);

  tank("hpi",U,ox+1,oy+19,{ name:"HPI TANK", col:"#5aa9d6",
    tip:"Emergency injection water, and its one line into the loop. Mount it HIGH: its own column is real head, and it only injects while it is winning against the pressure in the loop.",
    vol:57, level:100, fluid:"water",
    /* A NITROGEN CHARGE, not a charging pump. Against a primary at 15.5 MPa a
       11.0 MPa machine delivers nothing until the loop has blown down under
       it, which is an accumulator's duty cycle and not a pump's - and an
       accumulator is the one injection path a blackout does not kill. Full, it
       sits at exactly the 11.0 the old field stated; it tapers to 2.85 as it
       drains, which is what a gas bottle does. */
    gas:{p0:11.0, frac:0.35}, check:true, auto:"manual", burst:null});
  /* ONE LANE CLEAR OF THE VESSEL. A nozzle is a CELL and the run leaving it
     needs the next cell too, so how far out this stands follows its own
     WIDTH - which follows its volume now. Set after minting, because the box
     does not exist until the volume is on it. */
  if(D.tanks["hpi"+U]){
    D.tanks["hpi"+U].cell = [Math.max(0, partOf("core"+U).x - partOf("hpi"+U).w - 2), oy+19];
    buildLayout(); }

  /* ══ THE PRESSURIZER IS A TANK ══
     `hold` and nothing else. It is minted through the same tank() helper as
     every other one, so there is no second draw branch, no second panel and
     no second act - and a second hold tank on a second circuit is a design
     rather than a bug. It commissions OPEN through auto:"always", the relief
     tank's own idiom, so no new default is needed in resetPlant(); bypassing
     it from the control room isolates the vessel and the circuit relaxes to
     containment, which is a capability that falls out rather than a case. */
  tank("pzr",U,ox+15,oy+1,{ name:"PRESSURIZER", col:"#a98cf0",
    tip:"Sets the pressure of the circuit it is piped to. It has to sit high - the steam bubble must stay at the top of the loop.",
    vol:50, level:54, fluid:"water",
    gas:null, check:false, auto:"always", burst:null,
    hold:{p:null}, tsurv:800, pburst:200});

  /* THE RELIEF HEADER'S OWN COLUMNS, off the vessel's box rather than off
     literals - a tank's footprint follows its VOLUME now, so a nozzle, a
     valve and a catch tank authored at fixed columns collide the moment the
     vessel is a different width. Two ports may not share a cell, so each of
     the three stands one clear of the last. */
  const PZR_W = partOf("pzr"+U).w, RV_X = ox+15+PZR_W+2, RELTK_X = RV_X+3;
  tank("reltk",U,RELTK_X,oy+0,{ name:"RELIEF TANK", col:"#8a6cd0",
    tip:"Catches what the relief valve vents. It fills as the valve passes flow, and a full tank is a place a repair party would rather not stand.",
    vol:35, level:0, fluid:"contaminated",
    /* At rest the gas sits at containment pressure, which is what makes an
       empty tank cost the relief path exactly nothing. frac is 25/23 because
       the law this replaces compressed at 0.92 per unit level, and
       1/0.92 = 25/23. */
    gas:{p0:0.15, frac:25/23}, check:false, auto:"always",
    burst:{at:1.4, drain:6.0, rel:0.004}});

  /* BESIDE THE FEED PUMP, TIED INTO THE FEEDWATER LINE. It used to have its own
     nozzle on generator 1 and its own line across the ship, which is a lane
     every added loop needs and a second nozzle in the one gap that has no room
     for one. On the line it reaches whatever the feed pump reaches - which is
     what an emergency feedwater tie IS. */
  tank("efw",U,EFWX,oy+18,{ name:"EFW TANK", col:"#5aa9d6",
    tip:"Independent feedwater reserve, tied into the feedwater line through its own pump. It starts on LOW GENERATOR LEVEL, not on being armed - an emergency pump feeding a healthy generator overfills it.",
    vol:19, level:100, fluid:"condensate",
    /* What PUSHES it is the machine standing beside it (efwp), not a field on
       the vessel; what keeps it shut on a healthy plant is its AUTORULE,
       because "starts on LOW GENERATOR LEVEL, not on being armed" is a rule
       and not a coincidence of numbers.
       BLANKETED, and that is NPSH and nothing else. Vented at P.Pcont the
       suction has 0.15 MPa to spend on a line, a lift and an impeller eye: the
       pump flashed its own suction before it reached rated speed and never
       delivered a drop. A cover gas is what a real reserve on a pump's suction
       carries, and it is worth nothing against the header on its own - the
       machine is still what does the pushing. */
    gas:{p0:1.5, frac:0.35}, check:false, auto:"sglow", burst:null});
  /* ══ AND THE RESERVE HAS ITS OWN PUMP, ON THE BOARD ══
     Beside its own tank, so the SUCTION is a few cells and the DISCHARGE
     carries the length of the ship - which is what a real emergency feed pump
     is, and the only arrangement that does not hand the machine a lift it
     derates on. Spliced HORIZONTALLY: ROLE.pump folds r onto t and l onto b,
     so suction is the right face and discharge the left. */
  if(has("efw")){
    mintMachine("efwp"+U,"pump",EFWX-3,oy+10);
    setPartName("efwp"+U,"EFW PUMP");
  }

  /* ══ THE FITTINGS ══
     A STARTING DESIGN, exactly like the tanks: every field is the player's,
     and nothing anywhere may ask which one of these is "the surge tee". */
  const tee0 = fitting("tee0",U,ox+20,oy+14,{ name:"SURGE TEE", mode:"tee", bore:boreMm("hot"),
    tip:"The junction where the pressurizer meets the loop. A tee costs nothing and closes nothing - it is one node with four faces." });
  const rv0  = fitting("rv0",U,RV_X,oy+2,{ name:"RELIEF VALVE", mode:"relief", bore:boreMm("relief"),
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

  /* ══ ONE MAIN STEAM HEADER, ONE TEE PER GENERATOR ══
     A line per generator cannot be drawn: the safety valves must stand on the
     top hull, so they own the two rows a second and third steam lane would
     need. A header is what the real machine has anyway, and it is built out of
     the fitting the bench already hands you. The tee stands two rows over its
     own generator, so its BOTTOM port faces the steam nozzle across a cell
     boundary - two ports facing each other are a joint and need no pipe - and
     its TOP port carries the safety valve the same way. */
  // IN LOOP 0'S OWN FEED RISER, not beside the pump: the feedwater lines leave
  // the pump's DISCHARGE face - which is its bottom, because that is where the
  // casing puts it - so the lane the reserve has to reach them on is the riser
  // climbing to the first generator, and the tie stands in it.
  const efwtee = fitting("efwtee",U, uX(u,0)+5+(multi?u:0), oy+12, { name:"EFW TIE", mode:"tee", bore:boreMm("feed"),
    tip:"Where the emergency reserve meets the feedwater line. A tee closes nothing: the reserve waits behind its own check valve until the line pressure falls under it." });
  const mstee=[], svf=[];
  for(let i=0;i<loops;i++){
    const li = u*loops+i;
    mstee[i]=fitting("mstee"+li,"", uX(u,i)+1, oy+2, { name:"STEAM TEE "+(li+1), mode:"tee", bore:boreMm("steam"),
      tip:"Where this generator's steam meets the main header, and where its safety valve stands." });
    /* ONE CELL CLEAR OF THE TEE, not against it: two ports in adjacent cells
       are a joint only when they FACE each other, and this valve's own port
       looks along the hull rather than down at the tee. The cell between them
       is the tap. */
    svf[i]=fitting("sv"+li,"", uX(u,i)+3, oy+0, { name:"SG SAFETY "+(li+1), mode:"relief", bore:412.5, tip:svTip });
  }
  UN[u] = {U, ox, oy, tee0, rv0, efwtee, mstee, svf};
  }
  buildLayout();                     // the boxes have to be on the grid before a port can sit beside one

  /* No cell: a SECONDARY tank has no node, so it needs none, and the hotwell
     lives inside the condenser it condenses into. Giving it a box would be
     inventing hydraulics the secondary does not have. ONE for the ship, not
     one per unit: it is where the condensate is, and every set condenses into
     the same secondary inventory. */
  tank("hotwell","",null,null,{ name:"HOTWELL", col:"#5aa9d6",
    tip:"Condensate returning from the condenser, and what the feed pumps draw on. A tube rupture puts primary water in here and it has to go somewhere.",
    /* Half again what the generators themselves hold - it has to be able to
       take a generator's WHOLE charge back plus what an emergency reserve
       pushes through it, or the answer to losing feedwater is to overflow the
       condensate over the side. */
    vol:83, level:50, fluid:"condensate",
    gas:null, check:false, auto:"always", burst:null});

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
     A lane that shares a row with anything else MERGES with it, which is how a
     hot leg once came to land on a generator's feedwater nozzle. The hot legs
     have the band between the vessel and the pumps to themselves now: the feed
     lines leave the pump's discharge, which is its underside, so their lane is
     FEED_ROW below the coolant pumps - one row per loop, walking DOWN as the
     loop index rises while the cold legs walk down too, so a feed line and a
     bilge run share a row only where their spans cannot overlap. */
  /* loop 3 leaves the vessel at its FLOOR: row 13 is blocked at one cell by
     the surge tee's own nozzle, and one port cell stops a lane as dead as a
     machine does. */
  const HOT_ROW =[14,15,16,24];      // out of the vessel, east to its own riser
  const HOT_COL =[null,29,36,43];    // the gap forward of the generator
  /* one lane per feed line, on the pump's own left face and walking UP as the
     loop index rises - the bilge rows walk DOWN, so a feed line and a cold
     return share a row only where the loop count puts them at opposite ends of
     the ship and their spans cannot meet. */
  const FEED_ROW= (s,i) => partOf("feed"+sfx(s)).y+3-i;
  /* THE COLUMN IT CLIMBS, two clear of the shell - AND ONE PER UNIT. Stacked
     units share their columns, so every riser asked for the same lane and the
     second unit's feed line merged into the first one's instead of reaching
     its own generator. A lane is a lane whoever wants it. */
  const feedCol = (u,i) => uX(u,i)+5+(multi?u:0);
  const COLD_ROW=[26,27,28,29];      // one bilge row per loop
  const KEEL=GH-1;
  /* OFF THE VESSEL'S OWN BOX, never off the stock ship's - the same move the
     radiator nozzles already make. A tank's footprint follows its VOLUME now
     (tankW/tankH), so a nozzle authored at a literal 3x6 lands outside it. */
  const tankBox = id => { const p=partOf(id); return {w:p?p.w:1, h:p?p.h:1}; };
  /* ══ EVERY NOZZLE A UNIT OWNS ══
     Each is off that unit's OWN boxes, so a second reactor's hot leg leaves
     its own vessel and its surge line lands on its own tee. */
  for(const n of UN){
    const U=n.U;
    n.coreHot  = i => seedPort("core"+U,9,HOT_ROW[i]-13);
    // centred on the vessel's own floor, two cells apart
    n.coreCold = i => seedPort("core"+U,faceMid(9,i,2),12);
    // the cell that return lands under, off the vessel's own column
    n.coreBilge= i => partOf("core"+U).x+faceMid(9,i,2);
    n.pCoreHot = n.coreHot(0);
    /* dx 1, not the corner: the fourth cold return IS the corner (faceMid spreads
       4,2,6,0), and two ports cannot share a cell - so a four-loop plant used to
       lose its injection line to its own last loop. */
    n.pCoreHpi = has("hpi") ? seedPort("core"+U,1,12) : null;
    const pzrB = tankBox("pzr"+U), relB = tankBox("reltk"+U), hpiB = tankBox("hpi"+U);
    n.pPzrSurge= seedPort("pzr"+U,1,pzrB.h);
    n.pPzrRel  = has("rv0") ? seedPort("pzr"+U,pzrB.w,1) : null;
    n.pTeeL    = seedPort(n.tee0,-1,0);
    n.pTeeT    = seedPort(n.tee0,0,-1);
    n.pTeeR    = seedPort(n.tee0,1,0);
    n.pRvL     = port(n.rv0,-1,0);
    n.pRvR     = port(n.rv0,1,0);
    n.pRelTk   = port("reltk"+U,-1,clamp(2,0,relB.h-1));
    n.pHpi     = port("hpi"+U,hpiB.w,clamp(2,0,hpiB.h-1));
    n.pEfw     = partOf("efw"+U)  ? seedPort("efw"+U,0,-1) : null;   // out of the top, up into the pump's suction
    n.pEfwpSuc = partOf("efwp"+U) ? seedPort("efwp"+U,3,2) : null;   // r face -> folds onto t: SUCTION
    n.pEfwpDis = partOf("efwp"+U) ? seedPort("efwp"+U,-1,2) : null;  // l face -> folds onto b: DISCHARGE
  }
  /* ══ AND EVERY NOZZLE A SET OWNS ══ */
  const ST=[];
  for(let s=0;s<sets;s++){ const S=sfx(s);
    // ONE steam nozzle per turbine, because a set has one main steam HEADER
    ST[s]={ S, s,
      pTurbT: seedPort("turb"+S,4,-1),
      pTurbB: seedPort("turb"+S,faceMid(9,0),7),
      pCondT: seedPort("cond"+S,faceMid(9,0),-1),
      pCondR: seedPort("cond"+S,9,faceMid(5,0)) };
  }
  /* THE COOLING CIRCUIT. A panel is plumbed now, so the condenser's water side
     runs down into it and the two are their own connected component - which is
     all "COOLING" means. Both panels are in the line, in series.
     The circulating water pump stands in that line, so the circuit solves at a
     real flow: pull it off the drawing and the condenser rejects nothing,
     which is what a plant with nothing turning its cooling water reads. */
  for(const t of ST) t.pCondCwO = seedPort("cond"+t.S,-1,4);
  /* SUCTION ON THE RIGHT FACE, not the top: the emergency feedwater tank
     stands over this pump's own columns, so a top nozzle has no cell. ROLE.pump
     folds r onto t, so this is the same suction node either way. */
  const pCwpR     = seedPort("cwp",partOf("cwp").w,faceMid(partOf("cwp").h,0));
  const pCwpB     = seedPort("cwp",1,partOf("cwp").h);
  /* The panel's TOP face, not its left: ROLE.radiator folds t onto l, so it is
     the same node, and the pump stands directly over it - two ports facing
     each other across a cell boundary are a joint and need no pipe. */
  /* OFF THE PANEL'S OWN BOX, never off the stock ship's. A panel states an
     AREA now and the drawing snaps to it (radW()/radH(), layout.js), so a
     small plant's panel is a small box - and a nozzle authored at the stock
     5x3's far corner lands outside it. Measured: WINDSCALE's rad1 refused
     both its ports, which is a plant with no heat sink at all. */
  const radBox    = id => { const p=partOf(id); return {w:p?p.w:1, h:p?p.h:1}; };
  const rad0      = radBox("rad0"), rad1 = radBox("rad1");
  /* THE COLUMN THE PUMP IS STANDING IN, not the middle of the panel's own top
     face. The joint below is two nozzles meeting across a cell boundary, and
     the panel's width follows its AREA - so faceMid() put the nozzle under the
     pump on a five-wide stock panel and one cell clear of it on a three-wide
     small-plant one, which is the whole cooling circuit gone with nothing said.
     Clamped onto the face, so a panel narrower than the offset still gets a
     legal nozzle and seedRun() lays real pipe to reach it. */
  const pRad0T    = seedPort("rad0",
    clamp((partOf("cwp").x+1)-partOf("rad0").x, 0, rad0.w-1), -1);
  const pRad0R    = seedPort("rad0",rad0.w,faceMid(rad0.h,0));
  const pRad1L    = seedPort("rad1",-1,faceMid(rad1.h,0));
  const pRad1R    = seedPort("rad1",rad1.w,faceMid(rad1.h,0));
  /* ONE COLUMN AFT OF THE SECOND PANEL, never a literal 4. The return comes up
     the panel's own right-hand column, so a nozzle standing over that column
     has the run climbing through the cell it starts in - which is what a wider
     panel did to it. Reads back the stock 4 to the cell. */
  for(const t of ST) t.pCondCwI = seedPort("cond"+t.S,
    clamp((partOf("rad1").x+rad1.w+1)-partOf("cond"+t.S).x, 0, partOf("cond"+t.S).w-1), 5);
  /* ══ THE CASING SAYS WHICH WAY ROUND THIS PUMP GOES ══
     ROLE.pump takes suction on `t` and discharges on `b`, and folds l onto b -
     so the condensate arrives on the TOP nozzle and the generators are fed off
     the LEFT face, one nozzle each. This plant used to be plumbed the other
     way about, because the old feed head cancelled whatever standing
     difference it found and pushed either way; under one head law that is a
     pump running backwards. The pump stands under the condenser's outlet
     (buildLayout()), so the suction line runs level and the feed lines climb
     each loop's own riser from the bottom of the ship. */
  /* ONE NOZZLE PER LOOP THIS SET FEEDS, and a set may feed more than one
     unit - so the index is the loop's ordinal WITHIN the set, never the
     plant's. */
  for(const t of ST){
    t.feedL  = k => seedPort("feed"+t.S,-1,3-k);
    t.pFeedR = seedPort("feed"+t.S,partOf("feed"+t.S).w,4);
  }

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
  const sgPorts = li => ({
    l:     seedPort("sg"+li,-1,1),
    b:     seedPort("sg"+li,1,6),
    steam: seedPort("sg"+li,1,-1),
    feed:  seedPort("sg"+li,3,0),
  });
  /* ══ ONE LANE PER RUN, AND THE TABLE IS THE PROOF ══
     Between the shells and the pumps there are seven rows, and eight lines
     want one: four hot legs and four feedwater lines. Row 14 carries two
     because loop 0's hot leg is three cells long and stops at the surge tee,
     west of where any feed line begins - the one legal overlap on the board.
     A lane that shares a row with anything else MERGES with it, which is how a
     hot leg came to land on a generator's feedwater nozzle. */
  for(const n of UN){
    seedRun(n.pCoreHot, n.pTeeL);                 // the hot leg out of the vessel
    seedRun(n.pPzrSurge, n.pTeeT);                // the surge line, down onto the tee
    run(n.pPzrRel, n.pRvL);                       // relief: vessel to valve...
    run(n.pRvR, n.pRelTk);                        // ...and valve to tank
    run(n.pHpi, n.pCoreHpi, true);                // injection, onto the vessel's floor
  }
  /* condensate: aft of the machinery, down to the band's floor and forward into
     the feed pump's suction nozzle. The suction sits BELOW the condenser it
     draws on, so the line has no lift in it - which is the whole point of
     standing the pump on the bottom rank of its own band. Every other lane
     between the two is a port cell or a machine. */
  for(const t of ST){
    const K = setKeel(t.s), fd = partOf("feed"+t.S);
    seedRun(t.pTurbB, t.pCondT, true);            // exhaust
    seedRun(t.pCondR, t.pFeedR, false, [[AFT+10,K],[fd.x+fd.w+1,K]]);
  }
  /* AFT OF THE LAST PUMP, so it never meets a bilge run: the engine room moves
     back with the loop count and the cold returns do not. */
  /* THE ROW IS THE CONDENSER'S OWN, not a literal 28: a taller panel moves
     the pump, and a run pinned to the old row climbed through the cell the
     pump now stands in. The suction is on the pump's right face, so the run
     comes forward along its own row and needs no second corner. */
  /* ══ ONE COOLING CIRCUIT, HOWEVER MANY CONDENSERS ══
     A panel has to SEE THE SKIN to shed anything (radLive(), layout.js), so
     the panels are on the hull and there is one bank of them - every condenser
     on the ship is in series with it and with the others. That is a shared
     circulating water system, which is what a multi-unit station has, and it
     is one connected component like any other. */
  { const first=ST[0], last=ST[ST.length-1], cd=partOf("cond"+first.S);
    seedRun(first.pCondCwO, pCwpR, false, [[AFT-2,cd.y+cd.h-1]]);  // condenser water side, up and forward into the pump's suction
    seedRun(pCwpB, pRad0T);                       // and the pump stands on the first panel - a joint, no pipe
    seedRun(pRad0R, pRad1L);                      // ...through the second, in series...
    seedRun(pRad1R, last.pCondCwI);               // ...and back into the last condenser's water side
    // and every condenser between them, one into the next
    for(let s=0;s+1<sets;s++) seedRun(ST[s+1].pCondCwO, ST[s].pCondCwI);
  }

  /* ══ ONE PASS, ONE LOOP AT A TIME ══
     Six runs each, and the same six whether the loop is the fixed slot or a
     placed pair - which is what makes "the bench can rebuild this, gesture for
     gesture" true of a four-loop plant and not just of the reference one. */
  /* THE HEADER IS THE SET'S, NOT THE UNIT'S. Two units feeding one turbine
     put both their generators on the same header, so the chain runs tee to tee
     across the units of a set and only then aft onto that turbine's nozzle.
     hdr[s] is the last tee laid on set s and nothing more. */
  const hdr = [];
  for(let u=0;u<units;u++){
    const n=UN[u], s=setOf(u), t=ST[s], ox=n.ox, oy=n.oy;
    n.pTieT = seedPort(n.efwtee,0,-1); n.pTieR = seedPort(n.efwtee,1,0);
    n.pTieB = seedPort(n.efwtee,0,1);
    for(let i=0;i<loops;i++){
      const li = u*loops+i;                    // this generator, on the plant
      const k  = (u%perSet)*loops+i;           // ...and its line's ordinal within its SET
      const g = sgPorts(li);
      const pT = seedPort("pump"+li,1,-1), pB = seedPort("pump"+li,1,partOf("pump"+li).h);
      const teeB = seedPort(n.mstee[i],0,1), teeT = seedPort(n.mstee[i],0,-1);
      const teeL = hdr[s]!=null ? seedPort(n.mstee[i],-1,0) : null;
      const teeR = seedPort(n.mstee[i],1,0);
      const pSv  = seedPort(n.svf[i],-1,0);
      // primary: vessel to shell, shell to pump, pump back along its own bilge row
      if(i) seedRun(n.coreHot(i), g.l, false, [[HOT_COL[i]+ox,HOT_ROW[i]+oy],[HOT_COL[i]+ox,6+oy]]);
      else  seedRun(n.pTeeR, g.l, true);
      seedRun(g.b, pT, true);
      seedRun(pB, n.coreCold(i), false, [[uX(u,i)+1,COLD_ROW[i]+oy],[n.coreBilge(i),COLD_ROW[i]+oy]]);
      // secondary: the nozzle faces the tee's own port across one cell - a joint,
      // no pipe - and so does the safety valve above it
      seedRun(g.steam, teeB);
      seedRun(teeT, pSv);
      if(hdr[s]) seedRun(hdr[s], teeL);         // ...and the header, tee to tee
      hdr[s] = teeR;
      /* DOWN, WEST, UP: out of the discharge nozzle under the pump, along its own
         row below the coolant pumps, and up the same riser the loop's own column
         already reserves. THE FIRST LOOP OF A UNIT is the one that unit's reserve
         is tied into, so it is two runs through the tie standing in that riser
         rather than one straight through it. */
      if(i) seedRun(t.feedL(k), g.feed, false,
        [[feedCol(u,i),FEED_ROW(s,k)],[feedCol(u,i),5+oy]]);
      else { seedRun(t.feedL(k), n.pTieB, false, [[feedCol(u,0),FEED_ROW(s,k)]]);
             seedRun(n.pTieT, g.feed, false, [[feedCol(u,0),5+oy]]); }
    }
  }
  // each header's aft end, down onto its own turbine's one steam nozzle
  for(let s=0;s<sets;s++)
    if(hdr[s]) seedRun(hdr[s], ST[s].pTurbT, false, [[AFT+4, 2+sOY(s)]]);
  // the reserve, up out of its own tank into the pump beside it, and west
  // along its own row into the tie
  for(const n of UN){
    run(n.pEfw, n.pEfwpSuc);
    run(n.pEfwpDis, n.pTieR);           // a JOINT: the two nozzles face each other, zero pipe
  }
  /* ══ AND A SUCTION LINE IS BIGGER THAN A DISCHARGE LINE ══
     A vented reserve has only the compartment behind it, so everything the
     line costs comes straight off the pump's own NPSH: at the feedwater bore
     the stock suction lost 0.16 MPa at 30 kg/s, pulled the suction node to
     -0.05 MPa absolute and cavitated a machine standing under a full tank.
     Conductance goes as bore squared (resist(), above), so twice the bore is
     a quarter of the loss. A BORE, in millimetres, on the run - the same
     figure the run's own panel states. */
  buildLayout();
  for(const n of UN){ const suc = runBetween("efw"+n.U,"efwp"+n.U);
    if(suc) D.bore[suc] = 2*boreMm("feed"); }

  buildLayout();
}
/* NO CALL HERE. A BLANK GRID IS WHERE A NEW PLANT STARTS: nothing is on the
   ship because the code put it there, and the stock ship is the first row of
   PLANTPRE below - a preset like every other. */

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
 ["STOCK PWR",{loops:1,arch:0,d:{cont:1,bkp:1,sg:0,chim:0.3}},
  "The reference ship: one pressurised water loop, a pressurizer with a relief valve behind it, injection water, an emergency feedwater tie, a turbine, a condenser and two panels. Everything the other presets add or take away is measured against this."],
 ["NUSCALE",{loops:1,arch:0,lat:1,d:{cont:1,bkp:1,sg:0,pzr:0.8,chim:0.5}},
  "A small compact PWR module: one loop, a tall tight core, a suppression pool and a battery. Light, cheap and slow to bite. The real module circulates by itself and has no pump at all; this one keeps its RCP."],
 ["BWR/4",{loops:2,arch:1,d:{cont:1,bkp:1,sg:0,pzr:0.7,chim:0.4}},
  "Two recirculation loops boiling at 7 MPa - the Fukushima Daiichi machine. Power follows flow instantly and margin to dryout is thin, so it will not forgive a flow transient the way a pressurised plant does."],
 ["BN-600",{loops:3,arch:3,d:{cont:2,bkp:2,sg:1,pzr:0.6,chim:0.4}},
  "Three primary sodium loops at atmospheric pressure, once-through steam generators, diesels and a large dry containment. Enormous boiling margin and a prompt lifetime forty times shorter than water - it answers a rod before you have finished moving it."],
 ["EPR",{loops:4,arch:0,lat:2,d:{cont:2,bkp:2,sg:0,pzr:1.3,chim:0.3},
   place:[["catcher","catcher",6,30]]},
  "Four loops round a wide squat core, large dry containment, diesels and a core catcher. The heavy one, and the one with margin everywhere: low peaking, high DNBR, minutes of generator water after feedwater is lost."],
 ["RBMK-1000",{loops:2,arch:2,d:{cont:0,bkp:1,sg:1,pzr:1.0,chim:0.3}},
  "Two coolant loops through a graphite pile, gravity scram and no containment - because the real one had none that would hold. Boiling the water ADDS reactivity here, so the plant hunts itself and the slow rods arrive late."],
 ["MSRE",{loops:1,arch:4,d:{cont:1,bkp:1,sg:1,pzr:0.5,chim:0.6}},
  "Molten salt through a graphite matrix at no pressure at all, one loop, once-through boiler. Almost no xenon pit and hours of grace; what it will do instead is freeze solid if you let it get cold."],
 ["WINDSCALE",{loops:1,arch:5,d:{cont:0,bkp:0,sg:1,pzr:0.5,chim:0.2},
   drop:["hpi","rv0","reltk"], tanks:{efw:{vol:5}}},
  "A graphite pile with no containment, no backup power, no injection water and no relief valve on the loop. It runs perfectly well and every single fault is uncovered - lose the bus and the pumps stop, overpressure the loop and nothing lifts, and there is nothing to inject with at all. Fly it to see what the safeguards on every other preset are FOR."],
 /* FOUR REACTORS AGAINST TWO TURBINES, and nothing about it is exotic: it is
    the STOCK PWR's own gear four times over, on one hull. It is here to be
    FLOWN AT, not admired - the cost of a fourth reactor is what it measures,
    so every unit is the same small compact core and only the count varies. */
 ["QUAD",{units:4,sets:2,loops:1,arch:0,lat:1,d:{cont:1,bkp:1,sg:0,chim:0.3}},
  "Four small identical pressurised units on one hull, one loop each, two units to a turbine. Nothing here is exotic: it is the STOCK PWR four times over, sharing one circulating water system the way a real multi-unit station shares its cooling. Fly it to see what four reactors cost to run - and trip a turbine to lose half the station instead of all of it."],
];
function plantPreset(i){
  const q=PLANTPRE[i][1];
  /* THE LAST PLANT'S FIGURES ARE NOT THIS ONE'S. Machine sizes and control
     positions are per-instance on D (designForget(), design.js) and outlive a
     rebuild, so without this a preset commissioned on the previous preset's
     generators, pumps and rod position. */
  designForget();
  archPreset(q.arch);                    // buys the materials and redraws the core
  if(q.lat!=null) latPreset(q.lat);
  Object.assign(D,q.d);
  /* WHAT THIS SHIP IS, laid gesture for gesture. `drop` is handed to the
     builder rather than run afterwards, so a preset without an injection tank
     never places one - it does not place one and take it off again. */
  buildStockPlumbing({loops:q.loops, units:q.units, sets:q.sets, drop:q.drop});
  // and anything this ship carries that the stock one does not, placed the
  // same way ADD MACHINE places it
  for(const g of (q.place||[])) mintMachine(g[0],g[1],g[2],g[3]);
  for(const id in (q.tanks||{})) if(D.tanks[id]) Object.assign(D.tanks[id],q.tanks[id]);
  /* ══ A FIGURE BAKED OFF A HALF-BUILT CORE IS NOT THIS PLANT'S ══
     designForget() at the top is not enough. archPreset() redraws the core in
     stages - lay the fuel, pack the moderator, spread the banks, THEN set the
     length and revolve it - and anything asked for a machine size partway
     through gets a rating off a core that is not finished. bake() WRITES on
     first read, so that answer is then the design.
     Measured on BN-600: every derived figure came out at 0.357 of its own
     suggestion, off a ~600 MWt core that existed for part of one call, against
     the 1679 MWt the preset actually builds. The turbine was bought to swallow
     325 kg/s of the 909 kg/s its own boilers raise, loadCeil() clamped the load
     slider to 36 %, the shells backed up, and all three boiled dry inside ten
     seconds. Every pump was 2.8x small by the same factor.
     The bags go again HERE, after the design is final and before anything is
     allowed to read it. Scalars must NOT be reset with them - q.d has already
     been applied - so this is the bags-only door. */
  dTouch();
  LAY=null; layoutMetrics();             // re-fit the arrangement once, not per gesture
  /* ══ AND THE BAGS GO LAST, AFTER THE LAST THING THAT CAN BAKE ══
     Clearing them BEFORE this line does nothing: layoutMetrics() bakes on the
     very next statement, and n0Ref() caches on a signature dTouch() has only
     just moved - so the refill lands on the same stale rating the clear was
     meant to remove. Measured through the bench's own buttons: turbKgs came
     back 260 kg/s against a suggestion of 846 with the clear one line higher.
     Cleared here, nothing is baked at all until something reads it, and by
     then the design is final. That is what `?? xSuggest()` would give for free
     and what bake() cannot. */
  designForgetBags();
  /* WHERE THIS PLANT'S CONTROLS STAND WHEN IT COMMISSIONS, in the one place a
     bench control writes (D.start). AFTER the bags, because start IS a bag:
     written above it, a preset's own starting positions were cleared by the
     line that clears the machine sizes.
     Every preset commissions with protection DEFEATED, so a plant runs its
     faults out instead of tripping on the first one; a row may still arm it. */
  D.start["byp:rps"] = true;
  Object.assign(D.start, q.start||{});
}
/* THE EMPTY SHIP, which is the one plant no preset can describe: it is where a
   new design starts, so it is the same call with nothing laid after it. */
function plantClear(){
  designClear();
  latDefault();
  dTouch();
  LAY=null; layoutMetrics();
  designForgetBags();
}
