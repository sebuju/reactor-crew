"use strict";
// UI API, ids in and plain values out, never called by the tick: uiIx uiPart uiCore uiWrecked uiDmgWhy uiPortShut uiPortOpen uiPortWrecked uiTankLvl uiTankP uiTankOpen uiTankPoolPct uiSecP uiBoilerP uiBoilerLvl uiLoopP uiTavg uiNode uiNodeP uiNodeT uiNodeX uiNodeRho uiNodeH uiNodeKg uiRunKgs uiPumpFlow uiPumpDem uiPumpQ uiCav uiReliefOpen uiReliefBlocked uiReliefAnyOpen uiReliefAnyStuck uiReliefP uiReliefKgs uiValve uiValveDem uiCondP uiCondT uiCwIn uiCondRej uiRadT uiRadRej uiIhxQ uiPartTemp uiPartSkin uiPartFloodLine uiAnnRow uiAnnLit uiAnnOnPartTo uiAnnLamp uiCtlLive uiSinkDriver uiSinkWired uiBlkOut uiBlkOn uiBlkIn uiBlkKnob uiBlkLabel uiBlkBlame uiBlkSinkOff uiRpsState uiTripNear uiResetVeto uiTripText uiRepair uiInject uiSig uiRadSrc uiDmgIds uiRunHoled uiBlkTable uiAt uiRho uiScal uiDecBands uiInvKg uiFlowPri uiPumpDrive uiSgTemp uiStageInT uiStageOutT uiReliefRate uiFitBoreK uiReliefFullRate uiPortShutMap uiShellsLive uiCwOut uiTankRuleAnySec uiTankLive uiRoomPAt uiRodWorth uiFuelStages uiCoreView; plant scalars are ST.sc[SC_<NAME>], per-instance fields ST.<field>[uiIx(kind,id)], per-core ST.cs<Field>[uiCore(id)], room cells eRoom*(cell)

const uiIx = (kind, id) => { const m = IX && IX[kind]; if(!m || id == null) return -1; const i = m.get(id); return i === undefined ? -1 : i; };
const uiPart = id => uiIx("part", id);
const uiCore = id => uiIx("core", id);
const uiOr = v => v === v ? v : undefined;

const uiWrecked = id => ST ? eWrecked(uiPart(id)) : false;
const uiDmgWhy = id => { const a = uiPart(id); return a >= 0 && ST.dmgBy[a] ? (E_TXT_WHY[ST.dmgWhy[a]] || "WRECKED") : "WRECKED"; };
const uiPortShut = pid => { const o = uiIx("port", pid); return o >= 0 && ST.portShut[o] === 1; };
const uiPortOpen = pid => !uiPortShut(pid);
const uiPortWrecked = pid => { if(!ST) return false;
  const o = uiIx("port", pid);
  return o >= 0 ? eWrecked(PT.portPart[o]) : uiWrecked("port:"+pid); };

const uiTankLvl = id => { const t = uiIx("tank", id); return t < 0 ? undefined : eTankLvl(t); };
const uiTankP = id => { const t = uiIx("tank", id); return t < 0 ? undefined : eTankP(t); };
const uiTankOpen = id => { const t = uiIx("tank", id); return t >= 0 && eTankOpen(t); };
function uiTankPoolPct(ids){ let c = 0, m = 0;
  for(const id of ids){ const t = uiIx("tank", id); if(t < 0) continue;
    const k = PT.tankKg[t]; c += k; m += Math.max(0, Math.min(100, eTankLvl(t)))/100*k; }
  return c > 0 ? 100*m/c : 0; }

const uiSecP = id => { const g = uiIx("sg", id); return g < 0 ? undefined : eSecP(g); };
const uiBoilerP = id => { const b = uiIx("boiler", id); return b < 0 ? undefined : eBoilerP(b); };
const uiBoilerLvl = id => { const b = uiIx("boiler", id); return b < 0 ? undefined : eBoilerLvl(b); };
const uiLoopP = ci => eLoopP(ci);
const uiTavg = ci => eTavgOf(ci);

