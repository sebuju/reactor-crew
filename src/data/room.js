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
  if(p.role === "ihx")  return s.ihxTBy[p.id];
  if(p.role === "cond") return s.condT;
  if(p.role === "radiator") return s.radT;
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
/* ...AND WHAT A RUN IS AT, by KIND, for the same reason. A pipe is not a part
   and has no role, so it cannot go through partTemp(); a run's kind is
   already the one thing that names what is inside it. A kind with no row here
   (a user run, a cross-tie) carries no surface, which is the same "no
   temperature invented" partTemp() gives an untyped box. */
const ROOM_RUN_T = {
  hot:  s => s.Tavg, cold: s => s.Tavg, surge: s => s.Tavg,
  hpi:  s => s.Tavg, relief: s => s.Tavg,
  steam: s => roomSgT(s), feed: s => T_FEED, exh: s => s.condT,
};
// the shells' mean, for a steam header that may reach several of them
function roomSgT(s){ let t=0, n=0;
  for(const id in s.sgTBy){ t+=s.sgTBy[id]; n++; }
  return n ? t/n : T_FEED; }

/* ══ GEOMETRY, MEMOISED ON THE ARRANGEMENT ══
   laySig()+pipeSig(), the same key radGeom() uses and for the same reason:
   layoutMetrics() runs every frame and D churns on every bench slider, but a
   machine moves rarely. Everything in here is a fact about where things are,
   never about what they are doing. */
let roomCache = null, roomCacheSig = "";
function roomGeom(){
  const sig = laySig()+"|"+pipeSig();
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
    if(!ROOM_RUN_T[r.k] || !r.cells) continue;
    runs.push({k:r.k, cells:r.cells.map(([x,y])=>y*GW+x)});
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
  const blk = i => occ[i] ? ROOM_BLOCK : 1;
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
  roomCache = {occ, face, own, turb, parts, runs, shellValves, gx, gUp, gDn};
  roomCacheSig = sig;
  return roomCache;
}

/* scratch, rebuilt every call and never read across one - the runFlow/pField
   idiom in step(). NOT state: every element is written before it is read, so
   a snapshot that does not carry it loses nothing. */
let roomSrc = null, roomD = null, roomD2 = null;
const roomScratch = () => { const N = GW*GH;
  if(!roomSrc){ roomSrc = new Float64Array(N); roomD = new Float64Array(N); roomD2 = new Float64Array(N); }
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
function roomSpread(F, cells, kgps, amount){
  if(!(amount > 0) || !cells.length) return;
  // the plume is roomQ[0..n) - see roomPlume(), which hands back a COUNT
  const n = roomPlumeFor(cells, kgps);
  let w = 0;
  for(let k=0;k<n;k++) w += 1/(1+roomRing[roomQ[k]]);
  const q = amount/w;
  for(let k=0;k<n;k++){ const i=roomQ[k]; F[i] += q/(1+roomRing[i]); }
}
const roomJet = (src, cells, kW, kgps) => roomSpread(src, cells, kgps, kW);
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
  let head = 0; roomTail = 0;
  for(const i of cells) if(roomSeen[i] !== mark) roomPush(i, 0);
  while(head < roomTail && roomTail < n){
    const i = roomQ[head++], X = i%GW, Y = (i/GW)|0, r = roomRing[i]+1;
    if(Y>0)      { const j=i-GW; if(roomSeen[j]!==mark && roomTail<n) roomPush(j, r); }
    if(X>0)      { const j=i-1;  if(roomSeen[j]!==mark && roomTail<n) roomPush(j, r); }
    if(X<GW-1)   { const j=i+1;  if(roomSeen[j]!==mark && roomTail<n) roomPush(j, r); }
    if(Y<GH-1)   { const j=i+GW; if(roomSeen[j]!==mark && roomTail<n) roomPush(j, r); }
  }
  return roomTail;
}
// what a kilogram of secondary steam is worth to the room, above ambient
// water: the feed-to-steam rise the shell already charged, plus the feedwater
// it was raised from sitting above the hull outside.
const roomSteamH = () => H_FG + CP_W*(T_FEED - T_HULL);

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
  for(const r of G.runs){
    const Tp = ROOM_RUN_T[r.k](s);
    if(!isFinite(Tp)) continue;
    for(const i of r.cells) src[i] += ROOM_HK*(Tp - T[i]);
  }

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
  }
  /* The primary side, as LIQUID: hot water leaving a hole flashes, and its
     sensible heat above the hull outside is what the room gets. One conversion
     out of invRate()'s % of loop inventory, the same bridge loopKg() is
     everywhere else. */
  const kgOf = rate => Math.max(0, rate)/100*loopKg();
  for(const fid in s.reliefVent){
    if(tgt[fid] || out[fid]) continue;
    const kg = kgOf(s.reliefVent[fid]);
    roomJet(src, cellsOf(fid), kg*CP_W*(s.Tavg - T_HULL), kg);
  }
  for(const k in s.spillBy){
    const kg = kgOf(s.spillBy[k]);
    roomJet(src, roomOpenCells(s, G, k), kg*CP_W*(s.Tavg - T_HULL), kg);
  }

  /* ── the machines whose whole job is getting heat out of the building ──
     A structure with no network presence at all, the shield/catcher idiom.
     It sits on the main board, so a blackout leaves the room with nothing but
     its hull. */
  if(!s.blackout) for(const q of G.parts){
    if(q.p.role !== "vent" || s.dmgParts.indexOf(q.p.id) >= 0) continue;
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

  /* ── the readouts ── */
  { let mx = 0, at = -1;
    for(let i=0;i<N;i++) if(T[i] > mx){ mx = T[i]; at = i; }
    s.roomMax = mx; s.roomMaxAt = at; }
}

