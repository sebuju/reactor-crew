"use strict";
// chunks: pour dch mcci flood catch fci
/* the corium outside the vessel: pour = mass and decay weight from the head to the floor; dch = direct containment heating against
   the TCE limit; mcci = concrete ablation, its gas, and the order Zr takes the oxygen in; flood = a flooded melt at CHF, then through
   its crust; catch = EPR's vessel pours onto its core catcher, which floods, eats only its sacrificial layer and stays; fci = a pour into water */
const {check, commissionPreset, inBundle, tsat, watch, watchNote} = require("./lib.js");
const mode = process.argv[2];
const G = commissionPreset(mode === "catch" ? 4 : 0), PT = G.PT, ST = G.ST, c = 0, CO = G.CORIUM, GW = G.GW, N = GW*G.GH;
const S0 = G.engSnap(G.engSnapNew()), rk = PT.coreRated[c]*1000, dec = 0.011, A = G.MPC*G.ROOM_DEPTH;
const hF = T => { G.E_FU[0] = T; G.eFuelHA(c); return G.E_FU[1]; }, hK = T => { G.E_CL[0] = T; G.E_CL[4] = T; G.eCladHA(c); return G.E_CL[1]; };
const fuse = PT.coreFuseKJ[c], lat = PT.cladHfus[PT.coreCladRow[c]], ZR = 0.091224, W = 0.018015, H2 = 0.002016, CO2 = 0.044009, COm = 0.028010;
const q = G.CONCRETE.LCS;
/* the TMI-2 debris, 19 t of 78/17 UO2/ZrO2 at T0 in the pool below the core, Zr metal kg of it still metal */
const pool = (T0, zr, t) => { const m = t ?? 19000, F = m*0.78/0.95, K = m*0.17/0.95;
  ST.csPlF[c] = F; ST.csPlK[c] = K; ST.csPlZ[c] = zr; ST.csPlE[c] = F*(hF(T0) + fuse) + K*(hK(T0) + lat); ST.csPlL[c] = F*fuse + K*lat;
  ST.csDecay[c] = dec; ST.csPlDw[c] = 0.13*m/(dec*rk); };
const sumCell = k => { let t = 0; for(let i=0;i<N;i++) t += ST[k][i]; return t; };
const src = new Float64Array(N);

if(mode === "pour"){
  G.engRestore(S0); pool(2800, 3000); ST.csPCore[c] = 0.1; ST.csHdFail[c] = 1;
  const m0 = ST.csPlF[c] + ST.csPlK[c], z0 = ST.csPlZ[c], d0 = ST.csPlDw[c]*rk;
  G.eCorStep(0.02, src);
  let at = -1; for(let i=0;i<N;i++) if(ST.roomCorF[i] > 0) at = i;
  const note = "landed at cell " + (at%GW) + "," + ((at/GW)|0) + " under the vessel's box " + PT.coreBox[0] + "," + PT.coreBox[1] + " " + PT.coreBox[2] + "x" + PT.coreBox[3];
  check("the pool below the core poured onto the floor: fuel and can kg, head to floor", (sumCell("roomCorF") + sumCell("roomCorK") - m0)/m0 + (ST.csPlF[c] + ST.csPlK[c])/m0, 0, 1e-12, "conservation of mass", {abs:true, note});
  check("...its Zr metal", (sumCell("roomCorZ") - z0)/z0, 0, 1e-12, "conservation of mass", {abs:true});
  check("...and its decay heat goes with it", (sumCell("roomCorDw") - d0)/d0, 0, 1e-12, "the fission products go where the material goes", {abs:true});
  check("...at 0.1 MPa no share of it is blown into the room", ST.sc[G.SC_CORCHEMQ], 0, 0, "no direct containment heating under 0.2 MPa (KAERI 1:20, NEA/CSNI/R(96)25)", {abs:true});
}