const uiNode = nid => uiIx("node", nid);
const uiNodeP = nid => { const i = uiNode(nid); return i < 0 ? undefined : uiOr(ST.pBy[i]); };
const uiNodeH = nid => { const i = uiNode(nid); return i < 0 ? undefined : uiOr(ST.hBy[i]); };
const uiNodeKg = nid => { const i = uiNode(nid); return i < 0 ? undefined : uiOr(ST.mBy[i]); };
const uiNodeT = nid => { const i = uiNode(nid); return i < 0 || !(ST.hBy[i] === ST.hBy[i]) ? undefined : uiOr(eNodeT(i)); };
const uiNodeX = nid => { const i = uiNode(nid); return i < 0 || !(ST.hBy[i] === ST.hBy[i]) ? undefined : uiOr(eNodeX(i)); };
const uiNodeRho = nid => { const i = uiNode(nid); return i < 0 || !(ST.hBy[i] === ST.hBy[i]) ? undefined : uiOr(eNodeRho(i)); };

/* kg/s a run carried last tick, off the transport's own edge book (state, so a viewer has it too) */
let uiKeyEdgePT = null, uiKeyEdge = null;
function uiRunKgs(key){
  const k = uiIx("key", key); if(k < 0) return undefined;
  if(uiKeyEdgePT !== PT){ uiKeyEdgePT = PT; uiKeyEdge = new Int32Array(PT.n.key).fill(-1);
    for(let e=0;e<PT.n.edge;e++){ const q = PT.edKey[e]; if(q >= 0 && PT.edMeter[e] && uiKeyEdge[q] < 0) uiKeyEdge[q] = e; } }
  const e = uiKeyEdge[k];
  return e < 0 ? 0 : ST.edgeKg[e]/0.02;
}

const uiPumpFlow = id => { const p = uiIx("pump", id); return p < 0 ? 0 : ST.flowBy[p]; };
const uiPumpDem = id => { const p = uiIx("pump", id); return p < 0 ? 0 : ST.flowDemBy[p]; };
const uiPumpQ = id => { const p = uiIx("pump", id); return p < 0 ? 0 : ST.pumpQBy[p]; };
const uiCav = id => { const p = uiIx("pump", id); return p < 0 ? 0 : ST.cavP[p]; };

const uiReliefOpen = fid => { const v = uiIx("relief", fid); return v >= 0 && ST.reliefOpen[v] === 1; };
const uiReliefBlocked = fid => { const v = uiIx("relief", fid); return v >= 0 && ST.reliefBlocked[v] === 1; };
const uiReliefAnyOpen = () => !!(ST && eReliefAny(false));
const uiReliefAnyStuck = () => !!(ST && eReliefAny(true));
const uiReliefP = fid => { const f = uiIx("fit", fid); return f < 0 ? undefined : eSigRead(eSigCode("fitp"), f); };
/* {kgs: steam passed, pct: % of loop inventory per second} */
const uiReliefKgs = fid => { const v = uiIx("relief", fid); return v < 0 ? {kgs:0, pct:0} : {kgs:ST.reliefSteam[v], pct:ST.reliefVent[v]}; };
const uiValve = fid => { const w = uiIx("throttle", fid); return w < 0 ? 1 : ST.valve[w]; };
const uiValveDem = fid => { const w = uiIx("throttle", fid); return w < 0 ? 1 : ST.valveDem[w]; };

const uiCondP = () => eCondP();
const uiCondT = id => { const q = uiIx("cond", id); return q < 0 ? undefined : eCondTAt(q); };
const uiCwIn = id => { const q = uiIx("cond", id); return q < 0 ? undefined : eCwInAt(q); };
const uiCondRej = id => { const q = uiIx("cond", id); return q < 0 ? 0 : eCondRej(q); };
const uiRadT = id => { const r = uiIx("rad", id); return r < 0 ? RAD_TDES : ST.radTBy[r]; };
const uiRadRej = id => { const r = uiIx("rad", id); return r < 0 ? 0 : eRadRej(r); };
const uiIhxQ = id => { const x = uiIx("ihx", id); return x < 0 ? 0 : ST.ihxQBy[x]; };

const uiPartTemp = id => { const a = uiPart(id); return a < 0 ? undefined : uiOr(ePartTemp(a)); };
const uiPartSkin = id => { const a = uiPart(id); return a < 0 ? undefined : uiOr(ePartSkin(a)); };
const uiPartFloodLine = id => { const a = uiPart(id); return a < 0 ? NaN : ePartFloodLine(a); };

