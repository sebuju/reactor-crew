"use strict";
/* canvas handle, palette, shared constants. The plant canvas now lives inside
   #stage, below the HTML #topbar - see TOPBAR_H in shell.js. */
const W = 760;
/* ctx is `let`, not `const`: hostPaint() in render/plant.js swaps it for the
   duration of one draw so a graphical widget living inside an opaque HTML rail
   paints into its own bitmap using the same chrome.js primitives. */
const cv = document.getElementById("cv");
let ctx = cv.getContext("2d");
const stage = document.getElementById("stage");
const MONO = `ui-monospace,"SF Mono","Roboto Mono","DejaVu Sans Mono",Menlo,monospace`;

const C = {
  bg:"#080c0e", panel:"#0e1518", panelHi:"#142126", well:"#060a0b",
  edge:"#1d2f35", edge2:"#2c464e", rail:"#33525b",
  ink:"#9fb4b9", ink2:"#5d7378", bright:"#dff0f3",
  amber:"#f0a830", cyan:"#5fd2e2", red:"#ff5a45", green:"#57d38c",
  blue:"#5aa9d6", metal:"#6d8f98",
  xe:"#2a1f3a", graph:"#8a6a4a",
  /* selected fills, the near-black inks that go on top of a bright fill, and
     the two banner grounds. Here rather than in a stylesheet so there is still
     exactly one palette. */
  onAmber:"#2a1f08", onGreen:"#0f2018", redHi:"#ff7d6c", dis:"#2c3f45",
  inkOnAmber:"#180404", inkOnRed:"#160404", inkOnLit:"#120404",
  bgMelt:"#1a0605", bgTrip:"#1a1206"
};

/* C stays the one palette; CSS reads it through these. Guarded: the bundle
   also runs headless through new Function, where document has no documentElement. */
function cssVarsBoot(){
  if(typeof document==="undefined" || !document.documentElement) return;
  const root=document.documentElement.style;
  for(const k in C) root.setProperty("--c-"+k.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(), C[k]);
}
cssVarsBoot();
