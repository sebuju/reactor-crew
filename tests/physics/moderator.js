"use strict";
// chunks: props prim s5 s6 s7 coef cps spread
/* the solid moderator: props = every MODER row's cp(T) and k(T) against its source; prim = the block conduction primitive and the gap gas; s<n> = preset n's stack, its energy, its lag and its temperatures against its namesake; coef = the blocks' temperature coefficient law; cps = the cooled control channel's geometry, heat path and gamma cell; spread = the bored stack's conduction between nodes */
const {check, load, commissionPreset, coreShareHand, modProp, inBundle, watch} = require("./lib.js");
const mode = process.argv[2];
const ROW_T = "graphite temperature", ROW_C = "moderator temperature coefficient";
/* the bored stack's spread written again, W/K: phi smears the bores; radially a pitch of block and one column gap (40 % He in N2, grey graphite at 0.8) in series, axially the blocks alone */
const spreadHand = (G, c, cD, gapMul) => {
  const v = G.latVols(cD), p = cD.lat.pitch, R = G.latM(cD).dia/2, H = cD.lat.len, dr = R/G.XNR, dz = H/G.XNZ;
  const phi = v.mod/((v.nF + v.nM + v.nC)*p*p), Ts = G.graphCellOf(cD).spread.T;
  const Rg = 1/(G.gasMixK(0.4, Ts)/(G.colGapMm(cD)/1000*(gapMul || 1)) + 5.670374419e-8*2*Ts*Ts*2*Ts/(2/0.8 - 1)), k = T => modProp(G, c, T).k;
  return {phi, Rg, radial:(i, Ta, Tb) => phi*2*Math.PI*(i + 1)*dr*dz/dr*p/(p/k((Ta + Tb)/2) + Rg),
          axial:(i, Ta, Tb) => phi*k((Ta + Tb)/2)*Math.PI*(2*i + 1)*dr*dr/dz}; };
/* each node's conductance to its outer and upper neighbour at a field, times a lump's share */
const spreadG = (G, S, T, w, gR, gZ) => { const NR = G.XNR, NZ = G.XNZ;
  for(let i=0;i<NR;i++) for(let j=0;j<NZ;j++){ const k = i*NZ + j;
    gR[k] = i < NR-1 ? w*S.radial(i, T[k], T[k+NZ]) : 0; gZ[k] = j < NZ-1 ? w*S.axial(i, T[k], T[k+1]) : 0; } };
