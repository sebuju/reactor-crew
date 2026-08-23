"use strict";
/* component grid, pipe routing, spatial derivations */

/* ═══════════════ PLANT LAYOUT ═══════════════ */
const GW=16, GH=9, CELL=46, GX=12, MPC=1.4;   // metres per cell
let GY=100;                                   // grid top, set each frame by the layout section
let LAY=null, layLoops=-1, sel="core", layMass=0;

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
  add("turb","TURBINE",3,1,12,4,"#f0a830","sec",
    "Draws the ship's load. Select it to size the steam dump that absorbs a turbine trip.");
  add("cond","CONDENSER",3,1,12,7,"#5aa9d6","sec",
    "Rejects waste heat. Bulky, and it wants to be near the hull.");
  add("feed","FEED PUMP",1,1,15,5,"#5aa9d6","sec",
    "Returns water to the steam generator. Lose it and the heat sink boils dry.");
  add("ctrl","CONTROL",2,1,1,8,"#cfc9b8","crew",
    "Where your crew sits. Distance and shielding from the reactor set the dose they take.");
  add("cont","CONTAINMENT",2,1,4,8,"#8fa9ae","safety",
    "The barrier between damaged fuel and your crew. Select it for containment type and the core catcher.");
  add("hpi","HPI TANK",1,1,0,5,"#5aa9d6","safety",
    "Emergency injection water. Mount it HIGH so it can drain into the loop by gravity with no power.");
  add("bkp","BACKUP PWR",1,1,15,8,"#57d38c","safety",
    "Batteries or diesels keeping the pumps turning through a blackout. Keep it away from the hull.");
  for(let i=0;i<3;i++) add("shld"+i,"SHIELD",1,1,2+i,7,"#6d8f98","shield",
    "A block of shielding. Put it between the reactor and the control room to cut crew dose. It has mass and it blocks access.");
  LAY={parts:A}; layLoops=D.loops;
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
function port(p,side){
  const {x,y,w,h}=prect(p);
  return side==="l"?[x,y+h/2] : side==="r"?[x+w,y+h/2]
       : side==="t"?[x+w/2,y] : side==="b"?[x+w/2,y+h] : [x+w/2,y+h/2];
}
/* Route between two ports so the pipe LEAVES and ARRIVES perpendicular to the
   face it lands on.  A pipe must turn into a component, never slide along it.
   Two ports on the same face get a run that stands off clear of both. */
/* Where to put the bend, when there is a choice: the lane that cuts through the
   fewest components.  A pipe should not run through the middle of a machine on
   its way somewhere else.  `vert` means the bend run itself is vertical. */
function bendAt(lo,hi,c0,c1,vert,skip){
  const g=occupied(null), mid=(lo+hi)/2;
  const n=vert?GW:GH;
  /* rows are not a fixed pitch once the control bands are in, so a pixel y has
     to be looked up rather than divided */
  const k0 = vert ? rowAt(Math.min(c0,c1)) : Math.floor((Math.min(c0,c1)-GX)/CELL);
  const k1 = vert ? rowAt(Math.max(c0,c1)) : Math.floor((Math.max(c0,c1)-GX)/CELL);
  let best=mid, bd=1e9;
  for(let c=0;c<n;c++){
    const m = vert ? GX+(c+0.5)*CELL : rowTop(c)+CELL/2;
    if(m<Math.min(lo,hi)-1 || m>Math.max(lo,hi)+1) continue;
    let hits=0;
    for(let k=Math.max(0,k0);k<=k1;k++){
      const cell = vert ? (g[k]||[])[c] : (g[c]||[])[k];
      if(cell && skip.indexOf(cell)<0) hits++;
    }
    const d=hits*10+Math.abs(m-mid)/CELL;
    if(d<bd){ bd=d; best=m; }
  }
  return best;
}

/* the face of p that points at q - a nozzle should be on the side the pipe comes from,
   otherwise the run crosses the component to reach the far face and looks unconnected */
function face(p,q){
  const a=cen(p), b=cen(q), dx=b.x-a.x, dy=b.y-a.y;
  return Math.abs(dx)>Math.abs(dy) ? (dx>=0?"r":"l") : (dy>=0?"b":"t");
}

function route(p,sa,q,sb){
  const a=port(p,sa), b=port(q,sb);
  const va=sa==="t"||sa==="b", vb=sb==="t"||sb==="b", off=CELL/2;
  if(va&&vb){
    const m = sa===sb ? (sa==="b" ? Math.max(a[1],b[1])+off : Math.min(a[1],b[1])-off)
                      : bendAt(a[1],b[1],a[0],b[0],false,[p,q]);
    return [a,[a[0],m],[b[0],m],b];
  }
  if(!va&&!vb){
    const m = sa===sb ? (sa==="r" ? Math.max(a[0],b[0])+off : Math.min(a[0],b[0])-off)
                      : bendAt(a[0],b[0],a[1],b[1],true,[p,q]);
    return [a,[m,a[1]],[m,b[1]],b];
  }
  return va ? [a,[a[0],b[1]],b]     // out vertically, in horizontally
            : [a,[b[0],a[1]],b];    // out horizontally, in vertically
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

function pipeNetwork(){
  const id=k=>LAY.parts.find(q=>q.id===k), net=[];
  const core=id("core"), pzr=id("pzr"), tb=id("turb"), cd=id("cond"), fp=id("feed"), hp=id("hpi");
  let hot0=null;
  for(let i=0;i<D.loops;i++){
    const sg=id("sg"+i), pu=id("pump"+i);
    if(!sg) continue;
    const h=route(core,"r",sg,"l");
    net.push({k:"hot",pts:h}); if(i===0) hot0=h;
    if(pu){
      net.push({k:"cold",pts:route(sg,"b",pu,"t")});
      net.push({k:"cold",pts:route(pu,"b",core,"b")});
    } else net.push({k:"cold",pts:route(sg,"b",core,"b")});
    if(tb) net.push({k:"steam",pts:route(sg,"t",tb,"t")});
    if(fp) net.push({k:"feed",pts:route(fp,face(fp,sg),sg,"b")});   // discharge
  }
  if(pzr&&hot0){                       // surge line drops onto the hot leg
    const a=port(pzr,"b");
    let ty=null;                         // nearest hot run passing under the pressurizer
    for(let i=1;i<hot0.length;i++){
      if(Math.abs(hot0[i][1]-hot0[i-1][1])>0.5) continue;
      const lo=Math.min(hot0[i-1][0],hot0[i][0]), hi=Math.max(hot0[i-1][0],hot0[i][0]);
      if(a[0]>=lo-1 && a[0]<=hi+1 && hot0[i][1]>a[1]+3 && (ty===null||hot0[i][1]<ty))
        ty=hot0[i][1];
    }
    if(ty!==null) net.push({k:"surge",pts:[a,[a[0],ty]]});
    else { const t=nearestOn(hot0,a);   /* nothing underneath: reach across to the leg */
      if(t.d>3) net.push({k:"surge",pts:[a,[a[0],t.pt[1]],t.pt]}); }
  }
  if(tb&&cd) net.push({k:"exh",pts:route(tb,"b",cd,"t")});
  if(cd&&fp) net.push({k:"feed",pts:route(cd,"r",fp,face(fp,cd))});   // suction
  if(hp&&fitted(hp)) net.push({k:"hpi",pts:route(hp,"b",core,"b")});
  return net;
}
const fitted=p => p.id==="hpi" ? D.accum : p.id==="bkp" ? D.bkp>0 : true;
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
  if(!LAY||layLoops!==D.loops) buildLayout();
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
