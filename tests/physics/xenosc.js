"use strict";
// chunks: mesh tall short sweep design ginna height
/* the axial xenon wave on the flux solver alone: a bare uniform cylinder, one group, node iodine and xenon, no thermal
   feedback, power held. The reference is the linearised system of the SAME discrete operator: the flux shape's response
   to a node's xenon off the operator's own eigenproblem, the iodine-xenon Jacobian round it, and its eigenvalues. Marched
   by forward Euler at dt, the model's own amplitude map is I + dt J exactly, so its growth per step and phase per step are
   the eigenvalue of that map. */
const {check, load, watch} = require("./lib.js");
const mode = process.argv[2];
const G = load();
const XNR = G.XNR, XNZ = G.XNZ, XNN = G.XNN, nodeW = G.nodeW, FXK = G.FXK, fluxApply = G.fluxApply, fluxSolve = G.fluxSolve;
const K_CR = G.FK_CR, K_CZ = G.FK_CZ, K_GR = G.FK_GR, K_GT = G.FK_GT, K_GB = G.FK_GB;
const XE = G.XE, lamI = XE.lamI, lamX = XE.lamX, gI = XE.gI, gX = XE.gX, W2 = 2.65e-18*1.159;
const RS = "Randall & St. John, Nucleonics 16(3), 1958: the linearised xenon-flux modal stability of a bare core (as commonly quoted, not read at source); here its exact form on the model's own discrete operator";

/* a bare cylinder of height H and radius R m, migration area m2 cm2, thermal D dc cm */
function core(H, R, m2, dc){
  const Lm = Math.sqrt(m2)/100, dz = H/XNZ, dr = R/XNR, d = G.EXTRAP_D*dc/100;
  return {H, R, m2, dz, dr, cz:(Lm/dz)**2, cr:(Lm/dr)**2, gT:G.edgeGhostZ(d, dz, H, d), gB:G.edgeGhostZ(d, dz, H, d), gR:G.edgeGhostR(d, dr, R), d}; }
const setK = C => { FXK[K_CR] = C.cr; FXK[K_CZ] = C.cz; FXK[K_GR] = C.gR; FXK[K_GT] = C.gT; FXK[K_GB] = C.gB; };

/* the rest and its Jacobian are the model's own (xeWaveRest(), xeWaveJ()), at C's coupling and ghosts, no power feedback */
const rest = (C, s, KXE) => { setK(C); return G.xeWaveRest(s, KXE, null); };
const jacobian = (C, R) => { setK(C); return G.xeWaveJ(R, null); };

/* the least-damped eigenvalue of I + dt J on the axially odd states, the subspace an odd kick excites (the uniform core's
   z-mirror commutes with J): growth per step r and phase per step th, th 0 for a mode that does not oscillate */
function refMode(J, dt){ const N = Math.sqrt(J.length), n = N/2, h = XNZ/2, P = [];
  for(let s=0;s<2;s++) for(let i=0;i<XNR;i++) for(let j=0;j<h;j++){ const a = s*n + i*XNZ + XNZ - 1 - j, b = s*n + i*XNZ + j; P.push([a, b]); }
  const K = P.length, M = new Float64Array(K*K);
  for(let c=0;c<K;c++){ const [a0, b0] = P[c];
    for(let r=0;r<K;r++){ const [a, b] = P[r]; M[r*K+c] = dt*(J[a*N+a0] - J[a*N+b0] - J[b*N+a0] + J[b*N+b0])/2 + (r === c ? 1 : 0); } }
  let best = null;
  for(const [re, im] of G.eigReal(M, K)){ const r = Math.hypot(re, im); if(!best || r > best.r) best = {r, th:Math.abs(Math.atan2(im, re))}; }
  return best; }

/* the model marched: forward Euler on the node iodine and xenon, the flux solved on the xenon each step, from an odd kick.
   The departure from rest is kept in the linear range by rescaling it by 100 whenever it leaves 1e-9..1e-7 of the xenon
   (Benettin), and AO_{n+1} = p AO_n + q AO_{n-1} is fitted past the burn-in on the triples no rescale splits, each triple
   normalised: r = sqrt(-q), cos(th) = p/(2r) */
