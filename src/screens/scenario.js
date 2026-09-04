"use strict";
/* the scenario bench: an HTML timeline you author IN, and the verdict it earns.
   THE TIMELINE IS THE SCREEN, NOT A STRIP ON IT - no bottom bar, no palette,
   no EVENTS/LIMITS/VERDICT panel. See .claude/CLAUDE.md "The scenario bench".
   The chart alone stays canvas (chart() in render/chart.js); everything else
   here is DOM, built once in scnBuild() and synced every frame from
   drawScenario(), which main.js already calls once per tick. */

const SCN_ROWH   = 18;                 // px per lane sub-row
const SCN_SUBMAX = 3;                  // sub-rows a lane grows before it counts, not lists
const SCN_SNAP   = 0.5;                // events land on the half second
const SCN_ZMAX   = 240;
const SCN_CH_MIN = 40;                 // chart slot shorter than this draws nothing
const SCNH = {size:6.5, sp:1};

let scnSel=-1, scnLimSel=-1, scnPlay=0, scnVerd=null, scnTake=null, scnProg=-1,
    scnNote="", scnFiles=null, scnLimPick=0, scnZoom=1, scnPan=0,
    scnPreOpen=false, scnSaveOpen=false, scnLastKind=null;

function scnPick(kind,i){
  if(kind==="ev"){ scnSel=i; scnLimSel=-1; } else { scnLimSel=i; scnSel=-1; }
}

/* seconds <-> fraction of the visible span. scnZoom is a MULTIPLE OF FIT, for
   the reason VIEW.z is one: how much room the timeline gets depends on the
   window. The pan IS clamped, unlike the plant view - a scenario has exactly
   two edges. */
const scnSpan = () => SCN.secs/scnZoom;
const scnT0   = () => clamp(scnPan, 0, Math.max(0, SCN.secs-scnSpan()));
const scnFracOf = t => (t-scnT0())/scnSpan();
const scnTat  = f => scnT0() + clamp(f,0,1)*scnSpan();
const scnSnapT= t => clamp(Math.round(t/SCN_SNAP)*SCN_SNAP, 0, SCN.secs);
const scnFmt  = t => (t>=100?t.toFixed(0):t.toFixed(1))+"s";
const scnFit  = () => { scnZoom=1; scnPan=0; };
function scnStep(span){
  for(const s of [.5,1,2,5,10,15,30,60,120,300,600,900,1800]) if(span/8<=s) return s;
  return 3600;
}

/* ═══ WHERE EVERY BLOCK STARTS AND ENDS ═══
   Unchanged from the canvas build. A `ramp` ends at its own OVER argument, a
   `latch` ends at the next event of the same kind carrying the same first
   argument (except pair:0 - BLACKOUT - whose argument IS the state), a
   `point` never reaches either search. Packed into at most SCN_SUBMAX rows
   per lane on the half-open interval [t0,t1), in TIME not pixels, so a block
   never jumps rows as you zoom; what does not fit is counted, not listed. */
function scnLay(){
  const g=SCN.gest, out=[];
  const ord=g.map((_,i)=>i).sort((a,b)=>g[a].t-g[b].t || a-b);
  for(const i of ord){
    const e=g[i], G=GEST[e.k]; if(!G) continue;
    const b={i, e, G, t0:e.t, t1:e.t, ramp:0, row:0, hide:false};
    b.pt = G.span==="point";
    if(G.span==="ramp"){
      b.ramp=Math.max(0, e.a[1]||0);
      b.t1=e.t+b.ramp;
    } else if(G.span==="latch"){
      let end=SCN.secs;
      for(const j of ord){
        const o=g[j]; if(j===i || o.t<=e.t) continue;
        if(!GEST[o.k] || o.k!==e.k) continue;
        if(G.pair!==0 && String(o.a[0])!==String(e.a[0])) continue;
        end=o.t; break;
      }
      b.t1=Math.max(e.t, end);
    }
    out.push(b);
  }
  const laneRows={}, over={};
  for(const L of SCN.lanes){
    const mine=out.filter(b=>b.e.lane===L.id);
    const ends=[];
    for(const b of mine){
      const end = b.t1>b.t0 ? b.t1 : b.t0+1e-6;
      let r=ends.findIndex(e=>e<=b.t0);
      if(r<0) r=ends.length;
      if(r>=SCN_SUBMAX){ b.hide=true;
        const m=over[L.id]=over[L.id]||new Map();
        m.set(b.t0,(m.get(b.t0)||0)+1); continue; }
      b.row=r; ends[r]=end;
    }
    laneRows[L.id]=Math.max(1,ends.length);
  }
  return {list:out, laneRows, over};
}

function scnBlockLab(b){
  const A=b.G.args[0];
  if(!A) return b.G.lab;
  const v=b.e.a[0];
  if(typeof v!=="number") return b.G.lab+" "+v;
  return b.G.lab+" "+v.toFixed(0)+(A.u==="%"?"%":(A.u?" "+A.u:""));
}

const scnChans = () => Object.keys(CH).concat(Object.keys(CHB));
/* A sane slider top per channel, grouped by unit, so a DNBR limit is not set
   on a 0..1600 track where every useful value lives in the first pixel. */
function scnLimTop(k){
  if(CHB[k]) return 4;
  if(k==="dnbr"||k==="fq"||k==="vd"||k==="cav") return 4;
  if(k==="tf") return 2200;
  if(k==="tavg"||k==="th"||k==="tc"||k==="sub") return 900;
  if(k==="prs") return 20;
  if(k==="bor"||k==="xe"||k==="rho") return 5000;
  return 150;
}

/* ═══════════════ DOM: BUILD ONCE ═══════════════ */
let UI = null;

