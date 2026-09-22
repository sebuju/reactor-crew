"use strict";
/* fidelity.md "what the loop costs at rated flow": loopHeadOf()'s height term against hydrostatics on the drawing's own heights */
// chunks: run uniform fault
const lib = require("./lib.js"), {check} = lib;
const mode = process.argv[2] || "run";
const TERM = "l.dz = nodeZ(l.to) - nodeZ(l.from); l.dpz = l.rho*G_MPA*l.dz;";
const SUB = {uniform: "l.dz = nodeZ(l.to) - nodeZ(l.from); l.dpz = rhoCold*G_MPA*l.dz;",
  fault: "l.dz = (l === path[0] ? -1 : 1)*(nodeZ(l.to) - nodeZ(l.from)); l.dpz = l.rho*G_MPA*l.dz;"}[mode];
const G = lib.load(SUB ? src => { const r = src.replace(TERM, SUB); if(r === src) throw new Error("fault site not found"); return r; } : undefined);
const tag = mode === "run" ? "" : mode === "uniform" ? "; UNIFORM: every leg at the cold density" : "; FAULT: the first leg's dz flipped";

for(const pre of [0, 6]){
  G.plantPreset(pre); G.buildLayout();
  const name = G.PLANTPRE[pre][0], L = G.loopMap(), pump = G.pumpIds().find(id => L.partLoop[id] !== undefined);
  const o = {}; G.loopHeadOf(pump, o);
  const dis = G.pumpDisNode(pump), suc = G.pumpSucNode(pump), casing = G.nodeZ(dis) - G.nodeZ(suc);
  if(mode !== "uniform"){
    let sz = casing; for(const l of o.legs) sz += G.nodeZ(l.to) - G.nodeZ(l.from);
    check(name + ": the loop walk closes from discharge to suction and returns to its own height", o.zPath ? sz : NaN, 0, 1e-9,
      "a closed loop returns to its own height (geometry)", {abs:true, unit:"m", note:o.legs.length + " legs on the path, casing " + casing.toFixed(3) + " m" + tag});
  }
  const dsg = G.loopDesignH(G.nodeGraph().coreCirc), c = dsg.c, out = new Float64Array(16);
  const rhoAt = h => { G.mixState(c, c.p0, h, out); return Math.max(out[G.MX_RHO], 1e-3); };
  const rH = rhoAt(dsg.hOut), rC = rhoAt(dsg.hIn);
  let hand = rC*G.G_MPA*casing, miss = 0;
  for(const l of o.legs){ const b = o.byRun[l.key]; if(!b){ miss++; continue; }
    hand += (mode === "uniform" ? rC : b.hot ? rH : rC)*G.G_MPA*(G.nodeZ(l.to) - G.nodeZ(l.from)); }
  const note = "hot " + rH.toFixed(1) + ", cold " + rC.toFixed(1) + " kg/m3; head " + (1000*o.dpZ).toFixed(3) + " kPa; g = G_MPA " + G.G_MPA*1e6 + " m/s2" + (miss ? "; " + miss + " legs with no density" : "") + tag;
  if(mode === "uniform")
    check(name + ": a loop of one density owes the pump no height", o.dpZ, 0, 1e-9, "sum of rho*g*dz at one rho is rho*g*sum(dz) = 0", {abs:true, unit:"MPa", note});
  else
    check(name + ": the height term is the hand sum of rho*g*dz along the flow path", miss ? NaN : o.dpZ, hand, 1e-9,
      "hydrostatics, dp = rho*g*dz on the drawing's own heights, at the design hot and cold densities", {abs:true, unit:"MPa", note});
}
