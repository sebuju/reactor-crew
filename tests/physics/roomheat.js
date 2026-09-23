"use strict";
// chunks: cp cv charge energy adia struct plate wet wetcold wetfull ring mix sound h2ign
/* The compartment's gas as a real gas: its heat capacity is the mass actually in the cell, at its own
   species mixture, on c_p(T). Every target here is NIST Shomate, the published dry-air tables, the ideal
   gas law, the first law at constant volume, or the two-body lumped relaxation - computed in the check. */
const {check, rig, load, layWater, if97} = require("./lib.js");
const mode = process.argv[2] || "cp";
const HWL = "const hw = ((dT > 0 ? ROOM_HW : ROOM_HW_UN) + (full ? (dT > 0 ? ROOM_HW_UN : ROOM_HW) : 0))*MPC*MPC + ROOM_HW_V*";
const FAULTS = {
  fault:["the expansion priced on (gamma-1) U alone",
    ["else { Dx[i] = -(Gm[i] - 1)*d/vg[i]; Wn[i] = Hb[i]*Mm[i]*d/vg[i]; }", "else Dx[i] = -(Gm[i] - 1)*d/vg[i];"]],
  fault280:["every wetted surface at the stable plate's coefficient",
    [/const ROOM_HW_UN = [\d.]+;/, "const ROOM_HW_UN = ROOM_HW;"], [/const ROOM_HW_V = [\d.]+;/, "const ROOM_HW_V = ROOM_HW;"]],
  faultsign:["the sign test flipped", [HWL, HWL.replace(/dT > 0/g, "dT < 0")]]};
const FK = Object.keys(FAULTS).find(k => process.argv.includes(k));
const G = load(FK ? src => { for(const [a, b] of FAULTS[FK].slice(1)){ const r = src.replace(a, b);
  if(r === src) throw new Error(FK + ": line not found"); src = r; } return src; } : undefined);
const FNOTE = FK ? "; FAULT: " + FAULTS[FK][0] : "";

/* saturated water at 330 K, Incropera & DeWitt Table A.6, typed a second time: v_f m3/kg, mu N s/m2, k W/m/K, Pr, beta 1/K */
const TAB = {vf:1.016e-3, mu:489e-6, k:0.650, Pr:3.15, beta:504.0e-6};
const TABSRC = "Incropera & DeWitt, Fundamentals of Heat and Mass Transfer, Table A.6, saturated water at 330 K; L = MPC, dT 50 K";
/* W/m2/K of each wetted surface on its own correlation at the table's point */
const HWPUB = (() => { const nu = TAB.mu*TAB.vf, L = G.MPC, Ra = 9.80665*TAB.beta*50*L*L*L/(nu*nu/TAB.Pr), k = TAB.k/L;
  return {Ra, st:0.27*Math.pow(Ra, 0.25)*k, un:0.15*Math.cbrt(Ra)*k,
    v:Math.pow(0.825 + 0.387*Math.pow(Ra, 1/6)/Math.pow(1 + Math.pow(0.492/TAB.Pr, 9/16), 8/27), 2)*k}; })();
const SIGMA = 5.670374419e-8;

const NIST = "NIST WebBook Shomate coefficients (N2, O2, Ar, CO2, H2, H2O), c_p J/mol/K at t = T/1000";
const AIRTAB = "published dry-air ideal-gas c_p: 1.005 (300 K), 1.141 (1000 K), 1.249 (2000 K) kJ/kg/K";
const FIRST = "first law at constant volume, dU = q dt, with p = m R T / V (ideal gas)";

/* the law a second time, off the rows the model states, evaluated by shoCpA directly */
const IO = new Float64Array(2);
function cpLaw(sp, T){
  IO[0] = T < G.SHO_TLO ? G.SHO_TLO : T > G.SHO_THI ? G.SHO_THI : T;
  if(sp === 1){ G.shoCpA(G.VAP_SHO, IO, 0, 1); return IO[1]; }
  if(sp === 2){ G.shoCpA(G.H2_SHO, IO, 0, 1); return IO[1]; }
  let v = 0;
  for(const row of G.AIR_MIX){ G.shoCpA(row[1], IO, 0, 1); v += row[0]*IO[1]; }
  return v;
}
/* published dry air, linear between the three tabulated points */
const AIR_T = [300, 1000, 2000], AIR_CP = [1.005, 1.141, 1.249];
function airCpPub(T){
  if(T <= AIR_T[0]) return AIR_CP[0];
  if(T >= AIR_T[2]) return AIR_CP[2];
  const k = T <= AIR_T[1] ? 0 : 1;
  return AIR_CP[k] + (AIR_CP[k+1] - AIR_CP[k])*(T - AIR_T[k])/(AIR_T[k+1] - AIR_T[k]);
}
const airGamPub = T => airCpPub(T)/(airCpPub(T) - G.ROOM_SP_R[0]);

