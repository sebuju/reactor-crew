"use strict";
/* FLUID BENCH - room gas + liquid only.
   PARTICLES pane: tools/particles.js on an empty board, liner walls only.
   Debug layers paint VALUES per cell through one source shape. */
(function(){
const $ = id => document.getElementById(id);
const errBox = $("fb-err");
const sayErr = m => { if(errBox) errBox.textContent += m + "\n"; };
const has = n => { try { return typeof eval(n) !== "undefined"; } catch(e){ return false; } };
const num = (v, d) => (typeof v === "number" && isFinite(v)) ? v : d;

/* ---------- live-view geometry (GX/CELL/rowTop/rowAt are live consts) ---------- */
const FB = {
  playing:true, speedIx:0, speeds:[1,4,20,Infinity],
  tool:"fluid", room:"sealed",
  hover:-1, held:false, single:false, pin:false, shot:0,
  /* parts: the bench part list PART.parts() takes; row: the particle source row a held new-kind injection drives; pins: rows left running */
  parts:[], stroke:null, row:-1, pins:[],
  panes:[], cost:{},
  /* need: the source field a layer draws from; the checkbox shows only while a pane on screen has it */
  layers:[
    {id:"h2",    lab:"H2 %",      on:false, need:"h2f"},
    {id:"h2kg",  lab:"H2 kg",     on:false, need:"h2kg"},
    {id:"o2",    lab:"O2 %",      on:false, need:"o2f"},
    {id:"air",   lab:"AIR kg",    on:false, need:"air"},
    {id:"vap",   lab:"STEAM kg",  on:false, need:"vap"},
    {id:"gas",   lab:"GAS kg",    on:false, need:"gas"},
    {id:"water", lab:"WATER",     on:true,  need:"water"},
    {id:"waterT",lab:"WATER T K", on:false, need:"waterT"},
    {id:"pool",  lab:"METAL POOL",on:false, need:"pool"},
    {id:"poolT", lab:"POOL T K",  on:false, need:"poolT"},
    {id:"cor",   lab:"CORIUM",    on:false, need:"cor"},
    {id:"corT",  lab:"CORIUM T K",on:false, need:"corT"},
    {id:"flame", lab:"FLAME",     on:false, need:"flame"},
    {id:"blast", lab:"BLAST PK",  on:false, need:"pk"},
    {id:"co",    lab:"CO %",      on:false, need:"cof"},
    {id:"co2",   lab:"CO2 %",     on:false, need:"co2f"},
    {id:"smoke", lab:"SMOKE kg",  on:false, need:"smoke"},
    {id:"dep",   lab:"DEPOSIT kg",on:false, need:"depV"},
    {id:"fp",    lab:"FP kg",     on:false, need:"fp"},
    {id:"fpn",   lab:"FP NOBLE kg",   on:false, need:"fpn"},
    {id:"fpv",   lab:"FP VOLATILE kg",on:false, need:"fpv"},
    {id:"heat",  lab:"HEAT dT K", on:false, need:"heatV"},
    {id:"cond",  lab:"CONDENSE kg",on:false, need:"condV"},
    {id:"lfill", lab:"LIQ FILL",  on:false, need:"lfill"},
    {id:"pock",  lab:"POCKET ID", on:false, need:"pocket"},
    {id:"body",  lab:"BODY ID",   on:false, need:"body"},
    {id:"door",  lab:"DOORS+JETS",on:false, need:"door"},
    {id:"wall",  lab:"WALLS",     on:false, need:"wallV"},
    {id:"part",  lab:"PARTS",     on:false, need:"partV"},
    {id:"abl",   lab:"ABLATION",  on:false, need:"ablV"},
    {id:"crust", lab:"CRUST",     on:false, need:"crustV"},
    {id:"lumps", lab:"LUMPS",     on:false, need:"lump"},
    {id:"dots",  lab:"DOTS",      on:false, need:"paint"},
  ],
  alpha:1,
};
/* three layers: BACK (background, debug layers) is the GPU paint's source, FLUID shows it bent by the heat under the fluid,
   FRONT (walls, marks, labels) stays sharp and takes the mouse; ctx2d is the one being drawn */
const cv = $("cv"), cvb = $("cvb"), cvgl = $("cvgl");
const ctxF = cv.getContext("2d"), ctxB = cvb.getContext("2d");
let ctx2d = ctxF;
const glErr = typeof PARTGL !== "undefined" ? PARTGL.init(cvgl) : "particles: tools/partgl.js missing";
if(glErr){ sayErr(glErr); cvb.style.display = "block"; }
const labH = () => 22 * (window.devicePixelRatio || 1);

/* ---------- the source: the particle mockup ---------- */
const MOCK = {part:typeof PART !== "undefined" ? PART : null};
const MOCKS = Object.values(MOCK).filter(m => m);
const srcOf = () => MOCK.part ? MOCK.part.src : null;
const costOf = S => FB.cost[S.name] || 0;
const mockEach = (what, f) => { for(const m of MOCKS){ try{ f(m); }catch(e){ sayErr(m.src.name.toLowerCase() + " " + what + ": " + (e && e.message || e)); } } };

function FB_cellWH(){
  const W = (typeof GW !== "undefined") ? GW : 60;
  const Hh = (typeof GH !== "undefined") ? GH : 34;
  return [W, Hh];
}
function FB_boardBox(){
  const [W, Hh] = FB_cellWH();
  return {x0:GX - CELL, x1:GX + (W + 1) * CELL, y0:rowTop(0) - CELL, y1:rowTop(Hh) + CELL};
}
function FB_paneView(r){
  const b = FB_boardBox(), h = r.h - labH();
  const s = Math.min(r.w / (b.x1 - b.x0), h / (b.y1 - b.y0));
  return {s, x0:b.x0 - (r.w / s - (b.x1 - b.x0)) / 2, y0:b.y0 - (h / s - (b.y1 - b.y0)) / 2};
}
function FB_fit(){
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(2, Math.round(r.width * dpr));
  cv.height = Math.max(2, Math.round(r.height * dpr));
  const cw = cv.width, ch = cv.height;
  cvb.width = cvgl.width = cw; cvb.height = cvgl.height = ch;
  /* one pane: the whole canvas draws the board largest */
  const rc = {x:0, y:0, w:cw, h:ch};
  const view = FB_paneView(rc), s = view.s, ex = rc.x - view.x0 * s, ey = rc.y + labH() - view.y0 * s;
  /* xf: the pane's board transform; box: the board and the pane in canvas pixels, as the GPU paint takes them */
  const [W, Hh] = FB_cellWH();
  const box = Float64Array.of(ex + GX * s, ey + rowTop(0) * s, W * CELL * s, (rowTop(Hh) - rowTop(0)) * s, rc.x, rc.y, rc.w, rc.h);
  FB.panes = [{src:srcOf(), rect:rc, view, xf:[s, ex, ey], box}];
}
function FB_pane(p){
  const r = p.rect, x = p.xf;
  ctx2d.save(); ctx2d.beginPath(); ctx2d.rect(r.x, r.y, r.w, r.h); ctx2d.clip();
  ctx2d.setTransform(x[0], 0, 0, x[0], x[1], x[2]);
}
/* board position of a pointer event: cell index plus fractional board coords in cells, for the particle lookup */
function FB_evPos(e){
  const r = cv.getBoundingClientRect();
  const px = (e.clientX - r.left) * (cv.width / r.width);
  const py = (e.clientY - r.top) * (cv.height / r.height);
  const p = FB.panes[0];
  if(!p) return {cell:-1, bx:NaN, by:NaN};
  const v = p.view, bx = (px - p.rect.x) / v.s + v.x0, by = (py - p.rect.y - labH()) / v.s + v.y0;
  const X = Math.floor((bx - GX) / CELL), fx = (bx - GX) / CELL;
  const [W, Hh] = FB_cellWH();
  let Y = -1, fy = NaN;
  if(typeof rowAt === "function"){
    Y = rowAt(by);
    if(Y >= 0 && Y < Hh && typeof rowTop === "function"){
      const y0 = rowTop(Y), y1 = rowTop(Y + 1);
      fy = y1 > y0 ? Y + (by - y0) / (y1 - y0) : Y;
    } else fy = Y;
  } else { Y = Math.floor((by - 100) / CELL); fy = (by - 100) / CELL; }
  if(X < 0 || Y < 0 || X >= W || Y >= Hh) return {cell:-1, bx:fx, by:fy};
  return {cell:Y * W + X, bx:fx, by:fy};
}

/* ---------- boot: empty board, liner walls, live commission for geometry, mockup built on the same walls ---------- */
function FB_walls(kind){
  FB.parts = [];
  if((kind === "cavity" || kind === "plant") && MOCK.part){ const r = PART.room(kind); FB.parts = r.parts; return r.mat; }
  const m = {};
  const rect = (x0, x1, y0, y1) => {
    for(let x = x0; x <= x1; x++){ m[x + "," + y0] = {m:"liner", t:600}; m[x + "," + y1] = {m:"liner", t:600}; }
    for(let y = y0; y <= y1; y++){ m[x0 + "," + y] = {m:"liner", t:600}; m[x1 + "," + y] = {m:"liner", t:600}; }
  };
  if(kind === "sealed") rect(15, 44, 8, 25);
  else if(kind === "holed"){ rect(15, 44, 8, 25); delete m["44,17"]; }
  else if(kind === "tworooms"){
    rect(10, 49, 6, 27);
    for(let y = 6; y <= 27; y++){ if(y >= 15 && y <= 17) continue; m["30," + y] = {m:"liner", t:600}; }
  }
  else if(kind === "bell"){
    rect(8, 51, 6, 28);
    for(let y = 8; y <= 20; y++){ m["24," + y] = {m:"liner", t:600}; m["35," + y] = {m:"liner", t:600}; }
  }
  return m;
}
function FB_boot(){
  try{
    if(typeof plantClear !== "function") throw new Error("live plantClear() missing");
    if(typeof commission !== "function") throw new Error("live commission() missing");
    plantClear();
    D.mat = FB_walls(FB.room);
    if(typeof dTouch === "function") dTouch();
    if(typeof layoutMetrics === "function") layoutMetrics();
    if(typeof buildLayout === "function") buildLayout();
    commission();
    if(has("ST") && has("SC_DICEOFF") && ST && ST.sc) ST.sc[SC_DICEOFF] = 1;
  }catch(e){ sayErr("boot: " + (e && e.message || e)); }
  FB.row = -1; FB.pins = []; FB_pins();
  mockEach("boot", m => { if(m.parts) m.parts(FB.parts); m.build(); });
  FB.cost = {};
  const st = $("fb-state");
  if(st) st.textContent = "board " + GW + "x" + GH + ", room " + FB.room;
  FB_fit();
}

/* ---------- inject: the same act onto the particle model ---------- */
function FB_rate(){
  const v = parseFloat($("fb-rate").value);
  return isFinite(v) ? v : 0;
}
const INJ = {heat:["heat", 1], h2:["h2", 1], o2:["o2", 1], steam:["steam", 1], fluid:["fluid", 1000],
             rmheat:["heat", -1], rmgas:["gas", -1], rmliq:["fluid", -1000]};
/* the particle-only sources and the figures each reads, [key, label, default, factor into the row's own unit] */
const FIG = {
  break: [["p", "circuit MPa", 7, 1], ["h", "h kJ/kg (blank: saturated)", "", 1], ["fpN", "noble FP kg/s", 0, 1], ["fpV", "volatile FP kg/s", 0, 1]],
  metal: [["T", "T K", 800, 1], ["dp", "jet dp kPa", 200, 1000], ["bore", "bore mm", 20, 0.001]],
  corium:[["T", "T K", 2800, 1], ["F", "fuel share", 0.6, 1], ["K", "can share", 0.2, 1], ["Z", "Zr metal share (of the can)", 0.12, 1], ["S", "steel share", 0.2, 1],
          ["X", "slag share", 0, 1], ["dw", "decay W/kg at rated", 150, 1], ["pv", "vessel MPa", 0.1, 1], ["tot", "total t", 20, 1000]],
  co:    [["T", "T K", 600, 1]],
  co2:   [["T", "T K", 600, 1]],
  fp:    [["fpN", "noble FP kg/s", 0.01, 1], ["fpV", "volatile FP kg/s", 0.01, 1]],
};
const COMP = ["F", "K", "Z", "S", "X"];
function FB_row(cell){
  const q = {kind:FB.tool, rate:FB_rate(), cell}, comp = {};
  for(const [k, , , f] of FIG[FB.tool]){ const e = $("fb-fig-" + k), v = e ? parseFloat(e.value) : NaN;
    if(!isFinite(v)) continue; if(COMP.includes(k)) comp[k] = v; else q[k] = v*f; }
  if(FB.tool === "corium") q.comp = comp;
  return q;
}
/* the figure fields of the tool in hand; a figure keeps what was typed while the tool is put down */
const FIGV = {};
function FB_figs(){
  const box = $("fb-figs"); if(!box) return;
  box.textContent = "";
  const rows = FIG[FB.tool]; box.classList.toggle("fb-hide", !rows);
  if(!rows) return;
  const v = FIGV[FB.tool] || (FIGV[FB.tool] = {});
  for(const [k, lab, def] of rows){ const r = document.createElement("div"), l = document.createElement("label"), i = document.createElement("input");
    r.className = "fb-row"; i.type = "number"; i.step = "any"; i.id = "fb-fig-" + k; i.value = k in v ? v[k] : def;
    i.oninput = () => { v[k] = i.value; }; l.append(document.createTextNode(lab + " "), i); r.appendChild(l); box.appendChild(r); }
  if(FB.tool === "metal") box.appendChild(Object.assign(document.createElement("div"), {className:"fb-note", textContent:"sodium: the one metal with a FIRE row (" + FIRE_KEYS[0] + "); its density and cp are its coolant row's"}));
}
/* PAINT: a stroke is one part; CONCRETE paints lined concrete walls into D.mat, which the particles read at once and the live pane at RESET */
const PAINT = {machine:"machine", pan:"pan", ventout:"vent", ventin:"vent", inert:"inert", catcher:"catcher"};
function FB_paint(cell){
  if(!MOCK.part || cell < 0) return;
  if(FB.tool === "conc"){ const W = FB_cellWH()[0], t = parseFloat($("fb-conc").value);
    D.mat[(cell % W) + "," + ((cell / W) | 0)] = {m:"lined", t:isFinite(t) && t > 0 ? t : 1000}; FB.stroke = FB.stroke || {conc:true}; return; }
  if(!FB.stroke){ const T = parseFloat($("fb-partT").value);
    FB.stroke = {kind:PAINT[FB.tool], cells:[], dir:FB.tool === "ventin" ? "in" : "out", T:isFinite(T) ? T : 600}; FB.parts.push(FB.stroke); }
  if(!FB.stroke.cells.includes(cell)) FB.stroke.cells.push(cell);
}
function FB_strokeEnd(){
  if(!FB.stroke) return;
  const c = FB.stroke.conc; FB.stroke = null;
  if(c && typeof dTouch === "function") dTouch();
  mockEach("parts", m => c ? m.geom() : m.parts(FB.parts));
}
function FB_pins(){
  const box = $("fb-pins"); if(!box) return;
  box.textContent = "";
  for(const r of FB.pins){ const row = document.createElement("div"), b = document.createElement("button"), q = MOCK.part ? PART.src.row(r.id) : null;
    row.className = "fb-row"; b.textContent = "X";
    b.onclick = () => { mockEach("drop", m => m.src.drop(r.id)); FB.pins = FB.pins.filter(x => x !== r); FB_pins(); };
    row.append(b, document.createTextNode(" " + r.label + (q ? "" : " (ended)"))); box.appendChild(row); }
}
function FB_apply(cell){
  if(cell < 0) return;
  if(PAINT[FB.tool] || FB.tool === "conc"){ FB_paint(cell); return; }
  if(FIG[FB.tool] || (FB.pin && INJ[FB.tool])){
    if(!MOCK.part) return;
    const q = FIG[FB.tool] ? FB_row(cell) : {kind:INJ[FB.tool] ? INJ[FB.tool][0] : FB.tool, rate:INJ[FB.tool] ? FB_rate()*INJ[FB.tool][1] : 0, cell};
    if(FB.pin){ const id = PART.src.add(q); if(id >= 0){ FB.pins.push({id, label:q.kind + " " + q.rate + " at " + cell}); FB_pins(); } return; }
    if(FB.row >= 0) PART.src.move(FB.row, cell); else FB.row = PART.src.add(q);
    return;
  }
  if(FB.tool === "blast"){
    const kPa = parseFloat($("fb-blast").value);
    if(!(isFinite(kPa) && kPa > 0)) return;
    mockEach("blast", m => m.blast(cell, kPa));
    return;
  }
  const row = INJ[FB.tool];
  if(!row) return;
  const r = FB_rate(), rate = row[1] < 0 ? -Math.abs(r) * -row[1] : r * row[1];
  mockEach("inject", m => m.inject(row[0], rate, cell));
}
function FB_release(){
  mockEach("off", m => m.off());
  if(FB.row >= 0 && MOCK.part){ PART.src.drop(FB.row); FB.row = -1; }
}

/* ---------- debug layers: one source, live thresholds, values per cell ---------- */
function FB_live(n, d){ try{ const v = eval(n); return (v === undefined) ? d : v; }catch(e){ return d; } }
function FB_layerOn(id){ const l = FB.layers.find(q => q.id === id); return !!(l && l.on); }

function FB_drawBoard(S, v){
  const [W, Hh] = FB_cellWH();
  const H2LFL = FB_live("H2_LFL", 0.04), O2LOC = FB_live("O2_LOC", 0.05);
  const VCELL = FB_live("ROOM_VCELL", 0.1);
  const HEATZ = FB_live("HEATZ", null), BLASTZ = FB_live("BLASTZ", null);
  const heatIx = (typeof heatOf === "function") ? heatOf : (t => t < 310 ? 0 : t < 340 ? 1 : t < 400 ? 2 : t < 600 ? 3 : 4);
  const blastIx = (typeof blastOf === "function") ? blastOf
    : (p => { if(!BLASTZ) return 0; for(let k = 0; k < BLASTZ.length; k++) if(p < BLASTZ[k].t) return k; return BLASTZ.length - 1; });
  const cellPx = CELL * v.s / (window.devicePixelRatio || 1);
  const showVal = cellPx > 24;
  const ready = S && S.ok();

  for(let Y = 0; Y < Hh; Y++){
    const y = rowTop(Y), h = rowTop(Y + 1) - y;
    for(let X = 0; X < W; X++){
      const i = Y * W + X, x = GX + X * CELL;
      ctx2d.strokeStyle = "rgba(95,210,226,.10)";
      ctx2d.lineWidth = Math.max(1, CELL * 0.008);
      ctx2d.strokeRect(x, y, CELL, h);
      if(!ready) continue;
      if(FB_layerOn("h2") && S.h2f){
        const f = S.h2f(i);
        if(f > 0.0005){
          ctx2d.globalAlpha = Math.min(0.5, 0.08 + 0.4 * (f / H2LFL));
          ctx2d.fillStyle = "#a48ad6"; ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1;
        }
        if(f >= H2LFL){ ctx2d.strokeStyle = "#a48ad6"; ctx2d.lineWidth = Math.max(2, CELL * 0.03);
          ctx2d.strokeRect(x + 3, y + 3, CELL - 6, h - 6); }
        if(showVal && f >= 0.0005){ ctx2d.fillStyle = f >= H2LFL ? "#a48ad6" : "#5d7378";
          ctx2d.font = "26px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText((f * 100).toFixed(f < 0.01 ? 2 : 1), x + CELL / 2, y + h / 2 + 9); }
      }
      if(FB_layerOn("o2") && S.o2f){
        const f = S.o2f(i);
        if(showVal){ ctx2d.fillStyle = f < O2LOC ? "#5aa9d6" : "#5d7378";
          ctx2d.font = "26px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText((f * 100).toFixed(1), x + CELL / 2, y + h / 2 + 9); }
        if(f < O2LOC){ ctx2d.globalAlpha = 0.35; ctx2d.fillStyle = "#5aa9d6";
          ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1; }
      }
      if(FB_layerOn("vap") && showVal){
        const m = num(S.vap(i), 0);
        if(m > 1e-6){ ctx2d.fillStyle = "#9fb4b9"; ctx2d.font = "24px monospace";
          ctx2d.textAlign = "center"; ctx2d.fillText(m.toFixed(2), x + CELL / 2, y + h / 2 + 8); }
      }
      if(FB_layerOn("gas") && showVal){
        ctx2d.fillStyle = "#5d7378"; ctx2d.font = "24px monospace"; ctx2d.textAlign = "center";
        ctx2d.fillText(num(S.gas(i), 0).toFixed(2), x + CELL / 2, y + h - 34);
      }
      if(FB_layerOn("water") && !S.paint){
        const m = num(S.water(i), 0);
        if(m >= 0.01){
          const f = Math.min(1, m / (1000 * VCELL));
          ctx2d.globalAlpha = 0.55; ctx2d.fillStyle = "#5aa9d6";
          ctx2d.fillRect(x, y + h * (1 - f), CELL, h * f); ctx2d.globalAlpha = 1;
          if(showVal){ ctx2d.fillStyle = "#dff0f3"; ctx2d.font = "24px monospace";
            ctx2d.textAlign = "center";
            const wt = S.waterT ? num(S.waterT(i), NaN) : NaN;
            ctx2d.fillText(m.toFixed(1) + (isFinite(wt) ? " " + wt.toFixed(0) + "K" : ""), x + CELL / 2, y + h - 8); }
        }
      }
      if(FB_layerOn("pool") && S.pool){
        const m = num(S.pool(i), 0);
        if(m >= 0.01){
          const lit = S.poolLit ? S.poolLit(i) : false;
          ctx2d.globalAlpha = 0.6; ctx2d.fillStyle = lit ? "#f0a830" : "#6d8f98";
          ctx2d.fillRect(x, y + h * 0.5, CELL, h * 0.5); ctx2d.globalAlpha = 1;
          if(showVal){ ctx2d.fillStyle = lit ? "#f0a830" : "#dff0f3";
            ctx2d.font = "24px monospace"; ctx2d.textAlign = "center";
            ctx2d.fillText(m.toFixed(1) + (S.poolT ? " " + S.poolT(i).toFixed(0) + "K" : ""), x + CELL / 2, y + 30); }
        }
      }
      if(FB_layerOn("cor") && S.cor){
        const m = num(S.cor(i), 0);
        if(m >= 1){
          ctx2d.globalAlpha = 0.6; ctx2d.fillStyle = "#ff7a2a";
          ctx2d.fillRect(x, y + h * 0.4, CELL, h * 0.6); ctx2d.globalAlpha = 1;
          if(showVal){ ctx2d.fillStyle = "#ffd27a"; ctx2d.font = "24px monospace";
            ctx2d.textAlign = "center";
            ctx2d.fillText((m / 1000).toFixed(2) + "t" + (S.corT ? " " + S.corT(i).toFixed(0) + "K" : ""), x + CELL / 2, y + 30); }
        }
      }
      if(FB_layerOn("flame") && S.flame(i)){
        ctx2d.globalAlpha = 0.75; ctx2d.fillStyle = "#ffd27a";
        ctx2d.fillRect(x + CELL * 0.2, y + h * 0.2, CELL * 0.6, h * 0.6); ctx2d.globalAlpha = 1;
      }
      if(FB_layerOn("blast")){
        const p = num(S.pk(i), 0);
        if(p >= 5){
          const z = (BLASTZ && BLASTZ[blastIx(p)]) || {col:"#ff5a45", a:0.3};
          ctx2d.globalAlpha = 0.35; ctx2d.fillStyle = z.col;
          ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1;
        }
        if(showVal && p >= 0.5){ ctx2d.fillStyle = p >= 15 ? "#ff5a45" : "#5d7378";
          ctx2d.font = "24px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText(p.toFixed(0), x + CELL / 2, y + 30); }
      }
      if(FB_layerOn("smoke") && S.smoke && showVal){ const m = num(S.smoke(i), 0);
        if(m >= 0.001){ ctx2d.fillStyle = "#dff0f3"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center"; ctx2d.fillText(m.toFixed(2), x + CELL / 2, y + 26); } }
      if(FB_layerOn("fp") && S.fp && showVal){ const m = num(S.fp(i), 0);
        if(m >= 1e-6){ ctx2d.fillStyle = "#57d38c"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center"; ctx2d.fillText(m.toExponential(1), x + CELL / 2, y + h - 30); } }
      if(FB_layerOn("co") && S.cof && showVal){
        const a = S.cof(i) * 100;
        if(a >= 0.05){ ctx2d.fillStyle = "#9fb4b9";
          ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText(a.toFixed(1), x + CELL / 2, y + h / 2 + 8); }
      }
      if(FB_layerOn("co2") && S.co2f && showVal){
        const b = S.co2f(i) * 100;
        if(b >= 0.05){ ctx2d.fillStyle = "#7fa8b9";
          ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText(b.toFixed(1), x + CELL / 2, y + h / 2 + 8); }
      }
      if(FB_layerOn("h2kg") && S.h2kg && showVal){ const m = num(S.h2kg(i), 0);
        if(m >= 0.001){ ctx2d.fillStyle = "#a48ad6"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center"; ctx2d.fillText(m.toFixed(2), x + CELL / 2, y + h - 8); } }
      if(FB_layerOn("air") && S.air && showVal){ const m = num(S.air(i), 0);
        if(m >= 0.01){ ctx2d.fillStyle = "#5d7378"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center"; ctx2d.fillText(m.toFixed(2), x + CELL / 2, y + h / 2 + 8); } }
      if(FB_layerOn("waterT") && S.waterT && showVal){ const m = S.water ? num(S.water(i), 0) : 0;
        if(m > 0){ const t = num(S.waterT(i), NaN);
          if(isFinite(t)){ const z = (HEATZ && HEATZ[heatIx(t)]) || {col:"#5aa9d6"};
            ctx2d.globalAlpha = 0.25; ctx2d.fillStyle = z.col; ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1;
            ctx2d.fillStyle = "#dff0f3"; ctx2d.font = "24px monospace"; ctx2d.textAlign = "center";
            ctx2d.fillText(t.toFixed(0), x + CELL / 2, y + h / 2 + 8); } } }
      if(FB_layerOn("poolT") && S.poolT && showVal){ const m = S.pool ? num(S.pool(i), 0) : 0;
        if(m >= 0.01){ const t = num(S.poolT(i), NaN);
          if(isFinite(t)){ ctx2d.fillStyle = "#f0a830"; ctx2d.font = "24px monospace"; ctx2d.textAlign = "center";
            ctx2d.fillText(t.toFixed(0), x + CELL / 2, y + 30); } } }
      if(FB_layerOn("corT") && S.corT && showVal){ const m = S.cor ? num(S.cor(i), 0) : 0;
        if(m >= 1){ const t = num(S.corT(i), NaN);
          if(isFinite(t)){ ctx2d.fillStyle = "#ffd27a"; ctx2d.font = "24px monospace"; ctx2d.textAlign = "center";
            ctx2d.fillText(t.toFixed(0), x + CELL / 2, y + 30); } } }
      if(FB_layerOn("dep") && S.depV && showVal){ const m = num(S.depV(i), 0);
        if(m >= 0.001){ ctx2d.fillStyle = "#8a9aa0"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center"; ctx2d.fillText(m.toFixed(2), x + CELL / 2, y + h - 8); } }
      if(FB_layerOn("fpn") && S.fpn && showVal){ const m = num(S.fpn(i), 0);
        if(m >= 1e-9){ ctx2d.fillStyle = "#57d38c"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center"; ctx2d.fillText(m.toExponential(1), x + CELL / 2, y + 26); } }
      if(FB_layerOn("fpv") && S.fpv && showVal){ const m = num(S.fpv(i), 0);
        if(m >= 1e-9){ ctx2d.fillStyle = "#7fe0a8"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center"; ctx2d.fillText(m.toExponential(1), x + CELL / 2, y + h - 30); } }
      if(FB_layerOn("heat") && S.heatV){
        const d = num(S.heatV(i), 0);
        if(d > 0.5){ ctx2d.globalAlpha = Math.min(0.5, 0.1 + 0.4 * (d / 50)); ctx2d.fillStyle = "#ff9a3c";
          ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1; }
        if(showVal && d > 0.5){ ctx2d.fillStyle = "#ff9a3c"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText("+" + d.toFixed(1), x + CELL / 2, y + h / 2 + 8); }
      }
      if(FB_layerOn("cond") && S.condV && showVal){ const m = num(S.condV(i), 0);
        if(m >= 0.01){ ctx2d.fillStyle = "#5fd2e2"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center"; ctx2d.fillText(m.toFixed(2), x + CELL / 2, y + h - 8); } }
      if(FB_layerOn("lfill") && S.lfill){
        const f = num(S.lfill(i), 0);
        if(f > 0.01){
          ctx2d.globalAlpha = 0.45; ctx2d.fillStyle = "#5aa9d6";
          ctx2d.fillRect(x, y + h * (1 - Math.min(1, f)), CELL, h * Math.min(1, f)); ctx2d.globalAlpha = 1;
          if(showVal){ ctx2d.fillStyle = "#dff0f3"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
            ctx2d.fillText((f * 100).toFixed(0), x + CELL / 2, y + h / 2 + 8); }
        }
      }
      if(FB_layerOn("pock") && S.pocket){
        const k = S.pocket(i);
        if(k >= 0){ ctx2d.globalAlpha = 0.35; ctx2d.fillStyle = "hsl(" + ((k * 47) % 360) + " 60% 40%)";
          ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1; }
        if(showVal && !S.door(i)){ ctx2d.fillStyle = k >= 0 ? "#dff0f3" : "#3a4a4e"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText(k >= 0 ? String(k) : "B" + num(S.body(i), -1), x + CELL / 2, y + h / 2 + 8); }
      }
      if(FB_layerOn("body") && S.body && showVal){ const b = num(S.body(i), -1);
        if(b >= 0){ ctx2d.fillStyle = "#c9a0f0"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText("B" + b, x + CELL / 2, y + h / 2 + 8); } }
      if(FB_layerOn("door") && S.door){
        if(S.door(i)){ ctx2d.globalAlpha = 0.5; ctx2d.fillStyle = "#5fd2e2";
          ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1;
          if(showVal && S.jetV){ const j = num(S.jetV(i), 0);
            if(j > 0.05){ ctx2d.fillStyle = "#dff0f3"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
              ctx2d.fillText(j.toFixed(1), x + CELL / 2, y + h / 2 + 8); } } }
      }
      if(FB_layerOn("wall") && S.wallV){
        const wv = S.wallV(i);
        if(wv > 0){ ctx2d.globalAlpha = 0.85; ctx2d.fillStyle = wv === 2 ? "#33525b" : "#3a3f45";
          ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1;
          if(showVal){ let s = wv === 2 ? "G" : "W";
            try{ if(S.concV && S.concV(i) > 0) s += " " + (S.concV(i) * 1000).toFixed(0); }catch(e){}
            ctx2d.fillStyle = "#9fb4b9"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
            ctx2d.fillText(s, x + CELL / 2, y + h / 2 + 8); } }
      }
      if(FB_layerOn("part") && S.partV){
        const pv = S.partV(i);
        if(pv > 0){ const cols = ["", "#4a5a62", "#f0a830", "#5fd2e2", "#57d38c", "#ff5a45"], nms = ["", "MCH", "PAN", "VNT", "INRT", "CTCH"];
          ctx2d.globalAlpha = 0.6; ctx2d.fillStyle = cols[pv] || "#9fb4b9";
          ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1;
          if(showVal){ ctx2d.fillStyle = "#040708"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
            ctx2d.fillText(nms[pv] || ("P" + pv), x + CELL / 2, y + h / 2 + 8); } }
      }
      if(FB_layerOn("abl") && S.ablV){
        const a = num(S.ablV(i), 0);
        if(a > 1e-6){ ctx2d.globalAlpha = Math.min(0.6, 0.1 + 0.5 * (a / 0.2)); ctx2d.fillStyle = "#a06a3c";
          ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1;
          if(showVal){ ctx2d.fillStyle = "#ffd27a"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
            ctx2d.fillText((a * 1000).toFixed(1), x + CELL / 2, y + h / 2 + 8); } }
      }
      if(FB_layerOn("crust") && S.crustV && showVal){ const c = num(S.crustV(i), 0);
        if(c > 1e-6){ ctx2d.fillStyle = "#6d6a65"; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText((c * 1000).toFixed(1), x + CELL / 2, y + h / 2 + 8); } }
    }
  }
}
function FB_drawFront(S){
  const [W, Hh] = FB_cellWH(), ready = S && S.ok();
  try{
    if(D && D.mat){
      for(const k in D.mat){
        const j = k.indexOf(","), X = +k.slice(0, j), Y = +k.slice(j + 1);
        if(!(X >= 0 && Y >= 0 && X < W && Y < Hh)) continue;
        let tight = true;
        try{ if(typeof matWall === "function") tight = !!matWall(X, Y); }catch(e){}
        ctx2d.globalAlpha = 0.85; ctx2d.fillStyle = tight ? "#33525b" : "#3a3f45";
        ctx2d.fillRect(GX + X * CELL, rowTop(Y), CELL, rowTop(Y + 1) - rowTop(Y));
        ctx2d.globalAlpha = 1;
      }
    }
  }catch(e){}
  /* the bench parts: machine blocks filled, the rest outlined in their own colour and named */
  const PCOL = {machine:"#4a5a62", pan:"#f0a830", vent:"#5fd2e2", inert:"#57d38c", catcher:"#ff5a45"};
  for(const p of FB.parts){ const col = PCOL[p.kind] || "#9fb4b9";
    for(const i of p.cells){ const X = i % W, Y = (i / W) | 0, x = GX + X * CELL, y = rowTop(Y), h = rowTop(Y + 1) - y;
      if(p.kind === "machine"){ ctx2d.globalAlpha = 0.8; ctx2d.fillStyle = col; ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1; continue; }
      ctx2d.strokeStyle = col; ctx2d.lineWidth = Math.max(2, CELL * 0.03); ctx2d.strokeRect(x + 4, y + 4, CELL - 8, h - 8);
      ctx2d.fillStyle = col; ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
      ctx2d.fillText(p.kind === "vent" ? "V " + p.dir.toUpperCase() : p.kind.slice(0, 3).toUpperCase(), x + CELL / 2, y + h / 2 + 8); } }
  /* LUMPS: volume borders and door cells, where the source has volumes */
  if(ready && S.lump && FB_layerOn("lumps")){
    ctx2d.strokeStyle = "#f0a830"; ctx2d.lineWidth = Math.max(2, CELL * 0.04);
    ctx2d.beginPath();
    for(let Y = 0; Y < Hh; Y++) for(let X = 0; X < W; X++){
      const i = Y * W + X, a = S.lump(i);
      if(a < 0 || S.door(i)) continue;
      const x = GX + X * CELL, y = rowTop(Y), y1 = rowTop(Y + 1);
      if(X < W - 1){ const b = S.lump(i + 1); if(b >= 0 && b !== a && !S.door(i + 1)){ ctx2d.moveTo(x + CELL, y); ctx2d.lineTo(x + CELL, y1); } }
      if(Y < Hh - 1){ const b = S.lump(i + W); if(b >= 0 && b !== a && !S.door(i + W)){ ctx2d.moveTo(x, y1); ctx2d.lineTo(x + CELL, y1); } }
    }
    ctx2d.stroke();
    ctx2d.strokeStyle = "#5fd2e2"; ctx2d.lineWidth = Math.max(2, CELL * 0.03);
    for(let i = 0; i < W * Hh; i++) if(S.door(i)){
      const X = i % W, Y = (i / W) | 0, x = GX + X * CELL, y = rowTop(Y), h = rowTop(Y + 1) - y;
      ctx2d.setLineDash([CELL * 0.12, CELL * 0.08]); ctx2d.strokeRect(x + 6, y + 6, CELL - 12, h - 12); ctx2d.setLineDash([]);
    }
  }
  if(FB.hover >= 0){
    const X = FB.hover % W, Y = (FB.hover / W) | 0;
    ctx2d.strokeStyle = "#f0a830"; ctx2d.lineWidth = Math.max(2, CELL * 0.02);
    ctx2d.strokeRect(GX + X * CELL + 2, rowTop(Y) + 2, CELL - 4, rowTop(Y + 1) - rowTop(Y) - 4);
  }
}
function FB_draw(){
  ctx2d = ctxB;
  ctx2d.setTransform(1, 0, 0, 1, 0, 0);
  ctx2d.fillStyle = "#040708";
  ctx2d.fillRect(0, 0, cv.width, cv.height);
  for(const p of FB.panes){ FB_pane(p); FB_drawBoard(p.src, p.view); ctx2d.restore(); }
  ctx2d = ctxF;
  ctx2d.setTransform(1, 0, 0, 1, 0, 0);
  ctx2d.clearRect(0, 0, cv.width, cv.height);
  let gp = null;
  for(const p of FB.panes){
    FB_pane(p); FB_drawFront(p.src); ctx2d.restore();
    if(p.src && p.src.paint && p.src.ok()) gp = p;
    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
  }
  if(gp) gp.src.paint(cvb, gp.box, FB_layerOn("dots"), FB.alpha);
  else if(!glErr) PARTGL.frame(cvb, null, false, 1);
}

/* ---------- readouts: tables like the totals container ---------- */
function FB_td(tr, cls, text){ const td = document.createElement("td"); td.className = cls; td.textContent = text; tr.appendChild(td); return td; }
/* absolute temperatures read K / C so both land side by side */
function FB_fmtKT(k){ return k.toFixed(0) + " / " + (k - 273.15).toFixed(0); }
const FB_KC = "K/°C";
function FB_trow(tab, lab, val, unit, col){ const tr = document.createElement("tr");
  FB_td(tr, "t-lab", lab); const n = FB_td(tr, "t-num", val); if(col) n.style.color = col;
  FB_td(tr, "t-unit", unit || ""); tab.appendChild(tr); }
function FB_head(tab, text, col){ const tr = document.createElement("tr"), td = document.createElement("td");
  td.colSpan = 3; td.className = "t-head";
  if(col){ const sw = document.createElement("span");
    sw.style.cssText = "display:inline-block;width:9px;height:9px;background:" + col + ";margin-right:6px;";
    td.appendChild(sw); }
  td.appendChild(document.createTextNode(text)); tr.appendChild(td); tab.appendChild(tr); }
function FB_readSrc(S, i){
  const [W] = FB_cellWH(), rows = [], R = (a, b, c, col) => rows.push([a, b, c || "", col]);
  const xy = (i % W) + "," + ((i / W) | 0);
  let head = xy;
  if(!S.ok()) return {head:head + " (not ready)", rows};
  if(S.infoHead){ const s = S.infoHead(i); head += "  " + s; if(s === "WALL") return {head, rows}; }
  else if(S.info){ const s = S.info(i); head += " " + s; if(s === "WALL") return {head, rows}; }
  else head += "  " + S.name;
  const at = S.T(i);
  R("air", isFinite(at) ? FB_fmtKT(at) : "-", FB_KC);
  R("P", num(S.P(i), 0).toFixed(2), "kPa");
  R("pk", num(S.pk(i), 0).toFixed(1), "kPa");
  try{ if(S.h2f) R("H2", (S.h2f(i) * 100).toFixed(2), "%", "#a48ad6"); }catch(e){}
  try{ if(S.o2f) R("O2", (S.o2f(i) * 100).toFixed(2), "%"); }catch(e){}
  R("steam", num(S.vap(i), 0).toFixed(3), "kg", "#e8f4f6");
  R("gas", num(S.gas(i), 0).toFixed(3), "kg");
  try{ if(S.pocketV && S.pocket(i) >= 0 && isFinite(S.pocketV(i))){
    R("gas vol", S.pocketV(i).toFixed(0), "m3");
    if(isFinite(S.pocketT(i))) R("gas T", FB_fmtKT(S.pocketT(i)), FB_KC); } }catch(e){}
  const w = num(S.water(i), 0);
  R("water", w.toFixed(1), "kg", "#5aa9d6");
  try{ if(S.waterT && w > 0 && isFinite(S.waterT(i))) R("water T", FB_fmtKT(S.waterT(i)), FB_KC, "#5aa9d6"); }catch(e){}
  if(S.pool && num(S.pool(i), 0) >= 0.01){
    R("pool", num(S.pool(i), 0).toFixed(1), "kg", "#8e9aa2");
    try{ if(S.poolT && isFinite(S.poolT(i))) R("pool T", FB_fmtKT(S.poolT(i)), FB_KC, "#8e9aa2"); }catch(e){}
    try{ if(S.poolLit && S.poolLit(i)) R("pool", "BURNING"); }catch(e){}
  }
  if(S.cor){ const m = num(S.cor(i), 0);
    if(m >= 1){ R("corium", (m / 1000).toFixed(2), "t", "#ff7a2a");
      try{ if(S.corT && isFinite(S.corT(i))) R("corium T", FB_fmtKT(S.corT(i)), FB_KC, "#ff7a2a"); }catch(e){} } }
  if(S.flame(i)) R("flame", "BURNING", "", "#ffd27a");
  try{ if(S.smoke && S.smoke(i) >= 1e-4) R("smoke", S.smoke(i).toFixed(3), "kg", "#f4f1ea"); }catch(e){}
  try{ if(S.fp && S.fp(i) >= 1e-9) R("FP", S.fp(i).toExponential(2), "kg"); }catch(e){}
  try{ if(S.cof && S.cof(i) >= 5e-4){ R("CO", (S.cof(i) * 100).toFixed(2), "%", "#b8a890"); R("CO mass", num(S.coKg(i), 0).toFixed(3), "kg", "#b8a890"); } }catch(e){}
  try{ if(S.co2f && S.co2f(i) >= 5e-4){ R("CO2", (S.co2f(i) * 100).toFixed(2), "%", "#8fa48a"); R("CO2 mass", num(S.co2Kg(i), 0).toFixed(3), "kg", "#8fa48a"); } }catch(e){}
  try{ if(S.h2kg && S.h2kg(i) >= 1e-4) R("H2 mass", S.h2kg(i).toFixed(3), "kg", "#a48ad6"); }catch(e){}
  try{ if(S.air) R("air mass", num(S.air(i), 0).toFixed(3), "kg"); }catch(e){}
  try{ if(S.pocket){ R("pocket", String(S.pocket(i))); R("body", String(S.body(i))); R("fill", (num(S.lfill(i), 0) * 100).toFixed(0), "%"); } }catch(e){}
  try{ if(S.heatV && S.heatV(i) > 0.05) R("heat", "+" + S.heatV(i).toFixed(1), "K"); }catch(e){}
  try{ if(S.condV && S.condV(i) >= 0.01) R("cond", S.condV(i).toFixed(2), "kg"); }catch(e){}
  try{ if(S.depV && S.depV(i) >= 1e-4) R("deposit", S.depV(i).toFixed(3), "kg"); }catch(e){}
  try{ if(S.fpn && S.fpn(i) >= 1e-12) R("FPN", S.fpn(i).toExponential(2), "kg"); }catch(e){}
  try{ if(S.fpv && S.fpv(i) >= 1e-12) R("FPV", S.fpv(i).toExponential(2), "kg"); }catch(e){}
  try{ if(S.ablV && S.ablV(i) > 1e-6) R("ablate", (S.ablV(i) * 1000).toFixed(1), "mm"); }catch(e){}
  try{ if(S.crustV && S.crustV(i) > 1e-6) R("crust", (S.crustV(i) * 1000).toFixed(1), "mm"); }catch(e){}
  try{ if(S.jetV && S.door(i) && S.jetV(i) > 0.05) R("jet", S.jetV(i).toFixed(1), "m/s"); }catch(e){}
  try{ if(S.wallV && S.wallV(i) > 0) R("wall", S.wallV(i) === 2 ? "gas" : "water"); }catch(e){}
  return {head, rows};
}
/* particle kinds by code: KW water, KV steam, KH hydrogen, KQ heat, KM metal, KX corium, KC/CO, KD/CO2, KS smoke */
const PKIND = ["?", "WATER", "STEAM", "H2", "HEAT", "METAL", "CORIUM", "CO", "CO2", "SMOKE"];
/* the dot colour partgl.js paints each kind, burning ones last */
const PKCOL = ["#9fb4b9", "#5aa9d6", "#e8f4f6", "#a48ad6", "#f0a830", "#8e9aa2", "#ff7a2a", "#b8a890", "#8fa48a", "#f4f1ea"];
function FB_partCol(p){
  try{ return PART.burn[p] ? "#ffd27a" : PKCOL[PART.kind[p]] || "#9fb4b9"; }
  catch(e){ return "#9fb4b9"; }
}
function FB_partAt(bx, by){
  if(!MOCK.part || !PART.L.ready || !(bx >= 0) || !(by >= 0)) return -1;
  const xs = PART.px, ys = PART.py;
  let best = -1, bd = 0.75 * 0.75;
  for(let p = 0; p < PART.L.np; p++){
    const dx = xs[p] - bx, dy = ys[p] - by, d2 = dx * dx + dy * dy;
    if(d2 < bd){ bd = d2; best = p; }
  }
  return best;
}
function FB_partInfo(p){
  const rows = [], R = (a, b, c, col) => rows.push([a, b, c || "", col]);
  try{
    const k = PART.kind[p], n = PKIND[k] || ("K" + k), col = FB_partCol(p);
    R("kind", n, "", col);
    R("m", num(PART.pm[p], 0).toFixed(3), "kg");
    const T = PART.pT[p];
    if(isFinite(T)) R("T", FB_fmtKT(T), FB_KC);
    const mpc = (typeof MPC !== "undefined") ? MPC : 1;
    R("v", (Math.hypot(PART.vx[p], PART.vy[p]) * mpc).toFixed(2), "m/s");
    if(PART.burn[p]) R("state", "BURNING");
    if(k !== 1 && k !== 5 && k !== 6 && PART.pv) R("lot", num(PART.pv[p], 0).toFixed(2), "cells");
    try{
      const A = PART.A;
      if(A.pFp && A.pFp[p] > 1e-12) R("fp cargo", A.pFp[p].toExponential(2), "kg");
      if(A.pSo && A.pSo[p] > 1e-12) R("smoke cargo", A.pSo[p].toExponential(2), "kg");
      if(k === 6 && A.pCF){
        const F = A.pCF[p], Kc = A.pCK[p], Z = A.pCZ[p], S2 = A.pCS[p], X = A.pCX[p];
        if(F + Kc + Z + S2 + X > 0) R("mix", "F " + F.toFixed(1) + " K " + Kc.toFixed(1) + " Z " + Z.toFixed(1) + " S " + S2.toFixed(1) + " X " + X.toFixed(1), "kg");
        if(A.pDw && A.pDw[p] > 0) R("decay", A.pDw[p].toFixed(1), "W/kg");
      }
      if((k === 5 || k === 6) && A.frz && A.frz[p]) R("state", "FROZEN");
      if(k === 6 && A.pFci && A.pFci[p]) R("state", "FCI");
    }catch(e){}
  }catch(e){ R("state", "(unreadable)"); }
  return {head:"PARTICLE " + p, col:FB_partCol(p), rows};
}
function FB_read(){
  const box = $("fb-read"), fl = $("fb-readfloat");
  if(!box) return;
  if(FB.hover < 0){ if(fl) fl.style.display = "none"; return; }
  if(fl) fl.style.display = "";
  box.textContent = "";
  const tab = document.createElement("table");
  const S = FB.panes.length && FB.panes[0].src;
  if(!S){ box.textContent = "(mockup script missing)"; return; }
  const r = FB_readSrc(S, FB.hover);
  FB_head(tab, r.head);
  for(const [a, b, c, d] of r.rows) FB_trow(tab, a, b, c, d);
  if(FB_layerOn("dots") && FB.hpos){
    const p = FB_partAt(FB.hpos.bx, FB.hpos.by);
    if(p >= 0){ const q = FB_partInfo(p);
      FB_head(tab, q.head, q.col);
      for(const [a, b, c, d] of q.rows) FB_trow(tab, a, b, c, d); }
  }
  box.appendChild(tab);
}
/* totals: one fixed table built once, values written in place so columns never move.
   rows with a particle kind show its dot colour (PKCOL); the rest keep the default ink.
   pockets are a live section below: one V/p/T triple per gas pocket, not just the count */
const FB_TROWS = [
  ["t-gas", "gas", "kg"], ["t-h2", "H2", "kg", "#a48ad6"], ["t-o2", "O2", "kg"], ["t-vap", "steam", "kg", "#e8f4f6"],
  ["t-wat", "water", "kg", "#5aa9d6"], ["t-pool", "pool", "kg", "#8e9aa2"], ["t-cor", "corium", "kg", "#ff7a2a"],
  ["t-co", "CO", "kg", "#b8a890"], ["t-co2", "CO2", "kg", "#8fa48a"], ["t-smoke", "smoke", "kg", "#f4f1ea"], ["t-fp", "FP", "kg"],
  ["t-pk", "pk", "kPa"], ["t-maxT", "maxT", "K/°C"],
];
function FB_totBuild(){
  const box = $("fb-totitems");
  if(!box || box.childNodes.length) return;
  for(const [id, lab, unit, col] of FB_TROWS){
    const tr = document.createElement("tr");
    const a = document.createElement("td"); a.className = "t-lab"; a.textContent = lab;
    const b = document.createElement("td"); b.className = "t-num"; b.id = id; b.textContent = "-";
    if(col) b.style.color = col;
    const c = document.createElement("td"); c.className = "t-unit"; c.textContent = unit;
    tr.append(a, b, c); box.appendChild(tr);
  }
}
function FB_totals(){
  const S = FB.panes.length && FB.panes[0].src;
  let t = "-";
  try{ if(MOCK.part) t = "T+" + num(PART.L.t, 0).toFixed(2) + " s"; }catch(e){}
  const clk = $("fb-clock");
  if(clk) clk.textContent = t;
  const set = (id, s) => { const e = $(id); if(e) e.textContent = s; };
  if(!S || !S.ok()) return;
  let r;
  try{ r = S.tot(); }catch(e){ return; }
  set("t-gas", r.gas.toFixed(1)); set("t-h2", r.h2.toFixed(2)); set("t-o2", r.o2.toFixed(1));
  set("t-vap", r.vap.toFixed(2)); set("t-wat", r.wat.toFixed(0)); set("t-pool", r.pool.toFixed(1));
  set("t-cor", (r.cor || 0).toFixed(0)); set("t-co", (r.co || 0).toFixed(2)); set("t-co2", (r.co2 || 0).toFixed(2));
  set("t-smoke", (r.smoke || 0).toFixed(2)); set("t-fp", (r.fp || 0).toExponential(2));
  set("t-pk", r.pk.toFixed(1)); set("t-maxT", isFinite(r.maxT) ? FB_fmtKT(r.maxT) : "-");
  const cost = $("fb-cost");
  if(cost) cost.textContent = costOf(S).toFixed(3) + " ms";
  try{ const np = $("fb-np"); if(np) np.textContent = String(PART.L.np) + " parts"; }catch(e){}
  FB_pockets(r);
}
/* pockets section: the live gas pockets' container data (V, p, T each), rows pooled and written in place */
function FB_prow(i){
  const box = $("fb-totitems");
  if(!box) return null;
  FB.prows = FB.prows || [];
  let q = FB.prows[i];
  if(!q){
    const tr = document.createElement("tr"); tr.className = "t-pock";
    const a = document.createElement("td"); a.className = "t-lab";
    const b = document.createElement("td"); b.className = "t-num";
    const c = document.createElement("td"); c.className = "t-unit";
    tr.append(a, b, c); box.appendChild(tr);
    q = FB.prows[i] = {tr, lab:a, num:b, unit:c};
  }
  return q;
}
function FB_pockets(r){
  const box = $("fb-totitems");
  if(!box) return;
  FB.prows = FB.prows || [];
  let n = 0;
  const set = (lab, val, unit) => {
    const q = FB_prow(n++);
    if(!q) return;
    q.tr.style.display = "";
    q.lab.textContent = lab; q.num.textContent = val; q.unit.textContent = unit || "";
  };
  const ps = r && r.pockets;
  if(!ps){
    let cnt = "-";
    try{ cnt = String(PART.L.nlive); }catch(e){}
    set("pockets", cnt, "");
  } else {
    const show = ps.slice(0, 8);
    for(const p of show){
      const lab = "p" + p.id;
      set(lab + " V", isFinite(p.V) ? p.V.toFixed(1) : "-", "m3");
      set(lab + " p", isFinite(p.p) ? p.p.toFixed(2) : "-", "kPa");
      set(lab + " T", isFinite(p.T) ? p.T.toFixed(0) : "-", "K");
    }
    if(ps.length > show.length) set("+" + (ps.length - show.length) + " more", "", "");
  }
  for(let i = n; i < FB.prows.length; i++) FB.prows[i].tr.style.display = "none";
}

/* ---------- main loop: the particle mockup steps dt, timed on its own ---------- */
const ema = (a, x) => a > 0 ? a + 0.05 * (x - a) : x;
function FB_stepAll(n){
  if(n <= 0) return;
  /* a single shot counts down in ticks, so a paused bench holds it and a fast one ends it on the same dose */
  const shooting = FB.shot > 0;
  if(shooting){ n = Math.min(n, FB.shot); FB.shot -= n; }
  FB_stepN(n);
  if(shooting && FB.shot === 0) FB_release();
}
/* the particle mockup steps alone, timed on its own */
function FB_stepN(n){
  for(const key in MOCK){ const m = MOCK[key]; if(!m) continue;
    const t0 = performance.now();
    try{ for(let k = 0; k < n; k++) m.step(0.02); }
    catch(e){ if(FB_frame % 60 === 1) sayErr(m.src.name.toLowerCase() + " step: " + (e && e.message || e)); }
    FB.cost[m.src.name] = ema(costOf(m.src), (performance.now() - t0) / n);
  }
}
/* the game's own clock (tickPay, tickBudget in record.js): a speed is plant seconds per wall second, MAX its frame budget */
let FB_frame = 0, FB_prev = NaN, FB_fpsN = 0, FB_fpsT = 0;
// a rate the machine cannot hold would pay TICK_CAP ticks a frame and paint at 2 fps; past MAX's budget the frame stops stepping
let FB_t0 = 0;
const FB_clk = tickClock(), FB_tick1 = () => { FB_stepAll(1); return performance.now() - FB_t0 < TR_MAX_MS ? 1 : 2; };
function FB_tick(now){
  requestAnimationFrame(FB_tick);
  FB_frame++;
  const dt = now > FB_prev ? (now - FB_prev) / 1000 : 0; FB_prev = now;
  FB_fpsN++; FB_fpsT += dt;
  if(FB_fpsT >= 0.5){ const e = $("fb-fps"); if(e) e.textContent = (FB_fpsN / FB_fpsT).toFixed(0) + " fps"; FB_fpsN = 0; FB_fpsT = 0; }
  if(!FB.playing){ FB_clk.acc = 0; FB.alpha = 1; }
  else {
    const r = FB.speeds[FB.speedIx] || 1;
    FB_t0 = performance.now();
    if(r === Infinity){ FB_clk.acc = 0; FB.alpha = 1; tickBudget(TR_MAX_MS, FB_tick1); }
    else { tickPay(FB_clk, dt, r, FB_tick1); FB.alpha = FB_clk.acc / 0.02; }
  }
  try{ FB_draw(); }catch(e){ if(FB_frame % 60 === 1) sayErr("draw: " + (e && e.message || e)); }
  if(FB_frame % 6 === 0){ try{ FB_read(); FB_totals(); }catch(e){} }
}

/* ---------- inputs: one slider per row of PART.KNOBS, and nothing on show that no pane on screen reads ---------- */
function FB_knobs(){
  const box = $("fb-knobs");
  if(!box || !MOCK.part) return;
  let group = "";
  const rows = [];
  for(const [key, grp, lab, min, max, step, def, clears] of PART.KNOBS){
    if(grp !== group){ group = grp; const h = document.createElement("h3"); h.textContent = "PARTICLES: " + grp; box.appendChild(h); }
    const row = document.createElement("div"), name = document.createElement("span"), inp = document.createElement("input"), val = document.createElement("span");
    row.className = "fb-knob"; name.textContent = lab + (clears ? " (clears)" : "");
    inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = PART.K[key];
    const show = () => { val.textContent = String(+(+PART.K[key]).toFixed(3)); };
    inp.oninput = () => { PART.K[key] = +inp.value; show(); if(clears) PART.reset(); };
    show(); row.append(name, inp, val); box.appendChild(row); rows.push(() => { inp.value = def; PART.K[key] = def; show(); });
  }
  const rs = document.createElement("button");
  rs.textContent = "DEFAULTS";
  rs.onclick = () => { rows.forEach(f => f()); PART.reset(); };
  const r = document.createElement("div"); r.className = "fb-row"; r.appendChild(rs); box.appendChild(r);
}
function FB_vis(){
  const S = srcOf();
  document.querySelectorAll("[data-need]").forEach(el => el.classList.remove("fb-hide"));
  for(const l of FB.layers) if(l.el) l.el.classList.toggle("fb-hide", !(S && S[l.need]));
}

/* ---------- wire UI ---------- */
function FB_wire(){
  window.addEventListener("resize", FB_fit);
  const lay = $("fb-layers");
  FB.layers.forEach(l => {
    const lab = l.el = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = l.on;
    cb.onchange = () => { l.on = cb.checked; };
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(l.lab));
    lay.appendChild(lab);
  });
  const units = {heat:"kW", h2:"kg/s", o2:"kg/s", steam:"kg/s", fluid:"t/s",
                 rmheat:"kW", rmgas:"kg/s", rmliq:"t/s", blast:"kPa",
                 break:"kg/s", metal:"kg/s", corium:"kg/s", co:"kg/s", co2:"kg/s", fp:"-"};
  const rates = {heat:1000, h2:5, o2:5, steam:5, fluid:1, rmheat:1000, rmgas:5, rmliq:1, break:50, metal:200, corium:1000, co:2, co2:2, fp:0};
  const tools = document.querySelectorAll("#fb-tools button, #fb-tools2 button, #fb-paint button");
  const syncTools = () => tools.forEach(b => b.classList.toggle("on", b.dataset.tool === FB.tool));
  tools.forEach(b => b.onclick = () => {
    FB.tool = b.dataset.tool; syncTools();
    if(units[FB.tool]) $("fb-unit").textContent = units[FB.tool];
    if(rates[FB.tool] !== undefined && FB.tool !== "blast") $("fb-rate").value = rates[FB.tool];
    FB_figs();
  });
  syncTools(); FB_figs();
  FB_totBuild();
  document.querySelectorAll("[data-room]").forEach(b => b.onclick = () => {
    FB.room = b.dataset.room; FB_boot();
  });
  $("fb-play").onclick = () => {
    FB.playing = !FB.playing;
    $("fb-play").textContent = FB.playing ? "PAUSE" : "PLAY";
    $("fb-play").classList.toggle("on", FB.playing);
  };
  $("fb-step").onclick = () => {
    FB.playing = false; $("fb-play").textContent = "PLAY"; $("fb-play").classList.remove("on");
    FB_stepAll(1);
  };
  $("fb-reset").onclick = () => FB_boot();
  $("fb-clearparts").onclick = () => { FB.parts = []; mockEach("parts", m => m.parts(FB.parts)); };
  const labs = ["1x", "4x", "20x", "MAX"];
  $("fb-speed").oninput = e => {
    FB.speedIx = +e.target.value || 0;
    $("fb-speedlab").textContent = labs[FB.speedIx] || "";
  };
  FB_knobs();
  cv.addEventListener("pointerdown", e => {
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    const q = FB_evPos(e);
    FB.hover = q.cell; FB.hpos = q; FB_apply(q.cell);
    const paint = !!PAINT[FB.tool] || FB.tool === "conc";
    if(q.cell < 0 || FB.tool === "blast" || (FB.pin && !paint)) return;
    if(FB.single && !paint) FB.shot = 50;
    else FB.held = true;
  });
  cv.addEventListener("pointermove", e => {
    const q = FB_evPos(e);
    FB.hover = q.cell; FB.hpos = q;
    if(FB.held && q.cell >= 0) FB_apply(q.cell);
  });
  const up = () => { if(FB.held){ FB.held = false; if(FB.stroke) FB_strokeEnd(); else FB_release(); } };
  document.querySelectorAll('[name="fb-injmode"]').forEach(r => r.onchange = () => { if(!r.checked) return; FB.single = r.value === "single"; FB.pin = r.value === "pin"; });
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
}

try{ FB_wire(); FB_boot(); FB_vis(); FB_tick(); }
catch(e){ sayErr("bench: " + (e && e.stack || e)); }
})();
