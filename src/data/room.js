"use strict";
/* the room heat field - see .claude/CLAUDE.md

   HEAT IS A PLACE, the same claim src/data/rad.js makes about radiation, and
   the two files are deliberately different in exactly one way. radSolve() is
   resolved FRESH every tick because a dose rate has no memory: switch the
   source off and the field is gone the same instant. Heat has memory. A
   falloff kernel would make the room hot only while a machine is hot, "the
   heat has to go somewhere" could not be said at all, and there would be
   nothing left for a cooling machine to remove. So this field is STATE, on S
   (s.roomT), and that difference is the whole point of it.

   THE PILLAR'S "unless it is heavy to compute" CLAUSE IS INVOKED HERE, OUT
   LOUD. Real compartment transport is plume-dominated - buoyant jets,
   stratified layers, forced ventilation - and none of that is a 2-D
   conduction stencil. What is written below is explicit diffusion with an
   upward bias, which is a deliberate reduction of the same kind XMIX is about
   cross-flow in the core, and it is named as one rather than dressed up.

   ROOM_DEPTH is the assumption a 2-D grid forces on anyone who wants a mass
   of air, and hydrogen concentration is directly proportional to it. It is
   stated here rather than buried: the plant is drawn in section, so the room
   has no third dimension until somebody types one. */

// m - THE ASSUMPTION. Air mass and every hydrogen concentration scale on it.
const ROOM_DEPTH = 4.0;
const ROOM_RHO = 1.2, ROOM_CP = 1.0;      // air: kg/m^3, kJ/kg/K
// W/m^2/K - free convection off a lagged industrial surface. Single digits is
// the real figure for lagging; bare metal would be ten times this.
const ROOM_H = 6;
/* m^2/s - THE ONE FIT IN THIS FILE, and the one place a number here was
   chosen rather than looked up. It stands in for every transport mechanism a
   diffusion stencil cannot express. Explicit stability caps it at
   MPC^2/(dt*(2+up+1)), and the BINDING bias is H2_UP rather than ROOM_UP now
   that a gas brings its own: 0.63 m^2/s at dt=0.02 against the 1.8 the heat
   pass alone allowed. This still sits well inside it, so no substepping is
   needed, and raising it past the cap is never the answer - substep it the
   way the kinetics does instead. */
const ROOM_MIX = 0.35;
// hot air rises: the conductance up out of a cell against the one down into
// it. One constant, the BUOY_LIN idiom - a bias, not a correlation.
const ROOM_UP = 3.0;
// a machine is a wall. What crosses an occupied cell, as a fraction.
const ROOM_BLOCK = 0.12;
/* K - A RUNAWAY GUARD. It is NOT deleted, because an explicit stencil with no
   ceiling at all is one bad source term away from spreading Infinity across
   the whole grid, and it is not the old 2500 either: that was fitted to a
   compartment of 1.045 kJ/K cells and the integrator genuinely did run away
   against a 1.6 GW release. ROOM_CGAME took the stiffness out - lifted, a
   severed steam line peaks at 9686 K and a severed hot leg at 17210 K, both
   FINITE - so this is set clear of the worst of them and no longer acts at
   all. It is priced against ROOM_CGAME: a smaller compartment capacity raises
   those peaks, so lowering that constant means re-measuring this one. */
const ROOM_TMAX = 20000;
/* K - what the ship was BUILT at, and what the compartment starts at. It was
   T_CW, the condenser's cooling water, only because the plant sat in water
   that was both. It is no longer a boundary: the skin RADIATES, so where the
   hull settles is measured rather than declared. */
const T_HULL = 293;
/* THE SKIN IS A RADIATING SURFACE, NOT A CLAMP. It was held at T_HULL for
   ever, which is an infinite sink and the one thing space has not got - it
   also meant the compartment could never run cold and that the ventilation
   unit was arguing with a boundary condition it could not beat. 0.85 is a
   painted metal hull, the same real figure RADCOAT's default coating carries;
   ONE number, because there is one skin and the player cannot buy another.
   It radiates against T_SPACE exactly as the panels do - the difference is
   that a panel is fed by the condenser and this is fed by whatever the
   compartment air can conduct to it, which is what makes it finite. */
const HULL_EMIS = 0.85;
// m^2 of skin ONE OUTWARD FACE of a hull cell carries - pure geometry: the
// cell is MPC wide and the compartment is ROOM_DEPTH deep.
const HULL_FACE_A = MPC*ROOM_DEPTH;

/* WHAT THE COMPARTMENT ABSORBS PER KELVIN. The air alone is 2.13 MJ/K
   against releases measured in gigawatts, so a severed steam line took the
   room from ambient to the ceiling in three seconds and there was no accident
   to play. ROOM_CGAME is BOUGHT BALANCE and stands in for the term this model
   does not carry - the ship's structure, and the condensation on it, which is
   what actually swallows a steam release in a real compartment. It scales the
   SOURCE side only: the transport conductance g0 is priced off ROOM_C as
   well, so the stencil divides it straight back out and the explicit
   stability limit does not move. Not applied to ROOM_MOL or ROOM_MAIR - those
   are real air, and a hydrogen concentration is a real fraction. It does not
   move the settling point, only how long the room takes to reach it - which
   is why it is priced against the ambient field as much as against a jet. */
const ROOM_CGAME = 50;
/* TWO CAPACITIES, SIDE BY SIDE, AND THAT IS DELIBERATE. ROOM_CAIR is the REAL
   air in one cell and ROOM_C is that air plus the ballast above. Every slow
   source - a hot surface, a steam jet, a fan - heats at ROOM_C, because
   ROOM_CGAME's whole argument is that structure and condensation swallow a
   release over SECONDS. A DEFLAGRATION IS OVER IN MILLISECONDS and the steel
   has no time to take any of it, so a burn heats at ROOM_CAIR - the same
   constant read the other way round, not an exception to it. Divide the bang
   by fifty and a stoichiometric cell is a warm draught: +70 K where the real
   figure is +2900. */
const ROOM_CAIR = MPC*MPC*ROOM_DEPTH*ROOM_RHO*ROOM_CP;
const ROOM_C = ROOM_CAIR*ROOM_CGAME;
/* AND A BANG IS AT CONSTANT VOLUME, so it heats at cv, not cp: air's 0.718
   against 1.0. The same cell's air, the other capacity - a deflagration in a
   sealed bay has nowhere to do pressure-volume work. ROOM_CP stays the right
   figure for everything that FLOWS (a plume, a vent, a fan). */
const ROOM_CV = 0.718;
const ROOM_CVAIR = ROOM_CAIR*ROOM_CV/ROOM_CP;
// kW/K, one cell of hot surface - m^2 of machine surface one cell of
// footprint is worth, pure geometry rather than a lookup
const ROOM_HK = ROOM_H*MPC*MPC/1000;
/* WHAT ONE VENTILATION UNIT MOVES, in kg of compartment air per second - a
   RATED MACHINE, not a UA fitted to make a number come out. 50 kg/s is about
   40 m^3/s, which is a marine engine-room ventilation SET rather than one
   fan - and the box is 3x3, so a set is what it is. Against the 2132 kg of
   air this compartment holds, one of them turns the whole room over in
   43 seconds. What it removes is that mass times its own temperature rise
   above the hull outside, AT THE CELLS IT IS STANDING IN - so where it is put
   decides what it is worth, which is the whole reason it is a box on the grid
   and not a checkbox. A bigger footprint buys nothing: the set is rated, not
   the hole it sits in. Measured worth on the hottest preset (MSR, 9.4 K of
   mean rise at rest): one unit beside the vessel takes 1.0 K of it, two take
   1.3 K, and one sited in a cold corner takes nothing at all. */
const ROOM_VENT_KGS = 50;

/* ══ WHAT A MACHINE'S SURFACE IS AT ══
   THE ONE DOOR, the sgHot() idiom: the field, the readout and the damage
   criterion cannot disagree about how hot a box is, because there is one
   expression. ROLE.thermal finally decides something - a role that moves no
   heat has no surface and returns null, and nothing here invents a
   temperature for a box that never said it had one. */
function partTemp(s, p){
  const R = ROLE[p.role];
  if(!R || R.thermal === "none") return null;
  if(p.role === "sg")   return s.sgTBy[p.id];
  // an exchanger has no pot: what the box contains is what its own nodes hold
  if(p.role === "ihx"){ let t=0, n=0;
    for(const IN of roleIns(p)) for(const f of [IN.a, IN.b]){
      t += netTempAt(s, coreFold(p.id+f)); n++; }
    return n ? t/n : s.Tavg; }
  if(p.role === "cond") return s.condTBy[p.id];
  if(p.role === "radiator") return s.radTBy[p.id];
  return s.Tavg;                          // thermal:"source" - the vessel itself
}
/* ══ AND WHAT ITS SKIN IS AT, WHICH IS A DIFFERENT QUESTION ══
   partTemp() is what a machine CONTAINS. This is the metal between that and
   the air, and it is the thing that actually fails: s.partT[id], integrated
   on S beside s.roomT for the same reason - a skin with no memory is not a
   skin. It closed three holes at once.

     - The room used to be fed by the CONTENTS directly, so a machine gave
       heat away and never lost any. Every pot is charged now (s.skinQ, spent
       in step.js), so heat comes from somewhere.
     - The damage criterion used to compare the AIR against tsurv, so a box
       cooked the instant the air did and every machine on the plant died in
       the same tick. It compares the metal now, and the metal has mass.
     - A machine that moves no heat had no surface at all and was invisible to
       the field. It is thermal mass standing in the room like everything else.

   ROOM_SKIN_TAU is BOUGHT BALANCE and says so - it is how long a skin takes
   to follow the air around it, written as a time rather than dressed up as a
   steel mass it is not. SKIN_PROC_K is the process side against the air side:
   at 20 a skin sits within 5 % of its own contents while the room is near
   ambient, so nothing measured at rest moves, and the heat the room receives
   is exactly the heat the contents give up. */
const ROOM_SKIN_TAU = 45;                 // s, skin against the air
const SKIN_PROC_K = 20;                   // contents-side conductance / air-side
const skinCap = n => ROOM_SKIN_TAU*n*ROOM_HK;         // kJ/K
const partSkin = (s, p) => { const v = s && s.partT && s.partT[p.id];
  return v === undefined ? (partTemp(s, p) ?? T_HULL) : v; };
// what the CONTENTS of this machine are losing through their own skin, kW -
// one tick old at the pots, the s.coreDT idiom, because the room is stepped
// after them
const skinQOf = (s, id) => (s.skinQ && s.skinQ[id]) || 0;
// summed over every machine of one ROLE whose contents are a single pot - the
// vessel, the condenser and the radiator fleet each share one, so each is
// charged once for the whole set
const skinQRole = (s, role) => { let q = 0;
  for(const p of LAY.parts) if(p.role === role) q += skinQOf(s, p.id);
  return q; };
/* ...AND WHAT A RUN CARRIES, which is asked of the FLUID and never of the
   run's NAME. A kind is a label, so a table off it stated s.Tavg for a line
   the operator had shut and a hit had severed - the pipe went on cooking the
   compartment out of a reactor it was no longer connected to, and a user run
   carried nothing however hot it was.
   THE RUN'S OWN NODE, now that it has one. This took the mean of the two
   MACHINES the run lands on, filtered by which port valve was still passing,
   because the pipe had no state of its own to ask; a line isolated at both
   ends had no answer at all and read as carrying nothing. It holds what it
   holds, whatever its valves are doing, which is what an isolated line does. */
