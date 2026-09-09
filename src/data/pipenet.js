"use strict";

/* mm; every conductance in this file is linearised about BORE_REF */
const BORE_REF = 750;
/* mm: the bore that carries w kg/s of a fluid at rho at the design velocity v. The one expression a bore is ever produced by. */
const boreForW = (w, rho, v) => Math.round(
  Math.sqrt(4*Math.max(w,0)/(Math.PI*Math.max(rho,1e-3)*Math.max(v,1e-3)))*1000);
/* m/s. Erosion sets the liquid figure, and it sits inside both a 2 m/s circulating-water conduit and a 5 m/s feed line; pressure drop sets the vapour one. A primary leg states its own (COOLANT[].vLeg). */
const V_LIQ = 3, V_VAP = 50;
/* A suction line is one size up, for NPSH. */
const SUC_BORE_K = 2;
const legBoreMm = () => { const a = COOLANT[priD().cool];
  return boreForW(legDutyKgs(), a.dens*RHO_K, a.vLeg); };
/* P before D: a fitting resized after commissioning must not move the plant that is running */
const fitBoreMm = fid => { if(BORE_NOM) return fitBoreSuggest(fid);
  const f = (typeof P!=="undefined" && P) ? P.fittings : D.fittings;
  return (f && f[fid] && f[fid].bore) || fitBoreSuggest(fid); };
/* cached for one design pass: shellsOf() is a graph walk */
let fitBoreCache = {}, fitBorePass = -1;
const fitBoreSuggest = fid => {
  /* a tee is a piece of the line it stands in, so it is as wide as the widest run landing on it */
  if(fitModeOf(fid) !== "relief"){
    let v = 0;
    for(const r of pipeNetwork())
      if(r.a === fid || r.b === fid) v = Math.max(v, runBoreMm(r));
    return v > 0 ? v : FIT_BORE0; }
  const pn = layPass();
  if(pn && fitBorePass !== pn){ fitBoreCache = {}; fitBorePass = pn; }
  if(pn && fitBoreCache[fid] !== undefined) return fitBoreCache[fid];
  const shells = shellsOf(fid);
  let v = FIT_BORE0;
  if(shells.length && sgCount() > 0){
    /* the DRAWING's setpoint: a suggestion is a figure about the plant being drawn, and designBake() runs where P is the last plant commissioned */
    const ci = shellCirc(shells[0]), lift = reliefSetD(fid).lift;
    const rho = rhogOf(satOfCirc(ci), tsatSec(lift, ci));
    const peers = reliefFitsD().filter(o => fitSpringD(o) && shellsOf(o).some(id => shells.includes(id))).length;
    const want = plantSteam()*shells.length/sgCount()/Math.max(peers, 1);
    const area = want/(ORIF_CD*Math.sqrt(2*Math.max(rho,1e-3)*(1-RCRIT)*lift*1e6));
    if(isFinite(area) && area > 0) v = Math.sqrt(4*area/Math.PI)*1000;
  }
  if(pn) fitBoreCache[fid] = v;
  return v; };
const fitBoreK  = fid => fitBoreMm(fid)/BORE_REF;
/* the reference plant is piped at the bore each run and fitting SHIPS at */
let BORE_NOM = false;
const withNomBore = fn => { BORE_NOM = true; try { return fn(); } finally { BORE_NOM = false; } };
/* never the derived key as well: a cut neighbour's orphaned bore would land on the next run laid on the same faces */
const runIdOf = r => r.rid !== undefined ? r.rid : r.key;
/* The parts the run's OWN two end cells land on, never what stands beyond a fitting: walk through and a header takes the smallest duty on the far side of the tee. */
const runEndParts = r => { const ends = runEnds(r.key, r.k); if(!ends) return [];
  const out = [];
  for(const n of ends){ const p = partOf(n) || partOf(n.slice(0,-1));
    if(p) out.push({p, face: n.slice(p.id.length)}); }
  return out; };
/* kg/s the run has to carry: the SMALLEST figure either end states. The minimum is what tells an injection line from the leg it is teed into. null where no end states one. */
/* kg/s ONE machine face states, which is what both a pipe bolted to it and its own casing are sized for. A fitting is transparent and states nothing. */
const endDutyKgs = (p, face, vap) => { const R = ROLE[p.role];
  if(!R || p.role === "fitting") return 0;
  if(p.role === "pump")        return pumpFlow(p.id);
  if(p.role === "turb")        return turbKgs(p.id);
  if(p.role === "tank")        return tankKg(p.id)/RESERVE_T;
  if(p.role === "radiator")    return cwDutyKgs();
  if(R.sgtr)                   return onStage(p.id, face, 1)
                                    ? plantSteam()/Math.max(1, sgCount()) : legDutyKgs();
  if(R.thermal === "sink")     return vap ? plantSteam()/Math.max(1, condCount()) : cwDutyKgs();
  if(R.internal || R.thermal === "source") return legDutyKgs();
  return 0; };
const runDutyKgs = r => {
  const vap = edgeLaw(r) === LAW_VAPOUR;
  let w = null;
  for(const {p, face} of runEndParts(r)){ const v = endDutyKgs(p, face, vap);
    if(v > 0 && (w === null || v < w)) w = v; }
  return w; };
/* The vessel the run's own end states, so a turbine exhaust comes out wide and a steam line narrow. */
const runVapP = r => { let p = null;
  for(const {p: part} of runEndParts(r)){ const R = ROLE[part.role];
    const q = R && R.sgtr ? sgDesignP(part.id) : (R && R.thermal === "sink") ? condPDes() : null;
    if(q > 0 && (p === null || q < p)) p = q; }
  return p === null ? sgDesignP() : p; };
/* A relief line is the valve's own bore: it is sized off what it protects, and nothing either end of it states that. */
const runReliefBore = r => { for(const {p} of runEndParts(r))
    if(p.role === "fitting" && fitModeOf(p.id) === "relief") return fitBoreMm(p.id);
  return null; };
const runBoreSuggest = r => {
  const rel = runReliefBore(r); if(rel !== null) return rel;
  const w = runDutyKgs(r); if(w === null) return BORE_REF;
  const vap = edgeLaw(r) === LAW_VAPOUR, ci = runCircOf(r);
  const mm = boreForW(w, circDesRho(ci, vap, vap ? runVapP(r) : 0),
                      vap ? V_VAP : runOnLeg(r) ? circCoolOf(ci).vLeg : V_LIQ);
  return runOnSuction(r) ? SUC_BORE_K*mm : mm; };
/* an unauthored circuit - every secondary and every circulating-water circuit on the board - is WATER, never the primary's fluid */
const circCoolOf = ci => circCool(ci) || COOLANT[0];
const circDesRho = (ci, vap, pVap) => vap
  ? rhogOf(satOfCirc(ci), satT(satOfCirc(ci), pVap)) : circCoolOf(ci).dens*RHO_K;
/* A run landing on a pump's suction face; and a primary LEG, which is the only run a coolant states its own velocity for. */
const runOnSuction = r => runEndParts(r).some(({p, face}) =>
  p.role === "pump" && pumpSucNode(p.id) === coreFold(p.id+face));
const runOnLeg = r => { const ci = runCircOf(r);
  return ci >= 0 && coreOnCirc(ci).length > 0; };
const runBoreMm = r => { const k=runIdOf(r);
  return (!BORE_NOM && D.bore && D.bore[k] !== undefined) ? D.bore[k] : runBoreSuggest(r); };
const runBore = r => runBoreMm(r)/BORE_REF;
const runVol = r => Math.PI/4*Math.pow(runBoreMm(r)/1000, 2)*r.L;
/* m^3 of fluid off the box where the machine does not state it */
const PART_VOL_CELL = 0.35;
function partVol(pid){
  const p = partOf(pid); if(!p) return 0;
  if(p.role === "tank") return Math.max(0.1, (D.tanks[pid]||{vol:0}).vol);
  if(p.role === "sg")   return Math.max(0.1, sgRowOf(pid).water + sgRowOf(pid).tubeV);
  return Math.max(0.1, p.w*p.h*PART_VOL_CELL);
}
/* The holdup of ONE node, because a machine with two internal paths holds two different inventories and splitting one figure over both puts the shell's water inside the tubes. Everything with a single path answers the even share it always did. */
function nodeVol(pid, nid, list){
  const p = partOf(pid); if(!p) return 0;
  if(p.role !== "sg") return partVol(pid)/Math.max(1, list.length);
  const face = nid.length > pid.length ? nid.slice(pid.length) : null;
  const IN = roleIntern(ROLE.sg);
  const tube = face !== null && (face === IN[0].a || face === IN[0].b);
  /* the shell's own water is added to its steam face in netFinish(); both shell-path nodes are nozzles here */
  return tube ? sgRowOf(pid).tubeV/2 : Math.max(0.1, p.w*p.h*PART_VOL_CELL)/2;
}

/* m^2 the path passes: its own face's duty at the velocity its ROLE row states. A bundle's flow area is not its nozzle's, which is why the velocity is the path's and not the pipework's. */
const pathAreaSuggest = (pid, IN) => { const p = partOf(pid); if(!p) return 0;
  const vap = !!(IN.vap && IN.vap.indexOf("a") >= 0);
  const w = endDutyKgs(p, IN.a, vap); if(!(w > 0)) return 0;
  const ci = circOfNode(coreFold(pid+IN.a));
  return w/(circDesRho(ci, vap, vap ? sgDesignP() : 0)*IN.v); };
/* The water inside a machine has to be accelerated like the water in a pipe: I = L/A on the path's OWN duct. A path that is not a duct - a shell pool, a hotwell, a turbine's exhaust space - states no velocity and has no inertance, because that water's momentum is not the nozzle's. */
const partPathI = (pid, IN) => { if(!(IN.v > 0) || !(IN.len > 0)) return 0;
  const A = pathAreaSuggest(pid, IN);
  return A > 0 ? IN.len/A : 0; };
/* a MASS term only - nothing here may reach a conductance */
const STEEL_RHO = 7850;    // kg/m^3
const ALPHA_STEEL = 1e-5;  // m^2/s, thermal diffusivity of a pressure-vessel steel
const STEEL_S   = 138;     // MPa allowable stress, carbon steel at temperature
const STEEL_A   = 1.8e-5;  // 1/K linear expansion, austenitic steel
const WALL_CORR = 3;       // mm of corrosion/handling allowance under any pressure
// wider than layoutMetrics()'s `pipe` bucket: that one asks what is in the LOOP hydraulically
const PRIMARY_K = {hot:1, cold:1, surge:1, hpi:1, relief:1, boron:1};
// Barlow: t = P*D/(2*S)
const wallSuggestMm = (boreMm, pMPa, c) =>
  pMPa*boreMm/(2*STEEL_S/((c&&c.pipeK)||1)) + WALL_CORR;
// cached for one pass: the burst test asks it of every run every tick
let feedHeadCache = 0, feedHeadPass = -1;
const feedHeadMax = () => { const pn = layPass();
  if(pn && feedHeadPass === pn) return feedHeadCache;
  let h = 0;
  /* a feed line is walled for the worst its own pump can reach, and that is its SHUTOFF head - what it puts on the line the moment the regulating valve shuts */
  for(const id of pumpIds()) if(secGensOf(id).length) h = Math.max(h, pumpHead(id)*(1 + PUMP_DROOP));
  if(pn){ feedHeadCache = h; feedHeadPass = pn; }
  return h; };
/* the column is against the TOP of the circuit: the anchor is a solved quantity and this is asked with no S */
const circSetP = n => { const ci = circOfNode(n);
  return (ci === null || ci === undefined) ? 0 : holdSetP(ci); };
const circTopZ = ci => { const s = graphSlot("circTopZ"), was = s.get(ci);
  if(was !== undefined) return was;
  const G = nodeGraph(); let hi = -Infinity;
  for(const pid in G.nodesOf) for(const n of G.nodesOf[pid]){
    if(G.circuit[n] !== ci) continue;
    const z = nodeZ(n); if(z !== null && z > hi) hi = z; }
  s.set(ci, hi); return hi; };
// kg/m^3 at the design point, asked of D so the bench gets the same answer with no P
const rhoDesign = () => COOLANT[priD().cool].dens*RHO_K;
const colAt = n => { const ci = circOfNode(n);
  if(ci === null || ci === undefined) return 0;
  const z = nodeZ(n), top = circTopZ(ci);
  return (z === null || !isFinite(top)) ? 0 : rhoDesign()*G_MPA*Math.max(top - z, 0); };
const runCircOf = r => { const ends = runEnds(r.key, r.k);
  return ends ? circOfNode(coreFold(ends[0])) : -1; };
const runDesignP = r => {
  const ends = runEnds(r.key, r.k);
  const ci = ends ? circOfNode(coreFold(ends[0])) : -1;
  if(!circAuthored(ci)) return Math.max(sgDesignP(), feedHeadMax());
  let p = holdSetP(ci);
  const at = new Set(ends.map(coreFold)), G = nodeGraph();
  for(const n of at) p = Math.max(p, circSetP(n) + colAt(n));
  for(const id of tankIds())
    if((G.nodesOf[id]||[]).some(m => at.has(coreFold(m)))) p = Math.max(p, tankDesignP(id));
  /* a loop tapped at the pump suction runs a whole head over its setpoint */
  for(const id of pumpIds()){ const dis = pumpDisNode(id);
    if([...at].some(n => circOfNode(n) === circOfNode(dis)))
      p = Math.max(p, circSetP(dis) + colAt(dis) + pumpHead(id)); }
  return p;
};
const runWallMm = r => { const k=runIdOf(r);
  return (D.wall && D.wall[k] !== undefined) ? D.wall[k]
       : wallSuggestMm(runBoreMm(r), runDesignP(r), circCool(runCircOf(r))); };
// t/m of a cylindrical shell
const shellTPerM = (boreMm, wallMm) =>
  Math.PI*(boreMm+wallMm)/1000*(wallMm/1000)*STEEL_RHO/1000;
const runMassPerM = r => shellTPerM(runBoreMm(r), runWallMm(r));
/* CLR: fuel to shell gap, metres of radius. HEAD_K: how much thicker a head is than the side */
const VESSEL_CLR = 0.55, VESSEL_HEAD_K = 1.6;
// mm, the plate a vessel this size is rolled from
const VESSEL_WALL_MIN = 25;
const vesselDiaM = cD => { const L = (typeof latM === "function") ? latM(cD || priD()) : null;
  return ((L && L.dia) || 3) + 2*VESSEL_CLR; };
const vesselHgtM = cD => { const L = (typeof latM === "function") ? latM(cD || priD()) : null;
  return ((L && L.hgt) || 4) + 2*VESSEL_CLR; };
const vesselWallSuggest = (p0, c, cD) => Math.max(VESSEL_WALL_MIN, wallSuggestMm(vesselDiaM(cD)*1000, p0, c));
const vesselWallMm = (p0, c, cD) => { const d = cD || priD();
  return (d && d.wall) || vesselWallSuggest(p0, c, cD); };
const vesselRating = (p0, c, cD, wallMm) =>
  2*(STEEL_S/((c&&c.pipeK)||1))*Math.max((wallMm ?? vesselWallMm(p0, c, cD))-WALL_CORR, 0)/(vesselDiaM(cD)*1000);
const vesselBurstP = (p0, c, cD) => vesselRating(p0, c, cD)*PIPE_BURST_K;
function vesselShellMass(p0, c, cD, wallMm){
  const dM = vesselDiaM(cD), hM = vesselHgtM(cD);
  const w = (wallMm ?? vesselWallMm(p0, c, cD))/1000;
  const area = Math.PI*dM*hM + 2*(Math.PI/4)*dM*dM*VESSEL_HEAD_K;
  return area*w*STEEL_RHO/1000;
}
const TUBE_BORE_PITCH = 0.32, CAV_VOID = 0.15, SHIELD_THK = 3, SHIELD_RHO = 2500;
const tubeOf = cD => ((cD || priD()) && (cD || priD()).tube) || null;
const tubeBoreSuggest = cD => { const c = cD || priD(); return TUBE_BORE_PITCH*((c.lat && c.lat.pitch) || 0)*1000; };
const tubeBoreMm = cD => { const t = tubeOf(cD); return (t && t.bore) || tubeBoreSuggest(cD); };
const tubeWallSuggest = (p0, c, cD) => wallSuggestMm(tubeBoreMm(cD), p0, c);
const tubeWallMm = (p0, c, cD) => { const t = tubeOf(cD); return (t && t.wall) || tubeWallSuggest(p0, c, cD); };
const tubeRating = (p0, c, cD, wallMm) =>
  2*(STEEL_S/((c&&c.pipeK)||1))*Math.max((wallMm ?? tubeWallMm(p0, c, cD))-WALL_CORR, 0)/Math.max(tubeBoreMm(cD), 1);
const tubeBurstP = (p0, c, cD) => tubeRating(p0, c, cD)*PIPE_BURST_K;
const tubeCount = cD => { const L = (typeof latM === "function") ? latM(cD || priD()) : null; return (L && L.nAsm) || 0; };
function tubeMass(p0, c, cD, wallMm){ const d = cD || priD(), L = latM(d);
  const w = (wallMm ?? tubeWallMm(p0, c, d))/1000, b = tubeBoreMm(d)/1000;
  return L.nAsm*Math.PI*(b+w)*w*L.hgt*ZR_RHO/1000; }
const cavAreaM2 = cD => Math.PI/4*Math.pow(vesselDiaM(cD), 2);
const cavVolSuggest = cD => cavAreaM2(cD)*vesselHgtM(cD)*CAV_VOID;
const cavVolM3 = cD => { const t = tubeOf(cD); return (t && t.cavVol) || cavVolSuggest(cD); };
const shieldSuggest = cD => cavAreaM2(cD)*SHIELD_THK*SHIELD_RHO/1000;
const shieldT = cD => { const t = tubeOf(cD); return (t && t.shieldT) || shieldSuggest(cD); };
const shieldLiftP = cD => shieldT(cD)*1000*G_MPA/cavAreaM2(cD);
const CAV_LIFT_K = 0.5, CAV_RESEAT_K = 0.8;
/* m^2: the hole passing one channel's discharge */
const cavReliefC = (cid, c, one) => {
  const ci = coreCircOf(cid), p0 = holdSetP(ci), sat = satOfCirc(ci), pc = (typeof P!=="undefined" && P) ? P.Pcont : 0.1;
  const w1 = flowW(one, rhofOf(sat, satT(sat, p0)), p0, pc);
  const pl = pc + shieldLiftP(c)*CAV_LIFT_K;
  const per = flowW(1, rhogOf(sat, satT(sat, pl)), pl, pc);
  return per > 0 ? w1/per : 0; };

// MPa, fitted: the head a pump nobody has sized suggests
let PUMP_H0 = 0.60;
// a sweep scale on every head, pump and static column alike; the game never moves it
let HEAD_K = 1;
function setPumpH0(v){ PUMP_H0 = v; }
function setHeadK(v){ HEAD_K = v; }

// gravity, MPa per (kg/m^3 x metre)
const G_MPA = 9.81e-6;
// RHO_K turns COOLANT[].dens (water = 100) into kg/m^3; RHO_BETA is DESIGN-time only, the solve asks each node's own (p, h)
const RHO_K = 7, RHO_BETA = 2.4e-3;
const rhoAt = T => P.rho0 * (1 - RHO_BETA*(T - P.Tref));

// metres, the floor under every run's length: a zero-length run still has to cost something
const NET_COMP_LEN = 0.1;

const PIPE_FRIC = 0.02;      // Darcy factor before there is a flow to read
const RCRIT     = 0.55;      // steam's critical pressure ratio
const DPFRAC    = 0.00005;   // floor on dp, a FRACTION never an absolute
const ORIF_CD   = 0.61;      // sharp-edged orifice
/* Haaland; Re floored so a stopped leg keeps a finite coefficient and can restart */
const PIPE_ROUGH = 4.5e-5;   // commercial steel
const K_BEND = 0.3, K_ENTRY = 0.5, K_EXIT = 1.0;
const RE_FLOOR = 500;
const fricOf = (bore, w, mu) => {
  if(!(w !== undefined && mu > 0)) return PIPE_FRIC;
  const D = boreM(bore), Re = Math.max(4*Math.abs(w)/(Math.PI*D*mu), RE_FLOOR);
  if(Re < 2300) return 64/Re;
  const r = -1.8*Math.log10(Math.pow(PIPE_ROUGH/D/3.7, 1.11) + 6.9/Re);
  return 1/(r*r);
};
const boreM = bore => Math.max(bore*BORE_REF/1000, 0.01);
const areaOf = bore => Math.PI/4*boreM(bore)*boreM(bore);
/* m^2; infinite length reaches exactly 0, which is how a severed pipe says there is no pipe */
const pipeC = (bore, L, K0, f) => {
  const K = (f === undefined ? PIPE_FRIC : f)*Math.max(L, NET_COMP_LEN)/boreM(bore) + (K0||0);
  return isFinite(K) && K > 0 ? areaOf(bore)/Math.sqrt(K) : 0;
};
// an orifice has no length term, only its own area
const holeC = bore => ORIF_CD*areaOf(bore);
// the path through a component's own body, plus the loss its ROLE states for its internals
const COMP_C = pipeC(1, NET_COMP_LEN);
const compC = K => K > 0 ? pipeC(1, NET_COMP_LEN, K) : COMP_C;
const runK0 = r => {
  const endK = pid => { const p = partOf(pid), R = p && ROLE[p.role];
    return R && R.kEnd !== undefined ? R.kEnd : (K_ENTRY + K_EXIT)/2; };
  return K_BEND*Math.max(0, (r.pts ? r.pts.length : 2) - 2) + endK(r.a) + endK(r.b);
};
/* kg/s an opening WOULD pass at a stated pair of pressures, not what the field says it does */
const flowW = (C, rho, pHi, pLo) => C > 0
  ? C*Math.sqrt(2*Math.max(rho,1e-3)*Math.max(Math.min(pHi-pLo, (1-RCRIT)*Math.max(pHi,0)), 0)*1e6)
  : 0;
let FLOWG_CHOKE = false;          // set by flowG(), spent by edgeG() on the next line
const flowG = (C, F, u, v, h, diode, hSrc, chokeAt, gasAt) => {
  FLOWG_CHOKE = false;
  if(!(C > 0)) return 0;
  /* the differential carries the head, because netFlows() carries Q = g*(p_u - p_v + h) */
  const d = F.p[u] - F.p[v] + h;
  const a = Math.abs(d);
  // the DONOR node
  const up = d >= 0 ? u : v;
  /* the choke is an expansion: a fraction of the higher PRESSURE, never of the donor's */
  const pHi = Math.max(F.p[u], F.p[v], 1e-4);
  const floor = DPFRAC*pHi;
  const act = Math.max(a, floor);
  /* only a vapour expands, only where no head SOURCE drives the edge, and only once per duct: `chokeAt` is the run's own node, so only the half leaving by it expands */
  const choke = !hSrc && F.x && F.x[up] > 0 && (chokeAt === undefined || up === chokeAt);
  const eff = Math.max(choke ? Math.min(a, (1-RCRIT)*pHi) : a, floor);
  FLOWG_CHOKE = choke && (1-RCRIT)*pHi < a;
  /* a spent node feeds nothing; the DONOR's bit, so the same edge still fills it back up */
  if(F.wet && !F.wet[up]) return 0;
  /* a check valve is signed: +1 passes u->v only */
  if(diode && d*diode < 0) return 0;
  /* a nozzle in the steam space passes the steam's own density, not the vessel's mixture. F.void is a vessel whose free SURFACE says there is a space over it: at the condenser's vacuum the quality of a half-full pool is 7e-5 and a bare x > 0 pulls the hotwell out through the exhaust duct. */
  const rho = gasAt === up && (F.x[up] > 0 || F.void[up]) ? F.rhoG[up] : F.rhoD[up];
  const w = C*Math.sqrt(2*Math.max(rho, 1e-3)*eff*1e6);
  return w/act;
};
// per-net scratch, reused across solves
const scratch = (net, k, n, Ctor, v) => { const b = net.scr || (net.scr = {}); let a = b[k];
  if(!a || a.length !== n) a = b[k] = new Ctor(n); a.fill(v); return a; };
/* the field the law is linearised about: one tick old on purpose, and per net */
const netFieldOf = () => ({p:null, rho:null, rhoD:null, rhoG:null, void:null, x:null, wet:null, mu:null});
function netFieldSize(F, n){
  F.p = new Float64Array(n).fill(typeof P!=="undefined" && P ? P.P0 : 1);
  F.rho = new Float64Array(n).fill(typeof P!=="undefined" && P && P.rho0 ? P.rho0 : 700);
  /* what the DONOR is actually carrying, which is not always what (p,h) says it should be. Only flowG reads this; netStore() needs the EOS read, because its whole job is the residual between the two. */
  F.rhoD = new Float64Array(n).fill(typeof P!=="undefined" && P && P.rho0 ? P.rho0 : 700);
  // a vessel whose free surface is tracked as a level: there is a space over it whatever (p,h) says
  F.void = new Uint8Array(n);
  // only a node a steam nozzle stands on ever fills this in (netFieldUpdate)
  F.rhoG = new Float64Array(n);
  F.x = new Float64Array(n);
  F.wet = new Uint8Array(n).fill(1);
  F.mu = new Float64Array(n).fill(SAT_WATER.mu);
  F.b = new Uint8Array(n);
  /* the (p, h, m) each row was last solved at; NaN never matches, so pass one computes every node */
  F.lp = new Float64Array(n).fill(NaN);
  F.lh = new Float64Array(n).fill(NaN);
  F.lm = new Float64Array(n).fill(NaN);
}
/* structural on purpose: anything richer than s.mBy and net.vol closes a loop back through tankP and overflows the stack on tick one */
const DRY_FRAC = 1e-3, DRY_MIN_KG = 1e-6;
const netNodeDry = (net, s, i, rho) => {
  const nid = net.name[i], m = s && s.mBy ? s.mBy[nid] : undefined;
  /* against what this node would hold, never a typed density: a near-vacuum holds a milligram and is not spent */
  const eos = net.vol[i]*(rho === undefined ? netRhoAt(s, nid) : rho);
  return m !== undefined && eos > DRY_MIN_KG && m <= DRY_FRAC*eos; };
