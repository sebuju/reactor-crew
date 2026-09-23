"use strict";
/* Plant tables: the design compiled to integer-indexed columns, once per commission.
   The only place a string id becomes an index. IX.<kind> maps id to index, IX.<kind>Id back; UI only. */
let PT = null, IX = null;

const ENG_KINDS = ["pump","boiler","sg","ihx","cond","rad","tank","relief","throttle","fit","port","run","core","block","part"];

function engIndex(ids){
  const m = new Map();
  for(let i=0;i<ids.length;i++) m.set(ids[i], i);
  return m;
}

const E_SYN_RUN=0, E_SYN_COMP=1, E_SYN_BREAK=2, E_SYN_VENT=3, E_SYN_SGTR=4, E_SYN_CAV=5, E_SYN_VAP=6;
const E_FIT_TEE=0, E_FIT_THROTTLE=1, E_FIT_RELIEF=2;
const E_RULE_MANUAL=0, E_RULE_ALWAYS=1, E_RULE_SGLOW=2, E_RULE_PLOW=3;

function engPartCell(id){
  if(id.indexOf("pipe:") === 0 || id.indexOf("mat:") === 0){
    const k = id.slice(id.indexOf(":")+1), j = k.indexOf(",");
    return (+k.slice(j+1))*GW + (+k.slice(0, j)); }
  if(id.indexOf("port:") === 0){ const c = portCell(id.slice(5)); return c ? c[1]*GW + c[0] : -1; }
  const p = partOf(id);
  return p ? (p.y+((p.h/2)|0))*GW + p.x+((p.w/2)|0) : -1;
}

