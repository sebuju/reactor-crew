"use strict";
// chunks: 0 1 2 3 4 5 6 7 8
/* one preset marched 120 s in slices that each fit the 10 s budget; the state buffer and the running books carry between slices */
const fs = require("fs"), os = require("os"), path = require("path");
const {check, more, commissionPreset} = require("./lib.js");
const pre = +process.argv[2], resume = process.argv.includes("--resume");
const SECS = 120, WALL = 7000, t0 = Date.now();
const fBin = path.join(os.tmpdir(), "rc-phys-p" + pre + ".bin"), fJs = path.join(os.tmpdir(), "rc-phys-p" + pre + ".json");
const G = commissionPreset(pre);
const PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[pre][0];
let A;
if(resume && fs.existsSync(fBin)){ G.engRestore(new Uint8Array(fs.readFileSync(fBin))); A = JSON.parse(fs.readFileSync(fJs, "utf8")); }
else A = {m0:G.eLedgerKg() + G.eLedgerOut(), inv0:G.eLedgerKg(), h0:sc[G.SC_HEAT], drift:0, enAbs:0, heatDt:0, ticks:0, fp:0, cn:-1e9, sl:1e9};
const chIx = k => G.RPS_CH.findIndex(r => r[0] === k), sig = (k, a) => G.eSigRead(G.eSigCode(k), a);
const CN = chIx("cont"), SL = chIx("slp"), slOn = G.rpsOn(G.RPS_CH[SL]);
/* every fission product let go of is in the water, the room or a book */
const fpBooks = () => { let d = 0, inv = 0;
  for(let q=0;q<2;q++){ const C = q ? ST.fpVBy : ST.fpNBy, R = q ? [ST.roomFpV, ST.roomFpW] : [ST.roomFpN];
    let t = q ? sc[G.SC_FPBOOKV] : sc[G.SC_FPBOOKN], rel = 0;
    for(let i=0;i<C.length;i++){ const m = ST.mBy[i]; if(m === m) t += C[i]*m; }
    for(const F of R) for(let i=0;i<F.length;i++) t += F[i];
    for(let c=0;c<PT.n.core;c++){ rel += q ? ST.csFpRelV[c] : ST.csFpRelN[c]; inv += PT.coreFpInv[c*G.FP_N+q]; }
    d = Math.max(d, Math.abs(t - rel)); }
  return inv > 0 ? d/inv : 0; };
while(sc[G.SC_T] < SECS - 1e-9 && Date.now() - t0 < WALL){
  G.step(0.02); A.ticks++;
  A.drift = Math.max(A.drift, Math.abs(G.eLedgerKg() + G.eLedgerOut() - A.m0)); A.fp = Math.max(A.fp, fpBooks());
  A.enAbs += Math.abs(sc[G.SC_ENRES]); A.heatDt += Math.max(0, sc[G.SC_HEAT])*G.P.rated*1000*0.02;
  A.cn = Math.max(A.cn, sig("cntp", 0));
  if(!A.red) for(let r=0;r<PT.n.ann;r++) if(PT.annSev[r] === 0 && ST.annOn[r]){ A.red = G.ANN[r][0] + " at " + sc[G.SC_T].toFixed(2) + " s"; break; }
  if(slOn && sig("prsf", 0) > G.RPS_CH[SL][6].at) A.sl = Math.min(A.sl, sig("slp", -1)); }
if(sc[G.SC_T] < SECS - 1e-9){
  fs.writeFileSync(fBin, Buffer.from(G.engSnap(G.engSnapNew()))); fs.writeFileSync(fJs, JSON.stringify(A));
  more(); }
for(const f of [fBin, fJs]) if(fs.existsSync(f)) fs.unlinkSync(f);

check(name + ": mass closes over 120 s (worst |books - start| / inventory)", A.drift/A.inv0, 0, 1e-9,
  "conservation of mass: inventory + everything booked out = the commissioned inventory, every tick", {abs:true, note:A.ticks + " ticks"});
check(name + ": fission products close over 120 s (worst |water + room + booked - released| / inventory)", A.fp, 0, 1e-9,
  "conservation of mass per species: noble gas and volatiles", {abs:true});
check(name + ": energy closes over 120 s (sum |residual| / sum core heat)", A.enAbs/Math.max(A.heatDt, 1), 0, 1e-3,
  "conservation of energy on the fluid field: change in (m h - p V) + metal = sources - sinks, every tick", {abs:true});

const GAPS = {"BWR/4":"BWR/4 cycle", "BN-600":"BN-600 holds its power","RBMK-1000":"RBMK-1000 at rated power", "MSRE":"MSRE's heat balance hunts about unity"};
const gap = GAPS[name] || "";
{ const REST = "a plant at steady rated power is not tripped by its own containment or steam-line pressure (NUREG-1431 Rev. 4, Table 3.3.2-1 Functions 1.c, 1.e)";
  check(name + ": highest containment gauge pressure at rest against its near-trip point", A.cn, PT.rpsNear[CN], 0, REST,
    {abs:true, unit:"kPa", pass:A.cn < PT.rpsNear[CN], note:"trip " + PT.rpsSet[CN] + " kPa"});
  check(name + ": lowest steam-line pressure at rest, armed, against its near-trip point", slOn ? A.sl : NaN, PT.rpsNear[SL], 0, REST,
    {abs:true, unit:"of design", gap, pass:!slOn || A.sl > PT.rpsNear[SL], note:slOn ? "trip " + PT.rpsSet[SL] : "channel not fitted: no fed steam generator"}); }
