"use strict";
// chunks: src flash coburn co2 inert vent cushion fpwater metal rise,1 rise,0.5 rise,2 nafire nawater spray smoke pan corpour corpool corwet corT mcci chf fci dch catch melt skin hot slide
// inputs: tools/particles.js
/* The PARTICLES mockup's room beyond water (tools/particles.js) against conservation, the first law, analytic solutions and published data. */
const fs = require("fs"), path = require("path");
const {check, load, inBundle, watch, watchNote, tsat, psat, if97, if97r2, fricFault, partSlide, ulp} = require("./lib.js");
const mode = process.argv[2] || "src", dt = 0.02;
const fa = process.argv.find(a => a.startsWith("--fault=")), fault = fa ? fa.slice(8) : "";
const tool = f => fs.readFileSync(path.join(__dirname, "..", "..", "tools", f), "utf8");
const G = load(), P = inBundle(fricFault(tool("particles.js"), fault) + "\nPART");
const GW = G.GW, GH = G.GH, N = GW*GH, MPC = G.MPC, AF = MPC*G.ROOM_DEPTH, g = 9.80665, RU = 8.314462618, T0 = 273.15;
const at = (x, y) => y*GW + x;
// IUPAC molar masses, kg/mol
const M_O2 = 0.031998, M_CO = 0.028010, M_CO2 = 0.044009, M_N2 = 0.0280134, M_H2 = 0.002016, M_H2O = 0.018015, M_NA = 0.022990, M_NAOH = 0.039997, M_ZR = 0.091224;

// a liner box's walls into m, x0..x1 by y0..y1 inclusive
function box(m, x0, x1, y0, y1, mat, t){ const c = {m:mat || "liner", t:t || 600};
  for(let x=x0;x<=x1;x++){ m[x + "," + y0] = c; m[x + "," + y1] = c; } for(let y=y0;y<=y1;y++){ m[x0 + "," + y] = c; m[x1 + "," + y] = c; } return m; }
const cells = (x0, x1, y0, y1) => { const c = []; for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) c.push(at(x, y)); return c; };
function build(mat, parts, knobs){ G.D.mat = mat; G.dTouch(); P.parts(parts || []); Object.assign(P.K, knobs || {}); P.build(); return P.A; }
let ms = 0, steps = 0;
const step = () => { const t0 = process.hrtime.bigint(); P.step(dt); ms += Number(process.hrtime.bigint() - t0)/1e6; steps++; };
const march = o => watch(G, Object.assign({step, dt}, o));
const cost = () => (steps ? (ms/steps).toFixed(3) : "0") + " ms per step over " + steps + " steps, " + P.np + " particles";
const B = P.BK, BI = P.BI;
const sumK = (k, f) => { let s = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === k) s += f ? f(p) : P.pm[p]; return s; };
const sumC = a => { let s = 0; for(let i=0;i<N;i++) s += a[i]; return s; };
// the one gas pocket's index at cell i, its moles, pressure Pa and temperature
const pocket = i => { const A = P.A, k = P.pc[i]; return {k, n:A.kN[k] + A.kO[k] + A.kNP[k], p:P.kP[k], T:A.kT[k], V:A.kV[k]}; };
const sealed = () => box({}, 15, 44, 8, 25);

// the hand melt curve, kJ/kg over 298.15 K, each cp integrated here: UO2 Fink 2000 eqs 1 and 5, Zircaloy-2 IAEA-TECDOC-1496 6.2.1.1, 316 ANL-75-55 eqs 7 and 11
const trap = (cp, T) => { let h = 0; const n = Math.max(1, Math.ceil(Math.abs(T - 298.15)/0.05)), d = (T - 298.15)/n;
  for(let i=0;i<n;i++){ const a = 298.15 + i*d; h += 0.5*(cp(a) + cp(a + d))*d; } return h/1000; };
const hU = T => { const f = t => 81.613*548.68/(Math.exp(548.68/t) - 1) + 2.285e-3*t*t + 2.360e7*Math.exp(-18531.7/t), t = Math.min(T, 3120);
  let h = (f(t) - f(298.15))/0.27003/1000; if(T > 3120) h += (0.25136*(T - 3120) - 1.3288e9*(1/T - 1/3120))/0.27003/1000; return h; };
const cpZ = T => (T <= 1213.8 ? 255.66 + 0.1024*T : 597.1 - 0.4088*T + 1.565e-4*T*T) + (T > 1100 && T < 1320 ? 1058.4*Math.exp(-(T - 1213.8)*(T - 1213.8)/719.61) : 0);
const cpS = T => (T <= 1670 ? 0.1097 + 3.174e-5*T : 0.184)*4184;
const hand = (F, K, S, X, T) => F*hU(T) + K*trap(cpZ, T) + S*trap(cpS, T) + X*G.CORIUM.slagCp*(T - 298.15);
// solidus: VERCORS ceramic 2479 K, Zircaloy 2025 K, 316 1670 K, the slag at its concrete's ablation; fusion UO2 70 kJ/mol, Zircaloy 153 kJ/kg, 316 64 cal/g
const handS = (F, K, S, X) => (F*2479 + K*2025 + S*1670 + X*G.concreteOf().tAbl)/(F + K + S + X);
const handL = (F, K, S) => F*70/0.27003 + K*153 + S*64*4.184;
const handE = (F, K, S, X, T) => 1000*(hand(F, K, S, X, T) + (T >= handS(F, K, S, X) ? handL(F, K, S) : 0));

if(mode === "src"){
  /* three boxes: 10 kg/s, 60 kg/s and 60 kg/s of 350 K water, each for 10 s */
  const A = build(box(box(box({}, 1, 19, 8, 25), 20, 39, 8, 25), 40, 58, 8, 25));
  const r1 = P.src.add({kind:"fluid", rate:10, cell:at(10, 12)}), r2 = P.src.add({kind:"fluid", rate:60, cell:at(30, 12)}), r3 = P.src.add({kind:"fluid", rate:60, cell:at(49, 12), T:350});
  const W = march({cap:10});
  // particles, and drops too small to be one held in their cells
  const inBox = (x0, x1) => { let m = 0, e = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === 1 && P.px[p] > x0 && P.px[p] < x1 + 1){ m += P.pm[p]; e += P.pm[p]*P.pT[p]; }
    for(let y=0;y<GH;y++) for(let x=x0;x<=x1;x++){ const i = at(x, y); m += A.cond[i]; e += A.condE[i]/4190 + A.cond[i]*T0; } return {m, T:e/m}; };
  const a = inBox(1, 19), b = inBox(20, 39), c = inBox(40, 58), dz = (25 - 12.5)*MPC;
  check("a 10 kg/s water row for 10 s, water in its box plus what the row holds", a.m + A.rRem[8*r1], 100, 1e-9,
    "conservation of mass: a source lands what it is rated for", {unit:"kg", note:watchNote(W)});
  check("a 60 kg/s row in a second box, the same", b.m + A.rRem[8*r2], 600, 1e-9, "conservation of mass, per row", {unit:"kg"});
  check("a 60 kg/s row of 350 K water in a third box, the same", c.m + A.rRem[8*r3], 600, 1e-9, "conservation of mass, per row", {unit:"kg"});
  check("the 350 K row's water, its mass-weighted temperature over 350 K", c.T - 350, g*dz/(2*4190), g*dz/(2*4190),
    "first law: water let go at 350 K warms by no more than its fall's potential energy, g dz/c, " + dz.toFixed(2) + " m to the floor", {abs:true, unit:"K", note:cost()});
}

if(mode === "flash"){
  /* 7 MPa water at h_f(560 K) breaks into a sealed room at 1 atm: one step of the flash */
  build(sealed());
  const hin = if97(psat(560), 560).h, pk = pocket(at(30, 12)), p = pk.p/1e6, ts = tsat(p), hf = if97(p, ts).h, hg = if97r2(p, ts).h, x = (hin - hf)/(hg - hf);
  const r = P.src.add({kind:"break", rate:20000, cell:at(30, 12), p:7, h:hin});
  march({cap:dt});
  const xm = B[BI.BRKV]/(B[BI.BRKV] + B[BI.BRKW]);
  let Tw = NaN; for(let p=0;p<P.np;p++) if(P.kind[p] === 1) Tw = P.pT[p];
  check("a break of saturated 560 K water into a " + (p*1000).toFixed(1) + " kPa pocket, the share that flashes to steam", xm, x, 2e-3,
    "IAPWS-IF97 isenthalpic flash: x = (h - h_f(p))/h_fg(p), region 1 and 2 at Tsat", {unit:"-", note:"h_f(560 K) " + hin.toFixed(1) + " kJ/kg, IF97 region 1 at its saturation pressure"});
  check("the flashed water, its temperature", Tw, ts, 0.05, "IAPWS-IF97 region 4: both phases leave at Tsat of the pocket", {abs:true, unit:"K"});
  check("the flashed steam, its temperature", P.src.row(r).T, ts, 0.05, "IAPWS-IF97 region 4", {abs:true, unit:"K", note:cost()});
}