function scnBuild(){
  if(UI) return UI;
  /* no DOM under a headless run or the worker - same guard help.js, transport.js
     and control-room.js use before touching document */
  if(typeof document==="undefined" || !document.documentElement) return null;
  const mount = document.getElementById("scr-scenario");
  if(!mount) return null;
  if(!scnLastKind) scnLastKind = GESTKEYS[0];

  const root = KIT.el("div","scn-root");

  const head = KIT.el("div","scn-head");
  const nameEl = KIT.el("span","scn-head-name");
  const secsSlider = KIT.slider({min:20,max:600,step:1,fmt:v=>v.toFixed(0)+"s",
    title:"RUN LENGTH",tip:"How long the scenario lasts. Limits are judged over the whole of it.",
    onChange:v=>{ SCN.secs=Math.round(v); scnVerd=null; scnPan=clamp(scnPan,0,SCN.secs); }});
  const runBtn=KIT.button("RUN",{onClick:()=>scnGo(),
    tip:"Flies this scenario with nobody at the panel, so a PASS is a statement about the DESIGN. Pressing it again cancels. It resets the plant and opens a new take."});
  const playBtn=KIT.button("PLAY",{onClick:()=>scnFly(),
    tip:"Arms this scenario on the live plant and hands you the control room - the same events fire on the same schedule, but you are flying it, so a PASS is a statement about you and the design together. Resets the plant and opens a new take, exactly as RUN does."});
  const fitBtn=KIT.button("FIT",{flat:true,size:6.5,onClick:scnFit});
  const presetsBtn=KIT.button("PRESETS",{sunk:true,size:6.5,
    onClick:()=>{ scnPreOpen=!scnPreOpen; scnSaveOpen=false; }});
  const saveBtn=KIT.button("SAVE",{sunk:true,size:6.5,
    onClick:()=>{ scnSaveOpen=!scnSaveOpen; scnPreOpen=false; }});
  const trendsBtn=KIT.button("TRENDS",{sunk:true,size:6.5,onClick:()=>ovlToggle("scntrend")});
  const logBtn=KIT.button("LOG",{sunk:true,size:6.5,onClick:()=>ovlToggle("scnlog")});
  const resetBtn=KIT.button("RESET",{size:6.5,onClick:scnReset,
    tip:"Returns the reactor to steady 100% power with all faults cleared and damage counters zeroed. Clears the last run's verdict; keeps the timeline you have authored."});
  const spacer=KIT.el("div","scn-head-spacer");
  const verdictEl=KIT.el("span","scn-verdict");
  head.append(nameEl, secsSlider.el, runBtn.el, playBtn.el, fitBtn.el,
    presetsBtn.el, saveBtn.el, spacer, verdictEl, trendsBtn.el, logBtn.el, resetBtn.el);

  const main = KIT.el("div","scn-main");
  const timeline = KIT.el("div","scn-timeline");
  const playhead = KIT.el("div","scn-playhead");
  const ruler = KIT.el("div","scn-ruler");
  const rulerLabel = KIT.el("div","scn-ruler-label"); rulerLabel.textContent="TIMELINE";
  const rulerTrack = KIT.el("div","scn-ruler-track");
  ruler.append(rulerLabel, rulerTrack);
  const lanesEl = KIT.el("div","scn-lanes");
  const limitsEl = KIT.el("div","scn-limits");
  const limitsHead = KIT.el("div","scn-limits-head"); limitsHead.textContent="LIMITS";
  const limitsRows = KIT.el("div");
  const limitsFoot = KIT.el("div","scn-limit-add");
  const addLimBtn = KIT.button("+ LIM",{flat:true,size:6.5,onClick:()=>{
    const chk=scnChans(), pick=chk[scnLimPick%chk.length];
    scnLimit(SCN,pick,pick,">",0,0); scnPick("lim",SCN.limits.length-1); scnVerd=null;
  }});
  const addLimNote = KIT.el("span","scn-limit-add-note");
  limitsFoot.append(addLimBtn.el, addLimNote);
  limitsEl.append(limitsHead, limitsRows, limitsFoot);
  timeline.append(playhead, ruler, lanesEl, limitsEl);

  const pan = KIT.el("div","scn-pan");
  const panZoom = KIT.el("span","scn-pan-zoom");
  const panTrack = KIT.el("div","scn-pan-track");
  const panThumb = KIT.el("div","scn-pan-thumb");
  panTrack.appendChild(panThumb);
  pan.append(panZoom, panTrack);

  const chartSlot = KIT.el("div","scn-chart-slot");
  KIT.tip(chartSlot,"DEMAND AGAINST DELIVERED",
    "What the scenario asked the plant for, dashed, against what it actually made. Both on one scale, because two scales would hide the gap between them. It shows the same seconds the timeline does, so the two zoom together.");

  const inspector = KIT.el("div","scn-inspector");

  main.append(timeline, pan, chartSlot, inspector);
  root.append(head, main);
  mount.appendChild(root);

  UI = {root, main, timeline, playhead, ruler, rulerTrack, lanesEl, limitsEl,
    limitsRows, addLimNote, panTrack, panThumb, panZoom, chartSlot, inspector,
    head:{nameEl,secsSlider,runBtn,playBtn,fitBtn,presetsBtn,saveBtn,trendsBtn,logBtn,verdictEl},
    laneSig:null, laneRows:new Map(), blocks:new Map(),
    limitRows:[], insp:null, inspSig:null, drag:null};

  scnWirePointer();
  scnBuildPresets();
  scnBuildSave();
  return UI;
}

