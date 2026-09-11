"use strict";

/* D.gw/D.gh are the ship in cells and GW/GH that pair resolved; gridSync() is the ONE writer, and one cell is the floor because a zero grid divides by zero in every field pass. */
let GW=60, GH=34;
/* CELL stays in this file: tools/nodom-probe.js flies a sim-only subset that omits core/constants.js and carries this one. */
const CELL=134, GX=12, MPC=1.4/3;   // metres per cell
/* Every pixel budget in the plant renderer was authored against CELL_REF, so a DRAWING constant is multiplied by DRAW_K and screen furniture is not. */
const CELL_REF=16, DRAW_K=CELL/CELL_REF;
const gridClamp=(w,h)=>[Math.max(1,Math.round(w)), Math.max(1,Math.round(h))];
function gridSync(){ const [w,h]=gridClamp(D.gw,D.gh);
  if(w!==GW||h!==GH){ GW=w; GH=h; } }
/* The bow and the deck do not move: D.pipes is CELL-KEYED, so growing off x=0 would rewrite every pipe cell to mean the same ship. */
function gridDrag(edge,c){
  if(!c) return;
  const [w,h]=gridClamp(edge==="r"?c[0]+1:D.gw, edge==="b"?c[1]+1:D.gh);
  if(w===D.gw && h===D.gh) return;
  D.gw=w; D.gh=h; buildLayout();
}
/* partName() is the ONE reader - a raw p.name read in the UI is a bug - and it lives here rather than in core/ui.js because step()'s event log names machines. */
const NAME_CAP=24;
const nameFor=(id,dflt)=>{ const n=(D.name&&D.name[id]||"").trim(); return n?n.slice(0,NAME_CAP):dflt; };
function partName(p){ return nameFor(p.id,p.name); }
function setPartName(id,str){
  const t=(str||"").trim().slice(0,NAME_CAP);
  if(t){ if(!D.name) D.name={}; D.name[id]=t; }
  else if(D.name) delete D.name[id];
}
const NOTE_CAP=240;
const noteFor=id=>(D.note&&D.note[id])||"";
function setNote(id,str){
  const t=(str||"").trim().slice(0,NOTE_CAP);
  if(t){ if(!D.note) D.note={}; D.note[id]=t; }
  else if(D.note) delete D.note[id];
}
let GY=100;                                   // grid top, set each frame by the layout section
let LAY=null, layFit="", layBuiltSig=null, sel=null, layMass=0;
/* Every cache below proves itself against one of these strings, cached against DGEN; sigFresh() is the raw pass that keeps the contract honest and layFresh() runs it once a frame. */
const SIGS=[];
const sigMemo = build => { let g=-1, v=null;
  const f = () => (g===DGEN ? v : (v=build(), g=DGEN, v));
  f.raw = build; SIGS.push(f); return f; };
/* One signature per frame, round robin: rebuilding all of them raw cost 3 % of a frame, so an untouched edit is caught within SIGS.length frames instead. */
let sigTurn = 0;
const sigFresh = () => { const n = SIGS.length; if(!n) return;
  const f = SIGS[sigTurn = sigTurn >= n-1 ? 0 : sigTurn+1];
  if(f.raw() !== f()) dTouch(); };
const machineSig=sigMemo(()=>{ let out="";
  for(const id in D.machines){ const m=D.machines[id], c=m.cell;
    out += "|"+id+":"+m.kind+":"+(c?c[0]+","+c[1]:"-")+":"+(m.on||""); }
  return out; });
/* Leave any of these out and a direct D.tanks edit leaves LAY holding parts that no longer exist. */
const tankSig=sigMemo(()=>{ let out="";
  for(const id in D.tanks){ const t=D.tanks[id], c=t.cell;
    // vol too: a tank's BOX SIZE follows it (tankW/tankH)
    out +="|"+id+":"+(c?c[0]+","+c[1]:"-")+":"+t.vol+":"+(t.aspect||1); }
  return out; });
// mode too: it decides which faces are one node (foldFacesOf())
const fittingSig=sigMemo(()=>{ let out="";
  for(const id in D.fittings){ const f=D.fittings[id], c=f.cell;
    out += "|"+id+":"+(c?c[0]+","+c[1]:"-")+":"+f.mode; }
  return out; });
// the face is derived from the offset (portFaceOf()), and `run` is the rid D.bore is read under
const portSig=sigMemo(()=>{ let out="";
  for(const id in D.ports){ const p=D.ports[id];
    out += "|"+id+":"+p.p+":"+p.dx+","+p.dy+":"+(p.run||""); }
  return out; });
/* Joined into laySrcSig(), so laying a pipe invalidates buildLayout()'s occupancy the way placing a tank does. */
const pipeSig=sigMemo(()=>{ let out="";
  for(const k in D.pipes){ const c=D.pipes[k]; out += "|"+k+":"+c.s+":"+c.r; }
  return out; });
const gridSig=sigMemo(()=>"|g"+D.gw+"x"+D.gh);
/* Bore and wall in mm, keyed by runIdOf(). Here and NOT in D_SCALARS(), which JSON-stringifies whole and is a measured hot spot. */
const boreSig=sigMemo(()=>{ let out="";
  for(const k in (D.bore||{})) out += "|b"+k+":"+D.bore[k];
  for(const k in (D.wall||{})) out += "|w"+k+":"+D.wall[k];
  return out; });
const laySrcSig=()=>machineSig()+gridSig()+tankSig()+fittingSig()+portSig()+pipeSig()+boreSig()+matSig();
/* Removing a part takes its pipes with it: ids are reused (lowest free slot), so the next tank would inherit the dead one's plumbing. */
function removePart(id){
  /* A rider and its host are one machine: REMOVE on either is the same gesture. */
  const m0=D.machines[id];
  if(m0 && m0.on && D.machines[m0.on]) return removePart(m0.on);
  /* The host's own entry goes FIRST, or the rider's redirect above finds it still there and the two loop for ever. */
  delete D.machines[id];
  for(const rid in D.machines) if(D.machines[rid].on===id) removePart(rid);
  delete D.cores[id];
  delete D.tanks[id];
  /* No fitting->fitting cascade: a fitting left with no runs is a valve you can re-plumb. */
  delete D.fittings[id];
  if(D.name) delete D.name[id];   // ids are reused, so a dead part's name must not be inherited
  if(D.note) delete D.note[id];
  for(const pid in D.ports) if(D.ports[pid].p===id) removePort(pid);
  buildLayout();
}
/* mintTank() builds; addTank() is the gesture on top and takes the lowest free slot. A null x is a tank with no cell - a secondary tank with no node and no box. */
function mintTank(id,x,y){
  const t=JSON.parse(JSON.stringify(TANK_DEFAULT));
  /* the kind and nothing else: CONTENTS is a charge the vessel can be drained of, so it may not be the name */
  t.name="TANK"; t.col="#5aa9d6";
  t.cell = x==null ? null : [x,y];
  t.tip="A tank. Say what is in it, how it is charged and how it is plumbed on its own panel - the physics follows from that and from where you put it.";
  D.tanks[id]=t; buildLayout(); return id;
}
function addTank(x,y){
  let n=1; while(D.tanks["tank"+n]) n++;
  mintTank("tank"+n,x,y);
  D.tanks["tank"+n].name="TANK "+n;
  return "tank"+n;
}
/* A tank carries a control row, so it is a machine-sized box; a fitting stays one cell with its handles in the margin below. */
const FIT_W=1, FIT_H=1;
const TANK_W0=3;                 // FITSTRIP_W's reference (plant.js), no longer a footprint
/* Fitted once against the stock HPI tank, the PART_VOL_CELL/RAD_AREA_CELL idiom. The box is the DISPLAY of volume - partVol() stays exact, so the footprint rounds and the cubic metres do not. */
const TANK_VOL_CELL=3.2;
const tankAspect = id => { const t=D.tanks&&D.tanks[id];
  return clamp((t&&t.aspect)||1, 0.25, 4); };
const tankCells = vol => Math.max(4, Math.round(Math.max(vol,0)/TANK_VOL_CELL));
const tankW = (vol,a) => Math.max(2, Math.round(Math.sqrt(tankCells(vol)*(a||1))));
const tankH = (vol,a) => Math.max(2, Math.ceil(tankCells(vol)/tankW(vol,a)));
/* The one predicate for "can it push at all", read by the drawing and nothing else; tankP() is what prices it. */
const tankHeld = id => { const t=D.tanks&&D.tanks[id]; return !!t && !!(t.gas || t.hold); };
const tankParts=()=>{
  const out=[];
  for(const id in D.tanks){ const t=D.tanks[id]; if(!t.cell) continue;
    out.push({id, name:t.name, w:tankW(t.vol,tankAspect(id)), h:tankH(t.vol,tankAspect(id)), x:t.cell[0], y:t.cell[1], col:t.col,
              grp:"safety", tip:t.tip, role:"tank"}); }
  return out;
};
/* A fitting occupies a whole grid cell - hittable, repairable, blocking - which a fraction along a pipe could never be. */
const fittingParts=()=>{
  const out=[];
  for(const id in D.fittings){ const f=D.fittings[id]; if(!f.cell) continue;
    out.push({id, name:f.name, w:FIT_W, h:FIT_H, x:f.cell[0], y:f.cell[1], col:f.col,
              grp:"safety", tip:f.tip, role:"fitting"}); }
  return out;
};
/* A tee, a branch throttle and a relief valve are one component with `mode` set differently; mintFitting() builds and addFitting() is the gesture. */
function mintFitting(id,x,y){
  const f=JSON.parse(JSON.stringify(FIT_DEFAULT));
  f.cell=[x,y];
  D.fittings[id]=f; buildLayout(); return id;
}
function addFitting(x,y){
  let n=1; while(D.fittings["fit"+n]) n++;
  return mintFitting("fit"+n,x,y);
}
/* Which faces of a part are the same node. A fitting's answer follows its own MODE rather than its role, so the row may name a resolver instead of a list. */
const foldFacesOf=p=>{ const R=ROLE[p.role]; if(!R||!R.fold) return null;
  return typeof R.fold==="function" ? R.fold(p) : R.fold; };
/* Sphere-equivalent surface, so a tank drawn as a cylinder with domed ends needs no aspect knob to be weighed honestly. */
const tankAreaM2=vol=>Math.PI*Math.pow(6*Math.max(vol,0.1)/Math.PI,2/3);
/* `vol` is an argument, not always the tank's own: the CAPACITY slider asks what a candidate size would weigh before anything is written. */
const tankVolOf=(id,vol)=>Math.max(vol===undefined?D.tanks[id].vol:vol, 0.1);
const tankWallMm=(id,vol)=>
  wallSuggestMm(Math.cbrt(6*tankVolOf(id,vol)/Math.PI)*1000,   // equivalent diameter, mm
                tankDesignP(id), null);
/* NOT physics: the geometry above is right, and at full scale tankage swamped the budget. Applied once on the finished figure, so the wall, the rating and the picture stay real quantities and only the bill is scaled. */
const TANK_MASS_GAME_K=0.1;
const tankMassOf=(id,vol)=>tankAreaM2(tankVolOf(id,vol))*(tankWallMm(id,vol)/1000)
                         *STEEL_RHO/1000*TANK_MASS_GAME_K;
const tankMass=()=>{ let m=0;
  for(const id in D.tanks) if(D.tanks[id].cell) m+=tankMassOf(id);
  return m; };
/* The system curve: every run of the loop the pump stands in, at that loop's share of rated flow, on the solve's own friction law plus the machines' declared internals. A pump on no loop keeps PUMP_H0. */
let loopHCache = {}, loopHPass = -1;
function loopHeadAt(id){
  const pn = layPass();
  if(pn && loopHPass !== pn){ loopHCache = {}; loopHPass = pn; }
  if(pn && loopHCache[id] !== undefined) return loopHCache[id];
  const h = loopHeadOf(id);
  if(pn) loopHCache[id] = h;
  return h;
}
/* Each leg at the density it carries: dp goes as w^2/rho, so a boiling loop must not be priced at the weight of cold water, and a boiling loop's cold leg returns saturated rather than subcooled. */
const loopHotInlet = p => { const R = p && ROLE[p.role];
  if(!R || R.thermal !== "transfer") return null;
  const IN = roleIns(p)[0];
  return IN ? coreFold(p.id+IN.a) : null; };
/* Which face the cold leg lands on; the other declared ports are the outlet the mixture leaves by. */
const coreInFace = id => { const p = partOf(id), R = p && ROLE[p.role]; return (R && R.inlet) || null; };
/* Which runs still carry what the core sent out. A transfer machine declares its own hot inlet; a direct cycle declares nothing, so the walk runs from the core's OUTLET face to the first vessel that separates the mixture - a drum, a shell, a sink - and never through a pump or back through the core's own inlet. */
const hotSepAt = n => { const p = partOf(n) || partOf(n.slice(0,-1)), R = p && ROLE[p.role];
  return !!(R && (R.thermal === "transfer" || R.thermal === "sink" || p.role === "tank")); };
function hotReach(){
  const slot = graphSlot("hotReach"), was = slot.get(1);
  if(was) return was;
  const G = nodeGraph(), out = {runs:{}, nodes:{}};
  slot.set(1, out);
  const key = (u,v) => u<v ? u+"|"+v : v+"|"+u;
  const runOf = {};
  for(const r of pipeNetwork()) runOf[key(r.a+r.sa, r.b+r.sb)] = r.key;
  const seen = {}, stack = [];
  for(const p of LAY.parts){ if(p.role !== "core") continue;
    const inF = coreInFace(p.id);
    for(const n of (G.nodesOf[p.id]||[])) seen[n] = 1;      // the fold is cut: the cold leg is not what the core sent out
    for(const f in (ROLE.core.ports||{})) if(f !== inF && G.adj[p.id+f]) stack.push(p.id+f); }
  while(stack.length){ const u = stack.pop();
    for(const v of (G.adj[u]||[])){
      if(seen[v]) continue;
      seen[v] = 1; out.nodes[v] = 1;
      const rk = runOf[key(u,v)]; if(rk) out.runs[rk] = 1;
      const p = partOf(v) || partOf(v.slice(0,-1));
      if(hotSepAt(v) || (p && p.role === "pump")) continue;
      stack.push(v); } }
  return out;
}
const runHotSide = r => { if(hotReach().runs[r.key]) return true;
  const e = runPartEnds(r.a, r.b, r.sa, r.sb); if(!e) return false;
  return e.some(({p,f}) => { const nd = loopHotInlet(p); return !!nd && nd === coreFold(p.id+f); }); };
