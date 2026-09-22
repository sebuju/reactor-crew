"use strict";
// chunks: props prim s5 s6 s7 coef
/* the solid moderator: props = every MODER row's cp(T) and k(T) against its source; prim = the block conduction primitive and the gap gas; s<n> = preset n's stack, its energy, its lag and its temperatures against its namesake; coef = the blocks' temperature coefficient law */
const {check, load, commissionPreset, coreShareHand, modProp, inBundle} = require("./lib.js");
const mode = process.argv[2];
const ROW_T = "graphite temperature", ROW_C = "moderator temperature coefficient";

if(mode === "props"){
  const G = load(), io = new Float64Array(3);
  const at = (row, T) => { io[0] = T; row.cpA(io, 0, 1); row.kA(io, 0, 2); return {cp:io[1], k:io[2]}; };
  const [GR, BEO, ZRH] = G.MODER;
  /* Butland & Maddison (J. Nucl. Mater. 49, 1973), cal/g/K, typed a second time */
  const bm = T => 4.184*(0.54212 - 2.42667e-6*T - 90.2725/T - 43449.3/(T*T) + 1.59309e7/(T*T*T) - 1.43688e9/(T*T*T*T));
  let e = 0; for(const T of [300, 600, 1000]) e = Math.max(e, Math.abs(at(GR, T).cp/bm(T) - 1));
  check("GRAPHITE cp at 300, 600, 1000 K, worst", e, 0, 0.01, "Butland & Maddison, J. Nucl. Mater. 49 (1973), their fit typed again", {abs:true, unit:"of the value"});
  let eb = 0; for(const T of [300, 600, 1000]) eb = Math.max(eb, Math.abs(1.1*at(GR, T).cp/bm(T) - 1));
  check("fault injected, graphite cp x 1.1: the cp check fails", eb > 0.01 ? 1 : 0, 1, 0, "the cp check above must be able to fail", {abs:true});
  const ORNL = "ORNL/TM-2018/1040 (Summary Report on Effects of Irradiation on Material IG-110, read 22/09/26)";
  check("GRAPHITE k at 25 C: irradiated, saturated", at(GR, 298.15).k, 15, 0.01,
    ORNL + " App. B.5.1: IG-110 irradiated at 450-750 C and measured at 25 C reads 10-26 W/m/K; 15 taken, one curve for every grade", {unit:"W/m/K"});
  check("GRAPHITE k in service at 500 C", at(GR, 773.15).k, 30, 0.20,
    ORNL + " sec. 4.1: an irradiated specimen's conductivity from historical experience, ~30 W/m/K, used for its in-service thermal design; behaviour, not the decimal",
    {unit:"W/m/K", note:"k follows cp at a saturated defect mean free path (Kelly, Physics of Graphite, ch. 4)"});
  /* NIST WebBook Shomate for BeO, alpha phase (Chase 1998), J/mol/K over 25.0116 g/mol, typed a second time */
  const sho = T => { const t = T/1000, c = t < 0.8 ? [3.358974, 131.5922, -140.4937, 56.20953, -0.536669] : [47.06205, 5.598359, -0.495570, 0.054527, -2.947373];
    return (c[0] + c[1]*t + c[2]*t*t + c[3]*t*t*t + c[4]/(t*t))/25.0116; };
  let ec = 0; for(const T of [300, 600, 1000]) ec = Math.max(ec, Math.abs(at(BEO, T).cp/sho(T) - 1));
  check("BERYLLIUM OXIDE cp at 300, 600, 1000 K, worst", ec, 0, 0.01, "NIST Chemistry WebBook, BeO solid Shomate (Chase 1998), typed again", {abs:true, unit:"of the value"});
  const IK = {300:272, 600:111, 1000:47};
  let ek = 0; for(const T in IK) ek = Math.max(ek, Math.abs(at(BEO, +T).k/IK[T] - 1));
  check("BERYLLIUM OXIDE k at 300, 600, 1000 K, worst", ek, 0, 0.01, "Incropera & DeWitt Table A.2 (TPRC), as commonly quoted, typed again", {abs:true, unit:"of the value"});
  check("ZIRCONIUM HYDRIDE cp and k, flat", Math.abs(at(ZRH, 600).cp - 0.40) + Math.abs(at(ZRH, 600).k - 17.6), 0, 1e-12,
    "ZrH1.6 as commonly quoted from Simnad, Nucl. Eng. Des. 64 (1981), not read at source", {abs:true});
  check("every MODER row states cp and k", G.MODER.every(r => typeof r.cpA === "function" && typeof r.kA === "function") ? 1 : 0, 1, 0,
    "a moderator without a temperature would be a special case", {abs:true});
}