function scnWirePointer(){
  const timeSecAt = clientX => {
    const r=UI.rulerTrack.getBoundingClientRect();
    return scnTat(r.width>0?(clientX-r.left)/r.width:0);
  };
  UI.rulerTrack.addEventListener("pointerdown",e=>{
    UI.rulerTrack.setPointerCapture(e.pointerId);
    scnPlay=scnSnapT(timeSecAt(e.clientX));
  });
  UI.rulerTrack.addEventListener("pointermove",e=>{
    if(e.buttons!==1) return;
    scnPlay=scnSnapT(timeSecAt(e.clientX));
  });
  /* the wheel holds the second under the pointer still, the same lens feel
     VIEW.z's own wheel handler has on the plant */
  UI.timeline.addEventListener("wheel",e=>{
    e.preventDefault();
    const r=UI.rulerTrack.getBoundingClientRect();
    const f=r.width>0?clamp((e.clientX-r.left)/r.width,0,1):0.5;
    const a=scnTat(f);
    scnZoom=clamp(scnZoom*Math.exp(-e.deltaY*0.0015),1,SCN_ZMAX);
    scnPan=a-f*scnSpan();
  },{passive:false});

  const barSecAt = clientX => {
    const r=UI.panTrack.getBoundingClientRect();
    return clamp(r.width>0?(clientX-r.left)/r.width:0,0,1)*SCN.secs;
  };
  let panGrab=0;
  UI.panTrack.addEventListener("pointerdown",e=>{
    UI.panTrack.setPointerCapture(e.pointerId);
    UI.panThumb.classList.add("drag");
    const tr=UI.panThumb.getBoundingClientRect();
    panGrab = (e.clientX>=tr.left && e.clientX<=tr.right)
      ? barSecAt(e.clientX)-scnT0()-scnSpan()/2 : 0;
    scnPan = barSecAt(e.clientX)-scnSpan()/2-panGrab;
  });
  UI.panTrack.addEventListener("pointermove",e=>{
    if(e.buttons!==1) return;
    scnPan = barSecAt(e.clientX)-scnSpan()/2-panGrab;
  });
  UI.panTrack.addEventListener("pointerup",()=>UI.panThumb.classList.remove("drag"));
}

/* ═══════════════ LANES + BLOCKS ═══════════════
   LANES ARE SCENARIO DATA, NOT A FIXED CATALOGUE: SCN.lanes is per-scenario,
   a lane is just an id. Clicking bare lane adds scnLastKind and selects it
   immediately - this replaces the old right-click ADD menu; CLAUDE.md is
   authoritative that a click is unambiguous once lanes exist. */
function scnSyncLanes(LZ){
  const sig = SCN.lanes.map(L=>L.id).join("|");
  if(UI.laneSig!==sig){
    UI.laneSig=sig;
    UI.lanesEl.innerHTML="";
    UI.laneRows.clear();
    SCN.lanes.forEach((L,li)=>{
      const row=KIT.el("div","scn-lane");
      const lab=KIT.el("div","scn-lane-label");
      const nameSpan=KIT.el("span"); nameSpan.textContent="LANE "+(li+1);
      lab.appendChild(nameSpan);
      KIT.tip(lab,"LANE "+(li+1),"Double-click to remove this lane. Refused while it still holds an event, and while it is the only lane left.");
      lab.addEventListener("dblclick",()=>{
        if(SCN.lanes.length<=1){ scnNote="AT LEAST ONE LANE"; return; }
        if(SCN.gest.some(g=>g.lane===L.id)){ scnNote="LANE NOT EMPTY"; return; }
        const idx=SCN.lanes.indexOf(L); if(idx>=0) SCN.lanes.splice(idx,1);
        scnVerd=null; UI.laneSig=null;
      });
      if(li===SCN.lanes.length-1){
        const add=KIT.el("button","scn-lane-add",{type:"button"}); add.textContent="+";
        KIT.tip(add,"ADD LANE","Adds another lane to the timeline.");
        add.addEventListener("click",e=>{ e.stopPropagation();
          SCN.lanes.push({id:"lane"+Date.now()}); scnVerd=null; UI.laneSig=null; });
        lab.appendChild(add);
      }
      const track=KIT.el("div","scn-lane-track");
      track.addEventListener("click",e=>{
        if(e.target!==track) return;
        const r=track.getBoundingClientRect();
        const t=scnSnapT(scnTat(r.width>0?(e.clientX-r.left)/r.width:0));
        const k=scnLastKind;
        SCN.gest.push({t,k,a:GEST[k].args.map(A=>A.def),lane:L.id});
        scnPick("ev",SCN.gest.length-1); scnVerd=null;
      });
      row.append(lab,track);
      UI.lanesEl.appendChild(row);
      UI.laneRows.set(L.id,{row,track,overWrap:null});
    });
  }
  SCN.lanes.forEach(L=>{
    const rec=UI.laneRows.get(L.id); if(!rec) return;
    rec.track.style.height=(LZ.laneRows[L.id]*SCN_ROWH)+"px";
  });
  scnSyncBlocks(LZ);
}

function scnMakeBlockNode(){
  const el=KIT.el("div","scn-block");
  const span=KIT.el("div","scn-block-span");
  const sqL=KIT.el("div","scn-block-sq"); sqL.style.left="0";
  const sqR=KIT.el("div","scn-block-sq"); sqR.style.left="100%";
  const pt=KIT.el("div","scn-block-pt");
  const lab=KIT.el("div","scn-block-lab");
  const handle=KIT.el("div","scn-block-resize");
  el.append(span,sqL,sqR,pt,handle,lab);
  el._refs={span,sqL,sqR,pt,handle,lab};

  el.addEventListener("pointerdown",e=>{
    if(e.button!==0) return; e.stopPropagation();
    const b=el._b; el.setPointerCapture(e.pointerId);
    scnPick("ev",b.i); scnLastKind=b.e.k; scnVerd=null;
    if(e.target===handle && RAMPARG[b.e.k]!=null){
      UI.drag={type:"ramp",el,argI:RAMPARG[b.e.k]};
    } else {
      const r=UI.rulerTrack.getBoundingClientRect();
      const f=r.width>0?(e.clientX-r.left)/r.width:0;
      UI.drag={type:"move",el,grabT:b.e.t-scnTat(f)};
    }
    el.classList.add("dragging");
  });
  el.addEventListener("pointermove",e=>{ if(UI.drag&&UI.drag.el===el) scnDragMove(e); });
  el.addEventListener("pointerup",()=>{ if(UI.drag&&UI.drag.el===el) scnDragEnd(el); });
  el.addEventListener("pointercancel",()=>{ if(UI.drag&&UI.drag.el===el) scnDragEnd(el); });
  el.addEventListener("dblclick",e=>{
    e.stopPropagation();
    const idx=SCN.gest.indexOf(el._b.e); if(idx<0) return;
    SCN.gest.splice(idx,1);
    if(scnSel===idx) scnSel=-1; else if(scnSel>idx) scnSel--;
    scnVerd=null;
  });
  return el;
}

