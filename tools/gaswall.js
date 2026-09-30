"use strict";
// node tools/gaswall.js [secs] [--k=turb:0,crowd:0] [--src=<particles.js or tree>] [--dump] [--stages]
// Where hydrogen parcels sit in a closed board with water over its bottom 8 rows: 1 s of hydrogen into the air at 1 s, 2 s under the
// water at 4 s. Each parcel's moles are spread over its own disc (area pv cells) to give each cell's hydrogen mole fraction.
//   band   parcel centres per cell within --band cells (default 3) of a side wall over the interior's, rows 3 to 3 over the water: a wall
//          attracts nothing, so 1 once the band is wider than the parcels' spacing
//   roof   parcel centres in the top row over the mean of rows 1..3: hydrogen stratifies, so above 1, but a layer, not a line
//   side   the wall columns' mean mole fraction over the interior's, rows above the water: a zero-flux wall in a room with no
//          horizontal force reads 1
//   conc   the highest cell mole fraction over the highest parcel's own: mixing never concentrates, so at most 1
//   below  parcels under the free surface: a bubble rises, so 0 once the release has had depth/0.2 m/s to clear
//   vol    the parcels' mixed volume above the water over the gas room's: two parcels cannot both have mixed with the same air
const vm = require("vm"), fs = require("fs"), path = require("path");
const B = require("./bundle.js");
const pos = process.argv.slice(2).filter(a => !a.startsWith("--"));
const flag = k => { const a = process.argv.find(s => s === "--" + k || s.startsWith("--" + k + "=")); return a === undefined ? null : a.includes("=") ? a.slice(a.indexOf("=") + 1) : ""; };
const SECS = +(pos[0] || 60), dt = 0.02, BW = +(flag("band") || 3);
const partSrc = p => { const f = !p ? path.join(B.ROOT, "tools", "particles.js") : fs.statSync(p).isDirectory() ? path.join(p, "tools", "particles.js") : p;
  return fs.readFileSync(f, "utf8"); };

B.headless("0");
vm.runInThisContext(B.bundle().replace(/layoutMetrics\(\); layout\(\); requestAnimationFrame\(tick\);/, "layoutMetrics();"), {filename: "bundle.js"});
vm.runInThisContext(partSrc(flag("src")), {filename: "particles.js"});
const P = vm.runInThisContext("PART");
for(const kv of (flag("k") || "").split(",").filter(Boolean)){ const [k, v] = kv.split(":"); if(!(k in P.K)) throw new Error("no knob " + k); P.K[k] = +v; }
const G = k => vm.runInThisContext(k);
const GW = G("GW"), GH = G("GH"), MPC = G("MPC"), at = (x, y) => y*GW + x;
const N0 = G("ROOM_P0")*1000*MPC*MPC*G("ROOM_DEPTH")/(8.314462618*G("T_HULL")), M_H2 = G("H2_MMOL");
G("D").mat = {}; P.parts([]); P.build();
const WTOP = GH - 8;
for(let y=WTOP;y<GH;y++) for(let x=0;x<GW;x++) P.lay(at(x, y), 1);

