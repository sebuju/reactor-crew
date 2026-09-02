"use strict";
/* Deep links: ?tab= ?preset= ?timescale=. Every accepted value is read off the
   table that already defines the thing, so a new tab, preset or rate needs no
   edit here. */

const urlSlug = s => String(s).toLowerCase().replace(/^[\d?]+\s+/,"")
                              .replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

const urlTabRows  = () => [...document.querySelectorAll("#tabs .tab")]
  .map(btn => ({keys:[btn.dataset.screen, urlSlug(btn.textContent)], btn}));
const urlPreRows  = () => PLANTPRE.map((p,i) => ({keys:[urlSlug(p[0])], i}));
const urlRateRows = () => TR_RATES.map(r => {
  const s = urlSlug(r[2]);
  return {keys:[s, s.replace(/^(\d+)x$/,"$1")], v:r[1]};
});

function urlApply(){
  const q = new URLSearchParams(location.search);
  const pick = (k,rows) => {
    const v = q.get(k); if(!v) return null;
    const hit = rows.find(r => r.keys.includes(urlSlug(v)));
    if(!hit) console.warn("url: unknown "+k+"="+v+" - have "+rows.map(r=>r.keys[0]).join(", "));
    return hit||null;
  };
  const pr = pick("preset",urlPreRows());
  if(pr){ plantPreset(pr.i); urlPreset(pr.i); sel=roleId("core"); uiDirty(); }
  // the tab goes through its own button, so commissioning and every screen
  // guard in shellInit() run exactly as they do under the hand
  const tb = pick("tab",urlTabRows());
  if(tb) tb.btn.click();
  const ts = pick("timescale",urlRateRows());
  if(ts) trRate(ts.v);
}

/* ══ AND BACK OUT AGAIN ══
   The bar is the state, so the address bar follows it rather than leading it:
   urlSync() reads `screen` and TR.rate every tick and rewrites the query with
   replaceState, which adds no history entry to walk back through.
   A PRESET IS NOT A STATE, though - it is a gesture, and the plant stops being
   that preset once the bench edits it. Measured against DGEN and NOT against
   designSig(): bake() writes a derived scalar on first read, so the signature
   moves on its own (MSRE's rodw went 2600 -> 2720 with nobody touching it) and
   the param would drop a beat after every preset. */
let urlPreI=null, urlPreGen=null, urlLast=null, urlWrite=true;

/* SETTLE FIRST: designForgetBags() empties the machine sizes at the end of
   plantPreset(), so the next pass bakes them back and sigFresh() calls that a
   design edit - DGEN moved twice under a preset nobody had touched yet, and
   the param was dropped before the first sync could write it. */
function urlPreset(i){ layFresh(); urlPreI=i; urlPreGen=DGEN; }

function urlSync(){
  if(!urlWrite) return;
  const q=new URLSearchParams(location.search);
  const tb=urlTabRows().find(r=>r.btn.dataset.screen===screen);
  q.set("tab", tb?tb.keys[tb.keys.length-1]:screen);
  const rt=urlRateRows().find(r=>r.v===TR.rate);
  if(rt) q.set("timescale",rt.keys[rt.keys.length-1]); else q.delete("timescale");
  if(urlPreI!=null && DGEN===urlPreGen) q.set("preset",urlPreRows()[urlPreI].keys[0]);
  else { urlPreI=null; q.delete("preset"); }
  const s="?"+q;
  if(s===urlLast) return;
  urlLast=s;
  // a file:// page has no origin to rewrite, and says so once
  try{ history.replaceState(null,"",s+location.hash); }catch(e){ urlWrite=false; }
}
