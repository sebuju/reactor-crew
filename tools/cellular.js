"use strict";
/* Room contents by game rules, a mockup: water falls cell by cell and moves sideways as shallow water between
   wall-to-wall column pieces, gas is a per-cell mixture stirred and sorted by buoyancy, and
   pressure is one number per connected gas pocket. Every mol and joule is booked; the motion is a rule, not a law. */
const CELLR = (() => {
const G = 9.81, T0 = 273.15, RU = 8.314462618, CW = 4190, LV = 2.257e6, RHO_W = 1000;
const MX = [0.028013, 0.031998, 0.002016, 0.018015], CV = [20.8, 21.1, 20.4, 25.3];   // N2+Ar, O2, H2, H2O: kg/mol, J/mol/K
const LM = LV*MX[3], MWC = MX[3]*CW, QH2 = 240.6e3;   // J/mol: latent, liquid heat per K, H2 burnt at constant volume to vapour
const W_MIN = 1e-5, W_FULL = 0.98, W_DAMP = 0.01;
// a plume draws air in and sheds little sideways, so the side stir is a fraction of the up-and-down one
const K_MIX = 0.01, K_SIDE = 0.002, H_WALL = 5, H_WG = 10;
// Coward and Jones (1952): a hydrogen-air flame travels up at 4.1 %, sideways at 6.0 %, down at 9.0 %
const LFL_SIDE = 0.06, LFL_DOWN = 0.09;
const L = {ready:false, t:0, dt:0.02, inj:null, nr:0, nb:0, tick:0, gasX:1};
let W = 0, H = 0, N = 0, Vc = 0, Af = 0, P0 = 0;
let sX, sY0, sY1, sW, sLvl, sHead, fS, fT, fY0, fY1, fU;
let wall, nWall, n, e, T, Vg, w, ew, rho, reg, regP, regV, regNT, body, bTopZ, bTopP, bTopR, burn, prog, pk, hot, stack;

const zMid = y => (H - y - 0.5)*MPC, zBot = y => (H - y - 1)*MPC;
const psat = t => t < 647 ? satP(SAT_WATER, t)*1e6 : 1e12;
const sl = x => { if(x <= H2_SL[0][0] || x >= H2_SL[H2_SL.length-1][0]) return 0;
  for(let k=1;k<H2_SL.length;k++) if(x <= H2_SL[k][0]){ const a = H2_SL[k-1], b = H2_SL[k]; return a[1] + (b[1]-a[1])*(x-a[0])/(b[0]-a[0]); }
  return 0; };
const gasCell = i => !wall[i] && w[i] < W_FULL;
const nTot = i => n[i*4] + n[i*4+1] + n[i*4+2] + n[i*4+3];

function build(){
  W = GW; H = GH; N = W*H; Vc = MPC*MPC*ROOM_DEPTH; Af = MPC*ROOM_DEPTH; P0 = ROOM_P0*1000;
  const F = k => new Float64Array(k);
  wall = new Uint8Array(N); nWall = new Uint8Array(N);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) wall[y*W+x] = matWall(x, y) ? 1 : 0;
  const isW = (x, y) => x < 0 || y < 0 || x >= W || y >= H || wall[y*W+x] === 1;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) nWall[y*W+x] = (isW(x-1, y) ? 1 : 0) + (isW(x+1, y) ? 1 : 0) + (isW(x, y-1) ? 1 : 0) + (isW(x, y+1) ? 1 : 0);
  n = F(4*N); e = F(N); T = F(N); Vg = F(N); w = F(N); ew = F(N);
  const segOf = new Int32Array(N).fill(-1), sx = [], s0 = [], s1 = [];
  for(let x=0;x<W;x++) for(let y=0;y<H;){ if(wall[y*W+x]){ y++; continue; }
    let e2 = y; while(e2+1 < H && !wall[(e2+1)*W+x]) e2++;
    for(let k=y;k<=e2;k++) segOf[k*W+x] = sx.length;
    sx.push(x); s0.push(y); s1.push(e2); y = e2+1; }
  sX = Int32Array.from(sx); sY0 = Int32Array.from(s0); sY1 = Int32Array.from(s1);
  sW = F(sx.length); sLvl = F(sx.length); sHead = F(sx.length);
  const fs = [], ft = [], f0 = [], f1 = [];
  for(let s=0;s<sx.length;s++){ if(sx[s] === W-1) continue; const seen = new Set();
    for(let y=s0[s];y<=s1[s];y++){ const t = segOf[y*W + sx[s] + 1]; if(t < 0 || seen.has(t)) continue; seen.add(t);
      fs.push(s); ft.push(t); f0.push(Math.max(s0[s], s0[t])); f1.push(Math.min(s1[s], s1[t])); } }
  fS = Int32Array.from(fs); fT = Int32Array.from(ft); fY0 = Int32Array.from(f0); fY1 = Int32Array.from(f1); fU = F(fs.length);
  reg = new Int32Array(N); regP = F(N); regV = F(N); regNT = F(N); body = new Int32Array(N); bTopZ = F(N); bTopP = F(N); bTopR = new Int32Array(N); rho = F(N);
  burn = new Uint8Array(N); prog = F(N); pk = F(N); hot = new Uint8Array(N); stack = new Int32Array(N);
  reset();
}

