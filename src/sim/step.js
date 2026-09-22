"use strict";
let P=null;
/* a generator so prewarmStep() (screens/shell.js) can drive commissioning a slice at a time */
function commission(){ const g=commissionGen(); while(!g.next().done); }
function* commissionGen(){
  const d=derived(),a=d.a,f=d.f,B=d.beta*1e-5,K=XE_CLOCK,L=layoutMetrics(),dg=dngOf(FUEL[priD().fuel]);
  P={BETA:B,bet:dg.bet.map(x=>x*B),
     lam:dg.lam.slice(),LAM:d.Lam,
     aF:a.aF, aM:d.aM, aG:d.aG, aV:d.aV, aX:d.aX, aS:d.aS, pwrDef:d.pwrDef, P0:d.P0, tsat0:coolTsat(a, d.P0),
     // with no vessel placed P describes the stand-in, and P.vessel says so
     rated:coreIds().length ? ratedMWt() : priD().power, dnbr0:d.dnbr0, dnbLaw:a.dnbLaw, Fq0:d.Fq, xeW:d.xeW, scram:d.scram,
     excess:d.excess, flowMin:flowMinOf(),
     id:a.id, name:a.name,
     eff:d.eff, loadMax:d.loadMax, condCap:d.condCap,
     pzrK:holdDampK()*L.pzrK,
     dose:L.dose, radK:L.radK, bypass:condDumpMean()/Math.max(1e-9,plantSteam()),
     rpsm:D.rpsm, rpsLag:D.rpsLag, arLo:D.arLo, arHi:D.arHi, rodRate:rodSpdOf(priD()),
     /* the lattice is drawn on its own surface, so the reactivity terms above exist with no vessel on the grid */
     vessel:!!roleOf("core"),
     catcher:LAY.parts.some(p=>p.role==="catcher"), backup:BKP[D.bkp].bk,
     fittings:JSON.parse(JSON.stringify(D.fittings)),
     loops:boilerCount(), sdm:d.sdm, sdmB:d.sdmB, boronOp:d.boronOp, lay:L,
     lamI:XE.lamI*K, lamX:XE.lamX*K, gI:XE.gI, gX:XE.gX, gP:SM.gP, lamP:SM.lamP*K,
     rho0:coolFig(a).rho};
  P.sat   = satCurveFor(a, P.P0);
  P.hfg   = coolFig(a).hfg;                            // kJ/kg
  /* saturation is the ceiling - past it the programme is superheat, which this model has no enthalpy for */
  P.Tref  = Math.min(a.Tref, P.tsat0);
  // the design point a coolant row is quoted at, so a supercritical non-water coolant's p/T law (mixState) has a real anchor
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
  P.turbC = P.steamRef/Math.max(flowW(1, steamRhoDes(), sgDesignP(), condPDes(), GAM_VAP), 1e-9);
  yield {frac:.01, stage:"PIPE NETWORK"};
  P.net    = netBuild();
  // the same net with every bore at its own nominal - the frame P.netRef is taken in
  P.netNom = withNomBore(() => netBuild());
  yield {frac:.03, stage:"PIPE NETWORK"};
  /* P.flowK is the solved reference over P.wRated */
  P.wRated = coreRatedKgs(a, P.rated*1000);
  const refPower = () => {
    P.flowK = P.netRef/P.wRated;
    P.n0    = Math.min(1, P.flowK);
    P.steamRef = P.n0*P.rated*1000/steamRise();
    P.turbC = P.steamRef/Math.max(flowW(1, steamRhoDes(), sgDesignP(), condPDes(), GAM_VAP), 1e-9); };
  /* the design's own ask, so the first build fills every column; nothing is marched on it */
  P.netRef = P.wRated; P.flowK = P.n0 = 1;
  P.netRefByRun = {}; P.netRefThru = {}; P.cwRefBy = {};
  yield {frac:.04, stage:"CORE MESH"};
  plantRest(d, f, a, null);
  engBuild(); engAlloc(PT.n);
  const n0 = PT.n;
  const rebuild = () => { engBuild();
    for(const k of new Set(Object.keys(n0).concat(Object.keys(PT.n))))
      if(PT.n[k] !== n0[k]) throw new Error("the reference moved the plant's topology: "+k); };
  /* the circulation reference is the nominal plant, so the flow ratio reads what this plant's own bores cost it; per run it stays the drawn one */
  yield {frac:.05, stage:"CIRCULATION"};
  eNetRef(E_REF_NOM, null);
  P.netRef = SX.netSc[E_NS_CORE];
  { const coreRef = {};
    for(let c=0;c<PT.n.core;c++) coreRef[IX.coreId[c]] = SX.netCoreKg[c];
    refPower();
    plantRest(d, f, a, coreRef); }
  rebuild();
  const nb = PT.n.boiler, nn = PT.n.node, thru = new Float64Array(nn);
  const thruTake = () => { const t = new Float64Array(nn);
    for(let e=0;e<PT.n.edge;e++){ const m = netKgs(SX.edQ[e]); t[PT.edU[e]] += m; t[PT.edV[e]] += m; }
    for(let i=0;i<nn;i++) thru[i] = Math.max(thru[i], t[i]/2); };
  eNetRef(E_REF_DRAWN, null, new Float64Array(nb).fill(ratedSteam()/Math.max(1,boilerCount())));
  const prev = Float64Array.from(ST.fregBy.subarray(0, nb));
  P.fregRef = Object.fromEntries(IX.boilerId.map((id,b) => [id, prev[b]]));
  thruTake();
  P.netRefByRun = {};
  for(let k=0;k<PT.n.key;k++) P.netRefByRun[IX.keyId[k]] = SX.netRunW[k];
  /* per machine: the ratio scales that machine's duty, and 0 is no heat sink at all */
  P.cwRefBy = Object.fromEntries(condIds().map(id=>[id, cwFlowOf(P.netRefByRun,id)]));
  yield {frac:.10, stage:"FLOW REFERENCES"};
  /* copied back only where the line had no scale at all, or a standby line references 0 forever */
  eNetRef(E_REF_OPEN, prev);
  thruTake();
  for(let k=0;k<PT.n.key;k++){ const key = IX.keyId[k];
    if(!P.netRefByRun[key] && SX.netRunW[k]) P.netRefByRun[key] = SX.netRunW[k]; }
  /* what every node passes, kg/s: half the sum of its incident edges, so a dead end reads exactly 0 */
  P.netRefThru = {};
  for(let i=0;i<nn;i++) P.netRefThru[IX.nodeId[i]] = thru[i];
  P.netRefKg = {};
  for(const k in P.netRefByRun) P.netRefKg[k] = netKgs(P.netRefByRun[k]);
  P.dsig = designSig();                 // what this plant was built from
  rebuild();
  yield {frac:.12, stage:"SETTLING"};
  P.dnbrK = 1; resetPlant();
  /* what this plant is subcooled by untouched: a fixed scale would peg four of six architectures */
  P.sc0 = ST.sc[SC_SC];
  /* at or above saturation means the loop is its own steam space and needs no pressurizer programme */
  P.steam = P.sc0 <= 0;
  /* and what it voids by at rest - subcooled boiling means that need not be zero */
  P.vf0 = ST.sc[SC_VF];
  for(let c=0;c<PT.n.core;c++){ const id=IX.coreId[c], K=P.cores[id];
    K.vf0=ST.csVf[c]; K.cgo0=PT.coreNode[c] >= 0 ? eNodeT(PT.coreNode[c]) : 0; K.sc0=satT(K.sat, eLoopP(K.circ)) - (eTavgOf(K.circ) + coreDT0(coreD(id))*ST.csHeat[c]/2); K.steam=K.sc0<=0; }
  engBuildPost();
  /* one real step, because the hot node's quality is walked inside coreStep(); it is then thrown away */
  yield {frac:.35, stage:"TUBE FIT"};
  step(0.02);
  eCoreDnbrFit();
  P.dnbrK = P.dnbr0/Math.max(ST.sc[SC_DNBR],1e-9);
  for(let c=0;c<PT.n.core;c++) P.cores[IX.coreId[c]].dnbrK = PT.coreDnbrK[c];
  /* the governor is refitted at the pressure the line delivers, on the highest shell and including what the dump is taking */
  { const nb=PT.n.boiler;
    /* full step for the first round, then a secant on (ln turbC, ln k): a line with real losses answers less than proportionally */
    let lnCw, lnKw;
    for(let r=0;r<6;r++){ let k=0, to=0;
      yield {frac:.38+.10*r, stage:"GOVERNOR"};
      /* the governor is a FLOW match on the nozzle, so both sides are the physical steam: the bleed is taken downstream of it */
      const wk = ST.sc[SC_TURBWK] + eBleedPlant();
      if(P.turbC>0) for(let b=0;b<nb;b++){ k = Math.max(k, eBoilerP(b)/PT.boilerDesP[b]); to += ST.steamBy[b]||0; }
      k = (k>0 && wk>0) ? k*to/wk : 1;
      if(r>0 && Math.abs(k-1) < 1e-4) break;
      const lnC = Math.log(P.turbC), lnK = Math.log(k);
      let step = lnK;
      if(r>0){ const m = (lnK-lnKw)/(lnC-lnCw); if(m < -0.05 && m > -4 && isFinite(m)) step = -lnK/m; }
      lnCw = lnC; lnKw = lnK;
      P.turbC *= Math.exp(step); resetPlant(); } }
  for(let c=0;c<PT.n.core;c++) PT.coreCgo0[c] = P.cores[IX.coreId[c]].cgo0 = PT.coreNode[c] >= 0 ? eNodeT(PT.coreNode[c]) : 0;
  ST.sc[SC_DNBR] = P.dnbr0;
  /* what every later resetPlant() puts back, so leaving a screen and coming back is the same plant and not another walk's answer */
  P.snap0 = snapS();
  engFast();
  screen="operate"; layout();
}