/* annunciators: rows of ANN, by name or by the part they light on */
const uiAnnRow = name => { for(let r=0;r<ANN.length;r++) if(ANN[r][0] === name) return r; return -1; };
const uiAnnLit = name => { const r = uiAnnRow(name); return !!ST && r >= 0 && ST.annOn[r] === 1; };
const UI_ANN_SEV = {red:0, amber:1, blue:2};
const uiAnnHit = (r, c, p, id) => { const a = ANN[r];
  if(!ST.annOn[r]) return false;
  if(a[4] === "core" || a[4] === "rods") return c >= 0 && !!p && p.role === a[4] && (PT.annCore[r] ? eAnnCore(r, c) : true);
  const host = typeof a[4] === "function" ? a[4]() : a[4];
  return !!host && id.startsWith(host); };
// fills out[0..n) most severe first, stable, and returns n: the caller's array is never emptied, since that frees its store
function uiAnnOnPartTo(out, id){
  if(!ST) return 0;
  const c = uiCore(coreOf(id)), p = partOf(id);
  let n = 0;
  for(let r=0;r<ANN.length;r++) if(uiAnnHit(r, c, p, id)){
    const a = ANN[r], s = UI_ANN_SEV[a[1]];
    let i = n++;
    while(i > 0 && UI_ANN_SEV[out[i-1][1]] > s){ out[i] = out[i-1]; i--; }
    out[i] = a; }
  return n;
}
// uiAnnOnPartTo()'s first row without the list: every machine asks it every frame
function uiAnnLamp(id){
  if(!ST) return null;
  const c = uiCore(coreOf(id)), p = partOf(id);
  let a = null;
  for(let r=0;r<ANN.length;r++) if(uiAnnHit(r, c, p, id) && (!a || UI_ANN_SEV[ANN[r][1]] < UI_ANN_SEV[a[1]])) a = ANN[r];
  return a ? (a[1] === "red" ? C.red : a[1] === "amber" ? C.amber : C.blue) : null; }

/* the cabinet */
const uiCtlLive = () => !!ST && eCtlLive();
const uiBlk = id => uiIx("block", id);
const uiArgIx = (scope, argId) => argId == null ? -1 : eBlkArgIndex(scope, argId);
function uiSinkWired(sink, argId, onOnly){
  const code = eSinkCode(sink); if(code < 0 || !ST) return null;
  const k = eSinkWired(code, uiArgIx(SINK[sink].scope, argId), !!onOnly);
  return k >= 0 ? IX.blockId[k] : null; }
const uiSinkDriver = (sink, argId) => uiSinkWired(sink, argId, true);
const uiBlkOut = id => { const k = uiBlk(id); return k < 0 ? undefined : ST.blkOutV[k]; };
const uiBlkOn = id => { const k = uiBlk(id); return k >= 0 && ST.blkOn[k] === 1; };
const uiBlkIn = (id, slot) => { const k = uiBlk(id); if(k < 0) return null; const u = ST.blkIn[k*3+slot]; return u >= 0 ? IX.blockId[u] : null; };
/* a knob as the bench authors it: a signal, sink or op by name, an instance by id, a blank as null */
function uiBlkKnob(id, name){
  const k = uiBlk(id), q = E_KN_NAMES.indexOf(name);
  if(k < 0 || q < 0) return D.blocks[id] ? D.blocks[id][name] : undefined;
  const v = ST.blkKn[k*E_KN_N+q], mode = E_BLK_MODES[PT.blkMode[k]];
  if(name === "sig") return E_SIG_KEYS[v];
  if(name === "sink") return E_SINK_KEYS[v];
  if(name === "op"){ const l = E_OPS[mode]; return l ? l[v] : undefined; }
  if(name === "arg"){ if(!(v >= 0)) return null;
    const src = mode === "source" ? SIGNAL[uiBlkKnob(id, "sig")] : SINK[uiBlkKnob(id, "sink")], scope = src ? src.scope : "plant";
    switch(scope){
      case "core": return IX.coreId[v]; case "sg": return IX.boilerId[v]; case "pump": return IX.pumpId[v];
      case "fit": return IX.fitId[v]; case "tank": return IX.tankId[v]; case "rpsch": return RPS_CH[v] ? RPS_CH[v][0] : null;
      case "loop": return String(v); }
    return null; }
  return v === v ? v : null;
}
/* the label on a wire: the signal's own name and unit where one forces it, the block's kind otherwise */
function uiBlkLabel(id, live){
  const b = D.blocks[id]; if(!b) return {lab:id, u:""};
  const L = live !== false && !!ST && uiBlk(id) >= 0;
  if(b.mode === "source"){ const k = L ? uiBlkKnob(id, "sig") : b.sig, r = SIGNAL[k]; return {lab:r?r.lab:k, u:r?r.u:""}; }
  if(b.mode === "sink"){ const k = L ? uiBlkKnob(id, "sink") : b.sink, r = SINK[k]; return {lab:r?r.lab:k, u:r?r.u:""}; }
  const up = L ? [0,1,2].map(i => uiBlkIn(id, i)).find(x => x) : b.in.find(x => x), m = BLK[b.mode];
  const op = L ? uiBlkKnob(id, "op") : b.op, kk = L ? uiBlkKnob(id, "k") : b.k;
  const keeps = b.mode==="limit"||b.mode==="lag"||b.mode==="sel"||b.mode==="latch"
    ||(b.mode==="math"&&(op==="add"||op==="sub"||op==="min"||op==="max")&&kk===1);
  if(up && keeps) return {lab:m.lab, u:uiBlkLabel(up, live).u};
  return {lab:m?m.lab:b.mode, u:""};
}
/* the live cabinet in D.blocks' shape: wiring, on and every knob off the state, the rest off the drawing */
function uiBlkTable(){
  if(!ST || !PT) return null;
  const o = {};
  for(let k=0;k<PT.n.block;k++){ const id = IX.blockId[k], b = D.blocks[id]; if(!b) continue;
    const m = BLK[b.mode], v = Object.assign({}, b, {in:(m ? m.ins : []).map((_,i) => uiBlkIn(id, i)), on:uiBlkOn(id)});
    if(m) for(const q in m.knobs) if(E_KN_NAMES.indexOf(q) >= 0) v[q] = uiBlkKnob(id, q);
    o[id] = v; }
  return o;
}
const uiBlkBlame = id => { const k = uiBlk(id); if(k < 0) return ""; const w = eBlkBlame(k); return w >= 0 ? nameFor(IX.blockId[w], "") : ""; };
function uiBlkSinkOff(sink){
  const code = eSinkCode(sink);
  for(let k=0;k<PT.n.block;k++)
    if(PT.blkMode[k] === E_BM_SINK && ST.blkKn[k*E_KN_N+E_KN_SINK] === code && ST.blkOn[k]) act("blkOn", k);
}

