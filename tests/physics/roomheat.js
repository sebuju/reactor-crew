"use strict";
// chunks: cp cv charge energy adia struct area hull plate wet wetcold wetfull ring mix sound h2ign burn coburn lechat
/* The compartment's gas as a real gas: its heat capacity is the mass actually in the cell, at its own
   species mixture, on c_p(T). Every target here is NIST Shomate, the published dry-air tables, the ideal
   gas law, the first law at constant volume, or the two-body lumped relaxation - computed in the check. */
const {check, rig, load, layWater, if97, inBundle, watch, watchNote} = require("./lib.js");
const mode = process.argv[2] || "cp";
const G = load();

/* saturated water at 330 K, Incropera & DeWitt Table A.6, typed a second time: v_f m3/kg, mu N s/m2, k W/m/K, Pr, beta 1/K */
const TAB = {vf:1.016e-3, mu:489e-6, k:0.650, Pr:3.15, beta:504.0e-6};
const TABSRC = "Incropera & DeWitt, Fundamentals of Heat and Mass Transfer, Table A.6, saturated water at 330 K; L = MPC, dT 50 K";
/* W/m2/K of each wetted surface on its own correlation at the table's point */
const HWPUB = (() => { const nu = TAB.mu*TAB.vf, L = G.MPC, Ra = 9.80665*TAB.beta*50*L*L*L/(nu*nu/TAB.Pr), k = TAB.k/L;
  return {Ra, st:0.27*Math.pow(Ra, 0.25)*k, un:0.15*Math.cbrt(Ra)*k,
    v:Math.pow(0.825 + 0.387*Math.pow(Ra, 1/6)/Math.pow(1 + Math.pow(0.492/TAB.Pr, 9/16), 8/27), 2)*k}; })();
const SIGMA = 5.670374419e-8;

const NIST = "NIST WebBook Shomate coefficients (N2, O2, Ar, CO2, H2, H2O, CO), c_p J/mol/K at t = T/1000";
const AIRTAB = "published dry-air ideal-gas c_p: 1.005 (300 K), 1.141 (1000 K), 1.249 (2000 K) kJ/kg/K";
const FIRST = "first law at constant volume, dU = q dt, with p = m R T / V (ideal gas)";