/* a sealed liner box on an empty board: the interior cells are a closed system with no hull face on them */
function sealed(x0, x1, y0, y1){
  rig((R, GG) => { const D = GG.D; D.mat = D.mat || {};
    for(let x=x0-1;x<=x1+1;x++){ D.mat[x + "," + (y0-1)] = {m:"liner"}; D.mat[x + "," + (y1+1)] = {m:"liner"}; }
    for(let y=y0;y<=y1;y++){ D.mat[(x0-1) + "," + y] = {m:"liner"}; D.mat[(x1+1) + "," + y] = {m:"liner"}; } });
  const c = [];
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) c.push(y*G.GW + x);
  return c;
}
const run = n => { for(let i=0;i<n;i++) G.step(0.02); };
/* the box's gas internal energy, and the structure's, in the model's own datum */
function gasU(cells){
  let u = 0;
  for(const i of cells){ G.eRoomGasA(i); u += G.E_RR[G.RR_UC]; }
  return u;
}
const strU = cells => { const s = G.ST; let u = 0;
  for(const i of cells) u += (G.ROOM_CSTRUCT + G.PT.rFace[i]*G.ROOM_CSTRUCT_F)*s.roomTS[i];
  return u; };
const boxU = cells => gasU(cells) + strU(cells);
const boxP = cells => { let p = 0; for(const i of cells) p += G.ST.roomP[i]; return p/cells.length; };
const boxT = cells => { let t = 0; for(const i of cells) t += G.ST.roomT[i]; return t/cells.length; };
const wVol = i => { const w = G.ST.roomWater[i]; if(!(w > 0)) return 0; G.eRoomWRhoA(i); return w/G.E_RR[G.RR_WRHO]; };

if(mode === "cp"){
  for(const [sp, nm] of [[0,"air"],[1,"water vapour"],[2,"hydrogen"]])
    for(const T of [300, 1000, 2000])
      check("c_p " + nm + " at " + T + " K, interpolated table vs the Shomate law", G.roomSpCp(sp, T), cpLaw(sp, T), 1e-3, NIST,
        {unit:"kJ/kg/K"});
  for(const T of AIR_T)
    check("c_p dry air at " + T + " K vs the published air table", G.roomSpCp(0, T), airCpPub(T), 0.01, AIRTAB, {unit:"kJ/kg/K"});
  /* the grid step is chosen here, not before: the interpolant is asked BETWEEN its own nodes */
  let worst = 0, atT = 0, atS = -1;
  for(let sp=0;sp<3;sp++) for(let k=0;k<G.ROOM_CPN-1;k++){
    const T = G.ROOM_CPT0 + (k + 0.5)*G.ROOM_CPDT, law = cpLaw(sp, T);
    const e = Math.abs(G.roomSpCp(sp, T) - law)/law;
    if(e > worst){ worst = e; atT = T; atS = sp; } }
  check("the c_p table between its own nodes, every species, whole grid", worst, 0, 1e-3, NIST,
    {abs:true, unit:"relative", note:"grid " + G.ROOM_CPN + " points, step " + G.ROOM_CPDT.toFixed(3) +
      " K; worst at species " + atS + ", " + atT.toFixed(0) + " K"});
  for(const T of [300, 1000])
    check("gamma of dry air at " + T + " K", G.roomSpCp(0, T)/(G.roomSpCp(0, T) - G.ROOM_SP_R[0]), airGamPub(T), 0.01,
      AIRTAB + "; gamma = c_p/(c_p - R/M), R/M = 8.314462618/0.02896 J/kg/K", {unit:"-"});
}

if(mode === "cv"){
  const cells = sealed(24, 28, 12, 12), i = cells[2], s = G.ST;
  const m0 = s.roomM[i], T = s.roomT[i];
  /* half air, half hydrogen by mass: the capacity is the mass-weighted sum and nothing else */
  s.roomH2[i] = m0/2;
  G.eRoomGasA(i);
  const want = m0/2*(G.roomSpCp(0,T) - G.ROOM_SP_R[0]) + m0/2*(G.roomSpCp(2,T) - G.ROOM_SP_R[2]);
  check("a cell half air and half hydrogen by mass: its heat capacity", G.E_RR[G.RR_CVC], want, 1e-3,
    "a mixture's heat capacity is the mass-weighted sum of its components', ideal gas", {unit:"kJ/K"});
  const mixCv = G.E_RR[G.RR_CVC];
  s.roomH2[i] = 0; G.eRoomGasA(i);
  check("...and how far that is from the all-air value it replaces", mixCv/G.E_RR[G.RR_CVC], 7, 0.1,
    "c_v hydrogen / c_v air = 10.2/0.718 at 300 K, so a half-and-half cell is about 7x", {unit:"-"});
  /* capacity is m*c_v: half the mass, twice the rise for the same kilojoule */
  const kJ = 20;
  const T0 = s.roomT[i];
  G.E_RR[G.RR_BANG] = kJ; G.eRoomBang(i);
  const full = s.roomT[i] - T0;
  s.roomT[i] = T0; s.roomM[i] = m0/2;
  G.E_RR[G.RR_BANG] = kJ; G.eRoomBang(i);
  const half = s.roomT[i] - T0;
  check("a cell vented to half its mass, the rise for the same kilojoule", half/full, 2, 2e-3,
    "the capacity of a cell of gas is m*c_v: it is the mass actually in it", {unit:"-",
      note:"full cell " + full.toFixed(3) + " K, half " + half.toFixed(3) + " K"});
}

