"use strict";
// commissioning's reference solve on STOCK, against continuity, the loop's own momentum balance, hydrostatics and the shell's mass balance
const {check, commissionPreset, colebrook} = require("./lib.js");
const G = commissionPreset(0);
const P = G.P, PT = G.PT, SX = G.SX, net = P.net;
const IF97 = "IAPWS-IF97 (2007 revision) region 1";

/* region 1 Gibbs free energy: specific volume and enthalpy off (p, T); checked against the release's own verification table below */
const R1 = [[0,-2,0.14632971213167],[0,-1,-0.84548187169114],[0,0,-3.756360367204],[0,1,3.3855169168385],[0,2,-0.95791963387872],
  [0,3,0.15772038513228],[0,4,-0.016616417199501],[0,5,8.1214629983568e-4],[1,-9,2.8319080123804e-4],[1,-7,-6.0706301565874e-4],
  [1,-1,-0.018990068218419],[1,0,-0.032529748770505],[1,1,-0.021841717175414],[1,3,-5.283835796993e-5],[2,-3,-4.7184321073267e-4],
  [2,0,-3.0001780793026e-4],[2,1,4.7661393906987e-5],[2,3,-4.4141845330846e-6],[2,17,-7.2694996297594e-16],[3,-4,-3.1679644845054e-5],
  [3,0,-2.8270797985312e-6],[3,6,-8.5205128120103e-10],[4,-5,-2.2425281908e-6],[4,-2,-6.5171222895601e-7],[4,10,-1.4341729937924e-13],
  [5,-8,-4.0516996860117e-7],[8,-11,-1.2734301741641e-9],[8,-6,-1.7424871230634e-10],[21,-29,-6.8762131295531e-19],
  [23,-31,1.4478307828521e-20],[29,-38,2.6335781662795e-23],[30,-39,-1.1947622640071e-23],[31,-40,1.8228094581404e-24],
  [32,-41,-9.3537087292458e-26]];
const RW = 0.461526;
const if97 = (p, T) => { const pi = p/16.53, tau = 1386/T; let gp = 0, gt = 0;
  for(const [I, J, n] of R1){ gp += -n*I*Math.pow(7.1 - pi, I - 1)*Math.pow(tau - 1.222, J);
    gt += n*Math.pow(7.1 - pi, I)*J*Math.pow(tau - 1.222, J - 1); }
  return {v: pi*gp*RW*T/(p*1000), h: RW*T*tau*gt}; };
for(const [T, p, v] of [[300, 3, 0.100215168e-2], [300, 80, 0.971180894e-3], [500, 3, 0.120241800e-2]])
  check("IF97 region 1 in this test: v(" + T + " K, " + p + " MPa)", if97(p, T).v, v, 1e-8, IF97 + " verification table", {unit:"m3/kg"});
/* the enthalpy the reference states, back to a temperature on IF97 at the design pressure */
const TofH = (p, h) => { let lo = 273.16, hi = 623.15; for(let k=0;k<80;k++){ const m = (lo + hi)/2; if(if97(p, m).h < h) lo = m; else hi = m; } return (lo + hi)/2; };
/* Vogel's form for liquid water, Pa s */
const muW = T => 2.414e-5*Math.pow(10, 247.8/(T - 140));

G.eNetRef(G.E_REF_NOM, null);
const E = PT.n.edge, n = PT.n.node, q = Float64Array.from(SX.edQ);
const loopW = SX.netLoop[0];

/* continuity: what enters a free node leaves it */
{ const d = new Float64Array(n), thru = new Float64Array(n);
  for(let e=0;e<E;e++){ d[PT.edU[e]] -= q[e]; d[PT.edV[e]] += q[e]; const a = Math.abs(q[e]); thru[PT.edU[e]] += a/2; thru[PT.edV[e]] += a/2; }
  let worst = 0, at = "";
  for(let i=0;i<n;i++){ if(SX.fixHas[i] || SX.stCap[i] > 0 || SX.nDeg[i]) continue;
    const r = Math.abs(d[i])/Math.max(thru[i], loopW); if(r > worst){ worst = r; at = net.name[i]; } }
  check("reference continuity, worst free node (" + at + ")", worst, 0, 1e-9, "continuity: sum of flows at a node with no store is 0", {abs:true, unit:"of throughput"}); }