function runFluidNodes(s, key){
  const net = P.net;
  if(!net || !net.index) return null;
  const nid = runNodeOf(key);
  return net.index[nid] === undefined ? null : [nid];
}
const nodeMean = (nodes, read) => { let t = 0, n = 0;
  for(const nd of nodes || []){ const v = read(nd); if(isFinite(v)){ t += v; n++; } }
  return n ? t/n : null; };
const runFluidT = (s, key) => nodeMean(runFluidNodes(s, key), nd => netTempAt(s, nd));
/* ...AND WHAT IT IS WORTH TO THE ROOM, which is its ENTHALPY and not its
   temperature: a hole flashes, so the state the jet leaves in is two-phase and
   the latent heat in it is most of what the compartment gets. Read on the
   circuit's own curve, the same (p, h) the density and the quality come off. */
function runFluidH(s, key){
  const nodes = runFluidNodes(s, key);
  const h = nodeMean(nodes, nd => netHAt(s, nd));
  return h === null ? null : {h, c:netSatOf(nodes[0])};
}
/* ...AND WHAT A BOX IS DISCHARGING, which is the DONOR node's water and not a
   mean of its two sides: a valve's own outlet holds what it has already let
   past, so averaging it in cools the jet by its own effect. The donor is the
   higher pressure, the same upwind rule advectStep() moves enthalpy by.
   s.Tavg said the reactor's mean whatever the valve was on. */
function partFluidNode(s, id){
  const net = P.net;
  if(!net || !net.index) return null;
  let best = null, bp = -Infinity;
  for(const face of ["t","r","b","l"]){
    const nm = coreFold(id + face);
    if(!nm || net.index[nm] === undefined) continue;
    const p = netPAt(s, nm);
    if(!(p > bp)) continue;
    if(!isFinite(netTempAt(s, nm))) continue;
    bp = p; best = nm;
  }
  return best;
}
function partFluidH(s, id){
  const nd = partFluidNode(s, id);
  if(!nd) return null;
  const h = netHAt(s, nd);
  // the NODE travels with the reading: a spray needs the pressure it is leaving
  return isFinite(h) ? {h, c:netSatOf(nd), nd} : null;
}
/* WHAT AN OPENING IS PASSING, keyed the way s.spillBy is. Heat and hydrogen
   leave through the same hole at the same rate, so both ask this one reader:
   asked twice, an opening whose state cannot be read put its gas in a
   compartment its heat never reached. */
// a break key names a PART (no colon in it) or a RUN (its key always has one)
const breakPart = k => { const t = k.slice(6); return t.indexOf(":") < 0 ? t : null; };
// ...or a reactor CAVITY ("break:cav:"+core id): the core's cells, the cavity node's own water
const breakCav = k => k.indexOf("break:cav:") === 0 ? k.slice(10) : null;
const openFluidH = (s, k) => { const pid = breakPart(k), cid = breakCav(k);
  if(cid){ const nd = "cav:"+cid, h = netHAt(s, nd); return isFinite(h) ? {h, c:netSatOf(nd), nd} : null; }
  return pid ? partFluidH(s, pid) : runFluidH(s, k.slice(6)); };
/* ══ ONE WALK OVER THE LIQUID OPENINGS ══
   Three passes wanted the same list - what the heat pass charges the air, what
   the hydrogen pass vents, and now what the fire pass pools - and each carried
   its own copy of "which openings are passing a fluid whose state can be read,
   and where are they". Asked three ways, an opening could put its metal in a
   compartment its heat never reached. fn(cells, rate, fl, key); the key is the
   one advectH2Out is keyed by. */
function roomLiqOuts(s, G, fn){
  const tgt = (P.net && P.net.fitTarget) || {}, out = (P.net && P.net.fitVentOut) || {};
  for(const k in s.spillBy){
    const fl = openFluidH(s, k);
    if(fl) fn(roomOpenCells(s, G, k), s.spillBy[k], fl, k);
  }
  for(const fid in s.reliefVent){
    if(tgt[fid] || out[fid]) continue;
    const fl = partFluidH(s, fid);
    if(!fl) continue;
    const q = G.parts.find(w => w.p.id === fid);
    fn(q ? q.cells : [], s.reliefVent[fid], fl, "vent:"+fid);
  }
}
/* AND HOW WIDE THE HOLE IS, which is what decides whether a jet atomises. A
   run states its bore and a relief valve states its bore; a torn machine and a
   breached cavity state nothing, and a hole nobody can measure does not spray. */
const openBoreM = key => {
  if(key.indexOf("vent:") === 0) return fitBoreMm(key.slice(5))/1000;
  if(key.indexOf("break:cav:") === 0) return 0;
  const t = key.slice(6);
  if(t.indexOf(":") < 0) return 0;
  const r = P.net && P.net.byKey && P.net.byKey[t];
  return r ? runBoreMm(r)/1000 : 0;
};

/* ══ GEOMETRY, MEMOISED ON THE ARRANGEMENT ══
   laySig()+pipeSig(), the same key radGeom() uses and for the same reason:
   layoutMetrics() runs every frame and D churns on every bench slider, but a
   machine moves rarely. Everything in here is a fact about where things are,
   never about what they are doing. */
let roomCache = null, roomCacheSig = "";
function roomGeom(){
  /* matSig() as well: a gas-tight cell is a hole in the stencil, and painting
     one is exactly as much of a change to this geometry as moving a machine.
     AND THE DAMAGE, which is not a design fact and has to be in the key
     A WALL IS ALWAYS A WALL, wrecked or not, so damage is NOT in this key: a
     shot cell still separates and what crosses it goes through the ORIFICE
     (roomHoleStep(), below) rather than through this stencil. That is what
     makes "everything leaves through the hole" true by construction rather
     than hoped for. */
  const sig = laySig()+"|"+pipeSig()+matSig();
  if(roomCache && roomCacheSig === sig) return roomCache;
  const N = GW*GH;
  const occ = new Uint8Array(N);
  const parts = [], runs = [], hull = new Uint8Array(N), face = new Uint8Array(N);
  const g = occupied(null, {pipes:false, ports:false});
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X;
    if(g[Y][X]) occ[i] = 1;
    if(hullCell(X,Y)) hull[i] = 1;
    /* HOW MUCH SKIN THIS CELL HAS. A corner carries two faces and radiates
       twice as hard, which is geometry rather than a special case - the same
       DIRV walk radLive() makes, and hullCell() answering true off-grid is
       what makes an edge cell count exactly one. */
    if(hull[i]) for(const f in DIRV){ const d = DIRV[f];
      if(hullCell(X+d[0],Y+d[1])) face[i]++; }
  }
  /* WHICH MACHINE IS STANDING IN THIS CELL, walked once here. The ignition
     test asks it of every cell every tick and a scan over LAY.parts per cell
     is a grid-sized loop inside a grid-sized loop. Last one wins, which is
     the same answer occupied() gives an overlap. */
  const own = new Int32Array(N).fill(-1);
  for(const p of LAY.parts){
    const cells = [];
    for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
      if(X>=0&&X<GW&&Y>=0&&Y<GH) cells.push(Y*GW+X);
    if(cells.length){ for(const i of cells) own[i] = parts.length; parts.push({p, cells}); }
  }
  for(const r of pipeNetwork()){
    if(!r.cells) continue;
    runs.push({key:r.key, cells:r.cells.map(([x,y])=>y*GW+x)});
  }
  /* WHICH VALVES ARE ON WHICH SHELL, walked once here rather than per tick:
     shellsOf() is a graph walk and the room asks it of every secondary relief
     fitting every tick otherwise. */
  const shellValves = {};
  for(const p of LAY.parts) if(p.role === "sg") shellValves[p.id] = [];
  if(typeof reliefFitIds === "function")
    for(const fid of reliefFitIds())
      for(const id of shellsOf(fid)) if(shellValves[id]) shellValves[id].push(fid);

  /* THE CONDUCTANCES, one per edge rather than one per cell, so the stencil
     below is a walk over edges and every pair is priced exactly once. Blocked
     through an occupied cell at either end - a machine is a wall, and this is
     what makes a compact plant hotter than a spread-out one. */
  const g0 = ROOM_MIX*ROOM_C/(MPC*MPC);   // kW/K between two open cells
  /* ══ AND A GAS-TIGHT CELL IS EXACTLY ZERO ══
     `blk` is a product over BOTH cells of a face and every field diffuses on
     the three arrays below - temperature, hydrogen, oxygen and the flame front
     - so zero here zeroes all four of that cell's faces, in both directions,
     for all four fields, from one line. What leaves a region leaves through
     the hole, and through nothing else; a breached cell is not tight, blk
     returns to its ordinary value, and the stencil routes through it because
     that is the only face with a conductance left. Nothing has to be told
     where the hole is.
     One predicate, matWall() (paint.js), so the fill and the stencil cannot
     disagree about which cells are a boundary. */
  const tight = new Uint8Array(N);
  for(const k in (D.mat||{})){ const j=k.indexOf(","), X=+k.slice(0,j), Y=+k.slice(j+1);
    if(X>=0&&X<GW&&Y>=0&&Y<GH && matWall(X,Y)) tight[Y*GW+X]=1; }
  const blk = i => tight[i] ? 0 : (occ[i] ? ROOM_BLOCK : 1);
  const gx = new Float64Array(N), gUp = new Float64Array(N), gDn = new Float64Array(N);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X;
    if(X<GW-1) gx[i] = g0*blk(i)*blk(i+1);
    if(Y<GH-1){ const b = g0*blk(i)*blk(i+GW);
      gUp[i] = b*ROOM_UP; gDn[i] = b; }
  }
  /* WHAT A CLUTTERED BAY DOES TO A FLAME. Obstacle-generated turbulence is
     the one mechanism a laminar burning velocity cannot express, and it is
     what takes a real compartment deflagration towards detonation. Off the
     occ array the stencil already built, so a plant drawn tight accelerates
     its own flame - a consequence of the drawing rather than a number. */
  const turb = new Float64Array(N);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X;
    let n = 0;
    if(X>0 && occ[i-1]) n++;
    if(X<GW-1 && occ[i+1]) n++;
    if(Y>0 && occ[i-GW]) n++;
    if(Y<GH-1 && occ[i+GW]) n++;
    turb[i] = 1 + H2_TURB*n/4;
  }
  roomCache = {occ, tight, face, own, turb, parts, runs, shellValves, gx, gUp, gDn};
  roomCacheSig = sig;
  return roomCache;
}

/* scratch, rebuilt every call and never read across one - the runFlow/pField
   idiom in step(). NOT state: every element is written before it is read, so
   a snapshot that does not carry it loses nothing. */
let roomSrc = null, roomD = null, roomD2 = null;
const roomScratch = () => { const N = GW*GH;
  // re-cut on N, not on first call: the hull is draggable, so a buffer kept
  // from a smaller ship is short of the field it is handed
  if(!roomSrc || roomSrc.length !== N){
    roomSrc = new Float64Array(N); roomD = new Float64Array(N); roomD2 = new Float64Array(N); }
  return N; };