function engBuildNet(T){
  const net = P.net, n = net.n, es = net.edges, E = es.length, N = T.n, G = nodeGraph();
  const I32 = k => new Int32Array(k).fill(-1), F64 = k => new Float64Array(k), U8 = k => new Uint8Array(k);
  const ix = (m, id) => (id != null && m.has(id)) ? m.get(id) : -1;
  const partIx = id => ix(IX.part, id);

  const turbIds = LAY.parts.filter(p => ROLE[p.role] && ROLE[p.role].vapPath).map(p => p.id);
  IX.turb = engIndex(turbIds); IX.turbId = turbIds; N.turb = turbIds.length;
  const keys = [], brks = [];
  { const sk = new Set(), sb = new Set();
    for(const ed of es){
      if(ed.key && ed.meter !== false && !sk.has(ed.key)){ sk.add(ed.key); keys.push(ed.key); }
      if(ed.kind === "break" && ed.key !== undefined && !sb.has(ed.key)){ sb.add(ed.key); brks.push(ed.key); } } }
  IX.key = engIndex(keys); IX.keyId = keys; IX.brk = engIndex(brks); IX.brkId = brks;
  IX.node = engIndex(net.name); IX.nodeId = net.name.slice();
  N.edge = E; N.key = keys.length; N.brk = brks.length; N.loop = Math.max(1, P.loops|0);
  N.netSc = E_NS_N; N.mat = n*n;

  const sats = T.sats = [];
  const satIx = c => { let k = sats.indexOf(c); if(k < 0){ k = sats.length; sats.push(c); } return k; };
  T.satWater = satIx(SAT_WATER);
  T.coreCirc0 = G.coreCirc;
  const nc = N.circ;
  T.circSat = I32(nc); T.circCore = U8(nc); T.circKeyed = U8(nc); T.circSetP = F64(nc);
  T.circHold = I32(nc); T.circAuth = U8(nc);
  for(let ci=0;ci<nc;ci++){
    T.circSat[ci] = satIx(satOfCirc(ci)); T.circCore[ci] = G.coreCircs[ci] === 1 ? 1 : 0;
    T.circKeyed[ci] = circKey(ci) !== null ? 1 : 0; T.circSetP[ci] = holdSetP(ci);
    const h = holdOnCirc(ci); T.circHold[ci] = h.length ? ix(IX.tank, h[0]) : -1;
    T.circAuth[ci] = circAuthored(ci) ? 1 : 0; }

  const reg = matRegions();
  T.cellRegion = Int32Array.from(reg.of); N.region = Math.max(1, reg.regions.length);
  T.partCell = I32(N.part);
  for(let a=0;a<N.part;a++) T.partCell[a] = engPartCell(IX.partId[a]);

  T.nodeVol = Float64Array.from(net.vol); T.nodeZ = Float64Array.from(net.z);
  T.nodeMetalKg = Float64Array.from(net.metalKg); T.nodeMetalTau = Float64Array.from(net.metalTau);
  T.nodeMetalUA = Float64Array.from(net.metalUA);
  T.nodeVapour = Uint8Array.from(net.vapour); T.nodeTag = Uint8Array.from(net.tag);
  T.nodeComp = Int32Array.from(net.comp); T.compCirc = Int32Array.from(net.compCirc);
  T.nodeBooked = Uint8Array.from(netBooked(net));
  T.nodeCirc = I32(n); T.nodeSat = I32(n); T.nodeTank = I32(n); T.nodeCore = I32(n); T.nodeSg = I32(n);
  T.nodeBoiler = I32(n); T.nodeCondV = I32(n); T.nodeRun = I32(n); T.nodePart = I32(n); T.nodePcCell = I32(n);
  T.nodeCont = U8(n); T.nodeGas = U8(n); T.nodeLiq = U8(n); T.nodeCav = U8(n); T.nodeInCore = U8(n);
  T.nodeHoldSet = U8(n); T.nodeHoldLine = U8(n);
  for(let i=0;i<n;i++){ const nm = net.name[i];
    T.nodeCirc[i] = circOfNode(nm); T.nodeSat[i] = satIx(netSatOf(nm));
    T.nodeInCore[i] = netInCore(nm) ? 1 : 0;
    const rk = runKeyOfNode(nm); if(rk) T.nodeRun[i] = ix(IX.run, rk); }
  for(const id in net.tankIdByNode) T.nodeTank[+id] = ix(IX.tank, net.tankIdByNode[id]);
  for(const i in net.coreOfNode) T.nodeCore[+i] = ix(IX.core, net.coreOfNode[i]);
  for(const i in net.secTById) T.nodeSg[+i] = ix(IX.sg, net.secTById[i]);
  for(const i of net.cont) T.nodeCont[i] = 1;
  for(const i of (net.gasNodes||[])) T.nodeGas[i] = 1;
  for(const i of (net.liqNodes||[])) T.nodeLiq[i] = 1;
  for(const i of (net.cav||[])) T.nodeCav[i] = 1;
  T.nodeDryWatch = U8(n);
  for(const pid in net.nodesOfPart){ const a = partIx(pid), tk = !!(D.tanks && D.tanks[pid]);
    for(const i of net.nodesOfPart[pid]){ T.nodePart[i] = a; if(!tk) T.nodeDryWatch[i] = 1; } }
  for(let i=0;i<n;i++){ const c = net.contCell && net.contCell[i];
    T.nodePcCell[i] = c ? c[1]*GW + c[0] : (T.nodePart[i] >= 0 ? T.partCell[T.nodePart[i]] : -1); }
  if(typeof holdNodeSet === "function"){
    for(const nm of holdNodeSet()){ const i = net.index[nm]; if(i !== undefined) T.nodeHoldSet[i] = 1; }
    for(const nm of holdLineSet()){ const i = net.index[nm]; if(i !== undefined) T.nodeHoldLine[i] = 1; } }

  const nt = N.tank;
  T.tankNode = I32(nt); T.tankField = U8(nt); T.tankHold = U8(nt); T.tankInField = U8(nt); T.tankStores = U8(nt);
  T.tankInf = U8(nt); T.tankGas = U8(nt); T.tankKg = F64(nt); T.tankVoid = F64(nt); T.tankGasP0 = F64(nt);
  T.tankLevel0 = F64(nt); T.tankVol = F64(nt); T.tankHasCell = U8(nt); T.tankPart = I32(nt); T.tankCirc = I32(nt);
  T.tankDiscC = F64(nt); T.tankRule = I32(nt); T.tankDrum = U8(nt); T.tankCheck = U8(nt); T.tankPrimary = U8(nt);
  const hosted = [];
  for(let t=0;t<nt;t++){ const id = IX.tankId[t], d = D.tanks[id];
    const ni = net.tankNode[id]; T.tankNode[t] = ni === undefined ? -1 : ni;
    T.tankField[t] = net.tankField[id] ? 1 : 0; T.tankHold[t] = d.hold ? 1 : 0;
    T.tankInField[t] = tankInField(id) ? 1 : 0; T.tankStores[t] = tankStores(id) ? 1 : 0;
    T.tankInf[t] = d.inf ? 1 : 0; T.tankGas[t] = d.gas ? 1 : 0; T.tankKg[t] = tankKg(id);
    T.tankVoid[t] = tankVoidFrac(id); T.tankGasP0[t] = d.gas ? d.gas.p0 : 0;
    T.tankLevel0[t] = d.level; T.tankVol[t] = d.vol; T.tankHasCell[t] = d.cell ? 1 : 0;
    T.tankPart[t] = partIx(id); const tc = tankCircuit(id); T.tankCirc[t] = tc === null || tc === undefined ? -1 : tc;
    T.tankDiscC[t] = tankDiscC(id);
    T.tankRule[t] = d.auto === "always" ? E_RULE_ALWAYS : d.auto === "sglow" ? E_RULE_SGLOW : d.auto === "plow" ? E_RULE_PLOW : E_RULE_MANUAL;
    T.tankDrum[t] = isDrum(id) ? 1 : 0; T.tankCheck[t] = d.check ? 1 : 0; T.tankPrimary[t] = tankPrimary(id) ? 1 : 0;
    if(!d.cell) hosted.push(t); }
  T.hostedTanks = Int32Array.from(hosted);
  T.tankSurf = U8(nt); T.tankZb = F64(nt); T.tankHgt = F64(nt); T.edZn = new Float64Array(E).fill(NaN);
  for(let t=0;t<nt;t++){ const p = partOf(IX.tankId[t]);
    if(!p || !T.tankHasCell[t] || T.tankInField[t] || T.tankNode[t] < 0) continue;
    T.tankSurf[t] = 1; T.tankZb[t] = zRow(p.y + p.h); T.tankHgt[t] = p.h*MPC; }
  for(let e=0;e<E;e++){ const ed = es[e];
    for(const i of [ed.u, ed.v]){ const t = T.nodeTank[i];
      if(t < 0 || !T.tankSurf[t] || typeof ed.key !== "string") continue;
      const ends = runNodeEnds(ed.key); if(!ends) continue;
      for(const nm of ends) if(coreFold(nm) === net.name[i]){ const z = nodeZ(nm); if(z !== null) T.edZn[e] = z; } } }

  const np = N.pump;
  T.pumpEdge = I32(np); T.pumpHead0 = F64(np); T.pumpSuc = I32(np); T.pumpRho0 = F64(np); T.pumpPart = I32(np);
  /* a design-time figure that never moves in flight, so a build column and not a SCHEMA row */
  T.pumpNPSHr = F64(np);
  for(let p=0;p<np;p++){ const id = IX.pumpId[p];
    T.pumpHead0[p] = pumpHead(id); T.pumpPart[p] = partIx(id); T.pumpNPSHr[p] = pumpNPSH(id);
    const si = net.index[pumpSucNode(id)]; T.pumpSuc[p] = si === undefined ? -1 : si; }
  T.turbPart = I32(N.turb); T.turbEdge = I32(N.turb);
  for(let b=0;b<N.turb;b++) T.turbPart[b] = partIx(turbIds[b]);

  const nq = N.cond;
  T.condVNode = I32(nq); T.condVac = U8(nq); T.condPoolH = F64(nq); T.condPart = I32(nq); T.condVentHC = F64(nq); T.condHi = new Float64Array(Math.max(1, nq*5)).fill(NaN);
  for(let q=0;q<nq;q++){ const id = IX.condId[q], pr = partOf(id);
    const vi = net.condVById[id]; T.condVNode[q] = vi === undefined ? -1 : vi;
    if(vi !== undefined) T.nodeCondV[vi] = q;
    T.condVac[q] = condVacuum(id) ? 1 : 0; T.condPoolH[q] = Math.max(pr ? pr.h : 1, 1)*MPC;
    T.condPart[q] = partIx(id); T.condVentHC[q] = holeC(condVentBore(id)); }
  T.condFill0 = condFill0(); T.condDumpC = dutyC(condDumpKgs(), TANK_RHO);
  { const r = roleOf("cond"); T.condRoleCell = r ? engPartCell(r.id) : -1; }
  { const ex = [];
    for(const bk of (net.steamBreaks||[])) if(bk.exh) for(const c of bk.cells) ex.push(partIx("pipe:"+c[0]+","+c[1]));
    const cellKey = cs => cs.map(c => c[0]+","+c[1]).join(";");
    const exh = new Set((net.steamBreaks||[]).filter(bk => bk.exh).map(bk => cellKey(bk.cells)));
    for(const r of pipeNetwork()) if(exh.has(cellKey(r.cells))) ex.push(partIx("port:"+r.pa), partIx("port:"+r.pb));
    T.exhParts = Int32Array.from(ex.filter(a => a >= 0)); }

  const nb = N.boiler, ng = N.sg;
  T.boilerNode = I32(nb); T.boilerSg = I32(nb); T.sgBoiler = I32(ng); T.sgPart = I32(ng); T.sgShellNode = I32(ng);
  T.sgDesignP = F64(ng);
  for(let b=0;b<nb;b++){ const id = IX.boilerId[b], bi = net.index[boilerNode(id)];
    T.boilerNode[b] = bi === undefined ? -1 : bi; if(bi !== undefined && T.nodeBoiler[bi] < 0) T.nodeBoiler[bi] = b;
    T.boilerSg[b] = ix(IX.sg, id); }
  for(let g=0;g<ng;g++){ const id = IX.sgId[g];
    T.sgBoiler[g] = ix(IX.boiler, id); T.sgPart[g] = partIx(id); T.sgDesignP[g] = sgDesignP(id);
    const si = net.index[shellNode(id)]; T.sgShellNode[g] = si === undefined ? -1 : si; }

  const nf = N.fit;
  T.fitMode = I32(nf); T.fitRelief = I32(nf); T.fitThrottle = I32(nf); T.fitTarget = I32(nf);
  T.fitVentOut = U8(nf); T.fitOpenNode = I32(nf); T.fitPart = I32(nf);
  for(let f=0;f<nf;f++){ const id = IX.fitId[f], m = P.fittings[id].mode;
    T.fitMode[f] = m === "relief" ? E_FIT_RELIEF : m === "throttle" ? E_FIT_THROTTLE : E_FIT_TEE;
    T.fitRelief[f] = ix(IX.relief, id); T.fitThrottle[f] = ix(IX.throttle, id); T.fitPart[f] = partIx(id);
    T.fitTarget[f] = net.fitTarget ? ix(IX.tank, net.fitTarget[id]) : -1;
    T.fitVentOut[f] = net.fitVentOut && net.fitVentOut[id] ? 1 : 0; }
  T.reliefFit = I32(N.relief); for(let v=0;v<N.relief;v++) T.reliefFit[v] = ix(IX.fit, IX.reliefId[v]);
  T.throttleFit = I32(N.throttle); for(let w=0;w<N.throttle;w++) T.throttleFit[w] = ix(IX.fit, IX.throttleId[w]);
  T.portPart = I32(N.port); for(let o=0;o<N.port;o++) T.portPart[o] = partIx("port:"+IX.portId[o]);
  T.runNode = I32(N.run); T.runKey = I32(N.run);
  for(let u=0;u<N.run;u++){ const k = IX.runId[u], mi = net.index[runNodeOf(k)];
    T.runNode[u] = mi === undefined ? -1 : mi; T.runKey[u] = ix(IX.key, k); }

  T.edU = I32(E); T.edV = I32(E); T.edCk = I32(E); T.edSyn = I32(E); T.edC0 = F64(E); T.edBore = F64(E);
  T.edLen = F64(E); T.edK0 = F64(E); T.edHC = F64(E); T.edDiode = new Int32Array(E); T.edPump = I32(E);
  T.edChoke = I32(E); T.edGasAt = I32(E); T.edLiqAt = I32(E); T.edPoolAt = I32(E); T.edI = F64(E);
  T.edMeter = U8(E); T.edPair = I32(E); T.edKey = I32(E); T.edBrk = I32(E); T.edLoop = I32(E); T.edTank = I32(E);
  T.edEndPort = I32(E); T.edThrottle = I32(E); T.edRelief = I32(E); T.edFit = I32(E); T.edFreg = I32(E);
  T.edShell = I32(E); T.edShellSign = new Int32Array(E); T.edPart = I32(E); T.edCore = I32(E); T.edSg = I32(E);
  T.edTurb = I32(E); T.edCond = I32(E); T.edCavN = F64(E); T.edCavOne = F64(E); T.edCavRelief = F64(E);
  T.edWork = U8(E); T.edSec = U8(E); T.edSteam = U8(E); T.edDead = I32(E); T.edPairId = I32(E);
  const pairs = new Map();
  for(let e=0;e<E;e++){ const ed = es[e];
    T.edU[e] = ed.u; T.edV[e] = ed.v; T.edCk[e] = ed.Ck === undefined ? 0 : ed.Ck;
    T.edSyn[e] = ed.kind === "break" ? E_SYN_BREAK : ed.kind === "vent" ? E_SYN_VENT : ed.kind === "sgtr" ? E_SYN_SGTR
               : ed.kind === "cav" ? E_SYN_CAV : ed.kind === "vap" ? E_SYN_VAP
               : (typeof ed.key === "string" && ed.key.indexOf("comp:") === 0) ? E_SYN_COMP : E_SYN_RUN;
    T.edC0[e] = typeof ed.Cc === "number" ? ed.Cc : 0;
    T.edBore[e] = ed.bore || 0; T.edLen[e] = ed.llen || 0; T.edK0[e] = ed.k0 || 0; T.edHC[e] = ed.hC || 0;
    T.edDiode[e] = ed.diode || 0; T.edI[e] = ed.I || 0; T.edMeter[e] = ed.meter === false ? 0 : 1;
    if(ed.pump){ const p = ix(IX.pump, ed.pump); T.edPump[e] = p; if(p >= 0) T.pumpEdge[p] = e; }
    if(ed.chokeAt !== undefined) T.edChoke[e] = ed.chokeAt;
    if(ed.gasAt !== undefined) T.edGasAt[e] = ed.gasAt;
    if(ed.liqAt !== undefined) T.edLiqAt[e] = ed.liqAt;
    if(ed.poolAt !== undefined) T.edPoolAt[e] = ed.poolAt;
    if(ed.pair) T.edPair[e] = ed.pair.i;
    T.edKey[e] = ix(IX.key, ed.key); T.edBrk[e] = ed.kind === "break" ? ix(IX.brk, ed.key) : -1;
    { const l = ed.key ? loopOfKey(ed.key) : null; T.edLoop[e] = (l === null || l === undefined) ? -1 : l; }
    if(ed.tid) T.edTank[e] = ix(IX.tank, ed.tid);
    if(ed.end) T.edEndPort[e] = ix(IX.port, ed.end);
    if(ed.fit){ const f = ix(IX.fit, ed.fit); T.edFit[e] = f;
      if(f >= 0){ T.edThrottle[e] = T.fitThrottle[f]; T.edRelief[e] = T.fitRelief[f]; } }
    if(ed.freg !== undefined) T.edFreg[e] = ix(IX.boiler, ed.freg);
    if(ed.shellOf !== undefined){ T.edShell[e] = ix(IX.boiler, ed.shellOf); T.edShellSign[e] = ed.shellSign === -1 ? -1 : 1; }
    const ck = T.edCk[e];
    if(ck === 7) T.edPart[e] = partIx("pipe:"+ed.cx+","+ed.cy);
    else if(ck === 8) T.edPart[e] = partIx("port:"+ed.pid);
    else if(ed.pid !== undefined) T.edPart[e] = partIx(ed.pid);
    if(ck === 11 || ck === 13 || ck === 14) T.edCore[e] = ix(IX.core, ed.pid);
    if(ck === 6 || ck === 9) T.edSg[e] = ix(IX.sg, ed.pid);
    if(ck === 5){ const b = ix(IX.turb, ed.pid); T.edTurb[e] = b; if(b >= 0) T.turbEdge[b] = e; }
    if(ck === 10) T.edCond[e] = ix(IX.cond, ed.pid);
    if(ck === 15) T.edTank[e] = ix(IX.tank, ed.pid);
    T.edCavN[e] = ed.cavN || 0; T.edCavOne[e] = ed.cavOne || 0; T.edCavRelief[e] = ed.cavRelief || 0;
    T.edWork[e] = ed.work ? 1 : 0; T.edSec[e] = ed.sec ? 1 : 0; T.edSteam[e] = ed.steam ? 1 : 0;
    T.edDead[e] = ed.Cdead ? partIx(ed.Cdead) : -1;
    const u = ed.u, v = ed.v, pk = u < v ? u*n+v : v*n+u;
    let pi = pairs.get(pk); if(pi === undefined){ pi = pairs.size; pairs.set(pk, pi); } T.edPairId[e] = pi; }
  N.pair = Math.max(1, pairs.size);
  { const nom = P.netNom, ne = nom.edges;
    if(nom.n !== n || ne.length !== E || nom.name.some((nm, i) => nm !== net.name[i])) throw new Error("netNom is not P.net's topology");
    T.edBoreNom = F64(E); T.edK0Nom = F64(E); T.edC0Nom = F64(E);
    for(let e=0;e<E;e++){ const a = es[e], b = ne[e];
      if(a.u !== b.u || a.v !== b.v || a.Ck !== b.Ck || a.kind !== b.kind || a.key !== b.key || a.pump !== b.pump)
        throw new Error("netNom edge "+e+" is not P.net's");
      T.edBoreNom[e] = b.bore || 0; T.edK0Nom[e] = b.k0 || 0; T.edC0Nom[e] = typeof b.Cc === "number" ? b.Cc : 0; } }
  /* the reference's enthalpy: the core's circuit at its design hot/cold split, NaN elsewhere reads the structural state */
  T.nodeRefH = new Float64Array(n).fill(NaN);
  { const ci = G.coreCirc;
    if(ci >= 0){ const d = loopDesignH(ci), hf = satH(d.c, d.c.p0), hot = hotReach();
      for(let i=0;i<n;i++){ const nm = net.name[i], t = T.nodeTank[i];
        if((t >= 0 && T.tankHold[t]) || circOfNode(coreFold(nm)) !== ci || !inLoop(ci, nm)) continue;
        const rk = runKeyOfNode(nm);
        T.nodeRefH[i] = rk ? (hot.runs[rk] ? d.hOut : d.hIn) : net.coreSet.has(i) ? d.hOut
                      : t >= 0 ? (T.tankDrum[t] ? holdSeedH(ci, holdSetP(ci), T.tankLevel0[t]) : hf) : hot.nodes[nm] ? d.hOut : d.hIn; } } }
  T.adjStart = new Int32Array(n+1); T.adjEdge = new Int32Array(2*E); T.adjOther = new Int32Array(2*E);
  for(let e=0;e<E;e++){ T.adjStart[T.edU[e]+1]++; T.adjStart[T.edV[e]+1]++; }
  for(let i=0;i<n;i++) T.adjStart[i+1] += T.adjStart[i];
  { const fill = Int32Array.from(T.adjStart.subarray(0, n));
    for(let e=0;e<E;e++){ const u = T.edU[e], v = T.edV[e];
      T.adjEdge[fill[u]] = e; T.adjOther[fill[u]++] = v;
      T.adjEdge[fill[v]] = e; T.adjOther[fill[v]++] = u; } }

  T.headK = HEAD_K; T.holeBreach = holeC(BREACH_BORE);
  T.feedC = P.steamRef > 0 ? feedTrainC() : 0;
  T.loopKgFb = P.wRated*LOOP_TRANSIT;
  T.sgtrDen = ng ? Math.sqrt(2*Math.max(P.rho0||700,1)*Math.max(holdSetP(G.coreCirc) - sgDesignP(), 0.05)*1e6) : 1;
}

