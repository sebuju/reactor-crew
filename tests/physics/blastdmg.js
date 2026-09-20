"use strict";
// chunks: late stale jet
/* A structure fails on the peak side-on overpressure it sees, WHENEVER it sees it. Until 20/09/26 the
   dynamic term was computed only on a tick something was burning or a charge had just been placed, and
   the latch was cleared every tick, so a front arriving later was never judged at all and the next charge
   judged the whole room on whatever was still ringing. These three say the judgement is now per tick and
   per cell: `late` that damage happens when it should, `jet` that it does not happen when it should not. */
const {check, commissionPreset} = require("./lib.js");
const mode = process.argv[2] || "late";
const G = commissionPreset(0);
const ST = G.ST, PT = G.PT, GW = G.GW;
ST.sc[G.SC_DICEOFF] = 1;
const CLANCEY = "Clancey (1972) side-on overpressure damage rungs, as PT.partBlast states them per part";

const run = n => { for(let i=0;i<n;i++) G.step(0.02); };
/* the part's own worst cell excess over the quasi-static baseline, which is what eBlastStep judges */
function excess(a){
  const box = PT.partBox, x = box[a*4], y = box[a*4+1], w = box[a*4+2], h = box[a*4+3];
  let e = 0;
  if(PT.partKind[a] === 0){
    for(let X=Math.max(0,x);X<Math.min(GW,x+w);X++) for(let Y=Math.max(0,y);Y<Math.min(G.GH,y+h);Y++){
      const i = Y*GW + X, v = ST.roomP[i] - ST.roomPQs[i]; if(v > e) e = v; } }
  else { const i = PT.partCell[a]; if(i >= 0) e = ST.roomP[i] - ST.roomPQs[i]; }
  return e;
}
const blastParts = () => { const a = []; for(let k=0;k<PT.n.part;k++) if(PT.partBlast[k]) a.push(k); return a; };
const name = a => (G.IX.partId[a] || ("part " + a));

run(100);

if(mode === "late"){
  /* a charge far from the board's machinery: every part is watched tick by tick, and the tick it is
     wrecked on must be the first tick its own cell excess reached its own limit */
  const watch = blastParts();
  const first = new Int32Array(PT.n.part).fill(-1), hurt = new Int32Array(PT.n.part).fill(-1);
  const cell = 4*GW + 4;
  G.act("blast", cell, 3000);
  for(let t=0;t<200;t++){
    G.step(0.02);
    for(const a of watch){
      if(first[a] < 0 && excess(a) >= PT.partBlast[a]) first[a] = t;
      if(hurt[a] < 0 && ST.dmgBy[a]) hurt[a] = t; }
  }
  let n = 0, bad = 0, late = 0, note = "";
  for(const a of watch){
    if(hurt[a] < 0 && first[a] < 0) continue;
    n++;
    if(hurt[a] !== first[a]){ bad++; if(bad < 4) note += name(a) + " wrecked t" + hurt[a] + " limit first met t" + first[a] + "; "; }
    else if(hurt[a] > 0) late++;
  }
  check("every part wrecked on the tick its own cell first met its own limit", bad, 0, 0, CLANCEY,
    {abs:true, unit:"parts out of step", pass:n > 0 && bad === 0,
     note:n + " parts saw or took blast damage, " + late + " of them on a tick AFTER the one the charge was placed on" +
       (note ? "; " + note : "")});
}

