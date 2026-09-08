"use strict";
/* nothing here calls act() or touches S: every widget takes a callback and the caller decides */

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

  /* shell.js's hover listener reads these two attributes; guarded, since a dataset write is a real DOM write */
  function tip(node, title, body){
    if(node.dataset.tipTitle !== title) node.dataset.tipTitle = title;
    if(body != null && node.dataset.tipBody !== body) node.dataset.tipBody = body;
    return node;
  }

  /* textContent replaces the text node even for an identical string; nodeValue mutates it in place */
  function setText(node, s){
    const t = node.firstChild;
    if(t && t.nodeType === 3 && !t.nextSibling){ if(t.nodeValue !== s) t.nodeValue = s; }
    else if(node.textContent !== s) node.textContent = s;
    return node;
  }
  function setStyle(node, k, v){ if(node.style[k] !== v) node.style[k] = v; return node; }

  /* style.display="" hands the element back to the stylesheet, so hiding is a class and never inline */
  function show(node, on){
    node.classList.toggle("kit-hide", !on);
    return node;
  }

  const clampPct = t => Math.max(0, Math.min(1, t)) * 100;

  const BAND_VB_H = 15, BAND_CELLS = 40;

  /* fill goes through style, not the attribute: var(--c-*) only resolves in a style declaration */
  function cellStrip(opts){
    opts = opts || {};
    const n = opts.cells || BAND_CELLS, vbH = opts.vbH || BAND_VB_H;
    const y = opts.y != null ? opts.y : 4, h = opts.h != null ? opts.h : 7;
    const svg = svgEl("svg", "kit-cells" + (opts.cls ? " " + opts.cls : ""));
    svg.setAttribute("viewBox", "0 0 100 " + vbH);
    svg.setAttribute("preserveAspectRatio", "none");
    // butted cells still seam on a stretched viewBox; snapping to the pixel grid closes them
    if(opts.solid) svg.setAttribute("shape-rendering", "crispEdges");
    const step = 100 / n, cells = [];
    for(let i = 0; i < n; i++){
      const r = svgEl("rect", "kit-cell");
      r.setAttribute("x", i * step); r.setAttribute("y", y);
      r.setAttribute("width", step * (opts.solid ? 1 : .8)); r.setAttribute("height", h);
      svg.appendChild(r); cells.push(r);
    }
    let lastKey = null;
    /* key is whatever lit/fill depend on: touching every rect a frame is this widget's whole cost */
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
    return {el: root, body, head: head ? head.el : null,
            sfx: head ? head.sfxEl : null,
            setTitle: head ? head.set : function(){},
            setName:  head ? head.setVal : function(){},
            setSfx:   head ? head.setSfx : function(){},
            nameInput: head ? head.input : null};
  }

  /* not scrollIntoView(): it scrolls every scrollable ancestor, #stage included */
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

  /* opts.edit makes the heading itself the name field, with the label as its placeholder */
  function rule(label, opts){
    opts = opts || {};
    const r = el("div", "kit-rule");
    let s = null, box = null, sfx = null;
    if(opts.edit){
      box = textInput({bare: true, cls: "kit-rule-input", placeholder: label,
                       maxLength: opts.edit.maxLength, onChange: opts.edit.onChange});
      sfx = el("span", "kit-rule-sfx");
      r.appendChild(box.el); r.appendChild(sfx);
    } else {
      s = document.createElement("span");
      s.textContent = label;
      sfx = el("span", "kit-rule-sfx");
      r.appendChild(s); r.appendChild(sfx);
    }
    if(opts.color) r.style.setProperty("--kit-rule-color", opts.color);
    return {el: r, input: box ? box.el : null, sfxEl: sfx,
      set(l){
        if(box) box.setPlaceholder(l);
        else if(s.textContent !== l) s.textContent = l;
      },
      setSfx(t){ if(sfx && sfx.textContent !== t) sfx.textContent = t; },
      setVal(v){ if(box) box.set(v); }};
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
    const strip = cellStrip({cells, solid: opts.solid});
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
    strip.el.appendChild(tick("kit-seg-mid", 50));
    /* `full` is what either end of the strip means */
    if(opts.full != null){
      const dp = opts.dp || 0;
      const lo = el("span", "kit-band-lo"); lo.textContent = "-" + opts.full.toFixed(dp);
      const hi = el("span", "kit-band-hi"); hi.textContent = "+" + opts.full.toFixed(dp);
      root.appendChild(lo); root.appendChild(hi);
    }
    function set(frac, color){
      frac = Math.max(-1, Math.min(1, frac));
      color = color || "var(--c-cyan)";
      const k = Math.round(Math.abs(frac) * half), up = frac >= 0;
      const lit = up ? i => i >= half && i < half + k : i => i < half && i >= half - k;
      strip.paint((up ? k : -k) + "|" + color, lit, () => color);
    }
    set(opts.frac || 0, opts.color);
    return {el: root, set, strip};
  }

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

  /* the bar is SVG and the labels HTML: the stretched x axis would squash text */
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
    const marks = (opts.marks || []).map(cls => {
      const m = tick("kit-band-mark kit-band-mark-" + cls, 0);
      svg.appendChild(m); return m; });
    const needle = tick("kit-band-needle", 0);
    /* non-scaling-stroke puts the cap in device space, so a zero-length line is a dot */
    const cap = tick("kit-band-cap", 0); cap.setAttribute("y2", 0);
    svg.appendChild(needle); svg.appendChild(cap);
    /* HTML, not SVG: the peg's offset past the end has to be device pixels */
    const peg = el("span", "kit-band-peg");
    root.appendChild(peg);

    const loLbl = el("span", "kit-band-lo"); loLbl.textContent = lo.toFixed(dp);
    const hiLbl = el("span", "kit-band-hi"); hiLbl.textContent = hi.toFixed(dp);
    root.appendChild(loLbl); root.appendChild(hiLbl);
    const zlbls = zones.slice(0, -1).map((z, i) => {
      const lbl = el("span", "kit-band-zlabel");
      lbl.textContent = z[0].toFixed(dp);
      lbl.style.left = at(z[0]) + "%";
      lbl.style.color = zones[i + 1][1];
      root.appendChild(lbl);
      return {e: lbl, x: at(z[0])};
    });

    /* two close boundaries land on the same pixels, and the one further right loses */
    function fitLabels(){
      const W = root.clientWidth;
      if(!W || !root.getBoundingClientRect) return;
      const wOf = e => { show(e, true); return e.getBoundingClientRect().width; };
      const boxes = [[0, wOf(loLbl)], [W - wOf(hiLbl), W]];
      for(const z of zlbls){
        const w = wOf(z.e), c = W * z.x / 100, a = c - w / 2, b = c + w / 2;
        if(boxes.some(o => a < o[1] + 2 && o[0] < b + 2)) show(z.e, false);
        else boxes.push([a, b]);
      }
    }
    fitLabels();
    if(typeof ResizeObserver === "function") new ResizeObserver(fitLabels).observe(root);

    let lastV = null, lastM = null;
    function set(v, mv){
      if(mv) for(let i = 0; i < marks.length; i++){
        const q = mv[i];
        if(lastM && lastM[i] === q) continue;
        const mx = at(q);
        marks[i].setAttribute("x1", mx); marks[i].setAttribute("x2", mx);
      }
      lastM = mv;
      if(v === lastV) return; lastV = v;
      const x = at(v);
      needle.setAttribute("x1", x); needle.setAttribute("x2", x);
      cap.setAttribute("x1", x); cap.setAttribute("x2", x);
      const off = v < lo ? -1 : v > hi ? 1 : 0;
      peg.className = "kit-band-peg" + (off ? (off > 0 ? " hi" : " lo") : "");
      const zi = zoneAt(v);
      strip.paint(zi, i => cellZone[i] === zi, zoneFill);
    }
    set(opts.v != null ? opts.v : lo);
    return {el: root, set};
  }
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

  function icon(paths){
    const s = svgEl("svg", "kit-icon");
    s.setAttribute("viewBox", "0 0 16 16");
    for(const d of [].concat(paths)){
      const p = svgEl("path"); p.setAttribute("d", d); s.appendChild(p);
    }
    return s;
  }

  function button(label, opts){
    opts = opts || {};
    const b = el("button", "kit-btn", {type: "button"});
    if(opts.icon){ b.classList.add("kit-btn-icon"); b.appendChild(icon(opts.icon)); }
    else b.textContent = label;
    if(opts.sunk) b.classList.add("kit-btn-sunk");
    if(opts.flat) b.classList.add("kit-btn-flat");
    if(opts.danger) b.classList.add("kit-btn-danger");
    if(opts.size) b.style.fontSize = "var(--t" + String(opts.size).replace(".", "-") + ")";
    if(opts.tip) tip(b, label, opts.tip);
    if(opts.onClick) MOUSE.on(b, {click: opts.onClick});
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

  /* the thumb is the ACTUAL, the caret overlay is DEMAND */
  /* the input counts 0..N whole steps: a scale may run either way here, and a native range with min above max is invalid */
  function slider(opts){
    opts = opts || {};
    const min = opts.min, max = opts.max, span = max - min;
    const step = opts.step || (Math.abs(span) / 1000) || 1;
    const N = Math.max(1, Math.round(Math.abs(span) / step));
    const posOf = v => Math.round(clampPct(span ? (v - min) / span : 0) / 100 * N);
    const valOf = p => min + span * (p / N);
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
    const input = el("input", "kit-slider-input", {type: "range", min: 0, max: N, step: 1});
    /* where the value would land if the hand pressed here */
    const hov = el("div", "kit-slider-hov kit-hide");
    track.appendChild(hov);
    track.appendChild(input);
    const readout = el("span", "kit-slider-readout");
    /* reserved at the widest string fmt returns: content-driven, the readout's length resizes the track */
    let roCh = 0;
    function roFit(str){
      if(str.length <= roCh) return;
      roCh = str.length; readout.style.minWidth = roCh + "ch";
    }
    if(opts.readoutCh) roFit(" ".repeat(opts.readoutCh));
    else if(opts.fmt) for(let i = 0; i <= 4; i++) roFit(String(opts.fmt(min + (max - min) * i / 4)));
    root.appendChild(readout);
    if(opts.tip) tip(root, opts.title || "", opts.tip);
    input.addEventListener("input", () => { if(opts.onChange) opts.onChange(valOf(parseFloat(input.value))); });
    let lastVal = null, lastDem = null;
    const roShow = str => { roFit(str); readout.textContent = str; };
    input.addEventListener("mousemove", e => {
      const r = track.getBoundingClientRect(); if(!r.width) return;
      const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      hov.style.left = (t * 100) + "%"; show(hov, true);
      if(opts.fmt) roShow(String(opts.fmt(valOf(Math.round(t * N)))));
      readout.classList.add("hov");
    });
    input.addEventListener("mouseleave", () => {
      show(hov, false); readout.classList.remove("hov");
      if(opts.fmt && lastVal != null) roShow(String(opts.fmt(lastVal)));
    });
    function set(val, demVal){
      if(val !== lastVal){
        lastVal = val;
        if(document.activeElement !== input) input.value = posOf(val);
        const lit = Math.round(Math.max(0, Math.min(1, (val - min) / (max - min))) * cells);
        strip.paint(lit, i => i < lit);
        // a preview under the hand outranks the live figure until mouseleave
        if(opts.fmt && !readout.classList.contains("hov")) roShow(String(opts.fmt(val)));
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

  /* `bare` hands back the <input> itself, for rule()'s editable heading */
  function textInput(opts){
    opts = opts || {};
    const input = opts.multiline ? el("textarea", opts.cls || "kit-textinput-input")
                                 : el("input", opts.cls || "kit-textinput-input", {type: "text"});
    if(opts.rows) input.setAttribute("rows", opts.rows);
    if(opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
    if(opts.maxLength) input.setAttribute("maxlength", opts.maxLength);
    let root = input;
    if(!opts.bare){ root = el("div", "kit-textinput"); root.appendChild(input); }
    if(opts.tip) tip(root, opts.title || "", opts.tip);
    input.addEventListener("input", () => { if(opts.onChange) opts.onChange(input.value); });
    let last = null;
    function set(val){
      val = val || "";
      if(val !== last){ last = val; if(document.activeElement !== input) input.value = val; }
    }
    function get(){ return input.value; }
    function setPlaceholder(p){
      if(input.getAttribute("placeholder") !== p) input.setAttribute("placeholder", p);
    }
    if(opts.val != null) set(opts.val);
    return {el: root, input, set, get, setPlaceholder};
  }

  function hoverIdx(node, i, opts){
    if(!opts.onHover) return;
    MOUSE.on(node, {enter: () => opts.onHover(i), leave: () => opts.onHover(null)});
  }

  /* a latch, not a one-shot: latched, the control IS the suggestion */
  function autoKey(auto){
    const b = el("button", "kit-numinput-suggest", {type: "button"});
    b.textContent = "AUTO";
    MOUSE.on(b, {click: () => auto.set(!auto.get())});
    let was = null;
    return {el: b, set(on){ if(was === on) return; was = on; b.classList.toggle("on", on); }};
  }

  function numInput(opts){
    opts = opts || {};
    const root = el("div", "kit-numinput");
    const t = textInput({bare: true, cls: "kit-numinput-input",
                         tip: opts.tip, title: opts.title,
                         onChange: v => commit(v, false)});
    const sug = opts.auto ? autoKey(opts.auto) : null;
    if(sug) root.appendChild(sug.el);
    root.appendChild(t.el);
    if(opts.unit){ const u = el("span", "kit-numinput-unit"); u.textContent = opts.unit;
                   root.appendChild(u); }
    let live = null;
    const dp = opts.dp === undefined ? 2 : opts.dp;
    const show = v => { live = v; t.set(v == null ? "" : (+v).toFixed(dp)); };
    function commit(str, force){
      const v = parseFloat(String(str).replace(/[^0-9eE+\-.]/g, ""));
      // REVERT, never clamp: an unreadable field is not a new value
      if(!isFinite(v)){ if(force) show(live); return; }
      live = v; if(opts.onChange) opts.onChange(v);
    }
    t.input.addEventListener("blur", () => commit(t.input.value, true));
    // writes input.value itself: textInput's set() refuses to touch a focused field
    function nudge(d){
      const cur = parseFloat(String(t.input.value).replace(/[^0-9eE+\-.]/g, ""));
      const v = +((isFinite(cur) ? cur : (live || 0)) + d).toFixed(Math.max(dp, 0));
      t.input.value = v.toFixed(dp);
      commit(t.input.value, false);
    }
    t.input.addEventListener("keydown", e => {
      const d = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
      if(!d) return;
      e.preventDefault();
      nudge(d * (e.shiftKey ? 10 : 1));
    });
    if(opts.tip) tip(root, opts.title || "", opts.tip);
    if(opts.val != null) show(opts.val);
    let wasAuto = null;
    const setAuto = on => { if(wasAuto===on) return; wasAuto=on;
      if(sug) sug.set(on);
      t.input.disabled = on;
      root.classList.toggle("kit-numinput-auto", on); };
    return {el: root, set: show, get: () => live, setAuto};
  }

  function optList(items, opts){
    opts = opts || {};
    const root = el("div", "kit-optlist");
    const rows = items.map((it, i) => {
      const row = el("button", "kit-optlist-row", {type: "button"});
      if(it.cls) row.classList.add(it.cls);
      const mark = dot();
      row.appendChild(mark.el);
      const name = el("span", "kit-optlist-name"); name.textContent = it.name;
      row.appendChild(name);
      const mass = el("span", "kit-optlist-mass");
      row.appendChild(mass);
      if(it.tip) tip(row, it.name, it.tip);
      MOUSE.on(row, {click: () => opts.onSelect && opts.onSelect(i)});
      hoverIdx(row, i, opts);
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
      MOUSE.on(c, {click: () => opts.onSelect && opts.onSelect(i)});
      hoverIdx(c, i, opts);
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
    const sug = opts.auto ? autoKey(opts.auto) : null;
    if(sug) root.appendChild(sug.el);
    function set(val, demVal, massDelta){
      sl.set(val, demVal);
      if(massDelta != null){
        head.setSfx("+" + massDelta.toFixed(0) + "t");
        head.sfxEl.classList.toggle("kit-mass-min", massDelta < 1);
      }
    }
    const setAuto = on => { if(sug) sug.set(on);
      root.classList.toggle("kit-sliderrow-auto", on); };
    return {el: root, set, setAuto, slider: sl};
  }

  function readout(opts){
    opts = opts || {};
    const root = el("div", "kit-readout db-field");
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
    MOUSE.on(root, {click: () => opts.onToggle && opts.onToggle()});
    let last = null;
    function set(on){
      if(on === last) return; last = on;
      root.classList.toggle("on", on);
      if(opts.tip) tip(root, opts.label + (on ? "  [ FITTED ]" : "  [ not fitted ]"),
        opts.tip + (opts.mass != null ? " Costs " + opts.mass + " tonnes." : ""));
    }
    if(opts.on != null) set(opts.on);
    return {el: root, set};
  }

  /* opened in the hub's PRE phase: the canvas swallows presses, so a click handler would shut and reopen it */
  function menuKey(opts){
    const wrap = el("div", "kit-menukey" + (opts.cls ? " " + opts.cls : ""));
    const menu = el("div", "kit-menukey-menu kit-hide");
    const key = button(opts.label, {sunk: true});
    key.el.classList.add("kit-menukey-key");
    if(opts.tip) tip(key.el, opts.label, opts.tip);
    MOUSE.pre({down(e){
      if(menu.contains(e.target)) return;
      const open = key.el.contains(e.target) && menu.classList.contains("kit-hide");
      show(menu, open); key.set({on: open});
    }}, wrap);
    wrap.append(key.el, menu);
    return {el: wrap, key, menu};
  }

  return {el, tip, setText, setStyle, show, well, rule, reveal, chip, dot, seg, segSigned,
    segMark, band, lamp, badge, hatch, icon, button, slider, textInput, numInput, optList, segSel, sliderRow,
    readout, toggle, menuKey};
})();
