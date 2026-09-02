"use strict";

// CELL is a RENDERING size, not a physical one - a run is measured in CELLS
// (one grid cell of pipe each) and MPC is the only thing that says how big a
// cell really is. The grid is three times DENSER than the original 16x9 and
// MPC is a third of what it was, so a cell is a third of the machine it used
// to be; on top of that the hull itself is bigger, because a plant laid out
// cell by cell needs lanes for its own pipework as well as room for its boxes.
/* THE HULL IS A DESIGN DECISION, not a constant: D.gw/D.gh say how many cells
   long and deep the ship is, and GW/GH are that pair resolved. Everything reads
   the bare names it always did, so gridSync() below is the ONE writer - a
   second one would let a cached Float64Array(GW*GH) outlive the grid it was
   sized for. GRID_MIN/GRID_MAX are the drag's stops and nothing else: a hull
   too small for its own machines marks them limbo (buildLayout()) and says so,
   which is the bench warning rather than a refusal to resize. */
let GW=60, GH=34;
const CELL=16, GX=12, MPC=1.4/3;   // metres per cell
const GRID_MIN=[30,20], GRID_MAX=[96,60];
const gridClamp=(w,h)=>[Math.max(GRID_MIN[0],Math.min(GRID_MAX[0],Math.round(w))),
                        Math.max(GRID_MIN[1],Math.min(GRID_MAX[1],Math.round(h)))];
function gridSync(){ const [w,h]=gridClamp(D.gw,D.gh);
  if(w!==GW||h!==GH){ GW=w; GH=h; } }
/* ONE WALL, TO THE CELL THE HAND IS OVER. The bow and the deck do not move:
   D.pipes is CELL-KEYED, so growing off x=0 would mean rewriting every pipe
   cell to mean the same ship. Nothing is frozen first - every box on the
   board stores its own cell, so the machinery does not ride the hull. */
function gridDrag(edge,c){
  if(!c) return;
  const [w,h]=gridClamp(edge==="r"?c[0]+1:D.gw, edge==="b"?c[1]+1:D.gh);
  if(w===D.gw && h===D.gh) return;
  D.gw=w; D.gh=h; buildLayout();
}
/* ══ WHAT A MACHINE IS CALLED ══
   The player's own name for a part, kept on D so it rides designSig(), the
   recording head and the save format for free. partName() is the ONE reader -
   audit-dom.js source-scans the UI files for a raw p.name read and fails the
   build if one survives.
   DATA, not display: it reads D and touches nothing on the page, and step()'s
   event log names the machine it is talking about - so living in core/ui.js
   put it outside the sim-only subset and the worker threw on the first log
   line that named a part. */
const NAME_CAP=24;
function partName(p){
  const n=(D.name&&D.name[p.id]||"").trim();
  return n?n.slice(0,NAME_CAP):p.name;
}
function setPartName(id,str){
  const t=(str||"").trim().slice(0,NAME_CAP);
  if(t){ if(!D.name) D.name={}; D.name[id]=t; }
  else if(D.name) delete D.name[id];
}
let GY=100;                                   // grid top, set each frame by the layout section
// sel starts null: a blank grid has nothing on it to be selected, and every
// partOf(sel) reader already answers null for a key that names no part
let LAY=null, layFit="", layBuiltSig=null, sel=null, layMass=0;
/* ══ A SIGNATURE IS BUILT ONCE PER EDIT, NOT ONCE PER TICK ══
   Every cache below proves itself against one of these strings, and simTick()
   opens its own layout window - so a running plant rebuilt 2.7 kB of string
   three thousand times a second to be told nothing had changed. Measured at
   80 us of a 496 us tick.
   Cached against DGEN (design.js) now; sigFresh() is the raw pass that keeps
   the contract honest and layFresh() runs it once a frame. See dTouch(). */
const SIGS=[];
const sigMemo = build => { let g=-1, v=null;
  const f = () => (g===DGEN ? v : (v=build(), g=DGEN, v));
  f.raw = build; SIGS.push(f); return f; };
const sigFresh = () => { for(const f of SIGS) if(f.raw()!==f()){ dTouch(); return; } };
/* EVERY MACHINE ON THE PLANT - the same argument tankSig() makes, and for the
   same reason: a machine's id, its KIND and its cell decide what box goes on
   the board, so a direct D.machines edit leaves LAY holding a part that no
   longer exists. */
const machineSig=sigMemo(()=>{ let out="";
  for(const id in D.machines){ const m=D.machines[id], c=m.cell;
    out += "|"+id+":"+m.kind+":"+(c?c[0]+","+c[1]:"-")+":"+(m.on||""); }
  return out; });
/* WHAT buildLayout() READS, all of it. Every box on the board is an
   INSTANCE, and its id and its cell
   are the two things that decide what box goes on the board. Leave them out
   and editing D.tanks directly - a rename, a tank moved, a tank the bench
   just reconfigured - leaves LAY holding parts that no longer exist, and the
   runs pointing at them silently stop routing. */
const tankSig=sigMemo(()=>{ let out="";
  for(const id in D.tanks){ const t=D.tanks[id], c=t.cell;
    // vol too: a tank's BOX SIZE follows it (tankW/tankH), so a slider on its
    // own panel changes what stands on the grid, not just what it holds
    out += "|"+id+":"+(c?c[0]+","+c[1]:"-")+":"+t.vol+":"+(t.aspect||1); }
  return out; });
/* A FITTING IS A PART TOO, so the same argument tankSig() makes applies: its
   id and its cell decide what box goes on the board, and its MODE decides
   which faces are one node (foldFacesOf()). Leave any of the three out and a
   direct D.fittings edit leaves LAY holding a box that no longer exists. */
const fittingSig=sigMemo(()=>{ let out="";
  for(const id in D.fittings){ const f=D.fittings[id], c=f.cell;
    out += "|"+id+":"+(c?c[0]+","+c[1]:"-")+":"+f.mode; }
  return out; });
/* A PORT'S id, part, offset and mode all decide what's on the board - same
   argument tankSig()/fittingSig() make. A port OCCUPIES A CELL now, so this
   is not merely additive: a port placed or moved changes what occupied()
   stamps and so what groupFits() will refuse. The FACE is derived from the
   offset (portFaceOf()) and so is already in here. */
const portSig=sigMemo(()=>{ let out="";
  for(const id in D.ports){ const p=D.ports[id];
    out += "|"+id+":"+p.p+":"+p.dx+","+p.dy; }
  return out; });
/* EVERY PIPE CELL, in key order - a pipe is cell-keyed data (D.pipes), so its
   own identity IS its cell and this is the whole of it. Joined into
   laySrcSig() so laying a pipe invalidates buildLayout()'s occupancy the same
   way placing a tank does. */
const pipeSig=sigMemo(()=>{ let out="";
  for(const k in D.pipes){ const c=D.pipes[k]; out += "|"+k+":"+c.s+":"+c.r; }
  return out; });
// the hull's own size is in here: every grid-sized cache (the radiation field's
// Float64Array(GW*GH), the room's geometry) proves itself against this string
const gridSig=sigMemo(()=>"|g"+D.gw+"x"+D.gh);
/* A RUN'S OWN BORE AND WALL, both in millimetres, keyed by run key. Here and
   NOT in D_SCALARS(), which JSON-stringifies whole and is a measured 5.6 ms
   hot spot. Neither has a writer yet - they are the hooks runBoreMm() and
   runWallMm() already read, and a run panel is what is missing. */
const boreSig=sigMemo(()=>{ let out="";
  for(const k in (D.bore||{})) out += "|b"+k+":"+D.bore[k];
  for(const k in (D.wall||{})) out += "|w"+k+":"+D.wall[k];
  return out; });
const laySrcSig=()=>machineSig()+gridSig()+tankSig()+fittingSig()+portSig()+pipeSig()+boreSig();
/* REMOVING A PART TAKES ITS PIPES WITH IT. It used to leave them behind,
   which was survivable only while ids were never reused - and they are, on
   purpose (addTank()/addFitting() take the lowest free slot, which is what
   makes the "rename every id" audit mean anything). Delete tank2, add a
   tank, and the new one inherited the dead one's plumbing. */
function removePart(id){
  /* TAKING A RIDER OFF TAKES ITS HOST OFF. The rod drives are bolted to the
     vessel head: there is no plant with drives and no reactor, so REMOVE on
     either one is the same gesture on the same machine. */
  const m0=D.machines[id];
  if(m0 && m0.on && D.machines[m0.on]) return removePart(m0.on);
  /* ...and taking a host off takes everything bolted to it with it. The host's
     own entry goes FIRST, or the rider's redirect above finds it still there
     and the two send each other round for ever. */
  delete D.machines[id];
  for(const rid in D.machines) if(D.machines[rid].on===id) removePart(rid);
  delete D.tanks[id];
  /* NO fitting->fitting cascade. A fitting left with no runs is a valve
     you can re-plumb, exactly as a tank with no runs is. */
  delete D.fittings[id];
  if(D.name) delete D.name[id];   // ids are reused on purpose, so a dead part's name must not be inherited by the next one
  // a port belongs to the component - remove the component and its ports
  // (and whatever they carried) go with it, exactly like a tank's runs do.
  for(const pid in D.ports) if(D.ports[pid].p===id) removePort(pid);
  buildLayout();
}
/* ══════════ ADDING A TANK IS ADDING A TANK ══════════
   ONE default config (TANK_DEFAULT, pipenet.js), not a menu of four kinds.
   Everything that used to distinguish a boron tank from an accumulator from
   a relief tank is a knob on the instance, set afterwards on its own panel.
   The id carries no meaning at all - it is a slot number, and Stage 7's
   "rename every tank" check exists to prove nothing reads it. */
/* mintTank() is the one place a tank is built; addTank() is the GESTURE on
   top of it and picks the lowest free slot id, because the bench never asks
   a player to name one. buildStockPlumbing() (pipenet.js) names its own,
   which costs nothing: a tank id carries no meaning whatsoever, and the
   "rename every tank id" audit exists to prove exactly that. A null x is a
   tank with no cell - a SECONDARY tank with no node and no box. */
function mintTank(id,x,y){
  const t=JSON.parse(JSON.stringify(TANK_DEFAULT));
  t.name=FLUID[t.fluid].label+" TANK"; t.col="#5aa9d6";
  t.cell = x==null ? null : [x,y];
  t.tip="A tank. Say what is in it, how it is charged and how it is plumbed on its own panel - the physics follows from that and from where you put it.";
  D.tanks[id]=t; buildLayout(); return id;
}
function addTank(x,y){
  let n=1; while(D.tanks["tank"+n]) n++;
  return mintTank("tank"+n,x,y);
}
/* Tanks are read from D.tanks, exactly as a machine is read from D.machines:
   that is where their whole configuration already lives, so a tank
   is one object and not two halves that can disagree. A tank with no `cell`
   is a SECONDARY tank with no node and no box - the hotwell. */
/* A TANK CARRIES A CONTROL ROW, SO IT IS A MACHINE-SIZED BOX. A FITTING DOES
   NOT: it stays one cell, a third the size of everything else, and its handles
   hang in the margin below it. */
const FIT_W=1, FIT_H=1;
/* TANK_W0 survives as FITSTRIP_W's own reference (plant.js) - a fitting's
   margin strip is half a stock tank's width - and no longer as a footprint.
   TANK_H0 is gone: a box's floor is DERIVED now (tankFloorH), not typed. */
const TANK_W0=3;
/* ══ THE BOX IS THE VOLUME ══
   Two independent clamped ramps were not an area at all, and tankW's upper
   clamp of 5 was unreachable (vol maxes at 100, giving 4). Area follows
   volume and an ASPECT knob says what shape that area is - round, wide or
   tall. TANK_VOL_CELL is fitted ONCE against the stock HPI tank (57 m^3 into
   its present 3x6 = 18 cells), the PART_VOL_CELL/RAD_AREA_CELL idiom: a
   stated free parameter. It is deliberately NOT PART_VOL_CELL (0.35), which
   prices a MACHINE's holdup where the box is mostly machine - applied here a
   57 m^3 tank would be 163 cells, bigger than the reactor.
   VOLUME STAYS EXACT: partVol() still returns D.tanks[id].vol. The box is the
   DISPLAY of volume, so the footprint rounds and the cubic metres do not. */
const TANK_VOL_CELL=3.2;
const tankAspect = id => { const t=D.tanks&&D.tanks[id];
  return clamp((t&&t.aspect)||1, 0.25, 4); };
const tankCells = vol => Math.max(4, Math.round(Math.max(vol,0)/TANK_VOL_CELL));
const tankW = (vol,a) => Math.max(2, Math.round(Math.sqrt(tankCells(vol)*(a||1))));
const tankH = (vol,a) => Math.max(2, Math.ceil(tankCells(vol)/tankW(vol,a)));
/* IS THERE ANYTHING BEHIND THIS TANK - a gas charge or a pump. The one
   predicate for "it can push at all", read by the drawing (a pressure vessel
   gets its own hoop and domed ends) and by nothing else; tankP() is what
   actually prices it. */
const tankHeld = id => { const t=D.tanks&&D.tanks[id]; return !!t && !!(t.gas || t.hold); };
const tankParts=()=>{
  const out=[];
  for(const id in D.tanks){ const t=D.tanks[id]; if(!t.cell) continue;
    out.push({id, name:t.name, w:tankW(t.vol,tankAspect(id)), h:tankH(t.vol,tankAspect(id)), x:t.cell[0], y:t.cell[1], col:t.col,
              grp:"safety", tip:t.tip, role:"tank"}); }
  return out;
};
/* A FITTING IS A COMPONENT, exactly like a tank: read from D.fittings, which
   is where its whole configuration already lives, so it is one object and not
   two halves that can disagree. It occupies a whole grid cell - hittable,
   repairable, blocking - which is what buys "a fitting with no free adjacent
   cell blocks commissioning", a thing a fraction along a pipe could never be
   asked. */
const fittingParts=()=>{
  const out=[];
  for(const id in D.fittings){ const f=D.fittings[id]; if(!f.cell) continue;
    out.push({id, name:f.name, w:FIT_W, h:FIT_H, x:f.cell[0], y:f.cell[1], col:f.col,
              grp:"safety", tip:f.tip, role:"fitting"}); }
  return out;
};
/* ADDING A FITTING IS ADDING A FITTING. One default config (FIT_DEFAULT,
   pipenet.js) and no menu of kinds: a tee, a branch throttle and a relief
   valve are one component with `mode` set differently, exactly as four
   tank-shaped things became one tank. Lowest free slot id, which is safe
   because removePart() takes a part's runs with it. */
/* mintFitting() is the one place a fitting is built; addFitting() is the
   GESTURE on top of it and picks the lowest free slot, because the bench
   never asks a player to name one. buildStockPlumbing() (pipenet.js) names
   its own, which costs nothing and reads better in a test: a fitting id
   carries no meaning whatsoever, and the "rename every fitting id" audit
   exists to prove exactly that. Same split addTank()/mintTank() already has. */
function mintFitting(id,x,y){
  const f=JSON.parse(JSON.stringify(FIT_DEFAULT));
  f.cell=[x,y];
  D.fittings[id]=f; buildLayout(); return id;
}
function addFitting(x,y){
  let n=1; while(D.fittings["fit"+n]) n++;
  return mintFitting("fit"+n,x,y);
}
/* WHICH FACES OF A PART ARE THE SAME NODE. A list folds them all onto one
   node (the core's single plenum). A fitting's answer is not a property of
   its ROLE but of its own mode - a tee is one node, a valve is two with a
   gate between - so the row names a resolver instead of a literal list.
   Read by foldMap() (the solve) and by nodeGraph() (which side is this on),
   because a fold those two disagreed about would put a valve's own two ends
   in different halves of the plant. */
const foldFacesOf=p=>{ const R=ROLE[p.role]; if(!R||!R.fold) return null;
  return typeof R.fold==="function" ? R.fold(p) : R.fold; };
/* t per 1 % of reference inventory. One rate for every tank, so four tanks
   cost four tanks and a bigger tank costs more - replacing four flat
   per-name figures (PART_MASS.reltk/efw/boroninj and D.accum's own +45 t)
   that between them priced the stock plant at exactly what this does. */
/* ══ A TANK WEIGHS ITS OWN SHELL ══
   TANK_T_PER_M3 was 0.5 t/m^3 flat, so an atmospheric water butt and a
   15.5 MPa pressurizer cost the same per cubic metre. It is surface area x
   wall x steel now, off the same Barlow relation a pipe uses (wallSuggestMm,
   pipenet.js) - so a vessel that holds more pressure is thicker and heavier
   because it is thicker, not because a table said so. Sphere-equivalent
   surface: a tank is drawn as a cylinder with domed ends and this is the one
   figure that needs no aspect knob to be honest. */
const tankAreaM2=vol=>Math.PI*Math.pow(6*Math.max(vol,0.1)/Math.PI,2/3);
/* `vol` is an argument, not always the tank's own: the CAPACITY slider asks
   what a candidate size would weigh before anything is written. */
const tankVolOf=(id,vol)=>Math.max(vol===undefined?D.tanks[id].vol:vol, 0.1);
const tankWallMm=(id,vol)=>
  wallSuggestMm(Math.cbrt(6*tankVolOf(id,vol)/Math.PI)*1000,   // equivalent diameter, mm
                tankDesignP(id), null);
/* ══ AND THEN A TENTH OF IT, FOR GAMEPLAY ══
   NOT physics, and it is the only number in this file that is not. The
   geometry above is right - a 57 m^3 vessel at 15.5 MPa really is about
   150 t of steel - and at full scale the four stock tanks came to 407 t
   against a 3000 t budget, so buying a reserve cost more than the reactor and
   every design converged on the same answer: do not fit one. A tenth puts
   tankage back where the rest of the ship's mass scale already sits, and it
   is applied HERE, once, on the finished figure - so the wall, the rating and
   the picture all stay the real quantities they are, and only the bill is
   scaled. Move it and nothing but the budget moves. */
const TANK_MASS_GAME_K=0.1;
// t, per tank, the ONE expression - the CAPACITY row's mass hint reads this
// too, so the bench cannot quote a price the design does not pay
const tankMassOf=(id,vol)=>tankAreaM2(tankVolOf(id,vol))*(tankWallMm(id,vol)/1000)
                         *STEEL_RHO/1000*TANK_MASS_GAME_K;
const tankMass=()=>{ let m=0;
  for(const id in D.tanks) if(D.tanks[id].cell) m+=tankMassOf(id);
  return m; };
/* ══ A PUMP IS A HEAD AND A FLOW ══
   It was one 0..1 slider around a hidden reference. A pump is two real
   numbers: the head it develops, MPa, and the flow it develops it at, kg/s.
   PUMP_H0 is the reference head the network was linearised about, so it is
   also the suggestion; the reference flow is the loop's own inventory over the
   time it takes to go round once. */
/* WHAT THIS PUMP HAS TO BEAT, asked of the drawing and never of a kind. A
   pump inside one closed circuit only fights the pipe run, which is PUMP_H0;
   a pump whose circuit also carries a BOUNDARY - a generator's shell at its
   design pressure, a condenser at its own vacuum - has to lift water from the
   lowest of those to the highest before a drop moves, exactly as a real
   feedwater pump does. Nobody declares which it is: pipe a spare pump from
   the condenser to a shell and the same walk suggests it a feed pump's head.
   PUMP_H0 rides on top of the standing term as the friction margin, so a
   coolant pump is untouched. */
const boundP = (pid, node) => { const p = partOf(pid); const R = p && ROLE[p.role];
  if(!R) return null;
  if(R.sgtr && secondaryNode(node)) return sgDesignP(pid);
  if(R.thermal === "sink") return COND_P0;
  return null; };
/* ══ AND NEVER MORE DIFFERENTIAL THAN ITS CIRCUIT CAN HOLD ══
   PUMP_H0 is a friction figure and it was flat, so a sodium or salt loop whose
   pressurizer holds 0.20 MPa was suggested a machine that develops three times
   the loop's whole absolute pressure - and its suction went below vacuum:
   MSR's read -0.0130 MPa at every sample, which is not a pressure water or
   salt has. A pump cannot develop more differential than the circuit it sits
   in can stand at its suction, so the suggestion stops there.
   ONLY WHERE THE LEVEL IS PINNED. A circuit with no hold on it floats to sit
   its own lowest node at the pressure the ship holds (netCoreFracOf, pipenet.js),
   so it accommodates whatever its pump develops and there is nothing to cap -
   which is why the cooling loop's pump is untouched. */
const pumpHeadSuggest = id => {
  if(id === undefined) return PUMP_H0;
  const b = pumpBounds(id);
  const h0 = b.hold === null ? PUMP_H0 : Math.min(PUMP_H0, b.hold);
  return h0 + (b.hi === null ? 0 : (b.hi - b.lo)*PUMP_MARGIN);
};
/* WHAT BOUNDARIES THIS PUMP'S OWN CIRCUIT CARRIES - the ONE walk, because the
   head suggestion and the flow suggestion below ask the same question of the
   same drawing and two copies of it would drift. `shell` is whether one of
   them is a generator's secondary side, which is the whole of what makes a
   pump a FEED pump (CLAUDE.md: asked of the drawing, never stored). */
function pumpBounds(id){
  const G = nodeGraph(), ci = (G.nodesOf[id]||[]).map(n=>G.circuit[n]);
  let hi = null, lo = null, shell = false, hold = null, panel = false, core = false;
  /* the setpoint of this pump's own circuit, where anything holds one - the
     ceiling on the head above, and asked on the same walk for the same reason
     the boundaries are */
  for(const c of ci) if(holdOnCirc(c).length){ hold = holdSetP(c); break; }
  for(const pid in G.nodesOf) for(const n of G.nodesOf[pid]){
    if(ci.indexOf(G.circuit[n]) < 0) continue;
    /* WHAT ELSE STANDS ON THIS CIRCUIT, asked before the boundary test: a
       panel is no boundary at all, and it is what tells the circulating water
       apart from the feedwater - both of them reach the condenser. */
    const p0 = partOf(pid);
    if(p0 && p0.role === "radiator") panel = true;
    if(G.inCore(n)) core = true;
    const q = boundP(pid, n); if(q === null) continue;
    const p = partOf(pid), R = p && ROLE[p.role];
    if(R && R.sgtr && secondaryNode(n)) shell = true;
    if(hi === null || q > hi) hi = q;
    if(lo === null || q < lo) lo = q;
  }
  // a panel spliced into a cold leg does not make a coolant pump a cw pump
  return {hi, lo, shell, hold, cool: panel && !core};
}
/* ══ WHAT THIS PUMP DRAWS ON ══
   A walk FROM the suction node, over the connections, stopping AT a tank
   without crossing it - runReach()'s "reached, never crossed" rule, asked of
   nodes because a part-level walk goes straight through a generator's tube
   wall. A second pump stops it too: what is behind another machine is that
   machine's suction, not this one's. Nothing is named - pipe any spare pump
   onto a reserve and the same walk makes it a reserve pump. */
function pumpResOf(id){
  // on the graph (graphSlot()): the solve's own cache signature asks this of
  // every pump on the plant, so the walk must not be paid per tick
  const slot=graphSlot("pumpRes"), was=slot.get(id); if(was) return was;
  const G=nodeGraph(), suc=pumpSucNode(id), out=[];
  const partAt=n=>partOf(n) || partOf(n.slice(0,-1));
  const seen={}, stack=[];
  // the SUCTION face group only: crossing this pump's own casing would put its
  // discharge side, and everything on it, in its own suction line
  for(const n of (G.nodesOf[id]||[])) if(coreFold(n)===suc){ seen[n]=1; stack.push(n); }
  while(stack.length){ const u=stack.pop();
    for(const v of (G.adj[u]||[])){ if(seen[v]) continue;
      const p=partAt(v); if(!p || p.id===id) continue;
      seen[v]=1;
      if(p.role==="tank"){ if(!out.includes(p.id)) out.push(p.id); continue; }
      /* A suction line may have valves and tees in it. Anything else in it is
         another MACHINE, and what stands behind another machine is that
         machine's suction and not this one's - without the stop, a coolant
         pump walked through the vessel and read the pressurizer as its
         reserve, and every pump on the ship was sized off a tank. */
      if(p.role!=="fitting") continue;
      stack.push(v); } }
  slot.set(id,out);
  return out;
}
const RESERVE_T = 600;                 // s a reserve is sized to hold the plant up over
/* HOW FAR OVER THE VESSEL IT FEEDS a pump is suggested at. A machine sized to
   exactly the pressure it is pushing against delivers nothing, and its
   regulating valve has no authority to throttle: real feedwater pumps are
   bought at about a third above drum pressure and this is that number. It
   multiplies the STANDING term only, so a pump inside one circuit - every
   coolant pump - is untouched. */
