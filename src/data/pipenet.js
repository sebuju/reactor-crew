"use strict";
/* the primary pipe network as a conductance graph - see .claude/CLAUDE.md and
   src/sim/net.js. netFlowK() (bottom of this file) is what feeds pumpK in
   step(); loopFlowK(), the capacity-counting formula it replaced, is gone. */

// Fitted once, for a RATIO - what a metre of pipe costs against a valve or a
// pump - never for a magnitude: netFlowK() only ever hands a caller a flow
// judged against its own reference, and that ratio is provably independent
// of PIPE_K (see the auditor block THE NETWORK IS PIPE_K-INVARIANT...).
// `let`, not `const`: the auditor sweeps it through setPipeK() to prove
// exactly that.
let PIPE_K = 0.006;
// bore of each primary line relative to a full-bore hot/cold leg; resistance
// scales as 1/bore^2, so a narrow branch (HPI, relief) chokes itself down
// without needing a PIPE_K of its own. relief is every relief fitting's own
// bore AND the reference bore PORV_INV/PORV_DP are rated against - see
// reliefG()/ventRefG() below.
const PIPE_BORE = {hot:1, cold:1, surge:.30, hpi:.25, xtie:.55, relief:.20};

// A pump's own head, before loopPumpCap() scales it. Consumed only as a
// ratio against a reference built the same way, so its absolute value is
// arbitrary - 1 is the simplest number that is not 0.
const PUMP_H0 = 1;

// The path THROUGH a component's own body (sg tubes, pump casing) - priced
// as a short length of full-bore pipe, not a bare resistance, so it scales
// with PIPE_K exactly like every real run does. A resistance that did not
// share PIPE_K's scale would stop the whole graph being homogeneous in it,
// and a flow ratio would then depend on PIPE_K instead of cancelling it -
// see THE NETWORK IS PIPE_K-INVARIANT... in the auditor, which sweeps
// PIPE_K three orders of magnitude specifically to catch that.
const NET_COMP_LEN = 0.1;   // metres-equivalent, short against a real run

function setPipeK(v){ PIPE_K = v; }

// floored at NET_COMP_LEN rather than L itself: a degenerate zero-length run
// (two ports that landed on the same point) still needs a real, PIPE_K-
// scaled resistance, or it would reintroduce exactly the fixed, non-scaling
// term this stage is written to avoid. Module-level, not local to netBuild():
// FIT's own g() functions need it too, evaluated live off a length that can
// include a valve's equivalent length as well as a run's real one.
const resist = (bore, L) => (bore*bore)/(PIPE_K*Math.max(L,NET_COMP_LEN));

// A valve's own resistance, expressed as an EQUIVALENT LENGTH added to
// whatever run it sits on - never a multiplier on that run's conductance, or
// the same valve would cost more on a long run than a short one. Wide open
// (x>=1) this is exactly 0, so a run with a wide valve on it is bit-for-bit
// the same edge as a run with none - nothing has to be re-pinned the day a
// throttle is placed on a stock leg and left alone. VALVE_XMIN floors the
// denominator rather than letting x reach 0 here; x<=0 is handled by the
// caller omitting the edge outright (see FIT.throttle and netBuild()'s
// pushSeg), the same way a shut tee already is - a removed edge, not a huge
// one. Neither constant is fitted against a measured valve; nothing in the
// documented behaviour depends on either, because every existing design has
// no fittings at all and so never calls this.
const VALVE_LEQ=2, VALVE_XMIN=0.05;
const valveLeq = x => x>=1 ? 0 : VALVE_LEQ*(1/Math.max(x,VALVE_XMIN)**2 - 1);

// series resistance for a run of length L carrying zero or more throttles by
// id, in series - shared by a branch edge (always exactly one id) and an
// in-line run segment (zero or more, folded straight into the pipe it sits
// on) so the "wide open costs nothing, shut removes the edge" rule is
// written once. Any one throttle at x<=0 cuts the whole edge, same as a
// shut tee: a valve is a real break in the pipe, not a small leak.
const throttled = (s, bore, L, ids) => {
  let Ltot = L;
  for(const fid of ids){
    const x = s.valve && s.valve[fid];
    if(!(x>0)) return 0;
    Ltot += valveLeq(x);
  }
  return resist(bore, Ltot);
};