if(mode === "coburn"){
  /* 5 kg of CO released into a sealed box with adiabatic walls, lit by a 2 kPa charge, burnt to what the flame reaches in 60 s */
  const A = build(sealed(), [], {hwall:0});
  const c = at(30, 16), r = P.src.add({kind:"co", rate:5, cell:c});
  march({cap:1}); P.src.drop(r); march({cap:1});
  const co0 = sumK(7), o0 = sumC(A.nO), pk0 = pocket(c), n0 = pk0.n, oK0 = A.kO[pk0.k];
  // the charge's energy as the bench lays it, 2 kPa at the particles' gamma 1.4
  const Eb = 2*1000*pk0.V/0.4;
  P.blast(c, 2);
  const W = march({cap:60, event:t => t > 5 && !sumK(7, p => P.burn[p] ? 1 : 0) ? "no CO flame left" : ""});
  const co1 = sumK(7), burnt = co0 - co1, co2 = sumK(8) + sumC(A.gAcc.subarray(2*N, 3*N)), o1 = sumC(A.nO), pk1 = pocket(c);
  check("CO burnt of the 5 kg released", burnt/co0, 0.5, 0.5, "the flame is seen to run: at least some of the charge's CO burns", {unit:"-", pass:burnt > 0.01*co0, note:watchNote(W)});
  check("O2 used per kg of CO burnt", (o0 - o1)*M_O2/burnt, M_O2/(2*M_CO), 1e-6, "2 CO + O2 -> 2 CO2, IUPAC molar masses", {unit:"kg/kg"});
  check("CO2 made per kg of CO burnt", co2/burnt, 1 + M_O2/(2*M_CO), 1e-6, "2 CO + O2 -> 2 CO2: mass conserved", {unit:"kg/kg"});
  check("gas moles lost per mole of CO burnt", (n0 - pk1.n - sumC(A.gAcc.subarray(2*N, 3*N))/M_CO2)/(burnt/M_CO), 0.5, 1e-6, "2 CO + O2 -> 2 CO2: three moles become two", {unit:"mol/mol"});
  /* by hand: the gas's energy on NIST's own u(T) of each species (the air less its O2 on air's) rises by the charge and the constant-volume heat; p = n R T/V */
  const io = new Float64Array(3), u = (s, T) => { io[2] = T; G.roomSpA(s, io, 2, 0); return io[1]*1000; };
  const nb = burnt/M_CO, Qv = G.CO_LHV*1000 - 0.5*RU*298.15/M_CO, mRest = A.kN[pk1.k]*(G.AIR_MMOL - G.O2_FRAC0*M_O2)/(1 - G.O2_FRAC0), Tg0 = pk0.T, ko = oK0;
  const U = (T, nO2, nCO, nCO2) => mRest*u(G.ROOM_SP_AIR, T) + nO2*M_O2*u(G.ROOM_SP_O2, T) + nCO*M_CO*u(G.ROOM_SP_CO, T) + nCO2*M_CO2*u(G.ROOM_SP_CO2, T);
  const nCO0 = co0/M_CO, target = U(Tg0, ko, nCO0, 0) - U(298.15, ko, nCO0, 0) + Eb + burnt*Qv;
  let lo = 250, hi = 3000; for(let i=0;i<80;i++){ const m = 0.5*(lo + hi); if(U(m, ko - nb/2, nCO0 - nb, nb) - U(298.15, ko - nb/2, nCO0 - nb, nb) > target) hi = m; else lo = m; }
  const nf = n0 - nb/2, pf = RU*nf*lo/pk1.V;
  check("the pocket's pressure rise from the charge and the burn", pk1.p - pk0.p, pf - pk0.p, 0.03, "first law at constant volume on NIST's species u(T), Qv = LHV - Dn R T/M off CO_LHV 10.10 MJ/kg; ideal gas",
    {unit:"Pa", note:"by hand " + lo.toFixed(1) + " K, bench " + pk1.T.toFixed(1) + " K; bench burns LHV on constant c_v; " + cost()});
}

if(mode === "co2"){
  /* 10 kg of CO2 let go half way up a sealed still box, read 60 s on */
  build(sealed());
  const r = P.src.add({kind:"co2", rate:2, cell:at(30, 16)});
  const W = march({cap:60, each:(k, t) => { if(t >= 5 - 1e-9) P.src.drop(r); }});
  let lo = 0, hi = 0; for(let x=16;x<=43;x++){ for(let y=22;y<=24;y++) lo += P.src.co2f(at(x, y)); for(let y=9;y<=11;y++) hi += P.src.co2f(at(x, y)); }
  const yc = sumK(8, p => P.pm[p]*P.py[p])/sumK(8);
  check("CO2 let go at row 16.5, its mean height 60 s on", yc, 16.5, 0, "CO2 (44 g/mol) is heavier than air (29 g/mol): it sinks from where it was let go", {unit:"row", pass:yc > 16.5, note:watchNote(W)});
  check("CO2 mole fraction in the bottom three rows over the top three", lo/Math.max(hi, 1e-30), 1, 0, "heavier than air: only higher at the floor is judged", {unit:"-", pass:lo > hi, note:cost()});
}

if(mode === "inert"){
  /* a sealed box, 1 kg of H2 let go first, then an inerting set on three cells for 10 s */
  const A = build(sealed(), [], {hwall:0});
  const r = P.src.add({kind:"h2", rate:1, cell:at(20, 20)}); march({cap:1}); P.src.drop(r); march({cap:0.5});
  const c = at(30, 16), a = pocket(c), h0 = sumK(3) + sumC(A.gAcc.subarray(0, N));
  P.parts([{kind:"inert", cells:cells(28, 30, 9, 9)}]);
  const W = march({cap:10}), b = pocket(c), h1 = sumK(3) + sumC(A.gAcc.subarray(0, N));
  check("inerting 10 s, the pocket's moles gained", b.n - a.n, G.INERT_KGS*10/M_N2, 1e-6, "conservation: INERT_KGS of N2 a second, IUPAC 28.0134 g/mol", {unit:"mol", note:watchNote(W)});
  check("inerting 10 s, the pocket's pressure rise", b.p - a.p, RU*(b.n - a.n)*b.T/b.V, 1e-6, "ideal gas at the pocket's own temperature: dp = dn R T/V", {unit:"Pa"});
  check("inerting 10 s, the hydrogen in the room", h1, h0, 1e-12, "inerting adds nitrogen and deletes nothing", {unit:"kg"});
  /* the limiting oxygen concentration: a 5 x 5 box at a hot cell, its oxygen share set by the diluent, 0.05 kg of H2 let go at the hot cell */
  const loc = (xO2, dil) => {
    const Ah = build(box({}, 29, 35, 14, 20), [], {hwall:0, cond:0}), cc = at(32, 17), wanted = xO2;
    if(dil === "N2") for(let i=0;i<N;i++) if(P.pc[i] >= 0) Ah.nO[i] = wanted/(1 - wanted)*Ah.nN[i];
    if(dil === "steam") for(let i=0;i<N;i++) if(P.pc[i] >= 0) Ah.eA[i] = (Ah.nN[i]*20.8 + Ah.nO[i]*21.1)*(600 - T0);
    march({cap:dt});
    if(dil !== "N2"){ const pk = pocket(cc), nd = Ah.kO[pk.k]/wanted - pk.n, M = dil === "CO2" ? M_CO2 : M_H2O;
      const rr = P.src.add({kind:dil === "CO2" ? "co2" : "steam", rate:nd*M, cell:at(32, 15), T:dil === "CO2" ? 293 : 600}); march({cap:1}); P.src.drop(rr); march({cap:0.5}); }
    const pk = pocket(cc), x = Ah.kO[pk.k]/pk.n;
    P.src.add({kind:"heat", rate:200, cell:cc}); const rh = P.src.add({kind:"h2", rate:0.25, cell:cc});
    let lit = 0; march({cap:2, each:k => { if(k === 10) P.src.drop(rh); lit += sumK(3, p => P.burn[p] ? 1 : 0); }});
    return {x, lit}; };
  for(const dil of ["N2", "CO2", "steam"]){ const hiO = loc(0.06, dil), loO = loc(0.04, dil);
    check("H2 at a hot cell with " + dil + " as the diluent, O2 at " + (hiO.x*100).toFixed(2) + " % of the gas: lights", hiO.lit > 0 ? 1 : 0, 1, 0,
      "limiting oxygen concentration 5 % (NFPA 69 as O2_LOC states it, not read here): above it a flame lives", {abs:true, unit:"-"});
    check("the same at " + (loO.x*100).toFixed(2) + " %: does not light", loO.lit > 0 ? 1 : 0, 0, 0,
      "limiting oxygen concentration 5 %: below it no flame lives, whatever the diluent", {abs:true, unit:"-", note:dil === "steam" ? "the steam pocket held at 600 K so the steam stays a gas; " + cost() : ""}); }
}