if(mode === "prim"){
  const G = load(), io = new Float64Array(2);
  /* the same annulus by quadrature: flux q(r) = (r2 - a2)/(2r) from the adiabatic face a, T integrated back from the cooled face */
  const numeric = (ri, ro, inner) => { const N = 200000, a = inner ? ro : ri, c = inner ? ri : ro, h = (c - a)/N;
    let T = 0, peak = 0, mean = 0, A = Math.abs(ro*ro - ri*ri);
    const grad = r => -(r*r - a*a)/(2*r);
    const Ts = new Float64Array(N + 1);
    for(let i=N;i>0;i--){ const r1 = a + i*h, r0 = r1 - h, rm = (r0 + r1)/2;
      Ts[i-1] = Ts[i] + grad(rm)*(r0 - r1); }
    for(let i=0;i<=N;i++){ const r = a + i*h, w = (i === 0 || i === N) ? 0.5 : 1; mean += w*2*r*Ts[i]*Math.abs(h); }
    peak = Ts[0]; mean /= A; return [mean, peak]; };
  let e = 0;
  for(const [ri, ro, inner] of [[0.057, 0.141, true], [0.02, 0.1, true], [0.01, 0.08, false]]){
    G.blockRiseA(ri, ro, inner, io); const [m, p] = numeric(ri, ro, inner);
    e = Math.max(e, Math.abs(io[0]/m - 1), Math.abs(io[1]/p - 1)); }
  check("block conduction: mean and peak rise against the radial solve by quadrature, three annuli, worst", e, 0, 1e-6,
    "steady conduction, uniform q''', cooled on one face and adiabatic on the other: (1/r) d/dr(r k dT/dr) = -q'''", {abs:true, unit:"of the value"});
  G.blockRiseA(0, 0.1, false, io);
  check("block conduction: a solid rod cooled outside, peak", io[1], 0.01/4, 1e-9, "analytic: q'''R2/(4k)", {unit:"m2"});
  check("block conduction: a solid rod cooled outside, mean", io[0], 0.01/8, 1e-9, "analytic: q'''R2/(8k)", {unit:"m2"});
  G.blockRiseA(0.057, 0.141, true, io); const bad = io[0]*1.001, [m0] = numeric(0.057, 0.141, true);
  check("fault injected, the mean rise 0.1 % off: the quadrature check fails", Math.abs(bad/m0 - 1) > 1e-6 ? 1 : 0, 1, 0, "the conduction check above must be able to fail", {abs:true});
  /* Wassiljewa with Mason-Saxena's Phi, typed a second time on the pure gases' Incropera figures */
  const INC = "Incropera & DeWitt Table A.4 (as commonly quoted, not read at source)";
  const he = T => 0.152*Math.pow(T/300, 0.707), n2 = T => 0.0259*Math.pow(T/300, 0.764);
  check("gap gas: pure helium at 300 and 800 K", Math.abs(G.gasMixK(1, 300) - 0.152) + Math.abs(G.gasMixK(1, 800) - 0.304), 0, 5e-4, INC + ": He 0.152 and 0.304 W/m/K", {abs:true, unit:"W/m/K"});
  check("gap gas: pure nitrogen at 300 and 800 K", Math.abs(G.gasMixK(0, 300) - 0.0259) + Math.abs(G.gasMixK(0, 800) - 0.0548), 0, 5e-4, INC + ": N2 0.0259 and 0.0548 W/m/K", {abs:true, unit:"W/m/K"});
  const phi = (mi, mj, Mi, Mj) => Math.pow(1 + Math.sqrt(mi/mj)*Math.pow(Mj/Mi, 0.25), 2)/Math.sqrt(8*(1 + Mi/Mj));
  const ms = (x, T) => { const y = 1 - x, pa = phi(199e-7, 178.2e-7, 4.0026, 28.013), pb = phi(178.2e-7, 199e-7, 28.013, 4.0026);
    return x*he(T)/(x + y*pa) + y*n2(T)/(y + x*pb); };
  let eg = 0; for(const [x, T] of [[0.9, 600], [0.7, 700]]) eg = Math.max(eg, Math.abs(G.gasMixK(x, T)/ms(x, T) - 1));
  check("gap gas: He-N2 at 90 % and 70 % helium against Mason-Saxena by hand, worst", eg, 0, 0.02,
    "Mason & Saxena (Phys. Fluids 1, 1958) on the pure gases' own k and viscosity; the RBMK-1000 purge runs 70-90 % He (CAST D5.3, 2016)", {abs:true, unit:"of the value",
      note:"90 % He at 600 K " + G.gasMixK(0.9, 600).toFixed(4) + " W/m/K, a mole-weighted mean would read " + (0.9*he(600) + 0.1*n2(600)).toFixed(4)});
}

