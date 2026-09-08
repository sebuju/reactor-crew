"use strict";
/* the dead-man switch: an unwatched tab stops sim, paint and clock, and says so on the glass */
const HALT_IDLE_MS=15*60*1000, HALT_LINGER_MS=2000, HALT_POLL_MS=250;
const HALT_EV=["pointerdown","pointermove","pointerup","keydown","keyup","wheel","touchstart"];
let haltLast=performance.now(), haltOn=false, haltShown=0, haltBox=null;

const haltPoke=()=>{ haltLast=performance.now(); };
function haltPaint(on){
  if(!haltBox){
    haltBox=document.createElement("div");
    haltBox.id="halted"; haltBox.textContent="HALTED";
    document.body.appendChild(haltBox);
  }
  haltBox.classList.toggle("halt-on",on);
}
/* focus alone is a poke: a tab being looked at never idles out, however still the hand */
function haltStep(now){
  if(document.hasFocus()) haltLast=now;
  const idle=now-haltLast>=HALT_IDLE_MS;
  if(idle!==haltOn){
    haltOn=idle; haltShown=now; haltPaint(true);
    console.log(haltOn
      ? "HALTED  no input for "+(HALT_IDLE_MS/60000)+" min and the tab is not focused - sim and paint stopped"
      : "RESUMED  input or focus is back - sim and paint running");
  }
  // the message outlives the halt, so a plant found running says it was stopped
  if(!haltOn && haltShown && now-haltShown>=HALT_LINGER_MS){ haltShown=0; haltPaint(false); }
  return haltOn;
}
if(typeof document!=="undefined" && document.documentElement){
  for(const ev of HALT_EV) addEventListener(ev,haltPoke,{capture:true,passive:true});
  addEventListener("focus",haltPoke); addEventListener("visibilitychange",haltPoke);
}
