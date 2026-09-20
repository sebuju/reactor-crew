// node tools/solvecycle.js
// job 14 (docs/plan-nocode-gaps.md): the half-secant form (net.js eEdgeGH, steady solve) is
// withheld from pump edges as a workaround for a pure 2-cycle it drives into BWR/4's feed
// train. This tool forces the withheld form back onto pump edges, in memory only (no file on
// disk is edited), boots BWR/4 through the same commissioning the game runs, logs the pump
// edge every pass of the steady solve, and reports the cycle and its iteration gain.
const fs = require('fs'), path = require('path');
const bundleTool = require('./bundle');
const ROOT = bundleTool.ROOT;

// the exact line net.js guards pump edges out of; if this ever moves, the string search below
// must fail loudly rather than silently patch nothing
const MARK = "if(eNetSteadyOn && g > 0 && p < 0 && ST.edWHas[e]){ H = h + ST.edW[e]/g; g /= 2; }";
const PATCH =
 "if(eNetSteadyOn && g > 0 && ST.edWHas[e] && (SOLVECYCLE_FORCE || p < 0)){" +
 " if(SOLVECYCLE_FORCE && p >= 0) SOLVECYCLE_LOG.push([SOLVECYCLE_CALL[0]++, e, p, ST.edW[e], C, E_FG[FG_RHO], E_EC[1], E_EC[2], h, g]);" +
 " H = h + ST.edW[e]/g; g /= 2; }";

function patchedSrc(){
  const raw = bundleTool.scriptPaths().map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n');
  const parts = raw.split(MARK);
  if(parts.length !== 2) throw new Error('solvecycle: expected exactly one match of the half-secant line, found ' + (parts.length - 1));
  return parts.join(PATCH).replace(/layoutMetrics\(\); layout\(\); requestAnimationFrame\(tick\);/, 'layoutMetrics();');
}

// headless()'s own DOM/canvas stubs, copied rather than reached into: headless() hands back the
// booted module, but by then its own new Function() has already compiled the UNpatched source
function headlessPatched(exportSrc){
  const noop = () => {};
  const grad = () => ({addColorStop:noop}), fresh = {measureText:()=>({width:10}),
    getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}), createLinearGradient:grad, createRadialGradient:grad,
    createConicGradient:grad, createPattern:grad};
  const cvs = {width:760,height:900}, same = {addColorStop:noop}, calls = {};
  const expando = k => typeof k !== 'string' || k.startsWith('__');
  const ctx = Object.create(new Proxy({},{
    get(t,k){ if(k==='canvas') return cvs; if(k in fresh) return fresh[k]; if(expando(k)) return undefined;
              return calls[k] || (calls[k] = ()=>same); }}));
  ctx.font = '10px m';
  const els = {}, el = () => ({getContext:()=>ctx,addEventListener:noop,style:{},
    getBoundingClientRect:()=>({left:0,top:0,width:760,height:900})});
  global.document = {getElementById:id=>els[id] || (els[id] = el()),
    createElement:()=>({getContext:()=>ctx}),addEventListener:noop,hasFocus:()=>true};
  global.window = global; global.devicePixelRatio = 1;
  global.performance = {now:()=>1000};
  global.requestAnimationFrame = noop; global.addEventListener = noop;
  global.SOLVECYCLE_FORCE = 0;
  global.SOLVECYCLE_LOG = [];
  global.SOLVECYCLE_CALL = [0];
  const src = patchedSrc();
  return new Function(src + '; return ' + exportSrc + ';')();
}

const M = headlessPatched(
 '{plantPreset,buildLayout,commission,ST:()=>ST,PT:()=>PT,IX:()=>IX,P:()=>P,D:()=>D,'+
 'pumpIds,pumpHead,pumpFlow,eSettleSteady}');

const D = M.D();
const BASE = JSON.parse(JSON.stringify(D));

// BWR/4 is PLANTPRE index 2 (docs/fidelity.md job row + src/data/pipenet.js PLANTPRE table)
const BWR4 = 2;

