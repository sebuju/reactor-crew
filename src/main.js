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
/* WHICH SCREEN THE HELD PICTURE IS OF. A validation run holds whatever the
   canvas last painted (trQuiet(), record.js), and it may only hold a picture of
   the plant and the screen that are actually up: a link arriving already in one
   had painted nothing at all, and a commissioning entered from one left the
   machine that was replaced on the glass. Null says the canvas owes a frame, so
   one is drawn whatever the rate and the run holds that. */
let paintedScreen=null;
/* ══ AN EVEN 72 BEATS A RAGGED 144 ══
   A painted frame on the stock plant costs about 5 ms of draw and another 3 on
   the frames that also run a tick, against 6.9 ms of a 144 Hz screen - so the
   cheap frames landed on one vsync and the expensive ones on two, and the
   motion sped up and slowed down at the beat between the two. The cadence is
   measured instead: the paint takes as many vsyncs as it COSTS, the same
   number every time, and everything drawn on the clock then moves at one rate.
   HEAD is the margin - a frame that fits its slot with nothing to spare drops
   one the moment anything else lands in it. Capped at 4, because a plant that
   cannot hold 36 fps has a bigger problem than pacing.
   A HAND MOVEMENT IS NEVER PACED (want, below): the cadence owns the animation
   only, and a control that answered a click on the next slot would read as the
   input being dropped.
   IT IS PRICED OFF THE DEAR FRAMES, NOT THE AVERAGE ONE. Only one frame in
   four runs a tick at 1x, so the mean sat a hair under the budget while the
   tick frames sat a third over it - the cadence read 1, dropped every tick
   frame, and paced nothing.
   AND NOT OFF THE DEAREST ONE EITHER: a single 23 ms frame is a garbage
   collection, not a machine that cannot keep up, and a peak carrying it paced
   a 144 Hz screen down to 72 for a second at a time - measured on a machine
   painting every vsync with none dropped. The second-worst of the last
   PAINT_WIN painted frames is what has to fit: one outlier cannot move it and
   a genuinely slow plant moves it within half a second.
   AND IT DOES NOT FLAP: widening happens the moment that figure leaves the
   slot, narrowing only once it fits the next one down with room to spare, or
   the cadence alternates 1,2,1,2 and is a slower judder than the one it
   replaced. */
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
  const t0=performance.now();
  // the frame's OWN time, not the time the draw happens to reach fx - see
  // fxSetClock() (render/fx.js)
  fxSetFrame(now/1000);
  // a prewarm owns the whole frame and paints nothing - see prewarmStep()
  // (screens/shell.js). The sim cannot run either: P is half a plant.
  // ...and what stands on the canvas while it runs is the plant this one
  // REPLACES, so a validation run may not go on holding it: the frame after a
  // prewarm is drawn whatever the rate.
  if(prewarmStep()){ paintedScreen=null; nextFrame(); return; }
  const stepped=simFrame(dt);
  // the WASD walk's eased pan and its arrow both outlast the input trail, so
  // they ask for their own frames BEFORE the gate reads it (render/navarrow.js)
  navStep(dt);
  // taken unconditionally: short-circuiting behind `stepped` would leave the
  // flag set through a whole run and spend it on the first still frame after
  const want=uiTakeDirty();
  // a validation run buys its speed here: the whole frame goes to the sim and
  // the canvas holds whatever it last painted - see trQuiet() (record.js)
  if(trQuiet() && paintedScreen===screen){ nextFrame(); return; }
  /* A RUNNING PLANT OWES A FRAME ON ITS OWN CADENCE, not on its ticks: the sim
     steps at 50 Hz and no screen refreshes at 50 Hz, so painting on `stepped`
     sampled every animation at the beat between the two. A still plant keeps
     the old gate - there is nothing to pace. */
  const due = simLive() ? paintDue(dt) : (stepped || now-lastDraw>=IDLE_MS);
  if(!due && !want && paintedScreen===screen){ nextFrame(); return; }
  lastDraw=now; paintedScreen=screen; sinceDraw=0;
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
  /* THE WALK'S ARROW GOES ON LAST, OVER EVERYTHING THE PLANT VIEW HOLDS - the
     machinery, the instruments and the panels standing on the deck. It is the
     answer to a key that was just pressed, so anything drawn over it hides the
     one thing the player is looking for. Its own canvas, because a panel is
     HTML and paints over #cv whatever this frame did (navLayerPaint(),
     render/navarrow.js). Asked of the screen, because a curve outlives the
     screen it was drawn on by up to NAV_TTL and the scenario board leaves VIEW
     where the plant left it. */
  if(plantScreen()) navLayerPaint();
  tipSync();
  ui.prev=ui.widgets;
  layRelease();
  // what a painted frame costs, sim included: it is the whole of what has to
  // fit in the slot the cadence hands it
  paintLog.push(performance.now()-t0);
  if(paintLog.length>PAINT_WIN) paintLog.shift();
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
