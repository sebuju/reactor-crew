"use strict";
/* Lumped room gas + water, a mockup set beside the live cell grid in fluidbench.
   Rooms are cut at doors, each room into bands of BAND rows; one control volume per band piece,
   one junction per shared face set. Gas flow is one implicit orifice solve over the volumes. */
const LUMP = (() => {
const G = 9.81, BAND = 6, DOOR_MAX = 4, CD = 0.6, CW = 4.19, RHO_W = 1000, T0 = 273.15;
const H_CONV = 0.005, H_SURF = 0.01, K_EVAP = 0.003, DP_LAM = 1e-3;
// Coward and Jones (1952): a hydrogen-air flame travels up at 4.1 %, sideways at 6.0 %, down at 9.0 %
const LFL_SIDE = 0.06, LFL_DOWN = 0.09;
const SP = [ROOM_SP_AIR, ROOM_SP_O2, ROOM_SP_VAP, ROOM_SP_H2], MM = [AIR_MMOL, O2_MMOL, H2O_MMOL, H2_MMOL];
const R_V = ROOM_SP_R[ROOM_SP_VAP], IO = new Float64Array(3);
const L = {n:0, nj:0, nc:0, t:0, inj:null, ready:false};
let W = 0, H = 0, Vc = 0, Af = 0, OFF = 0, STEAM_H = 0, XH = 0, XO = 0;
let dv, isDoor, volOf, plume;
let m, dM, U, dU, T, P, Pref, Vg, V, Z, M, GAM, pk, burn, burnT, hot, vComp, aWall, vRow0, rowY, rowN, vCnt, outKg;
let ja, jb, jv, jDoor, jA, jz, jlo, jhi, jC, jW, jG;
let cRowN, cFill, cBot, cSurfV, cSurfRow, cLvl, mW, eW;
let Amat, bvec;

const zMid = y => (H - y - 0.5)*MPC, zBot = y => (H - y - 1)*MPC;
function spA(s, t){ IO[2] = t; roomSpA(SP[s], IO, 2, 0); }
const hl = t => CW*(t - T0);
const psat = t => t < 647 ? satP(SAT_WATER, t)*1000 : 1e9;
const hg = t => satHg(SAT_WATER, Math.min(22, psat(t)/1000));
const sl = x => { if(x <= H2_SL[0][0] || x >= H2_SL[H2_SL.length-1][0]) return 0;
  for(let k=1;k<H2_SL.length;k++) if(x <= H2_SL[k][0]){ const a = H2_SL[k-1], b = H2_SL[k]; return a[1] + (b[1]-a[1])*(x-a[0])/(b[0]-a[0]); }
  return 0; };

function build(){
  W = GW; H = GH; Vc = MPC*MPC*ROOM_DEPTH; Af = MPC*ROOM_DEPTH;
  spA(2, 373.15); OFF = hg(373.15) - R_V*373.15 - IO[1];
  STEAM_H = roomSteamH() + hl(T_HULL);
  const N0 = W*H, wall = new Uint8Array(N0);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) wall[y*W+x] = matWall(x, y) ? 1 : 0;
  const isW = (x, y) => x < 0 || y < 0 || x >= W || y >= H || wall[y*W+x] === 1;
  // a door is a short gap in a thin wall line; a corridor between two thick walls is not one
  isDoor = new Int8Array(N0);
  for(let x=0;x<W;x++) for(let y=0;y<H;){
    if(isW(x, y)){ y++; continue; }
    let e = y; while(!isW(x, e+1)) e++;
    if(y > 0 && e < H-1 && e-y < DOOR_MAX && ((!isW(x-1, y-1) && !isW(x+1, y-1)) || (!isW(x-1, e+1) && !isW(x+1, e+1))))
      for(let k=y;k<=e;k++) isDoor[k*W+x] = 1;
    y = e+1;
  }
  for(let y=0;y<H;y++) for(let x=0;x<W;){
    if(isW(x, y)){ x++; continue; }
    let e = x; while(!isW(e+1, y)) e++;
    if(x > 0 && e < W-1 && e-x < DOOR_MAX && ((!isW(x-1, y-1) && !isW(x-1, y+1)) || (!isW(e+1, y-1) && !isW(e+1, y+1))))
      for(let k=x;k<=e;k++) if(!isDoor[y*W+k]) isDoor[y*W+k] = 2;
    x = e+1;
  }
  const open = i => !wall[i] && !isDoor[i];
  const compOf = new Int32Array(N0).fill(-1), stack = new Int32Array(N0);
  volOf = new Int32Array(N0).fill(-1);
  const flood = (lab, i0, id, same) => { let sp = 0; stack[sp++] = i0; lab[i0] = id;
    while(sp){ const i = stack[--sp], x = i%W, y = (i/W)|0;
      for(let k=0;k<4;k++){ const j = k === 0 ? (x > 0 ? i-1 : -1) : k === 1 ? (x < W-1 ? i+1 : -1) : k === 2 ? (y > 0 ? i-W : -1) : (y < H-1 ? i+W : -1);
        if(j >= 0 && lab[j] < 0 && open(j) && same(i, j)){ lab[j] = id; stack[sp++] = j; } } } };
  const band = i => ((i/W)|0)/BAND|0;
  let nc = 0, n = 0;
  for(let i=0;i<N0;i++) if(open(i) && compOf[i] < 0) flood(compOf, i, nc++, () => true);
  for(let i=0;i<N0;i++) if(open(i) && volOf[i] < 0) flood(volOf, i, n++, (a, b) => band(a) === band(b));
  L.n = n; L.nc = nc;
  const F = k => new Float64Array(k);
  m = F(4*n); dM = F(4*n); U = F(n); dU = F(n); T = F(n); P = F(n); Pref = F(n); Vg = F(n); V = F(n); Z = F(n); M = F(n);
  GAM = F(n); pk = F(n); burnT = F(n); aWall = F(n); vCnt = F(n); outKg = F(n);
  burn = new Uint8Array(n); hot = new Uint8Array(n); vComp = new Int32Array(n);
  cRowN = new Int32Array(nc*H); cFill = F(nc*H); cBot = F(nc).fill(1e9); cSurfV = new Int32Array(nc*H).fill(-1);
  cSurfRow = new Int32Array(nc); cLvl = F(nc); mW = F(nc); eW = F(nc);
  const vr = new Int32Array(n*H);
  for(let i=0;i<N0;i++){ const v = volOf[i]; if(v < 0) continue;
    const x = i%W, y = (i/W)|0, c = compOf[i];
    vComp[v] = c; vCnt[v]++; Z[v] += zMid(y); vr[v*H+y]++; cRowN[c*H+y]++; cBot[c] = Math.min(cBot[c], zBot(y));
    aWall[v] += 2*MPC*MPC + Af*((isW(x-1, y) ? 1 : 0) + (isW(x+1, y) ? 1 : 0) + (isW(x, y-1) ? 1 : 0) + (isW(x, y+1) ? 1 : 0)); }
  vRow0 = new Int32Array(n+1); const ry = [], rn = [];
  for(let v=0;v<n;v++){ V[v] = vCnt[v]*Vc; Z[v] /= vCnt[v]; vRow0[v] = ry.length;
    for(let y=0;y<H;y++) if(vr[v*H+y]){ ry.push(y); rn.push(vr[v*H+y]);
      const k = vComp[v]*H+y, s = cSurfV[k]; if(s < 0 || vr[s*H+y] < vr[v*H+y]) cSurfV[k] = v; } }
  vRow0[n] = ry.length; rowY = Int32Array.from(ry); rowN = Int32Array.from(rn);
  dv = Int32Array.from(volOf);
  const at = (x, y) => isW(x, y) ? -1 : volOf[y*W+x];
  for(let i=0;i<N0;i++){ if(!isDoor[i]) continue; const x = i%W, y = (i/W)|0;
    dv[i] = isDoor[i] === 1 ? (at(x-1, y) >= 0 ? at(x-1, y) : at(x+1, y)) : (at(x, y-1) >= 0 ? at(x, y-1) : at(x, y+1)); }
  // a buoyant source lands where its plume stops: straight up to the room's ceiling (the CFAST fire-plume rule)
  plume = Int32Array.from(dv);
  for(let i=0;i<N0;i++){ if(dv[i] < 0) continue; let k = i; while(k >= W && volOf[k-W] >= 0) k -= W; plume[i] = volOf[k] >= 0 ? volOf[k] : dv[i]; }
  const jm = new Map(), js = [];
  const put = (a, b, door, vert, z, lo, hi) => { if(a < 0 || b < 0 || a === b) return;
    const key = a + "," + b + "," + door; let r = jm.get(key);
    if(!r){ r = {a, b, door, vert, A:0, zA:0, lo:1e9, hi:-1e9}; jm.set(key, r); js.push(r); }
    r.A += Af; r.zA += Af*z; r.lo = Math.min(r.lo, lo); r.hi = Math.max(r.hi, hi); };
  for(let i=0;i<N0-W;i++){ const y = (i/W)|0; put(volOf[i], volOf[i+W], 0, 1, zBot(y), zBot(y), zBot(y)); }
  for(let i=0;i<N0;i++){ if(!isDoor[i]) continue; const x = i%W, y = (i/W)|0;
    if(isDoor[i] === 1) put(at(x-1, y), at(x+1, y), 1, 0, zMid(y), zBot(y), zBot(y)+MPC);
    else put(at(x, y-1), at(x, y+1), 1, 1, zMid(y), zBot(y), zBot(y)+MPC); }
  const nj = L.nj = js.length;
  ja = new Int32Array(nj); jb = new Int32Array(nj); jv = new Uint8Array(nj); jDoor = new Uint8Array(nj);
  jA = F(nj); jz = F(nj); jlo = F(nj); jhi = F(nj); jC = F(nj); jW = F(nj); jG = F(nj);
  js.forEach((r, j) => { ja[j] = r.a; jb[j] = r.b; jv[j] = r.vert; jDoor[j] = r.door; jA[j] = r.A; jz[j] = r.zA/r.A;
    jlo[j] = r.lo; jhi[j] = r.hi; jC[j] = (r.door ? CD : 1)*r.A; });
  Amat = F(n*n); bvec = F(n);
  reset();
}

function reset(){
  const n = L.n;
  m.fill(0); burn.fill(0); burnT.fill(0); pk.fill(0); mW.fill(0); eW.fill(0);
  levels();
  const Ra = ROOM_SP_R[ROOM_SP_AIR];
  for(let v=0;v<n;v++){ Pref[v] = ROOM_P0 - ROOM_RHO*G*Z[v]/1000; T[v] = T_HULL;
    m[v*4] = Pref[v]*Vg[v]/(Ra*T_HULL); spA(0, T_HULL); U[v] = m[v*4]*IO[1]; }
  eos();
  L.t = 0; L.inj = null; L.ready = true;
}

function levels(){
  for(let c=0;c<L.nc;c++){ let vol = mW[c]/RHO_W, lvl = cBot[c], sr = -1, lo = -1;
    for(let y=H-1;y>=0;y--){ const k = c*H+y, rn = cRowN[k]; if(!rn){ cFill[k] = 0; continue; }
      if(lo < 0) lo = y;
      const rv = rn*Vc;
      if(vol >= rv){ cFill[k] = 1; vol -= rv; lvl = zBot(y) + MPC; }
      else { const f = vol/rv; cFill[k] = f; if(vol > 0) lvl = zBot(y) + f*MPC; vol = 0; if(sr < 0) sr = y; } }
    cLvl[c] = lvl; cSurfRow[c] = sr >= 0 ? sr : lo; }
  for(let v=0;v<L.n;v++){ let g = 0; const c = vComp[v];
    for(let k=vRow0[v];k<vRow0[v+1];k++) g += rowN[k]*Vc*(1 - cFill[c*H+rowY[k]]);
    Vg[v] = Math.max(g, 0.01*V[v]); }
}

function eos(){
  for(let v=0;v<L.n;v++){ const o = v*4; let mm = 0, n = 0;
    for(let s=0;s<4;s++){ mm += m[o+s]; n += m[o+s]/MM[s]; }
    M[v] = mm;
    let t = T[v], cp = 0, cv = 1;
    for(let it=0;it<5;it++){ let f = -U[v]; cp = 0; cv = 0;
      for(let s=0;s<4;s++){ spA(s, t); f += m[o+s]*IO[1]; cp += m[o+s]*IO[0]; cv += m[o+s]*(IO[0] - ROOM_SP_R[SP[s]]); }
      const d = f/cv; t = Math.min(5000, Math.max(150, t - d)); if(Math.abs(d) < 1e-6) break; }
    T[v] = t; GAM[v] = cp/cv; P[v] = n*RGAS_U*t/Vg[v]/1000; }
}

function addGas(v, s, dm, t){ spA(s, t); m[v*4+s] += dm; U[v] += dm*(IO[1] + ROOM_SP_R[SP[s]]*t); }
function takeGas(v, dm){ dm = Math.min(dm, 0.5*M[v]); if(!(dm > 0)) return; const f = dm/M[v], o = v*4;
  U[v] -= dm*(U[v] + P[v]*Vg[v])/M[v]; for(let s=0;s<4;s++) m[o+s] -= m[o+s]*f; }

function sources(dt){
  hot.fill(0);
  const q = L.inj; if(!q) return;
  const v = dv[q.cell]; if(v < 0) return;
  const c = vComp[v], wet = cFill[c*H + ((q.cell/W)|0)] >= 0.5, r = q.rate, up = plume[q.cell];
  if(q.kind === "heat"){
    if(wet){ eW[c] += r*dt; return; }
    U[r > 0 ? up : v] += r*dt;
    if(r > 0 && T[v] + r/(H_SURF*(2*Af + 2*MPC*MPC)) >= H2_IGN_SURF) hot[v] = 1;
  }
  else if(q.kind === "h2") r > 0 ? addGas(up, 3, r*dt, T_HULL) : takeGas(v, -r*dt);
  else if(q.kind === "o2") r > 0 ? addGas(v, 1, r*dt, T_HULL) : takeGas(v, -r*dt);
  else if(q.kind === "steam"){ if(r > 0){ m[up*4+2] += r*dt; U[up] += r*dt*(STEAM_H - OFF); } else takeGas(v, -r*dt); }
  else if(q.kind === "gas") takeGas(v, Math.abs(r)*dt);
  else if(q.kind === "fluid"){
    if(r > 0){ mW[c] += r*dt; eW[c] += r*dt*hl(T_HULL); }
    else if(mW[c] > 0){ const dm = Math.min(mW[c], -r*dt); eW[c] -= dm*eW[c]/mW[c]; mW[c] -= dm; }
  }
}

function move(d, r, q){ const f = q/M[d], od = d*4, or = r*4;
  for(let s=0;s<4;s++){ const x = m[od+s]*f; dM[od+s] -= x; dM[or+s] += x; }
  const e = q*(U[d] + P[d]*Vg[d])/M[d]; dU[d] -= e; dU[r] += e; }
function commit(){ for(let k=0;k<m.length;k++){ m[k] += dM[k]; dM[k] = 0; } for(let v=0;v<L.n;v++){ U[v] += dU[v]; dU[v] = 0; } }
const rhoOf = v => M[v]/Vg[v];

function flow(dt){
  const n = L.n, A = Amat, b = bvec;
  A.fill(0); b.fill(0);
  for(let v=0;v<n;v++) A[v*n+v] = 1;
  for(let j=0;j<L.nj;j++){ const a = ja[j], c = jb[j], ra = rhoOf(a), rc = rhoOf(c);
    const d0 = (P[a] - ra*G*(jz[j] - Z[a])/1000) - (P[c] - rc*G*(jz[j] - Z[c])/1000);
    const K = jC[j]*Math.sqrt(2000*(d0 >= 0 ? ra : rc)), s = Math.abs(d0) + DP_LAM;
    // chord, not tangent: the tangent of a square-root law lands a stiff pair on -d0 every step
    const g = K/Math.sqrt(s), w0 = g*d0;
    jW[j] = w0; jG[j] = g;
    // dp per kg is priced at the donor's enthalpy: a kg of hydrogen is seven times the moles of a kg of air
    const d = d0 >= 0 ? a : c, hd = (U[d] + P[d]*Vg[d])/M[d], ka = (GAM[a] - 1)*hd/Vg[a]*dt, kc = (GAM[c] - 1)*hd/Vg[c]*dt;
    A[a*n+a] += ka*g; A[a*n+c] -= ka*g; b[a] -= ka*w0;
    A[c*n+c] += kc*g; A[c*n+a] -= kc*g; b[c] += kc*w0; }
  for(let k=0;k<n;k++){ const p = A[k*n+k];
    for(let i=k+1;i<n;i++){ const f = A[i*n+k]/p; if(f === 0) continue;
      for(let j=k;j<n;j++) A[i*n+j] -= f*A[k*n+j]; b[i] -= f*b[k]; } }
  for(let k=n-1;k>=0;k--){ let s = b[k]; for(let j=k+1;j<n;j++) s -= A[k*n+j]*b[j]; b[k] = s/A[k*n+k]; }
  outKg.fill(0);
  for(let j=0;j<L.nj;j++){ const w = jW[j] += jG[j]*(b[ja[j]] - b[jb[j]]); outKg[w > 0 ? ja[j] : jb[j]] += Math.abs(w)*dt; }
  for(let j=0;j<L.nj;j++){ const w = jW[j], d = w > 0 ? ja[j] : jb[j], r = w > 0 ? jb[j] : ja[j];
    const q = Math.abs(w)*dt*(outKg[d] > 0.5*M[d] ? 0.5*M[d]/outKg[d] : 1); if(q > 0) move(d, r, q); }
  commit();
}

// buoyant counterflow: Epstein (1988) through a horizontal opening, a two-way door flow through a vertical one
function exchange(dt){
  for(let j=0;j<L.nj;j++){ const a = ja[j], c = jb[j], ra = rhoOf(a), rc = rhoOf(c), rbar = 0.5*(ra + rc);
    let Q = 0;
    if(jv[j]){ if(rc < ra){ const D = Math.sqrt(4*jA[j]/Math.PI); Q = 0.055*Math.sqrt(G*Math.pow(D, 5)*(ra - rc)/rbar); } }
    else { const h = jhi[j] - jlo[j]; Q = CD/3*ROOM_DEPTH*Math.sqrt(G*Math.abs(ra - rc)/rbar*h*h*h); }
    const dV = Math.min(Q*dt, 0.2*Math.min(Vg[a], Vg[c]));
    if(dV > 0){ move(a, c, dV*ra); move(c, a, dV*rc); } }
  commit();
}

function fracs(v){ const o = v*4, n = m[o]/MM[0] + m[o+1]/MM[1] + m[o+2]/MM[2] + m[o+3]/MM[3];
  XH = m[o+3]/MM[3]/n; XO = (ROOM_Y_O2*m[o] + m[o+1])/O2_MMOL/n; }
const flam = lim => XH >= lim && XH <= H2_UFL && XO >= O2_LOC;

function burnStep(dt){
  for(let v=0;v<L.n;v++){ fracs(v);
    if(!burn[v]){ if(flam(H2_LFL) && (T[v] >= H2_IGN || hot[v])){ burn[v] = 1; burnT[v] = 0; } continue; }
    if(!flam(H2_LFL)){ burn[v] = 0; continue; }
    const S = H2_TURB*sl(XH), Lc = Math.cbrt(Vg[v]), o = v*4;
    const dh = Math.min(m[o+3]*Math.min(1, dt*S/Lc), (ROOM_Y_O2*m[o] + m[o+1])/O2_PER_H2);
    m[o+3] -= dh; m[o+1] -= dh*O2_PER_H2; m[o+2] += dh*(1 + O2_PER_H2); U[v] += dh*E_H2_QV;
    burnT[v] += dt;
    if(burnT[v] >= Lc/Math.max(S, 1e-3)) spread(v); }
}
function spread(v){
  for(let j=0;j<L.nj;j++){ if(ja[j] !== v && jb[j] !== v) continue;
    const u = ja[j] === v ? jb[j] : ja[j]; if(burn[u]) continue;
    fracs(u);
    if(flam(!jv[j] ? LFL_SIDE : u === ja[j] ? H2_LFL : LFL_DOWN)){ burn[u] = 1; burnT[u] = 0; } }
}

function water(dt){
  for(let c=0;c<L.nc;c++){ const ys = cSurfRow[c], v = ys >= 0 ? cSurfV[c*H+ys] : -1;
    if(v < 0 || !(mW[c] > 1e-6)) continue;
    const A = cRowN[c*H+ys]*Af, o = v*4, ts = satT(SAT_WATER, P[v]/1000);
    let tp = T0 + eW[c]/(CW*mW[c]);
    if(tp > ts){ const hs = hl(ts), hgs = hg(ts), dm = Math.min(mW[c], (eW[c] - mW[c]*hs)/(hgs - hs));
      mW[c] -= dm; eW[c] = mW[c]*hs; m[o+2] += dm; U[v] += dm*(hgs - OFF); }
    else { const dm = Math.min(mW[c], Math.max(0, K_EVAP*A*(psat(tp)/(R_V*tp) - m[o+2]/Vg[v])*dt));
      if(dm > 0){ const h = hg(tp); mW[c] -= dm; eW[c] -= dm*h; m[o+2] += dm; U[v] += dm*(h - OFF); } }
    if(mW[c] > 1e-6){ tp = T0 + eW[c]/(CW*mW[c]); const q = H_CONV*A*(tp - T[v])*dt; eW[c] -= q; U[v] += q; } }
  const pw = psat(T_HULL);
  for(let v=0;v<L.n;v++){ const o = v*4, c = vComp[v];
    let pv = m[o+2]/H2O_MMOL*RGAS_U*T[v]/Vg[v]/1000;
    // Uchida (1965): wall condensation coefficient 380 (steam/air)^0.707 W/m2K, the walls held at the hull temperature
    const hw = pv > pw ? Math.max(H_CONV, 0.38*Math.pow(m[o+2]/Math.max(1e-9, m[o] + m[o+1]), 0.707)) : H_CONV;
    const qw = hw*aWall[v]*(T[v] - T_HULL)*dt;
    if(hw > H_CONV && qw > 0){ const dm = Math.min(qw/(hg(T_HULL) - hl(T_HULL)), (pv - pw)*Vg[v]/(R_V*T[v]));
      spA(2, T[v]); m[o+2] -= dm; U[v] -= dm*(IO[1] + R_V*T[v]); mW[c] += dm; eW[c] += dm*hl(T_HULL);
      pv = m[o+2]/H2O_MMOL*RGAS_U*T[v]/Vg[v]/1000; }
    U[v] -= H_CONV*aWall[v]*(T[v] - T_HULL)*dt;
    const ps = psat(T[v]);
    if(pv > ps){ const dm = 0.5*(pv - ps)*Vg[v]/(R_V*T[v]);
      m[o+2] -= dm; U[v] += dm*(OFF - hl(T[v])); mW[c] += dm; eW[c] += dm*hl(T[v]); } }
}

function surfA(c){ const y = cSurfRow[c]; return Math.max(Af, (y >= 0 ? cRowN[c*H+y] : 1)*Af); }
function pour(dt){
  for(let j=0;j<L.nj;j++){ if(!jDoor[j]) continue;
    const ca = vComp[ja[j]], cb = vComp[jb[j]]; if(ca === cb) continue;
    let from, to, dV = 0;
    if(!jv[j]){ const La = cLvl[ca], Lb = cLvl[cb]; from = La >= Lb ? ca : cb; to = from === ca ? cb : ca;
      const Lh = Math.max(La, Lb), Ll = Math.min(La, Lb), zs = jlo[j], zt = jhi[j];
      if(Lh <= zs || !(mW[from] > 0)) continue;
      const top = Math.min(Lh, zt), sub = Math.max(zs, Math.min(Ll, top));
      const Q = CD*ROOM_DEPTH*((2/3)*Math.sqrt(2*G)*(Math.pow(Lh - sub, 1.5) - Math.pow(Lh - top, 1.5)) + (sub - zs)*Math.sqrt(2*G*(Lh - Ll)));
      dV = Math.min(Q*dt, 0.5*(Lh - Ll)*Math.min(surfA(from), surfA(to))); }
    else { from = ca; to = cb;
      const zh = jz[j] + MPC/2, head = cLvl[from] - Math.max(zh, cLvl[to]);
      if(head <= 0 || !(mW[from] > 0)) continue;
      dV = CD*jA[j]*Math.sqrt(2*G*head)*dt; }
    const dm = Math.min(mW[from], dV*RHO_W); if(!(dm > 0)) continue;
    const e = dm*eW[from]/mW[from];
    mW[from] -= dm; eW[from] -= e; mW[to] += dm; eW[to] += e; }
}

function step(dt){
  if(!L.ready) return;
  levels(); eos();
  sources(dt); eos();
  flow(dt); eos();
  exchange(dt); eos();
  burnStep(dt);
  water(dt);
  pour(dt);
  levels(); eos();
  for(let v=0;v<L.n;v++) pk[v] = Math.max(pk[v], P[v] - Pref[v]);
  L.t += dt;
}

function blast(cell, kPa){ const v = dv[cell]; if(v < 0) return; U[v] += kPa*Vg[v]/(GAM[v] - 1); eos(); }

const cellGasV = i => { const v = dv[i]; return Vc*(1 - cFill[vComp[v]*H + ((i/W)|0)]); };
const src = {
  name: "LUMPED",
  ok: () => L.ready,
  T: i => dv[i] < 0 ? NaN : T[dv[i]],
  P: i => dv[i] < 0 ? 0 : P[dv[i]] - Pref[dv[i]],
  pk: i => dv[i] < 0 ? 0 : pk[dv[i]],
  h2f: i => { if(dv[i] < 0) return 0; fracs(dv[i]); return XH; },
  o2f: i => { if(dv[i] < 0) return O2_FRAC0; fracs(dv[i]); return XO; },
  vap: i => dv[i] < 0 ? 0 : m[dv[i]*4+2]*cellGasV(i)/Vg[dv[i]],
  gas: i => dv[i] < 0 ? 0 : M[dv[i]]*cellGasV(i)/Vg[dv[i]],
  water: i => dv[i] < 0 ? 0 : RHO_W*Vc*cFill[vComp[dv[i]]*H + ((i/W)|0)],
  waterT: i => { const c = dv[i] < 0 ? -1 : vComp[dv[i]]; return c >= 0 && mW[c] > 0 ? T0 + eW[c]/(CW*mW[c]) : NaN; },
  flame: i => dv[i] >= 0 && burn[dv[i]] === 1,
  lump: i => dv[i],
  door: i => isDoor[i] !== 0,
  info: i => { const v = dv[i]; if(v < 0) return "WALL";
    return "VOL " + v + (isDoor[i] ? " (door cell)" : "") + "  " + vCnt[v] + " cells  " + V[v].toFixed(0) + " m3  gas " + Vg[v].toFixed(0) + " m3"; },
  tot: () => { const r = {gas:0, h2:0, o2:0, vap:0, wat:0, pool:0, pk:0, maxT:-1e9};
    for(let v=0;v<L.n;v++){ const o = v*4; r.gas += M[v]; r.h2 += m[o+3]; r.o2 += ROOM_Y_O2*m[o] + m[o+1]; r.vap += m[o+2];
      r.pk = Math.max(r.pk, P[v] - Pref[v]); r.maxT = Math.max(r.maxT, T[v]); }
    for(let c=0;c<L.nc;c++) r.wat += mW[c];
    return r; },
};

return { build, reset, step, blast, src, L,
  inject: (kind, rate, cell) => { L.inj = {kind, rate, cell}; },
  off: () => { L.inj = null; } };
})();
