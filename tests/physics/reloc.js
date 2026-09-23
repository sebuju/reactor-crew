"use strict";
// chunks: books front freeze block tmi tmi,--fault
/* molten core material moves down: books = every material, the decay weight and the energy over a melting core; front = a free melt
   runs down a hot ring at the film speed; freeze = a kg of melt onto a cold pin by hand; block = debris throttles its ring's flow;
   tmi = a core boiled down with its level held degrades from the top and holds a pool on a crust */
const {check, commissionPreset, inBundle, tsat, if97, if97r2} = require("./lib.js");
const mode = process.argv[2];
const G = commissionPreset(0), PT = G.PT, ST = G.ST, W = G.nodeW, XNZ = G.XNZ, XNR = G.XNR, XNN = G.XNN, c = 0;
const S0 = G.engSnap(G.engSnapNew()), H = PT.coreCoreHgt[c], dz = H/XNZ, mF0 = PT.coreFuelKg[c], mK0 = PT.coreCladM[c];
const hF = T => { G.E_FU[0] = T; G.eFuelHA(c); return G.E_FU[1]; }, hK = T => { G.E_CL[0] = T; G.E_CL[4] = T; G.eCladHA(c); return G.E_CL[1]; };
const lat = PT.cladHfus[PT.coreCladRow[c]], fuse = PT.coreFuseKJ[c];
/* every material over the core's nodes, its free melt and the pool below it */
const sum = (lump, melt, pool) => { let s = ST[pool][c]; for(let k=0;k<XNN;k++) s += ST[lump][k] + ST[melt][k]; return s; };
const books = () => ({F:sum("csNFu", "csNMlF", "csPlF"), K:sum("csNCl", "csNMlK", "csPlK"), D:sum("csNDw", "csNMlDw", "csPlDw")});
/* enthalpy each lump, melt and the pool holds, fusion included */
const energy = () => { let u = ST.csPlE[c];
  for(let k=0;k<XNN;k++) u += ST.csNFu[k]*hF(ST.csNTf[k]) + ST.csNDis[k]*fuse + ST.csNCl[k]*(hK(ST.csNTcl[k]) + ST.csNClMl[k]*lat) + ST.csNMlE[k];
  return u; };
/* decay heat only, the core dry above cl of its height, fed the boil-off of the decay heat its wetted length holds, at 7 MPa */
const tick = (cl, dec, pumped) => { const p = 7, Ts = tsat(p), hfg = if97r2(p, Ts).h - if97(p, Ts).h, cs = G.E_CS;
  ST.csPCore[c] = p; ST.csDecay[c] = dec;
  let q = 0; for(let j=0;j<XNZ;j++) for(let i=0;i<XNR;i++) q += G.E_WET[j]*ST.csNDw[i*XNZ + j];
  const mf = pumped ? 1 : q*dec*PT.coreRated[c]*1000/hfg/(PT.coreG0[c]*PT.coreAFlow[c]);
  cs[0] = 0.02; cs[1] = dec; cs[2] = Ts; cs[3] = cl; cs[4] = mf; cs[5] = Math.max(mf, 1e-3); cs[6] = PT.coreCp[c]*Ts; G.eCoreStep(c); };
let dec100 = 0; for(let g=0;g<G.E_DEC_N;g++) dec100 += G.E_DEC_A[g]*Math.exp(-G.E_DEC_L[g]*6000);

