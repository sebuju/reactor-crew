#!/usr/bin/env node
// Usage:  node tools/audit-text.js
const src=require('./bundle').bundle();

const TEXTS=[], RECTS=[];
function mkctx(){
  const st={font:'10px m',fillStyle:'#000',textAlign:'left',letterSpacing:'0px'};
  // sx/sy track ctx.scale(): the plant draws through a view transform, so its
  // text is in PLANT units and lands on the page scaled and offset
  let tx=0,ty=0,rot=0,sx=1,sy=1; const stack=[];
  // clip box built ONLY from ctx.rect() - a clip from any other path is
  // ignored, the permissive way round: a missed clip costs a false report, a
  // guessed one costs a missed fault
  let clipBox=null, pend=null;
  // text drawn through the plant's view transform is exempt from the 12..748
  // margin rule (that content is deliberately bigger than the viewport); the
  // collision check still applies to it
  const inView=()=>typeof global.__viewOn==='function' && global.__viewOn();
  const outside=(x0,x1,y)=>clipBox &&
    (x1<=clipBox.x0 || x0>=clipBox.x1 || y<=clipBox.y0 || y-12>=clipBox.y1);
  const size=()=>parseFloat(st.font.match(/([\d.]+)px/)[1]);
  const sp=()=>parseFloat(st.letterSpacing)||0;
  const wOf=t=>String(t).length*(0.60*size()+sp());
  return new Proxy(st,{
    get(t,k){
      if(k in st && typeof st[k]!=='function') return st[k];
      switch(k){
        case 'measureText': return t2=>({width:wOf(t2)});
        case 'save': return ()=>{ stack.push([tx,ty,rot,sx,sy,clipBox]); };
        case 'restore': return ()=>{ const v=stack.pop();
          if(v)[tx,ty,rot,sx,sy,clipBox]=v; };
        case 'beginPath': return ()=>{ pend=null; };
        case 'rect': return (x,y,w,h)=>{ pend={x0:tx+x*sx,y0:ty+y*sy,
                                               x1:tx+(x+w)*sx,y1:ty+(y+h)*sy}; };
        case 'clip': return ()=>{ if(!pend) return;
          clipBox = clipBox? {x0:Math.max(clipBox.x0,pend.x0),y0:Math.max(clipBox.y0,pend.y0),
                              x1:Math.min(clipBox.x1,pend.x1),y1:Math.min(clipBox.y1,pend.y1)}
                           : pend;
          pend=null; };
        case 'translate': return (dx,dy)=>{ tx+=dx*sx; ty+=dy*sy; };
        case 'scale': return (a,b)=>{ sx*=a; sy*=(b===undefined?a:b); };
        case 'rotate': return r=>{ rot+=r; };
        case 'fillText': return (t2,x,y)=>{
          const w=wOf(t2)*sx, a=st.textAlign, s2=size();
          if(Math.abs(rot)>1e-6){          // rotated: swap the bounding box axes, ~1 scaled em wide
            const rx0=tx+x*sx-s2*sx, rx1=tx+x*sx+s2*sx, ry=ty+y*sy;
            if(outside(rx0,rx1,ry)) return;
            TEXTS.push({t:String(t2),x0:rx0,x1:rx1,y:ry,size:s2,screen:CUR,rot:true,view:inView()});
          } else {
            const x0 = (a==='right'? x*sx-w : a==='center'? x*sx-w/2 : x*sx)+tx;
            const yy = y*sy+ty;
            if(outside(x0,x0+w,yy)) return;
            TEXTS.push({t:String(t2),x0,x1:x0+w,y:yy,size:s2,screen:CUR,view:inView()});
          }
        };
        case 'fillRect': return (x,y,w,h)=>{ if(w>8&&h>8) RECTS.push({x,y,w,h,c:st.fillStyle,screen:CUR}); };
        case 'createLinearGradient': case 'createPattern': return ()=>({addColorStop(){}});
        case 'canvas': return {width:760,height:900};
        default: return ()=>{};
      }
    },
    set(t,k,v){ st[k]=v; return true; }
  });
}
let CUR='';
const proxy=mkctx();
global.document={getElementById:()=>({getContext:()=>proxy,addEventListener(){},style:{},
  getBoundingClientRect:()=>({left:0,top:0,width:760,height:900})}),
  createElement:()=>({getContext:()=>proxy}),addEventListener(){}};