function scnDragMove(e){
  const d=UI.drag; if(!d) return;
  const b=d.el._b, g=b.e;
  const r=UI.rulerTrack.getBoundingClientRect();
  const f=r.width>0?(e.clientX-r.left)/r.width:0;
  if(d.type==="ramp"){
    g.a[d.argI]=Math.max(0,Math.round(scnTat(f)-g.t));
  } else {
    g.t=scnSnapT(scnTat(f)+d.grabT);
    for(const L of SCN.lanes){
      const rec=UI.laneRows.get(L.id); if(!rec) continue;
      const lr=rec.track.getBoundingClientRect();
      if(e.clientY>=lr.top && e.clientY<=lr.bottom){ g.lane=L.id; break; }
    }
  }
  scnVerd=null;
}
function scnDragEnd(el){ UI.drag=null; el.classList.remove("dragging"); }

/* the block that reaches this fills itself in fresh each frame - cheap,
   given a scenario never carries more than a few dozen events - EXCEPT while
   it is under the pointer: pointer capture lives on the DOM node itself, and
   a rebuild that destroyed and recreated it would silently end the drag. */
function scnApplyBlock(el,b){
  el._b=b;
  el.classList.toggle("on", scnSel===b.i);
  el.style.top=(b.row*SCN_ROWH+1)+"px"; el.style.height=(SCN_ROWH-2)+"px";
  const f0=scnFracOf(b.t0), f1=b.pt?f0:scnFracOf(b.t1);
  el.style.left=(f0*100)+"%";
  el.style.width=(b.pt?0:Math.max(0.2,(f1-f0)*100))+"%";
  el.classList.toggle("cleared", !b.pt && b.G.span==="latch" && b.G.pair===0 && !b.e.a[0]);
  const R=el._refs;
  KIT.show(R.pt,b.pt);
  KIT.show(R.span,!b.pt);
  KIT.show(R.sqL,!b.pt);
  KIT.show(R.sqR,!b.pt);
  KIT.show(R.handle,!b.pt && RAMPARG[b.e.k]!=null);
  R.lab.textContent=scnBlockLab(b);
  R.lab.style.left=b.pt?"8px":"4px";
}

function scnSyncBlocks(LZ){
  const seen=new Set();
  for(const b of LZ.list){
    if(b.hide) continue;
    seen.add(b.e);
    let ent=UI.blocks.get(b.e);
    if(!ent){ ent={el:scnMakeBlockNode(),laneId:null}; UI.blocks.set(b.e,ent); }
    if(ent.laneId!==b.e.lane){
      const rec=UI.laneRows.get(b.e.lane);
      if(rec) rec.track.appendChild(ent.el);
      ent.laneId=b.e.lane;
    }
    if(!(UI.drag && UI.drag.el===ent.el)) scnApplyBlock(ent.el,b);
  }
  for(const [ev,ent] of UI.blocks) if(!seen.has(ev)){ ent.el.remove(); UI.blocks.delete(ev); }

  for(const L of SCN.lanes){
    const rec=UI.laneRows.get(L.id); if(!rec) continue;
    if(rec.overWrap) rec.overWrap.remove();
    const m=LZ.over[L.id]; if(!m) continue;
    const wrap=KIT.el("div");
    for(const [t,n] of m){
      const chip=KIT.el("span","scn-lane-over"); chip.textContent="+"+n;
      chip.style.left=(scnFracOf(t)*100)+"%";
      chip.style.top=((SCN_SUBMAX-0.5)*SCN_ROWH)+"px";
      wrap.appendChild(chip);
    }
    rec.track.appendChild(wrap); rec.overWrap=wrap;
  }
}

function scnSyncRuler(){
  (UI.rulerMarks||[]).forEach(n=>n.remove());
  UI.rulerMarks=[];
  const st=scnStep(scnSpan()), t0=scnT0(), t1=t0+scnSpan();
  for(let t=Math.ceil(t0/st)*st; t<=t1+1e-6; t+=st){
    const f=scnFracOf(t); if(f<-0.02||f>1.02) continue;
    const tick=KIT.el("div","scn-tick"); tick.style.left=(f*100)+"%";
    const lab=KIT.el("div","scn-tick-lab"); lab.textContent=scnFmt(t); lab.style.left=(f*100)+"%";
    UI.rulerTrack.append(tick,lab); UI.rulerMarks.push(tick,lab);
  }
  const cur=REC.takes[REC.cur];
  if(cur) for(const kid of cur.kids){
    const k=REC.takes[kid]; if(!k) continue;
    const f=scnFracOf(k.tick0*0.02); if(f<0||f>1) continue;
    const fk=KIT.el("div","scn-fork"); fk.style.left=(f*100)+"%";
    UI.rulerTrack.appendChild(fk); UI.rulerMarks.push(fk);
  }
  const pf=clamp(scnFracOf(scnPlay),0,1), inview=scnFracOf(scnPlay)>=0 && scnFracOf(scnPlay)<=1;
  KIT.show(UI.playhead,inview);
  UI.playhead.style.left=`calc(var(--scn-gutter) + ${pf*100}% - ${pf}*var(--scn-gutter))`;
}

/* ═══════════════ LIMITS: A ROW UNDER THE LANES ═══════════════
   Green where it held, red from the moment it broke - painted along the
   run's own axis rather than printed as a time. */
