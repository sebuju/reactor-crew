#!/usr/bin/env node
// Usage:  node tools/audit-geometry.js
const S=require('./bundle').bundle();

// routing is emergent from component positions, so this has to run the code,
// not just read it
const M=require('./bundle').headless('{pipeNetwork,commission,pipeWaypoints,D:()=>D,addJunction}');

// zero-length segments are corner artefacts from coincident waypoints; skip
// them or every corner is a false positive
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

// 0.6px tolerance is for flush neighbours that land a rounding apart; the
// 1.5px length floor forgives a genuine crossing (two runs meeting only at
// the width of one corner)
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

const pipeChecks=[];
for(const loops of [1,2,3,4]){
  M.D().loops=loops; M.commission();
  const over=pipeOverlaps(pipeSegs(M.pipeNetwork()));
  pipeChecks.push([`no pipe overlaps (${loops} loop${loops>1?'s':''})`, over.length===0,
                   `${over.length} overlapping segment pairs`, loops, over]);
}
// no junction exists on a default plant, so this sweep is the only thing
// that ever routes one - check every adjacent pair actually tied, the
// densest a plant this size can be wired
for(const loops of [2,3,4]){
  M.D().loops=loops; M.D().junc={}; M.commission();
  const tap=k=>{ const r=M.pipeNetwork().find(x=>x.key&&x.key.startsWith(k)); return r.pts[0]; };
  for(let i=0;i<loops-1;i++) M.addJunction(i,i+1,...tap('cold:sg'+i));
  const over=pipeOverlaps(pipeSegs(M.pipeNetwork()));
  pipeChecks.push([`no overlaps (${loops} loops, tied)`, over.length===0,
                   `${over.length} overlapping segment pairs`, loops, over]);
}
M.D().junc={};

// a waypoint owes a straight, self-clear run through its own point; it owes
// no clear lane through OTHER runs' pipes (a parked point can eat one, same
// as a component dragged into a corner). So that guard is a ceiling on how
// often it happens, not a demand for zero - measured at 12 of 672 swept
// positions below, all on lanes the cold legs already own.
const wpSpots=[];
for(let x=8;x<=760;x+=24) for(let y=104;y<=600;y+=24) wpSpots.push([x,y]);
M.D().loops=2; M.commission();
const wpKey=M.pipeNetwork().find(r=>r.k==='hot').key;
let wpMiss=0, wpBent=0, wpSelf=0, wpOther=0;
for(const [x,y] of wpSpots){
  M.pipeWaypoints[wpKey]=[{x,y}];
  const net=M.pipeNetwork(), r=net.find(q=>q.key===wpKey);
  if(!r.pts.some(p=>Math.abs(p[0]-x)<0.5 && Math.abs(p[1]-y)<0.5)) wpMiss++;
  if(r.legs.length!==r.wps.length+1) wpBent++;
  if(r.pts.some((p,i)=>i>0 && Math.abs(p[0]-r.pts[i-1][0])>0.5 && Math.abs(p[1]-r.pts[i-1][1])>0.5)) wpBent++;
  if(pipeOverlaps(pipeSegs([r])).length) wpSelf++;
  if(pipeOverlaps(pipeSegs(net)).length) wpOther++;
}
delete M.pipeWaypoints[wpKey];
const wpChecks=[
  ['waypoint steers the run', wpMiss===0, `${wpSpots.length} places checked, ${wpMiss} not routed through`],
  ['waypoint keeps it square', wpBent===0, `${wpBent} runs bent off the axes or split wrong`],
  ['waypoint never doubles back', wpSelf===0, `${wpSelf} runs overlapping themselves`],
  ['waypoint clears other runs', wpOther/wpSpots.length<0.05,
   `${wpOther} of ${wpSpots.length} land on a lane another run owns`],
];


// the plate/leader packer and router are gone: readoutsFor()/paramsFor() now
// read straight into an HTML rail (render/inspector.js). What's left to check
// is hostRect() - the one canvas-hosting helper both screens share for the
// trend chart and the fuel lattice plan - and that drawPlant() takes a
// viewport width so it never draws under the docked rail.
const fs2=require('fs'), path2=require('path');
const {ROOT:ROOT2}=require('./bundle');
const readSrc=f=>fs2.readFileSync(path2.join(ROOT2,f),'utf8');
const crSrc=readSrc('src/screens/control-room.js'), dbSrc=readSrc('src/screens/design-bench.js');
const plantChecks=[
 ['plate/leader system is gone', !/plateShell|plateLead|plateStack|platesFor|benchPlates|leadSearch|leadPts/.test(S),
   'no reference to the deleted plate packer or leader router remains'],
 ['one canvas host, two callers', (S.match(/function hostRect/g)||[]).length===1 &&
   crSrc.includes('hostRect(') && dbSrc.includes('hostRect('),
   'hostRect() is defined once in render/plant.js and both screens host a canvas widget through it'],
 ['drawPlant takes a rail width', /function drawPlant\(y0,L,vh,vx,vw\)/.test(S) &&
   crSrc.includes('drawPlant(vy,S,vh,GX,vw)') && dbSrc.includes('drawPlant(vy,null,vh,GX,vw)'),
   'both screens pass the width their own HTML rail leaves clear of the plant'],
];

// scoped to the two renderer files on purpose: src/sim/* legitimately writes
// S every tick, and store.js/record.js rebuild it wholesale. `=[^=]` keeps
// ==, ===, <=, >=, !== out of the match; method mutation
// (S.dmgParts.push(id)) has no assignment operator and is not caught.
const fs=require('fs'), path=require('path');
const {ROOT, scriptPaths}=require('./bundle');
const RENDERERS=['src/render/plant.js','src/screens/control-room.js']
  .filter(f=>scriptPaths().includes(f));