function engKindIds(){
  const fits = Object.keys(P.fittings);
  return {
    pump:pumpIds().slice(), boiler:boilerIds().slice(), sg:sgIds().slice(), ihx:ihxIds().slice(),
    cond:condIds().slice(), rad:radIds().slice(), tank:tankIds().slice(),
    relief:reliefFitIds().slice(), throttle:fits.filter(k=>P.fittings[k].mode==="throttle"),
    fit:fits, port:Object.keys(D.ports), run:Object.keys(P.net.byKey),
    core:coreIds().slice(), block:Object.keys(D.blocks),
    part:LAY.parts.map(p=>p.id)
      .concat(Object.keys(D.ports).map(k=>"port:"+k))
      .concat(Object.keys(D.pipes).map(k=>"pipe:"+k))
      .concat(Object.keys(D.mat||{}).map(k=>"mat:"+k)),
  };
}

/* the plant's scalar constants as one Float64Array: a double read off an object property reaches the tick boxed */
const E_PK_P = ["Pcont","P0","dose","rated","invKg0","Tref","steamRef","rpsLag","flowMin","netRef","loadMax","dnbr0",
  "bypass","turbC","TfRef","swallow","n0","flowK","backup","arLo","arHi"];
const E_PK_T = ["condFill0","condDumpC","headK","holeBreach","feedC","loopKgFb","sgtrDen","rFireRho","rFireCp","rFireBulk",
  "rSteamH","minPburst","rPanelHiT","ratedSteam","sgBypBand","cwCK","sgLiftP0","arKp","arTi","arTd"];
const PK = new Float64Array(E_PK_P.length + E_PK_T.length);
E_PK_P.concat(E_PK_T).forEach((k, i) => { globalThis["PK_"+k.toUpperCase()] = i; });
function ePkSync(){
  for(let i=0;i<E_PK_P.length;i++) PK[i] = P ? +P[E_PK_P[i]] || 0 : 0;
  for(let i=0;i<E_PK_T.length;i++) PK[E_PK_P.length+i] = PT ? +PT[E_PK_T[i]] || 0 : 0;
}

function engBuild(){
  const ids = engKindIds();
  IX = {};
  for(const k of ENG_KINDS){ IX[k] = engIndex(ids[k]); IX[k+"Id"] = ids[k]; }
  const nCore = ids.core.length;
  let nbMax = 1;
  for(const id of ids.core) nbMax = Math.max(nbMax, P.cores[id].NB);
  PT = {n:{}, nbMax, feedT:feedTOf()};
  const N = PT.n;
  for(const k of ENG_KINDS) N[k] = ids[k].length;
  N.circ = Math.max(1, nodeGraph().nCirc);
  N.cell = GW*GH;
  N.ccell = ((GW + 1) >> 1)*((GH + 1) >> 1);
  N.cband = N.ccell*(((GW + 1) >> 1) + 1);
  N.ann = ANN.length;
  N.ev = EV_N;
  N.rp = RP_N; N.decGrp = E_DEC_A.length;
  N.coreRp = nCore*RP_N; N.coreGrp = nCore*6; N.coreDec = nCore*E_DEC_A.length;
  N.coreRing = nCore*XNR; N.coreNode = nCore*XNN; N.coreBank = nCore*nbMax;
  N.node = P.net.n;
  engBuildNet(PT);
  engBuildCore(PT);
  engBuildTransport(PT);
  engBuildRoom(PT);
  engBuildMachines(PT);
  ePkSync();
  return PT;
}

/* what commissioning measures off the settled plant (P.sc0, P.vf0, K.steam) and the build read before it existed */
function engBuildPost(){
  PT.coreTprog = Float64Array.from(PT.coreTref);
  for(let c=0;c<PT.n.core;c++){ const K = P.cores[IX.coreId[c]]; PT.coreSteam[c] = K.steam ? 1 : 0; PT.coreVf0[c] = K.vf0; PT.coreCgo0[c] = K.cgo0;
    const T = ST.TavgBy[PT.coreCirc[c]]; if(PT.coreSteam[c] && T > 0) PT.coreTprog[c] = T; }
  for(let ch=0;ch<RPS_CH.length;ch++){
    PT.rpsSet[ch] = rpsSetOf(RPS_CH[ch][0], 0); PT.rpsNear[ch] = rpsSetOf(RPS_CH[ch][0], E_RPS_NEAR); }
  ePkSync();
}