/* the law a second time, off the rows the model states, evaluated by shoCpA directly */
const IO = new Float64Array(2);
function cpLaw(sp, T){
  IO[0] = T < G.SHO_TLO ? G.SHO_TLO : T > G.SHO_THI ? G.SHO_THI : T;
  if(sp === 1){ G.shoCpA(G.VAP_SHO, IO, 0, 1); return IO[1]; }
  if(sp === 2){ G.shoCpA(G.H2_SHO, IO, 0, 1); return IO[1]; }
  if(sp === 3 || sp === 5){ G.shoCpA(G.AIR_MIX[sp === 3 ? 1 : 3][1], IO, 0, 1); return IO[1]; }
  if(sp === 4){ G.shoCpA(G.CO_SHO, IO, 0, 1); return IO[1]; }
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
const run = n => watch(G, {cap:n*0.02});
/* each gap's time constant read since the fit's start, watched against its law's until every one is still out to the fit's end; the window is the law's own time constant */
function tauWatch(o, gaps, taus, tol, span){
  const g1 = gaps.map(f => f());
  let el = 0;
  const w = watch(G, Object.assign({}, o, {cap:span, horizon:span, window:Math.min(...taus),
    sig:gaps.map((f, j) => ({name:"tau " + j, read:() => el/Math.log(g1[j]/f()), ref:taus[j], tol:tol*taus[j]})),
    each:(k, t) => { el = t; if(o.each) o.each(k, t); }}));
  return {w, g1};
}
/* the box's gas internal energy, and the structure's, in the model's own datum */
function gasU(cells){
  let u = 0;
  for(const i of cells){ G.eRoomGasA(i); u += G.E_RR[G.RR_UC]; }
  return u;
}
/* a cell's walls off the drawing: a floor, deckhead or side is a wall where the cell across it is off the board or gas-tight paint */
const AF = G.MPC*G.ROOM_DEPTH, AFB = 2*G.MPC*G.MPC, PLATE = G.STEEL_RHO*G.STEEL_CP*G.ROOM_PLATE;
const tightAt = (X, Y) => { if(X < 0 || Y < 0 || X >= G.GW || Y >= G.GH) return 1; const c = G.D.mat && G.D.mat[X + "," + Y]; return c && G.matRow(c.m).tight ? 1 : 0; };
const geo = i => { const X = i%G.GW, Y = (i/G.GW)|0, fl = tightAt(X, Y + 1), dk = tightAt(X, Y - 1), sd = tightAt(X - 1, Y) + tightAt(X + 1, Y);
  return {fl, dk, sd, hull:(X === 0) + (X === G.GW - 1) + (Y === 0) + (Y === G.GH - 1), A:AFB + (fl + dk + sd)*AF}; };
const GEO = "geometry: front and back walls 2 MPC^2 in every cell, MPC x ROOM_DEPTH for each floor, deckhead or side that is off the board or gas-tight paint; 8 mm steel";
const strU = cells => { const s = G.ST; let u = 0;
  for(const i of cells) u += PLATE*geo(i).A*s.roomTS[i];
  return u; };
const boxU = cells => gasU(cells) + strU(cells);
const boxP = cells => { let p = 0; for(const i of cells) p += G.ST.roomP[i]; return p/cells.length; };
const boxT = cells => { let t = 0; for(const i of cells) t += G.ST.roomT[i]; return t/cells.length; };
const wVol = i => { const w = G.ST.roomWater[i]; if(!(w > 0)) return 0; G.eRoomWRhoA(i); return w/G.E_RR[G.RR_WRHO]; };

if(mode === "cp"){
  for(const [sp, nm] of [[0,"air"],[1,"water vapour"],[2,"hydrogen"],[3,"oxygen"],[4,"carbon monoxide"],[5,"carbon dioxide"]])
    for(const T of [300, 1000, 2000])
      check("c_p " + nm + " at " + T + " K, interpolated table vs the Shomate law", G.roomSpCp(sp, T), cpLaw(sp, T), 1e-3, NIST,
        {unit:"kJ/kg/K"});
  for(const T of AIR_T)
    check("c_p dry air at " + T + " K vs the published air table", G.roomSpCp(0, T), airCpPub(T), 0.01, AIRTAB, {unit:"kJ/kg/K"});
  /* the grid step is chosen here, not before: the interpolant is asked BETWEEN its own nodes */
  let worst = 0, atT = 0, atS = -1;
  for(let sp=0;sp<G.ROOM_SP_N;sp++) for(let k=0;k<G.ROOM_CPN-1;k++){
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
  const o0 = s.roomO2[i]; s.roomH2[i] = m0/2; s.roomO2[i] = o0/2;
  G.eRoomGasA(i);
  const want = m0/2*(G.roomSpCp(0,T) - G.ROOM_SP_R[0]) + m0/2*(G.roomSpCp(2,T) - G.ROOM_SP_R[2]);
  check("a cell half air and half hydrogen by mass: its heat capacity", G.E_RR[G.RR_CVC], want, 1e-3,
    "a mixture's heat capacity is the mass-weighted sum of its components', ideal gas", {unit:"kJ/K"});
  const mixCv = G.E_RR[G.RR_CVC];
  s.roomH2[i] = 0; s.roomO2[i] = o0; G.eRoomGasA(i);
  check("...and how far that is from the all-air value it replaces", mixCv/G.E_RR[G.RR_CVC], 7, 0.1,
    "c_v hydrogen / c_v air = 10.2/0.718 at 300 K, so a half-and-half cell is about 7x", {unit:"-"});
  /* capacity is m*c_v: half the mass, twice the rise for the same kilojoule */
  const kJ = 20;
  const T0 = s.roomT[i];
  G.E_RR[G.RR_BANG] = kJ; G.eRoomBang(i);
  const full = s.roomT[i] - T0;
  s.roomT[i] = T0; s.roomM[i] = m0/2; s.roomO2[i] = o0/2;
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
  let worst = 0, note = "", prev = p0, n = 0, refill = false;
  watch(G, {cap:0.12, each:k => {
    const T = s.roomT[i], p = s.roomP[i] + G.ROOM_P0;
    if(!(p < prev)){ refill = true; return; }
    prev = p; n++;
    const gam = airGamPub((T + T0)/2), want = T0*Math.pow(p/p0, (gam - 1)/gam);
    const e = Math.abs(T - want)/want;
    note += "tick " + k + ": " + p.toFixed(0) + " kPa, " + T.toFixed(1) + " K against " + want.toFixed(1) +
      " (" + (e*100).toFixed(2) + " %) ";
    if(e > worst) worst = e; }, event:() => refill ? "the cell refills" : ""});
  check("gas left behind in a blowing-down cell follows its own isentrope", worst, 0, 0.02,
    "adiabatic expansion of the gas remaining in a discharging volume: T/T0 = (p/p0)^((gamma-1)/gamma)",
    {abs:true, unit:"relative", pass:n > 0 && worst <= 0.02,
     note:"worst of " + n + " discharging tick(s) from " + p0.toFixed(0) + " kPa, " + T0.toFixed(0) + " K; " + note});
}

if(mode === "struct"){
  // one cell walled on all four sides, so nothing but its own plate is on the gas
  const i0 = sealed(26, 26, 13, 13)[0], s = G.ST;
  run(1);
  s.roomT[i0] = 600;
  const gap = () => s.roomT[i0] - s.roomTS[i0];
  const t1 = 5, t2 = 35, A = geo(i0).A, Cs = PLATE*A, g = G.ROOM_H*A/1000;
  const law = T => { const Ca = s.roomM[i0]*(G.roomSpCp(0, T) - G.ROOM_SP_R[0]); return {Ca, tau:Ca*Cs/(g*(Ca + Cs))}; };
  run(Math.round(t1/0.02));
  const a1 = s.roomT[i0], {w, g1:[g1]} = tauWatch({}, [gap], [law(a1).tau], 0.02, t2 - t1);
  const g2 = gap(), a2 = s.roomT[i0], tE = t1 + w.t;
  const tauM = w.t/Math.log(g1/g2), {Ca, tau} = law((a1 + a2)/2);
  check("air over structure, nothing else running: the time constant of the gap", tauM, tau, 0.02,
    "two-body lumped relaxation, tau = Ca Cs / (g (Ca + Cs)), Ca = m c_v(T) of the cell's own gas, " +
    "Cs the cell's plate and g = 6 W/m2/K over the same area; " + GEO,
    {unit:"s", note:"plate " + A.toFixed(3) + " m2; Ca " + Ca.toFixed(4) + " kJ/K, Cs " + Cs.toFixed(2) + " kJ/K, g " + g.toFixed(5) +
      " kW/K; gap " + g1.toFixed(2) + " K at " + t1 + " s to " + g2.toFixed(2) + " K at " + tE.toFixed(2) + " s, " + watchNote(w)});
}

if(mode === "area"){
  // a liner box on an empty board: its floor row stands on a liner deck, the board's ring on the hull
  sealed(22, 30, 11, 15);
  const PT = G.PT, N = G.GW*G.GH;
  let bad = 0, hbad = 0, at = "";
  for(let i=0;i<N;i++){ const e = geo(i), A = PT.rStrA[i];
    if(Math.abs(A - e.A) > 1e-12*e.A){ bad++; if(!at) at = (i%G.GW) + "," + ((i/G.GW)|0) + " plate " + A.toFixed(4) + " against " + e.A.toFixed(4) + " m2"; }
    if(PT.rHull[i] !== e.hull){ hbad++; if(!at) at = (i%G.GW) + "," + ((i/G.GW)|0) + " hull " + PT.rHull[i] + " against " + e.hull; } }
  const cell = (x, y) => y*G.GW + x, rd = (x, y) => PT.rStrA[cell(x, y)].toFixed(4);
  const note = "interior open 26,13: " + rd(26, 13) + " m2; on the liner deck 26,15: " + rd(26, 15) + " m2; edge 0,17 hull " + PT.rHull[cell(0, 17)] +
    ", corner 0,0 hull " + PT.rHull[cell(0, 0)] + (at ? "; first off: " + at : "");
  check("every cell's plate area against the drawing", bad, 0, 0, GEO, {abs:true, unit:"cells", note});
  check("every cell's hull faces against the drawing", hbad, 0, 0, "geometry: a hull face is a face toward off the board; an edge cell has one, a corner two",
    {abs:true, unit:"cells", note});
}

if(mode === "hull"){
  // an empty board, every cell's air and plate at 400 K, so no gas exchanges with any plate: the hull cells lose to space alone
  rig(() => {});
  const s = G.ST, T0 = 400, dt = 0.02, N = G.GW*G.GH, SIGMA_ = SIGMA*G.HULL_EMIS;
  for(let i=0;i<N;i++){ s.roomT[i] = T0; s.roomTS[i] = T0; }
  G.step(dt);
  for(const [x, y, what] of [[0, 17, "an edge cell"], [0, 0, "a corner"]]){ const i = y*G.GW + x, e = geo(i);
    const got = PLATE*e.A*(T0 - s.roomTS[i])/dt, want = SIGMA_*e.hull*AF*(Math.pow(T0, 4) - Math.pow(G.T_SPACE, 4))/1000;
    check(what + "'s plate radiating to space, its own hull faces", got, want, 0.01,
      "Stefan-Boltzmann, q = eps sigma A (T^4 - T_space^4), A its faces toward off the board, eps the hull's drawn 0.85; loss read as the plate's C dT/dt, " + GEO,
      {unit:"kW", note:"cell " + x + "," + y + ", " + e.hull + " hull face(s), plate " + e.A.toFixed(3) + " m2, one tick from " + T0 + " K"}); }
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
  // the end cells stand against the side liners too; the law is judged on the cells between them, which share one geometry
  const mid = wet.slice(1, -1);
  return {cells, wet, mid, gap:() => { let a = 0; for(const i of mid) a += G.eRoomWaterT(i) - s.roomTS[i]; return a/mid.length; }};
}
/* cell i's water and plate capacities, kJ/K, and its water's depth share: m c_p on IF97 at its own T and p, the plate off the drawing */
const caps = i => { const s = G.ST, Tw = G.eRoomWaterT(i), r = if97((G.ROOM_P0 + Math.max(0, s.roomWP[i]))/1000, Tw);
  return {Cw:s.roomWater[i]*r.cp, Cs:PLATE*geo(i).A, f:Math.min(1, s.roomWater[i]*r.v/G.ROOM_VCELL)}; };
/* the wetted surfaces' conductance kW/K: floor at hf, deckhead at hd once full, front, back and walled sides vertical to the water's depth */
const gWet = (i, hf, hd, full) => { const e = geo(i), f = caps(i).f; return (hf*e.fl*AF + (full ? hd*e.dk*AF : 0) + HWPUB.v*(AFB + e.sd*AF)*f)/1000; };
const LUMP = "two-body lumped relaxation, tau = Cw Cs / (gw (Cw + Cs)), Cw = m c_p(T,p) of the cell's own water on IF97, Cs the cell's plate, " + GEO;

if(mode === "wet"){
  /* hot water over a cold floor: the stable plate */
  const {cells, wet, mid, gap} = pool(353, G.T_HULL), s = G.ST;
  // one row of water: its internal energy at its mean depth's pressure, its height over its floor, and the p dV its swell still owes the gas
  const AW = G.MPC*G.ROOM_DEPTH, g = 9.80665;
  const watU = () => { let u = 0; for(const i of cells){ const v = wVol(i), vs = s.roomWVs[i], m = s.roomWater[i], hw = m*g/(2*AW)/1000;
    u += s.roomWaterE[i] - (G.ROOM_P0 + s.roomWP[i] - hw)*v + hw*v + (vs > 0 ? (G.ROOM_P0 + s.roomP[i])*(v - m*vs) : 0); } return u; };
  const t1 = 20, t2 = 120;
  const U0 = boxU(cells) + watU(), g0 = gap(), vw = cells.map(i => wVol(i)), pg = cells.map(i => s.roomP[i]);
  let hot = 0, bound = 0, gross = 0, defer = 0;
  // a swell waiting under the gas's rest threshold is paid at the pressure it is booked at: its pending volume times each tick's pressure move
  const tick = () => { cells.forEach((i, n) => { const vs = s.roomWVs[i]; if(vs > 0) defer += Math.abs(wVol(i) - s.roomWater[i]*vs)*Math.abs(s.roomP[i] - pg[n]); pg[n] = s.roomP[i]; });
    G.step(0.02); };
  const after = () => {
    for(const i of wet) if(s.roomTS[i] > G.eRoomWaterT(i) + 1e-6) hot++;
    let lo = Infinity, hi = -Infinity, g = 0;
    // the second-order term on the volume the next gas step prices, which the swell hands it in lumps
    for(let n=0;n<cells.length;n++){ const i = cells[n], v = wVol(i), d = v - vw[n], p = (s.roomP[i] + G.ROOM_P0)*1000, dp = s.gsDisp[i];
      vw[n] = v; g += Math.abs(d); if(p < lo) lo = p; if(p > hi) hi = p;
      bound += 0.5*G.GAM_AIR*p*Math.max(d*d, dp*dp)/G.eRoomVgas(i)/1000; }
    bound += 0.5*(hi - lo)*g/1000; gross += g; };
  watch(G, {cap:t1, step:tick, each:after});
  const law = () => { const {Cw, Cs} = caps(mid[0]), gw = gWet(mid[0], HWPUB.st, 0, false); return {Cw, Cs, gw, tau:Cw*Cs/(gw*(Cw + Cs))}; };
  const {w, g1:[g1]} = tauWatch({step:tick, each:after}, [gap], [law().tau], 0.05, t2 - t1);
  const g2 = gap(), U1 = boxU(cells) + watU(), tE = t1 + w.t;
  const tauM = w.t/Math.log(g1/g2);
  const {Cw, Cs, gw, tau} = law(), gg = G.ROOM_H*geo(mid[0]).A/1000;
  check("hot water over the plate it stands on: the time constant of the gap", tauM, tau, 0.05,
    LUMP + "; gw the floor on McAdams' stable plate, Nu = 0.27 Ra^1/4 (Incropera eq. 9.32), front and back to the water's depth on Churchill-Chu (eq. 9.26), " + TABSRC,
    {unit:"s", gap:"...the water's temperature", note:"Cw " + Cw.toFixed(1) + " kJ/K, Cs " + Cs.toFixed(2) + " kJ/K, gw " +
      gw.toFixed(5) + " kW/K against the gas's " + gg.toFixed(5) + " on the same plate; gap " + g0.toFixed(2) + " K laid, " +
      g1.toFixed(2) + " K at " + t1 + " s to " + g2.toFixed(2) + " K at " + tE.toFixed(2) + " s, " + watchNote(w)});
  check("...and the box's energy over the same window", U1 - U0, 0, bound + defer,
    "first law of the sealed box: U_gas + U_plate + sum(E - p_m V_w + m g V_w / 2A), E the water's enthalpy, p_m its absolute pressure at " +
    "mid-depth (the floor's less half its own weight) and the last term its height over the floor, plus p_g times the swell the gas has not yet " +
    "been squeezed by, is relocated by a conductance and never made. Tolerance: the gas's net p dV, at most half its pressure spread " +
    "times the gross water volume moved, plus the pricing's second-order sum(gamma p dV^2 / 2 V) per cell per tick, plus the deferred swell's price move, sum(pending V x the tick's gas pressure move)",
    {abs:true, unit:"kJ", note:"gas plus structure plus water, " + cells.length + " cells, no hull face; " + (U1 - U0).toExponential(3) +
      " kJ of " + U0.toFixed(0) + " against " + bound.toExponential(3) + " kJ of scheme bound and " + defer.toExponential(3) + " kJ of deferral; gross " + gross.toExponential(3) + " m3 of water volume moved"});
  check("...and the plate never leaves the gradient", hot, 0, 0,
    "the second law: heat runs from the water down to the colder plate, so the plate never passes the water",
    {abs:true, unit:"cell-ticks with the plate over its water"});
}

if(mode === "plate"){
  const L = "; Ra " + HWPUB.Ra.toExponential(3);
  check("the stable wetted plate against McAdams", G.ROOM_HW, HWPUB.st, 0.02, TABSRC + "; Nu = 0.27 Ra^1/4, Incropera eq. 9.32",
    {unit:"W/m2/K", note:"floor under warmer water, deckhead over colder" + L});
  check("the unstable wetted plate", G.ROOM_HW_UN, HWPUB.un, 0.02, TABSRC + "; Nu = 0.15 Ra^1/3, Incropera eq. 9.31, stated to Ra 1e11",
    {unit:"W/m2/K", note:"floor under colder water, deckhead over warmer" + L});
  check("the wetted vertical plate against Churchill-Chu", G.ROOM_HW_V, HWPUB.v, 0.02, TABSRC + "; Incropera eq. 9.26, all Ra",
    {unit:"W/m2/K", note:"the hull skin to the water's depth" + L});
}

if(mode === "wetcold"){
  /* cold water on a hot floor: the unstable plate */
  const {wet, mid, gap} = pool(G.T_HULL, 353), s = G.ST, t1 = 5, t2 = 45;
  let cold = 0;
  const each = () => { for(const i of wet) if(s.roomTS[i] < G.eRoomWaterT(i) - 1e-6) cold++; };
  const law = () => { const {Cw, Cs} = caps(mid[0]), gw = gWet(mid[0], HWPUB.un, 0, false); return {Cw, Cs, gw, tau:Cw*Cs/(gw*(Cw + Cs))}; };
  const g0 = gap(); watch(G, {cap:t1, each});
  const {w, g1:[g1]} = tauWatch({each}, [gap], [law().tau], 0.05, t2 - t1);
  const g2 = gap(), tauM = w.t/Math.log(g1/g2), tE = t1 + w.t;
  const {Cw, Cs, gw, tau} = law();
  check("cold water on a hot plate: the time constant of the gap", tauM, tau, 0.05,
    LUMP + "; gw the floor on the unstable plate, Nu = 0.15 Ra^1/3 (Incropera eq. 9.31), front and back to the water's depth on Churchill-Chu (eq. 9.26), " + TABSRC,
    {unit:"s", note:"Cw " + Cw.toFixed(1) + " kJ/K, Cs " + Cs.toFixed(2) + " kJ/K, gw " + gw.toFixed(5) + " kW/K; gap " + g0.toFixed(2) +
      " K laid, " + g1.toFixed(2) + " K at " + t1 + " s to " + g2.toFixed(2) + " K at " + tE.toFixed(2) + " s, " + watchNote(w)});
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
  const probe = [Y1*GW, Y1*GW + 1, Y1*GW + X1], t1 = 5, t2 = 40, dt = 0.02;
  const gapOf = i => G.eRoomWaterT(i) - s.roomTS[i], law = [], g0 = probe.map(gapOf);
  for(const i of probe){ const {Cw, Cs} = caps(i), e = geo(i), f = e.hull;
    const gw = gWet(i, HWPUB.un, HWPUB.st, true), kR = G.HULL_EMIS*SIGMA*f*AF/1000;
    let Tw = G.eRoomWaterT(i), Ts = s.roomTS[i];
    const at = [Tw - Ts];
    for(let k=1;k<=Math.round(t2/dt)*10;k++){ const q = gw*(Ts - Tw), h = dt/10;
      Tw += q/Cw*h; Ts -= (q + kR*(Math.pow(Ts, 4) - Math.pow(G.T_SPACE, 4)))/Cs*h;
      if(k % 10 === 0) at.push(Tw - Ts); }
    const k1 = Math.round(t1/dt), tauTo = te => (te - t1)/Math.log(at[k1]/at[Math.round(te/dt)]);
    law.push({Cw, Cs, gw, f, sd:e.sd, tauTo, tau:tauTo(t2)}); }
  let full = 0;
  const each = () => { for(const i of probe) if(G.eLqFull(G.E_LQ[0], i)) full++; };
  watch(G, {cap:t1, each});
  const {w, g1} = tauWatch({each}, probe.map(i => () => gapOf(i)), law.map(L => L.tau), 0.05, t2 - t1);
  const g2 = probe.map(gapOf), tE = t1 + w.t, ticks = Math.round(tE/dt);
  probe.forEach((i, n) => { const L = law[n], tauM = w.t/Math.log(g1[n]/g2[n]);
    check("a full cell of cold water on hot plates, " + L.sd + " side wall(s), " + L.f + " on the hull: the time constant of the gap",
      tauM, L.tauTo(tE), 0.05, LUMP + "; gw the floor on the unstable plate (Incropera eq. 9.31), a walled deckhead on the " +
      "stable one (eq. 9.32), front, back and walled sides on Churchill-Chu (eq. 9.26); water over water has no plate, " + TABSRC + "; the plate's radiation to space by " +
      "Stefan-Boltzmann at the drawn emissivity over its hull faces, integrated beside it",
      {unit:"s", pass:full === probe.length*ticks && Math.abs(tauM - L.tauTo(tE)) <= 0.05*L.tauTo(tE),
       note:"cell " + (i%GW) + "," + Y1 + ": Cw " + L.Cw.toFixed(1) + " kJ/K, Cs " + L.Cs.toFixed(2) + " kJ/K, gw " + L.gw.toFixed(4) +
         " kW/K; gap " + g0[n].toFixed(2) + " K laid, " + g1[n].toFixed(2) + " K at " + t1 + " s to " + g2[n].toFixed(2) + " K at " + tE.toFixed(2) +
         " s, " + watchNote(w) + "; full " + full + " of " + probe.length*ticks + " cell-ticks"}); });
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
  let hp = 0, k = 0;
  watch(G, {cap:2*HALF*CYC*0.02, step:() => { hp = 0; const sgn = ((k++/HALF)|0) % 2 ? -1 : 1;
    for(const i of floor) hp += pump(i, sgn*dv);
    G.step(0.02); }, each:() => {
    const g1 = gas(), st1 = strU(cells), we1 = watE(), Q = -(st1 - st) - (we1 - we - hp);
    ds += (gam - 1)*Q*1000/(0.5*(g.p*g.V + g1.p*g1.V));
    for(let n=0;n<cells.length;n++){ const i = cells[n], v = G.eRoomVgas(i), d = v - vg[n]; vg[n] = v;
      bound += 0.5*gam*(s.roomP[i] + G.ROOM_P0)*d*d/v/U0; }
    st = st1; we = we1; g = g1; if(g.V < vmin) vmin = g.V; }});
  const creep = Math.log(g.p*Math.pow(g.V, gam)) - Math.log(g0.p*Math.pow(g0.V, gam)) - ds;
  check("a gas rung through " + CYC + " full cycles returns to its own adiabat", creep, 0, bound,
    "an adiabatic ideal gas keeps p V^gamma; heat exchanged moves ln(p V^gamma) by (gamma-1) dQ/(p V) and is taken out. " +
    "Tolerance: the scheme's own second-order sum(gamma p dV^2 / 2 V) per cell per tick, over U0 = p0 V0/(gamma-1)",
    {abs:true, unit:"ln(p V^gamma)", pass:Math.abs(creep) <= bound && g0.V - vmin > 0.9*A*g0.V,
     note:"swing " + (100*(g0.V - vmin)/g0.V).toFixed(2) + " % of " + g0.V.toFixed(2) + " m3 at " + (g0.p/1000).toFixed(2) +
       " kPa, " + 2*HALF + " ticks a cycle; heat taken out " + ds.toExponential(3)});
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
  // each cell's own plate, projected on the mode: the end cells carry a side wall more
  let gs = 0; for(let n=0;n<L;n++) gs += 2/L*G.ROOM_H*geo(cells[n]).A/1000*Math.pow(Math.cos(k*(n + 0.5)*G.MPC), 2);
  const Ca = M0*cv;
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

/* one sealed cell holding a fuel at a mole fraction of its gas, lit, burnt on the burn step alone until the fuel is gone */
const SEAL1 = () => sealed(30, 30, 18, 18)[0];
const MOL = i => { const s = G.ST, x = s.roomM[i] - s.roomH2[i] - s.roomVap[i] - s.roomCO[i] - s.roomCO2[i], y = 0.2095*0.031998/0.02896, ex = (s.roomO2[i] - y*x)/(1 - y);
  return (x - ex)/0.02896 + ex/0.031998 + s.roomVap[i]/0.018015 + s.roomH2[i]/0.002016 + s.roomCO[i]/0.028010 + s.roomCO2[i]/0.044009; };
const lay = (i, xh, xc) => { const s = G.ST, n = MOL(i), f = xh + xc, nf = n*f/(1 - f);
  s.roomH2[i] += nf*xh/f*0.002016; s.roomCO[i] += nf*xc/f*0.028010; s.roomM[i] += nf*(xh*0.002016 + xc*0.028010)/f; };
/* the hand flame: kJ/kg of fuel at constant volume off the room's own species energies, u(298) of products less reactants, LHV less the lost moles' RT */
const u298 = sp => { G.ROOM_SPIO[2] = 298.15; G.roomSpA(sp, G.ROOM_SPIO, 2, 0); return G.ROOM_SPIO[1]; };
const qvHand = (lhv, mm, prod, fuel, o2) => lhv - 0.5*8.314462618*298.15/mm/1000 + (1 + o2)*u298(prod) - u298(fuel) - o2*u298(3);
function burn(xh, xc){
  const i = SEAL1(), s = G.ST; run(1); lay(i, xh, xc);
  G.eRoomGasA(i); const U0 = G.E_RR[G.RR_UC], h0 = s.roomH2[i], c0 = s.roomCO[i], v0 = s.roomVap[i], d0 = s.roomCO2[i], o0 = s.roomO2[i], n0 = MOL(i), T0 = s.roomT[i];
  s.roomFlame[i] = 1e-6;
  const k = watch(G, {cap:400, step:() => { G.E_RR[G.RR_PMAX] = 0; G.eH2Step(0.02); },
    event:() => !(s.roomFlame[i] > 0) ? "flame out" : s.roomH2[i] > 1e-12*h0 || s.roomCO[i] > 1e-12*c0 ? "" : "fuel gone"}).k;
  const bh = h0 - s.roomH2[i], bc = c0 - s.roomCO[i];
  const Uh = U0 + bh*qvHand(120000, 0.002016, 1, 2, 0.031998/(2*0.002016)) + bc*qvHand(10100, 0.028010, 5, 4, 0.031998/(2*0.028010));
  const m = s.roomM[i]; let lo = 250, hi = 6000;
  for(let q=0;q<80;q++){ const t = (lo + hi)/2; G.eMixOf(i); G.E_GMX[G.GX_T] = t; G.eMixA(); if(m*G.E_GMX[G.GX_U] < Uh) lo = t; else hi = t; }
  return {i, k, bh, bc, h0, c0, dv:s.roomVap[i] - v0, dd:s.roomCO2[i] - d0, doo:o0 - s.roomO2[i], dn:MOL(i) - n0, T0, T:s.roomT[i], Th:(lo + hi)/2, left:s.roomH2[i]/h0 || 0}; }
const pOf = (r, T) => MOL(r.i)*8.314462618*T/G.eRoomVgas(r.i)/1000;

if(mode === "burn" || mode === "coburn"){
  const h2 = mode === "burn", run1 = () => h2 ? burn(0.10, 0) : burn(0, 0.20), r = run1();
  const nm = h2 ? "10 % hydrogen" : "20 % carbon monoxide", fb = h2 ? r.bh : r.bc, mm = h2 ? 0.002016 : 0.028010;
  const note = (fb*1000).toFixed(2) + " g burnt of " + ((h2 ? r.h0 : r.c0)*1000).toFixed(2) + " in " + r.k + " ticks; " + r.T0.toFixed(0) + " K to " + r.T.toFixed(0) + " K, " + pOf(r, r.T).toFixed(0) + " kPa";
  const ST_ = h2 ? "2 H2 + O2 -> 2 H2O: 8.936 kg of steam and 7.936 kg of O2 per kg of H2, arithmetic on the molar masses" : "2 CO + O2 -> 2 CO2: 1.571 kg of CO2 and 0.571 kg of O2 per kg of CO";
  check(nm + ": the product made per kg burnt", (h2 ? r.dv : r.dd)/fb, h2 ? 1 + 0.031998/(2*0.002016) : 1 + 0.031998/(2*0.028010), 1e-9, ST_, {unit:"kg/kg"});
  check(nm + ": the oxygen used per kg burnt", r.doo/fb, h2 ? 0.031998/(2*0.002016) : 0.031998/(2*0.028010), 1e-9, ST_, {unit:"kg/kg"});
  check(nm + ": moles lost per mole of fuel burnt", -r.dn/(fb/mm), 0.5, 1e-9, "three moles of reactant make two of product", {unit:"mol/mol"});
  check(nm + ": the burnt cell's pressure against the constant-volume adiabatic flame by hand", pOf(r, r.T), pOf(r, r.Th), 0.01,
    "first law at constant volume on the room's own species energies: LHV " + (h2 ? "120.0" : "10.10") + " MJ/kg less the lost moles' RT, products and reactants at 298.15 K", {unit:"kPa", note:"hand flame " + r.Th.toFixed(0) + " K"});
  if(h2){ const src = G.eH2Step.toString();
    inBundle("eH2Step = " + src.replace("s.roomVap[i] += mh*(1 + O2_PER_H2); ", "").replace(/^function eH2Step/, "function"));
    const f = run1(); inBundle("eH2Step = " + src.replace(/^function eH2Step/, "function"));
    check("fault injected, the old product path (no steam made): the product check fails", Math.abs(f.dv/f.bh - (1 + 0.031998/(2*0.002016))) > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true}); }
}

if(mode === "lechat"){
  /* the lower limit of H2 + CO in air by bisection on the model's own flammability test */
  const i = SEAL1(), s = G.ST, snap = G.engSnap(G.engSnapNew());
  const lfl = r => { let lo = 0.01, hi = 0.2;
    for(let q=0;q<60;q++){ const f = (lo + hi)/2; G.engRestore(snap); lay(i, f*r, f*(1 - r)); if(G.eFlam(i)) hi = f; else lo = f; }
    return (lo + hi)/2; };
  const R = [[0.25, 0.0816], [0.5, 0.0606], [0.75, 0.0482]], run2 = () => R.map(([r]) => lfl(r));
  const a = run2();
  R.forEach(([r, w], k) => check("lower flammability limit of H2:CO " + r*4 + ":" + (1 - r)*4 + " in air", a[k], w, 0.005,
    "Le Chatelier on H2 4.0 % and CO 12.5 %, NEA/CSNI/R(2000)10", {unit:"vol fraction"}));
  const src = G.eFlamRR.toString();
  inBundle("eFlamRR = " + src.replace("f >= f/(fh/H2_LFL + fc/CO_LFL)", "f >= H2_LFL").replace(/^function eFlamRR/, "function"));
  const f = run2(); inBundle("eFlamRR = " + src.replace(/^function eFlamRR/, "function"));
  check("fault injected, the mixture held to hydrogen's own limit: the check fails", f.some((v, k) => Math.abs(v - R[k][1])/R[k][1] > 0.005) ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true});
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