function reset(){
  n.fill(0); e.fill(0); w.fill(0); ew.fill(0); fU.fill(0); burn.fill(0); prog.fill(0); pk.fill(0);
  const n0 = P0*Vc/(RU*T_HULL);
  for(let i=0;i<N;i++){ if(wall[i]) continue;
    n[i*4] = n0*(1 - O2_FRAC0); n[i*4+1] = n0*O2_FRAC0; e[i] = (n[i*4]*CV[0] + n[i*4+1]*CV[1])*(T_HULL - T0); }
  L.t = 0; L.tick = 0; L.inj = null; L.ready = true;
  temps(); regions();
}

function temps(){
  for(let i=0;i<N;i++){ if(wall[i]){ T[i] = NaN; Vg[i] = 0; continue; }
    Vg[i] = Vc*Math.max(0, 1 - Math.min(1, w[i]));
    const o = i*4, c = n[o]*CV[0] + n[o+1]*CV[1] + n[o+2]*CV[2] + n[o+3]*CV[3];
    T[i] = c > 1e-12 ? Math.max(150, T0 + (e[i] - n[o+3]*LM)/c) : T_HULL; }
}

function flood(lab, i0, id, ok){ let sp = 0; stack[sp++] = i0; lab[i0] = id;
  while(sp){ const i = stack[--sp], x = i%W;
    if(x > 0 && lab[i-1] < 0 && ok(i-1)){ lab[i-1] = id; stack[sp++] = i-1; }
    if(x < W-1 && lab[i+1] < 0 && ok(i+1)){ lab[i+1] = id; stack[sp++] = i+1; }
    if(i >= W && lab[i-W] < 0 && ok(i-W)){ lab[i-W] = id; stack[sp++] = i-W; }
    if(i+W < N && lab[i+W] < 0 && ok(i+W)){ lab[i+W] = id; stack[sp++] = i+W; } } }