function engBuildTransport(T){
  const net = P.net, n = net.n, N = T.n, G = nodeGraph();
  const I32 = k => new Int32Array(k).fill(-1), F64 = k => new Float64Array(k), U8 = k => new Uint8Array(k);
  const ni = nm => { const i = nm == null ? undefined : net.index[nm]; return i === undefined ? -1 : i; };
  const ix = (m, id) => (id != null && m.has(id)) ? m.get(id) : -1;
  N.massTerm = E_BK_N;

  const outs = [];
  { const seen = new Set();
    for(const ed of net.edges) if((ed.kind === "break" || ed.kind === "vent") && ed.key !== undefined && !seen.has(ed.key)){
      seen.add(ed.key); outs.push(ed.key); } }
  IX.out = engIndex(outs); IX.outId = outs; N.out = outs.length;
  T.edOut = I32(N.edge); T.edHole = U8(N.edge); T.edVent = U8(N.edge); T.edBreak = U8(N.edge);
  const rise = [];
  for(let e=0;e<N.edge;e++){ const ed = net.edges[e];
    if(ed.kind === "break" || ed.kind === "vent") T.edOut[e] = ix(IX.out, ed.key);
    T.edHole[e] = netHole(ed) ? 1 : 0; T.edVent[e] = ed.kind === "vent" ? 1 : 0; T.edBreak[e] = ed.kind === "break" ? 1 : 0;
    if(!T.edHole[e] && net.z[ed.u] !== net.z[ed.v]) rise.push(e); }
  T.riseE = Int32Array.from(rise); N.rise = Math.max(1, rise.length);

  T.nodeRefThru = F64(n); T.nodeInLoop = U8(n); T.nodeBookT = I32(n); T.nodeAnchHold = U8(n);
  T.nodeSeedKind = U8(n); T.nodeSeedIx = I32(n); T.nodeFillStores = F64(n).fill(1);
  for(let i=0;i<n;i++){ const nm = net.name[i];
    const r = P.netRefThru && P.netRefThru[nm]; T.nodeRefThru[i] = r > 0 ? r : 0;
    const ci = T.nodeCirc[i]; T.nodeInLoop[i] = ci >= 0 && inLoop(ci, nm) ? 1 : 0; }
  for(let t=0;t<N.tank;t++){ const i = T.tankNode[t]; if(i < 0) continue;
    if(T.nodeBooked[i] === 1) T.nodeBookT[i] = t;
    if(T.tankStores[t]) T.nodeFillStores[i] = Math.min(100, Math.max(0, T.tankLevel0[t]))/100; }

  T.tankFluidT = F64(N.tank); T.tankFluidB = F64(N.tank);
  for(let t=0;t<N.tank;t++){ const f = tankFluid(IX.tankId[t]); T.tankFluidT[t] = f.temp; T.tankFluidB[t] = f.boron || 0; }

  const hc = holdCircs();
  T.trHoldCircs = Int32Array.from(hc);
  const nc = N.circ;
  T.circPNode = I32(nc).fill(-1); T.circPHold = I32(nc); T.circPPart = I32(nc); T.circTmin = F64(nc); T.circTmax = F64(nc);
  T.circCore1 = I32(nc); T.circDrumP = U8(nc);
  for(const ci of hc){
    const h = holdOnCirc(ci)[0], own = coreOnCirc(ci)[0];
    const dr = h ? null : drumIds().find(d => tankCircuit(d) === ci);
    /* a gas-charged store states the circuit's pressure where it stands; the core sits a circulator's head off it */
    const gs = h || dr ? null : tankIds().find(id => tankInField(id) && D.tanks[id].gas && !D.tanks[id].check && tankCircuit(id) === ci);
    T.circPHold[ci] = h ? ix(IX.tank, h) : -1;
    T.circPNode[ci] = h ? ni(coreFold(h)) : dr ? ni(coreFold(dr)) : gs ? ni(coreFold(gs)) : own ? ni(coreFold(own)) : -1;
    T.circDrumP[ci] = dr ? 1 : 0;
    T.circPPart[ci] = ix(IX.part, own || primaryCore());
    T.circCore1[ci] = own ? ix(IX.core, own) : -1;
    const key = circKey(ci), K = (P.cores && P.cores[key]) || P;
    T.circTmin[ci] = K.Tmin; T.circTmax[ci] = K.Tmax; }
  T.coreNode0 = net.coreNode === undefined ? -1 : net.coreNode;
  T.coreInvKg0 = F64(N.core);

  T.boilerFeed = I32(N.boiler);
  for(let b=0;b<N.boiler;b++){ const id = IX.boilerId[b];
    T.boilerFeed[b] = ni(isDrum(id) ? (drumFeedNode(id) || coreFold(id)) : coreFold(id + roleIntern(ROLE.sg)[1].a)); }

  const stg = sgIds().concat(ihxIds());
  N.stg = Math.max(1, stg.length); T.nStg = stg.length;
  T.stgPart = I32(N.stg); T.stgSg = I32(N.stg); T.stgIhx = I32(N.stg); T.stgSgtr = U8(N.stg);
  T.stgA0 = I32(N.stg); T.stgB0 = I32(N.stg); T.stgA1 = I32(N.stg); T.stgB1 = I32(N.stg); T.stgShell = I32(N.stg);
  for(let k=0;k<stg.length;k++){ const id = stg[k], R = ROLE[partOf(id).role], INs = roleIntern(R);
    T.stgPart[k] = ix(IX.part, id); T.stgSg[k] = ix(IX.sg, id); T.stgIhx[k] = ix(IX.ihx, id); T.stgSgtr[k] = R.sgtr ? 1 : 0;
    if(INs[0]){ T.stgA0[k] = ni(id+INs[0].a); T.stgB0[k] = ni(id+INs[0].b); }
    if(INs[1]){ T.stgA1[k] = ni(id+INs[1].a); T.stgB1[k] = ni(id+INs[1].b); }
    if(R.sgtr) T.stgShell[k] = ni(shellNode(id)); }
  T.sgPrimA = I32(N.sg); T.sgPrimB = I32(N.sg); T.sgFeedFace = I32(N.sg); T.sgFeedFace2 = I32(N.sg);
  for(let g=0;g<N.sg;g++){ const id = IX.sgId[g], IN0 = roleIns(partOf(id))[0], IN1 = roleIntern(ROLE.sg)[1], fn = partFaceNode(id);
    if(IN0){ T.sgPrimA[g] = ni(coreFold(id+IN0.a)); T.sgPrimB[g] = ni(coreFold(id+IN0.b)); }
    T.sgFeedFace[g] = ni(fn[IN1.a]); T.sgFeedFace2[g] = ni(fn[IN1.b]); }

  T.condVes = I32(N.cond); T.condFaces = I32(N.cond*4);
  for(let q=0;q<N.cond;q++){ const id = IX.condId[q], fn = partFaceNode(id);
    T.condVes[q] = ni(condVesNode(id));
    T.condFaces[q*4] = ni(fn.t); T.condFaces[q*4+1] = ni(fn.r); T.condFaces[q*4+2] = ni(fn.b); T.condFaces[q*4+3] = ni(fn.l); }

  T.radNa = I32(N.rad); T.radNb = I32(N.rad); T.radFaces = I32(N.rad*4);
  { const IN = ROLE.radiator.internal;
    for(let r=0;r<N.rad;r++){ const id = IX.radId[r], fn = partFaceNode(id);
      T.radNa[r] = ni(fn[IN.a]); T.radNb[r] = ni(fn[IN.b]);
      T.radFaces[r*4] = ni(fn.t); T.radFaces[r*4+1] = ni(fn.r); T.radFaces[r*4+2] = ni(fn.b); T.radFaces[r*4+3] = ni(fn.l); } }
  T.radPartIx = I32(N.rad);
  for(let r=0;r<N.rad;r++) T.radPartIx[r] = ix(IX.part, IX.radId[r]);
  T.tankFaces = I32(N.tank*4);
  for(let t=0;t<N.tank;t++){ const fn = partFaceNode(IX.tankId[t]);
    T.tankFaces[t*4] = ni(fn.t); T.tankFaces[t*4+1] = ni(fn.r); T.tankFaces[t*4+2] = ni(fn.b); T.tankFaces[t*4+3] = ni(fn.l); }

  T.holdTanks = Int32Array.from(holdTankIds().map(id => ix(IX.tank, id)));
  T.contCav = Int32Array.from((net.cont||[]).concat(net.cav||[]));
}

