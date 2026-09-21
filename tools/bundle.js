const fs = require('fs'), path = require('path'), v8 = require('v8'), os = require('os'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');

// the steam tables cost ~570 ms of the ~660 ms boot and are a pure function of pipenet.js, so every process after the first reads them
function wtabHost(){
  const src = fs.readFileSync(path.join(ROOT, 'src/data/pipenet.js'));
  const file = path.join(os.tmpdir(), 'rc-steam-' + crypto.createHash('sha1').update(src).digest('hex').slice(0, 16) + '.bin');
  let have = null;
  try { have = v8.deserialize(fs.readFileSync(file)); } catch(e){ have = null; }
  const held = {};
  return {file, held,
    fill(m){ if(!have) return false;
      for(const k in m){ const a = have[k]; if(!a || a.length !== m[k].length) return false; }
      for(const k in m) m[k].set(have[k]);
      return true; },
    take(k){ return have[k]; },
    keep(m){ Object.assign(held, m); },
    // a torn file is another process mid-write, so the swap is a rename and a bad read just rebuilds
    flush(){ if(have || !Object.keys(held).length) return;
      const tmp = file + '.' + process.pid;
      try { fs.writeFileSync(tmp, v8.serialize(held)); fs.renameSync(tmp, file); }
      catch(e){ try { fs.unlinkSync(tmp); } catch(e2){} } }};
}

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

// the paint hangs its own caches on the context (ctx.__hatchPats)
const expando = k => typeof k !== 'string' || k.startsWith('__');

// exportSrc is source, not a name list: S/P/LAY are reassigned, so a live caller passes a getter
function headless(exportSrc, opts){
  const noop = () => {};
  // a browser hands back a new object from exactly these, so tools/framealloc.js counts them; every other call is free
  const grad = () => ({addColorStop:noop}), fresh = {measureText:()=>({width:10}),
    getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}), createLinearGradient:grad, createRadialGradient:grad,
    createConicGradient:grad, createPattern:grad};
  const cvs = {width:760,height:900}, same = {addColorStop:noop}, calls = {};
  // the trap sits on the prototype only: a set trap would box every float the paint writes, which a browser does not
  const ctx = (opts && opts.rec) ? recCtx(cvs, fresh, same, opts.rec) : Object.create(new Proxy({},{
    get(t,k){ if(k==='canvas') return cvs; if(k in fresh) return fresh[k]; if(expando(k)) return undefined;
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

  const wtab = global.WTAB_HOST = wtabHost();
  const src = bundle().replace(
    /layoutMetrics\(\); layout\(\); requestAnimationFrame\(tick\);/, 'layoutMetrics();');
  const out = new Function(src + '; return ' + exportSrc + ';')();
  wtab.flush();
  return out;
}

// src/sim/runworker.js booted as a worker boots it: its own file first, then the sim files its WORKER_SIM picks out of index.html
function workerRealm(exportSrc){
  const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const wsrc = read('src/sim/runworker.js');
  const pick = new Function('self', wsrc + '; return WORKER_SIM;')({});
  const posted = [], self = {postMessage: m => posted.push(m)};
  global.XMLHttpRequest = function(){ this.open = () => {}; this.send = () => { this.status = 200; this.responseText = read('index.html'); }; };
  global.importScripts = () => {};
  global.setTimeout = () => 0;
  global.MessageChannel = function(){ this.port1 = {}; this.port2 = {postMessage: () => {}}; };
  const W = new Function('self', wsrc + '\n' + scriptPaths().filter(pick).map(read).join('\n') + '; return ' + exportSrc + ';')(self);
  return {W, self, posted};
}

// bytes allocated by body(): heapUsed alone hides whatever a scavenge inside the window freed, so the collections are read back
function measure(body){
  if (global.gc) global.gc(); else console.log('WARN no --expose-gc: the warm-up heap is in the figure');
  const prof = new v8.GCProfiler(); prof.start();
  const m0 = process.memoryUsage().heapUsed;
  body();
  const m1 = process.memoryUsage().heapUsed;
  const st = prof.stop().statistics;
  let freed = 0;
  for (const g of st)
    freed += g.beforeGC.heapStatistics.usedHeapSize - g.afterGC.heapStatistics.usedHeapSize;
  return [(m1 - m0) + freed, st.length];
}

// every draw call and every state change that moves a state, as text into out(); reads are not drawing, so a memo may drop them
function recCtx(cvs, fresh, same, out){
  const arg = v => typeof v === 'string' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(arg).join(',') + ']' :
    v && typeof v === 'object' ? (v.$d !== undefined ? v.$d : v.getContext ? 'canvas' : 'obj') : String(v);
  const ink = d => { const g = {$d:d}; g.addColorStop = (o, c) => { g.$d += '|' + o + ':' + c; }; return g; };
  const calls = {}, stack = [];
  let val = {}, desc = {};
  return new Proxy({}, {
    get(t, k){
      if(k === 'canvas') return cvs;
      if(k === 'save') return () => { stack.push([Object.assign({}, val), Object.assign({}, desc)]); out('save()'); };
      if(k === 'restore') return () => { if(stack.length) [val, desc] = stack.pop(); out('restore()'); };
      if(/^create.*(Gradient|Pattern)$/.test(k)) return (...a) => ink(k + '(' + a.map(arg).join(',') + ')');
      if(k in fresh) return fresh[k];
      if(expando(k)) return t[k];
      if(k in val) return val[k];
      return calls[k] || (calls[k] = (...a) => { out(k + '(' + a.map(arg).join(',') + ')'); return same; });
    },
    set(t, k, v){
      if(expando(k)){ t[k] = v; return true; }
      val[k] = v;
      const d = arg(v);
      if(desc[k] !== d){ desc[k] = d; out(k + '=' + d); }
      return true;
    }});
}

// the OPERATE-style boot both paint instruments share: fixed clock, dice off, 120 warm frames, then the burst's hit and 120 more
function paintBoot(scr, pre, mode, opts){
  // a browser has one, and without it hatch() strokes a fallback no browser paints
  global.DOMMatrix = function(){ this.scaleSelf = () => this; this.translateSelf = () => this; };
  const M = headless('{plantPreset,buildLayout,commission,tick,uiDirty,act,TR,ST:()=>ST,PT:()=>PT,IX:()=>IX,' +
    'runOfCell:(x,y)=>pipeMap().cellOwner[x+","+y]||[],setScreen:s=>{ screen=s; layout(); },' +
    ((opts && opts.more) || '') + '}', opts);
  let wall = 1000;
  global.performance = {now: () => wall};
  M.plantPreset(pre); M.buildLayout(); M.commission();
  M.ST().sc[SC_DICEOFF] = 1;
  M.setScreen(scr);
  M.TR.paused = mode === 'pause';
  // uiDirty() owes a paint, so every tick() below paints whatever the pacing would have skipped
  const frame = () => { wall += 1000/60; M.uiDirty(); M.tick(wall); };
  for (let k = 0; k < 120; k++) frame();
  if (mode === 'burst'){ const a = pipeOnLoop(M); console.log('hit ' + M.IX().partId[a]); M.act('hit', a);
    for (let k = 0; k < 120; k++) frame(); }
  return {M, frame};
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

function ulpNext(x){
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  dv.setBigUint64(0, x >= 0 ? dv.getBigUint64(0) + 1n : dv.getBigUint64(0) - 1n);
  return dv.getFloat64(0);
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

module.exports = { ROOT, scriptPaths, bundle, headless, paintBoot, workerRealm, measure, bundleLoc, portOnFace, spliceFitting, tieFitting, pipeOnLoop, ulpNext };
