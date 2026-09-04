"use strict";
/* the primary pipe network as a conductance graph - see .claude/CLAUDE.md and
   src/sim/net.js. netFlowK() (bottom of this file) is what feeds pumpK in
   step(); loopFlowK(), the capacity-counting formula it replaced, is gone. */

/* ══ THE CURRENCY IS KILOGRAMS ══
   PIPE_K is gone, and with it the property this file was built around: the
   graph used to be homogeneous in it, so the constant cancelled and a solved
   flow was a RATIO. Kilograms only appeared afterwards, through one
   conversion off the PRIMARY loop's inventory and a fitted transit time - so
   a condensate line metered against the reactor's pipes read 799 kg/s of
   water for 664 kg/s of steam. Every edge states a real AREA now and every
   node a real DENSITY, so the momentum relation (flowG(), below) returns
   kilograms per second directly and there is nothing left to convert. */
// bore of each primary line, so a narrow branch (HPI, relief) chokes itself
// down. relief is every relief fitting's own bore - see FIT.relief and
// reliefFullRate() below.
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
   than an omission: they take the fallback bore like any other unlisted kind
   and the same pipeC() prices them, because there is one graph.
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
   ever reach a conductance.
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
// cached for the length of one pass (layPass()): the burst test asks it of every run every tick
let feedHeadCache = 0, feedHeadPass = -1;
const feedHeadMax = () => { const pn = layPass();
  if(pn && feedHeadPass === pn) return feedHeadCache;
  let h = 0;
  for(const id of pumpIds()) if(secGensOf(id).length) h = Math.max(h, pumpHead(id));
  if(pn){ feedHeadCache = h; feedHeadPass = pn; }
  return h; };
/* ══ AND A PRIMARY RUN IS RATED FOR WHAT STANDS AT ITS OWN TWO ENDS ══
   The circuit's setpoint was the whole answer, so the HPI line was walled for
   the loop's 7 MPa while its own accumulator is charged to 11.0 - it split on
   tick one of every BWR/4, BN-600, RBMK-1000 and MSRE commissioning, with no
   fault injected, and the hole then drained the plant from the moment it was
   built. Same mistake the feed line above already fixed, on the other side of
   the tubes. Asked at the SAME two nodes the burst test reads (step.js), or
   the wall and the thing that judges it disagree forever. A tank states
   tankDesignP(); a pump adds its head at its DISCHARGE node and nowhere else,
   because a suction is where a pump makes pressure LOWER. The setpoint stays
   the floor, so nothing this already walled gets thinner.
   ...AND A COLUMN OF COOLANT IS A PRESSURE TOO. The setpoint is only what
   stands at the ANCHOR; a node below it carries the weight of everything
   above as well, which is the same column netPressures() adds back to turn
   the solve into megapascals. Invisible on water at 15.5 MPa - 19 m is
   0.13 MPa - and decisive on sodium at 0.2, where the same column is 0.36 and
   BN-600 cut its own hot legs on tick one. Against the TOP of the run's own
   circuit, because the anchor is a solved quantity and this is asked with no
   S: the highest node is the bound, so a wall is never sized short. */
const circSetP = n => { const ci = circOfNode(n);
  return (ci === null || ci === undefined) ? 0 : holdSetP(ci); };
// on the graph (graphSlot(), layout.js): heights come off part cells, which
// are already terms of that graph's own key, so no setpoint can stale this
const circTopZ = ci => { const s = graphSlot("circTopZ"), was = s.get(ci);
  if(was !== undefined) return was;
  const G = nodeGraph(); let hi = -Infinity;
  for(const pid in G.nodesOf) for(const n of G.nodesOf[pid]){
    if(G.circuit[n] !== ci) continue;
    const z = nodeZ(n); if(z !== null && z > hi) hi = z; }
  s.set(ci, hi); return hi; };
// the coolant's own density at its design point, kg/m^3 - what commission()
// bakes P.rho0 from, asked of D so the bench gets the same answer with no P
const rhoDesign = () => COOLANT[D.cool].dens*RHO_K;
const colAt = n => { const ci = circOfNode(n);
  if(ci === null || ci === undefined) return 0;
  const z = nodeZ(n), top = circTopZ(ci);
  return (z === null || !isFinite(top)) ? 0 : rhoDesign()*G_MPA*Math.max(top - z, 0); };
const runDesignP = r => {
  if(!PRIMARY_K[r.k]) return Math.max(sgDesignP(), feedHeadMax());
  let p = holdSetP(nodeGraph().coreCirc);
  const ends = runEnds(r.key, r.k);
  if(!ends) return p;
  // both ends at once, so the tank and pump walks below are per RUN and not
  // per node - this is asked of every run every tick by the burst test
  const at = new Set(ends.map(coreFold)), G = nodeGraph();
  for(const n of at) p = Math.max(p, circSetP(n) + colAt(n));
  for(const id of tankIds())
    if((G.nodesOf[id]||[]).some(m => at.has(coreFold(m)))) p = Math.max(p, tankDesignP(id));
  for(const id of pumpIds()){ const dis = pumpDisNode(id);
    if(at.has(dis)) p = Math.max(p, circSetP(dis) + colAt(dis) + pumpHead(id)); }
  return p;
};
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
// It is also the friction scale a machine's own body is priced against
// (CASING_F, below): the reference head a reference loop is designed to spend.
let PUMP_H0 = 0.60;
/* A scale on EVERY head - the pump's and the static column's alike. It is 1
   and the game never moves it; it exists so the head's own effect can be
   swept. The relation is a ROOT in head now, so scaling this no longer leaves
   a flow ratio where it was: every flow moves as its square root, which is
   what a real pipe does and what the abstract currency could not say.
   `let` plus a setter, the idiom setCasingF() shares. */
let HEAD_K = 1;
function setPumpH0(v){ PUMP_H0 = v; }
function setHeadK(v){ HEAD_K = v; }

// Gravity, in MPa per (kg/m^3 x metre): 9.81 Pa per kg/m^3 per metre, over
// 1e6 Pa/MPa. The one place the unit conversion happens.
const G_MPA = 9.81e-6;
// COOLANT's `dens` is the coolant family's density on a scale where pressurised
// water is 100, so RHO_K turns it into kg/m^3 (PWR -> 700, hot water at
// 300 C). RHO_BETA is the linear expansion coefficient about P.Tref, which is
// what a DESIGN-time reader (a wall, a mass, a column on the bench) weighs
// with; the solve itself asks each node's own (p, h) instead.
const RHO_K = 7, RHO_BETA = 2.4e-3;
const rhoAt = T => P.rho0 * (1 - RHO_BETA*(T - P.Tref));

// The path THROUGH a component's own body (sg tubes, pump casing) - a short
// length of full-bore pipe, and the floor under every run's own length: a
// degenerate zero-length run (two ports that landed on the same point) still
// has to cost something.
const NET_COMP_LEN = 0.1;   // metres, short against a real run

/* ══════════ ONE MOMENTUM RELATION, EVERY EDGE ALIKE ══════════
       w  = C * sqrt(2 * rho_u * dp_eff)          kg/s, dp in Pa
       C  = A / sqrt(K)                            m^2, the flow coefficient
       A  = pi/4 * bore^2                          real square metres
       K  = f*L/D, plus whatever the fitting adds  Darcy
   and it reaches the matrix as a CONDUCTANCE, g = w/dp, re-evaluated each
   tick off last tick's field - the trick the vapour side already used, so it
   is not a second solver and it costs one factorisation per tick.

   THE CHOKE IS NOT A VAPOUR SPECIAL CASE. dp_eff is capped at (1-RCRIT) of
   the upstream pressure. On a liquid the density does not fall with pressure
   so the cap never binds; on steam it is the whole behaviour. One expression,
   two regimes, and no branch on what the pipe is called.

   Every constant here is a published shape, not a fit: RCRIT is steam's
   critical pressure ratio, PIPE_FRIC is the Darcy factor a commercial steel
   line runs at, ORIF_CD is a sharp-edged orifice's discharge coefficient.
   DPFRAC is the one numerical floor - w/dp goes to infinity as two ends
   equalise, which is the one way this shape can blow up - and it is a
   FRACTION of the pressure it is a fraction of, never an absolute. */
const PIPE_FRIC = 0.02;
const RCRIT     = 0.55;
const DPFRAC    = 0.02;
const ORIF_CD   = 0.61;
// the solve's own dimensionless bore back into metres
const boreM  = bore => Math.max(bore*BORE_REF/1000, 0.01);
const areaOf = bore => Math.PI/4*boreM(bore)*boreM(bore);
/* A RUN'S FLOW COEFFICIENT, m^2 - its area over the root of its own Darcy
   loss. Infinite length reaches exactly 0, which is how a severed pipe says
   there is no pipe. */
const pipeC = (bore, L) => {
  const K = PIPE_FRIC*Math.max(L, NET_COMP_LEN)/boreM(bore);
  return isFinite(K) && K > 0 ? areaOf(bore)/Math.sqrt(K) : 0;
};
// A HOLE. Not a pipe: an orifice has no length term, only its own area.
const holeC = bore => ORIF_CD*areaOf(bore);
// the path through a component's own body, at full bore over NET_COMP_LEN
const COMP_C = pipeC(1, NET_COMP_LEN);
/* THE CONDUCTANCE THAT LAW BECOMES, about the differential it is standing at.
   dp_act is what the field says; dp_eff is what the flow is allowed to see. */
/* THE RELATION ITSELF, kg/s, off a stated pair of pressures - for a reader
   asking what an opening WOULD pass rather than what the field says it does. */
const flowW = (C, rho, pHi, pLo) => C > 0
  ? C*Math.sqrt(2*Math.max(rho,1e-3)*Math.max(Math.min(pHi-pLo, (1-RCRIT)*Math.max(pHi,0)), 0)*1e6)
  : 0;
const flowG = (C, F, u, v, h) => {
  if(!(C > 0)) return 0;
  /* THE DRIVING DIFFERENTIAL INCLUDES THE HEAD, and it has to: netFlows()
     carries Q = g*(p_u - p_v + h), so a conductance linearised about the node
     pressures alone prices a PUMP at the drop across it rather than at the
     head driving through it - measured, a sodium loop then carried three
     times its pumps' rating on a tenth of their head. */
  const d = F.p[u] - F.p[v] + h;
  const a = Math.abs(d);
  // the density the flow sees is the DONOR node's - a hole blowing down does
  // not pass what is on the far side of it
  const up = d >= 0 ? u : v;
  /* THE CHOKE IS AN EXPANSION, so it is a fraction of the higher PRESSURE and
     never of the donor's. A pump takes suction at a tenth of a bar and
     discharges at seventy, and read off the donor the cap was 0.45 of the
     SUCTION - the stock feed pump choked itself down to 176 kg/s of a 636 kg/s
     duty. Nothing expands through a machine that is raising the pressure. */
  const pHi = Math.max(F.p[u], F.p[v], 1e-4);
  const floor = DPFRAC*pHi;
  const act = Math.max(a, floor);
  const eff = Math.max(Math.min(a, (1-RCRIT)*pHi), floor);
  /* ══ AND A NODE THAT IS SPENT FEEDS NOTHING ══
     tankLive()'s own inventory clause, asked of every node. A compliance
     bounds the RATE and
     not the inventory - a storing node can still be pushed to any pressure -
     so without this a break drains an isolated leg past zero for ever. It is
     the DONOR's bit, so the same edge still fills the node back up. */
  if(F.wet && !F.wet[up]) return 0;
  const w = C*Math.sqrt(2*Math.max(F.rho[up], 1e-3)*eff*1e6);
  return w/act;
};
/* ══ THE FIELD THE LAW IS LINEARISED ABOUT ══
   ONE TICK OLD, deliberately: this tick's pressures come out of the solve, so
   they cannot also be an input to it - the same lag s.coreDT and s.pumpQBy
   already carry.
   Held PER NET and captured by every edge closure, never on a module global:
   a tick solves the drawn plant and the reference plant (P.netNom) against
   different node sets, and an edge that read whichever net solved last would
   index another plant's array. */
const netFieldOf = () => ({p:null, rho:null, x:null, wet:null});
function netFieldSize(F, n){
  F.p = new Float64Array(n).fill(typeof P!=="undefined" && P ? P.P0 : 1);
  F.rho = new Float64Array(n).fill(typeof P!=="undefined" && P && P.rho0 ? P.rho0 : 700);
  F.x = new Float64Array(n);
  F.wet = new Uint8Array(n).fill(1);
}
/* ══ IS THERE ANYTHING LEFT AT THIS NODE ══
   A milligram per cubic metre of the node's own holdup - a fraction of that
   quantity's own reference, and the reference is STRUCTURAL, so this reads
   s.mBy and net.vol and NOTHING else. Anything richer re-enters the solve:
   tankP -> holdLive -> netFixed -> netRef -> netPieces -> netLiveSig ->
   tankLive -> tankP closes through here and is a stack overflow on tick one. */
const DRY_FRAC = 1e-3, DRY_MIN_KG = 1e-6;
const netNodeDry = (net, s, i, rho) => {
  const nid = net.name[i], m = s && s.mBy ? s.mBy[nid] : undefined;
  /* AGAINST WHAT THIS NODE WOULD HOLD, never against a typed density. A
     turbine exhaust at 8 kPa weighs almost nothing on this curve, so a fixed
     kg/m3 floor read every low-backpressure machine's exhaust as spent, cut
     its own inlet edge, and left five of the nine presets making no power at
     all. A fraction of the quantity's own reference, both ways. */
  const eos = net.vol[i]*(rho === undefined ? netRhoAt(s, nid) : rho);
  /* AND A NEAR-VACUUM IS NOT A SPENT STORE. This curve puts a milligram of
     steam in a turbine exhaust at 8 kPa, so its mass is noise and every
     comparison against it is too: the gate is about somewhere with something
     IN it, and a node holding less than a milligram is not one. */
  return m !== undefined && eos > DRY_MIN_KG && m <= DRY_FRAC*eos; };
/* ══ A NODE WHOSE INVENTORY ANOTHER BOOK ALREADY OWNS ══
   A tank's level, a shell's water and its steam space, the hotwell, and
   containment itself: each already has an integral of its own, its own
   clamps and its own place in ledgerKg(). The mass field may not run a second
   book beside them - it reads their holdup instead. STRUCTURAL, off the maps
   netBuild() already wrote, so it costs no solve and cannot recurse, and it is
   also exactly the set whose mass no EDGE accounts for: a shell boils into its
   own steam space through a source term, not through a pipe. */
function netBooked(net){
  if(net.booked) return net.booked;
  const b = new Uint8Array(net.n);
  /* A HOLD TANK IS NOT A STORE, so it is not a BOOK either: its water is the
     circuit's own (s.lvl is thermal expansion, not mass), which means the
     mass crossing its surge line has to stay in the field rather than vanish
     into a level. Booked, the stock plant walked 0.7 % of its inventory an
     hour up the surge line and never got it back. */
  for(const id in net.tankNode) if(!(D.tanks[id] && D.tanks[id].hold))
    b[net.tankNode[id]] = 1;
  for(const i of (net.secT||[])) b[i] = 1;
  for(const k in net.condNode) b[net.condNode[k]] = 1;
  for(const i of (net.cont||[])) b[i] = 2;      // 2: a boundary with no book at all
  for(let i=0;i<net.n;i++) if(net.name[i].indexOf("sec:") === 0) b[i] = 1;
  net.booked = b;
  return b;
}
/* THE MASK THE CONDUCTANCES THEMSELVES READ (F.wet, netFieldUpdate) - hashed,
   never joined: this signature is rebuilt on every netPieces() memo check,
   several times a tick, over a few hundred nodes. Taking it off F.wet rather
   than recomputing it is also what makes the key and the assembly agree by
   construction. */
function netDrySig(net, s){
  const w = net.F && net.F.wet;
  if(!w) return 0;
  let hsh = 0;
  for(let i=0;i<net.n;i++) if(!w[i]) hsh = (Math.imul(hsh, 31) + i + 1)|0;
  return hsh;
}
function netFieldUpdate(net, s){
  const F = net.F;
  const mx = MIX_SCRATCH;
  // a node's curve is its circuit's, and a circuit is a fact about the net's own graph
  const sat = net.satBy || (net.satBy = net.name.map(netSatOf));
  for(let i=0;i<net.n;i++){ const nid = net.name[i], p = netPAt(s, nid);
    mixState(sat[i], p, netHAt(s, nid), mx);
    F.p[i] = p; F.rho[i] = mx.rho; F.x[i] = mx.x;
    F.wet[i] = netNodeDry(net, s, i, mx.rho) ? 0 : 1; }
  /* ══ AND CONTAINMENT NEVER FEEDS THE PLANT ══
     "A place water goes to and never comes back from" was true of the MASS
     field - containment is left out of it entirely, so it has no book and no
     bottom - and the momentum law was never told. A break is an ordinary
     two-way edge, so the moment a pump pulled its own suction below P.Pcont
     the hole reversed and containment pushed water back in for ever: measured,
     a cut hot leg had the RCP circulating 118 kg/s IN through the break,
     around the loop, and into whatever node the frame had anchored - a closed
     circuit between two boundaries with no water in it. F.wet is the DONOR's
     bit and nothing else, so this stops it supplying without stopping it
     receiving, which is exactly one-way. */
  for(const i of (net.cont||[])) F.wet[i] = 0;
  /* THE STORE MOVES WITH THE FIELD, and it is built HERE so it cannot be built
     twice: the diagonal and its own C/dt*p_prev are two halves of one row, and
     F.gen below is in netFactored()'s key, so a store that moved
     re-eliminates. */
  net.store = netStore(net, s);
  /* EVERY conductance is a function of this field, so a factorisation taken
     against an older one is a wrong answer, not a crash. The generation goes
     into netFactored()'s key, which means one elimination per solve - the
     stated price of a real momentum law. */
  F.gen = (F.gen||0) + 1;
}
/* ONE EDGE'S CONDUCTANCE, and the ONE place the law is applied. An edge states
   a flow COEFFICIENT (ed.C, a number or a function of s); everything else -
   the field, the head, the choke, the upstream density - is read here, so no
   builder above can price its own edge by a different rule. Written onto every
   edge by netFinish(), AFTER the static head has been folded into ed.h. */