function engBuildMachines(T){
  const net = P.net, N = T.n;
  const I32 = k => new Int32Array(Math.max(1, k)).fill(-1), F64 = k => new Float64Array(Math.max(1, k)), U8 = k => new Uint8Array(Math.max(1, k));
  const ix = (m, id) => (id != null && m.has(id)) ? m.get(id) : -1;
  const nodeOf = nm => { if(nm == null) return -1; const i = net.index[nm]; return i === undefined ? -1 : i; };
  const keyOf = k => ix(IX.key, k);
  const refOf = k => { const v = P.netRefByRun && P.netRefByRun[k]; return typeof v === "number" ? v : NaN; };
  const csr = (lists, n) => { const o = new Int32Array(n+1); let k = 0;
    for(let a=0;a<n;a++){ o[a] = k; k += lists[a] ? lists[a].length : 0; } o[n] = k;
    const v = new Int32Array(Math.max(1, k)); k = 0;
    for(let a=0;a<n;a++) if(lists[a]) for(const x of lists[a]) v[k++] = x;
    return [o, v]; };
  const partIx = id => ix(IX.part, id);
  const np = N.pump, nb = N.boiler, ng = N.sg, nx = N.ihx, nq = N.cond, nr = N.rad, nt = N.tank, nv = N.relief;

  T.ratedSteam = ratedSteam();
  T.sgBypBand = sgBypBand();
  { const c = roleOf("ctrl"); T.ctrlPart = c ? partIx(c.id) : -1; }
  { const t = roleOf("turb"); T.turbRolePart = t ? partIx(t.id) : -1; }
  T.turbRoleParts = Int32Array.from(LAY.parts.filter(p => p.role === "turb").map(p => partIx(p.id)).filter(a => a >= 0));

  T.pumpRotor = F64(np); T.pumpStandby = U8(np); T.pumpPrimary = U8(np); T.pumpKey = I32(np); T.pumpStart = F64(np);
  T.pumpRef0 = F64(np); if(!T.pumpRho0) T.pumpRho0 = F64(np);
  const res = [];
  for(let p=0;p<np;p++){ const id = IX.pumpId[p];
    T.pumpRotor[p] = pumpRotor(id); T.pumpStandby[p] = pumpStandby(id) ? 1 : 0;
    T.pumpPrimary[p] = primaryPump(id) ? 1 : 0; T.pumpKey[p] = keyOf(pumpEdgeKey(id));
    T.pumpStart[p] = primaryPump(id) ? startOf("flowDem", 1) : startOf(id+":pumpDem", pumpStandby(id) ? 0 : 1);
    T.pumpRef0[p] = pumpRefKgs(id);
    res[p] = pumpResOf(id).map(t => ix(IX.tank, t)).filter(t => t >= 0); }
  [T.pumpRes0, T.pumpResIx] = csr(res, np);

  T.boilerDrum = U8(nb); T.boilerCirc = I32(nb); T.boilerDesP = F64(nb);
  T.boilerTank = I32(nb); T.boilerSgKg = F64(nb);
  const gas = [];
  for(let b=0;b<nb;b++){ const id = IX.boilerId[b], dr = isDrum(id);
    T.boilerDrum[b] = dr ? 1 : 0; const bc = boilerCirc(id); T.boilerCirc[b] = bc == null ? -1 : bc;
    T.boilerDesP[b] = boilerDesignP(id);
    T.boilerTank[b] = dr ? ix(IX.tank, id) : -1; T.boilerSgKg[b] = dr ? 0 : sgMassOf(id);
    const bn = T.boilerNode[b], l = [];
    if(dr && bn >= 0) for(let e=0;e<N.edge;e++) if(T.edGasAt[e] === bn) l.push(e);
    gas[b] = l; }
  [T.boilerGas0, T.boilerGasIx] = csr(gas, nb);

  const ns = ng + nx; N.stage = Math.max(1, ns); N.stage2 = Math.max(1, 2*ns); T.nStage = ns;
  T.stageSg = I32(ns); T.stageIhx = I32(ns); T.stagePart = I32(ns); T.stageUA = F64(ns); T.stageActive = U8(ns);
  T.stageKey = I32(2*ns); T.stageRef = F64(2*ns); T.stageFaceA = I32(2*ns); T.stageFaceB = I32(2*ns);
  T.stageLoop = I32(ns); T.stageShellBurn = U8(ns);
  T.stageFire = U8(ns); T.stageWlhv = F64(ns); T.stageWh2 = F64(ns); T.stageWh2o = F64(ns); T.stageWast = F64(ns); T.stageWastMax = F64(ns);
  const nbr = [];
  for(let st=0;st<ns;st++){ const isSg = st < ng, id = isSg ? IX.sgId[st] : IX.ihxId[st-ng], pr = partOf(id);
    T.stageSg[st] = isSg ? st : -1; T.stageIhx[st] = isSg ? -1 : st - ng; T.stagePart[st] = partIx(id);
    T.stageUA[st] = isSg ? ((P.sgUABy && P.sgUABy[id]) || P.sgUA) : ihxUAOf(id);
    T.stageActive[st] = sgActive(id) ? 1 : 0;
    const lp = loopOf(id); T.stageLoop[st] = lp == null ? -1 : lp;
    const INs = pr ? roleIns(pr) : [], keys = stageKeysOf(id), own = new Set(net.nodesOfPart[id] || []);
    for(const c of (net.cont || [])) own.add(c);
    for(let k=0;k<2;k++){ const IN = INs[k], j = 2*st+k;
      T.stageKey[j] = keys[k] ? keyOf(keys[k]) : -1; T.stageRef[j] = keys[k] ? Math.abs(refOf(keys[k]) || 0) : 0;
      const list = [], mine = [];
      if(IN){ T.stageFaceA[j] = nodeOf(coreFold(id+IN.a)); T.stageFaceB[j] = nodeOf(coreFold(id+IN.b));
        for(const f of [IN.a, IN.b]){ const i = nodeOf(coreFold(id+f)); if(i < 0) continue; mine.push(i);
          for(const ed of net.edges){ if(ed.u !== i && ed.v !== i) continue;
            const o = ed.u === i ? ed.v : ed.u; if(!own.has(o) && list.indexOf(o) < 0) list.push(o); } } }
      nbr[j] = list.length ? list : mine; }
    const f = isSg ? FIRE[satOfCirc(sgPrimCirc(id)).burn] : null;
    if(f){ T.stageFire[st] = 1; T.stageWlhv[st] = f.wlhv; T.stageWh2[st] = f.wh2; T.stageWh2o[st] = f.wh2o;
      T.stageWast[st] = f.wast; T.stageWastMax[st] = f.wastMax;
      T.stageShellBurn[st] = satOfCirc(shellCirc(id)).burn ? 1 : 0; } }
  [T.stageNbr0, T.stageNbrIx] = csr(nbr, 2*ns);

  T.radKey = I32(nr); T.radRef = F64(nr); T.radNodeA = I32(nr); T.radNodeB = I32(nr); T.radUA = F64(nr);
  T.radEmA = F64(nr); T.radCap = F64(nr);
  { const IN = ROLE.radiator.internal;
    for(let r=0;r<nr;r++){ const id = IX.radId[r], k = "comp:"+id+":"+IN.a+IN.b;
      T.radKey[r] = keyOf(k); T.radRef[r] = Math.abs(refOf(k) || 0);
      T.radNodeA[r] = nodeOf(coreFold(id+IN.a)); T.radNodeB[r] = nodeOf(coreFold(id+IN.b));
      T.radUA[r] = radUAOf(id); T.radEmA[r] = radCoatOf(id).emis*SIGMA*radArea(id)/1000;
      const na = T.radNodeA[r], pw = na >= 0 && T.nodeCirc[na] >= 0 ? holdSetP(T.nodeCirc[na]) : P.Pcont || ROOM_P0/1000;
      T.radCap[r] = radMass(id)*1000*E_CP_STEEL
        + partVol(id)*rhoMixOf(SAT_WATER, pw, hOfTP(SAT_WATER, T_HULL, pw))*cpOfTP(SAT_WATER, T_HULL, pw); } }

  T.condUA = F64(nq); T.condCwRef = F64(nq); T.condPartKg = F64(nq); T.condCirc = I32(nq); T.condOut = I32(nq);
  const cw = [];
  for(let q=0;q<nq;q++){ const id = IX.condId[q], vn = T.condVNode[q];
    T.condUA[q] = condUA(id); T.condCwRef[q] = (P.cwRefBy && P.cwRefBy[id]) || 0;
    T.condPartKg[q] = partMassOf(id)*1000; T.condCirc[q] = vn >= 0 ? T.nodeCirc[vn] : -1;
    T.condOut[q] = ix(IX.out, breakKeyOf(id));
    cw[q] = cwPathsOf(id); }
  { let nw = 0; for(const l of cw) nw += l.length;
    N.cw = Math.max(1, nw); T.condCw0 = new Int32Array(nq+1); T.cwKey = I32(nw); T.cwRef = F64(nw);
    T.cwNodeA = I32(nw); T.cwNodeB = I32(nw);
    let k = 0;
    for(let q=0;q<nq;q++){ T.condCw0[q] = k; const id = IX.condId[q];
      for(const w of cw[q]){ T.cwKey[k] = keyOf(w.key); T.cwRef[k] = Math.abs(refOf(w.key) || 0);
        T.cwNodeA[k] = nodeOf(coreFold(id+w.a)); T.cwNodeB[k] = nodeOf(coreFold(id+w.b)); k++; } }
    T.condCw0[nq] = k; }
  T.cwCK = Math.log(COND_DT0/(COND_DT0 - CW_RISE));
  for(let q=0;q<nq;q++){ const a = T.condCw0[q] < T.condCw0[q+1] ? T.cwNodeA[T.condCw0[q]] : -1;
    const s = a >= 0 ? satOfCirc(T.nodeCirc[a]) : SAT_WATER, cp = isWater(s) ? cwCp() : s.cp;
    const des = T.condUA[q]/T.cwCK/cp;
    if(!(T.condCwRef[q] > 1e-6*des)) T.condCwRef[q] = 0;
    for(let k=T.condCw0[q];k<T.condCw0[q+1];k++) if(!(T.cwRef[k] > 1e-6*des)) T.cwRef[k] = 0; }

  T.turbPiped = U8(N.turb);
  for(let b=0;b<N.turb;b++){ const c = secCircuitOf(IX.turbId[b]); T.turbPiped[b] = (c.boiler && c.sink) ? 1 : 0; }

  T.reliefLift = F64(nv); T.reliefReseat = F64(nv); T.reliefSpring = U8(nv); T.reliefNode = I32(nv); T.reliefSec = U8(nv);
  T.reliefPart = I32(nv); T.reliefHasTarget = U8(nv); T.reliefStart = U8(nv); T.reliefOut = I32(nv);
  const rsh = [];
  for(let v=0;v<nv;v++){ const fid = IX.reliefId[v], set = reliefSet(fid), sh = shellsOf(fid);
    T.reliefLift[v] = set.lift; T.reliefReseat[v] = set.reseat; T.reliefSpring[v] = fitSpring(fid) ? 1 : 0;
    T.reliefNode[v] = nodeOf(reliefNodeOf(net, fid));
    T.reliefSec[v] = sh.length ? 1 : 0; T.reliefPart[v] = partIx(fid);
    T.reliefHasTarget[v] = net.fitTarget && net.fitTarget[fid] ? 1 : 0;
    T.reliefStart[v] = startOf(fid+":porvBlock", false) ? 1 : 0;
    T.reliefOut[v] = ix(IX.out, ventKeyOf(fid));
    rsh[v] = sh.map(g => ix(IX.boiler, g)).filter(b => b >= 0); }
  [T.reliefSh0, T.reliefShIx] = csr(rsh, nv);
  T.sgLiftP0 = sgLiftP();
  T.throttleStart = F64(N.throttle); T.throttleTie = U8(N.throttle);
  for(let w=0;w<N.throttle;w++){ const k = IX.throttleId[w]; T.throttleTie[w] = fitTies(k) ? 1 : 0;
    T.throttleStart[w] = startOf(k+":valve", T.throttleTie[w] ? 0 : 1); }

  T.tankSec = U8(nt); T.tankHasBurst = U8(nt); T.tankBurstAt = F64(nt); T.tankBurstRel = F64(nt); T.tankBurstDrain = F64(nt);
  T.tankAct = F64(nt); T.tankRuleSecOn = U8(nt); T.tankOut = I32(nt); T.tankHoldKW = F64(nt);
  T.tankStartOpen = U8(nt); T.tankStartDump = U8(nt); T.tankStartByp = U8(nt); T.tankHoldP = F64(nt);
  { const sec = new Set(secTankIds());
    for(let t=0;t<nt;t++){ const id = IX.tankId[t], d = D.tanks[id], b = d.burst;
      T.tankSec[t] = sec.has(id) ? 1 : 0;
      if(b){ T.tankHasBurst[t] = 1; T.tankBurstAt[t] = b.at; T.tankBurstRel[t] = b.rel || 0; T.tankBurstDrain[t] = b.drain || 0; }
      T.tankAct[t] = tankFluid(id).act || 0;
      T.tankRuleSecOn[t] = (tankSecondary(id) && d.auto !== "manual" && d.auto !== "always") ? 1 : 0;
      T.tankOut[t] = ix(IX.out, breakKeyOf(id));
      T.tankHoldKW[t] = d.hold ? E_PZR_KW_M3*tankVolOf(id) : 0;
      T.tankStartOpen[t] = startOf(id+":tankOpen", false) ? 1 : 0; T.tankStartDump[t] = startOf(id+":tankDump", false) ? 1 : 0;
      T.tankStartByp[t] = startOf(id+":tankByp", false) ? 1 : 0;
      const tc = T.tankCirc[t]; T.tankHoldP[t] = d.hold && tc >= 0 ? holdSetP(tc) : 0; } }

  const nc = N.circ;
  T.circPzrProg = F64(nc); T.circTref = F64(nc).fill(NaN); T.circScFb = I32(nc);
  for(const ci of holdCircs()){ if(ci < 0 || ci >= nc) continue;
    const hid = holdOnCirc(ci)[0], own = coreOnCirc(ci)[0];
    T.circScFb[ci] = nodeOf(coreFold(hid || own || primaryCore()));
    const K = own && P.cores && P.cores[own];
    if(K){ T.circTref[ci] = K.Tref; T.circPzrProg[ci] = holdSetP(ci)*E_PZR_PROG_K*K.pRise/K.pzrK; } }

  T.coreSteam = U8(N.core); T.coreVf0 = F64(N.core); T.coreCgo0 = F64(N.core); T.coreCavNode = I32(N.core); T.coreCavCell = I32(N.core);
  for(let c=0;c<N.core;c++){ const id = IX.coreId[c];
    T.coreSteam[c] = P.cores[id].steam ? 1 : 0; T.coreVf0[c] = P.cores[id].vf0 || 0; T.coreCgo0[c] = P.cores[id].cgo0 || 0;
    T.coreCavNode[c] = nodeOf("cav:"+id);
    const cc = net.cavCont && net.cavCont[id]; T.coreCavCell[c] = cc === undefined ? -1 : T.nodePcCell[cc]; }

  const nu = N.run, rc = [], taps = [];
  T.runBurstP = F64(nu); T.runKind = U8(nu); T.runSteamVent = U8(nu); T.runSteamDir = new Int8Array(Math.max(1, nu));
  T.runScale = F64(nu); T.runRef = F64(nu); T.runPa = I32(nu); T.runPb = I32(nu);
  for(let u=0;u<nu;u++){ const key = IX.runId[u], r = net.byKey[key];
    rc[u] = (r && r.cells ? r.cells : []).map(c => partIx("pipe:"+c[0]+","+c[1])).filter(a => a >= 0);
    T.runBurstP[u] = r && r.cells && r.cells.length ? runBurstP(r) : Infinity;
    T.runPa[u] = r ? ix(IX.port, r.pa) : -1; T.runPb[u] = r ? ix(IX.port, r.pb) : -1;
    const ref = refOf(key); T.runRef[u] = ref;
    if(r && (r.k === "steam" || r.k === "exh")){
      const bk = steamBook(key, r.k);
      T.runKind[u] = runEnds(key, r.k) ? 1 : 3;
      T.runSteamVent[u] = bk.vent ? 1 : 0; T.runSteamDir[u] = steamDir(key, r.k);
      T.runScale[u] = Math.max(1e-6, steamScale(key, r.k));
      taps[u] = bk.taps.map(f => ix(IX.relief, f)).filter(v => v >= 0); }
    else T.runKind[u] = ((net.tagByKey && net.tagByKey[key]) || ref === ref) ? 2 : 0; }
  [T.runCell0, T.runCellIx] = csr(rc, nu);
  [T.runTap0, T.runTapIx] = csr(taps, nu);

  const pt = [], pb = [];
  for(let m=0;m<T.nPaint;m++){ const i = T.paintCell[m], x = i%GW, y = (i/GW)|0, mc = D.mat[x+","+y];
    pt[m] = mc && matRow(mc.m).tight ? 1 : 0; pb[m] = matBurstP(x, y); }
  T.paintTightM = U8(T.nPaint); T.paintBurstP = F64(T.nPaint);
  for(let m=0;m<T.nPaint;m++){ T.paintTightM[m] = pt[m]; T.paintBurstP[m] = pb[m]; }
  N.paintM = Math.max(1, T.nPaint);

  engBuildCtl(T);
}

