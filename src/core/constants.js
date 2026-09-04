"use strict";
/* canvas handle, palette, shared constants. The plant canvas now lives inside
   #stage, below the HTML #topbar. */
const W = 760;
/* THE DRAWING'S OTHER TWO DIMENSIONS STAND WITH W, and H is a `let` because
   resize() (shell.js) writes it. They were declared in shell.js, eighteen
   scripts after uiBind(cv) wires the pointer handlers - so a pointermove while
   the rest of the page was still loading read both through the temporal dead
   zone and threw "H is not defined" out of local(). */
let H = 790;
const TOPBAR_H = 40;
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
  /* THE TWO SIDES OF A PORT'S OWN INTERNAL PATH, named once so the nozzle, its
     word and its tooltip cannot drift apart. The slot is hemmed in on every
     side: not amber (amber IS the selection), not red (a side is not an
     alarm), not green (green is a healthy lamp, and portB WAS C.green to the
     digit), and not cyan or blue - both are on the pipework a port sits on, so
     an inlet wearing them vanished into the run it was capping.
     MUTED, because these are FILLS with a word standing on them rather than
     lamps: the pink and the light green were as loud as an alarm for something
     that is only ever saying "this end, not that one". Mid-tone, so the dark
     ink on top (C.inkOnLit) reads. */
  portA:"#9a86c4", portB:"#b59a6f",
  /* THE COMPARTMENT'S OWN TWO READINGS, and they are on screen together.
     h2 is a violet the blast bands do not use, so the cloud and the wave
     cannot be read as one another; scar/scarHi are SOOT - warm and very dark
     against a cool dark panel, so a burnt cell reads as burnt rather than as
     a hole cut in the picture. */
  h2:"#a48ad6", scar:"#2b1c15", scarHi:"#4a2f22",
  /* AND WHAT IT LOOKS LIKE WHILE IT IS HAPPENING. Three tones off one axis -
     gas temperature - so the fire is not a colour somebody picked: fire is a
     stoichiometric front, fire2 is the same front a thousand kelvin cooler,
     and amber and red below them are already on this table. smoke is the
     steam the burn makes, which is what is left once it has cooled. */
  fire:"#fff3d0", fire2:"#ffd27a", smoke:"#6a6560",
  xe:"#2a1f3a", graph:"#8a6a4a",
  /* selected fills, the near-black inks that go on top of a bright fill, and
     the two banner grounds. Here rather than in a stylesheet so there is still
     exactly one palette. */
  onAmber:"#2a1f08", onGreen:"#0f2018", redHi:"#ff7d6c", dis:"#2c3f45",
  /* amber carrying its own alpha, for a ring that marks a thing without
     shouting as loud as the thing. A var() cannot be given an alpha at the
     use site, so the translucent value is a palette entry rather than a
     literal hex in a stylesheet. */
  amberSoft:"#f0a8305e",
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