function march(C, R, dt, steps, burn, noBurn){ setK(C);
  const I0 = new Float64Array(XNN), I = new Float64Array(XNN), X = Float64Array.from(R.X), phi = Float64Array.from(R.phi), rho = new Float64Array(XNN), ao = [], aot = [], cut = [];
  let gain = 1;
  const sig = noBurn ? 0 : R.sig;
  for(let k=0;k<XNN;k++){ I0[k] = I[k] = gI*phi[k]/lamI; X[k] *= 1 + 1e-8*(k % XNZ >= XNZ/2 ? 1 : -1); }
  let t = 0;
  watch(G, {dt, cap:steps*dt, step:() => {
    let dev = 0; for(let k=0;k<XNN;k++) dev = Math.max(dev, Math.abs(X[k] - R.X[k])/R.X[k]);
    const f = dev > 1e-7 ? 0.01 : dev < 1e-9 ? 100 : 1;
    if(f !== 1){ for(let k=0;k<XNN;k++){ I[k] = I0[k] + f*(I[k] - I0[k]); X[k] = R.X[k] + f*(X[k] - R.X[k]); } cut.push(t); gain *= f; }
    for(let k=0;k<XNN;k++) rho[k] = -R.KXE*X[k];
    fluxSolve(phi, 0, rho, 0, 1e-14, 400);
    let top = 0, bot = 0; for(let k=0;k<XNN;k++){ const w = nodeW[k]*phi[k]; if(k % XNZ >= XNZ/2) top += w; else bot += w; }
    ao.push((top - bot)/(top + bot)); aot.push(ao[ao.length-1]/gain);
    for(let k=0;k<XNN;k++){ const fl = phi[k], i0 = I[k];
      I[k] = i0 + dt*(gI*fl - lamI*i0); X[k] = X[k] + dt*(gX*fl + lamI*i0 - lamX*X[k] - sig*fl*X[k]); }
    t++; }});
  const split = new Uint8Array(ao.length + 1); for(const t of cut) split[t] = 1;
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for(let t=burn+1;t<ao.length-1;t++){ if(split[t] || split[t+1]) continue;
    const y1 = ao[t], y0 = ao[t-1], y2 = ao[t+1], w = 1/(y1*y1 + y0*y0);
    a11 += w*y1*y1; a12 += w*y1*y0; a22 += w*y0*y0; b1 += w*y1*y2; b2 += w*y0*y2; }
  const det = a11*a22 - a12*a12, p = (b1*a22 - b2*a12)/det, q = (a11*b2 - a12*b1)/det, r = Math.sqrt(Math.max(-q, 0));
  let c1 = 0, c2 = 0, flips = 0;
  for(let t=burn+1;t<ao.length;t++){ if(!split[t]){ c1 += ao[t]*ao[t-1]/(ao[t-1]*ao[t-1]); c2++; } if(ao[t]*ao[t-1] < 0) flips++; }
  return {r, th:Math.acos(Math.max(-1, Math.min(1, p/(2*r)))), r1:c1/c2, flips, ao, aot}; }

/* a 4-loop PWR's core as a bare cylinder, 3.66 m by 1.68 m, water's M2 */
const TALL = core(3.66, 1.68, G.MIG_WATER.m2, G.MIG_WATER.dc), SHORT = core(1.2, 1.68, G.MIG_WATER.m2, G.MIG_WATER.dc);
/* worth per unit xenon at critical Sf/Sa 0.55, so the equilibrium worth is 1e5 (gI + gX) 0.55 s/(1 + s) */
const kxe = s => 1e5*0.55*s*lamX, DT = 60;
const H = th => 2*Math.PI/th*DT/3600, perH = r => Math.log(r)/DT*3600;

