"use strict";

const MARGIN_W=268, MARGIN_GAP=6, MARGIN_PAD=30;
// zero gap keeps a panel a whole number of cells wide (MARGIN_W is 2*CELL)
const MARGIN_COL_GAP=0, MARGIN_COLS_MAX=4;
// a stated column is a CONTENT width, so the well pad and grid gaps are added here
const MARGIN_WELL_PAD=12, MARGIN_GRID_GAP=8, MARGIN_COLW=260;
const marginColW=(n,cw)=>{
  if(!cw) return n*MARGIN_W+(n-1)*MARGIN_COL_GAP;
  let w=MARGIN_WELL_PAD+(n-1)*MARGIN_GRID_GAP;
  for(let i=0;i<n;i++) w+=cw[i]||MARGIN_COLW;
  return Math.ceil(w/CELL)*CELL;
};
const MARGIN_GRP_GAP=26;
const MARGIN_ONLY=true;
const MARGIN_HIDE=true;
// what the plant view gives up so there is deck to stand a panel on
const MARGIN_IN={l:MARGIN_W+MARGIN_PAD, r:MARGIN_W+MARGIN_PAD, t:92, b:92};

// getBoundingClientRect() flushes layout, so it is read once a frame
let marginRc=null, marginRcAt=-1;
function marginCv(){
  if(marginRcAt!==marginFrame){ marginRc=cv.getBoundingClientRect(); marginRcAt=marginFrame; }
  return marginRc;
}
function marginPage(x,y,rc){
  rc=rc||marginCv();
  return {x:rc.left + x*rc.width/W,
          y:rc.top  + (y-TOPBAR_H)*rc.height/Math.max(1,H-TOPBAR_H)};
}
function marginUnits(x,y,rc){
  rc=rc||marginCv();
  return {x:(x-rc.left)*W/Math.max(1,rc.width),
          y:(y-rc.top)*Math.max(1,H-TOPBAR_H)/Math.max(1,rc.height)+TOPBAR_H};
}
// MARGIN_IN is CSS px because a panel is; the view is layout units
function marginInsetU(){
  if(MARGIN_HIDE) return {l:0,r:0,t:0,b:0};
  const rc=marginCv();
  const sx=W/Math.max(1,rc.width), sy=(H-TOPBAR_H)/Math.max(1,rc.height);
  return {l:MARGIN_IN.l*sx, r:MARGIN_IN.r*sx, t:MARGIN_IN.t*sy, b:MARGIN_IN.b*sy};
}

function wheelScrolls(el,t){
  for(let n=t; n&&n!==el; n=n.parentElement){
    if(!n.scrollHeight) continue;
    const ov=getComputedStyle(n).overflowY;
    if((ov==="auto"||ov==="scroll") && n.scrollHeight>n.clientHeight+1) return true; }
  return false;
}
// room is the FURTHER of the two edges, or nothing that fits the frame could move
function panRoom(m,el){
  const b=el.getBoundingClientRect(), f=inspFrame(el.parentNode);
  const ax=(d,a,z)=> d>0 ? Math.min(d,Math.max(0,a,z)) : -Math.min(-d,Math.max(0,-a,-z));
  return {x:ax(m.x, f.x0-b.left, f.x1-b.right),
          y:ax(m.y, f.y0-b.top,  f.y1-b.bottom)};
}
function panDeck(m,el){
  const d=panRoom(m,el); if(!d.x&&!d.y) return;
  panTo=panZ=null;                    // a hand outranks an eased pan already in flight
  const k=cvPx()/VIEW.s;
  VIEW.ox-=d.x*k; VIEW.oy-=d.y*k;
  uiDirty();
}
// the canvas never sees a wheel or right drag that started on a panel
function panWheelPass(el,spend,onDown){
  const pay=spend||panDeck;
  const panelAt=t=>(t&&t.closest)?t.closest(".margin-pan"):null;
  // its own state rather than ui.drag: uiMove() belongs to a surface that hit-tests
  let pan=null;
  const drop=()=>{ pan=null; };
  ctxSuppress(el);
  MOUSE.on(el,{
    wheel(e){
      if(wheelScrolls(el,e.target)) return;
      e.preventDefault();
      ctxClose();
      const q=panelAt(e.target);
      // a shifted wheel arrives as deltaX, and it is still the same one roll
      if(q) pay({x:0,y:-(e.deltaY||e.deltaX)},q);
    },
    down(e){
      if(onDown) onDown(e);
      if(e.button!==2 || e.shiftKey) return;
      // grabbing on the host steals the release from a hosted canvas mid-gesture
      if(e.target && e.target._uiHost) return;
      MOUSE.grab(el);
      ctxClose();
      const lp=local(e); pan={x:lp.x,y:lp.y};
    },
    move(e){
      if(!pan) return;
      const lp=local(e);
      panTo=panZ=null;
      VIEW.ox-=(lp.x-pan.x)/VIEW.s; VIEW.oy-=(lp.y-pan.y)/VIEW.s;
      pan.x=lp.x; pan.y=lp.y; uiDirty();
    },
    up:drop, cancel:drop});
  return el;
}

