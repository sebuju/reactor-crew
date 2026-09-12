#!/usr/bin/env node
// node tools/liqprobe.js map|still|jet|dam|fall|hole|sheet|side|utube|utubegas|bubble|books|cost|deck|metal|rowstep|stream|conserve [--pre=N] [--dump=y0-y1]
// one scenario per run, every figure against the real number the plan names
const M = require('./bundle').headless(
  '{plantPreset,buildLayout,commission,step,S:()=>S,D:()=>D,act,GW:()=>GW,GH:()=>GH,MPC:()=>MPC,sumpKg,ledgerKg,ledgerOut,' +
  'roomGeomLive,liqWater,liqMetal,liqCap,liqStands,liqSurf,liqRuns,liqShut,liqFill,liqLand,liqSpeed,zFloor,matRegions,matPaint,fireCool,' +
  'roomVgas,roomWaterT,hOfT,matLift,SAT_WATER:()=>SAT_WATER,T_HULL:()=>T_HULL,ROOM_M0:()=>ROOM_M0,ROOM_VCELL:()=>ROOM_VCELL,ROOM_P0:()=>ROOM_P0,' +
  'G_MPA:()=>G_MPA,WATER_RHO:()=>WATER_RHO,roomDispOf,roomGasFields,liqCgIt:()=>liqCgIt,roomCgIt:()=>roomCgIt,PLANTPRE:()=>PLANTPRE,CELL:()=>CELL}');
const { performance: perf } = require('perf_hooks');
const arg = k => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const mode = process.argv[2] || 'map';
const pre = +(arg('pre') || (mode === 'metal' ? 3 : 0));

M.plantPreset(pre); M.buildLayout(); M.commission();
const s = M.S(); s.diceOff = true;
const GW = M.GW(), GH = M.GH(), N = GW * GH, MPC = M.MPC(), at = (x, y) => y * GW + x, g = M.G_MPA() * 1e6;
const W = () => s.roomWater, water = () => M.liqWater(s), metal = () => M.liqMetal(s), G = () => M.roomGeomLive(s);
const A = MPC * 4, capKg = M.WATER_RHO() * M.ROOM_VCELL();
const f3 = v => (+v).toFixed(3);
const verdict = (ok, what) => console.log((ok ? 'PASS ' : 'FAIL ') + what);

function map() {
  const Gg = G(), reg = M.matRegions();
  const of = new Int32Array(N).fill(-1);
  for (const r of reg.regions) for (const i of r.cells) of[i] = r.idx;
  console.log(M.PLANTPRE()[pre][0] + '  ' + GW + 'x' + GH + '  regions ' + reg.regions.map(r => r.idx + (r.bounded ? 'b' : 's') + ':' + r.cells.length).join(' '));
  for (let Y = 0; Y < GH; Y++) {
    let r = String(Y).padStart(2) + ' ';
    for (let X = 0; X < GW; X++) { const i = at(X, Y);
      r += Gg.tight[i] ? '#' : Gg.occ[i] && Gg.own[i] < 0 ? 'x' : Gg.pan[i] ? 'p' : Gg.occ[i] ? 'o' : of[i] >= 0 && reg.regions[of[i]].bounded ? ',' : '.'; }
    console.log(r);
  }
  console.log('   ' + Array.from({ length: GW }, (_, X) => X % 10).join(''));
}
// digits = standing tenths, letters = falling tenths, * = over cap
function dump(q, y0, y1) {
  const Gg = G();
  for (let Y = y0; Y <= y1; Y++) {
    let r = String(Y).padStart(2) + ' ';
    for (let X = 0; X < GW; X++) {
      const i = at(X, Y), m = q.M[i], c = M.liqCap(q, i), f = Math.min(9, Math.floor(10 * m / Math.max(c, 1e-9)));
      r += M.liqShut(Gg, i) ? '#' : !(m > 0.01) ? '.' : m > 1.01 * c ? '*' : M.liqStands(q, Gg, i) ? String(f) : 'abcdefghij'[f];
    }
    console.log(r);
  }
}
process.on('exit', () => { if (msN) console.log('water off its books by ' + consWorst.toFixed(6) + ' kg, worst tick at ' + consAt + ' s'); if (msN) console.log('fastest water face ' + vTop.toFixed(1) + ' m/s at ' + vAt + ' (guard 30), ' + (msAcc / msN).toFixed(2) + ' ms/tick over ' + msN + ' ticks'); const d = arg('dump'); if (d) { const [a, b] = d.split('-').map(Number); dump(mode === 'metal' ? metal() : water(), a, b); } });

