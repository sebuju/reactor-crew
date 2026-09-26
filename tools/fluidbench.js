"use strict";
/* FLUID BENCH - room gas + liquid only.
   New file: no live source is edited. It CALLS the live solvers (step(0.02))
   and reads the live room fields (ST.roomT/roomP/roomM/roomH2/...) with the
   live thresholds (H2_LFL, O2_LOC, HEATZ, BLASTZ), on an empty board: no
   pipes, no machines, liner walls only. Debug layers paint VALUES per cell. */
(function(){
const $ = id => document.getElementById(id);
const errBox = $("fb-err");
const sayErr = m => { if(errBox) errBox.textContent += m + "\n"; };
const has = n => { try { return typeof eval(n) !== "undefined"; } catch(e){ return false; } };
const num = (v, d) => (typeof v === "number" && isFinite(v)) ? v : d;

/* ---------- live-view geometry (GX/CELL/rowTop/rowAt are live consts) ---------- */
const FB = {
  playing:true, speedIx:1, speeds:[1,4,20,200],
  tool:"fluid", room:"sealed",
  hover:-1, held:false,
  view:{s:1, x0:0, y0:0},
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
  ],
};
const cv = $("cv");
const ctx2d = cv.getContext("2d");

function FB_cellWH(){
  const W = (typeof GW !== "undefined") ? GW : 60;
  const Hh = (typeof GH !== "undefined") ? GH : 34;
  return [W, Hh];
}
function FB_fit(){
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(2, Math.round(r.width * dpr));
  cv.height = Math.max(2, Math.round(r.height * dpr));
  const [W, Hh] = FB_cellWH();
  const x0 = GX - CELL, x1 = GX + (W + 1) * CELL;
  const y0 = rowTop(0) - CELL, y1 = rowTop(Hh) + CELL;
  const s = Math.min(cv.width / (x1 - x0), cv.height / (y1 - y0));
  FB.view = {s, x0:x0 - (cv.width / s - (x1 - x0)) / 2,
                  y0:y0 - (cv.height / s - (y1 - y0)) / 2};
}
function FB_evCell(e){
  const r = cv.getBoundingClientRect();
  const px = (e.clientX - r.left) * (cv.width / r.width);
  const py = (e.clientY - r.top) * (cv.height / r.height);
  const X = Math.floor((px / FB.view.s + FB.view.x0 - GX) / CELL);
  const Y = (typeof rowAt === "function")
    ? rowAt(py / FB.view.s + FB.view.y0) : Math.floor((py / FB.view.s + FB.view.y0 - 100) / CELL);
  const [W, Hh] = FB_cellWH();
  if(X < 0 || Y < 0 || X >= W || Y >= Hh) return -1;
  return Y * W + X;
}

/* ---------- boot: empty ship, liner walls, live commission ---------- */
function FB_walls(kind){
  const [W, Hh] = FB_cellWH();
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
    if($("fb-state")) $("fb-state").textContent =
      "live board " + GW + "x" + GH + ", room " + FB.room + ", T+0.00 s";
  }catch(e){ sayErr("boot: " + (e && e.message || e)); }
}

/* ---------- inject: live acts onto room cells only ---------- */
function FB_rate(){
  const v = parseFloat($("fb-rate").value);
  return isFinite(v) ? v : 0;
}
function FB_apply(cell){
  if(cell < 0 || typeof ST === "undefined" || !ST) return;
  try{
    if(FB.tool === "blast"){
      const kPa = parseFloat($("fb-blast").value);
      if(isFinite(kPa) && kPa > 0 && typeof act === "function") act("blast", cell, kPa);
      return;
    }
    if(typeof actId !== "function" || typeof act !== "function") return;
    const r = FB_rate();
    if(FB.tool === "heat") actId("injectOn", "heat", r, cell);
    else if(FB.tool === "h2") actId("injectOn", "h2", r, cell);
    else if(FB.tool === "o2") actId("injectOn", "o2", r, cell);
    else if(FB.tool === "steam") actId("injectOn", "steam", r, cell);
    else if(FB.tool === "fluid") actId("injectOn", "fluid", r * 1000, cell);
    else if(FB.tool === "rmheat") actId("injectOn", "heat", -Math.abs(r), cell);
    else if(FB.tool === "rmgas") actId("injectOn", "gas", -Math.abs(r), cell);
    else if(FB.tool === "rmliq") actId("injectOn", "fluid", -Math.abs(r) * 1000, cell);
  }catch(e){ sayErr("inject: " + (e && e.message || e)); }
}
function FB_release(){
  try{ if(typeof act === "function" && typeof ST !== "undefined" && ST) act("injectOff"); }
  catch(e){ /* off is best-effort */ }
}