const edgeG = (net, ed, s) => {
  const C = typeof ed.C === "function" ? ed.C(s) : ed.C;
  if(!(C > 0)) return 0;
  const h = typeof ed.h === "function" ? ed.h(s) : (ed.h || 0);
  return flowG(C, net.F, ed.u, ed.v, h);
};

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

// series flow coefficient for a run of length L carrying zero or more
// throttles by id, in series - shared by a branch edge (always exactly one id)
// and an in-line run segment (zero or more, folded straight into the pipe it
// sits on) so the "wide open costs nothing, shut removes the edge" rule is
// written once. Any one throttle at x<=0 cuts the whole edge, same as a
// shut tee: a valve is a real break in the pipe, not a small leak.
// "no gate in this path" - shared, because a literal here is one array per
// edge per solve to say the same nothing
const NO_GATES = [];
const throttledC = (s, bore, L, ids) => {
  let Ltot = L;
  for(const fid of ids){
    const x = s.valve && s.valve[fid];
    if(!(x>0)) return 0;
    Ltot += valveLeq(x);
  }
  return pipeC(bore, Ltot);
};

/* ══════════ A BREAK IS A HOLE, NOT A BLOCKAGE ══════════
   A severed run used to be modelled as a plugged pipe: conductance to zero
   and not one gram of coolant lost, which is the textbook large-break LOCA
   drawn as a blockage. It is an opening now, and so is a ruptured vessel -
   both are an EDGE to a fixed node at containment pressure, so where the
   break is, how big it is and when it stops all fall out of the same solve
   nothing new had to be invented for.

   BREAK_K is gone with the abstract currency that needed it: a hole is
   holeC(bore) and the choke is in the one momentum relation every edge takes,
   so nothing here is fitted any more. */
// A ruptured vessel is a bigger hole than a severed leg, and it is the one
// break whose size is not read off a pipe's bore.
const BREACH_BORE = 1.6;
// How long the loop's whole inventory takes to pass one point at rated flow,
// in seconds - what makes a rated power into a mass of coolant (loopKg(),
// step.js). It is no longer a currency conversion: a solved flow is kilograms
// per second on its own.
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
/* tc/pc/rhoc are the critical point, the one place latent heat and both
   saturated densities have to go to a known value; A/B/C are Antoine, fitted
   to the real steam-table points at 0.004, 6.9 and 17 MPa. */
const SAT_WATER = {A:9.844309, B:4174.5246, C:30.4331,
                   tc:647.096, pc:22.06, rhoc:322,
                   p0:6.9, T0:558, n:0.0855, pFloor:1e-4, TFloor:1,
                   hfg:1509, rho:740, cp:5.5, solidK:1.4};
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
const RHO_N = 0.35;
const rhofOf = (c,T) => c.tc
  ? c.rhoc + (c.rho-c.rhoc)*Math.pow(clamp((c.tc-T)/(c.tc-c.T0),0,6), RHO_N)
  : c.rho;
/* ══ SATURATED VAPOUR WEIGHS WHAT ITS OWN CURVE SAYS IT WEIGHS ══
   Clausius-Clapeyron read backwards: dp/dT = hfg*rho_g/T with the liquid's own
   volume neglected, so the vapour density falls out of the slope and the
   latent heat this curve already carries and needs no constant of its own.
   It replaces a power law in (1 - p/pc) fitted between 7 and 15.5 MPa, which
   had no way DOWN: at condenser vacuum it put 27 kg/m3 of steam in a turbine
   exhaust that really holds 0.03, so netNodeDry() read the exhaust as spent,
   cut its only outlet, and the stock plant ran 534 kg/s into a turbine that
   passed 0.00 out of it for ever. Measured against the steam tables the
   relation is within 6 % from 4 kPa to 7 MPa and 15 % at 15.5.
   Ceiled at the LIQUID, because hfg falls to zero at the critical point and
   the two densities meet there - which is also the old Math.min(1) on the
   ratio, kept where it belongs now. */
const rhogOf = (c,T) => Math.min(rhofOf(c,T),
  Math.max(satSlope(c, satP(c,T))*T*1e3/Math.max(hfgOf(c,T), 1e-6), 1e-6));
/* THE RATIO the drift flux reads (core2d.js), derived off the two densities so
   the ratio and the kilograms cannot disagree about the same vapour. */
const satRvl = (c,p) => { const T = satT(c,p); return rhogOf(c,T)/rhofOf(c,T); };
/* WHAT A NODE HOLDING A MIXTURE WEIGHS, kg/m3 - the volume-weighted series law,
   which is what a quality means: x of the mass occupies x/rho_g of the volume. */
const H_DATUM = 273.15;
/* WHAT A KILOGRAM OF THIS CIRCUIT GIVES WAY BY, per MPa. COOLANT[].solidK is
   beta over kappa in MPa/K and BETA_W is beta, so kappa is one divided by the
   other; pressurised water reads 1.79e-3, the right order for 583 K. */
const kappaOf = c => BETA_W/Math.max(1e-6, c.solidK || SOLID_K_W);
/* ══ QUALITY AND DENSITY, EACH OFF THE STATE THE NODE IS ACTUALLY IN ══
   A SUBCOOLED LIQUID IS AT ITS OWN TEMPERATURE. Both densities used to be read
   at satT(p), which is the sentence "every liquid in this plant is at
   saturation": feedwater at 490 K weighed 645 kg/m3 instead of 830, and worse,
   drho/dp on that branch is NEGATIVE - raise the pressure, raise Tsat, and the
   water gets lighter. A store linearised on it asks for less pressure when you
   push mass in, which is an unstable row and not an equation of state. Read at
   the node's own T the liquid branch is the real one: 999 kg/m3 cold, 830 at
   the feed train, 700 in a hot leg, and drho/dp is rho*kappa, positive and
   small, which is what a liquid is.
   SUPERHEAT IS AN IDEAL GAS in the same way - rho falls as 1/T off the
   saturated value at this pressure, so drho/dp is rho/p.
   ON THE SHELF the two saturated densities ARE functions of p alone, and the
   series law in x is what a quality means: x of the mass takes x/rho_g of the
   volume. All three branches meet: at x=0 the liquid is at Tsat and its own
   psat is p, at x=1 the superheat is at Tsat. */
const mixState = (c,p,h,out) => { const Ts = satT(c,p), hf = c.cp*(Ts - H_DATUM),
    hfg = Math.max(hfgOf(c,Ts), 1e-6);
  const x = clamp((h-hf)/hfg, 0, 1);
  out.x = x;
  if(h <= hf){ const T = Math.min(H_DATUM + h/c.cp, Ts);
    /* ══ AND A FLUID ABOVE ITS OWN CRITICAL TEMPERATURE IS A GAS ══
       Helium's critical point is 5.2 K, so every node of a gas-cooled plant is
       supercritical and there is no liquid branch for it to be on: it follows
       p/T off its own design point, which is where COOLANT[].dens is quoted.
       Read as a compressed liquid instead it came out three times as heavy at
       7 MPa - WINDSCALE voided its own core in half a second. */
    out.rho = T >= c.tc ? c.rho*(p/c.p0)*((c.Tref||c.T0)/Math.max(T,1))
            : rhofOf(c,T)*(1 + kappaOf(c)*Math.max(0, p - satP(c,T))); }
  else if(h >= hf + hfg){ const T = Ts + (h - hf - hfg)/c.cp;
    out.rho = rhogOf(c,Ts)*Ts/Math.max(T, 1); }
  else { const rf = rhofOf(c,Ts);
    out.rho = 1/((1-x)/rf + x/rhogOf(c,Ts)); }
  return out; };
const MIX_SCRATCH = {x:0, rho:0};
const rhoMixOf = (c,p,h) => mixState(c,p,h,MIX_SCRATCH).rho;
/* HOW MUCH HEAVIER A CUBIC METRE GETS PER MPa, at fixed enthalpy - the slope
   the store's diagonal is, taken off mixState() itself rather than off a
   parallel algebraic kappa. The two used to be written separately and the
   branches above do not all have the same slope: on the shelf the quality
   itself moves with pressure, which is most of a two-phase volume's
   compliance, and no closed form of it was ever written down. Numerical, one
   extra curve read, floored at nothing - the caller owns the degenerate row. */
const DRHO_DP = (c,p,h) => { const dp = Math.max(1e-4, p*1e-3);
  return (rhoMixOf(c, p+dp, h) - rhoMixOf(c, p, h))/dp; };
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
/* What a kilogram of steam at the DESIGN shell pressure occupies - the anchor
   the turbine's own flow coefficient is fitted at (P.turbC, step.js). Asked of
   the first shell's own circuit, because that is whose curve it boils on; a
   board with no generator has no shell to ask and takes the core's. */
const steamRhoDes = () => { const id = sgIds()[0];
  const ci = id !== undefined ? shellCirc(id) : nodeGraph().coreCirc;
  return Math.max(1e-3, rhogOf(satOfCirc(ci), tsatSec(sgDesignP(), ci))); };
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
/* ══ WHAT IS IN A PRESSURIZER, AS AN ENTHALPY ══
   A vessel part full of water with a saturated bubble over it. The LEVEL is
   the share of the volume the water has, so the quality is the share of the
   MASS the bubble has, and that is one point on the shelf: everything else
   about a pressurizer - what it holds, how hard it is to move, what a heater
   buys - falls out of it. The seed, and the one place that knows the two
   readings are the same fact. */
const holdSeedH = (ci, p, lvl) => { const c = satOfCirc(ci), T = satT(c, p);
  const rf = rhofOf(c,T), rg = rhogOf(c,T), f = clamp(lvl,0,100)/100;
  const x = (1-f)*rg/Math.max(f*rf + (1-f)*rg, 1e-9);
  return satH(c,p) + x*hfgOf(c,T); };
/* AND BACK: what share of this node's VOLUME is liquid, 0..100. A level is a
   volume fraction and a quality is a mass fraction, so this is the same
   conversion read the other way. */
const holdLvlOf = (s, nid) => { const c = satOfCirc(circOfNode(nid));
  const p = netPAt(s,nid), T = satT(c,p), x = clamp(xOfH(c,p,netHAt(s,nid)),0,1);
  const rg = rhogOf(c,T), rf = rhofOf(c,T);
  const vg = x/Math.max(rg,1e-9), vf = (1-x)/Math.max(rf,1e-9);
  return 100*vf/Math.max(vf+vg, 1e-12); };
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
// cached for the length of one pass (layPass()) - a fact about the drawing, asked per run per tick
let burstCache = {}, burstPass = -1;
const runBurstP = r => { const pn = layPass();
  if(pn && burstPass !== pn){ burstCache = {}; burstPass = pn; }
  if(pn && burstCache[r.key] !== undefined) return burstCache[r.key];
  const v = runRating(r)*PIPE_BURST_K;
  if(pn) burstCache[r.key] = v;
  return v; };
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

/* THE FALLBACK ONLY. A shell with a temperature of its own is a saturated pot
   and secP() reads that; this is what a caller with no live S gets - the design
   bench, layoutMetrics(), a tick-zero seed. */
const secPTarget = (s, id) => {
  const base = sgDesignP(id)*Math.pow(Math.max(secLoad(s,id),.05),.25);
  const fill = (id===undefined || !s.sglBy || s.sglBy[id]===undefined)
             ? 1 : clamp(s.sglBy[id]/SG_DRY,0,1);
  return COND_P0 + (base-COND_P0)*fill;
};
/* ══ THE SHELL IS AN INVENTORY, AND ITS PRESSURE IS THE ANSWER ══
   It carried an OVER-DETERMINED state: a water mass, a steam mass, a steam
   volume and a temperature - so a density, and so a pressure by the equation
   of state - AND a second pressure off the saturation line, psat(s.sgTBy).
   Those two can disagree, and SG_FLASH_TAU was a fitted four seconds standing
   in for "in a saturated vessel they cannot".
   The state is collapsed onto ONE. The shell's pressure is integrated from
   its own energy balance (step.js): heat in across the tubes, less the
   feedwater's way up to saturation and the skin, less the latent heat of
   everything that left as steam, against the water, the steel and the steam
   space that all resist it moving. The steam mass and the temperature both
   follow from it. */
const secP = (s, id) => {
  /* A BURST SHELL IS AN OPENING. It cannot hold pressure again whatever is in
     it, so it sits at the room's - the same anchor a break and a vent already
     relax to. Read here rather than at each caller, because every one of them
     (the feed pumps' back pressure, the SGTR differential, the panel) is
     asking the same question. */
  if(id!==undefined && sgOpen(s,id)) return regionPAt(s, partOf(id));
  /* A CALLER WITH NO SHELL still gets an answer, and secPTarget() is what it
     is: the bench, layoutMetrics(), the tick-zero seed. It is the estimate a
     plant that has never run has of its own shell, and nothing with a live
     inventory reaches it. */
  const p = id!==undefined && s.sgPBy ? s.sgPBy[id] : undefined;
  return p===undefined ? secPTarget(s,id) : Math.max(COND_P0, p);
};
// rated leak, in % of loop inventory per second, at the design differential -
// the flat rate this used to run at, kept as the scale and turned into a
// conductance so the differential can move it
const SGTR_RATE = 0.30;
// THE REAL DESIGN DIFFERENTIAL, primary setpoint less shell design pressure -
// it was P.P0*0.55, a second fitted fraction that only ever meant "one minus
// the 0.45", so the two could drift apart with nothing to catch it
/* The flow coefficient a tube leak of that rate has: the hole that passes
   SGTR_RATE of the loop's own inventory per second at the design differential,
   through the same relation every other edge takes. */
const sgtrC = () => {
  const dp = Math.max(holdSetP(nodeGraph().coreCirc) - sgDesignP(), 0.05);
  return (SGTR_RATE/100)*loopKg()/Math.sqrt(2*Math.max(P.rho0||700,1)*dp*1e6);
};
const sgtrLive = (s, id) => partWrecked(s, id);

/* ══════════ FLUID: a table of SUBSTANCES, not of components ══════════
   There is no such thing as "the HPI tank" any more. There is a tank, and
   there is what is in it. This table is the second half of that sentence -
   a real physical taxonomy, not a component list, and the thing that lets
   ONE tank component be four different tanks.

   There is deliberately no DENSITY row. A node's density is what its own
   (p, h) says on its circuit's own curve (netRhoAt()), so a second figure
   stated per substance here would be a second answer to one question about a
   quantity the curve already carries. A density field here would have had no honest
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
     a SANDBOX INSTRUMENT (tools/sandbox/): the one honest way to isolate a
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
/* A HOLD TANK IS NOT A STORE, AND THAT INCLUDES THIS POOL. Its level is s.lvl
   - thermal expansion, not mass - so ledgerKg() does not count one, and the
   condensate loop was handing a share of the pool to a vessel the books have
   no column for: measured, a pressurizer whose surge line was deleted lands on
   the secondary and took 0.025 kg of unattributed mass on tick 2. s.tank[id]
   is a shadow copy for one, which tankLvl() already refuses to read. */
const secTankIds= () => tankIds().filter(id=>tankSecondary(id) && !D.tanks[id].hold);
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
/* ONE LEVEL, NOT TWO. A hold tank's level IS s.lvl - read off its own node's
   void fraction (holdLvlOf) - so this reads it back rather than letting
   s.tank[id] become a second, silently disagreeing copy. */
const tankLvl   = (s,id) => D.tanks[id] && D.tanks[id].hold && s.lvl !== undefined ? s.lvl
                : (s.tank && s.tank[id] !== undefined) ? s.tank[id] : D.tanks[id].level;
/* ══ AND A VENTED TANK IS NOT A VACUUM ══
   A vessel with nothing behind it is open to the compartment, which is where
   every other opening on this plant already sits (P.Pcont). It read 0 MPa
   absolute - a hard vacuum a pump could not lift out of - because the only
   thing that had ever held one up was a PUMP FIELD ON THE TANK, and a pump is
   a part on the grid now. */
function tankP(s,id){
  const t = D.tanks[id];
  if(!t) return 0;
  const ci = tankCircuit(id);
  // CONTROLLED, so no gas law is consulted: a hold tank holds its circuit's
  // own setpoint, and the setpoint is what step() integrates
  if(t.hold && s && P && P.net && holdLive(P.net, s, ci)) return loopP(s, ci);
  /* ...AND AN ISOLATED HOLD TANK IS A GAS TANK. Cut off from its loop it is a
     steam bubble in a shut vessel, which is the charge law every other tank
     already answers on - so there is no second pressure model here, only a
     charge the vessel states instead of one the player types: its setpoint at
     its own design level. It used to go on printing loopP, so shutting the
     surge port had the pressurizer follow the loop it was no longer on all the
     way down to containment. */
  const gas = t.gas || (t.hold
    ? {p0: holdSetP(ci), frac: Math.max(0.01, (100-clamp(t.level,0,100))/100)} : null);
  // a bubble squeezed to nothing is a divide by zero, and a gauge cannot print one
  return Math.max(regionPAt(s, partOf(id)), !gas ? 0
    : gas.p0*gas.frac/Math.max(0.01, gas.frac + (t.level - clamp(tankLvl(s,id),0,100))/100));
}
/* ══ AND A GAS CHARGE IS A COMPLIANCE, NOT A FIXED PRESSURE ══
   tankP() above IS the charge law, so its inverse is the vessel's own
   kilograms per MPa: p = p0*frac/g with g the gas fraction, so dg/dp is
   -p0*frac/p^2, and a percentage point of level is tankKg/100 kilograms.
   Written as the exact inverse of the expression beside it rather than as a
   second law, so the two cannot disagree about the same vessel.
   A tank with no charge behind it is open to the compartment and holds no
   pressure of its own, so it has nothing to give way with and stays a
   boundary; so does an `inf` tank, which is a boundary by definition (the
   sandbox's source and void), and a HOLD tank, which is its component's own
   anchor. What this buys is the RATE: a big accumulator comes out near 2 000
   kg/MPa and is a fixed node to within nothing, and a small one is genuinely
   soft - which is what an accumulator IS. The rest point is unmoved, because
   the store's own p_prev is tankP() itself. */
const tankStores = id => { const t = D.tanks[id];
  return !!t && !t.hold && !t.inf && !!t.gas; };
