"use strict";
/* ═══════════════ THE CONTROLLER'S AUTOMATION, DRAWN AND WIRED ═══════════════
   One panel section on the CONTROL room, on the bench and in the control room
   alike. The picture is a VIEW: blocks in rows by rank (sources at the top,
   sinks at the bottom), one controller to a column, right-angle wires between
   them, each wire labelled with what it is carrying in its own unit. Nothing
   about the layout is stored, so nothing about it can go stale. Beside the
   picture stands the editor for the block picked: on the bench it writes
   D.blocks and calls dTouch(); in
   the control room every write is an act (blkWire, blkKnob, blkOn), so a tape
   replays it. CTLV is view state - which block is selected - and never S. */
/* seq counts the times a picture changed size, so the panel holding one knows
   to measure itself again - a graph that got shorter must not leave the box
   it was reserved in standing empty under it. */
const CTLV={sel:null, seq:0};
const CG_NW=116, CG_NH=48, CG_GX=8, CG_GY=20, CG_PAD=4, CG_ROW=CG_NH+8;
/* the narrowest a whole controller may be drawn in. A cabinet holds several -
   a rod loop, a feed loop, a relief valve - and stacking them is what made the
   section a screen tall, so a panel wide enough stands them side by side. */
const CG_COMPW=248, CG_COLGAP=14, CG_STUD=9;

/* the table the picture reads: the live block in the control room, the design
   on the bench. Same shape either way - mode, in, on, knobs. */
const ctlTable = live => live ? (S&&S.blkBy)||null : D.blocks;

/* rank = longest path from a block with nothing wired in. A block on a cycle
   ranks below everything it can reach from, which is where it reads from. */
function ctlRanks(T){
  const ids=Object.keys(T), rank={}, deg={}, kids={};
  for(const id of ids){ deg[id]=0; kids[id]=[]; rank[id]=0; }
  for(const id of ids) for(const src of T[id].in) if(src&&T[src]){ deg[id]++; kids[src].push(id); }
  const q=ids.filter(id=>deg[id]===0); let top=0;
  while(q.length){ const id=q.shift(); top=Math.max(top,rank[id]);
    for(const k of kids[id]){ rank[k]=Math.max(rank[k],rank[id]+1); if(--deg[k]===0) q.push(k); } }
  for(const id of ids) if(deg[id]>0) rank[id]=top+1;
  return rank;
}
const blkNum=id=>+String(id).replace(/\D/g,"")||0;
/* one connected graph at a time, stacked: a rod loop and a feed loop share a
   cabinet, not a picture. Within a rank a block stands under what feeds it. */
function ctlComponents(T){
  const root={}, find=id=>{ while(root[id]!==id) id=root[id]=root[root[id]]; return id; };
  for(const id in T) root[id]=id;
  for(const id in T) for(const src of T[id].in) if(src&&T[src]) root[find(src)]=find(id);
  const by={}; for(const id in T) (by[find(id)]||(by[find(id)]=[])).push(id);
  return Object.values(by).sort((a,b)=>Math.min(...a.map(blkNum))-Math.min(...b.map(blkNum)));
}
/* one controller, in its own column: ranks down the page, the blocks of a rank
   spread across it and centred under what feeds them. Local coordinates. */
function ctlLayComp(T,comp,w){
  const perRow=Math.max(1,Math.floor((w+CG_GX)/(CG_NW+CG_GX)));
  const sub={}; for(const id of comp) sub[id]=T[id];
  const rank=ctlRanks(sub), byR={}, pos={};
  for(const id of comp) (byR[rank[id]]||(byR[rank[id]]=[])).push(id);
  let y=0;
  for(const r of Object.keys(byR).map(Number).sort((a,b)=>a-b)){
    const bary=id=>{ const xs=T[id].in.filter(s=>s&&pos[s]).map(s=>pos[s].x); return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:1e9+blkNum(id); };
    const ids=byR[r].sort((a,b)=>(bary(a)-bary(b))||(blkNum(a)-blkNum(b))), rows=Math.ceil(ids.length/perRow);
    ids.forEach((id,i)=>{ const row=(i/perRow)|0, col=i%perRow, n=Math.min(perRow,ids.length-row*perRow);
      const x0=(w-(n*(CG_NW+CG_GX)-CG_GX))/2;
      pos[id]={x:x0+col*(CG_NW+CG_GX), y:y+row*CG_ROW}; });
    y+=rows*CG_ROW-8+CG_GY;
  }
  return {pos, h:Math.max(CG_NH, y-CG_GY)};
}
/* the whole cabinet: as many controllers side by side as the width will take,
   the rest wrapped onto a band below, one rule between bands. */