/* the flat mean pellet at the rest point: n0 of rated heat through the film the reference flow gives */
const tfRefOf = (K, c) => K.Tref + K.n0*pinDTf(c, pinFilm(K.flowK));

/* every P figure that stands on the reference, and each vessel's own K; coreRef null is the design's ask, before any solve */
function plantRest(d, f, a, coreRef){
  /* xenon burnout, sigma*phi at rated flux, in units of the decay constant */
  P.sig=XE.sigK*P.lamX; P.XEQ=(P.gI+P.gX)/(P.lamX+P.sig); P.KXE=P.xeW/P.XEQ;
  /* samarium burnout and worth per unit, xenon's scaled by the cross-section ratio */
  P.sigS=P.sig*SM.sigR; P.KSM=P.KXE*SM.sigR;
  P.pRise = a.P0>3 ? 1.0 : 0.25;
  P.burstK = d.vesselBurst/P.P0;                  // the first vessel's, for the plant-level readers
  P.solidK = a.solidK;                                 // MPa/K of a sealed liquid: beta over compressibility
  /* P.steamRef is what the boiler raises and is the scale; P.swallow is what the fitted machines can take and is a ceiling */
  { const n = Math.max(1, sgCount());
    P.sgUA = totalSgUA()/n;
    /* per machine as well as the mean: the heat term is per generator and the flow through each is its own loop's */
    P.sgUABy = Object.fromEntries(sgIds().map(id=>[id, sgUAOf(id)]));
  }
  /* the drop from design shell pressure to design condenser pressure is exactly the feed-to-steam rise, so only backpressure can move the work P.eff prices */
  P.hTurb   = steamRise()/Math.max(.05, 1-Math.pow(condPDes()/sgDesignP(),TURB_GAM));
  /* kW/K summed off the drawing; a plant with no condenser has a UA of exactly 0 */
  P.condUA  = totalCondUA();
  P.tdmg  = f.tdmg;
  P.dryout= a.dnbLaw!=="temp" && !a.fuelInCoolant;
  P.TfRef = tfRefOf(P, priD());
  P.X0    = xeEq(P,P.n0);                                // xenon equilibrium at that power
  coreConst(P,priD(),d);
  /* the zirconium in the core, kg, off the drawing: rod surface times drawn wall, the same currency the ECR is in */
  P.cladKg = cladZrKg(priD(), P.aHeat);
  /* every vessel's own figures off its own drawing, chained to P so a circuit or plant figure falls through */
  P.cores = {};
  for(const cid of coreIds()){
    const c=coreD(cid), dc=derived(cid), ac=dc.a, fc=dc.f, Bc=dc.beta*1e-5, K=Object.create(P), dg=dngOf(FUEL[c.fuel]);
    /* its own circuit's figures, so K.sat, K.Tref, K.P0, K.flowK and K.n0 stop falling through to the first vessel's */
    { const ci=coreCircOf(cid), sat=(ci>=0 && P.coreSat[ci]) || P.sat;
      const wRated=coreRatedKgs(ac, c.power*1000), netRef=coreRef ? coreRef[cid] || 0 : wRated, flowK=netRef/wRated;
      Object.assign(K,{circ:ci, sat, P0:sat.p0, tsat0:sat.T0, Tref:sat.Tref, Tmin:sat.Tref-350, Tmax:sat.T0+400,
        rho0:sat.rho, hfg:sat.hfg, wRated, netRef, flowK, n0:Math.min(1,flowK)}); }
    Object.assign(K,{id:cid, BETA:Bc, bet:dg.bet.map(x=>x*Bc),
      lam:dg.lam.slice(), LAM:dc.Lam,
      aF:ac.aF, aM:dc.aM, aG:dc.aG, aV:dc.aV, aX:dc.aX, aS:dc.aS, pwrDef:dc.pwrDef,
      hsTab:dc.hs.tab, hsC:dc.hs.cc, hsM:dc.hs.mb, hsFN:dc.hs.fn, modRow:c.mod,
      rated:c.power, dnbr0:dc.dnbr0, dnbLaw:ac.dnbLaw, Fq0:dc.Fq, xeW:dc.xeW, scram:dc.scram,
      burstK:dc.vesselBurst/K.P0,
      excess:dc.excess, sdm:dc.sdm, sdmB:dc.sdmB, boronOp:dc.boronOp,
      rodRate:rodSpdOf(c), tdmg:fc.tdmg, tmelt:fc.tmelt, oxid:!!ac.oxid && !!cladOf(c).zr, cladThick:cladOf(c).thick, cladTfail:cladOf(c).tfail ?? 0,
      dryout:ac.dnbLaw!=="temp" && !ac.fuelInCoolant, hfg:coolFig(ac).hfg, dnbrK:1, tube:!!c.tube, dp:coreDpOf(cid)});
    K.KXE = K.xeW/K.XEQ; K.KSM = K.KXE*SM.sigR;
    { const gc = modOwnT(c) ? graphCellOf(c) : null;
      Object.assign(K, gc ? {graphKg:gc.kg, gRk:gc.Rk, gRi:gc.Ri, gRf:gc.Rf} : {graphKg:0, gRk:0, gRi:0, gRf:0}); }
    K.TfRef = tfRefOf(K, c);
    K.X0 = xeEq(K,K.n0);
    coreConst(K,c,dc);
    K.cladKg = cladZrKg(c, K.aHeat);
    P.cores[cid]=K;
  }
}

