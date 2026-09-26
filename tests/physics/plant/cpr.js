"use strict";
/* each family's rest on its commissioned core: every node's margin off the plant, and none departed */
const {check, swap} = require("../lib.js");
const FAMILY = {0:"pwr", 2:"bwr", 3:"boil", 5:"rbmk", 6:"salt", 7:"gas"};
module.exports = (G, pre) => {
  const mode = FAMILY[pre];
  if(!mode) return;
  const PT = G.PT, ST = G.ST, name = G.PLANTPRE[pre][0], m = ST.csDnbrMin[0];
  let dep = 0; for(let k=0;k<G.XNN*PT.n.core;k++) dep += ST.csNDnb[k];

  if(mode === "pwr"){
    check(name + ": minimum DNBR at rest, W-3 raw, no constant", m, 2.0, 0,
      "Byron/Braidwood UFSAR Rev 15 Table 4.4-1 (NRC ML14363A430): minimum DNBR > 2.0 at nominal, typical and thimble channel", {pass:m >= 2.0, note:"design limit 1.30 (Tong 1967)"});
    check(name + ": no node in departure at rest", dep, 0, 0, "a commissioned core at rated power is in nucleate boiling everywhere", {abs:true});
  }

  if(mode === "bwr"){
    const c = 0;
    check(name + ": MCPR at rest over the safety limit", m, 1.07, 0, "NRC HRTD GE BWR/4 Technology Manual 1.8 (ML11258A297): MCPR safety limit ~1.07", {pass:m >= 1.07,
      note:"crisis at ring " + ST.csDnbrRing[c] + " plane " + ST.csDnbrLev[c] + "; a real BWR sits at its 1.2-1.6 operating limit, this one is rated off the bought surface flux (fidelity: departure from nucleate boiling, water)"});
    check(name + ": no node in departure at rest", dep, 0, 0, "a BWR at rated power is inside its MCPR limit everywhere", {abs:true});
    const back = swap(G, "eCiseA", "Math.pow(io[2], E_CISE_BD)", "Math.pow(1000*io[2], E_CISE_BD)");
    for(let t=0;t<2;t++) G.eCoreRestStep(c, G.SX.coreFN[c]);
    const bad = ST.csDnbrMin[c]; back();
    check(name + ": fault injected, CISE-4's diameter in mm: the safety-limit check fails", bad < 1.07 ? 1 : 0, 1, 0, "the check above must be able to fail",
      {abs:true, note:"reads " + bad.toFixed(3)});
  }

  if(mode === "rbmk"){
    check(name + ": critical power ratio at rest over 1", m, 1.0, 0, "IAEA SRS-43 Tables 3-4 and INSAG-7: a critical power margin over 1.0 required, operating and safety limit", {pass:m > 1.0});
    check(name + ": critical power ratio at rest of the order of Chernobyl-4's", m, 1.115, 0,
      "Adams et al., Nucl. Tech. 96:3 (1991): 1.115 at normal operation on the Soviet correlation; the behaviour graded: over 1, under 2", {pass:m > 1.0 && m < 2.0});
    check(name + ": no node in departure at rest", dep, 0, 0, "a channel at rated power is inside its critical power", {abs:true});
  }

  if(mode === "boil"){
    const c = 0, nb = 0, XNN = G.XNN, cp = PT.coreCp[c];
    const Tin = G.eNetCoreInH(c)/cp, Ts = G.satT(PT.coreSat[c], ST.csPCore[c]);
    let hot = 0; for(let k=0;k<XNN;k++) hot = Math.max(hot, ST.csNTct[nb+k]);
    const lim = nb + ST.csDnbrRing[c]*G.XNZ + ST.csDnbrLev[c];
    check(name + ": the boiling margin equals (T_sat - T_in)/(T_node - T_in) by hand at the limiting node", ST.csDnbrMin[c], (Ts - Tin)/(ST.csNTct[lim] - Tin), 1e-12,
      "the first-principles ratio, no constant", {note:"T_sat " + Ts.toFixed(0) + " K, inlet " + Tin.toFixed(0) + " K"});
    check(name + ": the hottest sodium's margin to boiling at rest", Ts - hot, 300, 100,
      "a sodium core runs ~300 K under boiling in normal operation (GIF SFR safety assessment 2017); a core-level figure, the 200-400 K band is a judgement", {abs:true, unit:"K"});
  }

  if(mode === "salt" || mode === "gas")
    check(name + ": the raw crisis ratio at rest over 1", m, 1, 0, "a first-principles margin at rated is inside its own limit", {pass:m > 1});
};
