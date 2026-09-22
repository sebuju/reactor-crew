"use strict";
/* fidelity.md "a tank's gas charge": STOCK PWR's HPI accumulator through a cold-leg break, judged against p*V^n = const at the volume it swept */
// chunks: run fault
const lib = require("./lib.js"), {check} = lib;
const FAULT = process.argv[2] === "fault";
if(FAULT) lib.load(src => { const a = "if(PT.tankInField[t] && !(PT.tankGas[t] && PT.tankVoid[t] > 0)){", r = src.replace(a, "if(PT.tankInField[t]){");
  if(r === src) throw new Error("fault site not found"); return r; });

const G = lib.commissionPreset(0); // STOCK PWR - the reference ship's own HPI accumulator
const PT = G.PT, ST = G.ST, sc = ST.sc;

const hpiId = [...G.IX.tank.keys()].find(id => id.indexOf("hpi") === 0);
if(!hpiId){
  check("STOCK PWR: HPI accumulator present", 0, 1, 0, "buildStockPlumbing() hpi tank", {pass:false, note:"no hpi tank built"});
  process.exit(0);
}
const t = G.IX.tank.get(hpiId), i = PT.tankNode[t];
const RHO = PT.tankKg[t]/PT.tankVol[t];
const V = PT.tankVol[t], V1 = V*PT.tankVoid[t], p0 = PT.tankGasP0[t], m0 = ST.mBy[i];

{
  const snap = G.snapS(), NP = G.TANK_NPOLY;
  let wp = 0, wl = 0, at = "";
  for(const f of [1, 0.8, 0.5, 0.1]){
    ST.mBy[i] = f*m0;
    const pl = p0*Math.pow(V1/(V - f*m0/RHO), NP), ll = 100*(f*m0/RHO)/V;
    const dp = Math.abs(G.eTankP(t) - pl)/pl, dl = Math.abs(G.eTankLvl(t) - ll);
    if(dp > wp){ wp = dp; at = "m=" + f + "*m0"; } wl = Math.max(wl, dl); }
  G.restoreS(snap);
  check("HPI accumulator: pressure read off the tank's own mass by p*V^n = const, V_gas = V - m/rho", wp, 0, 1e-9,
    "ideal gas, polytropic p*V^n = const; V_gas = V - m/rho", {abs:true, note:"worst relative distance over m = 1, 0.8, 0.5, 0.1 m0" + (at ? " (at " + at + ")" : "") + (FAULT ? "; FAULT: pressure read off the solved field" : "")});
  check("HPI accumulator: level read off the tank's own mass, 100*(m/rho)/V", wl, 0, 1e-9,
    "the water fills m/rho of the tank's volume", {abs:true, unit:"%"});
  check("HPI accumulator: the seeded tank reads its charge pressure", G.eTankP(t), p0, 1e-9,
    "seeded at its commissioning level, the cushion is at p0", {unit:"MPa"});
}
if(FAULT) process.exit(0);
const mPlant = G.eLedgerKg();
let resMax = 0;

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
// a wrecked tank is an open one: the sealed cushion's law is read on the last intact tick
const part = PT.tankPart[t];
let drainedAt = -1, wreckAt = -1, ticks = 0, mEnd = m0, pModelEnd = p0, tEnd = 0;
while(sc[G.SC_T] < SECS - 1e-9 && Date.now() - t0 < WALL && !(drainedAt >= 0 && sc[G.SC_T] - drainedAt > 1)){
  G.step(0.02); ticks++;
  if(ST.dmgBy[part] > 0){ wreckAt = sc[G.SC_T]; break; }
  resMax = Math.max(resMax, Math.abs(sc[G.SC_MASSRES]));
  mEnd = ST.mBy[i]; pModelEnd = ST.pBy[i]; tEnd = sc[G.SC_T];
  if(mEnd < 1e-6 && drainedAt < 0) drainedAt = tEnd;
  if(ticks % 25 === 0) samples.push([+tEnd.toFixed(2), +mEnd.toFixed(3), +pModelEnd.toFixed(5)]);
}

const delivered = m0 - mEnd;                    // kg the model actually pushed out
const V2 = V1 + delivered/RHO;                  // the gas volume the model actually swept to
const NPOLY = G.TANK_NPOLY, pPolyEnd = p0*Math.pow(V1/V2, NPOLY);

/* the hand-written law under test: p*V^n = const */
const pPoly = (V, n) => p0*Math.pow(V1/V, n);

/* sanity (rule 6): at a bare 2x expansion, isothermal/polytropic pressure ratio is 2^(n-1) exactly */
for(const n of [1.4, 1.2])
  check("accum: hand polytropic law sanity at a 2x expansion, n=" + n, (p0*V1/(2*V1))/pPoly(2*V1, n), Math.pow(2, n - 1),
    1e-9, "ideal gas p*V^n=const: p2/p1=(V1/V2)^n, so isothermal/polytropic = 2^(n-1) at V2=2V1");

check("accum: the march reached its own read point, so the distances below are comparable", sc[G.SC_T], drainedAt >= 0 || wreckAt >= 0 ? sc[G.SC_T] : SECS, 1e-9,
  "the wall-clock guard is a guard, not a stop: a cut march reads the law at another state", {abs:true, unit:"s"});

check("STOCK PWR HPI accumulator: tank pressure follows the code's own polytropic law at full blowdown",
  pModelEnd, pPolyEnd, 0.05, "eTankLvlA()/eTankCapA()/eTankPA() (net.js): p*V^n=const with n=TANK_NPOLY", {unit:"MPa",
  gap:"a tank's gas charge", note:"n=" + NPOLY + ", V1=" + V1.toFixed(2) + " m3, swept to V2=" + V2.toFixed(2) + " m3, delivered " + delivered.toFixed(0) +
    " kg, read at t=" + tEnd.toFixed(2) + " s" + (wreckAt >= 0 ? " (tank wrecked at " + wreckAt.toFixed(2) + " s)" : "") + " with " + mEnd.toFixed(0) +
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

check("the books close through the stroke: worst per-tick ledger residual", resMax, 0, G.E_TR_LEDGER_EPS*mPlant,
  "conservation of mass; tolerance the ledger's own epsilon times the plant inventory", {abs:true, unit:"kg", note:"plant " + mPlant.toFixed(0) + " kg over " + ticks + " ticks"});

console.log("HPI accumulator trajectory [t, m(kg), p(MPa)]: " + JSON.stringify(samples));