/* ══ A JET IS A PLUME, NOT A POINT ══
   Written as a point source first, and it was measured to be wrong in a way
   worth recording: a stuck-open steam safety valve carries ~1.6 GW, and a
   single 0.47 m cell of air is 1.0 kJ/K, so the cell hit ROOM_TMAX inside one
   tick and the ceiling then ATE the accident - the rest of the room barely
   moved while the clamp quietly discarded a gigawatt. A numerical guard that
   decides the outcome is not a guard.

   A discharging jet ENTRAINS. It drags room air in with it, so what actually
   arrives in the compartment is a much larger mass of much cooler gas, and
   the plume grows until it is that big. ROOM_ENTRAIN is the ratio - a free
   turbulent jet entrains 20-50 times its own mass over a compartment length -
   and ROOM_JET_TAU is how long it takes to do it. Their product over the air
   in one cell IS the size of the plume, so a small leak warms a corner and a
   severed steam line fills the ship, off one expression and with no case for
   either. Note what falls out and is not typed anywhere: the temperature the
   plume delivers is h/(ROOM_ENTRAIN*ROOM_CP), about 100 K above ambient, and
   it is the SAME for a 1 kg/s weep and a 600 kg/s rupture. Only the volume
   differs. That is the entrainment physics and it is the reason this is one
   constant rather than a curve. */
const ROOM_ENTRAIN = 25;                  // kg of room air per kg of discharge
const ROOM_JET_TAU = 1.0;                 // s to entrain it
const ROOM_MAIR = MPC*MPC*ROOM_DEPTH*ROOM_RHO;   // kg of air in one cell

/* ══ THE COMPARTMENT HOLDS A REAL MASS OF GAS, AND THAT IS ITS PRESSURE ══
   s.roomP used to be written by one term - the constant-volume heat of a
   deflagration - and relieved by a flat half-second, so a sealed containment
   at 300 kPa and one at 10 kPa emptied in exactly the same time and one wall
   cell shot out emptied it exactly as fast as ten. Nothing was driven by the
   difference and nothing was pushed through the hole.
   s.roomM is kilograms of gas per cell. Pressure follows from it and the air's
   own temperature by the ideal gas law, so every kilogram discharged into a
   room raises the pressure there because the mass is really in it, and every
   kilogram that leaves through a hole lowers it because it really left.
   R_AIR is the published specific gas constant; at rest 1.2 kg/m3 and 293 K
   come out at 0.1009 MPa, which is one atmosphere and is not a fit. */
const R_AIR = 0.000287;                   // MPa*m3/(kg*K)
const ROOM_VCELL = MPC*MPC*ROOM_DEPTH;    // m3 of one cell
// absolute MPa, off a mass and a temperature - the ONE pressure read
const roomPOf = (kg, vol, T) => kg*R_AIR*T/Math.max(vol, 1e-6);
/* ══ AND THE ONE ORIFICE LAW, FOR ANY HOLE BETWEEN ANY TWO GAS VOLUMES ══
   flowW() (pipenet.js) is the plant's single momentum relation - w = C*sqrt(2*
   rho*dp) with C = Cd*A - and a hole in a compartment is the same hole as a
   hole in a pipe. It is stated here as its own door, in SI, so anything that
   opens a gas path can call it: a breached containment wall, a machine that
   has been torn open and is venting its own contents into the room, a hull
   penetration, a fan. Nothing about it knows what a containment is.
   AREA in m2, PRESSURES in MPa absolute, DENSITY of the UPSTREAM gas. */
const roomHoleKgs = (aM2, pUp, pDn, rhoUp) =>
  flowW(ORIF_CD*Math.max(aM2,0), rhoUp, pUp, pDn);

/* HOW BIG THE PLUME OFF THIS OPENING IS. One expression, because the heat and
   the hydrogen leave through the same hole at the same rate and must land in
   the same cells - two copies of it would let a compartment fill with gas
   somewhere the heat never reached. */
const roomPlumeFor = (cells, kgps) => roomPlume(cells,
  clamp(Math.round(kgps*ROOM_ENTRAIN*ROOM_JET_TAU/ROOM_MAIR), cells.length, GW*GH));

/* WHAT A PLUME DELIVERS, AND WHERE. A PLUME IS NOT WELL MIXED: this was flat
   over every cell the flood reached, so the cell at the opening and one
   twenty cells away got the same kilowatt - and a release big enough to size
   its plume at the whole compartment warmed all 2040 cells by the same 127 K
   in ONE tick, which is a break with no place at all. Measured on a severed
   hot leg: the break cell read +126.83 and the far corner +126.82. The weight
   is 1/(1+ring), off the breadth-first ring the cell was reached on, so the
   opening is the hot end and the far side is a draught. Heat and hydrogen
   share this, or the gas would collect where the heat never went. */
function roomShare(cells, kgps, put){
  if(!cells.length) return;
  // the plume is roomQ[0..n) - see roomPlume(), which hands back a COUNT
  const n = roomPlumeFor(cells, kgps);
  let w = 0;
  for(let k=0;k<n;k++) w += 1/(1+roomRing[roomQ[k]]);
  for(let k=0;k<n;k++){ const i=roomQ[k]; put(i, 1/(1+roomRing[i])/w); }
}
function roomSpread(F, cells, kgps, amount){
  if(!(amount > 0)) return;
  roomShare(cells, kgps, (i,f) => { F[i] += amount*f; });
}
const roomJet = (src, cells, kW, kgps) => roomSpread(src, cells, kgps, kW);
/* ══ AND WHAT A MACHINE PUTS INTO THE ROOM IS REALLY IN IT ══
   Every one of these openings already carried a kg/s and a place; what it
   never had was a MASS. A break venting into a sealed containment raised its
   temperature and therefore its pressure, and the steam itself weighed
   nothing - so the compartment could be filled and never fill up. The same
   plume, the same cells, the same rate: this is the machinery half of the gas
   law, and it is the door anything that vents into a compartment calls. */
const roomAddGas = (s, cells, kg, kgps) =>
  roomSpread(s.roomM, cells, kgps, kg);
/* WATER MIXES WITH THE AIR IT LANDS IN, AND IT IS A COOLING TERM ONCE THAT AIR
   IS HOTTER THAN IT. Charged against T_HULL, a 310 K reserve emptying through
   a severed line went on heating a compartment already at 350 K - a source
   that can never change sign, so the room passed the temperature of the only
   thing pouring into it. Each cell is charged on ITS OWN air, so the plume
   both heats and cools and the room can only approach Tf. */
/* AND IT IS CHARGED IN ENTHALPY, never cp*dT: at the hole the water has
   flashed and sits at saturation, so a temperature difference threw the latent
   heat of everything that flashed away and a severed hot leg heated the
   compartment to 373 K and stopped. The air's own side is on the same curve,
   so the sign still turns over and the room can only approach the jet. */
function roomJetLiq(src, T, cells, kg, h, c){
  if(!(kg > 0)) return;
  roomShare(cells, kg, (i,f) => { src[i] += kg*f*(h - hOfT(c, T[i])); });
}
/* THE CELLS A PLUME REACHES, breadth-first out of the opening. Deterministic
   by construction - one fixed neighbour order, one queue, no dice - which is
   what a snapshot round trip requires of it. It crosses an occupied cell:
   this is a gas filling a compartment, not a ray, and a machine is a
   deflector rather than a seal. */
/* THE QUEUE, THE MARK AND THE HEAD ARE ALL MODULE STATE, and the answer is a
   COUNT rather than a view. This runs once per opening per tick and used to
   hand back a fresh subarray built over a fresh closure, which is two objects
   a tick to describe cells that are already sitting in roomQ. */
let roomSeen = null, roomQ = null, roomRing = null, roomPlumeGen = 0;
let roomMark = 0, roomTail = 0;
const roomPush = (j, r) => { roomSeen[j] = roomMark; roomRing[j] = r; roomQ[roomTail++] = j; };
function roomPlume(cells, n){
  const N = GW*GH;
  if(!roomSeen){ roomSeen = new Int32Array(N); roomQ = new Int32Array(N);
                 roomRing = new Int32Array(N); }
  roomMark = ++roomPlumeGen;
  const mark = roomMark;
  // a plume is gas, and blk already refuses a gas-tight cell everywhere else
  const tight = roomGeom().tight;
  let head = 0; roomTail = 0;
  for(const i of cells) if(roomSeen[i] !== mark) roomPush(i, 0);
  while(head < roomTail && roomTail < n){
    const i = roomQ[head++], X = i%GW, Y = (i/GW)|0, r = roomRing[i]+1;
    const ok = j => roomSeen[j]!==mark && !tight[j] && roomTail<n;
    if(Y>0)      { const j=i-GW; if(ok(j)) roomPush(j, r); }
    if(X>0)      { const j=i-1;  if(ok(j)) roomPush(j, r); }
    if(X<GW-1)   { const j=i+1;  if(ok(j)) roomPush(j, r); }
    if(Y<GH-1)   { const j=i+GW; if(ok(j)) roomPush(j, r); }
  }
  return roomTail;
}
// what a kilogram of secondary steam is worth to the room, above ambient
// water: the feed-to-steam rise the shell already charged, plus the feedwater
// it was raised from sitting above the hull outside.
const roomSteamH = () => steamRise() + CP_W*(T_FEED - T_HULL);

/* ══ THE TICK ══
   Sources, transport, sink - in that order, once, explicitly. Nothing here
   writes anything but s.roomT, s.roomH2 and the readouts derived off them;
   Stage 2's damage path is in step.js beside every other consequence. */
