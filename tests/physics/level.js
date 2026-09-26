"use strict";
// chunks: geo swell boil steam boiloff wall
/* the core's water level: geo = the collapsed level off the vessel's own geometry and the water it has lost, swell = a boiling column's mixture level over its collapsed one, boil = a core boiled down with the level held: it uncovers from the top, steam = the first law on the steam crossing the dry core, boiloff = the steam leaving the level is the heat into the liquid less the inflow's subcooling */
const {check, commissionPreset, inBundle, tsat, if97, if97r2, if97steam, watch} = require("./lib.js");
const mode = process.argv[2];
const G = commissionPreset(0), PT = G.PT, ST = G.ST, W = G.nodeW, XNZ = G.XNZ, XNR = G.XNR, c = 0;
const cd = G.coreD(G.IX.coreId[c]), H = G.latM(cd).hgt, LO = G.vesLowerM(cd), UP = G.vesUpperM(cd), A = Math.PI/4*G.vesselDiaM(cd)**2;
const Ar = G.latRods(cd)*Math.PI/4*G.rodD(cd)**2;
/* the vessel filled from the bottom: lower plenum, core less its rods, upper plenum; x the share of it that is void */
const zHand = (x, rods = Ar) => { const Ac = A - rods, V = (1 - x)*(A*LO + Ac*H + A*UP);
  return V <= A*LO ? V/A - LO : V <= A*LO + Ac*H ? (V - A*LO)/Ac : H + (V - A*LO - Ac*H)/A; };
const planeP = () => { const p = new Float64Array(XNZ); for(let j=0;j<XNZ;j++) for(let i=0;i<XNR;i++) p[j] += W[i*XNZ + j]*ST.csPhi[i*XNZ + j]; return p; };
/* a column fed at the bottom with saturated water at the rate its wetted length boils it, THTF's steady boil-off */
const column = (p, heat, cl, secs, each, pumped) => { const Ts = tsat(p), hfg = if97r2(p, Ts).h - if97(p, Ts).h, P = planeP(), rk = PT.coreRated[c]*1000;
  ST.csPCore[c] = p; ST.csDecay[c] = heat;
  watch(G, {cap:secs, each, step:() => {
    let q = 0; for(let j=0;j<XNZ;j++) q += G.E_WET[j]*P[j];
    const mf = pumped ? 1 : q*heat*rk/hfg/(PT.coreG0[c]*PT.coreAFlow[c]), cs = G.E_CS;
    cs[0] = 0.02; cs[1] = heat; cs[2] = Ts; cs[3] = cl; cs[4] = mf; cs[5] = mf; cs[6] = PT.coreCp[c]*Ts;
    G.eCoreStep(c); }});
  return {Ts, hfg, P}; };

if(mode === "geo"){
  const GEO = "the vessel's own drawing: lower plenum "+LO.toFixed(2)+" m, the core less its rods' section, upper plenum "+UP.toFixed(2)+" m, filled from the bottom";
  let e = 0, eBad = 0;
  for(const x of [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1]){ G.eCoreCollapsedA(c, x);
    e = Math.max(e, Math.abs(ST.csLvl[c] - zHand(x))); eBad = Math.max(eBad, Math.abs(ST.csLvl[c] - zHand(x, 0))); }
  check("collapsed level over the core bottom against the geometry by hand, vessel void 0-1, worst", e, 0, 1e-9, GEO, {abs:true, unit:"m"});
  check("fault injected, the rods' section left in the core: the level check fails", eBad > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"off by " + (eBad*1000).toFixed(0) + " mm"});
  /* water taken out of the vessel: the void it leaves at the vessel's own pressure, IF97 by hand */
  const pc = ST.csPCore[c], Ts = tsat(pc), rvl = if97(pc, Ts).v/if97r2(pc, Ts).v, x = 0.4, j0 = PT.coreLoop0[c], j1 = PT.coreLoop0[c+1];
  for(let j=j0;j<j1;j++) ST.mBy[PT.coreLoopNode[j]] *= 1 - x*(1 - rvl);
  G.eCoreVesselStep(0.02);
  check("collapsed level with 40 % of the vessel's volume voided by mass, against the geometry", ST.csLvl[c], zHand(x), 1e-3,
    "void = (1 - m/m0)/(1 - rho_g/rho_f) on IF97 at the core's " + pc.toFixed(2) + " MPa; " + GEO, {abs:true, unit:"m", note:"core " + H.toFixed(2) + " m tall; the engine reads its saturation tables"});
}

