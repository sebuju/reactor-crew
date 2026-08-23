/* Single source of truth for "what code does the page actually run?".
   Both auditors use this so they can never drift from index.html. */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

function scriptPaths(){
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
}

/* every script concatenated in load order, exactly as the browser sees it */
function bundle(){
  return scriptPaths().map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n');
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
function headless(exportSrc){
  const noop = () => {};
  const ctx = new Proxy({font:'10px m'},{
    get(t,k){ if(k==='measureText') return ()=>({width:10});
              if(k==='canvas') return {width:760,height:900};
              if(k in t) return t[k]; return ()=>({addColorStop(){}}); },
    set(t,k,v){ t[k]=v; return true; }});
  global.document = {getElementById:()=>({getContext:()=>ctx,addEventListener:noop,style:{},
    getBoundingClientRect:()=>({left:0,top:0,width:760,height:900})}),
    createElement:()=>({getContext:()=>ctx}),addEventListener:noop};
  global.window = global; global.performance = {now:()=>1000}; global.devicePixelRatio = 1;
  global.requestAnimationFrame = noop; global.addEventListener = noop;

  const src = bundle().replace(
    /layoutMetrics\(\); layout\(\); requestAnimationFrame\(tick\);/, 'layoutMetrics();');
  return new Function(src + '; return ' + exportSrc + ';')();
}

module.exports = { ROOT, scriptPaths, bundle, headless };
