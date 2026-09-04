"use strict";
/* A panel per machine, anchored in plant space beside the box it describes.
   One mechanism for both screens; a second reader of readoutsFor()/ctlFor(),
   never a second table. */

const MARGIN_W=268, MARGIN_GAP=6, MARGIN_PAD=30;
/* A PANEL TOO TALL TO READ GETS MORE COLUMNS RATHER THAN A SECOND SCREEN OF
   HEIGHT - so its own MEASURED HEIGHT decides how many, and nothing here names
   a role. It was the BLOCK COUNT, which is not the same question: every tank
   has 16 blocks and stands 882px, which fits in one, and all four went two-wide
   beside a reactor that has 24 and stands 2870 and wants three. */
const MARGIN_COL_GAP=8, MARGIN_TALL=1200, MARGIN_COLS_MAX=3;
const marginColW=n=>MARGIN_W*n+MARGIN_COL_GAP*(n-1);
/* AND PANELS ALONG ONE EDGE STAND IN GROUPS. The cascade sorted on board
   position alone, so the primary's own panels were broken up by a loop and by
   the secondary - measured on the stock plant, the top edge ran circ0, loop0,
   circ1, circ0, circ0, loop0... The group is a SORT KEY here, not a move: a
   panel still goes to the edge its own machine is nearest, because a short
   leader is what makes the association readable at all, and the group only
   decides the order along that edge and where the wider gaps fall. */
const MARGIN_GRP_GAP=26;
// false puts the rail's own column of machine panels back
const MARGIN_ONLY=true;
// what the plant view gives up so there is deck to stand a panel on
const MARGIN_IN={l:MARGIN_W+MARGIN_PAD, r:MARGIN_W+MARGIN_PAD, t:92, b:92};

// getBoundingClientRect() flushes layout, so it is read once a frame and never
// inside the placement loop, which writes styles
let marginRc=null, marginRcAt=-1;
function marginCv(){
  if(marginRcAt!==marginFrame){ marginRc=cv.getBoundingClientRect(); marginRcAt=marginFrame; }
  return marginRc;
}
// layout units -> viewport px; the inverse of hostRect(), and the host is fixed
function marginPage(x,y,rc){
  rc=rc||marginCv();
  return {x:rc.left + x*rc.width/W,
          y:rc.top  + (y-TOPBAR_H)*rc.height/Math.max(1,H-TOPBAR_H)};
}
// MARGIN_IN is CSS px because a panel is; the view is layout units
function marginInsetU(){
  const rc=marginCv();
  const sx=W/Math.max(1,rc.width), sy=(H-TOPBAR_H)/Math.max(1,rc.height);
  return {l:MARGIN_IN.l*sx, r:MARGIN_IN.r*sx, t:MARGIN_IN.t*sy, b:MARGIN_IN.b*sy};
}

function marginHost(root){
  const el=KIT.el("div","margin-host");
  // the panels cover #cv, so the canvas never sees a wheel that starts on one
  el.addEventListener("wheel",e=>{
    e.preventDefault();
    ctxClose();
    vWheel(local(e), e.deltaY);
  },{passive:false});
  root.appendChild(el);
  return el;
}

/* One handle shape for every panel. `rect` answers the LAYOUT-space box the
   panel is anchored beside - a machine's own box, a run's cells, a painted
   cell - so marginPlace() never asks what kind of thing it is placing. */
function marginPan(host,title,rect,p){
  const well=KIT.well({title});
  well.el.classList.add("margin-pan");
  // placed at the origin once; every frame after this moves it by transform
  well.el.style.left="0px"; well.el.style.top="0px";
  well.el.style.width=MARGIN_W+"px";
  /* THE RAIL'S OWN BODY CLASS, because dbPanelSync() fills this with the rail's
     own blocks - so the block spacing and the column rules (plant-screens.css)
     are written once and apply wherever a panel stands. It was `margin-body`,
     which nothing styled: the reactor's panel took the two-column WIDTH and
     kept one column of content, and the width alone made it look right. */
  const body=KIT.el("div","db-panel-body"); well.body.appendChild(body);
  host.appendChild(well.el);
  // the router addresses a connector by key, so every panel carries one name -
  // its machine's id, or "run"/"mat" for the two the selection addresses
  return {p,rect,well,body,id:p?p.id:title,on:null,ctl:null,cells:null,nRows:0,
          w:MARGIN_W,cols:1,vis:true,hid:false,tf:null,needH:true,_hpx:null};
}
function marginCols(h,n){
  if(h.cols===n) return;
  h.cols=n; h.w=marginColW(n);
  h.well.el.classList.toggle("cols",n>1);
  h.well.el.style.setProperty("--margin-cols",n);
  h.well.el.style.width=h.w+"px";
  h.needH=true;
}
/* Asked of the height just measured, so the answer is about the panel actually
   standing there. Its SINGLE-column height is what decides, and that is the
   measurement times the columns it is already in - near enough, since columns
   balance. Growing is immediate; shrinking wants a tenth of slack, or a panel
   sitting on a threshold flaps between two counts every frame. A change costs
   one extra measure, and only when it changes. */
