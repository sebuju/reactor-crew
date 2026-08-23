#!/usr/bin/env node
/* reactor-crew structural auditor.
   Checks the invariants that keep the design bench and control room identical:
   one plant renderer, one symbol set, one pipe network, matching inspectors,
   and a grid that lands exactly on the 12..748 content margins.
   Usage:  node tools/audit-geometry.js
*/
// Geometric containment audit: does each element sit inside what it belongs to?
const S=require('./bundle').bundle();
const g=(re,d)=>{const m=S.match(re);return m?m.slice(1).map(Number):d;};

/* The pipe checks below are the one part of this auditor that has to *run* the code:
   routing is emergent from component positions, so no amount of reading the source
   tells you whether two runs land on top of each other. */
const M=require('./bundle').headless('{pipeNetwork,commission,D:()=>D}');

/* Chop every run into its axis-aligned segments. Zero-length ones are the corner
   artefacts a polyline picks up when two waypoints coincide; they cannot overlap
   anything, and counting them would make every corner a false positive. */
function pipeSegs(net){
  const out=[];
  net.forEach((r,ri)=>{
    for(let i=1;i<r.pts.length;i++){
      const a=r.pts[i-1], b=r.pts[i];
      if(Math.abs(a[0]-b[0])<0.5 && Math.abs(a[1]-b[1])<0.5) continue;
      out.push({run:ri, k:r.k, a, b, vert:Math.abs(a[0]-b[0])<0.5});
    }
  });
  return out;
}

/* Two segments overlap when they run the same way, sit on the same axis coordinate,
   and share a stretch of it. The 0.6px tolerance is for pipes that are meant to be
   flush neighbours but land a rounding apart; the 1.5px length floor forgives a
   genuine crossing, where two parallel runs meet only at the width of one corner. */
function pipeOverlaps(segs){
  const res=[];
  for(let i=0;i<segs.length;i++) for(let j=i+1;j<segs.length;j++){
    const p=segs[i], q=segs[j];
    if(p.vert!==q.vert) continue;
    const ax=p.vert?0:1, al=p.vert?1:0;
    if(Math.abs(p.a[ax]-q.a[ax])>0.6) continue;
    const lo=Math.max(Math.min(p.a[al],p.b[al]), Math.min(q.a[al],q.b[al]));
    const hi=Math.min(Math.max(p.a[al],p.b[al]), Math.max(q.a[al],q.b[al]));
    if(hi-lo>1.5) res.push({p,q,axis:p.a[ax],len:hi-lo,lo,hi});
  }
  return res;
}

/* Only the default layout is held to this. The player may drag a component anywhere,
   and some hand-made arrangements leave the router no overlap-free path at all - that
   is the player's diagram to make ugly, not a regression. commission() rebuilds the
   layout from scratch whenever the loop count changes, so each pass starts clean. */
const pipeChecks=[];
for(const loops of [1,2,3,4]){
  M.D().loops=loops; M.commission();
  const over=pipeOverlaps(pipeSegs(M.pipeNetwork()));
  pipeChecks.push([`no pipe overlaps (${loops} loop${loops>1?'s':''})`, over.length===0,
                   `${over.length} overlapping segment pairs`, loops, over]);
}


// the plant is now generated from the layout, so check the shared renderer's invariants
const GW=Number(S.match(/const GW=(\d+)/)[1]), GH=Number(S.match(/GH=(\d+)/)[1]);
const CELL=Number(S.match(/CELL=(\d+)/)[1]), GX=Number(S.match(/GX=(\d+)/)[1]);
const checks=[
 ['grid fills content width', GX+GW*CELL===748, `${GX} .. ${GX+GW*CELL} (want 12..748)`],
 ['grid left margin',         GX===12, `GX=${GX}`],
 ['one plant renderer',       /const drawGrid = y0 => drawPlant\(y0,null\)/.test(S) &&
                              /drawPlant\(84,s\)/.test(S), 'design and control both call drawPlant'],
 ['one symbol set',           (S.match(/function drawSym/g)||[]).length===1, 'drawSym defined once'],
 ['one pipe network',         (S.match(/function pipeNetwork/g)||[]).length===1, 'pipeNetwork defined once'],
 ['one inspector shape',      /function inspector\(y0\)/.test(S) && /function ctrlInspector\(y0\)/.test(S),
                              'design + control inspectors share position and size'],
 ['inspector heights match',  (S.match(/const IH=232/g)||[]).length===2, 'both 232px'],
 ['no hand-placed mimic',     !/OY=44/.test(S), 'fixed-coordinate mimic removed'],
 ...pipeChecks,
];
let bad=0;
for(const [n,ok,detail,,over] of checks){
  console.log((ok?'  ok   ':'  FAIL ')+n.padEnd(28)+detail); if(!ok) bad++;
  if(!ok && over) for(const o of over)
    console.log(`         ${o.p.vert?'V':'H'} ${o.p.k}#${o.p.run} / ${o.q.k}#${o.q.run}`+
      ` at ${o.p.vert?'x':'y'}=${o.axis.toFixed(1)}`+
      ` ${o.p.vert?'y':'x'} ${o.lo.toFixed(1)}..${o.hi.toFixed(1)} (${o.len.toFixed(1)}px)`);
}
console.log(bad?`\n${bad} failure(s)`:'\nall harmonisation checks pass');
process.exit(bad?1:0);
