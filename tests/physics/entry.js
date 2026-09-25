"use strict";
// chunks: mirror banklen axblank
/* plan-reactor-ui 8.3: rod entry, part-length banks, axial zones - each read off the drawing through one door */
const {check, commissionPreset} = require("./lib.js");
const mode = process.argv[2];
const G = commissionPreset(0);
const PT = G.PT, ST = G.ST, c = 0, nb = 0, XNN = G.XNN, XNR = G.XNR, XNZ = G.XNZ;
const snap = G.engSnap(G.engSnapNew());
const NB = PT.coreNB[c];
const setRods = arr => { for(let b = 0; b < NB; b++) ST.csRodZ[c*PT.nbMax + b] = arr[b]; G.eRodShape(c); };
const aoOf = () => { G.eCoreStaticRho(c); G.eCoreSolve(c, 0); const eo = G.eCoreOffsets(c);
  return (eo[0] - eo[1])/Math.max(eo[0] + eo[1], 1e-300); };

if(mode === "mirror"){
  const zs = [0.5, 0.5, 0.5, 0.5].slice(0, NB);
  PT.coreEntryTop[c] = 1; setRods(zs);
  const covT = Float64Array.from(ST.csNCov.subarray(nb, nb + XNN));
  const aTop = aoOf();
  PT.coreEntryTop[c] = 0; setRods(zs);
  const covB = Float64Array.from(ST.csNCov.subarray(nb, nb + XNN));
  const aBot = aoOf();
  PT.coreEntryTop[c] = 1;
  let worst = 0;
  for(let i = 0; i < XNR; i++) for(let j = 0; j < XNZ; j++)
    worst = Math.max(worst, Math.abs(covT[i*XNZ + j] - covB[i*XNZ + (XNZ - 1 - j)]));
  check("STOCK PWR: bottom-entry coverage mirrors top-entry coverage", worst, 0, 1e-12,
    "coverage from the bottom is coverage from the top mirrored about the mid-plane, ring by ring",
    {abs:true, note:"worst node " + worst.toExponential(1)});
  check("STOCK PWR: a bottom-entry bank reads the mirror AO of the top-entry one", aTop + aBot, 0, 1e-9,
    "half-inserted banks on a symmetric core suppress mirrored halves of the flux",
    {abs:true, note:"top " + (aTop*100).toFixed(3) + " %, bottom " + (aBot*100).toFixed(3) + " %"});

  const K = G.P.cores[G.IX.coreId[c]], cov = new Float64Array(XNN), fol = new Float64Array(XNN), entry0 = K.entry, top0 = PT.coreEntryTop[c];
  const sets = [0, 0.35, 0.7, 1].map(z => new Array(NB).fill(z)).concat([[0.2, 0.5, 0.8, 1].slice(0, NB)]);
  const apart = () => { let e = 0;
    for(const bot of [0, 1]){ K.entry = bot ? "bottom" : "top"; PT.coreEntryTop[c] = bot ? 0 : 1;
      for(const zs of sets){ setRods(zs); G.rodShape(K, {rodZ:Float64Array.from(zs)}, cov, fol);
        for(let k = 0; k < XNN; k++) e = Math.max(e, Math.abs(ST.csNCov[nb+k] - cov[k]), Math.abs(ST.csNFol[nb+k] - fol[k])); } }
    K.entry = entry0; PT.coreEntryTop[c] = top0; return e; };
  const one = apart();
  check("STOCK PWR: the bench's rodShape() and the engine's coverage pass, node by node", one, 0, 1e-12,
    "identity: one coverage law read by two callers, top and bottom entry, insertions 0, 0.35, 0.7, 1 and staggered",
    {abs:true, note:"worst node " + one.toExponential(1)});
  { const s = PT.coreBankS, q = XNR >> 1, k0 = s[q]; s[q] = k0 + 0.01; const bad = apart(); s[q] = k0;
    check("fault injected, the engine's ring table moved 0.01 in one ring: the check fails", bad > 1e-12 ? 1 : 0, 1, 0,
      "the check above must be able to fail", {abs:true, note:"worst node " + bad.toExponential(1)}); }
  G.engRestore(snap); G.eNetInvalidate(); }

if(mode === "banklen"){
  const blSave = Float64Array.from(PT.coreBankLen.subarray(c*PT.nbMax, c*PT.nbMax + NB));
  for(let b = 0; b < NB; b++) PT.coreBankLen[c*PT.nbMax + b] = 0.5;
  setRods(new Array(NB).fill(1));
  const aShort = aoOf();
  check("STOCK PWR: a part-length bank centred on a symmetric core reads AO 0", aShort, 0, 1e-9,
    "a centred half-height bank suppresses mirrored halves alike",
    {abs:true, note:"AO " + (aShort*100).toFixed(4) + " %"});
  for(let b = 0; b < NB; b++) PT.coreBankLen[c*PT.nbMax + b] = 1;
  setRods(new Array(NB).fill(0.5));
  const aFull = aoOf();
  check("fault injected, full-length banks half in: the AO is not zero", Math.abs(aFull) > 1e-9 ? 1 : 0, 1, 0,
    "the check above must be able to tell centred from uncentred",
    {abs:true, note:"AO " + (aFull*100).toFixed(3) + " %"});
  for(let b = 0; b < NB; b++) PT.coreBankLen[c*PT.nbMax + b] = blSave[b];
  G.engRestore(snap); G.eNetInvalidate(); }

if(mode === "axblank"){
  const cd = G.coreD(G.IX.coreId[c]);
  cd.axFuel = {}; for(let j = 0; j < XNZ; j++) cd.axFuel[j] = cd.fuel;
  const z = G.buildAxRho(cd);
  let worst = 0; for(let k = 0; k < XNN; k++) worst = Math.max(worst, Math.abs(z[k]));
  check("an axial zone of the same fuel changes nothing", worst, 0, 1e-12,
    "infinite-medium worth of the row against itself, level by level",
    {abs:true, unit:"pcm", note:"worst node " + worst.toExponential(1) + " pcm"});
  const hi = (cd.fuel + 1)%G.FUEL.length;
  for(let j = 0; j < 2; j++){ cd.axFuel[j] = hi; cd.axFuel[XNZ - 1 - j] = hi; }
  const zb = G.buildAxRho(cd);
  check("axial blankets read their own worth, top and bottom alike", zb[0] > 0 && zb[XNZ - 1] > 0 && Math.abs(zb[0] - zb[XNZ - 1]) < 1e-12 ? 1 : 0, 1, 0,
    "blanket fuel against the base row, infinite-medium, symmetric top and bottom",
    {abs:true, note:"blanket " + zb[0].toFixed(0) + " pcm"});
  delete cd.axFuel; }