function marginHost(root){
  const el=KIT.el("div","margin-host");
  panWheelPass(el);
  root.appendChild(el);
  return el;
}

function marginPan(host,title,rect,p){
  const well=KIT.well({title});
  well.el.classList.add("margin-pan");
  // placed at the origin once; every frame after this moves it by transform
  well.el.style.left="0px"; well.el.style.top="0px";
  well.el.style.width=MARGIN_W+"px";
  const body=KIT.el("div","db-panel-body db-body-tree"); well.body.appendChild(body);
  host.appendChild(well.el);
  // the router addresses a connector by key, so every panel carries one name
  return {p,rect,well,body,id:p?p.id:title,on:null,ctl:null,cells:null,nRows:0,
          w:MARGIN_W,cols:1,vis:true,hid:false,tf:null,needH:true,_hpx:null};
}
function marginCols(h,n,cw){
  const sig=n+":"+((cw||[]).join(","));
  if(h.colSig===sig) return;
  h.colSig=sig; h.cols=n; h.colw=cw||null; h.w=marginColW(n,cw);
  h.well.el.classList.toggle("cols",n>1);
  // 3+ columns has room to stand a list beside the controls (.margin-ctl)
  h.well.el.classList.toggle("wide",n>=3);
  h.well.el.style.width=h.w+"px";
  h.well.el.style.setProperty("--db-grid-cols",n);
  // shares, not px: a px template would need the well's padding and grid gaps
  h.well.el.style.setProperty("--db-cols-tpl",
    Array.from({length:n},(_,i)=>"minmax(0,"+(cw?(cw[i]||MARGIN_COLW):1)+"fr)").join(" "));
  h.needH=true;
}
function marginColumns(h){
  if(h.fixW) return;
  const want0=h.body&&h.body._cols;
  if(!want0) return;
  const cw=h.body._colw||null;
  marginCols(h,Math.max(1,Math.min(MARGIN_COLS_MAX,want0)),cw);
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
  // bench only: a run's bore and a wall's thickness are DESIGN
  if(!live) out.push(marginPanKey(host,"run"));
  out.push(marginPanKey(host,"mat"));
  // a list of every run names no machine, so there is no leader to draw
  out.push(marginPanBoard(host, live?"cnx":"pipes", "PIPES", "tr"));
  if(live) out.push(marginPanBoard(host,"ports","PORT VALVES","tr"));
  return out;
}
function marginPanBoard(host,key,title,corner){
  const h=marginPan(host,title,()=>null,null);
  h.board=key; h.corner=corner; h.id=key;
  h.well.el.classList.add("margin-board");
  if(key==="pipes"){ h.fixW=marginColW(2); h.w=h.fixW; h.well.el.style.width=h.w+"px"; }
  return h;
}
function marginPanKey(host,key){
  const h=marginPan(host,key==="run"?"PIPE RUN":"WALL",()=>marginKeyRect(h));
  h.key=key; h.id=key; h.selAt=null;
  return h;
}
function matCellsXY(){
  return matCells().map(k=>{ const i=k.indexOf(",");
    return [+k.slice(0,i), +k.slice(i+1)]; });
}
// the leader needs ONE cell to point at, and the ring's top-left is stable
function matAnchorCell(){
  let best=null;
  for(const c of matCellsXY())
    if(!best || c[1]<best[1] || (c[1]===best[1] && c[0]<best[0])) best=c;
  return best;
}
function marginKeyRect(h){
  const k=h.selKey;
  if(h.key==="mat"){
    const c = k ? matKeyXY(k) : matAnchorCell();
    if(!c) return null;                       // nothing painted: no anchor, no seat
    return {x:PXc(c[0]), y:PYc(c[1]), w:CELL, h:CELL}; }
  if(!k) return null;
  const r=runOfKey(k); if(!r||!r.pts.length) return null;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const q of r.pts){ x0=Math.min(x0,q[0]); x1=Math.max(x1,q[0]);
                         y0=Math.min(y0,q[1]); y1=Math.max(y1,q[1]); }
  return {x:x0, y:y0, w:Math.max(CELL,x1-x0), h:Math.max(CELL,y1-y0)};
}