if(mode === "charge"){
  /* a known energy into a sealed box at constant volume: the gauge it settles at is (gamma-1) E / V */
  for(const kW of [40, 3000]){
    const cells = sealed(22, 30, 11, 15), s = G.ST;
    const V = cells.length*G.ROOM_VCELL, secs = 4;
    run(1);
    const T0 = boxT(cells), p0 = boxP(cells), U0 = gasU(cells);
    G.act("injectOn", 1, kW, cells[(cells.length>>1)], -1);
    run(Math.round(secs/0.02));
    G.act("injectOn", 0, 0, -1, -1);
    run(200);
    const T1 = boxT(cells), E = gasU(cells) - U0;
    const gam = airGamPub((T0 + T1)/2);
    check("sealed box, " + kW + " kW for " + secs + " s: the gauge it settles at", boxP(cells) - p0, (gam - 1)*E/V, 0.02,
      FIRST + "; dp = (gamma-1) E / V, gamma from " + AIRTAB,
      {unit:"kPa", note:"E " + E.toFixed(1) + " kJ of gas internal energy into " + V.toFixed(2) + " m3, " + T0.toFixed(0) +
        " -> " + T1.toFixed(0) + " K, gamma " + gam.toFixed(4)});
  }
}

if(mode === "energy"){
  const cells = sealed(22, 30, 11, 15), s = G.ST;
  run(1);
  /* a step nothing balances, then 200 ticks of transport and relaxation inside a closed box */
  for(const i of cells) s.roomT[i] += (i % 3)*90;
  const U0 = boxU(cells);
  run(200);
  check("a sealed box over 200 ticks of gas transport and structure relaxation", (boxU(cells) - U0)/Math.abs(U0), 0, 1e-9,
    "conservation of energy: transport and an internal conductance relocate energy, they create none",
    {abs:true, unit:"relative", note:"gas internal energy plus structure, " + cells.length + " cells, no hull face"});
}

if(mode === "adia"){
  /* What stays behind in a DISCHARGING cell expands adiabatically: T/T0 = (p/p0)^((g-1)/g). Only while
     the cell is still emptying - once the wave turns round and refills it, the cell is an open system
     taking in its neighbours' gas and the isentrope is no longer the statement being made about it. */
  const cells = sealed(6, 53, 12, 12), s = G.ST, i = cells[24];
  run(1);
  G.act("blast", i, 2000);
  run(1);
  const T0 = s.roomT[i], p0 = s.roomP[i] + G.ROOM_P0;
  let worst = 0, note = "", prev = p0, n = 0;
  for(let k=0;k<6;k++){
    run(1);
    const T = s.roomT[i], p = s.roomP[i] + G.ROOM_P0;
    if(!(p < prev)) break;
    prev = p; n++;
    const gam = airGamPub((T + T0)/2), want = T0*Math.pow(p/p0, (gam - 1)/gam);
    const e = Math.abs(T - want)/want;
    note += "tick " + (k+1) + ": " + p.toFixed(0) + " kPa, " + T.toFixed(1) + " K against " + want.toFixed(1) +
      " (" + (e*100).toFixed(2) + " %) ";
    if(e > worst) worst = e;
  }
  check("gas left behind in a blowing-down cell follows its own isentrope", worst, 0, 0.02,
    "adiabatic expansion of the gas remaining in a discharging volume: T/T0 = (p/p0)^((gamma-1)/gamma)",
    {abs:true, unit:"relative", pass:n > 0 && worst <= 0.02,
     note:"worst of " + n + " discharging tick(s) from " + p0.toFixed(0) + " kPa, " + T0.toFixed(0) + " K; " + note});
}

