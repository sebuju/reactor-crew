"use strict";
/* trend history ring buffers */

/* ═══════════════ TREND HISTORY ═══════════════ */
const HT = s => s.Tavg + 15*(s.n*0.935 + s.decay);
const CH={
 pwr :{lab:"POWER",        u:"%",  col:"#57d38c", f:s=>s.n*100},
 dnbr:{lab:"DNBR",         u:"",   col:"#f0a830", f:s=>s.dnbr},
 tf  :{lab:"FUEL TEMP",    u:"K",  col:"#ff5a45", f:s=>s.Tf},
 tavg:{lab:"T-AVG",        u:"K",  col:"#5fd2e2", f:s=>s.Tavg},
 th  :{lab:"T-HOT",        u:"K",  col:"#ffa07a", f:s=>HT(s)},
 tc  :{lab:"T-COLD",       u:"K",  col:"#5aa9d6", f:s=>s.Tavg-15*(s.n*.935+s.decay)},
 prs :{lab:"PRESSURE",     u:"MPa",col:"#a98cf0", f:s=>s.P},
 sub :{lab:"SUBCOOLING",   u:"K",  col:"#5fd2e2", f:s=>tsat(s.P)-HT(s)},
 lvl :{lab:"PZR LEVEL",    u:"%",  col:"#c8d8dc", f:s=>s.lvl},
 sgl :{lab:"SG LEVEL",     u:"%",  col:"#8fa9ae", f:s=>s.sgl},
 inv :{lab:"INVENTORY",    u:"%",  col:"#5aa9d6", f:s=>s.inv},
 flow:{lab:"CORE FLOW",    u:"%",  col:"#57d38c", f:s=>s.flow*100},
 load:{lab:"LOAD DEMAND",  u:"%",  col:"#f0a830", f:s=>s.load*100},
 rod :{lab:"ROD BANK",     u:"%",  col:"#c8d8dc", f:s=>s.rodPos*100},
 bor :{lab:"BORON",        u:"pcm",col:"#5fd2e2", f:s=>s.boron},
 xe  :{lab:"XENON",        u:"pcm",col:"#5aa9d6", f:s=>s.parts.xe},
 fq  :{lab:"PEAKING Fq",  u:"",   col:"#f0a830", f:s=>s.fq},
 ao  :{lab:"AXIAL OFFSET",u:"%",  col:"#a98cf0", f:s=>s.ao*100},
 ro  :{lab:"RADIAL TILT", u:"%",  col:"#5fd2e2", f:s=>s.ro*100},
 rho :{lab:"NET RHO",      u:"pcm",col:"#ff5a45", f:s=>s.rho},
 vd  :{lab:"VOID FRACTION",u:"",   col:"#a98cf0", f:s=>s.vf},
 dmg :{lab:"FUEL DAMAGE",  u:"%",  col:"#ff5a45", f:s=>s.dmg},
 fat :{lab:"VESSEL FATIGUE",u:"%", col:"#f0a830", f:s=>s.fatigue},
 cav :{lab:"CAVITATION",   u:"",   col:"#f0a830", f:s=>s.cav},
 nat :{lab:"NAT CIRC",     u:"%",  col:"#57d38c", f:s=>s.nat*100},
 rel :{lab:"RELEASE",      u:"%",  col:"#ff5a45", f:s=>s.release},
};
const HN=1800; let hist={},hi=0,hlen=0,sampT=0,plot=["pwr","dnbr"];
/* ══ THE REACTOR PERIOD LIVES ON THE CLOCK, NOT IN A DRAW ══
   Period is seconds for power to multiply by e, so it is a DIFFERENTIATOR, and
   a differentiator cannot live in a draw function any more. `readoutsFor()` is
   called TWICE a frame - once to measure the drawing and once to fill it - so
   the old `lastN` in drawLedger() would now be stepped twice per tick and
   report half the period it should. This is the clock that ticks once.

   Differentiated against `S.t` and never the wall clock, for the reason the
   pipe meters already document: one frame runs one tick, sometimes two,
   sometimes none, while the wall clock advances smoothly. */
let perN=1, perT=0, perV=Infinity;
const period=()=>perV;
function initHist(){ hist={}; for(const k in CH) hist[k]=new Float64Array(HN); hi=0;hlen=0;sampT=0;
  perV=Infinity; perN=S?S.n:1; perT=S?S.t:0; }
function sample(){ for(const k in CH){ const v=CH[k].f(S); hist[k][hi]=isFinite(v)?v:0; }
  hi=(hi+1)%HN; hlen=Math.min(hlen+1,HN);
  const dt=S.t-perT;
  if(dt>1e-9){ const dn=(S.n-perN)/dt;
    perV = Math.abs(dn)<1e-5 ? Infinity : S.n/dn;
    perN=S.n; perT=S.t; } }
function chAt(k,i){ return hist[k][((hi-hlen+i)%HN+HN)%HN]; }
function togglePlot(k){ const i=plot.indexOf(k);
  if(i>=0) plot.splice(i,1); else { plot.push(k); if(plot.length>4) plot.shift(); } }
