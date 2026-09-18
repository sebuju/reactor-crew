"use strict";
// exports: eNetRef E_REF_NOM E_REF_DRAWN E_REF_OPEN
const E_REF_NOM = 0, E_REF_DRAWN = 1, E_REF_OPEN = 2;

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
/* the reference field, steady (eSettleSteady()), each feed valve fitted to pass want[b] when given; answers in SX.edQ and eNetReadEdges()'s rows. Commissioning only: engSettle() overwrites all of it */
function eNetRef(mode, freg, want){
  eRefState(mode, freg);
  const nom = mode === E_REF_NOM;
  if(nom) eNetNomSwap();
  try { return want ? eFeedFit(want) : eSettleSteady(); }
  finally { if(nom) eNetNomSwap(); }
}