if(mode === "struct"){
  const cells = sealed(22, 30, 11, 15), s = G.ST;
  run(1);
  for(const i of cells) s.roomT[i] = 600;
  const gap = () => { let a = 0, b = 0; for(const i of cells){ a += s.roomT[i]; b += s.roomTS[i]; }
    return (a - b)/cells.length; };
  const air = () => { let a = 0; for(const i of cells) a += s.roomT[i]; return a/cells.length; };
  const t1 = 20, t2 = 120;
  run(Math.round(t1/0.02));
  const g1 = gap(), a1 = air();
  run(Math.round((t2 - t1)/0.02));
  const g2 = gap(), a2 = air();
  const tauM = (t2 - t1)/Math.log(g1/g2);
  const i0 = cells[0], Tm = (a1 + a2)/2;
  const Ca = s.roomM[i0]*(G.roomSpCp(0, Tm) - G.ROOM_SP_R[0]), Cs = G.ROOM_CSTRUCT, g = G.ROOM_GSTRUCT;
  const tau = Ca*Cs/(g*(Ca + Cs));
  check("air over structure, nothing else running: the time constant of the gap", tauM, tau, 0.02,
    "two-body lumped relaxation, tau = Ca Cs / (g (Ca + Cs)), Ca = m c_v(T) of the cell's own gas, " +
    "Cs = 8 mm steel over floor and deckhead, g = 6 W/m2/K over the same area",
    {unit:"s", note:"Ca " + Ca.toFixed(4) + " kJ/K, Cs " + Cs.toFixed(2) + " kJ/K, g " + g.toFixed(5) +
      " kW/K; gap " + g1.toFixed(2) + " K at " + t1 + " s to " + g2.toFixed(2) + " K at " + t2 + " s"});
}

/* a pool a quarter of a cell deep on the floor of the sealed box at Tw, its plates at Ts, the gas at T_HULL */
function pool(Tw, Ts){
  const cells = sealed(22, 30, 11, 15), s = G.ST, wet = [];
  run(1);
  G.eLqBind();
  const q = G.E_LQ[0], e = G.hOfT(G.SAT_WATER, Tw);
  for(let x=22;x<=30;x++){ const i = 15*G.GW + x, kg = 0.25*G.eLqCap(q, i); G.eLiqLandAt(q, i, kg, kg*e, 0); s.roomTS[i] = Ts; wet.push(i); }
  s.roomWU.fill(0); s.roomWV.fill(0);
  run(1);
  return {cells, wet, gap:() => { let a = 0; for(const i of wet) a += G.eRoomWaterT(i) - s.roomTS[i]; return a/wet.length; }};
}
/* cell i's water and plate capacities, kJ/K: m c_p on IF97 at its own T, 8 mm steel over floor, deckhead and each outward face */
const caps = i => { const s = G.ST, Tw = G.eRoomWaterT(i);
  return {Cw:s.roomWater[i]*if97((G.ROOM_P0 + Math.max(0, s.roomWP[i]))/1000, Tw).cp, Cs:G.ROOM_CSTRUCT + G.PT.rFace[i]*G.ROOM_CSTRUCT_F}; };
const LUMP = "two-body lumped relaxation, tau = Cw Cs / (gw (Cw + Cs)), Cw = m c_p(T,p) of the cell's own water on IF97, Cs = 8 mm steel over floor and deckhead";

