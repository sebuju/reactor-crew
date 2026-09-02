"use strict";
/* radiation field model - see .claude/CLAUDE.md

   A dose rate is not read off the arrangement's bounding box any more, it is
   SOLVED: every source cell casts a 1/r^2 field, attenuated by the exact
   chord length it travels through every cell between source and target
   (Amanatides-Woo DDA over the same occupancy grid the pipe router builds).
   THERE IS NO SEPARATE LINE-OF-SIGHT TEST - attenuation past open cells
   (mu=1) is 1, attenuation past a shield (mu=0.18) is 0.18 per cell of chord
   crossed, and a shield only half in the beam attenuates by the fraction of
   its own width the ray actually clips. A boolean test cannot do that: it
   can only ever answer "blocked" or "clear", and a shield straddling the ray
   is honestly both, depending which half of its footprint you ask about.
   Degrading gracefully instead of switching is the whole point of doing this
   as a field. */

// FITTED: chosen so a default PWR's P.dose lands on 0.0486, the figure every
// release-rate line in step.js (~713, ~777) was already tuned against before
// this field existed. Changing this number rescales EVERY release figure in
// the game - re-derive it (fit against layoutMetrics().dose headless, see
// the auditor block) rather than picking a rounder one.
const RAD_K = 7.1583;

/* Source strengths against the core's own 1.0 (radSrc(null)), and every one of
   them is GAME BALANCE picked to make a hazard readable, not a measured yield:
   a breached vessel shines 3x the intact core, a melt 4x, a ruptured tube 1.2x,
   damage 0.06 per unit, and RAD_AIR is the unshielded airborne floor. */
const RAD_BREACH=3.0, RAD_DMG=0.06, RAD_MELT=4.0, RAD_SGTR=1.2, RAD_AIR=0.05;
// A fresh constant, not a re-derivation of an existing figure: nothing
// documented depends on its exact value, only on the tank getting hotter as
// it fills, which any positive number gives it. Scaled the same shape as
// RAD_DMG against a tank level (0..100, step.js) rather than fitted against a
// pinned dose the way RAD_K was.
const RAD_TANK=0.03;
/* PER PIPE CELL of primary, for a coolant the fuel is dissolved in
   (COOLANT[].fuelInCoolant - molten salt, and nothing else). Additive at its
   own constant like RAD_TANK: RAD_K is NOT re-fitted for it, and a water
   plant never reaches it at all, so P.dose for a PWR does not move.
   0.01 against the core's 1.0 means the stock plant's ~80 cells of primary
   shine like most of another core, spread along the loop instead of sitting
   at one point - which is the whole claim, that an MSR's circuit is hot and
   not just its vessel. */
const RAD_PIPE=0.01;
const RAD_HI=1.0, RAD_FLOOR=0.02, RAD_CEIL=3;

// Keyed on WHAT the component IS - ROLE.mu (layout.js), never on p.grp or
// p.id: `cont` and `hpi` are both grp:"safety", and exactly one of them is a
// wall. A part with no role (should not happen - every add() in
// buildLayout() and the one placeable part, design-bench.js, carries one)
// falls back to the same 0.75 ordinary equipment already reads, rather than
// inventing a shield out of an unnamed part.
function radMu(p){
  if(!p) return 1;
  const R = ROLE[p.role];
  return (R && R.mu !== undefined) ? R.mu : 0.75; // DEFAULT: no role declared - see ROLE's own comment on why this must not read as a shield
}

/* Transmission along the straight source->target line, by the EXACT chord
   each grid cell contributes (Amanatides-Woo DDA, the same stepping a voxel
   ray-tracer uses). The source's own cell is skipped - self-shielding
   already lives in the source strength, not the ray - and this loop IS the
   line-of-sight test; there is no separate boolean check anywhere else. */
function radRay(g,x0,y0,x1,y1){
  const dx=x1-x0, dy=y1-y0, L=Math.hypot(dx,dy);
  if(L<1e-6) return 1;
  let T=1, x=Math.floor(x0), y=Math.floor(y0), s=0, first=true;
  const sx=dx>=0?1:-1, sy=dy>=0?1:-1;
  const tdx=Math.abs(L/(dx||1e-9)), tdy=Math.abs(L/(dy||1e-9));
  let tx=(dx>0?(x+1-x0):(x0-x))*tdx, ty=(dy>0?(y+1-y0):(y0-y))*tdy;
  let guard=0;
  while(s<L-1e-9 && guard++<200){
    const nxt=Math.min(tx,ty,L), seg=nxt-s;
    if(!first && x>=0&&x<GW && y>=0&&y<GH){
      const m=radMu(g[y][x]); if(m<1) T*=Math.pow(m,seg);
    }
    first=false; s=nxt;
    if(tx<ty){ x+=sx; tx+=tdx; } else { y+=sy; ty+=tdy; }
  }
  return T;
}

