#!/usr/bin/env node
// Usage:  node tools/audit-geometry.js
const S=require('./bundle').bundle();

// routing is emergent from component positions, so this has to run the code,
// not just read it
const M=require('./bundle').headless('{pipeNetwork,pipeAnchors,pipeAnchorTick,pipeStackBoxes,commission,pipeWaypoints,D:()=>D,P:()=>P,S:()=>S,addFit,removeFit,juncPt,nearestOn,moveTo,LAY:()=>LAY,reliefRate,reliefHeaderKey,nozzleEnds,retraces,hittableRunKeys,netFlowK,ROLE:()=>ROLE,radMu,tanks:()=>D.tanks,FLUID:()=>FLUID,AUTORULE:()=>AUTORULE,tankLvl,tankP,tankLive,tankOpen,tankIds,tankKg,tankRateRef,tankFluid,hostedTankIds,boronTankIds,addTank,packVal,unpackVal,designSig,face,placePart,removePart}');
// Stage 3b: D.loops is gone from src/ - an n-loop test plant is built the
// same way a player builds one, through placed parts and real D.run entries.
const {makeLoops}=require('./loopgen');

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
const retraceChecks=[];
// a same-face elbow whose lateral leg collapses to zero length folds back
// over itself and draws the same stroke twice, instead of turning a corner -
// the hpi run at 1 loop used to do this. Swept on the real network, not a
// hand-built polyline, so a regression anywhere route() builds a bend trips
// it, not just this one run. RETRACE_FILTER is reused verbatim by the
// sentinel below, so the sentinel proves the exact expression these checks
// run, not a stand-in for it.
const RETRACE_FILTER=r=>M.retraces(r.pts);
for(const loops of [1,2,3,4]){
  makeLoops(M,loops); M.commission();
  const net=M.pipeNetwork();
  const over=pipeOverlaps(pipeSegs(net));
  pipeChecks.push([`no pipe overlaps (${loops} loop${loops>1?'s':''})`, over.length===0,
                   `${over.length} overlapping segment pairs`, loops, over]);
  const bad=net.filter(RETRACE_FILTER);
  retraceChecks.push([`no retrace (${loops} loop${loops>1?'s':''})`, bad.length===0,
    `${bad.length} run(s): ${bad.map(r=>r.key).join(', ')}`]);
}
// no fitting exists on a default plant, so this sweep is the only thing
// that ever routes one - check every adjacent pair actually tied, the
// densest a plant this size can be wired. It is also the densest network
// route() ever has to fold a bend into, so the retrace check rides the same
// sweep instead of only ever seeing the sparse stock layouts above.
for(const loops of [2,3,4]){
  makeLoops(M,loops); M.D().fit={}; M.commission();
  const tap=k=>{ const r=M.pipeNetwork().find(x=>x.key&&x.key.startsWith(k)); return [r.key,0]; };
  for(let i=0;i<loops-1;i++) M.addFit('tee',...tap('cold:sg'+i),...tap('cold:sg'+(i+1)));
  const net=M.pipeNetwork();
  const over=pipeOverlaps(pipeSegs(net));
  pipeChecks.push([`no overlaps (${loops} loops, tied)`, over.length===0,
                   `${over.length} overlapping segment pairs`, loops, over]);
  const bad=net.filter(RETRACE_FILTER);
  retraceChecks.push([`no retrace (${loops} loops, tied)`, bad.length===0,
    `${bad.length} run(s): ${bad.map(r=>r.key).join(', ')}`]);
}
M.D().fit={};

// SENTINEL - the exact pre-fix hpi polyline, put through a fake run and the
// SAME RETRACE_FILTER the checks above run (not a direct M.retraces() call,
// which would stay green even if that filter's own shape stopped matching
// anything real - the junction sentinel further down uses the same idiom)
const preFixOvershoot=[[185,192],[185,445],[185,422]];
const sentinelCaught=[{key:'(sentinel)',pts:preFixOvershoot}].filter(RETRACE_FILTER).length===1;
retraceChecks.push(['(sentinel) pre-fix hpi polyline caught', sentinelCaught,
  sentinelCaught?'flagged, as it must be':'NOT flagged - RETRACE_FILTER would miss it']);

