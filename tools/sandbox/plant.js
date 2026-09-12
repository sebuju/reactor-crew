module.exports = C => {
const {M, D, COL, colP, colTank, colTankP, colRate, colNodeT, colNodeX,
       colSgT, colSecP, colHold, clamp_} = C;
return {

  pzrAlone(){
    return {name:"pressurizer alone: vessel, surge line, one boundary",
      build(R){
        M.plantPreset(0);
        for(const fid in D.fittings) if(D.fittings[fid].mode==="relief") D.fittings[fid].bore=0.1;
        return {note:"stock primary, relief throttled shut"};
      },
      cols(){ const ci=M.nodeGraph().coreCirc;
        return {P:colP(ci), set:{dp:3,f:()=>M.holdSetP(ci)}, lvl:COL.lvl,
                live:colHold(ci), pzrT:colNodeT("pzr"), pzrX:colNodeX("pzr"),
                Tavg:COL.Tavg, sc:COL.sc}; }};
  },

  pzrIsolate(){
    return {name:"pressurizer isolated at t=20: the circuit must relax to containment",
      build(R){ M.plantPreset(0); return {}; },
      cols(){ const ci=M.nodeGraph().coreCirc;
        return {P:colP(ci), live:colHold(ci), lvl:COL.lvl, inv:COL.inv,
                Tavg:COL.Tavg, sc:COL.sc, mwe:COL.mwe}; },
      at:{20:s=>{ s.tankByp = s.tankByp||{}; for(const id of M.holdTankIds()) s.tankByp[id]=true; }}};
  },

  twoHolds(){
    return {name:"a second hold tank on the secondary circuit",
      build(R){
        M.plantPreset(0);
        const p = M.partOf("feed");
        R.tank("pzr2", p.x, Math.max(0,p.y-6), 0, {name:"SEC PRESSURIZER", col:"#a98cf0",
          vol:40, level:50, inf:false, gas:null, hold:{p:7.5}});
        const a = R.port("pzr2", 1, M.partOf("pzr2").h);
        const b = R.port("feed", 1, -1);
        R.run(a, b);
        return {note:"pzr2 holds 7.5 MPa on the secondary"};
      },
      cols(){ const G=M.nodeGraph();
        const cs=M.holdCircs();
        const o={};
        for(const ci of cs){ o["P"+ci]=colP(ci); o["live"+ci]=colHold(ci); }
        o.sgT=colSgT("sg0"); o.secP=colSecP("sg0"); o.mwe=COL.mwe; o.Tavg=COL.Tavg;
        return o; }};
  },

  flowOnly(){
    return {name:"one source, one void, one pipe - the solve with nothing else in it",
      build(R){
        M.plantPreset(0);
        R.source("srcA", 0, 0, 16.0, {name:"SOURCE", vol:30});
        R.void_ ("sinkA", 0, 9, {name:"VOID", vol:30});
        // both tanks are FIXED nodes and netAssemble writes no row for an edge with two known ends: the tee is the free node
        const t = R.fit(1, 6, "tee", "RIG TEE");
        R.run(R.port("srcA", 1, M.partOf("srcA").h), R.port(t, 0, -1));
        R.run(R.port(t, 0, 1), R.port("sinkA", 1, -1));
        R.wall(60);
        clamp_("n", 0); clamp_("Tavg", 560);
        return {note:"reactor power and Tavg clamped: hydraulics only"};
      },
      cols(){ return {srcP:colTankP("srcA"), sinkP:colTankP("sinkA"),
                      srcQ:colRate("srcA"), sinkQ:colRate("sinkA"),
                      srcL:colTank("srcA"), sinkL:colTank("sinkA"), inv:COL.inv}; }};
  },

  setpoint(){
    return {name:"one row per setpoint: what it holds, and what it weighs",
      sweep:[10,12,14,15.5,17,19,21],
      build(R,v){
        M.plantPreset(0);
        for(const id of M.holdTankIds()) D.tanks[id].hold.p = v;
        return {};
      },
      cols(){ const ci=M.nodeGraph().coreCirc;
        return {set:{dp:2,f:()=>M.holdSetP(ci)}, P:colP(ci), Tavg:COL.Tavg,
                sc:COL.sc, mwe:COL.mwe, tsat:{dp:1,f:s=>M.P().tsat0},
                mass:{dp:0,f:()=>M.derived().mass}, tankT:{dp:1,f:()=>M.tankMass()}}; }};
  },

  bubble(){
    return {name:"one row per vessel volume: pressure swing after a load step",
      sweep:[20,35,50,70,100],
      build(R,v){
        M.plantPreset(0);
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