const PUMP_MARGIN = 1.35;
/* rated heat over what one kelvin of core rise costs: the loop's own mass
   flow - and there is ONE core, so the LOOPS share it. A four-loop plant
   whose pumps were each sized for the whole core circulated four times what
   the core was drawn for, over-cooled the fuel and walked its own rod
   controller into a flux trip inside two seconds.
   Divided by loops and never by PUMPS: two pumps in one loop are redundancy,
   not half a loop each, and dividing by the head count made buying a spare
   shrink the machine it was standing in for.
   ══ EXCEPT THAT A FEED PUMP MOVES WHAT THE BOILER BOILS ══
   One figure for every pump handed a FEEDWATER pump the core's own
   circulation - seven thousand kilograms a second where the boiler evaporates
   eight hundred - so the stock feed pump was nine times the machine it needed
   to be, and it was 835 t of a 935 t pump bill.
   It is NOT a machine asked what it is FOR - that is the mistake the comment
   above warns about. It is the DRAWING asked what this pump's own circuit
   carries, the identical walk the head suggestion makes (pumpBounds): a
   circuit with a generator's secondary side on it is a feedwater circuit, and
   what crosses it is steam. FEED_LEN (pipenet.js) is re-fitted against this,
   because the pump's swallow IS its edge conductance and the two cannot move
   apart. */
const pumpFlowSuggest = id => {
  const n = Math.max(1, loopMap().n);
  /* AND A FEEDWATER CIRCUIT IS NOT DIVIDED BY THE LOOPS. There is one of it,
     and every generator on it boils into it, so a pump sized at a loop's share
     could not hold three generators up: BN-600's was bought for 345 kg/s
     against 900 kg/s of evaporation and its shells emptied on the first
     transient. Two feed pumps on that circuit are redundancy, the same
     sentence the loop count makes above. */
  /* ══ AND A RESERVE PUMP IS SIZED BY ITS RESERVE ══
     A pump that draws on a tank cannot pass more than the tank holds, and how
     long it has to hold the plant up is the only figure a reserve has. Asked
     of the SUCTION and never of the circuit: the feed pump and the emergency
     feed pump share circuit 1, so a circuit-level question cannot tell them
     apart. Sized off the boiler instead, an emergency feed pump is bought at
     636 kg/s where the machine it stands in for is 31.7. */
  if(id !== undefined){ const r = pumpResOf(id);
    if(r.length) return r.reduce((m,t)=>m+tankKg(t),0)/RESERVE_T; }
  if(id !== undefined && pumpBounds(id).shell)
    return RATED_KW()/steamRise();            // rated heat over the feed-to-steam rise: kg/s of steam
  /* ══ AND CIRCULATING WATER CARRIES THE REJECTION, NOT THE CORE ══
     Sized as a coolant pump it moved the core's own circulation divided by the
     loops - 3 391 kg/s where BN-600 rejects 910 MW and needs 21 700 - so the
     condenser ran at a quarter of the capacity rate it was priced for (cwK
     0.23), backed up to 0.035 MPa against a 0.02 MPa trip, and tripped the
     turbine on the way up to full power. The panels were never short: they
     radiate more than they are handed and get COLDER as the plant loads. Same
     basis as condUASuggest() - this plant's duty on the design rise. */
  if(id !== undefined && pumpBounds(id).cool)
    return plantDuty()/(SAT_WATER.cp*CW_RISE);
  return RATED_KW()/(SAT_WATER.cp*CORE_DT0*n);
};
/* ══ A SUGGESTION FILLS THE FIELD. IT IS NOT THE FIELD ══
   These were `?? xSuggest()` - a LIVE default, recomputed from the rest of the
   plant on every read. That is a hidden reference, and it is the same one Job 2
   set out to delete wearing different clothes: an unset turbine had no swallow
   of its own, so editing the CORE moved it, and editing the pipe run moved it
   again. A designer setting a value on one machine must never be setting a
   value on another.
   So the suggestion is BAKED on first read and the machine owns it from then
   on. The number is identical to what the live default produced, so nothing
   about an untouched design moves; what changes is that it stops moving
   afterwards. SUGGEST on the panel re-derives it on demand, which is the whole
   of what a reference to start from should do. */
const bake = (bag, id, mk) => { const v = bag[id];
  return v === undefined ? (bag[id] = mk(id)) : v; };
const pumpHead = id => D.pumpHead[id] ?? pumpHeadSuggest(id);
const pumpFlow = id => D.pumpFlow[id] ?? pumpFlowSuggest(id);
/* WHAT THIS PUMP IS WORTH AGAINST THE REFERENCE MACHINE - a MASS and a BOX,
   and nothing the solve reads. The head an edge develops is the machine's own
   MPa and the flow it swallows is its own casing bore (netBuild()), so this
   is no longer a multiplier standing between the two figures and the physics.
   BOTH ANCHORS ARE ABSOLUTE. This asked pumpFlowSuggest() for the second one,
   which reads the CORE's rating - so editing the reactor silently resized
   every pump on the ship. A pump is a pump wherever it is fitted. */
const PUMP_FLOW_REF = 7250;            // kg/s, a reference coolant pump duty
const pumpCap = (head,flow) => (head/PUMP_H0)*(flow/PUMP_FLOW_REF);
const pumpCapOf = id => pumpCap(pumpHead(id), pumpFlow(id));
/* ══ AND A PUMP'S MASS IS SUBLINEAR IN ITS DUTY ══
   PUMP_MASS was charged straight against capacity, so mass went as head x
   flow with no ceiling at all - and a feedwater pump develops sixteen times a
   coolant pump's head, so the stock one alone came to 835 t of a 935 t pump
   bill, and asking a shell to hold a real 17 MPa priced its feed pump at
   nearly two thousand tonnes. That is not a heavy machine, it is a model with
   no top to it, and it is what blocked the generator's design pressure from
   being derived at all.
   Real equipment does not scale that way: mass goes as roughly the 0.6 power
   of duty - the published six-tenths rule, the same exponent process plant is
   costed by, and the reason a pump twice the duty is nowhere near twice the
   machine. PUMP_MASS is unchanged and is still what the REFERENCE machine
   weighs, because 1^0.6 is 1. */
const PUMP_MASS=50;                    // t at the reference machine (cap 1)
const PUMP_SCALE_N=0.6;                // the six-tenths rule, published
const pumpMass = cap => PUMP_MASS*Math.pow(Math.max(cap,0), PUMP_SCALE_N);
const pumpMassOf = id => pumpMass(pumpCapOf(id));
/* ══ A BIGGER PUMP IS A BIGGER BOX ══
   Every pump's size used to be a literal typed beside its own add() - 3x5 for
   a coolant pump, 3x2 for the circulating water one - so the two numbers a
   pump actually states said nothing about the machine on the board, and a
   pump nobody had sized read as a fitting. Same standing tankW()/tankH() has
   off `vol` and radW()/radH() have off area. Not to scale, monotonic, floored
   at 3x3 so the control strip always fits.
   OFF THE STORED FIGURES, never pumpCapOf(): the box is read inside
   buildLayout(), and pumpFlowSuggest() asks loopMap() - which is built on the
   board this pass exists to replace. An unset pump is the reference machine,
   which is the 3x5 every fixed slot used to have written down. */
/* ══ AND THE BOX IS THE CASING, WHICH IS THE BORE ══
   It was head x flow, so a feed pump - which develops sixteen times a coolant
   pump's head because it pushes into a shell - grew to 5x8 the moment
   anything BAKED its head, ran off the bottom of the grid, stood on the first
   radiator and walked its own nozzles off the pipe they were drawn to. The
   plant was un-commissionable and nothing said why, because a probe that
   never re-lays out after commission() cannot see it.
   A pump's BOX is its casing and its casing is its swallow; the head is
   inside it and is drawn nowhere. So the box follows FLOW alone - stable
   through commissioning, because flow is what a pump is bought by and not
   what its circuit turns out to demand. pumpCapOf() still prices MASS off
   both, which is right: a high-head machine is heavy without being wide. */
/* FLOORED AT THE REFERENCE MACHINE, so a pump box only ever GROWS. A feed
   pump's casing is genuinely small beside a coolant pump's - it passes 790
   kg/s against 7 300 - and letting the box follow that took it to 3x3, which
   dropped its own discharge nozzles off the face they were seeded on (a
   four-loop plant needs four rows of them). The floor is what the nozzles and
   the control strip need, which is the same rule every machine's box already
   states; the volute above it is the only part that is worth drawing. */
const pumpBoxCap = id => Math.max(1, (D.pumpFlow[id] ?? PUMP_FLOW_REF)/PUMP_FLOW_REF);
// the floor and the ceiling of a pump box, in cells
const PUMP_W0=3, PUMP_BOX_H0=3, PUMP_W_MAX=5, PUMP_H_MAX=8;
const pumpW = id => clamp(PUMP_W0 + Math.floor(pumpBoxCap(id)/1.5), PUMP_W0, PUMP_W_MAX);
const pumpH = id => clamp(PUMP_BOX_H0 + Math.round(2*pumpBoxCap(id)), PUMP_BOX_H0, PUMP_H_MAX);
/* IS THIS A PRIMARY PUMP? There is one pump role, so the question cannot be
   asked of a name or of a second role - it is asked of the GRAPH, exactly
   like loop membership itself: a pump the flood fill can trace to a generator
   is a coolant pump, one it cannot is piped somewhere else and is somebody
   else's pump. Written once and shared; four sites used to ask
   ROLE.head and would each count a feedwater pump.
   Declared here, above its first reader, but loopOf() is hoisted below - it
   is only ever CALLED after the module has finished loading. */
/* WHICH PATH THROUGH A COMPONENT IS THE PUMP CASING. head sits on the PATH
   row, not on the role: a role may carry several internal paths and only one
   of them can be the thing that pushes. A role with no path pushes nothing,
   which is every role but one. */
const roleHead=role=>{ const R=ROLE[role]; if(!R||!R.internal) return false;
  return (Array.isArray(R.internal)?R.internal:[R.internal]).some(IN=>IN.head); };
/* WHERE A PUMP DRAWS ON - the casing path's own `a` face, folded, because a
   pump spliced into a horizontal leg takes suction on `r` and has no node
   called "t" at all. One door, so the head, the cavitation reading and the
   panel cannot disagree about which end is the suction. */
const pumpSucNode=id=>{ const p=partOf(id), R=p&&ROLE[p.role]; if(!R) return id;
  const IN=(Array.isArray(R.internal)?R.internal:[R.internal]).find(x=>x.head);
  return IN ? coreFold(id+IN.a) : id; };
// AND WHERE IT PUSHES INTO - the same door, the casing path's own `b` face
const pumpDisNode=id=>{ const p=partOf(id), R=p&&ROLE[p.role]; if(!R) return id;
  const IN=(Array.isArray(R.internal)?R.internal:[R.internal]).find(x=>x.head);
  return IN ? coreFold(id+IN.b) : id; };
/* AND WHAT THAT PATH IS CALLED IN THE SOLVE - fitEdgeKey()'s idiom for a
   pump. The reference (derived()) and the tick (step()) both read this pump's
   own swallow off it, and a second spelling of the key is a second answer. */
const pumpEdgeKey=id=>{ const p=partOf(id), R=p&&ROLE[p.role]; if(!R) return null;
  const IN=(Array.isArray(R.internal)?R.internal:[R.internal]).find(x=>x.head);
  return IN ? "comp:"+id+":"+IN.a+IN.b : null; };
const primaryPump=id=>{ const p=partOf(id);
  return !!p && roleHead(p.role) && loopOf(id)!==null; };
/* EVERY PUMP ON THE GRID, in LAY order - the set s.flowBy/s.flowDemBy are
   keyed on, counted and never named, exactly like sgIds(). */
const pumpIds=()=>LAY.parts.filter(p=>roleHead(p.role)).map(p=>p.id);
// roleHead(), not p.id.startsWith("pump") - what MAKES something a
// pump for capacity purposes is that its role puts head into the loop,
// the identical test netBuild() gates its own head edge on.
// EVERY pump the ship carries, because this is what it WEIGHS (design.js) and
// a machine on the drawing is a machine you bought wherever it is piped.
const totalPumpCap=()=>{ let c=0;
  for(const p of LAY.parts) if(roleHead(p.role)) c+=pumpCapOf(p.id);
  return c; };
/* MASS IS NOT THE SUM OF THE CAPACITY. It is the sum of each machine's own
   sublinear mass (pumpMass), so three small pumps and one big one weigh what
   they each weigh - summing capacity first and scaling once would price a
   plant's redundancy as if it were one enormous machine. */
const totalPumpMass=()=>{ let m=0;
  for(const p of LAY.parts) if(roleHead(p.role)) m+=pumpMassOf(p.id);
  return m; };
// ...and the pumps on the CORE's own circuit, which is a different book: the
// RPS low-flow floor (flowMin, step.js) is about the water going past the
// fuel, so a pump that cannot reach it must not raise the trip setpoint.
// Asked of the circuit (inCore()), never of primaryPump().
const corePump=id=>{ const p=partOf(id); if(!p||!roleHead(p.role)) return false;
  const G=nodeGraph(); return (G.nodesOf[id]||[]).some(n=>G.inCore(n)); };
const corePumpCap=()=>{ let c=0;
  for(const p of LAY.parts) if(corePump(p.id)) c+=pumpCapOf(p.id);
  return c; };
// how many steam generators are on the grid right now - the fact D.loops
// used to fake as an input. Every reader that priced or counted "loops"
// wants this counted value instead, never a stored knob.
const sgCount=()=>LAY.parts.filter(p=>p.role==="sg").length;
/* HOW MANY TURBINES AND HOW MANY CONDENSERS ARE ON THE GRID. Same move,
   twice: a flag said "there is one, or there is none", and every reader that
   priced, gated or NAMED one wants a count. The stock unit is still behind
   its own fittable checkbox - "no turbine at all" stays a legal design and
   the bench still warns about it - and any further one is a PLACED part, the
   standing a spare pump and a spare generator already have. */
const turbCount=()=>LAY.parts.filter(p=>p.role==="turb").length;
const condCount=()=>LAY.parts.filter(p=>p.role==="cond").length;
/* ══════════ AND EVERY ONE OF THEM IS ITS OWN MACHINE ══════════
   The same move D.pumpSize made, three more times: a turbine, a condenser and
   a generator are PLACED parts, so a plant with two of them was two copies of
   one decision. The scalar knob survives as the fallback (?? and never ||, or
   a legitimately zero size becomes the default), so an untouched design and
   every preset commission bit-identically. */
/* ══ A MACHINE STATES A REAL QUANTITY, IN ITS OWN UNITS ══
   Every one of these was a 0..1 slider around a hidden reference - a turbine
   was 0.45+1.60*size, and the designer could not say what machine they were
   building. The field is the ENGINEERING QUANTITY now, and there is no span
   to be inside of: an absurd number is a legal design that performs
   accordingly and blows the mass budget.

   THE DEFAULT IS THE SUGGESTION. `?? xSuggest()` and never a baked figure:
   the suggestion is computed from the rest of the design, so an untouched
   plant commissions on the number the old slider midpoint stood for - exactly,
   with no anchor written down - and the SUGGEST affordance on the bench fills
   the field from the same function. It suggests; it never limits. */
/* Off D.power and layoutMetrics(), NEVER derived() - derived() prices mass,
   mass prices these machines, and a suggestion that asked derived() would ask
   itself. */
const RATED_KW = () => D.power*1000;
/* ══ A READOUT MAY NOT MOVE THE PLANT ══
   layoutMetrics() calls layFresh(), which is PASS bookkeeping - so asking it
   from a readout re-dated the per-pass caches mid-tick and the trajectory
   drifted in the sixth figure depending on whether anybody had drawn a panel
   that frame. Measured: with mwE() called every 50 s the stock plant landed on
   a different Tavg from the same seed. Cached on the arrangement's own
   signature, so a design edit still re-measures and a running plant - which
   cannot edit its design (designBlocked()) - measures once. */
let n0Sig=null, n0Val=1;
const n0Ref = () => { const sg=laySrcSig()+"|"+pipeSig();
  if(sg!==n0Sig){ n0Sig=sg; n0Val=Math.min(1, layoutMetrics().flowK); }
  return n0Val; };
/* ══ WHAT THIS PLANT ACTUALLY MAKES AT FULL POWER ══
   Rated heat is what the CORE is worth; this is what comes out of it, limited
   by what the pipe run and the pump head can carry. Every machine downstream
   is sized against THIS and judged against it, because a turbine matched to a
   rating its own loop cannot deliver is a turbine nobody would build.
   Getting this wrong is not a label bug: loadCeil() below gates the control
   room's load slider, and measuring a machine against `rated` while sizing it
   against `n0*rated` made that ceiling read back the PIPE RUN's flow limit -
   exactly flowK, to the last digit - with a turbine's name on it. */
/* ══ WHAT ONE KILOGRAM OF STEAM COSTS THIS PLANT, kJ/kg ══
   The FEED-TO-STEAM RISE at the design shell pressure - feedwater at T_FEED
   heated to saturation and then boiled. It is NOT SAT_WATER.hfg, which is the
   latent half only: 1509 against a real 1843 at 6.9 MPa, and against 1622 at
   the 17 MPa a high-temperature family's shell is rated for. Every "kg/s of
   steam" on the plant divides by this, so there is one of it.

   OFF THE SUGGESTION, NEVER sgDesignP(): that walks the drawing (sgIds(), in
   step.js) and this is asked during buildStockPlumbing(), at module load, when
   step.js has not been evaluated - the same ReferenceError CORE_DT0 is placed
   to avoid. sgDesPSuggest() needs only the COOLANT row, and what this replaces
   was a flat constant that ignored design pressure altogether, so following
   the suggestion is strictly closer to the plant than what was there. */
const steamRise = () => hRise(SAT_WATER, sgDesPSuggest());
const plantSteam = () => n0Ref()*RATED_KW()/steamRise();            // kg/s raised
/* ══ THE EFFICIENCY THIS PLANT REACHES, NOT THE ONE ITS COOLANT ALLOWS ══
   The COOLANT row is a CEILING and grossEff() is the share of it the fitted
   turbine captures - and every sink on the ship used to be sized against the
   ceiling while the plant rejected against the capture. On the stock helium
   ship the two are 0.42 and 0.249, so its panels and its condenser were bought
   29.5 % small and it commissioned at twice its design backpressure.
   grossEff() cannot be asked here: it walks LAY.parts, and this is read while
   LAY is being built. So the SET IS THE ONE THIS CORE WOULD BE GIVEN - the
   same log law at the steam the rating raises - which needs neither the
   arrangement nor n0Ref(), and lands within 1.5 % of grossEff() on all six
   families instead of within 30 %. It is a SIZING figure: what the machine
   actually captures is still grossEff(), off the turbine actually fitted.
   steamRise() is drawing-free for exactly this reason - see its own note. */
const ratedEff = () => COOLANT[D.cool].eff
  * clamp(1 + TURB_EFF_K*Math.log(RATED_KW()/steamRise()/TURB_EFF_REF),
          TURB_EFF_MIN, TURB_EFF_MAX);
const plantDuty  = () => n0Ref()*RATED_KW()*(1-ratedEff());          // kW rejected
/* What one turbine swallows wide open, kg/s. A designer sizes a set for the
   boiler in front of it, so the suggestion is all of what that boiler raises -
   and a machine that reaches past it is overload the designer chose to buy. */
const turbKgsSuggest = () => plantSteam();
const turbKgs = id => D.turbKgs[id] ?? turbKgsSuggest(id);
const totalTurbKgs = () => { let c=0;
  for(const p of LAY.parts) if(p.role==="turb") c+=turbKgs(p.id);
  return c; };
/* ══ EFFICIENCY IS DERIVED, NEVER ENTERED ══
   It was a second slider (0.70+0.60*size) that let a designer buy a small
   machine and a big machine's efficiency. Isentropic efficiency rises with
   size and it rises SLOWLY - a set ten times bigger is a few points better,
   not twice as good - so the law is logarithmic in swallow, anchored at 1.00
   on the reference machine. A multiplier on the coolant's own cycle
   efficiency, which is what the old span was too.
   TURB_EFF_K=0.13 puts a tenth-size set at 0.70 and a triple at 1.14; the cap
   is where a real steam cycle stops, about 39 % gross on water. */
/* TURB_EFF_REF is an ABSOLUTE machine size - roughly a 400 MWe set - and not
   the plant's own steam. Efficiency is a property of how big the turbine IS,
   so a designer editing the core must not be editing this; anchored on the
   suggestion it moved every time the reactor did. */
const TURB_EFF_K=0.13, TURB_EFF_MAX=1.18, TURB_EFF_MIN=0.55, TURB_EFF_REF=680;
const turbEffOf = id => { const k=turbKgs(id);
  if(!(k>0)) return TURB_EFF_MIN;
  return clamp(1 + TURB_EFF_K*Math.log(k/TURB_EFF_REF), TURB_EFF_MIN, TURB_EFF_MAX); };
/* t per kg/s of swallow. NO CAP: a 5 GW set weighs what it weighs and blows
   the mass budget, which is the designer's problem and not this table's. */
const TURB_T_PER_KGS=0.0369;
const totalTurbMass=()=>{ let m=0;
  for(const p of LAY.parts) if(p.role==="turb") m+=turbKgs(p.id)*TURB_T_PER_KGS;
  return m; };
/* A condenser is a heat exchanger, so what it IS is a UA, kW/K. The
   suggestion is the unit that rejects the reference plant's waste heat across
   the design terminal difference on the design circulating-water rise. */
/* ...and the condenser is sized the same way: the unit that rejects what this
   plant actually rejects at full power, across the design terminal difference
   on the design circulating-water rise. Same basis as the turbine, so the two
   ceilings condShort_() compares are like for like. */
const condUASuggest = () => (plantDuty()/CW_RISE)
                            * Math.log(COND_DT0/(COND_DT0-CW_RISE));
const condUA = id => D.condUA[id] ?? condUASuggest(id);
/* Steam this unit will take straight past the turbine, kg/s - on a load change
   as well as on a trip, since the bypass became a live machine. */
const condDumpSuggest = () => 0.5*turbKgsSuggest();
const condDump = id => D.condDump[id] ?? condDumpSuggest(id);
const COND_T_PER_UA=1.626e-4;          // t per kW/K
const totalCondUA=()=>{ let c=0;
  for(const p of LAY.parts) if(p.role==="cond") c+=condUA(p.id);
  return c; };
const totalCondMass=()=>{ let m=0;
  for(const p of LAY.parts) if(p.role==="cond") m+=condUA(p.id)*COND_T_PER_UA;
  return m; };
/* The dump ceiling is count-INDEPENDENT (P.bypass, step.js), so it takes the
   mean and not the sum; P.condUA reads the sum, and so does the circulating
   water flow anchored against it, so rejection does scale with count. That
   asymmetry is the existing model. */
const condDumpMean=()=>{ let n=0,c=0;
  for(const p of LAY.parts) if(p.role==="cond"){ c+=condDump(p.id); n++; }
  return n?c/n:0; };            // no condenser is no dump, not a suggested one
const sgTypeOf=id=>D.sgType[id]??D.sg;
const sgRowOf=id=>SGT[sgTypeOf(id)];
/* ══ THE SHELL WEIGHS ITS OWN WALL - C3, ON THE SECOND-BIGGEST VESSEL ══
   The type's water charge as a vessel, at the wall its own design pressure
   needs, on the same tenth scale every tank is priced at (TANK_MASS_GAME_K -
   gameplay, stated where it is defined). Raise a generator's design pressure
   and its shell costs steel, which is the whole of what C3 asks.
   sgShellT and sgTubeT are separate on purpose: they answer two different
   questions and were one number, so buying transfer coefficient used to be
   free and holding more pressure used to cost nothing. */
const sgShellT = id => { const w=sgRowOf(id).water;
  const d=Math.cbrt(6*Math.max(w,0.1)/Math.PI)*1000;
  return tankAreaM2(w)*(wallSuggestMm(d, sgDesignP(id), null)/1000)
         *STEEL_RHO/1000*TANK_MASS_GAME_K; };
