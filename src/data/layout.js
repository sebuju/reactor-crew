"use strict";
/* component grid, pipe routing, spatial derivations */

/* ═══════════════ PLANT LAYOUT ═══════════════ */
/* CELL is a RENDERING size, not a physical one: pipe runs are measured in
   pixels and divided by CELL again to get metres (see pipeLen), elevation is
   counted in rows, and MPC is the only thing that says how big a cell really
   is. So the plant can be drawn at any size without moving the physics -
   audited, by doubling it and running audit-physics.js, which passed unchanged.
   Worth knowing, because the plant view fits-and-zooms: the grid no longer has
   to land on the 736-unit content column, so this is free to change. */
const GW=16, GH=9, CELL=46, GX=12, MPC=1.4;   // metres per cell
let GY=100;                                   // grid top, set each frame by the layout section
let LAY=null, layLoops=-1, layFit="", sel="core", layMass=0;
/* ══ PARTS THAT CAN BE ADDED OR REMOVED FROM THE GRID, AT A FIXED SLOT ══
   Everything else on the grid is always there; these are optional - present
   or absent, never a ghost box left standing when unfit. One list says which
   parts they are and how to read/flip whether the grid currently carries each
   one: buildLayout() gates its add() call on it, layoutMetrics() rebuilds
   whenever any of it changes, and the right-click menu (design-bench.js) is
   generated FROM it. A new optional part at a FIXED slot is one entry here.
   A part the player places at a slot of their own choosing - a spare pump, a
   pipe junction - is not: see PLACED PARTS and JUNCTIONS below, which do not
   fit this table's shape at all, because they are not one boolean each. */
const fittableList=()=>[
  {id:"cont", label:"CONTAINMENT",         get:()=>D.contFit, set:v=>{D.contFit=v;}},
  {id:"hpi",  label:"PASSIVE ACCUMULATOR", get:()=>D.accum,   set:v=>{D.accum=v;}},
  {id:"turb", label:"TURBINE",             get:()=>D.turbFit, set:v=>{D.turbFit=v;}},
  {id:"cond", label:"CONDENSER",           get:()=>D.condFit, set:v=>{D.condFit=v;}},
];
const fitOf=id=>fittableList().find(f=>f.id===id).get();
const fitSig=()=>fittableList().map(f=>f.get()?1:0).join("");
/* ══ PLACED PARTS: NOT A SLOT, A POINT THE PLAYER CHOSE ══
   buildLayout() throws LAY.parts away and builds it fresh from nothing every
   time its trigger fires - deliberate for the static, formula-driven parts,
   documented as resetting every dragged position on purpose. A part the
   player PLACED must not share that fate just because some unrelated FITTABLE
   flag flipped in the same session. So it lives here, outside buildLayout()'s
   own construction, and is merged back in at the end of every rebuild - see
   buildLayout() below. A placed part that no longer fits (something else now
   sits on its cell) is silently dropped from THAT rebuild rather than
   overlapping anything; it stays in this array and reappears the moment the
   conflict clears, the same non-fatal handling a walled-in component already
   gets elsewhere. Never touched by anything but placePart()/removePart(). */
let placedParts=[], placeSeq=0;
function placePart(mk){
  const p=mk(placeSeq++); placedParts.push(p); buildLayout(); return p;
}
function removePart(id){
  placedParts=placedParts.filter(p=>p.id!==id); buildLayout();
}
/* A pump's own capacity, from its size (0..1, default .5) - centred the same
   way grossEff() centres the turbine multiplier, so the default pump delivers
   exactly what the one always-fitted pump used to deliver and sizing it up or
   down moves it either way. D.pumpSize is keyed by pump id, static or placed
   alike, so every pump - not just spares - can be sized. */
const pumpSizeOf=id=>D.pumpSize[id]??0.5;
const pumpCap=size=>0.7+0.6*size;
const PUMP_MASS=50;                    // t, at pumpCap()==1 (default size)
/* Every pump currently on the grid, whatever loop it belongs to - the design
   floor (commission(), below) is a plant-wide figure, not a per-loop one, so
   it reads the plant-wide total. A placed pump's own loop is stamped on it at
   creation (placePart()'s caller, design-bench.js); the one static pump per
   loop needs no stamp, because its id already says which loop it is. */
