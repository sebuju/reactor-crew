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
const {check, rig, load, watch} = require("./lib.js");

const G = load();
const CLEAN = JSON.stringify(G.D);
const reset = () => { for(const k in G.D) delete G.D[k]; Object.assign(G.D, JSON.parse(CLEAN)); };

/* --- real quantities, read off the stock plant: rated decay heat and the real containment's own volume --- */
reset(); G.plantPreset(0); G.buildLayout(); G.commission();
G.ST.sc[G.SC_DICEOFF] = 1;
watch(G, {cap:1});
G.act("scram");
watch(G, {cap:3});
const Qfull = G.ST.csDecay[0]*G.PT.coreRated[0]*1000;   // kW, ANS-5.1 decay heat at 3 s post-trip
let minX=1e9, maxX=-1, minY=1e9, maxY=-1;
for(const k in G.D.mat){ const j=k.indexOf(","), x=+k.slice(0,j), y=+k.slice(j+1);
  if(G.matWall(x,y)){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; } }
const contCells = (maxX-minX-1)*(maxY-minY-1), contVol = contCells*G.MPC*G.MPC*G.ROOM_DEPTH;

/* --- the controlled measurement: a vertical aperture in a real liner wall, real cell size and depth, in
   a HOT space that is walled on every other side, so at steady state the whole heat input leaves through
   the aperture and nothing else. The correlation's own reference state is the COLD side's temperature and
   density, and that is where they are read: the cold space sits well above T_HULL here, and evaluating K
   at ambient instead would be evaluating it somewhere the air is not. --- */
function aperture(n){
  const y0 = 4, y1 = y0 + n - 1;
  rig((R, GG) => {
    const D = GG.D; D.mat = D.mat || {};
    for(let y=2;y<=12;y++){ D.mat["13," + y] = {m:"liner"}; D.mat["15," + y] = {m:"liner"}; }
    for(let x=13;x<=15;x++){ D.mat[x + ",2"] = {m:"liner"}; D.mat[x + ",12"] = {m:"liner"}; }
  });
  const s = G.ST, IX = G.IX, GW = G.GW;
  for(let y=y0;y<=y1;y++) s.dmgBy[IX.part.get("mat:15," + y)] = 1;
  const hot = [], cold = [], feed = [];
  for(let y=3;y<=11;y++) feed.push(y*GW + 14);
  for(let y=y0;y<=y1;y++){ hot.push(y*GW + 14); cold.push(y*GW + 16); }
  return {s, hot, cold, feed, H: n*G.MPC, y0, y1};
}
const mean = (s, c) => c.reduce((a, i) => a + s.roomT[i], 0)/c.length;
/* the model's own steady gap across the aperture, Aitken-extrapolated off three samples */
const TCOLD = 400;
function gapOf(n, Q, ticks){
  const a = aperture(n), s = a.s;
  G.act("injectOn", 1, Q, a.feed[Math.floor(a.feed.length/2)], -1);
  const samp = [];
  /* The cold space is HELD, and the structure is held at the air. Both have their own checks elsewhere;
     what is being measured here is the gap one opening holds at a stated heat, and letting the whole
     ship warm up first would only be measuring how long the ship takes. */
  for(let k=0;k<3;k++){
    watch(G, {cap:ticks*0.02, each:() => {
      s.roomTS.set(s.roomT);
      for(const i of a.cold) s.roomT[i] = TCOLD; }});
    samp.push(mean(s, a.hot) - mean(s, a.cold)); }
  const [x1, x2, x3] = samp;
  return {dT: x3 - (x3 - x2)*(x3 - x2)/((x3 - x2) - (x2 - x1)), samp,
          Tc: mean(s, a.cold), rho: a.cold.reduce((k, i) => k + s.roomM[i], 0)/(a.cold.length*G.MPC*G.MPC*G.ROOM_DEPTH),
          H: a.H};
}
/* Brown & Solvason at the state the measurement was taken in, typed out a second time */
const Kof = (rho, cp, H, Tc) => rho*cp*(0.65/3)*G.ROOM_DEPTH*Math.pow(H, 1.5)*Math.sqrt(9.80665/Tc);