// A pipe hit (combatHit(), step.js) is a rupture, not a throttle: modelled as
// ADDITIVE equivalent length on the SAME resist() every other run already
// uses, never a multiplier on g - a multiplier could turn one bug into a
// negative conductance and an indefinite Laplacian; additive resistance
// cannot represent one. It is a SEVERANCE, not a partial restriction - every
// other row in DMGFX (step.js) is a binary hit/fix state, not a graduated
// one, and a pipe hit follows the same idiom rather than inventing a
// magnitude nothing else in the game has. The added length is Infinity,
// which resist() carries straight through to an exact 0 (finite/Infinity is
// 0, never NaN), so a severed run lands on the identical g<=0 path
// netAssemble already omits a shut valve through - no second mechanism, no
// new physics path. Reads s.dmgParts directly rather than a field of its
// own: "pipe:"+key is exactly the id combatHit() pushes there, so DMGFX's
// existing prefix match (step.js) is what hits and fixes it, and no new S
// field is needed for the cloner to already know about.
const pipeExtraLen = (s, key) =>
  (key && s.dmgParts && s.dmgParts.indexOf("pipe:"+key) >= 0) ? Infinity : 0;

/* ══════════ FIT: one row per fitting BEHAVIOUR ══════════
   Same idiom as LAYERS (render/layers.js), DMGFX and AUTOSYS (sim/step.js):
   one table, one row per mode, adding a mode is adding a row. `branch` says
   whether the mode NEEDS a second tap (tee always does; a throttle may sit
   in-line instead - see addFit(), layout.js). `g(s,id,bore,len)` prices the
   fitting's own edge in the same units resist() already uses, so a branch
   built off this table costs a plain resist(bore,len) call either way -
   only which one, and whether it is gated by a boolean or a live position,
   differs by mode. check is a later stage; this table is why adding one is
   adding a row instead of a second netBuild().

   relief is a VENT, not a valve on the circuit: one end is off the loop
   entirely, so mass leaves rather than redistributes, and the circulation
   solve is incompressible - it has no row for a node that stores mass. g is
   therefore a constant 0, always, whatever S carries: never a row of the
   Laplacian, exactly like a shut tee, but unconditionally so rather than by
   S.juncOpen. Its own conductance still prices its own branch pipe (reliefG,
   below) for the vent physics in step.js, which reads it directly and never
   through netAssemble/netFlows - the two never touch. */
const FIT = {
  tee:{
    branch:true,
    g:(s,id,bore,len)=>(s.juncOpen && s.juncOpen[id]) ? resist(bore,len) : 0,
  },
  throttle:{
    branch:"optional",
    g:(s,id,bore,len)=>throttled(s,bore,len,[id]),
  },
  relief:{
    branch:true,
    g:()=>0,
  },
};

/* PORV_INV/PORV_DP (step.js) stop being the plant's own flat vent rate and
   become the rated %/s and MPa/s of ONE FULLY OPEN relief edge of REFERENCE
   bore and length - every fitting's own ventK() (below) is its own
   conductance judged against this one reference, same shape as netFlowK
   against P.netRef. RELIEF_REF_LEN is fitted once, the same idiom as RAD_K
   (rad.js): chosen so the STOCK relief fitting - reference bore, its own
   routed branch length as placed in buildLayout() - computes to exactly
   this reference, so ventK()===1 there and a stock design vents at exactly
   today's rate. Change the stock tap or tank position and re-derive it
   (measure reliefG() on the stock fitting headless) rather than picking a
   rounder number.
   Flat in Q on purpose, not sqrt((s.P-P.Pcont)/(P.P0-P.Pcont)): that reads
   about 1.03 at the 106% lift point, not 1.00, so adding it would move
   every PORV figure this stage exists to hold still. Pressure-dependent
   flow is its own change, with its own re-pin. */
const RELIEF_REF_LEN = 2.8;
const ventRefG = () => resist(PIPE_BORE.relief, RELIEF_REF_LEN);

// A relief fitting's own conductance, off its own routed branch pipe - never
// through the network solve (FIT.relief.g is always 0, above) but priced
// the identical way any other branch prices its resistance, so a longer
// relief run vents slower and a severed one (pipeExtraLen) vents not at
// all, the same idiom a severed hot or cold leg already uses. 0 for a
// fitting whose branch never routed (its tap's part is gone) - the same
// "not there" every other reader of a missing run already falls back to.
function reliefG(s, fid){
  const r = P.net && P.net.byKey["xtie:"+fid];
  if(!r) return 0;
  return resist(PIPE_BORE.relief, plen(r.pts) + pipeExtraLen(s, r.key));
}

// This fitting's vent rate as a fraction of the reference relief valve's -
// PORV_INV*ventK and PORV_DP*ventK (step.js) are what actually charge
// s.inv/s.P. Against P.ventRef (commission(), step.js), computed once per
// commission rather than re-derived every call, the same shape P.netRef
// already uses. Guarded exactly like netFlowK(): a solver bug must read as
// an inert vent, never as a NaN loose in s.P or s.inv (see the auditor's
// own "a vent never produces NaN").
function ventK(s, fid){
  const k = reliefG(s, fid) / P.ventRef;
  return isFinite(k) && k>=0 ? k : 0;
}