if(mode === "vent"){
  /* OUT: 0.01 kg of noble fission products let go into a sealed box, then a vent set pulling on two cells under the roof */
  const MXN = (G.AIR_MMOL - G.O2_FRAC0*G.O2_MMOL)/(1 - G.O2_FRAC0), c0 = at(30, 16);
  const A = build(sealed(), [], {hwall:0}), inBox = f => { const k = P.pc[c0]; let s = 0; for(let i=0;i<N;i++) if(P.pc[i] === k) s += f(i); return s; };
  const gas = () => inBox(i => A.nN[i]*MXN + A.nO[i]*G.O2_MMOL), fp = () => inBox(i => A.nFpN[i]);
  const r = P.src.add({kind:"fp", cell:at(30, 20), fpN:0.01}); march({cap:1}); P.src.drop(r); march({cap:0.2});
  const m0 = gas(), f0 = fp();
  P.parts([{kind:"vent", cells:cells(29, 30, 9, 9), dir:"out"}]);
  const t0 = B[BI.RELG], W = march({cap:2}), m1 = gas(), f1 = fp();
  check("a vent OUT over 2 s, the gas and fission products it takes a second", (m0 + f0 - m1 - f1)/2, G.ROOM_VENT_KGS, 1e-9, "conservation: ROOM_VENT_KGS a set while its cells hold a step's worth",
    {unit:"kg/s", note:watchNote(W) + "; a cell holding less than a step's share gives up what it has"});
  check("a vent OUT, the noble fission products' remaining share over the gas's", (f1/f0)/(m1/m0), 1, 1e-9, "a well-mixed pocket: every species leaves in its own share", {unit:"-"});
  check("a vent OUT, gas left plus gas released against the gas there was", m1 + B[BI.RELG] - t0, m0, 1e-9, "conservation of mass: the released book closes", {unit:"kg"});
  check("a vent OUT, fission products left plus released", f1 + B[BI.RELN], f0, 1e-9, "conservation of mass", {unit:"kg"});
  /* IN: a sealed box, one vent set blowing air in for 1 s */
  build(sealed(), [{kind:"vent", cells:cells(29, 30, 9, 9), dir:"in"}], {hwall:0});
  const c = at(30, 16), a = pocket(c); march({cap:1}); const b = pocket(c);
  check("a vent IN over 1 s, the sealed box's pressure rise", b.p - a.p, G.ROOM_VENT_KGS*RU*b.T/(G.AIR_MMOL*b.V), 1e-6, "ideal gas: dp = mdot R T/(M V), air at T_HULL into air at T_HULL", {unit:"Pa", note:cost()});
  /* DRAW: a vent OUT on the floor of a sealed box, rows 9 to 24; its flow up the box once formed, then 1 kg of CO let go 4 rows over it */
  const D = build(sealed(), [{kind:"vent", cells:cells(29, 30, 24, 24), dir:"out"}], {hwall:0}), W2 = march({cap:3}), k = pocket(c), Q = G.ROOM_VENT_KGS*RU*k.T/(G.AIR_MMOL*k.p);
  const down = y => { let s = 0; for(let x=16;x<=43;x++) s += D.vnY[at(x, y)]*MPC*AF; return s; }, u = y => (D.vnY[at(29, y)] + D.vnY[at(30, y)])/2;
  for(const y of [21, 14]) check("a vent OUT, the air crossing row " + y + " down, m3/s", down(y), Q*(1 - (24.5 - y)/16), 0.01,
    "continuity: the vent's volume flow less what the pocket's expansion supplies below the row, the air at the pocket's density", {unit:"m3/s", note:y === 21 ? watchNote(W2) : ""});
  check("a vent OUT on the floor, its air's speed 3.5 rows up over 7.5 rows up", u(21)/u(17), 7.5/3.5, 0.2,
    "potential flow: a line sink on a wall, u = Q/(pi r D), falls as 1/r", {unit:"-", note:"the box's closed walls and its expansion bend it at 7.5 rows"});
  const rc = P.src.add({kind:"co", rate:5, cell:at(30, 20)}); march({cap:0.2}); P.src.drop(rc); const co0 = sumK(7);
  const W3 = march({cap:10, event:() => sumK(7) < 0.01*co0 ? "CO gone" : ""});
  check("a vent OUT on the floor, CO let go 4 rows over it, the share left in the air after the march", sumK(7)/co0, 0, 0.01,
    "potential flow: a sink takes all the air of a sealed pocket, and what rides in it; CO at T_HULL barely rises", {abs:true, unit:"-", note:watchNote(W3) + "; " + cost()});
  check("the same, CO parcels still on the board", sumK(7, () => 1), 0, 0, "a parcel at the intake is drawn in whole: the fan passes the gas, it does not thin it where it stands", {abs:true, unit:"-"});
  /* DOWN: 1 kg of H2 let go at the floor of a sealed box, a vent OUT under the roof in the far corner drawing the box toward vacuum */
  build(sealed(), [{kind:"vent", cells:cells(41, 42, 9, 9), dir:"out"}], {hwall:0});
  const rh = P.src.add({kind:"h2", rate:5, cell:at(20, 23)}); march({cap:0.2}); P.src.drop(rh);
  const W4 = march({cap:30, event:() => sumK(3, () => 1) === 0 ? "no H2 parcel left" : ""}), kd = pocket(c);
  check("a vent OUT drawing a sealed box down, the box still a gas pocket", kd.k >= 0 ? 1 : 0, 1, 0, "a room drawn down is still a room: its gas is thin, not gone", {abs:true, unit:"-", note:watchNote(W4) + "; " + (kd.k >= 0 ? (kd.p/1000).toFixed(2) + " kPa" : "no pocket")});
  check("the same, H2 parcels still on the board", sumK(3, () => 1), 0, 0, "the vent takes a fixed mass a second while the room has any gas: it draws every parcel in", {abs:true, unit:"-", note:cost()});
}

if(mode === "cushion"){
  /* a sealed box, rows 9 to 24, 10 rows of water laid; a 500 kPa charge at its floor throws the water about for 3 s */
  build(sealed(), [], {hwall:0}); for(let y=15;y<=24;y++) for(let x=16;x<=43;x++) P.lay(at(x, y), 1);
  march({cap:1}); P.blast(at(30, 23), 500);
  const Vbox = 28*16*MPC*AF, inBox = cells(16, 43, 9, 24), gasV = () => { const on = new Set(); for(const i of inBox) if(P.pc[i] >= 0) on.add(P.pc[i]); let v = 0; for(const k of on) v += P.A.kV[k]; return v; };
  let lo = Infinity, hi = 0, np = 0;
  const W = march({cap:3, each:() => { const r = gasV()/(Vbox - sumK(1)/1000); lo = Math.min(lo, r); hi = Math.max(hi, r); np = Math.max(np, P.L.npk); }});
  check("the box's air volume over the box less its water, least while the water flies", lo, 1, 0.02, "conservation of volume: water is incompressible, so the air holds what the water does not", {unit:"-", note:watchNote(W) + "; most " + hi.toFixed(4) + "; up to " + np + " pockets"});
  const cnt = new Map(); for(const i of inBox) if(P.pc[i] >= 0) cnt.set(P.pc[i], (cnt.get(P.pc[i]) || 0) + 1); const kb = [...cnt].sort((a, b) => b[1] - a[1])[0][0], g = pocket(inBox.find(i => P.pc[i] === kb));
  check("the box's air pressure 3 s after, against its moles in the box less its water", g.p, g.n*RU*g.T/(Vbox - sumK(1)/1000), 0.02, "ideal gas in the volume the water leaves", {unit:"Pa", note:cost()});
}

if(mode === "fpwater"){
  /* a pool with 1 g of volatile fission products a tonne behind a divider with a two-cell gap at the floor */
  const m = box({}, 10, 49, 6, 27); for(let y=6;y<=24;y++) m["30," + y] = {m:"liner", t:600};
  const A = build(m);
  for(let y=19;y<=26;y++) for(let x=11;x<=29;x++) P.lay(at(x, y), 1);
  for(let p=0;p<P.np;p++) if(P.kind[p] === 1) A.pFp[p] = 1e-6*P.pm[p];
  const f0 = sumK(1, p => A.pFp[p]), w0 = sumK(1);
  const W = march({cap:15});
  let fR = 0, wR = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === 1 && P.px[p] > 30){ fR += A.pFp[p]; wR += P.pm[p]; }
  check("the pool through the gap: water that crossed", wR/w0, 0.5, 0.5, "the water is seen to move: some crosses the gap", {unit:"-", pass:wR > 0.05*w0, note:watchNote(W)});
  check("the fission products that crossed over the water that crossed", fR/wR, f0/w0, 1e-9, "the products ride the water: its concentration is carried unchanged", {unit:"kg/kg"});
  check("fission products in the water, the air and the pending condensate against what was put in", sumK(1, p => A.pFp[p]) + sumC(A.nFpV) + sumC(A.condFp), f0, 1e-9, "conservation of mass", {unit:"kg"});
  /* boiling: a pool laid at 393 K under a 1 atm pocket, one step */
  const A2 = build(sealed()); for(let y=22;y<=24;y++) for(let x=16;x<=43;x++) P.lay(at(x, y), 1);
  for(let p=0;p<P.np;p++) if(P.kind[p] === 1){ P.pT[p] = 393; A2.pFp[p] = 1e-6*P.pm[p]; }
  const w1 = sumK(1), f1 = sumK(1, p => A2.pFp[p]); march({cap:dt}); const boiled = w1 - sumK(1);
  check("a 393 K pool's first step of boiling: fission products into the air over those boiled off", sumC(A2.nFpV)/(f1*boiled/w1), 1/G.FP_PC, 1e-9,
    "partition: the boiled share takes 1/FP_PC of its volatile products to the air (iodine)", {unit:"-", note:"boiled " + boiled.toFixed(1) + " kg; " + cost()});
}

if(mode === "metal"){
  /* 3 rows of water in a sealed box; a sodium particle made at its floor, then (a second box) corium at 400 K dropped onto its surface */
  build(sealed()); for(let y=22;y<=24;y++) for(let x=16;x<=43;x++) P.lay(at(x, y), 1);
  let r = P.src.add({kind:"metal", rate:15000, cell:at(30, 24), T:450}); march({cap:dt}); P.src.drop(r);
  const W = march({cap:30}), na = sumK(5, p => P.pm[p]*P.py[p])/sumK(5);
  check("sodium made at the floor under 1.4 m of water, its mean height after 30 s (row, top of the water at 22)", na, 22, 0.75,
    "Archimedes: sodium (847 kg/m3 as its coolant row) floats on water", {abs:true, unit:"row", note:watchNote(W)});
  const A = build(sealed()); for(let y=22;y<=24;y++) for(let x=16;x<=43;x++) P.lay(at(x, y), 1);
  r = P.src.add({kind:"corium", rate:1e5, cell:at(30, 20), T:400, comp:{F:0.8, K:0.2}, tot:3000}); march({cap:10});
  const cy = sumK(6, p => P.pm[p]*P.py[p])/sumK(6);
  check("corium dropped at 400 K onto the same water, its mean height after 10 s", cy, 24.5, 0.5, "Archimedes: corium (8400 kg/m3) sinks through water to the floor", {abs:true, unit:"row"});
  /* the floor under the corium and its water: gas over it plus the weight of every liquid above, per floor area */
  let best = -1, mb = 0; for(let i=0;i<N;i++) if(P.src.cor(i) > mb){ mb = P.src.cor(i); best = i; }
  const x = best%GW, y = (best/GW)|0; let kg = 0, top = -1; for(let yy=y;yy>=9;yy--){ const i = at(x, yy); kg += P.src.water(i) + P.src.cor(i); if(P.pc[i] >= 0 && top < 0) top = i; }
  const pg = P.kP[P.pc[top]], truth = (pg + g*kg/AF - G.ROOM_P0*1000)/1000;
  check("the floor under the corium, gauge pressure read", P.src.P(best), truth, 0.05, "hydrostatics: p = p_gas + g sum(m)/A over every liquid above", {unit:"kPa", note:cost()});
}

