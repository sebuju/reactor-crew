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
const CTLV={sel:null, seq:0, seg:null};
/* WHICH SECTION IS OPEN. The picture draws one at a time (segIds(), ctl.js) or
   the cabinet is one drawing of ninety blocks. A section that has been deleted
   under the selection falls back to the first, so this can never name nothing. */
const ctlSeg = () => { const a=segIds(); return a.includes(CTLV.seg) ? CTLV.seg : a[0]; };
/* the blocks of the open section only. Everything downstream - the layout, the
   wires, the studs - reads this and not the whole cabinet. */
const ctlSegTable = T => { const sid=ctlSeg(), o={};
  for(const id in T) if(segOf(id)===sid) o[id]=T[id];
  return o; };
/* CG_GY IS A LANE, NOT A GAP: the wire labels are drawn in it, so it has to be
   deep enough for two of them (CG_LAB_H below) clear of the boxes either side.
   At 20 a label's box started 2px above the block over it and every nudge put
   the next one further into the block under it.
   CG_ROWGAP is what separates the rows a single rank WRAPS onto. It was 8, and
   a stud is 9 across and centred on the block's own edge, so the studs of two
   stacked rows overlapped each other by a pixel - measured 12 collisions on the
   protection graph. It also has to hold a wire label, because a rank that
   wraps puts two rows in front of the wires crossing them, so it is CG_LAB_H
   plus clearance and not merely more than a stud. */
const CG_NW=116, CG_NH=48, CG_GX=8, CG_GY=28, CG_PAD=4, CG_ROWGAP=18, CG_ROW=CG_NH+CG_ROWGAP;
/* the narrowest a whole controller may be drawn in. A cabinet holds several -
   a rod loop, a feed loop, a relief valve - and stacking them is what made the
   section a screen tall, so a panel wide enough stands them side by side. */
const CG_COMPW=248, CG_COLGAP=14, CG_STUD=9;
/* ONE WIRE LABEL'S HEIGHT, and it is what the anti-overlap nudge steps by. It
   was 9, which is the type size and not the line: the label carries a 3px
   panel-coloured halo (paint-order:stroke, CSS) so its box is taller than its
   glyphs, and two labels stacked 9 apart still touched. */
const CG_LAB_H=12;

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
    y+=rows*CG_ROW-CG_ROWGAP+CG_GY;   // the last row of a rank pays the lane, not the wrap gap
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
/* WHAT IT DOES IS ONLY THE DEFAULT NAME. A cabinet of eight SUBs is eight
   blocks called SUB, so the player may name one and the name wins wherever
   the block is spelt out - the box, the title, a wire picker, the strip key
   that owns the demand. nameFor() (layout.js) is the same door a machine's
   name comes through, so a block rides designSig() and the save format free. */
const blkWord=(id,b)=>nameFor(id, blkName(b));
/* ONLY EVER SMALLER, the same bargain stripPlan() strikes on a control strip:
   a name the player set may be twenty-four characters and the box is one
   width, so the TYPE comes down to meet the word rather than the word being
   cut off halfway. Asked only when the text CHANGES - ninety boxes measuring
   themselves every frame is a forced layout in the middle of a drag. */
const CG_NAME_PX=[null,10,9,8];
function fitName(el){
  el.style.fontSize="";
  for(const px of CG_NAME_PX){
    if(px) el.style.fontSize=px+"px";
    if(el.scrollWidth<=el.clientWidth+1) return;
  }
}
function blkDflt(T,id){ const b=T[id]; if(!b) return blkNo(id);
  const arg=blkArgName(b), kind=BLK[b.mode]?BLK[b.mode].lab:b.mode;
  return blkName(b)+(arg?" "+arg:"")+(blkName(b)===kind?"":" ("+kind+")"); }
