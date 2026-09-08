"use strict";
/* one delegated listener per event type: elements register handlers here, never with the DOM */

const MOUSE=(function(){
  const REG=typeof WeakMap==="function" ? new WeakMap() : null;
  const PREH=[], DOCH=[];
  /* a grab swallows the compatibility click that follows its release */
  let grab=null, spent=false;

  const TYPES={pointerdown:"down", pointermove:"move", pointerup:"up",
               pointercancel:"cancel", pointerover:"over", pointerout:"out",
               wheel:"wheel", click:"click", dblclick:"dblclick",
               contextmenu:"ctx"};

  function on(el,h){
    if(!el||!REG) return el;
    const had=REG.get(el);
    // merged, never replaced: two callers register on the same box
    if(had) Object.assign(had,h); else REG.set(el,Object.assign({},h));
    return el;
  }
  const off=el=>{ if(el&&REG) REG.delete(el); };
  const doc=h=>{ DOCH.push(h); };
  /* capture phase: a pre handler may not stop the walk, and `alive` retires it once its element leaves the document */
  const pre=(h,alive)=>{ PREH.push({h, alive, seen:false}); };

  /* a grab whose element has left the document is dropped, never carried */
  function grabbed(){
    if(grab && grab.isConnected===false){ grab=null; }
    return grab;
  }

  function call(el,h,kind,e){
    const fn=h[kind];
    if(fn) fn.call(el,e,el);
  }
  /* enter/leave off over/out: the crossing is this element's only when relatedTarget is outside it */
  function cross(el,h,kind,e){
    const other=e.relatedTarget;
    if(other && el.contains && el.contains(other)) return;
    call(el,h, kind==="over"?"enter":"leave", e);
  }

  function fire(kind,e){
    for(let i=0;i<PREH.length;i++){
      const r=PREH[i];
      if(r.alive){
        if(r.alive.isConnected) r.seen=true;
        else if(r.seen){ PREH.splice(i--,1); continue; }
      }
      call(document,r.h,kind,e);
    }
    const g=grabbed();
    /* a click is not part of the drag: it belongs to the element under it */
    if(g && (kind==="move"||kind==="up"||kind==="cancel")){
      const h=REG.get(g);
      if(h) call(g,h,kind,e);
      // only the primary button is followed by a click, so only it arms the swallow
      if(kind!=="move"){ spent = kind==="up" && e.button===0; grab=null; }
      for(const dh of DOCH) call(document,dh,kind,e);
      return;
    }
    if(kind==="click" && spent){ spent=false; return; }
    if(kind==="down") spent=false;
    for(let n=e.target; n && n.nodeType===1; n=n.parentNode){
      const h=REG.get(n); if(!h) continue;
      if(kind==="over"||kind==="out") cross(n,h,kind,e);
      call(n,h,kind,e);
      if(e.cancelBubble) return;
    }
    for(const dh of DOCH) call(document,dh,kind,e);
  }

  if(typeof document!=="undefined" && document.addEventListener)
    for(const ev in TYPES){
      const kind=TYPES[ev];
      // wheel alone is non-passive: it is the one that calls preventDefault
      document.addEventListener(ev, e=>fire(kind,e), kind==="wheel"?{passive:false}:undefined);
    }

  return {on, off, doc, pre,
    grab(el){ grab=el||null; },
    drop(){ grab=null; },
    held(){ return grabbed(); },
    /* shift is the way out to the real browser menu */
    noCtx(el){ return on(el,{ctx(e){ if(!e.shiftKey) e.preventDefault(); }}); }};
})();
