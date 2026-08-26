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
// bore AND the reference bore PORV_INV/PORV_DP are rated against - see
// reliefG()/ventRefG() below.
const PIPE_BORE = {hot:1, cold:1, surge:.30, hpi:.25, xtie:.55, relief:.20};

// A coolant pump's developed head at rated speed, in MPa, before
// loopPumpCap() scales it for what is actually installed. Fitted once and
// stated as such - the RAD_K / RELIEF_REF_LEN idiom - at the head a real
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
// ARCH's `dens` is the coolant family's density on a scale where pressurised
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

function setPipeK(v){ PIPE_K = v; }

// floored at NET_COMP_LEN rather than L itself: a degenerate zero-length run
// (two ports that landed on the same point) still needs a real, PIPE_K-
// scaled resistance, or it would reintroduce exactly the fixed, non-scaling
// term this stage is written to avoid. Module-level, not local to netBuild():
// FIT's own g() functions need it too, evaluated live off a length that can
// include a valve's equivalent length as well as a run's real one.
const resist = (bore, L) => (bore*bore)/(PIPE_K*Math.max(L,NET_COMP_LEN));

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

   BREAK_K is fitted once - the RAD_K / RELIEF_REF_LEN idiom - and it is NOT
   resist(). It cannot be, and the reason is worth stating: every conductance
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
const breakLive = (s, key) => !!(s.dmgParts && s.dmgParts.indexOf("pipe:"+key) >= 0);

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
const secP = s => P.P0*0.45*Math.pow(Math.max(s.load===undefined?1:s.load,.05),.25);
// rated leak, in % of loop inventory per second, at the design differential -
// the flat rate this used to run at, kept as the scale and turned into a
// conductance so the differential can move it
const SGTR_RATE = 0.30;
const sgtrG = () => (SGTR_RATE/100)*P.netRef*LOOP_TRANSIT/Math.max(P.P0*0.55, 0.05);
const sgtrLive = (s, id) => !!(s.dmgParts && s.dmgParts.indexOf(id) >= 0);

/* ══════════ TANK: one row per tank, and adding a tank is adding a row ══════════
   Same idiom as LAYERS, DMGFX, AUTOSYS, FIT, DICE and ANN. There were two
   tanks here and they were mirror images with nothing shared: one an infinite
   source with an elevation frozen at commissioning and a fixed injection
   rate, the other a sink with a level that clamped at full and shrugged.

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

   `vol` is the tank's own inventory measured in the same units s.inv is - %
   of the LOOP - so one conversion carries a solved flow into both numbers and
   a tank cannot leak into the loop's books.
   `pres` is MPa at the tank's own liquid surface.
   `act` is what a full tank of it reads as a radiation source (rad.js). */
const ACC_P0 = 4.5, ACC_GAS = 0.35, HPI_PUMP_P = 11.0;
const RELTK_P0 = 0.15, RELTK_GAS = 0.92, RELTK_DISC = 1.4;
const TANK = {
  hpi: {
    node:"hpib", level0:100, vol:65, act:0,
    /* RATED delivery, in % of loop inventory per second, at full differential
       against containment - the two figures the bench has always promised.
       A tank's edge is priced from this rather than from its line's bore,
       because what limits high pressure injection is the machine behind it,
       not the pipe: a positive-displacement pump delivers its rating until it
       runs into its own shutoff head. The pressure relationship is still the
       whole mechanic - delivery falls off linearly as the loop rises to meet
       the tank and reaches exactly zero when they equalise. */
    rate:()=> D.accum ? 2.6 : 1.6,
    /* A PASSIVE ACCUMULATOR is a nitrogen charge behind a check valve: as it
       empties the gas expands, the pressure falls, and injection tapers
       instead of holding to the last drop. It needs no electricity, so it is
       the one injection path a blackout does not kill - which the bench has
       been selling for as long as it has existed while step() injected at the
       same rate either way. A PUMPED system holds its pressure until the tank
       is dry, and dies with the bus. */
    pres:(s,l)=> D.accum ? ACC_P0*ACC_GAS/(ACC_GAS + (100-l)/100)
                         : (s.blackout && !(!s.bkpLost && autoLive("bkp")) ? 0 : HPI_PUMP_P),
  },
  reltk: {
    node:"reltkl", level0:0, vol:40, act:1, rate:()=>0,
    /* Gas above the water, compressed as the tank fills. At rest it sits at
       containment pressure, which is what makes an empty tank cost the relief
       path exactly nothing. */
    pres:(s,l)=> RELTK_P0/(1 - RELTK_GAS*clamp(l,0,100)/100),
  },
};
const tankLvl = (s,id) => (s.tank && s.tank[id] !== undefined) ? s.tank[id] : TANK[id].level0;
const tankP   = (s,id) => TANK[id].pres(s, tankLvl(s,id));
/* Which way a tank's own edge is allowed to pass anything. HPI's is the
   operator's isolation valve and a tank with nothing left in it; a tank at 0
   with the loop above it can still be FILLED, so the gate is the valve, not
   the level - the level only stops it draining, which the pressure already
   does on its own once the gas has finished expanding. */
/* A tank's edge, priced off its rated delivery: g such that a tank pushing
   against containment passes exactly its rating. P.netRef and LOOP_TRANSIT
   are the same flow-to-inventory conversion invRate() uses in the other
   direction, so the rating on the bench and the flow in the solve are one
   number, not two. */