global.window=global; global.performance={now:()=>1000}; global.devicePixelRatio=1;
global.requestAnimationFrame=()=>{}; global.addEventListener=()=>{};
// seeded so warmUp()'s combatHit() targets are reproducible: the sim's seed
// is itself drawn from Math.random() in resetPlant(), so pinning this pins
// every draw under it, and a collision cannot hide behind a lucky target draw
let rngSeed=20260824;
Math.random=()=>{ rngSeed=(rngSeed*1103515245+12345)&0x7fffffff;
                  return rngSeed/0x7fffffff; };
let LAYER_PURE=null;
const M=new Function(src.replace(/layoutMetrics\(\); layout\(\); requestAnimationFrame\(tick\);/,'layoutMetrics();')+
 '; return {drawDesign,drawOperate,drawScenario,drawOverlay,commission,step,sample,combatHit,'+
 'SCN:()=>SCN,setSCN:v=>SCN=v,scnClone,scnNew,scnGest,scnLimit,SCNPRE:()=>SCNPRE,scnRun,scnJudge,'+
 'setScnSel:v=>scnSel=v,setScnPlay:v=>scnPlay=v,setScnVerd:v=>scnVerd=v,GESTKEYS:()=>GESTKEYS,'+
 'ui:()=>ui,setScreen:v=>screen=v,S:()=>S,D:()=>D,setSplit,setSel:v=>sel=v,parts:()=>LAY.parts,'+
 'setDmg:v=>S.dmgParts=v,'+
 'drawTip,forceTip:t=>{isTouch=true;touchTip=Object.assign({},t,{until:1e15});},'+
 'TSCALE:()=>TSCALE,OVL:()=>ovlList(),ovlSet:v=>ovlOpen=v,vOn:()=>viewOn,'+
 'pipeNetwork,pipeWaypoints,nearestOn,placePart,addFit,removePart,removeFit,'+
 'REC:()=>REC,TR:()=>TR,simTick,recTick,recBranch,seek,'+
 'setLayer:(k,v)=>{LAYERS[k].on=v;}};')();
global.__viewOn=()=>M.vOn();

function cap(name,fn){ CUR=name; M.ui().widgets=[]; M.ui().tips=[]; try{fn();}catch(e){console.log('ERR',name,e.message);} }
// a tooltip only draws on hover, so it has to be forced; each is captured
// alone since only one is ever on screen and two together would report a
// stacking order as a collision
function capTips(tag){
  // indexed, not titled: several boxes can share a title (e.g. CONDENSER),
  // which would otherwise drop them into one collision bucket
  M.ui().tips.slice().forEach((t,i)=>
    cap(tag+i+':'+(t.title||'?'),()=>{ M.forceTip(t); M.drawTip(); }));
}
// recTick() runs directly because nothing in the sim calls the recorder; each
// warmUp() is also a fresh plant, so a root opens and the branch picker has
// something to draw in every sweep
function warmUp(){
  M.commission();
  for(let i=0;i<300;i++){ M.step(0.02); if(i%5===0) M.sample(); M.recTick(); }
  M.combatHit(); M.combatHit();
}
// before warmUp(), because the bench is reachable with no plant commissioned
// (P is still null) and has to survive that draw too
M.setScreen('design');
cap('precommission:design',M.drawDesign);

warmUp();