// r^-2 falloff (Euclidean, floored at 0.7 cells so a source cell never
// divides by ~0), times the ray transmission above. One kernel per source
// point, reused against every source strength that point ever casts.
function radKernel(g,cx,cy){
  const k=new Float64Array(GW*GH);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++){
    const tx=X+0.5, ty=Y+0.5, r=Math.max(Math.hypot(tx-cx,ty-cy),0.7);
    k[Y*GW+X]=RAD_K/(r*r)*radRay(g,cx,cy,tx,ty);
  }
  return k;
}

/* MEMOISED ON THE ARRANGEMENT ONLY, via laySig() (layout.js). layoutMetrics()
   runs every frame on both screens and D changes on every bench slider tick -
   far more often than a component moves - so keying this cache on designSig()
   would rebuild every kernel on every tick for nothing. laySig() maps over
   the live LAY.parts, which is also why it covers PLACED parts (spare pumps,
   junctions): they appear and vanish at runtime and are never a D field at
   all, but they are always in LAY.parts. */
let radCache=null, radCacheSig="";
function radGeom(){
  // pipeSig() as well: the primary circuit is a source now (K.pipe, below),
  // so laying a cell of pipe moves the field the same way sliding a shield does
  const sig=laySig()+"|"+pipeSig();
  if(radCache && radCacheSig===sig) return radCache;
  /* A BLANK GRID HAS NEITHER VESSEL NOR CONTROL STATION. The field is still
     solved - there is simply nothing shining and nowhere the crew stand, and
     radSrc() answers 0 for a core that is not there. */
  const g=occupied(null), core=roleOf("core"), cc=core?cen(core):{x:GW/2,y:GH/2};
  const K={core:radKernel(g,cc.x,cc.y), sg:[], tank:[],
           crew:roleOf("ctrl")||core};
  for(const p of LAY.parts) if(p.role==="sg"){
    const c=cen(p); K.sg.push(radKernel(g,c.x,c.y));
  }
  /* ONE KERNEL PER TANK, following K.sg's existing shape rather than
     inventing a second one. Unlike a generator, each tank shines at its own
     strength (its level and what is in it - radSrc(), below), so the id
     rides along and the strengths arrive as a map keyed the same way. */
  for(const p of LAY.parts) if(p.role==="tank"){
    const c=cen(p); K.tank.push({id:p.id, k:radKernel(g,c.x,c.y)});
  }
  /* ONE SUMMED KERNEL over every cell of primary pipe, not one kernel per
     cell: a hundred kernels would be a hundred terms in radSolve()'s inner
     loop every frame, and every one of them casts the same strength, so they
     can be added once at build time instead. More metres of primary is more
     source, deliberately unnormalised - that is what makes siting a salt
     plant's pipework a design problem.
     LAZY, because building it is ~80 DDA sweeps and only a fuel-in-coolant
     plant ever asks. A water plant pays nothing, and the getter caches onto
     K so a salt plant pays once per arrangement, not once per frame. */
  let pk=null;
  Object.defineProperty(K,"pipe",{get(){
    if(pk) return pk;
    pk=new Float64Array(GW*GH);
    for(const r of pipeNetwork()){ if(!PRIMARY_K[r.k]||!r.cells) continue;
      for(const [x,y] of r.cells){ const k=radKernel(g,x+0.5,y+0.5);
        for(let i=0;i<pk.length;i++) pk[i]+=k[i]; } }
    return pk;
  }});
  radCache=K; radCacheSig=sig;
  return K;
}

/* THE ONE ACCESSOR, LIVE OR PREDICTED - the same trick coreView() plays in
   core2d.js, so the bench and the panel can never read two different source
   models for the same field. With no live state (the design bench) it
   returns {core:1, sg:0, air:0}: "what does this arrangement shine like at
   rating" is a design question with a design answer.
   DO NOT SCALE THE DESIGN SOURCE TERM BY P.rated OR P.n0. It is only safe to
   put an annunciator threshold on a raw dose reading at all because this
   term is 1 by fiat - that is what makes P.dose a purely geometric number,
   comparable across every architecture regardless of rated power. */
