"use strict";
// chunks: 0 1 4
/* Where the STOCK circulating-water tank's level goes over 170 s at rest (fidelity.md, "Commissioned plant on its first tick").
   Books the tank's OWN node: every edge on it, summed, against ST.mBy's own change - that is the conservation check,
   and it names the edge carrying whatever moves. A level is a READ (eTankLvlA, net.js): for a gas-charged surge tank
   it comes off the node's PRESSURE (Boyle's law on the trapped gas cushion), never off mass directly. */
const fs = require("fs"), os = require("os"), path = require("path");
const {check, commissionPreset} = require("./lib.js");
const pre = +process.argv[2], resume = process.argv.includes("--resume");
const SECS = 170, WALL = 7000, t0 = Date.now();
const fBin = path.join(os.tmpdir(), "rc-phys-cwtank-p" + pre + ".bin"), fJs = path.join(os.tmpdir(), "rc-phys-cwtank-p" + pre + ".json");
const G = commissionPreset(pre);
const PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[pre][0];

if(!G.IX.tank.has("cwtank")){
  check(name + ": cwtank present on this preset", 0, 1, 0, "buildStockPlumbing() cwp/cwtank", {pass:false, note:"no cwtank part built"});
  process.exit(0);
}
const t = G.IX.tank.get("cwtank"), i = PT.tankNode[t];
const dt = 0.02;

let A;
if(resume && fs.existsSync(fBin)){
  G.engRestore(new Uint8Array(fs.readFileSync(fBin)));
  A = JSON.parse(fs.readFileSync(fJs, "utf8"));
} else {
  A = {m0: ST.mBy[i], lvl0: G.eTankLvl(t), p0: ST.pBy[i], gas0: PT.tankGasP0[t], V: PT.tankVol[t], V0: PT.tankVol[t]*PT.tankVoid[t],
       inv0: G.eLedgerKg() + G.eLedgerOut(), edgeKg: {}, ticks: 0, worstResid: 0, worstResidT: 0, invDrift: 0, samples: []};
}

while(sc[G.SC_T] < SECS - 1e-9 && Date.now() - t0 < WALL){
  const mBefore = ST.mBy[i];
  G.step(dt); A.ticks++;
  let net = 0;
  for(let k=PT.adjStart[i]; k<PT.adjStart[i+1]; k++){
    const ed = PT.adjEdge[k], w0 = ST.edW[ed];
    if(!w0 || PT.edHole[ed]) continue;
    const wi = PT.edV[ed] === i ? w0 : -w0; // +kg/s into the tank node, -kg/s out
    net += wi;
    A.edgeKg[ed] = (A.edgeKg[ed] || 0) + wi*dt;
  }
  const dm = ST.mBy[i] - mBefore, resid = Math.abs(dm - net*dt);
  if(resid > A.worstResid){ A.worstResid = resid; A.worstResidT = sc[G.SC_T]; }
  A.invDrift = Math.max(A.invDrift, Math.abs((G.eLedgerKg() + G.eLedgerOut()) - A.inv0));
  if(A.ticks % 850 === 0) A.samples.push([+sc[G.SC_T].toFixed(2), +ST.mBy[i].toFixed(4), +ST.pBy[i].toFixed(6), +G.eTankLvl(t).toFixed(4)]);
}

if(sc[G.SC_T] < SECS - 1e-9){
  fs.writeFileSync(fBin, Buffer.from(G.engSnap(G.engSnapNew())));
  fs.writeFileSync(fJs, JSON.stringify(A));
  process.stdout.write("@@MORE\n"); process.exit(0);
}
for(const f of [fBin, fJs]) if(fs.existsSync(f)) fs.unlinkSync(f);

const mEnd = ST.mBy[i], lvlEnd = G.eTankLvl(t), pEnd = ST.pBy[i];
const edges = Object.keys(A.edgeKg).map(k => +k);
let sumKg = 0; for(const ed of edges) sumKg += A.edgeKg[ed];
const edgeReport = edges.map(ed => "ed" + ed + "(node" + PT.edU[ed] + "<->node" + PT.edV[ed] + "):" + A.edgeKg[ed].toFixed(6) + "kg").join(", ") || "none";

check(name + ": cwtank node mass books to its own edges over " + A.ticks + " ticks (worst |dm - sum(w*dt)| / |m0|)",
  A.worstResid/Math.max(Math.abs(A.m0), 1e-9), 0, 1e-7,
  "conservation of mass on the tank's own node, every tick; cwtank is a booked node (PT.nodeBooked===1), so ST.mBy is overwritten " +
  "each tick from eTankLvlA()'s pressure book (transport.js ~L391/415), not integrated from the summed edge flow - the residual is " +
  "the gap between those two independent tracks of the same settling transient", {abs:true, gap:"Commissioned plant on its first tick",
    note:"worst at t=" + A.worstResidT.toFixed(2) + "s; edges " + edgeReport});

check(name + ": cwtank node mass, start to " + SECS + " s (|dm|/m0)", Math.abs(mEnd - A.m0)/Math.max(Math.abs(A.m0), 1e-9), 0, 1e-6,
  "the level is a read off eTankLvlA(), not the state; mass is the state", {abs:true, gap:"Commissioned plant on its first tick",
    note:"m0=" + A.m0.toFixed(4) + "kg mEnd=" + mEnd.toFixed(4) + "kg netEdgeKg=" + sumKg.toFixed(6) + " p0=" + A.p0.toFixed(6) +
      "MPa pEnd=" + pEnd.toFixed(6) + "MPa lvl0=" + A.lvl0.toFixed(3) + "% lvlEnd=" + lvlEnd.toFixed(3) + "%"});

/* eTankLvlA's own law for a gas-charged tank in the field: level = 100*(1 - min(V, V0*p0/max(COND_P0,pv))/V) - it reads
   node PRESSURE, not mass. Recompute it off the pressure alone and compare to what eTankLvl() actually returned. */
const COND_P0 = G.COND_P0;
const predLvl = 100*(1 - Math.min(A.V, A.V0*A.gas0/Math.max(COND_P0, pEnd))/Math.max(A.V, 1e-9));
check(name + ": cwtank level fall is the field pressure through eTankLvlA's own gas law (predicted vs read %)",
  predLvl, lvlEnd, 1e-6, "eTankLvlA(): E_TL = 100*(1 - min(V, V0*gasP0/max(COND_P0,pv))/V), net.js", {abs:true,
    note:"pv fell " + A.p0.toFixed(6) + " -> " + pEnd.toFixed(6) + " MPa over " + SECS + " s"});

check(name + ": whole-plant mass inventory unmoved while the cwtank empties (worst |inv - inv0| / inv0)",
  A.invDrift/Math.max(Math.abs(A.inv0), 1e-9), 0, 1e-9, "eLedgerKg()+eLedgerOut(): the water the tank loses has to show up booked somewhere else, not vanish", {abs:true});

console.log(name + " trajectory [t, m(kg), p(MPa), lvl(%)]: " + JSON.stringify(A.samples));