function sweep(tag){
  M.setScreen('design'); cap(tag+'design',M.drawDesign);
  /* Every panel on the control room is an OVERLAY now, and an overlay that is
     shut is a draw path that never runs. Walk them: closed, then one at a time.
     Miss this and six panels go unaudited the day they stop being stacked. */
  M.setScreen('operate');
  M.ovlSet(null); cap(tag+'plant',M.drawOperate); capTips(tag+'plant:');
  /* Each overlay is captured ALONE, not on top of the plant. It is opaque and
     it covers what is behind it, so auditing the two together reports the grid
     labels underneath as collisions - which is the auditor describing a
     stacking order rather than a fault. drawOperate() ran a line ago, so the
     viewport the overlay docks into is already set. */
  for(const o of M.OVL()){ M.ovlSet(o.k); cap(tag+'ovl:'+o.k,M.drawOverlay); }
  M.ovlSet(null);
  // drawScenario() must run before EACH drawOverlay(), not once before the
  // loop: it is what calls vBox() and sets the rectangle the overlay docks into
  M.setScreen('scenario');
  M.ovlSet(null); cap(tag+'scn',M.drawScenario); capTips(tag+'scn:');
  for(const o of M.OVL()){ M.ovlSet(o.k); cap(tag+'scnovl:'+o.k,M.drawOverlay); }
  M.ovlSet(null);
}
sweep('');
M.D().rps=false; warmUp(); sweep('norps:'); M.D().rps=true;
// stock sweep leaves the core selected, so it never draws the rod-drive
// inspector - the densest text in the plant
warmUp(); M.setSel('rods'); sweep('rods:');
// SPLIT with banks apart: a row per bank, four is the worst case
M.setSplit(true);
for(let b=0;b<M.S().rodZDem.length;b++) M.S().rodZDem[b]=0.15+b*0.25;
M.S().bankAuto[1]=false;
for(let i=0;i<600;i++) M.step(0.02);
sweep('split:');
M.setSplit(false); for(let i=0;i<20;i++) M.step(0.02);
sweep('ganging:');                 // mid-regang: the one state with a third button label
M.D().nbank=2; warmUp(); M.setSel('rods'); M.setSplit(true);
for(let i=0;i<200;i++) M.step(0.02);
sweep('split2:'); M.D().nbank=4; warmUp(); M.setSel('core');
// each inspector shows only the selected part's panel, so walk every part -
// the bench turbine and condenser panels once shipped unaudited this way
warmUp();
for(const part of M.parts()) { M.setSel(part.id); sweep('sel:'+part.id+':'); }
M.setSel('core');

// four loops: the only plant with a GANGED plate (steam gens, pumps)
{ const L0=M.D().loops;
  M.D().loops=4; warmUp(); M.setSel('sg2'); sweep('loops4:');
  M.D().loops=L0; warmUp(); M.setSel('core'); }

// fittings and a spare pump: neither exists on a default plant, so their
// valve mark / symbol / plate are draw paths nothing else here reaches
{ const L0=M.D().loops, J0=M.D().fit, PS0=M.D().pumpSize;
  M.D().loops=4; M.D().fit={}; M.D().pumpSize={};
  warmUp();                       // 4-loop LAY exists now, for the tap lookup below
  const tap=k=>{ const r=M.pipeNetwork().find(x=>x.key&&x.key.startsWith(k)); return [r.key,0]; };
  const j0=M.addFit('tee',...tap('cold:sg0'),...tap('cold:sg1'));
  M.addFit('throttle',...tap('cold:sg2'),...tap('cold:sg3'));
  const spare=M.placePart(n=>({id:'pumpX'+n,name:'RCP SPARE',w:1,h:1,x:9,y:5,col:'#57d38c',
    grp:'loop0',tip:'A spare coolant pump.',loop:0}));
  // re-commission after the fittings exist (P.fit bakes from them), then set
  // juncOpen - commission() would otherwise reset it
  warmUp(); M.S().juncOpen[j0]=true;
  M.setSel(spare.id); sweep('spare:');
  M.setSel('core'); sweep('junc:');
  warmUp(); M.setDmg(M.parts().map(p=>p.id)); sweep('juncdmg:');
  // placedParts is a persistent array outside D; removePart() is the only way
  // to take the spare back out before the block's other fields are restored
  M.removePart(spare.id);
  M.D().loops=L0; M.D().fit=J0; M.D().pumpSize=PS0; warmUp(); M.setSel('core'); }

// a steered pipe: two waypoints draw five grips where a plain run draws one
{ warmUp();
  const key=M.pipeNetwork().find(r=>r.k==='hot').key;
  M.pipeWaypoints[key]=[{x:400,y:500},{x:200,y:300}];
  sweep('wp:');
  delete M.pipeWaypoints[key]; warmUp(); }

// every component broken at once: the worst case for repair keys and STATUS rows
warmUp(); M.setDmg(M.parts().map(p=>p.id)); sweep('alldmg:');
warmUp();