/* a node whose inventory another integral already owns; structural, off the maps netBuild() wrote, so it cannot recurse */
function netBooked(net){
  if(net.booked) return net.booked;
  const b = new Uint8Array(net.n);
  /* a vessel in the field is no book: its water is the circuit's own, and mass crossing its line must stay in the field */
  for(const id in net.tankNode) if(!net.tankField[id])
    b[net.tankNode[id]] = 1;
  for(const i of (net.cont||[])) b[i] = 2;      // 2: a boundary with no book at all
  net.booked = b;
  return b;
}
/* the partition netBooked() marks, named; undefined is the field's own, and containment */
function netBookOf(net){
  if(net.bookOf) return net.bookOf;
  const b = new Array(net.n);
  for(const id in net.tankNode) if(!net.tankField[id]) b[net.tankNode[id]] = "T:"+id;
  net.bookOf = b;
  return b;
}
/* taken off F.wet so the key and the assembly agree by construction */
function netDrySig(net, s){
  const w = net.F && net.F.wet;
  if(!w) return 0;
  let hsh = 0;
  for(let i=0;i<net.n;i++) if(!w[i]) hsh = (Math.imul(hsh, 31) + i + 1)|0;
  return hsh;
}
/* a shut check valve takes its edge out of A; read exactly as flowG reads it */
function netDiodeSig(net, s){
  const F = net.F; if(!F || !F.p) return 0;
  const list = net.diodeEdges || (net.diodeEdges = net.edges.filter(ed => ed.diode));
  let hsh = 0;
  for(let k=0;k<list.length;k++){ const ed = list[k];
    const h = typeof ed.h === "function" ? ed.h(s) : (ed.h || 0);
    if((F.p[ed.u] - F.p[ed.v] + h)*ed.diode < 0) hsh = (Math.imul(hsh, 31) + k + 1)|0; }
  return hsh;
}
function netFieldUpdate(net, s){
  const F = net.F;
  const mx = MIX_SCRATCH;
  // a node's curve is its circuit's: a fact about the net's own graph, so it memoises on net
  const sat = net.satBy || (net.satBy = net.name.map(netSatOf));
  const mBy = s && s.mBy;
  for(let i=0;i<net.n;i++){ const nid = net.name[i], p = netPAt(s, nid), h = netHAt(s, nid);
    const m = mBy ? mBy[nid] : undefined, mk = m === undefined ? -1 : m;
    if(p === F.lp[i] && h === F.lh[i] && mk === F.lm[i]) continue;
    F.lp[i] = p; F.lh[i] = h; F.lm[i] = mk;
    mixState(sat[i], p, h, mx);
    F.p[i] = p; F.rho[i] = mx.rho; F.x[i] = mx.x; F.b[i] = mx.b;
    /* A RUN is a full pipe, so what it is carrying IS its holdup. Read off (p,h) alone, a run resting on its own saturation line flashes 982 to 0.8 and back on alternate ticks while its mass never moves, and every conductance leaning on it rings with it. A vessel is not this: its mean density is not the density at its nozzle, and gasAt already answers that. */
    F.rhoD[i] = (m !== undefined && net.vol[i] > 0 && runKeyOfNode(nid) !== null)
      ? m/net.vol[i] : mx.rho;
    F.wet[i] = netNodeDry(net, s, i, mx.rho) ? 0 : 1;
    F.mu[i] = muMixOf(sat[i], mx.x); }
  for(const i of (net.gasNodes||[])) F.rhoG[i] = rhogOf(sat[i], satT(sat[i], F.p[i]));
  /* the pool's own surface, not (p,h): a hotwell short of full has a space over it and every nozzle in that space draws steam */
  if(net.condV && net.condV.length){ F.void.fill(0);
    for(const i of net.condV){ const lvl = poolLvlOf(net, s, i);
      if(lvl !== undefined && lvl < 100) F.void[i] = 1;
      /* and the drain in its floor is under the water, so what this vessel DONATES is liquid. The EOS read at a saturated node is a knife edge and reads it as steam; gasAt already answers for the nozzle in the space above. */
      if(lvl !== undefined && lvl > 0) F.rhoD[i] = rhofOf(sat[i], satT(sat[i], F.p[i])); } }
  /* containment never donates: F.wet is the DONOR's bit, so a break stops supplying without stopping it receiving */
  for(const i of (net.cont||[])) F.wet[i] = 0;
  /* built here so it cannot be built twice: the diagonal and its own C/dt*p_prev are two halves of one row */
  net.store = netStore(net, s);
  /* every conductance is a function of this field, so the generation is netFactored()'s key */
  F.gen = (F.gen||0) + 1;
}
/* the ONE place the law is applied: an edge states a flow coefficient, nothing else */
const edgeG = (net, ed, s) => {
  const C = typeof ed.C === "function" ? ed.C(s) : ed.C;
  /* the AUTHORED head, never edgeH()'s: the friction law is linearised about the drop it is itself asked to account for, and the momentum term is not one */
  const h = C > 0 ? (typeof ed.h0 === "function" ? ed.h0(s) : (ed.h0 || 0)) : 0;
  const hSrc = C > 0 && ed.hSrc ? ed.hSrc(s) : 0;
  const g = C > 0 ? flowG(C, net.F, ed.u, ed.v, h, ed.diode, hSrc, ed.chokeAt, ed.gasAt) : 0;
  if(net.choke && ed.i !== undefined) net.choke[ed.i] = (g > 0 && FLOWG_CHOKE) ? 1 : 0;
  return g > 0 ? g/(1 + g*edgeIn(ed)) : g;
};
/* I/dt in MPa per kg/s, the inertance as a resistance over one tick. `I*dw/dt` is a TIME derivative and is identically zero in a steady solve, so it exists inside a march and nowhere else - a settle, a reference solve and a governor walk all carry none. That is also what leaves `ed.w` at the flows the first march starts from, so its `In*w0` cancels its own conductance factor exactly and the term arrives without a step. An orifice states no length and has none either. */
const edgeIn = ed => netMarch ? (ed.I || 0)/NET_DT/1e6 : 0;
/* What the MATRIX drives the edge with: the authored head, plus the momentum the water is already carrying. w0 is last solve's flow, the same one-tick lag the friction and the density take. */
const edgeH = (ed, s) => (typeof ed.h0 === "function" ? ed.h0(s) : (ed.h0 || 0))
  + edgeIn(ed)*(ed.w || 0);
function netDryParts(s){
  const net = (typeof P!=="undefined" && P) ? P.net : null, F = net && net.F;
  if(!net || !F || !F.wet || !net.nodesOfPart) return [];
  /* a booked node is left out: F.wet reads the mass field there and the book is the answer. So is a vessel, whose emptiness is a LEVEL it already states - a relief tank commissions empty on purpose. */
  const booked = netBooked(net), out = [];
  for(const id in net.nodesOfPart){
    if(D.tanks && D.tanks[id]) continue;
    for(const i of net.nodesOfPart[id])
      if(!F.wet[i] && !booked[i]){ out.push(id); break; } }
  return out;
}
/* any edge of that run counts: a run cut by a throttle is two segments, either can be at the cap */
function netChokedRun(net, key){
  return netChokedKey(net, k => k === key || k === "break:"+key);
}
/* `comp:<id>:` is the key netBuild gives a machine's own internal paths */
const netChokedPart = (net, id) => netChokedKey(net, k => k.indexOf("comp:"+id+":") === 0);
function netChokedKey(net, want){
  if(!net || !net.choke) return false;
  for(let i=0;i<net.edges.length;i++){ const k = net.edges[i].key;
    if(net.choke[i] && typeof k === "string" && want(k)) return true; }
  return false;
}

// an EQUIVALENT LENGTH, never a multiplier; neither constant is fitted against a measured valve
const VALVE_LEQ=2, VALVE_XMIN=0.05;
const valveLeq = x => x>=1 ? 0 : VALVE_LEQ*(1/Math.max(x,VALVE_XMIN)**2 - 1);

// one law for a branch edge and an in-line run segment alike: any throttle at x<=0 cuts the whole edge
const NO_GATES = [];
const throttledC = (s, bore, L, ids, K0, f) => {
  let Ltot = L;
  for(const fid of ids){
    const x = s.valve && s.valve[fid];
    if(!(x>0)) return 0;
    Ltot += valveLeq(x);
  }
  return pipeC(bore, Ltot, K0, f);
};

// the one break whose size is not read off a pipe's bore
const BREACH_BORE = 1.6;
// s for the loop's whole inventory to pass one point at rated flow (loopKg(), step.js)
const LOOP_TRANSIT = 12;
/* rebuilt when s.dmgParts is replaced or grows, which is the whole of how it changes */
const cellPack = (x,y) => x*4096 + y;
let brokeArr=null, brokeLen=-1, brokeSet=null;
const cellBroken = (s, x, y) => {
  const d = s.dmgParts;
  if(!d || !d.length) return false;
  if(brokeArr!==d || brokeLen!==d.length){
    brokeSet = new Set();
    for(let i=0;i<d.length;i++){ const id=d[i];
      if(id.lastIndexOf("pipe:",0)!==0) continue;
      const c = id.indexOf(",",5);
      brokeSet.add(cellPack(+id.slice(5,c), +id.slice(c+1))); }
    brokeArr=d; brokeLen=d.length; }
  return brokeSet.has(cellPack(x,y));
};
/* shut is an ABSENT edge, never a large resistance */
const portOpen    = (s, pid) => !(s.portShut && s.portShut[pid]);
const runPortsOpen = (s, r)  => portOpen(s, r.pa) && portOpen(s, r.pb);
/* a wrecked valve body is an opening, not isolation */
const portLive = (s, pid) => portOpen(s, pid) || portWrecked(s, pid);

/* its share of the heat leaving the primary times the generator count, so an even split reads exactly s.load */
const secLoad = (s, id) => {
  const l = s.load===undefined ? 1 : s.load;
  if(id===undefined || !s.sgShare) return l;
  const n = Object.keys(s.sgShare).length, w = s.sgShare[id];
  return (n>0 && w!==undefined) ? l*n*w : l;
};
/* a power law, or an Antoine where the row carries A; both invert in closed form, which is what lets a shell be a pot */
const satT = (c,p) => c.A ? c.C + c.B/(c.A - Math.log(Math.max(p,c.pFloor)))
                          : c.T0*Math.pow(Math.max(p,c.pFloor)/c.p0, c.n);
const satPRaw = (c,T) => c.A ? Math.exp(c.A - c.B/Math.max(T-c.C, 1))
                          : c.p0*Math.pow(Math.max(T,c.TFloor)/c.T0, 1/c.n);
// dp/dT along that same curve, exact rather than differenced
const satSlope = (c,p) => { const q = Math.max(p,c.pFloor);
  if(!c.A) return q/(c.n*satT(c,q));
  const d = Math.max(satT(c,q)-c.C, 1); return q*c.B/(d*d); };

/* A/B/C are Antoine, fitted to steam-table points at 0.004, 6.9 and 17 MPa; `cp` is flat and a real error at 17 */
const SAT_WATER = {A:9.844309, B:4174.5246, C:30.4331,
                   tc:647.096, pc:22.06, rhoc:322,
                   p0:6.9, T0:558, n:0.0855, pFloor:1e-4, TFloor:1,
                   hfg:1509, rho:740, cp:5.5, mu:1.2e-4, muV:2.0e-5, solidK:1.4, hFilm:30000};
/* here and not in step.js: latRevolve() rates the core at module load, before a const in step.js exists */
const CP_W=SAT_WATER.cp;
const T_FEED = 490;        // K, where feedwater arrives
/* Watson: latent heat falls to zero at the critical point; a curve with no tc keeps its scalar */
const WATSON = 0.38;
const hfgRaw = (c,T) => c.tc ? c.hfg*Math.pow(clamp((c.tc-T)/(c.tc-c.T0),0,6), WATSON)
                            : c.hfg;
/* the same shape for the gap between the two densities; the exponent is the published critical one */
const RHO_N = 0.35;
const rhofRaw = (c,T) => c.tc
  ? c.rhoc + (c.rho-c.rhoc)*Math.pow(clamp((c.tc-T)/(c.tc-c.T0),0,6), RHO_N)
  : c.rho;
/* Clausius-Clapeyron backwards, off this curve's own slope and latent heat; ceiled at the liquid */
const rhogRaw = (c,T) => Math.min(rhofRaw(c,T),
  Math.max(satSlope(c, satPRaw(c,T))*T*1e3/Math.max(hfgRaw(c,T), 1e-6), 1e-6));
/* keyed on the curve object so a re-commissioned P.sat is a fresh table; outside it the raw law answers */
const CURVE_N = 2048, CURVE_LO = 100;
const curveTabs = new WeakMap();
const curveTab = c => { let t = curveTabs.get(c); if(t !== undefined) return t;
  if(!(c.tc > CURVE_LO + 10)){ curveTabs.set(c, null); return null; }
  const d = (c.tc - CURVE_LO)/(CURVE_N - 1);
  const hfg = new Float64Array(CURVE_N), rf = new Float64Array(CURVE_N), rg = new Float64Array(CURVE_N), sp = new Float64Array(CURVE_N);
  for(let i=0;i<CURVE_N;i++){ const T = CURVE_LO + i*d;
    hfg[i] = hfgRaw(c,T); rf[i] = rhofRaw(c,T); rg[i] = rhogRaw(c,T); sp[i] = satPRaw(c,T); }
  t = {inv: 1/d, hi: c.tc - d, hfg, rf, rg, sp}; curveTabs.set(c, t); return t; };
const tabAt = (a, t, T) => { const u = (T - CURVE_LO)*t.inv, i = u|0, w = u - i;
  return a[i] + (a[i+1] - a[i])*w; };
const hfgOf  = (c,T) => { const t = c.tc && curveTab(c); return (t && T > CURVE_LO && T < t.hi) ? tabAt(t.hfg, t, T) : hfgRaw(c,T); };
const rhofOf = (c,T) => { const t = c.tc && curveTab(c); return (t && T > CURVE_LO && T < t.hi) ? tabAt(t.rf, t, T) : rhofRaw(c,T); };
const rhogOf = (c,T) => { const t = c.tc && curveTab(c); return (t && T > CURVE_LO && T < t.hi) ? tabAt(t.rg, t, T) : rhogRaw(c,T); };
const satP   = (c,T) => { const t = c.tc && curveTab(c); return (t && T > CURVE_LO && T < t.hi) ? tabAt(t.sp, t, T) : satPRaw(c,T); };
/* off the two densities so it cannot disagree with the kilograms */
const satRvl = (c,p) => { const T = satT(c,p); return rhogOf(c,T)/rhofOf(c,T); };
const H_DATUM = 273.15;
/* compressibility, per MPa: COOLANT[].solidK is beta over kappa and BETA_W is beta */
const kappaOf = c => BETA_W/Math.max(1e-6, c.solidK || SOLID_K_W);
/* three branches off the state the node is actually in; they meet at x=0 and x=1 */
const mixState = (c,p,h,out) => { const Ts = satT(c,p), hf = c.cp*(Ts - H_DATUM),
    hfg = Math.max(hfgOf(c,Ts), 1e-6);
  const x = clamp((h-hf)/hfg, 0, 1);
  out.x = x; out.b = h <= hf ? 0 : h >= hf + hfg ? 2 : 1;
  if(h <= hf){ const T = Math.min(H_DATUM + h/c.cp, Ts);
    /* above its own critical temperature there is no liquid branch to be on: p/T off the design point COOLANT[].dens is quoted at */
    out.rho = T >= c.tc ? c.rho*(p/c.p0)*((c.Tref||c.T0)/Math.max(T,1))
            : rhofOf(c,T)*(1 + kappaOf(c)*Math.max(0, p - satP(c,T))); }
  else if(h >= hf + hfg){ const T = Ts + (h - hf - hfg)/c.cp;
    out.rho = rhogOf(c,Ts)*Ts/Math.max(T, 1); }
  else { const rf = rhofOf(c,Ts);
    out.rho = 1/((1-x)/rf + x/rhogOf(c,Ts)); }
  return out; };
/* homogeneous (McAdams) - NOT the missing two-phase multiplier */
const muMixOf = (c, x) => { const mf = c.mu, mg = c.muV || c.mu;
  return x <= 0 ? mf : x >= 1 ? mg : 1/(x/mg + (1-x)/mf); };
const MIX_SCRATCH = {x:0, rho:0, b:0}, MIX_SCRATCH2 = {x:0, rho:0, b:0};
const rhoMixOf = (c,p,h) => mixState(c,p,h,MIX_SCRATCH).rho;
// entropy on mixState's own three branches, so the two cannot disagree
const mixS = (c,p,h) => { const Ts = satT(c,p), hf = c.cp*(Ts - H_DATUM),
    hfg = Math.max(hfgOf(c,Ts), 1e-6);
  if(h <= hf) return c.cp*Math.log(Math.max(Math.min(H_DATUM + h/c.cp, Ts), 1)/H_DATUM);
  if(h >= hf + hfg) return c.cp*Math.log((Ts + (h - hf - hfg)/c.cp)/H_DATUM) + hfg/Ts;
  return c.cp*Math.log(Ts/H_DATUM) + (h - hf)/Ts; };
// kJ/kg a state can do expanding isentropically to p0 (Hicks-Menzies); never per tick
const expWorkOf = (c,p,h,p0) => { if(!(p > p0)) return 0;
  const s1 = mixS(c,p,h); let lo = 0, hi = h;
  for(let i=0;i<50;i++){ const mid = 0.5*(lo+hi);
    if(mixS(c,p0,mid) < s1) lo = mid; else hi = mid; }
  return Math.max(0, h - 0.5*(lo+hi)); };
/* numerically off mixState() itself, stepped to stay on the node's own branch: across the shelf edge two slopes are orders apart */
const DRHO_DP = (c,p,h,r0,b0) => { const dp = Math.max(1e-4, p*1e-3);
  if(r0 === undefined){ const m = mixState(c,p,h,MIX_SCRATCH); r0 = m.rho; b0 = m.b; }
  let p1 = p + dp, r1 = mixState(c,p1,h,MIX_SCRATCH2).rho;
  if(MIX_SCRATCH2.b !== b0){ const p2 = p - dp;
    if(p2 > 0 && mixState(c,p2,h,MIX_SCRATCH2).b === b0){ p1 = p2; r1 = MIX_SCRATCH2.rho; }
    else r1 = mixState(c,p1,h,MIX_SCRATCH2).rho; }
  return (r1 - r0)/(p1 - p); };
/* K, COOLANT[].dT0; here rather than step.js because layout.js asks for it at module load */
const coreDT0   = c => COOLANT[(c||priD()).cool].dT0;
const coreDTMax = () => coreDT0()*8.3;
/* kJ/kg from H_DATUM; the two ends of the shelf */
const satH  = (c,p) => c.cp*(satT(c,p) - H_DATUM);
const satHg = (c,p) => satH(c,p) + hfgOf(c, satT(c,p));
/* NOT latent heat: the gap is the sensible rise from T_FEED to saturation */
const hRise = (c,p) => satHg(c,p) - hOfT(c, T_FEED);
// taken as liquid: the seed, and how a pot's temperature enters the field
const hOfT  = (c,T) => c.cp*(T - H_DATUM);
/* on the shelf every enthalpy is the same temperature */
const tOfH  = (c,p,h) => { const hf=satH(c,p);
  if(h <= hf) return H_DATUM + h/c.cp;
  const hg=hf+hfgOf(c, satT(c,p));
  return h >= hg ? satT(c,p) + (h-hg)/c.cp : satT(c,p); };
const xOfH  = (c,p,h) => { const hf=satH(c,p);
  return clamp((h-hf)/Math.max(hfgOf(c, satT(c,p)), 1e-6), 0, 1); };
function satCurveOf(cid, p0){
  if(p0 === undefined) p0 = holdSetP(coreCircOf(cid));
  return satCurveFor(COOLANT[coreD(cid).cool], p0);
}
/* off a coolant row alone: a circuit between two transfer stages has no vessel to ask */
function satCurveFor(a, p0){
  const tsat0 = a.tsat*Math.pow(p0/a.P0, coolSatN(a));
  const c = {p0, T0:tsat0, n:coolSatN(a), pFloor:.05, TFloor:1, hfg:a.hfg, cp:a.cp, mu:a.mu, muV:a.muV, hFilm:a.hFilm,
             tc:a.tc, pc:a.pc, rhoc:a.rhoc, rho:a.dens*RHO_K, solidK:a.solidK, burn:a.burn};
  c.Tref = Math.min(a.Tref, tsat0);
  return c;
}
/* does this circuit say what is in it and what it sits at; everything else is water at the shell's design pressure */
const circAuthored = ci => ci >= 0 && ci !== null && ci !== undefined
  && (nodeGraph().coreCircs[ci] === 1 || !!circCoolTank(ci));
const circCool = ci => { if(!(ci >= 0)) return null;
  const c = coreOnCirc(ci)[0]; if(c) return COOLANT[coreD(c).cool];
  const h = circCoolTank(ci); return h ? COOLANT[D.tanks[h].cool] : null; };
/* a HOLD tank first, so where there is one the fluid and the setpoint name the part circKey() keys on; any tank may still state what is in its circuit */
const circCoolTank = ci => { const names = id => D.tanks[id] && D.tanks[id].cool != null;
  for(const id of holdOnCirc(ci)) if(names(id)) return id;
  for(const id of tankIds()) if(names(id) && tankCircuit(id) === ci) return id;
  return null; };
const satOfCirc = ci => {
  if(ci === null || ci === undefined || ci < 0) return SAT_WATER;
  const G = nodeGraph();
  if(G.coreCircs[ci] !== 1){
    const h = circCoolTank(ci); if(!h) return SAT_WATER;
    const p0 = holdSetP(ci), slot = graphSlot("satOf"), k = h+"|"+D.tanks[h].cool+"|"+p0;
    return slot.get(k) || (slot.set(k, satCurveFor(COOLANT[D.tanks[h].cool], p0)), slot.get(k));
  }
  if(typeof P !== "undefined" && P && P.coreSat && P.coreSatSig === G.sig && P.coreSat[ci]) return P.coreSat[ci];
  const cid = coreOnCirc(ci)[0], p0 = holdSetP(ci), slot = graphSlot("satOf"), k = cid+"|"+p0;
  return slot.get(k) || (slot.set(k, satCurveOf(cid, p0)), slot.get(k));
};
/* a PART id and never a circuit index: any drawing edit renumbers those, and the key is on the snapshot */
const circKey = ci => { if(ci === null || ci === undefined || ci < 0) return null;
  const s = graphSlot("circKey"), was = s.get(ci); if(was !== undefined) return was;
  const v = coreOnCirc(ci)[0] || holdOnCirc(ci)[0] || null; s.set(ci, v); return v; };
const primaryCirc = () => nodeGraph().coreCirc;
// a NET node (folded) on any circuit with a vessel on it; nodeGraph().inCore takes the raw graph node
const netInCore = nm => nodeGraph().coreCircs[circOfNode(nm)] === 1;
const tsatSec = (p, ci) => satT(satOfCirc(ci), p);
/* the anchor P.turbC is fitted at; a board with no generator takes the core's circuit */
const steamRhoDes = () => { const id = sgIds()[0];
  const ci = id !== undefined ? shellCirc(id) : nodeGraph().coreCirc;
  return Math.max(1e-3, rhogOf(satOfCirc(ci), tsatSec(sgDesignP(), ci))); };
const psatSec = (T, ci) => satP(satOfCirc(ci), T);
/* takes a PRESSURE: latent heat is not a constant of a fluid */
const hfgOfCirc  = (ci,p) => { const c=satOfCirc(ci); return hfgOf(c, satT(c,p)); };
/* the shell and the condenser want this, never a bare hfg */
const riseOfCirc = (ci,p) => hRise(satOfCirc(ci), p);
/* s.PBy keyed on circKey(); s.P is the first vessel's circuit written a second time, for readers that address it by name */
const loopP    = (s, ci) => { const k = circKey(ci), v = k !== null && s.PBy ? s.PBy[k] : undefined;
  if(v !== undefined) return v;
  if(ci === nodeGraph().coreCirc) return s.P === undefined ? P.P0 : s.P;
  return nodeGraph().coreCircs[ci] === 1 ? satOfCirc(ci).p0 : P.Pcont; };
const setLoopP = (s, ci, v) => { const k = circKey(ci);
  if(k !== null) (s.PBy || (s.PBy = {}))[k] = v;
  if(ci === nodeGraph().coreCirc) s.P = v; };
/* K, keyed like the pressure; before the first read it is that circuit's own programme */
const TavgOf  = (s, ci) => { const k = circKey(ci), v = k !== null && s.TavgBy ? s.TavgBy[k] : undefined;
  if(v !== undefined) return v;
  if(ci === nodeGraph().coreCirc && s.Tavg !== undefined) return s.Tavg;
  const c = satOfCirc(ci); return c.Tref !== undefined ? c.Tref : P.Tref; };
const dTavgOf = (s, ci) => { const k = circKey(ci), v = k !== null && s.dTavgBy ? s.dTavgBy[k] : undefined;
  return v !== undefined ? v : (ci === nodeGraph().coreCirc && s.dTavg !== undefined ? s.dTavg : 0); };
/* level is a volume fraction and quality a mass fraction; the one place that knows they are the same fact */
const holdSeedH = (ci, p, lvl) => { const c = satOfCirc(ci), T = satT(c, p);
  const rf = rhofOf(c,T), rg = rhogOf(c,T), f = clamp(lvl,0,100)/100;
  const x = (1-f)*rg/Math.max(f*rf + (1-f)*rg, 1e-9);
  return satH(c,p) + x*hfgOf(c,T); };
