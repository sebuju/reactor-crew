"use strict";
/* the flux shape is the fundamental mode of the r-z operator: symmetric where the problem is, an eigenvector, the discrete analytic mode on a bare uniform core */
const {check, load} = require("./lib.js");
const G = load();
const XNR = G.XNR, XNZ = G.XNZ, XNN = G.XNN, faceI = G.faceI, faceO = G.faceO, nodeW = G.nodeW, FXK = G.FXK;
const ROW = "peaking factor `Fq`";

function solve(cr, cz, gR, gT, gB, rho, phi0){
  const phi = phi0 ? Float64Array.from(phi0) : new Float64Array(XNN).fill(1);
  FXK[0] = cr; FXK[1] = cz; FXK[2] = gR; FXK[3] = gT; FXK[4] = gB;
  G.fluxSolve(phi, 0, rho, 0, G.FLUX_TOL, G.FLUX_CAP);
  return phi;
}
/* the old relaxed sweep, kept here as the fault the checks must catch */
function sor(cr, cz, gR, gT, gB, rho, sweeps){
  const phi = new Float64Array(XNN).fill(1);
  for(let s=0;s<sweeps;s++){
    for(let i=0;i<XNR;i++){ const fi = faceI[i], fo = faceO[i], den = cr*(fi + fo) + 2*cz + 1;
      for(let j=0;j<XNZ;j++){ const k = i*XNZ + j;
        const In = i > 0 ? phi[k-XNZ] : 0, Ou = i < XNR-1 ? phi[k+XNZ] : gR*phi[k];
        const Dn = j > 0 ? phi[k-1] : gB*phi[k], Up = j < XNZ-1 ? phi[k+1] : gT*phi[k];
        phi[k] += 1.5*((cr*(fi*In + fo*Ou) + cz*(Dn + Up) + (1 + rho[k]*1e-5)*phi[k])/den - phi[k]); } }
    let m = 0; for(let k=0;k<XNN;k++) m += phi[k]*nodeW[k];
    for(let k=0;k<XNN;k++) phi[k] /= m; }
  return phi;
}
/* K phi written out a second time, straight off the stencil */
function applyK(cr, cz, gR, gT, gB, rho, phi){
  const y = new Float64Array(XNN);
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k = i*XNZ + j, f = phi[k];
    const In = i > 0 ? phi[k-XNZ] : 0, Ou = i < XNR-1 ? phi[k+XNZ] : gR*f;
    const Dn = j > 0 ? phi[k-1] : gB*f, Up = j < XNZ-1 ? phi[k+1] : gT*f;
    y[k] = cr*(faceI[i]*(f - In) + faceO[i]*(f - Ou)) + cz*(2*f - Dn - Up) - rho[k]*1e-5*f; }
  return y;
}
const symErr = phi => { let e = 0; for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++) e = Math.max(e, Math.abs(phi[i*XNZ+j] - phi[i*XNZ+XNZ-1-j])); return e; };
const maxDiff = (a, b) => { let e = 0; for(let k=0;k<XNN;k++) e = Math.max(e, Math.abs(a[k] - b[k])); return e; };
const flat = new Float64Array(XNN).fill(300);
const cr0 = 0.8, cz0 = 0.6;

/* 1: uniform rho and equal lid and floor ghosts are symmetric top to bottom, so the fundamental is */
{ const phi = solve(cr0, cz0, 0.5, 0.4, 0.4, flat);
  check("uniform core, equal lid and floor: the shape is its own mirror top to bottom", symErr(phi), 0, 1e-9,
    "a symmetric operator's non-degenerate fundamental carries its symmetry", {abs:true, unit:"of mean flux"});
  const bad = sor(cr0, cz0, 0.5, 0.4, 0.4, flat, 200);
  check("fault injected, the relaxed sweep (omega 1.5, rescaled each sweep): the mirror check fails", symErr(bad) > 1e-9 ? 1 : 0, 1, 0,
    "the check above must be able to fail", {abs:true, note:"top/bottom error " + symErr(bad).toExponential(2)}); }