/* protection */
const uiRpsState = () => { const s = eRpsState(); return s === E_RPS_NONE ? "NOT FITTED" : s === E_RPS_ARMED ? "ARMED" : "BYPASSED"; };
const uiTripNear = () => { const w = ST ? eTripNear() : 0; return w > 0 ? nameFor(IX.blockId[w-1], "") : null; };
const uiResetVeto = () => { const v = eResetVeto(); return v === -1 ? "" : v >= 0 ? nameFor(IX.blockId[v], IX.blockId[v].toUpperCase()) : "PROTECTION"; };
/* why a core (or, with no id, the plant) is tripped, "" when it is not */
function uiTripText(cid){
  const c = uiCore(cid), code = c >= 0 ? ST.csTrip[c] : ST.sc[SC_TRIP], arg = c >= 0 ? ST.csTripArg[c] : ST.sc[SC_TRIPARG];
  const t = E_TXT_TRIP[code] || "";
  return code === E_TRIP_RPS ? t + (arg >= 0 ? nameFor(IX.blockId[arg], "") : "") : t;
}

/* the two orders in flight */
const uiRepair = () => { const sc = ST.sc, a = sc[SC_REPA];
  return a >= 0 ? {id:IX.partId[a], t:sc[SC_REPT], need:sc[SC_REPNEED]} : null; };
const UI_INJ = ["", "heat", "gas", "fluid", "h2", "o2", "steam"];
const uiInject = () => { const sc = ST.sc, k = sc[SC_INJKIND];
  if(!k) return null;
  const n = sc[SC_INJNODE];
  return {kind:UI_INJ[k], rate:sc[SC_INJDEM], target:n >= 0 ? IX.nodeId[n] : sc[SC_INJCELL]}; };

/* one SIGNAL row, by key and instance id */
const uiSig = (k, argId) => sigRead(k, argId);