if(mode === "books"){
  /* the upper half of a dry core over its ceramic's 2479 K with its cans burst: it melts, candles and freezes on the colder half below */
  const run = () => { G.engRestore(S0);
    for(let k=0;k<XNN;k++) if(k % XNZ >= XNZ/2){ ST.csNTf[k] = 2600; ST.csNTcl[k] = 2300; ST.csNDmg[k] = 1; ST.csNV[k] = 1; }
    const b0 = books(), rk = PT.coreRated[c]*1000;
    let wM = 0, wD = 0, res = 0, heat = 0, moved = 0;
    for(let t=0;t<300;t++){
      let src = 0; for(let k=0;k<XNN;k++) src += ST.csNDw[k] + ST.csNMlDw[k]; src += ST.csPlDw[c];
      const u1 = energy();
      tick(0.3, dec100);
      const b = books();
      wM = Math.max(wM, Math.abs(b.F - b0.F)/mF0, Math.abs(b.K - b0.K)/mF0); wD = Math.max(wD, Math.abs(b.D - b0.D));
      const q = (dec100*rk*src + ST.csQOx[c]*rk)*0.02, out = (ST.csFQ[c] + ST.csDQ[c] + ST.csGQ[c] + ST.csCQ[c] + G.SX.coreO[G.E_CO_FCI] + G.E_LH[3])*0.02;
      res += q - (energy() - u1) - out; heat += q; }
    for(let k=0;k<XNN;k++) moved += ST.csNMlF[k] + ST.csNMlK[k]; moved += ST.csPlF[c] + ST.csPlK[c];
    return {wM, wD, e:res/heat, moved}; };
  const a = run(), note = "free melt and pool " + (a.moved/1000).toFixed(2) + " t after 6 s";
  check("fuel and can, over the pins, the free melt and the pool below: conserved per tick, worst", a.wM, 0, 1e-12, "conservation of mass, per material", {abs:true, unit:"of the core's fuel", note});
  check("the decay weight over the same three places: conserved per tick, worst", a.wD, 0, 1e-12, "the fission products go where the material goes", {abs:true, unit:"of the core's decay heat"});
  check("the core's first law with material moving: decay heat + Zr heat = d(pins + melt + pool) + heat to water and into the head", a.e, 0, 1e-9,
    "first law; each lump on its own law, the melt and the pool on the enthalpy they carry", {abs:true, unit:"of heat x time", note});
  check("some of the core did move", a.moved > 1 ? 1 : 0, 1, 0, "the checks above ran on material that moved", {abs:true, note});
  const km = G.eMeltMove.toString(), ks = G.eCoreStep.toString();
  inBundle("eMeltMove = " + km.replace("s.csNMlDw[m] += D;", "").replace(/^function eMeltMove/, "function"));
  const f1 = run(); inBundle("eMeltMove = " + km.replace(/^function eMeltMove/, "function"));
  inBundle("eCoreStep = " + ks.replace("E_MA[3] = dF*(paid < fuseB ? hm + fuseB : hN)", "E_MA[3] = dF*hm").replace(/^function eCoreStep/, "function"));
  const f2 = run(); inBundle("eCoreStep = " + ks.replace(/^function eCoreStep/, "function"));
  check("fault injected, a melt that moves leaves its decay weight behind: the decay weight check fails", f1.wD > 1e-12 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"worst " + f1.wD.toExponential(2)});
  check("fault injected, melted fuel entering the melt without its fusion: the first law fails", Math.abs(f2.e) > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"residual " + f2.e.toExponential(2)});
}

if(mode === "front"){
  /* 1 kg of molten fuel at ring 0's top over cans hotter than it: nothing freezes, the melt only runs */
  const run = () => { G.engRestore(S0);
    const top = XNZ - 1, Tm = 3000;
    for(let j=0;j<XNZ;j++) ST.csNTcl[j] = 3200;
    ST.csNMlF[top] = 1; ST.csNMlE[top] = hF(Tm) + fuse; ST.csNMlL[top] = fuse;
    const mean = () => { let m = ST.csPlF[c], z = -ST.csPlF[c]*dz/2; for(let j=0;j<XNZ;j++){ m += ST.csNMlF[j]; z += ST.csNMlF[j]*(j + 0.5)*dz; } return {z:z/m, pool:ST.csPlF[c]/m}; };
    let worst = 0, n = 0;
    for(let t=0;t<600;t++){ const a = mean(); G.eCoreRelocA(c, 0.02); const b = mean();
      if(1 - a.pool < 1e-3) break;
      worst = Math.max(worst, Math.abs((a.z - b.z)/0.02/(1 - a.pool) - v)/v); n++; }
    return {worst, n, pool:mean().pool}; };
  const v = G.CORIUM.vCandle, a = run();
  check("a free melt's mass-weighted height falls at the film speed, per tick, over what has not reached the pool, worst", a.worst, 0, 1e-9,
    "the candling law: every plane passes vCandle dt/dz of its melt one plane down a tick", {abs:true, unit:"of vCandle", note:a.n + " ticks, " + (a.pool*100).toFixed(1) + " % in the pool at the end"});
  inBundle("CORIUM.vCandle = 0"); const f = run(); inBundle("CORIUM.vCandle = " + v);
  check("fault injected, the film speed 0: the melt does not run and the check fails", f.worst > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"worst " + f.worst.toExponential(2)});
}