function scnSyncLimits(){
  while(UI.limitRows.length<SCN.limits.length){
    const row=KIT.el("div","scn-limit-row");
    const lab=KIT.el("div","scn-limit-lab");
    const bar=KIT.el("div","scn-limit-bar");
    const held=KIT.el("div","scn-limit-held");
    const broke=KIT.el("div","scn-limit-broke");
    bar.append(held,broke);
    row.append(lab,bar);
    const slot=UI.limitRows.length;
    row.addEventListener("click",()=>{
      const i=SCN.limits.indexOf(UI.limitRows[slot].L);
      if(i>=0) scnPick("lim",i);
    });
    UI.limitsRows.appendChild(row);
    UI.limitRows.push({row,lab,held,broke});
  }
  while(UI.limitRows.length>SCN.limits.length) UI.limitsRows.removeChild(UI.limitRows.pop().row);

  SCN.limits.forEach((L,i)=>{
    const rec=UI.limitRows[i]; rec.L=L;
    rec.row.classList.toggle("on", scnLimSel===i);
    const ch=limCh(L.ch);
    rec.lab.textContent=ch.lab+" "+L.cmp+L.v;
    KIT.tip(rec.row,ch.lab,
      "Must stay "+(L.cmp===">"?"above ":"below ")+L.v+
      (L.grace?", and a violation shorter than "+L.grace+" s does not count.":".")+
      " Select it to change it - the verdict is re-read off the run you already have, nothing is simulated again.");
    const r=scnVerd?scnVerd.rows.find(q=>q.L===L):null;
    if(!r){ rec.held.style.width="100%"; rec.held.style.background="var(--c-well)"; KIT.show(rec.broke,false); }
    else {
      const total=(scnTake&&scnTake.tickEnd)||1;
      const bx = r.broke ? clamp(r.tick/total,0,1) : 1;
      rec.held.style.width=(bx*100)+"%"; rec.held.style.background="";
      KIT.show(rec.broke,!!r.broke);
      if(r.broke){ rec.broke.style.left=(bx*100)+"%"; rec.broke.style.width=((1-bx)*100)+"%"; }
    }
  });
  const chk=scnChans(), pick=chk[scnLimPick%chk.length];
  UI.addLimNote.textContent="adds a limit on "+limCh(pick).lab+" - select any row to change it";
}

function scnSyncPan(){
  const t0f=scnT0()/Math.max(1e-9,SCN.secs), spanf=Math.min(1,scnSpan()/Math.max(1e-9,SCN.secs));
  UI.panThumb.style.left=(t0f*100)+"%";
  UI.panThumb.style.width=(Math.max(0.02,spanf)*100)+"%";
  UI.panZoom.textContent = scnZoom>1.001 ? scnZoom.toFixed(1)+"x" : "";
}

function scnSyncHead(){
  const h=UI.head;
  if(h.nameEl.textContent!==SCN.name) h.nameEl.textContent=SCN.name;
  h.secsSlider.set(SCN.secs);
  const busy=scnBusy()||scnProg>=0;
  h.runBtn.set({label:busy?"STOP":"RUN", on:busy});
  h.playBtn.set({on:scnArmed()===SCN});
  h.fitBtn.set({on:scnZoom>1.001});
  h.presetsBtn.set({on:scnPreOpen});
  h.saveBtn.set({on:scnSaveOpen});
  h.trendsBtn.set({on:ovlOpen==="scntrend"});
  h.logBtn.set({on:ovlOpen==="scnlog"});
  const label = scnProg>=0 ? "RUNNING "+(scnProg*100).toFixed(0)+"%"
    : !scnVerd ? "NOT RUN"
    : scnVerd.pass ? (scnVerd.assisted ? "PASS (ASSISTED)" : "PASS") : "FAIL";
  const col  = scnProg>=0 ? "var(--c-cyan)" : !scnVerd ? "var(--c-ink2)"
    : scnVerd.pass ? (scnVerd.assisted?"var(--c-amber)":"var(--c-green)") : "var(--c-red)";
  if(h.verdictEl.textContent!==label) h.verdictEl.textContent=label;
  h.verdictEl.style.color=col;
}

/* ═══════════════ THE INSPECTOR ═══════════════
   ONE selection, one strip: an event and a limit answer to the same row.
   Rebuilt whenever the selection or the selected event's KIND changes (its
   argument shapes change with it); values alone are cheap-synced every frame. */
