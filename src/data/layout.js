"use strict";

// CELL is a RENDERING size, not a physical one - pipe runs are measured in
// pixels and divided by CELL to get metres (plen()), and MPC is the only
// thing that says how big a cell really is. Audited by doubling CELL and
// running audit-physics.js, which passed unchanged.
const GW=16, GH=9, CELL=46, GX=12, MPC=1.4;   // metres per cell
let GY=100;                                   // grid top, set each frame by the layout section
let LAY=null, layFit="", sel="core", layMass=0;
// parts optionally present at a FIXED slot: buildLayout() gates add() on
// get(), layoutMetrics() rebuilds when any of it changes, and the right-click
// menu is generated from it. A part placed at a slot of the player's choosing
// (spare pump, junction) doesn't fit this shape - see PLACED PARTS below.
const fittableList=()=>[
  {id:"cont", label:"CONTAINMENT",         get:()=>D.contFit, set:v=>{D.contFit=v;}},
  /* This one upgrades a part rather than adding one: the HPI tank is always
     on the grid, and this decides whether a nitrogen charge or a set of pumps
     stands behind it. fitSig() still has to see it, because the part's own
     NAME changes with it. */
  {id:"hpi",  label:"PASSIVE ACCUMULATOR", get:()=>D.accum,   set:v=>{D.accum=v;}},
  {id:"turb", label:"TURBINE",             get:()=>D.turbFit, set:v=>{D.turbFit=v;}},
  {id:"cond", label:"CONDENSER",           get:()=>D.condFit, set:v=>{D.condFit=v;}},
  /* Stage 5d: catcher/efw/boroninj used to be bare D flags with nothing on
     the grid to click. Listing them here gives each the identical FIT/REMOVE
     right-click affordance cont/turb/cond already have, for free -
     ctxItemsDesign() (design-bench.js) reads this table generically, never
     by naming a component, so a part id that matches its own fittableList id
     is all a new row needs. */
  {id:"catcher",  label:"CORE CATCHER",        get:()=>D.catcher,  set:v=>{D.catcher=v;}},
  {id:"efw",      label:"EMERGENCY FEEDWATER", get:()=>D.efw,      set:v=>{D.efw=v;}},
  {id:"boroninj", label:"BORON INJECTION",     get:()=>D.boroninj, set:v=>{D.boroninj=v;}},
  /* The relief tank has no D flag of its own - it is placedParts state
     (Stage 5a), not a toggle - so get/set read and drive that directly
     rather than a boolean field. Same id both ends (fittableList's id and
     the part's own id) is what lets ctxItemsDesign()'s generic REMOVE/FIT
     lookup (design-bench.js) find it with no change on that side; the
     placePart() callback ignores the sequence number placePart() always
     hands it, because this part keeps the one fixed id everything else
     (D.run.relief, TANK.reltk, ROLE.reltk) is keyed on. */
  {id:"reltk", label:"RELIEF TANK",
   get:()=>LAY.parts.some(p=>p.id==="reltk"),
   set:v=>{ if(v) placePart(()=>({id:"reltk",name:"RELIEF TANK",w:1,h:1,x:7,y:0,col:"#8a6cd0",
       grp:"safety",tip:"Catches what the relief valve vents. It fills as the valve passes flow, and a full tank is a place a repair party would rather not stand.",
       role:"reltk"}));
     else removePart("reltk"); }},
];
const fitOf=id=>fittableList().find(f=>f.id===id).get();
// Stage 5a: the relief tank is a placed part now (placedParts, below), never
// a box conjured from whatever D.fit happens to contain - so fitSig() needs
// no relief term any more. placePart()/removePart() already rebuild on
// their own, exactly like a spare pump or generator.
const fitSig=()=>fittableList().map(f=>f.get()?1:0).join("");
// buildLayout() throws LAY.parts away and rebuilds it from nothing on every
// trigger, so a PLACED part lives outside that construction (merged back in
// at the end of buildLayout()) or it would vanish whenever an unrelated
// FITTABLE flag flipped. A placed part that no longer fits is dropped from
// that one rebuild, not deleted - it reappears once the conflict clears.
// Stage 5a: the relief tank ships already placed - a real part, like a spare
// pump, not a box buildLayout() used to conjure from D.fit's own content.
// Seeded here rather than through placePart() (which would rebuild the
// layout before D itself has finished loading) - same id, same cell (7,0)
// the old conditional add() put it at, so no pinned figure moves.
let placedParts=[{id:"reltk",name:"RELIEF TANK",w:1,h:1,x:7,y:0,col:"#8a6cd0",
  grp:"safety",tip:"Catches what the relief valve vents. It fills as the valve passes flow, and a full tank is a place a repair party would rather not stand.",
  role:"reltk"}], placeSeq=0;
function placePart(mk){
  const p=mk(placeSeq++); placedParts.push(p); buildLayout(); return p;
}
function removePart(id){
  placedParts=placedParts.filter(p=>p.id!==id); buildLayout();
}
// pump capacity from size (0..1, default .5), centred the way grossEff()
// centres the turbine multiplier so a default pump matches the old
// always-fitted one. D.pumpSize is keyed by id, static or placed alike.
const pumpSizeOf=id=>D.pumpSize[id]??0.5;
const pumpCap=size=>0.7+0.6*size;
const PUMP_MASS=50;                    // t, at pumpCap()==1 (default size)
// ROLE[p.role].head, not p.id.startsWith("pump") - what MAKES something a
// pump for capacity purposes is that its role puts head into the loop
// (ROLE.head), the identical test netBuild() gates its own head edge on.
const totalPumpCap=()=>{ let c=0;
  for(const p of LAY.parts) if(ROLE[p.role] && ROLE[p.role].head) c+=pumpCap(pumpSizeOf(p.id));
  return c; };
// how many steam generators are on the grid right now - the fact D.loops
// used to fake as an input. Every reader that priced or counted "loops"
// wants this counted value instead, never a stored knob.
const sgCount=()=>LAY.parts.filter(p=>p.role==="sg").length;
/* A part whose mass is not already counted by some other measure
   (totalPumpCap(), sgCount(), latMass(), a fitting's own FIT_MASS) - one row
   per role, priced once if that role is anywhere on LAY.parts at all. Off
   the grid, never off a D flag: derived()'s mass expression (design.js)
   must be able to point at a BOX for every tonne it charges, and this is
   where a term that only ever gated a checkbox before (D.efw, D.catcher,
   D.boroninj) now names one. RELIEF_TANK_MASS lived here as its own module
   constant; folded into this table instead of restoring it as a second one. */