// pipeNetwork() keys a routed run "kind:aIdSide-bIdSide" (see layout.js's
// link()). Node identity in this graph IS that "partId+side" string
// verbatim, so splitting the key on its one '-' hands back the two node ids
// directly - no second naming scheme to invent or keep in sync. null for a
// run with no second half (surge, which drops onto another run's pipe
// rather than terminating at a port of its own).
function runEnds(key, kind){
  const rest = key.slice(kind.length + 1);
  const i = rest.indexOf("-");
  return i < 0 ? null : [rest.slice(0, i), rest.slice(i + 1)];
}

// core"r" and core"b" are the SAME node: today's lumped model has one core
// plenum, r_core=0, and that identity is what makes the no-junction sweep
// in the auditor exact - every loop becomes an independent ground-to-ground
// path with nothing else to disagree about.
const coreFold = raw => (raw === "corer" || raw === "coreb") ? "core" : raw;

/* Builds the compiled graph once per commission. Topology only - every edge
   but a fitting's own is still a plain number, so most of the matrix is
   fixed the moment this returns; a fitting's g is a function of live
   S.juncOpen or S.valve (see the branch loop below, and pushSeg above for an
   in-line throttle), which is exactly why netFactored() below has to key
   its cache on more than just this object. */
function netBuild(){
  const net = pipeNetwork();
  const byKey = {};
  for(const r of net) byKey[r.key] = r;

  const nodes = [], index = {};
  const nodeIdx = nid => { if(!(nid in index)){ index[nid] = nodes.length; nodes.push(nid); } return index[nid]; };
  const ground = nodeIdx("core");

  const edges = [];

  // fitting taps, gathered before any run's edges are built so that pass can
  // already see where to split. Only a fid+side pair names a tap node - never
  // a pixel or a fraction - so two fittings tapping the same run at different
  // points never collide. A BRANCH fitting (bKey set - every tee, and a
  // throttle wired between two runs) taps both ends, exactly the way a
  // junction always did; an IN-LINE fitting (bKey null - only a throttle can
  // be one) taps just the one run it sits on, gets no node of its own, and is
  // folded straight into that run's own edge instead (pushSeg, below) - it
  // has no route to draw, so there is no "xtie:"+id run to look up for it. A
  // fitting whose host run kind isn't one this graph builds edges for (steam,
  // feed - not modeled here yet) still gets registered; tapEndpoint() and
  // pushSeg below just never have an edge-building pass consume it, so it
  // falls back to the pre-split nearer-end pick (branch) or is simply inert
  // (in-line), no coarser than before for a kind this stage still doesn't
  // carry flow on.
  const tapNode = (fid, side) => "tap:" + fid + ":" + side;
  const branches = [], inlineByRun = {}, fitIds = [], fitMode = {};
  for(const fid in D.fit){
    const j = D.fit[fid];
    const hostA = byKey[j.aKey];
    if(!hostA) continue;                // a tapped run's part was removed
    if(!j.bKey){                        // in-line: one tap, no route of its own
      (inlineByRun[hostA.key] || (inlineByRun[hostA.key] = [])).push({fid, t: clamp(j.aT, 0, 1)});
      fitIds.push(fid); fitMode[fid] = j.mode;
      continue;
    }
    const r = byKey["xtie:" + fid];
    if(!r) continue;                    // the branch itself was never routed
    const hostB = byKey[j.bKey];
    if(!hostB) continue;                // a tapped run's part was removed
    const endsA = runEnds(hostA.key, hostA.k), endsB = runEnds(hostB.key, hostB.k);
    if(!endsA || !endsB) continue;
    branches.push({fid, j, r, hostA, hostB, endsA, endsB});
    fitIds.push(fid); fitMode[fid] = j.mode;
  }
  const tapsByRun = {};
  for(const {fid, j, hostA, hostB} of branches){
    (tapsByRun[hostA.key] || (tapsByRun[hostA.key] = [])).push({t: clamp(j.aT, 0, 1), node: tapNode(fid, "a")});
    (tapsByRun[hostB.key] || (tapsByRun[hostB.key] = [])).push({t: clamp(j.bT, 0, 1), node: tapNode(fid, "b")});
  }

  // primary runs: hot, cold, hpi all terminate at real component ports, so
  // runEnds() hands back both nodes directly. A run with no branch taps on it
  // keeps the single edge exactly as before (this is what the no-fitting
  // sweep in the auditor pins bit-for-bit) unless an in-line throttle sits on
  // it, in which case that one edge's g becomes a function of the throttle's
  // live position instead of a plain number - see pushSeg. A branch-tapped
  // run instead becomes a chain of series edges, one per tap sorted along the
  // run plus one to the far end - electrically the same run, just able to
  // disagree with itself about pressure at the point a branch actually
  // leaves it; any in-line throttle whose own t falls inside one of those
  // segments folds into THAT segment's edge, in series with the pipe either
  // side of it. resist()'s existing NET_COMP_LEN floor is what stops a
  // degenerate sliver (two taps landing on the same t, or one sitting at
  // exactly 0 or 1) from pricing out as a zero-resistance short - the same
  // floor a same-point run already relies on.
  for(const r of net){
    if(r.k !== "hot" && r.k !== "cold" && r.k !== "hpi") continue;
    const ends = runEnds(r.key, r.k);
    if(!ends) continue;
    const u = nodeIdx(coreFold(ends[0])), v = nodeIdx(coreFold(ends[1]));
    const bore = PIPE_BORE[r.k], L = plen(r.pts), taps = tapsByRun[r.key], inl = inlineByRun[r.key];
    const pushSeg = (a, b, t0, t1, last) => {
      const segL = L*(t1-t0);
      const ids = inl ? inl.filter(o => o.t>=t0 && (last ? o.t<=t1 : o.t<t1)).map(o=>o.fid) : [];
      /* Combat damage lands on the run's own LAST segment only, never every
         segment a tap happened to split it into: series resistance sums the
         same wherever it sits (pipeExtraLen's own comment), so this is the
         "last one written wins" rule netCoreFracOf's byRun already uses, not
         a second convention to keep in sync. Always routed through
         throttled(), even with an empty ids list, so an ordinary undamaged
         run stays bit-identical (throttled with no ids and 0 extra length is
         exactly resist(bore,segL)) while still being LIVE against a hit that
         has not happened yet. */
      if(!last){
        if(!ids.length){ edges.push({u:a, v:b, g: resist(bore, segL), h: 0, kind: r.k, key: r.key}); return; }
        edges.push({u:a, v:b, g: s => throttled(s, bore, segL, ids), h: 0, kind: r.k, key: r.key});
        return;
      }
      edges.push({u:a, v:b, g: s => throttled(s, bore, segL + pipeExtraLen(s, r.key), ids), h: 0, kind: r.k, key: r.key});
    };
    if(!taps || !taps.length){
      pushSeg(u, v, 0, 1, true);
      continue;
    }
    const sorted = taps.slice().sort((a, b) => a.t - b.t);
    let prev = u, prevT = 0;
    for(const tp of sorted){
      const node = nodeIdx(tp.node);
      pushSeg(prev, node, prevT, tp.t, false);
      prev = node; prevT = tp.t;
    }
    pushSeg(prev, v, prevT, 1, true);
  }

  // surge: a dead-end off the pressurizer that carries no head this stage. Its
  // one edge has no source and its far node touches nothing else, so KCL pins
  // that node to the surge node's own potential and the edge carries exactly
  // zero flow - tied to ground or tied to the real point it lands on the hot
  // leg, the answer is identical, because neither choice can move current.
  // Resolving it onto that real point (the same tap-splitting machinery just
  // built above, keyed off where its own routed pts end) is possible - the
  // landing point IS on the loop-0 hot leg's own polyline by construction -
  // but NOT free: pzr is never absent from the stock layout, so splitting hot
  // leg 0 to host it would touch that run's resistance on every commission,
  // including every no-damage, no-junction case the auditor pins netFlowK to
  // exactly 1 on. Splitting a resistor in two and solving through the graph
  // is electrically the same value but not the same float, so that sweep
  // would start failing for a change with zero effect on any flow. Left
  // tied to ground until surge carries a real head and moving it stops
  // being free.
  const pzr = LAY.parts.find(p => p.id === "pzr");
  if(pzr){
    const r = byKey["surge:" + pzr.id + "b"];
    if(r) edges.push({u: nodeIdx(pzr.id + "b"), v: ground,
      g: resist(PIPE_BORE.surge, plen(r.pts)), h: 0, kind: "surge", key: r.key});
  }

  // internal component paths: continuity through a component a run merely
  // passes THROUGH. The pump is where head enters the loop - h is a
  // FUNCTION of s so a damaged pump's contribution tracks s.dmgParts live,
  // never baked in at build time. s.capScale, if the caller set one, is a
  // per-loop head multiplier - netCoreFrac0 (below) is the only caller that
  // does, to clamp a spare-loaded loop's OWN reference at its bore rather
  // than at whatever capacity happens to be installed. Live ticks never set
  // it (capScale defaults to 1): a solve can legitimately draw MORE than
  // capacity bookkeeping predicts once a junction is open (see netFlowK's
  // own comment), so the live solve always runs on raw, un-throttled head
  // and is judged against that clamped reference afterward instead.
  for(const p of LAY.parts){
    if(p.id.startsWith("sg"))
      edges.push({u: nodeIdx(p.id+"l"), v: nodeIdx(p.id+"b"), g: resist(1,NET_COMP_LEN), h: 0, kind: "comp", key: "comp:"+p.id});
    const m = /^pump(\d+)$/.exec(p.id);
    if(m){
      const i = +m[1];
      edges.push({u: nodeIdx(p.id+"t"), v: nodeIdx(p.id+"b"), g: resist(1,NET_COMP_LEN),
        h: s => PUMP_H0 * loopPumpCap(i, s.dmgParts) * (s.capScale ? (s.capScale[i]??1) : 1),
        kind: "pump", key: "comp:"+p.id});
    }
  }

  // branch fittings: lands on the real tap node the host run's own edge-
  // building pass above split out for it, so moving aT/bT along a run
  // changes the network exactly like moving a real tee would. A host kind
  // that pass doesn't build edges for (steam, feed) has no split node to
  // hand back - tapEndpoint() falls through to the old nearer-end pick for
  // exactly that side, same as every junction did before this stage.
  const tapEndpoint = (host, ends, t, fid, side) =>
    (host.k === "hot" || host.k === "cold" || host.k === "hpi")
      ? nodeIdx(tapNode(fid, side))
      : nodeIdx(coreFold(t < 0.5 ? ends[0] : ends[1]));
  // g comes off FIT[mode] - a tee's is a boolean gate on S.juncOpen, a
  // throttle's a live position on S.valve, but both hand back either a
  // removed edge (g<=0, netAssemble skips it entirely - "shut"/"never
  // placed"/"fully closed" all land on the same, bit-identical matrix) or a
  // plain resist(bore,len) call. g is a function of s (never the plain
  // number every other edge in this stage still is) because the fitting is
  // worked live, every tick; fid is looked up by closure, not hoisted, so
  // each fitting's own edge reads its own id even though this loop shares
  // one tapEndpoint() across all of them.
  for(const {fid, j, r, hostA, hostB, endsA, endsB} of branches){
    const u = tapEndpoint(hostA, endsA, j.aT, fid, "a");
    const v = tapEndpoint(hostB, endsB, j.bT, fid, "b");
    const bore = PIPE_BORE.xtie, len = plen(r.pts), mode = j.mode;
    // pipe damage on a branch fitting's own run adds the same equivalent
    // length before FIT[mode].g ever sees it - a severed cross-tie is shut
    // whatever S.juncOpen/S.valve say, exactly as a severed hot/cold leg is
    // shut whatever throttle sits on it (pushSeg, above).
    edges.push({u, v, g: s => FIT[mode].g(s, fid, bore, len + pipeExtraLen(s, r.key)), h: 0, kind: r.k, key: r.key});
  }

  return {nodes, index, edges, ground, n: nodes.length, byKey, fitIds, fitMode};
}