if(mode === "swell"){
  /* Anklam & White, ORNL CONF-810806-8 (1981) eq. 6: S = (Z_mix - Z_cll)/Z_cll = 0.0109 j_g, j_g cm/s at the collapsed level; 0.0132 their 8 MPa bound */
  const AW = "Anklam & White, ORNL CONF-810806-8 (1981) eq. 6: level swell 0.0109 per cm/s of j_g at the collapsed level, 0.0132 at 8 MPa (THTF, 3.5-8 MPa)";
  const out = [];
  for(const [p, heat] of [[4, 0.01], [7, 0.02]]){
    /* settled covered at the test's heat: 20 s pumped takes the pellets' stored heat without a crisis, 40 s of boil-off */
    const S0 = G.engSnap(G.engSnapNew()), cl = 0.6; column(p, heat, 1, 20, null, true); column(p, heat, 1, 40); const r = column(p, heat, cl, 6);
    const zc = cl*H, zm = ST.csLvlMix[c];
    let q = 0; for(let j=0;j<XNZ;j++) q += r.P[j]*Math.max(0, Math.min(1, zc/(H/XNZ) - j));
    const jg = q*heat*PT.coreRated[c]*1000/(1/if97r2(p, r.Ts).v*r.hfg*PT.coreAFlow[c])*100;
    out.push({p, heat, s:(zm - zc)/zc, jg}); G.engRestore(S0); }
  for(const o of out)
    check("level swell per cm/s of j_g, boiling column at " + o.p + " MPa, " + (o.heat*100).toFixed(0) + " % power, collapsed level at 60 % of the core", o.s/o.jg, 0.0109, 0, AW,
      {pass:o.s/o.jg >= 0.0109 && o.s/o.jg <= 0.0132, gap:"the drift velocity in the void correlation", unit:"per cm/s", note:"swell " + (o.s*100).toFixed(2) + " % at j_g " + o.jg.toFixed(2) + " cm/s; band 0.0109-0.0132"});
}

if(mode === "boil"){
  /* NEA/CSNI/R(2000)21 sec. 2: an uncovered core heats at 0.4-1.0 K/s, over 1 K/s only past ~1300 K where the Zr-steam heat joins */
  const CSNI = "NEA/CSNI/R(2000)21 sec. 2: uncovered rods heat at 0.4-1.0 K/s under ~1300 K";
  /* decay heat 100 min after a trip from long operation on the engine's own ANS-5.1 groups: TMI-2's core uncovered about then (NUREG/CR-6197) */
  let dec = 0; for(let g=0;g<G.E_DEC_N;g++) dec += G.E_DEC_A[g]*Math.exp(-G.E_DEC_L[g]*6000);
  /* the core first settled covered at that heat, then its water taken down to half height: the rods it leaves start where decay heat under water put them */
  const run = () => { const S0 = G.engSnap(G.engSnapNew()), T0 = new Float64Array(G.XNN);
    column(7, dec, 1, 40);
    column(7, dec, 0.5, 20, n => { if(n === 250) for(let k=0;k<G.XNN;k++) T0[k] = ST.csNTcl[k]; });
    const w = Array.from(G.E_WET); let rate = 0, n = 0, top = -Infinity, hot = 0;
    for(let j=0;j<XNZ;j++) if(w[j] === 0) for(let i=0;i<XNR;i++){ const k = i*XNZ + j, r = (ST.csNTcl[k] - T0[k])/15;
      rate += W[k]*r; n += W[k]; top = Math.max(top, r); hot = Math.max(hot, ST.csNTcl[k]); }
    G.engRestore(S0);
    let mono = w[0] === 1 && w[XNZ-1] === 0; for(let j=1;j<XNZ;j++) if(w[j] > w[j-1]) mono = false;
    return {w, rate:n > 0 ? rate/n : NaN, top, hot, mono}; };
  const a = run();
  check("core boiled down, collapsed level held at half height, decay heat at 100 min: wetted share by plane, bottom to top", a.mono ? 1 : 0, 1, 0,
    "a core that loses water uncovers from the top: the bottom plane stays wet, the top dries first (TMI-2's bottom ~0.5 m stayed under water, NUREG/CR-6197)",
    {abs:true, note:a.w.map(x => x.toFixed(2)).join(" ")});
  check("uncovered rods' heat-up rates, area mean to hottest, 5-20 s after they uncover, decay heat " + (dec*100).toFixed(2) + " %", a.top, 0.7, 0.3, CSNI + ", depending on the location in the core: the model's span must overlap it",
    {abs:true, unit:"K/s", pass:a.top >= 0.4 && a.rate <= 1.0 && a.hot < 1300, note:"hottest shown; area mean of the uncovered rods " + a.rate.toFixed(2) + " K/s; hottest can " + a.hot.toFixed(0) + " K"});
  const keep = G.eCoreLevelA.toString();
  inBundle("eCoreLevelA = function(c, cl){ for(let j=0;j<XNZ;j++) E_WET[j] = Math.max(0, Math.min(1, cl)); E_LVW[0] = 0; E_LVW[1] = XNZ - 1; ST.csLvlMix[c] = cl*PT.coreCoreHgt[c]; }");
  const b = run();
  inBundle("eCoreLevelA = " + keep.replace(/^function eCoreLevelA/, "function"));
  check("fault injected, the level spread evenly over every plane (the old uniform bare): the order check fails", b.mono ? 0 : 1, 1, 0, "the check above must be able to fail",
    {abs:true, note:b.w.map(x => x.toFixed(2)).join(" ")});
}