const PART_MASS={reltk:18, catcher:66, efw:38, boroninj:18};
const partMass=role=>LAY.parts.some(p=>p.role===role)?PART_MASS[role]:0;
/* ══════════ LOOP MEMBERSHIP COMES OFF THE GRAPH ══════════
   p.loop used to be a STORED field - set once, off nearestLoop() (a
   Euclidean-distance guess) for a placed spare and off a literal index for a
   stock pump - and every reader trusted it forever after. That is exactly
   the frozen-pixel bug juncPt() exists to forbid one level up: a pump
   connected to a loop by PROXIMITY is not connected to it at all. Measured
   consequence: place a spare pump nobody ever piped in and loopPumpCap(0)
   doubled anyway, purely because the spare's `.loop` happened to read 0.

   loopMap() answers it off D.run instead, structurally: which PARTS a run
   connects, flood-filled outward from every generator on the grid. Two
   parts only link through it if BOTH carry a ROLE this loop concept is
   even about (core/sg/pump) - never by a run's own `k` label. That is not
   a permission on the SOLVE (every run still conducts, taps, hits and
   spills regardless of role - Stage 1's rule is untouched), it is a
   bookkeeping default exactly like KIND_TEMP's hot/cold tag (pipenet.js):
   read for a display bucket, never for whether current flows. Filtering by
   role instead of by kind sidesteps a real landmine - the feed pump's own
   run lands on the SAME node a cold leg does (sg's "b" face carries both;
   see KIND_TEMP's own comment) - a kind-based or pure node-reachability
   walk would pull the feedwater pump into "loop 0" the moment that
   coincidence lines up; ROLE.feed is not in the set, so it never can.

   A pump this walk cannot reach from any generator (nothing plumbed to it
   at all, or plumbed somewhere no generator's branch reaches - Stage 3a's
   reactor-condenser-RCP-reactor loop, say) simply has no loop index. It
   still develops its OWN head once it has any real run at all - see
   netBuild()'s pump-head block, pipenet.js - it just does not pool
   capacity with anyone else's, because there is no group to pool with. */
const LOOP_ROLE={core:1, sg:1, pump:1};
let loopMapCache=null, loopMapSig="";
function loopMap(){
  const sig=laySig()+"|"+JSON.stringify(D.run);
  if(loopMapCache && loopMapSig===sig) return loopMapCache;
  const id=k=>LAY.parts.find(q=>q.id===k);
  const adj={};
  const link=(a,b)=>{ (adj[a]||(adj[a]=[])).push(b); (adj[b]||(adj[b]=[])).push(a); };
  for(const rid in D.run){
    const e=D.run[rid];
    if(e.tap) continue;                       // no part-to-part link of its own (surge etc.)
    const a=id(e.a), b=id(e.b);
    if(!a||!b || !LOOP_ROLE[a.role] || !LOOP_ROLE[b.role]) continue;
    if(a.id==="core"||b.id==="core") continue; // the shared hub, not a link BETWEEN two loops
    link(a.id,b.id);
  }
  const partLoop={};
  // seeded off ROLE.sg parts directly, in LAY.parts' own order - counted,
  // never named: a generator is a placed part now (Stage 3b), not a fixed
  // "sg"+i slot buildLayout() conjured for i<D.loops.
  let nextLoop=0;
  for(const p of LAY.parts){
    if(p.role!=="sg" || partLoop[p.id]!==undefined) continue;
    const stack=[p.id], i=nextLoop++;
    partLoop[p.id]=i;
    while(stack.length){ const u=stack.pop();
      for(const v of (adj[u]||[])) if(partLoop[v]===undefined){ partLoop[v]=i; stack.push(v); } }
  }
  loopMapCache={partLoop, n:nextLoop}; loopMapSig=sig;
  return loopMapCache;
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
    if(!ROLE[p.role] || !ROLE[p.role].head) continue;
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
  const ci=key.indexOf(":"); if(ci<0) return null;
  const rest=key.slice(ci+1), di=rest.indexOf("-");
  if(di<0) return null;                       // a tap-ended run has no loop identity of its own
  const aP=rest.slice(0,di-1), bP=rest.slice(di+1,-1);   // strip each node's single-letter face
  const {partLoop}=loopMap();
  return partLoop[aP]!==undefined ? partLoop[aP] : (partLoop[bP]!==undefined ? partLoop[bP] : null);
}
// a fitting is a tap, not a component: no box, no grid cell, never in
// LAY.parts. D.fit is topology only - one tap (aKey,aT) always, and a
// second (bKey,bT) only for a fitting that branches to another run - a
// throttle may sit in-line instead, bKey null, splicing straight into the
// run it taps (see FIT.throttle, pipenet.js). Resolved fresh every frame by
// juncPt() off whatever pipeNetwork() just routed - never a stored pixel,
// so a part moved upstream of a tap can't leave the glyph or the branch
// behind. mode picks the FIT (pipenet.js) row that prices its resistance;
// bore is unused until the relief valve gets its own path. S.juncOpen/
// S.valve (same keys) are the live actuator state; resetPlant() seeds them
// from P.fit, so nothing here writes to S directly.
// What each mode is CALLED, once - the plant view's tooltips and both rails
// each used to spell this out for themselves, and a fourth mode would have
// had to be added to every one of them.
const FITNAME={tee:"JUNCTION",relief:"RELIEF VALVE",throttle:"THROTTLE"};
let fitSeq=0;
// A relief valve's setpoints are mechanical - chosen when it is built, not
// worked during a transient - so they live in D beside the tap and never on
// S. null means "this plant's default"; reliefSet() (step.js) is the one
// place that answers what the default is. Carried unconditionally rather
// than behind a mode check: a fitting that is never "relief" simply carries
// two unread nulls, the same standing `bore` already has on a mode that
// never reads it - cheaper than a second branch in the one function every
// mode's fitting is built through.
function addFit(mode,aKey,aT,bKey,bT,bore=0.55,lift=null,reseat=null){
  const id="f"+(fitSeq++);
  D.fit[id]={aKey,aT,bKey,bT,bore,mode,lift,reseat};
  return id;
}
function removeFit(id){ delete D.fit[id]; }
const FIT_MASS=16;                     // a spool piece and a motor-operated valve, per tap
// The tank's own mass lives on PART_MASS.reltk (above) now - a second
// relief valve still only ever costs through FIT_MASS and its own branch
// pipe (layMass, layoutMetrics()), because there is still only one tank.

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
     head      true if the internal edge above also carries a pump's head
               (PUMP_H0 * loopPumpCap(loopOf(p.id),...) * ...). Requires
               `internal`; loop membership is read off the run graph
               (loopOf(), above), never a stored field.
     fixed     {type:"datum",face} - exactly one part's node, on `face`, is
               where the loop's own piezometric zero is anchored (net2.pzrNode
               falls back to the core when no part declares this).
               {type:"tank"} - every node ANY part with this role reaches is
               priced by TANK[part.id], off whatever face pipeNetwork()
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
     ports     {face:N} - the most this role's own face has ever been asked
               to carry, MEASURED off the stock plant at every loop count the
               bench allows (1..4), never assumed at 1. "*" caps a TOTAL
               across every face instead, for a role whose own faces
               pipeNetwork() picks dynamically (feed, and the tank-side end
               of relief) rather than declares. UNREAD this pass - it is the
               contract Stage 3a's "a port that is already occupied" rule
               will rest on, not an enforced ceiling yet.
     thermal   "source"|"transfer"|"sink"|"none" - adds heat, moves it from
               primary to secondary, rejects it, or neither. DECLARED ONLY
               this pass: the heat model behind it is Stage 6, and nothing in
               the tick reads this field yet. */
