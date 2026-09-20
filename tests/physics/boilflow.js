"use strict";
// chunks: law pwr bwr rbmk
/* a boiling core's rated flow off its exit quality: x w of steam leaves, the same mass of feed mixes back with the separated water, so w = Q/(x (h_g - h_feed)) */
const fs = require("fs"), os = require("os"), path = require("path");
const {check, commissionPreset, coreInflow, load, tsat, if97, if97r2, TofH} = require("./lib.js");
const mode = process.argv[2], resume = process.argv.includes("--resume");
const IF97 = "IAPWS-IF97 (test side, lib.js)";
const hf = p => if97(p, tsat(p)).h, hg = p => if97r2(p, tsat(p)).h;
const perKg = (p, x, Tfeed) => 1/(x*(hg(p) - if97(p, Tfeed).h));

if(mode === "law"){
  const G = load();
  for(const [name, Q, x, Tf, w, p, src] of [
    ["BWR/4 (Browns Ferry)", 3293e3, 0.146, 489, 12915, 7.03, "GE BWR/4 design data / Browns Ferry FSAR: 3293 MWt, 102.5 Mlb/h, core exit quality 0.146, feed 489 K, dome 7.03 MPa"],
    ["RBMK-1000", 3200e3, 0.145, 438, 10400, 6.9, "INSAG-7 annex I: 3200 MWt, ~37 500 t/h, exit quality 0.145, feed 438 K, drum 6.9 MPa"]])
    check(name + ": published core flow against Q/(x (h_g - h_feed))", Q*perKg(p, x, Tf), w, 0.10, src + "; " + IF97, {unit:"kg/s"});
  for(let i=0;i<G.COOLANT.length;i++){ const a = G.COOLANT[i]; if(a.xOut == null) continue;
    const p = a.P0, hIn = hf(p) - a.xOut*(hf(p) - if97(p, G.feedTOf()).h), f = G.coolFig(a);
    check(a.id + ": derived inlet subcooling against Ts - T(P0, h_in)", G.coreDT0({cool:i}), tsat(p) - TofH(p, hIn), 0.05,
      "first law on the separator: h_in = h_f - x (h_f - h_feed), feed at " + G.feedTOf() + " K; " + IF97, {abs:true, unit:"K"});
    check(a.id + ": rated flow per kW against 1/(x (h_g - h_feed))", G.coreRatedKgs(a, 1), perKg(p, a.xOut, G.feedTOf()), 0.005,
      "first law on the separator at the row's own P0 " + p + " MPa; " + IF97, {unit:"kg/s/kW", note:"inlet density " + (f.rho || NaN).toFixed(1) + " kg/m3"}); }
  return;
}

const PRE = {pwr:0, bwr:2, rbmk:5}[mode];
const G = commissionPreset(PRE), ST = G.ST, sc = ST.sc, P = G.P, name = G.PLANTPRE[PRE][0];
const a = G.COOLANT[G.priD().cool];
if(mode === "pwr"){
  const f = G.coolFig(a);
  check(name + ": single-phase rated flow Q/(c_p dT0) on the row's own figures", P.wRated, P.rated*1000/(f.cp*a.dT0), 1e-9,
    "first law on a single-phase core: Q = w c_p dT", {unit:"kg/s"});
  return;
}
const GAP = {bwr:"BWR/4 cycle"}[mode] || "";
const fBin = path.join(os.tmpdir(), "rc-phys-boilflow-" + mode + ".bin"), SECS = 60, t0 = Date.now();
if(resume && fs.existsSync(fBin)) G.engRestore(new Uint8Array(fs.readFileSync(fBin)));
else {
  check(name + ": rated flow per MWt against Q/(x (h_g - h_feed))", P.wRated/P.rated, 1000*perKg(a.P0, a.xOut, G.feedTOf()), 0.005,
    "first law on the separator, x " + a.xOut + " at " + a.P0 + " MPa, feed " + G.feedTOf() + " K; " + IF97, {unit:"kg/s/MW"});
  if(mode === "rbmk")
    check(name + ": rated flow per MWt against the published machine", P.wRated/P.rated, 10400/3200, 0.10,
      "INSAG-7 annex I: ~37 500 t/h circulation at 3200 MWt", {unit:"kg/s/MW"});
  sc[G.SC_DICEOFF] = 1; }
while(sc[G.SC_T] < SECS - 1e-9 && Date.now() - t0 < 5000) G.step(0.02);
if(sc[G.SC_T] < SECS - 1e-9){ fs.writeFileSync(fBin, Buffer.from(G.engSnap(G.engSnapNew()))); process.stdout.write("@@MORE\n"); process.exit(0); }
if(fs.existsSync(fBin)) fs.unlinkSync(fBin);
const c = 0, pc = ST.csPCore[c], Q = G.eCoreQWater(c), {w, hIn, pOut} = coreInflow(G, c), hfo = hf(pOut), x = (Q/w - (hfo - hIn))/(hg(pOut) - hfo);
check(name + ": core exit quality at rest, 60 s, off its own heat and flow", x, a.xOut, 0.15,
  "first law on the core: x = (Q/w - (h_f - h_in))/h_fg at the pressure the core leaves into; " + IF97, {gap:GAP,
    note:"Q " + (Q/1000).toFixed(0) + " MW, w " + w.toFixed(0) + " kg/s (" + (w/P.wRated).toFixed(3) + " of rated), exit " + pOut.toFixed(2) + " MPa, inlet subcooling " +
      (tsat(pc) - TofH(pc, Math.min(hIn, hf(pc)))).toFixed(1) + " K at " + pc.toFixed(2) + " MPa"});