function scnBuildEventInspector(){
  const prev=KIT.button("<",{flat:true,size:6.5});
  const title=KIT.el("span","scn-insp-title");
  const next=KIT.button(">",{flat:true,size:6.5});
  const cycle=dir=>{
    const gg=SCN.gest[scnSel]; if(!gg) return;
    const k=GESTKEYS[(GESTKEYS.indexOf(gg.k)+dir+GESTKEYS.length)%GESTKEYS.length];
    gg.k=k; gg.a=GEST[k].args.map(A=>A.def); scnLastKind=k; scnVerd=null;
  };
  prev.el.addEventListener("click",()=>cycle(-1));
  next.el.addEventListener("click",()=>cycle(1));
  const timeSlider=KIT.slider({min:0,max:SCN.secs,step:0.5,fmt:v=>"AT "+scnFmt(v),
    onChange:v=>{ const gg=SCN.gest[scnSel]; if(gg){ gg.t=scnSnapT(v); scnVerd=null; } }});
  const argsWrap=KIT.el("div","scn-insp-args");
  const del=KIT.button("X",{danger:true,size:6.5,onClick:()=>{
    const i=scnSel; if(i<0) return; SCN.gest.splice(i,1); scnSel=-1; scnVerd=null; }});
  UI.inspector.append(prev.el,title,next.el,timeSlider.el,argsWrap,del.el);

  let argW=[];
  function buildArgs(gg){
    argsWrap.innerHTML=""; argW=[];
    const G=GEST[gg.k];
    G.args.forEach((A,i)=>{
      if(typeof gg.a[i]==="number"){
        const s=KIT.slider({min:A.min!=null?A.min:0,max:A.max!=null?A.max:600,
          fmt:v=>A.lab+" "+v.toFixed(0)+(A.u||""),
          onChange:v=>{ const g2=SCN.gest[scnSel]; if(g2) g2.a[i]=Math.round(v); scnVerd=null; }});
        argsWrap.appendChild(s.el); argW.push({kind:"num",w:s,i});
      } else if(A.u==="text"){
        /* NOTE was read-only prose on canvas; HTML gives it a real field */
        const inp=KIT.el("input","scn-insp-text",{type:"text"});
        inp.value=gg.a[i]||"";
        inp.addEventListener("input",()=>{ const g2=SCN.gest[scnSel]; if(g2){ g2.a[i]=inp.value; scnVerd=null; } });
        argsWrap.appendChild(inp); argW.push({kind:"text",w:inp,i});
      } else {
        const opts = A.u==="sys" ? Object.keys(AUTOSYS) : A.u==="id" ? LAY.parts.map(p=>p.id)
                   : A.u==="on" ? [true,false] : null;
        const wrap=KIT.el("div","scn-insp-pick");
        const p=KIT.button("<",{flat:true,size:6.5});
        const val=KIT.el("span");
        const n=KIT.button(">",{flat:true,size:6.5});
        const step=dir=>{
          const g2=SCN.gest[scnSel]; if(!g2||!opts) return;
          const cur=Math.max(0,opts.findIndex(o=>String(o)===String(g2.a[i])));
          g2.a[i]=opts[(cur+dir+opts.length)%opts.length]; scnVerd=null;
        };
        p.el.addEventListener("click",()=>step(-1));
        n.el.addEventListener("click",()=>step(1));
        wrap.append(p.el,val,n.el);
        argsWrap.appendChild(wrap); argW.push({kind:"pick",val,i});
      }
    });
  }
  buildArgs(SCN.gest[scnSel]);

  return {sync(){
    const gg=SCN.gest[scnSel]; if(!gg) return;
    const G=GEST[gg.k];
    title.textContent=G.lab;
    timeSlider.set(gg.t);
    argW.forEach(w=>{
      if(w.kind==="num") w.w.set(gg.a[w.i]);
      else if(w.kind==="text"){ if(document.activeElement!==w.w) w.w.value=gg.a[w.i]||""; }
      else { const A=G.args[w.i]; w.val.textContent=A.lab+" "+gg.a[w.i]; }
    });
  }};
}

function scnBuildLimitInspector(){
  /* the value slider's min/max/fmt come from the SELECTED limit's channel,
     fixed at construction - cycling the channel changes L.ch, which changes
     scnSyncInspector()'s signature and rebuilds this whole inspector fresh,
     so there is never a stale scale to mutate in place. */
  const L0=SCN.limits[scnLimSel], top0=scnLimTop(L0.ch), u0=limCh(L0.ch).u;
  const prev=KIT.button("<",{flat:true,size:6.5});
  const title=KIT.el("span","scn-insp-title");
  const next=KIT.button(">",{flat:true,size:6.5});
  const cmpBtn=KIT.button(L0.cmp,{flat:true});
  const valSlider=KIT.slider({min:0,max:top0,fmt:v=>v.toFixed(top0<=4?2:0)+(u0?" "+u0:""),
    onChange:v=>{ const LL=SCN.limits[scnLimSel]; if(LL){ LL.v=v; scnVerd=null; } }});
  const graceSlider=KIT.slider({min:0,max:10,step:0.1,fmt:v=>"grace "+v.toFixed(1)+"s",
    onChange:v=>{ const LL=SCN.limits[scnLimSel]; if(LL){ LL.grace=Math.round(v*10)/10; scnVerd=null; } }});
  const breakInfo=KIT.el("span");
  const jumpBtn=KIT.button("JUMP",{flat:true,size:6.5,onClick:()=>{
    const LL=SCN.limits[scnLimSel]; if(!LL||!scnTake||!scnVerd) return;
    const r=scnVerd.rows.find(q=>q.L===LL);
    if(r&&r.broke){ seek(scnTake.id,r.tick); TR.paused=true; scnPlay=r.tick*0.02; }
  }});
  const del=KIT.button("X",{danger:true,size:6.5,onClick:()=>{
    const i=scnLimSel; if(i<0) return; SCN.limits.splice(i,1); scnLimSel=-1; scnVerd=null; }});

  const cycle=dir=>{
    const LL=SCN.limits[scnLimSel]; if(!LL) return;
    const chk=scnChans(), ci=Math.max(0,chk.indexOf(LL.ch));
    LL.ch=chk[(ci+dir+chk.length)%chk.length]; LL.v=0; scnVerd=null;
  };
  prev.el.addEventListener("click",()=>cycle(-1));
  next.el.addEventListener("click",()=>cycle(1));
  cmpBtn.el.addEventListener("click",()=>{
    const LL=SCN.limits[scnLimSel]; if(!LL) return;
    LL.cmp = LL.cmp==="<"?">":"<"; scnVerd=null;
  });
  UI.inspector.append(prev.el,title,next.el,cmpBtn.el,valSlider.el,graceSlider.el,
    breakInfo,jumpBtn.el,del.el);

  return {sync(){
    const LL=SCN.limits[scnLimSel]; if(!LL) return;
    const ch=limCh(LL.ch);
    title.textContent=ch.lab;
    cmpBtn.set({label:LL.cmp});
    valSlider.set(LL.v);
    graceSlider.set(LL.grace);
    const r=scnVerd?scnVerd.rows.find(q=>q.L===LL):null;
    if(r&&r.broke){
      breakInfo.className="scn-insp-break";
      breakInfo.textContent="broke "+trStamp(r.tick)+
        (typeof r.worst==="number"&&isFinite(r.worst)
          ? "  worst "+(Math.abs(r.worst)>=100?r.worst.toFixed(0):r.worst.toFixed(2))+" @ "+trStamp(r.worstAt) : "");
      KIT.show(jumpBtn.el,true);
    } else if(r){
      breakInfo.className="scn-insp-held"; breakInfo.textContent="held";
      KIT.show(jumpBtn.el,false);
    } else { breakInfo.className=""; breakInfo.textContent=""; KIT.show(jumpBtn.el,false); }
  }};
}