if(mode === "freeze"){
  /* 100 kg of molten fuel at 3200 K over 600 K pins at ring 0's mid plane: the film freezes what it can carry the heat of */
  const j = XNZ/2, k = j, Tm = 3200, Tp = 600, tg = G.CORIUM.ceramicT, dt = 0.02;
  const run = () => { G.engRestore(S0);
    ST.csNTcl[k] = Tp; ST.csNTf[k] = Tp; ST.csNClMl[k] = 0;
    ST.csNMlF[k] = 100; ST.csNMlE[k] = 100*(hF(Tm) + fuse); ST.csNMlL[k] = 100*fuse;
    const mF = ST.csNFu[k], mK = ST.csNCl[k];
    G.eCoreRelocA(c, dt);
    const dF = ST.csNFu[k] - mF;
    return {dF, gF:ST.csNFu[k]*hF(ST.csNTf[k]) - mF*hF(Tp), gK:mK*(hK(ST.csNTcl[k]) + ST.csNClMl[k]*lat) - mK*hK(Tp)}; };
  const a = run(), frz = G.CORIUM.hFrzOx*PT.coreAHeat[c]*W[k]*(tg - Tp)*dt/1000/(fuse + hF(Tm) - hF(tg));
  const note = (a.dF).toFixed(3) + " kg frozen of 100 in the tick";
  check("the melt frozen onto a colder pin in one tick: h A (T_sol - T_pin) dt / (latent + h(T_m) - h(T_sol))", a.dF, frz, 1e-9,
    "a freezing film: the heat the pin takes is the latent and sensible heat the frozen melt gives up (MELCOR oxide film 7500 W/m2K, SAND2017-12028C)", {note});
  check("the fuel lump takes the frozen fuel at its solidus enthalpy", a.gF, a.dF*hF(tg), 1e-9, "first law on the frozen mass", {unit:"kJ"});
  check("the can takes the rest of the frozen melt's heat: latent + h(T_m) - h(T_sol)", a.gK, a.dF*(fuse + hF(Tm) - hF(tg)), 1e-9, "first law on the pin", {unit:"kJ"});
  const ks = G.eCoreRelocA.toString();
  inBundle("eCoreRelocA = " + ks.replace("F >= K ? CORIUM.hFrzOx : CORIUM.hFrzMet", "CORIUM.hFrzMet").replace(/^function eCoreRelocA/, "function"));
  const f = run(); inBundle("eCoreRelocA = " + ks.replace(/^function eCoreRelocA/, "function"));
  check("fault injected, the metal film on an oxide melt: the frozen mass check fails", Math.abs(f.dF - frz)/frz > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:f.dF.toFixed(3) + " kg"});
}

if(mode === "block"){
  /* debris filling half of ring 0's flow volume on every plane: the ring's planes in series, each over its open share squared, under the core's own drop */
  const b = 0.5, split = lay => { G.engRestore(S0);
    if(lay) for(let j=0;j<XNZ;j++) ST.csNFu[j] += b*G.CORIUM.rhoDebris*PT.coreAFlow[c]*W[j]*H;
    tick(1, dec100); return ST.csChW[0]/ST.csChW[1]; };
  const r = () => split(true)/split(false), a = r();
  check("ring 0's flow over ring 1's, blocked over clean, with half its flow volume filled on every plane", a, 1 - b, 1e-6,
    "a fixed drop across parallel channels: w ~ 1/sqrt(sum of K), K of a plane ~ 1/(open area)^2", {note:"eBlock " + (G.engRestore(S0), ST.csNFu[0] += b*G.CORIUM.rhoDebris*PT.coreAFlow[c]*W[0]*H, G.eBlock(c, 0)).toFixed(6)});
  const ks = G.eCoreStep.toString();
  inBundle("eCoreStep = " + ks.replace("rb2 += 1/((1 - b)*(1 - b))", "rb2 += 1").replace(/^function eCoreStep/, "function"));
  const f = r(); inBundle("eCoreStep = " + ks.replace(/^function eCoreStep/, "function"));
  check("fault injected, the blockage dropped from the split: the check fails", Math.abs(f - (1 - b)) > 1e-6 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"ratio " + f.toFixed(4)});
}