// the sweeps above all draw the same scenario (first preset, three events,
// three limits, never run); these four reach states nothing else does:
// scnempty - no limits at all; scncrowd - 8 events/1 moment, 12 limits, panel
// overflow; scnlong - an hour, widest ruler labels; scnfail - a judged FAIL run
{ const keep=M.SCN();
  M.setSCN(M.scnNew('empty','EMPTY DRILL')); M.setScnVerd(null); M.setScnSel(-1);
  sweep('scnempty:');

  { const c=M.scnNew('crowd','CROWDED DRILL'); c.secs=120;
    for(let i=0;i<8;i++) M.scnGest(c,30,'note','EVERYTHING AT ONCE '+i);
    const chs=['dnbr','tf','tavg','prs','sub','lvl','inv','flow','load','rod','fq','trip'];
    chs.forEach((k,i)=>M.scnLimit(c,k,k,i%2?'>':'<',1,0.5));
    M.setSCN(c); M.setScnSel(0); M.setScnPlay(30); sweep('scncrowd:'); }

  { const l=M.scnNew('long','THE LONG WATCH'); l.secs=3600;
    M.scnGest(l,1800,'loadRamp',60,120); M.scnLimit(l,'dnbr','dnbr','>',1.3,0.5);
    M.setSCN(l); M.setScnSel(-1); M.setScnPlay(3600); sweep('scnlong:'); }

  // judged and FAILING: limits tight enough that the default plant cannot
  // hold them, so the loss-only columns are all populated
  { const f=M.scnClone(M.SCNPRE()[0]); f.secs=40;
    f.limits=[]; M.scnLimit(f,'dnbr','dnbr','>',9,0);
    M.scnLimit(f,'tavg','tavg','<',1,0); M.scnLimit(f,'pwr','pwr','>',999,0);
    M.scnLimit(f,'trip','trip','<',1,0); M.scnLimit(f,'inv','inv','>',99.9,0.5);
    const r=M.scnRun(f);
    M.setSCN(f); M.setScnVerd(r.verdict); M.setScnSel(-1); M.setScnPlay(20);
    sweep('scnfail:'); }

  M.setSCN(keep); M.setScnVerd(null); M.setScnSel(-1); M.setScnPlay(0); warmUp(); }

// the tape mid-scrub: every sweep above draws it LIVE (no replay keys, no
// fork marks, a picker of roots only), so build a tree here - four takes, two
// deep, one root forked twice, replay parked half way down a branch
{ warmUp();
  const rec=n=>{ for(let i=0;i<n;i++){ M.simTick(); M.recTick(); } };
  rec(500);
  const root=M.REC().takes[M.REC().cur];
  const t1=M.recBranch(root.id,root.tick0+200); rec(400);
  const t2=M.recBranch(t1.id,  t1.tick0+150);   rec(300);
  M.recBranch(root.id,root.tick0+320);          rec(200);
  t1.label="LOW FLOW DRILL";
  // a real verdict object, not a hand-written string, so a shape change in
  // scnJudge breaks this fixture instead of silently drawing [object Object]
  t1.verdict=M.scnJudge(t1,[{id:"dnbr",ch:"dnbr",cmp:">",v:0.1,grace:0}]);
  M.seek(t2.id,t2.tick0+120);                   // replay, half way down a branch
  sweep('tape:');
  // and the strip with no tape at all - lasts no frames in the real game
  // (recTick() runs before every draw) but is still a branch a throw can hide in
  { const c=M.REC().cur; M.REC().cur=-1;
    M.setScreen('operate'); M.ovlSet(null);
    cap('notape:plant',M.drawOperate); capTips('notape:plant:');
    M.REC().cur=c; }
}

// a NaN/undefined value draws happily with no error - only this check catches it
// ── the radiation layers, and they go LAST on purpose ──
// None of the sweeps above ever switch a layer on, so without this every
// rad*.js draw path would ship unaudited - exactly how the turbine and
// condenser bench panels once shipped unaudited before them.
// It sits at the end because warmUp() calls combatHit() twice, off the same
// pinned RNG stream every other sweep draws from. Run this in the middle and
// the extra warmUp() shifts that stream, every later sweep gets a DIFFERENT
// set of damaged parts, and the report changes for reasons that have nothing
// to do with the change under test. Last means there is no "later" to shift.
{ const keys=['radz','radn','radp','radc'];
  keys.forEach(k=>M.setLayer(k,true));
  warmUp(); sweep('rad:');
  // once at rest, once wrecked - a saturated field is where the zone fill
  // maxes out and the cell numbers print at their widest, which a plant at
  // rest never shows
  M.S().dmg=90; M.S().melt=true; M.S().release=95; M.S().sgtr=true; M.S().breach=true;
  for(let i=0;i<10;i++) M.step(0.02);
  sweep('radwreck:');
  keys.forEach(k=>M.setLayer(k,false)); }