if(mode === "mesh"){
  /* the axial part of the operator alone, a tridiagonal of cz with its sin-exact ghosts: its two lowest eigenvalues */
  const C = TALL, T = new Float64Array(XNZ*XNZ);
  for(let j=0;j<XNZ;j++){ T[j*XNZ+j] = 2*C.cz - (j === 0 ? C.cz*C.gB : 0) - (j === XNZ-1 ? C.cz*C.gT : 0);
    if(j > 0) T[j*XNZ+j-1] = -C.cz; if(j < XNZ-1) T[j*XNZ+j+1] = -C.cz; }
  const ev = G.eigReal(T, XNZ).map(e => e[0]).sort((a, b) => a - b), Ht = C.H + 2*C.d, M2 = C.m2*1e-4, dz = C.dz, lap = B => M2*(2 - 2*Math.cos(B*dz))/(dz*dz);
  check("axial fundamental of the discrete operator against the 3-point Laplacian of the extrapolated slab's sine", ev[0], lap(Math.PI/Ht), 1e-9,
    "M2 (2 - 2 cos B0 dz)/dz^2, B0 = pi/(H + 2d): the edge ghosts make the sampled sine the discrete fundamental", {unit:"", note:"continuum M2 B0^2 " + (M2*(Math.PI/Ht)**2).toExponential(4)});
  const sep = ev[1] - ev[0], cont = 3*Math.PI*Math.PI*M2/(Ht*Ht), dsc = lap(2*Math.PI/Ht) - lap(Math.PI/Ht);
  check("first axial harmonic's separation against the 3-point Laplacian of the slab's harmonics", sep, dsc, 2e-3,
    "the sampled sines' own discrete eigenvalues; the ghosts are exact for the fundamental only, so the harmonic is within the ghost's error", {unit:"", note:"ratio to the continuum 3 pi^2 M^2/H^2 " + (sep/cont).toFixed(4) + " at " + XNZ + " planes"});
  /* the solver's own check: eigenvalues of a matrix with a known spectrum */
  const Q = new Float64Array(16); [[0,1,-2],[1,0,2],[2,3,0.5],[3,2,-0.5]].forEach(([i, j, v]) => Q[i*4+j] = v); Q[0] = 0.1; Q[5] = 0.1; Q[10] = -0.3; Q[15] = -0.3;
  const eq = G.eigReal(Q, 4).map(e => e[1]).sort((a, b) => a - b);
  check("the eigen solver on a known spectrum, 0.1 +- 2i and -0.3 +- 0.5i: imaginary parts", Math.max(Math.abs(eq[0] + 2), Math.abs(eq[1] + 0.5), Math.abs(eq[2] - 0.5), Math.abs(eq[3] - 2)), 0, 1e-12,
    "2x2 rotation blocks: a +- bi", {abs:true});
}

/* the same kick carried by the linear map I + dt J itself: AO to first order, sum w dphi over the top half less the bottom */
function linAO(R, J, dt, steps){ const n = XNN, N = 2*n, S = J.S, v = new Float64Array(N), w = new Float64Array(N), out = [];
  for(let k=0;k<n;k++) v[n+k] = R.X[k]*1e-8*(k % XNZ >= XNZ/2 ? 1 : -1);
  for(let t=0;t<steps;t++){ let a = 0;
    for(let i=0;i<n;i++){ let d = 0; for(let j=0;j<n;j++) d += S[i*n+j]*v[n+j]; a += nodeW[i]*d*(i % XNZ >= XNZ/2 ? 1 : -1); }
    out.push(a);
    for(let i=0;i<N;i++){ let d = 0; for(let j=0;j<N;j++) d += J[i*N+j]*v[j]; w[i] = v[i] + dt*d; }
    v.set(w); }
  return out; }
/* a mode that oscillates is marched five periods past one and a half; one that does not, a day past four */
const pair = (C, s, noBurn) => {
  const R = rest(C, s, kxe(s)), J = jacobian(C, R), ref = refMode(J, DT), P = ref.th > 1e-9 ? 2*Math.PI/ref.th*DT : 24*3600;
  return {R, J, ref, sim:march(C, R, DT, Math.ceil((ref.th > 1e-9 ? 6.5 : 5)*P/DT), Math.ceil((ref.th > 1e-9 ? 1.5 : 4)*P/DT), noBurn)}; };
const shape = C => "H/M " + (C.H*100/Math.sqrt(C.m2)).toFixed(0);

if(mode === "tall" || mode === "short"){
  const C = mode === "tall" ? TALL : SHORT, s = 3, name = (mode === "tall" ? "4-loop core, " : "short core, ") + shape(C);
  const {R, J, ref, sim} = pair(C, s), note = "burnout " + s + ", reference " + perH(ref.r).toFixed(4) + " /h";
  if(ref.th > 1e-9){
    check(name + ": period of the first axial xenon mode, marched against the linearised operator", H(sim.th), H(ref.th), 1e-3, RS, {unit:"h", note});
    const g = Math.log(ref.r)*2*Math.PI/ref.th;
    check(name + ": growth per period, marched against the linearised operator", Math.log(sim.r)*2*Math.PI/sim.th, g, 2e-3*Math.max(1, Math.abs(g)), RS, {abs:true, unit:"ln/period"}); }
  else {
    check(name + ": the first axial mode does not oscillate: AO sign changes past the burn-in", sim.flips, 0, 0, RS, {abs:true, note});
    const lin = linAO(R, J, DT, sim.aot.length); let e = 0, m = 0;
    for(let t=0;t<lin.length;t++){ e = Math.max(e, Math.abs(sim.aot[t] - lin[t])); m = Math.max(m, Math.abs(lin[t])); }
    check(name + ": AO over five days, marched against the linear map from the same kick", e/m, 0, 1e-3, RS,
      {abs:true, unit:"of the largest AO", note:"AO after five days " + (lin[lin.length-1]/m).toExponential(2) + " of its largest"}); }
  if(mode === "tall"){
    const noB = pair(C, s, true).sim;
    check("fault injected, the march without xenon burnout: the period check fails", !(Math.abs(H(noB.th)/H(ref.th) - 1) <= 1e-3) ? 1 : 0, 1, 0,
      "the period check above must be able to fail", {abs:true, note:"period " + H(noB.th).toFixed(2) + " h against " + H(ref.th).toFixed(2) + " h"}); }
}

