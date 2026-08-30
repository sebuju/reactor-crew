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
   MPC^2/(dt*(2+ROOM_UP+1)) ~ 1.8 m^2/s at dt=0.02; this sits a fifth of the
   way to that, so no substepping is needed and raising it past the cap is
   never the answer - substep it the way the kinetics does instead. */
const ROOM_MIX = 0.35;
// hot air rises: the conductance up out of a cell against the one down into
// it. One constant, the BUOY_LIN idiom - a bias, not a correlation.
const ROOM_UP = 3.0;
// a machine is a wall. What crosses an occupied cell, as a fraction.
const ROOM_BLOCK = 0.12;
/* K - a NUMERICAL CEILING, not a behaviour. A severed steam line puts
   hundreds of megawatts into a few cells and the explicit integrator would
   run to infinity in a second; nothing on this plant survives half of this,
   so no player ever sees the clamp act as a rule. */
const ROOM_TMAX = 2500;

// kJ/K of air in one cell, and m^2 of machine surface one cell of footprint
// is worth. Both pure geometry, so both are constants rather than a lookup.
const ROOM_C = MPC*MPC*ROOM_DEPTH*ROOM_RHO*ROOM_CP;
const ROOM_HK = ROOM_H*MPC*MPC/1000;      // kW/K, one cell of hot surface
/* WHAT ONE VENTILATION UNIT MOVES, in kg of compartment air per second - a
   RATED MACHINE, not a UA fitted to make a number come out. 50 kg/s is about
   40 m^3/s, which is a marine engine-room ventilation SET rather than one
   fan - and the box is 3x3, so a set is what it is. Against the 2132 kg of
   air this compartment holds, one of them turns the whole room over in
   43 seconds. What it removes is that mass times its own temperature rise
   above the sea outside, AT THE CELLS IT IS STANDING IN - so where it is put
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
  return s.Tavg;                          // thermal:"source" - the vessel itself
}
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
  const parts = [], runs = [], hull = new Uint8Array(N);
  const g = occupied(null, {pipes:false, ports:false});
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X;
    if(g[Y][X]) occ[i] = 1;
    if(hullCell(X,Y)) hull[i] = 1;
  }
  for(const p of LAY.parts){
    const cells = [];
    for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
      if(X>=0&&X<GW&&Y>=0&&Y<GH) cells.push(Y*GW+X);
    if(cells.length) parts.push({p, cells});
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
  roomCache = {occ, hull, parts, runs, shellValves, gx, gUp, gDn};
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

function roomJet(src, cells, kW, kgps){
  if(!(kW > 0) || !cells.length) return;
  const got = roomPlumeFor(cells, kgps);
  const q = kW/got.length;
  for(const i of got) src[i] += q;
}
/* THE CELLS A PLUME REACHES, breadth-first out of the opening. Deterministic
   by construction - one fixed neighbour order, one queue, no dice - which is
   what a snapshot round trip requires of it. It crosses an occupied cell:
   this is a gas filling a compartment, not a ray, and a machine is a
   deflector rather than a seal. */
let roomSeen = null, roomQ = null, roomPlumeGen = 0;
function roomPlume(cells, n){
  const N = GW*GH;
  if(!roomSeen){ roomSeen = new Int32Array(N); roomQ = new Int32Array(N); }
  const mark = ++roomPlumeGen;
  let head = 0, tail = 0;
  for(const i of cells) if(roomSeen[i] !== mark){ roomSeen[i] = mark; roomQ[tail++] = i; }
  while(head < tail && tail < n){
    const i = roomQ[head++], X = i%GW, Y = (i/GW)|0;
    if(Y>0)      { const j=i-GW; if(roomSeen[j]!==mark && tail<n){ roomSeen[j]=mark; roomQ[tail++]=j; } }
    if(X>0)      { const j=i-1;  if(roomSeen[j]!==mark && tail<n){ roomSeen[j]=mark; roomQ[tail++]=j; } }
    if(X<GW-1)   { const j=i+1;  if(roomSeen[j]!==mark && tail<n){ roomSeen[j]=mark; roomQ[tail++]=j; } }
    if(Y<GH-1)   { const j=i+GW; if(roomSeen[j]!==mark && tail<n){ roomSeen[j]=mark; roomQ[tail++]=j; } }
  }
  return roomQ.subarray(0, tail);
}
// what a kilogram of secondary steam is worth to the room, above ambient
// water: the feed-to-steam rise the shell already charged, plus the feedwater
// it was raised from sitting above the sea outside.
const roomSteamH = () => H_FG + CP_W*(T_FEED - T_CW);

