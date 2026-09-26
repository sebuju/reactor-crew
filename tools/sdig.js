#!/usr/bin/env node
// node tools/sdig.js <treeRoot> <pre> [ticks] [--burst|--h2|--fire|--blackout|--scram] - hash the state buffer after N ticks (bit-identity gate)
//   a mode: 50 ticks, its gesture through act() (--fire: H2, then heat on the same cell, and a metal pool where the coolant burns), then N ticks
// node tools/sdig.js <treeRoot> <pre> --design                - hash of derived() per core, every PT array and every numeric P field after commission()
// node tools/sdig.js <rootA> <rootB> <pre> [ticks] [mode] --leaf - element compare A vs B
//
// --leaf prints, per preset,
//   - the worst CONTINUOUS element drift (relative, f64/f32 rows), which must stay under LEAF_TOL, and
//   - any DISCRETE flip (a u8/i32 row: a burst/flood/trip/latch present on one side and not the other),
//     which must be ZERO. A discrete flip is a different plant history, never "a smaller number".
const LEAF_TOL = 1e-6;
const MODES = ['burst', 'h2', 'fire', 'blackout', 'scram'];

function boot(root, pre){
  Math.random = () => 0.4242424242;                 // resetPlant() seeds off it; every tree seeds alike
  const B = require(require('path').resolve(root, 'tools/bundle'));
  const M = B.headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,ST:()=>ST,SCHEMA:()=>SCHEMA,step,act,' +
    'IX:()=>IX,PT:()=>PT,P:()=>P,pipeMap,derived,coreIds,GW:()=>GW,GH:()=>GH,PK:()=>PK}');
  M.plantPreset(pre); M.buildLayout(); M.commission();
  return {B, M};
}

function openCell(M){
  const PT = M.PT(), ST = M.ST(), GW = M.GW(), GH = M.GH();
  let best = -1, bd = Infinity;
  for (let i = 0; i < GW*GH; i++){
    if (PT.rOcc[i] || PT.cellRegion[i] < 0 || !(ST.roomM[i] > 0)) continue;
    const d = Math.abs(i%GW - GW/2) + Math.abs((i/GW|0) - GH/2);
    if (d < bd){ bd = d; best = i; } }
  return best;
}

function gesture(B, M, mode){
  const cell = () => openCell(M);
  if (mode === 'burst') M.act('hit', B.pipeOnLoop({IX:M.IX, PT:M.PT, runOfCell:(x, y) => M.pipeMap().cellOwner[x + ',' + y] || []}));
  else if (mode === 'h2') M.act('injectOn', 4, 2, cell(), -1);
  else if (mode === 'blackout') M.act('blackout', true);
  else if (mode === 'scram') M.act('scram');
  else if (mode === 'fire'){
    const i = cell(), PT = M.PT(), ST = M.ST();
    if (PT.rFireOn){ ST.roomPool[i] = 50; ST.roomPoolE[i] = 50*M.PK()[PK_RFIRECP]*(900 - PT.rFire.melt); }
    M.act('injectOn', 4, 2, i, -1);
    for (let k = 0; k < 50; k++) M.step(0.02);
    M.act('injectOn', 1, 20000, i, -1); }
}

function run(root, pre, N, mode){
  const {B, M} = boot(root, pre);
  M.ST().sc[SC_DICEOFF] = 1;
  if (mode){ for (let k = 0; k < 50; k++) M.step(0.02); gesture(B, M, mode); }
  for (let k = 0; k < N; k++) M.step(0.02);
  const ST = M.ST(), plant = M.SCHEMA().filter(r => r[2] === 'plant').map(r => r[0]);
  /* name -> [type, values]; the plant scalars split out by name */
  const rows = new Map();
  for (const [name, type, len] of ST.layout.rows) {
    if (name === 'sc') { plant.forEach((p, i) => rows.set('sc.' + p, ['f64', [ST.sc[i]]])); continue; }
    rows.set(name, [type, Array.from(ST[name])]);
  }
  return { rows, bytes: new Uint8Array(ST.buf.slice(0)), sc: ST.sc, name: M.PLANTPRE()[pre][0] };
}