/* every wrecked id, rebuilt once a tick or when a hit lands between ticks */
let uiDmgST = null, uiDmgT = -1, uiDmgG = -1, uiDmgList = [];
function uiWreckedIds(){
  if(!ST){ if(uiDmgList.length) uiDmgList = []; return uiDmgList; }
  const t = ST.sc[SC_TICK], g = ST.sc[SC_DMGGEN];
  if(uiDmgST === ST && uiDmgT === t && uiDmgG === g) return uiDmgList;
  uiDmgST = ST; uiDmgT = t; uiDmgG = g;
  // the same list keeps its identity, which is the whole key partWrecked() and uiRoomGeom() read
  let n = 0, same = true;
  for(let a=0;a<PT.n.part;a++) if(ST.dmgBy[a]){ if(uiDmgList[n] !== IX.partId[a]) same = false; n++; }
  if(same && n === uiDmgList.length) return uiDmgList;
  const out = [];
  for(let a=0;a<PT.n.part;a++) if(ST.dmgBy[a]) out.push(IX.partId[a]);
  return (uiDmgList = out);
}
/* a view over ST for the design-side helpers that still ask s.dmgParts beside s.room* */
let uiLiveV = null, uiLiveFor = null;
function uiLive(){
  if(!ST) return null;
  if(uiLiveFor !== ST){ uiLiveV = Object.create(ST); uiLiveFor = ST; }
  uiLiveV.dmgParts = uiWreckedIds();
  return uiLiveV;
}
// roomGeomLive() spells its damage key on every call, and the paint asks it per layer per frame
let uiRgDmg = null, uiRgBase = null, uiRgV = null;
function uiRoomGeom(){
  const L = uiLive(), G = roomGeom();
  if(!L) return G;
  if(uiRgDmg !== L.dmgParts || uiRgBase !== G){ uiRgDmg = L.dmgParts; uiRgBase = G; uiRgV = roomGeomLive(L); }
  return uiRgV;
}
/* part index per grid cell, filled as asked and dropped with the build: the paint asks per painted cell per frame */
let uiMatIx = null, uiMatParts = null;
const uiMatWrecked = (x, y) => {
  if(!ST) return false;
  if(x<0 || x>=GW || y<0 || y>=GH) return uiWrecked("mat:"+x+","+y);
  if(uiMatIx !== IX || uiMatParts.length !== GW*GH){ uiMatIx = IX; uiMatParts = new Int32Array(GW*GH).fill(-2); }
  const i = y*GW+x;
  if(uiMatParts[i] === -2) uiMatParts[i] = uiPart("mat:"+x+","+y);
  return eWrecked(uiMatParts[i]); };

const uiRunPortsOpen = r => uiPortOpen(r.pa) && uiPortOpen(r.pb);

/* the tick's solved field per key index (IX.keyId): kg/s (both halves' common reading) and head lost as a share of the span; NaN where no edge reads */
function uiField(byKg, byDrop){
  byKg.fill(NaN); byDrop.fill(NaN);
  if(!ST) return;
  const n = PT.n.node, E = PT.n.edge, p = ST.pBy, w = ST.edW;
  let hi = -Infinity, lo = Infinity;
  for(let i=0;i<n;i++){ const v = p[i]; if(!(v === v) || PT.nodeCont[i]) continue; if(v > hi) hi = v; if(v < lo) lo = v; }
  const span = hi - lo;
  for(let e=0;e<E;e++){ const k = PT.edKey[e]; if(k < 0) continue;
    const a = p[PT.edU[e]], b = p[PT.edV[e]];
    if(a === a && b === b){ const d = byDrop[k]; byDrop[k] = (d || 0) + (span > 0 ? Math.abs(a - b)/span : 0); }
    if(PT.edMeter[e]){ let v = w[e];
      const pr = PT.edPair[e];
      if(pr >= 0){ const u = w[pr]; v = (v >= 0) === (u >= 0) ? (Math.abs(u) < Math.abs(v) ? u : v) : 0; }
      const q = byKg[k]; byKg[k] = (q || 0) + v; } }
}
/* kg a machine holds: each node off the book that owns it */
function uiPartHoldKg(id){
  const net = P && P.net, list = net && net.nodesOfPart && net.nodesOfPart[id];
  if(!ST || !list || !list.length) return null;
  let m = 0;
  for(const i of list){ const t = PT.nodeTank[i];
    if(t >= 0 && !PT.tankField[t]) m += eTankLvl(t)/100*PT.tankKg[t];
    else { const v = ST.mBy[i]; if(v === v) m += v; } }
  return m;
}
/* the choke flag is tick scratch: in-process it is this tick's, across the worker it reads unchoked */
function uiChoked(key, part){
  if(!ST || !SX || !SX.edChoke) return false;
  const pre = part ? "comp:"+part+":" : null, bk = key ? "break:"+key : null;
  for(let e=0;e<PT.n.edge;e++){ if(!SX.edChoke[e]) continue;
    const k = PT.edKey[e] >= 0 ? IX.keyId[PT.edKey[e]] : PT.edBrk[e] >= 0 ? IX.brkId[PT.edBrk[e]] : null;
    if(k === null) continue;
    if(pre ? k.indexOf(pre) === 0 : (k === key || k === bk)) return true; }
  return false;
}
/* an opening, by its break key: % of loop inventory per second leaving, and the share that flashes at cell i */
const uiSpill = key => { const b = uiIx("brk", key); return b < 0 || !ST ? 0 : ST.spillBy[b]; };
function uiOpenFlash(key, i){
  const o = uiIx("open", key); if(o < 0 || !ST) return 1;
  const nd = eOpenFl(o); if(nd < 0) return 1;
  eFlashXA(PT.sats[PT.nodeSat[nd]], nd, i); return E_RR[RR_X];
}
/* the room's bang counter and the cell of the last one */
const uiBlastN = () => ST ? ST.sc[SC_BLASTN] : 0;
const uiBlastAt = () => ST ? ST.sc[SC_BLASTAT] : -1;