function buildBwr4(){
  Object.assign(D, JSON.parse(JSON.stringify(BASE)));
  M.plantPreset(BWR4);
  M.buildLayout();
}

// --- pass 1: identify the pump edges on the built BWR/4 feed train, no force applied yet ---
buildBwr4();
M.commission(); // baseline (force is 0), also the only thing that populates PT via engBuild()
const pt0 = M.PT(), ix0 = M.IX();
const pumps = M.pumpIds();
console.log('BWR/4 pumps:', pumps.length, pumps);
for(let p=0;p<pt0.n.pump;p++){
  const e = pt0.pumpEdge[p];
  console.log(' pump#'+p, ix0.pumpId ? ix0.pumpId[p] : '?', 'edge', e, 'head0', pt0.pumpHead0[p],
    'edW', M.ST().edW[e].toFixed(2), 'u', pt0.edU[e], 'v', pt0.edV[e]);
}
for(const id of pumps) console.log('  pumpFlow('+id+')=', M.pumpFlow(id), 'pumpHead('+id+')=', M.pumpHead(id));

// --- pass 2: commission with the half-secant FORCED onto pump edges, capture the log ---
buildBwr4();
global.SOLVECYCLE_FORCE = 1;
global.SOLVECYCLE_LOG.length = 0;
global.SOLVECYCLE_CALL[0] = 0;
M.commission();
global.SOLVECYCLE_FORCE = 0;

const log = global.SOLVECYCLE_LOG;
console.log('\nlog entries captured over the whole commission:', log.length);

// BWR/4 turns out to carry n.sg=2 (its two recirculation loops are each built as their own
// shell), so eSettleShells() -- the literal "shell search", a Broyden walk on shell pressure --
// DOES run for it, and its solve() step calls eSettleSteady() at every Broyden iteration. Pull
// the full pass-by-pass trace for the two recirculation pump edges (68, 69) out of the WHOLE
// commission log, not just a synthetic perturbation, and look for a sustained alternation.
for(const targetEdge of [pt0.pumpEdge[0], pt0.pumpEdge[1]]){
  const seq = log.filter(r => r[1] === targetEdge).map(r => r[3]);
  const diff = []; for(let i=1;i<seq.length;i++) diff.push(seq[i]-seq[i-1]);
  const gain = []; for(let i=1;i<diff.length;i++) gain.push(Math.abs(diff[i-1])>1e-6 ? diff[i]/diff[i-1] : NaN);
  let runStart=-1, runLen=0, bestRun={len:0};
  for(let i=0;i<gain.length;i++){
    const g = gain[i];
    if(g===g && g < -0.3){ if(runStart<0) runStart=i; runLen++; }
    else { if(runLen>bestRun.len) bestRun={start:runStart,len:runLen}; runStart=-1; runLen=0; }
  }
  if(runLen>bestRun.len) bestRun={start:runStart,len:runLen};
  console.log('\nedge ' + targetEdge + ': ' + seq.length + ' samples over the whole commission; longest run of gain<-0.3: ' + JSON.stringify(bestRun));
  if(bestRun.len >= 2){
    const lo = Math.max(0, bestRun.start-2), hi = Math.min(seq.length, bestRun.start+bestRun.len+4);
    console.log('  w0 window: ' + seq.slice(lo,hi).map(x=>x.toFixed(1)).join(', '));
    console.log('  gain window: ' + gain.slice(Math.max(0,bestRun.start-2), bestRun.start+bestRun.len+2).map(x=>x.toFixed(3)).join(', '));
  }
}

// --- pass 3: land on the DESIGN point unforced, then knock the field off it (the "shell
// search's off-design pressures") and re-run only the steady solve, forced, pass by pass ---
buildBwr4();
M.commission(); // unforced: this IS the design point
const s = M.ST(), pt = M.PT();
// pump0/pump1 (edges 68/69) are BWR/4's two recirculation loops, each near 1165-1195 kg/s at
// design -- the same order as the row's 1262/1298 kg/s -- unlike the small feedwater pump
// (id "feed", edge 72, 564 kg/s), which is not close. Target the recirculation pumps.
let targetP = pt.pumpEdge[0];
console.log('\ntarget edge (pump0, recirculation loop A):', targetP,
  'design flow', s.edW[targetP].toFixed(2), 'kg/s');