/* 2: a lumpy core with unequal edges: the result is an eigenvector, and single-signed */
{ const rho = new Float64Array(XNN);
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++) rho[i*XNZ+j] = 800*Math.sin(1.3*i + 0.7*j) - 1500*(j > 6 && i < 5 ? 1 : 0);
  const phi = solve(cr0, cz0, 0.3, 0.6, 0.1, rho), y = applyK(cr0, cz0, 0.3, 0.6, 0.1, rho, phi);
  let num = 0, den = 0; for(let k=0;k<XNN;k++){ num += nodeW[k]*phi[k]*y[k]; den += nodeW[k]*phi[k]*phi[k]; }
  const lam = num/den; let r = 0, n = 0, lo = Infinity;
  for(let k=0;k<XNN;k++){ r = Math.max(r, Math.abs(y[k] - lam*phi[k])); n = Math.max(n, Math.abs(phi[k])); lo = Math.min(lo, phi[k]); }
  check("lumpy core: the eigen-residual |K phi - lambda phi| / |phi|", r/n, 0, 1e-9, "the shape solves its own eigen-equation", {abs:true});
  check("lumpy core: every node positive", lo > 0 ? 1 : 0, 1, 0,
    "Perron-Frobenius: of an irreducible Z-matrix's eigenvectors only the fundamental is single-signed", {abs:true, note:"min phi " + lo.toExponential(3)}); }

/* 3: bare edges (ghost 0) and uniform rho separate: sin axially, exactly; J0 radially, to the mesh */
{ const phi = solve(cr0, cz0, 0, 0, 0, flat);
  let ez = 0;
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++)
    ez = Math.max(ez, Math.abs(phi[i*XNZ+j]/phi[i*XNZ] - Math.sin(Math.PI*(j+1)/(XNZ+1))/Math.sin(Math.PI/(XNZ+1))));
  check("bare uniform core: the axial profile against sin(pi (j+1)/(XNZ+1))", ez, 0, 1e-9,
    "the exact eigenvector of the three-point axial operator with a zero ghost", {abs:true, unit:"of the edge node"});
  const J0 = x => { let s = 0, t = 1; for(let m=0;m<40;m++){ s += t; t *= -(x*x/4)/((m+1)*(m+1)); } return s; };
  const Rt = XNR + 0.5, h2 = Math.pow(2.405/Rt, 2);
  let er = 0; const z = 4;
  for(let i=0;i<XNR;i++) er = Math.max(er, Math.abs(phi[i*XNZ+z]/phi[z] - J0(2.405*(i + 0.5)/Rt)/J0(2.405*0.5/Rt)));
  check("bare uniform core: the radial profile against J0(2.405 r / R), R at the ghost's centre", er, 0, h2,
    "Bessel J0 fundamental of a bare cylinder; tolerance the second-order scheme's leading truncation (B h)^2 = (2.405/" + Rt + ")^2", {abs:true, unit:"of the centre node"}); }

/* 4: with rho 0 the eigenvector is the coupling's own, so scaling cr and cz together cannot move it */
{ const zero = new Float64Array(XNN), a = solve(cr0, cz0, 0.5, 0.3, 0.2, zero), b = solve(7*cr0, 7*cz0, 0.5, 0.3, 0.2, zero);
  check("rho 0: coupling scaled 7x, the shape does not move", maxDiff(a, b), 0, 1e-9, "an eigenvector of A is an eigenvector of 7A", {abs:true, unit:"of mean flux"});
  const sa = sor(cr0, cz0, 0.5, 0.3, 0.2, zero, 200), sb = sor(7*cr0, 7*cz0, 0.5, 0.3, 0.2, zero, 200);
  check("fault injected, the relaxed sweep: the scaling check fails", maxDiff(sa, sb) > 1e-9 ? 1 : 0, 1, 0,
    "the check above must be able to fail", {abs:true, note:"shape moved " + maxDiff(sa, sb).toExponential(2)}); }

/* the tick's warm start: a converged shape is a fixed point of one more call */
{ const rho = new Float64Array(XNN); for(let k=0;k<XNN;k++) rho[k] = 400*Math.cos(k);
  const a = solve(cr0, cz0, 0.4, 0.5, 0.3, rho), b = solve(cr0, cz0, 0.4, 0.5, 0.3, rho, a);
  check("warm start on a converged shape: one more solve does not move it", maxDiff(a, b), 0, 1e-12, "a fixed point of inverse iteration", {abs:true}); }

/* the reflected edge: a uniform core's axial fundamental is cos(B (z - H/2)), so the solved B gives the extrapolated height H + 2 delta */
const edgeFit = (h, g) => { const phi = solve(cr0, cz0, 0, g, g, flat), j = XNZ/2;
  const th = Math.acos((phi[j-1] + phi[j+1])/(2*phi[j])), B = th/h;
  return {B, delta:(Math.PI/B - XNZ*h)/2}; };
