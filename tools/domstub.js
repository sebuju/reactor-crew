function install(opts){
  opts = opts || {};
  const BOX = opts.box || {width:300, height:180};

  const draws = [];
  let nodes = 0;

  function mkctx(owner){
    const st = {font:'10px m', fillStyle:'#000', strokeStyle:'#000',
                textAlign:'left', textBaseline:'alphabetic', letterSpacing:'0px',
                lineWidth:1, globalAlpha:1};
    let tx=0, ty=0, sx=1, sy=1, rot=0; const stack=[];
    const size = () => parseFloat(st.font.match(/([\d.]+)px/)[1]);
    const sp   = () => parseFloat(st.letterSpacing) || 0;
    /* 0.60 em per glyph is a measurement of the mono stack, not a guess. */
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

  // tag, class chain, id or [data-x] only; a descendant selector matches on its LAST part
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
    return out;
  }

  const IDS = ['cv','stage','topbar','tip','ctxmenu','clock','clock-dot','plant-line',
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
  global.innerWidth = opts.winW || 1200;
  global.innerHeight = opts.winH || 900;
  global.devicePixelRatio = opts.dpr || 1;
  let wall = 1000;
  global.performance = opts.clock ? {now:()=>(wall+=17)} : {now:()=>1000};
  global.requestAnimationFrame = () => {};
  global.addEventListener = () => {};
  global.removeEventListener = () => {};
  // transport.js starts a 100 ms sync on load; a live interval would hold the process open
  global.setInterval = () => 0;
  global.clearInterval = () => {};

  return {
    mounts, draws, node,
    nodeCount: () => nodes,
    clearDraws: () => { draws.length = 0; },
    setBox: b => { BOX.width = b.width; BOX.height = b.height; },
    IDS,
  };
}

module.exports = { install };