// one pressure per connected gas pocket; a water body reads the pocket over its highest surface, plus its own head
// the flood fills run only after water has moved: nothing else changes which cells are gas
function regions(){
  reg.fill(-1); let nr = 0;
  for(let i=0;i<N;i++) if(reg[i] < 0 && gasCell(i)) flood(reg, i, nr++, gasCell);
  L.nr = nr;
  body.fill(-1); let nb = 0;
  const wet = i => !wall[i] && w[i] > 1e-3;
  for(let i=0;i<N;i++) if(body[i] < 0 && wet(i)){ bTopZ[nb] = -1e9; bTopR[nb] = -1; flood(body, i, nb++, wet); }
  L.nb = nb;
  for(let i=0;i<N;i++){ const b = body[i]; if(b < 0) continue;
    const z = zBot((i/W)|0) + Math.min(1, w[i])*MPC;
    if(z > bTopZ[b]){ const r = reg[i] >= 0 ? reg[i] : (i >= W ? reg[i-W] : -1); bTopZ[b] = z; if(r >= 0) bTopR[b] = r; } }
  // water pressed against a ceiling has no air over it: it reads the air it touches anywhere, so a hanging slab falls
  for(let i=0;i<N;i++){ const b = body[i]; if(b < 0 || bTopR[b] >= 0) continue; const x = i%W;
    for(const j of [i+W, i-W, x > 0 ? i-1 : -1, x < W-1 ? i+1 : -1]) if(j >= 0 && j < N && reg[j] >= 0){ bTopR[b] = reg[j]; break; } }
  pressures();
}
function pressures(){
  const nr = L.nr;
  for(let r=0;r<nr;r++){ regV[r] = 0; regNT[r] = 0; }
  for(let i=0;i<N;i++){ const r = reg[i]; if(r < 0) continue; regV[r] += Vg[i]; regNT[r] += nTot(i)*T[i]; }
  for(let r=0;r<nr;r++) regP[r] = regV[r] > 0 ? RU*regNT[r]/regV[r] : P0;
  for(let b=0;b<L.nb;b++) bTopP[b] = bTopR[b] >= 0 ? regP[bTopR[b]] : P0;
}
const bodyP = (i, z) => { const b = body[i];
  if(b >= 0) return bTopP[b] + RHO_W*G*(bTopZ[b] - z);
  const r = reg[i]; return (r >= 0 ? regP[r] : P0) + RHO_W*G*(zBot((i/W)|0) + w[i]*MPC - z); };

const gasHead = r => ((r >= 0 ? regP[r] : P0) - P0)/(RHO_W*G);
// shallow water sideways: a column piece (wall to wall) holds a level; the face to its neighbour carries a speed,
// pushed by the level difference plus the gas pressing on each surface. Water leaves from the top, lands at the face and falls.
function lateral(dt){
  for(let s=0;s<sX.length;s++){ const x = sX[s]; let sum = 0;
    for(let y=sY0[s];y<=sY1[s];y++) sum += w[y*W+x];
    const lvl = zBot(sY1[s]) + sum*MPC, ya = Math.max(sY0[s], sY1[s] - Math.floor(sum)), i = ya*W + x;
    // a column full to its ceiling feels the gas pressing on its top from the side; the block collapses under it instead of hanging
    let r = reg[i] >= 0 ? reg[i] : ya > sY0[s] ? reg[i-W] : -1;
    if(r < 0) r = x > 0 && reg[i-1] >= 0 ? reg[i-1] : x < W-1 && reg[i+1] >= 0 ? reg[i+1] : body[i] >= 0 ? bTopR[body[i]] : -1;
    sW[s] = sum; sLvl[s] = lvl; sHead[s] = lvl + gasHead(r); }
  for(let f=0;f<fS.length;f++){ const s = fS[f], t = fT[f], zlo = zBot(fY1[f]), zhi = zBot(fY0[f]) + MPC;
    const u = fU[f]*(1 - W_DAMP) + dt*G*(sHead[s] - sHead[t])/MPC, d = u > 0 ? s : t, r = u > 0 ? t : s;
    const wet = Math.min(sLvl[d], zhi) - zlo;
    if(!(wet > 0) || !(sW[d] > W_MIN)){ fU[f] = 0; continue; }
    fU[f] = u;
    // it lands at the face, or the first cell above it with room; a column full to its ceiling takes nothing
    const xd = sX[d], xr = sX[r], yr = Math.max(fY0[f], Math.min(fY1[f], sY1[r] - Math.floor(sW[r])));
    let room = 0; for(let y=yr;y>=sY0[r];y--) room += Math.max(0, 1 - w[y*W + xr]);
    const q = Math.min(0.25*sW[d], room, Math.abs(u)*dt*ROOM_DEPTH*wet/Vc);
    if(!(q > 0)){ fU[f] = 0; continue; }
    let rem = q, E = 0, top = -1;
    for(let y=sY0[d];y<=sY1[d] && rem > 0;y++){ const k = y*W + xd; if(!(w[k] > 0)) continue; if(top < 0) top = k;
      const g = Math.min(w[k], rem), qe = g >= w[k] ? ew[k] : ew[k]*g/w[k]; w[k] -= g; ew[k] -= qe; if(!(w[k] > 0)){ w[k] = 0; ew[k] = 0; } rem -= g; E += qe; }
    let put = q - rem; const moved = put;
    for(let y=yr;y>=sY0[r] && put > 0;y--){ const k = y*W + xr, g = Math.min(put, Math.max(0, 1 - w[k])); if(!(g > 0)) continue;
      // air crosses back only inside one pocket: a sealed bell keeps its air and is squeezed instead
      if(top >= 0 && reg[k] >= 0 && reg[k] === (reg[top] >= 0 ? reg[top] : top >= W ? reg[top - W] : -1)) trade(top, k, g);
      w[k] += g; ew[k] += E*g/moved; put -= g; }
    sW[d] -= moved; sW[r] += moved; }
}
// water arriving in a cell sends the same volume of that cell's gas back where the water came from: water and air trade places, no void opens
function trade(src, dst, f){
  const vg = Vc*Math.max(0, 1 - Math.min(1, w[dst])); if(!(vg > 0) || !(f > 0)) return;
  const g = Math.min(1, f*Vc/vg), od = dst*4, os = src*4;
  for(let s=0;s<4;s++){ const q = n[od+s]*g; n[od+s] -= q; n[os+s] += q; }
  const de = e[dst]*g; e[dst] -= de; e[src] += de;
}
// down, bottom-up in place: a hole under standing water refills at once, a falling drop falls one cell per tick,
// and the air it lands in trades up into the cell it left, so a trapped bubble rises and a hanging slab drops
function water(){
  for(let i=N-W-1;i>=0;i--){ const j = i+W; if(wall[i] || wall[j] || !(w[i] > 0)) continue;
    let f = Math.min(w[i], Math.max(0, 1 - w[j])); if(!(f > 0)) continue;
    if(f > w[i]*(1 - 1e-9)) f = w[i];
    trade(i, j, f);
    const q = f === w[i] ? ew[i] : ew[i]*f/w[i]; w[i] -= f; ew[i] -= q; w[j] += f; ew[j] += q; }
}