/* the primary loop's flow: the pump's stated curve against the loop's own resistance, built here edge by edge */
{ const p0 = P.P0, c = G.loopDesignH(G.nodeGraph().coreCirc);
  const Tc = P.Tref - G.coreDT0()/2, hc = if97(p0, Tc).h, Th = TofH(p0, hc + (c.hOut - c.hIn));
  const pump = 0, pe = PT.pumpEdge[pump];
  /* walk the series circuit from the pump's discharge back to its suction */
  const loop = [], seen = new Uint8Array(E);
  let node = PT.edV[pe], sign = 1; loop.push([pe, 1]); seen[pe] = 1;
  for(let guard=0; node !== PT.edU[pe] && guard < E; guard++){
    let next = -1;
    for(let k=PT.adjStart[node];k<PT.adjStart[node+1];k++){ const e = PT.adjEdge[k];
      if(seen[e] || !(Math.abs(q[e]) > 0.5*loopW)) continue; next = e; break; }
    if(next < 0) break;
    seen[next] = 1; sign = PT.edU[next] === node ? 1 : -1; loop.push([next, sign]);
    node = sign > 0 ? PT.edV[next] : PT.edU[next]; }
  const closed = node === PT.edU[pe];
  const Tn = i => Number.isNaN(PT.nodeRefH[i]) ? Tc : (PT.nodeRefH[i] > (c.hIn + c.hOut)/2 ? Th : Tc);
  const rho = i => 1/if97(p0, Tn(i)).v;
  const H0 = G.pumpHead(G.IX.pumpId[pump])*(1 + G.PUMP_DROOP)*G.HEAD_K;
  let B = 0;
  for(const [e, s] of loop){ const u = s > 0 ? PT.edU[e] : PT.edV[e], v = s > 0 ? PT.edV[e] : PT.edU[e];
    B += (rho(u) + rho(v))/2*G.G_MPA*(PT.nodeZ[u] - PT.nodeZ[v]); }
  const drop = w => { let s = 0;
    for(const [e, sg] of loop){ const up = sg > 0 ? PT.edU[e] : PT.edV[e], r = rho(up);
      if(PT.edCk[e] === 0){ s += w*w/(2*r*PT.edC0[e]*PT.edC0[e]*1e6); continue; }
      const D = Math.max(PT.edBore[e]*G.BORE_REF/1000, 0.01), A = Math.PI/4*D*D;
      const Re = 4*w/(Math.PI*D*muW(Tn(up))), f = colebrook(Re, G.PIPE_ROUGH/D);
      s += (f*Math.max(PT.edLen[e], G.NET_COMP_LEN)/D + PT.edK0[e])*w*w/(2*r*A*A*1e6); }
    return s; };
  const F = w => H0 + B - drop(w);
  let lo = 1, hi = 10*P.wRated; for(let k=0;k<200;k++){ const m = (lo + hi)/2; if(F(m) > 0) lo = m; else hi = m; }
  const wX = (lo + hi)/2;
  check("STOCK primary loop reference flow (" + loop.length + " edges, closed " + closed + ")", loopW, wX, 0.02,
    "pump shutoff head x casing against Darcy-Weisbach + Colebrook + stated K0 and core drop, IF97 densities (hot " + Th.toFixed(1) + " K, cold " + Tc.toFixed(1) + " K)",
    {unit:"kg/s", pass: closed && Math.abs(loopW - wX) <= 0.02*wX}); }