/* what share of this node's VOLUME is liquid, 0..100 */
const holdLvlOf = (s, nid) => { const c = satOfCirc(circOfNode(nid));
  const p = netPAt(s,nid), T = satT(c,p), x = clamp(xOfH(c,p,netHAt(s,nid)),0,1);
  const rg = rhogOf(c,T), rf = rhofOf(c,T);
  const vg = x/Math.max(rg,1e-9), vf = (1-x)/Math.max(rf,1e-9);
  return 100*vf/Math.max(vf+vg, 1e-12); };
/* MPa: the coolant family's working pressure, else the highest saturated boundary on the circuit, else containment */
const holdPSuggest = ci => {
  { const c = coreOnCirc(ci)[0]; if(c) return COOLANT[coreD(c).cool].P0;
    if(ci === nodeGraph().coreCirc) return COOLANT[priD().cool].P0; }   // the stand-in's own circuit on a blank grid
  { const h = circCoolTank(ci); if(h) return COOLANT[D.tanks[h].cool].P0; }
  let p = 0;
  for(const id of sgIds()) if(shellCirc(id)===ci) p = Math.max(p, sgDesignP(id));
  return p || (typeof P!=="undefined" && P ? P.Pcont : 0.1);
};
// the LOWEST-id hold tank states it, the same one netRef() anchors on
const holdSetP = ci => { const h = holdOnCirc(ci)[0];
  const v = h && D.tanks[h].hold && D.tanks[h].hold.p;
  return v || holdPSuggest(ci); };
/* MPa; wallSuggestMm()'s inverse */
const runRating = r => 2*(STEEL_S/((PRIMARY_K[r.k] ? COOLANT[priD().cool].pipeK : 1)))
                     * Math.max(runWallMm(r)-WALL_CORR, 0) / Math.max(runBoreMm(r), 1);
/* the same figure SG_BURST_K carries, so the two pressure boundaries do not each hold their own margin */
const PIPE_BURST_K = 1.5;
// cached for one pass: asked per run per tick
let burstCache = {}, burstPass = -1;
const runBurstP = r => { const pn = layPass();
  if(pn && burstPass !== pn){ burstCache = {}; burstPass = pn; }
  if(pn && burstCache[r.key] !== undefined) return burstCache[r.key];
  const v = runRating(r)*PIPE_BURST_K;
  if(pn) burstCache[r.key] = v;
  return v; };
const tankRating = id => 2*STEEL_S*Math.max(tankWallMm(id)-WALL_CORR, 0)
                       / Math.max(Math.cbrt(6*Math.max(D.tanks[id].vol,0.1)/Math.PI)*1000, 1);
function plantRating(ci){
  let lo = Infinity;
  for(const r of pipeNetwork()){ const ends = runEnds(r.key, r.k); if(!ends) continue;
    if(circOfNode(coreFold(ends[0])) !== ci) continue;
    lo = Math.min(lo, runRating(r)); }
  for(const id of tankIds()) if(tankCircuit(id)===ci) lo = Math.min(lo, tankRating(id));
  return isFinite(lo) ? lo : 0;
}
/* against the stock vessel's, so an untouched plant reads exactly 1; no hold tank reads 1 too, since that is not infinitely stiff */
const HOLD_VOL_REF = 23;                                  // m^3, the stock 50 m^3 vessel at 54 %
const holdBubbleM3 = id => { const t=D.tanks[id];
  return Math.max(0.1, t.vol*(100-clamp(t.level,0,100))/100); };
function holdDampK(){
  const h = holdTankIds();
  if(!h.length) return 1;
  let v = 0; for(const id of h) v += holdBubbleM3(id);
  return v/HOLD_VOL_REF;
}
/* the primary is always one: a plant with no pressurizer still has a programme */
function holdCircs(){
  const out = []; for(const id of coreIds()){ const ci = coreCircOf(id); if(ci >= 0 && out.indexOf(ci) < 0) out.push(ci); }
  if(!out.length) out.push(nodeGraph().coreCirc);
  for(const id of holdTankIds()){ const ci = tankCircuit(id);
    if(ci !== null && ci !== undefined && ci >= 0 && out.indexOf(ci) < 0) out.push(ci); }
  return out;
}

/* the shell IS the machine's own steam face: one two-phase vessel, the feed valve and the tube leak landing on it */
const shellNode = id => coreFold(id + roleIntern(ROLE.sg)[1].b);
/* a sink's ANCHORED path is its steam side. `a` IS the machine - one vessel, the exhaust space and the pool under it, holding the ship's condensate - and `b` is the condensate nozzle in its floor. */
const condIN = pid => { const p = partOf(pid), R = p && ROLE[p.role];
  return R ? roleIntern(R).find(IN => IN.anch) : null; };
const condVesNode = id => { const IN = condIN(id); return IN ? coreFold(id + IN.a) : null; };
const condOutNode = id => { const IN = condIN(id); return IN ? coreFold(id + IN.b) : null; };
/* m3 of condensate the ship states, shared over the condensers holding it */
const condPoolVol = () => { let v = 0; for(const t of hostedTankIds()) v += D.tanks[t].vol;
  return v/Math.max(1, condIds().length); };
/* A sink standing IN the primary is a heat exchanger in a hot leg, not a machine at a vacuum: it takes the loop's own pressure, and neither the vacuum's compliance nor the settle's pin belongs on it. */
const condVacuum = id => { const n = condVesNode(id);
  return n !== null && !nodeGraph().inCore(n); };
/* this machine's own pool, %; the commissioning fill before there is a field to read */
const condLvl = (s, id) => { const net = P && P.net;
  const i = net && net.condVById && net.condVById[id];
  const v = i === undefined ? undefined : poolLvlOf(net, s, i);
  return v === undefined ? condFill0() : v; };
const condVolOf = id => { const net = P && P.net;
  const i = net && net.condVById && net.condVById[id];
  return i === undefined ? 0.1 : net.vol[i]; };
/* %, the commissioning fill the ship states for its condensate */
const condFill0 = () => { const h = hostedTankIds(); if(!h.length) return 50;
  let v = 0, f = 0; for(const t of h){ v += D.tanks[t].vol; f += D.tanks[t].vol*D.tanks[t].level; }
  return v > 0 ? f/v : 50; };
/* the operator's drain, kg/s at a full pool: HOT_DUMP's own rate, now a real opening */
const condDumpKgs = () => HOT_DUMP/100*condPoolVol()*TANK_RHO;
const condDumpOpen = s => !!(s.tankDump && hostedTankIds().some(id => s.tankDump[id]));
/* the fallback only: what a caller with no live inventory gets */
const secPTarget = (s, id) => sgDesignP(id)*Math.pow(Math.max(secLoad(s,id),.05),.25);
/* the solved pressure at that node; step() writes s.sgPBy off it once per tick so a reader inside the solve is one tick behind, never mid-solve */
const secP = (s, id) => {
  /* a burst shell is an opening and sits at the room's pressure */
  if(id!==undefined && sgOpen(s,id)) return regionPAt(s, partOf(id));
  const p = id!==undefined && s.sgPBy ? s.sgPBy[id] : undefined;
  return p===undefined ? secPTarget(s,id) : Math.max(COND_P0, p);
};
// rated leak, % of loop inventory per second at the design differential
const SGTR_RATE = 0.30;
const sgtrC = () => {
  const dp = Math.max(holdSetP(nodeGraph().coreCirc) - sgDesignP(), 0.05);
  return (SGTR_RATE/100)*loopKg()/Math.sqrt(2*Math.max(P.rho0||700,1)*dp*1e6);
};
const sgtrLive = (s, id) => partWrecked(s, id);
/* how far the reaction has eaten this leak open, x1 at a clean tube */
const sgWastOf = (s, id) => (s && s.sgWastBy && s.sgWastBy[id]) || 1;

/* `act` a full tank's radiation source, `boron` pcm per 1 % of loop inventory pushed in, `temp` K and DISPLAY ONLY */
const FLUID = {
  water:        {label:"WATER",        act:0, boron:0,   temp:310, dens:1000},
  borated:      {label:"BORATED",      act:0, boron:100, temp:310, dens:1000},
  condensate:   {label:"CONDENSATE",   act:0, boron:0,   temp:320, dens:1000},
  contaminated: {label:"CONTAMINATED", act:1, boron:0,   temp:400, dens:1000},
  helium:       {label:"HELIUM",       act:0, boron:0,   temp:300, dens:11},   // 7 MPa, 300 K
};

/* asked every tick and never latched, with the operator's own switch an OR beside it */
const AUTORULE = {
  manual: {label:"MANUAL ONLY",       live:()=>false},
  /* a relief header's tank is held shut by the valve upstream of it, not by anything its own edge can ask */
  always: {label:"ALWAYS OPEN",       live:()=>true},
  /* two setpoints: one parks the plant on its own threshold and re-alarms on every wobble */
  sglow:  {label:"LOW SG LEVEL",      live:(s,id)=>sglMin(s) <
             ((s.tankAuto && s.tankAuto[id]) ? SG_EFW_OFF : SG_DRY)},
  // on the TANK's own circuit, never the primary's
  plow:   {label:"LOW LOOP PRESSURE", live:(s,id)=>{ const ci=tankCircuit(id);
    return loopP(s,ci) < holdSetP(ci)*0.55; }},
};

/* ONE VESSEL: water at the bottom, the charge on top of it, total volume fixed. `level` is the commissioning fill of the WHOLE tank and the gas space is the rest of it, so a vessel left full has no bubble and simply conducts. */
const TANK_RHO = 1000;                 // kg/m^3 - what a tank of an unlisted fluid holds
const TANK_DEFAULT = {
  vol:35, level:100, fluid:"water",
  /* a plain vessel: lined up, with ordinary nozzles, so a tank dropped between two machines conducts. An injection tank states its own check valve and its own rule */
  gas:{p0:4.5}, check:false, auto:"always", burst:null,
  hold:null, tsurv:null, pburst:null, aspect:1,
  /* a COOLANT index, or null for water; only a HOLD tank is asked */
  cool:null,
  /* a level that never moves: a SANDBOX source or sink, with no inspector row */
  inf:false,
};
/* tee, branch throttle and relief valve are one component with `mode` set differently; null lift/reseat = reliefSet()'s default */
const FIT_DEFAULT = {
  name:"VALVE", col:"#c8b060", cell:null, mode:"throttle", bore:null,   // null = fitBoreSuggest()
  lift:null, reseat:null,
  tip:"A fitting in the pipe. Say what it is on its own panel - a tee that joins two lines, a throttle you can close, or a relief valve that lifts on pressure.",
};
const tankIds   = () => Object.keys(D.tanks);
/* a hold tank is not a store: ledgerKg() has no column for its pool */
const secTankIds= () => tankIds().filter(id=>tankSecondary(id) && !D.tanks[id].hold);
/* a tank with no cell is HOSTED, the way a hotwell lives inside its condenser */
const hostedTankIds = () => tankIds().filter(id=>!D.tanks[id].cell);
/* off what is IN them, never off a name */
const boronTankIds = () => tankIds().filter(id=>
  tankPrimary(id) && tankFluid(id).boron>0);
/* kg off the tank's own volume, never where it is piped */
const tankKg = id => { const t = D.tanks[id], fl = FLUID[t.fluid]; return t.vol*((fl && fl.dens) || TANK_RHO); };
const tankPoolKg = (s,list) => { let m=0;
  for(const id of list) m += clamp(tankLvl(s,id),0,100)/100*tankKg(id); return m; };
const tankPoolPct = (s,list) => { let c=0, m=0;
  for(const id of list){ const k=tankKg(id); c+=k; m+=clamp(tankLvl(s,id),0,100)/100*k; }
  return c>0 ? 100*m/c : 0; };
const tankFluid = id => FLUID[D.tanks[id].fluid] || FLUID.water;
/* the gas space the commissioning fill leaves, as a share of the WHOLE vessel; a tank left full has none and is ordinary water */
const tankVoidFrac = id => { const t = D.tanks[id];
  return t ? Math.max(0, (100-clamp(t.level,0,100))/100) : 0; };
const tankGasV0 = id => { const t = D.tanks[id]; return t ? t.vol*tankVoidFrac(id) : 0; };
/* whose water is in s.mBy: an ordinary vessel on the core's circuit. An `inf` tank is a boundary and a secondary tank is still its own pool (step.js), and both keep a book of their own. */
const tankInField = id => { const t = D.tanks[id];
  return !!t && !t.hold && !t.inf && !!t.cell && tankPrimary(id); };
/* a hold tank's level IS its node's void fraction; s.tank[id] must not become a second copy */
const holdLvlRead = (s,id) => s.lvlBy && s.lvlBy[id] !== undefined ? s.lvlBy[id] : s.lvl;
/* the node's own solved pressure, or NOTHING: before the first solve a vessel has only its charge to state, and netPAt()'s loop-pressure fallback is not that vessel's answer */
const tankNodeP = (s,id) => (s && s.pBy && s.pBy[id] !== undefined) ? Math.max(COND_P0, s.pBy[id]) : undefined;
/* isothermal, p*V constant about the charge: the bubble at the node's own solved pressure, capped at the whole vessel. With no charge the node's own void fraction is the level, the same read a pressurizer takes. */
const tankLvlRead = (s,id) => { const t = D.tanks[id], V0 = tankGasV0(id);
  if(!(V0 > 0) || !t.gas) return holdLvlOf(s, id);
  const p = tankNodeP(s,id);
  if(p === undefined) return clamp(t.level,0,100);
  return 100*(1 - Math.min(t.vol, V0*t.gas.p0/p)/Math.max(t.vol,1e-9)); };
/* a hosted tank has no cell and so no node of its own: the ship's condensate is the water standing in its condensers, read across the fleet */
const condPoolLvl = s => { const net = P && P.net; if(!net || !s) return undefined;
  let v = 0, f = 0;
  for(const i of (net.condV || [])){ const lvl = poolLvlOf(net, s, i);
    if(lvl === undefined) continue;
    const V = net.vol[i]; v += V; f += V*lvl; }
  return v > 0 ? f/v : undefined; };
const tankLvl   = (s,id) => D.tanks[id] && D.tanks[id].hold && holdLvlRead(s,id) !== undefined ? holdLvlRead(s,id)
                : tankInField(id) ? tankLvlRead(s,id)
                : (D.tanks[id] && !D.tanks[id].cell && condPoolLvl(s) !== undefined) ? condPoolLvl(s)
                : (s.tank && s.tank[id] !== undefined) ? s.tank[id] : D.tanks[id].level;
/* a vented tank is not a vacuum: with nothing behind it a vessel is open to the compartment */
function tankP(s,id){
  const t = D.tanks[id];
  if(!t) return 0;
  const ci = tankCircuit(id);
  // CONTROLLED, so no gas law is consulted: a hold tank holds its circuit's setpoint
  if(t.hold && s && P && P.net && holdLive(P.net, s, ci)) return loopP(s, ci);
  /* a vessel whose water is in the field IS its node - the charge law only ever named a pressure nobody solved, and it is left below as the commissioning value */
  if(tankInField(id)){ const v = tankNodeP(s,id); if(v !== undefined) return v; }
  /* an isolated hold tank is a gas tank on the same charge law, charged by the vessel and not the player */
  const frac = t.gas ? tankVoidFrac(id) : t.hold ? Math.max(0.01, tankVoidFrac(id)) : 0;
  const p0 = t.gas ? t.gas.p0 : t.hold ? holdSetP(ci) : 0;
  // a vessel left water-solid has no bubble to squeeze, so what it sits at is the charge itself
  if(!(frac > 0)) return Math.max(regionPAt(s, partOf(id)), p0);
  return Math.max(regionPAt(s, partOf(id)),
    p0*frac/Math.max(0.01, frac + (t.level - clamp(tankLvl(s,id),0,100))/100));
}
/* kg per MPa: the exact inverse of tankP()'s charge law, so the two cannot disagree about the same vessel */
const tankStores = id => { const t = D.tanks[id];
  return !!t && !t.hold && !t.inf && !!t.gas && tankGasV0(id) > 0; };
const tankCapAt = (s,id) => { const t = D.tanks[id];
  if(!tankStores(id)) return 0;
  const p = Math.max(tankP(s,id), regionPAt(s, partOf(id)));
  return tankKg(id)*tankVoidFrac(id)*t.gas.p0/(p*p); };
/* the authored drain rate IS a hole, and the slider already says so: the area that passes it at the pressure the disc lets go at, on the same momentum relation every other opening uses */
const tankDiscC = id => { const t = D.tanks[id], b = t && t.burst;
  if(!b) return 0;
  const rho = tankKg(id)/Math.max(t.vol, 1e-9);
  const dp = Math.max(b.at - ((typeof P !== "undefined" && P) ? P.Pcont : 0.1), 0.01);
  return b.drain/100*tankKg(id)/Math.sqrt(2*rho*dp*1e6); };
/* MPa, the highest pressure the tank can see; design-time, so setpoints and charges, never a solved field */
const tankDesignP = id => { const t=D.tanks[id]; if(!t) return 0;
  const ci = tankCircuit(id);
  const own = t.hold ? holdSetP(ci) : t.gas ? t.gas.p0 : 0;
  const line = (ci===null || ci===undefined || ci<0) ? 0 : holdSetP(ci);
  return Math.max(own, line, 0.1); };
/* an OUTPUT the panel reads back off the model, never an input the solve consumes */
const TANK_RATE_REF = 2.6;                   // % of loop inventory per second
const tankRateRef = id => TANK_RATE_REF;     // keeps id: a threshold is per-quantity
/* a fraction of the tank's OWN full-scale rate, never a bare `q > 0`: a balanced plant's solved edge floats about zero */
const tankInjecting = (id, q) => q > 1e-6 * tankRateRef(id);
/* the operator's own valve, or the rule that opens it for them */
const tankOpen = (s,id) => {
  if(s.refOpen || (s.tankOpen && s.tankOpen[id])) return true;
  /* the operator may defeat the RULE without touching the valve */
  if(s.tankByp && s.tankByp[id]) return false;
  const r = AUTORULE[D.tanks[id].auto];
  return !!(r && r.live(s,id));
};
/* a tank that opens itself and has not been bypassed; `always` is the circuit, not a rule you arm */
const tankRuleLive = (s,id) => {
  const a = D.tanks[id].auto;
  return a!=="manual" && a!=="always" && !(s.tankByp && s.tankByp[id]);
};
const tankRuleAny = (s,pick) => tankIds().some(id =>
  (!pick || pick(id)) && tankRuleLive(s,id));
/* the valve and the diode, and NOTHING about what is left in it: the node carries the tank's kilograms and flowG's run-dry gate stops it feeding */
const tankLive = (s,id) =>
  /* a tank's edge is built here and not in netBuild(), so its own damage has to be asked here */
  !partWrecked(s,id) && (
  tankOpen(s,id));

/* the FLOOR, not the whole answer: the air in-leakage limit alone, so it sits BELOW the design point (COND_DT0) */
const COND_P0 = 0.004;

/* a vapour-bound pump is still turning, so it keeps a fifth of its head; nothing measured says a fifth */
const CAV_DERATE = 0.8;
/* shutoff head is (1+PUMP_DROOP) of stated duty; the droop is the casing's own resistance, in the matrix */
const PUMP_DROOP = 0.25;
// kg/s off its own casing edge last tick: a reading, never a head
const pumpQOf = (s, pid) => (s && s.pumpQBy && s.pumpQBy[pid]!==undefined)
  ? s.pumpQBy[pid] : pumpFlow(pid);
/* dp = rho*g*H, against the density it was COMMISSIONED at, so a plant at its design point reads exactly 1 */
const pumpRhoK = (s, pid) => {
  const r0 = (typeof P!=="undefined" && P && P.pumpRho0) ? P.pumpRho0[pid] : 0;
  if(!(r0 > 0)) return 1;
  const r = netRhoAt(s, pumpSucNode(pid));
  return isFinite(r) && r > 0 ? r/r0 : 0;
};
/* MPa at shutoff, at its own speed, less what its suction costs it: the one expression the edge and the cavitation readout share */
const pumpHeadNow = (s, pid) => { const N = pumpDrive(s, pid);
  return pumpHead(pid)*N*N*(1 + PUMP_DROOP)*(1 - CAV_DERATE*cavOf(s, pid))*pumpRhoK(s, pid); };
/* a passage sized to pass the machine's OWN rated duty against CASING_F of the reference friction head; measured against PUMP_H0 and not the machine's own head, because a casing's loss follows what it swallows */
let CASING_F = 0.05;
function setCasingF(v){ CASING_F = v; }
const dutyC = (q, rho) =>
  Math.max(q,0)/Math.sqrt(2*Math.max(rho||700,1)*CASING_F*PUMP_H0*1e6);
/* the passage costing PUMP_DROOP of the stated head at the stated flow, at the suction's own density; not dutyC, which is a fitted passage */
const pumpCasingC = (h, q, rho) =>
  Math.max(q,0)/Math.sqrt(2*Math.max(rho||700,1)*PUMP_DROOP*Math.max(h,1e-3)*1e6);
/* this shell's share of what the plant raises; water on every plant, whatever the primary is */
const feedTrainC = () => dutyC(P.steamRef/Math.max(sgCount(),1), SAT_WATER.rho);
/* 0..1 actual, not demand; s.flowScale is NOT sim state, it is netNatCirc()'s per-solve override */
const flowOf = (s, pid) =>
  (s.flowBy && s.flowBy[pid]!==undefined ? s.flowBy[pid] : 1)
  * (s.flowScale===undefined ? 1 : s.flowScale);
/* the mean over the pumps that serve the core; no coolant pump reads 1, because a 0 would trip the low-flow floor on a design with none. NOT s.flowNet, which is what the core is getting */
const flowMean = (s, map) => { const ids = pumpIds().filter(primaryPump);
  if(!ids.length) return 1;
  let t=0; for(const id of ids) t += (map && map[id]!==undefined) ? map[id] : 1;
  return t/ids.length; };
const flowPri    = s => flowMean(s, s.flowBy);
const flowDemPri = s => flowMean(s, s.flowDemBy);
/* the switchboard is NOT here: a dead bus is already in s.flowBy's own target, and reading supplyK() again applies the blackout twice */
const pumpDrive = (s, pid) =>
  (partWrecked(s, pid) ? 0 : 1) * flowOf(s, pid);
/* 0..1, keyed by PUMP, so every pump loses head to its own bad suction leg */
const cavOf = (s, pid) => (s.cavP && s.cavP[pid]) || 0;
/* asked of the DRAWING: a pump that draws on a tank is a reserve train and has a discharge check valve */
const pumpStandby = id => pumpResOf(id).length > 0;

/* Infinity, which pipeC() carries through to an exact 0, so a severed run lands on netAssemble's own g<=0 path */
const pipeExtraLen = (s, cells) => {
  if(!cells) return 0;
  for(let i=0;i<cells.length;i++){ const c=cells[i]; if(cellBroken(s,c[0],c[1])) return Infinity; }
  return 0;
};
/* the readers' question only - is this pipe lying open - never a resistance: the hole is a real edge and both halves go on conducting into it */
const runHoled = (s, r) => pipeExtraLen(s, r.cells) === Infinity
                        || portWrecked(s, r.pa) || portWrecked(s, r.pb);

/* one name for a fitting's internal edge, written beside the table whose modes price it */
const fitEdgeKey = fid => "comp:" + fid + ":lr";
/* ONE door, because netFactored()'s signature reads it too: spelled twice, a gate and the cache key it busts can disagree */
const reliefLive = (s,id) => !!((s.refOpen || (s.reliefOpen && s.reliefOpen[id]))
                             && !(s.reliefBlocked && s.reliefBlocked[id]));
const FIT = {
  throttle:{
    C:(s,id,bore,len)=>throttledC(s,bore,len,[id]),
  },
  relief:{
    C:(s,id,bore)=>reliefLive(s,id) ? holeC(bore) : 0,
  },
};

/* one solve per drawn frame, and ONLY inside a frame: S is frozen for the length of a paint and nowhere else. Keyed on the state too, because a replay frame draws a snapshot beside the live plant */
let reliefOuts=null, reliefOutsFor=null, netPassLive=false;
/* netSolve() writes ed.w, which fricOf() reads next solve, so a second paint solve feeds the friction the sim linearises against */
let netPassSol=null, netPassSolS=null;
const netPassClear=()=>{ reliefOuts=null; reliefOutsFor=null; netPassSol=null; netPassSolS=null; };
const netPassStart=()=>{ netPassLive=true;  netPassClear(); };
const netPassDrop =()=>{ netPassLive=false; netPassClear(); };
function reliefRate(s, fid){
  if(!(P && P.net)) return 0;
  let o = (netPassLive && reliefOutsFor===s) ? reliefOuts : null;
  if(!o){ o={}; netReadEdges(netSolve(P.net, s), null, null, null, o);
    if(netPassLive){ reliefOuts=o; reliefOutsFor=s; } }
  const q = o.reliefBy && o.reliefBy[fid];
  return q ? Math.max(0, invRate(q)) : 0;
}
/* a lift is about the pressure AT THE VALVE: the upstream end of its own gated edge, null where nothing routed */
function reliefNodeOf(net, fid){
  for(let e=0;e<net.edges.length;e++)
    if(net.edges[e].fit === fid) return net.name[net.edges[e].u];
  return null;
}
function reliefFullRate(s, fid){
  if(!((P && P.fittings && P.fittings[fid]) || D.fittings[fid])) return 0;
  const bore = fitBoreK(fid);
  return Math.max(0, invRate(flowW(holeC(bore), P.rho0, P.P0, regionPAt(s, partOf(fid)))));
}

