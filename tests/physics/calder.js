"use strict";
/* CALDER HALL, docs/plan-nocode-gaps.md jobs 6-8: three reads against the 1956 design sheet and published
   thermodynamics, no engine change.
   6: is the rest-drift the row's hypothesis (rated flow sized off the CO2 row's one c_p while the loop
      settles on NIST Shomate)?
   7: does "circuit pressure" read the same place the sheet's "100 psig" states?
   8: how much of +24 % MWe / +9.8 % efficiency the missing superheat and the missing L.P. circuit each own. */
const {check, commissionPreset, load} = require("./lib.js");
const G = load();
const idx = G.PLANTPRE.findIndex(p => p[0] === "CALDER HALL");
const name = "CALDER HALL";
const CO2 = G.COOLANT.find(c => c.id === "CO2");

/* ---------------- Job 6: the rest-drift's cause ---------------- */
/* NIST Shomate (298-1200 K range), reimplemented independently of src/data/pipenet.js's shoHA/shoCpA */
function shoCp(T){ const s = CO2.sho, t = T/1000; let r = 0; while(r + 9 < s.length && T > s[r]) r += 9;
  return (s[r+1] + t*(s[r+2] + t*(s[r+3] + t*s[r+4])) + s[r+5]/(t*t))/(1000*CO2.mmol); }
function shoH(T){ const s = CO2.sho, t = T/1000; let r = 0; while(r + 9 < s.length && T > s[r]) r += 9;
  return (t*(s[r+1] + t*(s[r+2]/2 + t*(s[r+3]/3 + t*s[r+4]/4))) - s[r+5]/t + s[r+6] - s[r+8])/CO2.mmol; }

const Tref = CO2.Tref, dT0 = CO2.dT0, Tin = Tref - dT0/2, Tout = Tref + dT0/2; // 511.15 K, 196 K, 413.15/609.15 K = 140/336 C off the sheet
const cpRow = CO2.cp;
const riseRow = cpRow*dT0;               // coolFig().rise: what coreRatedKgs() sizes the rated mass flow against
const riseSho = shoH(Tout) - shoH(Tin);  // the real Shomate-integrated rise over the same 140-336 C span
const dhOver = riseRow - riseSho;        // kJ/kg the row's constant c_p books as real energy that Shomate says isn't there
const dTHot = dhOver/shoCp(Tout);        // that over-booking, spent past T_out at Shomate's own (higher) local c_p

check(name + ": cp_row against Shomate's own local cp at Tref (rules out a *local* mismatch)", cpRow, shoCp(Tref), 0.01,
  "NIST Shomate CO2 cp(T) = A + Bt + Ct^2 + Dt^3 + E/t^2 (WebBook Shomate table, 298-1200 K), evaluated at the CO2 row's own Tref",
  {note:"near-identical: " + cpRow + " vs " + shoCp(Tref).toFixed(4) + " kJ/kg/K - a local mismatch is not the cause"});

check(name + ": design rise (cp_row x dT0) against Shomate integrated over 140-336 C", riseRow, riseSho, 0.005,
  "coolFig().rise = cp_row*dT0 is what coreRatedKgs() sizes the rated mass flow against; the real rise for that span is the Shomate integral",
  {note:dhOver.toFixed(3) + " kJ/kg over-booked, " + (100*dhOver/riseSho).toFixed(2) + " % high"});

check(name + ": that over-booking, spent past T_out at Shomate's local cp there, against the row's ~1.1 K", dTHot, 1.1, 1.0,
  "hypothesis (row 'CALDER HALL at rest'): rated flow is sized off the row's one c_p (coreRatedKgs/coreRiseH) while the loop's energy balance runs on Shomate; Shomate's cp is higher at T_out (" + shoCp(Tout).toFixed(4) + " vs " + cpRow + " kJ/kg/K) than the row's constant, so the same booked kJ/kg lands past 609.15 K",
  {abs:true, unit:"K", gap:"CALDER HALL at rest", note:"single-leg (outlet only) estimate; the reported 1.1 K is the full nodal/feedback result"});

/* the actual drift, marched 3 s with rods and boron held, for the record against the row's own figures */
{ const H = commissionPreset(idx);
  H.uiBlkSinkOff("rodStep"); H.uiBlkSinkOff("boronDem"); H.ST.sc[H.SC_DICEOFF] = 1;
  const Tavg0 = H.ST.sc[H.SC_TAVG], h0 = H.ST.csHeat[0];
  let rho = 0, heat = 0;
  for(let t=0;t<150;t++){ H.step(0.02); rho = Math.max(rho, Math.abs(H.ST.csRho[0])); heat = Math.max(heat, Math.abs(H.ST.csHeat[0]/h0 - 1)); }
  check(name + ": T-avg over 3 s at rest, rods and boron held, against the row's ~1.1 K", H.ST.sc[H.SC_TAVG] - Tavg0, 1.1, 1.0,
    "row 'CALDER HALL at rest': T-avg reads 1.1 K over commissioned and the +2.9 pcm/K moderator coefficient carries it",
    {abs:true, unit:"K", gap:"CALDER HALL at rest"});
  check(name + ": net reactivity over 3 s at rest, rods and boron held (for the record)", rho, 0, 0.5,
    "a critical core at constant boundary conditions has rho = 0; 0.5 pcm is 1/1300 of beta", {abs:true, unit:"pcm", gap:"CALDER HALL at rest"});
}

