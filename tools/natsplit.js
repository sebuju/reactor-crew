#!/usr/bin/env node
// node tools/natsplit.js [ticks] [--resume]
// docs/backlog.md (18/09/26): ST.sc[SC_NAT] (eNetNat(), src/eng/net.js) swings ~1% between two preset-0 runs
// whose inputs differ only at rounding level, while every other state field stays within 1e-6.
//
// Two independent engines boot preset 0 identically (Math.random pinned so engSettle()'s one draw, the
// commissioning seed, does not itself split them - src/eng/tick.js:320). B is then forced byte-identical
// to A via a snapshot restore, and ONE node's commissioned pressure (ST.pBy) is bumped 1 ulp - a rounding-
// level difference injected straight into eNetNat()'s own input, which is what the backlog line is about.
// (A 1-ulp bump to the STOCK PWR preset's one authored figure, core.chim, was tried first and found inert:
// chim only feeds design.js's mass/grace-time display math, never engBuild()/commission() - the two runs
// came out byte-identical. Left out of the final script; noted here so it is not tried again.)
//
// eNetNat()'s own fixed-point loop (net.js:811-825, E_NAT_PASSES=8, E_NAT_TOL=1e-3) is replayed here pass
// by pass through its OWN exported primitives (eNetSolve/eNetReadP/eNetCoreLoop) - not touched, just called -
// to see the pass count and the "core" trajectory each engine takes, and where the tolerance test (net.js:807)
// flips between them.
//
// Chunks through snapS()/restoreS() to a temp file pair and prints @@MORE past the 10 s budget, same idiom
// as tests/physics/presets.js.
"use strict";
const fs = require('fs'), os = require('os'), path = require('path');
const { headless } = require('./bundle');

const EXPORT = '{plantPreset,buildLayout,commission,step,coreD,snapS,restoreS,eqWhere,act,' +
  'eNetCoreLoop,eNetSolve,eNetReadP,eNetHold,eNetScale,E_NAT_TOL,E_NAT_PASSES,E_NAT_EVERY,' +
  'ST:()=>ST,SX:()=>SX,E_NL:()=>E_NL}';

function ulpNext(x){
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  let bits = dv.getBigUint64(0);
  bits = x >= 0 ? bits + 1n : bits - 1n;
  dv.setBigUint64(0, bits);
  return dv.getFloat64(0);
}

function boot(){
  const M = headless(EXPORT);
  M.plantPreset(0);
  M.buildLayout();
  const real = Math.random; Math.random = () => 0.5;
  M.commission();
  Math.random = real;
  return M;
}

// net.js:811-825's eNetNat(), replayed pass by pass through its own exported primitives; not a copy that can drift,
// a caller of the same functions the tick uses, just logging what each pass returns.
function myNat(M){
  const ST = M.ST(), SX = M.SX(), sc = ST.sc;
  const wSave = Float64Array.from(ST.edW), wSaveHas = Uint8Array.from(ST.edWHas);
  const held = M.eNetHold(1), scale = M.eNetScale(0);
  let pA = sc[SC_NATHAS] ? ST.natPBy : ST.pBy;
  M.E_NL()[1] = NaN;
  const hist = [];
  let passes = 0, conv = 0;
  for(let pass=0; pass<M.E_NAT_PASSES; pass++){
    M.eNetSolve(pA, 1);
    M.eNetReadP(SX.pSolve); pA = SX.pSolve;
    conv = M.eNetCoreLoop(null);
    hist.push(M.E_NL()[0]);
    passes = pass+1;
    if(conv) break;
  }
  M.eNetCoreLoop(ST.natLoop);
  ST.natPBy.set(SX.pSolve); sc[SC_NATHAS] = 1;
  M.eNetHold(held); M.eNetScale(scale);
  ST.edW.set(wSave); ST.edWHas.set(wSaveHas);
  return { passes, conv, hist };
}

const TICKS = +(process.argv[2] || 3000);
const resume = process.argv.includes('--resume');
const fA = path.join(os.tmpdir(), 'rc-natsplit-a.bin'), fB = path.join(os.tmpdir(), 'rc-natsplit-b.bin');
const fJ = path.join(os.tmpdir(), 'rc-natsplit.json');
const WALL = 7000, t0 = Date.now();

let A, B, S;
if(resume && fs.existsSync(fJ)){
  A = boot(); B = boot();
  A.restoreS(new Uint8Array(fs.readFileSync(fA))); B.restoreS(new Uint8Array(fs.readFileSync(fB)));
  S = JSON.parse(fs.readFileSync(fJ, 'utf8'));
} else {
  A = boot(); B = boot();
  B.restoreS(A.snapS());   // byte-identical to A before the bump
  // pBy is re-solved to convergence every tick regardless of its starting guess (Newton lands on the same fixed
  // point to the ulp, guess or no) - bumping it was tried first and erased itself in the very first M.step().
  // hBy is carried forward by eAdvectStep()'s explicit integration, not re-solved, so a bump here survives.
  const hB = B.ST().hBy;
  let idx = -1;
  for(let i=0;i<hB.length;i++) if(hB[i] === hB[i] && hB[i] !== 0){ idx = i; break; }
  if(idx < 0) throw new Error('no finite nonzero node enthalpy to bump');
  hB[idx] = ulpNext(hB[idx]);
  console.log('bumped B hBy[' + idx + '] by 1 ulp: ' + A.ST().hBy[idx] + ' -> ' + hB[idx]);
  const firstField = A.eqWhere(A.snapS(), B.snapS());
  S = { k:0, events:[], firstField, firstBigK:-1, firstBigField:null, maxDNat:0, maxDTavg:0, maxDP:0, blackoutDone:false,
    E_NAT_TOL:A.E_NAT_TOL, E_NAT_PASSES:A.E_NAT_PASSES, E_NAT_EVERY:A.E_NAT_EVERY };
  console.log('post-commission (t=0): first differing field ' + firstField);
}
const { E_NAT_TOL, E_NAT_PASSES, E_NAT_EVERY } = S;