if(mode === "rise"){
  /* the metal rig's box and water with the sodium-water reaction off (FIRE.NA.wlhv 0), 20 s to rest; one sodium parcel of f water particles'
     volume put in place of that water (half: one particle split, one half sodium; twice: two neighbours joined), held while the water round
     it comes to rest, then let go; at the floor's middle, then a row and a half up, out of the floor's reach at every size; and held only, 0.05 cell over the floor row */
  const f = +(process.argv[3] || 1), fz = fault === "rise0", RW = 1000, HOLD = 10; G.FIRE.NA.wlhv = 0;
  if(f > 1) P.K.split = 2.5;
  const heat = p => P.kind[p] === 1 ? P.pm[p]*4190*P.pT[p] : P.A.pE[p];
  const wt = () => P.K.grav*g*P.DT[1]*P.DT[1]/MPC, S0 = 1/Math.sqrt(P.K.ppc), dh = 0.25*S0*Math.sqrt(0.5);
  const nearW = (x, y, skip) => { let b = -1, d = Infinity; for(let p=0;p<P.np;p++){ if(P.kind[p] !== 1 || p === skip) continue; const e = Math.hypot(P.px[p] - x, P.py[p] - y); if(e < d){ d = e; b = p; } } return b; };
  const na = () => { for(let p=0;p<P.np;p++) if(P.kind[p] === 5) return p; return -1; };
  const fast = () => { let v = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === 1) v = Math.max(v, Math.hypot(P.vx[p], P.vy[p])); return v*MPC; };
  const trial = (where, y0, lift) => {
    build(sealed()); for(let y=22;y<=24;y++) for(let x=16;x<=43;x++) P.lay(at(x, y), 1);
    march({cap:20});
    const rhoNa = P.A.MF[1], q = nearW(30, y0, -1), j = f > 1 ? nearW(P.px[q], P.py[q], q) : -1, V = P.pm[q]/RW, m = f*V*(fz ? RW : rhoNa);
    const X = f < 1 ? P.px[q] + dh : f > 1 ? (P.px[q] + P.px[j])/2 : P.px[q], Y = (f > 1 ? (P.py[q] + P.py[j])/2 : P.py[q]) - lift;
    let wq = NaN; P.tap = s => { if(s === 3 && isNaN(wq)) wq = -P.mvA[2*q+1]/wt(); }; step(); P.tap = null;
    let ys = 0; for(let x=16;x<=43;x++){ let h = 0; for(let y=9;y<=24;y++) h += P.src.water(at(x, y))/(RW*MPC*AF); ys += 25 - h; } ys /= 28;
    const Rm = Math.sqrt(f*V/(Math.PI*G.ROOM_DEPTH)), top = ys + Rm/MPC;
    // a held body's lift goes into whatever holds it, not into the water
    let first = NaN, fill = NaN, made = 0, held = 1, late = 0, sum = 0, n = 0; P.L.rise = 0;
    const r = P.src.add({kind:"metal", rate:m/dt, cell:at(X|0, Y|0), T:450});
    P.tap = s => {
      if(s === 0){
        if(!made){ let a = -1, ms = 0, es = 0; made = 1;
          for(let p=0;p<P.np;p++) if(P.kind[p] === 5){ ms += P.pm[p]; es += P.A.pE[p]; if(a < 0) a = p; else P.kind[p] = 0; }
          P.pm[a] = ms; P.A.pE[a] = es; if(fz) P.A.pvf[a] = 1;
          if(f < 1){ P.pm[q] /= 2; P.px[q] -= dh; } else { P.kind[q] = 0; if(j >= 0) P.kind[j] = 0; }
          P._stage.derive(); }
        if(held){ const a = na(); P.px[a] = X; P.py[a] = Y; P.vx[a] = 0; P.vy[a] = 0; } }
      else if(s === 3){ const a = na(), u = -P.mvA[2*a+1]/wt(); if(isNaN(first)){ first = u; fill = P.wsA[8*a]; } if(late){ sum += u; n++; } } };
    step(); P.src.drop(r);
    march({cap:HOLD, each:(k, t) => { late = t > HOLD - 1 ? 1 : 0; }});
    held = 0; P.tap = null; P.L.rise = 1; const a0 = na(), fH = P.wsA[8*a0]; P.vx[a0] = 0; P.vy[a0] = 0;
    const who = (fz ? "FAULT INJECTED: the parcel at water's density; " : "") + "sodium-water reaction off (FIRE.NA.wlhv 0); parcel " + f + " water particle" + (f === 1 ? "" : "s") + ", " + P.pm[a0].toFixed(1) + " kg" + (f > 1 ? ", split held off (K.split 2.5)" : "") + "; ";
    check("a sodium parcel of " + f + " water particle" + (f === 1 ? "" : "s") + " held " + where + " while the water round it comes to rest: the push on it over its weight", sum/n, RW/rhoNa, 0.05,
      "Archimedes: rho_w V g up on a body of density rho, so (rho_w/rho) g dts^2/MPC a substep" + (lift ? "; water fills under it" : ""), {unit:"x weight", note:who + "mean over the last 1 s of " + HOLD + " s held; its first substep " + first.toFixed(4) +
        "; the water particle in that place a substep before " + wq.toFixed(4) + "; the wall's fill at the parcel " + fill.toFixed(3) + " first, " + fH.toFixed(3) + " at release; at " + X.toFixed(2) + "," + Y.toFixed(2) + "; fastest water at release " + fast().toFixed(3) + " m/s" + (lift ? "; " + cost() : "")});
    if(lift) return;
    const log = [], n0 = 12000, v0 = new Float64Array(2*n0), q0 = new Float64Array(n0), l0 = [0];
    let res = 0, fl = 0, moved = 0, dpS = 0, jS = 0, vmax = 0;
    P.tap = s => { const M = P.mvA, dts = P.DT[1], OX = P.ox, OY = P.oy;
      if(s === 3){ l0[0] = P.L.lj; for(let p=0;p<P.np;p++){ if(!P.LQ[P.kind[p]]) continue; v0[2*p] = (P.px[p] + M[2*p] - OX[p])/dts; v0[2*p+1] = (P.py[p] + M[2*p+1] - OY[p])/dts; q0[p] = heat(p); } }
      else if(s === 8){ let e = 0, px = 0, py = 0;
        for(let p=0;p<P.np;p++){ if(!P.LQ[P.kind[p]]) continue; const m = P.pm[p], q = heat(p), ux = (P.px[p] + M[2*p] - OX[p])/dts, uy = (P.py[p] + M[2*p+1] - OY[p])/dts;
          if(ux === v0[2*p] && uy === v0[2*p+1] && q === q0[p]) continue;
          const dk = 0.5*m*(ux*ux + uy*uy - v0[2*p]**2 - v0[2*p+1]**2)*MPC*MPC;
          e += dk + q - q0[p]; moved += Math.abs(dk); fl += 2*ulp(q); px += m*(ux - v0[2*p])*MPC; py += m*(uy - v0[2*p+1])*MPC; }
        res += Math.abs(e); dpS += Math.hypot(px, py); jS += P.L.lj - l0[0]; } };
    const W = march({cap:30, each:(k, t) => { vmax = Math.max(vmax, fast()); if(k % 50 === 0){ const a = na(); log.push(t.toFixed(0) + " s " + P.py[a].toFixed(2) + " row " + (-P.vy[a]*MPC).toFixed(3) + " m/s, water " + fast().toFixed(3)); } },
      event:() => P.py[na()] <= top ? "the parcel's top at the surface" : ""});
    P.tap = null;
    const a = na(), up = W.end === "event", h = (Y - top)*MPC, sq = Math.sqrt(g*Rm*(RW - rhoNa)/RW), Up = sq/2, U3 = 2*sq/3, tr = W.t;
    const lk = "the rise rule sets U = sqrt(g R drho/rho_c)/2 per particle (a game rule: the rule sets the speed, the water does not make it); ";
    check("...over the release, the rise stage: kinetic energy plus heat moved, over the kinetic energy it moved", moved > 0 ? res/moved : NaN, 0, moved > 0 ? fl/moved : 0,
      "first law: the stage moves no mass and makes no energy; the kinetic energy it gives comes off the heat of the particles it moves", {abs:true, unit:"-", note:who + lk + "the move read as the speed it gives, (y + M - y0)/dts, from before the stage to after it, before collide and the speed cap; kinetic energy moved " + moved.toExponential(3) + " J; tolerance the heats' rounding, 2 ulp a particle a substep"});
    check("...the rise stage: momentum moved over the impulse it gave", jS > 0 ? dpS/jS : NaN, 0, 1e-9, "Newton's third law: the impulse the rule gives a light particle is taken from the denser liquid round it",
      {abs:true, unit:"-", note:who + lk + "impulses " + jS.toExponential(3) + " kg m/s"});
    check("...the fastest water while the parcel rises, over 2 U", up ? vmax/(2*h/tr) : NaN, 1, 0, "potential flow round a cylinder: the fastest fluid beside a body moving at U through fluid at rest is 2 U, at its equator",
      {unit:"-", pass:up && vmax <= 2*h/tr, note:who + lk + "U its mean rise speed, h/t " + (up ? (h/tr).toFixed(3) : "-") + " m/s; fastest water " + vmax.toFixed(3) + " m/s"});
    check("...let go " + where + ", its rise to the surface, the time against h/U of a planar cap", up ? tr : NaN, h/Up, 0, "Davies and Taylor 1950, Proc. R. Soc. A 200, 375-390; Collins 1965, J. Fluid Mech. 22, 763-771: U = C sqrt(g R drho/rho), C 1/2 planar",
      {unit:"s", pass:up && tr >= 0.5*h/Up && tr <= 2*h/Up, note:who + lk + "within a factor 2 (planar against 3-D, and a cap made of one particle); h " + h.toFixed(3) + " m from its centre to its top at the surface (row " + ys.toFixed(2) + "), R " + Rm.toFixed(3) +
        " m in the room's plane, planar U " + Up.toFixed(3) + " m/s, 3-D (C 2/3) " + U3.toFixed(3) + " m/s, h/U " + (h/U3).toFixed(2) + " s; the parcel at " + P.py[a].toFixed(2) + " row, " + P.pT[a].toFixed(0) + " K" + (P.A.frz[a] ? " frozen" : "") + "; " + log.join("; ") + "; " + watchNote(W) + "; " + cost()}); };
  trial("at the floor's middle", 24.75, 0);
  trial("in the floor row 0.05 cell above its rest", 24.75, 0.05);
  trial("a row and a half up", 23.25, 0);
}