/* Factors A once per DISTINCT combination of fitting state and caches it
   there. The cache key is a signature of every fitting's live state, not the
   net instance alone: since Stage 2 a branch's own edge is gated on live
   S.juncOpen, and since Stage 3a an in-line or branch throttle's edge is a
   live function of S.valve too (see netBuild()), so A itself can change tick
   to tick, and a factorisation left over from before a fitting moved would
   be a silent wrong answer, not a crash - the signature is checked on every
   call rather than trusted once. A throttle's position is continuous, so its
   own term is the exact value rather than a '0'/'1' flag: ANY change to it
   has to bust the cache, not just crossing some open/shut line. dmgParts
   never enters A (only a pump's head b does), so it plays no part in the
   signature. */
function netFactored(net, s){
  const sig = net.fitIds.map(fid => net.fitMode[fid]==="tee"
    ? ((s.juncOpen && s.juncOpen[fid]) ? '1' : '0')
    : String(s.valve && s.valve[fid])
  ).join('|')
  /* pipe damage is a third live input the edges above read (beside
     S.juncOpen and S.valve) - leave it out of the signature and a hit or a
     repair reuses last tick's factorisation, solving the network as though
     the pipe on the grid were still the one it was before: a wrong answer,
     not a crash, so it is checked every call exactly like the other two. */
  + '|' + (s.dmgParts ? s.dmgParts.filter(k => k.indexOf("pipe:")===0).join(',') : '');
  if(!net.Af || net.AfSig !== sig){
    const A = new Float64Array(net.n*net.n);
    netAssemble(net.edges, net.n, net.ground, s, A, new Float64Array(net.n));
    net.Af = netFactor(A, net.n);
    net.AfSig = sig;
  }
  return net.Af;
}