/* ---------- debug layers: live fields + live thresholds, values per cell ---------- */
function FB_live(n, d){ try{ const v = eval(n); return (v === undefined) ? d : v; }catch(e){ return d; } }
function FB_layerOn(id){ const l = FB.layers.find(q => q.id === id); return !!(l && l.on); }

function FB_draw(){
  const [W, Hh] = FB_cellWH();
  const v = FB.view;
  ctx2d.setTransform(1, 0, 0, 1, 0, 0);
  ctx2d.fillStyle = "#040708";
  ctx2d.fillRect(0, 0, cv.width, cv.height);
  ctx2d.setTransform(v.s, 0, 0, v.s, -v.x0 * v.s, -v.y0 * v.s);
  const noST = (typeof ST === "undefined" || !ST);
  const H2LFL = FB_live("H2_LFL", 0.04), O2LOC = FB_live("O2_LOC", 0.05);
  const O2F0 = FB_live("O2_FRAC0", 0.2095), RP0 = FB_live("ROOM_P0", 101.3);
  const VCELL = FB_live("ROOM_VCELL", 0.1);
  const fH2 = has("eRoomH2Frac") ? eRoomH2Frac : null;
  const fO2 = has("eRoomO2Frac") ? eRoomO2Frac : null;
  const fCO = has("eRoomCOFrac") ? eRoomCOFrac : null;
  const fCO2 = has("eRoomCO2Frac") ? eRoomCO2Frac : null;
  const fWT = has("eRoomWaterT") ? eRoomWaterT : null;
  const fPT = has("eRoomPoolT") ? eRoomPoolT : null;
  const fPL = has("roomPoolLit") ? roomPoolLit : null;
  const fCT = has("eRoomCorT") ? eRoomCorT : null;
  const heatOf = has("heatOf") ? window.heatOf || null : null;
  const HEATZ = FB_live("HEATZ", null), BLASTZ = FB_live("BLASTZ", null);
  const heatIx = (typeof heatOf === "function") ? heatOf : (t => t < 310 ? 0 : t < 340 ? 1 : t < 400 ? 2 : t < 600 ? 3 : 4);
  const blastIx = (typeof blastOf === "function") ? blastOf
    : (p => { if(!BLASTZ) return 0; for(let k = 0; k < BLASTZ.length; k++) if(p < BLASTZ[k].t) return k; return BLASTZ.length - 1; });
  const cellPx = CELL * v.s / (window.devicePixelRatio || 1);
  const showVal = cellPx > 24;

  for(let Y = 0; Y < Hh; Y++){
    const y = rowTop(Y), h = rowTop(Y + 1) - y;
    for(let X = 0; X < W; X++){
      const i = Y * W + X, x = GX + X * CELL;
      ctx2d.strokeStyle = "rgba(95,210,226,.10)";
      ctx2d.lineWidth = Math.max(1, CELL * 0.008);
      ctx2d.strokeRect(x, y, CELL, h);
      if(noST) continue;
      const T = num(ST.roomT && ST.roomT[i], NaN);
      /* TEMP band (live HEATZ) + value */
      if(FB_layerOn("temp") && isFinite(T)){
        const z = (HEATZ && HEATZ[heatIx(T)]) || {col:"#5fd2e2", a:0.12};
        ctx2d.globalAlpha = 0.20; ctx2d.fillStyle = z.col;
        ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1;
        if(showVal){ ctx2d.fillStyle = "#dff0f3"; ctx2d.font = "30px monospace";
          ctx2d.textAlign = "center"; ctx2d.fillText(T.toFixed(0), x + CELL / 2, y + 38); }
      }
      /* PRESSURE value */
      if(FB_layerOn("press") && ST.roomP){
        const p = num(ST.roomP[i], 0);
        if(showVal){ ctx2d.fillStyle = Math.abs(p) >= 50 ? "#ff5a45" : "#9fb4b9";
          ctx2d.font = "26px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText(p.toFixed(1), x + CELL / 2, y + h - 8); }
      }
      /* H2 % (live flammability edge) */
      if(FB_layerOn("h2") && fH2){
        const f = fH2(i);
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
      /* O2 % (depletion only, live LOC) */
      if(FB_layerOn("o2") && fO2){
        const f = fO2(i);
        if(showVal){ ctx2d.fillStyle = f < O2LOC ? "#5aa9d6" : "#5d7378";
          ctx2d.font = "26px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText((f * 100).toFixed(1), x + CELL / 2, y + h / 2 + 9); }
        if(f < O2LOC){ ctx2d.globalAlpha = 0.35; ctx2d.fillStyle = "#5aa9d6";
          ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1; }
      }
      /* STEAM kg */
      if(FB_layerOn("vap") && ST.roomVap && showVal){
        const m = num(ST.roomVap[i], 0);
        if(m > 1e-6){ ctx2d.fillStyle = "#9fb4b9"; ctx2d.font = "24px monospace";
          ctx2d.textAlign = "center"; ctx2d.fillText(m.toFixed(2), x + CELL / 2, y + h / 2 + 8); }
      }
      /* GAS kg */
      if(FB_layerOn("gas") && ST.roomM && showVal){
        ctx2d.fillStyle = "#5d7378"; ctx2d.font = "24px monospace"; ctx2d.textAlign = "center";
        ctx2d.fillText(num(ST.roomM[i], 0).toFixed(2), x + CELL / 2, y + h - 34);
      }
      /* WATER kg + T */
      if(FB_layerOn("water") && ST.roomWater){
        const m = num(ST.roomWater[i], 0);
        if(m >= 0.01){
          const f = Math.min(1, m / (1000 * VCELL));
          ctx2d.globalAlpha = 0.55; ctx2d.fillStyle = "#5aa9d6";
          ctx2d.fillRect(x, y + h * (1 - f), CELL, h * f); ctx2d.globalAlpha = 1;
          if(showVal){ ctx2d.fillStyle = "#dff0f3"; ctx2d.font = "24px monospace";
            ctx2d.textAlign = "center";
            ctx2d.fillText(m.toFixed(1) + (fWT ? " " + fWT(i).toFixed(0) + "K" : ""), x + CELL / 2, y + h - 8); }
        }
      }
      /* METAL POOL */
      if(FB_layerOn("pool") && ST.roomPool){
        const m = num(ST.roomPool[i], 0);
        if(m >= 0.01){
          const lit = fPL && ST ? !!fPL(ST, i) : false;
          ctx2d.globalAlpha = 0.6; ctx2d.fillStyle = lit ? "#f0a830" : "#6d8f98";
          ctx2d.fillRect(x, y + h * 0.5, CELL, h * 0.5); ctx2d.globalAlpha = 1;
          if(showVal){ ctx2d.fillStyle = lit ? "#f0a830" : "#dff0f3";
            ctx2d.font = "24px monospace"; ctx2d.textAlign = "center";
            ctx2d.fillText(m.toFixed(1) + (fPT && ST ? " " + fPT(ST, i).toFixed(0) + "K" : ""), x + CELL / 2, y + 30); }
        }
      }
      /* CORIUM t + T */
      if(FB_layerOn("cor") && ST.roomCorF){
        const m = num(ST.roomCorF[i], 0) + num(ST.roomCorK[i], 0) + num(ST.roomCorS[i], 0);
        if(m >= 1){
          ctx2d.globalAlpha = 0.6; ctx2d.fillStyle = "#ff7a2a";
          ctx2d.fillRect(x, y + h * 0.4, CELL, h * 0.6); ctx2d.globalAlpha = 1;
          if(showVal){ ctx2d.fillStyle = "#ffd27a"; ctx2d.font = "24px monospace";
            ctx2d.textAlign = "center";
            ctx2d.fillText((m / 1000).toFixed(2) + "t" + (fCT ? " " + fCT(i).toFixed(0) + "K" : ""), x + CELL / 2, y + 30); }
        }
      }
      /* FLAME */
      if(FB_layerOn("flame") && ST.roomFlame && ST.roomFlame[i] > 0){
        ctx2d.globalAlpha = 0.75; ctx2d.fillStyle = "#ffd27a";
        ctx2d.fillRect(x + CELL * 0.2, y + h * 0.2, CELL * 0.6, h * 0.6); ctx2d.globalAlpha = 1;
      }
      /* BLAST PEAK (live BLASTZ) + value */
      if(FB_layerOn("blast") && ST.roomPPk){
        const p = num(ST.roomPPk[i], 0);
        if(p >= 5){
          const z = (BLASTZ && BLASTZ[blastIx(p)]) || {col:"#ff5a45", a:0.3};
          ctx2d.globalAlpha = 0.35; ctx2d.fillStyle = z.col;
          ctx2d.fillRect(x, y, CELL, h); ctx2d.globalAlpha = 1;
        }
        if(showVal && p >= 0.5){ ctx2d.fillStyle = p >= 15 ? "#ff5a45" : "#5d7378";
          ctx2d.font = "24px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText(p.toFixed(0), x + CELL / 2, y + 30); }
      }
      /* CO / CO2 % */
      if(FB_layerOn("co") && (fCO || fCO2) && showVal){
        const a = fCO ? fCO(i) * 100 : 0, b = fCO2 ? fCO2(i) * 100 : 0;
        if(a >= 0.05 || b >= 0.05){ ctx2d.fillStyle = "#9fb4b9";
          ctx2d.font = "22px monospace"; ctx2d.textAlign = "center";
          ctx2d.fillText(a.toFixed(1) + "/" + b.toFixed(1), x + CELL / 2, y + h / 2 + 8); }
      }
      void O2F0; void RP0;
    }
  }
  /* walls (live paint where available) */
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
  /* hover */
  if(FB.hover >= 0){
    const X = FB.hover % W, Y = (FB.hover / W) | 0;
    ctx2d.strokeStyle = "#f0a830"; ctx2d.lineWidth = Math.max(2, CELL * 0.02);
    ctx2d.strokeRect(GX + X * CELL + 2, rowTop(Y) + 2, CELL - 4, rowTop(Y + 1) - rowTop(Y) - 4);
  }
  ctx2d.setTransform(1, 0, 0, 1, 0, 0);
}

/* ---------- readouts ---------- */
function FB_fmtT(t){ return isFinite(t) ? t.toFixed(0) + " K" : "-"; }
function FB_read(){
  const box = $("fb-read");
  if(!box) return;
  if(typeof ST === "undefined" || !ST || FB.hover < 0){ box.textContent = "hover the grid"; return; }
  const [W] = FB_cellWH(), i = FB.hover;
  const L = [];
  L.push("CELL " + (i % W) + "," + ((i / W) | 0));
  if(ST.roomT) L.push("AIR  " + FB_fmtT(ST.roomT[i]));
  if(ST.roomP) L.push("P    " + num(ST.roomP[i], 0).toFixed(2) + " kPa  (pk " + num(ST.roomPPk && ST.roomPPk[i], 0).toFixed(1) + ")");
  try{ if(has("eRoomH2Frac")) L.push("H2   " + (eRoomH2Frac(i) * 100).toFixed(2) + " %"); }catch(e){}
  try{ if(has("eRoomO2Frac")) L.push("O2   " + (eRoomO2Frac(i) * 100).toFixed(2) + " %"); }catch(e){}
  if(ST.roomVap) L.push("STEAM " + num(ST.roomVap[i], 0).toFixed(3) + " kg");
  if(ST.roomM) L.push("GAS   " + num(ST.roomM[i], 0).toFixed(3) + " kg");
  if(ST.roomWater){
    let s = "WATER " + num(ST.roomWater[i], 0).toFixed(1) + " kg";
    try{ if(has("eRoomWaterT") && ST.roomWater[i] > 0) s += "  " + eRoomWaterT(i).toFixed(0) + " K"; }catch(e){}
    L.push(s);
  }
  if(ST.roomPool && num(ST.roomPool[i], 0) >= 0.01){
    let s = "POOL  " + num(ST.roomPool[i], 0).toFixed(1) + " kg";
    try{ if(has("eRoomPoolT")) s += "  " + eRoomPoolT(ST, i).toFixed(0) + " K"; }catch(e){}
    try{ if(has("roomPoolLit") && roomPoolLit(ST, i)) s += "  BURNING"; }catch(e){}
    L.push(s);
  }
  if(ST.roomCorF){
    const m = num(ST.roomCorF[i], 0) + num(ST.roomCorK[i], 0) + num(ST.roomCorS[i], 0);
    if(m >= 1){ let s = "CORIUM " + (m / 1000).toFixed(2) + " t";
      try{ if(has("eRoomCorT")) s += "  " + eRoomCorT(i).toFixed(0) + " K"; }catch(e){}
      L.push(s); }
  }
  if(ST.roomFlame && ST.roomFlame[i] > 0) L.push("FLAME BURNING");
  try{ if(has("eRoomCOFrac") && eRoomCOFrac(i) >= 5e-4) L.push("CO   " + (eRoomCOFrac(i) * 100).toFixed(2) + " %"); }catch(e){}
  try{ if(has("eRoomCO2Frac") && eRoomCO2Frac(i) >= 5e-4) L.push("CO2  " + (eRoomCO2Frac(i) * 100).toFixed(2) + " %"); }catch(e){}
  box.textContent = L.join("\n");
}
function FB_totals(){
  const box = $("fb-tot");
  if(!box || typeof ST === "undefined" || !ST) return;
  const [W, Hh] = FB_cellWH(), N = W * Hh;
  let m = 0, h2 = 0, o2 = 0, vap = 0, wat = 0, pool = 0, pk = 0, mx = -1e9;
  for(let i = 0; i < N; i++){
    m += num(ST.roomM && ST.roomM[i], 0); h2 += num(ST.roomH2 && ST.roomH2[i], 0);
    o2 += num(ST.roomO2 && ST.roomO2[i], 0); vap += num(ST.roomVap && ST.roomVap[i], 0);
    wat += num(ST.roomWater && ST.roomWater[i], 0); pool += num(ST.roomPool && ST.roomPool[i], 0);
    if(ST.roomP && ST.roomP[i] > pk) pk = ST.roomP[i];
    if(ST.roomT && ST.roomT[i] > mx) mx = ST.roomT[i];
  }
  let t = "-";
  try{ if(has("SC_T") && ST.sc) t = "T+" + num(ST.sc[SC_T], 0).toFixed(2) + " s"; }catch(e){}
  box.textContent = t + "   gas " + m.toFixed(1) + " kg   H2 " + h2.toFixed(2) +
    "   O2 " + o2.toFixed(1) + "   vap " + vap.toFixed(2) +
    "\nwater " + wat.toFixed(0) + " kg   pool " + pool.toFixed(1) +
    "   pk " + pk.toFixed(1) + " kPa   maxT " + FB_fmtT(mx);
  const clk = $("fb-clock");
  if(clk) clk.textContent = t;
}

/* ---------- main loop: live step, our frame ---------- */
let FB_frame = 0;
function FB_tick(){
  requestAnimationFrame(FB_tick);
  FB_frame++;
  try{
    if(FB.playing && typeof step === "function" && typeof ST !== "undefined" && ST){
      const n = FB.speeds[FB.speedIx] || 1;
      if(n >= 200){ const t0 = performance.now();
        for(let k = 0; k < 400 && performance.now() - t0 < 12; k++){ step(0.02); }
      }
      else for(let k = 0; k < n; k++){ step(0.02); }
    }
  }catch(e){ if(FB_frame % 60 === 1) sayErr("step: " + (e && e.message || e)); }
  try{ FB_draw(); }catch(e){ if(FB_frame % 60 === 1) sayErr("draw: " + (e && e.message || e)); }
  if(FB_frame % 6 === 0){ try{ FB_read(); FB_totals(); }catch(e){} }
}

/* ---------- wire UI ---------- */
function FB_wire(){
  FB_fit();
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
    try{ if(typeof step === "function"){ step(0.02); } }catch(e){ sayErr("step: " + (e && e.message || e)); }
  };
  $("fb-reset").onclick = () => FB_boot();
  const labs = ["1x", "4x", "20x", "MAX"];
  $("fb-speed").oninput = e => {
    FB.speedIx = +e.target.value || 0;
    $("fb-speedlab").textContent = labs[FB.speedIx] || "";
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