/* ══ AND THE BUNDLE IS A FLAT TONNAGE PER TYPE - DELIBERATELY ══
   Pricing it off UA (IHX_T_PER_UA's idiom) is the obvious move and it is
   wrong here, measured: sgUASuggest() divides by a dT0 that FLOORS at 5 K,
   and a BWR's programme sits on its own saturation point - so it is suggested
   218 000 kW/K against a PWR's 47 000, and steel priced off that put 294 t of
   tube on a plant whose whole generator weighed 70. The floor is a stand-in
   for a secondary design this model does not have, and hanging a mass term on
   it prices the stand-in. So the SHELL follows pressure, which is real
   geometry, and the bundle stays what the type states. */
const sgTubeT  = id => sgRowOf(id).tube;
// NOT sgMassOf(): step.js already owns that name for the WATER in the shell,
// in kg. This is the STEEL, in tonnes - two quantities, two names.
const sgSteelT = id => sgShellT(id)+sgTubeT(id);
const totalSgMass=()=>{ let m=0;
  for(const p of LAY.parts) if(p.role==="sg") m+=sgSteelT(p.id);
  return m; };
/* A generator carries its own transfer coefficient as well as its tonnage -
   the tonnage says how much water is in it, the UA says how fast heat crosses
   the tubes, and they were one figure. */
const totalSgUA=()=>{ let c=0;
  for(const p of LAY.parts) if(p.role==="sg") c+=sgUAOf(p.id);
  return c; };
/* WHAT SHARE OF THEM IS STILL WORKING. mwE() used to ask
   s.dmgParts.includes("turb") - a NAME test, and with two turbines a hit on
   one would have zeroed the plant's whole output. A share, so losing one of
   two costs half. */
const roleAlive=(role,dmg)=>{ const ids=LAY.parts.filter(p=>p.role===role).map(p=>p.id);
  if(!ids.length) return 0;
  return ids.filter(id=>!dmg||dmg.indexOf(id)<0).length/ids.length; };
/* A part whose mass is not already counted by some other measure
   (totalPumpCap(), sgCount(), latMass(), a fitting's own FIT_MASS) - one row
   per role, priced once if that role is anywhere on LAY.parts at all. Off
   the grid, never off a D flag: derived()'s mass expression (design.js)
   must be able to point at a BOX for every tonne it charges, and this is
   where a term that only ever gated a checkbox before now names one. Every
   tank left this table for tankMass() (above), which charges per instance
   off the instance's own vol rather than one flat figure per name. */
const PART_MASS={catcher:66, vent:34};
/* PER INSTANCE, not per role. It is the only honest answer for a machine the
   bench will place as many of as you like -
   a role-level charge would hand out every unit after the first for nothing,
   which is the same trap widening a capacity slider's span had. */
const partMass=role=>LAY.parts.filter(p=>p.role===role).length*(PART_MASS[role]||0);
/* WHERE THIS BOX GIVES UP, K - the ONE door, because a radiator's coating
   scales it per instance and two readers asking ROLE.tsurv directly would
   disagree with the panel that sold the coating. null is structure: a shield
   and a containment wall do not fail this way. */
const partTsurv=p=>{ const l=ROLE[p.role]&&ROLE[p.role].tsurv;
  if(!l) return null;
  if(p.role==="radiator") return l*radCoatOf(p.id).tsurvK;
  // a tank states its own, the RADCOAT idiom: a heavy vessel is not the same
  // machine as a water butt and the role can only carry one figure
  if(p.role==="tank" && D.tanks[p.id] && D.tanks[p.id].tsurv) return D.tanks[p.id].tsurv;
  return l; };
/* AND WHERE IT GIVES UP TO A BLAST, kPa - partTsurv()'s mirror and the ONE
   door for the same reason: two readers asking ROLE.pburst directly is how
   the damage writer and any panel that ever prints it would come to
   disagree. null is structure, exactly as it is above. */
const partPburst=p=>{ const l=ROLE[p.role]&&ROLE[p.role].pburst;
  if(p.role==="tank" && D.tanks[p.id] && D.tanks[p.id].pburst) return D.tanks[p.id].pburst;
  return l || null; };
/* ══ AND WHAT ITS OWN SHELL IS BUILT FOR, MPa ══
   partPburst() above is the ROOM pushing IN - a hydrogen blast, in kPa - and
   until now nothing on this plant was ever asked what the pressure INSIDE it
   was doing. So a thin space panel spliced into a 15.5 MPa primary held it for
   nothing, which is the one thing a radiating panel cannot do, and a heat sink
   priced against a 307 K condenser became a free 1.7 GW sink on the hot leg.
   ONLY THE MACHINE THAT STATES ONE. Every pressure boundary on this plant was
   bought for this plant, so rating them off the coolant's own P0 said nothing
   and cost everything: measured, it burst the core, both generators and the
   pump on MSRE at rest, because the solve carries PIEZOMETRIC head - pump
   discharge and elevation included - and that is not a figure a shell rating
   may be compared with. What IS comparable is the pressure the CIRCUIT is
   held at, which is a gauge reading, and the only machine here with a rating
   its own circuit can exceed is the panel. The condenser is absent on purpose:
   s.condLost is already that machine's answer and a second would be a second
   table. */
const partPdes=p=>{ const l=ROLE[p.role]&&ROLE[p.role].pdes;
  return l || 0; };
// kPa a run gives up at. A pipe cell is not a part and has no role, so it
// cannot go through partPburst() - the ROOM_RUN_T idiom one file over.
const PIPE_PBURST=120;
/* THE WEAKEST THING ACTUALLY DRAWN, kPa - what an overpressure has to reach
   before it is worth telling anyone about. DERIVED from the plant rather than
   typed, the sgBypBand() idiom: a compartment full of instrument cabinets is
   alarmed earlier than one holding nothing but vessels, and nobody picks the
   figure. Pipework is the floor when there is nothing else. */
const minPburst=()=>LAY.parts.reduce((m,p)=>{ const v=partPburst(p);
  return v && fitted(p) && v<m ? v : m; }, PIPE_PBURST);
/* ══════════ LOOP MEMBERSHIP COMES OFF THE GRAPH ══════════
   p.loop used to be a STORED field - set once, off nearestLoop() (a
   Euclidean-distance guess) for a placed spare and off a literal index for a
   stock pump - and every reader trusted it forever after. That is exactly
   the frozen-pixel bug a stored tap pixel used to be, one level up: a pump
   connected to a loop by PROXIMITY is not connected to it at all. Measured
   consequence: place a spare pump nobody ever piped in and the loop's pumped
   capacity doubled anyway, purely because the spare's `.loop` read 0.

   loopMap() answers it off the drawing instead, structurally: nodeGraph()
   below, flood-filled outward from every generator's PRIMARY nodes. Only a
   part carrying a ROLE this loop concept is even about (core/sg/pump) takes
   an index - never a run's own `k` label. That is not a permission on the
   SOLVE (every run still conducts, taps, hits and spills regardless of role -
   Stage 1's rule is untouched), it is a bookkeeping default exactly like
   KIND_TEMP's hot/cold tag (pipenet.js): read for a display bucket, never for
   whether current flows.

   Role alone used to be what kept the feedwater pump out of loop 0, because
   its run landed on the SAME node a cold leg did (sg's "b" face carried both)
   and ROLE.feed was simply not in the set. Both halves of that are gone: the
   feed run lands on the generator's own "r" face, and there is one pump role,
   so the walk itself has to be able to tell a tube from a shell. It can,
   because it walks NODES and the generator's two internal paths do not meet.

   A pump this walk cannot reach from any generator (nothing plumbed to it
   at all, or plumbed somewhere no generator's branch reaches - Stage 3a's
   reactor-condenser-RCP-reactor loop, say) simply has no loop index. It
   still develops its OWN head once it has any real run at all - see
   netBuild()'s pump-head block, pipenet.js - it just does not pool
   capacity with anyone else's, because there is no group to pool with. */
/* A FITTING IS IN THE LOOP IT SITS IN. Splice a tee into a hot leg and the
   leg on the core side is still that loop's leg - leave `fitting` off this
   list and loopOfKey() answers null for it, which silently costs the loop a
   leg in every per-loop question the tick asks. */
const LOOP_ROLE={core:1, sg:1, ihx:1, pump:1, fitting:1};
/* THE WALK IS OVER NODES, NOT PARTS. It used to link two PARTS whenever a run
   joined them, which was only ever right while every part was a single
   through-path: a steam generator carries two that do not meet (tubes and the
   shell around them), so a part-level link walks straight through the tube
   wall and out the other side, and a feedwater pump piped to a generator's
   shell would read as one of that generator's coolant pumps. There is one
   pump role now, so that is not hypothetical - it is what would happen.
   Node = partId+face, exactly the key netBuild() indexes on, so this graph and
   the solve's graph are the same drawing read twice. */
/* THE KEY COST MORE THAN THE ANSWER. A tick asks for this graph ~85 times -
   tankCircuit, loopMap, secGensFromNode and secGensOf all want it - and the exact
   signature below was rebuilt for every one of them, at 2.9 us a call to
   stringify eleven runs. Measured: 58% of one sim tick spent proving a cache
   was still valid, against a walk that is nearly free.
   The drawing cannot change while a tick is running: every gesture that writes
   D.pipes, D.ports or LAY is a bench gesture, and commission() follows it. So step() takes
   the graph ONCE, holds it for the tick, and drops the hold at the end - the
   same "resolve once, read many" move pipeFieldRefresh() makes for the pipe
   field. The hold is a WINDOW, never a latch: outside it, and everywhere on the
   bench, the exact signature is still the only answer, because a designer
   editing a paused plant leaves s.tick standing still and a tick number would
   go stale under them. */
let nodeGraphCache=null, nodeGraphSig="", nodeGraphHeld=false;
const nodeGraphHold=on=>{ nodeGraphHeld=!!on && !!nodeGraphCache; };
/* THE WINDOW ITSELF, so the three passes that take it cannot disagree about
   what "settled" means: a tick (step()), a frame (tick(), main.js) and the
   10 Hz rail sync (shellSync(), shell.js). None of them writes D.pipes,
   D.ports or LAY - every gesture that does is a pointer handler, and one
   cannot run inside any of them. layoutMetrics() is NOT in here: a frame calls
   it anyway and a tick must not, or every tick would pay laySrcSig() to be
   told the drawing has not moved. */
/* COUNTED, so windows may nest. simTick() takes one around the whole tick
   INCLUDING sample(), and step() takes one of its own inside it - and it was
   step()'s closing release that dropped the outer one, leaving the trend
   sampler to rebuild four signature strings every fifth tick for nothing. */
let layDepth=0;
/* AND NUMBERED. Anything that is a pure function of the plant FOR THE LENGTH
   OF ONE PASS caches against this instead of against a signature: it moves on
   every settle AND every release, so an answer can never be read back in a
   pass it was not computed in. A signature would be the very cost being
   avoided; a tick counter would stand still on a paused plant. */
let layPassN=0;
/* ZERO OUTSIDE A WINDOW, and that is the safety: a click handler is the one
   thing that DOES move D, and two of them can run back to back with no frame
   between. Answering 0 there means "not cacheable", so an answer can only ever
   be reused inside the settled pass that computed it. */
const layPass=()=>layDepth?layPassN:0;
const laySettle=()=>{ if(layDepth++) return;
  layPassN++;
  nodeGraphHold(false); pipeMapHold(false); netPassDrop();
  pipeTrace(); pipeMap(); nodeGraph();
  nodeGraphHold(true); pipeMapHold(true); };
const layRelease=()=>{ if(layDepth>0 && --layDepth) return;
  layDepth=0; layPassN++;
  nodeGraphHold(false); pipeMapHold(false); netPassDrop(); };
function nodeGraph(){
  if(nodeGraphHeld) return nodeGraphCache;
  // fittingSig() too: a fitting's MODE decides both its fold and whether its
  // own internal link is a gate, and a mode change moves no part and no cell.
  // pipeSig()+portSig(): a connection is TRACED out of the cells and the
  // ports, so both are what this graph is built from.
  // gridSig(): everything hung off this graph's slot (graphSlot()) includes the
  // GW x GH occupancy array, and a resize no longer moves any part - so laySig()
  // alone handed a shrunk or grown hull the grid of the old one.
  const sig=laySig()+"|"+pipeSig()+"|"+fittingSig()+"|"+portSig()+gridSig();
  if(nodeGraphCache && nodeGraphSig===sig) return nodeGraphCache;
  const adj={}, nodesOf={}, runPorts={};
  const note=(pid,f)=>{ (nodesOf[pid]||(nodesOf[pid]=[])).push(pid+f); };
  const link=(a,b)=>{ (adj[a]||(adj[a]=[])).push(b); (adj[b]||(adj[b]=[])).push(a); };
  /* WHICH INTERNAL LINKS ARE A GATE. A valve's own path is a link this graph
     has to carry - cut it outright and everything past an in-line throttle
     reads as a different half of the plant - but it is not the same KIND of
     link as a length of steel, and loopMap() below has to be able to tell
     them apart. Recorded per undirected pair, not per part, because a
     fitting also carries fold links (t->l, b->r) that are solid metal. */
  const gate={}, gateKey=(u,v)=>u<v?u+"|"+v:v+"|"+u;
  for(const p of LAY.parts){
    const R=ROLE[p.role]; if(!R||!R.internal) continue;
    for(const IN of (Array.isArray(R.internal)?R.internal:[R.internal])){
      note(p.id,IN.a); note(p.id,IN.b); link(p.id+IN.a, p.id+IN.b);
      if(IN.gate && fitModeOf(p.id)!=="tee") gate[gateKey(p.id+IN.a, p.id+IN.b)]=1; }
  }
  /* CONNECTIONS, never D.ports. An unplumbed port contributes no node - give
     it one and a steam generator's tubes fold onto its shell through the
     "still one vessel" pass below, and loopMap(), tankCircuit() and secGensOf()
     all read that graph. */
  for(const c of pipeTrace().conns){
    const a=partOf(c.a), b=partOf(c.b); if(!a||!b) continue;
    note(a.id,c.sa); note(b.id,c.sb);
    link(a.id+c.sa, b.id+c.sb);
    /* THE TWO PORT VALVES THIS LINK IS BEHIND. Per undirected pair and a LIST,
       because two runs may join the same pair of faces and the link survives
       while either one of them is still open - portDead() below is the reader,
       and it is the only way a state-free graph can be asked a live question. */
    const rk=gateKey(a.id+c.sa, b.id+c.sb);
    (runPorts[rk]||(runPorts[rk]=[])).push([c.pa, c.pb]);
  }
  /* A COMPONENT THAT DECLARES NO PATH IS STILL ONE VESSEL. ROLE.internal says
     what the SOLVE carries through a part, and a pressurizer declares none -
     correctly, it is a boundary rather than a through-path. But the question
     THIS graph answers is "which side is this on", and a pipe on the
     pressurizer's bottom and one on its side are plainly the same water. Left
     unlinked, the relief tank hung off a face the core could not reach and
     read as SECONDARY: a primary tank in the secondary's books. A part that
     DOES declare its paths is taken at its word - the generator's tubes and
     shell do not meet, and that is the whole point. */
  for(const p of LAY.parts){
    const R=ROLE[p.role]; if(R && R.internal) continue;
    const ns=nodesOf[p.id]; if(!ns) continue;
    for(let i=1;i<ns.length;i++) link(ns[0], ns[i]);
  }
  /* AND A FOLD IS A LINK. foldMap() (pipenet.js) says which faces of a part
     are one node in the SOLVE; this graph answers "which side is this on",
     and the two must not disagree - a valve whose t face folds onto l is one
     piece of steel however either graph is built. Left out, a fitting piped
     top-to-bottom had its two ends in different halves of the plant. */
  for(const p of LAY.parts){
    const f=foldFacesOf(p); if(!f) continue;
    if(Array.isArray(f)){ for(let i=1;i<f.length;i++) link(p.id+f[0], p.id+f[i]); }
    else for(const face in f) link(p.id+face, p.id+f[face]);
  }
  /* `dead` is an EDGE cut, keyed the same way `gate` is: a shut port takes its
     run out of the drawing, and a node cut cannot say that - one face may
     carry two ports and cutting the node would take the other run with it. */
  const reach=(seeds,cut,noGate,dead)=>{ const seen={}, stack=[];
    for(const n of seeds) if(!seen[n]){ seen[n]=1; stack.push(n); }
    while(stack.length){ const u=stack.pop();
      for(const v of (adj[u]||[])){
        if(seen[v] || (cut && cut[v])) continue;
        const k=(noGate||dead) ? gateKey(u,v) : null;
        if(noGate && gate[k]) continue;
        if(dead && dead[k]) continue;
        seen[v]=1; stack.push(v); } }
    return seen; };
  /* ══ A CIRCUIT IS A CONNECTED COMPONENT, AND NOTHING MORE ══
     No hop count, no distance from the core, no ordering. A chain of
     exchangers, a ring, two cores, a radiator tied back into the core - all
     just components. The core's circuit is a LOOKUP (coreCirc), never a rank,
     and it is -1 on a plant with no core: honest, there is nothing for the
     rest to be the primary OF. Walked over every node the graph knows, so a
     part piped to nothing still gets its own index rather than falling out. */
  const circuit={}; let nCirc=0;
  const allNodes=[]; for(const pid in nodesOf) for(const n of nodesOf[pid]) allNodes.push(n);
  for(const n of allNodes){ if(circuit[n]!==undefined) continue;
    const seen=reach([n]); const i=nCirc++;
    for(const m in seen) circuit[m]=i; }
  const coreSeed = (nodesOf.core||[])[0];
  const coreCirc = coreSeed===undefined ? -1 : circuit[coreSeed];
  const inCore = n => circuit[n]===coreCirc && coreCirc>=0;
  nodeGraphCache={adj, nodesOf, runPorts, circuit, nCirc, coreCirc, inCore, reach}; nodeGraphSig=sig;
  return nodeGraphCache;
}
/* ══ AN ANSWER IS ONLY AS OLD AS THE GRAPH IT WAS READ OFF ══
   Keyed on the node graph's own IDENTITY, never on a second signature: these
   are pure functions of that graph, and re-deriving the signature per call
   would rebuild four strings to be told nothing had moved. A WeakMap, so a
   superseded graph takes its answers with it and nothing has to remember to
   invalidate anything. One named slot per question. */
const graphMaps=new WeakMap();
function graphSlot(name){
  const G=nodeGraph();
  let m=graphMaps.get(G); if(!m){ m=new Map(); graphMaps.set(G,m); }
  let s=m.get(name);      if(!s){ s=new Map(); m.set(name,s); }
  return s;
}
function loopMap(){
  const s=graphSlot("loopMap"), was=s.get(1); if(was) return was;
  const G=nodeGraph(), partLoop={};
  // seeded off ROLE.sg parts directly, in LAY.parts' own order - counted,
  // never named: a generator is a placed part now (Stage 3b), not a fixed
  // "sg"+i slot buildLayout() conjured for i<D.loops.
  // Seeded on that generator's PRIMARY nodes only, and walked with the core's
  // own nodes cut out - the core is the shared hub, so crossing it would make
  // every loop one loop, which is the same exclusion the part-level walk made
  // and the reason it is a cut rather than a filter.
  /* ══ A LOOP WALK CROSSES A VALVE ONLY WHERE IT HAS TO ══
     A fitting is a COMPONENT now, so a cross-tie between two loops is two
     ordinary runs through a box and the walk goes straight down it: four
     loops read as one, P.netRefByLoop collapses to a single entry, and every
     per-loop share netFlowK() is judged against stops existing. Cutting every
     gate instead breaks the opposite case - an in-line throttle on a cold leg
     would orphan the pump beyond it from its own generator.
     Both cases fall out of one structural question, asked with no live valve
     state in it: WOULD CUTTING THIS GATE DISCONNECT? Pass one walks with
     every gate cut, so a cross-tie cannot merge two loops that each stand up
     on their own. Pass two re-walks the same seeds crossing gates, and picks
     up only what pass one could not reach at all - which is exactly the
     in-line case, where the gate is the single path. A fitting's own box is
     claimed by whichever loop reaches it first, deterministically, the same
     standing every other part in this map has. */
  let nextLoop=0;
  const cut={}; for(const n of (G.nodesOf.core||[])) cut[n]=1;
  const seeded=[];
  const claim=(p,i,noGate)=>{
    const seen=G.reach((G.nodesOf[p.id]||[]).filter(n=>G.inCore(n)), cut, noGate);
    for(const q of LAY.parts){
      if(!LOOP_ROLE[q.role] || q.id==="core" || partLoop[q.id]!==undefined) continue;
      if((G.nodesOf[q.id]||[]).some(n=>seen[n])) partLoop[q.id]=i;
    }
  };
  for(const p of LAY.parts){
    if(p.role!=="sg" || partLoop[p.id]!==undefined) continue;
    const i=nextLoop++;
    partLoop[p.id]=i; seeded.push({p,i});
    claim(p,i,true);
  }
  for(const {p,i} of seeded) claim(p,i,false);
  const out={partLoop, n:nextLoop}; s.set(1,out);
  return out;
}
/* WHICH GENERATORS' SHELLS THIS PUMP FEEDS - the whole of "is this a feedwater
   pump", asked of the drawing. A generator's secondary node is simply one of
   its nodes the core cannot reach; a pump that reaches one is pushing water
   into that shell, whatever it is called and whatever anyone declared. */
/* ══ THE DRAWING, WITH EVERY SHUT PORT VALVE TAKEN OUT OF IT ══
   nodeGraph() is a fact about the drawing and cannot carry state, so a live
   question is asked by handing its reach() an EDGE cut instead - the same
   "a shut branch is an absent branch" rule netAssemble's g<=0 skip keeps for
   the solve, which is how the primary's relief valve already respects a shut
   port for free. A run is dead only when BOTH its ports cannot pass, and a
   pair of faces joined by two runs stays live while either one is open.
   Cached on the graph window against the shut set itself: shellsLive() is
   asked once per relief valve per tick and the walk is not the cost, the
   rebuild is. */
function portDead(s){
  const shut = s && s.portShut; if(!shut) return null;
  let sig=""; for(const k in shut) if(shut[k]) sig+=k+",";
  if(!sig) return null;
  const slot=graphSlot("portDead"), was=slot.get(sig); if(was) return was;
  const G=nodeGraph(), out={};
  for(const k in G.runPorts)
    if(G.runPorts[k].every(([a,b])=>shut[a]||shut[b])) out[k]=1;
  slot.set(sig,out);
  return out;
}
function secGensFromNode(node, cut, dead){
  const G=nodeGraph();
  if(G.inCore(node)) return [];
  const seen=G.reach([node], cut, false, dead);
  return LAY.parts.filter(p=>p.role==="sg" &&
    (G.nodesOf[p.id]||[]).some(n=>seen[n] && !G.inCore(n))).map(p=>p.id);
}
/* WHICH RUNS SHORT THE TWO SIDES TOGETHER. A run with one end the core can
   reach and one it cannot is a hydraulic path from the primary straight into
   a generator's shell - past the tubes, which are the only crossing this
   plant is supposed to have. It was unreachable while the secondary carried
   no flow; it is reachable now, and it is NOT forbidden: the game never
   refuses a bad order, it carries it out and shows the cost. The solve
   already prices it, because every run is an edge - so all this owes is a
   name for it, at the bench, where a designer can still change their mind.

   Asked with the run itself CUT, and it has to be: leave it in and the walk
   crosses it, the two components merge, and the very run under test makes
   itself look innocent. */
function crossTies(){
  const G=nodeGraph(), out=[];
  for(const c of pipeMap().conns){
    const a=partOf(c.a), b=partOf(c.b); if(!a||!b) continue;
    const na=a.id+c.sa, nb=b.id+c.sb;
    if(!G.adj[na] || !G.adj[nb]) continue;
    /* Cut the run, then ask BOTH sides where they are - and ask the second
       question of the generators rather than of "not the first", or a tank on
       a dead-end branch reads as secondary purely by being unreachable. The
       stock relief tank is exactly that: cut its one run and it is connected
       to nothing at all, which is not the same thing as being on the far side
       of a generator's tubes. */
    const cut={}; cut[na]=1; cut[nb]=1;
    /* LABELLED PER END, never into one bucket. Reaching every shell from one
       seed set merged two independent secondary circuits, so a tie into shell
       A and a tie into shell B read as the same finding. Each end is walked
       on its own and the PAIR OF CIRCUIT INDICES is what comes back. */
    const side=n=>G.reach((G.adj[n]||[]).filter(v=>!cut[v]), cut);
    const A=side(na), B=side(nb);
    if(Object.keys(A).some(n=>B[n])) continue;
    const holds=(seen,pid)=>(G.nodesOf[pid]||[]).some(n=>seen[n]);
    const hasCore=seen=>holds(seen,"core");
    const shellOf=seen=>{ const q=LAY.parts.find(q=>ROLE[q.role] && ROLE[q.role].sgtr && holds(seen,q.id));
      return q?q.id:null; };
    let far=null;
    if(hasCore(A)) far=shellOf(B);
    else if(hasCore(B)) far=shellOf(A);
    if(!far) continue;
    out.push({key:c.key, a:"core", b:far});
  }
  return out;
}
/* IS THIS NODE ON THE SECONDARY? One question, one answer, one place - the
   core cannot reach it. Every caller that used to want a `side` field wants
   this instead. */
