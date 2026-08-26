"use strict";
/* Shared HTML widget kit for the three screens (control room, design bench,
   scenario bench). Canvas now draws only the plant; everything else is DOM.
   See docs/kit-api.md for the contract. Nothing here calls act() or touches
   S — every widget takes an onChange/onClick callback and the CALLER decides
   what to do with it, which is what keeps every input recordable. */

const KIT = (function(){

  function el(tag, cls, attrs){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(attrs) for(const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /* className is read-only on an SVG element - it must go through setAttribute */
  function svgEl(tag, cls){
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if(cls) e.setAttribute("class", cls);
    return e;
  }

  /* shell.js's document-wide pointerover/pointerout listener reads exactly
     these two attributes off whatever the pointer is over - no separate
     tooltip primitive is needed on the HTML side. */
  /* Guarded, because several callers re-state a tip on every sync pass rather
     than tracking whether it changed - and a dataset write is a real attribute
     write, so an unguarded one is thirty DOM mutations a second saying nothing. */
  function tip(node, title, body){
    if(node.dataset.tipTitle !== title) node.dataset.tipTitle = title;
    if(body != null && node.dataset.tipBody !== body) node.dataset.tipBody = body;
    return node;
  }

  /* ══ THE SAME GUARD tip() NEEDS, FOR TEXT AND STYLE ══
     `el.textContent = s` DESTROYS the text node and builds a new one - even when
     the string is IDENTICAL. Two separate costs, and this answers both:

       - restating a label that did not change is pure churn, and a
         build-once/sync-only-what-changed screen is not allowed to do it;
       - a label that DID change (the playhead clock, ten times a second) still
         has no business replacing a node. Writing the existing text node's
         nodeValue mutates it in place, so the element keeps one child from the
         first sync to the last.

     The first call has no text node yet and takes the textContent path, which
     makes one; every call after it edits that one. Written here rather than in
     each screen because trMarksSync had already hand-rolled the guard, and the
     second copy is the one that starts drifting. */
  function setText(node, s){
    const t = node.firstChild;
    if(t && t.nodeType === 3 && !t.nextSibling){ if(t.nodeValue !== s) t.nodeValue = s; }
    else if(node.textContent !== s) node.textContent = s;
    return node;
  }
  function setStyle(node, k, v){ if(node.style[k] !== v) node.style[k] = v; return node; }

  /* ══ VISIBILITY IS A CLASS, NEVER AN INLINE DISPLAY STRING ══
     `node.style.display = ""` does not mean "show it" - it REMOVES the inline
     override and hands the element back to the stylesheet. Every element whose
     stylesheet default was `display:none` therefore stayed hidden forever, and
     no auditor could see it because none of them loads CSS. The alarm stack and
     the MELT/TRIP banner both lived there. So the stylesheet states the SHOWN
     display for every element, this class is the only hide, and `audit-dom.js`
     bans an inline display write in the screen and renderer files outright. */
  function show(node, on){
    node.classList.toggle("kit-hide", !on);
    return node;
  }

  const clampPct = t => Math.max(0, Math.min(1, t)) * 100;

  /* ONE cell geometry for every strip in the kit - box, cell height AND cell
     count. seg()/segSigned() used to draw full-height cells in a 10-unit box
     with a well behind them while band() drew 7-unit cells floating in 15, and
     then kept 28 cells against a band's 40 - so the reactivity ledger, which is
     the one panel that shows both, looked like two different instruments at two
     different resolutions. They are the same instrument, so they are the same
     box and the same pitch. A caller that wants a coarser strip still asks. */
  const BAND_VB_H = 15, BAND_CELLS = 40;

  /* THE one segment renderer. band(), seg(), segSigned() and slider() all draw
     their cells here - real <rect>s that are lit or dimmed, never a solid fill
     and never a second implementation of the same look.

     The viewBox is 0..100 wide and stretched to the caller's box, so cell width
     is proportional while a tick's stroke stays device-crisp (the ticks carry
     vector-effect). Colour goes through style.fill, not the fill ATTRIBUTE:
     zones are written as var(--c-*) and a custom property is only reliably
     resolved in a style declaration. */
  function cellStrip(opts){
    opts = opts || {};
    const n = opts.cells || BAND_CELLS, vbH = opts.vbH || BAND_VB_H;
    const y = opts.y != null ? opts.y : 4, h = opts.h != null ? opts.h : 7;
    const svg = svgEl("svg", "kit-cells" + (opts.cls ? " " + opts.cls : ""));
    svg.setAttribute("viewBox", "0 0 100 " + vbH);
    svg.setAttribute("preserveAspectRatio", "none");
    const step = 100 / n, cells = [];
    for(let i = 0; i < n; i++){
      const r = svgEl("rect", "kit-cell");
      r.setAttribute("x", i * step); r.setAttribute("y", y);
      r.setAttribute("width", step * .8); r.setAttribute("height", h);
      svg.appendChild(r); cells.push(r);
    }
    let lastKey = null;
    /* key is whatever lit/fill actually depend on. Touching 48 rects on a frame
       that changed nothing is the entire cost of this widget, so the caller
       states when the repaint can be skipped. */
    function paint(key, lit, fill){
      if(key === lastKey) return; lastKey = key;
      cells.forEach((r, i) => {
        r.classList.toggle("dim", !lit(i));
        if(fill){ const c = fill(i) || ""; if(r._c !== c){ r.style.fill = c; r._c = c; } }
      });
    }
    return {el: svg, paint};
  }

  function well(opts){
    opts = opts || {};
    const root = el("div", "kit-well");
    let head = null;
    if(opts.title){ head = rule(opts.title, opts); head.el.classList.add("kit-rule-head");
      root.appendChild(head.el); }
    const body = el("div", "kit-well-body");
    root.appendChild(body);
    /* `head` is handed back so a caller can make the title bar do something -
       the component rails hang "select this component" off it. */
    return {el: root, body, head: head ? head.el : null,
            setTitle: head ? head.set : function(){}};
  }

  /* Scrolls a scrolling container to show one of its children. Default
     "nearest", so a node already on screen never moves under the hand; a rail
     that has just changed selection asks for "start" instead and gets the
     panel at the top, which is why the rails carry a tail of empty space.

     scrollIntoView() is deliberately NOT used. It scrolls EVERY scrollable
     ancestor, and overflow:hidden only removes the scrollbar, not the scroll -
     so the first reveal in the control room scrolled #stage itself and left
     the top of the transport strip cut off until a reload. This walks up to
     the one box that declared itself a scroller and moves only that. */
  function scroller(node){
    if(typeof getComputedStyle !== "function") return null;
    for(let p = node.parentNode; p && p.nodeType === 1; p = p.parentNode){
      const o = getComputedStyle(p).overflowY;
      if(o === "auto" || o === "scroll" || o === "overlay") return p;
    }
    return null;
  }
  function reveal(node, block){
    if(!node || !node.getBoundingClientRect) return;
    const box = scroller(node);
    if(!box) return;
    const n = node.getBoundingClientRect(), b = box.getBoundingClientRect();
    if(block === "start" || n.top < b.top) box.scrollTop += n.top - b.top;
    else if(n.bottom > b.bottom) box.scrollTop += n.bottom - b.bottom;
  }

  function rule(label, opts){
    opts = opts || {};
    const r = el("div", "kit-rule");
    const s = document.createElement("span");
    s.textContent = label;
    r.appendChild(s);
    if(opts.color) r.style.setProperty("--kit-rule-color", opts.color);
    return {el: r, set(l){ if(s.textContent !== l) s.textContent = l; }};
  }

  function chip(color){
    const e = el("span", "kit-chip");
    const set = c => { c = c || "var(--c-cyan)"; if(e.style.background !== c) e.style.background = c; };
    set(color);
    return {el: e, set};
  }

  function dot(color){
    const e = el("span", "kit-dot");
    const set = c => { c = c || "var(--c-cyan)"; if(e.style.background !== c) e.style.background = c; };
    set(color);
    return {el: e, set};
  }

  function seg(opts){
    opts = opts || {};
    const cells = opts.cells || BAND_CELLS;
    const root = el("div", "kit-seg");
    const strip = cellStrip({cells});
    root.appendChild(strip.el);
    function set(frac, color){
      frac = Math.max(0, Math.min(1, frac));
      color = color || "var(--c-cyan)";
      const lit = Math.round(frac * cells);
      strip.paint(lit + "|" + color, i => i < lit, () => color);
    }
    set(opts.frac || 0, opts.color);
    return {el: root, set, strip};
  }

  function segSigned(opts){
    opts = opts || {};
    const cells = opts.cells || BAND_CELLS, half = cells / 2;
    const root = el("div", "kit-seg kit-seg-signed");
    const strip = cellStrip({cells});
    root.appendChild(strip.el);
    // the zero rule is a tick on the strip, like every other rule the kit draws
    strip.el.appendChild(tick("kit-seg-mid", 50));
    /* the same end labels a band() carries, for the same reason: a centre-zero
       bar with no scale on it says which way but never how far. `full` is what
       either end of the strip means. */
    if(opts.full != null){
      const dp = opts.dp || 0;
      const lo = el("span", "kit-band-lo"); lo.textContent = "-" + opts.full.toFixed(dp);
      const hi = el("span", "kit-band-hi"); hi.textContent = "+" + opts.full.toFixed(dp);
      root.appendChild(lo); root.appendChild(hi);
    }
    function set(frac, color){
      frac = Math.max(-1, Math.min(1, frac));
      color = color || "var(--c-cyan)";
      // lit outward from the middle, in the direction of the sign
      const k = Math.round(Math.abs(frac) * half), up = frac >= 0;
      const lit = up ? i => i >= half && i < half + k : i => i < half && i >= half - k;
      strip.paint((up ? k : -k) + "|" + color, lit, () => color);
    }
    set(opts.frac || 0, opts.color);
    return {el: root, set, strip};
  }

  /* A mark on a seg is the SAME thing a band()'s lim tick is - the line you are
     not meant to cross - so it is the same tick, in the same red, on the same
     strip. It used to be a grey HTML rule floating over the cells, which read
     as decoration next to a band sitting in the row above it. */
  function segMark(opts){
    opts = opts || {};
    const base = opts.signed ? segSigned(opts) : seg(opts);
    const svg = base.strip.el;
    let marks = [];
    function set(frac, marksArr, color){
      base.set(frac, color);
      marksArr = marksArr || [];
      while(marks.length < marksArr.length){ const m = tick("kit-band-lim", 0); svg.appendChild(m); marks.push(m); }
      while(marks.length > marksArr.length) svg.removeChild(marks.pop());
      marksArr.forEach((m, i) => {
        const x = (opts.signed ? (m + 1) / 2 : m) * 100;
        if(marks[i]._x !== x){ marks[i].setAttribute("x1", x); marks[i].setAttribute("x2", x); marks[i]._x = x; }
      });
    }
    set(opts.frac || 0, opts.marks, opts.color);
    return {el: base.el, set};
  }

  /* One zoned scale strip (band()+bandBar() combined). Zone/lo/hi are static
     for the life of the widget - only the needle and the active zone move.

     The BAR is SVG and the LABELS are HTML on purpose. preserveAspectRatio
     "none" stretches the 100-unit x axis to whatever width the panel gives,
     which is exactly right for the cells and wrong for anything with a shape:
     the ticks survive it through vector-effect, and text would not survive it
     at all - it would be squashed, and at a size the CSS ladder never set. */
  function band(opts){
    opts = opts || {};
    const lo = opts.lo || 0, hi = opts.hi != null ? opts.hi : 1;
    const zones = opts.zones || [[hi, "var(--c-cyan)", ""]];
    const dp = opts.dp || 0, span = (hi - lo) || 1;
    const zoneAt = v => { const i = zones.findIndex(z => v < z[0]);
                          return i < 0 ? zones.length - 1 : i; };
    const at = v => clampPct((v - lo) / span);

    const root = el("div", "kit-band");
    const strip = cellStrip({cells: BAND_CELLS, cls: "kit-band-svg"});
    const svg = strip.el;
    root.appendChild(svg);

    const cellZone = [];
    for(let i = 0; i < BAND_CELLS; i++)
      cellZone.push(zoneAt(lo + span * (i + .5) / BAND_CELLS));
    const zoneFill = i => zones[cellZone[i]][1];
    if(opts.lim) for(const L of opts.lim) svg.appendChild(tick("kit-band-lim", at(L[0])));
    const needle = tick("kit-band-needle", 0);
    /* a round cap on a zero-length line is a device-pixel DOT even under the x
       stretch, because non-scaling-stroke puts the cap in device space */
    const cap = tick("kit-band-cap", 0); cap.setAttribute("y2", 0);
    svg.appendChild(needle); svg.appendChild(cap);
    /* the scale is drawn for the range the plant is STEERED in, so a scrammed
       core runs DNBR clean off the end of it. A detached pip past the end says
       the needle PEGGED rather than arrived. HTML, not SVG: its offset past the
       end has to be device pixels, which a stretched x axis cannot express. */
    const peg = el("span", "kit-band-peg");
    root.appendChild(peg);

    const loLbl = el("span", "kit-band-lo"); loLbl.textContent = lo.toFixed(dp);
    const hiLbl = el("span", "kit-band-hi"); hiLbl.textContent = hi.toFixed(dp);
    root.appendChild(loLbl); root.appendChild(hiLbl);
    zones.slice(0, -1).forEach((z, i) => {
      const lbl = el("span", "kit-band-zlabel");
      lbl.textContent = z[0].toFixed(dp);
      lbl.style.left = at(z[0]) + "%";
      lbl.style.color = zones[i + 1][1];
      root.appendChild(lbl);
    });

    let lastV = null;
    function set(v){
      if(v === lastV) return; lastV = v;
      const x = at(v);
      needle.setAttribute("x1", x); needle.setAttribute("x2", x);
      cap.setAttribute("x1", x); cap.setAttribute("x2", x);
      const off = v < lo ? -1 : v > hi ? 1 : 0;
      peg.className = "kit-band-peg" + (off ? (off > 0 ? " hi" : " lo") : "");
      // only the zone the needle is in stays lit: the scale says WHERE you are
      const zi = zoneAt(v);
      strip.paint(zi, i => cellZone[i] === zi, zoneFill);
    }
    set(opts.v != null ? opts.v : lo);
    return {el: root, set};
  }
  /* non-scaling-stroke is what lets a 1-unit line stay a crisp device-pixel
     rule under the band's non-uniform x stretch */
  function tick(cls, x){
    const l = svgEl("line", cls);
    l.setAttribute("x1", x); l.setAttribute("x2", x);
    l.setAttribute("y1", 0); l.setAttribute("y2", BAND_VB_H);
    l.setAttribute("vector-effect", "non-scaling-stroke");
    return l;
  }

  function lamp(color){
    const e = el("span", "kit-lamp");
    let on = false, col = color || "var(--c-red)";
    function set(isOn, c){
      isOn = !!isOn; c = c || col;
      if(isOn === on && c === col) return;
      on = isOn; col = c;
      e.style.background = on ? col : "var(--c-well)";
      e.classList.toggle("blink", on && col === "var(--c-red)");
    }
    set(false, col);
    return {el: e, set};
  }

  function badge(){
    const e = el("div", "kit-badge");
    e.textContent = "!";
    let vis = false, col = "var(--c-red)";
    function set(isVis, c){
      isVis = !!isVis; c = c || col;
      if(isVis === vis && c === col) return;
      vis = isVis; col = c;
      show(e, vis);
      e.style.background = col;
    }
    set(false, col);
    return {el: e, set};
  }

  function hatch(){
    const e = el("div", "kit-hatch");
    let on = false, col = "var(--c-red)";
    function set(isOn, c){
      isOn = !!isOn; c = c || col;
      if(isOn === on && c === col) return;
      on = isOn; col = c;
      show(e, on);
      e.style.setProperty("--kit-hatch-color", col);
    }
    set(false, col);
    return {el: e, set};
  }

  function button(label, opts){
    opts = opts || {};
    const b = el("button", "kit-btn", {type: "button"});
    b.textContent = label;
    if(opts.sunk) b.classList.add("kit-btn-sunk");
    if(opts.flat) b.classList.add("kit-btn-flat");
    if(opts.danger) b.classList.add("kit-btn-danger");
    if(opts.size) b.style.fontSize = "var(--t" + String(opts.size).replace(".", "-") + ")";
    if(opts.tip) tip(b, label, opts.tip);
    if(opts.onClick) b.addEventListener("click", opts.onClick);
    let on = !!opts.on;
    b.classList.toggle("on", on);
    function set(o){
      o = o || {};
      if(o.label != null) setText(b, o.label);
      if(o.on != null && o.on !== on){ on = o.on; b.classList.toggle("on", on); }
      if(o.disabled != null) b.disabled = !!o.disabled;
    }
    return {el: b, set};
  }

  /* Actual vs demand: the thumb (native range value) is the ACTUAL, the caret
     overlay is DEMAND. o.dem==null means no rate limit on this control. Uses
     a native <input type=range> for free drag/keyboard/touch handling, with the
     kit's one cellStrip() laid under it for the segmented look. */
  function slider(opts){
    opts = opts || {};
    const min = opts.min, max = opts.max, step = opts.step || ((max - min) / 1000);
    const root = el("div", "kit-slider");
    const track = el("div", "kit-slider-track");
    root.appendChild(track);
    const cells = opts.cells || 30;
    const strip = cellStrip({cells, cls: "kit-slider-cells"});
    track.appendChild(strip.el);
    if(opts.mark != null){
      const m = el("div", "kit-slider-mark");
      m.style.left = clampPct((opts.mark - min) / (max - min)) + "%";
      track.appendChild(m);
    }
    const dem = el("div", "kit-slider-dem kit-hide");
    track.appendChild(dem);
    const input = el("input", "kit-slider-input", {type: "range", min, max, step});
    track.appendChild(input);
    const readout = el("span", "kit-slider-readout");
    /* Reserve the readout at the widest string fmt can return, sampled across
       the range. Left content-driven it resizes the flexible track - and so the
       thumb - every time the value's LENGTH changes ("9%" -> "100%"). The body
       font is monospace, so ch is exact. Grows but never shrinks: some fmt
       closures label a target that changes under them, and a reservation that
       gave width back would put the jitter straight back. */
    let roCh = 0;
    function roFit(str){
      if(str.length <= roCh) return;
      roCh = str.length; readout.style.minWidth = roCh + "ch";
    }
    if(opts.readoutCh) roFit(" ".repeat(opts.readoutCh));
    else if(opts.fmt) for(let i = 0; i <= 4; i++) roFit(String(opts.fmt(min + (max - min) * i / 4)));
    root.appendChild(readout);
    if(opts.tip) tip(root, opts.title || "", opts.tip);
    input.addEventListener("input", () => { if(opts.onChange) opts.onChange(parseFloat(input.value)); });
    let lastVal = null, lastDem = null;
    function set(val, demVal){
      if(val !== lastVal){
        lastVal = val;
        if(document.activeElement !== input) input.value = val;
        // lit to the ACTUAL, like the band's scale; the amber hairline the hand
        // drags is the native thumb and the caret above it is demand
        const lit = Math.round(Math.max(0, Math.min(1, (val - min) / (max - min))) * cells);
        strip.paint(lit, i => i < lit);
        if(opts.fmt){ const str = String(opts.fmt(val)); roFit(str); readout.textContent = str; }
      }
      if(demVal != null && demVal !== lastDem){
        lastDem = demVal;
        dem.style.left = clampPct((demVal - min) / (max - min)) + "%";
        show(dem, Math.abs(demVal - val) > 1e-9);
      }
    }
    set(opts.val != null ? opts.val : min, opts.dem);
    return {el: root, set};
  }

  function optList(items, opts){
    opts = opts || {};
    const root = el("div", "kit-optlist");
    const rows = items.map((it, i) => {
      const row = el("button", "kit-optlist-row", {type: "button"});
      const mark = dot();
      row.appendChild(mark.el);
      const name = el("span", "kit-optlist-name"); name.textContent = it.name;
      row.appendChild(name);
      const mass = el("span", "kit-optlist-mass");
      row.appendChild(mass);
      if(it.tip) tip(row, it.name, it.tip);
      row.addEventListener("click", () => opts.onSelect && opts.onSelect(i));
      root.appendChild(row);
      return {row, mark, mass};
    });
    let lastSel = -1;
    function set(sel, deltas){
      if(sel !== lastSel){
        rows.forEach((r, i) => {
          const on = i === sel;
          r.row.classList.toggle("on", on);
          r.mark.set(on ? "var(--c-amber)" : "var(--c-panel-hi)");
        });
        lastSel = sel;
      }
      if(deltas) rows.forEach((r, i) => {
        const t = "+" + deltas[i].toFixed(0) + "t";
        if(r.mass.textContent !== t) r.mass.textContent = t;
        r.mass.classList.toggle("min", deltas[i] < 1);
      });
    }
    set(opts.sel != null ? opts.sel : -1, opts.deltas);
    return {el: root, set};
  }

  function segSel(labels, opts){
    opts = opts || {};
    const root = el("div", "kit-segsel");
    const cells = labels.map((L, i) => {
      const c = el("button", "kit-segsel-cell", {type: "button"});
      const name = el("span", "kit-segsel-name"); name.textContent = L;
      const mass = el("span", "kit-segsel-mass");
      c.appendChild(name); c.appendChild(mass);
      c.addEventListener("click", () => opts.onSelect && opts.onSelect(i));
      root.appendChild(c);
      return {c, mass};
    });
    let lastSel = -1;
    function set(sel, deltas){
      if(sel !== lastSel){ cells.forEach((c, i) => c.c.classList.toggle("on", i === sel)); lastSel = sel; }
      if(deltas) cells.forEach((c, i) => {
        const t = "+" + deltas[i].toFixed(0) + "t";
        if(c.mass.textContent !== t) c.mass.textContent = t;
        c.mass.classList.toggle("min", deltas[i] < 1);
      });
    }
    set(opts.sel != null ? opts.sel : -1, opts.deltas);
    return {el: root, set};
  }

  function sliderRow(opts){
    opts = opts || {};
    const root = el("div", "kit-sliderrow");
    const head = rule(opts.title);
    root.appendChild(head.el);
    if(opts.tip) tip(root, opts.title, opts.tip);
    const sl = slider(opts);
    root.appendChild(sl.el);
    const massEl = el("span", "kit-sliderrow-mass");
    if(opts.massFn) root.appendChild(massEl);
    function set(val, demVal, massDelta){
      sl.set(val, demVal);
      if(massDelta != null){
        const t = "+" + massDelta.toFixed(0) + "t";
        if(massEl.textContent !== t) massEl.textContent = t;
        massEl.classList.toggle("min", massDelta < 1);
      }
    }
    return {el: root, set, slider: sl};
  }

  function readout(opts){
    opts = opts || {};
    const root = el("div", "kit-readout");
    const head = rule(opts.title);
    root.appendChild(head.el);
    const val = el("span", "kit-readout-val");
    root.appendChild(val);
    if(opts.tip) tip(root, opts.title, opts.tip);
    let last = null;
    function set(v){ if(v !== last){ last = v; val.textContent = v; } }
    if(opts.val != null) set(opts.val);
    return {el: root, set};
  }

  function toggle(opts){
    opts = opts || {};
    const root = el("button", "kit-toggle", {type: "button"});
    const mark = el("span", "kit-toggle-mark");
    const label = el("span", "kit-toggle-label"); label.textContent = opts.label;
    root.appendChild(mark); root.appendChild(label);
    const mass = el("span", "kit-toggle-mass");
    if(opts.mass != null){ mass.textContent = "+" + opts.mass + "t"; root.appendChild(mass); }
    root.addEventListener("click", () => opts.onToggle && opts.onToggle());
    let last = null;
    function set(on){
      if(on === last) return; last = on;
      root.classList.toggle("on", on);
      if(opts.tip) tip(root, opts.label + (on ? "  [ FITTED ]" : "  [ not fitted ]"),
        opts.tip + (opts.mass != null ? "  Costs " + opts.mass + " tonnes." : ""));
    }
    if(opts.on != null) set(opts.on);
    return {el: root, set};
  }

  return {el, tip, setText, setStyle, show, well, rule, reveal, chip, dot, seg, segSigned,
    segMark, band, lamp, badge, hatch, button, slider, optList, segSel, sliderRow,
    readout, toggle};
})();
