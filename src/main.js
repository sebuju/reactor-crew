"use strict";
/* frame loop and boot */

let prev=performance.now();
function tick(now){
  let dt=(now-prev)/1000; prev=now; dt=Math.min(dt,.25);
  simFrame(dt);
  fillRect(0,0,W,H,C.bg);
  ctx.fillStyle=gridPat; ctx.fillRect(0,TOPBAR_H,W,H-TOPBAR_H);
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