if(mode === "stale"){
  /* two charges five seconds apart: the second must wreck exactly the set that met its own limit on its
     own tick, and nothing that is merely still ringing from the first */
  G.act("blast", 4*GW + 4, 120);
  run(250);
  const was = new Uint8Array(PT.n.part);
  for(let a=0;a<PT.n.part;a++) was[a] = ST.dmgBy[a] ? 1 : 0;
  const watch = blastParts().filter(a => !was[a]);
  const first = new Int32Array(PT.n.part).fill(-1), hurt = new Int32Array(PT.n.part).fill(-1);
  { const p2 = G.LAY.parts.find(p => p.role === "pump");
    G.act("blast", (p2.y + (p2.h>>1))*GW + Math.max(0, p2.x - 3), 3000); }
  for(let t=0;t<200;t++){
    G.step(0.02);
    for(const a of watch){
      if(first[a] < 0 && excess(a) >= PT.partBlast[a]) first[a] = t;
      if(hurt[a] < 0 && ST.dmgBy[a]) hurt[a] = t; }
  }
  let over = 0, under = 0, n = 0;
  for(const a of watch){
    const h = hurt[a] >= 0, f = first[a] >= 0;
    if(h || f) n++;
    if(h && !f) over++;
    if(f && !h) under++; }
  check("a second charge wrecks exactly what met its own limit, not what is still ringing", over + under, 0, 0,
    CLANCEY + "; a wave is judged where and when it arrives, never on a room-wide latch",
    {abs:true, unit:"parts", pass:over + under === 0,
     note:watch.length + " parts still intact after the first charge, " + n + " involved in the second; " + over + " wrecked without meeting their limit, " + under + " met it without being wrecked"});
}

if(mode === "jet"){
  /* A steady release holds one cell above the compartment mean for as long as it runs. A quasi-static
     baseline has to FOLLOW that - it is slower than the board's acoustic traverse and faster than
     anything a plant does - or every steady jet reads as a permanent blast wave. The compartment mean
     cannot follow it by construction, and that is what this measures. */
  const watch = blastParts();
  const was = new Uint8Array(PT.n.part);
  for(const a of watch) was[a] = ST.dmgBy[a] ? 1 : 0;
  const pump = G.LAY.parts.find(p => p.role === "pump");
  const cell = (pump.y + (pump.h >> 1))*GW + Math.max(0, pump.x - 2);
  const N = GW*G.GH, of = PT.cellRegion, nr = PT.n.region;
  const m = new Float64Array(nr), c = new Float64Array(nr);
  G.act("injectOn", 6, 200, cell, -1);
  let over = 0, lag = 0, mean = 0, rise = 0;
  for(let t=0;t<1500;t++){
    G.step(0.02);
    for(const a of watch) if(!was[a] && ST.dmgBy[a]){ over++; was[a] = 1; }
    if(t < 100 || t % 5) continue;
    m.fill(0); c.fill(0);
    for(let i=0;i<N;i++){ const r = of[i]; if(r < 0) continue; m[r] += ST.roomP[i]; c[r]++; }
    for(let r=0;r<nr;r++) if(c[r] > 0) m[r] /= c[r];
    for(let i=0;i<N;i++){ const r = of[i]; if(r < 0 || PT.rOcc[i] || PT.rTight[i]) continue;
      const l = ST.roomP[i] - ST.roomPQs[i], g = ST.roomP[i] - m[r];
      if(l > lag) lag = l;
      if(g > mean) mean = g;
      if(ST.roomP[i] > rise) rise = ST.roomP[i]; }
  }
  check("the dynamic excess a SUSTAINED release leaves, against the static rise it causes", lag/rise, 0, 0.05,
    "a steady source is not a wave: a quasi-static baseline follows it within the board's own acoustic " +
    "traverse, so what is left over is the fluctuation and not the rise",
    {abs:true, unit:"relative", note:"steady 200 kg/s steam release beside the pump, sampled from 2 s to 30 s: " +
      "worst cell excess over the quasi-static baseline " + lag.toFixed(4) + " kPa against a static rise of " +
      rise.toFixed(3) + " kPa and a lowest blast limit of 15 kPa on this board; the compartment mean would " +
      "have left " + mean.toFixed(4) + " kPa"});
  check("...and it wrecks nothing on the blast path", over, 0, 0,
    "a sustained squeeze is the crush path's business, never the blast path's",
    {abs:true, unit:"parts", pass:over === 0});
}