function roomStep(s, dt){
  const G = roomGeom(), T = s.roomT, N = roomScratch();
  const src = roomSrc, d = roomD;
  src.fill(0);

  /* ── hot surfaces, and they are TWO-WAY now ──
     Contents -> skin -> air, and every arrow runs both ways: a room hotter
     than a machine heats it, and what the room gets is booked against the pot
     it came out of (s.skinQ, spent at each pot in step.js). A machine that
     moves no heat has no contents term and is pure thermal mass. */
  const live = {};
  for(const q of G.parts){
    const id = q.p.id, n = q.cells.length, Tp = partTemp(s, q.p);
    const proc = Tp !== null && isFinite(Tp);
    live[id] = 1;
    if(s.partT[id] === undefined) s.partT[id] = proc ? Tp : T_HULL;
    const Ts = s.partT[id];
    let air = 0;
    for(const i of q.cells) air += T[i];
    const qProc = proc ? n*ROOM_HK*SKIN_PROC_K*(Tp - Ts) : 0;
    s.skinQ[id] = qProc;
    s.partT[id] = clamp(Ts + (qProc + ROOM_HK*(air - n*Ts))/skinCap(n)*dt,
                        T_SPACE, ROOM_TMAX);
    for(const i of q.cells) src[i] += ROOM_HK*(Ts - T[i]);
  }
  for(const id in s.partT) if(!live[id]){ delete s.partT[id]; delete s.skinQ[id]; }
  /* A RUN HAS A WALL TOO, and the same pot a machine's skin is: the contents
     term is the fluid runFluidT() finds at its live ends, and a run with none
     - shut in, or severed and drained - has no contents term at all and falls
     to the air around it at its own time constant instead of pinning at the
     reactor's mean forever. */
  // one skin per REGION: a lumped run is infinite axial conductance, so a
  // penetration carried a broken compartment's air out through its own wall
  const liveRun = {}, regOf = matRegions().of;
  for(const r of G.runs){
    const seg = {};
    // a cell the wall was painted over is not air, and is in no region
    for(const i of r.cells){ const ri = regOf[i]; if(ri < 0) continue;
      if(!seg[ri]) seg[ri] = []; seg[ri].push(i); }
    const Tf = runFluidT(s, r.key);
    for(const ri in seg){
      const cells = seg[ri], key = r.key+"#"+ri, n = cells.length;
      liveRun[key] = 1;
      if(s.runT[key] === undefined) s.runT[key] = Tf === null ? T_HULL : Tf;
      const Ts = s.runT[key];
      let air = 0;
      for(const i of cells) air += T[i];
      const qProc = Tf === null ? 0 : n*ROOM_HK*SKIN_PROC_K*(Tf - Ts);
      s.runT[key] = clamp(Ts + (qProc + ROOM_HK*(air - n*Ts))/skinCap(n)*dt,
                          T_SPACE, ROOM_TMAX);
      for(const i of cells) src[i] += ROOM_HK*(Ts - T[i]);
    }
  }
  for(const k in s.runT) if(!liveRun[k]) delete s.runT[k];

  /* ── released steam and released water ──
     Every one of these already carried a LOCATION; what they never had was a
     consequence at it. net.fitTarget (pipenet.js) is the gate: it has always
     answered "is there a tank to catch this, or is it going straight into the
     room", and until this field existed that answer bought almost nothing.
     net.fitVentOut is the second gate: caught in a tank, or gone up the stack
     because the valve's open face is against the skin. */
  const cellsOf = id => { const q = G.parts.find(w => w.p.id === id); return q ? q.cells : []; };
  const tgt = (P.net && P.net.fitTarget) || {}, out = (P.net && P.net.fitVentOut) || {};
  for(const fid in s.reliefSteam){
    if(tgt[fid] || out[fid]) continue;               // caught in a tank, or vented outside
    roomJet(src, cellsOf(fid), s.reliefSteam[fid]*roomSteamH(), s.reliefSteam[fid]);
    roomAddGas(s, cellsOf(fid), s.reliefSteam[fid]*dt, s.reliefSteam[fid]);
  }
  /* A HOLE IS NOT A VALVE and has nowhere to be piped. What a shell vented
     past what its own valves passed is a burst shell or a severed steam line,
     and it lands on the generator. IT IS NOT GATED ON fitVentOut EITHER: a
     hole has no set point, no bore and no stack, so gating it here would make
     a plant safe by accident. This one must still cook the room. */
  for(const id in s.sgVentBy){
    let byValve = 0;
    for(const fid of (G.shellValves[id] || [])) byValve += s.reliefSteam[fid] || 0;
    const hole = Math.max(0, s.sgVentBy[id] - byValve);
    roomJet(src, cellsOf(id), hole*roomSteamH(), hole);
    roomAddGas(s, cellsOf(id), hole*dt, hole);
  }
  /* The primary side, as LIQUID: hot water leaving a hole flashes, and it
     mixes with the air where it lands. One conversion out of invRate()'s % of
     loop inventory, the same bridge loopKg() is everywhere else. */
  /* AND IN THE STATE THE OPENING IS ACTUALLY PASSING. s.Tavg is the primary's
     mean, so a reserve tank emptying through a severed line put the reactor's
     heat into the room out of water that never came near it. */
  const kgOf = rate => Math.max(0, rate)/100*loopKg();
  roomLiqOuts(s, G, (cells, rate, fl) => {
    /* A FLUID THAT BURNS KEEPS ITS HEAT. It lands as a pool and gives it up
       through its own surface (roomFireStep), so charging the air the whole of
       it here as well would spend the same joules twice - and it is not a gas
       either: sodium at 723 K is four hundred degrees below its boiling point
       and nothing about a compartment flashes it. */
    if(fl.c.burn) return;
    const kg = kgOf(rate);
    roomJetLiq(src, T, cells, kg, fl.h, fl.c);
    roomAddGas(s, cells, kg*dt, kg);
  });
  roomFireStep(s, dt, G, src);

  /* ── the machines whose whole job is getting heat out of the building ──
     A structure with no network presence at all, the shield/catcher idiom.
     It sits on the main board, so a blackout leaves the room with nothing but
     its hull. */
  if(!s.blackout) for(const q of G.parts){
    if(q.p.role !== "vent" || partWrecked(s, q.p.id)) continue;
    /* Against T_HULL, and that is now a STATED reading rather than a leftover:
       there is no atmosphere to blow this compartment's air into, so the set
       is moving it to the rest of the ship - which sits at what the ship was
       built at - and drawing the same mass back. Vent it overboard instead
       and it is mass loss, which this model does not carry. */
    const ua = ROOM_VENT_KGS*ROOM_CP/q.cells.length;
    for(const i of q.cells) src[i] -= ua*(T[i] - T_HULL);
  }

  /* ── transport ──
     Explicit, four neighbours, one pass over edges. The vertical pair is
     ASYMMETRIC and that is the buoyancy: hot air below pushes up hard, hot
     air above sinks weakly. A symmetric stencil is conduction and has no
     up. */
  for(let i=0;i<N;i++) d[i] = src[i];
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW-1;X++){
    const i = Y*GW+X, q = G.gx[i]*(T[i]-T[i+1]);
    d[i] -= q; d[i+1] += q;
  }
  for(let Y=0;Y<GH-1;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X, j = i+GW, dT = T[j]-T[i];     // j is BELOW i on this grid
    const q = (dT > 0 ? G.gUp[i] : G.gDn[i])*dT;    // positive: heat rising into i
    d[i] += q; d[j] -= q;
  }
  /* ── the sink ──
     THE SKIN RADIATES. It was a Dirichlet clamp at T_HULL - an infinite sink,
     which is the one thing a ship in space has not got. Stefan-Boltzmann, the
     same law and the same T_SPACE the panels use; what makes it FINITE is
     that the only thing feeding it is what the air can conduct to it. Folded
     into the same explicit step as the transport, so the hull is an ordinary
     cell with one extra term rather than a second pass that could disagree
     with it - and the term is stable by a factor of eighteen at dt=0.02 even
     at ROOM_TMAX, where dQ/dT is 4Q/T.
     Floored at T_SPACE, not at T_HULL: a compartment colder than the ship was
     built at is a legal answer now, and a measured one. */
  { const k = HULL_EMIS*SIGMA*HULL_FACE_A/1000;      // kW per K^4 per face
    for(let i=0;i<N;i++) if(G.face[i])
      d[i] -= k*G.face[i]*(Math.pow(T[i],4) - Math.pow(T_SPACE,4)); }
  for(let i=0;i<N;i++) T[i] = clamp(T[i] + d[i]/ROOM_C*dt, T_SPACE, ROOM_TMAX);

  roomH2Step(s, dt, G);
  /* ══ AND THEN WHAT CROSSES A BOUNDARY, AND WHAT THE SHIP LETS GO OF ══
     After the diffusion, because the hole is the ONLY path between two volumes
     and it must see what each of them actually holds this tick. */
  roomCondense(s, dt);
  roomHoleStep(s, dt);
  roomShipLeak(s, dt);

  /* ── the readouts ── */
  { let mx = 0, at = -1;
    for(let i=0;i<N;i++) if(T[i] > mx){ mx = T[i]; at = i; }
    s.roomMax = mx; s.roomMaxAt = at; }
}

/* WHICH CELLS AN OPENING IS AT. s.spillBy is keyed the way netBuild() names
   its break edges - "break:core" is the vessel itself, "break:"+run key is a
   severed run, and only the cells actually cut are open. */
function roomOpenCells(s, G, key){
  { const pid = breakPart(key) || breakCav(key);
    if(pid){ const q = G.parts.find(w => w.p.id === pid); return q ? q.cells : []; } }
  const r = P.net.byKey[key.slice(6)];
  if(!r || !r.cells) return [];
  const out = [];
  for(const [x,y] of r.cells) if(cellBroken(s, x, y)) out.push(y*GW+x);
  /* A WRECKED NOZZLE IS AN OPENING ON THIS RUN TOO. netEdges() hangs one off
     the run's own node for each port, discharging at the PORT's cell and not
     at any pipe cell, and this reader knew only about pipe cells - so a run
     that lost a valve body poured into a compartment that could not name a
     single cell for it, and the heat, the hydrogen and the metal all went
     nowhere. Measured at 128 kg of sodium in 60 s on a BN-600 pipe burst,
     where the blast off the first flash wrecked two nozzles elsewhere. */
  for(const pid of [r.pa, r.pb]){
    if(!pid || !portWrecked(s, pid)) continue;
    const c = portCell(pid);
    if(c) out.push(c[1]*GW+c[0]);
  }
  return out;
}

/* ══ HYDROGEN ══
   s.h2 has been produced by the oxidation path since it existed and consumed
   by nothing - three readouts and an alarm whose own text says out loud that
   it is not modelled as burning. It leaves with the escaping steam, at the
   same openings that already carry a location, and then it is a gas in a room
   with a temperature: past the lower flammability limit and past
   auto-ignition it deflagrates. This is TMI-2 and Fukushima.

   All three figures are published: 4 vol% is hydrogen's LFL in air, 773 K its
   auto-ignition temperature, 120 MJ/kg its lower heating value. The one thing
   NOT published is ROOM_DEPTH, which sets the air a cell holds and therefore
   every concentration here - see its own note above. */
const H2_LFL = 0.04;                      // volume fraction in air
/* THE UPPER limit, and it is the half nobody expects: a cell of nearly pure
   hydrogen is the SAFE one, because there is no air left in it to burn. It
   used to light at any fraction above the LFL, so the richest cell of a
   release - the one at the opening - was also the most violent, which is
   backwards. */
const H2_UFL = 0.75;
const H2_IGN = 773;                       // K
const H2_LHV = 120000;                    // kJ/kg
const H2_MMOL = 0.002016, AIR_MMOL = 0.02896;   // kg/mol
// kg in ONE tick's deflagration worth writing a log line about - see the
// caller in step.js for why a steady flame at the limit is a tile, not a line
const H2_BURN_EV = 1.0;
// moles of air in one cell - the denominator every concentration divides by
const ROOM_MOL = MPC*MPC*ROOM_DEPTH*ROOM_RHO/AIR_MMOL;

/* OXYGEN IS A FIELD, AND IT IS THE HONEST ANSWER TO "HOW VIOLENTLY".
   s.roomO2 is s.roomH2's exact shape and idiom - kilograms per cell, on S,
   refilled never rebuilt - and it deletes the alternative, which was a
   violence curve somebody picked. Combustion is capped at 2 H2 : 1 O2, so a
   rich cell burns weakly because there is no air in it, the peak lands at
   29.6 vol% on its own arithmetic with no constant naming it, and a sealed
   corner smothers its own fire, which is a real thing that happens in real
   compartments. It diffuses on the same stencil with NO buoyancy bias: O2 is
   32 against air's 29 and goes nowhere in particular. */
