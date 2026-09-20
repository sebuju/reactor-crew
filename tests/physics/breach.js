"use strict";
/* docs/fidelity.md, "what a breached containment does to the heat": since 11/09/26 a wrecked gas-tight
   cell is an ordinary open cell (no orifice, no lumping, no levelling) and the row states nobody has
   measured what temperature gap a real aperture should hold. This derives that gap from first
   principles and measures the mechanism against it for the first time.

   The physics: two spaces at Th, Tc joined by a vertical opening of height H, width W exchange air
   two ways, hot out the top half, cold in the bottom half, driven by the stack effect. Standard
   result (Brown, W.G. & Solvason, K.R., "Natural convection through rectangular openings in
   partitions - 1: Vertical partitions", Int. J. Heat Mass Transfer 5 (1962) 859-868; carried forward
   in the SFPE Handbook of Fire Protection Engineering's Vent Flows chapter (Emmons) and in the
   building-ventilation literature, e.g. doorway/air-curtain exchange-flow studies):
     V = (1/3) Cd W H^(3/2) sqrt(g (Th-Tc)/Tc)          [m3/s, one-way]
   Cd is commonly taken 0.6-0.7 (0.68 measured inflow / 0.73 outflow, often rounded to 0.7); 0.65 used
   here. At steady state the enthalpy this flow carries away, rho*cp*V*(Th-Tc), must equal the heat Q
   put into the hot space: Q = K*dT^1.5 with K = rho*cp*(Cd/3)*W*H^1.5*sqrt(g/Tc), so dT = (Q/K)^(2/3). */
const {check, rig, load} = require("./lib.js");

const G = load();
const CLEAN = JSON.stringify(G.D);
const reset = () => { for(const k in G.D) delete G.D[k]; Object.assign(G.D, JSON.parse(CLEAN)); };
function run(G_, secs){ const n = Math.round(secs/0.02); for(let i=0;i<n;i++) G_.step(0.02); }

/* --- real quantities, read off the stock plant: rated decay heat and the real containment's own volume --- */
reset(); G.plantPreset(0); G.buildLayout(); G.commission();
G.ST.sc[G.SC_DICEOFF] = 1;
run(G, 2);
G.act("scram");
run(G, 10);
const Qfull = G.ST.csDecay[0]*G.PT.coreRated[0]*1000;   // kW, ANS-5.1 decay heat at 10 s post-trip
let minX=1e9, maxX=-1, minY=1e9, maxY=-1;
for(const k in G.D.mat){ const j=k.indexOf(","), x=+k.slice(0,j), y=+k.slice(j+1);
  if(G.matWall(x,y)){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; } }
const contCells = (maxX-minX-1)*(maxY-minY-1), contVol = contCells*G.MPC*G.MPC*G.ROOM_DEPTH;

/* --- re-measure the row's own scenario: 5 MPa BLAST beside pump0, dice off. Stopped at 15 s (well
   inside the 10 s script budget): by t=25-26 s this specific reproduction runs away to a primary-system
   failure (ROOM_TMAX-capped), a separate, transient finding reported alongside, not the steady
   mechanism this file measures. */
reset(); G.plantPreset(0); G.buildLayout(); G.commission();
G.ST.sc[G.SC_DICEOFF] = 1;
run(G, 2);
{ const pump = G.LAY.parts.find(p => p.role === "pump"), GW = G.GW;
  const ci = (pump.y + (pump.h >> 1))*GW + (pump.x - 3);
  G.act("blast", ci, 5000);
  run(G, 15);
  var Tin609 = G.ST.roomT[ci], Text609 = G.ST.roomT[3*GW + 3], Tsecs = 15; }

/* --- the controlled measurement: a 6-cell vertical aperture in a real liner wall, real cell size and
   depth, heated at Q prorated to the real decay heat by this cell's own share of the real containment's
   volume, forced open through the exact mechanism under test (ST.dmgBy, the same flag eRoomLive() reads) --- */
