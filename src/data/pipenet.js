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
    const area = want/(ORIF_CD*Math.sqrt(2*Math.max(rho,1e-3)*gasDpEq(GAM_VAP, lift, 0)*1e6));
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
const endDutyKgs = (p, face, vap, k) => { const R = ROLE[p.role];
  if(!R || p.role === "fitting") return 0;
  if(p.role === "pump")        return pumpFlow(p.id);
  if(p.role === "turb")        return turbKgs(p.id);
  /* a drum is a piece of the LOOP, not a reserve: its steam and feed lines carry what it raises and its own legs carry the recirculation */
  if(p.role === "tank")        return isDrum(p.id)
                                    ? ((k === "steam" || k === "feed") ? plantSteam()/Math.max(1, boilerCount()) : legDutyKgs())
                                    : tankKg(p.id)/RESERVE_T;
  if(p.role === "radiator")    return cwDutyKgs();
  if(R.sgtr)                   return onStage(p.id, face, 1)
                                    ? plantSteam()/Math.max(1, sgCount()) : legDutyKgs();
  if(R.thermal === "sink")     return vap ? plantSteam()/Math.max(1, condCount()) : cwDutyKgs();
  if(R.internal || R.thermal === "source") return legDutyKgs();
  return 0; };
const runDutyKgs = r => {
  const vap = edgeLaw(r) === LAW_VAPOUR;
  let w = null;
  for(const {p, face} of runEndParts(r)){ const v = endDutyKgs(p, face, vap, r.k);
    if(v > 0 && (w === null || v < w)) w = v; }
  return w; };