// ctlFor() hands back fresh closures every frame, so a handler closes over the SLOT
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
function marginSldStep(slot,dir){
  const c=slot.c; if(c.inert) return;
  const lo=c.min(), hi=c.max(), st=c.step||(hi-lo)/20;
  const v=Math.max(lo,Math.min(hi,c.val()+dir*st));
  c.set(c.step?Math.round(v/c.step)*c.step:v);
}
function marginCtlBuild(h,rows){
  h.ctl.innerHTML=""; h.cells=[]; h.nRows=rows.length; h.needH=true;
  // two boxes in one flex row, so each stack packs itself at the top
  const main=KIT.el("div","margin-ctl-main"); h.ctl.appendChild(main);
  for(const row of rows){
    const ports = row[0] && row[0].kind==="port";
    const r=KIT.el("div", ports?"margin-ports":"margin-ctl-row");
    (ports?h.ctl:main).appendChild(r);
    for(const c of row){
      const slot={c:c, w:null, kind:c.kind||"btn",
                  min:c.kind==="sld"?c.min():0, max:c.kind==="sld"?c.max():0};
      let w, el;
      if(c.kind==="sld"){
        w=KIT.slider({min:c.min(), max:c.max(), step:c.step||undefined, fmt:c.fmt,
          mark:c.mark?c.mark():null, val:c.val(), dem:c.dem?c.dem():null, tip:c.tip,
          onChange:v=>{ const k=slot.c;
            if(!k.inert) k.set(k.step?Math.round(v/k.step)*k.step:v); }});
        el=KIT.el("div","margin-sld");
        const minus=KIT.button("−",{flat:true,size:7,onClick:()=>marginSldStep(slot,-1)});
        const plus =KIT.button("+",     {flat:true,size:7,onClick:()=>marginSldStep(slot, 1)});
        minus.el.classList.add("margin-sld-step"); plus.el.classList.add("margin-sld-step");
        el.append(minus.el,w.el,plus.el);
      }else{
        w=KIT.button(marginCtlLabel(c),{flat:true,size:7,tip:c.tip,
          onClick:()=>{ const k=slot.c; if(!k.inert&&k.fn) k.fn(); }});
        if(ports) w.el.classList.add("margin-port");
        el=w.el;
      }
      slot.w=w;
      // a port list is a COLUMN, so a flex basis there shares out height
      if(!ports) el.style.flex=(c.flex||1)+" 1 0";
      r.appendChild(el);
      h.cells.push(slot);
    }
  }
}
function marginCtlSync(h,live,deep){
  let rows=ctlFor(h.p,live,live&&S.split);
  if(rows&&live&&partWrecked(S,h.p.id)) rows=ctlDead(rows);
  if(rows&&!live) rows=ctlBench(rows);
  if(!rows||!rows.length){ if(h.ctl) KIT.show(h.ctl,false); return; }
  if(!h.ctl) h.ctl=KIT.el("div","margin-ctl");
  // in the body so it rides the panel's columns; both body syncs wipe innerHTML
  const first = live ? h.body.firstChild : null;
  if(h.ctl.parentNode!==h.body || (live ? first!==h.ctl : h.body.lastChild!==h.ctl))
    live ? h.body.insertBefore(h.ctl,first) : h.body.appendChild(h.ctl);
  h.ctl.classList.toggle("at-end", !live && h.body.childElementCount>1);
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

// the sim is in K; the conversion to °C is the readout's, never the model's
function marginSkinSync(h){
  if(!h.well.sfx) return;
  const lim=partTsurv(h.p);
  const t=lim?partSkin(S,h.p):null;
  h.well.setSfx(t===null?"":(t-273.15).toFixed(0)+"°C");
  if(lim){ const col = t>=lim ? C.red : t>=lim*0.85 ? C.amber : "";
    if(h._skinCol!==col){ h._skinCol=col; h.well.sfx.style.color=col; } }
}

function marginSide(r,box){
  const cx=r.x+r.w/2, cy=r.y+r.h/2;
  let best="l", bd=cx-box.x;
  const bid=(d,s)=>{ if(d<bd){ bd=d; best=s; } };
  bid(box.x+box.w-cx,"r"); bid(cy-box.y,"t"); bid(box.y+box.h-cy,"b");
  return best;
}
const marginUPerPx=()=>(W/Math.max(1,marginCv().width))/Math.max(1e-6,VIEW.s);
const marginZoomK=()=>1/Math.max(1e-6,marginUPerPx());
// the VIEW.s at which marginZoomK() is exactly 1, where vScale() stops the zoom
const marginZoomMaxS=()=>W/Math.max(1,marginCv().width);

// the frame is padded so a panel may stand off the hull; a cell may go negative
const SLOT_PAD=14;
const eW=()=>GW+2*SLOT_PAD, eH=()=>GH+2*SLOT_PAD;
function marginFreeSum(free){
  const W=eW(), H=eH(), S=new Int32Array((W+1)*(H+1));
  for(let y=0;y<H;y++) for(let x=0;x<W;x++)
    S[(y+1)*(W+1)+x+1] = free[y][x] + S[y*(W+1)+x+1] + S[(y+1)*(W+1)+x] - S[y*(W+1)+x];
  return S;
}
const marginSumAt=(S,x,y,w,h)=>{
  const W=eW(), x0=x+SLOT_PAD, y0=y+SLOT_PAD;
  return S[(y0+h)*(W+1)+x0+w] - S[y0*(W+1)+x0+w]
       - S[(y0+h)*(W+1)+x0] + S[y0*(W+1)+x0];
};
const marginFreeAt=(S,x,y,w,h)=>marginSumAt(S,x,y,w,h)===w*h;
const marginOverlap=(ax,ay,aw,ah,b)=>
  Math.max(0, Math.min(ax+aw,b.x+b.w)-Math.max(ax,b.x)) *
  Math.max(0, Math.min(ay+ah,b.y+b.h)-Math.max(ay,b.y));

const marginCellsOf=r=>({x:Math.round((r.x-GX)/CELL), y:Math.round((r.y-GY)/CELL),
                         w:Math.max(1,Math.round(r.w/CELL)), h:Math.max(1,Math.round(r.h/CELL))});

// once per change, not per frame: the search is O(GW*GH) per panel
let slotSig=null;
const seatBuf=[];
function marginSlot(panels){
  let sig=GW+"x"+GH;
  for(const h of panels) sig += "|"+h.id+":"+h.w+","+h._hpx;
  // the seats are part of the key: a rebuild can produce the same ids and sizes
  let hit = !!slotSig && slotSig.lay===LAY && slotSig.sig===sig;
  if(hit) for(const h of panels) if(h._slot===undefined){ hit=false; break; }
  if(hit) return;
  slotSig={lay:LAY, sig};
  // COVER is what is drawn and may be touched; FREEP adds a ring, so no two panels share a seam
  const occ=occupied(null,{pipes:true,ports:true,mat:true});
  const W=eW(), H=eH();
  const cover=new Array(H), coverX=new Array(H), freep=new Array(H), mach=new Array(H);
  for(let iy=0;iy<H;iy++){
    cover[iy]=new Uint8Array(W); coverX[iy]=new Uint8Array(W);
    freep[iy]=new Uint8Array(W).fill(1);
    mach[iy]=new Uint8Array(W);
    const y=iy-SLOT_PAD;
    for(let ix=0;ix<W;ix++){
      const x=ix-SLOT_PAD;
      const inGrid = x>=0&&x<GW&&y>=0&&y<GH;
      const o = inGrid ? occ[y][x] : null;             // off the hull nothing is drawn
      cover[iy][ix] = o ? 0 : 1;
      // the wall's own panel is the one panel allowed to stand on the paint
      coverX[iy][ix] = (o && !o.mat) ? 0 : 1;
    }
  }
  for(const p of LAY.parts)
    for(let y=p.y;y<p.y+p.h;y++) for(let x=p.x;x<p.x+p.w;x++){
      const iy=y+SLOT_PAD, ix=x+SLOT_PAD;
      if(iy>=0&&iy<H&&ix>=0&&ix<W) mach[iy][ix]=1;
    }
  // a box too short for a name row prints it ABOVE itself, where occupied() cannot see
  for(const p of LAY.parts){
    if(nameRowH(p)) continue;
    const y=p.y-1;
    for(let x=p.x;x<p.x+p.w;x++) cover[y+SLOT_PAD][x+SLOT_PAD]=0;
  }

  const want=[];
  for(const h of panels){
    if(h.corner || !h._mr) continue;
    h._slot=null; h._att=false;
    // `near` is the whole ring, so the cost below can take the closest piece of it
    want.push({h, m:marginCellsOf(h._mr),
               near: h.key==="mat" ? matCellsXY() : null,
               w:Math.max(1,Math.ceil(h.w/CELL)),
               ht:Math.max(1,Math.ceil(h._hpx/CELL))});
  }
  // biggest first, boundary last: a big panel has few candidates, the wall has many
  want.sort((a,b)=> (!!a.near - !!b.near) || (b.w*b.ht)-(a.w*a.ht));

  // attached is a fact about the geometry, not about which pass placed it
  const touchesOwn=(q,x,y)=>{
    const m=q.m;
    return !q.near && x-1 < m.x+m.w && x+q.w+1 > m.x
                   && y-1 < m.y+m.h && y+q.ht+1 > m.y;
  };
  const place=(q,x,y)=>{
    q.h._slot={x, y, w:q.w, h:q.ht};
    q.h._att=touchesOwn(q,x,y);
    for(let py=y;py<y+q.ht;py++) for(let px=x;px<x+q.w;px++){
      cover[py+SLOT_PAD][px+SLOT_PAD]=0; coverX[py+SLOT_PAD][px+SLOT_PAD]=0; }
    for(let py=y-1;py<=y+q.ht;py++) for(let px=x-1;px<=x+q.w;px++){
      const iy=py+SLOT_PAD, ix=px+SLOT_PAD;
      if(iy>=0&&iy<H&&ix>=0&&ix<W) freep[iy][ix]=0;
    }
  };
  // rungs: side face tops flush, then a side at any height, then top/bottom
  const attachRung=(q,x,y)=>{
    const m=q.m;
    const hOv = x < m.x+m.w && x+q.w > m.x;
    const vOv = y < m.y+m.h && y+q.ht > m.y;
    const side = vOv && (x+q.w===m.x || m.x+m.w===x);
    if(side) return y===m.y ? 0 : 1;
    if(hOv && (y+q.ht===m.y || m.y+m.h===y)) return 2;
    return -1;                                   // not touching its own box
  };
  const matBox=(()=>{
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const c of matCellsXY()){
      x0=Math.min(x0,c[0]); x1=Math.max(x1,c[0]+1);
      y0=Math.min(y0,c[1]); y1=Math.max(y1,c[1]+1); }
    return x1>x0 ? {x0,y0,x1,y1} : null;
  })();
  const cornerCost=(x,y,w,h)=>{
    const b=matBox; if(!b) return 0;
    const cx=x+w/2, cy=y+h/2;
    let best=Infinity;
    for(const [gx,gy] of [[b.x0,b.y0],[b.x1,b.y0],[b.x0,b.y1],[b.x1,b.y1]]){
      const dx=cx-gx, dy=cy-gy, d=dx*dx+dy*dy; if(d<best) best=d; }
    return best;
  };
  const insideContainment=(x,y,w,h)=>{
    for(let py=y;py<y+h;py++) for(let px=x;px<x+w;px++)
      if(matRegionAt(px,py)) return true;
    return false;
  };
  const search=(q,mustAttach)=>{
    // the wall's panel is scored against the map that lets it stand on the wall
    const SC=marginFreeSum(q.near?coverX:cover), SP=marginFreeSum(freep), SM=marginFreeSum(mach);
    const mcx=q.m.x+q.m.w/2, mcy=q.m.y+q.m.h/2;
    // the boundary panel names no box, so EVERY machine is somebody else's
    const own=q.near ? {x:0,y:0,w:0,h:0} : q.m;
    let best=null, bestC=Infinity;
    for(let y=-SLOT_PAD;y+q.ht<=GH+SLOT_PAD;y++)
    for(let x=-SLOT_PAD;x+q.w<=GW+SLOT_PAD;x++){
      let rung=0;
      if(mustAttach){ rung=attachRung(q,x,y); if(rung<0) continue; }
      if(!marginFreeAt(SC,x,y,q.w,q.ht)) continue;      // covers nothing drawn
      if(!marginFreeAt(SP,x,y,q.w,q.ht)) continue;      // touches no other panel
      { // no machine but its own is within a cell of it
        const gx=Math.max(-SLOT_PAD,x-1), gy=Math.max(-SLOT_PAD,y-1);
        const gw=Math.min(GW+SLOT_PAD,x+q.w+1)-gx, gh=Math.min(GH+SLOT_PAD,y+q.ht+1)-gy;
        if(marginSumAt(SM,gx,gy,gw,gh) !== marginOverlap(gx,gy,gw,gh,own)) continue;
      }
      const px=x+q.w/2, py=y+q.ht/2;
      let c;
      if(q.near){
        if(insideContainment(x,y,q.w,q.ht)) continue;   // the wall's panel stands OUTSIDE it
        // either edge on either of the ring's lines: two beat one, one beats none
        const b=matBox;
        const on=(a,z)=>a===b[z+"0"] || a===b[z+"1"];
        const ax = b && (on(x,"x") || on(x+q.w,"x")) ? 1 : 0;
        const ay = b && (on(y,"y") || on(y+q.ht,"y")) ? 1 : 0;
        rung = 2-(ax+ay);
        c=cornerCost(x,y,q.w,q.ht);
      }
      else { const dx=px-mcx, dy=py-mcy; c=dx*dx+dy*dy; }
      const cost = rung*1e6 + c;
      if(cost<bestC){ bestC=cost; best=[x,y]; }
    }
    return best;
  };

  const loose=[];
  for(const q of want){
    // the boundary names no box, so there is no face for it to be bolted to
    const b = q.near ? null : search(q,true);
    if(b) place(q,b[0],b[1]); else loose.push(q);
  }
  for(const q of loose){
    const b=search(q,false);
    if(b) place(q,b[0],b[1]);
  }
}