if(mode === "wet"){
  /* hot water over a cold floor: the stable plate */
  const {cells, wet, gap} = pool(353, G.T_HULL), s = G.ST;
  const watU = () => { let u = 0; for(const i of cells) u += s.roomWaterE[i]; return u; };
  const t1 = 20, t2 = 120;
  const U0 = boxU(cells) + watU(), g0 = gap(), vw = cells.map(i => wVol(i));
  let hot = 0, bound = 0, gross = 0;
  const tick = () => { G.step(0.02);
    for(const i of wet) if(s.roomTS[i] > G.eRoomWaterT(i) + 1e-6) hot++;
    let lo = Infinity, hi = -Infinity, g = 0;
    for(let n=0;n<cells.length;n++){ const i = cells[n], v = wVol(i), d = v - vw[n], p = (s.roomP[i] + G.ROOM_P0)*1000;
      vw[n] = v; g += Math.abs(d); if(p < lo) lo = p; if(p > hi) hi = p;
      bound += 0.5*G.GAM_AIR*p*d*d/G.eRoomVgas(i)/1000; }
    bound += 0.5*(hi - lo)*g/1000; gross += g; };
  for(let k=0;k<Math.round(t1/0.02);k++) tick();
  const g1 = gap();
  for(let k=0;k<Math.round((t2 - t1)/0.02);k++) tick();
  const g2 = gap(), U1 = boxU(cells) + watU();
  const tauM = (t2 - t1)/Math.log(g1/g2);
  const {Cw, Cs} = caps(wet[0]), gw = HWPUB.st*G.MPC*G.MPC/1000, gg = G.ROOM_GSTRUCT;
  const tau = Cw*Cs/(gw*(Cw + Cs));
  check("hot water over the plate it stands on: the time constant of the gap", tauM, tau, 0.05,
    LUMP + "; gw the floor alone on McAdams' stable plate, Nu = 0.27 Ra^1/4 (Incropera eq. 9.32), " + TABSRC,
    {unit:"s", gap:"...the water's temperature", note:"Cw " + Cw.toFixed(1) + " kJ/K, Cs " + Cs.toFixed(2) + " kJ/K, gw " +
      gw.toFixed(5) + " kW/K against the gas's " + gg.toFixed(5) + " on the same plate; gap " + g0.toFixed(2) + " K laid, " +
      g1.toFixed(2) + " K at " + t1 + " s to " + g2.toFixed(2) + " K at " + t2 + " s" + FNOTE});
  check("...and the box's energy over the same window", U1 - U0, 0, bound,
    "conservation of energy: a conductance relocates energy, it creates none. The water counts as its stored E: the tick moves it by " +
    "heat alone, which is an incompressible liquid's du (dh - v dp); h - p v at the live p would book the gas's pressure rise as water " +
    "energy. Tolerance: the gas's net p dV, at most half its pressure spread times the gross water volume moved, plus the pricing's " +
    "second-order sum(gamma p dV^2 / 2 V) per cell per tick",
    {abs:true, unit:"kJ", note:"gas plus structure plus water, " + cells.length + " cells, no hull face; " + (U1 - U0).toExponential(3) +
      " kJ of " + U0.toFixed(0) + "; gross " + gross.toExponential(3) + " m3 of water volume moved" + FNOTE});
  check("...and the plate never leaves the gradient", hot, 0, 0,
    "the second law: heat runs from the water down to the colder plate, so the plate never passes the water",
    {abs:true, unit:"cell-ticks with the plate over its water"});
}

if(mode === "plate"){
  const L = "; Ra " + HWPUB.Ra.toExponential(3);
  check("the stable wetted plate against McAdams", G.ROOM_HW, HWPUB.st, 0.02, TABSRC + "; Nu = 0.27 Ra^1/4, Incropera eq. 9.32",
    {unit:"W/m2/K", note:"floor under warmer water, deckhead over colder" + L + FNOTE});
  check("the unstable wetted plate", G.ROOM_HW_UN, HWPUB.un, 0.02, TABSRC + "; Nu = 0.15 Ra^1/3, Incropera eq. 9.31, stated to Ra 1e11",
    {unit:"W/m2/K", note:"floor under colder water, deckhead over warmer" + L + FNOTE});
  check("the wetted vertical plate against Churchill-Chu", G.ROOM_HW_V, HWPUB.v, 0.02, TABSRC + "; Incropera eq. 9.26, all Ra",
    {unit:"W/m2/K", note:"the hull skin to the water's depth" + L + FNOTE});
}

if(mode === "wetcold"){
  /* cold water on a hot floor: the unstable plate */
  const {wet, gap} = pool(G.T_HULL, 353), s = G.ST, t1 = 5, t2 = 45;
  let cold = 0;
  const tick = n => { for(let k=0;k<n;k++){ G.step(0.02); for(const i of wet) if(s.roomTS[i] < G.eRoomWaterT(i) - 1e-6) cold++; } };
  const g0 = gap(); tick(Math.round(t1/0.02));
  const g1 = gap(); tick(Math.round((t2 - t1)/0.02));
  const g2 = gap(), tauM = (t2 - t1)/Math.log(g1/g2);
  const {Cw, Cs} = caps(wet[0]), gw = HWPUB.un*G.MPC*G.MPC/1000, tau = Cw*Cs/(gw*(Cw + Cs));
  check("cold water on a hot plate: the time constant of the gap", tauM, tau, 0.05,
    LUMP + "; gw the floor alone on the unstable plate, Nu = 0.15 Ra^1/3 (Incropera eq. 9.31), " + TABSRC,
    {unit:"s", note:"Cw " + Cw.toFixed(1) + " kJ/K, Cs " + Cs.toFixed(2) + " kJ/K, gw " + gw.toFixed(5) + " kW/K; gap " + g0.toFixed(2) +
      " K laid, " + g1.toFixed(2) + " K at " + t1 + " s to " + g2.toFixed(2) + " K at " + t2 + " s" + FNOTE});
  check("...and the plate never drops below its water", cold, 0, 0,
    "the second law: heat runs from the hot plate up into the colder water, so the plate never passes the water",
    {abs:true, unit:"cell-ticks with the plate under its water"});
}