const O2_FRAC0 = 0.2095;                  // volume fraction of dry air
const O2_MMOL = 0.032;                    // kg/mol
const O2_LOC = 0.05;                      // limiting oxygen concentration for H2 in air
// kg of O2 one cell holds at ambient, and what the ventilation set puts back
const ROOM_O2_0 = O2_FRAC0*ROOM_MOL*O2_MMOL;
// kg of oxygen a kilogram of hydrogen wants: 2 H2 + O2 -> 2 H2O, arithmetic
const O2_PER_H2 = O2_MMOL/(2*H2_MMOL);
/* HYDROGEN'S OWN BUOYANCY, against air's ROOM_UP = 3.0. It is fourteen times
   lighter than air, so it collects at the DECKHEAD - which is where it
   exploded at Fukushima and where it exploded at TMI-2 - and sharing hot
   air's bias put the gas where the heat was instead. The molar mass ratio IS
   the bias rather than a second typed number. Checked against the explicit
   stability cap: (2+up+1)*ROOM_MIX/MPC^2*dt < 1 allows about 28 at dt=0.02
   and this is 14.4, so there is a factor of two in hand. If it ever wants
   more, SUBSTEP it - the rule ROOM_MIX already carries. */
const H2_UP = AIR_MMOL/H2_MMOL;

/* THE FLAME IS A FRONT, NOT A FLOOD FILL.
   H2_SL is the laminar burning velocity against hydrogen fraction,
   published, and it IS the "how easily and how violently" axis the whole
   feature is about: a cell is MPC = 0.467 m, so a limit mixture takes about
   nine seconds to cross one and a stoichiometric one takes a sixth of a
   second. A lean charge crawls and is harmless; a near-stoichiometric charge
   runs and wrecks the plant. Nothing decides which - the mixture does. */
const H2_SL = [[0.04,0.05],[0.10,0.40],[0.20,1.30],[0.30,2.60],
               [0.40,3.00],[0.60,1.60],[0.75,0.30]];
function h2Sl(f){
  if(f <= H2_SL[0][0] || f >= H2_SL[H2_SL.length-1][0]) return 0;
  for(let k=1;k<H2_SL.length;k++){ const x1 = H2_SL[k][0], y1 = H2_SL[k][1],
                                   x0 = H2_SL[k-1][0], y0 = H2_SL[k-1][1];
    if(f <= x1) return y0 + (y1-y0)*(f-x0)/(x1-x0); }
  return 0;
}
/* BOUGHT, AND IT SAYS SO. What a laminar velocity cannot express is
   obstacle-generated turbulence, which is the mechanism that takes a real
   compartment deflagration towards detonation. Applied off the occ array in
   roomGeom(), so a cluttered plant accelerates its own flame. */
const H2_TURB = 4;
/* AND OVERPRESSURE IS WHAT ACTUALLY BREAKS THINGS.
   Constant-volume combustion off the SAME q the heat term uses, so the two
   cannot disagree about how big the bang was. There is no detonation switch
   and there must not be one: deflagration and detonation are the two ends of
   one axis here - burning velocity against relief time - and a stoichiometric
   cell lands near the real adiabatic isochoric figure while a limit mixture
   lands nowhere at all.
   ROOM_P_TAU is BOUGHT, the CAV_SPAN idiom: how fast the compartment relieves
   itself, and the entire reason a slow flame is harmless and a fast one is
   not. It and H2_TURB are the two numbers to hold still while measuring
   anything else. */
const ROOM_P0 = 101.3;                    // kPa, ambient
const ROOM_P_TAU = 0.5;                   // s

/* WHETHER A CELL CAN BURN AT ALL - three tests, read off the same
   roomH2Frac() the layer draws, so a cell cannot draw as safe and burn. */
const roomFlamOf = (f,fo2) => f >= H2_LFL && f <= H2_UFL && fo2 >= O2_LOC;
const roomFlam = (s,i) => roomFlamOf(roomH2Frac(s,i), roomO2Frac(s,i));
/* ══ WHAT THE FRONT IS BURNING INTO IS NOT THE CELL AVERAGE ══
   A cell is 0.467 m and a front takes real time to cross one, so while it is
   crossing, part of the cell is burnt and part is untouched - and the gas
   AHEAD of the front is still at the mixture that lit. Averaging the two
   diluted the unburnt gas with its own exhaust: a cell dropped below the
   flammable limit halfway through its own passage, the flame went out before
   the front ever reached the far face, and the neighbours were never lit. It
   made every cloud burn ONE CELL and stop - a 30 % charge, the one that is
   supposed to wreck the compartment, peaked at 398 kPa in a single cell and
   went out. Measured, not guessed.
   The unburnt share is (1 - roomFlame), and the fuel that is left is in it, so
   the mixture there follows for free with no second field to carry. Floored,
   because the last sliver of a spent cell is arithmetically pure hydrogen and
   would quench itself on the RICH limit instead of simply running out. */
const ROOM_FR_MIN = 0.1;
const roomFrontU = (s,i) => Math.max(ROOM_FR_MIN, 1 - s.roomFlame[i]);
const roomFrontFrac = (s,i) => { const n = s.roomH2[i]/H2_MMOL;
  return n > 0 ? n/(ROOM_MOL*roomFrontU(s,i) + n) : 0; };
const roomFrontO2 = (s,i) => s.roomO2[i]/O2_MMOL
  /(ROOM_MOL*roomFrontU(s,i) + s.roomH2[i]/H2_MMOL);
// and the same three tests against it - the continuation test, where roomFlam()
// is the IGNITION test and a cell that has not lit yet answers both the same
const roomFlamFront = (s,i) => roomFlamOf(roomFrontFrac(s,i), roomFrontO2(s,i));
/* WHAT LIGHTS IT - three sources, ONE predicate. The middle one closes a real
   hole: air at 500 K standing against a 900 K generator shell did not light
   before, and the metal is what the gas actually touches. The third is a
   wrecked box sparking, at ANY temperature. partSkin() is already the one
   door the damage integral reads. */
function roomIgnites(s, G, i){
  if(s.roomT[i] >= H2_IGN) return true;
  const k = G.own[i];
  if(k < 0) return false;
  const p = G.parts[k].p;
  return partSkin(s, p) >= H2_IGN || partWrecked(s, p.id);
}

/* ══ A COOLANT THAT IS ALSO A FUEL ══
   The compartment already had every consequence of a fire - flammability
   limits, oxygen per cell, oxygen depletion, a burning velocity, the blast
   term - and one fuel. Sodium is the everyday accident an SFR is built
   around: any burst pipe reaches it, where the water plant needs a melted
   core first.

   It is NOT the hydrogen mechanism with a second gas in it. Hydrogen is a
   premixed cloud and burns as a FRONT crossing cells; a metal fire is a
   surface, sitting where it fell, burning at a rate its own area and the
   oxygen over it set. So this is a pool with a mass and a temperature, and
   the ONE thing the two share is the joule: both land in roomH2Step's q, so
   the fire and the bang cannot disagree about how big it was.

   THE POOL CARRIES ITS OWN TEMPERATURE, and that is what an ignition test
   costs. Without it every spill burns for ever: a pool that has given its
   heat up, or frozen on a cold deck, is inert, and freezing is the reason a
   sodium line is trace-heated in the first place. Energy is the state rather
   than temperature so that two spills can be added, with the datum at LIQUID
   AT THE MELTING POINT - negative energy is then exactly the latent heat of
   fusion, and a pool sits at 371 K while it freezes instead of falling
   through it.

   WHERE THE HEAT GOES IS NOT A SPLIT SOMEBODY PICKED. Combustion happens at
   the surface, so all of it lands in the pool, and the pool loses it by
   convection and radiation like any other hot thing. The burning temperature
   then falls out: 123 kW/m2 against an emissivity of 0.8 settles near 1250 K,
   and the published range for a sodium pool fire is 900-1200 K. Nothing here
   types that number.

   FIGURES. lhv is the heat of formation of Na2O2, 510.9 kJ/mol over the
   45.98 g of sodium in it = 11 111 kJ/kg, and o2 is the same reaction's
   31.998/45.98. The peroxide is the oxygen-rich product and a pool fire in
   air makes it; the monoxide route is 9 010 kJ/kg and 0.348, so the choice is
   worth about 20 %. melt, boil and lf are published. rate is 40 kg/m2/h, the
   middle of a published 25-50 band, and it is the one number that sets how
   long a fire lasts. ign 400 K is a pool just above its melting point; the
   published band runs to 600 K for an undisturbed surface, so this is the
   eager end. loc is the oxygen a sodium fire dies below, and it is what
   inerting a compartment would have to reach.

   There is no density here. The pool is the same substance the circuit was
   carrying, so it weighs what that row says it weighs (fireRho()) - the same
   argument cp makes below. */
const FIRE = {
  NA:{ lhv:11111, o2:0.6959, ign:400, melt:371, boil:1156, lf:113,
       rate:0.011111, loc:0.05, emis:0.80, hConv:0.010, sigma:0.180, eta:0.40 },
};
const FIRE_KEYS = Object.keys(FIRE);
// kg of metal in ONE passage worth a log line - H2_BURN_EV's job, its own
// number because a kilogram of sodium is not a kilogram of hydrogen
const FIRE_EV_KG = 1.0;
// ONE pool field, so ONE fuel: a second FIRE row wants a fuel key per cell
const fireRow = () => FIRE[FIRE_KEYS[0]];
/* The pool is the same substance the circuit was carrying, so what it weighs
   and what it holds are that fluid's own columns and never a second copy of
   them here - `dens` on the scale RHO_K turns into kg/m3, `cp` as it stands. */
let fireCoolRow = null;
const fireCool = () => fireCoolRow
  || (fireCoolRow = COOLANT.filter(a => a.burn === FIRE_KEYS[0])[0] || null);
const fireCp  = () => { const a = fireCool(); return a ? a.cp : 1; };
const fireRho = () => { const a = fireCool(); return a ? a.dens*RHO_K : 1000; };
/* HOW DEEP A SPREADING POOL GETS. BOUGHT: a liquid metal running out over
   steel stops at a few millimetres, and this is the only thing that keeps a
   gram of sodium from burning over a whole 0.218 m2 cell. Above about 1.8 kg
   a cell is covered and the figure stops mattering at all. */
const POOL_DMIN = 0.01;                   // metres
/* ══ AND IT RUNS ══
   A pool does not stay in the cells the hole was pointing at. It falls to the
   deck and it spreads out along it, and both of those decide the ONE thing
   that sets how fast a metal fire burns - how much surface it has. Fourteen
   tonnes left where it landed stood thirteen metres deep in six cells and
   burned at the rate a puddle would; the same metal on the deck is twenty
   cells of free surface. It is also where the fire IS, which a leak at the
   top of a bay gets wrong in the other direction.
   A cell holds ROOM_VCELL of metal and no more, so a deep spill stacks, and
   only the cell with nothing on top of it has a surface to burn from.
   POOL_SPREAD is BOUGHT: it is how fast it levels, and a metal running out
   over steel crosses a 0.467 m cell in a fraction of a second, so anything
   above about 2/s is the same picture one tick later. */