if(mode === "dch"){
  /* the head fails at 5 MPa under 300 kg with 50 kg of Zr metal, TMI-2's 19 t scaled from a real containment to this compartment; its air a fifth steam by mass */
  const run = () => { G.engRestore(S0); pool(2800, 50, 300); ST.csPCore[c] = 5;
    const n = G.eCorRoom(c), V = G.E_RR[G.RR_A], cells = Array.from(G.SX.rCells.subarray(0, n));
    for(const j of cells){ const v = ST.roomM[j]*0.25; ST.roomVap[j] += v; ST.roomM[j] += v; }
    const molOf = j => { const s = ST, x = s.roomM[j] - s.roomH2[j] - s.roomVap[j] - s.roomCO[j] - s.roomCO2[j], y = 0.2095*0.031998/0.02896, ex = (s.roomO2[j] - y*x)/(1 - y);
      return (x - ex)/0.02896 + ex/0.031998 + s.roomVap[j]/W + s.roomH2[j]/H2 + s.roomCO[j]/COm + s.roomCO2[j]/CO2; };
    const pOf = j => molOf(j)*8.314462618*ST.roomT[j]/G.eRoomVgas(j)/1000;
    let Tg = 0, vap = 0, p0 = 0;
    for(const j of cells){ const v = G.eRoomVgas(j); Tg += ST.roomT[j]*v/V; vap += ST.roomVap[j]; p0 += pOf(j)*v/V; }
    const T0 = cells.map(j => ST.roomT[j]);
    const f = Math.min(0.8, 0.8*(5 - 0.2)/1.3), dE = f*(ST.csPlE[c] - ST.csPlF[c]*hF(Tg) - ST.csPlK[c]*hK(Tg)), dZ = Math.min(f*50, vap/(2*W/ZR));
    const h0 = cells.reduce((t, j) => t + ST.roomH2[j], 0);
    G.eCorDch(c);
    /* TCE's constant gamma taken where the gas spends the rise, at the mean of its two temperatures */
    let p1 = 0, cv = 0, mr = 0;
    cells.forEach((j, k) => { p1 += pOf(j)*G.eRoomVgas(j)/V; G.eMixOf(j); G.E_GMX[G.GX_T] = (T0[k] + ST.roomT[j])/2; G.eMixA();
      cv += ST.roomM[j]*(G.E_GMX[G.GX_CP] - G.E_GMX[G.GX_RG]); mr += ST.roomM[j]*G.E_GMX[G.GX_RG]; });
    return {n, V, dP:p1 - p0, tce:(mr/cv)*(dE + dZ*6760)/V, dH:cells.reduce((t, j) => t + ST.roomH2[j], 0) - h0, dZ, f}; };
  const a = run(), note = a.n + " gas cells in the vessel's compartment, " + a.V.toFixed(1) + " m3, " + (a.f*100).toFixed(0) + " % dispersed, " + a.dZ.toFixed(1) + " kg of Zr burnt, " + (a.tce).toFixed(0) + " kPa by TCE";
  check("direct containment heating at 5 MPa: the compartment's gas against the TCE limit (eta 1, psi 0)", a.dP, a.tce, 0.05,
    "Pilch's two-cell equilibrium: dP = (eta1 + eta2)(gamma - 1)/V sum dE/(1 + psi), the debris' heat over the gas's temperature plus its Zr burnt in steam at 6.76 MJ/kg, gamma at the gas's mean temperature", {unit:"kPa", note});
  check("...the hydrogen it makes against the Zr it burns", a.dH/a.dZ, 2*H2/ZR, 1e-9, "Zr + 2 H2O -> ZrO2 + 2 H2", {unit:"kg/kg"});
  const m = CO.dchMax; inBundle("CORIUM.dchMax = 0"); const f = run(); inBundle("CORIUM.dchMax = " + m);
  check("fault injected, nothing dispersed: the TCE check fails", Math.abs(f.dP - a.tce)/a.tce > 0.05 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"dP " + f.dP.toFixed(1) + " kPa"});
}

/* 5 t of oxide melt at 2300 K on the floor at the foot of the vessel's column, dry, no Zr unless given */
const floor = zr => { G.engRestore(S0); ST.csDecay[c] = dec;
  const i = G.eCorLandI(Math.min(G.GH - 1, PT.coreBox[1] + PT.coreBox[3])*GW + PT.coreBox[0] + (PT.coreBox[2] >> 1));
  G.E_XA[0] = 5000; G.E_XA[1] = 0; G.E_XA[2] = zr; G.E_XA[3] = 0; G.E_XA[4] = 5000*(hF(2300) + fuse); G.E_XA[5] = 5000*fuse; G.E_XA[6] = 0; G.E_XA[7] = c;
  G.eCorAddA(i); G.eCorTA(i); return i; };