// equal-volume swap: dv of each side's contents crosses, species and energy in proportion, so every mol and joule is kept
function swap(a, b, dv, cap){
  if(!(dv > 0) || !(Vg[a] > 0) || !(Vg[b] > 0)) return;
  const fa = Math.min(cap, dv/Vg[a]), fb = Math.min(cap, dv/Vg[b]), oa = a*4, ob = b*4;
  for(let s=0;s<4;s++){ const qa = n[oa+s]*fa, qb = n[ob+s]*fb; n[oa+s] += qb - qa; n[ob+s] += qa - qb; }
  const ea = e[a]*fa, eb = e[b]*fb; e[a] += eb - ea; e[b] += ea - eb;
}
const rhoAt = i => { const o = i*4, nt = nTot(i); if(!(nt > 0)) return 0; const r = reg[i], p = r >= 0 ? regP[r] : P0;
  return p*(n[o]*MX[0] + n[o+1]*MX[1] + n[o+2]*MX[2] + n[o+3]*MX[3])/nt/(RU*T[i]); };
function gas(){
  // a cell the water has taken hands its gas to the nearest gas cell, up first
  for(let i=0;i<N;i++){ if(wall[i] || gasCell(i) || !(nTot(i) > 0)) continue;
    const x = i%W, c = [i-W, x > 0 ? i-1 : -1, x < W-1 ? i+1 : -1, i+W];
    for(const j of c) if(j >= 0 && j < N && gasCell(j)){ for(let s=0;s<4;s++){ n[j*4+s] += n[i*4+s]; n[i*4+s] = 0; } e[j] += e[i]; e[i] = 0; break; } }
  // density read once a tick; a whole swap carries it along; a light stir leaves it for the next tick
  for(let i=0;i<N;i++) rho[i] = gasCell(i) ? rhoAt(i) : 0;
  const whole = (a, b, vm) => { swap(a, b, vm, 1); const t = rho[a]; rho[a] = rho[b]; rho[b] = t; };
  // a buoyant parcel one cell across moves at about sqrt(g' d): true for a rising bubble and a current's front alike.
  // A pair looked at every other tick moves once per ceil(1/(2q)) looks; a source parcel waits, and fills, until it is light enough to go.
  const every = (ra, rb, looks) => { const q = L.gasX*Math.sqrt(G*Math.abs(ra - rb)/(0.5*(ra + rb))*MPC)*L.dt/MPC;
    return q > 1e-3 && (L.tick >> (looks - 1)) % Math.min(100/looks, Math.ceil(1/(looks*q))) === 0; };
  const par = L.tick & 1;
  for(let y=0;y<H-1;y++){ const lower = (y & 1) === par;
    for(let x=0;x<W;x++){ const a = y*W+x, b = a+W; if(!gasCell(a) || !gasCell(b)) continue;
      const ra = rho[a], rb = rho[b], vm = Math.min(Vg[a], Vg[b]);
      // unstable: the light parcel trades places with the heavy one above it, whole, leaving no trail (a part-swap only averages)
      if(lower && rb < ra && every(ra, rb, 2)) whole(a, b, vm);
      // stable layering (light over heavy) damps the stir; only a near-neutral pair still mixes
      else if(Math.abs(ra - rb) > 1e-5*ra && ra - rb > -2e-4*ra) swap(a, b, K_MIX*vm, 0.45); } }
  // a light column beside heavy gas tips over: the light parcel may also trade with the heavier one diagonally above it,
  // the side alternating by tick, never through a wall corner
  const dir = (L.tick >> 1) & 1 ? 1 : -1;
  for(let y=0;y<H-1;y++){ if(((y & 1) === par)) continue;
    for(let x=0;x<W;x++){ const xa = x + dir; if(xa < 0 || xa >= W) continue;
      const a = y*W + xa, b = a + W - dir; if(!gasCell(a) || !gasCell(b) || (!gasCell(b - W) && !gasCell(b + dir))) continue;
      const ra = rho[a], rb = rho[b];
      if(rb < ra && every(ra, rb, 2)) whole(a, b, Math.min(Vg[a], Vg[b])); } }
  // sideways a gravity current: light gas runs along under a ceiling, heavy gas along a floor or a water surface; the rest sorts by overturn
  const lid = k => k < 0 || k >= N || !gasCell(k);
  for(let y=0;y<H;y++) for(let x=0;x<W-1;x++){ const a = y*W+x, b = a+1; if(!gasCell(a) || !gasCell(b)) continue;
    const ra = rho[a], rb = rho[b], lt = ra < rb ? a : b, hv = ra < rb ? b : a, vm = Math.min(Vg[a], Vg[b]);
    // a parcel that can still rise (light) or sink (heavy) does that instead of running along
    const rises = !lid(lt - W) && rho[lt - W] > rho[lt], sinks = !lid(hv + W) && rho[hv + W] < rho[hv];
    if(((lid(lt - W) && !sinks) || (lid(hv + W) && !rises)) && every(ra, rb, 1)) whole(a, b, vm);
    else if(Math.abs(ra - rb) > 1e-5*ra) swap(a, b, K_SIDE*vm, 0.45); }
}

