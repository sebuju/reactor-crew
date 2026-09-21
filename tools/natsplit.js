#!/usr/bin/env node
// node tools/natsplit.js [preset] [h|m|bore|seed|slice] [rest|blackout|stop|break] [ticks] [--tight] [--resume]
// Two engines whose inputs differ at rounding level, marched side by side: how far SC_NAT (eNetNat(), src/eng/net.js) splits against its inputs.
"use strict";
const fs = require('fs'), os = require('os'), path = require('path');
const { headless, ulpNext } = require('./bundle');

const EXPORT = '{plantPreset,buildLayout,commission,step,snapS,restoreS,eqWhere,act,actId,pipeMap,runIdOf,runBoreMm,' +
  'eNetCoreLoop,eNetSolve,eNetReadP,eNetHold,eNetScale,eNetMarching,E_NAT_TOL,E_NAT_PASSES,E_NAT_EVERY,' +
  'D:()=>D,ST:()=>ST,SX:()=>SX,PT:()=>PT,E_NL:()=>E_NL,STBYTES:()=>STBYTES}';
const TIGHT_PASSES = 64, TIGHT_TOL = 1e-10, SLICE_EVERY = 250, ORDER_AT = 250, WALL = 6500;

const argv = process.argv.slice(2), flags = argv.filter(a => a.startsWith('--')), pos = argv.filter(a => !a.startsWith('--'));
const PRE = +(pos[0] ?? 0), SITE = pos[1] || 'h', TRANS = pos[2] || 'blackout', TICKS = +(pos[3] || 3000);
const TIGHT = flags.includes('--tight'), resume = flags.includes('--resume');
const REPLAY = TIGHT || SITE === 'h' || SITE === 'm' || SITE === 'bore';
if(!['h','m','bore','seed','slice'].includes(SITE) || !['rest','blackout','stop','break'].includes(TRANS)) throw new Error('bad site or transient');
if(TRANS === 'break' && PRE !== 0) throw new Error('break is preset 0 only');

function boot(rnd, bumpBore){
  const M = headless(EXPORT);
  M.plantPreset(PRE); M.buildLayout();
  if(bumpBore){
    const r = Object.values(M.pipeMap().byKey)[0], D = M.D();
    D.bore = D.bore || {};
    D.bore[M.runIdOf(r)] = ulpNext(M.runBoreMm(r));
    M.buildLayout();
  }
  const real = Math.random; Math.random = () => rnd;
  M.commission();
  Math.random = real;
  if(SITE === 'seed') M.ST().sc[SC_DICEOFF] = 1;
  return M;
}

const coreCirc = M => { const PT = M.PT(); return PT.nodeCirc[PT.coreNode[0]]; };
function firstOnCirc(M, arr){
  const PT = M.PT(), c = coreCirc(M);
  for(let i=0;i<arr.length;i++) if(PT.nodeCirc[i] === c && arr[i] === arr[i] && arr[i] !== 0) return i;
  throw new Error('no finite nonzero entry on the core circuit');
}
const rel = (a, b) => a === b ? 0 : Math.abs(a - b)/Math.max(Math.abs(a), 1e-9);
function circSplit(A, B, key){
  const PT = A.PT(), c = coreCirc(A), a = A.ST()[key], b = B.ST()[key];
  let d = 0;
  for(let i=0;i<a.length;i++) if(PT.nodeCirc[i] === c && a[i] === a[i]) d = Math.max(d, rel(a[i], b[i]));
  return d;
}
const sameBytes = (A, B) => { const a = A.STBYTES(), b = B.STBYTES();
  return Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0; };