const nameOf = id => {
  const p = partOf(id);
  return p ? partName(p) : id.toUpperCase();
};
const nameList = ids => ids.map(nameOf).join(", ");
/* P is null on the bench, and a plant may legally have no relief fitting, so every reader below answers with an empty list rather than throwing */
const reliefFitIds = () => { const slot=graphSlot("reliefFitIds"), was=slot.get(1); if(was) return was;
  const f=P?P.fittings:D.fittings;
  const out=Object.keys(f).filter(id=>f[id].mode==="relief"); slot.set(1,out); return out; };
/* shellsOf() is the one predicate: a valve that reaches a shell protects it, one that reaches none is primary */
const reliefSecIds = () => { const slot=graphSlot("reliefSecIds"), was=slot.get(1); if(was) return was;
  const out=reliefFitIds().filter(id=>shellsOf(id).length>0); slot.set(1,out); return out; };
const reliefPriIds = () => { const slot=graphSlot("reliefPriIds"), was=slot.get(1); if(was) return was;
  const out=reliefFitIds().filter(id=>shellsOf(id).length===0); slot.set(1,out); return out; };
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

const CW_RISE=10;         // K, circulating water rise at the design point
/* a condenser is a sink whose internal path declares an anchor; a radiator declares none */
const condIds = () => { const slot=graphSlot("condIds"), was=slot.get(1); if(was) return was;
  const out=LAY.parts.filter(p=>{ const R=ROLE[p.role];
  return R && R.thermal==="sink" && roleIntern(R).some(IN=>IN.anch); }).map(p=>p.id); slot.set(1,out); return out; };
/* one machine's circulating water paths: the internal paths that declare no anchor */
const cwPathsOf = id => { const slot=graphSlot("cwPathsOf"), was=slot.get(id); if(was) return was;
  const p=partOf(id), R=p&&ROLE[p.role], o=[];
  if(!R || R.thermal!=="sink") return o;
  for(const IN of roleIntern(R)) if(!IN.anch)
    o.push({key:"comp:"+id+":"+IN.a+IN.b, a:IN.a, b:IN.b});
  slot.set(id,o); return o; };