function ctlLayout(T,w){
  const comps=ctlComponents(T), inner=Math.max(CG_NW,w-2*CG_PAD);
  const ncol=Math.max(1,Math.min(comps.length,Math.floor((inner+CG_COLGAP)/(CG_COMPW+CG_COLGAP))));
  const colW=(inner-(ncol-1)*CG_COLGAP)/ncol;
  const pos={}, seams=[]; let y=CG_PAD, band=0;
  comps.forEach((comp,i)=>{
    const col=i%ncol;
    if(col===0&&i>0){ y+=band+CG_GY; seams.push(y-CG_GY/2); band=0; }
    const laid=ctlLayComp(T,comp,colW), dx=CG_PAD+col*(colW+CG_COLGAP);
    for(const id in laid.pos) pos[id]={x:laid.pos[id].x+dx, y:laid.pos[id].y+y};
    band=Math.max(band,laid.h);
  });
  return {pos, seams, h:Math.max(CG_NH+2*CG_PAD, y+band+CG_PAD)};
}
const ctlFmt=(v,u)=>{ if(v==null||!isFinite(v)) return "—";
  const a=Math.abs(v), s=a>=100?v.toFixed(0):a>=10?v.toFixed(1):a>=1?v.toFixed(2):v.toFixed(3);
  return u?s+" "+u:s; };
/* what the box says: the reading it takes or the demand it lands on, else its kind */
function blkName(b){
  if(b.mode==="source"){ const r=SIGNAL[b.sig]; return r?r.lab:b.sig; }
  if(b.mode==="sink"){ const r=SINK[b.sink]; return r?r.lab:b.sink; }
  if(b.mode==="math"||b.mode==="sel") return b.op.toUpperCase();
  return BLK[b.mode]?BLK[b.mode].lab:b.mode;
}
const blkArgName=b=>{ if(b.arg==null) return ""; const p=partOf(b.arg); return p?partName(p):String(b.arg).toUpperCase(); };
/* "b6" is a key, not a word: everywhere a block is named to the player it is
   named by what it does, and the key rides along as BLOCK 6. */
const blkNo=id=>"BLOCK "+blkNum(id);
function blkTitle(T,id){ const b=T[id]; if(!b) return blkNo(id);
  const arg=blkArgName(b), kind=BLK[b.mode]?BLK[b.mode].lab:b.mode;
  return blkName(b)+(arg?" "+arg:"")+(blkName(b)===kind?"":" ("+kind+")")+" · "+blkNo(id); }
/* the tooltip is the block's own paper: what it is, what it is of, what is
   wired into every slot. Never its value - the box already carries that live,
   and a tooltip built at pointerover would sit there going stale. */
function blkTipBody(T,id,s){ const b=T[id], m=BLK[b.mode], L=[m.tip];
  const arg=blkArgName(b); if(arg) L.push("OF: "+arg);
  const u=blkLabel(s,id).u; if(u) L.push("PUTS OUT: "+u);
  if(m.ins.length) L.push(m.ins.map((nm,i)=>nm+": "+(b.in[i]&&T[b.in[i]]?blkTitle(T,b.in[i]):"nothing wired")).join("\n"));
  if(!b.on) L.push("[ OFF - output held, any sink under it lets go ]");
  return L.join("\n\n"); }

/* ══ THE PICTURE ══ HTML, not a canvas: a block is a button, so it carries its
   own tooltip, its own hover and its own focus the way every other control on
   the page does, and the wires are one SVG behind them. Structure is rebuilt
   only when the cabinet or the width changes; every frame after that writes
   text and classes onto boxes that are already standing. */
const SVGNS="http://www.w3.org/2000/svg";
const svgEl=(n,cls)=>{ const e=document.createElementNS(SVGNS,n); if(cls) e.setAttribute("class",cls); return e; };
/* what the box's second line says: its value live, else the machine it is of */
const blkSub=(T,id,s)=>{ const b=T[id];
  return s ? ctlFmt(b.out,blkLabel(s,id).u) : b.mode==="const" ? ctlFmt(b.v,"") : blkArgName(b)||blkNo(id); };