rig((R, GG) => {
  const D = GG.D; D.mat = D.mat || {};
  for(let y=3;y<=10;y++) D.mat["13,"+y] = {m:"liner"};
  for(let y=4;y<=9;y++) D.mat["15,"+y] = {m:"liner"};
  D.mat["14,3"] = {m:"liner"}; D.mat["14,10"] = {m:"liner"};
});
const GW = G.GW, s = G.ST, IX = G.IX;
const apY = [4,5,6,7,8,9];
const H = apY.length*G.MPC, W = G.ROOM_DEPTH;             // real geometry: 6 cells tall, the room's own depth wide
for(const y of apY) s.dmgBy[IX.part.get("mat:15,"+y)] = 1;   // wreck the six liner cells: an ordinary open cell, per the row
const hotCells = apY.map(y => y*GW + 14);
const hotVol = hotCells.length*G.MPC*G.MPC*G.ROOM_DEPTH;
const Qtest = Qfull*(hotVol/contVol);                        // same heat FLUX density as the real decay heat over the real containment
G.act("injectOn", 1, Qtest, hotCells[2], -1);

const Tc = G.T_HULL, samp = [];
for(const T of [50, 100, 150]){
  run(G, T - (samp.length ? 50*samp.length : 0));
  const Tint = hotCells.reduce((a, i) => a + s.roomT[i], 0)/hotCells.length;
  const Text = (s.roomT[6*GW + 0] + s.roomT[6*GW + GW - 15])/2;
  samp.push(Tint - Text);
}
const [x1, x2, x3] = samp;
const dTmodel = x3 - (x3 - x2)*(x3 - x2)/((x3 - x2) - (x2 - x1));   // Aitken extrapolation to the steady value

/* --- the correlation's own target, same Q, same H and W --- */
const Cd = 0.65, g = 9.80665, rho = (101.325)/(0.287*Tc), cp = 1.005;
const K = rho*cp*(Cd/3)*W*Math.pow(H, 1.5)*Math.sqrt(g/Tc);
const V = (1/3)*Cd*W*Math.pow(H, 1.5)*Math.sqrt(g*dTmodel/Tc);
const dTtarget = Math.pow(Qtest/K, 2/3);
const dist = dTmodel - dTtarget;

console.log("heat input Q = " + Qtest.toFixed(1) + " kW (decay heat " + Qfull.toFixed(0) +
  " kW prorated by this cell's " + (hotVol/contVol*100).toFixed(3) + " % share of the real " + contVol.toFixed(0) + " m3 containment)");
console.log("aperture: 6 cells, H = " + H.toFixed(3) + " m, W (room depth) = " + W.toFixed(2) + " m, Cd = " + Cd);
console.log("buoyant exchange flow at the model's own dT: V = " + V.toFixed(4) + " m3/s");
console.log("derived steady dT (correlation) = " + dTtarget.toFixed(2) + " K");
console.log("model dT, Aitken-extrapolated steady state = " + dTmodel.toFixed(2) + " K  (samples at 50/100/150 s: " +
  samp.map(v => v.toFixed(2)).join(", ") + ")");
console.log("row's own scenario re-measured (5 MPa BLAST beside pump0, dice off, " + Tsecs +
  " s): interior " + Tin609.toFixed(1) + " K, ship air " + Text609.toFixed(1) +
  " K (informational: a still-transient blowdown, not a steady state; not the 609 K/30 s window - see report)");
console.log("distance (model - correlation) = " + dist.toFixed(2) + " K");

check("temperature gap across a breached liner wall: model vs. buoyant exchange flow", dTmodel, dTtarget, 0.2,
  "Brown & Solvason (1962) two-way exchange flow through a vertical opening, Int. J. Heat Mass Transfer 5, 859-868; SFPE Handbook Vent Flows",
  {unit:"K", gap:"what a breached containment does to the heat",
   note:"Q " + Qtest.toFixed(0) + " kW through a 6-cell (" + H.toFixed(2) + " x " + W.toFixed(2) +
     " m) opening; model " + dTmodel.toFixed(1) + " K against a derived " + dTtarget.toFixed(1) +
     " K - the model runs " + (dTmodel < dTtarget ? "COLDER: it over-mixes, moving more heat than a real buoyant exchange flow would" :
       "HOTTER: it is not moving enough air, the gap is real")});