// a buoyant release rises as a plume to the ceiling over it and lands there, diluted by the air it drew in on the way:
// volume flux Q = 0.15 B^(1/3) z^(5/3) (Morton, Taylor and Turner 1956), B = g (1 - rho_s/rho_a) Q0. A fiftieth stays along the path so the plume shows.
const PLUME_PATH = 0.02;
const path = new Int32Array(256);
function plumeIn(i, s, mol, eMol, Ts, dt){
  let len = 0, k = i; path[len++] = k;
  while(k >= W && gasCell(k - W) && len < path.length){ k -= W; path[len++] = k; }
  const top = path[len - 1], p = reg[i] >= 0 ? regP[reg[i]] : P0;
  const q0 = mol*RU*Ts/p/dt, b = G*Math.max(0, 1 - MX[s]/MX[0]*T[i]/Ts)*q0, z = (len - 1)*MPC;
  if(len < 2 || !(b > 0)){ n[i*4+s] += mol; e[i] += mol*eMol; return; }
  const on = mol*PLUME_PATH/len;
  for(let j=0;j<len;j++){ const c = path[j], m = j === len - 1 ? mol - on*(len - 1) : on; n[c*4+s] += m; e[c] += m*eMol; }
  let na = Math.max(0, 0.15*Math.cbrt(b)*Math.pow(z, 5/3) - q0)*dt*p/(RU*T[i])/(len - 1);
  for(let j=0;j<len-1;j++){ const c = path[j], nt = nTot(c); if(!(nt > 0)) continue;
    const f = Math.min(0.3, na/nt), o = c*4, ot = top*4;
    for(let t=0;t<4;t++){ const d = n[o+t]*f; n[o+t] -= d; n[ot+t] += d; }
    const de = e[c]*f; e[c] -= de; e[top] += de; }
}
// every cell leans toward its share at the pocket's pressure and its own temperature: across each face the fuller side
// (by its own share) sends its mixture to the emptier one. A layer arriving at a ceiling thickens downward, hot gas swells,
// water shoves the air aside, and the air a plume drew in comes back from beside it.
function push(){
  for(let i=0;i<N;i++) rho[i] = gasCell(i) && reg[i] >= 0 ? nTot(i)/(regP[reg[i]]*Vg[i]/(RU*T[i])) : 0;
  for(let pass=0;pass<2;pass++){
    const face = (a, b) => { if(!gasCell(a) || !gasCell(b) || reg[a] !== reg[b]) return;
      const d = rho[a] > rho[b] ? a : b, t = d === a ? b : a, gap = Math.abs(rho[a] - rho[b]); if(!(gap > 1e-4)) return;
      const nsd = nTot(d)/rho[d], nst = nTot(t)/Math.max(1e-9, rho[t]) || regP[reg[t]]*Vg[t]/(RU*T[t]);
      const dm = 0.2*gap*Math.min(nsd, nst), f = Math.min(0.2, dm/nTot(d)), od = d*4, ot = t*4;
      for(let s=0;s<4;s++){ const q = n[od+s]*f; n[od+s] -= q; n[ot+s] += q; }
      const de = e[d]*f; e[d] -= de; e[t] += de;
      rho[d] = nTot(d)/nsd; rho[t] = nTot(t)/nst; };
    for(let i=0;i<N;i++){ if(i%W < W-1) face(i, i+1); if(i+W < N) face(i, i+W); } }
}
function sources(dt){
  hot.fill(0);
  const q = L.inj; if(!q || q.cell < 0 || wall[q.cell]) return;
  const i = q.cell, o = i*4, r = q.rate;
  const addGas = (s, kg) => { if(kg > 0){ const m = kg/MX[s]; n[o+s] += m; e[i] += m*CV[s]*(T_HULL - T0); }
    else { const f = Math.min(0.5, -kg/Math.max(1e-9, gasKg(i))); for(let k=0;k<4;k++) n[o+k] -= n[o+k]*f; e[i] -= e[i]*f; } };
  if(q.kind === "heat"){ if(w[i] > 0.5) ew[i] += r*1000*dt; else e[i] += r*1000*dt;
    if(r > 0 && T[i] + r/(0.01*(2*Af + 2*MPC*MPC)) >= H2_IGN_SURF) hot[i] = 1; }
  else if(q.kind === "h2"){ if(r > 0) plumeIn(i, 2, r*dt/MX[2], CV[2]*(T_HULL - T0), T_HULL, dt); else addGas(2, r*dt); }
  else if(q.kind === "o2") addGas(1, r*dt);
  else if(q.kind === "steam"){ if(r > 0) plumeIn(i, 3, r*dt/MX[3], LM + MWC*(373.15 - T0), 373.15, dt); else addGas(0, r*dt); }
  else if(q.kind === "gas") addGas(0, -Math.abs(r)*dt);
  else if(q.kind === "fluid"){
    if(r > 0){ const f = r*dt/(RHO_W*Vc); w[i] += f; ew[i] += r*dt*CW*(T_HULL - T0); }
    else if(w[i] > 0){ const f = Math.min(w[i], -r*dt/(RHO_W*Vc)); ew[i] -= ew[i]*f/w[i]; w[i] -= f; } }
}
const gasKg = i => n[i*4]*MX[0] + n[i*4+1]*MX[1] + n[i*4+2]*MX[2] + n[i*4+3]*MX[3];