function engBuildCtl(T){
  const N = T.n, nk = N.block, ids = IX.blockId;
  N.blockIn = Math.max(1, nk*3); N.blockKnob = Math.max(1, nk*E_KN_N); N.machSc = E_MS_N; N.sel3 = 3;
  const sk = Object.keys(SIGNAL);
  if(sk.length !== E_SIG_KEYS.length || sk.some((k,i) => k !== E_SIG_KEYS[i])) throw new Error("engBuildCtl: SIGNAL rows moved");
  const sn = Object.keys(SINK);
  if(sn.length !== E_SINK_KEYS.length || sn.some((k,i) => k !== E_SINK_KEYS[i])) throw new Error("engBuildCtl: SINK rows moved");
  T.blkMode = new Int32Array(Math.max(1, nk)); T.blkNamed = new Uint8Array(Math.max(1, nk));
  for(let k=0;k<nk;k++){ const b = D.blocks[ids[k]];
    T.blkMode[k] = E_BLK_MODES.indexOf(b.mode); T.blkNamed[k] = (D.name && D.name[ids[k]]) ? 1 : 0; }
  const nch = RPS_CH.length; N.rpsCh = Math.max(1, nch);
  T.rpsSet = new Float64Array(Math.max(1, nch)); T.rpsNear = new Float64Array(Math.max(1, nch));
  for(let ch=0;ch<nch;ch++){ const r = RPS_CH[ch];
    T.rpsSet[ch] = rpsSetOf(r[0], 0); T.rpsNear[ch] = rpsSetOf(r[0], E_RPS_NEAR); }
  const tune = autorodTune(); T.arKp = tune.arKp; T.arTi = tune.arTi; T.arTd = tune.arTd;
}

function engBuildCore(T){
  const ids = IX.coreId, n = ids.length, N = T.n, F = Float64Array, I = Int32Array, NB = T.nbMax;
  N.xnr = XNR; N.xnn = XNN; N.coreO = E_CO_N; N.peak = 4; N.rad3 = 3;
  const col = (C, len) => new C(len);
  const sc = ["rated","BETA","LAM","excess","rodA","tipRho","tipLen","tipGap","poison","cr","cz","gR","gT","gB","mix",
    "hfg","dT0","riseH","dh","aHeat","G0","filmPool","xSub","xSubLo","NB","rinf","aF","aM","aX","aS","aV","KXE","gI","gX",
    "lamI","lamX","sig","gP","lamP","sigS","KSM","TfRef","Tref","X0","flowK","netRef","rodD","tmelt","tdmg","dnbr0","burstK","P0","aG","graphKg","gRk","gRi","gRf",
    "graphKgC","gRkC","gRiC","gRfC","gRkS","gRgS","spP","spRg","cpsW0","modRow","hsC","hsM","hsX","hsFN",
    "scram","rodRate","coreHgt","n0","fuelKg","pinRs","pinRg","pinRf","pinLen","cladThick","cladTfail","dp","rp","cladAl","fgInv","fgFill","fgTres"];
  for(const k of sc){ const a = col(F, n); for(let c=0;c<n;c++) a[c] = +P.cores[ids[c]][k] || 0; T["core"+k[0].toUpperCase()+k.slice(1)] = a; }
  T.coreTprog = Float64Array.from(T.coreTref);
  T.coreSat = ids.map(id => P.cores[id].sat);
  T.coreCp = col(F, n); T.coreOxid = col(Uint8Array, n); T.coreDryout = col(Uint8Array, n);
  T.coreDnbLaw = col(I, n); T.coreGas = col(Uint8Array, n); T.coreTube = col(Uint8Array, n); T.coreCladZr = col(Uint8Array, n); T.coreNoBor = col(Uint8Array, n);
  T.coreNode = col(I, n); T.coreCirc = col(I, n); T.corePart = col(I, n); T.coreRodsPart = col(I, n);
  T.coreCpsA = col(I, n).fill(-1); T.coreCpsB = col(I, n).fill(-1); T.coreCpsKey = col(I, n).fill(-1); T.coreCpsWet = col(Uint8Array, n);
  T.coreShieldLift = col(F, n); T.coreDTMax = col(F, n); T.coreSalt = col(Uint8Array, n); T.coreLoopVr = col(F, n);
  T.coreBox = col(I, n*4);
  T.corePinUA = col(F, n); T.coreGSolid = col(F, n); T.coreGGap = col(F, n); T.coreCladR = col(F, n); T.coreTgRef = col(F, n);
  T.coreNTg0 = col(F, n*XNN); T.coreNTf0 = col(F, n*XNN); T.coreNFg = col(F, n*XNN); T.coreNX0 = col(F, n*XNN);
  T.coreDnbrK = col(F, n).fill(1); T.coreKg0 = col(F, n);
  T.coreBet = col(F, n*6); T.coreLam = col(F, n*6);
  T.corePoiG = col(F, n*XNR); T.coreNPen = col(F, n*XNR); T.coreEnrRho = col(F, n*XNR); T.coreRinfW = col(F, n*XNR);
  T.coreSpR = col(F, n*XNR); T.coreSpZ = col(F, n*XNR);
  T.coreBankR = col(F, n*NB); T.coreBankW = col(F, n*NB);
  T.coreHsTab = col(F, n*HS_GRID*HS_GRID*HS_OUT);
  for(let c=0;c<n;c++){
    const id = ids[c], K = P.cores[id], p = partOf(id);
    T.coreCp[c] = K.sat.cp;
    T.coreOxid[c] = K.oxid ? 1 : 0; T.coreDryout[c] = K.dryout ? 1 : 0;
    T.coreDnbLaw[c] = K.dnbLaw === "boil" ? E_DNB_BOIL : K.dnbLaw === "temp" ? E_DNB_TEMP : E_DNB_W3;
    T.coreGas[c] = (K.sat.tc && (K.Tref > K.sat.tc || permGas(K.sat))) ? 1 : 0;
    T.coreTube[c] = K.tube ? 1 : 0;
    const ni = P.net.index[coreFold(id)];
    T.coreNode[c] = ni === undefined ? -1 : ni;
    T.coreCirc[c] = K.circ;
    T.corePart[c] = IX.part.has(id) ? IX.part.get(id) : -1;
    const rid = rodsOf(id);
    T.coreRodsPart[c] = rid && IX.part.has(rid) ? IX.part.get(rid) : -1;
    { const rp = rid && partOf(rid), IN = rp && roleIns(rp)[0], nd = f => { const i = P.net.index[coreFold(rid+f)]; return i === undefined ? -1 : i; };
      if(IN){ T.coreCpsA[c] = nd(IN.a); T.coreCpsB[c] = nd(IN.b); const k = "comp:"+rid+":"+IN.a+IN.b; T.coreCpsKey[c] = IX.key.has(k) ? IX.key.get(k) : -1; }
      T.coreCpsWet[c] = IN && T.coreCpsA[c] >= 0 && T.coreCpsB[c] >= 0 && cpsWet(coreD(id)) ? 1 : 0; }
    const cD = coreD(id);
    T.coreCladZr[c] = cladOf(cD).zr ? 1 : 0;
    T.coreNoBor[c] = COOLANT[cD.cool].boron === false ? 1 : 0; T.coreSalt[c] = fuelDissolved(cD) ? 1 : 0;
    T.coreShieldLift[c] = K.tube ? shieldLiftP(cD) : 0;
    T.coreDTMax[c] = K.dT0*8.3;
    if(p){ T.coreBox[c*4] = p.x; T.coreBox[c*4+1] = p.y; T.coreBox[c*4+2] = p.w; T.coreBox[c*4+3] = p.h; }
    for(let g=0;g<6;g++){ T.coreBet[c*6+g] = K.bet[g]; T.coreLam[c*6+g] = K.lam[g]; }
    for(let i=0;i<XNR;i++){ T.corePoiG[c*XNR+i] = K.poiG[i]; T.coreNPen[c*XNR+i] = K.nPen[i];
      T.coreEnrRho[c*XNR+i] = K.enrRho[i]; T.coreRinfW[c*XNR+i] = K.rinfW[i]; T.coreSpR[c*XNR+i] = K.spR[i]; T.coreSpZ[c*XNR+i] = K.spZ[i]; }
    for(let b=0;b<K.NB;b++){ T.coreBankR[c*NB+b] = K.bankR[b]; T.coreBankW[c*NB+b] = K.bankW[b]; }
    T.coreHsTab.set(K.hsTab, c*HS_GRID*HS_GRID*HS_OUT);
  }
  engBuildFuel(T, ids);
  /* every water node a core heats, first its own coreNode; a split tube core carries one per loop, each its share of the channels */
  { const list = []; T.coreLoop0 = col(I, n + 1);
    for(let c=0;c<n;c++){ T.coreLoop0[c] = list.length; const L = coreLoops(ids[c]);
      for(let k=0;k<L.n;k++){ const ni = P.net.index[coreLoopNode(ids[c], k)]; if(ni !== undefined) list.push(ni); } }
    T.coreLoop0[n] = list.length; T.coreLoopNode = Int32Array.from(list); }
  T.coreFpInv = col(F, n*FP_N); T.coreFpGap = col(F, n*FP_N); T.coreFpMelt = col(F, n*FP_N); T.coreNPhi0 = col(F, n*XNN);
  for(let c=0;c<n;c++){ const K = P.cores[ids[c]], a = COOLANT[coreD(ids[c]).cool], inv = coolBoils(a) ? FP_INV_BWR : FP_INV_PWR;
    for(let s=0;s<FP_N;s++){ T.coreFpInv[c*FP_N+s] = fpInvKg(K.rated, s); T.coreFpGap[c*FP_N+s] = FP_GAP[s]; T.coreFpMelt[c*FP_N+s] = inv[s]; } }
  /* a dissolved fuel's precursors spend the loop's volume over the core's outside it */
  for(let c=0;c<n;c++){ if(!T.coreSalt[c]) continue;
    let vc = 0, vl = 0; const own = new Set(T.coreLoopNode.subarray(T.coreLoop0[c], T.coreLoop0[c+1]));
    const loop = i => inLoop(T.nodeCirc[i], P.net.name[i]);
    for(let i=0;i<T.n.node;i++){ if(T.nodeCirc[i] !== T.coreCirc[c] || !loop(i)) continue;
      if(own.has(i)) vc += T.nodeVol[i]; else vl += T.nodeVol[i]; }
    for(const i of own) if(!loop(i)) vc += T.nodeVol[i];
    T.coreLoopVr[c] = vc > 0 ? vl/vc : 0; }
  engBuildRad(T);
}

