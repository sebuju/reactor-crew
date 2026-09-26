"use strict";
/* What the circulating-water tank does at rest (fidelity.md, "Commissioned plant on its first tick").
   Books the tank's OWN node: every edge on it, summed, against ST.mBy's own change - that is the conservation check,
   and it names the edge carrying whatever moves. This tank is not in the field, so its LEVEL is the state and its
   pressure is read off the polytropic compression of its nitrogen cushion (eTankPA, net.js). */
const {check, watch, watchNote, transit} = require("../lib.js");
const PRESETS = [0, 1, 4];
module.exports = (G, pre) => {
  if(!PRESETS.includes(pre)) return;
  const PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[pre][0];
  if(!G.IX.tank.has("cwtank")){
    check(name + ": cwtank present on this preset", 0, 1, 0, "buildStockPlumbing() cwp/cwtank", {pass:false, note:"no cwtank part built"});
    return;
  }
  const t = G.IX.tank.get("cwtank"), i = PT.tankNode[t];
  const dt = 0.02;

  /* the loop the tank rides: every node on its own circuit but itself. A fixed volume of water, so a
     temperature change has to move mass across the tank's one edge and nowhere else. */
  const loop = []; for(let k=0;k<PT.n.node;k++) if(k !== i && PT.nodeCirc[k] === PT.nodeCirc[i]) loop.push(k);
  const loopState = () => { let m = 0, e = 0;
    for(const k of loop){ m += ST.mBy[k]; e += ST.mBy[k]*G.eNodeT(k); }
    return [m, e/Math.max(m, 1e-9)]; };
  /* the tank's one live edge, and what the flow law asks of it: zero flow means dp across it is its own static head */
  const tankEdge = () => { for(let k=PT.adjStart[i]; k<PT.adjStart[i+1]; k++){
      const ed = PT.adjEdge[k]; if(!PT.edHole[ed] && G.eEdgeC(ed) > 0) return ed; }
    return -1; };

  const [mL, TL] = loopState();
  const A = {m0: ST.mBy[i], lvl0: G.eTankLvl(t), p0: ST.pBy[i], gas0: PT.tankGasP0[t], V: PT.tankVol[t], V0: PT.tankVol[t]*PT.tankVoid[t],
       inv0: G.eLedgerKg() + G.eLedgerOut(), edgeKg: {}, ticks: 0, worstResid: 0, worstResidT: 0, invDrift: 0,
       mLoop0: mL, TLoop0: TL, eq: null};
  { const ed = tankEdge();
    if(ed >= 0){ G.eStaticHA(ed);
      A.eq = {dp: ST.pBy[PT.edU[ed]] - ST.pBy[PT.edV[ed]] + G.E_EC[2], h: G.E_EC[2],
              pT: ST.pBy[i], pTie: ST.pBy[PT.edU[ed] === i ? PT.edV[ed] : PT.edU[ed]]};
      /* the same reading with the tank's own pressure offset 1 % and the field NOT re-solved - a node seeded
         off the equilibrium its circuit converged to, which is the fault this check is here to catch */
      const was = ST.pBy[i]; ST.pBy[i] = was*1.01; G.eStaticHA(ed);
      A.eq.bad = ST.pBy[PT.edU[ed]] - ST.pBy[PT.edV[ed]] + G.E_EC[2];
      ST.pBy[i] = was; G.eNetInvalidate(); } }

  const BETA = 4.49e-4;   // 1/K, IAPWS-IF97 isobaric expansivity of liquid water at 322 K, 0.6 MPa (3.85e-4 at 313 K, 4.57e-4 at 323 K)
  const betaNow = () => { const [m, T] = loopState(), dT = T - A.TLoop0; return Math.abs(dT) > 1e-3 ? ((A.mLoop0 - m)/A.mLoop0)/dT : NaN; };
  let wCw = 0;
  for(let p=0;p<PT.n.pump;p++) if(PT.pumpSuc[p] >= 0 && PT.nodeCirc[PT.pumpSuc[p]] === PT.nodeCirc[i]) wCw += Math.abs(ST.edW[PT.pumpEdge[p]]);
  const win = transit(G, PT.nodeCirc[i], wCw);
  let mBefore = 0;
  // cap at the horizon: beta is read off the loop's own warming, which no transit bounds
  const w = watch(G, {cap:170, horizon:170, window:win, sig:[{name:"beta", read:betaNow, ref:BETA, tol:0.08*BETA}],
    step:() => { mBefore = ST.mBy[i]; G.step(dt); }, each:() => {
    A.ticks++;
    let net = 0;
    for(let k=PT.adjStart[i]; k<PT.adjStart[i+1]; k++){
      const ed = PT.adjEdge[k], w0 = ST.edW[ed];
      if(!w0 || PT.edHole[ed]) continue;
      const wi = PT.edV[ed] === i ? w0 : -w0;
      net += wi;
      A.edgeKg[ed] = (A.edgeKg[ed] || 0) + wi*dt;
    }
    const dm = ST.mBy[i] - mBefore, resid = Math.abs(dm - net*dt);
    if(resid > A.worstResid){ A.worstResid = resid; A.worstResidT = sc[G.SC_T]; }
    A.invDrift = Math.max(A.invDrift, Math.abs((G.eLedgerKg() + G.eLedgerOut()) - A.inv0)); }});
  const span = w.t.toFixed(1) + " s (" + watchNote(w) + ", circuit transit " + win.toFixed(1) + " s)";

  const mEnd = ST.mBy[i], lvlEnd = G.eTankLvl(t), pEnd = ST.pBy[i];
  const edges = Object.keys(A.edgeKg).map(k => +k);
  let sumKg = 0; for(const ed of edges) sumKg += A.edgeKg[ed];
  const edgeReport = edges.map(ed => "ed" + ed + "(node" + PT.edU[ed] + "<->node" + PT.edV[ed] + "):" + A.edgeKg[ed].toFixed(6) + "kg").join(", ") || "none";

  check(name + ": cwtank node mass books to its own edges over " + A.ticks + " ticks (worst |dm - sum(w*dt)| / |m0|)",
    A.worstResid/Math.max(Math.abs(A.m0), 1e-9), 0, 1e-7,
    "conservation of mass on the tank's own node, every tick; cwtank is a booked node (PT.nodeBooked===1), so ST.mBy is overwritten " +
    "each tick from its own level, not integrated from the summed edge flow - the residual is " +
    "the gap between those two independent tracks of the same thermal expansion", {abs:true, gap:"Commissioned plant on its first tick",
      note:"worst at t=" + A.worstResidT.toFixed(2) + "s; edges " + edgeReport});

  check(name + ": cwtank node mass change over the run is what its one edge carried (|dm - edgeKg|/m0)",
    Math.abs((mEnd - A.m0) - sumKg)/Math.max(Math.abs(A.m0), 1e-9), 0, 1e-6,
    "conservation of mass: a vessel with one line gains exactly what that line brings it", {abs:true, gap:"Commissioned plant on its first tick",
      note:"run " + span + "; m0=" + A.m0.toFixed(4) + "kg mEnd=" + mEnd.toFixed(4) + "kg netEdgeKg=" + sumKg.toFixed(6) + " p0=" + A.p0.toFixed(6) +
        "MPa pEnd=" + pEnd.toFixed(6) + "MPa lvl0=" + A.lvl0.toFixed(3) + "% lvlEnd=" + lvlEnd.toFixed(3) + "%"});

  /* This tank is NOT in the field (PT.tankInField 0): its level is the state and its pressure is the read, off
     the polytropic compression of its own nitrogen cushion. p/p0 = (V_gas0/V_gas)^n on the gas the fill left. */
  const NPOLY = G.TANK_NPOLY;
  const vg = A.V*(1 - lvlEnd/100), vg0 = A.V*(1 - A.lvl0/100);
  check(name + ": cwtank pressure is the polytropic compression of its own charge (predicted vs read MPa)",
    A.gas0*Math.pow(vg0/vg, NPOLY), pEnd, 1e-6,
    "polytropic compression of a trapped gas charge, p.V^n constant at n = " + NPOLY + " (diatomic nitrogen, near-adiabatic over this window)",
    {unit:"MPa", note:"cushion " + vg0.toFixed(4) + " -> " + vg.toFixed(4) + " m3, p " + A.p0.toFixed(6) + " -> " + pEnd.toFixed(6) + " MPa over " + span});

  /* The named question: is the tank at its OWN zero-flow equilibrium when the first tick starts? The flow law
     (eFlowGA) drives an edge on p_u - p_v + h, so zero flow means exactly that sum is zero. */
  if(A.eq) check(name + ": cwtank at its own zero-flow equilibrium before tick 1 (p_u - p_v + static head)",
    A.eq.dp/Math.max(A.eq.pT, 1e-9), 0, 1e-6,
    "a vessel tied into a circuit sits where its own line carries nothing: the pressure difference across that line is its static head and no more",
    {abs:true, note:"tank " + A.eq.pT.toFixed(6) + " MPa, tie " + A.eq.pTie.toFixed(6) + ", static head " + A.eq.h.toFixed(6) + " MPa"});
  if(A.eq) check(name + ": fault injected, tank seeded 1 % off its field: the equilibrium check fails",
    Math.abs(A.eq.bad)/Math.max(A.eq.pT, 1e-9) > 1e-6 ? 1 : 0, 1, 0,
    "the check above must be able to fail", {abs:true, note:"residual " + A.eq.bad.toExponential(3) + " MPa"});

  /* A surge tank exists to take the loop's thermal expansion. The loop is a fixed volume, so over the run the
     mass it gives up is beta.dT of itself, and beta is a published property of water - not a number this simulation
     may choose. The span is 2 K and beta moves about 7 %/K here, so the mean-temperature form carries that. */
  const [mLoopEnd, TLoopEnd] = loopState(), dmLoop = A.mLoop0 - mLoopEnd, beta = betaNow();
  check(name + ": what the tank takes is the loop's own thermal expansion (measured beta)",
    beta === beta ? beta : 0, BETA, 0.08,
    "the coefficient of thermal expansion of liquid water, IAPWS-IF97: a closed loop of fixed volume warming dT gives up beta.dT of its mass, and the surge tank is the only place it can go",
    {unit:"1/K", note:"loop " + loop.length + " nodes, " + A.TLoop0.toFixed(3) + " -> " + TLoopEnd.toFixed(3) + " K, gave up " + dmLoop.toFixed(2) + " of " + A.mLoop0.toFixed(1) + " kg"});

  check(name + ": whole-plant mass inventory unmoved while the cwtank fills (worst |inv - inv0| / inv0)",
    A.invDrift/Math.max(Math.abs(A.inv0), 1e-9), 0, 1e-9, "eLedgerKg()+eLedgerOut(): the water the tank loses has to show up booked somewhere else, not vanish", {abs:true});
};
