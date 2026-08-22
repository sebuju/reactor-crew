"use strict";
/* screen state, canvas sizing, top bar */

/* ═══════════════ SCREENS ═══════════════ */
let screen="design",H=790,helpScroll=0,helpMax=0,pendH=0;
/* a screen asks for its height here; the frame loop applies it after the frame */
function setPageH(v){ if(Math.abs(H-v)>2) pendH=v; }
function applyPageH(){ if(pendH){ H=pendH; pendH=0; resize(); } }
function layout(){ H = screen==="design"?H||1400 : screen==="operate"?H||1700 : H||700; resize(); }
function resize(){
  const cssW=Math.max(740,scroller.clientWidth), sc=cssW/W, dpr=devicePixelRatio||1;
  cv.style.width=cssW+"px"; cv.style.height=(H*sc)+"px";
  cv.width=Math.round(W*sc*dpr); cv.height=Math.round(H*sc*dpr);
  ctx.setTransform(sc*dpr,0,0,sc*dpr,0,0);
}
addEventListener("resize",resize);

function topbar(){
  fillRect(0,0,W,40,C.panel); fillRect(0,39,W,1,C.edge2);
  frame(12,14,12,12,C.amber); fillRect(15,17,6,6,C.amber);
  const title="REACTOR-CREW", titleF={size:13,weight:700,sp:3};
  txt(title,30,25,{...titleF,color:C.bright});
  const tabs=[["design","01 DESIGN"],["operate","02 CONTROL"],["help","? HELP"]];
  let x=30+tw(title,titleF)+16;
  for(const [k,label] of tabs){
    const w=tw(label,{size:9,sp:1.8,caps:1})+22, on=screen===k,
          dis=k==="operate"&&designBlocked(), isHelp=k==="help";
    /* opening the control room builds the plant; an unchanged design keeps the running one */
    const wd=push({x,y:9,w,h:23,type:"btn",fn:()=>{ if(dis) return;
      if(k==="operate"&&(!P||P.dsig!==designSig())){ commission(); return; }
      screen=k; helpScroll=0; layout(); }});
    fillRect(x,9,w,23,on?"#2a1f08":(hov(wd)&&!dis?C.panelHi:C.well));
    frame(x,9,w,23,on||isHelp?C.amber:C.edge);
    txt(label,x+w/2,24,{size:9,sp:1.8,caps:1,align:"center",
        color:on||isHelp?C.amber:(dis?"#2c3f45":C.ink)});
    TIP(x,9,w,23,label,
      k==="design" ? "Choose what kind of reactor to build and where to put it. Every option trades against the others inside one mass budget, and the physical arrangement matters as much as the parts list."
      : k==="operate" ? (dis?"Locked until you clear the blocking issues on the design bench.":"The live control room. Opening it commissions the current design. Run the plant, push it past its limits, and repair it when it bites back. Change anything on the bench and the unit is rebuilt from scratch the next time you come back here.")
      : "Written reference for every gauge, control and concept on this panel. Hover anything on screen for a shorter explanation.");
    x+=w+5;
  }
  const t=S?S.t:0, clk="T+"+pad(t.toFixed(1),7);
  txt(P?`${P.id}  ${pad(P.rated,4)} MWt`:"NO CORE COMMISSIONED",W-12,20,
      {size:9,sp:1,align:"right",color:P?C.cyan:C.amber});
  txt(clk,W-12,31,{size:9,sp:1,align:"right",color:C.ink2});
  if(Math.floor(performance.now()/500)%2) fillRect(W-12-tw(clk,{size:9,sp:1})-11,24,6,7,C.amber);
}
