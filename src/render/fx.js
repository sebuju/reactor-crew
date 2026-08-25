"use strict";
/* Ambient plant effects - steam, bubbles, sparks, glow.

   Every effect here is a pure function of a box, a RATE and the wall clock. It
   reads no sim state, writes none, and rolls no die: placement comes out of
   fxHash(), so the same plant draws the same picture on two machines and a
   headless draw needs no generator (see rng.js - the sim's cursor lives on S
   and an effect must never touch it).

   Rate is always 0..1 and is always the whole scale of the effect. Each caller
   normalises its own quantity ONCE, at the call site, so there is exactly one
   place per effect where "how much is a lot" is decided - and that place is
   next to the physics the number came from. */

const FX_MAX = 14;                 // particles at rate 1, before the caller's own cap
const FX_MIN = 0.02;               // below this a rate draws nothing at all

function fxHash(i){
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fxClock = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
const fxN = (rate, max) => Math.round(clamp(rate, 0, 1) * (max || FX_MAX));

/* THE particle jet: puffs leaving (cx, cy) along (dx, dy), widening across that
   direction and fading as they go. Steam out of a relief valve, water falling
   out of an injection line, exhaust crossing a turbine and activity escaping a
   containment are all the same drawing pointed a different way - written four
   times they would have drifted into four different-looking leaks.

   `spread` is the width across the travel; how far a puff gets and how many
   there are both scale with the rate, so a line barely passing reads
   differently from one wide open. `seed` separates two jets sharing a box, or
   they animate in lockstep and read as one. */
function fxJet(cx, cy, spread, rate, col, dx, dy, seed){
  if(rate < FX_MIN) return;
  const n = Math.max(2, fxN(rate)), t = fxClock(), r0 = clamp(rate, 0, 1);
  const reach = 8 + 30 * r0, k = seed || 0;
  const nx = -dy, ny = dx;                       // across the travel
  ctx.save();
  ctx.fillStyle = col || "#cfe6ea";
  for(let i = 0; i < n; i++){
    const a = fxHash(i + k), b = fxHash(i + k + 977), sp = 0.35 + 0.55 * a;
    const ph = ((t * sp + b) % 1);
    const off = (b - 0.5) * spread * (0.3 + 1.4 * ph), d = ph * reach;
    const px = cx + dx * d + nx * off, py = cy + dy * d + ny * off;
    const r = (0.8 + 2.6 * ph) * (0.6 + 0.7 * a);
    ctx.globalAlpha = 0.55 * (1 - ph) * r0;
    ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
  }
  ctx.restore();
}
// the common case, and the only one with a name: something venting upward
const fxSteam = (cx, y, w, rate, col, seed) => fxJet(cx, y, w, rate, col, 0, -1, seed);

/* Bubbles rising inside a vessel, clipped to it. Count and size scale with the
   rate; the wobble is what stops a column of dots reading as a dashed line. */
function fxBubbles(x, y, w, h, rate, col){
  if(rate < FX_MIN || w <= 0 || h <= 0) return;
  const n = Math.max(2, fxN(rate, 18)), t = fxClock();
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = col || "#cfe6ea"; ctx.lineWidth = 0.8;
  for(let i = 0; i < n; i++){
    const a = fxHash(i * 3 + 1), b = fxHash(i * 3 + 2), c = fxHash(i * 3 + 3);
    const sp = 0.25 + 0.45 * a + 0.5 * clamp(rate, 0, 1);
    const ph = ((t * sp + b) % 1);
    const py = y + h - ph * h;
    const px = x + w * (0.08 + 0.84 * c) + Math.sin((t * 2 + b * 9)) * w * 0.05;
    const r = (0.7 + 1.9 * clamp(rate, 0, 1)) * (0.5 + 0.8 * a);
    ctx.globalAlpha = 0.28 + 0.5 * clamp(rate, 0, 1) * (1 - ph * 0.55);
    ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.stroke();
  }
  ctx.restore();
}

/* Short bright arcs somewhere in the box - a broken machine that is still
   energised. Deliberately sparse: this decorates damage, it never reports it. */
function fxSparks(x, y, w, h, rate, col){
  if(rate < FX_MIN || w <= 0 || h <= 0) return;
  const n = Math.max(1, fxN(rate, 5)), t = fxClock();
  ctx.save();
  ctx.strokeStyle = col || C.amber; ctx.lineWidth = 1; ctx.lineCap = "round";
  for(let i = 0; i < n; i++){
    const a = fxHash(i * 5 + 7), b = fxHash(i * 5 + 8), c = fxHash(i * 5 + 9);
    // each spark is lit for a slice of its own cycle, so they never all flash together
    const ph = ((t * (1.4 + 2.2 * a) + b) % 1);
    if(ph > 0.13) continue;
    const px = x + w * (0.15 + 0.7 * b), py = y + h * (0.15 + 0.7 * c);
    const len = 2 + 4 * a, ang = c * 6.28;
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len); ctx.stroke();
  }
  ctx.restore();
}

/* A soft pulse over a box. The one place a "this is live right now" glow is
   drawn, so the melt flicker, a carrying supply and a passing valve all breathe
   at the same speed instead of three hand-picked ones. */
function fxPulse(x, y, w, h, col, rate, hz){
  if(rate < FX_MIN || w <= 0 || h <= 0) return;
  const t = fxClock(), k = 0.5 + 0.5 * Math.sin(t * 6.28 * (hz || 1.1));
  ctx.save();
  ctx.globalAlpha = (0.18 + 0.42 * k) * clamp(rate, 0, 1);
  fillRect(x, y, w, h, col);
  ctx.restore();
}