const tankG = (s,id) => {
  const dp = tankP(s,id) - P.Pcont;
  return dp>0 ? (TANK[id].rate()/100)*P.netRef*LOOP_TRANSIT/dp : 0;
};
/* Which way a tank's own edge is allowed to pass anything. HPI's gates are
   the operator's isolation valve, a tank with something left in it, and a
   CHECK VALVE - an injection line does not run backwards, and without one a
   loop above the tank would push its own coolant into the store meant to
   refill it. Read off last tick's s.pCore rather than this tick's solve,
   because a gate that depends on the answer cannot be part of the question;
   it is a boolean, so the factorisation cache has two states to hold, not a
   continuum. */
const tankOpen = (s,id) => id==="hpi"
  ? !!s.hpi && tankLvl(s,"hpi") > 0 && (s.pCore === undefined || s.pCore < tankP(s,"hpi"))
  : false;

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
// new physics path. Reads s.dmgParts directly rather than a field of its
// own: "pipe:"+key is exactly the id combatHit() pushes there, so DMGFX's
// existing prefix match (step.js) is what hits and fixes it, and no new S
// field is needed for the cloner to already know about.
const pipeExtraLen = (s, key) =>
  (key && s.dmgParts && s.dmgParts.indexOf("pipe:"+key) >= 0) ? Infinity : 0;

/* ══════════ FIT: one row per fitting BEHAVIOUR ══════════
   Same idiom as LAYERS (render/layers.js), DMGFX and AUTOSYS (sim/step.js):
   one table, one row per mode, adding a mode is adding a row. `branch` says
   whether the mode NEEDS a second tap (tee always does; a throttle may sit
   in-line instead - see addFit(), layout.js). `g(s,id,bore,len)` prices the
   fitting's own edge in the same units resist() already uses, so a branch
   built off this table costs a plain resist(bore,len) call either way -
   only which one, and whether it is gated by a boolean or a live position,
   differs by mode. check is a later stage; this table is why adding one is
   adding a row instead of a second netBuild().

   relief is a VENT, not a valve on the circuit: one end is off the loop
   entirely, so mass leaves rather than redistributes, and the circulation
   solve is incompressible - it has no row for a node that stores mass. g is
   therefore a constant 0, always, whatever S carries: never a row of the
   Laplacian, exactly like a shut tee, but unconditionally so rather than by
   S.juncOpen. Its own conductance still prices its own branch pipe (reliefG,
   below) for the vent physics in step.js, which reads it directly and never
   through netAssemble/netFlows - the two never touch. */
const FIT = {
  tee:{
    branch:true,
    g:(s,id,bore,len)=>(s.juncOpen && s.juncOpen[id]) ? resist(bore,len) : 0,
  },
  throttle:{
    branch:"optional",
    g:(s,id,bore,len)=>throttled(s,bore,len,[id]),
  },
  relief:{
    branch:true,
    g:()=>0,
  },
};

/* PORV_INV/PORV_DP (step.js) stop being the plant's own flat vent rate and
   become the rated %/s and MPa/s of ONE FULLY OPEN relief edge of REFERENCE
   bore and length - every fitting's own ventK() (below) is its own
   conductance judged against this one reference, same shape as netFlowK
   against P.netRef. RELIEF_REF_LEN is fitted once, the same idiom as RAD_K
   (rad.js): chosen so the STOCK relief fitting - reference bore, its own
   routed branch length as placed in buildLayout() - computes to exactly
   this reference, so ventK()===1 there and a stock design vents at exactly
   today's rate. Change the stock tap or tank position and re-derive it
   (measure reliefG() on the stock fitting headless) rather than picking a
   rounder number.
   Flat in Q on purpose, not sqrt((s.P-P.Pcont)/(P.P0-P.Pcont)): that reads
   about 1.03 at the 106% lift point, not 1.00, so adding it would move
   every PORV figure this stage exists to hold still. Pressure-dependent
   flow is its own change, with its own re-pin. */
const RELIEF_REF_LEN = 2.24;
const ventRefG = () => resist(PIPE_BORE.relief, RELIEF_REF_LEN);

// A relief fitting's own conductance, off its own routed branch pipe - never
// through the network solve (FIT.relief.g is always 0, above) but priced
// the identical way any other branch prices its resistance, so a longer
// relief run vents slower and a severed one (pipeExtraLen) vents not at
// all, the same idiom a severed hot or cold leg already uses. 0 for a
// fitting whose branch never routed (its tap's part is gone) - the same
// "not there" every other reader of a missing run already falls back to.
function reliefG(s, fid){
  const r = P.net && P.net.byKey["xtie:"+fid];
  if(!r) return 0;
  return resist(PIPE_BORE.relief, plen(r.pts) + pipeExtraLen(s, r.key));
}

