"use strict";
/* The transport strip - HTML now (docs/kit-api.md). trBuild()/trSync() at the
   foot of this file mount it into #scr-operate and #scr-scenario. */

const TRSTRIP_H = 22;
/* kept only because control-room.js/scenario.js still call these on canvas */

const trSecs  = t => t*0.02;
const trStamp = t => "T+"+trSecs(t).toFixed(1);
const trName  = t => t.label || ("TAKE "+(t.id+1));

/* seek() puts REC.cur on the take that OWNS a tick, so a bar drawn against
   lineage(REC.cur) would shorten itself on a scrub past a fork. Span a
   remembered TIP take instead; it only moves once REC.cur leaves its lineage. */
let trTip = 0;
function trLine(){
  if(!REC.takes[trTip] || !lineage(trTip).some(t => t.id === REC.cur)) trTip = REC.cur;
  return lineage(trTip);
}

/* on-screen key and keystroke share one KEYS row; throws rather than building a dead key. */
function trBind(sc,k){
  const q = KEYS.find(r => r.k===k && (!r.sc || r.sc===sc));
  if(!q) throw new Error("transport: no key bound to "+JSON.stringify(k)+" on "+sc);
  return q;
}
keyAdd({k:" ", sc:"operate",  lab:"PAUSE", fn:trPause});
keyAdd({k:" ", sc:"scenario", lab:"PAUSE", fn:trPause});
const TR_RATES = [["1",1,"1X"],["2",4,"4X"],["3",16,"16X"]];
for(const [key,r] of TR_RATES){
  keyAdd({k:key, sc:"operate",  lab:r+"x", fn:()=>trRate(r)});
  keyAdd({k:key, sc:"scenario", lab:r+"x", fn:()=>trRate(r)});
}
keyAdd({k:".", sc:"operate",  lab:"STEP", fn:trStep});
keyAdd({k:".", sc:"scenario", lab:"STEP", fn:trStep});