function scnSyncInspector(){
  const g = scnSel>=0 ? SCN.gest[scnSel] : null;
  const L = scnLimSel>=0 ? SCN.limits[scnLimSel] : null;
  const sig = g ? "ev:"+scnSel+":"+g.k : L ? "lim:"+scnLimSel+":"+L.ch : "none";
  if(UI.inspSig!==sig){
    UI.inspSig=sig;
    UI.inspector.innerHTML=""; UI.insp=null;
    if(g) UI.insp=scnBuildEventInspector();
    else if(L) UI.insp=scnBuildLimitInspector();
    else {
      const empty=KIT.el("span","scn-insp-empty");
      empty.textContent=scnNote || "nothing selected  /  click a lane to add an event, a limit row to change one";
      empty.classList.toggle("hint",!!scnNote);
      UI.inspector.appendChild(empty);
    }
  }
  if(UI.insp) UI.insp.sync();
}

/* ═══════════════ PRESETS / SAVE ═══════════════ */
function scnBuildPresets(){
  const box=KIT.well({title:"START FROM"});
  box.el.classList.add("scn-float");
  KIT.tip(box.el,"PRESETS","Three authored drills, each one passable by the default plant. Load one and change it.");
  SCNPRE.forEach(p=>{
    const row=KIT.el("div","scn-preset-row");
    const btn=KIT.button(p.name,{onClick:()=>{
      SCN=scnClone(p); scnSel=-1; scnLimSel=-1; scnVerd=null; scnFit();
      scnNote="LOADED "+p.name; scnPreOpen=false; UI.laneSig=null; UI.inspSig=null;
    }});
    const meta=KIT.el("span","scn-preset-meta");
    meta.textContent=p.secs.toFixed(0)+" s   "+p.gest.length+" events   "+p.limits.length+" limits";
    row.append(btn.el,meta);
    box.body.appendChild(row);
  });
  UI.root.appendChild(box.el);
  UI.presetsEl=box.el;
}

function scnBuildSave(){
  const box=KIT.well({title:"SAVE / LOAD"});
  box.el.classList.add("scn-float");
  KIT.tip(box.el,"SAVE / LOAD","Scenarios kept on the local server. Recordings are not saved here - they are a working artefact, not a document.");
  const offMsg=KIT.el("p","scn-save-off");
  const checkBtn=KIT.button("CHECK AGAIN",{onClick:()=>{
    storeProbe().then(()=>{ scnNote=STORE.on?"SERVER FOUND":"STILL NO SERVER"; }); }});
  const onWrap=KIT.el("div");
  const btnRow=KIT.el("div","scn-save-btnrow");
  const saveBtn=KIT.button("SAVE",{onClick:()=>{
    storeSave("scenarios",SCN.id,SCN).then(ok=>{
      scnNote=ok?("SAVED "+SCN.name):"SAVE REFUSED"; scnFiles=null; }); }});
  const refreshBtn=KIT.button("REFRESH",{onClick:()=>{
    storeList("scenarios").then(l=>{ scnFiles=l||[]; }); }});
  btnRow.append(saveBtn.el,refreshBtn.el);
  const listMsg=KIT.el("p","scn-save-msg");
  const listEl=KIT.el("div","scn-save-list");
  onWrap.append(btnRow,listMsg,listEl);
  box.body.append(offMsg,checkBtn.el,onWrap);
  UI.root.appendChild(box.el);
  UI.saveEl={el:box.el,offMsg,checkBtn,onWrap,listMsg,listEl};
}

function scnSyncFloats(){
  UI.presetsEl.classList.toggle("open",scnPreOpen);
  UI.saveEl.el.classList.toggle("open",scnSaveOpen);
  if(!scnSaveOpen) return;
  const s=UI.saveEl;
  KIT.show(s.offMsg,!STORE.on);
  KIT.show(s.checkBtn.el,!STORE.on);
  KIT.show(s.onWrap,STORE.on);
  if(!STORE.on){ s.offMsg.textContent=storeWhy(); return; }
  s.listMsg.textContent = scnFiles===null ? "press REFRESH to list what is saved"
    : !scnFiles.length ? "nothing saved yet" : "";
  const files = scnFiles? scnFiles.slice(0,7) : [];
  while(s.listEl.children.length<files.length){
    const row=KIT.el("div","scn-save-row");
    const name=KIT.el("span","scn-save-name"), meta=KIT.el("span","scn-save-meta"),
          stamp=KIT.el("span","scn-save-stamp"), load=KIT.button("LOAD",{size:6.5}),
          delB=KIT.button("DELETE",{size:6.5,danger:true});
    row.append(name,meta,stamp,load.el,delB.el);
    s.listEl.appendChild(row); row._w={name,meta,stamp,load,delB};
  }
  while(s.listEl.children.length>files.length) s.listEl.removeChild(s.listEl.lastChild);
  files.forEach((f,i)=>{
    const w=s.listEl.children[i]._w;
    w.name.textContent=f.name||f.id;
    w.meta.textContent=(f.secs||0).toFixed(0)+"s  "+(f.nGest||0)+" ev  "+(f.nLim||0)+" lim";
    w.stamp.textContent=f.saved||"";
    w.load.el.onclick=()=>storeLoad("scenarios",f.id).then(o=>{ if(o){
      SCN=scnNormalize(o); scnSel=-1; scnLimSel=-1; scnVerd=null; scnFit();
      scnNote="LOADED "+(o.name||f.id); UI.laneSig=null; UI.inspSig=null; } });
    w.delB.el.onclick=()=>storeDelete("scenarios",f.id).then(()=>{ scnFiles=null; });
  });
}

/* ═══════════════ THE CHART, STILL CANVAS ═══════════════
   chart() draws on the one shared #cv, which sits UNDER this screen's HTML in
   paint order (a positioned section always paints over a plain canvas). The
   chart slot is a transparent hole: its DOM rect, converted into #cv's own
   world units, IS the rect handed to chart() - so the canvas drawing tracks
   whatever flex layout put the slot at, every frame, with nothing hard-coded. */