const POOL_SPREAD = 5;                    // per second
let poolDM = null, poolDE = null;
function poolFlow(s, dt, G){
  const M = s.roomPool, E = s.roomPoolE, N = GW*GH;
  const cap = ROOM_VCELL*fireRho(), k = Math.min(1, POOL_SPREAD*dt);
  if(!poolDM || poolDM.length !== N){ poolDM = new Float64Array(N); poolDE = new Float64Array(N); }
  poolDM.fill(0); poolDE.fill(0);
  /* A wall or a machine box is a floor, not a hole. Only the TARGET is asked:
     metal already standing in a machine's own cells - which is where a wrecked
     machine puts it - still has to be able to run out of them. */
  const shut = j => G.tight[j] || G.occ[j];
  // fluxes off the SAME field, so no cell is drained by a neighbour that has
  // already been visited and the answer does not depend on the sweep order
  const move = (i, j, want) => { const take = Math.min(want, M[i], cap - M[j]);
    if(!(take > 0)) return;
    const e = E[i]*take/M[i];
    poolDM[i] -= take; poolDE[i] -= e; poolDM[j] += take; poolDE[j] += e; };
  for(let Y=0;Y<GH-1;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X, j = i+GW;                       // j is BELOW i on this grid
    if(M[i] > 0 && !shut(j)) move(i, j, M[i]*k);
  }
  /* SIDEWAYS ONLY WHILE IT IS DEEPER THAN IT WANTS TO BE. Levelling on the
     difference alone has no stopping point, so a tonne of metal ended up as a
     gram in every cell of the bay - and a gram is not a pool. POOL_DMIN is
     where it stops, which is the same figure the burning area already uses. */
  const dmin = cap*POOL_DMIN/ROOM_DEPTH;
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW-1;X++){
    const i = Y*GW+X, j = i+1, d = (M[i] - M[j])/2;
    if(d > 0){ if(!shut(j) && M[i] > dmin) move(i, j, Math.min(d, M[i]-dmin)*k); }
    else if(d < 0 && !shut(i) && M[j] > dmin) move(j, i, Math.min(-d, M[j]-dmin)*k);
  }
  for(let i=0;i<N;i++){ M[i] += poolDM[i]; E[i] += poolDE[i];
    if(M[i] <= 0){ M[i] = 0; E[i] = 0; } }
}
/* ══ AND A LEAK THAT ATOMISES IS A DIFFERENT FIRE ══
   A pool fire is slow and a SPRAY fire is not: the jet breaks into droplets,
   the surface area goes up by orders of magnitude, and the charge burns in
   flight in seconds instead of minutes. It is the accident that pressurises a
   cell, and it is why this is a fire and not just a hot puddle.
   WHAT DECIDES IT IS THE JET, not a switch. The gas Weber number
   We = rho_air*v^2*d/sigma is the published breakup criterion: below 13 the
   jet stays a column, above 40.3 it is in the atomisation regime, and between
   them it is shedding. The velocity is the hole's own sqrt(2*dp/rho) and d is
   the bore, so a wide tear at 0.2 MPa dribbles and a small hole sprays -
   which is the real and unhelpful shape of it.
   eta is what fraction of the atomised metal burns BEFORE it lands. BOUGHT,
   and the softest number here: spray fire tests report 20-60 % and this is
   0.40. It scales the violence of the fast fire directly. */
const SPRAY_WE0 = 13, SPRAY_WE1 = 40.3;
/* Pool temperature off its own energy. Liquid above the datum, pinned at the
   melting point while the latent heat comes out, solid below that. */
function poolT(m, E){
  if(!(m > 0)) return T_HULL;
  const f = fireRow(), cp = fireCp(), eF = -m*f.lf;
  if(E >= 0) return f.melt + E/(m*cp);
  return E > eF ? f.melt : f.melt + (E - eF)/(m*cp);
}
const roomPoolT = (s,i) => poolT(s.roomPool[i], s.roomPoolE[i]);
// the same three tests the burn takes, so a cell cannot draw cold and burn
const roomPoolLit = (s,i) => { const f = fireRow();
  return s.roomPool[i] > 0 && (i < GW || !(s.roomPool[i-GW] > 0))
      && roomPoolT(s,i) >= f.ign && roomO2Frac(s,i) >= f.loc; };
// what the metal put into the air THIS tick, kJ per cell - read by the one q
let fireQ = null;

function roomFireStep(s, dt, G, src){
  const N = GW*GH, f = fireRow(), cp = fireCp();
  const M = s.roomPool, E = s.roomPoolE, O = s.roomO2, T = s.roomT;
  if(!fireQ || fireQ.length !== N) fireQ = new Float64Array(N);
  fireQ.fill(0);
  s.roomFireOn = 0;
  if(!fireCool()) return;
  // the compartment's own pressure is a whole-grid pass, and the spray is the
  // only thing here that wants it - asked once, and only if metal is arriving
  let gz = null, on = 0;
  /* ══ WHAT ARRIVES, AND WHETHER IT ARRIVES AS A SPRAY ══ */
  roomLiqOuts(s, G, (cells, rate, fl, key) => {
    const row = fl.c.burn && FIRE[fl.c.burn];
    if(!row || !cells.length) return;
    /* THE KILOGRAMS THE TRANSPORT BOOKED, never the solve's rate. Everything
       else the room reads off an opening is a rate on a plume, and a few per
       cent either way is a picture; this is a MASS that then sits on the deck
       and has to be the same mass that left the loop. */
    const kg = advectOutKg[key] || 0;
    if(!(kg > 0)) return;
    if(!gz) gz = roomPGauge(s);
    const pN = netPAt(s, fl.nd)*1e6, pR = (ROOM_P0 + gz[cells[0]])*1000;
    const v = Math.sqrt(2*Math.max(0, pN - pR)/fireRho());
    const d = openBoreM(key);
    const we = ROOM_RHO*v*v*d/row.sigma;
    const frac = d > 0 ? clamp((we - SPRAY_WE0)/(SPRAY_WE1 - SPRAY_WE0), 0, 1) : 0;
    /* THE IGNITION TEST ON THE METAL ITSELF, at the temperature it is leaving
       at. A loop that has been shut down and cooled sprays cold sodium and
       nothing happens; that is the same test the pool takes. */
    const Tin = tOfH(fl.c, netPAt(s, fl.nd), fl.h);
    const want = Tin >= row.ign ? kg*frac*row.eta : 0;
    let burnt = 0;
    if(want > 0) roomShare(cells, kg/dt, (i, sh) => {
      const m = Math.min(want*sh, O[i]/row.o2);
      if(!(m > 0)) return;
      O[i] -= m*row.o2;
      // its combustion AND the heat it was already carrying: this mass never
      // reaches the deck, so the pool below never gets to give either up
      fireQ[i] += m*(row.lhv + cp*(Tin - row.melt));
      burnt += m; on++;
    });
    s.fireEv.kg += burnt;
    // ...and everything that did not burn in flight is on the deck. Split over
    // the opening's own cells and not over a plume: a liquid falls.
    const per = (kg - burnt)/cells.length;
    if(per > 0) for(const i of cells){ M[i] += per; E[i] += per*cp*(Tin - row.melt); }
  });
  /* ══ AND WHAT IS ALREADY ON THE DECK ══ */
  poolFlow(s, dt, G);
  const A0 = MPC*MPC;
  for(let i=0;i<N;i++){
    let m = M[i];
    if(!(m > 0)) continue;
    /* THE SURFACE OF A DEEP POOL IS THE WHOLE CELL. Only the metal in this
       cell says how far a FILM has spread; metal standing on more metal is
       floating on it and covers the lot, so the column is what the area asks.
       One cell down is enough - a full one saturates this on its own. */
    const A = Math.min(A0, (m + (i+GW < N ? M[i+GW] : 0))/(fireRho()*POOL_DMIN));
    let Tp = poolT(m, E[i]);
    const fo2 = roomO2Frac(s, i);
    // ONLY THE FREE SURFACE BURNS. Metal with more metal standing on it is
    // under the pool, not on it, and a stack is one fire and not three.
    const open = i < GW || !(M[i-GW] > 0);
    if(open && Tp >= f.ign && fo2 >= f.loc){
      /* Diffusion-limited, so the published rate is the rate IN AIR and it
         falls with the oxygen over it - which is what makes a sealed bay
         smother a metal fire the way it already smothers a gas one. */
      const mb = Math.min(f.rate*(fo2/O2_FRAC0)*A*dt, m, O[i]/f.o2);
      if(mb > 0){
        M[i] = m = m - mb;
        O[i] -= mb*f.o2;
        // the heat is released at the surface, into the pool; the metal that
        // burnt leaves and takes its own sensible heat with it
        E[i] += mb*f.lhv - mb*cp*(Tp - f.melt);
        s.fireEv.kg += mb;
        on++;
      }
    }
    if(!(m > 0)){ M[i] = 0; E[i] = 0; continue; }
    Tp = poolT(m, E[i]);
    let q = (f.hConv*(Tp - T[i])
             + f.emis*SIGMA*(Math.pow(Tp,4) - Math.pow(T[i],4))/1000)*A;     // kW
    /* AND IT MAY NOT DRIVE ITSELF PAST THE AIR - advectSrc()'s rule, and for
       the same reason: a film on top of a full cell radiates over the whole
       footprint with almost no heat capacity behind it, so an uncapped
       explicit source sends it hundreds of kelvin below the room in one tick,
       and the fourth power then takes it to NaN. */
    const qCap = m*cp*(Tp - T[i])/dt;
    q = q > 0 ? Math.min(q, Math.max(0, qCap)) : Math.max(q, Math.min(0, qCap));
    E[i] -= q*dt; src[i] += q;
    /* IT MAY NOT GO PAST ITS OWN BOILING POINT. Past it the metal leaves the
       pool as vapour and burns above it, which this model does not carry as a
       phase - so the energy goes straight into the air instead, where the
       vapour fire would have put it. Capping the temperature and dropping the
       joules would have made a hot fire cheaper than a cool one. */
    const eMax = m*cp*(f.boil - f.melt);
    if(E[i] > eMax){ src[i] += (E[i] - eMax)/dt; E[i] = eMax; }
  }
  s.roomFireOn = on;
}

