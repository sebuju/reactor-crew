#!/usr/bin/env node
// node tools/ringprobe.js
// Rules on the three ring candidates named in docs/fidelity.md's "the feed train at commissioning" row
// for run:feed:efwpl-efwteer: (1) inertia mass-spring, (2) the stub's seed state, (3) an unsettled solve.
const M = require('./bundle').headless(
 '{commission,step,plantPreset,buildLayout,D:()=>D,LAY:()=>LAY,PT:()=>PT,ST:()=>ST,IX:()=>IX,P:()=>P,'+
 'pipeNetwork,runNodeOf,eNodeP,eNodeT,eNodeX,eNodeH,snapS,restoreS,NET_DT:()=>NET_DT}');

M.plantPreset(0); M.buildLayout(); M.commission();

const PT = M.PT(), ST = M.ST(), IX = M.IX();
const f = (v,d) => (v===null||v===undefined||Number.isNaN(v)) ? "-" : (+v).toFixed(d===undefined?4:d);

const net = M.pipeNetwork();
const run = net.find(r => /efwp/i.test(r.key) && /efwtee/i.test(r.key));
if(!run){ console.log("no run matching efwp*-efwtee* among "+net.length+" runs:"); console.log(net.map(r=>r.key).filter(k=>/efw/i.test(k)).join("\n")); process.exit(1); }
console.log("RUN  "+run.key);
const rnKey = M.runNodeOf(run.key);
const rn = IX.node.get(rnKey);
console.log("run node  "+rnKey+" = #"+rn+"  "+IX.nodeId[rn]+"  vol "+f(PT.nodeVol[rn],5)+" m3  tank "+PT.nodeTank[rn]);

// bordering edges: every edge touching the run's own node
const edges = [];
for(let e=0;e<PT.n.edge;e++) if(PT.edU[e]===rn || PT.edV[e]===rn) edges.push(e);
console.log("\nEDGES on run node ("+edges.length+")");
const NET_DT = M.NET_DT();
for(const e of edges){
  const other = PT.edU[e]===rn ? PT.edV[e] : PT.edU[e];
  const In = PT.edI[e]/NET_DT/1e6;
  console.log("  e"+e+"  "+IX.nodeId[PT.edU[e]]+" -> "+IX.nodeId[PT.edV[e]]+
    "   K0 "+f(PT.edK0[e],3)+"  C0 "+f(PT.edC0[e],6)+"  I "+f(PT.edI[e],6)+
    "  In(=I/dt/1e6) "+f(In,4)+"  meter "+PT.edMeter[e]+"  diode "+PT.edDiode[e]+"  pump "+PT.edPump[e]+
    "   other="+IX.nodeId[other]);
}

// find the SG/boiler shell temps at commission, for comparison against the stub's seed temperature
console.log("\nSHELL TEMPS at commission (candidate 2 reference)");
for(let b=0;b<PT.n.boiler;b++) console.log("  boiler#"+b+"  T "+f(ST.sgTBy[b],2)+" K");

// the efw tank's own fluid state, for comparison (the cold route the row already ruled out)
console.log("\nEFW TANK nodes");
for(let t=0;t<PT.n.tank;t++){
  const nm = IX.tankId[t];
  if(!/efw/i.test(nm)) continue;
  console.log("  "+nm+"  fluidT(design) "+f(PT.tankFluidT[t],2)+" K");
}

const dump = (tag) => {
  const p = ST.pBy[rn], T = M.eNodeT(rn), X = M.eNodeX(rn), h = M.eNodeH(rn), m = ST.mBy[rn];
  let line = tag.padEnd(10)+"  P "+f(p,4)+" MPa  T "+f(T,2)+" K  x "+f(X,3)+"  h "+f(h,1)+" kJ/kg  m "+f(m,4)+" kg";
  for(const e of edges){
    const w = ST.edW[e], has = ST.edWHas[e];
    line += "   w(e"+e+") "+(has? f(w,4) : "-");
  }
  console.log(line);
};

console.log("\nPRE-TICK (t=0, straight out of commission())");
dump("t=0.000");

console.log("\nFIRST 0.3 s, PER TICK (dt=0.02)");
let peakP = 0, peakAt = -1;
for(let k=1;k<=15;k++){
  M.step(0.02);
  const p = ST.pBy[rn];
  if(Math.abs(p) > Math.abs(peakP)){ peakP = p; peakAt = k; }
  dump("t="+f(k*0.02,3));
}
console.log("\nPEAK  "+f(peakP,4)+" MPa at tick "+peakAt+" (t="+f(peakAt*0.02,3)+" s)");

// the row's own figures, quoted for the ruling below (fidelity.md, "the feed train at commissioning")
const RATED = 11.66, ROW_PEAK = 16.580, ROW_SEED_T = 558;
const t0T = M.eNodeT(rn), t0P = ST.pBy[rn];
console.log("\n=== RULING ===");
console.log("row claims: peak "+ROW_PEAK+" MPa ("+(ROW_PEAK/RATED).toFixed(2)+"x "+RATED+" MPa rating), stub seeds at "+ROW_SEED_T+" K (shell saturation)");
console.log("measured : peak "+f(peakP,4)+" MPa ("+(Math.abs(peakP)/RATED).toFixed(3)+"x rating), stub commissions at "+f(t0T,2)+" K, "+f(t0P,4)+" MPa");
console.log("");
console.log("candidate 1 (inertia mass-spring)   : edI on the two bordering pipe edges = "+f(PT.edI[edges[0]],3)+
  " (In = I/dt/1e6 = "+f(PT.edI[edges[0]]/NET_DT/1e6,4)+"); edge flows stay at "+f(ST.edW[edges[0]],4)+
  " kg/s through the window -- "+(Math.abs(peakP-t0P)>0.01?"a live term, cannot rule out on this run":"never excited: no flow, no ring to spring from"));
console.log("candidate 2 (stub seed state)       : measured seed T "+f(t0T,2)+" K vs row's claimed "+ROW_SEED_T+
  " K (SG shell) -- "+(Math.abs(t0T-ROW_SEED_T)<5?"CONFIRMED, matches shell saturation":"NOT reproduced: node seeds near the tank/header's own subcooled state, not the shell's"));
console.log("candidate 3 (unsettled solve)       : field at t=0 = "+f(t0P,4)+
  " MPa; peak-to-floor swing over 0.3 s = "+f(Math.abs(peakP-t0P),4)+
  " MPa -- "+(Math.abs(peakP-t0P)>0.05?"a real first-tick jump: settle handed a field the march moves hard":"negligible: the settle's field is already the march's steady state"));
console.log("");
console.log((Math.abs(peakP)>RATED*1.05)
  ? "VERDICT: the ring reproduces on this tree."
  : "VERDICT: the ring does NOT reproduce on this tree today. Peak stays "+f(peakP,4)+
    " MPa, "+f(100*Math.abs(peakP)/RATED,1)+"% of the "+RATED+" MPa rating, essentially flat noise. "+
    "The row's own candidate 2 (558 K stub) is directly falsified by the measured "+f(t0T,2)+" K seed. "+
    "The row is stale against the current tree and should be re-measured/closed, not explained further.");