// a run key is "kind:aIdSide-bIdSide" and node identity IS that "partId+side" string verbatim; null for a run with no second half
const RUN_ENDS = new Map();   // a run key never changes meaning
function runEnds(key, kind){
  let e = RUN_ENDS.get(key); if(e !== undefined) return e;
  /* the "#n" pipeMap() adds to tell a second run between the same two FACES apart is part of the key and no part of the node it lands on */
  const rest = key.slice(kind.length + 1).split("#")[0], i = rest.indexOf("-");
  e = i < 0 ? null : [rest.slice(0, i), rest.slice(i + 1)];
  RUN_ENDS.set(key, e); return e;
}
const RUN_PRE = "run:";
const runNodeOf   = key => RUN_PRE + key;
const runKeyOfNode = nid => nid.indexOf(RUN_PRE) === 0 ? nid.slice(RUN_PRE.length) : null;
// a run key IS "kind:a-b", so the kind runEnds() wants is in the key already
const runNodeEnds = key => runEnds(key, key.slice(0, key.indexOf(":")));

// which faces of a part are one node; the argument lives on ROLE.fold (layout.js) beside the rows that make it true
function foldMap(){
  const G=nodeGraph(); if(G.fold) return G.fold;   // coreFold() asks this ~1000 times a tick
  const m={};
  for(const p of LAY.parts){
    const f=foldFacesOf(p); if(!f) continue;
    // a LIST folds every face onto one node; a MAP folds each named face onto another face of the same part
    if(Array.isArray(f)) for(const face of f) m[p.id+face]=p.id;
    else for(const face in f) m[p.id+face]=p.id+f[face];
  }
  G.fold=m;
  return m;
}
// a blank grid has no vessel, so a reader that asks "at the core" gets nothing
const coreFold = raw => raw==null ? null : (foldMap()[raw] || raw);
/* a FOLDED node is the bare part id, so the face is stripped only when the whole name is not itself a part */
function circOfNode(nid){
  if(nid==null) return -1;
  const G=nodeGraph(), slot=graphSlot("circOfNode");
  const hit=slot.get(nid); if(hit!==undefined) return hit;
  let c=G.circuit[nid];
  /* a run node belongs to no part: nodeGraph() is a design-time walk over parts and faces and never sees one */
  if(c===undefined){ const rk=runKeyOfNode(nid);
    if(rk){ const e=runNodeEnds(rk); if(e) c=circOfNode(coreFold(e[0])); } }
  if(c===undefined){
    const p=partOf(nid) || partOf(nid.slice(0,-1));
    if(p) for(const n of (G.nodesOf[p.id]||[])){ if(n===nid || n.slice(0,-1)===p.id){ c=G.circuit[n]; break; } }
  }
  if(c===undefined && nid.indexOf("cav:")===0) c=circOfNode(coreFold(nid.slice(4)));   // a reactor cavity holds its core's water
  if(c===undefined) c=-1;
  slot.set(nid,c); return c;
}
/* both ends fold onto the SAME node, so no potential difference is possible; a run between two DIFFERENT faces of one part is a recirculation line and is not this */
function selfRuns(){
  const out=[];
  for(const c of pipeMap().conns){
    const a=partOf(c.a), b=partOf(c.b); if(!a||!b) continue;
    if(coreFold(a.id+c.sa) === coreFold(b.id+c.sb)) out.push(c.key);
  }
  return out;
}

/* metres above the bottom of the GRID, never off a pixel: elevation is a fact about the design */
const zRow = row => (GH - row) * MPC;
const zFace = (p, side) => side === "t" ? zRow(p.y)
                         : side === "b" ? zRow(p.y + p.h)
                         : zRow(p.y + p.h/2);
/* a folded node is looked up WHOLE before the face is sliced off, or "fit1" resolves as a part called "fit"; a run node stands midway between the two faces it joins */
const nodeZ = nid => { const rk = runKeyOfNode(nid);
  if(rk){ const e = runNodeEnds(rk); if(!e) return null;
    const za = nodeZ(coreFold(e[0])), zb = nodeZ(coreFold(e[1]));
    return (za === null || zb === null) ? null : (za + zb)/2; }
  const whole = partOf(nid);
  if(whole) return zFace(whole, "c");
  const q = partOf(nid.slice(0, -1));
  return q ? zFace(q, nid.slice(-1)) : null; };

/* a direction and animation LABEL only (net.tag); the static head reads each node's own density, so a row here cannot move a flow */
const NT_HOT = 1, NT_COLD = 2;
const KIND_TEMP = {hot: NT_HOT, surge: NT_HOT, cold: NT_COLD, hpi: NT_COLD};


const netSatOf = nid => satOfCirc(circOfNode(nid));
/* a node the field has not reached sits at its STRUCTURAL phase: the loop mean on the core's circuit, else saturated steam in a steam space and saturated liquid anywhere else */
function netHAt(s, nid){
  const h = s.hBy && s.hBy[nid];
  if(h !== undefined) return h;
  const c = netSatOf(nid);
  { const ci = circOfNode(nid); if(circAuthored(ci)) return hOfT(c, TavgOf(s, ci)); }
  const net = P && P.net, i = net && net.index ? net.index[nid] : undefined, p = netPAt(s, nid);
  return (net && net.vapour && i !== undefined && net.vapour[i]) ? satHg(c, p) : hOfT(c, satT(c, p));
}
/* floored at COND_P0, the plant's own vacuum; a node the solve does not carry reads its OWN circuit's setpoint, which is what runDesignP() walled it for */
function netPAt(s, nid){
  const f = s.pBy && s.pBy[nid];
  if(f !== undefined) return Math.max(COND_P0, f);
  const c = circSetP(nid);
  return Math.max(COND_P0, c > 0 ? c : (s.P===undefined?P.P0:s.P));
}
function netTempAt(s, nid){
  const c = netSatOf(nid);
  return tOfH(c, netPAt(s,nid), netHAt(s,nid));
}
function netQualAt(s, nid){
  const c = netSatOf(nid);
  return xOfH(c, netPAt(s,nid), netHAt(s,nid));
}
/* kg/m^3 off the same (p, h): liquid, vapour or mixture is a RESULT, never a setting on the run that reaches it */
function netRhoAt(s, nid){
  const c = netSatOf(nid);
  return rhoMixOf(c, netPAt(s,nid), netHAt(s,nid));
}
// kJ of mechanical work this node's holdup can do letting down to containment
function netWorkAt(s, nid){
  const c = netSatOf(nid), m = (s.mBy && s.mBy[nid]) || 0;
  return m > 0 ? m*expWorkOf(c, netPAt(s,nid), netHAt(s,nid), P ? P.Pcont : COND_P0) : 0;
}

/* net.vapour's structural answer, asked by node id so a view never has to test a run's kind name */
function netVapourAt(nid){
  const net = P && P.net;
  if(!net || !net.vapour) return false;
  const i = net.index[nid];
  return i !== undefined && !!net.vapour[i];
}

/* "break"/"vent"/"sgtr" are SYNTHETIC edge kinds netEdges() invents, never a run's own declared kind */
const netHole = ed => ed.kind === "break" || ed.kind === "vent" || ed.kind === "sgtr";

/* MPa; rho is the MEAN of the two ends, because either end's own value turns on which way round netBuild() pushed the edge */
const staticH = (net, ed, s) => {
  const dz = net.z[ed.u] - net.z[ed.v], F = net.F;
  let h = dz === 0 ? 0 : (F.rho[ed.u] + F.rho[ed.v])/2 * G_MPA * dz;
  if(ed.poolAt !== undefined) h += (ed.poolAt === ed.u ? 1 : -1)*poolH(net, s, ed.poolAt);
  return h;
};
/* a pool's level is the water it HOLDS against the volume it has. At the condenser's vacuum a saturated node's void fraction is a knife edge in enthalpy - 0.17 kJ/kg spans the whole range - and the mass is the state. */
const poolLvlOf = (net, s, i) => { const nm = net.name[i];
  if(!s || !s.mBy || s.mBy[nm] === undefined) return undefined;
  const c = satOfCirc(circOfNode(nm)), rf = rhofOf(c, satT(c, netPAt(s, nm)));
  return clamp(100*s.mBy[nm]/Math.max(net.vol[i]*rf, 1e-9), 0, 100); };
/* MPa of pool standing over the drain in a vessel's floor: the machine's own drawn height, weighed as liquid, at full commissioning fill and falling away with the pool as it drains. No node elevation can carry it - the surface moves. */
const poolH = (net, s, i) => { const nm = net.name[i], lvl = poolLvlOf(net, s, i);
  if(lvl === undefined) return 0;
  const p = partOf(nm.slice(0, -1)); if(!p) return 0;
  const c = satOfCirc(circOfNode(nm)), f = clamp(lvl/Math.max(condFill0(), 1), 0, 1);
  return rhofOf(c, satT(c, netPAt(s, nm)))*G_MPA*Math.max(p.h, 1)*MPC*f;
};

/* three passes, and both cuts are forced: the elevation copy and the fitTarget walk need EVERY edge to exist, and the condenser splice looks edges up by node NAME */
function netBuild(){
  const ctx = netEdges();
  return netFinish(netMaps(ctx), ctx);
}

/* pass one: nothing here reads a derived array */
function netEdges(){
  const net = pipeNetwork();
  // captured here because the edge closures are built before the net object exists
  const F = netFieldOf();
  const byKey = {};
  for(const r of net) byKey[r.key] = r;
  const byId = {};
  for(const q of LAY.parts) byId[q.id] = q;
  /* a folded node is the bare part id, so the whole name is looked up before a face is sliced off it */
  const partOfNode = nid => byId[nid] || byId[nid.slice(0, -1)];
  /* off the part's own declared ROLE.fixed, so it follows the drawing; a tank with no CELL still has no node */
  const tankIdOf = nid => {
    const p = partOfNode(nid), R = p && ROLE[p.role], t = p && D.tanks[p.id];
    return (R && R.fixed && R.fixed.type === "tank" && t) ? p.id : null;
  };

  const nodes = [], index = {};
  const nodeIdx = nid => { if(!(nid in index)){ index[nid] = nodes.length; nodes.push(nid); } return index[nid]; };
  /* the first vessel's node; a drawing with no vessel keeps a bare node under the same name so every reader still has a frame */
  const coreNode = nodeIdx(primaryCore() ? coreFold(primaryCore()) : "core");

  const edges = [];
  /* a relief fitting whose header never resolved lands on the SAME containment node a break uses */
  const contNode = tag => nodeIdx("cont:" + tag);
  const breakIds = [];
  // the steam-side holes, for the shell balance step() runs
  const steamBreaks = [];
  /* a break at a pipe cell discharges at that cell, not at the machine the run terminates on; applied in the elevation pass below */
  const contZ = {};
  /* a break at a pipe cell lets go INTO whatever region that cell is in */
  const contCell = {};

  /* LAY.parts' own order, which is what makes primaryRelief() (step.js) deterministic with nobody sorting anything */
  const fitIds = [], fitMode = {};
  for(const p of LAY.parts) if(p.role === "fitting"){
    fitIds.push(p.id); fitMode[p.id] = fitModeOf(p.id); }

  /* two half-length edges in series add their K, so the bends, the nozzles and any in-line throttle go on ONE half only */
  for(const r of net){
    const ends = runEnds(r.key, r.k);
    if(!ends) continue;
    const u = nodeIdx(coreFold(ends[0])), v = nodeIdx(coreFold(ends[1]));
    /* a self-connection is legal and must be INERT; a run between two DIFFERENT faces of one part is not this case */
    if(u === v) continue;
    const bore = runBore(r), Lh = r.L/2, K0 = runK0(r);
    const tid = tankIdOf(ends[0]) || tankIdOf(ends[1]);
    const mid = nodeIdx(runNodeOf(r.key));
    /* one key names the run, and exactly one half is the METER, or a reader summing over a key reads a series pair as twice the flow */
    const ea = {u, v: mid, h: 0, kind: r.k, key: r.key, end: r.pa, chokeAt: mid};   // LABEL: kind carried for rendering/lookup, never re-compared here
    const eb = {u: mid, v, h: 0, kind: r.k, key: r.key, end: r.pb, chokeAt: mid, meter: false};
    ea.pair = eb;   // the meter half holds its far half, so "what crosses this pipe" can ask both
    /* the water in the pipe has mass, so the flow through it cannot be changed for nothing: L/A, off the SAME length and area the friction law is priced on */
    ea.I = eb.I = Math.max(Lh, NET_COMP_LEN)/areaOf(bore);
    /* off the flow this edge carried last solve, at its donor's viscosity: the same one-tick lag the density carries */
    const fa = () => fricOf(bore, ea.w, F.mu[ea.w >= 0 ? u : mid]);
    const fb = () => fricOf(bore, eb.w, F.mu[eb.w >= 0 ? mid : v]);
    /* a vapour run off a two-phase vessel is a SEPARATOR: it draws the steam, never the drum's mixture */
    if(edgeLaw(r) === LAW_VAPOUR){ ea.gasAt = u; eb.gasAt = v; }
    if(tid){
      /* a tank's line is ordinary pipe, priced off its own drawn bore and length like every other run */
      ea.C = s => (tankLive(s,tid) && portLive(s,r.pa)) ? pipeC(bore, Lh, K0, fa()) : 0;
      eb.C = s => (tankLive(s,tid) && portLive(s,r.pb)) ? pipeC(bore, Lh, 0,  fb()) : 0;
      // a checked tank's line passes OUT of the tank only (flowG's diode)
      if(D.tanks[tid].check) ea.diode = eb.diode = tankIdOf(ends[0]) ? 1 : -1;
      /* a relief line takes the vessel's VAPOUR; structural, off the fitting the run lands on */
      { const at = tankIdOf(ends[0]) ? 0 : 1, far = ends[at ? 0 : 1];
        const fp = partOf(far) || partOf(far.slice(0, -1));
        if(fp && fitMode[fp.id] === "relief"){
          if(at) eb.gasAt = v; else ea.gasAt = u; } }
      edges.push(ea, eb);
      continue;
    }
    /* a steam line is a pipe: one graph, one relation, at each end's own density */
    ea.C = s => portLive(s,r.pa) ? throttledC(s, bore, Lh, NO_GATES, K0, fa()) : 0;
    eb.C = s => portLive(s,r.pb) ? throttledC(s, bore, Lh, NO_GATES, 0,  fb()) : 0;
    edges.push(ea, eb);
  }

  // internal component paths; h is a FUNCTION of s so a damaged pump tracks s.dmgParts live, never baked in at build time
  for(const p of LAY.parts){
    const R = ROLE[p.role];
    if(!R || !R.internal) continue;
    /* a LIST: a component may carry more than one path that does NOT join up inside it */
    for(const IN of (Array.isArray(R.internal) ? R.internal : [R.internal])){
    /* coreFold() BEFORE nodeIdx(), or a tee's two ends are two nodes and the self-loop test below never fires */
    const ua = nodeIdx(coreFold(p.id+IN.a));
    const ub = nodeIdx(coreFold(p.id+IN.b));
    if(ua === ub) continue;
    const edge = {u: ua, v: ub,
                  C: compC(IN.K), h: 0, kind: IN.kind, key: "comp:"+p.id+":"+IN.a+IN.b,
                  I: partPathI(p.id, IN)};
    /* per FACE and not per edge: a shell path is water at the feed nozzle and steam at the steam nozzle */
    if(IN.vap){ edge.vapU = IN.vap.indexOf("a")>=0;
                edge.vapV = IN.vap.indexOf("b")>=0; }
    /* a fitting's internal path is whatever FIT[mode] says it is, priced off its own bore */
    if(IN.gate){
      const row = FIT[fitModeOf(p.id)];
      if(!row) continue;                       // a mode with no edge (tee) - already skipped above
      const bore = fitBoreK(p.id);
      edge.C = s => row.C(s, p.id, bore, NET_COMP_LEN);
      edge.fit = p.id;
      edge.key = fitEdgeKey(p.id);
    }
    /* one regulating valve per generator: one pump on a shared header cannot hold two shells at level against their own secP() spread */
    if(R.sgtr && IN === roleIns(p)[1]){
      edge.shellOf = p.id;
      /* a GATE and not a back-pressure: a fraction shut, 0..1, closing the path itself, so no differential can outgrow the valve's authority */
      edge.C = s => feedTrainC()*(1 - clamp((s && s.fregBy && s.fregBy[p.id]) || 0, 0, 1));
      /* a feedwater check valve, which every real generator has and for this reason: without one a shell above its own feed header blows down through the nozzle, and a shell that empties backwards takes the heaters with it - the water arriving is then the shell's own and there is no bleed to take */
      edge.diode = 1;
    }
    if(IN.head){
      /* signed a -> b by the CASING and nothing else, so a pump plumbed backwards pumps backwards; a part no run reaches carries no head */
      const routed = net.usage && (net.usage[p.id+"t"]||net.usage[p.id+"b"]||net.usage[p.id+"l"]||net.usage[p.id+"r"]);
      if(routed) edge.h = s => pumpHeadNow(s, p.id);
      /* the casing is priced off the RATIO the machine states, head per rated kg/s, so the runout multiple is the same for every pump on the grid. The density is the DESIGN one and it is taken once: a passage is a geometry, and read live off F.rho it never cancelled the donor's own F.rhoD in the flow law - a suction that flashed then priced the casing at vapour and passed the law liquid, and the pump became a hole (measured: a feed pump at 23 202 kg/s against a 636 rating, its suction at -0.15 MPa). */
      { const c = circOfNode(coreFold(p.id + IN.a));
        edge.C = pumpCasingC(pumpHead(p.id), pumpFlow(p.id), circDesRho(c, false, 0)); }
      /* standby and feed pumps only: a coolant or circ pump with a diode welds its loop shut against natural circulation */
      if(pumpStandby(p.id) || pumpBounds(p.id).shell) edge.diode = 1;
    }
    /* a wreck is not a length of pipe: its path is gone, and g<=0 is an ABSENT edge */
    { const c0 = edge.C, pid = p.id;
      const dead = s => partWrecked(s, pid);
      edge.C = typeof c0 === "function" ? s => dead(s) ? 0 : c0(s)
                                        : s => dead(s) ? 0 : c0; }
    edges.push(edge);
    }
  }

  /* a valve with one side carrying no run at all is open to the room, on the same containment anchor a break gets; a face GROUP, so a valve plumbed vertically is the same valve */
  const reliefContNode = fid => { const i = contNode("relief:"+fid); breakIds.push(i);
    // it lets go where the VALVE stands, so it lets go into that valve's own region
    const q = byId[fid]; if(q) contCell[i] = [q.x+((q.w/2)|0), q.y+((q.h/2)|0)];
    return i; };
  const faceUse = (fid, faces) => faces.reduce((n,f) => n + ((net.usage && net.usage[fid+f]) || 0), 0);
  /* asked in the same loop that decides WHICH side is open, so the two cannot disagree; a tank CATCHES a discharge, the skin lets it GO */
  const openSide = {}, fitVentOut = {};
  const OPENF = {l:["l","t"], r:["r","b"]};
  for(const fid of fitIds){
    if(fitMode[fid] !== "relief") continue;
    const inU = faceUse(fid, ["l","t"]), outU = faceUse(fid, ["r","b"]);
    if(!!inU === !!outU) continue;            // piped both sides, or plumbed to nothing at all
    const side = outU ? "l" : "r";
    const open = nodeIdx(fid + side);
    openSide[fid] = open;
    const q = byId[fid];
    fitVentOut[fid] = !!q && OPENF[side].some(f => hullCell(q.x+DIRV[f][0], q.y+DIRV[f][1]));
    edges.push({u: open, v: reliefContNode(fid), C: pipeC(fitBoreK(fid), NET_COMP_LEN),
                h: 0, kind: "vent", key: "vent:"+fid});   // LABEL: synthetic kind, for the z-pass below
  }

  /* one containment node per pipe cell, at that cell's own elevation; g is exactly 0 until the cell is hit, so the node SET stays constant for the factorisation cache */
  // two steam walks per shell, hoisted: neither set depends on the run
  const shellIds = shellFaces().map(sh => sh.id), steamSeen = {}, headSeen = {};
  for(const id of shellIds){ steamSeen[id] = steamNodesOf(id); headSeen[id] = steamNodesOf(id, true); }
  for(const r of net){
    const ends = runEnds(r.key, r.k);
    if(!ends) continue;
    const bore = runBore(r), hC = holeC(bore);
    /* asked of the drawing, never of a run's name: both ends secondary is secondary water */
    const sec = secondaryNode(ends[0]) && secondaryNode(ends[1]);
    const shells = sec ? shellIds.filter(id => steamSeen[id][ends[0]] || steamSeen[id][ends[1]]) : [];
    const steam = shells.length > 0;
    /* past the turbine it is exhaust, in the condenser's vacuum: a hole there lets air IN rather than steam out */
    const exh = steam && !shells.some(id => headSeen[id][ends[0]] || headSeen[id][ends[1]]);
    if(steam) steamBreaks.push({cells: r.cells, exh});
    /* the run's own node, never a fresh one: a self-connection got no node above, and minting one here hangs break edges off a node nothing touches */
    const um = index[runNodeOf(r.key)];
    if(um === undefined) continue;
    for(const [x,y] of r.cells){
      const v = contNode("pipe:"+x+","+y);
      breakIds.push(v);
      contZ[v] = zRow(y);                  // the hole's own elevation, not a machine's
      contCell[v] = [x,y];
      edges.push({u: um, v, C: s => cellBroken(s,x,y) ? hC : 0,
                  h: 0, kind: "break", sec, steam, key: "break:"+r.key});
    }
    /* a wrecked nozzle valve is one more opening on the same run, discharging at ITS OWN cell */
    for(const pid of [r.pa, r.pb]){
      const c = portCell(pid); if(!c) continue;
      const v = contNode("port:"+pid);
      breakIds.push(v);
      contZ[v] = zRow(c[1]);
      contCell[v] = c;
      edges.push({u: um, v, C: s => portWrecked(s,pid) ? hC : 0,
                  h: 0, kind: "break", sec, steam, key: "break:"+r.key});
    }
  }
  /* the shaft WORK crossing this edge is charged in the enthalpy (turbDh, step.js), never as a head here, or the energy leaves twice */
  for(const p of LAY.parts){
    const R = ROLE[p.role]; if(!R || !R.vapPath) continue;
    const ua = nodeIdx(coreFold(p.id+R.vapPath.a)), ub = nodeIdx(coreFold(p.id+R.vapPath.b));
    if(ua === ub) continue;
    edges.push({u: ua, v: ub, C: s => turbCOf(s, p.id), h: 0, kind: "vap",
                key: "vap:"+p.id, machine: p.id, work: !!R.vapPath.work,
                vapU: true, vapV: true});
  }
  /* one tube-rupture edge and one opening per generator, both g exactly 0 until that generator is hit */
  const secTIds = [], secTParts = [];
  for(const q of LAY.parts) if(ROLE[q.role] && ROLE[q.role].sgtr){
    const id = q.id, v = nodeIdx(shellNode(id));
    edges.push({u: nodeIdx(id+"b"), v, C: s => sgtrLive(s, id) ? sgtrC()*sgWastOf(s, id) : 0,
                h: 0, kind: "sgtr", key: "sgtr:"+id});
    /* registered whether or not a steam run routed: it STORES, so its row solves with no edges at all, which is a generator pressurising onto its own safeties */
    secTIds.push(v); secTParts.push(id);
    /* a burst or wrecked shell is an opening like any other vessel's, and the only way out of a vessel in the field is an EDGE */
    { const c = contNode("sg:"+id);
      breakIds.push(c);
      contZ[c] = zFace(q, "b");
      contCell[c] = [q.x+((q.w/2)|0), q.y+q.h-1];
      edges.push({u: v, v: c, C: s => sgOpen(s, id) ? holeC(BREACH_BORE) : 0,
                  h: 0, kind: "break", sec: 1, key: "break:"+id}); }
  }

  /* a sink is an ordinary vessel: the exhaust space and the pool under it are ONE node, and the condensate nozzle in its floor is the other */
  const condVIds = [], condParts = [];
  for(const q of LAY.parts){ const IN = condIN(q.id); if(!IN) continue;
    const id = q.id, va = nodeIdx(condVesNode(id)), vb = nodeIdx(condOutNode(id));
    if(va === vb) continue;
    condVIds.push(va); condParts.push(id);
    /* one opening, two causes: a wrecked machine is a breach and the operator's drain is a duty-sized hole */
    { const c = contNode("cond:"+id);
      breakIds.push(c);
      contZ[c] = zFace(q, "b");
      contCell[c] = [q.x+((q.w/2)|0), q.y+q.h-1];
      edges.push({u: va, v: c, h: 0, kind: "break", sec: 1, key: "break:"+id,
                  C: s => partWrecked(s, id) ? holeC(BREACH_BORE)
                        : condDumpOpen(s) ? dutyC(condDumpKgs(), TANK_RHO) : 0}); }
  }

  /* the vessel's own opening */
  for(const cid of coreIds()){ const v = contNode(cid), q0 = byId[cid], u = nodeIdx(coreFold(cid));
    breakIds.push(v);
    contCell[v] = [q0.x+((q0.w/2)|0), q0.y+((q0.h/2)|0)];
    edges.push({u, v, C: s => (coreState(s,cid)||s).breach ? holeC(BREACH_BORE) : 0,
                h: 0, kind: "break", key: "break:"+cid}); }
  /* a WRECKED vessel gets a second opening at its own FLOOR, so the column keeps pushing after the pressures equalise; two edges, because net.z is settled at build time and damage is live */
  for(const cid of coreIds()){ const q = byId[cid], v = contNode(cid+":floor"), u = nodeIdx(coreFold(cid));
    breakIds.push(v);
    contZ[v] = zFace(q, "b");
    contCell[v] = [q.x+((q.w/2)|0), q.y+q.h-1];
    edges.push({u, v, C: s => partWrecked(s, q.id) ? holeC(BREACH_BORE) : 0,
                h: 0, kind: "break", key: "break:"+cid}); }

  /* a torn channel is two holes of the tube's bore over the share the core has opened; once the shield is off the open face is the one breach figure */
  const cavIds = [], cavCont = {}, cavVol = {};
  for(const cid of coreIds()){ const c = coreD(cid), q0 = byId[cid]; if(!c || !c.tube || !q0) continue;
    const u = nodeIdx(coreFold(cid)), cav = nodeIdx("cav:"+cid), v = contNode("cav:"+cid);
    breakIds.push(v); contCell[v] = [q0.x+((q0.w/2)|0), q0.y+((q0.h/2)|0)];
    cavIds.push(cav); cavCont[cid] = v; cavVol[cav] = cavVolM3(c);
    const one = 2*holeC(tubeBoreMm(c)/BORE_REF), n = tubeCount(c), relief = cavReliefC(cid, c, one);
    edges.push({u, v: cav, C: s => { const cs = coreState(s, cid); return (cs && cs.tubesOpen > 0) ? cs.tubesOpen*n*one : 0; },
                h: 0, kind: "cav", key: "cav:"+cid});   // LABEL: synthetic kind, a channel's two ends
    edges.push({u: cav, v, C: s => { const cs = coreState(s, cid); return !cs ? 0 : cs.breach ? holeC(BREACH_BORE) : cs.cavRelief ? relief : 0; },
                h: 0, kind: "break", key: "break:cav:"+cid}); }

  /* a vessel whose water is the CIRCUIT's sits at an ordinary node, so the only way out of it is an EDGE; a tank with a pool of its own drains its level in step(). A wreck and a rupture disc are the same opening, differing in where on the shell it is. */
  for(const id of tankIds()){
    if(!D.tanks[id].hold && !tankInField(id)) continue;
    const q = byId[id]; if(!q) continue;
    // a vessel nothing is plumbed to has no node, and this may not invent one
    if(index[id] === undefined) continue;
    const v = contNode("tank:"+id+":floor");
    breakIds.push(v);
    contZ[v] = zFace(q, "b");
    contCell[v] = [q.x+((q.w/2)|0), q.y+q.h-1];
    edges.push({u: nodeIdx(id), v, C: s => partWrecked(s, id) ? holeC(BREACH_BORE)
                                         : (s.burstBy && s.burstBy[id]) ? tankDiscC(id) : 0,
                h: 0, kind: "break", key: "break:"+id});
  }

  return {runs: net, byKey, byId, partOfNode, tankIdOf, nodes, index, coreNode, edges, F,
          breakIds, steamBreaks, contZ, contCell, fitIds, fitMode, openSide, fitVentOut, cavIds, cavCont, cavVol,
          secTIds, secTParts, condVIds, condParts};
}