const cwFlowOf = (m,id) => { let f=0;
  for(const q of cwPathsOf(id)) f += Math.abs(m[q.key]||0); return f; };
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
/* past atmospheric a condenser relieves and never gets its vacuum back: nothing on this plant pumps the air out */
const COND_ATM=0.101;     // MPa, and the pressure a lost condenser sits at
/* the exhaust pressure a turbine will not tolerate */
const TURB_TRIP_P=0.02;   // MPa
const TURB_GAM=0.19;                 // (gamma-1)/gamma for steam
/* the text a hit logs; what a hit does is the engine's (eDamage) */
const DMGFX={
  core:{msg:"REACTOR VESSEL HIT",
    why:"A penetration in the vessel wall. The vessel is open to the compartment and emptying itself, and the metal is permanently damaged."},
  rods:{msg:"ROD DRIVE HIT",
    why:"The drive mechanisms are wrecked. The bank is stuck where it stands and a scram will not move it. Boron is the only shutdown you have left."},
  turb:{msg:"TURBINE HIT",
    why:"Load rejected. The turbine is offline, so the reactor has nowhere to send its heat."},
  cond:{msg:"CONDENSER HIT",
    why:"Heat rejection lost. Steam has nowhere to condense."},
  radiator:{msg:"RADIATOR PANEL HIT",
    why:"That panel sheds nothing now. The ship's heat sink is whatever is left of the others, so the condenser climbs and the turbine trips on backpressure."},
  ctrl:{msg:"INSTRUMENT CABINET HIT",
    why:"The control cabinet is wrecked. Every block in it stops computing and every demand it owned holds where it was."},
  bkp :{msg:"BACKUP POWER HIT",
    why:"Your emergency supply is gone. A blackout now means natural circulation only."},
  tank:{msg:"TANK HIT",
    why:"That tank's line is severed. Whatever it held is no longer reaching the loop. A tank that holds the circuit's pressure also loses its relief valve open, and it will not reseat."},
  pump:{msg:"PUMP HIT",
    why:"That pump is dead. It develops no head at all, and whatever it was pushing round is down to what the rest of the plant can do without it."},
  sg  :{msg:"STEAM GENERATOR TUBE RUPTURE",
    why:"Primary coolant is leaking into the secondary side and venting past containment. Inventory falls and activity escapes."},
  port:{msg:"NOZZLE VALVE HIT",
    why:"That port's isolation valve is wrecked. The valve body is open to the room, so the run landed on it is severed at the machine and spilling there, and it cannot be cut out until a party has been out to it."},
  /* wrecked means the cell stops being gas-tight (matOpen(), paint.js); everything else follows from that one predicate */
  mat:{msg:"CONTAINMENT BREACH",
    why:"A cell of the wall is open. If it was holding a bounded region, that region is not bounded any more: the compartment behind it is now the ship's compartment, everything it was holding goes where the ship's air goes, and whatever was standing behind it is now shining on the crew."},
  pipe:{msg:id=>(cellInCore(id)?"PRIMARY ":"")+"PIPE RUPTURE",
    why:id=>cellInCore(id)
      ? "A primary run has been severed. It carries nothing round the loop any more, and both cut ends are now open to containment - the loop is losing coolant and pressure through them until something stops it."
      : "A run off the primary has been severed. It carries nothing round its own circuit any more, and both cut ends are open to the compartment - that circuit is losing its water and its pressure through them until something stops it."}
};
/* which circuit a burst cell stands on, asked of the run under it; a cell no run owns reads as the primary's, which is where a message with nothing traced belongs */
const cellInCore = id => { const c = id.slice(5).split(","), M = pipeMap();
  const key = (M.cellOwner[pipeKey(+c[0], +c[1])] || [])[0];
  const r = key && M.byKey[key];
  return !r || runCircOf(r) === nodeGraph().coreCirc; };
const DMGANY={msg:"EQUIPMENT HIT", why:"A component has been knocked out."};
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


const repairNeed = p => 14 + p.w*p.h*4;


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
const RPS_NEAR=0.03;                        // how close to a setpoint counts as "about to"
/* DNBR 1.0 IS departure (dnbrOf()), so no setpoint may be set under DNBR_ONSET. */
const DNBR_TRIP_K=0.72, DNBR_ONSET=1.02;
/* A channel NAMES the signal it reads (SIGNAL, trends.js); `thr` is in that signal's own unit. The last column is the cabinet tab. */
/* a permissive is a signal, a comparison and a setpoint, with the words its two blocks carry */
const RPS_GATE_HEAT={sig:"heat", op:"above", at:.3, name:"HEAT PERMISSIVE",
  src:"How hard this core is making heat. The permissive below reads it.",
  note:"Above 30% heat this channel is armed; below it the channel is stood down. Low flow does not protect a core that is making nothing."};
/* P-11, 1970 of 2235 psig (NUREG-1431 Rev. 4, Table 3.3.2-1 Function 1.e) */
const RPS_GATE_P11={sig:"prsf", op:"above", at:.882, name:"P-11 PERMISSIVE",
  src:"The core loop's pressure as a fraction of its own set pressure. The permissive below reads it.",
  note:"Above 88.2% of the loop's set pressure this channel is armed; below it the channel may be blocked for a cooldown, as a real plant blocks it under P-11."};
