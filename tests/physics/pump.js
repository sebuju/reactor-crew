"use strict";
// chunks: 0 1 2 3 4 5 6 7 8
const {load, check, rig, march, colebrook, commissionPreset} = require("./lib.js");
const pre = +process.argv[2];
const G = load();

if(pre === 0){
  const RHO = 993.3, MU = 6.92e-4;
  let p;
  rig(R => { R.tank("srcA", 4, 10, 0.3, {vol:5}); p = R.machine("pump", 14, 10); R.tank("sinkA", 26, 10, 0.3, {vol:5});
    R.run(R.port("srcA", G.partOf("srcA").w, 0), R.port(p, -1, 0)); R.run(R.port(p, G.partOf(p).w, 0), R.port("sinkA", -1, 0)); R.wall(60); });
  const PT = G.PT, ST = G.ST, e = PT.pumpEdge[0];
  ST.flowDemBy[0] = 1; ST.flowBy[0] = 1;
  march(30);
  const H0 = G.ePumpHead(0)*1e6, Cc = PT.edC0[e];
  const runs = []; for(let k=0;k<PT.n.edge;k++) if(PT.edCk[k] === 1) runs.push(k);
  const sys = w => { let dp = w*w/(2*RHO*Cc*Cc);
    for(const k of runs){ const D = G.boreM(PT.edBore[k]), A = Math.PI/4*D*D, Re = 4*w/(Math.PI*D*MU);
      dp += (colebrook(Re, 4.5e-5/D)*PT.edLen[k]/D + PT.edK0[k])*w*w/(2*RHO*A*A); }
    return dp; };
  let lo = 0, hi = 1e4;
  for(let i=0;i<200;i++){ const m = (lo + hi)/2; if(sys(m) < H0) lo = m; else hi = m; }
  check("pump against a fixed resistance, operating point", Math.abs(ST.edW[e]), lo, 0.02,
    "crossing of the stated pump curve (shutoff head, casing loss) with the Darcy-Colebrook system curve; water 310 K (IAPWS)",
    {unit:"kg/s", note:"shutoff " + (H0/1e6).toFixed(4) + " MPa"});
}

/* A bundle's path edge stands for the whole tube bank, so the path's velocity IS the tube velocity and one
   tube's K is the bank's K. Both quantities below are read off the SOLVED edge: v from the flow the network
   settled at over the duct the build cut, K from the conductance it was built with (C = A/sqrt(K)). */
const HEI_V = [1.8, 2.4];       // m/s, HEI Standards for Steam Surface Condensers, design tube velocity
const HEI_DP = [34, 69];        // kPa, HEI, tube-side at design: tubes plus both waterboxes
const CWP_H = [15, 25];         // m, a circulating-water pump's total developed head on a short closed circuit
const band = (v, b) => (v - (b[0]+b[1])/2)/((b[1]-b[0])/2);   // 0 at the band's middle, +-1 at its edges

const H = commissionPreset(pre);
const name = H.PLANTPRE[pre][0];
march(2);
const PT = H.PT, ST = H.ST;

const edgeOfKey = k => { const i = H.IX.key.has(k) ? H.IX.key.get(k) : -1; if(i < 0) return -1;
  for(let e=0;e<PT.n.edge;e++) if(PT.edKey[e] === i) return e; return -1; };

