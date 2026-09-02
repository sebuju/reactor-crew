"use strict";
/* Ambient plant effects - steam, bubbles, sparks, glow.

   Every effect here is a pure function of a box, a RATE and the PLANT's clock.
   It reads no sim state, writes none, and rolls no die: placement comes out of
   fxHash(), so the same plant draws the same picture on two machines and a
   headless draw needs no generator (see rng.js - the sim's cursor lives on S
   and an effect must never touch it).

   Rate is always 0..1 and is always the whole scale of the effect. Each caller
   normalises its own quantity ONCE, at the call site, so there is exactly one
   place per effect where "how much is a lot" is decided - and that place is
   next to the physics the number came from.

   Rate owns how many, how big, how bright - never a phase speed. Phase runs off
   the clock over minutes of uptime, so multiplying it by rate meant a
   0.01 rate change moved a bubble's position by whole cycles - it teleported.
   fxBubbles' climb is a real px/s (FXBUB[style].rise) instead. Where a count is fractional
   (n before Math.ceil), the newest particle's alpha is scaled by what is left of
   it, so it fades in rather than popping. fxEase() smooths a rate itself, for a
   caller whose source figure is not already damped. */

const FX_MAX = 14;                 // particles at rate 1, before the caller's own cap
const FX_MIN = 0.02;               // below this a rate draws nothing at all

function fxHash(i){
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/* A STOPPED ROTOR STANDS WHERE IT STOPPED, and not at zero: the shaft angles on
   this plant are ONE rate shared by every machine of a kind (s.spinV,
   s.spinTV), so freezing them all at 0 would park a row of wrecked pumps in
   perfect formation and read as deliberate. A hash of the id is a fixed,
   arbitrary angle per machine - the same one every frame, and on a headless
   draw too. Returns turns, 0..1. */
function fxIdPhase(id){
  let h=0;
  for(let i=0;i<id.length;i++) h=Math.imul(h^id.charCodeAt(i),0x01000193);
  return fxHash(h>>>0);
}
/* ══ THE CLOCK IS THE PLANT'S, NOT THE WALL'S ══
   Steam off a relief valve is the plant doing something, so it has to stop when
   the plant stops and run sixteen times over at 16x - a wall clock did neither,
   and left a paused reactor visibly boiling. Same argument as the damped meters
   in pipes.js, which freeze because their dt comes from S.t.
   Set once a frame by drawPlant(), which is the only thing that knows whether
   there is a plant at all; the bench passes wall seconds so a design preview
   still moves. Fed in rather than read off S, because nothing in a view file may
   reach for sim state - audit-geometry checks that. */
let FXT = 0;
const fxSetClock = t => { FXT = t; };
const fxClock = () => FXT;
const fxWall = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
/* FRACTIONAL on purpose: the caller takes Math.ceil() of this and fades the last
   particle by whatever is left over, so a rising rate grows one in. */
const fxN = (rate, max) => clamp(rate, 0, 1) * (max || FX_MAX);

/* ══ AN EASED RATE IS DISPLAY STATE, SO IT IS NOT ON S ══
   Same standing as the damped meters in pipes.js: a picture of the last few frames,
   not a fact about the plant, so it is not snapshotted and whoever moves the clock
   clears it by hand. Per-key timestamps, so an effect that is skipped for some frames
   still eases correctly the moment it comes back. */
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
  const r0 = clamp(rate, 0, 1), n = Math.max(2, fxN(rate)), N = Math.ceil(n);
  const t = fxClock(), reach = 8 + 30 * r0, k = seed || 0;
  const nx = -dy, ny = dx;                       // across the travel
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
// the common case, and the only one with a name: something venting upward
const fxSteam = (cx, y, w, rate, col, seed) => fxJet(cx, y, w, rate, col, 0, -1, seed);

/* ══ ONE DRAWING, TWO BOILS ══
   A core is a lattice of narrow channels, so its steam rises in fixed lanes and stays
   small; a generator is an open kettle, so its bubbles wander, swell as they climb and
   coalesce on the way up. Written as two functions they would have drifted into two
   different-looking boils. */
const FXBUB={
  chan:{rise:26, n:20, r:[0.50,0.90], grow:0,   lane:9, wob:0.4, fill:0},
  pool:{rise:18, n:10, r:[1.00,1.80], grow:0.9, lane:0, wob:1.6, fill:1}
};
// rise: px/s climbed. n: particles at rate 1. r: [base, perRate] radius terms.
// grow: radius swell across the climb. lane: lane pitch in px, 0 = free placement.
// wob: sideways wobble multiplier. fill: 1 = filled blob, 0 = stroked ring.

/* Bubbles rising inside a vessel, clipped to it. Count and size scale with the
   rate; the wobble is what stops a column of dots reading as a dashed line. */
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
    // a real climb speed converted into this box's phase, so t*sp never outruns a whole
    // cycle just because rate ticked - a rate change used to teleport every bubble
    const sp = B.rise * (0.55 + 0.9 * a) / h;
    const ph = ((t * sp + b) % 1);
    const py = y + h - ph * h;
    const px0 = L ? x + w * ((Math.floor(c * L) + 0.5) / L) : x + w * (0.08 + 0.84 * c);
    const px = px0 + Math.sin((t * 2 + b * 9)) * w * 0.05 * B.wob;
    const r = (B.r[0] + B.r[1] * clamp(rate, 0, 1)) * (0.5 + 0.8 * a) * (1 + B.grow * ph);
    // a filled blob carries more ink than a ring of the same size, so it is taken down
    // to match - at equal alpha a fat one reads as a solid dot
    ctx.globalAlpha = (B.fill ? 0.75 : 1) *
      (0.28 + 0.5 * clamp(rate, 0, 1) * (1 - ph * 0.55)) * Math.min(1, n - i);
    ctx.beginPath(); ctx.arc(px, py, r, 0, 7);
    if(B.fill) ctx.fill(); else ctx.stroke();
  }
  ctx.restore();
}

/* Short bright arcs somewhere in the box - a broken machine that is still
   energised. Deliberately sparse: this decorates damage, it never reports it. */
function fxSparks(x, y, w, h, rate, col){
  if(rate < FX_MIN || w <= 0 || h <= 0) return;
  const n = Math.max(1, fxN(rate, 5)), N = Math.ceil(n), t = fxClock();
  ctx.save();
  ctx.strokeStyle = col || C.amber; ctx.lineWidth = 1; ctx.lineCap = "round";
  for(let i = 0; i < N; i++){
    const a = fxHash(i * 5 + 7), b = fxHash(i * 5 + 8), c = fxHash(i * 5 + 9);
    // each spark is lit for a slice of its own cycle, so they never all flash together
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