if(mode === "nafire"){
  /* 2 t of sodium at 800 K poured onto a steel floor in a dry sealed box, no jet; 20 s of its surface fire */
  const A = build(sealed(), [], {hwall:0});
  const r = P.src.add({kind:"metal", rate:1e5, cell:at(30, 22), T:800}); march({cap:dt}); P.src.drop(r);
  const E = () => sumK(5, p => A.pE[p]) + sumC(A.eA) + sumK(4, p => A.pE[p]), o0 = sumC(A.nO), e0 = E(), b0 = B[BI.NAAIR], s0 = B[BI.SMOKE];
  const W = march({cap:20}), na = B[BI.NAAIR] - b0, sm = sumK(9) + sumC(A.dep) + sumC(A.gAcc.subarray(3*N, 4*N)) + B[BI.RELS] - s0;
  check("sodium burnt at its surface", na, 1, 1, "the fire is seen to burn", {unit:"kg", pass:na > 0.01, note:watchNote(W)});
  check("O2 used per kg of sodium burnt", (o0 - sumC(A.nO))*M_O2/na, M_O2/(2*M_NA), 1e-4, "2 Na + O2 -> Na2O2, IUPAC molar masses", {unit:"kg/kg"});
  check("smoke made per kg of sodium burnt", sm/na, 1 + M_O2/(2*M_NA), 1e-4, "2 Na + O2 -> Na2O2: the smoke is the sodium and its oxygen", {unit:"kg/kg"});
  check("heat the room's contents gained per kg of sodium burnt", (E() - e0)/na/1000, 510.9/(2*M_NA), 0.01,
    "first law: the heat of formation of Na2O2(s), -510.9 kJ/mol (as commonly quoted, not read at source)", {unit:"kJ/kg", note:"FIRE.lhv 11111; the burnt metal's own heat over the melt datum leaves with nothing; " + cost()});
}

if(mode === "nawater"){
  /* 2 rows of water at 293 K in a sealed box under nitrogen, so the H2 cannot burn, 1 t of sodium at its melting point laid on it; 10 s */
  const A = build(sealed(), [], {hwall:0}); for(let y=23;y<=24;y++) for(let x=16;x<=43;x++) P.lay(at(x, y), 1);
  for(let i=0;i<N;i++){ A.nN[i] += A.nO[i]; A.nO[i] = 0; A.eA[i] = A.nN[i]*20.8*(G.T_HULL - T0); }
  let lot = 0; const f = G.FIRE.NA, w0 = sumK(1), E = () => { lot = 0; for(let i=0;i<N;i++) lot += A.gAcc[i]/G.H2_MMOL*20.4*(A.gAT[i] - T0);
    return sumK(5, p => A.pE[p]) + sumC(A.eA) + sumK(1, p => P.pm[p]*4190*(P.pT[p] - T0)) + sumK(3, p => P.pm[p]/G.H2_MMOL*20.4*(P.pT[p] - T0)) + lot; };
  const e0 = E(), r = P.src.add({kind:"metal", rate:5e4, cell:at(30, 21), T:f.melt}); march({cap:dt}); P.src.drop(r);
  const W = march({cap:10}), na = B[BI.NAWAT];
  const h2 = sumK(3) + sumC(A.gAcc.subarray(0, N)), so = sumK(1, p => A.pSo[p]) + sumC(A.condSo), wu = w0 - sumK(1) - sumC(A.cond);
  check("sodium that took water", na, 1, 1, "the reaction is seen to run", {unit:"kg", pass:na > 0.01, note:watchNote(W)});
  check("H2 made per kg of sodium", h2/na, M_H2/(2*M_NA), 1e-3, "2 Na + 2 H2O -> 2 NaOH + H2, IUPAC molar masses", {unit:"kg/kg"});
  check("water used per kg of sodium", wu/na, M_H2O/M_NA, 1e-3, "2 Na + 2 H2O -> 2 NaOH + H2", {unit:"kg/kg", note:"steam boiled off counts as used; none boils at these temperatures"});
  check("NaOH in the water per kg of sodium", so/na, M_NAOH/M_NA, 1e-3, "2 Na + 2 H2O -> 2 NaOH + H2", {unit:"kg/kg"});
  check("heat the room's contents gained per kg of sodium", (E() - e0)/na/1000, (470.1 - 285.83)/M_NA, 0.01,
    "first law: NaOH(aq) -470.1, H2O(l) -285.83 kJ/mol (NBS tables as commonly quoted, not read at source)", {unit:"kJ/kg", note:"FIRE.wlhv 7994; on the bench's own datums (water CW, gas c_v, metal on its melt); " + cost()});
}

if(mode === "spray"){
  /* sodium at 800 K through a 10 mm hole, 5 kg/s for one step, at a jet Weber number of 10 and of 60 */
  const f = G.FIRE.NA, rho = G.fireRho(), frac = We => { build(sealed()); const v2 = We*f.sigma/(G.ROOM_RHO*0.01);
    P.src.add({kind:"metal", rate:5, cell:at(30, 12), T:800, dp:rho*v2/2, bore:0.01}); march({cap:dt}); return B[BI.SPRAY]/(5*dt); };
  check("a jet at We 10, the share that burns in flight", frac(10), 0, 1e-12, "Pilch and Erdman 1987: no bag break-up below We of about 12", {abs:true, unit:"-"});
  check("a jet at We 60, the share that burns in flight", frac(60), f.eta, 1e-9, "Pilch and Erdman 1987: past break-up the whole jet is spray; eta is FIRE's burnt share of it", {unit:"-", note:cost()});
}

if(mode === "smoke"){
  /* a sodium spray burning for 10 steps in a sealed box makes smoke; the still air (no turbulence) is read 6 s on */
  const A = build(sealed(), [], {turb:0}), f = G.FIRE.NA, v2 = 60*f.sigma/(G.ROOM_RHO*0.01);
  const r = P.src.add({kind:"metal", rate:50, cell:at(30, 12), T:800, dp:G.fireRho()*v2/2, bore:0.01});
  march({cap:10*dt}); P.src.drop(r);
  const W = march({cap:6}), T = G.T_HULL, mu = 1.458e-6*Math.pow(T, 1.5)/(T + 110.4), d = P.K.sd*1e-6, vs = 2805*g*d*d/(18*mu);
  let n = 0, v = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === 9){ n++; v += P.vy[p]*MPC; }
  check("smoke in still air, its mean fall speed", v/n, vs, 1e-3, "Stokes: v = rho_p g d^2/(18 mu), Na2O2 2805 kg/m3, d the knob, mu of air on Sutherland's law", {unit:"m/s", note:n + " parcels; " + watchNote(W)});
  check("smoke airborne, deposited, pending and vented against what the fire made", sumK(9) + sumC(A.dep) + sumC(A.gAcc.subarray(3*N, 4*N)) + B[BI.RELS], B[BI.SMOKE], 1e-9,
    "conservation of mass", {unit:"kg", note:cost()});
}