let nBundle = 0;
for(const q of H.LAY.parts){
  const R = H.ROLE[q.role]; if(!R || !R.internal) continue;
  for(const IN of (Array.isArray(R.internal) ? R.internal : [R.internal])){
    if(!(IN.tube > 0)) continue;
    const e = edgeOfKey("comp:" + q.id + ":" + IN.a + IN.b); if(e < 0) continue;
    const w = Math.abs(ST.edW[e]); if(!(w > 1e-3)) continue;
    nBundle++;
    const Dm = H.pathBoreMm(q.id, IN)/1000, A = Math.PI/4*Dm*Dm, C = PT.edC0[e];
    const rho = H.eNodeRho(PT.edU[e]), K = Math.pow(A/C, 2);
    const v = w/(rho*A), dp = K*rho*v*v/2/1e3;
    check(name + " " + q.id + ": tube velocity", v, (HEI_V[0]+HEI_V[1])/2, (HEI_V[1]-HEI_V[0])/2,
      "HEI Standards for Steam Surface Condensers, design tube water velocity " + HEI_V[0] + "-" + HEI_V[1] + " m/s",
      {unit:"m/s", abs:true, pass:v >= HEI_V[0] && v <= HEI_V[1], note:"band " + band(v, HEI_V).toFixed(2)});
    if(q.role !== "cond") continue;
    check(name + " " + q.id + ": tube-side pressure drop", dp, (HEI_DP[0]+HEI_DP[1])/2, (HEI_DP[1]-HEI_DP[0])/2,
      "HEI Standards for Steam Surface Condensers, tube-side drop at design (tubes plus waterboxes) " + HEI_DP[0] + "-" + HEI_DP[1] + " kPa",
      {unit:"kPa", abs:true, pass:dp >= HEI_DP[0] && dp <= HEI_DP[1], note:"K " + K.toFixed(1) + " at " + v.toFixed(2) + " m/s"});
  }
}
if(!nBundle) check(name + ": a tube bundle to measure", 0, 0, 0, "ROLE.cond / ROLE.radiator internal path", {pass:true, note:"no bundle on this drawing"});

/* A pump is bought for the circuit it stands in: what it develops at its duty must be what that circuit costs.
   The circulating-water pump is picked structurally - the one whose discharge circuit carries a tube bundle. */
const bundleCirc = {};
for(const q of H.LAY.parts){
  const R = H.ROLE[q.role]; if(!R || !R.internal) continue;
  for(const IN of (Array.isArray(R.internal) ? R.internal : [R.internal]))
    if(IN.tube > 0) bundleCirc[H.circOfNode(H.coreFold(q.id+IN.a))] = 1;
}
for(const id of H.pumpIds()){
  if(!bundleCirc[H.circOfNode(H.pumpDisNode(id))]) continue;
  const p = H.IX.pump.get(id), rated = H.pumpFlow(id);
  if(!(rated > 0)) continue;
  check(name + " " + id + ": passes its rated flow", Math.abs(ST.edW[PT.pumpEdge[p]])/rated, 1, 0.05,
    "a pump bought for the circuit it stands in meets that circuit's curve at its own rated duty: no throttling reserve bought and none thrown away",
    {note:"rated " + rated.toFixed(0) + " kg/s, bought " + H.pumpHead(id).toFixed(4) + " MPa"});
  const m = H.pumpHead(id)*1e6/(9.80665*H.eNodeRho(PT.pumpSuc[p]));
  check(name + " " + id + ": total developed head", m, (CWP_H[0]+CWP_H[1])/2, (CWP_H[1]-CWP_H[0])/2,
    "a cooling-water pump's total developed head on a short closed circuit, " + CWP_H[0] + "-" + CWP_H[1] + " m",
    {unit:"m", abs:true, pass:m >= CWP_H[0] && m <= CWP_H[1], note:"band " + band(m, CWP_H).toFixed(2)});
}

/* A stage's required suction against the published band, and the SHAPE of the cutback: head flat above NPSHr,
   falling below it. The walk heats one pump's suction so NPSH available comes down onto its own requirement. */