const totalPumpCap=()=>{ let c=0;
  for(const p of LAY.parts) if(p.id.startsWith("pump")) c+=pumpCap(pumpSizeOf(p.id));
  return c; };
/* Loop i's own pumps, undamaged, summed by capacity - what loopFlowK()
   (step.js) reads per loop before any open junction groups loops together. */
function loopPumpCap(i,dmg){
  let c=0;
  for(const p of LAY.parts){
    if(!p.id.startsWith("pump")) continue;
    const belongsTo = p.id==="pump"+i ? i : p.loop;
    if(belongsTo===i && !dmg.includes(p.id)) c+=pumpCap(pumpSizeOf(p.id));
  }
  return c;
}
/* ══ JUNCTIONS: A TAP, NOT A COMPONENT ══
   Confirmed explicitly: no visible box, no grid cell. D.junc is topology only
   - which two loops a junction bridges and the plant-space point on loop A's
   cold leg it taps into - keyed by a generated id. S.juncOpen, same keys, is
   the live valve state, closed by default. Never in LAY.parts: pipeNetwork()
   reads D.junc/P.junc directly and routes a branch for each one that exists,
   the same way it already reads fitOf("hpi") to decide whether to link that
   part in. See routeVia()/route()'s bare-point o.pa for why no new routing
   code was needed for this. */
/* Placed at design time, before S exists - resetPlant() is what seeds
   S.juncOpen, one entry per id in P.junc, the same moment it seeds every
   other live-state array. Nothing here writes to S. */
let juncSeq=0;
function addJunction(loopA,loopB,x,y){
  const id="j"+(juncSeq++);
  D.junc[id]={loopA,loopB,x,y};
  return id;
}
function removeJunction(id){ delete D.junc[id]; }
const JUNC_MASS=16;                    // a spool piece and a motor-operated valve, per tap
/* ══ WHERE THE PLAYER PUT A PLATE, IF THEY MOVED IT ══
   An OFFSET from the packed position, never an absolute point. The margins are
   repacked every frame - open a loop, drag a component, resize the window and
   every plate moves - so an absolute point would strand a moved plate the first
   time anything else changed. An offset survives all of it and still means
   "this far from where the packer would have put it". Keyed by the component
   the plate belongs to; a ganged plate is keyed by the member that carries it. */
const plateOff={};