// every number as its 8 bytes, every typed array as its bytes, keys sorted; functions and repeats of an object skipped
function designBytes(M){
  const out = [], f64 = new Float64Array(1), u8 = new Uint8Array(f64.buffer), seen = new Set();
  const str = s => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255, s.charCodeAt(i) >> 8); out.push(0); };
  const walk = v => {
    if (typeof v === 'number'){ f64[0] = v; out.push(1, ...u8); return; }
    if (typeof v === 'string'){ out.push(2); str(v); return; }
    if (typeof v === 'boolean'){ out.push(3, v ? 1 : 0); return; }
    if (v === null || v === undefined){ out.push(4); return; }
    if (typeof v !== 'object' || seen.has(v)){ out.push(5); return; }
    seen.add(v);
    if (ArrayBuffer.isView(v)){ out.push(6); str(v.constructor.name); const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      for (let i = 0; i < b.length; i++) out.push(b[i]); return; }
    if (v instanceof Map){ out.push(7); for (const [k, x] of v){ walk(k); walk(x); } return; }
    if (v instanceof Set){ out.push(8); for (const x of v) walk(x); return; }
    out.push(9);
    for (const k of Object.keys(v).sort()){ if (typeof v[k] === 'function') continue; str(k); walk(v[k]); }
  };
  str('derived'); walk(M.derived());
  for (const id of M.coreIds()){ str('core ' + id); walk(M.derived(id)); }
  str('PT'); walk(M.PT());
  const P = M.P();
  str('P'); for (const k of Object.keys(P).sort()) if (typeof P[k] === 'number'){ str(k); walk(P[k]); }
  return Uint8Array.from(out);
}

function hashOf(bytes){
  let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 | 0;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 16777619) | 0;
    h2 = (Math.imul(h2 + bytes[i], 31) ^ (h2 >>> 7)) | 0; }
  return { n: bytes.length, h1: (h1 >>> 0).toString(16).padStart(8, '0'), h2: (h2 >>> 0).toString(16).padStart(8, '0') };
}

const args = process.argv.slice(2);
const leaf = args.includes('--leaf');
const mode = MODES.find(m => args.includes('--' + m)) || '';
const rest = args.filter(a => a[0] !== '-');

if (args.includes('--design')) {
  const root = rest[0], pre = +(rest[1] || 0);
  const {M} = boot(root, pre), h = hashOf(designBytes(M));
  console.log(M.PLANTPRE()[pre][0].padEnd(12) + ' design  bytes=' + h.n + '  digest=' + h.h1 + h.h2);
} else if (!leaf) {
  const root = rest[0], pre = +(rest[1] || 0), N = +(rest[2] || 600);
  const { bytes, sc, name } = run(root, pre, N, mode);
  const f = (x, d) => (x === null || x === undefined || Number.isNaN(x)) ? '-' : (+x).toFixed(d);
  const h = hashOf(bytes);
  console.log(name.padEnd(12) + (mode ? ' ' + mode : '') + ' t=' + f(sc[SC_T], 2) + ' Tavg=' + f(sc[SC_TAVG], 6) + ' P=' + f(sc[SC_P], 8) +
    ' inv=' + f(sc[SC_INV], 6) + ' n=' + f(sc[SC_N], 8) + (mode === 'fire' || mode === 'h2' ? ' burnt H2 ' + f(sc[SC_BURNKG], 4) +
    ' kg metal ' + f(sc[SC_FIREKG], 4) + ' kg' : '') + '  bytes=' + h.n + '  digest=' + h.h1 + h.h2);
} else {
  const rootA = rest[0], rootB = rest[1], pre = +(rest[2] || 0), N = +(rest[3] || 600);
  const A = run(rootA, pre, N, mode), B = run(rootB, pre, N, mode);
  let worst = 0, worstPath = '';
  const flips = [];
  for (const [p, [type, a]] of A.rows) {
    const bb = B.rows.get(p);
    if (!bb || bb[1].length !== a.length) { worst = Infinity; worstPath = p + ' (shape differs in B)'; break; }
    const b = bb[1], disc = type === 'u8' || type === 'i32';
    for (let i = 0; i < a.length; i++) {
      if (Object.is(a[i], b[i])) continue;
      if (disc) { flips.push(p + '[' + i + '] ' + a[i] + '->' + b[i]); continue; }
      const rel = Math.abs(a[i] - b[i]) / (Math.abs(a[i]) + Math.abs(b[i]) + 1e-30);
      if (!(rel <= worst)) { worst = rel; worstPath = p + '[' + i + ']'; }
    }
  }
  for (const p of B.rows.keys()) if (!A.rows.has(p)) { worst = Infinity; worstPath = p + ' (missing in A)'; break; }
  const pass = worst <= LEAF_TOL && flips.length === 0;
  console.log(A.name.padEnd(12) + '  worst-leaf=' + (worst === Infinity ? 'INF' : worst.toExponential(2)) +
    ' @ ' + worstPath + '  discrete-flips=' + flips.length + '  ' + (pass ? 'PASS' : 'FAIL'));
  if (flips.length) for (const fl of flips.slice(0, 12)) console.log('    FLIP ' + fl);
}