function marginColumns(h){
  const est=h._hpx*h.cols;
  const want=Math.max(1,Math.min(MARGIN_COLS_MAX,Math.ceil(est/MARGIN_TALL)));
  if(want===h.cols) return;
  if(want<h.cols && est > MARGIN_TALL*want*0.9) return;
  marginCols(h,want);
  h._hpx=h.well.el.offsetHeight||60; h.needH=false;
}
function marginBuild(host,live){
  host.innerHTML="";
  const out=[];
  for(const p of LAY.parts){
    if(!fitted(p)) continue;
    const h=marginPan(host,partName(p),()=>prect(h.p),p);
    railPick(h.well,[p.id],partName(p));
    out.push(h);
  }
  /* ══ AND A RUN AND A WALL CELL STAND ON THE PLANT TOO ══
     Neither is a part, so neither is in the loop above - and both were only
     reachable down a rail, which is the one place the thing they describe is
     not drawn. One panel each, anchored on the drawing they were picked off,
     shown only while that pick stands. Bench only: a run's bore and a wall's
     thickness are DESIGN, and the control room sets neither. */
  if(!live){
    out.push(marginPanKey(host,"run"));
    out.push(marginPanKey(host,"mat"));
  }
  return out;
}
// the two selection-addressed panels: no part, so the anchor follows `sel`
function marginPanKey(host,key){
  const h=marginPan(host,key==="run"?"PIPE RUN":"WALL",()=>marginKeyRect(h));
  h.key=key; h.id=key; h.selAt=null;
  return h;
}
function marginKeyRect(h){
  const k=h.selKey;
  if(!k) return null;
  if(h.key==="mat"){ const [x,y]=matKeyXY(k);
    return {x:PXc(x), y:PYc(y), w:CELL, h:CELL}; }
  const r=runOfKey(k); if(!r||!r.pts.length) return null;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const q of r.pts){ x0=Math.min(x0,q[0]); x1=Math.max(x1,q[0]);
                         y0=Math.min(y0,q[1]); y1=Math.max(y1,q[1]); }
  return {x:x0, y:y0, w:Math.max(CELL,x1-x0), h:Math.max(CELL,y1-y0)};
}

/* ctlFor() hands back fresh closures every frame, so a handler closes over the
   SLOT and the sync re-points it. `deep` asks a slider whether its range still
   holds - two closure calls per slider, so only when something could have
   moved it. */
function marginCtlMatch(h,rows,deep){
  if(!h.cells || h.nRows!==rows.length) return false;
  let i=0;
  for(const row of rows) for(const c of row){
    const s=h.cells[i++]; if(!s) return false;
    if(s.kind!==(c.kind||"btn")) return false;
    if(deep && c.kind==="sld" && (s.min!==c.min() || s.max!==c.max())) return false;
  }
  return i===h.cells.length;
}
const marginCtlLabel=c=> c.kind==="arm" ? c.label()+"  "+(c.on&&c.on()?"BYP":"AUTO")
                                        : c.text();
