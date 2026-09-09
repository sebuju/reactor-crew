"use strict";
let P=null,S=null;
/* a generator so prewarmStep() (screens/shell.js) can drive commissioning a slice at a time */
function commission(){ const g=commissionGen(); while(!g.next().done); }
function* commissionGen(){
  /* K is the xenon clock: a deliberate 400x time compression, so a scram costs ~3 min of lockout */
  const d=derived(),a=d.a,f=d.f,B=d.beta*1e-5,K=400,L=layoutMetrics();
  P={BETA:B,bet:[.033,.219,.196,.395,.115,.042].map(x=>x*B),
     lam:[.0124,.0305,.111,.301,1.14,3.01],LAM:d.Lam,
     aF:a.aF, aM:d.aM, aV:d.aV, aX:d.aX, aS:d.aS, pwrDef:d.pwrDef, P0:d.P0, tsat0:a.tsat*Math.pow(d.P0/a.P0,coolSatN(a)),
     // with no vessel placed P describes the stand-in, and P.vessel says so
     rated:coreIds().length ? ratedMWt() : priD().power, dnbr0:d.dnbr0, dnbLaw:a.dnbLaw, Fq0:d.Fq, xeW:d.xeW, scram:d.scram,
     excess:d.excess, flowMin:flowMinOf(),
     id:a.id, name:a.name,
     eff:d.eff, loadMax:d.loadMax, condCap:d.condCap,
     condK:f.condK, pzrK:holdDampK()*L.pzrK,
     dose:L.dose, radK:L.radK, bypass:condDumpMean()/Math.max(1e-9,plantSteam()),
     rpsm:D.rpsm, rpsLag:D.rpsLag, arLo:D.arLo, arHi:D.arHi, rodRate:rodSpdOf(priD()),
     /* the lattice is drawn on its own surface, so the reactivity terms above exist with no vessel on the grid */
     vessel:!!roleOf("core"),
     catcher:LAY.parts.some(p=>p.role==="catcher"), backup:BKP[D.bkp].bk,
     fittings:JSON.parse(JSON.stringify(D.fittings)),
     loops:sgCount(), sdm:d.sdm, sdmB:d.sdmB, boronOp:d.boronOp, lay:L,
     lamI:XE.lamI*K, lamX:XE.lamX*K, gI:XE.gI, gX:XE.gX,
     /* kg/m^3 - the pipe network weighs a column of it for buoyancy (rhoAt(), pipenet.js) */
     rho0:a.dens*RHO_K};
  /* ahead of the network below: rhoAt() measures density about this temperature and netCoreFrac0() solves the plant before this returns */
  P.sat   = satCurveFor(a, P.P0);
  P.hfg   = a.hfg;                                     // kJ/kg
  /* saturation is the ceiling - past it the programme is superheat, which this model has no enthalpy for */
  P.Tref  = Math.min(a.Tref, P.tsat0);
  // where COOLANT[].dens is quoted, so a supercritical coolant's p/T law (mixState) has a real anchor
  P.sat.Tref = P.Tref;
  /* every circuit with a vessel on it, on its own curve; the first vessel's is P.sat itself */
  { const G = nodeGraph(); P.coreSat = {}; P.coreSatSig = G.sig;
    for(const id of coreIds()){ const ci = coreCircOf(id);
      if(ci >= 0 && !P.coreSat[ci]) P.coreSat[ci] = ci === G.coreCirc ? P.sat : satCurveOf(id); } }
  /* numerical headroom, never behaviour */
  P.Tmin  = P.Tref - 350;
  P.Tmax  = P.tsat0 + 400;
  /* the ship's own compartment pressure, absolute; ahead of the network, which fixes every containment node at it */
  P.Pcont = 0.15;
  /* ahead of the network: the feed train's C and the governor's gate read these, and the reference solve evaluates both */
  P.steamRef = plantSteam();
  P.swallow  = totalTurbKgs();
  /* wide open, at design shell pressure against design backpressure, the machine passes exactly its swallow */
  P.turbC = P.steamRef/Math.max(flowW(1, steamRhoDes(), sgDesignP(), condPDes()), 1e-9);
  yield {frac:.01, stage:"PIPE NETWORK"};
  P.net    = netBuild();
  // the same net with every bore at its own nominal - the frame P.netRef is taken in
  P.netNom = withNomBore(() => netBuild());
  yield {frac:.03, stage:"PIPE NETWORK"};
  P.netRefByLoop = {};
  P.netRefByRun  = {};
  let refOuts = {}, nomOuts = {};
  /* P.wRated is the flow the core takes coreDT0() of rise at; P.flowK is the solved reference over it */
  P.wRated = P.rated*1000/(P.sat.cp*coreDT0());
  const refPower = () => {
    P.flowK = P.netRef/P.wRated;
    P.feff0 = P.flowK;
    P.n0    = Math.min(1, P.flowK);
    P.steamRef = P.n0*P.rated*1000/steamRise();
    P.turbC = P.steamRef/Math.max(flowW(1, steamRhoDes(), sgDesignP(), condPDes()), 1e-9); };
  { const want = ratedSteam()/Math.max(1,sgCount());
    /* secant, not a rate-limited walk: a design-time reference carries no valve stroke rate */
    const fedOf = (outs,id) => (outs.sgFeedBy && outs.sgFeedBy[id]) || 0;
    /* the circulation reference is the nominal plant, so netFlowK() reads what this plant's own bores cost it; per run it stays the drawn one */
    yield {frac:.05, stage:"CIRCULATION"};
    P.netRefByRun = {};
    nomOuts = {}; P.netRef = netCoreFrac0(P.netNom, P.netRefByLoop, {}, {}, nomOuts);
    refPower();
    netCoreFrac0(P.net, null, P.netRefByRun, {});
    const freg = {}, prev = {}, fedPrev = {};
    for(const id of sgIds()){ freg[id] = 0; prev[id] = 1; }
    { const o = {}; netCoreFrac0(P.net, null, null, {fregBy:prev}, o);
      for(const id of sgIds()) fedPrev[id] = fedOf(o,id); }
    for(let i=0;i<30;i++){
      const o = {}; netCoreFrac0(P.net, null, null, {fregBy:freg}, o);
      let worst = 0;
      for(const id of sgIds()){
        const fed = fedOf(o,id), slope = (fed - fedPrev[id])/((freg[id]-prev[id])||1e-9);
        worst = Math.max(worst, Math.abs(fed-want)/Math.max(want, FREG_SPAN));
        prev[id] = freg[id]; fedPrev[id] = fed;
        freg[id] = clamp(freg[id] + (Math.abs(slope)>1e-9 ? (want-fed)/slope : 0), 0, 1);
      }
      if(worst < 1e-4) break;
    }
    P.netRefByRun = {};
    refOuts = {};
    netCoreFrac0(P.net, null, P.netRefByRun, {fregBy:prev}, refOuts);
    P.fregRef = prev; }
  /* per machine: the ratio scales that machine's duty, and 0 is no heat sink at all */
  P.cwRefBy = Object.fromEntries(condIds().map(id=>[id, cwFlowOf(P.netRefByRun,id)]));
  yield {frac:.10, stage:"FLOW REFERENCES"};
  /* copied back only where the line had no scale at all, or a standby line references 0 forever */
  const openOuts = {};
  { const o = {}; netCoreFrac0(P.net, null, o,
      {refOpen:1, fregBy:P.fregRef}, openOuts);
    for(const k in P.netRefByRun) if(!P.netRefByRun[k] && o[k]) P.netRefByRun[k] = o[k]; }
  /* what every node passes, kg/s: half the sum of its incident edges, so a dead end reads exactly 0 */
  P.netRefThru = {};
  for(const o of [refOuts, openOuts]){
    if(!o.edgeKg) continue;
    const t = new Float64Array(P.net.n);
    for(let e=0;e<P.net.edges.length;e++){ const ed = P.net.edges[e];
      const m = netKgs(o.edgeKg[e]||0); t[ed.u] += m; t[ed.v] += m; }
    for(let i=0;i<P.net.n;i++){ const nm = P.net.name[i];
      if(!(P.netRefThru[nm] >= t[i]/2)) P.netRefThru[nm] = t[i]/2; } }
  P.netRefKg = {};
  for(const k in P.netRefByRun) P.netRefKg[k] = netKgs(P.netRefByRun[k]);
  /* xenon burnout, sigma*phi at rated flux, in units of the decay constant */
  P.sig=XE.sigK*P.lamX; P.XEQ=(P.gI+P.gX)/(P.lamX+P.sig); P.KXE=P.xeW/P.XEQ;
  P.pRise = a.P0>3 ? 1.0 : 0.25;
  P.burstK = d.vesselBurst/P.P0;                  // the first vessel's, for the plant-level readers
  P.solidK = a.solidK;                                 // MPa/K of a sealed liquid: beta over compressibility
  /* P.steamRef is what the boiler raises and is the scale; P.swallow is what the fitted machines can take and is a ceiling */
  { const n = Math.max(1, sgCount());
    /* floored: a BWR's secondary sits a few kelvin below its own primary programme */
    const dT0 = Math.max(5, P.Tref - tsatSec(sgDesignP()));
    P.sgUA = totalSgUA()/n;
    /* per machine as well as the mean: the heat term is per generator and the flow through each is its own loop's */
    P.sgUABy = Object.fromEntries(sgIds().map(id=>[id, sgUAOf(id)]));
  }
  /* the drop from design shell pressure to design condenser pressure is exactly the feed-to-steam rise, so only backpressure can move the work P.eff prices */
  P.hTurb   = steamRise()/Math.max(.05, 1-Math.pow(condPDes()/sgDesignP(),TURB_GAM));
  /* kW/K summed off the drawing; a plant with no condenser has a UA of exactly 0 */
  P.condUA  = totalCondUA();
  P.tdmg  = f.tdmg; P.tmelt = f.tmelt;
  /* sodium, salt and helium never oxidise a rod, so the whole path is one false rather than a temperature never reached */
  P.oxid  = !!a.oxid;
  P.dryout= a.dnbLaw!=="temp" && !a.fuelInCoolant;
  P.TfRef = P.Tref + a.dTf*P.condK*P.n0/Math.max(P.feff0,.10);
  P.X0    = xeEq(P,P.n0);                                // xenon equilibrium at that power
  yield {frac:.11, stage:"CORE MESH"};
  coreConst(P,priD(),d);
  /* the zirconium in the core, kg, off the drawing: rod surface times drawn wall, the same currency the ECR is in */
  P.cladKg = ZR_RHO*P.aHeat*ROD_CLAD;
  /* every vessel's own figures off its own drawing, chained to P so a circuit or plant figure falls through */
  P.cores = {};
  for(const cid of coreIds()){
    const c=coreD(cid), dc=derived(cid), ac=dc.a, fc=dc.f, Bc=dc.beta*1e-5, K=Object.create(P);
    /* its own circuit's figures, so K.sat, K.Tref, K.P0, K.flowK and K.n0 stop falling through to the first vessel's */
    { const ci=coreCircOf(cid), sat=(ci>=0 && P.coreSat[ci]) || P.sat;
      const netRef=(nomOuts.coreKgBy && nomOuts.coreKgBy[cid]) || 0;
      const wRated=c.power*1000/(sat.cp*coreDT0(c)), flowK=netRef/wRated;
      Object.assign(K,{circ:ci, sat, P0:sat.p0, tsat0:sat.T0, Tref:sat.Tref, Tmin:sat.Tref-350, Tmax:sat.T0+400,
        rho0:sat.rho, hfg:sat.hfg, wRated, netRef, flowK, feff0:flowK, n0:Math.min(1,flowK)}); }
    Object.assign(K,{id:cid, BETA:Bc, bet:[.033,.219,.196,.395,.115,.042].map(x=>x*Bc),
      lam:[.0124,.0305,.111,.301,1.14,3.01], LAM:dc.Lam,
      aF:ac.aF, aM:dc.aM, aV:dc.aV, aX:dc.aX, aS:dc.aS, pwrDef:dc.pwrDef,
      rated:c.power, dnbr0:dc.dnbr0, dnbLaw:ac.dnbLaw, Fq0:dc.Fq, xeW:dc.xeW, scram:dc.scram,
      burstK:dc.vesselBurst/K.P0,
      excess:dc.excess, condK:fc.condK, sdm:dc.sdm, sdmB:dc.sdmB, boronOp:dc.boronOp,
      rodRate:rodSpdOf(c), tdmg:fc.tdmg, tmelt:fc.tmelt, oxid:!!ac.oxid,
      dryout:ac.dnbLaw!=="temp" && !ac.fuelInCoolant, hfg:ac.hfg, dnbrK:1, tube:!!c.tube});
    K.KXE = K.xeW/K.XEQ;
    K.TfRef = K.Tref + ac.dTf*K.condK*K.n0/Math.max(K.feff0,.10);
    K.X0 = xeEq(K,K.n0);
    coreConst(K,c,dc);
    K.cladKg = ZR_RHO*K.aHeat*ROD_CLAD;
    P.cores[cid]=K;
  }
  P.dsig = designSig();                 // what this plant was built from
  yield {frac:.12, stage:"SETTLING"};
  P.dnbrK = 1; resetPlant();
  /* what this plant is subcooled by untouched: a fixed scale would peg four of six architectures */
  P.sc0 = S.sc;
  /* at or above saturation means the loop is its own steam space and needs no pressurizer programme */
  P.steam = P.sc0 <= 0;
  /* and what it voids by at rest - subcooled boiling means that need not be zero */
  P.vf0 = S.vf; coreEach(S,(cs,K,id)=>{ K.vf0=cs.vf; K.sc0=satT(K.sat, loopP(S,K.circ)) - (TavgOf(S,K.circ) + coreDT0(coreD(id))*cs.heat/2); K.steam=K.sc0<=0; });
  /* one real step, because the hot node's quality is walked inside coreStep(); it is then thrown away */
  yield {frac:.35, stage:"TUBE FIT"};
  step(0.02);
  P.dnbrK = P.dnbr0/Math.max(S.dnbr,1e-9); coreEach(S,(cs,K)=>{ K.dnbrK = K.dnbr0/Math.max(cs.dnbr,1e-9); });
  /* the governor is refitted at the pressure the line delivers, on the highest shell and including what the dump is taking */
  { const ids=sgIds();
    /* full step for the first round, then a secant on (ln turbC, ln k): a line with real losses answers less than proportionally */
    let lnCw, lnKw;
    for(let r=0;r<6;r++){ let k=0, to=0;
      yield {frac:.38+.10*r, stage:"GOVERNOR"};
      /* the governor is a FLOW match on the nozzle, so both sides are the physical steam: the bleed is taken downstream of it */
      const wk = S.turbWk + bleedPlant(S);
      if(P.turbC>0) for(const id of ids){ k = Math.max(k, secP(S,id)/sgDesignP(id)); to += S.steamBy[id]||0; }
      k = (k>0 && wk>0) ? k*Math.max(to,wk)/wk : 1;
      if(r>0 && Math.abs(k-1) < 3e-3) break;
      const lnC = Math.log(P.turbC), lnK = Math.log(k);
      let step = lnK;
      if(r>0){ const m = (lnK-lnKw)/(lnC-lnCw); if(m < -0.05 && m > -1.5 && isFinite(m)) step = -lnK/m; }
      lnCw = lnC; lnKw = lnK;
      P.turbC *= Math.exp(step); resetPlant(); } }
  S.dnbr  = P.dnbr0;
  screen="operate"; layout();
}
/* what the switchboard delivers, as a share of normal; read once into every pump's speed target, or the blackout is applied twice */
const supplyK = s => s.blackout ? (s.bkpLost ? 0 : P.backup) : 1;
const burstPOf = (K,cs) => K.P0*(K.burstK - 0.0028*cs.fatigue);   // fatigue slope is a game figure, no source
/* Zr-2.5Nb strength against wall temperature, two knots, the way BURST_LO/HI reduces NUREG-0630 */
const ZR_LO={T:573,k:1.0}, ZR_HI={T:1073,k:0.2};
const zrK = T => ZR_LO.k + (ZR_HI.k-ZR_LO.k)*clamp((T-ZR_LO.T)/(ZR_HI.T-ZR_LO.T),-0.3,1);

function tubeStep(s,cs,K,id,burst){
  const net=P.net, c=coreD(id);
  let opened=0;
  for(let i=0;i<XNR;i++){ if(cs.nTube[XIX(i,0)]>0) continue;
    let go=false; for(let j=0;j<XNZ;j++) if(cs.pCore > burst*zrK(cs.nTc[XIX(i,j)])){ go=true; break; }
    if(!go) continue;
    for(let j=0;j<XNZ;j++) cs.nTube[XIX(i,j)]=1; opened++; }
  if(opened){ let f=0; for(let k=0;k<XNN;k++) f+=nodeW[k]*cs.nTube[k]; cs.tubesOpen=f;
    if(!cs.trip) cs.trip="CHANNEL RUPTURE";
    logE("alarm","FUEL CHANNEL RUPTURE / "+nameOf(id),
      (cs.tubesOpen*100).toFixed(0)+" % of the channels are torn at "+cs.pCore.toFixed(2)+" MPa against the "+burst.toFixed(2)+" a cold tube takes. They are discharging into the reactor cavity, which has its own relief sized for one of them.","tube:"+id); }
  if(!net || !net.cavCont || net.cavCont[id]===undefined) return;
  const gauge = netPAt(s,"cav:"+id) - netPcont(net,s,net.cavCont[id]), lift = shieldLiftP(c);
  if(gauge > lift*CAV_LIFT_K) cs.cavRelief=1; else if(gauge < lift*CAV_LIFT_K*CAV_RESEAT_K) cs.cavRelief=0;
  if(cs.breach || !(gauge > lift)) return;
  cs.breach=true; cs.trip="SHIELD LIFTED";
  logE("alarm","UPPER SHIELD LIFTED / "+nameOf(id),
    "The reactor cavity reached "+(gauge*1000).toFixed(0)+" kPa against the "+(lift*1000).toFixed(0)+" its shield weighs. The shield is off, every channel is torn at its top weld and the whole core is open to the room.","shield:"+id);
  /* posted the way a burn posts its own blast, so the damage sweep sees no second mechanism */
  const p=partOf(id); if(!p) return;
  const g=roomPGauge(s), kPa=lift*1000;
  for(let X=p.x-1;X<=p.x+p.w;X++) for(let Y=p.y-1;Y<=p.y+p.h;Y++) if(X>=0&&X<GW&&Y>=0&&Y<GH){ const i=Y*GW+X;
    s.roomP[i]=Math.max(s.roomP[i], g[i]+kPa); if(s.roomP[i]>s.roomPPk[i]) s.roomPPk[i]=s.roomP[i]; }
  s.roomBang=Math.max(s.roomBang||0, kPa);
}
/* FITTED is "somebody wired a scram", ARMED is "and the block driving it is on" */
const rpsLive  = ()=> coreIds().some(rpsArmed);
const rpsState = ()=> !coreIds().some(id=>sinkWired(S,"scram",id)) ? "NOT FITTED"
                    : rpsLive() ? "ARMED" : "BYPASSED";
const nameOf = id => {
  const p = partOf(id);
  return p ? partName(p) : id.toUpperCase();
};
const nameList = ids => ids.map(nameOf).join(", ");
/* P is null on the bench, and a plant may legally have no relief fitting, so every reader below answers with an empty list rather than throwing */
const reliefFitIds = () => { const f=P?P.fittings:D.fittings;
  return Object.keys(f).filter(id=>f[id].mode==="relief"); };
/* shellsOf() is the one predicate: a valve that reaches a shell protects it, one that reaches none is primary */
const reliefSecIds = () => reliefFitIds().filter(id=>shellsOf(id).length>0);
const reliefPriIds = () => reliefFitIds().filter(id=>shellsOf(id).length===0);
const reliefsOnShell = sgid => reliefFitIds().some(id=>shellsOf(id).indexOf(sgid)>=0);
const primaryRelief = () => reliefPriIds()[0];
/* a valve protecting several shells is judged on the worst of them; cached for one pass (layPass()), 0 means not cacheable */
let refPCache = {}, refPPass = -1;
const reliefRefP = fid => { const pn = layPass();
  if(pn && refPPass !== pn){ refPCache = {}; refPPass = pn; }
  if(pn && refPCache[fid] !== undefined) return refPCache[fid];
  const v = reliefRefPOf(fid);
  if(pn) refPCache[fid] = v;
  return v; };
/* the same reference off the DRAWING alone: designBake() runs on the bench, where P is the last plant commissioned */
const reliefRefPD = fid => shellsOf(fid).length ? Math.min.apply(null, shellsOf(fid).map(sgDesignP))
                       : holdPSuggest(nodeGraph().coreCirc);
const reliefRefPOf = fid => (P && !shellsOf(fid).length) ? P.P0 : reliefRefPD(fid);
/* which shells this valve can see right now: the drawing with the shut runs cut out */
const shellsLive = (s,fid) => shellsOf(fid, portDead(s));
const reliefIso  = (s,fid) => shellsOf(fid).length>0 && shellsLive(s,fid).length===0;
const reliefAtP = (s,fid) => { const sh=shellsOf(fid);
  if(!sh.length) return s.P;
  const live=shellsLive(s,fid);
  /* isolated: nothing feeds the stub, so it holds compartment pressure and the valve cannot lift */
  if(!live.length) return regionPAt(s, partOf(fid));
  let pk=0; for(const id of live) pk=Math.max(pk,secP(s,id)); return pk; };
const reliefAnyOpen = s => reliefFitIds().some(id=>s.reliefOpen[id] && !s.reliefBlocked[id]);
const reliefAnyStuck = s => reliefFitIds().some(id=>
  s.reliefOpen[id] && s.reliefAuto[id] && s.reliefStuck[id] && !s.reliefBlocked[id]);
/* which bank answers a controller: not tripped, not jammed, and split, on AUTO; whether a controller is live is the caller's question */
const bankAutoLive = (cs,b) => !cs.scrammed && !cs.rodJam && (!cs.split || cs.bankAuto[b]);

/* wired or it does not happen: `SINK.runback` (ctl.js) orders it off the vessel's own TRIPPED signal, one tick after the trip */
const runbackLive = () => !!sinkDriver(S,"runback",null);
function runbackNow(s){
  let live=0; coreEach(s,(cs,K)=>{ if(!cs.scrammed) live+=K.rated; });
  s.load=s.loadDem=Math.min(s.load, Math.max(0.05, P.rated>0 ? live/P.rated : 0)); }

/* level at which a condenser's tubes start to drown in their own condensate */
const HOT_FLOOD=90;       // %
/* off the pool, not one tank, so two condensers are two hotwells behaving as one; exactly 1 below HOT_FLOOD */
const condFrac = s => { const h=hostedTankIds(); if(!h.length) return 1;
  return clamp((100 - tankPoolPct(s,h))/(100-HOT_FLOOD), 0, 1); };
const CW_RISE=10;         // K, circulating water rise at the design point
/* a condenser is a sink whose internal path declares an anchor; a radiator declares none */
const condIds = () => LAY.parts.filter(p=>{ const R=ROLE[p.role];
  return R && R.thermal==="sink" && roleIntern(R).some(IN=>IN.anch); }).map(p=>p.id);
/* one machine's circulating water paths: the internal paths that declare no anchor */
const cwPathsOf = id => { const p=partOf(id), R=p&&ROLE[p.role], o=[];
  if(!R || R.thermal!=="sink") return o;
  for(const IN of roleIntern(R)) if(!IN.anch)
    o.push({key:"comp:"+id+":"+IN.a+IN.b, a:IN.a, b:IN.b});
  return o; };
const cwFlowOf = (m,id) => { let f=0;
  for(const q of cwPathsOf(id)) f += Math.abs(m[q.key]||0); return f; };
/* the solved pressure field, kept on S for next tick's readers - refilled, never rebuilt */
const keepPField = (s, pf) => {
  const net = P && P.net, by = s.pBy, has = Object.prototype.hasOwnProperty;
  let n = 0, added = 0;
  for(const k in pf){ if(!has.call(by, k)) added++; by[k] = pf[k]; n++; }
  // pByN is by's key count after the last call on this object, so a stale key is a count that does not add up
  if(!net || net.pByObj !== by || net.pByN + added !== n)
    for(const k in by) if(pf[k] === undefined) delete by[k];
  if(net){ net.pByObj = by; net.pByN = n; } };
/* the inlet face of each circulating water path, read along the solved flow's own direction */
const cwInOf = (s, runFlow, id) => {
  let t = 0, n = 0;
  for(const q of cwPathsOf(id)){ const ref = Math.abs(P.netRefByRun[q.key]||0);
    const r = ref > 1e-9 ? (runFlow[q.key]||0)/ref : 0;
    t += netTempAt(s, coreFold(id + (r >= 0 ? q.a : q.b))); n++; }
  return n ? t/n : undefined; };
/* the design sink is the answer before the first tick has written one */
const cwInAt = (s,id) => { const v = s.cwInTBy && s.cwInTBy[id];
  return v===undefined ? RAD_TDES : v; };
/* this machine's own circulating water against what this machine commissioned with */
const cwKOf = (s,id) => { const ref = (P.cwRefBy && P.cwRefBy[id]) || 0;
  if(!(ref>0)) return 0;
  const f = s.cwFlowBy && s.cwFlowBy[id];
  return clamp((f===undefined ? ref : f)/ref, 0, 2); };
/* terminal temperature difference at rated duty, K - the anchor P.condUA is fitted on */
const COND_DT0=13;
/* the backpressure the plant was designed for; P.hTurb is anchored here */
const condPDes = () => psatSec(RAD_TDES + COND_DT0);
/* where the drawn sink sits at a stated rejection, K - the commissioning seed and the bench's CONDENSER MARGIN both */
const condRest = qkW => {
  const t0 = radTAt(qkW), radT = isFinite(t0) ? t0 : RAD_TDES;
  let ra = 0; for(const id of radIds()) ra += radUAOf(id);
  const ua = totalCondUA(), cwC = ua>0 ? ua/Math.log(COND_DT0/(COND_DT0-CW_RISE)) : Infinity;
  const cwIn = radT + (ra>0 ? qkW/ra : 0) - qkW/cwC;
  return {radT, cwIn, condT: cwIn + (ua>0 ? qkW/(cwC*CW_RISE/COND_DT0) : COND_DT0)}; };
/* bought capacity less what is broken less tubes drowned in condensate; may be exactly 0 */
const condKOf = (s,id) => partWrecked(s,id) ? 0 : condFrac(s);
/* a severed exhaust run sits in the vacuum, so what a hole there passes is air going in */
const exhOpen = s => !!(P && P.net && (P.net.steamBreaks||[]).some(bk =>
  bk.exh && runHoled(s,bk)));
/* past atmospheric a condenser relieves and never gets its vacuum back: nothing on this plant pumps the air out */
const COND_ATM=0.101;     // MPa, and the pressure a lost condenser sits at
/* the exhaust pressure a turbine will not tolerate */
const TURB_TRIP_P=0.02;   // MPa
// re-opens well under the pressure that shut it, so a plant on the trip point does not chatter
const TURB_RESET_K=0.75;
/* the exhaust space's own pressure, written once a tick off its node; condP() is asked from inside the solve and may not see a half-solved field */
const condPRead = s => { let p = 0, n = 0;
  for(const id of condSinks()){ const v = s.condPBy && s.condPBy[id];
    if(v !== undefined && isFinite(v)){ p += v; n++; } }
  if(n) return Math.max(COND_P0, p/n);
  return s.condT===undefined ? condPDes() : Math.max(COND_P0, psatSec(s.condT)); };
const condP = s => Math.max(exhOpen(s) ? regionPAt(s, roleOf("cond")) : 0, s.condLost ? COND_ATM : 0,
  condPRead(s));
/* undefined on a plant with no condenser, which leaves the seed standing */
const condTMean = s => { const ids = condSinks(); if(!ids.length) return undefined;
  let t=0,n=0; for(const id of ids){ const v=condTOf(s,id);
    if(v!==undefined){ t+=v; n++; } }
  return n ? t/n : undefined; };
const cwInMean = s => { const ids = condSinks(); if(!ids.length) return undefined;
  let t=0,n=0; for(const id of ids){ const v=s.cwInTBy&&s.cwInTBy[id];
    if(v!==undefined){ t+=v; n++; } }
  return n ? t/n : undefined; };
const cwCOf = (s,id) => condUA(id)/Math.log(COND_DT0/(COND_DT0-CW_RISE))*cwKOf(s,id);
/* K - its pot, or nothing before the first tick has run one */
const condTOf = (s,id) => s.condTBy && s.condTBy[id];
/* the same with an answer always: before the first tick, the water arriving at it */
const condTAt = (s,id) => { const v = condTOf(s,id);
  return v===undefined ? cwInAt(s,id) : v; };
const condRejOf = (s,id) => { const c = cwCOf(s,id);
  if(!(c>0)) return 0;
  const cold = cwInAt(s,id), T = condTOf(s,id);
  return Math.max(0, c*(1-Math.exp(-condUA(id)*condKOf(s,id)/c))
                     *((T===undefined?cold:T)-cold)); };
const condRej = s => { let q=0; for(const id of condIds()) q += condRejOf(s,id); return q; };
const cwOutOf = (s,id) => { const c = cwCOf(s,id), cold = cwInAt(s,id), T = condTOf(s,id);
  return c>0 ? cold + condRejOf(s,id)/c : (T===undefined?cold:T); };
const cwOut = s => { const ids = condIds(); if(!ids.length) return RAD_TDES;
  let t=0; for(const id of ids) t += cwOutOf(s,id); return t/ids.length; };
/* The vacuum is why this vessel states its own compliance where a shell does not: at 0.01 MPa the whole span from a full hotwell to an empty one is 3e-5 MPa of saturation shelf, and a (p,h) store cannot resolve that against a plant solved in tenths. So the space over the pool is the compliance, the way a tank's gas charge is. */
const COND_CAP_DP = 0.001;                    // MPa, the secant's own step
const condCirc = id => circOfNode(condVesNode(id));
const condSatP = (s,id) => Math.max(COND_P0, psatSec(condTAt(s,id)));
const condSteamVol = (s,id) => Math.max(0.1, condVolOf(id)*(1 - clamp(condLvl(s,id),0,100)/100));
/* kg per MPa of the space filling up, by difference off the curve */
const condCapAt = (s,id,p) => { const ci = condCirc(id), c = satOfCirc(ci);
  const r0 = rhogOf(c, tsatSec(p, ci)), r1 = rhogOf(c, tsatSec(p+COND_CAP_DP, ci));
  return Math.max(1e-9, condSteamVol(s,id)*(r1-r0)/COND_CAP_DP); };
/* and the pool and its steel following saturation with it */
const condStoreC = (s,id) => { const ci = condCirc(id), p = condSatP(s,id);
  const hfg = Math.max(1, hfgOfCirc(ci,p));
  const dTdp = Math.max(1e-6, (tsatSec(p+COND_CAP_DP,ci)-tsatSec(p,ci))/COND_CAP_DP);
  const mW = (s.mBy && s.mBy[condVesNode(id)]) || 0;
  return condCapAt(s,id,p) + (mW*CP_W + partMassOf(id)*1000*CP_STEEL)*dTdp/hfg; };
/* kg/s of vapour going away without crossing an edge: what the tubes are condensing. A lifted relief is NOT a term here - it is an edge of this same matrix. */
const condStoreW = (s,id) =>
  -condRejOf(s,id)/Math.max(1, hfgOfCirc(condCirc(id), condSatP(s,id)));
/* every thermal store in this sim is this integrator */
const potStep = (T, cap, qIn, qOut, skin, dt, lo, hi) =>
  clamp(T + (qIn - qOut - (skin||0))/Math.max(1, cap)*dt,
        lo===undefined ? -Infinity : lo, hi===undefined ? Infinity : hi);
/* per panel, fed forward one tick - the same lag s.condT and s.coreDT carry */
const radTOf = (s,id) => { const v = s && s.radTBy && s.radTBy[id];
  return v===undefined ? RAD_TDES : v; };
const radTMax = s => { let t = -Infinity;
  for(const p of LAY.parts) if(p.role==="radiator") t = Math.max(t, radTOf(s,p.id));
  return isFinite(t) ? t : RAD_TDES; };
/* kW; radArea() already returns 0 for a panel that cannot see space */
const radRejOf = (s,id) => (s.dmgParts.indexOf(id)>=0) ? 0
  : Math.max(0, radCoatOf(id).emis*SIGMA*radArea(id)
      * (Math.pow(radTOf(s,id),4) - Math.pow(T_SPACE,4))/1000);