const rpsFedSg=()=>boilerIds().some(b=>!isDrum(b) && pumpIds().some(p=>secGensOf(p).includes(b)));
const RPS_CH=[
  ["flux","HIGH FLUX","FLUX",   +1, "pwr",  (P_,m)=>110+22*m, null, "CORE"],
  /* The PWR setpoint, or a fixed fraction under what THIS plant commissions at, whichever is lower. */
  ["dnbr","LOW DNBR","DNBR",    -1, "dnbr", (P_,m)=>Math.max(DNBR_ONSET,
                                       Math.min(1.18-0.16*m, P_.dnbr0*DNBR_TRIP_K)), null, "CORE"],
  ["php","HIGH PRESSURE","PRESSURE", +1, "prs", (P_,m)=>P_.P0*(1.06+0.07*m), null, "COOLANT"],
  ["tf","HIGH FUEL TEMP","FUEL",+1, "tf",   (P_,m)=>P_.tdmg+100+280*m, null, "CORE"],
  ["flow","LOW FLOW","FLOW",    -1, "flow", P_=>P_.flowMin*102,      RPS_GATE_HEAT, "COOLANT"],
  ["plp","LOW PRESSURE","PRESSURE",  -1, "prs", P_=>P_.P0*0.86, null, "COOLANT"],
  ["void","CORE VOID","VOID",   +1, "vd",   (P_,m)=>Math.max(.30,P_.vf0+.20)+.15*m, null, "CORE"],
  /* 3 K absolute, or 3 K below what this plant commissioned subcooled by, whichever is lower */
  ["sub","LOW SUBCOOLING","SUBCOOL", -1, "scc", P_=>Math.min(3,P_.sc0-3), null, "COOLANT"],
  /* The two channels a blackout is actually caught on: the pumps coast slower than the void takes the power away. */
  ["turbt","TURBINE TRIP","TURBINE", +1, "turbtr", ()=>0.5,  RPS_GATE_HEAT, "PLANT"],
  ["sglvl","LOW SG LEVEL","LEVEL",   -1, "sglo",   ()=>SG_LOW, null, "PLANT"],
  /* through safety injection (NUREG-1431 Rev. 4, Table 3.3.1-1 Function 18): High-1, 3.6 psig, Table 3.3.2-1 Function 1.c */
  ["cont","HIGH CONTAINMENT P","CONTAINMENT", +1, "cntp", ()=>24.8, null, "PLANT"],
  /* 635 psig against a 6.9 MPa design, Table 3.3.2-1 Function 1.e; a drum plant's low steam pressure shuts its MSIVs instead */
  ["slp","LOW STEAM LINE P","STEAM P", -1, "slp", ()=>0.65, RPS_GATE_P11, "PLANT", rpsFedSg],
];
const rpsOn=r=>!r[8] || r[8]();
const RPS_BY=Object.fromEntries(RPS_CH.map(r=>[r[0],r]));
/* The one door onto a setpoint; `slack` shifts it toward the plant, proportionally. */
const rpsSetOf=(key,slack,K)=>{ const r=RPS_BY[key]; if(!r) return 0;
  K = K || P;
  return r[5](K,K.rpsm)*(1-r[3]*slack); };
/* A bench bag cannot price the two setpoints measured off a settled plant, so those come back null. */
function rpsSetRows(K){
  return RPS_CH.filter(rpsOn).map(([key,name,,dir,sig])=>{
    const v=rpsSetOf(key,0,K||P);
    return {key, name, dir, unit:(SIGNAL[sig]||{}).u||"", val:isFinite(v)?v:null};
  });
}
/* the bench's bag, off the design rather than the last plant commissioned */
const flowMinOf = () => clamp(0.30+0.15*(corePumpCap()-sgCount()),0.15,0.75);
function rpsBenchK(){ const d=derived();
  return {rpsm:D.rpsm, dnbr0:d.dnbr0, P0:d.P0, tdmg:d.f.tdmg, flowMin:flowMinOf()}; }


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
const tempFb = () => Math.abs(P.aM+P.aG+P.aS)+Math.abs(P.pwrDef)/Math.max(P.TfRef-P.Tref,1);
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
/* `spring` set = code safety, worked by the tick; unset = PORV, moved only by a wired RELIEF VALVE sink. */
const fitSpringIn = (f,fid) => !!(f && f[fid] && f[fid].spring);
const fitSpring  = fid => fitSpringIn(P?P.fittings:D.fittings, fid);
/* off the DRAWING alone, for a design-time reader: P is the last plant commissioned and may not carry this valve at all */
const fitSpringD = fid => fitSpringIn(D.fittings, fid);
/* Run-up is a first-order walk at FLOW_TAU; the coast is not - a free rotor's hydraulic torque goes as N^2, so speed falls as 1/(1+t/tau_c). */
const FLOW_TAU=5;      // seconds; PUMP_ROTOR_S is beside pumpRotor() in layout.js
/* There is no invisible lid: nothing fitted to take the steam means the shell takes it, and bursts here. Latched. */
const SG_BURST_K=PIPE_BURST_K;
/* Where the warning and the red start, as a fraction of design-to-burst - the shell has no set point to quote. */
const SG_P_WARN=0.15, SG_P_HI=0.6;
/* Multiples of rated steam a full-bore relief passes at its lift point, times the hole's bore squared. */
const SG_RELIEF_CAP=3.0;
/* What a shell's vents pass wide open, kg/s; keeps id, because a threshold is per-quantity. */
const sgVentRef = id => SG_RELIEF_CAP*ratedSteam();
/* The vent edge carries grammes a second with every spring shut, measured up to 4e-3 kg/s on the stock plant, so the reading is judged against its own reference and never against zero. */
const sgVenting = (id, q) => q > 1e-4*sgVentRef(id);
/* FREG_STROKE is seconds for a full stroke; FREG_SPAN floors the relative error's denominator. */
const FREG_STROKE=4, FREG_SPAN=10;
/* Turbine governor on a direct cycle: a 1 % overpressure asks a 10 % load move; Ti is 3x the RBMK rod regulator's 22.2 s, the outer loop kept out of the inner one's band (no published figure found). */
const PRESS_KP=1000, PRESS_TI=67;
/* Below this the tubes are uncovered and the generator stops being a heat sink. */
const SG_DRY=25;          // %
/* The second step of the same ladder: most of the bundle in steam, and it reads red. */
const SG_DRY_LO=10;       // %
/* Above SG_DRY, so the warning comes before the automatic action rather than with it. */
const SG_LOW=35;          // %
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
  { const bs = boilerIds();
    if(bs.includes(pid(ends[0]))) return 1;
    if(bs.includes(pid(ends[1]))) return -1; }
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
/* P.invKg0 off the drawing where there is one; the correlation is what a bench design with no nodes is worth. */
const loopKg=()=>(P && P.invKg0 > 0) ? P.invKg0
                : P.wRated*LOOP_TRANSIT;
const holdNodeSet = () => new Set(holdTankIds().map(coreFold));
/* The runs landing on a hold tank: they hold what it holds, so they sit at saturation and the subcooling instrument must skip them. */
function holdLineSet(){
  const slot = graphSlot("holdLine"), was = slot.get(1); if(was) return was;
  const set = holdNodeSet(), out = new Set(set);
  for(const r of pipeNetwork()){ const e = runEnds(r.key, r.k); if(!e) continue;
    if(set.has(coreFold(e[0])) || set.has(coreFold(e[1]))) out.add(runNodeOf(r.key)); }
  slot.set(1, out); return out;
}

