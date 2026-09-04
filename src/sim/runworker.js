"use strict";
/* the scenario runner, on a thread of its own */

/* ═══════════════ WHY THIS FILE HAS NO SCRIPT TAG ═══════════════
   It is not part of the page. new Worker() loads it, and it then loads the sim
   out of index.html for itself - so LOAD ORDER STILL LIVES IN EXACTLY ONE
   PLACE. Hard-coding the file list here would be a second definition of the
   program, and it would drift the first time somebody added a script.

   WHAT IT LOADS is the other half of the answer, and it is a POSITIVE rule
   rather than a list of exclusions: core/text.js, everything under data/, and
   everything under sim/. That is the plant. Everything left out - constants,
   chrome, ui, render, screens, main - exists to put pixels on a canvas, and a
   worker has no canvas. The rule is two prefixes and one file, so a new sim
   file is picked up with nothing to remember, and a new renderer is excluded
   with nothing to remember either.

   THE SHIM IS TWO LINES, and that is the measured cost of running the plant
   with no display: `screen` and `layout()`, both of which commission() reaches
   for on its way out. No DOM, no canvas, no 2d context, no stub of any of them.
   `tools/nodom-probe.js` flies the same subset in a bare process, so the day
   the sim starts needing a screen it fails there instead of this file quietly
   failing in a browser nobody is watching. */
let screen = "operate";
function layout(){}

const WORKER_SIM = p =>
  p === "src/core/text.js" || p.startsWith("src/data/") || p.startsWith("src/sim/");

let ready = false;

function loadSim(base){
  /* XMLHttpRequest rather than fetch: it can be made SYNCHRONOUS, and
     importScripts() is synchronous too, so the two sit in one straight line
     with no await between deciding what to load and loading it. In a worker a
     blocking read costs nobody anything - blocking this thread is the entire
     point of having it. */
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
      /* Build the player's reactor, not the stock one. recApplyHead() re-signs
         the design and says whether it matched; a mismatch is refused here
         rather than answered wrongly, because a verdict about a plant you did
         not design is worse than no verdict at all. */
      if(!recApplyHead(msg.head)) throw new Error("design did not rebuild identically");
      commission();
      const r = scnRun(msg.scn);
      /* structured clone carries Float64Array, Infinity and NaN natively, so
         the take goes over as it stands - store.js's packVal exists for JSON,
         which carries none of the three, and is not wanted here. */
      self.postMessage({t:"done", take:r.take, verdict:r.verdict, endS:snapS(S)});
      return;
    }
  }catch(err){
    self.postMessage({t:"err", msg:String((err && err.message) || err)});
  }
};
