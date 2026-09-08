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

module.exports = { ROOT, scriptPaths, bundle, headless, portOnFace, spliceFitting, tieFitting };