/* Assembles a fresh b for THIS s (cheap, O(n^2)), then substitutes against
   the cached factorization (also O(n^2)) - the O(n^3) elimination happens at
   most once per open-junction combination. Returns the total flow arriving
   at the core inlet: the magnitude of flow on every "cold" edge that touches
   ground, summed once each - "hot" edges touching ground are the same
   loop's flow leaving the core, not a second contribution, so counting them
   too would double it. byLoop, if given, is filled in place with the same
   sum bucketed by loopOfKey(edge.key) instead of pooled - netFlowK's
   per-connected-group ceiling (below) needs a loop's own raw flow, in its
   own physical units, never averaged flat across loops of different length.
   byRun, if given, is filled in place too, keyed by EVERY edge's own run key
   rather than pooled or bucketed by loop - the per-run flow animation in
   step() needs a run's own share, not the loop-wide or plant-wide total. A
   run split into series segments (a tap sits on it) shares one key across
   several edges; the LAST one written wins, which is the most-downstream
   segment - the one a throttle between it and the core has already acted
   on, so that is the number the animation should show. */
function netCoreFracOf(net, s, byLoop, byRun){
  const Af = netFactored(net, s);
  const b = new Float64Array(net.n);
  netAssemble(net.edges, net.n, net.ground, s, new Float64Array(net.n*net.n), b);
  netSubst(Af, b, net.n);
  const q = new Float64Array(net.edges.length);
  netFlows(net.edges, b, net.ground, q, s);
  let core = 0;
  for(let e=0;e<net.edges.length;e++){
    const ed = net.edges[e];
    if(byRun && ed.key) byRun[ed.key] = Math.abs(q[e]);
    if(ed.kind === "cold" && (ed.u === net.ground || ed.v === net.ground)){
      const qe = Math.abs(q[e]);
      core += qe;
      if(byLoop){ const i = loopOfKey(ed.key); if(i!=null) byLoop[i] = (byLoop[i]||0) + qe; }
    }
  }
  return core;
}