/* one graphite preset's stack: commissioned at rating, pushed 5 K and let go */
if(mode[0] === "s"){
  const pre = +mode.slice(1), G = commissionPreset(pre), PT = G.PT, ST = G.ST, SX = G.SX, sc = ST.sc, name = G.PLANTPRE[pre][0];
  const c = 0, XNN = G.XNN, XNZ = G.XNZ, W = G.nodeW, nb = 0, rk = PT.coreRated[c]*1000, cD = G.priD();
  const gc = G.graphCellOf(cD), kg = PT.coreGraphKg[c];
  check(name + ": the drawing has blocks, and the tick carries their temperature", kg > 0 && PT.coreGRk[c] > 0 ? 1 : 0, 1, 0,
    "every drawn block has a temperature of its own, off the drawing, never by preset", {abs:true, note:(kg/1000).toFixed(1) + " t of " + G.MODER[cD.mod].name});
  /* the blocks' share of heat at node k, kW, and the ring's own film, as the tick reads them */
  const gin = k => { const s = coreShareHand(G, c, ST.csNV[nb+k], ST.csNCov[nb+k]), hd = ST.csDecay[c];
    return ST.csPhi[nb+k]*((ST.csHeat[c] - hd)*s.bp + hd*s.bd)*rk*W[k]; };
  const film = k => { const i = (k/XNZ)|0, ch = Math.max(ST.csChW[c*G.XNR+i], 1e-3);
    return Math.max(Math.pow(Math.max(PT.coreFlowK[c]*SX.coreFN[c]*ch, 0), 0.8), PT.coreFilmPool[c]); };
  const gw = (k, T) => W[k]/(1000*(PT.coreGRk[c]/modProp(G, c, T).k + PT.coreGRi[c] + PT.coreGRf[c]/film(k)));
  const H = (T0, T1) => { const N = 64; let s = 0; for(let i=0;i<N;i++) s += modProp(G, c, T0 + (T1 - T0)*(i + 0.5)/N).cp; return s*(T1 - T0)/N; };
  /* the hottest block: every population's own peak rise over its node's water, at the node's own heat and film */
  const hottest = (riMul) => { let hot = 0, at = 0;
    for(let k=0;k<XNN;k++){ const q = gin(k)*1000, kk = modProp(G, c, ST.csNTg[nb+k]).k;
      for(const p of gc.pops){ const w = p.V/gc.V, Ri = p.Rw + p.Rg*(riMul || 1);
        const T = ST.csNTc[nb+k] + q*w/W[k]*(p.max/(kk*p.V) + Ri + p.Rf/film(k));
        if(T > hot){ hot = T; at = k; } } }
    return {T:hot, k:at}; };
  let Tm = 0, Tw = 0; for(let k=0;k<XNN;k++){ Tm += W[k]*ST.csNTg[nb+k]; Tw += W[k]*ST.csNTc[nb+k]; }
  const hot = hottest(), C = T => T - 273.15;
  const tau = kg*modProp(G, c, Tm).cp/(W.reduce((s, w, k) => s + gw(k, ST.csNTg[nb+k]), 0));
  const note = "stack mean " + C(Tm).toFixed(0) + " C over water " + C(Tw).toFixed(0) + " C, hottest block " + C(hot.T).toFixed(0) + " C at node " + hot.k +
    ", tau " + (tau/3600).toFixed(2) + " h; pops " + gc.pops.map(p => (p.tube ? "bored" : "slot") + " " + (p.V).toFixed(1) + " m3").join(", ");
  if(/RBMK/.test(G.COOLANT[cD.cool].tie)){
    check(name + ": hottest block at rating", C(hot.T), 730, 0, "RBMK-1000: 730 C allowed maximum over ~286 C channel water, and it ran near its limit (INSAG-7); the stack averages ~500 C (CAST D5.3, 2016); behaviour band 650-760 C",
      {unit:"C", pass:C(hot.T) >= 650 && C(hot.T) <= 760, gap:ROW_T, note});
    check(name + ": stack mean at rating", C(Tm), 500, 0.15, "CAST D5.3 (2016): the average temperature of the graphite stack during operation was about 500 C", {unit:"C", gap:ROW_T, note});
    const f10 = hottest(0.1);
    check(name + ": fault injected, gap conductance x 10: the hottest-block check fails", C(f10.T) >= 650 && C(f10.T) <= 760 ? 0 : 1, 1, 0,
      "the hottest-block check above must be able to fail", {abs:true, note:"hottest " + C(f10.T).toFixed(0) + " C"});
    check(name + ": the stack's time constant against the real machine's active core", tau/3600, 1184e3*1.75/396/3600, 0.20,
      "RBMK-1000: the active core's 1184 t of graphite (370 kg per MWt of 3200) at ~1.75 kJ/kg/K shedding 5.5 % of 3200 MWt over ~444 K, i.e. 396 kW/K, is a first-order lag of 1.45 h",
      {unit:"h", gap:ROW_T, note}); }
  if(G.COOLANT[cD.cool].fuelInCoolant){
    /* ORNL-TM-378: at 10 MW, fuel nuclear-mean 1213 F and graphite nuclear-mean 1257 F */
    let tg = 0, tc = 0, w = 0; for(let k=0;k<XNN;k++){ const p = ST.csPhi[nb+k]*W[k]; tg += p*ST.csNTg[nb+k]; tc += p*ST.csNTc[nb+k]; w += p; }
    const d = (tg - tc)/w;
    check(name + ": graphite over salt, flux-weighted", d, (1257 - 1213)/1.8, 0,
      "ORNL-TM-378, Temperatures in the MSRE core during steady-state power operation (abstract, via ANL/NSE-23/8): at 10 MW the graphite's nuclear mean 1257 F against the fuel's 1213 F; behaviour: hotter than the salt by tens of K",
      {unit:"K", pass:d > 5 && d < 60, gap:ROW_T, note:note + "; this drawing makes " + (PT.coreRated[c]).toFixed(0) + " MWt against MSRE's 10"}); }
  if(G.COOLANT[cD.cool].tie === "CALDER HALL"){
    check(name + ": stack mean and hottest block at rating", C(Tm), 305, 0,
      "Magnox graphite runs 250 C at the bottom to 360 C at the top (Nucl. Eng. Des. 2013, radiolytic oxidation of Magnox graphite, as cited in this code before)",
      {unit:"C", pass:C(Tm) >= 250 && C(hot.T) <= 360, gap:ROW_T, note});
    const f = (() => { let h = 0; for(let k=0;k<XNN;k++){ const q = gin(k)*1000, kk = modProp(G, c, ST.csNTg[nb+k]).k;
      for(const p of gc.pops){ const w = p.V/gc.V; h = Math.max(h, ST.csNTc[nb+k] + q*w/W[k]*(p.max/(kk*p.V) + p.Rw + p.Rg + 10*p.Rf/film(k))); } } return h; })();
    check(name + ": fault injected, the bare channel's film cut to a tenth: the hottest block leaves the band", C(f) <= 360 ? 0 : 1, 1, 0,
      "the temperature check above must be able to fail", {abs:true, note:"hottest " + C(f).toFixed(0) + " C"}); }

  /* push and release, the core stepped on its own with its heat, flow and inlet held: the question is the
     stack's law, and a drifting plant round it would blur what the tick fed it. The step reads the node's
     heat, void and water before it moves them, and the ring flow weights it leaves behind. */
  const T0 = new Float64Array(XNN), law = new Float64Array(XNN), q = new Float64Array(XNN), Tc0 = new Float64Array(XNN);
  for(let k=0;k<XNN;k++){ ST.csNTg[nb+k] -= 5; T0[k] = law[k] = ST.csNTg[nb+k]; }
  const cs = G.E_CS, heat = ST.csHeat[c], sat = G.satT(PT.coreSat[c], ST.csPCore[c]), mfx = PT.coreFlowK[c]*SX.coreFN[c], fn = Math.max(ST.csFlowNet[c], 1e-3), hIn = G.eNetCoreInH(c);
  const secs = Math.min(tau/10, 6);
  let inOnly = 0;
  let flow = 0, t = 0;
  while(t < secs - 1e-9){
    let h0 = 0;
    for(let k=0;k<XNN;k++){ q[k] = gin(k); Tc0[k] = ST.csNTc[nb+k]; h0 += q[k]; }
    cs[0] = 0.02; cs[1] = heat; cs[2] = sat; cs[3] = 0; cs[4] = mfx; cs[5] = fn; cs[6] = hIn; G.eCoreStep(c); t += 0.02;
    for(let k=0;k<XNN;k++){ const g = gw(k, law[k]), teq = Tc0[k] + q[k]/g;
      law[k] = teq + (law[k] - teq)*Math.exp(-0.02*g/(kg*W[k]*modProp(G, c, law[k]).cp)); }
    flow += (h0 - ST.csGQ[c])*0.02; inOnly += h0*0.02; }
  let dU = 0, got = 0, want = 0;
  for(let k=0;k<XNN;k++){ const T = ST.csNTg[nb+k]; dU += kg*W[k]*H(T0[k], T); got += W[k]*(T - T0[k]); want += W[k]*(law[k] - T0[k]); }
  const P = sc[G.SC_HEAT]*G.P.rated*1000;
  check(name + ": the stack's energy against what crossed it, 5 K push and release", (dU - flow)/(P*secs), 0, 1e-6,
    "first law on the blocks: m int cp dT = int (in - out) dt, cp(T) the row's own", {abs:true, unit:"of the core's heat",
      note:"dU " + (dU/1000).toFixed(2) + " MJ over " + secs.toFixed(1) + " s"});
  check(name + ": fault injected, the heat the blocks hand the water left off the book: the energy check fails", Math.abs((dU - inOnly)/(P*secs)) > 1e-6 ? 1 : 0, 1, 0,
    "the stack energy check above must be able to fail", {abs:true});
  /* the tick steps the lag explicitly, so its rate is off the exact one by dt/(2 tau): that is the tolerance, doubled */
  check(name + ": the stack relaxes on the exact first-order lag", got/want - 1, 0, 0.02/tau,
    "m cp dT/dt = in - UA (T - T_water) solved exactly step by step on the drivers the blocks saw, UA the conduction, gap and film law at the node's own state",
    {abs:true, unit:"of the law", note:"moved " + got.toFixed(4) + " K in " + secs.toFixed(1) + " s; explicit step error dt/(2 tau) " + (0.01/tau).toExponential(2)});
}

