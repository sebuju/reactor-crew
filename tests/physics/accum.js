"use strict";
/* fidelity.md "a tank's gas charge": the code holds the N2 cushion polytropic (p*V^n=const,
   n=TANK_NPOLY=1.4, near-adiabatic on diatomic nitrogen); a real accumulator blows down at
   n~1.2-1.4. Flies STOCK PWR's HPI accumulator through a fast break so it actually blows down,
   then judges the POLYTROPIC law against a hand-written one at the SAME swept volume
   (pressure distance) and at the SAME end pressure (mass distance) - no re-simulation, pure algebra
   on top of what the model's own march actually swept through. */
const {check, commissionPreset} = require("./lib.js");

const G = commissionPreset(0); // STOCK PWR - the reference ship's own HPI accumulator
const PT = G.PT, ST = G.ST, sc = ST.sc;

const hpiId = [...G.IX.tank.keys()].find(id => id.indexOf("hpi") === 0);
if(!hpiId){
  check("STOCK PWR: HPI accumulator present", 0, 1, 0, "buildStockPlumbing() hpi tank", {pass:false, note:"no hpi tank built"});
  process.exit(0);
}
const t = G.IX.tank.get(hpiId), i = PT.tankNode[t];
const RHO = G.FLUID.water.dens;                       // the same fixed liquid density tankKg()/tankGasV0() assume
const V1 = PT.tankVol[t]*PT.tankVoid[t], p0 = PT.tankGasP0[t], m0 = ST.mBy[i];

const cold = Object.values(G.pipeMap().byKey).find(r => r.k === "cold");
if(!cold){
  check("STOCK PWR: a cold leg to break", 0, 1, 0, "pipeMap()", {pass:false, note:"no cold-leg run found"});
  process.exit(0);
}
const cell = cold.cells[0];
G.actId("hit", "pipe:" + cell[0] + "," + cell[1]);    // a big cold-leg break: crashes loop pressure well under 11 MPa
G.act("tankOpen", t);                                  // arm the accumulator's own manual valve
sc[G.SC_DICEOFF] = 1;

/* the read point is a SIM time, never the wall-clock guard: the distances below are read at whatever state the march ended in, so a machine-speed cut moves them */
const SECS = 10, WALL = 8000, t0 = Date.now();
const samples = [];
/* a polytropic charge stalls with water still in it and pours again as the loop falls further, so the march runs the whole window and the read is at its end */
let drainedAt = -1, ticks = 0;
while(sc[G.SC_T] < SECS - 1e-9 && Date.now() - t0 < WALL && !(drainedAt >= 0 && sc[G.SC_T] - drainedAt > 1)){
  G.step(0.02); ticks++;
  if(ST.mBy[i] < 1e-6 && drainedAt < 0) drainedAt = sc[G.SC_T];
  if(ticks % 25 === 0) samples.push([+sc[G.SC_T].toFixed(2), +ST.mBy[i].toFixed(3), +ST.pBy[i].toFixed(5)]);
}

const mEnd = ST.mBy[i], pModelEnd = ST.pBy[i];
const delivered = m0 - mEnd;                    // kg the model actually pushed out
const V2 = V1 + delivered/RHO;                  // the gas volume the model actually swept to
const NPOLY = G.TANK_NPOLY, pPolyEnd = p0*Math.pow(V1/V2, NPOLY);

/* the hand-written law under test: p*V^n = const */
const pPoly = (V, n) => p0*Math.pow(V1/V, n);

/* sanity (rule 6): at a bare 2x expansion, isothermal/polytropic pressure ratio is 2^(n-1) exactly */
for(const n of [1.4, 1.2])
  check("accum: hand polytropic law sanity at a 2x expansion, n=" + n, (p0*V1/(2*V1))/pPoly(2*V1, n), Math.pow(2, n - 1),
    1e-9, "ideal gas p*V^n=const: p2/p1=(V1/V2)^n, so isothermal/polytropic = 2^(n-1) at V2=2V1");

check("accum: the march reached its own read point, so the distances below are comparable", sc[G.SC_T], drainedAt >= 0 ? sc[G.SC_T] : SECS, 1e-9,
  "the wall-clock guard is a guard, not a stop: a cut march reads the law at another state", {abs:true, unit:"s"});

check("STOCK PWR HPI accumulator: tank pressure follows the code's own polytropic law at full blowdown",
  pModelEnd, pPolyEnd, 0.05, "eTankLvlA()/eTankCapA()/eTankPA() (net.js): p*V^n=const with n=TANK_NPOLY", {unit:"MPa",
  gap:"a tank's gas charge", note:"n=" + NPOLY + ", V1=" + V1.toFixed(2) + " m3, swept to V2=" + V2.toFixed(2) + " m3, delivered " + delivered.toFixed(0) +
    " kg, read at t=" + sc[G.SC_T].toFixed(2) + " s with " + mEnd.toFixed(0) +
    " kg still in it (break at pipe:" + cell.join(",") + ", dice off)"});

for(const n of [1.4, 1.2]){
  const pP = pPoly(V2, n), distP = (pModelEnd - pP)/pP*100;
  const chosen = Math.abs(n - NPOLY) < 1e-9;
  check("HPI accumulator: end-of-stroke pressure, code (n=" + NPOLY + ") vs hand p*V^n at n=" + n + ", same swept volume",
    pModelEnd, pP, 0.05, "hand law p=p0*(V1/V)^n at the code's own swept V2=" + V2.toFixed(2) + " m3",
    chosen ? {unit:"MPa", gap:"a tank's gas charge", note:"code reads " + distP.toFixed(1) + "% off n=" + n + " at the same water delivered"}
           : {unit:"MPa", pass:true, note:"INFORMATIONAL: code runs n=" + NPOLY + ", reads " + distP.toFixed(1) + "% off n=" + n});

  const Vstop = V1*Math.pow(p0/pModelEnd, 1/n), massPoly = (Vstop - V1)*RHO, distM = (delivered - massPoly)/massPoly*100;
  check("HPI accumulator: water delivered by the time pressure falls to " + pModelEnd.toFixed(3) + " MPa, code vs n=" + n,
    delivered, massPoly, 0.05, "hand law V=V1*(p0/p)^(1/n) inverted to mass=(V-V1)*rho",
    chosen ? {unit:"kg", gap:"a tank's gas charge", note:"code delivers " + distM.toFixed(1) + "% off n=" + n + " by this pressure"}
           : {unit:"kg", pass:true, note:"INFORMATIONAL: code runs n=" + NPOLY + ", delivers " + distM.toFixed(1) + "% off n=" + n});
}

console.log("HPI accumulator trajectory [t, m(kg), p(MPa)]: " + JSON.stringify(samples));
