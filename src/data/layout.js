"use strict";

// CELL is a RENDERING size, not a physical one - a run is measured in CELLS
// (one grid cell of pipe each) and MPC is the only thing that says how big a
// cell really is. The grid is three times DENSER than the original 16x9 and
// MPC is a third of what it was, so a cell is a third of the machine it used
// to be; on top of that the hull itself is bigger, because a plant laid out
// cell by cell needs lanes for its own pipework as well as room for its boxes.
const GW=60, GH=34, CELL=16, GX=12, MPC=1.4/3;   // metres per cell
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
let LAY=null, layFit="", sel="core", layMass=0;
// parts optionally present at a FIXED slot: buildLayout() gates add() on
// get(), layoutMetrics() rebuilds when any of it changes, and the right-click
// menu is generated from it. A part placed at a slot of the player's choosing
// (spare pump, junction) doesn't fit this shape - see PLACED PARTS below.
const fittableList=()=>[
  {id:"cont", label:"CONTAINMENT",         get:()=>D.contFit, set:v=>{D.contFit=v;}},
  {id:"turb", label:"TURBINE",             get:()=>D.turbFit, set:v=>{D.turbFit=v;}},
  {id:"cond", label:"CONDENSER",           get:()=>D.condFit, set:v=>{D.condFit=v;}},
  {id:"catcher",  label:"CORE CATCHER",        get:()=>D.catcher,  set:v=>{D.catcher=v;}},
  /* NO TANK ROW HERE, and that is the point. A tank is not a checkbox that
     upgrades or conjures a named system - it is a component you ADD, as many
     as you like, and configure per instance (D.tanks, design.js). PASSIVE
     ACCUMULATOR, EMERGENCY FEEDWATER, BORON INJECTION and RELIEF TANK were
     four rows here and they were one component wearing four names. */
];
const checkOf=id=>fittableList().find(f=>f.id===id).get();
const checkSig=()=>fittableList().map(f=>f.get()?1:0).join("");
/* WHAT buildLayout() READS, all of it. It used to be checkSig() alone, which
   was true only while every part was either always there or behind a
   checkbox. A tank is neither: it is an instance, and its id and its cell
   are the two things that decide what box goes on the board. Leave them out
   and editing D.tanks directly - a rename, a tank moved, a tank the bench
   just reconfigured - leaves LAY holding parts that no longer exist, and the
   runs pointing at them silently stop routing. */
const tankSig=()=>{ let out="";
  for(const id in D.tanks){ const t=D.tanks[id], c=t.cell;
    // vol too: a tank's BOX SIZE follows it (tankW/tankH), so a slider on its
    // own panel changes what stands on the grid, not just what it holds
    out += "|"+id+":"+(c?c[0]+","+c[1]:"-")+":"+t.vol; }
  return out; };
/* A FITTING IS A PART TOO, so the same argument tankSig() makes applies: its
   id and its cell decide what box goes on the board, and its MODE decides
   which faces are one node (foldFacesOf()). Leave any of the three out and a
   direct D.fittings edit leaves LAY holding a box that no longer exists. */
const fittingSig=()=>{ let out="";
  for(const id in D.fittings){ const f=D.fittings[id], c=f.cell;
    out += "|"+id+":"+(c?c[0]+","+c[1]:"-")+":"+f.mode; }
  return out; };
/* A PORT'S id, part, offset and mode all decide what's on the board - same
   argument tankSig()/fittingSig() make. A port OCCUPIES A CELL now, so this
   is not merely additive: a port placed or moved changes what occupied()
   stamps and so what groupFits() will refuse. The FACE is derived from the
   offset (portFaceOf()) and so is already in here. */
const portSig=()=>{ let out="";
  for(const id in D.ports){ const p=D.ports[id];
    out += "|"+id+":"+p.p+":"+p.dx+","+p.dy+":"+p.m; }
  return out; };
/* EVERY PIPE CELL, in key order - a pipe is cell-keyed data (D.pipes), so its
   own identity IS its cell and this is the whole of it. Joined into
   laySrcSig() so laying a pipe invalidates buildLayout()'s occupancy the same
   way placing a tank does. */
const pipeSig=()=>{ let out="";
  for(const k in D.pipes){ const c=D.pipes[k]; out += "|"+k+":"+c.s+":"+c.r; }
  return out; };
const laySrcSig=()=>checkSig()+tankSig()+fittingSig()+portSig()+pipeSig();
// buildLayout() throws LAY.parts away and rebuilds it from nothing on every
// trigger, so a PLACED part lives outside that construction (merged back in
// at the end of buildLayout()) or it would vanish whenever an unrelated
// FITTABLE flag flipped. A placed part that no longer fits is dropped from
// that one rebuild, not deleted - it reappears once the conflict clears.
let placedParts=[], placeSeq=0;
/* The one way anything outside this file replaces the placed set wholesale -
   a recording head putting its own plant back on the board (recApplyHead()).
   Copied in, not aliased, so the head stays frozen. */
function setPlacedParts(list){
  placedParts = (list||[]).map(p=>({...p}));
  buildLayout();
}
/* ANYTHING THE PLAYER ADDED, THE PLAYER CAN REMOVE. The bench used to ask
   whether an id started with "pumpX" or "sgX", which is a name test deciding
   what a part IS - the exact smell four stages went to delete. Ask the list
   that actually knows. */
const isPlaced=id=>placedParts.some(p=>p.id===id);
function placePart(mk){
  const p=mk(placeSeq++); placedParts.push(p); buildLayout(); return p;
}
/* REMOVING A PART TAKES ITS PIPES WITH IT. It used to leave them behind,
   which was survivable only while ids were never reused - and they are, on
   purpose (addTank()/addFitting() take the lowest free slot, which is what
   makes the "rename every id" audit mean anything). Delete tank2, add a
   tank, and the new one inherited the dead one's plumbing. */