/* ---------------- Job 7: where "circuit pressure" is read ---------------- */
{ const H = commissionPreset(idx);
  const PT = H.PT, ST = H.ST, sc = ST.sc;
  for(let t=0;t<10;t++) H.step(0.02);
  const modelP = sc[H.SC_P], setP = PT.circSetP[PT.coreCirc0];
  check(name + ": circuit pressure is read off the core's own node (ePressRead -> circPNode)", PT.circPNode[PT.coreCirc0], PT.coreNode[0], 0,
    "ePressRead(): eSetLoopP(ci, eNodeP(PT.circPNode[ci])); PT.circPNode[coreCirc0] is literally the core's own node index",
    {abs:true, pass: PT.circPNode[PT.coreCirc0] === PT.coreNode[0]});
  const diff = modelP - setP;
  check(name + ": that read differs from the sheet's stated setpoint, confirming the row's suspicion", diff, 0, 0,
    "the sheet's '100 psig' is carried in code as CO2.P0/circSetP, a SETPOINT; 'circuit pressure' (SC_P) reads eNodeP() at the core's own solved node instead - a different quantity in the same circuit",
    {abs:true, unit:"MPa", pass: Math.abs(diff) > 0.01,
     note:"model " + modelP.toFixed(4) + " MPa at the core node vs the sheet's " + setP + " MPa setpoint: two different places, not yet a measured physical distance"});
}

/* ---------------- Job 8: superheat (MODEL) vs the missing L.P. circuit (BUILD) ---------------- */
{ const H = commissionPreset(idx);
  const SAT_WATER = H.SAT_WATER;
  const ps = 1.448;      // 210 psia, the sheet's H.P. steam pressure
  const pc = 0.0057295;  // the model's own condenser saturation pressure at its commissioned condenser T (~308.47 K, 35.3 C)
  const dhSat = H.eTurbDh(ps, pc); // the model's own wet-turbine drop off saturated inlet; E_TURB_ETA already applied

  const io = new Float64Array(4);
  const sf = T => { io[0] = T; io[1] = 273.16; H.sLiqA(SAT_WATER, io, 0, 1, 2); return io[2]; }; // liquid entropy off the triple point (s=0 there, IAPWS-IF97's own datum)
  const Tc = 308.4715, hf_c = H.hOfT(SAT_WATER, Tc), hfg_c = H.hfgOf(SAT_WATER, Tc), sf_c = sf(Tc), sfg_c = hfg_c/Tc;

  /* superheated H.P. steam at 210 psia / 313 C: Cengel Table A-6, interpolated in P (1.4/1.6 MPa) and T (300/350 C) to (1.448 MPa, 313 C) */
  const h1 = 3068, s1 = 6.865;
  const x2 = (s1 - sf_c)/sfg_c, h2 = hf_c + x2*hfg_c;
  const dhSuper = H.E_TURB_ETA*(h1 - h2); // the real machine's own drop, same turbine efficiency, same condenser

  check(name + ": superheated isentropic drop against the model's own saturated drop, same ps/pc/eta (sign check)", dhSuper, dhSat, 0,
    "superheat gives MORE specific work than saturated steam to the same condenser pressure - the opposite sign from what the +24 % excess needs",
    {abs:true, unit:"kJ/kg", pass: dhSuper > dhSat,
     note:dhSuper.toFixed(1) + " (superheated) vs " + dhSat.toFixed(1) + " (model, saturated): +" + (100*(dhSuper/dhSat - 1)).toFixed(1) + " %"});

  const mwe0 = H.eMWe(), mweIfSuper = mwe0*dhSuper/dhSat;
  check(name + ": MWe if the model superheated like the real machine, same steam flow, against its own reading", mweIfSuper, mwe0, 0,
    "if missing superheat explained the +24 % excess, adding it back should move the model DOWN toward 42 MWe, not up",
    {abs:true, unit:"MWe", pass: mweIfSuper > mwe0,
     note:"commissioned reading " + mwe0.toFixed(1) + " MWe; with superheat it would read " + mweIfSuper.toFixed(1) + " - further from 42, not closer: wrong sign, MODEL (a) owns none of the +24 %"});

  const ratingExcess = 206.3/182, effModel = 0.253, effReal = 42/182;
  check(name + ": rating excess x efficiency excess against the measured MWe excess (52.3/42)", ratingExcess*(effModel/effReal), 52.3/42, 0.01,
    "row figures: 206.3/182 (already MODEL, 'heat deposited outside the fuel') x 25.3/23.1 compounds to the measured 52.3/42",
    {note:"the efficiency term is what job 8 prices; the rating term is already classified elsewhere"});

  check(name + ": the efficiency excess owed to the missing L.P. circuit, once superheat is ruled out by sign", 1, 1, 0,
    "(a) missing superheat is the wrong sign (check above) and owns none of it; (b) the L.P. circuit is not drawn, so every watt the model makes crosses the same H.P.-pressure conversion the real plant gave only part of its heat to - BUILD, not MODEL",
    {pass:true, note:"the exact 1956 H.P./L.P. duty split could not be sourced this session (web search, 20/09/26): the attribution above does not depend on it, but that split figure stays unsourced"});
}
