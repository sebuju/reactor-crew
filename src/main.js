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
function tick(now){
  let dt=(now-prev)/1000; prev=now; dt=Math.min(dt,.25);
  const stepped=simFrame(dt);
  // taken unconditionally: short-circuiting behind `stepped` would leave the
  // flag set through a whole run and spend it on the first still frame after
  const want=uiTakeDirty();
  if(!stepped && !want && now-lastDraw<IDLE_MS){ requestAnimationFrame(tick); return; }
  lastDraw=now;
  fillRect(0,0,W,H,C.bg);
  gridDots(0,TOPBAR_H,W,H-TOPBAR_H);
  ui.widgets=[]; ui.tips=[];
  if(screen==="design") drawDesign();
  else if(screen==="operate") drawOperate();
  else if(screen==="scenario") drawScenario();
  else drawHelp();   // HELP is HTML now; the branch stays so an unbranched tab still falls somewhere
  drawTip();
  ui.prev=ui.widgets;
  requestAnimationFrame(tick);
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
  setInterval(shellSync,100);
}