const drive = k => {
  if(k === 50) P.inject("h2", 1, at(30, 6));
  if(k === 100) P.off();
  if(k === 200) P.inject("h2", 1, at(30, GH - 2));
  if(k === 300) P.off();
};
const KH = 3, xc = new Float64Array(GW*GH);
// the free surface's height in column x: the first cell from the top at least half full, its water in its bottom part
function surf(x){ const f = P.fill; for(let y=0;y<GH;y++){ const v = f[at(x, y)]; if(v >= 0.5) return y + 1 - Math.min(1, v); } return GH; }
function report(k){
  const n = P.np, px = P.px, py = P.py, kind = P.kind, pv = P.pv, pm = P.pm;
  const sy = []; for(let x=0;x<GW;x++) sy.push(surf(x));
  xc.fill(0); let below = 0, xmax = 0, spv = 0, ngas = 0;
  for(let p=0;p<n;p++){ if(kind[p] !== KH) continue; const cx = Math.min(GW-1, px[p]|0);
    if(py[p] > sy[cx]){ below++; continue; }
    const mol = pm[p]/M_H2, r = Math.sqrt(pv[p]/Math.PI); spv += pv[p]; xmax = Math.max(xmax, mol/(pv[p]*N0));
    const pts = []; for(let a=-r;a<=r;a+=0.1) for(let b=-r;b<=r;b+=0.1){ if(a*a + b*b > r*r) continue;
      const X = px[p] + a, Y = py[p] + b; if(X < 0 || Y < 0 || X >= GW || Y >= GH) continue; pts.push(at(X|0, Y|0)); }
    if(!pts.length) pts.push(at(cx, Math.min(GH-1, py[p]|0)));
    for(const c of pts) xc[c] += mol/pts.length/N0; }
  for(let x=0;x<GW;x++) ngas += sy[x];
  // parcel centres per cell: the wall columns and the interior over rows 3..WTOP-3, the top row and rows 1..3
  let cw = 0, ci = 0, ct = 0, cu = 0;
  for(let p=0;p<n;p++){ if(kind[p] !== KH) continue; const x = px[p], y = py[p];
    if(y >= 3 && y < WTOP - 2){ if(x < BW || x >= GW - BW) cw++; else ci++; }
    if(y < 1) ct++; else if(y < 4) cu++; }
  const rows = WTOP - 5, band = ci > 0 ? (cw/(2*BW*rows))/(ci/((GW - 2*BW)*rows)) : NaN, roof = cu > 0 ? ct/(cu/3) : NaN;
  let w = 0, nw = 0, m = 0, nm = 0, cmax = 0;
  for(let y=0;y<WTOP-1;y++) for(let x=0;x<GW;x++){ const v = xc[at(x, y)]; cmax = Math.max(cmax, v);
    if(x === 0 || x === GW-1){ w += v; nw++; } else if(x >= 2 && x <= GW-3){ m += v; nm++; } }
  console.log("t " + (k*dt).toFixed(1).padStart(5) + " s  band " + band.toFixed(2).padStart(5) + "  roof " + roof.toFixed(2).padStart(5) + "  side " + (m > 0 ? ((w/nw)/(m/nm)).toFixed(2) : "-").padStart(6) +
    "  conc " + (xmax > 0 ? (cmax/xmax).toFixed(2) : "-").padStart(6) + "  below " + String(below).padStart(4) + "  vol " + (spv/ngas).toFixed(2) +
    "  top-row x " + (() => { let s = 0; for(let x=0;x<GW;x++) s += xc[at(x, 0)]; return (s/GW).toFixed(4); })() + "  parcels " + n);
  if(flag("dump") !== null) for(let p=0;p<n;p++){ if(kind[p] !== KH) continue; const cx = Math.min(GW-1, px[p]|0), cy = Math.min(GH-1, py[p]|0); if(!(py[p] > sy[cx])) continue;
    console.log("   below x " + px[p].toFixed(3) + " y " + py[p].toFixed(3) + " surf " + sy[cx] + " fill " + P.fill[at(cx, cy)].toFixed(2) + " pc " + P.pc[at(cx, cy)] + " vy " + (P.vy[p]*MPC).toFixed(3) + " pv " + pv[p].toFixed(3)); }
}
// --stages: over the last 50 steps, the mean y move (cells, +down) of the hydrogen below the water between each tap point of sub()
const steps = Math.round(SECS/dt), ST = flag("stages") !== null, dY = {}, nY = {}, last = new Float64Array(12000);
let prev = -1;
if(ST) P.tap = s => { const n = P.np;
  if(prev >= 0){ const key = prev + ">" + s; dY[key] = dY[key] || 0; nY[key] = nY[key] || 0;
    for(let p=0;p<n;p++) if(P.kind[p] === KH && P.py[p] > WTOP + 1){ dY[key] += P.py[p] - last[p]; nY[key]++; } }
  for(let p=0;p<n;p++) last[p] = P.py[p]; prev = s; };
for(let k=0;k<steps;k++){ drive(k); if(ST && k === steps - 50) for(const q in dY){ dY[q] = 0; nY[q] = 0; }
  prev = -1; P.step(dt); if((k + 1) % 250 === 0) report(k + 1); }
if(ST) for(const q in dY) console.log("stage " + q.padEnd(6) + " mean dy " + (nY[q] ? (dY[q]/nY[q]).toExponential(3) : "-") + " cells over " + nY[q]);
