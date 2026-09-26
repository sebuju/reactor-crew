"use strict";
// chunks: 0 0,rest 1 1,rest 2 2,rest 3 3,rest 4 4,rest 5 5,rest 6 6,rest 7 7,rest 8 8,rest
/* one preset commissioned once per chunk: the checks that read it, then the ones that act on it and put it back; ",rest" its watched rest,
   apart because a loop that takes longer to pass once than the question lasts is marched the whole question; the plant is reset before each */
const {check, commissionPreset} = require("./lib.js");
const pre = +process.argv[2], part0 = process.argv[3], G = commissionPreset(pre), name = G.PLANTPRE[pre][0];
const GROUPS = part0 === "rest" ? [["presets"]] : [["settle.rest", "core", "plantline", "cpr", "rodworth", "fuel", "vesgeom"], ["pump", "knobs", "cwtank", "settle.again"]];
// the rest-pass solvers a check may call write PT reference columns, which resetPlant() does not own
const PT0 = {};
for(const k in G.PT) if(ArrayBuffer.isView(G.PT[k])) PT0[k] = G.PT[k].slice();
for(const group of GROUPS) for(const m of group){
  const [file, part] = m.split("."), mod = require("./plant/" + file + ".js");
  for(const k in PT0) G.PT[k].set(PT0[k]);
  G.resetPlant(); G.eNetInvalidate();
  try { (part ? mod[part] : mod)(G, pre); }
  catch(e){ check(name + ": plant/" + m + " runs to its end", 0, 1, 0, "a check module that throws answers nothing after the throw",
    {abs:true, note:String(e && e.stack || e).split("\n").slice(0, 2).join(" | ")}); }
  if(G.designSig() !== G.P.dsig) throw new Error("plant/" + m + " changed the design");
}