const ROLE = {
  core:  {internal:null, head:false, fixed:null, fold:["r","b"], mu:0.50, sgtr:false,
          ports:{r:4, b:5}, thermal:"source"},
  rods:  {internal:null, head:false, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none"},
  pzr:   {internal:null, head:false, fixed:{type:"datum", face:"b"}, fold:null, mu:0.65, sgtr:false,
          ports:{"*":2}, thermal:"none"},                     // surge always "b"; relief's own face is dynamic (face(pzr,rt)) and could coincide
  sg:    {internal:{a:"l", b:"b", kind:"comp"}, head:false, fixed:null, fold:null, mu:0.60, sgtr:true,
          ports:{l:1, b:2, t:1}, thermal:"transfer"},
  pump:  {internal:{a:"t", b:"b", kind:"pump"}, head:true, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{t:1, b:1}, thermal:"none"},
  turb:  {internal:null, head:false, fixed:null, fold:null, mu:0.82, sgtr:false,
          ports:{t:4, b:1}, thermal:"none"},                  // t: one steam run per generator, up to the bench's own 4-loop ceiling
  cond:  {internal:null, head:false, fixed:null, fold:null, mu:0.82, sgtr:false,
          ports:{t:1, r:1}, thermal:"sink"},
  feed:  {internal:null, head:false, fixed:null, fold:null, mu:0.82, sgtr:false,
          ports:{"*":5}, thermal:"none"},                     // its own two links pick a face dynamically (face(fp,sg)/face(fp,cd)) - measured total at 4 loops, not a per-face number this role ever declares
  ctrl:  {internal:null, head:false, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none"},
  cont:  {internal:null, head:false, fixed:null, fold:null, mu:0.30, sgtr:false,
          ports:{}, thermal:"none"},
  hpi:   {internal:null, head:false, fixed:{type:"tank"}, fold:null, mu:0.65, sgtr:false,
          ports:{b:1}, thermal:"none"},
  bkp:   {internal:null, head:false, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none"},
  reltk: {internal:null, head:false, fixed:{type:"tank"}, fold:null, mu:0.75, sgtr:false,
          ports:{"*":1}, thermal:"none"},                     // its own face (face(rt,pzr)) is dynamic
  shield:{internal:null, head:false, fixed:null, fold:null, mu:0.18, sgtr:false,
          ports:{}, thermal:"none"},
  /* Stage 5d: three "systems with mass" that used to be a checkbox and
     nothing on the grid. None gets `fixed` - the run each one carries
     (D.run, design.js) lands on a node that is ALREADY reachable from the
     rest of the primary network (sg0's own "b" face, the core's folded
     node), so each hangs off it as a true pendant leaf: no fixed pressure
     and no head anywhere past that one edge means KCL forces exactly zero
     current through it, so it cannot move a single other pressure or flow
     in the solve - see the auditor's own sweep proving netFlowK/DNBR/n
     don't move with these parts on the grid. */
  catcher: {internal:null, head:false, fixed:null, fold:null, mu:0.55, sgtr:false,
          ports:{}, thermal:"none"},                          // a structure, not a network part - no run, no ports, no exception needed
  efw:     {internal:null, head:false, fixed:null, fold:null, mu:0.65, sgtr:false,
          ports:{"*":1}, thermal:"none"},                     // tank and pump as one box, the same idiom D.accum already gives HPI
  boroninj:{internal:null, head:false, fixed:null, fold:null, mu:0.65, sgtr:false,
          ports:{"*":1}, thermal:"none"},
};

function buildLayout(){
  const A=[], add=(id,name,w,h,x,y,col,grp,tip,role)=>{ const p={id,name,w,h,x,y,col,grp,tip,role}; A.push(p); return p; };
  add("core","REACTOR",3,3,2,4,"#ff5a45","core",
    "The vessel and the fuel inside it. Select it to choose the coolant family, the fuel, the lattice and the core shape.","core");
  add("rods","ROD DRIVES",3,1,2,3,"#c8d8dc","core",
    "Control rod drive mechanisms, bolted to the vessel head. They ride on the head and move with the reactor - you site the reactor, not the drives. Select for scram gear, bank worth and emergency poison.","rods")
    .pin={to:"core",dx:0,dy:-1};
  add("pzr","PRESSURIZER",1,2,5,1,"#a98cf0","primary",
    "Sets loop pressure. It has to sit high - the steam bubble must stay at the top of the loop.","pzr");
  // ONE generator, ONE pump - the stock loadout, exactly like every other
  // fixed-slot part above. There is no knob for how many of these exist:
  // an additional generator is a PLACED part (ADD STEAM GENERATOR HERE,
  // design-bench.js), wired by hand through Stage 3a's CONNECT, the same
  // way a spare pump already is. Loop membership is read off the run graph
  // (loopOf(), above), not stored.
  add("sg0","STEAM GEN 1",1,2,8,1,"#5fd2e2","loop0",
    "Raise this ABOVE the reactor and hot water rises into it unaided. That height difference is your blackout survival.","sg");
  add("pump0","RCP 1",1,1,8,6,"#57d38c","loop0",
    "Coolant pump. Keep it low and reachable - it is the component most likely to need a repair under fire.","pump");
  if(fitOf("turb")) add("turb","TURBINE",3,1,12,4,"#f0a830","sec",
    "Draws the ship's load. Select it to size the steam dump that absorbs a turbine trip.","turb");
  if(fitOf("cond")) add("cond","CONDENSER",3,1,12,7,"#5aa9d6","sec",
    "Rejects waste heat. Bulky, and it wants to be near the hull.","cond");
  add("feed","FEED PUMP",1,1,15,5,"#5aa9d6","sec",
    "Returns water to the steam generator. Lose it and the heat sink boils dry.","feed");
  add("ctrl","CONTROL",2,1,1,8,"#cfc9b8","crew",
    "Where your crew sits. Distance and shielding from the reactor set the dose they take.","ctrl");
  if(fitOf("cont")) add("cont","CONTAINMENT",2,1,4,8,"#8fa9ae","safety",
    "The barrier between damaged fuel and your crew. Select it for containment type and the core catcher.","cont");
  // Stage 5d: a structure, not a flag - it occupies real floor space under
  // the vessel rather than costing 66 t for nothing on the grid at all.
  // ports:{} (ROLE.catcher) - it carries no run and needs none; "is the core
  // sitting over the catcher" is a geometric question with a geometric
  // answer now, exactly like "is the pressurizer the highest point".
  if(D.catcher) add("catcher","CORE CATCHER",1,1,3,8,"#5a4a3a","safety",
    "A cooled basin under the vessel. It will not save the fuel, but it stops a melted core burning through and breaching the vessel, which keeps the release contained.","catcher");
  /* Unconditional, because every plant has one. It used to appear only when
     the PASSIVE ACCUMULATOR was bought, while step() injected at a fixed rate
     either way - so a plant with pumped injection had a system with no tank,
     no pipe and no place, and the injection line it drew water through was
     not on the drawing. D.accum decides what is BEHIND the water now (a
     nitrogen charge or a set of pumps, TANK in pipenet.js), not whether the
     water exists. */
  /* HIGH, because its own tooltip says to mount it high and the stock layout
     must satisfy every rule it teaches. It sat at y=5, dead level with the
     core centre, so ACCUMULATOR HEAD read 0.0 m and the bench coloured its own
     stock plant amber. Raising it lengthens the injection line, which P.flowK
     prices - see the re-pinned figures in tools/audit-physics.js. */
  add("hpi", D.accum?"ACCUMULATOR":"HPI TANK",1,1,3,1,"#5aa9d6","safety",
    "Emergency injection water, and its one line into the loop. Mount it HIGH: its own column is real head, and it only injects while it is winning against the pressure in the loop.","hpi");
  add("bkp","BACKUP PWR",1,1,15,8,"#57d38c","safety",
    "Batteries or diesels keeping the pumps turning through a blackout. Keep it away from the hull.","bkp");
  // Stage 5d: emergency feedwater is a tank and a pump now (one box, the
  // same idiom D.accum already gives HPI), placed and piped to the
  // generator's own free "r" face, not a checkbox. D.run's own efwF entry
  // (design.js) wires it unconditionally; pipeNetwork() already skips any
  // run whose part is off the grid, so nothing routes while D.efw is false.
  // The effect stays a STATED, MEASURED one (AUTOSYS.efw, step.js) until
  // Stage 6a gives the secondary something to actually deliver flow to.
  if(D.efw) add("efw","EFW TANK",1,1,9,1,"#5aa9d6","safety",
    "Independent feedwater reserve and pump, piped straight to the generator. Keeps it fed after the main feed pumps are lost - see its own panel for what that is measured to buy.","efw");
  // Stage 5d: same argument as EFW - a tank and a line into the primary
  // loop (core's own folded node), not a flag. The dump itself (act
  // boronDump, record.js) stays a one-shot pcm kick; this is what makes the
  // button on the mimic answer "is there a tank on the grid" rather than a
  // D flag with nothing behind it.
  if(D.boroninj) add("boroninj","BORON TANK",1,1,1,3,"#8a6cd0","safety",
    "A one-shot tank of concentrated poison worth 4000 pcm, piped into the loop. Shuts the reactor down when the rods will not, and cannot be undone.","boroninj");
  for(let i=0;i<3;i++) add("shld"+i,"SHIELD",1,1,2+i,7,"#6d8f98","shield",
    "A block of shielding. Put it between the reactor and the control room to cut crew dose. It has mass and it blocks access.","shield");
  // placed parts merge in last, checked straight against A (not groupFits(),
  // which reads the global LAY.parts - still the PRE-rebuild layout here)
  for(const p of placedParts){
    let ok = p.x>=0 && p.y>=0 && p.x+p.w<=GW && p.y+p.h<=GH;
    if(ok) for(const q of A) if(p.x<q.x+q.w && p.x+p.w>q.x && p.y<q.y+q.h && p.y+p.h>q.y){ ok=false; break; }
    if(ok) A.push(p);
  }
  LAY={parts:A}; layFit=fitSig();
}
// a control strip needs more than a 2-cell component's 92px width, so the
// control room gives each grid ROW extra height at the bottom - as much as
// the widest strip ending in that row. Null on the bench (no live state), and
// reset before every layoutMetrics() measure so pipe/thermosiphon figures
// stay identical on both screens regardless of what the control room drew.
let BANDS=null;                                  // per-row extra height, or null
function rowTop(r){ let y=GY+r*CELL;
  if(BANDS) for(let i=0;i<r;i++) y+=BANDS[i]||0;
  return y; }
/* the inverse of rowTop(), and it must keep counting past both ends of the grid:
   a port on the very bottom edge lands on row GH, and bendAt() relies on that
   index falling off its occupancy grid rather than being clamped onto row GH-1 */
function rowAt(py){
  if(py<GY) return Math.floor((py-GY)/CELL);
  for(let r=0;r<GH;r++) if(py<rowTop(r+1)) return r;
  return GH+Math.floor((py-rowTop(GH))/CELL);
}
const gridH = () => rowTop(GH)-GY;
const PXc=g=>GX+g*CELL, PYc=g=>rowTop(g);
// height is not p.h*CELL: the rows it spans may carry control bands
const prect=p=>({x:PXc(p.x), y:rowTop(p.y), w:p.w*CELL, h:rowTop(p.y+p.h)-rowTop(p.y)});
function port(p,side,slot=0,n=1,shift=0){
  const {x,y,w,h}=prect(p);
  const len = (side==="t"||side==="b") ? w : h;
  const pitch = Math.min(len/(n+1),CELL/2);
  // how far this nozzle may slide off its slot before it fouls its neighbour
  // on the same face, or runs off the end of the face
  const room = n>1 ? pitch/2-1 : len/2-6;
  const d = (n>1 ? (slot-(n-1)/2)*pitch : 0) + clamp(shift,-room,room);
  const o = Math.round(Math.abs(d))*Math.sign(d);   // symmetric, so the spread stays balanced
  return side==="l"?[x,y+h/2+o] : side==="r"?[x+w,y+h/2+o]
       : side==="t"?[x+w/2+o,y] : side==="b"?[x+w/2+o,y+h] : [x+w/2,y+h/2];
}
function laneSegs(pts){ const out=[];
  for(let i=1;i<pts.length;i++){ const a=pts[i-1], b=pts[i];
    if(Math.abs(a[0]-b[0])<0.5){ if(Math.abs(a[1]-b[1])>0.5)
        out.push(["v",a[0],Math.min(a[1],b[1]),Math.max(a[1],b[1])]); }
    else out.push(["h",a[1],Math.min(a[0],b[0]),Math.max(a[0],b[0])]); }
  return out; }
// tracks the lanes a network's runs have taken, live for one pipeNetwork()
// call (routing scratch, not plant state). A claim is an interval, not a
// whole lane - two runs sharing a lane but never overlapping on it are fine -
// and a run is scored and claimed whole, not just at its bend, because a
// square stub into a face collides just as readily as the bend does.
const LANE_STEP=8, LANE_COST=8;
const outboard=d=>{ const a=[]; for(let i=0;i<24;i++) a.push(d*LANE_STEP*i); return a; };
const eitherWay=(()=>{ const a=[0];
  for(let i=1;i<=5;i++) a.push(LANE_STEP*i,-LANE_STEP*i); return a; })();
function laneReg(){
  const held=[];
  // a pipe is 8px of halo wide, so LANE_STEP is the separation two runs need
  // to read as two pipes rather than one fat one
  const clash=s=>held.filter(u=>u[0]===s[0] && Math.abs(u[1]-s[1])<LANE_STEP-0.5 &&
        Math.min(u[3],s[3])-Math.max(u[2],s[2])>1.5).length;
  const cost=pts=>laneSegs(pts).reduce((n,s)=>n+clash(s),0);
  return {
    cost,
    claim(pts){ for(const s of laneSegs(pts)) held.push(s); return pts; },
    // wishes tried in order, so the first run to ask keeps its usual lane and
    // later ones stand off from it
    pick(mk,v,wish){ for(const d of wish) if(!cost(mk(v+d))) return v+d;
      return v; }
  };
}
const bendPoly=(a,b,vert)=> vert ? m=>[a,[m,a[1]],[m,b[1]],b]
                                 : m=>[a,[a[0],m],[b[0],m],b];
// where to bend when there's a choice: fewest components cut through, then
// least other pipe buried. `vert` means the bend run itself is vertical.
function bendAt(a,b,vert,skip,reg){
  const g=occupied(null), i=vert?0:1, j=vert?1:0;
  const lo=a[i], hi=b[i], mid=(lo+hi)/2, mk=bendPoly(a,b,vert);
  const n=vert?GW:GH;
  /* rows are not a fixed pitch once the control bands are in, so a pixel y has
     to be looked up rather than divided */
  const k0 = vert ? rowAt(Math.min(a[j],b[j])) : Math.floor((Math.min(a[j],b[j])-GX)/CELL);
  const k1 = vert ? rowAt(Math.max(a[j],b[j])) : Math.floor((Math.max(a[j],b[j])-GX)/CELL);
  let best=mid, bd=1e9;
  for(let c=0;c<n;c++){
    const m = vert ? GX+(c+0.5)*CELL : rowTop(c)+CELL/2;
    if(m<Math.min(lo,hi)-1 || m>Math.max(lo,hi)+1) continue;
    let hits=0;
    for(let k=Math.max(0,k0);k<=k1;k++){
      const cell = vert ? (g[k]||[])[c] : (g[c]||[])[k];
      if(cell && skip.indexOf(cell)<0) hits++;
    }
    /* burying another pipe costs, but less than cutting a machine in half:
       avoiding hardware still outranks avoiding pipe */
    const d=hits*10+Math.abs(m-mid)/CELL+reg.cost(mk(m))*LANE_COST;
    if(d<bd){ bd=d; best=m; }
  }
  /* a cell centre is also where a one-cell component puts its own nozzle, so the
     tidy lane is exactly the one an existing port stub is most likely to be
     lying in.  If it is, step off the cell grid rather than draw on top of it. */
  return reg.pick(mk,best,eitherWay);
}

/* the face of p that points at q - a nozzle should be on the side the pipe comes from,
   otherwise the run crosses the component to reach the far face and looks unconnected */
function face(p,q){
  const a=cen(p), b=cen(q), dx=b.x-a.x, dy=b.y-a.y;
  return Math.abs(dx)>Math.abs(dy) ? (dx>=0?"r":"l") : (dy>=0?"b":"t");
}

/* a bend that lands on one of its own endpoints emits that point twice, and a
   zero-length segment is a stroke the renderer pays for and nobody can see */
function dedupe(pts){
  const out=[pts[0]];
  for(let i=1;i<pts.length;i++){ const q=out[out.length-1];
    if(Math.abs(pts[i][0]-q[0])>0.5||Math.abs(pts[i][1]-q[1])>0.5) out.push(pts[i]); }
  return out;
}
// half the render's 4px pipe stroke (src/render/pipes.js) - a leg no wider
// than the pipe drawn over it is invisible as a leg, so it is folded into
// its neighbour before asking whether the legs on either side of it reverse
const RETRACE_TOL=2;
// a leg shorter than the pipe's own width can't be seen as a leg - the pipe
// drawn either side of it already overlaps it - so drop its far point and let
// the legs before and after it be compared directly, as if it were absent
function foldShortLegs(pts){
  const out=[pts[0]];
  for(let i=1;i<pts.length-1;i++){
    const q=out[out.length-1], p=pts[i];
    if(Math.hypot(p[0]-q[0],p[1]-q[1])<=RETRACE_TOL) continue;
    out.push(p);
  }
  out.push(pts[pts.length-1]);
  return out;
}
// true if a leg immediately reverses over the one before it (collinear, opposite
// direction) - a same-face elbow whose lateral leg collapsed to, or shrank
// within, the pipe's own width folds this way, drawing one stroke over another
// instead of turning a corner
function retraces(pts){
  const d=foldShortLegs(dedupe(pts));
  for(let i=2;i<d.length;i++){
    const ax=d[i-2][0],ay=d[i-2][1], bx=d[i-1][0],by=d[i-1][1], cx=d[i][0],cy=d[i][1];
    const legLen=Math.hypot(bx-ax,by-ay);
    if(!legLen) continue;
    if(Math.abs((bx-ax)*(cy-by)-(by-ay)*(cx-bx))/legLen>RETRACE_TOL) continue;
    if((bx-ax)*(cx-bx)+(by-ay)*(cy-by)<0) return true;
  }
  return false;
}
const SLIDES=[[8,0],[-8,0],[0,8],[0,-8],[8,8],[-8,-8],[16,0],[-16,0],[0,16],[0,-16]];
// o.pa/o.pb replace that end's PORT with a bare point (a waypoint has no
// component or face to leave square to); o.va/o.vb then say which way the leg
// leaves or arrives there, since a point has no face to read it off.
// See routeVia(), the only caller.
function route(p,sa,q,sb,o){
  o=o||{};
  const reg=o.reg||laneReg();
  const va=o.va!=null?o.va:(sa==="t"||sa==="b"),
        vb=o.vb!=null?o.vb:(sb==="t"||sb==="b"), off=CELL/2;
  const build=(da,db)=>{
    const a=o.pa||port(p,sa,o.ia,o.na,da), b=o.pb||port(q,sb,o.ib,o.nb,db);
    if(va!==vb) return va ? [a,[a[0],b[1]],b]    // out vertically, in horizontally
                          : [a,[b[0],a[1]],b];   // out horizontally, in vertically
    const vert=!va, mk=bendPoly(a,b,vert), i=vert?0:1;
    const away=(sa==="r"||sa==="b")?1:-1;       // which way is clear of both components
    const m = sa===sb
      ? reg.pick(mk, away>0?Math.max(a[i],b[i])+off:Math.min(a[i],b[i])-off, outboard(away))
      : bendAt(a,b,vert,[p,q],reg);
    return mk(m);
  };
  /* STRAIGHTEN FIRST. port() spreads N pipes on one face into N slots, so a
     face carrying two runs puts neither on its centre - the steam generator's
     bottom hands the cold leg out 8px off, while the pump's top carries one
     pipe and sits dead centre. The run then stepped sideways between two
     components standing in the same column, for a reason nothing on screen
     explains. So when one face is crowded and the other carries a single
     nozzle, the FREE one slides to meet the fixed one and the run comes out
     straight. It is only ever the single-nozzle end that moves: sliding a
     slot on a crowded face would foul the neighbour it was spread away from.
     Alignment loses to burial - a straight run nobody can see is no better
     than a bent one - so a shift that costs a lane is thrown away here and
     the ordinary build below stands. */
  const nA=o.na||1, nB=o.nb||1, ax=va?0:1;
  let pts=null;
  if(va===vb && !o.pa && !o.pb && (nA===1)!==(nB===1)){
    const d = port(q,sb,o.ib,nB,0)[ax] - port(p,sa,o.ia,nA,0)[ax];
    if(d){
      const t = nA===1 ? build(d,0) : build(0,-d);
      if(!reg.cost(t) && !retraces(t)) pts=t;
    }
  }
  // a nozzle whose run would be buried anyway may slide along its own face:
  // at four loops the turbine, condenser and last pump share column 13, so a
  // pipe entering there has nowhere to be but under the one already passing
  // through - no lane choice helps, the nozzle itself has to move
  if(!pts) pts=build(0,0);
  // build() only reads da/db through port(), and o.pa/o.pb (both set on a
  // waypoint-to-waypoint leg) replace that call outright - so every SLIDES
  // candidate would rebuild the identical polyline pts already is
  if((reg.cost(pts) || retraces(pts)) && !(o.pa && o.pb)) for(const [da,db] of SLIDES){
    const t=build(da,db);
    if(!reg.cost(t) && !retraces(t)){ pts=t; break; }
  }
  return reg.claim(dedupe(pts));
}
// a point the run has to pass through, stored as an ABSOLUTE plant point (a
// pipe has no anchor to be an offset FROM - both ends are recomputed from
// nothing every frame). Nothing sweeps this array; an entry for a run whose
// kind stops existing is simply left behind.
const pipeWaypoints={};
// sorted on every read by distance from the run's start, so dragging one
// point past another re-orders the run instead of tangling it. Objects are
// the stored ones, not copies, so a sort never renumbers what a grip is holding.
function pipeWayList(key,a0){
  const w=pipeWaypoints[key];
  if(!w||!w.length) return [];
  return w.slice().sort((p,q)=>Math.hypot(p.x-a0[0],p.y-a0[1])-Math.hypot(q.x-a0[0],q.y-a0[1]));
}
// n waypoints is n+1 calls to route(), never hand-rolled pathfinding. Each
// leg alternates axis (start face decides the first), or a pair could double
// back along one lane - a pipe drawn twice. A waypoint dropped past the far
// end still routes out-and-back on the same lane; that's the player's
// diagram to make ugly, the same allowance a dragged-into-a-corner part gets.
function routeVia(c,o){
  const a0=port(c.a,c.sa,o.ia,o.na), wps=pipeWayList(c.key,a0);
  if(!wps.length){ const pts=route(c.a,c.sa,c.b,c.sb,o); return {pts,legs:[pts],wps}; }
  const va=c.sa==="t"||c.sa==="b", pt=p=>[p.x,p.y], legs=[];
  legs.push(route(c.a,c.sa,null,"",{reg:o.reg,ia:o.ia,na:o.na,pb:pt(wps[0]),vb:!va}));
  for(let i=1;i<wps.length;i++)
    legs.push(route(null,"",null,"",{reg:o.reg,pa:pt(wps[i-1]),pb:pt(wps[i]),va,vb:!va}));
  legs.push(route(null,"",c.b,c.sb,{reg:o.reg,ib:o.ib,nb:o.nb,pa:pt(wps[wps.length-1]),va}));
  let pts=legs[0];
  for(let i=1;i<legs.length;i++) pts=pts.concat(legs[i]);
  return {pts:dedupe(pts),legs,wps};
}
// segment lengths and total, for turning a point-on-polyline into a fraction
// of the WHOLE run (nearestOn) or back again (juncPt) - written once so the
// two stay the same arithmetic
function polySegLens(pts){
  const seg=[]; let tot=0;
  for(let i=1;i<pts.length;i++){ const d=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]); seg.push(d); tot+=d; }
  return {seg,tot};
}
/* nearest point on a polyline - where a branch line tees onto a run - plus
   t, that point's fraction of the run's own length, for a junction tap to
   store instead of a pixel (juncPt below resolves it back) */
function nearestOn(pts,p){
  const {seg,tot}=polySegLens(pts);
  let best=pts[0], bd=1e9, bt=0, acc=0;
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1], b=pts[i];
    const dx=b[0]-a[0], dy=b[1]-a[1], L=dx*dx+dy*dy;
    const t = L? clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L,0,1) : 0;
    const q=[a[0]+dx*t, a[1]+dy*t];
    const d=Math.hypot(q[0]-p[0],q[1]-p[1]);
    if(d<bd){ bd=d; best=q; bt = tot? (acc+seg[i-1]*t)/tot : 0; }
    acc+=seg[i-1];
  }
  return {pt:best,d:bd,t:bt};
}
// resolves a (run key, t) tap to a plant-space point off THIS frame's routed
// network, plus which way the host run runs there. The one place any of the
// four junction call sites (branch routing, glyph draw/hit-test, bench menu
// resolve, bench menu store) turns a tap into a point, so a part moved
// upstream of a tap is picked up by all four the same frame it moves.
function juncPt(net,key,t){
  const r=net.find(x=>x.key===key);
  if(!r) return null;                 // the tapped run's part is gone
  const pts=r.pts, {seg,tot}=polySegLens(pts);
  if(!tot) return {pt:pts[0].slice(),vert:false};
  const target=clamp(t,0,1)*tot; let acc=0;
  for(let i=1;i<pts.length;i++){
    const d=seg[i-1];
    if(acc+d>=target-1e-6 || i===pts.length-1){
      const lt=d? clamp((target-acc)/d,0,1) : 0;
      const a=pts[i-1], b=pts[i];
      return {pt:[a[0]+(b[0]-a[0])*lt, a[1]+(b[1]-a[1])*lt], vert:Math.abs(a[0]-b[0])<0.5};
    }
    acc+=d;
  }
}
function plen(pts){ let L=0;
  for(let i=1;i<pts.length;i++) L+=Math.abs(pts[i][0]-pts[i-1][0])+Math.abs(pts[i][1]-pts[i-1][1]);
  return L/CELL*MPC; }