if(mode === "mcci"){
  const i = floor(0), Q = 200*A*0.02, h0 = ST.roomVap[i], d0 = ST.roomCO2[i];
  G.E_XQ[0] = Q; G.E_XQ[1] = A; G.E_XQ[2] = 0; G.eCorAblateA(i);
  check("LCS basemat at a held 200 kW/m2: the ablation rate", G.E_RR[G.RR_D]/0.02, 200e3/(q.rho*q.dhAbl*1000), 1e-6, "an ablation front: v = q/(rho dH_abl), rho 2373 kg/m3, 2.3 MJ/kg (Kang 2016, IRSN 2007-83)", {unit:"m/s"});
  const mc = Q/q.dhAbl, mol = ((ST.roomVap[i] - h0)/W + (ST.roomCO2[i] - d0)/CO2)/mc;
  check("...the gas it gives, no Zr to take it", mol, (0.0326 + 0.0111)/W + 0.2971/CO2, 1e-9, "Farmer (OSTI 1350637) Table II, LCS: 3.26 + 1.11 wt% water, 29.71 wt% CO2, 9.17 mol/kg", {unit:"mol/kg"});
  /* Zr for half the water, then for all of it and a third of the CO2 */
  const rZ = zr => { const j = floor(zr), h = ST.roomH2[j], o = ST.roomCO[j]; G.E_XQ[0] = Q; G.E_XQ[1] = A; G.E_XQ[2] = 0; G.eCorAblateA(j); return {h:(ST.roomH2[j] - h)/H2, o:(ST.roomCO[j] - o)/COm}; };
  const nw = mc*(0.0326 + 0.0111)/W, nc = mc*0.2971/CO2, lo = rZ(nw/4*ZR), hi = rZ((nw/2 + nc/6)*ZR);
  check("Zr for half the water: every mole of it makes H2, no CO", lo.h/(nw/2) + lo.o, 1, 1e-9, "Zr takes water's oxygen before CO2's (Zr + 2 H2O -> ZrO2 + 2 H2 first)", {unit:"-", note:"H2 " + lo.h.toExponential(3) + " mol, CO " + lo.o});
  check("Zr for all the water and a third of the CO2: all the water is H2, the rest of the Zr makes CO", hi.o/(nc/3) + hi.h/nw, 2, 1e-9, "then Zr + 2 CO2 -> ZrO2 + 2 CO", {unit:"-"});
  const src0 = G.eCorAblateA.toString();
  inBundle("eCorAblateA = " + src0.replace("z1 = Math.min(nz, nw/2)", "z1 = 0").replace(/^function eCorAblateA/, "function"));
  const f = rZ(nw/4*ZR); inBundle("eCorAblateA = " + src0.replace(/^function eCorAblateA/, "function"));
  check("fault injected, the Zr reduction of water off: the order check fails", Math.abs(f.h/(nw/2) + f.o - 1) > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true});
}

if(mode === "flood"){
  /* the melt on the floor, 200 kg of water poured over it at 1 atm: what goes up, tick by tick, against Zuber's CHF, then through the crust */
  const i = floor(0);
  G.E_RR[G.RR_LKG] = 200; G.E_RR[G.RR_LKJ] = 200*G.hOfTP(G.SAT_WATER, 370, 0.1013); G.E_RR[G.RR_LV0] = 0; G.E_RR[G.RR_LDSP] = 0; G.eLiqLand(G.E_LQ[0], i);
  ST.roomCorDw[i] = 0.13*5000/dec;
  const qs = []; let e = 0;
  watch(G, {dt:0.5, cap:600, step:() => { e = ST.roomWaterE[i]; G.eCorStep(0.5, src.fill(0)); }, each:() => qs.push((ST.roomWaterE[i] - e)*1000/(A*0.5))});
  G.E_CHF[0] = (G.ROOM_P0 + Math.max(0, ST.roomP[i]))/1000; G.eChfZuberA();
  const late = qs.slice(-60).reduce((a, b) => a + b, 0)/60;
  check("a flooded melt, the first seconds: the flux to the water is the CHF", qs[0], G.E_CHF[4], 1e-9, "Farmer, CCI key findings: close to the CHF limit of ~1 MW/m2 as water meets the melt", {unit:"W/m2", note:"Zuber at the cell's pressure, " + (G.E_CHF[4]/1e6).toFixed(2) + " MW/m2"});
  check("report, deliberate cut (no water ingression): after the crust has formed, 9.5-10 min in, the flux through the crust", late, 450e3, 200e3, "Farmer, CCI key findings: after ~5 min the debris-water flux fell below 1 MW/m2, then ran 250-650 kW/m2, several times what conduction through a crust gives (water ingression)",
    {abs:true, unit:"W/m2", pass:true, note:"not graded, fidelity: corium outside the vessel, point 1; crust " + (ST.roomCorCr[i]*1000).toFixed(1) + " mm; at 5 min " + (qs[599]/1e3).toFixed(0) + " kW/m2"});
  check("...and the flux falls from the CHF as the crust grows", late < qs[0]/2 ? 1 : 0, 1, 0, "Farmer, CCI key findings: the flux fell off the CHF within minutes", {abs:true});
}