function buildLayout(){
  const A=[], add=(id,name,w,h,x,y,col,grp,tip)=>{ const p={id,name,w,h,x,y,col,grp,tip}; A.push(p); return p; };
  add("core","REACTOR",3,3,2,4,"#ff5a45","core",
    "The vessel and the fuel inside it. Select it to choose the coolant family, the fuel, the lattice and the core shape.");
  /* the drives are bolted to the vessel head: they are sited by siting the reactor */
  add("rods","ROD DRIVES",3,1,2,3,"#c8d8dc","core",
    "Control rod drive mechanisms, bolted to the vessel head. They ride on the head and move with the reactor - you site the reactor, not the drives. Select for scram gear, bank worth and emergency poison.")
    .pin={to:"core",dx:0,dy:-1};
  add("pzr","PRESSURIZER",1,2,5,1,"#a98cf0","primary",
    "Sets loop pressure. It has to sit high - the steam bubble must stay at the top of the loop.");
  for(let i=0;i<D.loops;i++){
    add("sg"+i,"STEAM GEN "+(i+1),1,3,7+i*2,1,"#5fd2e2","loop"+i,
      "Raise this ABOVE the reactor and hot water rises into it unaided. That height difference is your blackout survival.");
    add("pump"+i,"RCP "+(i+1),1,1,7+i*2,6,"#57d38c","loop"+i,
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
  if(fitOf("hpi")) add("hpi","HPI TANK",1,1,0,5,"#5aa9d6","safety",
    "Emergency injection water. Mount it HIGH so it can drain into the loop by gravity with no power.");
  add("bkp","BACKUP PWR",1,1,15,8,"#57d38c","safety",
    "Batteries or diesels keeping the pumps turning through a blackout. Keep it away from the hull.");
  for(let i=0;i<3;i++) add("shld"+i,"SHIELD",1,1,2+i,7,"#6d8f98","shield",
    "A block of shielding. Put it between the reactor and the control room to cut crew dose. It has mass and it blocks access.");
  /* placed parts merge in last, and only the ones that still fit. groupFits()
     cannot be asked here - it reads the GLOBAL LAY.parts, and LAY still
     points at the layout from BEFORE this rebuild at this point in the
     function - so this checks straight against A, the array actually being
     built. See PLACED PARTS above for why they are not built here at all. */
  for(const p of placedParts){
    let ok = p.x>=0 && p.y>=0 && p.x+p.w<=GW && p.y+p.h<=GH;
    if(ok) for(const q of A) if(p.x<q.x+q.w && p.x+p.w>q.x && p.y<q.y+q.h && p.y+p.h>q.y){ ok=false; break; }
    if(ok) A.push(p);
  }
  LAY={parts:A}; layLoops=D.loops; layFit=fitSig();
}
/* ─────────────── control bands ───────────────
   A control mounted inside a component is only as wide as that component, and a
   2-cell part is 92px. That is not enough for a slider AND two buttons, so the
   control room gives each grid ROW extra height at the bottom, exactly as much as
   the widest strip of any component that ends in that row. Rows with nothing to
   control get nothing. The design bench passes no live state, so BANDS is null
   there and the bench grid is pixel-identical to a plant with no controls at all.

   BANDS is a view property, never a design property: layoutMetrics() clears it
   before it measures, so pipe lengths, thermosiphon head and every coefficient
   that falls out of them are the same numbers on both screens. */
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
/* the pixel rect of a component - its height is not p.h*CELL any more, because
   the rows it spans may carry control bands */
const prect=p=>({x:PXc(p.x), y:rowTop(p.y), w:p.w*CELL, h:rowTop(p.y+p.h)-rowTop(p.y)});
/* A face is not one nozzle. Four loops all leave the reactor on its starboard
   side, and if every one of them leaves from the same point the four hot legs
   are one line with three of them hidden underneath. So a port is a slot on a
   face: `n` pipes land here, this is the `slot`-th of them, spread evenly and
   centred on the face centre. The pitch never exceeds half a cell, because a
   nozzle further out than that reads as belonging to the neighbouring cell.
   With n===1 the offset is zero and the port is exactly the face centre it has
   always been, which is what keeps every single-pipe face pixel-identical. */
function port(p,side,slot=0,n=1,shift=0){
  const {x,y,w,h}=prect(p);
  const len = (side==="t"||side==="b") ? w : h;
  const pitch = Math.min(len/(n+1),CELL/2);
  /* how far this nozzle may slide off its slot before it fouls its neighbour on
     the same face, or runs off the end of the face */
  const room = n>1 ? pitch/2-1 : len/2-6;
  const d = (n>1 ? (slot-(n-1)/2)*pitch : 0) + clamp(shift,-room,room);
  const o = Math.round(Math.abs(d))*Math.sign(d);   // symmetric, so the spread stays balanced
  return side==="l"?[x,y+h/2+o] : side==="r"?[x+w,y+h/2+o]
       : side==="t"?[x+w/2+o,y] : side==="b"?[x+w/2+o,y+h] : [x+w/2,y+h/2];
}
/* a run reduced to the lanes it occupies: axis, the coordinate of the lane, and
   how far along the lane the run actually reaches */
function laneSegs(pts){ const out=[];
  for(let i=1;i<pts.length;i++){ const a=pts[i-1], b=pts[i];
    if(Math.abs(a[0]-b[0])<0.5){ if(Math.abs(a[1]-b[1])>0.5)
        out.push(["v",a[0],Math.min(a[1],b[1]),Math.max(a[1],b[1])]); }
    else out.push(["h",a[1],Math.min(a[0],b[0]),Math.max(a[0],b[0])]); }
  return out; }
/* Where the runs of one network remember the lanes they have taken.  Two runs
   that pick the same lane draw one line and hide the other, and nothing in the
   old router could see that: the standoff rule and bendAt() each chose in total
   ignorance of the rest of the network.  A claim is an interval, not a whole
   lane - two runs that share a lane but never pass each other are not on top of
   each other, and insisting otherwise pushes pipes off the grid for nothing.
   A run is scored and claimed whole, not just at its bend, because the stubs
   that leave and arrive square to a face collide just as readily as the bend.
   The registry lives for one pipeNetwork() call - it is routing scratch, not
   plant state. */
const LANE_STEP=8, LANE_COST=8;
/* the lanes a run would like to try, nearest wish first */
const outboard=d=>{ const a=[]; for(let i=0;i<24;i++) a.push(d*LANE_STEP*i); return a; };
const eitherWay=(()=>{ const a=[0];
  for(let i=1;i<=5;i++) a.push(LANE_STEP*i,-LANE_STEP*i); return a; })();
function laneReg(){
  const held=[];
  /* a pipe is 8px of halo wide, so two runs a couple of pixels apart are one fat
     pipe to look at. LANE_STEP is the separation at which they read as two. */
  const clash=s=>held.filter(u=>u[0]===s[0] && Math.abs(u[1]-s[1])<LANE_STEP-0.5 &&
        Math.min(u[3],s[3])-Math.max(u[2],s[2])>1.5).length;
  const cost=pts=>laneSegs(pts).reduce((n,s)=>n+clash(s),0);
  return {
    cost,
    claim(pts){ for(const s of laneSegs(pts)) held.push(s); return pts; },
    /* the first lane that lands the whole run clear.  Wishes are tried in order,
       so the first run to ask keeps the lane it has always had and later ones
       stand off from it rather than through it. */
    pick(mk,v,wish){ for(const d of wish) if(!cost(mk(v+d))) return v+d;
      return v; }
  };
}
/* Route between two ports so the pipe LEAVES and ARRIVES perpendicular to the
   face it lands on.  A pipe must turn into a component, never slide along it.
   Two ports on the same face get a run that stands off clear of both. */
const bendPoly=(a,b,vert)=> vert ? m=>[a,[m,a[1]],[m,b[1]],b]
                                 : m=>[a,[a[0],m],[b[0],m],b];
/* Where to put the bend, when there is a choice: the lane that cuts through the
   fewest components, and among those the one that buries the least other pipe.
   A pipe should not run through the middle of a machine on its way somewhere
   else, and it should not hide another pipe either.  `vert` means the bend run
   itself is vertical. */
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
/* `o` carries what this run cannot know by itself: which slot it has on each of
   its two faces, and the lane registry shared with every other run in the same
   network. Left out, the run routes exactly as it always did.
   `o.pa` / `o.pb` replace that end's PORT with a bare point - a waypoint has no
   component behind it, no face to leave square to and no nozzle to share - and
   `o.va` / `o.vb` say which way the leg leaves or arrives there, because a
   point has no face to read it off. See routeVia(), the only caller. */
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
  /* A nozzle whose run would be buried anyway may slide along its own face. The
     grid puts components on shared centrelines - at four loops the turbine, the
     condenser and the last pump all sit on column 13 - and a pipe entering a
     face on that line has nowhere to be except underneath the pipe already
     passing through it. No lane choice can help; the nozzle has to move, which
     is what a real plant does with it. */
  let pts=build(0,0);
  if(reg.cost(pts)) for(const [da,db] of SLIDES){
    const t=build(da,db);
    if(!reg.cost(t)){ pts=t; break; }
  }
  return reg.claim(dedupe(pts));
}
/* ══ WHERE THE PLAYER STEERED A PIPE ══
   A point the run has to pass through, keyed by the run and stored as an
   ABSOLUTE plant point - unlike plateOff, which is a delta. A plate has one
   anchor to be an offset FROM; a pipe run has none, because both its ends and
   everything between them are recomputed from nothing every frame. What a
   waypoint means is "go through this spot in the room", so that is what is
   written down. Nothing sweeps this: a run whose kind stops existing leaves its
   entry behind exactly as plateOff keeps a plate that is no longer drawn. */
const pipeWaypoints={};
/* Sorted on every read, by distance from the run's own start, so dragging one
   point past another re-orders the run instead of tangling it - and so nothing
   anywhere has to keep an order in step with the drawing. The objects are the
   stored ones, not copies: a grip holds the object it moves, which is what
   keeps a sort from renumbering what the hand is holding. */
function pipeWayList(key,a0){
  const w=pipeWaypoints[key];
  if(!w||!w.length) return [];
  return w.slice().sort((p,q)=>Math.hypot(p.x-a0[0],p.y-a0[1])-Math.hypot(q.x-a0[0],q.y-a0[1]));
}
/* ══ A WAYPOINT STEERS THE ROUTER, IT DOES NOT REPLACE IT ══
   A run with n waypoints is n+1 calls to route() and not one call to something
   cleverer: hand-rolled pipe pathfinding is the thing this whole feature exists
   to avoid. Every leg leaves on the same axis as the first one - the run's own
   start face decides it - and arrives at its waypoint on the other, so the two
   legs meeting at a waypoint always turn a corner there. Let each leg pick its
   own axis and a pair of them doubles back along one lane, which is one pipe
   drawn twice and audit-geometry.js reports it as the overlap it is.
   A waypoint the player drops PAST the far end still makes the run go out and
   come home, and it comes home on the lane it went out on. That is what any
   two-point router does with such an order, and it is the player's diagram to
   make ugly - the same allowance the overlap audit already makes for a
   component dragged into a corner. */
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
/* nearest point on a polyline - where a branch line tees onto a run */
function nearestOn(pts,p){
  let best=pts[0], bd=1e9;
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1], b=pts[i];
    const dx=b[0]-a[0], dy=b[1]-a[1], L=dx*dx+dy*dy;
    const t = L? clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L,0,1) : 0;
    const q=[a[0]+dx*t, a[1]+dy*t];
    const d=Math.hypot(q[0]-p[0],q[1]-p[1]);
    if(d<bd){ bd=d; best=q; }
  }
  return {pt:best,d:bd};
}
function plen(pts){ let L=0;
  for(let i=1;i<pts.length;i++) L+=Math.abs(pts[i][0]-pts[i-1][0])+Math.abs(pts[i][1]-pts[i-1][1]);
  return L/CELL*MPC; }