/* The ONE relief header D.run declares (design.js), routed live by
   pipeNetwork(). Its key carries the two faces that routing picked, so it
   changes the moment the pressurizer or the tank moves - and a fitting that
   had stored the old string then resolved against nothing: no branch
   routed, FIT.relief.g 0 whatever S.reliefOpen said, and the valve vented
   NOTHING while its glyph, its tank, its mimic and its mass all stayed.
   That is the frozen-pixel bug juncPt() exists to prevent, one level up: a
   fitting must store a tap, never a key that geometry is still free to
   rename. Relief is the only mode that can resolve this way, because it is
   the only one whose far end is a run the design derives rather than one
   the player picked. */
function reliefHeaderKey(net){
  const r=net.find(x=>x.k==="relief");
  return r?r.key:null;
}
// Where a fitting's far tap actually lands this frame. Only relief re-resolves;
// a tee or a branch throttle taps two runs the player chose, and moving one out
// from under it is a real answer, not a rename to paper over.
function fitBKey(net,j){
  return j.mode==="relief" ? reliefHeaderKey(net) : j.bKey;
}

/* pipeNetwork() reads D.run (design.js), not a hard-coded topology: a run
   EXISTS because it is declared, never because pipeNetwork() inferred it
   from which parts happen to be on the grid. What is still decided HERE is
   the ROUTE - which face a dynamic (`af`/`bf` null) end leaves from, and
   (for a tap-ended run) where along the target run it lands - because a
   route is a presentation of a connection the design already made, not an
   invention of one. See D.run's own comment (design.js) for the entry
   shape.

   routing happens in two passes because neither can go first: a run cannot
   pick its nozzle until its face knows how many pipes land on it, and a face
   cannot know that until every run has been declared */