/* the FUEL rows as enthalpy laws, each core as a mass-weighted mix of them, and the temperatures its h(T) steps or bends at */
function engBuildFuel(T, ids){
  const nf = FUEL.length, n = ids.length;
  T.n.fuel = nf;
  T.fuelLaw = new Int32Array(nf); T.fuelTm = new Float64Array(nf); T.fuelM = new Float64Array(nf);
  T.fuelNPh = new Int32Array(nf); T.fuelPh = new Float64Array(nf*E_FUEL_NPH*E_PH_W);
  T.fuelAl = new Float64Array(nf); T.fuelDl = new Float64Array(nf*E_FUEL_NPH);
  for(let f=0;f<nf;f++){ const r = FUEL[f], m = 1000*r.M;
    T.fuelLaw[f] = r.ph ? E_LAW_PH : E_LAW_UO2; T.fuelTm[f] = r.tmelt; T.fuelM[f] = r.M; T.fuelAl[f] = r.alpha;
    if(r.dl) T.fuelDl.set(r.dl, f*E_FUEL_NPH);
    if(!r.ph) continue;
    T.fuelNPh[f] = r.ph.length;
    let Tlo = E_T_STP, h = 0;
    for(let p=0;p<r.ph.length;p++){ const [Thi, a, b, cc, d, e, L] = r.ph[p], o = (f*E_FUEL_NPH + p)*E_PH_W;
      const F = t => (t*(a + t*(b/2 + t*(cc/3 + t*d/4))) - e/t)/m;
      T.fuelPh.set([Thi, a, b, cc, d, e, h - F(Tlo)], o);
      if(p < r.ph.length - 1){ h += F(Thi) - F(Tlo) + (L || 0)/m; Tlo = Thi; } } }
  T.coreFuelW = new Float64Array(n*nf); T.coreFuseKJ = new Float64Array(n); T.coreDispKJ = new Float64Array(n); T.coreUo2W = new Float64Array(n);
  T.coreBrkT = new Float64Array(n*E_BRK_N); T.coreBrkH = new Float64Array(n*E_BRK_N); T.coreBrkL = new Float64Array(n*E_BRK_N);
  for(let c=0;c<n;c++) engBuildFuelMix(T, c, fuelVolW(coreD(ids[c])));
}
/* one core's mix off each row's share of its fuel volume; PT must already be T */
function engBuildFuelMix(T, c, v){
  const nf = T.n.fuel, brk = new Map();
  T.coreFuseKJ[c] = 0; T.coreDispKJ[c] = 0; T.coreUo2W[c] = 0; T.coreFuelW.fill(0, c*nf, c*nf + nf);
  T.coreBrkT.fill(0, c*E_BRK_N, c*E_BRK_N + E_BRK_N); T.coreBrkL.fill(0, c*E_BRK_N, c*E_BRK_N + E_BRK_N);
  let tot = 0; for(let f=0;f<nf;f++) if(v[f] > 0) tot += v[f]*FUEL[f].rho;
  for(let f=0;f<nf;f++){ const w = tot > 0 ? v[f]*FUEL[f].rho/tot : 0, r = FUEL[f]; if(!(w > 0)) continue;
    T.coreFuelW[c*nf+f] = w; T.coreFuseKJ[c] += w*r.hfus/r.M; T.coreDispKJ[c] += w*r.disp; if(!r.ph) T.coreUo2W[c] += w;
    const add = (Tb, L) => brk.set(Tb, (brk.get(Tb) || 0) + L);
    add(r.tmelt, 0);
    if(r.ph) for(let p=0;p<r.ph.length-1;p++) add(r.ph[p][0], w*(r.ph[p][6] || 0)/(1000*r.M)); }
  const list = [...brk.keys()].sort((a, b) => a - b).slice(0, E_BRK_N);
  list.forEach((Tb, i) => { const o = c*E_BRK_N + i;
    T.coreBrkT[o] = Tb; T.coreBrkL[o] = brk.get(Tb);
    E_FU[0] = Tb; eFuelHA(c); T.coreBrkH[o] = E_FU[1]; });
}

function engBuildRad(T){
  const G = radGeom(), cells = GW*GH, nc = T.n.core, nt = T.n.tank;
  T.radCoreK = new Float64Array(nc*cells);
  for(const e of G.core){ const c = IX.core.get(e.id); if(c !== undefined) T.radCoreK.set(e.k, c*cells); }
  T.radSgK = new Float64Array(cells);
  for(const k of G.sg) for(let i=0;i<cells;i++) T.radSgK[i] += k[i];
  T.radTankK = new Float64Array(nt*cells); T.radTankHas = new Uint8Array(nt); T.radTankAct = new Float64Array(nt);
  for(const e of G.tank){ const t = IX.tank.get(e.id); if(t === undefined) continue;
    T.radTankK.set(e.k, t*cells); T.radTankHas[t] = 1; }
  for(let t=0;t<nt;t++) T.radTankAct[t] = tankFluid(IX.tankId[t]).act || 0;
  T.radPipeOn = COOLANT[priD().cool].fuelInCoolant ? 1 : 0;
  T.radPipeK = T.radPipeOn ? Float64Array.from(G.pipe) : new Float64Array(cells);
  const cr = G.crew, list = [];
  if(cr) for(let X=cr.x;X<cr.x+cr.w;X++) for(let Y=cr.y;Y<cr.y+cr.h;Y++)
    if(X>=0 && X<GW && Y>=0 && Y<GH) list.push(Y*GW+X);
  T.radCrewCells = Int32Array.from(list);
  T.radAirK = Float64Array.from(G.air);
  T.fpDoseW = new Float64Array(FP_N); for(let s=0;s<FP_N;s++) T.fpDoseW[s] = P.rated > 0 ? fpGammaW(s)/(P.rated*1e6) : 0;
}