/* hydrostatics: a conducting liquid edge that carries nothing holds exactly its column. A node the reference states no enthalpy for is saturated liquid at its own pressure */
{ const R4 = [1167.0521452767, -724213.16703206, -17.073846940092, 12020.82470247, -3232555.0322333,
    14.91510861353, -4823.2657361591, 405113.40542057, -0.23855557567849, 650.17534844798];
  const tsat = p => { const b = Math.pow(p, 0.25), e = b*b + R4[2]*b + R4[5], f = R4[0]*b*b + R4[3]*b + R4[6], g = R4[1]*b*b + R4[4]*b + R4[7];
    const d = 2*g/(-f - Math.sqrt(f*f - 4*e*g)), s = R4[9] + d;
    return (s - Math.sqrt(s*s - 4*(R4[8] + R4[9]*d)))/2; };
  check("IF97 region 4 in this test: Tsat(10 MPa)", tsat(10), 584.149488, 1e-8, "IAPWS-IF97 (2007 revision) region 4 verification table", {unit:"K"});
  const ci0 = G.nodeGraph().coreCirc;
  const Tof = (i, p) => PT.nodeCirc[i] === ci0 ? P.Tref : tsat(p) - 1e-6;
  let worst = 0, n0 = 0, at = "";
  for(let e=0;e<E;e++){ const u = PT.edU[e], v = PT.edV[e], dz = PT.nodeZ[u] - PT.nodeZ[v];
    if(!(SX.gG[e] > 0) || Math.abs(q[e]) > 1e-9*loopW || Math.abs(dz) < 0.2 || PT.nodeCont[u] || PT.nodeCont[v]) continue;
    if(PT.nodeVapour[u] || PT.nodeVapour[v] || PT.nodeCirc[u] !== PT.nodeCirc[v]) continue;
    if(!Number.isNaN(PT.nodeRefH[u]) || !Number.isNaN(PT.nodeRefH[v]) || PT.nodeTank[u] >= 0 || PT.nodeTank[v] >= 0) continue;
    const pu = G.eNodeP(u), pv = G.eNodeP(v);
    if(!(pu > 0) || !(pv > 0)) continue;
    const want = G.G_MPA*dz*(1/if97(pu, Tof(u, pu)).v + 1/if97(pv, Tof(v, pv)).v)/2, got = pv - pu;
    const r = Math.abs(got - want)/Math.abs(want); n0++;
    if(r > worst){ worst = r; at = net.name[u] + "->" + net.name[v]; } }
  check("reference field, no-flow liquid legs (" + n0 + " edges, worst " + at + ")", worst, 0, 0.01,
    "hydrostatics: dp = rho g dz, rho from " + IF97, {abs:true, unit:"relative", pass: n0 > 0 && worst <= 0.01}); }

/* the nominal frame: same topology (asserted in the build, and seen to throw), and a run drawn at nominal bore conducts the same */
{ let same = 0, diff = 0;
  for(let e=0;e<E;e++){ if(PT.edBore[e] !== PT.edBoreNom[e] || PT.edK0[e] !== PT.edK0Nom[e] || PT.edC0[e] !== PT.edC0Nom[e]) continue;
    const a = G.eEdgeC(e); G.eNetNomSwap(); const b = G.eEdgeC(e); G.eNetNomSwap();
    if(a === b) same++; else diff++; }
  check("nominal frame: runs drawn at nominal bore conduct identically (" + same + " edges)", diff, 0, 0, "the same pipe is the same conductance", {abs:true, unit:"edges"});
  const ed = P.netNom.edges[0], u0 = ed.u; ed.u = ed.v; let threw = false;
  try { G.engBuild(); } catch(err) { threw = true; }
  ed.u = u0; G.engBuild();
  check("nominal frame: a different topology refuses to build", threw ? 1 : 0, 1, 0, "the build's own assertion, fault injected", {abs:true}); }

/* the feed valves: at the fitted position each shell takes its rated share of the steam */
{ const nb = PT.n.boiler, want = G.ratedSteam()/Math.max(1, G.boilerCount()), fr = new Float64Array(nb);
  for(let b=0;b<nb;b++) fr[b] = P.fregRef[G.IX.boilerId[b]];
  G.eNetRef(G.E_REF_DRAWN, fr);
  for(let b=0;b<nb;b++)
    check("feed at the fitted valve, " + G.IX.boilerId[b], SX.netFeed[b], want, 1e-4, "shell mass balance at rest: feed in = rated steam out", {unit:"kg/s"}); }