let t = 0, msAcc = 0, msN = 0;
let vTop = 0, vAt = null;
// the water on the deck against its own books: every source and sink of it is a `sump` or an `inject` line
const wTot = () => { let k = 0; const W = s.roomWater; for (let i = 0; i < N; i++) k += W[i]; return k; };
const wBook = () => (s.massOut.sump || 0) + (s.massOut.inject || 0);
let consWorst = 0, consAt = null;
const tick = k => { const t0 = perf.now(); for (let j = 0; j < k; j++){
    const w0 = wTot(), b0 = wBook();
    M.step(0.02);
    const r = Math.abs(wTot() - w0 + wBook() - b0);
    if (r > consWorst){ consWorst = r; consAt = +(t + (j + 1) * 0.02).toFixed(2); }
    for (let i = 0; i < N; i++){ const v = Math.max(Math.abs(s.roomWU[i]), Math.abs(s.roomWV[i])); if (v > vTop){ vTop = v; vAt = [i % GW, (i / GW) | 0, +(t + (j + 1) * 0.02).toFixed(2)]; } } } t += k * 0.02; const ms = (perf.now() - t0) / k; msAcc += ms * k; msN += k; return ms; };
// standing cells and the surface they show, over a column range
function surf(x0, x1) {
  const Gg = G(), q = water(), out = [];
  for (let X = x0; X <= x1; X++) { let z = null;
    for (let Y = GH - 1; Y >= 0; Y--) { const i = at(X, Y); if (W()[i] > 0.5 && M.liqStands(q, Gg, i) && !M.liqShut(Gg, i)) z = M.liqSurf(q, Gg, i); }
    if (z !== null) out.push(z); }
  return out;
}
const span = a => a.length ? Math.max(...a) - Math.min(...a) : NaN, mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const kgIn = (x0, x1, y0, y1) => { let k = 0; for (let Y = y0; Y <= y1; Y++) for (let X = x0; X <= x1; X++) k += W()[at(X, Y)]; return k; };
// a pool laid at rest: full rows from the floor up, a part row on top, hydrostatic state in the full cells, gas pushed out as it goes
function pool(x0, x1, yFloor, depthM, T) {
  const q = water(), Gg = G(), rows = depthM / MPC, e = M.hOfT(M.SAT_WATER(), T === undefined ? M.T_HULL() : T);
  for (let Y = yFloor; Y > yFloor - Math.ceil(rows); Y--) {
    const f = Math.min(1, rows - (yFloor - Y));
    for (let X = x0; X <= x1; X++) { const i = at(X, Y); if (M.liqShut(Gg, i)) continue;
      const kg = f * M.liqCap(q, i); M.liqLand(s, Gg, q, i, kg, kg * e); }
  }
  // what the lay buried over its own cap, read before the first tick can take it
  const over = [];
  for (let i = 0; i < N; i++) { const ex = W()[i] - M.liqCap(q, i);
    if (ex > 1 && i >= GW && W()[i - GW] > 0 && !M.liqShut(Gg, i - GW)) over.push([i % GW, (i / GW) | 0, ex]); }
  s.roomWU.fill(0); s.roomWV.fill(0); s.roomPU.fill(0); s.roomPV.fill(0); M.roomDispOf().fill(0);
  // the gas the pool pushed aside is spread over the room it has left, at rest
  for (const F of M.roomGasFields(s)) { let tot = 0, vol = 0;
    for (let Y = 1; Y <= 29; Y++) for (let X = 7; X <= 36; X++) { const i = at(X, Y); tot += F[i]; vol += M.roomVgas(s, i); }
    for (let Y = 1; Y <= 29; Y++) for (let X = 7; X <= 36; X++) { const i = at(X, Y); F[i] = tot * M.roomVgas(s, i) / vol; } }
  tick(1);
  for (let Y = yFloor; Y > yFloor - Math.ceil(rows); Y--) for (let X = x0; X <= x1; X++) { const i = at(X, Y);
    if (W()[i] >= M.liqCap(q, i) - 1e-6) s.roomWP[i] = s.roomP[i] + M.WATER_RHO() * g * (depthM - (yFloor - Y) * MPC) / 1000; }
  return over;
}
// standing/falling flips per tick, the figure the instant-level pass was judged on
function flips(k, label, every) {
  const q = water(), was = new Uint8Array(N);
  let tot = 0, worst = 0;
  const read = () => { const Gg = G(), now = new Uint8Array(N); for (let i = 0; i < N; i++) now[i] = W()[i] > 10 ? (M.liqStands(q, Gg, i) ? 1 : 2) : 0; return now; };
  let a = read();
  for (let j = 0; j < k; j++) { tick(1); const b = read(); let n = 0; for (let i = 0; i < N; i++) if (a[i] !== b[i]) n++; tot += n; if (n > worst) worst = n; a = b;
    if (every && (j + 1) % every === 0){ const z = surf(7, 36); console.log('  t ' + t.toFixed(1) + ' flips ' + n + ' lean ' + (span(z) * 1000).toFixed(0) + ' mm'); } }
  console.log(label + ' state flips (cells over 10 kg) ' + (tot / k).toFixed(2) + ' a tick, worst ' + worst);
  return tot / k;
}

