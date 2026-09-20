"use strict";
/* fidelity.md "a tank's gas charge": the code holds the N2 cushion isothermal (p*V=const); a real
   accumulator blows down closer to polytropic (n~1.2-1.4) and loses pressure faster. Never measured
   on a preset. Flies STOCK PWR's HPI accumulator through a fast break so it actually blows down,
   then judges the isothermal LAW against a hand-written polytropic one at the SAME swept volume
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

const SECS = 20, WALL = 8000, t0 = Date.now();
const samples = [];
let drainedAt = -1, ticks = 0;
while(sc[G.SC_T] < SECS - 1e-9 && Date.now() - t0 < WALL && !(drainedAt >= 0 && sc[G.SC_T] - drainedAt > 1)){
  G.step(0.02); ticks++;
  if(ST.mBy[i] < 1e-6 && drainedAt < 0) drainedAt = sc[G.SC_T];
  if(ticks % 25 === 0) samples.push([+sc[G.SC_T].toFixed(2), +ST.mBy[i].toFixed(3), +ST.pBy[i].toFixed(5)]);
}

const mEnd = ST.mBy[i], pModelEnd = ST.pBy[i];
const delivered = m0 - mEnd;                    // kg the model actually pushed out
const V2 = V1 + delivered/RHO;                  // the gas volume the model actually swept to
const pIsoEnd = p0*V1/V2;                       // the code's own law, hand-written: p*V = p0*V1

/* the hand-written law under test: p*V^n = const */
const pPoly = (V, n) => p0*Math.pow(V1/V, n);

/* sanity (rule 6): at a bare 2x expansion, isothermal/polytropic pressure ratio is 2^(n-1) exactly */
for(const n of [1.4, 1.2])
  check("accum: hand polytropic law sanity at a 2x expansion, n=" + n, (p0*V1/(2*V1))/pPoly(2*V1, n), Math.pow(2, n - 1),
    1e-9, "ideal gas p*V^n=const: p2/p1=(V1/V2)^n, so isothermal/polytropic = 2^(n-1) at V2=2V1");

check("STOCK PWR HPI accumulator: tank pressure follows the code's own isothermal law at full blowdown",
  pModelEnd, pIsoEnd, 0.05, "eTankPA()/eTankCapA() (net.js): p*V=const is the only gas law in that path", {unit:"MPa",
  note:"V1=" + V1.toFixed(2) + " m3, swept to V2=" + V2.toFixed(2) + " m3, delivered " + delivered.toFixed(0) +
    " kg by t=" + drainedAt.toFixed(2) + " s (break at pipe:" + cell.join(",") + ", dice off)"});

for(const n of [1.4, 1.2]){
  const pP = pPoly(V2, n), distP = (pModelEnd - pP)/pP*100;
  check("HPI accumulator: end-of-stroke pressure, code (isothermal) vs a real accumulator (n=" + n + "), same swept volume",
    pModelEnd, pP, 0.05, "hand law p=p0*(V1/V)^n at the code's own swept V2=" + V2.toFixed(2) + " m3",
    {unit:"MPa", gap:"a tank's gas charge", note:"code reads " + distP.toFixed(1) + "% higher pressure than n=" + n + " at the same water delivered"});

  const Vstop = V1*Math.pow(p0/pModelEnd, 1/n), massPoly = (Vstop - V1)*RHO, distM = (delivered - massPoly)/massPoly*100;
  check("HPI accumulator: water delivered by the time pressure falls to " + pModelEnd.toFixed(3) + " MPa, code vs n=" + n,
    delivered, massPoly, 0.05, "hand law V=V1*(p0/p)^(1/n) inverted to mass=(V-V1)*rho",
    {unit:"kg", gap:"a tank's gas charge", note:"code delivers " + distM.toFixed(1) + "% more water than n=" + n + " would by this pressure"});
}

console.log("HPI accumulator trajectory [t, m(kg), p(MPa)]: " + JSON.stringify(samples));
