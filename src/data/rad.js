"use strict";
// FITTED so a default PWR's P.dose lands on 0.0486; moving it rescales every release figure in the game.
const RAD_K = 7.1583;

/* Balance figures against the core's own 1.0 (radSrc(null)), not measured yields. */
const RAD_BREACH=3.0, RAD_DMG=0.06, RAD_MELT=4.0, RAD_SGTR=1.2, RAD_AIR=0.05;
const RAD_TANK=0.03;
// per pipe cell of primary, for a coolant the fuel is dissolved in
const RAD_PIPE=0.01;
const RAD_HI=1.0, RAD_FLOOR=0.02, RAD_CEIL=3;

/* Paint first: a painted cell may also carry a machine's box, and the strongest thing in it is what the ray meets. */
function radMu(p){
  if(!p) return 1;
  if(p.mat){ const i=p.id.indexOf(","), m=matOf(+p.id.slice(4,i), +p.id.slice(i+1));
    if(m) return m.mu; }
  const R = ROLE[p.role];
  return (R && R.mu !== undefined) ? R.mu : 0.75; // no role: ordinary equipment, never a shield
}

/* Amanatides-Woo DDA; the source's own cell is skipped because self-shielding lives in the source strength. */
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

// r^-2, floored at 0.7 cells so a source cell never divides by ~0
function radKernel(g,cx,cy){
  const k=new Float64Array(GW*GH);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++){
    const tx=X+0.5, ty=Y+0.5, r=Math.max(Math.hypot(tx-cx,ty-cy),0.7);
    k[Y*GW+X]=RAD_K/(r*r)*radRay(g,cx,cy,tx,ty);
  }
  return k;
}

/* Keyed on the arrangement, never designSig(): D moves on every bench slider tick and would rebuild every kernel. */
let radCache=null, radCacheSig="";
function radGeom(){
  const sig=laySig()+"|"+pipeSig()+matSig();
  if(radCache && radCacheSig===sig) return radCache;
  const g=occupied(null), core=partOf(primaryCore());
  const K={core:[], sg:[], tank:[], crew:roleOf("ctrl")||core};
  for(const id of coreIds()){ const c=cen(partOf(id)); K.core.push({id, k:radKernel(g,c.x,c.y)}); }
  for(const p of LAY.parts) if(p.role==="sg"){
    const c=cen(p); K.sg.push(radKernel(g,c.x,c.y));
  }
  for(const p of LAY.parts) if(p.role==="tank"){
    const c=cen(p); K.tank.push({id:p.id, k:radKernel(g,c.x,c.y)});
  }
  /* Lazy: ~80 DDA sweeps only a fuel-in-coolant plant ever asks for. */
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

/* Never scale the design source term by P.rated or P.n0: 1 by fiat is what makes P.dose purely geometric. */
function radSrc(L){
  if(!L){ const core={}; for(const id of coreIds()) core[id]=1;
    return {core, sg:0, air:0, pipe:pipeSrc(1)}; }
  const core={};
  for(const id of coreIds()){ const c=(L.coreBy&&L.coreBy[id])||L;
    core[id]=(c.n*PROMPT_F+c.decay)*(c.breach?RAD_BREACH:1)
              + RAD_DMG*c.dmg*contRelPart(L, partOf(id))
              + (!P.catcher?RAD_MELT*c.meltFrac:0); }
  return {core,
          sg: L.sgtr?RAD_SGTR:0,
          tank: (()=>{ const q={};
            for(const id in (L.tank||{})) q[id] = RAD_TANK*L.tank[id]*tankFluid(id).act;
            return q; })(),
          /* Unshielded floor on every cell: a shield stops a ray, not a gas the room is already full of. */
          air:RAD_AIR*L.release,
          pipe:pipeSrc(L.n)};
}
const pipeSrc = n => COOLANT[priD().cool].fuelInCoolant ? RAD_PIPE*n : 0;

function radSolve(K,q){
  const f=new Float64Array(GW*GH);
  const Kp = q.pipe ? K.pipe : null;
  const n=f.length, air=q.air;
  for(let i=0;i<n;i++) f[i]=air;
  for(const t of K.core){ const w=q.core[t.id]; if(!w) continue;
    const k=t.k; for(let i=0;i<n;i++) f[i]+=w*k[i]; }
  if(q.sg) for(const k of K.sg){ const w=q.sg; for(let i=0;i<n;i++) f[i]+=w*k[i]; }
  if(q.tank) for(const t of K.tank){ const w=q.tank[t.id]; if(!w) continue;
    const k=t.k; for(let i=0;i<n;i++) f[i]+=w*k[i]; }
  if(q.pipe){ const w=q.pipe; for(let i=0;i<n;i++) f[i]+=w*Kp[i]; }
  return f;
}

function radAt(f,p){
  if(!p) return RAD_FLOOR;
  let v=0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH) v=Math.max(v,f[Y*GW+X]);
  return clamp(v,RAD_FLOOR,RAD_CEIL);
}

// the coldest free adjacent cell: a party approaches from behind whatever shielding is there
function radParty(f,p,g){
  const a=(p&&p.stand)||freeAdj(p,g); if(!a.length) return RAD_CEIL;
  let v=1e9; for(const c of a) v=Math.min(v,f[c[1]*GW+c[0]]);
  return clamp(v,RAD_FLOOR,RAD_CEIL);
}

function radPeak(f){
  const g=occupied(null); let v=RAD_FLOOR, who=null;
  for(const p of LAY.parts){
    for(const c of freeAdj(p,g)){ const q=f[c[1]*GW+c[0]]; if(q>v){v=q;who=p;} } }
  return {v:clamp(v,RAD_FLOOR,RAD_CEIL), who};
}

function partyCells(){
  const g=occupied(null), s=new Set();
  for(const p of LAY.parts){
    for(const c of freeAdj(p,g)) s.add(c[1]*GW+c[0]); }
  return s;
}
