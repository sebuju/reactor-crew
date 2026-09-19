"use strict";
// chunks: 5 probe march
/* a drum at rest against the first law: the drum node on its own, and the drum-and-core circuit from feed nozzle to steam nozzle; "march" flies the probe's plant 60 s in slices */
const fs = require("fs"), os = require("os"), path = require("path");
const {load, check, commissionPreset, rig} = require("./lib.js");
const arg = process.argv[2];
let G, name;
if(arg === "probe" || arg === "march"){
  rig((R, g) => { g.designForget(); const core = g.coreMint(); g.archPreset(core, 1);
    g.buildStockPlumbing({loops:1, drum:true, core}); g.buildLayout(); g.buildStockAutomation(); });
  G = load(); name = "drum probe";
} else { G = commissionPreset(+arg); name = G.PLANTPRE[+arg][0]; }
const PT = G.PT, ST = G.ST, net = G.P.net;
const GAP = {"drum probe":"Drum at rest", "RBMK-1000":"RBMK-1000 at rated power"}[name];

if(arg === "march"){
  const SECS = 60, WALL = 7000, t0 = Date.now(), sc = ST.sc;
  const fBin = path.join(os.tmpdir(), "rc-phys-drum.bin"), fJs = path.join(os.tmpdir(), "rc-phys-drum.json");
  const drums = []; for(let b=0;b<PT.n.boiler;b++) if(PT.boilerDrum[b]) drums.push(b);
  let A;
  if(process.argv.includes("--resume") && fs.existsSync(fBin)){ G.engRestore(new Uint8Array(fs.readFileSync(fBin))); A = JSON.parse(fs.readFileSync(fJs, "utf8")); }
  else { sc[G.SC_DICEOFF] = 1; G.uiBlkSinkOff("scram"); G.uiBlkSinkOff("rodStep");
    A = {m0:G.eLedgerKg() + G.eLedgerOut(), inv0:G.eLedgerKg(), drift:0, enAbs:0, heatDt:0, ticks:0,
      p0:drums.map(b => G.eBoilerP(b)), l0:drums.map(b => G.eBoilerLvl(b)), s0:drums.map(b => ST.steamBy[b]), dp:0, dl:0, ds:0}; }
  while(sc[G.SC_T] < SECS - 1e-9 && Date.now() - t0 < WALL){
    G.step(0.02); A.ticks++;
    A.drift = Math.max(A.drift, Math.abs(G.eLedgerKg() + G.eLedgerOut() - A.m0));
    A.enAbs += Math.abs(sc[G.SC_ENRES]); A.heatDt += Math.max(0, sc[G.SC_HEAT])*G.P.rated*1000*0.02;
    drums.forEach((b, k) => { A.dp = Math.max(A.dp, Math.abs(G.eBoilerP(b)/A.p0[k] - 1));
      A.dl = Math.max(A.dl, Math.abs(G.eBoilerLvl(b)/A.l0[k] - 1)); A.ds = Math.max(A.ds, Math.abs(ST.steamBy[b]/A.s0[k] - 1)); }); }
  if(sc[G.SC_T] < SECS - 1e-9){
    fs.writeFileSync(fBin, Buffer.from(G.engSnap(G.engSnapNew()))); fs.writeFileSync(fJs, JSON.stringify(A));
    process.stdout.write("@@MORE\n"); process.exit(0); }
  for(const f of [fBin, fJs]) if(fs.existsSync(f)) fs.unlinkSync(f);
  check(name + ": mass closes over 60 s (worst |books - start| / inventory)", A.drift/A.inv0, 0, 1e-9,
    "conservation of mass: inventory + everything booked out = the commissioned inventory, every tick", {abs:true, note:A.ticks + " ticks"});
  check(name + ": energy closes over 60 s (sum |residual| / sum core heat)", A.enAbs/Math.max(A.heatDt, 1), 0, 1e-3,
    "conservation of energy on the fluid field: change in (m h - p V) + metal = sources - sinks, every tick", {abs:true});
  const rest = "a plant at rest with its controllers holding stays at rest";
  check(name + ": drum pressure over 60 s, worst off commissioned", A.dp, 0, 1e-2, rest, {abs:true, unit:"of commissioned", gap:GAP});
  check(name + ": drum level over 60 s, worst off commissioned", A.dl, 0, 1e-2, rest, {abs:true, unit:"of commissioned", gap:GAP});
  check(name + ": drum steam over 60 s, worst off commissioned", A.ds, 0, 1e-2, rest, {abs:true, unit:"of commissioned", gap:GAP});
  return;
}
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