function marginCtlBuild(h,rows){
  h.ctl.innerHTML=""; h.cells=[]; h.nRows=rows.length; h.needH=true;
  for(const row of rows){
    const r=KIT.el("div","margin-ctl-row"); h.ctl.appendChild(r);
    for(const c of row){
      const slot={c:c, w:null, kind:c.kind||"btn",
                  min:c.kind==="sld"?c.min():0, max:c.kind==="sld"?c.max():0};
      let w;
      if(c.kind==="sld"){
        w=KIT.slider({min:c.min(), max:c.max(), step:c.step||undefined, fmt:c.fmt,
          mark:c.mark?c.mark():null, val:c.val(), dem:c.dem?c.dem():null, tip:c.tip,
          onChange:v=>{ const k=slot.c;
            if(!k.inert) k.set(k.step?Math.round(v/k.step)*k.step:v); }});
      }else{
        w=KIT.button(marginCtlLabel(c),{sunk:true,size:7,tip:c.tip,
          onClick:()=>{ const k=slot.c; if(!k.inert&&k.fn) k.fn(); }});
      }
      slot.w=w;
      w.el.style.flex=(c.flex||1)+" 1 0";
      r.appendChild(w.el);
      h.cells.push(slot);
    }
  }
}
function marginCtlSync(h,live,deep){
  let rows=ctlFor(h.p,live,live&&S.split);
  // a wrecked machine takes no orders, and the refusal is the sim's - these
  // keys only have to stop LOOKING as though they would be answered
  if(rows&&live&&partWrecked(S,h.p.id)) rows=ctlDead(rows);
  if(rows&&!live) rows=ctlBench(rows);
  if(!rows||!rows.length){ if(h.ctl) KIT.show(h.ctl,false); return; }
  if(!h.ctl){ h.ctl=KIT.el("div","margin-ctl"); h.well.body.appendChild(h.ctl); }
  KIT.show(h.ctl,true);
  if(!marginCtlMatch(h,rows,deep)) marginCtlBuild(h,rows);
  let i=0;
  for(const row of rows) for(const c of row){
    const slot=h.cells[i++]; if(!slot) break;
    slot.c=c;
    if(c.kind==="sld") slot.w.set(c.val(), c.dem?c.dem():null);
    else{
      slot.w.set({label:marginCtlLabel(c), on:!!(c.on&&c.on()), disabled:!!c.inert});
      slot.w.el.classList.toggle("kit-btn-danger", !!(c.danger&&c.danger()));
    }
  }
}

// the plant edge the machine is nearest
function marginSide(r,box){
  const cx=r.x+r.w/2, cy=r.y+r.h/2;
  let best="l", bd=cx-box.x;
  const bid=(d,s)=>{ if(d<bd){ bd=d; best=s; } };
  bid(box.x+box.w-cx,"r"); bid(cy-box.y,"t"); bid(box.y+box.h-cy,"b");
  return best;
}
/* scales with the plant, continuously. A stepped k drifts against the drawing:
   the footprint it reserves moves in steps while VIEW.s moves smoothly, and the
   panel walks a few px per step. `zoom` re-lays out crisply at any value, so
   there is nothing left for the steps to buy. */
const marginZoomK=()=>VIEW.s/Math.max(1e-6,VIEW.fit);
const marginUPerPx=()=>(W/Math.max(1,marginCv().width))/Math.max(1e-6,VIEW.s);

/* Read pass then write pass: a box measured after a style write forces a fresh
   layout, and there is one panel per machine. The write is a transform only -
   left/top would re-lay-out the page for a move the compositor can do. */