function blkTitle(T,id){ if(!T[id]) return blkNo(id);
  return nameFor(id, blkDflt(T,id))+" · "+blkNo(id); }
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
  /* A PRESS ON BARE DECK LETS THE BLOCK GO, and with it the window standing
     over it. The listener is on the picture and not on the page: a document
     handler would close the editor on every press anywhere on the ship. A
     press on a block, a stud or the window itself is that thing's own. */
  MOUSE.on(root,{click(e){
    if(e.target.closest(".ctlg-blk,.ctlg-stud,.ctlg-ed-win")) return;
    CTLV.sel=null;
  }});
  let sig=null, box={}, runs=[], lastPos={}, rubber=null, drag=null;
  /* the cabinet's shape, and nothing that moves inside it: a value changing
     must never cost a rebuild, and the width must always cost one */
  const shape=(T,w)=>{ const a=[live?1:0,Math.round(w/8)];
    for(const id in T){ const b=T[id]; a.push(id,b.mode,b.sig||"",b.sink||"",b.arg==null?"":b.arg,b.op||"",b.in.join(">")); }
    return a.join("|"); };
  const build=(T,w,s,ALL)=>{
    ALL=ALL||T;
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
      b.in.forEach((src,i)=>{ if(!src||!ALL[src]) return;
        const n=b.in.length;
        /* A WIRE FROM ANOTHER SECTION IS STILL A WIRE. Drawing only what is on
           this tab would make the picture lie about where a block's reading
           comes from, so it is drawn as a stub into the stud, labelled with the
           block it comes from and the section that holds it. */
        if(!T[src]||!L.pos[src]){
          const x1=c.x+CG_NW*(i+1)/(n+1), y1=c.y, g=svgEl("g","ctlg-wire ctlg-xseg");
          const pl=svgEl("polyline"); pl.setAttribute("points",[x1+","+(y1-CG_GY),x1+","+y1].join(" ")); g.appendChild(pl);
          const hd=svgEl("polygon","ctlg-head"); hd.setAttribute("points",[x1+","+y1,(x1-3)+","+(y1-5),(x1+3)+","+(y1-5)].join(" ")); g.appendChild(hd);
          const t=svgEl("text","ctlg-wire-lab");
          t.setAttribute("x",x1); t.setAttribute("y",y1-CG_GY-2);
          t.textContent=blkWord(src,ALL[src])+" · "+segName(segOf(src));
          g.appendChild(t); sv.appendChild(g);
          return;
        }
        const a=L.pos[src];
        const x0=a.x+CG_NW/2, y0=a.y+CG_NH, x1=c.x+CG_NW*(i+1)/(n+1), y1=c.y;
        const ym=y1>y0 ? y1-CG_GY/2 : y0+CG_GY/2;
        const g=svgEl("g","ctlg-wire");
        const pl=svgEl("polyline"); pl.setAttribute("points",[x0+","+y0,x0+","+ym,x1+","+ym,x1+","+y1].join(" ")); g.appendChild(pl);
        const hd=svgEl("polygon","ctlg-head"); hd.setAttribute("points",[x1+","+y1,(x1-3)+","+(y1-5),(x1+3)+","+(y1-5)].join(" ")); g.appendChild(hd);
        /* a label per wire, nudged down off any label already at that spot -
           the same pricing the canvas did, on an estimate of the glyph width.
           MEASURED ON THE STRING sync() WILL ACTUALLY DRAW: the bench label is
           the unit and the control room's is the value, and pricing both as
           the value left the bench's labels overlapping at narrow widths. */
        const t=svgEl("text","ctlg-wire-lab"), lx=(x0+x1)/2;
        /* THE LABEL SITS AT THE END IT ARRIVES AT, in the lane immediately above
           the block that reads it - not at the middle of the wire. A wire from
           a source down to the second wrapped row of the next rank crosses a
           whole row of boxes, and its midpoint is inside one of them: the box
           is opaque and painted after the wires, so the label was simply gone.
           It also reads better there, beside the input it is feeding.
           The nudge may only move inside that lane, and where the lane is full
           it stops rather than stepping out of it. */
        const down=y1>y0;
        const laneBot=down ? y1-2 : Math.max(y0,y1)-2;
        const laneTop=down ? y1-CG_GY+CG_LAB_H : Math.min(y0,y1)+CG_LAB_H;
        let ly=clamp(ym-3, Math.min(laneTop,laneBot), laneBot);
        const wide=id=>(live ? String(blkSub(T,id,s)) : (blkLabel(s,id).u||"")).length*4.6;
        for(let k=0;k<10;k++){
          if(!placed.some(r=>Math.abs(r.x-lx)<(r.w+wide(src))/2+3 && Math.abs(r.y-ly)<CG_LAB_H)) break;
          if(ly+CG_LAB_H>laneBot) break;
          ly+=CG_LAB_H; }
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
      nm.textContent=blkWord(id,T[id]); el.append(nm,sub,spec);
      KIT.tip(el,blkTitle(T,id),blkTipBody(T,id,s));
      el.dataset.blk=id;
      MOUSE.on(el,{click(){ CTLV.sel = CTLV.sel===id ? null : id; }});
      root.appendChild(el); box[id]={el,nm,sub,spec};
      fitName(nm);   // AFTER it is on the page: an element out of the document measures 0 and fits anything
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
  const wireOff=()=>{ if(drag){ drag=null; root.classList.remove("wiring"); rubberDraw(); } };
  MOUSE.on(root,{
    down(e){
      if(e.button!==0) return;
      const st=e.target.closest&&e.target.closest(".ctlg-stud"); if(!st) return;
      e.preventDefault(); e.stopPropagation();
      const T=ctlTable(live); if(!T) return;
      const id=st.dataset.blk, slot=st.dataset.slot===undefined?null:+st.dataset.slot;
      // an input stud carries the wire already on it; an empty one starts a new wire
      const src = slot==null ? id : (T[id]&&T[id].in[slot]) || null;
      drag={src, from:id, slot, p:at(e)};
      if(slot!=null) ctlWire(live,id,slot,null);
      MOUSE.grab(root); root.classList.add("wiring");
    },
    move(e){ if(!drag) return; drag.p=at(e); rubberDraw(); },
    up(e){
      if(!drag) return;
      const d=drag; drag=null; root.classList.remove("wiring"); rubberDraw();
      const T=ctlTable(live); if(!T) return;
      const hit=hitOf(e);
      if(d.slot!=null && d.src==null && !hit) return;        // a cut is what an empty drop means, and it is already done
      if(!hit) return;
      if(d.slot!=null){                                      // dragging an input: whatever it lands on feeds it
        if(hit.blk!==d.from) ctlWire(live,d.from,d.slot,hit.blk);
        else if(d.src) ctlWire(live,d.from,d.slot,d.src);    // back where it started
        return;
      }
      if(hit.blk===d.src) return;                            // no block feeds itself
      const slot = hit.slot!=null ? hit.slot : slotFor(T,hit.blk,at(e).x);
      if(slot!=null) ctlWire(live,hit.blk,slot,d.src);
    },
    // the grab is dropped by the hub on the release; this is the drag that
    // never got one - the cabinet was rebuilt out from under the hand
    cancel:wireOff});
  function rubberDraw(){
    if(!rubber) return;
    if(!drag||!lastPos[drag.from]){ rubber.setAttribute("points",""); return; }
    const c=lastPos[drag.from];
    const x0 = drag.slot==null ? c.x+CG_NW/2 : c.x+CG_NW*(drag.slot+1)/((ctlTable(live)[drag.from].in.length)+1);
    const y0 = drag.slot==null ? c.y+CG_NH : c.y;
    rubber.setAttribute("points",[x0+","+y0, drag.p.x+","+drag.p.y].join(" "));
  }
  function sync(){
    const ALL=ctlTable(live), w=root.clientWidth;
    if(!ALL||w<=0){ if(sig!==null){ root.innerHTML=""; sig=null; box={}; runs=[]; rubber=null; } return; }
    // ONE SECTION AT A TIME. The whole cabinet is still what a wire may reach.
    const T=ctlSegTable(ALL);
    const s=live?S:null, nsig=ctlSeg()+"|"+shape(T,w);
    if(nsig!==sig){ sig=nsig; build(T,w,s,ALL); rubberDraw(); }
    root.classList.toggle("dead",!!(live&&!ctlLive(S)));
    for(const id in box){ const b=T[id], o=box[id];
      o.el.classList.toggle("sel",CTLV.sel===id);
      o.el.classList.toggle("off",!b.on);
      // a rename does not move a box, so the picture is not rebuilt for one - but the type has to be refitted to it
      { const nm=blkWord(id,b); if(o.nm.textContent!==nm){ o.nm.textContent=nm; fitName(o.nm); } }
      o.sub.textContent=blkSub(T,id,s);
      o.spec.textContent=blkSpec(b);
    }
    for(const r of runs){ const on=T[r.src].on&&T[r.dst].on;
      r.g.classList.toggle("off",!on);
      r.t.textContent = live ? blkSub(T,r.src,s) : (blkLabel(s,r.src).u||""); }
  }
  return {el:root, sync, pos:()=>lastPos};
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
  /* The box keeps its height whether or not a block is picked: an editor that
     grows and shrinks under the picture moves the picture out from under the
     hand. Empty, it says nothing - it used to stand a line of instructions
     open for ever, which is a sentence you read once and then look past for
     the rest of the game. The instruction is on the box, in its tooltip,
     where every other explanation in this project lives. */
  const hint=KIT.el("div","ctlg-hint");
  KIT.tip(hint,"BLOCK","Click a block in the picture to wire it, tune it, name it, move it to another section or switch it off.");
  root.appendChild(hint);
  const build=(id,b)=>{ root.innerHTML=""; P_={}; const m=BLK[b.mode];
    /* THE HEADING IS THE NAME FIELD, the same bargain dbNameWell() strikes on
       a machine: the derived name is the placeholder, so a blank box still
       reads as the block it is, and BLOCK n stays in the suffix where it
       cannot be typed over. A name is design data, so the bench writes it and
       the live cabinet only reads it. */
    const dflt=blkDflt(ctlTable(live)||{},id);
    const r=KIT.rule(dflt, live?null:{edit:{maxLength:NAME_CAP,onChange:v=>{ setPartName(id,v); dTouch(); }}});
    r.setSfx(blkNo(id)); if(!live) r.setVal(nameFor(id,""));
    KIT.tip(r.input||r.el, live?m.lab:"NAME",
      live?m.tip:"Type to name this block. Clear the box and it goes back to \""+dflt+"\". The name follows it onto the machine strip that says who owns the demand.");
    root.appendChild(r.el);
    /* THE SWITCH AND THE BIN STAND IN THE HEADING, beside the name they act on
       - as a row of their own they were two keys costing a line in a window
       232px wide. */
    const onB=KIT.button("ON",{flat:true,size:7,tip:"Whether this block computes. Off, its output holds and any sink under it lets go of its demand.",onClick:()=>ctlOn(live,id)});
    P_.on=onB; r.el.appendChild(onB.el);
    if(!live) r.el.appendChild(KIT.button("REMOVE",{flat:true,size:7,danger:true,tip:"Takes this block out of the cabinet and unwires everything that read it.",onClick:()=>{ removeBlock(id); CTLV.sel=null; }}).el);
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
    /* WHICH TAB THIS BLOCK IS DRAWN UNDER, and that is all it changes: moving a
       block cuts no wire and alters nothing it computes. Bench only, like every
       other design fact in this panel. */
    if(!live){ const sids=segIds().slice();
      P_.seg=ctlPick("SECTION",sids.map(segName),sids.indexOf(segOf(id)),
        i=>{ D.blocks[id].seg=sids[i]; CTLV.seg=sids[i]; dTouch(); });
      P_.segIds=sids; root.appendChild(ctlRow(null,P_.seg.el)); }
    if(OPS_OF[b.mode]){ const ops=OPS_OF[b.mode];
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
  /* NO HEIGHT FLOOR. It padded every editor to the tallest one this cabinet had
     shown, so that picking a block could not move the picture below it. The
     editor floats over the picture now and moves nothing, so the padding was
     only ever empty box under a short block's knobs. */
  function sync(){
    const T=ctlTable(live), id=CTLV.sel;
    if(!id||!T||!T[id]){ if(sig!==null){ root.innerHTML=""; root.appendChild(hint); sig=null; } return; }
    const b=T[id], nsig=id+"|"+b.mode+"|"+(b.sig||"")+"|"+(b.sink||"")+"|"+Object.keys(T).join(",")+"|"+live
      +"|"+(live?"":segIds().join(",")+segIds().map(segName).join(","));
    if(nsig!==sig){ sig=nsig; build(id,b); }
    P_.on.set({label:b.on?"ON":"OFF", on:!!b.on});
    if(P_.sig) P_.sig.set(P_.sigKeys.indexOf(b.sig));
    if(P_.sink) P_.sink.set(SINK_KEYS.indexOf(b.sink));
    if(P_.arg) P_.arg.set(P_.args.indexOf(b.arg));
    if(P_.op) P_.op.set(P_.ops.indexOf(b.op));
    if(P_.seg) P_.seg.set(P_.segIds.indexOf(segOf(id)));
    P_.ins.forEach((o,slot)=>o.pk.set(o.others.indexOf(b.in[slot])+1));
    for(const k in P_.num){ const v=b[k]; P_.num[k].set(v==null?null:v); if(BLK[b.mode].knobs[k]===null) P_.num[k].setAuto(v==null); }
  }
  return {el:root, sync};
}

/* ══ THE PANEL SECTION ══ the picture, and the editor beside it where the
   panel is wide enough to stand them side by side (CSS, .ctlg-cols). */
const CTLG=new Set();
/* ══ THE TABS ══ one per section, flat, the open one lit and underlined. The
   OPEN tab IS the name field on the bench: a tab is the section, so the place
   to type its name is the tab, not a heading above the row that says the same
   word twice. rule()'s `edit` strikes exactly this bargain for a machine's
   title bar; this is a text input for the same reason, in the same shape.
   The control room only turns the pages - a section is design data.
   NOTHING IS REBUILT WHEN A TAB IS CLICKED. The strip is built from the
   section LIST and from nothing else; opening a tab moves the one name field
   into it and toggles two classes. Rebuilding on the open tab tore down every
   element on every click, and the new field spent one frame empty, so the tab
   flashed to the width of its default name before the real one arrived. */
const segDflt = sid => SEG_LAB+" "+(segIds().indexOf(sid)+1);
function ctlTabsMk(live){
  const bar=KIT.el("div","ctlg-tabs"); let sig=null, tabs=[];
  /* ONE FIELD FOR THE WHOLE STRIP, made once and moved. Made per tab it would
     be destroyed and remade on every switch, which is a focus and a cursor
     position thrown away. */
  const inp = live ? null : KIT.textInput({bare:true, cls:"ctlg-tab-input", maxLength:NAME_CAP,
    onChange:v=>{ setPartName(ctlSeg(),v); dTouch(); }});
  if(inp) KIT.tip(inp.el,"SECTION NAME","Type to name this section. Clear the box and it goes back to its number. A section is a tab and nothing else: it decides which blocks are drawn together and never what any of them computes.");
  function build(){
    bar.innerHTML=""; tabs=[];
    /* THE TABS WRAP AMONG THEMSELVES; THE KEYS NEVER WRAP. In one flat wrapping
       row the spacer that pinned the keys right was itself wrappable, so a
       strip nearly full of tabs threw + and - onto a line of their own. The
       tabs get their own growing row and the keys stand beside it. */
    const list=KIT.el("div","ctlg-tabs-list"); bar.appendChild(list);
    for(const sid of segIds()){
      /* THE LABEL IS ALWAYS THE THING THAT HAS THE WIDTH. Open or shut, a tab
         is the same element holding the same span, and the field on the open
         one is laid OVER that span rather than in place of it. */
      const t=KIT.el("div","ctlg-tab",{role:"button",tabindex:"0"});
      const lab=KIT.el("span","ctlg-tab-lab"); lab.textContent=segName(sid);
      t.appendChild(lab);
      KIT.tip(t,segName(sid),"Show this section of the cabinet. A section is a named set of blocks and nothing else - it decides which tab a block is drawn under and never what it computes.");
      MOUSE.on(t,{click:()=>{ CTLV.seg=sid; CTLV.sel=null; }});
      list.appendChild(t); tabs.push({sid,el:t,lab});
    }
    /* ADD AND DROP A SECTION, at the right edge of the strip and outside the
       row that wraps. They are one glyph each because they are not tabs and
       must not read as one more page to turn; what they do is in the tooltip,
       where every other explanation on this panel lives. */
    if(!live){
      const key=(label,tip,fn)=>{ const k=KIT.button(label,{flat:true,size:7,tip,onClick:fn});
        k.el.classList.add("ctlg-tab-key"); bar.appendChild(k.el); };
      key("+","ADD A SECTION - a new, empty tab. Blocks you add land in whichever section is open, and a block already placed is moved with the SECTION key in its own panel.",
        ()=>{ CTLV.seg=segMint(); CTLV.sel=null; });
      key("-","DROP THE OPEN SECTION - its blocks are NOT deleted. They come home to the first section with their wiring untouched. The last section cannot be dropped.",
        ()=>{ if(segRemove(ctlSeg())){ CTLV.seg=null; CTLV.sel=null; } });
    }
  }
  let lastOpen=null;
  return {el:bar, sync(){
    const nsig=segIds().join(",")+"|"+live;
    if(nsig!==sig){ sig=nsig; build(); }
    const open=ctlSeg();
    /* THE FIELD LETS GO WHEN THE SECTION UNDER IT CHANGES. set() refuses to
       write a focused box - which is what stops a sync overwriting what is
       being typed - so a field still holding focus would keep the old
       section's name and rename the NEW section with it on the next key. */
    if(inp && lastOpen!==open){
      if(document.activeElement===inp.input) inp.input.blur();
      lastOpen=open;
    }
    /* AND IT IS FILLED BEFORE IT IS READ. Read first and it answers with an
       empty string on the frame it lands in, and the label takes the default
       name's width for one frame - the flash. */
    if(inp){ inp.set(nameFor(open,"")); inp.setPlaceholder(segDflt(open)); }
    for(const r of tabs){
      const on=r.sid===open;
      r.el.classList.toggle("on",on);
      r.el.classList.toggle("edit",on&&!!inp);
      if(on&&inp&&inp.el.parentNode!==r.el) r.el.appendChild(inp.el);
      const nm = (on&&inp) ? (inp.get()||segDflt(r.sid)) : segName(r.sid);
      if(r.lab.textContent!==nm) r.lab.textContent=nm;
    }
  }};
}
function ctlGraphMk(live){
  const root=KIT.el("div","ctlg");
  /* NO HEADING HERE. The panel that hosts this section already draws one -
     AUTOMATION, on the bench and in the control room alike - and this drew a
     second one directly under it saying the same word. */
  const tabs=ctlTabsMk(live); root.appendChild(tabs.el);
  const cols=KIT.el("div","ctlg-cols");
  const pic=ctlPicMk(live);
  cols.append(pic.el); root.appendChild(cols);
  /* ══ ADD BLOCK FLOATS OVER THE PICTURE ══ as a row of its own it cost the
     panel a whole line of height for one key, and the cabinet is the tallest
     section on the bench already. It hangs off `cols`, not off the picture,
     because the picture wipes its own contents on every rebuild. Adding and
     dropping a SECTION belongs to the tab strip and lives there. */
  if(!live){ const keys=KIT.el("div","ctlg-keys");
    const mk=KIT.menuKey({label:"ADD",cls:"ctlg-add",tip:"ADD A BLOCK, in the section that is open. Pick its kind; wire it from its own row after."});
    const ol=KIT.optList(BLK_MODES.map(k=>({name:BLK[k].lab,tip:BLK[k].tip})),{onSelect:i=>{ CTLV.sel=mintBlock(BLK_MODES[i],ctlSeg()); KIT.show(mk.menu,false); mk.key.set({on:false}); }});
    mk.menu.appendChild(ol.el); keys.appendChild(mk.el);
    cols.appendChild(keys); }
  /* ══ THE EDITOR IS A WINDOW ON THE BLOCK, NOT A COLUMN BESIDE THE PICTURE ══
     It stood in its own column under the drawing, so the block being edited
     and the box you edited it in were at opposite ends of a tall panel and the
     eye had to carry the name between them. It opens at the block instead, to
     its right where the picture has room and to its left where it has not, and
     it is not there at all while nothing is picked. */
  const ed=ctlEditorMk(live); ed.el.classList.add("ctlg-ed-win"); cols.appendChild(ed.el);
  function edPlace(){
    const p=CTLV.sel && pic.pos()[CTLV.sel];
    KIT.show(ed.el, !!p); if(!p) return;
    const W=pic.el.clientWidth, H=pic.el.clientHeight;
    const w=ed.el.offsetWidth||230, h=ed.el.offsetHeight||120;
    let x=p.x+CG_NW+8; if(x+w>W) x=p.x-w-8;
    ed.el.style.left=clamp(x,0,Math.max(0,W-w))+"px";
    ed.el.style.top =clamp(p.y,0,Math.max(0,H-h))+"px";
  }
  const g={el:root, live, sync(){ tabs.sync(); pic.sync(); ed.sync(); edPlace(); }};
  CTLG.add(g); return g;
}
/* the bench's frame: sync every section still on the page */
function ctlGraphTick(){
  for(const g of CTLG){ if(!g.el.isConnected){ CTLG.delete(g); continue; } if(g.live) continue; g.sync(); }
}
const CTLGRAPH_LIVE=[{kind:"ctlgraph",title:"AUTOMATION",live:true,
  tip:"Every block in this cabinet, one section to a tab, sources at the top and the demands they drive at the bottom. A wire says what it carries. Hover a block to read it, click it to wire it, tune it or switch it off."}];