function phase(dt){
  const pw = psat(T_HULL);
  for(let i=0;i<N;i++){ if(wall[i]) continue; const o = i*4;
    const mw = w[i]*RHO_W*Vc;
    if(mw > 1e-3){
      const tw = T0 + ew[i]/(CW*mw), g = gasCell(i) ? i : (i >= W && gasCell(i-W) ? i-W : -1);
      const p = g >= 0 && reg[g] >= 0 ? regP[reg[g]] : bodyP(i, zMid((i/W)|0));
      const ts = satT(SAT_WATER, p/1e6);
      if(tw > ts && g >= 0){ const dm = Math.min(mw, (ew[i] - mw*CW*(ts - T0))/LV);
        if(dm > 0){ w[i] -= dm/(RHO_W*Vc); ew[i] -= dm*(LV + CW*(ts - T0)); n[g*4+3] += dm/MX[3]; e[g] += dm*(LV + CW*(ts - T0)); } }
      else if(g >= 0){ const o2 = g*4, cg = n[o2]*CV[0] + n[o2+1]*CV[1] + n[o2+2]*CV[2] + n[o2+3]*CV[3], cw = mw*CW;
        // a film of a few grams must not swing past the gas it touches: at most half-way to the shared temperature
        const qm = 0.5*Math.abs(tw - T[g])*cw*cg/Math.max(1e-9, cw + cg), q = Math.sign(tw - T[g])*Math.min(qm, H_WG*Af*Math.abs(tw - T[g])*dt);
        ew[i] -= q; e[g] += q; }
    }
    if(!gasCell(i) || !(Vg[i] > 0)) continue;
    const A = 2*MPC*MPC + Af*nWall[i], pv = n[o+3]*RU*T[i]/Vg[i];
    if(pv > pw && T[i] > T_HULL){
      // Uchida (1965): wall condensation 380 (steam/air)^0.707 W/m2K; the condensate lands in the cell and falls
      const hw = 380*Math.pow((n[o+3]*MX[3])/Math.max(1e-9, n[o]*MX[0] + n[o+1]*MX[1]), 0.707);
      const dn = Math.min(hw*A*(T[i] - T_HULL)*dt/LM, (pv - pw)*Vg[i]/(RU*T[i]));
      if(dn > 0){ n[o+3] -= dn; e[i] -= dn*(LM + CV[3]*(T[i] - T0)); w[i] += dn*MX[3]/(RHO_W*Vc); ew[i] += dn*MWC*(T_HULL - T0); } }
    const cg = n[o]*CV[0] + n[o+1]*CV[1] + n[o+2]*CV[2] + n[o+3]*CV[3];
    e[i] -= Math.sign(T[i] - T_HULL)*Math.min(0.5*Math.abs(T[i] - T_HULL)*cg, H_WALL*A*Math.abs(T[i] - T_HULL)*dt);
    const ps = psat(T[i]), pv2 = n[o+3]*RU*T[i]/Vg[i];
    // fog keeps its latent heat in the gas; beside water, the condensate and its heat go into the water
    if(pv2 > ps){ const dn = 0.5*(pv2 - ps)*Vg[i]/(RU*T[i]), wet = w[i] > 0.01, q = dn*(wet ? LM + CV[3]*(T[i] - T0) : MWC*(T[i] - T0));
      n[o+3] -= dn; e[i] -= q; w[i] += dn*MX[3]/(RHO_W*Vc); ew[i] += q; } }
}