/* WHICH CELLS AN OPENING IS AT. s.spillBy is keyed the way netBuild() names
   its break edges - "break:core" is the vessel itself, "break:"+run key is a
   severed run, and only the cells actually cut are open. */
function roomOpenCells(s, G, key){
  if(key === "break:core"){ const q = G.parts.find(w => w.p.id === "core"); return q ? q.cells : []; }
  const r = P.net.byKey[key.slice(6)];
  if(!r || !r.cells) return [];
  const out = [];
  for(const [x,y] of r.cells) if(cellBroken(s, x, y)) out.push(y*GW+x);
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
const roomFlam = (s,i) => { const f = roomH2Frac(s,i);
  return f >= H2_LFL && f <= H2_UFL && roomO2Frac(s,i) >= O2_LOC; };
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
  return partSkin(s, p) >= H2_IGN || s.dmgParts.indexOf(p.id) >= 0;
}

function roomH2Step(s, dt, G){
  const N = GW*GH, H = s.roomH2, O = s.roomO2, Fl = s.roomFlame, Pr = s.roomP;
  const T = s.roomT;
  s.roomBurnOn = 0;
  /* it leaves with what leaves.
     Hydrogen is IN the primary, so the share of it that escapes this tick is
     the share of the primary that escapes this tick. One expression, at every
     opening, because an opening is an opening. */
  if(s.h2 > 0){
    const put = (cells, rate) => {
      const f = Math.max(0, rate)/100*dt;
      if(!(f > 0) || !cells.length) return;
      const m = Math.min(s.h2, s.h2*f);
      s.h2 -= m;
      // the same plume the heat went into, off the same opening at the same rate
      roomSpread(H, cells, Math.max(0, rate)/100*loopKg(), m);
    };
    const tgt = (P.net && P.net.fitTarget) || {}, out = (P.net && P.net.fitVentOut) || {};
    for(const k in s.spillBy) put(roomOpenCells(s, G, k), s.spillBy[k]);
    for(const fid in s.reliefVent){
      if(tgt[fid] || out[fid]) continue;
      const q = G.parts.find(w => w.p.id === fid);
      put(q ? q.cells : [], s.reliefVent[fid]);
    }
  }
  /* THE VENTILATION SET EXCHANGES GAS, NOT JUST HEAT. Its own comment already
     said it moves compartment air against the rest of the ship rather than
     dumping it overboard, so it carries the gas both ways: hydrogen out,
     oxygen back in, at the same rate expression the heat term uses. With the
     hull sealed this is the ONLY removal path that is not a fire, which is
     what finally prices the fan - a second job that is not a temperature. */
  if(!s.blackout) for(const q of G.parts){
    if(q.p.role !== "vent" || s.dmgParts.indexOf(q.p.id) >= 0) continue;
    const f = Math.min(1, ROOM_VENT_KGS/q.cells.length/ROOM_MAIR*dt);
    for(const i of q.cells){ H[i] -= H[i]*f; O[i] += (ROOM_O2_0 - O[i])*f; }
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
      if(!roomFlam(s,i)) Fl[i] = 0;
      else {
        const adv = Math.min(1, h2Sl(roomH2Frac(s,i))*G.turb[i]*dt/MPC);
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
          // THE BURN HEATS AT ROOM_CAIR - see its own note at the top of this
          // file. A deflagration is over before the steel knows about it.
          T[i] = Math.min(ROOM_TMAX, T[i] + q/ROOM_CAIR);
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
    const p = Pr[i] + (q > 0 ? ROOM_P0*(q/ROOM_CAIR)/T_HULL : 0) - Pr[i]/ROOM_P_TAU*dt;
    Pr[i] = p > 0 ? p : 0;
    if(Pr[i] > pmax) pmax = Pr[i];
  }
  s.roomBurnOn = on; s.roomPMax = pmax;
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
function roomPAt(s, p){
  let v = 0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH) v = Math.max(v, s.roomP[Y*GW+X]);
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