/* ─────────────── build (once per screen) ─────────────── */
function trBuild(sc){
  const mount = document.getElementById("scr-"+sc);
  if(!mount) return null;

  const root = KIT.el("div","trs");

  const pause = KIT.button("PAUSE",{sunk:1,onClick:trBind(sc," ").fn});

  const rate = KIT.segSel(TR_RATES.map(r=>r[2]),
    {onSelect:i=>trBind(sc,TR_RATES[i][0]).fn()});
  rate.el.classList.add("trs-rate");

  const step = KIT.button("STEP",{sunk:1,onClick:trBind(sc,".").fn,
    tip:"Advances the plant by one 0.02 s tick and leaves it paused. The one way to watch a fast transient happen rather than watching what it left behind."});

  const modeEl = KIT.el("div","trs-mode");
  const live = KIT.el("span","trs-live"); live.textContent="LIVE";
  KIT.tip(live,"LIVE","The plant is running forward and every input you make is being written to the tape. Scrub back and this reads REPLAY instead, with the keys to watch on or to take the run somewhere else.");
  const replayBtns = KIT.el("div","trs-replaybtns");
  const replayBtn = KIT.button("REPLAY",{sunk:1,onClick:()=>trRate(TR.rate)});
  KIT.tip(replayBtn.el,"REPLAY","Runs the tape on from here. WATCHING DOES NOT FORK: reviewing a run forward changes nothing and leaves no second copy of it in the tree, however many times you do it.");
  const takeHereBtn = KIT.button("TAKE HERE",{sunk:1,onClick:()=>recBranch(REC.cur,S.tick)});
  KIT.tip(takeHereBtn.el,"TAKE HERE","Forks the recording at this moment and runs live from it. TOUCHING FORKS: putting your hand on any control while a replay is up does exactly this by itself, because that is the first moment the two futures can differ. This key is the way to ask for it on purpose, so nothing about the tree is ever a surprise.");
  replayBtns.append(replayBtn.el,takeHereBtn.el);
  modeEl.append(live,replayBtns);

  const notape = KIT.el("span","trs-notape"); notape.textContent="NO TAPE YET";
  KIT.tip(notape,"NO TAPE YET","The recording opens on the first tick this plant runs. Nothing in the sim calls the recorder, so until then there is genuinely nothing to scrub.");

  const nameEl = KIT.el("span","trs-name");
  const forkEl = KIT.el("span","trs-fork");

  /* the log gets a lane of its OWN above the bar rather than marks on it: a
     marker on the bar is a marker the hand has to miss to scrub past it */
  const track = KIT.el("div","trs-track");
  const logLane = KIT.el("div","trs-logs");
  const scrub = KIT.el("div","trs-scrub");
  const scrubHead = KIT.el("div","trs-scrub-head");
  scrub.appendChild(scrubHead);
  track.append(logLane,scrub);

  const clock = KIT.el("span","trs-clock");

  const takesBtn = KIT.button("TAKES",{sunk:1});
  takesBtn.el.classList.add("trs-takes-btn");
  KIT.tip(takesBtn.el,"TAKES","Every run this plant has had, as the tree it is: scrub back, try it the other way, and the run you left is still there as the parent of the one you are on.");
  const picker = KIT.well({title:"TAKES / EVERY RUN THIS PLANT HAS HAD"});
  picker.el.classList.add("trs-picker");
  const pickHead = KIT.el("div","trs-take-head");
  const hRun=KIT.el("span"); hRun.textContent="RUN";
  const hFork=KIT.el("span","col-fork"); hFork.textContent="FORKED FROM";
  const hLen=KIT.el("span","col-len"); hLen.textContent="LENGTH";
  const hAssist=KIT.el("span","col-assist");
  const hVerd=KIT.el("span","col-verd"); hVerd.textContent="VERDICT";
  pickHead.append(hRun,hFork,hLen,hAssist,hVerd);
  const pickTree = KIT.el("div","trs-take-tree");
  picker.body.append(pickHead,pickTree);
  takesBtn.el.addEventListener("click",()=>picker.el.classList.toggle("open"));

  root.append(pause.el,rate.el,step.el,modeEl,notape,nameEl,forkEl,track,
    clock,takesBtn.el);
  mount.appendChild(root);
  mount.appendChild(picker.el);

  let dragging=false;
  const scrubTickAt = e=>{
    const line=trLine(); if(!line.length) return null;
    const tip=REC.takes[trTip]; if(!tip) return null;
    const t0=line[0].tick0, tEnd=Math.max(tip.tickEnd,t0+1);
    const r=scrub.getBoundingClientRect();
    const frac=Math.max(0,Math.min(1,(e.clientX-r.left)/Math.max(1,r.width)));
    return Math.round(t0+(tEnd-t0)*frac);
  };
  const scrubMove = e=>{
    if(!dragging) return;
    const t=scrubTickAt(e);
    if(t!==null && S && t!==S.tick) seek(trTip,t);
  };
  scrub.addEventListener("pointerdown",e=>{
    dragging=true;
    if(scrub.setPointerCapture) scrub.setPointerCapture(e.pointerId);
    scrubMove(e);
  });
  scrub.addEventListener("pointermove",scrubMove);
  scrub.addEventListener("pointerup",()=>{ dragging=false; });
  scrub.addEventListener("pointercancel",()=>{ dragging=false; });

  return {sc,root,pause,rate,step,modeEl,notape,nameEl,forkEl,track,logLane,scrub,scrubHead,
    clock,takesBtn,picker,pickTree,blocks:[],forks:[],marks:[],pickSig:null};
}

/* ═══════════ THE EVENT LOG, ON THE SCRUB BAR ═══════════
   The log is a list of moments and the scrub bar is a line of moments, so the
   log belongs on it: the point of a recording is to go back to the second
   something happened, and reading a time off a list and then hunting for it
   with the hand is the long way round.

   ── THEY ARE GROUPED, NOT DRAWN ON TOP OF EACH OTHER ──
   A trip raises six entries inside a second, which on a 300 px bar is six
   marks inside one pixel: unreadable, and the top one is the only one you can
   ever hover. So marks within MARK_GAP px of the first of a run collapse into
   ONE, showing the count instead of a symbol and carrying every message in its
   tooltip. The severity shown is the WORST in the group - a group that hid an
   alarm behind four control actions would be a group that lies.
   Grouping is done in PIXELS and not in ticks on purpose: what may overlap is a
   question about the bar's width, and the bar is elastic. */