/* pass two: read-only over the edge list it is handed */
function netMaps(ctx){
  const net = ctx.runs, byKey = ctx.byKey, byId = ctx.byId,
        partOfNode = ctx.partOfNode, tankIdOf = ctx.tankIdOf,
        nodes = ctx.nodes, index = ctx.index, coreNode = ctx.coreNode,
        edges = ctx.edges, contZ = ctx.contZ, contCell = ctx.contCell, breakIds = ctx.breakIds,
        steamBreaks = ctx.steamBreaks, fitIds = ctx.fitIds, fitMode = ctx.fitMode,
        openSide = ctx.openSide, fitVentOut = ctx.fitVentOut,
        secTIds = ctx.secTIds, secTParts = ctx.secTParts;

  /* a walk from the valve's discharge side, stopping AT a tank and never crossing one; which side is the discharge is the side that does not reach the core */
  const fitTarget = {};
  const coreSet = new Set(coreIds().map(q => index[coreFold(q)]).filter(i => i !== undefined));
  {
    const adjn = Array.from({length: nodes.length}, () => []);
    for(const ed of edges){
      if(ed.fit) continue;                                    // never cross another valve's own gate
      if(netHole(ed)) continue;                                // a hole leads nowhere a discharge can be caught
      adjn[ed.u].push(ed.v); adjn[ed.v].push(ed.u);
    }
    const walk = from => {
      const seen = new Set([from]), st = [from];
      let tank = null, core = false;
      while(st.length){
        const u = st.pop();
        if(coreSet.has(u)) core = true;
        const tid = tankIdOf(nodes[u]);
        if(tid){ if(!tank) tank = tid; continue; }             // reached, never crossed
        for(const v of adjn[u]) if(!seen.has(v)){ seen.add(v); st.push(v); }
      }
      return {tank, core};
    };
    for(const fid of fitIds){
      fitTarget[fid] = null;
      if(fitMode[fid] !== "relief") continue;
      if(openSide[fid] !== undefined) continue;                // vents to the room; no tank to name
      const l = index[fid+"l"], r = index[fid+"r"];
      if(l === undefined || r === undefined) continue;
      const L = walk(l), R = walk(r);
      fitTarget[fid] = (!L.core && L.tank) || (!R.core && R.tank) || null;
    }
  }

  const net2 = {nodes, index, edges, core: coreNode, n: nodes.length, byKey, fitIds, fitMode, F: ctx.F,
                cont: breakIds, contCell, secT: secTIds, secTParts, fitTarget, fitVentOut,
                condV: ctx.condVIds, condParts: ctx.condParts,
                steamBreaks, cav: ctx.cavIds || [], cavCont: ctx.cavCont || {}, cavVol: ctx.cavVol || {},
                surgeKey: (byKey && Object.keys(byKey).find(k=>k.indexOf("surge:")===0)) || null};

  /* geometry, not state; anything unresolvable sits at the core's height, so it contributes no static head rather than a wrong one */
  const coreP = byId.core;
  const zCore = coreP ? zFace(coreP, "c") : 0;
  net2.z = new Float64Array(net2.n);
  const unplaced = [];
  for(let i=0;i<net2.n;i++){
    const z = nodeZ(nodes[i]);
    if(z === null) unplaced.push(i); else net2.z[i] = z;
  }
  /* a containment node sits at the height of the opening it is on the far side of, so the break edge spans no column */
  for(const ed of edges) if(netHole(ed)) net2.z[ed.v] = net2.z[ed.u];
  for(const i of unplaced) net2.z[i] = zCore;   // set above if it is an opening; the core's height otherwise
  for(const i in contZ) net2.z[i] = contZ[i];   // ...and a pipe-cell break is at the CELL, not at either machine

  net2.coreNode = coreNode;   // holdLive() needs the loop end of the walk
  net2.coreSet = coreSet;
  // every vessel's own node, by id, and the id back off the node
  net2.coreNodes = {}; net2.coreOfNode = {};
  for(const q of coreIds()){ const i = index[coreFold(q)]; if(i !== undefined){ net2.coreNodes[q] = i; net2.coreOfNode[i] = q; } }
  /* the FALLBACK anchor only: netRef() decides per solve off the live hold tanks, and a plant with none still needs a real node */
  net2.pzrNode = coreNode;
  /* on the built network rather than on D.tanks, which rides designSig() and would churn on a per-frame writeback */
  net2.tankNid = {};
  net2.tankNode = {};
  net2.tankIdByNode = {};
  /* which vessels keep their water in the field, settled HERE so netBooked() stays structural - off the maps netBuild() wrote, never off a live pressure */
  net2.tankField = {};
  for(const nid in index){
    const tid2 = tankIdOf(nid);
    if(tid2 && net2.tankNode[tid2] === undefined){
      net2.tankNode[tid2] = index[nid]; net2.tankIdByNode[index[nid]] = tid2; net2.tankNid[tid2] = nid;
      net2.tankField[tid2] = (D.tanks[tid2] && D.tanks[tid2].hold) || tankInField(tid2);
    }
  }
  // index the other way: nodes are addressed by NAME, because that is what survives a snapshot
  net2.name = new Array(net2.n);
  for(const nid in index) net2.name[index[nid]] = nid;
  netFieldSize(net2.F, net2.n);
  net2.vol = new Float64Array(net2.n);
  { const nodesOfPart = net2.nodesOfPart = {};
    // a FOLDED node is the bare part id, so ask the whole name first and only then strip a face off it
    const partOfNodeV = nid => byId[nid] || partOfNode(nid);
    for(const nid in index){ const q = partOfNodeV(nid);
      if(q) (nodesOfPart[q.id] || (nodesOfPart[q.id] = [])).push(index[nid]); }
    for(const pid in nodesOfPart){ const list = nodesOfPart[pid];
      for(const i of list) net2.vol[i] += nodeVol(pid, net2.name[i], list); }
    /* the steam face IS the shell: the stated water at 100 % level, plus the space over it */
    for(const id of sgIds()){ const i = index[shellNode(id)];
      if(i !== undefined) net2.vol[i] += Math.max(0.1, sgRowOf(id).water*SG_DOME); }
    /* the vessel IS the hotwell: the ship's stated pool, this machine's share, full at level 100 */
    { const v = condPoolVol();
      for(const id of ctx.condParts){ const i = index[condVesNode(id)];
        if(i !== undefined) net2.vol[i] += Math.max(0.1, v); } }
    /* a run's water is all on the run's own node; a shut port is simply a missing edge */
    for(const r of net){ const m = index[runNodeOf(r.key)];
      if(m !== undefined) net2.vol[m] += runVol(r); }
    for(const i in net2.cavVol) net2.vol[i] = net2.cavVol[i];   // a reactor cavity is no part: its holdup is its own stated volume
    for(let i=0;i<net2.n;i++) if(!(net2.vol[i] > 1e-3)) net2.vol[i] = 1e-3;
    /* kg of steel per node - the wall follows the water - with the first conduction mode's time constant, half-thickness squared over pi^2 alpha */
    net2.metalKg = new Float64Array(net2.n); net2.metalTau = new Float64Array(net2.n); net2.metalUA = new Float64Array(net2.n);
    { const tauOf = wallMm => Math.max(1, Math.pow(wallMm/2000, 2)/(Math.PI*Math.PI*ALPHA_STEEL));
      // kW/K of film on the wetted wall: a thick wall couples to helium through the gas, not through the conduction mode
      const put = (i, kg, tau, area) => { if(!(kg > 0) || i === undefined) return;
        net2.metalUA[i] += (netSatOf(nodes[i]).hFilm || SAT_WATER.hFilm)*area/1000;
        net2.metalTau[i] += kg*tau; net2.metalKg[i] += kg; };
      for(const cid of coreIds()){ const ci = coreCircOf(cid), list = nodesOfPart[cid];
        if(!list || ci < 0) continue;
        const c = coreD(cid), a = COOLANT[c.cool], p0 = holdSetP(ci);
        const L = latM(c), dM = ((L && L.dia) || 3) + 2*VESSEL_CLR;
        // a tube core's nodes own the channels' zirconium, wetted on every bore
        const kg = (c.tube ? tubeMass(p0, a, c) : vesselShellMass(p0, a))*1000/list.length,
              tau = tauOf(c.tube ? tubeWallMm(p0, a, c) : wallSuggestMm(dM*1000, p0, a)),
              area = (c.tube ? tubeCount(c)*Math.PI*tubeBoreMm(c)/1000*L.hgt : Math.PI*dM*((L && L.hgt) || 4))/list.length;
        for(const i of list) put(i, kg, tau, area); }
      for(const r of net){ const m = index[runNodeOf(r.key)]; if(m === undefined) continue;
        put(m, runMassPerM(r)*r.L*1000, tauOf(runWallMm(r)), Math.PI*runBoreMm(r)/1000*r.L); }
      for(let i=0;i<net2.n;i++) if(net2.metalKg[i] > 0) net2.metalTau[i] /= net2.metalKg[i]; } }

  // the other way round: a reader asks per machine, the arrays are what the solve walks
  net2.condVById = {};
  for(let k=0;k<net2.condParts.length;k++) net2.condVById[net2.condParts[k]] = net2.condV[k];

  return net2;
}

/* pass three: everything here reads the ASSEMBLED edge list, so the order in it is load-bearing */
function netFinish(net2, ctx){
  const edges = net2.edges, index = ctx.index, fitIds = ctx.fitIds,
        fitMode = ctx.fitMode, secTIds = ctx.secTIds, secTParts = ctx.secTParts;

  /* the ONE edge the pool's own column stands on: the drop from the water surface to the condensate nozzle in the vessel's floor. The exhaust nozzle is over the water and sees none of it. */
  for(let k=0;k<net2.condParts.length;k++){
    const ed = edges.find(e => e.key === "comp:"+net2.condParts[k]+":"+condIN(net2.condParts[k]).a+condIN(net2.condParts[k]).b);
    if(ed) ed.poolAt = net2.condV[k]; }

  /* STRUCTURAL: a node every edge touching it reaches through vapour is a steam space, and nothing is named */
  // the nodes a steam nozzle draws on, so the field prices a vapour density for those and no others
  net2.gasNodes = [...new Set(edges.filter(ed => ed.gasAt !== undefined).map(ed => ed.gasAt))];
  net2.vapour = new Uint8Array(net2.n);
  { const any = new Uint8Array(net2.n);
    net2.vapour.fill(1);
    for(const ed of edges){
      /* a hole is not contents: it hangs off every run alike and says nothing about what is inside it */
      if(netHole(ed)) continue;
      any[ed.u]=1; any[ed.v]=1;
      // a run answers off its own LAW; a component path answers per FACE, off the row that declared it
      const k = edgeLaw(ed) === LAW_VAPOUR;
      if(!(ed.vapU || k)) net2.vapour[ed.u]=0;
      if(!(ed.vapV || k)) net2.vapour[ed.v]=0;
    }
    // a hole's own node is full of what it pierces: the loop above leaves it touched by nothing
    const hole = new Uint8Array(net2.n);
    for(const ed of edges){
      if(ed.kind!=="break" && ed.kind!=="vent") continue;
      if(any[ed.u] && !any[ed.v]){ hole[ed.v]=1; if(!net2.vapour[ed.u]) net2.vapour[ed.v]=0; }
      if(any[ed.v] && !any[ed.u]){ hole[ed.u]=1; if(!net2.vapour[ed.v]) net2.vapour[ed.u]=0; }
    }
    for(let i=0;i<net2.n;i++) if(!any[i] && !hole[i]) net2.vapour[i]=0; }
/* a direction and animation label only; nothing in the heat balance may read it */
  net2.tag = new Uint8Array(net2.n);
  for(const ed of edges){
    const b = KIND_TEMP[ed.kind] || 0;
    if(b){ net2.tag[ed.u] |= b; net2.tag[ed.v] |= b; }
  }
  for(let i=0;i<net2.n;i++) if(net2.tag[i] === (NT_HOT|NT_COLD)) net2.tag[i] = 0;
  // per RUN KEY, for the animation's "is either end tagged" read (step.js)
  net2.tagByKey = {};
  for(const ed of edges) if(ed.key)
    net2.tagByKey[ed.key] = net2.tagByKey[ed.key] || net2.tag[ed.u] || net2.tag[ed.v];
  // net.secT read the other way: netReadEdges() walks EDGES and needs the shell a node belongs to
  net2.secTById = {};
  for(let k=0;k<secTIds.length;k++) net2.secTById[secTIds[k]] = secTParts[k];

  /* the static term added once here, not at each push site: a column is a property of an edge's two ends */
  for(const ed of edges){
    const src = ed.h;
    /* the source kept beside the total: the choke gate asks whether anything is RAISING the pressure, and a column is not */
    ed.hSrc = typeof src === 'function' ? s => src(s)*HEAD_K
            : src ? () => src*HEAD_K : null;
    ed.h = typeof src === 'function' ? s => (src(s) + staticH(net2, ed, s))*HEAD_K
         : src ? s => (src + staticH(net2, ed, s))*HEAD_K
         : s => staticH(net2, ed, s)*HEAD_K;
  }
  /* AFTER the head loop: g is linearised about the full driving differential, and the static term is part of it */
  // its own slot in the choke mask, so edgeG can say which edge the cap bit on
  net2.choke = new Uint8Array(edges.length);
  for(let i=0;i<edges.length;i++) edges[i].i = i;
  for(const ed of edges) if(ed.C !== undefined){ ed.g = s => edgeG(net2, ed, s);
    ed.h0 = ed.h; ed.h = s => edgeH(ed, s); }

  /* connected components over the STRUCTURAL edge list, never ed.g: a reference frame must not jump when an operator turns a handwheel */
  net2.comp = new Int32Array(net2.n).fill(-1);
  { const adj = new Array(net2.n);
    for(const ed of edges){ (adj[ed.u] || (adj[ed.u]=[])).push(ed.v); (adj[ed.v] || (adj[ed.v]=[])).push(ed.u); }
    let c = 0;
    for(let i=0;i<net2.n;i++){
      if(net2.comp[i] >= 0) continue;
      const st = [i]; net2.comp[i] = c;
      while(st.length){ const u = st.pop(); const nb = adj[u]; if(!nb) continue;
        for(let k=0;k<nb.length;k++){ const v = nb[k]; if(net2.comp[v] < 0){ net2.comp[v] = c; st.push(v); } } }
      c++;
    }
    net2.nComp = c;
  }
  /* off the first node in it that names a circuit: a synthetic node answers -1 and is skipped */
  net2.compCirc = new Int32Array(net2.nComp).fill(-1);
  for(let i=0;i<net2.n;i++){
    const c = net2.comp[i];
    if(net2.compCirc[c] >= 0) continue;
    const ci = circOfNode(coreFold(net2.name[i]));
    if(ci >= 0) net2.compCirc[c] = ci;
  }

  return net2;
}

/* MPa: what a piece with no anchor of its own keeps, so a component nothing pins does not invent a zero */
const netLevel = s => (s.P === undefined ? P.P0 : s.P);   // a piece with no store at all; never an anchor
/* somewhere the water can go: entries are MARKERS, never pressures, and which nodes store is asked STRUCTURALLY - via netStore() it is tankP() -> holdLive() -> netFixed() -> netRef() -> netPieces() -> netLiveSig() -> tankLive() -> tankP() */
function netBounds(net, s){
  const b = netFixed(net, s);
  /* a vessel in the field is nowhere the water GOES - it is somewhere the water is */
  for(const id in net.tankNode){ const i = net.tankNode[id];
    if(tankStores(id) && !tankInField(id) && b[i] === undefined) b[i] = 0; }
  return b;
}
/* live when the piece the tank stands in has a CYCLE in it: a tree hanging off the vessel is a stub it pressurises and nothing else */
function holdLive(net, s, ci){
  const holds = holdOnCirc(ci);
  if(!holds.length) return true;                  // nothing on this circuit to disconnect
  const t = net.tankNode[holds[0]];
  if(t === undefined) return false;               // a vessel sitting there unplumbed
  /* memoised on what the walk reads: the live edge set and the fixed SET, which beyond that only moves with a burst shell or the commissioning hold */
  const pc = netPieces(net, s);
  let bk = netStoreHeld ? 'H' : '';
  if(s && s.sgBurst) for(const k in s.sgBurst) if(s.sgBurst[k]) bk += '|' + k;
  if(net.hlPc !== pc || net.hlKey !== bk){ net.hlPc = pc; net.hlKey = bk; net.hl = {}; }
  const was = net.hl[ci];
  if(was !== undefined) return was;
  const fixed = netBounds(net, s);
  const adj = pc.adj, live = pc.live;
  // the seed is exempt from its own fixed test: a hold tank's node IS an anchor
  const seen = new Uint8Array(net.n), stack = [t];
  let nodes = 1; seen[t] = 1;
  while(stack.length){
    const a = adj[stack.pop()];
    if(a) for(let i=0;i<a.length;i++){ const v=a[i];
      if(seen[v] || fixed[v] !== undefined) continue;   // reached, never crossed
      seen[v] = 1; nodes++; stack.push(v); }
  }
  const pairs = new Set();
  for(let e=0;e<net.edges.length;e++){
    const ed = net.edges[e];
    if(!live[e] || !seen[ed.u] || !seen[ed.v] || ed.u === ed.v) continue;
    pairs.add(ed.u < ed.v ? ed.u+"|"+ed.v : ed.v+"|"+ed.u);
  }
  return (net.hl[ci] = pairs.size >= nodes);
}
const pzrLive = (net, s) => holdLive(net, s, nodeGraph().coreCirc);

/* SOLID is: no hold tank holding a bubble (the caller has already asked holdLive), and the live piece reaches no FIXED node */
const circSeed = (net, ci) => {
  for(let i=0;i<net.n;i++) if(net.compCirc[net.comp[i]] === ci) return i;
  return -1; };
function circSolid(net, s, ci){
  const holds = holdOnCirc(ci);
  const own = coreOnCirc(ci)[0];
  const seed = own ? net.index[coreFold(own)]
             : holds.length ? net.tankNode[holds[0]] : circSeed(net, ci);
  if(seed === undefined || seed === null || seed < 0) return false;
  /* an anchor is a REFERENCE, not a boundary: counting a sealed loop's own anchor says every sealed loop is open */
  const fixed = netBounds(net, s), ref = net.refNow;
  const bound = i => fixed[i] !== undefined && ref.anchor[ref.of[i]] !== i;
  if(bound(seed)) return false;
  const adj = netPieces(net, s).adj;
  const seen = new Uint8Array(net.n), st = [seed];
  seen[seed] = 1;
  while(st.length){
    const a = adj[st.pop()];
    if(a) for(let i=0;i<a.length;i++){ const v = a[i];
      if(bound(v)) return false;
      if(seen[v]) continue;
      seen[v] = 1; st.push(v); }
  }
  return true;
}
/* pieces are components over the LIVE edges, so isolation splits the frame; cached on the live signature the factorisation already builds */
function netPieces(net, s){
  if(net.pc && net.pcSig === netLiveSig(net, s)) return net.pc;
  const of = new Int32Array(net.n).fill(-1);
  const adj = new Array(net.n), live = new Uint8Array(net.edges.length);
  for(let e=0;e<net.edges.length;e++){
    const ed = net.edges[e];
    const g = typeof ed.g === 'function' ? ed.g(s) : ed.g;
    if(!(g > 0)) continue;
    live[e] = 1;
    (adj[ed.u] || (adj[ed.u] = [])).push(ed.v);
    (adj[ed.v] || (adj[ed.v] = [])).push(ed.u);
  }
  let c = 0;
  for(let i=0;i<net.n;i++){
    if(of[i] >= 0) continue;
    const st = [i]; of[i] = c;
    while(st.length){ const a = adj[st.pop()];
      if(a) for(let k=0;k<a.length;k++){ const v = a[k];
        if(of[v] < 0){ of[v] = c; st.push(v); } } }
    c++;
  }
  net.pcSig = netLiveSig(net, s);
  return (net.pc = {of, n: c, adj, live});
}
/* by node NAME or index; -1 for a node this plant has not got */
function pieceOf(net, s, node){
  const i = typeof node === "number" ? node : net.index[node];
  return i === undefined ? -1 : netPieces(net, s).of[i];
}
/* "still plumbed to the primary", for every gate below */
const corePiece = (net, s, cid) => netPieces(net, s).of[cid && net.coreNodes[cid] !== undefined ? net.coreNodes[cid] : net.coreNode];
// the live piece of EVERY vessel - "still plumbed to a core" is asked of all of them
const corePieces = (net, s) => { const of = netPieces(net, s).of, set = new Set();
  for(const id in net.coreNodes) set.add(of[net.coreNodes[id]]);
  if(!set.size) set.add(of[net.coreNode]); return set; };
/* its LOOP's pressure while it is live and its own the moment it is not */
const holdPOf = (s, id) => (s.holdPBy && s.holdPBy[id] != null)
  ? s.holdPBy[id] : loopP(s, tankCircuit(id));
/* the piece FRAME only: a piece with no store at all has nothing to stand on and keeps the plant's own level */
function netRef(net, s){
  const g = netLevel(s);
  const piece = netPieces(net, s);
  const p0 = new Float64Array(piece.n).fill(g);
  const anchor = new Int32Array(piece.n).fill(-1);
  return {p0, anchor, of: piece.of, nPiece: piece.n};
}
/* what a node lets go TO: a containment node knows its own cell, every other node stands in a machine */
const netCellOf = (net, i) => {
  const c = net.contCell && net.contCell[i];
  if(c) return c;
  const p = net.partOfNode && net.partOfNode(net.name[i]);
  return p ? [p.x+((p.w/2)|0), p.y+((p.h/2)|0)] : null;
};
const netPcont = (net, s, i) => { const c = netCellOf(net, i);
  return c ? regionP(s, c[0], c[1]) : P.Pcont; };
function netFixed(net, s){
  const ref = netRef(net, s);
  const f = {};
  net.refNow = ref;
  /* every value here is an ABSOLUTE pressure at the node it belongs to; the column rides the EDGES (staticH) */
  for(let c=0;c<ref.nPiece;c++) if(ref.anchor[c] >= 0) f[ref.anchor[c]] = ref.p0[c];
  /* one node per opening, always fixed: keeping the SET constant lets the factorisation cache key on the break's own live state */
  for(const i of net.cont) f[i] = netPcont(net, s, i);
  /* the settle stands every store down, so the hold tank is pinned at its setpoint for the length of the walk or the piece floats */
  if(netStoreHeld) for(const id of holdTankIds()){ const i = net.tankNode[id];
    if(i !== undefined) f[i] = holdPOf(s, id); }
  /* fixed at what its own gas space holds, open edge or not: an isolated node costs nothing and keeps the fixed SET constant */
  for(const id in net.tankNode){ const i = net.tankNode[id];
    if(D.tanks[id] && D.tanks[id].hold) continue;
    if(tankInField(id)) continue;             // an ordinary vessel: the solve says what it holds
    if(tankStores(id)) continue;              // it gives way instead (netStore)
    f[i] = tankP(s,id); }
  /* the shell is an ordinary vessel in the field: pinned only while the settle stands the stores down, and open through its own break edge */
  if(netStoreHeld) net.secT.forEach((i,k)=>{ f[i] = secP(s, net.secTParts[k]); });
  /* the condenser is an ordinary vessel in the field: pinned only while the settle stands the stores down, and open through its own break edge */
  /* ONE end of the machine, never both: an edge between two fixed nodes is an unlimited source at one and an unlimited sink at the other, and the whole condensate train solves round it.
     The VESSEL is the end that is pinned, because its pressure is the one that is known - the saturation over its own pool - and the outlet under it follows through the internal path, column and all. */
  if(netStoreHeld){ const pc = condP(s);
    net.condParts.forEach((id,k) => { if(condVacuum(id)) f[net.condV[k]] = pc; }); }
  return f;
}
/* simTick()'s literal 0.02, named: a compliance is per SECOND, so a storage term is the one place that has to know how long a tick is */
const NET_DT = 0.02;
/* whether the solve being asked for is one tick of a time march; only step() sets it */
let netMarch = false;
const netMarching = v => { netMarch = !!v; };
/* the settle and the reference solve are QUASI-STATIC figures, so every store stands down for them */
let netStoreHeld = false;
const netHoldStore = on => { netStoreHeld = !!on; };
/* per MPa: COOLANT[].solidK is beta over kappa, BETA_W is beta. A gas is exactly 1/p, and a two-phase node is the mass-weighted mixture of the two */
const SOLID_K_W = COOLANT[0].solidK;
const netKapF = ci => BETA_W/Math.max(1e-6,
  satOfCirc(ci).solidK || SOLID_K_W);
