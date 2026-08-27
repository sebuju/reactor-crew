#!/usr/bin/env node
// Usage:  node tools/audit-text.js
const fs=require('fs'), path=require('path');
const {ROOT}=require('./bundle');
const src=require('./bundle').bundle();
// Stage 3b: D.loops is gone from src/ - an n-loop test plant is built the
// same way a player builds one, through placed parts and real D.run entries.
const {makeLoops}=require('./loopgen');

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
 'ui:()=>ui,setScreen:v=>screen=v,S:()=>S,P:()=>P,D:()=>D,setSplit,setSel:v=>sel=v,parts:()=>LAY.parts,'+
 'setDmg:v=>S.dmgParts=v,'+
 'drawTip,forceTip:t=>{isTouch=true;touchTip=Object.assign({},t,{until:1e15});},'+
 'TSCALE:()=>TSCALE,OVL:()=>ovlList(),ovlSet:v=>ovlOpen=v,vOn:()=>viewOn,'+
 'pipeNetwork,pipeWaypoints,nearestOn,placePart,addFit,removePart,removeFit,'+
 'REC:()=>REC,TR:()=>TR,simTick,recTick,recBranch,seek,'+
 'FXR:()=>FXR,fxReset,porvRate,reliefRate,reliefFullRate,SPILL_FULL:()=>SPILL_FULL,'+
 'SGTR_RATE:()=>SGTR_RATE,tanks:()=>D.tanks,FLUID:()=>FLUID,AUTORULE:()=>AUTORULE,tankLvl,tankP,tankLive,tankOpen,tankIds,tankKg,tankRateRef,tankFluid,hostedTankIds,boronTankIds,addTank,primaryRelief,'+
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
{ makeLoops(M,4); warmUp(); M.setSel('sg2'); sweep('loops4:');
  makeLoops(M,1); warmUp(); M.setSel('core'); }

