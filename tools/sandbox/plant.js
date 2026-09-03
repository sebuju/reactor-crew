/* THE PRESSURIZER LADDER - six profiles about one vessel and what it holds.
   Disposable, exactly like probe.js's cases: add one, read it, delete it. */
module.exports = C => {
const {M, D, COL, colP, colTank, colTankP, colRate, colNodeT, colNodeX,
       colSgT, colSecP, colHold, clamp_} = C;
return {

/* ── 1. A PRESSURIZER ON ITS OWN ──
   Nothing but the vessel, a source standing in for the loop it hangs off, and
   the surge line between them. If the setpoint is held here it is held by the
   vessel and by nothing else on the plant. */
  pzrAlone(){
    return {name:"pressurizer alone: vessel, surge line, one boundary",
      build(R){
        M.buildStockPlumbing({loops:1});
        // every relief path shut, so the only thing moving water is the surge
        for(const fid in D.fittings) if(D.fittings[fid].mode==="relief") D.fittings[fid].bore=0.1;
        return {note:"stock primary, relief throttled shut"};
      },
      cols(){ const ci=M.nodeGraph().coreCirc;
        return {P:colP(ci), set:{dp:3,f:()=>M.holdSetP(ci)}, lvl:COL.lvl,
                live:colHold(ci), pzrT:colNodeT("pzr"), pzrX:colNodeX("pzr"),
                Tavg:COL.Tavg, sc:COL.sc}; }};
  },

/* ── 2. THE SURGE LINE CUT ──
   The check that has never been seen to fail. Isolate the vessel at 20 s and
   the circuit must relax toward containment - and ONLY that circuit. */
  pzrIsolate(){
    return {name:"pressurizer isolated at t=20: the circuit must relax to containment",
      build(R){ M.buildStockPlumbing({loops:1}); return {}; },
      cols(){ const ci=M.nodeGraph().coreCirc;
        return {P:colP(ci), live:colHold(ci), lvl:COL.lvl, inv:COL.inv,
                Tavg:COL.Tavg, sc:COL.sc, mwe:COL.mwe}; },
      at:{20:s=>{ s.tankByp = s.tankByp||{}; for(const id of M.holdTankIds()) s.tankByp[id]=true; }}};
  },

/* ── 3. TWO CIRCUITS, TWO PRESSURES ──
   A second hold tank on the secondary. Neither may drag the other, and both
   PBy entries must stand where their own vessels put them. */
  twoHolds(){
    return {name:"a second hold tank on the secondary circuit",
      build(R){
        M.buildStockPlumbing({loops:1});
        /* on the FEEDWATER line, which is secondary - placed and piped with
           the same two gestures the bench's own click and drag make */
        const p = M.partOf("feed");
        R.tank("pzr2", p.x, Math.max(0,p.y-6), 0, {name:"SEC PRESSURIZER", col:"#a98cf0",
          vol:40, level:50, inf:false, gas:null, hold:{p:7.5}});
        const a = R.port("pzr2", 1, M.partOf("pzr2").h);
        const b = R.port("feed", 1, -1);
        R.run(a, b, true);
        return {note:"pzr2 holds 7.5 MPa on the secondary"};
      },
      cols(){ const G=M.nodeGraph();
        const cs=M.holdCircs();
        const o={};
        for(const ci of cs){ o["P"+ci]=colP(ci); o["live"+ci]=colHold(ci); }
        o.sgT=colSgT("sg0"); o.secP=colSecP("sg0"); o.mwe=COL.mwe; o.Tavg=COL.Tavg;
        return o; }};
  },

/* ── 4. A SOURCE AND A VOID, AND NOTHING ELSE ──
   The pressure network on its own: one boundary pushing, one swallowing, and
   the pipe between them. Nothing thermal, nothing nuclear. This is the cheap
   rig for a conductance question. */
  flowOnly(){
    return {name:"one source, one void, one pipe - the solve with nothing else in it",
      build(R){
        M.buildStockPlumbing({loops:1});
        R.source("srcA", 0, 0, 16.0, {name:"SOURCE", vol:30});
        R.void_ ("sinkA", 0, 9, {name:"VOID", vol:30});
        /* A TEE BETWEEN THEM, and it is not decoration: both tanks are FIXED
           nodes, and netAssemble writes no row for an edge whose two ends are
           both known - so a source wired straight into a void carries exactly
           nothing. The junction is the free node the solve needs. */
        const t = R.fit(1, 6, "tee", "RIG TEE");
        R.run(R.port("srcA", 1, M.partOf("srcA").h), R.port(t, 0, -1), false);
        R.run(R.port(t, 0, 1), R.port("sinkA", 1, -1), false);
        // a rig pipe is rated for what the rig pushes: 16 MPa split the line
        // on the second tick and this profile read srcQ 12.65 against sinkQ -0.07
        R.wall(60);
        clamp_("n", 0); clamp_("Tavg", 560);
        return {note:"reactor power and Tavg clamped: hydraulics only"};
      },
      cols(){ return {srcP:colTankP("srcA"), sinkP:colTankP("sinkA"),
                      srcQ:colRate("srcA"), sinkQ:colRate("sinkA"),
                      srcL:colTank("srcA"), sinkL:colTank("sinkA"), inv:COL.inv}; }};
  },

/* ── 5. THE SETPOINT SWEEP ──
   Same plant, one knob. What the vessel is asked to hold, against what the
   plant actually settles at and what it cost in steel. */
  setpoint(){
    return {name:"one row per setpoint: what it holds, and what it weighs",
      sweep:[10,12,14,15.5,17,19,21],
      build(R,v){
        M.buildStockPlumbing({loops:1});
        for(const id of M.holdTankIds()) D.tanks[id].hold.p = v;
        return {};
      },
      cols(){ const ci=M.nodeGraph().coreCirc;
        return {set:{dp:2,f:()=>M.holdSetP(ci)}, P:colP(ci), Tavg:COL.Tavg,
                sc:COL.sc, mwe:COL.mwe, tsat:{dp:1,f:s=>M.P().tsat0},
                mass:{dp:0,f:()=>M.derived().mass}, tankT:{dp:1,f:()=>M.tankMass()}}; }};
  },

/* ── 6. THE VESSEL'S OWN SIZE ──
   Damping is the steam bubble. Sweep the volume and read how far pressure
   swings when the plant is disturbed. */
  bubble(){
    return {name:"one row per vessel volume: pressure swing after a load step",
      sweep:[20,35,50,70,100],
      build(R,v){
        M.buildStockPlumbing({loops:1});
        for(const id of M.holdTankIds()) D.tanks[id].vol = v;
        return {};
      },
      at:{10:s=>{ s.loadDem=0.5; }},
      cols(){ const ci=M.nodeGraph().coreCirc;
        return {vol:{dp:0,f:()=>D.tanks[M.holdTankIds()[0]].vol},
                pzrK:{dp:3,f:()=>M.P().pzrK}, P:colP(ci), lvl:COL.lvl,
                Tavg:COL.Tavg, mwe:COL.mwe}; }};
  },
};
};
