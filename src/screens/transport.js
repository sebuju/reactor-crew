"use strict";

const trSecs  = t => t*0.02;
const trStamp = t => "T+"+trSecs(t).toFixed(1);
const trName  = t => t.label || ("TAKE "+(t.id+1));

/* a bar spanning lineage(REC.cur) would shorten itself on a scrub past a fork, so span a remembered tip take. */
let trTip = 0;
function trLine(){
  if(!REC.takes[trTip] || !lineage(trTip).some(t => t.id === REC.cur)) trTip = REC.cur;
  return lineage(trTip);
}

function trBind(sc,k){
  const q = KEYS.find(r => r.k===k && (!r.sc || r.sc===sc));
  if(!q) throw new Error("transport: no key bound to "+JSON.stringify(k)+" on "+sc);
  return q;
}
keyAdd({k:" ", sc:"operate",  lab:"PAUSE", fn:trPause});
keyAdd({k:" ", sc:"scenario", lab:"PAUSE", fn:trPause});
/* past this a frame budget (MAX) is wanted rather than a rate. */
const TR_FAST_CAP=16;
/* rounded down because the measurement is a ceiling, even because the mid slot is half of it. */
function trRateSlots(){
  const fast = TR.tickMs===null ? TR_FAST_CAP
             : Math.min(TR_FAST_CAP, Math.floor(TR.rateMax/2)*2);
  if(!(fast>1)) return {mid:null, fast:null};
  const mid = fast/2;
  return {mid: mid>1?mid:null, fast};
}
const trRateLab = v => v==null ? "" : v===Infinity ? "MAX" : v===TR_VLD ? "VLD"
  : (Number.isInteger(v) ? v : v.toFixed(1))+"X";
/* a slot answers null when it holds nothing: a key that does nothing and a cell that is not drawn. */
const TR_RATES = [["0",()=>0,"0X"],["1",()=>0.2,"0.2X"],["2",()=>0.5,"0.5X"],
                  ["3",()=>1,"1X"],["4",()=>trRateSlots().mid,"MID RATE"],
                  ["5",()=>trRateSlots().fast,"FAST RATE"],
                  ["6",()=>Infinity,"MAX"],["7",()=>TR_VLD,"VLD"]];
const trRateNow = () => TR_RATES.map(r=>r[1]());
/* called after trBench(): a running rate no longer offered drops to the fastest offer below it. */
function trRateFit(){
  if(typeof TR.rate!=="number" || !isFinite(TR.rate)) return;
  const have=trRateNow().filter(v=>typeof v==="number"&&isFinite(v));
  if(have.includes(TR.rate)) return;
  const under=have.filter(v=>v<TR.rate);
  const to=under.length?under[under.length-1]:1;
  console.warn("TIMESCALE  this machine holds "+TR.rateMax.toFixed(1)+"x, so the run moves from "+
    trRateLab(TR.rate)+" to "+trRateLab(to));
  trRate(to);
}
TR_RATES.forEach((row,i)=>{
  const fn=()=>{ const v=TR_RATES[i][1](); if(v!=null) trRate(v); };
  keyAdd({k:row[0], sc:"operate",  lab:row[2], fn});
  keyAdd({k:row[0], sc:"scenario", lab:row[2], fn});
});
/* VLD is off the walk: it stops drawing the plant, which a nudge should never do. */
function trRateNudge(d){
  const have=trRateNow().filter(v=>v!=null && v!==TR_VLD);
  const at=have.indexOf(TR.paused?0:TR.rate);
  const i=Math.max(0,Math.min(have.length-1,(at<0?have.indexOf(1):at)+d));
  trRate(have[i]);
}
for(const sc of ["operate","scenario"]){
  keyAdd({k:"PageUp",   shift:true, sc, lab:"RATE +", fn:()=>trRateNudge(1)});
  keyAdd({k:"PageDown", shift:true, sc, lab:"RATE -", fn:()=>trRateNudge(-1)});
}
for(const sc of ["operate","scenario"]){
  keyAdd({k:",", sc, lab:"STEP -", fn:trStepBack});
  keyAdd({k:".", sc, lab:"STEP +", fn:trStep});
}