/* THE THIRD LINE IS THE TUNE. A box that says only its kind is a box you have
   to click to read, so every knob that decides what the block DOES is on it:
   the gains of a PID, the span of a limit, the points a compare switches at. */
const knobFmt=v=>{ if(v==null) return "-"; const a=Math.abs(v);
  return a>=100?v.toFixed(0):a>=10?v.toFixed(1):a>=1?v.toFixed(2):String(+v.toFixed(3)); };
const spanFmt=(lo,hi)=> lo!=null&&hi!=null ? knobFmt(lo)+" to "+knobFmt(hi)
  : lo!=null ? "min "+knobFmt(lo) : hi!=null ? "max "+knobFmt(hi) : "";
function blkSpec(b){
  switch(b.mode){
    case "math": return b.k==null||b.k===1 ? "" : "x "+knobFmt(b.k);
    case "pid":  return b.kp==null&&b.ti==null&&b.td==null ? "plant tune"
      : "kp "+knobFmt(b.kp)+"  ti "+knobFmt(b.ti)+"  td "+knobFmt(b.td);
    case "integ":return spanFmt(b.lo,b.hi);
    case "limit":return spanFmt(b.lo,b.hi)+(b.rate==null?"":"  "+knobFmt(b.rate)+"/s");
    case "lag":  return "tau "+knobFmt(b.tau)+" s";
    case "compare": return "on "+knobFmt(b.on)+"  off "+knobFmt(b.off);
    default: return "";
  }
}
function ctlPicMk(live){
  const root=KIT.el("div","ctlg-pic");
  let sig=null, box={}, runs=[], lastPos={}, rubber=null, drag=null;
  /* the cabinet's shape, and nothing that moves inside it: a value changing
     must never cost a rebuild, and the width must always cost one */
  const shape=(T,w)=>{ const a=[live?1:0,Math.round(w/8)];
    for(const id in T){ const b=T[id]; a.push(id,b.mode,b.sig||"",b.sink||"",b.arg==null?"":b.arg,b.op||"",b.in.join(">")); }
    return a.join("|"); };
  const build=(T,w,s)=>{
    root.innerHTML=""; box={}; runs=[];
    const L=ctlLayout(T,w); lastPos=L.pos;
    if(root.style.height!==L.h+"px"){ root.style.height=L.h+"px"; CTLV.seq++; }
    const sv=svgEl("svg","ctlg-wires");
    sv.setAttribute("width",w); sv.setAttribute("height",L.h);
    sv.setAttribute("viewBox","0 0 "+w+" "+L.h);
    root.appendChild(sv);
    for(const sy of L.seams){ const ln=svgEl("line","ctlg-seam");
      ln.setAttribute("x1",CG_PAD); ln.setAttribute("x2",w-CG_PAD); ln.setAttribute("y1",sy); ln.setAttribute("y2",sy); sv.appendChild(ln); }
    const placed=[];
    for(const id in T){ const b=T[id], c=L.pos[id];
      b.in.forEach((src,i)=>{ if(!src||!T[src]||!L.pos[src]) return;
        const a=L.pos[src], n=b.in.length;
        const x0=a.x+CG_NW/2, y0=a.y+CG_NH, x1=c.x+CG_NW*(i+1)/(n+1), y1=c.y;
        const ym=y1>y0 ? y1-CG_GY/2 : y0+CG_GY/2;
        const g=svgEl("g","ctlg-wire");
        const pl=svgEl("polyline"); pl.setAttribute("points",[x0+","+y0,x0+","+ym,x1+","+ym,x1+","+y1].join(" ")); g.appendChild(pl);
        const hd=svgEl("polygon","ctlg-head"); hd.setAttribute("points",[x1+","+y1,(x1-3)+","+(y1-5),(x1+3)+","+(y1-5)].join(" ")); g.appendChild(hd);
        /* a label per wire, nudged down off any label already at that spot -
           the same pricing the canvas did, on an estimate of the glyph width */
        const t=svgEl("text","ctlg-wire-lab"), lx=(x0+x1)/2; let ly=ym-3;
        const wide=id=>String(blkSub(T,id,s)).length*4.6;
        for(let k=0;k<4;k++){ if(!placed.some(r=>Math.abs(r.x-lx)<(r.w+wide(src))/2+3 && Math.abs(r.y-ly)<9)) break; ly+=9; }
        placed.push({x:lx,y:ly,w:wide(src)});
        t.setAttribute("x",lx); t.setAttribute("y",ly); g.appendChild(t);
        sv.appendChild(g);
        runs.push({g,t,src,dst:id});
      });
    }
    for(const id in T){ const c=L.pos[id];
      const el=KIT.el("button","ctlg-blk"); el.type="button";
      el.style.left=c.x+"px"; el.style.top=c.y+"px";
      el.style.width=CG_NW+"px"; el.style.height=CG_NH+"px";
      el.classList.add("m-"+T[id].mode);
      const nm=KIT.el("span","ctlg-blk-name"), sub=KIT.el("span","ctlg-blk-sub"), spec=KIT.el("span","ctlg-blk-spec");
      nm.textContent=blkName(T[id]); el.append(nm,sub,spec);
      KIT.tip(el,blkTitle(T,id),blkTipBody(T,id,s));
      el.dataset.blk=id;
      el.addEventListener("click",()=>{ CTLV.sel = CTLV.sel===id ? null : id; });
      root.appendChild(el); box[id]={el,sub,spec};
      /* THE HANDLES A WIRE IS DRAWN BY. A wire is geometry, so it is dragged
         like a pipe: out of the stud under a block, into one of the studs on
         top of the block that reads it. Dragging a wired input stud picks the
         wire up; dropping it on bare deck cuts it. */
      const stud=(x,y,cls,slot)=>{ const p=KIT.el("div","ctlg-stud "+cls);
        p.style.left=(x-CG_STUD/2)+"px"; p.style.top=(y-CG_STUD/2)+"px";
        p.dataset.blk=id; if(slot!=null) p.dataset.slot=slot;
        KIT.tip(p, slot==null ? "OUT" : (BLK[T[id].mode].ins[slot]||"IN"),
          slot==null ? "Drag from here onto another block to feed it this block's output."
                     : "What this input reads. Drag from here onto a block to wire it, or onto bare deck to cut the wire.");
        root.appendChild(p); return p; };
      stud(c.x+CG_NW/2, c.y+CG_NH, "out", null);
      const n=T[id].in.length;
      for(let i=0;i<n;i++) stud(c.x+CG_NW*(i+1)/(n+1), c.y, "in"+(T[id].in[i]?" wired":""), i);
    }
    rubber=svgEl("polyline","ctlg-rubber"); sv.appendChild(rubber);
  };
  /* ══ THE DRAG ══ one gesture, held on the picture itself: pointer capture, so
     a drag that wanders over the plant still ends here and the panel underneath
     never takes it for a pan. */
  const at=e=>{ const r=root.getBoundingClientRect(), k=(r.width/Math.max(1,root.offsetWidth))||1;
    return {x:(e.clientX-r.left)/k, y:(e.clientY-r.top)/k}; };
  const hitOf=e=>{ const el=document.elementFromPoint(e.clientX,e.clientY);
    const st=el&&el.closest&&el.closest(".ctlg-stud"); if(st&&root.contains(st)) return {blk:st.dataset.blk, slot:st.dataset.slot===undefined?null:+st.dataset.slot};
    const bk=el&&el.closest&&el.closest(".ctlg-blk"); if(bk&&root.contains(bk)) return {blk:bk.dataset.blk, slot:null};
    return null; };
  /* which slot a drop onto the body of a block means: the first free one, else
     the one whose stud the hand came down nearest */
  const slotFor=(T,id,x)=>{ const b=T[id], n=b.in.length; if(!n) return null;
    const free=b.in.findIndex(v=>!v); if(free>=0) return free;
    const c=lastPos[id]; if(!c) return 0;
    let best=0, bd=1e9;
    for(let i=0;i<n;i++){ const d=Math.abs(c.x+CG_NW*(i+1)/(n+1)-x); if(d<bd){ bd=d; best=i; } }
    return best; };
  root.addEventListener("pointerdown",e=>{
    if(e.button!==0) return;
    const st=e.target.closest&&e.target.closest(".ctlg-stud"); if(!st) return;
    e.preventDefault(); e.stopPropagation();
    const T=ctlTable(live); if(!T) return;
    const id=st.dataset.blk, slot=st.dataset.slot===undefined?null:+st.dataset.slot;
    // an input stud carries the wire already on it; an empty one starts a new wire
    const src = slot==null ? id : (T[id]&&T[id].in[slot]) || null;
    drag={src, from:id, slot, p:at(e)};
    if(slot!=null) ctlWire(live,id,slot,null);
    root.setPointerCapture(e.pointerId); root.classList.add("wiring");
  });
  root.addEventListener("pointermove",e=>{ if(!drag) return; drag.p=at(e); rubberDraw(); });
  root.addEventListener("pointerup",e=>{
    if(!drag) return;
    const d=drag; drag=null; root.classList.remove("wiring"); rubberDraw();
    const T=ctlTable(live); if(!T) return;
    const hit=hitOf(e);
    if(d.slot!=null && d.src==null && !hit) return;          // a cut is what an empty drop means, and it is already done
    if(!hit) return;
    if(d.slot!=null){                                        // dragging an input: whatever it lands on feeds it
      if(hit.blk!==d.from) ctlWire(live,d.from,d.slot,hit.blk);
      else if(d.src) ctlWire(live,d.from,d.slot,d.src);      // back where it started
      return;
    }
    if(hit.blk===d.src) return;                              // no block feeds itself
    const slot = hit.slot!=null ? hit.slot : slotFor(T,hit.blk,at(e).x);
    if(slot!=null) ctlWire(live,hit.blk,slot,d.src);
  });
  root.addEventListener("lostpointercapture",()=>{ if(drag){ drag=null; root.classList.remove("wiring"); rubberDraw(); } });
  function rubberDraw(){
    if(!rubber) return;
    if(!drag||!lastPos[drag.from]){ rubber.setAttribute("points",""); return; }
    const c=lastPos[drag.from];
    const x0 = drag.slot==null ? c.x+CG_NW/2 : c.x+CG_NW*(drag.slot+1)/((ctlTable(live)[drag.from].in.length)+1);
    const y0 = drag.slot==null ? c.y+CG_NH : c.y;
    rubber.setAttribute("points",[x0+","+y0, drag.p.x+","+drag.p.y].join(" "));
  }
  function sync(){
    const T=ctlTable(live), w=root.clientWidth;
    if(!T||w<=0){ if(sig!==null){ root.innerHTML=""; sig=null; box={}; runs=[]; rubber=null; } return; }
    const s=live?S:null, nsig=shape(T,w);
    if(nsig!==sig){ sig=nsig; build(T,w,s); rubberDraw(); }
    root.classList.toggle("dead",!!(live&&!ctlLive(S)));
    for(const id in box){ const b=T[id], o=box[id];
      o.el.classList.toggle("sel",CTLV.sel===id);
      o.el.classList.toggle("off",!b.on);
      o.sub.textContent=blkSub(T,id,s);
      o.spec.textContent=blkSpec(b);
    }
    for(const r of runs){ const on=T[r.src].on&&T[r.dst].on;
      r.g.classList.toggle("off",!on);
      r.t.textContent = live ? blkSub(T,r.src,s) : (blkLabel(s,r.src).u||""); }
  }
  return {el:root, sync};
}