/* A pump on no primary LOOP is priced round the circuit it discharges into, each run at its OWN duty: charged the pump's whole flow instead, an emergency feed pump's 139 mm discharge line puts 5 MPa of system curve on the feed pump. One flat design state, because satOfCirc().Tref is undefined off the core's circuit. */
const circHeadOf = id => {
  const ci = circOfNode(pumpDisNode(id)); if(!(ci >= 0)) return null;
  const c = circCool(ci) || COOLANT[0], rho = c.dens*RHO_K;
  let dp = 0;
  for(const r of pipeNetwork()){
    if(runCircOf(r) !== ci || edgeLaw(r) === LAW_VAPOUR) continue;
    const w = runDutyKgs(r); if(!(w > 0)) continue;
    const mm = runBoreMm(r), Dm = mm/1000, A = Math.PI/4*Dm*Dm;
    const K = fricOf(mm/BORE_REF, w, c.mu)*Math.max(r.L, NET_COMP_LEN)/Dm + runK0(r);
    dp += K*w*w/(2*rho*A*A); }
  return dp/1e6;
};
const loopHeadOf = (id, outs) => {
  const L = loopMap(), li = L.partLoop[id]; if(li === undefined) return circHeadOf(id);
  const a = COOLANT[priD().cool], n = Math.max(1, L.n);
  const w = RATED_KW()/(a.cp*coreDT0()*n);
  const dsg = loopDesignH(nodeGraph().coreCirc), c = dsg.c;
  const stAtH = h => { const m = mixState(c, c.p0, h, {x:0, rho:0, b:0});
    return {rho: Math.max(m.rho, 1e-3), mu: muMixOf(c, m.x)}; };
  const hIn = dsg.hIn, hOut = dsg.hOut, boils = dsg.boils;
  const hotSt = stAtH(hOut), coldSt = stAtH(hIn);
  const rhoHot = hotSt.rho, rhoCold = coldSt.rho;
  const inLoop = pid => coreOf(pid) === pid || L.partLoop[pid] === li;
  const dpOf = (K, Dm, rho) => { const A = Math.PI/4*Dm*Dm; return K*w*w/(2*rho*A*A); };
  let dp = 0;
  for(const r of pipeNetwork()){ if(!inLoop(r.a) || !inLoop(r.b)) continue;
    const mm = runBoreMm(r), Dm = mm/1000, hot = runHotSide(r), st = hot ? hotSt : coldSt;
    const K = fricOf(mm/BORE_REF, w, st.mu)*Math.max(r.L, NET_COMP_LEN)/Dm + runK0(r);
    const d = dpOf(K, Dm, st.rho); dp += d;
    if(outs) (outs.byRun || (outs.byRun = {}))[r.key] = {dp:d/1e6, rho:st.rho, hot, K, mm}; }
  // a machine's internal path is priced at BORE_REF over NET_COMP_LEN (compC)
  for(const pid in L.partLoop){ if(L.partLoop[pid] !== li) continue;
    const p = partOf(pid), R = p && ROLE[p.role]; if(!R || !Array.isArray(R.internal)) continue;
    const hot = loopHotInlet(p);
    // the HOT path only, which is the one the declaration puts first
    { const IN = R.internal[0]; if(IN.K > 0){
      const isHot = hot === coreFold(pid+IN.a), d = dpOf(IN.K, BORE_REF/1000, isHot ? rhoHot : rhoCold);
      dp += d;
      if(outs) (outs.byRun || (outs.byRun = {}))["part:"+pid] = {dp:d/1e6, rho:isHot?rhoHot:rhoCold, hot:isHot, K:IN.K, mm:BORE_REF}; } } }
  if(outs){ outs.w = w; outs.hIn = hIn; outs.hOut = hOut; outs.rhoHot = rhoHot; outs.rhoCold = rhoCold; outs.boils = boils; }
  return dp/1e6;
};
const pumpHeadSuggest = id => {
  if(id === undefined) return PUMP_H0;
  const h0 = loopHeadAt(id) ?? PUMP_H0;
  /* A pump that discharges into another pump's SUCTION is a booster, and what it is bought for is that pump's NPSH - never the boundary beyond it, which the pump ahead is itself bought to reach. Charged the boundary, two machines in series each develop the whole rise and drag the first one's suction under the vacuum it draws on. */
  const ahead = pumpAhead(id);
  if(ahead) return h0 + NPSH_K*pumpNPSH(ahead);
  const b = pumpBounds(id);
  return h0 + (b.hi === null ? 0 : (b.hi - b.lo)*PUMP_MARGIN);
};
/* Thoma's cavitation number: the suction a stage needs is a few percent of the head it develops, and a pump is bought with margin over it. Derived off the head rather than stated, so an impeller cut for low NPSH is not yet a machine this can draw. */
const NPSH_SIG = 0.03, NPSH_K = 1.3;
const pumpNPSH = id => NPSH_SIG*pumpHead(id);
/* The first pump the discharge reaches, by pumpResOf()'s rule read the other way: through fittings only, because what stands behind another MACHINE is that machine's business. */
function pumpAhead(id){
  const slot = graphSlot("pumpAhead"), was = slot.get(id);
  if(was !== undefined) return was;
  slot.set(id, null);                        // a ring of pumps terminates rather than recurses
  const G = nodeGraph(), dis = pumpDisNode(id);
  const partAt = n => partOf(n) || partOf(n.slice(0,-1));
  const seen = {}, stack = [];
  for(const n of (G.nodesOf[id]||[])) if(coreFold(n) === dis){ seen[n] = 1; stack.push(n); }
  let out = null;
  while(stack.length && !out){ const u = stack.pop();
    for(const v of (G.adj[u]||[])){ if(seen[v]) continue;
      const p = partAt(v); if(!p || p.id === id) continue;
      seen[v] = 1;
      if(roleHead(p.role) && coreFold(v) === pumpSucNode(p.id)){ out = p.id; break; }
      if(p.role !== "fitting") continue;
      stack.push(v); } }
  slot.set(id, out);
  return out;
}
/* The ONE walk both suggestions make; `shell` - a boundary that is a generator's secondary side - is what makes a pump a FEED pump. Cached for one layPass(), and 0 means "not cacheable". */
let pumpBCache = {}, pumpBPass = -1;
function pumpBounds(id){
  const pn = layPass();
  if(pn && pumpBPass !== pn){ pumpBCache = {}; pumpBPass = pn; }
  if(pn && pumpBCache[id] !== undefined) return pumpBCache[id];
  const b = pumpBoundsOf(id);
  if(pn) pumpBCache[id] = b;
  return b;
}
function pumpBoundsOf(id){
  /* WHICH nodes are boundaries is a fact about the drawing and cached on the graph; WHAT they hold is asked every call. */
  const slot = graphSlot("pumpBounds"); let S = slot.get(id);
  if(!S){ const G = nodeGraph(), ci = (G.nodesOf[id]||[]).map(n=>G.circuit[n]);
    S = {ci, cands:[], panel:false, core:false};
    for(const pid in G.nodesOf) for(const n of G.nodesOf[pid]){
      if(ci.indexOf(G.circuit[n]) < 0) continue;
      const p0 = partOf(pid), R = p0 && ROLE[p0.role];
      // a panel is no boundary, and it is what tells the circulating water from the feedwater
      if(p0 && p0.role === "radiator") S.panel = true;
      if(G.inCore(n)) S.core = true;
      if(!R) continue;
      if(R.sgtr && onStage(pid, n.slice(pid.length), 1)) S.cands.push([pid, true]);
      else if(R.thermal === "sink") S.cands.push([pid, false]); }
    /* a drum is not found by the walk above - it stands on the pump's OWN circuit, so every pump on a direct cycle would read it. What this pump has to push into is what it FEEDS. */
    for(const g of secGensOf(id)) if(isDrum(g) && !S.cands.some(c=>c[0]===g)) S.cands.push([g, true]);
    slot.set(id, S); }
  let hi = null, lo = null, shell = false, hold = null;
  for(const c of S.ci) if(holdOnCirc(c).length){ hold = holdSetP(c); break; }
  for(const [pid, sg] of S.cands){ const q = sg ? boilerDesignP(pid) : COND_P0;
    if(sg) shell = true;
    if(hi === null || q > hi) hi = q;
    if(lo === null || q < lo) lo = q; }
  return {hi, lo, shell, hold, cool: S.panel && !S.core};
}
/* A walk from the suction node, stopping AT a tank without crossing it - runReach()'s rule, asked of NODES because a part-level walk goes through a generator's tube wall. */
function pumpResOf(id){
  const slot=graphSlot("pumpRes"), was=slot.get(id); if(was) return was;
  const G=nodeGraph(), suc=pumpSucNode(id), out=[];
  const partAt=n=>partOf(n) || partOf(n.slice(0,-1));
  const seen={}, stack=[];
  // the SUCTION face group only: crossing the casing would put the discharge side in its own suction line
  for(const n of (G.nodesOf[id]||[])) if(coreFold(n)===suc){ seen[n]=1; stack.push(n); }
  while(stack.length){ const u=stack.pop();
    for(const v of (G.adj[u]||[])){ if(seen[v]) continue;
      const p=partAt(v); if(!p || p.id===id) continue;
      seen[v]=1;
      /* a circuit's own expansion vessel is NOT a reserve: it rides the loop, and the pump on it circulates what comes back round rather than drawing the tank down */
      /* a circuit's own expansion vessel is not a reserve, and neither is a drum: both ride the loop, and the pump on them circulates what comes back round */
      if(p.role==="tank"){ if(D.tanks[p.id].cool == null && !isDrum(p.id) && !out.includes(p.id)) out.push(p.id); continue; }
      /* A suction line may have valves and tees in it; what stands behind another MACHINE is that machine's suction, not this one's. */
      if(p.role!=="fitting") continue;
      stack.push(v); } }
  slot.set(id,out);
  return out;
}
const RESERVE_T = 600;                 // s a reserve is sized to hold the plant up over
/* A machine sized to exactly the pressure it pushes against delivers nothing and its regulating valve has no authority; real feed pumps are bought about a third above drum pressure. Multiplies the STANDING term only. */
const PUMP_MARGIN = 1.35;
/* Rated heat over what one kelvin of core rise costs, divided by LOOPS and never by pumps: two pumps in one loop are redundancy, not half a loop each. */
/* kg/s round ONE primary loop, divided by LOOPS and never by pumps: two pumps in one loop are redundancy, not half a loop each. */
const legDutyKgs = () => RATED_KW()
  /(COOLANT[priD().cool].cp*coreDT0()*Math.max(1, loopMap().n));
/* kg/s of circulating water: it carries the REJECTION and not the core, the same basis condUASuggest() uses. */
const cwDutyKgs = () => plantDuty()/(SAT_WATER.cp*CW_RISE);
/* kg/s a reserve is bought to deliver: what those tanks hold, over the time it is sized to hold the plant up. */
const resDutyKgs = ids => ids.reduce((m,t)=>m+tankKg(t),0)/RESERVE_T;
const pumpFlowSuggest = id => {
  /* A reserve pump is sized by its reserve, asked of the SUCTION and never of the circuit - a feed pump and an emergency feed pump share a circuit. */
  if(id !== undefined){ const r = pumpResOf(id);
    if(r.length) return resDutyKgs(r); }
  if(id !== undefined && pumpBounds(id).shell)
    return RATED_KW()/steamRise();            // rated heat over the feed-to-steam rise: kg/s of steam
  if(id !== undefined && pumpBounds(id).cool) return cwDutyKgs();
  return legDutyKgs();
};
/* Baked on first read, so the machine owns it: a live `?? xSuggest()` default is a hidden reference, and editing one machine must never set a value on another. */
const bake = (bag, id, mk) => { const v = bag[id];
  return v === undefined ? (bag[id] = mk(id)) : v; };
const pumpHead = id => D.pumpHead[id] ?? pumpHeadSuggest(id);
const pumpFlow = id => D.pumpFlow[id] ?? pumpFlowSuggest(id);
/* Seconds of rated shaft power the rotor stores, E0/P0, which is what decides how a machine coasts; a flywheeled coolant pump is of order five to ten and a feed pump has none. */
const PUMP_ROTOR_S = 6;
const pumpRotorSuggest = id => secGensOf(id).length ? 1 : primaryPump(id) ? PUMP_ROTOR_S : 2;
const pumpRotor = id => D.pumpRotor[id] ?? pumpRotorSuggest(id);
/* A mass and a box, and nothing the solve reads. BOTH ANCHORS ARE ABSOLUTE: read off a suggestion, editing the reactor would silently resize every pump on the ship. */
const PUMP_FLOW_REF = 7250;            // kg/s, a reference coolant pump duty
const pumpCap = (head,flow) => (head/PUMP_H0)*(flow/PUMP_FLOW_REF);
const pumpCapOf = id => pumpCap(pumpHead(id), pumpFlow(id));
const PUMP_MASS=50;                    // t at the reference machine (cap 1)
const PUMP_SCALE_N=0.6;                // the six-tenths rule, published
const pumpMass = cap => PUMP_MASS*Math.pow(Math.max(cap,0), PUMP_SCALE_N);
const pumpMassOf = id => pumpMass(pumpCapOf(id));
/* The box is the CASING, so it follows FLOW alone - stable through commissioning - off the STORED figure, because pumpCapOf() would ask loopMap() and the box is read inside buildLayout(). Floored at the reference machine, so a box only ever grows: below it the discharge nozzles drop off the face they were seeded on. */
const pumpBoxCap = id => Math.max(1, (D.pumpFlow[id] ?? PUMP_FLOW_REF)/PUMP_FLOW_REF);
// the floor and the ceiling of a pump box, in cells
const PUMP_W0=3, PUMP_BOX_H0=3, PUMP_W_MAX=5, PUMP_H_MAX=8;
const pumpW = id => clamp(PUMP_W0 + Math.floor(pumpBoxCap(id)/1.5), PUMP_W0, PUMP_W_MAX);
const pumpH = id => clamp(PUMP_BOX_H0 + Math.round(2*pumpBoxCap(id)), PUMP_BOX_H0, PUMP_H_MAX);
/* Which internal path is the pump casing: `head` sits on the PATH row, not the role, because a role may carry several paths and only one can push. */
const roleHead=role=>{ const R=ROLE[role]; if(!R||!R.internal) return false;
  return (Array.isArray(R.internal)?R.internal:[R.internal]).some(IN=>IN.head); };
/* The casing path's own `a` face, FOLDED: a pump spliced into a horizontal leg takes suction on `r` and has no node called "t" at all. */
const pumpSucNode=id=>{ const p=partOf(id), R=p&&ROLE[p.role]; if(!R) return id;
  const IN=(Array.isArray(R.internal)?R.internal:[R.internal]).find(x=>x.head);
  return IN ? coreFold(id+IN.a) : id; };
// ...and the same door onto the casing path's `b` face
const pumpDisNode=id=>{ const p=partOf(id), R=p&&ROLE[p.role]; if(!R) return id;
  const IN=(Array.isArray(R.internal)?R.internal:[R.internal]).find(x=>x.head);
  return IN ? coreFold(id+IN.b) : id; };
/* fitEdgeKey()'s idiom for a pump: the reference and the tick both read the swallow off this, and a second spelling of the key is a second answer. */
const pumpEdgeKey=id=>{ const p=partOf(id), R=p&&ROLE[p.role]; if(!R) return null;
  const IN=(Array.isArray(R.internal)?R.internal:[R.internal]).find(x=>x.head);
  return IN ? "comp:"+id+":"+IN.a+IN.b : null; };
const primaryPump=id=>{ const p=partOf(id);
  return !!p && roleHead(p.role) && loopOf(id)!==null; };
/* In LAY order - the set s.flowBy/s.flowDemBy are keyed on, counted and never named. */
const pumpIds=()=>LAY.parts.filter(p=>roleHead(p.role)).map(p=>p.id);
// EVERY pump the ship carries, wherever it is piped: roleHead() is the same test netBuild() gates its head edge on
const totalPumpCap=()=>{ let c=0;
  for(const p of LAY.parts) if(roleHead(p.role)) c+=pumpCapOf(p.id);
  return c; };
/* The sum of each machine's own sublinear mass: summing capacity first would price redundancy as one enormous machine. */
const totalPumpMass=()=>{ let m=0;
  for(const p of LAY.parts) if(roleHead(p.role)) m+=partMassOf(p.id);
  return m; };
// the CORE's own circuit (inCore(), never primaryPump()): the RPS low-flow floor is about water going past the fuel
const corePump=id=>{ const p=partOf(id); if(!p||!roleHead(p.role)) return false;
  const G=nodeGraph(); return (G.nodesOf[id]||[]).some(n=>G.inCore(n)); };
const corePumpCap=()=>{ let c=0;
  for(const p of LAY.parts) if(corePump(p.id)) c+=pumpCapOf(p.id);
  return c; };
// counted off the grid, never a stored knob
/* A count answers how many machines the PLANT HAS, and a machine nobody piped is not one: the duty is split over what the water can reach. `usage` is the traced connection, so an orphaned port reads as no port at all. Ask roleAll() for how many are DRAWN. */
const partPiped=pid=>{ const u=pipeNetwork().usage;
  for(const f in DIRV) if(u[pid+f]) return true;
  return false; };
const rolePiped=role=>roleAll(role).filter(partPiped);
const roleCount=role=>rolePiped(role).length;
const sgCount=()=>roleCount("sg");
const turbCount=()=>roleCount("turb");
const condCount=()=>roleCount("cond");
/* Every field below is the ENGINEERING QUANTITY in its own units, defaulting to `?? xSuggest()` and never a baked figure: an absurd number is a legal design that performs accordingly. */
/* Off D.power and layoutMetrics(), NEVER derived(): derived() prices mass, mass prices these machines, and a suggestion that asked derived() would ask itself. */
const RATED_KW = () => ratedMWt()*1000;
/* Every machine downstream is sized at the CORE's rating, because the bench cannot solve; a loop that turns out to carry less leaves the set a little large, which is what loadCeil() reads. */
/* kJ/kg: the feed-to-steam rise at the design shell pressure, NOT SAT_WATER.hfg, which is the latent half only. Every "kg/s of steam" divides by this. Off sgDesPSuggest() and never sgDesignP(), which walks the drawing and is unevaluated at module load. */
const steamRise = () => hRise(SAT_WATER, sgDesPSuggest());
const plantSteam = () => RATED_KW()/steamRise();                    // kg/s raised
/* A SIZING figure: the efficiency the set this core would be given reaches, since grossEff() walks LAY.parts and this is read while LAY is being built. What a machine actually captures is still grossEff(). */
const ratedEff = () => COOLANT[priD().cool].eff
  * clamp(1 + TURB_EFF_K*Math.log(RATED_KW()/steamRise()/TURB_EFF_REF),
          TURB_EFF_MIN, TURB_EFF_MAX);
/* The share of the steam raised the feed heaters take: an open heater carrying condensate off the design backpressure up to T_FEED. It never reaches the wheels and it never reaches the condenser. */
const bleedFrac = () => { const hc = hOfT(SAT_WATER, RAD_TDES + COND_DT0);
  return clamp((hOfT(SAT_WATER, T_FEED) - hc)
             / Math.max(satHg(SAT_WATER, sgDesPSuggest()) - hc, 1), 0, 0.9); };
/* Only the throttle steam reaches the wheels, so what the plant CAPTURES is the bleed's complement of ratedEff(); the heat itself is recycled and the condenser still sees the rest of the core. */
const plantDuty  = () => RATED_KW()*(1-(1-bleedFrac())*ratedEff());  // kW rejected
/* What one turbine swallows wide open, kg/s. A designer sizes a set for the
   boiler in front of it, so the suggestion is all of what that boiler raises -
   and a machine that reaches past it is overload the designer chose to buy. */
const turbKgsSuggest = () => plantSteam();
const turbKgs = id => D.turbKgs[id] ?? turbKgsSuggest(id);
const totalTurbKgs = () => { let c=0;
  for(const p of LAY.parts) if(p.role==="turb") c+=turbKgs(p.id);
  return c; };
/* Isentropic efficiency rises with size and rises SLOWLY, so the law is logarithmic in swallow; the cap is where a real steam cycle stops, about 39 % gross on water. */
/* TURB_EFF_REF is an ABSOLUTE machine size, roughly a 400 MWe set, so editing the core does not edit the turbine. */
const TURB_EFF_K=0.13, TURB_EFF_MAX=1.18, TURB_EFF_MIN=0.55, TURB_EFF_REF=680;
const turbEffOf = id => { const k=turbKgs(id);
  if(!(k>0)) return TURB_EFF_MIN;
  return clamp(1 + TURB_EFF_K*Math.log(k/TURB_EFF_REF), TURB_EFF_MIN, TURB_EFF_MAX); };
const TURB_T_PER_KGS=0.0369;     // t per kg/s of swallow, uncapped
const totalTurbMass=()=>{ let m=0;
  for(const p of LAY.parts) if(p.role==="turb") m+=partMassOf(p.id);
  return m; };
/* kW/K: the unit that rejects what this plant rejects at full power, across the design terminal difference on the design circulating-water rise - the turbine's basis, so condShort_() compares like for like. */
const condUASuggest = () => (plantDuty()/CW_RISE)
                            * Math.log(COND_DT0/(COND_DT0-CW_RISE));
const condUA = id => D.condUA[id] ?? condUASuggest(id);
// steam this unit takes straight past the turbine, kg/s
const condDumpSuggest = () => 0.5*turbKgsSuggest();
const condDump = id => D.condDump[id] ?? condDumpSuggest(id);
const COND_T_PER_UA=1.626e-4;          // t per kW/K
const totalCondUA=()=>{ let c=0;
  for(const p of LAY.parts) if(p.role==="cond") c+=condUA(p.id);
  return c; };
const totalCondMass=()=>{ let m=0;
  for(const p of LAY.parts) if(p.role==="cond") m+=partMassOf(p.id);
  return m; };
/* The dump ceiling is count-INDEPENDENT (P.bypass, step.js) so this is a mean, while P.condUA reads the sum and rejection does scale with count. */
const condDumpMean=()=>{ let n=0,c=0;
  for(const p of LAY.parts) if(p.role==="cond"){ c+=condDump(p.id); n++; }
  return n?c/n:0; };            // no condenser is no dump, not a suggested one
const sgTypeOf=id=>D.sgType[id]??D.sg;
const sgRowOf=id=>SGT[sgTypeOf(id)];
/* The type's water charge as a vessel, at the wall its own design pressure needs, on the same tenth scale every tank is priced at (TANK_MASS_GAME_K). */
const sgShellT = id => { const w=sgRowOf(id).water;
  const d=Math.cbrt(6*Math.max(w,0.1)/Math.PI)*1000;
  return tankAreaM2(w)*(wallSuggestMm(d, sgDesignP(id), null)/1000)
         *STEEL_RHO/1000*TANK_MASS_GAME_K; };
/* A flat tonnage per type, deliberately: sgUASuggest() divides by a dT0 that floors at 5 K, so pricing the bundle off UA would price that stand-in. */
const sgTubeT  = id => sgRowOf(id).tube;
// NOT sgMassOf(): step.js owns that name for the WATER in the shell, in kg. This is the STEEL, in tonnes.
const sgSteelT = id => sgShellT(id)+sgTubeT(id);
const totalSgMass=()=>{ let m=0;
  for(const p of LAY.parts) if(p.role==="sg") m+=partMassOf(p.id);
  return m; };
const totalSgUA=()=>{ let c=0;
  for(const p of LAY.parts) if(p.role==="sg") c+=sgUAOf(p.id);
  return c; };
// what share of them is still working, so losing one of two costs half
const roleAlive=(role,s)=>{ const ids=LAY.parts.filter(p=>p.role===role).map(p=>p.id);
  if(!ids.length) return 0;
  return ids.filter(id=>!partWrecked(s,id)).length/ids.length; };
/* The ONE door onto everything s.dmgParts can hold: a machine, a tank, a fitting, a pipe cell ("pipe:x,y") and a port ("port:pid"). */
let dmgArr = null, dmgLen = -1, dmgSet = null;
const partWrecked = (s,id) => { if(!(s && s.dmgParts && id) || s.dmgParts.length === 0) return false;
  const a = s.dmgParts;   // every writer pushes or replaces the array, so identity + length is the whole state
  if(a !== dmgArr || a.length !== dmgLen){ dmgSet = new Set(a); dmgArr = a; dmgLen = a.length; }
  return dmgSet.has(id); };
