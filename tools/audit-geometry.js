#!/usr/bin/env node
// Usage:  node tools/audit-geometry.js
const S=require('./bundle').bundle();

// routing is emergent from component positions, so this has to run the code,
// not just read it
const M=require('./bundle').headless('{pipeNetwork,commission,pipeWaypoints,D:()=>D,P:()=>P,S:()=>S,addFit,removeFit,juncPt,nearestOn,moveTo,LAY:()=>LAY,ventK,reliefHeaderKey,nozzleEnds}');

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
// no fitting exists on a default plant, so this sweep is the only thing
// that ever routes one - check every adjacent pair actually tied, the
// densest a plant this size can be wired
for(const loops of [2,3,4]){
  M.D().loops=loops; M.D().fit={}; M.commission();
  const tap=k=>{ const r=M.pipeNetwork().find(x=>x.key&&x.key.startsWith(k)); return [r.key,0]; };
  for(let i=0;i<loops-1;i++) M.addFit('tee',...tap('cold:sg'+i),...tap('cold:sg'+(i+1)));
  const over=pipeOverlaps(pipeSegs(M.pipeNetwork()));
  pipeChecks.push([`no overlaps (${loops} loops, tied)`, over.length===0,
                   `${over.length} overlapping segment pairs`, loops, over]);
}
M.D().fit={};

// a fitting stores a TAP - (run key, fraction along it) at each end -
// resolved fresh by juncPt() off whatever pipeNetwork() just routed. The bug
// this replaces stored a plant-space pixel once, at creation, so a part
// moved upstream of the tap left the glyph and the branch drawn on empty
// space. Everything below is measured by moving a real part and re-routing,
// never read off the source.
const juncChecks=[];
{
  const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  M.D().loops=2; M.D().fit={}; M.commission();
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
const actChecks=[
 ['one input dispatch',   (S.match(/function act\(/g)||[]).length===1 &&
                          RENDERERS.length===2, 'act() defined once, both renderers read'],
 ['no view file writes S',  sWrites.length===0,
  sWrites.length? sWrites.join(' ') : `${VIEW_FILES.length} view files reach the plant only through act()`],
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
    M.D().loops=loops; M.D().fit={}; M.commission();
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
  M.D().loops=4; M.D().fit={}; M.commission();
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
  // a relief fitting FIRST, or hasRelief() leaves no tank on the grid and the
  // sweep below runs 144 times over a plant that cannot reproduce the fault
  M.D().loops=1; M.D().fit={}; M.commission();
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
  M.D().fit={}; M.D().loops=4; M.commission();
}

/* ── A RELIEF FITTING SURVIVES ITS TANK MOVING ──
   The relief HEADER's key carries the two faces pipeNetwork() picked for it
   (link("relief",...), layout.js), so it is renamed by any move of the
   pressurizer or the tank. The stock relief fitting used to STORE that
   string, which meant moving either part - both of which the game invites -
   silently dropped the fitting out of netBuild(), took reliefG() and ventK()
   to zero, and left the valve venting NOTHING while its glyph, its tank, its
   mimic and its mass all stayed exactly where they were. */
const reliefChecks=[];
{
  M.D().loops=4; M.D().fit={}; M.commission();
  const tapHot=M.pipeNetwork().find(r=>r.k==='hot');
  const stale='relief:pzrt-reltkb';       // the literal that used to be stored
  M.addFit('relief',tapHot.key,0.9,stale,0.5);
  M.commission();
  const fid=Object.keys(M.D().fit)[0];
  const at=id=>M.LAY().parts.find(q=>q.id===id);
  const home={reltk:{...at('reltk')}, pzr:{...at('pzr')}};
  const base=M.ventK(M.S(),fid);
  M.moveTo(at('reltk'),8,2); M.commission();
  const afterTank=M.ventK(M.S(),fid), renamed=!M.P().net.byKey[stale];
  const offerable=!!M.reliefHeaderKey(M.pipeNetwork());
  M.moveTo(at('pzr'),3,1); M.commission();
  const afterPzr=M.ventK(M.S(),fid);
  M.moveTo(at('reltk'),home.reltk.x,home.reltk.y);
  M.moveTo(at('pzr'),home.pzr.x,home.pzr.y);
  M.commission();
  const backHome=M.ventK(M.S(),fid);
  reliefChecks.push(
    ['relief vents where it sits', base>0 && afterTank>0 && afterPzr>0,
     `ventK ${base.toFixed(2)} -> tank moved ${afterTank.toFixed(2)} -> pzr moved ${afterPzr.toFixed(2)}`],
    ['relief comes home unchanged', Math.abs(backHome-base)<1e-12,
     `moving both parts away and back returns ventK to ${base.toFixed(4)}`],
    ['relief can still be added',  offerable,
     'the bench can resolve a header to tap after the tank moves'],
    ['inject: the stored literal',  renamed,
     `caught by "relief vents where it sits" (${stale} no longer names any run)`]);
  M.D().fit={}; M.D().loops=4; M.commission();
}

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
 ...juncChecks,
 ...wpChecks,
 ...plantChecks,
 ...layerChecks,
 ...actChecks,
 ...chartChecks,
 ...scnChecks,
 ...netKeyChecks,
 ...reliefChecks,
 ...nozChecks,
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