const secondaryNode=node=>!nodeGraph().inCore(node);
/* WHICH CIRCUIT A TRANSFER STAGE'S FAR SIDE IS ON. A generator has nodes on
   two of them, so "the circuit this machine is on" has no answer - the SHELL's
   does, and it is the one the core cannot reach. -1 when nothing is piped to
   it, which reads as water and is what an unplumbed shell always was. */
const shellCirc=pid=>{ const G=nodeGraph();
  const n=(G.nodesOf[pid]||[]).find(x=>!G.inCore(x));
  return n===undefined ? -1 : G.circuit[n]; };
function secGensOf(pid){
  const G=nodeGraph(), out=[];
  for(const n of (G.nodesOf[pid]||[]))
    for(const g of secGensFromNode(n)) if(!out.includes(g)) out.push(g);
  return out;
}
/* EVERY GENERATOR SHELL, AS A FEED END AND A STEAM END. The shell is the
   internal path with BOTH ends on the secondary - the same test netBuild()
   uses to find it - and it declares FEED then STEAM in that order. */
// on the graph (graphSlot()): secondaryNode() reads it, and shellsOf() walks
// this list once per shell per relief valve per frame
const shellFaces=()=>{
  const slot=graphSlot("shellFaces"), was=slot.get(1); if(was) return was;
  const out=[];
  for(const p of LAY.parts){ const R=ROLE[p.role]; if(!R||!R.sgtr||!R.internal) continue;
    for(const IN of (Array.isArray(R.internal)?R.internal:[R.internal]))
      if(secondaryNode(p.id+IN.a) && secondaryNode(p.id+IN.b))
        out.push({id:p.id, feed:IN.a, steam:IN.b}); }
  slot.set(1,out);
  return out; };
/* WHAT IS IN THIS MACHINE'S OWN STEAM CIRCUIT - is there a machine to take the
   steam, and anywhere to reject it.
   WALKED WITH EVERY SHELL CUT AT ITS FEED END, and that is the whole of it: the
   secondary is a LOOP - sg to turbine to condenser to feed pump and back to the
   shell - so plain connectivity can NEVER see a severed steam line, because the
   walk just goes round the other way up the feedwater train. Measured: cutting
   the stock steam run left turbPiped() reading 1. Cutting each shell at its feed
   end leaves the steam half of the loop, which is the half being asked about.
   A turbine and a condenser declare no internal path, so the "still one vessel"
   pass above folds their faces together and steam-in and exhaust-out are one
   walk. NOT filtered by circuit: a cross-tie IS a path, crossTies() already
   names it, and one pipe drawn round the tubes must not read as every machine
   on the plant unplumbed. */
let secCircCache=null, secCircFor=null;
function secCircuitOf(pid, seeds){
  const G=nodeGraph();
  if(secCircFor!==G){ secCircCache={}; secCircFor=G; }
  const key=pid+"|"+(seeds?seeds.join(","):"");
  if(secCircCache[key]) return secCircCache[key];
  const cut={}; for(const sh of shellFaces()) cut[sh.id+sh.feed]=1;
  const seen=G.reach(seeds||G.nodesOf[pid]||[], cut), out={sg:false, turb:false, sink:false};
  for(const p of LAY.parts){ const R=ROLE[p.role]; if(!R) continue;
    if(!(G.nodesOf[p.id]||[]).some(n=>seen[n])) continue;
    if(p.role==="sg")      out.sg=true;
    if(p.role==="turb")    out.turb=true;
    if(R.thermal==="sink") out.sink=true; }
  return (secCircCache[key]=out);
}
/* WHAT SHARE OF THE TURBINES IS ACTUALLY IN A STEAM CIRCUIT. The same move as
   roleAlive(), and a second factor beside it rather than a replacement: that
   one asks whether a machine is BROKEN, this one whether it was ever piped up,
   and a machine can be both. One unpiped of two costs half. */
// NO TURBINE IS NOT AN UNPIPED TURBINE - this is the share of the machines
// on the board that are in a whole steam circuit, and none of none is all of
// them. "There is no turbine at all" is its own warning (derived()).
const turbPiped=()=>{ const ids=LAY.parts.filter(p=>p.role==="turb").map(p=>p.id);
  if(!ids.length) return 1;
  return ids.filter(id=>{ const c=secCircuitOf(id); return c.sg&&c.sink; }).length/ids.length; };
/* CAN THIS GENERATOR SEND ITS STEAM ANYWHERE. A shell with no path to a
   turbine that can exhaust is raising steam into a closed vessel, so it takes
   no heat out of its own loop. Per machine, the standing sgFill() has. */
/* WHICH NODES STAND IN THIS SHELL'S STEAM. Seeded at the shell's own STEAM
   face - sgSteams()'s seed - and cut at every shell's FEED face AND at the
   CONDENSER, because past the condenser it is condensate. The feed cut alone
   is not enough here: the secondary is a loop, so a walk off the steam header
   arrives at the feedwater train the long way round and a condensate line
   reads as though it were full of steam.
   CUT THE TURBINE TOO and what is left is the HEADER, at shell pressure. The
   difference between the two walks is the exhaust - everything the steam
   reaches only by going through a machine that took work out of it - and the
   two sit at pressures three orders of magnitude apart, so nothing may price
   them together. */
function steamNodesOf(sgId, cutTurb, dead){
  const G=nodeGraph(), sh=shellFaces().find(s=>s.id===sgId);
  if(!sh) return {};
  const cut={};
  for(const s2 of shellFaces()) cut[s2.id+s2.feed]=1;
  for(const p of LAY.parts){ const R=ROLE[p.role]; if(!R) continue;
    if(R.thermal==="sink" || (cutTurb && p.role==="turb"))
      for(const n of (G.nodesOf[p.id]||[])) cut[n]=1; }
  return G.reach([sgId+sh.steam], cut, false, dead);
}
const sgSteams=id=>{ const sh=shellFaces().find(s=>s.id===id);
  if(!sh) return true;                       // no shell to ask of: not a machine this gates
  const c=secCircuitOf(id,[id+sh.steam]); return c.turb&&c.sink; };
/* WHICH SHELLS A PART IS EXPOSED TO, off the drawing and never stored - the
   question a relief valve on the secondary has to be able to ask, because
   which pressure it lifts on is where it was PLACED.
   Walked with every shell cut at its FEED end, the same cut secCircuitOf()
   makes and for the same reason: the secondary is a loop, so an uncut walk
   comes back round the feedwater train and a valve on the condensate line
   reads as though it were sitting on the steam header.
   Empty means the part is on the primary, or on the cold side of the
   secondary - and a relief valve there is protecting nothing that is boiling.
   `dead` (portDead(), above) is optional and it is a LIVE question, never the
   classification one: WHICH side of the plant a valve is on is a fact about
   the drawing and must not change under a hand on a port valve, or shutting
   one would turn a shell's safety valve into a primary one. */
function shellsOf(pid, dead){
  const G=nodeGraph(), cut={}, out=[];
  for(const sh of shellFaces()) cut[sh.id+sh.feed]=1;
  for(const n of (G.nodesOf[pid]||[]))
    for(const g of secGensFromNode(n,cut,dead)) if(out.indexOf(g)<0) out.push(g);
  return out;
}
// which loop a PART pools capacity with, or null if the walk
// above never reaches it from any generator - never read as "is it plumbed
// at all" (netBuild()'s own port-usage check answers that, off net.usage).
const loopOf = id => { const v=loopMap().partLoop[id]; return v===undefined?null:v; };
const ihxIds=()=>LAY.parts.filter(p=>p.role==="ihx").map(p=>p.id);
const ihxCount=()=>ihxIds().length;
/* PER kW/K, absolute. These were priced as a RATIO against the live
   suggestion, so an exchanger's mass and its heat capacity both moved when the
   core did. */
const IHX_T_PER_UA   = 8.0e-4;         // t per kW/K - vessel, tubes, intermediate loop
const IHX_HOLD_PER_UA= 7.6e-4;         // t of intermediate coolant per kW/K
/* ══ EVERY EXCHANGER PRICES ITS OWN TRANSFER COEFFICIENT ══
   IHX_UA=2.5 is gone. It existed so a second stage had SOME anchor when it
   had none of its own; an exchanger states its UA in kW/K now, and the 2.5 is
   what the bench SUGGESTS - a second stage worth two and a half times the
   generator in front of it - which is a recommendation and not a law. */
/* EQUAL MACHINES ON EQUAL SLOTS. Sizing each generator to its own loop's
   flow has been tried and is WRONG: more tubes on the busy loop move more
   heat into that shell, and a shell's pressure is its own pot, so it widened
   the very spread it was meant to close. Measured, 3 loops: 7.17/6.03/5.28
   MPa against 7.37/6.62/6.28 for equal machines. A designer builds equal
   loops; what the plant does with unequal ones is the plant's answer. */
/* ══ A GENERATOR STATES THE PRESSURE ITS SHELL IS BUILT FOR, MPa ══
   It was P.P0*0.45 written out at six sites - the secondary's design ANCHOR
   smuggled into the primary's setpoint, so raising the primary silently
   re-rated every shell on the plant and no machine anywhere stated what it
   was built to hold. It is a real quantity on the instance now, with the old
   expression left standing as the SUGGESTION: an untouched plant commissions
   on exactly the figure the multiplier used to give.
   ══ AND THE SUGGESTION IS WHAT THIS GENERATOR ACTUALLY BOILS AT ══
   It was P.P0*0.45 - a share of the PRIMARY'S PRESSURE, the last stand-in on
   the steam side, and a low-pressure primary made nonsense of it: a sodium
   loop at 0.2 MPa was suggested a 0.09 MPa steam side - a boiler barely above
   the condenser - on a plant whose coolant leaves the core at 723 K.
   A generator does not care what pressure is on the other side of its tubes.
   It cares what TEMPERATURE is, and it boils its own water SG_APPROACH below
   that. So the suggestion is saturation at (coolant programme less the
   approach): a real quantity in real units, and the same sentence for every
   fluid.

   ══ THE CEILING IS NO LONGER A GUARD ON A BROKEN CURVE - AND IT HAS NOT MOVED ══
   SG_P_MAX was 17.0 because the old two-anchor power law stopped meaning
   anything above its 6.9 MPa anchor: it read 602.7 K at 17 MPa against a real
   625.9. That reason is GONE - the curve is Antoine now and holds to 1.8 K to
   the critical point, and hfgOf() takes latent heat to zero at tc.
   It is still 17.0, and raising it was TRIED and backed out: at 20 MPa the
   generator UA that dT0 implies grows enough that the core runs past its own
   HIGH FLUX trip. Moving this needs the core/steam balance refitted with it,
   which is a job of its own. Do not raise it on the curve argument alone -
   that argument is settled and it is not the constraint.

   SG_APPROACH is the temperature difference across the tubes at rated - a
   real 25 K for a large steam generator. The old note read: a
   high-temperature core would boil water past its critical point, where this
   curve means nothing and no drum boiler exists, so it caps at what a real
   high-pressure steam plant is built for. Read off the COOLANT row, never P,
   so the bench and the tick cannot disagree and there is no commissioning
   order to get wrong. */
const SG_APPROACH = 25, SG_P_MAX = 17.0, SG_P_MIN = 0.2;
const sgDesPSuggest = () =>
  clamp(psatSec(COOLANT[D.cool].Tref - SG_APPROACH), SG_P_MIN, SG_P_MAX);
/* `?? xSuggest()`, NEVER bake(). bake() WRITES the suggestion into D the
   first time anything asks, which is right for a figure the player is
   expected to tune and wrong for one that was derived every frame until now:
   the boot-time layoutMetrics() baked a PWR's 6.975 MPa, and then choosing
   sodium left every shell still rated for pressurised water. This suggests
   and does not write, which is what the contract actually says. */
const sgDesPOf = id => D.sgDesP[id] ?? sgDesPSuggest();
/* THE PLANT-WIDE FIGURE, for the anchors that are about the steam side as a
   whole rather than about one shell - the turbine's enthalpy drop, the header,
   the UA fit. The MEAN, so a single-generator plant is exactly its own shell
   and a mixed plant is not silently rated at its strongest machine. */
function sgDesignP(id){
  if(id !== undefined) return sgDesPOf(id);
  const ids = sgIds();
  if(!ids.length) return sgDesPSuggest();
  let p = 0; for(const q of ids) p += sgDesPOf(q);
  return p/ids.length;
}
const sgUASuggest = () => { const n=Math.max(1,sgCount());
  /* THE SAME DOOR THE TICK READS. This carried its own copy of the old
     expression with D.pdes left out of it, so the bench and the tick had
     already drifted apart about the one number both fit against. */
  const dT0=Math.max(5, COOLANT[D.cool].Tref - tsatSec(sgDesignP()));
  return (n0Ref()*RATED_KW())/(n*Math.pow(Math.max(layoutMetrics().flowK,.02),UA_FLOW)*dT0); };
const ihxUASuggest = () => sgUASuggest()*2.5;
const sgUAOf  = id => D.sgUA[id]  ?? sgUASuggest(id);
const ihxUAOf = id => D.ihxUA[id] ?? ihxUASuggest(id);
const totalIhxMass=()=>{ let m=0;
  for(const p of LAY.parts) if(p.role==="ihx") m+=ihxUAOf(p.id)*IHX_T_PER_UA;
  return m; };
/* ══════════ THE RADIATOR ══════════
   This is a space game: there is nothing to reject into, so waste heat leaves
   the ship as photons and nothing else. The panel is a pot (s.radTBy, step.js)
   fed by the WATER IN IT, so where it is plumbed is the whole of what it
   cools - a panel spliced into a cold leg chills that leg, and one on the
   condenser's circulating water chills that.
   IT MUST SEE SPACE. A panel with no perimeter cell facing the skin radiates
   exactly nothing and still warms the room, and the predicate is hullCell(),
   the same one a safety valve's stack discharge asks. */
/* t per m^2 at massK 1, and it is priced against RAD_AREA_CELL rather than
   off a real panel: the area is a scale lie of order 10^5, so a real kg/m^2
   would charge the ship ten thousand times its own mass. The stock pair comes
   out at 122 t, which is the weight of one more condenser. */
const RAD_MASS_M2=6.5e-5;
/* Emissivity is real; the mass and survival columns are what make each row a
   trade rather than a strictly better coating. */
const RADCOAT=[
  ["BARE METAL",              {emis:0.30, massK:0.85, tsurvK:1.15}],
  ["WHITE PAINT",             {emis:0.85, massK:1.00, tsurvK:1.00}],
  ["HIGH-EMISSIVITY CERAMIC", {emis:0.94, massK:1.35, tsurvK:0.80}],
];
const radIds=()=>LAY.parts.filter(p=>p.role==="radiator").map(p=>p.id);
const radCount=()=>radIds().length;
const radCoatOf=id=>RADCOAT[D.radCoat[id]??1][1];
/* THE ONE FUDGE IN THIS FEATURE, and it is bought balance in graceK's sense.
   A grid cell is MPC^2 = 0.218 m^2; rejecting ~690 MW at a playable panel
   temperature needs of order 10^6 m^2, so this lies by about 10^5. The ship's
   scale already does (a 60-cell hull is 28 m and holds a 1 GW reactor) - this
   is the same lie, not a new one. Set once off the stock plant's rated
   rejection at RAD_TDES; do NOT tune it afterwards to recover output. */
const RAD_AREA_CELL=62468;             // m^2 of panel one grid cell is worth
const SIGMA=5.670374419e-8;            // W/m^2/K^4, published
const T_SPACE=3;                       // K - and (T^4 - T_SPACE^4) is T^4 to 12 digits
/* K - THE CANONICAL REFERENCE SINK. It anchors P.hTurb, P.cwC, P.condUA and
   condPDes() (step.js) and the area a panel suggests, and nothing else. It is
   NOT the sink the plant has - that is s.radTBy, off the panels actually fitted.
   Derived backwards from a real turbine figure, never chosen to preserve
   output: tsatSec(TURB_TRIP_P) is 338.6 K, less an 18.6 K working margin puts
   the condenser at 320 K at rated, less COND_DT0 puts the radiator here. */
const RAD_TDES=307;
/* Does this panel see space at all - at least one cell of its own footprint
   with an outward neighbour on the skin. hullCell() answers true off-grid, so
   a panel sitting ON the hull ring passes on its own cells. */
const radLive=id=>{ const p=partOf(id); if(!p) return false;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    for(const f in DIRV){ const d=DIRV[f];
      if(hullCell(X+d[0],Y+d[1])) return true; }
  return false; };
/* ══ A PANEL STATES ITS AREA, AND THE BOX IS A PICTURE OF IT ══
   The footprint WAS the area, which meant a 55 MW pile carried the 1200 MW
   ship's panels - the boxes are drawn by buildLayout() and no design could
   say otherwise. Measured on WINDSCALE: the fleet shed 802 MW at the design
   sink for a plant making 32, the panels settled at 140 K, and the condenser
   ran at a vacuum the steam side was never sized for, so the secondary pulled
   more heat than the core could make at any load and the plant could not hold
   its temperature programme at all.
   So the area is the QUANTITY, in m2, like every other machine on this plant,
   and the drawing SNAPS to whole cells to represent it - tankW()/tankH()'s
   idiom exactly. RAD_AREA_CELL stops being the area and becomes the scale of
   the picture. */
/* HOW MANY PANELS ARE ON THE DRAWING - a count is an answer, never an input.
   It was a fixed 2 plus whatever had been placed, so the plant carried two
   panels no design could state and none could take away. */
/* OFF D.machines AND NOT OFF LAY.parts: a panel's BOX follows its area, so
   this is asked from inside buildLayout() - before there is a drawing to ask. */
const radSrcCount=()=>{ let n=0;
  for(const id in D.machines) if(machRole(id)==="radiator") n++;
  return Math.max(1,n); };
/* ONE panel's share of what this plant has to reject, at the sink the
   condenser was priced against. Off D.power and the coolant's own efficiency,
   never derived() - the suggestion prices the panel and mass prices the
   design, so asking derived() here would ask itself. */
const radAreaSuggest=id=>RATED_KW()*1000*(1-ratedEff())
  /(radCoatOf(id).emis*SIGMA*Math.pow(RAD_TDES,4))/radSrcCount();
/* BAKED ON FIRST READ, like every other per-instance figure on this plant
   (bake(), pumpHead(), ihxUAOf()). A bare `??` re-asked the SUGGESTION every
   frame, and radAreaSuggest() divides the plant's rejection by the number of
   panels - so placing a third panel silently shrank the two already on the
   drawing, boxes and all. A suggestion prices a machine when it is bought; it
   is not a figure that may move under one already fitted. */
const radAreaOf=id=>D.radArea[id] ?? radAreaSuggest(id);
const radArea=id=>{ const p=partOf(id);
  return (p && radLive(id)) ? radAreaOf(id) : 0; };
/* ══ AND A PANEL IS A HEAT EXCHANGER ON ITS COOLANT SIDE ══
   The area says what it can radiate; this says how fast the water going
   through it can hand that heat over. Both are needed, and only one of them
   used to exist: the panel was a pot wired to the condenser by role name, so
   what it was plumbed to changed nothing at all.
   RAD_DT0 is the approach the tubes are BOUGHT at - coolant in, less panel -
   the same standing COND_DT0 has one machine downstream. */
const RAD_DT0=8;
const radUASuggest=id=>radCoatOf(id).emis*SIGMA*radAreaOf(id)
  *Math.pow(RAD_TDES,4)/1000/RAD_DT0;
const radUAOf=id=>D.radUA[id] ?? radUASuggest(id);
/* THE BOX, in whole cells - NEAREST, with a floor of 2x2. Rounding up put the
   stock ship's 15.03 cells into a 16-cell box, which is a fourth row of panel
   nobody asked for: the drawing has to snap to the area, never the area to the
   drawing. Shaped on the 5x3 the stock ship has always had. */
const radBoxCells=id=>clamp(Math.round(radAreaOf(id)/RAD_AREA_CELL),4,60);
const radW=id=>clamp(Math.round(Math.sqrt(radBoxCells(id)*5/3)),2,11);
const radH=id=>Math.max(2,Math.ceil(radBoxCells(id)/radW(id)));
/* Mass rides the CAPACITY and the coating, never the slider position - the
   rule every other capacity slider on this plant already follows. A blind
   panel still weighs what it weighs. */
/* WHAT THE PANELS CAN SHED PER KELVIN^4 - one expression, because the tick,
   the bench readout and the bench warning all price the same fleet and a
   second copy would drift. W/K^4. */
const totalRadEA=()=>{ let k=0;
  for(const p of LAY.parts) if(p.role==="radiator")
    k+=radCoatOf(p.id).emis*radArea(p.id);
  return k*SIGMA; };
/* WHERE THE PANELS WOULD SIT at a stated rejection, kW - the number the bench
   needs to size a radiator without commissioning anything. Infinity when
   there is no panel that can see space, which is the honest answer. */
const radTAt=qkW=>{ const k=totalRadEA();
  return k>0 ? Math.pow(qkW*1000/k + Math.pow(T_SPACE,4), 0.25) : Infinity; };
/* WHERE THIS SHIP'S PANELS SIT AT FULL POWER - the rating less what leaves as
   electricity. Written once because the unit is the trap: the inspector was
   handing radTAt() megawatts and quoting the stock plant at 55 K. */
const radTRated=eff=>radTAt(D.power*1000*(1-eff));
const radMass=id=>radAreaOf(id)*RAD_MASS_M2*radCoatOf(id).massK;   // t
const totalRadMass=()=>{ let m=0;
  for(const p of LAY.parts) if(p.role==="radiator") m+=radMass(p.id);
  return m; };

/* WHICH EXCHANGER STANDS IN FRONT OF THIS GENERATOR, and which generators one
   exchanger feeds. Both are the LOOP, asked of loopMap() and never of a name.
   No exchanger and the generator is heated by the core's own coolant, which is
   every plant that did not buy one. */
const ihxOf=sgId=>{ const L=loopOf(sgId); if(L===null) return null;
  const p=LAY.parts.find(q=>q.role==="ihx" && loopOf(q.id)===L); return p?p.id:null; };
const ihxSgs=id=>{ const L=loopOf(id); return L===null ? []
  : LAY.parts.filter(q=>q.role==="sg" && loopOf(q.id)===L).map(q=>q.id); };
// a run's key is "kind:aIdFace-bIdFace" (or "kind:aIdFace" for a tap, which
// has no loop identity of its own - stripped by the missing '-'). Off the
// SAME graph loopOf() reads, never a regex on the kind prefix or on "sg"/
// "pump" appearing in the string - a user-authored connection's key still
// resolves correctly because it is the PARTS that carry loop membership,
// not the label the run happens to be drawn with.
function loopOfKey(key){
  if(!key) return null;
  /* A FACE IS MANY CELLS WIDE NOW, so two routes can share one (part, face)
     pair and the loser carries a "#1" suffix (pipeMap()). It is a
     disambiguator, not part of either node's name. */
  key=key.split("#")[0];
  const ci=key.indexOf(":"); if(ci<0) return null;
  const rest=key.slice(ci+1), di=rest.indexOf("-");
  if(di<0) return null;                       // a tap-ended run has no loop identity of its own
  const aP=rest.slice(0,di-1), bP=rest.slice(di+1,-1);   // strip each node's single-letter face
  const {partLoop}=loopMap();
  return partLoop[aP]!==undefined ? partLoop[aP] : (partLoop[bP]!==undefined ? partLoop[bP] : null);
}
/* A FITTING'S OWN MASS, per INSTANCE and off its own bore - the same move
   tankMass() already makes. It was a flat 16 t per tap on the old D.fit,
   which priced a 0.20 m relief valve and a full-bore tee alike. FIT_BORE0 mirrors
   FIT_DEFAULT.bore (pipenet.js, which loads after this file), so a valve
   left at the default still costs exactly the 16 t the flat charge did. */