if(mode === "tmi"){
  /* STOCK PWR at 7 MPa on 6000 s decay heat: 20 s pumped (TMI-2 uncovered ~100 min after its trip, its stored heat gone), 10 s covered at boil-off feed, then the collapsed level held at 15 % of the core, marched 1600 s in slices */
  const fs = require("fs"), os = require("os"), path = require("path");
  const fault = process.argv.includes("--fault"), SECS = 1600, CL = 0.15, t0 = Date.now();
  const fBin = path.join(os.tmpdir(), "rc-phys-reloc-tmi" + (fault ? "f" : "") + ".bin"), fJs = fBin.replace(/bin$/, "json");
  if(fault) inBundle("CORIUM.vCandle = 0");
  /* the feed reads last tick's wetted planes, which a snapshot does not hold */
  let A;
  if(process.argv.includes("--resume") && fs.existsSync(fBin)){ G.engRestore(new Uint8Array(fs.readFileSync(fBin))); A = JSON.parse(fs.readFileSync(fJs, "utf8")); G.E_WET.set(A.wet); }
  else { A = {t:0}; for(let i=0;i<1500;i++) tick(1, dec100, i < 1000); }
  while(A.t < SECS - 1e-9 && Date.now() - t0 < 7000){ tick(CL, dec100); A.t += 0.02; }
  if(A.t < SECS - 1e-9){ fs.writeFileSync(fBin, Buffer.from(G.engSnap(G.engSnapNew()))); A.wet = Array.from(G.E_WET); fs.writeFileSync(fJs, JSON.stringify(A));
    process.stdout.write("@@MORE\n"); process.exit(0); }
  for(const f of [fBin, fJs]) if(fs.existsSync(f)) fs.unlinkSync(f);
  let jl = 0; for(let j=0;j<XNZ;j++) if(G.E_WET[j] > 0) jl = j;
  const plane = j => { let b = 0, hist = 0, fu = 0, w = 0, ml = 0;
    for(let i=0;i<XNR;i++){ const q = i*XNZ + j; b = Math.max(b, G.eBlock(c, q)); hist = Math.max(hist, ST.csNMelt[q], ST.csNMlF[q] + ST.csNMlK[q] > 0 ? 1 : 0);
      fu += ST.csNFu[q]/mF0; w += W[q]; ml += ST.csNMlF[q] + ST.csNMlK[q]; }
    return {b, hist, fu:fu/w, ml}; };
  const P = []; for(let j=0;j<XNZ;j++) P.push(plane(j));
  let dry = 0; for(let j=0;j<XNZ;j++) if(G.E_WET[j] >= 1) dry = Math.max(dry, P[j].hist);
  let crust = -1; for(let j=XNZ-1;j>=0;j--) if(P[j].b >= 0.9) crust = j;
  let loose = 0, pool = 0;
  for(let q=0;q<XNN;q++){ const m = ST.csNMlF[q] + ST.csNMlK[q]; if(!(m > 0)) continue; pool += m;
    if(q % XNZ === 0 || G.eBlock(c, q - 1) < 0.9) loose += m; }
  const top = P[XNZ - 1], note = "level plane " + jl + " (wet " + G.E_WET[jl].toFixed(2) + "), crust plane " + crust + ", free melt " + (pool/1000).toFixed(2) +
    " t, pool below the core " + (ST.csPlF[c]/1000).toFixed(2) + " t; per plane fuel share " + P.map(p => p.fu.toFixed(2)).join(" ");
  const src = "TMI-2 end state: intact rods under the water, a crust at the level, a molten pool on it (NUREG/CR-6197, Broughton et al. NT 87 (1989))";
  const atLevel = crust >= jl && crust <= jl + 1;
  if(fault) check("fault injected, the film speed 0: the melt stays where it formed and no crust forms at the level", atLevel ? 0 : 1, 1, 0, "the crust check must be able to fail", {abs:true, note});
  else {
    check("planes wholly under the mixture level carry no melt history", dry, 0, 0, src, {abs:true, note});
    let up = 0; for(let j=jl+1;j<XNZ;j++) for(let i=0;i<XNR;i++) up = Math.max(up, ST.csNMelt[i*XNZ + j]);
    check("the core above the level has melted: a node above the level plane has lost all its fuel to melt", up >= 1 ? 1 : 0, 1, 0, src, {abs:true, note:"top plane fuel share " + top.fu.toFixed(3)});
    check("the lowest plane blocked 0.9 or more lies at the level plane or one above", atLevel ? 1 : 0, 1, 0, src, {abs:true, note});
    check("free melt sits on a blocked node: share of it that does not", pool > 0 ? loose/pool : 1, 0, 0.01, src, {abs:true, note}); }
}