function pipeNetwork(){
  const id=k=>LAY.parts.find(q=>q.id===k);
  // a KIND is not an identity: every loop's hot leg is kind "hot" (one animated
  // line), but a waypoint belongs to ONE physical run, so each gets its own
  // stable key from both ends and both faces
  const conn=[];
  for(const rid in D.run){
    const e=D.run[rid];
    const a=id(e.a);
    if(!a) continue;                    // this entry's part is not on the grid this frame
    if(e.tap){                          // lands on another run, not on a port of its own
      conn.push({rid,k:e.k,a,sa:e.af,tap:e.tap,key:e.k+":"+a.id+e.af});
      continue;
    }
    const b=id(e.b);
    if(!b) continue;
    const sa=e.af!=null?e.af:face(a,b), sb=e.bf!=null?e.bf:face(b,a);
    conn.push({rid,k:e.k,a,sa,b,sb,key:e.k+":"+a.id+sa+"-"+b.id+sb});
  }

  const key=(p,s)=>p.id+s, cnt={}, seen={};
  const tally=(p,s)=>{ if(p) cnt[key(p,s)]=(cnt[key(p,s)]||0)+1; };
  for(const c of conn){ tally(c.a,c.sa); tally(c.b,c.sb); }
  const take=(p,s)=>{ const k=key(p,s), i=seen[k]||0; seen[k]=i+1; return [i,cnt[k]]; };

  const reg=laneReg(), net=[];
  const ridPts={};                      // this frame's routed pts, by D.run id - what a tap lands against
  for(const c of conn){
    if(c.tap){                          // e.g. surge, dropping onto whatever run it names
      const [ia,na]=take(c.a,c.sa), a=port(c.a,c.sa,ia,na);
      const hot0=ridPts[c.tap];
      if(!hot0) continue;               // the tapped run didn't route this frame
      let ty=null;                     // nearest run passing under this end
      for(let i=1;i<hot0.length;i++){
        if(Math.abs(hot0[i][1]-hot0[i-1][1])>0.5) continue;
        const lo=Math.min(hot0[i-1][0],hot0[i][0]), hi=Math.max(hot0[i-1][0],hot0[i][0]);
        if(a[0]>=lo-1 && a[0]<=hi+1 && hot0[i][1]>a[1]+3 && (ty===null||hot0[i][1]<ty))
          ty=hot0[i][1];
      }
      if(ty!==null) net.push({k:c.k,key:c.key,rid:c.rid,pts:[a,[a[0],ty]],wp:false,nz:[true,false]});
      else { const t=nearestOn(hot0,a);  /* nothing underneath: reach across to the leg */
        if(t.d>3) net.push({k:c.k,key:c.key,rid:c.rid,pts:dedupe([a,[a[0],t.pt[1]],t.pt]),wp:false,nz:[true,false]}); }
      continue;
    }
    const [ia,na]=take(c.a,c.sa), [ib,nb]=take(c.b,c.sb);
    const r=routeVia(c,{reg,ia,na,ib,nb});
    /* nz: which END of this run lands on a component PORT, so drawPlant()
       knows where a nozzle belongs. Stated, never inferred - the wp flag
       right beside it used to be read off "has no key", which was control
       flow by accident, and this would rot the same way. rid: which D.run
       entry this is - CONNECT's own DISCONNECT offer needs it to name what
       to delete, the same way a fitting's own id already does. */
    net.push({k:c.k,key:c.key,rid:c.rid,pts:r.pts,legs:r.legs,wps:r.wps,wp:true,nz:[true,true]});
    ridPts[c.rid]=r.pts;
  }
  // a branch fitting: a tap on one run reaching a tap on another, both
  // resolved off the NET this call just built (main conn loop first, so both
  // taps have something to resolve against). An in-line fitting (bKey null -
  // only a throttle can be one) has no second tap and so no route of its own
  // to draw; it lives entirely inside the run it sits on. Kind is "xtie:"+id
  // on purpose - pipes.js's existing k.startsWith("xtie") fallbacks cover any
  // suffix, so no new table row is needed, tee or throttle alike. wp:false: a
  // branch pinned to two taps has no route of its own to steer, and the glyph
  // (plant.js) stays pinned to the A tap - letting it gain a grip would let
  // it drift off the point it's supposed to mark.
  for(const jid in D.fit){
    const j=D.fit[jid];
    if(!j.bKey) continue;               // in-line: no second tap, no route
    const A=juncPt(net,j.aKey,j.aT);
    let B=juncPt(net,fitBKey(net,j),j.bT);
    /* A relief valve with nowhere to land its far tap - no header run, no
       tank on the grid yet - still vents (pipenet.js's own containment
       fallback), so it still needs a stub to draw: a short nub straight up
       off its own tap, "vents into the room" made picture-shaped, rather
       than the branch silently not existing. Every other mode keeps the old
       behaviour: a tapped run whose part vanished draws nothing. */
    if(!B && j.mode==="relief" && A) B={pt:[A.pt[0], A.pt[1]-CELL*0.4], vert:true};
    if(!A||!B) continue;              // a tapped run's part was removed
    // sa/sb just need to differ - both taps are bare points (o.pa/o.pb), so
    // neither string reaches port(). Equal strings would send route() down
    // its "leaving the same named face" outboard slide, which assumes a real
    // face direction; a hardcoded fallback there instead sends every tie
    // bending the same way regardless of where its two taps actually sit,
    // which folds the branch back over its own start when the far tap ends
    // up on the near side of that fixed bend. Distinct strings route it
    // through bendAt()'s collision search instead, the same one every other
    // bare-point-to-bare-point leg (a waypoint run) already resolves through.
    const pts=route(null,"a",null,"b",{reg,pa:A.pt,pb:B.pt,va:!A.vert,vb:!B.vert});
    net.push({k:"xtie:"+jid, key:"xtie:"+jid, pts, wp:false, nz:[false,false]});
  }
  // which faces are occupied THIS frame, by "partId+face" - the same tally
  // route()/port() already built to spread N pipes into N slots, exposed
  // once rather than rebuilt: CONNECT's own "is this port free" check
  // (portRoom(), below) reads it, and so does netBuild()'s "does this part
  // have ANY real run reaching it at all" test (pipenet.js).
  net.usage=cnt;
  return net;
}
/* Which faces of a part still have room for one more run, per ROLE.ports -
   "*" caps the TOTAL across every face instead of one each (feed, and the
   tank-side end of relief, pick their own face live rather than declaring
   one). The only two things CONNECT may ever refuse are this and "no route"
   - never what a component IS FOR. */