// This fitting's vent rate as a fraction of the reference relief valve's -
// PORV_INV*ventK and PORV_DP*ventK (step.js) are what actually charge
// s.inv/s.P. Against P.ventRef (commission(), step.js), computed once per
// commission rather than re-derived every call, the same shape P.netRef
// already uses. Guarded exactly like netFlowK(): a solver bug must read as
// an inert vent, never as a NaN loose in s.P or s.inv (see the auditor's
// own "a vent never produces NaN").
function ventK(s, fid){
  const k = reliefG(s, fid) / P.ventRef;
  return isFinite(k) && k>=0 ? k : 0;
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
// path with nothing else to disagree about.
const coreFold = raw => (raw === "corer" || raw === "coreb") ? "core" : raw;

/* ══════════ ELEVATION: A NODE IS A HEIGHT AS WELL AS A NAME ══════════
   Metres above the bottom of the grid, taken from the GRID (p.y and MPC),
   NEVER from rowTop(): BANDS makes rows unequal on the control room and
   equal on the bench, so a pixel-derived height would make the physics
   depend on which screen happens to be open. A node is `partId+side`, so
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
const nodeT = (net, i, s) => {
  const t = net.tag[i], dt = s.coreDT || 0;
  return t === NT_HOT ? s.Tavg + dt/2 : t === NT_COLD ? s.Tavg - dt/2 : s.Tavg;
};

/* The temperature at a node, asked by id - the same hot/cold split the
   buoyancy heads consume, so density and subcooling can never disagree about
   how hot a leg is. A node this graph does not carry sits at Tavg, which is
   what "somewhere in the loop, unspecified" means. */
function netTempAt(s, nid){
  const net = P && P.net;
  if(!net) return s.Tavg;
  const i = net.index[nid];
  return i === undefined ? s.Tavg : nodeT(net, i, s);
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
const buoyH = (net, ed, s) => {
  const dz = net.z[ed.u] - net.z[ed.v];
  if(dz === 0) return 0;
  const dT = (nodeT(net, ed.u, s) + nodeT(net, ed.v, s))/2
           - (s.Tavg === undefined ? P.Tref : s.Tavg);
  if(dT === 0) return 0;
  return -BUOY_PER_K*BUOY_LIN*dT * G_MPA * dz;
};

/* Builds the compiled graph once per commission. Topology only - every edge
   but a fitting's own is still a plain number, so most of the matrix is
   fixed the moment this returns; a fitting's g is a function of live
   S.juncOpen or S.valve (see the branch loop below, and pushSeg above for an
   in-line throttle), which is exactly why netFactored() below has to key
   its cache on more than just this object. */
function netBuild(){
  const net = pipeNetwork();
  const byKey = {};
  for(const r of net) byKey[r.key] = r;

  const nodes = [], index = {};
  const nodeIdx = nid => { if(!(nid in index)){ index[nid] = nodes.length; nodes.push(nid); } return index[nid]; };
  /* The core is a node like any other now, NOT the ground. Its pressure is an
     answer rather than a definition, which is the whole point of an absolute
     solve - hang the pressurizer higher and the vessel genuinely sits at a
     higher pressure. netCoreFracOf() below identifies core flow by this index
     rather than by "touches ground", which is what it used to do. */
  const coreNode = nodeIdx("core");

  const edges = [];

  // fitting taps, gathered before any run's edges are built so that pass can
  // already see where to split. Only a fid+side pair names a tap node - never
  // a pixel or a fraction - so two fittings tapping the same run at different
  // points never collide. A BRANCH fitting (bKey set - every tee, and a
  // throttle wired between two runs) taps both ends, exactly the way a
  // junction always did; an IN-LINE fitting (bKey null - only a throttle can
  // be one) taps just the one run it sits on, gets no node of its own, and is
  // folded straight into that run's own edge instead (pushSeg, below) - it
  // has no route to draw, so there is no "xtie:"+id run to look up for it. A
  // fitting whose host run kind isn't one this graph builds edges for (steam,
  // feed - not modeled here yet) still gets registered; tapEndpoint() and
  // pushSeg below just never have an edge-building pass consume it, so it
  // falls back to the pre-split nearer-end pick (branch) or is simply inert
  // (in-line), no coarser than before for a kind this stage still doesn't
  // carry flow on.
  const tapNode = (fid, side) => "tap:" + fid + ":" + side;
  const branches = [], inlineByRun = {}, fitIds = [], fitMode = {};
  for(const fid in D.fit){
    const j = D.fit[fid];
    const hostA = byKey[j.aKey];
    if(!hostA) continue;                // a tapped run's part was removed
    if(!j.bKey){                        // in-line: one tap, no route of its own
      (inlineByRun[hostA.key] || (inlineByRun[hostA.key] = [])).push({fid, t: clamp(j.aT, 0, 1)});
      fitIds.push(fid); fitMode[fid] = j.mode;
      continue;
    }
    const r = byKey["xtie:" + fid];
    if(!r) continue;                    // the branch itself was never routed
    const hostB = byKey[fitBKey(net, j)];   // relief re-resolves; see layout.js
    if(!hostB) continue;                // a tapped run's part was removed
    const endsA = runEnds(hostA.key, hostA.k), endsB = runEnds(hostB.key, hostB.k);
    if(!endsA || !endsB) continue;
    branches.push({fid, j, r, hostA, hostB, endsA, endsB});
    fitIds.push(fid); fitMode[fid] = j.mode;
  }
  const tapsByRun = {};
  for(const {fid, j, hostA, hostB} of branches){
    (tapsByRun[hostA.key] || (tapsByRun[hostA.key] = [])).push({t: clamp(j.aT, 0, 1), node: tapNode(fid, "a")});
    (tapsByRun[hostB.key] || (tapsByRun[hostB.key] = [])).push({t: clamp(j.bT, 0, 1), node: tapNode(fid, "b")});
  }

  /* The surge line lands where it is DRAWN. It used to be tied to the core
     instead, on the argument that a dead-end carries no flow so the choice
     could not move anything - true while it had no source at either end, and
     false the moment the pressurizer became the node that fixes the loop's
     absolute pressure. Resolved through the identical tap machinery a
     fitting uses: nearestOn() turns the point the routed surge run ends at
     back into a fraction along hot leg 0, and that run then splits at it. */
  const SURGE_TAP = "tap:surge:land";
  const hot0 = net.find(r => r.k === "hot");
  const surgeRun = byKey["surge:pzrb"];
  let surgeT = null;
  if(hot0 && surgeRun && surgeRun.pts.length){
    surgeT = clamp(nearestOn(hot0.pts, surgeRun.pts[surgeRun.pts.length-1]).t, 0, 1);
    (tapsByRun[hot0.key] || (tapsByRun[hot0.key] = [])).push({t: surgeT, node: SURGE_TAP});
  }

  // primary runs: hot, cold, hpi all terminate at real component ports, so
  // runEnds() hands back both nodes directly. A run with no branch taps on it
  // keeps the single edge exactly as before (this is what the no-fitting
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
    if(r.k !== "hot" && r.k !== "cold" && r.k !== "hpi") continue;
    const ends = runEnds(r.key, r.k);
    if(!ends) continue;
    const u = nodeIdx(coreFold(ends[0])), v = nodeIdx(coreFold(ends[1]));
    const bore = PIPE_BORE[r.k], L = plen(r.pts), taps = tapsByRun[r.key], inl = inlineByRun[r.key];
    /* the injection line is a tank's one edge, and it is shut until the
       operator opens it - a removed edge, not a small one, the same as every
       other shut thing in this graph */
    if(r.k === "hpi"){
      edges.push({u, v, g: s => (tankOpen(s,"hpi") && !pipeExtraLen(s, r.key)) ? tankG(s,"hpi") : 0,
                  h: 0, kind: "hpi", key: r.key});
      continue;
    }
    const pushSeg = (a, b, t0, t1, last) => {
      const segL = L*(t1-t0);
      const ids = inl ? inl.filter(o => o.t>=t0 && (last ? o.t<=t1 : o.t<t1)).map(o=>o.fid) : [];
      /* Combat damage lands on the run's own LAST segment only, never every
         segment a tap happened to split it into: series resistance sums the
         same wherever it sits (pipeExtraLen's own comment), so this is the
         "last one written wins" rule netCoreFracOf's byRun already uses, not
         a second convention to keep in sync. Always routed through
         throttled(), even with an empty ids list, so an ordinary undamaged
         run stays bit-identical (throttled with no ids and 0 extra length is
         exactly resist(bore,segL)) while still being LIVE against a hit that
         has not happened yet. */
      if(!last){
        if(!ids.length){ edges.push({u:a, v:b, g: resist(bore, segL), h: 0, kind: r.k, key: r.key}); return; }
        edges.push({u:a, v:b, g: s => throttled(s, bore, segL, ids), h: 0, kind: r.k, key: r.key});
        return;
      }
      edges.push({u:a, v:b, g: s => throttled(s, bore, segL + pipeExtraLen(s, r.key), ids), h: 0, kind: r.k, key: r.key});
    };
    if(!taps || !taps.length){
      pushSeg(u, v, 0, 1, true);
      continue;
    }
    const sorted = taps.slice().sort((a, b) => a.t - b.t);
    let prev = u, prevT = 0;
    for(const tp of sorted){
      const node = nodeIdx(tp.node);
      pushSeg(prev, node, prevT, tp.t, false);
      prev = node; prevT = tp.t;
    }
    pushSeg(prev, v, prevT, 1, true);
  }

  // surge: the pressurizer's own path onto the loop, landing on the point of
  // hot leg 0 it is drawn dropping onto (SURGE_TAP, above) rather than on the
  // core. It carries real flow now - the pressurizer node is what fixes the
  // loop's absolute pressure (netFixed) - so where that pressure is applied
  // is no longer a choice with no consequences. A plant with no pressurizer,
  // or one whose surge line never routed, simply has no surge edge.
  if(surgeRun && surgeT !== null)
    edges.push({u: nodeIdx("pzrb"), v: nodeIdx(SURGE_TAP),
      g: resist(PIPE_BORE.surge, plen(surgeRun.pts)), h: 0, kind: "surge", key: surgeRun.key});

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
  for(const p of LAY.parts){
    if(p.id.startsWith("sg"))
      edges.push({u: nodeIdx(p.id+"l"), v: nodeIdx(p.id+"b"), g: resist(1,NET_COMP_LEN), h: 0, kind: "comp", key: "comp:"+p.id});
    const m = /^pump(\d+)$/.exec(p.id);
    if(m){
      const i = +m[1];
      /* s.flow - the pump's ACTUAL speed, walked toward demand with its own
         inertia in step() - is part of the head now, not a multiplier applied
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
         one cavitation number for the whole plant. */
      edges.push({u: nodeIdx(p.id+"t"), v: nodeIdx(p.id+"b"), g: resist(1,NET_COMP_LEN),
        h: s => PUMP_H0 * loopPumpCap(i, s.dmgParts) * (s.capScale ? (s.capScale[i]??1) : 1)
                * (s.flow===undefined ? 1 : s.flow)
                * (1 - 0.8*((s.cavP && s.cavP[i]) || 0)),
        kind: "pump", key: "comp:"+p.id});
    }
  }

  // branch fittings: lands on the real tap node the host run's own edge-
  // building pass above split out for it, so moving aT/bT along a run
  // changes the network exactly like moving a real tee would. A host kind
  // that pass doesn't build edges for (steam, feed) has no split node to
  // hand back - tapEndpoint() falls through to the old nearer-end pick for
  // exactly that side, same as every junction did before this stage.
  const tapEndpoint = (host, ends, t, fid, side) =>
    (host.k === "hot" || host.k === "cold" || host.k === "hpi")
      ? nodeIdx(tapNode(fid, side))
      : nodeIdx(coreFold(t < 0.5 ? ends[0] : ends[1]));
  // g comes off FIT[mode] - a tee's is a boolean gate on S.juncOpen, a
  // throttle's a live position on S.valve, but both hand back either a
  // removed edge (g<=0, netAssemble skips it entirely - "shut"/"never
  // placed"/"fully closed" all land on the same, bit-identical matrix) or a
  // plain resist(bore,len) call. g is a function of s (never the plain
  // number every other edge in this stage still is) because the fitting is
  // worked live, every tick; fid is looked up by closure, not hoisted, so
  // each fitting's own edge reads its own id even though this loop shares
  // one tapEndpoint() across all of them.
  for(const {fid, j, r, hostA, hostB, endsA, endsB} of branches){
    const u = tapEndpoint(hostA, endsA, j.aT, fid, "a");
    const v = tapEndpoint(hostB, endsB, j.bT, fid, "b");
    const bore = PIPE_BORE.xtie, len = plen(r.pts), mode = j.mode;
    // pipe damage on a branch fitting's own run adds the same equivalent
    // length before FIT[mode].g ever sees it - a severed cross-tie is shut
    // whatever S.juncOpen/S.valve say, exactly as a severed hot/cold leg is
    // shut whatever throttle sits on it (pushSeg, above).
    edges.push({u, v, g: s => FIT[mode].g(s, fid, bore, len + pipeExtraLen(s, r.key)), h: 0, kind: r.k, key: r.key});
  }

  /* One break edge per (run, END) - a cut pipe has two open ends and both of
     them spill, which a single edge could not say. Each gets a containment
     node of its OWN, at its own elevation, so the break discharges where it
     is rather than through a static column to somewhere else. An edge whose
     break has not happened has g exactly 0, so netAssemble skips it entirely
     and an unbroken plant's matrix is bit-identical to one built before break
     edges existed - the same "shut and never built are the same edge" rule a
     shut tee already relies on. */
  const contNode = tag => nodeIdx("cont:" + tag);
  const breakIds = [];
  for(const r of net){
    if(r.k !== "hot" && r.k !== "cold" && r.k !== "hpi" && r.k.indexOf("xtie") !== 0) continue;
    const ends = runEnds(r.key, r.k);
    if(!ends) continue;
    const bore = PIPE_BORE[r.k] || PIPE_BORE.xtie, g = BREAK_K*bore*bore, key = r.key;
    for(const side of [0,1]){
      const u = nodeIdx(coreFold(ends[side])), v = contNode(key+":"+(side?"b":"a"));
      breakIds.push(v);
      edges.push({u, v, g: s => breakLive(s, key) ? g : 0, h: 0, kind: "break", key: "break:"+key});
    }
  }
  /* one tube-rupture edge per steam generator, from its own primary outlet to
     a node fixed at its own secondary's pressure. Shut - g exactly 0, so the
     edge is not in the matrix at all - until that generator is hit. */
  const sgtrIds = [];
  for(const q of LAY.parts) if(/^sg\d+$/.test(q.id)){
    const id = q.id, v = nodeIdx("sec:" + id);
    sgtrIds.push(v);
    edges.push({u: nodeIdx(id+"b"), v, g: s => sgtrLive(s, id) ? sgtrG() : 0,
                h: 0, kind: "sgtr", key: "sgtr:"+id});
  }

  /* the vessel's own opening. s.breach stays exactly the latched flag the
     board, the scenarios and tripCause() all read - what goes is the fixed
     2.4 %/s drain that ran at one rate forever whatever the operator did. */
  { const v = contNode("core");
    breakIds.push(v);
    edges.push({u: coreNode, v, g: s => s.breach ? BREAK_K*BREACH_BORE*BREACH_BORE : 0,
                h: 0, kind: "break", key: "break:core"}); }

  const net2 = {nodes, index, edges, core: coreNode, n: nodes.length, byKey, fitIds, fitMode,
                cont: breakIds, sec: sgtrIds};

  /* ELEVATION, once per commission - geometry, not state, so nothing here is
     re-derived per tick. A part node takes the height of the FACE it sits on;
     a tap interpolates linearly between its host run's two end nodes, which
     is what makes a split run's static heads telescope back to exactly the
     unsplit run's. Anything this cannot resolve sits at the core's height, so
     it contributes no static head rather than a wrong one. */
  const byId = {};
  for(const q of LAY.parts) byId[q.id] = q;
  const coreP = byId.core;
  const zCore = coreP ? zFace(coreP, "c") : 0;
  const partZ = nid => {
    if(nid === "core") return zCore;
    const q = byId[nid.slice(0, -1)];
    return q ? zFace(q, nid.slice(-1)) : null;
  };
  net2.z = new Float64Array(net2.n);
  const taps = [];
  for(let i=0;i<net2.n;i++){
    const z = partZ(nodes[i]);
    if(z === null) taps.push(i); else net2.z[i] = z;
  }
  const runZ = (key, t) => {
    const r = byKey[key], ends = r && runEnds(r.key, r.k);
    if(!ends) return zCore;
    const za = partZ(coreFold(ends[0])), zb = partZ(coreFold(ends[1]));
    const a = za===null?zCore:za, b = zb===null?zCore:zb;
    return a + (b-a)*t;
  };
  /* a containment node sits at the height of the opening it is on the far
     side of, so the break edge spans no column and discharges where it is */
  for(const ed of edges) if(ed.kind === "break" || ed.kind === "sgtr") net2.z[ed.v] = net2.z[ed.u];
  for(const i of taps){
    const nid = nodes[i];
    if(nid.indexOf("cont:") === 0 || nid.indexOf("sec:") === 0) continue;   // set above, off its own opening
    if(nid === SURGE_TAP){ net2.z[i] = hot0 ? runZ(hot0.key, surgeT) : zCore; continue; }
    const m = /^tap:(.+):(a|b)$/.exec(nid), j = m && D.fit[m[1]];
    if(!j){ net2.z[i] = zCore; continue; }
    net2.z[i] = m[2]==="a" ? runZ(j.aKey, clamp(j.aT,0,1))
                           : runZ(fitBKey(net, j), clamp(j.bT,0,1));
  }

  /* Which side of the loop each node sits on, built from the RUNS that touch
     it so no component has to be named. A node the hot legs reach is hot, one
     the cold legs reach is cold, and one both reach - the folded core, a
     cross-tie between the two sides - is neither and sits at Tavg. */
  net2.tag = new Uint8Array(net2.n);
  for(const ed of edges){
    const b = (ed.kind==="hot"||ed.kind==="surge") ? NT_HOT
            : (ed.kind==="cold"||ed.kind==="hpi") ? NT_COLD : 0;
    if(b){ net2.tag[ed.u] |= b; net2.tag[ed.v] |= b; }
  }
  for(let i=0;i<net2.n;i++) if(net2.tag[i] === (NT_HOT|NT_COLD)) net2.tag[i] = 0;

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

  /* The node the pressurizer fixes the loop's pressure at. A plant without one
     falls back to the core, so the field always has exactly one anchor and
     never floats. */
  net2.pzrNode = ("pzrb" in index) ? index.pzrb : coreNode;
  /* which node each TANK row actually landed on, or nothing if that tank is
     not on this plant */
  net2.tankNode = {};
  for(const id in TANK) if(TANK[id].node in index) net2.tankNode[id] = index[TANK[id].node];
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
function netFixed(net, s){
  const f = {}, p0 = phiRef(net, s), rd = rhoDatum(s)*G_MPA;
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
  for(const i of net.cont) f[i] = P.Pcont + rd*net.z[i] - p0;
  /* Every TANK's own node is fixed at the pressure its own gas space is
     holding. That is the whole of 2h and 2j: injection is then the SOLVED
     flow through the tank's one edge against the loop it is fighting, so a
     loop at full pressure takes almost nothing and a depressurised one takes
     a surge, and an emptying accumulator tapers because its gas is expanding.
     Fixed whether or not the edge is open - an isolated node costs nothing
     and keeps the fixed SET constant, so the factorisation cache keys on the
     valve instead of on a set that changes shape. */
  for(const id in net.tankNode) f[net.tankNode[id]] = tankP(s,id) + rd*net.z[net.tankNode[id]] - p0;
  /* the secondary side of each steam generator - a boundary, not a solve */
  const ps = secP(s);
  for(const i of net.sec) f[i] = ps + rd*net.z[i] - p0;
  return f;
}
/* WHICH nodes are fixed, never what they hold. A fixed node's VALUE only ever
   reaches b, so it may move every tick for free; whether a node is fixed at
   all changes the MATRIX, so it has to bust the factorisation cache. */
const netFixSig = fixed => Object.keys(fixed).join(',');

/* Factors A once per DISTINCT combination of fitting state and caches it
   there. The cache key is a signature of every fitting's live state, not the
   net instance alone: since Stage 2 a branch's own edge is gated on live
   S.juncOpen, and since Stage 3a an in-line or branch throttle's edge is a
   live function of S.valve too (see netBuild()), so A itself can change tick
   to tick, and a factorisation left over from before a fitting moved would
   be a silent wrong answer, not a crash - the signature is checked on every
   call rather than trusted once. A throttle's position is continuous, so its
   own term is the exact value rather than a '0'/'1' flag: ANY change to it
   has to bust the cache, not just crossing some open/shut line. dmgParts
   never enters A (only a pump's head b does), so it plays no part in the
   signature. */
function netFactored(net, s, fixed){
  const sig = net.fitIds.map(fid => net.fitMode[fid]==="tee"
    ? ((s.juncOpen && s.juncOpen[fid]) ? '1' : '0')
    : String(s.valve && s.valve[fid])
  ).join('|')
  /* pipe damage is a third live input the edges above read (beside
     S.juncOpen and S.valve) - leave it out of the signature and a hit or a
     repair reuses last tick's factorisation, solving the network as though
     the pipe on the grid were still the one it was before: a wrong answer,
     not a crash, so it is checked every call exactly like the other two. */
  + '|' + (s.dmgParts ? s.dmgParts.filter(k => k.indexOf("pipe:")===0).join(',') : '')
  /* the fixed SET is the fourth live input to A. A break appearing puts a
     second known pressure into the matrix, not just into b, so reusing last
     tick's factors would solve the broken plant against the intact one's -
     a wrong answer, not a crash. */
  + '|' + netFixSig(fixed)
  /* a ruptured vessel opens a break edge the same way a severed run does, and
     unlike a severed run it is not in s.dmgParts */
  + '|' + (s.breach ? 'B' : '')
  /* a ruptured generator opens an edge to its own secondary, and that is a
     change to A, not to b - so it has to bust the factorisation too */
  + '|' + (s.dmgParts ? s.dmgParts.filter(k => /^sg\d+$/.test(k)).join(',') : '')
  /* a tank's isolation valve gates its own edge, so opening it changes A */
  + '|' + (tankOpen(s,"hpi") ? 'H' : '');
  if(!net.Af || net.AfSig !== sig){
    const A = new Float64Array(net.n*net.n);
    netAssemble(net.edges, net.n, fixed, s, A, new Float64Array(net.n));
    net.Af = netFactor(A, net.n);
    net.AfSig = sig;
  }
  return net.Af;
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
  const Af = netFactored(net, s, fixed);
  const b = new Float64Array(net.n);
  netAssemble(net.edges, net.n, fixed, s, new Float64Array(net.n*net.n), b);
  netSubst(Af, b, net.n);
  netUnfix(b, fixed);
  /* phi -> p: the datum column comes off here, once, so every reader of the
     field gets a real pressure in MPa and nothing downstream has to know the
     solve worked in piezometric head at all. */
  if(byP){ const rd = rhoDatum(s)*G_MPA, p0 = phiRef(net, s);
    for(let i=0;i<net.n;i++) byP[net.nodes[i]] = b[i] + p0 - rd*net.z[i]; }
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
  let core = 0, spill = 0;
  for(let e=0;e<net.edges.length;e++){
    const ed = net.edges[e];
    if(byRun && ed.key) byRun[ed.key] = Math.abs(q[e]);
    /* SIGNED, and only for a tank's own edge: a tank fills or drains
       depending on which way the solved differential points, and an absolute
       value cannot say which. Positive is INTO the loop. */
    if(outs && ed.kind === "hpi") outs.qTank = (outs.qTank||0) + q[e]*(ed.u === net.core ? -1 : 1);
    if(byDrop && ed.key) byDrop[ed.key] = span>0 ? Math.abs(b[ed.u]-b[ed.v])/span : 0;
    if(ed.kind === "break"){
      spill += Math.abs(q[e]);
      /* per OPENING, because an effect has to be drawn where its own hole is:
         a severed run's two ends share one key and sum, the vessel has its
         own. This is what stops the breach plume being a boolean at the
         reactor whatever actually broke. */
      if(outs){ (outs.by || (outs.by = {}));
                outs.by[ed.key] = (outs.by[ed.key]||0) + Math.abs(q[e]); }
    }
    /* signed: primary into secondary is positive, and once the primary is
       brought DOWN to the secondary this reaches zero on its own */
    if(outs && ed.kind === "sgtr") outs.qSgtr = (outs.qSgtr||0) + q[e];
    if(ed.kind === "cold" && (ed.u === net.core || ed.v === net.core)){
      const qe = Math.abs(q[e]);
      core += qe;
      if(byLoop){ const i = loopOfKey(ed.key); if(i!=null) byLoop[i] = (byLoop[i]||0) + qe; }
    }
  }
  if(outs) outs.spill = spill;
  return core;
}

// No damage, every fitting exactly as commissioned - a branch (S.juncOpen
// starts every id false in resetPlant(); an in-line throttle starts at 1,
// wide open) - and every loop's OWN head clamped at 1.0 (capScale)
// regardless of what is actually installed on it. That clamp is the one
// thing this reference must NOT inherit from the live plant: a spare pump
// must not be able to inflate the 100% mark it will later be judged
// against, or it would buy the plant nothing the day it is actually needed
// (see netFlowK's own comment) - loopFlowK() never let an isolated loop's
// own capacity count for more than 1 either, spare or no spare. A loop
// built SMALLER than default (up<1) is not bumped up to 1 - that pump's own
// undersized reference is real and the plant's 100% mark is honestly lower
// for it, exactly as loopFlowK()'s min(1,up) always was.
// This is the one place the as-commissioned throttle defaults are asserted
// rather than read off S: an in-line throttle omitted here would read
// s.valve as undefined, the g() gate would treat that exactly like fully
// shut, and every hot/cold reference on that run would collapse to zero -
// wrong, because the live plant commissions that same valve wide open.
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
    s.valve[fid] = P.fit[fid].bKey ? 0 : 1;
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
const invRate = q => 100*q/(P.netRef*LOOP_TRANSIT);

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
  const sNat = Object.create(s); sNat.flow = 0;
  netCoreFracOf(P.net, sNat, natLoop);
  const adj = Array.from({length:n}, () => []);
  for(const id in P.fit){
    const j = P.fit[id];
    if(!j.bKey) continue;                          // in-line: never joins two loops
    const live = j.mode==="tee" ? !!(s.juncOpen && s.juncOpen[id])
                                 : !!(s.valve && s.valve[id] > 0);
    if(!live) continue;
    const a = loopOfKey(j.aKey), b = loopOfKey(j.bKey);
    if(a!=null && b!=null && a!==b && a<n && b<n){ adj[a].push(b); adj[b].push(a); }
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
  if(outs){ const nk = natTot/P.netRef; outs.nat = isFinite(nk) && nk>=0 ? nk : 0; }
  const k = total/P.netRef;
  return isFinite(k) && k>=0 ? k : 0;
}

/* ══════════ A RUN AS A HITTABLE TARGET, AND A PLACE TO STAND ══════════
   A run is not a part - no LAY.parts entry, so nothing hands combatHit() or
   repairStart() (step.js) a p.x/p.y/p.w/p.h rectangle to reason about, or a
   p.name to log. These give both the same shape a part already has: an id
   ("pipe:"+the run's own key, so DMGFX's existing prefix match picks it up
   for free - see step.js), a name, a footprint size for repairNeed(), and an
   access flag built from the SAME freeAdj() (layout.js) ring test every
   component already uses, just unioned over every cell the run's own
   polyline crosses instead of one rectangle. */

// Which run keys actually carry conductance in the solved graph - only these
// have anything for a hit to take away. "comp" (a component's own internal
// path - sg tubes, pump casing) and "surge" (no source, no flow - see
// netBuild()'s own comment) are excluded on purpose: hitting comp:sg0 would
// just be a second way to hit the sg component itself, through a name the
// player never sees, and surge has nothing to sever.
function hittableRunKeys(net){
  const keys=[];
  for(const e of net.edges)
    if(e.key && (e.kind==="hot"||e.kind==="cold"||e.kind==="hpi"||(e.kind && e.kind.indexOf("xtie")===0))
       && keys.indexOf(e.key)<0) keys.push(e.key);
  return keys;
}

// The grid cells a routed polyline actually crosses, deduplicated - sampled
// every half cell so a long straight leg cannot skip the cell in the middle
// of it, the same risk plen() would run if it worked in cell units instead
// of pixels.
function pipeCells(pts){
  const out=[], seen={};
  const add=(gx,gy)=>{ if(gx<0||gy<0||gx>=GW||gy>=GH) return;
    const k=gx+","+gy; if(!seen[k]){ seen[k]=1; out.push([gx,gy]); } };
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1], b=pts[i], dx=b[0]-a[0], dy=b[1]-a[1];
    const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/(CELL/2)));
    for(let t=0;t<=steps;t++)
      add(Math.floor((a[0]+dx*t/steps-GX)/CELL), rowAt(a[1]+dy*t/steps));
  }
  if(!out.length && pts.length) add(Math.floor((pts[0][0]-GX)/CELL), rowAt(pts[0][1]));
  return out;
}