/* the live source terms in radSolve()'s shape, off the same weights eRadDose() prices */
function uiRadSrc(){
  const s = ST, sc = s.sc, core = {}, tank = {};
  for(let c=0;c<PT.n.core;c++)
    core[IX.coreId[c]] = (s.csN[c]*PROMPT_F + s.csDecay[c])*(s.csBreach[c] ? RAD_BREACH : 1)
      + RAD_DMG*s.csDmg[c]*eContRel(PT.corePart[c]) + (!P.catcher ? RAD_MELT*s.csMeltFrac[c] : 0);
  for(let t=0;t<PT.n.tank;t++) if(PT.tankHasCell[t]) tank[IX.tankId[t]] = RAD_TANK*s.tank[t]*PT.radTankAct[t];
  return {core, tank, sg:sc[SC_SGTR] ? RAD_SGTR : 0, air:RAD_AIR*sc[SC_RELEASE] + sc[SC_FPDOSE], pipe:pipeSrc(sc[SC_N])};
}
/* a run's nozzles and cells as part indices, once per run object and build: asked per run several times a frame */
const uiRunPartMemo = new WeakMap();
function uiRunHoled(r){
  if(!ST) return false;
  let e = uiRunPartMemo.get(r);
  if(!e || e.ix !== IX){
    const a = [uiPart("port:"+r.pa), uiPart("port:"+r.pb)], c = r.cells;
    if(c) for(let i=0;i<c.length;i++) a.push(uiPart("pipe:"+c[i][0]+","+c[i][1]));
    e = {ix: IX, parts: Int32Array.from(a)}; uiRunPartMemo.set(r, e); }
  const q = e.parts;
  for(let i=0;i<q.length;i++) if(eWrecked(q[i])) return true;
  return false;
}
const uiDmgIds = () => { const o = []; if(!ST) return o;
  for(let a=0;a<PT.n.part;a++) if(ST.dmgBy[a]) o.push(IX.partId[a]); return o; };

/* one field of one instance, undefined where this plant has none */
const uiAt = (field, kind, id) => { const i = uiIx(kind, id); return i < 0 || !ST ? undefined : ST[field][i]; };
const uiRho = c => { const a = c >= 0 ? ST.csParts : ST.parts, o = c >= 0 ? c*RP_N : 0;
  return {rod:a[o+RP_ROD], dop:a[o+RP_DOP], mod:a[o+RP_MOD], exp:a[o+RP_EXP], xe:a[o+RP_XE],
          bor:a[o+RP_BOR], vd:a[o+RP_VD], tip:a[o+RP_TIP], dis:a[o+RP_DIS], gr:a[o+RP_GR], sm:a[o+RP_SM]}; };