/* The vessel the run's own end states, so a turbine exhaust comes out wide and a steam line narrow. */
const runVapP = r => { let p = null;
  for(const {p: part} of runEndParts(r)){ const R = ROLE[part.role];
    const q = R && R.sgtr ? sgDesignP(part.id) : isDrum(part.id) ? boilerDesignP(part.id)
            : (R && R.thermal === "sink") ? condPDes() : null;
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
  ? rhogOf(satOfCirc(ci), satT(satOfCirc(ci), pVap)) : coolFig(circCoolOf(ci)).rho;
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
/* mm: a passage on a core's circuit is no narrower than the leg that feeds it, its own duty at the coolant's leg velocity */
const pathBoreMm = (pid, IN) => { const p = partOf(pid); if(!p) return BORE_REF;
  const ci = circOfNode(coreFold(pid+IN.a)), w = endDutyKgs(p, IN.a, false);
  if(!(ci >= 0) || !coreOnCirc(ci).length || !(w > 0)) return BORE_REF;
  return Math.max(BORE_REF, boreForW(w, circDesRho(ci, false, 0), circCoolOf(ci).vLeg)); };
const partPathI = (pid, IN) => { if(!(IN.v > 0) || !(IN.len > 0)) return 0;
  const A = pathAreaSuggest(pid, IN);
  return A > 0 ? IN.len/A : 0; };
/* a MASS term only - nothing here may reach a conductance */
const STEEL_RHO = 7850;    // kg/m^3
const ALPHA_STEEL = 1e-5;  // m^2/s, thermal diffusivity of a pressure-vessel steel
const STEEL_S   = 138;     // MPa allowable stress, carbon steel at temperature
const STEEL_UTS = 485;     // MPa minimum tensile strength, SA-516 grade 70: what the wall actually parts at
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
const rhoDesign = () => coolFig(COOLANT[priD().cool]).rho;
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
  const w1 = one*Math.sqrt(2*rhofOf(sat, satT(sat, p0))*omegaDpEq(omegaOf(sat, p0, 0), p0, pc)*1e6);
  const pl = pc + shieldLiftP(c)*CAV_LIFT_K;
  const per = flowW(1, rhogOf(sat, satT(sat, pl)), pl, pc, sat.gam);
  return per > 0 ? w1/per : 0; };

// MPa, fitted: the head a pump nobody has sized suggests
let PUMP_H0 = 0.60;
// a sweep scale on every head, pump and static column alike; the game never moves it
let HEAD_K = 1;

// gravity, MPa per (kg/m^3 x metre)
const G_MPA = 9.81e-6;
// RHO_K turns COOLANT[].dens into kg/m^3; water states none (coolFig())
const RHO_K = 7;

// metres, the floor under every run's length: a zero-length run still has to cost something
const NET_COMP_LEN = 0.1;

const PIPE_FRIC = 0.02;      // Darcy factor before there is a flow to read
const GAM_VAP = 1.3;       // isentropic exponent of superheated steam
/* Bernoulli-equivalent drops, G^2/(2 rho0) in MPa, so every edge keeps w = C*sqrt(2*rho0*dp).
   Register DQ_: [0] gam or omega, [1] p0, [2] pd, [3] out, [4] eta_c, [5] x, [6] T, [7] rho_f, [8] rho_g, [9] hfg, [10] c_p */
const DQ_W=0, DQ_P0=1, DQ_PD=2, DQ_OUT=3, DQ_ETA=4, DQ_X=5, DQ_T=6, DQ_RF=7, DQ_RG=8, DQ_HFG=9, DQ_CP=10, DQ_N=11;
const DQ = new Float64Array(DQ_N);
function gasDpA(io){ const gam = io[DQ_W], p0 = io[DQ_P0], rc = Math.pow(2/(gam+1), gam/(gam-1)), r = Math.max(io[DQ_PD]/p0, rc);
  io[DQ_OUT] = p0*gam/(gam-1)*(Math.pow(r, 2/gam) - Math.pow(r, (gam+1)/gam)); }
const gasDpEq = (gam, p0, pd) => { DQ[DQ_W] = gam; DQ[DQ_P0] = p0; DQ[DQ_PD] = pd; gasDpA(DQ); return DQ[DQ_OUT]; };
function omegaEtaCA(io){ const w = io[DQ_W]; let lo = 1e-6, hi = 1;
  for(let k=0;k<50;k++){ const n = (lo + hi)/2;
    const f = n*n + (w*w - 2*w)*(1 - n)*(1 - n) + 2*w*w*Math.log(n) + 2*w*w*(1 - n);
    if(f > 0) hi = n; else lo = n; }
  io[DQ_ETA] = (lo + hi)/2; }
/* Leung's omega method (1986): homogeneous equilibrium flashing flow in closed form */
function omegaDpA(io){ const w = io[DQ_W], p0 = io[DQ_P0]; omegaEtaCA(io);
  const n = Math.max(io[DQ_PD]/p0, io[DQ_ETA]), d = w*(1/n - 1) + 1;
  io[DQ_OUT] = p0*Math.max(0, -(w*Math.log(n) + (w - 1)*(1 - n)))/(d*d); }
const omegaDpEq = (w, p0, pd) => { DQ[DQ_W] = w; DQ[DQ_P0] = p0; DQ[DQ_PD] = pd; omegaDpA(DQ); return DQ[DQ_OUT]; };
/* omega of a saturated mixture of quality io[DQ_X] at io[DQ_P0], off the curve's own two densities and latent heat, into io[DQ_W] */
function omegaA(c, io){ const p0 = io[DQ_P0], x = io[DQ_X];
  satTA(c, io, DQ_P0, DQ_T); curveA(c, CV_RF, io, DQ_T, DQ_RF); curveA(c, CV_RG, io, DQ_T, DQ_RG); curveA(c, CV_HFG, io, DQ_T, DQ_HFG); cpOfTPA(c, io, DQ_T, DQ_P0, DQ_CP);
  const T = io[DQ_T], vf = 1/io[DQ_RF], vg = 1/io[DQ_RG], hfg = io[DQ_HFG]*1e3;
  const v0 = x*vg + (1 - x)*vf, r = (vg - vf)/Math.max(hfg, 1);
  io[DQ_W] = x*vg/(v0*(c.gam || GAM_VAP)) + io[DQ_CP]*1e3*T*p0*1e6*r*r/v0; }
const omegaOf = (c, p0, x) => { DQ[DQ_P0] = p0; DQ[DQ_X] = x; omegaA(c, DQ); return DQ[DQ_W]; };
const DPFRAC    = 0.00005;   // floor on dp, a FRACTION never an absolute
const ORIF_CD   = 0.61;      // sharp-edged orifice
/* Haaland; Re floored so a stopped leg keeps a finite coefficient and can restart */
const PIPE_ROUGH = 4.5e-5;   // commercial steel
const K_BEND = 0.3, K_ENTRY = 0.5, K_EXIT = 1.0;
const RE_FLOOR = 500;
/* register PC_: bore, flow kg/s, viscosity, Darcy f, length, K0, conductance */
const PC_BORE=0, PC_W=1, PC_MU=2, PC_F=3, PC_L=4, PC_K0=5, PC_C=6, PC_N=7;
const PCR = new Float64Array(PC_N);
function fricA(io){
  const D = boreM(io[PC_BORE]), Re = Math.max(4*Math.abs(io[PC_W])/(Math.PI*D*io[PC_MU]), RE_FLOOR);
  if(Re < 2300){ io[PC_F] = 64/Re; return; }
  const r = -1.8*Math.log10(Math.pow(PIPE_ROUGH/D/3.7, 1.11) + 6.9/Re);
  io[PC_F] = 1/(r*r);
}
const fricOf = (bore, w, mu) => {
  if(!(w !== undefined && mu > 0)) return PIPE_FRIC;
  PCR[PC_BORE] = bore; PCR[PC_W] = w; PCR[PC_MU] = mu; fricA(PCR); return PCR[PC_F];
};
const boreM = bore => Math.max(bore*BORE_REF/1000, 0.01);
const areaOf = bore => Math.PI/4*boreM(bore)*boreM(bore);
/* m^2; infinite length reaches exactly 0, which is how a severed pipe says there is no pipe */
function pipeCA(io){ const bore = io[PC_BORE], K = io[PC_F]*Math.max(io[PC_L], NET_COMP_LEN)/boreM(bore) + io[PC_K0];
  io[PC_C] = isFinite(K) && K > 0 ? areaOf(bore)/Math.sqrt(K) : 0; }
const pipeC = (bore, L, K0, f) => { PCR[PC_BORE] = bore; PCR[PC_L] = L; PCR[PC_K0] = K0||0; PCR[PC_F] = f === undefined ? PIPE_FRIC : f;
  pipeCA(PCR); return PCR[PC_C]; };
// an orifice has no length term, only its own area
const holeC = bore => ORIF_CD*areaOf(bore);
// the path through a component's own body, plus the loss its ROLE states for its internals
const COMP_C = pipeC(1, NET_COMP_LEN);
const compC = (K, bore = 1) => K > 0 ? pipeC(bore, NET_COMP_LEN, K) : bore === 1 ? COMP_C : pipeC(bore, NET_COMP_LEN);
/* MPa the core spends between its own nozzles at rated flow: a real RBMK's inlet throttle and lower water line, a real BWR's bundle orifice. STATED per coolant, never derived - the drawn channel is nothing like the real machine's geometry. */
const coreDpSuggest = id => COOLANT[(coreD(id) || priD()).cool].dpCore || 0;
const coreDpOf = id => { const cD = coreD(id); return (cD && cD.dp0) ?? coreDpSuggest(id); };
/* the whole of it at the INLET face, priced as a resistance on the run that lands there so the guess, the reference and the tick all read it through runK0() */
const coreEndK = (id, r) => {
  const dp = coreDpOf(id); if(!(dp > 0)) return null;
  const w = runDutyKgs(r); if(!(w > 0)) return null;
  const mm = runBoreMm(r), A = Math.PI/4*Math.pow(mm/1000, 2);
  return dp*1e6*2*circDesRho(runCircOf(r), false, 0)*A*A/(w*w);
};
const runK0 = r => {
  const endK = (pid, face) => { const p = partOf(pid), R = p && ROLE[p.role];
    if(R && R.inlet !== undefined && face === R.inlet){
      const k = coreEndK(p.id, r); if(k !== null) return k; }
    return R && R.kEnd !== undefined ? R.kEnd : (K_ENTRY + K_EXIT)/2; };
  return K_BEND*Math.max(0, (r.pts ? r.pts.length : 2) - 2)
       + endK(r.a, r.sa) + endK(r.b, r.sb);
};
/* kg/s an opening WOULD pass at a stated pair of pressures, not what the field says it does; gam names a vapour, which expands and chokes */
const flowW = (C, rho, pHi, pLo, gam) => C > 0
  ? C*Math.sqrt(2*Math.max(rho,1e-3)*Math.max(gam ? gasDpEq(gam, Math.max(pHi,1e-6), pLo) : pHi-pLo, 0)*1e6)
  : 0;
/* structural on purpose: anything richer than s.mBy and net.vol closes a loop back through tankP and overflows the stack on tick one */
const DRY_FRAC = 1e-3, DRY_MIN_KG = 1e-6;
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

// an EQUIVALENT LENGTH, never a multiplier; neither constant is fitted against a measured valve
const VALVE_LEQ=2, VALVE_XMIN=0.05;
const valveLeq = x => x>=1 ? 0 : VALVE_LEQ*(1/Math.max(x,VALVE_XMIN)**2 - 1);

// the one break whose size is not read off a pipe's bore
const BREACH_BORE = 1.6;
// s for the loop's whole inventory to pass one point at rated flow (loopKg(), step.js)
const LOOP_TRANSIT = 12;
/* water is IAPWS-IF97: region 4 for the saturation line, regions 1 to 3 for everything else; any other coolant is a power law about its own boiling point */
const WATER_TC = 647.096, WATER_PC = 22.064;
const IF97_N = [0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2, 0.12020824702470e5, -0.32325550322333e7,
                0.14915108613530e2, -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849, 0.65017534844798e3];
/* the array-leaf forms (io[k] in, io[o] out) are what the tick calls: a double crossing a call V8 did not inline is a heap allocation */
const PR = new Float64Array(8), PV = new Float64Array(4), PQ3 = new Float64Array(8);
function if97PsatA(io, k, o){ const N = IF97_N, u = Math.min(Math.max(io[k], 273.15), WATER_TC), t = u + N[8]/(u - N[9]);
  const A = t*t + N[0]*t + N[1], B = N[2]*t*t + N[3]*t + N[4], C = N[5]*t*t + N[6]*t + N[7];
  io[o] = Math.pow(2*C/(-B + Math.sqrt(B*B - 4*A*C)), 4); }
const if97Psat = T => { PV[0] = T; if97PsatA(PV, 0, 1); return PV[1]; };
function if97TsatA(io, k, o){ const N = IF97_N, b = Math.pow(Math.min(Math.max(io[k], 611.213e-6), WATER_PC), 0.25);
  const E = b*b + N[2]*b + N[5], F = N[0]*b*b + N[3]*b + N[6], G = N[1]*b*b + N[4]*b + N[7];
  const D = 2*G/(-F - Math.sqrt(F*F - 4*E*G));
  io[o] = (N[9] + D - Math.sqrt((N[9] + D)*(N[9] + D) - 4*(N[8] + N[9]*D)))/2; }
const if97Tsat = p => { PR[0] = p; if97TsatA(PR, 0, 1); return PR[1]; };
const isWater = c => c.tc === WATER_TC;
/* IAPWS-IF97 regions 1, 2 and 3 and the B23 line, evaluated only at load into the tables below */
const IF97_R = 0.461526;
const IF97_I1 = [0,0,0,0,0,0,0,0,1,1,1,1,1,1,2,2,2,2,2,3,3,3,4,4,4,5,8,8,21,23,29,30,31,32];
const IF97_J1 = [-2,-1,0,1,2,3,4,5,-9,-7,-1,0,1,3,-3,0,1,3,17,-4,0,6,-5,-2,10,-8,-11,-6,-29,-31,-38,-39,-40,-41];
const IF97_N1 = [0.14632971213167,-0.84548187169114,-0.37563603672040e1,0.33855169168385e1,-0.95791963387872,0.15772038513228,
  -0.16616417199501e-1,0.81214629983568e-3,0.28319080123804e-3,-0.60706301565874e-3,-0.18990068218419e-1,-0.32529748770505e-1,
  -0.21841717175414e-1,-0.52838357969930e-4,-0.47184321073267e-3,-0.30001780793026e-3,0.47661393906987e-4,-0.44141845330846e-5,
  -0.72694996297594e-15,-0.31679644845054e-4,-0.28270797985312e-5,-0.85205128120103e-9,-0.22425281908000e-5,-0.65171222895601e-6,
  -0.14341729937924e-12,-0.40516996860117e-6,-0.12734301741641e-8,-0.17424871230634e-9,-0.68762131295531e-18,0.14478307828521e-19,
  0.26335781662795e-22,-0.11947622640071e-22,0.18228094581404e-23,-0.93537087292458e-25];
const IF97_J0 = [0,1,-5,-4,-3,-2,-1,2,3];
const IF97_N0 = [-0.96927686500217e1,0.10086655968018e2,-0.56087911283020e-2,0.71452738081455e-1,-0.40710498223928,
  0.14240819171444e1,-0.43839511319450e1,-0.28408632460772,0.21268463753307e-1];
const IF97_I2 = [1,1,1,1,1,2,2,2,2,2,3,3,3,3,3,4,4,4,5,6,6,6,7,7,7,8,8,9,10,10,10,16,16,18,20,20,20,21,22,23,24,24,24];
const IF97_J2 = [0,1,2,3,6,1,2,4,7,36,0,1,3,6,35,1,2,3,7,3,16,35,0,11,25,8,36,13,4,10,14,29,50,57,20,35,48,21,53,39,26,40,58];
const IF97_N2 = [-0.17731742473213e-2,-0.17834862292358e-1,-0.45996013696365e-1,-0.57581259083432e-1,-0.50325278727930e-1,
  -0.33032641670203e-4,-0.18948987516315e-3,-0.39392777243355e-2,-0.43797295650573e-1,-0.26674547914087e-4,0.20481737692309e-7,
  0.43870667284435e-6,-0.32277677238570e-4,-0.15033924542148e-2,-0.40668253562649e-1,-0.78847309559367e-9,0.12790717852285e-7,
  0.48225372718507e-6,0.22922076337661e-5,-0.16714766451061e-10,-0.21171472321355e-2,-0.23895741934104e2,-0.59059564324270e-17,
  -0.12621808899101e-5,-0.38946842435739e-1,0.11256211360459e-10,-0.82311340897998e1,0.19809712802088e-7,0.10406965210174e-18,
  -0.10234747095929e-12,-0.10018179379511e-8,-0.80882908646985e-10,0.10693031879409,-0.33662250574171,0.89185845355421e-24,
  0.30629316876232e-12,-0.42002467698208e-5,-0.59056029685639e-25,0.37826947613457e-5,-0.12768608934681e-14,0.73087610595061e-28,
  0.55414715350778e-16,-0.94369707241210e-6];
const IF97_N31 = 0.10658070028513e1;
const IF97_I3 = [0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,2,2,3,3,3,3,3,4,4,4,4,5,5,5,6,6,6,7,8,9,9,10,10,11];
const IF97_J3 = [0,1,2,7,10,12,23,2,6,15,17,0,2,6,7,22,26,0,2,4,16,26,0,2,4,26,1,3,26,0,2,26,2,26,2,26,0,1,26];
const IF97_N3 = [-0.15732845290239e2,0.20944396974307e2,-0.76867707878716e1,0.26185947787954e1,-0.28080781148620e1,
  0.12053369696517e1,-0.84566812812502e-2,-0.12654315477714e1,-0.11524407806681e1,0.88521043984318,-0.64207765181607,
  0.38493460186671,-0.85214708824206,0.48972281541877e1,-0.30502617256965e1,0.39420536879154e-1,0.12558408424308,
  -0.27999329698710,0.13899799569460e1,-0.20189915023570e1,-0.82147637173963e-2,-0.47596035734923,0.43984074473500e-1,
  -0.44476435428739,0.90572070719733,0.70522450087967,0.10770512626332,-0.32913623258954,-0.50871062041158,
  -0.22175400873096e-1,0.94260751665092e-1,0.16436278447961,-0.13503372241348e-1,-0.14834345352472e-1,0.57922953628084e-3,
  0.32308904703711e-2,0.80964802996215e-4,-0.16557679795037e-3,-0.44923899061815e-4];
const IF97_B23 = [0.34805185628969e3, -0.11671859879975e1, 0.10192970039326e-2];
const if97PB23 = T => IF97_B23[0] + IF97_B23[1]*T + IF97_B23[2]*T*T;
const IP_A = new Float64Array(64), IP_B = new Float64Array(64);
/* tab[k - lo] = x^k for lo <= k <= hi, by multiplication */
function if97Pow(tab, x, lo, hi){ tab[-lo] = 1; const r = 1/x;
  for(let k=1;k<=hi;k++) tab[k-lo] = tab[k-1-lo]*x;
  for(let k=-1;k>=lo;k--) tab[k-lo] = tab[k+1-lo]*r; }
/* out: [0] v m3/kg, [1] h kJ/kg, [2] cp kJ/kg/K */
const if97R1 = (T, p, out) => { const pi = p/16.53, tau = 1386/T, A = IP_A, B = IP_B;
  if97Pow(A, 7.1 - pi, 0, 32); if97Pow(B, tau - 1.222, -43, 17);
  let gp = 0, gt = 0, gtt = 0;
  for(let k=0;k<34;k++){ const I = IF97_I1[k], J = IF97_J1[k], n = IF97_N1[k];
    if(I > 0) gp -= n*I*A[I-1]*B[J+43];
    gt += n*A[I]*J*B[J+42]; gtt += n*A[I]*J*(J-1)*B[J+41]; }
  out[0] = IF97_R*T*pi*gp/(p*1000); out[1] = IF97_R*T*tau*gt; out[2] = -IF97_R*tau*tau*gtt; return out; };
const if97R2 = (T, p, out) => { const tau = 540/T, A = IP_A, B = IP_B;
  if97Pow(A, p, 0, 24); if97Pow(B, tau - 0.5, -2, 58);
  let g0t = 0, g0tt = 0, grp = 0, grt = 0, grtt = 0;
  for(let k=0;k<9;k++){ const J = IF97_J0[k]; g0t += IF97_N0[k]*J*Math.pow(tau, J-1); g0tt += IF97_N0[k]*J*(J-1)*Math.pow(tau, J-2); }
  for(let k=0;k<43;k++){ const I = IF97_I2[k], J = IF97_J2[k], n = IF97_N2[k];
    grp += n*I*A[I-1]*B[J+2]; grt += n*A[I]*J*B[J+1]; grtt += n*A[I]*J*(J-1)*B[J]; }
  out[0] = IF97_R*T*(1 + p*grp)/(p*1000); out[1] = IF97_R*T*tau*(g0t + grt); out[2] = -IF97_R*tau*tau*(g0tt + grtt); return out; };
/* out: [0] p MPa, [1] h, [2] cp, [3] dp/drho */
const if97R3 = (rho, T, out) => { const d = rho/322, t = WATER_TC/T, A = IP_A, B = IP_B;
  if97Pow(A, d, -2, 11); if97Pow(B, t, -2, 26);
  let fd = IF97_N31/d, fdd = -IF97_N31/(d*d), ft = 0, ftt = 0, fdt = 0;
  for(let k=0;k<39;k++){ const I = IF97_I3[k], J = IF97_J3[k], n = IF97_N3[k];
    fd += n*I*A[I+1]*B[J+2]; fdd += n*I*(I-1)*A[I]*B[J+2];
    ft += n*A[I+2]*J*B[J+1]; ftt += n*A[I+2]*J*(J-1)*B[J]; fdt += n*I*J*A[I+1]*B[J+1]; }
  const q = d*fd - d*t*fdt;
  out[0] = rho*IF97_R*T*d*fd/1000; out[1] = IF97_R*T*(t*ft + d*fd);
  out[2] = IF97_R*(-t*t*ftt + q*q/(2*d*fd + d*d*fdd)); out[3] = IF97_R*T*(2*d*fd + d*d*fdd)/1000; return out; };
const IF97_O = new Float64Array(4);
/* region 3 density at (p, T) on the liquid side (liq) or the vapour side below Tc; g warm-starts Newton, NaN walks in from that side's end */
function if97R3Rho(p, T, liq, g){
  const o = IF97_O, sub = T < WATER_TC;
  let r = g;
  if(r === r) for(let k=0;k<30;k++){ if97R3(r, T, o);
    if(!(o[3] > 0)) break;
    const s = (o[0] - p)/o[3]; r -= s;
    if(!(r > 0) || (sub && (liq ? r < 322 : r > 322))) break;
    if(Math.abs(s) < 1e-11*r) return r; }
  const st = liq ? -2 : 2;
  let a = liq ? 850 : 1;
  for(;;){ const b = a + st; if97R3(b, T, o);
    if((sub && !(o[3] > 0)) || b < 0.5) return a;
    if(liq ? o[0] <= p : o[0] >= p){ let lo = Math.min(a, b), hi = Math.max(a, b);
      for(let k=0;k<60;k++){ const m = (lo + hi)/2; if97R3(m, T, o); if(o[0] < p) lo = m; else hi = m; }
      return (lo + hi)/2; }
    a = b; } }
let if97G = NaN;
const IF97_L = 0, IF97_V = 1, IF97_S = 2;
/* IF97 at (T, p) held on one side so a metastable state stays there: L liquid, V vapour, S section 4's own choice */
function if97PT(T, p, mode, out){ const o = IF97_O;
  if(mode !== IF97_V && T <= 623.15) if97R1(T, p, o);
  else if(mode !== IF97_L && (T <= 623.15 || T > 863.15 || p <= if97PB23(T))) if97R2(T, p, o);
  else { const r = if97R3Rho(p, T, mode !== IF97_V, if97G); if97G = r; if97R3(r, T, o); out[0] = r; out[1] = o[1]; out[2] = o[2]; return out; }
  out[0] = 1/o[0]; out[1] = o[1]; out[2] = o[2]; return out; }
/* the saturation line off regions 1, 2 and 3 at psat(T), up to the critical point: h and rho of both phases */
const WL_T0 = 273.16, WL_T1 = WATER_TC, WL_N = 2048, WL_DT = (WL_T1 - WL_T0)/(WL_N - 1), WL_CP0 = 4.2199;
const WL_H = new Float64Array(WL_N), WL_HG = new Float64Array(WL_N), WL_RF = new Float64Array(WL_N), WL_RG = new Float64Array(WL_N);
const WL_S = new Float64Array(WL_N);
(() => { const o = new Float64Array(3);
  let gL = NaN, gV = NaN;
  for(let i=0;i<WL_N-1;i++){ const T = WL_T0 + i*WL_DT, ps = Math.max(if97Psat(T), 611.657e-6);
    if97G = gL; if97PT(T, ps, IF97_L, o); gL = if97G; WL_H[i] = o[1]; WL_RF[i] = o[0];
    if97G = gV; if97PT(T, ps, IF97_V, o); gV = if97G; WL_HG[i] = o[1]; WL_RG[i] = o[0]; }
  if97R3(322, WATER_TC, o); WL_H[WL_N-1] = WL_HG[WL_N-1] = o[1]; WL_RF[WL_N-1] = WL_RG[WL_N-1] = 322;
  for(let i=1;i<WL_N;i++){ const Ta = WL_T0 + (i-1)*WL_DT, Tb = Ta + WL_DT, Tm = Ta + WL_DT/2;
    WL_S[i] = WL_S[i-1] + (WL_H[i] - WL_H[i-1] - (if97Psat(Tb) - if97Psat(Ta))*2000/(WL_RF[i-1] + WL_RF[i]))/Tm; } })();
function wlA(tab, io, k, o){ const T = io[k];
  if(T <= WL_T0){ io[o] = tab[0]; return; }
  if(T >= WL_T1){ io[o] = tab[WL_N-1]; return; }
  const u = (T - WL_T0)/WL_DT, i = u|0; io[o] = tab[i] + (tab[i+1] - tab[i])*(u - i); }
function wHlA(io, k, o){ const T = io[k]; if(T < WL_T0){ io[o] = WL_H[0] + WL_CP0*(T - WL_T0); return; } wlA(WL_H, io, k, o); }
function wHfgA(io, k, o){ wlA(WL_HG, io, k, o + 1); wlA(WL_H, io, k, o); io[o] = io[o + 1] - io[o]; }
function wRfA(io, k, o){ wlA(WL_RF, io, k, o); }
function wRgA(io, k, o){ wlA(WL_RG, io, k, o); }
function wCplA(io, k, o){ const u = (io[k] - WL_T0)/WL_DT, i = u < 0 ? 0 : u >= WL_N - 1 ? WL_N - 2 : u|0; io[o] = (WL_H[i+1] - WL_H[i])/WL_DT; }
function wSlA(io, k, o){ const T = io[k];
  if(T <= WL_T0){ io[o] = WL_CP0*Math.log(T/WL_T0); return; }
  const u = (T - WL_T0)/WL_DT, i = u >= WL_N - 1 ? WL_N - 2 : u|0; io[o] = WL_S[i] + (WL_S[i+1] - WL_S[i])*(u - i); }
/* single-phase water: every pressure row samples the same h and T nodes, so a read between rows at one h follows that isenthalp */
const WT_PMIN = 611.657e-6, WT_PMAX = 100, WT_TMAX = 1073.15;
const WT_H0 = -12, WT_HA = 1500, WT_HB = 2900, WT_D1 = 4, WT_D2 = 2;
const WT_K1 = (WT_HA - WT_H0)/WT_D1, WT_K2 = WT_K1 + (WT_HB - WT_HA)/WT_D2;
const wtK = h => h < WT_HA ? (h - WT_H0)/WT_D1 : h < WT_HB ? WT_K1 + (h - WT_HA)/WT_D2 : WT_K2 + (h - WT_HB)/WT_D1;
const wtHk = k => k < WT_K1 ? WT_H0 + k*WT_D1 : k < WT_K2 ? WT_HA + (k - WT_K1)*WT_D2 : WT_HB + (k - WT_K2)*WT_D1;
const WT_DT = 0.5;
const WT_P = (() => { const lo = [], hi = [];
  for(let p = WATER_PC; p > WT_PMIN*1.05; ){ p -= Math.min(0.06*p, 0.02 + 0.1*(WATER_PC - p)); lo.push(Math.max(p, WT_PMIN)); }
  if(lo[lo.length-1] > WT_PMIN) lo.push(WT_PMIN);
  for(let p = WATER_PC; p < WT_PMAX; ){ p = Math.min(WT_PMAX, p + Math.min(2.5, 0.02 + 0.1*(p - WATER_PC))); hi.push(p); }
  return Float64Array.from(lo.reverse().concat([WATER_PC], hi)); })();
const WT_NR = WT_P.length, WT_NB = 1024, WT_L0 = Math.log(WT_PMIN), WT_BKI = WT_NB/(Math.log(WT_PMAX) - WT_L0);
const WT_BK = new Int32Array(WT_NB);
for(let b=0, r=0; b<WT_NB; b++){ const p = Math.exp(WT_L0 + b/WT_BKI); while(r < WT_NR - 2 && WT_P[r+1] <= p) r++; WT_BK[b] = r; }
const WT_HPC = new Float64Array(WT_NR), WT_TPC = new Float64Array(WT_NR);
/* per row and side: the first and last node, and where they sit in the flat arrays */
const WT_KA = new Int32Array(WT_NR*2), WT_KB = new Int32Array(WT_NR*2), WT_KO = new Int32Array(WT_NR*2);
const WT_JA = new Int32Array(WT_NR*2), WT_JB = new Int32Array(WT_NR*2), WT_JO = new Int32Array(WT_NR*2);
let WT_T = null, WT_R = null, WT_HT = null;
(() => { const o = new Float64Array(3), sT = [], sH = [], sR = [], cT = [], cR = [], cH = [];
  const tsOf = r => r < 0 ? WL_T0 : WT_P[r] < WATER_PC ? if97Tsat(WT_P[r]) : WATER_TC;
  const side = (i, p, mode, T0, T1) => {
    sT.length = sH.length = sR.length = 0; if97G = NaN;
    let T = T0;
    for(;;){ if97PT(T, p, mode, o); sT.push(T); sH.push(o[1]); sR.push(o[0]);
      if(T >= T1) break;
      const nxt = Math.min(T1, WL_T0 + (Math.floor((T - WL_T0)/WT_DT + 1e-9) + 1)*WT_DT);
      const n = Math.min(64, Math.max(1, Math.ceil((nxt - T)*o[2]/2)));
      for(let m=1;m<n;m++){ const t = T + (nxt - T)*m/n; if97PT(t, p, mode, o); sT.push(t); sH.push(o[1]); sR.push(o[0]); }
      T = nxt; }
    const ns = sT.length;
    let ka = Math.ceil(wtK(sH[0]) - 1e-9), kb = Math.floor(wtK(sH[ns-1]) + 1e-9);
    WT_KA[i] = ka; WT_KB[i] = kb; WT_KO[i] = cT.length;
    for(let k=ka, m=0; k<=kb; k++){ const h = wtHk(k);
      while(m < ns - 2 && sH[m+1] < h) m++;
      const w = (h - sH[m])/(sH[m+1] - sH[m]); cT.push(sT[m] + (sT[m+1] - sT[m])*w); cR.push(sR[m] + (sR[m+1] - sR[m])*w); }
    const ja = Math.ceil((T0 - WL_T0)/WT_DT - 1e-9), jb = Math.floor((T1 - WL_T0)/WT_DT + 1e-9);
    WT_JA[i] = ja; WT_JB[i] = jb; WT_JO[i] = cH.length;
    for(let j=ja, m=0; j<=jb; j++){ const t = WL_T0 + j*WT_DT;
      while(m < ns - 2 && sT[m+1] < t) m++;
      cH.push(sH[m] + (sH[m+1] - sH[m])*(t - sT[m])/(sT[m+1] - sT[m])); } };
  for(let r=0;r<WT_NR;r++){ const p = WT_P[r];
    if(p < WATER_PC){ const Ts = tsOf(r), ext = tsOf(r + 1) - tsOf(r - 1) + 0.5;
      side(r*2, p, IF97_L, WL_T0, Math.max(Ts + ext, WL_T0 + 3)); side(r*2 + 1, p, IF97_V, Ts - ext, WT_TMAX);
      continue; }
    side(r*2, p, IF97_S, WL_T0, WT_TMAX);
    WT_KA[r*2+1] = WT_KA[r*2]; WT_KB[r*2+1] = WT_KB[r*2]; WT_KO[r*2+1] = WT_KO[r*2];
    WT_JA[r*2+1] = WT_JA[r*2]; WT_JB[r*2+1] = WT_JB[r*2]; WT_JO[r*2+1] = WT_JO[r*2];
    let Tp = WATER_TC;
    if(p > WATER_PC){ let best = -1; if97G = NaN;
      for(let T = WATER_TC; T <= 1000; T += 1){ if97PT(T, p, IF97_S, o); if(o[2] > best){ best = o[2]; Tp = T; } }
      let a = Tp - 1, b = Tp + 1; const g = (Math.sqrt(5) - 1)/2;
      for(let k=0;k<50;k++){ const m1 = b - g*(b - a), m2 = a + g*(b - a);
        if97PT(m1, p, IF97_S, o); const c1 = o[2]; if97PT(m2, p, IF97_S, o); if(c1 > o[2]) b = m2; else a = m1; }
      Tp = (a + b)/2; }
    if97G = NaN; if97PT(Tp, p, IF97_S, o); WT_TPC[r] = Tp; WT_HPC[r] = p > WATER_PC ? o[1] : WL_H[WL_N-1]; }
  WT_T = Float64Array.from(cT); WT_R = Float64Array.from(cR); WT_HT = Float64Array.from(cH); })();
/* the row pair about p, and the saturation line (below pc) or the pseudo-critical point (above) at p */
const WQ = new Float64Array(12), WQ_R = new Int32Array(1);
const Q_A = 0, Q_HL = 1, Q_HV = 2, Q_TS = 3, Q_RL = 4, Q_RV = 5, Q_S = 6, Q_V = 7, Q_K = 8;
function wtEndsA(io, kp){ const q = WQ, p = io[kp], pp = p < WT_PMIN ? WT_PMIN : p > WT_PMAX ? WT_PMAX : p;
  let b = ((Math.log(pp) - WT_L0)*WT_BKI)|0; if(b >= WT_NB) b = WT_NB - 1;
  let r = WT_BK[b]; while(r < WT_NR - 2 && WT_P[r+1] <= pp) r++;
  WQ_R[0] = r; q[Q_A] = (pp - WT_P[r])/(WT_P[r+1] - WT_P[r]);
  if(pp < WATER_PC){ q[Q_S] = pp; if97TsatA(q, Q_S, Q_TS); wHlA(q, Q_TS, Q_HL); wlA(WL_HG, q, Q_TS, Q_HV);
    wRfA(q, Q_TS, Q_RL); wRgA(q, Q_TS, Q_RV); return; }
  const a = q[Q_A];
  q[Q_HL] = q[Q_HV] = WT_HPC[r] + (WT_HPC[r+1] - WT_HPC[r])*a;
  q[Q_TS] = WT_TPC[r] + (WT_TPC[r+1] - WT_TPC[r])*a; q[Q_RL] = q[Q_RV] = 322; }
/* WQ[Q_V] = T (sel 0) or rho (sel 1) on row r's side s at node coordinate WQ[Q_K]; past the hot end the vapour is an ideal gas at fixed p */
function wtRowH(r, s, sel){ const i = r*2 + s, ka = WT_KA[i], kb = WT_KB[i], o = WT_KO[i] - ka, T = WT_T, kf = WQ[Q_K];
  let k = Math.floor(kf); if(k < ka) k = ka; else if(k > kb - 1) k = kb - 1;
  const b = kf - k, t = T[o+k] + (T[o+k+1] - T[o+k])*b;
  if(!sel){ WQ[Q_V] = t; return; }
  const R = WT_R;
  WQ[Q_V] = b > 1 ? R[o+kb]*T[o+kb]/t : R[o+k] + (R[o+k+1] - R[o+k])*b; }
/* after wtEndsA(): io[o] = T (sel 0) or rho (sel 1) at h = io[kh] on side s */
function wtAtHA(io, kh, o, sel, s){ const r = WQ_R[0], h = io[kh];
  WQ[Q_K] = h < WT_HA ? (h - WT_H0)/WT_D1 : h < WT_HB ? WT_K1 + (h - WT_HA)/WT_D2 : WT_K2 + (h - WT_HB)/WT_D1;
  wtRowH(r, s, sel); const v0 = WQ[Q_V]; wtRowH(r + 1, s, sel); io[o] = v0 + (WQ[Q_V] - v0)*WQ[Q_A]; }
/* WQ[Q_V] = h (sel 0) or dh/dT (sel 1) on row r's side s at temperature node coordinate WQ[Q_K] */
function wtRowT(r, s, sel){ const i = r*2 + s, ja = WT_JA[i], jb = WT_JB[i], o = WT_JO[i] - ja, H = WT_HT, jf = WQ[Q_K];
  let j = Math.floor(jf); if(j < ja) j = ja; else if(j > jb - 1) j = jb - 1;
  const d = H[o+j+1] - H[o+j];
  WQ[Q_V] = sel ? d/WT_DT : H[o+j] + d*(jf - j); }
/* after wtEndsA(): io[o] = h (sel 0) or c_p (sel 1) at T = io[kT], on the side the saturation line puts it */
function wtAtTA(io, kT, o, sel){ const r = WQ_R[0], T = io[kT], s = T <= WQ[Q_TS] ? 0 : 1;
  WQ[Q_K] = (T - WL_T0)/WT_DT;
  wtRowT(r, s, sel); const v0 = WQ[Q_V]; wtRowT(r + 1, s, sel); io[o] = v0 + (WQ[Q_V] - v0)*WQ[Q_A]; }
/* the doors: io[kp] = p; h and c_p on the side T says */
function wHtpA(io, kT, kp, o){ wtEndsA(io, kp); wtAtTA(io, kT, o, 0); }
function wCptpA(io, kT, kp, o){ wtEndsA(io, kp); wtAtTA(io, kT, o, 1); }
const WK = new Float64Array(3);
/* (1/rho) drho/dp at fixed h on the liquid side, off the density door's own rows */
function wKapA(io, kp, kh, o){ const p = io[kp], dp = Math.max(1e-4, p*1e-3), k = WK;
  k[0] = io[kh]; wtEndsA(io, kp); wtAtHA(k, 0, 1, 1, 0); k[2] = p + dp; wtEndsA(k, 2); wtAtHA(k, 0, 2, 1, 0);
  io[o] = Math.max(0, (k[2] - k[1])/(k[1]*dp)); }
function wHpcA(io, kp, o){ wtEndsA(io, kp); io[o] = WQ[Q_HL]; }
const wHpc = p => { PR[0] = p; wHpcA(PR, 0, 1); return PR[1]; };
function satTA(c, io, k, o){ if(isWater(c)) if97TsatA(io, k, o); else io[o] = c.T0*Math.pow(Math.max(io[k],c.pFloor)/c.p0, c.n); }
const satT = (c,p) => { PR[0] = p; satTA(c, PR, 0, 1); return PR[1]; };
function satPRawA(c, io, k, o){ const T = io[k];
  if(isWater(c)) if97PsatA(io, k, o); else io[o] = c.p0*Math.pow(Math.max(T,c.TFloor)/c.T0, 1/c.n); }
const satPRaw = (c,T) => { PV[0] = T; satPRawA(c, PV, 0, 1); return PV[1]; };

/* the curve contract: satCurveFor() builds the same keys in the same order, so the hot EOS loops see one map */
const SAT_WATER = {tc:WATER_TC, pc:WATER_PC, rhoc:322,
                   p0:6.9, T0:558, n:0.0855, pFloor:1e-4, TFloor:1,
                   hfg:0, rho:0, cp:0, mu:1.2e-4, muV:2.0e-5, gam:GAM_VAP, solidK:1.4, hFilm:30000,
                   Tref:558, burn:undefined, sho:null, mmol:.018, shoH0:0, tab:null};
/* K, where feedwater arrives: a plant figure, set on the turbine, since the heaters that warm it are bled off it */
const FEED_T0 = 490;
const feedTSuggest = () => FEED_T0;
const feedTOf = () => D.feedT ?? feedTSuggest();
/* Watson: latent heat falls to zero at the critical point; a curve with no tc keeps its scalar */
const WATSON = 0.38;
function hfgRawA(c, io, k, o){ const T = io[k];
  if(isWater(c)){ wHfgA(io, k, o); return; }
  io[o] = c.tc ? c.hfg*Math.pow(clamp((c.tc-T)/(c.tc-c.T0),0,6), WATSON) : c.hfg; }
const hfgRaw = (c,T) => { PV[0] = T; hfgRawA(c, PV, 0, 1); return PV[1]; };
/* the same shape for the gap between the two densities; the exponent is the published critical one */
const RHO_N = 0.35;
function rhofRawA(c, io, k, o){ const T = io[k];
  if(isWater(c)){ wRfA(io, k, o); return; }
  io[o] = c.tc ? c.rhoc + (c.rho-c.rhoc)*Math.pow(clamp((c.tc-T)/(c.tc-c.T0),0,6), RHO_N) : c.rho; }
const rhofRaw = (c,T) => { PV[0] = T; rhofRawA(c, PV, 0, 1); return PV[1]; };
/* Clausius-Clapeyron backwards, off this curve's own slope and latent heat; ceiled at the liquid */
function rhogRawA(c, io, k, o){ const T = io[k];
  if(isWater(c)){ wRgA(io, k, o); return; }
  const s = PQ3; s[0] = T; rhofRawA(c, s, 0, 1); satPRawA(c, s, 0, 2);
  const q = Math.max(s[2], c.pFloor); s[3] = q; satTA(c, s, 3, 4); hfgRawA(c, s, 0, 5);
  io[o] = Math.min(s[1], Math.max(q/(c.n*s[4])*T*1e3/Math.max(s[5], 1e-6), 1e-6)); }
const rhogRaw = (c,T) => { PV[0] = T; rhogRawA(c, PV, 0, 1); return PV[1]; };
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
/* the table rides the curve (c.tab, resolved at construction); the WeakMap is the
   fallback for exotic curves only. A call boundary boxes the double, so these stay
   one-liners V8 reliably inlines. */
const CV_HFG = 0, CV_RF = 1, CV_RG = 2, CV_SP = 3;
function curveA(c, sel, io, k, o){ const T = io[k], t = c.tc && (c.tab || (c.tab = curveTab(c)));
  if(t && T > CURVE_LO && T < t.hi){ const a = sel === CV_HFG ? t.hfg : sel === CV_RF ? t.rf : sel === CV_RG ? t.rg : t.sp;
    const u = (T - CURVE_LO)*t.inv, i = u|0, w = u - i; io[o] = a[i] + (a[i+1] - a[i])*w; return; }
  if(sel === CV_HFG) hfgRawA(c, io, k, o); else if(sel === CV_RF) rhofRawA(c, io, k, o);
  else if(sel === CV_RG) rhogRawA(c, io, k, o); else satPRawA(c, io, k, o); }
const hfgOf  = (c,T) => { PR[0] = T; curveA(c, CV_HFG, PR, 0, 1); return PR[1]; };
const rhofOf = (c,T) => { PR[0] = T; curveA(c, CV_RF, PR, 0, 1); return PR[1]; };
const rhogOf = (c,T) => { PR[0] = T; curveA(c, CV_RG, PR, 0, 1); return PR[1]; };
const satP   = (c,T) => { PR[0] = T; curveA(c, CV_SP, PR, 0, 1); return PR[1]; };
/* resolved once at module load, never per call (see satCurveFor) */
SAT_WATER.tab = curveTab(SAT_WATER);
/* c_p over a rise is its secant, capped at h_f where the rise crosses saturation; dT 0 is the local c_p */
const waterFig = (p, T, dT) => { const Ts = if97Tsat(p), hf = hOfT(SAT_WATER, Ts), hAt = t => t >= Ts ? hf : hOfTP(SAT_WATER, t, p);
  PR[0] = Ts; wHfgA(PR, 0, 1); const hfg = PR[1];
  return {rho: rhoMixOf(SAT_WATER, p, hAt(T)), tsat: Ts, hfg,
    cp: dT > 0 ? (hAt(T + dT/2) - hAt(T - dT/2))/dT : cpOfTP(SAT_WATER, Math.min(T, Ts), p)}; };
const coolFigs = new WeakMap();
const coolBoils = a => a.xOut != null;
/* x_out w leaves as steam and the same mass of feed mixes back into the separated water: h_in = h_f - x_out (h_f - h_feed) */
const boilFig = a => { const p = a.P0, f = waterFig(p, if97Tsat(p), 0), hf = hOfT(SAT_WATER, f.tsat);
  const hIn = hf - a.xOut*(hf - hOfTP(SAT_WATER, feedTOf(), p)), dT0 = f.tsat - tOfH(SAT_WATER, p, hIn);
  const hOut = hf + a.xOut*f.hfg;
  return {rho: rhoMixOf(SAT_WATER, p, hIn), tsat: f.tsat, hfg: f.hfg, cp: (hf - hIn)/dT0, dT0, hIn, hOut, rise: hOut - hIn}; };
/* a COOLANT row's rho kg/m3, tsat K, hfg kJ/kg, c_p kJ/kg/K, core rise dT0 K and rated enthalpy rise kJ/kg: water at its own P0 over its own rise about Tref, anything else as stated */
const coolFig = a => { let f = coolFigs.get(a); if(f && (!coolBoils(a) || f.feedT === feedTOf())) return f;
  if(coolBoils(a) && !isWater(a)) throw new Error(a.id + ": xOut needs water");
  f = coolBoils(a) ? Object.assign(boilFig(a), {feedT:feedTOf()}) : isWater(a) ? waterFig(a.P0, a.Tref, a.dT0) : {rho: a.dens*RHO_K, tsat: a.tsat, hfg: a.hfg, cp: a.cp};
  if(!coolBoils(a)){ f.dT0 = a.dT0; f.rise = f.cp*a.dT0; }
  coolFigs.set(a, f); return f; };
/* kg/s a core of this row takes at kW */
const coreRatedKgs = (a, kW) => kW/coolFig(a).rise;
/* K: a coolant's saturation temperature at p */
const coolTsat = (a, p) => isWater(a) ? if97Tsat(p) : a.tsat*Math.pow(p/a.P0, coolSatN(a));
/* off the two densities so it cannot disagree with the kilograms */
function satRvlA(c, io, k, o){ satTA(c, io, k, o); curveA(c, CV_RG, io, o, o+1); curveA(c, CV_RF, io, o, o+2); io[o] = io[o+1]/io[o+2]; }
const H_DATUM = 273.15;
/* a row whose saturation ceiling stands above its critical point has no liquid: it is a gas at any temperature */
const permGas = c => c.T0 > c.tc;
/* NIST Shomate per range [Thi, A..H]: cp J/mol/K, H - H(298.15) kJ/mol, S J/mol/K, t = T/1000; the last range runs on past its Thi */
const SHO_W = 9, SHO_NEWT = 6, SHO_IO = new Float64Array(3);
function shoCpA(c, io, k, o){ const s = c.sho, T = io[k], t = T/1000; let r = 0;
  while(r + SHO_W < s.length && T > s[r]) r += SHO_W;
  io[o] = (s[r+1] + t*(s[r+2] + t*(s[r+3] + t*s[r+4])) + s[r+5]/(t*t))/(1000*c.mmol); }
function shoHA(c, io, k, o){ const s = c.sho, T = io[k], t = T/1000; let r = 0;
  while(r + SHO_W < s.length && T > s[r]) r += SHO_W;
  io[o] = (t*(s[r+1] + t*(s[r+2]/2 + t*(s[r+3]/3 + t*s[r+4]/4))) - s[r+5]/t + s[r+6] - s[r+8])/c.mmol - c.shoH0; }
function shoSA(c, io, k, o){ const s = c.sho, T = io[k], t = T/1000; let r = 0;
  while(r + SHO_W < s.length && T > s[r]) r += SHO_W;
  io[o] = (s[r+1]*Math.log(t) + t*(s[r+2] + t*(s[r+3]/2 + t*s[r+4]/3)) - s[r+5]/(2*t*t) + s[r+7])/(1000*c.mmol); }
function shoTA(c, io, kh, o){ const h = io[kh], w = SHO_IO;
  w[0] = H_DATUM + h/c.cp;
  for(let i=0;i<SHO_NEWT;i++){ shoHA(c, w, 0, 1); shoCpA(c, w, 0, 2); w[0] -= (w[1] - h)/w[2]; }
  io[o] = w[0]; }
/* three branches off the state the node is actually in; they meet at x=0 and x=1.
   `out` is a Float64Array: a plain {x,rho,b} boxed a HeapNumber on every double write, which
   --trace-gc-object-stats showed to be the sim's single largest source of new-space garbage. */
const MX_X=0, MX_RHO=1, MX_B=2, MX_P=3, MX_H=4, MX_TS=5, MX_HF=6, MX_HFG=7, MX_TL=8, MX_MU=9, MX_RFS=10, MX_RGS=11, MX_KAP=12, MX_TC=13, MX_DH=14, MX_T=15, MX_N=16;
const MIX_IO = new Float64Array(MX_N);
const mixState = (c,p,h,out) => { const io = MIX_IO; io[MX_P] = p; io[MX_H] = h; mixA(c, io);
  out[MX_X] = io[MX_X]; out[MX_RHO] = io[MX_RHO]; out[MX_B] = io[MX_B]; return out; };
/* p and h in, x/rho/branch out, all through io: a double crossing a call that is not inlined is a heap allocation */
function mixA(c, io){
  if(isWater(c)){ mixWaterA(c, io); return; }
  const h = io[MX_H];
  satTA(c, io, MX_P, MX_TS); hOfTA(c, io, MX_TS, MX_HF); curveA(c, CV_HFG, io, MX_TS, MX_HFG);
  const Ts = io[MX_TS], hf = io[MX_HF];
  let hfg = io[MX_HFG];
  if(!(hfg>1e-6)) hfg = 1e-6;
  let x=(h-hf)/hfg; if(x<0)x=0; else if(x>1)x=1;
  io[MX_X]=x; io[MX_B]= h<=hf?0 : h>=hf+hfg?2:1;
  io[MX_TL] = Ts; io[MX_HFG] = hfg;
  if(h<=hf) mixLiqA(c, io);
  else if(h>=hf+hfg) mixVapA(c, io);
  else { satRhoA(c, io); io[MX_RHO]= 1/((1-x)/io[MX_RFS] + x/io[MX_RGS]); }
}
/* after wtEndsA(io, MX_P): the dome below pc; above it the pseudo-critical enthalpy splits liquid from steam, with no shelf */
function wDomeA(io){ const q = WQ, h = io[MX_H], hf = q[Q_HL];
  if(io[MX_P] < WATER_PC){ const hfg = q[Q_HV] - hf > 1e-6 ? q[Q_HV] - hf : 1e-6;
    let x = (h - hf)/hfg; if(x < 0) x = 0; else if(x > 1) x = 1;
    io[MX_TS] = q[Q_TS]; io[MX_HF] = hf; io[MX_HFG] = hfg; io[MX_X] = x; io[MX_B] = h <= hf ? 0 : h >= hf + hfg ? 2 : 1; return; }
  io[MX_TS] = WATER_TC; io[MX_HF] = hf; io[MX_HFG] = 1e-6; io[MX_X] = h <= hf ? 0 : 1; io[MX_B] = h <= hf ? 0 : 2; }
function mixWaterA(c, io){
  wtEndsA(io, MX_P); wDomeA(io);
  const b = io[MX_B];
  io[MX_TL] = io[MX_TS];
  if(b === 0){ wtAtHA(io, MX_H, MX_TL, 0, 0); wtAtHA(io, MX_H, MX_RHO, 1, 0); }
  else if(b === 2) wtAtHA(io, MX_H, MX_RHO, 1, 1);
  else { const x = io[MX_X]; satRhoA(c, io); io[MX_RHO] = 1/((1-x)/io[MX_RFS] + x/io[MX_RGS]); }
}
function mixLiqA(c, io){
  const p = io[MX_P], Ts = io[MX_TS];
  tLiqA(c, io); let T = io[MX_TL]; if(T>Ts)T=Ts;
  /* above its own critical temperature there is no liquid branch to be on: p/T off the design point COOLANT[].dens is quoted at */
  if(T>=c.tc || permGas(c)){ io[MX_RHO] = c.rho*(p/c.p0)*((c.Tref||c.T0)/Math.max(T,1)); return; }
  io[MX_TC] = T; curveA(c, CV_RF, io, MX_TC, MX_RFS); curveA(c, CV_SP, io, MX_TC, MX_DH);
  io[MX_RHO] = io[MX_RFS]*(1 + (BETA_W/Math.max(1e-6,c.solidK||SOLID_K_W))*Math.max(0, p - io[MX_DH]));
}
function mixVapA(c, io){
  const Ts = io[MX_TS], dh = io[MX_H] - io[MX_HF] - io[MX_HFG];
  curveA(c, CV_RG, io, MX_TS, MX_RGS);
  io[MX_RHO] = io[MX_RGS]*Ts/Math.max(Ts+dh/c.cp,1);
}
/* homogeneous (McAdams) - NOT the missing two-phase multiplier */
/* Vogel's law for liquid water (within ~2.5 % of IAPWS 2008 over 273-640 K); a coolant row that is not water keeps its stated figure */
function muLiqA(c, io){ const T = io[MX_TL];
  io[MX_MU] = c.tc === WATER_TC ? 2.414e-5*Math.pow(10, 247.8/(Math.max(T, 273) - 140)) : c.mu; }
/* both saturated densities at io[MX_TS] */
function satRhoA(c, io){ curveA(c, CV_RF, io, MX_TS, MX_RFS); curveA(c, CV_RG, io, MX_TS, MX_RGS); }
const muMixOf = (c, x) => { const mf = c.mu, mg = c.muV || c.mu;
  return x <= 0 ? mf : x >= 1 ? mg : 1/(x/mg + (1-x)/mf); };
const MIX_SCRATCH = new Float64Array(MX_N);
const rhoMixOf = (c,p,h) => mixState(c,p,h,MIX_SCRATCH)[MX_RHO];
/* K: a boiling row derives it (coolFig()) */
const coreDT0   = c => coolFig(COOLANT[(c||priD()).cool]).dT0;
/* kJ/kg from H_DATUM; the two ends of the shelf. hOfTA is the saturated line: T is a saturation temperature */
function hOfTA(c, io, k, o){ if(isWater(c)) wHlA(io, k, o); else if(c.sho) shoHA(c, io, k, o); else io[o] = c.cp*(io[k] - H_DATUM); }
function satHA(c, io, k, o){ satTA(c, io, k, o); hOfTA(c, io, o, o+1); io[o] = io[o+1]; }
function satHgA(c, io, k, o){ satTA(c, io, k, o); hOfTA(c, io, o, o+1); curveA(c, CV_HFG, io, o, o+2); io[o] = io[o+1] + io[o+2]; }
const satH  = (c,p) => { PR[0] = p; satHA(c, PR, 0, 1); return PR[1]; };
const satHg = (c,p) => { PR[0] = p; satHgA(c, PR, 0, 1); return PR[1]; };
/* NOT latent heat: the gap is the sensible rise from the feed temperature to saturation */
const hRise = (c,p) => satHg(c,p) - hOfTP(c, feedTOf(), p);
// taken as liquid: the seed, and how a pot's temperature enters the field
const hOfT  = (c,T) => { PR[0] = T; hOfTA(c, PR, 0, 1); return PR[1]; };
/* h and c_p at (T, p): water off the (p, h) table; any other coolant states one c_p */
function hOfTPA(c, io, kT, kp, o){ if(isWater(c)) wHtpA(io, kT, kp, o); else if(c.sho) shoHA(c, io, kT, o); else io[o] = c.cp*(io[kT] - H_DATUM); }
function cpOfTPA(c, io, kT, kp, o){ if(isWater(c)) wCptpA(io, kT, kp, o); else if(c.sho) shoCpA(c, io, kT, o); else io[o] = c.cp; }
const hOfTP  = (c,T,p) => { PR[0] = T; PR[1] = p; hOfTPA(c, PR, 0, 1, 2); return PR[2]; };
const cpOfTP = (c,T,p) => { PR[0] = T; PR[1] = p; cpOfTPA(c, PR, 0, 1, 2); return PR[2]; };
{ const f = waterFig(SAT_WATER.p0, SAT_WATER.T0, 0); SAT_WATER.hfg = f.hfg; SAT_WATER.rho = f.rho; SAT_WATER.cp = f.cp; }
/* kJ/kg/K at T along the liquid line; any other coolant states one figure */
function cpOfA(c, io, k, o){ if(isWater(c)) wCplA(io, k, o); else if(c.sho) shoCpA(c, io, k, o); else io[o] = c.cp; }
const cpOf  = (c,T) => { PR[0] = T; cpOfA(c, PR, 0, 1); return PR[1]; };
/* liquid entropy from Tc up to Ts, kJ/kg/K */
/* io[kh] = Ts, io[kc] = Tc in, io[o] out; io[o+1] is scratch */
function sLiqA(c, io, kh, kc, o){
  if(c.sho){ shoSA(c, io, kh, o); shoSA(c, io, kc, o + 1); io[o] = io[o] - io[o + 1]; return; }
  if(!isWater(c)){ io[o] = c.cp*Math.log(io[kh]/io[kc]); return; }
  wSlA(io, kh, o); wSlA(io, kc, o + 1); io[o] = io[o] - io[o + 1]; }
/* liquid T at io[MX_P], io[MX_H]; past the liquid's own end it reads that end */
function tLiqA(c, io){ if(isWater(c)){ wtEndsA(io, MX_P); wtAtHA(io, MX_H, MX_TL, 0, 0); } else if(c.sho) shoTA(c, io, MX_H, MX_TL); else io[MX_TL] = H_DATUM + io[MX_H]/c.cp; }
function kapA(c, io){ if(isWater(c)) wKapA(io, MX_P, MX_H, MX_KAP); else io[MX_KAP] = BETA_W/Math.max(1e-6, c.solidK || SOLID_K_W); }
/* on the shelf every enthalpy is the same temperature: io[MX_P], io[MX_H] in, io[MX_T] out */
function tOfHA(c, io){ const h = io[MX_H];
  if(isWater(c)){ wtEndsA(io, MX_P); wDomeA(io); const b = io[MX_B];
    if(b === 1) io[MX_T] = io[MX_TS]; else wtAtHA(io, MX_H, MX_T, 0, b ? 1 : 0);
    return; }
  satTA(c, io, MX_P, MX_TS); hOfTA(c, io, MX_TS, MX_HF);
  if(h <= io[MX_HF]){ tLiqA(c, io); io[MX_T] = io[MX_TL]; return; }
  curveA(c, CV_HFG, io, MX_TS, MX_HFG);
  const hg = io[MX_HF] + io[MX_HFG];
  if(!(h >= hg)){ io[MX_T] = io[MX_TS]; return; }
  io[MX_T] = io[MX_TS] + (h - hg)/c.cp; }
const TOH_IO = new Float64Array(MX_N);
const tOfH  = (c,p,h) => { const io = TOH_IO; io[MX_P] = p; io[MX_H] = h; tOfHA(c, io); return io[MX_T]; };
function xOfHA(c, io){
  if(isWater(c)){ wtEndsA(io, MX_P); wDomeA(io); return; }
  satTA(c, io, MX_P, MX_TS); hOfTA(c, io, MX_TS, MX_HF); curveA(c, CV_HFG, io, MX_TS, MX_HFG);
  const v = (io[MX_H] - io[MX_HF])/Math.max(io[MX_HFG], 1e-6); io[MX_X] = Math.max(0, Math.min(1, v)); }
function satCurveOf(cid, p0){
  if(p0 === undefined) p0 = holdSetP(coreCircOf(cid));
  return satCurveFor(COOLANT[coreD(cid).cool], p0);
}
/* off a coolant row alone: a circuit between two transfer stages has no vessel to ask */
function satCurveFor(a, p0){
  const tsat0 = coolTsat(a, p0), f = coolFig(a);
  /* same keys in the same order as SAT_WATER; Tref is the programmed temperature, as (c.Tref||c.T0) reads it */
  const c = {tc:a.tc, pc:a.pc, rhoc:a.rhoc,
             p0, T0:tsat0, n:coolSatN(a), pFloor:.05, TFloor:1,
             hfg:f.hfg, rho:f.rho, cp:f.cp, mu:a.mu, muV:a.muV, gam:a.gam || GAM_VAP,
             solidK:a.solidK, hFilm:a.hFilm,
             Tref:Math.min(a.Tref, tsat0), burn:a.burn, sho:a.sho || null, mmol:a.mmol, shoH0:0, tab:null};
  if(c.sho){ PR[0] = H_DATUM; shoHA(c, PR, 0, 1); c.shoH0 = PR[1]; }
  /* the table rides on the curve, never through the WeakMap per call: the miss
     paths below call mixState() ~1000x a tick and each resolution cost a box */
  c.tab = curveTab(c);
  return c;
}
/* does this circuit say what is in it and what it sits at; everything else is water at the shell's design pressure */
const circAuthored = ci => ci >= 0 && ci !== null && ci !== undefined
  && (nodeGraph().coreCircs[ci] === 1 || !!circCoolTank(ci));
const circCool = ci => { if(!(ci >= 0)) return null;
  const c = coreOnCirc(ci)[0]; if(c) return COOLANT[coreD(c).cool];
  const h = circCoolTank(ci); return h ? COOLANT[D.tanks[h].cool] : null; };
/* a HOLD tank first, so where there is one the fluid and the setpoint name the part circKey() keys on; any tank may still state what is in its circuit */
const circCoolTankOf = ci => {
  const named = id => D.tanks[id] && D.tanks[id].cool != null;
  const hold = holdOnCirc(ci);
  for(let i=0;i<hold.length;i++) if(named(hold[i])) return hold[i];
  const all = tankIds();
  for(let i=0;i<all.length;i++) if(named(all[i]) && tankCircuit(all[i]) === ci) return all[i];
  return null; };
/* on the graph: satOfCirc() and holdPSuggest() both ask it per node per tick */
const circCoolTank = ci => { const slot = graphSlot("circCoolTank"), was = slot.get(ci);
  if(was !== undefined) return was;
  const out = circCoolTankOf(ci); slot.set(ci, out); return out; };
const satOfCirc = ci => {
  if(ci === null || ci === undefined || ci < 0) return SAT_WATER;
  const G = nodeGraph();
  /* memoised on the circuit itself, never on a key built out of its parts: this is asked per node per tick
     and the string was one of the sim's largest allocations */
  const slot = graphSlot("satOf"), was = slot.get(ci);
  if(G.coreCircs[ci] !== 1){
    const p0 = holdSetP(ci);
    if(was && was.h !== undefined && was.p0 === p0) return was.sat;
    const h = circCoolTank(ci); if(!h) return SAT_WATER;
    const cool = D.tanks[h].cool;
    const sat = satCurveFor(COOLANT[cool], p0);
    slot.set(ci, {h, cool, p0, sat});
    return sat;
  }
  if(typeof P !== "undefined" && P && P.coreSat && P.coreSatSig === G.sig && P.coreSat[ci]) return P.coreSat[ci];
  const p0 = holdSetP(ci);
  if(was && was.cid !== undefined && was.p0 === p0) return was.sat;
  const cid = coreOnCirc(ci)[0], sat = satCurveOf(cid, p0);
  slot.set(ci, {cid, p0, sat});
  return sat;
};
/* The design state of a primary circuit, read by the sizing guess AND by the reference solve so the two cannot price the same loop differently: a boiling row's ends are its own (coolFig()). */
const loopDesignH = ci => {
  const c = satOfCirc(ci), a = COOLANT[priD().cool], f = coolFig(a), boils = coolBoils(a);
  const hIn = boils ? f.hIn : hOfTP(c, c.Tref - f.dT0/2, c.p0);
  return {c, hIn, hOut: boils ? f.hOut : hIn + f.rise, boils};
};
/* a PART id and never a circuit index: any drawing edit renumbers those, and the key is on the snapshot */
const circKey = ci => { if(ci === null || ci === undefined || ci < 0) return null;
  const s = graphSlot("circKey"), was = s.get(ci); if(was !== undefined) return was;
  const v = coreOnCirc(ci)[0] || holdOnCirc(ci)[0] || null; s.set(ci, v); return v; };
// a NET node (folded) on any circuit with a vessel on it; nodeGraph().inCore takes the raw graph node
const netInCore = nm => nodeGraph().coreCircs[circOfNode(nm)] === 1;
const tsatSec = (p, ci) => satT(satOfCirc(ci), p);
/* the anchor P.turbC is fitted at; a board with no generator takes the core's circuit */
const steamRhoDes = () => { const id = boilerIds()[0];
  const ci = id !== undefined ? boilerCirc(id) : nodeGraph().coreCirc;
  return Math.max(1e-3, rhogOf(satOfCirc(ci), tsatSec(boilerDesignP(), ci))); };
const psatSec = (T, ci) => satP(satOfCirc(ci), T);
/* level is a volume fraction and quality a mass fraction; the one place that knows they are the same fact */
const holdSeedH = (ci, p, lvl) => { const c = satOfCirc(ci), T = satT(c, p);
  const rf = rhofOf(c,T), rg = rhogOf(c,T), f = clamp(lvl,0,100)/100;
  const x = (1-f)*rg/Math.max(f*rf + (1-f)*rg, 1e-9);
  return satH(c,p) + x*hfgOf(c,T); };
/* MPa: the coolant family's working pressure, else the highest saturated boundary on the circuit, else containment */
const holdPSuggestOf = ci => {
  { const c = coreOnCirc(ci)[0]; if(c) return COOLANT[coreD(c).cool].P0;
    if(ci === nodeGraph().coreCirc) return COOLANT[priD().cool].P0; }   // the stand-in's own circuit on a blank grid
  { const h = circCoolTank(ci); if(h) return COOLANT[D.tanks[h].cool].P0; }
  let p = 0;
  const ids = sgIds();
  for(let i=0;i<ids.length;i++) if(shellCirc(ids[i])===ci) p = Math.max(p, sgDesignP(ids[i]));
  return p || (typeof P!=="undefined" && P ? P.Pcont : 0.1);
};
/* on the graph, and re-asked once a plant exists: holdSetP() puts this on satOfCirc()'s per-node path */
const holdPSuggest = ci => {
  const slot = graphSlot("holdPSuggest"), was = slot.get(ci);
  const hasP = typeof P !== "undefined" && !!P;
  if(was && was.hasP === hasP) return was.p;
  const p = holdPSuggestOf(ci);
  slot.set(ci, {p, hasP});
  return p;
};
// the LOWEST-id hold tank states it, the same one netRef() anchors on
const holdSetP = ci => { const h = holdOnCirc(ci)[0];
  const v = h && D.tanks[h].hold && D.tanks[h].hold.p;
  return v || holdPSuggest(ci); };
/* MPa; wallSuggestMm()'s inverse */
const runRating = r => 2*(STEEL_S/((PRIMARY_K[r.k] ? COOLANT[priD().cool].pipeK : 1)))
                     * Math.max(runWallMm(r)-WALL_CORR, 0) / Math.max(runBoreMm(r), 1);
/* Barlow at the ultimate strength over Barlow at the allowable: ASME VIII-1 sets S = UTS/3.5, so a wall parts at about 3.5x its rating */
const PIPE_BURST_K = STEEL_UTS/STEEL_S;
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
  const slot = graphSlot("holdCircs"), was = slot.get(1); if(was) return was;
  const out = []; for(const id of coreIds()){ const ci = coreCircOf(id); if(ci >= 0 && out.indexOf(ci) < 0) out.push(ci); }
  if(!out.length) out.push(nodeGraph().coreCirc);
  for(const id of holdTankIds()){ const ci = tankCircuit(id);
    if(ci !== null && ci !== undefined && ci >= 0 && out.indexOf(ci) < 0) out.push(ci); }
  slot.set(1, out); return out;
}