const dmgWhyOf=(s,id)=>(s && s.dmgWhy && s.dmgWhy[id]) || "WRECKED";
/* A part whose mass no other measure already counts; off the grid, never off a D flag, so every tonne charged points at a box. */
const PART_MASS={catcher:66, vent:34, inert:20, pan:12};
/* Per INSTANCE, not per role: a role-level charge hands out every unit after the first for nothing. */
const partMass=role=>LAY.parts.filter(p=>p.role===role).length*(PART_MASS[role]||0);
/* What one box on the board weighs, t - the ONE door, so a panel's heading and the mass budget cannot quote two prices for one machine. */
function partMassOf(id){
  const p=partOf(id); if(!p) return 0;
  if(roleHead(p.role)) return pumpMassOf(id);
  switch(p.role){
    case "core":     return coreFig(coreD(id)).mass;
    case "sg":       return sgSteelT(id);
    case "turb":     return turbKgs(id)*TURB_T_PER_KGS;
    case "cond":     return condUA(id)*COND_T_PER_UA;
    case "ihx":      return ihxUAOf(id)*IHX_T_PER_UA;
    case "radiator": return radMass(id);
    case "tank":     return D.tanks[id]&&D.tanks[id].cell ? tankMassOf(id) : 0;
    case "fitting":  return fitMassOf(id);
    case "bkp":      return BKP[D.bkp].mass;
    case "ctrl":     return 55;
    default:         return PART_MASS[p.role]||0;
  }
}
/* Where this box gives up, K - the ONE door, because a coating scales it per instance; null means a temperature is not how it fails. */
const partTsurv=p=>{ const l=ROLE[p.role]&&ROLE[p.role].tsurv;
  if(!l) return null;
  if(p.role==="radiator") return l*radCoatOf(p.id).tsurvK;
  // a tank states its own: a heavy vessel is not the same machine as a water butt
  if(p.role==="tank" && D.tanks[p.id] && D.tanks[p.id].tsurv) return D.tanks[p.id].tsurv;
  return l; };
// and where it gives up to a blast, kPa - partTsurv()'s mirror and the one door for the same reason
const partPburst=p=>{ const l=ROLE[p.role]&&ROLE[p.role].pburst;
  if(p.role==="tank" && D.tanks[p.id] && D.tanks[p.id].pburst) return D.tanks[p.id].pburst;
  return l || null; };
/* What its own shell is built for, MPa, and ONLY where the machine states one: the solve carries piezometric head, which is not a figure a shell rating may be compared with, so this is judged against the CIRCUIT's own held pressure. */
const partPdes=p=>{ const l=ROLE[p.role]&&ROLE[p.role].pdes;
  return l || 0; };
// kPa a run gives up at: a pipe cell has no role, so it cannot go through partPburst()
const PIPE_PBURST=120;
// K the AIR AROUND a run may reach: a pipe is bare steel, so what fails is the metal itself
const PIPE_TSURV=900;
/* The weakest thing actually drawn, kPa: derived from the plant, so a compartment of instrument cabinets is alarmed earlier than one holding only vessels. */
const minPburst=()=>LAY.parts.reduce((m,p)=>{ const v=partPburst(p);
  return v && fitted(p) && v<m ? v : m; }, PIPE_PBURST);
/* Loop membership is structural (loopMap(), below), never stored: a pump connected to a loop by PROXIMITY is not connected to it. A part with no loop index still develops its own head, it just pools capacity with nobody. */
/* A fitting is in the loop it sits in: leave it off and loopOfKey() answers null, silently costing the loop a leg. */
const LOOP_ROLE={core:1, sg:1, ihx:1, pump:1, fitting:1};
/* Over NODES (partId+face, netBuild()'s own key), not parts: a generator carries two paths that do not meet, so a part-level link goes straight through the tube wall. The hold is a WINDOW, never a latch. */
let nodeGraphCache=null, nodeGraphSig="", nodeGraphGen=-1, nodeGraphHeld=false;
const nodeGraphHold=on=>{ nodeGraphHeld=!!on && !!nodeGraphCache; };
/* The settled window. COUNTED, so windows may nest: simTick() takes one around the whole tick and step() takes its own inside it. */
let layDepth=0;
/* Numbered, and it moves on every settle AND every release, so a pure-function answer can never be read back in a pass it was not computed in. */
let layPassN=0;
/* Zero outside a window is the safety: a click handler is the one thing that DOES move D, and two can run back to back with no frame between. */
const layPass=()=>layDepth?layPassN:0;
const laySettle=()=>{ if(layDepth++) return;
  layPassN++;
  nodeGraphHold(false); pipeMapHold(false); netPassDrop();
  pipeTrace(); pipeMap(); nodeGraph();
  nodeGraphHold(true); pipeMapHold(true); };
const layRelease=()=>{ if(layDepth>0 && --layDepth) return;
  layDepth=0; layPassN++;
  nodeGraphHold(false); pipeMapHold(false); netPassDrop(); };
function nodeGraph(){
  if(nodeGraphHeld) return nodeGraphCache;
  // every term of sig is a sigMemo keyed on DGEN, so an unchanged DGEN is an unchanged sig
  if(nodeGraphCache && nodeGraphGen===DGEN) return nodeGraphCache;
  // fittingSig(): a mode change moves no cell but changes the fold and the gate. gridSig(): graphSlot() hangs a GWxGH array off this graph.
  const sig=laySig()+"|"+pipeSig()+"|"+fittingSig()+"|"+portSig();
  nodeGraphGen=DGEN;
  if(nodeGraphCache && nodeGraphSig===sig) return nodeGraphCache;
  const adj={}, nodesOf={}, runPorts={};
  const note=(pid,f)=>{ (nodesOf[pid]||(nodesOf[pid]=[])).push(pid+f); };
  const link=(a,b)=>{ (adj[a]||(adj[a]=[])).push(b); (adj[b]||(adj[b]=[])).push(a); };
  /* A valve's own path is a link this graph must carry, but it is not a length of steel and loopMap() has to tell them apart. Per undirected PAIR, because a fitting also carries fold links that are solid metal. */
  const gate={}, gateKey=(u,v)=>u<v?u+"|"+v:v+"|"+u;
  for(const p of LAY.parts){
    const R=ROLE[p.role]; if(!R||!R.internal) continue;
    for(const IN of (Array.isArray(R.internal)?R.internal:[R.internal])){
      note(p.id,IN.a); note(p.id,IN.b); link(p.id+IN.a, p.id+IN.b);
      if(IN.gate && fitModeOf(p.id)!=="tee") gate[gateKey(p.id+IN.a, p.id+IN.b)]=1; }
  }
  /* Connections, never D.ports: an unplumbed port contributes no node, or a generator's tubes fold onto its shell in the "still one vessel" pass below. */
  for(const c of pipeTrace().conns){
    const a=partOf(c.a), b=partOf(c.b); if(!a||!b) continue;
    note(a.id,c.sa); note(b.id,c.sb);
    link(a.id+c.sa, b.id+c.sb);
    /* A LIST per undirected pair: two runs may join the same faces, and the link survives while either one is open (portDead() is the reader). */
    const rk=gateKey(a.id+c.sa, b.id+c.sb);
    (runPorts[rk]||(runPorts[rk]=[])).push([c.pa, c.pb]);
  }
  /* A component that declares no path is still one vessel: two pipes on a tank are the same water. One that DOES declare its paths is taken at its word. */
  for(const p of LAY.parts){
    const R=ROLE[p.role]; if(R && R.internal) continue;
    const ns=nodesOf[p.id]; if(!ns) continue;
    for(let i=1;i<ns.length;i++) link(ns[0], ns[i]);
  }
  /* A fold is a link: foldMap() (pipenet.js) and this graph must not disagree about which faces are one piece of steel. */
  for(const p of LAY.parts){
    const f=foldFacesOf(p); if(!f) continue;
    if(Array.isArray(f)){ for(let i=1;i<f.length;i++) link(p.id+f[0], p.id+f[i]); }
    else for(const face in f) link(p.id+face, p.id+f[face]);
  }
  /* `dead` is an EDGE cut: one face may carry two ports, so a node cut would take the other run with it. */
  const reach=(seeds,cut,noGate,dead)=>{ const seen={}, stack=[];
    for(const n of seeds) if(!seen[n]){ seen[n]=1; stack.push(n); }
    while(stack.length){ const u=stack.pop();
      for(const v of (adj[u]||[])){
        if(seen[v] || (cut && cut[v])) continue;
        const k=(noGate||dead) ? gateKey(u,v) : null;
        if(noGate && gate[k]) continue;
        if(dead && dead[k]) continue;
        seen[v]=1; stack.push(v); } }
    return seen; };
  /* A circuit is a connected component and nothing more - no hop count, no rank. coreCirc is -1 with no core, and a part piped to nothing still gets its own index. */
  const circuit={}; let nCirc=0;
  const allNodes=[]; for(const pid in nodesOf) for(const n of nodesOf[pid]) allNodes.push(n);
  for(const n of allNodes){ if(circuit[n]!==undefined) continue;
    const seen=reach([n]); const i=nCirc++;
    for(const m in seen) circuit[m]=i; }
  /* Every vessel's circuit is a primary; coreCirc stays the FIRST vessel's, which is what a reader asking for one index means by it. */
  const cores = LAY.parts.filter(p=>p.role==="core");
  const coreCircs={};
  for(const p of cores) for(const n of (nodesOf[p.id]||[]))
    if(circuit[n]!==undefined) coreCircs[circuit[n]]=1;
  const coreSeed = cores.length ? (nodesOf[cores[0].id]||[])[0] : undefined;
  const coreCirc = coreSeed===undefined ? -1 : circuit[coreSeed];
  const inCore = n => coreCircs[circuit[n]]===1;
  nodeGraphCache={adj, nodesOf, runPorts, circuit, nCirc, coreCirc, coreCircs, inCore, reach, sig}; nodeGraphSig=sig;
  return nodeGraphCache;
}
/* Hung on the node graph's own IDENTITY, so a superseded graph takes its answers with it and nothing has to invalidate anything. One named slot per question. */
function graphSlot(name){
  const G=nodeGraph();
  const m=G.slots || (G.slots={});
  return m[name] || (m[name]=new Map());
}
function loopMap(){
  const s=graphSlot("loopMap"), was=s.get(1); if(was) return was;
  const G=nodeGraph(), partLoop={};
  /* Seeded on each generator's PRIMARY nodes with the core's own nodes CUT, because the core is the shared hub. Pass one cuts every gate so a cross-tie cannot merge two standing loops; pass two crosses them and picks up the in-line throttle. */
  let nextLoop=0;
  const cut={}; for(const q of LAY.parts) if(q.role==="core") for(const n of (G.nodesOf[q.id]||[])) cut[n]=1;
  /* and at the drum's own nozzles: a loop ends where the steam leaves it and the feed water comes back in, or the walk claims the turbine hall and prices its lines at the whole leg flow */
  for(const n in drumFence().loop) cut[n]=1;
  const seeded=[];
  const claim=(p,i,noGate)=>{
    const seen=G.reach((G.nodesOf[p.id]||[]).filter(n=>G.inCore(n)), cut, noGate);
    for(const q of LAY.parts){
      if(!LOOP_ROLE[q.role] || q.role==="core" || partLoop[q.id]!==undefined) continue;
      if((G.nodesOf[q.id]||[]).some(n=>seen[n])) partLoop[q.id]=i;
    }
  };
  /* seeded on the BOILERS the plant has: one nobody piped is not a loop of its own, and on a direct cycle the thing at the top of the loop is a drum */
  for(const id of boilerIds()){
    if(partLoop[id]!==undefined) continue;
    const p=partOf(id), i=nextLoop++;
    partLoop[id]=i; seeded.push({p,i});
    claim(p,i,true);
  }
  for(const {p,i} of seeded) claim(p,i,false);
  const out={partLoop, n:nextLoop}; s.set(1,out);
  return out;
}
/* nodeGraph() carries no state, so a live question hands its reach() an EDGE cut instead. A run is dead only when BOTH its ports cannot pass. */
function portDead(s){
  const shut = s && s.portShut; if(!shut) return null;
  let sig=""; for(const k in shut) if(shut[k]) sig+=k+",";
  if(!sig) return null;
  const slot=graphSlot("portDead"), was=slot.get(sig); if(was) return was;
  const G=nodeGraph(), out={};
  for(const k in G.runPorts)
    if(G.runPorts[k].every(([a,b])=>shut[a]||shut[b])) out[k]=1;
  slot.set(sig,out);
  return out;
}
function secGensFromNode(node, cut, dead){
  const G=nodeGraph();
  if(G.inCore(node)) return [];
  const seen=G.reach([node], cut, false, dead);
  return LAY.parts.filter(p=>p.role==="sg" &&
    (G.nodesOf[p.id]||[]).some(n=>seen[n] && !G.inCore(n))).map(p=>p.id);
}
/* Which runs short the two sides together - not forbidden, only named. Asked with the run itself CUT, or the run under test makes itself look innocent. */
function crossTies(){
  const G=nodeGraph(), out=[];
  for(const c of pipeMap().conns){
    const a=partOf(c.a), b=partOf(c.b); if(!a||!b) continue;
    const na=a.id+c.sa, nb=b.id+c.sb;
    if(!G.adj[na] || !G.adj[nb]) continue;
    /* Ask the second side of the GENERATORS rather than of "not the first", or a tank on a dead-end branch reads as secondary purely by being unreachable. */
    const cut={}; cut[na]=1; cut[nb]=1;
    /* Each end walked on its own, so a tie into shell A and one into shell B are two findings and not one. */
    const side=n=>G.reach((G.adj[n]||[]).filter(v=>!cut[v]), cut);
    const A=side(na), B=side(nb);
    if(Object.keys(A).some(n=>B[n])) continue;
    const holds=(seen,pid)=>(G.nodesOf[pid]||[]).some(n=>seen[n]);
    const coreIn=seen=>coreIds().find(id=>holds(seen,id))||null;
    const shellOf=seen=>{ const q=LAY.parts.find(q=>ROLE[q.role] && ROLE[q.role].sgtr && holds(seen,q.id));
      return q?q.id:null; };
    let far=null, core=coreIn(A);
    if(core) far=shellOf(B);
    else if((core=coreIn(B))) far=shellOf(A);
    if(!far) continue;
    out.push({key:c.key, a:core, b:far});
  }
  return out;
}
const secondaryNode=node=>!nodeGraph().inCore(node);
/* Is this face on the machine's own k-th stream - 0 gives the heat up, 1 takes it. The declaration's ORDER, never "the core cannot reach it": a barrier upstream names both sides of a generator. */
const onStage=(pid,face,k)=>{ const p=partOf(pid), IN=p && roleIns(p)[k];
  return !!IN && (IN.a===face || IN.b===face); };
/* A generator has nodes on two circuits, so only a STREAM has an answer. -1 when nothing is piped to it, which reads as water. */
const stageCirc=(pid,k)=>{ const p=partOf(pid), IN=p && roleIns(p)[k];
  if(!IN) return -1;
  const c=nodeGraph().circuit[pid+IN.a];
  return c===undefined ? -1 : c; };
const shellCirc=pid=>stageCirc(pid,1);
/* The same walk, the other side of the tube wall: a generator belongs to the core it can reach, which is a fact about the drawing and not about a name. */
const sgPrimCirc=pid=>stageCirc(pid,0);
// on the graph (graphSlot()): feedHeadMax() asks this of every pump per run per tick
function secGensOf(pid){
  const slot=graphSlot("secGensOf"), was=slot.get(pid); if(was) return was;
  const G=nodeGraph(), out=[];
  for(const n of (G.nodesOf[pid]||[])){
    for(const g of secGensFromNode(n)) if(!out.includes(g)) out.push(g);
    /* a drum stands on the core's own circuit, so the inCore() test above can never see one: what makes this a feed pump is reaching the OUTBOARD face of the drum's own regulating valve */
    for(const g of drumFedFrom(n)) if(!out.includes(g)) out.push(g); }
  slot.set(pid,out);
  return out;
}
/* Every shell as a feed end and a steam end, declared FEED then STEAM in that order; on the graph, because shellsOf() walks this once per shell per relief valve per frame. */
const shellFaces=()=>{
  const slot=graphSlot("shellFaces"), was=slot.get(1); if(was) return was;
  const out=[];
  for(const p of LAY.parts){ const R=ROLE[p.role]; if(!R||!R.sgtr) continue;
    const IN=roleIns(p)[1]; if(IN) out.push({id:p.id, feed:IN.a, steam:IN.b}); }
  slot.set(1,out);
  return out; };
/* Walked with every shell CUT AT ITS FEED END: the secondary is a loop, so plain connectivity can never see a severed steam line - it goes round the other way up the feedwater train. NOT filtered by circuit, because a cross-tie IS a path. */
let secCircCache=null, secCircFor=null;
function secCircuitOf(pid, seeds){
  const G=nodeGraph();
  if(secCircFor!==G){ secCircCache={}; secCircFor=G; }
  const key=pid+"|"+(seeds?seeds.join(","):"");
  if(secCircCache[key]) return secCircCache[key];
  const cut={}; for(const sh of shellFaces()) cut[sh.id+sh.feed]=1;
  /* and at a drum's own feed valve, for the same reason: the secondary is a loop, and on a direct cycle it comes round the other way through the core */
  for(const n in drumFence().feed) cut[n]=1;
  const seen=G.reach(seeds||G.nodesOf[pid]||[], cut), out={sg:false, turb:false, sink:false, boiler:false};
  for(const p of LAY.parts){ const R=ROLE[p.role]; if(!R) continue;
    if(!(G.nodesOf[p.id]||[]).some(n=>seen[n])) continue;
    if(p.role==="sg")      out.sg=out.boiler=true;
    if(isDrum(p.id))       out.boiler=true;
    if(p.role==="turb")    out.turb=true;
    if(R.thermal==="sink") out.sink=true; }
  return (secCircCache[key]=out);
}
/* The share that is piped up, beside roleAlive()'s share that is unbroken - a machine can be both. No turbine is not an unpiped turbine, so none of none is 1. */
const turbPiped=()=>{ const ids=LAY.parts.filter(p=>p.role==="turb").map(p=>p.id);
  if(!ids.length) return 1;
  return ids.filter(id=>{ const c=secCircuitOf(id); return c.boiler&&c.sink; }).length/ids.length; };
/* Seeded at the shell's STEAM face, cut at every shell's FEED face and at the CONDENSER, or the walk reaches the condensate line the long way round. Cut the turbine too and what is left is the HEADER at shell pressure. */
function steamNodesOf(sgId, cutTurb, dead){
  const G=nodeGraph(), sh=shellFaces().find(s=>s.id===sgId);
  if(!sh) return {};
  const cut={};
  for(const s2 of shellFaces()) cut[s2.id+s2.feed]=1;
  for(const p of LAY.parts){ const R=ROLE[p.role]; if(!R) continue;
    if(R.thermal==="sink" || (cutTurb && p.role==="turb"))
      for(const n of (G.nodesOf[p.id]||[])) cut[n]=1; }
  return G.reach([sgId+sh.steam], cut, false, dead);
}
const sgSteams=id=>{ const sh=shellFaces().find(s=>s.id===id);
  if(!sh) return true;                       // no shell to ask of: not a machine this gates
  const c=secCircuitOf(id,[id+sh.steam]); return c.turb&&c.sink; };