function portRoom(p){
  const R=ROLE[p.role], out={t:false,b:false,l:false,r:false};
  if(!R || !R.ports) return out;
  const usage=pipeNetwork().usage||{};
  if(R.ports["*"]!=null){
    let used=0; for(const f in out) used+=usage[p.id+f]||0;
    const free=used<R.ports["*"];
    for(const f in out) out[f]=free;
    return out;
  }
  for(const f in out) out[f] = R.ports[f]!=null && (usage[p.id+f]||0)<R.ports[f];
  return out;
}
// the nearest FREE port to a plant-space point, over every part but one -
// the "convenience, never a gate" half of CONNECT (design-bench.js): it
// only ever picks a DEFAULT, and finding nothing here means no offer, never
// a refusal. threshold is half a cell, the same reach a run's own tap
// search already uses relative to CELL.
function nearestFreePort(pt,excludeId){
  let best=null,bd=1e9;
  for(const p of LAY.parts){
    if(p.id===excludeId) continue;
    const room=portRoom(p);
    for(const f in room){
      if(!room[f]) continue;
      const a=port(p,f);
      const d=Math.hypot(a[0]-pt[0],a[1]-pt[1]);
      if(d<bd){ bd=d; best={part:p,face:f,pt:a}; }
    }
  }
  return best && bd<CELL*0.85 ? best : null;
}
/* ══════════ D.run: A CONNECTION IS AUTHORED, A ROUTE IS COMPUTED ══════════
   addRun()/removeRun() are the CONNECT/DISCONNECT half of Stage 3a, the
   same standing addFit()/removeFit() already have: a design edit, called
   straight from the context menu (design-bench.js), not through act(). That
   is an EXISTING gap, not a new one - nothing in ACT writes D today, so a
   fitting was already unrecorded and unreplayable before this. Extending
   the same shape rather than inventing a second one keeps that gap
   singular instead of doubling it; giving D edits their own recording path
   is real work nobody has asked for in this pass.
   `k:"user"` is a LABEL only (bore default, display name) - it never gates
   the solve, and it never gates loopMap() either, which is why a spare pump
   plumbed this way genuinely pools capacity with whatever it reaches. */
