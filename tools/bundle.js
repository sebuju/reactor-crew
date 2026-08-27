/* Single source of truth for "what code does the page actually run?".
   Every auditor goes through this so none of them can drift from index.html. */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

function scriptPaths(){
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
}

/* every script concatenated in load order, exactly as the browser sees it.
   Memoised: audit-geometry asks for the source and then for a headless plant,
   which is nineteen files read twice to build one identical string. */
let bundleSrc = null;
function bundle(){
  if(bundleSrc === null)
    bundleSrc = scriptPaths().map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n');
  return bundleSrc;
}

/* Run the whole page headless.

   The auditors that need to *execute* the plant (not just read its source) all need
   the same scaffolding: enough of a DOM and a 2d context for the render layer to
   construct without touching a screen, and the boot line replaced so the bundle
   initialises but never starts a frame loop we would then have to stop.

   `exportSrc` is the source of an object literal appended to the bundle, so the
   caller picks what it wants out of the top-level scope. It is source rather than
   a list of names because several of those bindings - `S`, `P`, `LAY` - are
   *reassigned* during a run, so a caller that cares about the live value has to
   ask for a getter (`S:()=>S`) and one that does not can take the value directly. */
/* THE CLOCK IS A STUB, AND A CONSTANT STUB IS A BLIND ONE.
   performance.now() returned a fixed 1000 here for as long as this file has
   existed, which is fine for a renderer and useless for the determinism check:
   any wall clock leaking into S is CONSTANT under a frozen clock, so a
   snapshot/restore round trip passes while the leak sits there. Pass
   {clock:true} and the stub advances instead, so a tick that reads the wall
   shows up as two futures that disagree. Default stays frozen, because every
   other caller wants a still picture. */
function headless(exportSrc, opts){
  const noop = () => {};
  const ctx = new Proxy({font:'10px m'},{
    get(t,k){ if(k==='measureText') return ()=>({width:10});
              if(k==='canvas') return {width:760,height:900};
              if(k in t) return t[k]; return ()=>({addColorStop(){}}); },
    set(t,k,v){ t[k]=v; return true; }});
  global.document = {getElementById:()=>({getContext:()=>ctx,addEventListener:noop,style:{},
    getBoundingClientRect:()=>({left:0,top:0,width:760,height:900})}),
    createElement:()=>({getContext:()=>ctx}),addEventListener:noop};
  global.window = global; global.devicePixelRatio = 1;
  let wall = 1000;
  global.performance = (opts && opts.clock) ? {now:()=>(wall += 17)} : {now:()=>1000};
  global.requestAnimationFrame = noop; global.addEventListener = noop;

  const src = bundle().replace(
    /layoutMetrics\(\); layout\(\); requestAnimationFrame\(tick\);/, 'layoutMetrics();');
  return new Function(src + '; return ' + exportSrc + ';')();
}

/* ══════════ PLACING A FITTING, THE WAY A PLAYER DOES ══════════
   A fitting used to be a fraction along a pipe key, so an auditor could
   place one in a single addFit(mode, aKey, aT, bKey, bT) call. It is a
   COMPONENT in a grid CELL now, and placing one is three gestures: put the
   box down, draw a run to it, draw a run from it. That is more honest and it
   is also three lines at ~40 call sites, which is exactly the kind of
   duplication that drifts - so both shapes are written ONCE, here, beside
   headless(), which is the only module every auditor already loads.

   These build nothing the bench cannot: addFitting(), addRun() and
   removeRun() are the same calls the context menu and the part drag make.
   M is a headless() export bag and must carry D, pipeNetwork, addFitting,
   addRun and removeRun.

   spliceFitting: cut a RUN and put a fitting in the middle of it. The two
   halves keep the original run's own end faces, so the plant is the plant it
   was with a box in the line.
   tieFitting: a fitting between two PORTS on two different machines - what a
   cross-tie is, now that nothing can tap a pipe mid-run. */
function spliceFitting(M, runKey, mode, cell){
  const D = M.D();
  const r = M.pipeNetwork().find(x => x.key === runKey);
  if(!r || !r.rid) throw new Error("spliceFitting: no run keyed " + runKey);
  const e = D.run[r.rid], a = e.a, af = e.af, b = e.b, bf = e.bf;
  M.removeRun(r.rid);
  const fid = M.addFitting(cell[0], cell[1]);
  D.fittings[fid].mode = mode;
  M.addRun(a, af, fid, "l");
  M.addRun(fid, "r", b, bf);
  return fid;
}
function tieFitting(M, aId, aFace, bId, bFace, mode, cell){
  const D = M.D();
  const fid = M.addFitting(cell[0], cell[1]);
  D.fittings[fid].mode = mode;
  M.addRun(aId, aFace, fid, "l");
  M.addRun(fid, "r", bId, bFace);
  return fid;
}

module.exports = { ROOT, scriptPaths, bundle, headless, spliceFitting, tieFitting };