const radRej = s => { let w=0;
  for(const p of LAY.parts) if(p.role==="radiator") w += radRejOf(s,p.id);
  return w; };
/* this panel's own metal and the water it holds, kJ/K */
const radCap_ = id => radMass(id)*1000*CP_STEEL + partVol(id)*1000*CP_W;
const TURB_GAM=0.19;                 // (gamma-1)/gamma for steam
const turbDh = (ps,pc) =>
  P.hTurb*(1-Math.pow(clamp(pc/Math.max(ps,1e-4),0,1),TURB_GAM));

/* shaft work is steam times an enthalpy drop; a broken or unpiped turbine passes no steam, so no flag is needed here */
const mwE   = s => (s.turbWk||0)*turbDh(s.turbP||0, condP(s))*P.eff/1000;
/* a readout of the condenser's own balance, never a second number */
const mwRej = s => condRej(s)/1000;
function manualScram(id){ scramCore(id,"MANUAL SCRAM"); }
/* `why` is the name of the block that went hot (blkBlame(), ctl.js) */
function rpsScram(id,why){ scramCore(id, why ? "RPS TRIP / "+why : "AUTOMATIC SCRAM"); }
function scramCore(id,trip){
  const s=S;
  coreOn(s,id,(cs,K,id)=>{
    cs.scrammed=true; cs.rodDem=1; cs.trip=trip;
    /* a scram frees a sticky bank, but not a wrecked one */
    if(!s.dmgParts.includes(rodsOf(id))) cs.rodJam=false; });
  /* the load is not shed here: SINK.runback orders it from the cabinet */
}

/* hit() is what a hit does to the plant, fix() what a party reverses; fix:null means the physics reads s.dmgParts directly */
const DMGFX={
  core:{msg:"REACTOR VESSEL HIT",
    why:"A penetration in the vessel wall. The vessel is open to the compartment and emptying itself, and the metal is permanently damaged.",
    /* s.breach is the opening netBuild() prices at BREACH_BORE and the solve meters */
    hit:(s,id)=>{ const cs=coreState(s,id); if(!cs) return;
             cs.breach=true; if(!cs.trip) cs.trip="VESSEL RUPTURE";
             cs.fatigue=Math.min(100,cs.fatigue+12); }, fix:null},
  rods:{msg:"ROD DRIVE HIT",
    why:"The drive mechanisms are wrecked. The bank is stuck where it stands and a scram will not move it. Boron is the only shutdown you have left.",
    /* every demand adopts the actual, or the panel shows a bank travelling to a position nothing will take it to */
    hit:(s,id)=>{ const cid=coreOf(id), cs=coreState(s,cid); if(!cs) return;
             cs.rodJam=true; cs.rodDem=cs.rodPos; cs.tiltDem=cs.tilt;
             for(let b=0;b<P.cores[cid].NB;b++) cs.rodZDem[b]=cs.rodZ[b]; },
    fix:(s,id)=>{ const cs=coreState(s,coreOf(id)); if(cs) cs.rodJam=false; }},
  /* a stop valve slams: write actual AND demand, or the load lag drags the turbine back up */
  turb:{msg:"TURBINE HIT",
    why:"Load rejected. The turbine is offline, so the reactor has nowhere to send its heat.",
    hit:s=>s.load=s.loadDem=0.05, fix:null},
  cond:{msg:"CONDENSER HIT",
    why:"Heat rejection lost. Steam has nowhere to condense.",
    hit:s=>s.load=s.loadDem=0.05, fix:null},
  radiator:{msg:"RADIATOR PANEL HIT",
    why:"That panel sheds nothing now. The ship's heat sink is whatever is left of the others, so the condenser climbs and the turbine trips on backpressure.",
    hit:null, fix:null},
  /* ctlLive() (ctl.js) asks partWrecked() and every block holds its last output */
  ctrl:{msg:"INSTRUMENT CABINET HIT",
    why:"The control cabinet is wrecked. Every block in it stops computing and every demand it owned holds where it was.",
    hit:null, fix:null},
  bkp :{msg:"BACKUP POWER HIT",
    why:"Your emergency supply is gone. A blackout now means natural circulation only.",
    hit:s=>s.bkpLost=true, fix:s=>s.bkpLost=false},
  tank:{msg:"TANK HIT",
    why:"That tank's line is severed. Whatever it held is no longer reaching the loop. A tank that holds the circuit's pressure also loses its relief valve open, and it will not reseat.",
    /* a hold tank carries the circuit's relief path, so a hit knocks that valve open */
    hit:(s,id)=>{ if(!tankHold(id)) return; const fid=primaryRelief(); if(!fid) return;
      s.reliefOpen[fid]=true; s.reliefStuck[fid]=true; s.reliefAuto[fid]=true; },
    fix:(s,id)=>{ if(!tankHold(id)) return; const fid=primaryRelief(); if(!fid) return;
      s.reliefStuck[fid]=false; s.reliefOpen[fid]=false; s.reliefAuto[fid]=false; }},
  pump:{msg:"PUMP HIT",
    why:"That pump is dead. It develops no head at all, and whatever it was pushing round is down to what the rest of the plant can do without it.",
    hit:null, fix:null},
  sg  :{msg:"STEAM GENERATOR TUBE RUPTURE",
    why:"Primary coolant is leaking into the secondary side and venting past containment. Inventory falls and activity escapes.",
    hit:s=>s.sgtr=true, fix:s=>s.sgtr=false},
  /* a wrecked port is a hole; no hit/fix pair - the damage id is the state */
  port:{msg:"NOZZLE VALVE HIT",
    why:"That port's isolation valve is wrecked. The valve body is open to the room, so the run landed on it is severed at the machine and spilling there, and it cannot be cut out until a party has been out to it.",
    hit:null, fix:null},
  /* wrecked means the cell stops being gas-tight (matOpen(), paint.js); everything else follows from that one predicate */
  mat:{msg:"CONTAINMENT BREACH",
    why:"A cell of the wall is open. If it was holding a bounded region, that region is not bounded any more: the compartment behind it is now the ship's compartment, everything it was holding goes where the ship's air goes, and whatever was standing behind it is now shining on the crew.",
    hit:null, fix:null},
  pipe:{msg:id=>(cellInCore(id)?"PRIMARY ":"")+"PIPE RUPTURE",
    why:id=>cellInCore(id)
      ? "A primary run has been severed. It carries nothing round the loop any more, and both cut ends are now open to containment - the loop is losing coolant and pressure through them until something stops it."
      : "A run off the primary has been severed. It carries nothing round its own circuit any more, and both cut ends are open to the compartment - that circuit is losing its water and its pressure through them until something stops it.",
    hit:null, fix:null}
};
/* which circuit a burst cell stands on, asked of the run under it; a cell no run owns reads as the primary's, which is where a message with nothing traced belongs */
const cellInCore = id => { const c = id.slice(5).split(","), M = pipeMap();
  const key = (M.cellOwner[pipeKey(+c[0], +c[1])] || [])[0];
  const r = key && M.byKey[key];
  return !r || runCircOf(r) === nodeGraph().coreCirc; };
const DMGANY={msg:"EQUIPMENT HIT", why:"A component has been knocked out.", hit:null, fix:null};
/* this part first, then what it is, then the id-prefix fallback - most specific wins */
const dmgFx = id => {
  const p = partOf(id);
  const r = DMGFX[id] || (p && DMGFX[p.role])
      || DMGFX[Object.keys(DMGFX).find(k=>id.startsWith(k))] || DMGANY;
  /* a row may state its text off the thing that was hit; resolved HERE, so every reader still gets two strings */
  if(typeof r.msg !== "function" && typeof r.why !== "function") return r;
  return Object.assign({}, r, {msg: typeof r.msg === "function" ? r.msg(id) : r.msg,
                               why: typeof r.why === "function" ? r.why(id) : r.why});
};

/* everything on the board that is one cell and not in LAY.parts, so the heat and blast loops walk one list */
let hazCache = null, hazGen = -1;
function cellHazards(){
  if(hazCache && hazGen === DGEN) return hazCache;
  const out=[];
  for(const k in D.pipes){ const c=k.indexOf(",");
    out.push({id:"pipe:"+k, x:+k.slice(0,c), y:+k.slice(c+1), what:"the run at "+k}); }
  for(const pid in D.ports){ const c=portCell(pid); if(!c) continue;
    out.push({id:"port:"+pid, x:c[0], y:c[1], what:"the "+portLabel(pid)+" nozzle valve"}); }
  /* a shielding material declares no tsurv and is not in this list at all */
  for(const k of matCells()){ const c=k.indexOf(","), x=+k.slice(0,c), y=+k.slice(c+1);
    const lim=matTsurv(x,y); if(!lim) continue;
    out.push({id:"mat:"+k, x, y, lim, what:"the containment wall at "+k}); }
  hazCache = out; hazGen = DGEN;
  return out;
}

/* aimed, it refuses silently rather than hitting the nearest thing; unaimed, it picks off srand() so a replay takes the same hits */
function combatHit(id){
  const s=S;
  const canHit = q => fitted(q) && !s.dmgParts.includes(q.id);
  let p;
  if(id!==undefined && id!==null){
    /* a pipe cell is named "pipe:"+x+","+y, never a raw cell key, so ids cannot cross-resolve */
    if(typeof id==="string" && (id.indexOf("pipe:")===0 || id.indexOf("port:")===0 || id.indexOf("mat:")===0)){
      if(s.dmgParts.includes(id)) return;
      p=dmgPart(id);
      if(!p) return;
    } else {
      p=partOf(id);
      if(!p||!canHit(p)) return;
    }
  } else {
    const parts=LAY.parts.filter(canHit);
    /* one target per pipe cell, per port and per painted cell: a longer run is more targets, not a fatter one */
    const runs=pipeCellIds().filter(k=>!s.dmgParts.includes(k)).map(dmgPart).filter(Boolean);
    const ports=portIds().map(pid=>"port:"+pid)
                  .filter(k=>!s.dmgParts.includes(k)).map(dmgPart).filter(Boolean);
    const mats=matIds().filter(k=>!s.dmgParts.includes(k)).map(dmgPart).filter(Boolean);
    const targets=parts.concat(runs,ports,mats);
    if(!targets.length) return;
    /* a cell on the hull edge is worth about ten times an interior one; a part pays the flat rate once */
    const wgt=targets.map(q=>{
      if(q.isRun) return runWgt(q.cells);
      let e=0;
      for(let X=q.x;X<q.x+q.w;X++) for(let Y=q.y;Y<q.y+q.h;Y++)
        if(X===0||X===GW-1||Y===0||Y===GH-1) e++;
      return HITW_BASE + e*HITW_HULL;
    });
    let r=srand(s)*wgt.reduce((a,b)=>a+b,0), k=0;
    while(r>wgt[k] && k<wgt.length-1){ r-=wgt[k]; k++; }
    p=targets[k];
  }
  s.dmgParts.push(p.id);
  s.dmgWhy[p.id] = "HIT";
  const fx=dmgFx(p.id);
  if(fx.hit) fx.hit(s, p.id);
  logE("alarm","COMBAT DAMAGE / "+fx.msg, fx.why+
    (partAccess(p)?" A repair party can reach it.":" IT IS WALLED IN - no repair is possible with this layout."));
}
const repairNeed = p => 14 + p.w*p.h*4;
/* dmgPart() hands back a rectangle for a component and a cell list for a run; radParty() reads either. */
const repairRadRate = (f, id) => radParty(f, dmgPart(id), occupied(null));
function repairStart(id){
  const s=S;
  const p = dmgPart(id);
  /* every refusal is a silent no-op: not there, walled in, already out, spent */
  if(!p || !partAccess(p) || s.repair || s.partySpent) return;
  const need=repairNeed(p);
  s.repair={id:p.id,t:0,need};
  /* seeded here, not next tick: s.repRate still holds the last job's field in this window */
  const f=radSolve(P.radK,radSrc(s));
  s.repRate=repairRadRate(f,p.id);
  const eta=need/radWorkK(s.repRate);
  /* not partName(p): that lives in core/ui.js, which WORKER_SIM excludes, and this runs in the scenario worker too */
  logE("info","REPAIR PARTY DISPATCHED / "+p.name,
    "Estimated "+eta.toFixed(0)+" seconds at "+s.repRate.toFixed(2)+
    "x area dose - "+(s.repRate>RAD_SLOW
      ? "hot enough that the party works in short shifts, which is why this is longer than the "+need+" s the job itself takes."
      : "cool enough to work straight through, so this is the job's own "+need+" s.")+
    " It takes dose the whole time, at the rate of the cell it is standing in.");
}

/* the one writer of s.rodDem from the panel; no id means every vessel takes the order */
function setCommon(v,id){
  coreOn(S,id,(s,K)=>{
    if(s.split && !s.reGang){
      const d=v-s.rodDem;
      let m=0; for(let b=0;b<K.NB;b++){ s.rodZDem[b]=clamp(s.rodZDem[b]+d,0,1); m+=s.rodZDem[b]; }
      s.rodDem=m/K.NB;
    } else s.rodDem=clamp(v,0,1); });
}

function setSplit(on,id){
  let said=false;
  coreOn(S,id,(s,K)=>{
    if(on && !s.split){
      s.rodZDem.set(s.rodZ); s.split=true; s.reGang=false;
      if(!said) logE("warn","BANKS SPLIT",
        "The banks are now driven one at a time and the tilt trim is stood down - per-bank demand is the tilt handle from here. Each bank keeps its own AUTO or MANUAL setting, and the T-avg controller drives only the ones left on AUTO. Fewer banks on AUTO means less worth answering the same temperature error, so the loop gets slower, not just smaller.");
      said=true;
    } else if(!on && s.split && !s.reGang){
      /* seeded once: tracking the mean would have the target chase the banks that are chasing it */
      let m=0; for(let b=0;b<K.NB;b++) m+=s.rodZ[b];
      s.rodPos=s.rodDem=m/K.NB;
      s.reGang=true;
      if(!said) logE("info","BANKS GANGING",
        "The banks are being driven back together at "+(rodRate(K)*100).toFixed(1)+" %/s. They are still split until they arrive, and a scram overrides this at any point.");
      said=true;
    } });
}
/* Share of rated steam per kelvin of programme error - fitted for a scram, where the error is tens of kelvin. */
const DUMP_K=0.02;
const DUMP_COND_K=0.75;   // share of the backpressure trip the dump is permitted up to
/* The bypass is a steam-line pressure regulator; the band is derived to be wide open by the lowest safety valve drawn on this plant. */
let bypBand = 0, bypBandPass = -1;
const sgBypBand = () => { const pn = layPass();
  if(pn && bypBandPass === pn) return bypBand;
  let k=PORV_LIFT_K;
  // a share of the shell design pressure; the setpoints themselves are absolute MPa
  for(const fid of reliefSecIds())
    k = Math.min(k, reliefSet(fid).lift/Math.max(reliefRefP(fid),1e-6));
  const v = Math.max(0.005, k-1);
  if(pn){ bypBand = v; bypBandPass = pn; }
  return v; };
const sgOverFrac = s => { let k=0;
  for(const id of sgIds()) k=Math.max(k, secP(s,id)/sgDesignP(id)-1);
  return k; };
/* one expression, because the commissioning walk has to open the same valve the tick will */
const dumpPOf = s => clamp(sgOverFrac(s)/sgBypBand(),0,1)*P.bypass;
/* The C-9 permissive: a dump into a condenser near its backpressure trip is a dump that trips the turbine. */
const condAvail = s => condP(s) < TURB_TRIP_P*DUMP_COND_K;
const RPS_NEAR=0.03;                        // how close to a setpoint counts as "about to"
/* DNBR 1.0 IS departure (dnbrOf()), so no setpoint may be set under DNBR_ONSET. */
const DNBR_TRIP_K=0.72, DNBR_ONSET=1.02;
/* A channel NAMES the signal it reads (SIGNAL, trends.js); `thr` is in that signal's own unit. The last column is the cabinet tab. */
const RPS_CH=[
  ["flux","HIGH FLUX","FLUX",   +1, "pwr",  (P_,m)=>110+22*m, null, "CORE"],
  /* The PWR setpoint, or a fixed fraction under what THIS plant commissions at, whichever is lower. */
  ["dnbr","LOW DNBR","DNBR",    -1, "dnbr", (P_,m)=>Math.max(DNBR_ONSET,
                                       Math.min(1.18-0.16*m, P_.dnbr0*DNBR_TRIP_K)), null, "CORE"],
  ["php","HIGH PRESSURE","PRESSURE", +1, "prs", (P_,m)=>P_.P0*(1.06+0.07*m), null, "COOLANT"],
  ["tf","HIGH FUEL TEMP","FUEL",+1, "tf",   (P_,m)=>P_.tdmg+100+280*m, null, "CORE"],
  ["flow","LOW FLOW","FLOW",    -1, "flow", P_=>P_.flowMin*102,      s=>s.heat>0.3, "COOLANT"],
  ["plp","LOW PRESSURE","PRESSURE",  -1, "prs", P_=>P_.P0*0.86, null, "COOLANT"],
  ["void","CORE VOID","VOID",   +1, "vd",   (P_,m)=>Math.max(.30,P_.vf0+.20)+.15*m, null, "CORE"],
  /* 3 K absolute, or 3 K below what this plant commissioned subcooled by, whichever is lower */
  ["sub","LOW SUBCOOLING","SUBCOOL", -1, "scc", P_=>Math.min(3,P_.sc0-3), null, "COOLANT"],
  /* The two channels a blackout is actually caught on: the pumps coast slower than the void takes the power away. */
  ["turbt","TURBINE TRIP","TURBINE", +1, "turbtr", ()=>0.5,  s=>s.heat>0.3, "PLANT"],
  ["sglvl","LOW SG LEVEL","LEVEL",   -1, "sglo",   ()=>SG_LOW, null, "PLANT"],
];
const RPS_BY=Object.fromEntries(RPS_CH.map(r=>[r[0],r]));
/* The one door onto a setpoint; `slack` shifts it toward the plant, proportionally. */
const rpsSetOf=(key,slack,K)=>{ const r=RPS_BY[key]; if(!r) return 0;
  K = K || P;
  return r[5](K,K.rpsm)*(1-r[3]*slack); };
/* A bench bag cannot price the two setpoints measured off a settled plant, so those come back null. */
function rpsSetRows(K){
  return RPS_CH.map(([key,name,,dir,sig])=>{
    const v=rpsSetOf(key,0,K||P);
    return {key, name, dir, unit:(SIGNAL[sig]||{}).u||"", val:isFinite(v)?v:null};
  });
}
/* the bench's bag, off the design rather than the last plant commissioned */
const flowMinOf = () => clamp(0.30+0.15*(corePumpCap()-sgCount()),0.15,0.75);
function rpsBenchK(){ const d=derived();
  return {rpsm:D.rpsm, dnbr0:d.dnbr0, P0:d.P0, tdmg:d.f.tdmg, flowMin:flowMinOf()}; }
/* Read through one vessel's own view of the plant (coreSeen). */
function rpsHitCore(slack, s){
  for(const [key,name,word,dir,sig,,gate] of RPS_CH){
    if(gate && !gate(s)) continue;
    const v=sigRead(s,sig), t=rpsSetOf(key,slack);
    if(dir>0 ? v>t : v<t) return {name,word};
  }
  return null;
}
function rpsHit(slack){
  for(const id of coreIds()){ const h=rpsHitCore(slack, coreSeen(S,id)); if(h) return Object.assign(h,{id}); }
  return null;
}
function tripCause(){ const h=rpsHit(0); return h?h.name:""; }
/* The block feeding that vessel's scram - the trip condition BEFORE the latch, which is what a reset is checked against. */
const scramArm = id => { const sink=sinkDriver(S,"scram",id); if(!sink) return null;
  const b=S.blkBy[sink], up=b&&b.in[0]&&S.blkBy[b.in[0]]; return up||null; };
const rpsArmed = id => !!scramArm(id);
/* Null once it actually trips - at that point the latch owns the picture. */
function tripNear(){
  if(S.scrammed) return null;
  for(const id of coreIds()){ const cs=coreState(S,id);
    if(!cs || !cs.rpsNear) continue;
    const a=scramArm(id); if(a && a.out>0.5) return null;   // already made: the trip owns the picture
    const w=blkBlame(S,sinkDriver(S,"nearTrip",id)); if(w) return w; }
  return null;
}

/* Why a reset would be refused right now, or "" if it would clear. */
const resetVeto = ()=>{
  for(const id of coreIds()){ const cs=coreState(S,id);
    if(!cs || !cs.scrammed) continue;
    const a=scramArm(id); if(a && a.out>0.5) return blkBlame(S,sinkDriver(S,"scram",id))||"PROTECTION"; }
  return ""; };
function resetTrip(){
  const s=S;
  if(!s.scrammed) return false;
  const why = resetVeto();
  if(why){
    logE("warn","TRIP RESET REFUSED",
      why+" is still present. The latch will not clear until the condition does.");
    return false;
  }
  coreEach(s,cs=>{ cs.scrammed=false; cs.trip=""; });
  s.scrammed=false; s.trip="";
  logE("info","TRIP RESET",
    "Protection latch cleared by hand. The control bank answers demand again."+
    (rpsLive()?"":" Nothing checked the plant first - protection is "+rpsState().toLowerCase()+"."));
  return true;
}

/* Velocity-form PID, because a rod demand walks rather than jumping: u-dot = Kp*(e-dot + e/Ti + Td*e-dot-dot). */
const AUTOROD_KP=0.96;    // rod fraction per second, per K/s of error rate
const AUTOROD_TI=12;      // s, integral time
/* Three quarters of Ti, not the textbook quarter: this loop's dead time is most of its period. */
const AUTOROD_TD=9;       // s, derivative time
/* A fixed instrument figure, not a plant one, so the lag below does not scale it. */
const AUTOROD_DB=0.8;     // K, dead band on the error
/* s.arDE carries the FILTERED rate, so it is both the filter state and the previous value. */
const AUTOROD_N=8;        // derivative filter, Td/N
const AUTOROD_R0=1.63;                  // K/s, the stock pressurised plant's own figure
const AUTOROD_A0=44;                    // pcm/K, the same plant's whole feedback on tempFb()'s measure
/* How fast this loop's own T-avg answers, K/s at rated - the scale the tune is divided by. */
const tavgRate = () => { const c = satOfCirc(nodeGraph().coreCirc);
  return P.rated*1000/(loopKg()*c.cp); };
const tempFb = () => Math.abs(P.aM+P.aS)+Math.abs(P.pwrDef)/Math.max(P.TfRef-P.Tref,1);
/* Capped: a controller with an unbounded integral time has no integral at all. */
const AUTOROD_LAGMAX=8;
const autorodLag = () => clamp(AUTOROD_R0/tavgRate(), 1, AUTOROD_LAGMAX);
const autorodTune = () => { const lag=autorodLag();
  return {arKp: AUTOROD_KP/lag*Math.min(tempFb()/AUTOROD_A0, 1),
          arTi: AUTOROD_TI*lag, arTd: AUTOROD_TD*lag}; };
// P is null on the bench; commission() copies the same D.rodSpd into P, so the two answers cannot differ
const rodRate = K => (K||P) ? (K||P).rodRate : rodSpdOf(priD());
/* Boration is charging-pump flow; dilution has to displace loop inventory, so it is slower. */
const BOR_IN=60, BOR_OUT=35;            // pcm/s toward more / less boron
const VALVE_RATE=1/17;    // fraction of travel per second: a MOV strokes end to end in ~17 s
/* Suggestions only - a valve's own setpoints are absolute MPa. The gap between the two is the deadband. */
const PORV_LIFT_K=1.06, PORV_RESEAT_K=1.01;
/* The one reader of a relief valve's setpoints; P is null on the bench. */
const reliefLiftSuggest   = fid => reliefRefP(fid)*PORV_LIFT_K;
const reliefReseatSuggest = fid => reliefRefP(fid)*PORV_RESEAT_K;
const reliefSetOf = (j, ref) => ({lift:   j.lift   || ref*PORV_LIFT_K,
                                  reseat: j.reseat || ref*PORV_RESEAT_K});
function reliefSet(fid){
  const f=P?P.fittings:D.fittings;
  return reliefSetOf((f&&f[fid])||{}, reliefRefP(fid));
}
/* the same setpoints off the DRAWING alone, for every design-time reader */
const reliefSetD = fid => reliefSetOf((D.fittings&&D.fittings[fid])||{}, reliefRefPD(fid));
/* Opening rolls the stick; a stuck or hand-opened valve does not shut on an order. Answers whether anything moved. */
function reliefCmd(s,fid,open){
  if(open){ if(s.reliefOpen[fid]) return false;
    s.reliefOpen[fid]=true; s.reliefAuto[fid]=true;
    s.reliefStuck[fid] = s.reliefArm[fid] || roll(s,"porvStick");
    s.reliefArm[fid]=false;
    if(reliefSecIds().includes(fid)) logE("warn",nameOf(fid)+" LIFTED",
      "Shell pressure reached this valve's set point and it is passing steam to atmosphere. The water going with it does not come back.");
    return true; }
  if(!(s.reliefOpen[fid] && s.reliefAuto[fid] && !s.reliefStuck[fid])) return false;
  s.reliefOpen[fid]=false; s.reliefAuto[fid]=false; return true;
}
/* `spring` set = code safety, worked by the tick; unset = PORV, moved only by a wired RELIEF VALVE sink. */
const fitSpringIn = (f,fid) => !!(f && f[fid] && f[fid].spring);
const fitSpring  = fid => fitSpringIn(P?P.fittings:D.fittings, fid);
/* off the DRAWING alone, for a design-time reader: P is the last plant commissioned and may not carry this valve at all */
const fitSpringD = fid => fitSpringIn(D.fittings, fid);
const springStep = (s,fid,pv) => { const set=reliefSet(fid);
  if(pv > set.lift) reliefCmd(s,fid,true); else if(pv < set.reseat) reliefCmd(s,fid,false); };
/* Off the last solved field: its own node on the primary, its shells on the secondary. */
const reliefP = (s,fid) => { if(reliefSecIds().includes(fid)) return reliefAtP(s,fid);
  const n = P && P.net ? reliefNodeOf(P.net,fid) : null; return n===null ? s.P : netPAt(s,n); };
/* Run-up is a first-order walk at FLOW_TAU; the coast is not - a free rotor's hydraulic torque goes as N^2, so speed falls as 1/(1+t/tau_c). */
const FLOW_TAU=5;      // seconds; PUMP_ROTOR_S is beside pumpRotor() in layout.js
/* Bearings and windage are linear in N and do not vanish with the flow, so the shaft actually stops. */
const PUMP_FRIC_S=60;
/* A kilogram of steam costs the FEED-TO-STEAM RISE, not the latent heat, at the shell's own pressure. */
const riseSg = (id,p) => riseOfCirc(shellCirc(id), p);
/* The feed nozzle is at T_FEED because part of the shell's own steam was bled off to put it there: it does no shaft work and never reaches the condenser. */
const feedNode = id => coreFold(id + roleIntern(ROLE.sg)[1].a);
/* priced off the water ARRIVING, never off the nozzle itself: a well-mixed node reads the outlet, and a source that chases its own outlet settles halfway. */
const feedInH = (s,id) => { const h = feedInHBy[feedNode(id)];
  if(h !== undefined) return h;
  /* no transport pass yet: the feedwater comes off the hotwell, so that is where it starts */
  return hOfT(satOfCirc(shellCirc(id)), s.condT !== undefined ? s.condT : T_FEED); };
/* refilled by advectStep off the same donor pass the enthalpy integral uses, and empty until one has run */
const feedInHBy = {};
/* off what the HEATERS pass, which is the condensate flow and not the post-valve feed: the heater train stands between the condenser and the feed pump, upstream of the regulating valve, so a valve movement is not its duty. Read at the shell's own nozzle instead, the bleed collapses whenever the feed dips, the turbine takes the whole raised steam and the plant over-produces by exactly bleedFrac. */
const feedHeatKW = (s,id) => Math.max(0, s.steamBy[id]||0)
  * Math.max(0, hOfT(satOfCirc(shellCirc(id)), T_FEED) - feedInH(s,id));
/* an open heater: b kg of steam at h_g plus the rest of the condensate at h_in leave together at T_FEED, so a bleed kilogram gives up h_g - h_in and not h_g - h_fw */
const feedBleedKgs = (s,id) => feedHeatKW(s,id)
  / Math.max(satHg(satOfCirc(shellCirc(id)), secP(s,id)) - feedInH(s,id), 1);
/* what a kilogram down the nozzle hands the CONDENSER: it leaves there as condensate at the hotwell's own enthalpy, and the heaters put the rest of the way back to T_FEED in themselves. */
const riseCond = (s,id,p) => Math.max(1, satHg(satOfCirc(shellCirc(id)), p) - feedInH(s,id));
const bleedOf = (s,id) => Math.min(feedBleedKgs(s,id), Math.max(0, s.steamBy[id]||0));
const bleedPlant = s => { let k=0; for(const id of sgIds()) k += bleedOf(s,id); return k; };
const SGL_SET=50;         // %, the level the feed controller holds
/* what is left of the shell's heat capacity once its water is counted separately */
const CP_STEEL=0.5;       // kJ/kg/K
/* There is no invisible lid: nothing fitted to take the steam means the shell takes it, and bursts here. Latched. */
const SG_BURST_K=1.5;
/* Where the warning and the red start, as a fraction of design-to-burst - the shell has no set point to quote. */
const SG_P_WARN=0.15, SG_P_HI=0.6;
/* Multiples of rated steam a full-bore relief passes at its lift point, times the hole's bore squared. */
const SG_RELIEF_CAP=3.0;
/* Dittus-Boelter: the tube-side film goes as flow^0.8. Physical, not fitted. */
const UA_FLOW=0.8;
/* Multiples of this machine's own rated feed per unit of fractional level error - a feed system is paced by the feed it was bought to pass. */
const FEED_LVL_K=2.3;
/* FREG_STROKE is seconds for a full stroke; FREG_SPAN floors the relative error's denominator. */
const FREG_STROKE=4, FREG_SPAN=10;
/* kg/s: the steam it is sending away plus the level error through the programme's gain. */
const feedWant = (s,id) => Math.max(0, (s.steamBy[id]||0)
      + (SGL_SET-sgLvl(s,id))/100*FEED_LVL_K*ratedSteam()/Math.max(1,sgCount()));
/* Below this the tubes are uncovered and the generator stops being a heat sink. */
const SG_DRY=25;          // %
/* The second step of the same ladder: most of the bundle in steam, and it reads red. */
const SG_DRY_LO=10;       // %
/* Above SG_DRY, so the warning comes before the automatic action rather than with it. */
const SG_LOW=35;          // %
/* A feed train runs to a LEVEL: stopping at the start setpoint parks the plant on its own threshold. */
const SG_EFW_OFF=40;      // %
/* % of that tank per second: fast enough to stay ahead of a tube rupture, slow enough that opening it is a decision. */
const HOT_DUMP=1.6;
/* Kilograms of secondary water at 100 % level in ONE generator. */
/* kg the shell holds full: its stated VOLUME weighed at the water density its own design pressure implies. `water` is m³, which is what `partVol()` and `sgShellT()` already read it as; only the mass readers took it for tonnes. */
const sgMassOf=id=>{ const ci=shellCirc(id);
  return sgRowOf(id).water*rhofOf(satOfCirc(ci), tsatSec(sgDesignP(id), ci)); };
/* Rated steam for the WHOLE plant, kg/s. */
/* the drawing's own rating where there is no commissioned plant: a design-time bore read asks this before P exists */
const ratedSteam=()=>((P && P.rated) ? P.rated*1000 : RATED_KW())/steamRise();
/* 100 % on a steam line: one generator's worth for its own run, the whole plant's for the exhaust. */
const steamScale=(key,k)=>k==="exh" ? ratedSteam()
  : ratedSteam()*Math.max(1,steamFeeders(key,k).length)/Math.max(1,sgCount());
/* A run's key names its ends in a canonical order that is NOT the flow order; +1 means the steam runs the way the key reads. */
const isSink = id => { const p=partOf(id);
  return !!p && ROLE[p.role] && ROLE[p.role].thermal==="sink"; };
/* Asked structurally, because a header run has a generator at neither end: cut it and see which side still reaches a machine that swallows steam. */
const swallowsSteam = pid => { const p=partOf(pid);
  return !!p && (p.role==="turb" || isSink(pid)); };
