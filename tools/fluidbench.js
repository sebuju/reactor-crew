"use strict";
/* FLUID BENCH - room gas + liquid only.
   CURRENT pane: the live solvers (step(0.02)) and live room fields on an empty board, liner walls only.
   PARTICLES pane: tools/particles.js, fed the same injections on the same walls.
   Debug layers paint VALUES per cell through one source shape, so every pane draws alike. */
(function(){
const $ = id => document.getElementById(id);
const errBox = $("fb-err");
const sayErr = m => { if(errBox) errBox.textContent += m + "\n"; };
const has = n => { try { return typeof eval(n) !== "undefined"; } catch(e){ return false; } };
const num = (v, d) => (typeof v === "number" && isFinite(v)) ? v : d;
const fnOf = n => has(n) ? eval(n) : null;

/* ---------- live-view geometry (GX/CELL/rowTop/rowAt are live consts) ---------- */
const FB = {
  playing:true, speedIx:0, speeds:[1,4,20,Infinity],
  tool:"fluid", room:"sealed", mode:"part",
  hover:-1, held:false, single:false, shot:0,
  panes:[], cost:{},
  /* need: the source field a layer draws from; the checkbox shows only while a pane on screen has it */
  layers:[
    {id:"temp",  lab:"TEMP K",    on:false, need:"T"},
    {id:"press", lab:"PRESS kPa", on:false, need:"P"},
    {id:"h2",    lab:"H2 %",      on:false, need:"h2f"},
    {id:"o2",    lab:"O2 %",      on:false, need:"o2f"},
    {id:"vap",   lab:"STEAM kg",  on:false, need:"vap"},
    {id:"gas",   lab:"GAS kg",    on:false, need:"gas"},
    {id:"water", lab:"WATER",     on:true,  need:"water"},
    {id:"pool",  lab:"METAL POOL",on:false, need:"pool"},
    {id:"cor",   lab:"CORIUM",    on:false, need:"cor"},
    {id:"flame", lab:"FLAME",     on:false, need:"flame"},
    {id:"blast", lab:"BLAST PK",  on:false, need:"pk"},
    {id:"co",    lab:"CO/CO2 %",  on:false, need:"cof"},
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

/* ---------- the two sources, one shape ---------- */
const liveH2 = fnOf("eRoomH2Frac"), liveO2 = fnOf("eRoomO2Frac"), liveCO = fnOf("eRoomCOFrac"), liveCO2 = fnOf("eRoomCO2Frac");
const liveWT = fnOf("eRoomWaterT"), livePT = fnOf("eRoomPoolT"), livePL = fnOf("roomPoolLit"), liveCT = fnOf("eRoomCorT");
const SRC_LIVE = {
  name: "CURRENT",
  ok: () => typeof ST !== "undefined" && !!ST,
  T: i => ST.roomT ? ST.roomT[i] : NaN,
  P: i => ST.roomP ? num(ST.roomP[i], 0) : 0,
  pk: i => ST.roomPPk ? num(ST.roomPPk[i], 0) : 0,
  h2f: liveH2, o2f: liveO2, cof: liveCO, co2f: liveCO2,
  vap: i => ST.roomVap ? num(ST.roomVap[i], 0) : 0,
  gas: i => ST.roomM ? num(ST.roomM[i], 0) : 0,
  water: i => ST.roomWater ? num(ST.roomWater[i], 0) : 0,
  waterT: liveWT,
  pool: i => ST.roomPool ? num(ST.roomPool[i], 0) : 0,
  poolT: livePT ? i => livePT(ST, i) : null,
  poolLit: livePL ? i => !!livePL(ST, i) : null,
  cor: i => ST.roomCorF ? num(ST.roomCorF[i], 0) + num(ST.roomCorK[i], 0) + num(ST.roomCorS[i], 0) : 0,
  corT: liveCT,
  flame: i => !!(ST.roomFlame && ST.roomFlame[i] > 0),
  tot: () => {
    const [W, Hh] = FB_cellWH(), N = W * Hh, r = {gas:0, h2:0, o2:0, vap:0, wat:0, pool:0, pk:0, maxT:-1e9};
    for(let i = 0; i < N; i++){
      r.gas += num(ST.roomM && ST.roomM[i], 0); r.h2 += num(ST.roomH2 && ST.roomH2[i], 0);
      r.o2 += num(ST.roomO2 && ST.roomO2[i], 0); r.vap += num(ST.roomVap && ST.roomVap[i], 0);
      r.wat += num(ST.roomWater && ST.roomWater[i], 0); r.pool += num(ST.roomPool && ST.roomPool[i], 0);
      if(ST.roomP && ST.roomP[i] > r.pk) r.pk = ST.roomP[i];
      if(ST.roomT && ST.roomT[i] > r.maxT) r.maxT = ST.roomT[i];
    }
    return r;
  },
};
/* the mockups share one shape: build, step, inject, off, blast, src, L */
const MOCK = {part:typeof PART !== "undefined" ? PART : null};
const MOCKS = Object.values(MOCK).filter(m => m);
const VIEWS = {live:["live"], part:["part"], split:["live", "part"]};
const srcOf = k => k === "live" ? SRC_LIVE : MOCK[k] ? MOCK[k].src : null;
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
  const keys = VIEWS[FB.mode] || VIEWS.split, k = keys.length;
  /* the grid of panes that draws the board largest: one row, one column, or two columns */
  let best = null;
  for(const [cols, rows] of [[k, 1], [1, k], [2, Math.ceil(k / 2)]]){
    const s = FB_paneView({w:cw / cols, h:ch / rows}).s;
    if(!best || s > best.s) best = {s, cols, rows};
  }
  const pw = cw / best.cols, ph = ch / best.rows;
  /* xf: the pane's board transform; box: the board and the pane in canvas pixels, as the GPU paint takes them */
  const [W, Hh] = FB_cellWH();
  FB.panes = keys.map((key, j) => { const rc = {x:(j % best.cols) * pw, y:Math.floor(j / best.cols) * ph, w:pw, h:ph};
    const view = FB_paneView(rc), s = view.s, ex = rc.x - view.x0 * s, ey = rc.y + labH() - view.y0 * s;
    const box = Float64Array.of(ex + GX * s, ey + rowTop(0) * s, W * CELL * s, (rowTop(Hh) - rowTop(0)) * s, rc.x, rc.y, rc.w, rc.h);
    return {src:srcOf(key), rect:rc, view, xf:[s, ex, ey], box}; });
}
function FB_pane(p){
  const r = p.rect, x = p.xf;
  ctx2d.save(); ctx2d.beginPath(); ctx2d.rect(r.x, r.y, r.w, r.h); ctx2d.clip();
  ctx2d.setTransform(x[0], 0, 0, x[0], x[1], x[2]);
}
function FB_evCell(e){
  const r = cv.getBoundingClientRect();
  const px = (e.clientX - r.left) * (cv.width / r.width);
  const py = (e.clientY - r.top) * (cv.height / r.height);
  const p = FB.panes.find(q => px >= q.rect.x && px < q.rect.x + q.rect.w && py >= q.rect.y && py < q.rect.y + q.rect.h);
  if(!p) return -1;
  const v = p.view, bx = (px - p.rect.x) / v.s + v.x0, by = (py - p.rect.y - labH()) / v.s + v.y0;
  const X = Math.floor((bx - GX) / CELL);
  const Y = (typeof rowAt === "function") ? rowAt(by) : Math.floor((by - 100) / CELL);
  const [W, Hh] = FB_cellWH();
  if(X < 0 || Y < 0 || X >= W || Y >= Hh) return -1;
  return Y * W + X;
}

/* ---------- boot: empty ship, liner walls, live commission, mockups built on the same walls ---------- */
function FB_walls(kind){
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
  mockEach("boot", m => m.build());
  FB.cost = {};
  const st = $("fb-state");
  if(st) st.textContent = "board " + GW + "x" + GH + ", room " + FB.room;
  FB_fit();
}

/* ---------- inject: the same act onto both models ---------- */
function FB_rate(){
  const v = parseFloat($("fb-rate").value);
  return isFinite(v) ? v : 0;
}
const INJ = {heat:["heat", 1], h2:["h2", 1], o2:["o2", 1], steam:["steam", 1], fluid:["fluid", 1000],
             rmheat:["heat", -1], rmgas:["gas", -1], rmliq:["fluid", -1000]};
function FB_apply(cell){
  if(cell < 0) return;
  if(FB.tool === "blast"){
    const kPa = parseFloat($("fb-blast").value);
    if(!(isFinite(kPa) && kPa > 0)) return;
    try{ if(typeof act === "function" && typeof ST !== "undefined" && ST) act("blast", cell, kPa); }
    catch(e){ sayErr("inject: " + (e && e.message || e)); }
    mockEach("blast", m => m.blast(cell, kPa));
    return;
  }
  const row = INJ[FB.tool];
  if(!row) return;
  const r = FB_rate(), rate = row[1] < 0 ? -Math.abs(r) * -row[1] : r * row[1];
  try{ if(typeof actId === "function" && typeof ST !== "undefined" && ST) actId("injectOn", row[0], rate, cell); }
  catch(e){ sayErr("inject: " + (e && e.message || e)); }
  mockEach("inject", m => m.inject(row[0], rate, cell));
}
function FB_release(){
  try{ if(typeof act === "function" && typeof ST !== "undefined" && ST) act("injectOff"); }
  catch(e){ /* off is best-effort */ }
  mockEach("off", m => m.off());
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
      const T = num(S.T(i), NaN);
      if(FB_layerOn("temp") && isFinite(T)){
        const z = (HEATZ && HEATZ[heatIx(T)]) || {col:"#5fd2e2", a:0.12};
        ctx2d.globalAlpha = 0.20; ctx2d.fillStyle = z.col;
        ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1;
        if(showVal){ ctx2d.fillStyle = "#dff0f3"; ctx2d.font = "30px monospace";
          ctx2d.textAlign = "center"; ctx2d.fillText(T.toFixed(0), x + CELL / 2, y + 38); }
      }
      if(FB_layerOn("press")){
        const p = num(S.P(i), 0);
        if(showVal){ ctx2d.fillStyle = Math.abs(p) >= 50 ? "#ff5a45" : "#9fb4b9";
          ctx2d.font = "26px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText(p.toFixed(1), x + CELL / 2, y + h - 8); }
      }
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
      if(FB_layerOn("co") && (S.cof || S.co2f) && showVal){
        const a = S.cof ? S.cof(i) * 100 : 0, b = S.co2f ? S.co2f(i) * 100 : 0;
        if(a >= 0.05 || b >= 0.05){ ctx2d.fillStyle = "#9fb4b9";
          ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText(a.toFixed(1) + "/" + b.toFixed(1), x + CELL / 2, y + h / 2 + 8); }
      }
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
  const dpr = window.devicePixelRatio || 1;
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
    const r = p.rect;
    FB_pane(p); FB_drawFront(p.src); ctx2d.restore();
    if(p.src && p.src.paint && p.src.ok()) gp = p;
    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    ctx2d.fillStyle = "#dff0f3"; ctx2d.font = (12 * dpr) + "px monospace"; ctx2d.textAlign = "left";
    let lab = p.src ? p.src.name + "   " + costOf(p.src).toFixed(3) + " ms/step" : "(mockup script missing)";
    if(MOCK.part && p.src === PART.src) lab += "   " + PART.L.np + " particles, " + PART.L.nlive + " gas pockets";
    else lab += "   " + (GW * GH) + " cells";
    ctx2d.fillText(lab, r.x + 8 * dpr, r.y + 15 * dpr);
    if(FB.panes.length > 1){ ctx2d.strokeStyle = "#1d2f35"; ctx2d.lineWidth = dpr; ctx2d.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); }
  }
  if(gp) gp.src.paint(cvb, gp.box, FB_layerOn("dots"), FB.alpha);
  else if(!glErr) PARTGL.frame(cvb, null, false, 1);
}

/* ---------- readouts ---------- */
function FB_fmtT(t){ return isFinite(t) ? t.toFixed(0) + " K" : "-"; }
function FB_readSrc(S, i){
  const [W] = FB_cellWH(), L = ["-- " + S.name + " --"];
  if(!S.ok()) return L;
  if(S.info){ const s = S.info(i); L.push(s); if(s === "WALL") return L; }
  L.push("CELL " + (i % W) + "," + ((i / W) | 0));
  L.push("AIR  " + FB_fmtT(S.T(i)));
  L.push("P    " + num(S.P(i), 0).toFixed(2) + " kPa  (pk " + num(S.pk(i), 0).toFixed(1) + ")");
  try{ if(S.h2f) L.push("H2   " + (S.h2f(i) * 100).toFixed(2) + " %"); }catch(e){}
  try{ if(S.o2f) L.push("O2   " + (S.o2f(i) * 100).toFixed(2) + " %"); }catch(e){}
  L.push("STEAM " + num(S.vap(i), 0).toFixed(3) + " kg");
  L.push("GAS   " + num(S.gas(i), 0).toFixed(3) + " kg");
  const w = num(S.water(i), 0);
  let s = "WATER " + w.toFixed(1) + " kg";
  try{ if(S.waterT && w > 0) s += "  " + S.waterT(i).toFixed(0) + " K"; }catch(e){}
  L.push(s);
  if(S.pool && num(S.pool(i), 0) >= 0.01){
    let p = "POOL  " + num(S.pool(i), 0).toFixed(1) + " kg";
    try{ if(S.poolT) p += "  " + S.poolT(i).toFixed(0) + " K"; }catch(e){}
    try{ if(S.poolLit && S.poolLit(i)) p += "  BURNING"; }catch(e){}
    L.push(p);
  }
  if(S.cor){ const m = num(S.cor(i), 0);
    if(m >= 1){ let c = "CORIUM " + (m / 1000).toFixed(2) + " t";
      try{ if(S.corT) c += "  " + S.corT(i).toFixed(0) + " K"; }catch(e){}
      L.push(c); } }
  if(S.flame(i)) L.push("FLAME BURNING");
  try{ if(S.cof && S.cof(i) >= 5e-4) L.push("CO   " + (S.cof(i) * 100).toFixed(2) + " %"); }catch(e){}
  try{ if(S.co2f && S.co2f(i) >= 5e-4) L.push("CO2  " + (S.co2f(i) * 100).toFixed(2) + " %"); }catch(e){}
  return L;
}
function FB_read(){
  const box = $("fb-read");
  if(!box) return;
  if(FB.hover < 0){ box.textContent = "hover the grid"; return; }
  box.textContent = FB.panes.filter(p => p.src).map(p => FB_readSrc(p.src, FB.hover).join("\n")).join("\n\n");
}
function FB_totals(){
  const box = $("fb-tot");
  if(!box) return;
  let t = "-";
  const k0 = (VIEWS[FB.mode] || VIEWS.split)[0];
  try{ if(k0 !== "live" && MOCK[k0]) t = "T+" + num(MOCK[k0].L.t, 0).toFixed(2) + " s";
    else if(has("SC_T") && ST && ST.sc) t = "T+" + num(ST.sc[SC_T], 0).toFixed(2) + " s"; }catch(e){}
  const L = [t];
  for(const p of FB.panes){ const S = p.src; if(!S || !S.ok()) continue;
    const r = S.tot();
    L.push(S.name + "  " + costOf(S).toFixed(3) + " ms/step\n  gas " + r.gas.toFixed(1) + " kg   H2 " + r.h2.toFixed(2) +
      "   O2 " + r.o2.toFixed(1) + "   vap " + r.vap.toFixed(2) +
      "\n  water " + r.wat.toFixed(0) + " kg   pool " + r.pool.toFixed(1) +
      "   pk " + r.pk.toFixed(1) + " kPa   maxT " + FB_fmtT(r.maxT)); }
  box.textContent = L.join("\n");
  const clk = $("fb-clock");
  if(clk) clk.textContent = t;
}

/* ---------- main loop: both models step the same dt, each timed on its own ---------- */
const ema = (a, x) => a > 0 ? a + 0.05 * (x - a) : x;
function FB_stepAll(n){
  if(n <= 0) return;
  /* a single shot counts down in ticks, so a paused bench holds it and a fast one ends it on the same dose */
  const shooting = FB.shot > 0;
  if(shooting){ n = Math.min(n, FB.shot); FB.shot -= n; }
  FB_stepN(n);
  if(shooting && FB.shot === 0) FB_release();
}
/* only the models on screen step: a hidden one's tick cost the one you are watching its frame rate */
function FB_stepN(n){
  const on = VIEWS[FB.mode] || VIEWS.split;
  let t0 = performance.now();
  if(on.includes("live")){
    try{ if(typeof step === "function" && typeof ST !== "undefined" && ST) for(let k = 0; k < n; k++) step(0.02); }
    catch(e){ if(FB_frame % 60 === 1) sayErr("step: " + (e && e.message || e)); }
    FB.cost[SRC_LIVE.name] = ema(costOf(SRC_LIVE), (performance.now() - t0) / n);
  }
  for(const key in MOCK){ const m = MOCK[key]; if(!m || !on.includes(key)) continue;
    t0 = performance.now();
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
  const keys = VIEWS[FB.mode] || VIEWS.split, srcs = keys.map(srcOf).filter(s => s);
  document.querySelectorAll("[data-need]").forEach(el => el.classList.toggle("fb-hide", !keys.includes(el.dataset.need)));
  for(const l of FB.layers) if(l.el) l.el.classList.toggle("fb-hide", !srcs.some(s => !!s[l.need]));
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
  const tools = document.querySelectorAll("#fb-tools button");
  const units = {heat:"kW", h2:"kg/s", o2:"kg/s", steam:"kg/s", fluid:"t/s",
                 rmheat:"kW", rmgas:"kg/s", rmliq:"t/s", blast:"kPa"};
  const rates = {heat:1000, h2:5, o2:5, steam:5, fluid:1, rmheat:1000, rmgas:5, rmliq:1};
  const syncTools = () => tools.forEach(b => b.classList.toggle("on", b.dataset.tool === FB.tool));
  tools.forEach(b => b.onclick = () => {
    FB.tool = b.dataset.tool; syncTools();
    if(units[FB.tool]) $("fb-unit").textContent = units[FB.tool];
    if(rates[FB.tool] !== undefined && FB.tool !== "blast") $("fb-rate").value = rates[FB.tool];
  });
  syncTools();
  const views = document.querySelectorAll("[data-view]");
  const syncViews = () => views.forEach(b => b.classList.toggle("on", b.dataset.view === FB.mode));
  views.forEach(b => b.onclick = () => { FB.mode = b.dataset.view; syncViews(); FB_fit(); FB_vis(); });
  syncViews();
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
  const labs = ["1x", "4x", "20x", "MAX"];
  $("fb-speed").oninput = e => {
    FB.speedIx = +e.target.value || 0;
    $("fb-speedlab").textContent = labs[FB.speedIx] || "";
  };
  FB_knobs();
  cv.addEventListener("pointerdown", e => {
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    const c = FB_evCell(e);
    FB.hover = c; FB_apply(c);
    if(c < 0 || FB.tool === "blast") return;
    if(FB.single) FB.shot = 50;
    else FB.held = true;
  });
  cv.addEventListener("pointermove", e => {
    const c = FB_evCell(e);
    FB.hover = c;
    if(FB.held && c >= 0) FB_apply(c);
  });
  const up = () => { if(FB.held){ FB.held = false; FB_release(); } };
  document.querySelectorAll('[name="fb-injmode"]').forEach(r => r.onchange = () => { FB.single = r.value === "single" && r.checked; });
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
}

try{ FB_wire(); FB_boot(); FB_vis(); FB_tick(); }
catch(e){ sayErr("bench: " + (e && e.stack || e)); }
})();
