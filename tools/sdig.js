#!/usr/bin/env node
// node tools/sdig.js <treeRoot> <pre> [ticks]            - hash the state buffer after N ticks (bit-identity gate)
// node tools/sdig.js <rootA> <rootB> <pre> [ticks] --leaf - element compare A vs B
//
// --leaf prints, per preset,
//   - the worst CONTINUOUS element drift (relative, f64/f32 rows), which must stay under LEAF_TOL, and
//   - any DISCRETE flip (a u8/i32 row: a burst/flood/trip/latch present on one side and not the other),
//     which must be ZERO. A discrete flip is a different plant history, never "a smaller number".
const LEAF_TOL = 1e-6;

function run(root, pre, N){
  Math.random = () => 0.4242424242;                 // resetPlant() seeds off it; every tree seeds alike
  const { headless } = require(root + '/tools/bundle');
  const M = headless('{PLANTPRE:()=>PLANTPRE,plantPreset,buildLayout,commission,ST:()=>ST,SCHEMA:()=>SCHEMA,step}');
  M.plantPreset(pre); M.buildLayout(); M.commission();
  M.ST().sc[SC_DICEOFF] = 1;
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

function hashOf(bytes){
  let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 | 0;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 16777619) | 0;
    h2 = (Math.imul(h2 + bytes[i], 31) ^ (h2 >>> 7)) | 0; }
  return { n: bytes.length, h1: (h1 >>> 0).toString(16).padStart(8, '0'), h2: (h2 >>> 0).toString(16).padStart(8, '0') };
}

const args = process.argv.slice(2);
const leaf = args.includes('--leaf');
const rest = args.filter(a => a[0] !== '-');

if (!leaf) {
  const root = rest[0], pre = +(rest[1] || 0), N = +(rest[2] || 600);
  const { bytes, sc, name } = run(root, pre, N);
  const f = (x, d) => (x === null || x === undefined || Number.isNaN(x)) ? '-' : (+x).toFixed(d);
  const h = hashOf(bytes);
  console.log(name.padEnd(12) + ' t=' + f(sc[SC_T], 2) + ' Tavg=' + f(sc[SC_TAVG], 6) + ' P=' + f(sc[SC_P], 8) +
    ' inv=' + f(sc[SC_INV], 6) + ' n=' + f(sc[SC_N], 8) + '  bytes=' + h.n + '  digest=' + h.h1 + h.h2);
} else {
  const rootA = rest[0], rootB = rest[1], pre = +(rest[2] || 0), N = +(rest[3] || 600);
  const A = run(rootA, pre, N), B = run(rootB, pre, N);
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