if(mode === "pan"){
  /* a pan of four floor cells under 350 kg of water and a sodium particle; 30 s of its drain */
  const A = build(sealed(), [{kind:"pan", cells:cells(16, 19, 24, 24)}]);
  for(let x=16;x<=19;x++) P.lay(at(x, 24), 0.1);
  const r = P.src.add({kind:"metal", rate:1e4, cell:at(17, 23), T:400}); march({cap:dt}); P.src.drop(r);
  const w0 = sumK(1) + B[BI.DRW] + B[BI.NAWAT]*G.FIRE.NA.wh2o, m0 = sumK(5) + B[BI.DRM] + B[BI.NAWAT] + B[BI.NAAIR];
  let early = 0, t0 = B[BI.DRW] + B[BI.DRM];
  const inPan = k => { let m = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === k && P.px[p] >= 16 && P.px[p] < 20 && P.py[p] >= 24) m += P.pm[p]; return m; };
  let d10 = NaN, off10 = NaN;
  const W = march({cap:30, each:(k, t) => { if(inPan(1) > 1e-6 && B[BI.DRM] > 0) early = 1;
    if(Math.abs(t - 10) < 1e-9){ d10 = B[BI.DRW] + B[BI.DRM] - t0; off10 = sumK(1) + sumK(5) - inPan(1) - inPan(5); } }});
  const short = G.PAN_DRAIN_KGS*10 - d10;
  check("the pan's drain over its first 10 s, kg a second", d10/10, G.PAN_DRAIN_KGS, 1e-9, "the drain line's rating while it has liquid to take (PAN_DRAIN_KGS)", {unit:"kg/s",
    gap:short > 0 && off10 >= short ? "the pan's bund" : "", note:"liquid off the pan's cells at 10 s " + off10.toFixed(1) + " kg against a shortfall of " + short.toFixed(1) + " kg; " + watchNote(W)});
  check("metal drained while water stood in the pan", early, 0, 0, "the drain takes the water first: it is on the bottom", {abs:true, unit:"-"});
  check("water left, drained and taken by the sodium against what was laid", sumK(1) + sumC(A.cond) + B[BI.DRW] + B[BI.NAWAT]*G.FIRE.NA.wh2o, w0, 1e-9, "conservation of mass", {unit:"kg"});
  check("metal left, drained and reacted against what was poured", sumK(5) + B[BI.DRM] + B[BI.NAWAT] + B[BI.NAAIR], m0, 1e-9, "conservation of mass", {unit:"kg", note:cost()});
}

if(mode === "corpour"){
  /* 10 t of corium at 2800 K poured at 2 t/s onto a steel floor in a dry sealed box, decay at 1 % of 150 W/kg; 20 s */
  const A = build(sealed(), [], {decay:0.01});
  P.src.add({kind:"corium", rate:2000, cell:at(30, 12), T:2800, comp:{F:0.6, K:0.2, Z:0.12, S:0.2}, dw:150, pv:0.1, tot:10000});
  let dec = 0; const W = march({cap:20, each:() => { dec += P.K.decay*sumK(6, p => A.pDw[p])*dt; }});
  for(const [k, a, o] of [["F", A.pCF, BI.INF], ["K", A.pCK, BI.INK], ["Z", A.pCZ, BI.INZ], ["S", A.pCS, BI.INS], ["X", A.pCX, BI.INX]])
    check("corium " + k + " on the floor against what the source poured", sumK(6, p => a[p]) + B[BI["OUT" + k]], B[o], 1e-9, "conservation of mass, per material", {unit:"kg"});
  check("decay heat delivered against its integral", B[BI.DECAY], dec, 1e-9, "first law: the decay weight times the decay share over time", {unit:"J", note:watchNote(W) + "; " + cost()});
}

if(mode === "corwet"){
  /* a sealed box, 10 rows of water laid; 3 t of corium at 1000 kg/s let go at row 20, inside the water; 10 s */
  const A = build(sealed(), [], {hwall:0}); for(let y=15;y<=24;y++) for(let x=16;x<=43;x++) P.lay(at(x, y), 1);
  march({cap:1}); const g0 = pocket(at(30, 9)), Vf = g0.V, comp = {F:0.6, K:0.2, Z:0.12, S:0.2};
  P.src.add({kind:"corium", rate:1000, cell:at(30, 20), T:2800, comp, dw:150, tot:3000});
  let peak = 0, nan = 0;
  const W = march({cap:10, each:() => { const k = pocket(at(30, 9)); if(k.k >= 0) peak = Math.max(peak, k.p); for(let p=0;p<P.np;p++) if(!(P.pT[p] === P.pT[p])) nan++; }});
  const Vc = 3000*(0.8/G.CORIUM.rhoDebris + 0.2/G.CORIUM.hdRho), bound = g0.p*Vf/(Vf - Vc) + (G.GAM_AIR - 1)*B[BI.FCIQ]/Vf;
  check("corium let go inside water, the box air's peak pressure", peak, bound, 0.1, "the air squeezed by the melt's own volume (isothermal) plus the FCI charge at constant volume: a stream displaces what it enters at its own rate",
    {unit:"Pa", note:watchNote(W) + "; start " + (g0.p/1000).toFixed(1) + " kPa, " + Vc.toFixed(2) + " m3 of melt"});
  check("the same, particle temperatures that are not numbers", nan, 0, 0, "a state is a number", {abs:true, unit:"-", note:cost()});
}

if(mode === "corT"){
  /* the mix F 0.6, K 0.2 (Zr 0.12 of it), S 0.2 kg on the melt law, at a stated enthalpy, against the hand melt curve */
  build(sealed()); const X = P.mix, F = 0.6, K = 0.2, S = 0.2, ts = handS(F, K, S, 0), Hs = hand(F, K, S, 0, ts), Lc = handL(F, K, S);
  const T = E => { X.CM[0] = F; X.CM[1] = K; X.CM[2] = S; X.CM[3] = 0; X.CM[5] = E; X.CM[6] = 2000; X.mixTA(); return X.CX[0]; };
  check("solid at 1500 K", T(hand(F, K, S, 0, 1500)), 1500, 0.01, "first law on the hand melt curve (Fink UO2, IAEA Zircaloy-2, ANL 316)", {abs:true, unit:"K"});
  check("half its fusion held at the solidus", T(Hs + 0.5*Lc), ts, 1e-6, "phase change: the mixed solidus pinned while the fusion comes out", {abs:true, unit:"K"});
  check("molten at 2900 K", T(hand(F, K, S, 0, 2900) + Lc), 2900, 0.01, "first law on the hand melt curve with its fusion", {abs:true, unit:"K"});
  /* a particle poured at 1500 K comes to rest frozen, then 10 s of water poured over it */
  const A = build(sealed()); P.src.add({kind:"corium", rate:1e5, cell:at(30, 22), T:1500, comp:{F, K, Z:0.12, S}, tot:1500});
  march({cap:3}); let q = -1; for(let p=0;p<P.np;p++) if(P.kind[p] === 6) q = p;
  const x0 = P.px[q], y0 = P.py[q], fz = A.frz[q]; P.src.add({kind:"fluid", rate:2000, cell:at(30, 12)});
  const W = march({cap:10}); let d = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === 6) d = Math.max(d, Math.hypot(P.px[p] - x0, P.py[p] - y0));
  check("a 1500 K corium particle at rest under 10 s of pouring water, its largest move", d, 0, 1e-12, "a solid does not flow: below its solidus the melt stands", {abs:true, unit:"cell", note:"frozen " + fz + "; " + watchNote(W) + "; " + cost()});
}

if(mode === "corpool"){
  /* 40 t of corium at 2800 K poured into a dry steel slot two cells wide, three cells deep in melt; no decay; 20 s */
  const A = build(box({}, 28, 31, 8, 25), [], {decay:0});
  P.src.add({kind:"corium", rate:20000, cell:at(29, 12), T:2800, comp:{F:0.6, K:0.2, Z:0.12, S:0.2}, dw:0, tot:40000});
  const W = march({cap:20});
  let sp = 0, deep = 0;
  for(const x of [29, 30]){ let lo = Infinity, hi = -Infinity, rows = new Set();
    for(let p=0;p<P.np;p++) if(P.kind[p] === 6 && (P.px[p]|0) === x){ lo = Math.min(lo, P.pT[p]); hi = Math.max(hi, P.pT[p]); rows.add(P.py[p]|0); }
    if(hi > lo) sp = Math.max(sp, hi - lo); deep = Math.max(deep, rows.size); }
  check("the widest temperature spread down one column of a pool " + deep + " rows deep, its top radiating and its floor taking heat", sp, 0, 1, "a melt pool's bulk is mixed by its own convection: isothermal outside thin boundary layers (ACOPO, BALI; the engine's one pool per floor cell)",
    {abs:true, unit:"K", note:watchNote(W) + "; " + cost()});
}

if(mode === "mcci"){
  /* the law by itself: 10 kg of LCS concrete's heat into a melt holding Zr and steel in three amounts */
  build(sealed()); const X = P.mix, AB = X.AB, c = G.concreteOf(), Q = 10*c.dhAbl;
  const law = (Z, S) => { const b = P.BK.slice(); AB[0] = 10; AB[1] = Z + 1; AB[2] = Z; AB[3] = S; AB[4] = 0; AB[5] = 0; AB[6] = 2500; AB[8] = Q; AB[9] = AF; AB[10] = 0; X.ablate(at(30, 12));
    const d = k => P.BK[BI[k]] - b[BI[k]]; return {v:d("ABLV"), h:d("ABLH"), co:d("ABLC"), d:d("ABLD"), fe:d("ABLFE"), Z:AB[2], S:AB[3]}; };
  const nw = 10*c.h2o/M_H2O, nc = 10*c.co2/M_CO2;
  const a = law(1.1*(nw/2 + nc/2)*M_ZR, 0), b = law((nw/2 + nc/4)*M_ZR, 0), h = law(nw/4*M_ZR, 0), z = law(0, 10);
  check("Zr for more than all the water and CO2: steam and CO2 out", a.v + a.d, 0, 1e-12, "Zr + 2 H2O -> ZrO2 + 2 H2, Zr + 2 CO2 -> ZrO2 + 2 CO: with Zr to spare nothing oxidising gets through", {abs:true, unit:"kg"});
  check("Zr for all the water and half the CO2: steam out", b.v, 0, 1e-12, "Ellingham order: water before CO2", {abs:true, unit:"kg"});
  check("the same, CO out", b.co, nc/2*M_CO, 1e-9, "the Zr left after the water takes half the CO2", {unit:"kg"});
  check("Zr for half the water: CO out", h.co, 0, 1e-12, "Ellingham order: no CO while water is left to reduce", {abs:true, unit:"kg", note:"steam out " + h.v.toFixed(4) + " kg"});
  check("no Zr, 10 kg of 316: iron oxidised", z.fe, Math.min(10*G.CLAD[2].compW.Fe/0.055845, nw + nc), 1e-9, "after Zr the steel's iron takes the oxygen: Fe + H2O -> FeO + H2, Fe + CO2 -> FeO + CO", {unit:"mol"});
  /* the pour: 5 t onto the cavity's basemat, 20 s */
  const r = P.room("cavity"); G.D.mat = r.mat; P.parts(r.parts); P.build(); const b0 = P.BK.slice();
  P.src.add({kind:"corium", rate:5000, cell:at(30, 25), T:2800, comp:{F:0.6, K:0.2, Z:0.12, S:0.2}, tot:5000});
  const W = march({cap:20}), d = k => P.BK[BI[k]] - b0[BI[k]], kg = d("ABLKG");
  check("concrete ablated times its ablation enthalpy against the heat into it", kg*c.dhAbl*1000, d("QDOWN"), 1e-9, "the ablation front's energy balance, dz/dt = q/(rho dh_abl) (Kang 2016; IRSN 2007-83)", {unit:"J", note:(kg).toFixed(2) + " kg; " + watchNote(W)});
  check("gas moles out per kg of concrete ablated", (d("ABLV")/M_H2O + d("ABLH")/M_H2 + d("ABLC")/M_CO + d("ABLD")/M_CO2)/kg, (0.0326 + 0.0111)/M_H2O + 0.2971/M_CO2, 1e-9,
    "Farmer, OSTI 1350637 Table II, limestone-common sand: water and CO2 per kg; each mole of gas survives its reduction as a mole", {unit:"mol/kg", note:cost()});
}

