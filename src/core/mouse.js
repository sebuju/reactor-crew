"use strict";
/* ══ EVERY MOUSE EVENT IN THE PAGE ARRIVES HERE, AND NOWHERE ELSE ══
   There were about seventy addEventListener calls for pointer, wheel, click,
   dblclick and contextmenu, spread over eleven files, and five of them called
   setPointerCapture on top. That is not a style problem. Capture RETARGETS the
   event, so two elements that both capture fight over the same hand and the
   loser silently stops seeing the drag it started; a listener on a box that
   stands OVER the canvas eats a wheel the canvas needed; and a handler added to
   a node that is later replaced leaks with it. Every one of those is a bug you
   only find by driving the thing.

   ONE LISTENER PER EVENT TYPE, ON THE DOCUMENT. Elements register HANDLERS with
   this hub instead of with the DOM, the hub walks the ancestor chain of
   e.target and calls them innermost-first, and that is the whole dispatch.

   ── WHAT IS PRESERVED, DELIBERATELY ──
   BUBBLING. The walk is the bubble, so a handler on a row and a handler on the
   rail that holds it both still fire, in that order.
   stopPropagation(). Read back off e.cancelBubble between rungs, so a call site
   that already relied on it (an ADD key inside a clickable track) keeps working.
   THE DOCUMENT IS THE LAST RUNG. MOUSE.doc() handlers run after the walk and
   are skipped by a stopPropagation, exactly as a real document listener is.

   ── WHAT REPLACES POINTER CAPTURE ──
   MOUSE.grab(el). While a grab stands, every move/up/cancel goes to that
   element's handlers whatever the pointer is over, and the grab is dropped on
   the release. Nothing is retargeted and nothing is stolen, so two drags cannot
   fight: there is one grab, and the press that took it owns the hand.

   ── AND enter/leave ARE SYNTHESISED ──
   Neither bubbles, so neither can be delegated as-is. Both are a pointerover /
   pointerout whose relatedTarget is outside the element, which is the same
   answer the DOM computes, asked per rung of the walk. */

const MOUSE=(function(){
  const REG=typeof WeakMap==="function" ? new WeakMap() : null;
  const PREH=[], DOCH=[];
  /* THE CLICK AFTER A GRAB IS THE GRAB'S, AND IT IS SPENT. Pointer capture used
     to retarget the compatibility click at the capturing element, and code
     leans on that: a scenario block dropped on a lane track reported the click
     on the BLOCK, so the track's own "click bare lane to add an event" test
     (e.target!==track) threw it away. Nothing in here has a click handler on
     the element it grabs with, so swallowing that one click is the same answer
     the retarget gave, and it does not need a forged event target. */
  let grab=null, spent=false;

  /* The one place a raw DOM event name is written down. `over`/`out` carry
     `enter`/`leave` as well - see the walk. */
  const TYPES={pointerdown:"down", pointermove:"move", pointerup:"up",
               pointercancel:"cancel", pointerover:"over", pointerout:"out",
               wheel:"wheel", click:"click", dblclick:"dblclick",
               contextmenu:"ctx"};

  function on(el,h){
    if(!el||!REG) return el;
    const had=REG.get(el);
    // merged, never replaced: ctxSuppress() and a drag both register on the
    // same box, and the second call may not take the first one's handlers off
    if(had) Object.assign(had,h); else REG.set(el,Object.assign({},h));
    return el;
  }
  const off=el=>{ if(el&&REG) REG.delete(el); };
  const doc=h=>{ DOCH.push(h); };
  /* THE CAPTURE PHASE, AND IT IS ONE LIST. A drawer key has to decide whether
     it is opening or shutting BEFORE the press reaches anything, because the
     plant is a canvas that swallows presses and a key that answered on the way
     back up shut its own menu and reopened it. Nothing here may stop the walk:
     a pre handler is a reading, and the press still belongs to whatever it
     landed on. */
  /* `alive` is the element the handler speaks for, and it is how a pre handler
     STOPS. The rails are rebuilt whenever the drawing changes and every rebuild
     mints fresh drawer keys, so a list that only ever grew was a listener leak
     with a screen's worth of dead menus in it - once the element has been in
     the document and is out of it again, the handler goes. */
  const pre=(h,alive)=>{ PREH.push({h, alive, seen:false}); };

  /* WHOEVER IS HOLDING THE HAND. A grab whose element has left the document is
     a drag whose surface was rebuilt underneath it - dropped rather than
     carried, or the next press lands on a node nothing is drawing. */
  function grabbed(){
    if(grab && grab.isConnected===false){ grab=null; }
    return grab;
  }

  function call(el,h,kind,e){
    const fn=h[kind];
    if(fn) fn.call(el,e,el);
  }
  /* enter/leave off over/out: relatedTarget is where the pointer came FROM (on
     over) or went TO (on out), so the crossing is this element's only when that
     node is outside it. `contains` answers null as false, which is the boundary
     of the window and is a real crossing. */
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
    /* A GRAB IS THE WHOLE DISPATCH for the events that make up a drag. A click
       is not one of them: a press that started a drag still ends in a click on
       whatever it is over, and that click belongs to the element under it. */
    if(g && (kind==="move"||kind==="up"||kind==="cancel")){
      const h=REG.get(g);
      if(h) call(g,h,kind,e);
      // only the primary button is followed by a click, so only it arms the
      // swallow; a right-drag that armed it would eat the next left click
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
    /* Suppressing the browser menu is a mouse handler like any other, and it is
       the same one on every box that takes a right-button gesture. Shift is the
       way out to the real menu, which is how the plant has always spelt it. */
    noCtx(el){ return on(el,{ctx(e){ if(!e.shiftKey) e.preventDefault(); }}); }};
})();