function roomH2Step(s, dt, G){
  const N = GW*GH, H = s.roomH2, O = s.roomO2, Fl = s.roomFlame, Pr = s.roomP;
  const T = s.roomT, Pk = s.roomPPk;
  /* ══ WHAT EACH VOLUME IS AT, BEFORE ANYTHING BURNS IN IT ══
     A closed volume holding a mass of gas at a temperature is at a pressure,
     and that is the compartment's own figure - the one a containment holds and
     a breach lets out. Read off the real kilograms (roomPOf()), so a discharge
     raises it because the steam is really in there and a hole lowers it because
     the gas really left. It was read off temperature alone, which could not
     fall when anything escaped. The BLAST below rides on top of it. */
  const pGauge = roomPGauge(s);
  s.roomBurnOn = 0;
  /* IT LEAVES THROUGH THE HOLE IT IS AT. Hydrogen is a species the transport
     carries (s.h2By, advectStep), so what comes out of an opening this tick
     is that node's own concentration on what that hole actually passed -
     advectH2Out, by edge key - and a hole at the top of the loop vents what
     has collected there. The field has already lost it; nothing here debits
     s.h2. */
  if(s.h2 > 0){
    const H2OUT = advectH2Out;
    const put = (cells, rate, key) => {
      const m = H2OUT[key];
      if(!(m > 0) || !cells.length) return;
      // the same plume the heat went into, off the same opening at the same rate
      roomSpread(H, cells, Math.max(0, rate)/100*loopKg(), m);
    };
    roomLiqOuts(s, G, (cells, rate, fl, key) => put(cells, rate, key));
  }
  /* THE VENTILATION SET EXCHANGES GAS, NOT JUST HEAT. Its own comment already
     said it moves compartment air against the rest of the ship rather than
     dumping it overboard, so it carries the gas both ways: hydrogen out,
     oxygen back in, at the same rate expression the heat term uses. With the
     hull sealed this is the ONLY removal path that is not a fire, which is
     what finally prices the fan - a second job that is not a temperature. */
  if(!s.blackout) for(const q of G.parts){
    if(q.p.role !== "vent" || partWrecked(s, q.p.id)) continue;
    const f = Math.min(1, ROOM_VENT_KGS/q.cells.length/ROOM_MAIR*dt);
    // ...and the AIR with them: a fan that exchanges gas exchanges its mass,
    // so a set running in a pressurised compartment brings it back down
    for(const i of q.cells){ H[i] -= H[i]*f; O[i] += (ROOM_O2_0 - O[i])*f;
      s.roomM[i] += (ROOM_MAIR - s.roomM[i])*f; }
  }
  /* and it is a gas in a room.
     ONE stencil, two biases. Hydrogen carries its own H2_UP and collects at
     the deckhead; oxygen is heavier than air by a hair and carries none. */
  roomDiffuse(H, G, dt, H2_UP);
  roomDiffuse(O, G, dt, 1);

  /* DEFLAGRATION.
     s.roomFlame is how far the front has crossed each cell, 0..1, the s.nDmg
     idiom: on S, monotonic through one passage, cleared when the cell is
     spent. A cell lights when it is flammable and something ignites it, it
     advances at its own mixture's burning velocity times what the clutter
     around it does, it consumes hydrogen and oxygen in proportion to that
     advance, and it lights its flammable neighbours once the front has
     crossed. Nothing latches: the flame dies where fuel or oxygen leaves the
     window. At the limit this is the standing diffusion flame the old flood
     fill produced, which is a tile and not a log line. */
  for(let i=0;i<N;i++)
    if(Fl[i] <= 0 && H[i] > 0 && roomFlam(s,i) && roomIgnites(s,G,i)) Fl[i] = 1e-6;
  let burned = 0, on = 0, pmax = 0;
  for(let i=0;i<N;i++){
    let q = 0;
    if(Fl[i] > 0){
      if(!roomFlamFront(s,i)) Fl[i] = 0;
      else {
        const adv = Math.min(1, h2Sl(roomFrontFrac(s,i))*G.turb[i]*dt/MPC);
        /* THE ADVANCE CONSUMES THE DEFICIENT REACTANT, not the fuel with the
           oxygen clamped on afterwards. Written the other way round first,
           and it put the peak in the wrong place: a rich cell burnt a
           fraction of a bigger charge and so released MORE per tick than a
           stoichiometric one, which is backwards. This way the peak lands at
           29.6 vol% on its own arithmetic and nothing names it. */
        const m = Math.min(H[i], O[i]/O2_PER_H2)*adv;
        if(m > 0){
          H[i] -= m; O[i] -= m*O2_PER_H2;
          burned += m; q = m*H2_LHV;
        }
        const nf = Math.min(1, Fl[i] + adv);
        if(nf >= 1 && Fl[i] < 1){
          const X = i%GW, Y = (i/GW)|0;
          const nb = [];
          if(X>0) nb.push(i-1); if(X<GW-1) nb.push(i+1);
          if(Y>0) nb.push(i-GW); if(Y<GH-1) nb.push(i+GW);
          for(const j of nb) if(Fl[j] <= 0 && roomFlam(s,j)) Fl[j] = 1e-6;
        }
        Fl[i] = nf;
        on++;
      }
    }
    /* ONE q, TWO FUELS. The metal fire's fast half (roomFireStep, what burnt
       in flight before it landed) joins the deflagration here and nowhere
       else, so both heat the same air and raise the same pressure by the same
       expression. Its SLOW half is not here: a pool giving its heat up over
       minutes is an ordinary source and went into src[] with the steam jets.
       THE BURN HEATS THE CELL'S OWN AIR AT cv - see ROOM_CVAIR's note. A
       deflagration is over before the steel knows about it. */
    if(fireQ && fireQ[i] > 0) q += fireQ[i];
    if(q > 0) T[i] = Math.min(ROOM_TMAX, T[i] + q/ROOM_CVAIR);
    /* dP/dt = P0*(q/CAIR)/T_HULL - P/tau: the gas law at constant volume
       against a compartment that leaks, off the SAME q the heat term spent so
       the two cannot disagree about how big the bang was. The denominator is
       AMBIENT and not the cell's running temperature: P0/T_HULL is rho*R, so
       this expression is identically (gamma-1)*q/V and constant-volume
       pressure rise has no temperature in it at all. Divide by the live T
       instead and the sum telescopes to a logarithm - the second half of a
       burn is priced cheaper than the first, and a stoichiometric cell lands
       at 96 kPa where the real adiabatic isochoric figure is eight times
       ambient. Every cell relieves whether it burned or not. */
    /* ══ AND IT RELAXES TOWARD THE COMPARTMENT, NOT TOWARD ZERO ══
       ROOM_P_TAU is the half second a compartment takes to relieve a BANG. It
       was applied to the whole of Pr, which was fine while a bang was the only
       thing that ever wrote it - and wrong the moment the volume's own static
       pressure was written here too, because then the static part decayed as
       well: a four-hole breach and a ten-hole breach both read the half-second
       tail of whatever the pressure WAS instead of what the volume is at now.
       Only the EXCESS over the compartment's own pressure is a transient, so
       only the excess relaxes. */
    const gz = pGauge[i];
    const p = Pr[i] + (q > 0 ? ROOM_P0*(q/ROOM_CVAIR)/T_HULL : 0)
              - Math.max(0, Pr[i]-gz)/ROOM_P_TAU*dt;
    Pr[i] = Math.max(gz, p > 0 ? p : 0);
    if(Pr[i]-gz > pmax) pmax = Pr[i]-gz;      // the bang is the excess over what the volume holds on its own
    /* AND THE MARK IT LEAVES. The pressure itself is gone in half a second,
       so the only record of where a bay was blown apart was the damage list -
       which names machines and cannot say that bare deck was in the wave.
       Monotonic, on S rather than in the renderer, because "this compartment
       has been blown up" is a fact about the run: it saves, it loads, and a
       replay lands on the same battlefield. */
    if(Pr[i] > Pk[i]) Pk[i] = Pr[i];
  }
  s.roomBurnOn = on; s.roomPMax = pmax;
  if(s.roomFireOn && pmax > s.fireEv.p) s.fireEv.p = pmax;
  /* ONE EVENT PER EXPLOSION. A front crawling at 0.05 m/s never trips a
     per-tick gate, so the charge is accumulated while anything is burning and
     step.js writes the line when the last flame goes out. */
  if(burned > 0 || on){ s.burnEv.kg += burned;
    if(pmax > s.burnEv.p) s.burnEv.p = pmax; }
}

/* ONE STENCIL, TWO GASES. The heat pass above walks it inline because it also
   carries the sources; this is the same walk for a field that has none, and
   writing it twice is how the two would start disagreeing about which way is
   up. The BIAS is an argument, so hydrogen and oxygen share the walk and
   still rise at their own rates. Conserving, and CLOSED: nothing leaves the
   grid at all, because the skin is sealed metal. */
function roomDiffuse(F, G, dt, up){
  const N = roomScratch(), d = roomD2;
  d.fill(0);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW-1;X++){
    const i = Y*GW+X, q = G.gx[i]*(F[i]-F[i+1])/ROOM_C;
    d[i] -= q; d[i+1] += q;
  }
  for(let Y=0;Y<GH-1;Y++) for(let X=0;X<GW;X++){
    /* A DRIFT, NOT A FASTER DIFFUSION. The heat pass above switches the
       conductance on the SIGN of the difference, which makes a hot cell empty
       upward quickly - but its equilibrium is still flat, because the flux
       vanishes when the difference does. Written that way first and measured:
       a charge released at the deck was uniform over all 34 rows in 60 s,
       where the whole claim is that hydrogen collects under the DECKHEAD and
       stays there. Priced off the amount in each cell rather than off the
       difference, the flux vanishes at F[i] = up*F[j] instead - an
       exponential profile with a scale height, which is what a light gas in a
       compartment actually does. up = 1 is exactly the old symmetric pass, so
       oxygen is untouched. j is BELOW i on this grid. */
    const i = Y*GW+X, j = i+GW;
    const q = G.gDn[i]*(up*F[j] - F[i])/ROOM_C;
    d[i] += q; d[j] -= q;
  }
  for(let i=0;i<N;i++) F[i] = Math.max(0, F[i] + d[i]*dt);
  /* THE HULL IS SEALED. `if(G.hull[i]) F[i] = 0` stood here and was correct
     while the ring was a Dirichlet clamp at ambient - but the skin RADIATES
     now, and it is metal. Hydrogen was escaping to space through an intact
     wall and could never accumulate. The stencil is edge-based and already
     conserving, so no-flux is the default and nothing replaces the line. */
}

/* ══ THE VOLUMES, THEIR PRESSURES, AND WHAT CROSSES BETWEEN THEM ══
   The fill (matRegions(), paint.js) already says which cells are one connected
   gas volume. Within a volume pressure equalises far faster than a tick - that
   is what "one compartment" means - so each is LUMPED: one mass, one mean
   temperature, one pressure. Between volumes there is nothing at all unless a
   wall has been opened, and then there is exactly the orifice matHoles() found.
   THIS IS WHY IT IS NOT A FACE-BY-FACE SOLVER. Sound crosses a 0.467 m cell in
   1.4 ms against a 20 ms tick, so an explicit acoustic pass over every face is
   unstable by a factor of fifteen and would buy nothing: the answer it would
   converge to is the lumped one. */
let ROOM_VOL_SCR = null;
const roomVolScr = n => { let z = ROOM_VOL_SCR;
  if(!z || z.M.length !== n) z = ROOM_VOL_SCR = {M:new Float64Array(n), V:new Float64Array(n), MT:new Float64Array(n), T:new Float64Array(n), P:new Float64Array(n), RHO:new Float64Array(n)};
  z.M.fill(0); z.V.fill(0); z.MT.fill(0); return z; };