function steamSide(node, cut){
  const G=nodeGraph(), seen=G.reach((G.adj[node]||[]).filter(v=>!cut[v]), cut);
  return LAY.parts.some(p=>swallowsSteam(p.id) && (G.nodesOf[p.id]||[]).some(n=>seen[n]));
}
function steamDir(key,k){
  const ends = runEnds(key,k); if(!ends) return 1;
  const pid = n => n.slice(0,-1);
  if(k==="exh") return isSink(pid(ends[1])) ? 1 : -1;
  // a run ON a generator leaves it, whichever end the key happens to sort first
  if(S && S.steamBy){
    if(S.steamBy[pid(ends[0])]!==undefined) return 1;
    if(S.steamBy[pid(ends[1])]!==undefined) return -1;
  }
  /* a tap discharges into its dead end, and the reach test below would say the opposite */
  const de = runDeadEnd(pid(ends[0]), pid(ends[1]));
  if(de) return de.id===pid(ends[1]) ? 1 : -1;
  const cut={}; cut[ends[0]]=1; cut[ends[1]]=1;
  if(steamSide(ends[1],cut)) return 1;
  if(steamSide(ends[0],cut)) return -1;
  return 1;
}
/* whose steam passes this run: cut it, and the generators still reachable upstream. A dead-ended branch books its own shell's vent instead. Memoised on the graph window */
function steamBook(key,k){
  const slot=graphSlot("steamFeed"), was=slot.get(key); if(was) return was;
  const ends=runEnds(key,k), pid=n=>n.slice(0,-1);
  let out;
  if(k==="exh" || !ends) out={gens:sgIds(), taps:reliefSecIds(), vent:false};
  else {
    const de = runDeadEnd(pid(ends[0]), pid(ends[1]));
    if(de) out = {gens:shellsOf(de.id), taps:[de.id], vent:true};
    else {
      /* Vapour runs only, fittings transparent, stopping at a generator: nodeGraph()'s reach() would arrive at every shell from anywhere. */
      const adj={}, add=(a,b)=>{ (adj[a]||(adj[a]=[])).push(b);
                                 (adj[b]||(adj[b]=[])).push(a); };
      const up = steamDir(key,k)>0 ? ends[0] : ends[1];
      const byPart={}, note=n=>(byPart[pid(n)]||(byPart[pid(n)]=[])).push(n);
      note(up);
      for(const r of pipeNetwork()){
        if(edgeLaw(r) !== LAW_VAPOUR || r.key===key) continue;
        const e=runEnds(r.key,r.k); if(!e) continue;
        add(e[0],e[1]); note(e[0]); note(e[1]);
      }
      for(const p in byPart) if(isFitting(p))
        for(let i=1;i<byPart[p].length;i++) add(byPart[p][0],byPart[p][i]);
      const seen={}, st=[up]; seen[up]=1;
      while(st.length){ const n=st.pop();
        if(pid(n)!==pid(up) && sgIds().indexOf(pid(n))>=0) continue;   // a generator is a terminus
        for(const m of (adj[n]||[])) if(!seen[m]){ seen[m]=1; st.push(m); } }
      const on = id => Object.keys(seen).some(n=>pid(n)===id);
      const gens = sgIds().filter(on);
      out = {gens: gens.length ? gens : (sgIds().indexOf(pid(up))>=0 ? [pid(up)] : []),
             /* the valves upstream that have already taken their share */
             taps: reliefSecIds().filter(on), vent:false};
    }
  }
  slot.set(key,out); return out;
}
const steamFeeders=(key,k)=>steamBook(key,k).gens;

const sgLiftP=fid=>fid===undefined ? sgDesignP()*PORV_LIFT_K : reliefSet(fid).lift;
const sgBurstP=id=>sgDesignP(id)*SG_BURST_K;
/* Burst or wrecked: the one predicate, so the pressure, the fixed map, the store row and the balance agree. */
const sgOpen=(s,id)=>!!(s && ((s.sgBurst && s.sgBurst[id]) || partWrecked(s,id)));
/* P.invKg0 off the drawing where there is one; the correlation is what a bench design with no nodes is worth. */
const loopKg=()=>(P && P.invKg0 > 0) ? P.invKg0
                : P.rated*1000/(P.sat.cp*coreDT0())*LOOP_TRANSIT;
/* The core piece, less every node another book owns (netBooked), or it is counted twice. */
function invNodesKg(s, cid){
  const net = P && P.net;
  if(!net || !net.name || !s.mBy) return 0;
  const booked = netBooked(net), c = corePiece(net, s, cid), of = netPieces(net, s).of;
  let m = 0;
  for(let i=0;i<net.n;i++) if(!booked[i] && of[i] === c) m += s.mBy[net.name[i]] || 0;
  return m;
}
/* Every unbooked node's mass, written off the field as finally settled; booked nodes keep their own book's answer. */
function massSeed(s){
  const net = P && P.net;
  if(!net || !net.name || !s.mBy) return;
  /* Off the PINNED field, or the seed is circular: a store's pressure is a function of the mass this pass is about to write. */
  netHoldStore(true);
  try { netReadP(netSolve(net, s), s.pBy); }
  finally { netHoldStore(false); }
  const booked = netBooked(net);
  for(let i=0;i<net.n;i++){ if(booked[i]) continue;
    const nm = net.name[i];
    /* a charged vessel is only as full as it was commissioned: the rest of its volume is the gas, which is a compliance and never water in the field */
    const tid = net.tankIdByNode && net.tankIdByNode[i];
    /* a hotwell is only as full as the ship states, and it is a POOL: the water it holds is liquid against its own volume, never the EOS read at a saturated node */
    if(poolSet().has(nm)){ const c = netSatOf(nm);
      s.mBy[nm] = condFill0()/100*net.vol[i]*rhofOf(c, satT(c, netPAt(s, nm))); continue; }
    const fill = (tid !== undefined && tankStores(tid)) ? clamp(D.tanks[tid].level,0,100)/100 : 1;
    s.mBy[nm] = fill*net.vol[i]*netRhoAt(s, nm); }
  /* A stub behind a shut gate seeds at its boundary's state: walked from every boundary over the edges that conduct. A walk that reaches the plant is left alone. */
  const cOf = ed => typeof ed.C === "function" ? ed.C(s) : ed.C;
  const adj = new Array(net.n);
  for(const ed of net.edges){ if(!(cOf(ed) > 0)) continue;
    (adj[ed.u] || (adj[ed.u] = [])).push(ed.v); (adj[ed.v] || (adj[ed.v] = [])).push(ed.u); }
  const seeds = new Set((net.cont || []).concat(net.cav || []));   // a reactor cavity starts at room pressure
  for(const id in net.tankNode) if(!net.tankField[id] && tankP(s,id) <= P.Pcont*1.001) seeds.add(net.tankNode[id]);
  const cores = new Set(); for(const id of coreIds()) cores.add(net.index[coreFold(id)]);
  const holds = holdNodeSet();
  const seen = new Uint8Array(net.n);
  for(const s0 of seeds){ if(seen[s0]) continue;
    const region = [], stack = [s0]; seen[s0] = 1; let plant = false;
    while(stack.length){ const i = stack.pop();
      if(cores.has(i) || holds.has(net.name[i]) || (booked[i] === 1 && net.tankIdByNode[i] === undefined)) plant = true;
      if(!booked[i]) region.push(i);
      const a = adj[i]; if(a) for(const v of a) if(!seen[v]){ seen[v] = 1; stack.push(v); } }
    if(plant) continue;
    for(const i of region){ const nm = net.name[i], c = netSatOf(nm), h = satHg(c, P.Pcont);
      s.hBy[nm] = h; s.mBy[nm] = net.vol[i]*rhoMixOf(c, P.Pcont, h); s.pBy[nm] = P.Pcont; }
  }
}
/* kW into one vessel's node, one tick old - the solve has to run before there are flows to carry it. */
const coreHeatKW = id => (HEATBAL.heatBy[id]||0)*P.cores[id].rated*1000;
function advectSrc(s, dt){
  const src = {};
  /* A machine hands its heat to the water that is there: every term fades with the node's own wetness. */
  const net = P.net, wetBy = {};
  const wetOf = nid => { if(wetBy[nid] !== undefined) return wetBy[nid];
    const i = net ? net.index[nid] : undefined;
    let w = 1;
    if(i !== undefined && s.mBy && s.mBy[nid] !== undefined){
      const eos = net.vol[i]*netRhoAt(s, nid);
      if(eos > 0) w = Math.max(0, Math.min(1, s.mBy[nid]/eos)); }
    return (wetBy[nid] = w); };
  const add = (nid, q) => { if(q) src[nid] = (src[nid]||0) + q*wetOf(nid); };
  for(const id of coreIds()){ add(coreFold(id), coreHeatKW(id)); add(coreFold(id), -skinQOf(s,id));
    // what fuel out of its pin handed the water last tick (coreStep's o.fci)
    add(coreFold(id), (s.coreBy && s.coreBy[id] && s.coreBy[id].fci) || 0); }
  /* ROLE's declaration ORDER says which stream gives the heat up (0) and which takes it (1); neither names a face. */
  for(const id of sgIds().concat(ihxIds())){
    const q = HEATBAL.sgQBy[id] || (s.ihxQBy && s.ihxQBy[id]) || 0;
    const R = ROLE[partOf(id).role], INs = roleIntern(R);
    for(let k=0;k<INs.length;k++){ const IN=INs[k];
      /* a shell is ONE vessel: all of what crosses its tubes lands on it, and half on the feed nozzle would only heat the feedwater */
      if(k && R.sgtr){ add(shellNode(id), q + ((s.sgSwQBy && s.sgSwQBy[id])||0) - skinQOf(s,id)); continue; }
      const v=(k?q:-q)/2;
      add(id+IN.a, v); add(id+IN.b, v); }
  }
  /* The bleed heaters land on the feed nozzle, which is why the water arrives at T_FEED at all. */
  for(const id of sgIds()) add(feedNode(id), feedHeatKW(s,id));
  /* the tubes take the latent heat out where the WATER is: a steam space at the vacuum holds a few kilograms and a gigawatt through it is not an integrator.
     The wheels come out here too - no edge on the graph takes shaft work out of the stream, so what the turbine made never reaches the exhaust. */
  { const ids = condIds();
    /* the wheels and the heaters both, because no edge on the graph takes either out of the stream: what the turbine made and what the bleed put back into the feedwater never reach the exhaust */
    let out = mwE(s)*1000;
    for(const id of sgIds()) out += feedHeatKW(s,id);
    out /= Math.max(1, ids.length);
    for(const id of ids) add(condVesNode(id), -condRejOf(s,id) - skinQOf(s,id) - out); }
  /* A sodium-water reaction happens in the SODIUM, so it lands on the primary faces; the shell's side is a current into its storage row. */
  for(const id in s.sgPwQBy){ const q = s.sgPwQBy[id]; if(!q) continue;
    const IN = roleIns(partOf(id))[0];
    add(id+IN.a, q/2); add(id+IN.b, q/2); }
  /* A condenser gives its rejection to the water on its other side - the path that declares no anchor. */
  { for(const id of condIds()){ const q = condRejOf(s,id);
      for(const w of cwPathsOf(id)){ add(coreFold(id+w.a), q/2); add(coreFold(id+w.b), q/2); } } }
  /* A panel takes heat out of whatever is running through it, wherever that is. */
  { const IN = ROLE.radiator.internal;
    for(const id of radIds()){ const q = (s.radQBy && s.radQBy[id]) || 0;
      add(coreFold(id+IN.a), -q/2); add(coreFold(id+IN.b), -q/2); } }
  /* Heaters and spray, in kW at the vessel's own node: a pressurizer earns its pressure by boiling and condensing its own water. */
  for(const id of holdTankIds()) add(coreFold(id), pzrQ(s, id));
  /* The steel round each node is a store of its own; metalQ is the one figure both sides read. */
  for(const k in metalQ) delete metalQ[k];
  if(net && net.metalKg && s.metalT){
    for(let i=0;i<net.n;i++){ const m = net.metalKg[i]; if(!(m > 0)) continue;
      const nm = net.name[i], T = netTempAt(s, nm);
      /* The settle is not a time march, so through it the wall simply IS at its water. */
      if(s.metalT[nm] === undefined || !isFinite(s.metalT[nm]) || netStoreHeld) s.metalT[nm] = T;
      const ua = net.metalUA ? net.metalUA[i] : 0;
      const q0 = m*CP_STEEL*(s.metalT[nm] - T)/(net.metalTau[i] + (ua > 0 ? m*CP_STEEL/ua : 0));
      /* A wall may not drive the water past itself: a node whose steel outweighs its water is an unstable explicit source. */
      const mf = (s.mBy && s.mBy[nm]) || 0;
      const cap = dt > 0 ? mf*Math.abs(hOfT(netSatOf(nm), s.metalT[nm]) - netHAt(s, nm))/dt : Infinity;
      const q = q0 > 0 ? Math.min(q0, cap) : Math.max(q0, -cap);
      // not scaled by wetness: the cap is already the node's own mass, and s.metalT reads metalQ back
      metalQ[nm] = q; src[nm] = (src[nm]||0) + q; } }
  return src;
}
const metalQ = {};
/* `hold` is pinned every tick, `seed` only fills an empty field (a superset of hold), and `holdH` pins an ENTHALPY - a temperature cannot say "vapour" on the saturation shelf. */
function advectAnchors(s){
  const hold = {}, seed = {}, holdH = {};
  const at = (m, pid, faces, T) => { if(T === undefined || !isFinite(T)) return;
    for(const f of faces){ const n = coreFold(pid+f);
      if(P.net.index[n] !== undefined) m[n] = T; } };
  const FACES = ["t","r","b","l"];
  /* the shell is a vessel now: SEEDED at saturation and held at nothing, or its level is pinned wherever the seed left it */
  for(const id of sgIds()){
    const IN = roleIntern(ROLE.sg)[1];
    for(const f of [IN.a, IN.b]){ const n = coreFold(id+f);
      if(P.net.index[n] !== undefined) seed[n] = s.sgTBy[id]; }
    /* the settle is not a time march, so through it the heaters simply ARE at their duty; the tick holds nothing and the source has to earn T_FEED on its own */
    if(netStoreHeld){ const n = coreFold(id+IN.a);
      if(P.net.index[n] !== undefined) hold[n] = T_FEED; }
  }
  /* A sink is a vessel now: SEEDED at its own temperature and held at nothing, or its pool's level is pinned wherever the seed left it. */
  for(const p of LAY.parts){ const R=ROLE[p.role];
    if(!R || R.thermal !== "sink") continue;
    const T = partTemp(s,p); if(T === undefined || !isFinite(T)) continue;
    at(seed, p.id, FACES, T);
  }
  /* CONTENTS is the commissioning charge and nothing more: seeded at its FLUID's temperature, then left to the transport like any other vessel. */
  for(const id of tankIds()){ if(D.tanks[id].hold) continue;
    at(seed, id, FACES, tankFluid(id).temp); }
  return {hold, seed, holdH};
}
// seconds of lag on s.dTavg, the rate every pressure and controller term reads
const TAVG_RATE_TAU = 0.5;
/* What a booked node holds, kg; undefined means "no book here", which is every ordinary node. */
function bookedKg(net, s, i){
  /* A book with no entry yet is not a book saying zero - undefined falls through to the node's own state point. */
  const id = net.tankIdByNode && net.tankIdByNode[i];
  if(id !== undefined) return net.tankField[id] ? undefined
                            : tankLvl(s,id)/100*tankKg(id);
  return undefined;
}
let advectClamped = 0;
const advectClampCount = () => advectClamped;
// sweeps of the donor limiter; it stops early when a pass changes nothing, so this is only the cap on a cascade
const COURANT_PASSES = 8;
/* kg through every hole this tick, off the same LIMITED flows the mass integral rides. */
let advectOutPri = 0, advectOutSec = 0;
let advectEdgeKg = null, advectLandedBy = null;
// kg the transport landed on a booked node this tick (negative: took off it); 0 with no solve
const advectLanded = i => (advectLandedBy && i !== undefined) ? advectLandedBy[i] : 0;
const holdNodeSet = () => new Set(holdTankIds().map(coreFold));
const poolSet = () => new Set(condSinks().map(condVesNode));
/* The runs landing on a hold tank: they hold what it holds, so they sit at saturation and the subcooling instrument must skip them. */
function holdLineSet(){
  const slot = graphSlot("holdLine"), was = slot.get(1); if(was) return was;
  const set = holdNodeSet(), out = new Set(set);
  for(const r of pipeNetwork()){ const e = runEnds(r.key, r.k); if(!e) continue;
    if(set.has(coreFold(e[0])) || set.has(coreFold(e[1]))) out.add(runNodeOf(r.key)); }
  slot.set(1, out); return out;
}
function advectStep(s, dt, runFlow, edgeKg){
  const net = P && P.net;
  advectEdgeKg = advectLandedBy = null;
  if(!net || !net.name || !s.hBy || !s.mBy){ for(const k in feedInHBy) delete feedInHBy[k]; return; }
  const h = s.hBy, mBy = s.mBy;
  // refilled, never rebuilt; a key can only go stale when the net or the field object is replaced
  if(net.advKeysH !== h || net.advKeysM !== mBy){
    for(const k in h) if(net.index[k] === undefined) delete h[k];
    for(const k in mBy) if(net.index[k] === undefined) delete mBy[k];
    net.advKeysH = h; net.advKeysM = mBy; }

  const src = advectSrc(s, dt), A = advectAnchors(s);
  for(const k in h2Take) delete h2Take[k];
  const anch = Object.assign({}, A.hold);
  for(const nm in A.holdH) anch[nm] = A.holdH[nm];   // the SKIP set is both maps
  const G = nodeGraph();
  /* A node seeds at the NEAREST anchoring machine's temperature, walked over the runs; only when a node is missing, so a running plant pays nothing. */
  { let need = false;
    for(let i=0;i<net.n && !need;i++) if(h[net.name[i]] === undefined) need = true;
    if(need){
      const T = new Array(net.n), q = [], adj = {};
      for(const nm in A.seed){ const i = net.index[nm];
        if(i !== undefined && T[i] === undefined){ T[i] = A.seed[nm]; q.push(i); } }
      for(const ed of net.edges){ (adj[ed.u]||(adj[ed.u]=[])).push(ed.v);
                                  (adj[ed.v]||(adj[ed.v]=[])).push(ed.u); }
      for(let qi=0;qi<q.length;qi++){ const u = q[qi];
        for(const v of (adj[u]||[])) if(T[v] === undefined){ T[v] = T[u]; q.push(v); } }
      for(let i=0;i<net.n;i++){ const nm = net.name[i];
        if(h[nm] !== undefined) continue;
        const c = circOfNode(nm);
        /* The walk carries a TEMPERATURE, which on the shelf is saturated liquid - so a steam space seeds off net.vapour and a pressurizer with its bubble in it. */
        const hold = holdTankIds().find(id => coreFold(id) === nm);
        /* a shell is a vessel with a bubble in it, seeded exactly as a pressurizer is: the level is a void fraction */
        const shell = sgIds().find(id => shellNode(id) === nm);
        /* a charged vessel seeds at what was put in it, on the core's circuit as much as anywhere: the loop's mean temperature is not the contents of a tank standing beside it */
        const tid = net.tankIdByNode && net.tankIdByNode[i];
        h[nm] = hold ? holdSeedH(tankCircuit(hold), holdSetP(tankCircuit(hold)), tankLvl(s,hold))
          : shell ? holdSeedH(shellCirc(shell), secPTarget(s,shell), SGL_SET/SG_DOME)
          : tid !== undefined ? hOfT(satOfCirc(c), tankFluid(tid).temp)
          : (net.vapour && net.vapour[i])
          ? satHg(satOfCirc(c), netPAt(s,nm))
          : hOfT(satOfCirc(c), (c !== G.coreCirc && T[i] !== undefined) ? T[i] : s.Tavg); } } }

  // held BEFORE the sweep as well as after, so a donor carries its pot's own state rather than last tick's
  for(const nm in A.hold) h[nm] = hOfT(satOfCirc(circOfNode(nm)), A.hold[nm]);
  for(const nm in A.holdH) h[nm] = A.holdH[nm];
  /* Boron seeds on the core's circuit only; a tank's node is pinned at its FLUID's own concentration every tick. Hydrogen starts at zero. */
  const b = s.bBy, cH = s.h2By;
  if(b && cH){
    if(net.advKeysB !== b){ for(const k in b) if(net.index[k] === undefined) delete b[k];
      for(const k in cH) if(net.index[k] === undefined) delete cH[k]; net.advKeysB = b; }
    for(let i=0;i<net.n;i++){ const nm = net.name[i];
      const tid = net.tankIdByNode && net.tankIdByNode[i];
      if(tid !== undefined && !D.tanks[tid].hold)
        b[nm] = (s.boron0||0) - 100*(tankFluid(tid).boron||0);
      else if(b[nm] === undefined) b[nm] = netInCore(nm) ? (s.boron||0) : 0;
      if(cH[nm] === undefined) cH[nm] = 0; } }
  const mOut = scratch(net, "mOut", net.n, Float64Array, 0), mIn = scratch(net, "mIn", net.n, Float64Array, 0);
  const inH = scratch(net, "inH", net.n, Float64Array, 0), inM = scratch(net, "inM", net.n, Float64Array, 0);
  const inB = scratch(net, "inB", net.n, Float64Array, 0), inC = scratch(net, "inC", net.n, Float64Array, 0);
  const kgs = netKgs;
  /* edgeKg is signed per EDGE; runFlow keyed by RUN is only the fallback for a caller with no solve to hand. */
  const eFrom = scratch(net, "eFrom", net.edges.length, Int32Array, -1), eM = scratch(net, "eM", net.edges.length, Float64Array, 0);
  const bkd = netBooked(net);
  for(let e=0;e<net.edges.length;e++){
    const ed = net.edges[e];
    const q = edgeKg ? edgeKg[e] : runFlow[ed.key];
    if(!q) continue;
    const m = kgs(q); if(!(m > 1e-9)) continue;
    const from = q > 0 ? ed.u : ed.v;
    /* Containment never donates: it has no book and no bottom, and the solve's donor is last tick's field. */
    if(bkd[from] === 2) continue;
    eFrom[e] = from; eM[e] = m;
  }
  /* a node may not give more than it has plus what arrives in the same tick; swept, because an inflow is somebody else's throttled outflow. Neither limiter runs during a settle */
  if(!netStoreHeld){ const bk = netBooked(net);
    for(let pass=0; pass<COURANT_PASSES; pass++){
      mOut.fill(0); mIn.fill(0);
      for(let e=0;e<net.edges.length;e++){ const from = eFrom[e]; if(from < 0) continue;
        const ed = net.edges[e];
        mOut[from] += eM[e]; mIn[from === ed.u ? ed.v : ed.u] += eM[e]; }
      const kOut = scratch(net, "kOut", net.n, Float64Array, 1);
      let bit = false;
      for(let i=0;i<net.n;i++){ const o = mOut[i]*dt;
        if(!(o > 0) || (bk[i] && !(net.tankIdByNode && net.tankIdByNode[i] !== undefined))) continue;
        const have = mBy[net.name[i]];
        if(have === undefined) continue;
        const cap = have + mIn[i]*dt;
        if(o > cap){ kOut[i] = Math.max(cap, 0)/o; bit = true; } }
      if(!bit) break;
      for(let e=0;e<net.edges.length;e++){ const from = eFrom[e]; if(from < 0) continue;
        const k = kOut[from]; if(k !== 1) eM[e] *= k; } } }
  /* And it may not take more than its own state weighs at the highest pressure next to it; the excess is simply not carried, so it stays in the donor. */
  const kIn = scratch(net, "kIn", net.n, Float64Array, 1);
  if(!netStoreHeld){ const bk = netBooked(net), pMax = scratch(net, "pMax", net.n, Float64Array, 0),
        pNow = scratch(net, "pNow", net.n, Float64Array, 0);
    // the donor's own pressure, off the raw read rather than off pMax, which the loop below raises as it goes
    for(let i=0;i<net.n;i++) pMax[i] = pNow[i] = netPAt(s, net.name[i]);
    for(let e=0;e<net.edges.length;e++){ const from = eFrom[e]; if(from < 0) continue;
      const ed = net.edges[e], to = from === ed.u ? ed.v : ed.u;
      const pf = pNow[from]; if(pf > pMax[to]) pMax[to] = pf; }
    const inRaw = scratch(net, "inRaw", net.n, Float64Array, 0), outNow = scratch(net, "outNow", net.n, Float64Array, 0);
    for(let e=0;e<net.edges.length;e++){ const from = eFrom[e]; if(from < 0) continue;
      const ed = net.edges[e]; outNow[from] += eM[e];
      inRaw[from === ed.u ? ed.v : ed.u] += eM[e]; }
    for(let i=0;i<net.n;i++){ const ir = inRaw[i]*dt;
      if(!(ir > 0) || bk[i]) continue;
      const nm = net.name[i], have = mBy[nm];
      if(have === undefined || !(net.vol[i] > 0)) continue;
      const cap = net.vol[i]*rhoMixOf(netSatOf(nm), pMax[i], netHAt(s, nm));
      const room = cap - have + outNow[i]*dt;
      if(ir > room) kIn[i] = Math.max(room, 0)/ir; } }
  for(let e=0;e<net.edges.length;e++){
    const from = eFrom[e]; if(from < 0) continue;
    const ed = net.edges[e], to = from === ed.u ? ed.v : ed.u;
    const k = kIn[to]; if(k !== 1) eM[e] *= k;
    const m = eM[e], fn = net.name[from];
    // a steam nozzle hands over the VAPOUR: its enthalpy, and the gas the node is carrying
    const gas = ed.gasAt === from && net.F.x[from] > 0;
    const hd = gas ? satHg(netSatOf(fn), net.F.p[from]) : h[fn];
    inH[to] += m*hd;
    inM[to] += m;
    // what the steam took over this node's own mean, charged back to it
    if(gas) src[fn] = (src[fn]||0) - m*(hd - h[fn]);
    if(b){ inB[to] += m*b[fn];
      let cIn = m*cH[fn];
      if(gas && cH[fn] > 0){
        const m0 = mBy[fn] || 0, have = cH[fn]*m0, mine = cH[fn]*m*dt;
        // all of it is in the vapour, and a node may not hand over more than it holds
        const extra = Math.min(mine*(1/net.F.x[from] - 1),
                               Math.max(0, have - mine - (h2Take[fn]||0)*m0));
        cIn += extra/dt;
        if(m0 > 0) h2Take[fn] = (h2Take[fn]||0) + extra/m0;
      }
      inC[to] += cIn; }
  }
  for(const k in feedInHBy) delete feedInHBy[k];
  for(const id of sgIds()){ const nm = feedNode(id), i = net.index[nm];
    if(i !== undefined && inM[i] > 0) feedInHBy[nm] = inH[i]/inM[i]; }
  mOut.fill(0);
  for(let e=0;e<net.edges.length;e++) if(eFrom[e] >= 0) mOut[eFrom[e]] += eM[e];
  /* advectEdgeKg is signed u->v per edge; advectLandedBy is kg that arrived on a booked node from outside its own book, negative for what left. Charged off the same eM[] the mass integral uses, never off the solve's rate */
  const bookOf = netBookOf(net);
  advectEdgeKg = scratch(net, "advEdgeKg", net.edges.length, Float64Array, 0);
  advectLandedBy = scratch(net, "advLanded", net.n, Float64Array, 0);
  for(let e=0;e<net.edges.length;e++){ const from = eFrom[e]; if(from < 0) continue;
    const ed = net.edges[e], to = from === ed.u ? ed.v : ed.u, m = eM[e]*dt;
    advectEdgeKg[e] = from === ed.u ? m : -m;
    if(bookOf[to] === bookOf[from]) continue;
    if(bookOf[to]) advectLandedBy[to] += m;
    if(bookOf[from]) advectLandedBy[from] -= m; }
  advectOutPri = advectOutSec = 0;
  for(const k in advectH2Out) delete advectH2Out[k];
  for(const k in advectOutKg) delete advectOutKg[k];
  for(let e=0;e<net.edges.length;e++){ const ed = net.edges[e], m = advectEdgeKg[e];
    if(!(m > 0)) continue;
    // hydrogen leaves through the hole it is AT, at that node's own concentration - a torn pipe passes what is in it, mixed
    if(cH && (ed.kind === "break" || ed.kind === "vent") && cH[net.name[ed.u]] > 0)
      advectH2Out[ed.key] = (advectH2Out[ed.key]||0) + cH[net.name[ed.u]]*m;
    // ...and so does the fluid, off the same booking
    if(ed.kind === "break" || ed.kind === "vent")
      advectOutKg[ed.key] = (advectOutKg[ed.key]||0) + m;
    if(ed.kind !== "break" || ed.steam) continue;
    if(ed.sec) advectOutSec += m; else advectOutPri += m; }
  /* The Courant blend dt/tau, clamped at 1: a node too small for its flow equilibrates with its inlet in one tick. */
  advectClamped = 0;
  // a pressurizer's bubble is a seeded fact: at a rest point the surge flow is zero, and the settle would collapse it
  const keep = netStoreHeld ? holdNodeSet() : null;
  for(let i=0;i<net.n;i++){
    const nm0 = net.name[i], q = netStoreHeld ? 0 : (src[nm0] || 0);
    if((!(inM[i] > 1e-9) && !q) || anch[nm0] !== undefined || (keep && keep.has(nm0))) continue;
    const mass = Math.max(mBy[nm0] !== undefined ? mBy[nm0]
                                                 : net.vol[i]*netRhoAt(s, nm0),
                          DRY_MIN_KG);
    /* A machine's duty is a fact about the machine, not about this tick's flow: a light steam path meters through in pulses (the Courant limiter), and a source dropped on the empty ticks is half a condenser. A settle pass is not a march, so it takes no q*dt. */
    if(!(inM[i] > 1e-9)){ h[nm0] += q*dt/mass; continue; }
    /* A settle pass relaxes every node alike: it is a steady-state sweep, not a march. */
    let f = netStoreHeld ? SETTLE_RELAX : inM[i]*dt/mass;
    if(f >= 1){ f = 1; advectClamped++; }
    const nm = nm0;
    /* The control volume's steady state written down directly, so a machine's heat lands AT the machine. */
    const target = (inH[i] + (src[nm]||0))/inM[i];
    h[nm] += f*(target - h[nm]);
    if(b){ b[nm] += f*(inB[i]/inM[i] - b[nm]); cH[nm] += f*(inC[i]/inM[i] - cH[nm]); }
  }
  /* The same pass books the mass: s.mBy and s.hBy must stay consistent, because rho and quality are both read off (m, h). */
  const booked = netBooked(net);
  for(let i=0;i<net.n;i++){ const nm = net.name[i];
    /* Containment (booked 2) has no book and no bottom, so it is left out of the field entirely. */
    if(booked[i] === 2) continue;
    { const bk = bookedKg(net, s, i);
      if(bk !== undefined){ mBy[nm] = bk; continue; } }
    /* The seed, and the one node with no integral worth running: under DRY_MIN_KG the mass is arithmetic noise. */
    const eos = net.vol[i]*netRhoAt(s, nm);
    if(netStoreHeld || mBy[nm] === undefined || eos <= DRY_MIN_KG){ mBy[nm] = eos; continue; }
    /* Integrated, never assigned, and eos is a READING rather than a ceiling; the one real end is zero, and what that floor refuses is booked. */
    const want = mBy[nm] + dt*(inM[i] - mOut[i]);
    const got = Math.max(want, 0);
    if(want !== got) book(s, "advect", want - got);
    mBy[nm] = got;
  }
  // ...and a node may not give a hole more hydrogen than it holds
  if(cH) for(const nm in h2Take) cH[nm] = Math.max(0, cH[nm] - h2Take[nm]);
  h2RiseStep(s, dt);
  /* s.Tavg is READ off the core circuit: mass-weighted over the nodes the transport owns and over what is circulating. Once per circuit with a vessel on it, keyed on circKey(). */
  if(!s.TavgBy) s.TavgBy = {};
  if(!s.dTavgBy) s.dTavgBy = {};
  for(const ci of holdCircs()){ if(G.coreCircs[ci] !== 1) continue;
    const key = circKey(ci), K = (P.cores && P.cores[key]) || P;
    let m = 0, hm = 0, pm = 0; const coreNids = new Set(coreOnCirc(ci).map(coreFold));
    for(let i=0;i<net.n;i++){ const nm = net.name[i];
      if(anch[nm] !== undefined || circOfNode(nm) !== ci) continue;
      /* Membership is a fraction of this node's own commissioned through-flow, not a switch: a dead end scores zero and a slowing leg fades out continuously. */
      const ref = P.netRefThru && P.netRefThru[nm];
      // the vessel is always in the mean: stalled, every through-flow weight is 0 and Tavg froze while the core heated it
      const w = coreNids.has(nm) ? 1 : ref > 0 ? clamp(Math.min(inM[i], mOut[i])/ref, 0, 1) : 0;
      if(!(w > 0)) continue;
      const mi = w*(mBy[nm] !== undefined ? mBy[nm] : net.vol[i]*rho);
      /* The vessel node sits at the MIDPOINT of its own rise, which is what coreStep() centres its channel on. */
      const hi = coreNids.has(nm) && inM[i] > 1e-9 ? 0.5*(inH[i]/inM[i] + h[nm]) : h[nm];
      m += mi; hm += mi*hi; pm += mi*netPAt(s, nm);
    }
    if(m > 0){
      const c = satOfCirc(ci);
      const was = TavgOf(s, ci);
      const T = clamp(tOfH(c, pm/m, hm/m), K.Tmin, K.Tmax);
      /* Filtered once, where the read is: a raw tick-to-tick difference carries 50 Hz noise into pressure and the rod controller's derivative. */
      const raw = dt > 0 ? (T - was)/dt : 0, dWas = s.dTavgBy[key];
      const dT = isFinite(dWas) ? dWas + (raw - dWas)*Math.min(1, dt/TAVG_RATE_TAU) : raw;
      s.TavgBy[key] = T; s.dTavgBy[key] = dT;
      if(ci === G.coreCirc){ s.Tavg = T; s.dTavg = dT; }
    }
  }
  /* s.boron is read AT the core and the demand follows it, or the charging walk dilutes an injection straight back out. */
  if(b && net.coreNode !== undefined){
    const nm = net.name[net.coreNode];
    if(b[nm] !== undefined){ const d = b[nm] - s.boron; s.boron = b[nm]; s.boronDem += d; }
    s.h2 = h2Total(s); }
  /* the wall gives back exactly what advectSrc charged it with this tick */
  if(net.metalKg && s.metalT) for(const nm in metalQ){ const i = net.index[nm];
    if(i !== undefined) s.metalT[nm] -= metalQ[nm]*dt/(net.metalKg[i]*CP_STEEL); }
}
/* kg of hydrogen through every hole this tick, by edge key, off the same limited flows */
const advectH2Out = {};
// and the KILOGRAMS every hole passed, keyed the same way - what a pool weighs
const advectOutKg = {};
// what a hole took over the share the water it passed was carrying, as a concentration, by node
const h2Take = {};
const SETTLE_RELAX = 0.5;
const H2_RISE = 0.25;                    // m/s, drift velocity of a gas bubble in water
function h2RiseStep(s, dt){
  const net = P && P.net, c = s.h2By, mBy = s.mBy;
  if(!net || !c || !mBy || !net.z) return;
  // the edges a bubble could climb, walked once per network: most of them cannot
  if(!net.riseE) net.riseE = net.edges.filter(ed => !netHole(ed) && net.z[ed.u] !== net.z[ed.v]);
  const mov = [], outBy = {};
  for(const ed of net.riseE){
    // the path's own area, and a shut branch is an absent branch: C is the gate
    const A = typeof ed.C === "function" ? ed.C(s) : ed.C;
    if(!(A > 0)) continue;
    const up = net.z[ed.v] > net.z[ed.u], lo = up ? ed.u : ed.v, hi = up ? ed.v : ed.u;
    const nl = net.name[lo], nh = net.name[hi], ml = mBy[nl], mh = mBy[nh], V = net.vol[lo];
    if(!(ml > DRY_MIN_KG) || !(mh > DRY_MIN_KG) || !(c[nl] > 0) || !(V > 0)) continue;
    const kg = c[nl]*ml/V*H2_RISE*A*dt;          // drift flux: what is in a cubic metre, swept up
    if(!(kg > 0)) continue;
    mov.push([nl, nh, kg]); outBy[nl] = (outBy[nl]||0) + kg;
  }
  // a node with several ways up may not give away more hydrogen than it holds
  const k = {};
  for(const nl in outBy){ const have = c[nl]*mBy[nl];
    k[nl] = outBy[nl] > have ? have/outBy[nl] : 1; }
  for(const [nl, nh, kg] of mov){ const m = kg*k[nl];
    c[nl] -= m/mBy[nl]; c[nh] += m/mBy[nh]; }
}
/* kg of hydrogen in the core's circuit: concentration times what each node holds */
function h2Total(s){
  const net = P && P.net, G = nodeGraph(); if(!net || !s.h2By || G.coreCirc < 0) return s.h2||0;
  let t = 0;
  for(let i=0;i<net.n;i++){ const nm = net.name[i], c = s.h2By[nm];
    if(!(c > 0) || !netInCore(nm)) continue;
    const m = s.mBy[nm] !== undefined ? s.mBy[nm] : net.vol[i]*netRhoAt(s, nm);
    t += c*m; }
  return t;
}