// No damage, every fitting exactly as commissioned - a branch (S.juncOpen
// starts every id false in resetPlant(); an in-line throttle starts at 1,
// wide open) - and every loop's OWN head clamped at 1.0 (capScale)
// regardless of what is actually installed on it. That clamp is the one
// thing this reference must NOT inherit from the live plant: a spare pump
// must not be able to inflate the 100% mark it will later be judged
// against, or it would buy the plant nothing the day it is actually needed
// (see netFlowK's own comment) - loopFlowK() never let an isolated loop's
// own capacity count for more than 1 either, spare or no spare. A loop
// built SMALLER than default (up<1) is not bumped up to 1 - that pump's own
// undersized reference is real and the plant's 100% mark is honestly lower
// for it, exactly as loopFlowK()'s min(1,up) always was.
// This is the one place the as-commissioned throttle defaults are asserted
// rather than read off S: an in-line throttle omitted here would read
// s.valve as undefined, the g() gate would treat that exactly like fully
// shut, and every hot/cold reference on that run would collapse to zero -
// wrong, because the live plant commissions that same valve wide open.
// Taken on the net just built, not P.net, because commission() calls this
// before P.net is necessarily the last thing it assigned. byLoop/byRun, if
// given, are filled the same way netCoreFracOf fills them - this is
// P.netRefByLoop's and P.netRefByRun's own producer.
const netCoreFrac0 = (net, byLoop, byRun) => {
  const s = {dmgParts:[], capScale:{}, valve:{}};
  for(const fid of net.fitIds) if(net.fitMode[fid]==="throttle")
    s.valve[fid] = P.fit[fid].bKey ? 0 : 1;
  for(let i=0;i<P.loops;i++){
    const up = loopPumpCap(i, []);
    s.capScale[i] = up>1 ? 1/up : 1;
  }
  return netCoreFracOf(net, s, byLoop, byRun);
};