const Qtest = Qfull*(6*G.MPC*G.MPC*G.ROOM_DEPTH/contVol);
const six = gapOf(6, Qtest, 250);

const cp6 = G.roomSpCp(0, six.Tc);
const K6 = Kof(six.rho, cp6, six.H, six.Tc);
const dT6 = Math.pow(Qtest/K6, 2/3);

console.log("heat input Q = " + Qtest.toFixed(1) + " kW (decay heat " + Qfull.toFixed(0) +
  " kW prorated by six cells' share of the real " + contVol.toFixed(0) + " m3 containment)");
console.log("aperture: 6 cells, H = " + six.H.toFixed(3) + " m, W (room depth) = " + G.ROOM_DEPTH.toFixed(2) + " m, Cd = 0.65");
console.log("cold side at " + six.Tc.toFixed(1) + " K, " + six.rho.toFixed(4) + " kg/m3, c_p " + cp6.toFixed(4) + " kJ/kg/K");
console.log("derived steady dT (correlation) = " + dT6.toFixed(2) + " K");
console.log("model dT, Aitken-extrapolated = " + six.dT.toFixed(2) + " K  (cold side held at " + TCOLD + " K, structure at the air; samples: " +
  six.samp.map(v => v.toFixed(2)).join(", ") + ")");

check("temperature gap across a breached liner wall: model vs. buoyant exchange flow", six.dT, dT6, 0.1,
  "Brown & Solvason (1962) two-way exchange flow through a vertical opening, Int. J. Heat Mass Transfer 5, 859-868; SFPE Handbook Vent Flows",
  {unit:"K", note:"Q " + Qtest.toFixed(0) + " kW through a 6-cell (" + six.H.toFixed(2) + " x " +
    G.ROOM_DEPTH.toFixed(2) + " m) opening, K " + K6.toFixed(4) + " kW/K^1.5 at the cold side's own state"});

/* the EXPONENT is what says this is an exchange flow and not a conductance: four times the heat through
   the same opening holds 4^(2/3) times the gap, where a conductance would hold four times */
const hot4 = gapOf(6, 4*Qtest, 250);
check("four times the heat through the same opening", hot4.dT/six.dT, Math.pow(4, 2/3), 0.05,
  "dT = (Q/K)^(2/3) for a buoyant exchange flow, because the flow itself grows as sqrt(dT); a linear " +
  "conductance would hold four times the gap and a fixed-flow vent would hold four times as well",
  {unit:"-", note:"4Q gap " + hot4.dT.toFixed(1) + " K against " + six.dT.toFixed(1) +
    " K; 4^(2/3) = 2.52 against 4.00 for a conductance"});

/* --- the law is on the OPENING, not on a face: K goes as H^1.5, so dT = (Q/K)^(2/3) goes as H^-1 --- */
const two = gapOf(2, Qtest, 250);
const K2 = Kof(two.rho, G.roomSpCp(0, two.Tc), two.H, two.Tc);
check("two openings of 2 and 6 cells at the same heat: the ratio of their steady gaps", six.dT/two.dT,
  Math.pow(K2/K6, 2/3), 0.05,
  "the law belongs to the OPENING: K goes as its whole height^1.5, so dT goes as 1/H and a 6-cell " +
  "opening holds 2/6 of a 2-cell one's gap. The same law applied per FACE, each at H = MPC, would sum " +
  "to K proportional to n and hold (2/6)^(2/3) = 0.481 - which is what tells the two apart",
  {unit:"-", note:"2-cell gap " + two.dT.toFixed(1) + " K at " + two.Tc.toFixed(0) + " K cold side, 6-cell " +
    six.dT.toFixed(1) + " K at " + six.Tc.toFixed(0) + " K"});