if(mode === "sweep"){
  /* the burnout at which the reference's first axial mode stops damping, and the march on each side of it */
  const C = TALL, grow = s => Math.log(refMode(jacobian(C, rest(C, s, kxe(s))), DT).r);
  const ss = [0.1, 0.3, 1, 3, 10], gs = ss.map(grow);
  const k = gs.findIndex(g => g > 0);
  check("4-loop core: the reference crosses from damped to growing inside the swept burnout", k > 0 ? 1 : 0, 1, 0, RS,
    {abs:true, note:ss.map((s, i) => s + ": " + perH(Math.exp(gs[i])).toFixed(4) + " /h").join(", ")});
  if(k > 0){
    let lo = ss[k-1], hi = ss[k];
    for(let i=0;i<6;i++){ const m = Math.sqrt(lo*hi); if(grow(m) > 0) hi = m; else lo = m; }
    const sStar = Math.sqrt(lo*hi);
    for(const f of [0.8, 1.25]){ const {ref, sim} = pair(C, sStar*f);
      check("4-loop core at " + f + "x the threshold burnout " + sStar.toFixed(3) + ": the march damps or grows as the reference does",
        Math.sign(Math.log(sim.r)), Math.sign(Math.log(ref.r)), 0, RS,
        {abs:true, note:"marched " + perH(sim.r).toFixed(5) + " /h, reference " + perH(ref.r).toFixed(5) + " /h, thermal flux " + (sStar*lamX/W2/1e13).toFixed(2) + "e13 at the 2200 m/s rate"}); } }
}

if(mode === "design"){
  G.plantPreset(0); G.buildLayout(); const d = G.derived(), T = d.core, K = d.xeW*lamX*(1 + d.sigK)/(gI + gX);
  const bare = G.xeWaveMode(T, d.sigK, K, 0, 0, 0), dop = G.xeWaveMode(T, d.sigK, K, d.pwrDef, 0, 0);
  check("STOCK PWR: the pellet's negative power feedback damps the xenon wave", dop.g - bare.g, 0, 0,
    "a negative power coefficient opposes the local power swing that drives the wave (Randall & St. John)", {pass:dop.g < bare.g, unit:"/h",
    note:"no feedback " + bare.g.toFixed(4) + " /h, " + bare.T.toFixed(1) + " h; Doppler " + d.pwrDef.toFixed(0) + " pcm: " + dop.g.toFixed(4) + " /h, " + dop.T.toFixed(1) + " h; at rest " + d.xeWave.g.toFixed(4) + " /h, " + d.xeWave.T.toFixed(1) + " h"});
}

/* the bench's wave (xeWaveMode()) on a core built like Ginna's, the measured one: STOCK PWR's lattice (equal-area radius within a ring
   of 121 assemblies at a 0.198 m pitch, picked), the 3.2 % LEU row, 1300 MWt per 12 ft (set over the rating law), the boron DCD
   Table 4.3-5 gives, every other figure the model's own. No part-length rods: WCAP-7964 finds them destabilising at mid-plane */
const GIN = "WCAP-7964, Lee et al., Westinghouse 1971 (NRC ML22325A280): Ginna, 12 ft, 121 assemblies, 1300 MWt; test 1 at 1550 MWd/t -0.041 /h, 32.4 h, AO -8 %, Fz 1.34; test 2 at 7700 MWd/t -0.014 /h, 27.2 h";
const FT = 0.3048, H12 = 12*FT;
function ginna(H){ G.plantPreset(0); G.buildLayout(); const c = G.coreD("core"); c.fuel = 0; c.zoneFuel = {}; c.lat.len = H; G.latRevolve(c); return c; }
function waveAt(c, bu, ppm, fb){ c.power = 1300*c.lat.len/H12; c.burnup = bu;
  const d = G.derived(), T = d.core, K = d.xeW*lamX*(1 + d.sigK)/(gI + gX), aM = G.lawMtcOf(c, ppm, undefined, bu), on = fb ?? 1;
  const w = G.xeWaveMode(T, d.sigK, K, on*d.pwrDef, on*aM, T.dT0 || 0);
  return {w, d, aM, note:"index " + w.g.toFixed(4) + " /h, period " + w.T.toFixed(1) + " h at " + bu + " MWd/kgHM, " + (c.power/(G.latFuelKg(c)*G.fuelBlend(c).hm/1000)).toFixed(1) + " MW/tHM, burnout " + d.sigK.toFixed(2) +
    ", pwrDef " + d.pwrDef.toFixed(0) + " pcm, MTC " + aM.toFixed(1) + " pcm/K at " + ppm + " ppm (the model's own rest " + d.ppm.toFixed(0) + " ppm), AO " + (100*d.aoD).toFixed(1) + " %, Fz " + d.fz.toFixed(2)}; }