/* the generators the PLANT has: one nobody piped is a drawing, and the duty is not split over it */
const sgIds=()=>rolePiped("sg");
/* WHAT RAISES THE STEAM: a shell, or a drum on the core's own circuit. In board order, and identically sgIds() where nothing has drawn a drum. Readers of the TUBE side stay sgIds()-only - a drum has no tubes. */
const boilerIds=()=>{ const slot=graphSlot("boilerIds"), was=slot.get(1); if(was) return was;
  const dr=drumIds();
  let out;
  if(!dr.length) out=sgIds();
  else { const have=new Set(sgIds().concat(dr)); out=[];
    for(const p of LAY.parts) if(have.has(p.id)) out.push(p.id); }
  slot.set(1, out); return out; };
const boilerCount=()=>boilerIds().length;
const boilerNode=id=>isDrum(id) ? coreFold(id) : shellNode(id);
const boilerCirc=id=>isDrum(id) ? tankCircuit(id) : shellCirc(id);
/* on a direct cycle the steam side IS the core circuit, so its design pressure is that circuit's own setpoint */
const boilerDesignP=id=>{ if(id!==undefined) return isDrum(id) ? holdSetP(boilerCirc(id)) : sgDesignP(id);
  const ids=boilerIds(); if(!ids.length) return sgDesignP();
  let p=0; for(const q of ids) p+=boilerDesignP(q);
  return p/ids.length; };
/* Is the water in these tubes the core's own - asked of the drawing, so any number of barriers is the same question. */
const sgActive = id => nodeGraph().inCore(id + roleIntern(ROLE.sg)[0].a);
/* the two streams' own swallow keys, structural per machine - cached on the graph (graphSlot()) beside stageInNode's own neighbour lists */
const stageKeysOf = id => { const slot=graphSlot("stageKeys"), was=slot.get(id); if(was) return was;
  const out = roleIns(partOf(id)).map(IN => IN ? "comp:"+id+":"+IN.a+IN.b : null);
  slot.set(id,out); return out; };
const SG_DOME=1.6;   // steam space at 100 % level: a level is read across a downcomer span, not the whole drum
/* the outflow a full-bore severance makes at design pressure, % of loop inventory per second - the scale every break effect is drawn against */
const SPILL_FULL=8.0;
/* damage is four monotonic per-node integrals (s.nDmg, s.nOx, s.nMelt, s.nDisp - core2d.js); a stage is derived off them and never stored */
const FAIL=[
 {k:"intact",lab:"INTACT",    col:()=>C.cyan},
 {k:"tube",  lab:"CHANNEL OPEN",col:()=>C.blue},
 {k:"burst", lab:"CLAD BURST",col:()=>C.amber},
 {k:"oxid",  lab:"OXIDISED",  col:()=>C.red},
 {k:"disp",  lab:"DISPERSED", col:()=>C.h2},
 {k:"molten",lab:"FUEL MELT", col:()=>C.bright},
];
/* a sustained squeeze is not a bang, so it gets the ramp and its own limit */
const ROOM_CRUSH_K=10;
/* core melt latches on a quarter of the fuel volume actually molten */
const MELT_LATCH=0.25;
/* the hydrogen milestone, kg: a few per cent of a stock core's zircaloy wall */
const H2_EV=20;
/* the solve's currency is kilograms, so this is a magnitude; kept as the one door so a caller says whether it wants a signed flow or a rate */
const netKgs = q => Math.abs(q);
// what a pump's own casing edge carried in the reference solve, kg/s - the panel's scale for PASSING
const pumpRefKgs = id => { const k = pumpEdgeKey(id);
  return k && P.netRefByRun && P.netRefByRun[k] ? netKgs(P.netRefByRun[k]) : pumpFlow(id); };
// kg out of the plant, by name. Negative is a boundary feeding it.
const book = (s,name,kg) => { if(kg) s.massOut[name] = (s.massOut[name]||0) + kg; };
/* The INJECT tool's fluid half. It is a boundary the player is holding open, so what it lands on the
   node is booked against `inject` with the sign reversed and the ledger still closes. */
function injectNode(tgt){
  const net = P && P.net;
  if(!net || !tgt) return null;
  if(tgt.indexOf("pipe:") === 0){
    const own = pipeMap().cellOwner[tgt.slice(5)];
    const n = own && own.length && runNodeOf(own[0]);
    return (n && net.index[n] !== undefined) ? n : null; }
  const ns = nodeGraph().nodesOf[tgt];
  return (ns && ns.find(n => net.index[n] !== undefined)) || null;
}

const xeEq = (K,fl) => (K.gI+K.gX)*fl/(K.lamX+K.sig*fl);
/* governor valve stroke plus steam-plant response */
const LOAD_TAU=2;                       // seconds
const RAD_DOSE_K=0.25;
/* a hot field slows a party rather than turning it back; one helper, because the repair block does the slowdown and the damage panel's ETA promises it */
const RAD_SLOW=0.5;
const radWorkK = r => 1/(1+Math.max(0,r-RAD_SLOW)/RAD_SLOW);
/* the trim walks at the bank rate over the tilt span - derived, or the two drift apart the next time the span is retuned */
const tiltRate = K => rodRate(K)/XTILTZ;
const tsat=p=>satT(P.sat,p);
/* where T-avg is meant to sit for the load the turbine is drawing; a plant whose pressure is its saturation temperature has a flat programme */
const TPROG_SPAN=18;                    // K of programme across the load range

/* a coolant pump answers the plant-wide lever, any other pump only for itself; a standby train commissions stopped, asked of the drawing rather than written into D.start */
const pumpDem0 = id => pumpStandby(id) ? 0 : 1;