/* Kilograms of condensate the hotwell holds full, against the generators it feeds. */
const hotMass=()=>{ let m=0;
  for(const id of sgIds()) m+=sgMassOf(id);
  return Math.max(1,m); };
/* the generators the PLANT has: one nobody piped is a drawing, and the duty is not split over it */
const sgIds=()=>rolePiped("sg");
/* 1 down to SG_DRY, then nothing; an unseeded level reads 1. */
const sgFill=(s,id)=>clamp(sgLvl(s,id)/SG_DRY,0,1);
/* K. A caller with no live shell - the bench, a tick-zero seed - gets the fallback curve. */
const sgTemp=(s,id)=>{ const v=s&&s.sgTBy&&s.sgTBy[id];
  return v===undefined ? tsatSec(secPTarget(s,id), shellCirc(id)) : v; };
/* k indexes ROLE[].internal in declaration order: 0 gives the heat up, 1 takes it. The hot stream's inlet is the hottest neighbour and the cold stream's the coldest. */
const stageInNode=(s,id,k)=>{ const net=P.net; if(!net || !net.name) return -1;
  const p=partOf(id), IN=p && roleIntern(ROLE[p.role])[k]; if(!IN) return -1;
  const nb = net.sgInNbr || (net.sgInNbr = {}), key = id+"|"+k;
  let list = nb[key];
  /* The NEIGHBOURS, not the faces: the crossing lands on the faces, so a face is the extremum the wrong way. Faces are the fallback for an unpiped stage. */
  if(!list){ list = nb[key] = []; const own = new Set(net.nodesOfPart[id]||[]);
    const mine = [];
    for(const c of (net.cont||[])) own.add(c);      // a hole's far end is the room, not a leg
    for(const f of [IN.a, IN.b]){
      const i = net.index[coreFold(id+f)]; if(i===undefined) continue;
      mine.push(i);
      for(const ed of net.edges){ if(ed.u!==i && ed.v!==i) continue;
        const o = ed.u===i ? ed.v : ed.u; if(!own.has(o) && list.indexOf(o)<0) list.push(o); } }
    if(!list.length) list.push(...mine); }
  const hot = k===0;
  let T=hot?-Infinity:Infinity, at=-1;
  for(const i of list){ const t=netTempAt(s, net.name[i]);
    if(hot ? t>T : t<T){ T=t; at=i; } }
  return at; };
/* No node at all - an unplumbed stage, a bench with no field - falls back to the loop mean. */
const stageInT=(s,id,k)=>{ const i=stageInNode(s,id,k);
  return i<0 ? s.Tavg : netTempAt(s, P.net.name[i]); };
const sgHot=(s,id)=>stageInT(s,id,0);
// and what is leaving the same stream, which is the machine's own far face
const stageOutT=(s,id,k)=>{ const IN=roleIns(partOf(id))[k];
  return IN ? netTempAt(s, coreFold(id+IN.b)) : s.Tavg; };
/* kW across one generator's tubes: effectiveness-NTU against an isothermal shell, falling back to UA*dT where the stream is two-phase and its rate infinite. */
const sgQAt=(s,id,fl,filmK,rf)=>{
  const UA=((P.sgUABy && P.sgUABy[id]) || P.sgUA)*Math.pow(fl,UA_FLOW)*sgFill(s,id)*filmK;
  const dT=Math.max(0, sgHot(s,id) - sgTemp(s,id));
  const wcp=stageStream(s,id,0,rf).C;
  if(!isFinite(wcp)) return UA*dT;
  return wcp > 0 ? wcp*(1-Math.exp(-UA/wcp))*dT : 0; };
/* Past NTU 4 the stream is at the shell already and more area removes nothing, so a refit must stop rather than walk to infinity. */
const SG_NTU_MAX=4;
const sgUACap=(s,id,fl,rf)=>{ const wcp=stageStream(s,id,0,rf).C;
  return isFinite(wcp) ? SG_NTU_MAX*wcp/Math.pow(fl,UA_FLOW) : Infinity; };
/* Is the water in these tubes the core's own - asked of the drawing, so any number of barriers is the same question. */
const sgActive = id => nodeGraph().inCore(id + roleIntern(ROLE.sg)[0].a);
/* Is anything still bringing heat to this stage's hot side: a core, or the cold side of another stage. One level, no recursion. */
const stageFed=(net,s,id)=>{
  if(!net.nodesOfPart || !net.nodesOfPart[id]) return false;
  const pc=netPieces(net,s), IN=roleIns(partOf(id))[0]; if(!IN) return false;
  const at=f=>{ const i=net.index[coreFold(f)]; return i===undefined ? -1 : pc.of[i]; };
  const mine=new Set();
  for(const f of [IN.a, IN.b]){ const p=at(id+f); if(p>=0) mine.add(p); }
  if(!mine.size) return false;
  for(const p of corePieces(net,s)) if(mine.has(p)) return true;
  for(const q of sgIds().concat(ihxIds())){ if(q===id) continue;
    const C=roleIns(partOf(q))[1]; if(!C) continue;
    for(const f of [C.a, C.b]) if(mine.has(at(q+f))) return true; }
  return false; };
/* Counterflow effectiveness; at equal rates the general expression is 0/0 and the limit is NTU/(1+NTU). */
const ntuCounter=(NTU,Cr)=>{ if(!(NTU>0)) return 0;
  if(!(Cr<0.999)) return NTU/(1+NTU);
  const e=Math.exp(-NTU*(1-Cr));
  return (1-e)/(1-Cr*e); };
/* One stream of one machine off the solve; a two-phase stream's heat capacity rate is infinite. */
const stageStream=(s,id,k,rf)=>{ const IN=roleIns(partOf(id))[k];
  const key="comp:"+id+":"+IN.a+IN.b;
  const at=stageInNode(s,id,k), nm=at>=0 ? P.net.name[at] : null;
  const ref=netKgs((P.netRefByRun||{})[key]||0);
  /* A stagnant floor: a rate of exactly zero is a deadlock - no flow, no heat, nothing to start the flow. */
  const w=Math.max(netKgs((rf&&rf[key])||0), 0.02*ref);
  const x=nm===null ? 0 : clamp(netQualAt(s,nm),0,1);
  return {T: nm===null ? s.Tavg : netTempAt(s,nm), x,
          fl: ref>1e-9 ? w/ref : 0.02,
          C: x>0 ? Infinity : w*satOfCirc(circOfNode(nm)).cp}; };
/* kW across one exchanger; the film follows the wetter of the two streams. */
const ihxQAt=(s,id,rf)=>{
  if(s.dmgParts.indexOf(id)>=0) return 0;
  const a=stageStream(s,id,0,rf), b=stageStream(s,id,1,rf);
  const dT=a.T-b.T; if(!(dT>0)) return 0;
  const UA=ihxUAOf(id)*Math.pow(Math.min(a.fl,b.fl),UA_FLOW)
          *(1-0.85*Math.max(a.x,b.x));
  const Cmin=Math.min(a.C,b.C), Cmax=Math.max(a.C,b.C);
  if(!isFinite(Cmin)) return UA*dT;
  if(!(Cmin>0)) return 0;
  return ntuCounter(UA/Cmin, isFinite(Cmax) ? Cmin/Cmax : 0)*Cmin*dT; };
const SG_DOME=1.6;   // steam space at 100 % level: a level is read across a downcomer span, not the whole drum
/* the void fraction of the shell's own node, read across the operating span; SGL_SET before there is a field to read */
const sgLvl=(s,id)=>{ const n=shellNode(id);
  if(!s || !s.hBy || s.hBy[n]===undefined || !P.net || P.net.index[n]===undefined) return SGL_SET;
  const v=holdLvlOf(s,n)*SG_DOME;
  return isFinite(v) ? clamp(v,0,100) : SGL_SET; };
/* which way the leak crosses is the pressures, not a choice; the reaction is where the metal is, so one expression covers both signs. Terms are the FIRE row (swReact(), room.js), and nothing is debited - the transport already booked what crossed */
const sgPrimH2=(s,id,kg)=>{
  const IN=roleIns(partOf(id))[0];
  for(const face of [IN.a, IN.b]){
    const nd=coreFold(id+face), m=(s.mBy && s.mBy[nd])||0;
    if(m>DRY_MIN_KG) s.h2By[nd]=(s.h2By[nd]||0)+kg/2/m; }
  s.h2=h2Total(s);
};
function sgReactStep(s, dt, raw){
  const ids=sgIds();
  for(const id in s.sgWastBy) if(ids.indexOf(id)<0){
    delete s.sgWastBy[id]; delete s.sgSwQBy[id]; delete s.sgPwQBy[id]; delete s.sgH2By[id]; }
  for(const id of ids){
    if(s.sgWastBy[id]===undefined) s.sgWastBy[id]=1;
    s.sgSwQBy[id]=0; s.sgPwQBy[id]=0;
    const f=FIRE[satOfCirc(sgPrimCirc(id)).burn];
    // the same fuel on both sides is two sodium circuits, and nothing happens between them
    if(!f || satOfCirc(shellCirc(id)).burn) continue;
    const q=raw["sgtr:"+id]||0;
    if(!q) continue;
    const r=swReact(f, q>0 ? q*dt : swNaFor(f, -q*dt));
    if(q>0){ s.sgSwQBy[id]=r.q/dt; s.sgH2By[id]=(s.sgH2By[id]||0)+r.h2; }
    else   { s.sgPwQBy[id]=r.q/dt; sgPrimH2(s, id, r.h2); }
    s.sgWastBy[id]=Math.min(f.wastMax, s.sgWastBy[id]*(1+f.wast*dt));
  }
}
/* the driest generator: an average would hide one boiling dry behind three healthy ones */
const sglMin=s=>{ const ids=sgIds(); if(!ids.length) return 100;
  let m=100; for(const id of ids){ const v=sgLvl(s,id); if(v<m) m=v; } return m; };
/* each generator's share of the heat leaving the primary, in proportion to its own loop's solved flow; equal split when the solve has nothing to say */
function sgShare(byLoop){
  const ids=sgIds(), out={};
  if(!ids.length) return out;
  let tot=0;
  for(const id of ids){ const i=loopOf(id);
    const q=(i!=null && byLoop && byLoop[i]>0) ? byLoop[i] : 0; out[id]=q; tot+=q; }
  if(tot>0){ for(const id of ids) out[id]/=tot; }
  else for(const id of ids) out[id]=1/ids.length;
  return out;
}
/* the outflow a full-bore severance makes at design pressure, % of loop inventory per second - the scale every break effect is drawn against */
const SPILL_FULL=8.0;
/* how far past zero subcooling a pump goes from full head to nothing: a transition width, not a threshold */
const CAV_SPAN=12;
// how long vapour takes to fill a pump's inlet, and to clear out of it again
const CAV_TAU=1.5;
/* MPa of pressure programme per K of Tavg, per MPa of setpoint */
const PZR_PROG_K=0.17/15.5;
/* heater kW per m3 of shell; spray is an order bigger, and the band is the error at which either saturates */
const PZR_KW_M3=30, PZR_SPRAY_K=10, PZR_BAND=0.1;
/* the pressure at a place, off the solved field once a tick: the circuit's own vessel where it has one, its core's node where it does not, containment otherwise. Level is the same read, off the node's void fraction */
function pressRead(s, dt){
  const net = P && P.net;
  if(!net) return;
  const core = nodeGraph().coreCirc;
  for(const ci of holdCircs()){
    const id = holdOnCirc(ci)[0];
    const own = coreOnCirc(ci)[0];
    const nid = id ? coreFold(id) : own ? coreFold(own) : null;
    if(nid === null || net.index[nid] === undefined){
      setLoopP(s, ci, regionPAt(s, partOf(own || primaryCore())));   // nothing to read: the room it stands in
      continue; }
    setLoopP(s, ci, netPAt(s, nid));
    /* every hold tank's own level, keyed on the tank; the first vessel's circuit is s.lvl as well */
    if(id){ if(!s.lvlBy) s.lvlBy = {}; if(!s.dLvlBy) s.dLvlBy = {};
      const was = s.lvlBy[id] !== undefined ? s.lvlBy[id] : s.lvl;
      const lvl = clamp(holdLvlOf(s, nid), 0, 100), dLvl = dt > 0 ? (lvl - was)/dt : 0;
      s.lvlBy[id] = lvl; s.dLvlBy[id] = dLvl;
      if(ci === core){ s.lvl = lvl; s.dLvl = dLvl; } }
  }
}
function pzrQ(s, id){
  const ci = tankCircuit(id);
  if(ci === null || ci === undefined || ci < 0) return 0;
  const nid = coreFold(id), net = P && P.net;
  if(!net || net.index[nid] === undefined) return 0;
  const set = holdSetP(ci);
  // the programme rides ITS circuit's mean against ITS vessel's Tref; a circuit with no vessel has no programme
  const own = coreOnCirc(ci)[0], K = own && P.cores && P.cores[own];
  const prog = K ? (TavgOf(s,ci)-K.Tref)*set*PZR_PROG_K*K.pRise/K.pzrK : 0;
  const err = (set + prog) - netPAt(s, nid);
  const heat = PZR_KW_M3*tankVolOf(id);
  const q = heat*clamp(err/PZR_BAND, -PZR_SPRAY_K, 1);
  /* a vessel with no water has nothing to boil and nothing to spray with, and a wrecked one takes no orders */
  if(partWrecked(s, id) || holdLvlOf(s, nid) <= 0.5) return Math.min(q, 0);
  return q;
}
/* W-3 (Tong, 1967) in the paper's own units - psia, lb/hr/ft2, inches, BTU/lb, out in BTU/hr/ft2 - converted once at this door; W3_LIM is the correlation's own validity range */
const W3_P=145.038, W3_G=737.338, W3_D=39.3701, W3_Q=3.15459, W3_H=2.326;
const W3_LIM={p:[1000,2300], g:[1.0,5.0], d:[0.2,0.7], x:[-0.15,0.15]};
function dnbW3(pMPa,gSI,x,dhM,dhSub){
  const p=clamp(pMPa*W3_P,W3_LIM.p[0],W3_LIM.p[1]);
  const g=clamp(gSI*W3_G/1e6,W3_LIM.g[0],W3_LIM.g[1]);
  const de=clamp(dhM*W3_D,W3_LIM.d[0],W3_LIM.d[1]);
  const q=clamp(x,W3_LIM.x[0],W3_LIM.x[1]);
  const hs=Math.max(dhSub,0)/W3_H;
  return 1e6*W3_Q
    *((2.022-4.302e-4*p)+(0.1722-9.84e-5*p)*Math.exp((18.177-4.129e-3*p)*q))
    *((0.1484-1.596*q+0.1729*q*Math.abs(q))*g+1.037)
    *(1.157-0.869*q)
    *(0.2664+0.8357*Math.exp(-3.151*de))
    *(0.8258+7.94e-4*hs);
}
/* P.dnbLaw picks the law off what the fluid is (COOLANT, design.js); W-3 gives the shape, the COOLANT row's dnbr column the level, and P.dnbrK anchors all three at the rest point */
/* below W-3's low-flow floor the critical flux walks down to Zuber's pool-boiling CHF at no flow, on the IAPWS surface-tension fit */
const sigmaW = T => { const t = clamp(1 - T/647.096, 0, 1);
  return 0.2358*Math.pow(t, 1.256)*(1 - 0.625*t); };
const chfZuber = pMPa => { const c = SAT_WATER, T = satT(c, pMPa);
  const rf = rhofOf(c,T), rg = rhogOf(c,T);
  return 0.131*hfgOf(c,T)*1000*Math.sqrt(rg)*Math.pow(sigmaW(T)*9.81*Math.max(rf-rg,1e-3), 0.25); };
/* past W-3's quality edge the limit is Biasi (1967): q1 rules low quality, q2 high; W/cm2 with D in cm, G in g/cm2 s, P in bar */
const chfBiasi = (pMPa, gSI, x, dhM) => { const Dc = dhM*100, G = Math.max(gSI, 1)/10, Pb = pMPa*10;
  const Dn = Math.pow(Dc, Dc >= 1 ? 0.4 : 0.6), g6 = Math.pow(G, 1/6);
  const F = 0.7249 + 0.099*Pb*Math.exp(-0.032*Pb);
  const H = -1.159 + 0.149*Pb*Math.exp(-0.019*Pb) + 8.99*Pb/(10 + Pb*Pb);
  const q1 = 1.883e3/(Dn*g6)*(F/g6 - x), q2 = 3.78e3*H*(1 - x)/(Dn*Math.pow(G, 0.6));
  return Math.max(q1, q2, 0)*1e4; };
const chfW3 = (p, g, x, dh, dhSub) => {
  const gFloor = W3_LIM.g[0]*1e6/W3_G;
  const w3 = dnbW3(p, Math.max(g, gFloor), x, dh, dhSub);
  const w = x > W3_LIM.x[1] ? Math.min(w3, chfBiasi(p, Math.max(g, gFloor), x, dh)) : w3;
  if(g >= gFloor) return w;
  const z = chfZuber(p);           // W/m2, the same currency dnbW3 answers in
  return Math.min(w, z + (w - z)*g/gFloor);
};
function dnbrOf(K,m){
  if(m.law==="boil")
    return K.dnbrK*(m.dhSub/K.sat.cp)/Math.max(m.dT,1e-3);
  if(m.law==="temp")
    return K.dnbrK*Math.max(K.tdmg-m.Tin,0)/Math.max(m.Tf-m.Tin,1e-3);
  return K.dnbrK*chfW3(m.p,Math.max(m.g,1e-3),m.x,K.dh,m.dhSub)/Math.max(m.q,1);
}
/* DNB_FILM is a share of the SINGLE-PHASE COOLANT FILM, not of the whole pellet-to-coolant path; the rewet is a wall-superheat hysteresis, so a wall past DT_LEID stays blanketed however the margin reads */
const DNB_FILM=0.10, DT_LEID=150;
const dnbLatch = (K, d, dTs, was) => !K.dryout ? 0 : d < 1 ? 1 : (was && dTs > DT_LEID) ? 1 : 0;
/* `rise` is the enthalpy actually carried to this node, never the core rise peaked by a flux factor */
function marginNode(K,cs,heat,pw,rise,Tin,Tf,gShare,x,dhSub){
  return dnbrOf(K,{law:K.dnbLaw, dhSub, dT:rise, Tin, Tf,
    q:heat*K.rated*1e6/Math.max(K.aHeat,1e-6)*Math.max(pw,1e-3),
    g:K.G0*gShare, x, p:cs.pCore});
}
/* damage is four monotonic per-node integrals (s.nDmg, s.nOx, s.nMelt, s.nDisp - core2d.js); a stage is derived off them and never stored */
const FAIL=[
 {k:"intact",lab:"INTACT",    col:()=>C.cyan},
 {k:"tube",  lab:"CHANNEL OPEN",col:()=>C.blue},
 {k:"burst", lab:"CLAD BURST",col:()=>C.amber},
 {k:"oxid",  lab:"OXIDISED",  col:()=>C.red},
 {k:"disp",  lab:"DISPERSED", col:()=>C.h2},
 {k:"molten",lab:"FUEL MELT", col:()=>C.bright},
];
/* what each stage puts past the fuel boundary: REL_GAP is the fitted anchor, the rest are NUREG-1465's ratios above it, and REL_DISP is a fit between its two neighbours */
const REL_GAP=0.40, REL_OX=0.80, REL_DISP=1.60, REL_MELT=2.40;
const RELK={intact:0, tube:0, burst:REL_GAP, oxid:REL_OX, disp:REL_DISP, molten:REL_MELT};
/* ballooning is hoop stress, not temperature: P_FILL/T_FILL is the as-built helium charge, burstR() mean radius over wall, and BURST_LO/HI are NUREG-0630's fast-ramp curve at two ends, interpolated in log stress */
const P_FILL=2.2, T_FILL=300;
const burstR=()=>(P.rodD/2-ROD_CLAD)/ROD_CLAD;
const BURST_LO={sig:20,T:1477}, BURST_HI={sig:140,T:1030};
/* the BURST_SPAN/BURST_TAU idiom against ROLE.tsurv, so a part sitting on its own limit cannot chatter in and out of the damage list; neither figure is published */
const ROOM_DMG_SPAN=60, ROOM_DMG_TAU=25;
/* a sustained squeeze is not a bang, so it gets the ramp and its own limit; the span is a fraction because pburst runs 15 kPa to 120 across this board */
const ROOM_CRUSH_K=10, ROOM_CRUSH_SPAN=0.5, ROOM_CRUSH_TAU=60;
// over the limit by a span, for a time constant - heat and overpressure both
function hurtStep(bag, id, over, tau, dt){
  if(!(over > 0)) return false;
  const h = (bag[id]||0) + Math.min(over,1)*dt/tau;
  bag[id] = h;
  if(h < 1) return false;
  bag[id] = 0;
  return true;
}
const BURST_TAU=8, BURST_SPAN=50;
function burstT(dP){
  const sig=burstR()*Math.max(dP,0);
  if(sig<=BURST_LO.sig) return BURST_LO.T;
  const f=Math.log(sig/BURST_LO.sig)/Math.log(BURST_HI.sig/BURST_LO.sig);
  return Math.max(BURST_HI.T, BURST_LO.T-(BURST_LO.T-BURST_HI.T)*f);
}
/* Cathcart-Pawel below OX_TSW, Baker-Just above it, both quoted as rate constants on OXIDE THICKNESS SQUARED in m2/s; steam starvation is deliberately not modelled */
const OX_CP={a:2.252e-6,b:18063}, OX_BJ={a:1.867e-4,b:22899}, OX_TSW=1850;
const OX_VMIN=0.02, OX_T0=1073;
const oxRate = T => { const c = T<OX_TSW ? OX_CP : OX_BJ;
  return c.a*Math.exp(-c.b/Math.max(T,300)); };
/* ECR is equivalent clad reacted, off the drawn wall; 0.17 is 10 CFR 50.46's limit and 1.0 is no metal left, which is the second way nDmg reaches 1 */
const OX_ECR_FAIL=0.17;
const ecrOf = ox => ox/ZR_PBR/ROD_CLAD;
/* FUSE_DT is UO2's latent heat expressed as the temperature rise it displaces, so the melt plateau comes free */
const FUSE_KJ=277, FUEL_CP=0.33, FUSE_DT=FUSE_KJ/FUEL_CP, T_STP=298;
/* prompt fuel dispersal above Regulatory Guide 1.77's 280 cal/g of peak fuel enthalpy; DISP_SPAN is a fitted transition width */
const DISP_CALG=280, DISP_H=DISP_CALG*4.184, DISP_SPAN=40;
/* FCI_TAU is the tick's own resolution rather than the interaction's; FCI_ETA is a game figure, no source */
const FCI_TAU=0.01, FCI_ETA=0.2;
/* core melt latches on a quarter of the fuel volume actually molten */
const MELT_LATCH=0.25;
/* what a melting core costs with no catcher under it: inventory %/s and vessel fatigue points/s, both scaled by how much is molten */
const MELT_INV=0.35, MELT_FAT=1.6;
/* the hydrogen milestone, kg: a few per cent of a stock core's zircaloy wall */
const H2_EV=20;
// coreDT0() lives in pipenet.js: layout.js's pump-flow suggestion reads it at module load, where a const declared here is still in TDZ
const CORE_DT_QMIN=0.004;
// the rise at rated flow, which is what a plant only just commissioned already has in it
const coreDTRated = heat => coreDT0()*heat;
/* the solve's currency is kilograms, so this is a magnitude; kept as the one door so a caller says whether it wants a signed flow or a rate */
const netKgs = q => Math.abs(q);
// what a pump's own casing edge carried in the reference solve, kg/s - the panel's scale for PASSING
const pumpRefKgs = id => { const k = pumpEdgeKey(id);
  return k && P.netRefByRun && P.netRefByRun[k] ? netKgs(P.netRefByRun[k]) : pumpFlow(id); };
/* every kilogram the plant holds and every named way one leaves; a residual warns and never throws. A hold tank has no level term - its water is an ordinary node - and an `inf` tank is a boundary, so it books as a term */
const LEDGER_EPS = 1e-7;               // fraction of M0 - a solved quantity never meets a bare compare
const LEDGER_QUIET = 30;               // seconds of sim time between two warnings about the SAME residual
const ledgerKg = s => { let m = 0;
  /* every unbooked node on the plant, not the primary's pool: the secondary's own pipework holds water too */
  { const net = P && P.net;
    if(net && net.name && s.mBy){ const booked = netBooked(net);
      for(let i=0;i<net.n;i++) if(!booked[i]) m += s.mBy[net.name[i]] || 0; } }
  /* a HOSTED tank holds nothing of its own: it is the water standing in the condensers, and the field above already counted it */
  for(const id of tankIds()){ const t=D.tanks[id];
    if(!t.inf && !t.hold && !!t.cell && !tankInField(id)) m += (s.tank&&s.tank[id]!==undefined?s.tank[id]:t.level)/100*tankKg(id); }
  m += sumpKg(s);
  return m; };
const ledgerOut = s => { let k=0; for(const n in s.massOut) k += s.massOut[n]; return k; };
// what is standing on the floor of every region, and it is HELD - see sumpStep()
const sumpKg = s => { let k=0; for(const j in (s.sump||{})) k += s.sump[j]; return k; };
// kg out of the plant, by name. Negative is a boundary feeding it.
const book = (s,name,kg) => { if(kg) s.massOut[name] = (s.massOut[name]||0) + kg; };
/* water let go inside a bounded region comes back into the held side of the book against a negative `sump` line; it floods from the bottom cell up and drowns what it reaches */
function sumpStep(s, dt){
  const G = P.net; if(!G) return;
  const kgOf = rate => Math.max(0, rate)/100*loopKg();
  const put = (cells, kg) => {
    if(!(kg > 0) || !cells || !cells.length) return;
    const c = cells[0], g = matRegionAt(c[0], c[1]);
    if(!g) return;                       // it went into the ship, which is where it always went
    /* what will not fit is never moved into this book, so it stays booked out at the node it left from */
    const k = regionKey(g), have = s.sump[k]||0;
    const take = Math.min(kg, Math.max(0, regionSumpCap(g) - have));
    if(!(take > 0)) return;
    s.sump[k] = have + take;
    book(s, "sump", -take);
  };
  /* a region that stopped being one releases the book that was holding its water back */
  { const live = {};
    for(const g of matRegionsBounded()) live[regionKey(g)] = g;
    for(const k in s.sump){
      const g = live[k];
      if(g){ const cap = regionSumpCap(g);
        if(s.sump[k] <= cap) continue;
        book(s, "sump", s.sump[k]-cap); s.sump[k] = cap; continue; }
      book(s, "sump", s.sump[k]); delete s.sump[k];
    } }
  /* a fluid that burns is not in this book at all: it lands as a pool (s.roomPool, roomFireStep()) with its own mass */
  const burns = fl => !!(fl && fl.c && fl.c.burn);
  for(const key in s.spillBy){
    const r = G.byKey[key.slice(6)];
    if(!r || !r.cells) continue;
    if(burns(openFluidH(s, key))) continue;
    const open = r.cells.filter(([x,y]) => cellBroken(s,x,y));
    put(open, kgOf(s.spillBy[key])*dt);
  }
  const tgt = (G.fitTarget)||{}, out = (G.fitVentOut)||{};
  for(const fid in s.reliefVent){
    if(tgt[fid] || out[fid]) continue;
    const q = partOf(fid); if(!q) continue;
    if(burns(partFluidH(s, fid))) continue;
    put([[q.x+((q.w/2)|0), q.y+((q.h/2)|0)]], kgOf(s.reliefVent[fid])*dt);
  }
  /* read off the same depth the FLOODING layer draws, so the picture and the failure cannot disagree */
  for(const g of matRegionsBounded()){
    const f = regionFlooded(s, g); if(!f) continue;
    const line = f.bot + 1 - f.rows;
    for(const p of LAY.parts){
      if(!fitted(p) || s.dmgParts.indexOf(p.id) >= 0) continue;
      if(p.y + p.h <= line) continue;
      if(matRegionOf(p) !== g) continue;
      s.dmgParts.push(p.id);
      s.dmgWhy[p.id] = "FLOODED";
      const fx = dmgFx(p.id);
      if(fx.hit) fx.hit(s, p.id);
      logE("alarm","FLOODING / "+fx.msg,
        p.name+" is under water - "+f.d.toFixed(1)+
        " m of it is standing on the floor of the region it is in, and the line has reached the machine. "+fx.why);
    }
  }
}