if(mode === "chf"){
  /* one corium particle at rest in a dry box, then saturated water laid over it; the first step's flux up */
  const A = build(sealed()); P.src.add({kind:"corium", rate:1e5, cell:at(30, 24), T:2800, comp:{F:0.8, K:0.2}, tot:1500});
  march({cap:2}); for(let p=0;p<P.np;p++) if(P.kind[p] === 6) A.pFci[p] = 1;
  for(let y=21;y<=23;y++) for(let x=16;x<=43;x++) P.lay(at(x, y), 1);
  const pk = pocket(at(30, 12)), p = pk.p/1e6, Ts = tsat(p);
  for(let q=0;q<P.np;q++) if(P.kind[q] === 1) P.pT[q] = Ts;
  const q0 = B[BI.QUP], v0 = sumK(2) + sumC(A.vAcc); march({cap:dt}); const Q = B[BI.QUP] - q0, v1 = sumK(2) + sumC(A.vAcc);
  const rf = 1/if97(p, Ts - 1e-6).v, rg = 1/if97r2(p, Ts + 1e-6).v, hfg = (if97r2(p, Ts).h - if97(p, Ts).h)*1000, t = 1 - Ts/647.096, sig = 0.2358*Math.pow(t, 1.256)*(1 - 0.625*t);
  const zub = 0.131*hfg*Math.sqrt(rg)*Math.pow(sig*g*(rf - rg), 0.25);
  check("the first flux into saturated water over corium at " + (p*1000).toFixed(1) + " kPa", Q/(AF*dt), zub, 0.01, "Zuber 1959 CHF, 0.131 hfg rho_g^1/2 (sigma g (rho_f - rho_g))^1/4, IF97 and IAPWS surface tension", {unit:"W/m2"});
  check("steam made that step", v1 - v0, Q/hfg, 0.005, "first law: saturated water boils Q/h_fg (IF97)", {unit:"kg", note:cost()});
  P.mix.ZB[5] = 25; P.mix.chfA();
  check("the boiling crisis asked at 25 MPa, past water's critical point: no cap", P.mix.ZB[4] === Infinity ? 1 : 0, 1, 0, "IAPWS: nothing boils past 22.064 MPa, so no film forms to cap a flux", {abs:true, unit:"-", note:"read " + P.mix.ZB[4]});
}

if(mode === "fci"){
  /* an oxidic corium particle at 2800 K dropped into 3 rows of water; its one charge */
  const A = build(sealed()); for(let y=22;y<=24;y++) for(let x=16;x<=43;x++) P.lay(at(x, y), 1);
  const F = 0.9, K = 0.1; P.src.add({kind:"corium", rate:1e5, cell:at(30, 21), T:2800, comp:{F, K}, tot:1500});
  let prev = NaN, p0 = NaN;
  const W = march({cap:5, each:() => { if(!(B[BI.FCIQ] > 0)){ for(let p=0;p<P.np;p++) if(P.kind[p] === 6) prev = A.pE[p]; p0 = pocket(at(30, 12)).p; } }, event:() => B[BI.FCIQ] > 0 ? "the charge" : ""});
  let q = -1; for(let p=0;p<P.np;p++) if(P.kind[p] === 6) q = p;
  const e = B[BI.FCIQ], m = P.pm[q], ts = tsat(p0/1e6), sup = prev - m*handE(F, K, 0, 0, ts), k = pocket(at(30, 12));
  check("the charge's energy over the particle's heat above saturation", e/sup, G.CORIUM.fciOx, 0.01, "SERENA-2 (NEA/CSNI/R(2017)15): 0.1-0.6 % of the melt's superheat goes to the explosion; fciOx inside it",
    {unit:"-", note:watchNote(W) + "; heat over Tsat on the hand melt curve"});
  check("the pocket's pressure rise over the step of the charge", (k.p - p0)/1000, (G.GAM_AIR - 1)*e/k.V/1000, 0.03, "first law at constant volume, air: dp = (gamma - 1) E/V",
    {unit:"kPa", note:"the step's boiling and radiation ride on it; " + cost()});
}

if(mode === "dch"){
  /* 40 kg of steam into a sealed box held at 600 K; then a vessel failing at 1.5 MPa pours 5 t: its dispersed share is the TCE limit */
  const A = build(sealed(), [], {hwall:0, cond:0});
  for(let i=0;i<N;i++) if(P.pc[i] >= 0) A.eA[i] = (A.nN[i]*20.8 + A.nO[i]*21.1)*(600 - T0);
  march({cap:dt}); const rs = P.src.add({kind:"steam", rate:40, cell:at(30, 20), T:600}); march({cap:1}); P.src.drop(rs); march({cap:0.5});
  const vap = (() => { let s = 0; for(let i=0;i<N;i++) s += P.src.vap(i); return s; })(), Tg = pocket(at(30, 12)).T, comp = {F:0.6, K:0.2, Z:0.12, S:0.2}, tot = 5000;
  const b0 = P.BK.slice(); P.src.add({kind:"corium", rate:1000, cell:at(30, 12), T:2800, comp, dw:0, pv:1.5, tot}); march({cap:dt});
  const f = Math.min(G.CORIUM.dchMax, G.CORIUM.dchMax*(1.5 - G.CORIUM.dchP0)/(G.CORIUM.dchP1 - G.CORIUM.dchP0)), Md = f*tot, wv = 2*M_H2O/M_ZR, dZ = Math.min(comp.Z*Md, vap/wv);
  const Q = handE(0.6*Md, 0.2*Md, 0.2*Md, 0, 2800) - handE(0.6*Md, 0.2*Md, 0.2*Md, 0, Tg) + dZ*(1100.6 - 2*241.8)/M_ZR*1000;
  check("heat into the gas at vessel failure", B[BI.DCHQ] - b0[BI.DCHQ], Q, 0.005, "Pilch TCE limit (NUREG/CR-6075): the dispersed melt's heat over the gas plus Zr + 2 H2O -> ZrO2 + 2 H2 at -617 kJ/mol",
    {unit:"J", note:"dispersed " + Md.toFixed(0) + " kg, " + dZ.toFixed(2) + " kg Zr burnt, gas at " + Tg.toFixed(0) + " K"});
  check("H2 made at vessel failure", B[BI.H2MADE] - b0[BI.H2MADE], 2*dZ*M_H2/M_ZR, 1e-9, "Zr + 2 H2O -> ZrO2 + 2 H2", {unit:"kg"});
  const W = march({cap:3}), ox = dZ*G.CORIUM.zro2PerZrO;
  check("corium on the floor and in the air, less the oxygen its Zr took, against the pour", sumK(6) - ox, tot, 1e-9, "conservation of mass: nothing counted twice", {unit:"kg", note:watchNote(W) + "; " + cost()});
}

if(mode === "catch"){
  /* a core catcher of 28 floor cells with 5 mm of sacrificial concrete; 2 t of corium poured on it, 60 s */
  const m = box({}, 15, 44, 8, 27), C = cells(16, 43, 26, 26), A = build(m, [{kind:"catcher", cells:C, sac:0.002}]);
  P.src.add({kind:"corium", rate:2000, cell:at(30, 20), T:2800, comp:{F:0.6, K:0.2, Z:0.12, S:0.2}, tot:2000});
  let fl = [];
  const W = march({cap:60, each:(k, t) => { fl.push(B[BI.FLOOD]); }});
  let top = 0; for(const i of C) top = Math.max(top, A.abl[i - GW]);
  check("the deepest ablation over the catcher", top, 0.002, 1e-4, "IRSN 2007-83 6.4: the melt eats the sacrificial layer and stops at it", {abs:true, unit:"m", note:watchNote(W)});
  check("H2 made in the catcher", B[BI.H2MADE], 0, 0, "IRSN 2007-83 6.4: the sacrificial concrete's Fe2O3 oxidises the Zr, and nothing makes H2", {abs:true, unit:"kg"});
  const once = fl.filter((v, i) => i > 0 && v !== fl[i - 1]).length;
  check("the catcher's flood, water laid", B[BI.FLOOD], G.CORIUM.catchWater*C.length*AF*1000, 1e-9, "catchWater over the catcher's floor area, once", {unit:"kg", note:"it rose on " + once + " step(s); " + cost()});
}