function marginBoxes(){
  const out=[];
  for(const h of (MARGIN||[])){
    if(!h._slot || !h.vis) continue;
    out.push(grect(h._slot.x, h._slot.y, h._slot.w, h._slot.h));
  }
  return out;
}

function marginMeasure(h){
  marginColumns(h);
  return h.well.el.offsetHeight||60;
}

// read pass then write pass: a box measured after a style write forces a relayout
function marginPlace(panels,host){
  if(VIEW.w<60||VIEW.h<60) return;
  const k=marginZoomK(), u=marginUPerPx()*k, rc=marginCv();
  // clipped to the CANVAS BOX, so no panel paints on #stage's letterbox
  const vpw=(typeof innerWidth==="number"?innerWidth:rc.right);
  const vph=(typeof innerHeight==="number"?innerHeight:rc.bottom);
  const clip="inset("+Math.max(0,Math.round(rc.top))+"px "
                     +Math.max(0,Math.round(vpw-rc.right))+"px "
                     +Math.max(0,Math.round(vph-rc.bottom))+"px "
                     +Math.max(0,Math.round(rc.left))+"px)";
  if(host && host._clip!==clip){ host.style.clipPath=clip; host._clip=clip; }
  // u is grid units per CSS px OF THE DRAWN PANEL, so a slot reserves what it covers
  const padU=MARGIN_PAD*u, gapU=MARGIN_GAP*u, grpU=MARGIN_GRP_GAP*u;
  const B={x:VIEW.cx, y:VIEW.cy, w:VIEW.cw, h:VIEW.ch};
  const side={l:[],r:[],t:[],b:[]};
  // scaled by transform: a relayout at a new font size would walk the panel's height
  const put=(h,ax,ay,wU)=>{
    h._pan={x:ax,y:ay,w:wU,h:h._hU};
    const s=vScr({x:ax,y:ay}), g=marginPage(s.x,s.y,rc);
    // NOT rounded: a quantised place pops the panel a pixel each way as k moves
    const x=g.x, y=g.y, eh=h._hpx*k;
    h.vis = x<vpw && y<vph && x+h.w*k>0 && y+eh>rc.top;
    if(h.hid!==!h.vis){ h.well.el.style.visibility=h.vis?"":"hidden"; h.hid=!h.vis; }
    // a hidden panel is still moved, or it pops from a stale place on its way back
    const tf="translate3d("+x.toFixed(3)+"px,"+y.toFixed(3)+"px,0) scale("+k.toFixed(4)+")";
    if(h.tf!==tf){ h.well.el.style.transform=tf; h.tf=tf; }
  };
  const board=[], seat=seatBuf;
  seat.length=0;
  for(const h of panels){
    h._mr=h.rect&&h.rect();
    if(h.corner){
      if(h.needH || h._hpx==null){ h._hpx=marginMeasure(h); h.needH=false; }
      h._hU=h._hpx*u; board.push(h); continue;
    }
    if(!h._mr) continue;
    // LAYOUT height, transform-free, so it is measured once per content change
    if(h.needH || h._hpx==null){
      h._hpx=marginMeasure(h);
      h.needH=false;
    }
    h._hU=h._hpx*u;
    h._grp = h.p ? panelGroup(h.p) : "support";
    h._rank = panelGroupRank(h._grp);
    h._side=marginSide(h._mr,B);
    seat.push(h);
  }
  // the board first; only what found no seat falls through to the edge cascade
  marginSlot(seat);
  for(const h of seat){
    if(!h._slot){ side[h._side].push(h); continue; }
    const r=grect(h._slot.x, h._slot.y, h._slot.w, h._slot.h);
    put(h, r.x, r.y, h.w*u);
  }
  // a board panel names no machine, so it heads its edge band and the cascade follows
  const stack={l:B.y,r:B.y};
  for(const h of board){
    const sd=h.corner[1], wU=h.w*u;
    put(h, sd==="l" ? B.x-padU-wU : B.x+B.w+padU, stack[sd], wU);
    stack[sd]+=h._hU+gapU;
  }
  for(const sd of ["l","r","t","b"]){
    const list=side[sd], flat=(sd==="t"||sd==="b");
    // GROUP FIRST, then board order inside the group - see MARGIN_GRP_GAP
    list.sort((a,b)=> (a._rank-b._rank) ||
      (flat ? a._mr.x-b._mr.x : a._mr.y-b._mr.y));
    let run=flat?-Infinity:stack[sd]-gapU, was=null;   // the cascade that stops two overlapping
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
      put(h,ax,ay,wU);
    }
  }
  marginLeaders(panels);
}