function removePart(id){
  delete D.tanks[id];
  /* NO fitting->fitting cascade. A fitting left with no runs is a valve
     you can re-plumb, exactly as a tank with no runs is. */
  delete D.fittings[id];
  // a port belongs to the component - remove the component and its ports
  // (and whatever they carried) go with it, exactly like a tank's runs do.
  for(const pid in D.ports) if(D.ports[pid].p===id) removePort(pid);
  placedParts=placedParts.filter(p=>p.id!==id);
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
/* Tanks are neither add()ed statically nor placedParts: they are read from
   D.tanks, which is where their whole configuration already lives, so a tank
   is one object and not two halves that can disagree. A tank with no `cell`
   is a SECONDARY tank with no node and no box - the hotwell. */
/* A TANK CARRIES A CONTROL ROW, SO IT IS A MACHINE-SIZED BOX. A FITTING DOES
   NOT: it stays one cell, a third the size of everything else, and its handles
   hang in the margin below it. */
const FIT_W=1, FIT_H=1;
/* ══ A BIGGER TANK IS A BIGGER BOX ══
   `vol` is % of reference inventory, and it is already what the tank COSTS
   (tankMass()) and what it DELIVERS - but every tank drew the same size, so
   the one number the player actually tunes was invisible on the board. Not to
   scale: a 4x tank is not 4x the cells, or one big reserve would swallow the
   deck. Monotonic, so bigger always reads bigger.
   WIDTH ONLY GROWS FOR A LARGE ONE - three cells is what the SHUT/DUMP row
   needs, so that is the floor and every tank the size of the stock set keeps
   it. */
// FIVE CELLS IS THE FLOOR, not three: a tank carries a name row and up to two
// control rows, and a shorter box leaves drawSym() a negative rectangle.
const TANK_W0=3, TANK_H0=4;
const tankW = vol => clamp(TANK_W0 + Math.floor(vol/70), 3, 5);
const tankH = vol => clamp(TANK_H0 + Math.round(vol/25), 5, 10);
/* IS THERE ANYTHING BEHIND THIS TANK - a gas charge or a pump. The one
   predicate for "it can push at all", read by the drawing (a pressure vessel
   gets its own hoop and domed ends) and by nothing else; tankP() is what
   actually prices it. */
const tankHeld = id => { const t=D.tanks&&D.tanks[id]; return !!t && !!(t.gas || t.pump); };
const tankParts=()=>{
  const out=[];
  for(const id in D.tanks){ const t=D.tanks[id]; if(!t.cell) continue;
    out.push({id, name:t.name, w:tankW(t.vol), h:tankH(t.vol), x:t.cell[0], y:t.cell[1], col:t.col,
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
const TANK_T_PER_VOL=0.4;
const tankMass=()=>{ let m=0;
  for(const id in D.tanks) if(D.tanks[id].cell) m+=TANK_T_PER_VOL*D.tanks[id].vol;
  return m; };
// pump capacity from size (0..1, default .5), centred the way grossEff()
// centres the turbine multiplier so a default pump matches the old
// always-fitted one. D.pumpSize is keyed by id, static or placed alike.
const pumpSizeOf=id=>D.pumpSize[id]??0.5;
const pumpCap=size=>0.7+0.6*size;
const PUMP_MASS=50;                    // t, at pumpCap()==1 (default size)
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
const primaryPump=id=>{ const p=LAY.parts.find(q=>q.id===id);
  return !!p && roleHead(p.role) && loopOf(id)!==null; };
/* EVERY PUMP ON THE GRID, in LAY order - the set s.flowBy/s.flowDemBy are
   keyed on, counted and never named, exactly like sgIds(). */
const pumpIds=()=>LAY.parts.filter(p=>roleHead(p.role)).map(p=>p.id);
// roleHead(), not p.id.startsWith("pump") - what MAKES something a
// pump for capacity purposes is that its role puts head into the loop,
// the identical test netBuild() gates its own head edge on.
// ...and then primaryPump(), because that head has to reach the CORE for this
// book to be about it: flowMin (step.js) prices the RPS low-flow floor off
// this total, so counting a feedwater pump would raise the trip floor of a
// plant whose coolant flow it cannot touch.
const totalPumpCap=()=>{ let c=0;
  for(const p of LAY.parts) if(primaryPump(p.id)) c+=pumpCap(pumpSizeOf(p.id));
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
const PART_MASS={catcher:66};
const partMass=role=>LAY.parts.some(p=>p.role===role)?PART_MASS[role]:0;
/* ══════════ LOOP MEMBERSHIP COMES OFF THE GRAPH ══════════
   p.loop used to be a STORED field - set once, off nearestLoop() (a
   Euclidean-distance guess) for a placed spare and off a literal index for a
   stock pump - and every reader trusted it forever after. That is exactly
   the frozen-pixel bug a stored tap pixel used to be, one level up: a pump
   connected to a loop by PROXIMITY is not connected to it at all. Measured
   consequence: place a spare pump nobody ever piped in and loopPumpCap(0)
   doubled anyway, purely because the spare's `.loop` happened to read 0.

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
   leg in P.netRefRun's scale and in every per-loop question the tick asks. */
const LOOP_ROLE={core:1, sg:1, pump:1, fitting:1};
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
   tankSide, loopMap, secGensFromNode and secGensOf all want it - and the exact
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
function nodeGraph(){
  if(nodeGraphHeld) return nodeGraphCache;
  // fittingSig() too: a fitting's MODE decides both its fold and whether its
  // own internal link is a gate, and a mode change moves no part and no cell.
  // pipeSig()+portSig(): a connection is TRACED out of the cells and the
  // ports, so both are what this graph is built from.
  const sig=laySig()+"|"+pipeSig()+"|"+fittingSig()+"|"+portSig();
  if(nodeGraphCache && nodeGraphSig===sig) return nodeGraphCache;
  const id=k=>LAY.parts.find(q=>q.id===k);
  const adj={}, nodesOf={};
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
     "still one vessel" pass below, and loopMap(), tankSide() and secGensOf()
     all read that graph. */
  for(const c of pipeTrace().conns){
    const a=id(c.a), b=id(c.b); if(!a||!b) continue;
    note(a.id,c.sa); note(b.id,c.sb);
    link(a.id+c.sa, b.id+c.sb);
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
  const reach=(seeds,cut,noGate)=>{ const seen={}, stack=[];
    for(const n of seeds) if(!seen[n]){ seen[n]=1; stack.push(n); }
    while(stack.length){ const u=stack.pop();
      for(const v of (adj[u]||[])){
        if(seen[v] || (cut && cut[v])) continue;
        if(noGate && gate[gateKey(u,v)]) continue;
        seen[v]=1; stack.push(v); } }
    return seen; };
  /* PRIMARY IS THE COMPONENT CONTAINING THE CORE. Not a side field, not a
     kind: the one structural fact the drawing already carries. A plant with no
     core on the grid has no primary at all, and every node is secondary by
     this definition - which is honest, there is nothing for them to be the
     primary OF. */
  const primary = reach(nodesOf.core||[]);
  nodeGraphCache={adj, nodesOf, primary, reach}; nodeGraphSig=sig;
  return nodeGraphCache;
}
/* Keyed on the node graph's own IDENTITY, not on a second signature: this is
   a pure function of that graph, and re-deriving the signature here would
   rebuild that signature twice per call on a hot path (loopOf() is asked once per
   pump per solve). */
let loopMapCache=null, loopMapFor=null;
function loopMap(){
  const G=nodeGraph();
  if(loopMapCache && loopMapFor===G) return loopMapCache;
  const partLoop={};
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
    const seen=G.reach((G.nodesOf[p.id]||[]).filter(n=>G.primary[n]), cut, noGate);
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
  loopMapCache={partLoop, n:nextLoop}; loopMapFor=G;
  return loopMapCache;
}
/* WHICH GENERATORS' SHELLS THIS PUMP FEEDS - the whole of "is this a feedwater
   pump", asked of the drawing. A generator's secondary node is simply one of
   its nodes the core cannot reach; a pump that reaches one is pushing water
   into that shell, whatever it is called and whatever anyone declared. */
function secGensFromNode(node, cut){
  const G=nodeGraph();
  if(G.primary[node]) return [];
  const seen=G.reach([node], cut);
  return LAY.parts.filter(p=>p.role==="sg" &&
    (G.nodesOf[p.id]||[]).some(n=>seen[n] && !G.primary[n])).map(p=>p.id);
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
  const id=k=>LAY.parts.find(q=>q.id===k);
  for(const c of pipeMap().conns){
    const a=id(c.a), b=id(c.b); if(!a||!b) continue;
    const na=a.id+c.sa, nb=b.id+c.sb;
    if(!G.adj[na] || !G.adj[nb]) continue;
    /* Cut the run, then ask BOTH sides where they are - and ask the second
       question of the generators rather than of "not the first", or a tank on
       a dead-end branch reads as secondary purely by being unreachable. The
       stock relief tank is exactly that: cut its one run and it is connected
       to nothing at all, which is not the same thing as being on the far side
       of a generator's tubes. */
    const cut={}; cut[na]=1; cut[nb]=1;
    const pri=G.reach(G.nodesOf.core||[], cut);
    const seeds=[];
    for(const q of LAY.parts) if(ROLE[q.role] && ROLE[q.role].sgtr)
      for(const n of (G.nodesOf[q.id]||[])) if(!pri[n] && !cut[n]) seeds.push(n);
    const sec=G.reach(seeds, cut);
    const at=n=>(G.adj[n]||[]);
    const inPri=n=>at(n).some(v=>pri[v]), inSec=n=>at(n).some(v=>sec[v]);
    if((inPri(na)&&inSec(nb)) || (inPri(nb)&&inSec(na))) out.push(c.key);
  }
  return out;
}
/* IS THIS NODE ON THE SECONDARY? One question, one answer, one place - the
   core cannot reach it. Every caller that used to want a `side` field wants
   this instead. */
const secondaryNode=node=>!nodeGraph().primary[node];
function secGensOf(pid){
  const G=nodeGraph(), out=[];
  for(const n of (G.nodesOf[pid]||[]))
    for(const g of secGensFromNode(n)) if(!out.includes(g)) out.push(g);
  return out;
}
/* EVERY GENERATOR SHELL, AS A FEED END AND A STEAM END. The shell is the
   internal path with BOTH ends on the secondary - the same test netBuild()
   uses to find it - and it declares FEED then STEAM in that order. */
const shellFaces=()=>{ const out=[];
  for(const p of LAY.parts){ const R=ROLE[p.role]; if(!R||!R.sgtr||!R.internal) continue;
    for(const IN of (Array.isArray(R.internal)?R.internal:[R.internal]))
      if(secondaryNode(p.id+IN.a) && secondaryNode(p.id+IN.b))
        out.push({id:p.id, feed:IN.a, steam:IN.b}); }
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
   walk. NOT filtered by G.primary: a cross-tie IS a path, crossTies() already
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
const turbPiped=()=>{ const ids=LAY.parts.filter(p=>p.role==="turb").map(p=>p.id);
  if(!ids.length) return 0;
  return ids.filter(id=>{ const c=secCircuitOf(id); return c.sg&&c.sink; }).length/ids.length; };
/* CAN THIS GENERATOR SEND ITS STEAM ANYWHERE. A shell with no path to a
   turbine that can exhaust is raising steam into a closed vessel, so it takes
   no heat out of its own loop. Per machine, the standing sgFill() has. */
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
   secondary - and a relief valve there is protecting nothing that is boiling. */
function shellsOf(pid){
  const G=nodeGraph(), cut={}, out=[];
  for(const sh of shellFaces()) cut[sh.id+sh.feed]=1;
  for(const n of (G.nodesOf[pid]||[]))
    for(const g of secGensFromNode(n,cut)) if(out.indexOf(g)<0) out.push(g);
  return out;
}
// which loop a PART pools capacity with, or null if the walk
// above never reaches it from any generator - never read as "is it plumbed
// at all" (netBuild()'s own port-usage check answers that, off net.usage).
const loopOf = id => { const v=loopMap().partLoop[id]; return v===undefined?null:v; };
// loop i's own pumps, undamaged, summed by capacity - what netFlowK()'s
// per-group ceiling (pipenet.js) reads per loop before any open junction
// groups loops together. Off loopOf(), never a stored p.loop.
function loopPumpCap(i,dmg){
  let c=0;
  for(const p of LAY.parts){
    // loopOf()===i already says "primary" - a pump with no loop index is not
    // in any group, so primaryPump() here would only ask loopOf() twice on a
    // path the solve walks once per pump per tick.
    if(!roleHead(p.role)) continue;
    if(loopOf(p.id)===i && !dmg.includes(p.id)) c+=pumpCap(pumpSizeOf(p.id));
  }
  return c;
}
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
const FIT_MASS=16, FIT_BORE0=0.55;
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
const partOf=id=>LAY.parts.find(q=>q.id===id)||null;
/* WHICH SIDE OF THE PART THIS PORT IS ON. Exactly one of dx/dy is outside the
   footprint and that one names it - a port is never both. */
function portFaceOf(pid){
  const q=D.ports[pid]; if(!q) return null;
  const p=partOf(q.p); if(!p) return null;
  return q.dx<0?"l" : q.dx>=p.w?"r" : q.dy<0?"t" : "b";
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
function addPortAt(partId,dx,dy,mode){
  const p=partOf(partId); if(!p) return null;
  const f=faceOfOffset(p,dx,dy); if(!f || !portFaceOK(partId,f)) return null;
  const x=p.x+dx, y=p.y+dy;
  if(x<0||y<0||x>=GW||y>=GH) return null;
  if(portAtCell(x,y)) return null;
  if(occupied(null,{ports:false})[y][x]) return null;
  const pid=freePid();
  D.ports[pid]={p:partId, dx, dy, m:mode||null};
  return pid;
}
/* REMOVING A PORT LEAVES ITS PIPE WHERE IT IS. There is nothing to delete: a
   connection is TRACED, so taking the port away simply leaves the cells
   dangling, which is exactly what an unterminated pipe looks like. */
function removePort(pid){
  delete D.ports[pid];
  buildLayout();
}
// RIGHT CLICK A PORT TOGGLES ITS MODE; THE PORT DOES NOT MOVE. `m` is a
// LABEL only - which of portPath()'s two names (SUCT/DISCH, HOT/COLD...)
// this port is called - never a second, hidden node identity: the face
// alone already decides which internal path and which side of it a port is
// on (portPath()/coreFold()), so there is nothing left for a mode to gate.
// A part whose face has no such choice (portPath() returns null - a tee, a
// tank, the core) leaves m permanently null.
function portMode(pid,mode){
  const p=D.ports[pid]; if(!p) return false;
  p.m=mode;
  return true;
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
const DIRV={l:[-1,0],r:[1,0],t:[0,-1],b:[0,1]};
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
/* LAY A RUN OF CELLS along an ordered path, stamping a straight where it goes
   on and a turn where it changes direction. `from` and `to` are the cells
   OUTSIDE each end (the two ports, or nothing) - they only ever supply the
   direction the first and last cell must open toward. A cell already carrying
   a straight becomes a CROSS where the new path runs across it, which is the
   one case D.pipes was given two paths for. */
function pipeLay(path,from,to){
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
     head      true if the internal edge above also carries a pump's head
               (PUMP_H0 * loopPumpCap(loopOf(p.id),...) * ...). Requires
               `internal`; loop membership is read off the run graph
               (loopOf(), above), never a stored field.
     fixed     {type:"datum",face} - exactly one part's node, on `face`, is
               where the loop's own piezometric zero is anchored (net2.pzrNode
               falls back to the core when no part declares this).
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
               primary to secondary, rejects it, or neither. DECLARED ONLY
               this pass: the heat model behind it is Stage 6, and nothing in
               the tick reads this field yet. */
const ROLE = {
  core:  {internal:null, fixed:null, fold:["r","b"], mu:0.50, sgtr:false,
          ports:{r:4, b:5}, thermal:"source"},
  rods:  {internal:null, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none"},
  /* ONE VESSEL, ONE NODE. The pressurizer declares no internal path - it is a
     boundary, not a through-path - and that used to mean the SOLVE treated a
     pipe on its bottom and a pipe on its side as two unconnected nodes, while
     nodeGraph() (which answers "which side is this on") had already been
     taught the opposite in as many words: they are plainly the same water.
     The two disagreed, and it cost: the stock relief valve now sits between
     the vessel and the tank, and against two separate nodes it was a dead-end
     that vented nothing whatever its own gate said. Folding is not an
     internal PATH - there is still no resistance through a pressurizer, and
     nothing here makes it a leg of the loop. */
  pzr:   {internal:null, fixed:{type:"datum", face:"b"}, fold:["t","b","l","r"], mu:0.65, sgtr:false,
          ports:{"*":2}, thermal:"none"},
  /* TWO internal paths that do not meet: the tubes (l<->b, primary) and the
     shell around them (r<->t, secondary). The only way across is the sgtr
     edge, which is a LEAK and is built as one.
     `a` is the INLET on a shell path - the feed regulating valve's own head
     is signed off it (netBuild()), so the two faces are not interchangeable
     even though the conductance between them is. */
  sg:    {internal:[{a:"l", b:"b", kind:"comp", na:"HOT", nb:"COLD", la:"HOT LEG", lb:"COLD LEG"}, {a:"r", b:"t", kind:"comp", na:"FEED", nb:"STEAM", la:"FEEDWATER", lb:"MAIN STEAM"}], fixed:null, fold:null, mu:0.60, sgtr:true,
          ports:{l:1, b:1, t:1, r:2}, thermal:"transfer"},   // b was 2: the second slot only ever existed for the feed/cold-leg collision. r carries the secondary side - feed in, plus an emergency reserve
  /* ONE PUMP. There is no feedwater pump role: what makes a pump a feedwater
     pump is where it is piped, which the graph already answers (primaryPump()
     above). ports is the usual MEASUREMENT across every pump on the stock
     plant at 1..4 loops - t carries one suction leg on a coolant pump and one
     discharge per generator on a feed pump, so 4 is the measured most, and it
     is PINNED rather than dynamic: an internal t<->b edge is only correct if
     the runs land on t and b, and face() used to resolve those off wherever
     cond happened to sit. */
  pump:  {internal:{a:"t", b:"b", kind:"pump", head:true, na:"SUCT", nb:"DISCH", la:"SUCTION", lb:"DISCHARGE"}, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{t:4, b:1}, thermal:"none"},
  turb:  {internal:null, fixed:null, fold:null, mu:0.82, sgtr:false,
          ports:{t:4, b:1}, thermal:"none"},                  // t: one steam run per generator, up to the bench's own 4-loop ceiling
  cond:  {internal:null, fixed:null, fold:null, mu:0.82, sgtr:false,
          ports:{t:1, r:1}, thermal:"sink"},
  ctrl:  {internal:null, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none"},
  cont:  {internal:null, fixed:null, fold:null, mu:0.30, sgtr:false,
          ports:{}, thermal:"none"},
  /* ONE ROLE FOR EVERY TANK. There is no kind: what a tank is made of, what
     is behind it and what it is plumbed to are per-instance config
     (D.tanks), never a role. mu is a tank of liquid, which shields rather
     better than bare equipment and rather worse than a wall. */
  tank:  {internal:null, fixed:{type:"tank"}, fold:null, mu:0.65, sgtr:false,
          ports:{"*":1}, thermal:"none"},
  bkp:   {internal:null, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none"},
  shield:{internal:null, fixed:null, fold:null, mu:0.18, sgtr:false,
          ports:{}, thermal:"none"},
  /* A structure with mass that used to be a checkbox and nothing on the
     grid. It gets no `fixed` - the run each one carries
     (the traced connection) lands on a node that is ALREADY reachable from the
     rest of the primary network (sg0's own "b" face, the core's folded
     node), so each hangs off it as a true pendant leaf: no fixed pressure
     and no head anywhere past that one edge means KCL forces exactly zero
     current through it, so it cannot move a single other pressure or flow
     in the solve. */
  catcher: {internal:null, fixed:null, fold:null, mu:0.55, sgtr:false,
          ports:{}, thermal:"none"},                          // a structure, not a network part - no run, no ports, no exception needed
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
  fitting:{internal:[{a:"l", b:"r", kind:"fit", gate:true, na:"A", nb:"B", la:"SIDE A", lb:"SIDE B"}], fixed:null,
          fold:p=>fitModeOf(p.id)==="tee" ? ["l","r","t","b"] : {t:"l", b:"r"},
          mu:0.70, sgtr:false, ports:{l:2,r:2,t:2,b:2}, thermal:"none"},
};
// what a fitting IS, asked of the instance and never of the role - the one
// reader for the fold above and for every branch in the draw and the solve
const fitModeOf=id=>(D.fittings[id]&&D.fittings[id].mode)||"tee";

function buildLayout(){
  const A=[], add=(id,name,w,h,x,y,col,grp,tip,role)=>{ const p={id,name,w,h,x,y,col,grp,tip,role}; A.push(p); return p; };
  /* ══ A MACHINE IS BIG ENOUGH TO HOLD ITS OWN CONTROLS ══
     BANDS is gone: the control room used to stretch a grid ROW to make room
     for a strip that would not fit in a 46 px box, so no row was CELL tall and
     nothing could say "y*CELL". A machine declares the cells it needs instead
     - a pump is 3x5 because one slider row plus its name is what a pump has to
     carry - and every row is exactly CELL tall on both screens. */
  add("core","REACTOR",9,12,6,13,"#ff5a45","core",
    "The vessel and the fuel inside it. Select it to choose the coolant family, the fuel, the lattice and the core shape.","core");
  add("rods","ROD DRIVES",9,13,6,0,"#c8d8dc","core",
    "Control rod drive mechanisms, bolted to the vessel head. They ride on the head and move with the reactor - you site the reactor, not the drives. Select for scram gear, bank worth and emergency poison.","rods")
    .pin={to:"core",dx:0,dy:-13};
  add("pzr","PRESSURIZER",3,6,15,1,"#a98cf0","primary",
    "Sets loop pressure. It has to sit high - the steam bubble must stay at the top of the loop.","pzr");
  // ONE generator, ONE pump - the stock loadout, exactly like every other
  // fixed-slot part above. There is no knob for how many of these exist:
  // an additional generator is a PLACED part (ADD STEAM GENERATOR HERE,
  // design-bench.js), wired by hand through Stage 3a's CONNECT, the same
  // way a spare pump already is. Loop membership is read off the run graph
  // (loopOf(), above), not stored.
  add("sg0","STEAM GEN 1",3,6,26,5,"#5fd2e2","loop0",
    "Raise this ABOVE the reactor and hot water rises into it unaided. That height difference is your blackout survival.","sg");
  add("pump0","RCP 1",3,5,26,18,"#57d38c","loop0",
    "Coolant pump. Keep it low and reachable - it is the component most likely to need a repair under fire.","pump");
  if(checkOf("turb")) add("turb","TURBINE",9,7,46,11,"#f0a830","sec",
    "Draws the ship's load. Select it to size the steam dump that absorbs a turbine trip.","turb");
  if(checkOf("cond")) add("cond","CONDENSER",9,5,46,24,"#5aa9d6","sec",
    "Rejects waste heat. Bulky, and it wants to be near the hull.","cond");
  add("feed","FEED PUMP",3,5,30,18,"#5aa9d6","sec",
    "Returns water to the steam generator. Lose it and the heat sink boils dry.","pump");
  add("ctrl","CONTROL",6,4,0,30,"#cfc9b8","crew",
    "Where your crew sits. Distance and shielding from the reactor set the dose they take.","ctrl");
  if(checkOf("cont")) add("cont","CONTAINMENT",6,3,10,30,"#8fa9ae","safety",
    "The barrier between damaged fuel and your crew. Select it for containment type and the core catcher.","cont");
  // Stage 5d: a structure, not a flag - it occupies real floor space under
  // the vessel rather than costing 66 t for nothing on the grid at all.
  // ports:{} (ROLE.catcher) - it carries no run and needs none; "is the core
  // sitting over the catcher" is a geometric question with a geometric
  // answer now, exactly like "is the pressurizer the highest point".
  if(D.catcher) add("catcher","CORE CATCHER",3,3,6,30,"#5a4a3a","safety",
    "A cooled basin under the vessel. It will not save the fuel, but it stops a melted core burning through and breaching the vessel, which keeps the release contained.","catcher");
  /* EVERY TANK ON THE PLANT, from D.tanks and nothing else - no conditional
     add(), no seeded placedParts entry, no checkbox. Zero tanks is a legal
     plant; four is a legal plant. A tank with no cell has no box, which is
     what a secondary tank with no node means (the hotwell). */
  for(const p of tankParts()) A.push(p);
  for(const p of fittingParts()) A.push(p);
  add("bkp","BACKUP PWR",3,5,56,11,"#57d38c","safety",
    "Batteries or diesels keeping the pumps turning through a blackout. Keep it away from the hull.","bkp");
  for(let i=0;i<3;i++) add("shld"+i,"SHIELD",3,3,18+3*i,30,"#6d8f98","shield",
    "A block of shielding. Put it between the reactor and the control room to cut crew dose. It has mass and it blocks access.","shield");
  // placed parts merge in last, checked straight against A (not groupFits(),
  // which reads the global LAY.parts - still the PRE-rebuild layout here)
  for(const p of placedParts){
    let ok = p.x>=0 && p.y>=0 && p.x+p.w<=GW && p.y+p.h<=GH;
    if(ok) for(const q of A) if(p.x<q.x+q.w && p.x+p.w>q.x && p.y<q.y+q.h && p.y+p.h>q.y){ ok=false; break; }
    if(ok) A.push(p);
  }
  LAY={parts:A}; layFit=laySrcSig();
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
function portPos(pid){
  const c=portCell(pid);
  return c ? cellPos(c[0],c[1]) : [0,0];
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
  const id=k=>LAY.parts.find(q=>q.id===k);
  const net=[], usage={};
  const tally=(pid,f)=>{ usage[pid+f]=(usage[pid+f]||0)+1; };
  for(const c of pipeMap().conns){
    const a=id(c.a), b=id(c.b);
    if(!a || !b) continue;               // this connection's part is not on the grid this frame
    /* One point per cell, plus both port cells, with the collinear points
       dropped - so a straight leg is one stroke and a bend is a round join,
       exactly as a hand-drawn polyline used to give. */
    const pts=unbend([portPos(c.pa)]
      .concat(c.cells.map(([x,y])=>cellPos(x,y)))
      .concat([portPos(c.pb)]));
    net.push({k:c.k, key:c.key, rid:c.key, cells:c.cells, L:c.L,
               pts, wps:[], wp:true, nz:[true,true],
               a:a.id, sa:c.sa, b:b.id, sb:c.sb});
    tally(a.id,c.sa); tally(b.id,c.sb);
  }
  // which faces carry a REAL, TRACED connection - never merely a port with
  // nothing piped to it. netBuild()'s "does this part have ANY real run
  // reaching it" test reads this, and so does a relief fitting's own vent
  // target: an orphaned port must read exactly like no port at all.
  net.usage=usage;
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
  const IN=roleIns(p).find(q=>q.a===f||q.b===f);
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
function portWord(p,f,long){ const IN=portPath(p,f); if(!IN) return null;
  return IN.a===f ? (long?IN.la:IN.na) : (long?IN.lb:IN.nb); }
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
const RUN_KIND={
  "core|sg":"hot", "pump|sg":"cold", "core|pump":"cold",
  "sg|turb":"steam", "cond|turb":"exh",
  // the condenser is on nobody's primary, so a pump drawn to it is drawing
  // feedwater whatever else it is plumbed to
  "cond|pump":"feed",
  /* A pipe between the pressurizer and any primary machine IS a surge line -
     the vessel has exactly one connection to the loop and that is what it is
     called. Without these rows a hand-drawn pressurizer line came out
     k:"user": grey, unnamed, bore 1 instead of PIPE_BORE.surge, and with no
     KIND_TEMP hot tag - a working connection wearing no name. */
  "core|pzr":"surge", "pzr|sg":"surge", "pump|pzr":"surge",
};
/* ══ A FITTING IS TRANSPARENT TO NAMING ══
   A tee spliced into the hot leg leaves two runs where there was one, and
   both are still the hot leg - the pipe did not stop being a hot leg because
   somebody put a junction in it. So a `fitting` end is resolved THROUGH the
   fitting's own runs to the nearest machine that is not one, and the table
   below then reads the pair it always read.
   Get this wrong and the failure is QUIET: three stock runs come out
   k:"user", loopOfKey() loses loop 0, P.netRefRun loses its scale, and what
   you see is grey pipes that still conduct. Same move a tank already gets
   below, for the same reason. */
const isFitting=id=>{ const p=LAY.parts.find(q=>q.id===id); return !!p && p.role==="fitting"; };
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
const FIT_BRANCH_ROLE={pzr:1, tank:1};
function throughFitting(id,avoid,seen){
  const p=LAY.parts.find(q=>q.id===id);
  if(!p || p.role!=="fitting") return p||null;
  seen=seen||{}; if(seen[id]) return null; seen[id]=1;
  // pipeTrace(), never pipeMap(): naming a connection is what calls this, so
  // reading the NAMED map here would be the cycle the two halves exist to break
  let branch=null;
  for(const c of pipeTrace().conns){
    const o = c.a===id ? c.b : c.b===id ? c.a : null;
    if(o==null || o===avoid) continue;
    const q=throughFitting(o,avoid,seen); if(!q) continue;
    if(!FIT_BRANCH_ROLE[q.role]) return q;
    if(!branch) branch=q;
  }
  return branch;
}
function runKindFor(aId,bId,af,bf){
  const A=throughFitting(aId,bId), B=throughFitting(bId,aId);
  if(!A||!B) return "user";
  /* A PUMP IS A PUMP; WHICH SIDE OF A GENERATOR IT LANDS ON NAMES THE PIPE.
     There is no feedwater-pump role left to key the table on, so "pump|sg"
     alone cannot tell a cold leg from a feedwater line - the FACE tells it,
     and it is the same fact the solve reads: a generator's shell is the part
     of it the core cannot reach. Faces unknown (an older caller), fall
     through to the table and get a cold leg, which is what the pair used to
     mean on its own. */
  if(A.role==="sg" !== (B.role==="sg") && (A.role==="pump" || B.role==="pump")){
    const g = A.role==="sg" ? A : B, f = A.role==="sg" ? af : bf;
    if(f!=null && !nodeGraph().primary[g.id+f]) return "feed";
  }
  /* A TANK'S LINE IS NAMED BY WHAT IT REACHES, not by which tank it is - there
     is no such thing as "the relief tank" or "the HPI tank", only a tank with a
     pipe drawn somewhere. On the primary side the pressurizer end makes it a
     relief header and anything else makes it an injection line; on the
     secondary side a tank feeds what it is piped to. */
  const t = A.role==="tank"? A : B.role==="tank"? B : null;
  if(t){
    const o = t===A? B : A;
    if(!primaryTank(t.id)) return "feed";
    return o.role==="pzr" ? "relief" : "hpi";
  }
  return RUN_KIND[[A.role,B.role].sort().join("|")] || "user";
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
/* THE PART THAT FIXES THE LOOP'S PRESSURE, or null - the same ROLE question
   netBuild() takes its datum node from, asked once here so the bench and
   pzrPlumbed() do not each spell it out. Never the id "pzr". */
function datumPart(){
  return LAY.parts.find(q=>{ const R=ROLE[q.role]; return R && R.fixed && R.fixed.type==="datum"; }) || null;
}
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
function tankSide(id){
  const t=D.tanks && D.tanks[id]; if(!t) return null;
  const G=nodeGraph();
  const sideOfNodes = ns => !ns || !ns.length ? null
    : (ns.some(n=>G.primary[n]) ? "primary" : "secondary");
  if(!t.cell){ const h=hostPartOf();
    /* no host on the grid at all: a hosted tank is still not something the
       core can reach, so it is secondary rather than nothing. */
    return (h && sideOfNodes(G.nodesOf[h.id])) || "secondary"; }
  return sideOfNodes(G.nodesOf[id]);
}
/* Is this part id a tank on the PRIMARY side - the one predicate for "could
   catch a relief discharge". Any primary tank will do: "the relief tank" is
   not a kind of thing, it is whichever tank you happened to plumb the relief
   header to. Off ROLE and the graph, never p.id. */
function primaryTank(id){
  const p=LAY.parts.find(q=>q.id===id);
  return !!(p && p.role==="tank" && tankSide(id)==="primary");
}

/* WHICH PARTS A WALK OVER THE CONNECTIONS REACHES FROM ONE PART - the design-time
   answer to "is this wired to that", asked with no net, no solve and no S,
   which is all the bench ever has. Any run counts, any kind: a run is a run.

   `blocks` marks a part the walk may REACH but never CROSS - pzrLive()'s
   "reached, never crossed" rule (pipenet.js), made design-shaped: a tank is
   a pressure boundary, so a path that goes in one of its nozzles and out the
   other is not a path. Omitted, nothing blocks and this is pure wiring. */
function runReach(fromId, blocks){
  const id=k=>LAY.parts.find(q=>q.id===k);
  /* A FACE THE PART HAS NO PORT ON IS NOT A CONNECTION. netBuild() names a
     node `partId+face` and folds only the faces ROLE declares, so a run to an
     undeclared face lands on a node nothing else touches - a dangling stub
     that draws like a pipe and conducts to nowhere. No gesture can author one
     (handles are drawn per declared face, plant.js), but D can be edited
     directly, and without this the bench read such a run as plumbed while the
     solve did not. `null` means "resolve live" and is always legal. */
  const portOK=(pid,face)=>{
    if(face==null) return true;
    const p=id(pid), R=p&&ROLE[p.role];
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
    const u=stack.pop(), pu=id(u);
    if(u!==fromId && blocks && pu && blocks(pu)) continue;
    for(const [a,b] of link){
      const v = a===u ? b : b===u ? a : null;
      if(v===null || seen.has(v) || !id(v)) continue;
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
  const id=k=>LAY.parts.find(q=>q.id===k);
  if(!id("core")) return true;   // no core, no claim to make
  for(const pid of runReach("core")){ const p=id(pid), R=p&&ROLE[p.role];
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

   Off ROLE.fixed.type==="datum", never the id "pzr", for the same reason
   netBuild() takes its datum node that way. */
function pzrPlumbed(){
  const pz=datumPart();
  if(!pz) return true;                              // no pressurizer: nothing to disconnect
  if(!LAY.parts.find(q=>q.id==="core")) return true;
  return runReach("core", p=>p.role==="tank").has(pz.id);
}
// BACKUP PWR ghosts rather than vanishes: NONE is a real dropdown choice
// (mass 0) that still occupies its cell, because it's a three-way quality
// dial (NONE/BATTERY/DIESEL), not an add/remove part like fittableList()'s
const fitted=p => p.id==="bkp" ? D.bkp>0 : true;
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
function occupied(skip,opt){
  const off = skip ? (Array.isArray(skip)?skip:[skip]) : [];
  const wantPipes = !opt || opt.pipes!==false;
  const wantPorts = !opt || opt.ports!==false;
  const g=Array.from({length:GH},()=>new Array(GW).fill(null));
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
function moveTo(p,nx,ny){
  if(p.pin) return false;
  const cells=moveCells(p,nx,ny);
  if(!groupFits(cells)) return false;
  /* A tank is rebuilt from D.tanks on every buildLayout(), so its cell has to
     land back there or the move is undone by the next unrelated rebuild.
     moveTo() is the ONLY way a part changes position, so this is the one
     place that has to know it. */
  for(const {q,x,y} of cells){ q.x=x; q.y=y;
    if(D.tanks[q.id])    D.tanks[q.id].cell=[x,y];
    if(D.fittings[q.id]) D.fittings[q.id].cell=[x,y]; }
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
  for(let X=p.x-1;X<=p.x+p.w;X++) for(let Y=p.y-1;Y<=p.y+p.h;Y++){
    if(X<0||Y<0||X>=GW||Y>=GH) continue;
    const inside = X>=p.x&&X<p.x+p.w&&Y>=p.y&&Y<p.y+p.h;
    const edge = (X<p.x||X>=p.x+p.w)!==(Y<p.y||Y>=p.y+p.h);
    if(!inside && edge && !g[Y][X]) out.push([X,Y]);
  }
  return out;
}
function layoutMetrics(){
  if(!LAY||layFit!==laySrcSig()) buildLayout();
  const P_=LAY.parts, id=k=>P_.find(q=>q.id===k), core=id("core"), cc=cen(core);
  let head=0, n=0;
  for(const p of P_) if(p.role==="sg"){ head += (cc.y - cen(p).y); n++; }
  head = n? head/n : 0;
  let pipe=0, sec=0, dead=0;
  for(const r of pipeNetwork()){
    const L=r.L;
    /* A relief line is a DEAD LEG: it sits shut behind its valve and carries
       no flow until something lifts, so its water is not moving and adds no
       inertia to a loop transient. It still has to be built and hung, so it
       still costs mass - that is the whole cost of a relief path, and it is
       meant to be felt on the budget, not as a plant that coasts down
       differently for owning a valve it has never opened. */
    if(r.k==="relief") dead+=L;
    // a cross-tie is a parallel branch, not another metre of loop, so it pays
    // mass/inertia with the secondary runs and never slows the pumps down
    else if(r.k==="hot"||r.k==="cold"||r.k==="surge"||r.k==="hpi") pipe+=L; else sec+=L;
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
  const access = tot? reach/tot : 0;

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
  const pz=id("pzr");
  let loopTop=core.y;
  for(const q of P_) if(q.role==="sg") loopTop=Math.min(loopTop,q.y);
  const pzrOK = pz ? pz.y<=loopTop : true;
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
  const feedNoSg  = P_.filter(p=>roleHead(p.role) && !primaryPump(p.id)
                                 && !secGensOf(p.id).length).map(p=>p.id);
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
    if(t && tankSide(q.id)==="primary" && t.check) injZ = injZ===null ? tankZ[q.id] : Math.min(injZ, tankZ[q.id]); }

  const mass = (pipe+sec+dead)*1.6 + P_.filter(p=>p.grp==="shield").length*30;
  layMass = mass;
  /* natK is gone. Buoyancy is an edge head in the pipe network now
     (pipenet.js), so the thermosiphon is solved off exactly the geometry
     `head` measures instead of being predicted from it by a second formula
     standing beside the solve - and unlike a correlation, the solve can tell
     one steam generator from another, and can tell a shut valve from an open
     one. `head` stays: it is what the bench shows, and it is now what
     actually drives the thing it is named after. */
  return {pipe,sec,dead,head,exposure,access,dose,sep,mass,pzrOK,pzrK,pzrConn,turbConn,sgNoSteam,sgNoRelief,feedNoSg,tankZ,injZ:injZ===null?0:injZ,radK,peak,
    flowK: 1/(1+0.006*pipe),
    inertiaK: 1+0.012*(pipe+sec)};
}
// The arrangement half of designSig(): id + grid position of every part on
// the board, live parts only (no D fields, no lattice). rad.js's kernel
// cache keys on exactly this - a shield sliding one cell invalidates it, a
// bench slider that leaves every part where it stood does not.
const laySig = () => LAY.parts.map(p=>p.id+":"+p.x+","+p.y).join(";");

/* PER-TABLE SIGNATURES, not JSON.stringify(D). ~150 D.pipes entries lengthen
   that string a long way, and dbPanelSig compares it every frame - it was
   already a measured 5.6 ms hot spot before a pipe was a cell. The one D
   table left whole is the scalar config, which is small. */
const D_SCALARS=()=>{ const o={};
  for(const k in D) if(k!=="pipes" && k!=="ports" && k!=="tanks" && k!=="fittings") o[k]=D[k];
  return JSON.stringify(o); };
// latSig() joins the key because most of what a lattice pen changes (a
// reflector face, a cluster slot, active length) is NOT a D field - without
// it a commissioned plant could go quietly out of date with the bench
function designSig(){ return D_SCALARS()+laySrcSig()+"|"+latSig()+"|"
  +LAY.parts.map(p=>p.id+":"+p.x+","+p.y).join(";"); }