if(mode === "wetfull"){
  /* a box against the hull: its two lower rows full of cold water on hot plates, the row over them half full */
  const X1 = 3, Y0 = 20, Y1 = 25, Tw0 = G.T_HULL, Ts0 = 353, M = {m:"liner"};
  rig((R, GG) => { const D = GG.D; D.mat = D.mat || {};
    for(let x=0;x<=X1+1;x++){ D.mat[x + "," + (Y0-1)] = M; D.mat[x + "," + (Y1+1)] = M; }
    for(let y=Y0;y<=Y1;y++) D.mat[(X1+1) + "," + y] = M; });
  const s = G.ST, GW = G.GW, cells = [];
  for(let y=Y0;y<=Y1;y++) for(let x=0;x<=X1;x++) cells.push(y*GW + x);
  layWater(G, cells, (x, y) => y >= Y1 - 1 ? 1 : y === Y1 - 2 ? 0.5 : 0, Tw0);
  for(const i of cells) if(s.roomWater[i] > 0) s.roomTS[i] = Ts0;
  s.roomWU.fill(0); s.roomWV.fill(0);
  const probe = [Y1*GW, Y1*GW + 1], t1 = 5, t2 = 40, dt = 0.02;
  const gapOf = i => G.eRoomWaterT(i) - s.roomTS[i], law = [], g0 = probe.map(gapOf);
  for(const i of probe){ const {Cw, Cs} = caps(i), f = G.PT.rFace[i];
    const gw = ((HWPUB.un + HWPUB.st)*G.MPC*G.MPC + HWPUB.v*f*G.HULL_FACE_A)/1000, kR = G.HULL_EMIS*SIGMA*f*G.HULL_FACE_A/1000;
    let Tw = G.eRoomWaterT(i), Ts = s.roomTS[i];
    const at = [];
    for(let k=1;k<=Math.round(t2/dt)*10;k++){ const q = gw*(Ts - Tw), h = dt/10;
      Tw += q/Cw*h; Ts -= (q + kR*(Math.pow(Ts, 4) - Math.pow(G.T_SPACE, 4)))/Cs*h;
      if(k === Math.round(t1/dt)*10 || k === Math.round(t2/dt)*10) at.push(Tw - Ts); }
    law.push({Cw, Cs, gw, f, tau:(t2 - t1)/Math.log(at[0]/at[1])}); }
  let full = 0;
  const tick = n => { for(let k=0;k<n;k++){ G.step(dt); for(const i of probe) if(G.eLqFull(G.E_LQ[0], i)) full++; } };
  tick(Math.round(t1/dt)); const g1 = probe.map(gapOf);
  tick(Math.round((t2 - t1)/dt)); const g2 = probe.map(gapOf);
  probe.forEach((i, n) => { const L = law[n], tauM = (t2 - t1)/Math.log(g1[n]/g2[n]);
    check("a full cell of cold water on hot plates, " + (L.f ? L.f + " hull faces wetted" : "no hull face") + ": the time constant of the gap",
      tauM, L.tau, 0.05, LUMP + " and each outward face; gw the floor on the unstable plate (Incropera eq. 9.31), the deckhead on the " +
      "stable one (eq. 9.32), each hull face on Churchill-Chu (eq. 9.26), " + TABSRC + "; the plate's radiation to space by " +
      "Stefan-Boltzmann at the drawn emissivity, integrated beside it",
      {unit:"s", pass:full === probe.length*Math.round(t2/dt) && Math.abs(tauM - L.tau) <= 0.05*L.tau,
       note:"cell " + (i%GW) + "," + Y1 + ": Cw " + L.Cw.toFixed(1) + " kJ/K, Cs " + L.Cs.toFixed(2) + " kJ/K, gw " + L.gw.toFixed(4) +
         " kW/K; gap " + g0[n].toFixed(2) + " K laid, " + g1[n].toFixed(2) + " K at " + t1 + " s to " + g2[n].toFixed(2) + " K at " + t2 +
         " s; full " + full + " of " + probe.length*Math.round(t2/dt) + " cell-ticks" + FNOTE}); });
}

