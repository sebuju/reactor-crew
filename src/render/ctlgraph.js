"use strict";
// seq counts size changes, so the panel holding a picture knows to measure itself again
const CTLV={sel:null, hov:null, hovT:0, hovOn:false, seq:0, seg:null};
// the pointer has to PARK on a block before the picture dims
const CG_HOV_MS=400;
// a section deleted under the selection falls back to the first, so this can never name nothing
const ctlSeg = () => { const a=segIds(); return a.includes(CTLV.seg) ? CTLV.seg : a[0]; };
const ctlSegTable = T => { const sid=ctlSeg(), o={};
  for(const id in T) if(segOf(id)===sid) o[id]=T[id];
  return o; };
// CG_GY is a LANE the wire labels are drawn in, not a gap; CG_ROWGAP has to clear a stud AND a label
const CG_NW=164, CG_NH=58, CG_GX=36, CG_GY=44, CG_PAD=24, CG_ROWGAP=40, CG_ROW=CG_NH+CG_ROWGAP;
// CG_COMPW is the narrowest a whole controller may be drawn in
const CG_COMPW=2*CG_NW+CG_GX, CG_COLGAP=14, CG_STUD=9;
// the label's LINE, not its type size: a 3px halo makes its box taller than its glyphs
const CG_LAB_H=12;

const ctlTable = live => live ? (S&&S.blkBy)||null : D.blocks;