const FIT_MASS=16, FIT_BORE0=412.5;   // mm, the default valve - the reference the mass is per
const fittingMass=()=>{ let m=0;
  for(const id in D.fittings) m += FIT_MASS*(D.fittings[id].bore/FIT_BORE0);
  return m; };

/* ══════════ A PORT IS A CELL ══════════
   D.ports[pid] = {p, dx, dy, m} - an OFFSET from the part's own origin, and
   exactly one of dx/dy falls outside the footprint. Storing the offset rather
   than the absolute cell is what makes a port ride its part for free: moveTo()
   needs no writeback at all, unlike the tank/fitting cell writeback below.
   The FACE is derived from that offset and never stored, so the two can never
   disagree. */
function freePid(){ let n=0; while(D.ports["prt"+n]) n++; return "prt"+n; }
const partOf=id=>(LAY&&LAY.byId.get(id))||null;
/* THE FIRST MACHINE OF A ROLE ON THE DRAWING, or null. An id literal is a
   NAME TEST - the smell this codebase keeps deleting - and a blank grid has
   none of any of them, so a reader that wants "the control station" or "the
   vessel" asks the drawing and must answer for getting nothing back. */
const roleOf=role=>(LAY&&LAY.parts.find(p=>p.role===role))||null;
const roleId=role=>{ const p=roleOf(role); return p?p.id:null; };
/* WHICH SIDE OF THE PART THIS PORT IS ON, off faceOfOffset() and nothing else.
   It used to answer with its own chain of tests, whose last branch was a bare
   `else "b"` - so an offset that is on NO face, which is what a port becomes
   the moment its part grows past it, came back as a bottom nozzle sitting
   inside the machine. Its runs then traced against a face the drawing does not
   have and were dropped in silence: measured, four of the six presets
   commissioned with no circulating water at all and the condenser rejected
   full duty into a loop that was not there. NULL is the honest answer and
   every caller already asks. */
function portFaceOf(pid){
  const q=D.ports[pid]; if(!q) return null;
  const p=partOf(q.p); if(!p) return null;
  return faceOfOffset(p,q.dx,q.dy);
}
// the grid cell a port occupies, or null if its part has left the board
function portCell(pid){
  const q=D.ports[pid]; if(!q) return null;
  const p=partOf(q.p); if(!p) return null;
  return [p.x+q.dx, p.y+q.dy];
}
// which face a role will even carry a port on - the SAME ROLE.ports table
// that ports the network today, read as a whitelist rather than a count. A
// role with no ports table at all (rods, ctrl, the shields) gets no port.
function portFaceOK(partId,face){
  const p=partOf(partId), R=p&&ROLE[p.role];
  return !!R && R.ports && (R.ports["*"]!=null || R.ports[face]!=null);
}
// which face an offset from this part's origin lands on, or null if the
// offset is inside the footprint, diagonal off a corner, or more than one
// cell clear of it - a port sits ON the shell, never out in the room.
function faceOfOffset(p,dx,dy){
  const inX = dx>=0 && dx<p.w, inY = dy>=0 && dy<p.h;
  if(inX && dy===-1)  return "t";
  if(inX && dy===p.h) return "b";
  if(inY && dx===-1)  return "l";
  if(inY && dx===p.w) return "r";
  return null;
}
// every port already on this part, by cell - what "is there one here already"
// is asked of, so a toggle can find it in one lookup
function portAtCell(x,y){
  for(const pid in D.ports){ const c=portCell(pid);
    if(c && c[0]===x && c[1]===y) return pid; }
  return null;
}
/* PLACE ONE. The offset is the caller's - the hand picked a cell beside a
   machine - and the face falls out of it. Refuses a cell the role does not
   whitelist, a cell already carrying a port, and a cell something else is
   standing in. */
function addPortAt(partId,dx,dy){
  const p=partOf(partId); if(!p) return null;
  const f=faceOfOffset(p,dx,dy); if(!f || !portFaceOK(partId,f)) return null;
  const x=p.x+dx, y=p.y+dy;
  if(x<0||y<0||x>=GW||y>=GH) return null;
  if(portAtCell(x,y)) return null;
  if(occupied(null,{ports:false})[y][x]) return null;
  const pid=freePid();
  D.ports[pid]={p:partId, dx, dy};
  return pid;
}
/* REMOVING A PORT LEAVES ITS PIPE WHERE IT IS. There is nothing to delete: a
   connection is TRACED, so taking the port away simply leaves the cells
   dangling, which is exactly what an unterminated pipe looks like. */
function removePort(pid){
  delete D.ports[pid];
  buildLayout();
}

/* ══════════ A PIPE IS A CELL, AND ONE CELL IS ONE THING ══════════
   D.pipes["x,y"] = {s:<shape>, r:<rotation 0..3>}. Cell-keyed, not id-keyed:
   a pipe cell's identity IS its cell, so it carries no name, no mode, no bore
   and nothing on S - which is what gives the trace below O(1) neighbours and
   "one thing per cell" as a plain dictionary invariant.
   Pipe cells stay OUT of LAY.parts on purpose: ~150 of them would give every
   pipe a plinth, a tooltip and a hover test, would put every meter on the
   plant "in the way" of its own pipe (boxClear(), pipes.js), and would count
   as machine floor in layoutMetrics()'s exposure ratio. */
const ROT={l:"t",t:"r",r:"b",b:"l"};
const OPP={l:"r",r:"l",t:"b",b:"t"};
const FACE_NAME={l:"LEFT", r:"RIGHT", t:"TOP", b:"BOTTOM"};
const DIRV={l:[-1,0],r:[1,0],t:[0,-1],b:[0,1]};
/* <= and >= so an off-grid neighbour answers true: the skin and beyond it are
   the same side of the wall, which is what lets a face test ask this directly. */
const hullCell=(x,y)=>x<=0||y<=0||x>=GW-1||y>=GH-1;
const rotFace=(f,n)=>{ for(let i=0;i<((n%4)+4)%4;i++) f=ROT[f]; return f; };
/* One row per SHAPE, and adding a shape is adding a row. A cross carries TWO
   paths that are never joined, which is the whole of why a crossing needs no
   special case anywhere below: the face you entered on already says which of
   the two you are on. */
const PIPE_SHAPE={
  straight:{paths:[["l","r"]]},
  turn    :{paths:[["l","t"]]},
  cross   :{paths:[["l","r"],["t","b"]]},
};
const pipeKey=(x,y)=>x+","+y;
/* THE OTHER END OF THE PATH THIS FACE IS ON, or null if the cell does not
   open on that face at all. One lookup does the whole traversal. */
function pipeExit(cell,face){
  const c=D.pipes[cell]; if(!c) return null;
  const sh=PIPE_SHAPE[c.s]; if(!sh) return null;
  for(const pr of sh.paths){
    const a=rotFace(pr[0],c.r), b=rotFace(pr[1],c.r);
    if(face===a) return b;
    if(face===b) return a;
  }
  return null;
}
/* THE SHAPE AND ROTATION THAT OPENS EXACTLY THESE TWO FACES. Shared by the
   stock seeder and by the bench's own drag, so a hand-laid corner and a baked
   one are the same data. */
function pipeShapeFor(fa,fb){
  if(fa===OPP[fb]) return {s:"straight", r:(fa==="l"||fa==="r")?0:1};
  for(let r=0;r<4;r++){
    const a=rotFace("l",r), b=rotFace("t",r);
    if((a===fa&&b===fb)||(a===fb&&b===fa)) return {s:"turn", r};
  }
  return null;
}
const pipeDirOf=(a,b)=>{ const dx=b[0]-a[0], dy=b[1]-a[1];
  return dx>0?"r" : dx<0?"l" : dy>0?"b" : dy<0?"t" : null; };
/* EVERY STATE A CELL CAN BE PUT IN BY HAND, in one order. Turning `r` alone
   walks a turn round four corners and a straight between two, and NEVER
   between the two shapes - so a corner the drag guessed wrong could not be
   made a straight at all, whatever it was clicked or wheeled with. The cycle
   is the whole set instead: both straights, four corners, the crossing. One
   table, because the click and the wheel must step the same states.
   Rotations that repeat a state are left out - a straight has two, a cross
   one - or the gesture would appear to stick. */
const PIPE_CYCLE=[
  {s:"straight",r:0}, {s:"straight",r:1},
  {s:"turn",r:0}, {s:"turn",r:1}, {s:"turn",r:2}, {s:"turn",r:3},
  {s:"cross",r:0},
];
// step a cell through PIPE_CYCLE, or null if there is no pipe there. The
// current state is matched on the FACES it opens, so a cell written with a
// redundant rotation (straight r2) still finds its place in the list.
function pipeTurn(x,y,step){
  const k=pipeKey(x,y), c=D.pipes[k]; if(!c) return null;
  const faces=q=>{ const sh=PIPE_SHAPE[q.s]; if(!sh) return "";
    return sh.paths.map(pr=>[rotFace(pr[0],q.r),rotFace(pr[1],q.r)].sort().join("")).sort().join("|"); };
  const now=faces(c);
  let i=PIPE_CYCLE.findIndex(q=>faces(q)===now);
  if(i<0) i=0;
  const n=PIPE_CYCLE[((i+step)%PIPE_CYCLE.length+PIPE_CYCLE.length)%PIPE_CYCLE.length];
  D.pipes[k]={s:n.s, r:n.r};
  return D.pipes[k];
}
/* WHAT A CAP SHOULD OPEN ONTO: the neighbouring cell that is already open on
   the face pointing back at this one - a port whose face names it, or a pipe
   cell whose own path ends there. `hint` is the caller's own guess and WINS if
   it is joinable, so a deliberate cap is never moved; `skip` is the cell the
   other end of the run already took, so a one-cell run cannot answer with the
   same neighbour twice. */
function pipeJoinCell(c,hint,skip){
  const at=f=>{ const x=c[0]+DIRV[f][0], y=c[1]+DIRV[f][1];
    if(skip && skip[0]===x && skip[1]===y) return null;
    const pid=portAtCell(x,y);
    if(pid) return portFaceOf(pid)===OPP[f] ? [x,y] : null;
    return pipeExit(pipeKey(x,y),OPP[f]) ? [x,y] : null; };
  const hf=hint && pipeDirOf(c,hint);
  if(hf && at(hf)) return hint;
  for(const f in DIRV){ const n=at(f); if(n) return n; }
  return null;
}
/* LAY A RUN OF CELLS along an ordered path, stamping a straight where it goes
   on and a turn where it changes direction. `from` and `to` are the cells
   OUTSIDE each end (the two ports, or nothing) - they only ever supply the
   direction the first and last cell must open toward. A cell already carrying
   a straight becomes a CROSS where the new path runs across it, which is the
   one case D.pipes was given two paths for. */
function pipeLay(path,from,to){
  /* A RUN THAT ENDS BESIDE SOMETHING OPEN ENDS AT IT. `from`/`to` are the
     caller's guess at which way the two caps open, and the bench's guess is
     the run's own axis extrapolated - so a one-cell drag was always capped
     l-r, and re-laying a single cell taken out of a VERTICAL run stamped a
     horizontal stub that joined neither neighbour. Dragging across a port's
     face capped the same way and the trace found a butt end. That is the whole
     of "connecting two parts is random": the joint depended on which way the
     hand happened to move first, which nothing on screen says. */
  const pa=pipeJoinCell(path[0],from); if(pa) from=pa;
  const pz=pipeJoinCell(path[path.length-1],to,pa); if(pz) to=pz;
  /* ONE JOINT AND OPEN GROUND: CARRY ON STRAIGHT. A single cell with a
     neighbour on one side only still had the l-r guess on the other, so the
     first of a two-cell gap in a vertical run came out an elbow - and an elbow
     is not open on the face the second cell then needed. Filling a gap one
     click at a time laid two corners facing away from each other and joined
     nothing. Mirroring the joint is the only answer that lets the next click
     land. */
  const mir=(c,n)=>[2*c[0]-n[0], 2*c[1]-n[1]];
  if(path.length===1){
    if(pa && !pz) to=mir(path[0],pa);
    else if(pz && !pa) from=mir(path[0],pz);
    /* NOTHING ADJACENT AT ALL: read the axis off what is one cell FURTHER out.
       The middle of a three-cell gap touches only the other two holes, so it
       had no joint to read and came out horizontal whatever run it belonged
       to - filling a gap from the middle then left two cells that could not
       join it. */
    else if(!pa && !pz)
      for(const f in DIRV){ const c=path[0];
        if(!pipeExit(pipeKey(c[0]+DIRV[f][0]*2, c[1]+DIRV[f][1]*2), OPP[f])) continue;
        from=[c[0]+DIRV[f][0], c[1]+DIRV[f][1]]; to=mir(c,from); break; }
  }
  // ONE THING PER CELL: a machine's box and a port are already something, so a
  // pipe simply does not go there. Asked with pipes OUT, because an existing
  // pipe cell IS a legal thing to lay across (that is what a crossing is).
  const g=occupied(null,{pipes:false});
  for(let i=0;i<path.length;i++){
    const c=path[i];
    if(c[0]<0||c[1]<0||c[0]>=GW||c[1]>=GH||g[c[1]][c[0]]) continue;
    const prev = i>0 ? path[i-1] : from, next = i<path.length-1 ? path[i+1] : to;
    if(!prev || !next) continue;
    const din=pipeDirOf(prev,c), dout=pipeDirOf(c,next);
    if(!din||!dout) continue;
    const k=pipeKey(c[0],c[1]), have=D.pipes[k], want=pipeShapeFor(OPP[din],dout);
    if(!want) continue;
    if(have && have.s==="straight" && want.s==="straight" && have.r!==want.r) D.pipes[k]={s:"cross", r:0};
    else if(!have) D.pipes[k]=want;
  }
}
/* THE PLAINEST SQUARE DOGLEG between two cells, as the cell list BETWEEN them
   plus the far end - what a caller with no corners of its own (the stock
   seeder, a test) gets. `vFirst` leads with the vertical leg. Not a router: no
   avoidance, no search, one deterministic elbow. */
function pipePath(a,b,vFirst){
  const out=[], seen={};
  const push=(x,y)=>{ const k=pipeKey(x,y);
    if(x===a[0]&&y===a[1]) return;
    if(seen[k]) return; seen[k]=1; out.push([x,y]); };
  if(vFirst){
    const s=Math.sign(b[1]-a[1]); for(let y=a[1]; y!==b[1]; y+=s) push(a[0],y);
    const t=Math.sign(b[0]-a[0]); for(let x=a[0]; x!==b[0]; x+=t) push(x,b[1]);
  } else {
    const t=Math.sign(b[0]-a[0]); for(let x=a[0]; x!==b[0]; x+=t) push(x,a[1]);
    const s=Math.sign(b[1]-a[1]); for(let y=a[1]; y!==b[1]; y+=s) push(b[0],y);
  }
  push(b[0],b[1]);
  return out;
}
/* ══════════ THE TRACE: A CONNECTION IS FOUND, NEVER AUTHORED ══════════
   The traversal unit is a HALF-EDGE (cell, entering face). The walk starts at
   a port, steps outward, and ends one of four ways:
     off grid / bare floor      dangling - no connection
     a pipe not open on us      butt end - no connection, its own warning
     a port cell facing us      CONNECTION
     a machine box, no port     dangling - a pipe abutting a wall is no joint
   Every connection is found twice, once from each end; the a-side is kept and
   the mirror dropped, canonicalised by part id then face exactly as the old
   authoring call did, so a key is the same string whichever end it was drawn
   from.

   TWO HALVES, and the split is load-bearing rather than tidy: a connection's
   KIND is derived (runKindFor()), and that walks the fittings and asks
   nodeGraph() which side a generator's face is on - and nodeGraph() is itself
   built from connections. Naming inside the trace would be a cycle. So
   pipeTrace() is the raw geometry, with no kind and no key in it, and that is
   what nodeGraph() and runKindFor() read; pipeMap() is that plus the names.
   THE SIGNATURE COSTS MORE THAN THE ANSWER, exactly as it does for
   nodeGraph() - and this one is the longer of the two, so step() takes the
   map once and holds it for the tick (pipeMapHold()). */
let pipeTraceCache=null, pipeTraceSig="", pipeMapCache=null, pipeMapSig="", pipeMapHeld=false;
const pipeMapHold=on=>{ pipeMapHeld=!!on && !!pipeMapCache && !!pipeTraceCache; };
const pipeSrcSig=()=>laySig()+"|"+pipeSig()+"|"+portSig();
function pipeTrace(){
  if(pipeMapHeld) return pipeTraceCache;
  const sig=pipeSrcSig();
  if(pipeTraceCache && pipeTraceSig===sig) return pipeTraceCache;
  const portBy={};
  for(const pid in D.ports){ const c=portCell(pid); if(c) portBy[pipeKey(c[0],c[1])]=pid; }

  const walk=pid=>{
    const start=portCell(pid), f0=portFaceOf(pid);
    if(!start||!f0) return null;
    const cells=[];
    let d=f0, x=start[0]+DIRV[d][0], y=start[1]+DIRV[d][1];
    for(let guard=0; guard<GW*GH+4; guard++){
      if(x<0||y<0||x>=GW||y>=GH) return {cells, end:"dangle"};
      const k=pipeKey(x,y), q=portBy[k];
      if(q!==undefined) return portFaceOf(q)===OPP[d] ? {cells, end:"port", to:q} : {cells, end:"dangle"};
      if(D.pipes[k]){
        const ex=pipeExit(k, OPP[d]);
        if(!ex) return {cells, end:"butt"};
        cells.push([x,y]);
        d=ex; x+=DIRV[d][0]; y+=DIRV[d][1];
        continue;
      }
      return {cells, end:"dangle"};       // bare floor, or a box with no port here
    }
    return {cells, end:"dangle"};
  };

  const conns=[], dangling=[], seen={};
  for(const pid in D.ports){
    const w=walk(pid);
    if(!w) continue;
    if(w.end!=="port"){ dangling.push({pid, end:w.end, cells:w.cells}); continue; }
    const pair = pid<w.to ? pid+"|"+w.to : w.to+"|"+pid;
    if(seen[pair]) continue;
    seen[pair]=1;
    let pa=pid, pb=w.to, cells=w.cells;
    let fa=portFaceOf(pa), fb=portFaceOf(pb);
    const A=D.ports[pa], B=D.ports[pb];
    if(B.p<A.p || (B.p===A.p && fb<fa)){
      pa=w.to; pb=pid; cells=cells.slice().reverse();
      const t=fa; fa=fb; fb=t;
    }
    conns.push({pa, pb, a:D.ports[pa].p, sa:fa, b:D.ports[pb].p, sb:fb, cells});
  }
  /* SORTED BY FIRST CELL, so the "#n" suffix pipeMap() hands out below is
     deterministic and does not turn on object insertion order. */
  conns.sort((u,v)=>{ const a=u.cells[0]||[0,0], b=v.cells[0]||[0,0];
    return a[0]-b[0] || a[1]-b[1]; });
  pipeTraceCache={conns, dangling}; pipeTraceSig=sig;
  return pipeTraceCache;
}
/* The trace with every connection NAMED. Two of them may share a (part, face)
   pair - impossible before, ordinary now that a face is many cells wide - so
   the collision takes a "#n" suffix; index 0 stays unsuffixed, and a plant
   with one connection per face therefore produces exactly the keys it always
   did. loopOfKey() strips the suffix; every prefix test is unaffected. */
function pipeMap(){
  if(pipeMapHeld) return pipeMapCache;
  const sig=pipeSrcSig();
  if(pipeMapCache && pipeMapSig===sig) return pipeMapCache;
  const {conns, dangling}=pipeTrace();
  const byKey={}, cellOwner={}, nth={};
  for(const c of conns){
    /* THE +1 IS THE TWO HALF-CELL PORT STUBS, stated once and stated HERE: a
       run of N cells spans N+1 cell pitches between the two shells it joins,
       and both the solve (pipeNetwork()) and the bench's own rail read this
       one field rather than each doing the arithmetic. */
    c.L=(c.cells.length+1)*MPC;
    c.k=runKindFor(c.a,c.b,c.sa,c.sb);
    const base=c.k+":"+c.a+c.sa+"-"+c.b+c.sb;
    const n=nth[base]=(nth[base]===undefined?0:nth[base]+1);
    c.key = n? base+"#"+n : base;
    byKey[c.key]=c;
    for(const [x,y] of c.cells){ const k=pipeKey(x,y);
      (cellOwner[k]||(cellOwner[k]=[])).push(c.key); }
  }
  /* A CELL NO CONNECTION CLAIMS. Not the same thing as dangling: that one
     reaches a port and ends nowhere, this one was never on a walk at all. */
  const orphan=[];
  for(const k in D.pipes) if(!cellOwner[k]) orphan.push(k);
  pipeMapCache={conns, byKey, cellOwner, dangling, orphan}; pipeMapSig=sig;
  return pipeMapCache;
}
/* ══════════ ROLE: one row per part ROLE, the network + radiation contract ══════════
   Same idiom as FIT/TANK/LAYERS/DMGFX/AUTOSYS/DICE/ANN - one table, adding a
   role is adding a row. Named on the part by add(), beside col/grp/tip: grp
   is for the RAIL (how a part groups on screen - sg and pump share grp
   "loop"+i), role is for the SOLVE and the FIELD (what a part structurally
   IS - sg and pump need different rows). A part built with no role takes
   radMu()'s documented fallback (0.75) forever, exactly like every unnamed
   id used to - which is fine for ordinary steel and a lie the moment
   something is placed and meant to shield or fix a pressure. Every add()
   call below carries one; the one placeable part outside buildLayout()
   (the spare pump, design-bench.js) carries one too.

     internal  {a,b,kind} - an edge through the component, face a to face b,
               stamping `kind` onto that edge (rendering/lookup only, never
               compared). null if nothing passes through. The pressurizer
               must NOT get one: its "b" node is the loop's own fixed datum,
               and an edge to "t" would turn the relief header into a live,
               permanently-open pressurizer-to-tank path - FIT.relief.g is a
               flat 0 today and nothing else shuts that door.
     na/nb     one word, five characters at most, for each end of that path -
               what a port on that face IS, so the bench can label the two
               sides a click moves a run's end between (portPath(), below).
               On the row that declares the two faces, because the row that
               owns them is the row that can name them.
     head      true if the internal edge above also carries a pump's head -
               its OWN stated MPa, at its own speed, less its own cavitation
               (netBuild()). Requires `internal`; the path's a face is the
               SUCTION and b the discharge, which is the casing and is the
               only thing that says which way it pushes.
     fixed     There is no "datum" any more: which node a component's
               piezometric zero sits at is decided per SOLVE (netRef(),
               pipenet.js) off whichever HOLD TANK is live at the time, and
               falls back to the core when there is none.
               {type:"tank"} - every node ANY part with this role reaches is
               priced by D.tanks[part.id], off whatever face pipeNetwork()
               actually routed there this frame - never a stored face name.
               null otherwise.
     fold      faces that collapse onto the bare part id (one electrical node,
               not one per face) - the model's one core plenum, r_core=0; see
               coreFold(). null otherwise.
     mu        radiation attenuation per cell of chord crossed (radMu()) -
               keyed on what the part IS, never on p.grp: cont and hpi are
               both grp:"safety" and only one of them is a wall.
     sgtr      true if this role's tubes can rupture into their own secondary
               (netBuild()'s per-generator sgtr edge, and what busts the
               factorisation cache when one does).
     ports     A FACE WHITELIST, not a count - which faces of this role may
               ever carry a port at all (portFaceOK(), above). The numbers
               are a leftover census (the most that face was ever asked to
               carry under the old N-per-face router) and no longer cap
               anything: a port is placed one at a time, by hand, and there
               is no ceiling on how many may share a face. "*" marks a role
               whose faces are read as one pool rather than four separate
               ones (the tank-side end of relief, which picks its own face).
     thermal   "source"|"transfer"|"sink"|"none" - adds heat, moves it from
               primary to secondary, rejects it, or neither. It is READ now,
               by partTemp() (src/data/room.js): a role that moves no heat has
               no surface for the room field to take heat off, and nothing
               invents a temperature for a box that never said it had one.
     tsurv     K the machine survives in the AIR AROUND IT - electronics give
               up near 340, motors and bearings near 400, wet pressure parts
               far higher. Read by the room's damage integral (step.js) and by
               nothing else. NULL for structure: a shield, a containment wall
               and a core catcher have no electronics and no bearings, and a
               room temperature is not how any of them fails.
     pburst    kPa of blast overpressure it survives, against published
               blast-damage figures: 20 for a cabinet, 35 for sheet metal and
               a vacuum shell, 70 for heavy rotating plant, 200 for a pressure
               vessel. NULL for structure, exactly as tsurv is - and the hull
               and the keel are grid cells rather than parts, so they are
               exempt by construction and no exception is written for them. */