if(mode === "coef"){
  const G = load();
  /* thermal utilisation on a homogeneous mixture, by hand: U-235 683.7 b, C 3.5 mb (the book's own figures typed again) */
  { const nd = {C:0.0853, U235:0.0853*1e-4}, b = G.bookOf(nd), want = nd.U235*683.7/(nd.U235*683.7 + nd.C*0.0035);
    check("absorption book: f of a U-235 + graphite mixture against the hand calculation", b.shm/b.sa, want, 1e-9,
      "Lamarsh, Introduction to Nuclear Reactor Theory ch. 6: f = Sa_F/(Sa_F + Sa_M), the same 2200 m/s cross sections", {}); }
  const io = new Float64Array(2), W = G.WESTCOTT;
  const lin = (k, T) => { const t = W.T; let i = 0; while(T > t[i+1]) i++; return W.U235[k][i] + (W.U235[k][i+1] - W.U235[k][i])*(T - t[i])/(t[i+1] - t[i]); };
  let ew = 0; for(const T of [293.15, 573.15]) for(const k of ["ga", "gf"]){ G.westcottA("U235", k, T, io); ew = Math.max(ew, Math.abs(io[0]/lin(k, T) - 1)); }
  check("Westcott g_a and g_f of U-235 at 20 C and 300 C, worst", ew, 0, 0.005,
    "Westcott, AECL-1101 (1960), as reproduced in Lamarsh Table 3.3, typed again; 300 C on the line between 200 and 400 C", {abs:true, unit:"of the value"});
  G.westcottA("U235", "gf", 293.6, io);
  check("Westcott g_f of U-235 at room temperature against ENDF/B-VII.1", io[0], 0.9767, 0.005,
    "Pritychenko & Mughabghab 2012 (arXiv:1208.2879) Table VI, ENDF/B-VII.1 at 293.6 K: 0.9767", {});
  /* pure graphite at 1.70 g/cm3: D off free-atom transport, L2 = D/Sa */
  { const b = G.bookOf(G.numDensAdd({C:1}, 1700, 0, 0, 1, {})), D = 1/(3*b.str), L2 = D/b.sa;
    check("pure graphite: thermal diffusion area at 20 C", L2, 2900, 0.05,
      "reactor graphite L ~ 54 cm (Glasstone & Sesonske; Lamarsh Table 5.2), as commonly quoted, not read at source; the book's own 3.5 mb and 4.73 b",
      {unit:"cm2", note:"D " + D.toFixed(3) + " cm, L " + Math.sqrt(L2).toFixed(1) + " cm"}); }
  const coefOf = pre => { G.plantPreset(pre); G.buildLayout(); return G.modCoefOf(G.priD()); };
  const parts = k => "spectral eta " + k.eta.toFixed(2) + ", utilisation " + k.util.toFixed(2) + ", leakage " + k.leak.toFixed(2) + " pcm/K; f " + k.f.toFixed(3) +
    ", cell L2 " + k.L2.toFixed(0) + " cm2, B2 " + k.B2.toExponential(2) + " /cm2, blocks' share of moderation " + k.share.toFixed(2) + ", thermal chain " + k.mth.toFixed(2) +
    ", neutron temperature " + k.Tn.toFixed(0) + " K; the coolant's own spectral share " + k.cool.toFixed(2) + " pcm/K, wired nowhere";
  const MSRE = "IRPhE MSRE benchmark (2021) as presented by Tazreiter (SAMOSAFER 2022): measured isothermal total -13.14 +- 0.36 pcm/K, measured fuel (Doppler + salt density) -8.8 +- 4.1, leaving the graphite -4.3; Haubenreich & Engel, Nucl. Appl. Tech. 8 (1970); fresh U-235, the clean comparator";
  const m = coefOf(6);
  check("MSRE: the blocks' temperature coefficient", m.aG, -4.3, 0, MSRE,
    {unit:"pcm/K", pass:m.aG < 0 && m.aG <= -4.3/2 && m.aG >= -4.3*2, gap:ROW_C, note:parts(m)});
  { const src = G.modCoefOf.toString(), wsrc = G.westcottA.toString();
    inBundle("westcottA = function(nuc, key, T, o){ o[0] = 1; o[1] = 0; };");
    const g1 = coefOf(6);
    inBundle("westcottA = " + wsrc + ";");
    check("fault injected, every g-factor 1 (pure 1/v fuel): the spectral term vanishes and the MSRE coefficient moves", g1.eta === 0 && g1.util === 0 && Math.abs(g1.aG - m.aG) > 1e-9 ? 1 : 0, 1, 0,
      "the MSRE check above reads the spectral term", {abs:true, note:"aG " + g1.aG.toFixed(3) + " against " + m.aG.toFixed(3)});
    inBundle("modCoefOf = " + src.replace("B2=Math.pow(2.405/R,2)+Math.pow(Math.PI/Hc,2)", "B2=0") + ";");
    const b0 = coefOf(6);
    inBundle("modCoefOf = " + src + ";");
    check("fault injected, buckling x 0: the leakage term vanishes and the MSRE coefficient moves", b0.leak === 0 && Math.abs(b0.aG - m.aG) > 1e-9 ? 1 : 0, 1, 0,
      "the MSRE check above reads the leakage term", {abs:true, note:"aG " + b0.aG.toFixed(3) + " against " + m.aG.toFixed(3)}); }
  const r = coefOf(5);
  check("RBMK-1000: the blocks' temperature coefficient against INSAG-7", r.aG, 6.0, 0,
    "INSAG-7 annex I table II-I: +6e-5 per K, measured on a burnt core with plutonium in it; this fuel is fresh (the no-burnup cut), so the stated distance is that cut's, never chased",
    {unit:"pcm/K", pass:false, gap:ROW_C, note:parts(r)});
  const k = coefOf(7);
  check("CALDER HALL: the blocks' temperature coefficient on fresh natural uranium, sign", k.aG, 0, 0,
    "a fresh natural-uranium Magnox core's graphite coefficient is negative and turns positive as plutonium builds in (as commonly quoted, not read at source); behaviour: the sign",
    {unit:"pcm/K", pass:k.aG < 0, gap:ROW_C, note:parts(k)});
}