let XH = 0, XO = 0;
function fracs(i){ const nt = nTot(i); XH = nt > 0 ? n[i*4+2]/nt : 0; XO = nt > 0 ? n[i*4+1]/nt : 0; }
const flam = (i, lim) => { if(!gasCell(i)) return false; fracs(i); return XH >= lim && XH <= H2_UFL && XO >= O2_LOC; };
function burnStep(dt){
  for(let i=0;i<N;i++){ if(wall[i]) continue;
    if(!burn[i]){ if(flam(i, H2_LFL) && (T[i] >= H2_IGN || hot[i])){ burn[i] = 1; prog[i] = 0; } continue; }
    if(!flam(i, H2_LFL)){ burn[i] = 0; continue; }
    const S = H2_TURB*sl(XH), o = i*4, f = Math.min(1, dt*S/MPC);
    const dn = Math.min(n[o+2]*f, n[o+1]/0.5);
    n[o+2] -= dn; n[o+1] -= 0.5*dn; n[o+3] += dn; e[i] += dn*(QH2 + LM);
    prog[i] += f;
    if(prog[i] >= 1){ const x = i%W;
      const tryIg = (j, lim) => { if(j >= 0 && j < N && !burn[j] && flam(j, lim)){ burn[j] = 2; prog[j] = 0; } };
      tryIg(i-W, H2_LFL); tryIg(i+W, LFL_DOWN); if(x > 0) tryIg(i-1, LFL_SIDE); if(x < W-1) tryIg(i+1, LFL_SIDE); } }
  for(let i=0;i<N;i++) if(burn[i] === 2) burn[i] = 1;
}

