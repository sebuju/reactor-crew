"use strict";
/* BN-600's n moved +1.15 % after "the core inlet, off the field" landed (fidelity.md), outside
   the 1 % gate and left unexplained. Ablation: march BN-600 60 s with the transport lag on cs.nTc
   and/or the field inlet held off one at a time, and separately with nothing changed, to see
   whether either term (or the preset's own drift) owns the move. Chunks like presets.js. */
const fs = require("fs"), os = require("os"), path = require("path");
const {commissionPreset} = require("../tests/physics/lib.js");
const variant = process.argv[2] || "none"; // none | lag | field | both
const resume = process.argv.includes("--resume");
const SECS = 60, WALL = 8000, t0 = Date.now();
const fBin = path.join(os.tmpdir(), "rc-phys-inlet-" + variant + ".bin");
const fJs = path.join(os.tmpdir(), "rc-phys-inlet-" + variant + ".json");

const G = commissionPreset(3); // BN-600
const ST = G.ST, sc = ST.sc;
const betaPcm = G.P.cores[G.IX.coreId[0]].BETA * 1e5;

let A;
if(resume && fs.existsSync(fBin)){
  G.engRestore(new Uint8Array(fs.readFileSync(fBin)));
  A = JSON.parse(fs.readFileSync(fJs, "utf8"));
} else A = {n0: sc[G.SC_N]};

/* the two terms the core-inlet row added: field.js reverts eNetCoreInHA to the pre-fix algebraic
   path (Tavg-anchored) verbatim off its own else-branch; lag.js drops the dt/tau relaxation the
   row put on cs.nTc, leaving cs.nV's own lag (pre-existing, unrelated) alone. Re-derived from the
   live source every run, never hand-copied, so a rewrite of core.js/transport.js cannot go stale. */
function patch(){
  if(variant === "field" || variant === "both")
    G["eNetCoreInHA = function(c){ eTavgA(PT.coreCirc[c]); E_CIH[0] = PT.coreCp[c]*(E_TA[0] - PT.coreDT0[c]*ST.csHeat[c]/2); }"];
  if(variant === "lag" || variant === "both"){
    const src = G["eCoreStep.toString()"];
    const needle = "s.csNTc[k] += (s.csNTct[k] - s.csNTc[k])*dt/tau;";
    if(src.indexOf(needle) < 0) throw new Error("inlet.js: lag line not found in eCoreStep, source shape moved");
    G["eCoreStep = " + src.replace(needle, "s.csNTc[k] = s.csNTct[k];")];
  }
}
patch();
sc[G.SC_DICEOFF] = 1;

while(sc[G.SC_T] < SECS - 1e-9 && Date.now() - t0 < WALL) G.step(0.02);

if(sc[G.SC_T] < SECS - 1e-9){
  fs.writeFileSync(fBin, Buffer.from(G.engSnap(G.engSnapNew())));
  fs.writeFileSync(fJs, JSON.stringify(A));
  process.stdout.write("@@MORE\n"); process.exit(0);
}
for(const f of [fBin, fJs]) if(fs.existsSync(f)) fs.unlinkSync(f);

const n0 = A.n0, nEnd = sc[G.SC_N], pct = (nEnd - n0)/n0*100;
/* prompt jump n/n0 = 1/(1 - rho/beta): the pcm a held step reactivity would need to land this n */
const rhoPcm = betaPcm*(1 - n0/nEnd);
console.log(JSON.stringify({variant, n0, nEnd, pct, betaPcm, rhoPcm}));