function marginPlace(panels,host){
  if(VIEW.w<60||VIEW.h<60) return;
  const k=marginZoomK(), u=marginUPerPx()*k, rc=marginCv();
  /* clipped to the CANVAS BOX, not just below the topbar: a panel is part of
     the drawing, so it may not paint on the letterbox #stage leaves around a
     canvas that does not fill the window. */
  const vpw=(typeof innerWidth==="number"?innerWidth:rc.right);
  const vph=(typeof innerHeight==="number"?innerHeight:rc.bottom);
  const clip="inset("+Math.max(0,Math.round(rc.top))+"px "
                     +Math.max(0,Math.round(vpw-rc.right))+"px "
                     +Math.max(0,Math.round(vph-rc.bottom))+"px "
                     +Math.max(0,Math.round(rc.left))+"px)";
  if(host && host._clip!==clip){ host.style.clipPath=clip; host._clip=clip; }
  // u is grid units per CSS px OF THE DRAWN PANEL, so a slot reserves what the
  // panel actually covers and two cannot land on each other at any zoom
  const padU=MARGIN_PAD*u, gapU=MARGIN_GAP*u, grpU=MARGIN_GRP_GAP*u;
  const B={x:VIEW.cx, y:VIEW.cy, w:VIEW.cw, h:VIEW.ch};
  const side={l:[],r:[],t:[],b:[]};
  /* A PANEL IS SCALED, NOT ZOOMED. `zoom` re-lays the panel out at each step,
     and a re-layout at a new font size is not proportional: line breaks move
     and rounding differs, so the panel's own HEIGHT walked as the plant was
     zoomed and the thing the reader was looking at slid. A transform scales the
     one layout the panel already has, so its height in layout px is a constant
     and its picture is the same picture at every step - see hostScale()
     (render/plant.js), which is what keeps the hosted canvases in step. */
  for(const h of panels){
    h._mr=h.rect&&h.rect();
    if(!h._mr) continue;
    // LAYOUT height, transform-free, so it is measured once per content change
    if(h.needH || h._hpx==null){
      h._hpx=h.well.el.offsetHeight||60;
      h.needH=false;
      marginColumns(h);
    }
    h._hU=h._hpx*u;
    h._grp = h.p ? panelGroup(h.p) : "support";
    h._rank = panelGroupRank(h._grp);
    h._side=marginSide(h._mr,B);
    side[h._side].push(h);
  }
  for(const sd of ["l","r","t","b"]){
    const list=side[sd], flat=(sd==="t"||sd==="b");
    // GROUP FIRST, then board order inside the group - see MARGIN_GRP_GAP
    list.sort((a,b)=> (a._rank-b._rank) ||
      (flat ? a._mr.x-b._mr.x : a._mr.y-b._mr.y));
    let run=-Infinity, was=null;          // the cascade that stops two overlapping
    for(const h of list){
      const wU=h.w*u, sep = (was!==null && h._grp!==was) ? grpU : gapU;
      was=h._grp;
      let ax,ay;
      if(flat){
        ax=Math.max(run+sep-gapU, h._mr.x+h._mr.w/2-wU/2); run=ax+wU+gapU;
        ay=(sd==="t") ? B.y-padU-h._hU : B.y+B.h+padU;
      }else{
        ay=Math.max(run+sep-gapU, h._mr.y+h._mr.h/2-h._hU/2); run=ay+h._hU+gapU;
        ax=(sd==="l") ? B.x-padU-wU : B.x+B.w+padU;
      }
      h._pan={x:ax,y:ay,w:wU,h:h._hU};
      const s=vScr({x:ax,y:ay}), g=marginPage(s.x,s.y,rc);
      // NOT rounded: a quantised place pops the panel a pixel each way as k moves
      const x=g.x, y=g.y, eh=h._hpx*k;
      h.vis = x<vpw && y<vph && x+h.w*k>0 && y+eh>rc.top;
      if(h.hid!==!h.vis){ h.well.el.style.visibility=h.vis?"":"hidden"; h.hid=!h.vis; }
      /* A HIDDEN PANEL IS STILL MOVED, or it pops from a stale place the frame
         it comes back. Only the content sync is skipped (marginSync); a
         transform is a string compare and one write. */
      const tf="translate3d("+x.toFixed(3)+"px,"+y.toFixed(3)+"px,0) scale("+k.toFixed(4)+")";
      if(h.tf!==tf){ h.well.el.style.transform=tf; h.tf=tf; }
    }
  }
  marginLeaders(panels);
}

/* ══ AND A LINE SAYS WHICH MACHINE THE PANEL IS FOR ══
   The PATH is the router's (ROUTE.routeGraph, render/route.js); the INK is the
   rail leader's own (leaderStroke, render/plant.js), so the two leaders on this
   board are dashed, capped and coloured alike. Amber for the picked machine,
   rail grey for the rest, so the selection is answered on the drawing as well
   as on the panel's title bar. */
/* ITS INK IS A PLANT QUANTITY, like a pipe's. Both ends are in plant space, so
   pinned to a CSS pixel the line stayed the same weight while everything it
   joins shrank - over a plant three cells wide it read as a rope. One plant
   unit, against pipeWidth()'s own 2.2 floor, so it never reads as plumbing. */
const MARGIN_LEAD_W=1;
/* ══ THE WHOLE SET IS ROUTED AT ONCE, BY THE BUS ROUTER, NOT BY A RULE HERE ══
   The halfway elbow this used to draw knew about two boxes and nothing else, so
   a leader ran straight through whatever machines stood between its own two
   ends - and twenty of them crossed each other. ROUTE.busRouteGraph (render/
   route.js) carves shared CORRIDORS through the free deck, and every leader
   then approaches the nearest one, rides it, turns ninety degrees at a junction
   onto the next, and exits onto its panel - reserving a lane centre-out. Twenty
   leaders fanning out to the margin is exactly the case corridors are for: they
   gang into a few trunks instead of taking twenty separate paths.

   AND `routeGraph` IS ITS FALLBACK, which is how `oc` wires the pair. The bus
   router may legitimately leave a line unplaced - no corridor reaches an
   endpoint, or every lane is full - and a per-line A* pass then places just
   those. deCollide runs ONLY on that path: a bus line already holds a lane it
   reserved, so a shift could only move it off one, but a fallback line is
   routed blind to those lanes and can land on top.

   Every machine AND every panel is an obstacle, so a leader also refuses to
   cross a panel it does not belong to.

   ROUTED ONCE PER GEOMETRY, NOT PER FRAME. A panel's box in PLANT units is
   invariant under pan and zoom - marginUPerPx() cancels VIEW.s out, which is
   the same fact that makes a panel scale with the drawing - so the only things
   that move these boxes are a design edit and a panel's own content height.
   That is the signature. */
