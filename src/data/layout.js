"use strict";

// CELL is a RENDERING size, not a physical one - pipe runs are measured in
// pixels and divided by CELL to get metres (plen()), and MPC is the only
// thing that says how big a cell really is. Audited by doubling CELL and
// running audit-physics.js, which passed unchanged.
const GW=16, GH=9, CELL=46, GX=12, MPC=1.4;   // metres per cell
let GY=100;                                   // grid top, set each frame by the layout section
let LAY=null, layLoops=-1, layFit="", sel="core", layMass=0;
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
];
const fitOf=id=>fittableList().find(f=>f.id===id).get();
// whether the RELIEF TANK belongs on the grid at all: it is not a
// fittableList() toggle, it is DERIVED from whether any relief fitting still
// taps it (see FIT.relief, pipenet.js) - one tank serves every relief path,
// and deleting the last one removes the tank the same rebuild it removes
// the last fitting, no separate switch to leave stale.
const hasRelief=()=>Object.keys(D.fit).some(id=>D.fit[id].mode==="relief");
// buildLayout() only rebuilds when this changes, so hasRelief() has to be
// folded in - a tee or a throttle never touches LAY.parts and never needed
// to be, but a relief fitting is the first mode whose PRESENCE (not just its
// live position) decides whether a component exists on the grid.
const fitSig=()=>fittableList().map(f=>f.get()?1:0).join("")+(hasRelief()?"1":"0");
// buildLayout() throws LAY.parts away and rebuilds it from nothing on every
// trigger, so a PLACED part lives outside that construction (merged back in
// at the end of buildLayout()) or it would vanish whenever an unrelated
// FITTABLE flag flipped. A placed part that no longer fits is dropped from
// that one rebuild, not deleted - it reappears once the conflict clears.
let placedParts=[], placeSeq=0;
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
const totalPumpCap=()=>{ let c=0;
  for(const p of LAY.parts) if(p.id.startsWith("pump")) c+=pumpCap(pumpSizeOf(p.id));
  return c; };