/* Which shells a part is exposed to; empty means the primary or the cold side of the secondary. `dead` is optional and is a LIVE question - which side of the plant a valve is on must not change under a hand on a port valve. */
function shellsOf(pid, dead){
  const slot = dead ? null : graphSlot("shellsOf");
  if(slot){ const was=slot.get(pid); if(was) return was; }
  const G=nodeGraph(), cut={}, out=[];
  for(const sh of shellFaces()) cut[sh.id+sh.feed]=1;
  for(const n of (G.nodesOf[pid]||[]))
    for(const g of secGensFromNode(n,cut,dead)) if(out.indexOf(g)<0) out.push(g);
  if(slot) slot.set(pid,out);
  return out;
}
// which loop a PART pools capacity with, or null - never read as "is it plumbed at all"
const loopOf = id => { const v=loopMap().partLoop[id]; return v===undefined?null:v; };
const ihxIds=()=>roleAll("ihx");
const ihxCount=()=>ihxIds().length;
const IHX_T_PER_UA   = 8.0e-4;         // t per kW/K - vessel, tubes, intermediate loop
/* Saturation SG_APPROACH below the coolant programme, off the COOLANT row and never P. SG_P_MAX is not a curve guard: past it the UA that dT0 implies runs the core into its own HIGH FLUX trip. */
const SG_APPROACH = 25, SG_P_MAX = 17.0, SG_P_MIN = 0.2;
/* Off D alone: this is read while the BOXES are being sized, so LAY does not exist yet and drumIds() cannot be asked. No generator and a vessel drawn with a steam space is a direct cycle. */
const drumDrawn = () => !Object.keys(D.machines).some(id=>D.machines[id].kind==="sg")
  && Object.keys(D.tanks).some(id=>{ const t=D.tanks[id];
       return !!t && !!t.cell && !t.gas && !t.hold && !t.inf && clamp(t.level,0,100) < 100; });
/* on a direct cycle there is no approach to take: the steam side IS the core's circuit and its design pressure is that circuit's working pressure */
const sgDesPSuggest = () => drumDrawn() ? COOLANT[priD().cool].P0
  : clamp(psatSec(COOLANT[priD().cool].Tref - SG_APPROACH), SG_P_MIN, SG_P_MAX);
/* `?? xSuggest()`, NEVER bake(): baking a PWR's figure at boot would leave every shell rated for water after the coolant is changed. */
const sgDesPOf = id => D.sgDesP[id] ?? sgDesPSuggest();
/* The plant-wide figure for anchors about the steam side as a whole. The MEAN, so a mixed plant is not silently rated at its strongest machine. */
function sgDesignP(id){
  if(id !== undefined) return sgDesPOf(id);
  const ids = sgIds();
  if(!ids.length) return sgDesPSuggest();
  let p = 0; for(const q of ids) p += sgDesPOf(q);
  return p/ids.length;
}
/* The inverse of the tick's own law (sgQAt, step.js): effectiveness is rise over approach and the UA is that NTU at the loop's own w*cp, capped so an impossible cold leg is not answered with infinity. */
const SG_EPS_MAX = 0.98;
const sgUASuggest = () => { const n=Math.max(1,sgCount()), a=COOLANT[priD().cool];
  const dT0=coreDT0(), tsatS=tsatSec(sgDesignP());
  /* A boiling primary gives its heat up at ONE temperature, so the tubes are a plain conductance against it and the rise is quality, not kelvin. */
  const p0=holdSetP(nodeGraph().coreCirc), tsatP=a.tsat*Math.pow(p0/a.P0, coolSatN(a));
  if(a.Tref + dT0/2 >= tsatP) return RATED_KW()/(n*Math.max(5, tsatP - tsatS));
  const appr=Math.max(1e-3, a.Tref + dT0/2 - tsatS);
  const eps=Math.min(dT0/appr, SG_EPS_MAX);
  return -Math.log(1-eps)*RATED_KW()/(n*dT0); };
const ihxUASuggest = () => sgUASuggest()*2.5;
const sgUAOf  = id => D.sgUA[id]  ?? sgUASuggest(id);
const ihxUAOf = id => D.ihxUA[id] ?? ihxUASuggest(id);
const totalIhxMass=()=>{ let m=0;
  for(const p of LAY.parts) if(p.role==="ihx") m+=partMassOf(p.id);
  return m; };
/* t per m^2 at massK 1, priced against RAD_AREA_CELL rather than off a real panel: the area is a scale lie of order 10^5. */
const RAD_MASS_M2=6.5e-5;
/* Emissivity is real; the mass and survival columns are what make each row a trade rather than a strictly better coating. */
const RADCOAT=[
  ["BARE METAL",              {emis:0.30, massK:0.85, tsurvK:1.15}],
  ["WHITE PAINT",             {emis:0.85, massK:1.00, tsurvK:1.00}],
  ["HIGH-EMISSIVITY CERAMIC", {emis:0.94, massK:1.35, tsurvK:0.80}],
];
const radIds=()=>roleAll("radiator");
const radCount=()=>radIds().filter(partPiped).length;
const radCoatOf=id=>RADCOAT[D.radCoat[id]??1][1];
/* The one fudge here, and it is bought balance: a grid cell is 0.218 m2 and rejecting the stock plant's heat needs order 10^6 m2, the same scale lie the hull already carries. Set once off the stock rated rejection at RAD_TDES; do NOT tune it afterwards to recover output. */
const RAD_AREA_CELL=62468;             // m^2 of panel one grid cell is worth
const SIGMA=5.670374419e-8;            // W/m^2/K^4, published
const T_SPACE=3;                       // K - and (T^4 - T_SPACE^4) is T^4 to 12 digits
/* K, the canonical reference sink, NOT the sink the plant has (s.radTBy). Derived backwards from the turbine trip: tsatSec(TURB_TRIP_P) less a working margin less COND_DT0. */
const RAD_TDES=307;
/* hullCell() answers true off-grid, so a panel sitting ON the hull ring passes on its own cells. */
const radLive=id=>{ const p=partOf(id); if(!p) return false;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    for(const f in DIRV){ const d=DIRV[f];
      if(hullCell(X+d[0],Y+d[1])) return true; }
  return false; };
/* The AREA is the quantity, m2; the drawing snaps to whole cells to represent it, and RAD_AREA_CELL is the scale of that picture. */
/* Off D.machines and NOT off LAY.parts: a panel's box follows its area, so this is asked from inside buildLayout(), before there is a drawing to ask. */
const radSrcCount=()=>{ let n=0;
  for(const id in D.machines) if(machRole(id)==="radiator") n++;
  return Math.max(1,n); };
/* Panels sit in SERIES on one circulating-water run, so the first sheds more than the last and neither is the mean this divides by; sized at the mean share the pair runs hot, and sigma*T^4 turns that straight into condenser backpressure. */
const SINK_MARGIN=1.18;
/* One panel's share of the plant's rejection at the sink the condenser was priced against; never derived(), which would ask itself. */
const radAreaSuggest=id=>plantDuty()*SINK_MARGIN*1000
  /(radCoatOf(id).emis*SIGMA*Math.pow(RAD_TDES,4))/radSrcCount();
/* Baked on first read: radAreaSuggest() divides by the panel COUNT, so a live `??` would let a third panel shrink the two already fitted. */
const radAreaOf=id=>D.radArea[id] ?? radAreaSuggest(id);
const radArea=id=>{ const p=partOf(id);
  return (p && radLive(id)) ? radAreaOf(id) : 0; };
/* The area says what a panel can radiate; the UA says how fast the water in it hands that heat over. RAD_DT0 is the bought approach, coolant in less panel. */
const RAD_DT0=8;
const radUASuggest=id=>radCoatOf(id).emis*SIGMA*radAreaOf(id)
  *Math.pow(RAD_TDES,4)/1000/RAD_DT0;
const radUAOf=id=>D.radUA[id] ?? radUASuggest(id);
/* NEAREST, floored at 2x2: the drawing snaps to the area, never the area to the drawing. Shaped 5x3. */
const radBoxCells=id=>clamp(Math.round(radAreaOf(id)/RAD_AREA_CELL),4,60);
const radW=id=>clamp(Math.round(Math.sqrt(radBoxCells(id)*5/3)),2,11);
const radH=id=>Math.max(2,Math.ceil(radBoxCells(id)/radW(id)));
/* W/K^4, one expression: the tick, the readout and the warning all price the same fleet. */
const totalRadEA=()=>{ let k=0;
  for(const p of LAY.parts) if(p.role==="radiator")
    k+=radCoatOf(p.id).emis*radArea(p.id);
  return k*SIGMA; };
/* Where the panels sit at a stated rejection, kW; Infinity when none can see space. */
const radTAt=qkW=>{ const k=totalRadEA();
  return k>0 ? Math.pow(qkW*1000/k + Math.pow(T_SPACE,4), 0.25) : Infinity; };
// ...and at full power, written once because radTAt() takes kW and the trap is handing it megawatts
const radTRated=eff=>radTAt(ratedMWt()*1000*(1-(1-bleedFrac())*eff));
const radMass=id=>radAreaOf(id)*RAD_MASS_M2*radCoatOf(id).massK;   // t
const totalRadMass=()=>{ let m=0;
  for(const p of LAY.parts) if(p.role==="radiator") m+=partMassOf(p.id);
  return m; };

/* Every transfer stage whose HOT side stands on this one's second CIRCUIT: stages in series are circuits in series, so chaining needs nothing here. */
const ihxFeeds=id=>{ const ci=stageCirc(id,1); if(ci<0) return [];
  return LAY.parts.filter(q=>q.id!==id && ROLE[q.role] && ROLE[q.role].thermal==="transfer"
    && stageCirc(q.id,0)===ci).map(q=>q.id); };
// key is "kind:aIdFace-bIdFace"; the PARTS carry loop membership, never the label the run is drawn with
function loopOfKey(key){
  if(!key) return null;
  /* The "#1" suffix (pipeMap()) disambiguates two routes sharing one (part, face) pair; it is not part of either node's name. */
  key=key.split("#")[0];
  const ci=key.indexOf(":"); if(ci<0) return null;
  const rest=key.slice(ci+1), di=rest.indexOf("-");
  if(di<0) return null;                       // a tap-ended run has no loop identity of its own
  const aP=rest.slice(0,di-1), bP=rest.slice(di+1,-1);   // strip each node's single-letter face
  const {partLoop}=loopMap();
  return partLoop[aP]!==undefined ? partLoop[aP] : (partLoop[bP]!==undefined ? partLoop[bP] : null);
}
/* Per INSTANCE, off its own bore; FIT_BORE0 is the bore a fitting nobody sized takes (fitBoreSuggest(), pipenet.js). */
const FIT_MASS=16, FIT_BORE0=412.5;   // mm, the default valve - the reference the mass is per
const fitMassOf=id=>D.fittings[id] ? FIT_MASS*(fitBoreMm(id)/FIT_BORE0) : 0;
const fittingMass=()=>{ let m=0;
  for(const id in D.fittings) m += fitMassOf(id);
  return m; };

/* D.ports[pid] = {p, dx, dy, m}: an OFFSET from the part's origin, so a port rides its part with no writeback, and the FACE is derived from it rather than stored. */
function freePid(){ let n=0; while(D.ports["prt"+n]) n++; return "prt"+n; }
const partOf=id=>(LAY&&LAY.byId.get(id))||null;
/* The first machine of a role on the drawing, or null: an id literal is a name test, and a blank grid has none of any of them. */
const roleOf=role=>(LAY&&LAY.parts.find(p=>p.role===role))||null;
const roleId=role=>{ const p=roleOf(role); return p?p.id:null; };
const roleAll=role=>LAY?LAY.parts.filter(p=>p.role===role).map(p=>p.id):[];
/* THE ONE DOOR: `p.access` is undefined between a rebuild and the next layoutMetrics(), and undefined is unasked, not blocked - so asking makes the measure happen. */
const partAccess = p => {
  if(!p) return true;
  if(p.access===undefined) layoutMetrics();
  return p.access!==false;
};
const coreIds=()=>roleAll("core");
const primaryCore=()=>roleId("core");
const coreOf=pid=>{ const p=partOf(pid); if(!p) return null;
  if(p.role==="core") return pid;
  const m=D.machines[pid], h=m&&m.on&&partOf(m.on); return h&&h.role==="core" ? m.on : null; };
const rodsOf=cid=>{ for(const p of LAY.parts){ const m=D.machines[p.id];
    if(p.role==="rods"&&m&&m.on===cid) return p.id; } return null; };
const coreCircOf=id=>{ const G=nodeGraph(), ns=G.nodesOf[id]; return ns&&ns.length ? G.circuit[ns[0]] : -1; };
const coreOnCirc=ci=>coreIds().filter(id=>coreCircOf(id)===ci);
/* Off faceOfOffset() and nothing else; NULL where a part has grown past its own port, and every caller asks. */
function portFaceOf(pid){
  const q=D.ports[pid]; if(!q) return null;
  const p=partOf(q.p); if(!p) return null;
  return faceOfOffset(p,q.dx,q.dy);
}
// the grid cell a port occupies, or null if its part has left the board
function portCell(pid){
  const q=D.ports[pid]; if(!q) return null;
  const p=partOf(q.p); if(!p) return null;
  return [p.x+q.dx, p.y+q.dy];
}
// ROLE.ports read as a whitelist rather than a count; no table at all means no port
function portFaceOK(partId,face){
  const p=partOf(partId), R=p&&ROLE[p.role];
  return !!R && R.ports && (R.ports["*"]!=null || R.ports[face]!=null);
}
// null inside the footprint, off a corner, or more than one cell clear: a port sits ON the shell, never out in the room
function faceOfOffset(p,dx,dy){
  const inX = dx>=0 && dx<p.w, inY = dy>=0 && dy<p.h;
  if(inX && dy===-1)  return "t";
  if(inX && dy===p.h) return "b";
  if(inY && dx===-1)  return "l";
  if(inY && dx===p.w) return "r";
  return null;
}
function portAtCell(x,y){
  for(const pid in D.ports){ const c=portCell(pid);
    if(c && c[0]===x && c[1]===y) return pid; }
  return null;
}
/* The offset is the caller's and the face falls out of it; refuses a cell the role does not whitelist, one already carrying a port, and one something else stands in. */
function addPortAt(partId,dx,dy){
  const p=partOf(partId); if(!p) return null;
  const f=faceOfOffset(p,dx,dy); if(!f || !portFaceOK(partId,f)) return null;
  const x=p.x+dx, y=p.y+dy;
  if(x<0||y<0||x>=GW||y>=GH) return null;
  if(portAtCell(x,y)) return null;
  if(occupied(null,{ports:false})[y][x]) return null;
  const pid=freePid();
  D.ports[pid]={p:partId, dx, dy};
  return pid;
}
/* The pipe stays: a connection is TRACED, so taking the port away leaves the cells dangling, which is what an unterminated pipe is. */
function removePort(pid){
  delete D.ports[pid];
  buildLayout();
}

/* D.pipes["x,y"] = {s:<shape>, r:<rotation 0..3>}, cell-keyed: a pipe cell's identity IS its cell, so it carries no name, bore or state, and it stays OUT of LAY.parts. */
const ROT={l:"t",t:"r",r:"b",b:"l"};
const OPP={l:"r",r:"l",t:"b",b:"t"};
const FACE_NAME={l:"LEFT", r:"RIGHT", t:"TOP", b:"BOTTOM"};
const DIRV={l:[-1,0],r:[1,0],t:[0,-1],b:[0,1]};
/* <= and >= so an off-grid neighbour answers true: the skin and beyond it are the same side of the wall. */
const hullCell=(x,y)=>x<=0||y<=0||x>=GW-1||y>=GH-1;
const rotFace=(f,n)=>{ for(let i=0;i<((n%4)+4)%4;i++) f=ROT[f]; return f; };
/* One row per SHAPE. A cross carries TWO paths that never join, so a crossing needs no special case: the face entered on says which one you are on. */
const PIPE_SHAPE={
  straight:{paths:[["l","r"]]},
  turn    :{paths:[["l","t"]]},
  cross   :{paths:[["l","r"],["t","b"]]},
};
const pipeKey=(x,y)=>x+","+y;
/* The other end of the path this face is on, or null if the cell does not open on it. */
function pipeExit(cell,face){
  const c=D.pipes[cell]; if(!c) return null;
  const sh=PIPE_SHAPE[c.s]; if(!sh) return null;
  for(const pr of sh.paths){
    const a=rotFace(pr[0],c.r), b=rotFace(pr[1],c.r);
    if(face===a) return b;
    if(face===b) return a;
  }
  return null;
}
/* Shared by the stock seeder and the bench's drag, so a hand-laid corner and a seeded one are the same data. */
function pipeShapeFor(fa,fb){
  if(fa===OPP[fb]) return {s:"straight", r:(fa==="l"||fa==="r")?0:1};
  for(let r=0;r<4;r++){
    const a=rotFace("l",r), b=rotFace("t",r);
    if((a===fa&&b===fb)||(a===fb&&b===fa)) return {s:"turn", r};
  }
  return null;
}
const pipeDirOf=(a,b)=>{ const dx=b[0]-a[0], dy=b[1]-a[1];
  return dx>0?"r" : dx<0?"l" : dy>0?"b" : dy<0?"t" : null; };