const netKappa = (nid, p, x) => { const q = clamp(x, 0, 1);
  const g = 1/Math.max(p, COND_P0);
  // a fluid above its own tc reads x 0 off the fictional tsat, and water's liquid floor is twice a gas's 1/p at 7 MPa
  return q*g + (1-q)*Math.min(g, netKapF(circOfNode(nid))); };
/* rho(p, h) is monotone in p on all three branches, so this has one answer: Newton off the curve's own slope, bisection-safeguarded. It is the STATE, not a correction about last tick's solved pressure, which diverges across the saturation line */
const NET_PMAX = 200;   // a node holding more than any pressure can account for is pinned, not solved
// r0/b0: the field's own read at p0 (netFieldUpdate), so a node already at its state point costs no curve read
function netPStar(c, p0, h, rhoT, r0, b0){
  /* an empty node is at the VACUUM, not at whatever it was last solved at */
  if(!isFinite(rhoT) || rhoT <= 0) return COND_P0;
  let p = clamp(p0, COND_P0, NET_PMAX), lo = COND_P0, hi = NET_PMAX;
  for(let k=0;k<40;k++){
    let r, b;
    if(k === 0 && p === p0 && r0 !== undefined){ r = r0; b = b0; }
    else { r = mixState(c, p, h, MIX_SCRATCH).rho; b = MIX_SCRATCH.b; }
    if(Math.abs(r - rhoT) <= 1e-6*rhoT) return p;
    if(r < rhoT) lo = p; else hi = p;
    const d = DRHO_DP(c, p, h, r, b);
    const nxt = d > 0 ? p - (r - rhoT)/d : (lo + hi)/2;
    p = (nxt > lo && nxt < hi) ? nxt : (lo + hi)/2;
  }
  return p;
}
function netStore(net, s){
  const cap = scratch(net, "cap", net.n, Float64Array, 0), src = scratch(net, "src", net.n, Float64Array, 0),
        pin = scratch(net, "pin", net.n, Uint8Array, 0);
  let any = false;
  /* the residual is the EQUATION OF STATE, never the last pressure: mEos is the target, C = V*drho/dp the slope, one Newton step onto the curve taken THROUGH the matrix. FIRST, so the two classes below overwrite it with their own exact term */
  /* memoised on (V, p, rho, b, h, m): netPStar() is a Newton walk of up to forty mixState() calls */
  const stN = net.stKp && net.stKp.length === net.n;
  const kp = stN ? net.stKp : (net.stKp = new Float64Array(net.n).fill(NaN)),
        kh = stN ? net.stKh : (net.stKh = new Float64Array(net.n).fill(NaN)),
        km = stN ? net.stKm : (net.stKm = new Float64Array(net.n).fill(NaN)),
        vP0 = stN ? net.stP0 : (net.stP0 = new Float64Array(net.n)),
        vC = stN ? net.stC : (net.stC = new Float64Array(net.n));
  for(let i=0;netStoreHeld?0:i<net.n;i++){
    const nid = net.name[i];
    /* floored at the run-dry line: a spent node with no diagonal is a degenerate row, and a spent node still has a pressure */
    const mEos = Math.max(net.vol[i]*net.F.rho[i], DRY_MIN_KG);
    const m = (s && s.mBy && s.mBy[nid] !== undefined) ? s.mBy[nid] : mEos;
    const V = net.vol[i], hN = netHAt(s, nid);
    const pF = net.F.p[i], rF = net.F.rho[i], bF = net.F.b[i];
    let p0, C;
    if(pF === kp[i] && hN === kh[i] && m === km[i]){ p0 = vP0[i]; C = vC[i]; }
    else {
      const c = netSatOf(nid);
      p0 = V > 0 ? netPStar(c, pF, hN, m/V, rF, bF) : pF;
      /* the curve's own slope at the state point, floored by netKappa() so a branch the curve reads flat still has a row to stand on */
      const d = p0 === pF ? DRHO_DP(c, p0, hN, rF, bF) : DRHO_DP(c, p0, hN);
      C = Math.max(V*d, mEos*netKappa(nid, p0, net.F.x[i]));
      kp[i] = pF; kh[i] = hN; km[i] = m; vP0[i] = p0; vC[i] = C;
    }
    if(!(C > 0) || !isFinite(C) || !isFinite(p0) || !isFinite(m)) continue;
    cap[i] = C/NET_DT; src[i] = C/NET_DT*p0;
    any = true;
  }
  /* a hold tank takes the generic row above but PINS: a pressurizer is what "something decides this circuit's pressure" means */
  for(const id in net.tankNode) if(D.tanks[id] && D.tanks[id].hold && !netStoreHeld){
    const i = net.tankNode[id]; if(cap[i] > 0) pin[i] = 1; }
  /* the charge is a COMPLIANCE and nothing else; on a vessel in the field it is linearised about that node's own last pressure, so the row carries no figure the solve did not produce. `pin` is not a matrix term - it is netReadP()'s "this piece does not float". */
  for(const id in net.tankNode){
    const i = net.tankNode[id], C = tankCapAt(s, id);
    if(!(C > 0) || !isFinite(C)) continue;          // before tankP(): a hold tank's is a graph walk
    const p0 = tankP(s, id);
    if(!isFinite(p0)) continue;
    cap[i] = C/NET_DT; src[i] = C/NET_DT*p0; pin[i] = 1;
    any = true;
  }
  // netStoreHeld leaves the TANKS alone: one that stopped storing unpinned is a piece that floats
  for(let k=0;netStoreHeld?0:k<(net.condV||[]).length;k++){
    const i = net.condV[k], id = net.condParts[k];
    if(partWrecked(s,id) || !condVacuum(id)) continue;   // an opening, or a sink in the primary: the leg's own store
    const C = condStoreC(s,id), w = condStoreW(s,id), p0 = condSatP(s,id);
    // a NaN on the diagonal silently zeroes every flow on that circuit and leaves the rest of the plant reading fine
    if(!(C > 0) || !isFinite(C) || !isFinite(w) || !isFinite(p0)) continue;
    cap[i] = C/NET_DT;
    src[i] = C/NET_DT*p0 + w;
    pin[i] = 1;
    any = true;
  }
  return any ? {cap, src, pin} : null;
}
/* WHICH nodes are fixed, never what they hold: a value only reaches b, but the SET changes the matrix */
const netFixSig = fixed => Object.keys(fixed).join(',');
// the same string, joined only when the SET moved: a per-node mask compare is exact and does not allocate
function netFixSetSig(net, fixed){
  const n = net.n, m = net.fixMaskNow || (net.fixMaskNow = new Uint8Array(n));
  let same = !!net.fixMask;
  for(let i=0;i<n;i++){ const b = fixed[i] === undefined ? 0 : 1;
    m[i] = b; if(same && net.fixMask[i] !== b) same = false; }
  if(same) return net.fixMaskSig;
  net.fixMask = m.slice(); net.fixMaskSig = netFixSig(fixed);
  return net.fixMaskSig;
}

/* every conductance the edge list evaluates against S, as one string; a stale factorisation is a silent wrong answer, so it is checked every call */
// the STRUCTURAL list the signature walks, once per net: which tanks have a node
const netSigLists = net => net.sigLists || (net.sigLists = {
  tanks: tankIds().filter(id => net.tankNode[id] !== undefined) });
function netLiveSig(net, s){
  // netSolve() reads s and never writes it, so inside one solve the string is built once (net.sigLock)
  if(net.sigLock === s && net.sigLockV !== null) return net.sigLockV;
  const v = netLiveSigOf(net, s);
  if(net.sigLock === s) net.sigLockV = v;
  return v;
}
function netLiveSigOf(net, s){
  const L = netSigLists(net);
  let tk = '';
  for(let i=0;i<L.tanks.length;i++) tk += tankLive(s, L.tanks[i]) ? '1' : '0';
  /* concatenated, never mapped-and-joined: this string is rebuilt on every netPieces() memo check */
  let fit = '';
  for(let i=0;i<net.fitIds.length;i++){ const fid = net.fitIds[i];
    if(i) fit += '|';
    /* a throttle's position is continuous, so the exact value enters: ANY change busts the cache, not just crossing open/shut */
    fit += net.fitMode[fid]==="relief" ? (reliefLive(s,fid) ? '1' : '0')
                                       : String(s.valve && s.valve[fid]);   // throttle
  }
  let dmg = '';
  if(s.dmgParts) for(let i=0;i<s.dmgParts.length;i++){ if(i) dmg += ','; dmg += s.dmgParts[i]; }
  let shut = '';
  if(s.portShut) for(const k in s.portShut) if(s.portShut[k]){ if(shut) shut += ','; shut += k; }
  let cor = '';
  for(const id of coreIds()){ const cs = coreState(s,id)||s;
    // a tube core's torn channels and cavity relief are two more edges that appear the same way
    if(cs.breach) cor += 'B';
    if(cs.tubesOpen > 0) cor += 'T';
    if(cs.cavRelief) cor += 'R'; }
  return fit
  /* the WHOLE damage list, not the severed cells alone: a wrecked machine's internal path is gone, so any id can change A */
  + '|' + dmg
  /* only the SHUT ports are named, so a plant nobody has isolated adds an empty field and keeps its key */
  + '|' + shut
  /* a ruptured vessel opens a break edge the same way a severed run does, and unlike one it is not in s.dmgParts */
  + '|' + cor
  /* one bit per tank, off the same tankLive() the edge is built from; a tank with no node adds none */
  + '|' + tk
  /* a HASH, never n characters of join: this signature is rebuilt on every netPieces() memo check */
  + '|' + netDrySig(net, s) + '|' + netDiodeSig(net, s)
  /* the three flags that can zero the governor, never turbCOf() itself: that gate reaches holdLive() -> netFixed() -> netRef() -> netPieces() -> here */
  + '|' + (s.turbTrip?'T':'') + (s.condLost?'C':'') + (s.load>0?'L':'');
}

/* reverse Cuthill-McKee over the STRUCTURAL edge list, so the band is a property of the drawing and one ordering is right for any gate state; ties on node index, so a re-factor lands on the same one */
function netOrder(net, fixed){
  const n = net.n, pos = new Int32Array(n).fill(-1), free = [];
  for(let i=0;i<n;i++) if(fixed[i]===undefined){ pos[i]=free.length; free.push(i); }
  const nf = free.length, adj = Array.from({length:nf}, () => []);
  for(let e=0;e<net.edges.length;e++){ const ed=net.edges[e], a=pos[ed.u], b=pos[ed.v];
    if(a<0 || b<0 || a===b) continue; adj[a].push(b); adj[b].push(a); }
  const byDeg = (p,q) => adj[p].length-adj[q].length || p-q;
  const seen = new Uint8Array(nf), order = [];
  for(;;){
    let s = -1;
    for(let a=0;a<nf;a++) if(!seen[a] && (s<0 || byDeg(a,s)<0)) s = a;
    if(s<0) break;
    seen[s] = 1;
    const q = [s];
    for(let h=0; h<q.length; h++){
      const x = q[h]; order.push(x);
      const nb = adj[x].filter(y => !seen[y]).sort(byDeg);
      for(const y of nb){ seen[y]=1; q.push(y); }
    }
  }
  order.reverse();
  return order.map(a => free[a]);
}
/* bOut/touchOut ride along with the assembly and `net.AfB` says whether they were filled, so netSolve() assembles twice only when the factors were reused */
function netFactored(net, s, fixed, bOut, touchOut){
  net.AfB = false;
  const fsig = netFixSetSig(net, fixed);
  /* the topology half, kept apart from the field's generation: net.AfTopo is what netDiverge() keys on */
  const topo = netLiveSig(net, s)
  // the head is inside every pump edge's linearisation (flowG: g = w/|dp+h|), so pumps-off is a different matrix
  + '|N' + (s.flowScale===undefined ? 1 : s.flowScale)
  /* the fixed SET is a live input to A: a break puts a second known pressure into the matrix, not just into b */
  + '|' + fsig;
  const sig = 'F' + (net.F.gen||0) + '|' + topo;
  net.AfTopo = topo;
  if(!net.Af || net.AfSig !== sig){
    /* a fixed node is not in the matrix at all: its value reaches the system through its free neighbours' b and nowhere else, so compacting to the free rows is exact */
    // the order is a fact about the topology and the fixed SET
    if(net.orderSig !== fsig){ net.orderFree = netOrder(net, fixed); net.orderSig = fsig;
      net.Affree = Int32Array.from(net.orderFree); }
    const free = net.orderFree;
    /* per-net scratch: this block runs on EVERY tick, and a fresh nf x nf matrix each time was the largest thing the collector saw */
    const nf = free.length, row = scratch(net, "Afrow", net.n, Int32Array, 0);
    for(let a=0;a<nf;a++) row[free[a]] = a;
    let bw = 0;
    for(let e=0;e<net.edges.length;e++){ const ed=net.edges[e];
      if(fixed[ed.u]!==undefined || fixed[ed.v]!==undefined) continue;
      const d = Math.abs(row[ed.u]-row[ed.v]); if(d>bw) bw=d; }
    net.Afrow = row; net.Afn = nf; net.Afbw = bw;
    const degC = scratch(net, "AfdegC", nf, Uint8Array, 0);
    net.Af = netFactor(
      netAssemble(net.edges, net.n, fixed, s, scratch(net, "AfA", nf*nf, Float64Array, 0),
                  bOut || null,
                  bOut ? (net.store && net.store.src) : null, row, nf, touchOut || null,
                  net.store && net.store.cap).A, nf, degC, bw);
    net.AfB = !!bOut;
    /* scattered back to node index, because every reader of it is; a fixed node stays 0 */
    const deg = scratch(net, "Afdeg", net.n, Uint8Array, 0);
    for(let a=0;a<nf;a++) deg[free[a]] = degC[a];
    net.Afdeg = deg;
    net.AfSig = sig;
  }
  return net.Af;
}
/* gather, substitute, scatter, so nothing downstream has to know the matrix is smaller than the network; a fixed node lands at 0 */
function netSubstFree(net, x){
  const free = net.Affree, nf = net.Afn, c = scratch(net, "Afc", nf, Float64Array, 0);
  for(let a=0;a<nf;a++) c[a] = x[free[a]];
  netSubst(net.Af, c, nf, net.Afbw);
  x.fill(0);
  for(let a=0;a<nf;a++) x[free[a]] = c[a];
  return x;
}

/* a FREE node's incident flows sum to zero by construction, so a residue is an assembly bug; a fixed node's imbalance IS the boundary flow and is not asked about. A dev invariant: it warns, and only when the TOPOLOGY moves */
const DIV_KG = 1e-6;      // kg/s - a milligram a second, below anything real
let divSig = null;
function netDiverge(net, q, fixed, store, b){
  if(net.AfTopo === divSig) return;
  divSig = net.AfTopo;
  const d = new Float64Array(net.n);
  let qmax = 0;
  for(let e=0;e<net.edges.length;e++){ const ed=net.edges[e], f=q[e];
    d[ed.u] -= f; d[ed.v] += f;
    const a=Math.abs(f); if(a>qmax) qmax=a; }
  const acc = new Float64Array(net.n);
  if(store) for(let i=0;i<net.n;i++){ if(!(store.cap[i] > 0)) continue;
    acc[i] = store.cap[i]*b[i] - store.src[i];
    const a=Math.abs(acc[i]); if(a>qmax) qmax=a; }
  if(!(qmax>0)) return;
  /* a REAL floor: against 1e-6 of qmax alone, a rig with nothing flowing compares rounding to rounding */
  const tol = Math.max(1e-6*qmax, DIV_KG);
  for(let i=0;i<net.n;i++){
    if(fixed[i] !== undefined) continue;
    if(net.Afdeg && net.Afdeg[i]) continue;     // no path to ground: no answer to check
    const r = d[i] - acc[i];
    if(Math.abs(r) > tol)
      console.warn("[divergence] "+net.nodes[i]+" "+r.toExponential(2)
        +" of "+qmax.toExponential(2));
  }
}
/* the linear algebra and NOTHING else; every readout in this file is a pure function of the object it hands back, and the frame rides on it because netFixed() overwrites net.refNow on the next solve */
function netSolve(net, s){
  /* the field is refreshed here and nowhere else, so every conductance and every flow price against ONE state of the plant */
  if(netPassLive && netPassSol && netPassSolS === s && netPassSol.net === net) return netPassSol;
  net.sigLock = s; net.sigLockV = null;
  try {
  netFieldUpdate(net, s);
  const fixed = netFixed(net, s);
  const b = scratch(net, "b", net.n, Float64Array, 0);
  /* which nodes a conducting edge reached: the byP reader tells a fixed node that is PINNING something from one hanging off a shut break */
  const touch = scratch(net, "touch", net.n, Uint8Array, 0);
  netFactored(net, s, fixed, b, touch);
  if(!net.AfB)
    netAssemble(net.edges, net.n, fixed, s, false, b, net.store && net.store.src,
                null, null, touch);
  netSubstFree(net, b);
  netUnfix(b, fixed);
  const q = new Float64Array(net.edges.length);
  netFlows(net.edges, b, fixed, q, s);
  // what fricOf() reads next solve
  for(let e=0;e<net.edges.length;e++) net.edges[e].w = q[e];
  netDiverge(net, q, fixed, net.store, b);
  const sol = {net, s, b, q, fixed, touch, ref: net.refNow, store: net.store};
  if(netPassLive){ netPassSol = sol; netPassSolS = s; }
  return sol;
  } finally { net.sigLock = null; net.sigLockV = null; }
}

/* a node with no path to ground has NO pressure and is dropped rather than printed; a fixed node only PINS anything if an edge reaches it, which is what `touch` answers */
function netReadP(sol, byP){
  if(!byP) return;
  const net = sol.net, s = sol.s, b = sol.b, fixed = sol.fixed, touch = sol.touch, ref = sol.ref;
  { const deg = net.Afdeg;
    const lo = new Float64Array(ref.nPiece).fill(Infinity);
    const free = new Uint8Array(ref.nPiece).fill(1);
    const wet = new Uint8Array(ref.nPiece);
    const store = sol.store;
    for(let i=0;i<net.n;i++){ const c = ref.of[i];
      if(fixed[i]!==undefined){ if(touch[i]) free[c]=0; continue; }
      if(deg && deg[i] && !touch[i]) continue;
      if(net.F.wet[i]) wet[c] = 1;
      /* a node that stores pins its own piece: its row carries C/dt*p*, an ABSOLUTE pressure, so there is nothing to float */
      if(store && store.pin[i]) free[c] = 0;
      if(b[i] < lo[c]) lo[c] = b[i]; }
    for(let i=0;i<net.n;i++){
      if(deg && deg[i] && !touch[i] && fixed[i]===undefined){ delete byP[net.nodes[i]]; continue; }
      const c = ref.of[i];
      /* a piece nothing pins is FLOATED so its lowest node sits at the ship's pressure; a shift cancels out of every flow, and a piece with no water in it is not floated at all */
      const off = (free[c] && wet[c] && fixed[i]===undefined && isFinite(lo[c])) ? netPcont(net, s, i) - lo[c] : 0;
      byP[net.nodes[i]] = b[i] + off;
    } }
}

/* pure over a netSolve() answer: reads the field and the flows, writes only into the bags it was handed, and returns the core's own circulation */
function netReadEdges(sol, byLoop, byRun, byDrop, outs){
  const net = sol.net, s = sol.s, b = sol.b, q = sol.q, fixed = sol.fixed, ref = sol.ref;
  if(byRun) for(const k in byRun) delete byRun[k];
  /* the scale is the SPAN, highest node to lowest, not the highest alone: against the span one edge can never lose more than all of them do */
  let pmax = -Infinity, pmin = Infinity;
  const isAnchor = new Uint8Array(net.n);
  for(let c=0;c<ref.nPiece;c++) if(ref.anchor[c] >= 0) isAnchor[ref.anchor[c]] = 1;
  for(let i=0;i<net.n;i++){
    /* free nodes only: a containment node sits far below the loop open or not, and would collapse every drop this scale exists to make legible */
    if(fixed[i] !== undefined && !isAnchor[i]) continue;
    if(b[i]>pmax) pmax=b[i]; if(b[i]<pmin) pmin=b[i];
  }
  const span = pmax - pmin;
  /* a hold tank is not a source or a sink: counted here, qTankEdge would delete the surge line from the core-circulation figure */
  const tankNodes = new Set();
  for(const id in net.tankNode) if(!(D.tanks[id] && D.tanks[id].hold)) tankNodes.add(net.tankNode[id]);
  let core = 0, spill = 0, spillSec = 0; const coreBy = outs ? {} : null;
  for(let e=0;e<net.edges.length;e++){
    const ed = net.edges[e];
    /* SIGNED along the edge's own u->v order; what a run carries is the flow COMMON to both its halves - same sign, the smaller; opposing signs, zero - because both ends feeding a hole in the middle traverse nothing */
    if(byRun && ed.key && ed.meter !== false){
      let v = q[e];
      if(ed.pair !== undefined){ const w = q[ed.pair.i];
        v = (v >= 0) === (w >= 0) ? (Math.abs(w) < Math.abs(v) ? w : v) : 0; }
      byRun[ed.key] = (byRun[ed.key]||0) + v;
    }
    /* signed per TANK off the tank's OWN node, positive out: a tank whose far end is not the core has no core end for a core-relative sign to read */
    if(outs && net.tankIdByNode){
      const tu = tankNodes.has(ed.u) ? net.tankIdByNode[ed.u] : undefined,
            tv = tankNodes.has(ed.v) ? net.tankIdByNode[ed.v] : undefined;
      if(tu !== undefined || tv !== undefined){
        const by = outs.qTankBy || (outs.qTankBy = {});
        const tid3 = tu !== undefined ? tu : tv;
        const tn = tu !== undefined ? ed.u : ed.v;
        const out = tu !== undefined ? q[e] : -q[e];
           /* the same F.wet bit the transport reads, so the reading and the transport cannot disagree about a spent tank */
        by[tid3] = (by[tid3]||0)
                 + ((out > 0 && net.F.wet && !net.F.wet[tn]) ? 0 : out);
      }
    }
    /* signed out of the shell; negative is steam ARRIVING from a hotter machine down a shared header, which is why a header equalises */
    if(outs && net.secTById && ed.shellOf === undefined && ed.kind !== "sgtr"){
      const su = net.secTById[ed.u], sv = net.secTById[ed.v];
      if(su !== undefined || sv !== undefined){
        const by = outs.sgSteamOutBy || (outs.sgSteamOutBy = {});
        const sid = su !== undefined ? su : sv;
        by[sid] = (by[sid]||0) + (su !== undefined ? q[e] : -q[e]);
      }
    }
    /* one edge, two gates: turbCOf() is governor plus bypass, turbWorkFrac() the share that is the wheels. Inlet pressure weighted by what went through */
    if(outs && ed.work){
      const fr = turbWorkFrac(s, ed.machine);
      if(fr > 0){ const w = q[e]*fr;
        outs.turbWk = (outs.turbWk||0) + w;
        outs.turbWkP = (outs.turbWkP||0) + b[ed.u]*Math.abs(w);
        outs.turbWkA = (outs.turbWkA||0) + Math.abs(w); }
    }
    // SUMMED: a run is two half edges and what it spends is both of them
    if(byDrop && ed.key) byDrop[ed.key] = (byDrop[ed.key]||0) + (span>0 ? Math.abs(b[ed.u]-b[ed.v])/span : 0);
    if(ed.kind === "break"){ // LABEL: synthetic edge kind this function invents
      /* spilt is what LEFT and only what left: every break edge is u = the plant, v = containment, so positive is out. A steam-side hole is charged at its shell instead */
      if(!ed.steam){ if(ed.sec) spillSec += Math.max(q[e],0); else spill += Math.max(q[e],0); }
      /* per OPENING, because an effect has to be drawn where its own hole is */
      if(outs){ (outs.by || (outs.by = {}));
                outs.by[ed.key] = (outs.by[ed.key]||0) + Math.max(q[e],0); }
    }
    /* off the shell EDGE and not any pipe, so however many lines feed it all arrive here and sum; positive is into the shell */
    if(outs && ed.shellOf !== undefined){
      (outs.sgFeedBy || (outs.sgFeedBy = {}));
      outs.sgFeedBy[ed.shellOf] = (outs.sgFeedBy[ed.shellOf]||0) + q[e];
    }
    /* signed: primary into secondary is positive, so it reaches zero on its own once the primary is brought down */
    if(outs && ed.kind === "sgtr"){ // LABEL: synthetic edge kind this function invents
      outs.qSgtr = (outs.qSgtr||0) + q[e];
      /* per GENERATOR: the jet belongs on the machine whose tubes went, not on every machine in the row */
      (outs.sgtrBy || (outs.sgtrBy = {}));
      outs.sgtrBy[ed.key] = (outs.sgtrBy[ed.key]||0) + q[e];
    }
    /* carried on the edge itself, never matched against a run's kind string; this IS the vent */
    if(outs && ed.fit && net.fitMode[ed.fit]==="relief"){
      const fid = ed.fit;
      (outs.reliefBy || (outs.reliefBy = {}));
      outs.reliefBy[fid] = (outs.reliefBy[fid]||0) + Math.abs(q[e]);
    }
    /* by NODE INCIDENCE AND SIGN ALONE, never a kind: a leg carrying water away is a negative contribution and drops out on its own, and KIND_TEMP is a buoyancy tag - read here it deleted the one edge feeding a core whose cold leg had an exchanger spliced into it. A tank edge is a DIFFERENT flow with its own figure. */
    const qTankEdge = tankNodes.has(ed.u) || tankNodes.has(ed.v);
    // EVERY core on the board is a hub
    const inU = net.coreSet.has(ed.u), inV = net.coreSet.has(ed.v);
    if(!qTankEdge && (inU || inV)){
      const qin = inV ? q[e] : -q[e];
      if(qin > 0){
        core += qin; if(coreBy){ const cid = net.coreOfNode[inV ? ed.v : ed.u]; if(cid) coreBy[cid] = (coreBy[cid]||0) + qin; }
        if(byLoop){ const i = loopOfKey(ed.key); if(i!=null) byLoop[i] = (byLoop[i]||0) + qin; }
      }
    }
  }
  if(outs){ outs.spill = spill; outs.spillSec = spillSec; outs.coreKgBy = coreBy; }
  return core;
}

