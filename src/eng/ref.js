"use strict";
// exports: eNetRef E_REF_NOM E_REF_DRAWN E_REF_OPEN
const E_REF_NOM = 0, E_REF_DRAWN = 1, E_REF_OPEN = 2, E_REF_PASSES = 20, E_REF_TOL = 1e-4;

function eNetNomSwap(){
  let t = PT.edBore; PT.edBore = PT.edBoreNom; PT.edBoreNom = t;
  t = PT.edK0; PT.edK0 = PT.edK0Nom; PT.edK0Nom = t;
  t = PT.edC0; PT.edC0 = PT.edC0Nom; PT.edC0Nom = t;
}
/* no damage, cross-ties shut, rated load, pumps at their commissioned run/stop (every one turning when open), the core's loop at its design split */
function eRefState(mode, freg){
  ePkSync(); STBYTES.fill(0); engInit(); eNetInvalidate(); eRegionUpdate();
  eMachSeed(); eMachRestSeed();
  const s = ST, open = mode === E_REF_OPEN ? 1 : 0;
  s.sc[SC_LOAD] = 1;
  s.hBy.set(PT.nodeRefH);
  for(let p=0;p<PT.n.pump;p++) s.flowBy[p] = open || !PT.pumpStandby[p] ? 1 : 0;
  for(let w=0;w<PT.n.throttle;w++) s.valve[w] = PT.throttleTie[w] ? 0 : 1;
  for(let t=0;t<PT.n.tank;t++){ s.tankOpen[t] = open; s.tankByp[t] = 0; s.tankDump[t] = 0; }
  for(let v=0;v<PT.n.relief;v++){ s.reliefOpen[v] = open; s.reliefBlocked[v] = 0; }
  for(let b=0;b<PT.n.boiler;b++) s.fregBy[b] = freg ? freg[b] : 0;
}
/* the reference field with every store held, relinearised until no edge moves more than E_REF_TOL of the largest; answers in SX.edQ and eNetReadEdges()'s rows. Commissioning only: engSettle() overwrites all of it */
function eNetRef(mode, freg){
  eRefState(mode, freg);
  const nom = mode === E_REF_NOM, held = eNetHold(1), prev = new Float64Array(PT.n.edge);
  if(nom) eNetNomSwap();
  try {
    for(let pass=0;pass<E_REF_PASSES;pass++){
      eSettleSolve();
      const q = SX.edQ; let scale = 0, move = 0;
      for(let e=0;e<q.length;e++){ const a = Math.abs(q[e]); if(a > scale) scale = a;
        const d = Math.abs(q[e] - prev[e]); if(d > move) move = d; }
      if(pass && move <= E_REF_TOL*Math.max(scale, 1e-9)) return pass + 1;
      prev.set(q); }
    return E_REF_PASSES;
  } finally { if(nom) eNetNomSwap(); eNetHold(held); }
}
