"use strict";
/* frame loop and boot */

let prev=performance.now();
/* THE SLOWEST THE SCREEN MAY BE WRONG FOR. uiDirty() (core/ui.js) catches
   every hand movement and simFrame() reports every tick, which between them
   is every reason the picture changes - but "every reason" is a claim, and
   this is what it costs to be wrong about it: a quarter second, at a quarter
   of one frame's work per second. */
const IDLE_MS=250;
let lastDraw=-1e9;
/* requestAnimationFrame IS A QUEUE FOR THE SCREEN. It hands the loop back on a
   vsync boundary whether or not anything was painted, so a run that draws
   nothing still waited for the monitor and idled a third of every frame.
   A message port has no boundary and, unlike setTimeout, no 4 ms clamp on a
   nested timer - the loop comes back as soon as the task queue is empty, which
   still leaves the hand and the clock their turn between frames.
   Built on the first quiet frame and not at load: an open port holds the node
   event loop open, and the headless bundle runs this file and expects to end. */
let trPump = null;
const nextFrame = () => {
  if(!trQuiet()){ requestAnimationFrame(tick); return; }
  if(!trPump){ trPump = new MessageChannel(); trPump.port1.onmessage = () => tick(performance.now()); }
  trPump.port2.postMessage(0);
};
function tick(now){
  let dt=(now-prev)/1000; prev=now; dt=Math.min(dt,.25);
  const stepped=simFrame(dt);
  // taken unconditionally: short-circuiting behind `stepped` would leave the
  // flag set through a whole run and spend it on the first still frame after
  const want=uiTakeDirty();
  // a validation run buys its speed here: the whole frame goes to the sim and
  // the canvas holds whatever it last painted - see trQuiet() (record.js)
  if(trQuiet()){ nextFrame(); return; }
  if(!stepped && !want && now-lastDraw<IDLE_MS){ nextFrame(); return; }
  lastDraw=now;
  // the drawing cannot move inside a frame - see laySettle() (layout.js).
  // layoutMetrics() itself is NOT called here: drawPlant() calls it, and it
  // walks the plant a dozen ways that all want to be inside the window.
  layFresh(); laySettle(); netPassStart();
  fillRect(0,0,W,H,C.bg);
  gridDots(0,TOPBAR_H,W,H-TOPBAR_H);
  ui.widgets=[]; ui.tips=[];
  if(screen==="design") drawDesign();
  else if(screen==="operate") drawOperate();
  else if(screen==="scenario") drawScenario();
  else drawHelp();   // HELP is HTML now; the branch stays so an unbranched tab still falls somewhere
  tipSync();
  ui.prev=ui.widgets;
  layRelease();
  nextFrame();
}

storeProbe();   // fired once, never awaited - see storeProbe() in data/store.js

layoutMetrics(); layout(); requestAnimationFrame(tick);

/* after layoutMetrics(), because shellSync() asks designBlocked() and that
   reads LAY. Guarded: no document under the headless bundle or the sim worker.
   tools/bundle.js strips the boot line above by exact text - do not reword it. */
if(typeof document!=="undefined" && document.documentElement){
  shellInit();
  helpBuildDOM();
  shellSync();
  urlApply();
  setInterval(()=>{ shellSync(); urlSync(); },100);
}