const tankCapAt = (s,id) => { const t = D.tanks[id];
  if(!tankStores(id)) return 0;
  const p = Math.max(tankP(s,id), regionPAt(s, partOf(id)));
  return tankKg(id)*t.gas.p0*t.gas.frac/(p*p); };
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
   the solve consumes - the line is a real pipe edge and this is only what that
   model measures at full differential against containment. */
/* One law now: a tank's line is ordinary pipe and nothing else, because a pump
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
/* Can this tank's own edge carry anything at all? The valve and the diode,
   and NOTHING ABOUT WHAT IS LEFT IN IT.
   ══ THE INVENTORY CLAUSE IS GONE, AND THE FIELD ANSWERS IT ══
   "An empty tank has nothing to give" had to be spelled here - as a level
   test, then as a level test OR the loop is above me, then with a second
   predicate (tankSuction) to keep a catch tank's whole life from applying to
   a reserve on a pump's suction - because a tank node is a fixed pressure and
   a fixed pressure has infinite inventory. It does not any more: the node
   carries the tank's own kilograms (bookedKg, step.js) and the run-dry gate
   (flowG) stops it feeding when they are spent, both ways, at the node. Three
   design-time predicates and one whole class of bug replaced by the state
   itself. tankFillable() and tankSuction() had no other caller and are gone
   with it. */
const tankLive = (s,id) =>
  /* A WRECKED TANK IS NOT A TANK. Every other component's internal edge is cut
     by its own damage in netBuild(); a tank's edge is built here instead and
     escaped that, so a destroyed reserve went on injecting exactly as it did
     intact. Same one door (partWrecked(), layout.js) the rest of the plant
     now asks. */
  !partWrecked(s,id) && (
  /* A HOLD TANK IS LIVE WHENEVER IT IS OPEN, stated rather than left to the
     clause below - which answers correctly today by coincidence, not by
     saying anything true. Surge goes both ways by definition and there is no
     level at which the vessel stops being the plant's pressure boundary. */
  D.tanks[id].hold ? tankOpen(s,id) :
  tankOpen(s,id) && tankCheckOpen(s,id));

/* condLive() IS GONE for the same reason tankLive()'s inventory clause is:
   the condenser's own node carries the hotwell's kilograms now (bookedKg,
   step.js) and the run-dry gate stops it feeding a pump when the pool is
   spent. It was the same sentence, asked in a second place. */

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
   head - the reference machine's casing is exactly the ordinary component passage every
   other box gets. The root on the head is the momentum relation's own: a coefficient is
   a flow over a ROOT differential, so a machine of twice the head wants a casing tighter
   by root two to run out at the same multiple. A TANK's pump is one of these too: given a
   head and no swallow it was an unlimited source, and a 19 t reserve referenced
   8965 kg/s - enough to empty itself in two seconds. */
/* ══ WHAT A MACHINE'S OWN BODY COSTS, and it is the ONE fitted number left ══
   A pump's casing, a generator's feedwater train: a passage sized to pass that
   machine's OWN rated duty against CASING_F of the reference friction head.
   Measured against PUMP_H0 and not against the machine's own head on purpose -
   a casing's loss is a property of how much the machine swallows, not of the
   pressure it works against, and pricing it on the full head made every feed
   pump lifting into a 17 MPa shell under-deliver by a quarter.
   ONE fit replaces six: PIPE_K, INJ_K, BREAK_K, FEED_LEN, BUOY_LIN and the
   vapour side's own line anchor. Left free, the drawn geometry answers alone and a
   low-head sodium loop runs out at twice its rating; too tight and nothing is
   left for the circuit. A quarter is the measured middle. */
let CASING_F = 0.25;
function setCasingF(v){ CASING_F = v; }
const dutyC = (q, rho) =>
  Math.max(q,0)/Math.sqrt(2*Math.max(rho||700,1)*CASING_F*PUMP_H0*1e6);
const pumpCasingC = (h, q) => dutyC(q, P.rho0);
/* A GENERATOR'S OWN FEEDWATER TRAIN, sized the same way: this shell's share of
   what the plant raises. It is water on every plant, whatever the primary is. */
const feedTrainC = () => dutyC(P.steamRef/Math.max(sgCount(),1), SAT_WATER.rho);
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
  (partWrecked(s, pid) ? 0 : 1) * flowOf(s, pid);
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
// ADDITIVE equivalent length on the SAME pipeC() every other run already
// uses, never a multiplier on g - a multiplier could turn one bug into a
// negative conductance and an indefinite Laplacian; additive resistance
// cannot represent one. It is a SEVERANCE, not a partial restriction - every
// other row in DMGFX (step.js) is a binary hit/fix state, not a graduated
// one, and a pipe hit follows the same idiom rather than inventing a
// magnitude nothing else in the game has. The added length is Infinity,
// which pipeC() carries straight through to an exact 0 (finite/Infinity is
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
/* A WRECKED NOZZLE VALVE IS A HOLE, NOT A JAM. The valve BODY is what failed,
   and a valve body is the pressure boundary - so the run standing on it is
   severed at the machine and open to containment there, which is the same
   pair of consequences a broken pipe cell already carries. Jamming is what a
   wrecked ACTUATOR does, and that is a different fault from a dead one.
   Asked of anything carrying cells and its two ports - a run, and a
   steamBreaks row, which is the same three fields. */
const runHoled = (s, r) => pipeExtraLen(s, r.cells) === Infinity
                        || portWrecked(s, r.pa) || portWrecked(s, r.pb);
const runExtraLen = (s, r) => runHoled(s, r) ? Infinity : 0;

/* ══════════ FIT: one row per fitting BEHAVIOUR ══════════
   Same idiom as LAYERS (render/layers.js), DMGFX and AUTOSYS (sim/step.js):
   one table, one row per mode, adding a mode is adding a row. A mode with no
   row here is a mode with no edge, which is exactly what a tee is: its four
   faces fold onto one node. `C(s,id,bore,len)` states the fitting's own FLOW
   COEFFICIENT, the same m^2 a run states, so the momentum relation takes a
   branch built off this table exactly as it takes a pipe - only the shape of
   the coefficient, and whether it is gated by a boolean or a live position,
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

   OPEN, it is a HOLE and not a length of pipe: an orifice's choked flow
   depends on its own AREA and not on the pipe downstream of it, which is why
   a break prices the same way. There used to be a whole fitted constant
   between those two answers, because a linear conductance sized about a
   0.6 MPa pump head passes absurd current at the 15 MPa a lifting valve
   actually sees; the momentum relation carries the root and the choke itself
   now, so the two answers are the same law and the constant is gone.
   `len` still gates it, the same as every other mode: the caller adds
   pipeExtraLen() onto it when the branch pipe itself is severed, and Infinity
   has to reach 0 here, or a severed relief branch would go on venting at its
   full rate - a length this mode is otherwise right to ignore is still the ONE
   way that pipe gets to say "there is no pipe". */
/* ══ WHAT A FITTING'S OWN PATH CONDUCTS ══
   One row per MODE, and the mode is a knob on the instance. `tee` has no row
   because a tee has no edge at all: its four faces are one node (ROLE.fold),
   which is what a junction IS.
   The gated cross-tie that used to be `tee` is `throttle` now, and that merge
   is VERIFIED, not asserted: the old FIT.tee.g was the bare pipe open and
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
    C:(s,id,bore,len)=>throttledC(s,bore,len,[id]),
  },
  relief:{
    C:(s,id,bore,len)=>(reliefLive(s,id) && isFinite(len)) ? holeC(bore) : 0,
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
   break or an injection line - resolved fresh off netSolve(), never on
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
   line, and a headless caller pushes a tank up and asks again on the same object - so
   a cache that spanned either would answer for a plant that has moved on. It
   is keyed on the state it was solved against as well, because a replay frame
   draws a snapshot beside the live plant. */
let reliefOuts=null, reliefOutsFor=null, netPassLive=false;
const netPassStart=()=>{ netPassLive=true;  reliefOuts=null; reliefOutsFor=null; };
const netPassDrop =()=>{ netPassLive=false; reliefOuts=null; reliefOutsFor=null; };
function reliefRate(s, fid){
  if(!(P && P.net)) return 0;
  let o = (netPassLive && reliefOutsFor===s) ? reliefOuts : null;
  if(!o){ o={}; netReadEdges(netSolve(P.net, s), null, null, null, o);
    if(netPassLive){ reliefOuts=o; reliefOutsFor=s; } }
  const q = o.reliefBy && o.reliefBy[fid];
  return q ? Math.max(0, invRate(q)) : 0;
}
/* DISPLAY ONLY, never a gate: what THIS fitting's own branch would pass if
   it were wide open against a full design differential (P.P0 to P.Pcont) -
   the scale reliefRate() is judged against for the plume and the panel's
   band, nothing more. Off the SAME holeC(bore) FIT.relief itself prices its
   edge with, through the same relation, so this stays the true ceiling
   reliefRate() can approach and never an unrelated number the display happens
   to divide by. The header's own downstream segment is left out of it on
   purpose: its own passage is orders past the valve's own choke, so it is not
   the series term that decides
   this ceiling and carrying it here would only add a length-of-header
   nuance too small to see against a rounding error. 0 for a fitting whose
   branch never routed - the same "not there" fallback every other reader of
   a missing run already uses. */
/* WHERE A RELIEF VALVE IS STOOD, as a node name. A lift is about the pressure
   AT THE VALVE, and a plant-wide scalar said otherwise: a valve behind a shut
   port lifted on the reactor's own pressure and vented a branch that could not
   see it. The upstream end of its own gated edge - null where nothing routed,
   which the caller answers for. */