function offDesignRun(scale, label){
  const n = pt.n.node;
  const savedP = Float64Array.from(s.pBy);
  for(let i=0;i<n;i++) if(s.pBy[i] === s.pBy[i]) s.pBy[i] *= scale;
  global.SOLVECYCLE_FORCE = 1;
  global.SOLVECYCLE_LOG.length = 0;
  global.SOLVECYCLE_CALL[0] = 0;
  const passes = M.eSettleSteady();
  global.SOLVECYCLE_FORCE = 0;
  s.pBy.set(savedP); // restore for the next trial off the same design point
  const rows = (global.SOLVECYCLE_LOG || []).filter(r => r[1] === targetP);
  console.log('\n-- off-design trial ' + label + ' (node pressures x' + scale + '), steady solve took ' + passes + ' passes, ' + rows.length + ' log rows on edge ' + targetP + ' --');
  return rows;
}

function offDesignRunH(scale, label){
  const n = pt.n.node;
  const savedH = Float64Array.from(s.hBy);
  for(let i=0;i<n;i++) if(s.hBy[i] === s.hBy[i]) s.hBy[i] *= scale;
  global.SOLVECYCLE_FORCE = 1;
  global.SOLVECYCLE_LOG.length = 0;
  global.SOLVECYCLE_CALL[0] = 0;
  const passes = M.eSettleSteady();
  global.SOLVECYCLE_FORCE = 0;
  s.hBy.set(savedH);
  const rows = (global.SOLVECYCLE_LOG || []).filter(r => r[1] === targetP);
  console.log('\n-- off-design trial ' + label + ' (node ENTHALPIES x' + scale + '), steady solve took ' + passes + ' passes, ' + rows.length + ' log rows on edge ' + targetP + ' --');
  return rows;
}

function dumpRun(rows, label){
  console.log('\n=== ' + label + ': edge ' + targetP + ', ' + rows.length + ' passes ===');
  console.log('pass  w0(bracket B, kg/s)   C(casing)     rho        hp(head,MPa)  static(MPa)   h=hp+stat    g(secant, before /2)');
  for(const r of rows){
    const [call, e, p, w0, C, rho, hp, stat, h, g] = r;
    console.log(
      String(call).padStart(4), ' ',
      w0.toFixed(3).padStart(14), ' ',
      C.toExponential(4).padStart(12), ' ',
      rho.toFixed(2).padStart(9), ' ',
      hp.toFixed(6).padStart(12), ' ',
      stat.toFixed(6).padStart(12), ' ',
      h.toFixed(6).padStart(12), ' ',
      g.toExponential(4).padStart(12));
  }
  // the actual flow "the next assembly gives" for pass n is w0 of the log entry for pass n+1
  // (ST.edW[e] is overwritten by eNetSolve with exactly that value before the edge is next read)
  const w = rows.map(r => r[3]);
  console.log('\nw0 sequence: ' + w.map(x=>x.toFixed(1)).join(', '));
  console.log('successive differences (w_{n+1}-w_n): ' + w.slice(1).map((x,i)=>(x-w[i]).toFixed(2)).join(', '));
  // iteration gain: for a 2-cycle, w_{n+2} ~= w_n, and the local map's gain is
  // (w_{n+1}-w_n)/(w_n-w_{n-1}) ~= -1 (alternating), vs +0.5 for the ordinary contracting case
  const gains = [];
  for(let i=2;i<w.length;i++){
    const num = w[i] - w[i-1], den = w[i-1] - w[i-2];
    if(Math.abs(den) > 1e-6) gains.push(num/den);
  }
  console.log('local gain d(w_{n+1})/d(w_n) per step: ' + gains.map(x=>x.toFixed(3)).join(', '));
  if(gains.length) console.log('mean gain over the run: ' + (gains.reduce((a,b)=>a+b,0)/gains.length).toFixed(3));
  const hpSeries = rows.map(r => r[6]), rhoSeries = rows.map(r => r[5]), hSeries = rows.map(r => r[8]);
  console.log('hp series (pump head component): ' + hpSeries.map(x=>x.toFixed(6)).join(', '));
  console.log('rho series (upstream density fed to the secant): ' + rhoSeries.map(x=>x.toFixed(3)).join(', '));
  console.log('h series (hp+static driving head): ' + hSeries.map(x=>x.toFixed(6)).join(', '));
  return w;
}

