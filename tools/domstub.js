/* A DOM small enough to fit in one file and real enough to BUILD THE SCREENS.

   Why this exists. `headless()` in bundle.js hands the bundle a document with
   no `documentElement`, and every screen guards its own construction on exactly
   that:

       if(typeof document!=="undefined" && document.documentElement) CR=crBuild();

   So under the three auditors CR and DB are null, `crSync()`/`dbSync()` return
   on their first line, and NOT ONE LINE of the HTML rail layer has ever been
   executed by a check. That is most of the UI. Two crashes were sitting in it
   at the time this was written - a widget reading a constant that had been
   deleted, and a readout reading a field of P that does not exist - and both
   were invisible to a full green run of all three auditors.

   ── WHAT IT IS NOT ──
   Not a browser. There is no CSS, no layout, no reflow, so it cannot answer
   "does this look right" and must never be asked to. What it answers is
   narrower and is the half that was missing: does the code RUN, does it build
   its DOM once, and does a hosted canvas widget draw inside the box it was
   handed. Every box here is one this file made up, so a check written against
   it is a check about the widget's arithmetic, never about the stylesheet.

   ── EVERY CANVAS GETS ITS OWN CONTEXT ──
   hostPaint() swaps the global `ctx` for a rail widget's own, and the whole
   point of a per-host check is knowing WHICH widget drew a string. Handing out
   one shared proxy would lose that, so getContext() tags the recorder with the
   node that owns it and every draw is filed under that node. */