// fittings and a spare pump: neither exists on a default plant, so their
// valve mark / symbol / plate are draw paths nothing else here reaches
{ const J0=M.D().fit, PS0=M.D().pumpSize;
  makeLoops(M,4); M.D().fit={}; M.D().pumpSize={};
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
  makeLoops(M,1); M.D().fit=J0; M.D().pumpSize=PS0; warmUp(); M.setSel('core'); }

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
/* AND IT NEVER WRITES P EITHER, which is the sharper half of the same rule
   and the one a reader will get wrong. netFactored() caches its factorisation
   onto net.Af/net.AfSig, and net IS P.net - so a draw callback that asked the
   pipe network for a pressure would be writing to P from inside a layer, and
   audit-geometry's own scan of the view files looks for `S.` writes only. The
   two pressure layers therefore read a field drawPlant() refreshed once for
   the frame (pipeFieldRefresh(), pipes.js) and never solve; P.net.AfSig is
   captured alongside S below to prove they did not. */
{ const keys=['radz','radn','radp','radc','press','subc'];
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
/* AND IT NEVER WRITES P EITHER, which is the sharper half of the same rule
   and the one a reader will get wrong. netFactored() caches its factorisation
   onto net.Af/net.AfSig, and net IS P.net - so a draw callback that asked the
   pipe network for a pressure would be writing to P from inside a layer, and
   audit-geometry's own scan of the view files looks for `S.` writes only. The
   two pressure layers therefore read a field drawPlant() refreshed once for
   the frame (pipeFieldRefresh(), pipes.js) and never solve; P.net.AfSig is
   captured alongside S below to prove they did not. */
{ const keys=['radz','radn','radp','radc','press','subc'];
  const ser = o => JSON.stringify(o, (k,v) =>
    ArrayBuffer.isView(v) ? Array.from(v) : (typeof v === 'number' && !isFinite(v) ? String(v) : v));
  const fly = on => {
    rngSeed=20260824;
    keys.forEach(k=>M.setLayer(k,on));
    M.commission();
    for(let i=0;i<120;i++){ M.step(0.02); cap('purity'+(on?'On':'Off')+':'+i, M.drawOperate); }
    return ser(M.S()) + '|' + String(M.P().net.AfSig);
  };
  const withLayers=fly(true), without=fly(false);
  keys.forEach(k=>M.setLayer(k,false));
  LAYER_PURE = withLayers===without;
}

console.log('=== A LAYER CANNOT MOVE THE PLANT ===');
console.log(LAYER_PURE
  ? '  120 ticks drawn with every layer on and off: final S identical field for field, and the same P.net factorisation'
  : '  FAIL a layer changed the plant - a draw callback is writing sim state, or solving the pipe network into P');
if(!LAYER_PURE) process.exitCode=1;

/* ══════════ AN EFFECT DRAWS THE RATE THE SIM IS PASSING ══════════
   A pressure effect has four things to get right: it must be driven by the
   SOLVED quantity and not a proxy, drawn where the physics happens, start and
   stop with the thing it depicts, and run at the simulation's rate. Three of
   them were wrong at once: the HPI jet and the tube-rupture jet were literally
   `?1:0`, and the PORV plume recomputed a vent term the tick had since given a
   back-pressure factor - so the picture over-stated the vent by exactly that
   factor, and the error grew as the tank filled.

   fxEase() smooths a rate across frames, so the RAW argument is not readable
   afterwards - except on the first call for a key, which stores it verbatim.
   fxReset() then one draw is therefore an exact read of what every effect was
   handed, to the last bit. Same identity P.dose already gets: not "close". */
const FX = {};
function fxRead(){
  M.fxReset();
  cap('fxprobe:'+(FX.n=(FX.n||0)+1), M.drawOperate);
  const out={}; const r=M.FXR();
  for(const k in r) out[k]=r[k].v;
  return out;
}
const near=(a,b)=>a!=null&&b!=null&&Math.abs(a-b)<=1e-12;
const fxChecks=[];
const fxAdd=(n,ok,detail)=>fxChecks.push([n,ok,detail]);

/* 1. NO PRESSURE EFFECT IS BOOLEAN-DRIVEN. Named keys, not a blanket ban: rod
      jam, DNB, blackout dark, backup supply and repair sparks depict LATCHES,
      and `?1:0` is the honest driver for those. */
{
  const src=fs.readFileSync(path.join(ROOT,'src/render/plant.js'),'utf8')
             .replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  const bad=[];
  for(const key of ['breach','porv','boil','hpi','sgtr']){
    const tag='fxEase(id+":'+key+'"';
    let k=-1;
    while((k=src.replace(/\s+/g,'').indexOf(tag,k+1))>=0){
      const flat=src.replace(/\s+/g,'');
      const arg=flat.slice(k+tag.length, flat.indexOf(')', k+tag.length));
      if(arg.indexOf('?1:0')>=0) bad.push(key);
    }
  }
  fxAdd('no pressure effect is boolean-driven', bad.length===0,
    bad.length? bad.join(', ')+' still drawn off a flag'
              : 'breach, porv, boil, hpi and sgtr all read a solved quantity');
}

/* 2. THE RATE MATCHES, NUMERICALLY. Fly a plant into every pressure effect at
      once - a hole in the vessel, a lifted relief valve, injection running and
      one generator's tubes gone - and demand each eased argument IS the sim
      number it claims. */
{
  rngSeed=20260824;
  // FOUR loops on purpose: a one-loop plant cannot show that a rupture stays
  // on the machine that was hit, which is half of what this block is for.
  makeLoops(M,4);
  M.commission();
  const S=M.S();
  const sgIds=M.parts().filter(p=>p.id.startsWith('sg')).map(p=>p.id);
  const hurt=sgIds[1];
  M.setDmg([hurt]);
  S.hpi=true; S.breach=true;
  for(let i=0;i<40;i++) M.step(0.02);
  const f=fxRead();
  const cl=(v,a,b)=>Math.max(a,Math.min(b,v));
  const want={
    'core:breach': cl((S.spillBy['break:core']||0)/M.SPILL_FULL(),0,1),
    'core:boil'  : cl(S.vf/0.6,0,1),
    'hpi:inj'    : cl(((S.tankRate&&S.tankRate.hpi)||0)/M.tankRateRef('hpi'),0,1),
  };
  want[hurt+':sgtr'] = cl((S.sgtrBy['sgtr:'+hurt]||0)/M.SGTR_RATE(),0,1);
  const off=Object.keys(want).filter(k=>!near(f[k],want[k]));
  fxAdd('every effect runs at the sim rate', off.length===0,
    off.length? off.map(k=>k+': drawn '+f[k]+' vs sim '+want[k]).join('; ')
              : Object.keys(want).length+' effect(s) identical to the sim to 1e-12');

  /* 3b. POSITION MATTERS. The leak belongs to the generator that was hit. */
  const wrong=sgIds.filter(id=>id!==hurt && (f[id+':sgtr']||0)>0);
  fxAdd('only the ruptured generator leaks',
    sgIds.length>1 && wrong.length===0 && (f[hurt+':sgtr']||0)>0,
    wrong.length? wrong.join(', ')+' drew a leak they do not have'
                : 'the leak is on '+hurt+' alone, '+(sgIds.length-1)+' intact generator(s) dry');
  makeLoops(M,1);
}

/* 3. IT STOPS. A break run to equalisation with containment must stop drawing,
      and a relief valve held open into a filling tank must fade with the
      DELIVERED rate rather than hold at the valve's position. */
{
  rngSeed=20260824;
  M.commission();
  const S=M.S();
  S.breach=true;
  for(let i=0;i<40;i++) M.step(0.02);
  const early=fxRead()['core:breach'];
  for(let i=0;i<12000;i++) M.step(0.02);
  const late=fxRead()['core:breach'];
  /* not exactly 0: s.P is floored at min(6% of P0, Pcont) so a hair of
     differential survives forever. What matters is that it collapses with the
     hole instead of blowing at full rate for as long as the flag is latched -
     it was 1.0 at 240 s before the plume read its own solved outflow. */
  fxAdd('a break stops when it equalises', early>0.01 && late<early*0.02,
    'breach plume '+early.toFixed(4)+' at 0.8 s, '+late.toFixed(6)+' at 240 s ('
      +(100*late/early).toFixed(1)+'% of it)');
}
{
  rngSeed=20260824;
  M.commission();
  const S=M.S();
  const fid=Object.keys(S.reliefOpen||{})[0];
  S.reliefOpen[fid]=true; S.reliefBlocked[fid]=false; S.reliefAuto[fid]=false;
  S.tank.reltk=0;
  for(let i=0;i<5;i++) M.step(0.02);
  /* the whole usable range: the gas sits at containment pressure empty (so an
     untouched plant is bit-for-bit 1) and the rupture disc bursts at 1.4 MPa,
     which the tank reaches at about 91% - so ~5% is all the back-pressure a
     player can ever see, and the point is that it is THERE and MONOTONE, not
     that it is large. It was flat at 1.000 across all of it. */
  const lv=[0,45,90].map(l=>{ S.tank.reltk=l; return fxRead()['pzr:porv']; });
  const mono=lv[0]>lv[1] && lv[1]>lv[2];
  /* Not exactly 1 at an empty tank any more: the plume is now drawn against
     reliefFullRate() (pipenet.js), each fitting's OWN ceiling off the SAME
     BREAK_K*bore*bore its edge is actually priced with - a live, solved
     ratio, not a pre-fitted reference tuned to read 1.000 at rest. What
     survives, and is still the whole claim, is that it is LESS than 1 (the
     valve never draws more than its own theoretical full-open rate) and
     MONOTONE as the tank's own gas pressure rises against it. */
  fxAdd('a filling relief tank shrinks the plume',
    S.reliefOpen[fid] && lv[0]<=1+1e-9 && lv[0]>0 && mono && lv[2]<lv[0],
    'valve still open, plume '+lv.map(v=>v.toFixed(4)).join(' -> ')+' at 0/45/90% tank');
  /* and the plume IS THE TICK'S OWN VENT TERM. Against reliefRate()/
     reliefFullRate() rather than against porvRate() alone: comparing the
     renderer with itself would have stayed green through the whole defect,
     because both readers came off the one renderer-side expression that had
     gone stale. */
  S.tank.reltk=60;
  const drawn=fxRead()['pzr:porv'];
  const sim=Math.max(0,Math.min(1, M.reliefRate(S,fid)/Math.max(1e-9,M.reliefFullRate(S,fid))));
  fxAdd('the PORV plume is the tick vent term', near(drawn,sim) && drawn>0,
    near(drawn,sim)? 'plume '+drawn.toFixed(6)+' = reliefRate()/reliefFullRate() at a 60% tank'
                   : 'plume '+drawn+' vs the tick '+sim);
  // and the panel row reads the same one number - porvRate() IS reliefRate()
  // of the primary fitting now, not a ratio against a deleted reference
  fxAdd('the RELIEF FLOW row is that number too',
    near(M.porvRate(S), M.reliefRate(S,fid)), 'RELIEF FLOW = reliefRate() = '+M.reliefRate(S,fid).toFixed(6));
}

/* 4. IT DOES NOT SURVIVE A SCRUB. FXR is display state, cleared by hand
      whenever the clock moves - beside the display smoothing in pipes.js.
      fxReset() is called from record.js and step.js behind a typeof guard so
      the no-DOM probe still flies, and nothing has ever asserted it works. */
{
  fxRead();
  const before=Object.keys(M.FXR()).length;
  M.fxReset();
  const after=Object.keys(M.FXR()).length;
  fxAdd('an effect does not survive a scrub', before>0 && after===0,
    before+' eased rate(s) held, 0 after fxReset()');
}

console.log('\n=== AN EFFECT DRAWS THE RATE THE SIM IS PASSING ===');
for(const [n,ok,detail] of fxChecks){
  console.log((ok?'  ok   ':'  FAIL ')+n.padEnd(38)+detail);
  if(!ok) process.exitCode=1;
}

console.log('=== BROKEN VALUES IN DRAWN TEXT ===');
{ let n=0;
  for(const t of TEXTS) if(/NaN|undefined|Infinity/.test(t.t)){
    console.log(`  [${t.screen}] "${t.t.slice(0,60)}"`); n++; }
  console.log(n?`  ${n} broken value(s)`:'  none');
  if(n) process.exitCode=1; }

console.log('\n=== TEXT OFF THE DOCUMENTED TYPE SCALE ===');
{ const scale=M.TSCALE(); let n=0; const seen={};
  for(const t of TEXTS) if(!scale.includes(t.size) && !seen[t.size]){
    seen[t.size]=1;
    console.log(`  ${t.size}px  e.g. [${t.screen}] "${t.t.slice(0,40)}"`); n++; }
  console.log(n?`  ${n} off-scale size(s)`:'  none');
  if(n) process.exitCode=1; }

console.log('\n=== TEXT OUTSIDE THE 12..748 CONTENT MARGINS ===');
{ let n=0, inv=0;
  for(const t of TEXTS){
    if(t.view){ if(t.x0<11.5||t.x1>748.5) inv++; continue; }
    if(t.x0<11.5 || t.x1>748.5){
      console.log(`  [${t.screen}] "${t.t.slice(0,42)}" x ${t.x0.toFixed(0)}..${t.x1.toFixed(0)} size ${t.size}`); n++; }
  }
  console.log(n?`  ${n} overflow(s)`:'  none');
  console.log(`  (${inv} string(s) in the pannable plant view, not judged here)`);
  if(n) process.exitCode=1; }

console.log('\n=== TEXT COLLIDING WITH OTHER TEXT ON THE SAME LINE ===');
/* ══════════ KNOWN COLLISIONS, TRIAGED - NOT IGNORED ══════════
   Section 0c of the pipe-ownership plan: this check printed collisions for a
   long time with no way to fail the run on them. Run against the stock plant
   with every overlay layer on, every one of the ~250 it found traces to
   exactly one of the three shapes below - each a genuine overlap between two
   independent draw passes that were never told about each other, not a false
   positive in the detector. Matched by TEXT SHAPE, never by the exact number
   in the string: the numbers move every run (sim state, RNG-seeded damage),
   the shape does not. Each entry also carries a ceiling - if the count behind
   a shape balloons past its baseline, that is a NEW fault wearing an old
   pattern's clothes, and it fails the run rather than vanishing into a total. */
// Match formats, not "one side is a pressure tag and the other is anything":
// a shape-only key that never inspects the OTHER side's own text format is
// the same hole twice over - it forgives whatever a real bug happens to sit
// next to, not just the one collision it was written to describe.
const DOSE_TAG=/^\d+\.\d\dx$/;              // radPart(): r.toFixed(2)+"x"
const CELL_FIGURE=/^(\d+\.\d\d|·)$/;   // radNumbers(): r.toFixed(2), or "·" below RAD_FLOOR
const RAD_SCREEN=/^(rad|radwreck|purityOn):/;   // both shapes below need a radiation layer switched on
// Every ceiling here is dominated by the 120-tick layer-purity sweep further
// down this file ('purityOn:0'..'119', the only sweep that leaves every
// radiation layer on for more than one frame): 120 of ceil:124's hits and
// 120 of ceil:122's come from it. Change that sweep's tick count and both
// ceilings move by exactly that delta - that is the sweep length changing,
// not a new fault wearing an old shape's clothes.
const COLLISION_ALLOW=[
  { reason:'RELIEF TANK (layout.js add("reltk",...,7,0,...)) sits in the hull '+
           'border row (row 0) by design - the same row CLAUDE.md documents as '+
           '"~10x more likely to be hit". radPart() (the PART DOSE layer, radc) '+
           "always labels a part at its own box top+11px with no knowledge of "+
           'the fixed "UPPER DECK / HULL" caption drawn on that same row, so a '+
           'part placed in row 0 lands its dose tag on the boundary text. Only '+
           'visible with PART DOSE switched on; the four radiation layers start '+
           'off, so a player sees this only by asking for it. The other side '+
           "must be radPart()'s own tag shape (DOSE_TAG) - not anything at all.",
    ceil:124,
    test:(a,b)=>RAD_SCREEN.test(a.screen) &&
                ((a.t==='UPPER DECK / HULL' && DOSE_TAG.test(b.t)) ||
                 (b.t==='UPPER DECK / HULL' && DOSE_TAG.test(a.t))) },
];
{ let n=0;
  // keyed on the array index, not the ~500-char reason string: two entries
  // that happened to share wording would otherwise merge counts
  const allowHits=[];
  const byScreen={};
  for(const t of TEXTS){ (byScreen[t.screen]=byScreen[t.screen]||[]).push(t); }
  for(const k in byScreen){
    const a=byScreen[k];
    for(let i=0;i<a.length;i++) for(let j=i+1;j<a.length;j++){
      if(Math.abs(a[i].y-a[j].y)>2||a[i].rot||a[j].rot) continue;
      const ov=Math.min(a[i].x1,a[j].x1)-Math.max(a[i].x0,a[j].x0);
      if(ov<=1.5) continue;
      const hi=COLLISION_ALLOW.findIndex(e=>e.test(a[i],a[j]));
      if(hi>=0){ allowHits[hi]=(allowHits[hi]||0)+1; continue; }
      console.log(`  [${k}] "${a[i].t.slice(0,26)}" x "${a[j].t.slice(0,26)}" overlap ${ov.toFixed(0)}px @y${a[i].y.toFixed(0)}`); n++;
    }
  }
  const allowed=COLLISION_ALLOW.map((e,i)=>allowHits[i]||0);
  const nAllowed=allowed.reduce((s,v)=>s+v,0);
  const overIdx=[], staleIdx=[];
  COLLISION_ALLOW.forEach((e,i)=>{
    if(allowed[i]===0) staleIdx.push(i); else if(allowed[i]>e.ceil) overIdx.push(i);
  });
  n+=overIdx.length+staleIdx.length;
  console.log(n?`  ${n} collision(s)`:'  none');
  if(nAllowed) console.log(`  ${nAllowed} allow-listed collision(s) (known and triaged - see COLLISION_ALLOW):`);
  COLLISION_ALLOW.forEach((e,i)=>{
    if(allowed[i]===0){
      // a shape with 0 hits is dead code wearing an allow-list entry - fail
      // it so it gets deleted rather than rotting here forever (rule 12)
      console.log(`    x  0 STALE (ceiling ${e.ceil}) - this shape no longer occurs, delete the entry:  ${e.reason.slice(0,70)}...`);
      return;
    }
    const over=allowed[i]>e.ceil;
    console.log(`    x${String(allowed[i]).padStart(3)}${over?` FAIL (ceiling ${e.ceil})`:''}  ${e.reason.slice(0,90)}...`);
  });
  if(n) process.exitCode=1;
}

console.log('\n=== FONT SIZE HISTOGRAM ===');
const h={}; for(const t of TEXTS) h[t.size]=(h[t.size]||0)+1;
Object.keys(h).map(Number).sort((a,b)=>a-b).forEach(s=>console.log(`  ${String(s).padStart(5)}px  ${String(h[s]).padStart(4)} strings`));
console.log('  total',TEXTS.length);