// bus knobs, in PLANT units - `oc`'s own defaults are pixels on a node canvas
// and a grid cell here is 16, so a 280-unit minimum trunk would carve nothing
const MARGIN_BUS_C={margin:6, laneGap:5, minLen:60, hopCost:2000,
                    facePad:4, minSep:4, tightGap:4, trunkCap:4};
const MARGIN_ROUTE_C={clearance:10, bendCost:40, laneGap:5, nodeHalo:8, haloCost:60};
let marginRt=null, marginRtSig=null, marginRtSides=null;
function marginRoutes(panels){
  const P=panels.filter(h=>h._pan&&h._mr);
  // designSig() carries the ports (and everything else drawn), the boxes carry
  // the panels - between them nothing an obstacle is made of can move unseen
  const sig=designSig()+"#"+P.map(h=>{ const m=h._mr, q=h._pan;
    return h.id+":"+m.x+","+m.y+","+m.w+","+m.h+"|"+
      q.x.toFixed(1)+","+q.y.toFixed(1)+","+q.w.toFixed(1)+","+q.h.toFixed(1); }).join(";");
  if(sig===marginRtSig) return marginRt;
  marginRtSig=sig;
  const nodes=[], edges=[], walls=[];
  for(const h of P){
    const m=h._mr, q=h._pan;
    nodes.push({id:"m/"+h.id, x:m.x, y:m.y, w:m.w, h:m.h});
    nodes.push({id:"p/"+h.id, x:q.x, y:q.y, w:q.w, h:q.h});
    walls.push({x:m.x,y:m.y,w:m.w,h:m.h},{x:q.x,y:q.y,w:q.w,h:q.h});
    edges.push({from:"m/"+h.id, to:"p/"+h.id, key:h.id});
  }
  /* A PORT IS AN OBSTACLE, and it is one for BOTH routers. It is a real cell of
     the drawing - a nozzle stands in it and a pipe leaves by it - so a leader
     crossing one reads as plumbing. Added as an ordinary node rather than
     through busRouteGraph's blockRects: the fallback A* takes its hard
     obstacles off the node list alone, so a port in blockRects would be dodged
     by the bus and driven straight through by whatever fell back. Never an
     endpoint, so no walk is ever exempted from it. */
  for(const pid in D.ports){
    const c=portCell(pid); if(!c) continue;
    const r=grect(c[0],c[1],1,1);
    nodes.push({id:"port/"+pid, x:r.x, y:r.y, w:r.w, h:r.h});
    walls.push({x:r.x,y:r.y,w:r.w,h:r.h});
  }
  // prevSides keeps a fallback connector on last pass's faces unless another is
  // genuinely cheaper, so an edit cannot flip every route it has to place
  const sides=new Map();
  marginRt=ROUTE.busRouteGraph(nodes,edges,{
    bus:MARGIN_BUS_C,
    fallback:miss=>ROUTE.routeGraph(nodes,[],miss,
      {config:MARGIN_ROUTE_C, prevSides:marginRtSides}),
    deconflict:r=>ROUTE.deCollide(r,walls,{laneGap:MARGIN_BUS_C.laneGap,containers:[]})});
  for(const [k,r] of marginRt) sides.set(k,{d1:r.d1,d2:r.d2});
  marginRtSides=sides;
  return marginRt;
}
/* EVERY PLACED PANEL GETS ITS LINE, EVERY FRAME - CLIPPED, NEVER CULLED.
   Two gates have been tried here and both were wrong for the same reason: a
   visibility test makes the leader a function of the ZOOM, so lines blinked in
   and out as the view moved and the picture read as broken rather than as
   panned. First the panel had to be on screen (it is anchored on the edge of
   the WHOLE plant, so zooming in throws it off - measured at 2.1x the reactor's
   panel sits at x -2894, and the line died while the machine it names was still
   on the board); then either end had to be near the view, which merely moved
   the flicker to a different zoom. The clip is the only thing that decides what
   lands: a leader with nothing on screen paints nothing and costs one path.
   The only test left is whether the panel has been PLACED at all - a run or
   wall panel with no pick has no box to leave from. */