if(mode === "ring"){
  /* a floor of water pumped in and back out of a sealed box: its gas is rung through whole cycles and comes back to its own adiabat */
  const cells = sealed(22, 30, 11, 15), s = G.ST, Y = 15, floor = [];
  run(1);
  G.eLqBind();
  const q = G.E_LQ[0], hIn = G.hOfT(G.SAT_WATER, G.T_HULL);
  for(let x=22;x<=30;x++){ const i = Y*G.GW + x, kg = 0.25*G.eLqCap(q, i); G.eLiqLandAt(q, i, kg, kg*hIn, 0); floor.push(i); }
  s.roomWU.fill(0); s.roomWV.fill(0);
  run(5);
  const RU = 8.314462618, gam = G.GAM_AIR;
  const mol = i => (s.roomM[i] - s.roomVap[i] - s.roomH2[i])/0.02896 + s.roomVap[i]/0.018015 + s.roomH2[i]/0.002016;
  const gas = () => { let nT = 0, V = 0; for(const i of cells){ nT += mol(i)*s.roomT[i]; V += G.eRoomVgas(i); } return {p:nT*RU/V, V}; };
  const watE = () => { let e = 0; for(const i of cells) e += s.roomWaterE[i]; return e; };
  const pump = (i, dv) => { G.eRoomWRhoA(i); const dm = dv*G.E_RR[G.RR_WRHO], h = dm > 0 ? hIn : s.roomWaterE[i]/s.roomWater[i], v0 = G.eRoomVgas(i);
    s.roomWaterE[i] += h*dm; s.roomWater[i] += dm; s.gsDisp[i] += v0 - G.eRoomVgas(i); return h*dm; };
  const g0 = gas(), U0 = g0.p*g0.V/(gam - 1)/1000, A = 0.01, HALF = 25, CYC = 4, dv = A*g0.V/(HALF*floor.length);
  const vg = cells.map(i => G.eRoomVgas(i));
  let st = strU(cells), we = watE(), ds = 0, bound = 0, g = g0, vmin = g0.V;
  for(let k=0;k<2*HALF*CYC;k++){
    let hp = 0; const sgn = ((k/HALF)|0) % 2 ? -1 : 1;
    for(const i of floor) hp += pump(i, sgn*dv);
    G.step(0.02);
    const g1 = gas(), st1 = strU(cells), we1 = watE(), Q = -(st1 - st) - (we1 - we - hp);
    ds += (gam - 1)*Q*1000/(0.5*(g.p*g.V + g1.p*g1.V));
    for(let n=0;n<cells.length;n++){ const i = cells[n], v = G.eRoomVgas(i), d = v - vg[n]; vg[n] = v;
      bound += 0.5*gam*(s.roomP[i] + G.ROOM_P0)*d*d/v/U0; }
    st = st1; we = we1; g = g1; if(g.V < vmin) vmin = g.V; }
  const creep = Math.log(g.p*Math.pow(g.V, gam)) - Math.log(g0.p*Math.pow(g0.V, gam)) - ds;
  check("a gas rung through " + CYC + " full cycles returns to its own adiabat", creep, 0, bound,
    "an adiabatic ideal gas keeps p V^gamma; heat exchanged moves ln(p V^gamma) by (gamma-1) dQ/(p V) and is taken out. " +
    "Tolerance: the scheme's own second-order sum(gamma p dV^2 / 2 V) per cell per tick, over U0 = p0 V0/(gamma-1)",
    {abs:true, unit:"ln(p V^gamma)", pass:Math.abs(creep) <= bound && g0.V - vmin > 0.9*A*g0.V,
     note:"swing " + (100*(g0.V - vmin)/g0.V).toFixed(2) + " % of " + g0.V.toFixed(2) + " m3 at " + (g0.p/1000).toFixed(2) +
       " kPa, " + 2*HALF + " ticks a cycle; heat taken out " + ds.toExponential(3) + FNOTE});
}

if(mode === "mix"){
  /* a cosine in T at UNIFORM pressure, so nothing flows and the only transport is the eddy exchange.
     It decays at alpha k^2 plus the structure's own g/Ca, and alpha is what is being measured. */
  const X0 = 14, X1 = 45, Y = 16;
  const cells = sealed(X0, X1, Y, Y), s = G.ST;
  run(1);
  const L = cells.length, k = Math.PI/(L*G.MPC), T0 = 293, A = 5;
  const M0 = s.roomM[cells[0]], P0 = s.roomP[cells[0]];
  const amp = () => { let a = 0; for(let n=0;n<L;n++) a += s.roomT[cells[n]]*Math.cos(k*(n + 0.5)*G.MPC);
    return 2*a/L; };
  for(let n=0;n<L;n++){ const i = cells[n], T = T0 + A*Math.cos(k*(n + 0.5)*G.MPC);
    s.roomT[i] = T; s.roomM[i] = M0*T0/T; }
  const a0 = amp(), t1 = 2;
  run(Math.round(t1/0.02));
  const a1 = amp();
  const lam = Math.log(a0/a1)/t1;
  const cp = G.roomSpCp(0, T0), cv = cp - G.ROOM_SP_R[0], gam = cp/cv;
  const Ca = M0*cv, gs = G.ROOM_GSTRUCT;
  const want = G.ROOM_MIX*gam*k*k + gs/Ca;
  check("the compartment's temperature diffusivity, read off a decaying cosine", lam, want, 0.05,
    "an eddy face exchanges ROOM_MIX min(m_i,m_j)/MPC^2 kg/s carrying h, so at constant volume the " +
    "temperature diffusivity is gamma*ROOM_MIX; a cosine of wavenumber k decays at alpha k^2, plus g/Ca to the structure",
    {unit:"1/s", note:"alpha = " + (G.ROOM_MIX*gam).toFixed(4) + " m2/s (ROOM_MIX " + G.ROOM_MIX + " x gamma " +
      gam.toFixed(4) + "), k " + k.toFixed(4) + " 1/m over " + L + " cells; structure term " + (gs/Ca).toFixed(5) + " 1/s"});
  check("...and the mass diffusivity the same exchange carries", lam - gs/Ca, G.ROOM_MIX*gam*k*k, 0.05,
    "one eddy exchange, turbulent Lewis number 1 on the MASS: ROOM_MIX is the mass diffusivity and gamma*ROOM_MIX the thermal one",
    {unit:"1/s", note:"P0 " + P0.toFixed(3) + " kPa gauge, held uniform so no pressure gradient drives the gas solve"});
}