// a block sits one row above the nearest block that READS it; longest path only orders the work
function ctlRanks(T){
  const ids=Object.keys(T), deep={}, deg={}, kids={};
  for(const id of ids){ deg[id]=0; kids[id]=[]; deep[id]=0; }
  for(const id of ids) for(const src of T[id].in) if(src&&T[src]){ deg[id]++; kids[src].push(id); }
  const q=ids.filter(id=>deg[id]===0); let top=0;
  while(q.length){ const id=q.shift(); top=Math.max(top,deep[id]);
    for(const k of kids[id]){ deep[k]=Math.max(deep[k],deep[id]+1); if(--deg[k]===0) q.push(k); } }
  for(const id of ids) if(deg[id]>0) deep[id]=top+1;
  const rank={};
  for(const id of ids.slice().sort((a,b)=>deep[b]-deep[a])){
    let r=null;
    for(const k of kids[id]) if(rank[k]!=null) r = r==null ? rank[k]-1 : Math.min(r,rank[k]-1);
    rank[id] = r==null ? top : r;
  }
  const lo=Math.min(...ids.map(id=>rank[id]));
  for(const id of ids) rank[id]-=lo;
  return rank;
}
const blkNum=id=>+String(id).replace(/\D/g,"")||0;
// one connected graph at a time: a rod loop and a feed loop share a cabinet, not a picture
function ctlComponents(T){
  const root={}, find=id=>{ while(root[id]!==id) id=root[id]=root[root[id]]; return id; };
  for(const id in T) root[id]=id;
  for(const id in T) for(const src of T[id].in) if(src&&T[src]) root[find(src)]=find(id);
  const by={}; for(const id in T) (by[find(id)]||(by[find(id)]=[])).push(id);
  return Object.values(by).sort((a,b)=>Math.min(...a.map(blkNum))-Math.min(...b.map(blkNum)));
}
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
function ctlLayout(T,w,ALL){
  ALL=ALL||T;
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
  const st=ctlStubs(T,ALL,pos,w);
  if(st.head){ for(const id in pos) pos[id].y+=st.head;
    for(let i=0;i<seams.length;i++) seams[i]+=st.head; }
  return {pos, seams, stubs:st.list, stubBand:st.band||0,
          h:Math.max(CG_NH+2*CG_PAD, y+band+CG_PAD)+st.head};
}
// a wire from another section leaves a CHIP in a band along the top, standing in for the block that feeds it
const CG_LAB_ALLEY=8;                  // the gap under a lane of words, for a wire to walk along
const CG_LAB_ROW=CG_LAB_H+CG_LAB_ALLEY, CG_LAB_G=3;
const stubLaneY=L=>CG_PAD+L*CG_LAB_ROW+CG_LAB_H;      // the baseline of lane L; the alley is under it
function ctlStubs(T,ALL,pos,w){
  const list=[];
  for(const id in T){ const b=T[id], c=pos[id]; if(!c) continue;
    const n=b.in.length;
    b.in.forEach((src,i)=>{ if(!src||T[src]||!ALL[src]) return;
      const word=blkWord(src,ALL[src]), lw=word.length*4.6+6;
      list.push({key:id+"<"+i, dst:id, src, slot:i, word, w:lw,
        x:clamp(c.x+CG_NW*(i+1)/(n+1), CG_PAD+lw/2, Math.max(CG_PAD+lw/2, w-CG_PAD-lw/2))}); }); }
  if(!list.length) return {list, head:0};
  list.sort((a,b)=>a.x-b.x);
  const ends=[];                       // the right edge of the last chip in each lane
  for(const s of list){
    let L=0; while(ends[L]!=null && ends[L] > s.x-s.w/2) L++;
    ends[L]=s.x+s.w/2; s.lane=L; s.y=stubLaneY(L);
  }
  const band=CG_PAD+ends.length*CG_LAB_ROW;
  for(const s of list) s.path=stubPath(s,list,ends.length,band,w);
  return {list, band, head:ends.length*CG_LAB_ROW+CG_GY};
}
// walked lane by lane: no room in a lane of text for the router to find its own way
function stubPath(s,list,lanes,band,w){
  const pts=[[s.x,s.y]]; let x=s.x;
  for(let L=s.lane+1; L<lanes; L++){
    const alley=CG_PAD+L*CG_LAB_ROW-CG_LAB_ALLEY/2;
    for(let k=0;k<10;k++){
      const c=list.find(p=>p.lane===L && Math.abs(p.x-x)<p.w/2+CG_LAB_G);
      if(!c) break;
      const l=c.x-c.w/2-CG_LAB_G-1, r=c.x+c.w/2+CG_LAB_G+1;
      const nx=(x-l<=r-x && l>=CG_PAD) || r>w-CG_PAD ? l : r;
      pts.push([x,alley],[nx,alley]); x=nx;
    }
  }
  pts.push([x,band]);
  return pts;
}
function labSpot(placed,x,w,bot,top){
  let y=bot;
  for(let k=0;k<10;k++){
    if(!placed.some(r=>Math.abs(r.x-x)<(r.w+w)/2+3 && Math.abs(r.y-y)<CG_LAB_H)) break;
    if(y-CG_LAB_H<top) break;
    y-=CG_LAB_H; }
  placed.push({x,y,w}); return y;
}
// opts.config assigns into the router's shared C, so only the keys ui/margin.js also passes may appear here
const CG_ROUTE_C={clearance:12, bendCost:40, laneGap:2, nodeHalo:4, haloCost:0};
// gates, not faces: a wire leaves and arrives downwards, so it lands on the stud it is wired to
function ctlRoutes(T,L,w){
  const nodes=[], edges=[];
  // the picture's own edges are walls - the SVG does not clip, and a free outside is a cheap detour
  const M=24;
  nodes.push({id:"wall:l", x:-M, y:-M, w:M, h:L.h+2*M},
             {id:"wall:r", x:w,  y:-M, w:M, h:L.h+2*M},
             // the chip band is part of the top wall: no wire may be let into a lane of words
             {id:"wall:t", x:-M, y:-M, w:w+2*M, h:M+(L.stubBand||0)},
             {id:"wall:b", x:-M, y:L.h, w:w+2*M, h:M});
  for(const id in L.pos){ const c=L.pos[id]; nodes.push({id, x:c.x, y:c.y, w:CG_NW, h:CG_NH}); }
  // every wire a block feeds leaves by its own point on the bottom edge, or six readers send six wires down one line
  const outs={}, sent={};
  for(const id in T) for(const s of T[id].in) if(s&&L.pos[s]) (outs[s]||(outs[s]=[])).push(id);
  for(const id in T){ const b=T[id], c=L.pos[id]; if(!c) continue;
    const n=b.in.length;
    b.in.forEach((src,i)=>{ const a=src&&L.pos[src]; if(!a) return;
      const k=outs[src].length, j=(sent[src]=(sent[src]||0)+1)-1;
      edges.push({key:id+"<"+i, from:src, to:id,
        fromGate:{pt:[a.x+CG_NW*(j+1)/(k+1), a.y+CG_NH], dir:"S", face:"B"},
        toGate:{pt:[c.x+CG_NW*(i+1)/(n+1), c.y], dir:"S", face:"T"}}); });
  }
  // a chip is where a wire STARTS: the routed part begins under the band, at the chip's own x
  for(const st of (L.stubs||[])){ const c=L.pos[st.dst], n=T[st.dst].in.length;
    edges.push({key:"x:"+st.key, from:"wall:t", to:st.dst,
      fromGate:{pt:[st.path[st.path.length-1][0], L.stubBand], dir:"S", face:"B"},
      toGate:{pt:[c.x+CG_NW*(st.slot+1)/(n+1), c.y], dir:"S", face:"T"}}); }
  return edges.length ? ROUTE.routeGraph(nodes,[],edges,{config:CG_ROUTE_C}) : new Map();
}
// the colour a box and every wire off it wears
const CGCAT={read:["source","const"], math:["math","sel"],
             time:["pid","integ","lag","limit"], logic:["compare","latch"], drive:["sink"]};