/* plant scalars under their S names, one vessel's own and its circuit's laid over them: a copy for a panel, never the state */
const UI_CS_CAP = new Set(["I","X","Tf","TfHot","TcladHot"]);
function uiScal(cid){
  const o = {}, sc = ST.sc;
  for(const r of SCHEMA) if(r[2] === "plant") o[r[0]] = sc[globalThis["SC_"+r[0].toUpperCase()]];
  o.parts = uiRho(-1); o.dec = Array.from(ST.dec);
  const c = uiCore(cid); if(c < 0) return o;
  for(const r of SCHEMA){ if(r[2] !== "core" || r[0].indexOf("cs") !== 0) continue;
    const nm = r[0].slice(2); o[UI_CS_CAP.has(nm) ? nm : nm[0].toLowerCase()+nm.slice(1)] = ST[r[0]][c]; }
  const nd = ST.dec.length, nb = PT.coreNB[c], b0 = c*PT.nbMax;
  o.parts = uiRho(c); o.dec = Array.from(ST.csDec.subarray(c*nd, c*nd+nd));
  o.rodZ = Array.from(ST.csRodZ.subarray(b0, b0+nb)); o.rodZDem = Array.from(ST.csRodZDem.subarray(b0, b0+nb));
  o.bankAuto = Array.from(ST.csBankAuto.subarray(b0, b0+nb), v => v === 1);
  const ci = PT.coreCirc[c];
  if(ci >= 0){ o.P = eLoopP(ci); o.Tavg = eTavgOf(ci);
    if(PT.circKeyed[ci]){ o.dTavg = ST.dTavgBy[ci]; o.inv = ST.invBy[ci]; o.sc = ST.scBy[ci]; } }
  return o;
}
/* decay heat in four bands of half-life, share of rating: the groups are the physics, the bands are how a panel reads them */
const UI_DEC_BANDS = [60, 3600, 86400];
function uiDecBands(cid){
  const c = uiCore(cid), a = c >= 0 ? ST.csDec : ST.dec, n = ST.dec.length, o0 = c >= 0 ? c*n : 0, out = [0,0,0,0];
  for(let g=0;g<n;g++){ const th = Math.LN2/E_DEC_L[g];
    let k = 0; while(k < UI_DEC_BANDS.length && th > UI_DEC_BANDS[k]) k++;
    out[k] += a[o0+g]; }
  return out;
}
const uiInvKg = cid => ST ? eInvNodesKg(uiCore(cid)) : 0;
function uiFlowPri(){ let t = 0, n = 0;
  for(let p=0;p<PT.n.pump;p++) if(PT.pumpPrimary[p]){ t += ST.flowBy[p]; n++; }
  return n ? t/n : 1; }
const uiPumpDrive = id => uiWrecked(id) ? 0 : uiPumpFlow(id);
const uiSgTemp = id => { const b = uiIx("boiler", id); return b < 0 ? undefined : ST.sgTBy[b]; };
const uiStage = id => { const g = uiIx("sg", id); if(g >= 0) return g; const x = uiIx("ihx", id); return x < 0 ? -1 : PT.n.sg + x; };
/* k indexes ROLE[].internal: 0 the stream giving heat up, 1 the one taking it */
const uiStageInT = (id, k) => { const st = uiStage(id); if(st < 0) return ST.sc[SC_TAVG]; eStageStream(st, k); return SX.stgT[2*st+k]; };
const uiStageOutT = (id, k) => { const IN = roleIns(partOf(id))[k], t = IN ? uiNodeT(coreFold(id+IN.b)) : undefined;
  return t === undefined ? ST.sc[SC_TAVG] : t; };
/* % of loop inventory a second the valve passes, off the solve, and what it would pass wide open at rated pressure */
const uiReliefRate = fid => { const v = uiIx("relief", fid); if(v < 0 || !ST) return 0;
  return PT.reliefSec[v] ? eInvRate(ST.reliefSteam[v]) : ST.reliefVent[v]; };
// held for the graph, since a bore edit is a dTouch(): outside a layout pass fitBoreSuggest() walks the shells on every call
const uiFitBoreK = fid => { const s = graphSlot("uiFitBoreK"); let v = s.get(fid);
  if(v === undefined){ v = fitBoreK(fid); if(!BORE_NOM) s.set(fid, v); } return v; };
const uiReliefFullRate = fid => ((P && P.fittings && P.fittings[fid]) || D.fittings[fid]) && ST
  ? Math.max(0, eInvRate(flowW(holeC(uiFitBoreK(fid)), P.rho0, P.P0, eRegionPart(uiPart(fid))))) : 0;
const uiPortShutMap = () => { const o = {}; if(!ST) return o;
  for(let k=0;k<PT.n.port;k++) if(ST.portShut[k]) o[IX.portId[k]] = true; return o; };
const uiShellsLive = fid => shellsOf(fid, portDead({portShut:uiPortShutMap()}));
function uiCwOut(id){ const q = uiIx("cond", id); if(q < 0) return RAD_TDES;
  const c = eCwC(q); return c > 0 ? eCwInAt(q) + eCondRej(q)/c : eCondTAt(q); }