function scnSyncChart(){
  const rect=UI.chartSlot.getBoundingClientRect();
  if(rect.height<SCN_CH_MIN || rect.width<40) return;
  const cvRect=cv.getBoundingClientRect();
  const scale=cvRect.width>0?cvRect.width/W:1;
  const x=(rect.left-cvRect.left)/scale, y=(rect.top-cvRect.top)/scale;
  const w=rect.width/scale, h=rect.height/scale;

  const take=scnTake, sps=1/(SAMP_TICKS*0.02);
  const nAll = take? take.trN : 0;
  const i0 = take? clamp(Math.floor(scnT0()*sps),0,Math.max(0,nAll-1)) : 0;
  const i1 = take? clamp(Math.ceil((scnT0()+scnSpan())*sps),i0+1,nAll) : 0;
  const n = i1-i0;
  const ser = (take && n>1) ? [
    {lab:"LOAD DEMAND",u:"%",col:CH.load.col,n,at:i=>trAt(take,"load",i0+i),style:"dash"},
    {lab:"POWER",      u:"%",col:CH.pwr.col, n,at:i=>trAt(take,"pwr", i0+i)}
  ] : [];
  const marks=[];
  if(take && n>1){
    const f=t=>(t*sps-i0)/n;
    for(const g of SCN.gest) if(GEST[g.k].act){ const q=f(g.t); if(q>=0&&q<=1) marks.push({f:q,col:C.edge}); }
    if(scnVerd) for(const r of scnVerd.rows) if(r.broke){ const q=f(r.tick*0.02); if(q>=0&&q<=1) marks.push({f:q,col:C.red}); }
    const q=f(scnPlay); if(q>=0&&q<=1) marks.push({f:q,col:C.amber});
  }
  const box=chart(x,y,w,h,{
    title:"DEMAND AGAINST DELIVERED", titleO:SCNH,
    series:ser, n, share:true, marks,
    empty: scnProg>=0 ? "RUNNING "+(scnProg*100).toFixed(0)+"%" : "NOTHING RUN YET / PRESS RUN",
    xlab:[scnFmt(scnT0()), scnFmt(scnT0()+scnSpan())],
    ph: Math.max(30,h-42)});
  chartLegend(box, y+h-26, ser);
}

/* TRENDS/LOG stay the control room's own canvas draws, registered a second
   time here so a scenario run's history reads exactly like free play's - see
   .claude/CLAUDE.md. Both paint into VIEW via drawOverlay(), which this HTML
   would otherwise cover, so scn-main stands down for as long as one is open;
   the head strip (with the key that opened it) stays up so it can be closed
   again. TAKES is dropped: transport.js's own strip already mounts an
   identical picker into this screen. */
ovlAdd({k:"scntrend",label:"TRENDS",h:200,sc:"scenario",draw:drawTrend,
  tip:["TRENDS","The same strip chart the control room draws, all twenty-six channels."]});
ovlAdd({k:"scnlog",  label:"LOG",   h:180,sc:"scenario",draw:drawLog,
  tip:["LOG","Every event the run logged, with the reason it gives."]});

function scnSyncOverlayVisibility(){
  UI.main.classList.toggle("scn-canvas-ovl", ovlOpen==="scntrend" || ovlOpen==="scnlog");
}

/* ═══════════════ THE SCREEN ═══════════════ */
function drawScenario(){
  if(!scnBuild()) return;
  if(scnSel>=SCN.gest.length) scnSel=-1;
  if(scnLimSel>=SCN.limits.length) scnLimSel=-1;
  const LZ=scnLay();
  scnSyncHead();
  scnSyncLanes(LZ);
  scnSyncRuler();
  scnSyncLimits();
  scnSyncPan();
  scnSyncInspector();
  scnSyncFloats();
  scnSyncOverlayVisibility();
  scnSyncChart();

  vBox(12,44,736,H-44);
  drawOverlay();
}

/* RUN is scnRun(), drained across frames so the tab still answers. Pressing
   it again cancels. */
function scnGo(){
  if(!P) return;
  if(scnBusy()){ scnCancel(); scnProg=-1; scnNote="RUN CANCELLED"; return; }
  scnVerd=null; scnTake=null; scnProg=0; scnNote="RUNNING "+SCN.name;
  scnRunAsync(SCN, f=>{ scnProg=f; },
    r=>{ scnProg=-1; scnVerd=r.verdict; scnTake=r.take;
         scnNote=SCN.name+"  "+(r.verdict.pass
           ? (r.verdict.assisted?"PASS (ASSISTED)":"PASS") : "FAIL"); });
}
keyAdd({k:"Enter", sc:"scenario", lab:"RUN", fn:scnGo});

/* PLAY arms the same compiled track on the LIVE plant and hands the player
   the control room - see .claude/CLAUDE.md "PLAY is RUN turned inside out".
   Order mirrors scnRun(): seed and diceOff must be on the plant before
   recRoot() takes its base. */
function scnFly(){
  if(!P || scnBusy()) return;
  scnVerd=null; scnTake=null; scnProg=-1;
  resetPlant();
  seedRng(S, SCN.seed>>>0);
  S.diceOff = true;
  recRoot();
  const take = recCur();
  take.label = SCN.name;
  scnArm(SCN, {end:scnTicks(SCN.secs), take, onEnd:r=>{
    scnVerd=r.verdict; scnTake=r.take;
    scnNote=SCN.name+"  "+(r.verdict.pass
      ? (r.verdict.assisted?"PASS (ASSISTED)":"PASS") : "FAIL");
  }});
  TR.paused=false; TR.rate=1;
  scnNote="FLYING "+SCN.name;
  screen="operate"; layout();
}
keyAdd({k:"p", sc:"scenario", lab:"PLAY", fn:scnFly});

function scnReset(){
  if(scnBusy()) scnCancel();
  act("reset");
  scnVerd=null; scnTake=null; scnPlay=0; scnProg=-1; scnNote="PLANT RESET";
}
