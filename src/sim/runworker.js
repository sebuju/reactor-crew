"use strict";
/* the scenario runner, on a thread of its own */

/* The whole display shim: commission() reaches for both on its way out. */
let screen = "operate";
function layout(){}

const WORKER_SIM = p =>
  p === "src/core/text.js" || p.startsWith("src/data/") || p.startsWith("src/sim/");

let ready = false;

function loadSim(base){
  /* XMLHttpRequest, not fetch: synchronous, like the importScripts() it feeds. */
  const x = new XMLHttpRequest();
  x.open("GET", base + "index.html", false);
  x.send(null);
  if(x.status && x.status >= 400) throw new Error("index.html: HTTP " + x.status);
  const list = [];
  const re = /<script src="([^"]+)"><\/script>/g;
  let m; while((m = re.exec(x.responseText))) if(WORKER_SIM(m[1])) list.push(base + m[1]);
  if(!list.length) throw new Error("no sim files found in index.html");
  importScripts.apply(null, list);
  return list.length;
}

self.onmessage = function(e){
  const msg = e.data || {};
  try{
    if(msg.t === "init"){
      const n = loadSim(msg.base);
      ready = true;
      self.postMessage({t:"ready", files:n});
      return;
    }
    if(msg.t === "run"){
      if(!ready) throw new Error("run before init");
      if(!recApplyHead(msg.head)) throw new Error("design did not rebuild identically");
      commission();
      const r = scnRun(msg.scn);
      /* structured clone carries Float64Array/Infinity/NaN, so no packVal here. */
      self.postMessage({t:"done", take:r.take, verdict:r.verdict, endS:snapS(S)});
      return;
    }
  }catch(err){
    self.postMessage({t:"err", msg:String((err && err.message) || err)});
  }
};