function reliefNodeOf(net, fid){
  for(let e=0;e<net.edges.length;e++)
    if(net.edges[e].fit === fid) return net.name[net.edges[e].u];
  return null;
}
function reliefFullRate(s, fid){
  if(!((P && P.fittings && P.fittings[fid]) || D.fittings[fid])) return 0;
  const bore = fitBoreK(fid);
  return Math.max(0, invRate(flowW(holeC(bore), P.rho0, P.P0, regionPAt(s, partOf(fid)))));
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
// plenum, r_core=0, and that identity is what makes a no-junction plant
// exact - every loop becomes an independent core-to-core
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
  const G=nodeGraph(); if(G.fold) return G.fold;   // coreFold() asks this ~1000 times a tick
  const m={};
  for(const p of LAY.parts){
    const f=foldFacesOf(p); if(!f) continue;
    // a LIST folds every face onto one node; a MAP folds each named face
    // onto another face of the same part, which is what gives a valve two
    // sides with its gate in between
    if(Array.isArray(f)) for(const face of f) m[p.id+face]=p.id;
    else for(const face in f) m[p.id+face]=p.id+f[face];
  }
  G.fold=m;
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
/* AND WHICH HEIGHT A NAMED NODE IS AT. A FOLDED NODE IS THE BARE PART ID -
   the core's single plenum, and a tee's four faces - so it is looked up whole
   before the face is sliced off, or a node called "fit1" resolves as a part
   called "fit" and silently sits wherever that box was placed. null is "no
   part here"; both callers owe that case their own answer, and they give
   different ones - netBuild() drops such a node at the core's height, the
   wall walks past it. */
const nodeZ = nid => { const whole = partOf(nid);
  if(whole) return zFace(whole, "c");
  const q = partOf(nid.slice(0, -1));
  return q ? zFace(q, nid.slice(-1)) : null; };

/* WHICH SIDE OF THE CORE A RUN LEAVES BY - a direction and animation LABEL and
   nothing else (net2.tag, netFinish). It used to feed buoyancy, which is why
   adding a row here once broke the isothermal invariant; the static head reads
   each node's own density now, so a row here can no longer move a flow. */
const NT_HOT = 1, NT_COLD = 2;
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
/* FLOORED AT THE PLANT'S OWN VACUUM. A pump's suction node legitimately sits
   very low, and asking the saturation curve about 1e-4 MPa put a condensate
   line at 215 K - a phase reading off a number that is not a pressure.
   COND_P0 is the best vacuum this plant can ever pull and is the same floor
   secP() already applies. */
/* AND A NODE THE SOLVE DOES NOT CARRY READS ITS OWN CIRCUIT'S SETPOINT, never
   the REACTOR's. s.P is the primary's entry, so an isolated secondary node -
   a standby pump's suction behind a shut valve, a dead-ended branch - was
   seeded at 15.5 MPa and stayed there: every node has a store row now, so
   that seed no longer gets washed out by the first solve, and the burst test
   cut the stock ship's own emergency feed line on tick one against a wall
   rated 9.9. circSetP() is what the wall itself was derived from
   (runDesignP), so the two now answer about the same circuit. */
function netPAt(s, nid){
  const f = s.pBy && s.pBy[nid];
  if(f !== undefined) return Math.max(COND_P0, f);
  const c = circSetP(nid);
  return Math.max(COND_P0, c > 0 ? c : (s.P===undefined?P.P0:s.P));
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
/* WHAT IS AT THIS NODE WEIGHS, kg/m^3 - the same (p, h) the temperature and
   the quality already come off, on the circuit's own curve. Whether a node
   holds liquid, vapour or a mixture is a RESULT of its own state and never a
   setting on the run that reaches it, so the momentum relation needs no
   answer to "what kind of pipe is this". */
function netRhoAt(s, nid){
  const c = netSatOf(nid);
  return rhoMixOf(c, netPAt(s,nid), netHAt(s,nid));
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

   IT IS THE ABSOLUTE COLUMN NOW, and the piezometric datum is gone with the
   single density that made one possible. phiRef()/rhoDatum() existed BECAUSE
   the network was all liquid at one density; with a density per node there is
   no one column to subtract, so the solve carries real pressure and the static
   term is explicit here.
   WHAT THAT GIVES UP: against the datum an isothermal loop's static heads
   summed to exactly 0.0 by construction, so a manufactured thermosiphon was
   impossible. Now they sum to zero only as well as the density field does -
   the netRing rig profile is what measures the circulation that leaves behind.

   ONE TICK OLD, deliberately - the field is advected along the flows this
   solve produces, so it cannot also be an input to it. The same s.coreDT
   idiom every other feed-forward in this sim uses. */
/* A BREAK, A VENT AND A TUBE LEAK ARE HOLES. One predicate, because it is the
   same rule in all four places that ask it - the fitTarget walk, the elevation
   copy, the contents pass and the buoyancy pass - and a hole is an opening to
   a PLACE, not a leg of a circuit. The literal was written out four times and
   named in only one of them; the split makes that a cross-function hazard
   rather than a local one. "break"/"vent"/"sgtr" are SYNTHETIC edge kinds
   netEdges() itself invents, never a run's own declared kind. */
const netHole = ed => ed.kind === "break" || ed.kind === "vent" || ed.kind === "sgtr";

const staticH = (net, ed) => {
  const dz = net.z[ed.u] - net.z[ed.v];
  if(dz === 0) return 0;
  const F = net.F;
  return (F.rho[ed.u] + F.rho[ed.v])/2 * G_MPA * dz;
};

/* Builds the compiled graph once per commission. Topology only - every edge
   but a fitting's own is still a plain number, so most of the matrix is
   fixed the moment this returns; a fitting's g is a function of live
   S.reliefOpen or S.valve (see the ROLE.internal loop below), which is
   exactly why netFactored() below has to key its cache on more than just
   this object. */
/* THREE PASSES, AND BOTH BOUNDARIES ARE FORCED.
   netEdges() builds every node and every edge; netMaps() derives every array
   off them; netFinish() mutates the edge list and then walks it. Neither cut
   is a matter of taste. The elevation pass copies z along break, vent and
   sgtr edges and the fitTarget walk reads the whole edge list, so both need
   EVERY edge to exist - that is the first. The condenser splice looks edges up
   by node NAME, so net2.name must already be written, and everything after the
   splice walks the post-splice list - that is the second.
   Merging them back is legal and buys nothing: it restores exactly the
   derive-then-mutate interleaving that made this hard to read, with the
   name-before-splice trap unmarked. */
function netBuild(){
  const ctx = netEdges();
  return netFinish(netMaps(ctx), ctx);
}

/* ══ PASS ONE: EVERY NODE AND EVERY EDGE ══
   The runs, the internal paths, the relief vents, the breaks, the tube
   ruptures and the vessel's own two openings. Nothing here reads a derived
   array, which is what makes the cut clean in the other direction too. */
function netEdges(){
  const net = pipeNetwork();
  // the field every edge closure below linearises its own law about; sized and
  // filled by netMaps()/netSolve(), captured here because the closures are
  // built before the net object exists
  const F = netFieldOf();
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
     higher pressure. netReadEdges() below identifies core flow by this index
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
  /* AND ITS CELL, for the same reason and in the same place: a break at a pipe
     cell lets go INTO whatever region that cell is in, and a break outside the
     wall lets go into the ship. Without this every opening on the plant
     discharged to one constant. */
  const contCell = {};

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
  // it keeps the single edge exactly as before, bit-for-bit, unless an in-line throttle sits on
  // it, in which case that one edge's g becomes a function of the throttle's
  // live position instead of a plain number - see pushSeg. A branch-tapped
  // run instead becomes a chain of series edges, one per tap sorted along the
  // run plus one to the far end - electrically the same run, just able to
  // disagree with itself about pressure at the point a branch actually
  // leaves it; any in-line throttle whose own t falls inside one of those
  // segments folds into THAT segment's edge, in series with the pipe either
  // side of it. pipeC()'s existing NET_COMP_LEN floor is what stops a
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
      /* ONE LAW: a tank's line is ordinary pipe, priced off its own drawn bore
         and length like every other run. A tank that cannot deliver wants a
         bigger line, which is a thing the player can draw. */
      edges.push({u, v,
        C: s => (tankLive(s,tid) && runPortsOpen(s,r))
                ? pipeC(bore, L + runExtraLen(s, r)) : 0,
        h: 0, kind: r.k, key: r.key}); // LABEL: carried onto the edge for rendering/lookup, never re-compared here
      continue;
    }
    /* r.k is a LABEL, carried onto the edge so a renderer can read it back;
       nothing here branches on it. */
    /* ══ AND A STEAM LINE IS A PIPE ══
       There is ONE graph. A vapour run used to carry g 0 here and a SPEC the
       second matrix read back off it; it takes the same pipeC() every other
       run takes now, and what it passes is the same momentum relation at its
       own end's own density. That is the whole of why a steam line can fill
       with condensate and a water line can flash. */
    edges.push({u, v, C: s => runPortsOpen(s,r)
                  ? throttledC(s, bore, L + runExtraLen(s, r), NO_GATES) : 0,
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
    const ua = nodeIdx(coreFold(p.id+IN.a));
    /* ══ THE FEED TRAIN LANDS IN THE WATER, NOT IN THE STEAM ══
       This path used to end at the generator's own steam port, so the shell's
       compliance had to be told to take the feedwater straight back out - a
       lagged flow in the right-hand side, which forces the solve to make that
       edge carry what it carried last tick and ran the node to -10 988 MPa.
       It ends at the POOL instead: `sec:<id>`, the same node the tube rupture
       already leaks into, because it is the same water. */
    const pool = R.sgtr && secondaryNode(p.id+IN.a);
    const ub = pool ? nodeIdx("sec:"+p.id) : nodeIdx(coreFold(p.id+IN.b));
    if(ua === ub) continue;
    const edge = {u: ua, v: ub,
                  C: COMP_C, h: 0, kind: IN.kind, key: "comp:"+p.id+":"+IN.a+IN.b};
    /* WHICH OF THIS PATH'S OWN FACES SITS IN A STEAM SPACE - see net2.vapour
       below. Per FACE and not per edge, because a generator's shell path is
       water at the feed nozzle and steam at the steam nozzle, and one answer
       for the whole edge could only ever be wrong at one end. */
    if(IN.vap){ edge.vapU = IN.vap.indexOf("a")>=0;
                edge.vapV = !pool && IN.vap.indexOf("b")>=0; }
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
      edge.C = s => row.C(s, p.id, bore, NET_COMP_LEN);
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
      /* ── AND THE TRAIN IT SITS IN IS A REAL MACHINE ──
         FEED_LEN was a fitted 400 m of equivalent pipe, and deleting it left
         the path at the ordinary component passage: 0.1 m of full bore, which
         is where fifteen thousand kilograms a second per MPa comes from, and
         no valve can settle against that - the regulator goes bang-bang at its
         own rate limit and stays there. A real feedwater train (regulating
         valve, economizer, distribution ring) is where the pump's head is
         spent, so it is SIZED off the duty it is built for, the same move the
         pump's own casing makes: this shell's share of the steam the plant
         raises, at the head the feed pumps develop. Nothing is fitted. */
      /* ══ AND THE REGULATING VALVE IS A GATE, NOT A BACK-PRESSURE ══
         It was `h = -fregBy` in MEGAPASCALS on a conductance that never moved,
         so the valve's whole authority was fregMax() of opposing head - the
         feed pump's own developed head - and not one pascal more. That holds
         while the shell is near its design pressure and fails the moment it is
         not: measured, a shell blown down to 1.3 MPa had the valve hard on its
         9.910 stop, fully shut, passing 252 kg/s and still climbing, because
         the differential across the train had outgrown the stop. Then it fed
         itself - cold water killed the steam space, the pressure fell further,
         the differential grew - and the generator filled to 100 %.
         A FRACTION SHUT, 0..1, closing the path itself: at 1 the C is 0, the
         edge is absent, and no differential passes anything. The reason it was
         a head - "a valve that moves every tick cannot bust netFactored()'s
         signature" - died with the momentum law: F.gen is in that key and
         every conductance is a function of the field, so the elimination
         already runs once per solve and this costs nothing. */
      edge.C = s => feedTrainC()*(1 - clamp((s && s.fregBy && s.fregBy[p.id]) || 0, 0, 1));
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
      const cC = pumpCasingC(pumpHead(p.id), pumpFlow(p.id));
      edge.C = pumpStandby(p.id) ? s => pumpFwd(s, p.id) ? cC : 0 : cC;
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
    { const c0 = edge.C, pid = p.id;
      const dead = s => partWrecked(s, pid);
      edge.C = typeof c0 === "function" ? s => dead(s) ? 0 : c0(s)
                                        : s => dead(s) ? 0 : c0; }
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
  const reliefContNode = fid => { const i = contNode("relief:"+fid); breakIds.push(i);
    // it lets go where the VALVE stands, so it lets go into that valve's own region
    const q = byId[fid]; if(q) contCell[i] = [q.x+((q.w/2)|0), q.y+((q.h/2)|0)];
    return i; };
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
    edges.push({u: open, v: reliefContNode(fid), C: pipeC(fitBoreK(fid), NET_COMP_LEN),
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
    const bore = runBore(r), hC = holeC(bore);
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
    /* A MACHINE REACHES THE HOLE THROUGH ITS OWN NOZZLE VALVE. The break hung
       off both ends unconditionally, so a severed line drained the vessel
       through a valve the operator had already shut - the one move isolation
       exists for. A WRECKED valve body is not isolation (runHoled(), above):
       it passes, and discharges at its own cell besides. */
    const endLive = (s, pid) => portOpen(s, pid) || portWrecked(s, pid);
    /* AND AN EMPTY TANK POURS NOTHING OUT OF A SEVERED LINE. A non-hold tank's
       node is FIXED at tankP (netFixed), so it has infinite inventory: the run
       edge already asks tankLive(), the hole did not, and a reserve emptied to
       0 % went on spilling at a constant rate for ever. INVENTORY only, never
       the whole of tankLive(): a checked tank's diode is judged against the
       LOOP, and a hole downstream of it is at containment - the check valve
       opens on the break, which is the accident being played. */
    /* A HOLD TANK IS NOT A STORE and its node is not fixed - it IS the loop,
       so a severed surge line drains the plant through it whatever its level
       reads. Only a tank the solve gives infinite inventory to is asked. */
    const stock = nid => { const id = tankIdOf(nid);
      return id && !(D.tanks[id] && D.tanks[id].hold) ? id : null; };
    const tidA = stock(ends[0]), tidB = stock(ends[1]);
    /* endGive() IS GONE - a break's own donor node is asked by flowG's
       run-dry gate now, and it is asked of every node alike rather than of a
       tank at one end of one run. */
    const endsOf = r => [[ua, r.pa, tidA], [ub, r.pb, tidB]];
    for(const [x,y] of r.cells){
      const v = contNode("pipe:"+x+","+y);
      breakIds.push(v);
      contZ[v] = zRow(y);                  // the hole's own elevation, not a machine's
      contCell[v] = [x,y];
      for(const [u,pid,tid] of endsOf(r))
        edges.push({u, v, C: s => (cellBroken(s,x,y) && endLive(s,pid)) ? hC : 0,
                    h: 0, kind: "break", sec, steam, key: "break:"+r.key});
    }
    /* ...AND A WRECKED NOZZLE VALVE IS ONE MORE OPENING ON THE SAME RUN
       (runHoled(), above), discharging at ITS OWN cell rather than at any pipe
       cell - the same node-per-hole shape, so nothing downstream of here can
       tell the two apart. */
    for(const pid of [r.pa, r.pb]){
      const c = portCell(pid); if(!c) continue;
      const v = contNode("port:"+pid);
      breakIds.push(v);
      contZ[v] = zRow(c[1]);
      contCell[v] = c;
      for(const [u,end,tid] of endsOf(r))
        edges.push({u, v, C: s => (portWrecked(s,pid) && (end === pid || endLive(s,end))
                                  ) ? hC : 0,
                    h: 0, kind: "break", sec, steam, key: "break:"+r.key});
    }
  }
  /* ══ THE MACHINE'S OWN STEAM PATH, AND IT IS AN EDGE LIKE ANY OTHER ══
     ROLE.vapPath was read by the second matrix and by nothing else. It is an
     ordinary edge now, and the ONE thing that is not ordinary about it stays:
     the steam does shaft WORK crossing it, which a pipe does not do. That is
     charged in the enthalpy (turbDh, step.js) and not as a head here - a head
     term as well would take the same energy out twice.
     Its C is the GOVERNOR, live off the machine's own gate (turbCOf, step.js),
     which is what makes a tripped turbine an absent edge rather than a factor
     applied to one. */
  for(const p of LAY.parts){
    const R = ROLE[p.role]; if(!R || !R.vapPath) continue;
    const ua = nodeIdx(coreFold(p.id+R.vapPath.a)), ub = nodeIdx(coreFold(p.id+R.vapPath.b));
    if(ua === ub) continue;
    edges.push({u: ua, v: ub, C: s => turbCOf(s, p.id), h: 0, kind: "vap",
                key: "vap:"+p.id, machine: p.id, work: !!R.vapPath.work,
                vapU: true, vapV: true});
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
    edges.push({u: nodeIdx(id+"b"), v, C: s => sgtrLive(s, id) ? sgtrC() : 0,
                h: 0, kind: "sgtr", key: "sgtr:"+id});
    /* REGISTERED WHETHER OR NOT A STEAM RUN ROUTED. It is a node that STORES
       now, so its own row solves p = p_prev + w*dt/C with no edges at all -
       which is exactly the integral step() used to run, and it is what a
       generator with nowhere to send its steam does: pressurise onto its own
       safeties. Registered here rather than only where a run reached it, or
       that plant would have no shell pressure anywhere. */
    secTIds.push(nodeIdx(id+"t")); secTParts.push(id);
  }

  /* the vessel's own opening. s.breach stays exactly the latched flag the
     board, the scenarios and tripCause() all read - what goes is the fixed
     2.4 %/s drain that ran at one rate forever whatever the operator did. */
  { const v = contNode("core"); const q0 = byId[roleId("core")];
    breakIds.push(v);
    if(q0) contCell[v] = [q0.x+((q0.w/2)|0), q0.y+((q0.h/2)|0)];
    edges.push({u: coreNode, v, C: s => s.breach ? holeC(BREACH_BORE) : 0,
                h: 0, kind: "break", key: "break:core"}); }
  /* ══ A DESTROYED VESSEL EMPTIES ITSELF ══
     A breach is a hole at the plenum's own height, so it spans no column and
     stops the moment the loop reaches containment pressure - a wound that
     stops bleeding with two thirds of the water still in. That is honest for
     a pressure rupture and wrong for a vessel the board draws as torn open,
     so a WRECKED one gets a second opening at its own FLOOR: the column above
     it keeps pushing after the pressures have equalised and the loop empties.
     Two edges rather than one moving node, because net.z is settled at build
     time and damage is live. */
  { const q = byId[roleId("core")];
    if(q){ const v = contNode("core:floor");
      breakIds.push(v);
      contZ[v] = zFace(q, "b");
      contCell[v] = [q.x+((q.w/2)|0), q.y+q.h-1];
      edges.push({u: coreNode, v, C: s => partWrecked(s, q.id) ? holeC(BREACH_BORE) : 0,
                  h: 0, kind: "break", key: "break:core"}); } }

  /* ══ AND A WRECKED HOLD TANK EMPTIES ITSELF THE SAME WAY ══
     Its water is the CIRCUIT's own, at an ordinary node of the field, so the
     only way out of it is an EDGE - a level it does not have and a book it is
     not allowed to keep. Destroyed, the stock pressurizer sat at 54 % with a
     hole in it for ever. At the vessel's own FLOOR, for the reason the core's
     second opening is: the column above keeps pushing after the pressures
     have equalised, which is what a torn-open vessel does. Every other tank
     keeps its own level and drains it in step(). */
  for(const id of holdTankIds()){
    const q = byId[id]; if(!q) continue;
    // a vessel nothing is plumbed to has no node, and this may not invent one
    if(index[id] === undefined) continue;
    const v = contNode("tank:"+id+":floor");
    breakIds.push(v);
    contZ[v] = zFace(q, "b");
    contCell[v] = [q.x+((q.w/2)|0), q.y+q.h-1];
    edges.push({u: nodeIdx(id), v, C: s => partWrecked(s, id) ? holeC(BREACH_BORE) : 0,
                h: 0, kind: "break", key: "break:"+id});
  }

  /* tankIdOf spans all three passes and is DERIVED off the drawing, so it is
     handed down rather than written a second time. */
  return {runs: net, byKey, byId, partOfNode, tankIdOf, nodes, index, coreNode, edges, F,
          breakIds, steamBreaks, contZ, contCell, fitIds, fitMode, openSide, fitVentOut,
          sgtrIds, sgtrParts, secTIds, secTParts};
}

/* ══ PASS TWO: EVERY ARRAY DERIVED OFF THEM ══
   Which tank catches which vent, the elevations, the holdup, the names, the
   condenser's anchors. Read-only over the edge list this is handed - the one
   thing it must not do is change it. */
function netMaps(ctx){
  const net = ctx.runs, byKey = ctx.byKey, byId = ctx.byId,
        partOfNode = ctx.partOfNode, tankIdOf = ctx.tankIdOf,
        nodes = ctx.nodes, index = ctx.index, coreNode = ctx.coreNode,
        edges = ctx.edges, contZ = ctx.contZ, contCell = ctx.contCell, breakIds = ctx.breakIds,
        steamBreaks = ctx.steamBreaks, fitIds = ctx.fitIds, fitMode = ctx.fitMode,
        openSide = ctx.openSide, fitVentOut = ctx.fitVentOut,
        sgtrIds = ctx.sgtrIds, sgtrParts = ctx.sgtrParts,
        secTIds = ctx.secTIds, secTParts = ctx.secTParts;

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
      if(netHole(ed)) continue;                                // never a hole: a break, a vent and a tube leak lead nowhere a discharge can be caught
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

  const net2 = {nodes, index, edges, core: coreNode, n: nodes.length, byKey, fitIds, fitMode, F: ctx.F,
                cont: breakIds, contCell, sec: sgtrIds, secT: secTIds, sgtrParts, secTParts, fitTarget, fitVentOut,
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
  net2.z = new Float64Array(net2.n);
  const unplaced = [];
  for(let i=0;i<net2.n;i++){
    const z = nodeZ(nodes[i]);
    if(z === null) unplaced.push(i); else net2.z[i] = z;
  }
  /* a containment node sits at the height of the opening it is on the far
     side of, so the break edge spans no column and discharges where it is.
     "break"/"sgtr"/"vent" here are SYNTHETIC edge kinds this function itself
     invents (a containment stub, a tube-rupture leak, a relief valve with
     nowhere else to vent) - never a run's own declared kind. */
  for(const ed of edges) if(netHole(ed)) net2.z[ed.v] = net2.z[ed.u];
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
     this exact test (pipeUnit) to meter a tank-bound run in inventory rather
     than mass, and it reads the name. It lives on the built
     network rather than on the tank's own config, because D.tanks rides
     designSig() and a per-frame writeback there would churn it. */
  net2.tankNid = {};
  net2.tankNode = {};
  /* the same map read the other way. netReadEdges() walks EDGES, not tanks,
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
  // index the other way: the advection sweep and the static head both address nodes
  // by NAME, because that is what survives a snapshot (snapVal(), record.js)
  net2.name = new Array(net2.n);
  for(const nid in index) net2.name[index[nid]] = nid;
  netFieldSize(net2.F, net2.n);
  net2.vol = new Float64Array(net2.n);
  { const nodesOfPart = net2.nodesOfPart = {};
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

  return net2;
}

/* ══ PASS THREE: MUTATE THE EDGES, THEN WALK THEM ══
   The condenser splice and the condensate gate CHANGE the edge list, and the
   contents, buoyancy and component passes all read it afterwards - so the
   order in here is load-bearing end to end. A spliced-out edge that survived
   into the component pass would merge two components. */
function netFinish(net2, ctx){
  const edges = net2.edges, index = ctx.index, fitIds = ctx.fitIds,
        fitMode = ctx.fitMode, secTIds = ctx.secTIds, secTParts = ctx.secTParts;

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
     answers to the pool: signed onto the condenser it belongs to, and gated by
     nothing - the pool's own node runs dry like any other. Applied to the ASSEMBLED edges rather than in the run loop, so
     a tapped segment or an internal path landing on that node is caught by the
     same line. Positive is OUT of the condenser, the tank convention. */
  for(const ed of edges){
    const cu = net2.condOutNode[ed.u], cv = net2.condOutNode[ed.v];
    if(cu === undefined && cv === undefined) continue;
    ed.condOf  = cu !== undefined ? cu : cv;
    ed.condOut = cu !== undefined ? 1 : -1;
    const c0 = ed.C;
    ed.C = c0;
  }

  /* WHICH NODES ARE FULL OF VAPOUR, and it is STRUCTURAL: a node every edge
     touching it reaches through vapour is a steam space. Nothing is named -
     place a fitting in the steam line and its two sides are steam spaces too,
     because a fitting declares BOTH its faces transparent and the runs either
     side of it are what answer. A node with no edge at all is not one.
     The DATUM COLUMN this used to decide is gone with the datum: what is left
     reading it is the vapour build and the renderer's own "is this run steam"
     question, both of which are asking the same structural thing. */
  net2.vapour = new Uint8Array(net2.n);
  { const any = new Uint8Array(net2.n);
    net2.vapour.fill(1);
    for(const ed of edges){
      /* A BREAK, A VENT AND A TUBE LEAK ARE HOLES, NOT CONTENTS. They hang off
         every run alike and say nothing about what is inside it, so a hole in
         the exhaust line must not make it read as full of water. */
      if(netHole(ed)) continue;
      any[ed.u]=1; any[ed.v]=1;
      // a run answers off its own LAW (edgeLaw); a path through a component
      // answers per FACE, off the row that declared it (vapU/vapV, above)
      const k = edgeLaw(ed) === LAW_VAPOUR;
      if(!(ed.vapU || k)) net2.vapour[ed.u]=0;
      if(!(ed.vapV || k)) net2.vapour[ed.v]=0;
    }
    // AND A HOLE'S OWN NODE IS FULL OF WHAT IT PIERCES: the loop above skips
    // break and vent edges, which leaves the hole's own node touched by nothing
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
     enthalpy (s.hBy) and the static head reads the density that enthalpy says.
     What is left is a direction and animation label - which side of the core
     a run leaves by - and that IS a property of the kind, so it stays keyed
     on one. Nothing in the heat balance may read it again. */
  net2.tag = new Uint8Array(net2.n);
  for(const ed of edges){
    const b = KIND_TEMP[ed.kind] || 0;
    if(b){ net2.tag[ed.u] |= b; net2.tag[ed.v] |= b; }
  }
  for(let i=0;i<net2.n;i++) if(net2.tag[i] === (NT_HOT|NT_COLD)) net2.tag[i] = 0;
  // per RUN KEY, for the animation's "is either end tagged" read (step.js)
  net2.tagByKey = {};
  for(const ed of edges) if(ed.key)
    net2.tagByKey[ed.key] = net2.tagByKey[ed.key] || net2.tag[ed.u] || net2.tag[ed.v];
  // the same map net.secT carries, read the other way - netReadEdges() walks
  // EDGES and needs the shell a node belongs to, not the node a shell has
  net2.secTById = {};
  for(let k=0;k<secTIds.length;k++) net2.secTById[secTIds[k]] = secTParts[k];

  /* Every edge's head gains its static term alongside whatever source pushed
     it. Done here, once, rather than at each push site: a column is a property
     of an edge's two ends, so writing it into the pump's own closure and the
     pipe's and the fitting's would be the same expression three times.
     A HOLE IS NOT EXEMPT ANY MORE and needs no exemption: netFinish()'s
     elevation pass puts every opening at its own run's height, so dz is 0 and
     staticH() returns 0 on its own. */
  for(const ed of edges){
    const src = ed.h;
    ed.h = typeof src === 'function' ? s => (src(s) + staticH(net2, ed))*HEAD_K
         : src ? s => (src + staticH(net2, ed))*HEAD_K
         : s => staticH(net2, ed)*HEAD_K;
  }
  /* ══ AND THE MOMENTUM RELATION IS APPLIED ONCE, HERE ══
     Every edge above states a flow COEFFICIENT and nothing else; this is where
     it becomes a conductance. AFTER the head loop, deliberately: g is
     linearised about the full driving differential and the static term is part
     of that, so an edge whose g was written at its push site would price
     itself in a frame with no column in it. An edge that states a bare g and
     no C keeps it - the vapour runs carry a SPEC and a deliberate 0. */
  for(const ed of edges) if(ed.C !== undefined) ed.g = s => edgeG(net2, ed, s);

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
/* THE PLANT'S OWN LEVEL, MPa - what a piece with no anchor of its own keeps,
   so a component nothing pins does not invent a zero. The solve is in ABSOLUTE
   pressure now, so this is the value itself and no longer a datum anything is
   measured from. */
const netLevel = s => (s.P === undefined ? P.P0 : s.P);   // a piece with no store at all; never an anchor
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

   A hold tank is LIVE when the live piece it stands in IS A CIRCUIT - the
   water in it has somewhere to go and come back from. "Reaches any free node"
   was not that: a free node in a DEAD LEG is a stub the vessel pressurises
   and nothing else, so shutting the surge port left the pressurizer reading
   live through its own relief line, which is the one branch that cannot hold
   a loop up. Measured on the stock ship: prt2 shut, live=true, and the
   programme went on running.

   A piece with a cycle in it is a piece flow can pass through; a tree hanging
   off the vessel is a dead end however long it is. Counted over the FREE
   nodes only - a boundary absorbs what it is given and propagates no pressure
   ("reached, never crossed") - and over distinct node PAIRS, or two runs
   between the same two faces would read as a loop.

   Costs one pass over the edge list. Called once a tick from step() and once
   per panel from tankP() - it walks conductances, it does not solve. */
/* ══ SOMEWHERE THE WATER CAN GO ══
   holdLive() and circSolid() both walk this and both mean the same thing by
   it: a place that will take water without the pressure there being the walk's
   own answer. That was the FIXED map alone, and it was the whole of the answer
   while every boundary was a fixed node. A node that STORES is one too - a
   generator's steam space, a tank with a gas charge behind it - and both of
   those stopped being fixed. Left out, the walk crosses an accumulator and
   reads a loop with one on it as a SEALED SOLID VOLUME, which is the one thing
   circSolid() exists to tell apart.
   WHICH nodes store is a STRUCTURAL question - a tank with a charge behind it
   (tankStores) and a generator's own steam space - and it is asked that way
   rather than off netStore(). Both readers only ever test `!== undefined`, so
   what goes in is a MARKER and never a pressure; and asking the store instead
   walks tankP() -> holdLive() -> netFixed() -> netRef() -> netPieces() ->
   netLiveSig() -> tankLive() -> tankP(), which is a stack overflow on tick
   one. */
function netBounds(net, s){
  const b = netFixed(net, s);
  for(const id in net.tankNode){ const i = net.tankNode[id];
    if(tankStores(id) && b[i] === undefined) b[i] = 0; }
  if(!netStoreHeld) for(const i of (net.secT||[])) if(b[i] === undefined) b[i] = 0;
  return b;
}
function holdLive(net, s, ci){
  const holds = holdOnCirc(ci);
  if(!holds.length) return true;                  // nothing on this circuit to disconnect
  const t = net.tankNode[holds[0]];
  if(t === undefined) return false;               // a vessel sitting there unplumbed
  /* MEMOISED ON WHAT THE WALK READS: the live edge set (netPieces, one object
     per signature) and the fixed SET, which beyond that signature only moves
     with a burst shell or the commissioning hold. Asked once per solve by
     every tank's own pressure, and the walk was the whole cost of tankP(). */
  const pc = netPieces(net, s);
  let bk = netStoreHeld ? 'H' : '';
  if(s && s.sgBurst) for(const k in s.sgBurst) if(s.sgBurst[k]) bk += '|' + k;
  if(net.hlPc !== pc || net.hlKey !== bk){ net.hlPc = pc; net.hlKey = bk; net.hl = {}; }
  const was = net.hl[ci];
  if(was !== undefined) return was;
  const fixed = netBounds(net, s);
  const adj = pc.adj, live = pc.live;
  // the seed is exempt from its own fixed test: a hold tank's node IS an anchor
  const seen = new Uint8Array(net.n), stack = [t];
  let nodes = 1; seen[t] = 1;
  while(stack.length){
    const a = adj[stack.pop()];
    if(a) for(let i=0;i<a.length;i++){ const v=a[i];
      if(seen[v] || fixed[v] !== undefined) continue;   // reached, never crossed
      seen[v] = 1; nodes++; stack.push(v); }
  }
  const pairs = new Set();
  for(let e=0;e<net.edges.length;e++){
    const ed = net.edges[e];
    if(!live[e] || !seen[ed.u] || !seen[ed.v] || ed.u === ed.v) continue;
    pairs.add(ed.u < ed.v ? ed.u+"|"+ed.v : ed.v+"|"+ed.u);
  }
  return (net.hl[ci] = pairs.size >= nodes);
}
const pzrLive = (net, s) => holdLive(net, s, nodeGraph().coreCirc);

/* ══ IS THIS CIRCUIT A SEALED SOLID VOLUME ══
   Liquid that cannot expand pushes on the wall instead. Shut every port on a
   hot loop and step() relaxed it toward containment, so a plant boiling itself
   dry sat at 0.15 MPa and the vessel could never burst.
   SOLID is: no hold tank holding a bubble in it (the caller has already asked
   holdLive), and the live piece the loop stands in reaches no FIXED node -
   nothing open, no tank, no condenser, no break. Walked FROM the loop's own
   node for holdLive()'s reason: a free node down a dead leg is not somewhere
   the water can actually go. */
const circSeed = (net, ci) => {
  for(let i=0;i<net.n;i++) if(net.compCirc[net.comp[i]] === ci) return i;
  return -1; };
function circSolid(net, s, ci){
  const holds = holdOnCirc(ci);
  const seed = ci === nodeGraph().coreCirc ? net.coreNode
             : holds.length ? net.tankNode[holds[0]] : circSeed(net, ci);
  if(seed === undefined || seed === null || seed < 0) return false;
  /* AN ANCHOR IS A REFERENCE, NOT A BOUNDARY. netFixed() pins one node per
     piece at exactly 0 to give the frame a level, and a sealed loop's own
     anchor is its own node - counting that as somewhere the water can go said
     every sealed loop was open. Only a real boundary counts: containment, a
     tank, a shell, the condenser. */
  const fixed = netBounds(net, s), ref = net.refNow;
  const bound = i => fixed[i] !== undefined && ref.anchor[ref.of[i]] !== i;
  if(bound(seed)) return false;
  const adj = netPieces(net, s).adj;
  const seen = new Uint8Array(net.n), st = [seed];
  seen[seed] = 1;
  while(st.length){
    const a = adj[st.pop()];
    if(a) for(let i=0;i<a.length;i++){ const v = a[i];
      if(bound(v)) return false;
      if(seen[v]) continue;
      seen[v] = 1; st.push(v); }
  }
  return true;
}
/* ══ ONE REFERENCE FRAME PER COMPONENT ══
   netLevel() is the plant's own level, which a component with no anchor of its
   own keeps rather than inventing a zero. p0[c] is the pressure the anchor is
   fixed AT; anchor[c] is that node, or -1 where the component has none. */
/* ══ THE ANCHOR RULE, AS ONE PREDICATE ══
   A component is anchored at the lowest-index node in it that is a LIVE hold
   tank's node; failing that at net.pzrNode if it is that node's component;
   failing that at nothing, which needs no code at all - netFactor()'s pivot
   guard decouples an unanchored component and net.Afdeg deletes its nodes
   from byP.
   TWO HOLD TANKS ON ONE COMPONENT: the lowest node wins and the rest are
   demoted to ordinary tanks. Letting both anchor fixes two nodes at the same
   pressure and different elevations, which is a manufactured thermosiphon. */
/* ══ THE FRAME IS THE LIVE PIECE, NOT THE STRUCTURAL COMPONENT ══
   A component is drawn once and never moves, which made a shut valve invisible
   to the reference frame: an ISOLATED pressurizer went on being anchored at the
   loop's own pressure, so a sealed reactor climbing to burst pushed its own
   relief valve open through a port that was shut and vented into the relief
   tank. Pieces are components over the LIVE edges, so isolation splits the
   frame and each side carries what actually holds it up.
   It cannot make a value JUMP, which is what kept this structural before: a
   hold tank's own pressure tracks its loop for as long as it is live
   (holdPOf), so the tick a valve shuts the two frames are equal and only then
   diverge. */
/* CACHED ON THE LIVE SIGNATURE the factorisation already builds: netFixed()
   asks netRef() which asks this, and partOnCoreLoop() asks it once per
   generator, so an uncached walk was several passes over the whole edge list
   per tick for an answer that only moves when a gate does. */
function netPieces(net, s){
  if(net.pc && net.pcSig === netLiveSig(net, s)) return net.pc;
  const of = new Int32Array(net.n).fill(-1);
  const adj = new Array(net.n), live = new Uint8Array(net.edges.length);
  for(let e=0;e<net.edges.length;e++){
    const ed = net.edges[e];
    const g = typeof ed.g === 'function' ? ed.g(s) : ed.g;
    if(!(g > 0)) continue;
    live[e] = 1;
    (adj[ed.u] || (adj[ed.u] = [])).push(ed.v);
    (adj[ed.v] || (adj[ed.v] = [])).push(ed.u);
  }
  let c = 0;
  for(let i=0;i<net.n;i++){
    if(of[i] >= 0) continue;
    const st = [i]; of[i] = c;
    while(st.length){ const a = adj[st.pop()];
      if(a) for(let k=0;k<a.length;k++){ const v = a[k];
        if(of[v] < 0){ of[v] = c; st.push(v); } } }
    c++;
  }
  net.pcSig = netLiveSig(net, s);
  return (net.pc = {of, n: c, adj, live});
}
/* WHICH LIVE PIECE A NODE IS IN, by node NAME or index - the one reader
   everything outside this file goes through. -1 for a node this plant has
   not got. */
function pieceOf(net, s, node){
  const i = typeof node === "number" ? node : net.index[node];
  return i === undefined ? -1 : netPieces(net, s).of[i];
}
/* THE PIECE THE CORE IS IN, which is what "still plumbed to the primary"
   means for every gate below. */
const corePiece = (net, s) => netPieces(net, s).of[net.coreNode];
/* IS THIS MACHINE STILL PLUMBED TO THE CORE, over LIVE edges. A generator
   behind a shut port went on cooling the loop at the stagnant-flow floor, so a
   sealed reactor lost more heat than it made - the same mistake the relief
   valve made about pressure, in the heat balance. */
function partOnCoreLoop(net, s, id){
  const list = net.nodesOfPart && net.nodesOfPart[id];
  if(!list || !list.length) return false;
  const pc = netPieces(net, s), c = pc.of[net.coreNode];
  for(let k=0;k<list.length;k++) if(pc.of[list[k]] === c) return true;
  return false;
}
/* WHAT A HOLD TANK IS HOLDING, which is its LOOP's pressure while it is live
   and its own the moment it is not. step() writes it; anything asked before
   the first tick falls back to the loop it is drawn on. */
const holdPOf = (s, id) => (s.holdPBy && s.holdPBy[id] != null)
  ? s.holdPBy[id] : loopP(s, tankCircuit(id));
/* ══ NOBODY IS TOLD THE PRESSURE ANY MORE ══
   A hold tank used to be its component's ANCHOR - a fixed node at s.P, which
   was a scalar step() integrated beside the field. That made the pressurizer
   the one place in the plant whose pressure was not solved, and it was a third
   state on a control volume that has room for two: drained, the stock core sat
   at 3.26 MPa on a loop open to containment, because the scalar could not see
   the water had gone. A pressurizer is a VESSEL WITH A BUBBLE IN IT now - an
   ordinary storing node whose contents are two-phase, so its pressure is the
   saturation pressure of what is in it and the heaters and the spray are heat
   (pzrQ(), step.js). What is left here is the piece FRAME: a piece with no
   store at all has nothing to stand on and keeps the plant's own level.  */
function netRef(net, s){
  const g = netLevel(s);
  const piece = netPieces(net, s);
  const p0 = new Float64Array(piece.n).fill(g);
  const anchor = new Int32Array(piece.n).fill(-1);
  return {p0, anchor, of: piece.of, nPiece: piece.n};
}
/* ══ WHERE A NODE STANDS, AND SO WHAT IT LETS GO TO ══
   P.Pcont was one unconditional constant for the whole ship, so a break inside
   a containment and the same break outside it were the same accident. It is
   the ship's own compartment pressure now and nothing more; regionP()
   (paint.js) is what a place is actually held at. A containment node already
   knew its cell (net.contCell) and every other node stands in a machine. */
const netCellOf = (net, i) => {
  const c = net.contCell && net.contCell[i];
  if(c) return c;
  const p = net.partOfNode && net.partOfNode(net.name[i]);
  return p ? [p.x+((p.w/2)|0), p.y+((p.h/2)|0)] : null;
};
const netPcont = (net, s, i) => { const c = netCellOf(net, i);
  return c ? regionP(s, c[0], c[1]) : P.Pcont; };
function netFixed(net, s){
  const ref = netRef(net, s);
  const f = {};
  net.refNow = ref;
  /* EVERY VALUE HERE IS AN ABSOLUTE PRESSURE, at the node it belongs to. The
     datum column that used to be added to each one is gone with the single
     density that made it computable - the column now rides the EDGES, at each
     edge's own two densities (staticH()). */
  /* EVERY COMPONENT'S ANCHOR, at its own setpoint. */
  for(let c=0;c<ref.nPiece;c++) if(ref.anchor[c] >= 0) f[ref.anchor[c]] = ref.p0[c];
  /* CONTAINMENT, one node per opening, always fixed and usually attached to
     nothing: its edge's g is 0 until that break happens, so netAssemble skips
     the edge and the node contributes exactly nothing. Keeping the SET
     constant rather than adding a node when a break opens is what lets the
     factorisation cache key on the break's own live state (s.dmgParts and
     s.breach, netFactored below) instead of on a set that changes shape - and
     a break still busts that cache, which is the thing that matters: a fresh
     break solved against the intact plant's factors is a wrong answer, not a
     crash. */
  for(const i of net.cont) f[i] = netPcont(net, s, i);
  /* ══ AND WHILE THE STORE IS HELD, THE VESSEL IS THE REFERENCE ══
     The commissioning settle is not a time march, so every store stands down
     (netHoldStore) - and a pressurizer IS its own store now, so with nothing
     pinned the primary had no reference at all and the settle solved a
     floating piece: the stock plant commissioned at 0.23 MPa with its core
     boiling. Pinned at its own setpoint for the length of the walk, exactly
     as a generator's steam space already is two lines below, and free again
     the moment the walk returns. */
  if(netStoreHeld) for(const id of holdTankIds()){ const i = net.tankNode[id];
    if(i !== undefined) f[i] = holdPOf(s, id); }
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
    if(tankStores(id)) continue;              // it gives way instead (netStore)
    f[i] = tankP(s,id); }
  /* ══ THE POOL IS A BOUNDARY; THE STEAM SPACE IS AN ANSWER ══
     A generator's shell is TWO nodes. `sec:<id>` is the water at the bottom of
     it - where the feed train lands and where the tubes leak - and it is FIXED
     at the shell's own pressure, one tick old, exactly as tankP() and condP()
     already are. A pool of water has no compliance worth a matrix row, and it
     has to stay a boundary besides: holdLive() and circSolid() read this map
     to mean "somewhere the water can go", and a shell that stopped being one
     would read a sealed loop as open.
     The generator's own steam port is FREE, and its diagonal is the whole of
     the shell's compliance (netStore, below). What used to be an integral in
     step() is that node's own KCL row.
     A BURST SHELL IS AN OPENING and holds nothing: it is pinned at the room's
     pressure, which is what secP() already answers for it. */
  net.sec.forEach((i,k)=>{ f[i] = secP(s, net.sgtrParts[k]); });
  net.secT.forEach((i,k)=>{ const id = net.secTParts[k];
    if(netStoreHeld) f[i] = secP(s, id);
    else if(sgOpen(s,id)) f[i] = netPcont(net, s, i); });
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
    for(const k in net.condNode){ const i = net.condNode[k]; f[i] = pc; } }
  return f;
}
/* ══ WHAT A NODE CAN HOLD ══
   simTick() steps a literal 0.02, and a compliance is per SECOND: this is that
   literal, named, because a storage term is the one place in the network that
   has to know how long a tick is.
   Returns the diagonal storage conductance per node (kg/s per MPa) and the
   right-hand side that goes with it - C/dt*p_prev, plus every kilogram that
   arrives at or leaves that node WITHOUT crossing an edge of this graph.
   For a generator's steam space those are: the feedwater the shell's own
   internal edge delivered, which goes into the WATER and not into the steam
   above it, so it is taken straight back out; what boiled, which is the whole
   of what pressurises a drum; what the steam line carried away (the vapour
   solve); and what the safety valves blew. All one tick old, the same
   feed-forward s.cavP and s.sgShare already carry - the flows this solve
   produces cannot also be inputs to it. */
/* ══ WHAT A NODE CAN HOLD ══
   simTick() steps a literal 0.02, and a compliance is per SECOND: this is that
   literal, named, because a storage term is the one place in the network that
   has to know how long a tick is.

   Today the only storing node is a generator's own steam space. Its diagonal
   is the shell's WHOLE compliance in kg per MPa - the steam space filling up
   AND the water and the steel following saturation, which is the same
   `sgHeatCap*dTdp/hfg` A6 carried on the bottom of its own dp/dt - and its
   injected current is the heat crossing the tubes turned into kilograms of
   boil. The pressure that used to be integrated in step() is that node's own
   KCL row now.

   THE HEAT TERMS ARE ONE TICK OLD, which is the same lag s.coreDT and
   s.pumpQBy already carry, and it is safe HERE and was not safe on the feed:
   the feedwater lands on the POOL, which is a boundary, so nothing in this
   row is a flow this solve also decides. */
const NET_DT = 0.02;
/* ══ AND A REST POINT IS WHERE THE STORE DOES NOTHING ══
   The commissioning walk (step.js) is looking for the pressure at which each
   shell passes what it raises. That is the QUASI-STATIC answer, so while it
   walks, every shell is held at the pressure it is trying and no shell stores:
   iterating the store instead converges at one part in C/(g*dt) a pass. Off
   again the moment the walk returns. */
/* AND IT STANDS DOWN THE WHOLE STORE, not the shells alone, because the same
   sentence is true of every node's own compliance: the reference solve is a
   GEOMETRIC figure and a store prices how fast a vessel gives way. Its p_prev
   is the DRAWN plant's field besides, so left on it would push the reference
   toward a state that is not the reference's own answer. */
let netStoreHeld = false;
const netHoldStore = on => { netStoreHeld = !!on; };
/* ══ WHAT A KILOGRAM OF THIS CIRCUIT GIVES WAY BY, per MPa ══
   No new constant: COOLANT[].solidK is beta over kappa in MPa/K and BETA_W is
   beta, so kappa is one divided by the other. Pressurised water reads
   0.0025/1.4 = 1.79e-3 per MPa, the right order for 583 K. It has only ever
   been read the other way up. A circuit that is not the core's is water, which
   is what satOfCirc() already says. */
/* AND A NODE WITH STEAM IN IT IS EIGHTY TIMES SOFTER. An ideal gas's own
   isothermal compressibility is exactly 1/p - no constant, no fit - so a
   steam space at 6.8 MPa reads 0.147 per MPa against water's 0.0018, and a
   two-phase node is the mass-weighted mixture of the two. That is the plan's
   "a two-phase volume is a nearly constant-pressure buffer" written down: it
   is not ill-conditioned, it is the opposite, and the stiffness is on the
   diagonal either way. */
const SOLID_K_W = COOLANT[0].solidK;
const netKapF = ci => BETA_W/Math.max(1e-6,
  (ci===nodeGraph().coreCirc && typeof P!=="undefined" && P && P.solidK) ? P.solidK : SOLID_K_W);
const netKappa = (nid, p, x) => { const q = clamp(x, 0, 1);
  return q/Math.max(p, COND_P0) + (1-q)*netKapF(circOfNode(nid)); };
/* ══ THE PRESSURE THIS NODE'S CONTENTS ARE ACTUALLY AT ══
   rho(p, h) is monotone increasing in p on all three branches - a liquid
   compresses, a shelf condenses as saturation rises past its enthalpy, a gas
   is p/RT - so "what pressure holds m kilogrammes in V cubic metres at this
   enthalpy" has exactly one answer and this finds it. Newton off the curve's
   own slope with a bisection safeguard, and the common case costs one curve
   read: a node already at its state point returns immediately.
   IT IS THE STATE, NOT A CORRECTION. Linearising the store about last tick's
   SOLVED pressure instead put the mismatch in as a source term, and across the
   saturation line that is a divergent iteration - a cut hot leg walked the
   core 11.7, 7.6, 15.0, 3.6, 35.9 MPa in five ticks and burst the vessel,
   because the node flashes at one end of the step and is liquid at the other.
   About p* there is no source term at all: the row says a node is driven
   toward its own state point at the rate its own compliance allows. */
const NET_PMAX = 200;   // a node holding more than any pressure can account for is pinned, not solved
function netPStar(c, p0, h, rhoT){
  /* AND AN EMPTY NODE IS AT THE VACUUM, not at whatever it was last solved at.
     Handing back p0 for nothing at all left a drained loop holding the
     pressure it drained from: the stock plant's own core, empty, walked back
     up to 5 MPa on decay heat and split its remaining pipework. */
  if(!isFinite(rhoT) || rhoT <= 0) return COND_P0;
  let p = clamp(p0, COND_P0, NET_PMAX), lo = COND_P0, hi = NET_PMAX;
  for(let k=0;k<40;k++){
    const r = rhoMixOf(c, p, h);
    if(Math.abs(r - rhoT) <= 1e-6*rhoT) return p;
    if(r < rhoT) lo = p; else hi = p;
    const d = DRHO_DP(c, p, h);
    const nxt = d > 0 ? p - (r - rhoT)/d : (lo + hi)/2;
    p = (nxt > lo && nxt < hi) ? nxt : (lo + hi)/2;
  }
  return p;
}
function netStore(net, s){
  const cap = new Float64Array(net.n), src = new Float64Array(net.n),
        pin = new Uint8Array(net.n);
  let any = false;
  /* ══ AND EVERY NODE STORES, BECAUSE MASS IS THE STATE ══
     A control volume has TWO independent states and this plant keeps three -
     m, h and p - so the third was free to disagree with the other two, and it
     did: measured on a cut hot leg, the core held 624 kg/m3 while its own (p,
     h) insisted it was 27 % steam at 63. The row is what closes it. The
     residual is the EQUATION OF STATE, not the last pressure: what flows in
     over a tick is what this node must gain to hold what (p, h) says it holds,
     so a node carrying more than its state point pushes the difference back
     out and a node carrying less pulls it in. mEos is the target, C = V*drho/dp
     = mEos*kappa the slope, and the two together are one Newton step onto the
     curve - taken THROUGH the matrix, so a node with pipes on it sheds the
     difference as flow and only a sealed one pays for it in pressure.
     It used to be m*kappa*(p - p_prev) with m the STORED mass, which assumes
     the node is already at its state point: an error had no way back, and it
     fed itself - a relief pocket priced its 1 665 kg of water at steam's own
     compressibility, went soft, and swallowed 22 000 kg/s at constant
     pressure for ever. FIRST, so the two classes below - a charge law and a
     steam space - overwrite it with their own exact term. */
  for(let i=0;netStoreHeld?0:i<net.n;i++){
    const nid = net.name[i];
    /* FLOORED AT THE RUN-DRY LINE. A spent node with no diagonal at all is a
       degenerate row: netReadP() drops it, netPAt() then hands its readers the
       REACTOR's own setpoint, and a turbine exhaust reading 15.5 MPa reverses
       the edge that would have refilled it - dry for ever, on a plant that has
       a turbine running into it. A node that is spent still has a pressure. */
    const mEos = Math.max(net.vol[i]*net.F.rho[i], DRY_MIN_KG);
    const m = (s && s.mBy && s.mBy[nid] !== undefined) ? s.mBy[nid] : mEos;
    const V = net.vol[i], c = netSatOf(nid), hN = netHAt(s, nid);
    const p0 = V > 0 ? netPStar(c, net.F.p[i], hN, m/V) : net.F.p[i];
    /* THE SLOPE IS THE CURVE'S OWN (DRHO_DP), at the state point, floored at
       the stiffest thing there is - a cold liquid - so a branch the curve
       reads flat still has a row to stand on. netKappa() is that floor and
       nothing else now. */
    const C = Math.max(V*DRHO_DP(c, p0, hN), mEos*netKappa(nid, p0, net.F.x[i]));
    if(!(C > 0) || !isFinite(C) || !isFinite(p0) || !isFinite(m)) continue;
    cap[i] = C/NET_DT; src[i] = C/NET_DT*p0;
    any = true;
  }
  /* AND A HOLD TANK'S BUBBLE IS A REAL VESSEL. Its row is the generic one
     above - the bubble's own compliance, off its own mass and enthalpy - but
     it PINS, because a pressurizer is exactly what "something on this circuit
     decides its pressure" means. */
  for(const id in net.tankNode) if(D.tanks[id] && D.tanks[id].hold && !netStoreHeld){
    const i = net.tankNode[id]; if(cap[i] > 0) pin[i] = 1; }
  /* EVERY TANK WITH A CHARGE BEHIND IT (tankCapAt, above). Its own p_prev is
     tankP(), which is a function of a LEVEL the tick integrates from the
     solved flow - so the state is still the inventory and the pressure still
     follows the charge law; what the row adds is how fast the vessel can be
     made to give it up. */
  for(const id in net.tankNode){
    const i = net.tankNode[id], C = tankCapAt(s, id);
    if(!(C > 0) || !isFinite(C)) continue;          // before tankP(): a hold tank's is a graph walk
    const p0 = tankP(s, id);
    if(!isFinite(p0)) continue;
    cap[i] = C/NET_DT; src[i] = C/NET_DT*p0; pin[i] = 1;
    any = true;
  }
  // netStoreHeld leaves the TANKS alone: one that stopped storing without
  // netFixed() pinning it again would be a free node with no anchor at all,
  // which is a piece that floats.
  for(let k=0;netStoreHeld?0:k<(net.secT||[]).length;k++){
    const i = net.secT[k], id = net.secTParts[k];
    if(sgOpen(s,id)) continue;                  // an opening, and netFixed pins it
    const C = shellStoreC(s, id), w = shellStoreW(s, id), p0 = secP(s, id);
    // A NaN ON THE DIAGONAL TAKES THE WHOLE COMPONENT WITH IT, silently: the
    // elimination is block-diagonal, so one bad row zeroes every flow on that
    // circuit and leaves the rest of the plant reading fine.
    if(!(C > 0) || !isFinite(C) || !isFinite(w) || !isFinite(p0)) continue;
    cap[i] = C/NET_DT;
    src[i] = C/NET_DT*p0 + w;
    pin[i] = 1;
    any = true;
  }
  return any ? {cap, src, pin} : null;
}
/* WHICH nodes are fixed, never what they hold. A fixed node's VALUE only ever
   reaches b, so it may move every tick for free; whether a node is fixed at
   all changes the MATRIX, so it has to bust the factorisation cache. */
const netFixSig = fixed => Object.keys(fixed).join(',');
// the same string, joined only when the SET moved: a per-node mask compare is exact and does not allocate
function netFixSetSig(net, fixed){
  const n = net.n, m = net.fixMaskNow || (net.fixMaskNow = new Uint8Array(n));
  let same = !!net.fixMask;
  for(let i=0;i<n;i++){ const b = fixed[i] === undefined ? 0 : 1;
    m[i] = b; if(same && net.fixMask[i] !== b) same = false; }
  if(same) return net.fixMaskSig;
  net.fixMask = m.slice(); net.fixMaskSig = netFixSig(fixed);
  return net.fixMaskSig;
}

/* Factors A once per DISTINCT combination of fitting state and caches it
   there. The cache key is a signature of every fitting's live state, not the
   net instance alone: a relief valve's own edge is gated on live
   S.reliefOpen, and a throttle's a live function of S.valve (see netBuild()),
   so A itself can change tick to tick, and a factorisation left over from before a fitting moved would
   be a silent wrong answer, not a crash - the signature is checked on every
   call rather than trusted once. A throttle's position is continuous, so its
   own term is the exact value rather than a '0'/'1' flag: ANY change to it
   has to bust the cache, not just crossing some open/shut line. */
/* ══ ONE LIVE SIGNATURE, READ BY BOTH THE FACTORISATION AND THE PIECES ══
   Every conductance the edge list evaluates against S, as one string. The
   factorisation adds the fixed SET to it; netPieces() cannot, because the
   fixed set is built downstream of the pieces themselves. */
// the two STRUCTURAL lists the signature walks, once per net: which tanks have a node, which pumps are standby trains
const netSigLists = net => net.sigLists || (net.sigLists = {
  tanks: tankIds().filter(id => net.tankNode[id] !== undefined),
  pumps: pumpIds().filter(pumpStandby) });
function netLiveSig(net, s){
  // netSolve() reads s and never writes it, so inside one solve the string is built once (net.sigLock)
  if(net.sigLock === s && net.sigLockV !== null) return net.sigLockV;
  const v = netLiveSigOf(net, s);
  if(net.sigLock === s) net.sigLockV = v;
  return v;
}
function netLiveSigOf(net, s){
  const L = netSigLists(net);
  let tk = '', pm = '';
  for(let i=0;i<L.tanks.length;i++) tk += tankLive(s, L.tanks[i]) ? '1' : '0';
  for(let i=0;i<L.pumps.length;i++) pm += pumpFwd(s, L.pumps[i]) ? '1' : '0';
  return net.fitIds.map(fid => {
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
  + '|' + tk
  /* The per-tank "is there anything IN it" bits and the hotwell's own bit are
     gone with endGive() and condLive(): a tank node and a condenser node are
     nodes, and the run-dry hash below carries every node alike. */
  /* EVERY NODE'S OWN run-dry bit, because a dry donor takes its edge out of A
     (flowG) exactly as a shut valve does. A HASH, never n characters of join:
     this signature is rebuilt on every netPieces() memo check, several times a
     tick, over a few hundred nodes. */
  + '|' + netDrySig(net, s)
  // and every standby train's own discharge check - one bit each, and a plant
  // with no standby pump adds none
  + '|' + pm
  /* ...AND THE GOVERNOR, because the turbine's own path is an edge of this
     graph now and its C is a live gate: trip the machine with the dump shut
     and that edge is ABSENT, which splits the steam side into two pieces, and
     netPieces() memoises on this string.
     THE THREE FLAGS THAT CAN ZERO IT, never turbCOf() itself: the gate reads
     dumpOf(), which reads sgBypBand() and secP(), which reach holdLive() and
     back into netFixed() -> netRef() -> netPieces() -> here. Asking the gate
     was a stack overflow on the first tick. These are cheap, they cannot
     re-enter, and they are CONSERVATIVE - a trip that the dump keeps open
     busts the walk for nothing, which costs a re-walk and never an answer. */
  + '|' + (s.turbTrip?'T':'') + (s.condLost?'C':'') + (s.load>0?'L':'');
}

function netFactored(net, s, fixed){
  const sig = 'F' + (net.F.gen||0) + '|' + netLiveSig(net, s)
  /* the fixed SET is the fourth live input to A. A break appearing puts a
     second known pressure into the matrix, not just into b, so reusing last
     tick's factors would solve the broken plant against the intact one's -
     a wrong answer, not a crash. */
  + '|' + netFixSetSig(net, fixed);
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
      netAssemble(net.edges, net.n, fixed, s, null, null, null, row, nf, null,
                  net.store && net.store.cap).A, nf, degC);
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
   several edges, and so do the several cells of one severed run - both SUM,
   because last-write-wins made a run with two holes in it read whichever hole
   the edge list reached second and a series run read one segment of itself.
   The bag is cleared per solve for that reason: the commissioning settle
   hands the same object back three hundred times. */
/* ══ AND NOTHING MAY APPEAR AT A NODE NOBODY SOLVED FOR ══
   A FREE node's incident flows sum to zero by construction, so a residue there
   is an assembly bug and nothing else - an edge written into the matrix at one
   pair of nodes and evaluated at another. A FIXED node's imbalance IS the
   boundary flow and is meant to be non-zero, so it is not asked about here.
   ONLY WHEN THE TOPOLOGY MOVES: netFactored() rebuilds on net.AfSig, and
   between two rebuilds the guarantee cannot lapse - an O(E) pass every tick
   would be felt at MAX and would buy nothing. A DEV INVARIANT: it warns. */
const DIV_KG = 1e-6;      // kg/s - a milligram a second, below anything real
let divSig = null;
/* ══ AND A STORING NODE IS CHECKED AGAINST WHAT IT TOOK IN ══
   Skipping one was right while two node classes stored. Every free node stores
   now, so the skip would take the whole guard dark without a word: the residue
   is compared against that node's own row, cap*p - src, which is the mass rate
   the compliance accepted this tick and covers the shell's own heat term (w)
   for free. */
function netDiverge(net, q, fixed, store, b){
  if(net.AfSig === divSig) return;
  divSig = net.AfSig;
  const d = new Float64Array(net.n);
  let qmax = 0;
  for(let e=0;e<net.edges.length;e++){ const ed=net.edges[e], f=q[e];
    d[ed.u] -= f; d[ed.v] += f;
    const a=Math.abs(f); if(a>qmax) qmax=a; }
  const acc = new Float64Array(net.n);
  if(store) for(let i=0;i<net.n;i++){ if(!(store.cap[i] > 0)) continue;
    acc[i] = store.cap[i]*b[i] - store.src[i];
    const a=Math.abs(acc[i]); if(a>qmax) qmax=a; }
  if(!(qmax>0)) return;
  /* AND THE FLOOR IS A REAL QUANTITY. Against 1e-6 of qmax alone, a rig with
     nothing flowing has a qmax of 1e-15 and this compared rounding to
     rounding - netLoop, netStar and netChain all printed. A milligram a second
     is below anything this plant can mean, and it is a floor the solve can
     only have now that it answers in kilograms. */
  const tol = Math.max(1e-6*qmax, DIV_KG);
  for(let i=0;i<net.n;i++){
    if(fixed[i] !== undefined) continue;
    if(net.Afdeg && net.Afdeg[i]) continue;     // no path to ground: no answer to check
    const r = d[i] - acc[i];
    if(Math.abs(r) > tol)
      console.warn("[divergence] "+net.nodes[i]+" "+r.toExponential(2)
        +" of "+qmax.toExponential(2));
  }
}
/* ══════════ SOLVING AND READING ARE TWO JOBS ══════════
   netSolve() does the linear algebra and NOTHING else: fix, factor, assemble,
   substitute, un-fix, and the flows that follow. It hands back one object -
   the field, the per-edge flow, which nodes an edge that conducts reached, the
   fixed map and the reference frame this solve was taken in - and every
   readout in this file is a pure function of that object.

   The frame is carried on the answer rather than left on `net.refNow`,
   because netFixed() overwrites that on the next solve: a reader holding a
   solve from before it would silently price the field in somebody else's
   frame. Nothing else about netSolve is cached - a tick mutates s between
   solves on purpose (the feed valve bisection, step.js), so an s-identity
   cache would hand the second round the first round's answer. */
function netSolve(net, s, keepField){
  /* THE LAW IS LINEARISED ABOUT LAST TICK'S FIELD, so the field is refreshed
     here and nowhere else - every conductance in the assembly and every flow
     read back off it then price against ONE state of the plant. keepField is
     the nat-circ re-solve (netFlowK): same s, pumps stopped in the HEAD only,
     so the field, the store and the factorisation are all still the answer. */
  net.sigLock = s; net.sigLockV = null;
  try {
  if(!keepField) netFieldUpdate(net, s);
  const fixed = netFixed(net, s);
  netFactored(net, s, fixed);
  const b = new Float64Array(net.n);
  /* which nodes an edge that conducts actually reached this pass - the byP
     reader needs it to tell a fixed node that is PINNING something from
     one hanging off a shut break, and the conductances are evaluated here. */
  const touch = new Uint8Array(net.n);
  netAssemble(net.edges, net.n, fixed, s, false, b, net.store && net.store.src,
              null, null, touch);
  netSubstFree(net, b);
  netUnfix(b, fixed);
  const q = new Float64Array(net.edges.length);
  netFlows(net.edges, b, fixed, q, s);
  netDiverge(net, q, fixed, net.store, b);
  return {net, s, b, q, fixed, touch, ref: net.refNow, store: net.store};
  } finally { net.sigLock = null; net.sigLockV = null; }
}

  /* THE FIELD IS ALREADY PRESSURE, so there is nothing to take back off: the
     datum column died with the single density that made one computable, and a
     steam line no longer needs an exception to keep a water column off it.
     ONE thing this must not print: A NODE WITH NO PATH TO GROUND HAS NO
     PRESSURE. netFactor()'s pivot guard decoupled it and handed back whatever
     b left there; printing that is the "large, plausible-looking wrong number"
     this file already refuses elsewhere. Shut a valve in the steam line and
     the turbine inlet is exactly that node. Fixed nodes are never dropped -
     netUnfix() has just written their known value over b, so a trivially
     degenerate row there is not a missing answer, it is the answer. */
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
function netReadP(sol, byP){
  if(!byP) return;
  const net = sol.net, s = sol.s, b = sol.b, fixed = sol.fixed, touch = sol.touch, ref = sol.ref;
  { const deg = net.Afdeg;
    const lo = new Float64Array(ref.nPiece).fill(Infinity);
    const free = new Uint8Array(ref.nPiece).fill(1);
    const store = sol.store;
    for(let i=0;i<net.n;i++){ const c = ref.of[i];
      if(fixed[i]!==undefined){ if(touch[i]) free[c]=0; continue; }
      if(deg && deg[i]) continue;
      /* A NODE THAT STORES PINS ITS OWN PIECE. Its row carries C/dt*p*, and p*
         is what that node's own mass and enthalpy are AT (netPStar) - an
         absolute pressure, so there is nothing to float. It was store.pin
         alone, the tanks and the steam spaces, because the row used to be
         linearised about the last SOLVED pressure and cap would then have
         pinned every piece at whatever s.pBy happened to hold. That is no
         longer what the row says. Reading cap is what lets the pressurizer
         stop being a fixed node: it is a vessel with a bubble in it, and the
         bubble is where the plant's pressure comes from. */
      if(store && store.pin[i]) free[c] = 0;
      if(b[i] < lo[c]) lo[c] = b[i]; }
    for(let i=0;i<net.n;i++){
      if(deg && deg[i] && fixed[i]===undefined){ delete byP[net.nodes[i]]; continue; }
      const c = ref.of[i];
      /* A PIECE NOTHING PINS IS FLOATED so its lowest node sits at the pressure
         the ship holds - the expansion tank open to the compartment every
         closed cooling loop has. A shift cancels out of every flow, so nothing
         solved moves; only the absolute level, which had no answer before. */
      const off = (free[c] && fixed[i]===undefined && isFinite(lo[c])) ? netPcont(net, s, i) - lo[c] : 0;
      byP[net.nodes[i]] = b[i] + off;
    } }
}

/* What a solved network flow costs the loop, in % of inventory per second.
   The one place a flow becomes a percentage, so a break, an injection and a
   vent are all charged against s.inv through the same conversion instead of
   three unrelated rates. */
/* WHAT EVERY EDGE OF THIS SOLVE CARRIED - the drops, the per-run and per-loop
   flows, the spills, the tank and condensate books, and the core's own
   circulation, which is the return value. Pure over a netSolve() answer: it
   reads the field and the flows and writes only into the bags it was handed. */
function netReadEdges(sol, byLoop, byRun, byDrop, outs){
  const net = sol.net, s = sol.s, b = sol.b, q = sol.q, fixed = sol.fixed, ref = sol.ref;
  if(byRun) for(const k in byRun) delete byRun[k];
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
  for(let c=0;c<ref.nPiece;c++) if(ref.anchor[c] >= 0) isAnchor[ref.anchor[c]] = 1;
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
    if(byRun && ed.key) byRun[ed.key] = (byRun[ed.key]||0) + q[e];
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
    /* ══ WHAT EACH SHELL'S STEAM NOZZLE PASSED ══
       The sum over that node's own edges, SIGNED out of the shell - the same
       sentence qTankBy makes about a tank, asked of the steam space. Negative
       is steam ARRIVING from a hotter machine down a shared header, which is
       real and is the whole reason a header equalises. A second matrix
       answered this; there is one graph now. */
    if(outs && net.secTById){
      const su = net.secTById[ed.u], sv = net.secTById[ed.v];
      if(su !== undefined || sv !== undefined){
        const by = outs.sgSteamOutBy || (outs.sgSteamOutBy = {});
        const sid = su !== undefined ? su : sv;
        by[sid] = (by[sid]||0) + (su !== undefined ? q[e] : -q[e]);
      }
    }
    /* ══ AND WHAT CROSSED THE WHEELS ══
       One edge, two gates, and only one of them does work: turbCOf() is the
       governor and the bypass added together and turbWorkFrac() is the share
       that is the wheels. The INLET pressure is weighted by what actually
       went through, so two machines on one header give the enthalpy drop the
       pressure the work was really done at. */
    if(outs && ed.work){
      const fr = turbWorkFrac(s, ed.machine);
      if(fr > 0){ const w = q[e]*fr;
        outs.turbWk = (outs.turbWk||0) + w;
        outs.turbWkP = (outs.turbWkP||0) + b[ed.u]*Math.abs(w);
        outs.turbWkA = (outs.turbWkA||0) + Math.abs(w); }
    }
    if(byDrop && ed.key) byDrop[ed.key] = span>0 ? Math.abs(b[ed.u]-b[ed.v])/span : 0;
    if(ed.kind === "break"){ // LABEL: synthetic edge kind this function invents
      /* charged to the side the hole is on (ed.sec/ed.steam, netBuild) - the
         plume is still booked in outs.by whichever side it is, because a hole
         is a hole. A steam-side hole is charged at its shell instead, so it
         is counted in NEITHER sum here: what leaves it is steam, and this
         solve carries one density. */
      /* ══ SPILT IS WHAT LEFT, AND ONLY WHAT LEFT ══
         Every break edge is built u = the plant, v = containment, so positive
         IS out - and this took Math.abs() of it. A hole running backwards was
         booked as more spill: measured on a cut hot leg, 118 kg/s coming IN
         read as 118 kg/s going OUT, so s.inv fell steadily while the plant was
         being filled, and the residual it should have raised was laundered
         into a plausible-looking leak rate instead. */
      if(!ed.steam){ if(ed.sec) spillSec += Math.max(q[e],0); else spill += Math.max(q[e],0); }
      /* per OPENING, because an effect has to be drawn where its own hole is:
         a severed run's two ends share one key and sum, the vessel has its
         own. This is what stops the breach plume being a boolean at the
         reactor whatever actually broke. */
      if(outs){ (outs.by || (outs.by = {}));
                outs.by[ed.key] = (outs.by[ed.key]||0) + Math.max(q[e],0); }
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
         Both readings answer the SAME "sever every primary run" case the
         same way: spill rises, netFlowK stays 0. */
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
// given, are filled the same way netReadEdges fills them - this is
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
     while the plant one tick later derated to what it really passes, so cwKOf()
     read 0.42 on MSRE against a flow the plant could never have. `refOpen`:
     see the scale reference in commission(). */
  const s = Object.assign({dmgParts:[], valve:{}, flow:1, Tavg:P.Tref,
                           coreDT:0, P:P.P0, pCore:P.P0}, over);
  for(const fid of net.fitIds) if(net.fitMode[fid]==="throttle")
    s.valve[fid] = fitTies(fid) ? 0 : 1;
  /* AND EVERY SHELL IS HELD. The reference is a GEOMETRIC figure, and a
     storage term is the opposite of one - it prices how fast a vessel gives
     way. Held, each shell is a fixed node at its own stated pressure, which
     is what this solve read before a shell had a compliance at all. */
  const was = netStoreHeld; netHoldStore(true);
  try { const sol = netSolve(net, s);
        // the solved edge flows themselves, as netFlowK() hands them on: a run
        // key is a label and a machine's internal path has none, so byRun
        // cannot say what a NODE passes
        if(outs) outs.edgeKg = sol.q;
        return netReadEdges(sol, byLoop, byRun, null, outs); }
  finally { netHoldStore(was); }
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
  if(P && P.net) netReadEdges(netSolve(P.net, s), null, null, o, null);
  return o;
}

/* One solve, three answers - the head lost across every run, the pressure at
   every node, and WHAT EACH RUN CARRIES in kilograms per second. A renderer
   wants all of them in the same frame and they come off the same
   substitution, so asking for them separately would solve the plant three
   times a frame for one set of numbers. The flow bag is why a meter can print
   the solve itself instead of differentiating an integral of a ratio. */
function netField(s, byDrop, byP, byRun){
  if(!(P && P.net)) return;
  const sol = netSolve(P.net, s);
  netReadP(sol, byP);
  netReadEdges(sol, null, byRun, byDrop, null);
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
const invRate = q => { const kg = loopKg(); return kg > 0 ? 100*q/kg : 0; };
/* The volumetric thermal expansion coefficient of pressurised water near
   300 C, 1/K. PHYSICAL, not fitted: with COOLANT[].solidK it is what a
   kilogram of a circuit gives way by (kappaOf). */
const BETA_W = 0.0025;

/* THE FIELD. Pressure in MPa at every node, keyed by node id - the answer to
   "what is the pressure HERE", which is the whole point of solving absolutely.
   Read-only and resolved fresh, never on S: exactly the argument the radiation
   field makes, and for exactly the same reason - nothing here can drift out of
   step with a snapshot, because nothing here IS a snapshot.

   The tick does NOT call this. step() takes its field off netFlowK()'s own
   solve, so a tick pays for one solve and not two; this is for a reader
   asking off-tick (a renderer between frames, a headless probe). */
function netPressures(s){
  const o = {};
  if(P && P.net) netReadP(netSolve(P.net, s), o);
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

   byRun, if given, is filled by netReadEdges() with this tick's real
   per-run flow - step()'s pipe-animation block reads it back, keyed off the
   same run keys pipeNetwork() hands out, so a throttled leg visibly slows
   instead of every loop showing the one pooled number this used to be. */
function netFlowK(s, byRun, byP, outs){
  const n = P.loops, byLoop = {}, natLoop = {};
  { const sol = netSolve(P.net, s); netReadP(sol, byP); netReadEdges(sol, byLoop, byRun, null, outs);
    /* THE SOLVED EDGE FLOWS THEMSELVES, signed along each edge's own u->v.
       The transport used to advect along byRun, which is a LABEL: a machine's
       internal path carries no run key at all, so the turbine's exhaust node
       had an outlet and no inlet and its mass integral drained it to nothing
       in four seconds. A run split into series segments shares one key too.
       This is the set the momentum law actually answered in. */
    if(outs) outs.edgeKg = sol.q; }
  /* The same plant with its pumps stopped: what it circulates on its own is
     a reading this function can take for free, because the network is linear
     in head and the factorisation depends on conductance alone - one
     assemble and one substitution, never a re-elimination. Object.create
     rather than a spread, so a tick allocates one object and not forty
     copied fields. */
  // the commissioning settle asks hundreds of times and reads no NAT CIRC bar
  if(!(outs && outs.noNat)){ const sNat = Object.create(s); sNat.flowScale = 0;
    netReadEdges(netSolve(P.net, sNat, true), natLoop, null, null, null); }
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
   job. What being wrecked MEANS is a HOLE at that cell (runHoled(), above) -
   a valve body is the pressure boundary - and no orders either (ACT.portShut
   refuses, record.js), because the handle went with it. */
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
  if(id.indexOf("mat:")===0){ const k=id.slice(4), j=k.indexOf(",");
    return j<0 ? null : matCellPart(+k.slice(0,j), +k.slice(j+1)); }
  if(id.indexOf("pipe:")!==0) return partOf(id) || null;
  const k=id.slice(5), i=k.indexOf(",");
  return i<0 ? null : pipeCellPart(+k.slice(0,i), +k.slice(i+1));
}
/* IS THIS PORT WRECKED - the one predicate, so the act that refuses, the
   colour that says so and the list that reports it cannot disagree. NOT
   portDead() (layout.js): that one is the set of nodes a SHUT valve kills,
   which is a different question about the same box. */
const portWrecked = (s,pid) => partWrecked(s, "port:"+pid);

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
   gesture" stops being a claim and becomes the way the plant is made.

   It lives in pipenet.js rather than layout.js because it needs TANK_DEFAULT
   and PIPE_BORE, and pipenet.js loads after layout.js (index.html) - which
   is already why the relief seed lived here.

   IDEMPOTENT: it clears D.pipes/D.ports/D.tanks/D.fittings first, so calling it twice gives
   one plant and not two, and a tool building an n-loop plant calls the
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
  // the last set takes the remainder, so a set's own count is counted
  const setUnits = s => { let n=0; for(let u=0;u<units;u++) if(setOf(u)===s) n++; return n; };
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
  /* ROW 0 OF A BAND IS THE WALL'S, AND THE ISLAND STANDS OFF IT. The drives
     ride the vessel's head and stood ON row 0, so the containment's top run
     was refused its own cells and the ring closed on the hull instead of on
     itself. Every placement inside a unit is off this offset, so the island
     moves as one piece and no run changes shape. */
  const ISL=2;
  const uOX = u => 0;
  const uOY = u => u * BAND;
  const sOY = s => s * perSet * BAND;   // a set stands in the band of its first unit
  /* THE HULL THIS PLANT NEEDS. The engine room stands aft of the last loop, so
     a four-loop reference plant is a longer ship - and it says so here rather
     than leaving its own turbine standing outside the skin. A multi-unit ship
     is as wide as its widest band and as tall as its sets, and the player may
     still drag it either way afterwards. */
  if(multi){ D.gw = 60 + 7*(loops-1) + 12; D.gh = BAND*units; }
  else     { D.gw = 60 + 7*(loops-1);      D.gh = 36; }
  /* WHAT THIS SHIP DOES NOT CARRY. A preset that placed an injection tank and
     a relief valve and then took them off again had built a plant it did not
     mean; this simply never places them, and every nozzle and run that would
     have gone to one is skipped with it. */
  const drop = new Set((opt && opt.drop) || []), has = id => !drop.has(id);
  for(const k   in D.pipes) delete D.pipes[k];
  for(const k   in D.mat)   delete D.mat[k];      // structure is the ship's too - a preset is the whole ship
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
  /* ══ ROW 0 OF EVERY BAND IS LEFT CLEAR ══
     The reactor island stood ON the deckhead - the rod drives at row 0, the
     relief tank beside them and the generator safety valve past that - so no
     wall could ever be painted over it and the reference ship could not carry
     the one containment every plant of its kind has. Everything in the top
     band is one row down; every run is routed and every nozzle is an offset,
     so nothing else had to move with them. */
  /* THE FIRST OF ANYTHING KEEPS THE BARE NAME. A machine id carries no meaning
     (mintMachine()), so this is only about the reference ship coming out of
     this pass with the identical dictionary it always had. */
  const sfx = n => n ? String(n) : "";
  /* A LOOP'S OWN COLUMN, in its unit's own frame. TWO CELLS FURTHER AFT on a
     banded ship: the main steam header arrives from the WEST there, so the
     steam tee needs a free cell on that side - and at the reference spacing
     that cell is the relief tank's last column. The reference ship never asked
     for the port, because its first tee has nothing to its west. */
  const X  = i => 30+7*i;
  const uX = (u,i) => X(i) + uOX(u);         // ...and on the board
  // stacked units share their columns, so the engine room stands where it
  // always did - only further apart, band by band
  const AFT   = 46+7*(loops-1) + (multi?2:0);
  const FEEDX = X(loops) - 2 + (multi?2:0);
  // the header riser's own column, forward of the engine room and aft of
  // every loop - the lane a set's main steam already climbs to its turbine
  const MSRX  = AFT-6;
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
    const U=sfx(u), ox=uOX(u), oy=uOY(u)+ISL;
    /* ONE ROW OFF THE DECKHEAD, and that row is what a containment needs. The
       drives ride the head (dy:-13, MACHINE.rods) and at y=13 they stood ON
       the hull ring, so no wall could ever be painted over the reactor and the
       reference ship could not be given the one containment it obviously has.
       Everything below follows the machine, because every run is routed and
       every nozzle is an offset. */
    mintMachine("core"+U,"core",8+ox,13+oy);   // and its rod drives, which ride the head
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
  radAt("rad0",AFT-7); radAt("rad1",AFT);
  /* ── AND SOMETHING HAS TO TURN THE CIRCULATING WATER ──
     The condenser rejects into a loop, and a loop with nothing pushing it
     carries nothing. It is a pump like every other pump: hit it, or lose the
     board it feeds off, and the sink goes.
     FOUR ROWS ABOVE THE PANEL'S OWN TOP, never a fixed row. The joint below it
     is two nozzles meeting across a cell boundary, so it needs exactly one
     free row each. It KEEPS ITS COLUMN and takes its suction on the RIGHT
     FACE: a full-height pump standing here reaches up into the reserve tank's
     rows, so a top nozzle has no cell to stand in. */
  mintMachine("cwp","pump",AFT-6,BOT+1-partOf("rad0").h-pumpH("cwp"));
  setPartName("cwp","CIRC WATER PUMP");
  /* ══ THE STOCK SHIELDING, PAINTED ══
     The same nine-by-three band of steel between the reactor and the control
     room, laid the way the PAINT tool lays it - a shield is not a machine any
     more, so there is nothing to mint. */
  for(let X=18;X<27;X++) for(let Y=GHc-4;Y<GHc-1;Y++) matPaint(X,Y,"steel");

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
  const U=sfx(u), ox=uOX(u), oy=uOY(u)+ISL;
  // the reserve's own column - off X() so it follows the loop columns rather
  // than repeating their spacing, or a banded ship stands its pump on its tie
  // ...and it walks aft with its own tie, or a later unit stands its reserve
  // pump on the tee that pump is supposed to feed
  const EFWX = ox + X(loops) + Math.max(3,loops) + 2 + (multi?u:0);

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
    D.tanks["hpi"+U].cell = [Math.max(0, partOf("core"+U).x - partOf("hpi"+U).w - 3), oy+19];
    buildLayout(); }

  /* ══ THE PRESSURIZER IS A TANK ══
     `hold` and nothing else. It is minted through the same tank() helper as
     every other one, so there is no second draw branch, no second panel and
     no second act - and a second hold tank on a second circuit is a design
     rather than a bug. It commissions OPEN through auto:"always", the relief
     tank's own idiom, so no new default is needed in resetPlant(); bypassing
     it from the control room isolates the vessel and the circuit relaxes to
     containment, which is a capability that falls out rather than a case. */
  tank("pzr",U,ox+18,oy+1,{ name:"PRESSURIZER", col:"#a98cf0",
    tip:"Sets the pressure of the circuit it is piped to. It has to sit high - the steam bubble must stay at the top of the loop.",
    vol:50, level:54, fluid:"water",
    gas:null, check:false, auto:"always", burst:null,
    hold:{p:null}, tsurv:800, pburst:200});

  /* THE RELIEF HEADER'S OWN COLUMNS, off the vessel's box rather than off
     literals - a tank's footprint follows its VOLUME now, so a nozzle, a
     valve and a catch tank authored at fixed columns collide the moment the
     vessel is a different width. Two ports may not share a cell, so each of
     the three stands one clear of the last. */
  const PZR_W = partOf("pzr"+U).w, RV_X = ox+18+PZR_W+2, RELTK_X = RV_X+3;
  tank("reltk",U,RELTK_X,oy+1,{ name:"RELIEF TANK", col:"#8a6cd0",
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
  tank("efw",U,EFWX,oy+17,{ name:"EFW TANK", col:"#5aa9d6",
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
  }
  /* ══ AND THE SAFETY VALVES STAND OUTSIDE, ON THE SKIN ══
     A valve blows overboard only where its open face is against the hull
     (fitVentOut(), above), and it can no longer have that ON the generator:
     the containment's own top run owns the deckhead row. So each one stands
     aft of the wall on the skin, over its own tee spliced into the main steam
     header - which is where a real main steam safety is, outside containment
     and venting to the sky. What it needs from the drawing is the aft edge of
     everything already placed in this unit, so the row is asked once here. */
  let islX=-1e9;
  for(const id of ["core"+U,"rods"+U,"pzr"+U,"reltk"+U,"rv0"+U,"tee0"+U,"efwtee"+U]
        .concat(mstee.map(f=>f).filter(Boolean))
        .concat(Array.from({length:loops},(_,i)=>"sg"+(u*loops+i)))){
    const q=partOf(id); if(q) islX=Math.max(islX, q.x+q.w-1); }
  const svtee=[];
  /* CLEAR OF THE RISER LANE. On a station the unit's own manifold stands in
     that lane, and a safety tee landing beside it is two fittings shoulder to
     shoulder in the one column the manifold needs. */
  let svBase = islX+5;
  if(setUnits(setOf(u))>1 && svBase >= MSRX-2) svBase = MSRX-3;
  for(let i=0;i<loops;i++){
    const li=u*loops+i, cx=svBase+3*i;   // three, so two tees' own ports never want one cell
    svtee[i]=fitting("svtee"+li,"", cx, oy+2, { name:"SAFETY TEE "+(li+1), mode:"tee", bore:boreMm("steam"),
      tip:"Where this generator's safety valve taps the main steam header. A tee closes nothing." });
    svf[i]=fitting("sv"+li,"", cx, uOY(u)+0, { name:"SG SAFETY "+(li+1), mode:"relief", bore:412.5, tip:svTip });
  }
  /* ══ AND A SECOND UNIT MEETS THE FIRST IN THE RISER, NEVER TEE TO TEE ══
     A unit's own header is laid along its band's top row, and that row is
     blocked at every steam tee by the tee's own safety-valve and generator
     nozzle cells - so a chain drawn from one band's tee to the next band's
     had no lane and merged into the feedwater line at the generator nozzle
     instead. Measured: it read as a shell boiling into a closed vessel.
     One riser tee per unit in the aft lane, stacked, is the manifold a real
     multi-unit station has and every leg of it is a lane nothing else wants. */
  const mshdr = setUnits(setOf(u))>1
    ? fitting("mshdr",U, MSRX, oy+2, { name:"STEAM HEADER "+(u+1), mode:"tee", bore:boreMm("steam"),
        tip:"Where this unit's main steam joins the header its turbine is fed from. A tee closes nothing: lose a unit and the rest of the station keeps the machine turning." })
    : null;
  UN[u] = {U, ox, oy, tee0, rv0, efwtee, mstee, svtee, svf, mshdr};
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
  const HOT_COL = i => X(i)-4;       // the gap forward of the generator
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
  /* ONE BILGE ROW PER LOOP, OFF THE VESSEL'S OWN FLOOR. Literal rows walked
     down the ship whenever the island moved, and the outermost loop's leg came
     out under the panels with nothing to route through. */
  const coldRow = (u,i) => { const c=partOf("core"+sfx(u)); return c.y+c.h+1+i; };
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
    n.pRelTk   = port("reltk"+U,-1,clamp(1,0,relB.h-1));
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
  /* THE HEADER IS THE UNIT'S, AND THE RISER IS THE SET'S. A unit's generators
     chain tee to tee along its own band; where a set carries more than one
     unit, each band's aft end goes into that unit's riser tee and the risers
     are stacked into one manifold below.
     hdr[u] is the last tee laid on unit u and nothing more. */
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
      const teeB = seedPort(n.mstee[i],0,1);
      const teeL = hdr[u]!=null ? seedPort(n.mstee[i],-1,0) : null;
      const teeR = seedPort(n.mstee[i],1,0);

      // primary: vessel to shell, shell to pump, pump back along its own bilge row
      if(i) seedRun(n.coreHot(i), g.l, false, [[HOT_COL(i)+ox,HOT_ROW[i]+oy],[HOT_COL(i)+ox,6+oy]]);
      else  seedRun(n.pTeeR, g.l, true);
      seedRun(g.b, pT, true);
      seedRun(pB, n.coreCold(i), false, [[uX(u,i)+1,coldRow(u,i)],[n.coreBilge(i),coldRow(u,i)]]);
      // secondary: the nozzle faces the tee's own port across one cell - a joint,
      // no pipe
      seedRun(g.steam, teeB);
      if(hdr[u]) seedRun(hdr[u], teeL);         // ...and the header, tee to tee
      hdr[u] = teeR;
      /* DOWN, WEST, UP: out of the discharge nozzle under the pump, along its own
         row below the coolant pumps, and up the same riser the loop's own column
         already reserves. THE FIRST LOOP OF A UNIT is the one that unit's reserve
         is tied into, so it is two runs through the tie standing in that riser
         rather than one straight through it. */
      /* A UNIT IN ANOTHER BAND IS FED UNDER THE PUMP AND DOWN THE AFT LANE.
         The feed pump stands in its set's own band, so a line dropped straight
         down the tie's column arrives ON TOP of the tee and can never reach
         the bottom port it feeds: it rerouted itself into the first unit's
         riser and butted, and the second generator had no feedwater at all.
         One lane and one crossing row per unit, so two units never share one. */
      // ...and it lands BELOW its own tie, which is the face that tie is fed on
      const land = partOf(n.efwtee).y+4;
      const bandVias = oy-ISL===sOY(s) ? null
        : [[FEEDX-3, FEED_ROW(s,k)], [FEEDX-3, land], [feedCol(u,i), land]];
      if(i) seedRun(t.feedL(k), g.feed, false,
        (bandVias||[]).concat([[feedCol(u,i),bandVias?land:FEED_ROW(s,k)],[feedCol(u,i),5+oy]]));
      else { seedRun(t.feedL(k), n.pTieB, false,
               bandVias || [[feedCol(u,0),FEED_ROW(s,k)]]);
             seedRun(n.pTieT, g.feed, false, [[feedCol(u,0),5+oy]]); }
    }
    /* ══ AND THE HEADER GOES ON AFT THROUGH ITS SAFETY TEES ══
       One per generator, spliced in the order the generators are, each with
       its own riser up to a valve standing on the skin. The chain continues
       from the last generator's tee, so a set with no containment lays the
       identical line - the valves simply stand further aft than they used to. */
    for(let i=0;i<loops;i++){
      const st = n.svtee && n.svtee[i]; if(!st) continue;
      if(hdr[u]) seedRun(hdr[u], seedPort(st,-1,0));
      hdr[u] = seedPort(st,1,0);
      seedRun(seedPort(st,0,-1), seedPort(n.svf[i],0,1));
    }
  }
  /* each header's aft end into its own riser tee, the risers into one another
     down the lane, and the top of the manifold aft onto its turbine's one
     steam nozzle. A set with one unit has no riser at all and its header goes
     straight aft, which is the reference ship's own single run. */
  for(let u=0;u<units;u++) if(UN[u].mshdr && hdr[u])
    seedRun(hdr[u], seedPort(UN[u].mshdr,-1,0));
  for(let u=0;u+1<units;u++) if(UN[u].mshdr && UN[u+1].mshdr && setOf(u)===setOf(u+1))
    seedRun(seedPort(UN[u].mshdr,0,1), seedPort(UN[u+1].mshdr,0,-1));
  for(let s=0;s<sets;s++){
    const u0 = UN.findIndex((n,u)=>setOf(u)===s);
    if(u0<0) continue;
    const top = UN[u0].mshdr ? seedPort(UN[u0].mshdr,1,0) : hdr[u0];
    if(!top) continue;
    /* ON THE HULL ROW, NEVER THE HEADER'S OWN. A banded set stands its
       turbine two rows under the top of its band, so the lane aft along the
       header's row IS the steam nozzle's own cell - the run stopped one cell
       short of it and the turbine read as unpiped. */
    if(multi) seedRun(top, ST[s].pTurbT, true);
    else      seedRun(top, ST[s].pTurbT, false, [[AFT+4, 2+ISL+sOY(s)]]);
  }
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
     A flow coefficient goes as bore squared (pipeC(), above), so twice the bore is
     a quarter of the loss. A BORE, in millimetres, on the run - the same
     figure the run's own panel states. */
  buildLayout();
  for(const n of UN){ const suc = runBetween("efw"+n.U,"efwp"+n.U);
    if(suc) D.bore[suc] = 2*boreMm("feed"); }

  /* ══ AND THE CONTAINMENT, LAST, BECAUSE IT IS PAINTED ROUND WHAT IS THERE ══
     A closed ring per UNIT, in that unit's own band: the vessel, its drives,
     the pressurizer, the relief valve and its tank, the generators and the
     coolant pumps - the reactor island, and nothing aft of it. The turbine,
     the condenser, the feed train, the panels, the control room and the supply
     stand outside, which is the split a real station makes.
     LAST of everything, because paint is refused a cell a machine, a tank or a
     nozzle is standing in (occupied(), layout.js) and every one of those is
     placed above. A pipe cell it may have: a run through the wall is a
     PENETRATION, which is the whole reason the mechanism is not degenerate.
     WHAT it is made of is the preset's own row - see PLANTPRE. A ship that
     carries none paints none, and the fill then finds the hull and says so. */
  /* ══ AND IT STANDS ONE CLEAR CELL OFF EVERY BOX ══
     The ring used to be four literals, so a machine that grew with its own
     duty ended up leaning on the wall - the drives on the deckhead run and the
     safety valve on the aft one. It is the island's own bounding box plus two
     now: one cell of air, then the wall. */
  if(opt && opt.cont){
    for(let u=0;u<units;u++){
      const U=sfx(u), ids=["core"+U,"rods"+U,"pzr"+U,"reltk"+U,"rv0"+U,"tee0"+U,"efwtee"+U];
      for(let i=0;i<loops;i++){ const li=u*loops+i;
        ids.push("sg"+li,"pump"+li,"mstee"+li); }   // the safety valves stand outside, on the skin
      let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
      for(const id of ids){ const p=partOf(id); if(!p) continue;
        x0=Math.min(x0,p.x); x1=Math.max(x1,p.x+p.w-1);
        y0=Math.min(y0,p.y); y1=Math.max(y1,p.y+p.h-1); }
      if(x1<x0) continue;
      x0=Math.max(0,x0-2); y0=Math.max(0,y0-2);
      x1=Math.min(GW-1,x1+2); y1=Math.min(GH-1,y1+2);
      for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++){
        if(x!==x0 && x!==x1 && y!==y0 && y!==y1) continue;
        matPaint(x,y,opt.cont.m);
        if(opt.cont.t !== undefined && D.mat[x+","+y]) D.mat[x+","+y].t = opt.cont.t;
      }
    }
  }

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
 ["STOCK PWR",{loops:1,arch:0,cont:{m:"liner"},d:{bkp:1,sg:0,chim:0.3}},
  "The reference ship: one pressurised water loop, a pressurizer with a relief valve behind it, injection water, an emergency feedwater tie, a turbine, a condenser and two panels. Everything the other presets add or take away is measured against this."],
 ["NUSCALE",{loops:1,arch:0,lat:1,cont:{m:"liner"},d:{bkp:1,sg:0,pzr:0.8,chim:0.5}},
  "A small compact PWR module: one loop, a tall tight core, a suppression pool and a battery. Light, cheap and slow to bite. The real module circulates by itself and has no pump at all; this one keeps its RCP."],
 ["BWR/4",{loops:2,arch:1,cont:{m:"liner",t:20},d:{bkp:1,sg:0,pzr:0.7,chim:0.4}},
  "Two recirculation loops boiling at 7 MPa - the Fukushima Daiichi machine. Power follows flow instantly and margin to dryout is thin, so it will not forgive a flow transient the way a pressurised plant does."],
 ["BN-600",{loops:3,arch:3,cont:{m:"liner"},d:{bkp:2,sg:1,pzr:0.6,chim:0.4}},
  "Three primary sodium loops at atmospheric pressure, once-through steam generators, diesels and a large dry containment. Enormous boiling margin and a prompt lifetime forty times shorter than water - it answers a rod before you have finished moving it."],
 ["EPR",{loops:4,arch:0,lat:2,cont:{m:"lined"},d:{bkp:2,sg:0,pzr:1.3,chim:0.3},
   place:[["catcher","catcher",8,30]]},
  "Four loops round a wide squat core, large dry containment, diesels and a core catcher. The heavy one, and the one with margin everywhere: low peaking, high DNBR, minutes of generator water after feedwater is lost."],
 ["RBMK-1000",{loops:2,arch:2,d:{bkp:1,sg:1,pzr:1.0,chim:0.3}},
  "Two coolant loops through a graphite pile, gravity scram and no containment - because the real one had none that would hold. Boiling the water ADDS reactivity here, so the plant hunts itself and the slow rods arrive late."],
 ["MSRE",{loops:1,arch:4,cont:{m:"lined"},d:{bkp:1,sg:1,pzr:0.5,chim:0.6}},
  "Molten salt through a graphite matrix at no pressure at all, one loop, once-through boiler. Almost no xenon pit and hours of grace; what it will do instead is freeze solid if you let it get cold."],
 ["WINDSCALE",{loops:1,arch:5,d:{bkp:0,sg:1,pzr:0.5,chim:0.2},
   drop:["hpi","rv0","reltk"], tanks:{efw:{vol:5}}},
  "A graphite pile with no containment, no backup power, no injection water and no relief valve on the loop. It runs perfectly well and every single fault is uncovered - lose the bus and the pumps stop, overpressure the loop and nothing lifts, and there is nothing to inject with at all. Fly it to see what the safeguards on every other preset are FOR."],
 /* TWO REACTORS AGAINST ONE TURBINE, and nothing about it is exotic: it is
    the STOCK PWR's own gear twice over, on one hull. It is here to be FLOWN
    AT, not admired - the cost of a second reactor is what it measures, so
    every unit is the same small compact core and only the count varies. */
 /* NO CONTAINMENT, and it is the hull that refuses it. A unit's rod drives
    stand against its own band's deckhead, so on the top band that deckhead is
    the ship's skin and a wall can close against it - and on every band below,
    the same row is open ship and the drives are a hole straight through it.
    Two identical units where one is contained and one is not is a lie about
    the symmetry, so this station carries neither. */
 ["DUAL",{units:2,sets:1,loops:1,arch:0,lat:1,d:{bkp:1,sg:0,chim:0.3}},
  "Two small identical pressurised units on one hull, one loop each, both feeding a single turbine, and NO containment on either - stacked this tight, the lower unit's rod drives stand in the row a wall would have to close along, so neither unit gets one. Nothing here is exotic: it is the STOCK PWR twice over, sharing one engine room and one circulating water system the way a real multi-unit station shares its cooling. Fly it to see what a second reactor costs to run - and trip a unit to lose half the steam into a turbine that is still carrying the whole load."],
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
  buildStockPlumbing({loops:q.loops, units:q.units, sets:q.sets, drop:q.drop, cont:q.cont});
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
