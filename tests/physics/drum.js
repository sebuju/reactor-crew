"use strict";
// chunks: 5 probe
/* a drum at rest against the first law: the drum node on its own, and the drum-and-core circuit from feed nozzle to steam nozzle */
const {load, check, commissionPreset, rig} = require("./lib.js");
const arg = process.argv[2];
let G, name;
if(arg === "probe"){
  rig((R, g) => { g.designForget(); const core = g.coreMint(); g.archPreset(core, 1);
    g.buildStockPlumbing({loops:1, drum:true, core}); g.buildLayout(); g.buildStockAutomation(); });
  G = load(); name = "drum probe";
} else { G = commissionPreset(+arg); name = G.PLANTPRE[+arg][0]; }
const PT = G.PT, ST = G.ST, net = G.P.net;
const GAP = {"drum probe":"Drum at rest", "RBMK-1000":"RBMK-1000 at rated power"}[name];
G.eNetField(ST.pBy);
let qIn = 0, qOut = 0;
for(let b=0;b<PT.n.boiler;b++){ if(!PT.boilerDrum[b]) continue;
  const i = PT.boilerNode[b], c = G.eNodeSat(i), p = G.eNodeP(i), hg = G.satHg(c, p), hf = G.satH(c, p);
  let m = 0, e = 0, steam = 0;
  for(let k=PT.adjStart[i];k<PT.adjStart[i+1];k++){ const ed = PT.adjEdge[k], w0 = ST.edW[ed]; if(!w0) continue;
    const f = w0 > 0 ? PT.edU[ed] : PT.edV[ed], w = PT.edV[ed] === i ? w0 : -w0;
    const h = f === i && PT.edGasAt[ed] === i ? hg : f === i && PT.edLiqAt[ed] === i ? hf : ST.hBy[f];
    m += w; e += w*h;
    if(f === i && PT.edGasAt[ed] === i) steam -= w; }
  check(name + ": " + net.name[i] + " mass at rest", m/steam, 0, 1e-3, "continuity on a control volume at steady state", {abs:true, unit:"of its steam", gap:GAP});
  check(name + ": " + net.name[i] + " first law at rest", e/(steam*hg), 0, 1e-3, "first law on a control volume at steady state: sum of w.h in - out = 0", {abs:true, unit:"of its steam enthalpy", gap:GAP});
  qOut += steam*hg; qIn += ST.sgFedBy[b]*ST.hBy[PT.boilerFeed[b]]; }
let core = 0; for(let c=0;c<PT.n.core;c++) core += ST.csHeat[c]*PT.coreRated[c]*1000;
check(name + ": core heat against steam out less feed in past the heaters", core/(qOut - qIn), 1, 1e-2, "first law on the drum-and-core circuit at steady state", {gap:GAP, note:"core " + (core/1000).toFixed(0) + " MW"});