/* D.runs[rid] = {a, b, pins, cells}: THE RECIPE, never the truth - pipeTrace() stays the one authority for what is joined to what. `rid` is a name geometry cannot rename, and `cells` is what the last lay stamped and what the lift takes back. */
/* Module state and not a D field: where a run could not be laid is a property of the last lay, not of the design, and nothing comparing a design signature may see it move. */
const RUNERR={};
const runErr=rid=>RUNERR[rid]||null;
/* The colon is load-bearing: `sel` carries a run's identity and a part id never contains one, so the two selection spaces cannot collide. */
function freeRid(){ let n=0; while(D.runs["run:"+n]) n++; return "run:"+n; }
function mintRun(a,b,pins){
  const rid=freeRid();
  D.runs[rid]={a:[a[0],a[1]], b:[b[0],b[1]], pins:(pins||[]).map(c=>[c[0],c[1]])};
  RUNERR[rid]=null;                   // ids are reused, and so is the last one's refusal
  return rid;
}
/* Nothing CHOOSES a port: the hand put the end on a cell, and either a machine beside it whitelists that face or the end is loose. */
function runEndPort(x,y){
  const g=occupied(null,{pipes:false, ports:false, mat:false});
  for(const f in DIRV){
    const mx=x+DIRV[f][0], my=y+DIRV[f][1];
    if(mx<0||my<0||mx>=GW||my>=GH) continue;
    const p=g[my][mx]; if(!p||!p.role) continue;
    const face=faceOfOffset(p, x-p.x, y-p.y);
    if(!face || !portFaceOK(p.id,face)) continue;
    return {part:p.id, face, dx:x-p.x, dy:y-p.y};
  }
  return null;
}
/* Walks out from the cell asked for: an end dropped inside a machine is a run nobody can see and nobody can grab. */
function runSpotNear(x,y){
  const g=occupied([],{mat:false});
  const ok=(cx,cy)=>cx>=0&&cy>=0&&cx<GW&&cy<GH&&!g[cy][cx];
  for(let r=0;r<GW+GH;r++) for(let dx=-r;dx<=r;dx++){
    const dy=r-Math.abs(dx);
    for(const s of (dy?[dy,-dy]:[0])) if(ok(x+dx,y+s)) return [x+dx,y+s];
  }
  return null;
}
// the port at this run's end: its own, one nobody has claimed, or nothing
function runPortFor(rid,cell){
  const at=portAtCell(cell[0],cell[1]);
  if(at!=null){ const q=D.ports[at];
    if(q.run!==undefined && q.run!==rid) return null;
    q.run=rid; return at; }
  const e=runEndPort(cell[0],cell[1]); if(!e) return null;
  const pid=addPortAt(e.part,e.dx,e.dy); if(pid==null) return null;
  D.ports[pid].run=rid;
  return pid;
}
/* Cells and nozzles both, leaving every other run where it stands: "a laid pipe is frozen" is enforced here and not by re-laying the neighbours. */
function runLift(rid){
  const r=D.runs[rid]; if(!r) return;
  const cs=r.cells||[];
  for(let i=0;i<cs.length;i++){
    const k=pipeKey(cs[i][0],cs[i][1]), c=D.pipes[k]; if(!c) continue;
    if(c.s!=="cross"){ delete D.pipes[k]; continue; }
    /* One of a crossing's two paths is somebody else's, so what is left is the other axis straight through. */
    const n=i+1<cs.length?cs[i+1]:null, p=i>0?cs[i-1]:null;
    const d=n?pipeDirOf(cs[i],n):(p?pipeDirOf(p,cs[i]):null);
    D.pipes[k]=(d==="l"||d==="r")?{s:"straight", r:1}:{s:"straight", r:0};
  }
  delete r.cells;
  for(const pid in D.ports) if(D.ports[pid].run===rid) delete D.ports[pid];
}
// ...and take the whole run off, recipe included
function removeRun(rid){ runLift(rid); delete D.runs[rid]; delete RUNERR[rid]; buildLayout(); }
/* An index into the run's own cells, or -1. The cut CELL goes, so there has to be a cell left on each side: two stubs across no gap are one pipe again. */
function runSplitIdx(rid,cell){
  const r=D.runs[rid], cs=r&&r.cells; if(!cs) return -1;
  const i=cs.findIndex(c=>c[0]===cell[0]&&c[1]===cell[1]);
  return (i>=1 && i<=cs.length-2) ? i : -1;
}
/* Two runs is what a cut pipe IS, each with its own end, waypoints and name. The FIRST half keeps `rid`, so an authored bore stays with the half that still reaches end A's machine. */
function splitRun(rid,cell){
  const i=runSplitIdx(rid,cell); if(i<0) return null;
  const r=D.runs[rid], cs=r.cells;
  const at=c=>cs.findIndex(q=>q[0]===c[0]&&q[1]===c[1]);
  const before=r.pins.filter(p=>{ const j=at(p); return j>=0 && j<i; });
  const after =r.pins.filter(p=>{ const j=at(p); return j>i; });
  const a=r.a, b=r.b, endA=cs[i-1].slice(), startB=cs[i+1].slice();
  runLift(rid);
  D.runs[rid]={a, b:endA, pins:before};
  const rid2=mintRun(startB, b, after);
  runLay(rid); runLay(rid2);
  return rid2;
}
/* A route passes a cell once, so a run asked to pass one twice has no route at all. Asked by the DRAWING too, so the picture says the drop will collapse before the hand lets go. */
function runPinDup(rid,i){
  const r=D.runs[rid], c=r&&r.pins[i]; if(!c) return false;
  const same=q=>q[0]===c[0]&&q[1]===c[1];
  return same(r.a) || same(r.b) || r.pins.some((q,j)=>j!==i&&same(q));
}
// the dragged pin STANDS and what it landed on goes; landed on an END, the pin goes instead
function runPinCollapse(rid,i){
  if(!runPinDup(rid,i)) return;
  const r=D.runs[rid], c=r.pins[i];
  const same=q=>q[0]===c[0]&&q[1]===c[1];
  r.pins=r.pins.filter((q,j)=>j===i || !same(q));
  if(same(r.a)||same(r.b)) r.pins.splice(r.pins.indexOf(c),1);
  runLay(rid);
}
const OTHEREND={a:"b", b:"a"};
/* THE GESTURE IS OVERLAP: one grip dropped on another. The first run keeps its name and authored bore, and the shared cell becomes a waypoint. Asked of the RECIPE, never the laid cells - the router refuses the second run that wants a cell, so there are none to read. */
function runJoinAt(rid,which){
  const r=D.runs[rid]; if(!r) return null;
  const e=r[which];
  for(const q in D.runs){ if(q===rid) continue;
    for(const w of ["a","b"]) if(D.runs[q][w][0]===e[0] && D.runs[q][w][1]===e[1]) return {rid:q, which:w};
  }
  return null;
}
function mergeRuns(rid,which,rid2,which2){
  const r=D.runs[rid], q=D.runs[rid2];
  // waypoints in route order, read from the FAR end of each half toward the joint
  const from=(run,w)=> w==="b" ? run.pins.slice() : run.pins.slice().reverse();
  const pins=from(r,which).concat([r[which].slice()], from(q,OTHEREND[which2]));
  const a=r[OTHEREND[which]].slice(), b=q[OTHEREND[which2]].slice();
  runLift(rid); runLift(rid2);
  delete D.runs[rid2]; delete RUNERR[rid2]; delete D.bore[rid2]; delete D.wall[rid2];
  D.runs[rid]={a, b, pins};
  runLay(rid);
  return rid;
}
/* A* over cells carrying a DIRECTION. Cost is in cells: one per cell, a turn charge, a crossing charge, a discount for bundling beside an existing run, and a charge for hugging a machine wall. A FEEL choice, not a measurement. */
const ROUTE_K={turn:4, cross:8, hug:0.5, standoff:1.0};
const DIRI=["l","r","t","b"];             // 4 = no direction yet
// the paths a cell already opens, or null for bare floor
function pipePathsAt(k){
  const c=D.pipes[k], sh=c&&PIPE_SHAPE[c.s];
  return sh?sh.paths.map(pr=>[rotFace(pr[0],c.r), rotFace(pr[1],c.r)]):null;
}
const pathAxis=f=>(f==="l"||f==="r")?"h":"v";
function heapPush(h,v){ h.push(v); let i=h.length-1;
  while(i>0){ const p=(i-1)>>1; if(h[p][0]<=h[i][0]) break;
    const t=h[p]; h[p]=h[i]; h[i]=t; i=p; } }
function heapPop(h){ const top=h[0], last=h.pop();
  if(h.length){ h[0]=last; let i=0;
    for(;;){ const l=2*i+1, r=l+1; let m=i;
      if(l<h.length&&h[l][0]<h[m][0]) m=l;
      if(r<h.length&&h[r][0]<h[m][0]) m=r;
      if(m===i) break; const t=h[m]; h[m]=h[i]; h[i]=t; i=m; } }
  return top; }