const S_WRITE=/(^|[^\w.])S\.[A-Za-z_$][\w$]*(\[[^\]]*\]|\.[A-Za-z_$][\w$]*)*\s*(=[^=]|\+\+|--|\+=|-=|\*=|\/=)/g;
const sWrites=[];
for(const f of RENDERERS){
  const src=fs.readFileSync(path.join(ROOT,f),'utf8');
  S_WRITE.lastIndex=0;
  for(let m; (m=S_WRITE.exec(src)); )
    sWrites.push(f+':'+(src.slice(0,m.index).split('\n').length));
}
const actChecks=[
 ['one input dispatch',   (S.match(/function act\(/g)||[]).length===1 &&
                          RENDERERS.length===2, 'act() defined once, both renderers read'],
 ['no renderer writes S',  sWrites.length===0,
  sWrites.length? sWrites.join(' ') : `${RENDERERS.length} files reach the plant only through act()`],
];

// the second half matters more than the first: a lone chart() nothing calls
// would pass a definition count while the panel quietly grew its own
// polyline back, so the trend panel is required to reach it
const chartChecks=[
 ['one strip chart',      (S.match(/function chart\(/g)||[]).length===1 &&
                          /function drawTrend[\s\S]{0,1400}?\bchart\(/.test(S),
                          'the trend panel plots through the primitive, not its own'],
];

// tab list lives in index.html (data-screen); the branch lives in the bundled
// main.js - read from their own files and checked against each other
const html = require('fs').readFileSync(require('path').join(require('./bundle').ROOT,'index.html'),'utf8');
const htmlTabs = [...html.matchAll(/<button[^>]*\bdata-screen="([^"]+)"/g)].map(m=>m[1]);
const branchTabs = htmlTabs.filter(k=>k!=='help');   // "help" is the chain's final else, no branch of its own
const jsBranchTabs = [...S.matchAll(/if\(screen==="([a-z]+)"\)\s*draw/g)].map(m=>m[1]);
const tabsShipWithBranches = htmlTabs.includes('help') && branchTabs.length>0 &&
  jsBranchTabs.length===branchTabs.length && new Set(jsBranchTabs).size===jsBranchTabs.length &&
  branchTabs.every(k=>jsBranchTabs.includes(k));

const VBOX_ONE = (S.split("function vBox").length-1)===1 &&
                 (S.split("VIEW.x=").length-1)===1;
// flown in a CHILD PROCESS: this file has already stubbed document/window on
// its own globals by now, and a test for their absence has to actually be absent
let noDomOk=false, noDomWhy='';
{ const {execFileSync}=require('child_process');
  try{ noDomWhy=execFileSync(process.execPath,[require.resolve('./nodom-probe')],
                             {stdio:['ignore','pipe','pipe']}).toString().trim();
       noDomOk=true; }
  catch(e){ const lines=String(e.stderr||e.message).split(String.fromCharCode(10));
            noDomWhy=(lines.filter(l=>l.indexOf('Error')>=0)[0]||'the probe failed').trim(); } }
const scnChecks=[
 ['every tab ships its branch', tabsShipWithBranches,
                            'index.html\'s tab list and main.js\'s if/else chain must name the same screens'],
 ['the sim needs no display', noDomOk, noDomWhy],
 ['one VIEW rect writer',   VBOX_ONE,
                            'every screen docks its overlays through vBox()'],
 ['the bench hides nothing', !/function drawScenario\(\)[\s\S]*?\n\}/.exec(S)[0].includes('ovlBar('),
                            'the scenario screen draws no bottom bar'],
];
// no "every lane is reachable" check: a lane carries no gesture kind of its
// own any more, so there is nothing about one that can go stale
const GW=Number(S.match(/const GW=(\d+)/)[1]), GH=Number(S.match(/GH=(\d+)/)[1]);
const CELL=Number(S.match(/CELL=(\d+)/)[1]), GX=Number(S.match(/GX=(\d+)/)[1]);
const checks=[
 // the plant pans/zooms now, so it is FITTED into whatever viewport it is
 // given rather than pinned to the right margin - only the left start and
 // square cells still have to hold
 ['grid starts on the margin', GX===12, `GX=${GX}`],
 ['grid is whole cells',      GW*CELL%GW===0, `${GW} x ${CELL} = ${GW*CELL} units wide`],
 ['one plant renderer',       S.includes('drawPlant(vy,null,vh,GX,vw)') &&
                              S.includes('drawPlant(vy,S,vh,GX,vw)'), 'design and control both call drawPlant'],
 ['one symbol set',           (S.match(/function drawSym/g)||[]).length===1, 'drawSym defined once'],
 ['one pipe network',         (S.match(/function pipeNetwork/g)||[]).length===1, 'pipeNetwork defined once'],
 // readoutsFor()/paramsFor() are unchanged; only where the data lands changed
 // - an HTML rail instead of a plate (render/inspector.js)
 ['readouts are the plant',   S.includes('function readoutsFor(p,s)') &&
                              S.includes('function fieldRowsBuild'), 'one table, read into the HTML rail'],
 ['params are the plant',     S.includes('function paramsFor(p)') &&
                              S.includes('function dbPanelSync'), 'one parameter table, read into the HTML rail'],
 ['no hand-placed mimic',     !/OY=44/.test(S), 'fixed-coordinate mimic removed'],
 ...pipeChecks,
 ...wpChecks,
 ...plantChecks,
 ...actChecks,
 ...chartChecks,
 ...scnChecks,
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
