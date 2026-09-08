"use strict";

const urlSlug = s => String(s).toLowerCase().replace(/^[\d?]+\s+/,"")
                              .replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

const urlTabRows  = () => [...document.querySelectorAll("#tabs .tab")]
  .map(btn => ({keys:[btn.dataset.screen, urlSlug(btn.textContent)], btn}));
const urlPreRows  = () => PLANTPRE.map((p,i) => ({keys:[urlSlug(p[0])], i}));
/* built off what the strip is offering NOW - "3-5" for a 3.5X slot. */
const urlRateRows = () => trRateNow().filter(v=>v!=null).map(v => {
  const s = urlSlug(trRateLab(v));
  return {keys:[s, s.replace(/^([\d-]+)x$/,"$1")], v};
});

function urlApply(){
  const q = new URLSearchParams(location.search);
  const pick = (k,rows) => {
    const v = q.get(k); if(!v) return null;
    const hit = rows.find(r => r.keys.includes(urlSlug(v)));
    if(!hit) console.warn("url: unknown "+k+"="+v+" - have "+rows.map(r=>r.keys[0]).join(", "));
    return hit||null;
  };
  // no preset named is the STOCK SHIP: D ships blank
  const pr = pick("preset",urlPreRows());
  const pi = pr ? pr.i : 0;
  plantPreset(pi); urlPreset(pi); sel=null; uiDirty();
  // through its own button, so commissioning and every shellInit() screen guard run as they do under the hand
  const tb = pick("tab",urlTabRows());
  if(tb) tb.btn.click();
  /* nothing has been measured this early, so a plain number is taken as written and trRateFit() fits it later. */
  const tsRaw = q.get("timescale"), tsNum = tsRaw && Number(tsRaw.replace(/x$/i,""));
  if(tsNum>0) trRate(tsNum);
  else { const ts = pick("timescale",urlRateRows()); if(ts) trRate(ts.v); }
}

/* the preset param is gated on DGEN, not designSig(): bake() writes derived scalars on first read, so the sig moves on its own. */
let urlPreI=null, urlPreGen=null, urlLast=null, urlWrite=true;

/* settle first: plantPreset() forgets the machine sizes, so the next pass bakes them back and DGEN moves again. */
function urlPreset(i){ layFresh(); urlPreI=i; urlPreGen=DGEN; }

function urlSync(){
  if(!urlWrite) return;
  /* built fresh, never edited in place, so a misspelt param is dropped rather than carried through every reload. */
  const q=new URLSearchParams();
  const tb=urlTabRows().find(r=>r.btn.dataset.screen===screen);
  q.set("tab", tb?tb.keys[tb.keys.length-1]:screen);
  const rt=urlRateRows().find(r=>r.v===TR.rate);
  if(rt) q.set("timescale",rt.keys[rt.keys.length-1]); else q.delete("timescale");
  if(urlPreI!=null && DGEN===urlPreGen) q.set("preset",urlPreRows()[urlPreI].keys[0]);
  else { urlPreI=null; q.delete("preset"); }
  const s="?"+q;
  if(s===urlLast) return;
  urlLast=s;
  // a file:// page has no origin to rewrite
  try{ history.replaceState(null,"",s+location.hash); }catch(e){ urlWrite=false; }
}