function engBuildRoom(T){
  const N = T.n, cells = GW*GH, nP = N.part, net = P.net, G = roomGeom(), R = matRegions();
  const I32 = k => new Int32Array(k).fill(-1), F64 = k => new Float64Array(k), U8 = k => new Uint8Array(k);
  const ix = (m, id) => (id != null && m.has(id)) ? m.get(id) : -1;
  const nodeOf = nm => { const i = net.index[nm]; return i === undefined ? -1 : i; };
  const csr = (lists, n) => { const o = new Int32Array(n+1); let k = 0;
    for(let a=0;a<n;a++){ o[a] = k; k += lists[a] ? lists[a].length : 0; } o[n] = k;
    const ix2 = new Int32Array(Math.max(1, k)); k = 0;
    for(let a=0;a<n;a++) if(lists[a]) for(const v of lists[a]) ix2[k++] = v;
    return [o, ix2]; };
  N.evLatch = E_LATCH_N; N.rScal = 8;

  T.rOcc =Uint8Array.from(G.occ); T.rTight = Uint8Array.from(G.tight);
  T.rHull = Uint8Array.from(G.hull); T.rFloor = Uint8Array.from(G.floor); T.rDeck = Uint8Array.from(G.deck); T.rSide = Uint8Array.from(G.side);
  T.rStrA = new Float64Array(cells); for(let i=0;i<cells;i++) T.rStrA[i] = roomStrA(G.floor[i] + G.deck[i] + G.side[i]);
  T.rPan = Uint8Array.from(G.pan); T.rTurb = Float64Array.from(G.turb);
  T.rOwn = I32(cells);
  for(let i=0;i<cells;i++) if(G.own[i] >= 0) T.rOwn[i] = ix(IX.part, G.parts[G.own[i]].p.id);

  const paints = [];
  for(const k in (D.mat||{})){ const j = k.indexOf(","), x = +k.slice(0,j), y = +k.slice(j+1);
    if(x>=0 && x<GW && y>=0 && y<GH) paints.push([k, y*GW+x, matWall(x,y) ? 1 : 0]); }
  N.paint = Math.max(1, paints.length); T.nPaint = paints.length;
  T.paintCell = I32(N.paint); T.paintPart = I32(N.paint); T.paintTight = U8(N.paint); T.cellPaint = I32(cells);
  for(let m=0;m<paints.length;m++){ const [k, i, t] = paints[m];
    T.paintCell[m] = i; T.paintPart[m] = ix(IX.part, "mat:"+k); T.paintTight[m] = t; T.cellPaint[i] = m; }

  if(N.region === undefined) N.region = Math.max(1, R.regions.length);
  if(!T.cellRegion) T.cellRegion = Int32Array.from(R.of);
  const nr = N.region;
  T.regionRel = F64(nr).fill(1); T.regionBounded = U8(nr);
  const walls = [];
  for(const g of R.regions){ T.regionBounded[g.idx] = g.bounded ? 1 : 0; T.regionRel[g.idx] = g.rel; walls[g.idx] = g.wall; }
  [T.regWall0, T.regWallIx] = csr(walls, nr);
  T.cellAdjReg = new Int32Array(cells);
  for(let i=0;i<cells;i++){ if(!R.tight[i]) continue;
    const X = i%GW, seen = [];
    const put = j => { const r = R.of[j]; if(r >= 0 && seen.indexOf(r) < 0) seen.push(r); };
    if(X>0) put(i-1); if(X<GW-1) put(i+1); if(i>=GW) put(i-GW); if(i<cells-GW) put(i+GW);
    T.cellAdjReg[i] = seen.length; }

  const cellsOf = new Map();
  for(const q of G.parts) cellsOf.set(q.p.id, q.cells);
  const pc = [], tn = [], fn4 = [];
  T.partKind = U8(nP); T.partBox = new Int32Array(nP*4);
  T.partTherm = U8(nP); T.partThermIx = I32(nP); T.partRoomRole = U8(nP);
  T.partCook = F64(nP); T.partBlast = F64(nP); T.partPdes = F64(nP); T.partPdesMode = U8(nP);
  T.partDrown = U8(nP); T.partDmgFx = U8(nP); T.partCoreIx = I32(nP); T.partTankHold = U8(nP);
  const FXCODE = {core:1, rods:2, turb:3, cond:3, bkp:4, tank:5, sg:6};
  for(let a=0;a<nP;a++){ const id = IX.partId[a];
    const kind = id.indexOf("port:") === 0 ? 1 : id.indexOf("pipe:") === 0 ? 2 : id.indexOf("mat:") === 0 ? 3 : 0;
    T.partKind[a] = kind;
    if(kind){ const c = T.partCell ? T.partCell[a] : engPartCell(id);
      pc[a] = c >= 0 ? [c] : [];
      if(c >= 0){ T.partBox[a*4] = c%GW; T.partBox[a*4+1] = (c/GW)|0; T.partBox[a*4+2] = 1; T.partBox[a*4+3] = 1; }
      if(kind === 3) T.partCook[a] = c >= 0 ? (matTsurv(c%GW, (c/GW)|0) || 0) : 0;
      else { T.partCook[a] = PIPE_TSURV; T.partBlast[a] = PIPE_PBURST; }
      continue; }
    const p = partOf(id); if(!p) continue;
    pc[a] = cellsOf.get(id) || [];
    T.partBox[a*4] = p.x; T.partBox[a*4+1] = p.y; T.partBox[a*4+2] = p.w; T.partBox[a*4+3] = p.h;
    const Rl = ROLE[p.role], ok = fitted(p);
    if(Rl && Rl.thermal !== "none"){
      if(p.role === "sg"){ const b = ix(IX.boiler, id); if(b >= 0){ T.partTherm[a] = 1; T.partThermIx[a] = b; } }
      else if(p.role === "ihx") T.partTherm[a] = 2;
      else if(p.role === "cond"){ const q = ix(IX.cond, id); if(q >= 0){ T.partTherm[a] = 3; T.partThermIx[a] = q; } }
      else if(p.role === "radiator"){ const r = ix(IX.rad, id); if(r >= 0){ T.partTherm[a] = 4; T.partThermIx[a] = r; } }
      else T.partTherm[a] = 5; }
    const fn = partFaceNode(id), faces = [];
    for(const f of ["t","r","b","l"]){ const i = nodeOf(fn[f]); if(i >= 0) faces.push(i); }
    fn4[a] = faces;
    if(p.role === "ihx"){ const l = [];
      for(const IN of roleIns(p)){ const u = nodeOf(fn[IN.a]), v = nodeOf(fn[IN.b]);
        if(u >= 0) l.push(u); if(v >= 0) l.push(v); }
      tn[a] = l; }
    T.partRoomRole[a] = p.role === "vent" ? 1 : p.role === "inert" ? 2 : p.role === "pan" ? 3 : 0;
    if(ok){ T.partCook[a] = partTsurv(p) || 0; T.partBlast[a] = partPburst(p) || 0; T.partPdes[a] = partPdes(p) || 0;
      T.partDrown[a] = Rl && Rl.drown ? 1 : 0; }
    if(T.partPdes[a] > 0){ let m = 0; for(const i of faces) m |= T.nodeInCore[i] ? 1 : 2; T.partPdesMode[a] = m; }
    const fk = DMGFX[id] ? id : (DMGFX[p.role] ? p.role : null);
    T.partDmgFx[a] = fk && FXCODE[fk] ? FXCODE[fk] : 0;
    T.partCoreIx[a] = ix(IX.core, coreOf(id));
    T.partTankHold[a] = p.role === "tank" && tankHold(id) ? 1 : 0; }
  [T.partCell0, T.partCellIx] = csr(pc, nP);
  [T.partTNode0, T.partTNodeIx] = csr(tn, nP);
  [T.partNode0, T.partNodeIx] = csr(fn4, nP);
  { const g = occupied(null), st = [];
    for(let a=0;a<nP;a++){ const q = dmgPart(IX.partId[a]); if(!q) continue;
      st[a] = ((q.stand) || freeAdj(q, g)).map(c => c[1]*GW + c[0]); }
    [T.partStand0, T.partStandIx] = csr(st, nP); }
  T.partHitW = F64(nP); T.partAccess = U8(nP);
  for(let a=0;a<nP;a++){ const id = IX.partId[a], q = T.partKind[a] ? dmgPart(id) : partOf(id);
    if(!q || (!T.partKind[a] && !fitted(q))) continue;
    T.partAccess[a] = partAccess(q) ? 1 : 0;
    if(q.isRun){ T.partHitW[a] = runWgt(q.cells); continue; }
    let e = 0;
    for(let X=q.x;X<q.x+q.w;X++) for(let Y=q.y;Y<q.y+q.h;Y++) if(X===0||X===GW-1||Y===0||Y===GH-1) e++;
    T.partHitW[a] = HITW_BASE + e*HITW_HULL; }
  T.rPrimaryRelief = ix(IX.relief, primaryRelief());

  const segs = [], segNode = [];
  for(const r of G.runs){ const node = nodeOf(runNodeOf(r.key)), by = new Map();
    for(const i of r.cells){ const g = R.of[i]; if(g < 0) continue;
      if(!by.has(g)) by.set(g, []); by.get(g).push(i); }
    for(const l of by.values()){ segs.push(l); segNode.push(node); } }
  N.rseg = Math.max(1, segs.length); T.nRseg = segs.length;
  T.rsegNode = I32(N.rseg); for(let k=0;k<segs.length;k++) T.rsegNode[k] = segNode[k];
  [T.rsegCell0, T.rsegCellIx] = csr(segs, segs.length);

  const opens = IX.brkId.slice();
  T.nBrk = opens.length;
  for(const fid of reliefPriIds()){ const f = ix(IX.fit, fid);
    if(f >= 0 && T.fitTarget[f] < 0 && !T.fitVentOut[f]) opens.push("vent:"+fid); }
  IX.open = engIndex(opens); IX.openId = opens;
  N.open = Math.max(1, opens.length); T.nOpen = opens.length;
  T.openKind = U8(N.open); T.openPart = I32(N.open); T.openBore = F64(N.open); T.openPour = I32(N.open);
  T.openRelief = I32(N.open); T.openPortPart = I32(2*N.open); T.openPortCell = I32(2*N.open);
  const oNodes = [], oCells = [], oParts = [];
  const pourOf = a => { const l = pc[a] || []; if(!l.length) return -1;
    let lo = -1; for(const i of l) lo = Math.max(lo, (i/GW)|0);
    const row = l.filter(i => ((i/GW)|0) === lo).sort((x,y) => x-y);
    return row[row.length>>1]; };
  for(let o=0;o<opens.length;o++){ const k = opens[o];
    if(k.indexOf("vent:") === 0){ const fid = k.slice(5), a = ix(IX.part, fid);
      T.openKind[o] = 3; T.openPart[o] = a; T.openRelief[o] = ix(IX.relief, fid);
      T.openBore[o] = fitBoreMm(fid)/1000; oNodes[o] = a >= 0 ? fn4[a] : []; continue; }
    if(k.indexOf("break:cav:") === 0){ const cid = k.slice(10), a = ix(IX.part, cid);
      T.openKind[o] = 1; T.openPart[o] = a; T.openPour[o] = a >= 0 ? pourOf(a) : -1;
      const i = nodeOf("cav:"+cid); oNodes[o] = i >= 0 ? [i] : []; continue; }
    const t = k.slice(6);
    if(t.indexOf(":") < 0){ const a = ix(IX.part, t);
      T.openKind[o] = 0; T.openPart[o] = a; T.openPour[o] = a >= 0 ? pourOf(a) : -1;
      oNodes[o] = a >= 0 ? fn4[a] : []; continue; }
    T.openKind[o] = 2;
    const r = net.byKey[t], i = nodeOf(runNodeOf(t));
    oNodes[o] = i >= 0 ? [i] : [];
    T.openBore[o] = r ? runBoreMm(r)/1000 : 0;
    const cl = [], pl = [];
    if(r && r.cells) for(const [x,y] of r.cells){ cl.push(y*GW+x); pl.push(ix(IX.part, "pipe:"+x+","+y)); }
    oCells[o] = cl; oParts[o] = pl;
    if(r) [r.pa, r.pb].forEach((pid, j) => { if(!pid) return;
      T.openPortPart[2*o+j] = ix(IX.part, "port:"+pid);
      const c = portCell(pid); T.openPortCell[2*o+j] = c ? c[1]*GW+c[0] : -1; }); }
  [T.openNode0, T.openNodeIx] = csr(oNodes, N.open);
  [T.openCell0, T.openCellIx] = csr(oCells, N.open);
  T.openCellPart = csr(oParts, N.open)[1];
  T.openOut = I32(N.open);
  for(let o=0;o<opens.length;o++) T.openOut[o] = ix(IX.out, opens[o]);

  const jr = [];
  for(const fid of reliefSecIds()){ const f = ix(IX.fit, fid);
    if(f >= 0 && T.fitTarget[f] < 0 && !T.fitVentOut[f]) jr.push(ix(IX.relief, fid)); }
  T.rJetRelief = Int32Array.from(jr.filter(v => v >= 0));
  T.boilerPart = I32(N.boiler); const bv = [];
  for(let b=0;b<N.boiler;b++){ const id = IX.boilerId[b];
    T.boilerPart[b] = ix(IX.part, id);
    bv[b] = (G.shellValves[id] || []).map(fid => ix(IX.relief, fid)).filter(v => v >= 0); }
  [T.boilerValve0, T.boilerValveIx] = csr(bv, N.boiler);

  const cool = fireCool();
  T.rFire = fireRow(); T.rFireOn = cool ? 1 : 0; T.rFireRho = fireRho(); T.rFireCp = fireCp(); T.rFireBulk = cool ? cool.bulk : WATER_BULK;
  T.satBurn = U8(Math.max(1, T.sats.length));
  for(let k=0;k<T.sats.length;k++){ const c = T.sats[k]; T.satBurn[k] = c && c.burn && FIRE[c.burn] ? 1 : 0; }
  T.rSteamH = roomSteamH();
  T.minPburst = minPburst();
  T.radPart = I32(N.rad); T.radLive = U8(N.rad);
  for(let r=0;r<N.rad;r++){ const id = IX.radId[r]; T.radPart[r] = ix(IX.part, id); T.radLive[r] = radLive(id) ? 1 : 0; }
  T.rPanelHiT = tsatSec(TURB_TRIP_P) - COND_DT0;

  const na = ANN.length;
  if(na !== E_ANN_NAME.length) throw new Error("engBuildRoom: ANN has "+na+" rows, eAnnEval knows "+E_ANN_NAME.length);
  T.annSev = U8(na); T.annCore = U8(na); T.annHost = I32(na);
  for(let k=0;k<na;k++){ const a = ANN[k];
    if(a[0] !== E_ANN_NAME[k]) throw new Error("engBuildRoom: ANN row "+k+" is "+a[0]+", eAnnEval expects "+E_ANN_NAME[k]);
    T.annSev[k] = a[1] === "red" ? 0 : a[1] === "amber" ? 1 : 2;
    T.annCore[k] = a[4] === "core" || a[4] === "rods" ? 1 : 0;
    const h = typeof a[4] === "function" ? a[4]() : a[4], hp = h ? roleOf(h) : null;
    T.annHost[k] = hp ? ix(IX.part, hp.id) : -1; }
}