function roomVols(s){
  const R = matRegions(), n = R.regions.length;
  const Z = roomVolScr(n), M = Z.M, V = Z.V, MT = Z.MT;
  for(let i=0;i<GW*GH;i++){ const r = R.of[i]; if(r<0) continue;
    const m = s.roomM[i];
    M[r] += m; V[r] += ROOM_VCELL; MT[r] += m*s.roomT[i]; }
  const T = Z.T, P = Z.P, RHO = Z.RHO;
  for(let r=0;r<n;r++){
    T[r] = M[r] > 0 ? MT[r]/M[r] : T_HULL;
    RHO[r] = V[r] > 0 ? M[r]/V[r] : ROOM_RHO;
    P[r] = roomPOf(M[r], V[r], T[r]);
  }
  return {R, n, M, V, T, P, RHO};
}
// kPa above ambient in every cell, off its own volume's mass and temperature -
// one array, so the burn term and the damage sweeps read the same figure
let pGaugeScr = null;
function roomPGauge(s){
  const q = roomVols(s), N = GW*GH;
  const g = (pGaugeScr && pGaugeScr.length === N) ? pGaugeScr.fill(0) : (pGaugeScr = new Float64Array(N));
  for(let i=0;i<N;i++){ const r = q.R.of[i]; if(r<0) continue;
    g[i] = Math.max(0, (q.P[r] - ROOM_P0/1000)*1000); }
  return g;
}
/* ══ AND THE STEAM CONDENSES, WHICH IS WHAT ACTUALLY HOLDS A CONTAINMENT DOWN ══
   Without this a compartment is a bottle: every kilogram a break puts into it
   stays a gas forever, and a full-bore cold-leg break inside a 556 m3 region
   reached 2 MPa and demolished its own wall - measured. A real containment's
   pressure is limited by CONDENSATION, on its cold structure and in its pool,
   and that is the whole reason a suppression pool exists.
   The compartment is dry air plus vapour. The air is what it always held and
   does not condense; the vapour cannot exceed its own saturation partial
   pressure at the air's temperature, and what will not stay a gas becomes
   water on the floor - so it goes into the SUMP, which is the book that already
   holds standing water and already closes. Instant, not on a time constant:
   condensing on a cold wall is fast against a tick, and any lag here would be a
   fitted number standing in for a surface area nobody has drawn.
   R_VAP is water's own specific gas constant, published. */
const R_VAP = 0.0004615;                  // MPa*m3/(kg*K)
function roomCondense(s, dt){
  const q = roomVols(s);
  for(let r=0;r<q.n;r++){
    const g = q.R.regions[r], n = g.cells.length;
    const air = ROOM_MAIR*n;
    const vap = q.M[r] - air;
    if(!(vap > 0)) continue;
    // what the air at this temperature will hold as vapour, and no more
    const cap = satP(SAT_WATER, q.T[r])*q.V[r]/(R_VAP*Math.max(q.T[r],1));
    const drop = vap - cap;
    if(!(drop > 0)) continue;
    /* NO BOOK IS OPENED FOR IT, and that is deliberate. These kilograms left
       the plant at the opening they left through and sumpStep() (step.js)
       already put the ones that landed inside a region on that region's floor.
       s.roomM is the compartment's GAS and is in no book at all, so what
       condenses out of it simply stops being gas. Booked a second time here it
       was counted twice - measured, 5 435 kg of residual on one break. */
    const f = drop/q.M[r];
    for(const i of g.cells) s.roomM[i] -= s.roomM[i]*f;
  }
}

/* ══ THE BLOWDOWN ══
   Every hole is priced by the SAME relation a break in a pipe is, at the two
   volumes' own pressures and the donor's own density - so a big difference
   blows hard, a small one seeps, and ten cells shot out pass ten times what one
   does. What crosses carries what it is made of: the donor's hydrogen and
   oxygen at the donor's own fractions, and its enthalpy, deposited in the cell
   on the far side of the hole. That is decision 23 made true by construction -
   the wall passes nothing at all (blk = 0), so the hole is the only path and
   everything goes through it, at it, in whatever direction the pressures say.
   LUMPED AFTERWARDS: what is left in a volume is shared over its own cells, so
   a compartment has one pressure and the gas that arrived is not a lump sitting
   at the doorway. Temperature is NOT levelled - that is the diffusion pass's
   job and a room really does have hot corners. */
function roomHoleStep(s, dt){
  const holes = matHoles(s);
  for(const k in s.holeQ) s.holeQ[k].q = 0;      // refilled, never rebuilt
  if(!holes.length){ for(const k in s.holeQ) delete s.holeQ[k]; return; }
  const q = roomVols(s);
  /* HOW MANY HOLES JOIN THE SAME PAIR OF VOLUMES. The overshoot guard below is
     a statement about the PAIR - do not push them past each other in one tick -
     so with ten holes open each may only take a tenth of it. Without this the
     guard is applied ten times over and the two volumes ring. The orifice term
     itself is untouched, so area still scales: ten holes pass ten times what
     one does right up until the balance is the limit. */
  const share = {};
  for(const h of holes){ const k = Math.min(h.a,h.b)+":"+Math.max(h.a,h.b);
    share[k] = (share[k]||0)+1; }
  for(const h of holes){
    const up = q.P[h.a] >= q.P[h.b] ? h.a : h.b, dn = up === h.a ? h.b : h.a;
    if(!(q.M[up] > 0)) continue;
    const w = roomHoleKgs(h.area, q.P[up], q.P[dn], q.RHO[up]);
    /* A HOLE MAY NOT PASS MORE THAN IS THERE, and it may not overshoot the
       balance either: past half the difference in one tick the two volumes
       swap places every tick and ring instead of settling. The same guard the
       transport's own Courant blend is.
       IN PRESSURE, NEVER IN DENSITY. Written as a density difference first and
       measured: a hot region at equal pressure is LIGHTER than the cold ship,
       so the guard went to zero while there was still 6 kPa across the wall and
       a four-hole breach stalled sooner than a one-hole one. Solving p_up' =
       p_dn' for the mass that crosses is the same gas law one line up. */
    const kUp = q.T[up]/q.V[up], kDn = q.T[dn]/q.V[dn];
    const even = Math.max(0, (q.P[up]-q.P[dn])/(R_AIR*(kUp+kDn)));
    const nSh = share[Math.min(h.a,h.b)+":"+Math.max(h.a,h.b)] || 1;
    const dm = Math.min(w*dt, q.M[up]*0.5, even*0.5/nSh);
    if(!(dm > 0)) continue;
    const f = dm/q.M[up];
    // what leaves the donor volume, taken from every cell of it in proportion
    const cUp = q.R.regions[up].cells, cDn = q.R.regions[dn].cells;
    let h2=0, o2=0, en=0;
    for(const i of cUp){ const take = s.roomM[i]*f;
      s.roomM[i] -= take;
      const fh = s.roomH2[i]*f, fo = s.roomO2[i]*f;
      s.roomH2[i] -= fh; s.roomO2[i] -= fo;
      h2 += fh; o2 += fo; en += take*ROOM_CP*s.roomT[i]; }
    // ...and it arrives AT THE HOLE, in the cell on the far side of it
    let land = -1;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const X=h.x+dx, Y=h.y+dy;
      if(X<0||X>=GW||Y<0||Y>=GH) continue;
      if(q.R.of[Y*GW+X] === dn){ land = Y*GW+X; break; }
    }
    if(land < 0) land = cDn[0];
    const was = s.roomM[land], now = was + dm;
    s.roomT[land] = clamp((was*ROOM_CP*s.roomT[land] + en)/Math.max(now*ROOM_CP, 1e-9),
                          T_SPACE, ROOM_TMAX);
    s.roomM[land] = now;
    s.roomH2[land] += h2; s.roomO2[land] += o2;
    /* WHAT THIS HOLE IS ACTUALLY PASSING, kg/s, and WHICH WAY. The renderer
       draws the jet off this rather than off a proxy, so the picture is the
       flow: a big difference through one cell is a jet and a spent compartment
       through ten is nothing at all. Refilled, never rebuilt - a renderer holds
       the reference across frames. */
    s.holeQ[h.x+","+h.y] = {q: dm/dt, to: land};
  }
  // a cell that is no longer a hole stops drawing one
  for(const k in s.holeQ) if(!holes.some(h=>h.x+","+h.y===k)) delete s.holeQ[k];
  /* AND EACH VOLUME IS ONE COMPARTMENT AGAIN. Redone off a fresh sum, because
     the loop above moved mass between volumes and the totals it started with
     are stale by exactly what crossed. */
  { const R = q.R;
    const M = new Float64Array(q.n), N = new Float64Array(q.n);
    for(let i=0;i<GW*GH;i++){ const r=R.of[i]; if(r<0) continue; M[r]+=s.roomM[i]; N[r]++; }
    for(let i=0;i<GW*GH;i++){ const r=R.of[i]; if(r<0) continue; s.roomM[i]=M[r]/N[r]; } }
}
/* ══ AND THE SHIP'S OWN COMPARTMENT LEAKS ══
   A bounded region is sealed by construction and holds whatever is put in it.
   The ship at large is not a sealed vessel - it is the rest of a hull with
   doors, trunks and a ventilation system - and without this every kilogram of
   steam ever released into it would raise its pressure for the rest of the run.
   ROOM_P_TAU is the figure that has always stood for exactly this and it keeps
   its exact meaning; what changed is that it now bleeds MASS back toward what
   the compartment holds at rest rather than bleeding a pressure straight to
   zero. It is air, not plant inventory, so no book is opened for it. */
// AT THE CELL'S OWN TEMPERATURE: ROOM_MAIR is that mass at T_HULL, and warm
// air relaxed onto a 293 K figure holds T/T_HULL gauge for ever
function roomShipLeak(s, dt){
  const R = matRegions();
  for(const g of R.regions){
    if(g.bounded) continue;
    const f = Math.min(1, dt/ROOM_P_TAU);
    for(const i of g.cells){
      const m0 = ROOM_P0/1000*ROOM_VCELL/(R_AIR*Math.max(s.roomT[i], 1));
      s.roomM[i] += (m0 - s.roomM[i])*f;
    }
  }
}

/* THE WORST CELL a machine is standing in - radAt()'s own shape, and the
   number Stage 2's damage criterion and the PART TEMP layer both read, so the
   picture and the failure cannot disagree. */
function roomAt(s, p){
  let v = 0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH) v = Math.max(v, s.roomT[Y*GW+X]);
  return v || T_HULL;
}
// the same question of the blast, and the same shape, for the damage writer
// in step.js. A blast is instantaneous, so this is a peak and not an integral.
// and the worst it has EVER seen there, which is what the scar draws off
function roomScarAt(s, p){
  let v = 0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH) v = Math.max(v, s.roomPPk[Y*GW+X]);
  return v;
}
function roomPAt(s, p){
  let v = 0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH) v = Math.max(v, s.roomP[Y*GW+X]);
  return v;
}
// the same cells, the BANG only: what the burn put on top of the volume's own static pressure (roomPGauge)
function roomBlastAt(s, p, g){
  let v = 0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH){ const i = Y*GW+X; v = Math.max(v, s.roomP[i]-g[i]); }
  return v;
}
// the hydrogen concentration in a cell, as a volume fraction - the readout
// behind the flammability layer, off the same expression the ignition test
// uses so a cell cannot draw as safe and burn.
const roomH2Frac = (s,i) => { const n = s.roomH2[i]/H2_MMOL;
  return n > 0 ? n/(ROOM_MOL + n) : 0; };
// and the oxygen's, off the SAME denominator - the hydrogen displaces air, so
// a rich cell is oxygen-poor by arithmetic rather than by a second rule
const roomO2Frac = (s,i) => s.roomO2[i]/O2_MMOL/(ROOM_MOL + s.roomH2[i]/H2_MMOL);
// WHICH MACHINES ARE OVER THEIR OWN LIMIT, off the same roomAt() and the same
// partTsurv() the damage integral reads - so the alarm and the failure cannot
// name two different sets of machines.
const roomOverIds = s => LAY.parts.filter(p => { const l = partTsurv(p);
  return l && fitted(p) && partSkin(s,p) > l; }).map(p => p.id);
const roomH2Peak = s => { let v = 0;
  for(let i=0;i<s.roomH2.length;i++){ const f = roomH2Frac(s,i); if(f > v) v = f; }
  return v; };