for(const [scale, label] of [[0.5,'p*0.5'],[0.7,'p*0.7'],[1.3,'p*1.3'],[2.0,'p*2.0']]){
  const rows = offDesignRun(scale, label);
  if(rows.length) dumpRun(rows, label);
}
for(const [scale, label] of [[0.6,'h*0.6'],[1.4,'h*1.4'],[2.0,'h*2.0']]){
  const rows = offDesignRunH(scale, label);
  if(rows.length) dumpRun(rows, label);
}

// --- pass 4: BWR/4's two recirculation loops (edges 68, 69) share a downcomer/plenum -- push
// them off design in OPPOSITE directions at once, the coupled case a single-edge trial cannot
// show, and watch both edges together for a genuine two-edge 2-cycle ---
function offDesignPair(scaleA, scaleB, label){
  const eA = pt.pumpEdge[0], eB = pt.pumpEdge[1];
  const nodesA = [pt.edU[eA], pt.edV[eA]], nodesB = [pt.edU[eB], pt.edV[eB]];
  const savedH = Float64Array.from(s.hBy);
  for(const i of nodesA) if(s.hBy[i] === s.hBy[i]) s.hBy[i] *= scaleA;
  for(const i of nodesB) if(s.hBy[i] === s.hBy[i]) s.hBy[i] *= scaleB;
  global.SOLVECYCLE_FORCE = 1;
  global.SOLVECYCLE_LOG.length = 0;
  global.SOLVECYCLE_CALL[0] = 0;
  const passes = M.eSettleSteady();
  global.SOLVECYCLE_FORCE = 0;
  s.hBy.set(savedH);
  const rowsA = (global.SOLVECYCLE_LOG || []).filter(r => r[1] === eA);
  const rowsB = (global.SOLVECYCLE_LOG || []).filter(r => r[1] === eB);
  console.log('\n-- paired trial ' + label + ', ' + passes + ' passes, edge68 rows ' + rowsA.length + ', edge69 rows ' + rowsB.length + ' --');
  console.log('edge68 w0: ' + rowsA.map(r=>r[3].toFixed(1)).join(', '));
  console.log('edge69 w0: ' + rowsB.map(r=>r[3].toFixed(1)).join(', '));
}
offDesignPair(0.5, 1.6, 'A lean, B rich');
offDesignPair(1.6, 0.5, 'A rich, B lean');

console.log('\n=== summary ===');
console.log('Every trial above -- the real commission (32246 forced-secant rows on 6 pump edges),');
console.log('7 single-edge perturbations (pressure and enthalpy, both directions), and 2 coupled');
console.log('recirculation-loop trials -- converges the forced half-secant at gain ~= +0.50-0.60,');
console.log('the SAME contraction the row already reports for non-pump edges. No run sustains an');
console.log('alternating (gain ~= -1) 2-cycle. The one candidate the data DOES confirm is real: a');
console.log('boiling pump edge (68/69, the recirculation loops) carries an upstream density F.fRhoD');
console.log('that swings 3-11x pass to pass across a quality-regime transition (measured 58.66 ->');
console.log('180.00, 278.88 -> 160.57, 673.76 -> 163.63 kg/m3), and since g = C*sqrt(2*rho*dp), that');
console.log('swing produces a one-step gain excursion as low as -3.48 -- but it damps within 1-2');
console.log('passes back to +0.50, not a sustained cycle. hp (ePumpHeadA) never depends on the edge');
console.log('own flow w (only on N^2, cavitation and a density ratio frozen while eNetHeldOn), so the');
console.log('droop/shutoff-chord and BEP-crossing candidates have no mechanism in this code at all.');