// loop i's own pumps, undamaged, summed by capacity - what loopFlowK() (step.js)
// reads per loop before any open junction groups loops together
function loopPumpCap(i,dmg){
  let c=0;
  for(const p of LAY.parts){
    if(!p.id.startsWith("pump")) continue;
    const belongsTo = p.id==="pump"+i ? i : p.loop;
    if(belongsTo===i && !dmg.includes(p.id)) c+=pumpCap(pumpSizeOf(p.id));
  }
  return c;
}
// a run's key encodes which physical leg it is (kind:aIdFace-bIdFace); only a
// hot or cold leg belongs to a LOOP the way loopFlowK's connectivity graph
// means it. A junction tapped onto a steam or feed line still exists and
// still draws (pipeNetwork/juncPt don't care what kind they're routing
// between) - it just never resolves to a loop, so it never joins that graph.
function loopOfKey(key){
  if(!key || !(key.startsWith("hot:")||key.startsWith("cold:"))) return null;
  const m=key.match(/(?:sg|pump)(\d+)/);
  return m ? +m[1] : null;
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
function addFit(mode,aKey,aT,bKey,bT,bore=0.55,lift=null,reseat=null){
  const id="f"+(fitSeq++);
  D.fit[id]={aKey,aT,bKey,bT,bore,mode};
  // A relief valve's setpoints are mechanical - chosen when it is built, not
  // worked during a transient - so they live in D beside the tap and never on
  // S. null means "this plant's default"; reliefSet() (step.js) is the one
  // place that answers what the default is.
  if(mode==="relief"){ D.fit[id].lift=lift; D.fit[id].reseat=reseat; }
  return id;
}
function removeFit(id){ delete D.fit[id]; }
const FIT_MASS=16;                     // a spool piece and a motor-operated valve, per tap
// The tank itself, once - every relief fitting shares it (hasRelief(),
// above), so redundancy costs through FIT_MASS and each fitting's own
// branch pipe (layMass, layoutMetrics()) rather than through a second tank.
const RELIEF_TANK_MASS=18;

function buildLayout(){
  const A=[], add=(id,name,w,h,x,y,col,grp,tip)=>{ const p={id,name,w,h,x,y,col,grp,tip}; A.push(p); return p; };
  add("core","REACTOR",3,3,2,4,"#ff5a45","core",
    "The vessel and the fuel inside it. Select it to choose the coolant family, the fuel, the lattice and the core shape.");
  add("rods","ROD DRIVES",3,1,2,3,"#c8d8dc","core",
    "Control rod drive mechanisms, bolted to the vessel head. They ride on the head and move with the reactor - you site the reactor, not the drives. Select for scram gear, bank worth and emergency poison.")
    .pin={to:"core",dx:0,dy:-1};
  add("pzr","PRESSURIZER",1,2,5,1,"#a98cf0","primary",
    "Sets loop pressure. It has to sit high - the steam bubble must stay at the top of the loop.");
  for(let i=0;i<D.loops;i++){
    add("sg"+i,"STEAM GEN "+(i+1),1,2,8+i*2,1,"#5fd2e2","loop"+i,
      "Raise this ABOVE the reactor and hot water rises into it unaided. That height difference is your blackout survival.");
    add("pump"+i,"RCP "+(i+1),1,1,8+i*2,6,"#57d38c","loop"+i,
      "Coolant pump. Keep it low and reachable - it is the component most likely to need a repair under fire.");
  }
  if(fitOf("turb")) add("turb","TURBINE",3,1,12,4,"#f0a830","sec",
    "Draws the ship's load. Select it to size the steam dump that absorbs a turbine trip.");
  if(fitOf("cond")) add("cond","CONDENSER",3,1,12,7,"#5aa9d6","sec",
    "Rejects waste heat. Bulky, and it wants to be near the hull.");
  add("feed","FEED PUMP",1,1,15,5,"#5aa9d6","sec",
    "Returns water to the steam generator. Lose it and the heat sink boils dry.");
  add("ctrl","CONTROL",2,1,1,8,"#cfc9b8","crew",
    "Where your crew sits. Distance and shielding from the reactor set the dose they take.");
  if(fitOf("cont")) add("cont","CONTAINMENT",2,1,4,8,"#8fa9ae","safety",
    "The barrier between damaged fuel and your crew. Select it for containment type and the core catcher.");
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
    "Emergency injection water, and its one line into the loop. Mount it HIGH: its own column is real head, and it only injects while it is winning against the pressure in the loop.");
  add("bkp","BACKUP PWR",1,1,15,8,"#57d38c","safety",
    "Batteries or diesels keeping the pumps turning through a blackout. Keep it away from the hull.");
  // one tank for every relief fitting (FIT.relief, pipenet.js) - deleting
  // the last one deletes this too (hasRelief(), above). It has mass and it
  // shines once a vent has charged it, so where you put it is a decision
  // like any other part's, not a free vent to nowhere.
  if(hasRelief()) add("reltk","RELIEF TANK",1,1,7,0,"#8a6cd0","safety",
    "Catches what the relief valve vents. It fills as the valve passes flow, and a full tank is a place a repair party would rather not stand.");
  for(let i=0;i<3;i++) add("shld"+i,"SHIELD",1,1,2+i,7,"#6d8f98","shield",
    "A block of shielding. Put it between the reactor and the control room to cut crew dose. It has mass and it blocks access.");
  // placed parts merge in last, checked straight against A (not groupFits(),
  // which reads the global LAY.parts - still the PRE-rebuild layout here)
  for(const p of placedParts){
    let ok = p.x>=0 && p.y>=0 && p.x+p.w<=GW && p.y+p.h<=GH;
    if(ok) for(const q of A) if(p.x<q.x+q.w && p.x+p.w>q.x && p.y<q.y+q.h && p.y+p.h>q.y){ ok=false; break; }
    if(ok) A.push(p);
  }
  LAY={parts:A}; layLoops=D.loops; layFit=fitSig();
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
      if(!reg.cost(t)) pts=t;
    }
  }
  // a nozzle whose run would be buried anyway may slide along its own face:
  // at four loops the turbine, condenser and last pump share column 13, so a
  // pipe entering there has nowhere to be but under the one already passing
  // through - no lane choice helps, the nozzle itself has to move
  if(!pts) pts=build(0,0);
  if(reg.cost(pts)) for(const [da,db] of SLIDES){
    const t=build(da,db);
    if(!reg.cost(t)){ pts=t; break; }
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

/* The ONE relief header pipeNetwork() draws (link("relief",...) below), found
   live. Its key carries the two faces that call picked, so it changes the
   moment the pressurizer or the tank moves - and a fitting that had stored the
   old string then resolved against nothing: no branch routed, reliefG() 0,
   ventK() 0, and the valve vented NOTHING while its glyph, its tank, its mimic
   and its mass all stayed. That is the frozen-pixel bug juncPt() exists to
   prevent, one level up: a fitting must store a tap, never a key that geometry
   is still free to rename. Relief is the only mode that can resolve this way,
   because it is the only one whose far end is a run the design derives rather
   than one the player picked. */
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

// routing happens in two passes because neither can go first: a run cannot
// pick its nozzle until its face knows how many pipes land on it, and a face
// cannot know that until every run has been declared
function pipeNetwork(){
  const id=k=>LAY.parts.find(q=>q.id===k);
  const core=id("core"), pzr=id("pzr"), tb=id("turb"), cd=id("cond"), fp=id("feed"), hp=id("hpi"), rt=id("reltk");
  // a KIND is not an identity: every loop's hot leg is kind "hot" (one animated
  // line), but a waypoint belongs to ONE physical run, so each gets its own
  // stable key from both ends and both faces
  const conn=[], link=(k,a,sa,b,sb)=>conn.push({k,a,sa,b,sb,key:k+":"+a.id+sa+"-"+b.id+sb});
  for(let i=0;i<D.loops;i++){
    const sg=id("sg"+i), pu=id("pump"+i);
    if(!sg) continue;
    link("hot",core,"r",sg,"l");
    if(pu){ link("cold",sg,"b",pu,"t"); link("cold",pu,"b",core,"b"); }
    else    link("cold",sg,"b",core,"b");
    if(tb) link("steam",sg,"t",tb,"t");
    if(fp) link("feed",fp,face(fp,sg),sg,"b");   // discharge
  }
  // the surge line drops straight onto whatever hot leg passes underneath
  // rather than routing, but it's still declared here and counted with the rest
  if(pzr) conn.push({k:"surge",a:pzr,sa:"b"});
  if(tb&&cd) link("exh",tb,"b",cd,"t");
  if(cd&&fp) link("feed",cd,"r",fp,face(fp,cd));   // suction
  if(hp&&fitted(hp)) link("hpi",hp,"b",core,"b");
  // the relief HEADER: always drawn once a tank exists, whatever fittings
  // tap it - one physical line from the pressurizer down to the tank, the
  // anchor every relief fitting's own branch (FIT.relief, pipenet.js) tees
  // onto. It carries no edge of its own (netBuild() never builds one for
  // kind "relief"): it is the vent's destination, not a path current can
  // take, the same way surge below is a destination with no source.
  if(pzr&&rt) link("relief",pzr,face(pzr,rt),rt,face(rt,pzr));

  const key=(p,s)=>p.id+s, cnt={}, seen={};
  const tally=(p,s)=>{ if(p) cnt[key(p,s)]=(cnt[key(p,s)]||0)+1; };
  for(const c of conn){ tally(c.a,c.sa); tally(c.b,c.sb); }
  const take=(p,s)=>{ const k=key(p,s), i=seen[k]||0; seen[k]=i+1; return [i,cnt[k]]; };

  const reg=laneReg(), net=[];
  let hot0=null;
  for(const c of conn){
    if(c.k==="surge"){                 // surge line drops onto the hot leg
      const [ia,na]=take(c.a,c.sa), a=port(c.a,c.sa,ia,na);
      const surgeKey="surge:"+c.a.id+c.sa;
      if(!hot0) continue;
      let ty=null;                     // nearest hot run passing under the pressurizer
      for(let i=1;i<hot0.length;i++){
        if(Math.abs(hot0[i][1]-hot0[i-1][1])>0.5) continue;
        const lo=Math.min(hot0[i-1][0],hot0[i][0]), hi=Math.max(hot0[i-1][0],hot0[i][0]);
        if(a[0]>=lo-1 && a[0]<=hi+1 && hot0[i][1]>a[1]+3 && (ty===null||hot0[i][1]<ty))
          ty=hot0[i][1];
      }
      if(ty!==null) net.push({k:"surge",key:surgeKey,pts:[a,[a[0],ty]],wp:false,nz:[true,false]});
      else { const t=nearestOn(hot0,a);  /* nothing underneath: reach across to the leg */
        if(t.d>3) net.push({k:"surge",key:surgeKey,pts:dedupe([a,[a[0],t.pt[1]],t.pt]),wp:false,nz:[true,false]}); }
      continue;
    }
    const [ia,na]=take(c.a,c.sa), [ib,nb]=take(c.b,c.sb);
    const r=routeVia(c,{reg,ia,na,ib,nb});
    /* nz: which END of this run lands on a component PORT, so drawPlant()
       knows where a nozzle belongs. Stated, never inferred - the wp flag
       right beside it used to be read off "has no key", which was control
       flow by accident, and this would rot the same way. */
    net.push({k:c.k,key:c.key,pts:r.pts,legs:r.legs,wps:r.wps,wp:true,nz:[true,true]});
    if(c.k==="hot"&&!hot0) hot0=r.pts;
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
    const A=juncPt(net,j.aKey,j.aT), B=juncPt(net,fitBKey(net,j),j.bT);
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
  return net;
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
  if(!LAY||layLoops!==D.loops||layFit!==fitSig()) buildLayout();
  // measure the design, not the view: drawPlant() sets the bands again
  // straight after this returns, and nothing measures between the two
  BANDS=null;
  const P_=LAY.parts, id=k=>P_.find(q=>q.id===k), core=id("core"), cc=cen(core);
  let head=0, n=0;
  for(const p of P_) if(p.id.startsWith("sg")){ head += (cc.y - cen(p).y); n++; }
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
  if(D.loops>1) for(let i=0;i<D.loops;i++) for(let j=i+1;j<D.loops;j++){
    const a=cen(id("sg"+i)), b=cen(id("sg"+j));
    sep=Math.min(sep,Math.abs(a.x-b.x)+Math.abs(a.y-b.y));
  }
  // the steam bubble has to sit at the top of the loop, and the accumulator drains downhill
  const pz=id("pzr");
  let loopTop=core.y;
  for(const q of P_) if(q.id.startsWith("sg")) loopTop=Math.min(loopTop,q.y);
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