/* STOCK PWR as reloc.js tmi sets it up (7 MPa, decay heat 6000 s after trip, collapsed level 15 %), fed water sub K under saturation, its dry nodes then set at 1500-2000 K; one tick on */
const uncover = (sub, set) => { const S0 = G.engSnap(G.engSnapNew()), p = 7, Ts = tsat(p), hfg = if97r2(p, Ts).h - if97(p, Ts).h, cs = G.E_CS, rk = PT.coreRated[c]*1000;
  let dec = 0; for(let g=0;g<G.E_DEC_N;g++) dec += G.E_DEC_A[g]*Math.exp(-G.E_DEC_L[g]*6000);
  ST.csPCore[c] = p; ST.csDecay[c] = dec;
  const tick = cl => { let q = 0; for(let j=0;j<XNZ;j++) for(let i=0;i<XNR;i++) q += G.E_WET[j]*ST.csNDw[i*XNZ + j];
    const mf = q*dec*rk/hfg/(PT.coreG0[c]*PT.coreAFlow[c]);
    cs[0] = 0.02; cs[1] = dec; cs[2] = Ts; cs[3] = cl; cs[4] = mf; cs[5] = Math.max(mf, 1e-3); cs[6] = PT.coreCp[c]*(Ts - sub); G.eCoreStep(c); };
  watch(G, {cap:5, step:() => tick(1)});
  watch(G, {cap:1, step:() => tick(0.15)});
  for(let q=0;q<G.XNN;q++) if(G.E_WET[q % XNZ] === 0){ if(set){ set(q); continue; } const T = 1500 + 500*(q % XNZ)/(XNZ - 1); ST.csNTcl[q] = T; ST.csNTf[q] = T + 50; }
  const Tk0 = Float64Array.from(ST.csNTcl);
  let Ql = 0; for(let q=0;q<G.XNN;q++) Ql += ST.csNQl[q];
  tick(0.15);
  let jl = 0; for(let j=0;j<XNZ;j++) if(G.E_WET[j] > 0) jl = j;
  const qSub = Math.max(cs[4], 0)*PT.coreG0[c]*PT.coreAFlow[c]*Math.max(0, PT.coreCp[c]*cs[2] - cs[6]), wst = Math.max(Ql - qSub, 0)/G.E_AXFG[jl];
  const hg = if97steam(G.E_AXP[jl], G.E_AXS[jl]).h, pTop = G.E_AXP[XNZ - 1];
  let given = 0, carried = 0, Tx = 0, dry = 0;
  for(let q=0;q<G.XNN;q++) if(G.E_WET[q % XNZ] === 0){ given += G.E_STQ[q]; dry++; }
  for(let i=0;i<XNR;i++){ carried += wst*G.ringW[i]*(if97steam(pTop, G.E_STX[i]).h - hg); Tx = Math.max(Tx, G.E_STX[i]); }
  /* the steam leaving a dry node lies between what arrived and the can it crossed, the can at either end of the tick */
  let wall = 0; for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const q = i*XNZ + j; if(G.E_WET[j] !== 0) continue;
    const a = ST.csNTc[q], o = j < XNZ - 1 ? ST.csNTc[q + 1] : G.E_STX[i], lo = Math.min(a, Tk0[q], ST.csNTcl[q]), hi = Math.max(a, Tk0[q], ST.csNTcl[q]);
    wall = Math.max(wall, lo - o, o - hi); }
  const r = {wst, lvw:G.E_LVW[0], Ql, qSub, given, carried, Tx, dry, jl, wall};
  G.engRestore(S0); return r; };

