"use strict";
// chunks: cp cv charge energy adia struct mix sound h2ign
/* The compartment's gas as a real gas: its heat capacity is the mass actually in the cell, at its own
   species mixture, on c_p(T). Every target here is NIST Shomate, the published dry-air tables, the ideal
   gas law, the first law at constant volume, or the two-body lumped relaxation - computed in the check. */
const {check, rig, load} = require("./lib.js");
const mode = process.argv[2] || "cp";
const G = load();

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