/* The one seam a caller actually uses - wired into step() in place of
   loopFlowK(), which is gone.

   The live solve is run with RAW, un-throttled heads - loopPumpCap()
   straight, however much spare capacity that is - because a linear network
   can legitimately draw MORE current through a group than pure capacity
   bookkeeping predicts: opening a junction lowers a group's effective
   resistance, so the same heads push more total flow than either loop would
   give alone. Only the solved answer can see that, so nothing is
   pre-clamped going into the live solve (contrast netCoreFrac0 above, which
   DOES pre-clamp, because every one of its groups is a guaranteed singleton
   and there is no redistribution to under-predict).

   loopFlowK()'s old min(groupSize, capacity) ceiling - a spare pump cannot
   deliver more than its own loops' bore, however much head is behind it -
   still has to be enforced, so it is applied to the live OUTPUT instead, per
   connected group (same flood-fill loopFlowK() used): a group's raw share
   is capped at (min(groupSize, capacity)/groupSize) of the group's own
   COMBINED reference (P.netRefByLoop, summed over the group) - a fraction OF
   that group's own physical magnitude, never a flat "1 unit per loop",
   because the loops are not the same length and a short loop's own share is
   a bigger absolute flow than a long loop's. This is why the ceiling is
   judged per group and not per loop: capping each loop separately against
   its own isolated reference would erase exactly the length-weighting the
   network exists to add back (see the auditor's own note on that), while
   capping the group's SUM leaves the solve's own split between the group's
   loops untouched and only bounds the total.

   Undamaged with nothing open, every group is a singleton with capacity at
   least 1, so the ceiling equals the group's own reference exactly and raw
   matches it exactly too (identical conditions to P.netRef) - the clamp is a
   no-op. Undamaged with everything open, the ceiling still equals the
   group's own reference sum exactly (capacity is still >= groupSize), and a
   solved network can only draw AS MUCH OR MORE current through more paths,
   never less, so the clamp instead becomes the answer, pinning the total to
   P.netRef exactly either way. That is what keeps this === 1 whenever
   nothing is hurt, junctions open or shut.

   A solver that quietly substituted a plausible-looking number on failure
   would be one nobody could debug, so the one guard against a NaN/negative
   bug lives here, once, on the single scalar every caller consumes - never
   inside the solver itself.

   byRun, if given, is filled by netCoreFracOf() with this tick's real
   per-run flow - step()'s pipe-animation block reads it back, keyed off the
   same run keys pipeNetwork() hands out, so a throttled leg visibly slows
   instead of every loop showing the one pooled number this used to be. */
function netFlowK(s, byRun){
  const n = P.loops, byLoop = {};
  netCoreFracOf(P.net, s, byLoop, byRun);
  const adj = Array.from({length:n}, () => []);
  for(const id in P.fit){
    const j = P.fit[id];
    if(!j.bKey) continue;                          // in-line: never joins two loops
    const live = j.mode==="tee" ? !!(s.juncOpen && s.juncOpen[id])
                                 : !!(s.valve && s.valve[id] > 0);
    if(!live) continue;
    const a = loopOfKey(j.aKey), b = loopOfKey(j.bKey);
    if(a!=null && b!=null && a!==b && a<n && b<n){ adj[a].push(b); adj[b].push(a); }
  }
  const seen = new Array(n).fill(false);
  let total = 0;
  for(let i=0;i<n;i++){
    if(seen[i]) continue;
    const stack=[i], group=[]; seen[i]=true;
    while(stack.length){ const u=stack.pop(); group.push(u);
      for(const v of adj[u]) if(!seen[v]){ seen[v]=true; stack.push(v); } }
    let raw=0, ref=0, up=0;
    for(const g of group){
      raw += byLoop[g]||0;
      ref += P.netRefByLoop[g]||0;
      up  += loopPumpCap(g, s.dmgParts);
    }
    const ceil = ref>0 ? (Math.min(group.length, up)/group.length) * ref : 0;
    total += Math.min(raw, ceil);
  }
  const k = total/P.netRef;
  return isFinite(k) && k>=0 ? k : 0;
}

/* ══════════ A RUN AS A HITTABLE TARGET, AND A PLACE TO STAND ══════════
   A run is not a part - no LAY.parts entry, so nothing hands combatHit() or
   repairStart() (step.js) a p.x/p.y/p.w/p.h rectangle to reason about, or a
   p.name to log. These give both the same shape a part already has: an id
   ("pipe:"+the run's own key, so DMGFX's existing prefix match picks it up
   for free - see step.js), a name, a footprint size for repairNeed(), and an
   access flag built from the SAME freeAdj() (layout.js) ring test every
   component already uses, just unioned over every cell the run's own
   polyline crosses instead of one rectangle. */

// Which run keys actually carry conductance in the solved graph - only these
// have anything for a hit to take away. "comp" (a component's own internal
// path - sg tubes, pump casing) and "surge" (no source, no flow - see
// netBuild()'s own comment) are excluded on purpose: hitting comp:sg0 would
// just be a second way to hit the sg component itself, through a name the
// player never sees, and surge has nothing to sever.
function hittableRunKeys(net){
  const keys=[];
  for(const e of net.edges)
    if(e.key && (e.kind==="hot"||e.kind==="cold"||e.kind==="hpi"||(e.kind && e.kind.indexOf("xtie")===0))
       && keys.indexOf(e.key)<0) keys.push(e.key);
  return keys;
}