if(mode === "ginna"){
  const c = ginna(H12), eq = G.latEqR(c), a = waveAt(c, 1.55, 1065), band = w => isFinite(w.T) && w.T >= 20 && w.T <= 45;
  check("Ginna-like core at 1550 MWd/t: the axial xenon mode oscillates with a period of about a day", a.w.T, 32.4, 0, GIN + "; band 20-45 h",
    {pass:band(a.w), unit:"h", note:a.note + "; equal-area radius " + eq.toFixed(3) + " m against 1.230 m"});
  const inI = w => w.g >= -0.08 && w.g < 0;
  check("Ginna-like core at 1550 MWd/t: weakly damped, not growing (index in [-0.08, 0) /h)", a.w.g, -0.041, 0, GIN + "; band: rings at least once a period and is stable, part-length rods out so a little more stable than test 1",
    {pass:inI(a.w) && isFinite(a.w.T), unit:"/h", note:a.note});
  const b = waveAt(c, 7.7, 700), dg = b.w.g - a.w.g;
  check("Ginna-like core 1550 -> 7700 MWd/t: the core gets less stable with burnup", dg, 0.027, 0,
    GIN + "; WCAP-7964 Table 3 sec. 4.2.1 splits it: axial flattening +0.035, Doppler -0.02, boron and MTC +0.01 /h; the model carries no MTC slope with moderator T",
    {pass:dg > 0, unit:"/h", note:"7700: " + b.note});
  const T7 = b.d.core, flat = G.xeWaveMode(Object.assign({}, T7, {buN:null}), b.d.sigK, b.d.xeW*lamX*(1 + b.d.sigK)/(gI + gX), b.d.pwrDef, b.aM, T7.dT0 || 0);
  check("fault injected, the 7700 core's burnup shape stood down: the trend check fails", flat.g - a.w.g > 0 ? 0 : 1, 1, 0,
    "the trend check above must be able to fail", {abs:true, note:"7700 without its burnup shape " + flat.g.toFixed(4) + " /h, " + flat.T.toFixed(1) + " h"});
  const f = waveAt(c, 1.55, 1065, 0);
  check("fault injected, pellet and coolant feedback stood down: the 1550 period or index leaves its band", !(band(f.w) && inI(f.w)) ? 1 : 0, 1, 0,
    "the two checks above must be able to fail", {abs:true, note:f.note});
}

if(mode === "height"){
  const hs = [10, 12, 14], r = hs.map(h => waveAt(ginna(h*FT), 1.55, 1065));
  const up = w => w[0].w.g < w[1].w.g && w[1].w.g < w[2].w.g, say = w => w.map((x, i) => hs[i] + " ft " + x.w.g.toFixed(4) + " /h, " + x.w.T.toFixed(1) + " h").join("; ");
  G.plantPreset(0); G.buildLayout(); const s = G.derived();
  check("Ginna-like core at 1550 MWd/t, same power density: the index rises with height, 10 < 12 < 14 ft", r[2].w.g - r[0].w.g, 0, 0,
    "AP1000 DCD Rev. 16 sec. 4.3.2.7.3 (NRC ML071580897): a core 24 in taller is slightly less stable axially; WCAP-7964 sec. 1: Connecticut Yankee, 10 ft, -0.049 /h",
    {pass:up(r), unit:"/h", note:say(r) + "; STOCK PWR at rest " + s.xeWave.g.toFixed(4) + " /h, " + s.xeWave.T.toFixed(1) + " h at " + G.coreD("core").lat.len.toFixed(2) + " m"});
  const z = r.map(x => ({w:G.xeWaveMode(x.d.core, x.d.sigK, 0, x.d.pwrDef, x.aM, x.d.core.dT0 || 0)}));
  check("fault injected, xenon worth stood down: the height ordering fails", up(z) ? 0 : 1, 1, 0, "the check above must be able to fail", {abs:true, note:say(z)});
}