/* the shell IS the machine's own steam face: one two-phase vessel, the feed valve and the tube leak landing on it */
const shellNode = id => { const slot=graphSlot("shellNode"), was=slot.get(id); if(was) return was;
  const nd = coreFold(id + roleIntern(ROLE.sg)[1].b);
  slot.set(id,nd); return nd; };
/* a sink's ANCHORED path is its steam side. `a` IS the machine - one vessel, the exhaust space and the pool under it, holding the ship's condensate - and `b` is the condensate nozzle in its floor. */
const condIN = pid => { const p = partOf(pid), R = p && ROLE[p.role];
  return R ? roleIntern(R).find(IN => IN.anch) : null; };
const condVesNode = id => { const IN = condIN(id); return IN ? coreFold(id + IN.a) : null; };
const condOutNode = id => { const IN = condIN(id); return IN ? coreFold(id + IN.b) : null; };
/* m3 of condensate the ship states, shared over the condensers holding it */
const condPoolVol = () => { let v = 0; for(const t of hostedTankIds()) v += D.tanks[t].vol;
  return v/Math.max(1, condSinks().length); };
/* A sink standing IN the primary is a heat exchanger in a hot leg, not a machine at a vacuum - unless a turbine exhausts into that circuit, which is a direct cycle's condenser */
const condVacuum = id => { const n = condVesNode(id); if(n === null) return false;
  const G = nodeGraph(); if(!G.inCore(n)) return true;
  const ci = G.circuit[n];
  return LAY.parts.some(p => ROLE[p.role] && ROLE[p.role].vapPath && (G.nodesOf[p.id]||[]).some(m => G.circuit[m] === ci)); };