if (mode === 'map') { map(); }
else if (mode === 'still') {
  pool(7, 36, 29, 2.5 * MPC);
  const z0 = surf(7, 36);
  tick(50);
  const fl = flips(500, 'still pool 1-11 s:');
  const z1 = surf(7, 36);
  console.log('surface span ' + (span(z1) * 1000).toFixed(1) + ' mm (laid ' + (span(z0) * 1000).toFixed(1) + '), ms/tick ' + (msAcc / msN).toFixed(3) + ', liquid solve it ' + M.liqCgIt());
  verdict(fl === 0 && span(z1) < 0.005, 'a pool at rest stays: 0 flips a tick, flat within 5 mm');
} else if (mode === 'jet') {
  M.act('hit', 'pipe:28,15'); M.act('hit', 'mat:20,30'); M.act('injectOn', 'fluid', 10000, at(12, 15));
  tick(100);
  const fl = flips(200, 'hot-leg break + floor hole + 10 t/s at 12,15, 2-6 s:', 25);
  const z = surf(7, 36);
  let pmax = -1e9, pmin = 1e9; for (let X = 7; X <= 36; X++) { const p = s.roomP[at(X, 28)]; if (p > pmax) pmax = p; if (p < pmin) pmin = p; }
  console.log('floor gas spread ' + (pmax - pmin).toFixed(2) + ' kPa, surface span ' + (span(z) * 1000).toFixed(0) + ' mm over ' + z.length + ' columns, ms/tick ' + (msAcc / msN).toFixed(2));
  verdict(fl < 1, 'under a gas jet fewer than 1 cell a tick changes state');
} else if (mode === 'dam') {
  pool(7, 25, 29, MPC);
  const h = MPC, c = Math.sqrt(g * h);
  let front = 25, t0 = t, last = null;
  for (let j = 0; j < 400 && front < 35; j++) { tick(1);
    let f = front; for (let X = front + 1; X <= 36; X++) if (W()[at(X, 29)] > 0.01 * capKg) f = X;
    if (f > front) { front = f; last = t; } }
  const v = (front - 25) * MPC / (last - t0);
  console.log('dam break h ' + h.toFixed(3) + ' m: front ' + (front - 25) + ' cells in ' + (last - t0).toFixed(2) + ' s = ' + v.toFixed(2) + ' m/s, sqrt(gh) ' + c.toFixed(2));
  verdict(Math.abs(v - c) / c < 0.25, 'front within 25 % of sqrt(g*h)');
} else if (mode === 'fall') {
  M.act('injectOn', 'fluid', 10000, at(29, 14));
  const drop = 15 * MPC, tAir = Math.sqrt(2 * drop / g);
  let landed = null, vmax = 0;
  for (let j = 0; j < 150 && landed === null; j++) { tick(1); if (W()[at(29, 29)] > 1) landed = t; }
  tick(Math.round(3 * 50) - Math.round(t * 50));
  let air = 0, stand = 0; const q = water(), Gg = G();
  for (let i = 0; i < N; i++) if (W()[i] > 0) { if (M.liqStands(q, Gg, i)) stand += W()[i]; else air += W()[i]; vmax = Math.max(vmax, M.liqSpeed(q, i)); }
  const airReal = 10000 * tAir;
  console.log('7 m fall at 10 t/s: landed at ' + (landed === null ? 'never' : landed.toFixed(2) + ' s') + ' (sqrt(2h/g) ' + tAir.toFixed(2) + '), airborne at 3 s ' + (air / 1000).toFixed(2) + ' t (real ' + (airReal / 1000).toFixed(1) + '), standing ' + (stand / 1000).toFixed(2) + ' t, fastest cell ' + vmax.toFixed(1) + ' m/s');
  verdict(landed !== null && Math.abs(landed - tAir) / tAir < 0.2 && Math.abs(air - airReal) / airReal < 0.25, 'airtime within 20 %, airborne mass within 25 %');
} else if (mode === 'hole' || mode === 'sheet') {
  const depth = mode === 'hole' ? 4 * MPC : 0.2;
  pool(7, 36, 29, depth);
  tick(25);
  const k0 = kgIn(7, 36, 1, 29);
  M.act('hit', 'mat:20,30');
  const rates = [];
  let prev = k0;
  for (let j = 0; j < 100; j++) { tick(1); const k = kgIn(7, 36, 1, 29); rates.push((prev - k) / 0.02); prev = k; }
  const mean = rates.slice(25, 75).reduce((a, b) => a + b, 0) / 50, peak = Math.max(...rates);
  const head = mode === 'hole' ? depth : 0.2, real = mode === 'hole' ? M.WATER_RHO() * 0.6 * A * Math.sqrt(2 * g * head) : 700;
  console.log('floor hole under ' + head.toFixed(2) + ' m: ' + (mean / 1000).toFixed(2) + ' t/s over 0.5-1.5 s (orifice ' + (real / 1000).toFixed(2) + '), peak tick ' + (peak / 1000).toFixed(2) + ' t/s, first tick ' + (rates[0] / 1000).toFixed(2));
  verdict(Math.abs(mean - real) / real < 0.3 && peak < 2 * real, 'within 30 % of the orifice law, no tick over twice it');
} else if (mode === 'side') {
  pool(7, 36, 29, 4 * MPC);
  tick(25);
  const k0 = kgIn(7, 36, 1, 29);
  M.act('hit', 'mat:37,29');
  const rates = [];
  let prev = k0;
  for (let j = 0; j < 100; j++) { tick(1); const k = kgIn(7, 36, 1, 29); rates.push((prev - k) / 0.02); prev = k; }
  const mean = rates.slice(25, 75).reduce((a, b) => a + b, 0) / 50, peak = Math.max(...rates);
  const head = 4 * MPC - MPC / 2, real = M.WATER_RHO() * 0.6 * A * Math.sqrt(2 * g * head);
  console.log('side hole, ' + head.toFixed(2) + ' m to its middle: ' + (mean / 1000).toFixed(2) + ' t/s over 0.5-1.5 s (orifice ' + (real / 1000).toFixed(2) + '), peak tick ' + (peak / 1000).toFixed(2) + ' t/s, first tick ' + (rates[0] / 1000).toFixed(2));
  verdict(Math.abs(mean - real) / real < 0.3 && rates[0] < 2 * real, 'within 30 % of the orifice law, first tick under twice it');
} else if (mode === 'utube' || mode === 'utubegas') {
  // a wall from the deckhead down to one cell over the floor: the two sides join under it
  const y0 = mode === 'utubegas' ? 1 : 25;
  let wx = 0;
  for (const x of [26, 23, 22, 33, 34]) { let ok = true; for (let Y = y0; Y <= 28; Y++) if (!M.matPaint(x, Y)) ok = false; if (ok) { wx = x; break; } for (let Y = y0; Y <= 28; Y++) M.matLift(x, Y); }
  if (!wx) { console.log('no clear column for the wall'); process.exit(1); }
  console.log('wall at x ' + wx + ', rows ' + y0 + '-28');
  M.buildLayout();
  if (mode === 'utubegas') pool(7, 36, 29, 3 * MPC); else { pool(7, 36, 29, MPC); pool(7, wx - 1, 28, 2 * MPC); }
  if (mode === 'utubegas') { M.act('injectOn', 'o2', 50, at(wx + 1, 20)); tick(5); M.act('injectOff'); }
  for (let j = 0; j < 6; j++) { tick(200);
    const l = surf(7, wx - 1), r = surf(wx + 1, 36), dp = s.roomP[at(wx + 1, 20)] - s.roomP[at(wx - 1, 20)];
    console.log('t ' + t.toFixed(0) + ' left ' + f3(mean(l)) + ' (crest ' + f3(Math.max(...l)) + ') right ' + f3(mean(r)) + ' (crest ' + f3(Math.max(...r)) + ') dz ' + ((mean(l) - mean(r)) * 1000).toFixed(0) + ' mm, gas dp ' + dp.toFixed(2) + ' kPa'); }
  const l = surf(7, wx - 1), r = surf(wx + 1, 36), dz = mean(l) - mean(r);
  if (mode === 'utube') verdict(Math.abs(dz) < 0.005, 'two sides level within 5 mm');
  else { const dp = (s.roomP[at(wx + 1, 20)] - s.roomP[at(wx - 1, 20)]) * 1000, real = dp / (M.WATER_RHO() * g);
    console.log('head held ' + f3(dz) + ' m against ' + (dp / 1000).toFixed(2) + ' kPa (dp/(rho g) ' + f3(real) + ')');
    verdict(Math.abs(dz - real) / Math.abs(real) < 0.1, 'level difference within 10 % of dp/(rho*g)'); }
} else if (mode === 'bubble') {
  pool(18, 36, 29, 3 * MPC);
  const b = at(25, 28), q = water();
  // a cell's worth of gas under two full cells: the water goes back to the book, the air comes in at ambient
  W()[b] = 0; s.roomWaterE[b] = 0; s.roomM[b] = M.ROOM_M0(); s.roomO2[b] = s.roomO2[at(25, 20)]; s.roomVap[b] = 0; s.roomH2[b] = 0;
  let top = null, worst = 0;
  for (let j = 0; j < 200; j++) { tick(1);
    for (let i = 0; i < N; i++) { const d = s.roomM[i] / M.roomVgas(s, i) / (M.ROOM_M0() / M.ROOM_VCELL()); if (d > worst) worst = d; }
    if (top === null && W()[b] > 0.9 * M.liqCap(q, b) && W()[at(25, 27)] > 0.9 * M.liqCap(q, at(25, 27))) top = t; }
  console.log('gas pocket under a full cell: ' + (top === null ? 'still there at 4 s' : 'gone by ' + top.toFixed(2) + ' s') + ', worst gas density ' + worst.toFixed(2) + ' x ambient');
  verdict(top !== null && worst < 3, 'the pocket reaches the surface, no cell over 3x ambient');
} else if (mode === 'books') {
  M.act('hit', 'pipe:28,15');
  tick(150);
  M.act('injectOn', 'fluid', 5000, at(29, 14)); tick(100); M.act('injectOff'); tick(100);
  let E = 0, kg = 0, Tmin = 1e9, Tmax = 0; for (let i = 0; i < N; i++) if (W()[i] > 0) { E += s.roomWaterE[i]; kg += W()[i]; const T = M.roomWaterT(s, i); if (T < Tmin) Tmin = T; if (T > Tmax) Tmax = T; }
  console.log('ledger ' + M.ledgerKg(s).toFixed(3) + ' kg, residual ' + (s.massRes || 0).toFixed(4) + ', water ' + (kg / 1000).toFixed(3) + ' t at ' + Tmin.toFixed(0) + '-' + Tmax.toFixed(0) + ' K, energy ' + (E / 1000).toFixed(1) + ' MJ = mean ' + (E / kg / 5.5 + 273.15).toFixed(1) + ' K');
  verdict(Math.abs(s.massRes || 0) < 1, 'ledger residual under 1 kg');
} else if (mode === 'cost') {
  const dry = tick(500);
  M.act('injectOn', 'fluid', 10000, at(29, 13)); tick(50);
  const wet = tick(200);
  console.log('dry ' + dry.toFixed(2) + ' ms/tick, 10 t/s pour ' + wet.toFixed(2) + ' ms/tick, liquid solve it ' + M.liqCgIt() + ', gas ' + M.roomCgIt());
  verdict(wet < 8, 'the pour case under 8 ms a tick');
} else if (mode === 'deck') {
  M.act('injectOn', 'fluid', 10000, at(29, 13));
  for (let j = 0; j < 8; j++) { if (j === 4) M.act('injectOff'); const ms = tick(50); const z = surf(7, 36);
    console.log('t ' + t.toFixed(0) + ' sump ' + (M.sumpKg(s) / 1000).toFixed(3) + ' t, surface ' + (z.length ? f3(Math.min(...z)) + '-' + f3(Math.max(...z)) : '-') + ' over ' + z.length + ' cols, res ' + (s.massRes || 0).toFixed(3) + ', ms ' + ms.toFixed(2) + ', it ' + M.liqCgIt()); }
} else if (mode === 'metal') {
  console.log('preset ' + M.PLANTPRE()[pre][0] + ' coolant ' + (M.fireCool() ? M.fireCool().burn : 'none'));
  if (!arg('part')) { const D = M.D();
    for (const rid in D.runs) { const r = D.runs[rid], c = r.cells || []; console.log(rid + ' ' + r.a + ' -> ' + r.b + ' cells ' + c.length + ' mid ' + c[c.length >> 1]); }
    process.exit(0); }
  M.act('hit', arg('part'));
  for (let j = 0; j < +(arg('secs') || 8); j++) { const ms = tick(50);
    console.log('t ' + t.toFixed(0) + ' fireEv kg ' + s.fireEv.kg.toFixed(2) + ' q ' + (s.fireEv.q / 1000).toFixed(1) + ' MJ pool ' + (s.roomPool.reduce((a, b) => a + b, 0) / 1000).toFixed(3) + ' t, ms ' + ms.toFixed(2)); }
} else if (mode === 'drain') {
  // the user's sequence: pour a deep pool on the deck, shoot the floor under it, then only wait
  M.act('injectOn', 'fluid', 10000, at(29, 13));
  tick(200); M.act('injectOff');
  tick(100);
  M.act('hit', 'mat:30,30');
  const q = water();
  let prev = null;
  for (let j = 0; j < 6; j++) { tick(75);
    const Gg = G(); let kg = 0, cols = 0, lo = null, hi = null, air = 0;
    for (let X = 7; X <= 36; X++) { let zz = null;
      for (let Y = 1; Y <= 29; Y++) { const i = at(X, Y), m = W()[i]; kg += m;
        if (!(m > 0.5) || M.liqShut(Gg, i)) continue;
        if (M.liqStands(q, Gg, i)) zz = M.liqSurf(q, Gg, i); else air += m; }
      if (zz === null) continue; cols++; if (lo === null || zz < lo) lo = zz; if (hi === null || zz > hi) hi = zz; }
    const rate = prev === null ? 0 : (prev - kg) / 1.5;
    prev = kg;
    console.log('t ' + t.toFixed(1) + ' on the floor ' + (kg / 1000).toFixed(2) + ' t over ' + cols + ' cols, draining ' +
      (rate / 1000).toFixed(2) + ' t/s, surface ' + (lo === null ? '-' : f3(lo) + '-' + f3(hi)) +
      ', span ' + (lo === null ? 0 : ((hi - lo) * 1000).toFixed(0)) + ' mm, in the air ' + air.toFixed(0) + ' kg');
    // the floor row either side of the hole: fill %, S standing or a in the air, the face speed to its right
    let row = ' 29';
    for (let X = 26; X <= 36; X++) { const i = at(X, 29);
      row += ' ' + X + ':' + (100 * W()[i] / Math.max(M.liqCap(q, i), 1e-9)).toFixed(0) + (M.liqStands(q, Gg, i) ? 'S' : 'a') +
        (s.roomWU[i] >= 0 ? '+' : '') + s.roomWU[i].toFixed(2); }
    console.log(row);
    // what sits on top of it: any mass at all here makes the cell under it stiff
    let up = ' 28';
    for (let X = 26; X <= 36; X++) up += ' ' + X + ':' + W()[at(X, 28)].toFixed(3) + 'kg';
    console.log(up);
  }
} else if (mode === 'settle') {
  // pour onto the deck, stop, and ask whether the surface goes flat - and whether the gas over it is what holds the step
  M.act('injectOn', 'fluid', 10000, at(29, 13));
  tick(150); M.act('injectOff');
  const q = water(), rg = M.WATER_RHO() * g;
  for (let j = 0; j < 2; j++) { tick(75);
    const Gg = G(), z = [], top = [], cols = [];
    for (let X = 7; X <= 36; X++) { let zz = null, tt = null;
      for (let Y = GH - 1; Y >= 0; Y--) { const i = at(X, Y); if (W()[i] > 0.5 && M.liqStands(q, Gg, i) && !M.liqShut(Gg, i)) { zz = M.liqSurf(q, Gg, i); tt = i; } }
      if (zz === null) continue;
      z.push(zz); top.push(tt); cols.push(X); }
    if (!z.length) { console.log('t ' + t.toFixed(1) + ' no standing water'); continue; }
    let lo = 0, hi = 0;
    for (let k = 0; k < z.length; k++) { if (z[k] < z[lo]) lo = k; if (z[k] > z[hi]) hi = k; }
    // a higher gas pressure holds its own column down: the step the gas alone explains is dp/(rho*g)
    const dp = (s.roomP[top[lo]] - s.roomP[top[hi]]) * 1000, gasDz = dp / rg, span = z[hi] - z[lo];
    console.log('t ' + t.toFixed(1) + ' span ' + (span * 1000).toFixed(0) + ' mm, low col ' + cols[lo] + ' high col ' + cols[hi] +
      ', gas dp ' + (dp / 1000).toFixed(2) + ' kPa = ' + (gasDz * 1000).toFixed(0) + ' mm, water holds ' + ((span - gasDz) * 1000).toFixed(0) + ' mm of it');
  }
  /* Four windows in a row, each shorter than the basin's own seiche period: a slosh tilts one way then
     the other and the sign flips, a step keeps its sign. The gas column is what dp/(rho*g) would hold. */
  const tilt = () => { const Gg = G(); let l = 0, ln = 0, r = 0, rn = 0, pl = 0, pr = 0;
    for (let X = 7; X <= 36; X++) { let zz = null, tt = null;
      for (let Y = GH - 1; Y >= 0; Y--) { const i = at(X, Y); if (W()[i] > 0.5 && M.liqStands(q, Gg, i) && !M.liqShut(Gg, i)) { zz = M.liqSurf(q, Gg, i); tt = i; } }
      if (zz === null) continue;
      if (X <= 21) { l += zz; ln++; pl += s.roomP[tt]; } else { r += zz; rn++; pr += s.roomP[tt]; } }
    return ln && rn ? [r / rn - l / ln, (pl / ln - pr / rn) * 1000 / rg] : [0, 0]; };
  for (let w = 0; w < 4; w++) { let sum = 0, sumG = 0;
    for (let j = 0; j < 100; j++) { tick(1); const d = tilt(); sum += d[0]; sumG += d[1]; }
    console.log('window to t ' + t.toFixed(1) + ': right side stands ' + (sum / 100 * 1000).toFixed(0) +
      ' mm over left, gas explains ' + (sumG / 100 * 1000).toFixed(0) + ' mm'); }
} else if (mode === 'rowstep') {
  // two pools 4 cm apart, the second laid onto a settled first: the lay buries a cell over its cap
  pool(7, 20, 29, 2.04 * MPC);
  const buried = pool(21, 36, 29, 1.96 * MPC), q = water();
  for (const [x, y, ex] of buried) console.log('the lay buried ' + x + ',' + y + ' by ' + ex.toFixed(3) + ' kg over its cap');
  const lean = () => Math.abs(mean(surf(7, 20)) - mean(surf(21, 36))) * 1000;
  for (const at of [2, 4, 10]) { tick(Math.round(at * 50 - t * 50)); console.log('t ' + t.toFixed(1) + ' step ' + lean().toFixed(1) + ' mm'); }
  let over = 0; for (let i = 0; i < N; i++) over = Math.max(over, W()[i] - M.liqCap(q, i));
  console.log('two pools laid 4 cm apart: step ' + lean().toFixed(1) + ' mm at 10 s, worst cell over cap ' + over.toFixed(4) + ' kg, buried at lay ' + buried.length);
  verdict(buried.length > 0 && lean() < 5 && over < 1e-3, 'the step levels within 5 mm and no cell sits over its cap');
} else if (mode === 'stream') {
  M.act('injectOn', 'fluid', 10000, at(29, 13));
  const q = water(), pxKg = 1000 * M.ROOM_VCELL() / M.CELL();
  tick(25);
  let n1 = 0, n2 = 0, pillar = 0, ticks = 0;
  for (let j = 0; j < 175; j++) { tick(1); ticks++;
    const Gg = G();
    for (let Y = 15; Y <= 24; Y++) for (let X = 7; X <= 36; X++) { if (X === 29) continue;
      const m = W()[at(X, Y)];
      if (m >= pxKg && m <= 0.1 * M.liqCap(q, at(X, Y))) { if (Y <= 19) n1++; else n2++; } }
    let top = null;
    for (let Y = 0; Y < GH && top === null; Y++) { const i = at(29, Y); if (W()[i] > 0.5 && M.liqStands(q, Gg, i) && !M.liqShut(Gg, i)) top = Y; }
    if (top !== null && top <= 24) pillar++;
  }
  console.log('10 t/s at 29,13 over 0.5-4 s: cells a board pixel wide beside the stream, rows 15-19 ' + (n1 / ticks).toFixed(2) + ' a tick, rows 20-24 ' + (n2 / ticks).toFixed(2) + ', pillar ticks ' + pillar + ' of ' + ticks);
  verdict(n1 / ticks < 0.1 && pillar === 0, 'no strip beside the falling stream, no standing pillar under it');
} else if (mode === 'conserve') {
  M.act('hit', 'pipe:28,15'); M.act('hit', 'mat:20,30'); M.act('injectOn', 'fluid', 10000, at(12, 15));
  tick(300);
  console.log('hot leg + floor hole + 10 t/s over 6 s: worst tick off its books by ' + consWorst.toFixed(6) + ' kg at ' + consAt + ' s');
  verdict(consWorst < 1e-3, 'the liquid moves no kilogram it was not given');
}
