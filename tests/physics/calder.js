"use strict";
/* CALDER HALL at rest: the CO2 row's c_p against NIST Shomate, the plant held with rods held, and a fault each of its checks must catch */
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

{ const H = commissionPreset(idx), ST = H.ST, PT = H.PT, snap = H.engSnap(H.engSnapNew());
  /* 3 s with rods and boron held: T-avg drift, worst |rho|, worst heat off commissioned */
  const rest = kick => { H.engRestore(snap); H.eNetInvalidate();
    H.uiBlkSinkOff("rodStep"); H.uiBlkSinkOff("boronDem"); ST.sc[H.SC_DICEOFF] = 1;
    const Tavg0 = ST.sc[H.SC_TAVG], h0 = ST.csHeat[0];
    if(kick) kick();
    let rho = 0, heat = 0;
    for(let t=0;t<150;t++){ H.step(0.02); rho = Math.max(rho, Math.abs(ST.csRho[0])); heat = Math.max(heat, Math.abs(ST.csHeat[0]/h0 - 1)); }
    return [ST.sc[H.SC_TAVG] - Tavg0, rho, heat]; };
  const REST = "a commissioned plant at constant boundary conditions is at its own steady state: the first ticks change nothing";
  const [dT, rho, heat] = rest();
  check(name + ": T-avg over 3 s at rest, rods and boron held", dT, 0, 0.1, REST, {abs:true, unit:"K"});
  check(name + ": net reactivity over 3 s at rest, rods and boron held", rho, 0, 0.5,
    "a critical core at constant boundary conditions has rho = 0; 0.5 pcm is 1/1300 of beta", {abs:true, unit:"pcm"});
  check(name + ": core heat over 3 s at rest, rods and boron held", heat, 0, 1e-3,
    "a critical core at constant boundary conditions holds its power", {abs:true});
  { const ua = PT.stageUA[0], [dTk] = rest(() => { PT.stageUA[0] = ua*0.95; });
    PT.stageUA[0] = ua;
    check(name + ": fault injected, boiler tubes 5 % short of the commissioned duty: the T-avg rest check fails", Math.abs(dTk) > 0.1 ? 1 : 0, 1, 0, "the rest check above must be able to fail", {abs:true, note:"T-avg moved " + dTk.toFixed(3) + " K"}); }
  /* the CO2 store is a dead end: no flow and no heat, so the first law leaves its gas where it was */
  { const t = H.IX.tankId.indexOf("pzr"), i = PT.tankNode[t];
    const tick1 = kick => { H.engRestore(snap); H.eNetInvalidate(); ST.sc[H.SC_DICEOFF] = 1; if(kick) kick(); const h = ST.hBy[i]; H.step(0.02); return ST.hBy[i] - h; };
    check(name + ": CO2 store enthalpy across tick 1", tick1(), 0, 1e-3, "first law on a closed volume with no flow and no heat: u stays, and at constant p so does h", {abs:true, unit:"kJ/kg"});
    const dk = tick1(() => { ST.pAdv[i] = ST.pBy[i]; });
    check(name + ": fault injected, the store's flow-work pressure seeded at the node's own: the store check fails", Math.abs(dk) > 1e-3 ? 1 : 0, 1, 0, "the store check above must be able to fail", {abs:true, note:"h moved " + dk.toFixed(2) + " kJ/kg"}); }
  /* the plant flying on its own regulator: a 10 % load cut is a boundary condition changed, and the hold-its-power check in presets.js must see it */
  { H.engRestore(snap); H.eNetInvalidate(); ST.sc[H.SC_DICEOFF] = 1;
    const h0 = ST.sc[H.SC_HEAT]; ST.sc[H.SC_LOADDEM] = 0.9;
    for(let t=0;t<500;t++) H.step(0.02);
    const r = ST.sc[H.SC_HEAT]/h0;
    check(name + ": fault injected, load demand cut 10 %: the hold-its-power check (5 %) fails", Math.abs(r - 1) > 0.05 ? 1 : 0, 1, 0, "the hold-its-power check in presets.js must be able to fail", {abs:true, note:"heat " + r.toFixed(4) + " of commissioned at 10 s"}); }
  /* the rod regulator stood down and its bank driven 10 % of travel out, 20 s at its 1/190 per s drive: the outlet check in presets.js must see the outlet leave its set point */
  { H.engRestore(snap); H.eNetInvalidate(); ST.sc[H.SC_DICEOFF] = 1; H.uiBlkSinkOff("rodStep");
    ST.csRodDem[0] -= 0.10;
    for(let t=0;t<1000;t++) H.step(0.02);
    const code = n => H.eSigRead(H.eSigCode(n), 0), d = code("cgo") - code("cgoset"), tol = 0.02*H.coreDT0(H.coreD(H.IX.coreId[0]));
    check(name + ": fault injected, rods driven 10 % out with the regulator off: the gas outlet check fails", Math.abs(d) > tol ? 1 : 0, 1, 0, "the gas outlet check in presets.js must be able to fail", {abs:true, note:"outlet off its set point by " + d.toFixed(2) + " K against " + tol.toFixed(2)}); }
  H.engRestore(snap); H.eNetInvalidate();
}
