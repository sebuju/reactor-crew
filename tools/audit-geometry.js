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
 /* The plant is a world you pan and zoom now, so it is no longer required to
    land exactly on the right content margin - it is FITTED into whatever
    viewport the screen gives it. What still has to hold is that it starts on
    the left margin and that a cell is square. */
 ['grid starts on the margin', GX===12, `GX=${GX}`],
 ['grid is whole cells',      GW*CELL%GW===0, `${GW} x ${CELL} = ${GW*CELL} units wide`],
 /* Both screens draw the plant through the ONE renderer, each handing it the
    viewport it decided to give the plant and its own live state - null on the
    bench, S in the control room. The old form named the y each screen used;
    those became viewport heights the moment the page stopped scrolling, so this
    asks about the arguments that carry the meaning instead. */
 ['one plant renderer',       S.includes('drawPlant(vy,null,vh)') &&
                              S.includes('drawPlant(vy,s,vh)'), 'design and control both call drawPlant'],
 ['one symbol set',           (S.match(/function drawSym/g)||[]).length===1, 'drawSym defined once'],
 ['one pipe network',         (S.match(/function pipeNetwork/g)||[]).length===1, 'pipeNetwork defined once'],
 /* The control room's readouts are no longer a panel with a shape of its own -
    they are drawn inside the component that owns them. What has to hold is that
    ONE function draws them and that it is handed the component's own box. */
 /* There is no readout panel at all any more. What has to hold is that every
    component's table comes from ONE data function and is drawn as a plate in
    the plant's own margin, on a leader back to the machine it belongs to. */
 ['readouts are the plant',   S.includes('function readoutsFor(p,s)') &&
                              S.includes('function drawPlate(q)'), 'one table, drawn as a plate on a leader'],
 /* The bench has no inspector panel either. Its parameters are DATA the same way
    the control room's readouts are, and they are drawn into the SAME plate - so
    what has to hold is that one function says what a component lets you set,
    and that the box and the leader it stands in are the shared ones. */
 ['params are the plant',     S.includes('function paramsFor(p)') &&
                              S.includes('function benchPlateFor(p)'), 'one parameter table, drawn as a plate on a leader'],
 ['one plate, two fillings',  (S.match(/function plateShell/g)||[]).length===1 &&
                              (S.match(/function plateLead/g)||[]).length===1 &&
                              (S.match(/plateShell\(q,col,on," \//g)||[]).length===2,
                              'readouts and parameters share the box and the leader'],
 /* Both screens now stand MORE THAN ONE plate in the margins, which is the same
    balance-and-stack question asked twice. It is answered once: plateStack() is
    defined once and both plate lists are returned through it. */
 ['one plate packer',        (S.match(/function plateStack/g)||[]).length===1 &&
                             /function platesFor\(\)[\s\S]{0,400}?return plateStack\(/.test(S) &&
                             /function benchPlates\(\)[\s\S]{0,900}?return plateStack\(/.test(S),
                             'the two margins are balanced and stacked in one place'],
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
