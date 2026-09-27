"use strict";
/* Room contents by game rules, a mockup: water moves on a speed per face, down between cells and sideways as shallow water
   between wall-to-wall column pieces (the pipe model), gas is a per-cell mixture stirred and sorted by buoyancy, and
   pressure is one number per connected gas pocket. Every mol and joule is booked; the motion is a rule, not a law. */
const CELLR = (() => {
const G = 9.81, T0 = 273.15, RU = 8.314462618, CW = 4190, LV = 2.257e6, RHO_W = 1000;
const MX = [0.028013, 0.031998, 0.002016, 0.018015], CV = [20.8, 21.1, 20.4, 25.3];   // N2+Ar, O2, H2, H2O: kg/mol, J/mol/K
const LM = LV*MX[3], MWC = MX[3]*CW, QH2 = 240.6e3;   // J/mol: latent, liquid heat per K, H2 burnt at constant volume to vapour
const W_MIN = 1e-5, W_FULL = 0.98;
// a plume draws air in and sheds little sideways, so the side stir is a fraction of the up-and-down one
const K_MIX = 0.01, K_SIDE = 0.002, H_WALL = 5, H_WG = 10;
// Coward and Jones (1952): a hydrogen-air flame travels up at 4.1 %, sideways at 6.0 %, down at 9.0 %
const LFL_SIDE = 0.06, LFL_DOWN = 0.09;
const L = {ready:false, t:0, dt:0.02, inj:null, nr:0, nb:0, tick:0, gasX:1, lim:0};
let W = 0, H = 0, N = 0, Vc = 0, Af = 0, P0 = 0;
let sX, sY0, sY1, sW, sLvl, sHead, sTop, sRoom, sOut, sIn, sRem, sE, inLn, inLd, inRn, inRd, fS, fT, fY0, fY1, fU, fQ, fq, fk;
let fV, fV0, qV, sV, vOut, vIn, eR, pOf, mk;
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
  const segOf = pOf = new Int32Array(N).fill(-1), sx = [], s0 = [], s1 = [];
  for(let x=0;x<W;x++) for(let y=0;y<H;){ if(wall[y*W+x]){ y++; continue; }
    let e2 = y; while(e2+1 < H && !wall[(e2+1)*W+x]) e2++;
    for(let k=y;k<=e2;k++) segOf[k*W+x] = sx.length;
    sx.push(x); s0.push(y); s1.push(e2); y = e2+1; }
  sX = Int32Array.from(sx); sY0 = Int32Array.from(s0); sY1 = Int32Array.from(s1);
  const nS = sx.length;
  sW = F(nS); sLvl = F(nS); sHead = F(nS); sTop = new Int32Array(nS); sRoom = F(nS); sOut = F(nS); sIn = F(nS); sRem = F(nS); sE = F(nS);
  inLn = F(nS); inLd = F(nS); inRn = F(nS); inRd = F(nS);
  const fs = [], ft = [], f0 = [], f1 = [];
  for(let s=0;s<sx.length;s++){ if(sx[s] === W-1) continue; const seen = new Set();
    for(let y=s0[s];y<=s1[s];y++){ const t = segOf[y*W + sx[s] + 1]; if(t < 0 || seen.has(t)) continue; seen.add(t);
      fs.push(s); ft.push(t); f0.push(Math.max(s0[s], s0[t])); f1.push(Math.min(s1[s], s1[t])); } }
  fS = Int32Array.from(fs); fT = Int32Array.from(ft); fY0 = Int32Array.from(f0); fY1 = Int32Array.from(f1); fU = F(fs.length); fQ = F(fs.length); fq = F(fs.length); fk = F(fs.length);
  fV = F(N); fV0 = F(N); qV = F(N); sV = F(N); vOut = F(N); vIn = F(N); eR = F(N); mk = new Uint8Array(N);
  reg = new Int32Array(N); regP = F(N); regV = F(N); regNT = F(N); body = new Int32Array(N); bTopZ = F(N); bTopP = F(N); bTopR = new Int32Array(N); rho = F(N);
  burn = new Uint8Array(N); prog = F(N); pk = F(N); hot = new Uint8Array(N); stack = new Int32Array(N);
  reset();
}

function reset(){
  n.fill(0); e.fill(0); w.fill(0); ew.fill(0); fU.fill(0); fQ.fill(0); fV.fill(0); burn.fill(0); prog.fill(0); pk.fill(0);
  const n0 = P0*Vc/(RU*T_HULL);
  for(let i=0;i<N;i++){ if(wall[i]) continue;
    n[i*4] = n0*(1 - O2_FRAC0); n[i*4+1] = n0*O2_FRAC0; e[i] = (n[i*4]*CV[0] + n[i*4+1]*CV[1])*(T_HULL - T0); }
  L.t = 0; L.tick = 0; L.lim = 0; L.inj = null; L.ready = true;
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
// v dv/dx carried upwind in Bernoulli's form d(v^2/2)/dx: a steady stream gains v^2 = 2 a L across a face
const faceV = (v, a, vUp, c, dt) => (v + dt*(a + vUp*Math.abs(vUp)/(2*MPC)))/(1 + dt*(c + Math.abs(v)/(2*MPC)));
// shallow water sideways: a column piece (wall to wall) holds the water standing on its floor; the face to its neighbour carries a speed,
// pushed by the level difference plus the gas pressing on each surface. Water leaves from the top of the standing stack, lands at the face and falls.
function lateral(dt){
  const nS = sX.length, nF = fS.length, n2g = G*LIQ_MANNING*LIQ_MANNING;
  for(let s=0;s<nS;s++){ const x = sX[s]; let sum = 0, ya = sY1[s];
    for(let y=sY1[s];y>=sY0[s];y--){ const f = w[y*W+x]; sum += f; ya = y; if(f < W_FULL) break; }
    const i = ya*W + x;
    // a column full to its ceiling feels the gas pressing on its top from the side; the block collapses under it instead of hanging
    let r = reg[i] >= 0 ? reg[i] : ya > sY0[s] ? reg[i-W] : -1;
    if(r < 0) r = x > 0 && reg[i-1] >= 0 ? reg[i-1] : x < W-1 && reg[i+1] >= 0 ? reg[i+1] : body[i] >= 0 ? bTopR[body[i]] : -1;
    sW[s] = sum; sTop[s] = ya; sRoom[s] = 0; sLvl[s] = zBot(sY1[s]) + sum*MPC; sHead[s] = sLvl[s] + gasHead(r);
    sOut[s] = 0; sIn[s] = 0; inLn[s] = 0; inLd[s] = 0; inRn[s] = 0; inRd[s] = 0; }
  // the speed carried into a donor is last tick's inflow from its far side, weighted by what each face moved
  for(let f=0;f<nF;f++){ const q = fQ[f];
    if(q > 0){ inLn[fT[f]] += q*fU[f]; inLd[fT[f]] += q; } else if(q < 0){ inRn[fS[f]] -= q*fU[f]; inRd[fS[f]] -= q; } }
  for(let f=0;f<nF;f++){ const s = fS[f], t = fT[f], zlo = zBot(fY1[f]), zhi = zBot(fY0[f]) + MPC;
    const a = G*(faceHead(s, f) - faceHead(t, f))/MPC, v = fU[f], right = v + dt*a > 0, d = right ? s : t, wet = Math.min(sLvl[d], zhi) - zlo;
    fq[f] = 0; fQ[f] = 0; fk[f] = 1;
    if(!(wet > 0) || !(sW[d] > W_MIN)){ fU[f] = 0; continue; }
    const vUp = right ? (inLd[d] > 0 ? inLn[d]/inLd[d] : 0) : (inRd[d] > 0 ? inRn[d]/inRd[d] : 0);
    const u = faceV(v, a, vUp, n2g*Math.abs(v)/Math.pow(Math.max(wet, 1e-3), 4/3), dt);
    fU[f] = u; fq[f] = Math.abs(u)*dt*wet/(MPC*MPC); sOut[d] += fq[f]; }
  // Mei et al. 2007: every face out of a donor scaled by one K, so it sends at most what stands in it
  for(let f=0;f<nF;f++) if(fq[f] > 0){ const d = fU[f] > 0 ? fS[f] : fT[f]; if(sOut[d] > sW[d]) fk[f] = sW[d]/sOut[d]; }
  // water crosses a face no higher than the donor's surface; a receiver takes what the cells its faces reach have room for, shared alike
  for(let f=0;f<nF;f++) if(fq[f] > 0){ const d = fU[f] > 0 ? fS[f] : fT[f], r = fU[f] > 0 ? fT[f] : fS[f], x = sX[r];
    sIn[r] += fq[f]*fk[f];
    for(let y=landRow(f, r);y>=topRow(f, d);y--){ const k = y*W + x; if(!mk[k]){ mk[k] = 1; sRoom[r] += Math.max(0, 1 - w[k]); } } }
  for(let f=0;f<nF;f++) if(fq[f] > 0){ const d = fU[f] > 0 ? fS[f] : fT[f], r = fU[f] > 0 ? fT[f] : fS[f], x = sX[r];
    if(sIn[r] > sRoom[r]) fk[f] *= sRoom[r]/sIn[r];
    for(let y=landRow(f, r);y>=topRow(f, d);y--) mk[y*W + x] = 0; }
  for(let s=0;s<nS;s++) sOut[s] = 0;
  for(let f=0;f<nF;f++) if(fq[f] > 0) sOut[fU[f] > 0 ? fS[f] : fT[f]] += fq[f]*fk[f];
  for(let s=0;s<nS;s++){ sE[s] = 0; sRem[s] = 0; let rem = sOut[s]; if(!(rem > 0)) continue; const x = sX[s];
    for(let y=sTop[s];y<=sY1[s] && rem > 0;y++){ const k = y*W + x; if(!(w[k] > 0)) continue;
      const g = Math.min(w[k], rem), qe = g >= w[k] ? ew[k] : ew[k]*g/w[k]; w[k] -= g; ew[k] -= qe; if(!(w[k] > 0)){ w[k] = 0; ew[k] = 0; }
      rem -= g; sE[s] += qe; sRem[s] += g; } }
  for(let f=0;f<nF;f++){ if(!(fq[f] > 0)) continue;
    const right = fU[f] > 0, d = right ? fS[f] : fT[f], r = right ? fT[f] : fS[f], q = fq[f]*fk[f]*sRem[d]/sOut[d], eu = sE[d]/sRem[d];
    const put = q > 0 ? land(sTop[d]*W + sX[d], sX[r], landRow(f, r), topRow(f, d), q, eu) : 0;
    // two faces reaching one cell can leave the later one short; what finds no room stays with its donor
    if(put < q){ const back = q - put, got = land(-1, sX[d], sY1[d], sY0[d], back, eu), k = sTop[d]*W + sX[d];
      if(got < back){ w[k] += back - got; ew[k] += (back - got)*eu; } }
    fU[f] *= q > 0 ? fk[f]*put/q : fk[f]; fQ[f] = right ? put : -put; }
}
const landRow = (f, r) => Math.max(fY0[f], Math.min(fY1[f], sTop[r])), topRow = (f, d) => Math.max(fY0[f], sTop[d]);
// a face above a piece's standing water meets what is held at the face (a weir crest, a column over a hole), not the floor below it
function faceHead(p, f){
  if(fY1[f] >= sTop[p]) return sHead[p];
  const x = sX[p]; let sum = 0;
  for(let y=fY1[f];y>=sY0[p];y--){ const v = w[y*W+x]; sum += v; if(v < W_FULL) break; }
  return Math.max(sHead[p], zBot(fY1[f]) + sum*MPC + sHead[p] - sLvl[p]);
}
// it lands at the face, or the first cell above it with room up to the donor's surface; returns what it placed
function land(src, x, y, y0, q, eu){
  let put = q;
  for(let k=y;k>=y0 && put > 0;k--) put -= fill(src, k*W + x, put, eu);
  if(put > 0 && put < 1e-12*q){ w[y*W + x] += put; ew[y*W + x] += put*eu; put = 0; }
  return q - put;
}
// air crosses back only inside one pocket: a sealed bell keeps its air and is squeezed instead
function fill(src, k, put, eu){
  const g = Math.min(put, Math.max(0, 1 - w[k])); if(!(g > 0)) return 0;
  if(src >= 0 && reg[k] >= 0 && reg[k] === (reg[src] >= 0 ? reg[src] : src >= W ? reg[src - W] : -1)) trade(src, k, g);
  w[k] += g; ew[k] += g*eu; return g;
}
// water arriving in a cell sends the same volume of that cell's gas back where the water came from: water and air trade places, no void opens
function trade(src, dst, f){
  const vg = Vc*Math.max(0, 1 - Math.min(1, w[dst])); if(!(vg > 0) || !(f > 0)) return;
  const g = Math.min(1, f*Vc/vg), od = dst*4, os = src*4;
  for(let s=0;s<4;s++){ const q = n[od+s]*g; n[od+s] -= q; n[os+s] += q; }
  const de = e[dst]*g; e[dst] -= de; e[src] += de;
}
const pStand = (s, z) => P0 + RHO_W*G*(sHead[s] - z);
// water standing in its column carries the head over it, and so does a full cell beside a standing column (over a hole); water in the air reads its pocket
const pAt = i => { const r = reg[i], y = (i/W)|0, z = zMid(y), x = i%W, s = pOf[i];
  let p = r >= 0 ? regP[r] : body[i] >= 0 ? bTopP[body[i]] : P0;
  if(y >= sTop[s]) return Math.max(p, pStand(s, z));
  if(!(w[i] >= W_FULL)) return p;
  if(x > 0 && !wall[i-1] && y >= sTop[pOf[i-1]]) p = Math.max(p, pStand(pOf[i-1], z));
  if(x < W-1 && !wall[i+1] && y >= sTop[pOf[i+1]]) p = Math.max(p, pStand(pOf[i+1], z));
  return p; };
// the speed carried in over the donor's far face: what flows in there, none off a wall or still water, the donor's own at a free surface
const vFar = (k, far, v, s) => k < 0 || k >= N || wall[k] ? 0 : s*fV0[far] > 0 ? fV0[far] : w[k] > 0 ? 0 : s*v > 0 ? v : 0;
// down between cells: g plus the pressure difference across the face, so a standing body holds and a hole under it carries its head.
// The air the water lands in trades up into the cell it left, so a trapped bubble rises and a hanging slab drops.
function fall(dt){
  fV0.set(fV); vOut.fill(0);
  for(let i=0;i<N-W;i++){ const j = i + W; qV[i] = 0; sV[i] = 1;
    if(wall[i] || wall[j]){ fV[i] = 0; continue; }
    const v = fV0[i], a = G + (pAt(i) - pAt(j))/(RHO_W*MPC), down = v + dt*a > 0, d = down ? i : j;
    if(!(w[d] > 0)){ fV[i] = 0; continue; }
    const u = faceV(v, a, down ? vFar(i - W, i - W, v, 1) : vFar(j + W, j, v, -1), 0, dt);
    fV[i] = u; qV[i] = Math.abs(u)*dt*w[d]/MPC; vOut[d] += qV[i]; }
  for(let i=0;i<N-W;i++) if(qV[i] > 0){ const d = fV[i] > 0 ? i : i + W; if(vOut[d] > w[d]) sV[i] = w[d]/vOut[d]; }
  if(!limitV(true)){ L.lim++; limitV(false); }
  vOut.fill(0);
  for(let i=0;i<N-W;i++) if(qV[i] > 0) vOut[fV[i] > 0 ? i : i + W] += qV[i]*sV[i];
  for(let i=0;i<N;i++){ const q = vOut[i]; vIn[i] = 1; if(!(q > 0)) continue;
    eR[i] = ew[i]/w[i];
    if(q >= w[i]){ vIn[i] = w[i]/q; w[i] = 0; ew[i] = 0; } else { w[i] -= q; ew[i] -= q*eR[i]; } }
  for(let i=0;i<N-W;i++){ if(!(qV[i] > 0)) continue;
    const down = fV[i] > 0, d = down ? i : i + W, r = down ? i + W : i, q = qV[i]*sV[i]*vIn[d];
    fV[i] *= sV[i];
    if(q > 0){ trade(d, r, q); w[r] += q; ew[r] += q*eR[d]; } }
}
// the same limiter per cell, bottom row first so a falling column clears from its foot
function limitV(credit){
  for(let it=0;it<(credit ? FACE_TAIL : 1);it++){ let ok = true;
    vOut.fill(0); vIn.fill(0);
    for(let i=0;i<N-W;i++) if(qV[i] > 0){ const q = qV[i]*sV[i]; if(fV[i] > 0){ vOut[i] += q; vIn[i+W] += q; } else { vOut[i+W] += q; vIn[i] += q; } }
    for(let r=N-1;r>=0;r--){ const room = Math.max(0, 1 - w[r]) + (credit ? vOut[r] : 0);
      if(!(vIn[r] > room*(1 + 1e-12))) continue;
      const k = room/vIn[r]; ok = false;
      if(r >= W && qV[r-W] > 0 && fV[r-W] > 0){ vOut[r-W] -= qV[r-W]*sV[r-W]*(1 - k); sV[r-W] *= k; }
      if(r < N-W && qV[r] > 0 && fV[r] < 0){ vOut[r+W] -= qV[r]*sV[r]*(1 - k); sV[r] *= k; }
      vIn[r] = room; }
    if(ok) return true; }
  return !credit;
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
  lateral(dt); fall(dt);
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
  off: () => { L.inj = null; },
  // water laid at rest at the hull's temperature, the gas it displaces taken out
  lay: (i, f) => { for(let s=0;s<4;s++) n[i*4+s] *= 1 - f; e[i] *= 1 - f; w[i] = f; ew[i] = f*RHO_W*Vc*CW*(T_HULL - T0); temps(); regions(); },
  uAt: (x, y) => { for(let f=0;f<fS.length;f++) if(sX[fS[f]] === x && y >= fY0[f] && y <= fY1[f]) return fU[f]; return 0; },
  get w(){ return w; }, get fU(){ return fU; }, get fV(){ return fV; } };
})();
