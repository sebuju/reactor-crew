module.exports = C => {
const {M, D, COL, colNodeT, colNodeP, colNodeX, colNet, colTankP, colTankQ, clamp_} = C;

const box = id => M.partOf(id);
const joinV = (R, a, b, ax, bx) => R.run(R.port(a, ax||0, box(a).h), R.port(b, bx||0, -1));
const joinH = (R, a, b, ay, by) => R.run(R.port(a, box(a).w, ay||0), R.port(b, -1, by||0));
const SMALL = {vol:2};
const src  = (R, id, x, y, p) => R.source(id, x, y, p, Object.assign({}, SMALL));
const vd   = (R, id, x, y)    => R.void_ (id, x, y, Object.assign({}, SMALL));
// every rig is finished the same way: rated pipe, reactor stood down, hydraulics only
const done = (R, note) => { R.wall(60); clamp_("n", 0); clamp_("Tavg", 560);
  return note || {}; };

const NETCOLS = () => ({nodes:colNet.nodes, edges:colNet.edges, comps:colNet.comps,
                        live:colNet.live});

return {

  netTrivial(){
    return {name:"source, tee, void - one path and exactly one free node",
      build(R){
        src(R, "srcA", 6, 4, 16.0);
        const t = R.fit(6, 12, "tee", "RIG TEE");
        vd(R, "sinkA", 6, 20);
        joinV(R, "srcA", t); joinV(R, t, "sinkA");
        return done(R, {note:"hydraulics only"});
      },
      cols(){ return Object.assign(NETCOLS(),
        {srcP:colTankP("srcA"), sinkP:colTankP("sinkA"),
         srcQ:colTankQ("srcA"), sinkQ:colTankQ("sinkA")}); }};
  },

  netParallel(){
    return {name:"two legs of different bore between one pair of tees",
      build(R){
        src(R, "srcA", 6, 3, 16.0);
        const a = R.fit(6, 9, "tee", "TEE A"), b = R.fit(6, 21, "tee", "TEE B");
        vd(R, "sinkA", 6, 27);
        joinV(R, "srcA", a); joinV(R, b, "sinkA");
        R.run(R.port(a, 0, 1), R.port(b, 0, -1));
        R.run(R.port(a, 1, 0), R.port(b, 1, 0), [[14,15]]);
        M.buildLayout();
        const map = M.pipeMap().byKey;
        const legs = Object.keys(map)
          .filter(k => k.indexOf(a) >= 0 && k.indexOf(b) >= 0).sort()
          .map(k => M.runIdOf(map[k]));
        D.bore = D.bore || {};
        if(legs[0]) D.bore[legs[0]] = 300;
        if(legs[1]) D.bore[legs[1]] = 900;
        return done(R, {note:"legs at 300 and 900 mm"});
      },
      cols(){ return Object.assign(NETCOLS(),
        {srcQ:colTankQ("srcA"), sinkQ:colTankQ("sinkA"), flowK:colNet.flowK}); }};
  },

  netLoop(){
    return {name:"a pump and four runs in a closed ring - no boundary at all",
      build(R){
        const p = R.machine("pump", 20, 20);
        const a = R.fit(20, 10, "tee", "RING A"), b = R.fit(30, 10, "tee", "RING B"),
              c = R.fit(30, 26, "tee", "RING C");
        R.run(R.port(p, 0, -1), R.port(a, 0, 1));
        joinH(R, a, b);
        R.run(R.port(b, 0, 1), R.port(c, 0, -1));
        R.run(R.port(c, -1, 0), R.port(p, box(p).w, 0));
        return done(R, {note:"no tank, no pressurizer, no condenser"});
      },
      cols(){ return Object.assign(NETCOLS(), {flowK:colNet.flowK}); }};
  },

  netStock(){
    return {name:"the STOCK PWR preset",
      build(R){ M.plantPreset(0); return {}; },
      cols(){ return Object.assign(NETCOLS(),
        {P:COL.P, inv:COL.inv, Tavg:COL.Tavg, mwe:COL.mwe, flowK:colNet.flowK, nat:colNet.nat}); }};
  },

  /* NOT a preset ship: no PLANTPRE row states a stock plant with three loops */
  netStock3(){
    return {name:"the stock ship, three loops - not a preset",
      build(R){ M.buildStockPlumbing({loops:3}); return {}; },
      cols(){ return Object.assign(NETCOLS(),
        {P:COL.P, inv:COL.inv, Tavg:COL.Tavg, mwe:COL.mwe, flowK:colNet.flowK, nat:colNet.nat}); }};
  },

  netOrphan(){
    let id = null;
    return {name:"a machine with no run on any face - its own internal paths, and no anchor",
      build(R){ id = R.machine("sg", 12, 10); return done(R, {}); },
      cols(){ return Object.assign(NETCOLS(),
        {sgT:colNodeT(id+"l"), sgP:colNodeP(id+"l")}); }};
  },

  netSelf(){
    let id = null;
    return {name:"a run from one face back to the same face - the self-loop skip",
      build(R){
        id = R.machine("sg", 12, 12);
        R.run(R.port(id, 0, -1), R.port(id, 2, -1), [[12,8]]);
        return done(R, {note:"both ends are node "+id+"t"});
      },
      cols(){ return Object.assign(NETCOLS(), {sgP:colNodeP(id+"t")}); }};
  },

  netIsland(){
    return {name:"two disjoint plants on one grid - two components, two frames",
      build(R){
        for(const [n,x,p] of [["A",6,16.0],["B",30,8.0]]){
          src(R, "src"+n, x, 4, p);
          const t = R.fit(x, 12, "tee", "TEE "+n);
          vd(R, "sink"+n, x, 20);
          joinV(R, "src"+n, t); joinV(R, t, "sink"+n);
        }
        return done(R, {note:"A pushed at 16 MPa, B at 8"});
      },
      cols(){ return Object.assign(NETCOLS(),
        {aQ:colTankQ("srcA"), bQ:colTankQ("srcB")}); }};
  },

  netNoAnchor(){
    return {name:"a ring of four tees - nothing fixes it, nothing drives it",
      build(R){
        const a = R.fit(12, 10, "tee", "T A"), b = R.fit(24, 10, "tee", "T B"),
              c = R.fit(24, 22, "tee", "T C"), d = R.fit(12, 22, "tee", "T D");
        joinH(R, a, b); joinV(R, b, c); joinH(R, d, c); joinV(R, a, d);
        return done(R, {});
      },
      cols(){ return Object.assign(NETCOLS(), {flowK:colNet.flowK}); }};
  },

  netChain(){
    return {name:"twenty tees in series between one source and one void",
      build(R){
        // four cells apart: closer and the two nozzles want the same cell, at three the run has no pipe cell left
        const ids = [];
        for(let i=0;i<10;i++) ids.push(R.fit(8 + 4*i, 12, "tee", "T"+i));
        for(let i=0;i<10;i++) ids.push(R.fit(44 - 4*i, 20, "tee", "T"+(10+i)));
        src(R, "srcA", 3, 8, 16.0);
        vd(R, "sinkA", 3, 24);
        R.run(R.port("srcA", box("srcA").w, 0), R.port(ids[0], -1, 0));
        for(let i=0;i<9;i++) if(ids[i] && ids[i+1]) joinH(R, ids[i], ids[i+1]);
        if(ids[9] && ids[10]) joinV(R, ids[9], ids[10]);
        for(let i=10;i<19;i++) if(ids[i] && ids[i+1])
          R.run(R.port(ids[i], -1, 0), R.port(ids[i+1], 1, 0));
        R.run(R.port(ids[19], -1, 0), R.port("sinkA", box("sinkA").w, 0));
        return done(R, {});
      },
      cols(){ return Object.assign(NETCOLS(), {srcQ:colTankQ("srcA")}); }};
  },

  netStar(){
    return {name:"nine runs onto the folded core node",
      build(R){
        const hub = R.machine("core", 20, 14), p = box(hub);
        const ids = [];
        for(let i=0;i<5;i++){ const t = R.fit(20 + i, 29, "tee", "S"+i);
          ids.push(t); if(t) R.run(R.port(t, 0, -1), R.port(hub, i, p.h)); }
        for(let i=0;i<4;i++){ const t = R.fit(32, 14 + 3*i, "tee", "R"+i);
          ids.push(t); if(t) R.run(R.port(t, -1, 0), R.port(hub, p.w, 3*i)); }
        src(R, "srcA", 36, 26, 8.0);
        R.run(R.port("srcA", -1, 0), R.port(ids[4], 1, 0));
        return done(R, {note:"every face of the reactor is the same node"});
      },
      cols(){ return Object.assign(NETCOLS(), {hubP:colNodeP("core")}); }};
  },

  netAllShut(){
    let mid = null;
    return {name:"every valve shut before t=0 - every edge g<=0",
      build(R){
        src(R, "srcA", 6, 4, 16.0);
        const v1 = R.fit(6, 10, "throttle", "V1"), t = mid = R.fit(6, 14, "tee", "MID"),
              v2 = R.fit(6, 18, "throttle", "V2");
        vd(R, "sinkA", 6, 24);
        joinV(R, "srcA", v1); joinV(R, v1, t); joinV(R, t, v2); joinV(R, v2, "sinkA");
        for(const fid of [v1, v2]) if(fid){ clamp_("valve."+fid, 0); clamp_("valveDem."+fid, 0); }
        return done(R, {note:"both throttles clamped shut"});
      },
      cols(){ return Object.assign(NETCOLS(),
        {srcQ:colTankQ("srcA"), midP:colNodeP(mid)}); }};
  },

  netTankRing(){
    return {name:"three fixed tanks in a ring - every edge has two fixed ends",
      build(R){
        src(R, "tkA", 8, 6, 16.0);
        src(R, "tkB", 26, 6, 12.0);
        src(R, "tkC", 17, 22, 8.0);
        joinH(R, "tkA", "tkB");
        R.run(R.port("tkB", 0, box("tkB").h), R.port("tkC", box("tkC").w, 0));
        R.run(R.port("tkA", 0, box("tkA").h), R.port("tkC", -1, 0));
        return done(R, {note:"16, 12 and 8 MPa behind the three of them"});
      },
      cols(){ return Object.assign(NETCOLS(),
        {aQ:colTankQ("tkA"), bQ:colTankQ("tkB"), cQ:colTankQ("tkC")}); }};
  },

  netSteamWater(){
    let sgId = null;
    return {name:"a steam run and a water run onto the same node",
      build(R){
        const sg = sgId = R.machine("sg", 12, 16), tb = R.machine("turb", 26, 8);
        src(R, "tkA", 6, 6, 8.0);
        R.run(R.port(sg, 0, -1), R.port(tb, 0, -1));
        R.run(R.port("tkA", 0, box("tkA").h), R.port(sg, 2, -1));
        return done(R, {note:"both land on "+sg+"t"});
      },
      cols(){ return Object.assign(NETCOLS(),
        {sgtP:colNodeP(sgId+"t"), sgtT:colNodeT(sgId+"t"), tkQ:colTankQ("tkA")}); }};
  },

  netRing(){
    let top = null, bot = null;
    return {name:"a twelve metre isothermal ring - the circulation the density field invents",
      build(R){
        // no two edges alike: a rectangle's two vertical legs cancel term for term and the reading would be a symmetry
        const a = top = R.fit(14, 4, "tee", "RING A"), b = R.fit(30, 10, "tee", "RING B"),
              c = R.fit(30, 30, "tee", "RING C"), d = bot = R.fit(14, 24, "tee", "RING D"),
              m = R.fit(22, 4, "tee", "RING M");
        joinH(R, a, m); joinH(R, m, b); joinV(R, b, c); joinH(R, d, c); joinV(R, a, d);
        // the hold tank is what keeps the ring liquid: with no boundary it floats onto P.Pcont, where 560 K is steam
        R.tank("pzr", 21, 9, 0, {inf:false, gas:null, vol:40, level:50, hold:{p:15.5}});
        joinV(R, m, "pzr");
        return done(R, {note:"tolerance 1e-3 kg/s"});
      },
      cols(){ return Object.assign(NETCOLS(),
        {maxQ:colNet.maxQ, topP:colNodeP(top), botP:colNodeP(bot),
         topT:colNodeT(top), botT:colNodeT(bot)}); }};
  },

  // backlog 10/09/26: BN-600, feed pump shut through act() so the shells run dry, then the
  // turbine's own stop valve shut through act() - who donates the 115 MPa / 849 K reading
  bn600DryTrip(){
    let turbPort=null, turbNode=null, sgL=null, radL=null;
    return {name:"BN-600: feed pump shut, shells run dry, then the turbine stop valve shut",
      build(R){
        M.plantPreset(3);
        sgL = M.sgIds(); radL = M.radIds();
        for(const pid in D.ports){ const p=D.ports[pid];
          if(p.p==="turb" && p.dy===-1){ turbPort=pid; break; } }
        if(turbPort!=null){
          const map = M.pipeMap().byKey;
          for(const k in map) if(k.indexOf("turbt")>=0){ turbNode="run:"+k; break; }
        }
        return {note:(turbPort==null?"NO TURBINE INLET PORT":"stop valve port "+turbPort)+
                     " / "+(turbNode||"NO TURBINE NODE FOUND")};
      },
      at:{0.1:()=>{ M.actId("pumpDem","feed",0); },
          20:()=>{ if(turbPort!=null) M.actId("portShut", turbPort); }},
      cols(){
        const o = {mwe:COL.mwe, turbTrip:{dp:0,f:()=>M.ST().sc[SC_TURBTRIP]},
          condT:{dp:1,f:()=>M.ST().sc[SC_CONDT]}, turbSc:{dp:3,f:()=>M.ST().sc[SC_TURBP]}};
        if(turbNode) o.turbP = colNodeP(turbNode);
        sgL.forEach((id,i)=>{ o["sg"+i+"P"]=colNodeP(id+"t"); o["sg"+i+"x"]=colNodeX(id+"t"); o["sg"+i+"T"]=colNodeT(id+"t"); });
        radL.forEach(id=>{ o["wr_"+id]={dp:0,f:()=>{ const a=M.IX().part.get(id); return a===undefined?-1:M.ST().dmgBy[a]; }}; });
        return o;
      }};
  },

  /* job 29: exchangers in series never flown. Three ROLE.ihx, four circuits (source, two
     pumped intermediate rings, sink) - the walk (ihxFeeds/stageCirc) is what chains them,
     nothing here names a stage-to-stage relation. */
  netIhx3(){
    let s1=null, s2=null, s3=null, coreId=null;
    const stageOf = id => { const PT=M.PT(); const g = M.uiIx("sg", id); if(g >= 0) return g;
      const x = M.uiIx("ihx", id); return x < 0 ? -1 : PT.n.sg + x; };
    const qOf = id => { const x=M.uiIx("ihx", id); return x<0?0:M.ST().ihxQBy[x]; };
    // the exact counterflow re-derived here, never a call into the engine's law: UA = the integral of dq/(T_a - T_b)
    // in midpoint steps on the model's own T(h), q by bisection; the UA flow exponent 0.8 is read off machines.js
    // (E_UA_FLOW), and the film is not re-derived, so a two-phase stream reads NaN
    const stageCalc = id => {
      const SX=M.SX(), PT=M.PT(), ST=M.ST(), st=stageOf(id), q=qOf(id);
      if(st<0) return {q,qx:0,dT:0};
      const a=2*st, b=a+1, na=SX.stgN[a], nb=SX.stgN[b], dT=SX.stgT[a]-SX.stgT[b];
      if(na<0 || nb<0 || !(dT>0)) return {q,qx:0,dT};
      if(SX.stgX[a]>0 || SX.stgX[b]>0) return {q,qx:NaN,dT};
      const UA = PT.stageUA[st]*Math.pow(Math.min(SX.stgFl[a], SX.stgFl[b]),0.8);
      const ca=M.eNodeSat(na), cb=M.eNodeSat(nb), pa=M.eNodeP(na), pb=M.eNodeP(nb), wa=SX.stgW[a], wb=SX.stgW[b], ha=ST.hBy[na], hb=ST.hBy[nb];
      const req = qq => { const N=400, dq=qq/N; let u=0;
        for(let i=0;i<N;i++){ const m=(i+0.5)*dq, d=M.tOfH(ca,pa,ha-(qq-m)/wa)-M.tOfH(cb,pb,hb+m/wb); if(!(d>0)) return Infinity; u+=dq/d; }
        return u; };
      let lo=0, hi=1; while(req(hi)<UA) hi*=2;
      for(let k=0;k<50;k++){ const m=(lo+hi)/2; if(req(m)<UA) lo=m; else hi=m; }
      return {q,qx:(lo+hi)/2,dT};
    };
    // eStageFed() (machines.js) only ever sees a stage's hot side as FED if it reaches the core's
    // own loop or another stage's cold face - a bare source tank does not qualify. So stage 1's
    // hot side has to stand on the STOCK PWR's own core; the other three circuits (two relays plus
    // the tertiary sink) are plain source/void pairs the tank's own pressure drives, exactly the
    // once-through idiom every other profile in this file uses. The board has to grow to fit this
    // (the stock ship alone fills the default 60x34), and every extra row of height is far more
    // expensive per tick than a column of width, so the whole chain runs wide, not tall.
    return {name:"three intermediate exchangers in series off the stock PWR core - a cascade of four circuits, never drawn before",
      build(R){
        M.plantPreset(0);
        D.gw = 150; D.gh = 36;
        coreId = Object.keys(D.machines).find(k => D.machines[k].kind === "core");
        const cb = box(coreId);
        s1 = R.machine("ihx", 71, 4);
        s2 = R.machine("ihx", 85, 10);
        s3 = R.machine("ihx", 71, 16);
        vd(R, "voidP", 77, 4);
        src(R, "coldS", 71, 12, 4.0);
        vd(R, "voidS", 71, 22);
        src(R, "sourceL1", 71, 0, 6.0);
        vd(R, "voidL1", 93, 10);
        src(R, "sourceL2", 85, 6, 6.0);
        vd(R, "voidL2", 77, 16);

        // primary: the core's own hot leg into stage 1, discharged to a void - no claim about a real primary
        R.run(R.port(coreId, cb.w, 2), R.port(s1, -1, 1));
        joinH(R, s1, "voidP", 1, 0);

        // tertiary: cooling water through stage3's secondary, open-ended
        joinV(R, "coldS", s3, 0, 1);
        joinV(R, s3, "voidS", 1, 0);

        // L1: stage1's secondary picks up heat and relays it into stage2's primary; L2 the same, stage2 to stage3.
        // Each relay is its own source/void pair rather than a pumped ring: no pump duty exists for a rig with
        // no rated core loop to size one off, and a headless closed loop with no expansion tank cavitates to zero head.
        joinV(R, "sourceL1", s1, 0, 1);
        joinV(R, "sourceL2", s2, 0, 1);
        R.run(R.port(s1, 1, box(s1).h), R.port(s2, -1, 1));
        joinH(R, s2, "voidL1", 1, 0);
        R.run(R.port(s2, 1, box(s2).h), R.port(s3, -1, 1));
        joinH(R, s3, "voidL2", 1, 0);

        D.ihxUA = D.ihxUA || {};
        D.ihxUA[s1] = 800; D.ihxUA[s2] = 600; D.ihxUA[s3] = 400;
        clamp_("n", 1);
        clamp_("hBy.coldS", 113);
        return {note:"UA 800/600/400 kW/K down the chain, core at n=1, coldS clamped cold"};
      },
      cols(){ return Object.assign(NETCOLS(), {
        coreT:colNodeT(coreId), coldT:colNodeT("coldS"),
        voidPT:colNodeT("voidP"), voidST:colNodeT("voidS"),
        T1l:colNodeT(s1+"l"), T1r:colNodeT(s1+"r"), T1t:colNodeT(s1+"t"), T1b:colNodeT(s1+"b"),
        T2l:colNodeT(s2+"l"), T2r:colNodeT(s2+"r"), T2t:colNodeT(s2+"t"), T2b:colNodeT(s2+"b"),
        T3l:colNodeT(s3+"l"), T3r:colNodeT(s3+"r"), T3t:colNodeT(s3+"t"), T3b:colNodeT(s3+"b"),
        q1:{dp:2,f:()=>qOf(s1)}, qx1:{dp:2,f:()=>stageCalc(s1).qx},
        q2:{dp:2,f:()=>qOf(s2)}, qx2:{dp:2,f:()=>stageCalc(s2).qx},
        q3:{dp:2,f:()=>qOf(s3)}, qx3:{dp:2,f:()=>stageCalc(s3).qx},
      }); }};
  },

  /* a once-through generator's superheat region drawn as its own box: on the stock plant the hot leg runs through an
     exchanger before generator 0, and the generator's steam runs back through that exchanger's other stream to the turbine */
  netSh(){
    let ex = null, sg = null;
    return {name:"a superheater in series ahead of the stock plant's generator: hot leg -> superheater -> tubes, shell steam -> superheater -> turbine",
      build(R){
        M.plantPreset(0);
        sg = Object.keys(D.machines).find(k => D.machines[k].kind === "sg");
        const tb = Object.keys(D.machines).find(k => D.machines[k].kind === "turb");
        const portAt = (id, f) => Object.keys(D.ports).find(pid => D.ports[pid].p === id && M.portFaceOf(pid) === f);
        // the run landing on (id, f) lifted, and its two nozzles as [part, dx, dy]: lifting a run takes its ports with it
        const cut = (id, f) => { const pid = portAt(id, f), rid = D.ports[pid].run;
          const ends = Object.keys(D.ports).filter(q => D.ports[q].run === rid).map(q => [D.ports[q].p, D.ports[q].dx, D.ports[q].dy]);
          M.removeRun(rid); return ends[0][0] === id ? [ends[1], ends[0]] : ends; };
        const [hotFar, hot] = cut(sg, "l"), [stmFar, stm] = cut(tb, "t");
        ex = R.machine("ihx", 24, 9);
        const re = e => R.port(e[0], e[1], e[2]);
        R.run(re(hotFar), R.port(ex, -1, 1)); R.run(R.port(ex, box(ex).w, 1), re(hot));
        R.run(re(stmFar), R.port(ex, 1, -1)); R.run(R.port(ex, 1, box(ex).h), re(stm));
        D.ihxUA = D.ihxUA || {}; D.ihxUA[ex] = 2000;
        return {note:"superheater UA 2000 kW/K"};
      },
      cols(){ return {mwe:COL.mwe, Tavg:COL.Tavg,
        turbP:{dp:3, f:()=>M.ST().sc[SC_TURBP]}, turbH:{dp:1, f:()=>M.ST().sc[SC_TURBH]},
        Tl:colNodeT(ex+"l"), Tr:colNodeT(ex+"r"), Tt:colNodeT(ex+"t"), Tb:colNodeT(ex+"b"),
        q:{dp:1, f:()=>{ const x = M.uiIx("ihx", ex); return x < 0 ? 0 : M.ST().ihxQBy[x]; }}, sgQ:{dp:1, f:()=>{ const b = M.uiIx("boiler", sg); return b < 0 ? 0 : M.ST().hbSgQ[b]; }}}; }};
  },
};
};