const MARK_GAP=9;
const SEV_RANK={alarm:3,warn:2,act:1,info:0};
function trMarkGroups(t0,tEnd,wpx){
  const out=[], span=Math.max(1,tEnd-t0);
  const gap=MARK_GAP/Math.max(1,wpx);           // as a fraction of the bar
  let g=null;
  for(const e of LOG){
    if(e.tick<t0||e.tick>tEnd) continue;
    const f=(e.tick-t0)/span;
    if(g && f-g.f0<gap){ g.evs.push(e); if(SEV_RANK[e.sev]>SEV_RANK[g.sev]) g.sev=e.sev; }
    else { g={f0:f,f,sev:e.sev,evs:[e]}; out.push(g); }
  }
  return out;
}
function trMarksSync(h,t0,tEnd){
  const wpx=h.scrub.clientWidth||1;
  const groups=trMarkGroups(t0,tEnd,wpx);
  while(h.marks.length<groups.length){ const m=KIT.el("div","trs-log"); h.logLane.appendChild(m); h.marks.push(m); }
  while(h.marks.length>groups.length) h.logLane.removeChild(h.marks.pop());
  groups.forEach((g,i)=>{
    const m=h.marks[i], n=g.evs.length;
    const left=(g.f*100).toFixed(3)+"%";
    if(m.style.left!==left) m.style.left=left;
    const cls="trs-log "+g.sev;
    if(m.className!==cls) m.className=cls;
    const sym = n>1 ? String(Math.min(n,9)) : logSev(g.evs[0]).sym;
    if(m.textContent!==sym) m.textContent=sym;
    KIT.tip(m, n>1 ? n+" EVENTS AT T+"+trSecs(g.evs[0].tick).toFixed(1)
                   : "T+"+trSecs(g.evs[0].tick).toFixed(1),
      g.evs.map(e=>logSev(e).tag+" "+e.msg).join("   /   "));
  });
}

/* ─────────────── sync (cheap, every pass) ─────────────── */
function trPickerRow(t){
  const row = KIT.el("div","trs-take-row");
  row.classList.toggle("on", t.id===REC.cur);
  const go = KIT.button("GO",{sunk:1,size:7,onClick:()=>seek(t.id,t.tickEnd)});
  go.el.classList.add("trs-take-go");
  const name = KIT.el("span","trs-take-name"); name.textContent=trName(t);
  const par = t.parent===null ? null : REC.takes[t.parent];
  let fork;
  if(par){
    fork = KIT.el("button","trs-take-fork",{type:"button"});
    fork.textContent = "<- "+trName(par)+" @ "+trStamp(t.tick0);
    fork.addEventListener("click",()=>seek(par.id,t.tick0));
    KIT.tip(fork,"FORK POINT","Click to put the plant on "+trName(par)+" at the moment "+trName(t)+" split off it - the state both runs share, and where you would start from to try a third way.");
  } else {
    fork = KIT.el("span","trs-take-root"); fork.textContent="ROOT";
  }
  const len = KIT.el("span","trs-take-len");
  len.textContent = trSecs(t.tickEnd-t.tick0).toFixed(1)+" s";
  const assist = KIT.el("span","trs-take-assist");
  if(t.assisted) assist.textContent="ASSISTED";
  const verd = KIT.el("span","trs-take-verd");
  if(t.verdict){ verd.textContent=scnVerdLab(t.verdict); verd.style.color=scnVerdCol(t.verdict); }
  KIT.tip(row,trName(t),
    "Design "+t.head.dsig+", seed "+t.head.seed+". Runs "+trStamp(t.tick0)+" to "+
    trStamp(t.tickEnd)+", "+t.evs.length+" recorded input(s)."+
    (t.assisted?" ASSISTED: this run was scrubbed into rather than flown straight through.":"")+
    " GO puts the plant at the end of it.");
  row.append(go.el,name,fork,len,assist,verd);
  return row;
}
function trPickerBuild(container,ids){
  for(const id of ids){
    const t=REC.takes[id]; if(!t) continue;
    container.appendChild(trPickerRow(t));
    const kids=t.kids.filter(k=>REC.takes[k]);
    if(kids.length){
      const wrap=KIT.el("div","trs-take-kids");
      container.appendChild(wrap);
      trPickerBuild(wrap,kids);
    }
  }
}