// freeAdj() (layout.js) run per crossed cell and unioned, minus any cell
// that is itself part of the run - standing "on" a leak is not standing
// "beside" it, the same distinction freeAdj() already draws between a
// part's own footprint and its ring.
function pipeStandCells(cells){
  const g=occupied(null), on={}, seen={}, out=[];
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
  const kind = r.k.indexOf("xtie")===0 ? "CROSS-TIE" : r.k.toUpperCase()+" LEG";
  return kind + (loop!=null ? " "+(loop+1) : "");
}

// The pseudo-part combatHit()/repairStart() (step.js) consume in place of a
// LAY.parts entry - same shape (id, name, w, h, access) so repairNeed() and
// the DMGFX log line need no second code path for a run. isRun tells
// combatHit()'s weighted pick which scoring rule applies (runWgt() below,
// never the part rule) without duck-typing on which fields happen to exist.
function pipePart(key){
  const r = P.net.byKey[key];
  if(!r) return null;
  const cells = pipeCells(r.pts), stand = pipeStandCells(cells);
  return {id:"pipe:"+key, name:pipeName(r), w:cells.length, h:1,
          access: stand.length>0, cells, stand, isRun:true};
}

/* Anything s.dmgParts can hold, resolved to the one shape the repair path
   reads: id, name, access. A run is not in LAY.parts, so every caller that
   looked a damage id up directly got `undefined` for a pipe and quietly
   rendered it as a raw id that could never be reached - which is how the
   damage card came to promise NO ACCESS for a pipe a party was standing
   next to. Three readers (the dispatcher, the dose rate, the damage card),
   one resolver. */
