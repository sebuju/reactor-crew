"use strict";
/* CALDER HALL at rest: does the CO2 row's one c_p agree with NIST Shomate over the core's rise, and does the plant hold with rods held */
const {check, commissionPreset, load} = require("./lib.js");
const G = load();
const idx = G.PLANTPRE.findIndex(p => p[0] === "CALDER HALL");
const name = "CALDER HALL";
const CO2 = G.COOLANT.find(c => c.id === "CO2");

/* NIST Shomate (298-1200 K range), reimplemented independently of src/data/pipenet.js's shoHA/shoCpA */
function shoCp(T){ const s = CO2.sho, t = T/1000; let r = 0; while(r + 9 < s.length && T > s[r]) r += 9;
  return (s[r+1] + t*(s[r+2] + t*(s[r+3] + t*s[r+4])) + s[r+5]/(t*t))/(1000*CO2.mmol); }
function shoH(T){ const s = CO2.sho, t = T/1000; let r = 0; while(r + 9 < s.length && T > s[r]) r += 9;
  return (t*(s[r+1] + t*(s[r+2]/2 + t*(s[r+3]/3 + t*s[r+4]/4))) - s[r+5]/t + s[r+6] - s[r+8])/CO2.mmol; }

const Tref = CO2.Tref, dT0 = CO2.dT0, Tin = Tref - dT0/2, Tout = Tref + dT0/2;
const cpRow = CO2.cp;
const riseRow = cpRow*dT0;               // coolFig().rise: what coreRatedKgs() sizes the rated mass flow against
const riseSho = shoH(Tout) - shoH(Tin);
const dhOver = riseRow - riseSho;

check(name + ": cp_row against Shomate's own local cp at Tref (rules out a *local* mismatch)", cpRow, shoCp(Tref), 0.01,
  "NIST Shomate CO2 cp(T) = A + Bt + Ct^2 + Dt^3 + E/t^2 (WebBook Shomate table, 298-1200 K), evaluated at the CO2 row's own Tref",
  {note:cpRow + " vs " + shoCp(Tref).toFixed(4) + " kJ/kg/K"});

check(name + ": design rise (cp_row x dT0) against Shomate integrated over the row's own span", riseRow, riseSho, 0.005,
  "coolFig().rise = cp_row*dT0 is what coreRatedKgs() sizes the rated mass flow against; the real rise for that span is the Shomate integral",
  {note:dhOver.toFixed(3) + " kJ/kg over-booked, " + (100*dhOver/riseSho).toFixed(2) + " % high"});

{ const H = commissionPreset(idx);
  H.uiBlkSinkOff("rodStep"); H.uiBlkSinkOff("boronDem"); H.ST.sc[H.SC_DICEOFF] = 1;
  const Tavg0 = H.ST.sc[H.SC_TAVG], h0 = H.ST.csHeat[0];
  let rho = 0, heat = 0;
  for(let t=0;t<150;t++){ H.step(0.02); rho = Math.max(rho, Math.abs(H.ST.csRho[0])); heat = Math.max(heat, Math.abs(H.ST.csHeat[0]/h0 - 1)); }
  check(name + ": T-avg over 3 s at rest, rods and boron held", H.ST.sc[H.SC_TAVG] - Tavg0, 0, 0.1,
    "a commissioned plant at constant boundary conditions is at its own steady state: the first ticks change nothing", {abs:true, unit:"K", gap:"CALDER HALL at rest"});
  check(name + ": net reactivity over 3 s at rest, rods and boron held", rho, 0, 0.5,
    "a critical core at constant boundary conditions has rho = 0; 0.5 pcm is 1/1300 of beta", {abs:true, unit:"pcm", gap:"CALDER HALL at rest"});
  check(name + ": core heat over 3 s at rest, rods and boron held", heat, 0, 1e-3,
    "a critical core at constant boundary conditions holds its power", {abs:true, gap:"CALDER HALL at rest"});
}