// The grid cells a routed polyline actually crosses, deduplicated - sampled
// every half cell so a long straight leg cannot skip the cell in the middle
// of it, the same risk plen() would run if it worked in cell units instead
// of pixels.
function pipeCells(pts){
  const out=[], seen={};
  const add=(gx,gy)=>{ if(gx<0||gy<0||gx>=GW||gy>=GH) return;
    const k=gx+","+gy; if(!seen[k]){ seen[k]=1; out.push([gx,gy]); } };
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1], b=pts[i], dx=b[0]-a[0], dy=b[1]-a[1];
    const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/(CELL/2)));
    for(let t=0;t<=steps;t++)
      add(Math.floor((a[0]+dx*t/steps-GX)/CELL), rowAt(a[1]+dy*t/steps));
  }
  if(!out.length && pts.length) add(Math.floor((pts[0][0]-GX)/CELL), rowAt(pts[0][1]));
  return out;
}

// freeAdj() (layout.js) run per crossed cell and unioned, minus any cell
// that is itself part of the run - standing "on" a leak is not standing
// "beside" it, the same distinction freeAdj() already draws between a
// part's own footprint and its ring.
function pipeStandCells(cells){
  const g=occupied(null), on={}, seen={}, out=[];
  for(const [x,y] of cells) on[x+","+y]=1;
  for(const [x,y] of cells) for(const c of freeAdj({x,y,w:1,h:1},g)){
    const k=c[0]+","+c[1];
    if(on[k]||seen[k]) continue;
    seen[k]=1; out.push(c);
  }
  return out;
}

function pipeName(r){
  const loop=loopOfKey(r.key);
  const kind = r.k.indexOf("xtie")===0 ? "CROSS-TIE" : r.k.toUpperCase()+" LEG";
  return kind + (loop!=null ? " "+(loop+1) : "");
}

// The pseudo-part combatHit()/repairStart() (step.js) consume in place of a
// LAY.parts entry - same shape (id, name, w, h, access) so repairNeed() and
// the DMGFX log line need no second code path for a run. isRun tells
// combatHit()'s weighted pick which scoring rule applies (runWgt() below,
// never the part rule) without duck-typing on which fields happen to exist.
function pipePart(key){
  const r = P.net.byKey[key];
  if(!r) return null;
  const cells = pipeCells(r.pts), stand = pipeStandCells(cells);
  return {id:"pipe:"+key, name:pipeName(r), w:cells.length, h:1,
          access: stand.length>0, cells, stand, isRun:true};
}

/* Anything s.dmgParts can hold, resolved to the one shape the repair path
   reads: id, name, access. A run is not in LAY.parts, so every caller that
   looked a damage id up directly got `undefined` for a pipe and quietly
   rendered it as a raw id that could never be reached - which is how the
   damage card came to promise NO ACCESS for a pipe a party was standing
   next to. Three readers (the dispatcher, the dose rate, the damage card),
   one resolver. */
function dmgPart(id){
  return (typeof id==="string" && id.indexOf("pipe:")===0)
    ? (P.net && P.net.byKey[id.slice(5)] ? pipePart(id.slice(5)) : null)
    : (LAY.parts.find(q=>q.id===id) || null);
}

// The two rates combatHit() (step.js) already weighs a component's own hull
// cells by - a run gets no separate scale to fit, just this shared table.
const HITW_BASE=0.15, HITW_HULL=1.6;

// A run's own odds of being the thing an unaimed hit finds. The difference
// from a part's own weight (step.js) is what the flat term multiplies: a
// component pays HITW_BASE once per PART regardless of its footprint, but a
// run's own length is the whole point of "give more pipe for a hit to find"
// (design-bench.js) - so here it is paid once per CELL of pipe instead. A
// long run really does cross more of the room a stray round can land in;
// the hull bonus is unchanged, paid at the same rate per hull-ring cell.
function runWgt(cells){
  let w=0;
  for(const [x,y] of cells)
    w += HITW_BASE + (x===0||x===GW-1||y===0||y===GH-1 ? HITW_HULL : 0);
  return w;
}

/* THE STOCK RELIEF PATH. Seeded once, at load, the same way every other
   as-commissioned default lives in D itself (design.js) rather than behind
   a menu action nobody has to run - a fresh design already has a relief
   valve venting to the tank below the pressurizer, and deleting it is the
   player's own choice (see the "no relief path fitted" warning, design.js).
   aT=0.9 is not arbitrary: it is the shortest tap the stock hot leg offers
   onto the tank at (6,0) (buildLayout()) - measured by sweeping every tenth
   of the run headless, so the stock branch pipe costs as little of the
   inertia/mass this stage was written to charge for as the geometry allows,
   never more than the fitting itself is worth. bKey taps the RELIEF HEADER
   (pipeNetwork(), layout.js), which exists precisely because this fitting
   does (hasRelief(), layout.js). */
addFit('relief','hot:corer-sg0l',0.9,'relief:pzrt-reltkb',0.5,PIPE_BORE.relief);