function install(opts){
  opts = opts || {};
  const BOX = opts.box || {width:300, height:180};

  const draws = [];            // every primitive, tagged with the canvas it hit
  let nodes = 0;

  /* ── the 2d context ──
     A recorder, not a renderer. It keeps just enough state to answer the two
     questions a check asks of a string: how big was it, and where did it land.
     translate/scale/rotate are tracked because hostPaint() sets a transform and
     drawSym() nests several more inside it. */
  function mkctx(owner){
    const st = {font:'10px m', fillStyle:'#000', strokeStyle:'#000',
                textAlign:'left', textBaseline:'alphabetic', letterSpacing:'0px',
                lineWidth:1, globalAlpha:1};
    let tx=0, ty=0, sx=1, sy=1, rot=0; const stack=[];
    const size = () => parseFloat(st.font.match(/([\d.]+)px/)[1]);
    const sp   = () => parseFloat(st.letterSpacing) || 0;
    /* 0.60 em per glyph is the same approximation audit-text.js uses. It is a
       measurement of the mono stack, not a guess, and being shared means a
       width judged here and a width judged there cannot disagree. */
    const wOf  = t => String(t).length * (0.60*size() + sp());
    const rec  = o => { o.host = owner; draws.push(o); };
    return new Proxy(st, {
      get(t,k){
        if(k in st && typeof st[k] !== 'function') return st[k];
        switch(k){
          case 'measureText':  return s => ({width: wOf(s)});
          case 'canvas':       return owner || {width:760, height:900};
          case 'save':         return () => { stack.push([tx,ty,sx,sy,rot]); };
          case 'restore':      return () => { const v=stack.pop(); if(v) [tx,ty,sx,sy,rot]=v; };
          case 'translate':    return (dx,dy) => { tx += dx*sx; ty += dy*sy; };
          case 'scale':        return (a,b) => { sx *= a; sy *= (b===undefined?a:b); };
          case 'rotate':       return r => { rot += r; };
          case 'setTransform': return (a,b,c,d,e,f) => { sx=a; sy=d; tx=e; ty=f; rot=0; };
          case 'fillText': return (s,x,y) => {
            const w = wOf(s)*sx, a = st.textAlign;
            const x0 = (a==='right' ? x*sx-w : a==='center' ? x*sx-w/2 : x*sx) + tx;
            rec({kind:'txt', t:String(s), size:size(), rot:Math.abs(rot)>1e-6,
                 x0, x1:x0+w, y:y*sy+ty});
          };
          case 'fillRect':   return (x,y,w,h) => rec({kind:'rect',
                                x0:tx+x*sx, y:ty+y*sy, x1:tx+(x+w)*sx, y1:ty+(y+h)*sy});
          case 'createLinearGradient':
          case 'createRadialGradient':
          case 'createPattern': return () => ({addColorStop(){}});
          case 'getImageData':  return () => ({data:[0,0,0,0]});
          default: return () => {};
        }
      },
      set(t,k,v){ st[k]=v; return true; }
    });
  }

  /* ── a node ──
     Listeners are really stored, so a check can click a title bar and see
     whether the selection followed. A stub that swallowed them would let a
     handler that throws pass for one that works. */
  function node(tag){
    nodes++;
    const cls = new Set();
    const n = {
      tagName: String(tag).toUpperCase(),
      children: [], parentNode: null, listeners: {},
      dataset: {}, attrs: {},
      textContent: '', hidden: false, open: true, value: 0, disabled: false,
      _box: null,
      style: new Proxy({}, {get:(t,k)=> k==='setProperty' ? ((p,v)=>{t[p]=v;}) : (t[k]||''),
                            set:(t,k,v)=>{ t[k]=v; return true; }}),
      get className(){ return [...cls].join(' '); },
      set className(v){ cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c=>cls.add(c)); },
      classList: {
        add:    (...c) => c.forEach(x=>cls.add(x)),
        remove: (...c) => c.forEach(x=>cls.delete(x)),
        contains: c => cls.has(c),
        toggle: (c,on) => { const want = on===undefined ? !cls.has(c) : !!on;
                            want ? cls.add(c) : cls.delete(c); return want; },
      },
      setAttribute(k,v){ this.attrs[k]=String(v); if(k==='class') this.className=v; },
      getAttribute(k){ return this.attrs[k]; },
      appendChild(c){ if(c.parentNode) c.parentNode.removeChild(c);
                      c.parentNode=this; this.children.push(c); return c; },
      insertBefore(c,ref){ const i=this.children.indexOf(ref);
        if(c.parentNode) c.parentNode.removeChild(c);
        c.parentNode=this; this.children.splice(i<0?this.children.length:i,0,c); return c; },
      removeChild(c){ const i=this.children.indexOf(c);
        if(i>=0){ this.children.splice(i,1); c.parentNode=null; } return c; },
      remove(){ if(this.parentNode) this.parentNode.removeChild(this); },
      append(...cs){ cs.forEach(c=>this.appendChild(c)); },
      addEventListener(k,fn){ (this.listeners[k]||(this.listeners[k]=[])).push(fn); },
      removeEventListener(k,fn){ const a=this.listeners[k]||[]; const i=a.indexOf(fn); if(i>=0) a.splice(i,1); },
      fire(k,e){ for(const fn of (this.listeners[k]||[])) fn(Object.assign({target:this,currentTarget:this,
                   preventDefault(){}, stopPropagation(){}}, e||{})); },
      scrollIntoView(){}, focus(){}, blur(){},
      setPointerCapture(){}, releasePointerCapture(){},
      getBoundingClientRect(){ const b=this._box||BOX;
        return {left:b.left||0, top:b.top||0, width:b.width, height:b.height,
                right:(b.left||0)+b.width, bottom:(b.top||0)+b.height}; },
      getContext(){ return this._ctx || (this._ctx = mkctx(this)); },
      get clientWidth(){ return (this._box||BOX).width; },
      get clientHeight(){ return (this._box||BOX).height; },
      get firstChild(){ return this.children[0] || null; },
      /* innerHTML="" is the one form the screens use, and it is a WIPE. Nothing
         here parses markup, and nothing should - a screen that needed markup
         parsed would be a screen building DOM from strings. */
      set innerHTML(v){ if(v) throw new Error('domstub: innerHTML can only be cleared, got '+JSON.stringify(String(v).slice(0,40)));
                        for(const c of this.children) c.parentNode=null;
                        this.children.length=0; },
      get innerHTML(){ return ''; },
      closest(sel){ for(let p=this; p; p=p.parentNode) if(matches(p,sel)) return p; return null; },
      matches(sel){ return matches(this,sel); },
      querySelector(sel){ return find(this,sel)[0] || null; },
      querySelectorAll(sel){ return find(this,sel); },
    };
    return n;
  }

  /* One selector grammar, and it is deliberately small: a tag, a class chain,
     an id, or `[data-x]`. Descendant combinators are matched on the LAST part
     only, which is what every selector in src/ actually needs. Anything richer
     would be a second CSS engine to keep honest. */
  function matches(n, sel){
    return String(sel).trim().split(/\s+/).filter(Boolean).every(part => {
      if(part[0] === '#') return n.attrs.id === part.slice(1);
      if(part[0] === '[') { const k=part.slice(1,-1).replace(/^data-/,'')
                                .replace(/-([a-z])/g,(m,c)=>c.toUpperCase());
                            return n.dataset[k] !== undefined; }
      const [tag, ...cs] = part.split('.');
      if(tag && n.tagName !== tag.toUpperCase()) return false;
      return cs.every(c => n.classList.contains(c));
    });
  }
  function find(root, sel){
    const last = String(sel).trim().split(/\s+/).pop(), out = [];
    (function rec(n){ for(const c of n.children){ if(matches(c,last)) out.push(c); rec(c); } })(root);
    return out;                       // an Array: NodeList.forEach is what callers use
  }

  /* Every id index.html carries that the source looks up. Missing one does not
     fail loudly - it hands back null and the screen quietly half-builds - so
     the list is asserted against the real index.html by audit-dom.js. */
  const IDS = ['cv','stage','topbar','tip','clock','clock-dot','plant-line',
               'help-doc','scr-operate','scr-design','scr-scenario'];
  const mounts = {};
  for(const id of IDS){ const n = node('div'); n.attrs.id = id; mounts[id] = n; }
  mounts.stage._box = {width:1200, height:900};

  const docEl = node('html'), body = node('body');
  body.dataset = {};

  global.document = {
    documentElement: docEl, body,
    activeElement: null,
    getElementById: id => mounts[id] || null,
    createElement: t => node(t),
    createElementNS: (ns,t) => node(t),
    createTextNode: t => { const n = node('#text'); n.textContent = String(t); return n; },
    addEventListener(){}, removeEventListener(){},
    querySelector(sel){ for(const k in mounts){ const r = find(mounts[k],sel); if(r[0]) return r[0]; } return null; },
    querySelectorAll(sel){ let out = []; for(const k in mounts) out = out.concat(find(mounts[k],sel)); return out; },
  };
  global.window = global;
  global.devicePixelRatio = opts.dpr || 1;
  let wall = 1000;
  global.performance = opts.clock ? {now:()=>(wall+=17)} : {now:()=>1000};
  global.requestAnimationFrame = () => {};
  global.addEventListener = () => {};
  global.removeEventListener = () => {};
  /* transport.js starts a 100 ms sync on load. Under a stub it would either
     never fire or fire forever and hold the process open; the auditor drives
     trSync() by hand instead, which is also the only way to say WHEN. */
  global.setInterval = () => 0;
  global.clearInterval = () => {};

  return {
    mounts, draws, node,
    nodeCount: () => nodes,
    clearDraws: () => { draws.length = 0; },
    /* the box every element reports, so a check can re-run a widget at a second
       rail width and catch one that only fits at the first */
    setBox: b => { BOX.width = b.width; BOX.height = b.height; },
    IDS,
  };
}

module.exports = { install };