/* ══ THE WRITERS ══ one pair of doors, so the bench and the control room
   cannot disagree about what a knob change does. */
function ctlWrite(live,id,k,v){
  if(live){ act("blkKnob",id,k,v); return; }
  const b=D.blocks[id]; if(!b) return;
  b[k]=v;
  if(k==="sig") b.arg=sigArg0(SIGNAL[v]?SIGNAL[v].scope:"plant");
  if(k==="sink") b.arg=sigArg0(SINK[v]?SINK[v].scope:"plant");
  dTouch();
}
function ctlWire(live,id,slot,src){
  if(live){ act("blkWire",id,slot,src||null); return; }
  const b=D.blocks[id]; if(!b) return; b.in[slot]=src||null; dTouch();
}
function ctlOn(live,id){
  if(live){ act("blkOn",id); return; }
  const b=D.blocks[id]; if(!b) return; b.on=!(b.on!==false); dTouch();
}

/* ══ THE EDITOR ══ built for the selected block, rebuilt when the block, its
   kind or the block list changes, value-synced every call otherwise. */
const ctlRow=(lab,...els)=>{ const r=KIT.el("div","ctlg-row"); if(lab){ const l=KIT.el("span","ctlg-lab"); l.textContent=lab; r.appendChild(l); } for(const e of els) r.appendChild(e); return r; };
/* a key that opens a list: the current choice on the key, the choices in the menu */
function ctlPick(label,items,cur,onPick,tips){
  const mk=KIT.menuKey({label:label+": "+(items[cur]||"—")});
  const ol=KIT.optList(items.map((n,i)=>({name:n,tip:tips?tips[i]:""})),{onSelect:i=>{ onPick(i); KIT.show(mk.menu,false); mk.key.set({on:false}); }});
  mk.menu.appendChild(ol.el); ol.set(cur);
  return {el:mk.el, set:(i,its)=>{ ol.set(i); mk.key.set({label:label+": "+((its||items)[i]||"—")}); }};
}
function ctlEditorMk(live){
  const root=KIT.el("div","ctlg-ed"); let sig=null, P_={};
  /* the box keeps its height whether or not a block is picked: an editor that
     grows and shrinks under the picture moves the picture out from under the hand */
  const hint=KIT.el("div","ctlg-hint");
  hint.textContent="Click a block in the picture to wire it, tune it or switch it off.";
  root.appendChild(hint);
  const build=(id,b)=>{ root.innerHTML=""; P_={}; const m=BLK[b.mode];
    const r=KIT.rule(blkTitle(ctlTable(live)||{},id)); KIT.tip(r.el,m.lab,m.tip); root.appendChild(r.el);
    const onB=KIT.button("ON",{flat:true,size:7,tip:"Whether this block computes. Off, its output holds and any sink under it lets go of its demand.",onClick:()=>ctlOn(live,id)});
    P_.on=onB; const head=[onB.el];
    if(!live){ const del=KIT.button("REMOVE",{flat:true,size:7,danger:true,tip:"Takes this block out of the cabinet and unwires everything that read it.",onClick:()=>{ removeBlock(id); CTLV.sel=null; }}); head.push(del.el); }
    root.appendChild(ctlRow(null,...head));
    if(!live){ const mp=ctlPick("KIND",BLK_MODES.map(k=>BLK[k].lab),BLK_MODES.indexOf(b.mode),i=>{ setBlockMode(id,BLK_MODES[i]); },BLK_MODES.map(k=>BLK[k].tip)); root.appendChild(ctlRow(null,mp.el)); }
    if(b.mode==="source"){ const keys=Object.keys(SIGNAL);
      P_.sig=ctlPick("SIGNAL",keys.map(k=>SIGNAL[k].lab+(SIGNAL[k].u?" ("+SIGNAL[k].u+")":"")+" · "+SIGNAL[k].scope),keys.indexOf(b.sig),i=>ctlWrite(live,id,"sig",keys[i]));
      P_.sigKeys=keys; root.appendChild(ctlRow(null,P_.sig.el)); }
    if(b.mode==="sink"){ const keys=SINK_KEYS;
      P_.sink=ctlPick("DRIVES",keys.map(k=>SINK[k].lab+(SINK[k].u?" ("+SINK[k].u+")":"")+" · "+SINK[k].scope),keys.indexOf(b.sink),i=>ctlWrite(live,id,"sink",keys[i]));
      root.appendChild(ctlRow(null,P_.sink.el)); }
    if(b.mode==="source"||b.mode==="sink"){
      const scope=b.mode==="source"?(SIGNAL[b.sig]||{}).scope:(SINK[b.sink]||{}).scope, args=sigArgs(scope);
      if(args.length){ const names=args.map(a=>{ const p=partOf(a); return p?partName(p):String(a).toUpperCase(); });
        P_.arg=ctlPick("OF",names,args.indexOf(b.arg),i=>ctlWrite(live,id,"arg",args[i])); P_.args=args;
        root.appendChild(ctlRow(null,P_.arg.el)); } }
    if(b.mode==="math"||b.mode==="sel"){ const ops=b.mode==="math"?MATH_OPS:SEL_OPS;
      P_.op=ctlPick("OP",ops.map(o=>o.toUpperCase()),ops.indexOf(b.op),i=>ctlWrite(live,id,"op",ops[i])); P_.ops=ops;
      root.appendChild(ctlRow(null,P_.op.el)); }
    // inputs: any other block, by what it says
    const T=ctlTable(live), others=Object.keys(T).filter(k=>k!==id).sort((p,q)=>blkNum(p)-blkNum(q));
    P_.ins=m.ins.map((nm,slot)=>{ const names=["NOTHING"].concat(others.map(o=>blkTitle(T,o)));
      const pk=ctlPick(nm,names,others.indexOf(b.in[slot])+1,i=>ctlWire(live,id,slot,i?others[i-1]:null));
      root.appendChild(ctlRow(null,pk.el)); return {pk,others}; });
    // knobs: every number the mode states; blank is "none" or "suggested"
    P_.num={};
    const kb=KIT.el("div","ctlg-knobs");
    for(const k in m.knobs){ if(k==="sig"||k==="sink"||k==="arg"||k==="op") continue;
      // a knob that ships null may be blank: "none" (a limit), or "the plant's own tune" (a PID gain)
      const sug=m.sug&&m.sug[k], nullable=m.knobs[k]===null;
      const n=KIT.numInput({dp:3,title:k.toUpperCase(),tip:(m.ktip&&m.ktip[k])||m.tip,
        auto:nullable?{get:()=>b[k]==null, set:on=>{ ctlWrite(live,id,k,on?null:(sug?sug():0)); }}:null,
        onChange:v=>ctlWrite(live,id,k,v)});
      P_.num[k]=n; kb.appendChild(ctlRow(k.toUpperCase(),n.el)); }
    if(kb.children.length) root.appendChild(kb);
  };
  /* the floor only ever rises: the tallest editor this cabinet has shown is the
     height every other one is padded to, so picking a block never moves anything */
  let edMax=0;
  const edFit=()=>{ const h=root.offsetHeight; if(h>edMax){ edMax=h; root.style.minHeight=h+"px"; } };
  function sync(){
    const T=ctlTable(live), id=CTLV.sel;
    if(!id||!T||!T[id]){ if(sig!==null){ root.innerHTML=""; root.appendChild(hint); sig=null; } return; }
    const b=T[id], nsig=id+"|"+b.mode+"|"+(b.sig||"")+"|"+(b.sink||"")+"|"+Object.keys(T).join(",")+"|"+live;
    if(nsig!==sig){ sig=nsig; build(id,b); edFit(); }
    P_.on.set({label:b.on?"ON":"OFF", on:!!b.on});
    if(P_.sig) P_.sig.set(P_.sigKeys.indexOf(b.sig));
    if(P_.sink) P_.sink.set(SINK_KEYS.indexOf(b.sink));
    if(P_.arg) P_.arg.set(P_.args.indexOf(b.arg));
    if(P_.op) P_.op.set(P_.ops.indexOf(b.op));
    P_.ins.forEach((o,slot)=>o.pk.set(o.others.indexOf(b.in[slot])+1));
    for(const k in P_.num){ const v=b[k]; P_.num[k].set(v==null?null:v); if(BLK[b.mode].knobs[k]===null) P_.num[k].setAuto(v==null); }
  }
  return {el:root, sync};
}