const ioEq = (K,fl) => K.gI*fl/K.lamI;
const xeEq = (K,fl) => (K.gI+K.gX)*fl/(K.lamX+K.sig*fl);
/* the delayed-neutron equilibrium at a commissioning power; raising P.n0 to what the settled flow can carry steps a plant onto a power its flux trip has no margin for */
function seedPower(K, cs, n0){
  cs.n     = n0;
  cs.C     = K.bet.map((b,i)=>b*n0/(K.LAM*K.lam[i]));
  cs.I     = ioEq(K,n0);
  cs.dec   = DEC_A.map(a=>a*n0);
  cs.decay = DEC_A.reduce((t,a)=>t+a,0)*n0;
  cs.heat  = cs.n*PROMPT_F + cs.decay;
}
/* s.coreBy[id] is one vessel's state, P.cores[id] its constants; coreAgg() writes the sums, the maxima and the first vessel's handles back onto S every tick */
const coreState = (s,id) => s.coreBy && s.coreBy[id];
const coreEach  = (s,fn) => { for(const id of coreIds()) if(s.coreBy && s.coreBy[id]) fn(s.coreBy[id], P.cores[id], id); };
/* an order with no id is broadcast; a vessel this design has no bag for is a no-op, exactly as ACT.pumpDem is */
const coreOn    = (s,id,fn) => { if(id===undefined) return coreEach(s,fn);
  const cs=coreState(s,id); if(cs) fn(cs, P.cores[id], id); };
/* one vessel's state over the plant's, with its circuit's own pressure, mean, level, inventory and margin, so a predicate written against S asks that vessel by being handed this */
const coreSeen = (s,id) => { const cs = coreState(s,id); if(!cs) return s;
  const K = P.cores && P.cores[id], ci = K ? K.circ : -1, key = circKey(ci), hold = holdOnCirc(ci)[0];
  const v = Object.assign(Object.create(s), cs);
  if(K){ v.K = K; v.P = loopP(s, ci); v.Tavg = TavgOf(s, ci); v.dTavg = dTavgOf(s, ci);
    if(hold && s.lvlBy && s.lvlBy[hold] !== undefined){ v.lvl = s.lvlBy[hold]; v.dLvl = s.dLvlBy ? s.dLvlBy[hold] : s.dLvl; }
    if(s.invBy && s.invBy[key] !== undefined) v.inv = s.invBy[key];
    if(s.scBy && s.scBy[ci] !== undefined) v.sc = s.scBy[ci]; }
  return v; };
/* one vessel's share of rated flow: the solve's inflow at its node over its own reference, the plant's figure where the solve was not asked */
const coreFlowNet = (K, id, outs, fallback) =>
  (outs && outs.coreKgBy && K.netRef > 0) ? (outs.coreKgBy[id]||0)/K.netRef : fallback;
function coreState0(K, x0){
  return {n:0,C:null,I:0,X:K.X0,Tf:K.TfRef,dec:null,decay:0,heat:0,
    rodPos:x0,rodDem:x0,rodJam:false,rodBand:false,scrammed:false,rpsNear:false,rpsHot:0,trip:"",split:false,reGang:false,
    tilt:0,tiltDem:0,breach:false,melt:false,fatigue:0,dmg:0,meltFrac:0,oxMax:0,qOx:0,fci:0,h2:0,
    fq:1,dnbr:K.dnbr0,vf:0,voidTh:0,rho:0,parts:{rod:0,dop:0,mod:0,exp:0,xe:0,bor:0,vd:0,tip:0,dis:0},
    pCore:K.P0,coreDT:coreDT0(coreD(K.id))*K.n0,flowNet:1};
}
/* power and damage weighted by rating, the worst margin, the hottest pellet, any trip - and the first vessel's handles */
function coreAgg(s){
  const ids=coreIds(); let R=0;
  for(const id of ids) R+=P.cores[id].rated;
  const w=id=>R>0 ? P.cores[id].rated/R : 0;
  let n=0,dec=0,grp=DEC_A.map(()=>0),dmg=0,mf=0,Tf=-Infinity,dnbr=Infinity,vf=0,ox=0,qOx=0,fat=0,any=false,scr=false,brk=false,melt=false,trip="";
  for(const id of ids){ const c=s.coreBy[id]; if(!c) continue; any=true;
    n+=w(id)*c.n; dec+=w(id)*c.decay; dmg+=w(id)*c.dmg; mf+=w(id)*c.meltFrac;
    if(c.dec) for(let i=0;i<grp.length;i++) grp[i]+=w(id)*c.dec[i];
    Tf=Math.max(Tf,c.Tf); dnbr=Math.min(dnbr,c.dnbr); vf=Math.max(vf,c.vf);
    ox=Math.max(ox,c.oxMax); qOx=Math.max(qOx,c.qOx); fat=Math.max(fat,c.fatigue);
    scr=scr||c.scrammed; brk=brk||c.breach; melt=melt||c.melt; if(!trip&&c.trip) trip=c.trip; }
  s.n=any?n:1e-9; s.decay=dec; s.dec=grp; s.heat=s.n*PROMPT_F+s.decay; s.dmg=dmg; s.meltFrac=mf;
  s.Tf=any?Tf:P.TfRef; s.dnbr=any?dnbr:P.dnbr0; s.vf=vf; s.oxMax=ox; s.qOx=qOx; s.fatigue=fat;
  s.scrammed=scr; s.breach=brk; s.melt=melt; s.trip=trip;
  const p=s.coreBy[primaryCore()];
  if(p){ s.rodPos=p.rodPos; s.rodDem=p.rodDem; s.rodJam=p.rodJam; s.rodBand=p.rodBand;
    s.split=p.split; s.reGang=p.reGang; s.tilt=p.tilt; s.tiltDem=p.tiltDem;
    s.rodZ=p.rodZ; s.rodZDem=p.rodZDem; s.bankAuto=p.bankAuto;
    s.rho=p.rho; s.parts=p.parts; s.fq=p.fq; s.ao=p.ao; s.ro=p.ro; s.X=p.X; s.I=p.I;
    s.pCore=p.pCore; s.coreDT=p.coreDT; s.voidTh=p.voidTh; s.TfHot=p.TfHot; }
}
/* governor valve stroke plus steam-plant response */
const LOAD_TAU=2;                       // seconds
/* how fast the two crews are spent: RAD_CREW_K puts a watch pinned at RAD_CEIL at 100 % dose in about 100 s */
const RAD_DOSE_K=0.25, RAD_CREW_K=0.33;
/* a hot field slows a party rather than turning it back; one helper, because the repair block does the slowdown and the damage panel's ETA promises it */
const RAD_SLOW=0.5;
const radWorkK = r => 1/(1+Math.max(0,r-RAD_SLOW)/RAD_SLOW);
/* four exponential groups, each bred by power and decaying on its own clock: 6.4 % at full power, ~2.6 % at 100 s after a trip, just under 1 % an hour later */
const DEC_A=[.0299,.0212,.00947,.00380];        // share of rated power per group
const DEC_L=[.0994,.00477,4.11e-4,2.19e-5];     // 1/s
/* step()'s own heat balance, published for the ledger to draw; not on S, and sgQBy is refilled, never rebuilt */
const HEATBAL={prompt:0,decay:0,heat:0,removal:0,dTavg:0,sgQBy:{},heatBy:{}};
/* the trim walks at the bank rate over the tilt span - derived, or the two drift apart the next time the span is retuned */
const tiltRate = K => rodRate(K)/XTILTZ;
const tsat=p=>satT(P.sat,p);
/* where T-avg is meant to sit for the load the turbine is drawing; a plant whose pressure is its saturation temperature has a flat programme */
const TPROG_SPAN=18;                    // K of programme across the load range
/* the turbine's load and the steam it takes are stated over the whole plant, so a unit on a shared hall answers for its share of what the vessels still running can raise */
const unitFrac=(s,x)=>{ let live=0; coreEach(s,(cs,K)=>{ if(!cs.scrammed) live+=K.rated; });
  return (live>0 && live!==P.rated) ? Math.min(1, x*P.rated/live) : x; };
const tProg=(s,K,cs)=>{ K = K || s.K || P; return ((cs ? cs.scrammed : s.scrammed) && runbackLive()) ? K.Tref-TPROG_SPAN
             : K.steam ? K.Tref
             : K.Tref-TPROG_SPAN + TPROG_SPAN*(s.load===undefined ? 1 : cs ? unitFrac(s, s.load) : s.load); };
/* what the turbine is actually taking as a share of full-load raise - the steam side's answer, not the governor's setting */
const turbShare = s => P.steamRef>0 ? (s.turbWk||0)/P.steamRef : 0;
/* the governor as an opening of the fitted swallow, capped at P.swallow; the bypass is a second gate on the same path, does no work, and is not passK-gated because dumping is what a plant does after a turbine trip. Damage and piping are the edge's question, asked per instance */
const dumpOf = s => (condAvail(s) ? Math.max(clamp((s.Tavg-tProg(s))*DUMP_K,0,P.bypass),
                                            dumpPOf(s)) : 0)
                  + ((s.scrammed && tankRuleAny(s,tankSecondary))?0.08:0);
const turbGate = (s, id) => {
  const c = secCircuitOf(id), piped = (c.sg && c.sink) ? 1 : 0;
  // the secLoad() idiom: a caller with no load stated is at rated, and undefined through Math.min() is a NaN conductance
  const load = s.load===undefined ? 1 : s.load;
  return {work: Math.min(load, P.swallow/Math.max(P.steamRef,1e-9))
                * clamp(piped*(s.turbTrip?0:1),0,1),
          dump: dumpOf(s)}; };
/* one edge, two gates: the path passes governor plus bypass, and only the governor's share does work */
const turbCOf = (s, id) => { if(partWrecked(s,id)) return 0;
  const g = turbGate(s,id);
  return P.turbC*Math.max(0, g.work + g.dump); };
const turbWorkFrac = (s, id) => { const g = turbGate(s,id), t = g.work + g.dump;
  return t > 0 ? Math.max(0,g.work)/t : 0; };

/* a coolant pump answers the plant-wide lever, any other pump only for itself; a standby train commissions stopped, asked of the drawing rather than written into D.start */
const pumpDem0 = id => pumpStandby(id) ? 0 : 1;
const pumpStart = id => primaryPump(id) ? startOf("flowDem",1)
                                        : startOf(id+":pumpDem", pumpDem0(id));