/* the sinks that are actually at a vacuum: the one set the plant's backpressure, its pool and its disc banks are shared over */
const condSinks = () => { const slot=graphSlot("condSinks"), was=slot.get(1); if(was) return was;
  const out=condIds().filter(condVacuum); slot.set(1,out); return out; };
/* %, the commissioning fill the ship states for its condensate */
const condFill0 = () => { const h = hostedTankIds(); if(!h.length) return 50;
  let v = 0, f = 0; for(const t of h){ v += D.tanks[t].vol; f += D.tanks[t].vol*D.tanks[t].level; }
  return v > 0 ? f/v : 50; };
/* the operator's drain, kg/s at a full pool: HOT_DUMP's own rate, now a real opening */
const condDumpKgs = () => HOT_DUMP/100*condPoolVol()*TANK_RHO;
/* mm; a sink past atmospheric has relieved through its disc bank, and a bank is sized off what it protects: the ship's bypass steam, its share, choked at COND_ATM at that steam's own density */
const condVentBore = id => { const ci = circOfNode(condVesNode(id)),
        w = ((typeof P !== "undefined" && P && P.steamRef) || plantSteam())/Math.max(1, condSinks().length),
        rho = rhogOf(satOfCirc(ci), tsatSec(COND_ATM, ci)),
        area = w/(ORIF_CD*Math.sqrt(2*Math.max(rho,1e-3)*gasDpEq(GAM_VAP, COND_ATM, 0)*1e6));
  return isFinite(area) && area > 0 ? Math.sqrt(4*area/Math.PI)*1000 : FIT_BORE0; };
