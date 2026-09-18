"use strict";

/* The commissioned plant as the Rust engine ingests it (`sim_ingest`): metas, then the state half.
   One writer, shared by the page and tools/step-gate.js; wire order is sim-rs/src/ingest.rs. */

const SIMSTATE = (() => {
  const VERSION = 3, LOG_HELD = 255;
  let W = null;
  const run = (w, f) => { const was = W; W = w; try { return f(); } finally { W = was; } };

  const u8 = v => W.u8(v);
  const u16 = v => W.u16(v);
  const u32 = v => W.u32(v);
  const i32 = v => W.i32(v);
  const f64 = v => W.f64(v);
  const str = s => W.str(s);
  const raw8a = a => W.u8arr(a);
  const u8a = a => { for(const x of a) W.u8(x ? 1 : 0); };
  const f64a = a => W.f64arr(a);
  const f64an = a => { u32(a.length); f64a(a); };
  const u8an = a => { u32(a.length); raw8a(a); };
  const i32a = a => { for(const v of a) i32(v); };
  const u32a = a => { for(const v of a) u32(v); };
  const u32an = a => { u32(a.length); u32a(a); };
  const strsRaw = a => { for(const s of a) str(s); };
  const strsn = a => { u32(a.length); strsRaw(a); };
  const num = v => (v === undefined || v === null) ? NaN : (+v);
  const strmap = o => { const k = Object.keys(o); u32(k.length); for(const x of k){ str(x); f64(num(o[x])); } };
  const padTo = (a, n) => { const o = a.slice(0, n); while(o.length < n) o.push(0); return o; };
  const u8raw = a => { for(const v of Array.from(a)) W.u8(v & 0xFF); };
  const fnum = v => (v === undefined || v === null) ? NaN : (typeof v === "boolean" ? (v ? 1 : 0) : v);
  /* the engine holds these maps unordered, so they cross key-sorted both ways */
  const sortedKeys = o => Object.keys(o || {}).sort();
  const strmapS = o => { const k = sortedKeys(o); u32(k.length); for(const x of k){ str(x); f64(num(o[x])); } };
  const smapOf = (o, ks) => {
    o = o || {};
    ks = ks.filter(k => o[k] !== undefined);
    u32(ks.length); strsRaw(ks); f64a(ks.map(k => fnum(o[k])));
  };
  const smap = o => smapOf(o, Object.keys(o || {}));
  const smapS = o => smapOf(o, sortedKeys(o));
  const boolmap = o => {
    const ks = sortedKeys(o);
    u32(ks.length);
    for(const k of ks){ str(k); u8(o[k] ? 1 : 0); }
  };

  const SAT_KEYS = ["A", "B", "C", "tc", "rhoc", "p0", "T0", "n", "pFloor", "TFloor",
    "hfg", "rho", "cp", "mu", "muV", "solidK", "Tref"];

  /* the engine carries these constants as literals: a drift here is a port that no longer matches */
  function consts(){
    const want = {
      ROOM_CRUSH_K, ROOM_CRUSH_SPAN, ROOM_CRUSH_TAU, ROOM_DMG_SPAN, ROOM_DMG_TAU,
      PIPE_PBURST, PIPE_TSURV, H2_BURN_EV, H2_LHV, FIRE_EV_KG, LEDGER_EPS, LEDGER_QUIET,
      H2_EV, H2_LFL, RAD_HI, RAD_FLOOR, RAD_CEIL, RAD_CREW_K, RAD_DOSE_K,
      RAD_BREACH, RAD_DMG, RAD_MELT, RAD_SGTR, RAD_AIR, RAD_TANK, RAD_SLOW, ANN_TICKS, DRAW_K,
      PROMPT_F, SG_LOW, SG_DRY_LO, SG_EFW_OFF, SG_DRY, SGL_SET, SG_DOME,
      TURB_TRIP_P, COND_DT0, TPROG_SPAN, T_HULL, AIR_MMOL, H2_MMOL, H2O_MMOL, RAD_K,
    };
    const ref = {
      ROOM_CRUSH_K: 10, ROOM_CRUSH_SPAN: 0.5, ROOM_CRUSH_TAU: 60,
      ROOM_DMG_SPAN: 60, ROOM_DMG_TAU: 25,
      PIPE_PBURST: 120, PIPE_TSURV: 900,
      H2_BURN_EV: 1.0, H2_LHV: 120000, FIRE_EV_KG: 1.0,
      LEDGER_EPS: 1e-7, LEDGER_QUIET: 30,
      H2_EV: 20, H2_LFL: 0.04,
      RAD_HI: 1.0, RAD_FLOOR: 0.02, RAD_CEIL: 3,
      RAD_CREW_K: 0.33, RAD_DOSE_K: 0.25,
      RAD_BREACH: 3.0, RAD_DMG: 0.06, RAD_MELT: 4.0,
      RAD_SGTR: 1.2, RAD_AIR: 0.05, RAD_TANK: 0.03,
      RAD_SLOW: 0.5, ANN_TICKS: 5, DRAW_K: 8.375,
      PROMPT_F: 0.935, SG_LOW: 35, SG_DRY_LO: 10,
      SG_EFW_OFF: 40, SG_DRY: 25, SGL_SET: 50, SG_DOME: 1.6,
      TURB_TRIP_P: 0.02, COND_DT0: 13, TPROG_SPAN: 18,
      T_HULL: 293, AIR_MMOL: 0.02896, H2_MMOL: 0.002016, H2O_MMOL: 0.018015,
      RAD_K: 7.1583,
    };
    for(const k of Object.keys(ref))
      if(want[k] !== ref[k]) throw new Error("SIMSTATE: const " + k + " = " + want[k] + " want " + ref[k]);
    return want;
  }

  const coreCircNow = () => nodeGraph().coreCirc;
  const coreCircsNow = () => nodeGraph().coreCircs;
  const bookedNow = () => Array.from(netBooked(P.net));
  const matRegionsNow = () => { const g = matRegions(); return { of: Array.from(g.of), n: g.regions.length }; };
  const circBurnOf = ci => { const c = satOfCirc(ci); return c.burn || ""; };

  function secMeta(C){
    const net = P.net;
    const cids = coreIds();
    strsn(cids);
    i32a(cids.map(id => coreCircOf(id)));
    f64a(cids.map(id => num(P.cores[id].invKg0)));
    const nCirc = Math.max(0, ...cids.map(id => coreCircOf(id))) + 1;
    u32(nCirc);
    for(let ci = 0; ci < nCirc; ci++){
      const ks = coreOnCirc(ci).concat(holdOnCirc(ci));
      str(ks.length ? ks[0] : "");
    }
    i32(coreCircNow());
    u8an([...Array(nCirc).keys()].map(ci => (coreCircsNow()[ci] ? 1 : 0)));
    f64(P.backup);
    const hc = holdCircs();
    u32(hc.length); i32a(hc);
    u32(nCirc);
    for(let ci = 0; ci < nCirc; ci++){ const l = holdOnCirc(ci); u32(l.length); strsRaw(l); }
    const dids = drumIds(), bids = boilerIds(), sids = sgIds();
    strsn(dids);
    strsn(bids);
    strsn(sids);
    u32(sids.length); i32a(sids.map(id => loopOf(id) === null ? -1 : loopOf(id)));
    const pids = pumpIds();
    strsn(pids);
    u8a(pids.map(id => primaryPump(id) ? 1 : 0));
    for(const id of pids){
      const r = pumpResOf(id); strsn(r);
      str(pumpSucNode(id) || ""); str(pumpEdgeKey(id) || "");
    }
    f64a(pids.map(id => pumpRotor(id)));
    const partIds = LAY.parts.map(p => p.id);
    strsn(partIds);
    f64(C.SG_EFW_OFF); f64(C.SG_DRY); f64(C.SGL_SET); f64(C.SG_DOME);
    strsRaw(bids.map(id => boilerNode(id)));
    u32(bids.length); i32a(bids.map(id => boilerCirc(id)));
    strsRaw(bids.map(id => feedNode(id)));
    u32(net.edges.length);
    i32a(net.edges.map(e => e.gasAt === undefined ? -1 : e.gasAt));
    i32a(net.edges.map(e => e.u));
    strsn(net.edges.map(e => e.kind || ""));
    strsn(net.edges.map(e => e.key || ""));
    const conds = condIds(), sinks = condSinks();
    strsn(sinks.map(id => breakKeyOf(id)));
    const tids = tankIds();
    strsn(tids.map(id => D.tanks[id].auto || "manual"));
    strsn(conds);
    strsn(sinks);
    for(const id of conds){ const IN = condIN(id); str(IN ? IN.a : ""); }
    u8a(conds.map(id => condVacuum(id) ? 1 : 0));
    f64a(conds.map(id => condVolOf(id)));
    for(const id of conds){
      const qs = cwPathsOf(id);
      u32(qs.length);
      for(const q of qs){ str(q.key); str(q.a); str(q.b); }
    }
    const rids = radIds();
    strsn(rids);
    f64a(rids.map(id => radUAOf(id)));
    f64a(rids.map(id => radMass(id)));
    f64a(rids.map(id => partVol(id)));
    f64a(rids.map(id => radCoatOf(id).emis));
    f64a(rids.map(id => radArea(id)));
    strsRaw(rids.map(id => tickRadKey(id)));
    for(let k = 0; k < rids.length; k++){ const IN = ROLE.radiator.internal; str(IN.a); str(IN.b); }
    u8a(rids.map(id => radLive(id) ? 1 : 0));
    const xids = ihxIds();
    strsn(xids);
    f64a(xids.map(id => ihxUAOf(id)));
    u8a(bids.map(id => isDrum(id) ? 1 : 0));
    u8a(xids.map(id => sgActive(id) ? 1 : 0));
    f64(C.PROMPT_F);
    f64a(sids.map(id => num((P.sgUABy && P.sgUABy[id]) || P.sgUA)));
    f64a(sids.map(id => sgDesignP(id)));
    f64a(sids.map(id => sgMassOf(id)));
    f64a(sids.map(id => sgBurstP(id)));
    u8a(sids.map(id => sgActive(id) ? 1 : 0));
    strsRaw(sids.map(id => shellNode(id)));
    u32(sids.length); i32a(sids.map(id => shellCirc(id)));
    u32(sids.length); i32a(sids.map(id => sgPrimCirc(id)));
    {
      const faces = id => { const IN = roleIns(partOf(id))[0]; return IN ? [IN.a, IN.b] : null; };
      const ids = sids.filter(id => faces(id));
      u32(ids.length);
      for(const id of ids){ const [a, b] = faces(id); str(id); str(a); str(b); }
    }
    f64(DRY_MIN_KG); f64(P.dose);
    u8an(net.name.map(nm => nodeGraph().inCore(nm) ? 1 : 0));
    f64an(Array.from(net.vol));
    strsn([...holdLineSet()]);
    {
      const reg = matRegionsNow();
      i32(LAY.parts.indexOf(roleOf("cond")));
      f64(condPDes());
      u32(reg.of.length); i32a(Array.from(reg.of));
      u32(reg.n);
      f64(P.Pcont); u32(GW); u32(GH);
      strsRaw(conds.map(id => condVesNode(id) || ""));
    }
    strsn(tids);
    for(const tid of tids){
      const t = D.tanks[tid];
      f64(t.vol); f64(t.level); str(t.fluid);
      u8(t.hold ? 1 : 0);
      u8(t.hold && t.hold.p !== undefined ? 1 : 0); if(t.hold && t.hold.p !== undefined) f64(t.hold.p);
      u8(t.inf ? 1 : 0); u8(t.cell ? 1 : 0);
      u8(t.gas ? 1 : 0); if(t.gas) f64(t.gas.p0);
      u8(t.burst ? 1 : 0); if(t.burst){ f64(t.burst.at); f64(t.burst.drain); f64(t.burst.rel); }
      str(t.auto || "manual");
      u8(tankInField(tid) ? 1 : 0); u8(tankPrimary(tid) ? 1 : 0);
      i32(tankCircuit(tid) === null ? -1 : tankCircuit(tid));
    }
    f64a(tids.map(id => tankKg(id)));
    strsRaw(tids.map(id => { const n = P.net.tankNode[id]; return n === undefined ? "" : String(n); }));
    strsRaw(tids.map(id => breakKeyOf(id)));
    u8a(tids.map(() => 0));
    u8a(tids.map(id => tankPrimary(id) ? 1 : 0));
    str(primaryCore());
    u32(nCirc);
    for(let ci = 0; ci < nCirc; ci++){ const l = coreOnCirc(ci); u32(l.length); strsRaw(l); }
    u32(cids.length); i32a(cids.map(id => coreCircOf(id)));
    u32(cids.length); i32a(cids.map(id => { const v = P.net.coreNodes ? P.net.coreNodes[id] : undefined; return v === undefined ? -1 : v; }));
    i32(P.net.coreNode === undefined ? -1 : P.net.coreNode);
    f64(P.invKg0);
    u32an(secTankIds().map(id => tids.indexOf(id)));
    u32an(holdTankIds().map(id => tids.indexOf(id)));
    const fids = reliefFitIds();
    strsn(fids);
    u32an(reliefPriIds().map(id => fids.indexOf(id)));
    strsn(reliefSecIds());
    strsRaw(fids.map(id => reliefNodeOf(P.net, id) === undefined ? "" : reliefNodeOf(P.net, id)));
    for(const fid of fids){
      const s = reliefSet(fid);
      f64(s.lift); f64(s.reseat);
      u8(fitSpring(fid) ? 1 : 0); u8((P.net.fitTarget && P.net.fitTarget[fid]) ? 1 : 0);
    }
    for(const fid of fids) str(ventKeyOf(fid) || "");
    strsn(outKeysOf(P.net));
    {
      const ents = [...P.net.outPos.entries()];
      u32(ents.length);
      for(const [k, v] of ents){ str(k); u32(v); }
    }
    {
      const ps = LAY.parts;
      u32(ps.length);
      for(let i = 0; i < ps.length; i++){ str(ps[i].id); u32(i); }
    }
    {
      u32(fids.length);
      for(const fid of fids){ const sh = shellsOf(fid); str(fid); u32(sh.length); strsRaw(sh); }
    }
    const fm = flowMapsOf(P.net);
    strsn(fm.byKeys);
    strsn(fm.sgtrKeys);
    strsRaw(sids.map(id => sgtrKeyOf(id)));
    {
      const ids = sids.concat(xids);
      u32(ids.length);
      for(const id of ids){
        const [k0, k1] = stageKeysOf(id);
        str(id); str(k0 || ""); str(k1 || "");
        const nbr = k => { stageInNode(S, id, k); const nb = P.net.sgInNbr[id]; return nb ? (nb[k] || []) : []; };
        const n0 = nbr(0), n1 = nbr(1);
        u32(n0.length); i32a(n0); u32(n1.length); i32a(n1);
      }
    }
    strmap(Object.fromEntries(Object.entries(P.netRefByRun || {})));
    {
      const runs = pipeNetwork();
      u32(runs.length);
      for(const r of runs){
        str(r.key); u32(r.cells.length);
        for(const [x, y] of r.cells){ i32(x); i32(y); }
      }
      f64a(runs.map(r => runBurstP(r)));
      strsRaw(runs.map(r => runNodeOf(r.key) || ""));
    }
    {
      const ks = Object.keys(D.mat || {});
      u32(ks.length);
      for(const k of ks){
        const c = k.indexOf(",");
        str(k); i32(+k.slice(0, c)); i32(+k.slice(c + 1));
        u8(matRow(D.mat[k].m).tight ? 1 : 0); f64(matBurstP(+k.slice(0, c), +k.slice(c + 1)));
      }
    }
    strsn(net.name);
    {
      u32(net.name.length);
      for(let i = 0; i < net.name.length; i++){ str(net.name[i]); u32(i); }
    }
    u8a(Array.from(net.vapour || new Uint8Array(net.n)));
    raw8a(bookedNow());
    i32a(net.name.map(nm => circOfNode(nm)));
    {
      const fm2 = foldMap();
      const ks = Object.keys(fm2);
      u32(ks.length);
      for(const k of ks){ str(k); str(fm2[k]); }
    }
    {
      const ps = LAY.parts;
      u32(ps.length);
      for(const p of ps){ str(p.id); str(p.role); i32(p.x); i32(p.y); i32(p.w); i32(p.h); }
    }
    {
      const ks = Object.keys(FIRE);
      u32(ks.length);
      for(const k of ks){ const r = FIRE[k]; str(k); f64(r.wlhv); f64(r.wh2); f64(r.wh2o); f64(r.wast); f64(r.wastMax); }
    }
    u32(nCirc);
    for(let ci = 0; ci < nCirc; ci++) str(circBurnOf(ci) || "");
    f64(steamRise()); f64(roomSteamH()); f64(loopKg()); f64(coreDT0());
    f64(P.P0); f64(P.Tref); f64(P.rated); f64(P.flowK); f64(P.flowMin); f64(P.sat.cp);
    return { coreIds: cids, pumpIds: pids, boilerIds: bids, sgIds: sids, drumIds: dids, partIds, nCirc,
      condIds: conds, condSinks: sinks, tankIds: tids, radIds: rids, ihxIds: xids, reliefIds: fids };
  }

  function curves(n){
    u32(n);
    for(let ci = 0; ci < n; ci++) f64a(SAT_KEYS.map(k => num(satOfCirc(ci)[k])));
    f64a(SAT_KEYS.map(k => num(SAT_WATER[k])));
    f64a([...Array(n).keys()].map(ci => holdSetP(ci)));
  }

  function roomMeta(){
    const net = P.net, n = GW * GH;
    u32(GW); u32(GH);
    f64(P.MPC !== undefined ? P.MPC : MPC);
    f64(P.Pcont); f64(loopKg()); f64(steamRise()); f64(roomSteamH()); f64(P.Tref);
    f64(CP_W);
    const layParts = LAY.parts;
    u32(layParts.length);
    for(const p of layParts){
      str(p.id); str(p.role); i32(p.x); i32(p.y); i32(p.w); i32(p.h);
      const m = D.machines && D.machines[p.id];
      const on = m && m.on;
      u8(on ? 1 : 0); if(on) str(on);
    }
    {
      const roles = [...new Set(layParts.map(p => p.role))];
      u32(roles.length);
      for(const r of roles){
        const row = ROLE[r], rr = row ? { drown: !!row.drown, thermal: row.thermal || "none" } : { drown: false, thermal: "none" };
        str(r); u8(rr.drown ? 1 : 0); str(rr.thermal);
        const ins = roleIns({ role: r }).map(q => [q.a, q.b]);
        u32(ins.length);
        for(const [a, b] of ins){ str(a); str(b); }
      }
    }
    {
      u32(layParts.length);
      for(const p of layParts){
        const fn = partFaceNode(p.id);
        str(p.id); str(fn.t); str(fn.r); str(fn.b); str(fn.l);
      }
    }
    const cids = coreIds();
    strsn(cids);
    u32(cids.length);
    for(const id of cids){ str(id); u32(P.cores[id].NB); }
    f64(D.bkp || 0);
    strsn(reliefFitIds());
    strsn(reliefSecIds());
    strsn(boilerIds());
    {
      const sids = sgIds();
      u32(sids.length);
      for(const id of sids){ str(id); str(shellNode(id)); }
    }
    u32(layParts.length);
    for(const p of layParts){ str(p.id); str(p.role); }
    u32(layParts.length);
    for(const p of layParts){
      const m = D.machines && D.machines[p.id];
      const on = m && m.on;
      str(p.id); u8(on ? 1 : 0); if(on) str(on);
    }
    {
      const ts = Object.keys(D.tanks || {});
      u32(ts.length);
      for(const tid of ts){ str(tid); u8(D.tanks[tid] && D.tanks[tid].hold ? 1 : 0); }
    }
    {
      const pri = reliefPriIds();
      u8(pri.length ? 1 : 0); if(pri.length) str(pri[0]);
    }
    {
      const fids = reliefFitIds();
      u32(fids.length);
      for(const fid of fids){ str(fid); str(ventKeyOf(fid) || ""); }
    }
    const circVals = net.name.map(nm => circOfNode(nm));
    const nCirc = Math.max(0, ...circVals, coreCircNow()) + 1;
    {
      u32(nCirc);
      for(let ci = 0; ci < nCirc; ci++) str(circBurnOf(ci) || "");
    }
    {
      const tight = [];
      for(const k of Object.keys(D.mat || {})){
        const c = k.indexOf(",");
        if(matWall(+k.slice(0, c), +k.slice(c + 1))) tight.push(k);
      }
      u32(tight.length);
      for(const k of tight){
        const c = k.indexOf(",");
        i32(+k.slice(0, c)); i32(+k.slice(c + 1));
      }
    }
    {
      const reg = matRegionsNow();
      u32(reg.of.length); i32a(Array.from(reg.of));
      u32(reg.n);
    }
    {
      const fks = Object.keys(FIRE);
      u32(fks.length);
      for(const k of fks){
        const r = FIRE[k];
        str(k);
        f64a([r.lhv, r.o2, r.ign, r.melt, r.boil, r.lf, r.rate, r.loc, r.emis,
          r.hConv, r.sigma, r.eta, r.wlhv, r.wh2, r.wh2o, r.wrate, r.wast, r.wastMax]);
      }
    }
    {
      const co = COOLANT.filter(a => a.burn === Object.keys(FIRE)[0])[0] || null;
      u8(co ? 1 : 0);
      if(co){ f64(co.cp); f64(co.dens); f64(co.bulk); }
    }
    {
      const byKey = P.net.byKey instanceof Map ? [...P.net.byKey.entries()] : Object.entries(P.net.byKey || {});
      u32(byKey.length);
      for(const [key, e] of byKey){
        str(key);
        const cells = e.cells || [];
        u32(cells.length);
        for(const [x, y] of cells){ i32(x); i32(y); }
        str(e.pa || ""); str(e.pb || "");
      }
    }
    {
      const ps = Object.keys(D.ports || {});
      u32(ps.length);
      for(const pid of ps){
        const c = portCell(pid);
        str(pid); u8(c ? 1 : 0);
        if(c){ i32(c[0]); i32(c[1]); }
      }
    }
    {
      const t = (P.net && P.net.fitTarget) || {};
      strsn(Object.keys(t).filter(k => t[k]));
      const o = (P.net && P.net.fitVentOut) || {};
      strsn(Object.keys(o).filter(k => o[k]));
    }
    strsn(net.name);
    {
      u32(net.name.length);
      for(let i = 0; i < net.name.length; i++){ str(net.name[i]); u32(i); }
    }
    u8a(Array.from(net.vapour || new Uint8Array(net.n)));
    i32a(circVals.map(v => (v === undefined || v === null) ? -1 : v));
    {
      u32(nCirc);
      for(let ci = 0; ci < nCirc; ci++) str(circKey(ci) || "");
    }
    u8an([...Array(nCirc).keys()].map(ci => (coreCircsNow()[ci] ? 1 : 0)));
    u8a([...Array(nCirc).keys()].map(ci => (circAuthored(ci) ? 1 : 0)));
    const extra = new Set();
    for(const p of layParts){
      const fn = partFaceNode(p.id);
      for(const f of [fn.t, fn.r, fn.b, fn.l]) extra.add(f);
    }
    for(const k of Object.keys(S.spillBy || {})){
      if(k.startsWith("break:") && k.slice(6).indexOf(":") >= 0) extra.add("run:" + k.slice(6));
    }
    for(const id of cids) extra.add("cav:" + id);
    {
      const xs = [...extra];
      u32(xs.length);
      for(const nm of xs){ str(nm); i32(circOfNode(nm)); }
    }
    {
      const G = roomGeom();
      u32(n);
      u8a(Array.from(G.occ)); u8a(Array.from(G.tight)); u8raw(Array.from(G.face));
      i32a(Array.from(G.own)); u8a(Array.from(G.pan)); f64a(Array.from(G.turb));
      u32(G.parts.length);
      for(const q of G.parts){ str(q.p.id); u32(q.cells.length); u32a(q.cells); }
      u32(G.runs.length);
      for(const r of G.runs){ str(r.key); u32(r.cells.length); u32a(r.cells); }
      {
        const sks = Object.keys(G.shellValves || {});
        u32(sks.length);
        for(const k of sks){ str(k); strsn(G.shellValves[k]); }
      }
      f64a(Array.from(G.bx)); f64a(Array.from(G.by)); f64a(Array.from(G.gx));
      f64a(Array.from(G.gUp)); f64a(Array.from(G.gDn));
    }
    return { coreIds: cids, n, layParts, nCirc };
  }

  const ROOM_F64KEYS = ["roomMax", "roomPMax", "roomBurnOn", "roomFireOn", "Tavg", "h2",
    "load", "loadDem", "burnKg", "burnP", "burnBlast", "fireKg", "fireP", "fireQ"].sort();
  const ROOM_U8KEYS = ["blackout", "bkpLost", "sgtr"].sort();
  const ROOM_I32KEYS = ["roomMaxAt"];
  const ROOM_MAPKEYS = ["partT", "skinQ", "runT", "panBy", "TavgBy", "reliefSteam", "sgVentBy", "sgH2By",
    "sgTBy", "condTBy", "radTBy"].sort();
  const ROOM_BAGKEYS = ["mBy", "hBy", "pBy"];
  const ROOM_F64GRIDS = ["roomT", "roomPool", "roomPoolE", "roomWater", "roomWaterE"].sort();
  const ROOM_F32GRIDS = ["roomM", "roomH2", "roomO2", "roomVap", "roomFlame", "roomP", "roomPPk",
    "roomScar", "roomScarCur", "roomPU", "roomPV", "roomPoolU", "roomPoolV",
    "roomWU", "roomWV", "roomWP", "roomPoolP"].sort();

  function eventsMeta(){
    const n = GW * GH;
    u32(GW); u32(GH);
    const LPs = LAY.parts.map(p => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, role: p.role, name: p.name }));
    u32(LPs.length);
    for(const p of LPs){
      str(p.id); i32(p.x); i32(p.y); i32(p.w); i32(p.h);
      str(p.role); str(p.name || "");
      const q = partOf(p.id);
      const pb = q ? partPburst(q) : null, pd = q ? partPdes(q) : 0, ts = q ? partTsurv(q) : 0;
      f64(pb === null || pb === undefined ? 0 : pb);
      f64(pd === null || pd === undefined ? 0 : pd);
      f64(ts === null || ts === undefined ? 0 : ts);
      const fn = partFaceNode(p.id) || {};
      str(fn.t || ""); str(fn.r || ""); str(fn.b || ""); str(fn.l || "");
      const m = (D.machines || {})[p.id];
      str((m && m.on) || "");
      u8(tankHold(p.id) ? 1 : 0);
    }
    const CHZ = cellHazards();
    u32(CHZ.length);
    for(const q of CHZ){
      str(q.id); i32(q.x); i32(q.y); f64(q.lim || 0); str(q.what || "");
    }
    const cids = coreIds();
    strsn(cids);
    str(primaryCore() || "");
    u32(cids.length); for(const id of cids){ str(id); f64(P.cores[id].rated); }
    u32(cids.length); for(const id of cids){ str(id); u32(P.cores[id].NB); }
    const ciOf = {};
    for(const id of cids){ const K = P.cores && P.cores[id]; ciOf[id] = K ? K.circ : -1; }
    u32(cids.length); for(const id of cids){ str(id); i32(ciOf[id]); }
    const cis = [...new Set(Object.values(ciOf))].sort((a, b) => a - b);
    u32(cis.length); for(const ci of cis){ i32(ci); str(circKey(ci) || ""); }
    i32(coreCircNow());
    u32(cis.length); for(const ci of cis){ i32(ci); f64(satOfCirc(ci).Tref); }
    u32(cids.length);
    for(const id of cids){ const K = P.cores && P.cores[id]; const h = K ? holdOnCirc(K.circ) : []; str(id); str(h.length ? h[0] : ""); }
    u32(cids.length); for(const id of cids){ str(id); f64(P.cores[id].Tref); }
    u32(cids.length); for(const id of cids){ str(id); f64(P.cores[id].steam); }
    f64(P.TfRef); f64(P.dnbr0);
    f64((S.K || P).Tref); f64((S.K || P).steam);
    f64(P.rated); f64(P.flowMin); f64(P.P0);
    f64(ratedSteam()); f64(sgDesignP() * PORV_LIFT_K); f64(tsatSec(TURB_TRIP_P) - COND_DT0);
    f64(P.flowK); f64(D.bkp || 0);
    const fuelIn = COOLANT[priD().cool].fuelInCoolant;
    u8(P.catcher ? 1 : 0); u8(fuelIn ? 1 : 0); u8(P.vessel ? 1 : 0);
    f64(FLUID.water.act);
    const sids = sgIds(), bids = boilerIds(), pids = pumpIds(),
      tids = tankIds(), fids = reliefFitIds(), rids = radIds();
    strsn(sids); strsn(bids); strsn(pids); strsn(tids); strsn(fids); strsn(rids);
    strsn(pids.filter(id => primaryPump(id)));
    u32(rids.length); for(const id of rids){ str(id); u8(radLive(id) ? 1 : 0); }
    str(primaryRelief() || "");
    u32(tids.length);
    for(const id of tids){
      const t = (D.tanks || {})[id] || {};
      str(id);
      u8(t.inf ? 1 : 0); u8(t.hold ? 1 : 0); u8(t.cell ? 1 : 0);
      f64(num(t.level)); f64(num(tankFluid(id).act)); f64(num(tankKg(id)));
      u8(tankInField(id) ? 1 : 0);
    }
    const netKeys = Object.keys(P.net.index);
    strsn(netKeys);
    strsn(netKeys.filter(nn => nodeGraph().inCore(nn)));
    u32(P.net.n); raw8a(bookedNow());
    const fmr = flowMapsOf(P.net);
    const runKeys = fmr.runKeys;
    strsn(runKeys);
    const rpos = {}; for(const [k, v] of fmr.runPos) rpos[k] = v;
    u32(runKeys.length); for(const k of runKeys){ str(k); u32(rpos[k] || 0); }
    u32(runKeys.length);
    for(const k of runKeys){
      const r = P.net.byKey[k];
      str(k);
      if(!r){ u8(0); continue; }
      u8(1); str(r.k); str(r.pa); str(r.pb);
    }
    u32(runKeys.length); for(const k of runKeys){ str(k); i32(P.net.tagByKey[k] || 0); }
    u32(runKeys.length); for(const k of runKeys){ str(k); f64(num(P.netRefByRun[k])); }
    u32(runKeys.length);
    for(const k of runKeys){
      const r = P.net.byKey[k];
      str(k);
      if(!r){ u8(0); continue; }
      const b = steamBook(k, r.k);
      u8(1); u8(b.vent ? 1 : 0); strsn((b.taps || []).slice()); f64(steamDir(k, r.k));
      strsn((b.gens || []).slice()); u8(runEnds(k, r.k) ? 1 : 0);
    }
    const mo = matRegions().of;
    u32(mo.length); i32a(Array.from(mo));
    const cp = roleOf("ctrl") || (primaryCore() ? partOf(primaryCore()) : null);
    if(!cp) u8(0);
    else { u8(1); i32(cp.x); i32(cp.y); i32(cp.w); i32(cp.h); }
    const K = P.radK;
    u32(K.core.length);
    for(const t of K.core){ str(t.id); u32(t.k.length); f64a(Array.from(t.k)); }
    u32(K.sg.length);
    for(const k of K.sg){ u32(k.length); f64a(Array.from(k)); }
    u32(K.tank.length);
    for(const t of K.tank){ str(t.id); u32(t.k.length); f64a(Array.from(t.k)); }
    if(fuelIn){
      const kp = P.radK.pipe;
      u8(1); u32(kp.length); f64a(Array.from(kp));
    } else u8(0);
    return { n, gw: GW, gh: GH, coreIds: cids, sgIds: sids, boilerIds: bids, pumpIds: pids, tankIds: tids, runKeys, parts: LPs };
  }

  const SEC_F64KEYS = ["P", "Tavg", "boron", "boronDem", "condT", "condVent", "cwInT", "dLvl",
    "dTavg", "decay", "flowNet", "h2", "heat", "injRate", "inv", "load", "loadDem", "lvl",
    "n", "nat", "pCore", "release", "sc", "sgBurstGen", "sgtrRate", "spillRate", "turbP", "turbWk", "cav", "vf"].sort();
  const SEC_U8KEYS = ["bkpLost", "blackout", "breach", "condLost", "condVentSeen", "rbHot", "refOpen", "turbTrip"].sort();
  const SEC_MAPKEYS = ["PBy", "TavgBy", "cavP", "condPBy", "condTBy", "cwInTBy", "dLvlBy", "flowBy",
    "flowDemBy", "fregBy", "fregDemBy", "holdPBy", "ihxQBy", "invBy", "lvlBy", "pumpQBy", "radQBy",
    "radTBy", "reliefSteam", "reliefVent", "scBy", "sgFedBy", "sgH2By", "sgPBy", "sgPwQBy", "sgShare",
    "sgSwQBy", "sgTBy", "sgVentBy", "sgWastBy", "sgtrBy", "skinQ", "spillBy", "steamBy", "tank",
    "tankOpen", "tankOver", "tankRate", "valve", "valveDem", "cwFlowBy"].sort();
  const SEC_BMAPKEYS = ["burstBy", "sgBurst", "tankAuto"];
  const SEC_BAGKEYS = ["mBy", "hBy", "pBy", "bBy", "h2By"];

  /* an absent holder is n zeros; extra grid bags ride inside the same count */
  function bags(names, s, n, extra){
    const grid = new Map(extra || []);
    const all = names.concat([...grid.keys()]).sort();
    u32(all.length);
    for(const k of all){
      str(k);
      if(grid.has(k)){
        const arr = grid.get(k), v = arr ? Array.from(arr) : new Array(n).fill(0);
        u32(v.length); f64a(v); u32(v.length); u8a(new Array(v.length).fill(1));
        continue;
      }
      const h = s[k];
      if(!h || !h.v){
        u32(n); f64a(new Array(n).fill(0)); u32(n); u8a(new Array(n).fill(0));
      } else {
        const v = Array.from(h.v);
        u32(v.length); f64a(v); u32(v.length); u8a(padTo(Array.from(h.has || []), v.length));
      }
    }
  }

  function transMeta(){
    const net0 = P.net, n0 = net0.n, ne0 = net0.edges.length;
    const num0 = v => (v === undefined || v === null) ? NaN : v;
    const opt3 = v => (v === undefined || v === null) ? -1 : v;
    const cp = a => Array.from(a);
    u32(n0); u32(ne0);
    u32a(net0.edges.map(e => e.u)); u32a(net0.edges.map(e => e.v));
    f64a(cp(net0.vol)); f64a(cp(net0.z));
    raw8a(cp(bookedNow()));
    const bookOf = netBookOf(net0), bids = new Map([["", 0]]);
    u32a(net0.name.map((nm, i) => {
      const b = bookOf[i]; if(b === undefined) return 0;
      if(!bids.has(b)) bids.set(b, bids.size); return bids.get(b);
    }));
    u8a(net0.name.map((nm, i) => (net0.tankIdByNode && net0.tankIdByNode[i] !== undefined) ? 1 : 0));
    i32a(net0.edges.map(e => opt3(e.gasAt))); i32a(net0.edges.map(e => opt3(e.liqAt)));
    u8a(net0.edges.map(e => e.kind === "break" ? 1 : 0));
    u8a(net0.edges.map(e => (e.kind === "break" || e.kind === "vent") ? 1 : 0));
    u8a(net0.edges.map(e => e.steam ? 1 : 0)); u8a(net0.edges.map(e => e.sec ? 1 : 0));
    i32a(net0.edges.map(ed => { const j = net0.outPos.get(ed.key); return j === undefined ? -1 : j; }));
    outKeysOf(net0);
    u32(net0.outKeys.length);
    u8a(net0.name.map(nm => netInCore(nm) ? 1 : 0));
    i32a(net0.name.map(nm => { const v = circOfNode(nm); return v === undefined ? -999 : v; }));
    f64a(net0.name.map(nm => num0((P.netRefThru || {})[nm])));
    u8a(new Array(n0).fill(0));
    f64a(net0.metalKg ? cp(net0.metalKg) : new Array(n0).fill(NaN));
    f64a(net0.metalTau ? cp(net0.metalTau) : new Array(n0).fill(NaN));
    f64a(net0.metalUA ? cp(net0.metalUA) : new Array(n0).fill(NaN));
    const cmap = new Map(), cvs = [];
    const curveOf = net0.satBy.map(c => {
      const key = SAT_KEYS.map(k2 => String(num0(c[k2]))).join(",");
      if(!cmap.has(key)){ cmap.set(key, cvs.length); cvs.push(SAT_KEYS.map(k2 => num0(c[k2]))); }
      return cmap.get(key);
    });
    u32(cvs.length);
    for(const cv of cvs) f64a(cv);
    u32a(curveOf);
    const feedIdx = boilerIds().map(id => { const i = net0.index[feedNode(id)]; return i === undefined ? 0xFFFFFFFF : i; });
    u32(feedIdx.length); u32a(feedIdx);
    const coreIdx = coreIds().map(id => { const i = net0.index[coreFold(id)]; return i === undefined ? 0xFFFFFFFF : i; });
    u32(coreIdx.length); u32a(coreIdx);
    const G = nodeGraph();
    const circs = holdCircs().filter(ci => G.coreCircs[ci] === 1);
    u32(circs.length);
    for(const ci of circs){
      const key = circKey(ci), K = (P.cores && P.cores[key]) || P;
      const ck = SAT_KEYS.map(k2 => String(num0(satOfCirc(ci)[k2]))).join(",");
      if(!cmap.has(ck)){ cmap.set(ck, cvs.length); cvs.push(SAT_KEYS.map(k2 => num0(satOfCirc(ci)[k2]))); }
      i32(ci); u32(cmap.get(ck));
      f64(num0(K.Tmin)); f64(num0(K.Tmax));
    }
    i32(net0.coreNode === undefined ? -1 : net0.coreNode);
    u8(S.bBy ? 1 : 0);
    i32(G.coreCirc === undefined || G.coreCirc === null ? -1 : G.coreCirc);
    f64a([COND_P0, CP_STEEL, H2_RISE, DRY_MIN_KG, CORE_DT_QMIN, TAVG_RATE_TAU]);
    const riseE = net0.edges.filter(ed => !netHole(ed) && net0.z[ed.u] !== net0.z[ed.v]);
    u32(riseE.length); u32a(riseE.map(ed => ed.u)); u32a(riseE.map(ed => ed.v));
  }

  function coreK(K){
    const NB = K.NB;
    const pad14 = a => { const o = Array.from(a || []); while(o.length < 14) o.push(0); return o.slice(0, 14); };
    const cp = a => Array.from(a || []);
    const f = [K.n0, K.TfRef, K.Tref, K.rodA, K.tipRho, K.tipLen, K.poison, K.mix, K.dT0, K.dh,
      K.aHeat, K.G0, K.filmPool, K.xSub, K.xSubLo, K.hfg, K.flowK, K.pinUA, K.gSolid, K.cladR,
      K.rodD, K.tmelt, K.KXE, K.aF, K.aM, K.aX, K.aS, K.aV, K.excess, K.dnbrK, K.tdmg, K.rated,
      K.scram, rodRate(K), K.burstK, K.P0, K.coreKg0, K.BETA, K.LAM, K.gI, K.lamI, K.gX, K.lamX,
      K.sig, K.cr, K.cz, K.albR, K.albT, K.albB, K.rinf, burstR(), P.rho0, RHO_BETA, P.Tref,
      K.coreHgt].map(num);
    if(f.length !== 55) throw new Error("SIMSTATE: K floats len " + f.length);
    const law = K.dnbLaw === "boil" ? 1 : K.dnbLaw === "temp" ? 2 : 0;
    u32(NB); f64a(f);
    f64a(SAT_KEYS.map(k => num(K.sat[k])));
    raw8a([(K.oxid ? 1 : 0), (K.dryout ? 1 : 0), (K.tube ? 1 : 0), law]);
    f64a(pad14(K.poiG)); f64a(pad14(K.nPen)); f64a(pad14(K.enrRho)); f64a(pad14(K.rinfW));
    f64a(cp(K.bet).slice(0, 6)); f64a(cp(K.lam).slice(0, 6));
    f64a(cp(K.bankR).slice(0, NB)); f64a(cp(K.bankW).slice(0, NB));
  }

  function solveMeta(){
    const net = P.net, n = net.n;
    const num0 = v => (v === undefined || v === null) ? NaN : v;
    const opt3 = v => (v === undefined || v === null) ? -1 : v;
    u32(n); u32(net.edges.length); u32(1);
    u32(P.loops); f64(P.netRef);
    const cmap = new Map(), cvs = [];
    const curveOf = net.satBy.map(c => {
      const key = SAT_KEYS.map(k => String(num0(c[k]))).join(",");
      if(!cmap.has(key)){ cmap.set(key, cvs.length); cvs.push(SAT_KEYS.map(k => num0(c[k]))); }
      return cmap.get(key);
    });
    u32(cvs.length);
    for(const c of cvs) f64a(c);
    u32a(curveOf);
    u32a(net.edges.map(e => e.u)); u32a(net.edges.map(e => e.v));
    i32a(net.edges.map(e => e.wi === undefined ? -1 : e.wi));
    u8a(net.edges.map(e => e.i === undefined ? 0 : 1));
    i32a(net.edges.map(e => e.i === undefined ? 0 : e.i));
    f64a(net.edges.map(e => net.z[e.u] - net.z[e.v]));
    i32a(net.edges.map(e => e.poolAt === undefined ? -1 : e.poolAt));
    i32a(net.edges.map(e => opt3(e.chokeAt))); i32a(net.edges.map(e => opt3(e.gasAt)));
    i32a(net.edges.map(e => opt3(e.liqAt))); i32a(net.edges.map(e => e.Ck === undefined ? -1 : e.Ck));
    f64a(net.edges.map(e => num0(e.diode)));
    f64a(net.edges.map(e => num0(e.bore))); f64a(net.edges.map(e => num0(e.llen)));
    f64a(net.edges.map(e => num0(e.k0))); f64a(net.edges.map(e => num0(e.hC)));
    f64a(net.edges.map(e => num0(e.cavN))); f64a(net.edges.map(e => num0(e.cavOne)));
    f64a(net.edges.map(e => num0(e.cavRelief))); f64a(net.edges.map(e => num0(e.Cc)));
    u32a(net.edges.map(e => e.gateMode === "throttle" ? (e.gateIds || []).length : 0));
    u8a(net.edges.map(e => typeof e.g === "function" ? 1 : 0));
    u8a(net.edges.map(e => typeof e.h === "function" ? 1 : 0));
    f64a(net.edges.map(e => (typeof e.g === "function" ? NaN : num0(e.g))));
    f64a(net.edges.map(e => (typeof e.h === "function" ? NaN : num0(e.h))));
    const stable = [];
    const stab = s => {
      if(s === undefined || s === null) return -1;
      let i = stable.indexOf(s);
      if(i < 0){ i = stable.length; stable.push(s); }
      return i;
    };
    i32a(net.edges.map(e => stab(e.key)));
    u8a(net.edges.map(e => e.meter === false ? 0 : 1));
    i32a(net.edges.map(e => (e.pair && e.pair.i !== undefined) ? e.pair.i : -1));
    u8a(net.edges.map(e => e.kind === "break" ? 1 : 0));
    u8a(net.edges.map(e => (e.kind === "break" && e.steam) ? 1 : 0));
    u8a(net.edges.map(e => (e.kind === "break" && e.sec) ? 1 : 0));
    u8a(net.edges.map(e => e.kind === "sgtr" ? 1 : 0));
    i32a(net.edges.map(e => e.shellOf === undefined ? -1 : stab(e.shellOf)));
    u8a(net.edges.map(e => e.shellSign === -1 ? 1 : 0));
    u8a(net.edges.map(e => e.work ? 1 : 0));
    i32a(net.edges.map(e => e.fit === undefined ? -1 : stab(e.fit)));
    f64a(Array.from(net.vol));
    u8a(net.name.map(nm => runKeyOfNode(nm) !== null ? 1 : 0));
    const gas = net.gasNodes || [], liq = net.liqNodes || [], condV = net.condV || [];
    u32(gas.length); u32a(gas); u32(liq.length); u32a(liq);
    u32(condV.length); u32a(condV);
    u8a(net.name.map((nm, i) => (net.cont || []).includes(i) ? 1 : 0));
    u32((net.cont || []).length); u32a(net.cont || []);
    const tankOrder = Object.keys(net.tankNode).map(id => net.tankNode[id]);
    u32(tankOrder.length); u32a(tankOrder);
    u8a(Object.keys(net.tankNode).map(id => (D.tanks[id] && D.tanks[id].hold) ? 1 : 0));
    const holdNodes = holdTankIds().map(id => net.tankNode[id]).filter(i => i !== undefined);
    u32(holdNodes.length); u32a(holdNodes);
    const drumNodes = drumIds().map(id => net.tankNode[id]).filter(i => i !== undefined);
    u32(drumNodes.length); u32a(drumNodes);
    const secT = (net.secT || []).slice();
    u32(secT.length); u32a(secT);
    const coreNodes = Object.values(net.coreNodes || {});
    u32(coreNodes.length); u32a(coreNodes);
    u32(net.coreNode === undefined ? 0xFFFFFFFF : net.coreNode);
    const runKeys = [];
    for(const ed of net.edges) if(ed.key && ed.meter !== false && !runKeys.includes(ed.key)) runKeys.push(ed.key);
    const coreKeys = Object.keys(net.coreNodes || {});
    const tankKeys = [];
    for(const id in net.tankNode) if(!(D.tanks[id] && D.tanks[id].hold)) tankKeys.push(id);
    const shellKeys = [];
    for(const ed of net.edges) if(ed.shellOf !== undefined && !shellKeys.includes(ed.shellOf)) shellKeys.push(ed.shellOf);
    const sgtrKeys = [];
    for(const ed of net.edges) if(ed.kind === "sgtr" && ed.key !== undefined && !sgtrKeys.includes(ed.key)) sgtrKeys.push(ed.key);
    const reliefKeys = (net.fitIds || []).filter(fid => net.fitMode[fid] === "relief");
    const byKeys = [];
    for(const ed of net.edges) if(ed.kind === "break" && ed.key !== undefined && !byKeys.includes(ed.key)) byKeys.push(ed.key);
    const tables = [runKeys, coreKeys, tankKeys, shellKeys, sgtrKeys, reliefKeys, byKeys].map(l => l.map(stab));
    for(const t of tables){ u32(t.length); i32a(t); }
    i32a(runKeys.map(k => { const v = loopOfKey(k); return v === undefined || v === null ? -1 : v; }));
    i32a(net.name.map((nm, i) => (net.coreOfNode && net.coreOfNode[i] !== undefined) ? coreKeys.indexOf(net.coreOfNode[i]) : -1));
    i32a(net.name.map((nm, i) => (net.tankIdByNode && net.tankIdByNode[i] !== undefined) ? tankKeys.indexOf(net.tankIdByNode[i]) : -1));
    i32a(net.name.map((nm, i) => (net.secTById && net.secTById[i] !== undefined) ? shellKeys.indexOf(net.secTById[i]) : -1));
    u8a(net.name.map((nm, i) => net.coreSet.has(i) ? 1 : 0));
    u32(stable.length);
    for(const s of stable) str(s);
    u32(runKeys.length); u32(coreKeys.length); u32(tankKeys.length); u32(shellKeys.length);
    u32(sgtrKeys.length); u32(reliefKeys.length); u32(byKeys.length);
  }

  function secState(s, HB, meta){
    const n = GW * GH;
    u32(SEC_F64KEYS.length);
    for(const k of SEC_F64KEYS){ str(k); f64(fnum(s[k])); }
    u32(SEC_U8KEYS.length);
    for(const k of SEC_U8KEYS){ str(k); u8(s[k] ? 1 : 0); }
    u32(0);
    u32(SEC_MAPKEYS.length);
    for(const k of SEC_MAPKEYS){
      const o = s[k] || {};
      const ks = Object.keys(o).filter(x => o[x] !== undefined);
      str(k); u32(ks.length); strsRaw(ks); f64a(ks.map(x => fnum(o[x])));
    }
    u32(SEC_BMAPKEYS.length);
    for(const k of SEC_BMAPKEYS){
      const o = s[k] || {};
      const ks = Object.keys(o).filter(x => o[x] !== undefined);
      str(k); u32(ks.length); strsRaw(ks); u8a(ks.map(x => (o[x] ? 1 : 0)));
    }
    bags(SEC_BAGKEYS.concat(["metalT"]), s, P.net.n, [["roomP", s.roomP]]);
    u32(meta.reliefIds.length);
    for(const fid of meta.reliefIds){
      str(fid);
      u8a([(s.reliefOpen && s.reliefOpen[fid] ? 1 : 0), (s.reliefAuto && s.reliefAuto[fid] ? 1 : 0),
        (s.reliefStuck && s.reliefStuck[fid] ? 1 : 0), (s.reliefArm && s.reliefArm[fid] ? 1 : 0),
        (s.reliefBlocked && s.reliefBlocked[fid] ? 1 : 0)]);
    }
    u32(meta.coreIds.length);
    for(const id of meta.coreIds){
      const cs = s.coreBy && s.coreBy[id];
      str(id); f64(cs ? fnum(cs.pCore) : NaN); f64(cs ? fnum(cs.flowNet) : NaN);
    }
    u32((s.dmgParts || []).length); strsRaw(s.dmgParts || []);
    {
      const ks = sortedKeys(s.dmgWhy);
      u32(ks.length);
      for(const k of ks){ str(k); str(s.dmgWhy[k]); }
    }
    {
      const mo = s.massOut || {};
      const mks = Object.keys(mo);
      u32(mks.length); strsRaw(mks); f64a(mks.map(k => fnum(mo[k])));
    }
    u32(Object.keys(s.massOut || {}).length); strsRaw(Object.keys(s.massOut || {}));
    f64(fnum(HB.prompt)); f64(fnum(HB.decay)); f64(fnum(HB.heat));
    f64(fnum(HB.removal)); f64(fnum(HB.dTavg));
    smap(HB.sgQBy); smap(HB.heatBy);
    {
      const ks = Object.keys(P.pumpLive || {});
      u32(ks.length); strsRaw(ks);
    }
    strmapS(P.net.burstP);
    u32((s.seed || 0) >>> 0); i32(s.rng | 0); u8(s.diceOff ? 1 : 0);
    boolmap(s.tankByp); boolmap(s.tankDump);
    u8(s.refOpen ? 1 : 0);
    f64(fnum(P.net.burstGen));
    for(const k of ["roomP", "roomWater", "roomWP", "roomPool", "roomPoolP"]){
      f64an(s[k] ? s[k] : new Array(n).fill(0));
    }
  }

  function roomState(s, meta){
    u32(ROOM_F64KEYS.length);
    for(const k of ROOM_F64KEYS){
      str(k);
      let v = s[k];
      if(v === undefined && s.burnEv && k.startsWith("burn")) v = k === "burnBlast" ? s.burnEv.blast : s.burnEv[k.slice(4).toLowerCase()];
      if(v === undefined && s.fireEv && k.startsWith("fire")) v = s.fireEv[k.slice(4).toLowerCase()];
      f64(fnum(v));
    }
    u32(ROOM_U8KEYS.length);
    for(const k of ROOM_U8KEYS){ str(k); u8(s[k] ? 1 : 0); }
    u32(ROOM_I32KEYS.length);
    for(const k of ROOM_I32KEYS){ str(k); i32(s[k] | 0); }
    u32(ROOM_MAPKEYS.length);
    for(const k of ROOM_MAPKEYS){
      const o = s[k] || {};
      const ks = Object.keys(o).filter(x => o[x] !== undefined);
      str(k); u32(ks.length); strsRaw(ks); f64a(ks.map(x => fnum(o[x])));
    }
    bags(ROOM_BAGKEYS, s, P.net.n);
    u32(meta.coreIds.length);
    for(const id of meta.coreIds){
      const cs = s.coreBy && s.coreBy[id];
      str(id);
      u8(cs && cs.breach ? 1 : 0);
      const trip = (cs && cs.trip) || "";
      u8(trip ? 1 : 0); if(trip) str(trip);
      f64(fnum(cs && cs.fatigue));
      u8(cs && cs.rodJam ? 1 : 0);
      f64(fnum(cs && cs.rodDem)); f64(fnum(cs && cs.tiltDem));
      f64an(cs && cs.rodZDem ? cs.rodZDem : []);
      f64(fnum(cs && cs.rodPos)); f64(fnum(cs && cs.tilt));
      f64an(cs && cs.rodZ ? cs.rodZ : []);
    }
    u32((s.dmgParts || []).length); strsRaw(s.dmgParts || []);
    {
      const ks = sortedKeys(s.dmgWhy);
      u32(ks.length);
      for(const k of ks){ str(k); str(s.dmgWhy[k]); }
    }
    {
      const mo = s.massOut || {};
      const mks = Object.keys(mo);
      u32(mks.length); strsRaw(mks); f64a(mks.map(k => fnum(mo[k])));
    }
    u32(Object.keys(s.massOut || {}).length); strsRaw(Object.keys(s.massOut || {}));
    f64(fnum(s.burnEv && s.burnEv.kg)); f64(fnum(s.burnEv && s.burnEv.p)); f64(fnum(s.burnEv && s.burnEv.blast));
    strsn((s.burnEv && s.burnEv.ids) || []);
    f64(fnum(s.fireEv && s.fireEv.kg)); f64(fnum(s.fireEv && s.fireEv.p)); f64(fnum(s.fireEv && s.fireEv.q));
    u32(ROOM_F64GRIDS.length);
    for(const k of ROOM_F64GRIDS){ str(k); f64an(s[k] ? s[k] : []); }
    u32(ROOM_F32GRIDS.length);
    for(const k of ROOM_F32GRIDS){ str(k); f64an(s[k] ? s[k] : []); }
  }

  function eventsState(s, meta){
    const n = meta.n;
    i32(s.tick | 0);
    for(const k of ["n", "decay", "heat", "dmg", "meltFrac", "Tf", "dnbr", "vf", "oxMax", "qOx",
      "fatigue"]) f64(fnum(s[k]));
    u8(s.scrammed ? 1 : 0); u8(s.breach ? 1 : 0); u8(s.melt ? 1 : 0);
    str(s.trip || "");
    f64(fnum(s.rodPos));
    u8(s.rodJam ? 1 : 0); u8(s.rodBand ? 1 : 0);
    f64(fnum(s.rho)); f64(fnum(s.parts && s.parts.xe));
    for(const k of ["P", "Tavg", "lvl", "sc", "cav", "h2", "injRate", "release"]) f64(fnum(s[k]));
    u8(s.blackout ? 1 : 0);
    f64(fnum(s.load)); f64(fnum(s.loadDem));
    u8(s.bkpLost ? 1 : 0); u8(s.sgtr ? 1 : 0);
    f64(fnum(s.flowNet));
    u8(s.turbTrip ? 1 : 0); u8(s.condLost ? 1 : 0);
    for(const k of ["crewDose", "dose", "doseRate", "repRate"]) f64(fnum(s[k]));
    u8(s.partySpent ? 1 : 0);
    f64(fnum(s.massRes)); f64(fnum(s.massWarn));
    i32(s.massWarnT | 0);
    for(const k of ["roomPMax", "roomBurnOn", "roomFireOn", "roomBang", "roomMax", "spinV", "spinTV"]) f64(fnum(s[k]));
    u32(s.annRev >>> 0);
    u8(s.burnEv && s.burnEv.blast ? 1 : 0);
    f64(fnum(s.burnEv && s.burnEv.kg)); f64(fnum(s.burnEv && s.burnEv.p));
    f64(fnum(s.fireEv && s.fireEv.kg)); f64(fnum(s.fireEv && s.fireEv.p)); f64(fnum(s.fireEv && s.fireEv.q));
    u8(s.repair ? 1 : 0);
    f64(fnum(s.repair && s.repair.t)); f64(fnum(s.repair && s.repair.need));
    str((s.repair && s.repair.id) || "");
    f64an(s.dec ? s.dec : []);
    strsn((s.burnEv && s.burnEv.ids) || []);
    for(const k of ["roomP", "roomT", "roomH2", "roomM", "roomVap"]){
      f64an(s[k] ? s[k] : new Array(n).fill(0));
    }
    u32(meta.coreIds.length);
    for(const id of meta.coreIds){
      const cs = s.coreBy && s.coreBy[id];
      if(!cs) throw new Error("SIMSTATE: vessel missing for " + id);
      str(id);
      for(const k of ["n", "decay", "dmg", "meltFrac"]) f64(fnum(cs[k]));
      f64an(cs.dec ? cs.dec : []);
      for(const k of ["Tf", "dnbr", "vf", "oxMax", "qOx", "fatigue"]) f64(fnum(cs[k]));
      u8(cs.scrammed ? 1 : 0); u8(cs.breach ? 1 : 0); u8(cs.melt ? 1 : 0);
      str(cs.trip || "");
      f64(fnum(cs.rodPos));
      u8(cs.rodJam ? 1 : 0); u8(cs.rodBand ? 1 : 0);
      f64(fnum(cs.rho)); f64(cs.parts ? fnum(cs.parts.xe) : NaN); f64(fnum(cs.tilt));
      f64an(cs.rodZ ? cs.rodZ : []);
      f64an(cs.rodZDem ? cs.rodZDem : []);
      f64(fnum(cs.tiltDem)); f64(fnum(cs.rodDem));
      f64(fnum(cs.rpsHot)); u8(cs.rpsNear ? 1 : 0);
    }
    smapS(s.tank);
    {
      const h = s.mBy;
      if(!h || !h.v){ u32(0); u32(0); }
      else {
        u8an(padTo(Array.from(h.has || []), h.v.length));
        f64an(h.v);
      }
    }
    smap(s.massOut || {});
    u32(Object.keys(s.massOut || {}).length); strsRaw(Object.keys(s.massOut || {}));
    strsn(s.dmgParts || []);
    {
      const ks = sortedKeys(s.dmgWhy);
      u32(ks.length);
      for(const k of ks){ str(k); str(s.dmgWhy[k]); }
    }
    smapS(s.roomCrush); smapS(s.roomHurt); smapS(s.flowPos);
    boolmap(s.ev);
    boolmap(s.annOn);
    boolmap(s.reliefOpen); boolmap(s.reliefBlocked); boolmap(s.reliefStuck); boolmap(s.reliefAuto);
    smapS(s.reliefSteam);
    boolmap(s.sgBurst);
    strsn(Object.keys(s.portShut || {}).filter(k => s.portShut[k]).sort());
    smapS(s.flowDemBy);
    smapS(s.lvlBy);
    smapS(s.scBy);
    smapS(s.TavgBy);
  }

  const CORE_NODAL = ["phi", "xI", "xX", "nTf", "nTc", "nV", "nRho", "nVt", "nTct", "nCov",
    "nFol", "nDmg", "nOx", "nMelt", "nDisp", "nDnb", "chW"];
  function coreState(s, id){
    const cs = s.coreBy && s.coreBy[id];
    const cp = a => (a ? a : []);
    for(const k of CORE_NODAL) f64an(cp(cs && cs[k]));
    f64(fnum(cs && cs.n));
    f64an(cp(cs && cs.C)); f64an(cp(cs && cs.dec));
    f64(fnum(cs && cs.decay)); f64(fnum(cs && cs.heat));
    f64(fnum(cs && cs.rodPos)); f64(fnum(cs && cs.rodDem));
    f64an(cp(cs && cs.rodZ)); f64an(cp(cs && cs.rodZDem));
    f64(fnum(cs && cs.tilt)); f64(fnum(cs && cs.tiltDem));
    u8(cs && cs.split ? 1 : 0); u8(cs && cs.reGang ? 1 : 0);
    u8(cs && cs.rodJam ? 1 : 0); u8(cs && cs.scrammed ? 1 : 0); u8(cs && cs.rodBand ? 1 : 0);
    f64(fnum(cs && cs.dnbr)); f64(fnum(cs && cs.X)); f64(fnum(cs && cs.I));
    f64(fnum(cs && cs.Tf)); f64(fnum(cs && cs.ao)); f64(fnum(cs && cs.ro));
    f64(fnum(cs && cs.hotRing)); f64(fnum(cs && cs.hotLev)); f64(fnum(cs && cs.vNode));
    f64(fnum(cs && cs.hotFlow)); f64(fnum(cs && cs.tipRho)); f64(fnum(cs && cs.TfHot));
    f64(fnum(cs && cs.dmg)); f64(fnum(cs && cs.meltFrac)); f64(fnum(cs && cs.oxMax));
    f64(fnum(cs && cs.qOx)); f64(fnum(cs && cs.fci)); f64(fnum(cs && cs.TcladHot));
    f64(fnum(cs && cs.dnbrMin)); f64(fnum(cs && cs.dnbrRing)); f64(fnum(cs && cs.dnbrLev));
    f64(fnum(cs && cs.fq)); f64(fnum(cs && cs.vf)); f64(fnum(cs && cs.voidTh));
    f64(fnum(cs && cs.coreDT));
    {
      const p = (cs && cs.parts) || {};
      f64a([p.rod, p.dop, p.mod, p.exp, p.xe, p.vd, p.tip, p.dis, p.bor].map(fnum));
    }
    f64(fnum(cs && cs.rho)); f64(fnum(cs && cs.pCore)); f64(fnum(cs && cs.flowNet));
    f64(fnum(cs && cs.fatigue));
    u8(cs && cs.melt ? 1 : 0); u8(cs && cs.breach ? 1 : 0);
    u8an(cs && cs.nTube ? cs.nTube : []);
    f64(fnum(cs && cs.tubesOpen)); u8(cs && cs.cavRelief ? 1 : 0);
  }

  const CANON_BAGS = ["mBy", "hBy", "pBy", "bBy", "h2By", "metalT"];
  function canonBags(s, n){
    for(const k of CANON_BAGS){
      const h = s[k];
      if(!h || !h.v){
        u32(n); f64a(new Array(n).fill(0)); u32(n); u8a(new Array(n).fill(0));
      } else {
        const v = h.v;
        u32(v.length); f64a(v); u32(v.length); u8a(padTo(Array.from(h.has || []), v.length));
      }
    }
  }

  function metas(){
    const C = consts();
    const sec = secMeta(C);
    curves(sec.nCirc);
    const room = roomMeta(); curves(room.nCirc);
    const events = eventsMeta();
    const cids = coreIds();
    u32(cids.length);
    for(const id of cids){ str(id); coreK(P.cores[id]); }
    solveMeta();
    transMeta();
    return { sec, room, events, coreIds: cids };
  }

  function stateHalf(meta){
    const net = P.net;
    secState(S, HEATBAL, meta.sec);
    roomState(S, meta.room);
    eventsState(S, meta.events);
    u32(meta.coreIds.length);
    for(const id of meta.coreIds){ str(id); coreState(S, id); }
    canonBags(S, net.n);
    f64an(S.blkOutV ? S.blkOutV : []);
    f64an(S.blkOutF ? S.blkOutF : []);
    f64(num(S.Tavg)); f64(num(S.dTavg));
    strmapS(S.TavgBy); strmapS(S.dTavgBy);
    {
      const F = net.F;
      for(const f of ["p", "rho", "x", "b", "rhoD", "rhoG", "rhoL"]) f64a(F[f]);
      u8a(F.wet); u8a(F.void);
      for(const f of ["mu", "lp", "lh", "lm"]) f64a(F[f]);
    }
    f64a(net.wArr ? net.wArr : new Array(net.edges.length).fill(0));
    f64a(net.fixV ? net.fixV : new Array(net.n).fill(0));
    u8(FLOWG_CHOKE ? 1 : 0);
    for(const a of [net.stKp, net.stKh, net.stKm, net.stP0, net.stC]) f64a(a ? a : new Array(net.n).fill(0));
    {
      const pc = net.pc || null;
      const of = pc && pc.of ? pc.of : [];
      const live = pc && pc.live ? pc.live : [];
      u32(of.length); i32a(of);
      u32(pc && pc.n !== undefined ? pc.n : 0);
      u32(live.length); u8a(live);
    }
    str(String((P.net && P.net.AfTopo) || ""));
    {
      const q = S.inject;
      const ok = q && q.kind !== undefined && q.rate && typeof q.target === "number";
      u8(ok ? 1 : 0);
      if(ok){ u8({ heat: 0, gas: 1, fluid: 2, h2: 3, o2: 4, steam: 5 }[q.kind] || 0); f64(q.rate); i32(q.target); }
    }
    u32(roomCgIt); u32(roomPGen);
    f64an(gsX || []); f64an(gsDisp || []);
    /* lines already in LOG never cross: the engine only appends */
    u32(LOG.length);
    for(let i = 0; i < LOG.length; i++){ u8(LOG_HELD); u32(0xFFFFFFFF); u32(0); }
    u32(S.tick >>> 0);
    {
      const scr = (net.scr) || {};
      const fv = k => (scr[k] ? scr[k] : new Array(net.n).fill(0));
      f64an(fv("feedInHV")); u8an(fv("feedInHM")); f64an(fv("feedInMV")); u8an(fv("feedInMM"));
      f64an(fv("coreInHV")); u8an(fv("coreInHM"));
      /* read back at the next tick's head, before the transport refills them */
      const arr = k => (scr[k] ? scr[k] : []);
      f64(advectOutPri); f64(advectOutSec);
      f64an(advectLandedBy ? advectLandedBy : []);
      f64an(advectEdgeKg ? advectEdgeKg : []);
      f64an(arr("outKgV")); u8an(arr("outKgM")); f64an(arr("outH2V")); u8an(arr("outH2M"));
    }
    str(String(net.pcSig || ""));
    f64(net.natTick || 0);
    f64an(net.natPBy ? net.natPBy.v : []); u8an(net.natPBy ? net.natPBy.has : []);
    f64an(net.natLoop ? net.natLoop : []);
    u8an(net.fixMask ? net.fixMask : []); u32(net.fixGen | 0);
  }

  function reader(b){
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), dec = new TextDecoder();
    let o = 0;
    const r = {
      u8: () => b[o++],
      u32: () => { const v = dv.getUint32(o, true); o += 4; return v; },
      i32: () => { const v = dv.getInt32(o, true); o += 4; return v; },
      f64: () => { const v = dv.getFloat64(o, true); o += 8; return v; },
      str: () => { const n = r.u32(), s = dec.decode(b.subarray(o, o + n)); o += n; return s; },
      f64a: n => { const a = new Array(n); for(let i = 0; i < n; i++) a[i] = r.f64(); return a; },
      u8a: n => { const a = Array.from(b.subarray(o, o + n)); o += n; return a; },
      i32a: n => { const a = new Array(n); for(let i = 0; i < n; i++) a[i] = r.i32(); return a; },
      strs: n => { const a = new Array(n); for(let i = 0; i < n; i++) a[i] = r.str(); return a; },
      f64an: () => r.f64a(r.u32()),
      u8an: () => r.u8a(r.u32()),
      strsn: () => r.strs(r.u32()),
      at: () => o,
    };
    return r;
  }

  /* Written back in place: the renderer and the recorder hold these objects. A leaf the writer
     printed as NaN or 0 because it was absent stays absent, and a leaf keeps its JS type. */
  const absent = v => v === undefined || v === null;
  const putNum = (o, k, v) => {
    if(!o) return;
    const c = o[k];
    if(absent(c)){ if(!Number.isNaN(v)) o[k] = v; return; }
    o[k] = typeof c === "boolean" ? v !== 0 : v;
  };
  const putBool = (o, k, b) => {
    if(!o) return;
    const c = o[k];
    if(absent(c)){ if(b) o[k] = true; return; }
    o[k] = typeof c === "number" ? (b ? 1 : 0) : b;
  };
  const putStr = (o, k, v) => { if(o && !(absent(o[k]) && v === "")) o[k] = v; };
  const putArr = (o, k, a) => {
    if(!o) return;
    const c = o[k];
    if(absent(c)){ if(a.length) o[k] = Float64Array.from(a); return; }
    if(c.length === a.length){
      if(ArrayBuffer.isView(c)) c.set(a); else for(let i = 0; i < a.length; i++) c[i] = a[i];
      return;
    }
    if(ArrayBuffer.isView(c)) o[k] = new c.constructor(a);
    else { c.length = 0; for(const v of a) c.push(v); }
  };
  const putList = (o, k, a) => {
    const c = o[k];
    if(absent(c)){ if(a.length) o[k] = a; return; }
    c.length = 0; for(const v of a) c.push(v);
  };
  const putMap = (o, k, keys, vals, bool) => {
    if(!o) return;
    let m = o[k];
    if(absent(m)){ if(!keys.length) return; m = o[k] = {}; }
    const on = new Set(keys);
    for(const x of Object.keys(m)) if(!on.has(x) && m[x] !== undefined) delete m[x];
    for(let i = 0; i < keys.length; i++){
      const x = keys[i], c = m[x], v = vals[i];
      if(bool) m[x] = typeof c === "number" ? (v ? 1 : 0) : !!v;
      else m[x] = typeof c === "boolean" ? v !== 0 : v;
    }
  };
  const putStrMap = (o, k, keys, vals) => {
    let m = o[k];
    if(absent(m)){ if(!keys.length) return; m = o[k] = {}; }
    const on = new Set(keys);
    for(const x of Object.keys(m)) if(!on.has(x)) delete m[x];
    for(let i = 0; i < keys.length; i++) m[keys[i]] = vals[i];
  };
  const putBag = (o, k, v, has) => {
    const c = o[k];
    if(absent(c) || !c.v){
      if(v.some(x => x !== 0) || has.some(x => x)) o[k] = { v: Float64Array.from(v), has: Uint8Array.from(has) };
      return;
    }
    putArr(c, "v", v); putArr(c, "has", has);
  };

  const rMapF = r => { const n = r.u32(), ks = [], vs = []; for(let i = 0; i < n; i++){ ks.push(r.str()); vs.push(r.f64()); } return [ks, vs]; };
  const rMapB = r => { const n = r.u32(), ks = [], vs = []; for(let i = 0; i < n; i++){ ks.push(r.str()); vs.push(r.u8() !== 0); } return [ks, vs]; };
  const rMapS = r => { const n = r.u32(), ks = [], vs = []; for(let i = 0; i < n; i++){ ks.push(r.str()); vs.push(r.str()); } return [ks, vs]; };
  const rSmap = r => { const n = r.u32(), ks = r.strs(n); return [ks, r.f64a(n)]; };
  const rMassOut = (r, s) => { const [ks, vs] = rSmap(r); r.strsn(); putMap(s, "massOut", ks, vs, false); };
  const rBags = (r, s, grids) => {
    for(let i = 0, n = r.u32(); i < n; i++){
      const k = r.str(), v = r.f64an(), has = r.u8an();
      if(grids.has(k)) putArr(s, k, v); else putBag(s, k, v, has);
    }
  };
  const RELIEF_CELL = ["reliefOpen", "reliefAuto", "reliefStuck", "reliefArm", "reliefBlocked"];
  const putCell = (s, name, fid, b) => {
    if(absent(s[name])){ if(!b) return; s[name] = {}; }
    putBool(s[name], fid, b);
  };
  const putEv = (s, k, fields, ids) => {
    const vals = Object.values(fields);
    if(absent(s[k])){
      if(vals.every(Number.isNaN) && !(ids && ids.length)) return;
      s[k] = ids ? { ...fields, ids } : { ...fields };
      return;
    }
    for(const f in fields) putNum(s[k], f, fields[f]);
    if(ids) putList(s[k], "ids", ids);
  };

  function applySec(r, s, HB){
    for(let i = 0, n = r.u32(); i < n; i++){ const k = r.str(); putNum(s, k, r.f64()); }
    for(let i = 0, n = r.u32(); i < n; i++){ const k = r.str(); putBool(s, k, r.u8() !== 0); }
    for(let i = 0, n = r.u32(); i < n; i++){ r.str(); r.str(); }
    for(let i = 0, n = r.u32(); i < n; i++){ const k = r.str(), [ks, vs] = rSmap(r); putMap(s, k, ks, vs, false); }
    for(let i = 0, n = r.u32(); i < n; i++){ const k = r.str(), m = r.u32(); putMap(s, k, r.strs(m), r.u8a(m), true); }
    rBags(r, s, new Set(["roomP"]));
    for(let i = 0, n = r.u32(); i < n; i++){
      const fid = r.str(), b = r.u8a(5);
      RELIEF_CELL.forEach((name, j) => putCell(s, name, fid, b[j] !== 0));
    }
    for(let i = 0, n = r.u32(); i < n; i++){
      const cs = s.coreBy && s.coreBy[r.str()];
      putNum(cs, "pCore", r.f64()); putNum(cs, "flowNet", r.f64());
    }
    putList(s, "dmgParts", r.strsn());
    { const [ks, vs] = rMapS(r); putStrMap(s, "dmgWhy", ks, vs); }
    rMassOut(r, s);
    for(const k of ["prompt", "decay", "heat", "removal", "dTavg"]) putNum(HB, k, r.f64());
    { const [ks, vs] = rSmap(r); putMap(HB, "sgQBy", ks, vs, false); }
    { const [ks, vs] = rSmap(r); putMap(HB, "heatBy", ks, vs, false); }
    { const ids = r.strsn(); if(ids.length){ const live = P.pumpLive || (P.pumpLive = {}); for(const id of ids) live[id] = 1; } }
    { const [ks, vs] = rMapF(r); putMap(P.net, "burstP", ks, vs, false); }
    putNum(s, "seed", r.u32()); putNum(s, "rng", r.i32()); putBool(s, "diceOff", r.u8() !== 0);
    { const [ks, vs] = rMapB(r); putMap(s, "tankByp", ks, vs, true); }
    { const [ks, vs] = rMapB(r); putMap(s, "tankDump", ks, vs, true); }
    putBool(s, "refOpen", r.u8() !== 0);
    putNum(P.net, "burstGen", r.f64());
    for(const k of ["roomP", "roomWater", "roomWP", "roomPool", "roomPoolP"]) putArr(s, k, r.f64an());
  }

  const EV_OF = { burnKg: ["burnEv", "kg"], burnP: ["burnEv", "p"], burnBlast: ["burnEv", "blast"],
    fireKg: ["fireEv", "kg"], fireP: ["fireEv", "p"], fireQ: ["fireEv", "q"] };
  function applyRoom(r, s){
    for(let i = 0, n = r.u32(); i < n; i++){
      const k = r.str(), v = r.f64(), ev = EV_OF[k];
      if(s[k] === undefined && ev && s[ev[0]]) putNum(s[ev[0]], ev[1], v);
      else putNum(s, k, v);
    }
    for(let i = 0, n = r.u32(); i < n; i++){ const k = r.str(); putBool(s, k, r.u8() !== 0); }
    for(let i = 0, n = r.u32(); i < n; i++){ const k = r.str(); putNum(s, k, r.i32()); }
    for(let i = 0, n = r.u32(); i < n; i++){ const k = r.str(), [ks, vs] = rSmap(r); putMap(s, k, ks, vs, false); }
    rBags(r, s, new Set());
    for(let i = 0, n = r.u32(); i < n; i++){
      const cs = s.coreBy && s.coreBy[r.str()];
      putBool(cs, "breach", r.u8() !== 0);
      putStr(cs, "trip", r.u8() ? r.str() : "");
      putNum(cs, "fatigue", r.f64());
      putBool(cs, "rodJam", r.u8() !== 0);
      putNum(cs, "rodDem", r.f64()); putNum(cs, "tiltDem", r.f64());
      putArr(cs, "rodZDem", r.f64an());
      putNum(cs, "rodPos", r.f64()); putNum(cs, "tilt", r.f64());
      putArr(cs, "rodZ", r.f64an());
    }
    putList(s, "dmgParts", r.strsn());
    { const [ks, vs] = rMapS(r); putStrMap(s, "dmgWhy", ks, vs); }
    rMassOut(r, s);
    const burn = { kg: r.f64(), p: r.f64(), blast: r.f64() }, ids = r.strsn();
    putEv(s, "burnEv", burn, ids);
    putEv(s, "fireEv", { kg: r.f64(), p: r.f64(), q: r.f64() });
    for(let g = 0; g < 2; g++)
      for(let i = 0, n = r.u32(); i < n; i++){ const k = r.str(); putArr(s, k, r.f64an()); }
  }

  function applyEvents(r, s){
    putNum(s, "tick", r.i32());
    for(const k of ["n", "decay", "heat", "dmg", "meltFrac", "Tf", "dnbr", "vf", "oxMax", "qOx", "fatigue"]) putNum(s, k, r.f64());
    for(const k of ["scrammed", "breach", "melt"]) putBool(s, k, r.u8() !== 0);
    putStr(s, "trip", r.str());
    putNum(s, "rodPos", r.f64());
    putBool(s, "rodJam", r.u8() !== 0); putBool(s, "rodBand", r.u8() !== 0);
    putNum(s, "rho", r.f64()); putNum(s.parts, "xe", r.f64());
    for(const k of ["P", "Tavg", "lvl", "sc", "cav", "h2", "injRate", "release"]) putNum(s, k, r.f64());
    putBool(s, "blackout", r.u8() !== 0);
    putNum(s, "load", r.f64()); putNum(s, "loadDem", r.f64());
    putBool(s, "bkpLost", r.u8() !== 0); putBool(s, "sgtr", r.u8() !== 0);
    putNum(s, "flowNet", r.f64());
    putBool(s, "turbTrip", r.u8() !== 0); putBool(s, "condLost", r.u8() !== 0);
    for(const k of ["crewDose", "dose", "doseRate", "repRate"]) putNum(s, k, r.f64());
    putBool(s, "partySpent", r.u8() !== 0);
    putNum(s, "massRes", r.f64()); putNum(s, "massWarn", r.f64());
    putNum(s, "massWarnT", r.i32());
    for(const k of ["roomPMax", "roomBurnOn", "roomFireOn", "roomBang", "roomMax", "spinV", "spinTV"]) putNum(s, k, r.f64());
    putNum(s, "annRev", r.u32());
    r.u8();
    const burn = { kg: r.f64(), p: r.f64() };
    const fire = { kg: r.f64(), p: r.f64(), q: r.f64() };
    const rep = r.u8() !== 0, rt = r.f64(), rn = r.f64(), rid = r.str();
    if(rep){ if(!s.repair) s.repair = { id: rid, t: rt, need: rn }; else { s.repair.id = rid; s.repair.t = rt; s.repair.need = rn; } }
    else if(s.repair) s.repair = null;
    putArr(s, "dec", r.f64an());
    putEv(s, "burnEv", burn, r.strsn());
    putEv(s, "fireEv", fire);
    for(const k of ["roomP", "roomT", "roomH2", "roomM", "roomVap"]) putArr(s, k, r.f64an());
    for(let i = 0, n = r.u32(); i < n; i++){
      const cs = s.coreBy && s.coreBy[r.str()];
      for(const k of ["n", "decay", "dmg", "meltFrac"]) putNum(cs, k, r.f64());
      putArr(cs, "dec", r.f64an());
      for(const k of ["Tf", "dnbr", "vf", "oxMax", "qOx", "fatigue"]) putNum(cs, k, r.f64());
      for(const k of ["scrammed", "breach", "melt"]) putBool(cs, k, r.u8() !== 0);
      putStr(cs, "trip", r.str());
      putNum(cs, "rodPos", r.f64());
      putBool(cs, "rodJam", r.u8() !== 0); putBool(cs, "rodBand", r.u8() !== 0);
      putNum(cs, "rho", r.f64()); putNum(cs && cs.parts, "xe", r.f64()); putNum(cs, "tilt", r.f64());
      putArr(cs, "rodZ", r.f64an()); putArr(cs, "rodZDem", r.f64an());
      putNum(cs, "tiltDem", r.f64()); putNum(cs, "rodDem", r.f64());
      putNum(cs, "rpsHot", r.f64()); putBool(cs, "rpsNear", r.u8() !== 0);
    }
    { const [ks, vs] = rSmap(r); putMap(s, "tank", ks, vs, false); }
    { const has = r.u8an(), v = r.f64an(); putBag(s, "mBy", v, has); }
    rMassOut(r, s);
    putList(s, "dmgParts", r.strsn());
    { const [ks, vs] = rMapS(r); putStrMap(s, "dmgWhy", ks, vs); }
    for(const k of ["roomCrush", "roomHurt", "flowPos"]){ const [ks, vs] = rSmap(r); putMap(s, k, ks, vs, false); }
    for(const k of ["ev", "annOn", "reliefOpen", "reliefBlocked", "reliefStuck", "reliefAuto"]){
      const [ks, vs] = rMapB(r); putMap(s, k, ks, vs, true); }
    { const [ks, vs] = rSmap(r); putMap(s, "reliefSteam", ks, vs, false); }
    { const [ks, vs] = rMapB(r); putMap(s, "sgBurst", ks, vs, true); }
    {
      const shut = new Set(r.strsn());
      if(shut.size && absent(s.portShut)) s.portShut = {};
      if(s.portShut){
        for(const k of Object.keys(s.portShut)) if(s.portShut[k] && !shut.has(k)) s.portShut[k] = false;
        for(const k of shut) s.portShut[k] = true;
      }
    }
    for(const k of ["flowDemBy", "lvlBy", "scBy", "TavgBy"]){ const [ks, vs] = rSmap(r); putMap(s, k, ks, vs, false); }
  }

  const CORE_PARTS = ["rod", "dop", "mod", "exp", "xe", "vd", "tip", "dis", "bor"];
  const CORE_F64 = ["dnbr", "X", "I", "Tf", "ao", "ro", "hotRing", "hotLev", "vNode", "hotFlow", "tipRho", "TfHot",
    "dmg", "meltFrac", "oxMax", "qOx", "fci", "TcladHot", "dnbrMin", "dnbrRing", "dnbrLev", "fq", "vf", "voidTh", "coreDT"];
  function applyCore(r, cs){
    for(const k of CORE_NODAL) putArr(cs, k, r.f64an());
    putNum(cs, "n", r.f64());
    putArr(cs, "C", r.f64an()); putArr(cs, "dec", r.f64an());
    for(const k of ["decay", "heat", "rodPos", "rodDem"]) putNum(cs, k, r.f64());
    putArr(cs, "rodZ", r.f64an()); putArr(cs, "rodZDem", r.f64an());
    putNum(cs, "tilt", r.f64()); putNum(cs, "tiltDem", r.f64());
    for(const k of ["split", "reGang", "rodJam", "scrammed", "rodBand"]) putBool(cs, k, r.u8() !== 0);
    for(const k of CORE_F64) putNum(cs, k, r.f64());
    const pv = r.f64a(9);
    if(cs && (cs.parts || pv.some(v => !Number.isNaN(v)))){
      const p = cs.parts || (cs.parts = {});
      CORE_PARTS.forEach((k, j) => putNum(p, k, pv[j]));
    }
    for(const k of ["rho", "pCore", "flowNet", "fatigue"]) putNum(cs, k, r.f64());
    putBool(cs, "melt", r.u8() !== 0); putBool(cs, "breach", r.u8() !== 0);
    putArr(cs, "nTube", r.u8an());
    putNum(cs, "tubesOpen", r.f64()); putBool(cs, "cavRelief", r.u8() !== 0);
  }

  function applyTail(r, s){
    const net = P.net, n = net.n, ne = net.edges.length;
    putArr(s, "blkOutV", r.f64an()); putArr(s, "blkOutF", r.f64an());
    putNum(s, "Tavg", r.f64()); putNum(s, "dTavg", r.f64());
    { const [ks, vs] = rMapF(r); putMap(s, "TavgBy", ks, vs, false); }
    { const [ks, vs] = rMapF(r); putMap(s, "dTavgBy", ks, vs, false); }
    const F = net.F;
    for(const f of ["p", "rho", "x", "b", "rhoD", "rhoG", "rhoL"]) putArr(F, f, r.f64a(n));
    putArr(F, "wet", r.u8a(n)); putArr(F, "void", r.u8a(n));
    for(const f of ["mu", "lp", "lh", "lm"]) putArr(F, f, r.f64a(n));
    putArr(net, "wArr", r.f64a(ne));
    putArr(net, "fixV", r.f64a(n));
    FLOWG_CHOKE = r.u8() !== 0;
    for(const k of ["stKp", "stKh", "stKm", "stP0", "stC"]) putArr(net, k, r.f64a(n));
    {
      const of = r.i32a(r.u32()), npc = r.u32(), live = r.u8an();
      const pc = net.pc;
      const same = pc && pc.live && pc.live.length === live.length && live.every((v, e) => pc.live[e] === v);
      if(pc){ putArr(pc, "of", of); pc.n = npc; putArr(pc, "live", live); }
      else if(of.length) net.pc = { of: Int32Array.from(of), n: npc, live: Uint8Array.from(live), adj: [] };
      if(net.pc && !same){
        const adj = net.pc.adj || (net.pc.adj = []);
        for(let i = 0; i < n; i++){ const a = adj[i]; if(a) a.length = 0; }
        for(let e = 0; e < ne; e++){
          if(!live[e]) continue;
          const ed = net.edges[e];
          (adj[ed.u] || (adj[ed.u] = [])).push(ed.v);
          (adj[ed.v] || (adj[ed.v] = [])).push(ed.u);
        }
      }
    }
    net.AfTopo = divSig = r.str();
    if(r.u8()){ r.u8(); r.f64(); r.i32(); }
    roomCgIt = r.u32(); roomPGen = r.u32();
    { const a = r.f64an(); if(gsX) putArr({ gsX }, "gsX", a); }
    { const a = r.f64an(); if(gsDisp) putArr({ gsDisp }, "gsDisp", a); }
    const log = [];
    for(let i = 0, m = r.u32(); i < m; i++){ const sev = r.u8(), code = r.u32(), ids = r.strsn(); if(sev !== LOG_HELD) log.push([code, ids]); }
    putNum(s, "tick", r.u32());
    const into = (k, Ctor, a) => { const t = scratch(net, k, a.length, Ctor, 0); t.set(a); return t; };
    into("feedInHV", Float64Array, r.f64an()); into("feedInHM", Uint8Array, r.u8an());
    into("feedInMV", Float64Array, r.f64an()); into("feedInMM", Uint8Array, r.u8an());
    into("coreInHV", Float64Array, r.f64an()); into("coreInHM", Uint8Array, r.u8an());
    advectOutPri = r.f64(); advectOutSec = r.f64();
    { const a = r.f64an(); advectLandedBy = a.length ? into("advLanded", Float64Array, a) : null; }
    { const a = r.f64an(); advectEdgeKg = a.length ? into("advEdgeKg", Float64Array, a) : null; }
    into("outKgV", Float64Array, r.f64an()); into("outKgM", Uint8Array, r.u8an());
    into("outH2V", Float64Array, r.f64an()); into("outH2M", Uint8Array, r.u8an());
    net.pcSig = r.str();
    net.natTick = r.f64();
    { const v = r.f64an(), has = r.u8an(); net.natPBy = v.length ? { v: Float64Array.from(v), has: Uint8Array.from(has) } : null; }
    { const a = r.f64an(); net.natLoop = a.length ? Float64Array.from(a) : null; }
    { const a = r.u8an(); net.fixMask = a.length ? Uint8Array.from(a) : null; }
    net.fixGen = r.u32();
    return log;
  }

  /* the inverse of state(): every leaf the bytes carry lands back in S and the sidecars */
  function applyState(bytes){
    const r = reader(bytes), s = S;
    applySec(r, s, HEATBAL);
    applyRoom(r, s);
    applyEvents(r, s);
    for(let i = 0, n = r.u32(); i < n; i++){ const id = r.str(); applyCore(r, s.coreBy && s.coreBy[id]); }
    for(const k of CANON_BAGS){ const v = r.f64an(), has = r.u8an(); putBag(s, k, v, has); }
    const log = applyTail(r, s);
    if(r.at() !== bytes.length) throw new Error("SIMSTATE.apply: read " + r.at() + " of " + bytes.length + " bytes");
    /* the plant-level mirrors of the vessels are derived, not carried */
    coreAgg(s);
    for(const [code, ids] of log) logEv(code, s, ids);
  }

  return {
    VERSION,
    apply: applyState,
    meta: w => run(w, metas),
    state: (w, meta) => run(w, () => stateHalf(meta)),
    ingest: w => run(w, () => { u32(1); u32(VERSION); const m = metas(); stateHalf(m); return m; }),
    secState: (w, s, HB, meta) => run(w, () => secState(s, HB, meta)),
    roomState: (w, s, meta) => run(w, () => roomState(s, meta)),
    eventsState: (w, s, meta) => run(w, () => eventsState(s, meta)),
    coreState: (w, s, id) => run(w, () => coreState(s, id)),
    canonBags: (w, s, n) => run(w, () => canonBags(s, n)),
  };
})();