const CGCAT_OF={}; for(const k in CGCAT) for(const m of CGCAT[k]) CGCAT_OF[m]=k;
const blkCat=b=>"cat-"+(CGCAT_OF[b.mode]||"math");
const ctlFmt=(v,u)=>{ if(v==null||!isFinite(v)) return "—";
  const a=Math.abs(v), s=a>=100?v.toFixed(0):a>=10?v.toFixed(1):a>=1?v.toFixed(2):v.toFixed(3);
  return u?s+" "+u:s; };
function blkName(b){
  if(b.mode==="source"){ const r=SIGNAL[b.sig]; return r?r.lab:b.sig; }
  if(b.mode==="sink"){ const r=SINK[b.sink]; return r?r.lab:b.sink; }
  if(b.mode==="math"||b.mode==="sel") return b.op.toUpperCase();
  return BLK[b.mode]?BLK[b.mode].lab:b.mode;
}
const blkArgName=b=>{ if(b.arg==null) return ""; const p=partOf(b.arg); return p?partName(p):String(b.arg).toUpperCase(); };
const blkNo=id=>"BLOCK "+blkNum(id);
// nameFor() is the same door a machine's name comes through, so a block rides designSig() and the save format free
const blkWord=(id,b)=>nameFor(id, blkName(b));
// only ever smaller, and asked only when the text CHANGES: ninety boxes measuring themselves is a forced layout
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
// never its value: a tooltip is built at pointerover and would sit there going stale
function blkTipBody(T,id,s){ const b=T[id], m=BLK[b.mode], note=noteFor(id), L=note?[note,m.tip]:[m.tip];
  const arg=blkArgName(b); if(arg) L.push("OF: "+arg);
  const u=blkLabel(s,id).u; if(u) L.push("PUTS OUT: "+u);
  if(m.ins.length) L.push(m.ins.map((nm,i)=>nm+": "+(b.in[i]&&T[b.in[i]]?blkTitle(T,b.in[i]):"nothing wired")).join("\n"));
  if(!b.on) L.push("[ OFF - output held, any sink under it lets go ]");
  return L.join("\n\n"); }

