"use strict";
/* component grid, pipe routing, spatial derivations */

/* ═══════════════ PLANT LAYOUT ═══════════════ */
const GW=16, GH=9, CELL=46, GX=12, MPC=1.4;   // metres per cell
let GY=100;                                   // grid top, set each frame by the layout section
let LAY=null, layLoops=-1, sel="core", layMass=0;

function buildLayout(){
  const A=[], add=(id,name,w,h,x,y,col,grp,tip)=>A.push({id,name,w,h,x,y,col,grp,tip});
  add("core","REACTOR",2,3,2,4,"#ff5a45","core",
    "The vessel and the fuel inside it. Select it to choose the coolant family, the fuel, the lattice and the core shape.");
  add("rods","ROD DRIVES",2,1,2,3,"#c8d8dc","core",
    "Control rod drive mechanisms, mounted on the vessel head. Select for scram gear, bank worth and emergency poison.");
  add("pzr","PRESSURIZER",1,2,5,2,"#a98cf0","primary",
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
  for(let i=0;i<3;i++) add("shld"+i,"SHIELD",1,1,4,4+i,"#6d8f98","shield",
    "A block of shielding. Put it between the reactor and the control room to cut crew dose. It has mass and it blocks access.");
  LAY={parts:A}; layLoops=D.loops;
}
const PXc=g=>GX+g*CELL, PYc=g=>GY+g*CELL;
function port(p,side){
  const x=PXc(p.x), y=PYc(p.y), w=p.w*CELL, h=p.h*CELL;
  return side==="l"?[x,y+h/2] : side==="r"?[x+w,y+h/2]
       : side==="t"?[x+w/2,y] : side==="b"?[x+w/2,y+h] : [x+w/2,y+h/2];
}
const elbow=(a,b,m)=> m==="hv" ? [a,[b[0],a[1]],b] : [a,[a[0],b[1]],b];
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
    const h=elbow(port(core,"r"),port(sg,"l"),"hv");
    net.push({k:"hot",pts:h}); if(i===0) hot0=h;
    if(pu){
      net.push({k:"cold",pts:elbow(port(sg,"b"),port(pu,"t"),"vh")});
      net.push({k:"cold",pts:elbow(port(pu,"b"),port(core,"b"),"vh")});
    } else net.push({k:"cold",pts:elbow(port(sg,"b"),port(core,"b"),"vh")});
    if(tb) net.push({k:"steam",pts:elbow(port(sg,"t"),port(tb,"t"),"vh")});
    if(fp) net.push({k:"feed",pts:elbow(port(fp,"b"),port(sg,"b"),"vh")});
  }
  if(pzr&&hot0){                                   // surge line down onto the hot leg
    const a=port(pzr,"b"), yh=hot0[1][1];
    net.push({k:"surge",pts:[a,[a[0],yh]]});
  }
  if(tb&&cd) net.push({k:"exh",pts:elbow(port(tb,"b"),port(cd,"t"),"vh")});
  if(cd&&fp) net.push({k:"feed",pts:elbow(port(cd,"r"),port(fp,"t"),"hv")});
  if(hp&&fitted(hp)) net.push({k:"hpi",pts:elbow(port(hp,"b"),port(core,"b"),"vh")});
  return net;
}
const fitted=p => p.id==="hpi" ? D.accum : p.id==="bkp" ? D.bkp>0 : true;
const cen=p=>({x:p.x+p.w/2,y:p.y+p.h/2});
function occupied(skip){
  const g=Array.from({length:GH},()=>new Array(GW).fill(null));
  for(const p of LAY.parts){ if(p===skip) continue;
    for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
      if(X>=0&&X<GW&&Y>=0&&Y<GH) g[Y][X]=p; }
  return g;
}
function fits(p,nx,ny){
  if(nx<0||ny<0||nx+p.w>GW||ny+p.h>GH) return false;
  const g=occupied(p);
  for(let X=nx;X<nx+p.w;X++) for(let Y=ny;Y<ny+p.h;Y++) if(g[Y][X]) return false;
  return true;
}
function layoutMetrics(){
  if(!LAY||layLoops!==D.loops) buildLayout();
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