/* Routing happens twice over, because neither half can be done first. A run
   cannot pick its nozzle until the face knows how many pipes land on it, and a
   face cannot know that until every run has been declared. So pass one is pure
   data - who joins what, on which face - pass two counts the faces and hands
   each run its slot, and only then is anything routed. The declaration order is
   the network order, which is also the draw order, so it has not changed. */
function pipeNetwork(){
  const id=k=>LAY.parts.find(q=>q.id===k);
  const core=id("core"), pzr=id("pzr"), tb=id("turb"), cd=id("cond"), fp=id("feed"), hp=id("hpi");
  /* A KIND IS NOT AN IDENTITY. Every loop's hot leg is the kind "hot", because
     they are physically the same line and animate as one - but a waypoint
     belongs to ONE physical run, so a run needs a name of its own. Both ends
     and both faces make one, and it is stable across a frame, a rebuild and a
     loop being added: nothing about it is an index into anything. */
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
  /* the surge line is not a route() - it drops straight down onto whatever hot
     leg passes underneath - but it is still a pipe on the pressurizer's bottom
     face, so it is declared here and counted with the rest */
  if(pzr) conn.push({k:"surge",a:pzr,sa:"b"});
  if(tb&&cd) link("exh",tb,"b",cd,"t");
  if(cd&&fp) link("feed",cd,"r",fp,face(fp,cd));   // suction
  if(hp&&fitted(hp)) link("hpi",hp,"b",core,"b");

  const key=(p,s)=>p.id+s, cnt={}, seen={};
  const tally=(p,s)=>{ if(p) cnt[key(p,s)]=(cnt[key(p,s)]||0)+1; };
  for(const c of conn){ tally(c.a,c.sa); tally(c.b,c.sb); }
  const take=(p,s)=>{ const k=key(p,s), i=seen[k]||0; seen[k]=i+1; return [i,cnt[k]]; };

  const reg=laneReg(), net=[];
  let hot0=null;
  for(const c of conn){
    if(c.k==="surge"){                 // surge line drops onto the hot leg
      const [ia,na]=take(c.a,c.sa), a=port(c.a,c.sa,ia,na);
      if(!hot0) continue;
      let ty=null;                     // nearest hot run passing under the pressurizer
      for(let i=1;i<hot0.length;i++){
        if(Math.abs(hot0[i][1]-hot0[i-1][1])>0.5) continue;
        const lo=Math.min(hot0[i-1][0],hot0[i][0]), hi=Math.max(hot0[i-1][0],hot0[i][0]);
        if(a[0]>=lo-1 && a[0]<=hi+1 && hot0[i][1]>a[1]+3 && (ty===null||hot0[i][1]<ty))
          ty=hot0[i][1];
      }
      if(ty!==null) net.push({k:"surge",pts:[a,[a[0],ty]]});
      else { const t=nearestOn(hot0,a);  /* nothing underneath: reach across to the leg */
        if(t.d>3) net.push({k:"surge",pts:dedupe([a,[a[0],t.pt[1]],t.pt])}); }
      continue;
    }
    const [ia,na]=take(c.a,c.sa), [ib,nb]=take(c.b,c.sb);
    const r=routeVia(c,{reg,ia,na,ib,nb});
    net.push({k:c.k,key:c.key,pts:r.pts,legs:r.legs,wps:r.wps});
    if(c.k==="hot"&&!hot0) hot0=r.pts;
  }
  /* junctions - a tap on loop A's cold leg (the stored point, exactly where
     the player clicked) to loop B's pump discharge. The tapped end is a bare
     point (o.pa), not a component+face - the identical route() machinery a
     waypoint leg already uses, not new pathfinding. The kind is "xtie:"+id on
     purpose: pipes.js's existing k.startsWith("xtie") fallbacks (name, colour,
     full scale, unit) already cover any suffix, so a junction needs no table
     row of its own there. Skipped, not crashed, if either loop it names no
     longer exists - the identical defensive shape every other optional link
     in this function already uses.
     NO key, on purpose - unlike every other run, a junction's own branch does
     not carry waypoints of its own in this version: pipeGrips() (plant.js)
     already skips any run with no key, the same way it already skips the
     surge line two blocks up, so this is the existing "nothing to steer here"
     path and not a new one. */
  for(const jid in D.junc){
    const j=D.junc[jid], b=id("pump"+j.loopB);
    if(!id("pump"+j.loopA) || !b) continue;
    const pts=route(null,"",b,"l",{reg,pa:[j.x,j.y],va:false});
    net.push({k:"xtie:"+jid, pts});
  }
  return net;
}
/* BACKUP PWR is the one part left that ghosts rather than vanishes: NONE is a
   real dropdown choice (mass 0) that still occupies its cell, because it is a
   three-way quality dial (NONE/BATTERY/DIESEL) and not an add/remove part -
   see fittableList() above for the parts that are actually removed from LAY.parts
   when unfit, which makes fitted() trivially true for them whenever they are
   present at all. */
