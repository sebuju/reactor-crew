#!/usr/bin/env node
// node tools/msrcook.js <fuel 0|1|3|4> [--resume]
// MSR lattice (arch a4) on the stock plant, fuels 0/1/3/4: march to 600 s or first wreck,
// dumping the room's heat balance every 5 s. Chunked through engSnap/engRestore like tests/physics/presets.js
// so one process never runs past the 10 s script budget.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");

const fuel = +process.argv[2];
if(![0,1,3,4].includes(fuel)){ console.error("usage: node tools/msrcook.js <0|1|3|4> [--resume]"); process.exit(2); }
const resume = process.argv.includes("--resume");
const SECS = 600, EVERY = 5, WALL = 7000, t0 = Date.now();
const fBin = path.join(os.tmpdir(), "rc-msrcook-f" + fuel + ".bin");
const fJs  = path.join(os.tmpdir(), "rc-msrcook-f" + fuel + ".json");

const M = require("./bundle").headless(
  "{commission,step,derived,warnRed,D:()=>D,ST:()=>ST,PT:()=>PT,IX:()=>IX,P:()=>P," +
  "archPreset,coreD,buildLayout,plantPreset,uiTripText,snapS,restoreS," +
  "E_TXT_WHY:()=>E_TXT_WHY," +
  "roomHeat:()=>{" +
  " const s=ST, Tr=s.roomT, nP=PT.n.part; let mach=0,run=0,relief=0,sgvent=0,rad=0;" +
  " let worstA=-1,worstQ=0;" +
  " for(let a=0;a<nP;a++){ if(PT.partKind[a]!==0) continue;" +
  "  const k0=PT.partCell0[a],k1=PT.partCell0[a+1]; if(k1===k0) continue;" +
  "  const Ts=s.partT[a]; if(!(Ts>=0)) continue;" +
  "  let air=0; for(let k=k0;k<k1;k++) air+=Tr[PT.partCellIx[k]];" +
  "  const q=ROOM_HK*(Ts*(k1-k0)-air); mach+=q; if(Math.abs(q)>Math.abs(worstQ)){worstQ=q;worstA=a;} }" +
  " for(let g=0;g<PT.nRseg;g++){ const k0=PT.rsegCell0[g],k1=PT.rsegCell0[g+1]; if(k1===k0) continue;" +
  "  const Ts=s.runT[g]; if(!(Ts>=0)) continue;" +
  "  let air=0; for(let k=k0;k<k1;k++) air+=Tr[PT.rsegCellIx[k]];" +
  "  run+=ROOM_HK*(Ts*(k1-k0)-air); }" +
  " for(let v=0;v<s.reliefSteam.length;v++) relief+=Math.max(0,s.reliefSteam[v]);" +
  " for(let b=0;b<PT.n.boiler;b++) sgvent+=Math.max(0,s.sgVentBy[b]);" +
  " for(let r=0;r<PT.n.rad;r++) rad+=s.radQBy[r]/1000;" +
  " let tMax=0,tSum=0; const N=GW*GH; for(let i=0;i<N;i++){ tSum+=Tr[i]; if(Tr[i]>tMax) tMax=Tr[i]; }" +
  " return {mach,run,relief,sgvent,rad,tAvg:tSum/N,tMax,worstA,worstQ,fireQ:s.sc[SC_FIREQ]||0}; }," +
  "wrecked:()=>{ const s=ST,ix=IX; for(let a=0;a<PT.n.part;a++) if(s.dmgBy[a]) return ix.partId[a]+' '+E_TXT_WHY[s.dmgWhy[a]]; return null; }" +
  "}");

const f = (v,d) => (v===null||v===undefined||Number.isNaN(v)) ? "-" : (+v).toFixed(d===undefined?2:d);

// same builder sweep.js uses: fuel/scram/cool/foll/refl/mod land on coreD("core"), everything else on D
const D = M.D(), BASE = JSON.parse(JSON.stringify(D));
function buildOk(scram){
  Object.assign(D, BASE);
  M.plantPreset(0);
  M.archPreset(M.coreD("core"), 4);           // a4 = MSR
  M.coreD("core").fuel = fuel;
  M.coreD("core").scram = scram;
  D.autorod = true;
  M.buildLayout();
  return !M.derived().warn.some(M.warnRed);
}
function pickScram(){
  for(const sc of [0,1,2]) if(buildOk(sc)) return sc;
  return null;
}

let A;
if(resume && fs.existsSync(fBin)){
  const scram = pickScram();
  buildOk(scram); M.buildLayout(); M.commission();
  M.restoreS(new Uint8Array(fs.readFileSync(fBin)));
  A = JSON.parse(fs.readFileSync(fJs, "utf8"));
  console.log("-- resuming fuel " + fuel + " (" + A.fname + ") at t=" + A.t.toFixed(1) + " s --");
} else {
  const scram = pickScram();
  if(scram === null){ console.log("fuel " + fuel + ": no scram setting builds clean on a4/MSR (design warning red) - skipped"); process.exit(0); }
  buildOk(scram);
  M.buildLayout(); M.commission();
  // match tools/sweep.js: seed 1, dice ON (SWEEP_SEED/SWEEP_DICE defaults) - dice off was hiding the failure this reproduces
  const S = M.ST().sc; S[SC_SEED] = S[SC_RNG] = 1; S[SC_DICEOFF] = 0;
  const name = "UO2 3.2%|UO2 4.9%|UO2 19.7%|MOX Pu|U-Zr metallic|U metal nat".split("|")[fuel];
  console.log("\n== a4 MSR, fuel " + fuel + " (" + name + "), scram " + scram + " ==");
  A = { t: 0, fname: name, ticks: 0 };
}

const P = M.P();
console.log("   t s    Tavg K   core MWt   room avg K  room max K   mach kW   run kW   relief kW   sgvent kW   rad kW   worst part");
function line(){
  const s = M.ST().sc, rh = M.roomHeat();
  const worstId = rh.worstA >= 0 ? M.IX().partId[rh.worstA] : "-";
  console.log("  " + f(A.t,1).padStart(6) + "  " + f(s[SC_TAVG],1).padStart(8) + "  " +
    f(s[SC_HEAT]*P.rated,1).padStart(9) + "  " + f(rh.tAvg,1).padStart(10) + "  " + f(rh.tMax,1).padStart(10) + "  " +
    f(rh.mach,1).padStart(8) + "  " + f(rh.run,1).padStart(7) + "  " + f(rh.relief,2).padStart(9) + "  " +
    f(rh.sgvent,2).padStart(9) + "  " + f(rh.rad,1).padStart(7) + "   " + worstId + " " + f(rh.worstQ,2));
}

let wreck = null;
while(A.t < SECS - 1e-9 && Date.now() - t0 < WALL){
  M.step(0.02); A.t += 0.02; A.ticks++;
  if(Math.round(A.t/0.02) % (EVERY*50) === 0) line();
  wreck = M.wrecked();
  if(wreck) break;
}
if(wreck){
  line();
  console.log("  WRECKED at t=" + A.t.toFixed(1) + " s: " + wreck);
  for(const fn of [fBin, fJs]) if(fs.existsSync(fn)) fs.unlinkSync(fn);
  process.exit(0);
}
if(A.t < SECS - 1e-9){
  fs.writeFileSync(fBin, Buffer.from(M.snapS()));
  fs.writeFileSync(fJs, JSON.stringify(A));
  process.stdout.write("@@MORE\n");
  process.exit(0);
}
console.log("  no wreck in " + SECS + " s");
for(const fn of [fBin, fJs]) if(fs.existsSync(fn)) fs.unlinkSync(fn);