/* eNetNat()'s loop through its own primitives on the state it is about to see, then on to the tight fixed point; state restored after */
function replay(M, tight){
  const snap = M.snapS(), ST = M.ST(), SX = M.SX(), NL = M.E_NL(), sc = ST.sc;
  const held = M.eNetHold(1), scale = M.eNetScale(0), mw = M.eNetMarching(0);
  let pA = sc[SC_NATHAS] ? ST.natPBy : ST.pBy, passes = 0, conv = 0;
  NL[1] = NaN;
  for(let pass=0;pass<M.E_NAT_PASSES;pass++){
    M.eNetSolve(pA, 1); M.eNetReadP(SX.pSolve); pA = SX.pSolve; passes++;
    if((conv = M.eNetCoreLoop(null))) break; }
  const reading = NL[0];
  let tv = NaN, tconv = 0;
  if(tight){
    let prev = reading;
    for(let pass=0;pass<TIGHT_PASSES;pass++){
      M.eNetSolve(pA, 1); M.eNetReadP(SX.pSolve); pA = SX.pSolve;
      M.eNetCoreLoop(null); tv = NL[0];
      if(Math.abs(tv - prev) <= TIGHT_TOL*Math.max(Math.abs(tv), 1e-9)){ tconv = 1; break; }
      prev = tv; } }
  M.eNetHold(held); M.eNetScale(scale); M.eNetMarching(mw);
  M.restoreS(snap);
  return { passes, conv, reading, tight:tv, tconv };
}

function order(M, k){
  if(TRANS === 'stop' && k === 0){ M.act('scram'); M.act('flowDem', 0); }
  if(TRANS === 'blackout' && k === ORDER_AT) M.act('blackout', true);
  if(TRANS === 'break' && k === ORDER_AT) M.actId('hit', 'pipe:28,15');
}

const tag = 'rc-natsplit-' + PRE + '-' + SITE + '-' + TRANS;
const fA = path.join(os.tmpdir(), tag + '-a.bin'), fB = path.join(os.tmpdir(), tag + '-b.bin'), fJ = path.join(os.tmpdir(), tag + '.json');
const t0 = Date.now();
let A, B, C = null, S;
if(resume && fs.existsSync(fJ)){
  A = boot(0.5, false); B = boot(0.5, SITE === 'bore');
  A.restoreS(new Uint8Array(fs.readFileSync(fA))); B.restoreS(new Uint8Array(fs.readFileSync(fB)));
  S = JSON.parse(fs.readFileSync(fJ, 'utf8'));
  S.chunks++;
} else {
  A = boot(SITE === 'seed' ? 0.25 : 0.5, false);
  B = boot(SITE === 'seed' ? 0.75 : 0.5, SITE === 'bore');
  let bumped = '';
  if(SITE === 'h' || SITE === 'm'){
    B.restoreS(A.snapS());
    const arr = B.ST()[SITE === 'h' ? 'hBy' : 'mBy'], i = firstOnCirc(B, arr);
    arr[i] = ulpNext(arr[i]); bumped = (SITE === 'h' ? 'hBy[' : 'mBy[') + i + ']';
  }
  S = { k:0, chunks:1, bumped, first:null, firstK:-1, nat:0, h:0, p:0, tavg:0, pl:0, inAtNat:0, natBreachK:-1,
    ev:0, flips:0, exhA:0, exhB:0, passA:{}, passB:{}, tight:0, tightAt:-1, tightNoConv:0, natA:0, natB:0 };
}
if(SITE === 'slice') C = boot(0.5, false);
const { E_NAT_TOL, E_NAT_PASSES, E_NAT_EVERY } = A;