// no damage, every fitting as commissioned; the throttle default must be the SAME predicate resetPlant() uses, or the reference is a plant nobody commissioned
// taken on the net just built, not P.net, because commission() calls this before P.net is necessarily assigned
const netCoreFrac0 = (net, byLoop, byRun, over, outs) => {
  /* the reference state, STATED rather than inherited, and ISOTHERMAL so buoyancy in it is exactly zero: a geometric figure that prices the piping and the pumps */
  const s = Object.assign({dmgParts:[], valve:{}, flow:1, Tavg:P.Tref,
                           coreDT:0, P:P.P0, pCore:P.P0}, over);
  for(const fid of net.fitIds) if(net.fitMode[fid]==="throttle")
    s.valve[fid] = fitTies(fid) ? 0 : 1;
  /* a standby train is STOPPED, off the same pumpDem0() resetPlant() seeds s.flowBy from; refOpen is the wide-open pass and wants every train turning */
  if(!s.refOpen && !s.flowBy)
    s.flowBy = Object.fromEntries(pumpIds().map(id => [id, pumpDem0(id)]));
  /* relinearised until the field stops moving: the law is a root, so one pass about a flat field is not the answer. Each pass feeds its own field back and the net keeps the last converged one */
  const was = netStoreHeld; netHoldStore(true);
  try { s.pBy = net.refPBy;
        /* converged means every EDGE has stopped, not the total: a circuit that is not the core's would be left wherever the pass count fell */
        let sol, prev = null, pass = 0;
        for(; pass<REF_PASSES; pass++){
          sol = netSolve(net, s);
          const pf = {}; netReadP(sol, pf); s.pBy = pf;
          const q = sol.q; let scale = 0, move = 0;
          for(let e=0;e<q.length;e++) scale = Math.max(scale, Math.abs(q[e]));
          if(prev !== null) for(let e=0;e<q.length;e++) move = Math.max(move, Math.abs(q[e]-prev[e]));
          if(prev !== null && move <= REF_TOL*Math.max(scale, 1e-9)) break;
          prev = prev ? prev.set(q) || prev : Float64Array.from(q);
        }
        net.refPasses = pass+1;
        net.refPBy = s.pBy;
        // the solved edge flows themselves: a machine's internal path has no run key, so byRun cannot say what a NODE passes
        if(outs) outs.edgeKg = sol.q;
        return netReadEdges(sol, byLoop, byRun, null, outs); }
  finally { netHoldStore(was); }
};
const REF_PASSES = 20, REF_TOL = 1e-4;

/* head lost across every edge, as a fraction of the span; derived, never on S */
function netDrops(s){
  const o = {};
  if(P && P.net) netReadEdges(netSolve(P.net, s), null, null, o, null);
  return o;
}

/* one solve, three answers: a renderer wants all of them in the same frame and they come off the same substitution */
function netField(s, byDrop, byP, byRun){
  if(!(P && P.net)) return;
  const sol = netSolve(P.net, s);
  netReadP(sol, byP);
  netReadEdges(sol, null, byRun, byDrop, null);
}

/* % of loop inventory per second: the one place a flow becomes a percentage. 0, not 0/0, for a plant with no circuit at all */
const invRate = q => { const kg = loopKg(); return kg > 0 ? 100*q/kg : 0; };
/* 1/K, the volumetric expansion of pressurised water near 300 C; PHYSICAL, not fitted */
const BETA_W = 0.0025;

/* MPa per node, resolved fresh and never on S; the tick does NOT call this - step() takes its field off netFlowK()'s own solve */
function netPressures(s){
  const o = {};
  if(P && P.net) netReadP(netSolve(P.net, s), o);
  return o;
}

/* the thermosiphon, MEASURED: its own solve on its own field, because the head is inside every pump edge's conductance. Held between takes - it feeds a bar and a trend, nothing closed-loop */
const NAT_PASSES = 8, NAT_TOL = 1e-3, NAT_EVERY = 25;
function netNatCirc(net, s, natLoop){
  if(net.natLoop && ((net.natTick = (net.natTick||0)+1) % NAT_EVERY)){
    Object.assign(natLoop, net.natLoop); return; }
  const sNat = Object.create(s); sNat.flowScale = 0; sNat.pBy = net.natPBy || s.pBy;
  const w = net.edges.map(ed => ed.w);
  const was = netStoreHeld; netHoldStore(true);
  try {
    let sol, ans = 0, prev = null;
    for(let pass=0; pass<NAT_PASSES; pass++){
      sol = netSolve(net, sNat);
      const pf = {}; netReadP(sol, pf); sNat.pBy = pf;
      ans = netReadEdges(sol, null, null, null, null);
      if(prev !== null && Math.abs(ans-prev) <= NAT_TOL*Math.max(Math.abs(ans), 1e-9)) break;
      prev = ans; }
    net.natPBy = sNat.pBy;
    netReadEdges(sol, natLoop, null, null, null);
    net.natLoop = Object.assign({}, natLoop);
  } finally { netHoldStore(was);
    for(let e=0;e<net.edges.length;e++) net.edges[e].w = w[e];
    netFieldUpdate(net, s); }
}
/* nothing is clamped: a pump develops its own stated head, so the solve is already the answer. The one NaN/negative guard lives here, on the single scalar every caller consumes, never inside the solver */
function netFlowK(s, byRun, byP, outs){
  const n = P.loops, byLoop = {}, natLoop = {};
  { const sol = netSolve(P.net, s); netReadP(sol, byP); netReadEdges(sol, byLoop, byRun, null, outs);
    /* the solved edge flows, signed along each edge's own u->v: the set the momentum law answered in, where byRun is only a label */
    if(outs) outs.edgeKg = sol.q; }
  if(!(outs && outs.noNat)) netNatCirc(P.net, s, natLoop);
  let total = 0, natTot = 0;
  for(let i=0;i<n;i++){ total += byLoop[i]||0; natTot += natLoop[i]||0; }
  if(outs){ const nk = natTot/P.netRef; outs.nat = isFinite(nk) && nk>=0 ? nk : 0;
    /* per-loop flow: heat leaves the primary at each generator in proportion to what goes through that generator's own loop */
    outs.byLoop = byLoop; }
  const k = total/P.netRef;
  return isFinite(k) && k>=0 ? k : 0;
}

// freeAdj() per crossed cell and unioned, minus the run's own cells: standing "on" a leak is not standing "beside" it
function pipeStandCells(cells){
  const g=occupied(null,{pipes:false}), on={}, seen={}, out=[];
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
  const kind = r.k.toUpperCase()+" LEG"; // LABEL: display name only
  return kind + (loop!=null ? " "+(loop+1) : "");
}
/* a crossing belongs to two runs, so this is a list */
const pipeCellRuns = (x,y) => pipeMap().cellOwner[x+","+y] || [];

// the pseudo-part combatHit()/repairStart() consume in place of a LAY.parts entry; one cell, so a longer run is simply more targets
function pipeCellPart(x,y){
  if(!D.pipes[x+","+y]) return null;
  const cells=[[x,y]], stand=pipeStandCells(cells);
  const keys=pipeCellRuns(x,y);
  const nm = keys.length ? pipeName({key:keys[0], k:keys[0].split(":")[0]}) : "PIPE";
  return {id:"pipe:"+x+","+y, name:nm, w:1, h:1,
          access: stand.length>0, cells, stand, isRun:true};
}

/* the same pseudo-part shape a pipe cell takes; wrecked means a HOLE at that cell and no orders either */
function portCellPart(pid){
  const c = (typeof portCell === "function") ? portCell(pid) : null;
  if(!c) return null;
  const cells=[c], stand=pipeStandCells(cells);
  return {id:"port:"+pid, name:portLabel(pid), w:1, h:1,
          access: stand.length>0, cells, stand, isRun:true, isPort:true};
}
const portIds = () => Object.keys(D.ports);
/* anything s.dmgParts can hold, resolved to the one shape the repair path reads; a pipe cell is not in LAY.parts */
function dmgPart(id){
  if(typeof id !== "string") return partOf(id) || null;
  if(id.indexOf("port:")===0) return portCellPart(id.slice(5));
  if(id.indexOf("mat:")===0){ const k=id.slice(4), j=k.indexOf(",");
    return j<0 ? null : matCellPart(+k.slice(0,j), +k.slice(j+1)); }
  if(id.indexOf("pipe:")!==0) return partOf(id) || null;
  const k=id.slice(5), i=k.indexOf(",");
  return i<0 ? null : pipeCellPart(+k.slice(0,i), +k.slice(i+1));
}
/* NOT portDead() (layout.js): that one is the set of nodes a SHUT valve kills */
const portWrecked = (s,pid) => partWrecked(s, "port:"+pid);

// the same two rates combatHit() weighs a component's hull cells by
const HITW_BASE=0.15, HITW_HULL=1.6;

// a component pays HITW_BASE once per PART; a pipe pays it once per CELL
function runWgt(cells){
  let w=0;
  for(const [x,y] of cells)
    w += HITW_BASE + (x===0||x===GW-1||y===0||y===GH-1 ? HITW_HULL : 0);
  return w;
}
function pipeCellIds(){
  const out=[]; for(const k in D.pipes) out.push("pipe:"+k); return out;
}

/* every line here goes through an authoring call a player has; IDEMPOTENT, so calling it twice gives one plant and not two. Kinds are never passed - runKindFor() names every stock run off the pair of ROLES, and a missing one is a missing RUN_KIND row */
function seedPort(partId,dx,dy){
  const pid=addPortAt(partId,dx,dy);
  if(pid==null) console.warn("stock port refused",partId,dx,dy);
  return pid;
}
function seedRun(pa,pb,vias){
  if(pa==null||pb==null) return null;
  const ca=portCell(pa), cb=portCell(pb);
  if(!ca||!cb) return null;
  /* the same object the bench places: `vias` are the corners a hand would have dragged, and a run that could not be laid SAYS so */
  const rid=mintRun(ca,cb,vias);
  const err=runLay(rid);
  if(err) console.warn("stock run refused",
    (D.ports[pa]||{}).p+"@"+ca, "->", (D.ports[pb]||{}).p+"@"+cb, err);
  return rid;
}
/* `n` cells of face, nozzle `i`, `step` apart, walked out from the MIDDLE; the along-face index only - which face is still a hydraulic decision */
const faceMid = (n, i, step) => { const k = step || 1;
  return Math.floor((n-1)/2) + (i%2 ? -k*Math.ceil(i/2) : k*Math.ceil(i/2)); };
