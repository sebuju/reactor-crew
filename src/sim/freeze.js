"use strict";

/* The commission-frozen tables the Rust engine reads (`sim_freeze`): one writer, shared by the page and
   tools/step-gate.js. Wire: little-endian u8/u16/u32/i32/f64, strings u32-length-prefixed UTF-8. */

const FREEZE = (() => {
  const MAGIC = "RCFZ", VERSION = 1;

  function writer(){
    let buf = new Uint8Array(1 << 16), dv = new DataView(buf.buffer), o = 0;
    const enc = new TextEncoder();
    const room = k => {
      if(o + k <= buf.length) return;
      let n = buf.length * 2;
      while(n < o + k) n *= 2;
      const nb = new Uint8Array(n); nb.set(buf.subarray(0, o));
      buf = nb; dv = new DataView(buf.buffer);
    };
    const w = {
      u8: v => { room(1); buf[o++] = v & 0xFF; },
      u16: v => { room(2); dv.setUint16(o, v, true); o += 2; },
      u32: v => { room(4); dv.setUint32(o, v >>> 0, true); o += 4; },
      i32: v => { room(4); dv.setInt32(o, v | 0, true); o += 4; },
      f64: v => { room(8); dv.setFloat64(o, v, true); o += 8; },
      str: s => { const b = enc.encode(String(s)); w.u32(b.length); room(b.length); buf.set(b, o); o += b.length; },
      bytes: () => buf.slice(0, o),
    };
    return w;
  }

  const num = v => (v === undefined || v === null) ? NaN : +v;
  const has = v => v !== undefined && v !== null;
  const strs = (w, a) => { w.u32(a.length); for(const s of a) w.str(s); };
  const f64s = (w, a) => { w.u32(a.length); for(const v of a) w.f64(num(v)); };
  const u32s = (w, a) => { w.u32(a.length); for(const v of a) w.u32(v); };
  const i32s = (w, a) => { w.u32(a.length); for(const v of a) w.i32(v); };
  const u8s = (w, a) => { w.u32(a.length); for(const v of a) w.u8(v); };
  const optStr = (w, v) => { const ok = typeof v === "string"; w.u8(ok ? 1 : 0); if(ok) w.str(v); };
  const optNum = (w, v) => { const ok = has(v) && Number.isFinite(+v); w.u8(ok ? 1 : 0); if(ok) w.f64(+v); };
  const numMap = (w, o) => { const e = Object.entries(o || {}); w.u32(e.length); for(const [k, v] of e){ w.str(k); w.f64(num(v)); } };
  const strMap = (w, o) => { const e = Object.entries(o || {}).filter(([, v]) => typeof v === "string"); w.u32(e.length); for(const [k, v] of e){ w.str(k); w.str(v); } };
  const idxMap = (w, o, row) => { const e = Object.entries(o || {}).filter(([k]) => /^\d+$/.test(k)); w.u32(e.length); for(const [k, v] of e){ w.u32(+k); row(v); } };

  const fitAll = () => [...new Set((P.net.fitIds || []).concat(reliefSecIds()).concat(reliefPriIds())
    .concat(Object.keys((P && P.fittings) || D.fittings || {}))
    .concat(LAY.parts.filter(p => p.role === "fitting").map(p => p.id)))];

  function edgeFrozen(w){
    const net = P.net, edges = net.edges;
    const uniq = a => [...new Set(a.filter(has))];
    w.f64(P.steamRef || 0);
    w.f64(CASING_F); w.f64(PUMP_H0); w.f64(HEAD_K); w.f64(TANK_RHO);
    w.f64(num(P.turbC)); w.f64(num(P.swallow)); w.f64(num(P.bypass)); w.f64(num(P.rho0)); w.f64(P.rated || 0);
    const pumps = uniq(edges.map(ed => ed.pump));
    numMap(w, Object.fromEntries(pumps.map(pid => [pid, pumpHead(pid)])));
    numMap(w, P.pumpRho0);
    strMap(w, Object.fromEntries(pumps.map(pid => { const k = pumpCasingKeys(pid); return [pid, (k && k.suc) || null]; })));
    const turbs = uniq(edges.filter(ed => ed.Ck === 5).map(ed => ed.pid));
    numMap(w, Object.fromEntries(turbs.map(pid => { const c = secCircuitOf(pid); return [pid, (c.boiler ? 1 : 0) | (c.sink ? 2 : 0)]; })));
    const pools = uniq(edges.map(ed => ed.poolAt));
    numMap(w, Object.fromEntries(pools.map(i => { const p = net.poolPart ? net.poolPart[i] : partOf(net.name[i].slice(0, -1)); return [i, p ? p.h : null]; })));
    const vents = uniq(edges.filter(ed => ed.Ck === 10).map(ed => ed.pid));
    numMap(w, Object.fromEntries(vents.map(pid => [pid, circOfNode(condVesNode(pid))])));
    w.u32(vents.length); for(const pid of vents){ w.str(pid); w.u8(condVacuum(pid) ? 1 : 0); }
    w.f64(condSinks().length); strs(w, condSinks());
    w.f64(num(condPDes())); w.f64(num(sgBypBand())); w.f64(num(P.Tref));
    w.u32(24); for(let ci = 0; ci < 24; ci++){ w.i32(ci); w.f64(num(holdSetP(ci))); }
    const fitIds = net.fitIds || [];
    strs(w, fitIds);
    u8s(w, fitIds.map(fid => net.fitMode[fid] === "relief" ? 1 : 0));
    strs(w, tankIds().filter(id => net.tankNode[id] !== undefined));
    w.u32(edges.length);
    for(const ed of edges){
      w.i32(has(ed.Ck) ? ed.Ck : -1);
      optStr(w, ed.Cdead); optStr(w, ed.tid); optStr(w, ed.end); optStr(w, ed.freg); optStr(w, ed.pid);
      optNum(w, ed.cx); optNum(w, ed.cy);
      optStr(w, ed.pump);
      optNum(w, ed.poolAt);
      optStr(w, ed.gateMode);
      strs(w, (ed.gateIds || []).map(String));
      w.u8(typeof ed.hSrc === "function" ? 1 : 0);
      optNum(w, ed.I);
      optStr(w, ed.machine);
    }
  }

  function tailFrozen(w){
    const net = P.net;
    idxMap(w, net.contCell, xy => { w.i32(xy[0]); w.i32(xy[1]); });
    const pon = {};
    for(let i = 0; i < net.n; i++){ const p = net.partOfNode && net.partOfNode(net.name[i]); if(p) pon[i] = p.id; }
    idxMap(w, pon, id => w.str(id));
    u32s(w, net.secT || []); strs(w, net.secTParts || []);
    strs(w, net.condParts || []);
    idxMap(w, net.tankIdByNode || net.tankIdOf, id => w.str(id));
    const circs = holdCircs().filter(ci => nodeGraph().coreCircs[ci] === 1);
    w.u32(circs.length);
    for(const ci of circs){ const s = loopNodes(ci); w.i32(ci); w.u8(s ? 1 : 0); if(s) strs(w, [...s]); }
    const sb = net.steamBreaks || [];
    w.u32(sb.length);
    for(const b of sb){ w.u32(b.cells.length); for(const [x, y] of b.cells){ w.i32(x); w.i32(y); } w.u8(b.exh ? 1 : 0); }
    const g = matRegions();
    i32s(w, Array.from(g.of)); u8s(w, Array.from(g.tight || []).map(v => v ? 1 : 0));
    w.u32(g.regions.length);
    for(const r of g.regions){ w.u8(r.bounded ? 1 : 0); u32s(w, Array.from(r.wall || [])); w.f64(r.rel || 1); }
    numMap(w, Object.fromEntries(coreIds().map(id => [id, (P.cores && P.cores[id] && P.cores[id].netRef) || 0])));
    i32s(w, circs);
    w.u32(circs.length); for(const ci of circs) strs(w, coreOnCirc(ci).map(id => coreFold(id)));
    u32s(w, net.edges.filter(ed => !netHole(ed) && net.z[ed.u] !== net.z[ed.v]).map(ed => net.edges.indexOf(ed)));
    const fits = fitAll();
    numMap(w, Object.fromEntries(fits.map(fid => [fid, fitBoreMm(fid)])));
    const bk = net.byKey || {};
    numMap(w, Object.fromEntries(Object.keys(bk).map(k => [k, runBoreMm(bk[k])])));
    w.u32(fits.length); for(const fid of fits){ w.str(fid); const n = reliefNodeOf(net, fid); w.str(typeof n === "string" ? n : ""); }
    const nop = Object.entries(net.nodesOfPart || {});
    w.u32(nop.length); for(const [id, nodes] of nop){ w.str(id); u32s(w, nodes); }
    w.f64(DGEN); w.f64(num(P.eff)); w.f64(num(layoutMetrics().pzrK)); w.f64(num(P.hTurb));
    w.str(String(net.pcSig || ""));
    numMap(w, Object.fromEntries(condIds().map(id => [id, condUA(id)])));
    numMap(w, Object.fromEntries(condIds().map(id => [id, partMassOf(id)])));
    numMap(w, P.cwRefBy);
    w.f64(net.natTick || 0);
    f64s(w, net.natPBy ? Array.from(net.natPBy.v) : []); u8s(w, net.natPBy ? Array.from(net.natPBy.has) : []);
    f64s(w, net.natLoop ? Array.from(net.natLoop) : []);
    f64s(w, Array.from((net.scr && net.scr.metalQV) || [])); u8s(w, Array.from((net.scr && net.scr.metalQM) || []));
    const ends = Object.keys(bk).map(k => [k, runNodeEnds(k, bk[k].k)]).filter(([, e]) => e);
    w.u32(ends.length); for(const [k, e] of ends){ w.str(k); w.str(e[0]); w.str(e[1]); }
    const nrk = {};
    for(const nm of net.name){ const rk = runKeyOfNode(nm); if(rk) nrk[nm] = rk; }
    strMap(w, nrk);
    u32s(w, net.cont || []);
  }

  const KNOB_KEYS = ["v", "k", "kp", "ti", "td", "db", "n", "lo", "hi", "rate", "tau", "on", "off"];
  const MODE_OF = { source: 0, const: 1, math: 2, pid: 3, integ: 4, limit: 5, lag: 6, compare: 7, latch: 8, sel: 9, sink: 10 };
  const MATH_OF = { add: 0, sub: 1, mul: 2, div: 3, min: 4, max: 5 };
  const SEL_OF = { max: 0, min: 1, median: 2 };
  const CMP_OF = { above: 0, below: 1 };
  const SINK_OF = { rodStep: 0, freg: 1, relief: 2, flowDem: 3, loadDem: 4, boronDem: 5, valveDem: 6, tankOpen: 7, scram: 8, nearTrip: 9, runback: 10 };
  const codeOf = (t, k, none) => t[k] === undefined ? none : t[k];

  function snapAct(s){
    const ids = coreIds().filter(id => s.coreBy && s.coreBy[id]);
    const cores = ids.map(id => {
      const cs = s.coreBy[id], K = P.cores[id];
      return {
        id, NB: K.NB, rodDem: cs.rodDem, rodZDem: Array.from(cs.rodZDem),
        rodBand: !!cs.rodBand, split: !!cs.split, reGang: !!cs.reGang,
        bankAuto: Array.from(cs.bankAuto), rodJam: !!cs.rodJam,
        scrammed: !!cs.scrammed, rpsHot: num(cs.rpsHot), rpsNear: !!cs.rpsNear,
        trip: has(cs.trip) ? String(cs.trip) : "",
        rated: num(K.rated), rodRate: num(rodRate(K)),
        pinHot: Math.abs(TavgOf(s, K.circ) - tProg(s, K, cs)) > 0.5,
        dmgRod: (s.dmgParts || []).includes(rodsOf(id)),
      };
    });
    const keys = o => Object.keys(o || {});
    const fmap = o => { const k = keys(o); return { k, v: k.map(x => num(o[x])), ex: k.map(x => o[x] === undefined ? 0 : 1) }; };
    return {
      arLo: num(s.arLo), arHi: num(s.arHi),
      loadMax: num(P.loadMax), rpsLag: num(P.rpsLag), pRated: num(P.rated),
      load: num(s.load), loadDem: num(s.loadDem), boronDem: num(s.boronDem), rbHot: !!s.rbHot,
      freg: fmap(s.fregDemBy), flow: fmap(s.flowDemBy), valve: fmap(s.valveDem),
      tank: (() => { const k = keys(s.tankOpen); return { k, v: k.map(x => s.tankOpen[x] ? 1 : 0), ex: k.map(x => s.tankOpen[x] === undefined ? 0 : 1) }; })(),
      relief: (() => {
        const k = keys(s.reliefOpen);
        return {
          k,
          cell: k.map(fid => ({
            ex: s.reliefOpen[fid] === undefined ? 0 : 1,
            open: !!s.reliefOpen[fid], auto: !!s.reliefAuto[fid],
            stuck: !!s.reliefStuck[fid], arm: !!s.reliefArm[fid],
            spring: !!(P.fittings && P.fittings[fid] && P.fittings[fid].spring),
          })),
        };
      })(),
      cores,
    };
  }

  /* `ingest::read_ctl_sample` without its trailing want out/f; `src` is each block's source value */
  function ctlSample(w, s, dt, pre, act, src){
    const blkBy = s.blkBy || {}, ids = Object.keys(blkBy);
    const idxOf = new Map(ids.map((id, i) => [id, i]));
    const b8 = a => { for(const v of a) w.u8(v ? 1 : 0); };
    w.f64(dt); w.u8(ctlLive(s) ? 1 : 0);
    w.u32(ids.length);
    for(const id of ids) w.str(id);
    for(const id of ids) w.u8(codeOf(MODE_OF, blkBy[id].mode, 255));
    for(const id of ids) w.u8(blkBy[id].on ? 1 : 0);
    for(const id of ids){
      const ins = blkBy[id].in;
      w.u32(ins.length);
      for(const x of ins) w.i32(has(x) && idxOf.has(x) ? idxOf.get(x) : -1);
    }
    for(let i = 0; i < ids.length; i++) w.f64(pre.out[i]);
    for(let i = 0; i < ids.length; i++) w.f64(pre.f[i]);
    for(const id of ids){
      const b = blkBy[id];
      let mask = 0;
      KNOB_KEYS.forEach((k, ki) => { if(has(b[k])) w.f64(b[k]); else { mask |= 1 << ki; w.f64(NaN); } });
      w.u16(mask);
    }
    for(const id of ids){ const b = blkBy[id]; w.u8(b.mode === "math" ? codeOf(MATH_OF, b.op, 255) : 0); }
    for(const id of ids){ const b = blkBy[id]; w.u8(b.mode === "sel" ? codeOf(SEL_OF, b.op, 255) : 0); }
    for(const id of ids){ const b = blkBy[id]; w.u8(b.mode === "compare" ? codeOf(CMP_OF, b.op, 255) : 0); }
    ids.forEach((id, i) => w.f64(blkBy[id].mode === "source" ? num(src(i, blkBy[id])) : NaN));
    for(const id of ids){ const b = blkBy[id]; w.u8(b.mode === "sink" ? codeOf(SINK_OF, b.sink, 255) : 255); }
    for(const id of ids){
      const b = blkBy[id];
      if(b.mode !== "sink"){ w.i32(-1); continue; }
      const pick = l => l.indexOf(b.arg);
      const list = { rodStep: act.cores.map(c => c.id), scram: act.cores.map(c => c.id), nearTrip: act.cores.map(c => c.id),
        freg: act.freg.k, flowDem: act.flow.k, valveDem: act.valve.k, tankOpen: act.tank.k, relief: act.relief.k }[b.sink];
      w.i32(list ? pick(list) : -1);
    }
    for(const id of ids){ const b = blkBy[id]; w.u8(b.mode === "sink" && blkDead(s, b) ? 1 : 0); }
    for(const id of ids){
      const b = blkBy[id];
      const drv = b.mode === "sink" && b.sink === "scram" ? sinkDriver(s, "scram", b.arg) : null;
      w.str(drv ? blkBlame(s, drv) : "");
    }
    u32s(w, ctlOrder(s).map(id => idxOf.get(id)));
    for(const k of ["arLo", "arHi", "loadMax", "rpsLag", "pRated", "load", "loadDem", "boronDem"]) w.f64(act[k]);
    w.u8(act.rbHot ? 1 : 0);
    for(const m of [act.freg, act.flow, act.valve]){ w.u32(m.v.length); for(const v of m.v) w.f64(v); b8(m.ex); }
    w.u32(act.tank.v.length); b8(act.tank.v); b8(act.tank.ex);
    w.u32(act.relief.cell.length);
    for(const c of act.relief.cell) b8([c.ex, c.open, c.auto, c.stuck, c.arm, c.spring]);
    w.u32(act.cores.length);
    for(const c of act.cores){
      w.str(c.id); w.u32(c.NB); w.f64(c.rodDem); for(const v of c.rodZDem) w.f64(v);
      b8([c.rodBand, c.split, c.reGang, c.rodJam, c.scrammed, c.rpsNear]);
      b8(c.bankAuto);
      w.f64(c.rpsHot); w.f64(c.rated); w.f64(c.rodRate);
      b8([c.pinHot, c.dmgRod]);
      w.str(c.trip);
    }
  }

  /* `ingest::read_ctl_meta`: the sink key lists in fan-out order */
  function ctlKeys(w, act){
    strs(w, act.freg.k); strs(w, act.flow.k); strs(w, act.valve.k);
    strs(w, act.tank.k); strs(w, act.relief.k); strs(w, act.cores.map(c => c.id));
  }

  function ctlTable(w, s){
    const blkBy = s.blkBy || {}, ids = Object.keys(blkBy);
    strs(w, ids);
    strs(w, ids.map(id => blkBy[id].sig || ""));
    strs(w, ids.map(id => has(blkBy[id].arg) ? String(blkBy[id].arg) : ""));
    strs(w, ids.map(id => nameFor(id, "")));
    f64s(w, ids.map(id => blkBy[id].out));
    f64s(w, ids.map(id => blkBy[id].f));
    strMap(w, Object.fromEntries(coreIds().map(id => [id, rodsOf(id) || null])));
    optStr(w, roleId("turb") || null); optStr(w, roleId("ctrl") || null);
    w.f64(P.steamRef || 0);
  }

  function build(){
    const w = writer(), s = S;
    for(const c of MAGIC) w.u8(c.charCodeAt(0));
    w.u32(VERSION);
    edgeFrozen(w);
    tailFrozen(w);
    const act = snapAct(s), ids = Object.keys(s.blkBy || {});
    const fresh = !(s.blkOutV && s.blkOutV.length === ids.length && s.blkOutF && s.blkOutF.length === ids.length);
    const pre = fresh
      ? { out: ids.map(id => { const o = s.blkBy[id].out; return o === undefined ? 0 : o; }), f: ids.map(id => s.blkBy[id].f) }
      : { out: Array.from(s.blkOutV), f: Array.from(s.blkOutF) };
    /* a live read here would prime the per-tick memos (coreSeen, the piece cache) the first tick then trusts */
    ctlSample(w, s, 0.02, pre, act, (i, b) => { const r = SIGNAL[b.sig]; return r && r.fixed ? sigRead(s, b.sig, b.arg) : NaN; });
    ctlKeys(w, act);
    ctlTable(w, s);
    return w.bytes();
  }

  return { build, writer, snapAct, ctlSample, ctlKeys };
})();
