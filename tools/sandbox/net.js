/* THE NETWORK LADDER - fifteen plants the pressure network is judged on.

   The first five make sense and are what a split of netBuild()/netSolve() has
   to leave unmoved. The other nine are plants nobody would build, and they are
   the point of the exercise: NONE has to behave well. Each has to not crash,
   and each has to refuse to print a number it does not have. A blank grid is a
   legal plant and it commissions, so every one of these commissions too.

   Every profile is disposable, carries no assertions, and is flown twice - once
   clean and once under an event overlay (--hit/--shut/--burst/--blackout). */
module.exports = C => {
const {M, D, COL, colNodeT, colNodeP, colNet, colTankP, colTankQ, clamp_} = C;

// a part's own box, read back off the drawing after it is placed - never a
// number written twice
const box = id => M.partOf(id);
// the two gestures a vertical joint is: a nozzle on the lower face of the top
// machine, one on the upper face of the bottom machine, and a pipe between
const joinV = (R, a, b, ax, bx) => R.run(R.port(a, ax||0, box(a).h), R.port(b, bx||0, -1), false);
const joinH = (R, a, b, ay, by) => R.run(R.port(a, box(a).w, ay||0), R.port(b, -1, by||0), true);
// a small inexhaustible boundary: the rig's own source and void, kept to one
// cell of box so a nonsense topology still fits on the grid
const SMALL = {vol:2};
const src  = (R, id, x, y, p) => R.source(id, x, y, p, Object.assign({}, SMALL));
const vd   = (R, id, x, y)    => R.void_ (id, x, y, Object.assign({}, SMALL));
/* EVERY RIG IS FINISHED THE SAME WAY: the pipe is rated for what the rig
   pushes, and the reactor is stood down so the only thing moving is the
   network. Hydraulics only - no fission, no thermal transient to read the
   field through. */
const done = (R, note) => { R.wall(60); clamp_("n", 0); clamp_("Tavg", 560);
  return note || {}; };

const NETCOLS = () => ({nodes:colNet.nodes, edges:colNet.edges, comps:colNet.comps,
                        live:colNet.live});

return {

/* ── 1. ONE PATH, ONE FREE NODE ──
   The smallest network that solves at all. Both boundaries are FIXED, so the
   tee between them is the only row in the matrix. */
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

/* ── 2. TWO LEGS, TWO BORES ──
   The split has to follow the bores and nothing else. D.bore is written per
   RUN KEY, which is the same door the PIPES panel writes through. */
  netParallel(){
    return {name:"two legs of different bore between one pair of tees",
      build(R){
        src(R, "srcA", 6, 3, 16.0);
        const a = R.fit(6, 9, "tee", "TEE A"), b = R.fit(6, 21, "tee", "TEE B");
        vd(R, "sinkA", 6, 27);
        joinV(R, "srcA", a); joinV(R, b, "sinkA");
        R.run(R.port(a, 0, 1), R.port(b, 0, -1), false);            // the short leg
        R.run(R.port(a, 1, 0), R.port(b, 1, 0), true, [[14,15]]);   // out and back
        M.buildLayout();
        // the two legs at 300 and 900 mm, so the answer is four to one on area
        // and nothing else about the two of them differs
        const legs = Object.keys(M.pipeMap().byKey)
          .filter(k => k.indexOf(a) >= 0 && k.indexOf(b) >= 0).sort();
        D.bore = D.bore || {};
        if(legs[0]) D.bore[legs[0]] = 300;
        if(legs[1]) D.bore[legs[1]] = 900;
        return done(R, {note:"legs at 300 and 900 mm"});
      },
      cols(){ return Object.assign(NETCOLS(),
        {srcQ:colTankQ("srcA"), sinkQ:colTankQ("sinkA"), flowK:colNet.flowK}); }};
  },

/* ── 3. A CLOSED RING ──
   A pump and four runs, and no boundary anywhere. Nothing is fixed, so the
   whole component is floated onto the ship's own pressure - the reading this
   profile exists for. */
  netLoop(){
    return {name:"a pump and four runs in a closed ring - no boundary at all",
      build(R){
        const p = R.machine("pump", 20, 20);
        const a = R.fit(20, 10, "tee", "RING A"), b = R.fit(30, 10, "tee", "RING B"),
              c = R.fit(30, 26, "tee", "RING C");
        R.run(R.port(p, 0, -1), R.port(a, 0, 1), false);
        joinH(R, a, b);
        R.run(R.port(b, 0, 1), R.port(c, 0, -1), false);
        R.run(R.port(c, -1, 0), R.port(p, box(p).w, 0), true);
        return done(R, {note:"no tank, no pressurizer, no condenser"});
      },
      cols(){ return Object.assign(NETCOLS(), {flowK:colNet.flowK}); }};
  },

/* ── 4. THE REAL PLANT ── */
  netStock(){
    return {name:"the stock ship, one loop",
      build(R){ M.buildStockPlumbing({loops:1}); return {}; },
      cols(){ return Object.assign(NETCOLS(),
        {P:COL.P, inv:COL.inv, Tavg:COL.Tavg, mwe:COL.mwe, flowK:colNet.flowK}); }};
  },

/* ── 5. THREE LOOPS AND THEIR CROSS-TIES ── */
  netStock3(){
    return {name:"the stock ship, three loops",
      build(R){ M.buildStockPlumbing({loops:3}); return {}; },
      cols(){ return Object.assign(NETCOLS(),
        {P:COL.P, inv:COL.inv, Tavg:COL.Tavg, mwe:COL.mwe, flowK:colNet.flowK}); }};
  },

/* ══ THE NONSENSE LADDER ══ none of these has to behave well ══ */

/* ── 6. A MACHINE NOBODY PIPED ──
   AND IT STILL HAS NODES. The plan expected none; what a generator actually
   gets is its two INTERNAL paths, built off ROLE.internal for every part on
   the board whether or not a run ever reaches it, plus its own tube-rupture
   node. So it is four nodes and three edges of its own, in a component with
   no anchor at all - which netRef() floats onto the ship, and P.Pcont is what
   it prints. Nothing is invented and nothing is refused; it is simply a
   machine standing on its own. */
  netOrphan(){
    let id = null;
    return {name:"a machine with no run on any face - its own internal paths, and no anchor",
      build(R){ id = R.machine("sg", 12, 10); return done(R, {}); },
      cols(){ return Object.assign(NETCOLS(),
        {sgT:colNodeT(id+"l"), sgP:colNodeP(id+"l")}); }};
  },

/* ── 7. A RUN FROM A FACE BACK TO ITSELF ──
   Two nozzles on ONE face, so both ends fold onto one node. The edge is a
   self-loop and netBuild() has to drop it - it is placeable, unguarded, and it
   only ever cancelled to zero because the arithmetic happened to. */
  netSelf(){
    let id = null;
    return {name:"a run from one face back to the same face - the self-loop skip",
      build(R){
        id = R.machine("sg", 12, 12);
        R.run(R.port(id, 0, -1), R.port(id, 2, -1), false, [[12,8]]);
        return done(R, {note:"both ends are node "+id+"t"});
      },
      cols(){ return Object.assign(NETCOLS(), {sgP:colNodeP(id+"t")}); }};
  },

/* ── 8. TWO PLANTS ON ONE GRID ──
   Nothing joins them, so they are two structural components with two reference
   frames, and neither may drag the other. */
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

/* ── 9. NOTHING PINS IT ──
   A ring with no tank, no pressurizer and no condenser, and no pump either -
   so there is not even a head source. netRef() has to float the component
   rather than hand it the reactor's own setpoint. */
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

/* ── 10. TWENTY TEES IN SERIES ──
   Node count, and resist()'s own NET_COMP_LEN floor twenty times over. */
  netChain(){
    return {name:"twenty tees in series between one source and one void",
      build(R){
        /* FOUR CELLS APART, and that is geometry rather than taste: a
           fitting is one cell, so its right nozzle stands at x+1 and its
           neighbour's left nozzle at x'-1. Any closer and the two nozzles
           want the same cell and the second is refused; at exactly three the
           run has no cell of pipe left to be. Two rows of ten, because
           twenty at that spacing is wider than the grid. */
        const ids = [];
        for(let i=0;i<10;i++) ids.push(R.fit(8 + 4*i, 12, "tee", "T"+i));
        for(let i=0;i<10;i++) ids.push(R.fit(44 - 4*i, 20, "tee", "T"+(10+i)));
        src(R, "srcA", 3, 8, 16.0);
        vd(R, "sinkA", 3, 24);
        R.run(R.port("srcA", box("srcA").w, 0), R.port(ids[0], -1, 0), true);
        for(let i=0;i<9;i++) if(ids[i] && ids[i+1]) joinH(R, ids[i], ids[i+1]);
        if(ids[9] && ids[10]) joinV(R, ids[9], ids[10]);
        for(let i=10;i<19;i++) if(ids[i] && ids[i+1])
          R.run(R.port(ids[i], -1, 0), R.port(ids[i+1], 1, 0), true);
        R.run(R.port(ids[19], -1, 0), R.port("sinkA", box("sinkA").w, 0), true);
        return done(R, {});
      },
      cols(){ return Object.assign(NETCOLS(), {srcQ:colTankQ("srcA")}); }};
  },

/* ── 11. A VERY HIGH DEGREE NODE ──
   EIGHT RUNS ONTO ONE FACE IS NOT BUILDABLE, and finding that out is the
   profile doing its job: ROLE.ports states how many nozzles a face takes and
   addPortAt() refuses the ninth, so the highest a single face reaches is the
   reactor's own bottom at five. The REACTOR is the high-degree node anyway,
   because every one of its faces folds onto the bare node "core" - so its
   bottom five and its right four are nine edges on ONE row of the matrix. */
  netStar(){
    return {name:"nine runs onto the folded core node",
      build(R){
        const hub = R.machine("core", 20, 14), p = box(hub);
        const ids = [];
        for(let i=0;i<5;i++){ const t = R.fit(20 + i, 29, "tee", "S"+i);
          ids.push(t); if(t) R.run(R.port(t, 0, -1), R.port(hub, i, p.h), false); }
        for(let i=0;i<4;i++){ const t = R.fit(32, 14 + 3*i, "tee", "R"+i);
          ids.push(t); if(t) R.run(R.port(t, -1, 0), R.port(hub, p.w, 3*i), true); }
        src(R, "srcA", 36, 26, 8.0);
        R.run(R.port("srcA", -1, 0), R.port(ids[4], 1, 0), true);
        return done(R, {note:"every face of the reactor is the same node"});
      },
      cols(){ return Object.assign(NETCOLS(), {hubP:colNodeP("core")}); }};
  },

/* ── 12. EVERY VALVE SHUT ──
   A shut branch is an absent branch, so with every gate at zero the matrix is
   empty. It must solve, and it must print nothing it does not have. */
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

/* ── 13. THREE FIXED TANKS IN A RING ──
   Every edge has two known ends, so netAssemble writes no row for any of them.
   The splice's own case, built on purpose. */
  netTankRing(){
    return {name:"three fixed tanks in a ring - every edge has two fixed ends",
      build(R){
        src(R, "tkA", 8, 6, 16.0);
        src(R, "tkB", 26, 6, 12.0);
        src(R, "tkC", 17, 22, 8.0);
        joinH(R, "tkA", "tkB");
        R.run(R.port("tkB", 0, box("tkB").h), R.port("tkC", box("tkC").w, 0), false);
        R.run(R.port("tkA", 0, box("tkA").h), R.port("tkC", -1, 0), false);
        return done(R, {note:"16, 12 and 8 MPa behind the three of them"});
      },
      cols(){ return Object.assign(NETCOLS(),
        {aQ:colTankQ("tkA"), bQ:colTankQ("tkB"), cQ:colTankQ("tkC")}); }};
  },

/* ── 14. A STEAM RUN AND A WATER RUN ON ONE NODE ──
   THE SEAM B3 IS ABOUT. A run's LAW is read off its KIND (RUN_VAPOUR), and a
   kind is a pure function of the pair of ROLES at its two ends - so the same
   pair can never give one steam run and one water run. What a plant CAN do is
   land both on one node: the generator's steam nozzle carries a steam run to
   the turbine and a plain user run from a tank, and that node is then not a
   steam space by the all-edges-vapour rule while the steam edge beside it
   still carries g exactly 0 in this solve. */
  netSteamWater(){
    let sgId = null;
    return {name:"a steam run and a water run onto the same node",
      build(R){
        const sg = sgId = R.machine("sg", 12, 16), tb = R.machine("turb", 26, 8);
        src(R, "tkA", 6, 6, 8.0);
        // the turbine takes a nozzle on its TOP face and its bottom, and
        // nowhere else (ROLE.turb.ports) - a steam machine is entered from
        // above, and the drawing says so
        R.run(R.port(sg, 0, -1), R.port(tb, 0, -1), false);
        R.run(R.port("tkA", 0, box("tkA").h), R.port(sg, 2, -1), false);
        return done(R, {note:"both land on "+sg+"t"});
      },
      cols(){ return Object.assign(NETCOLS(),
        {sgtP:colNodeP(sgId+"t"), sgtT:colNodeT(sgId+"t"), tkQ:colTankQ("tkA")}); }};
  },

/* ── 15. THE ISOTHERMAL RING - THE STATIC HEAD'S OWN TOLERANCE ──
   A3 gave up the piezometric datum and with it the guarantee that an
   isothermal loop's static heads sum to exactly 0.0. staticH() is rho_bar*g*dz
   at each edge's OWN two densities now, so a ring at one temperature closes
   only as well as the density field does: pressure rises down the column,
   density rises with it, and the two vertical legs no longer cancel term for
   term. What is left over is a manufactured thermosiphon, and this is where it
   is read. Twelve metres of column, four runs, no pump, no boundary and
   nothing hot - maxQ is the whole of the circulation the field invented.
   TOLERANCE: 1e-3 kg/s. A gram a second against the stock loop's 7572 kg/s is
   the field's own rounding; anything above it is a current nothing drives.
   MEASURED 4e-6 kg/s, steady from the first tick. */
  netRing(){
    let top = null, bot = null;
    return {name:"a twelve metre isothermal ring - the circulation the density field invents",
      build(R){
        /* NO TWO EDGES ALIKE. A rectangle is the one shape that passes this
           test for free: its two vertical legs span the same dz between the
           same pair of densities, so they cancel term for term and the reading
           is a symmetry rather than a property. Every corner is on its own row,
           so all four runs carry a column and no two carry the same one. */
        const a = top = R.fit(14, 4, "tee", "RING A"), b = R.fit(30, 10, "tee", "RING B"),
              c = R.fit(30, 30, "tee", "RING C"), d = bot = R.fit(14, 24, "tee", "RING D"),
              m = R.fit(22, 4, "tee", "RING M");
        joinH(R, a, m); joinH(R, m, b); joinV(R, b, c); joinH(R, d, c); joinV(R, a, d);
        /* AND IT HAS TO BE LIQUID. A ring with no boundary floats onto P.Pcont,
           and 560 K at 0.15 MPa is superheated steam - a compressible column
           whose two legs genuinely do not cancel, which is real physics and not
           the property this profile is about. One hold tank puts the ring at a
           pressurised plant's own level, where the fluid is water. */
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
