"use strict";
const {check, commissionPreset} = require("./lib.js");
const G = commissionPreset(0);
const SRC = "Barlow P = 2 S t / D on the corroded wall (t - 3 mm): S 138 MPa allowable, 485 MPa ultimate (SA-516 grade 70, ASME II-D)";
let k = 0;
for(const r of G.pipeNetwork()){ if(k++ >= 6) break;
  const t = G.runWallMm(r) - 3, D = G.runBoreMm(r), pk = G.PRIMARY_K[r.k] ? G.COOLANT[G.priD().cool].pipeK : 1;
  check("run " + r.key + " rating", G.runRating(r), 2*(138/pk)*t/D, 1e-9, SRC, {unit:"MPa", note:"wall " + (t + 3).toFixed(1) + " mm, bore " + D.toFixed(0) + " mm"});
  check("run " + r.key + " bursts at", G.runBurstP(r), 2*(485/pk)*t/D, 1e-9, SRC, {unit:"MPa"}); }