/* the ghost sits on the sine itself, so the solved B is the continuous one and the extrapolated height is exact to rounding */
const edgeTol = 1e-9;
function edgeCheck(label, dc, rf, t, H, src){
  const h = H/XNZ, d = G.edgeDist(dc, t, rf), g = G.edgeGhostZ(d, h, H, d), f = edgeFit(h, g);
  check(label, f.delta*100, d*100, edgeTol*100, src, {abs:true, unit:"cm",
    note:"core D " + dc.toFixed(3) + " cm, " + (rf.name || "") + " " + (t*100).toFixed(1) + " cm on H " + H.toFixed(2) + " m, ghost " + g.toFixed(4)}); }

/* phase 3: the edge sits at the one-group savings, a bare edge at the Milne distance, at any drawn height */
{ const R = G.REFL, dPwr = G.MIG_WATER.dc, dGr = G.MODER[0].mig.dc*G.MODER[0].mig.rho/1700;
  const SRC = "one-group reflected slab, delta = (Dc/Dr) Lr tanh(T/Lr) (Glasstone & Sesonske; its thick limit is Lamarsh 3rd ed. eq. 6.106)";
  for(const [rf, t] of [[R[3], 0.10], [R[3], 1.0], [R[2], 0.10], [R[2], 0.5], [R[1], 0.02], [R[1], 0.3]])
    edgeCheck("reflected edge: the solved extrapolated height against the slab savings, " + rf.name + " " + (t*100) + " cm on a water lattice", dPwr, rf, t, 2.5, SRC);
  edgeCheck("reflected edge: graphite 1 m on a graphite lattice, D_c = D_r gives delta = L_r", dGr, R[3], 1.0, 6.4, SRC);
  for(const H of [1.5, 4.0])
    edgeCheck("the same graphite band 20 cm on a " + H + " m core: the savings do not follow the mesh", dPwr, R[3], 0.2, H, SRC);
  edgeCheck("bare edge: the extrapolated zero at 0.7104 x 3 D past the face", dPwr, R[0], 0, 2.5, "Milne problem: d = 0.7104 lambda_tr = 2.13 D (Lamarsh 3rd ed. eq. 5.21-5.22)");
  const dm = 0.7104*3*dPwr/100, bad = edgeFit(0.25, 0.53);
  check("fault injected, the old flat albedo 0.53 on a bare face: the Milne check fails", Math.abs(bad.delta - dm) > edgeTol ? 1 : 0, 1, 0,
    "the check above must be able to fail", {abs:true, note:"albedo 0.53 puts the zero " + (bad.delta*100).toFixed(1) + " cm out, Milne " + (dm*100).toFixed(2)});
  const dg = G.edgeDist(dPwr, 1.0, R[3]), lin = edgeFit(0.25, (dg - 0.125)/(dg + 0.125));
  check("fault injected, a straight-line ghost under 1 m of graphite: the savings check fails", Math.abs(lin.delta - dg) > edgeTol ? 1 : 0, 1, 0,
    "the check above must be able to fail", {abs:true, note:"straight line reads " + (lin.delta*100).toFixed(1) + " cm against " + (dg*100).toFixed(1)}); }

/* phase 2: the leakage term is M^2 B^2 on a bare uniform cylinder, B on the extrapolated dimensions */
{ const m2 = G.MIG_WATER.m2, dc = G.MIG_WATER.dc, R = 1.2, H = 2.5, dr = R/XNR, dz = H/XNZ, Lm = Math.sqrt(m2)/100;
  const d = G.EXTRAP_D*dc/100, T = {cr:Math.pow(Lm/dr, 2), cz:Math.pow(Lm/dz, 2), gR:G.edgeGhostR(d, dr, R), gT:G.edgeGhostZ(d, dz, H, d), gB:G.edgeGhostZ(d, dz, H, d)};
  const phi = new Float64Array(XNN).fill(1), rho = new Float64Array(XNN); G.coreSolve(T, phi, rho);
  const Br = 2.405/((R + d)*100), Bz = Math.PI/((H + 2*d)*100), mb = m2*(Br*Br + Bz*Bz);
  const tol = (Math.pow(Br*dr*100, 2) + Math.pow(Bz*dz*100, 2))/6;
  check("bare uniform cylinder: the leakage term against M^2 B^2 on the extrapolated radius and height", G.coreLeak(T, phi)/1e5, mb, tol,
    "one-group bare cylinder, B^2 = (2.405/R~)^2 + (pi/H~)^2; tolerance twice the second-order scheme's leading truncation, ((B h)^2)/12 per direction",
    {note:"M2 " + m2 + " cm2, R " + R + " m, H " + H + " m, leakage fraction M2B2/(1+M2B2) " + (mb/(1 + mb)*100).toFixed(2) + " %"}); }