if(mode === "catch"){
  /* EPR's catcher: 3 t of melt with 300 kg of Zr metal at 3 MW in the pool below the core, the head failed at 0.1 MPa, poured; then the floor step alone until its front stands, 3 h at most */
  const a = G.IX.part.get(G.LAY.parts.find(p => p.role === "catcher").id), cp = G.LAY.parts.find(p => p.role === "catcher");
  /* how: "land" stops at the landing; "floor" stops once the front is past the layer; otherwise the front is watched until it stands still at the layer */
  const run = how => { G.engRestore(S0); ST.csDecay[c] = dec;
    ST.csPlF[c] = 3000; ST.csPlK[c] = 0; ST.csPlZ[c] = 300; ST.csPlE[c] = 3000*(hF(2400) + fuse); ST.csPlL[c] = 3000*fuse; ST.csPlDw[c] = 3000/(dec*rk);
    ST.csPCore[c] = 0.1; ST.csHdFail[c] = 1;
    const w0 = sumCell("roomWater"); G.eCorStep(0.02, src.fill(0));
    let i = -1; for(let j=0;j<N;j++) if(ST.roomCorF[j] > 0) i = j;
    G.eCorFloorA(i); const code = G.E_XF[0], pooled = ST.csPlF[c] + ST.csPlK[c];
    const floodKg = sumCell("roomWater") - w0, h2 = ST.roomH2[i];
    const E0 = sumCell("roomCorE"), q0 = ST.sc[G.SC_CORQOUT], ch0 = ST.sc[G.SC_CORCHEMQ], f0 = ST.sc[G.SC_CORFCIQ], o0 = ST.sc[G.SC_COROUTQ];
    let heat = 0, maxAbl = 0, m0 = sumCell("roomCorF") + sumCell("roomCorK") + sumCell("roomCorS"), w = {t:0, end:"landed"};
    // cap at the 3 h question: the front's pace is the melt's heat into concrete, not a transit
    if(how !== "land") w = watch(G, {dt:1, cap:3*3600,
      step:() => { for(let j=0;j<N;j++) heat += ST.csDecay[ST.roomCorSrc[j]]*ST.roomCorDw[j]*1; G.eCorStep(1, src.fill(0)); },
      each:() => { for(let j=0;j<N;j++) if(ST.roomCorAbl[j] > maxAbl) maxAbl = ST.roomCorAbl[j]; },
      sig:how === "floor" ? [] : [{name:"ablation", read:() => maxAbl, ref:CO.catchSac, tol:1e-3}],
      event:() => how === "floor" && maxAbl > CO.catchSac + 1e-3 ? "the front passed the layer" : ""});
    const E1 = sumCell("roomCorE"), book = (E1 - E0) + (ST.sc[G.SC_CORQOUT] - q0) + (ST.sc[G.SC_CORFCIQ] - f0) + (ST.sc[G.SC_COROUTQ] - o0) - (ST.sc[G.SC_CORCHEMQ] - ch0) - heat;
    let onCatch = 0; for(let j=0;j<N;j++) if(ST.roomCorF[j] > 0){ G.eCorFloorA(j); if(G.E_XF[0] === 2) onCatch += ST.roomCorF[j]; }
    return {i, code, pooled, floodKg, wet:ST.partCatWet[a], dh2:ST.roomH2[i] - h2, maxAbl, onCatch, out:ST.sc[G.SC_COROUTKG], e:book/heat, zr:sumCell("roomCorZ"), m0, w}; };
  const r = run(), note = "catcher at " + cp.x + "," + cp.y + ", the pour landed at " + (r.i%GW) + "," + ((r.i/GW)|0) + "; " + (r.onCatch/1000).toFixed(2) + " t of fuel on it, " + watchNote(r.w) + ", deepest ablation " + (r.maxAbl*100).toFixed(1) + " cm, Zr left " + r.zr.toFixed(0) + " kg";
  check("the vessel's pour lands on the catcher", r.code === 2 && r.pooled === 0 ? 1 : 0, 1, 0, "a failed vessel pours straight down the column under the middle of its box; the catcher stands in it", {abs:true, note});
  check("a melt landed on a catcher floods it with its own water", r.floodKg, PT.partCatW[a], 1e-9, "IRSN 2007-83 6.4: the EPR floods its spread melt passively; the knob, floor area x 1 m (FIT)", {unit:"kg", note});
  check("...eats its sacrificial layer and no further: the cooled iron floor stops it", r.maxAbl, CO.catchSac, 1e-9, "IRSN 2007-83 6.4", {unit:"m", pass:r.maxAbl <= CO.catchSac + 1e-3 && r.maxAbl >= CO.catchSac*0.99, note});
  check("...its Fe2O3 takes the Zr, so the layer makes no hydrogen", r.dh2, 0, 0, "IRSN 2007-83 6.4: the sacrificial concrete oxidises the melt's Zr without H2", {abs:true, unit:"kg"});
  check("...and the melt stays in it", r.out, 0, 0, "the iron floor holds", {abs:true, unit:"kg"});
  check("...the melt's own books over the watched run: its energy + what left it = decay heat + chemistry", r.e, 0, 1e-6, "first law", {abs:true, unit:"of the decay heat"});
  const src0 = G.eCorStep.toString();
  inBundle("eCorStep = " + src0.replace("GW + x + (w >> 1)", "GW + x").replace(/^function eCorStep/, "function"));
  const fp = run("land"); inBundle("eCorStep = " + src0.replace(/^function eCorStep/, "function"));
  check("fault injected, the pour down the box's left edge: the landing check fails", fp.code === 2 ? 0 : 1, 1, 0, "the check above must be able to fail", {abs:true, note:"landed at " + (fp.i%GW) + "," + ((fp.i/GW)|0) + ", floor code " + fp.code});
  inBundle("eCorStep = " + src0.replace("(code === 2 && s.roomCorAbl[i] >= CORIUM.catchSac)", "false").replace(/^function eCorStep/, "function"));
  const f = run("floor"); inBundle("eCorStep = " + src0.replace(/^function eCorStep/, "function"));
  check("fault injected, no iron floor: the melt eats past the layer and the check fails", f.maxAbl > CO.catchSac + 1e-3 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:(f.maxAbl*100).toFixed(1) + " cm"});
}