const BFP_NPSH = [3, 10];       // m, a boiler feed pump's NPSHr at rated duty (Karassik, Pump Handbook)
const STAGE_M = [200, 400];     // m one boiler feed pump stage develops at 5000-6000 rpm (Karassik)
/* a machine bought for a steam pressure its real plant does not raise needs a suction to match: the distance is that drawing's, not this law's */
const NPSH_GAPS = {"BN-600":"BN-600 steam pressure", "MSRE":"feed pumps drawing straight off a hotwell (BWR/4, MSRE, DUAL)"};
for(const id of H.pumpIds()){
  const p = H.IX.pump.get(id), si = PT.pumpSuc[p];
  if(si < 0 || H.pumpStages(id) < 2) continue;                    // the published band is a MULTI-STAGE boiler feed pump's
  const rho = H.eNodeRho(si), mNPSH = PT.pumpNPSHr[p]*1e6/(9.80665*rho);
  check(name + " " + id + ": required suction", mNPSH, (BFP_NPSH[0]+BFP_NPSH[1])/2, (BFP_NPSH[1]-BFP_NPSH[0])/2,
    "a boiler feed pump's NPSHr at rated duty, " + BFP_NPSH[0] + "-" + BFP_NPSH[1] + " m (Karassik, Pump Handbook); Thoma's number is per STAGE",
    {unit:"m", abs:true, pass:mNPSH >= BFP_NPSH[0] && mNPSH <= BFP_NPSH[1], gap:NPSH_GAPS[name] || "",
     note:H.pumpStages(id) + " stages of " + H.pumpHead(id).toFixed(3) + " MPa"});
  const perStage = H.pumpHead(id)*1e6/(9.80665*rho)/H.pumpStages(id);
  check(name + " " + id + ": head per stage", perStage, (STAGE_M[0]+STAGE_M[1])/2, (STAGE_M[1]-STAGE_M[0])/2,
    "one boiler feed pump stage develops " + STAGE_M[0] + "-" + STAGE_M[1] + " m at 5000-6000 rpm (Karassik, Pump Handbook)",
    {unit:"m", abs:true, pass:perStage >= STAGE_M[0] && perStage <= STAGE_M[1]});
}

/* the cutback's own definition: read at the suction of one pump whose NPSH available is walked down onto its NPSHr */
{ const id = H.pumpIds().find(q => H.pumpStages(q) > 1 && PT.pumpSuc[H.IX.pump.get(q)] >= 0);
  if(id){
    const p = H.IX.pump.get(id), si = PT.pumpSuc[p], c = H.eNodeSat(si);
    const pS = H.eNodeP(si), r = PT.pumpNPSHr[p], h0 = H.ST.hBy[si];
    /* the node held at the temperature whose saturation pressure leaves exactly `frac` of NPSHr available */
    const settle = frac => { H.ST.hBy[si] = H.hOfTP(c, H.satT(c, Math.max(1e-4, pS - frac*r)), pS);
      for(let i=0;i<2000;i++) H.eCavStep(0.02);      // 40 s against E_CAV_TAU 1.5: the ramp is converged, not part of the answer
      return H.ePumpHead(p); };
    const full = settle(2);                          // well clear of the requirement: the machine's own head
    const above = settle(1.5)/full, at = settle(1)/full, half = settle(0.5)/full, none = settle(0)/full;
    check(name + " " + id + ": head flat above NPSHr", above, 1, 1e-6,
      "ANSI/HI 9.6.1 and ISO 9906: above the required suction a pump's total head does not depend on it",
      {abs:true, note:"1.5x NPSHr, and at NPSHr " + at.toFixed(4)});
    check(name + " " + id + ": head falls below NPSHr", 1 - half, 1 - (1 - 0.8*0.5), 0.02,
      "ANSI/HI 9.6.1 and ISO 9906: NPSHr is the 3 % head-drop point, and below it head falls away with the shortfall",
      {note:"half of NPSHr available: " + (half*100).toFixed(1) + " % of head, dry " + (none*100).toFixed(1) + " %"});
    const was = PT.pumpNPSHr[p]; PT.pumpNPSHr[p] = 0;
    const blind = settle(0.5)/full; PT.pumpNPSHr[p] = was; H.ST.hBy[si] = h0;
    check(name + " " + id + ": fault injected, NPSHr stood down: the cutback check fails", blind, 1, 0.01,
      "the two checks above must be able to fail: with nothing required, the same suction takes no derate at all",
      {abs:true, note:(blind*100).toFixed(2) + " % of head against " + (half*100).toFixed(1) + " % with the requirement stated"});
  }
}