/* phase 2: each family's lattice reads its family's migration length */
{ const fam = [[0, 55, 0.10, "IAEA 2D PWR benchmark fuel, tau 50 + L2 5 (ANL-7416 Suppl. 2)", ""],
    [2, 55, 0.10, "the same water lattice at 0 % void; a BWR's M at its ~40 % core-average void is longer", "migration length"],
    [5, 368*Math.pow(1.6/1.7, 2) + 0.1*3500*Math.pow(1.6/1.7, 2), 0.10, "graphite tau + (1-f) L2 at the drawn 1.70 g/cm3 (Lamarsh 3rd ed. Tables 5.2-5.3, f 0.9 not sourced)", ""],
    [7, 368*Math.pow(1.6/1.7, 2) + 0.1*3500*Math.pow(1.6/1.7, 2), 0.10, "graphite tau + (1-f) L2 at the drawn 1.70 g/cm3 (Lamarsh 3rd ed. Tables 5.2-5.3, f 0.9 not sourced)", ""],
    [6, 502, 0.02, "MSRE, ORNL-TM-730 sec. 6.2: tau 292 + L2 210 cm2 (the salt figure is FIT to this)", ""],
    [3, 384, 0.10, "Lamarsh 3rd ed. Example 6.3, a Pu-239/sodium sphere, L2 384 cm2: a dilute textbook fast mixture, not a real core", ""]];
  for(const [p, m2, tol, src, gap] of fam){ G.plantPreset(p); G.buildLayout();
    const c = G.priD(), m = G.latMig(c);
    check(G.PLANTPRE[p][0] + ": the lattice's migration length", Math.sqrt(m.m2), Math.sqrt(m2), tol, src, {unit:"cm", gap,
      note:"M2 " + m.m2.toFixed(1) + " cm2, one-group D " + m.dc.toFixed(2) + " cm"}); } }

/* the savings law against measurement: a water core in a thick water reflector, cold, against Deutsch's empirical fit */
{ const k = G.MIG_WATER.rho/998.2, m2 = G.MIG_WATER.m2*k*k, dc = G.MIG_WATER.dc*k, water = {name:"H2O", dr:0.16, lr:2.85};
  const d = G.edgeDist(dc, 0.5, water)*100, deutsch = 7.2 + 0.10*(m2 - 40);
  check("water-reflected water core at 20 C: the one-group savings law against Deutsch's measured fit", d, deutsch, 0.20,
    "Lamarsh 3rd ed. eq. 6.107 (Deutsch): delta = 7.2 + 0.10 (M2 - 40) cm; reflector D 0.16, L 2.85 cm (Table 5.2); tolerance the one-group law's own crudeness, stated",
    {unit:"cm", note:"core M2 " + m2.toFixed(1) + " cm2 and D " + dc.toFixed(3) + " cm, the hot benchmark taken to 998 kg/m3"}); }

/* the stock PWR as a family: leakage a few per cent, the rated peak pin where a licensed PWR's sits */
{ G.plantPreset(0); G.buildLayout();
  const c = G.priD(), T = G.corePredict(c, {rf:G.REFL[c.refl]}), lf = T.leak/1e5/(1 + T.leak/1e5), q = G.latQLim(c);
  check("STOCK PWR: fraction of neutrons leaked, M2B2/(1+M2B2) off the solved edge current: per cent, not tens of per cent", lf, 0.055, 0.045,
    "Krall, Macfarlane & Ewing, PNAS 119 (2022) e2111833119: a 3400 MWt PWR leaks under 3 %, a 160 MWt iPWR over 7 %: the behaviour is a few per cent; band 1-10 %",
    {abs:true, note:"leak " + T.leak.toFixed(0) + " pcm, " + c.power.toFixed(0) + " MWt, " + (T.coreDia).toFixed(2) + " m x " + T.coreHgt.toFixed(2) + " m"});
  const kwft = q.q/3.28084;
  check("STOCK PWR: peak linear heat at rated, kW/ft", kwft, (12.64 + 13.6)/2, (13.6 - 12.64)/2 + 0.5,
    "NRC HRTD Westinghouse Technology Systems Manual sec. 2.2 (ML11223A208): design peak 13.6 kW/ft (F_Q 2.50), 12.64 at most plants (F_Q 2.32); tolerance the band plus half a kW/ft",
    {abs:true, unit:"kW/ft", note:"binds on " + q.bind + ", " + q.q.toFixed(1) + " kW/m, the other ceiling " + q.clear.toFixed(2) + "x clear"}); }