check(name + ": no red annunciator over 120 s at rest, no orders given", A.red ? 1 : 0, 0, 0,
  "a commissioned plant at steady rated power sits inside its own alarm bands: an alarm is set a margin off normal operation", {abs:true, gap:A.red ? gap : "", note:A.red || "none"});
const heatMW = sc[G.SC_HEAT]*G.P.rated, rej = sc[G.SC_HBREMOVAL]*G.P.rated;
check(name + ": heat balance at 120 s (removal / core heat)", heatMW > 1 ? rej/heatMW : NaN, 1, 0.02,
  "first law at steady state: what the core makes leaves through the exchangers and panels", {gap, note:"core " + heatMW.toFixed(0) + " MW, dTavg " + sc[G.SC_DTAVG].toExponential(1) + " K/s"});
check(name + ": core heat at 120 s against commissioned, no orders given", sc[G.SC_HEAT]/A.h0, 1, 0.05,
  "a critical core at constant boundary conditions holds its power, and the plant's own controllers hold it at demand", {gap});
let Tsg = 0;
for(let b=0;b<PT.n.boiler;b++) Tsg = Math.max(Tsg, ST.sgTBy[b]);
{ const hT = sc[G.SC_TURBH], Th = hT > 0 ? G.tOfH(G.SAT_WATER, sc[G.SC_TURBP], hT) : Tsg > 0 ? Tsg : G.satT(G.P.sat, sc[G.SC_P]);
  const Tc = sc[G.SC_CONDT], eff = heatMW > 1 ? G.eMWe()/heatMW : 0, carnot = 1 - Tc/Th;
  check(name + ": thermal efficiency below Carnot of its own steam and condenser", eff, carnot, 0, "Carnot: eta < 1 - Tc/Th",
    {gap, pass:eff > 0 && eff < carnot, note:"Th " + Th.toFixed(1) + " K, Tc " + Tc.toFixed(1) + " K"}); }
const Tout = sc[G.SC_TAVG] + sc[G.SC_COREDT]/2;
if(Tsg > 0) check(name + ": core outlet above the saturation of the steam it raises", Tout, Tsg, 0,
  "second law: heat flows from the hotter stream, so a generator's steam is colder than the coolant feeding it",
  {gap, unit:"K", pass:Tout > Tsg});

/* the preset is inspired by its namesake, never a replica: judged on what its FAMILY does, never on one plant's sheet */
const FAM = G.derived().a.id, vf = sc[G.SC_VF], subc = sc[G.SC_SC], P = sc[G.SC_P];
if(FAM === "PWR"){
  check(name + ": pressurised-water core stays below saturation at the outlet", subc, 0, 0,
    "a PWR's pressure is chosen to keep the core subcooled: no bulk boiling at rated power (Todreas & Kazimi ch. 1)", {gap, unit:"K", pass:subc > 0});
  check(name + ": pressurised-water core carries no bulk void", vf, 0, 0.05,
    "a PWR core runs single-phase; subcooled boiling at the wall leaves the core-average void near zero (Todreas & Kazimi ch. 1)", {gap, abs:true}); }
else if(FAM === "BWR" || FAM === "LWGR")
  check(name + ": boiling-water core boils, and is not dry", vf, 0.425, 0.375,
    "a boiling core raises its steam in the channel (BWR core-average void ~0.4; RBMK channel exit quality ~0.14, INSAG-7) and keeps liquid on the pins", {gap, abs:true});
else if(FAM === "SFR" || FAM === "MSR"){
  check(name + ": liquid-metal or salt primary runs unpressurised", P, 0, 1.0,
    "sodium and fluoride salts boil hundreds of K above their operating temperature, so the primary needs no pressure (IAEA-TECDOC-1531; ORNL-4541)", {gap, abs:true, unit:"MPa", pass:P < 1.0});
  check(name + ": liquid-metal or salt primary sits far below its boiling point", subc, 100, 0,
    "the same: the margin to boiling is hundreds of K, never a few (IAEA-TECDOC-1531; ORNL-4541)", {gap, unit:"K", pass:subc > 100}); }
else if(FAM === "CO2"){
  const cgo = sig("cgo", 0), set = sig("cgoset", 0), rise = G.coreDT0(G.coreD(G.IX.coreId[0]));
  check(name + ": gas-cooled core holds its channel gas outlet at 120 s", cgo - set, 0, 0.02*rise,
    "a Magnox regulates its rods on channel gas outlet temperature and holds it (Trawsfynydd: designed to run at a 370 C channel gas outlet); tolerance 2 % of the core's rated rise", {gap, abs:true, unit:"K", note:"outlet " + cgo.toFixed(2) + " K, set " + set.toFixed(2) + " K"});
  check(name + ": gas-cooled core holds its excess with rods, not boron", sc[G.SC_BORON], 0, 0,
    "a gas can dissolve no boron: a Magnox holds its excess reactivity with its rods", {gap, abs:true}); }
