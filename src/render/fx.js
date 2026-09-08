"use strict";
const FX_MAX = 14;                 // particles at rate 1, before the caller's own cap
const FX_MIN = 0.02;

function fxHash(i){
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// a fixed arbitrary angle per machine, in turns: shaft rate is shared per kind, so stopping them all at 0 reads as deliberate
function fxIdPhase(id){
  let h=0;
  for(let i=0;i<id.length;i++) h=Math.imul(h^id.charCodeAt(i),0x01000193);
  return fxHash(h>>>0);
}
// display clock runs on wall seconds times the tape's SET rate; a null rate is unbounded and the only measured case
const FX_SLIP = 0.5;
let FXT = 0, FXSRC = null, FXW = 0, FXRATE = 0, FXDT = 0, FXFRAME = null;
const fxWall = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
const fxSetFrame = w => { FXFRAME = w; };
function fxSetClock(t, rate){
  const w = FXFRAME === null ? fxWall() : FXFRAME;
  const dw = FXSRC === null ? 0 : clamp(w - FXW, 0, 0.25);
  const meas = rate === null || rate === undefined;
  if(meas && dw > 0) FXRATE += ((t - FXSRC)/dw - FXRATE) * (1 - Math.exp(-dw/0.25));
  const r = meas ? FXRATE : Math.max(0, rate);
  FXW = w; FXSRC = t;
  FXDT = dw * r;
  FXT += FXDT;
  if(!isFinite(t) || Math.abs(t - FXT) > FX_SLIP*Math.max(1, r)){ FXT = t; FXDT = 0; }
}
const fxClock = () => FXT;
const fxDt = () => FXDT;
// fractional on purpose: the caller ceils it and fades the last particle by the remainder
const fxN = (rate, max) => clamp(rate, 0, 1) * (max || FX_MAX);

// for callers standing in plant space rather than inside symAt(): anchor in plant units, body in cell units
function fxCellSpace(x, y, fn){
  ctx.save();
  ctx.translate(x, y); ctx.scale(DRAW_K, DRAW_K);
  fn();
  ctx.restore();
}

// an eased rate is display state, so it is not on S and whoever moves the clock clears it by hand
const FXR={};
const FX_EASE=2.2;                 // how fast a rate change closes, per second
function fxReset(){ for(const k in FXR) delete FXR[k]; }
function fxEase(id,rate){
  const now=fxClock(), st=FXR[id];
  if(!st){ FXR[id]={v:rate,t:now}; return rate; }
  const dt=clamp(now-st.t,0,0.25); st.t=now;
  st.v=approach(st.v,rate,dt,FX_EASE);
  return st.v;
}

// `seed` separates two jets sharing a box, or they animate in lockstep and read as one
function fxJet(cx, cy, spread, rate, col, dx, dy, seed){
  if(rate < FX_MIN) return;
  const r0 = clamp(rate, 0, 1), n = Math.max(2, fxN(rate)), N = Math.ceil(n);
  const t = fxClock(), reach = 8 + 30 * r0, k = seed || 0;
  const nx = -dy, ny = dx;
  ctx.save();
  ctx.fillStyle = col || "#cfe6ea";
  for(let i = 0; i < N; i++){
    const a = fxHash(i + k), b = fxHash(i + k + 977), sp = 0.35 + 0.55 * a;
    const ph = ((t * sp + b) % 1);
    const off = (b - 0.5) * spread * (0.3 + 1.4 * ph), d = ph * reach;
    const px = cx + dx * d + nx * off, py = cy + dy * d + ny * off;
    const r = (0.8 + 2.6 * ph) * (0.6 + 0.7 * a);
    ctx.globalAlpha = 0.55 * (1 - ph) * r0 * Math.min(1, n - i);
    ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
  }
  ctx.restore();
}
const fxSteam = (cx, y, w, rate, col, seed) => fxJet(cx, y, w, rate, col, 0, -1, seed);

const FXBUB={
  chan:{rise:26, n:20, r:[0.50,0.90], grow:0,   lane:9, wob:0.4, fill:0},
  pool:{rise:18, n:10, r:[1.00,1.80], grow:0.9, lane:0, wob:1.6, fill:1}
};

function fxBubbles(x, y, w, h, rate, col, style){
  if(rate < FX_MIN || w <= 0 || h <= 0) return;
  const B = FXBUB[style] || FXBUB.chan;
  const n = Math.max(2, fxN(rate, B.n)), N = Math.ceil(n), t = fxClock();
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = col || "#cfe6ea"; ctx.fillStyle = col || "#cfe6ea"; ctx.lineWidth = 0.8;
  const L = B.lane ? Math.max(2, Math.round(w / B.lane)) : 0;
  for(let i = 0; i < N; i++){
    const a = fxHash(i * 3 + 1), b = fxHash(i * 3 + 2), c = fxHash(i * 3 + 3);
    // a real climb speed converted into this box's phase, so a rate change never teleports a bubble
    const sp = B.rise * (0.55 + 0.9 * a) / h;
    const ph = ((t * sp + b) % 1);
    const py = y + h - ph * h;
    const px0 = L ? x + w * ((Math.floor(c * L) + 0.5) / L) : x + w * (0.08 + 0.84 * c);
    const px = px0 + Math.sin((t * 2 + b * 9)) * w * 0.05 * B.wob;
    const r = (B.r[0] + B.r[1] * clamp(rate, 0, 1)) * (0.5 + 0.8 * a) * (1 + B.grow * ph);
    // a filled blob carries more ink than a ring of the same size, so it is taken down to match
    ctx.globalAlpha = (B.fill ? 0.75 : 1) *
      (0.28 + 0.5 * clamp(rate, 0, 1) * (1 - ph * 0.55)) * Math.min(1, n - i);
    ctx.beginPath(); ctx.arc(px, py, r, 0, 7);
    if(B.fill) ctx.fill(); else ctx.stroke();
  }
  ctx.restore();
}

function fxSparks(x, y, w, h, rate, col){
  if(rate < FX_MIN || w <= 0 || h <= 0) return;
  const n = Math.max(1, fxN(rate, 5)), N = Math.ceil(n), t = fxClock(), k = 0;
  ctx.save();
  ctx.strokeStyle = col || C.amber; ctx.lineWidth = 1; ctx.lineCap = "round";
  for(let i = 0; i < N; i++){
    const a = fxHash(i * 5 + 7 + k), b = fxHash(i * 5 + 8 + k), c = fxHash(i * 5 + 9 + k);
    const ph = ((t * (1.4 + 2.2 * a) + b) % 1);
    if(ph > 0.13) continue;
    const px = x + w * (0.15 + 0.7 * b), py = y + h * (0.15 + 0.7 * c);
    const len = 2 + 4 * a, ang = c * 6.28;
    ctx.globalAlpha = 0.9 * Math.min(1, n - i);
    ctx.beginPath(); ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len); ctx.stroke();
  }
  ctx.restore();
}

function fxPulse(x, y, w, h, col, rate, hz){
  if(rate < FX_MIN || w <= 0 || h <= 0) return;
  const t = fxClock(), k = 0.5 + 0.5 * Math.sin(t * 6.28 * (hz || 1.1));
  ctx.save();
  ctx.globalAlpha = (0.18 + 0.42 * k) * clamp(rate, 0, 1);
  fillRect(x, y, w, h, col);
  ctx.restore();
}