if(mode === "steam"){
  const SRC = "first law on the steam: the heat the dry nodes give it = sum over rings of w (h_exit - h_g), h on the test's own IAPWS-IF97 regions 2 and 5";
  const run = () => uncover(0), a = run(), note = r => r.dry + " dry nodes, level plane " + r.jl + ", steam " + r.wst.toFixed(3) + " kg/s, hottest exit " + r.Tx.toFixed(0) + " K, " + (r.given/1000).toFixed(3) + " MW given against " + (r.carried/1000).toFixed(3) + " MW carried";
  check("dry core, one tick: heat given to the steam against the steam's IF97 enthalpy rise", a.given, a.carried, 1e-9, SRC, {unit:"kW", note:note(a)});
  check("the steam passed region 2's 1073.15 K, so region 5 was read", a.Tx > 1073.15 ? 1 : 0, 1, 0, "the check above ran over region 5", {abs:true, note:"hottest exit " + a.Tx.toFixed(1) + " K"});
  const keep = G.eSteamTA.toString();
  inBundle("eSteamTA = function(){ const T0 = E_AXS[E_LVW[1]]; if97Steam(T0, E_STV[1], E_STM); const h0 = E_STM[1], c0 = E_STM[2]; E_STV[2] = T0 + (E_STV[0] - h0)/c0; if97Steam(E_STV[2], E_STV[1], E_STM); E_STM[2] = c0; }");
  const f = run(); inBundle("eSteamTA = " + keep.replace(/^function eSteamTA/, "function"));
  check("fault injected, the steam heated on c_p at saturation (the old law): the first-law check fails", Math.abs(f.given/f.carried - 1) > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail",
    {abs:true, note:note(f) + ", ratio " + (f.given/f.carried).toFixed(2)});
}

if(mode === "boiloff"){
  const SRC = "first law at the level: W_st = (heat into the liquid - W_in (h_f - h_in))/h_fg, the heat off last tick's csNQl, 30 K subcooled inflow";
  const keep = G.eCoreLevelA.toString(), a = uncover(30);
  check("steam leaving the level against the heat into the liquid by hand", a.lvw, a.wst, 1e-9, SRC, {unit:"kg/s", note:"heat into the liquid " + a.Ql.toFixed(1) + " kW, inflow subcooling " + a.qSub.toFixed(1) + " kW, level plane " + a.jl});
  inBundle("eCoreLevelA = " + keep.replace("p += s.csNQl[nb + i*XNZ + j]", "p += nodeW[i*XNZ + j]*s.csPhi[nb + i*XNZ + j]*E_CS[1]*T.coreRated[c]*1000").replace(/^function eCoreLevelA/, "function"));
  const f = uncover(30); inBundle("eCoreLevelA = " + keep.replace(/^function eCoreLevelA/, "function"));
  check("fault injected, the boil-off priced on the live flux shape (the old law): the check fails", Math.abs(f.lvw/f.wst - 1) > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail",
    {abs:true, note:"engine " + f.lvw.toFixed(4) + " kg/s against " + f.wst.toFixed(4)});
}

if(mode === "wall"){
  /* the first dry plane's cans at 2300 K heat the steam; above it the cans stand at 900 K over pellets at 800 K, so the steam arrives hotter than a can whose pellet is colder still */
  const set = q => { const hot = q % XNZ === 0 || G.E_WET[q % XNZ - 1] !== 0; ST.csNTcl[q] = hot ? 2300 : 900; ST.csNTf[q] = hot ? 2350 : 800; };
  const SRC = "second law on the steam: gas crossing a wall leaves between its own inlet temperature and the wall's, never past the wall";
  const keep = G.eCoreStep.toString(), a = uncover(0, set);
  check("dry core, one tick, steam hotter than a can over a colder pellet: steam past its wall, worst", a.wall, 0, 1e-6, SRC, {abs:true, unit:"K", note:a.dry + " dry nodes, hottest exit " + a.Tx.toFixed(0) + " K"});
  inBundle("eCoreStep = " + keep.replace("const tLo = Math.min(Tc0, Tf0, Tcl0);", "const tLo = Math.min(Tc0, Tcl0);").replace(/^function eCoreStep/, "function"));
  const f = uncover(0, set); inBundle("eCoreStep = " + keep.replace(/^function eCoreStep/, "function"));
  check("fault injected, the can's floor at its coolant only (the old floor): the steam check fails", !(f.wall <= 1e-6) ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"worst " + f.wall.toFixed(1) + " K past its wall (NaN: the steam went under saturation)"});
}