/* not on S: restoreS() replaces the whole state object, so S identity cannot tell "scrubbed" from "recommissioned" */
let plantGen=0;
function resetPlant(){
  plantGen++;
  engReset();
  LOG=[]; logResync(); initHist();
  if(typeof pipeReset==="function") pipeReset();
  if(typeof fxReset==="function") fxReset();
  logE("info","PLANT AT POWER",
    P.name+" commissioned at "+P.rated.toFixed(0)+" MWt, holding "+(P.n0*100).toFixed(1)+"% - pipe run and pump head decide how much of the rating the loop can actually carry. Everything that happens from here is logged with the reason.");
}
function step(dt){
  engStep(dt);
  logDrain();
}
/* one pressure colour for every readout, on the annunciator's own thresholds, so a gauge cannot disagree with the alarm beside it */
const pColor = v => v > P.P0*1.05 ? C.red : v < P.P0*0.935 ? C.amber : C.cyan;
const ANN=[
 ["HI FLUX","red",null,
  "The reactor is making more than 112% of its rated power. You are outside the design envelope and the fuel is being pushed harder than it was built for. Reduce load or insert rods.","core"],
 ["LO DNBR","red",null,
  "Departure from Nucleate Boiling Ratio has fallen below 1.30. The cooling water is close to boiling into a continuous film on the fuel rods, which would stop heat transfer almost instantly. Raise pump flow, raise pressure, or cut power. Note that flow means PUMP flow: buoyancy circulation removes heat but barely moves the water, so it buys almost no DNBR.","core"],
 ["FUEL DMG","red",null,
  "Fuel cladding has failed somewhere in the core. This is permanent, it puts radioactive fission products into the coolant, and it only gets worse. Nothing you do now un-breaks it.","core"],
 ["LO PRESS","amber",null,
  "Primary loop pressure has dropped below 93% of normal. Either you are leaking coolant, or the pressurizer sprays are overcooling the steam bubble. Pressure is what stops the loop boiling, so this matters.","pzr"],
 ["HI PZR LVL","amber",null,
  "Pressurizer water level above 78%. Either the loop genuinely has too much water in it, or steam forming in the core is pushing water up into the pressurizer while the loop actually empties. Check subcooling to tell which.","pzr"],
 ["LO SUBCOOL","red",null,
  "Less than 8 degrees of margin before the coolant boils. This is the alarm that does not lie about inventory. If this is lit and pressurizer level looks fine, believe this one.","pzr"],
 /* P.vessel first: a ship with no reactor cannot be out of balance with its turbine */
 ["TAVG DEV","amber",null,
  "Average coolant temperature is more than 4 K away from where it should be for the current load. The reactor and the turbine are not in balance: one is making more heat than the other is taking.","rods"],
 ["XENON PIT","blue",null,
  "Xenon-135 has built up past 3200 pcm of negative reactivity. This poison eats neutrons, and until it decays you may physically be unable to restart or raise power no matter how far you pull the rods.","core"],
 ["RECRITICAL","red",null,
  "A tripped core is on its way back to critical with the bank fully inserted. Xenon shut this reactor down as much as the rods did, and xenon decays. Nothing but boron will hold it now, and if it gets there before you do it will come back to power against a turbine that is not taking any.","core"],
 ["ROD JAM","amber",null,
  "The control rods are not moving when commanded. Your fast reactivity handle is gone. You now control the reactor only with boron, coolant temperature and load.","rods"],
 ["PORV OPEN","red",null,
  "The pressure relief valve on top of the pressurizer is passing flow. If you did not command it open, you are dumping primary coolant overboard right now. Close the block valve.","pzr"],
 ["CORE VOID","red",null,
  "Steam pockets are forming inside the core where liquid water should be. Steam cannot carry heat away, so fuel temperature climbs fast even though reactor power may be falling.","core"],
 ["RX TRIP","red",null,
  "A scram has occurred and the control rods are fully inserted. The reactor is shut down. Expect a xenon buildup that will keep it shut down for the next few minutes.","rods"],
 ["HI PRESS","red",null,
  "Primary pressure above 105% of normal. The relief valve will lift shortly. Sustained overpressure past about 122% bursts the vessel outright, and every point of vessel fatigue lowers that threshold.","pzr"],
 ["CAVITATION","amber",null,
  "The water arriving at the coolant pumps is close to boiling, so the pumps are churning vapour instead of liquid. Actual flow is far below what the bench says. Raise pressure or cool the loop.","pump"],
 /* no heat guard here, unlike tripCause(): the tile is information, and it is wanted most when protection has been defeated */
 ["LO FLOW","amber",null,
  "Coolant flow is below the design floor for the pumps fitted. With protection armed the reactor trips here. Bypassed, the fuel is cooled by buoyancy alone, and that is all the cooling there is.","pump"],
 ["NO RPS","amber",null,
  "Nothing in the control cabinet lands on a scram. Nothing is watching flux, DNBR, pressure, fuel temperature, flow or void on your behalf. You are the protection system.","ctrl"],
 ["RX BREACH","red",null,
  "The pressure vessel has ruptured. Coolant is leaving faster than anything can replace it. This is unrecoverable.","core"],
 ["BLACKOUT","amber",null,
  "Main power to the coolant pumps is lost. Flow is now limited to your backup power supply plus whatever natural circulation the core geometry generates.",null],
 ["CORE MELT","red",null,
  "A quarter of the fuel is molten. Unrecoverable. Reset the plant.","core"],
 /* every row below is appended, because help.js numbers the tiles by array index and an insert renumbers the rest */
 /* a shell above the set point whether or not anything was fitted to answer it, which is the case worth being told about */
 ["SG HI PRES","red",null,
  "A steam generator is over its design shell pressure. If a relief valve is fitted it is passing steam to atmosphere, and the water going with it is not coming back. If one is NOT fitted, the shell bursts at 1.5x design. Find what is stopping the steam: a shut steam line, a drowned or isolated condenser, or a turbine that is not passing.","sg"],
 ["SG BURST","red",null,
  "A secondary shell has ruptured. It is open to atmosphere, it will not hold pressure again, and it stops cooling its loop the moment it is empty. If those tubes were leaking, what is going out of the hole is primary water.","sg"],
 /* the two steps of boiling a shell dry, on the same numbers the mimic's banner and the removal term read */
 ["LO SG LVL","amber",null,
  "A steam generator is below "+SG_LOW+"% and falling. Nothing is uncovered yet: this is the warning ahead of it, and emergency feedwater does not start until "+SG_DRY+"%. Feed it - check the feed pump, the regulating valve and the hotwell before you assume the pump has failed.","sg"],
 ["SG DRY","red",null,
  "A steam generator is below "+SG_DRY_LO+"%. Most of the bundle is in steam and that loop is not cooling the core any more. If every generator reads this, the only heat sink left is what leaks out of the boundary.","sg"],
 ["HOTWELL HI","red",null,
  "The hotwell is above "+E_HOT_FLOOD+"% and the water in it is drowning the tubes that do the condensing. The condenser is losing capacity as it fills, so backpressure rises, the turbine takes less steam, and the shells pressurise behind it. Drain it or stop putting water into it.","cond"],
 ["TURB TRIP","red",null,
  "Exhaust pressure got past what the machine will run against, so the stop valve is shut and the turbine is passing no steam. The reactor is still making heat. Find the heat sink: circulating water, a drowned hotwell, or a condenser that has been hit.","turb"],
 ["NO VACUUM","red",null,
  "The condenser reached atmospheric pressure and relieved. It is open to the room, it will not hold vacuum again, and it has stopped being a heat sink. Everything the generators raise now goes out of their safety valves, and the water goes with it.","cond"],
 ["ROD LIMIT","amber",null,
  "The automatic rod controller is asking for rod travel the commissioned band will not give it, and coolant temperature is off programme because of it. It has no authority left in that direction. Move load, move boron, or widen the band at the design bench - the band is not a safety limit, it is how much room the controller was given.","rods"],
 ["NEAR TRIP","amber",null,
  "A protection setpoint is within "+(RPS_NEAR*100).toFixed(0)+"% of tripping the reactor. The component itself names which one. This is a warning, not the trip: nothing has latched yet and the condition is still yours to clear.","core"],
 ["AREA RAD","amber",null,
  "The control room is reading above 1x background. That number is set both by what has failed on the plant and by where you put the shielding at the bench - a well-shielded control room can sit this out through a release that would light this tile instantly on a poorly sited one. A repair party out on the plant right now is being spent while this is lit, faster the closer the job sits to whatever is shining.","ctrl"],
 ["CLAD OXID","red",null,
  "Steam is burning the zirconium cladding, and it is now making more heat than the chain reaction is. This reaction feeds itself: the hotter the metal gets the faster it burns, and no rod, no pump and no valve on this ship stops it. It ends when the cladding is gone. It also makes hydrogen.","core"],
 ["FUEL MELT","red",null,
  "Fuel pellets somewhere in the core are liquid. This is past cladding failure - the fuel itself has gone, and the damage map on the reactor panel says which part of the core. CORE MELT latches when a quarter of it is molten.","core"],
 /* hosted on the control cabinet: the room is a plant-wide fact, and that is where plant-wide facts light */
 ["HI ROOM T","red",null,
  "A machine somewhere on the plant is standing in air hotter than it was built for, and it is being cooked at a rate you can watch. Heat is a place: it comes off every hot surface, it comes in a flood out of anything venting steam into the room rather than into a tank, it collects where a compact layout gives it nowhere to go, and the only sink is the hull. Find what is putting heat in, or fit something that takes it out.","ctrl"],
 /* whether it is alight RIGHT NOW, a different question from whether it could light; s.roomBurnOn is the flame count the burn pass already keeps */
 ["H2 FIRE","red",null,
  "Hydrogen is burning in the compartment right now. It stops when the fuel runs out or the air does - a sealed room smothers its own fire - and until then it keeps heating the machines and raising the pressure that breaks them. The OXYGEN layer says which way it is going.","ctrl"],
 ["H2 LFL","red",null,
  "Hydrogen off the cladding has escaped the primary with the steam and is now over 4% by volume somewhere in the compartment. Above 773 K it lights itself - no spark needed - and it burns at 120 MJ per kilogram into the room it is standing in. This is the Fukushima sequence.","ctrl"],
 /* the panels are the heat sink out here, so this tile says the chain has come apart at the far end rather than in the plant */
 ["NO SINK","red",null,
  "Nothing on this ship is radiating. Every panel is destroyed, or walled in where it cannot see the skin, or there is no panel at all. Heat leaves this ship as light or it does not leave. The condenser will climb until it loses vacuum and the turbine trips, and after that the generators go to their safety valves.","cond"],
 ["PANEL HI T","amber",null,
  "The radiator is running hot enough that the condenser behind it is close to the pressure the turbine will not exhaust against. Rejection goes as the fourth power of panel temperature, so the last few kelvin cost far more than the first: cut reactor power, or accept the trip.","cond"],
 /* its own tile, because the two fires share only the air they burn: this one is a pool, it needs no spark, and no fan takes it away */
 ["NA FIRE","red",null,
  "Sodium is burning on the deck. It came out of a pipe at over 600 K, which is hundreds of degrees past the temperature it lights itself at, so nothing had to ignite it. It burns until the pool is gone or the bay's oxygen is - the OXYGEN layer says which way it is going - and while it burns it cooks every machine around it and eats the air. A spray from a small hole burns far faster than a puddle from a large one, and water makes it worse.","ctrl"],
/* one tile per system the cabinet carries and is not running; the host is lazy, because LAY does not exist while this table is built */
 ["RPS OFF","amber",null,
  "The protection system is wired and switched off at the cabinet. Automatic trips are defeated. Nothing will shut this reactor down for you.",()=>roleId("ctrl")],
 ["NO RUNBACK","amber",null,
  "The turbine runback is wired and switched off at the cabinet. A trip no longer sheds load, so the turbine will keep drawing steam from a dead core and chill the loop.",()=>roleId("turb")],
];

// read at CALL time: the sim-only subset has no palette at load (nodom-probe.js)
const annSevCol = sev => sev==="red" ? C.red : sev==="amber" ? C.amber : C.blue;