function buildStockPlumbing(opt){
  const loops = (opt && opt.loops) || 1;
  /* `inter` splices an intermediate exchanger into every loop and builds the circuit behind it: six boxes to a loop, so the wider pitch */
  const inter = !!(opt && opt.inter);
  const PITCH = inter ? 18 : 7;
  // the engine room stands that much further aft: the feed pump and the reserve stand between it and the last loop
  const INTER_AFT = inter ? 12 : 0;
  /* a UNIT is a reactor and its loops; a SET is a turbine, condenser and feed pump. Both default to 1, where every offset below is 0 and every id keeps its bare name */
  const units = (opt && opt.units) || 1;
  const sets  = (opt && opt.sets)  || 1;
  const perSet = Math.max(1, Math.ceil(units/sets));
  const setOf  = u => Math.min(sets-1, Math.floor(u/perSet));
  // the last set takes the remainder, so a set's own count is counted
  const setUnits = s => { let n=0; for(let u=0;u<units;u++) if(setOf(u)===s) n++; return n; };
  const multi  = units>1 || sets>1;
  const cpump  = !!(opt && opt.cpump);
  /* a unit gets its own BAND, never a column beside another: two units side by side leave no west-east lane for the main steam header */
  const BAND=40;
  /* row 0 of a band is the WALL's, and the island stands off it; every placement inside a unit is off this offset */
  const ISL=2;
  const uOX = u => 0;
  const uOY = u => u * BAND;
  const sOY = s => s * perSet * BAND;   // a set stands in the band of its first unit
  /* two columns longer than the machinery needs, and they are the CONTAINMENT's */
  if(multi){ D.gw = 62 + PITCH*(loops-1) + INTER_AFT + 12; D.gh = BAND*units; }
  else     { D.gw = 62 + PITCH*(loops-1) + INTER_AFT;      D.gh = 36; }
  /* what this ship does not carry is never PLACED, rather than placed and taken off again */
  const drop = new Set((opt && opt.drop) || []), has = id => !drop.has(id);
  for(const k   in D.pipes) delete D.pipes[k];
  for(const k   in D.mat)   delete D.mat[k];      // structure is the ship's too - a preset is the whole ship
  for(const pid in D.ports) delete D.ports[pid];
  // ...and the recipes that laid those cells, or the next ship inherits the last one's rids and bores
  for(const rid in D.runs)  delete D.runs[rid];
  for(const id  in D.tanks) delete D.tanks[id];
  for(const id  in D.fittings) delete D.fittings[id];
  /* and every machine, because a preset is the whole ship */
  for(const id  in D.machines) delete D.machines[id];
  for(const id  in D.name)     delete D.name[id];
  buildLayout();

  /* ORDER IS THE NAMING: an ordinal is read off the drawing in board order, so the coolant pumps are minted before the feed and circ pumps */
  const GHc=D.gh, BOT=GHc-4;
  /* the first of anything keeps the bare name */
  const sfx = n => n ? String(n) : "";
  /* a loop's own column, in its unit's own frame; two cells further aft on a banded ship, where the main steam header arrives from the WEST */
  const X  = i => 30+PITCH*i;
  const uX = (u,i) => X(i) + uOX(u);         // ...and on the board
  const AFT   = 48+PITCH*(loops-1) + INTER_AFT + (multi?2:0);
  const FEEDX = X(loops) + (multi?2:0);
  // the header riser's own column, forward of the engine room and aft of every loop
  const MSRX  = AFT-6;
  const turbY = s => multi ?  3+sOY(s) : 11;
  const condY = s => multi ? 13+sOY(s) : 24;
  /* the feed pump's left face IS the feedwater lane, so where it stands is which rows those lines run along */
  const feedY = s => multi ? 30+sOY(s) : GHc-5;
  // a set's condensate runs along its OWN band's floor, never the ship's
  const setKeel = s => multi ? sOY(s)+BAND-1 : GH-1;
  for(let u=0;u<units;u++){
    const U=sfx(u), ox=uOX(u), oy=uOY(u)+ISL;
    /* one row off the deckhead, and that row is what a containment needs: the drives ride the head */
    mintMachine("core"+U,"core",8+ox,13+oy,opt&&opt.core);
    for(let i=0;i<loops;i++) mintMachine("sg"+(u*loops+i),"sg",uX(u,i),5+oy);
    // on a three-circuit ship the generator's column is the intermediate pump's, so the coolant pump takes the lane between them
    for(let i=0;i<loops;i++)
      mintMachine("pump"+(u*loops+i),"pump",uX(u,i)+(inter?4:0),18+oy);
    /* the exchanger takes the generator's place in the primary and the generator moves one circuit out */
    if(inter) for(let i=0;i<loops;i++){ const li=u*loops+i;
      mintMachine("ihx"+li,"ihx",uX(u,i)+7,5+oy);
      mintMachine("ipump"+li,"pump",uX(u,i)+7,18+oy);
    }
  }
  /* the feed pump stands BELOW what it draws on: static head is real in the solve, and level with the turbine it lifts its own condensate out of a vacuum */
  for(let s=0;s<sets;s++){
    const S=sfx(s);
    mintMachine("turb"+S,"turb",AFT,turbY(s));
    mintMachine("cond"+S,"cond",AFT,condY(s));
    mintMachine("feed"+S,"pump",FEEDX,feedY(s));
    setPartName("feed"+S,"FEED PUMP");
    /* a feed pump drawing straight off a hotwell has only the column between them, and a real plant does not ask it to: the condensate pump is what lifts the water out of the vacuum so the feed pump has a suction to work against */
    if(cpump){
      /* in the aft lane the condensate already runs down, one row clear of the keel so its discharge has a cell to turn in */
      mintMachine("cpump"+S,"pump",AFT+9,setKeel(s)-pumpH("cpump"+S)-1);
      setPartName("cpump"+S,"CONDENSATE PUMP"); }
  }
  mintMachine("ctrl","ctrl",0,BOT);
  /* on the keel with more than one set: beside the turbine is the row a banded ship's condenser puts its cooling nozzle on */
  mintMachine("bkp","bkp",AFT+10, multi ? GHc-12 : 11);
  /* two panels is a STARTING DESIGN, not a count in code; anchored by the BOTTOM edge, so a panel's face stays on the skin whatever area it is given */
  const radAt=(id,x)=>{ mintMachine(id,"radiator",x,0);
    D.machines[id].cell=[x,BOT+3]; buildLayout(); };
  radAt("rad0",AFT-7); radAt("rad1",AFT);
  /* above the PANEL'S own top, never a fixed row: the joint below is two nozzles meeting across a cell boundary and needs one free row each */
  mintMachine("cwp","pump",AFT-6,BOT+1-partOf("rad0").h-pumpH("cwp"));
  setPartName("cwp","CIRC WATER PUMP");
  /* laid the way the PAINT tool lays it: a shield is not a machine, so there is nothing to mint */
  for(let X=18;X<27;X++) for(let Y=GHc-4;Y<GHc-1;Y++) matPaint(X,Y,"steel");

  // buildLayout AFTER the assign: a tank's BOX follows its `vol`, and mintTank()'s own rebuild is against the default size
  /* `drop` is tested on the BASE name: a station goes without a thing on every unit or on none */
  const tank = (base,U,x,y,cfg) => { if(!has(base)) return null;
    const id=base+U; mintTank(id,x,y); Object.assign(D.tanks[id],cfg); buildLayout(); return id; };
  const fitting = (base,U,x,y,cfg) => { if(!has(base)) return null;
    const id=base+U; mintFitting(id,x,y); Object.assign(D.fittings[id],cfg); return id; };
  // a line with one end missing is not a shorter line, it is no line
  const port = (pid,dx,dy) => pid && partOf(pid) ? seedPort(pid,dx,dy) : null;
  const run  = (a,b,...rest) => (a && b) ? seedRun(a,b,...rest) : null;

  /* everything below belongs to a REACTOR rather than to the ship */
  const UN=[];                       // one bag of ids per unit, for the runs below
  for(let u=0;u<units;u++){
  const U=sfx(u), ox=uOX(u), oy=uOY(u)+ISL;
  // the reserve's own column, off X() so it follows the loop columns rather than repeating their spacing
  const EFWX = ox + X(loops) + Math.max(3,loops) + 2 + (multi?u:0);

  tank("hpi",U,ox+1,oy+19,{ name:"HPI TANK", col:"#5aa9d6",
    tip:"Emergency injection water, and its one line into the loop. Mount it HIGH: its own column is real head, and it only injects while it is winning against the pressure in the loop.",
    vol:57, level:65, fluid:"water",
    /* a gas charge, not a charging pump: an accumulator is the one injection path a blackout does not kill. 65 % of 57 m^3 is a Westinghouse accumulator's own 34 % nitrogen space */
    gas:{p0:11.0}, check:true, auto:"manual", burst:null});
  /* one lane clear of the vessel, off its own WIDTH; set after minting, because the box does not exist until the volume is on it */
  if(D.tanks["hpi"+U]){
    D.tanks["hpi"+U].cell = [Math.max(0, partOf("core"+U).x - partOf("hpi"+U).w - 3), oy+19];
    buildLayout(); }

  /* a circuit with no vessel floats to containment pressure and reads as water; a hold tank naming a coolant is what it has instead of a reactor */
  if(inter) for(let i=0;i<loops;i++){ const li=u*loops+i;
    tank("itank",String(li),uX(u,i)+12,oy+18,{ name:"SURGE TANK "+(li+1), col:"#c8b8a0",
      tip:"The expansion tank of one intermediate circuit. It sets that circuit's pressure and states what is in it - the loop between the reactor and the boiler has no reactor of its own to ask.",
      vol:25, level:60, fluid:"water", cool:coreD("core"+U).cool,
      gas:null, check:false, auto:"always", burst:null,
      hold:{p:null}, tsurv:800, pburst:70}); }

  tank("pzr",U,ox+18,oy+1,{ name:"PRESSURIZER", col:"#a98cf0",
    tip:"Sets the pressure of the circuit it is piped to. It has to sit high - the steam bubble must stay at the top of the loop.",
    vol:50, level:54, fluid:"water",
    gas:null, check:false, auto:"always", burst:null,
    hold:{p:null}, tsurv:800, pburst:200});

  /* off the vessel's own box, never literals: a tank's footprint follows its VOLUME, and two ports may not share a cell */
  const PZR_W = partOf("pzr"+U).w, RV_X = ox+18+PZR_W+2, RELTK_X = RV_X+3;
  tank("reltk",U,RELTK_X,oy+1,{ name:"RELIEF TANK", col:"#8a6cd0",
    tip:"Catches what the relief valve vents. It fills as the valve passes flow, and a full tank is a place a repair party would rather not stand.",
    vol:35, level:0, fluid:"contaminated",
    /* at rest the gas sits at containment pressure, so an empty tank costs the relief path exactly nothing */
    gas:{p0:0.15}, check:false, auto:"always",
    burst:{at:1.4, drain:6.0, rel:0.004}});

  /* tied into the feedwater LINE, so it reaches whatever the feed pump reaches */
  tank("efw",U,EFWX,oy+17,{ name:"EFW TANK", col:"#5aa9d6",
    tip:"Independent feedwater reserve, tied into the feedwater line through its own pump. It starts on LOW GENERATOR LEVEL, not on being armed - an emergency pump feeding a healthy generator overfills it.",
    vol:19, level:65, fluid:"condensate",
    /* the gas charge is NPSH and nothing else - vented, the pump flashes its own suction; the machine beside it is what pushes */
    gas:{p0:1.5}, check:false, auto:"sglow", burst:null});
  /* beside its own tank, so the SUCTION is a few cells and the discharge carries the ship; ROLE.pump folds r onto t and l onto b */
  if(has("efw")){
    mintMachine("efwp"+U,"pump",EFWX-3,oy+10);
    setPartName("efwp"+U,"EFW PUMP");
  }

  /* a STARTING DESIGN like the tanks: nothing anywhere may ask which of these is "the surge tee" */
  const tee0 = fitting("tee0",U,ox+20,oy+14,{ name:"SURGE TEE", mode:"tee",
    tip:"The junction where the pressurizer meets the loop. A tee costs nothing and closes nothing - it is one node with four faces." });
  const rv0  = fitting("rv0",U,RV_X,oy+2,{ name:"RELIEF VALVE", mode:"relief",
    tip:"Lifts on pressure and blows the loop down through whatever is piped behind it. Pipe its outlet to a tank, or it vents straight into the room." });
  /* the SAME relief fitting the pressurizer has; what makes it a secondary valve is only where it was placed. It taps the nozzle, never the line - a valve in the line is shut off with the line */
  const svTip="The steam generator's own safety valve. It lifts on SHELL pressure and blows steam to atmosphere - the water goes with it and does not come back, so a shell held on its valve boils itself dry. Without one the shell bursts instead. It stands against the skin, so what it blows goes outside; move it inboard and the same steam lands in the engine room.";

  /* one header, one tee per generator: a line per generator cannot be drawn, because the safety valves own the rows a second steam lane needs. Two ports facing each other across a cell boundary are a joint and need no pipe */
  // in loop 0's own feed RISER, not beside the pump: the feedwater lines leave the pump's underside
  const efwtee = fitting("efwtee",U, uX(u,0)+(inter?3:5)+(multi?u:0), oy+(inter?24:12), { name:"EFW TIE", mode:"tee",
    tip:"Where the emergency reserve meets the feedwater line. A tee closes nothing: the reserve waits behind its own check valve until the line pressure falls under it." });
  const mstee=[], svf=[];
  for(let i=0;i<loops;i++){
    const li = u*loops+i;
    mstee[i]=fitting("mstee"+li,"", uX(u,i)+1, oy+2, { name:"STEAM TEE "+(li+1), mode:"tee",
      tip:"Where this generator's steam meets the main header, and where its safety valve stands." });
  }
  /* a valve blows overboard only where its open face is against the hull, so each stands aft of the wall on the skin over its own tee */
  let islX=-1e9;
  for(const id of ["core"+U,"rods"+U,"pzr"+U,"reltk"+U,"rv0"+U,"tee0"+U,"efwtee"+U]
        .concat(mstee.map(f=>f).filter(Boolean))
        .concat(Array.from({length:loops},(_,i)=>"sg"+(u*loops+i)))
        .concat(inter ? Array.from({length:loops},(_,i)=>["ihx","ipump","itank"]
          .map(k=>k+(u*loops+i))).flat() : [])){
    const q=partOf(id); if(q) islX=Math.max(islX, q.x+q.w-1); }
  const svtee=[];
  /* clear of the riser lane, where a station's own manifold stands */
  let svBase = islX+5;
  if(setUnits(setOf(u))>1 && svBase >= MSRX-2) svBase = MSRX-3;
  for(let i=0;i<loops;i++){
    const li=u*loops+i, cx=svBase+3*i;   // three, so two tees' own ports never want one cell
    svtee[i]=fitting("svtee"+li,"", cx, oy+2, { name:"SAFETY TEE "+(li+1), mode:"tee",
      tip:"Where this generator's safety valve taps the main steam header. A tee closes nothing." });
    svf[i]=fitting("sv"+li,"", cx, uOY(u)+0, { name:"SG SAFETY "+(li+1), mode:"relief", spring:true, tip:svTip });
  }
  /* a second unit meets the first in the RISER, never tee to tee: a band's top row is blocked at every steam tee by its own nozzle cells */
  const mshdr = setUnits(setOf(u))>1
    ? fitting("mshdr",U, MSRX, oy+2, { name:"STEAM HEADER "+(u+1), mode:"tee",
        tip:"Where this unit's main steam joins the header its turbine is fed from. A tee closes nothing: lose a unit and the rest of the station keeps the machine turning." })
    : null;
  UN[u] = {U, ox, oy, tee0, rv0, efwtee, mstee, svtee, svf, mshdr};
  }
  buildLayout();                     // the boxes have to be on the grid before a port can sit beside one

  /* no cell: the hotwell lives inside the condenser, and one for the SHIP - every set condenses into the same secondary inventory */
  tank("hotwell","",null,null,{ name:"HOTWELL", col:"#5aa9d6",
    tip:"Condensate returning from the condenser, and what the feed pumps draw on. A tube rupture puts primary water in here and it has to go somewhere.",
    /* half again what the generators hold: it has to take a shell's WHOLE charge back plus what a reserve pushes through it */
    vol:83, level:50, fluid:"condensate",
    gas:null, check:false, auto:"always", burst:null});

  /* order matters in one place: a run laid over an existing straight at right angles becomes a CROSS, so the line that goes through is laid first */
  /* ONE LANE PER RUN - a lane that shares a row with anything else MERGES with it; loop 3 leaves the vessel at its FLOOR, because one port cell stops a lane as dead as a machine does */
  const HOT_ROW =[14,15,16,24];      // out of the vessel, east to its own riser
  // the gap forward of the generator, or of the exchanger that stands in the primary where the generator used to
  const HOT_COL = i => X(i)+(inter?5:-4);
  /* one lane per feed line, walking UP as the loop index rises while the bilge rows walk DOWN, so their spans cannot meet */
  const FEED_ROW= (s,i) => partOf("feed"+sfx(s)).y+3-i;
  /* one riser column per unit: stacked units share their columns, so every riser would ask for the same lane */
  const feedCol = (u,i) => uX(u,i)+(inter?3:5)+(multi?u:0);
  /* one bilge row per loop, off the VESSEL's own floor, so it follows the island */
  const coldRow = (u,i) => { const c=partOf("core"+sfx(u)); return c.y+c.h+1+i; };
  const KEEL=GH-1;
  /* off the tank's own box: a footprint follows its VOLUME, so a nozzle authored at a literal lands outside it */
  const tankBox = id => { const p=partOf(id); return {w:p?p.w:1, h:p?p.h:1}; };
  for(const n of UN){
    const U=n.U;
    n.coreHot  = i => seedPort("core"+U,9,HOT_ROW[i]-13);
    // centred on the vessel's own floor, two cells apart
    n.coreCold = i => seedPort("core"+U,faceMid(9,i,2),12);
    // the cell that return lands under, off the vessel's own column
    n.coreBilge= i => partOf("core"+U).x+faceMid(9,i,2);
    n.pCoreHot = n.coreHot(0);
    /* dx 1, not the corner: the fourth cold return IS the corner, and two ports cannot share a cell */
    n.pCoreHpi = has("hpi") ? seedPort("core"+U,1,12) : null;
    const pzrB = tankBox("pzr"+U), relB = tankBox("reltk"+U), hpiB = tankBox("hpi"+U);
    n.pPzrSurge= seedPort("pzr"+U,1,pzrB.h);
    n.pPzrRel  = has("rv0") ? seedPort("pzr"+U,pzrB.w,1) : null;
    n.pTeeL    = seedPort(n.tee0,-1,0);
    n.pTeeT    = seedPort(n.tee0,0,-1);
    n.pTeeR    = seedPort(n.tee0,1,0);
    n.pRvL     = port(n.rv0,-1,0);
    n.pRvR     = port(n.rv0,1,0);
    n.pRelTk   = port("reltk"+U,-1,clamp(1,0,relB.h-1));
    n.pHpi     = port("hpi"+U,hpiB.w,clamp(2,0,hpiB.h-1));
    n.pEfw     = partOf("efw"+U)  ? seedPort("efw"+U,0,-1) : null;   // out of the top, up into the pump's suction
    n.pEfwpSuc = partOf("efwp"+U) ? seedPort("efwp"+U,3,2) : null;   // r face -> folds onto t: SUCTION
    n.pEfwpDis = partOf("efwp"+U) ? seedPort("efwp"+U,-1,2) : null;  // l face -> folds onto b: DISCHARGE
  }
  const ST=[];
  for(let s=0;s<sets;s++){ const S=sfx(s);
    // ONE steam nozzle per turbine, because a set has one main steam HEADER
    ST[s]={ S, s,
      pTurbT: seedPort("turb"+S,4,-1),
      pTurbB: seedPort("turb"+S,faceMid(9,0),7),
      pCondT: seedPort("cond"+S,faceMid(9,0),-1),
      pCondR: seedPort("cond"+S,9,faceMid(5,0)) };
  }
  for(const t of ST) t.pCondCwO = seedPort("cond"+t.S,-1,4);
  /* suction on the RIGHT face, not the top: the reserve stands over this pump's columns. ROLE.pump folds r onto t, so it is the same node */
  const pCwpR     = seedPort("cwp",partOf("cwp").w,faceMid(partOf("cwp").h,0));
  const pCwpB     = seedPort("cwp",1,partOf("cwp").h);
  /* off the panel's OWN box: a panel states an AREA and the drawing snaps to it, so a nozzle authored at a literal lands outside a small one */
  const radBox    = id => { const p=partOf(id); return {w:p?p.w:1, h:p?p.h:1}; };
  const rad0      = radBox("rad0"), rad1 = radBox("rad1");
  /* the column the PUMP is standing in, not the middle of the panel's face, because the joint below is two nozzles meeting across a cell boundary */
  const pRad0T    = seedPort("rad0",
    clamp((partOf("cwp").x+1)-partOf("rad0").x, 0, rad0.w-1), -1);
  const pRad0R    = seedPort("rad0",rad0.w,faceMid(rad0.h,0));
  const pRad1L    = seedPort("rad1",-1,faceMid(rad1.h,0));
  const pRad1R    = seedPort("rad1",rad1.w,faceMid(rad1.h,0));
  /* one column aft of the second panel, never a literal: the return comes up the panel's own right-hand column */
  for(const t of ST) t.pCondCwI = seedPort("cond"+t.S,
    clamp((partOf("rad1").x+rad1.w+1)-partOf("cond"+t.S).x, 0, partOf("cond"+t.S).w-1), 5);
  /* ROLE.pump takes suction on `t` and discharges on `b`, folding l onto b, so the condensate arrives on top and the generators are fed off the left face; one nozzle per loop the SET feeds, indexed within the set */
  for(const t of ST){
    t.feedL  = k => seedPort("feed"+t.S,-1,3-k);
    t.pFeedR = seedPort("feed"+t.S,partOf("feed"+t.S).w,4);
  }

  /* the hot nozzle sits LOW on an added loop: the cell beside the shell's top is reachable only up the column the feed line rises in. Loop 0 keeps the high nozzle, because its hot leg arrives from the surge tee */
  const sgPorts = li => ({
    l:     seedPort("sg"+li,-1,1),
    b:     seedPort("sg"+li,1,6),
    steam: seedPort("sg"+li,1,-1),
    feed:  seedPort("sg"+li,3,0),
  });
  /* the one legal overlap on the board is row 14: loop 0's hot leg stops at the surge tee, west of where any feed line begins */
  for(const n of UN){
    seedRun(n.pCoreHot, n.pTeeL);
    seedRun(n.pPzrSurge, n.pTeeT);
    run(n.pPzrRel, n.pRvL);
    run(n.pRvR, n.pRelTk);
    run(n.pHpi, n.pCoreHpi);
  }
  /* condensate: aft, down to the band's floor and forward into the feed pump's suction, so the line has no lift in it */
  for(const t of ST){
    const K = setKeel(t.s), fd = partOf("feed"+t.S);
    seedRun(t.pTurbB, t.pCondT);
    if(cpump){ const cp = partOf("cpump"+t.S);
      /* the same lane, cut in two by the pump: it takes suction on top off the drop from the hotwell and discharges down onto the keel the feed pump's suction stands on */
      seedRun(t.pCondR, seedPort("cpump"+t.S,faceMid(cp.w,0),-1));
      seedRun(seedPort("cpump"+t.S,faceMid(cp.w,0),cp.h), t.pFeedR, [[fd.x+fd.w+1,K]]);
    } else seedRun(t.pCondR, t.pFeedR, [[AFT+10,K],[fd.x+fd.w+1,K]]);
  }
  /* one cooling circuit however many condensers: a panel has to SEE THE SKIN to shed anything, so there is one bank and every condenser is in series with it */
  { const first=ST[0], last=ST[ST.length-1], cd=partOf("cond"+first.S);
    seedRun(first.pCondCwO, pCwpR, [[AFT-2,cd.y+cd.h-1]]);
    seedRun(pCwpB, pRad0T);                       // the pump stands on the first panel: a joint, no pipe
    seedRun(pRad0R, pRad1L);
    seedRun(pRad1R, last.pCondCwI);
    for(let s=0;s+1<sets;s++) seedRun(ST[s+1].pCondCwO, ST[s].pCondCwI);
  }

  /* the header is the UNIT's and the riser is the SET's; hdr[u] is the last tee laid on unit u and nothing more */
  const hdr = [];
  for(let u=0;u<units;u++){
    const n=UN[u], s=setOf(u), t=ST[s], ox=n.ox, oy=n.oy;
    n.pTieT = seedPort(n.efwtee,0,-1); n.pTieR = seedPort(n.efwtee,1,0);
    n.pTieB = seedPort(n.efwtee,0,1);
    for(let i=0;i<loops;i++){
      const li = u*loops+i;                    // this generator, on the plant
      const k  = (u%perSet)*loops+i;           // ...and its line's ordinal within its SET
      const g = sgPorts(li);
      const pumpX = partOf("pump"+li).x;
      const pT = seedPort("pump"+li,1,-1), pB = seedPort("pump"+li,1,partOf("pump"+li).h);
      const teeB = seedPort(n.mstee[i],0,1);
      const teeL = hdr[u]!=null ? seedPort(n.mstee[i],-1,0) : null;
      const teeR = seedPort(n.mstee[i],1,0);

      /* which machine the first stage IS is the whole difference between a two-circuit plant and a three-circuit one */
      const h = inter ? "ihx"+li : null, LX = uX(u,i);
      const primIn  = h ? seedPort(h,-1,1) : g.l;
      const primOut = h ? seedPort(h,3,1)  : g.b;
      const hotVia = [[HOT_COL(i)+ox,HOT_ROW[i]+oy],[HOT_COL(i)+ox,6+oy]];
      if(i)          seedRun(n.coreHot(i), primIn, hotVia);
      else if(inter) seedRun(n.pTeeR,      primIn, hotVia);
      else           seedRun(n.pTeeR,      primIn);
      /* down into the suction, never along the row it stands on: a run that TURNS in a cell can never be crossed afterwards */
      if(inter) seedRun(primOut, pT, [[LX+11,10+oy],[LX+5,10+oy]]);
      else      seedRun(primOut, pT);
      seedRun(pB, n.coreCold(i), [[pumpX+1,coldRow(u,i)],[n.coreBilge(i),coldRow(u,i)]]);
      /* the circuit behind the exchanger, one lane each; the surge tank hangs on the COLD leg */
      if(h){
        const ipB = partOf("ipump"+li);
        seedRun(seedPort(h,2,4), g.l, [[LX+9,13+oy],[LX-1,13+oy]]);
        seedRun(g.b, seedPort("ipump"+li,1,-1), [[LX+1,12+oy],[LX+8,12+oy]]);
        seedRun(seedPort("ipump"+li,1,ipB.h), seedPort(h,1,-1),
                [[LX+8,coldRow(u,i)],[LX+15,coldRow(u,i)],[LX+15,3+oy]]);
        // a JOINT: the tank's own nozzle faces the pump's suction across one cell
        if(partOf("itank"+li))
          seedRun(seedPort("itank"+li,-1,1), seedPort("ipump"+li,3,1));
      }
      // the nozzle faces the tee's own port across one cell: a joint, no pipe
      seedRun(g.steam, teeB);
      if(hdr[u]) seedRun(hdr[u], teeL);         // ...and the header, tee to tee
      hdr[u] = teeR;
      /* down, west, up; the FIRST loop of a unit carries that unit's reserve tie, so it is two runs through the tie rather than one straight through it */
      /* a unit in another band is fed under the pump and down the aft lane, landing BELOW its own tie, which is the face that tie is fed on */
      const land = partOf(n.efwtee).y+4;
      const bandVias = oy-ISL===sOY(s) ? null
        : [[FEEDX-3, FEED_ROW(s,k)], [FEEDX-3, land], [feedCol(u,i), land]];
      /* the riser stops one row UNDER the nozzle: a waypoint on the port cell asks the run to pass through its own end */
      const FTOP = (inter?7:5)+oy;
      if(i) seedRun(t.feedL(k), g.feed,
        (bandVias||[]).concat([[feedCol(u,i),bandVias?land:FEED_ROW(s,k)],[feedCol(u,i),FTOP]]));
      else { seedRun(t.feedL(k), n.pTieB,
               bandVias || [[feedCol(u,0),FEED_ROW(s,k)]]);
             seedRun(n.pTieT, g.feed, [[feedCol(u,0),FTOP]]); }
    }
    /* the header goes on aft through its safety tees, one per generator, each with its own riser to a valve on the skin */
    for(let i=0;i<loops;i++){
      const st = n.svtee && n.svtee[i]; if(!st) continue;
      if(hdr[u]) seedRun(hdr[u], seedPort(st,-1,0));
      hdr[u] = seedPort(st,1,0);
      seedRun(seedPort(st,0,-1), seedPort(n.svf[i],0,1));
    }
  }
  /* a set with one unit has no riser at all and its header goes straight aft */
  for(let u=0;u<units;u++) if(UN[u].mshdr && hdr[u])
    seedRun(hdr[u], seedPort(UN[u].mshdr,-1,0));
  for(let u=0;u+1<units;u++) if(UN[u].mshdr && UN[u+1].mshdr && setOf(u)===setOf(u+1))
    seedRun(seedPort(UN[u].mshdr,0,1), seedPort(UN[u+1].mshdr,0,-1));
  for(let s=0;s<sets;s++){
    const u0 = UN.findIndex((n,u)=>setOf(u)===s);
    if(u0<0) continue;
    const top = UN[u0].mshdr ? seedPort(UN[u0].mshdr,1,0) : hdr[u0];
    if(!top) continue;
    /* on the HULL row, never the header's own: a banded set's header row IS the steam nozzle's own cell */
    if(multi) seedRun(top, ST[s].pTurbT);
    else      seedRun(top, ST[s].pTurbT, [[AFT+4, 2+ISL+sOY(s)]]);
  }
  for(const n of UN){
    run(n.pEfw, n.pEfwpSuc);
    run(n.pEfwpDis, n.pTieR);           // a JOINT: the two nozzles face each other, zero pipe
  }
  buildLayout();

  /* LAST of everything, because paint is refused a cell a machine, a tank or a nozzle stands in; a pipe cell it may have, and that run is a PENETRATION. The ring is the island's own bounding box plus two: one cell of air, then the wall */
  if(opt && opt.cont){
    for(let u=0;u<units;u++){
      const U=sfx(u), ids=["core"+U,"rods"+U,"pzr"+U,"reltk"+U,"rv0"+U,"tee0"+U,"efwtee"+U];
      for(let i=0;i<loops;i++){ const li=u*loops+i;
        ids.push("sg"+li,"pump"+li,"mstee"+li); }   // the safety valves stand outside, on the skin
      let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
      for(const id of ids){ const p=partOf(id); if(!p) continue;
        x0=Math.min(x0,p.x); x1=Math.max(x1,p.x+p.w-1);
        y0=Math.min(y0,p.y); y1=Math.max(y1,p.y+p.h-1); }
      if(x1<x0) continue;
      /* the pipe between two contained machines is inside too: a penetration is what a run to a machine OUTSIDE costs, and a hot leg is not one */
      const inSet=new Set(ids);
      let px0=x0,px1=x1,py0=y0,py1=y1;
      for(const pid in D.ports){ if(!inSet.has(D.ports[pid].p)) continue;
        const c=portCell(pid); if(!c) continue;
        px0=Math.min(px0,c[0]); px1=Math.max(px1,c[0]);
        py0=Math.min(py0,c[1]); py1=Math.max(py1,c[1]); }
      for(const c of pipeMap().conns){
        if(!inSet.has(c.a)||!inSet.has(c.b)) continue;
        for(const [cx,cy] of c.cells){
          px0=Math.min(px0,cx); px1=Math.max(px1,cx);
          py0=Math.min(py0,cy); py1=Math.max(py1,cy); }
      }
      /* paint is refused an occupied cell, so a ring crossing a box or a nozzle has a HOLE in it: each edge walks outward one cell at a time, only while the ring stays closed */
      const occ=occupied([],{pipes:false, mat:false});
      const ringOpen=(a0,b0,a1,b1)=>{
        for(let x=a0;x<=a1;x++) if(occ[b0][x]||occ[b1][x]) return true;
        for(let y=b0;y<=b1;y++) if(occ[y][a0]||occ[y][a1]) return true;
        return false; };
      x0=Math.max(0,x0-2); y0=Math.max(0,y0-2);
      x1=Math.min(GW-1,x1+2); y1=Math.min(GH-1,y1+2);
      const want=[Math.max(0,px0-2), Math.max(0,py0-2),
                  Math.min(GW-1,px1+2), Math.min(GH-1,py1+2)];
      /* the deck before the beam, and this ORDER is why it works: an edge that spends its travel going aft can no longer reach the bilge rows the cold legs run along */
      for(;y0>want[1] && !ringOpen(x0,y0-1,x1,y1); y0--);
      for(;y1<want[3] && !ringOpen(x0,y0,x1,y1+1); y1++);
      for(;x0>want[0] && !ringOpen(x0-1,y0,x1,y1); x0--);
      for(;x1<want[2] && !ringOpen(x0,y0,x1+1,y1); x1++);
      for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++){
        if(x!==x0 && x!==x1 && y!==y0 && y!==y1) continue;
        matPaint(x,y,opt.cont.m);
        if(opt.cont.t !== undefined && D.mat[x+","+y]) D.mat[x+","+y].t = opt.cont.t;
      }
    }
  }

  buildLayout();
}
/* no call here: a blank grid is where a new plant starts, and the stock ship is the first PLANTPRE row */

/* every field below is a plain D write or a call the bench has, so a preset cannot describe a plant the player could not have built. `lat` is only ever given to a family that lays no moderator blocks - latPreset() does not call latLayMod() */
const PLANTPRE=[
 ["STOCK PWR",{loops:1,arch:0,cpump:true,cont:{m:"liner"},d:{bkp:1,sg:0,chim:0.3}},
  "The reference ship: one pressurised water loop, a pressurizer with a relief valve behind it, injection water, an emergency feedwater tie, a turbine, a condenser and two panels. Everything the other presets add or take away is measured against this."],
 ["NUSCALE",{loops:1,arch:0,lat:1,cpump:true,cont:{m:"liner"},d:{bkp:1,sg:0,chim:0.5}},
  "A small compact PWR module: one loop, a tall tight core, a suppression pool and a battery. Light, cheap and slow to bite. The real module circulates by itself and has no pump at all; this one keeps its RCP."],
 ["BWR/4",{loops:2,arch:1,cont:{m:"liner",t:20},d:{bkp:1,sg:0,chim:0.4}},
  "Two recirculation loops boiling at 7 MPa - the Fukushima Daiichi machine. Power follows flow instantly and margin to dryout is thin, so it will not forgive a flow transient the way a pressurised plant does."],
 ["BN-600",{loops:3,arch:3,cpump:true,cont:{m:"liner"},d:{bkp:2,sg:1,chim:0.4},
   place:[["pan0","pan",27,31],["pan1","pan",36,31],["inert0","inert",32,25]]},
  "Three primary sodium loops at atmospheric pressure, once-through steam generators, diesels and a large dry containment. Enormous boiling margin and a prompt lifetime forty times shorter than water - it answers a rod before you have finished moving it. It ships the cell defences a real sodium plant is built with: catch pans under the loops, so a leak runs into a drain instead of over the deck, and a nitrogen set to smother a fire the pans do not catch. The real machine has three circuits, not two: the shells sit at seventeen megapascals against a primary at atmospheric, so a tube leak drives WATER INTO SODIUM, and a real BN-600 puts an intermediate sodium loop between that reaction and the fuel. Nitrogen does nothing about that one. Splice heat exchangers in on the bench to build the machine it actually is."],
 ["EPR",{loops:4,arch:0,lat:2,cpump:true,cont:{m:"lined"},d:{bkp:2,sg:0,chim:0.3},
   place:[["catcher","catcher",8,30]]},
  "Four loops round a wide squat core, large dry containment, diesels and a core catcher. The heavy one, and the one with margin everywhere: low peaking, high DNBR, minutes of generator water after feedwater is lost."],
 ["RBMK-1000",{loops:2,arch:2,cpump:true,d:{bkp:1,sg:1,chim:0.3}},
  "Two coolant loops through a graphite pile, gravity scram and no containment - because the real one had none that would hold. Boiling the water ADDS reactivity here, so the plant hunts itself and the slow rods arrive late."],
 ["MSRE",{loops:1,arch:4,cont:{m:"lined"},d:{bkp:1,sg:1,chim:0.6}},
  "Molten salt through a graphite matrix at no pressure at all, one loop, once-through boiler. Almost no xenon pit and hours of grace; what it will do instead is freeze solid if you let it get cold."],
 ["WINDSCALE",{loops:1,arch:5,cpump:true,d:{bkp:0,sg:1,chim:0.2},
   drop:["hpi","rv0","reltk"], tanks:{efw:{vol:5},
     pzr:{name:"HELIUM STORE", hold:null, gas:{p0:7.0}, level:50, fluid:"helium", tsurv:null, pburst:null}}},
  "A graphite pile with no containment, no backup power, no injection water and no relief valve on the loop. It runs perfectly well and every single fault is uncovered - lose the bus and the pumps stop, overpressure the loop and nothing lifts, and there is nothing to inject with at all. Fly it to see what the safeguards on every other preset are FOR."],
 /* no containment, and it is the hull that refuses it: on every band below the top one the drives stand in the row a wall would close along */
 ["DUAL",{units:2,sets:1,loops:1,arch:0,lat:1,d:{bkp:1,sg:0,chim:0.3}},
  "Two small identical pressurised units on one hull, one loop each, both feeding a single turbine, and NO containment on either - stacked this tight, the lower unit's rod drives stand in the row a wall would have to close along, so neither unit gets one. Nothing here is exotic: it is the STOCK PWR twice over, sharing one engine room and one circulating water system the way a real multi-unit station shares its cooling. Fly it to see what a second reactor costs to run - and trip a unit to lose half the steam into a turbine that is still carrying the whole load."],
];
function plantPreset(i){
  const q=PLANTPRE[i][1];
  /* machine sizes and control positions are per-instance on D and outlive a rebuild */
  designForget();
  /* a row's `d` is plant knobs and reactor knobs in one bag; each goes to the thing it is a knob on */
  const dCore={}, dPlant={};
  for(const k in (q.d||{})) (CORE_KEYS.includes(k) ? dCore : dPlant)[k]=q.d[k];
  Object.assign(D,dPlant);
  /* the reactor is drawn FIRST: the ship is sized off the rating as it is built */
  const core=coreMint();
  archPreset(core,q.arch);
  if(q.lat!=null) latPreset(core,q.lat);
  Object.assign(core,dCore);
  /* `drop` is handed to the builder rather than run afterwards, so a preset without an injection tank never places one */
  buildStockPlumbing({loops:q.loops, units:q.units, sets:q.sets, drop:q.drop, cont:q.cont,
                      inter:q.inter, cpump:q.cpump, core});
  // anything this ship carries that the stock one does not, placed the same way ADD MACHINE places it
  for(const g of (q.place||[])) mintMachine(g[0],g[1],g[2],g[3]);
  for(const id in (q.tanks||{})) if(D.tanks[id]) Object.assign(D.tanks[id],q.tanks[id]);
  buildStockAutomation();
  /* a figure baked off a half-built core is not this plant's: archPreset() redraws in stages and bake() WRITES on first read, so the bags go again HERE. Bags only - q.d has already been applied */
  dTouch();
  LAY=null; layoutMetrics();             // re-fit the arrangement once, not per gesture
  /* the bags go LAST, after the last thing that can bake: cleared before layoutMetrics() they refill off the same stale rating */
  designForgetBags();
  /* the LAST thing that can bake has run, so every suggestion is this plant's: stated now, the ship arrives with no AUTO left on it */
  designBake();
  /* AFTER the bags, because D.start IS a bag; every preset commissions with protection DEFEATED, so a plant runs its faults out */
  scramBlocksOn(false);
  Object.assign(D.start, q.start||{});
}
/* the empty ship: the one plant no preset can describe */
function plantClear(){
  designClear();
  dTouch();
  LAY=null; layoutMetrics();
  designForgetBags();
}