for(; S.k < TICKS && Date.now() - t0 < WALL; S.k++){
  order(A, S.k); order(B, S.k);
  const due = (A.ST().sc[SC_NATTICK] + 1) % E_NAT_EVERY === 0;
  if(REPLAY && due){
    const ra = replay(A, TIGHT), rb = replay(B, false);
    S.ev++;
    S.passA[ra.passes] = (S.passA[ra.passes] || 0) + 1; S.passB[rb.passes] = (S.passB[rb.passes] || 0) + 1;
    if(ra.passes !== rb.passes) S.flips++;
    if(!ra.conv) S.exhA++; if(!rb.conv) S.exhB++;
    if(TIGHT){ if(!ra.tconv) S.tightNoConv++;
      const d = rel(ra.tight, ra.reading); if(d > S.tight){ S.tight = d; S.tightAt = A.ST().sc[SC_T]; } }
  }
  A.step(0.02); B.step(0.02);
  if(C && (S.k + 1) % SLICE_EVERY === 0){ C.restoreS(Uint8Array.from(B.snapS())); const w = B; B = C; C = w; }
  const sa = A.ST().sc, sb = B.ST().sc;
  if(S.firstK < 0 && !sameBytes(A, B)){ S.firstK = S.k; S.first = A.eqWhere(A.snapS(), B.snapS()); }
  const dn = rel(sa[SC_NAT], sb[SC_NAT]), dh = circSplit(A, B, 'hBy'), dp = circSplit(A, B, 'pBy');
  S.h = Math.max(S.h, dh); S.p = Math.max(S.p, dp);
  S.tavg = Math.max(S.tavg, rel(sa[SC_TAVG], sb[SC_TAVG])); S.pl = Math.max(S.pl, rel(sa[SC_P], sb[SC_P]));
  if(dn > S.nat){ S.nat = dn; S.inAtNat = Math.max(S.h, S.p); }
  S.natA = sa[SC_NAT]; S.natB = sb[SC_NAT];
  if(S.natBreachK < 0 && dn > E_NAT_TOL && Math.max(S.h, S.p) < E_NAT_TOL/100) S.natBreachK = S.k;
}

if(S.k < TICKS){
  fs.writeFileSync(fA, Buffer.from(A.snapS())); fs.writeFileSync(fB, Buffer.from(B.snapS()));
  fs.writeFileSync(fJ, JSON.stringify(S));
  process.stdout.write('@@MORE (' + S.k + '/' + TICKS + ' ticks)\n');
  process.exit(0);
}
for(const f of [fA, fB, fJ]) if(fs.existsSync(f)) fs.unlinkSync(f);

const e = x => x.toExponential(2);
const t2 = S.nat <= 0.56*S.inAtNat + E_NAT_TOL;
console.log('preset ' + PRE + ' site ' + SITE + (S.bumped ? ' (' + S.bumped + ')' : '') + ' transient ' + TRANS + ', ' + S.k + ' ticks in ' + S.chunks + ' process(es)' + (TIGHT ? ', --tight' : ''));
console.log('  first difference: ' + (S.firstK < 0 ? 'none (byte-identical every tick)' : 'tick ' + S.firstK + ' ' + S.first));
console.log('  max rel split: nat ' + e(S.nat) + ' (last A ' + e(S.natA) + ' B ' + e(S.natB) + ', circuit input split by then ' + e(S.inAtNat) + ')' +
  '  circuit hBy ' + e(S.h) + '  pBy ' + e(S.p) + '  Tavg ' + e(S.tavg) + '  P ' + e(S.pl));
console.log('  T2 (nat split <= 0.56 input split + E_NAT_TOL ' + E_NAT_TOL + '): ' + (t2 ? 'inside' : 'BREACH') +
  (S.natBreachK >= 0 ? ', nat split past E_NAT_TOL with input split < E_NAT_TOL/100 at tick ' + S.natBreachK : ''));
if(REPLAY) console.log('  recomputes ' + S.ev + ': passes A ' + JSON.stringify(S.passA) + ' B ' + JSON.stringify(S.passB) +
  ', pass count differs ' + S.flips + ', exhausted ' + E_NAT_PASSES + ' passes A ' + S.exhA + ' B ' + S.exhB);
if(TIGHT) console.log('  T3 worst |reading - fixed point| / fixed point ' + e(S.tight) + ' at t ' + S.tightAt.toFixed(2) +
  ' s (limit ' + e(10*E_NAT_TOL) + ')' + (S.tightNoConv ? ', tight loop short of ' + TIGHT_TOL + ' on ' + S.tightNoConv : ''));
