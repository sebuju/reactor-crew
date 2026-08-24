"use strict";
/* screen state, canvas sizing, top bar */

/* ═══════════════ SCREENS ═══════════════ */
let screen="design",H=790,helpScroll=0,helpMax=0,pendH=0;
/* ── the page is the window, not the content ──
   A screen that fits the window cannot scroll, and that is the whole point. It
   Nothing here assumes a window shape. The canvas is scaled to the window's
   WIDTH, so the height it can show is whatever that scale leaves:
   H = windowHeight / (windowWidth / 760). A window twice as tall shows twice
   as many units and the plant is drawn bigger; a wide one shows fewer. What is
   fixed is that the plant is FITTED into whatever that comes to rather than
   allowed to overflow it - which is also what the plant view's own zoom is for.
   Worth knowing for the shapes people actually use: the grid alone wants 633
   units, and a 1920x1080 window leaves about 427. So on a wide screen the
   plant is drawn at roughly half size until you zoom.
   The screens that have not been converted yet still size themselves to their
   content through setPageH(), and say so here. */
const fitsWindow=()=>screen!=="help";   /* the reference screen scrolls its own text */
const winPx=()=>(typeof innerHeight==="number"&&innerHeight>200)?innerHeight:900;
/* a screen asks for its height here; the frame loop applies it after the frame */
function setPageH(v){ if(!fitsWindow() && Math.abs(H-v)>2) pendH=v; }
function applyPageH(){ if(pendH){ H=pendH; pendH=0; resize(); } }
function layout(){ H = screen==="design"?H||1400 : screen==="operate"?H||1700 : H||700; resize(); }
function resize(){
  /* clientWidth is 0 or missing before the page has laid out, and the page
     height is now DERIVED from it - so an unguarded read does not make the
     canvas the wrong size, it makes H itself NaN and nothing draws at all */
  const cssW=Math.max(740,scroller.clientWidth||0), sc=cssW/W, dpr=devicePixelRatio||1;
  if(fitsWindow()) H=Math.max(420,winPx()/sc);
  cv.style.width=cssW+"px"; cv.style.height=(H*sc)+"px";
  cv.width=Math.round(W*sc*dpr); cv.height=Math.round(H*sc*dpr);
  ctx.setTransform(sc*dpr,0,0,sc*dpr,0,0);
}
addEventListener("resize",resize);

function topbar(){
  fillRect(0,0,W,40,C.panel); fillRect(0,39,W,1,C.edge2);
  frame(12,14,12,12,C.amber); fillRect(15,17,6,6,C.amber);
  const title="REACTOR-CREW", titleF={size:10,weight:700,sp:3};
  txt(title,30,23.5,{...titleF,color:C.bright});
  const tabs=[["design","01 DESIGN"],["operate","02 CONTROL"],["help","? HELP"]];
  let x=30+tw(title,titleF)+16;
  for(const [k,label] of tabs){
    const w=tw(label,{size:8,sp:1.8,caps:1})+22, on=screen===k,
          dis=k==="operate"&&designBlocked(), isHelp=k==="help";
    /* opening the control room builds the plant; an unchanged design keeps the running one */
    const wd=push({x,y:9,w,h:23,type:"btn",fn:()=>{ if(dis) return;
      if(k==="operate"&&(!P||P.dsig!==designSig())){ commission(); return; }
      screen=k; helpScroll=0; layout(); }});
    /* no outline, on any of the three, in any state: a tab already carries an
       amber fill and amber type when it is the one you are on, and there are
       only three of them side by side - "which one is lit" is answered before
       you have read a word, so the border was a fourth cue. */
    fillRect(x,9,w,23,on?"#2a1f08":(hov(wd)&&!dis?C.panelHi:C.well));
    txt(label,x+w/2,midBase(9,23,8),{size:8,sp:1.8,caps:1,align:"center",
        color:on||isHelp?C.amber:(dis?"#2c3f45":C.ink)});
    TIP(x,9,w,23,label,
      k==="design" ? "Choose what kind of reactor to build and where to put it. Every option trades against the others inside one mass budget, and the physical arrangement matters as much as the parts list."
      : k==="operate" ? (dis?"Locked until you clear the blocking issues on the design bench.":"The live control room. Opening it commissions the current design. Run the plant, push it past its limits, and repair it when it bites back. Change anything on the bench and the unit is rebuilt from scratch the next time you come back here.")
      : "Written reference for every gauge, control and concept on this panel. Hover anything on screen for a shorter explanation.");
    x+=w+5;
  }
  const t=S?S.t:0, clk="T+"+pad(t.toFixed(1),7);
  txt(P?`${P.id}  ${pad(P.rated.toFixed(0),4)} MWt  ${pad((P.rated*P.eff).toFixed(0),4)} MWe`:"NO CORE COMMISSIONED",W-12,20,
      {size:8,sp:1,align:"right",color:P?C.cyan:C.amber});
  txt(clk,W-12,31,{size:8,sp:1,align:"right",color:C.ink2});
  if(Math.floor(performance.now()/500)%2) fillRect(W-12-tw(clk,{size:8,sp:1})-11,24,6,7,C.amber);
}
