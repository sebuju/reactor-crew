"use strict";

let prev=performance.now();
const IDLE_MS=250;
let lastDraw=-1e9;
/* null says the canvas owes a frame, so one is drawn whatever the rate and a validation run holds that. */
let paintedScreen=null;
/* a paint is paced to as many vsyncs as it costs, or cheap and dear frames land on different counts and the motion judders. */
const PAINT_HEAD=1.1, PAINT_MAX=4, PAINT_WIN=48;
const paintLog=[]; let paintN=1, vsyncS=1/60, sinceDraw=0;
// second-worst, so one hitch is not a cadence
const paintCost=()=>{ let a=0,b=0; for(const v of paintLog){ if(v>a){ b=a; a=v; } else if(v>b) b=v; } return b; };
function paintDue(dt){
  if(dt>0 && dt<0.1) vsyncS += (dt-vsyncS)*0.05;
  const cost=paintCost()/1000*PAINT_HEAD;
  if(cost > paintN*vsyncS || cost < (paintN-1)*vsyncS*0.9)
    paintN=clamp(Math.ceil(cost/vsyncS),1,PAINT_MAX);
  sinceDraw++;
  return sinceDraw >= paintN;
}
/* a run that paints nothing must not wait on vsync; the port is built lazily because an open one holds the node event loop open. */
let trPump = null;
const nextFrame = () => {
  if(!trQuiet()){ requestAnimationFrame(tick); return; }
  if(!trPump){ trPump = new MessageChannel(); trPump.port1.onmessage = () => tick(performance.now()); }
  trPump.port2.postMessage(0);
};
function tick(now){
  let dt=(now-prev)/1000; prev=now; dt=Math.min(dt,.25);
  if(haltStep(now)){ setTimeout(()=>tick(performance.now()),HALT_POLL_MS); return; }
  const t0=performance.now();
  // the frame's own time, not the time the draw happens to reach fx
  fxSetFrame(now/1000);
  // a prewarm paints nothing and P is half a plant, so the frame after one is drawn whatever the rate
  if(prewarmStep()){ paintedScreen=null; nextFrame(); return; }
  const stepped=simFrame(dt);
  // the eased pan and its arrow outlast the input trail, so they ask for their own frames before the gate reads it
  navStep(dt);
  // taken unconditionally: behind `stepped` the flag would survive a whole run and be spent on the first still frame
  const want=uiTakeDirty();
  if(trQuiet() && paintedScreen===screen){ nextFrame(); return; }
  /* painting on `stepped` samples every animation at the beat between 50 Hz and the screen; a still plant has nothing to pace. */
  const due = simLive() ? paintDue(dt) : (stepped || now-lastDraw>=IDLE_MS);
  if(!due && !want && paintedScreen===screen){ nextFrame(); return; }
  lastDraw=now; paintedScreen=screen; sinceDraw=0;
  // the drawing cannot move inside a frame - see laySettle() (layout.js)
  layFresh(); laySettle(); netPassStart();
  fillRect(0,0,W,H,C.bg);
  gridDots(0,TOPBAR_H,W,H-TOPBAR_H);
  ui.widgets=[]; ui.tips=[];
  if(screen==="design") drawDesign();
  else if(screen==="operate") drawOperate();
  else if(screen==="scenario") drawScenario();
  else drawHelp();
  /* last and on its own canvas, because a panel is HTML and paints over #cv whatever this frame did. */
  if(plantScreen()) navLayerPaint();
  tipSync();
  ui.prev=ui.widgets;
  layRelease();
  paintLog.push(performance.now()-t0);
  if(paintLog.length>PAINT_WIN) paintLog.shift();
  nextFrame();
}

storeProbe();

layoutMetrics(); layout(); requestAnimationFrame(tick);

/* tools/bundle.js strips the boot line above by exact text - do not reword it; shellInit() needs layoutMetrics() run first. */
if(typeof document!=="undefined" && document.documentElement){
  shellInit();
  helpBuildDOM();
  shellSync();
  urlApply();
  setInterval(()=>{ shellSync(); urlSync(); },100);
}