function marginLeaders(panels){
  if(typeof ctx==="undefined"||!ctx||VIEW.w<2||VIEW.h<2) return;
  const rt=marginRoutes(panels);
  ctx.save();
  ctx.beginPath(); ctx.rect(VIEW.x,VIEW.y,VIEW.w,VIEW.h); ctx.clip();
  for(const h of panels){
    if(!h._pan||!h._mr) continue;
    const r=rt&&rt.get(h.id); if(!r||!r.pts||r.pts.length<2) continue;
    const pts=r.pts.map(q=>vScr({x:q[0],y:q[1]}));
    leaderStroke(pts, h.on?C.amber:C.lead, [pts[0],pts[pts.length-1]],
                 MARGIN_LEAD_W*VIEW.s, LEADER_RAD*VIEW.s);
  }
  ctx.restore();
}

/* The run and wall panels exist only while their own pick stands. `sel` is the
   whole of their state, so the rebuild gate is the key changing - designSig()
   already carries `sel`, which is what `fresh` is taken off. */
function marginKeySync(h,fresh){
  const k = h.key==="run" ? (isRunKey(sel)?sel:null) : (isMatKey(sel)?sel:null);
  h.selKey=k;
  KIT.show(h.well.el, !!k);
  if(!k){ h.vis=false; h.selAt=null; return; }
  if(!fresh && h.selAt===k) return;
  h.selAt=k;
  const title = h.key==="run"
    ? (pipeLabel(pipeMap().byKey[k].k, k)||"PIPE RUN")
    : matPanelTitle(k);
  h.well.setTitle(title); KIT.tip(h.well.head,title);
  const blocks = h.key==="run" ? paramsForRun(k) : paramsForMat(k);
  dbPanelSync(h.body, blocks); h.needH=true;
  // it is the picked thing by construction, so its bar wears the pick
  if(!h.on){ h.well.el.classList.add("on"); h.on=true; }
}

// once a frame from either screen, after drawPlant() set the view
let MARGIN=null, marginFit=null, marginAt=null, marginFrame=0, marginPSig=null, marginDeep=null;
function marginSync(host,live){
  if(!host||typeof LAY==="undefined"||!LAY) return;
  marginFrame++;
  // the host is in the trigger: one panel set, and a screen each owns one
  if(marginFit!==LAY || marginAt!==host){
    MARGIN=marginBuild(host,live); marginFit=LAY; marginAt=host; marginPSig=null;
  }
  const psig = live ? null : designSig()+"|"+sel;
  const fresh = live || psig!==marginPSig; marginPSig=psig;
  // what could have moved a control's range
  const dtok = live ? (S.split+"|"+(S.dmgParts?S.dmgParts.length:0)) : psig;
  const deepNow = dtok!==marginDeep; marginDeep=dtok;
  for(const h of MARGIN){
    if(h.key){ marginKeySync(h,fresh); continue; }
    const on=h.p.id===sel;
    if(h.on!==on){ h.well.el.classList.toggle("on",on); h.on=on; }
    /* A PAN MAY NOT REBUILD ANYTHING. Gated on being visible, a panel panned
       off and back rebuilt its whole block list and re-measured a panel that
       can be two thousand pixels tall - one forced layout, mid-gesture, which
       is the hitch. The bench's content follows designSig() and nothing else,
       so it is synced on that alone, off screen or not. */
    if(live){
      if(!h.vis && h.tf!==null) continue;
      const nm=partName(h.p); h.well.setTitle(nm); KIT.tip(h.well.head,nm);
      fieldRowsSync(h.body, readoutsFor(h.p,S));
      /* AND A GRAPHICAL ROW IS PAINTED HERE TOO - the panel is opaque, so its
         canvas rows are hostPaint()ed off the map fieldRowsBuild() hands back,
         exactly as the rail does it (crRailSync). */
      const vz=h.body._viz;
      if(vz&&vz.dmg) hostPaint(vz.dmg,dmgViz);
    }else{
      if(!fresh) continue;
      const nm=partName(h.p); h.well.setTitle(nm); KIT.tip(h.well.head,nm);
      dbPanelSync(h.body, paramsFor(partOf(h.p.id)||h.p)); h.needH=true;
    }
    marginCtlSync(h,live,deepNow);
  }
  marginPlace(MARGIN,host);
}
