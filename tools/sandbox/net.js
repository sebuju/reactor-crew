module.exports = C => {
const {M, D, COL, colNodeT, colNodeP, colNet, colTankP, colTankQ, clamp_} = C;

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
    return {name:"the stock ship, one loop",
      build(R){ M.buildStockPlumbing({loops:1}); return {}; },
      cols(){ return Object.assign(NETCOLS(),
        {P:COL.P, inv:COL.inv, Tavg:COL.Tavg, mwe:COL.mwe, flowK:colNet.flowK, nat:colNet.nat}); }};
  },

  netStock3(){
    return {name:"the stock ship, three loops",
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
};
};