const spreadNet = (G, T, gR, gZ, net, gs) => { const NZ = G.XNZ; net.fill(0); if(gs) gs.fill(0);
  for(let k=0;k<G.XNN;k++) for(let d=0;d<2;d++){ const m = d ? k + 1 : k + NZ, g = d ? gZ[k] : gR[k]; if(!(g > 0)) continue;
    const q = g*(T[m] - T[k]); net[k] += q; net[m] -= q; if(gs){ gs[k] += g; gs[m] += g; } } };

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
if(/^s\d+$/.test(mode)){
  const pre = +mode.slice(1), G = commissionPreset(pre), PT = G.PT, ST = G.ST, SX = G.SX, sc = ST.sc, name = G.PLANTPRE[pre][0];
  const c = 0, XNN = G.XNN, XNZ = G.XNZ, W = G.nodeW, nb = 0, rk = PT.coreRated[c]*1000, cD = G.priD();
  const gc = G.graphCellOf(cD), kg = PT.coreGraphKg[c], kgC = PT.coreGraphKgC[c], wC = kgC > 0 ? kgC/(kg + kgC) : 0, wet = PT.coreCpsWet[c];
  check(name + ": the drawing has blocks, and the tick carries their temperature", kg > 0 && PT.coreGRk[c] > 0 ? 1 : 0, 1, 0,
    "every drawn block has a temperature of its own, off the drawing, never by preset", {abs:true, note:(kg/1000).toFixed(1) + " t of " + G.MODER[cD.mod].name + (kgC > 0 ? ", " + (kgC/1000).toFixed(1) + " t round the control channels" : "")});
  /* the blocks' share of heat at node k, kW, the control channels' direct share, and the ring's own film, as the tick reads them */
  const share = k => coreShareHand(G, c, ST.csNV[nb+k], ST.csNCov[nb+k]);
  const gin = k => { const s = share(k), hd = ST.csDecay[c]; return (ST.csPhi[nb+k]*(ST.csHeat[c] - hd)*s.bp + ST.csNDw[nb+k]/W[k]*hd*s.bd)*rk*W[k]; };
  const gch = k => { const s = share(k), hd = ST.csDecay[c]; return (ST.csPhi[nb+k]*(ST.csHeat[c] - hd)*s.cp + ST.csNDw[nb+k]/W[k]*hd*s.cd)*rk*W[k]; };
  const film = k => { const i = (k/XNZ)|0, ch = Math.max(ST.csChW[c*G.XNR+i], 1e-3);
    return Math.max(Math.pow(Math.max(PT.coreFlowK[c]*SX.coreFN[c]*ch, 0), 0.8), PT.coreFilmPool[c]); };
  const key = PT.coreCpsKey[c], filmC = () => PT.coreCpsW0[c] > 0 && key >= 0 ? Math.max(Math.pow(Math.abs(SX.netRunW[key])/PT.coreCpsW0[c], 0.8), PT.coreFilmPool[c]) : PT.coreFilmPool[c];
  const Tch = () => PT.coreCpsA[c] >= 0 ? (G.eNodeT(PT.coreCpsA[c]) + G.eNodeT(PT.coreCpsB[c]))/2 : G.CPS_T;
  /* the conductances written out again: annulus over k, gap, wall and film in series; the column gap sideways, half a column each side */
  const gw = (k, T) => W[k]/(1000*(PT.coreGRk[c]/modProp(G, c, T).k + PT.coreGRi[c] + PT.coreGRf[c]/film(k)));
  const gwC = (k, T) => kgC > 0 ? W[k]/(1000*(PT.coreGRkC[c]/modProp(G, c, T).k + PT.coreGRiC[c] + PT.coreGRfC[c]/filmC())) : 0;
  const gs = (k, TF, TC) => kgC > 0 && PT.coreGRkS[c] > 0 ? W[k]/(1000*(PT.coreGRkS[c]/modProp(G, c, (TF + TC)/2).k + PT.coreGRgS[c])) : 0;
  const H = (T0, T1) => { const N = 64; let s = 0; for(let i=0;i<N;i++) s += modProp(G, c, T0 + (T1 - T0)*(i + 0.5)/N).cp; return s*(T1 - T0)/N; };
  /* the hottest block: every population's mean over its node's water on the heat the lump hands that water, and its own peak over its mean on the heat born in it */
  const hottest = (riMul) => { let hot = 0, at = 0;
    for(let k=0;k<XNN;k++){ const q = gin(k)*1000*(1 - wC), kk = modProp(G, c, ST.csNTg[nb+k]).k, qo = gw(k, ST.csNTg[nb+k])*(ST.csNTg[nb+k] - ST.csNTc[nb+k])*1000;
      for(const p of gc.pops){ const w = p.V/gc.V, Ri = p.Rw + p.Rg*(riMul || 1);
        const T = ST.csNTc[nb+k] + (qo*w*(p.mean/(kk*p.V) + Ri + p.Rf/film(k)) + q*w*(p.max - p.mean)/(kk*p.V))/W[k];
        if(T > hot){ hot = T; at = k; } }
      if(kgC > 0){ const ch = gc.ch, kc = modProp(G, c, ST.csNTgC[nb+k]).k, qc = gin(k)*1000*wC + (wet ? 0 : gch(k)*1000);
        const T = ST.csNTgC[nb+k] + qc/W[k]*(ch.max - ch.mean)/(kc*ch.V);
        if(T > hot){ hot = T; at = k; } } }
    return {T:hot, k:at}; };
  let Tm = 0, Tw = 0, TmC = 0; for(let k=0;k<XNN;k++){ Tm += W[k]*ST.csNTg[nb+k]; TmC += W[k]*ST.csNTgC[nb+k]; Tw += W[k]*ST.csNTc[nb+k]; }
  const Tmean = Tm*(1 - wC) + TmC*wC;
  const hot = hottest(), C = T => T - 273.15;
  let off = "";
  if(PT.coreSpP[c] > 0){ const p = PT.coreSpP[c]; PT.coreSpP[c] = 0; G.eCoreRestConverge(c);
    let m = 0; for(let k=0;k<XNN;k++) m += W[k]*(ST.csNTg[nb+k]*(1 - wC) + ST.csNTgC[nb+k]*wC);
    const h0 = hottest(); off = "; spread off: hottest " + C(h0.T).toFixed(0) + " C at node " + h0.k + ", mean " + C(m).toFixed(0) + " C";
    PT.coreSpP[c] = p; G.eCoreRestConverge(c); }
  /* the lag the whole stack sheds on: the fuel columns' own path in parallel with the channel columns' reached sideways */
  let ua = 0; for(let k=0;k<XNN;k++){ const a = gw(k, ST.csNTg[nb+k]), b = gwC(k, ST.csNTgC[nb+k]), s = gs(k, ST.csNTg[nb+k], ST.csNTgC[nb+k]);
    ua += a + (b > 0 && s > 0 ? b*s/(b + s) : 0); }
  const tau = (kg + kgC)*modProp(G, c, Tmean).cp/ua;
  const note = "stack mean " + C(Tmean).toFixed(0) + " C over water " + C(Tw).toFixed(0) + " C" + (kgC > 0 ? " (fuel columns " + C(Tm).toFixed(0) + ", channel columns " + C(TmC).toFixed(0) + ")" : "") +
    ", hottest block " + C(hot.T).toFixed(0) + " C at node " + hot.k + off + ", tau " + (tau/3600).toFixed(2) + " h; pops " + gc.pops.map(p => (p.tube ? "bored" : "slot") + " " + (p.V).toFixed(1) + " m3").join(", ");
  if(/RBMK/.test(G.COOLANT[cD.cool].tie)){
    check(name + ": hottest block at rating", C(hot.T), 730, 0, "RBMK-1000: 730 C allowed maximum over ~286 C channel water, and it ran near its limit (INSAG-7); the stack averages ~500 C (CAST D5.3, 2016); RBMK-1500's stack limit 760 C (OSTI ETDEWEB 308442, read); behaviour band 650-760 C",
      {unit:"C", pass:C(hot.T) >= 650 && C(hot.T) <= 760, gap:ROW_T, note});
    check(name + ": stack mean at rating", C(Tmean), 500, 0.15, "CAST D5.3 (2016): the average temperature of the graphite stack during operation was about 500 C", {unit:"C", gap:ROW_T, note});
    const f10 = hottest(0.1);
    check(name + ": fault injected, gap conductance x 10: the hottest-block check fails", C(f10.T) >= 650 && C(f10.T) <= 760 ? 0 : 1, 1, 0,
      "the hottest-block check above must be able to fail", {abs:true, note:"hottest " + C(f10.T).toFixed(0) + " C"});
    check(name + ": the stack's time constant against the real machine's active core", tau/3600, 1184e3*1.75/396/3600, 0.20,
      "RBMK-1000: the active core's 1184 t of graphite (370 kg per MWt of 3200) at ~1.75 kJ/kg/K shedding 5.5 % of 3200 MWt over ~444 K, i.e. 396 kW/K, is a first-order lag of 1.45 h",
      {unit:"h", gap:ROW_T, note});
    if(kgC > 0) check(name + ": the control channels' circuit takes a small share of core heat at rating", ST.csCQ[c]/rk, 0.01, 0,
      "Kaliatka et al., STNI 2008 (read): the RBMK-1500's control channel circuit can remove up to 28.5 MW, 0.6 % of its 4800 MWt (as commonly quoted); behaviour: under 1 %",
      {unit:"of core heat", pass:ST.csCQ[c]/rk > 0 && ST.csCQ[c]/rk < 0.01, note:(ST.csCQ[c]/1000).toFixed(2) + " MW; channel water " + C(Tch()).toFixed(0) + " C mean"}); }
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
      "the temperature check above must be able to fail", {abs:true, note:"hottest " + C(f).toFixed(0) + " C"});
    /* the same law on the real machine's brick: an 8 in square bored 3.95 in for its channel, cooled on the bore by the drawn gas's own film, at the heat per unit graphite the drawing gives; its rise over the gas at each node */
    const brick = scale => { const s = 8*0.0254, d = 3.95*0.0254, A = s*s - Math.PI/4*d*d, ri = d/2, ro = Math.sqrt(A/Math.PI + ri*ri), io = new Float64Array(2);
      G.blockRiseA(ri, ro, true, io); let rise = 0, gas = 0;
      for(let k=0;k<XNN;k++){ const q3 = gin(k)*1000/(gc.V*W[k]), T0 = ST.csNTc[nb+k], kk = modProp(G, c, T0 + 50).k;
        const r = q3*A/(G.COOLANT[cD.cool].hFilm*film(k)*Math.PI*d)*scale + q3*io[1]/kk;
        if(T0 + r > gas + rise){ rise = r; gas = T0; } }
      return {rise, gas}; };
    const rb = brick(1), rbF = brick(100);
    check(name + ": the same heat law on the real brick, its hottest rise over its own gas", rb.rise, 360 - 336, 0,
      "Calder Hall's 8 in brick bored 3.95 in (Nuclear Engineering, Dec. 1956, as this code's ARCHPRE row cites it; not read at source in this session), cooled by the drawn CO2's own film; the published graphite top of 360 C over the 336 C outlet gas (as commonly quoted) is tens of K; behaviour: under 60 K",
      {unit:"K", pass:rb.rise > 0 && rb.rise < 60, note:"at gas " + C(rb.gas).toFixed(0) + " C, the drawn whole-slot blocks' hottest " + C(hot.T).toFixed(0) + " C: the stack's distance from the band is the gas it stands in"});
    check(name + ": fault injected, the brick's film cut to a hundredth: the real-brick check fails", rbF.rise > 0 && rbF.rise < 60 ? 0 : 1, 1, 0,
      "the real-brick check above must be able to fail", {abs:true, note:"rise " + rbF.rise.toFixed(0) + " K"}); }

  /* the channel water gets what the tick booked to it, the last core step's channel heat, and only that */
  if(wet){ const q0 = ST.csCQ[c]; G.step(0.02); const a = PT.coreCpsA[c], b = PT.coreCpsB[c];
    const got = SX.tSrc[a] - SX.tMetQ[a] + SX.tSrc[b] - SX.tMetQ[b], want = q0;
    check(name + ": heat handed the control channels' water against the core's channel heat", Math.abs(got - want)/rk, 0, 1e-9,
      "the transport book: every kW the core books to the channels lands in their water", {abs:true, unit:"of core heat", note:(got/1000).toFixed(3) + " MW"}); }

  /* push and release, the core stepped on its own with its heat, flow and inlet held: the question is the
     stack's law, and a drifting plant round it would blur what the tick fed it. The step reads the node's
     heat, void and water before it moves them, and the ring flow weights it leaves behind. Every node's two
     lumps, their water, the sideways gap and the spread are one linear system over each step, integrated by
     RK4 at a twentieth of the tick's step. */
  const F64 = () => new Float64Array(XNN);
  const T0 = F64(), T0C = F64(), law = F64(), lawC = F64(), q = F64(), qc = F64(), Tc0 = F64();
  const gFa = F64(), gCa = F64(), gSa = F64(), mFa = F64(), mCa = F64(), qFa = F64(), qCa = F64();
  const rF = F64(), zF = F64(), rC = F64(), zC = F64(), sF = F64(), sC = F64(), dF = F64(), dC = F64(), sum = F64();
  const S = PT.coreSpP[c] > 0 ? spreadHand(G, c, cD) : null;
  const freeze = (xF, xC) => { if(S){ spreadG(G, S, xF, (1 - wC)/1000, rF, zF); spreadG(G, S, xC, wC/1000, rC, zC); } };
  let spOn = true;
  const deriv = (xF, xC, oF, oC) => {
    if(S && spOn){ spreadNet(G, xF, rF, zF, sF); spreadNet(G, xC, rC, zC, sC); } else { sF.fill(0); sC.fill(0); }
    for(let k=0;k<XNN;k++){ const x = gSa[k]*(xF[k] - xC[k]);
      oF[k] = (qFa[k] - gFa[k]*(xF[k] - Tc0[k]) - x + sF[k])/mFa[k];
      oC[k] = mCa[k] > 0 ? (qCa[k] - gCa[k]*(xC[k] - TW) + x + sC[k])/mCa[k] : 0; } };
  const K = [[F64(), F64()], [F64(), F64()], [F64(), F64()], [F64(), F64()]], yF = F64(), yC = F64();
  const rk4 = (xF, xC, h) => { const a = [0, h/2, h/2, h];
    for(let s=0;s<4;s++){ for(let k=0;k<XNN;k++){ yF[k] = xF[k] + (s ? a[s]*K[s-1][0][k] : 0); yC[k] = xC[k] + (s ? a[s]*K[s-1][1][k] : 0); }
      deriv(yF, yC, K[s][0], K[s][1]); }
    for(let k=0;k<XNN;k++){ xF[k] += h/6*(K[0][0][k] + 2*K[1][0][k] + 2*K[2][0][k] + K[3][0][k]); xC[k] += h/6*(K[0][1][k] + 2*K[1][1][k] + 2*K[2][1][k] + K[3][1][k]); } };
  for(let k=0;k<XNN;k++){ ST.csNTg[nb+k] -= 5; T0[k] = law[k] = ST.csNTg[nb+k]; if(kgC > 0){ ST.csNTgC[nb+k] -= 5; } T0C[k] = lawC[k] = ST.csNTgC[nb+k]; }
  const cs = G.E_CS, heat = ST.csHeat[c], sat = G.satT(PT.coreSat[c], ST.csPCore[c]), mfx = PT.coreFlowK[c]*SX.coreFN[c], fn = Math.max(ST.csFlowNet[c], 1e-3), hIn = G.eNetCoreInH(c);
  const TW = Tch();
  let tauMin = tau;
  freeze(T0, T0C); spreadNet(G, T0, rF, zF, sF, dF); spreadNet(G, T0C, rC, zC, sC, dC);
  for(let k=0;k<XNN;k++){ const s = gs(k, T0[k], T0C[k]);
    tauMin = Math.min(tauMin, kg*W[k]*modProp(G, c, T0[k]).cp/(gw(k, T0[k]) + s + dF[k]));
    if(kgC > 0) tauMin = Math.min(tauMin, kgC*W[k]*modProp(G, c, T0C[k]).cp/(gwC(k, T0C[k]) + s + dC[k])); }
  const secs = Math.min(tau/10, 6);
  /* the same march with the spread left out of the law, to see whether this window can tell it */
  const lawX = Float64Array.from(T0), lawXC = Float64Array.from(T0C);
  let inOnly = 0, flow = 0, flowF = 0, flowC = 0, flowFx = 0;
  watch(G, {cap:secs + 0.02, event:t => t >= secs - 1e-9 ? "window done" : "", step:() => {
    let h0 = 0, qsum = 0, dirW = 0;
    for(let k=0;k<XNN;k++){ q[k] = gin(k); qc[k] = wet ? 0 : gch(k); Tc0[k] = ST.csNTc[nb+k]; h0 += q[k] + qc[k];
      qsum += gs(k, ST.csNTg[nb+k], ST.csNTgC[nb+k])*(ST.csNTg[nb+k] - ST.csNTgC[nb+k]);
      if(wet) dirW += gch(k); }
    let fQ = 0; for(let k=0;k<XNN;k++) fQ += q[k]*(1 - wC);
    if(S){ for(let k=0;k<XNN;k++){ yF[k] = ST.csNTg[nb+k]; yC[k] = ST.csNTgC[nb+k]; } freeze(yF, yC); spreadNet(G, yF, rF, zF, sF); spreadNet(G, yC, rC, zC, sC); }
    let spF = 0, spC = 0; if(S) for(let k=0;k<XNN;k++){ spF += sF[k]; spC += sC[k]; }
    cs[0] = 0.02; cs[1] = heat; cs[2] = sat; cs[3] = 1; cs[4] = mfx; cs[5] = fn; cs[6] = hIn; G.eCoreStep(c);
    for(const [xF, xC, on] of [[law, lawC, true], [lawX, lawXC, false]]){
      for(let k=0;k<XNN;k++){ gFa[k] = gw(k, xF[k]); mFa[k] = kg*W[k]*modProp(G, c, xF[k]).cp; qFa[k] = q[k]*(1 - wC);
        gCa[k] = gwC(k, xC[k]); gSa[k] = gs(k, xF[k], xC[k]); mCa[k] = kgC > 0 ? kgC*W[k]*modProp(G, c, xC[k]).cp : 0; qCa[k] = q[k]*wC + qc[k]; }
      freeze(xF, xC); spOn = on;
      for(let n=0;n<20;n++) rk4(xF, xC, 0.001); }
    flowF += (fQ - ST.csGQ[c] - qsum + spF)*0.02; flowFx += (fQ - ST.csGQ[c] + spF)*0.02;
    flowC += (h0 - fQ + qsum + spC - (ST.csCQ[c] - dirW))*0.02; flow += (h0 + spF + spC - ST.csGQ[c] - (ST.csCQ[c] - dirW))*0.02; inOnly += h0*0.02; }});
  let dU = 0, dUF = 0, dUC = 0, got = 0, want = 0, gotC = 0, wantC = 0, eN = 0, eX = 0, mv = 0;
  for(let k=0;k<XNN;k++){ const T = ST.csNTg[nb+k], TC = ST.csNTgC[nb+k];
    dUF += kg*W[k]*H(T0[k], T); got += W[k]*(T - T0[k]); want += W[k]*(law[k] - T0[k]);
    eN = Math.max(eN, Math.abs(T - law[k])); eX = Math.max(eX, Math.abs(T - lawX[k])); mv = Math.max(mv, Math.abs(law[k] - T0[k]));
    if(kgC > 0){ dUC += kgC*W[k]*H(T0C[k], TC); gotC += W[k]*(TC - T0C[k]); wantC += W[k]*(lawC[k] - T0C[k]);
      eN = Math.max(eN, Math.abs(TC - lawC[k])); eX = Math.max(eX, Math.abs(TC - lawXC[k])); mv = Math.max(mv, Math.abs(lawC[k] - T0C[k])); } }
  dU = dUF + dUC;
  const P = sc[G.SC_HEAT]*G.P.rated*1000;
  check(name + ": the stack's energy against what crossed it, 5 K push and release", (dU - flow)/(P*secs), 0, 1e-6,
    "first law on the blocks: m int cp dT = int (in - out) dt, cp(T) the row's own" + (kgC > 0 ? "; out to the fuel water and to the channel water" : ""), {abs:true, unit:"of the core's heat",
      note:"dU " + (dU/1000).toFixed(2) + " MJ over " + secs.toFixed(1) + " s"});
  check(name + ": fault injected, the heat the blocks hand the water left off the book: the energy check fails", Math.abs((dU - inOnly)/(P*secs)) > 1e-6 ? 1 : 0, 1, 0,
    "the stack energy check above must be able to fail", {abs:true});
  if(kgC > 0){
    check(name + ": the fuel columns' own energy, the sideways heat on the book", (dUF - flowF)/(P*secs), 0, 1e-6,
      "first law on the fuel columns alone: in, less the fuel water's, less what crosses the column gap", {abs:true, unit:"of the core's heat"});
    check(name + ": fault injected, the sideways heat left off the fuel columns' book: the check fails", Math.abs((dUF - flowFx)/(P*secs)) > 1e-6 ? 1 : 0, 1, 0,
      "the fuel columns' energy check above must be able to fail", {abs:true});
    check(name + ": the channel columns relax on the coupled law", gotC/wantC - 1, 0, 0.02/tauMin,
      "the fuel and channel columns' linear system integrated by RK4 at dt/20 on the drivers the blocks saw", {abs:true, unit:"of the law",
        note:"moved " + gotC.toFixed(4) + " K; fastest lump tau " + tauMin.toFixed(0) + " s"}); }
  /* the tick steps the lag explicitly, so its rate is off the exact one by dt/(2 tau): that is the tolerance, doubled */
  const LAW = "m cp dT/dt = in - UA (T - T_water) - sideways + spread, every node and lump at once, by RK4 at dt/20 on the drivers the blocks saw, UA the conduction, gap and film law at the node's own state";
  check(name + ": the stack relaxes on the coupled law, stack mean", got/want - 1, 0, 0.02/tauMin, LAW,
    {abs:true, unit:"of the law", note:"moved " + got.toFixed(4) + " K in " + secs.toFixed(1) + " s; explicit step error dt/(2 tau) " + (0.01/tauMin).toExponential(2)});
  check(name + ": the stack relaxes on the coupled law, worst node", eN/mv, 0, 0.02/tauMin, LAW,
    {abs:true, unit:"of the largest move", note:"largest move " + mv.toFixed(4) + " K" + (S ? "; the law with the spread left out reads " + (eX/mv).toExponential(2) : "; no spread: a bare-slot stack")});
  if(S) check(name + ": fault injected, the spread left out of the law: the worst-node check fails", eX/mv > 0.02/tauMin ? 1 : 0, 1, 0,
    "the worst-node check above must be able to see the spread", {abs:true, note:"worst " + (eX/mv).toExponential(2) + " against " + (0.02/tauMin).toExponential(2)});
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
  /* pure graphite L2 from 22 to 600 C on the law's own d ln L2/dT, expansion in */
  { const a = G.MODER[0].alpha, T1 = 295.15, T2 = 873.15, N = 2000; let ln = 0;
    for(let i=0;i<N;i++){ const T = T1 + (T2 - T1)*(i + 0.5)/N; ln += (G.lnL2dT(T, 0, 0) + 6*a)*(T2 - T1)/N; }
    check("pure graphite: L2 at 600 C over L2 at 22 C", Math.exp(ln), Math.sqrt(T2/T1), 0.03,
      "Lloyd, Clayton & Richey, Nucl. Sci. Eng. 4 (1958), abstract read at OSTI 4297573: the diffusion length from 22 to 600 C agrees with a 1/v cross section and a constant transport mean free path, so L2 goes as sqrt(T)",
      {unit:"x", note:"expansion alone " + Math.exp(6*a*(T2 - T1)).toFixed(4) + "x"}); }
  const MSRE = "IRPhE MSRE benchmark (2021) as presented by Tazreiter (SAMOSAFER 2022): measured isothermal total -13.14 +- 0.36 pcm/K, measured fuel (Doppler + salt density) -8.8 +- 4.1, leaving the graphite -4.3; Haubenreich & Engel, Nucl. Appl. Tech. 8 (1970); fresh U-235, the clean comparator";
  /* the real MSRE's core, built in memory on preset 6 near its own pitch, the slot count that lands the graphite fraction: matrix 1.40 m across (55.25 in, as commonly quoted; ORNL/TM-2019/1359, read 23/09/26: core barrel 56 in OD, about 64 in high), 1.63 m high, 22.5 % salt */
  const msreCell = () => { G.plantPreset(6); G.buildLayout(); const c = G.priD(), L = c.lat, LQ = G.LQ, qs = [];
    for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++) qs.push([Math.hypot(u + 0.5, v + 0.5), u*LQ + v]);
    qs.sort((p, q) => p[0] - q[0]);
    const n0 = Math.round(Math.PI/4*Math.pow(0.70/L.pitch, 2)), fr = n => Math.floor(0.775*n + 1e-9)/n;
    let nS = n0; for(let n=n0;n<n0+5;n++) if(Math.abs(fr(n) - 0.775) < Math.abs(fr(nS) - 0.775)) nS = n;
    let acc = 0;
    L.slot.fill(G.L_EMPTY); L.rod.fill(-1);
    for(const [, q] of qs.slice(0, nS)){ acc += 0.775; if(acc >= 1){ L.slot[q] = G.L_MOD; acc -= 1; } else L.slot[q] = G.L_FUEL; }
    L.pitch = 0.70/Math.sqrt(4*nS/Math.PI); L.len = 1.63; G.latRevolve(c); return c; };
  const mc = msreCell(), mv = G.latVols(mc), mM = G.latM(mc), gf = mv.mod/((mv.nF + mv.nM)*mc.lat.pitch*mc.lat.pitch);
  check("the real-size MSRE cell: graphite volume fraction", gf, 0.775, 0.02,
    "ORNL-TM-728 (Robertson 1965), as commonly quoted: 22.5 % salt by volume; ORNL/TM-2019/1359 (read): 1140 channels of 0.446 in2 between 2 in stringers", {note:"diameter " + mM.dia.toFixed(3) + " m, height " + mM.hgt.toFixed(3) + " m"});
  const m = G.modCoefOf(mc);
  check("the real-size MSRE cell: the blocks' temperature coefficient", m.aG, -4.3, 0, MSRE,
    {unit:"pcm/K", pass:m.aG < 0 && m.aG <= -4.3/2 && m.aG >= -4.3*2, note:parts(m) + "; expansion " + m.grow.toFixed(3) + " pcm/K; the MSRE preset (909 MWt in a 2.47 m core, graphite one slot in four) reads " + coefOf(6).aG.toFixed(2) + " pcm/K, BUILD"});
  /* d ln L2/dT from expansion against the cell's book taken again at blocks thinned by (1 + a dT)^-3 */
  { const c = msreCell(), row = G.MODER[c.mod], a = row.alpha, dT = 10, rho0 = row.dens;
    const L2 = () => { const b = G.latBook(c, 0); return (1/(3*b.str))/b.sa; }, k0 = G.modCoefOf(c), l0 = L2();
    row.dens = rho0/Math.pow(1 + a*dT, 3); const l1 = L2(); row.dens = rho0;
    check("the real-size MSRE cell: d ln L2/dT from the blocks' expansion against the book taken again with them thinned", Math.log(l1/l0)/dT, 3*a*(k0.wtr + k0.wa), 0.01,
      "the blocks' atoms go as (1 + a dT)^-3 (linear expansion, isotropic); L2 = 1/(3 Str Sa)", {unit:"1/K", note:"blocks' shares of Str " + k0.wtr.toFixed(3) + ", of Sa " + k0.wa.toFixed(3)}); }
  { const row = G.MODER[mc.mod], a = row.alpha; row.alpha = 0; const z = G.modCoefOf(msreCell()); row.alpha = a;
    check("fault injected, graphite's expansion x 0: the MSRE coefficient moves", z.grow === 0 && Math.abs(z.aG - m.aG) > 1e-6 ? 1 : 0, 1, 0,
      "the MSRE check above reads the expansion term", {abs:true, note:"aG " + z.aG.toFixed(3) + " against " + m.aG.toFixed(3)}); }
  { const src = G.lnL2dT.toString();
    inBundle("lnL2dT = function(T,f,dA){ return -f*dA; };");
    let ln = 0; for(let i=0;i<2000;i++){ const T = 295.15 + 578*(i + 0.5)/2000; ln += G.lnL2dT(T, 0, 0)*578/2000; }
    inBundle("lnL2dT = " + src + ";");
    check("fault injected, the 1/v term dropped: the graphite L2 check fails", Math.abs(Math.exp(ln)/Math.sqrt(873.15/295.15) - 1) > 0.03 ? 1 : 0, 1, 0, "the L2 check above must be able to fail", {abs:true}); }
  { const src = G.modCoefOf.toString(), wsrc = G.westcottA.toString();
    inBundle("westcottA = function(nuc, key, T, o){ o[0] = 1; o[1] = 0; };");
    const g1 = G.modCoefOf(msreCell());
    inBundle("westcottA = " + wsrc + ";");
    check("fault injected, every g-factor 1 (pure 1/v fuel): the spectral term vanishes and the MSRE coefficient moves", g1.eta === 0 && g1.util === 0 && Math.abs(g1.aG - m.aG) > 1e-9 ? 1 : 0, 1, 0,
      "the MSRE check above reads the spectral term", {abs:true, note:"aG " + g1.aG.toFixed(3) + " against " + m.aG.toFixed(3)});
    inBundle("modCoefOf = " + src.replace("B2=Math.pow(2.405/R,2)+Math.pow(Math.PI/Hc,2)", "B2=0") + ";");
    const b0 = G.modCoefOf(msreCell());
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

/* the cooled control channel, on the RBMK-1000's drawing: its geometry closes, its heat path is the series law written again, and its gamma cell conserves */
if(mode === "cps"){
  const G = load(); G.plantPreset(5); G.buildLayout();
  const c = G.priD(), L = c.lat, p = L.pitch, H = L.len, Q = G.LAT_QUAD, v = G.latVols(c), name = G.PLANTPRE[5][0];
  check(name + ": the drawing has control channels, and they are piped", v.nC > 0 && G.cpsWet(c) ? 1 : 0, 1, 0, "INSAG-7: the RBMK's control rods run in channels of their own cooled by an independent water circuit", {abs:true, note:v.nC*Q + " channels"});
  /* every slot kind's own pieces add back to its square */
  { const R = G.heatCellOf(c, 0, 0), cell = p*p, nF = v.nF, nC = v.nC;
    const fuelSlot = (R.vol[G.HS_FUEL] + R.vol[G.HS_CLAD] + R.vol[G.HS_COOL] + R.vol[G.HS_TUBE])/nF + G.latBlockA(c);
    const b = G.cpsBoreMm(c)/1000, t = G.cpsWallMm(c)/1000, chanSlot = (v.chanV + v.chanTube)/nC + (cell - Math.PI/4*(b + 2*t)*(b + 2*t));
    const blocks = v.mod - v.nM*cell - nF*G.latBlockA(c) - nC*(cell - Math.PI/4*(b + 2*t)*(b + 2*t));
    check(name + ": a fuel slot's and a channel slot's pieces against the square they fill, worst", Math.max(Math.abs(fuelSlot/cell - 1), Math.abs(chanSlot/cell - 1), Math.abs(blocks/cell)), 0, 1e-12,
      "geometry: fuel, clad, water, tube and block fill a fuel slot; water, tube and block a channel slot", {abs:true, unit:"of a slot"}); }
  /* the heat path written out again, off the drawn figures */
  { const gc = G.graphCellOf(c), ch = gc.ch, sd = gc.side;
    const b = G.cpsBoreMm(c)/1000, t = G.cpsWallMm(c)/1000, rt = b/2 + t, gap = G.cpsGapMm(c)/1000, ri = rt + gap, nCh = v.nC*Q;
    const A = p*p - Math.PI/4*(b + 2*t)*(b + 2*t), ro = Math.sqrt(A/Math.PI + ri*ri), a2 = ri*ri, b2 = ro*ro, Ln = Math.log(ro/ri);
    const mean = (a2*(b2 - a2)/2 - (b2*b2 - a2*a2)/4 + 2*b2*(b2*Ln/2 - (b2 - a2)/4))/(2*(b2 - a2));
    const Vc = A*nCh*H, Rk = mean/Vc, Rw = Math.log(rt/(b/2))/(2*Math.PI*20*nCh*H);
    const Tw = G.CPS_T + 15, mu = 2.414e-5*Math.pow(10, 247.8/(Tw - 140)), cpw = G.waterFig(G.CPS_P, Tw, 0).cp*1000, w = G.cpsFlowOf(c)/nCh;
    const Re = 4*w/(Math.PI*b*mu), Pr = mu*cpw/0.64, h = 0.023*Math.pow(Re, 0.8)*Math.pow(Pr, 0.4)*0.64/b, Rf = 1/(h*Math.PI*b*nCh*H);
    const sig = 5.670374419e-8, qq = gc.qBlk*ch.V/(gc.V + ch.V) + gc.qS, Tt = Tw + qq*(Rf + Rw), Tb = Tt + qq*ch.Rg;
    const Rg = 1/((G.gasMixK(G.tubeHeOf(c), (Tt + Tb)/2)/gap + sig*(Tt*Tt + Tb*Tb)*(Tt + Tb)/(1/0.8 + 1/0.8 - 1))*2*Math.PI*(rt + gap/2)*nCh*H);
    const nS = G.latFaces(c, q => G.latFuel(c, q) || L.slot[q] === G.L_MOD, q => L.slot[q] === G.L_CPS)*Q, As = nS*p*H, dl = G.colGapMm(c)/1000;
    const Rks = p/As, Rgs = 1/((G.gasMixK(G.COL_HE, (gc.TF + gc.TC)/2)/dl + sig*(gc.TF*gc.TF + gc.TC*gc.TC)*(gc.TF + gc.TC)/(2/0.8 - 1))*As);
    const e = Math.max(Math.abs(ch.Rk/Rk - 1), Math.abs(ch.Rw/Rw - 1), Math.abs(ch.Rf/Rf - 1), Math.abs(ch.Rg/Rg - 1), Math.abs(sd.Rk/Rks - 1), Math.abs(sd.Rg/Rgs - 1));
    check(name + ": the channel columns' and the sideways conductances against the series law written again, worst", e, 0, 1e-9,
      "inner-cooled annulus mean rise (Incropera ch. 3); tube wall ln(ro/ri)/(2 pi k L); Dittus-Boelter Nu = 0.023 Re^0.8 Pr^0.4 (Incropera eq. 8.60) on the bore; the gas gap k/d with grey-body radiation in parallel; half a column of conduction each side",
      {abs:true, unit:"of the value", note:"film " + h.toFixed(0) + " W/m2/K at Re " + Re.toFixed(0) + "; column gap " + (1/(Rgs*As)).toFixed(1) + " W/m2/K"});
    const bad = 1/((G.gasMixK(G.COL_HE, (gc.TF + gc.TC)/2)/dl*10 + sig*(gc.TF*gc.TF + gc.TC*gc.TC)*(gc.TF + gc.TC)/(2/0.8 - 1))*As);
    check(name + ": fault injected, the column gap's gas x 10: the conductance check fails", Math.abs(sd.Rg/bad - 1) > 1e-9 ? 1 : 0, 1, 0, "the conductance check above must be able to fail", {abs:true});
    check("the column gap's gas, 40 % He in N2 at 750 K, against the RBMK designers' own figure", G.gasMixK(G.COL_HE, 750), (58 + 0.09*750)*1e-3, 0.2,
      "Kaliatka et al., STNI 2008 (read), eq. 4 after the RBMK designers: lambda = (a + b T) 1e-3 W/m/K, a 58 and b 0.09 for 40 % He, 0.1255 at 750 K; this is Mason-Saxena on Incropera's pure gases",
      {unit:"W/m/K", note:"gap conductance at the paper's 1.2 mm: " + (G.gasMixK(G.COL_HE, 750)/0.0012).toFixed(1) + " W/m2/K against its 104.6"}); }
  /* the gamma cell with channels: conserves, and meets the uniform-fluence limit */
  { const NG = G.GAM_NG, K = G.gamKit(c), R = G.heatCellOf(c, 0, 1), s = new Float64Array(G.HS_N*NG), d = new Float64Array(G.HS_N);
    for(let r=0;r<G.HS_N;r++) if(R.vol[r] > 0) for(let g=0;g<NG;g++) s[r*NG+g] = (0.1 + 0.05*r)*G.GAM_FISS[g];
    let tot = 0; for(const x of s) tot += x;
    G.gamDepose(c, K, R, 0, 1, s, d); let got = 0; for(const x of d) got += x;
    check(name + ": the gamma chain with control channel cells conserves", Math.abs(got - tot), 0, 1e-12, "conservation: every state's exits sum to one", {abs:true, note:"channel water " + (d[G.HS_CW]/tot*100).toFixed(3) + " %, channel tube " + (d[G.HS_CT]/tot*100).toFixed(3) + " %"});
    const K2 = G.gamKit(c), k = 1e-6, Rt = Object.assign({}, R, {sig:R.sig.map(x => x*k)}), d2 = new Float64Array(G.HS_N), fs = new Float64Array(G.HS_N*NG);
    for(let g=0;g<NG;g++) fs[G.HS_FUEL*NG+g] = G.GAM_FISS[g];
    G.gamDepose(c, K2, Rt, 0, 1, fs, d2);
    const st = [];
    for(const [C, T] of [[K2.cell, K2.T], [K2.ch, K2.TC]]) for(let q=0;q<C.n;q++){ const V = T.V[q]*1e-4*C.nCell; for(const [r, x] of C.comp[q]) st.push({r, V:V*x}); }
    st.push({r:G.HS_BLK, V:v.nM*p*p}, {r:G.HS_ABS, V:G.latAbsA(c)});
    const want = new Float64Array(G.HS_N), E = Array.from(G.GAM_FISS), T = G.GAM_TR;
    for(let g=NG-1;g>=0;g--){ let sv = 0; for(const x of st) sv += Rt.sig[x.r*NG+g]*x.V;
      const w = x => Rt.sig[x.r*NG+g]*x.V/sv; let re = 0; for(const x of st) re += w(x)*(1 - Rt.f[x.r*NG+g]);
      const all = E[g]/(1 - re*T[g*NG+g]);
      for(const x of st) want[x.r] += all*w(x)*Rt.f[x.r*NG+g];
      for(let h=0;h<g;h++) E[h] += all*re*T[g*NG+h]; }
    let e = 0; for(let r=0;r<G.HS_N;r++) e = Math.max(e, Math.abs(d2[r] - want[r]));
    check(name + ", bank in: every S scaled by 1e-6 with channel cells, against the uniform-fluence cascade by hand, worst region", e, 0, 1e-5,
      "analytic: with no self-shielding a collision lands by S V in fuel cells, channel cells, blocks and absorber alike", {abs:true, note:"channel water " + (want[G.HS_CW]*100).toFixed(3) + " %"});
    const src = G.gamChain.toString();
    inBundle("gamChain = " + src.replace("go(iJ,g,col,e*L.gF);", "") + ";");
    G.gamDepose(c, G.gamKit(c), R, 0, 1, s, d); let bad = 0; for(const x of d) bad += x;
    inBundle("gamChain = " + src + ";");
    check(name + ": fault injected, the channel cells' way back to the fuel dropped: the conservation check fails", Math.abs(bad - tot) > 1e-12 ? 1 : 0, 1, 0, "the conservation check above must be able to fail", {abs:true}); }
}

/* the bored stack's conduction between nodes, on the RBMK-1000 commissioned: the tick's own pass against Fourier's law written again, on fields the test sets */
if(mode === "spread"){
  const G = commissionPreset(5), PT = G.PT, ST = G.ST, SX = G.SX, c = 0, cD = G.priD(), name = G.PLANTPRE[5][0], XNN = G.XNN, XNZ = G.XNZ;
  const kg = PT.coreGraphKg[c], kgC = PT.coreGraphKgC[c], wC = kgC > 0 ? kgC/(kg + kgC) : 0, rk = PT.coreRated[c]*1000;
  const F64 = () => new Float64Array(XNN), gR = F64(), gZ = F64(), net = F64(), gs = F64(), netC = F64(), gsC = F64();
  const set = (f, fC) => { for(let k=0;k<XNN;k++){ const i = (k/XNZ)|0, j = k%XNZ; ST.csNTg[k] = f(i, j); ST.csNTgC[k] = fC(i, j); } G.eCoreSpread(c); };
  /* worst node heat and conductance sum, tick against hand, over the largest */
  const worst = S => { const TF = ST.csNTg.slice(0, XNN), TC = ST.csNTgC.slice(0, XNN);
    spreadG(G, S, TF, 1 - wC, gR, gZ); spreadNet(G, TF, gR, gZ, net, gs);
    spreadG(G, S, TC, wC, gR, gZ); spreadNet(G, TC, gR, gZ, netC, gsC);
    let e = 0, m = 0, eg = 0, mg = 0;
    for(let k=0;k<XNN;k++){ m = Math.max(m, Math.abs(net[k]), Math.abs(netC[k])); mg = Math.max(mg, gs[k], gsC[k]);
      e = Math.max(e, Math.abs(SX.coreSpQ[k]*1000 - net[k]), Math.abs(SX.coreSpQC[k]*1000 - netC[k]));
      eg = Math.max(eg, Math.abs(SX.coreSpG[k]*1000 - gs[k]), Math.abs(SX.coreSpGC[k]*1000 - gsC[k])); }
    return {e:Math.max(e/m, eg/mg), m}; };
  const S = spreadHand(G, c, cD), Ts = G.graphCellOf(cD).spread.T, kT = modProp(G, c, Ts).k, p = cD.lat.pitch;
  check(name + ": a bored stack, and the tick carries its spread", PT.coreSpP[c] > 0 && PT.coreSpR[0] > 0 && PT.coreSpZ[0] > 0 ? 1 : 0, 1, 0,
    "Kaliatka et al., STNI 2008 (read): modelling the RBMK core needs heat conduction between the graphite columns", {abs:true,
      note:"graphite fraction " + S.phi.toFixed(3) + "; column gap " + (1/S.Rg).toFixed(1) + " W/m2/K at " + (Ts - 273.15).toFixed(0) + " C; across columns and gaps " + (p/(p/kT + S.Rg)).toFixed(1) + " W/m/K against the block's " + kT.toFixed(1)});
  const FOU = "Fourier's law between neighbouring nodes: k_eff A dT/dr, k_eff = p/(p/k + R_gap) over a pitch of block and one column gap (gap gas checked against Kaliatka's 0.1255 W/m/K in the cps chunk), A the graphite fraction of the ring face";
  set((i) => 700 + 10*i, (i) => 600 + 8*i);
  const r = worst(S);
  check(name + ": radial spread, a field linear in r, against Fourier's law written again, worst node", r.e, 0, 1e-12, FOU, {abs:true, unit:"of the largest", note:"largest node heat " + (r.m/1000).toFixed(2) + " kW"});
  const bad = worst(spreadHand(G, c, cD, 10));
  check(name + ": fault injected, the column gap x 10 in the hand law: the radial check fails", bad.e > 1e-12 ? 1 : 0, 1, 0, "the radial check above must be able to fail", {abs:true, note:"worst " + bad.e.toExponential(2)});
  set((i, j) => 700 + 15*j, (i, j) => 600 + 12*j);
  const z = worst(S);
  check(name + ": axial spread, a field linear in z, against Fourier's law written again, worst node", z.e, 0, 1e-12,
    "Fourier's law up each column: k A dT/dz, A the graphite fraction of the ring; block-to-block contact left out", {abs:true, unit:"of the largest", note:"largest node heat " + (z.m/1000).toFixed(3) + " kW"});
  const rough = (i, j) => 700 + 40*Math.sin(1.3*i + 0.7*j) + 3*i*j, sumOf = () => { let s = 0; for(let k=0;k<XNN;k++) s += SX.coreSpQ[k] + SX.coreSpQC[k]; return s; };
  set(rough, (i, j) => rough(i, j) - 90);
  check(name + ": the spread on an uneven field sums to zero over the stack", Math.abs(sumOf())/rk, 0, 1e-12, "conservation: what one node gives its neighbour, the neighbour takes", {abs:true, unit:"of core heat"});
  const src = G.eCoreSpread.toString();
  inBundle("eCoreSpread = " + src.replace("qF[m] -= q;", "") + ";");
  set(rough, (i, j) => rough(i, j) - 90); const leak = Math.abs(sumOf())/rk;
  inBundle("eCoreSpread = " + src + ";");
  check(name + ": fault injected, one interface side's heat dropped: the conservation check fails", leak > 1e-12 ? 1 : 0, 1, 0, "the conservation check above must be able to fail", {abs:true, note:(leak).toExponential(2) + " of core heat"});
  set(() => 700, () => 650);
  let u = 0; for(let k=0;k<XNN;k++) u = Math.max(u, Math.abs(SX.coreSpQ[k]), Math.abs(SX.coreSpQC[k]));
  check(name + ": a uniform stack spreads nothing", u, 0, 0, "Fourier: no gradient, no heat", {abs:true, unit:"kW"});
  const bare = [6, 7].map(i => { G.plantPreset(i); G.buildLayout(); return G.PLANTPRE[i][0] + " " + (G.graphCellOf(G.priD()).spread === null ? "none" : "SPREAD"); });
  check("the bare-slot stacks carry no spread", bare.every(s => /none$/.test(s)) ? 1 : 0, 1, 0,
    "the spread is built for bored stacks only: a bare slot's gap is its moving coolant, and no figure was read for it", {abs:true, note:bare.join(", ")});
}