const ROLE = {
  core:  {internal:null, fixed:null, fold:["r","b"], mu:0.50, sgtr:false,
          ports:{r:4, b:5}, thermal:"source", tsurv:1200, pburst:200},
  rods:  {internal:null, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none", tsurv:450, pburst:35},
  /* TWO internal paths that do not meet: the tubes (l<->b, primary) and the
     shell around them (r<->t, secondary). The only way across is the sgtr
     edge, which is a LEAK and is built as one.
     `a` is the INLET on a shell path - the feed regulating valve's own head
     is signed off it (netBuild()), so the two faces are not interchangeable
     even though the conductance between them is. */
  sg:    {internal:[{a:"l", b:"b", kind:"comp", na:"HOT", nb:"COLD", la:"HOT LEG", lb:"COLD LEG"}, {a:"r", b:"t", kind:"comp", vap:"b", na:"FEED", nb:"STEAM", la:"FEEDWATER", lb:"MAIN STEAM"}], fixed:null, fold:null, mu:0.60, sgtr:true,
          ports:{l:1, b:1, t:1, r:2}, thermal:"transfer", tsurv:800, pburst:200},   // b was 2: the second slot only ever existed for the feed/cold-leg collision. r carries the secondary side - feed in, plus an emergency reserve
  /* A SECOND TRANSFER STAGE, and ONE internal path - the primary one. What an
     intermediate exchanger moves heat INTO is a pot with a temperature
     (s.ihxTBy, step.js), not a hydraulic circuit: the same standing the steam
     side already has, where the runs carry a thermal rate and no solved
     pressure drop. Every generator on its own loop takes its hot-side
     temperature from that pot instead of from Tavg.
     ONE internal path and FOUR faces, folded the way a valve body is: t onto l
     and b onto r, so the exchanger plumbs vertically or horizontally with no
     rotation knob to get wrong. It is spliced into a leg, so both ends are the
     same leg and neither is a nozzle of its own. */
  ihx:   {internal:[{a:"l", b:"r", kind:"comp", na:"HOT", nb:"COLD", la:"HOT LEG", lb:"COLD LEG"}], fixed:null,
          fold:{t:"l", b:"r"}, mu:0.60, sgtr:false,
          ports:{l:2, r:2, t:2, b:2}, thermal:"transfer", tsurv:800, pburst:200},
  /* ONE PUMP, and ONE HEAD LAW (netBuild()). There is no feedwater pump role:
     what makes a pump a feedwater pump is where it is piped, and it develops
     the same MPa it would develop anywhere else. Four nozzles a face, because
     a pump on a four-loop plant feeds four generators off its discharge and
     the same face group may carry the whole set. */
  // IN/OUT on the nozzle, SUCTION/DISCHARGE in the tooltip: the short name is
  // a LABEL sized to sit inside the joint, and every other machine's says
  // which way the water is going in the same two words
  /* ONE path, folded the way a valve body is - r onto t and l onto b - so a
     pump splices into a horizontal leg with no rotation knob: suction on the
     right, discharge on the left, the same direction the vertical box has. */
  pump:  {internal:{a:"t", b:"b", kind:"pump", head:true, na:"IN", nb:"OUT", la:"SUCTION", lb:"DISCHARGE"},
          fixed:null, fold:{r:"t", l:"b"}, mu:0.75, sgtr:false,
          ports:{t:4, b:4, r:4, l:4}, thermal:"none", tsurv:400, pburst:70},
  /* ── AND ONE PATH THAT IS NOT IN THE LIQUID MATRIX ──
     `vapPath` is the machine's own steam path, read by the VAPOUR network
     (vapBuild(), pipenet.js) and by nothing else: a liquid `internal` here
     would tie the main steam line to the exhaust through a resistance the
     water solve has no business pricing. `work` says the steam does shaft
     work crossing it, which is what tells the bypass around it apart from
     the wheels themselves. */
  turb:  {internal:null, vapPath:{a:"t", b:"b", work:true}, fixed:null, fold:null, mu:0.82, sgtr:false,
          ports:{t:4, b:1}, thermal:"none", tsurv:420, pburst:70},                  // t: one steam run per generator, up to the bench's own 4-loop ceiling
  /* TWO internal paths that do not meet, the same declaration ROLE.sg makes -
     because that is what a surface condenser IS. The steam side takes the
     exhaust in at t and gives condensate back at r; the water side (l<->b) is
     the circulating water, and the only crossing is the tube wall, which is
     heat and not an edge. Declaring them costs the exhaust a real component
     resistance where the old single folded node gave it none. */
  cond:  {internal:[{a:"t", b:"r", kind:"comp", vap:"a", anch:"ab", na:"EXH", nb:"COND", la:"EXHAUST", lb:"CONDENSATE"},
                    /* b IS THE INLET AND l IS THE OUTLET, and it was declared
                       the other way round. Measured on the stock plant:
                       comp:cond:lb solves at -16 705 kg/s, so the water runs
                       b->l, and the field agrees - 297.4 K in at the bottom
                       and 301.0 K out at the left, a 3.6 K rise across the
                       machine. Every other component on this circuit declares
                       its inlet as `a`; this one labelled its outlet CW IN. */
                    {a:"b", b:"l", kind:"comp", na:"CW IN", nb:"CW OUT", la:"CIRC WATER IN", lb:"CIRC WATER OUT"}],
          fixed:null, fold:null, mu:0.82, sgtr:false,
          ports:{t:1, r:1, l:1, b:2}, thermal:"sink", tsurv:400, pburst:35},
  ctrl:  {internal:null, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none", tsurv:340, pburst:20},
  cont:  {internal:null, fixed:null, fold:null, mu:0.30, sgtr:false,
          ports:{}, thermal:"none", tsurv:null, pburst:null},
  /* ONE ROLE FOR EVERY TANK. There is no kind: what a tank is made of, what
     is behind it and what it is plumbed to are per-instance config
     (D.tanks), never a role. mu is a tank of liquid, which shields rather
     better than bare equipment and rather worse than a wall. */
  /* ONE VESSEL, ONE NODE - a tank's faces are plainly the same water, so they
     fold like the core's plenum. A one-port tank is unaffected, and a HOLD
     tank (the pressurizer) needs the second port its surge line and its
     relief header ask for. Widening a port count is safe: portFaceOK() is a
     whitelist, not a ceiling. tsurv/pburst are the ROLE's floor and a heavy
     vessel states its own through partTsurv()/partPburst(). */
  tank:  {internal:null, fixed:{type:"tank"}, fold:["t","b","l","r"], mu:0.65, sgtr:false,
          ports:{"*":2}, thermal:"none", tsurv:420, pburst:100},
  bkp:   {internal:null, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none", tsurv:350, pburst:20},
  shield:{internal:null, fixed:null, fold:null, mu:0.18, sgtr:false,
          ports:{}, thermal:"none", tsurv:null, pburst:null},
  /* A structure with mass that used to be a checkbox and nothing on the
     grid. It gets no `fixed` - the run each one carries
     (the traced connection) lands on a node that is ALREADY reachable from the
     rest of the primary network (sg0's own "b" face, the core's folded
     node), so each hangs off it as a true pendant leaf: no fixed pressure
     and no head anywhere past that one edge means KCL forces exactly zero
     current through it, so it cannot move a single other pressure or flow
     in the solve. */
  catcher: {internal:null, fixed:null, fold:null, mu:0.55, sgtr:false,
          ports:{}, thermal:"none", tsurv:null, pburst:null},             // a structure, not a network part - no run, no ports, no exception needed
  /* A MACHINE WHOSE WHOLE JOB IS GETTING HEAT OUT OF THE BUILDING, in the
     shield/catcher idiom: a footprint and an effect, no network presence at
     all, no ports and no run. What it does is one term in the room's own
     source pass (roomStep(), src/data/room.js) - a sink at the cells it
     stands in, against the hull outside. It sits on the MAIN BOARD, so it is
     worth exactly nothing in a blackout, which is the same argument condK()'s
     circulating water makes and the reason the room is a survival problem
     rather than a purchase. It has bearings and a motor, so it has a tsurv of
     its own: the machine that keeps the room cool is in the room. */
  vent:  {internal:null, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none", tsurv:400, pburst:20},
  /* THE ONLY WAY HEAT LEAVES THIS SHIP. A pot on the hull, in the same idiom:
     a footprint and an effect, nothing to plumb. thermal:"sink" because it IS
     a surface at s.radTBy (partTemp(), room.js), so an inboard panel rejects
     nothing and cooks the compartment instead. tsurv is scaled per instance
     by the coating (RADCOAT), which is why the ceramic row is the fragile
     one. */
  /* PLUMBED, not a footprint with an effect. A panel is a heat exchanger with
     space on one side, so it carries coolant like every other one: ONE
     internal path, folded the way a valve body is (t->l, b->r) so it splices
     into a cooling leg however it is oriented. What happens at the far end -
     radiating to T_SPACE - is still not a flow path and never becomes an edge.
     Space is not a node. */
  radiator:{internal:{a:"l", b:"r", kind:"comp", na:"IN", nb:"OUT", la:"COOLANT IN", lb:"COOLANT OUT"},
          fixed:null, fold:{t:"l", b:"r"}, mu:0.35, sgtr:false,
          ports:{"*":2}, thermal:"sink", tsurv:520, pburst:15, pdes:1.0},
  /* ONE ROLE FOR EVERY FITTING. There is no kind: a tee, a branch throttle
     and a relief valve differ by `mode` on the instance (D.fittings), never
     by role - the same move that turned five tank-shaped things into one
     tank. mu is a valve body: a lump of steel, thinner than a vessel.
     internal is the GATED path through it, and `gate` is what tells
     netAssemble to price its conductance off FIT[mode] instead of the flat
     component length every other path uses. fold answers per INSTANCE
     because it depends on the mode: a tee is one node (all four faces, no
     edge, a true junction), a valve is two with the gate between them - and
     t/b fold onto l/r so a valve plumbs vertically or horizontally with no
     rotation knob to get wrong.
     ports is 2 a face: a fitting is a spool piece, and two runs a face is
     what lets one sit in-line and still be branched off. */
  fitting:{internal:[{a:"l", b:"r", kind:"fit", gate:true, vap:"ab", na:"A", nb:"B", la:"SIDE A", lb:"SIDE B"}], fixed:null,
          fold:p=>fitModeOf(p.id)==="tee" ? ["l","r","t","b"] : {t:"l", b:"r"},
          mu:0.70, sgtr:false, ports:{l:2,r:2,t:2,b:2}, thermal:"none", tsurv:600, pburst:70},
};
// what a fitting IS, asked of the instance and never of the role - the one
// reader for the fold above and for every branch in the draw and the solve
const fitModeOf=id=>(D.fittings[id]&&D.fittings[id].mode)||"tee";
/* ══ WHICH EDGE A STORED CELL IS ══
   Top-left for every part, because that is what a footprint is - EXCEPT a
   radiator, which is the one part whose height is a knob (radH(), off area).
   Anchored by its top, growing a panel walks its face off the skin, which is
   the whole heat sink gone for a reason nobody moved. It is stored by its
   BOTTOM edge, so area grows upward and the face stays where it was put.
   One pair, read by machineParts() and written by moveTo(). */
const cellStore=(role,y,h)=>role==="radiator" ? y+h : y;
const cellTop  =(role,h,v)=>role==="radiator" ? v-h : v;
/* ══════════ MACHINE: one row per KIND of machine, and the count is an answer ══════════
   The same table D.tanks and D.fittings already stand on, for everything else
   that has a box. There were four mechanisms deciding whether a machine
   exists - a literal add() in buildLayout(), a checkbox on D, a count in code
   (two panels) and a placed part - and only the last one is the game. This is the
   one that is left: a machine is an entry in D.machines, minted from a row
   here, and how many there are is however many are in the table.
   `num` is whether the kind carries an ORDINAL. A name is read off the
   drawing (buildLayout()), never stored, so RADIATOR 2 is the second panel
   on the board and stays the second panel when the first one goes.
   `rides` is a kind that is BOLTED TO another one - the rod drives sit on the
   vessel head. It is minted with its host and removed with it, it is never
   offered on its own, and dx/dy are where it stands relative to it. A machine
   that cannot exist by itself is not a machine you place. */
const MACHINE={
  core:{role:"core", w:9, h:12, col:"#ff5a45", grp:"core", name:"REACTOR",
    tip:"The vessel and the fuel inside it. Select it to choose the coolant family, the fuel, the lattice and the core shape."},
  rods:{role:"rods", w:9, h:13, col:"#c8d8dc", grp:"core", name:"ROD DRIVES",
    rides:"core", dx:0, dy:-13,
    tip:"Control rod drive mechanisms, bolted to the vessel head. They ride on the head and move with the reactor - you site the reactor, not the drives. Select for scram gear, bank worth and emergency poison."},
  sg:{role:"sg", w:3, h:6, col:"#5fd2e2", grp:"sg", name:"STEAM GEN", num:true,
    tip:"Raise this ABOVE the reactor and hot water rises into it unaided. That height difference is your blackout survival."},
  pump:{role:"pump", w:0, h:0, col:"#57d38c", grp:"pump", name:"RCP", num:true,
    tip:"A coolant pump. What it is FOR is asked of the drawing: pipe it from a condenser to a generator's shell and the same machine is a feed pump. Keep it low and reachable - it is the component most likely to need a repair under fire."},
  ihx:{role:"ihx", w:3, h:4, col:"#9ec96f", grp:"sg", name:"HEAT EXCHANGER", num:true,
    tip:"An intermediate heat exchanger. Splice it into a loop and the generators on that loop are heated by IT rather than by the core, so primary coolant never reaches the secondary. Two stages in series cost a temperature drop, and the exchanger is heavy."},
  turb:{role:"turb", w:9, h:7, col:"#f0a830", grp:"sec", name:"TURBINE", num:true,
    tip:"Draws the ship's load. It swallows its own share of steam and carries its own share of it - lose one of two and you lose half the output, not all of it. Select it to size the steam dump that absorbs a turbine trip."},
  cond:{role:"cond", w:9, h:5, col:"#5aa9d6", grp:"sec", name:"CONDENSER", num:true,
    tip:"Rejects waste heat, and it is where the feed pumps draw from. Bulky, and it wants to be near the hull."},
  radiator:{role:"radiator", w:5, h:3, col:"#b8c4cf", grp:"sec", name:"RADIATOR", num:true,
    tip:"A radiating panel. In space this is the ONLY way waste heat leaves the ship, and it must see the skin to work at all - an inboard panel sheds nothing and the plant loses its turbine. It must also be PLUMBED, because it cools the water going through it and nothing else. Select it for area and coating."},
  ctrl:{role:"ctrl", w:6, h:4, col:"#cfc9b8", grp:"crew", name:"CONTROL",
    tip:"Where your crew sits. Distance and shielding from the reactor set the dose they take."},
  cont:{role:"cont", w:6, h:3, col:"#8fa9ae", grp:"safety", name:"CONTAINMENT",
    tip:"The barrier between damaged fuel and your crew. Select it for containment type."},
  catcher:{role:"catcher", w:3, h:3, col:"#5a4a3a", grp:"safety", name:"CORE CATCHER",
    tip:"A cooled basin under the vessel. It will not save the fuel, but it stops a melted core burning through and breaching the vessel, which keeps the release contained."},
  bkp:{role:"bkp", w:3, h:5, col:"#57d38c", grp:"safety", name:"BACKUP PWR",
    tip:"Batteries or diesels keeping the pumps turning through a blackout. Keep it away from the hull."},
  shield:{role:"shield", w:3, h:3, col:"#6d8f98", grp:"shield", name:"SHIELD", num:true,
    tip:"A block of shielding. Put it between the reactor and the control room to cut crew dose. It has mass and it blocks access."},
  vent:{role:"vent", w:3, h:3, col:"#8fb8c4", grp:"safety", name:"VENT UNIT", num:true,
    tip:"Pulls compartment air overboard. It is the only thing on the plant besides the hull that takes heat OUT of the room, and it is on the main board - a blackout leaves the room with nothing but its own steel. Nothing to plumb."},
};
const machRow  = id => { const m=D.machines[id]; return (m && MACHINE[m.kind]) || null; };
const machRole = id => { const M=machRow(id); return M ? M.role : null; };
/* A BOX FOLLOWS A REAL QUANTITY WHERE THE MACHINE STATES ONE. A panel's is
   its area and a pump's is its swallow; every other kind states its floor in
   its own row. The pump pass runs in buildLayout(), because pumpW() asks the
   graph and the graph is built on the board this is assembling. */
const machineH = (id,M) => M.role==="radiator" ? radH(id) : M.h;
const machineW = (id,M) => M.role==="radiator" ? radW(id) : M.w;
/* mintMachine() is the one place a machine is built; addMachine() is the
   GESTURE on top of it and picks the lowest free slot id, because the bench
   never asks a player to name one. Same split addTank()/mintTank() has, and
   buildStockPlumbing() (pipenet.js) names its own for the same reason: a
   machine id carries no meaning whatsoever. */
function mintMachine(id,kind,x,y){
  const M=MACHINE[kind];
  D.machines[id]={kind, cell:[x,y]};
  D.machines[id].cell=[x, cellStore(M.role, y, machineH(id,M))];
  /* WHAT IS BOLTED TO THIS ONE COMES WITH IT. A reactor with no rod drives is
     not a machine anybody could build, so placing one places both - and the
     rider's id is the host's own suffix on the rider's kind, so core -> rods
     and core1 -> rods1 without a second counter to disagree with the first. */
  for(const rk in MACHINE) if(MACHINE[rk].rides===kind){
    const rid=rk+id.slice(kind.length);
    D.machines[rid]={kind:rk, cell:[x,y+MACHINE[rk].dy], on:id};
  }
  buildLayout(); return id;
}
/* A RIDER IS NOT PLACED AND IS NOT COUNTED - it is part of what it rides. */
const machRides = kind => !!MACHINE[kind].rides;
function addMachine(kind,x,y){
  let n=1; while(D.machines[kind+n]) n++;
  return mintMachine(kind+n,kind,x,y);
}
/* EVERY MACHINE ON THE PLANT, from D.machines and nothing else - the same
   pass tankParts() and fittingParts() already are. Zero machines is a legal
   plant: it reads as a ship with nothing on it, which is what it is. */
function machineParts(){
  const out=[];
  for(const id in D.machines){ const m=D.machines[id], M=MACHINE[m.kind]; if(!M||!m.cell) continue;
    const h=machineH(id,M);
    const p={id, kind:m.kind, name:M.name, w:machineW(id,M), h,
             x:m.cell[0], y:cellTop(M.role,h,m.cell[1]),
             col:M.col, grp:M.grp, tip:M.tip, role:M.role};
    if(M.rides && m.on) p.pin={to:m.on, dx:M.dx, dy:M.dy};
    out.push(p);
  }
  return out;
}

function buildLayout(){
  dTouch();          // LAY.parts is about to be a different list, and every gesture that edits D lands here
  gridSync();        // the hull may have been dragged since the last pass
  /* ONE MECHANISM. Every box on the board is an instance in a dictionary on
     D - machines, tanks, fittings - so nothing here asks whether a part is a
     slot, a checkbox or a placed spare, and there is no count in this file
     saying how many of anything to draw. */
  const A=machineParts();
  for(const p of tankParts()) A.push(p);
  for(const p of fittingParts()) A.push(p);
  /* ══ A MACHINE'S NAME IS ITS KIND AND ITS NUMBER ══
     Read off the drawing, in board order, exactly the way circNames() numbers
     a circuit - so the second panel is RADIATOR 2 and becomes RADIATOR 1 when
     the first one is taken off. Nothing is SPARE: whether a machine is
     redundancy is read off the drawing, not written into its name.
     partName() still lets the player's own name win. */
  const nth={};
  for(const p of A) if(p.kind && MACHINE[p.kind].num)
    p.name = MACHINE[p.kind].name+" "+(nth[p.kind]=(nth[p.kind]||0)+1);
  for(const p of A) if(roleHead(p.role)){
    p.w=Math.max(pumpW(p.id), p.w); p.h=Math.max(pumpH(p.id), p.h); }
  /* A PINNED PART IS DERIVED, NEVER STORED. Its parent may have been dragged
     since the last rebuild, so its own stored cell is never read. */
  for(const p of A) if(p.pin){ const t=A.find(q=>q.id===p.pin.to);
    if(t){ p.x=t.x+p.pin.dx; p.y=t.y+p.pin.dy; } }
  /* ══ A PART IN A BAD SPOT STAYS ON THE DRAWING ══
     An overlapping or out-of-bounds part used to be dropped from LAY.parts
     here, which made it invisible, un-hittable and un-draggable while still
     costing its mass - the player had put something down and the bench had
     silently eaten it. It is MARKED instead: it draws, it is red, it can be
     picked up and moved out again, and it is a HARD objection until it is
     (layoutWarnings(), design-bench.js), so a plant with one cannot be
     commissioned. The bench warns; it never refuses.
     Marked over ALL of A: moveTo() no longer refuses either, so a machine, a
     tank or a fitting can be dragged into the same hole and has to answer for
     it the same way. */
  markLimbo(A);
  /* A REBUILD THAT LANDS ON THE SAME BOARD KEEPS THE OLD OBJECT. Half a dozen
     caches - the bench rail above all - key on LAY IDENTITY to mean "the board
     changed", and massWith() (design-bench.js) writes D to price an option row
     and puts it back, so laySrcSig() moved twice per priced row. That rebuilt
     the whole rail from scratch every frame off a board nothing had touched. */
  const sig=A.map(p=>[p.id,p.name,p.w,p.h,p.x,p.y,p.col,p.grp,p.role,p.tip,p.limbo?1:0,
    p.pin?p.pin.to+","+p.pin.dx+","+p.pin.dy:""].join("|")).join(";");
  layFit=laySrcSig();
  if(LAY && layBuiltSig===sig) return;
  layBuiltSig=sig;
  // byId is built here and nowhere else: LAY.parts is only ever replaced whole
  const byId=new Map(); for(const p of A) byId.set(p.id,p);
  portReanchor(byId);
  LAY={parts:A, byId};
}
/* ══ A PORT RIDES ITS PART'S ORIGIN; IT HAS TO RIDE THE BOX AS WELL ══
   A machine's box follows a real quantity now - tankW()/tankH() off `vol`,
   radW()/radH() off area - so growing one SWALLOWS its own far-face nozzles:
   a port at dx=w is the right face of a five-wide panel and the inside of a
   six-wide one. The offset is still the only thing stored and the face is
   still derived; what this does is move the offset back onto the SAME face of
   the new box, keeping its position along that face.
   THE OLD BOX IS THE HISTORY, and buildLayout() already has it - LAY has not
   been replaced yet when this runs. Nothing is written down that was not
   written down before. Only ever called where the board actually changed,
   because the signature gate above has already returned otherwise. */
function portReanchor(byId){
  if(!LAY) return;
  // off the NEW boxes, never portCell(): that reads LAY, which is still the
  // board this pass exists to leave behind
  const key=pid=>{ const q=D.ports[pid], p=byId.get(q.p);
    return p ? (p.x+q.dx)+","+(p.y+q.dy) : null; };
  const taken={};
  for(const pid in D.ports){ const k=key(pid); if(k) taken[k]=pid; }
  for(const pid in D.ports){
    const q=D.ports[pid], was=LAY.byId.get(q.p), now=byId.get(q.p);
    if(!was || !now || (was.w===now.w && was.h===now.h)) continue;
    const f=faceOfOffset(was,q.dx,q.dy);
    if(!f || faceOfOffset(now,q.dx,q.dy)===f) continue;
    const dy=clamp(q.dy,0,now.h-1), dx=clamp(q.dx,0,now.w-1);
    const to = f==="l" ? [-1,dy] : f==="r" ? [now.w,dy]
             : f==="t" ? [dx,-1] : [dx,now.h];
    /* A COLLISION IS LEFT ADRIFT, not resolved. Two nozzles clamped onto one
       cell is a plant nobody drew, and portFaceOf() now says null for the one
       that did not move - which reads as the dead nozzle it is. */
    const k=(now.x+to[0])+","+(now.y+to[1]);
    if(taken[k] && taken[k]!==pid) continue;
    delete taken[key(pid)];
    taken[k]=pid; q.dx=to[0]; q.dy=to[1];
  }
}
/* ONE PASS, TWO CALLERS. buildLayout() runs it on the set it just built, and
   moveTo() runs it again on LAY.parts - a move does not change laySrcSig(), so
   nothing rebuilds after a drop and a mark left to the rebuild alone would be
   the answer to where the part USED to be: red on a part now standing clear,
   and nothing on the one it just landed on. */
function markLimbo(A){
  for(const p of A)
    p.limbo = p.x<0 || p.y<0 || p.x+p.w>GW || p.y+p.h>GH ||
              A.some(q=>q!==p && p.x<q.x+q.w && p.x+p.w>q.x && p.y<q.y+q.h && p.y+p.h>q.y);
}
/* EVERY ROW IS EXACTLY CELL TALL, ON BOTH SCREENS. BANDS is gone with the
   reserve dance that fed it: a machine now declares the cells its own controls
   need (buildLayout(), above), so nothing has to stretch a row to fit a strip
   and "never Y*CELL, always rowTop()" is no longer a rule anybody can break.
   rowTop() survives as the one name for it, because ~40 callers spell the
   question rather than the arithmetic - and it must keep counting past both
   ends of the grid, since a port on the very bottom edge lands on row GH. */
const rowTop=r=>GY+r*CELL;
const rowAt=py=>Math.floor((py-GY)/CELL);
const gridH = () => GH*CELL;
// a plant-space point in FRACTIONAL grid units
const gridPt=pt=>({x:(pt[0]-GX)/CELL, y:(pt[1]-GY)/CELL});
const PXc=g=>GX+g*CELL, PYc=g=>rowTop(g);
// takes cells rather than a part, so a drop PREVIEW can be measured for a
// footprint no part occupies yet - the same box the part would get, asked one
// step earlier
const grect=(x,y,w,h)=>({x:PXc(x), y:rowTop(y), w:w*CELL, h:h*CELL});
const prect=p=>grect(p.x,p.y,p.w,p.h);
// the CENTRE of a cell, in plant pixels - what a port's mark, a pipe corner
// and a nozzle are all placed on, so the three can never land a pixel apart
const cellPos=(x,y)=>[GX+(x+0.5)*CELL, rowTop(y)+CELL/2];
// A NOZZLE SITS ON THE SHELL, not in the middle of the port cell - half a
// cell of bare board between a machine and its own joint read as unconnected.
const PORT_PROUD=3.5;
function portPos(pid){
  const q=D.ports[pid], c=portCell(pid), f=portFaceOf(pid);
  if(!c||!f) return [0,0];
  const [x,y]=cellPos(c[0],c[1]);
  const p=partOf(q.p);
  // a fitting's box is one cell of glyph, so a joint drawn astride its edge
  // lands ON the symbol - stand it clear instead
  const out=p&&p.role==="fitting" ? PORT_PROUD : 0;
  return [x-DIRV[f][0]*(CELL/2-out), y-DIRV[f][1]*(CELL/2-out)];
}

/* the face of p that points at q - a nozzle should be on the side the pipe comes from,
   otherwise the run crosses the component to reach the far face and looks unconnected */
function face(p,q){
  const a=cen(p), b=cen(q), dx=b.x-a.x, dy=b.y-a.y;
  return Math.abs(dx)>Math.abs(dy) ? (dx>=0?"r":"l") : (dy>=0?"b":"t");
}
/* ══ WHICH NOZZLE THE HAND POINTED AT ══
   face() above is a DIRECTION between two box centres; this is the nearest
   EDGE of one box to a point inside it, normalised by the box's own half-span
   so a 2x4 vessel's right edge is not lost to its long axis. Not the same
   question, so not the same body - collapsing them would cost face() its
   meaning. GRID units, never pixels. Restricted to the faces the role
   declares, and it falls through to the next-nearest rather than refusing -
   the hand aimed at a box, and every box with a port has one to give. */
function faceAt(p,gx,gy){
  const R=ROLE[p.role], ps=R&&R.ports;
  if(!ps) return null;
  const any=ps["*"]!=null;
  const c=cen(p), nx=(gx-c.x)/(p.w/2), ny=(gy-c.y)/(p.h/2);
  const rank=Math.abs(nx)>Math.abs(ny)
    ? [nx>=0?"r":"l", ny>=0?"b":"t", nx>=0?"l":"r", ny>=0?"t":"b"]
    : [ny>=0?"b":"t", nx>=0?"r":"l", ny>=0?"t":"b", nx>=0?"l":"r"];
  for(const f of rank) if(any || ps[f]!=null) return f;
  return null;
}

/* A POINT ON ITS OWN STRAIGHT LINE IS NOT A CORNER. The cell path a
   connection is traced from gives one point per cell; every one of those on a
   straight stretch draws a corner the pipe does not turn at, and the polyline
   through it and the polyline without it are the same line. */
function unbend(pts){
  if(pts.length<3) return pts;
  const out=[pts[0]];
  for(let i=1;i<pts.length-1;i++){
    const a=out[out.length-1], b=pts[i], c=pts[i+1];
    const flat=Math.abs(a[1]-b[1])<=0.5 && Math.abs(b[1]-c[1])<=0.5;
    const vert=Math.abs(a[0]-b[0])<=0.5 && Math.abs(b[0]-c[0])<=0.5;
    if(!(flat||vert)) out.push(b);
  }
  out.push(pts[pts.length-1]);
  return out;
}

/* pipeNetwork() reads pipeMap() - a connection is TRACED out of the cells and
   the ports, never authored, so there is no list of runs left to go stale
   against the drawing. Its RETURN SHAPE is unchanged, and deliberately so:
   netBuild(), the break pass, drawPlant()'s stroke loop,
   pipeFlow(), pipeMeters(), pipeBreaks() and layoutMetrics() are all consumers
   of that shape. `rid` is the key, `wps` is empty (there are no draggable
   corners any more), `cells` is the run itself and `L` its length. */
function pipeNetwork(){
  /* On the graph (graphSlot()) AND on GY, which is the one piece of view the
     points are measured off - it moves on a resize and nothing else here does.
     Rebuilt per call, this was five copies of every run per frame plus one per
     tick; nothing writes to a run, so one copy serves every reader. */
  const slot=graphSlot("pipeNetwork"), was=slot.get(1);
  if(was && was.gy===GY) return was.net;
  const net=[], usage={};
  const tally=(pid,f)=>{ usage[pid+f]=(usage[pid+f]||0)+1; };
  for(const c of pipeMap().conns){
    const a=partOf(c.a), b=partOf(c.b);
    if(!a || !b) continue;               // this connection's part is not on the grid this frame
    /* One point per cell, plus both port cells, with the collinear points
       dropped - so a straight leg is one stroke and a bend is a round join,
       exactly as a hand-drawn polyline used to give. */
    const raw=[portPos(c.pa)];
    for(let i=0;i<c.cells.length;i++){ const cl=c.cells[i]; raw.push(cellPos(cl[0],cl[1])); }
    raw.push(portPos(c.pb));
    const pts=unbend(raw);
    // pa/pb are the two PORT ids this run lands on. Carried because each port
    // now has its own isolation valve (s.portShut) and the run's edge has to
    // ask about them - a node name is partId+face and cannot name one of two
    // ports sharing that face.
    net.push({k:c.k, key:c.key, rid:c.key, cells:c.cells, L:c.L,
               pts, wps:[], wp:true, nz:[true,true],
               pa:c.pa, pb:c.pb,
               a:a.id, sa:c.sa, b:b.id, sb:c.sb});
    tally(a.id,c.sa); tally(b.id,c.sb);
  }
  // which faces carry a REAL, TRACED connection - never merely a port with
  // nothing piped to it. netBuild()'s "does this part have ANY real run
  // reaching it" test reads this, and so does a relief fitting's own vent
  // target: an orphaned port must read exactly like no port at all.
  net.usage=usage;
  slot.set(1,{gy:GY, net});
  return net;
}
// which part a plant-space point lands in, or null - the grid lookup the
// bench's right-click resolve had written out by hand, wanted a second time
// by the port drag's drop test
function partAt(pt){
  const gx=Math.floor((pt[0]-GX)/CELL), gy=rowAt(pt[1]);
  return LAY.parts.find(q=>gx>=q.x&&gx<q.x+q.w&&gy>=q.y&&gy<q.y+q.h)||null;
}
/* ══ WHICH SIDE OF A MACHINE A RUN'S END IS ON, AND HOW IT MOVES ══
   There is no port PICKER. The pair of nozzles used to be searched for -
   over every free face of a against every free face of b, nearest wins -
   and that search is what put the redrawn cold leg on the pump's SUCTION
   beside the suction it already had: two runs on one node, the head edge
   left as a dead-end stub, and a plant that circulates nothing. It was also
   the last survivor of "CONNECT picked the nearest free port", a shape this
   file has now rejected six times. The hand names the face (faceAt, above)
   and a click moves it (portFlip, below).
   portPath() is the ONE predicate for "is there anything to choose here":
   the internal row a face sits on, or null. A part that declares no path is
   one node and has no sides - clicking the reactor's nozzle would be asking
   it to be somewhere it already is. A generator declares TWO paths and a
   port flips within its own: tubes to tubes, shell to shell, never across.
   Which side of a generator a run is on stays a fact about the FACE, which
   is what runKindFor() already reads to tell a cold leg from a feed line. */
const roleIns=p=>{ const R=ROLE[p.role]; if(!R||!R.internal) return [];
  return Array.isArray(R.internal)?R.internal:[R.internal]; };
function portPath(p,f){
  if(!p||f==null) return null;
  /* MATCHED ON THE NODE, never on the face letter. ROLE.radiator folds t onto
     l and b onto r, so a nozzle on a panel's top face IS its coolant inlet -
     and comparing letters said it was neither end of any path, which drew it
     grey and left it with no word at all. coreFold() is already the one
     authority here (see below); it just was not asked first. */
  const nf=coreFold(p.id+f);
  const IN=roleIns(p).find(q=>coreFold(p.id+q.a)===nf||coreFold(p.id+q.b)===nf);
  // ...and a path whose two ends FOLD onto one node is not a choice either.
  // The role says a fitting has an l<->r path, but the fold is per INSTANCE:
  // a tee is one node and a throttle is two, so asking the role alone offered
  // to move a tee's pipe from the tee to the tee. coreFold() is the one
  // authority on which faces are the same water, so it is the one asked.
  if(!IN || coreFold(p.id+IN.a)===coreFold(p.id+IN.b)) return null;
  return IN;
}
/* The word this face wears, or null where there is nothing to say. `long`
   asks for the spoken name: the short one is a LABEL, sized to sit beside a
   nozzle on the grid, and a tooltip has room to say SUCTION rather than
   SUCT. One helper, because the mark and its tooltip must never disagree
   about which side they are describing. */
/* WHICH END OF ITS MACHINE'S OWN PATH A FACE IS - "a", "b" or null, and the
   ONE place that decides it. The word, the nozzle colour and the tooltip all
   asked it separately with a bare `IN.a===f`, which is the same folded-face
   mistake in three copies. */
function portEnd(p,f){ const IN=portPath(p,f); if(!IN) return null;
  const nf=coreFold(p.id+f);
  return coreFold(p.id+IN.a)===nf ? "a" : coreFold(p.id+IN.b)===nf ? "b" : null; }
function portWord(p,f,long){ const IN=portPath(p,f); if(!IN) return null;
  return portEnd(p,f)==="a" ? (long?IN.la:IN.na) : (long?IN.lb:IN.nb); }
/* THE SPOKEN NAME OF ONE PORT: its machine, and which side of it. One helper,
   so the log line, the rail row and the tooltip cannot describe the same
   nozzle three ways. A face with no side to be on falls back to the face
   letter, which is what the drawing already calls it. */
function portLabel(pid){
  const port=D.ports[pid]; if(!port) return pid;
  const p=partOf(port.p); if(!p) return pid;
  const f=portFaceOf(pid);
  return partName(p)+" "+((f&&portWord(p,f,true))||FACE_NAME[f]||pid);
}
/* ══ THE KIND OF A CONNECTION, READ OFF WHAT THE TWO ENDS ARE ══
   One table, keyed on the unordered pair of ROLES - never on a part id, which
   is the same rule every other decision in this file already meets. A kind is
   not decoration: `hot` and `cold` are what loopOfKey() counts as a loop leg,
   `relief` is what names the two runs either side of a relief valve, and
   pipes.js colours and animates off it.
   DERIVED AT TRACE TIME, never stored: a stored kind is frozen at authoring
   and goes stale the moment anything at either end changes, which is the only
   thing the old re-naming loop existed to paper over. A pair with no row is
   "user" - grey and unnamed on purpose, and it still conducts. */
/* WHICH KINDS CARRY VAPOUR RATHER THAN LIQUID. One table: net.vapour
   (pipenet.js) marks the nodes a run of one of these reaches, and pipes.js
   draws off the same row. */
const RUN_VAPOUR={steam:1, exh:1};
const RUN_KIND={
  "core|sg":"hot", "pump|sg":"cold", "core|pump":"cold",
  // an exchanger is spliced INTO the loop, so every run reaching it is still
  // the leg it was: hot on the way out of the core, cold on the way back
  "core|ihx":"hot", "ihx|sg":"hot", "ihx|pump":"cold",
  /* AND GENERATOR TO GENERATOR IS THE MAIN STEAM HEADER. Without this row the
     header between two shells resolved sg|sg, matched nothing and came out
     k:"user" - grey, unnamed, full bore, and solved as a WATER pipe between
     two fixed shell nodes. A single-loop plant has no such run, which is why
     it took a second generator to see it. */
  "sg|turb":"steam", "sg|sg":"steam", "cond|turb":"exh",
  // the condenser is on nobody's primary, so a pump drawn to it is drawing
  // feedwater whatever else it is plumbed to
  "cond|pump":"feed",
  // the circulating-water side: a condenser rejecting into a panel, and a pump
  // pushing that water round. It is not feedwater and it is not exhaust.
  "cond|radiator":"cw", "pump|radiator":"cw", "radiator|radiator":"cw",
};
/* ══ A FITTING IS TRANSPARENT TO NAMING ══
   A tee spliced into the hot leg leaves two runs where there was one, and
   both are still the hot leg - the pipe did not stop being a hot leg because
   somebody put a junction in it. So a `fitting` end is resolved THROUGH the
   fitting's own runs to the nearest machine that is not one, and the table
   below then reads the pair it always read.
   Get this wrong and the failure is QUIET: three stock runs come out
   k:"user", loopOfKey() loses loop 0, and what
   you see is grey pipes that still conduct. Same move a tank already gets
   below, for the same reason. */
const isFitting=id=>{ const p=partOf(id); return !!p && p.role==="fitting"; };
/* `avoid` is the OTHER end of the run being named, and leaving it out is the
   whole of the bug this had first: asked what is on the far side of a tee
   spliced into the hot leg, the walk went straight back down the run it was
   naming and answered "the core", so core|core matched no row and the run
   stayed grey. */
/* A LINE THROUGH A FITTING BEATS A BRANCH OFF IT. Three legs meet at the
   stock surge tee - the core, the generator and the pressurizer - and asked
   what is on the far side of the core's leg, "the pressurizer" and "the
   generator" are both true. Taking the first one found made the answer turn on
   which connection happened to sort first, and the hot leg came out named
   `surge`. A vessel that is a boundary (the pressurizer, a tank) is what a
   line BRANCHES to; anything else is what the line CONTINUES as, so a
   continuation is preferred and the branch is only taken when it is all there
   is. */
const FIT_BRANCH_ROLE={tank:1};
/* AND A RESERVE TRAIN IS A BRANCH, the same as the tank behind it - a pump
   drawing on a reserve (pumpResOf) is that tank's discharge, not a
   continuation of the line it ties into. Without it the stock feedwater line
   was named off whichever leg of the tie sorted first and came out grey. */
const fitBranch = q => !!FIT_BRANCH_ROLE[q.role]
  || (roleHead(q.role) && pumpResOf(q.id).length > 0);
/* `out.face` comes back with the face at the machine ANSWERED, which is not
   the face the run being named lands on: a line into a generator's feed
   nozzle through a tee lands on the TEE, and asked about the generator with
   the tee's own face the shell test below read the tube side and called a
   feedwater line a cold leg. */
function throughFitting(id,avoid,seen,out){
  const p=partOf(id);
  if(!p || p.role!=="fitting") return p||null;
  seen=seen||{}; if(seen[id]) return null; seen[id]=1;
  // pipeTrace(), never pipeMap(): naming a connection is what calls this, so
  // reading the NAMED map here would be the cycle the two halves exist to break
  let branch=null, branchFace;
  for(const c of pipeTrace().conns){
    const o = c.a===id ? c.b : c.b===id ? c.a : null;
    if(o==null || o===avoid) continue;
    if(out) out.face = undefined;
    const q=throughFitting(o,avoid,seen,out); if(!q) continue;
    const f = out && out.face!==undefined ? out.face : (c.a===o ? c.sa : c.sb);
    if(!fitBranch(q)){ if(out) out.face = f; return q; }
    if(!branch){ branch=q; branchFace=f; }
  }
  if(out) out.face = branch ? branchFace : undefined;
  return branch;
}
/* A FITTING THAT LEADS NOWHERE IS ITSELF THE END OF THE RUN. A relief valve
   venting to the room has nothing beyond it, so the walk answers null - and
   the pipe reaching it came out "user", which left a generator's own steam
   nozzle carrying an unclassified fluid and stopped net.vapour ever calling
   it a steam space. What the line reaches is the valve. */
function runKindFor(aId,bId,af,bf){
  const oa={}, ob={};
  const A=throughFitting(aId,bId,null,oa)||partOf(aId), B=throughFitting(bId,aId,null,ob)||partOf(bId);
  if(!A||!B) return "user";
  if(oa.face!==undefined) af=oa.face;
  if(ob.face!==undefined) bf=ob.face;
  /* WHICH SIDE OF A GENERATOR THE RUN LANDS ON NAMES THE PIPE.
     There is no feedwater-pump role left to key the table on, so "pump|sg"
     alone cannot tell a cold leg from a feedwater line - the FACE tells it,
     and it is the same fact the solve reads: a generator's shell is the part
     of it the core cannot reach. On the shell, water goes IN and steam comes
     OUT, so what the far end IS decides which: a pump or a tank is putting
     feedwater in, and anything else - a turbine, a safety valve - is taking
     steam out. Faces unknown (an older caller), fall through to the table and
     get a cold leg, which is what the pair used to mean on its own. */
  if((A.role==="sg") !== (B.role==="sg")){
    const g = A.role==="sg" ? A : B, f = A.role==="sg" ? af : bf,
          o = A.role==="sg" ? B : A;
    if(f!=null && !nodeGraph().inCore(g.id+f))
      return (o.role==="pump" || o.role==="tank") ? "feed" : "steam";
  }
  /* A TANK'S LINE IS NAMED BY WHAT IT REACHES, not by which tank it is - there
     is no such thing as "the relief tank" or "the HPI tank", only a tank with a
     pipe drawn somewhere. On the primary side the pressurizer end makes it a
     relief header and anything else makes it an injection line; on the
     secondary side a tank feeds what it is piped to. */
  /* A HOLD TANK IS PREFERRED AS THE FAR END, never as the tank being named:
     between a relief tank and the pressurizer both ends are tanks, and taking
     the first would name the same header two ways depending on which id sorted
     first. */
  const isT = q => q.role==="tank";
  const t = (isT(A) && !tankHold(A.id)) ? A : (isT(B) && !tankHold(B.id)) ? B
          : isT(A) ? A : isT(B) ? B : null;
  if(t){
    const o = t===A? B : A;
    if(!primaryTank(t.id)) return "feed";
    /* The line that reaches the vessel authoring this circuit's pressure IS
       the surge line - the one connection a hold tank has to the loop. */
    if(tankHold(t.id)) return "surge";
    return (isT(o) && tankHold(o.id)) ? "relief" : "hpi";
  }
  return RUN_KIND[[A.role,B.role].sort().join("|")] || "user";
}
/* THE RUN JOINING TWO PARTS, by key - or null. There is no list of runs to go
   stale, so this asks the traced connections, which is where a run's identity
   lives. */
function runBetween(a,b){
  for(const c of pipeMap().conns)
    if((c.a===a&&c.b===b)||(c.a===b&&c.b===a)) return c.key;
  return null;
}
/* WHICH END OF THIS RUN IS A DEAD END, or null. A fitting with nothing on its
   far side TERMINATES the run - a safety valve on the steam header, a relief
   valve venting to the room - and that is the same question runKindFor() above
   already asks to name the KIND. Handing the machine back lets a view name the
   RUN after it, so a branch off the header is not itself called MAIN STEAM. */
function runDeadEnd(aId,bId){
  if(isFitting(aId) && !throughFitting(aId,bId)) return partOf(aId);
  if(isFitting(bId) && !throughFitting(bId,aId)) return partOf(bId);
  return null;
}
/* ══ WHICH LOOPS A FITTING JOINS ══
   The loops of the RUNS that reach it, deduplicated. Two answers come off
   this one question and they used to be two different tests:
   - netFlowK()'s per-group ceiling (pipenet.js) asks which loops an OPEN
     valve pools together;
   - resetPlant() (step.js) asks whether a valve is a CROSS-TIE, because a
     branch you have to open by hand cannot change the plant you just
     commissioned behind your back, while a valve spliced INTO a line the
     design already depends on has to commission wide open or it chokes
     whatever it was placed in.
   That second question used to be answered by `bKey` - a tap that named two
   runs was a branch, one that named one was in-line. A fitting is a box with
   two runs either way, so the shape cannot answer it; what a cross-tie IS,
   structurally, is a valve whose two sides belong to different loops, and
   that is a question the drawing answers on its own. */
/* Off the loop of what is at the FAR END of each run, never loopOfKey() on
   the run itself: a run key resolves to whichever of its two parts loopMap()
   knows, and it knows the fitting - which was claimed by whichever loop
   reached it first. Asked that way every run touching a cross-tie answers
   with the tie's own loop and the two sides never look different. */
function fitLoops(id){
  const out=[];
  for(const c of pipeTrace().conns){
    const other = c.a===id ? c.b : c.b===id ? c.a : null;
    if(other==null) continue;
    const l=loopOf(other);
    if(l!=null && out.indexOf(l)<0) out.push(l);
  }
  return out;
}
const fitTies=id=>fitLoops(id).length>1;
/* ══ A PRESSURIZER IS A TANK WHOSE GAS SPACE IS CONTROLLED ══
   `hold` is the whole of it: a knob on the instance, exactly like `pump` or
   `gas`. Nothing branches on an id, so a second hold tank on a second circuit
   is a legal design rather than a bug. */
const tankHold  = id => { const t=D.tanks&&D.tanks[id]; return !!(t && t.hold); };
const holdTankIds = () => tankIds().filter(tankHold);
/* Every hold tank standing on one circuit. More than one is a design the
   bench warns about and the solve demotes all but the first (netRef()). */
const holdOnCirc = ci => holdTankIds().filter(id=>tankCircuit(id)===ci);
/* ══ WHICH SIDE A TANK IS ON IS A QUESTION FOR THE DRAWING ══
   `side` was a field the designer set, on a control labelled "PLUMBED TO" -
   which asked the player to declare what the plumbing already said, and let
   the two disagree with nothing to catch it. It is derived now, and this is
   the third time this codebase has made exactly this move: D.loops ->
   sgCount(), p.loop -> loopOf(), side -> component membership.

     PRIMARY is the component containing the CORE. SECONDARY is the other one.

   Three cases, all stated rather than left to fall out:
   - A tank with a CELL is wherever its own nodes are.
   - A tank with NO cell has no node and never can - it is condensate inside
     another machine, not a hydraulic object. It takes its HOST's answer.
     The host is the part that draws it, found by its DECLARED role field
     (ROLE.thermal === "sink") and not by being called "cond".
   - A tank placed and piped to NOTHING is in neither component and returns
     null: not connected, not counted, exactly the rule a pump already lives
     under. It has no edge either, so there is nothing for it to be the
     primary or secondary OF. */
const hostPartOf = () => LAY.parts.find(p=>ROLE[p.role] && ROLE[p.role].thermal==="sink") || null;
// on the graph (graphSlot()): netCoreFracOf() asks this once per EDGE per solve
function tankCircuit(id){
  const t=D.tanks && D.tanks[id]; if(!t) return null;
  const G=nodeGraph(), slot=graphSlot("tankCircuit");
  const hit=slot.get(id); if(hit!==undefined) return hit;
  const circOfNodes = ns => !ns || !ns.length ? null : G.circuit[ns[0]];
  let out;
  if(!t.cell){ const h=hostPartOf();
    /* no host on the grid at all: a hosted tank is still not something the
       core can reach, so it is off the core's circuit rather than nothing. */
    const c=h && circOfNodes(G.nodesOf[h.id]);
    out = c===null || c===undefined || c===false ? -1 : c; }
  else out = circOfNodes(G.nodesOf[id]);
  slot.set(id,out);
  return out;
}
// "on the core's circuit" - what every old tankSide()==="primary" test meant
const tankPrimary = id => { const c=tankCircuit(id);
  return c!==null && c>=0 && c===nodeGraph().coreCirc; };
// connected somewhere, but not to the core's circuit
const tankSecondary = id => { const c=tankCircuit(id); return c!==null && !tankPrimary(id); };
/* Is this part id a tank on the PRIMARY side - the one predicate for "could
   catch a relief discharge". Any primary tank will do: "the relief tank" is
   not a kind of thing, it is whichever tank you happened to plumb the relief
   header to. Off ROLE and the graph, never p.id. */
function primaryTank(id){
  const p=partOf(id);
  return !!(p && p.role==="tank" && tankPrimary(id));
}

/* WHICH PARTS A WALK OVER THE CONNECTIONS REACHES FROM ONE PART - the design-time
   answer to "is this wired to that", asked with no net, no solve and no S,
   which is all the bench ever has. Any run counts, any kind: a run is a run.

   `blocks` marks a part the walk may REACH but never CROSS - pzrLive()'s
   "reached, never crossed" rule (pipenet.js), made design-shaped: a tank is
   a pressure boundary, so a path that goes in one of its nozzles and out the
   other is not a path. Omitted, nothing blocks and this is pure wiring. */
function runReach(fromId, blocks){
  /* A FACE THE PART HAS NO PORT ON IS NOT A CONNECTION. netBuild() names a
     node `partId+face` and folds only the faces ROLE declares, so a run to an
     undeclared face lands on a node nothing else touches - a dangling stub
     that draws like a pipe and conducts to nowhere. No gesture can author one
     (handles are drawn per declared face, plant.js), but D can be edited
     directly, and without this the bench read such a run as plumbed while the
     solve did not. `null` means "resolve live" and is always legal. */
  const portOK=(pid,face)=>{
    if(face==null) return true;
    const p=partOf(pid), R=p&&ROLE[p.role];
    return !!R && (R.ports["*"]!==undefined || R.ports[face]!==undefined);
  };
  const link=[];
  for(const c of pipeTrace().conns){
    if(!portOK(c.a,c.sa)) continue;
    if(!portOK(c.b,c.sb)) continue;
    link.push([c.a,c.b]);
  }
  const seen=new Set([fromId]), stack=[fromId];
  while(stack.length){
    const u=stack.pop(), pu=partOf(u);
    if(u!==fromId && blocks && pu && blocks(pu)) continue;
    for(const [a,b] of link){
      const v = a===u ? b : b===u ? a : null;
      if(v===null || seen.has(v) || !partOf(v)) continue;
      seen.add(v); stack.push(v);
    }
  }
  return seen;
}
/* A soft, honest "nothing removes heat" warning (design.js's derived()) -
   topological only, off the traced connections alone: Stage 6 is what would let this READ
   the loop, so today it can only ask whether anything that COULD reject
   heat is wired to the primary at all. Nothing blocks: heat crosses a tank
   as happily as it crosses anything else. */
function hasHeatSink(){
  if(!roleOf("core")) return true;   // no core, no claim to make
  for(const pid of runReach("core")){ const p=partOf(pid), R=p&&ROLE[p.role];
    if(R && (R.thermal==="sink"||R.thermal==="transfer")) return true; }
  return false;
}
/* IS THE PRESSURIZER PLUMBED TO THE LOOP AT ALL - the bench's design-time
   half of pzrLive() (pipenet.js), which the tick asks off the solved network
   instead. The bench cannot ask that one: it has no commissioned P and no S,
   and pzrLive() needs both (P.Pcont, every valve position). So this asks the
   WIRING, and the two agree on the only case a designer can be at fault for
   - no pipe reaches the vessel. They differ on an operating decision, a
   valve shut on a line that is drawn, which is not a design fault and must
   not raise a design warning.

   Asked of a HOLD TANK and of the circuit it stands on, never of an id: the
   seed is the lowest-id non-tank part on that circuit, so a hold tank on the
   secondary is checked against the secondary's own machinery. */
function seedPart(ci){
  if(ci===nodeGraph().coreCirc && roleOf("core")) return "core";
  const G=nodeGraph();
  const cand=LAY.parts.filter(p=>p.role!=="tank" &&
    (G.nodesOf[p.id]||[]).some(n=>G.circuit[n]===ci)).map(p=>p.id).sort();
  return cand[0] || null;
}
function holdPlumbed(tid){
  const ci=tankCircuit(tid);
  if(ci===null || ci===undefined) return false;     // piped to nothing at all
  const from=seedPart(ci);
  if(!from) return false;                           // a vessel with nothing but boundaries around it
  return runReach(from, p=>p.role==="tank").has(tid);
}
// every hold tank on the plant is wired, or there is none to be wired
const pzrPlumbed = () => holdTankIds().every(holdPlumbed);
// BACKUP PWR ghosts rather than vanishes: NONE is a real dropdown choice
// (mass 0) that still occupies its cell, because it is a three-way quality
// dial (NONE/BATTERY/DIESEL) on a machine that IS on the board.
const fitted=p => p.role==="bkp" ? D.bkp>0 : true;
const cen=p=>({x:p.x+p.w/2,y:p.y+p.h/2});
const pinnedTo=p=>LAY.parts.filter(q=>q.pin&&q.pin.to===p.id);
/* WHAT IS STANDING IN EACH CELL. skip is one part or a whole group - a group
   move lifts parent and pinned children off the grid together, or the parent
   collides with its own child.
   TWO CALLERS ASK TWO DIFFERENT QUESTIONS OF THE SAME GRID, so pipes and
   ports are flags rather than always-on. groupFits() wants them IN (a machine
   must not land on its own pipework, and a port is a real object in a cell);
   freeAdj() wants pipes OUT, because a machine ringed by the pipes it needs
   would otherwise block its own repair and so block commissioning. */
/* On the graph (graphSlot()) - this grid is built from exactly what that graph
   is built from (LAY.parts, D.ports, D.pipes), and a frame asks for the whole
   of it a dozen times. Only the SKIPLESS grid: a skip is a what-if about a
   part standing somewhere else, so it is nobody's shared answer. No caller
   writes to the grid it is handed. */
function occupied(skip,opt){
  const off = skip ? (Array.isArray(skip)?skip:[skip]) : [];
  const wantPipes = !opt || opt.pipes!==false;
  const wantPorts = !opt || opt.ports!==false;
  const slot=graphSlot("occupied"), key=(wantPipes?"p":"-")+(wantPorts?"o":"-");
  if(!skip){ const hit=slot.get(key); if(hit) return hit; }
  const g=new Array(GH); for(let Y=0;Y<GH;Y++) g[Y]=new Array(GW).fill(null);
  for(const p of LAY.parts){ if(off.includes(p)) continue;
    for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
      if(X>=0&&X<GW&&Y>=0&&Y<GH) g[Y][X]=p; }
  if(wantPorts) for(const pid in D.ports){
    const q=D.ports[pid], owner=partOf(q.p);
    if(!owner || off.includes(owner)) continue;
    const c=[owner.x+q.dx, owner.y+q.dy];
    if(c[0]>=0&&c[0]<GW&&c[1]>=0&&c[1]<GH && !g[c[1]][c[0]]) g[c[1]][c[0]]={id:pid, port:true};
  }
  if(wantPipes) for(const k in D.pipes){
    const i=k.indexOf(","), X=+k.slice(0,i), Y=+k.slice(i+1);
    if(X>=0&&X<GW&&Y>=0&&Y<GH && !g[Y][X]) g[Y][X]={id:"pipe:"+k, pipe:true};
  }
  if(!skip) slot.set(key,g);
  return g;
}
// all of a group is tested before any of it moves, so it never half-lands.
// A PART'S OWN PORTS MOVE WITH IT, so they are tested too - drag a machine so
// one of its nozzles would land inside another machine or on a pipe and the
// drop is refused, exactly as it is for the footprint itself.
function groupFits(cells){
  const g=occupied(cells.map(c=>c.q));
  const blocked=(X,Y)=>X<0||Y<0||X>=GW||Y>=GH||!!g[Y][X];
  for(const {q,x,y} of cells){
    if(x<0||y<0||x+q.w>GW||y+q.h>GH) return false;
    for(let X=x;X<x+q.w;X++) for(let Y=y;Y<y+q.h;Y++) if(g[Y][X]) return false;
    for(const pid in D.ports){ const pt=D.ports[pid];
      if(pt.p!==q.id) continue;
      if(blocked(x+pt.dx, y+pt.dy)) return false; }
  }
  return true;
}
/* WHAT A MOVE WOULD FILL, asked before it happens: the part plus everything
   pinned to it. The drag reads it to know what is riding along (a part's own
   pinned child is not something to pipe to) and the bench reads it to draw the
   landing preview, so the picture and the move can never disagree about where
   the group is going. */
const moveCells=(p,nx,ny)=>[{q:p,x:nx,y:ny}].concat(
  pinnedTo(p).map(q=>({q,x:nx+q.pin.dx,y:ny+q.pin.dy})));
/* A DROP IS NEVER REFUSED. groupFits() is still asked - by partGhost(), which
   colours the landing preview red - but it no longer vetoes the move: a part
   dropped where it does not fit lands there, draws red, and blocks
   commissioning until it is moved out (p.limbo, buildLayout()). A refused drop
   was a gesture that did nothing and said nothing, and the part it refused to
   move was the one the player was looking at. */
function moveTo(p,nx,ny){
  if(p.pin) return false;
  const cells=moveCells(p,nx,ny);
  /* A tank is rebuilt from D.tanks on every buildLayout(), so its cell has to
     land back there or the move is undone by the next unrelated rebuild.
     moveTo() is the ONLY way a part changes position, so this is the one
     place that has to know it. */
  for(const {q,x,y} of cells){ q.x=x; q.y=y;
    if(D.machines[q.id]) D.machines[q.id].cell=[x, cellStore(q.role,y,q.h)];
    if(D.tanks[q.id])    D.tanks[q.id].cell=[x,y];
    if(D.fittings[q.id]) D.fittings[q.id].cell=[x,y]; }
  dTouch();                        // moves a part without rebuilding LAY - see dTouch() (design.js)
  markLimbo(LAY.parts);
  return true;
}
// every cell a party could stand in beside p and still be working ON p - not
// inside its footprint, not diagonal-only off a corner, and not already
// occupied by something else. One definition shared by three questions:
// layoutMetrics() asks whether this list is empty (REPAIR ACCESS), the
// radiation field asks which entry in it reads coldest (rad.js, radParty()),
// and a survey renderer asks for the whole list to outline.
// `g` is occupied(null,{pipes:false}) at every caller: a machine's own
// pipework must not be able to wall it in and block its own repair.
function freeAdj(p,g){
  const out=[];
  /* A MACHINE'S OWN NOZZLE DOES NOT WALL IT IN. A four-way tee carries a port
     on every face by construction, so counting its own ports as walls said
     that every correctly plumbed junction on the plant was unreachable - and
     the bench said so in red on every plant with more than one loop. */
  const own = c => c && c.port && D.ports[c.id] && D.ports[c.id].p===p.id;
  for(let X=p.x-1;X<=p.x+p.w;X++) for(let Y=p.y-1;Y<=p.y+p.h;Y++){
    if(X<0||Y<0||X>=GW||Y>=GH) continue;
    const inside = X>=p.x&&X<p.x+p.w&&Y>=p.y&&Y<p.y+p.h;
    const edge = (X<p.x||X>=p.x+p.w)!==(Y<p.y||Y>=p.y+p.h);
    if(!inside && edge && (!g[Y][X] || own(g[Y][X]))) out.push([X,Y]);
  }
  return out;
}
/* IS THE BOARD THE ONE D DESCRIBES. Split out of layoutMetrics() because a
   frame has to ask it BEFORE laySettle(): settle first and the window would
   hold a graph read off the board the player has just left. */
/* sigFresh() FIRST, and this is the one place that runs it: it is the raw pass
   that catches a design edit nobody declared with dTouch(), so the cached
   signatures below cannot answer for a board the player has already changed.
   Both a painted frame and simFrame() call this, so a validation run - which
   paints nothing at all - is checked on exactly the same schedule. */
const layFresh=()=>{ sigFresh(); if(!LAY||layFit!==laySrcSig()) buildLayout(); };
function layoutMetrics(){
  layFresh();
  /* A BLANK GRID HAS NO VESSEL, so every figure measured FROM one is measured
     from the middle of the hull instead - and reads as nothing, which is what
     it is. Nothing here refuses to answer. */
  const P_=LAY.parts, core=roleOf("core"), cc=core?cen(core):{x:GW/2,y:GH/2};
  let head=0, n=0;
  for(const p of P_) if(p.role==="sg"){ head += (cc.y - cen(p).y); n++; }
  head = n? head/n : 0;
  let pipe=0, sec=0, dead=0, pmass=0;
  /* ══ AND THE SAME METRES, LOOP BY LOOP ══
     `pipe` is the whole plant's primary run and cannot answer how well it
     CIRCULATES: loops are in PARALLEL, so a second one is a second path and
     not another kilometre of the first. Summed into one bucket it read as
     series, and every loop a designer added derated the plant that bought it
     - a four-loop ship suggested a turbine two thirds the size of a one-loop
     ship's off the same core. Charged by loopMap(), the same walk the solve
     itself is judged per loop against; a primary run on no loop (the surge
     line, an injection leg, a cross-tie) is shared and is split over them. */
  const LM=loopMap(), nLoop=Math.max(1,LM.n), loopL=new Array(nLoop).fill(0);
  let sharedL=0;
  for(const r of pipeNetwork()){
    const L=r.L;
    pmass += L * runMassPerM(r);
    /* A relief line is a DEAD LEG: it sits shut behind its valve and carries
       no flow until something lifts, so its water is not moving and adds no
       inertia to a loop transient. It still has to be built and hung, so it
       still costs mass - that is the whole cost of a relief path, and it is
       meant to be felt on the budget, not as a plant that coasts down
       differently for owning a valve it has never opened. */
    if(r.k==="relief") dead+=L;
    // a cross-tie is a parallel branch, not another metre of loop, so it pays
    // mass/inertia with the secondary runs and never slows the pumps down
    else if(r.k==="hot"||r.k==="cold"||r.k==="surge"||r.k==="hpi"){ pipe+=L;
      const li = LM.partLoop[r.a] ?? LM.partLoop[r.b];
      if(li===undefined) sharedL+=L; else loopL[li]+=L; }
    else sec+=L;
  }

  const hull=p=>{ let k=0; for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
      if(X===0||X===GW-1||Y===0||Y===GH-1) k++; return k; };
  let cells=0, exp=0;
  for(const p of P_){ if(p.grp==="shield"||!fitted(p)) continue; cells+=p.w*p.h; exp+=hull(p); }
  const exposure = cells? exp/cells : 0;

  const g=occupied(null,{pipes:false});
  let reach=0, tot=0;
  for(const p of P_){ if(p.grp==="shield"||!fitted(p)) continue; tot++;
    const ok=freeAdj(p,g).length>0;
    p.access=ok; if(ok) reach++;
  }
  const access = tot? reach/tot : 1;   // nothing on the board is nothing walled in

  // Crew dose is not a correlation any more - it is the radiation field
  // (rad.js) read at the room the crew actually sit in. The old formula
  // counted every shield inside the core->ctrl bounding box whether or not
  // it stood in the beam; the field instead attenuates along the exact ray,
  // so the bench number and the picture on the diagram can never disagree
  // about the same arrangement.
  const radK=radGeom(), radF=radSolve(radK,radSrc(null));
  const dose=radAt(radF,radK.crew), peak=radPeak(radF);

  let sep=99;
  const sgs=P_.filter(p=>p.role==="sg");
  if(sgs.length>1) for(let i=0;i<sgs.length;i++) for(let j=i+1;j<sgs.length;j++){
    const a=cen(sgs[i]), b=cen(sgs[j]);
    sep=Math.min(sep,Math.abs(a.x-b.x)+Math.abs(a.y-b.y));
  }
  // the steam bubble has to sit at the top of the loop, and the accumulator drains downhill
  let loopTop=core?core.y:GH;
  for(const q of P_) if(q.role==="sg") loopTop=Math.min(loopTop,q.y);
  // asked of every hold tank on the plant - the lowest one decides, because a
  // bubble that cannot form anywhere is what costs the damping
  const pzrOK = holdTankIds().every(id=>{ const q=partOf(id); return !q || q.y<=loopTop; });
  const pzrK  = pzrOK ? 1 : 0.45;
  /* WIRED, which is a weaker condition than "highest point" and was the one
     nobody checked - so the bench refused a subtle bad design and waved
     through an impossible one. It costs the plant nothing here: pzrK is
     elevation only, and what an unplumbed vessel actually costs is decided
     in the tick, off the solved network (pzrLive(), pipenet.js). */
  const pzrConn = pzrPlumbed();
  /* The steam half of the same question pzrConn asks of the surge line: WIRED,
     which nothing checked, so the bench waved through a plant whose turbine was
     a decoration. A pump that is on no loop and reaches no shell is piped to
     neither side of the plant. */
  const turbConn  = turbPiped();
  const sgNoSteam = P_.filter(p=>p.role==="sg" && !sgSteams(p.id)).map(p=>p.id);
  /* A SHELL WITH NO RELIEF PATH. There is no invisible lid on this plant: a
     generator that cannot get rid of the steam it is raising bursts, so
     whether anything is fitted to take it is a design question and belongs on
     the bench. Off the drawing, like every other warning here. */
  const sgNoRelief = P_.filter(p=>p.role==="sg" && !reliefsOnShell(p.id)).map(p=>p.id);
  /* AN EXCHANGER ON NO LOOP HEATS NOTHING. It is spliced into a loop or it is
     a box: with no generator behind it there is nothing for its pot to feed,
     and with no loop at all it is not even in the primary. */
  const ihxIdle   = P_.filter(p=>p.role==="ihx" && !ihxSgs(p.id).length).map(p=>p.id);
  /* A PUMP WITH NOTHING ON ITS DISCHARGE. Direction is the casing now, so
     this is a question about the drawing and not about what the pump is for:
     whatever the b face folds onto (fold, ROLE.pump) is where the water
     leaves, and a face with no run on it pushes into a blank plate. It
     replaces feedNoSg, which fired only for a pump that was neither primary
     nor feed nor sink - three kinds, none of them a fact about the plumbing. */
  const pumpNoDis = P_.filter(p=>{
    if(!roleHead(p.role)) return false;
    const R=ROLE[p.role], IN=(Array.isArray(R.internal)?R.internal:[R.internal]).find(x=>x.head);
    const f=R.fold||{}, faces=[IN.b].concat(Object.keys(f).filter(k=>f[k]===IN.b));
    const use=pipeNetwork().usage||{};
    return !faces.some(face=>use[p.id+face]>0);
  }).map(p=>p.id);
  /* Metres above the core, per TANK - measured, not a clamped multiplier on
     an injection rate that no longer exists. Elevation is LIVE for a tank
     like every other node's: it enters the solve as the static head of the
     tank's own column (pipenet.js), so moving one on the bench changes what
     it delivers without re-commissioning anything.
     A MAP, because there is no privileged tank to hand one number back for -
     that scalar was named hpiZ and was the last thing in this file that knew
     a tank by name. */
  const tankZ = {};
  for(const q of P_) if(q.role==="tank") tankZ[q.id] = (cc.y-cen(q).y)*MPC;
  /* The one figure the bench can print for a WHOLE PLANT: the worst head of
     any tank that could inject. "Could inject" is a check valve on a primary
     tank - a structural fact, not a name - because a non-return valve is what
     makes a tank a source rather than a sink. No tank on the grid can, so
     there is nothing to warn about, and 0 is the honest answer. */
  let injZ = null;
  for(const q of P_){ const t=q.role==="tank" && D.tanks[q.id];
    if(t && tankPrimary(q.id) && t.check) injZ = injZ===null ? tankZ[q.id] : Math.min(injZ, tankZ[q.id]); }

  // pmass, not (pipe+sec+dead)*1.6: a metre of pipe is priced by its bore and
  // by what is inside it (runMassPerM(), pipenet.js), so a low-pressure loop
  // is lighter and an exotic-alloy one is not. Fitted to leave the stock PWR
  // exactly where the flat rate had it.
  const mass = pmass + P_.filter(p=>p.grp==="shield").length*30;
  layMass = mass;
  /* ══ WHAT THE PLANT CIRCULATES, AND IT IS A MEAN ══
     Loops are in PARALLEL and they SHARE the core's one flow, so each pump is
     a share of it (pumpFlowSuggest()) and each loop carries its own share
     against its own friction: n conductances in parallel, each driven by 1/n
     of the head, is the MEAN of them. Summed as one long pipe instead - which
     is what the total metre count was - every loop a designer added derated
     the plant that bought it, and a four-loop ship suggested a turbine two
     thirds the size of a one-loop ship's off the same core. A single loop is
     the same arithmetic it always was. */
  const loopK = loopL.map(L=>1/(1+0.006*(L+sharedL/nLoop)));
  const flowK = loopK.reduce((a,k)=>a+k,0)/nLoop;
  /* natK is gone. Buoyancy is an edge head in the pipe network now
     (pipenet.js), so the thermosiphon is solved off exactly the geometry
     `head` measures instead of being predicted from it by a second formula
     standing beside the solve - and unlike a correlation, the solve can tell
     one steam generator from another, and can tell a shut valve from an open
     one. `head` stays: it is what the bench shows, and it is now what
     actually drives the thing it is named after. */
  return {pipe,sec,dead,head,exposure,access,dose,sep,mass,pzrOK,pzrK,pzrConn,turbConn,sgNoSteam,sgNoRelief,ihxIdle,pumpNoDis,tankZ,injZ:injZ===null?0:injZ,radK,peak,
    flowK,
    inertiaK: 1+0.012*(pipe+sec)};
}
// The arrangement half of designSig(): id + grid position of every part on
// the board, live parts only (no D fields, no lattice). rad.js's kernel
// cache keys on exactly this - a shield sliding one cell invalidates it, a
// bench slider that leaves every part where it stood does not.
// LAY is null before the first buildLayout(), and sigFresh() asks every
// signature on a frame that may be that one
const laySig = sigMemo(() => LAY ? LAY.parts.map(p=>p.id+":"+p.x+","+p.y).join(";") : "");

/* PER-TABLE SIGNATURES, not JSON.stringify(D). ~150 D.pipes entries lengthen
   that string a long way, and dbPanelSig compares it every frame - it was
   already a measured 5.6 ms hot spot before a pipe was a cell. The one D
   table left whole is the scalar config, which is small. */
const D_SCALARS=()=>{ const o={};
  for(const k in D) if(k!=="pipes" && k!=="ports" && k!=="tanks" && k!=="fittings") o[k]=D[k];
  return JSON.stringify(o); };
// every knob on a tank or a fitting: laySrcSig() carries only what puts a box on
// the board, so a lift point or a setpoint moved nothing the bench compares
const D_PARTPARAM=()=>JSON.stringify(D.tanks)+"|"+JSON.stringify(D.fittings);
// latSig() joins the key because most of what a lattice pen changes (a
// reflector face, a cluster slot, active length) is NOT a D field - without
// it a commissioned plant could go quietly out of date with the bench
function designSig(){ return D_SCALARS()+D_PARTPARAM()+laySrcSig()+"|"+latSig()+"|"
  +LAY.parts.map(p=>p.id+":"+p.x+","+p.y).join(";"); }