// HTML, not a canvas: a block is a button, so it carries its own tooltip, hover and focus; the wires are one SVG behind
const SVGNS="http://www.w3.org/2000/svg";
const svgEl=(n,cls)=>{ const e=document.createElementNS(SVGNS,n); if(cls) e.setAttribute("class",cls); return e; };
const blkSub=(T,id,s)=>{ const b=T[id];
  return s ? ctlFmt(b.out,blkLabel(s,id).u) : b.mode==="const" ? ctlFmt(b.v,"") : blkArgName(b)||blkNo(id); };
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
  // on the picture, not the page: a document handler would close the editor on every press anywhere on the ship
  MOUSE.on(root,{click(e){
    if(e.target.closest(".ctlg-blk,.ctlg-stud,.ctlg-ed-win")) return;
    CTLV.sel=null;
  }});
  let sig=null, box={}, runs=[], xruns=[], lastPos={}, rubber=null, drag=null;
  // the cabinet's shape and nothing that moves inside it: a value changing must never cost a rebuild
  const shape=(T,w)=>{ const a=[live?1:0,Math.round(w/8)];
    for(const id in T){ const b=T[id]; a.push(id,b.mode,b.sig||"",b.sink||"",b.arg==null?"":b.arg,b.op||"",b.in.join(">")); }
    return a.join("|"); };
  const build=(T,w,s,ALL)=>{
    ALL=ALL||T;
    root.innerHTML=""; box={}; runs=[]; xruns=[];
    const L=ctlLayout(T,w,ALL); lastPos=L.pos;
    const SB=new Map((L.stubs||[]).map(st=>[st.key,st]));
    if(root.style.height!==L.h+"px"){ root.style.height=L.h+"px"; CTLV.seq++; }
    const sv=svgEl("svg","ctlg-wires");
    sv.setAttribute("width",w); sv.setAttribute("height",L.h);
    sv.setAttribute("viewBox","0 0 "+w+" "+L.h);
    root.appendChild(sv);
    for(const sy of L.seams){ const ln=svgEl("line","ctlg-seam");
      ln.setAttribute("x1",CG_PAD); ln.setAttribute("x2",w-CG_PAD); ln.setAttribute("y1",sy); ln.setAttribute("y2",sy); sv.appendChild(ln); }
    // the band's words are painted after every wire: a halo only reads on top of the lines
    const RT=ctlRoutes(T,L,w), placed=[], labs=svgEl("g","ctlg-xseg");
    for(const id in T){ const b=T[id], c=L.pos[id];
      b.in.forEach((src,i)=>{ if(!src||!ALL[src]) return;
        const n=b.in.length;
        if(!T[src]||!L.pos[src]){
          const st=SB.get(id+"<"+i); if(!st) return;
          const x1=c.x+CG_NW*(i+1)/(n+1), y1=c.y, g=svgEl("g","ctlg-wire ctlg-xseg "+blkCat(ALL[src]));
          const rt=RT.get("x:"+st.key), bx=st.path[st.path.length-1][0];
          const pts=st.path.concat((rt&&rt.pts&&rt.pts.length>=2) ? rt.pts
            : [[bx,y1-CG_GY/2],[x1,y1-CG_GY/2],[x1,y1]]);
          const pl=svgEl("polyline"); pl.setAttribute("points",pts.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ")); g.appendChild(pl);
          const hd=svgEl("polygon","ctlg-head"); hd.setAttribute("points",[x1+","+y1,(x1-3)+","+(y1-5),(x1+3)+","+(y1-5)].join(" ")); g.appendChild(hd);
          const t=svgEl("text","ctlg-wire-lab");
          t.textContent=st.word;
          KIT.tip(t, st.word, "Wired from "+segName(segOf(src))+". Open that tab to see the block itself.");
          t.setAttribute("x",st.x); t.setAttribute("y",st.y-2);
          labs.appendChild(t); sv.appendChild(g);
          xruns.push({g,t,dst:id});
          return;
        }
        const a=L.pos[src];
        const x1=c.x+CG_NW*(i+1)/(n+1), y1=c.y;
        // the elbow is the fallback: a route the router declined still has to land on its stud
        const rt=RT.get(id+"<"+i);
        const pts=(rt&&rt.pts&&rt.pts.length>=2) ? rt.pts
          : [[a.x+CG_NW/2,a.y+CG_NH],[a.x+CG_NW/2,y1-CG_GY/2],[x1,y1-CG_GY/2],[x1,y1]];
        const g=svgEl("g","ctlg-wire "+blkCat(T[src]));
        const pl=svgEl("polyline"); pl.setAttribute("points",pts.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ")); g.appendChild(pl);
        const hd=svgEl("polygon","ctlg-head"); hd.setAttribute("points",[x1+","+y1,(x1-3)+","+(y1-5),(x1+3)+","+(y1-5)].join(" ")); g.appendChild(hd);
        const t=svgEl("text","ctlg-wire-lab");
        // priced on the string sync() will draw: the bench says the unit, the control room the value
        const wide=(live ? String(blkSub(T,src,s)) : (blkLabel(s,src).u||"")).length*4.6;
        t.setAttribute("x",x1); t.setAttribute("y",labSpot(placed,x1,wide,y1-3,y1-CG_GY+CG_LAB_H)); g.appendChild(t);
        sv.appendChild(g);
        runs.push({g,t,src,dst:id});
      });
    }
    if(labs.childNodes.length) sv.appendChild(labs);
    for(const id in T){ const c=L.pos[id];
      const el=KIT.el("button","ctlg-blk"); el.type="button";
      el.style.left=c.x+"px"; el.style.top=c.y+"px";
      el.style.width=CG_NW+"px"; el.style.height=CG_NH+"px";
      el.classList.add(blkCat(T[id]));
      const nm=KIT.el("span","ctlg-blk-name"), sub=KIT.el("span","ctlg-blk-sub"), spec=KIT.el("span","ctlg-blk-spec");
      nm.textContent=blkWord(id,T[id]); el.append(nm,sub,spec);
      KIT.tip(el,blkTitle(T,id),blkTipBody(T,id,s));
      el.dataset.blk=id;
      MOUSE.on(el,{click(){ CTLV.sel = CTLV.sel===id ? null : id; },
        enter(){ CTLV.hov=id; CTLV.hovT=performance.now(); },
        // hovOn is left standing: leave fires before the next enter, so block to block switches without re-arming
        leave(){ if(CTLV.hov===id) CTLV.hov=null; }});
      root.appendChild(el); box[id]={el,nm,sub,spec};
      fitName(nm);   // AFTER it is on the page: an element out of the document measures 0 and fits anything
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
  // pointer capture, so a drag that wanders over the plant still ends here and the panel never takes it for a pan
  const at=e=>{ const r=root.getBoundingClientRect(), k=(r.width/Math.max(1,root.offsetWidth))||1;
    return {x:(e.clientX-r.left)/k, y:(e.clientY-r.top)/k}; };
  const hitOf=e=>{ const el=document.elementFromPoint(e.clientX,e.clientY);
    const st=el&&el.closest&&el.closest(".ctlg-stud"); if(st&&root.contains(st)) return {blk:st.dataset.blk, slot:st.dataset.slot===undefined?null:+st.dataset.slot};
    const bk=el&&el.closest&&el.closest(".ctlg-blk"); if(bk&&root.contains(bk)) return {blk:bk.dataset.blk, slot:null};
    return null; };
  // a drop on a block's body takes the first free slot, else the stud the hand came down nearest
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
      if(d.slot!=null){
        if(hit.blk!==d.from) ctlWire(live,d.from,d.slot,hit.blk);
        else if(d.src) ctlWire(live,d.from,d.slot,d.src);
        return;
      }
      if(hit.blk===d.src) return;
      const slot = hit.slot!=null ? hit.slot : slotFor(T,hit.blk,at(e).x);
      if(slot!=null) ctlWire(live,hit.blk,slot,d.src);
    },
    // the drag that never got a release: the cabinet was rebuilt under the hand
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
    if(!ALL||w<=0){ if(sig!==null){ root.innerHTML=""; sig=null; box={}; runs=[]; xruns=[]; rubber=null; } return; }
    // one section drawn at a time; the whole cabinet is still what a wire may reach
    const T=ctlSegTable(ALL);
    const s=live?S:null, nsig=ctlSeg()+"|"+shape(T,w);
    if(nsig!==sig){ sig=nsig; build(T,w,s,ALL); rubberDraw(); }
    root.classList.toggle("dead",!!(live&&!ctlLive(S)));
    if(!CTLV.hov) CTLV.hovOn=false;
    else if(!CTLV.hovOn && performance.now()-CTLV.hovT>=CG_HOV_MS) CTLV.hovOn=true;
    // a pick outlives the pointer, so it wins over the hover
    const foc = CTLV.sel && T[CTLV.sel] ? CTLV.sel
              : (CTLV.hovOn && T[CTLV.hov] ? CTLV.hov : null);
    const near = foc ? new Set([foc]) : null;
    if(near){ for(const src of T[foc].in) if(src) near.add(src);
      for(const id in T) if(T[id].in.includes(foc)) near.add(id); }
    for(const id in box){ const b=T[id], o=box[id];
      o.el.classList.toggle("sel",CTLV.sel===id);
      o.el.classList.toggle("dim",!!near&&!near.has(id));
      o.el.classList.toggle("off",!b.on);
      // a rename does not move a box, so no rebuild, but the type has to be refitted to it
      { const nm=blkWord(id,b); if(o.nm.textContent!==nm){ o.nm.textContent=nm; fitName(o.nm); } }
      o.sub.textContent=blkSub(T,id,s);
      o.spec.textContent=blkSpec(b);
    }
    for(const r of runs){ const on=T[r.src].on&&T[r.dst].on;
      r.g.classList.toggle("off",!on);
      r.g.classList.toggle("dim",!!foc&&r.src!==foc&&r.dst!==foc);
      r.t.textContent = live ? blkSub(T,r.src,s) : (blkLabel(s,r.src).u||""); }
    // the word sits in the layer over every wire, not in the wire's own group, so it dims on its own
    for(const x of xruns){ const d=!!foc&&x.dst!==foc;
      x.g.classList.toggle("dim",d); x.t.classList.toggle("dim",d); }
  }
  return {el:root, sync, pos:()=>lastPos};
}

// one pair of doors, so the bench and the control room cannot disagree about what a knob change does
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

const ctlRow=(lab,...els)=>{ const r=KIT.el("div","ctlg-row"); if(lab){ const l=KIT.el("span","ctlg-lab"); l.textContent=lab; r.appendChild(l); } for(const e of els) r.appendChild(e); return r; };
function ctlPick(label,items,cur,onPick,tips,clss){
  const mk=KIT.menuKey({label:label+": "+(items[cur]||"—")});
  const ol=KIT.optList(items.map((n,i)=>({name:n,tip:tips?tips[i]:"",cls:clss?clss[i]:""})),{onSelect:i=>{ onPick(i); KIT.show(mk.menu,false); mk.key.set({on:false}); }});
  mk.menu.appendChild(ol.el); ol.set(cur);
  return {el:mk.el, set:(i,its)=>{ ol.set(i); mk.key.set({label:label+": "+((its||items)[i]||"—")}); }};
}
function ctlEditorMk(live){
  const root=KIT.el("div","ctlg-ed"); let sig=null, P_={};
  const hint=KIT.el("div","ctlg-hint");
  KIT.tip(hint,"BLOCK","Click a block in the picture to wire it, tune it, name it, move it to another section or switch it off.");
  root.appendChild(hint);
  const build=(id,b)=>{ root.innerHTML=""; P_={}; const m=BLK[b.mode];
    // the derived name is the PLACEHOLDER, so a blank box still reads as the block it is
    const dflt=blkDflt(ctlTable(live)||{},id);
    const r=KIT.rule(dflt, live?null:{edit:{maxLength:NAME_CAP,onChange:v=>{ setPartName(id,v); dTouch(); }}});
    r.setSfx(blkNo(id)); if(!live) r.setVal(nameFor(id,""));
    KIT.tip(r.input||r.el, live?m.lab:"NAME",
      live?m.tip:"Type to name this block. Clear the box and it goes back to \""+dflt+"\". The name follows it onto the machine strip that says who owns the demand.");
    root.appendChild(r.el);
    const onB=KIT.button("ON",{flat:true,size:7,tip:"Whether this block computes. Off, its output holds and any sink under it lets go of its demand.",onClick:()=>ctlOn(live,id)});
    P_.on=onB; r.el.appendChild(onB.el);
    if(!live) r.el.appendChild(KIT.button("REMOVE",{flat:true,size:7,danger:true,tip:"Takes this block out of the cabinet and unwires everything that read it.",onClick:()=>{ removeBlock(id); CTLV.sel=null; }}).el);
    if(!live){ const mp=ctlPick("KIND",BLK_MODES.map(k=>BLK[k].lab),BLK_MODES.indexOf(b.mode),i=>{ setBlockMode(id,BLK_MODES[i]); },BLK_MODES.map(k=>BLK[k].tip),BLK_MODES.map(k=>blkCat({mode:k}))); root.appendChild(ctlRow(null,mp.el)); }
    if(!live){ P_.note=KIT.textInput({multiline:true, rows:2, cls:"ctlg-note-input", maxLength:NOTE_CAP,
        placeholder:"why this block is here", title:"NOTE",
        tip:"A note on this block, in your own words. It is read back on the box's own tooltip.",
        onChange:v=>{ setNote(id,v); dTouch(); }});
      P_.note.set(noteFor(id)); root.appendChild(ctlRow(null,P_.note.el)); }
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
    // which tab it is drawn under, and that is all it changes: moving a block cuts no wire
    if(!live){ const sids=segIds().slice();
      P_.seg=ctlPick("SECTION",sids.map(segName),sids.indexOf(segOf(id)),
        i=>{ D.blocks[id].seg=sids[i]; CTLV.seg=sids[i]; dTouch(); });
      P_.segIds=sids; root.appendChild(ctlRow(null,P_.seg.el)); }
    if(OPS_OF[b.mode]){ const ops=OPS_OF[b.mode];
      P_.op=ctlPick("OP",ops.map(o=>o.toUpperCase()),ops.indexOf(b.op),i=>ctlWrite(live,id,"op",ops[i])); P_.ops=ops;
      root.appendChild(ctlRow(null,P_.op.el)); }
    const T=ctlTable(live), others=Object.keys(T).filter(k=>k!==id).sort((p,q)=>blkNum(p)-blkNum(q));
    P_.ins=m.ins.map((nm,slot)=>{ const names=["NOTHING"].concat(others.map(o=>blkTitle(T,o)));
      const pk=ctlPick(nm,names,others.indexOf(b.in[slot])+1,i=>ctlWire(live,id,slot,i?others[i-1]:null));
      root.appendChild(ctlRow(null,pk.el)); return {pk,others}; });
    P_.num={};
    const kb=KIT.el("div","ctlg-knobs");
    for(const k in m.knobs){ if(k==="sig"||k==="sink"||k==="arg"||k==="op") continue;
      // a knob that ships null may be blank: no limit, or the plant's own tune
      const sug=m.sug&&m.sug[k], nullable=m.knobs[k]===null;
      const n=KIT.numInput({dp:3,title:k.toUpperCase(),tip:(m.ktip&&m.ktip[k])||m.tip,
        auto:nullable?{get:()=>b[k]==null, set:on=>{ ctlWrite(live,id,k,on?null:(sug?sug():0)); }}:null,
        onChange:v=>ctlWrite(live,id,k,v)});
      P_.num[k]=n; kb.appendChild(ctlRow(k.toUpperCase(),n.el)); }
    if(kb.children.length) root.appendChild(kb);
  };
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
    if(P_.note) P_.note.set(noteFor(id));
    P_.ins.forEach((o,slot)=>o.pk.set(o.others.indexOf(b.in[slot])+1));
    for(const k in P_.num){ const v=b[k]; P_.num[k].set(v==null?null:v); if(BLK[b.mode].knobs[k]===null) P_.num[k].setAuto(v==null); }
  }
  return {el:root, sync};
}