if(mode === "sound"){
  /* The medium's own stiffness, which is what the gas solve's compliance carries. The transport itself
     is implicit at CFL ~15 (347 m/s over a 0.467 m cell in a 0.02 s tick), so a travelling front is not
     resolved and is not what is measured here; docs/fidelity.md carries that as a taken decision. */
  check("the speed of sound of the compartment's own air at 20 C", Math.sqrt(G.GAM_AIR*G.ROOM_SP_R[0]*1000*293.15), 343.2, 0.01,
    "published dry air at 20 C, 1 atm: 343.2 m/s; c = sqrt(gamma R T)", {unit:"m/s",
      note:"gamma " + G.GAM_AIR.toFixed(4) + " and R " + (G.ROOM_SP_R[0]*1000).toFixed(2) + " J/kg/K off the model's own mixture law"});
  /* and the same stiffness read out of the solve: squeeze the box by a known volume in one tick */
  const cells = sealed(22, 30, 11, 15), s = G.ST;
  run(1);
  const V = cells.length*G.ROOM_VCELL, dV = 0.01*V, p0 = boxP(cells) + G.ROOM_P0;
  const per = dV/cells.length;
  for(const i of cells){ s.roomWater[i] += per*1000; s.gsDisp[i] += per; }
  G.step(0.02);
  check("the bulk modulus a squeezed cell reads back", (boxP(cells) + G.ROOM_P0 - p0)/(dV/V), G.GAM_AIR*p0, 0.05,
    "an adiabatic ideal gas has bulk modulus gamma*p, not p: it is the same gamma the sound speed is sqrt(K/rho) of",
    {unit:"kPa", note:"isothermal would read " + p0.toFixed(1) + " kPa; the liquid's p dV lands on the gas as work"});
}

if(mode === "h2ign"){
  /* one constant was standing in for two quantities: bulk autoignition and hot-surface ignition are
     different mechanisms with different published bands, and the model reads the threshold at two places */
  check("hydrogen bulk autoignition in air", G.H2_IGN, 773, 0,
    "published AIT band 773-858 K: NFPA 497 (500 C), IEC 60079-20-1 (560 C), ISO/TR 15916 (585 C); " +
    "773 K is the low, conservative end for a stoichiometric mixture at 1 atm",
    {unit:"K", pass:G.H2_IGN >= 773 && G.H2_IGN <= 858,
     note:"taken at the low end deliberately - the band's own spread is 85 K"});
  check("hydrogen ignition on a small HOT SURFACE", G.H2_IGN_SURF, 1085, 0,
    "measured band 1000-1170 K: Mevel, Melguizo-Gavilanes, Boeck & Shepherd, Int. J. Heat Fluid Flow 2019 " +
    "(9.3 x 5.1 mm SS316 glow plug, 1010 K at 5 % H2 to 1170 K at 74 %); Morreale et al., WHEC 2010 " +
    "(1033 K, steel coil); Tamm et al. 1987 via NUREG/CR-6530 (1050 K turbulent, 1123 K quiescent, 50 mol% steam)",
    {unit:"K", pass:G.H2_IGN_SURF >= 1000 && G.H2_IGN_SURF <= 1170,
     note:"not one physical constant - 128 K moves on cylinder orientation alone and up to 50 K on surface " +
       "chemistry; 1050 K is where three independent sources overlap"});
  check("...and it sits above the bulk threshold, as the mechanism requires", G.H2_IGN_SURF/G.H2_IGN, 1.36, 0.2,
    "a small hot surface must run well above the bulk AIT to light a mixture, because the gas beside it is " +
    "only there briefly; API's rule of thumb is not to assume hot-surface ignition below AIT + 200 C",
    {unit:"-", note:(G.H2_IGN_SURF - G.H2_IGN) + " K above the bulk figure"});
}