function radSrc(L){
  if(!L) return {core:1, sg:0, air:0, pipe:pipeSrc(1)};
  /* contRel and catcher are COMMISSIONING facts and live on P, never on S -
     reading them off the live state instead returned undefined, which made
     s.doseRate NaN the instant fuel failed and every readout downstream with
     it. A source term asks the design what it was built with and the state
     only what it is doing. */
  /* The melt term takes HOW MUCH is molten instead of a latch. A fully molten
     core shines exactly what it always did, so nothing re-pins - what moved is
     the approach to it, where a core 3 % molten and one 90 % molten used to be
     the same picture. RAD_DMG and RAD_MELT both keep their exact meanings, and
     s.melt stays the latch for the banner, the trend and the event log: latch
     for the story, field for the physics. */
  return {core:(L.n*PROMPT_F+L.decay)*(L.breach?RAD_BREACH:1) + RAD_DMG*L.dmg*P.contRel
              + (!P.catcher?RAD_MELT*L.meltFrac:0),
          sg: L.sgtr?RAD_SGTR:0,
          /* EVERY tank, at its own strength: how much is in it times how
             active what is in it IS (FLUID.act). Water, borated water and
             condensate all read 0, so a plant full of tanks is still dark at
             rest and P.dose stays a purely geometric figure - a tank only
             shines once something has actually put activity in it. */
          tank: (()=>{ const q={};
            for(const id in (L.tank||{})) q[id] = RAD_TANK*L.tank[id]*tankFluid(id).act;
            return q; })(),
          // Airborne activity is a FLOOR ON EVERY CELL and is NOT shielded at
          // all - this is the containment argument made picture-shaped.
          // What has already escaped the primary boundary is loose in the
          // compartment's air, not sitting at a point inside it that a wall
          // can stand between; a shield stops a ray from a source, not a gas
          // the room is already full of.
          air:RAD_AIR*L.release,
          pipe:pipeSrc(L.n)};
}
// In a molten salt plant the fuel is DISSOLVED in the coolant, so the whole
// primary circuit shines and it shines with power, not with damage. Every
// other coolant reads 0 and never touches K.pipe at all.
const pipeSrc = n => COOLANT[D.cool].fuelInCoolant ? RAD_PIPE*n : 0;

function radSolve(K,q){
  const f=new Float64Array(GW*GH);
  const Kp = q.pipe ? K.pipe : null;   // asking for it is what builds it
  for(let i=0;i<f.length;i++){
    let v=q.air + q.core*K.core[i];
    if(q.sg) for(const k of K.sg) v+=q.sg*k[i];
    if(q.tank) for(const t of K.tank){ const w=q.tank[t.id]; if(w) v+=w*t.k[i]; }
    if(q.pipe) v+=q.pipe*Kp[i];
    f[i]=v;
  }
  return f;
}

// The worst seat inside the component's own footprint, clamped so nothing
// downstream ever has to defend against a value it was not written for.
/* A PLACE THAT IS NOT ON THE DRAWING READS THE FLOOR. A blank grid has no
   control station, so there is nowhere for the crew to take a dose. */
function radAt(f,p){
  if(!p) return RAD_FLOOR;
  let v=0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH) v=Math.max(v,f[Y*GW+X]);
  return clamp(v,RAD_FLOOR,RAD_CEIL);
}

// The COLDEST free adjacent cell (freeAdj(), layout.js): a repair party is
// not stupid, it approaches from behind whatever shielding is actually
// there. That is the reward for siting a shield somewhere it helps, rather
// than merely somewhere inside a bounding box.
// `p.stand` is the escape hatch for a thing that is not a rectangle: a pipe
// run is a polyline, so it brings its own list of cells a party could stand
// in and freeAdj() is never asked to make sense of a w/h it does not have.
// One accessor either way - the alternative was a second copy of the two
// lines below, which is how a run and a component start disagreeing about
// what standing next to something costs.
function radParty(f,p,g){
  const a=(p&&p.stand)||freeAdj(p,g); if(!a.length) return RAD_CEIL;
  let v=1e9; for(const c of a) v=Math.min(v,f[c[1]*GW+c[0]]);
  return clamp(v,RAD_FLOOR,RAD_CEIL);
}

// The hottest cell any repair party could ever be asked to stand in, over
// every non-shield component on the plant.
function radPeak(f){
  const g=occupied(null); let v=RAD_FLOOR, who=null;
  for(const p of LAY.parts){ if(p.grp==="shield") continue;
    for(const c of freeAdj(p,g)){ const q=f[c[1]*GW+c[0]]; if(q>v){v=q;who=p;} } }
  return {v:clamp(v,RAD_FLOOR,RAD_CEIL), who};
}

// Every cell any repair party could ever stand in - the survey-map "where
// can I send people" question, for a renderer to outline.
function partyCells(){
  const g=occupied(null), s=new Set();
  for(const p of LAY.parts){ if(p.grp==="shield") continue;
    for(const c of freeAdj(p,g)) s.add(c[1]*GW+c[0]); }
  return s;
}
