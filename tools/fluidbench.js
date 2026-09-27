"use strict";
/* FLUID BENCH - room gas + liquid only.
   CURRENT pane: the live solvers (step(0.02)) and live room fields on an empty board, liner walls only.
   LUMPED pane: tools/lumped.js, rooms as control volumes, fed the same injections on the same walls.
   Debug layers paint VALUES per cell through one source shape, so both panes draw alike. */
(function(){
const $ = id => document.getElementById(id);
const errBox = $("fb-err");
const sayErr = m => { if(errBox) errBox.textContent += m + "\n"; };
const has = n => { try { return typeof eval(n) !== "undefined"; } catch(e){ return false; } };
const num = (v, d) => (typeof v === "number" && isFinite(v)) ? v : d;
const fnOf = n => has(n) ? eval(n) : null;

/* ---------- live-view geometry (GX/CELL/rowTop/rowAt are live consts) ---------- */
const FB = {
  playing:true, speedIx:1, speeds:[1,4,20,200],
  tool:"fluid", room:"sealed", mode:"split",
  hover:-1, held:false,
  panes:[], cost:{},
  layers:[
    {id:"temp",  lab:"TEMP K",    on:false},
    {id:"press", lab:"PRESS kPa", on:false},
    {id:"h2",    lab:"H2 %",      on:false},
    {id:"o2",    lab:"O2 %",      on:false},
    {id:"vap",   lab:"STEAM kg",  on:false},
    {id:"gas",   lab:"GAS kg",    on:false},
    {id:"water", lab:"WATER",     on:true},
    {id:"pool",  lab:"METAL POOL",on:false},
    {id:"cor",   lab:"CORIUM",    on:false},
    {id:"flame", lab:"FLAME",     on:false},
    {id:"blast", lab:"BLAST PK",  on:false},
    {id:"co",    lab:"CO/CO2 %",  on:false},
    {id:"lumps", lab:"LUMPS",     on:false},
    {id:"motion",lab:"MOTION",    on:true},
    {id:"smooth",lab:"SMOOTH",    on:true},
  ],
  simPerFrame:0.02,
};
const cv = $("cv");
const ctx2d = cv.getContext("2d");
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
const MOCK = {lump:typeof LUMP !== "undefined" ? LUMP : null, cell:typeof CELLR !== "undefined" ? CELLR : null};
const MOCKS = Object.values(MOCK).filter(m => m);
const VIEWS = {live:["live"], lump:["lump"], cell:["cell"], split:["live", "cell"], all:["live", "lump", "cell"]};
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
  const keys = VIEWS[FB.mode] || VIEWS.split, k = keys.length;
  /* the grid of panes that draws the board largest: one row, one column, or two columns */
  let best = null;
  for(const [cols, rows] of [[k, 1], [1, k], [2, Math.ceil(k / 2)]]){
    const s = FB_paneView({w:cw / cols, h:ch / rows}).s;
    if(!best || s > best.s) best = {s, cols, rows};
  }
  const pw = cw / best.cols, ph = ch / best.rows;
  FB.panes = keys.map((key, j) => { const rc = {x:(j % best.cols) * pw, y:Math.floor(j / best.cols) * ph, w:pw, h:ph};
    return {src:srcOf(key), rect:rc, view:FB_paneView(rc)}; });
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

/* ---------- boot: empty ship, liner walls, live commission, lumped build on the same walls ---------- */
function FB_walls(kind){
  const m = {};
  const rect = (x0, x1, y0, y1) => {
    for(let x = x0; x <= x1; x++){ m[x + "," + y0] = {m:"liner", t:600}; m[x + "," + y1] = {m:"liner", t:600}; }
    for(let y = y0; y <= y1; y++){ m[x0 + "," + y] = {m:"liner", t:600}; m[x1 + "," + y] = {m:"liner", t:600}; }
  };
  if(kind === "sealed") rect(15, 44, 8, 25);
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
  if(st) st.textContent = "board " + GW + "x" + GH + ", room " + FB.room +
    (MOCK.lump ? ", lumped " + LUMP.L.n + " volumes / " + LUMP.L.nj + " junctions" : "");
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
      const T = num(S.T(i), NaN), sm = S.sm && FB_layerOn("smooth");
      if(FB_layerOn("temp") && isFinite(T)){
        const z = (HEATZ && HEATZ[heatIx(sm ? S.sm("T", i) : T)]) || {col:"#5fd2e2", a:0.12};
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
        const f = S.h2f(i), fs = sm ? S.sm("h2", i) : f;
        if(fs > 0.0005){
          ctx2d.globalAlpha = Math.min(0.5, 0.08 + 0.4 * (fs / H2LFL));
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
        if((sm ? S.sm("o2", i) : f) < O2LOC){ ctx2d.globalAlpha = 0.35; ctx2d.fillStyle = "#5aa9d6";
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
      if(FB_layerOn("water")){
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
  if(ready && S.fx && FB_layerOn("motion")) FB_drawMotion(S);
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
/* ---------- MOTION: the lumped model's own flows drawn as moving streaks; paint only, the tick never sees it ---------- */
const MPC_ = () => FB_live("MPC", 1.4 / 3);
const cxOf = (i, W) => GX + (i % W) * CELL + CELL / 2;
const cyOf = (i, W) => { const Y = (i / W) | 0; return (rowTop(Y) + rowTop(Y + 1)) / 2; };
function FB_lane(x0, y0, x1, y1, u, t, col, a, w){
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  if(len < 1 || !(a > 0.02)) return;
  const gap = CELL * 0.9, umax = 0.35 * gap / FB.simPerFrame;
  const v = Math.max(-umax, Math.min(umax, u)), ph = ((t * v) % gap + gap) % gap, ux = dx / len, uy = dy / len;
  ctx2d.strokeStyle = col; ctx2d.globalAlpha = Math.min(0.9, a); ctx2d.lineWidth = w; ctx2d.lineCap = "round";
  ctx2d.beginPath();
  for(let s = ph - gap; s < len; s += gap){
    const p = Math.max(0, s), q = Math.min(len, s + gap * 0.45);
    if(q > p){ ctx2d.moveTo(x0 + ux * p, y0 + uy * p); ctx2d.lineTo(x0 + ux * q, y0 + uy * q); }
  }
  ctx2d.stroke(); ctx2d.globalAlpha = 1;
}
function FB_gasCol(F, v){
  const h = F.fracs(v), o = v * 4, vap = F.m[o + 2] / Math.max(1e-9, F.M[v]);
  return h > 0.01 ? "#a48ad6" : vap > 0.1 ? "#e8f4f6" : F.T[v] > 330 ? "#f0a830" : "#5fd2e2";
}
function FB_clipCells(W, Hh, keep){
  ctx2d.beginPath();
  for(let i = 0; i < W * Hh; i++) if(keep(i)){ const Y = (i / W) | 0; ctx2d.rect(GX + (i % W) * CELL, rowTop(Y), CELL, rowTop(Y + 1) - rowTop(Y)); }
  ctx2d.clip();
}
function FB_drawMotion(S){
  const F = S.fx(), W = F.W, Hh = F.H, t = F.t, K = CELL / MPC_(), g = 9.81;
  const rho = v => F.M[v] / F.Vg[v];
  const colTop = i => { while(i >= W && S.lump(i - W) >= 0 && !S.door(i - W)) i -= W; return i; };
  const surfY = c => { const Y = F.cSurfRow[c]; if(Y < 0) return NaN;
    const f = Math.max(0, Math.min(1, (F.cLvl[c] - (Hh - Y - 1) * MPC_()) / MPC_())); return rowTop(Y + 1) - f * (rowTop(Y + 1) - rowTop(Y)); };
  const wetAt = i => S.water(i) > 0 || (i + W < W * Hh && S.water(i + W) > 0);
  const surfBelow = i => { const v = S.lump(i); if(v < 0) return NaN; const c = F.vComp[v];
    return F.cSurfRow[c] >= 0 && wetAt(F.cSurfRow[c] * W + (i % W)) ? surfY(c) : NaN; };
  const floorY = i => { let k = i; while(k + W < W * Hh && S.lump(k + W) >= 0) k += W; const Y = (k / W) | 0; return rowTop(Y + 1); };
  /* gas through doors and across band faces: net flow plus the two-way buoyant exchange */
  for(let j = 0; j < F.nj; j++){
    const a = F.ja[j], b = F.jb[j], A = F.jA[j], wn = F.jW[j], ra = rho(a), rb = rho(b);
    const un = wn / ((wn >= 0 ? ra : rb) * A) * K, ux = 2 * F.jQ[j] / A * K * (ra < rb ? 1 : -1);
    const door = F.jDoor[j] === 1, vert = F.jv[j] === 1, f = door ? 1 : 0.45;
    for(let k = F.jC0[j]; k < F.jC0[j + 1]; k++){
      const i = F.jCells[k], x = cxOf(i, W), y = cyOf(i, W), Y = (i / W) | 0, h = rowTop(Y + 1) - rowTop(Y);
      if(!door && (i % W) % 3 !== 1) continue;
      for(const s of [-1, 1]){
        const u = un - s * ux, col = FB_gasCol(F, u >= 0 ? a : b), al = f * (0.15 + Math.abs(u) / K / 2.5);
        if(!vert) FB_lane(x - 1.6 * CELL, y + s * 0.22 * h, x + 1.6 * CELL, y + s * 0.22 * h, u, t, col, al, CELL * 0.07);
        else { const yb = door ? y : rowTop(Y + 1); FB_lane(x + s * 0.22 * CELL, yb - 1.4 * h, x + s * 0.22 * CELL, yb + 1.4 * h, u, t, col, al, CELL * 0.07); }
      }
      /* water over the sill, then down the far side */
      const ww = F.jWat[j];
      if(door && Math.abs(ww) > 0.5){
        const al = 0.3 + Math.min(0.6, Math.abs(ww) / 300);
        if(!vert){ const dir = ww > 0 ? 1 : -1, x1 = x + dir * CELL, yl = rowTop(Y + 1) - 0.12 * h;
          FB_lane(x - dir * CELL, yl, x1, yl, 3 * K, t, "#5aa9d6", al, CELL * 0.12);
          const yEnd = isFinite(surfBelow(i + dir)) ? surfBelow(i + dir) : floorY(i + dir);
          if(yEnd > yl) FB_lane(x1, yl, x1 + dir * 0.2 * CELL, yEnd, Math.sqrt(2 * g * (yEnd - yl) / K) * K, t, "#5aa9d6", al, CELL * 0.14); }
        else { const yEnd = isFinite(surfBelow(i + W)) ? surfBelow(i + W) : floorY(i + W);
          FB_lane(x, y, x, yEnd, Math.sqrt(2 * g * Math.max(0.1, (yEnd - y) / K)) * K, t, "#5aa9d6", al, CELL * 0.18); }
      }
    }
  }
  /* the source: a buoyant plume up to the ceiling, or water falling to the surface */
  const q = F.inj;
  if(q && q.cell >= 0 && S.lump(q.cell) >= 0){
    const i = q.cell, x = cxOf(i, W), y = cyOf(i, W);
    if(q.kind === "fluid" && q.rate > 0){
      const yEnd = isFinite(surfBelow(i)) && surfBelow(i) > y ? surfBelow(i) : floorY(i);
      const hM = Math.max(0.1, (yEnd - y) / K), u = Math.sqrt(2 * g * hM) * K, al = 0.35 + Math.min(0.5, q.rate / 2000);
      for(const dx of [-0.18, 0, 0.18]) FB_lane(x + dx * CELL, y, x + dx * CELL, yEnd, u * (1 + dx), t, "#5aa9d6", al, CELL * 0.1);
    }
    else if(q.rate > 0 && (q.kind === "heat" || q.kind === "h2" || q.kind === "steam")){
      const top = colTop(i), yTop = rowTop((top / W) | 0), hM = Math.max(0.5, (y - yTop) / K);
      // buoyancy flux B (m4/s3) and the point-source plume centreline speed 1.9 (B/z)^(1/3) at mid height
      const B = q.kind === "heat" ? g * q.rate * 1000 / (1.2 * 1005 * 293) : q.kind === "h2" ? g * 0.93 * q.rate / 0.0838 : g * 0.52 * q.rate / 0.59;
      const u = 1.9 * Math.cbrt(B / (hM / 2)) * K, spread = 0.12 * (y - yTop);
      const col = q.kind === "heat" ? "#f0a830" : q.kind === "h2" ? "#a48ad6" : "#e8f4f6";
      ctx2d.globalAlpha = 0.12; ctx2d.fillStyle = col; ctx2d.beginPath();
      ctx2d.moveTo(x - 0.15 * CELL, y); ctx2d.lineTo(x - 0.15 * CELL - spread, yTop); ctx2d.lineTo(x + 0.15 * CELL + spread, yTop); ctx2d.lineTo(x + 0.15 * CELL, y); ctx2d.fill();
      ctx2d.globalAlpha = 1;
      for(const s of [-1, -0.5, 0, 0.5, 1]) FB_lane(x + s * 0.12 * CELL, y, x + s * (0.15 * CELL + spread), yTop, u * (1 - 0.3 * Math.abs(s)), t, col, 0.55, CELL * 0.08);
      /* the ceiling jet: what reaches the top spreads sideways */
      for(const s of [-1, 1]) FB_lane(x, yTop + 0.25 * CELL, x + s * 5 * CELL, yTop + 0.25 * CELL, 0.5 * u, t, col, 0.3, CELL * 0.07);
    }
  }
  /* water surfaces: ripples driven by what is pouring in, bubbles where the pool boils */
  for(let c = 0; c < F.nc; c++){
    const Y = F.cSurfRow[c]; if(Y < 0 || !(F.cLvl[c] > 0)) continue;
    const ys = surfY(c); let x0 = -1;
    const amp = CELL * (0.02 + 0.14 * Math.min(1, (F.cIn[c] + 20 * F.cBoil[c]) / 500));
    for(let X = 0; X <= W; X++){
      const i = Y * W + X, wet = X < W && S.lump(i) >= 0 && F.vComp[S.lump(i)] === c && wetAt(i);
      if(wet && x0 < 0) x0 = X;
      if((!wet || X === W) && x0 >= 0){
        ctx2d.strokeStyle = "#9fd4f0"; ctx2d.globalAlpha = 0.8; ctx2d.lineWidth = CELL * 0.05; ctx2d.beginPath();
        for(let px = GX + x0 * CELL; px <= GX + X * CELL; px += CELL / 6){
          const yy = ys + amp * Math.sin(px / CELL * 1.9 + t * 3.1) + 0.5 * amp * Math.sin(px / CELL * 4.3 - t * 5.3);
          px === GX + x0 * CELL ? ctx2d.moveTo(px, yy) : ctx2d.lineTo(px, yy);
        }
        ctx2d.stroke(); ctx2d.globalAlpha = 1; x0 = -1;
      }
    }
    if(F.cBoil[c] > 0){
      const n = Math.min(4, 1 + Math.floor(F.cBoil[c] / 5));
      ctx2d.fillStyle = "#e8f4f6"; ctx2d.globalAlpha = 0.6;
      for(let X = 0; X < W; X++){ const i = Y * W + X; if(S.lump(i) < 0 || F.vComp[S.lump(i)] !== c) continue;
        for(let k = 0; k < n; k++){ const hsh = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453, fr = hsh - Math.floor(hsh);
          const ph = (t * (0.6 + fr) + fr) % 1, bx = GX + X * CELL + (0.15 + 0.7 * fr) * CELL, by = ys + (1 - ph) * 1.5 * CELL;
          ctx2d.beginPath(); ctx2d.arc(bx, by, CELL * (0.04 + 0.05 * ph), 0, 6.283); ctx2d.fill(); } }
      ctx2d.globalAlpha = 1;
    }
  }
  /* flame fronts: radius = burning velocity x time since ignition, clipped to the volume that is burning */
  for(let v = 0; v < F.n; v++){
    if(!F.burn[v]) continue;
    let ox, oy;
    if(F.igCell[v] >= 0){ ox = cxOf(F.igCell[v], W); oy = cyOf(F.igCell[v], W); }
    else { ox = 0; oy = 0; const n0 = F.vC0[v], n1 = F.vC0[v + 1]; for(let k = n0; k < n1; k++){ ox += cxOf(F.vCells[k], W); oy += cyOf(F.vCells[k], W); } ox /= (n1 - n0); oy /= (n1 - n0); }
    const r = Math.max(0.2 * CELL, F.burnS[v] * F.burnT[v] * K);
    ctx2d.save();
    ctx2d.beginPath();
    for(let k = F.vC0[v]; k < F.vC0[v + 1]; k++){ const i = F.vCells[k], Y = (i / W) | 0; ctx2d.rect(GX + (i % W) * CELL, rowTop(Y), CELL, rowTop(Y + 1) - rowTop(Y)); }
    ctx2d.clip();
    ctx2d.globalAlpha = 0.22; ctx2d.fillStyle = "#ff6a1e"; ctx2d.beginPath(); ctx2d.arc(ox, oy, r, 0, 6.283); ctx2d.fill();
    ctx2d.globalAlpha = 0.9; ctx2d.strokeStyle = "#ffd27a"; ctx2d.lineWidth = CELL * (0.25 + 0.12 * Math.sin(t * 37 + v));
    ctx2d.beginPath(); ctx2d.arc(ox, oy, r, 0, 6.283); ctx2d.stroke();
    ctx2d.restore();
  }
  /* blast: a ring at the speed of sound, clipped to the room, then the room's flash */
  for(const bl of F.blasts){
    const age = t - bl.t; if(age < 0 || age > 1) continue;
    const v0 = S.lump(bl.cell); if(v0 < 0) continue;
    const c = F.vComp[v0], x = cxOf(bl.cell, W), y = cyOf(bl.cell, W);
    ctx2d.save();
    FB_clipCells(W, Hh, i => S.lump(i) >= 0 && F.vComp[S.lump(i)] === c);
    if(age < 0.3){ ctx2d.globalAlpha = 0.3 * (1 - age / 0.3); ctx2d.fillStyle = "#ff5a45"; ctx2d.fillRect(GX - CELL, rowTop(0) - CELL, (W + 2) * CELL, rowTop(Hh) - rowTop(0) + 2 * CELL); }
    ctx2d.globalAlpha = 0.9 * (1 - age); ctx2d.strokeStyle = "#ff5a45"; ctx2d.lineWidth = CELL * 0.4;
    ctx2d.beginPath(); ctx2d.arc(x, y, 340 * age * K, 0, 6.283); ctx2d.stroke();
    ctx2d.restore();
  }
  ctx2d.globalAlpha = 1;
}
function FB_draw(){
  const dpr = window.devicePixelRatio || 1;
  ctx2d.setTransform(1, 0, 0, 1, 0, 0);
  ctx2d.fillStyle = "#040708";
  ctx2d.fillRect(0, 0, cv.width, cv.height);
  for(const p of FB.panes){
    const r = p.rect, v = p.view;
    ctx2d.save();
    ctx2d.beginPath(); ctx2d.rect(r.x, r.y, r.w, r.h); ctx2d.clip();
    ctx2d.setTransform(v.s, 0, 0, v.s, r.x - v.x0 * v.s, r.y + labH() - v.y0 * v.s);
    FB_drawBoard(p.src, v);
    ctx2d.restore();
    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    ctx2d.fillStyle = "#dff0f3"; ctx2d.font = (12 * dpr) + "px monospace"; ctx2d.textAlign = "left";
    let lab = p.src ? p.src.name + "   " + costOf(p.src).toFixed(3) + " ms/step" : "(mockup script missing)";
    if(MOCK.lump && p.src === LUMP.src) lab += "   " + LUMP.L.n + " volumes, " + LUMP.L.nj + " junctions";
    else if(MOCK.cell && p.src === CELLR.src) lab += "   " + (GW * GH) + " cells, " + CELLR.L.nr + " gas pockets";
    else lab += "   " + (GW * GH) + " cells";
    ctx2d.fillText(lab, r.x + 8 * dpr, r.y + 15 * dpr);
    if(FB.panes.length > 1){ ctx2d.strokeStyle = "#1d2f35"; ctx2d.lineWidth = dpr; ctx2d.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); }
  }
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
  try{ if(has("SC_T") && ST && ST.sc) t = "T+" + num(ST.sc[SC_T], 0).toFixed(2) + " s"; }catch(e){}
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
  let t0 = performance.now();
  try{ if(typeof step === "function" && typeof ST !== "undefined" && ST) for(let k = 0; k < n; k++) step(0.02); }
  catch(e){ if(FB_frame % 60 === 1) sayErr("step: " + (e && e.message || e)); }
  FB.cost[SRC_LIVE.name] = ema(costOf(SRC_LIVE), (performance.now() - t0) / n);
  for(const m of MOCKS){
    t0 = performance.now();
    try{ for(let k = 0; k < n; k++) m.step(0.02); }
    catch(e){ if(FB_frame % 60 === 1) sayErr(m.src.name.toLowerCase() + " step: " + (e && e.message || e)); }
    FB.cost[m.src.name] = ema(costOf(m.src), (performance.now() - t0) / n);
  }
}
let FB_frame = 0;
function FB_tick(){
  requestAnimationFrame(FB_tick);
  FB_frame++;
  if(FB.playing){
    const n = FB.speeds[FB.speedIx] || 1;
    if(n >= 200){ const t0 = performance.now(); let k = 0;
      while(k < 400 && performance.now() - t0 < 12){ FB_stepAll(4); k += 4; } FB.simPerFrame = Math.max(0.02, 0.02 * k); }
    else { FB_stepAll(n); FB.simPerFrame = 0.02 * n; }
  }
  try{ FB_draw(); }catch(e){ if(FB_frame % 60 === 1) sayErr("draw: " + (e && e.message || e)); }
  if(FB_frame % 6 === 0){ try{ FB_read(); FB_totals(); }catch(e){} }
}

/* ---------- wire UI ---------- */
function FB_wire(){
  window.addEventListener("resize", FB_fit);
  const lay = $("fb-layers");
  FB.layers.forEach(l => {
    const lab = document.createElement("label");
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
  views.forEach(b => b.onclick = () => { FB.mode = b.dataset.view; syncViews(); FB_fit(); });
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
  $("fb-gasx").oninput = e => {
    const k = +e.target.value || 1;
    if(MOCK.cell) CELLR.L.gasX = k;
    $("fb-gasxlab").textContent = k + "x";
  };
  cv.addEventListener("pointerdown", e => {
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    FB.held = true;
    const c = FB_evCell(e);
    FB.hover = c; FB_apply(c);
  });
  cv.addEventListener("pointermove", e => {
    const c = FB_evCell(e);
    FB.hover = c;
    if(FB.held && c >= 0) FB_apply(c);
  });
  const up = () => { if(FB.held){ FB.held = false; FB_release(); } };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
}

try{ FB_wire(); FB_boot(); FB_tick(); }
catch(e){ sayErr("bench: " + (e && e.stack || e)); }
})();