function dmgPart(id){
  return (typeof id==="string" && id.indexOf("pipe:")===0)
    ? (P.net && P.net.byKey[id.slice(5)] ? pipePart(id.slice(5)) : null)
    : (LAY.parts.find(q=>q.id===id) || null);
}

// The two rates combatHit() (step.js) already weighs a component's own hull
// cells by - a run gets no separate scale to fit, just this shared table.
const HITW_BASE=0.15, HITW_HULL=1.6;

// A run's own odds of being the thing an unaimed hit finds. The difference
// from a part's own weight (step.js) is what the flat term multiplies: a
// component pays HITW_BASE once per PART regardless of its footprint, but a
// run's own length is the whole point of "give more pipe for a hit to find"
// (design-bench.js) - so here it is paid once per CELL of pipe instead. A
// long run really does cross more of the room a stray round can land in;
// the hull bonus is unchanged, paid at the same rate per hull-ring cell.
function runWgt(cells){
  let w=0;
  for(const [x,y] of cells)
    w += HITW_BASE + (x===0||x===GW-1||y===0||y===GH-1 ? HITW_HULL : 0);
  return w;
}

/* THE STOCK RELIEF PATH. Seeded once, at load, the same way every other
   as-commissioned default lives in D itself (design.js) rather than behind
   a menu action nobody has to run - a fresh design already has a relief
   valve venting to the tank below the pressurizer, and deleting it is the
   player's own choice (see the "no relief path fitted" warning, design.js).
   aT=0.9 is not arbitrary: it is the shortest tap the stock hot leg offers
   onto the tank at (6,0) (buildLayout()) - measured by sweeping every tenth
   of the run headless, so the stock branch pipe costs as little of the
   inertia/mass this stage was written to charge for as the geometry allows,
   never more than the fitting itself is worth. bKey taps the RELIEF HEADER
   (pipeNetwork(), layout.js), which exists precisely because this fitting
   does (hasRelief(), layout.js) - so at load there is no header to look up
   yet and this string is a BOOTSTRAP, not the address. Every reader goes
   through fitBKey() (layout.js) and gets whatever faces the header actually
   has this frame; move the tank or the pressurizer and this literal is
   already stale, which is why nothing is allowed to trust it. */
addFit('relief','hot:corer-sg0l',0.9,'relief:pzrt-reltkb',0.5,PIPE_BORE.relief);

