"use strict";
// chunks: pwr relay box,0 box,1 box,2 box,3 box,4 box,5 box,6 box,7 box,8
/* plan-reactor-ui 6.1: the vessel off the drawing - fuel diameter from latM(), the drawn reflector, the barrel and
   downcomer off the four-loop reference, plena that hold the withdrawn rods, heads over all of it.
   box,N (6.2 measurement): the vessel's box in cells over MPC against the fixed 9x12 MACHINE.core and the board. */
const {check, commissionPreset} = require("./lib.js");
const mode = process.argv[2];
if(mode === "pwr"){
  const G = commissionPreset(0);
  const cd = G.coreD(G.IX.coreId[0]), M = G.latM(cd);
  const id = G.vesselDiaM(cd), h = G.vesselHgtM(cd);
  const ID_SRC = "vessel ID 4.39 m on a ~3.38 m core, assembled vessel+head 13.36 m on 3.66 m active fuel (MIT OCW 22.06, NRC HRTD 3.1)";
  check("stock PWR vessel ID over core diameter, against the published four-loop 4.39/3.38", id/M.dia, 4.39/3.38, 0.05, ID_SRC,
    {note:"ID " + id.toFixed(2) + " m on a " + M.dia.toFixed(2) + " m core (reflector " + cd.lat.reflR.toFixed(1) + " cm drawn)"});
  check("stock PWR vessel height over active height, against the published four-loop 13.36/3.66", h/M.hgt, 13.36/3.66, 0.08, ID_SRC,
    {note:"height " + h.toFixed(2) + " m on " + M.hgt.toFixed(2) + " m active (lower " + G.vesLowerM(cd).toFixed(2) + ", upper " + G.vesUpperM(cd).toFixed(2) + ")"});
}
if(mode === "relay"){
  /* a bench redraw that grows the vessel under routed pipework: the box follows, the nozzles ride their faces,
     and the stranded runs go back through runLay() (plan-reactor-ui 6.2, backlog 08/09/26) */
  const G = require("./lib.js").load();
  G.plantPreset(0); G.buildLayout();
  const cid = G.coreIds()[0], cd = G.coreD(cid);
  const h0 = G.partOf(cid).h;
  cd.lat.len *= 1.3; G.latRevolve(cd); G.buildLayout();
  const p1 = G.partOf(cid);
  check("lengthening the fuel column grows the vessel's box", p1.h > h0 ? 1 : 0, 1, 0,
    "the box is the vessel: a taller core draws a taller box", {abs:true, note:h0 + "x -> " + p1.h + " rows"});
  const dead = (()=>{ const tr = G.pipeTrace(), on = new Set();
    for(const c of tr.conns){ on.add(c.pa); on.add(c.pb); }
    const d = [];
    for(const pid in G.D.ports){ const q = G.D.ports[pid], p = G.partOf(q.p);
      if(p && (p.role === "core" || p.role === "rods") && !on.has(pid)) d.push(pid); }
    return {d, n:tr.conns.length}; })();
  check("every vessel and drive port back on a traced connection after the grow", dead.d.length, 0, 0,
    "after a resize, pipeTrace() finds every port connected", {abs:true, note:dead.n + " traced connections"});
  /* fault injected: drag one vessel nozzle off its shell, and the check above must catch it */
  const pid0 = Object.keys(G.D.ports).find(pid => { const p = G.partOf(G.D.ports[pid].p); return p && p.role === "core"; });
  G.D.ports[pid0].dx = -5; G.D.ports[pid0].dy = -5; G.dTouch();
  const tr2 = G.pipeTrace(), on2 = new Set();
  for(const c of tr2.conns){ on2.add(c.pa); on2.add(c.pb); }
  check("fault injected, one vessel nozzle off its shell: the connection check fails", on2.has(pid0) ? 0 : 1, 1, 0,
    "the check above must be able to fail", {abs:true});
}
if(mode === "box" || (mode && mode.startsWith("box,"))){
  const pre = process.argv[3] !== undefined ? +process.argv[3] : +mode.split(",")[1];
  /* the lay only, no commission: the box, the ports and the trace are all on the board, and commissioning is the slow half */
  const G = require("./lib.js").load();
  G.plantPreset(pre); G.buildLayout();
  const name = G.PLANTPRE[pre][0];
  const rows = [];
  for(const cid of G.coreIds()){ const cd = G.coreD(cid), M = G.latM(cd);
    const w = Math.ceil(G.vesselDiaM(cd)/G.MPC), h = Math.ceil(G.vesselHgtM(cd)/G.MPC);
    const p = G.partOf(cid);
    rows.push(cid + " " + (cd.tube ? "tube" : "vessel") + " " + G.vesselDiaM(cd).toFixed(2) + "x" + G.vesselHgtM(cd).toFixed(2) +
      " m = " + w + "x" + h + " cells, on board at " + p.x + "," + p.y + " " + p.w + "x" + p.h); }
  check(name + ": vessel box in cells over MPC against the fixed 9x12 core box", 1, 1, 0,
    "6.2 measurement, before choosing: the box the vessel's own geometry draws",
    {abs:true, pass:true, note:rows.join(" | ") + " || board " + G.GW + "x" + G.GH});
  /* the pump-box hazard (backlog 08/09/26), checked here: after a resize, pipeTrace() finds every port connected */
  const tr = G.pipeTrace(), onConn = new Set();
  for(const c of tr.conns){ onConn.add(c.pa); onConn.add(c.pb); }
  const dead = [];
  for(const pid in G.D.ports){ const q = G.D.ports[pid], p = G.partOf(q.p);
    if(p && (p.role === "core" || p.role === "rods") && !onConn.has(pid)) dead.push(pid); }
  check(name + ": every vessel and drive port on a traced connection after the box resize", dead.length, 0, 0,
    "a laid run the new box overlaps is re-laid through runLay(), never edited by hand: no nozzle left adrift",
    {abs:true, note:dead.length ? "adrift: " + dead.join(" ") : tr.conns.length + " traced connections"});
  const limbo = G.LAY.parts.filter(p => p.limbo).map(p => p.id);
  check(name + ": parts standing clear after the box resize (info)", 1, 1, 0, "6.2 measurement",
    {abs:true, pass:true, note:limbo.length ? "LIMBO: " + limbo.join(" ") : "none limbo"});
}