const uiTankRuleAnySec = () => { for(let t=0;t<PT.n.tank;t++) if(PT.tankSec[t] && eTankRuleLive(t)) return true; return false; };
const uiTankLive = id => !uiWrecked(id) && uiTankOpen(id);
function uiRoomPAt(p){ let v = 0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH){ const q = ST.roomP[Y*GW+X]; if(q > v) v = q; }
  return v; }
function uiRodWorth(cid){ const c = uiCore(cid); if(c < 0) return 0;
  const o = c*XNN, rodA = PT.coreRodA[c], tip = PT.coreTipRho[c]; let w = 0, W = 0;
  for(let k=0;k<XNN;k++){ const f = ST.csPhi[o+k], q = nodeW[k]*f*f;
    w += q*(-rodA*ST.csNCov[o+k] + tip*ST.csNFol[o+k]); W += q; }
  return W > 0 ? w/W : 0; }
function uiFuelStages(cid){ const c = uiCore(cid), out = new Float64Array(E_FAIL_N); if(c < 0) return out;
  for(let k=0;k<XNN;k++) out[eFuelStage(c, k)] += nodeW[k];
  return out; }
/* what the core symbol draws: the live mesh while commissioned, the design's cold shape on the bench */
/* the live view is views onto the state buffer and the commissioned core's figures, so it is built once per core, buffer and commissioning; only the hot spot is refreshed. Read-only to the caller. */
const uiCoreViewMemo = new Map();
function uiCoreView(id, live){
  const c = live && ST ? uiCore(id) : -1, K = P && P.cores && P.cores[id];
  if(c >= 0 && K){
    let v = uiCoreViewMemo.get(id);
    if(!v || v.st !== ST || v.K !== K || v.core !== c){
      const o = c*XNN, sub = a => a.subarray(o, o+XNN), b0 = c*PT.nbMax;
      v = {st:ST, K, core:c, phi:sub(ST.csPhi), nV:sub(ST.csNV), xX:sub(ST.csXX), nTf:sub(ST.csNTf), rodZ:ST.csRodZ.subarray(b0, b0+K.NB),
        nDmg:sub(ST.csNDmg), nOx:sub(ST.csNOx), nMelt:sub(ST.csNMelt), nDisp:sub(ST.csNDisp),
        bankR:K.bankR, NB:K.NB, tipLen:K.tipLen, tipGap:K.tipGap, tipRho:K.tipRho, TfRef:K.TfRef, X0:K.X0,
        dia:K.coreDia, hgt:K.coreHgt, frac:K.frac, peak:{i:0, j:0},
        reflR:K.reflR, reflT:K.reflT, reflB:K.reflB, reflMat:K.reflMat};
      uiCoreViewMemo.set(id, v); }
    v.peak.i = ST.csHotRing[c]; v.peak.j = ST.csHotLev[c];
    return v; }
  const T = corePredict(coreBag(id), derived(id)), h = nodePeak(T.phiCold);
  return {core:-1, phi:T.phiCold, nV:null, xX:null, nTf:null, rodZ:null, nDmg:null, nOx:null, nMelt:null, nDisp:null,
    bankR:T.bankR, NB:T.NB, tipLen:T.tipLen, tipGap:T.tipGap, tipRho:T.tipRho, TfRef:0, X0:1,
    dia:T.coreDia, hgt:T.coreHgt, frac:T.frac, peak:{v:h[0], i:h[2], j:h[3]},
    reflR:T.reflR, reflT:T.reflT, reflB:T.reflB, reflMat:T.reflMat};
}

/* the static pressure each cell stands in: its compartment's mean, off the live field */
let uiPStat = null, uiPSumM = new Float64Array(16), uiPSumC = new Float64Array(16);
function uiRoomPStatic(){
  const N = GW*GH, R = matRegions(), n = R.regions.length, of = R.of;
  if(!uiPStat || uiPStat.length !== N) uiPStat = new Float64Array(N);
  if(!ST){ uiPStat.fill(0); return uiPStat; }
  if(uiPSumM.length < n){ uiPSumM = new Float64Array(n); uiPSumC = new Float64Array(n); }
  const m = uiPSumM.fill(0, 0, n), c = uiPSumC.fill(0, 0, n);
  for(let i=0;i<N;i++){ const r = of[i]; if(r >= 0){ m[r] += ST.roomP[i]; c[r]++; } }
  for(let i=0;i<N;i++){ const r = of[i]; uiPStat[i] = r < 0 || !c[r] ? 0 : m[r]/c[r]; }
  return uiPStat;
}
