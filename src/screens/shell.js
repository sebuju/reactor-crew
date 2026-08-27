"use strict";
/* screen state, canvas sizing, HTML top bar */

let screen="design",H=790;

/* HELP is HTML now, so every screen sizes to the window the same way; the
   canvas/HTML split is one dataset write, read by style.css. */
function layout(){
  if(typeof document!=="undefined" && document.body) document.body.dataset.screen=screen;
  resize();
}

/* screens still draw into 0..H, but the canvas only covers TOPBAR_H..H - the
   HTML topbar owns the rest. resize() offsets the transform, local() undoes it. */
const TOPBAR_H=40;
const winPx=()=>(typeof innerHeight==="number"&&innerHeight>200)?innerHeight:900;

function resize(){
  const cssW=Math.max(740,(stage&&stage.clientWidth)||0), sc=cssW/W, dpr=devicePixelRatio||1;
  const stagePx=(stage&&stage.clientHeight)||(winPx()-TOPBAR_H*sc);   // pre-layout estimate
  H=Math.max(420,stagePx/sc+TOPBAR_H);
  const bodyH=H-TOPBAR_H;
  cv.style.width=cssW+"px"; cv.style.height=(bodyH*sc)+"px";
  cv.width=Math.round(W*sc*dpr); cv.height=Math.round(bodyH*sc*dpr);
  ctx.setTransform(sc*dpr,0,0,sc*dpr,0,-TOPBAR_H*sc*dpr);
  uiDirty();                       // resizing the backing store clears it
}
addEventListener("resize",resize);

let shellEls=null;

function shellInit(){
  if(typeof document==="undefined" || !document.documentElement) return;
  const tabs=[...document.querySelectorAll("#tabs .tab")];
  shellEls={
    tabs,
    plantLine:document.getElementById("plant-line"),
    clock:document.getElementById("clock"),
    dot:document.getElementById("clock-dot"),
  };
  for(const btn of tabs){
    const k=btn.dataset.screen;
    btn.addEventListener("click",()=>{
      const dis=(k==="operate"||k==="scenario")&&designBlocked();
      if(dis) return;
      /* an unchanged design keeps the plant that is already running */
      if(k==="operate"&&(!P||P.dsig!==designSig())){ commission(); return; }
      if(k==="scenario"&&!P) commission();
      /* pause on the way in, unless a run or a replay is already flying */
      if(k==="scenario"&&!scnArmed()) TR.paused=true;
      screen=k; layout();
    });
  }
  shellInitTooltip();
}

const SCNTIP_ON="Say what the reactor is FOR. Lay out a timeline of what will happen to it - load changes, battle damage, a blackout - and the limits it has to hold while they do. RUN flies it with nobody at the panel and says PASS or FAIL and which limit broke. Unlike CONTROL, opening this never rebuilds a plant that is already running.";
const OPTIP_ON="The live control room. Opening it commissions the current design. Run the plant, push it past its limits, and repair it when it bites back. Change anything on the bench and the unit is rebuilt from scratch the next time you come back here.";
const LOCKTIP="Locked until you clear the blocking issues on the design bench.";

function shellSync(){
  helpSync();
  if(!shellEls) return;
  const blocked=designBlocked();
  for(const btn of shellEls.tabs){
    const k=btn.dataset.screen, on=screen===k,
          dis=(k==="operate"||k==="scenario")&&blocked;
    btn.classList.toggle("on",on);
    btn.classList.toggle("dis",dis);
    if(k==="operate") btn.dataset.tipBody = dis?LOCKTIP:OPTIP_ON;
    else if(k==="scenario") btn.dataset.tipBody = dis?LOCKTIP:SCNTIP_ON;
  }
  const line=P?`${P.id}  ${pad(P.rated.toFixed(0),4)} MWt  ${pad((P.rated*P.eff).toFixed(0),4)} MWe`:"NO CORE COMMISSIONED";
  if(shellEls.plantLine.textContent!==line){ shellEls.plantLine.textContent=line;
    shellEls.plantLine.classList.toggle("idle",!P); }
  const t=S?S.t:0, clk="T+"+pad(t.toFixed(1),7);
  if(shellEls.clock.textContent!==clk) shellEls.clock.textContent=clk;
  shellEls.dot.style.visibility=Math.floor(performance.now()/500)%2?"visible":"hidden";
}

function shellInitTooltip(){
  const tip=document.getElementById("tip");
  if(!tip) return;
  let cur=null, curRail=null;
  const show=el=>{ cur=el; curRail=railOf(el);
    tip.innerHTML=`<b>${el.dataset.tipTitle||""}</b><p>${el.dataset.tipBody||""}</p>`;
    KIT.show(tip,true);
    const b=el.getBoundingClientRect();
    if(curRail) place(b.top+b.height/2); else placeBy(b); };
  const hide=()=>{ cur=null; curRail=null; KIT.show(tip,false); };
  document.addEventListener("pointerover",e=>{
    const el=e.target.closest("[data-tip-title]");
    if(el && el!==cur) show(el);
  });
  document.addEventListener("pointerout",e=>{
    const el=e.target.closest("[data-tip-title]");
    if(el && el===cur && !(e.relatedTarget && el.contains(e.relatedTarget))) hide();
  });
  /* PARKED CLEAR OF THE RAIL, not carried on the pointer. A panel in a rail is
     read control by control, so a box that follows the hand is a box sitting on
     top of the next control you were going to read - and the rails are where
     the hand spends the whole session. It stands just OUTSIDE whichever rail is
     on screen and only tracks the pointer vertically, which is the same
     decision drawTip() already made for the canvas.
     Measured, not a constant: the rail is a fixed CSS width today, but a
     hard-coded 340 here would be a second copy of that number in a second
     file. */
  const railOf=el=>{ const r=el.closest(".db-rail,.cr-rail,.scn-rail"); return r&&r.offsetParent?r:null; };
  const place=clientY=>{
    const gap=12, r=tip.getBoundingClientRect();
    const x=Math.max(4, curRail.getBoundingClientRect().left-gap-r.width);
    const y=Math.max(4, Math.min(clientY-r.height/2, innerHeight-r.height-4));
    tip.style.left=x+"px"; tip.style.top=y+"px";
  };
  /* A control outside any rail gets its tooltip on its OWN box - parking that one
     beside a rail it does not live in put it half a screen from what it names. */
  const placeBy=b=>{
    const gap=8, r=tip.getBoundingClientRect();
    const below=b.bottom+gap, y=below+r.height<=innerHeight-4?below:Math.max(4,b.top-gap-r.height);
    tip.style.left=Math.max(4, Math.min(b.left, innerWidth-r.width-4))+"px";
    tip.style.top=y+"px";
  };
  document.addEventListener("pointermove",e=>{ if(cur&&curRail) place(e.clientY); });
}