/* ══ THE TICK ══
   Sources, transport, sink - in that order, once, explicitly. Nothing here
   writes anything but s.roomT, s.roomH2 and the readouts derived off them;
   Stage 2's damage path is in step.js beside every other consequence. */
function roomStep(s, dt){
  const G = roomGeom(), T = s.roomT, N = roomScratch();
  const src = roomSrc, d = roomD;
  src.fill(0);

  /* ── hot surfaces ──
     Signed, so a cell hotter than the machine standing in it gives heat BACK
     and the term is its own negative feedback. Stage 1 is deliberately
     one-way: the room takes this heat and the machine does not lose it, so a
     plant at rest is bit-identical to one with no room at all. */
  for(const q of G.parts){
    const Tp = partTemp(s, q.p);
    if(Tp === null || !isFinite(Tp)) continue;
    for(const i of q.cells) src[i] += ROOM_HK*(Tp - T[i]);
  }
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
     sensible heat above the sea outside is what the room gets. One conversion
     out of invRate()'s % of loop inventory, the same bridge loopKg() is
     everywhere else. */
  const kgOf = rate => Math.max(0, rate)/100*loopKg();
  for(const fid in s.reliefVent){
    if(tgt[fid] || out[fid]) continue;
    const kg = kgOf(s.reliefVent[fid]);
    roomJet(src, cellsOf(fid), kg*CP_W*(s.Tavg - T_CW), kg);
  }
  for(const k in s.spillBy){
    const kg = kgOf(s.spillBy[k]);
    roomJet(src, roomOpenCells(s, G, k), kg*CP_W*(s.Tavg - T_CW), kg);
  }

  /* ── the machines whose whole job is getting heat out of the building ──
     A structure with no network presence at all, the shield/catcher idiom.
     It sits on the main board, so a blackout leaves the room with nothing but
     its hull. */
  if(!s.blackout) for(const q of G.parts){
    if(q.p.role !== "vent" || s.dmgParts.indexOf(q.p.id) >= 0) continue;
    const ua = ROOM_VENT_KGS*ROOM_CP/q.cells.length;
    for(const i of q.cells) src[i] -= ua*(T[i] - T_CW);
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
  for(let i=0;i<N;i++) T[i] = clamp(T[i] + d[i]/ROOM_C*dt, T_CW, ROOM_TMAX);

  /* ── the sink ──
     THE HULL RING IS HELD AT AMBIENT. A fixed boundary, exactly as every
     containment node is fixed at P.Pcont in the pressure solve, and the
     second physical meaning a hull cell now carries: today it is only "more
     likely to be shot". T_CW is the sea the plant sits in, which is the same
     water the condenser draws on - one fewer typed constant, and the right
     number. */
  for(let i=0;i<N;i++) if(G.hull[i]) T[i] = T_CW;

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
const H2_IGN = 773;                       // K
const H2_LHV = 120000;                    // kJ/kg
const H2_MMOL = 0.002016, AIR_MMOL = 0.02896;   // kg/mol
// kg in ONE tick's deflagration worth writing a log line about - see the
// caller in step.js for why a steady flame at the limit is a tile, not a line
const H2_BURN_EV = 1.0;
// moles of air in one cell - the denominator every concentration divides by
const ROOM_MOL = MPC*MPC*ROOM_DEPTH*ROOM_RHO/AIR_MMOL;

function roomH2Step(s, dt, G){
  const N = GW*GH, H = s.roomH2;
  s.roomBurn = 0;
  /* ── it leaves with what leaves ──
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
      const got = roomPlumeFor(cells, Math.max(0, rate)/100*loopKg());
      const q = m/got.length;
      for(const i of got) H[i] += q;
    };
    const tgt = (P.net && P.net.fitTarget) || {}, out = (P.net && P.net.fitVentOut) || {};
    for(const k in s.spillBy) put(roomOpenCells(s, G, k), s.spillBy[k]);
    for(const fid in s.reliefVent){
      if(tgt[fid] || out[fid]) continue;
      const q = G.parts.find(w => w.p.id === fid);
      put(q ? q.cells : [], s.reliefVent[fid]);
    }
  }
  /* ── and it is a gas in a room ──
     Diffused on the SAME stencil the heat is, which is what makes a plume
     collect where the hot air collects rather than under it. */
  roomDiffuse(H, G, dt);

  /* ── deflagration ──
     A cell over the LFL and over auto-ignition burns, and it lights every
     flammable cell it touches in the same tick (the flood is the flame
     front). The energy is bounded by the hydrogen: this consumes what it
     burns, so a cell cannot fire twice off one charge. It CANNOT fire at any
     preset's rest point, because s.h2 is exactly zero there and nothing has
     put a gram of it in the room. */
  const T = s.roomT, lit = [];
  const flam = i => H[i] > 0 && (H[i]/H2_MMOL)/(ROOM_MOL + H[i]/H2_MMOL) >= H2_LFL;
  for(let i=0;i<N;i++) if(flam(i) && T[i] >= H2_IGN) lit.push(i);
  if(!lit.length) return;
  const seen = new Uint8Array(N);
  for(const i of lit) seen[i] = 1;
  let burned = 0;
  while(lit.length){
    const i = lit.pop();
    burned += H[i];
    T[i] = Math.min(ROOM_TMAX, T[i] + H[i]*H2_LHV/ROOM_C);
    H[i] = 0;
    const X = i%GW, Y = (i/GW)|0;
    const nb = [];
    if(X>0) nb.push(i-1); if(X<GW-1) nb.push(i+1);
    if(Y>0) nb.push(i-GW); if(Y<GH-1) nb.push(i+GW);
    for(const j of nb) if(!seen[j] && flam(j)){ seen[j] = 1; lit.push(j); }
  }
  s.roomBurn = burned;
}

/* ONE STENCIL, TWO FIELDS. The heat pass above walks it inline because it
   also carries the sources; this is the same walk for a field that has none,
   and writing it twice is how the two would start disagreeing about which way
   is up. Conserving: nothing leaves except at the hull, where a gas escapes
   the same way heat does. */
function roomDiffuse(F, G, dt){
  const N = roomScratch(), d = roomD2;
  d.fill(0);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW-1;X++){
    const i = Y*GW+X, q = G.gx[i]*(F[i]-F[i+1])/ROOM_C;
    d[i] -= q; d[i+1] += q;
  }
  for(let Y=0;Y<GH-1;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X, j = i+GW, dF = F[j]-F[i];
    const q = (dF > 0 ? G.gUp[i] : G.gDn[i])*dF/ROOM_C;
    d[i] += q; d[j] -= q;
  }
  for(let i=0;i<N;i++) F[i] = Math.max(0, F[i] + d[i]*dt);
  for(let i=0;i<N;i++) if(G.hull[i]) F[i] = 0;
}

/* THE WORST CELL a machine is standing in - radAt()'s own shape, and the
   number Stage 2's damage criterion and the PART TEMP layer both read, so the
   picture and the failure cannot disagree. */
function roomAt(s, p){
  let v = 0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH) v = Math.max(v, s.roomT[Y*GW+X]);
  return v || T_CW;
}
// the hydrogen concentration in a cell, as a volume fraction - the readout
// behind the flammability layer, off the same expression the ignition test
// uses so a cell cannot draw as safe and burn.
const roomH2Frac = (s,i) => { const n = s.roomH2[i]/H2_MMOL;
  return n > 0 ? n/(ROOM_MOL + n) : 0; };
// WHICH MACHINES ARE OVER THEIR OWN LIMIT, off the same roomAt() and the same
// ROLE.tsurv the damage integral reads - so the alarm and the failure cannot
// name two different sets of machines.
const roomOverIds = s => LAY.parts.filter(p => { const l = ROLE[p.role] && ROLE[p.role].tsurv;
  return l && fitted(p) && roomAt(s,p) > l; }).map(p => p.id);
const roomH2Peak = s => { let v = 0;
  for(let i=0;i<s.roomH2.length;i++){ const f = roomH2Frac(s,i); if(f > v) v = f; }
  return v; };