// a plant quantity like a pipe's, so the leader shrinks with what it joins
const MARGIN_LEAD_W=1;
// bus knobs, in PLANT units - `oc`'s own defaults are pixels on a node canvas
const MARGIN_BUS_C={margin:6, laneGap:5, minLen:60, hopCost:2000,
                    facePad:4, minSep:4, tightGap:4, trunkCap:4};
const MARGIN_ROUTE_C={clearance:10, bendCost:40, laneGap:5, nodeHalo:8, haloCost:60};
let marginRt=null, marginRtSig=null, marginRtSides=null;
function marginRoutes(panels){
  const P=panels.filter(h=>h._pan&&h._mr);
  // designSig() plus the boxes: nothing an obstacle is made of can move unseen
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
  // a node rather than blockRects: the fallback A* takes obstacles off nodes alone
  for(const pid in D.ports){
    const c=portCell(pid); if(!c) continue;
    const r=grect(c[0],c[1],1,1);
    nodes.push({id:"port/"+pid, x:r.x, y:r.y, w:r.w, h:r.h});
    walls.push({x:r.x,y:r.y,w:r.w,h:r.h});
  }
  // prevSides holds a fallback connector to its old faces, so an edit flips few routes
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
// clipped, never culled: a visibility gate blinks leaders as the view moves
function marginLeaders(panels){
  if(typeof ctx==="undefined"||!ctx||VIEW.w<2||VIEW.h<2) return;
  const rt=marginRoutes(panels);
  ctx.save();
  ctx.beginPath(); ctx.rect(VIEW.x,VIEW.y,VIEW.w,VIEW.h); ctx.clip();
  for(const h of panels){
    if(!h._pan||!h._mr) continue;
    // touching the box IS the association, and the boundary names too many cells
    if(h._att || h.key==="mat") continue;
    const r=rt&&rt.get(h.id); if(!r||!r.pts||r.pts.length<2) continue;
    const pts=r.pts.map(q=>vScr({x:q[0],y:q[1]}));
    // VIEW.s because the leader is stroked in SCREEN space, not under the transform
    leaderStroke(pts, h.on?C.amber:C.lead, [pts[0],pts[pts.length-1]],
                 MARGIN_LEAD_W*DRAW_K*VIEW.s, LEADER_RAD*DRAW_K*VIEW.s);
  }
  ctx.restore();
}

function marginKeySync(h,fresh,live){
  const k = h.key==="run" ? (isRunKey(sel)?sel:null)
                          : (isMatKey(sel)?sel:matDefaultKey());
  h.selKey=k;
  KIT.show(h.well.el, !!k);
  if(!k){ h.vis=false; h.selAt=null; return; }
  // live has no design signature, so the measure is gated on the pick moving
  const moved = h.selAt!==k;
  if(!fresh && !moved) return;
  h.selAt=k;
  if(moved){
    // off the run, not pipeMap().byKey[k]: `k` is runIdOf(), not the derived key
    const r0 = h.key==="run" ? runOfKey(k) : null;
    const title = h.key==="run"
      ? (r0 ? (pipeLabel(r0.k, r0.key)||"PIPE RUN") : "PIPE RUN")
      : matPanelTitle(k);
    h.well.setTitle(title); KIT.tip(h.well.head,title);
  }
  const blocks = h.key==="run" ? paramsForRun(k)
               : live ? paramsForMatLive(k) : paramsForMat(k);
  dbPanelSync(h.body, blocks);
  if(moved) h.needH=true;
  // a default cell is not a selection
  const on = sel===k;
  if(h.on!==on){ h.well.el.classList.toggle("on",on); h.on=on; }
}

function marginBoardSync(h,live,fresh){
  const n0=h.body.childElementCount, s0=h.body._sig;
  if(h.board==="pipes"){ if(fresh) pipeRailSync(h.body,h.well.el); }
  else if(h.board==="ports") crPortsSync(h.body);
  else crCnxSync(h.body);
  if(h.body._sig!==s0 || h.body.childElementCount!==n0) h.needH=true;
}

// shared with ui/inspwin.js: a window leaves `vis` true and `tf` null, so the pan cull misses it
function panPartSync(h,live,deep,fresh){
  const on=!h.peek && h.p.id===sel;
  if(h.on!==on){ h.well.el.classList.toggle("on",on); h.on=on; }
  // the automation graph re-lays itself out at its own width (render/ctlgraph.js)
  if(h.p.role==="ctrl" && h._ctlSeq!==CTLV.seq){ h._ctlSeq=CTLV.seq; h.needH=true; }
  if(live){
    if(!h.vis && h.tf!==null) return;
    const nm=partName(h.p); h.well.setTitle(nm); KIT.tip(h.well.head,nm);
    marginSkinSync(h);
    fieldRowsSync(h.body, readoutsFor(h.p,S));
    // the bench says the same through B.cols (paramsFor)
    h.body._cols = h.p.role==="core" ? 4 : h.p.role==="ctrl" ? 3 : 0;
    const vz=h.body._viz;
    if(vz&&vz.dmg) hostPaint(vz.dmg,dmgViz,coreOf(h.p.id));
    if(h.p.role==="ctrl"){ if(!h.ctlG) h.ctlG=KIT.el("div","margin-ctlgraph");
      if(h.ctlG.parentNode!==h.body) h.body.appendChild(h.ctlG);
      dbPanelSync(h.ctlG,CTLGRAPH_LIVE); }
  }else{
    if(!fresh) return;
    const nm=partName(h.p), B=paramsFor(partOf(h.p.id)||h.p);
    h.well.setTitle(nm);
    KIT.tip(h.well.head,nm,B.tip||"");
    // cost is one of measRows() (render/inspector.js), not a title-bar suffix
    h.well.setSfx("");
    if(B.head && !h.head && h.well.head){
      h.head=KIT.el("div","db-panel-head");
      h.well.head.insertBefore(h.head, h.well.sfx);
    }
    if(h.head) dbPanelSync(h.head, B.head||[]);
    // height is quantised to cells, so a hover-driven re-measure snaps the panel
    const n0=h.body.childElementCount, s0=h.body._sig;
    dbPanelSync(h.body, B);
    // a tab switch swaps one body for another without touching either count
    const tabbed=h._panTab!==PANTAB.seq; h._panTab=PANTAB.seq;
    if(tabbed || h.body._sig!==s0 || h.body.childElementCount!==n0){
      // the screen-wide pass ran before this panel existed; marginPlace() measures next
      dbHostPaint(h.body);
      h.needH=true;
    }
  }
  marginCtlSync(h,live,deep);
}

let MARGIN=null, marginFit=null, marginAt=null, marginFrame=0, marginPSig=null, marginDeep=null;
// cached per frame, or a second reader would be told nothing ever changes
let panTickAt=-1, panTickV={fresh:false,deep:false};
function panTick(live){
  if(panTickAt===marginFrame) return panTickV;
  panTickAt=marginFrame;
  // PREV.seq and PANTAB.seq: neither is a design change, but both move the body
  const psig = live ? null : designSig()+"|"+sel+"|"+PREV.seq+"|"+PANTAB.seq;
  const fresh = live || psig!==marginPSig; marginPSig=psig;
  // what could have moved a control's range
  const dtok = live ? (coreIds().map(id=>coreSeen(S,id).split?1:0).join("")+"|"+(S.dmgParts?S.dmgParts.length:0)) : psig;
  const deep = dtok!==marginDeep; marginDeep=dtok;
  panTickV={fresh,deep};
  return panTickV;
}
function marginSync(host,live){
  if(!host||typeof LAY==="undefined"||!LAY) return;
  marginFrame++;
  // after the frame counter: inspSync() reads panTick(), which caches on it
  if(MARGIN_HIDE){ KIT.show(host,false); return; }
  // the host is in the trigger: one panel set, and a screen each owns one
  if(marginFit!==LAY || marginAt!==host){
    MARGIN=marginBuild(host,live); marginFit=LAY; marginAt=host; marginPSig=null;
  }
  const t=panTick(live);
  for(const h of MARGIN){
    if(h.key){ marginKeySync(h,t.fresh,live); continue; }
    if(h.board){ marginBoardSync(h,live,t.fresh); continue; }
    panPartSync(h,live,t.deep,t.fresh);
  }
  marginPlace(MARGIN,host);
}