function trSync(h){
  if(!h) return;
  const cur = recCur();
  h.pause.set({label:TR.paused?"PLAY":"PAUSE", on:TR.paused});
  h.rate.set(TR_RATES.findIndex(r=>r[1]===TR.rate));
  h.modeEl.classList.toggle("replay", REC.mode==="replay");

  const many = REC.takes.filter(Boolean).length>1;
  h.takesBtn.el.classList.toggle("hide", !many);
  if(!many) h.picker.el.classList.remove("open");

  if(!cur){
    h.notape.style.display="";
    h.nameEl.style.display="none"; h.forkEl.style.display="none";
    h.track.style.display="none"; h.clock.style.display="none";
    return;
  }
  h.notape.style.display="none";
  h.nameEl.style.display=""; h.forkEl.style.display="";
  h.track.style.display=""; h.clock.style.display="";

  h.nameEl.textContent = trName(cur);
  const par = cur.parent===null ? null : REC.takes[cur.parent];
  if(par){
    h.forkEl.textContent = "<- "+(par.id+1)+" @ "+trStamp(cur.tick0);
    h.forkEl.classList.remove("root");
  } else {
    h.forkEl.textContent = "ROOT";
    h.forkEl.classList.add("root");
  }
  const parTip = (par ? "Forked off "+trName(par)+" at "+trStamp(cur.tick0)+", so everything before that belongs to the parent and is shared with it."
       : "A root run: this take starts at the reset that made the plant and owes nothing to any other.")+
      " A recording is a forest, not a list - the run you scrubbed away from is still a run, so it stays as the parent and the second attempt hangs off it.";
  KIT.tip(h.nameEl,trName(cur),parTip);
  KIT.tip(h.forkEl,trName(cur),parTip);

  const line = trLine(), tip = REC.takes[trTip];
  const t0 = line[0].tick0, tEnd = Math.max(tip.tickEnd,t0+1);
  h.clock.textContent = trStamp(S.tick)+" / "+trSecs(tEnd).toFixed(1);
  KIT.tip(h.clock,"PLAYHEAD","Where the plant stands in this lineage, and where the recording of it ends. Sim seconds, not seconds you have been sitting here - at 16x these advance sixteen times faster than the clock on the wall.");

  const frac = t => Math.max(0,Math.min(1,(t-t0)/(tEnd-t0)))*100;
  while(h.blocks.length<line.length){ const b=KIT.el("div","trs-scrub-block"); h.scrub.insertBefore(b,h.scrubHead); h.blocks.push(b); }
  while(h.blocks.length>line.length) h.scrub.removeChild(h.blocks.pop());
  line.forEach((t,i)=>{
    const a=frac(t.tick0), b=frac(i<line.length-1?line[i+1].tick0:tip.tickEnd);
    const el=h.blocks[i];
    el.style.left=a+"%"; el.style.width=Math.max(0.3,b-a)+"%";
    el.classList.toggle("cur", t.id===REC.cur);
  });

  let forks=0;
  for(const t of line) forks += t.kids.filter(k=>REC.takes[k]).length;
  while(h.forks.length<forks){ const f=KIT.el("div","trs-scrub-fork"); h.scrub.insertBefore(f,h.scrubHead); h.forks.push(f); }
  while(h.forks.length>forks) h.scrub.removeChild(h.forks.pop());
  { let i=0;
    for(const t of line) for(const k of t.kids){
      const c=REC.takes[k]; if(!c) continue;
      h.forks[i++].style.left=frac(c.tick0)+"%";
    }
  }
  h.scrubHead.style.left = frac(S.tick)+"%";
  trMarksSync(h,t0,tEnd);
  KIT.tip(h.scrub,"SCRUB",
    "Press anywhere on the bar to put the plant there, and drag to run it under the hand. The bar is the whole lineage you are in, one block per take; the amber ticks are the "+forks+" place(s) this run has been forked. Scrubbing is watching and costs you nothing - the fork happens when you touch a control.");

  if(h.picker.el.classList.contains("open")){
    const sig = REC.takes.map(t=>t&&(t.id+":"+t.kids.join(","))).join("|")+"|"+REC.cur;
    if(sig!==h.pickSig){
      h.pickSig=sig;
      h.pickTree.innerHTML="";
      trPickerBuild(h.pickTree, REC.roots.filter(r=>REC.takes[r]));
      KIT.reveal(h.pickTree.querySelector && h.pickTree.querySelector(".trs-take-row.on"));
    }
  }
}

if(typeof document!=="undefined" && document.documentElement){
  const TR_STRIP_OPERATE  = trBuild("operate");
  const TR_STRIP_SCENARIO = trBuild("scenario");
  trSync(TR_STRIP_OPERATE); trSync(TR_STRIP_SCENARIO);
  setInterval(()=>{ trSync(TR_STRIP_OPERATE); trSync(TR_STRIP_SCENARIO); },100);
}
