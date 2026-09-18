const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

function scriptPaths(){
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
}

let bundleSrc = null;
function bundle(){
  if(bundleSrc === null)
    bundleSrc = scriptPaths().map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n');
  return bundleSrc;
}

// exportSrc is source, not a name list: S/P/LAY are reassigned, so a live caller passes a getter
function headless(exportSrc, opts){
  const noop = () => {};
  // a browser hands back a new object from exactly these, so tools/framealloc.js counts them; every other call is free
  const grad = () => ({addColorStop:noop}), fresh = {measureText:()=>({width:10}),
    getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}), createLinearGradient:grad, createRadialGradient:grad,
    createConicGradient:grad, createPattern:grad};
  const cvs = {width:760,height:900}, same = {addColorStop:noop}, calls = {};
  // the trap sits on the prototype only: a set trap would box every float the paint writes, which a browser does not
  const ctx = Object.create(new Proxy({},{
    get(t,k){ if(k==='canvas') return cvs; if(k in fresh) return fresh[k];
              return calls[k] || (calls[k] = ()=>same); }}));
  ctx.font = '10px m';
  const els = {}, el = () => ({getContext:()=>ctx,addEventListener:noop,style:{},
    getBoundingClientRect:()=>({left:0,top:0,width:760,height:900})});
  global.document = {getElementById:id=>els[id] || (els[id] = el()),
    createElement:()=>({getContext:()=>ctx}),addEventListener:noop,hasFocus:()=>true};
  global.window = global; global.devicePixelRatio = 1;
  let wall = 1000;
  global.performance = (opts && opts.clock) ? {now:()=>(wall += 17)} : {now:()=>1000};
  global.requestAnimationFrame = noop; global.addEventListener = noop;

  const src = bundle().replace(
    /layoutMetrics\(\); layout\(\); requestAnimationFrame\(tick\);/, 'layoutMetrics();');
  return new Function(src + '; return ' + exportSrc + ';')();
}

function portOnFace(M, partId, face){
  const p = M.LAY().parts.find(q => q.id === partId);
  if(!p) return null;
  const n = (face === "t" || face === "b") ? p.w : p.h;
  for(let i = 0; i < n; i++){
    const dx = face === "l" ? -1 : face === "r" ? p.w : i;
    const dy = face === "t" ? -1 : face === "b" ? p.h : i;
    const pid = M.addPortAt(partId, dx, dy);
    if(pid != null) return pid;
  }
  return null;
}
function spliceFitting(M, runKey, mode, cell){
  const D = M.D();
  const r = M.pipeMap().byKey[runKey];
  if(!r) throw new Error("spliceFitting: no run keyed " + runKey);
  for(const [x, y] of r.cells) delete D.pipes[x + "," + y];
  const fid = M.addFitting(cell[0], cell[1]);
  D.fittings[fid].mode = mode;
  M.buildLayout();
  M.seedRun(r.pa, M.addPortAt(fid, -1, 0));
  M.seedRun(M.addPortAt(fid, 1, 0), r.pb);
  return fid;
}
function tieFitting(M, aId, aFace, bId, bFace, mode, cell){
  const D = M.D();
  const fid = M.addFitting(cell[0], cell[1]);
  D.fittings[fid].mode = mode;
  M.buildLayout();
  M.seedRun(portOnFace(M, aId, aFace), M.addPortAt(fid, -1, 0));
  M.seedRun(M.addPortAt(fid, 1, 0), portOnFace(M, bId, bFace));
  return fid;
}

// a hole on the core's own loop if there is one, the damage that matters; M exports IX, PT and runOfCell (see allocprobe.js)
function pipeOnLoop(M){
  const ids = M.IX().partId, pt = M.PT();
  let any = -1;
  for (let a = 0; a < ids.length; a++){
    const id = ids[a]; if (id.indexOf('pipe:') !== 0 || !(pt.partHitW[a] > 0)) continue;
    const [x, y] = id.slice(5).split(',').map(Number);
    if (M.runOfCell(x, y).some(k => /^(hot|cold|loop|pri|core)/.test(k))) return a;
    if (any < 0) any = a; }
  return any;
}

// a line of headless()'s bundle -> "src/..:N"; new Function() puts two header lines ahead of the bundle's first
let starts = null;
function bundleLoc(ln){
  if(starts === null){
    starts = []; let acc = 2;
    for(const p of scriptPaths()){ starts.push([acc, p]); acc += fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n').length; }
  }
  let s = starts[0];
  for(const x of starts){ if(x[0] <= ln) s = x; else break; }
  return s[1] + ':' + (ln - s[0] + 1);
}

module.exports = { ROOT, scriptPaths, bundle, headless, bundleLoc, portOnFace, spliceFitting, tieFitting, pipeOnLoop };