const fitted=p => p.id==="bkp" ? D.bkp>0 : true;
const cen=p=>({x:p.x+p.w/2,y:p.y+p.h/2});
/* parts that ride another part rather than being sited on their own */
const pinnedTo=p=>LAY.parts.filter(q=>q.pin&&q.pin.to===p.id);
/* skip is one part or a whole group - a group move lifts parent and pinned
   children off the grid together, or the parent collides with its own child */
function occupied(skip){
  const off = skip ? (Array.isArray(skip)?skip:[skip]) : [];
  const g=Array.from({length:GH},()=>new Array(GW).fill(null));
  for(const p of LAY.parts){ if(off.includes(p)) continue;
    for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
      if(X>=0&&X<GW&&Y>=0&&Y<GH) g[Y][X]=p; }
  return g;
}
/* Can every placement in this list land at once? One part or a pinned group -
   all of it is tested before any of it moves, so a group never half-lands. */
function groupFits(cells){
  const g=occupied(cells.map(c=>c.q));
  for(const {q,x,y} of cells){
    if(x<0||y<0||x+q.w>GW||y+q.h>GH) return false;
    for(let X=x;X<x+q.w;X++) for(let Y=y;Y<y+q.h;Y++) if(g[Y][X]) return false;
  }
  return true;
}
/* The only way a component changes position. A pinned child travels with its
   parent and is never moved on its own, which is what keeps the rod drives on
   the vessel head however the reactor is sited. */
