"use strict";
/* fidelity.md "a tank's gas charge": STOCK PWR's HPI accumulator through a cold-leg break, judged against p*V^n = const at the volume it swept */
// chunks: run fault steam cascade steam,gate cascade,spill
// preset: 0 - 0 0 - -
const lib = require("./lib.js"), {check, watch, watchNote} = lib;
const FAULT = process.argv[2] === "fault", MODE = process.argv[2] || "run", GATE = process.argv.includes("gate"), SPILL = process.argv.includes("spill");
if(FAULT) lib.load(src => { const a = "if(PT.tankInField[t] && !(PT.tankGas[t] && PT.tankVoid[t] > 0)){", r = src.replace(a, "if(PT.tankInField[t]){");
  if(r === src) throw new Error("fault site not found"); return r; });
if(GATE) lib.load(src => { const a = "if(PT.edBreak[e]){ if(PT.edSec[e]) oSec += m;", r = src.replace(a, "if(PT.edBreak[e] && !PT.edSteam[e]){ if(PT.edSec[e]) oSec += m;");
  if(r === src) throw new Error("gate fault site not found"); return r; });
if(SPILL) lib.load(src => { const a = "  eBook(E_BK_SPILLPRI, ST.sc[SC_OUTPRI]);\n", r = src.replace(a, "");
  if(r === src) throw new Error("spill fault site not found"); return r; });

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

/* the ledger through a steam-line break alone, and through the cold-leg break whose blast wrecks the tank */
if(MODE === "steam" || MODE === "cascade"){
  if(MODE === "steam") G.actId("hit", "pipe:35,4");
  else { const c = Object.values(G.pipeMap().byKey).find(r => r.k === "cold").cells[0]; G.actId("hit", "pipe:" + c[0] + "," + c[1]); G.act("tankOpen", t); }
  sc[G.SC_DICEOFF] = 1;
  const mPlant = G.eLedgerKg(), secs = MODE === "steam" ? 2 : 7.22, eps = G.E_TR_LEDGER_EPS*mPlant;
  let res = 0, at = 0, steam = 0;
  const w = watch(G, {cap:secs, fail:() => res > eps ? "the ledger broke" : "", each:() => {
    const r = Math.abs(sc[G.SC_MASSRES]); if(r > res){ res = r; at = sc[G.SC_T]; }
    for(let e=0;e<PT.n.edge;e++) if(PT.edBreak[e] && PT.edSteam[e] && ST.edgeKg[e] > 0) steam += ST.edgeKg[e]; }});
  const what = MODE === "steam" ? "a steam-line break" : "a cold-leg break and the blast cascade it sets off", ok = (MODE === "cascade" || steam > 0) && res <= eps;
  const note = "plant " + mPlant.toFixed(0) + " kg, " + steam.toFixed(0) + " kg out through steam-line holes over " + w.t.toFixed(2) + " s; worst " + res.toExponential(2) + " kg at " + at.toFixed(2) + " s";
  if(GATE || SPILL) check("fault injected, " + (GATE ? "steam-line holes" : "the primary spill") + " left off the books under " + what + ": the ledger check fails", ok ? 0 : 1, 1, 0,
    "the ledger check must be able to fail", {abs:true, note});
  else check(what + ": worst per-tick ledger residual", res, 0, eps,
    "conservation of mass: every kilogram leaving the plant is booked on the edge it leaves by; tolerance the ledger's own epsilon times the plant inventory",
    {abs:true, unit:"kg", pass:ok, note});
  process.exit(0);
}

{
  const snap = G.snapS(), NP = G.TANK_NPOLY;
  let wp = 0, wl = 0, at = "";
  for(const f of [1, 0.8, 0.5, 0.1]){
    ST.mBy[i] = f*m0;
    const pl = p0*Math.pow(V1/(V - f*m0/RHO), NP), ll = 100*(f*m0/RHO)/V;
    const dp = Math.abs(G.eTankP(t) - pl)/pl, dl = Math.abs(G.eTankLvl(t) - ll);
    if(dp > wp){ wp = dp; at = "m=" + f + "*m0"; } wl = Math.max(wl, dl); }
  G.restoreS(snap);
  const note = "worst relative distance over m = 1, 0.8, 0.5, 0.1 m0" + (at ? " (at " + at + ")" : "");
  if(FAULT){ check("fault injected, the pressure read off the solved field: the polytropic pressure check fails", wp > 1e-9 ? 1 : 0, 1, 0,
    "the pressure check must be able to fail", {abs:true, note}); process.exit(0); }
  check("HPI accumulator: pressure read off the tank's own mass by p*V^n = const, V_gas = V - m/rho", wp, 0, 1e-9,
    "ideal gas, polytropic p*V^n = const; V_gas = V - m/rho", {abs:true, note});
  check("HPI accumulator: level read off the tank's own mass, 100*(m/rho)/V", wl, 0, 1e-9,
    "the water fills m/rho of the tank's volume", {abs:true, unit:"%"});
  check("HPI accumulator: the seeded tank reads its charge pressure", G.eTankP(t), p0, 1e-9,
    "seeded at its commissioning level, the cushion is at p0", {unit:"MPa"});
}
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

/* a polytropic charge stalls with water still in it and pours again as the loop falls further, so the march runs the whole 10 s window unless the tank empties or is wrecked */
// a wrecked tank is an open one: the sealed cushion's law is read on the last intact tick
const part = PT.tankPart[t];
let drainedAt = -1, wreckAt = -1, mEnd = m0, pModelEnd = p0, tEnd = 0;
const w = watch(G, {cap:10,
  event:() => wreckAt >= 0 ? "tank wrecked" : drainedAt >= 0 && sc[G.SC_T] - drainedAt > 1 ? "tank drained" : "",
  each:() => {
    if(ST.dmgBy[part] > 0){ wreckAt = sc[G.SC_T]; return; }
    resMax = Math.max(resMax, Math.abs(sc[G.SC_MASSRES]));
    mEnd = ST.mBy[i]; pModelEnd = ST.pBy[i]; tEnd = sc[G.SC_T];
    if(mEnd < 1e-6 && drainedAt < 0) drainedAt = tEnd; }});

const delivered = m0 - mEnd;                    // kg the model actually pushed out
const V2 = V1 + delivered/RHO;                  // the gas volume the model actually swept to
const NPOLY = G.TANK_NPOLY, pPolyEnd = p0*Math.pow(V1/V2, NPOLY);

/* the hand-written law under test: p*V^n = const */
const pPoly = (V, n) => p0*Math.pow(V1/V, n);

/* sanity (rule 6): at a bare 2x expansion, isothermal/polytropic pressure ratio is 2^(n-1) exactly */
for(const n of [1.4, 1.2])
  check("accum: hand polytropic law sanity at a 2x expansion, n=" + n, (p0*V1/(2*V1))/pPoly(2*V1, n), Math.pow(2, n - 1),
    1e-9, "ideal gas p*V^n=const: p2/p1=(V1/V2)^n, so isothermal/polytropic = 2^(n-1) at V2=2V1");

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
  "conservation of mass; tolerance the ledger's own epsilon times the plant inventory", {abs:true, unit:"kg", note:"plant " + mPlant.toFixed(0) + " kg, " + watchNote(w)});