function trBuild(sc){
  const mount = document.getElementById("scr-"+sc);
  if(!mount) return null;

  const root = KIT.el("div","trs");

  const rate = KIT.segSel(trRateNow().map(trRateLab),
    {onSelect:i=>trBind(sc,TR_RATES[i][0]).fn()});
  rate.el.classList.add("trs-rate");
  KIT.tip(rate.el.children[TR_RATES.findIndex(r=>r[1]()===TR_VLD)],"VLD / VALIDATION RUN",
    "Runs as fast as MAX and stops drawing the plant while it does, so the whole frame goes into the sim - only the clock and the tick counter in the topbar keep moving. The alarms already lit when you start it are stashed; the first tile that was NOT lit then drops the run back to 1x and hands the plant back to you.");

  const stepBack = KIT.button("STEP -",{sunk:1,onClick:trBind(sc,",").fn,
    tip:"Puts the plant back one 0.02 s tick and leaves it paused. It is a scrub, not an undo: the tick is re-derived from the last keyframe, so it is exact but it costs more than stepping forward, and it puts you in REPLAY the same way dragging the bar does."});
  stepBack.el.classList.add("trs-fixw");
  const step = KIT.button("STEP +",{sunk:1,onClick:trBind(sc,".").fn,
    tip:"Advances the plant by one 0.02 s tick and leaves it paused. The one way to watch a fast transient happen rather than watching what it left behind."});
  step.el.classList.add("trs-fixw");

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

  const track = KIT.el("div","trs-track");
  const logLane = KIT.el("div","trs-logs");
  const scrub = KIT.el("div","trs-scrub");
  const scrubHead = KIT.el("div","trs-scrub-head");
  scrub.appendChild(scrubHead);
  track.append(logLane,scrub);

  const clock = KIT.el("span","trs-clock");
  KIT.tip(clock,"PLAYHEAD","Where the plant stands in this lineage, and where the recording of it ends. Sim seconds, not seconds you have been sitting here - at 16x these advance sixteen times faster than the clock on the wall.");

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
  MOUSE.on(takesBtn.el,{click(){ picker.el.classList.toggle("open"); }});

  root.append(rate.el,stepBack.el,step.el,modeEl,notape,nameEl,forkEl,track,
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
  const scrubStop=()=>{ dragging=false; };
  MOUSE.on(scrub,{
    down(e){ dragging=true; MOUSE.grab(scrub); scrubMove(e); },
    move:scrubMove, up:scrubStop, cancel:scrubStop});

  return {sc,root,rate,stepBack,step,modeEl,notape,nameEl,forkEl,track,logLane,scrub,scrubHead,
    clock,takesBtn,picker,pickTree,blocks:[],forks:[],marks:[],
    pickSig:null,parSig:null,forkSig:null,rateSig:null};
}

const TRS_SLOT=9;                                // px per mark: 8 of body, 1 of gutter
const SEV_RANK={alarm:3,warn:2,act:1,info:0};
/* marks sharing a slot collapse into one carrying the WORST severity, so a group cannot hide an alarm. */
function trMarkGroups(t0,tEnd,slots){
  const out=[], span=Math.max(1,tEnd-t0);
  let g=null;
  for(const e of LOG){
    if(e.tick<t0||e.tick>tEnd) continue;
    const slot=clamp(Math.round(((e.tick-t0)/span)*(slots-1)),0,slots-1);
    if(g && g.slot===slot){ g.evs.push(e); if(SEV_RANK[e.sev]>SEV_RANK[g.sev]) g.sev=e.sev; }
    else { g={slot,sev:e.sev,evs:[e]}; out.push(g); }
  }
  return out;
}
function trMarksSync(h,t0,tEnd){
  /* measured off the LANE, not the bar: the marks are laid out in it, and its transparent border matches the bar's real one. */
  const wpx=h.logLane.clientWidth;
  if(wpx<=0) return;
  const slots=Math.max(1,Math.floor(wpx/TRS_SLOT));
  const groups=trMarkGroups(t0,tEnd,slots);
  while(h.marks.length<groups.length){ const m=KIT.el("div","trs-log"); h.logLane.appendChild(m); h.marks.push(m); }
  while(h.marks.length>groups.length) h.logLane.removeChild(h.marks.pop());
  groups.forEach((g,i)=>{
    const m=h.marks[i], n=g.evs.length;
    KIT.setStyle(m,"left",g.slot*TRS_SLOT+"px");
    const cls="trs-log "+g.sev;
    if(m.className!==cls) m.className=cls;
    KIT.setText(m, n>1 ? String(Math.min(n,9)) : logSev(g.evs[0]).sym);
    KIT.tip(m, n>1 ? n+" EVENTS AT T+"+trSecs(g.evs[0].tick).toFixed(1)
                   : "T+"+trSecs(g.evs[0].tick).toFixed(1),
      g.evs.map(e=>logSev(e).tag+" "+e.msg).join("   /   "));
  });
}

function trTape(h,on){
  KIT.setStyle(h.notape,"display",on?"none":"");
  for(const el of [h.nameEl,h.forkEl,h.track,h.clock]) KIT.setStyle(el,"display",on?"":"none");
}
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
    MOUSE.on(fork,{click(){ seek(par.id,t.tick0); }});
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

function trRateOffer(h){
  const vals=trRateNow(), sig=vals.join(",");
  if(sig===h.rateSig) return;
  h.rateSig=sig;
  vals.forEach((v,i)=>{
    const cell=h.rate.el.children[i];
    if(!cell) return;
    KIT.show(cell, v!=null);
    if(v==null || typeof v!=="number" || !isFinite(v)) return;
    KIT.setText(cell.querySelector(".kit-segsel-name"), trRateLab(v));
    KIT.tip(cell, trRateLab(v)+" / TIMESCALE",
      trRateLab(v)+" is "+(v*50)+" ticks a second of plant time. "+(TR.tickMs===null
        ? "Nothing has been commissioned yet, so this is the standing pair; the two multipliers become this machine's own the moment a plant is built."
        : "This machine measures "+TR.tickMs.toFixed(1)+" ms a tick, so it holds about "+
          TR.rateMax.toFixed(1)+"x - the two multipliers on this strip are that measurement, not a fixed pair."));
  });
}

function trSync(h){
  if(!h) return;
  /* both strips share one interval; a display:none subtree has clientWidth 0, so syncing it lays marks out wrong. */
  if(screen !== h.sc) return;
  const cur = recCur();
  h.rate.set(trRateNow().findIndex(v=>v===(TR.paused?0:TR.rate)));
  trRateOffer(h);
  h.modeEl.classList.toggle("replay", REC.mode==="replay");
  if(trQuiet()) return;

  const many = REC.takes.filter(Boolean).length>1;
  h.takesBtn.el.classList.toggle("hide", !many);
  if(!many) h.picker.el.classList.remove("open");

  if(!cur){
    trTape(h,false);
    return;
  }
  trTape(h,true);

  KIT.setText(h.nameEl, trName(cur));
  const par = cur.parent===null ? null : REC.takes[cur.parent];
  if(par){
    KIT.setText(h.forkEl, "<- "+(par.id+1)+" @ "+trStamp(cur.tick0));
  } else {
    KIT.setText(h.forkEl, "ROOT");
  }
  h.forkEl.classList.toggle("root", !par);
  /* KIT.tip() dedupes writes, but the paragraph still has to be built to find that out. */
  const parSig = cur.id+":"+(par?par.id+"@"+cur.tick0:"root");
  if(parSig!==h.parSig){
    h.parSig=parSig;
    const parTip = (par ? "Forked off "+trName(par)+" at "+trStamp(cur.tick0)+", so everything before that belongs to the parent and is shared with it."
         : "A root run: this take starts at the reset that made the plant and owes nothing to any other.")+
        " A recording is a forest, not a list - the run you scrubbed away from is still a run, so it stays as the parent and the second attempt hangs off it.";
    KIT.tip(h.nameEl,trName(cur),parTip);
    KIT.tip(h.forkEl,trName(cur),parTip);
  }

  const line = trLine(), tip = REC.takes[trTip];
  const t0 = line[0].tick0, tEnd = Math.max(tip.tickEnd,t0+1);
  KIT.setText(h.clock, trStamp(S.tick)+" / "+trSecs(tEnd).toFixed(1));

  const frac = t => Math.max(0,Math.min(1,(t-t0)/(tEnd-t0)))*100;
  while(h.blocks.length<line.length){ const b=KIT.el("div","trs-scrub-block"); h.scrub.insertBefore(b,h.scrubHead); h.blocks.push(b); }
  while(h.blocks.length>line.length) h.scrub.removeChild(h.blocks.pop());
  line.forEach((t,i)=>{
    const a=frac(t.tick0), b=frac(i<line.length-1?line[i+1].tick0:tip.tickEnd);
    const el=h.blocks[i];
    KIT.setStyle(el,"left",a+"%");
    KIT.setStyle(el,"width",Math.max(0.3,b-a)+"%");
    el.classList.toggle("cur", t.id===REC.cur);
  });

  /* only branches that LEFT this line get a ring; a take's own successor is already the next segment. */
  const onLine=new Set(line.map(t=>t.id));
  const gone=[];
  for(const t of line) for(const k of t.kids){
    const c=REC.takes[k];
    if(c && !onLine.has(c.id)) gone.push(c);
  }
  const forks=gone.length;
  while(h.forks.length<forks){ const f=KIT.el("div","trs-scrub-fork"); h.scrub.insertBefore(f,h.scrubHead); h.forks.push(f); }
  while(h.forks.length>forks) h.scrub.removeChild(h.forks.pop());
  gone.forEach((c,i)=>KIT.setStyle(h.forks[i],"left",frac(c.tick0)+"%"));
  KIT.setStyle(h.scrubHead,"left",frac(S.tick)+"%");
  trMarksSync(h,t0,tEnd);
  if(forks!==h.forkSig){
    h.forkSig=forks;
    KIT.tip(h.scrub,"SCRUB",
      "Press anywhere on the line to put the plant there, and drag to run it under the hand. The line is the whole lineage you are in: one segment per take, a filled dot where each take begins, and "+forks+" hollow ring(s) where a branch left this run for a future you are not watching. Scrubbing is watching and costs you nothing - the fork happens when you touch a control.");
  }

  if(h.picker.el.classList.contains("open")){
    /* LENGTH, VERDICT and ASSISTED move while the picker is held open, so a sig of ids alone goes stale. */
    const sig = REC.takes.map(t=>t&&(t.id+":"+t.kids.join(",")+":"+t.tickEnd+":"+
      (t.label||"")+":"+(t.verdict||"")+":"+(t.assisted?1:0))).join("|")+"|"+REC.cur;
    if(sig!==h.pickSig){
      h.pickSig=sig;
      h.pickTree.innerHTML="";
      trPickerBuild(h.pickTree, REC.roots.filter(r=>REC.takes[r]));
      KIT.reveal(h.pickTree.querySelector && h.pickTree.querySelector(".trs-take-row.on"));
    }
  }
}

const TRS_STRIP = {};
const trStrip = sc => TRS_STRIP[sc] || null;

if(typeof document!=="undefined" && document.documentElement){
  for(const sc of ["operate","scenario"]) TRS_STRIP[sc] = trBuild(sc);
  const syncAll = () => { for(const sc in TRS_STRIP) trSync(TRS_STRIP[sc]); };
  syncAll();
  setInterval(syncAll,100);
}