let runSeq=0;
function addRun(aId,af,bId,bf,bore=1){
  const rid="usr"+(runSeq++);
  D.run[rid]={a:aId,af,b:bId,bf,k:"user",bore};
  return rid;
}
function removeRun(rid){ delete D.run[rid]; }
/* Is there a relief tank on the board for a relief valve to discharge into?
   Every relief fitting shares the one tank, so the design-bench menu only
   offers ADD RELIEF VALVE once it exists.

   Off ROLE, never p.id: "is this the relief tank" is a declared role, and the
   PARTS row's own get() matches on the id only because that row IS the id's
   definition. This was referenced from design-bench.js and never written -
   right-clicking a pipe on the bench threw "hasRelief is not defined" and
   took the whole frame with it, because ctxItemsDesign() runs inside the draw
   (drawCtxMenu -> drawDesign -> tick). No auditor opens that menu. */
function hasRelief(){ return LAY.parts.some(p => p.role === "reltk"); }

/* A soft, honest "nothing removes heat" warning (design.js's derived()) -
   topological only, off D.run alone: Stage 6 is what would let this READ
   the loop, so today it can only ask whether anything that COULD reject
   heat is wired to the primary at all. Any run counts, any kind - Stage 1's
   rule again, a run is a run. */
function hasHeatSink(){
  const id=k=>LAY.parts.find(q=>q.id===k);
  const core=id("core"); if(!core) return true;   // no core, no claim to make
  const seen=new Set(["core"]), stack=["core"];
  while(stack.length){
    const u=stack.pop();
    for(const rid in D.run){
      const e=D.run[rid]; if(e.tap) continue;
      const a=id(e.a), b=id(e.b); if(!a||!b) continue;
      if(a.id===u && !seen.has(b.id)){ seen.add(b.id); stack.push(b.id); }
      else if(b.id===u && !seen.has(a.id)){ seen.add(a.id); stack.push(a.id); }
    }
  }
  for(const pid of seen){ const p=id(pid), R=p&&ROLE[p.role];
    if(R && (R.thermal==="sink"||R.thermal==="transfer")) return true; }
  return false;
}
// BACKUP PWR ghosts rather than vanishes: NONE is a real dropdown choice
// (mass 0) that still occupies its cell, because it's a three-way quality
// dial (NONE/BATTERY/DIESEL), not an add/remove part like fittableList()'s
const fitted=p => p.id==="bkp" ? D.bkp>0 : true;
const cen=p=>({x:p.x+p.w/2,y:p.y+p.h/2});
const pinnedTo=p=>LAY.parts.filter(q=>q.pin&&q.pin.to===p.id);
// skip is one part or a whole group - a group move lifts parent and pinned
// children off the grid together, or the parent collides with its own child
function occupied(skip){
  const off = skip ? (Array.isArray(skip)?skip:[skip]) : [];
  const g=Array.from({length:GH},()=>new Array(GW).fill(null));
  for(const p of LAY.parts){ if(off.includes(p)) continue;
    for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
      if(X>=0&&X<GW&&Y>=0&&Y<GH) g[Y][X]=p; }
  return g;
}
// all of a group is tested before any of it moves, so it never half-lands
function groupFits(cells){
  const g=occupied(cells.map(c=>c.q));
  for(const {q,x,y} of cells){
    if(x<0||y<0||x+q.w>GW||y+q.h>GH) return false;
    for(let X=x;X<x+q.w;X++) for(let Y=y;Y<y+q.h;Y++) if(g[Y][X]) return false;
  }
  return true;
}
function moveTo(p,nx,ny){
  if(p.pin) return false;
  const cells=[{q:p,x:nx,y:ny}].concat(
    pinnedTo(p).map(q=>({q,x:nx+q.pin.dx,y:ny+q.pin.dy})));
  if(!groupFits(cells)) return false;
  for(const {q,x,y} of cells){ q.x=x; q.y=y; }
  return true;
}
// every cell a party could stand in beside p and still be working ON p - not
// inside its footprint, not diagonal-only off a corner, and not already
// occupied by something else. One definition shared by three questions:
// layoutMetrics() asks whether this list is empty (REPAIR ACCESS), the
// radiation field asks which entry in it reads coldest (rad.js, radParty()),
// and a survey renderer asks for the whole list to outline.
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
  if(!LAY||layFit!==fitSig()) buildLayout();
  // measure the design, not the view: drawPlant() sets the bands again
  // straight after this returns, and nothing measures between the two
  BANDS=null;
  const P_=LAY.parts, id=k=>P_.find(q=>q.id===k), core=id("core"), cc=cen(core);
  let head=0, n=0;
  for(const p of P_) if(p.role==="sg"){ head += (cc.y - cen(p).y); n++; }
  head = n? head/n : 0;
  let pipe=0, sec=0, dead=0;
  for(const r of pipeNetwork()){
    const L=plen(r.pts);
    /* A relief line is a DEAD LEG: it sits shut behind its valve and carries
       no flow until something lifts, so its water is not moving and adds no
       inertia to a loop transient. It still has to be built and hung, so it
       still costs mass - that is the whole cost of a relief path, and it is
       meant to be felt on the budget, not as a plant that coasts down
       differently for owning a valve it has never opened. */
    const fid = r.k.startsWith("xtie:") ? r.k.slice(5) : null;
    const isRelief = r.k==="relief" || (fid && D.fit[fid] && D.fit[fid].mode==="relief");
    if(isRelief) dead+=L;
    // a cross-tie is a parallel branch, not another metre of loop, so it pays
    // mass/inertia with the secondary runs and never slows the pumps down
    else if(r.k==="hot"||r.k==="cold"||r.k==="surge"||r.k==="hpi") pipe+=L; else sec+=L;
  }

  const hull=p=>{ let k=0; for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
      if(X===0||X===GW-1||Y===0||Y===GH-1) k++; return k; };
  let cells=0, exp=0;
  for(const p of P_){ if(p.grp==="shield"||!fitted(p)) continue; cells+=p.w*p.h; exp+=hull(p); }
  const exposure = cells? exp/cells : 0;

  const g=occupied(null);
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
  /* Metres, measured - not a clamped multiplier on an injection rate that no
     longer exists. Elevation is LIVE for this tank now, like every other
     node's: it enters the solve as the static head of the tank's own column
     (pipenet.js), so moving it on the bench changes what it delivers without
     re-commissioning anything. */
  const hp=id("hpi");
  const hpiZ = hp ? (cc.y-cen(hp).y)*MPC : 0;

  const mass = (pipe+sec+dead)*1.6 + P_.filter(p=>p.grp==="shield").length*30;
  layMass = mass;
  /* natK is gone. Buoyancy is an edge head in the pipe network now
     (pipenet.js), so the thermosiphon is solved off exactly the geometry
     `head` measures instead of being predicted from it by a second formula
     standing beside the solve - and unlike a correlation, the solve can tell
     one steam generator from another, and can tell a shut valve from an open
     one. `head` stays: it is what the bench shows, and it is now what
     actually drives the thing it is named after. */
  return {pipe,sec,dead,head,exposure,access,dose,sep,mass,pzrOK,pzrK,hpiZ,radK,peak,
    flowK: 1/(1+0.006*pipe),
    inertiaK: 1+0.012*(pipe+sec)};
}
// The arrangement half of designSig(): id + grid position of every part on
// the board, live parts only (no D fields, no lattice). rad.js's kernel
// cache keys on exactly this - a shield sliding one cell invalidates it, a
// bench slider that leaves every part where it stood does not.
const laySig = () => LAY.parts.map(p=>p.id+":"+p.x+","+p.y).join(";");

// latSig() joins the key because most of what a lattice pen changes (a
// reflector face, a cluster slot, active length) is NOT a D field - without
// it a commissioned plant could go quietly out of date with the bench
function designSig(){ return JSON.stringify(D)+"|"+latSig()+"|"
  +LAY.parts.map(p=>p.id+":"+p.x+","+p.y).join(";"); }
