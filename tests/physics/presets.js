"use strict";
// chunks: 0 1 2 3 4 5 6 7 8
/* one preset marched 120 s in slices that each fit the 10 s budget; the state buffer and the running books carry between slices */
const fs = require("fs"), os = require("os"), path = require("path");
const {check, commissionPreset} = require("./lib.js");
const pre = +process.argv[2], resume = process.argv.includes("--resume");
const SECS = 120, WALL = 7000, t0 = Date.now();
const fBin = path.join(os.tmpdir(), "rc-phys-p" + pre + ".bin"), fJs = path.join(os.tmpdir(), "rc-phys-p" + pre + ".json");
const G = commissionPreset(pre);
const PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[pre][0];
let A;
if(resume && fs.existsSync(fBin)){ G.engRestore(new Uint8Array(fs.readFileSync(fBin))); A = JSON.parse(fs.readFileSync(fJs, "utf8")); }
else A = {m0:G.eLedgerKg() + G.eLedgerOut(), inv0:G.eLedgerKg(), drift:0, enAbs:0, heatDt:0, ticks:0};
while(sc[G.SC_T] < SECS - 1e-9 && Date.now() - t0 < WALL){
  G.step(0.02); A.ticks++;
  A.drift = Math.max(A.drift, Math.abs(G.eLedgerKg() + G.eLedgerOut() - A.m0));
  A.enAbs += Math.abs(sc[G.SC_ENRES]); A.heatDt += Math.max(0, sc[G.SC_HEAT])*G.P.rated*1000*0.02; }
if(sc[G.SC_T] < SECS - 1e-9){
  fs.writeFileSync(fBin, Buffer.from(G.engSnap(G.engSnapNew()))); fs.writeFileSync(fJs, JSON.stringify(A));
  process.stdout.write("@@MORE\n"); process.exit(0); }
for(const f of [fBin, fJs]) if(fs.existsSync(f)) fs.unlinkSync(f);

check(name + ": mass closes over 120 s (worst |books - start| / inventory)", A.drift/A.inv0, 0, 1e-9,
  "conservation of mass: inventory + everything booked out = the commissioned inventory, every tick", {abs:true, note:A.ticks + " ticks"});
check(name + ": energy closes over 120 s (sum |residual| / sum core heat)", A.enAbs/Math.max(A.heatDt, 1), 0, 1e-3,
  "conservation of energy on the fluid field: change in (m h - p V) + metal = sources - sinks, every tick", {abs:true});

const GAPS = {"NUSCALE":"NUSCALE primary and steam", "BWR/4":"BWR/4 cycle", "BN-600":"BN-600 steam pressure", "EPR":"EPR steam pressure", "RBMK-1000":"RBMK-1000 at rated power"};
const gap = GAPS[name] || "";
const heatMW = sc[G.SC_HEAT]*G.P.rated, rej = sc[G.SC_HBREMOVAL]*G.P.rated;
check(name + ": heat balance at 120 s (removal / core heat)", heatMW > 1 ? rej/heatMW : NaN, 1, 0.02,
  "first law at steady state: what the core makes leaves through the exchangers and panels", {gap, note:"core " + heatMW.toFixed(0) + " MW, dTavg " + sc[G.SC_DTAVG].toExponential(1) + " K/s"});
{ let Th = 0, nb = PT.n.boiler;
  for(let b=0;b<nb;b++) Th = Math.max(Th, ST.sgTBy[b]);
  if(!(Th > 0)) Th = G.satT(G.P.sat, sc[G.SC_P]);
  const Tc = sc[G.SC_CONDT], eff = heatMW > 1 ? G.eMWe()/heatMW : 0, carnot = 1 - Tc/Th;
  check(name + ": thermal efficiency below Carnot of its own steam and condenser", eff, carnot, 0, "Carnot: eta < 1 - Tc/Th",
    {gap, pass:eff > 0 && eff < carnot, note:"Th " + Th.toFixed(1) + " K, Tc " + Tc.toFixed(1) + " K"}); }
const W4 = "Westinghouse 4-loop PWR design figures (Vogtle 3/4 & SNUPPS FSAR ch. 4/5): 15.5 MPa, T-avg 584.8 K, steam 6.9 MPa";
const RANGES = {
  "STOCK PWR": [["P", 15.0, 16.0, W4], ["Tavg", 570, 595, W4], ["secP", 5.0, 7.6, W4], ["sc", 10, 45, W4]],
  "DUAL":      [["P", 15.0, 16.0, W4], ["Tavg", 570, 595, W4], ["secP", 5.0, 7.6, W4], ["sc", 10, 45, W4]],
  "NUSCALE":   [["P", 12.0, 13.5, "NuScale DCA Tier 2 ch. 5: RCS 12.76 MPa, 531-583 K, steam 3.45 MPa"],
                ["Tavg", 545, 570, "NuScale DCA Tier 2 ch. 5"], ["secP", 3.0, 4.0, "NuScale DCA Tier 2 ch. 5"]],
  "BWR/4":     [["P", 6.8, 7.3, "BWR/4 (Browns Ferry, Fukushima Daiichi 2-5) dome 7.03 MPa, core exit quality ~0.14, core void ~0.4"],
                ["vf", 0.25, 0.55, "BWR/4 core average void fraction ~0.4 (GE BWR/4 design data)"]],
  "BN-600":    [["P", 0.05, 0.5, "BN-600 primary sodium near atmospheric (IAEA-TECDOC-1531)"],
                ["Tavg", 700, 760, "BN-600: core 650 K in, 823 K out (IAEA ARIS)"], ["secP", 12.5, 14.5, "BN-600 steam 13.7 MPa (IAEA ARIS)"]],
  "EPR":       [["P", 15.3, 15.7, "EPR (UK EPR PCSR ch. 5): 15.5 MPa, 569-603 K, steam 7.7 MPa"],
                ["Tavg", 580, 592, "UK EPR PCSR ch. 5"], ["secP", 7.0, 8.0, "UK EPR PCSR ch. 5"]],
  "RBMK-1000": [["P", 6.5, 7.2, "RBMK-1000 drum 6.9 MPa, channel inlet 543 K (INSAG-7)"], ["vf", 0.1, 0.6, "RBMK-1000 channel exit quality ~0.145 (INSAG-7)"]],
  "MSRE":      [["P", 0.05, 0.45, "MSRE fuel loop at pump-bowl pressure, <0.4 MPa (ORNL-4541)"], ["Tavg", 900, 945, "MSRE 908 K in, 936 K out (ORNL-4541)"]],
};
const read = k => {
  if(k === "secP"){ let t = 0, n = 0; for(let g=0;g<PT.n.sg;g++){ t += ST.sgPBy[PT.sgBoiler[g]]; n++; } return n ? t/n : NaN; }
  return sc[G["SC_" + k.toUpperCase()]]; };
for(const [k, lo, hi, src] of (RANGES[name] || []))
  check(name + ": " + k + " at 120 s inside the published range [" + lo + ", " + hi + "]", read(k), (lo + hi)/2, (hi - lo)/2, src, {abs:true, gap});
if(!RANGES[name]) check(name + ": no published range", NaN, NaN, 0, "the preset is not a drawing of a real machine", {pass:false, gap:"WINDSCALE preset is not the Windscale pile"});
