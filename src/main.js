"use strict";
/* frame loop and boot */

/* ═══════════════ FRAME ═══════════════ */
let acc=0,prev=performance.now();
function tick(now){
  let dt=(now-prev)/1000; prev=now; dt=Math.min(dt,.25);
  if(P&&screen==="operate"){ acc+=dt; while(acc>=0.02){ step(0.02); acc-=0.02; }
    sampT+=dt; while(sampT>=0.1){ sample(); sampT-=0.1; } } else acc=0;
  fillRect(0,0,W,H,C.bg);
  ctx.fillStyle=gridPat; ctx.fillRect(0,40,W,H-40);
  ui.widgets=[]; ui.tips=[]; topbar();
  if(screen==="design") drawDesign();
  else if(screen==="operate"){ const y=drawMimic();
    drawAnnunciator(y); drawDamage(y+128); drawTrend(y+250); drawLog(y+438);
    drawLedger(y+636); drawFaults(y+800); }
  else drawHelp();
  drawTip();
  ui.prev=ui.widgets;
  requestAnimationFrame(tick);
}
layoutMetrics(); layout(); requestAnimationFrame(tick);