/* ══ THE PANEL SECTION ══ the picture, and the editor beside it where the
   panel is wide enough to stand them side by side (CSS, .ctlg-cols). */
const CTLG=new Set();
function ctlGraphMk(live){
  const root=KIT.el("div","ctlg");
  const hd=KIT.rule("AUTOMATION");
  KIT.tip(hd.el,"AUTOMATION","Every block in this cabinet, sources at the top, the demands they drive at the bottom. Each controller stands in its own column. A wire says what it carries. Hover a block to read it, click it to wire it, tune it or switch it off"+(live?".":"; ADD puts a new one in."));
  root.appendChild(hd.el);
  const cols=KIT.el("div","ctlg-cols"), side=KIT.el("div","ctlg-side");
  const pic=ctlPicMk(live);
  cols.append(pic.el,side); root.appendChild(cols);
  if(!live){ const mk=KIT.menuKey({label:"ADD BLOCK",tip:"A new block in the cabinet. Pick its kind; wire it from its own row after."});
    const ol=KIT.optList(BLK_MODES.map(k=>({name:BLK[k].lab,tip:BLK[k].tip})),{onSelect:i=>{ CTLV.sel=mintBlock(BLK_MODES[i]); KIT.show(mk.menu,false); mk.key.set({on:false}); }});
    mk.menu.appendChild(ol.el); side.appendChild(ctlRow(null,mk.el)); }
  const ed=ctlEditorMk(live); side.appendChild(ed.el);
  const g={el:root, live, sync(){ pic.sync(); ed.sync(); }};
  CTLG.add(g); return g;
}
/* the bench's frame: sync every section still on the page */
function ctlGraphTick(){
  for(const g of CTLG){ if(!g.el.isConnected){ CTLG.delete(g); continue; } if(g.live) continue; g.sync(); }
}
const CTLGRAPH_LIVE=[{kind:"ctlgraph",title:"AUTOMATION",live:true}];