const loadStart = () => Math.min(startOf("loadDem",1), P.loadMax);
/* not on S: restoreS() replaces the whole state object, so S identity cannot tell "scrubbed" from "recommissioned" */
let plantGen=0;
function resetPlant(){
  plantGen++;
  for(const k in feedInHBy) delete feedInHBy[k];
  const x0=startOf("rodCommon",RODX0);
  S={coreBy:{}, n:0,C:null,I:0,X:P.X0,
     Tf:P.TfRef,Tavg:P.Tref,rodPos:x0,rodDem:x0,rodJam:false,rodBand:false,scrammed:false,
     /* the designer's starting position, under the machine's own ceiling: a turbine that swallows half of what the boiler raises cannot be asked for all of it on tick one */
     load:loadStart(),loadDem:loadStart(),flowNet:1,P:P.P0,lvl:54,inv:100,
     /* one setpoint per circuit something authors, keyed by circuit index; a circuit with no hold tank gets no entry */
     PBy:Object.fromEntries(holdCircs().filter(ci=>circKey(ci)!==null)
                                       .map(ci=>[circKey(ci),holdSetP(ci)])),
     /* one mean per circuit with a vessel on it, at its own programme; s.Tavg above is the first vessel's circuit */
     TavgBy:Object.fromEntries(holdCircs().filter(ci=>nodeGraph().coreCircs[ci]===1)
                                          .map(ci=>[circKey(ci),satOfCirc(ci).Tref])),
     dTavgBy:Object.fromEntries(holdCircs().filter(ci=>nodeGraph().coreCircs[ci]===1).map(ci=>[circKey(ci),0])), invBy:{},
     lvlBy:Object.fromEntries(holdTankIds().map(id=>[id,54])), dLvlBy:{},
     /* what each hold tank is holding, refilled: its loop's pressure while live, its own the moment a valve cuts it off */
     holdPBy:Object.fromEntries(holdTankIds().map(id=>[id,holdSetP(tankCircuit(id))])),
     scBy:{},
     /* one demand and one actual per pump, refilled; demand starts equal to actual, the rule every actuator owes */
     flowBy:Object.fromEntries(pumpIds().map(id=>[id,pumpStart(id)])),
     flowDemBy:Object.fromEntries(pumpIds().map(id=>[id,pumpStart(id)])),
     /* each generator's feed regulating valve, an actuator walked toward the controller's ask; 0 is wide open */
     fregBy:Object.fromEntries(sgIds().map(id=>[id,0])),
     fregDemBy:Object.fromEntries(sgIds().map(id=>[id,0])),
     /* each generator's share of the heat leaving the primary, measured off the solve and read back by secP() next tick */
     sgShare:Object.fromEntries(sgIds().map(id=>[id,1/Math.max(1,sgCount())])),
     /* K at the shell's own saturation, and kg/s down its steam nozzle - both reads off the solved field, refilled */
     sgTBy:{}, steamBy:{},
     /* what each shell's feed regulating valve carried, kg/s; a readout */
     sgFedBy:{},
     /* kg/s across the turbine wheels and the MPa it saw doing it; plant level, because a header mixes */
     turbWk:0, turbP:0,
     /* kg/s of secondary water going overboard through a machine open to atmosphere - a readout and a ledger entry */
     condVent:0, condVentSeen:false,
     /* MPa read off the shell's own node once a tick: secP() is asked from inside the solve and may not see a half-solved field */
     sgPBy:{},
     /* how far the reaction has eaten this tube leak open, the heat into shell and primary in kW, and the hydrogen made in the shell and not yet vented */
     sgWastBy:{}, sgSwQBy:{}, sgPwQBy:{}, sgH2By:{},
     /* kW across one exchanger's tubes, read a tick late because the solve runs before there is a field to price it off */
     ihxQBy:{},
     /* kg/s a generator's own relief valves are passing - a readout, refilled */
     sgVentBy:{},
     /* whether its shell has let go; latched, because a burst shell does not reseat */
     sgBurst:Object.fromEntries(sgIds().map(id=>[id,false])),
     /* kg/s each secondary relief valve is passing - a readout, refilled */
     reliefSteam:{},
     /* the condenser's own temperature, K - what its backpressure is the saturation pressure of */
     condT:0,
     /* per machine: its own temperature and backpressure, what the water arriving is at, and what is running through it; all fed forward one tick and refilled */
     condTBy:{}, condPBy:{}, cwInTBy:{}, cwFlowBy:{},
     /* each panel's own temperature K and what it is pulling out of the water in it, kW; per instance, because two panels need not be on one circuit */
     radTBy:{}, radQBy:{},
     /* seeded off P.fittings rather than fixed keys, so a plant with no relief path seeds nothing; reliefArm is the one-shot commanding that fitting's next lift to stick */
     reliefOpen:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     reliefAuto:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     reliefStuck:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     reliefBlocked:Object.fromEntries(reliefFitIds().map(k=>[k,!!startOf(k+":porvBlock",false)])),
     reliefArm:Object.fromEntries(reliefFitIds().map(k=>[k,false])),
     dmg:0,fatigue:0,dnbr:P.dnbr0,rho:0,voidTh:0,cav:0,vf:0,fq:1,ao:0,ro:0,
     /* the groups start in equilibrium with commissioning power (seedPower() below), or the plant breeds heat it should already have */
     dec:null, decay:0,
     rbHot:false,                        // SINK.runback's edge, so the one-shot fires once - see ctl.js
     /* the live automation, one record per D.blocks row - see ctl.js. REFILLED. */
     blkBy:blkSeed(),
     breach:false,melt:false,trip:"",
     /* both latched on the same number: the turbine's stop valve once exhaust pressure got away, the condenser once it went past atmospheric and relieved */
     turbTrip:false, condLost:false,
     ev:{}, blackout:false, nat:0, release:0,
     /* the board's own lit set, refilled, and a count of every tile transition it has seen */
     annOn:{}, annRev:0,
     /* K, fed forward the same tick: what the condenser rejects warms the water whose temperature decides what it can reject */
     cwInT:RAD_TDES,
     /* every tank, keyed by tank id: level 0..100, the operator's valve, its overboard dump, its rule defeated, its rupture disc (latched) and what it is spilling past full in kg/s */
     /* one level per tank STANDING ON THE BOARD; a hosted tank is the water in its host and tankLvl() reads it there */
     tank:Object.fromEntries(tankIds().filter(k=>D.tanks[k].cell).map(k=>[k,D.tanks[k].level])),
     tankOpen:Object.fromEntries(tankIds().map(k=>[k,!!startOf(k+":tankOpen",false)])),
     tankDump:Object.fromEntries(tankIds().map(k=>[k,!!startOf(k+":tankDump",false)])),
     tankByp:Object.fromEntries(tankIds().map(k=>[k,!!startOf(k+":tankByp",false)])),
     burstBy:Object.fromEntries(tankIds().map(k=>[k,false])),
     tankOver:{},
     /* kg out of the plant by named term, cumulative, so a tick differences it rather than clearing it */
     massOut:{}, massRes:0, massWarn:0, massWarnT:0,
     /* kg standing on each region's floor, keyed by its lowest cell: water that has left the plant and is still on the ship */
     sump:{},
     /* what each tank's AUTORULE decided last tick; a rule with two setpoints has to know whether it is already running */
     tankAuto:Object.fromEntries(tankIds().map(k=>[k,false])),
     /* what each tank's own edge is carrying, % of loop inventory per second, tank-out-positive - a readout, refilled */
     tankRate:{},
     /* the enthalpy field and the pressures it is read against, keyed by node name; refilled, never rebuilt */
     hBy:{}, pBy:{},
     /* kg at each node, integrated off the solved flows in the same donor pass the enthalpy takes */
     mBy:{},
     /* boron in pcm and hydrogen in kg per kg of coolant, per node on the same donor pass; s.metalT is the steel round each node, K */
     bBy:{}, h2By:{}, metalT:{},
     split:false, reGang:false,
     /* a cross-tie starts shut, a valve spliced into a line the design depends on starts wide (fitTies(), layout.js); wide open is bit-identical to no valve */
     valve:Object.fromEntries(Object.keys(P.fittings).filter(k=>P.fittings[k].mode==="throttle")
       .map(k=>[k, startOf(k+":valve", fitTies(k)?0:1)])),
     valveDem:Object.fromEntries(Object.keys(P.fittings).filter(k=>P.fittings[k].mode==="throttle")
       .map(k=>[k, startOf(k+":valve", fitTies(k)?0:1)])),
     /* one isolation valve per port, all commissioning open, with no starting position: a plant nobody has isolated is bit-identical to one with no port valves */
     portShut:Object.fromEntries(Object.keys(D.ports).map(k=>[k,false])),
     arLo:P.arLo, arHi:P.arHi,
     dmgParts:[], repair:null, sgtr:false,
     /* two crews, two places: `dose` is the repair party's own integral off the cell it is standing in, `crewDose` the watch's off its own seat */
     /* one cavitation figure per pump, read at its own suction; s.cav beside it is the worst of them */
     cavP:Object.fromEntries(pumpIds().map(id=>[id,0])),
     // what each pump is passing, kg/s, off its own casing edge: a reading (pumpQOf), seeded at the reference's answer
     pumpQBy:Object.fromEntries(pumpIds().map(id=>[id,pumpRefKgs(id)])),
     dose:0, crewDose:0, doseRate:P.dose, repRate:0, partySpent:false,
     bkpLost:false, dLvl:0,
     boron:0,boron0:0,boronDem:0,parts:{rod:0,dop:0,mod:0,exp:0,xe:0,bor:0,vd:0,tip:0,dis:0},
     /* one flow integral per run, seeded off P.net's own key set rather than a fixed kind table */
     flowPos:Object.fromEntries(Object.keys(P.net.byKey).map(k=>[k,0])),
     /* the reactor-period differentiator's own state, here rather than in trends.js because a snapshot is a clone of S */
     perN:P.n0, perT:0, perV:Infinity,
     /* the dice cursor (rng.js); diceOff stands them down for a scripted run */
     seed:0, rng:0, diceOff:false,
     /* the core's own rise, K, and the one thing buoyancy consumes; seeded at rated, or the first tick is 15 K cold and kicks a moderator transient */
     coreDT:coreDT0()*P.n0,
     /* the pressure in the vessel, MPa - a readout, and no longer the same number as s.P */
     pCore:P.P0,
     /* what injection is delivering, % of loop inventory per second - a readout */
     injRate:0,
     /* what a ruptured generator is passing into its secondary, % of loop inventory per second - a readout */
     sgtrRate:0,
     /* and the same per generator, so the jet lands on the machine that was hit - refilled */
     sgtrBy:{},
     /* every opening on the plant and what it is passing - refilled, never rebuilt */
     spillBy:{}, spillRate:0,
     /* what each primary relief fitting is passing, % of loop inventory per second - a readout, refilled */
     reliefVent:{},
     /* the room's fields are STATE, unlike the radiation field: heat that arrived has to still be here next tick. Double, because it integrates a tiny rate into a large absolute value where an ulp eats a systematic share of every step */
     roomT:new Float64Array(GW*GH).fill(T_HULL),
     /* single precision, and the rest of the room's fields with it: each is small or moved by a term proportional to what it holds, and the arithmetic stays double */
     roomH2:new Float32Array(GW*GH),
     /* oxygen seeded at what air holds, the flame front's progress per cell, and the pressure that breaks things; declared here because the snapshot cloner throws on anything it does not know */
     roomO2:new Float32Array(GW*GH).fill(ROOM_O2_0),
     roomFlame:new Float32Array(GW*GH), roomP:new Float32Array(GW*GH),
     /* the metal on the deck and its energy, datum liquid at the melting point, so a pool has a temperature to take the ignition test with */
     roomPool:new Float32Array(GW*GH), roomPoolE:new Float32Array(GW*GH),
     /* kg each catch pan's drain has taken off the deck; the metal was booked out at the opening it left through, so this moves no book */
     panBy:{},
     /* kg of gas per cell, and the compartment's pressure follows from it (roomPOf(), room.js) */
     roomM:new Float32Array(GW*GH).fill(ROOM_MAIR),
     // what each open hole is passing, kg/s, keyed by its own cell
     holeQ:{},
     /* the high-water mark, never decayed and never cleared: s.roomP relieves on ROOM_P_TAU and cannot say where the plant has been blown up */
     roomPPk:new Float32Array(GW*GH),
     /* one event per explosion, not one per tick: a front at the flammability limit crawls for minutes and would never trip a per-tick gate */
     burnEv:{kg:0, p:0, blast:0, ids:[]},
     /* the same latch for the metal fire, carrying its own joules: burning in air and reacting with water are not worth the same */
     fireEv:{kg:0, p:0, q:0},
     /* how far each machine is through being cooked by its own cell, monotonic while over its limit and cleared on repair */
     roomHurt:{}, roomCrush:{}, dmgWhy:{},
     /* the skin of each machine, K, and what its contents give up through it, kW; seeded by roomStep() because what a machine contains is not known until the pots exist */
     partT:{}, skinQ:{},
     /* the wall of each pipe run, K - the same pot, keyed by run key */
     runT:{},
     // readouts: the hottest cell, where it is, and what burned this tick
     roomMax:T_HULL, roomMaxAt:-1, roomBurnOn:0, roomFireOn:0, roomBang:0, roomPMax:0,
     // how fast the two shafts are turning, deg/s - see step()'s own note
     spinV:0,spinTV:0,dTavg:0,heat:0,sc:0,t:0,tick:0};
  /* the one Math.random() the sim is allowed, and it is outside the tick: every die from here comes off s.rng */
  seedRng(S,(Math.random()*4294967296)>>>0);
  /* a plant with no vessel commissions cold, which is seedPower() asked for the power this plant is actually at */
  for(const cid of coreIds()){ const K=P.cores[cid], cs=coreState0(K,x0); S.coreBy[cid]=cs; seedPower(K,cs,P.n0); }
  coreAgg(S);
  /* a plant on tick zero is at rated flow by construction, so its rise is coreDTRated() even though s.coreDT has not walked up to it */
  S.sc   = tsat(S.P) - (S.Tavg + coreDTRated(S.heat)/2);
  /* the shell is seeded off the fallback curve; from here it is an integral */
  for(const id of sgIds()) S.sgTBy[id] = tsatSec(secPTarget(S,id), shellCirc(id));
  /* one temperature over the fleet: rejection is emis*area*T^4, so a common T is the solution whatever the mix of coatings and sizes */
  { const q = P.rated*P.n0*(1-(1-bleedFrac())*P.eff)*1000, r = condRest(q);
    for(const id in S.radTBy) if(!partOf(id)) delete S.radTBy[id];
    for(const id of radIds()) S.radTBy[id] = r.radT;
    /* at rest a panel takes out what it sheds; left at 0 the settle below commissions the cooling circuit ten kelvin hot */
    for(const id of radIds()) S.radQBy[id] = radRejOf(S,id);
    S.cwInT = r.cwIn;
    S.condT = r.condT;
    for(const id of condIds()){ S.cwInTBy[id] = r.cwIn; S.condTBy[id] = r.condT;
      S.condPBy[id] = Math.max(COND_P0, psatSec(r.condT)); } }
  /* settle the flux shape first, then dial in the boron that makes THIS shape critical: rod worth is emergent, so a formula leaves the plant off-critical */
  coreEach(S,(cs,K)=>coreReset(K,cs,cs.flowNet)); coreAgg(S);
  /* the plant commissions at its own solved flow: P.netRef is isothermal and carries no buoyancy, so the field is settled here by running the transport against its own solve, at the sim's own dt, until the two stop moving */
  /* seeded off the same expressions the tick uses, because advectSrc() reads HEATBAL and a fresh page has last plant's in it */
  const restHeat = (byLoop) => {
    const sh = sgShare(byLoop), n = Math.max(1, sgIds().length), filmK = 1-0.85*Math.min(clamp(S.vf,0,1.5),1);
    for(const id in HEATBAL.sgQBy) if(!(id in sh)) delete HEATBAL.sgQBy[id];
    for(const id in sh){ S.sgShare[id] = sh[id];
      HEATBAL.sgQBy[id] = sgQAt(S, id, Math.max(S.flowNet*sh[id]*n, 0.02), filmK, rf); }
    /* and the stage in front of them on the same pass, or the second circuit converges taking nothing at all */
    for(const id in S.ihxQBy) if(!partOf(id)) delete S.ihxQBy[id];
    for(const id of ihxIds()) S.ihxQBy[id] = ihxQAt(S, id, rf); };
  HEATBAL.heat = S.heat; coreEach(S,(cs,K,id)=>{ HEATBAL.heatBy[id]=cs.heat; });
  /* with a pressure field, because the solve is keyed on last tick's: a check valve reads wide open and a node's phase reads at s.P until there is one */
  const outs = {noNat:true}, rf = {};
  /* one window over 300 passes of solve plus transport, none of which writes the drawing */
  laySettle();
  /* nothing stores while the rest point is being found: a store does nothing at a rest point, and this is not a time march, so an inventory integrated across it is not an inventory */
  netHoldStore(true);
  /* the field has to converge too, because the shells read it (sgHot): advectStep relaxes every node by SETTLE_RELAX a pass while the store is held, until every generator's own inlet stands still */
  { const DTS = 0.02, hotWas = {};
    for(let i=0;i<300;i++){
      const pf = {}, k = netFlowK(S, rf, pf, outs);
      keepPField(S, pf);
      const was = S.flowNet;
      if(k > 0) S.flowNet = k;
      restHeat(outs.byLoop);
      coreEach(S,(cs,K,id)=>{ cs.flowNet = coreFlowNet(K, id, outs, S.flowNet);
        coreStep(K, cs, 0, cs.heat, satT(K.sat, cs.pCore), 0,
               K.flowK*cs.flowNet, Math.max(cs.flowNet, CORE_DT_QMIN), TavgOf(S, K.circ)); });
      coreAgg(S);
      advectStep(S, DTS, rf, outs.edgeKg);
      /* the shell is held at its commissioning level for the same reason the hold tank is pinned: the settle is a rest point, and the feed valve is not walked until after it */
      for(const id of sgIds()){ const n = shellNode(id), i = P.net.index[n];
        if(i === undefined || S.hBy[n] === undefined) continue;
        const ci = shellCirc(id), p = secP(S,id);
        S.hBy[n] = holdSeedH(ci, p, SGL_SET/SG_DOME);
        S.mBy[n] = P.net.vol[i]*rhoMixOf(satOfCirc(ci), p, S.hBy[n]); }
      /* and the hotwell at its own, for the same reason: nothing walks the condensate level until the plant is running */
      for(const id of condSinks()){ const n = condVesNode(id), i = P.net.index[n];
        if(i === undefined || S.hBy[n] === undefined) continue;
        const c = satOfCirc(circOfNode(n)), T = satT(c, condP(S));
        S.hBy[n] = hOfT(c, T);
        S.mBy[n] = condFill0()/100*P.net.vol[i]*rhofOf(c, T); }
      /* the transport owns the shape round the loop, but the settle has no controller, so every pass puts the core circuit's mean back on Tref; the pressurizer's node keeps its bubble */
      { const G = nodeGraph();
        for(const ci of holdCircs()){ if(G.coreCircs[ci] !== 1) continue;
          const c = satOfCirc(ci), key = circKey(ci), T = TavgOf(S, ci);
          if(!isFinite(T)) continue;
          const dh = hOfT(c, c.Tref) - hOfT(c, T);
          if(Math.abs(dh) > 1e-9){ const skip = holdNodeSet();
            for(const nm in S.hBy) if(circOfNode(nm) === ci && !skip.has(nm)) S.hBy[nm] += dh;
            S.TavgBy[key] = c.Tref; if(ci === G.coreCirc) S.Tavg = c.Tref; } } }
      /* and the suggested tubes are sized for this point, a ratio step a pass */
      { const ids = sgIds(), n = Math.max(1, ids.length), filmK = 1-0.85*Math.min(clamp(S.vf,0,1.5),1);
        let any = false;
        for(const id of ids){ if(D.sgUA[id]!=null) continue;
          const fl = Math.max(S.flowNet*(S.sgShare[id]!==undefined?S.sgShare[id]:1/n)*n, .02);
          const now = sgQAt(S,id,fl,filmK,rf), want = P.n0*P.rated*1000/n;
          if(now>0 && want>0){ P.sgUABy[id] = Math.min(P.sgUABy[id]*clamp(want/now, 0.5, 2), sgUACap(S,id,fl,rf)); any = true; } }
        if(any) P.sgUA = ids.reduce((t,id)=>t+P.sgUABy[id],0)/n; }
      let moved = 0;
      for(const id of sgIds()){ const t = sgHot(S, id);
        if(hotWas[id] !== undefined) moved = Math.max(moved, Math.abs(t - hotWas[id]));
        hotWas[id] = t; }
      if(i > 20 && Math.abs(S.flowNet - was) < 1e-5 && moved < 1e-3) break;
    } }
  netHoldStore(false);
  layRelease();
  /* critical at the settled point, not the cold one; coreReset() reallocates rather than accumulates, so running it twice is running it once */
  coreEach(S,(cs,K)=>coreReset(K,cs,cs.flowNet)); coreAgg(S);
  /* after coreReset(), which allocates the K.NB-sized arrays, so nothing bank-shaped can be seeded before it */
  coreEach(S,(cs,K)=>{
    for(let b=0;b<K.NB;b++){
      cs.rodZ[b] = cs.rodZDem[b] = startOf("rodBank:"+b, x0);
      cs.bankAuto[b] = !startOf("bankAuto:"+b, false);
    }
    let m=0; for(let b=0;b<K.NB;b++) m+=cs.rodZ[b];
    cs.rodPos = cs.rodDem = m/K.NB;
    cs.tilt = cs.tiltDem = startOf("tiltDem",0); });
  /* critical on the ledger the first tick will read, not the seeded shape: at dt 0 coreStep() is the algebra alone, and five passes, because the void moves the shape and the shape moves the void. Before the steam side, whose film reads the rest void */
  /* the boron is the loop's, dialled on the first vessel's ledger: a second vessel on the same water takes the same poison */
  { let o0=null, K0=null;
    coreEach(S,(cs,K,id)=>{ let o=null;
      /* at the pressure the first tick will read (pressRead, off the settled field), never the vessel's nominal */
      { const pf = S.pBy && S.pBy[coreFold(id)]; if(pf !== undefined && isFinite(pf) && pf > 0) cs.pCore = pf; }
      for(let i=0;i<5;i++){
        o=coreStep(K,cs,0,cs.heat,satT(K.sat,cs.pCore),0,K.flowK*cs.flowNet,Math.max(cs.flowNet,CORE_DT_QMIN),TavgOf(S,K.circ));
        for(let k=0;k<XNN;k++) cs.nV[k]=cs.nVt[k]; }
      cs.voidTh = cs.vf = cs.vNode;        // the rest void K.vf0 is read off, not a 0 the first tick overwrites
      if(id===primaryCore()){ o0=o; K0=K; } });
    S.boron = S.boron0 = o0 ? -(K0.excess+o0.rod+o0.tip+o0.dop+o0.mod+o0.exp+o0.xe+o0.vd) : 0;
    coreAgg(S); }
  S.boronDem = S.boron;                 // start on demand, or it walks off commissioning
  /* the water carries it: the field settled at a boron of 0, and s.boron is read off the vessel's node from tick one */
  for(const nm in S.bBy) if(netInCore(nm)) S.bBy[nm]=S.boron;
  /* the steam side is seeded, not discovered: each shell's pressure is walked to the one that pushes what it raises into the header it sees, stores stood down, until every shell agrees */
  /* one window over both seed walks: neither writes the drawing, and outside a settled window nodeGraph() proves its signature on every call */
  laySettle();
  { const shells = sgIds(), n = shells.length;
    netHoldStore(true);
    let last = null;
    const pOf = () => shells.map(id => secP(S,id));
    const setP = p => shells.forEach((id,j) => { S.sgPBy[id] = p[j];
      S.sgTBy[id] = tsatSec(p[j], shellCirc(id)); });
    /* the residual has to be a function of the pressure alone: every conductance is linearised about last tick's field, so the field is driven to its own fixed point before the reading is taken */
    const solve = () => { restHeat(outs.byLoop);
      const o = {}, pf = {};
      let was = null;
      for(let k=0;k<30;k++){
        for(const key in o) delete o[key];
        netFlowK(S, rf, pf, o); keepPField(S, pf);
        const by = o.sgSteamOutBy || {};
        const now = shells.map(id => by[id]||0);
        if(was && now.every((v,j) => Math.abs(v-was[j]) <= 1e-6*Math.max(Math.abs(v),1))) break;
        was = now; }
      last = o;
      const by = o.sgSteamOutBy || {};
      return shells.map(id => (by[id]||0) - (HEATBAL.sgQBy[id]||0)/riseSg(id, secP(S,id))); };
    /* one Jacobian by differences, then Broyden: the residual is nearly diagonal in the shells, so a rank-one update holds, retaken the moment an iteration makes the error worse */
    let A = null, pPrev = null, rPrev = null, errPrev = Infinity;
    for(let i=0;i<40 && n;i++){
      const p = pOf(), r0 = solve();
      let err = 0;
      shells.forEach((id,j) => { const w = (HEATBAL.sgQBy[id]||0)/riseSg(id, p[j]);
        if(w > 0) err = Math.max(err, Math.abs(r0[j])/w); });
      if(err < 1e-6) break;
      if(!A || err > errPrev){
        A = shells.map(() => new Array(n).fill(0));
        for(let j=0;j<n;j++){ const dp = 1e-3*p[j], q = p.slice(); q[j] += dp; setP(q);
          const r1 = solve(); for(let i2=0;i2<n;i2++) A[i2][j] = (r1[i2] - r0[i2])/dp; } }
      else { const dp = p.map((v,j) => v - pPrev[j]), dd = dp.reduce((t,v) => t + v*v, 0);
        if(dd > 0) for(let i2=0;i2<n;i2++){ let Adp = 0;
          for(let j=0;j<n;j++) Adp += A[i2][j]*dp[j];
          const v = (r0[i2] - rPrev[i2]) - Adp;
          for(let j=0;j<n;j++) A[i2][j] += v*dp[j]/dd; } }
      pPrev = p; rPrev = r0; errPrev = err;
      const d = new Array(n).fill(0);
      denseSolve(A.map(row => row.slice()), r0.map(v => -v), d, n);
      /* ceiled at the shell's own burst point: a pass that will not converge would otherwise run its 20 % step forty times */
      setP(p.map((v,j) => clamp(v + clamp(d[j], -0.2*v, 0.2*v),
                                regionPAt(S, partOf(shells[j])), sgBurstP(shells[j])))); }
    if(n) solve();
    netHoldStore(false);
    if(last){ S.turbP = last.turbWkA > 0 ? last.turbWkP/last.turbWkA : condP(S);
      /* what leaves is what the shell RAISES: the pinned solve reports the geometry's answer, and the condenser is sized off this */
      for(const id of shells){ S.sgFedBy[id] = (last.sgFeedBy && last.sgFeedBy[id]) || 0;
        S.steamBy[id] = (HEATBAL.sgQBy[id]||0)/riseSg(id, secP(S,id)); }
      S.turbWk = Math.max(0, (last.turbWk||0) - bleedPlant(S)); } }
  /* the feed valve is left where the controller would have: each is bisected against the liquid solve to the back-pressure at which its own shell edge carries what the shell raises, and the round repeats because the shells share a header */
  { const ids = sgIds();
    /* the store is LIVE for this walk: the valve is being positioned for the network the TICK marches, and a solve with no node diagonal is not that network */
    netHoldStore(false);
    const solveFeed = () => { const o = {noNat:true}, pf = {}; netFlowK(S, rf, pf, o);
      keepPField(S, pf); return o; };
    // read at the field's own fixed point: one solve relinearises the next, so a bracket on single solves never closed
    const feedAt = () => { let was = null, by = {};
      for(let k=0;k<30;k++){ const o = solveFeed(); by = o.sgFeedBy || {};
        const now = ids.map(id => by[id]||0);
        if(was && now.every((v,j) => Math.abs(v-was[j]) <= 1e-4*Math.max(Math.abs(v),1))) break;
        was = now; }
      return by; };
    const fedOf = id => feedAt()[id] || 0;
    // the governor's re-commissionings search from the last answer; P is rebuilt per commission, so a fresh plant never sees one
    const seed = P.fregSeed || {};
    /* the valves are one system, so they are solved as one; an accelerator only - whatever it lands on seeds the round below, which still decides the answer and owns the stops */
    const wantOf = id => S.steamBy[id]||0;
    const jids = ids.filter(id => wantOf(id) > 0);
    if(jids.length > 1){
      const n = jids.length, x = new Float64Array(n);
      for(let j=0;j<n;j++){ const g = seed[jids[j]];
        x[j] = clamp(g === undefined ? S.fregBy[jids[j]] : g, 0, 1); }
      const setX = () => { for(let j=0;j<n;j++) S.fregBy[jids[j]] = x[j]; };
      // scaled residual, so one tolerance covers shells of different size
      const resid = out => { setX(); const by = feedAt();
        let err = 0;
        for(let j=0;j<n;j++){ const w = wantOf(jids[j]);
          out[j] = ((by[jids[j]]||0) - w)/w;
          const a = Math.abs(out[j]); if(a > err) err = a; }
        return err; };
      const r0 = new Float64Array(n), r1 = new Float64Array(n), dx = new Float64Array(n);
      let err = resid(r0);
      // rows are d(residual)/d(position); the coupling is weak off the diagonal, so it inverts
      let J = null;
      for(let it=0; it<12 && err > 1e-5; it++){
        if(!J){
          J = [];
          for(let j=0;j<n;j++){
            const x0 = x[j], h = (x0 > 0.5 ? -1 : 1)*1e-3;
            x[j] = clamp(x0 + h, 0, 1);
            const hh = x[j] - x0;
            if(hh === 0){ J = null; break; }
            resid(r1);
            const col = new Float64Array(n);
            for(let i2=0;i2<n;i2++) col[i2] = (r1[i2] - r0[i2])/hh;
            J.push(col); x[j] = x0;
          }
          if(!J) break;
          resid(r0);
        }
        if(!denseSolve(J, r0, dx, n)) break;
        let step = 1, ok = false;
        for(let t=0;t<6;t++){
          for(let j=0;j<n;j++) x[j] = clamp(x[j] - step*dx[j], 0, 1);
          const e2 = resid(r1);
          if(e2 < err){ err = e2; r0.set(r1); ok = true; break; }
          for(let j=0;j<n;j++) x[j] = clamp(x[j] + step*dx[j], 0, 1);
          step /= 2;
        }
        if(!ok) break;
        J = null;                      // re-take by differences rather than carry a bad one
      }
      setX();
      for(let j=0;j<n;j++) seed[jids[j]] = x[j];
    }
    for(let r=0;r<12 && ids.length;r++){
      let moved = 0;
      for(const id of ids){ const want = S.steamBy[id]||0; if(!(want > 0)) continue;
        const was = S.fregBy[id], max = 1, tol = 1e-6*want,
          f = v => { S.fregBy[id] = v; return fedOf(id) - want; };
        const land = v => { S.fregBy[id] = v;
          moved = Math.max(moved, Math.abs(v-was)/Math.max(max,1e-9)); };
        let a = 0, fa, b = max, fb, side = 0;
        const g = r ? was : seed[id];
        if(g !== undefined){
          // bracket outward from the guess: a valve near its balance is a few readings, not a search over its stroke
          const f0 = f(g); if(Math.abs(f0) < tol){ land(g); continue; }
          let d = 0.05*max;
          if(f0 > 0){ a = g; fa = f0; b = Math.min(g+d, max); fb = f(b);
            while(fb > 0 && b < max){ d *= 2; b = Math.min(b+d, max); fb = f(b); } }
          else { b = g; fb = f0; a = Math.max(g-d, 0); fa = f(a);
            while(fa < 0 && a > 0){ d *= 2; a = Math.max(a-d, 0); fa = f(a); } } }
        else { fa = f(a); fb = f(b); }
        if(fa <= 0){ land(a); continue; }
        if(fb >= 0){ land(b); continue; }
        // regula falsi with the Illinois halving
        for(let k=0;k<30;k++){
          const c = (a*fb - b*fa)/(fb - fa), fc = f(c);
          if(Math.abs(fc) < tol){ a = b = c; break; }
          if(fc > 0){ a = c; fa = fc; if(side === 1) fb /= 2; side = 1; }
          else       { b = c; fb = fc; if(side === -1) fa /= 2; side = -1; } }
        land((a+b)/2); }
      if(moved < 1e-5) break; }
    P.fregSeed = Object.assign({}, S.fregBy);
    /* the settle's answer is where the motor already is, so a commissioned plant is not walking anywhere */
    for(const id in S.fregBy) S.fregDemBy[id] = S.fregBy[id];
    // the field, the pumps' own flows and the pressures at the valves as finally left, not at the last trial
    netHoldStore(false);
    if(ids.length) solveFeed(); }
  layRelease();
  /* the condenser sits on the water that actually arrives: condRest() is only the bench's estimate, and the settled field is what the tick will read */
  { const ids = condIds(), n = ids.length;
    for(const id of ids){ const t = cwInOf(S, rf, id); if(t !== undefined) S.cwInTBy[id] = t; }
    let boilQ = 0; for(const id of sgIds()) boilQ +=
      Math.max(0, (S.steamBy[id]||0) - bleedOf(S,id))*riseCond(S, id, secP(S,id));
    const qAll = Math.max(0, boilQ - S.turbWk*turbDh(S.turbP, condP(S))*P.eff);
    for(const id of ids){ const c = cwCOf(S,id),
      eps = c>0 ? 1-Math.exp(-condUA(id)*condKOf(S,id)/c) : 0;
      if(c>0 && eps>0) S.condTBy[id] = cwInAt(S,id) + qAll/n/(c*eps);
      /* the water actually in it beats the design estimate: a sink spliced into a hot leg is full of that leg, and condRest() would pin it at a vacuum */
      const t = netTempAt(S, condVesNode(id));
      if(t !== undefined && isFinite(t)) S.condTBy[id] = Math.max(S.condTBy[id], t);
      S.condPBy[id] = Math.max(COND_P0, psatSec(S.condTBy[id])); }
    const mi = cwInMean(S); if(mi !== undefined) S.cwInT = mi;
    const mt = condTMean(S);  if(mt !== undefined) S.condT = mt; }
  /* the board is swept on a cadence from here on, so tick zero is swept by hand or a plant commissioned with a tile lit reads blank until the fifth tick */
  laySettle(); annStep(S); layRelease();
  /* what this loop holds, baked once off the settled field: derived every tick, a plant that has lost a third of its water would read 100 % of a smaller loop */
  massSeed(S);
  P.invKg0 = invNodesKg(S); coreEach(S,(cs,K,id)=>{ K.invKg0 = invNodesKg(S, id); });
  /* what each pump was lifting when it was built, kg/m3 at its own suction - taken after the settle, so the figure the plant is rated on is at 1.000 */
  P.pumpRho0 = {}; for(const id of pumpIds()) P.pumpRho0[id] = netRhoAt(S, pumpSucNode(id));
  // and the VESSEL's own commissioned charge, which is what a leak is measured against (vLeak)
  { const nm = P.net.name[P.net.coreNode]; P.coreKg0 = S.mBy[nm] !== undefined ? S.mBy[nm] : 0;
    coreEach(S,(cs,K,id)=>{ const m = S.mBy[coreFold(id)]; K.coreKg0 = m !== undefined ? m : 0; }); }
  if(P.invKg0 > 0) S.inv = 100*invNodesKg(S)/P.invKg0;
  coreEach(S,(cs,K,id)=>{ if(K.invKg0 > 0) S.invBy[circKey(K.circ)] = 100*invNodesKg(S, id)/K.invKg0; });
  LOG=[]; initHist();
  if(typeof pipeReset==="function") pipeReset();
  if(typeof fxReset==="function") fxReset();
  blkSeedOuts(S);
  logE("info","PLANT AT POWER",
    P.name+" commissioned at "+P.rated.toFixed(0)+" MWt, holding "+(P.n0*100).toFixed(1)+"% - pipe run and pump head decide how much of the rating the loop can actually carry. Everything that happens from here is logged with the reason.");
}
/* the one door for the built-in law and a wired ROD DRIVE sink; the increment is capped at what the drive delivers in a tick, and split, the same error reaches every bank left on AUTO, deliberately undivided */
function rodApply(s,cs,K,step,dt){
  const rodErr = clamp(step, -rodRate(K)*dt, rodRate(K)*dt);
  const rodLo=clamp(s.arLo,0,1), rodHi=clamp(Math.max(s.arHi,s.arLo),0,1);
  /* set where the clamp actually bites, never inferred from the position: a bank parked on the band edge with T-avg on programme is obeying */
  cs.rodBand=false;
  const pinned=(want,got)=>{
    if(Math.abs(want-got)>1e-9 && Math.abs(TavgOf(s,K.circ)-tProg(s,K,cs))>0.5) cs.rodBand=true; };
  if(!cs.split && bankAutoLive(cs,0)){                // ganged: one controller, one bank
    const want=cs.rodDem+rodErr;
    cs.rodDem=clamp(want, rodLo, rodHi);
    pinned(want,cs.rodDem);
  } else if(cs.split && !cs.reGang){
    for(let b=0;b<K.NB;b++)
      if(bankAutoLive(cs,b)){ const want=cs.rodZDem[b]+rodErr;
        cs.rodZDem[b]=clamp(want, rodLo, rodHi);
        pinned(want,cs.rodZDem[b]); }
  }
}
function step(dt){
  netMarching(true);
  try { stepMarch(dt); } finally { netMarching(false); }
}
function stepMarch(dt){
  const s=S; s.t+=dt; s.tick++;
  if(!s.massOut) s.massOut={};
  const ledgM0 = ledgerKg(s), ledgO0 = ledgerOut(s);
  /* settle the node graph for this tick; the hold is dropped on the last line of this function, so it never outlives the tick */
  laySettle();
  /* the player's automation reads last tick's solved plant and writes this tick's demands - see ctl.js */
  ctlPass(s,dt);
  /* the feed regulating valve is an actuator like every other: the controller writes demand and the motor gets there at VALVE_RATE. Teleported, it is a step change in a line that has mass, which is the one thing a real MOV cannot do. */
  for(const id in s.fregBy){ const dv=(s.fregDemBy[id]??s.fregBy[id])-s.fregBy[id];
    if(dv) s.fregBy[id]+=Math.sign(dv)*Math.min(Math.abs(dv),VALVE_RATE*dt); }

  coreEach(s,(cs,K,id)=>{
  if(!sinkDriver(s,"rodStep",id)) cs.rodBand=false;   // nobody is on the drive, so nobody is out of authority

  /* the banks are driven together, never teleported; the mode stays SPLIT until they have all arrived */
  if(cs.reGang){
    let done=true;
    for(let b=0;b<K.NB;b++){
      cs.rodZDem[b]=clamp(cs.rodDem+K.bankW[b]*XTILTZ*cs.tilt,0,1);
      if(Math.abs(cs.rodZ[b]-cs.rodZDem[b])>1e-6) done=false;
    }
    if(done){ cs.split=false; cs.reGang=false; }
  }

  /* a latched trip owns every bank, and this sits after the reganging block so a scram wins */
  if(cs.scrammed){ cs.rodDem=1; cs.rodZDem.fill(1); }

  /* one motor, one speed, whichever mode it is in; a jam freezes the lot */
  if(!cs.rodJam){
    const r=cs.scrammed?K.scram:rodRate(K);
    if(cs.split) for(let b=0;b<K.NB;b++){ const d=cs.rodZDem[b]-cs.rodZ[b];
      cs.rodZ[b]+=Math.sign(d)*Math.min(Math.abs(d),r*dt); }
    else { const d=cs.rodDem-cs.rodPos;
      cs.rodPos+=Math.sign(d)*Math.min(Math.abs(d),r*dt); }

    /* split, the per-bank demands are the tilt handle, so the trim stands still rather than fighting them */
    if(!cs.split){ const d=cs.tiltDem-cs.tilt;
      cs.tilt+=Math.sign(d)*Math.min(Math.abs(d),tiltRate(K)*dt); }
  }
  /* settle where each bank actually stands - the one place that decides it */
  rodBanks(K,cs);
  /* split, the master pair is a readout rather than a state; not while reganging, where rodPos is the frozen target the banks walk to */
  if(cs.split){
    let m=0; for(let b=0;b<K.NB;b++) m+=cs.rodZ[b];
    cs.rodPos=m/K.NB;                       // actual: the mean of where the banks are
    /* demand is the master's own command while reganging: deriving it back off the banks erases the order the moment it is given */
    if(!cs.reGang){ let d=0; for(let b=0;b<K.NB;b++) d+=cs.rodZDem[b]; cs.rodDem=d/K.NB; }
  }
  });

  /* boron is an actuator: the slider writes demand, the loop gets there at the rate a charging pump can push */
  { const db=s.boronDem-s.boron, rb=(db<0?BOR_IN:BOR_OUT)*dt;
    const d=Math.sign(db)*Math.min(Math.abs(db),rb);
    s.boron+=d;
    /* the charging system reaches what the core reaches: every node in its live piece takes the same step, an isolated leg none of it */
    if(d && P.net && s.bBy){ const pc=netPieces(P.net,s), cps=corePieces(P.net,s);
      for(let i=0;i<P.net.n;i++) if(cps.has(pc.of[i])){ const nm=P.net.name[i];
        if(s.bBy[nm]!==undefined) s.bBy[nm]+=d; } } }

  /* a throttle is an actuator too: the panel writes demand, the motor gets there at VALVE_RATE */
  for(const id in s.valve){ const dv=s.valveDem[id]-s.valve[id];
    s.valve[id]+=Math.sign(dv)*Math.min(Math.abs(dv),VALVE_RATE*dt); }

  s.load += (s.loadDem-s.load)*Math.min(dt/LOAD_TAU,1);

  coreEach(s,cs=>{ let d=0;
    for(let i=0;i<DEC_A.length;i++){
      cs.dec[i] += DEC_L[i]*(DEC_A[i]*cs.n - cs.dec[i])*dt;
      d += cs.dec[i];
    }
    cs.decay = d; cs.heat = cs.n*PROMPT_F + cs.decay; });
  coreAgg(s);
  const heat = s.n*PROMPT_F + s.decay;


  /* scratch, not sim state: rebuilt fresh every tick, so a local rather than a field on S */
  const runFlow = {};
  /* MPa per node, taken off netFlowK()'s own solve so the tick pays for one solve and not two; pAt() is how every reader below asks it */
  const pField = {};
  /* what the solve found leaving the plant through every opening on it */
  const netOut = {};
  const pumpK = netFlowK(s, runFlow, pField, netOut);
  const coreFN = {}; coreEach(s,(cs,K,id)=>{ coreFN[id] = coreFlowNet(K, id, netOut, pumpK); });
  /* what the circulating water is doing, off this tick's own solve; the condenser's balance reads it through cwKOf() */
  { for(const id in s.cwFlowBy) if(!partOf(id)) delete s.cwFlowBy[id];
    for(const id of condIds()) s.cwFlowBy[id] = cwFlowOf(runFlow,id); }
  /* this run against its own reference, signed: 1.0 is what it was built to carry, the direction is the solve's */
  const runRatio = key => { const r = Math.abs(P.netRefByRun[key]||0);
    return r > 1e-9 ? (runFlow[key]||0)/r : 0; };
  /* the solved outflow through every opening, charged to inventory through the one flow-to-inventory conversion */
  const spill = invRate(netOut.spill||0);
  /* what each opening is passing, % of loop inventory per second, keyed by the opening's own key - the one figure every pressure-driven effect reads */
  { const by = netOut.by || {};
    for(const k in s.spillBy) if(!(k in by)) delete s.spillBy[k];
    for(const k in by) s.spillBy[k] = invRate(by[k]); }
  s.spillRate = spill;
  /* kept apart from `spill` at the edge (ed.sec, pipenet.js), because everything below charges spill to s.inv */
  const spillSecKg = netOut.spillSec||0;
  /* what the tank actually pushed against the loop it is fighting; signed, because the same edge run backwards fills it */
  const qTankBy = netOut.qTankBy || {};
  /* the positive half of the same signed figure: a tank being filled is not injecting, and summing the two lets one tank hide behind another */
  let inj = 0;
  const injIds = [];               // which tanks, for the log - a local, never on S
  for(const k in s.tankRate) if(!D.tanks[k]) delete s.tankRate[k];
  for(const tid of tankIds()){
    const q = invRate(qTankBy[tid]||0);
    /* the raw signed figure: a tank being filled reads negative on purpose, and only "is anything injecting" needs the noise floor */
    s.tankRate[tid] = q;
    /* inj is what the primary is taking - it feeds vessel fatigue and the injection log line */
    if(tankPrimary(tid) && tankInjecting(tid, q)){ inj += q; injIds.push(tid); }
  }
  // coreFold() first: a folded part has ONE node under its bare id, so a caller naming a face would fall through to the s.P default
  const pAt = n => { const v = pField[coreFold(n)]; return v===undefined ? s.P : v; };
  /* subcooling at a place, on the circuit's own curve (satOfCirc(), pipenet.js) and never the primary's */
  const scAt = n => tsatSec(pAt(n), circOfNode(coreFold(n))) - netTempAt(s, n);
  /* a readout, like s.sc and s.heat: on S because the panel prints it and a snapshot must carry what the panel was showing */
  coreEach(s,(cs,K,id)=>{ cs.pCore = pAt(id); });
  s.pCore = pAt(primaryCore());
  /* after the pressures settle and before the SGTR, the feed train and the relief valves read a temperature anywhere */
  keepPField(s, pField);
  pressRead(s, dt);
  /* a run lets go at its own wall, one cell into s.dmgParts, so the hole, the plume, the repair party and the ledger are the mechanism the plant already had */
  /* judged at the run's own node, never pAt()'s s.P fallback: a node the field does not carry is a node nobody can say the pressure at, and that run is not judged */
  // cached on the net and DGEN, because runDesignP() walks every tank and pump and this asks it of every run
  const net = P.net;
  if(net.burstGen !== DGEN){ net.burstP = {}; net.burstGen = DGEN; }
  for(const r of pipeNetwork()){
    if(!r.cells || !r.cells.length) continue;
    const pa = pField[runNodeOf(r.key)];
    if(pa === undefined) continue;
    const pBurst = net.burstP[r.key] ?? (net.burstP[r.key] = runBurstP(r));
    if(pa <= pBurst) continue;
    /* a run that is already open does not split twice, or the die is re-rolled every tick and eats the pipe cell by cell */
    let open = false;
    for(const [cx,cy] of r.cells) if(cellBroken(s,cx,cy)){ open = true; break; }
    if(open) continue;
    /* where it splits is a die (DICE.burstCell), uniform over its own cells; stood down it takes the run's first */
    const n = r.cells.length;
    const c = s.diceOff ? r.cells[0]
                        : r.cells[Math.min(n-1, Math.floor(srand(s)*n))];
    const id = "pipe:"+c[0]+","+c[1];
    if(s.dmgParts.indexOf(id) >= 0) continue;
    s.dmgParts.push(id);
    s.dmgWhy[id] = "BURST";
    const fx = dmgFx(id);
    logE("alarm","PIPE BURST / "+fx.msg,
      pipeName(r)+" has split at "+c[0]+","+c[1]+" - "+pa.toFixed(2)+
      " MPa against a wall rated for "+runRating(r).toFixed(2)+" MPa. "+fx.why);
  }
  /* a wall lets go at its own SHAPE, not its own cell: stress is p*R/t on half the flat span drawn (matSpan(), paint.js). One cell per event, and unlike a pipe it may break again */
  for(const g of matRegionsBounded()){
    const pReg = regionDP(s, g);
    let lo = Infinity, tie = [];
    for(const i of g.wall){ const x=i%GW, y=(i/GW)|0;
      if(s.dmgParts.indexOf("mat:"+x+","+y) >= 0) continue;
      const m = matBurstP(x,y) - pReg;
      if(m < lo - 1e-9){ lo = m; tie = [[x,y]]; }
      else if(m < lo + 1e-9) tie.push([x,y]); }
    if(!tie.length || lo > 0) continue;
    // stood down, it takes the first in board order, as the pipe's own burst does
    const c = s.diceOff ? tie[0]
            : tie[Math.min(tie.length-1, Math.floor(srand(s)*tie.length))];
    const id = "mat:"+c[0]+","+c[1];
    s.dmgParts.push(id);
    s.dmgWhy[id] = "BURST";
    const fx = dmgFx(id);
    logE("alarm","CONTAINMENT FAILURE / "+fx.msg,
      "The wall at "+c[0]+","+c[1]+" has let go - "+(pReg*1000).toFixed(0)+
      " kPa across it against a cell that bursts at "+(matBurstP(c[0],c[1])*1000).toFixed(0)+
      " kPa. It is the middle of a "+(matSpan(c[0],c[1])*MPC).toFixed(1)+
      " m flat span, which is why it was the cell that went. "+fx.why);
  }
  advectStep(s, dt, runFlow, netOut && netOut.edgeKg);
  /* s.inv is a read: every way water leaves is an edge, already booked by the transport pass above, and nothing downstream writes it */
  if(P.invKg0 > 0) s.inv = 100*invNodesKg(s)/P.invKg0;
  if(!s.invBy) s.invBy = {};
  coreEach(s,(cs,K,id)=>{ if(K.invKg0 > 0) s.invBy[circKey(K.circ)] = 100*invNodesKg(s, id)/K.invKg0; });
  sumpStep(s, dt);

  /* cavitation begins where subcooling reaches zero, asked at the pump's own suction; fed to NEXT tick's solve, because a gate that depends on the answer cannot be part of the question */
  const cavIds = [];               // which pumps, for the log - a local, never on S
  { let worst=0;
    /* every pump at its own suction, keyed by its own id, so piping one badly costs that machine and no other */
    for(const id in s.cavP) if(!partOf(id)) delete s.cavP[id];
    /* it fills and clears over CAV_TAU: instantaneous, a pump reverses its own flow, restores its own suction and chatters */
    const kc = Math.min(dt/CAV_TAU, 1);
    for(const id of pumpIds()){
      const want = clamp(-scAt(pumpSucNode(id))/CAV_SPAN, 0, 1);
      if(s.cavP[id]===undefined) s.cavP[id]=want;
      s.cavP[id] += (want - s.cavP[id])*kc;
      const c = s.cavP[id];
      if(c>worst) worst=c;
      if(c>0.15) cavIds.push(id);
    }
    s.cav = worst; }
  /* what each pump is passing, through the casing edge and no other: a pump with a run on every face still has one swallow. A reading, never a head */
  { for(const id in s.pumpQBy) if(!partOf(id)) delete s.pumpQBy[id];
    for(const id of pumpIds()){
      const k = pumpEdgeKey(id); if(!k) continue;
      const q = runFlow[k] || 0;
      s.pumpQBy[id] = q > 0 ? netKgs(q) : 0; } }
  /* losing power does not stop a pump dead, it coasts; the backup supply carries the share of pump power the bench sold, scaled off demand */
  { const k = Math.min(dt/FLOW_TAU,1);
    const live = {};
    for(const id of pumpIds()){ live[id]=1;
      if(s.flowDemBy[id]===undefined) s.flowDemBy[id]=1;             // a pump placed mid-run arrives at rated
      /* a standby pump follows its reserve's own valve rather than carrying a second rule, so s.tankByp defeats both with one switch */
      { const r = pumpResOf(id);
        if(r.length) s.flowDemBy[id] = r.some(t=>tankOpen(s,t)) ? 1 : 0; }
      if(s.flowBy[id]===undefined) s.flowBy[id]=s.flowDemBy[id];
      const N = s.flowBy[id], want = supplyK(s)*s.flowDemBy[id];
      // up on the motor; down on the rotor, never below what the motor still holds
      s.flowBy[id] = want >= N ? N + (want - N)*k
                               : Math.max(want, N - (N*N/(2*pumpRotor(id)) + N/PUMP_FRIC_S)*dt); }
    for(const id in s.flowBy) if(!live[id]){ delete s.flowBy[id]; delete s.flowDemBy[id]; } }

  /* the pump's speed is part of its own head inside the solve, so pumpK already carries it - and has to, or a coasted-down pump would multiply the thermosiphon by zero */
  const driven = P.flowK * pumpK;
  /* buoyancy is an edge head inside the solve; what is left here is the readout, the share of this tick's flow the plant developed with every pump doing nothing */
  s.nat = netOut.nat || 0;
  /* each generator's share of the primary flow, with last tick's level riding inside it (sgFill); algebraic, it is a fixed point that oscillates */
  const sgW = sgShare(netOut.byLoop);
  /* fed to NEXT tick's solve, where secP() reads it: this tick's share comes out of this tick's solve, so it cannot also be an input to it */
  for(const k in s.sgShare) if(!sgW.hasOwnProperty(k)) delete s.sgShare[k];
  for(const k in sgW) s.sgShare[k] = sgW[k];
  /* the one flow figure the enthalpy rise is divided by */
  const flowFrac = Math.max(s.flowNet, CORE_DT_QMIN);
  /* DNBR cares how fast the water moves past the pin, never how much heat left the loop, so it is shown the flux and never the removal */
  const mflux = driven;

  const dump = dumpOf(s);
  const vNow = clamp(s.vf,0,1.5);
  /* heat crosses on a temperature difference: a conductance times a difference, with slow water, void and a dry shell all properties of the conductance. The tube flow is against the loop's own reference (pumpK), never the rating the core was drawn for */
  const nSG = Math.max(1, Object.keys(sgW).length);
  const filmK = (1-0.85*Math.min(vNow,1));
  const sgQBy = {};
  let qTot = 0;
  for(const id in sgW){
    const fl = Math.max(pumpK*sgW[id]*nSG, 0.02);
    /* the 0.02 floor is stagnant water in tubes the loop still reaches; isolate the generator and no water crosses at all */
    const q  = stageFed(P.net,s,id) ? sgQAt(s,id,fl,filmK,runFlow) : 0;
    sgQBy[id] = q;
    /* heat leaving the core is what crosses the stage the core's own water reaches, never one behind a barrier */
    if(sgActive(id)) qTot += q;
  }
  /* both ends are real nodes, so this is the counterflow law and not a pot: what it takes off one circuit it gives the other in the same tick */
  for(const id in s.ihxQBy) if(!partOf(id)) delete s.ihxQBy[id];
  for(const id of ihxIds()){
    const q = stageFed(P.net,s,id) ? ihxQAt(s,id,runFlow) : 0;
    s.ihxQBy[id] = q;
    if(sgActive(id)) qTot += q;
  }
  /* a panel cools what it is plumbed to, against the water arriving at it - which end comes off the solve's own sign, never a face label. It is debited only where the live piece reaches the core */
  { const IN = ROLE.radiator.internal, key = k => "comp:"+k+":"+IN.a+IN.b;
    for(const id in s.radTBy) if(!partOf(id)) { delete s.radTBy[id]; delete s.radQBy[id]; }
    for(const id of radIds()){
      /* no commissioned flow through it, no duty: a panel hung off one line solves at 1e-14 of reference, which is a difference of large numbers and not a flow */
      const ref = Math.abs(P.netRefByRun[key(id)]||0);
      const r = runRatio(key(id));
      const nIn = coreFold(id + (r >= 0 ? IN.a : IN.b));
      const fl = Math.max(Math.abs(r), 0.02);
      if(s.radTBy[id]===undefined) s.radTBy[id] = RAD_TDES;
      const q = (s.dmgParts.indexOf(id)>=0 || !radLive(id) || !(ref > 1e-9)) ? 0
        : radUAOf(id)*Math.pow(fl,UA_FLOW)*(1-0.85*clamp(netQualAt(s,nIn),0,1))
          * Math.max(0, netTempAt(s,nIn) - s.radTBy[id]);
      s.radQBy[id] = q;
      /* the live piece, never the drawn circuit: inCore() is a fact about the picture, and a panel behind a shut valve reaches nothing */
      if(corePieces(P.net, s).has(pieceOf(P.net, s, nIn))) qTot += q;
    } }
  const removal = qTot/(P.rated*1000);
  HEATBAL.prompt=s.n*PROMPT_F; HEATBAL.decay=s.decay;
  HEATBAL.heat=heat; HEATBAL.removal=removal;
  for(const id in HEATBAL.heatBy) if(!s.coreBy[id]) delete HEATBAL.heatBy[id];
  coreEach(s,(cs,K,id)=>{ HEATBAL.heatBy[id]=cs.heat; });
  for(const id in HEATBAL.sgQBy) if(!(id in sgQBy)) delete HEATBAL.sgQBy[id];
  for(const id in sgQBy) HEATBAL.sgQBy[id]=sgQBy[id];
  /* the display balance only: s.dTavg and s.Tavg are both reads (advectStep) */
  HEATBAL.dTavg=s.dTavg;

  /* every loop pressure is a read (pressRead()); what is left of the pressurizer is the machine, heaters and a spray at its own node */
  let vented = 0;
  if(!s.breach){
    /* live, a hold tank IS the loop and reads its number; cut off it keeps the last one, so the tick a valve shuts the two are still equal */
    for(const id of holdTankIds()){
      const ci = tankCircuit(id);
      if(ci === null || ci === undefined || ci < 0) continue;
      if(holdLive(P.net, s, ci)) s.holdPBy[id] = loopP(s, ci);
    }
    /* every relief path rolls its own die on its own lift; s.reliefArm beats it and is consumed by the lift it arms. Vented mass is the solved edge flow, so a filling tank throttles the vent by its own node pressure alone */
    let ventLoose = 0;
    for(const fid in s.reliefVent) delete s.reliefVent[fid];
    for(const fid of reliefPriIds()){
      s.reliefVent[fid]=0;
      if(fitSpring(fid)) springStep(s,fid,(n=>n===null?s.P:pAt(n))(reliefNodeOf(P.net,fid)));
      if(!s.reliefOpen[fid] || s.reliefBlocked[fid]) continue;
      const rate = Math.max(0, invRate((netOut.reliefBy && netOut.reliefBy[fid]) || 0));
      const q = rate*dt;
      vented += q;
      s.reliefVent[fid]=rate;
      /* a fitting that reaches a tank fills nothing here: that tank's own node carries the identical current, and the level loop below charges it off the solve */
      if(!(P.net.fitTarget && P.net.fitTarget[fid])){
        s.release = Math.min(100, s.release + (rate/SGTR_RATE)*0.02*contRelPart(s,partOf(fid))*P.dose*dt);
        /* only the vent that reaches no tank is charged here; `vented` stays the total, because the blowdown is about every hole alike */
        ventLoose += q;
      }
    }
    /* not subtracted from s.inv: what a relief valve passes leaves through its own edge. Still booked, because the ledger's other side is what the plant lost */
    book(s,"reliefRoom", ventLoose/100*loopKg());
  }
  /* the rupture disc: past its own setpoint the tank is an opening to containment, latched, and what it dumps costs release in proportion to the activity of what was in it */
  for(const tid of tankIds()){
    const field = tankInField(tid), b = D.tanks[tid].burst;
    /* level points off the deck this tick: a vessel in the field lost them through its own break edge, which spillPri has already booked, and every other tank drains its own pool at HOT_DUMP */
    if(field){
      const out = 100*(advectOutKg["break:"+tid]||0)/tankKg(tid);
      const rel = partWrecked(s,tid) ? 1 : (s.burstBy[tid] && b) ? b.rel : 0;
      if(out > 0 && rel > 0)
        s.release = Math.min(100, s.release + out*rel*tankFluid(tid).act*contRelPart(s,partOf(tid))*P.dose*dt);
    }
    else if(!D.tanks[tid].hold && partWrecked(s,tid) && s.tank[tid] > 0){
      const out = Math.min(s.tank[tid], HOT_DUMP*Math.min(s.tank[tid],100)/100*dt);
      s.tank[tid] -= out;
      book(s,"tankWreck", out/100*tankKg(tid));
      s.release = Math.min(100, s.release + out*tankFluid(tid).act*contRelPart(s,partOf(tid))*P.dose*dt);
    }
    if(!b) continue;
    if(!s.burstBy[tid] && tankP(s,tid) >= b.at){
      s.burstBy[tid] = true;
      logE("alarm",D.tanks[tid].name+" DISC BURST",
        "The tank filled and its rupture disc let go. What was in it is on the containment floor and its activity is in the air, not behind a wall. This is the TMI-2 sequence.");
    }
    if(!field && s.burstBy[tid] && s.tank[tid] > 0){
      const out = Math.min(s.tank[tid], b.drain*dt);
      s.tank[tid] -= out;
      book(s,"burstDisc", out/100*tankKg(tid));
      s.release = Math.min(100, s.release + out*b.rel*tankFluid(tid).act*contRelPart(s,partOf(tid))*P.dose*dt);
    }
  }
  book(s,"spillPri", advectOutPri);   // the transport's own kilograms - see advectStep()
  s.injRate = inj;
  /* an inexhaustible tank is the one primary vessel with a level that does not move, so it is the only one with a term: everything else on the core's circuit keeps its water in s.mBy and is metered by the transport like any other node */
  for(const id of tankIds()){
    if(!D.tanks[id].inf || !tankPrimary(id)) continue;
    /* what the TRANSPORT took off it, never the solve's edge; s.tankRate above stays the solve's, because it is the gauge and not the book */
    // a boundary, so what crossed its edge came from outside the books - negative is the plant being fed
    book(s,"boundaryTank", advectLanded(P.net && P.net.tankNode[id]));
  }
  /* each rule's own state, fed forward like s.cavP: this tick's answer is what the next tick's hysteresis reads */
  for(const id of tankIds()){
    const r = AUTORULE[D.tanks[id].auto];
    s.tankAuto[id] = !!(r && r.live(s,id));
  }
  if(inj>0) coreEach(s,cs=>{ cs.fatigue += 0.35*dt*clamp(inj/1.6,0,2); });
  /* a tube rupture at whatever the differential says; clamped at zero only for the release, because water crossing back the other way carries no primary activity */
  { const leak = Math.max(0, invRate(netOut.qSgtr||0));
    s.sgtrRate = leak;
    const sby = netOut.sgtrBy || {};
    for(const k in s.sgtrBy) if(!(k in sby)) delete s.sgtrBy[k];
    for(const k in sby) s.sgtrBy[k] = Math.max(0, invRate(sby[k]));
    /* charged per generator, because only tubes holding the core's own water cost release and the wall is per generator too */
    let hot = 0;
    for(const k in s.sgtrBy){ const id = k.slice(5);
      if(sgActive(id)) hot += s.sgtrBy[k]*contRelPart(s, partOf(id)); }
    if(hot>0) s.release = Math.min(100, s.release + (hot/0.30)*0.02*P.dose*dt); }
  // the raw edge, not s.sgtrBy: the clamp above throws away the sign, and on a sodium plant the sign IS the accident
  sgReactStep(s, dt, netOut.sgtrBy || {});
  /* asked at each vessel, not at the pressurizer: what bursts a vessel is the pressure inside it */
  coreEach(s,(cs,K,id)=>{
    const burst = burstPOf(K,cs);
    if(K.tube){ tubeStep(s,cs,K,id,burst); return; }
    if(!cs.breach && cs.pCore > burst){ cs.breach=true; cs.trip="VESSEL RUPTURE"; } });
  /* the core boils at ITS OWN pressure, not the pressurizer's; s.vf, s.Tf, s.X and s.I below are whole-core aggregates of a field */
  coreEach(s,(cs,K,id)=>{
  const sat = satT(K.sat, cs.pCore), nid = coreFold(id);
  /* the vessel's own node says how short of water it is: (1 - m/m0)/(1 - rvl), never the node's own quality, which a boiling core's vessel carries by design */
  const vLeak = (() => { const m = s.mBy[nid];
    // a gas has no liquid to be short of: its mass follows p/T and a warm vessel is not a void
    if(!(K.coreKg0 > 0) || m === undefined || (K.sat.tc && K.Tref > K.sat.tc)) return 0;
    return Math.max(0, (1 - m/K.coreKg0)/Math.max(1 - satRvl(K.sat, cs.pCore), 1e-3)); })();
  // this tick's flux past the pin, and LAST tick's share for the rise, exactly as the plant figures were ordered
  const nod = coreStep(K,cs,dt,cs.heat,sat,vLeak,K.flowK*coreFN[id],Math.max(cs.flowNet,CORE_DT_QMIN),TavgOf(s,K.circ));
  cs.fci = nod.fci;
  /* the hydrogen the clad made arrives at the vessel's own node as a concentration, and rides the transport from then on */
  if(nod.h2 > 0 && s.h2By && P.net && P.net.index[nid] !== undefined){
    const i = P.net.index[nid];
    const m = s.mBy[nid] !== undefined ? s.mBy[nid] : P.net.vol[i]*netRhoAt(s, nid);
    if(m > DRY_MIN_KG){ s.h2By[nid] = (s.h2By[nid]||0) + nod.h2/m; s.h2 = h2Total(s); } }
  cs.voidTh = cs.vNode;
  /* the node fraction stops at 1 and vLeak runs past it on purpose, because s.vf says how far past empty the loop is */
  cs.vf = clamp(Math.max(vLeak, cs.voidTh), 0, 1.6);
  { const p=cs.parts;
    p.rod=nod.rod; p.dop=nod.dop; p.mod=nod.mod; p.exp=nod.exp; p.xe=nod.xe; p.vd=nod.vd;
    p.tip=nod.tip; p.dis=nod.dis; p.bor=s.boron;
    cs.rho=K.excess+p.rod+p.dop+p.mod+p.exp+p.xe+p.bor+p.vd+p.tip+p.dis; }
  });
  coreAgg(s);

  /* margin to boiling is measured where the water is hottest, once per circuit; refilled, and s.sc stays the primary's entry */
  for(const ci of holdCircs()){
    /* the hottest node that is still LIQUID: a pressurizer's bubble reads zero margin by definition, and the surge line under it is its own saturated water (holdLineSet) */
    let worst, hot = -Infinity;
    const ownWater = holdLineSet();
    for(let i=0;i<P.net.n;i++){ const nm = P.net.name[i];
      if(circOfNode(nm) !== ci || netBooked(P.net)[i]) continue;
      if(ownWater.has(nm) || netQualAt(s, nm) > 0) continue;
      const T = netTempAt(s, nm);
      if(T > hot){ hot = T; worst = nm; } }
    s.scBy[ci] = scAt(worst || holdOnCirc(ci)[0] || coreOnCirc(ci)[0] || primaryCore()); }
  const sc = s.scBy[nodeGraph().coreCirc];
  s.heat = heat; s.sc = sc;              // tripCause() reads these outside the tick
  /* what a flow meter would read, never what the pump dial was set to: LOW FLOW has to trip on the delivered figure or shutting every valve trips nothing */
  s.flowNet = pumpK; coreEach(s,(cs,K,id)=>{ cs.flowNet = coreFN[id]; });
  const ids = sgIds();
  for(const id in s.fregBy) if(!sgW.hasOwnProperty(id)) delete s.fregBy[id];
  for(const id in s.fregDemBy) if(!sgW.hasOwnProperty(id)) delete s.fregDemBy[id];
  /* both latched here, ahead of the stop valve, because both are the stop valve's answer; the vacuum never comes back but the trip re-latches on a whole, clear machine */
  if(!s.condLost && condP(s) >= COND_ATM){ s.condLost = true;
    logE("alarm","CONDENSER VACUUM LOST",
      "The condenser has reached atmospheric pressure and relieved. It is open to the room, it will not hold vacuum again, and it has stopped being a heat sink. What the bypass still passes into it goes overboard, and the rest backs up onto the generators' safety valves."); }
  if(!s.turbTrip && condP(s) > TURB_TRIP_P){ s.turbTrip = true;
    logE("alarm","TURBINE TRIP",
      "Exhaust pressure past what the machine will run against. The stop valve is shut. The reactor is still making heat and the turbine is no longer taking any of it."); }
  else if(s.turbTrip && !s.condLost && !exhOpen(s) && roleAlive("turb",s) > 0
          && condP(s) < TURB_TRIP_P*TURB_RESET_K){ s.turbTrip = false;
    logE("info","TURBINE RELATCHED",
      "Exhaust pressure is back under the trip point and the machine is whole. The stop valve is open and the turbine is taking steam again."); }
  /* a hole in the exhaust breaks the vacuum rather than venting a shell; condP() carries it, so the drop, the stop valve and the MWe readout price one backpressure */
  const pCond  = condP(s);
  /* the governor is an opening (turbGate/turbCOf) on one edge of the one graph, so what each shell passes is what that solve says its own nozzle carried */
  const vapOut = netOut.sgSteamOutBy || {};
  /* the same machine as the primary's reliefs; the one difference is that a valve lifts on the pressure where it was drawn, and shellsOf() answers that off the drawing */
  const secVent = {};                     // per shell: kg/s its valves' vents are passing, off the transport
  for(const id in s.reliefSteam) delete s.reliefSteam[id];
  const ventKg = (()=>{ const by = {}, net = P.net;
    if(net && advectEdgeKg) for(let e=0;e<net.edges.length;e++){ const ed = net.edges[e];
      if(ed.kind === "vent" && advectEdgeKg[e] > 0) by[ed.key] = (by[ed.key]||0) + advectEdgeKg[e]; }
    return by; })();
  for(const fid of reliefSecIds()){
    const shells = shellsLive(s,fid);
    if(fitSpring(fid)) springStep(s,fid,reliefAtP(s,fid));
    /* what it passes is what its own edge carried, off this tick's own solve - the identical door the primary's reliefs read */
    s.reliefSteam[fid] = (!s.reliefOpen[fid] || s.reliefBlocked[fid]) ? 0
      : Math.max(0, (netOut.reliefBy && netOut.reliefBy[fid]) || 0);
    /* the exit is the vent, open whether or not the spring has lifted: the stub between seat and vent empties through it either way */
    const q = (ventKg["vent:"+fid]||0)/Math.max(dt,1e-9);
    if(!(q > 0)) continue;
    // one valve's kilograms are split over the shells it reaches by their own overpressure, never offered whole to each
    const back = regionPAt(s, partOf(fid));
    let tot = 0; for(const id of shells) tot += Math.max(0, secP(s,id)-back);
    for(const id of shells){ const over = Math.max(0, secP(s,id)-back);
      secVent[id] = (secVent[id]||0) + q*(tot>0 ? over/tot : 1/shells.length); }
  }
  let boiled = 0, boilQ = 0, bleedAll = 0;    // kg/s and kW, each shell at its own pressure - the condenser used to take the design rise
  for(const id in s.sgTBy)  if(!sgW.hasOwnProperty(id)) delete s.sgTBy[id];
  for(const id in s.sgPBy) if(!sgW.hasOwnProperty(id)) delete s.sgPBy[id];
  for(const id in s.sgFedBy) if(!sgW.hasOwnProperty(id)) delete s.sgFedBy[id];
  for(const id in s.sgBurst) if(!sgW.hasOwnProperty(id)) delete s.sgBurst[id];
  for(const id in s.steamBy)  delete s.steamBy[id];
  for(const id in s.sgVentBy) delete s.sgVentBy[id];
  if(ids.length) for(const id of ids){
    if(sgMassOf(id)<=0) continue;
    if(s.sgBurst[id]===undefined) s.sgBurst[id]=false;
    const nd = shellNode(id), ci = shellCirc(id);
    const shellP = secP(s,id);
    s.sgTBy[id] = tsatSec(shellP, ci);
    s.sgFedBy[id] = (netOut.sgFeedBy && netOut.sgFeedBy[id]) || 0;
    /* there is no lid that is not a placed box: past this the shell is open to atmosphere and stops raising pressure at all. Latched */
    if(!s.sgBurst[id] && shellP > sgBurstP(id)){
      s.sgBurst[id]=true;
      logE("alarm",nameOf(id)+" SHELL BURST",
        "The secondary shell has ruptured. It was raising steam faster than anything fitted could get rid of, and nothing was fitted to get rid of it. What is in it is going to atmosphere, it will not hold pressure again, and it stops cooling its loop the moment it is empty.");
    }
    /* the solved flow out of this generator's own nozzle; negative is steam arriving from a hotter machine down a shared header, which is why a header equalises */
    const open = sgOpen(s,id);
    const steamTo = open ? 0 : (vapOut[id] || 0);
    const vent = secVent[id] || 0;                           // its valves, off their own edges
    /* the shell's pressure is its NODE's, read once a tick: secP() is asked from inside the solve and may not see a half-solved field */
    s.sgPBy[id] = open ? regionPAt(s, partOf(id))
      : Math.max(COND_P0, (s.pBy && s.pBy[nd] !== undefined) ? s.pBy[nd] : shellP);
    /* booked and never subtracted, the sentence the primary's reliefs make (reliefRoom); a lifting valve takes some of the header's own holdup, so it may pass more than this shell sent up the pipe */
    const toCondCut = Math.min(vent, Math.max(steamTo, 0));
    book(s,"sgVent", vent*dt);
    s.steamBy[id]=steamTo;
    s.sgVentBy[id]=vent;
    if(s.fregBy[id]===undefined) s.fregBy[id]=0;
    if(s.fregDemBy[id]===undefined) s.fregDemBy[id]=s.fregBy[id];
    // what reached the CONDENSER is what left down the nozzle less what the valves took out of the header on the way
    { const avail = Math.max(0, steamTo - toCondCut), bleed = Math.min(bleedOf(s,id), avail);
      bleedAll += bleed;
      const toCond = avail - bleed;
      boiled += toCond; boilQ += toCond*riseCond(s, id, shellP); }
    /* a ruptured generator on its safety valve is putting primary water in the sky, charged by the share of its steam going overboard rather than to the condenser */
    if(vent>0 && sgtrLive(s,id) && sgActive(id)){
      const shr = vent/Math.max(steamTo+vent,1e-9);
      s.release = Math.min(100, s.release
        + shr*(Math.max(0,s.sgtrRate)/SGTR_RATE)*0.02*contRelPart(s,partOf(id))*P.dose*dt); }
  }
  /* what a lost vacuum is putting in the turbine hall is what the transport carried out of its own opening, off the same edge the books charge */
  s.condVent = !s.condLost ? 0
    : condSinks().reduce((m,id) => m + (advectOutKg["break:"+id]||0), 0)/Math.max(dt,1e-9);
  if(s.condVent > 0 && !s.condVentSeen){ s.condVentSeen = true;
    logE("warn","STEAM GOING OVERBOARD",
      "The turbine bypass is passing steam into a machine that is open to atmosphere, and the water going with it does not come back. The hotwell is draining and no valve on the plant is open."); }
  /* one number for the plant: what went round through the bypass did no work, and what crossed the wheels did it at the pressure the stop valve is seeing */
  s.turbWk = Math.max(0, (netOut.turbWk||0) - bleedAll);
  s.turbP  = netOut.turbWkA > 0 ? netOut.turbWkP/netOut.turbWkA : pCond;
  /* the exhaust space IS the pot: what arrives is the transport's, what leaves is condRejOf() on its own node (advectSrc), and both readings come off the field once a tick */
  { for(const id in s.condTBy) if(!partOf(id)) delete s.condTBy[id];
    for(const id in s.condPBy) if(!partOf(id)) delete s.condPBy[id];
    for(const id of condIds()){
      const p = s.pBy && s.pBy[condVesNode(id)];
      if(p !== undefined && isFinite(p))
        s.condPBy[id] = partWrecked(s,id) ? regionPAt(s, partOf(id)) : Math.max(COND_P0, p);
      /* one vessel, so one reading: the pressure is the backpressure and the temperature is what the tubes condense against */
      const t = netTempAt(s, condVesNode(id));
      if(t !== undefined && isFinite(t)) s.condTBy[id] = t; }
    const m = condTMean(s); if(m !== undefined) s.condT = m; }
  /* the panel climbs until its duty goes to 0 on the (Tin - Tpanel) term, so the chain stops itself; floored at T_SPACE, because nothing radiates below the sky */
  for(const id of radIds())
    s.radTBy[id] = potStep(s.radTBy[id], radCap_(id), s.radQBy[id]||0,
      radRejOf(s,id), skinQOf(s,id), dt, T_SPACE);
  /* fed forward one tick: what this machine rejects warms the water whose temperature decides what it can reject */
  { for(const id in s.cwInTBy) if(!partOf(id)) delete s.cwInTBy[id];
    for(const id of condIds()){ const t = cwInOf(s, runFlow, id);
      if(t !== undefined) s.cwInTBy[id] = t; }
    const m = cwInMean(s); if(m !== undefined) s.cwInT = m; }
  /* a reserve is metered against its own solved edge, signed, tank-out-positive, exactly the way every primary tank is charged */
  const resKg = id => advectLanded(P.net && P.net.tankNode[id])/Math.max(dt,1e-9);
  /* every secondary tank STANDING ON THE BOARD is metered against its own edge; a hosted one is the condensers' own water and no book at all */
  { for(const id in s.tankOver) delete s.tankOver[id];
    for(const id of secTankIds()){
      if(!D.tanks[id].cell) continue;
      const cap = Math.max(1, tankKg(id));
      const raw = s.tank[id] + 100*(resKg(id)||0)/cap*dt;
      /* past full it overflows and the overflow is gone: a silent clamp would swallow a tube rupture's whole inventory and report nothing */
      if(raw > 100) s.tankOver[id] = (raw-100)/100*cap/Math.max(dt,1e-9);          // kg/s
      if(!D.tanks[id].inf){ s.tank[id] = clamp(raw, 0, 100);
        book(s,"tankClampSec", (raw - s.tank[id])/100*cap); }
      else book(s,"boundaryTank", (resKg(id)||0)*dt);
    }
    // a hole in the secondary is a named opening; the condensers' own pool drains through one too
    if(secTankIds().length || condIds().length) book(s,"spillSec", advectOutSec);
  }


  /* floored at 1e-9 rather than a bare 0: the nodal core divides by the power it is given, and an exact zero NaNs every pellet temperature */
  coreEach(s,(cs,K)=>{
  const h=dt/4, rk=cs.rho*1e-5;
  for(let k=0;k<4;k++){
    let num=0,den=0;
    for(let i=0;i<6;i++){ const dd=1+h*K.lam[i];
      num+=K.lam[i]*cs.C[i]/dd; den+=K.lam[i]*h*K.bet[i]/K.LAM/dd; }
    const a=1-h*(rk-K.BETA)/K.LAM-h*den;
    let n=a>1e-6?(cs.n+h*num+h*2e-9)/a:cs.n*12;
    if(!isFinite(n)||n<0) n=cs.n*12;
    cs.n=Math.min(n,60);
    for(let i=0;i<6;i++) cs.C[i]=(cs.C[i]+h*K.bet[i]/K.LAM*cs.n)/(1+h*K.lam[i]);
  }
  cs.n=Math.max(cs.n,1e-9);

  /* DNBR is local, so the vessel's margin is the minimum over the field and nothing else */
  cs.dnbr=cs.dnbrMin;
  });

  /* what a hurt core COSTS; the damage itself was settled node by node in coreStep(), and every term here is continuous in how much of the core is hurt */
  coreEach(s,(cs,K,id)=>{
  if(!cs.melt && cs.meltFrac>=MELT_LATCH){ cs.melt=true; cs.trip="CORE MELT"; }
  if(cs.meltFrac>0 && !P.catcher){
    /* the only mass path on the plant that is not an edge, taken off the core's own node so the field and the ledger see the same kilogram - and it may only take what is there */
    { const want = MELT_INV*cs.meltFrac*dt/100*loopKg(), nm = coreFold(id);
      const have = s.mBy[nm];
      const kg = have === undefined ? 0 : Math.min(want, Math.max(have, 0));
      if(have !== undefined) s.mBy[nm] = have - kg;
      book(s,"melt", kg); }
    cs.fatigue=Math.min(100,cs.fatigue+MELT_FAT*cs.meltFrac*dt); }
  { const st=fuelStages(cs); let rel=0;
    for(let q=0;q<FAIL.length;q++) rel+=st[q]*RELK[FAIL[q].k];
    /* held back by the region this vessel's fuel stands in, read off the LIVE fill, so a wall with a cell shot out stops holding the instant it opens */
    if(rel>0) s.release=Math.min(100,s.release+rel*contRelPart(s,partOf(id))*P.dose*dt); }
  });
  coreAgg(s);

  /* a live field, solved fresh every tick and never stored: a snapshot is a clone of S, and a Float64Array in a module global would not survive a restore */
  { const f=radSolve(P.radK,radSrc(s));
    s.doseRate = radAt(f,P.radK.crew);
    s.crewDose = Math.min(100, s.crewDose + s.doseRate*RAD_CREW_K*dt);
    /* radParty() wants the coldest free cell next to the job, never the job's own footprint; no party out, no rate */
    s.repRate  = s.repair ? repairRadRate(f, s.repair.id) : 0; }

  roomStep(s, dt);
  /* what the blast costs: instantaneous, not integrated, so a machine either survives the peak its own cells saw or it does not */
  { /* the bang is its own event, latched on s.burnEv so it fires once per passage, at the peak that first threatens the weakest machine */
    if(!s.burnEv.blast && s.roomPMax >= minPburst()){
      s.burnEv.blast = 1;
      logE("alarm","EXPLOSION IN THE COMPARTMENT",
        "A hydrogen charge has gone off - "+s.roomPMax.toFixed(0)+
        " kPa above ambient, against the "+minPburst().toFixed(0)+
        " kPa the weakest machine on this plant is built for. The compartment relieves itself in about half a second, so what it costs is decided now.");
    }
    const crushLive = {};
    /* the bang is judged on what the burn put ON TOP of the volume's own static pressure (roomBlastAt), never on s.roomP itself */
    const gauge = roomPGauge(s);
    for(const p of LAY.parts){
      const lim = partPburst(p);
      if(!lim || !fitted(p)) continue;
      crushLive[p.id] = 1;
      if(s.dmgParts.indexOf(p.id) >= 0){ s.roomCrush[p.id]=0; continue; }
      const pk = roomPAt(s,p), bang = (s.roomBurnOn || s.roomFireOn || s.roomBang) ? roomBlastAt(s,p,gauge) : 0;
      const blast = bang >= lim;
      const clim = lim*ROOM_CRUSH_K;
      if(blast) s.roomCrush[p.id]=0;
      else if(!hurtStep(s.roomCrush, p.id, (pk-clim)/(clim*ROOM_CRUSH_SPAN), ROOM_CRUSH_TAU, dt)) continue;
      s.dmgParts.push(p.id);
      s.dmgWhy[p.id] = blast ? "BLAST" : "CRUSHED";
      const fx = dmgFx(p.id);
      if(fx.hit) fx.hit(s, p.id);
      // only a blast is charged to the deflagration line, or a squeezed pump is listed among what an explosion took
      if(blast) s.burnEv.ids.push(p.name);
      logE("alarm",(blast?"BLAST DAMAGE / ":"OVERPRESSURE DAMAGE / ")+fx.msg,
        p.name+(blast
          ? (s.roomBang ? " has been wrecked by the reactor shield lifting - " : " has been wrecked by a hydrogen explosion in the compartment - ")
          : " has been crushed by the compartment it is standing in - ")+
        (blast?bang:pk).toFixed(0)+" kPa against the "+(blast?lim:clim)+" kPa it was built for. "+
        (blast ? "" : "This is not a bang: the region round it is holding that pressure, and it will take the next machine too until something relieves it. ")+fx.why);
    }
    for(const q of cellHazards()){
      /* a painted cell is not here: the wall sweep already judges it against its own shape-rating, and this loop would take it in board order instead */
      if(q.lim) continue;
      crushLive[q.id] = 1;
      if(s.dmgParts.indexOf(q.id) >= 0){ s.roomCrush[q.id]=0; continue; }
      const ci = q.y*GW+q.x, pk = s.roomP[ci], bang = (s.roomBurnOn || s.roomFireOn || s.roomBang) ? pk-gauge[ci] : 0;
      const blast = bang >= PIPE_PBURST;
      const clim = PIPE_PBURST*ROOM_CRUSH_K;
      if(blast) s.roomCrush[q.id]=0;
      else if(!hurtStep(s.roomCrush, q.id, (pk-clim)/(clim*ROOM_CRUSH_SPAN), ROOM_CRUSH_TAU, dt)) continue;
      s.dmgParts.push(q.id);
      s.dmgWhy[q.id] = blast ? "BLAST" : "CRUSHED";
      const fx = dmgFx(q.id);
      if(blast) s.burnEv.ids.push(q.what);
      logE("alarm",(blast?"BLAST DAMAGE / ":"OVERPRESSURE DAMAGE / ")+fx.msg,
        (blast ? (s.roomBang ? "The reactor shield lifting has taken " : "A hydrogen explosion has taken ") : "Sustained overpressure in the compartment has taken ")+
        q.what+". "+fx.why);
    }
    for(const id in s.roomCrush) if(!crushLive[id]) delete s.roomCrush[id];
    s.roomBang=0;   // a lift is one tick's bang; the pressure it left relaxes with the rest
  }
  /* the room pushing in is above; this is the plant pushing out, judged on the CIRCUIT's pressure and never netPAt(), which carries piezometric head */
  { const G = nodeGraph();
  for(const p of LAY.parts){
    const lim = partPdes(p);
    if(!lim || !fitted(p) || s.dmgParts.indexOf(p.id) >= 0) continue;
    let pk = 0, seen = false;
    for(const f of ["t","r","b","l"]){ const n = coreFold(p.id+f);
      if(P.net.index[n] === undefined) continue;
      seen = true;
      pk = Math.max(pk, G.inCore(n) ? s.P : condP(s));
    }
    if(!seen || pk < lim) continue;
    s.dmgParts.push(p.id);
    s.dmgWhy[p.id] = "OVERPRESSURE";
    const fx = dmgFx(p.id);
    if(fx.hit) fx.hit(s, p.id);
    logE("alarm","SHELL FAILURE / "+fx.msg,
      p.name+" has burst. It is holding "+pk.toFixed(1)+" MPa against the "+
      lim.toFixed(1)+" MPa its own shell is built for. "+fx.why);
  } }
  /* one line for an explosion, not one for a flame: latched, so it goes out when the last flame does and says what the whole passage cost */
  if(!s.roomBurnOn && s.burnEv.kg > 0){
    if(s.burnEv.kg > H2_BURN_EV)
      logE("alarm","HYDROGEN DEFLAGRATION",
        s.burnEv.kg.toFixed(1)+" kg of hydrogen has burned in the compartment, "+
        (s.burnEv.kg*H2_LHV/1000).toFixed(0)+" MJ of it into the air, peaking at "+
        s.burnEv.p.toFixed(0)+" kPa. "+
        (s.burnEv.ids.length ? "It took "+s.burnEv.ids.join(", ")+". " : "Nothing was broken by it. ")+
        "It came off the cladding, left the loop with the steam, collected under the deckhead and found something hot enough to light it. Nothing was needed but the heat that was already there.");
    s.burnEv = {kg:0, p:0, blast:0, ids:[]};
  }
  /* the same latch for the metal, which burns for minutes rather than seconds */
  if(!s.roomFireOn && s.fireEv.kg > 0){
    if(s.fireEv.kg > FIRE_EV_KG)
      logE("alarm","SODIUM FIRE",
        s.fireEv.kg.toFixed(1)+" kg of sodium has reacted in the compartment, "+
        (s.fireEv.q/1000).toFixed(0)+" MJ of it"+
        (s.fireEv.p >= 1 ? ", peaking at "+s.fireEv.p.toFixed(0)+" kPa" : "")+
        ". It spilled out of a sodium circuit at over 600 K, which is three "+
        "hundred degrees past the temperature it lights itself at, and then it "+
        "burned until the pool ran out or the bay ran out of air. Nothing had to "+
        "go wrong twice. A cell under nitrogen would have smothered the fire - "+
        "but not any of it that found water, which needs no air at all. A catch "+
        "pan under the leak takes the pool away and stops both.");
    s.fireEv = {kg:0, p:0, q:0};
  }
  /* what standing in a hot room costs a machine: a ramp rather than a switch, so it cooks over seconds. Structure declares no tsurv */
  { const live={};
    // the live set only serves the sweep at the end, which has nothing to sweep while no cell is hot
    let track=false; for(const k in s.roomHurt){ track=true; break; }
    for(const p of LAY.parts){
      const lim = partTsurv(p);
      if(!lim || !fitted(p)) continue;
      live[p.id]=1;
      if(s.dmgParts.indexOf(p.id) >= 0){ s.roomHurt[p.id]=0; continue; }
      if(!hurtStep(s.roomHurt, p.id, (partSkin(s,p)-lim)/ROOM_DMG_SPAN, ROOM_DMG_TAU, dt)) continue;
      s.dmgParts.push(p.id);
      s.dmgWhy[p.id] = "COOKED";
      const fx=dmgFx(p.id);
      if(fx.hit) fx.hit(s, p.id);
      /* p.name, not partName(): core/ui.js is outside the worker's own subset, and this line runs inside a scenario run */
      logE("alarm","HEAT DAMAGE / "+fx.msg,
        p.name+" has been cooked by the compartment it is standing in - its own metal is at "+
        partSkin(s,p).toFixed(0)+" K against the "+lim+" K it was built for, in air at "+
        roomAt(s,p).toFixed(0)+" K. "+fx.why+
        " Fixing it while the room is still this hot only buys the same seconds again.");
    }
    /* the pipework cooks too, and neither a pipe cell nor a nozzle valve is in LAY.parts; judged on the AIR, because what a run carries is no measure of the fire around it */
    for(const q of cellHazards()){
      if(track) live[q.id] = 1;
      if(s.dmgParts.indexOf(q.id) >= 0){ s.roomHurt[q.id]=0; continue; }
      const air = s.roomT[q.y*GW+q.x];
      if(!hurtStep(s.roomHurt, q.id, (air-(q.lim||PIPE_TSURV))/ROOM_DMG_SPAN, ROOM_DMG_TAU, dt)) continue;
      s.dmgParts.push(q.id);
      s.dmgWhy[q.id] = "COOKED";
      const fx = dmgFx(q.id);
      logE("alarm","HEAT DAMAGE / "+fx.msg,
        "The compartment has cooked "+q.what+" - air at "+
        air.toFixed(0)+" K against the "+(q.lim||PIPE_TSURV)+" K it is good for. "+fx.why);
    }
    if(track) for(const id in s.roomHurt) if(!live[id]) delete s.roomHurt[id]; }

  coreAgg(s);

  // naming the machines means the verb has to agree with how many there were
  const isAre = ids => ids.length>1 ? "are" : "is";
  const E=s.ev, ev=(k,cond,sev,msg,why,latch)=>{
    /* `why` may be a thunk: a log line nobody is reading is not worth a string a tick */
    if(cond && !E[k]){ E[k]=true; logE(sev,msg,typeof why==="function"?why():why); }
    else if(!cond && !latch) E[k]=false; };
  ev("hipow",s.n>1.10,"warn","POWER ABOVE 110%",
    "Running past rated output. Thermal margin is what pays for it, and DNBR is falling.");
  ev("dnbr13",s.dnbr<1.30,"warn","DNBR BELOW 1.30",
    "Coolant is approaching film boiling on the fuel pins. Raise pump flow or pressure, or cut power.");
  ev("dnbr10",s.dnbr<1.00,"alarm","DNBR BELOW 1.00 / CLADDING FAILING",
    "The fuel is now wrapped in insulating steam. Heat is not reaching the water and damage is accumulating this second.");
  /* the cause is raised before its consequence: these fire in list order within one tick */
  ev("scram",s.scrammed,"alarm","REACTOR TRIP / "+(s.trip||"SCRAM"),
    "Rods fully inserted and the turbine tripped with them. Xenon now builds and will hold the reactor down for minutes.");
  /* the rods have to actually BE in, or the alarm fires on every scram and is spent before the real re-criticality arrives */
  ev("recrit",s.scrammed&&s.rodPos>.98&&s.rho>-200,"alarm","TRIPPED CORE GOING CRITICAL",
    ()=>"The bank is in and the reactor is climbing back to critical anyway. The xenon it was shut down by has decayed, and the bank alone is worth "+P.sdm.toFixed(0)+" pcm against it. Borate now - the boron system is worth "+P.sdmB.toFixed(0)+" pcm of margin.");
  ev("cav",s.cav>0.15,"warn","COOLANT PUMP CAVITATION",
    ()=>"Water arriving at "+(cavIds.length?nameList(cavIds):"the pumps")+
        " is close to boiling, so "+(cavIds.length>1?"they are":"it is")+
        " churning vapour. Real flow is far below the bench setting.");
  /* the quietest way this plant stops: a node with nothing in it feeds nothing, and every gauge downstream goes flat with no alarm behind it */
  { const dryIds = netDryParts(s);
    ev("dry",dryIds.length>0,"alarm","LINE RUN DRY",
      ()=>nameList(dryIds)+" "+isAre(dryIds)+" empty. There is nothing in "+
          (dryIds.length>1?"them":"it")+" to pump and nothing will leave "+
          (dryIds.length>1?"them":"it")+" until something fills "+
          (dryIds.length>1?"them":"it")+" again - check what is shut upstream."); }
  ev("flowfloor",flowDemPri(s)<P.flowMin,"warn","PUMPS ORDERED BELOW DESIGN FLOOR",
    ()=>"Flow demand is under the "+(P.flowMin*100).toFixed(0)+"% floor the pumps were built for. The protection system trips on LOW FLOW here. Defeat it and the core keeps running on buoyancy alone.");
  ev("hip",s.P>P.P0*1.05,"warn","PRIMARY OVERPRESSURE",
    ()=>"Loop pressure above 105% of nominal. The relief valve lifts at 106%, and the vessel bursts near "+burstPOf(P,s).toFixed(1)+" MPa.");
  ev("porv",reliefAnyOpen(s),"warn","RELIEF VALVE PASSING",
    ()=>{ const open=reliefFitIds().filter(id=>s.reliefOpen[id]&&!s.reliefBlocked[id]);
      return nameList(open)+" "+isAre(open)+" open and venting. If nobody commanded it, primary coolant is leaving the loop."; });
  ev("stuck",reliefAnyStuck(s),"alarm","PORV FAILED TO RESEAT",
    ()=>nameList(reliefFitIds().filter(id=>s.reliefStuck[id]))+
        " lifted on overpressure and did not shut again. Pressurizer level will read HIGH while the loop empties. Close its block valve.");
  ev("void",s.vf>0.15,"alarm","STEAM VOID IN CORE",
    "Steam is forming where liquid should be. It carries almost no heat, so fuel temperature climbs even while reactor power falls.");
  /* not latched: the field falls back the moment the source does, and an operator watching this number needs to see it fall */
  ev("hirad",s.doseRate>RAD_HI,"warn","HIGH RADIATION IN THE SPACE",
    ()=>"The crew's own seat is reading "+s.doseRate.toFixed(2)+"x background. A party out on the plant right now is taking "+(s.repRate*RAD_DOSE_K).toFixed(3)+" dose a second at the job it is standing next to.");
  /* not latched either: the room cools once whatever was venting into it stops */
  { const hotIds = roomOverIds(s);
    ev("hiroom",hotIds.length>0,"alarm","EQUIPMENT OVER TEMPERATURE",
      ()=>nameList(hotIds)+" "+isAre(hotIds)+" standing in air hotter than "+
          (hotIds.length>1?"they were":"it was")+" built for. The compartment peaks at "+
          s.roomMax.toFixed(0)+" K. Nothing in there survives it indefinitely - find what is putting heat into the room."); }
  ev("h2room",roomH2Peak(s)>=H2_LFL,"alarm","HYDROGEN IN THE COMPARTMENT",
    "Hydrogen off the cladding has left the primary with the steam and is now above its flammability limit somewhere in the room. It needs no spark, only something hot enough - and there is a great deal in there that is.");
  ev("pit",-s.parts.xe>3200,"info","XENON PIT",
    "Xenon-135 past 3200 pcm. Raising power may be physically impossible until it decays, whatever you do with the rods.");
  ev("jam",s.rodJam,"alarm","CONTROL RODS NOT RESPONDING",
    "The bank is ignoring demand, a scram included. You are left with boron, flow and load.");
  /* one warning per system the cabinet has but is not running; nothing wired at all is a design decision and is said elsewhere */
  ev("byp_rps", rpsState()==="BYPASSED", "warn", "PROTECTION SYSTEM SWITCHED OFF",
    "Automatic trips are defeated. Nothing will shut this reactor down for you.");
  ev("byp_runback", !!sinkWired(s,"runback",null) && !runbackLive(), "warn", "TURBINE RUNBACK SWITCHED OFF",
    "A trip no longer sheds load. The turbine will keep drawing steam from a dead core and chill the loop.");
  ev("norps",rpsState()==="NOT FITTED","warn","NO PROTECTION SYSTEM FITTED",
    "This plant was commissioned without one. There are no automatic trips to defeat, and none to fall back on. Every scram is yours to call.",true);
  ev("inj",injIds.length>0,"info","INJECTING",
    ()=>nameList(injIds)+" "+isAre(injIds)+" pushing water into the loop at "+
        s.injRate.toFixed(2)+" %/s, and cold shock is ageing the vessel while it runs.");
  ev("d1",s.dmg>1,"alarm","FUEL DAMAGE 1%",
    "Cladding has started to fail and fission products are entering the coolant. Permanent.",1);
  ev("d25",s.dmg>25,"alarm","FUEL DAMAGE 25%",
    "A quarter of the fuel cladding has failed.",1);
  /* latched: the watch does not get its dose back by the number dipping under 50 % again */
  ev("crew50",s.crewDose>50,"alarm","WATCH DOSE PAST 50%",
    "The control-room watch has taken more than half its dose limit for this run. Nobody relieves them - that number only goes one way from here.",1);
  ev("fat50",s.fatigue>50,"warn","VESSEL FATIGUE PAST 50%",
    ()=>"Thermal shock has embrittled the vessel. Its burst pressure is now "+burstPOf(P,s).toFixed(1)+" MPa instead of "+(P.P0*P.burstK).toFixed(1)+".",1);
  ev("brk",s.breach,"alarm","VESSEL RUPTURE",
    ()=>"The pressure vessel failed at "+s.P.toFixed(1)+" MPa. Coolant is leaving faster than anything can replace it. Unrecoverable.",1);
  /* a ratio, not a threshold, so it self-scales across every plant size rather than pinning a megawatt figure a small core could never reach */
  ev("ox",s.qOx>s.n*PROMPT_F,"alarm","CLAD OXIDATION SELF-SUSTAINING",
    ()=>"Steam is burning the cladding faster than the reactor is making heat: "+
        (s.qOx*100).toFixed(1)+"% of rated against "+(s.n*PROMPT_F*100).toFixed(1)+
        "% from fission. Nothing on this ship switches that reaction off - it stops when the metal is gone.",1);
  ev("h2",s.h2>H2_EV,"alarm","HYDROGEN IN THE PRIMARY",
    ()=>"Over "+H2_EV+" kg of hydrogen has come off the cladding. It is not water and it does not carry heat - and the moment any of it leaves the loop it is a flammable gas in the compartment, at 4% by volume and 773 K.",1);
  ev("melt",s.melt,"alarm","CORE MELT",
    ()=>"A quarter of the fuel is molten and "+s.dmg.toFixed(0)+"% of the cladding has failed. Unrecoverable.",1);
  /* here, beside the event latches, because both want the settled window step() is holding open */
  if(s.tick % ANN_TICKS === 0) annStep(s);

  if(s.repair){
    /* advanced by radWorkK(s.repRate)*dt and never plain dt, so the panel's own estimate and this advance cannot read two different numbers for the same job */
    s.repair.t += dt*radWorkK(s.repRate);
    /* the party takes the dose of the place it is standing in, off the live field */
    s.dose = Math.min(100, s.dose + s.repRate*RAD_DOSE_K*dt);
    if(s.dose>=100 && !s.partySpent){
      /* pulled out permanently: there is no second party, and repairStart() refuses every dispatch after this fires */
      s.partySpent=true;
      s.repair=null;
      logE("alarm","REPAIR PARTY WITHDRAWN",
        "The repair party has taken its full dose allowance for this run and is being pulled off the plant. There is no second party - whatever is still broken, on this job and any that follows, stays broken for the rest of this run.");
    } else if(s.repair.t >= s.repair.need){
      const k=s.repair.id;
      s.dmgParts = s.dmgParts.filter(q=>q!==k);
      delete s.dmgWhy[k];
      /* the undo is the same row of DMGFX that did the damage, so an effect cannot exist without its reversal */
      const fix=dmgFx(k).fix; if(fix) fix(s, k);
      logE("info","REPAIR COMPLETE / "+k.toUpperCase(),
        "The component is back in service. It took "+s.repair.need.toFixed(0)+" seconds and cost the repair party dose.");
      s.repair=null;
    }
  }

  /* s.flowPos[key] is how far the fluid in that run has travelled, in diagram pixels; the renderer slides packets along it and differentiates it for the meters, so the two cannot disagree */
  const d=s.flowPos, sp=60*DRAW_K*dt;
  /* steam and exhaust read a solved hydraulic rate like every liquid run, normalised on steamScale(), which is the meter's own full scale */
  const steamRun = key => {
    const k = P.net.byKey[key].k;
    if(!runEnds(key,k)) return 0;
    /* a dead-ended branch carries what its own shell is venting: a dead end carries nothing in a network, so the solve cannot answer it */
    const b = steamBook(key,k);
    if(b.vent){ let q = 0;
      for(const fid of b.taps) q += (s.reliefSteam && s.reliefSteam[fid]) || 0;
      return q*steamDir(key,k); }
    /* every other steam run reads the same runFlow a liquid run does, signed along the key's own canonical order */
    return runFlow[key] || 0;
  };
  for(const key in d){
    const r = P.net.byKey[key];
    if(!r) continue;                           // a design change left a stale key
    /* a shut port valve has to reach the picture; this is a phase, so freezing it is what a stopped line looks like */
    if(!runPortsOpen(s,r)) continue;
    if(r.k==="steam"||r.k==="exh"){
      d[key] += sp*1.4*steamRun(key)/Math.max(1e-6, steamScale(key,r.k));
      continue;
    }
    const tag = P.net.tagByKey[key] || 0;
    /* having a solved reference is the test, never carrying a temperature tag: KIND_TEMP is about buoyancy and says nothing about the secondary */
    if(tag || P.netRefByRun[key]!==undefined){
      /* the run's own solved flow with no correlation floor under it, so a plant on natural circulation visibly moves water and one with a valve shut visibly does not */
      d[key]+=sp*runRatio(key)*1.4;
    }
  }
  /* the shafts state a rate, not an angle: an angle kept %360 carries no direction once a frame is worth more than half a turn */
  s.spinV=360*mflux;
  s.spinTV=360*Math.min(s.load,1.5);
  /* what the stores lost this tick, less what the named terms say left */
  { const res = (ledgM0 - ledgerKg(s)) - (ledgerOut(s) - ledgO0);
    s.massRes = res;
    /* rate-limited, re-armed the moment the residual changes sign or an order of magnitude, so a settling transient costs one line and a permanent leak keeps saying so */
    if(Math.abs(res) > LEDGER_EPS*Math.max(ledgM0,1)){
      const was = s.massWarn, t = s.tick;
      const fresh = !was || res*was < 0 || Math.abs(res) > 10*Math.abs(was)
        || Math.abs(res) < 0.1*Math.abs(was);
      if(fresh || t - s.massWarnT >= LEDGER_QUIET/dt){
        s.massWarn = res; s.massWarnT = t;
        console.warn("[ledger] tick "+t+": "+res.toFixed(3)+" kg unattributed of "
          +ledgM0.toFixed(0)+" kg", JSON.parse(JSON.stringify(s.massOut))); } } }
  layRelease();
}
/* one pressure colour for every readout, on the annunciator's own thresholds, so a gauge cannot disagree with the alarm beside it */
const pColor = v => v > P.P0*1.05 ? C.red : v < P.P0*0.935 ? C.amber : C.cyan;
const ANN=[
 ["HI FLUX","red",s=>s.n>1.12,
  "The reactor is making more than 112% of its rated power. You are outside the design envelope and the fuel is being pushed harder than it was built for. Reduce load or insert rods.","core"],
 ["LO DNBR","red",s=>s.dnbr<1.30,
  "Departure from Nucleate Boiling Ratio has fallen below 1.30. The cooling water is close to boiling into a continuous film on the fuel rods, which would stop heat transfer almost instantly. Raise pump flow, raise pressure, or cut power. Note that flow means PUMP flow: buoyancy circulation removes heat but barely moves the water, so it buys almost no DNBR.","core"],
 ["FUEL DMG","red",s=>s.dmg>0.1,
  "Fuel cladding has failed somewhere in the core. This is permanent, it puts radioactive fission products into the coolant, and it only gets worse. Nothing you do now un-breaks it.","core"],
 ["LO PRESS","amber",s=>s.P<P.P0*.935,
  "Primary loop pressure has dropped below 93% of normal. Either you are leaking coolant, or the pressurizer sprays are overcooling the steam bubble. Pressure is what stops the loop boiling, so this matters.","pzr"],
 ["HI PZR LVL","amber",s=>s.lvl>78,
  "Pressurizer water level above 78%. Either the loop genuinely has too much water in it, or steam forming in the core is pushing water up into the pressurizer while the loop actually empties. Check subcooling to tell which.","pzr"],
 ["LO SUBCOOL","red",s=>s.sc<8,
  "Less than 8 degrees of margin before the coolant boils. This is the alarm that does not lie about inventory. If this is lit and pressurizer level looks fine, believe this one.","pzr"],
 /* P.vessel first: a ship with no reactor cannot be out of balance with its turbine */
 ["TAVG DEV","amber",s=>P.vessel && Math.abs(s.Tavg-tProg(s))>4,
  "Average coolant temperature is more than 4 K away from where it should be for the current load. The reactor and the turbine are not in balance: one is making more heat than the other is taking.","rods"],
 ["XENON PIT","blue",s=>-s.parts.xe>3200,
  "Xenon-135 has built up past 3200 pcm of negative reactivity. This poison eats neutrons, and until it decays you may physically be unable to restart or raise power no matter how far you pull the rods.","core"],
 ["RECRITICAL","red",s=>s.scrammed&&s.rho>-200,
  "A tripped core is on its way back to critical with the bank fully inserted. Xenon shut this reactor down as much as the rods did, and xenon decays. Nothing but boron will hold it now, and if it gets there before you do it will come back to power against a turbine that is not taking any.","core"],
 ["ROD JAM","amber",s=>s.rodJam,
  "The control rods are not moving when commanded. Your fast reactivity handle is gone. You now control the reactor only with boron, coolant temperature and load.","rods"],
 ["PORV OPEN","red",s=>reliefAnyOpen(s),
  "The pressure relief valve on top of the pressurizer is passing flow. If you did not command it open, you are dumping primary coolant overboard right now. Close the block valve.","pzr"],
 ["CORE VOID","red",s=>s.vf>0.15,
  "Steam pockets are forming inside the core where liquid water should be. Steam cannot carry heat away, so fuel temperature climbs fast even though reactor power may be falling.","core"],
 ["RX TRIP","red",s=>s.scrammed,
  "A scram has occurred and the control rods are fully inserted. The reactor is shut down. Expect a xenon buildup that will keep it shut down for the next few minutes.","rods"],
 ["HI PRESS","red",s=>s.P>P.P0*1.05,
  "Primary pressure above 105% of normal. The relief valve will lift shortly. Sustained overpressure past about 122% bursts the vessel outright, and every point of vessel fatigue lowers that threshold.","pzr"],
 ["CAVITATION","amber",s=>s.cav>0.15,
  "The water arriving at the coolant pumps is close to boiling, so the pumps are churning vapour instead of liquid. Actual flow is far below what the bench says. Raise pressure or cool the loop.","pump"],
 /* no heat guard here, unlike tripCause(): the tile is information, and it is wanted most when protection has been defeated */
 ["LO FLOW","amber",s=>s.flowNet<P.flowMin,
  "Coolant flow is below the design floor for the pumps fitted. With protection armed the reactor trips here. Bypassed, the fuel is cooled by buoyancy alone, and that is all the cooling there is.","pump"],
 ["NO RPS","amber",()=>rpsState()==="NOT FITTED",
  "Nothing in the control cabinet lands on a scram. Nothing is watching flux, DNBR, pressure, fuel temperature, flow or void on your behalf. You are the protection system.","ctrl"],
 ["RX BREACH","red",s=>s.breach,
  "The pressure vessel has ruptured. Coolant is leaving faster than anything can replace it. This is unrecoverable.","core"],
 ["BLACKOUT","amber",s=>s.blackout,
  "Main power to the coolant pumps is lost. Flow is now limited to your backup power supply plus whatever natural circulation the core geometry generates.",null],
 ["CORE MELT","red",s=>s.melt,
  "A quarter of the fuel is molten. Unrecoverable. Reset the plant.","core"],
 /* every row below is appended, because help.js numbers the tiles by array index and an insert renumbers the rest */
 /* a shell above the set point whether or not anything was fitted to answer it, which is the case worth being told about */
 ["SG HI PRES","red",s=>sgIds().some(id=>secP(s,id)>sgLiftP()),
  "A steam generator is over its design shell pressure. If a relief valve is fitted it is passing steam to atmosphere, and the water going with it is not coming back. If one is NOT fitted, the shell bursts at 1.5x design. Find what is stopping the steam: a shut steam line, a drowned or isolated condenser, or a turbine that is not passing.","sg"],
 ["SG BURST","red",s=>sgIds().some(id=>s.sgBurst&&s.sgBurst[id]),
  "A secondary shell has ruptured. It is open to atmosphere, it will not hold pressure again, and it stops cooling its loop the moment it is empty. If those tubes were leaking, what is going out of the hole is primary water.","sg"],
 /* the two steps of boiling a shell dry, on the same numbers the mimic's banner and the removal term read */
 ["LO SG LVL","amber",s=>sgIds().some(id=>sgLvl(s,id)<SG_LOW),
  "A steam generator is below "+SG_LOW+"% and falling. Nothing is uncovered yet: this is the warning ahead of it, and emergency feedwater does not start until "+SG_DRY+"%. Feed it - check the feed pump, the regulating valve and the hotwell before you assume the pump has failed.","sg"],
 ["SG DRY","red",s=>sgIds().some(id=>sgLvl(s,id)<SG_DRY_LO),
  "A steam generator is below "+SG_DRY_LO+"%. Most of the bundle is in steam and that loop is not cooling the core any more. If every generator reads this, the only heat sink left is what leaks out of the boundary.","sg"],
 ["HOTWELL HI","red",s=>condFrac(s)<1,
  "The hotwell is above "+HOT_FLOOD+"% and the water in it is drowning the tubes that do the condensing. The condenser is losing capacity as it fills, so backpressure rises, the turbine takes less steam, and the shells pressurise behind it. Drain it or stop putting water into it.","cond"],
 ["TURB TRIP","red",s=>!!s.turbTrip,
  "Exhaust pressure got past what the machine will run against, so the stop valve is shut and the turbine is passing no steam. The reactor is still making heat. Find the heat sink: circulating water, a drowned hotwell, or a condenser that has been hit.","turb"],
 ["NO VACUUM","red",s=>!!s.condLost,
  "The condenser reached atmospheric pressure and relieved. It is open to the room, it will not hold vacuum again, and it has stopped being a heat sink. Everything the generators raise now goes out of their safety valves, and the water goes with it.","cond"],
 ["ROD LIMIT","amber",s=>s.rodBand,
  "The automatic rod controller is asking for rod travel the commissioned band will not give it, and coolant temperature is off programme because of it. It has no authority left in that direction. Move load, move boron, or widen the band at the design bench - the band is not a safety limit, it is how much room the controller was given.","rods"],
 ["NEAR TRIP","amber",()=>!!tripNear(),
  "A protection setpoint is within "+(RPS_NEAR*100).toFixed(0)+"% of tripping the reactor. The component itself names which one. This is a warning, not the trip: nothing has latched yet and the condition is still yours to clear.","core"],
 ["AREA RAD","amber",s=>s.doseRate>RAD_HI,
  "The control room is reading above 1x background. That number is set both by what has failed on the plant and by where you put the shielding at the bench - a well-shielded control room can sit this out through a release that would light this tile instantly on a poorly sited one. A repair party out on the plant right now is being spent while this is lit, faster the closer the job sits to whatever is shining.","ctrl"],
 ["CLAD OXID","red",s=>s.qOx>0&&s.qOx>s.n*PROMPT_F,
  "Steam is burning the zirconium cladding, and it is now making more heat than the chain reaction is. This reaction feeds itself: the hotter the metal gets the faster it burns, and no rod, no pump and no valve on this ship stops it. It ends when the cladding is gone. It also makes hydrogen.","core"],
 ["FUEL MELT","red",s=>s.meltFrac>0,
  "Fuel pellets somewhere in the core are liquid. This is past cladding failure - the fuel itself has gone, and the damage map on the reactor panel says which part of the core. CORE MELT latches when a quarter of it is molten.","core"],
 /* hosted on the control cabinet: the room is a plant-wide fact, and that is where plant-wide facts light */
 ["HI ROOM T","red",s=>roomOverIds(s).length>0,
  "A machine somewhere on the plant is standing in air hotter than it was built for, and it is being cooked at a rate you can watch. Heat is a place: it comes off every hot surface, it comes in a flood out of anything venting steam into the room rather than into a tank, it collects where a compact layout gives it nowhere to go, and the only sink is the hull. Find what is putting heat in, or fit something that takes it out.","ctrl"],
 /* whether it is alight RIGHT NOW, a different question from whether it could light; s.roomBurnOn is the flame count the burn pass already keeps */
 ["H2 FIRE","red",s=>s.roomBurnOn>0,
  "Hydrogen is burning in the compartment right now. It stops when the fuel runs out or the air does - a sealed room smothers its own fire - and until then it keeps heating the machines and raising the pressure that breaks them. The OXYGEN layer says which way it is going.","ctrl"],
 ["H2 LFL","red",s=>roomH2Peak(s)>=H2_LFL,
  "Hydrogen off the cladding has escaped the primary with the steam and is now over 4% by volume somewhere in the compartment. Above 773 K it lights itself - no spark needed - and it burns at 120 MJ per kilogram into the room it is standing in. This is the Fukushima sequence.","ctrl"],
 /* the panels are the heat sink out here, so this tile says the chain has come apart at the far end rather than in the plant */
 ["NO SINK","red",s=>!radIds().some(id=>radLive(id)&&s.dmgParts.indexOf(id)<0),
  "Nothing on this ship is radiating. Every panel is destroyed, or walled in where it cannot see the skin, or there is no panel at all. Heat leaves this ship as light or it does not leave. The condenser will climb until it loses vacuum and the turbine trips, and after that the generators go to their safety valves.","cond"],
 ["PANEL HI T","amber",s=>radTMax(s)>tsatSec(TURB_TRIP_P)-COND_DT0,
  "The radiator is running hot enough that the condenser behind it is close to the pressure the turbine will not exhaust against. Rejection goes as the fourth power of panel temperature, so the last few kelvin cost far more than the first: cut reactor power, or accept the trip.","cond"],
 /* its own tile, because the two fires share only the air they burn: this one is a pool, it needs no spark, and no fan takes it away */
 ["NA FIRE","red",s=>s.roomFireOn>0,
  "Sodium is burning on the deck. It came out of a pipe at over 600 K, which is hundreds of degrees past the temperature it lights itself at, so nothing had to ignite it. It burns until the pool is gone or the bay's oxygen is - the OXYGEN layer says which way it is going - and while it burns it cooks every machine around it and eats the air. A spray from a small hole burns far faster than a puddle from a large one, and water makes it worse.","ctrl"],
/* one tile per system the cabinet carries and is not running; the host is lazy, because LAY does not exist while this table is built */
 ["RPS OFF","amber",()=>rpsState()==="BYPASSED",
  "The protection system is wired and switched off at the cabinet. Automatic trips are defeated. Nothing will shut this reactor down for you.",()=>roleId("ctrl")],
 ["NO RUNBACK","amber",s=>!!sinkWired(s,"runback",null)&&!runbackLive(),
  "The turbine runback is wired and switched off at the cabinet. A trip no longer sheds load, so the turbine will keep drawing steam from a dead core and chill the loop.",()=>roleId("turb")],
];

