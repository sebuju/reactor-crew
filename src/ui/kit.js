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
  function tip(node, title, body){
    node.dataset.tipTitle = title;
    if(body != null) node.dataset.tipBody = body;
    return node;
  }

  const clampPct = t => Math.max(0, Math.min(1, t)) * 100;

  /* Bakes a fixed N-cell segmented look via mask-image rather than N child
     nodes, so a 30-cell slider track costs one element, not thirty. */
  function applyMask(node, cells){
    const pct = 100 / cells;
    const m = `repeating-linear-gradient(to right, #000 0, #000 calc(${pct}% - 1.3px), transparent calc(${pct}% - 1.3px), transparent ${pct}%)`;
    node.style.maskImage = m;
    node.style.webkitMaskImage = m;
  }

  function well(opts){
    opts = opts || {};
    const root = el("div", "kit-well");
    let head = null;
    if(opts.title){ head = rule(opts.title, opts); root.appendChild(head.el); }
    const body = el("div", "kit-well-body");
    root.appendChild(body);
    return {el: root, body, setTitle: head ? head.set : function(){}};
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
    const cells = opts.cells || 24;
    const root = el("div", "kit-seg");
    const fill = el("div", "kit-seg-fill");
    root.appendChild(fill);
    applyMask(fill, cells);
    let lastF = null, lastC = null;
    function set(frac, color){
      frac = Math.max(0, Math.min(1, frac));
      color = color || "var(--c-cyan)";
      if(frac !== lastF){ fill.style.width = (frac * 100) + "%"; lastF = frac; }
      if(color !== lastC){ fill.style.background = color; lastC = color; }
    }
    set(opts.frac || 0, opts.color);
    return {el: root, set};
  }

  function segSigned(opts){
    opts = opts || {};
    const cells = opts.cells || 28;
    const root = el("div", "kit-seg kit-seg-signed");
    applyMask(root, cells);
    const mid = el("div", "kit-seg-mid");
    const fill = el("div", "kit-seg-fill");
    root.appendChild(mid); root.appendChild(fill);
    let lastF = null, lastC = null;
    function set(frac, color){
      frac = Math.max(-1, Math.min(1, frac));
      color = color || "var(--c-cyan)";
      if(frac !== lastF){
        if(frac >= 0){ fill.style.left = "50%"; fill.style.right = "auto"; fill.style.width = (frac * 50) + "%"; }
        else { fill.style.right = "50%"; fill.style.left = "auto"; fill.style.width = (-frac * 50) + "%"; }
        lastF = frac;
      }
      if(color !== lastC){ fill.style.background = color; lastC = color; }
    }
    set(opts.frac || 0, opts.color);
    return {el: root, set};
  }

  function segMark(opts){
    opts = opts || {};
    const base = opts.signed ? segSigned(opts) : seg(opts);
    const layer = el("div", "kit-seg-marks");
    base.el.appendChild(layer);
    let marks = [];
    function set(frac, marksArr, color){
      base.set(frac, color);
      marksArr = marksArr || [];
      while(marks.length < marksArr.length){ const m = el("div", "kit-seg-markline"); layer.appendChild(m); marks.push(m); }
      while(marks.length > marksArr.length) layer.removeChild(marks.pop());
      marksArr.forEach((m, i) => {
        const pct = (opts.signed ? (m + 1) / 2 : m) * 100 + "%";
        if(marks[i].style.left !== pct) marks[i].style.left = pct;
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
  const BAND_VB_H = 15, BAND_CELLS = 40;
  function band(opts){
    opts = opts || {};
    const lo = opts.lo || 0, hi = opts.hi != null ? opts.hi : 1;
    const zones = opts.zones || [[hi, "var(--c-cyan)", ""]];
    const dp = opts.dp || 0, span = (hi - lo) || 1;
    const zoneAt = v => { const i = zones.findIndex(z => v < z[0]);
                          return i < 0 ? zones.length - 1 : i; };
    const at = v => clampPct((v - lo) / span);

    const root = el("div", "kit-band");
    const svg = svgEl("svg", "kit-band-svg");
    svg.setAttribute("viewBox", "0 0 100 " + BAND_VB_H);
    svg.setAttribute("preserveAspectRatio", "none");
    root.appendChild(svg);

    const step = 100 / BAND_CELLS, cellEls = [], cellZone = [];
    for(let i = 0; i < BAND_CELLS; i++){
      const zi = zoneAt(lo + span * (i + .5) / BAND_CELLS);
      const r = svgEl("rect", "kit-band-cell");
      r.setAttribute("x", i * step); r.setAttribute("y", 4);
      r.setAttribute("width", step * .8); r.setAttribute("height", 7);
      r.setAttribute("fill", zones[zi][1]);
      svg.appendChild(r); cellEls.push(r); cellZone.push(zi);
    }
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

    let lastZone = -1, lastV = null;
    function set(v){
      if(v === lastV) return; lastV = v;
      const x = at(v);
      needle.setAttribute("x1", x); needle.setAttribute("x2", x);
      cap.setAttribute("x1", x); cap.setAttribute("x2", x);
      const off = v < lo ? -1 : v > hi ? 1 : 0;
      peg.className = "kit-band-peg" + (off ? (off > 0 ? " hi" : " lo") : "");
      const zi = zoneAt(v);
      if(zi !== lastZone){
        cellEls.forEach((c, i) => c.classList.toggle("dim", cellZone[i] !== zi));
        lastZone = zi;
      }
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
      e.style.display = vis ? "flex" : "none";
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
      e.style.display = on ? "block" : "none";
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
      if(o.label != null && b.textContent !== o.label) b.textContent = o.label;
      if(o.on != null && o.on !== on){ on = o.on; b.classList.toggle("on", on); }
      if(o.disabled != null) b.disabled = !!o.disabled;
    }
    return {el: b, set};
  }

  /* Actual vs demand: the thumb (native range value) is the ACTUAL, the caret
     overlay is DEMAND. o.dem==null means no rate limit on this control. Uses
     a native <input type=range> for free drag/keyboard/touch handling; the
     segmented look is a mask over a plain fill div layered on top of it. */
  function slider(opts){
    opts = opts || {};
    const min = opts.min, max = opts.max, step = opts.step || ((max - min) / 1000);
    const root = el("div", "kit-slider");
    const track = el("div", "kit-slider-track");
    root.appendChild(track);
    const fill = el("div", "kit-slider-fill");
    track.appendChild(fill);
    applyMask(fill, opts.cells || 30);
    if(opts.mark != null){
      const m = el("div", "kit-slider-mark");
      m.style.left = clampPct((opts.mark - min) / (max - min)) + "%";
      track.appendChild(m);
    }
    const dem = el("div", "kit-slider-dem");
    track.appendChild(dem);
    const input = el("input", "kit-slider-input", {type: "range", min, max, step});
    track.appendChild(input);
    const readout = el("span", "kit-slider-readout");
    root.appendChild(readout);
    if(opts.tip) tip(root, opts.title || "", opts.tip);
    input.addEventListener("input", () => { if(opts.onChange) opts.onChange(parseFloat(input.value)); });
    let lastVal = null, lastDem = null;
    function set(val, demVal){
      if(val !== lastVal){
        lastVal = val;
        if(document.activeElement !== input) input.value = val;
        fill.style.width = clampPct((val - min) / (max - min)) + "%";
        if(opts.fmt) readout.textContent = opts.fmt(val);
      }
      if(demVal != null && demVal !== lastDem){
        lastDem = demVal;
        dem.style.left = clampPct((demVal - min) / (max - min)) + "%";
        dem.style.display = Math.abs(demVal - val) > 1e-9 ? "block" : "none";
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

  return {el, tip, well, rule, chip, dot, seg, segSigned, segMark, band,
    lamp, badge, hatch, button, slider, optList, segSel, sliderRow, readout, toggle};
})();