// ── A LAYER IS A VIEW, AND THIS IS WHERE THAT STOPS BEING A COMMENT ──
// layers.js states the contract: a layer draws and never writes S. A comment
// cannot enforce it and neither can a grep - a draw callback could reach the
// plant through any helper it calls. So fly the same plant twice, drawing it
// every tick, once with every layer on and once with every layer off, and
// demand the two end states are identical field for field. The RNG seed is
// reset between runs because warmUp() spends draws on combatHit(): without
// that the two plants take different damage and the check fails for a reason
// that has nothing to do with layers.
{ const keys=['radz','radn','radp','radc'];
  const ser = o => JSON.stringify(o, (k,v) =>
    ArrayBuffer.isView(v) ? Array.from(v) : (typeof v === 'number' && !isFinite(v) ? String(v) : v));
  const fly = on => {
    rngSeed=20260824;
    keys.forEach(k=>M.setLayer(k,on));
    M.commission();
    for(let i=0;i<120;i++){ M.step(0.02); cap('purity'+(on?'On':'Off')+':'+i, M.drawOperate); }
    return ser(M.S());
  };
  const withLayers=fly(true), without=fly(false);
  keys.forEach(k=>M.setLayer(k,false));
  LAYER_PURE = withLayers===without;
}

console.log('=== A LAYER CANNOT MOVE THE PLANT ===');
console.log(LAYER_PURE
  ? '  120 ticks drawn with every layer on and off: final S identical field for field'
  : '  FAIL a layer changed the plant - a draw callback is writing sim state');
if(!LAYER_PURE) process.exitCode=1;

console.log('=== BROKEN VALUES IN DRAWN TEXT ===');
{ let n=0;
  for(const t of TEXTS) if(/NaN|undefined|Infinity/.test(t.t)){
    console.log(`  [${t.screen}] "${t.t.slice(0,60)}"`); n++; }
  console.log(n?`  ${n} broken value(s)`:'  none'); }

console.log('\n=== TEXT OFF THE DOCUMENTED TYPE SCALE ===');
{ const scale=M.TSCALE(); let n=0; const seen={};
  for(const t of TEXTS) if(!scale.includes(t.size) && !seen[t.size]){
    seen[t.size]=1;
    console.log(`  ${t.size}px  e.g. [${t.screen}] "${t.t.slice(0,40)}"`); n++; }
  console.log(n?`  ${n} off-scale size(s)`:'  none'); }

console.log('\n=== TEXT OUTSIDE THE 12..748 CONTENT MARGINS ===');
let n=0, inv=0;
for(const t of TEXTS){
  if(t.view){ if(t.x0<11.5||t.x1>748.5) inv++; continue; }
  if(t.x0<11.5 || t.x1>748.5){
    console.log(`  [${t.screen}] "${t.t.slice(0,42)}" x ${t.x0.toFixed(0)}..${t.x1.toFixed(0)} size ${t.size}`); n++; }
}
console.log(n?`  ${n} overflow(s)`:'  none');
console.log(`  (${inv} string(s) in the pannable plant view, not judged here)`);

console.log('\n=== TEXT COLLIDING WITH OTHER TEXT ON THE SAME LINE ===');
n=0;
const byScreen={};
for(const t of TEXTS){ (byScreen[t.screen]=byScreen[t.screen]||[]).push(t); }
for(const k in byScreen){
  const a=byScreen[k];
  for(let i=0;i<a.length;i++) for(let j=i+1;j<a.length;j++){
    if(Math.abs(a[i].y-a[j].y)>2||a[i].rot||a[j].rot) continue;
    const ov=Math.min(a[i].x1,a[j].x1)-Math.max(a[i].x0,a[j].x0);
    if(ov>1.5){ console.log(`  [${k}] "${a[i].t.slice(0,26)}" x "${a[j].t.slice(0,26)}" overlap ${ov.toFixed(0)}px @y${a[i].y.toFixed(0)}`); n++; }
  }
}
console.log(n?`  ${n} collision(s)`:'  none');

console.log('\n=== FONT SIZE HISTOGRAM ===');
const h={}; for(const t of TEXTS) h[t.size]=(h[t.size]||0)+1;
Object.keys(h).map(Number).sort((a,b)=>a-b).forEach(s=>console.log(`  ${String(s).padStart(5)}px  ${String(h[s]).padStart(4)} strings`));
console.log('  total',TEXTS.length);
