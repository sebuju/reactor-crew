"use strict";
/* the recorder timeline: the mock (mockups/timeline-vertical-live.html) wired to the real take forest.
   time runs along one axis, branch columns along the other; horizontal is the default. it reads REC/LOG/ST
   and drives navigation through trSeek(); it never touches ST or the sim. collapsed to an edge lip until
   hovered, and it only paints (rAF) while open, so a hidden strip costs nothing. */
(function(){
if(typeof document==="undefined" || !document.documentElement) return;

const T=0.02;                                  // sim seconds per tick
const COLW=170, GAP=69;                         // column spacing; fixed px between grid lines
let TICK=10, SCALE=GAP/TICK;                     // grid tick (s); SCALE (px/s) keeps line spacing constant
const TICKS=[1,10,30,60];
const PAGE_TOP=0.18, PAGE_TRIG=0.72, PAGE_STEP=0.6, PAGE_EASE=0.12;
const GUTTER=56, TAGROOM=170, LANE_MAX=16;

let horiz=true, follow=true, manualX=false;
let topT=0, topTarget=null, offX=0, panning=null;

/* one severity -> one tag class + one dot/lead colour; the four the LOG already carries */
const SEVCLASS={alarm:"alarm",warn:"warn",act:"act",info:"info"};
const EVCOL={alarm:"--c-red",warn:"--c-amber",act:"--c-cyan",info:"--c-metal"};
const sevClass=e=>SEVCLASS[e.sev]||"info";

const app=document.createElement("div"); app.id="rv-app";
const tl=document.createElement("div"); tl.id="rv-tl";
const tree=document.createElement("div"); tree.id="rv-tree";
const cursor=document.createElement("div"); cursor.id="rv-cursor";
const curdot=document.createElement("div"); curdot.id="rv-curdot"; cursor.appendChild(curdot);
tl.append(tree,cursor);
const ctrls=document.createElement("div"); ctrls.id="rv-ctrls";
const nameEl=document.createElement("span"); nameEl.id="rv-name";
const forkEl=document.createElement("span"); forkEl.id="rv-fork";
const stepBackBtn=btn("rv-stepback","STEP -","rv-key");
const stepBtn=btn("rv-step","STEP +","rv-key");
const followBtn=btn("rv-follow","▼ FOLLOW");
const orientBtn=btn("rv-orient","⇆ HORIZ","rv-key");
const scaleBtn=btn("rv-scale","10s","rv-key");
const pinBtn=btn("rv-pin","PIN","rv-key");
const liveEl=document.createElement("span"); liveEl.id="rv-live"; liveEl.textContent="LIVE";
const replayBtn=btn("rv-replay","REPLAY","rv-key");
const takeHereBtn=btn("rv-takehere","TAKE HERE","rv-key");
const takesBtn=btn("rv-takes","TAKES","rv-key");
ctrls.append(nameEl,forkEl,liveEl,replayBtn,takeHereBtn,stepBackBtn,stepBtn,followBtn,orientBtn,scaleBtn,takesBtn,pinBtn);
const picker=KIT.well({title:"TAKES / EVERY RUN THIS PLANT HAS HAD"});
picker.el.id="rv-picker";
const pickHead=document.createElement("div"); pickHead.className="trs-take-head";
pickHead.innerHTML='<span>RUN</span><span class="col-fork">FORKED FROM</span><span class="col-len">LENGTH</span>'+
  '<span class="col-assist"></span><span class="col-verd">VERDICT</span>';
const pickTree=document.createElement("div");
picker.body.append(pickHead,pickTree);
KIT.show(picker.el,false);
app.append(tl,ctrls,picker.el);
document.body.appendChild(app);
function btn(id,txt,cls){ const b=document.createElement("button"); b.id=id; b.textContent=txt; if(cls)b.className=cls; return b; }
KIT.tip(liveEl,"LIVE","The plant is running forward and every input you make is being written to the tape. Scrub back and this reads REPLAY instead, with the keys to watch on or to take the run somewhere else.");
KIT.tip(replayBtn,"REPLAY","Runs the tape on from here. WATCHING DOES NOT FORK: reviewing a run forward changes nothing and leaves no second copy of it in the tree, however many times you do it.");
KIT.tip(takeHereBtn,"TAKE HERE","Forks the recording at this moment and runs live from it. TOUCHING FORKS: putting your hand on any control while a replay is up does exactly this by itself, because that is the first moment the two futures can differ. This key is the way to ask for it on purpose, so nothing about the tree is ever a surprise.");
KIT.tip(takesBtn,"TAKES","Every run this plant has had, as the tree it is: scrub back, try it the other way, and the run you left is still there as the parent of the one you are on.");

function pickRow(t){
  const row=KIT.el("div","trs-take-row");
  row.classList.toggle("on",t.id===REC.cur);
  const go=KIT.button("GO",{sunk:1,size:7,onClick:()=>trSeek(t.id,t.tickEnd)});
  go.el.classList.add("trs-take-go");
  const name=KIT.el("span","trs-take-name"); name.textContent=trName(t);
  const par=t.parent===null?null:REC.takes[t.parent];
  let fork;
  if(par){
    fork=KIT.el("button","trs-take-fork",{type:"button"});
    fork.textContent="<- "+trName(par)+" @ "+trStamp(t.tick0);
    MOUSE.on(fork,{click(){ trSeek(par.id,t.tick0); }});
    KIT.tip(fork,"FORK POINT","Click to put the plant on "+trName(par)+" at the moment "+trName(t)+" split off it - the state both runs share, and where you would start from to try a third way.");
  }else{ fork=KIT.el("span","trs-take-root"); fork.textContent="ROOT"; }
  const len=KIT.el("span","trs-take-len"); len.textContent=trSecs(t.tickEnd-t.tick0).toFixed(1)+" s";
  const assist=KIT.el("span","trs-take-assist"); if(t.assisted) assist.textContent="ASSISTED";
  const verd=KIT.el("span","trs-take-verd");
  if(t.verdict){ verd.textContent=scnVerdLab(t.verdict); verd.style.color=scnVerdCol(t.verdict); }
  KIT.tip(row,trName(t),
    "Design "+t.head.dsig+", seed "+t.head.seed+". Runs "+trStamp(t.tick0)+" to "+
    trStamp(t.tickEnd)+", "+recEvN(t)+" recorded input(s)."+
    (t.assisted?" ASSISTED: this run was scrubbed into rather than flown straight through.":"")+
    " GO puts the plant at the end of it.");
  row.append(go.el,name,fork,len,assist,verd);
  return row;
}
function pickBuild(box,ids){
  for(const id of ids){
    const t=REC.takes[id]; if(!t) continue;
    box.appendChild(pickRow(t));
    const kids=t.kids.filter(k=>REC.takes[k]);
    if(kids.length){ const wrap=KIT.el("div","trs-take-kids"); box.appendChild(wrap); pickBuild(wrap,kids); }
  }
}
let pickOpen=false, pickSig=null;
function pickSync(){
  const many=takeList().length>1;
  KIT.show(takesBtn,many);
  if(!many) pickOpen=false;
  KIT.show(picker.el,pickOpen);
  if(!pickOpen) return;
  /* LENGTH, VERDICT and ASSISTED move while the picker is held open, so a sig of ids alone goes stale. */
  const sig=REC.takes.map(t=>t&&(t.id+":"+t.kids.join(",")+":"+t.tickEnd+":"+
    (t.label||"")+":"+(t.verdict||"")+":"+(t.assisted?1:0))).join("|")+"|"+REC.cur;
  if(sig===pickSig) return;
  pickSig=sig; pickTree.innerHTML="";
  pickBuild(pickTree,REC.roots.filter(r=>REC.takes[r]));
  KIT.reveal(pickTree.querySelector(".trs-take-row.on"));
}
KIT.tip(stepBackBtn,"STEP -","Puts the plant back one 0.02 s tick and leaves it paused. It is a scrub, not an undo: the tick is re-derived from the last keyframe, so it is exact but it costs more than stepping forward, and it puts you in REPLAY the same way dragging the bar does.");
KIT.tip(stepBtn,"STEP +","Advances the plant by one 0.02 s tick and leaves it paused. The one way to watch a fast transient happen rather than watching what it left behind.");
let parSig=null;
function takeSync(){
  const cur=recCur(); if(!cur) return;
  const replay=REC.mode==="replay";
  KIT.show(liveEl,!replay); KIT.show(replayBtn,replay); KIT.show(takeHereBtn,replay);
  pickSync();
  const par=cur.parent===null?null:REC.takes[cur.parent];
  KIT.setText(nameEl,trName(cur));
  KIT.setText(forkEl,par?"<- "+(par.id+1)+" @ "+trStamp(cur.tick0):"ROOT");
  /* KIT.tip() dedupes writes, but the paragraph still has to be built to find that out. */
  const sig=cur.id+":"+(par?par.id+"@"+cur.tick0:"root");
  if(sig===parSig) return;
  parSig=sig;
  const parTip=(par?"Forked off "+trName(par)+" at "+trStamp(cur.tick0)+", so everything before that belongs to the parent and is shared with it."
       :"A root run: this take starts at the reset that made the plant and owes nothing to any other.")+
      " A recording is a forest, not a list - the run you scrubbed away from is still a run, so it stays as the parent and the second attempt hangs off it.";
  KIT.tip(nameEl,trName(cur),parTip);
  KIT.tip(forkEl,trName(cur),parTip);
}

/* axis helpers: one axis is time, the other columns; .vert swaps which is which */
const timeLen=()=>horiz?tl.clientWidth:tl.clientHeight;
const colLen=()=>horiz?tl.clientHeight:tl.clientWidth;
const evTimePx=e=>{ const r=tl.getBoundingClientRect(); return horiz?e.clientX-r.left:e.clientY-r.top; };
function place(el,t0,tlen,c0,clen){
  if(horiz){ el.style.left=t0+"px"; el.style.top=c0+"px";
    if(tlen!=null)el.style.width=tlen+"px"; if(clen!=null)el.style.height=clen+"px"; }
  else{ el.style.top=t0+"px"; el.style.left=c0+"px";
    if(tlen!=null)el.style.height=tlen+"px"; if(clen!=null)el.style.width=clen+"px"; }
}
const mmss=s=>{ s=Math.round(s); const m=(s/60)|0, ss=((s%60)+60)%60;
  return String(m).padStart(2,"0")+":"+String(ss).padStart(2,"0"); };
const rawX=i=>i*COLW+52;
const colX=i=>rawX(i)-offX;
const sY=t=>(t-topT)*SCALE;
const tAtY=y=>topT+y/SCALE;
const botTime=H=>topT+H/SCALE;

/* the live forest, tombstones dropped; col is assigned per frame into a side map, never onto the take */
const takeList=()=>REC.takes.filter(Boolean);
const col=new Map();
function layout(){
  col.clear();
  const list=takeList();
  const kids=id=>list.filter(t=>t.parent===id).sort((a,b)=>b.tick0-a.tick0);
  let c=0; const visit=t=>{ col.set(t.id,c++); kids(t.id).forEach(visit); };
  list.filter(t=>t.parent===null).sort((a,b)=>a.tick0-b.tick0).forEach(visit);
}
const colOf=t=>col.get(t.id)||0;
const nowSec=()=>ST ? ST.sc[SC_TICK]*T : 0;
const endT=()=>{ let e=nowSec(); for(const t of takeList()) if(t.tickEnd*T>e)e=t.tickEnd*T; return e; };
const panMaxTopT=()=>Math.max(0,endT()-timeLen()/SCALE);
const panMaxOffX=()=>{ let r=52; for(const t of takeList()) r=Math.max(r,rawX(colOf(t))); return Math.max(0,r+TAGROOM-colLen()); };
const OVER=()=>timeLen()/SCALE;
const clampTopT=v=>Math.max(-OVER(),Math.min(panMaxTopT()+OVER(),v));
const clampOffX=v=>Math.max(0,Math.min(panMaxOffX(),v));

/* the current path is the remembered-tip lineage (trLine, from transport.js), so it does not shrink on a scrub past a fork */
const pathLine=()=>recCur()?trLine():[];
function pathTakeAt(t){
  const line=pathLine();
  for(let k=0;k<line.length;k++){ const s=line[k].tick0*T, e=(k<line.length-1)?line[k+1].tick0*T:Infinity;
    if(t>=s&&t<e) return line[k]; }
  return line.length?line[line.length-1]:null;
}
const pathColAt=t=>{ const tk=pathTakeAt(t); return tk?colOf(tk):0; };
function onPath(tk,tick){
  const line=pathLine(), k=line.indexOf(tk);
  return k>=0&&(k===line.length-1||tick<line[k+1].tick0);
}

/* the LOG reaches back LOG_MAX lines and a seek rewinds it, so each take keeps what it logged while live:
   a replay reads its future there, and a branch left behind keeps its own. Keyed per worker, whose take ids restart. */
const evBy=new Map();
let evEpoch, evN=-1, evLast=null, evTk=-1;
function evRecord(){
  if(!ST||REC.mode!=="live"||!LOG.length) return;
  const tk=recCur(); if(!tk) return;
  if(SIMBOUND!==evEpoch){ evBy.clear(); evEpoch=SIMBOUND; evTk=-1; }
  const last=LOG[LOG.length-1];
  if(tk.id===evTk&&LOG.length===evN&&last===evLast) return;
  evTk=tk.id; evN=LOG.length; evLast=last;
  for(const id of evBy.keys()) if(!REC.takes[id]) evBy.delete(id);
  const par=tk.parent===null?null:evBy.get(tk.parent);
  const inherited=e=>par&&e.tick===tk.tick0&&par.some(q=>q.tick===e.tick&&q.msg===e.msg);
  const cut=Math.max(tk.tick0,LOG[0].tick+(LOG.length>=LOG_MAX?1:0));
  const kept=(evBy.get(tk.id)||[]).filter(e=>e.tick<cut);
  for(const e of LOG) if(e.tick>=cut&&!inherited(e)) kept.push(e);
  evBy.set(tk.id,kept);
}
const firstAt=(arr,tick)=>{ let lo=0,hi=arr.length; while(lo<hi){ const m=(lo+hi)>>1; if(arr[m].tick<tick)lo=m+1; else hi=m; } return lo; };

/* pooled nodes: elements are reused every frame, never rebuilt, and only the viewport's worth is touched */
const pools=new Map(), clusters=new Map(), lanes=new Map();
function pool(kind,build){
  let p=pools.get(kind); if(!p){ p={els:[],n:0}; pools.set(kind,p); }
  let el=p.els[p.n];
  if(!el){ el=document.createElement("div"); if(build)build(el); tree.appendChild(el); p.els.push(el); }
  p.n++; el.style.display=""; return el;
}

function paint(ts){
  layout(); clusters.clear(); lanes.clear(); for(const p of pools.values())p.n=0;
  const H=timeLen(), gw=colLen()-6, botT=botTime(H), now=nowSec();
  const labelX=Math.max(2,10-offX);
  for(let t=Math.floor(Math.max(0,topT)/TICK)*TICK; sY(t)<=H+1; t+=TICK){
    const y=Math.round(sY(t)); if(y<-1)continue;
    const g=pool("grid",el=>{ el.className="rv-grid"; el.appendChild(document.createElement("label")); });
    place(g,y,null,0,gw);
    g.firstChild.style.left=horiz?"":labelX+"px";
    g.firstChild.textContent=mmss(t);
  }
  const list=takeList(), curId=REC.cur;
  list.forEach(tk=>{
    const c=colOf(tk), x=colX(c), start=tk.tick0*T, head=tk.tickEnd*T;
    const hz=pool("hz",el=>el.className="rv-hitzone");
    place(hz,0,H,x-COLW/2,COLW);
    hz.onmousedown=ev=>{ if(ev.button!==0)return; seek(tk,tAtY(evTimePx(ev))); };
    const ra=Math.max(start,topT), rb=Math.min(head,botT);
    if(rb>ra){ const rail=pool("rail"); rail.className="rv-rail";
      place(rail,Math.round(sY(ra)),Math.round(sY(rb)-sY(ra)),x-1,2); }
    if(sY(start)>-40&&sY(start)<H){
      const head2=pool("head",el=>el.innerHTML='<span class="rv-swatch"></span><span class="rv-nm"></span>');
      head2.className="rv-head"+(tk.id===curId?" live":"");
      if(horiz)place(head2,Math.round(sY(start)),null,x-16,null);
      else place(head2,Math.round(sY(start))-20,null,x-COLW/2+12,null);
      head2.firstChild.style.background=tk.assisted?"var(--c-cyan)":"var(--c-blue)";
      head2.lastChild.textContent=trName(tk);
      head2.onmousedown=ev=>{ if(ev.button!==0)return; seek(tk,head); };
    }
    const par=tk.parent===null?null:REC.takes[tk.parent];
    if(par&&sY(start)>-10&&sY(start)<H+10){
      const px=colX(colOf(par)), by=Math.round(sY(start));
      const s=pool("siding"); s.className="rv-siding";
      place(s,by-1,2,Math.min(px,x)-1,Math.abs(x-px)+2);
      const bd=pool("bdot"); bd.className="rv-bdot";
      place(bd,by-4,null,px-4,null);
    }
    if(tk.id!==curId&&!tk.kids.some(k=>REC.takes[k])&&sY(head)>-10&&sY(head)<H+10){
      const ed=pool("edot"); ed.className="rv-edot";
      place(ed,Math.round(sY(head))-4,null,x-4,null);
    }
  });
  /* a take nothing was recorded for (a scenario run) falls back to the LOG on its stretch of the current lineage */
  const line=pathLine();
  for(const tk of list){
    const own=evBy.get(tk.id), evs=own||(line.includes(tk)?LOG:null); if(!evs) continue;
    const hi=Math.min(tk.tickEnd,Math.ceil((botT+OVER())/T));
    for(let j=firstAt(evs,Math.max(tk.tick0,Math.floor((topT-OVER())/T)));j<evs.length&&evs[j].tick<=hi;j++){
      const e=evs[j], y=sY(e.tick*T); if(y<=-24||y>=H+24) continue;
      if(!own&&pathTakeAt(e.tick*T)!==tk) continue;
      addNode(tk,colOf(tk),e,ts,now,!onPath(tk,e.tick));
    }
  }
  drawCurPath(H,now);
  if(horiz){ curdot.style.top=colX(pathColAt(now))+"px"; curdot.style.left="-5px"; }
  else{ curdot.style.left=colX(pathColAt(now))+"px"; curdot.style.top="-6px"; }
  for(const p of pools.values())for(let i=p.n;i<p.els.length;i++)p.els[i].style.display="none";
}
function drawCurPath(H,now){
  const line=pathLine(), botT=botTime(H);
  line.forEach((tk,k)=>{
    const i=colOf(tk), end=(k<line.length-1)?line[k+1].tick0*T:now;
    const a=Math.max(tk.tick0*T,topT), b=Math.min(end,botT);
    if(b>a){ const seg=pool("cp"); seg.className="rv-curpath";
      place(seg,Math.round(sY(a)),Math.round(sY(b)-sY(a)),colX(i)-1,3); }
    if(k<line.length-1){ const cx=colX(colOf(line[k+1])), by=Math.round(sY(line[k+1].tick0*T));
      if(by>-5&&by<H+5){ const h=pool("cp"); h.className="rv-curpath";
        place(h,by-1,3,Math.min(colX(i),cx)-1,Math.abs(cx-colX(i))+3); } }
  });
}
function addNode(tk,i,e,ts,now,off){
  const et=e.tick*T, type=sevClass(e), o=off?" off":"", key=i+":"+e.tick, c=horiz?null:clusters.get(key);
  if(c){ c.count++; if(SEV_RANK[e.sev]>SEV_RANK[c.sev]){ c.sev=e.sev; c.type=sevClass(e); c.label=e.msg; }
    c.el.className="rv-ev "+c.type+c.o; c.el.textContent=c.label+"  +"+(c.count-1); return; }
  const ev=pool("ev"); ev.className="rv-ev "+type+o;
  ev.textContent=e.msg; ev.title=e.msg;
  ev.onmousedown=evt=>{ if(evt.button!==0)return; evt.stopPropagation(); seek(tk,et); };
  if(horiz){
    const x=Math.round(sY(et)), base=colX(i), w=ev.offsetWidth||90, pad=6, half=w/2, tagH=ev.offsetHeight||14;
    /* a lane is taken only while it stays inside the column's own band and the strip; lane 0 always is */
    const below=Math.min(COLW/2,colLen()-base), above=Math.min(COLW/2,base);
    const fits=L=>(L&1?above:below)>=9+tagH+(L>>1)*17;
    let arr=lanes.get(i); if(!arr){ arr=[]; lanes.set(i,arr); }
    let L=-1, B=0;
    for(let k=0;k<LANE_MAX;k++){
      if(k>0&&!fits(k)) continue;
      if(arr[k]==null||arr[k]<=x-half-pad){ L=k; break; }
      if(arr[k]<arr[B]) B=k;
    }
    /* every lane that fits is busy: the tag slides along time behind the lane that frees first */
    const left=L<0?arr[B]:x-half;
    if(L<0) L=B;
    arr[L]=left+w+pad;
    const depth=L>>1, up=L&1;
    const top=up?base-9-tagH-depth*17:base+9+depth*17;
    ev.style.left=left+"px"; ev.style.top=top+"px";
    const col="var("+EVCOL[e.sev]+")", jog=left>x, near=jog?top+tagH/2:up?top+tagH:top;
    const lead=pool("evlead",el=>el.className="rv-evlead");
    lead.style.left=x+"px"; lead.style.top=Math.min(base,near)+"px"; lead.style.height=Math.abs(near-base)+"px";
    lead.style.background=col; lead.style.opacity=off?.25:.55;
    if(jog){ const j=pool("evjog",el=>el.className="rv-evjog");
      j.style.left=x+"px"; j.style.top=near+"px"; j.style.width=(left-x)+"px";
      j.style.background=col; j.style.opacity=off?.25:.55; }
    const dot=pool("evdot",el=>el.className="rv-evdot");
    dot.style.left=x+"px"; dot.style.top=base+"px";
    dot.style.background=col; dot.style.opacity=off?.35:1;
  }else{ ev.style.left=(colX(i)+9)+"px"; ev.style.top=(Math.round(sY(et))-ev.offsetHeight/2)+"px"; }
  const age=(now-et)*1000;                    // pop a freshly-landed event, only while live
  if(REC.mode==="live"&&!off&&age>=0&&age<450){ ev.classList.add("pop"); ev.style.animationDelay=(-age)+"ms"; }
  else ev.classList.remove("pop");
  if(!horiz)clusters.set(key,{el:ev,count:1,sev:e.sev,type,o,label:e.msg});
}

function seek(tk,t){
  const tick=Math.max(tk.tick0,Math.min(Math.round(t/T),tk.tickEnd));
  trSeek(tk.id,tick); follow=true; manualX=false; topTarget=null;
  topT=clampTopT(Math.max(0,tick*T-timeLen()*PAGE_TOP/SCALE));
}

function frame(ts){
  const now=nowSec(), live=REC.mode==="live", H=timeLen();
  if(follow){
    if(topTarget==null)topTarget=now-H*PAGE_TOP/SCALE;
    while((now-topTarget)*SCALE>H*PAGE_TRIG)topTarget+=H*PAGE_STEP/SCALE;
    topT+=(topTarget-topT)*PAGE_EASE;
    if(Math.abs(topTarget-topT)*SCALE<0.5)topT=topTarget;
  }
  if(!manualX){
    const acX=rawX(pathColAt(follow?now:tAtY(H/2))), R=Math.max(GUTTER+10,colLen()-TAGROOM);
    let want=offX;
    if(acX-offX<GUTTER)want=acX-GUTTER; else if(acX-offX>R)want=acX-R;
    offX+=(want-offX)*PAGE_EASE;
  }
  evRecord();
  paint(ts);
  const cyN=sY(now);
  if(horiz){ cursor.style.left=cyN+"px"; cursor.style.top="0"; }
  else{ cursor.style.top=cyN+"px"; cursor.style.left="0"; }
  cursor.classList.toggle("replay",!live);
  cursor.style.display=(cyN>=0&&cyN<=H)?"block":"none";
  followBtn.classList.toggle("hide",follow);
  takeSync();
}

/* rAF only while the strip is open (hovered); a housekeeping tick shows/hides it on screen change */
let open=false, pinned=false, raf=0;
const loop=ts=>{ raf=0; frame(ts); if((open||pinned)&&!app.classList.contains("hide"))raf=requestAnimationFrame(loop); };
const kick=()=>{ if(!raf)raf=requestAnimationFrame(loop); };
app.addEventListener("mouseenter",()=>{ open=true; kick(); });
app.addEventListener("mouseleave",()=>{ open=false; });
setInterval(()=>{
  evRecord();
  const on=!!ST&&SIMSCREEN[screen]&&!!recCur();
  app.classList.toggle("hide",!on);
  if(!on){ open=false; }
  else if(pinned) kick();
},200);

tl.addEventListener("wheel",e=>{ e.preventDefault(); follow=false; topT=clampTopT(topT+e.deltaY/SCALE); },{passive:false});
tl.addEventListener("contextmenu",e=>e.preventDefault());
tl.addEventListener("mousedown",e=>{ if(e.button!==2)return;
  e.preventDefault(); follow=false; manualX=true; panning={x:e.clientX,y:e.clientY,topT,offX}; });
window.addEventListener("mousemove",e=>{ if(!panning)return; e.preventDefault();
  const dTime=horiz?(e.clientX-panning.x):(e.clientY-panning.y);
  const dCol=horiz?(e.clientY-panning.y):(e.clientX-panning.x);
  topT=clampTopT(panning.topT-dTime/SCALE); offX=clampOffX(panning.offX-dCol); });
window.addEventListener("mouseup",e=>{ if(e.button===2)panning=null; });

replayBtn.onclick=()=>trRate(TR.rate);
takeHereBtn.onclick=()=>trBranchAt(REC.cur,ST.sc[SC_TICK]);
takesBtn.onclick=()=>{ pickOpen=!pickOpen; pickSig=null; pickSync(); };
stepBackBtn.onclick=trStepBack;
stepBtn.onclick=trStep;
followBtn.onclick=()=>{ follow=true; topTarget=null; manualX=false; };
orientBtn.onclick=()=>{ horiz=!horiz; app.classList.toggle("vert",!horiz);
  orientBtn.innerHTML=horiz?"⇆ HORIZ":"⇆ VERT";
  topTarget=null; offX=clampOffX(offX); topT=clampTopT(topT); };
pinBtn.onclick=()=>{ pinned=!pinned; app.classList.toggle("pin",pinned); pinBtn.classList.toggle("on",pinned); kick(); };
scaleBtn.onclick=()=>{ TICK=TICKS[(TICKS.indexOf(TICK)+1)%TICKS.length]; SCALE=GAP/TICK; scaleBtn.textContent=TICK+"s"; };
})();