// a fitting stores a TAP - (run key, fraction along it) at each end -
// resolved fresh by juncPt() off whatever pipeNetwork() just routed. The bug
// this replaces stored a plant-space pixel once, at creation, so a part
// moved upstream of the tap left the glyph and the branch drawn on empty
// space. Everything below is measured by moving a real part and re-routing,
// never read off the source.
const juncChecks=[];
{
  const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  makeLoops(M,2); M.D().fit={}; M.commission();
  let net=M.pipeNetwork();
  // both faces of this run sit on components a pump move disturbs
  const runKey='cold:pump0b-coreb', tapT=0.5;
  const before=M.juncPt(net,runKey,tapT).pt;

  const pump0=M.LAY().parts.find(p=>p.id==='pump0');
  const p0x=pump0.x, p0y=pump0.y;
  const movedOk=M.moveTo(pump0,p0x-2,p0y);
  net=M.pipeNetwork();
  const runAfter=net.find(r=>r.key===runKey);
  const after=movedOk?M.juncPt(net,runKey,tapT).pt:before;
  const moveDist=dist(before,after);

  juncChecks.push(['tap follows its run', movedOk && moveDist>5,
    movedOk?`moved ${moveDist.toFixed(1)}px when the run it's tapped on moved`
           :'the pump move was blocked, nothing measured']);

  // THE REGRESSION SENTINEL - "seen to fail", not just seen to pass. The old
  // bug's whole shape was "the tap doesn't move": reusing the pre-move point
  // IS what a stored pixel would still hand back after the run moved. Same
  // assertion, frozen input - it must go red, or the check above is not
  // actually testing anything.
  const frozenMoveDist=dist(before,before);
  const sentinelCaught = !(movedOk && frozenMoveDist>5);
  juncChecks.push(['(sentinel) a frozen tap is caught by the check above', sentinelCaught,
    sentinelCaught?`a stored-pixel tap measures ${frozenMoveDist.toFixed(1)}px of movement - "tap follows its run" would fail it`
                  :'a frozen pixel slipped past the movement check - it is not testing what it claims to']);

  const onRun=M.nearestOn(runAfter.pts,after);
  juncChecks.push(['tap stays on its run', onRun.d<0.5,
    `resolved point sits ${onRun.d.toFixed(3)}px off the run's own polyline`]);

  // a point taken off a run at a known t must come back out through
  // nearestOn() -> juncPt() at (about) the same place - on two differently
  // shaped runs, so a bug in one leg's geometry can't hide behind the other's
  let rtWorst=0;
  for(const key of ['hot:corer-sg0l','cold:sg0b-pump0t']){
    const r=net.find(x=>x.key===key);
    for(let i=0;i<8;i++){
      const t=i/7;
      const p=M.juncPt(net,key,t).pt;
      const back=M.nearestOn(r.pts,p);
      const p2=M.juncPt(net,key,back.t).pt;
      rtWorst=Math.max(rtWorst,dist(p,p2));
    }
  }
  juncChecks.push(['t round-trips through nearestOn()', rtWorst<0.5,
    `worst of 16 samples (hot + cold runs) off by ${rtWorst.toFixed(3)}px`]);

  // the branch itself: after the move, its run must still exist, be finite,
  // and hold the same square-only invariant every other run in this file is
  // held to
  const jid=M.addFit('tee',runKey,tapT,'cold:sg1b-pump1t',0.5);
  const tieNet=M.pipeNetwork();
  const tie=tieNet.find(r=>r.key==='xtie:'+jid);
  const tieFinite=!!tie && tie.pts.length>=2 &&
    tie.pts.every(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  const tieSquare=!!tie && tie.pts.every((p,i)=>i===0 ||
    Math.abs(p[0]-tie.pts[i-1][0])<0.5 || Math.abs(p[1]-tie.pts[i-1][1])<0.5);
  juncChecks.push(['branch re-routes after the move', tieFinite && tieSquare,
    tie?`${tie.pts.length} points, ${tieSquare?'axis-aligned':'a diagonal segment'}`:'no xtie run in the network']);
  M.removeFit(jid);

  // a tap naming a run pipeNetwork() didn't build this frame (its part
  // removed, or the key simply wrong) must be skipped, not throw the whole
  // network away
  const badId=M.addFit('tee','cold:doesNotExist',0.5,'hot:corer-sg0l',0.5);
  let threw=false;
  try{ M.pipeNetwork(); } catch(e){ threw=true; }
  M.removeFit(badId);
  juncChecks.push(['a dangling tap is skipped, not fatal', !threw,
    threw?'pipeNetwork() threw on an unresolvable fitting':'pipeNetwork() returned normally']);

  // an IN-LINE throttle (bKey null) has no route of its own - the per-jid
  // routing loop must skip it rather than call juncPt(net,null,...) and blow
  // up, and pipeNetwork() must still return normally with everything else
  // routed around it.
  const inlineId=M.addFit('throttle',runKey,tapT,null,null);
  let inlineThrew=false;
  try{ M.pipeNetwork(); } catch(e){ inlineThrew=true; }
  const inlineNet=M.pipeNetwork();
  const inlineHasRoute=inlineNet.some(r=>r.key==='xtie:'+inlineId);
  M.removeFit(inlineId);
  juncChecks.push(['an in-line fitting draws no route of its own', !inlineThrew && !inlineHasRoute,
    inlineThrew?'pipeNetwork() threw on an in-line throttle'
      :inlineHasRoute?'an in-line throttle still got an xtie run':'pipeNetwork() returned normally, no xtie run']);

  M.D().fit={};
  M.moveTo(pump0,p0x,p0y);
}

/* A waypoint owes a straight, self-clear run through its own point; it owes no
   clear lane through OTHER runs' pipes (a parked point can eat one, same as a
   component dragged into a corner). So this is a ceiling on how often it
   happens, not a demand for zero.

   MEASURED WITH NO WAYPOINT AT ALL: exactly 0 overlaps. So every one of the
   count below is genuinely caused by the parked point, and none of it is a
   static layout fault hiding under the same number.

   It was 12 of 672 when this was written and it is 86 now, and the rise is
   real rather than a regression: Stage 1/3a made relief, feed, steam, exh and
   every fitting branch REAL routed runs, so there is far more pipe on the
   board to land on - and a waypoint on a hot leg moves the taps that sit on
   it, which re-routes each branch off them in turn (juncPt() resolves a tap
   against whatever pipeNetwork() routed this frame, by design). Hence pairs
   like relief x xtie appearing from a waypoint on hot:corer-sg0l.

   EXACT, not a fraction. The old guard was "under 5%", which left 21 swept
   positions of unexplained slack for a regression to hide in - the same hole
   audit-text's ceilings were tightened to close. If this number moves, find
   what moved it.

   86 -> 18 when feedwater moved off the generator's "b" face onto its own
   "r" face - in design.js for loop 0, and in loopgen.js for loops 1..3, which
   had been left building the old shape. Those runs used to cross the board
   from the right-hand plant to a generator's UNDERSIDE, through the lanes the
   cold leg and the branches tapped off it already own; landing on the near
   face instead, they cross almost nothing. A fall here is the routing getting
   out of its own way, not a weakened check - the sweep, the pairing and the
   672 positions are all unchanged. */
const WP_OTHER_BASE=18;   // exact measured baseline - see the note above
const wpSpots=[];
for(let x=8;x<=760;x+=24) for(let y=104;y<=600;y+=24) wpSpots.push([x,y]);
makeLoops(M,2); M.commission();
const wpKey=M.pipeNetwork().find(r=>r.k==='hot').key;
/* The claim the ceiling below rests on: with no waypoint parked anywhere, this
   plant routes with ZERO overlapping pipe. Without this, "86 positions cause an
   overlap" could equally mean "this layout always overlaps and the sweep found
   it 86 times" - two completely different facts wearing one number. */
{ delete M.pipeWaypoints[wpKey];
  const base=pipeOverlaps(pipeSegs(M.pipeNetwork()));
  pipeChecks.push(['no waypoint, no overlap', base.length===0,
    base.length? `${base.length} run(s) overlap with nothing parked: `+
      base.map(o=>(o.p.k||'?')+'/'+(o.q.k||'?')).join(', ')
    : 'a 2-loop plant routes every run clear of every other before any waypoint is set']);
}
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
  ['waypoint clears other runs', wpOther===WP_OTHER_BASE,
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
 /* The WIDTH, not the spelling. This used to match the literal argument `GX`,
    which pinned a constant nobody promised rather than the property the label
    claims - so it went red the day the plant view was widened to the rail edge,
    on a change that made the claim MORE true. It now demands the thing that
    matters: each screen derives vw from the rail it measured. */
 ['drawPlant takes a rail width', /function drawPlant\(y0,L,vh,vx,vw\)/.test(S) &&
   crSrc.includes('drawPlant(vy,S,vh,0,vw)') && dbSrc.includes('drawPlant(vy,null,vh,0,vw)') &&
   /const vw\s*=\s*railBox\s*\?\s*Math\.max\(200,\s*railBox\.x\)/.test(crSrc) &&
   /const vw\s*=\s*railBox\s*\?\s*Math\.max\(200,\s*railBox\.x\)/.test(dbSrc),
   'both screens pass the width their own HTML rail leaves clear of the plant'],
 /* The band above the plant is MEASURED off the strip, never reserved as a
    constant: the strip is a fixed CSS height and the plant view is in layout
    units, so a constant is right at one window width and leaves dead canvas at
    every other. TRSTRIP_H was that constant and must stay gone. */
 ['the strip is measured, not reserved',
   crSrc.includes('hostRect(trStrip("operate").root)') && !/TRSTRIP_H/.test(S),
   'drawOperate() measures the transport strip instead of reserving a band'],
];

// the layer registry (render/layers.js) - one table, one pass function called
// from exactly two seams inside drawPlant() and nowhere else, one switch
// builder called by both rails. Brace-matched rather than regexed past the
// function's own closing brace, because a stray third call anywhere else in
// the bundle is exactly the bug this exists to catch and a plain substring
// count can't tell "inside drawPlant" from "inside the file".
function funcBody(src,name){
  const at=src.indexOf('function '+name+'(');
  if(at<0) return '';
  const braceAt=src.indexOf('{',at);
  let depth=0,i=braceAt;
  for(;i<src.length;i++){
    if(src[i]==='{') depth++;
    else if(src[i]==='}'){ depth--; if(depth===0) break; }
  }
  return src.slice(braceAt,i+1);
}
// matched as a CALL (string literal seam arg) rather than any "layerPass("
// substring, or the function's own declaration and its doc comment - which
// both say "layerPass(" too - would inflate the count
const drawPlantBody=funcBody(S,'drawPlant');
const layerPassInDrawPlant=(drawPlantBody.match(/layerPass\(["']/g)||[]).length;
const layerPassTotal=(S.match(/layerPass\(["']/g)||[]).length;
/* THE PRESSURIZER DOES NOT OWN A RELIEF VALVE, AND THIS IS WHAT KEEPS IT THAT
   WAY. Six rows about the relief valve used to live in readoutsFor()'s pzr
   branch, and every one of them resolved through primaryRelief() - so a plant
   with three relief valves had this panel describe the first and pretend the
   other two did not exist. They are readoutsForFit() rows now, one panel per
   valve. A row that drifts back here is invisible to every other check in this
   file, because it draws perfectly well; it is just describing the wrong valve.
   P.P0*(1.06+0.07*m) is the HIGH PRESSURE TRIP and stays - a different setpoint
   that merely shares a digit - so it is struck out before the scan. */
const pzrBranch=(()=>{
  const b=funcBody(S,'readoutsFor'), at=b.indexOf('id==="pzr"');
  if(at<0) return '';
  const end=b.indexOf('} else if(', at);
  return b.slice(at, end<0? b.length : end).split('1.06+0.07*m').join('');
})();
const PZR_STRAY=['primaryRelief(','porvRate','reliefOpen','reliefBlocked','1.06','PORV_LIFT','autoState("porv")'];
const pzrStrays=PZR_STRAY.filter(t=>pzrBranch.includes(t));
const fitPanelChecks=[
 ['the pzr branch names no valve', pzrBranch.length>0 && pzrStrays.length===0,
  pzrStrays.length? 'the pzr branch of readoutsFor() still reaches a relief valve through: '+pzrStrays.join(', ')
    : 'no relief valve is described from the pressurizer: the pzr branch of readoutsFor() carries none of '+PZR_STRAY.join(', ')],
 ['a fitting has its own panel', (S.match(/function readoutsForFit\(/g)||[]).length===1 &&
   (S.match(/function paramsForFit\(/g)||[]).length===1 &&
   crSrc.includes('readoutsForFit(') && dbSrc.includes('paramsForFit('),
  'readoutsForFit() and paramsForFit() are each defined once, and each rail builds fitting wells from its own one'],
 ['one setpoint reader', (S.match(/function reliefSet\(/g)||[]).length===1 &&
   !/PORV_LIFT|PORV_RESEAT/.test(S),
  'reliefSet() is the one reader of a setpoint pair; no file reads a plant-wide PORV_LIFT/PORV_RESEAT any more'],
];

const layerChecks=[
 ['one layer table',        (S.match(/const LAYERS=/g)||[]).length===1, 'LAYERS defined once, in render/layers.js'],
 ['layerPass called twice, both in drawPlant',
   (S.match(/function layerPass/g)||[]).length===1 &&
   layerPassTotal===2 && layerPassInDrawPlant===2,
   `layerPass() defined once, called ${layerPassTotal} time(s) total, ${layerPassInDrawPlant} inside drawPlant()`],
 ['one layer switch builder', (S.match(/function layerSwitches/g)||[]).length===1 &&
   crSrc.includes('layerSwitches(') && dbSrc.includes('layerSwitches('),
   'layerSwitches() defined once in render/layers.js, both rails call it'],
];

// scoped to the two renderer files on purpose: src/sim/* legitimately writes
// S every tick, and store.js/record.js rebuild it wholesale. `=[^=]` keeps
// ==, ===, <=, >=, !== out of the match; method mutation
// (S.dmgParts.push(id)) has no assignment operator and is not caught.
const fs=require('fs'), path=require('path');
const {ROOT, scriptPaths}=require('./bundle');
const RENDERERS=['src/render/plant.js','src/screens/control-room.js']
  .filter(f=>scriptPaths().includes(f));
/* A LAYER IS A VIEW, and this is where that stops being a comment. layers.js
   states the contract; without the layer files in this scan the contract is
   enforced on the two files that already obeyed it and on none of the ones
   written since. Every future layer lands in one of these two files, so the
   day someone smuggles a side effect into a draw callback, this says so. */
const VIEW_FILES=RENDERERS.concat(
  ['src/render/layers.js','src/render/rad.js'].filter(f=>scriptPaths().includes(f)));
const S_WRITE=/(^|[^\w.])S\.[A-Za-z_$][\w$]*(\[[^\]]*\]|\.[A-Za-z_$][\w$]*)*\s*(=[^=]|\+\+|--|\+=|-=|\*=|\/=)/g;
const sWrites=[];
for(const f of VIEW_FILES){
  const src=fs.readFileSync(path.join(ROOT,f),'utf8');
  S_WRITE.lastIndex=0;
  for(let m; (m=S_WRITE.exec(src)); )
    sWrites.push(f+':'+(src.slice(0,m.index).split('\n').length));
}
/* AND A LAYER MUST NOT SOLVE - the same rule at the seam it is easiest to
   break. netFactored() caches its factorisation onto net.Af/net.AfSig, and
   net IS P.net, so a draw callback that asked the pipe network for a pressure
   would be a layer writing to P. The S-write scan above cannot see that; nor
   can a state comparison, because a redundant solve against a warm cache
   writes nothing and is invisible in the answer - which is exactly why it has
   to be a rule about the SOURCE.
   drawPlant() refreshes the field once a frame and pipeFieldRefresh() is the
   one place allowed to ask, so every solve entry point is banned from the
   layer files outright and allowed in pipes.js only inside that function. */
const SOLVER_NAMES=['netPressures','netDrops','netField','netFlowK',
                   'netCoreFracOf','netFactored','netSolve','netSubst'];
/* Comments stripped first, or the sentence explaining WHY a layer must not
   solve would itself trip the check that says so. */
const blank=t=>t.replace(/[^\n]/g,' ');   // same length, same lines, no content
const stripComments=src=>src.replace(/\/\*[\s\S]*?\*\//g,blank)
  .replace(/\/\/[^\n]*/g,blank);
const solverHits=(raw)=>{
  const src=stripComments(raw);
  const out=[];
  for(const n of SOLVER_NAMES){
    let i=-1;
    while((i=src.indexOf(n+'(', i+1))>=0) out.push({n, i});
  }
  return out;
};
const solveCalls=[];
for(const f of ['src/render/layers.js','src/render/rad.js'].filter(f=>scriptPaths().includes(f))){
  const src=fs.readFileSync(path.join(ROOT,f),'utf8');
  for(const h of solverHits(src))
    solveCalls.push(f+':'+(src.slice(0,h.i).split('\n').length)+' '+h.n);
}
{ const src=fs.readFileSync(path.join(ROOT,'src/render/pipes.js'),'utf8');
  const fn=src.indexOf('function pipeFieldRefresh');
  const end=fn<0?-1:src.indexOf('\n}', fn);
  for(const h of solverHits(src))
    if(fn<0 || h.i<fn || h.i>end)
      solveCalls.push('src/render/pipes.js:'+(src.slice(0,h.i).split('\n').length)+' '+h.n);
}
const actChecks=[
 ['one input dispatch',   (S.match(/function act\(/g)||[]).length===1 &&
                          RENDERERS.length===2, 'act() defined once, both renderers read'],
 ['no view file writes S',  sWrites.length===0,
  sWrites.length? sWrites.join(' ') : `${VIEW_FILES.length} view files reach the plant only through act()`],
 ['no layer solves the network', solveCalls.length===0,
  solveCalls.length? solveCalls.join(' ')
    : 'the pressure field is solved once a frame in pipeFieldRefresh() and read from there'],
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
/* ── A RENDERER KEY MUST RESOLVE AGAINST THE SIM'S OWN KEY SET ──
   This is the one class of fault every other auditor is blind to by
   construction. Stage 3a re-keyed S.flowPos from pipe KIND to run KEY and
   left render/pipes.js looking up by kind: every lookup returned undefined,
   so every flow packet on every pipe stopped moving and every flow meter
   read zero - and all five checks stayed green, because a string metric and
   a widget's box cannot tell that a number is silently nothing.
   So: the set of keys the renderer asks for and the set the sim writes must
   be the SAME set, both ways. A key the renderer asks for and the sim never
   writes is a frozen packet; a key the sim writes and no run carries is a
   stale entry that will outlive its pipe. */
const GWc=Number(S.match(/const GW=(\d+)/)[1]), GHc=Number(S.match(/GH=(\d+)/)[1]);
const keyMisses=(want,have)=>want.filter(k=>!have.includes(k));
const netKeyChecks=[];
{
  let rendMiss=0, simMiss=0, posMiss=0, cases=0;
  for(const loops of [1,2,3,4]){
    makeLoops(M,loops); M.D().fit={}; M.commission();
    // and again with the plant fully wired, since a fitting adds runs
    // (xtie:) that only exist once one is placed
    for(const wired of [false,true]){
      if(wired){
        const tap=k=>{ const r=M.pipeNetwork().find(x=>x.key&&x.key.startsWith(k)); return r?[r.key,0.4]:null; };
        const a=tap('cold:sg0');
        if(a) M.addFit('throttle',a[0],a[1],null,null);
        for(let i=0;i<loops-1;i++){
          const u=tap('cold:sg'+i), v=tap('cold:sg'+(i+1));
          if(u&&v) M.addFit('tee',u[0],u[1],v[0],v[1]);
        }
        M.commission();
      }
      const rend=M.pipeNetwork().filter(r=>r.key).map(r=>r.key);
      const sim=Object.keys(M.P().net.byKey);
      const pos=Object.keys(M.S().flowPos);
      rendMiss+=keyMisses(rend,sim).length;   // renderer asks, sim never wrote
      simMiss +=keyMisses(sim,rend).length;   // sim wrote, no run carries it
      posMiss +=keyMisses(pos,sim).length;    // an animated key off the graph
      cases++;
    }
    M.D().fit={};
  }
  /* The injected fault, the same idiom audit-dom.js uses: a check nobody has
     seen fail is not a check. Look the runs up by KIND, exactly as pipes.js
     did before Stage 3a was finished, and the miss count must go POSITIVE -
     otherwise the comparison above is passing for some reason other than the
     keys agreeing. */
  makeLoops(M,4); M.D().fit={}; M.commission();
  const byKind=M.pipeNetwork().filter(r=>r.key).map(r=>r.k);
  const injected=keyMisses(byKind,Object.keys(M.P().net.byKey)).length;
  netKeyChecks.push(
    ['renderer key is a sim key', rendMiss===0,
     `${cases} plants: ${rendMiss} run keys the renderer draws that the sim never wrote`],
    ['sim key still has a run',      simMiss===0,
     `${simMiss} keys on the graph that pipeNetwork() no longer routes`],
    ['every animated key is real',   posMiss===0,
     `${posMiss} S.flowPos keys with no edge record behind them`],
    ['inject: lookup by kind',       injected>0,
     `caught by "renderer key is a sim key" (${injected} kind lookups resolve to nothing)`]);
}

/* ── A NOZZLE NEEDS A DIRECTION, AND A RUN CAN HAVE NONE ──
   Park the relief tank straight above the pressurizer and the header's two
   ports resolve to the same point; dedupe() collapses the run to ONE point,
   and an endpoint with no second point to face away from has no direction for
   a flange. Reading it took the whole frame down - every screen, every frame,
   on a move the bench offers. So: sweep the tank over every cell of the grid
   and demand nozzleEnds() answers for every run it produces. The collapsed
   count is asserted POSITIVE beside it, or the sweep would be quietly passing
   on 144 placements that never reproduce the case at all. */
const nozChecks=[];
{
  // the relief tank is a placed part now (Stage 5a) - on the grid from load,
  // with or without a relief fitting - but this sweep wants the FITTING too,
  // so the branch itself (not just the header run) is on the graph to sweep
  makeLoops(M,1); M.D().fit={}; M.commission();
  { const hot=M.pipeNetwork().find(r=>r.k==="hot");
    M.addFit('relief',hot.key,0.9,M.reliefHeaderKey(M.pipeNetwork())||'relief:x',0.5); }
  M.commission();
  let threw=0, swept=0, collapsed=0, noDir=0;
  for(let x=0;x<GWc;x++) for(let y=0;y<GHc;y++){
    const p=M.LAY().parts.find(q=>q.id==="reltk");
    if(!p) continue;
    M.moveTo(p,x,y); M.commission(); swept++;
    for(const r of M.pipeNetwork()){
      if(r.pts.length<2) collapsed++;
      try{ const e=M.nozzleEnds(r);
           for(const o of e) if(!o.p || o.p.length!==2) noDir++; }
      catch(err){ threw++; }
    }
  }
  nozChecks.push(
    ['a nozzle always faces', threw===0,
     `${swept} tank placements swept, ${threw} runs a flange could not be read off`],
    ['every nozzle has a point', noDir===0, `${noDir} ends with no plant point`],
    ['the collapse really happens', collapsed>0,
     `${collapsed} zero-length runs seen in the sweep - the case is reproduced, not assumed`]);
  M.D().fit={}; makeLoops(M,4); M.commission();
}

/* ── A RELIEF FITTING SURVIVES ITS TANK MOVING ──
   The relief HEADER's key carries the two faces pipeNetwork() picked for it
   (D.run.relief, routed live), so it is renamed by any move of the
   pressurizer or the tank. The stock relief fitting used to STORE that
   string, which meant moving either part - both of which the game invites -
   silently dropped the fitting out of netBuild(), took FIT.relief.g and its
   solved vent rate to zero, and left the valve venting NOTHING while its
   glyph, its tank, its mimic and its mass all stayed exactly where they
   were. reliefRate() (pipenet.js) is the solved-flow reader Stage 4 gives
   this test now - forced open (S.reliefOpen), since unlike the old ventK()
   it only reads a valve that is actually passing. */
const reliefChecks=[];
{
  makeLoops(M,4); M.D().fit={}; M.commission();
  const tapHot=M.pipeNetwork().find(r=>r.k==='hot');
  const stale='relief:pzrt-reltkb';       // the literal that used to be stored
  M.addFit('relief',tapHot.key,0.9,stale,0.5);
  M.commission();
  const fid=Object.keys(M.D().fit)[0];
  const at=id=>M.LAY().parts.find(q=>q.id===id);
  const home={reltk:{...at('reltk')}, pzr:{...at('pzr')}};
  const rate=()=>{ const s=M.S(); s.reliefOpen[fid]=true; s.reliefBlocked[fid]=false; return M.reliefRate(s,fid); };
  const base=rate();
  M.moveTo(at('reltk'),8,2); M.commission();
  const afterTank=rate(), renamed=!M.P().net.byKey[stale];
  const offerable=!!M.reliefHeaderKey(M.pipeNetwork());
  M.moveTo(at('pzr'),3,1); M.commission();
  const afterPzr=rate();
  M.moveTo(at('reltk'),home.reltk.x,home.reltk.y);
  M.moveTo(at('pzr'),home.pzr.x,home.pzr.y);
  M.commission();
  const backHome=rate();
  reliefChecks.push(
    ['relief vents where it sits', base>0 && afterTank>0 && afterPzr>0,
     `rate ${base.toFixed(3)} -> tank moved ${afterTank.toFixed(3)} -> pzr moved ${afterPzr.toFixed(3)} %/s`],
    ['relief comes home unchanged', Math.abs(backHome-base)<1e-12,
     `moving both parts away and back returns the vent rate to ${base.toFixed(4)}`],
    ['relief can still be added',  offerable,
     'the bench can resolve a header to tap after the tank moves'],
    ['inject: the stored literal',  renamed,
     `caught by "relief vents where it sits" (${stale} no longer names any run)`]);
  M.D().fit={}; makeLoops(M,4); M.commission();
}

/* ══════════ A RUN'S KIND IS A SPEC, NOT A PERMISSION (Stage 1/1B) ══════════
   Four disagreeing kind lists used to answer "carries a conductance / may be
   tapped / may be hit / may spill" - deleted, not reconciled: every run
   answers "yes" to all four now, and what survives of r.k/ed.kind is a LABEL
   or a DEFAULT-PICKER, commented as one at the exact line that reads it (see
   pipenet.js's own "A kind string may survive..." rule). This is that
   comment made checked rather than trusted.

   WIDENED PAST src/data/pipenet.js FOR STAGE 1B - the VIEW half: a run drawn
   thin because it is called "hpi" was exactly as false a permission as one
   excluded from the solve by name, just one layer up. Every file that used
   to decide colour, meter unit, packet speed or line width by kind now
   carries the same source rule pipenet.js already had to meet.

   A repo-wide version is later work (Stage 10's own checklist item
   1), not a licence for this one to claim a reach it does not have; widen
   SCAN_FILES when that pass lands, not before. */
const kindPermChecks=[];
{
  const fsK=require('fs'), pathK=require('path');
  const {ROOT:ROOTK}=require('./bundle');
  const SCAN_FILES=['src/data/pipenet.js','src/render/pipes.js','src/render/plant.js',
                     'src/sim/step.js','src/screens/design-bench.js'];
  // block comments blanked first (same shape as audit-text/audit-geometry's
  // own solver scan) so prose explaining this very rule cannot trip it; a
  // trailing // LABEL:/DEFAULT: marker is how a real survivor clears itself,
  // so the marker is read off the RAW line, never the blanked one
  const blankK=t=>t.replace(/[^\n]/g,' ');
  const KIND_READ=/\.(?:k|kind)\s*(?:===|!==)|\.(?:k|kind)\.indexOf\(|\[[\w.]*\.(?:k|kind)\]/;
  const MARK=/\/\/\s*(LABEL|DEFAULT):/;
  const violations=[];
  for(const f of SCAN_FILES){
    const raw=fsK.readFileSync(pathK.join(ROOTK,f),'utf8');
    const rawLines=raw.split('\n');
    const codeLines=raw.replace(/\/\*[\s\S]*?\*\//g,blankK).split('\n');
    for(let i=0;i<codeLines.length;i++){
      const code=codeLines[i].split('//')[0];   // drop the line's own // comment before testing CODE
      if(KIND_READ.test(code) && !MARK.test(rawLines[i]))
        violations.push(`${f}:${i+1} ${rawLines[i].trim()}`);
    }
  }
  kindPermChecks.push(['no unlabelled kind read', violations.length===0,
    violations.length? violations.join(' | ') : `${SCAN_FILES.join(', ')}: every .k/.kind read carries a LABEL or DEFAULT tag`]);

  // fault injection, the audit-text.js/audit-dom.js idiom: prove the scan
  // actually goes red before trusting that it stayed green above. Restored
  // immediately - this never touches the file on disk for more than the one
  // synchronous check.
  const stock=fsK.readFileSync(pathK.join(ROOTK,'src/data/pipenet.js'),'utf8');
  // \r?\n rather than a literal \n - the file is CRLF on disk (git config),
  // and a literal-string anchor silently no-ops on that line ending
  const faulted=stock.replace(
    /if\(builtKeys\.has\(r\.key\)\) continue;/,
    'if(r.k !== "hot" && r.k !== "cold") continue;\r\n    if(builtKeys.has(r.key)) continue;');
  if(faulted===stock){
    kindPermChecks.push(['inject: a kind permission', false, 'the fault-injection anchor text was not found - update it, this proves nothing while it silently no-ops']);
  } else {
    const fBlank=faulted.replace(/\/\*[\s\S]*?\*\//g,blankK).split('\n');
    const fRaw=faulted.split('\n');
    let caught=false;
    for(let i=0;i<fBlank.length;i++){
      const code=fBlank[i].split('//')[0];
      if(KIND_READ.test(code) && !MARK.test(fRaw[i])){ caught=true; break; }
    }
    kindPermChecks.push(['inject: a kind permission', caught,
      caught? 'caught by "no unlabelled kind read" (re-injected if(r.k!=="hot"&&r.k!=="cold")continue;)'
            : 'the injected permission line was NOT flagged - the scan is not checking what it claims to']);
  }
}

/* Behavioural half of the same claim - a run is more than source text that
   parses; it has to actually be an edge, a tap target, a hit target and a
   spill point on the LIVE graph. Four assertions that used to be four
   different lists (netBuild()'s own comment), one per question. */
const kindBehaveChecks=[];
{
  // a run earlier in this file cleared D.fit - the relief tank and its
  // header run are on the grid regardless (Stage 5a), but checks 1/2 want
  // the FITTING'S OWN branch on the graph too, so put one back, the same
  // setup nozChecks above already uses
  M.D().fit={}; makeLoops(M,1); M.commission();
  { const hot=M.pipeNetwork().find(r=>r.k==="hot");
    M.addFit('relief',hot.key,0.9,M.reliefHeaderKey(M.pipeNetwork())||'relief:x',0.5); }
  M.commission();
  const net=M.P().net;

  // 1. EVERY RUN IS IN THE SOLVE: every routed run's key is the key of at
  // least one edge netBuild() actually built (surge and every xtie:* branch
  // fitting included - built by their own dedicated pass, not the general
  // loop, but still an edge in net.edges either way).
  const runKeys=M.pipeNetwork().filter(r=>r.key).map(r=>r.key);
  const edgeKeys=new Set(net.edges.map(e=>e.key));
  const notInSolve=runKeys.filter(k=>!edgeKeys.has(k));
  kindBehaveChecks.push(['every run is in the solve', notInSolve.length===0,
    notInSolve.length? `${notInSolve.length} routed run(s) with no matching edge: ${notInSolve.join(', ')}`
                      : `${runKeys.length} routed runs, every key present in net.edges`]);

  // 2. EVERY RUN CAN BE HIT: hittableRunKeys() must reach a run of a kind
  // that used to be permission-listed OUT (steam/feed/exh/relief), not just
  // the old hot/cold/hpi/xtie four.
  const hittable=M.hittableRunKeys(net);
  const newlyHittable=['steam:','feed:','exh:','relief:'].filter(pfx=>hittable.some(k=>k.startsWith(pfx)));
  kindBehaveChecks.push(['every run can be hit', newlyHittable.length===4,
    `${hittable.length} hittable run(s), including ${newlyHittable.join(', ')} - kinds the old four-item allowlist refused`]);

  // 3. EVERY RUN CAN BE TAPPED: a branch fitting landing on a formerly-
  // excluded kind (steam) must resolve to a REAL node - finite elevation,
  // present in net.z - not the old kind-gated fallback tapEndpoint() used to
  // take for a host this graph carried no edges for.
  const steamRun=M.pipeNetwork().find(r=>r.k==='steam');
  let tapResolved=false;
  if(steamRun){
    const fid=M.addFit('throttle', steamRun.key, 0.5, null, null);
    M.commission();
    const net2=M.P().net;
    tapResolved = net2.fitIds.includes(fid);
    M.removeFit(fid); M.commission();
  }
  kindBehaveChecks.push(['every run can be tapped', !!steamRun && tapResolved,
    steamRun? 'an in-line throttle on the steam run commissions and is live'
             : 'no steam run routed on this plant - cannot test']);

  // 4. EVERY RUN CAN SPILL: severing a formerly-excluded kind (steam) must
  // open a real break edge and register in outs.by, exactly like a severed
  // hot or cold leg always has.
  M.D().fit={}; M.commission();
  const s=M.S();
  const steamRun2=M.pipeNetwork().find(r=>r.k==='steam');
  let spillKey=0;
  if(steamRun2){
    s.dmgParts=['pipe:'+steamRun2.key];
    const outs={};
    M.netFlowK(s, null, null, outs);
    spillKey=(outs.by && outs.by['break:'+steamRun2.key]) || 0;
    s.dmgParts=[];
  }
  kindBehaveChecks.push(['every run can spill', !!steamRun2 && spillKey>0,
    steamRun2? `severed steam run spills ${spillKey.toFixed(4)} (break:${steamRun2.key})`
             : 'no steam run routed on this plant - cannot test']);
  M.D().fit={}; makeLoops(M,4); M.commission();
}

/* ══════════ STAGE 1B SURVIVORS: NAMED, NOT MERELY UNCAUGHT ══════════
   Two things the plan's survivors table keeps on purpose, each checked
   rather than trusted: drawSym()'s own per-part id ladder is ART and is
   named as an exemption in src/render/plant.js itself (not just missed by
   the regex above, which only reaches `.k`/`.kind`, never `.id`); and
   and a shut tank's own injection edge is really shut. That second one used
   to be the proof that pipeRuns()/drawPlant() hiding the HPI run was a VIEW
   declutter rather than a permission. THE DECLUTTER IS GONE - a line that is
   there and shut is the answer to "is my injection lined up", and a pipe that
   vanishes with its valve teaches an operator that a shut valve has no pipe
   behind it. The check stands, because the claim underneath it is the one
   that mattered all along: shut is g<=0, in the graph, whatever is drawn. */
const kindViewChecks=[];
{
  const fsV=require('fs'), pathV=require('path');
  const {ROOT:ROOTV}=require('./bundle');
  const plantSrc=fsV.readFileSync(pathV.join(ROOTV,'src/render/plant.js'),'utf8');
  const drawSymIdx=plantSrc.indexOf('function drawSym(');
  const exempted=drawSymIdx>=0 && /ART EXEMPT/.test(plantSrc.slice(Math.max(0,drawSymIdx-400),drawSymIdx));
  kindViewChecks.push(["drawSym()'s p.id ladder is a named ART exemption", exempted,
    exempted? 'an ART EXEMPT marker sits immediately above drawSym()'
             : 'no ART EXEMPT marker found above drawSym() - the exemption is implicit again']);

  M.D().fit={}; makeLoops(M,1); M.commission();
  const net=M.P().net;
  const hpiEdge=net.edges.find(e=>e.key && e.key.startsWith('hpi:'));
  const s=M.S(); s.hpi=false;
  const gOff=hpiEdge? hpiEdge.g(s) : null;
  kindViewChecks.push(['a shut injection tank is a shut edge', !!hpiEdge && gOff<=0,
    hpiEdge? `a shut injection tank gives the hpi edge g=${gOff} (<=0 required) - the run is still drawn, and still reads 0`
            : 'no hpi edge on this plant - cannot test']);
  makeLoops(M,4); M.commission();
}

/* ══════════ EVERY RUN SHOWS EVERY VALUE IT HAS, AND NO TWO SMEAR ══════════
   The three suppressors that used to keep this readable are deleted: one flow
   meter per KIND, a per-layer clash test that dropped the loser, and a filter
   that hid an injection run whose tank was shut. What replaced them is a
   per-frame ALLOCATOR (pipeAnchors(), pipes.js) - every run is offered several
   points along its own polyline and takes the first clear of the machines and
   of every reading already placed. So the property to pin is not "one label
   per kind" any more, it is: EVERY run got a place, and no two places overlap.
   Swept 1..4 loops, because the crowded case is the four-loop plant and that
   is exactly the one the old bucket was hiding. */
{
  for(const n of [1,2,3,4]){
    makeLoops(M,n); M.commission();
    const runs=M.pipeNetwork();
    M.pipeAnchorTick();
    const anch=M.pipeAnchors(runs);
    const missing=runs.filter(r=>!anch[r.key]).map(r=>r.key);
    let worst=null;
    /* THE BOXES THE ALLOCATOR ACTUALLY RESERVED, not a copy of its geometry
       written out again here - a mirror of STACK_W/STACK_H in this file would
       be a second source for the same rectangle and would drift off the first
       the day either constant moved. It already had: measured against a 64x33
       guess this reported three overlaps the allocator never made. */
    const boxes=M.pipeStackBoxes();
    for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++){
      const a=boxes[i], b=boxes[j];
      const ov=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
      const oy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
      if(ov>1 && oy>1 && (!worst||ov*oy>worst.area))
        worst={a:a.key,b:b.key,area:ov*oy,ov,oy};
    }
    kindViewChecks.push([n+' loop(s): every run gets a reading place', missing.length===0,
      missing.length? missing.length+' run(s) got none: '+missing.slice(0,4).join(', ')
                    : runs.length+' run(s), '+runs.length+' places']);
    kindViewChecks.push([n+' loop(s): no two reading places overlap', !worst,
      worst? worst.a+' and '+worst.b+' overlap by '+worst.ov.toFixed(0)+'x'+worst.oy.toFixed(0)+'px'
           : 'checked every pair']);
  }
  makeLoops(M,1); M.commission();
}

/* ══════════ ROLE: A PART ROLE IS A ROW (Stage 2) ══════════
   The other axis of Stage 1B's own rule: no file may match a part id against
   a literal or regex to decide PHYSICS. radMu()'s if-ladder, the tube-path/
   pump-head tests, the sgtr tests and coreFold()'s two-string comparison are
   gone from layout.js/rad.js/pipenet.js, replaced by ROLE (layout.js) - one
   row per part role, read by field (internal/head/fixed/fold/mu/sgtr), never
   by testing p.id itself. Scoped to the three files this stage actually
   rewrote, the same discipline the kind-permission scan above states for
   itself: a repo-wide version is later work, not a licence for this one to
   claim a reach it does not have. src/render/ is exempt by the same ART
   EXEMPT idiom (checked above); this scan does not reach it either way. */
const roleChecks=[];
{
  const fsR=require('fs'), pathR=require('path');
  const {ROOT:ROOTR}=require('./bundle');
  const SCAN_FILES=['src/data/layout.js','src/data/rad.js','src/data/pipenet.js'];
  const blankR=t=>t.replace(/[^\n]/g,' ');
  // .id.startsWith(/.indexOf( - the ladder idiom radMu/pipenet's old tube-
  // path and pump-head tests used; a bare "/^prefix.../ .test|exec(" only
  // when the prefix is one of this game's own part-role names, so a
  // structurally unrelated pattern (e.g. the tap-node parser's
  // /^tap:(.+):(a|b)$/) is not a false positive.
  const ID_MATCH=/\.id\.startsWith\(\s*["'`]|\.id\.indexOf\(\s*["'`]|\/\^(?:sg|pump|core|pzr|hpi|cont|reltk|turb|cond|feed|bkp|shld|rods|ctrl)\b[^\/\n]*\/\.(?:test|exec)\(/;
  const violations=[];
  for(const f of SCAN_FILES){
    const raw=fsR.readFileSync(pathR.join(ROOTR,f),'utf8');
    const rawLines=raw.split('\n');
    const codeLines=raw.replace(/\/\*[\s\S]*?\*\//g,blankR).split('\n');
    for(let i=0;i<codeLines.length;i++){
      const code=codeLines[i].split('//')[0];
      if(ID_MATCH.test(code)) violations.push(`${f}:${i+1} ${rawLines[i].trim()}`);
    }
  }
  roleChecks.push(['no id-match to decide physics', violations.length===0,
    violations.length? violations.join(' | ') : `${SCAN_FILES.join(', ')}: every physics decision reads ROLE, never p.id`]);

  // fault injection - prove the scan actually goes red, the audit-text.js/
  // audit-dom.js idiom already used above for the kind-permission scan.
  // Never touches the file on disk.
  const stock=fsR.readFileSync(pathR.join(ROOTR,'src/data/pipenet.js'),'utf8');
  const anchor='if(!R || !R.internal) continue;';
  const faulted=stock.replace(anchor, anchor+'\r\n    if(p.id.startsWith("sg")) { /* re-injected */ }');
  if(faulted===stock){
    roleChecks.push(['inject: an id-match ladder', false, 'the fault-injection anchor text was not found - update it, this proves nothing while it silently no-ops']);
  } else {
    const fBlank=faulted.replace(/\/\*[\s\S]*?\*\//g,blankR).split('\n');
    let caught=false;
    for(const line of fBlank) if(ID_MATCH.test(line.split('//')[0])){ caught=true; break; }
    roleChecks.push(['inject: an id-match ladder', caught,
      caught? 'caught by "no id-match to decide physics" (re-injected if(p.id.startsWith("sg")))'
            : 'the injected ladder was NOT flagged - the scan is not checking what it claims to']);
  }
}

/* ── behavioural half: ROLE is actually READ, not just absent from source ──
   Mutating a live row and watching the answer move is what tells "reads the
   table" apart from "the table happens to agree with a literal nobody
   deleted" - the identical proof shape moveTo() gives the frozen-pixel bug
   elsewhere in this file. Every mutation is undone before the next check. */
const roleBehaveChecks=[];
{
  // radMu() reads ROLE.mu, not an id ladder: two synthetic part-shaped
  // objects that were never placed at all, so this cannot be reading
  // anything but the role field.
  const muShield=M.radMu({role:'shield'}), muCore=M.radMu({role:'core'}), muNone=M.radMu({});
  roleBehaveChecks.push(['radMu() reads ROLE.mu', muShield===0.18 && muCore===0.50 && muNone===0.75,
    `role:shield -> ${muShield} (want 0.18), role:core -> ${muCore} (want 0.50), no role -> ${muNone} (want the documented 0.75 fallback)`]);
  const savedMu=M.ROLE().shield.mu;
  M.ROLE().shield.mu=0.42;
  const muMoved=M.radMu({role:'shield'});
  M.ROLE().shield.mu=savedMu;
  roleBehaveChecks.push(['radMu() is live against the table', muMoved===0.42,
    `ROLE.shield.mu set to 0.42 -> radMu() read ${muMoved} (a hardcoded ladder could not move)`]);

  // net2.pzrNode: ROLE.pzr.fixed, not a literal "pzrb" - proven by disabling
  // the declaration (no part can be removed to test this: pzr is
  // unconditional in buildLayout()) and watching the anchor fall back to the
  // core, exactly as netFixed()'s own comment promises.
  M.D().fit={}; makeLoops(M,1); M.commission();
  const coreIdx=M.P().net.index.core, pzrIdxBefore=M.P().net.pzrNode;
  const savedFixed=M.ROLE().pzr.fixed;
  M.ROLE().pzr.fixed=null;
  M.commission();
  const pzrIdxAfter=M.P().net.pzrNode;
  M.ROLE().pzr.fixed=savedFixed;
  M.commission();
  const pzrIdxRestored=M.P().net.pzrNode;
  roleBehaveChecks.push(['net2.pzrNode falls back through ROLE, not a literal', pzrIdxBefore!==coreIdx && pzrIdxAfter===coreIdx && pzrIdxRestored===pzrIdxBefore,
    `pzr declared: node ${pzrIdxBefore} (!= core ${coreIdx}); undeclared: falls back to core (${pzrIdxAfter}); restored: ${pzrIdxRestored}`]);

  // coreFold(): ROLE.core.fold, not the literal pair "corer"/"coreb" -
  // proven the same way: disable the declaration and watch the two faces
  // stop folding into one node. coreFold()'s own lookup is cached on the
  // ARRANGEMENT (laySig()), which a bare ROLE mutation does not change - so
  // an unrelated part is nudged one cell in the SAME move that flips the
  // declaration, so the cache cannot paper over a stale answer either side.
  const savedFold=M.ROLE().core.fold;
  const shld0=M.LAY().parts.find(q=>q.id==='shld0'), sx=shld0.x, sy=shld0.y;
  const nBefore=M.P().net.n;
  M.ROLE().core.fold=null;
  M.moveTo(shld0, sx===0?1:0, sy); M.commission();
  const nAfter=M.P().net.n;
  M.ROLE().core.fold=savedFold;
  M.moveTo(shld0, sx, sy); M.commission();
  roleBehaveChecks.push(['coreFold() folds through ROLE, not a literal pair', nAfter>nBefore,
    `core.fold declared: ${nBefore} nodes; undeclared (corer/coreb split): ${nAfter} nodes`]);
}

/* ── a tank's fixed node follows the part, never a frozen face ──
   It used to be authored as node:"hpib" and left there. The part's own link()
   (layout.js) picks its face live (face(hp,core)), so moving the tank across
   the core's centreline actually relands it on a different face - the
   scenario the old literal could never be shown wrong under, because
   pipeNetwork() itself never varied which face it used. netBuild() writes the
   CURRENT name back to net.tankNid every rebuild. */
const tankMoveChecks=[];
{
  M.D().fit={}; makeLoops(M,1); M.commission();
  const at=id=>M.LAY().parts.find(q=>q.id===id);
  const home={...at('hpi')};
  const nodeHome=M.P().net.tankNid.hpi, idxHome=M.P().net.tankNode.hpi;
  M.moveTo(at('hpi'), 0, home.y+3);           // west of the core's centreline -> face(hp,core) swings from "b" to "r"
  M.commission();
  const nodeMoved=M.P().net.tankNid.hpi, idxMoved=M.P().net.tankNode.hpi;
  // idxMoved is an ordinal into a DIFFERENT graph than idxHome came from -
  // two separate builds can coincidentally assign the same ordinal to a
  // differently-NAMED node, so the meaningful check is that the index
  // actually resolves back to the node the string itself now says.
  const nodeAtIdxMoved = idxMoved!==undefined ? M.P().net.nodes[idxMoved] : undefined;
  const idxResolves = nodeAtIdxMoved===nodeMoved;
  const s=M.S(); s.tankOpen.hpi=true; s.tank.hpi=100; s.pCore=0;
  const injOk=M.netFlowK(s)>=0;                // the moved tank's edge still solves (no dangling node)
  M.moveTo(at('hpi'), home.x, home.y);
  M.commission();
  const nodeBack=M.P().net.tankNid.hpi, idxBack=M.P().net.tankNode.hpi;
  tankMoveChecks.push(
    ['stock HPI tank node', nodeHome==='hpib' && idxHome!==undefined,
     `net.tankNid.hpi=${nodeHome}, net.tankNode.hpi=${idxHome}`],
    ['moved HPI tank: the fixed node follows', nodeMoved!=='hpib' && nodeMoved!=null && idxResolves,
     `moved west of the core -> net.tankNid.hpi=${nodeMoved} (was hpib), net.tankNode.hpi=${idxMoved} resolves to "${nodeAtIdxMoved}"`],
    ['inject: the frozen literal', nodeMoved!=='hpib',
     nodeMoved!=='hpib' ? `caught: a stored "hpib" would still be "hpib" after the move; this is "${nodeMoved}"`
                         : 'the node did not move with the part - the derivation is still frozen'],
    ['the moved tank still solves', injOk, `netFlowK=${M.netFlowK(s)} (finite and >= 0 required)`],
    ['HPI tank comes home unchanged', nodeBack===nodeHome && idxBack===idxHome,
     `back at the stock position: net.tankNid.hpi=${nodeBack}, net.tankNode.hpi=${idxBack}`]);
  makeLoops(M,4); M.commission();
}

/* ══════════ A PIPE IS A THING THAT EXISTS (Stage 3a) ══════════
   pipeNetwork() used to CONJURE every run on the plant from a hard-coded
   `link()` call against two part ids - a generator was always between the
   core and a pump, the surge line always dropped on loop 0's hot leg,
   whatever the design actually held. D.run (design.js) replaces that: a
   run is declared, plain data, and pipeNetwork() (layout.js) only computes
   its ROUTE - which face a dynamic end leaves from, where a tap-ended run
   lands - never its TOPOLOGY. */
const runDataChecks=[];
{
  const fsD=require('fs'), pathD=require('path');
  const {ROOT:ROOTD,scriptPaths:scriptPathsD}=require('./bundle');
  const blankD=t=>t.replace(/[^\n]/g,' ');
  // a call against two part ids, string kind first - the exact shape every
  // deleted link() had. Comments stripped first, same idiom as the
  // kind-permission scan above.
  const LINK_CALL=/\blink\(\s*["'][a-zA-Z]/;
  const violations=[];
  for(const f of scriptPathsD()){
    const raw=fsD.readFileSync(pathD.join(ROOTD,f),'utf8');
    const rawLines=raw.split('\n');
    const codeLines=raw.replace(/\/\*[\s\S]*?\*\//g,blankD).split('\n');
    for(let i=0;i<codeLines.length;i++){
      const code=codeLines[i].split('//')[0];
      if(LINK_CALL.test(code)) violations.push(`${f}:${i+1} ${rawLines[i].trim()}`);
    }
  }
  runDataChecks.push(['no link() written against two part ids', violations.length===0,
    violations.length? violations.join(' | ') : `${scriptPathsD().length} bundled files: no hard-coded topology call remains`]);

  // fault injection, same idiom as the kind-permission scan: prove the scan
  // actually goes red before trusting it stayed green above
  const stock=fsD.readFileSync(pathD.join(ROOTD,'src/data/layout.js'),'utf8');
  const anchor='function pipeNetwork(){';
  const faulted=stock.replace(anchor, anchor+'\r\n  link("hot",core,"r",sg,"l");');
  if(faulted===stock){
    runDataChecks.push(['inject: a hard-coded link()', false, 'the fault-injection anchor text was not found - update it, this proves nothing while it silently no-ops']);
  } else {
    const fBlank=faulted.replace(/\/\*[\s\S]*?\*\//g,blankD).split('\n');
    let caught=false;
    for(const line of fBlank) if(LINK_CALL.test(line.split('//')[0])){ caught=true; break; }
    runDataChecks.push(['inject: a hard-coded link()', caught,
      caught? 'caught by "no link() written against two part ids" (re-injected link("hot",core,"r",sg,"l"))'
            : 'the injected link() was NOT flagged - the scan is not checking what it claims to']);
  }

  // every routed run traces to a D.run entry: pipeNetwork()'s own key format
  // is "kind:aIdFace-bIdFace" (or "kind:aIdFace" for a tap), so a key this
  // scan cannot reconstruct from SOME D.run entry (resolving its dynamic
  // faces live) would mean a run pipeNetwork() drew that D.run never declared
  makeLoops(M,4); M.commission();
  const declaredKeys=new Set();
  for(const rid in M.D().run){
    const e=M.D().run[rid];
    const a=M.LAY().parts.find(q=>q.id===e.a);
    if(!a) continue;
    if(e.tap){ declaredKeys.add(e.k+':'+a.id+e.af); continue; }
    const b=M.LAY().parts.find(q=>q.id===e.b);
    if(!b) continue;
    const sa=e.af!=null?e.af:M.face(a,b), sb=e.bf!=null?e.bf:M.face(b,a);
    declaredKeys.add(e.k+':'+a.id+sa+'-'+b.id+sb);
  }
  // xtie:* is a branch FITTING's own run - D.fit's domain, not D.run's
  const routed=M.pipeNetwork().filter(r=>!r.key.startsWith('xtie:'));
  const untraced=routed.filter(r=>!declaredKeys.has(r.key));
  runDataChecks.push(['every routed run traces to D.run', untraced.length===0,
    untraced.length? `${untraced.length} routed run(s) with no D.run entry: ${untraced.map(r=>r.key).join(', ')}`
                    : `${routed.length} routed run(s), every key resolves off a D.run entry`]);

  // a part with no run reaching it contributes NOTHING to the solve: delete
  // the one D.run entry naming the relief header - the tank is still on the
  // grid (a placed part now, Stage 5a, on the grid whether or not any
  // relief fitting exists) but becomes electrically unreachable, no edge in
  // net.edges touches one of its nodes. Its own branch fitting does NOT lose its
  // route the same way any more (Stage 4): a relief valve is never allowed
  // nowhere to vent, so it falls back to pipenet.js's own containment
  // target instead of the tank it can no longer reach - "a part with no run
  // contributes nothing" and "a relief valve always has somewhere to vent"
  // are both true at once, because the fitting's own branch is not the part
  // that went missing.
  M.D().fit={}; M.commission();
  const hotKey=M.pipeNetwork().find(r=>r.k==='hot').key;
  M.addFit('relief',hotKey,0.9,M.reliefHeaderKey(M.pipeNetwork())||'relief:x',0.5);
  M.commission();
  const savedRelief=M.D().run.relief;
  delete M.D().run.relief;
  M.commission();
  const net2=M.P().net;
  const fidNow=Object.keys(M.D().fit)[0];
  const reltkEdges=net2.edges.filter(e=>(e.key&&e.key.indexOf('reltk')>=0));
  const xtieStillRoutes=M.pipeNetwork().some(r=>r.key.startsWith('xtie:'));
  const targetsContainment=net2.fitTarget && net2.fitTarget[fidNow]===null;
  M.D().run.relief=savedRelief;
  M.commission();
  const restoredEdges=M.P().net.edges.filter(e=>e.key&&e.key.indexOf('reltk')>=0).length;
  runDataChecks.push(['a part with no run touches no edge', reltkEdges.length===0,
    `relief header entry removed from D.run: ${reltkEdges.length} edges reach reltk (want 0)`]);
  runDataChecks.push(['...but the valve still vents, to containment', xtieStillRoutes && targetsContainment,
    `branch fitting still routed: ${xtieStillRoutes} (want true), fitTarget: ${net2.fitTarget && net2.fitTarget[fidNow]} (want null - containment, pipenet.js's own fallback)`]);
  runDataChecks.push(['...and comes back once the run is restored', restoredEdges>0,
    `${restoredEdges} edges reach reltk once D.run.relief is put back`]);
  M.D().fit={};

  // no connection is refused for what a component is FOR: author a run from
  // the core straight to the condenser - nothing says a hot leg goes to a
  // generator, so nothing may refuse this one. It does not have to cool
  // anything (Stage 6 owns heat); it must only fail to be REFUSED.
  makeLoops(M,1); M.commission();
  M.D().run.__auditTest={a:'core',af:null,b:'cond',bf:null,k:'test',bore:1};
  M.commission();
  const testRun=M.pipeNetwork().find(r=>r.k==='test');
  const testEdge=testRun && M.P().net.edges.find(e=>e.key===testRun.key);
  const gVal=testEdge? (typeof testEdge.g==='function'? testEdge.g(M.S()) : testEdge.g) : null;
  const flowsOk=Number.isFinite(M.netFlowK(M.S()));
  delete M.D().run.__auditTest;
  M.commission();
  runDataChecks.push(['no connection refused for what a part is FOR', !!testRun && !!testEdge && gVal>0 && flowsOk,
    testRun? `core-condenser run routed (${testRun.pts.length} pts), edge g=${gVal}, netFlowK finite=${flowsOk}`
            : 'a run from core to condenser was never routed at all']);

  // The headline example, in full: reactor -> condenser -> RCP -> reactor,
  // authored as three ordinary D.run entries, nothing checking what any of
  // it is FOR. B/C land on pump0's own t/b faces on purpose - the SAME two
  // nodes its real head edge (comp:pump0, pipenet.js) already spans - so
  // this loop is not merely present in the matrix, it shares an electrical
  // path with the one component in it that actually pushes current, and
  // "solves" and "circulates" cannot be confused with one another: a
  // network that merely factors without NaN would still pass the first and
  // fail the second if this loop dead-ended anywhere. Three assertions on
  // purpose, because "it was refused" and "it cooked" must never be
  // confusable either - the third is stated and left UNASSERTED, not faked.
  makeLoops(M,1); M.commission();
  M.D().run.__auditA={a:'core',af:null,b:'cond',bf:null,k:'test',bore:1};
  M.D().run.__auditB={a:'cond',af:null,b:'pump0',bf:'t',k:'test',bore:1};
  M.D().run.__auditC={a:'pump0',af:'b',b:'core',bf:null,k:'test',bore:1};
  M.commission();
  const net3=M.pipeNetwork();
  const legs=['__auditA','__auditB','__auditC'].map(rid=>net3.find(r=>r.rid===rid));
  const allRouted=legs.every(Boolean);
  const byRun={};
  const kLoop=M.netFlowK(M.S(),byRun);
  const solves=allRouted && Number.isFinite(kLoop);
  const flows=legs.map(r=>r?(byRun[r.key]||0):0);
  const circulates=allRouted && flows.every(f=>f>1e-6);
  delete M.D().run.__auditA; delete M.D().run.__auditB; delete M.D().run.__auditC;
  M.commission();
  runDataChecks.push(['reactor-condenser-RCP-reactor: it solves', solves,
    allRouted? `all 3 legs routed (${legs.map(r=>r.pts.length).join('/')} pts), netFlowK finite=${Number.isFinite(kLoop)}`
             : 'the loop was never fully routed - one or more legs found no D.run entry']);
  runDataChecks.push(['...and it circulates', circulates,
    allRouted? `per-leg flow through pump0's own head edge: ${flows.map(f=>f.toExponential(2)).join(', ')}`
             : 'not routed, so there is nothing to measure flow on']);
  runDataChecks.push(['...whether it COOKS is pending Stage 6a - not asserted here', true,
    'heat transfer is a property of the PARTS (ROLE.thermal), not the pipes - Stage 1/3a generalise hydraulics only, and the tick does not read ROLE.thermal yet. This loop genuinely removes no heat today; asserting otherwise here would fake Stage 6a rather than defer to it.']);

  // Loop membership comes off the graph now (loopOf()/loopMap(), layout.js),
  // never a proximity guess - nearestLoop() (Euclidean distance to the
  // nearest pump) and farTapForLoop() (nearest point to a fixed reference
  // corner) are both gone outright, not merely unused. Named identifiers,
  // scanned across the whole bundle: a name reappearing anywhere is the
  // guess coming back, whatever calls it.
  {
    const banned=['nearestLoop','farTapForLoop','nearestRunOfLoop'];
    const nameHits=name=>{ const re=new RegExp('\\b'+name+'\\b'); const hits=[];
      for(const f of scriptPathsD()){
        const raw=fsD.readFileSync(pathD.join(ROOTD,f),'utf8');
        const rawLines=raw.split('\n');
        const codeLines=raw.replace(/\/\*[\s\S]*?\*\//g,blankD).split('\n');
        for(let i=0;i<codeLines.length;i++) if(re.test(codeLines[i].split('//')[0])) hits.push(`${f}:${i+1} ${rawLines[i].trim()}`);
      }
      return hits;
    };
    const found=banned.flatMap(n=>nameHits(n).map(h=>`${n} @ ${h}`));
    runDataChecks.push(['nearestLoop()/farTapForLoop() do not exist', found.length===0,
      found.length? found.join(' | ') : `${scriptPathsD().length} bundled files: neither proximity guess remains, by name`]);

    // fault injection: prove the scan actually goes red, same idiom as
    // every other "X no longer exists" check above
    const stockDB=fsD.readFileSync(pathD.join(ROOTD,'src/screens/design-bench.js'),'utf8');
    const anchorDB='function ctxResolveDesign(p,extra){';
    const faultedDB=stockDB.replace(anchorDB, 'function nearestLoop(gx,gy){ return 0; }\r\n'+anchorDB);
    if(faultedDB===stockDB){
      runDataChecks.push(['inject: nearestLoop() reappears', false, 'the fault-injection anchor text was not found - update it, this proves nothing while it silently no-ops']);
    } else {
      const reNL=/\bnearestLoop\b/;
      let caught=false;
      const faultedBlank=faultedDB.replace(/\/\*[\s\S]*?\*\//g,blankD).split('\n');
      for(const line of faultedBlank) if(reNL.test(line.split('//')[0])){ caught=true; break; }
      runDataChecks.push(['inject: nearestLoop() reappears', caught,
        caught? 'caught by "nearestLoop()/farTapForLoop() do not exist" (re-injected function nearestLoop(gx,gy){ return 0; })'
              : 'the injected function was NOT flagged - the scan is not checking what it claims to']);
    }
  }

  // D.run survives a store.js round trip (packVal/unpackVal) unchanged, and
  // rides designSig() the same way D.fit already does
  const before=JSON.parse(JSON.stringify(M.D().run));
  const roundTripped=M.unpackVal(M.packVal(M.D().run));
  const rtOk=JSON.stringify(roundTripped)===JSON.stringify(before);
  const sig0=M.designSig();
  M.D().run.__auditTest={a:'core',af:null,b:'cond',bf:null,k:'test',bore:1};
  const sig1=M.designSig();
  delete M.D().run.__auditTest;
  const sig2=M.designSig();
  runDataChecks.push(['D.run survives a store round trip', rtOk,
    rtOk? 'packVal() then unpackVal() reproduces D.run exactly' : 'the round trip changed D.run'],
    ['D.run rides designSig()', sig0===sig2 && sig1!==sig0,
    `unchanged D.run: same signature; a run added then removed: ${sig1!==sig0?'moved then':'DID NOT move'} came back to ${sig0===sig2?'the same signature':'a different one'}`]);
  M.commission();
}

const checks=[
 // the plant pans/zooms now, so it is FITTED into whatever viewport it is
 // given rather than pinned to the right margin - only the left start and
 // square cells still have to hold
 ['grid starts on the margin', GX===12, `GX=${GX}`],
 ['grid is whole cells',      GW*CELL%GW===0, `${GW} x ${CELL} = ${GW*CELL} units wide`],
 ['one plant renderer',       S.includes('drawPlant(vy,null,vh,0,vw)') &&
                              S.includes('drawPlant(vy,S,vh,0,vw)'), 'design and control both call drawPlant'],
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
 ...retraceChecks,
 ...juncChecks,
 ...wpChecks,
 ...plantChecks,
 ...fitPanelChecks,
 ...layerChecks,
 ...actChecks,
 ...chartChecks,
 ...scnChecks,
 ...netKeyChecks,
 ...reliefChecks,
 ...nozChecks,
 ...kindPermChecks,
 ...kindBehaveChecks,
 ...kindViewChecks,
 ...roleChecks,
 ...roleBehaveChecks,
 ...tankMoveChecks,
 ...runDataChecks,
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