const BLACKOUT_AT = 250;   // t=5s: pumps trip, eNetNat()'s thermosiphon is what actually matters from here on
for(; S.k < TICKS && Date.now() - t0 < WALL; S.k++){
  if(S.k === BLACKOUT_AT && !S.blackoutDone){ A.act('blackout', true); B.act('blackout', true); S.blackoutDone = true; }
  A.step(0.02); B.step(0.02);
  const scA = A.ST().sc, scB = B.ST().sc;
  if(scA[SC_NATTICK] % E_NAT_EVERY === 0 && scA[SC_NATTICK] === scB[SC_NATTICK]){
    const ra = myNat(A), rb = myNat(B);
    if(S.events.length < 400)
      S.events.push({ t:scA[SC_T], k:S.k, passesA:ra.passes, passesB:rb.passes,
        histA:ra.hist, histB:rb.hist, natA:scA[SC_NAT], natB:scB[SC_NAT] });
  }
  const dNat = Math.abs(scA[SC_NAT] - scB[SC_NAT]) / Math.max(Math.abs(scA[SC_NAT]), 1e-9);
  const dTavg = Math.abs(scA[SC_TAVG] - scB[SC_TAVG]) / Math.max(Math.abs(scA[SC_TAVG]), 1e-9);
  const dP = Math.abs(scA[SC_P] - scB[SC_P]) / Math.max(Math.abs(scA[SC_P]), 1e-9);
  if(dNat > S.maxDNat) S.maxDNat = dNat;
  if(dTavg > S.maxDTavg) S.maxDTavg = dTavg;
  if(dP > S.maxDP) S.maxDP = dP;
  if(S.firstBigK < 0 && dNat > E_NAT_TOL){
    S.firstBigK = S.k; S.firstBigT = scA[SC_T];
    S.firstBigField = A.eqWhere(A.snapS(), B.snapS());
    S.firstBigNatA = scA[SC_NAT]; S.firstBigNatB = scB[SC_NAT];
    S.firstBigDTavg = dTavg; S.firstBigDP = dP;
  }
}

if(S.k < TICKS){
  fs.writeFileSync(fA, Buffer.from(A.snapS())); fs.writeFileSync(fB, Buffer.from(B.snapS()));
  fs.writeFileSync(fJ, JSON.stringify(S));
  process.stdout.write('@@MORE (' + S.k + '/' + TICKS + ' ticks)\n');
  process.exit(0);
}
for(const f of [fA, fB, fJ]) if(fs.existsSync(f)) fs.unlinkSync(f);

console.log('\nmarched ' + S.k + ' ticks, E_NAT_TOL=' + E_NAT_TOL + ' E_NAT_PASSES=' + E_NAT_PASSES + ' E_NAT_EVERY=' + E_NAT_EVERY);
console.log('post-commission first differing field: ' + S.firstField);
console.log('max relative split over the march: nat ' + S.maxDNat.toExponential(3) +
  '   Tavg ' + S.maxDTavg.toExponential(3) + '   P ' + S.maxDP.toExponential(3) +
  '   amplification (max nat split / max(Tavg,P) split) ' + (S.maxDNat/Math.max(S.maxDTavg,S.maxDP,1e-300)).toExponential(3) + 'x');

if(S.firstBigK >= 0){
  console.log('\nfirst tick nat split exceeds its own E_NAT_TOL (' + E_NAT_TOL + '): k=' + S.firstBigK +
    ' t=' + S.firstBigT.toFixed(2) + 's   natA=' + S.firstBigNatA.toExponential(4) + '  natB=' + S.firstBigNatB.toExponential(4) +
    '   (Tavg split ' + S.firstBigDTavg.toExponential(3) + ', P split ' + S.firstBigDP.toExponential(3) + ')');
  console.log('  eqWhere at that tick: ' + S.firstBigField);
} else {
  console.log('\nnat split never exceeded E_NAT_TOL over the march.');
}

console.log('\nnat recompute events (every E_NAT_EVERY=' + E_NAT_EVERY + ' ticks), pass counts and last-pass core kg/s:');
console.log('   t       passesA passesB   coreA(last)      coreB(last)     natA        natB');
let flips = 0;
for(const e of S.events){
  const la = e.histA[e.histA.length-1], lb = e.histB[e.histB.length-1];
  const flip = e.passesA !== e.passesB;
  if(flip) flips++;
  console.log('  ' + e.t.toFixed(2).padStart(6) + '  ' + String(e.passesA).padStart(5) + '   ' + String(e.passesB).padStart(5) +
    '   ' + la.toExponential(4).padStart(14) + '  ' + lb.toExponential(4).padStart(14) +
    '   ' + e.natA.toExponential(3) + '  ' + e.natB.toExponential(3) + (flip ? '   <-- PASS COUNT DIFFERS' : ''));
}
console.log('\n' + flips + ' of ' + S.events.length + ' nat recomputes took a different pass count between A and B.');