function moveTo(p,nx,ny){
  if(p.pin) return false;
  const cells=[{q:p,x:nx,y:ny}].concat(
    pinnedTo(p).map(q=>({q,x:nx+q.pin.dx,y:ny+q.pin.dy})));
  if(!groupFits(cells)) return false;
  for(const {q,x,y} of cells){ q.x=x; q.y=y; }
  return true;
}
function layoutMetrics(){
  if(!LAY||layLoops!==D.loops||layFit!==fitSig()) buildLayout();
  /* measure the design, not the view: drawPlant() sets the bands again straight
     after this returns, and nothing else measures between the two */
  BANDS=null;
  const P_=LAY.parts, id=k=>P_.find(q=>q.id===k), core=id("core"), cc=cen(core);
  let head=0, n=0;
  for(const p of P_) if(p.id.startsWith("sg")){ head += (cc.y - cen(p).y); n++; }
  head = n? head/n : 0;
  let pipe=0, sec=0;
  for(const r of pipeNetwork()){
    const L=plen(r.pts);
    /* `pipe` is what the pumps have to push through, and a cross-tie is not
       that: it is a parallel branch, not another metre of loop. So it pays mass
       and thermal inertia with the secondary runs and never slows the pumps
       down - fitting one and leaving it shut must not cost flow. */
    if(r.k==="hot"||r.k==="cold"||r.k==="surge"||r.k==="hpi") pipe+=L; else sec+=L;
  }

  const hull=p=>{ let k=0; for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
      if(X===0||X===GW-1||Y===0||Y===GH-1) k++; return k; };
  let cells=0, exp=0;
  for(const p of P_){ if(p.grp==="shield"||!fitted(p)) continue; cells+=p.w*p.h; exp+=hull(p); }
  const exposure = cells? exp/cells : 0;

  const g=occupied(null);
  let reach=0, tot=0;
  for(const p of P_){ if(p.grp==="shield"||!fitted(p)) continue; tot++;
    let ok=false;
    for(let X=p.x-1;X<=p.x+p.w;X++) for(let Y=p.y-1;Y<=p.y+p.h;Y++){
      if(X<0||Y<0||X>=GW||Y>=GH) continue;
      const inside = X>=p.x&&X<p.x+p.w&&Y>=p.y&&Y<p.y+p.h;
      const edge = (X<p.x||X>=p.x+p.w)!==(Y<p.y||Y>=p.y+p.h);
      if(!inside && edge && !g[Y][X]) ok=true;
    }
    p.access=ok; if(ok) reach++;
  }
  const access = tot? reach/tot : 0;

  const ct=id("ctrl"), ctc=ct?cen(ct):cc;
  const dist=Math.abs(ctc.x-cc.x)+Math.abs(ctc.y-cc.y);
  let shields=0;
  for(const p of P_) if(p.grp==="shield"){
    const c=cen(p);
    if(c.x>=Math.min(ctc.x,cc.x)-1 && c.x<=Math.max(ctc.x,cc.x)+1 &&
       c.y>=Math.min(ctc.y,cc.y)-1 && c.y<=Math.max(ctc.y,cc.y)+1) shields++;
  }
  const dose = clamp(2.4/Math.max(dist,1)*Math.pow(0.45,shields),0.02,3);

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
  const hp=id("hpi");
  const hpiHead = hp ? clamp((cc.y-cen(hp).y+2)/5,0.35,1.35) : 1;

  const mass = (pipe+sec)*1.6 + P_.filter(p=>p.grp==="shield").length*30;
  layMass = mass;
  return {pipe,sec,head,exposure,access,dose,sep,mass,pzrOK,pzrK,hpiHead,
    natK: 0.35+0.65*clamp((head+1)/4,0,1.6),
    flowK: 1/(1+0.006*pipe),
    inertiaK: 1+0.012*(pipe+sec)};
}