/* ONE search, not one per leg: the state is (cell, direction, WAYPOINTS PASSED), so the answer is the cheapest route THROUGH the waypoints rather than a chain of separately cheapest legs. */
function runSearch(start,pins,goal,g){
  const free=(x,y)=>{ if(x<0||y<0||x>=GW||y>=GH) return false;
    const o=g[y][x]; return !o || !!o.pipe; };
  const near=(x,y,fn)=>{ for(const f in DIRV){ const nx=x+DIRV[f][0], ny=y+DIRV[f][1];
      if(nx<0||ny<0||nx>=GW||ny>=GH) continue;
      if(fn(nx,ny)) return true; } return false; };
  const wall=(x,y)=>{ const o=g[y][x]; return !!o && !o.pipe && !o.port && !o.mat; };
  const NL=pins.length+1;
  // a waypoint is PASSED THROUGH, so arriving on its cell advances the counter; two on one cell advance it twice
  const past=(l,x,y)=>{ while(l<pins.length && pins[l][0]===x && pins[l][1]===y) l++; return l; };
  const isGoal=(x,y,l)=>l===pins.length && x===goal.x && y===goal.y;
  const idx=(x,y,d,l)=>((y*GW+x)*5+d)*NL+l;
  const best={}, prev={}, heap=[];
  const l0=past(0,start.x,start.y);
  let c0=0;
  if(!isGoal(start.x,start.y,l0)){
    if(!free(start.x,start.y)) return null;
    /* The first cell out of a nozzle may be a crossing too, or a port behind a straight has nowhere to go. */
    const have=pipePathsAt(pipeKey(start.x,start.y));
    if(have){
      if(start.d===4||have.length>1) return null;
      const ax=pathAxis(DIRI[start.d]);
      if(have.some(pr=>pr.some(q=>pathAxis(q)===ax))) return null;
      c0+=ROUTE_K.cross;
    }
  }
  const k0=idx(start.x,start.y,start.d,l0);
  best[k0]=c0; prev[k0]=-1; heapPush(heap,[c0,start.x,start.y,start.d,l0]);
  let found=-1;
  while(heap.length){
    const top=heapPop(heap), c=top[0], x=top[1], y=top[2], d=top[3], l=top[4];
    const k=idx(x,y,d,l);
    if(best[k]!==undefined&&c>best[k]) continue;
    if(isGoal(x,y,l) && (!goal.dir||DIRI[d]===goal.dir)){ found=k; break; }
    for(let i=0;i<4;i++){
      const f=DIRI[i];
      if(d<4&&f===OPP[DIRI[d]]) continue;
      const nx=x+DIRV[f][0], ny=y+DIRV[f][1], nk=pipeKey(nx,ny);
      if(nx<0||ny<0||nx>=GW||ny>=GH) continue;
      const nl=past(l,nx,ny), end=isGoal(nx,ny,nl);
      /* A nozzle opens on ONE face, or the route stops on the port cell running PAST the shell. A loose end is an ordinary cell and obeys every rule below; only a nozzle is exempt. */
      const nozzle=end&&!!goal.dir;
      if(nozzle&&f!==goal.dir) continue;
      if(!nozzle&&!free(nx,ny)) continue;
      const have=pipePathsAt(nk);
      if(have&&!nozzle){
        if(end) continue;                              // a loose end may not sit on another run
        if(d===4||i!==d) continue;                     // a crossing goes STRAIGHT through
        if(have.length>1) continue;                    // that cell is full
        const ax=pathAxis(f);
        if(have.some(pr=>pr.some(q=>pathAxis(q)===ax))) continue;   // sharing a face is a MERGE
      }
      let nc=c+1;
      if(d<4&&i!==d) nc+=ROUTE_K.turn;
      if(have&&!nozzle) nc+=ROUTE_K.cross;
      if(!nozzle){
        if(near(nx,ny,wall)) nc+=ROUTE_K.standoff;
        if(near(nx,ny,(px,py)=>!!pipePathsAt(pipeKey(px,py)))) nc-=ROUTE_K.hug;
        if(nc<=c) nc=c+0.05;                           // the discount may not pay for the step
      }
      const nkk=idx(nx,ny,i,nl);
      if(best[nkk]===undefined||nc<best[nkk]){
        best[nkk]=nc; prev[nkk]=k; heapPush(heap,[nc,nx,ny,i,nl]); }
    }
  }
  if(found<0) return null;
  const out=[];
  for(let k=found;k>=0;k=prev[k]){ const cd=(k-k%NL)/NL, d=cd%5, cell=(cd-d)/5;
    out.push([cell%GW, (cell-cell%GW)/GW]); }
  out.reverse();
  return out;
}
/* Two end cells, the waypoints in order, and the faces the nozzles point along; cells out, or a refusal - never a silent reroute. */
function runRoute(a,b,pins,fa,fb){
  if(a[0]===b[0]&&a[1]===b[1]) return {err:"NO ROUTE - both ends stand on one cell"};
  const g=occupied([],{mat:false});
  const start = fa ? {x:a[0]+DIRV[fa][0], y:a[1]+DIRV[fa][1], d:DIRI.indexOf(fa)}
                   : {x:a[0], y:a[1], d:4};
  const cells=runSearch(start, pins||[], {x:b[0], y:b[1], dir:fb?OPP[fb]:null}, g);
  if(!cells) return {err:"NO ROUTE - the way through is blocked or taken"};
  /* Entering a cell twice on the SAME axis is the route merging with its own earlier leg. Asked of the answer, because no per-step test can see a cell the path has not reached yet. */
  const axes={};
  for(let i=0;i<cells.length;i++){
    const q=i>0?cells[i-1]:null, n=i+1<cells.length?cells[i+1]:null;
    if(!q&&!n) break;                   // one cell: two nozzles a cell apart, a joint
    const ax=pathAxis(pipeDirOf(cells[i], n||q));
    const k=pipeKey(cells[i][0],cells[i][1]);
    if(axes[k]===ax) return {err:"NO ROUTE - it would run into itself"};
    axes[k]=ax;
  }
  return {cells};
}
/* Lay ONE run and only that one: every other run on the board is wall to it. */
function runLay(rid){
  const r=D.runs[rid]; if(!r) return null;
  runLift(rid);
  const pidA=runPortFor(rid,r.a), pidB=runPortFor(rid,r.b);
  /* A run with a nozzle at only one end joins nothing, so it lays no cells and takes no lanes; the recipe stands and drawRunGrips() draws the line the release would become. */
  if(!pidA || !pidB){ RUNERR[rid]=null; buildLayout(); return null; }
  const res=runRoute(r.a,r.b,r.pins, portFaceOf(pidA), portFaceOf(pidB));
  RUNERR[rid]=res.err||null;
  if(res.err){ buildLayout(); return res.err; }
  /* No occupancy test here: one thing per cell is the ROUTER's rule, and a second test could only drop a cell out of the middle of a legal route. */
  // both ends carry a nozzle by now, so everything between them is pipe
  const seq = [r.a].concat(res.cells);
  const laid=[];
  for(let i=1;i<seq.length-1;i++){
    const c=seq[i], q=seq[i-1], n=seq[i+1];
    const k=pipeKey(c[0],c[1]), have=D.pipes[k], want=pipeShapeFor(pipeDirOf(c,q),pipeDirOf(c,n));
    if(!want) continue;
    if(have && have.s==="straight" && want.s==="straight" && have.r!==want.r) D.pipes[k]={s:"cross", r:0};
    else if(!have) D.pipes[k]=want;
    laid.push([c[0],c[1]]);
  }
  r.cells=laid;
  buildLayout();
  return null;
}
/* The traversal unit is a HALF-EDGE (cell, entering face); every connection is found twice and canonicalised by part id then face, so a key is the same string whichever end it was drawn from. */
/* The two halves are load-bearing: runKindFor() asks nodeGraph(), which is built from connections, so naming inside the trace would be a cycle. pipeTrace() is raw geometry, pipeMap() is that plus the names. */
let pipeTraceCache=null, pipeTraceSig="", pipeMapCache=null, pipeMapSig="", pipeMapHeld=false;
const pipeMapHold=on=>{ pipeMapHeld=!!on && !!pipeMapCache && !!pipeTraceCache; };
const pipeSrcSig=()=>laySig()+"|"+pipeSig()+"|"+portSig();
function pipeTrace(){
  if(pipeMapHeld) return pipeTraceCache;
  const sig=pipeSrcSig();
  if(pipeTraceCache && pipeTraceSig===sig) return pipeTraceCache;
  const portBy={};
  for(const pid in D.ports){ const c=portCell(pid); if(c) portBy[pipeKey(c[0],c[1])]=pid; }

  const walk=pid=>{
    const start=portCell(pid), f0=portFaceOf(pid);
    if(!start||!f0) return null;
    const cells=[];
    let d=f0, x=start[0]+DIRV[d][0], y=start[1]+DIRV[d][1];
    for(let guard=0; guard<GW*GH+4; guard++){
      if(x<0||y<0||x>=GW||y>=GH) return {cells, end:"dangle"};
      const k=pipeKey(x,y), q=portBy[k];
      if(q!==undefined) return portFaceOf(q)===OPP[d] ? {cells, end:"port", to:q} : {cells, end:"dangle"};
      if(D.pipes[k]){
        const ex=pipeExit(k, OPP[d]);
        if(!ex) return {cells, end:"butt"};
        cells.push([x,y]);
        d=ex; x+=DIRV[d][0]; y+=DIRV[d][1];
        continue;
      }
      return {cells, end:"dangle"};       // bare floor, or a box with no port here
    }
    return {cells, end:"dangle"};
  };

  const conns=[], dangling=[], seen={};
  for(const pid in D.ports){
    const w=walk(pid);
    if(!w) continue;
    if(w.end!=="port"){ dangling.push({pid, end:w.end, cells:w.cells}); continue; }
    const pair = pid<w.to ? pid+"|"+w.to : w.to+"|"+pid;
    if(seen[pair]) continue;
    seen[pair]=1;
    let pa=pid, pb=w.to, cells=w.cells;
    let fa=portFaceOf(pa), fb=portFaceOf(pb);
    const A=D.ports[pa], B=D.ports[pb];
    if(B.p<A.p || (B.p===A.p && fb<fa)){
      pa=w.to; pb=pid; cells=cells.slice().reverse();
      const t=fa; fa=fb; fb=t;
    }
    conns.push({pa, pb, a:D.ports[pa].p, sa:fa, b:D.ports[pb].p, sb:fb, cells});
  }
  /* Sorted by first cell, so pipeMap()'s "#n" suffix does not turn on object insertion order. */
  conns.sort((u,v)=>{ const a=u.cells[0]||[0,0], b=v.cells[0]||[0,0];
    return a[0]-b[0] || a[1]-b[1]; });
  pipeTraceCache={conns, dangling}; pipeTraceSig=sig;
  return pipeTraceCache;
}
/* The trace with every connection NAMED. Two may share a (part, face) pair, so the collision takes a "#n" suffix; index 0 stays unsuffixed and loopOfKey() strips it. */
function pipeMap(){
  if(pipeMapHeld) return pipeMapCache;
  const sig=pipeSrcSig();
  if(pipeMapCache && pipeMapSig===sig) return pipeMapCache;
  const {conns, dangling}=pipeTrace();
  const byKey={}, cellOwner={}, nth={};
  for(const c of conns){
    // the +1 is the two half-cell port stubs: N cells span N+1 pitches between the shells they join
    c.L=(c.cells.length+1)*MPC;
    c.k=runKindFor(c.a,c.b,c.sa,c.sb);
    const base=c.k+":"+c.a+c.sa+"-"+c.b+c.sb;
    const n=nth[base]=(nth[base]===undefined?0:nth[base]+1);
    c.key = n? base+"#"+n : base;
    /* The run stamped both its nozzles, so both ends naming one rid IS the run's id; a hand-laid run names none and keeps the derived key. */
    const ra=D.ports[c.pa].run, rb=D.ports[c.pb].run;
    if(ra!==undefined && ra===rb) c.rid=ra;
    byKey[c.key]=c;
    for(const [x,y] of c.cells){ const k=pipeKey(x,y);
      (cellOwner[k]||(cellOwner[k]=[])).push(c.key); }
  }
  /* Not the same as dangling: that reaches a port and ends nowhere, this was never on a walk at all. */
  const orphan=[];
  for(const k in D.pipes) if(!cellOwner[k]) orphan.push(k);
  pipeMapCache={conns, byKey, cellOwner, dangling, orphan}; pipeMapSig=sig;
  return pipeMapCache;
}
/* One row per part ROLE, the network + radiation contract. `internal` {a,b,kind} is an edge through the component, face a to face b; `head` puts a pump's own MPa on it, a the SUCTION and b the discharge. `v` m/s and `len` m are the path's DUCT - the velocity its flow area is sized at and the length the water is accelerated over; a path that is not a duct states neither and carries no inertance. `na`/`nb` name each end (five characters at most). `fold` are faces that collapse onto the bare part id. `mu` is attenuation per cell of chord crossed. `ports` is a face WHITELIST, not a count ("*" pools all four). `thermal` is source|transfer|sink|none. `tsurv` is K in the AIR AROUND the machine and `pburst` kPa of blast overpressure, both NULL for structure. A part built with no role takes radMu()'s 0.75 fallback. */
const ROLE = {
  core:  {internal:null, fixed:null, fold:["r","b"], inlet:"b", mu:0.50, sgtr:false,
          ports:{r:4, b:5}, thermal:"source", tsurv:1200, pburst:200},
  rods:  {internal:null, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none", tsurv:450, pburst:35},
  /* Two paths that do not meet - tubes (l<->b, primary) and shell (r<->t, secondary) - crossed only by the sgtr LEAK edge. `a` is the INLET on a shell path: the feed regulating valve's head is signed off it. */
  sg:    {internal:[{a:"l", b:"b", kind:"comp", K:3, v:5, len:20, na:"HOT", nb:"COLD", la:"HOT LEG", lb:"COLD LEG"}, {a:"r", b:"t", kind:"comp", na:"FEED", nb:"STEAM", la:"FEEDWATER", lb:"MAIN STEAM"}], fixed:null, fold:null, mu:0.60, sgtr:true,
          ports:{l:1, b:1, t:1, r:2}, thermal:"transfer", tsurv:800, pburst:200},   // b was 2: the second slot only ever existed for the feed/cold-leg collision. r carries the secondary side - feed in, plus an emergency reserve
  /* Primary in hot at l, out cold at r; the intermediate stream in cold at t, out hot at b. FOUR distinct faces, so no fold - an exchanger has a rotation to get right. */
  ihx:   {internal:[{a:"l", b:"r", kind:"comp", K:3, v:5, len:10, na:"HOT", nb:"COLD", la:"HOT LEG", lb:"COLD LEG"}, {a:"t", b:"b", kind:"comp", K:3, v:2, len:6, na:"COLD", nb:"HOT", la:"INTER COLD LEG", lb:"INTER HOT LEG"}], fixed:null,
          fold:null, mu:0.60, sgtr:false,
          ports:{l:2, r:2, t:2, b:2}, thermal:"transfer", tsurv:800, pburst:200},
  /* One pump role and one head law: what makes a pump a feedwater pump is where it is piped. One path, folded r onto t and l onto b, so it splices into a horizontal leg with no rotation knob. */
  pump:  {internal:{a:"t", b:"b", kind:"pump", head:true, v:5, len:4, na:"IN", nb:"OUT", la:"SUCTION", lb:"DISCHARGE"},
          fixed:null, fold:{r:"t", l:"b"}, mu:0.75, sgtr:false,
          ports:{t:4, b:4, r:4, l:4}, thermal:"none", tsurv:400, pburst:70},
  /* `vapPath` is off `internal` because its resistance is the GATE and not the body, so it takes turbCOf() rather than COMP_C; `work` is what tells the wheels from the bypass around them. */
  turb:  {internal:null, vapPath:{a:"t", b:"b", work:true}, fixed:null, fold:null, mu:0.82, sgtr:false,
          ports:{t:4, b:1}, thermal:"none", tsurv:420, pburst:70},                  // t: one steam run per generator, up to the bench's own 4-loop ceiling
  /* Steam side takes exhaust in at t and gives condensate back at r; the water side (b<->l) is the circulating water, crossed only by the tube wall. */
  cond:  {internal:[{a:"t", b:"r", kind:"comp", vap:"a", anch:"ab", na:"EXH", nb:"COND", la:"EXHAUST", lb:"CONDENSATE"},
                    /* b is the INLET and l the outlet - the water runs b->l - and every component on this circuit declares its inlet as `a`. */
                    {a:"b", b:"l", kind:"comp", v:2, len:12, na:"CW IN", nb:"CW OUT", la:"CIRC WATER IN", lb:"CIRC WATER OUT"}],
          fixed:null, fold:null, mu:0.82, sgtr:false,
          ports:{t:1, r:1, l:1, b:2}, thermal:"sink", tsurv:400, pburst:35},
  ctrl:  {internal:null, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none", tsurv:340, pburst:20},
  /* One role for every tank: what it is made of and what is behind it are per-instance (D.tanks). Faces fold, because a tank's faces are the same water. tsurv/pburst are the ROLE's floor and a heavy vessel states its own. */
  tank:  {internal:null, fixed:{type:"tank"}, fold:["t","b","l","r"], mu:0.65, sgtr:false,
          ports:{"*":2}, thermal:"none", tsurv:420, pburst:25},
  bkp:   {internal:null, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none", tsurv:350, pburst:20},
  catcher: {internal:null, fixed:null, fold:null, mu:0.55, sgtr:false,
          ports:{}, thermal:"none", tsurv:null, pburst:null},             // a structure, not a network part - no run, no ports, no exception needed
  /* A footprint and an effect, in the shield/catcher idiom: one term in roomStep()'s source pass, worth nothing in a blackout, and with bearings of its own - the machine that keeps the room cool is in the room. */
  vent:  {internal:null, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none", tsurv:400, pburst:20},
  /* Two machines because they answer different halves of a spill: inerting takes the oxygen and stops the FIRE, the pan takes the metal and stops everything, since a sodium-water reaction needs no oxygen at all. */
  inert: {internal:null, fixed:null, fold:null, mu:0.75, sgtr:false,
          ports:{}, thermal:"none", tsurv:600, pburst:20},
  pan:   {internal:null, fixed:null, fold:null, mu:0.55, sgtr:false,
          ports:{}, thermal:"none", tsurv:null, pburst:null},
  /* A heat exchanger with space on one side: ONE internal path, folded t->l and b->r so it splices into a cooling leg however it is oriented. Radiating to T_SPACE never becomes an edge - space is not a node. tsurv is scaled per instance by the coating. */
  radiator:{internal:{a:"l", b:"r", kind:"comp", v:2, len:10, na:"IN", nb:"OUT", la:"COOLANT IN", lb:"COOLANT OUT"},
          fixed:null, fold:{t:"l", b:"r"}, mu:0.35, sgtr:false,
          ports:{"*":2}, thermal:"sink", tsurv:520, pburst:15, pdes:1.0},
  /* One role for every fitting: a tee, a throttle and a relief valve differ by `mode` on the instance. `gate` prices the path off FIT[mode] instead of the flat component length, and `fold` answers per INSTANCE because a tee is one node and a valve is two with the gate between them. */
  fitting:{internal:[{a:"l", b:"r", kind:"fit", gate:true, vap:"ab", na:"A", nb:"B", la:"SIDE A", lb:"SIDE B"}], fixed:null,
          fold:p=>fitModeOf(p.id)==="tee" ? ["l","r","t","b"] : {t:"l", b:"r"},
          mu:0.70, sgtr:false, ports:{l:2,r:2,t:2,b:2}, thermal:"none", tsurv:600, pburst:70},
};
// asked of the instance and never of the role; the one reader for the fold above and every branch below
const fitModeOf=id=>(D.fittings[id]&&D.fittings[id].mode)||"tee";
/* Top-left for every part EXCEPT a radiator, whose height is a knob: stored by its BOTTOM edge, so area grows upward and its face stays on the skin. */
const cellStore=(role,y,h)=>role==="radiator" ? y+h : y;
const cellTop  =(role,h,v)=>role==="radiator" ? v-h : v;
/* One row per KIND: a machine is an entry in D.machines minted from a row here, and the count is however many are in it. `num` gives the kind an ORDINAL, read off the drawing and never stored. `rides` is a kind BOLTED to another - minted with its host, removed with it, never offered on its own, dx/dy relative to it. */
const MACHINE={
  core:{role:"core", w:9, h:12, col:"#ff5a45", grp:"core", name:"REACTOR", num:true,
    tip:"The vessel and the fuel inside it. Select it to choose the coolant family, the fuel, the lattice and the core shape."},
  rods:{role:"rods", w:9, h:13, col:"#c8d8dc", grp:"core", name:"ROD DRIVES", num:true,
    rides:"core", dx:0, dy:-13,
    tip:"Control rod drive mechanisms, bolted to the vessel head. They ride on the head and move with the reactor - you site the reactor, not the drives. Select for scram gear, bank worth and emergency poison."},
  sg:{role:"sg", w:3, h:6, col:"#5fd2e2", grp:"sg", name:"STEAM GEN", num:true,
    tip:"Raise this ABOVE the reactor and hot water rises into it unaided. That height difference is your blackout survival."},
  pump:{role:"pump", w:0, h:0, col:"#57d38c", grp:"pump", name:"RCP", num:true,
    tip:"A coolant pump. What it is FOR is asked of the drawing: pipe it from a condenser to a generator's shell and the same machine is a feed pump. Keep it low and reachable - it is the component most likely to need a repair under fire."},
  ihx:{role:"ihx", w:3, h:4, col:"#9ec96f", grp:"sg", name:"HEAT EXCHANGER", num:true,
    tip:"An intermediate heat exchanger. Hot side left to right, second side top to bottom, and the second side is a real circuit: give it a pump and an expansion tank and whatever stands on it is heated by THIS instead of by the core, so primary coolant never reaches the secondary. Two stages in series cost a temperature drop, and the exchanger is heavy."},
  turb:{role:"turb", w:9, h:7, col:"#f0a830", grp:"sec", name:"TURBINE", num:true,
    tip:"Draws the ship's load. It swallows its own share of steam and carries its own share of it - lose one of two and you lose half the output, not all of it. Select it to size the steam dump that absorbs a turbine trip."},
  cond:{role:"cond", w:9, h:5, col:"#5aa9d6", grp:"sec", name:"CONDENSER", num:true,
    tip:"Rejects waste heat, and it is where the feed pumps draw from. Bulky, and it wants to be near the hull."},
  radiator:{role:"radiator", w:5, h:3, col:"#b8c4cf", grp:"sec", name:"RADIATOR", num:true,
    tip:"A radiating panel. In space this is the ONLY way waste heat leaves the ship, and it must see the skin to work at all - an inboard panel sheds nothing and the plant loses its turbine. It must also be PLUMBED, because it cools the water going through it and nothing else. Select it for area and coating."},
  ctrl:{role:"ctrl", w:6, h:4, col:"#cfc9b8", grp:"crew", name:"CONTROL",
    tip:"Where your crew sits. Distance and shielding from the reactor set the dose they take."},
  catcher:{role:"catcher", w:3, h:3, col:"#5a4a3a", grp:"safety", name:"CORE CATCHER",
    tip:"A cooled basin under the vessel. It will not save the fuel, but it stops a melted core burning through and breaching the vessel, which keeps the release contained."},
  bkp:{role:"bkp", w:3, h:5, col:"#57d38c", grp:"safety", name:"BACKUP PWR",
    tip:"Batteries or diesels keeping the pumps turning through a blackout. Keep it away from the hull."},
  vent:{role:"vent", w:3, h:3, col:"#8fb8c4", grp:"safety", name:"VENT UNIT", num:true,
    tip:"Pulls compartment air overboard. It is the only thing on the plant besides the hull that takes heat OUT of the room, and it is on the main board - a blackout leaves the room with nothing but its own steel. Nothing to plumb."},
  inert:{role:"inert", w:3, h:3, col:"#7f8fa8", grp:"safety", name:"INERT GAS SET", num:true,
    tip:"Nitrogen bottles and a valve. It drives oxygen out of the cells it stands in, so a sodium fire or a hydrogen cloud there smothers, and the diffusion carries it as far as it reaches - site it where the fire will be. No power, so it works in a blackout. It does NOT stop sodium meeting water: that reaction takes no oxygen."},
  pan:{role:"pan", w:5, h:1, col:"#6a6258", grp:"safety", name:"CATCH PAN", num:true,
    tip:"A curbed steel tray with a drain to a sealed tank. Metal running out of a pipe falls in over any face and leaves down the line instead of spreading over the deck, which takes away the surface a metal fire needs. Put it UNDER the sodium equipment and OFF the deck - a pan on the far side of the bay catches nothing, and one standing in the bilge is full of water."},
};
/* WHAT A MACHINE SAYS WHILE IT IS RUNNING. MACHINE.tip is a BENCH tip - where
   to put the box and what to buy - and on the control room board it was
   answering a question nobody standing at the panel can act on. Keyed by ROLE
   so a tank and a fitting are covered by the same table, and every row names
   the figure that machine prints on its own box. */
const OPTIP={
  core:"The number is chain-reaction power as a percent of rated. A figure in brackets is decay heat, which keeps running after a scram and needs flow and a heat sink for hours.",
  rods:"The number is where the banks stand: 100% is fully inserted. Insert to cut power, withdraw to raise it, and expect T-avg to follow a few seconds later.",
  sg:"The number is water level in the shell as a percent. Low level bares the tubes and trips the plant; high level carries water into the steam line. Feedwater is what moves it.",
  pump:"The number is flow as a percent of what this pump is rated for. Zero here with the reactor hot is the emergency: heat is still being made and nothing is carrying it away.",
  ihx:"The number is the heat crossing this exchanger, in MWt. It is the middle of two transfer stages, so everything behind it is limited by this figure.",
  turb:"The number is electrical output in MWe. It follows the steam reaching it, so it falls when a generator loses level, a valve shuts or a line is cut.",
  cond:"The number is hotwell level as a percent - the water the feed pumps draw from. Empty it and the feed train cavitates, whatever the generators are asking for.",
  radiator:"The number is what this panel is shedding, in MW. It is the only way heat leaves the ship, so the sum across the panels is the ceiling on the power the plant can hold.",
  ctrl:"The number is accumulated crew dose as a percent of the limit. It rises with release and with time spent beside an unshielded core; it never falls.",
  catcher:"A cooled basin under the vessel. It does nothing until fuel melts, and then it is what keeps a breach out of the compartment.",
  bkp:"It reads LOAD while it is carrying the plant through a blackout, and nothing while it stands by. Pumps and instruments run off it until it is spent.",
  vent:"Pulls compartment air overboard, and it is the only active way heat leaves the room. Check it whenever compartment temperature is climbing.",
  inert:"Nitrogen into the cells it stands in. Watch the OXYGEN layer: a fire dies below 5%, and so does a hydrogen cloud. It runs through a blackout and it does nothing about sodium meeting water.",
  pan:"The number is what its drain has taken off the deck, in tonnes. Metal in the pan is metal that is not spreading and not burning. Wrecked, it still holds a spill and no longer drains one.",
  tank:p=>tankHold(p.id)
    ? "The number is the pressure this vessel is holding for its circuit, in MPa. Heaters raise it and the spray lowers it; a falling reading with a steady level means water is leaving somewhere else."
    : "The number is how full it is, as a percent. BURST means the shell has let go and it is now an opening into the compartment.",
  fitting:p=>{ const f=D.fittings&&D.fittings[p.id];
    return (f&&f.mode==="relief")
      ? "A relief valve. It lifts by itself on pressure and reseats below it, and what it passes goes wherever its outlet is piped - a tank, or the room."
      : "A valve in the line. Shut it and the run carries nothing; open it and flow follows pressure. The mark on the body is what it is stood down as."; },
};
const opTipOf = p => { const t=OPTIP[p.role]; return (typeof t==="function"?t(p):t) || p.tip; };
const machRow  = id => { const m=D.machines[id]; return (m && MACHINE[m.kind]) || null; };
const machRole = id => { const M=machRow(id); return M ? M.role : null; };
/* A box follows a real quantity where the machine states one; the pump pass runs in buildLayout(), because pumpW() asks the graph and the graph is built on the board this is assembling. */
const machineH = (id,M) => M.role==="radiator" ? radH(id) : M.h;
const machineW = (id,M) => M.role==="radiator" ? radW(id) : M.w;
/* mintMachine() builds; addMachine() is the gesture on top and picks the lowest free slot, because a machine id carries no meaning. */
/* A PANEL THAT IS PIPED UP IS BUILT, and a built machine does not resize because another was drawn: radAreaSuggest() is one panel's share of the fleet, so drawing a third shrank the two already fitted, their boxes lost a column, and the circulating-water runs seeded on that column went with it. Each states what it is before the count moves. */
function radFreeze(){
  for(const q of radIds()) if(pipeMap().conns.some(c => c.a===q || c.b===q))
    bake(D.radArea, q, radAreaOf);
}
function mintMachine(id,kind,x,y,core){
  const M=MACHINE[kind];
  if(M.role==="radiator") radFreeze();
  D.machines[id]={kind, cell:[x,y]};
  D.machines[id].cell=[x, cellStore(M.role, y, machineH(id,M))];
  // a vessel is minted with its own reactor drawn in it: the one handed in, else the stock one
  if(M.role==="core") D.cores[id]=coreMint(core);
  /* What is bolted to this one comes with it; the rider's id is the host's own suffix on the rider's kind, so no second counter can disagree with the first. */
  for(const rk in MACHINE) if(MACHINE[rk].rides===kind){
    const rid=rk+id.slice(kind.length);
    D.machines[rid]={kind:rk, cell:[x,y+MACHINE[rk].dy], on:id};
  }
  buildLayout(); return id;
}
/* A RIDER IS NOT PLACED AND IS NOT COUNTED - it is part of what it rides. */
const machRides = kind => !!MACHINE[kind].rides;
function addMachine(kind,x,y){
  let n=1; while(D.machines[kind+n]) n++;
  return mintMachine(kind+n,kind,x,y);
}
/* From D.machines and nothing else; zero machines is a legal plant. */
function machineParts(){
  const out=[];
  for(const id in D.machines){ const m=D.machines[id], M=MACHINE[m.kind]; if(!M||!m.cell) continue;
    const h=machineH(id,M);
    const p={id, kind:m.kind, name:M.name, w:machineW(id,M), h,
             x:m.cell[0], y:cellTop(M.role,h,m.cell[1]),
             col:M.col, grp:M.grp, tip:M.tip, role:M.role};
    if(M.rides && m.on) p.pin={to:m.on, dx:M.dx, dy:M.dy};
    out.push(p);
  }
  return out;
}

function buildLayout(){
  dTouch();          // LAY.parts is about to be a different list, and every gesture that edits D lands here
  gridSync();        // the hull may have been dragged since the last pass
  const A=machineParts();
  for(const p of tankParts()) A.push(p);
  for(const p of fittingParts()) A.push(p);
  /* Read off the drawing in board order, so the second panel becomes RADIATOR 1 when the first is taken off; partName() still lets the player's own name win. */
  const nth={};
  for(const p of A) if(p.kind && MACHINE[p.kind].num)
    p.name = MACHINE[p.kind].name+" "+(nth[p.kind]=(nth[p.kind]||0)+1);
  for(const p of A) if(roleHead(p.role)){
    p.w=Math.max(pumpW(p.id), p.w); p.h=Math.max(pumpH(p.id), p.h); }
  /* A pinned part is derived, never stored: its parent may have moved since the last rebuild. */
  for(const p of A) if(p.pin){ const t=A.find(q=>q.id===p.pin.to);
    if(t){ p.x=t.x+p.pin.dx; p.y=t.y+p.pin.dy; } }
  /* A part in a bad spot stays on the drawing and is MARKED, so it can be picked up and moved out again; it is a HARD objection until it is. */
  markLimbo(A);
  /* A rebuild that lands on the same board keeps the OLD object: half a dozen caches key on LAY identity to mean "the board changed". */
  const sig=A.map(p=>[p.id,p.name,p.w,p.h,p.x,p.y,p.col,p.grp,p.role,p.tip,p.limbo?1:0,
    p.pin?p.pin.to+","+p.pin.dx+","+p.pin.dy:""].join("|")).join(";");
  layFit=laySrcSig();
  if(LAY && layBuiltSig===sig) return;
  layBuiltSig=sig;
  // byId is built here and nowhere else: LAY.parts is only ever replaced whole
  const byId=new Map(); for(const p of A) byId.set(p.id,p);
  portReanchor(byId);
  LAY={parts:A, byId};
}
/* A growing box SWALLOWS its own far-face nozzles, so the offset is moved back onto the SAME face of the new box, keeping its position along it. LAY is still the OLD board when this runs, which is the history it needs. */
function portReanchor(byId){
  if(!LAY) return;
  // off the NEW boxes, never portCell(), which reads the board this pass exists to leave behind
  const key=pid=>{ const q=D.ports[pid], p=byId.get(q.p);
    return p ? (p.x+q.dx)+","+(p.y+q.dy) : null; };
  const taken={};
  for(const pid in D.ports){ const k=key(pid); if(k) taken[k]=pid; }
  for(const pid in D.ports){
    const q=D.ports[pid], was=LAY.byId.get(q.p), now=byId.get(q.p);
    if(!was || !now || (was.w===now.w && was.h===now.h)) continue;
    const f=faceOfOffset(was,q.dx,q.dy);
    if(!f || faceOfOffset(now,q.dx,q.dy)===f) continue;
    const dy=clamp(q.dy,0,now.h-1), dx=clamp(q.dx,0,now.w-1);
    const to = f==="l" ? [-1,dy] : f==="r" ? [now.w,dy]
             : f==="t" ? [dx,-1] : [dx,now.h];
    /* A collision is left adrift, not resolved: portFaceOf() says null for the one that did not move, which reads as the dead nozzle it is. */
    const k=(now.x+to[0])+","+(now.y+to[1]);
    if(taken[k] && taken[k]!==pid) continue;
    delete taken[key(pid)];
    taken[k]=pid; q.dx=to[0]; q.dy=to[1];
  }
}
/* Two callers: a move does not change laySrcSig(), so moveTo() must re-mark or the answer is where the part USED to be. */
function markLimbo(A){
  for(const p of A)
    p.limbo = p.x<0 || p.y<0 || p.x+p.w>GW || p.y+p.h>GH ||
              A.some(q=>q!==p && p.x<q.x+q.w && p.x+p.w>q.x && p.y<q.y+q.h && p.y+p.h>q.y);
}
/* Every row is exactly CELL tall, and this must keep counting past both ends of the grid: a port on the very bottom edge lands on row GH. */
const rowTop=r=>GY+r*CELL;
const rowAt=py=>Math.floor((py-GY)/CELL);
const gridH = () => GH*CELL;
// a plant-space point in FRACTIONAL grid units
const gridPt=pt=>({x:(pt[0]-GX)/CELL, y:(pt[1]-GY)/CELL});
const PXc=g=>GX+g*CELL, PYc=g=>rowTop(g);
// cells rather than a part, so a drop PREVIEW can be measured for a footprint no part occupies yet
const grect=(x,y,w,h)=>({x:PXc(x), y:rowTop(y), w:w*CELL, h:h*CELL});
const prect=p=>grect(p.x,p.y,p.w,p.h);
// the CENTRE of a cell in plant pixels: a port's mark, a pipe corner and a nozzle all land on this
const cellPos=(x,y)=>[GX+(x+0.5)*CELL, rowTop(y)+CELL/2];
// a nozzle sits ON the shell, not in the middle of the port cell
const PORT_PROUD=3.5*DRAW_K;
function portPos(pid){
  const q=D.ports[pid], c=portCell(pid), f=portFaceOf(pid);
  if(!c||!f) return [0,0];
  const [x,y]=cellPos(c[0],c[1]);
  const p=partOf(q.p);
  // a fitting's box is one cell of glyph, so a joint astride its edge lands ON the symbol
  const out=p&&p.role==="fitting" ? PORT_PROUD : 0;
  return [x-DIRV[f][0]*(CELL/2-out), y-DIRV[f][1]*(CELL/2-out)];
}

/* the face of p that points at q - a nozzle should be on the side the pipe comes from,
   otherwise the run crosses the component to reach the far face and looks unconnected */
function face(p,q){
  const a=cen(p), b=cen(q), dx=b.x-a.x, dy=b.y-a.y;
  return Math.abs(dx)>Math.abs(dy) ? (dx>=0?"r":"l") : (dy>=0?"b":"t");
}
/* The nearest EDGE of one box to a point inside it, normalised by the box's own half-span so a long axis does not swallow a short face. GRID units. Falls through to the next-nearest rather than refusing. */
function faceAt(p,gx,gy){
  const R=ROLE[p.role], ps=R&&R.ports;
  if(!ps) return null;
  const any=ps["*"]!=null;
  const c=cen(p), nx=(gx-c.x)/(p.w/2), ny=(gy-c.y)/(p.h/2);
  const rank=Math.abs(nx)>Math.abs(ny)
    ? [nx>=0?"r":"l", ny>=0?"b":"t", nx>=0?"l":"r", ny>=0?"t":"b"]
    : [ny>=0?"b":"t", nx>=0?"r":"l", ny>=0?"t":"b", nx>=0?"l":"r"];
  for(const f of rank) if(any || ps[f]!=null) return f;
  return null;
}

/* A point on its own straight line is not a corner, and the trace gives one point per cell. */
function unbend(pts){
  if(pts.length<3) return pts;
  const out=[pts[0]];
  for(let i=1;i<pts.length-1;i++){
    const a=out[out.length-1], b=pts[i], c=pts[i+1];
    const flat=Math.abs(a[1]-b[1])<=0.5 && Math.abs(b[1]-c[1])<=0.5;
    const vert=Math.abs(a[0]-b[0])<=0.5 && Math.abs(b[0]-c[0])<=0.5;
    if(!(flat||vert)) out.push(b);
  }
  out.push(pts[pts.length-1]);
  return out;
}

/* A connection is TRACED out of the cells and the ports, so there is no list of runs to go stale. `rid` is the run's OWN name where it has one and undefined where it does not; runIdOf() is the door. */
function pipeNetwork(){
  /* On the graph AND on GY, the one piece of view the points are measured off; nothing writes to a run, so one copy serves every reader. */
  const slot=graphSlot("pipeNetwork"), was=slot.get(1);
  if(was && was.gy===GY) return was.net;
  const net=[], usage={};
  const tally=(pid,f)=>{ usage[pid+f]=(usage[pid+f]||0)+1; };
  for(const c of pipeMap().conns){
    const a=partOf(c.a), b=partOf(c.b);
    if(!a || !b) continue;               // this connection's part is not on the grid this frame
    const raw=[portPos(c.pa)];
    for(let i=0;i<c.cells.length;i++){ const cl=c.cells[i]; raw.push(cellPos(cl[0],cl[1])); }
    raw.push(portPos(c.pb));
    const pts=unbend(raw);
    // pa/pb are the two PORT ids: each port has its own isolation valve, and a node name (partId+face) cannot name one of two ports sharing a face
    net.push({k:c.k, key:c.key, rid:c.rid, cells:c.cells, L:c.L,
               pts, wps:[], wp:true, nz:[true,true],
               pa:c.pa, pb:c.pb,
               a:a.id, sa:c.sa, b:b.id, sb:c.sb});
    tally(a.id,c.sa); tally(b.id,c.sb);
  }
  // which faces carry a REAL, TRACED connection: an orphaned port must read exactly like no port at all
  net.usage=usage;
  slot.set(1,{gy:GY, net});
  return net;
}
// which part a plant-space point lands in, or null
function partAt(pt){
  const gx=Math.floor((pt[0]-GX)/CELL), gy=rowAt(pt[1]);
  return LAY.parts.find(q=>gx>=q.x&&gx<q.x+q.w&&gy>=q.y&&gy<q.y+q.h)||null;
}
/* There is no port PICKER: the hand names the face (faceAt) and a click moves it (portFlip). portPath() is the ONE predicate for "is there anything to choose here" - a part with no declared path is one node and has no sides, and a port flips within its own path, never across. */
const roleIntern=R=>!R||!R.internal ? []
  : (Array.isArray(R.internal) ? R.internal : [R.internal]);
const roleIns=p=>roleIntern(ROLE[p.role]);
function portPath(p,f){
  if(!p||f==null) return null;
  /* Matched on the NODE, never the face letter: a fold makes a panel's top face its coolant inlet, and coreFold() is the one authority on which faces are the same water. */
  const nf=coreFold(p.id+f);
  const IN=roleIns(p).find(q=>coreFold(p.id+q.a)===nf||coreFold(p.id+q.b)===nf);
  // a path whose two ends FOLD onto one node is no choice either: a tee is one node where a throttle is two
  if(!IN || coreFold(p.id+IN.a)===coreFold(p.id+IN.b)) return null;
  return IN;
}
/* Which end of its machine's own path a face is - "a", "b" or null - and the ONE place that decides it; a bare `IN.a===f` misses the fold. */
function portEnd(p,f){ const IN=portPath(p,f); if(!IN) return null;
  const nf=coreFold(p.id+f);
  return coreFold(p.id+IN.a)===nf ? "a" : coreFold(p.id+IN.b)===nf ? "b" : null; }
function portWord(p,f,long){ const IN=portPath(p,f); if(!IN) return null;
  return portEnd(p,f)==="a" ? (long?IN.la:IN.na) : (long?IN.lb:IN.nb); }
/* The spoken name of one port, so the log line, the rail row and the tooltip cannot describe one nozzle three ways; a face with no side falls back to the face letter. */
function portLabel(pid){
  const port=D.ports[pid]; if(!port) return pid;
  const p=partOf(port.p); if(!p) return pid;
  const f=portFaceOf(pid);
  return partName(p)+" "+((f&&portWord(p,f,true))||FACE_NAME[f]||pid);
}
/* Which kinds carry vapour rather than liquid; net.vapour marks the nodes a run of one of these reaches. */
const RUN_VAPOUR={steam:1, exh:1};
/* THE SEAM, NAMED: the one function to replace when a run's kind stops pricing its physics. Nothing outside this reads RUN_VAPOUR. Takes anything carrying a kind - a run states `k`, an assembled edge `kind`. */
const LAW_VAPOUR="vapour", LAW_LIQUID="liquid";
const edgeLaw = e => RUN_VAPOUR[e.kind !== undefined ? e.kind : e.k] ? LAW_VAPOUR : LAW_LIQUID;
/* Keyed on the unordered pair of ROLES and derived at trace time, never stored; a pair with no row is "user" - grey and unnamed on purpose, and it still conducts. */
const RUN_KIND={
  "core|sg":"hot", "pump|sg":"cold", "core|pump":"cold",
  // an exchanger is spliced INTO the loop, so every run reaching it is still the leg it was
  "core|ihx":"hot", "ihx|sg":"hot", "ihx|pump":"cold",
  // sg|sg is the main steam header; without the row it comes out "user" and solves as a WATER pipe between two shell nodes
  "sg|turb":"steam", "sg|sg":"steam", "cond|turb":"exh",
  // the condenser is on nobody's primary, so a pump drawn to it is drawing feedwater
  "cond|pump":"feed",
  // the circulating-water side: neither feedwater nor exhaust
  "cond|radiator":"cw", "pump|radiator":"cw", "radiator|radiator":"cw",
};
/* A fitting is transparent to naming: a `fitting` end is resolved THROUGH its own runs to the nearest machine that is not one, so a tee spliced into the hot leg leaves two hot legs. */
const isFitting=id=>{ const p=partOf(id); return !!p && p.role==="fitting"; };
/* `avoid` is the OTHER end of the run being named, or the walk goes straight back down the run it is naming. */
/* A LINE THROUGH A FITTING BEATS A BRANCH OFF IT. Three legs meet at the
   stock surge tee - the core, the generator and the pressurizer - and asked
   what is on the far side of the core's leg, "the pressurizer" and "the
   generator" are both true. Taking the first one found made the answer turn on
   which connection happened to sort first, and the hot leg came out named
   `surge`. A vessel that is a boundary (the pressurizer, a tank) is what a
   line BRANCHES to; anything else is what the line CONTINUES as, so a
   continuation is preferred and the branch is only taken when it is all there
   is. */
const FIT_BRANCH_ROLE={tank:1};
/* AND A RESERVE TRAIN IS A BRANCH, the same as the tank behind it - a pump
   drawing on a reserve (pumpResOf) is that tank's discharge, not a
   continuation of the line it ties into. Without it the stock feedwater line
   was named off whichever leg of the tie sorted first and came out grey. */
const fitBranch = q => !!FIT_BRANCH_ROLE[q.role]
  || (roleHead(q.role) && pumpResOf(q.id).length > 0);
/* `out.face` comes back with the face at the machine ANSWERED, which is not
   the face the run being named lands on: a line into a generator's feed
   nozzle through a tee lands on the TEE, and asked about the generator with
   the tee's own face the shell test below read the tube side and called a
   feedwater line a cold leg. */
function throughFitting(id,avoid,seen,out){
  const p=partOf(id);
  if(!p || p.role!=="fitting") return p||null;
  seen=seen||{}; if(seen[id]) return null; seen[id]=1;
  // pipeTrace(), never pipeMap(): naming a connection is what calls this, so
  // reading the NAMED map here would be the cycle the two halves exist to break
  let branch=null, branchFace;
  for(const c of pipeTrace().conns){
    const o = c.a===id ? c.b : c.b===id ? c.a : null;
    if(o==null || o===avoid) continue;
    if(out) out.face = undefined;
    const q=throughFitting(o,avoid,seen,out); if(!q) continue;
    const f = out && out.face!==undefined ? out.face : (c.a===o ? c.sa : c.sb);
    if(!fitBranch(q)){ if(out) out.face = f; return q; }
    if(!branch){ branch=q; branchFace=f; }
  }
  if(out) out.face = branch ? branchFace : undefined;
  return branch;
}
/* A FITTING THAT LEADS NOWHERE IS ITSELF THE END OF THE RUN. A relief valve
   venting to the room has nothing beyond it, so the walk answers null - and
   the pipe reaching it came out "user", which left a generator's own steam
   nozzle carrying an unclassified fluid and stopped net.vapour ever calling
   it a steam space. What the line reaches is the valve. */
/* THE TWO MACHINES A RUN JOINS AND THE FACES IT LANDS ON, with any fitting in
   the way seen through - null when either end is off the grid. The naming
   below and the loop's own drop (loopHeadOf) ask the same pair. Not runEnds()
   (pipenet.js), which answers a different question off a run KEY. */
function runPartEnds(aId,bId,af,bf){
  const oa={}, ob={};
  const A=throughFitting(aId,bId,null,oa)||partOf(aId), B=throughFitting(bId,aId,null,ob)||partOf(bId);
  if(!A||!B) return null;
  return [{p:A, f:oa.face!==undefined?oa.face:af}, {p:B, f:ob.face!==undefined?ob.face:bf}];
}
/* The ONE machine a vessel carries the line on to, over its own nozzles and past any fitting: null for a branch, which has nothing on the far side, and null for a header, which has no single leg to continue. */
function tankThrough(tid,avoid){
  let out=null;
  for(const c of pipeTrace().conns){
    const o = c.a===tid ? c.b : c.b===tid ? c.a : null;
    if(o==null || o===avoid) continue;
    const q = throughFitting(o,tid) || partOf(o);
    if(!q || q.id===tid) continue;
    if(out && out.id!==q.id) return null;
    out=q;
  }
  return out;
}
function runKindFor(aId,bId,af,bf){
  const e=runPartEnds(aId,bId,af,bf); if(!e) return "user";
  const A=e[0].p, B=e[1].p; af=e[0].f; bf=e[1].f;
  /* "pump|sg" alone cannot tell a cold leg from a feedwater line, so the FACE tells it: on the shell a pump or a tank is putting water in and anything else is taking steam out. */
  if((A.role==="sg") !== (B.role==="sg")){
    const g = A.role==="sg" ? A : B, f = A.role==="sg" ? af : bf,
          o = A.role==="sg" ? B : A;
    // the SHELL, asked of the declaration's own order: "the core cannot reach it" names both sides of a generator behind an exchanger
    if(f!=null && onStage(g.id, f, 1))
      return (o.role==="pump" || o.role==="tank") ? "feed" : "steam";
  }
  /* A tank's line is named by what it REACHES, not by which tank it is; a hold tank is preferred as the FAR end, or a header between two tanks is named by whichever id sorted first. */
  const isT = q => q.role==="tank";
  const t = (isT(A) && !tankHold(A.id)) ? A : (isT(B) && !tankHold(B.id)) ? B
          : isT(A) ? A : isT(B) ? B : null;
  if(t){
    const o = t===A? B : A;
    /* A DRUM is a piece of the loop with four lines on it, so what names each one is the machine at the far end and the FACE it lands on. Without the steam row the vapour law never applies and the separator is never armed. */
    if(isDrum(t.id)){
      if(o.role==="turb") return "steam";
      if(o.role==="core") return "hot";
      const IN = roleHead(o.role) && roleIns(o)[0], f = t===A ? bf : af;
      if(IN && f!=null){ const n = coreFold(o.id+f);
        if(n === coreFold(o.id+IN.a)) return "cold";     // the downcomer, into the pump's suction
        if(n === coreFold(o.id+IN.b)) return "feed"; }
      return "user";
    }
    if(!primaryTank(t.id)) return "feed";
    /* The line reaching the vessel that authors this circuit's pressure IS the surge line. */
    if(tankHold(t.id)) return "surge";
    if(isT(o) && tankHold(o.id)) return "relief";
    /* A vessel with a line on each side of it is a PIECE of the leg, not a branch off it, so what it carries the line on to is what names this run - a bore is read off the kind, and a tank spliced into a leg may not resize the leg. */
    const thru = tankThrough(t.id, o.id);
    if(thru) return RUN_KIND[[thru.role, o.role].sort().join("|")] || "user";
    return "hpi";
  }
  return RUN_KIND[[A.role,B.role].sort().join("|")] || "user";
}
/* In the order a pick should prefer them: D.runs first, because a run with loose ends is no CONNECTION and owns none of its cells as far as the trace is concerned. A hand-laid run has only the trace to name it. */
function runsAtCell(x,y){
  const out=[];
  for(const rid in D.runs){ const cs=D.runs[rid].cells;
    if(cs && cs.some(c=>c[0]===x&&c[1]===y)) out.push(rid); }
  const M=pipeMap();
  for(const key of (M.cellOwner[pipeKey(x,y)]||[])){
    const c=M.byKey[key], id=c?runIdOf(c):key;
    if(out.indexOf(id)<0) out.push(id);
  }
  return out;
}
/* Handed back as runIdOf(), because its one caller writes a bore with it and a bore hangs on the id where there is one. */
function runBetween(a,b){
  for(const c of pipeMap().conns)
    if((c.a===a&&c.b===b)||(c.a===b&&c.b===a)) return runIdOf(c);
  return null;
}
/* A fitting with nothing on its far side TERMINATES the run; handing the machine back lets a view name the run after it, so a branch off the header is not itself MAIN STEAM. */
function runDeadEnd(aId,bId){
  if(isFitting(aId) && !throughFitting(aId,bId)) return partOf(aId);
  if(isFitting(bId) && !throughFitting(bId,aId)) return partOf(bId);
  return null;
}
/* The loops of the RUNS that reach a fitting: netFlowK()'s per-group ceiling and resetPlant()'s cross-tie test are the same question. Off the loop at the FAR END of each run, never loopOfKey() on the run itself, which resolves to the fitting and makes both sides look alike. */
function fitLoops(id){
  const out=[];
  for(const c of pipeTrace().conns){
    const other = c.a===id ? c.b : c.b===id ? c.a : null;
    if(other==null) continue;
    const l=loopOf(other);
    if(l!=null && out.indexOf(l)<0) out.push(l);
  }
  return out;
}
const fitTies=id=>fitLoops(id).length>1;
/* `hold` is the whole of a pressurizer: a knob on the instance, so a second hold tank on a second circuit is a legal design. */
const tankHold  = id => { const t=D.tanks&&D.tanks[id]; return !!(t && t.hold); };
const holdTankIds = () => tankIds().filter(tankHold);
/* Every hold tank standing on one circuit. More than one is a design the
   bench warns about and the solve demotes all but the first (netRef()). */
const holdOnCirc = ci => holdTankIds().filter(id=>tankCircuit(id)===ci);
/* PRIMARY is the component containing the CORE. A tank with a cell is wherever its own nodes are; one with NO cell is condensate inside another machine and takes its HOST's answer; one piped to nothing returns null. */
const hostPartOf = () => LAY.parts.find(p=>ROLE[p.role] && ROLE[p.role].thermal==="sink") || null;
// on the graph (graphSlot()): netReadEdges() asks this once per EDGE per solve
function tankCircuit(id){
  const t=D.tanks && D.tanks[id]; if(!t) return null;
  const G=nodeGraph(), slot=graphSlot("tankCircuit");
  const hit=slot.get(id); if(hit!==undefined) return hit;
  const circOfNodes = ns => !ns || !ns.length ? null : G.circuit[ns[0]];
  let out;
  if(!t.cell){ const h=hostPartOf();
    /* No host on the grid: a hosted tank is still not something the core can reach, so it is off the core's circuit rather than nothing. */
    const c=h && circOfNodes(G.nodesOf[h.id]);
    out = c===null || c===undefined || c===false ? -1 : c; }
  else out = circOfNodes(G.nodesOf[id]);
  slot.set(id,out);
  return out;
}
// "on the core's circuit" - what every old tankSide()==="primary" test meant
const tankPrimary = id => { const c=tankCircuit(id);
  return c!==null && c>=0 && nodeGraph().coreCircs[c]===1; };
// connected somewhere, but not to the core's circuit
const tankSecondary = id => { const c=tankCircuit(id); return c!==null && !tankPrimary(id); };
/* The one predicate for "could catch a relief discharge": any primary tank will do, off ROLE and the graph, never p.id. */
function primaryTank(id){
  const p=partOf(id);
  return !!(p && p.role==="tank" && tankPrimary(id));
}

/* The design-time answer to "is this wired to that", with no net, no solve and no S. `blocks` marks a part the walk may REACH but never CROSS; omitted, this is pure wiring. */
function runReach(fromId, blocks){
  /* A face the part declares no port on is not a connection: netBuild() would land the run on a node nothing else touches. `null` means "resolve live" and is always legal. */
  const portOK=(pid,face)=>{
    if(face==null) return true;
    const p=partOf(pid), R=p&&ROLE[p.role];
    return !!R && (R.ports["*"]!==undefined || R.ports[face]!==undefined);
  };
  const link=[];
  for(const c of pipeTrace().conns){
    if(!portOK(c.a,c.sa)) continue;
    if(!portOK(c.b,c.sb)) continue;
    link.push([c.a,c.b]);
  }
  const seen=new Set([fromId]), stack=[fromId];
  while(stack.length){
    const u=stack.pop(), pu=partOf(u);
    if(u!==fromId && blocks && pu && blocks(pu)) continue;
    for(const [a,b] of link){
      const v = a===u ? b : b===u ? a : null;
      if(v===null || seen.has(v) || !partOf(v)) continue;
      seen.add(v); stack.push(v);
    }
  }
  return seen;
}
/* Topological only: whether anything that COULD reject heat is wired to the primary at all. Nothing blocks - heat crosses a tank as happily as anything else. */
function hasHeatSink(){
  const cores=coreIds(); if(!cores.length) return true;   // no core, no claim to make
  const sinks=id=>{ for(const pid of runReach(id)){ const p=partOf(pid), R=p&&ROLE[p.role];
      if(R && (R.thermal==="sink"||R.thermal==="transfer")) return true; }
    return false; };
  return cores.every(sinks);
}
/* IS THE PRESSURIZER PLUMBED TO THE LOOP AT ALL - the bench's design-time
   half of pzrLive() (pipenet.js), which the tick asks off the solved network
   instead. The bench cannot ask that one: it has no commissioned P and no S,
   and pzrLive() needs both (P.Pcont, every valve position). So this asks the
   WIRING, and the two agree on the only case a designer can be at fault for
   - no pipe reaches the vessel. They differ on an operating decision, a
   valve shut on a line that is drawn, which is not a design fault and must
   not raise a design warning.

   ASKED THE SAME SHAPE holdLive() ASKS, on the drawing instead of on the
   solve: the piece the vessel stands in has to BE a circuit - a cycle water
   can go round - and not a dead leg. "Some part on this circuit reaches it"
   was not that, and it passed a pressurizer whose surge line had been deleted
   and which was left hanging on its own relief valve: the bench said plumbed,
   the plant read ISOLATED, and nothing on either screen said why. Counted
   over distinct node PAIRS, or two runs between the same two faces read as a
   loop. Every valve is open here, because a shut one is an operating decision
   and not a design fault. */
function holdPlumbed(tid){
  const ci=tankCircuit(tid);
  if(ci===null || ci===undefined) return false;     // piped to nothing at all
  const G=nodeGraph(), ns=G.nodesOf[tid];
  if(!ns || !ns.length) return false;
  const seen=G.reach(ns);
  let nodes=0; for(const n in seen) nodes++;
  const pairs=new Set();
  for(const u in seen) for(const v of (G.adj[u]||[]))
    if(seen[v] && u!==v) pairs.add(u<v?u+"|"+v:v+"|"+u);
  return pairs.size>=nodes;
}
// every hold tank on the plant is wired, or there is none to be wired
const pzrPlumbed = () => holdTankIds().every(holdPlumbed);
// NONE is a real dropdown choice on a machine that IS on the board, so backup power ghosts rather than vanishes
const fitted=p => p.role==="bkp" ? D.bkp>0 : true;
const cen=p=>({x:p.x+p.w/2,y:p.y+p.h/2});
const pinnedTo=p=>LAY.parts.filter(q=>q.pin&&q.pin.to===p.id);
/* What is standing in each cell. Pipes, ports and paint are FLAGS because callers differ: groupFits() wants pipes in, freeAdj() wants them out (a machine ringed by its own pipework would block its own repair), and a pipe crossing a gas-tight cell is a PENETRATION rather than a collision. */
/* Cached on the graph, but only the SKIPLESS grid: a skip is a what-if about a part standing somewhere else. No caller writes to the grid it is handed. */
function occupied(skip,opt){
  const off = skip ? (Array.isArray(skip)?skip:[skip]) : [];
  const wantPipes = !opt || opt.pipes!==false;
  const wantPorts = !opt || opt.ports!==false;
  const wantMat   = !opt || opt.mat!==false;
  const slot=graphSlot("occupied"), key=(wantPipes?"p":"-")+(wantPorts?"o":"-")+(wantMat?"m":"-");
  if(!skip){ const hit=slot.get(key); if(hit) return hit; }
  const g=new Array(GH); for(let Y=0;Y<GH;Y++) g[Y]=new Array(GW).fill(null);
  for(const p of LAY.parts){ if(off.includes(p)) continue;
    for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
      if(X>=0&&X<GW&&Y>=0&&Y<GH) g[Y][X]=p; }
  if(wantPorts) for(const pid in D.ports){
    const q=D.ports[pid], owner=partOf(q.p);
    if(!owner || off.includes(owner)) continue;
    const c=[owner.x+q.dx, owner.y+q.dy];
    if(c[0]>=0&&c[0]<GW&&c[1]>=0&&c[1]<GH && !g[c[1]][c[0]]) g[c[1]][c[0]]={id:pid, port:true};
  }
  if(wantMat) for(const k in (D.mat||{})){
    const i=k.indexOf(","), X=+k.slice(0,i), Y=+k.slice(i+1);
    if(X>=0&&X<GW&&Y>=0&&Y<GH && !g[Y][X]) g[Y][X]={id:"mat:"+k, mat:true, role:"mat"};
  }
  if(wantPipes) for(const k in D.pipes){
    const i=k.indexOf(","), X=+k.slice(0,i), Y=+k.slice(i+1);
    if(X>=0&&X<GW&&Y>=0&&Y<GH && !g[Y][X]) g[Y][X]={id:"pipe:"+k, pipe:true};
  }
  if(!skip) slot.set(key,g);
  return g;
}
// all of a group is tested before any of it moves, so it never half-lands; a part's own PORTS move with it and are tested too
function groupFits(cells){
  const g=occupied(cells.map(c=>c.q));
  const blocked=(X,Y)=>X<0||Y<0||X>=GW||Y>=GH||!!g[Y][X];
  for(const {q,x,y} of cells){
    if(x<0||y<0||x+q.w>GW||y+q.h>GH) return false;
    for(let X=x;X<x+q.w;X++) for(let Y=y;Y<y+q.h;Y++) if(g[Y][X]) return false;
    for(const pid in D.ports){ const pt=D.ports[pid];
      if(pt.p!==q.id) continue;
      if(blocked(x+pt.dx, y+pt.dy)) return false; }
  }
  return true;
}
/* What a move would fill, asked before it happens: the part plus everything pinned to it, so the landing preview and the move cannot disagree. */
const moveCells=(p,nx,ny)=>[{q:p,x:nx,y:ny}].concat(
  pinnedTo(p).map(q=>({q,x:nx+q.pin.dx,y:ny+q.pin.dy})));
/* A drop is never refused: a part dropped where it does not fit lands there, draws red, and blocks commissioning until it is moved out (p.limbo). */
function moveTo(p,nx,ny){
  if(p.pin) return false;
  const cells=moveCells(p,nx,ny);
  /* A run's end follows its own nozzle, and this is read BEFORE anything moves: portAtCell() answers for the board as it stands. */
  const shift=[];
  for(const {q,x,y} of cells){
    const dx=x-q.x, dy=y-q.y; if(!dx&&!dy) continue;
    for(const rid in D.runs) for(const w of ["a","b"]){
      const e=D.runs[rid][w], pid=portAtCell(e[0],e[1]);
      if(pid!=null && D.ports[pid].p===q.id) shift.push({rid, w, dx, dy});
    }
  }
  /* The cell has to land back in D or the next unrelated rebuild undoes the move; moveTo() is the ONLY way a part changes position. */
  for(const {q,x,y} of cells){ q.x=x; q.y=y;
    if(D.machines[q.id]) D.machines[q.id].cell=[x, cellStore(q.role,y,q.h)];
    if(D.tanks[q.id])    D.tanks[q.id].cell=[x,y];
    if(D.fittings[q.id]) D.fittings[q.id].cell=[x,y]; }
  dTouch();                        // moves a part without rebuilding LAY - see dTouch() (design.js)
  markLimbo(LAY.parts);
  // re-laid, not translated: the box it was routed round is somewhere else now
  const relay={};
  for(const {rid,w,dx,dy} of shift){ const e=D.runs[rid][w];
    D.runs[rid][w]=[e[0]+dx, e[1]+dy]; relay[rid]=1; }
  /* Unlinked rather than lifted: the nozzle has already ridden its own part to the new cell, so runPortFor() claims that very one back instead of runEndPort() handing the pipe to whatever the part was parked beside. */
  for(const pid in D.ports) if(relay[D.ports[pid].run]) delete D.ports[pid].run;
  for(const rid in relay) runLay(rid);
  return true;
}
// every cell a party could stand in beside p and still be working ON p; `g` is occupied(null,{pipes:false}) at every caller, because a machine's own pipework must not wall it in
function freeAdj(p,g){
  const out=[];
  // a machine's own nozzle does not wall it in: a four-way tee carries a port on every face by construction
  const own = c => c && c.port && D.ports[c.id] && D.ports[c.id].p===p.id;
  for(let X=p.x-1;X<=p.x+p.w;X++) for(let Y=p.y-1;Y<=p.y+p.h;Y++){
    if(X<0||Y<0||X>=GW||Y>=GH) continue;
    const inside = X>=p.x&&X<p.x+p.w&&Y>=p.y&&Y<p.y+p.h;
    const edge = (X<p.x||X>=p.x+p.w)!==(Y<p.y||Y>=p.y+p.h);
    if(!inside && edge && (!g[Y][X] || own(g[Y][X]))) out.push([X,Y]);
  }
  return out;
}
/* Asked BEFORE laySettle(), or the window holds a graph read off the board the player has just left. sigFresh() runs here and nowhere else: it is the raw pass that catches an edit nobody declared with dTouch(). */
const layFresh=()=>{ sigFresh(); if(!LAY||layFit!==laySrcSig()) buildLayout(); };
/* Keyed on DGEN and taken AFTER layFresh(), which is what proves the generation. NOT sigMemo(): it compares with !==, so an object would read as an edit every frame. */
let lmGen=-1, lmVal=null;
function layoutMetrics(){
  layFresh();
  if(lmGen===DGEN && lmVal) return lmVal;
  const out=layoutMeasure();
  lmGen=DGEN; lmVal=out;
  return out;
}
function layoutMeasure(){
  /* A blank grid has no vessel, so every figure measured from one is measured from the middle of the hull instead; nothing here refuses to answer. */
  const P_=LAY.parts, core=partOf(primaryCore()), cc=core?cen(core):{x:GW/2,y:GH/2};
  let head=0, n=0;
  for(const p of P_) if(p.role==="sg"){ head += (cc.y - cen(p).y); n++; }
  head = n? head/n : 0;
  let pipe=0, sec=0, dead=0, pmass=0;
  for(const r of pipeNetwork()){
    const L=r.L;
    pmass += L * runMassPerM(r);
    /* A relief line is a DEAD LEG: shut behind its valve, so it adds no inertia to a loop transient, and it still costs mass because it still has to be built and hung. */
    if(r.k==="relief") dead+=L;
    // a cross-tie is a parallel branch, not another metre of loop
    else if(r.k==="hot"||r.k==="cold"||r.k==="surge"||r.k==="hpi") pipe+=L;
    else sec+=L;
  }

  const hull=p=>{ let k=0; for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
      if(X===0||X===GW-1||Y===0||Y===GH-1) k++; return k; };
  let cells=0, exp=0;
  for(const p of P_){ if(!fitted(p)) continue; cells+=p.w*p.h; exp+=hull(p); }
  const exposure = cells? exp/cells : 0;

  const g=occupied(null,{pipes:false});
  let reach=0, tot=0;
  for(const p of P_){ if(!fitted(p)) continue; tot++;
    const ok=freeAdj(p,g).length>0;
    p.access=ok; if(ok) reach++;
  }
  const access = tot? reach/tot : 1;   // nothing on the board is nothing walled in

  // crew dose is the radiation field read at the room the crew sit in, so the bench number and the diagram cannot disagree
  const radK=radGeom(), radF=radSolve(radK,radSrc(null));
  const dose=radAt(radF,radK.crew), peak=radPeak(radF);

  let sep=99;
  const sgs=P_.filter(p=>p.role==="sg");
  if(sgs.length>1) for(let i=0;i<sgs.length;i++) for(let j=i+1;j<sgs.length;j++){
    const a=cen(sgs[i]), b=cen(sgs[j]);
    sep=Math.min(sep,Math.abs(a.x-b.x)+Math.abs(a.y-b.y));
  }
  // the steam bubble has to sit at the top of the loop, and the accumulator drains downhill
  let loopTop=core?core.y:GH;
  for(const q of P_) if(q.role==="sg") loopTop=Math.min(loopTop,q.y);
  // the lowest hold tank decides: a bubble that cannot form anywhere is what costs the damping
  const pzrOK = holdTankIds().every(id=>{ const q=partOf(id); return !q || q.y<=loopTop; });
  const pzrK  = pzrOK ? 1 : 0.45;
  /* WIRED, which costs the plant nothing here - pzrK is elevation only, and what an unplumbed vessel costs is decided in the tick. */
  const pzrConn = pzrPlumbed();
  const turbConn  = turbPiped();
  const sgNoSteam = P_.filter(p=>p.role==="sg" && !sgSteams(p.id)).map(p=>p.id);
  /* There is no invisible lid on this plant: a generator that cannot get rid of the steam it raises bursts. */
  const sgNoRelief = P_.filter(p=>p.role==="sg" && !reliefsOnShell(p.id)).map(p=>p.id);
  /* Both sides of an exchanger are real circuits, so with nothing standing on the far one the box is a length of pipe carrying a mass. */
  const ihxIdle   = P_.filter(p=>p.role==="ihx" && !ihxFeeds(p.id).length).map(p=>p.id);
  /* Direction is the casing, so this asks the drawing and not what the pump is for: whatever the b face folds onto is where the water leaves. */
  const pumpNoDis = P_.filter(p=>{
    if(!roleHead(p.role)) return false;
    const R=ROLE[p.role], IN=(Array.isArray(R.internal)?R.internal:[R.internal]).find(x=>x.head);
    const f=R.fold||{}, faces=[IN.b].concat(Object.keys(f).filter(k=>f[k]===IN.b));
    const use=pipeNetwork().usage||{};
    return !faces.some(face=>use[p.id+face]>0);
  }).map(p=>p.id);
  /* Metres above the core per TANK, a MAP because no tank is privileged; elevation is LIVE, entering the solve as the static head of the tank's own column. */
  const tankZ = {};
  for(const q of P_) if(q.role==="tank") tankZ[q.id] = (cc.y-cen(q).y)*MPC;
  /* The worst head of any tank that could inject; "could inject" is a check valve on a primary tank, a structural fact and not a name. */
  let injZ = null;
  for(const q of P_){ const t=q.role==="tank" && D.tanks[q.id];
    if(t && tankPrimary(q.id) && t.check) injZ = injZ===null ? tankZ[q.id] : Math.min(injZ, tankZ[q.id]); }

  // a metre of pipe is priced by its bore and what is inside it (runMassPerM()); shielding is paint, so it weighs a real thickness of a real material
  const mass = pmass + matMass();
  layMass = mass;
  return {pipe,sec,dead,head,exposure,access,dose,sep,mass,pzrOK,pzrK,pzrConn,turbConn,sgNoSteam,sgNoRelief,ihxIdle,pumpNoDis,tankZ,injZ:injZ===null?0:injZ,radK,peak,
    inertiaK: 1+0.012*(pipe+sec)};
}
// the arrangement half of designSig(): id + grid position + hull only, so a bench slider that moves nothing does not invalidate rad.js's kernels; the hull because every cache keyed here is indexed Y*GW+X. LAY is null before the first buildLayout()
const laySig = sigMemo(() => (LAY ? LAY.parts.map(p=>p.id+":"+p.x+","+p.y).join(";") : "")+gridSig());

/* Per-table signatures, not JSON.stringify(D): dbPanelSig compares this every frame and ~150 pipe cells make that a measured hot spot. */
const D_SCALARS=()=>{ const o={};
  for(const k in D) if(k!=="pipes" && k!=="ports" && k!=="tanks" && k!=="fittings" && k!=="cores" && k!=="runs") o[k]=D[k];
  return JSON.stringify(o); };
// every knob on a tank or a fitting: laySrcSig() carries only what puts a box on the board
const D_PARTPARAM=()=>JSON.stringify(D.tanks)+"|"+JSON.stringify(D.fittings);
// latSig() joins the key because most of what a lattice pen changes is NOT a D field
function designSig(){ return D_SCALARS()+D_PARTPARAM()+laySrcSig()+"|"+coreIds().map(id=>id+":"+latSig(D.cores[id])).join(";")+"|"
  +LAY.parts.map(p=>p.id+":"+p.x+","+p.y).join(";"); }