function step(dt){
  if(!L.ready) return;
  L.dt = dt;
  sources(dt);
  lateral(dt); water();
  temps(); regions();
  gas();
  temps();
  push();
  temps();
  phase(dt);
  temps();
  burnStep(dt);
  temps(); pressures();
  for(let i=0;i<N;i++){ if(wall[i]) continue; const r = reg[i], g = ((r >= 0 ? regP[r] : bodyP(i, zMid((i/W)|0))) - P0)/1000; if(g > pk[i]) pk[i] = g; }
  L.t += dt; L.tick++;
}

// the charge's energy lands in a 3x3 patch; the room's pressure follows from it, the local peak falls off as 1/r
function blast(cell, kPa){
  if(cell < 0 || wall[cell]) return;
  const cx = cell%W, cy = (cell/W)|0, cells = [];
  for(let y=cy-1;y<=cy+1;y++) for(let x=cx-1;x<=cx+1;x++){ const i = y*W+x; if(x >= 0 && y >= 0 && x < W && y < H && gasCell(i)) cells.push(i); }
  if(!cells.length) return;
  const E = kPa*1000*cells.length*Vc/0.4;
  for(const i of cells) e[i] += E/cells.length;
  for(let i=0;i<N;i++){ if(wall[i]) continue; const d = Math.hypot(i%W - cx, ((i/W)|0) - cy);
    pk[i] = Math.max(pk[i], kPa*Math.min(1, 1.5/Math.max(d, 1e-9))); }
  temps(); regions();
}

const src = {
  name: "CELLULAR",
  ok: () => L.ready,
  T: i => wall[i] ? NaN : gasCell(i) ? T[i] : T0 + ew[i]/(CW*Math.max(1e-9, w[i]*RHO_W*Vc)),
  P: i => { if(wall[i]) return 0; const r = reg[i]; return ((r >= 0 ? regP[r] : bodyP(i, zMid((i/W)|0))) - P0)/1000; },
  pk: i => pk[i],
  h2f: i => { fracs(i); return XH; },
  o2f: i => { fracs(i); return XO; },
  vap: i => n[i*4+3]*MX[3],
  gas: i => gasKg(i),
  water: i => w[i]*RHO_W*Vc,
  waterT: i => w[i] > 0 ? T0 + ew[i]/(CW*w[i]*RHO_W*Vc) : NaN,
  flame: i => burn[i] === 1,
  lump: i => wall[i] ? -1 : reg[i] >= 0 ? reg[i] : -2 - body[i],
  door: () => false,
  info: i => { if(wall[i]) return "WALL"; const r = reg[i];
    return r >= 0 ? "GAS POCKET " + r + "  " + regV[r].toFixed(0) + " m3 of gas" : "UNDER WATER, body " + body[i]; },
  tot: () => { const r = {gas:0, h2:0, o2:0, vap:0, wat:0, pool:0, pk:0, maxT:-1e9};
    for(let i=0;i<N;i++){ if(wall[i]) continue; r.gas += gasKg(i); r.h2 += n[i*4+2]*MX[2]; r.o2 += n[i*4+1]*MX[1]; r.vap += n[i*4+3]*MX[3];
      r.wat += w[i]*RHO_W*Vc; if(gasCell(i) && T[i] > r.maxT) r.maxT = T[i]; }
    for(let k=0;k<L.nr;k++) r.pk = Math.max(r.pk, (regP[k] - P0)/1000);
    return r; },
};

return { build, reset, step, blast, src, L,
  inject: (kind, rate, cell) => { L.inj = {kind, rate, cell}; },
  off: () => { L.inj = null; } };
})();