// rated leak, % of loop inventory per second at the design differential
const SGTR_RATE = 0.30;

/* `act` a full tank's radiation source, `boron` pcm per 1 % of loop inventory pushed in, `temp` K and DISPLAY ONLY */
const FLUID = {
  water:        {label:"WATER",        act:0, boron:0,   temp:310, dens:1000},
  borated:      {label:"BORATED",      act:0, boron:100, temp:310, dens:1000},
  condensate:   {label:"CONDENSATE",   act:0, boron:0,   temp:320, dens:1000},
  contaminated: {label:"CONTAMINATED", act:1, boron:0,   temp:400, dens:1000},
  helium:       {label:"HELIUM",       act:0, boron:0,   temp:300, dens:11},   // 7 MPa, 300 K
  co2:          {label:"CO2",          act:0, boron:0,   temp:300, dens:13.95}, // 0.79 MPa, 300 K, ideal gas
};

/* the auto rules a tank can take, by label; eTankRuleLive() asks them */
const AUTORULE = {
  manual: {label:"MANUAL ONLY"},
  always: {label:"ALWAYS OPEN"},
  sglow:  {label:"LOW SG LEVEL"},
  plow:   {label:"LOW LOOP PRESSURE"},
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
const tankIds   = () => { const slot=graphSlot("tankIds"), was=slot.get(1); if(was) return was;
  const out=Object.keys(D.tanks); slot.set(1,out); return out; };
/* a hold tank is not a store: ledgerKg() has no column for its pool */
const secTankIds= () => { const slot=graphSlot("secTankIds"), was=slot.get(1); if(was) return was;
  const out=tankIds().filter(id=>tankSecondary(id) && !D.tanks[id].hold); slot.set(1,out); return out; };
/* a tank with no cell is HOSTED, the way a hotwell lives inside its condenser */
const hostedTankIds = () => { const slot=graphSlot("hostedTankIds"), was=slot.get(1); if(was) return was;
  const out=tankIds().filter(id=>!D.tanks[id].cell); slot.set(1,out); return out; };
/* off what is IN them, never off a name */
const boronTankIds = () => { const slot=graphSlot("boronTankIds"), was=slot.get(1); if(was) return was;
  const out=tankIds().filter(id=>tankPrimary(id) && tankFluid(id).boron>0); slot.set(1,out); return out; };
/* kg off the tank's own volume, never where it is piped */
const tankKg = id => { const t = D.tanks[id], fl = FLUID[t.fluid]; return t.vol*((fl && fl.dens) || TANK_RHO); };
const tankFluid = id => FLUID[D.tanks[id].fluid] || FLUID.water;
/* the gas space the commissioning fill leaves, as a share of the WHOLE vessel; a tank left full has none and is ordinary water */
const tankVoidFrac = id => { const t = D.tanks[id];
  return t ? Math.max(0, (100-clamp(t.level,0,100))/100) : 0; };
const tankGasV0 = id => { const t = D.tanks[id]; return t ? t.vol*tankVoidFrac(id) : 0; };
/* whose water is in s.mBy: an ordinary vessel on the core's circuit. An `inf` tank is a boundary and a secondary tank is still its own pool (step.js), and both keep a book of their own. */
const tankInField = id => { const t = D.tanks[id];
  return !!t && !t.hold && !t.inf && !!t.cell && tankPrimary(id); };
/* A DRUM is a two-phase vessel in the field with a vapour path off it: level under full, no gas charge, and a line reaching a turbine. Asked of the drawing through pipeTrace(), never pipeMap(), because runKindFor() asks isDrum() and naming inside the trace would be that cycle. */
/* the walk is its own, not throughFitting(): that one asks pumpResOf(), which asks isDrum(), which is this */
const drumSteams = tid => { const seen = {[tid]:1}, stack = [tid];
  while(stack.length){ const id = stack.pop();
    for(const c of pipeTrace().conns){
      const o = c.a === id ? c.b : c.b === id ? c.a : null;
      if(o == null || seen[o]) continue;
      const p = partOf(o); if(!p) continue;
      if(p.role === "turb") return true;
      seen[o] = 1;
      if(p.role === "fitting") stack.push(o); } }
  return false; };
const drumIds = () => { const slot = graphSlot("drumIds"), was = slot.get(1); if(was) return was;
  const out = tankIds().filter(id => { const t = D.tanks[id];
    return tankInField(id) && !t.gas && clamp(t.level,0,100) < 100 && drumSteams(id); });
  slot.set(1, out); return out; };
const isDrum = id => drumIds().indexOf(id) >= 0;
/* Where the recirculating loop ENDS on a direct cycle: the far node of a drum's steam line, and the loop-side face of the valve in its feed line. `valve` is that fitting, with the two faces of its own gate. */
function drumFence(){
  const slot = graphSlot("drumFence"), was = slot.get(1); if(was) return was;
  const out = {loop:{}, feed:{}, valve:{}, any:false};
  const conns = drumIds().length ? pipeMap().conns : [];
  const ends = c => [[c.a, c.b, c.sa, c.sb], [c.b, c.a, c.sb, c.sa]];
  /* where a drum's feed may land: the drum, or the pump suction its downcomer reaches */
  const mix = {};
  for(const c of conns) for(const [a, b, fa, fb] of ends(c)){
    if(!isDrum(a)) continue;
    mix[coreFold(a + fa)] = a;
    const q = partOf(b);
    if(c.k === "cold" && q && roleHead(q.role)) mix[coreFold(b + fb)] = a; }
  for(const c of conns){
    for(const [m, b, fm, fb] of ends(c)){
      const a = mix[coreFold(m + fm)]; if(a === undefined) continue;
      const p = partOf(b); if(!p) continue;
      if(c.k !== "feed" && !(c.k === "steam" && m === a)) continue;
      /* the RAW face the line lands on, because a cut is checked against the graph's own node names and a fold is not one */
      out.loop[b + fb] = 1; out.any = true;
      if(c.k === "feed") out.feed[b + fb] = 1;
      if(c.k !== "feed" || p.role !== "fitting" || fitModeOf(b) === "tee") continue;
      const IN = roleIntern(ROLE.fitting)[0];
      const n = coreFold(b + fb), l = coreFold(b + IN.a), r = coreFold(b + IN.b);
      out.valve[b] = {id: a, in: n, out: n === r ? l : r, dir: n === r ? 1 : -1}; } }
  slot.set(1, out); return out;
}
/* the drums a part's own node reaches from OUTSIDE the fence: what makes a pump a feed pump on a direct cycle */
function drumFedFrom(node, dead){
  const F = drumFence(); if(!F.any) return [];
  const G = nodeGraph(), seen = G.reach([node], F.loop, false, dead), out = [];
  for(const fid in F.valve){ const v = F.valve[fid];
    if(seen[v.out] && out.indexOf(v.id) < 0) out.push(v.id); }
  return out;
}
/* the nodes of ci the water RECIRCULATES round: everything but what is past a drum's steam nozzle or its feed valve. null on a plant with no drum, where the circuit is the loop. */
function loopNodes(ci){
  const F = drumFence(); if(!F.any) return null;
  const slot = graphSlot("loopNodes"), was = slot.get(ci); if(was) return was;
  const G = nodeGraph(), seeds = [];
  for(const cid of coreIds()) for(const n of (G.nodesOf[cid]||[])) if(G.circuit[n] === ci) seeds.push(n);
  const seen = G.reach(seeds, F.loop), out = new Set();
  for(const n in seen) out.add(coreFold(n));
  slot.set(ci, out); return out;
}
/* the node the FEEDWATER stands in before it reaches a drum: the outboard face of that drum's own regulating valve, where the heaters land */
const drumFeedNode = id => { const F = drumFence();
  for(const fid in F.valve) if(F.valve[fid].id === id) return F.valve[fid].out;
  return null; };
/* a RUN is on the loop only when both its ends are: the steam line has the drum at one end and the header at the other */
const inLoop = (ci, nm) => { const set = loopNodes(ci); if(!set) return true;
  const rk = runKeyOfNode(nm);
  if(!rk) return set.has(nm) || (CORE_LOOP_MARK.indexOf(nm.slice(-1)) >= 0 && set.has(coreFold(nm.slice(0, -1))));
  const e = runNodeEnds(rk);
  return !!e && set.has(coreFold(e[0])) && set.has(coreFold(e[1])); };
const tankStores = id => { const t = D.tanks[id];
  return !!t && !t.hold && !t.inf && !!t.gas && tankGasV0(id) > 0; };
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

/* the FLOOR, not the whole answer: the air in-leakage limit alone, so it sits BELOW the design point (COND_DT0) */
const COND_P0 = 0.004;

/* a vapour-bound pump is still turning, so it keeps a fifth of its head; nothing measured says a fifth */
const CAV_DERATE = 0.8;
/* shutoff head is (1+PUMP_DROOP) of stated duty; the droop is the casing's own resistance, in the matrix */
const PUMP_DROOP = 0.25;
/* a passage sized to pass the machine's OWN rated duty against CASING_F of the reference friction head; measured against PUMP_H0 and not the machine's own head, because a casing's loss follows what it swallows */
let CASING_F = 0.05;
const dutyC = (q, rho) =>
  Math.max(q,0)/Math.sqrt(2*Math.max(rho||700,1)*CASING_F*PUMP_H0*1e6);
/* the passage costing PUMP_DROOP of the stated head at the stated flow, at the suction's own density; not dutyC, which is a fitted passage */
const pumpCasingC = (h, q, rho) =>
  Math.max(q,0)/Math.sqrt(2*Math.max(rho||700,1)*PUMP_DROOP*Math.max(h,1e-3)*1e6);
/* this shell's share of what the plant raises; water on every plant, whatever the primary is */
const feedTrainC = () => dutyC(P.steamRef/Math.max(boilerCount(),1), waterFig(sgDesignP(), feedTOf(), 0).rho);
/* asked of the DRAWING: a pump that draws on a tank is a reserve train and has a discharge check valve */
const pumpStandby = id => pumpResOf(id).length > 0;

/* one name for a fitting's internal edge */
const fitEdgeKey = fid => "comp:" + fid + ":lr";
/* the fitting modes that carry an internal edge; a tee is one node and has none */
const FIT = {throttle:1, relief:1};

/* a lift is about the pressure AT THE VALVE: the upstream end of its own gated edge, null where nothing routed */
function reliefNodeOf(net, fid){
  for(let e=0;e<net.edges.length;e++)
    if(net.edges[e].fit === fid) return net.name[net.edges[e].u];
  return null;
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
/* a run's own node name and the reverse, structural on the key alone - cached on the graph (graphSlot()) so a run per node per tick reads a field, not a concat/slice */
const runNodeOf = key => { const slot=graphSlot("runNodeOf"), was=slot.get(key); if(was) return was;
  const nd = RUN_PRE + key; slot.set(key,nd); return nd; };
const runKeyOfNode = nid => { const slot=graphSlot("runKeyOfNode"), was=slot.get(nid); if(was!==undefined) return was;
  const rk = nid.indexOf(RUN_PRE) === 0 ? nid.slice(RUN_PRE.length) : null;
  slot.set(nid,rk); return rk; };
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
/* a tube core has no plenum: each loop's channels are their own, so a tube core piped into several loops is one water node per loop. Loop k > 0 is the core's id and one mark, so a reader that slices a face off a node name still finds the core. */
const CORE_LOOP_MARK = "¹²³⁴⁵⁶⁷⁸⁹";
/* {n, byKey}: how many loops the core's water is split into, and which one each run landing on it belongs to; a run no loop claims (an injection line) lands on the first */
function coreLoops(cid){
  const slot = graphSlot("coreLoops"), was = slot.get(cid); if(was) return was;
  const out = {n:1, byKey:{}}, c = coreD(cid);
  if(c && c.tube){
    const L = loopMap().partLoop, seen = [];
    for(const r of pipeMap().conns){
      const far = r.a === cid ? r.b : r.b === cid ? r.a : null; if(far == null) continue;
      const l = L[far]; if(l === undefined) continue;
      if(seen.indexOf(l) < 0) seen.push(l);
      out.byKey[r.key] = l; }
    seen.sort((a, b) => a - b);
    for(const k in out.byKey) out.byKey[k] = Math.min(seen.indexOf(out.byKey[k]), CORE_LOOP_MARK.length);
    out.n = Math.max(1, Math.min(seen.length, CORE_LOOP_MARK.length + 1)); }
  slot.set(cid, out); return out;
}
const coreLoopNode = (cid, k) => k ? cid + CORE_LOOP_MARK[k-1] : coreFold(cid);
/* the node a run's end lands on: a split core's own loop, every other face its fold */
const runEndNode = (key, raw) => { const p = partOf(raw.slice(0, -1));
  if(!p || p.role !== "core") return coreFold(raw);
  const L = coreLoops(p.id); return L.n > 1 ? coreLoopNode(p.id, L.byKey[key] || 0) : coreFold(raw); };
/* a part's four folded face nodes, structural (the drawing, not the tick) - cached on the graph (graphSlot()) so a face lookup per part per tick is a property read, not a concat and a fold */
const partFaceNode = id => { const slot=graphSlot("faceNode"), was=slot.get(id); if(was) return was;
  const out={t:coreFold(id+"t"), r:coreFold(id+"r"), b:coreFold(id+"b"), l:coreFold(id+"l")};
  slot.set(id,out); return out; };
/* a machine's own opening keys - structural, one per id, cached on the graph (graphSlot()) */
const breakKeyOf = id => { const slot=graphSlot("breakKey"), was=slot.get(id); if(was) return was;
  const k="break:"+id; slot.set(id,k); return k; };
const ventKeyOf = fid => { const slot=graphSlot("ventKey"), was=slot.get(fid); if(was) return was;
  const k="vent:"+fid; slot.set(fid,k); return k; };
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
/* on the graph, beside crossTies(): layoutWarnings() asks both once a frame while the bench is up */
const selfRuns = () => { const slot=graphSlot("selfRuns"), was=slot.get(1); if(was) return was;
  const out=selfRunsRaw(); slot.set(1, out); return out; };
function selfRunsRaw(){
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
/* net.vapour's structural answer, asked by node id so a view never has to test a run's kind name */
function netVapourAt(nid){
  const net = P && P.net;
  if(!net || !net.vapour) return false;
  const i = net.index[nid];
  return i !== undefined && !!net.vapour[i];
}

/* "break"/"vent"/"sgtr" are SYNTHETIC edge kinds netEdges() invents, never a run's own declared kind */
const netHole = ed => ed.kind === "break" || ed.kind === "vent" || ed.kind === "sgtr";

/* three passes, and both cuts are forced: the elevation copy and the fitTarget walk need EVERY edge to exist, and the condenser splice looks edges up by node NAME */
function netBuild(){
  const ctx = netEdges();
  return netFinish(netMaps(ctx), ctx);
}

/* pass one: nothing here reads a derived array */
function netEdges(){
  const net = pipeNetwork();
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

  /* A nozzle draws the steam off the top only where there IS a top: a vessel with a level keeps the water it separated, a tee has nowhere to put it and passes its own mixture. Asked of the part, never of the run's kind. */
  const separates = nid => { const p = partOfNode(nid), R = p && ROLE[p.role];
    return !!(R && (p.role === "sg" || p.role === "core" || R.thermal === "sink" || tankIdOf(nid))); };
  /* and the outlet below the surface hands over the water it stands in. A tank only: a shell pool is fixed and a hotwell drain is already priced at its own liquid, and a riser off the core is a mixture that must reach the drum as one. */
  const drains = nid => { const t = tankIdOf(nid);
    return !!t && D.tanks[t] && clamp(D.tanks[t].level ?? 0, 0, 100) < 100; };

  /* two half-length edges in series add their K, so the bends, the nozzles and any in-line throttle go on ONE half only */
  for(const r of net){
    const ends = runEnds(r.key, r.k);
    if(!ends) continue;
    const u = nodeIdx(runEndNode(r.key, ends[0])), v = nodeIdx(runEndNode(r.key, ends[1]));
    /* a self-connection is legal and must be INERT; a run between two DIFFERENT faces of one part is not this case */
    if(u === v) continue;
    const bore = runBore(r), Lh = r.L/2, K0 = runK0(r);
    const tid = tankIdOf(ends[0]) || tankIdOf(ends[1]);
    const mid = nodeIdx(runNodeOf(r.key));
    /* one key names the run, and exactly one half is the METER, or a reader summing over a key reads a series pair as twice the flow */
    const ea = {u, v: mid, kind: r.k, key: r.key, end: r.pa, chokeAt: mid, tid: tid||null, bore, llen: Lh, k0: K0};   // LABEL: kind carried for rendering/lookup, never re-compared here
    const eb = {u: mid, v, kind: r.k, key: r.key, end: r.pb, chokeAt: mid, meter: false, tid: tid||null, bore, llen: Lh, k0: 0};
    ea.pair = eb;   // the meter half holds its far half, so "what crosses this pipe" can ask both
    /* the water in the pipe has mass, so the flow through it cannot be changed for nothing: L/A, off the SAME length and area the friction law is priced on */
    ea.I = eb.I = Math.max(Lh, NET_COMP_LEN)/areaOf(bore);
    /* a vapour run off a two-phase vessel is a SEPARATOR: it draws the steam, never the drum's mixture */
    if(edgeLaw(r) === LAW_VAPOUR){
      if(separates(coreFold(ends[0]))) ea.gasAt = u;
      if(separates(coreFold(ends[1]))) eb.gasAt = v; }
    if(tid){
      /* a tank's line is ordinary pipe, priced off its own drawn bore and length like every other run */
      ea.Ck = eb.Ck = 1;
      // a checked tank's line passes OUT of the tank only (flowG's diode)
      if(D.tanks[tid].check) ea.diode = eb.diode = tankIdOf(ends[0]) ? 1 : -1;
      /* a relief line takes the vessel's VAPOUR; structural, off the fitting the run lands on */
      { const at = tankIdOf(ends[0]) ? 0 : 1, far = ends[at ? 0 : 1];
        const fp = partOf(far) || partOf(far.slice(0, -1));
        if(fp && fitMode[fp.id] === "relief"){
          if(at) eb.gasAt = v; else ea.gasAt = u; } }
      if(ea.gasAt === undefined && drains(coreFold(ends[0]))) ea.liqAt = u;
      if(eb.gasAt === undefined && drains(coreFold(ends[1]))) eb.liqAt = v;
      edges.push(ea, eb);
      continue;
    }
    /* a steam line is a pipe: one graph, one relation, at each end's own density */
    ea.Ck = eb.Ck = 2;
    edges.push(ea, eb);
  }

  for(const p of LAY.parts){
    const R = ROLE[p.role];
    if(!R || !R.internal) continue;
    /* a LIST: a component may carry more than one path that does NOT join up inside it */
    for(const IN of (Array.isArray(R.internal) ? R.internal : [R.internal])){
    /* coreFold() BEFORE nodeIdx(), or a tee's two ends are two nodes and the self-loop test below never fires */
    const ua = nodeIdx(coreFold(p.id+IN.a));
    const ub = nodeIdx(coreFold(p.id+IN.b));
    if(ua === ub) continue;
    const edge = {u: ua, v: ub, kind: IN.kind, key: "comp:"+p.id+":"+IN.a+IN.b,
                  I: partPathI(p.id, IN), Ck: 0, Cdead: p.id, pump: null};
    let c0 = compC(IN.K, IN.vap ? 1 : pathBoreMm(p.id, IN)/BORE_REF);
    /* per FACE and not per edge: a shell path is water at the feed nozzle and steam at the steam nozzle */
    if(IN.vap){ edge.vapU = IN.vap.indexOf("a")>=0;
                edge.vapV = IN.vap.indexOf("b")>=0; }
    /* a fitting's internal path, priced off its own bore by its mode */
    if(IN.gate){
      if(!FIT[fitModeOf(p.id)]) continue;       // a mode with no edge (tee) - already skipped above
      const bore = fitBoreK(p.id);
      edge.Ck = 3; edge.gateMode = fitModeOf(p.id); edge.pid = p.id; edge.bore = bore;
      edge.gateIds = [p.id];
      edge.fit = p.id;
      edge.key = fitEdgeKey(p.id);
      /* a drum has no feed nozzle of its own, so its regulating valve is the fitting in its feed line: the same gate, the same check valve and the same C a shell's own feed path carries */
      const dv = drumFence().valve[p.id];
      if(dv){ const did = dv.id;
        edge.shellOf = did; edge.shellSign = dv.dir; edge.diode = dv.dir;
        edge.Ck = 4; edge.freg = did; }
    }
    /* one regulating valve per generator: one pump on a shared header cannot hold two shells at level against their own secP() spread */
    if(R.sgtr && IN === roleIns(p)[1]){
      edge.shellOf = p.id;
      edge.Ck = 4; edge.freg = p.id;
      /* a feedwater check valve, which every real generator has and for this reason: without one a shell above its own feed header blows down through the nozzle, and a shell that empties backwards takes the heaters with it - the water arriving is then the shell's own and there is no bleed to take */
      edge.diode = 1;
    }
    if(IN.head){
      /* signed a -> b by the CASING and nothing else, so a pump plumbed backwards pumps backwards; a part no run reaches carries no head */
      const routed = net.usage && (net.usage[p.id+"t"]||net.usage[p.id+"b"]||net.usage[p.id+"l"]||net.usage[p.id+"r"]);
      if(routed) edge.pump = p.id;
      /* the casing is priced off the RATIO the machine states, head per rated kg/s, so the runout multiple is the same for every pump on the grid. The density is the DESIGN one and it is taken once: a passage is a geometry, and read live off F.rho it never cancelled the donor's own F.rhoD in the flow law - a suction that flashed then priced the casing at vapour and passed the law liquid, and the pump became a hole (measured: a feed pump at 23 202 kg/s against a 636 rating, its suction at -0.15 MPa). */
      { const c = circOfNode(coreFold(p.id + IN.a));
        c0 = pumpCasingC(pumpHead(p.id), pumpFlow(p.id), circDesRho(c, false, 0)); }
      edge.Ck = 0;
      /* standby and feed pumps only: a coolant or circ pump with a diode welds its loop shut against natural circulation */
      if(pumpStandby(p.id) || pumpBounds(p.id).shell) edge.diode = 1;
    }
    if(edge.Ck === 0) edge.Cc = c0;
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
    const vc = pipeC(fitBoreK(fid), NET_COMP_LEN);
    edges.push({u: open, v: reliefContNode(fid), Ck: 0, Cc: vc,
                kind: "vent", key: "vent:"+fid});   // LABEL: synthetic kind, for the z-pass below
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
      edges.push({u: um, v, Ck: 7, cx: x, cy: y, hC,
                  kind: "break", sec, steam, key: "break:"+r.key});
    }
    /* a wrecked nozzle valve is one more opening on the same run, discharging at ITS OWN cell */
    for(const pid of [r.pa, r.pb]){
      const c = portCell(pid); if(!c) continue;
      const v = contNode("port:"+pid);
      breakIds.push(v);
      contZ[v] = zRow(c[1]);
      contCell[v] = c;
      edges.push({u: um, v, Ck: 8, pid, hC,
                  kind: "break", sec, steam, key: "break:"+r.key});
    }
  }
  /* the shaft WORK crossing this edge is charged in the enthalpy (turbDh, step.js), never as a head here, or the energy leaves twice */
  for(const p of LAY.parts){
    const R = ROLE[p.role]; if(!R || !R.vapPath) continue;
    const ua = nodeIdx(coreFold(p.id+R.vapPath.a)), ub = nodeIdx(coreFold(p.id+R.vapPath.b));
    if(ua === ub) continue;
    edges.push({u: ua, v: ub, Ck: 5, pid: p.id, kind: "vap",
                key: "vap:"+p.id, machine: p.id, work: !!R.vapPath.work,
                vapU: true, vapV: true});
  }
  /* one tube-rupture edge and one opening per generator, both g exactly 0 until that generator is hit */
  const secTIds = [], secTParts = [];
  for(const q of LAY.parts) if(ROLE[q.role] && ROLE[q.role].sgtr){
    const id = q.id, v = nodeIdx(shellNode(id));
    edges.push({u: nodeIdx(id+"b"), v, Ck: 6, pid: id,
                kind: "sgtr", key: "sgtr:"+id});
    /* registered whether or not a steam run routed: it STORES, so its row solves with no edges at all, which is a generator pressurising onto its own safeties */
    secTIds.push(v); secTParts.push(id);
    /* a burst or wrecked shell is an opening like any other vessel's, and the only way out of a vessel in the field is an EDGE */
    { const c = contNode("sg:"+id);
      breakIds.push(c);
      contZ[c] = zFace(q, "b");
      contCell[c] = [q.x+((q.w/2)|0), q.y+q.h-1];
      edges.push({u: v, v: c, Ck: 9, pid: id,
                  kind: "break", sec: 1, key: "break:"+id}); }
  }

  /* a sink is an ordinary vessel: the exhaust space and the pool under it are ONE node, and the condensate nozzle in its floor is the other */
  const condVIds = [], condParts = [];
  for(const q of LAY.parts){ const IN = condIN(q.id); if(!IN) continue;
    const id = q.id, va = nodeIdx(condVesNode(id)), vb = nodeIdx(condOutNode(id));
    if(va === vb) continue;
    condVIds.push(va); condParts.push(id);
    /* one opening, three causes: a wrecked machine is a breach, a lost vacuum has burst its discs, and the operator's drain is a duty-sized hole */
    { const c = contNode("cond:"+id);
      breakIds.push(c);
      contZ[c] = zFace(q, "b");
      contCell[c] = [q.x+((q.w/2)|0), q.y+q.h-1];
      edges.push({u: va, v: c, kind: "break", sec: 1, key: "break:"+id, Ck: 10, pid: id}); }
  }

  /* the vessel's own opening; a split core opens every loop's water */
  for(const cid of coreIds()){ const v = contNode(cid), q0 = byId[cid];
    breakIds.push(v);
    contCell[v] = [q0.x+((q0.w/2)|0), q0.y+((q0.h/2)|0)];
    for(let k=0;k<coreLoops(cid).n;k++)
      edges.push({u: nodeIdx(coreLoopNode(cid, k)), v, Ck: 11, pid: cid,
                  kind: "break", key: "break:"+cid}); }
  /* a WRECKED vessel gets a second opening at its own FLOOR, so the column keeps pushing after the pressures equalise; two edges, because net.z is settled at build time and damage is live */
  for(const cid of coreIds()){ const q = byId[cid], v = contNode(cid+":floor");
    breakIds.push(v);
    contZ[v] = zFace(q, "b");
    contCell[v] = [q.x+((q.w/2)|0), q.y+q.h-1];
    for(let k=0;k<coreLoops(cid).n;k++)
      edges.push({u: nodeIdx(coreLoopNode(cid, k)), v, Ck: 12, pid: q.id,
                  kind: "break", key: "break:"+cid}); }

  /* a torn channel is two holes of the tube's bore over the share the core has opened; once the shield is off the open face is the one breach figure. Each loop's water owns its share of the channels. */
  const cavIds = [], cavCont = {}, cavVol = {};
  for(const cid of coreIds()){ const c = coreD(cid), q0 = byId[cid]; if(!c || !c.tube || !q0) continue;
    const cav = nodeIdx("cav:"+cid), v = contNode("cav:"+cid), nl = coreLoops(cid).n;
    breakIds.push(v); contCell[v] = [q0.x+((q0.w/2)|0), q0.y+((q0.h/2)|0)];
    cavIds.push(cav); cavCont[cid] = v; cavVol[cav] = cavVolM3(c);
    const one = 2*holeC(tubeBoreMm(c)/BORE_REF), n = tubeCount(c), relief = cavReliefC(cid, c, one);
    for(let k=0;k<nl;k++)
      edges.push({u: nodeIdx(coreLoopNode(cid, k)), v: cav, Ck: 13, pid: cid, cavN: n/nl, cavOne: one,
                  kind: "cav", key: "cav:"+cid});   // LABEL: synthetic kind, a channel's two ends
    edges.push({u: cav, v, Ck: 14, pid: cid, cavRelief: relief,
                kind: "break", key: "break:cav:"+cid}); }

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
    edges.push({u: nodeIdx(id), v, Ck: 15, pid: id, kind: "break", key: "break:"+id});
  }

  /* one hidden class for every edge: the literals above build ~21 shapes (and more on other plants),
     and the churn deoptimizes every hot function per solve (wrong-map). Re-keying in one canonical
     order at build costs nothing per tick; every later assignment only writes existing keys.
     Missing keys stay undefined, which every reader already treats as absent. */
  for(const ed of edges){
    const v0=ed.u, v1=ed.v, v3=ed.Ck, v4=ed.Cc, v5=ed.Cdead, v10=ed.kind, v11=ed.key,
          v12=ed.end, v13=ed.chokeAt, v14=ed.meter, v15=ed.pair, v16=ed.I,
          v17=ed.diode, v18=ed.gasAt, v19=ed.liqAt, v20=ed.tid, v21=ed.bore,
          v22=ed.llen, v23=ed.k0, v24=ed.pid, v25=ed.freg, v26=ed.gateMode,
          v27=ed.gateIds, v28=ed.fit, v29=ed.shellOf, v30=ed.shellSign,
          v31=ed.cx, v32=ed.cy, v33=ed.hC, v34=ed.cavN, v35=ed.cavOne,
          v36=ed.cavRelief, v37=ed.pump, v38=ed.vapU, v39=ed.vapV,
          v40=ed.poolAt, v41=ed.sec, v42=ed.steam, v43=ed.machine,
          v44=ed.work;
    for(const k in ed) delete ed[k];
    ed.u=v0; ed.v=v1; ed.Ck=v3; ed.Cc=v4; ed.Cdead=v5; ed.kind=v10; ed.key=v11;
    ed.end=v12; ed.chokeAt=v13; ed.meter=v14; ed.pair=v15; ed.I=v16;
    ed.diode=v17; ed.gasAt=v18; ed.liqAt=v19; ed.tid=v20; ed.bore=v21;
    ed.llen=v22; ed.k0=v23; ed.pid=v24; ed.freg=v25; ed.gateMode=v26;
    ed.gateIds=v27; ed.fit=v28; ed.shellOf=v29; ed.shellSign=v30;
    ed.cx=v31; ed.cy=v32; ed.hC=v33; ed.cavN=v34; ed.cavOne=v35;
    ed.cavRelief=v36; ed.pump=v37; ed.vapU=v38; ed.vapV=v39;
    ed.poolAt=v40; ed.sec=v41; ed.steam=v42; ed.machine=v43;
    ed.work=v44; ed.i=undefined;
  }

  return {runs: net, byKey, byId, partOfNode, tankIdOf, nodes, index, coreNode, edges,
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
  const coreSet = new Set();
  for(const q of coreIds()) for(let k=0;k<coreLoops(q).n;k++){ const i = index[coreLoopNode(q, k)]; if(i !== undefined) coreSet.add(i); }
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

  const net2 = {nodes, index, edges, core: coreNode, n: nodes.length, byKey, fitIds, fitMode,
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
  for(const q of coreIds()) for(let k=0;k<coreLoops(q).n;k++){ const i = index[coreLoopNode(q, k)];
    if(i === undefined) continue;
    if(!k) net2.coreNodes[q] = i;
    net2.coreOfNode[i] = q; }
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
    /* the vessel IS the hotwell: the ship's stated pool, this machine's share, full at level 100. A sink in the primary holds no condensate and takes the partVol() share every other machine takes. */
    { const v = condPoolVol();
      for(const id of ctx.condParts){ if(!condVacuum(id)) continue;
        const i = index[condVesNode(id)];
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
        fitMode = ctx.fitMode, secTIds = ctx.secTIds, secTParts = ctx.secTParts,
        partOfNode = ctx.partOfNode;

  /* the ONE edge the pool's own column stands on: the drop from the water surface to the condensate nozzle in the vessel's floor. The exhaust nozzle is over the water and sees none of it. */
  for(let k=0;k<net2.condParts.length;k++){
    const ed = edges.find(e => e.key === "comp:"+net2.condParts[k]+":"+condIN(net2.condParts[k]).a+condIN(net2.condParts[k]).b);
    if(ed) ed.poolAt = net2.condV[k]; }
  /* poolH()'s part, resolved once: the per-tick slice plus lookup this replaces */
  net2.poolPart = {};
  for(let k=0;k<net2.condV.length;k++){ const i = net2.condV[k];
    net2.poolPart[i] = partOfNode(net2.name[i]) || null; }

  /* STRUCTURAL: a node every edge touching it reaches through vapour is a steam space, and nothing is named */
  // the nodes a steam nozzle draws on, so the field prices a vapour density for those and no others
  net2.gasNodes = [...new Set(edges.filter(ed => ed.gasAt !== undefined).map(ed => ed.gasAt))];
  net2.liqNodes = [...new Set(edges.filter(ed => ed.liqAt !== undefined).map(ed => ed.liqAt))];
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

  for(let i=0;i<edges.length;i++) edges[i].i = i;

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

/* simTick()'s literal 0.02, named: a compliance is per SECOND, so a storage term is the one place that has to know how long a tick is */
const NET_DT = 0.02;
/* per MPa: COOLANT[].solidK is beta over kappa, BETA_W is beta. A gas is exactly 1/p, and a two-phase node is the mass-weighted mixture of the two */
const SOLID_K_W = COOLANT[0].solidK;
const NET_PMAX = 200;   // a node holding more than any pressure can account for is pinned, not solved


/* 1/K, the volumetric expansion of pressurised water near 300 C; PHYSICAL, not fitted */
const BETA_W = 0.0025;



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
// the same two rates combatHit() weighs a component's hull cells by
const HITW_BASE=0.15, HITW_HULL=1.6;

// a component pays HITW_BASE once per PART; a pipe pays it once per CELL
function runWgt(cells){
  let w=0;
  for(const [x,y] of cells)
    w += HITW_BASE + (x===0||x===GW-1||y===0||y===GH-1 ? HITW_HULL : 0);
  return w;
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
/* m3 the STOCK drum states, per loop: a real RBMK-1000 loop carries two separators of about 120 m3 each, and this preset draws them as one vessel. */
const DRUM_VOL = 240;
/* A vessel, not a machine: `mintTank()` and a plain assign, which is exactly what the bench does. What makes it a drum is the steam line off it, never this call. */
function mintDrum(id, x, y, n){
  mintTank(id, x, y);
  Object.assign(D.tanks[id], { name:"STEAM DRUM "+(n+1), col:"#5fd2e2",
    tip:"Steam leaves the loop here. The water arriving from the channels is a mixture; what separates out goes to the turbine and the rest goes back down to the pumps, so the level is what is left after the steam has gone. Feed water joins that water at the pump suction, through this drum's own regulating valve.",
    vol:DRUM_VOL, aspect:4, level:50, fluid:"water",
    gas:null, check:false, auto:"always", burst:null, tsurv:800, pburst:100 });
  buildLayout();
  return id;
}
/* `n` cells of face, nozzle `i`, `step` apart, walked out from the MIDDLE; the along-face index only - which face is still a hydraulic decision */
const faceMid = (n, i, step) => { const k = step || 1;
  return Math.floor((n-1)/2) + (i%2 ? -k*Math.ceil(i/2) : k*Math.ceil(i/2)); };
function buildStockPlumbing(opt){
  const loops = (opt && opt.loops) || 1;
  /* `inter` splices an intermediate exchanger into every loop and builds the circuit behind it: six boxes to a loop, so the wider pitch */
  const inter = !!(opt && opt.inter);
  /* `drum` puts a steam drum where the generator stands and takes the steam straight off the loop: a direct cycle. A drum holds two orders more water than a shell, so its box is that much wider and the loops stand further apart. */
  const drum = !!(opt && opt.drum);
  const PITCH = inter ? 18 : drum ? 20 : 7;
  /* the feed riser runs up UNDER the drum's own box, which follows its VOLUME - a literal would land outside it, in the next loop's lane */
  const drumW = () => drum ? partOf("drum0").w : 0;
  const riserOff = () => inter ? 3 : drum ? drumW()-4 : 5;
  /* rows in that riser, top down: the drum's floor nozzle, its regulating valve, then the reserve tie */
  const DRUM_FV_Y = 12, DRUM_TIE_Y = 16;
  // the engine room stands that much further aft: the feed pump and the reserve stand between it and the last loop
  /* a drum's box reaches most of the way to the next loop's column, and its feed riser stands one clear of that, so the engine room moves aft by the whole vessel */
  const INTER_AFT = inter ? 12 : drum ? 22 : 0;
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
  /* on a direct cycle the drum is the vessel with the bubble in it: a pressurizer would pin the pressure the governor holds, and its relief valve and tank go with it */
  const drop = new Set(((opt && opt.drop) || []).concat(drum ? ["pzr","rv0","reltk"] : [])), has = id => !drop.has(id);
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
    for(let i=0;i<loops;i++){ const li=u*loops+i;
      if(drum) mintDrum("drum"+li, uX(u,i), 5+oy, li);
      else mintMachine("sg"+li,"sg",uX(u,i),5+oy); }
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
  /* each facing nozzle needs its own cell, so the gap between the panels is two whatever area they are drawn at */
  { const r0 = partOf("rad0"), gap = partOf("rad1").x - (r0.x + r0.w);
    if(gap < 2){ D.machines.rad0.cell = [r0.x - (2 - gap), BOT+3]; buildLayout(); } }
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

  /* on the CONDENSER's outlet nozzle and never the pump's suction face: a tank a suction walk reaches is a reserve (pumpResOf) and commissions that pump stopped */
  let CWT = null;
  { const cd = partOf("cond"+sfx(0));
    if(cd) CWT = tank("cwtank","", cd.x-4, cd.y-3, { name:"CW SURGE TANK", col:"#7fb8d6",
      tip:"Takes the expansion of the circulating water as it warms, and sets the cooling loop's pressure. Without it the loop is rigid and reads whatever the compartment is at.",
      vol:10, level:60, fluid:"water",
      gas:{p0:0.6}, check:false, auto:"always", burst:null}); }

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
  const PZR_W = partOf("pzr"+U) ? partOf("pzr"+U).w : 3, RV_X = ox+18+PZR_W+2, RELTK_X = RV_X+3;
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
  const efwtee = fitting("efwtee",U, uX(u,0)+riserOff()+(multi?u:0), oy+(inter?24:drum?DRUM_TIE_Y:12), { name:"EFW TIE", mode:"tee",
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
        .concat(Array.from({length:loops},(_,i)=>(drum?"drum":"sg")+(u*loops+i)))
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
  const HOT_COL = i => X(i)+(inter?5:drum?-3:-4);
  /* one lane per feed line, walking UP as the loop index rises while the bilge rows walk DOWN, so their spans cannot meet */
  const FEED_ROW= (s,i) => partOf("feed"+sfx(s)).y+3-i;
  /* one riser column per unit: stacked units share their columns, so every riser would ask for the same lane */
  const feedCol = (u,i) => uX(u,i)+riserOff()+(multi?u:0);
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
    n.pPzrSurge= has("pzr") ? seedPort("pzr"+U,1,pzrB.h) : null;
    n.pPzrRel  = has("pzr") && has("rv0") ? seedPort("pzr"+U,pzrB.w,1) : null;
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
  /* the mixture in on the left, the downcomer out of the floor, the steam off the top; the feed water lands on the pump's suction, where it mixes with the downcomer's water before the core */
  const drumPorts = li => { const id="drum"+li, b=tankBox(id), q=partOf("pump"+li);
    return { l:     seedPort(id,-1,1),
             b:     seedPort(id,1,b.h),
             steam: seedPort(id,1,-1),
             feed:  seedPort("pump"+li,q.w,1) }; };
  /* the one legal overlap on the board is row 14: loop 0's hot leg stops at the surge tee, west of where any feed line begins */
  for(const n of UN){
    seedRun(n.pCoreHot, n.pTeeL);
    run(n.pPzrSurge, n.pTeeT);
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
    run(CWT && port(CWT,partOf(CWT).w,1), port("cond"+first.S,-1,0));
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
      const g = drum ? drumPorts(li) : sgPorts(li);
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
      /* a drum has no feed path of its own to regulate, so the valve is a FITTING in its feed line - that edge is what s.fregBy drives and what carries the check valve */
      const fv = drum ? fitting("freg"+li,"", feedCol(u,i), oy+DRUM_FV_Y,
        { name:"FEED REG VALVE "+(li+1), mode:"throttle",
          tip:"Holds this drum's level by letting through what it is boiling off. Behind it is a check valve, so a loop above its own feed header cannot blow down through the feed line." }) : null;
      const land0 = fv ? seedPort(fv,0,1) : g.feed;
      if(fv) seedRun(seedPort(fv,0,-1), g.feed);
      const riser = [[feedCol(u,i), fv ? oy+DRUM_TIE_Y+1 : FTOP]];
      if(i) seedRun(t.feedL(k), land0,
        (bandVias||[]).concat([[feedCol(u,i),bandVias?land:FEED_ROW(s,k)]]).concat(riser));
      else { seedRun(t.feedL(k), n.pTieB,
               bandVias || [[feedCol(u,0),FEED_ROW(s,k)]]);
             seedRun(n.pTieT, land0, fv ? [] : [[feedCol(u,0),FTOP]]); }
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
        ids.push((drum?"drum":"sg")+li,"pump"+li,"mstee"+li); }   // the safety valves stand outside, on the skin
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
 ["BWR/4",{loops:2,arch:1,cpump:true,cont:{m:"liner",t:20},d:{bkp:1,sg:0,chim:0.4}},
  "Two recirculation loops boiling at 7 MPa - the Fukushima Daiichi machine. Power follows flow instantly and margin to dryout is thin, so it will not forgive a flow transient the way a pressurised plant does."],
 ["BN-600",{loops:3,arch:3,cpump:true,cont:{m:"liner"},d:{bkp:2,sg:1,chim:0.4},
   place:[["pan0","pan",27,31],["pan1","pan",36,31],["inert0","inert",32,25]]},
  "Three primary sodium loops at atmospheric pressure, once-through steam generators, diesels and a large dry containment. Enormous boiling margin and a prompt lifetime forty times shorter than water - it answers a rod before you have finished moving it. It ships the cell defences a real sodium plant is built with: catch pans under the loops, so a leak runs into a drain instead of over the deck, and a nitrogen set to smother a fire the pans do not catch. The real machine has three circuits, not two: the shells sit at seventeen megapascals against a primary at atmospheric, so a tube leak drives WATER INTO SODIUM, and a real BN-600 puts an intermediate sodium loop between that reaction and the fuel. Nitrogen does nothing about that one. Splice heat exchangers in on the bench to build the machine it actually is."],
 ["EPR",{loops:4,arch:0,lat:2,cpump:true,cont:{m:"lined"},d:{bkp:2,sg:0,chim:0.3},
   place:[["catcher","catcher",8,30]]},
  "Four loops round a wide squat core, large dry containment, diesels and a core catcher. The heavy one, and the one with margin everywhere: low peaking, high DNBR, minutes of generator water after feedwater is lost."],
 ["RBMK-1000",{loops:2,arch:2,cpump:true,drum:true,d:{bkp:1,sg:1,chim:0.3}},
  "Two coolant loops through a graphite pile, motor-driven scram and no containment - because the real one had none that would hold. There is no steam generator and no pressurizer: the channels boil, a drum separates the steam and sends it straight to the turbine, the downcomers feed the pumps and the feed water joins them at the pump suction. The turbine governor holds the drum pressure, so power is set by the rods and the pumps. Boiling the water ADDS reactivity here, and drawn as the real machine is drawn the whole core boils - so it runs itself up in a second and the protection system is the only thing that catches it."],
 ["MSRE",{loops:1,arch:4,cpump:true,cont:{m:"lined"},d:{bkp:1,sg:1,chim:0.6}},
  "Molten salt through a graphite matrix at no pressure at all, one loop, once-through boiler. Almost no xenon pit and hours of grace; what it will do instead is freeze solid if you let it get cold."],
 /* Calder Hall (Nuclear Engineering, Dec. 1956): stand-by diesels (cutaway key 36), the H.P. heat exchanger steam at 210 psia, feedwater at 100 F; its L.P. drum is not drawn */
 ["CALDER HALL",{loops:1,arch:6,cpump:true,d:{bkp:2,sg:1,chim:0.2,feedT:310.9}, sgDesP:1.448,
   drop:["hpi","rv0","reltk"], tanks:{efw:{vol:5},
     pzr:{name:"CO2 STORE", hold:null, gas:{p0:0.7908}, level:50, fluid:"co2", tsurv:null, pburst:null}}},
  "Britain's first power station, 1956: a graphite pile fuelled with natural uranium metal in finned Magnox cans, cooled by CO2 at 100 psi and raising steam for two turbines. There is no containment, as built - only a steel pressure vessel inside a concrete shield - and there is no injection water and no relief valve on the gas loop. Stand-by diesels keep the blowers turning. The fuel has to stay under 669 C, where uranium changes its crystal form, and the cans must stay under 408 C."],
 /* no containment, and it is the hull that refuses it: on every band below the top one the drives stand in the row a wall would close along */
 ["DUAL",{units:2,sets:1,loops:1,arch:0,lat:1,cpump:true,d:{bkp:1,sg:0,chim:0.3}},
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
                      inter:q.inter, drum:q.drum, cpump:q.cpump, core});
  // anything this ship carries that the stock one does not, placed the same way ADD MACHINE places it
  for(const g of (q.place||[])) mintMachine(g[0],g[1],g[2],g[3]);
  for(const id in (q.tanks||{})) if(D.tanks[id]) Object.assign(D.tanks[id],q.tanks[id]);
  buildStockAutomation();
  /* a figure baked off a half-built core is not this plant's: archPreset() redraws in stages and bake() WRITES on first read, so the bags go again HERE. Bags only - q.d has already been applied */
  dTouch();
  LAY=null; layoutMetrics();             // re-fit the arrangement once, not per gesture
  /* the bags go LAST, after the last thing that can bake: cleared before layoutMetrics() they refill off the same stale rating */
  designForgetBags();
  if(q.sgDesP!=null) for(const id of roleAll("sg")) D.sgDesP[id]=q.sgDesP;
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