const CTLG=new Set();
// built from the section LIST alone: opening a tab moves one field, never a rebuild
const segDflt = sid => SEG_LAB+" "+(segIds().indexOf(sid)+1);
function ctlTabsMk(live){
  const bar=KIT.el("div","ctlg-tabs"); let sig=null, tabs=[];
  // one field for the whole strip, made once and moved: made per tab, a switch throws away focus and cursor
  const inp = live ? null : KIT.textInput({bare:true, cls:"ctlg-tab-input", maxLength:NAME_CAP,
    onChange:v=>{ setPartName(ctlSeg(),v); dTouch(); }});
  if(inp) KIT.tip(inp.el,"SECTION NAME","Type to name this section. Clear the box and it goes back to its number. A section is a tab and nothing else: it decides which blocks are drawn together and never what any of them computes.");
  function build(){
    bar.innerHTML=""; tabs=[];
    // the tabs get their own growing row so the keys beside it can never wrap onto a line of their own
    const list=KIT.el("div","ctlg-tabs-list"); bar.appendChild(list);
    for(const sid of segIds()){
      // the label always carries the width; the field on the open tab is laid OVER that span, not in place of it
      const t=KIT.el("div","ctlg-tab",{role:"button",tabindex:"0"});
      const lab=KIT.el("span","ctlg-tab-lab"); lab.textContent=segName(sid);
      t.appendChild(lab);
      KIT.tip(t,segName(sid),"Show this section of the cabinet. A section is a named set of blocks and nothing else - it decides which tab a block is drawn under and never what it computes.");
      MOUSE.on(t,{click:()=>{ CTLV.seg=sid; CTLV.sel=null; }});
      list.appendChild(t); tabs.push({sid,el:t,lab});
    }
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
    // the field lets go when the section changes: set() refuses a focused box, so it would rename the NEW section
    if(inp && lastOpen!==open){
      if(document.activeElement===inp.input) inp.input.blur();
      lastOpen=open;
    }
    // filled before it is read, or the label takes the default name's width for one frame
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
  const tabs=ctlTabsMk(live); root.appendChild(tabs.el);
  const note = live ? KIT.el("div","ctlg-seg-note")
    : KIT.textInput({multiline:true, rows:2, cls:"ctlg-seg-note", maxLength:NOTE_CAP,
        placeholder:"what this section is for", title:"SECTION NOTE",
        tip:"A note on this section, in your own words. The control room reads it back.",
        onChange:v=>{ setNote(ctlSeg(),v); dTouch(); }});
  root.appendChild(live?note:note.el);
  const noteSync=()=>{ const t=noteFor(ctlSeg());
    if(live){ KIT.show(note,!!t); if(note.textContent!==t) note.textContent=t; }
    else note.set(t); };
  const cols=KIT.el("div","ctlg-cols");
  const pic=ctlPicMk(live);
  cols.append(pic.el); root.appendChild(cols);
  // hangs off `cols`, not the picture, because the picture wipes its own contents on every rebuild
  if(!live){ const keys=KIT.el("div","ctlg-keys");
    const mk=KIT.menuKey({label:"ADD",cls:"ctlg-add",tip:"ADD A BLOCK, in the section that is open. Pick its kind; wire it from its own row after."});
    const ol=KIT.optList(BLK_MODES.map(k=>({name:BLK[k].lab,tip:BLK[k].tip,cls:blkCat({mode:k})})),{onSelect:i=>{ CTLV.sel=mintBlock(BLK_MODES[i],ctlSeg()); KIT.show(mk.menu,false); mk.key.set({on:false}); }});
    mk.menu.appendChild(ol.el); keys.appendChild(mk.el);
    cols.appendChild(keys); }
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
  const g={el:root, live, sync(){ tabs.sync(); noteSync(); pic.sync(); ed.sync(); edPlace(); }};
  CTLG.add(g); return g;
}
function ctlGraphTick(){
  for(const g of CTLG){ if(!g.el.isConnected){ CTLG.delete(g); continue; } if(g.live) continue; g.sync(); }
}
const CTLGRAPH_LIVE=[{kind:"ctlgraph",title:"AUTOMATION",live:true,
  tip:"Every block in this cabinet, one section to a tab, sources at the top and the demands they drive at the bottom. A wire says what it carries. Hover a block to read it, click it to wire it, tune it or switch it off."}];
