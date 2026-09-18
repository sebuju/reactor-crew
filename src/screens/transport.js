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
/* only when nothing was measured: a clock with no resolution still gets a strip. */
const TR_FAST_UNMEASURED=16;
/* rounded down because the measurement is a ceiling, even because the mid slot is half of it. */
function trRateSlots(){
  const fast = TR.tickMs===null ? TR_FAST_UNMEASURED : Math.floor(TR.rateMax/2)*2;
  if(!(fast>1)) return {mid:null, fast:null};
  const mid = fast/2;
  return {mid: mid>1?mid:null, fast};
}
const trRateLab = v => v==null ? "" : v===Infinity ? "MAX" : v===TR_VLD ? "VLD"
  : v > 0 && v < 0.95 ? "X/"+Math.round(1/v)
  : (Number.isInteger(v) ? v : v.toFixed(1))+"X";
/* a slot answers null when it holds nothing: a key that does nothing and a cell that is not drawn.
   X/40 is tools/wavemock.html's slowest, the one speed a blast front can be watched crossing the room at. */
const TR_RATES = [["0",()=>0,"0X"],["8",()=>0.025,"X/40"],["1",()=>0.2,"X/5"],["2",()=>0.5,"X/2"],
                  ["3",()=>1,"1X"],["4",()=>trRateSlots().mid,"MID RATE"],
                  ["5",()=>trRateSlots().fast,"FAST RATE"],
                  ["6",()=>Infinity,"MAX"],["7",()=>TR_VLD,"VLD"]];
const trRateNow = () => TR_RATES.map(r=>r[1]());
const TR_STRIP_RATES = TR_RATES.filter(r=>r[0]!=="2"&&r[0]!=="7");
const trStripNow = () => TR_STRIP_RATES.map(r=>r[1]());
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


/* only the rate strip is per screen, and each screen's head hosts it; the take picker and the replay keys live on the timeline */
function trBuild(sc){
  const rate = KIT.segSel(trStripNow().map(trRateLab),
    {onSelect:i=>trBind(sc,TR_STRIP_RATES[i][0]).fn()});
  rate.el.classList.add("trs-rate");
  return {sc,rate,rateSig:null};
}

/* the recorder timeline (render/recviz.js) reads this to rank marks that share a slot; a group cannot hide an alarm */
const SEV_RANK={alarm:3,warn:2,act:1,info:0};

function trRateOffer(h){
  const vals=trStripNow(), sig=vals.join(",");
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
  if(screen !== h.sc) return;
  h.rate.set(trStripNow().findIndex(v=>v===(TR.paused?0:TR.rate)));
  trRateOffer(h);
}

const TRS_STRIP = {};
const trStrip = sc => TRS_STRIP[sc] || null;

if(typeof document!=="undefined" && document.documentElement){
  for(const sc of ["operate","scenario"]) TRS_STRIP[sc] = trBuild(sc);
  const syncAll = () => { for(const sc in TRS_STRIP) trSync(TRS_STRIP[sc]); };
  syncAll();
  setInterval(syncAll,100);
}