/* the lamp says "here", the board says "what"; the id is matched by prefix, and a tile with no component lights nothing */
const annHost = h => typeof h==="function" ? h() : h;
/* the tick establishes the lit set and everything else reads it; s.annRev counts transitions, so a watcher reads one integer instead of the table */
const ANN_TICKS=5;
/* a row about the reactor is asked of each vessel through its own view (coreSeen), so the tile lights for any unit and a lamp for that unit alone */
const annCoreRow = a => a[4]==="core" || a[4]==="rods";
const annLitOn = (a,s,id) => annCoreRow(a) ? !!a[2](coreSeen(s,id)) : !!a[2](s);
function annStep(s){
  const on=s.annOn, ids=coreIds();
  for(const a of ANN){
    const v = annCoreRow(a) ? (ids.some(id=>annLitOn(a,s,id))?1:0) : (a[2](s)?1:0);
    if(on[a[0]]!==v){ on[a[0]]=v; s.annRev++; } }
}
/* one reader, one predicate, so the box and the tile are the same claim */
const annLit = name => !!(S && S.annOn[name]);
function annLamp(id){
  const a=annOnPart(id)[0];
  return a ? annSevCol(a[1]) : null;
}
/* what is lit on one component, as the rows themselves: red, then amber, then blue, table order inside each */
const ANN_SEV={red:0,amber:1,blue:2};
// read at CALL time: the sim-only subset has no palette at load (nodom-probe.js)
const annSevCol = sev => sev==="red" ? C.red : sev==="amber" ? C.amber : C.blue;
function annOnPart(id){
  const cid=coreOf(id), p=partOf(id);
  return ANN.filter(a=>{
      if(annCoreRow(a)) return !!cid && p && p.role===a[4] && S.annOn[a[0]] && annLitOn(a,S,cid);
      const host=annHost(a[4]);
      return host && id.startsWith(host) && S.annOn[a[0]]; })
    .sort((a,b)=>ANN_SEV[a[1]]-ANN_SEV[b[1]]);
}