if(mode === "fci"){
  /* a pour into a flooded cell: a fixed share of its heat over the water's saturation becomes a blast */
  const shot = met => { G.engRestore(S0);
    const i = G.eCorLandI(Math.min(G.GH - 1, PT.coreBox[1] + PT.coreBox[3])*GW + PT.coreBox[0] + (PT.coreBox[2] >> 1));
    G.E_RR[G.RR_LKG] = 300; G.E_RR[G.RR_LKJ] = 300*G.hOfTP(G.SAT_WATER, 350, 0.1013); G.E_RR[G.RR_LV0] = 0; G.E_RR[G.RR_LDSP] = 0; G.eLiqLand(G.E_LQ[0], i);
    const F = met ? 1000 : 3000, K = met ? 3000 : 1000, T = 2600, Ts = tsat((G.ROOM_P0 + Math.max(0, ST.roomP[i]))/1000), E = F*(hF(T) + fuse) + K*(hK(T) + lat);
    G.E_XA[0] = F; G.E_XA[1] = K; G.E_XA[2] = 0; G.E_XA[3] = 0; G.E_XA[4] = E; G.E_XA[5] = F*fuse + K*lat; G.E_XA[6] = 0; G.E_XA[7] = c;
    const q0 = ST.sc[G.SC_CORFCIQ]; G.eCorAddA(i);
    return {got:ST.sc[G.SC_CORFCIQ] - q0, want:(met ? 0.001 : 0.003)*(E - F*hF(Ts) - K*hK(Ts))}; };
  const o = shot(false), m = shot(true);
  check("an oxide pour into water: the blast's share of its heat over saturation", o.got, o.want, 1e-9, "SERENA-2: 0.1-0.6 % of the melt's thermal energy (NEA/CSNI/R(2017)15), FIT 0.3 %", {unit:"kJ"});
  check("...a pour over half metal", m.got, m.want, 1e-9, "SERENA-2's metallic melts at the low end, FIT 0.1 %", {unit:"kJ"});
}
