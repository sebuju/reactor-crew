"use strict";
const W = 760;
let H = 790;
const TOPBAR_H = 40;
/* ctx is `let`: hostPaint() (render/plant.js) swaps it for the duration of one draw */
const cv = document.getElementById("cv");
let ctx = cv.getContext("2d");
const stage = document.getElementById("stage");
const MONO = `ui-monospace,"SF Mono","Roboto Mono","DejaVu Sans Mono",Menlo,monospace`;

const C = {
  bg:"#040708", panel:"#0b1114", panelHi:"#142126", well:"#060a0b", ctlWell:"#0f181b",
  bar:"#101a1d",
  panelFloat:"#131d21",
  machBg:"#1b1f21",
  edge:"#1d2f35", edge2:"#2c464e", rail:"#33525b",
  ink:"#9fb4b9", ink2:"#5d7378", bright:"#dff0f3",
  amber:"#f0a830", cyan:"#5fd2e2", red:"#ff5a45", green:"#57d38c",
  blue:"#5aa9d6", metal:"#6d8f98",
  portA:"#9a86c4", portB:"#b59a6f",
  h2:"#a48ad6", scar:"#2b1c15", scarHi:"#4a2f22",
  lead:"#6e7a52",
  fire:"#fff3d0", fire2:"#ffd27a", smoke:"#6a6560", wave:"#ff966e", waveHi:"#ffffff",
  xe:"#2a1f3a", graph:"#8a6a4a",
  onAmber:"#2a1f08", onGreen:"#0f2018", redHi:"#ff7d6c", dis:"#2c3f45",
  /* a var() cannot be given an alpha at the use site, so the translucent value is an entry */
  amberSoft:"#f0a8305e",
  inkOnAmber:"#180404", inkOnRed:"#160404", inkOnLit:"#120404",
  bgMelt:"#1a0605", bgTrip:"#1a1206"
};

/* guarded: the bundle also runs headless, where document has no documentElement */
function cssVarsBoot(){
  if(typeof document==="undefined" || !document.documentElement) return;
  const root=document.documentElement.style;
  for(const k in C) root.setProperty("--c-"+k.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(), C[k]);
}
cssVarsBoot();