if(mode === "melt"){
  /* the basemat 0.3 mm thick for this rig, so a lone melt particle is through it before it slides a cell: 2 t of UO2 poured onto it in the cavity */
  G.CORIUM.basemat = 0.0003;
  const r = P.room("cavity"); G.D.mat = r.mat; P.parts([]); P.build(); const A = P.A;
  P.src.add({kind:"corium", rate:2000, cell:at(30, 25), T:2800, comp:{F:1}, tot:2000});
  const W = march({cap:50, event:() => B[BI.COROUT] > 0 && sumK(6) < 1 ? "the melt is through" : ""}), c = G.concreteOf();
  check("melt gone through the basemat", B[BI.COROUT], B[BI.CORIN], 1, "the melt ablates the basemat through its depth and leaves the board", {unit:"kg", pass:B[BI.COROUT] > 0});
  check("the melt left plus what went through, less the concrete slag it took, against the pour", sumK(6) + B[BI.COROUT] - B[BI.ABLKG]*(1 - c.h2o - c.co2), B[BI.CORIN], 1e-9,
    "conservation of mass: the basemat melt-through is booked", {unit:"kg", note:watchNote(W)});
  /* a concrete divider 5 mm thick between two sealed rooms, the right one 5 kPa over; 2 t of melt against its foot */
  G.CORIUM.basemat = 1.5;
  const m = box({}, 10, 49, 14, 27); for(let y=14;y<=27;y++) m["30," + y] = {m:"lined", t:2};
  const A2 = build(m), L = at(20, 20), R = at(40, 20), rr = P.src.add({kind:"o2", rate:5, cell:R}); march({cap:1}); P.src.drop(rr);
  const d0 = P.kP[P.pc[R]] - P.kP[P.pc[L]];
  P.src.add({kind:"corium", rate:2000, cell:at(29, 20), T:2800, comp:{F:1}, tot:2000});
  let open = -1; const W2 = march({cap:60, each:(k, t) => { if(open < 0 && A2.gone[at(30, 26)]) open = t; }, event:t => open >= 0 && t > open + 3 ? "3 s after the wall opened" : ""});
  check("the divider's foot, burnt through", open >= 0 ? 1 : 0, 1, 0, "the melt ablates the concrete beside it through its thickness", {abs:true, unit:"-", note:"at " + open.toFixed(2) + " s; " + watchNote(W2)});
  const d1 = Math.abs(P.kP[P.pc[R]] - P.kP[P.pc[L]]);
  check("the two rooms' pressure difference 3 s after it opened, over what it was", d1/d0, 0, 0.1, "gas passes an open hole: the rooms equalise", {abs:true, unit:"-", note:"before " + (d0/1000).toFixed(2) + " kPa; " + cost()});
}

if(mode === "skin"){
  /* a 56-cell machine at 600 K in a sealed box with adiabatic walls, 60 s */
  const C = cells(26, 33, 18, 24), A = build(sealed(), [{kind:"machine", cells:C, T:600}], {hwall:0});
  const c = at(20, 12), a = pocket(c), n = C.length, hk = G.ROOM_HK*1000, kp = n*hk*G.SKIN_PROC_K, ka = n*hk, Cs = G.ROOM_SKIN_TAU*n*hk;
  const Ca = A.kN[a.k]*20.8 + A.kO[a.k]*21.1, E0 = sumC(A.eA), q0 = B[BI.SKINQ];
  const W = march({cap:60});
  /* x = (Ts, Ta) - (Tp, Tp) obeys x' = M x: M = [[-(kp + ka)/Cs, ka/Cs], [ka/Ca, -ka/Ca]], solved on its two eigenvalues */
  const m11 = -(kp + ka)/Cs, m12 = ka/Cs, m21 = ka/Ca, m22 = -ka/Ca, tr = m11 + m22, det = m11*m22 - m12*m21, l1 = tr/2 + Math.sqrt(tr*tr/4 - det), l2 = tr/2 - Math.sqrt(tr*tr/4 - det);
  const x0 = 600 - 600, y0 = a.T - 600, v1 = [m12, l1 - m11], v2 = [m12, l2 - m11], dd = v1[0]*v2[1] - v2[0]*v1[1], c1 = (x0*v2[1] - v2[0]*y0)/dd, c2 = (v1[0]*y0 - x0*v1[1])/dd;
  const Ts = 600 + c1*v1[0]*Math.exp(l1*W.t) + c2*v2[0]*Math.exp(l2*W.t);
  check("the machine's skin, its fall from 600 K over " + W.t.toFixed(0) + " s", 600 - A.paSk[0], 600 - Ts, 0.01, "Newton cooling, two lumps: the skin between an infinite contents and the pocket's air, solved exactly", {unit:"K", note:watchNote(W)});
  check("heat from the contents against what the air and the skin gained", B[BI.SKINQ] - q0, (sumC(A.eA) - E0) + Cs*(A.paSk[0] - 600), 1e-6, "first law", {unit:"J", note:cost()});
}

if(mode === "hot"){
  /* a four-cell machine whose skin settles 20 K over H2_IGN_SURF, and one 50 K under it; 0.2 kg/s of H2 into its cells for 2 s */
  const lit = Tsk => { const Ta = G.T_HULL, Tp = (21*Tsk - Ta)/20, C = cells(29, 30, 20, 21);
    build(sealed(), [{kind:"machine", cells:C, T:Tp}]); const r = P.src.add({kind:"h2", rate:0.2, cell:at(29, 21)});
    let b = 0; march({cap:4, each:(k, t) => { if(t > 2 - 1e-9) P.src.drop(r); b += sumK(3, p => P.burn[p] ? 1 : 0); }}); return b; };
  check("H2 in a machine's cells, its skin at " + (G.H2_IGN_SURF + 20) + " K: burning parcel-steps", lit(G.H2_IGN_SURF + 20) > 0 ? 1 : 0, 1, 0,
    "hot-surface ignition 1000-1170 K, 1050 K the middle (Mevel 2019; Tamm 1987 via NUREG/CR-6530), as the live check", {abs:true, unit:"-"});
  check("the same at " + (G.H2_IGN_SURF - 50) + " K", lit(G.H2_IGN_SURF - 50) > 0 ? 1 : 0, 0, 0, "under the surface ignition temperature, and the air under H2_IGN, nothing lights", {abs:true, unit:"-", note:cost()});
}

if(mode === "slide"){
  /* one particle of sodium at 800 K and of UO2 melt at 2800 K sliding along a liner floor and up a liner wall (gravity off), each on its own
     viscosity: sodium Fink and Leibowitz 1995 (ANL/RE-95/2), ln mu = -6.4406 - 0.3958 ln T + 556.835/T; UO2 IAEA-TECDOC-1496, 0.988e-3 exp(4620/T) */
  const u0 = 0.5, EPS_ST = 4.5e-5, MW0 = 1000*G.ROOM_VCELL/P.K.ppc;
  const mu = (T, k) => k === 5 ? Math.exp(-6.4406 - 0.3958*Math.log(T) + 556.835/T) : 0.988e-3*Math.exp(4620/T);
  const FN = {fric0:"off", fric2:"doubled", fricE:"unheated", fricW:"on floors and ceilings only", fricR:"untested for touch"}[fault];
  const fn = (FN ? "FAULT INJECTED: the wall shear " + FN + "; " : "") + "roughness Moody 1944, commercial steel 0.045 mm; ";
  const liq = [{name:"sodium at 800 K", k:5, src:m0 => ({kind:"metal", rate:m0/dt, T:800}), m0:() => MW0*P.A.MF[1]/1000},
    {name:"UO2 melt at 2800 K", k:6, src:m0 => ({kind:"corium", rate:m0/dt, T:2800, comp:{F:1}, tot:m0}), m0:() => MW0*G.CORIUM.rhoDebris/1000}];
  const faces = [{what:"along a liner floor", box:[1, 58, 8, 25], at:[29, 24], ax:0, grav:1, u0},
    {what:"up a liner left wall, gravity off", box:[1, 58, 0, 33], at:[2, 20], ax:1, grav:0, u0:-u0}];
  for(const l of liq) for(const f of faces){ const [x0, x1, y0, y1] = f.box;
    build(box({}, x0, x1, y0, y1), [], {grav:f.grav, fric:1});
    const r = P.src.add(Object.assign(l.src(l.m0()), {cell:at(...f.at)})); march({cap:dt}); P.src.drop(r);
    let q = -1, n = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === l.k){ q = p; n++; }
    P.px[q] = f.at[0] + 0.5; P.py[q] = f.at[1] + 0.5; P.vx[q] = 0; P.vy[q] = 0;
    march({cap:1});
    const lo = f.ax ? y0 + 4 : x0 + 4, hi = f.ax ? y1 - 3 : x1 - 3, pos = () => f.ax ? P.py[q] : P.px[q], V = () => f.ax ? P.vy : P.vx;
    partSlide(G, P, {q, ax:f.ax, u0:f.u0, a:0, dt, cap:60, step, eps:EPS_ST, mu, what:"one particle of " + l.name + " sliding " + f.what,
      note:fn + n + " particle of it made, " + P.pm[q].toFixed(0) + " kg; given " + f.u0 + " m/s after 1 s at rest; ",
      stop:() => P.A.frz[q] ? "frozen" : pos() < lo || pos() > hi ? "within 3 cells of the face's end" : Math.abs(V()[q]*MPC) < 0.05*u0 ? "slowed to 5 % of u0" : ""}); }
}
