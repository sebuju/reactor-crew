#!/usr/bin/env node
/* reactor-crew text auditor.
   Runs every draw function against a stub canvas using real monospace metrics.
   Catches text outside the content margins, text-on-text collisions, and any
   runtime error in a draw path -- which a parse check cannot see.
   Usage:  node tools/audit-text.js
*/
const src=require('./bundle').bundle();

const TEXTS=[], RECTS=[];
function mkctx(){
  const st={font:'10px m',fillStyle:'#000',textAlign:'left',letterSpacing:'0px'};
  /* sx/sy track ctx.scale(), because the plant is drawn through a view
     transform now: its text is in PLANT units and lands on the page scaled and
     offset. Without this the auditor measures the plant at its unscaled size
     and reports the whole grid as hanging off the right margin. */
  let tx=0,ty=0,rot=0,sx=1,sy=1; const stack=[];
  const size=()=>parseFloat(st.font.match(/([\d.]+)px/)[1]);
  const sp=()=>parseFloat(st.letterSpacing)||0;
  const wOf=t=>String(t).length*(0.60*size()+sp());
  return new Proxy(st,{
    get(t,k){
      if(k in st && typeof st[k]!=='function') return st[k];
      switch(k){
        case 'measureText': return t2=>({width:wOf(t2)});
        case 'save': return ()=>{ stack.push([tx,ty,rot,sx,sy]); };
        case 'restore': return ()=>{ const v=stack.pop(); if(v)[tx,ty,rot,sx,sy]=v; };
        case 'translate': return (dx,dy)=>{ tx+=dx*sx; ty+=dy*sy; };
        case 'scale': return (a,b)=>{ sx*=a; sy*=(b===undefined?a:b); };
        case 'rotate': return r=>{ rot+=r; };
        case 'fillText': return (t2,x,y)=>{
          const w=wOf(t2)*sx, a=st.textAlign, s2=size();
          if(Math.abs(rot)>1e-6){          // rotated: swap the bounding box axes
            /* a rotated string is about one em wide, and that em is scaled too */
            TEXTS.push({t:String(t2),x0:tx+x*sx-s2*sx,x1:tx+x*sx+s2*sx,y:ty+y*sy,size:s2,screen:CUR,rot:true});
          } else {
            const x0 = (a==='right'? x*sx-w : a==='center'? x*sx-w/2 : x*sx)+tx;
            TEXTS.push({t:String(t2),x0,x1:x0+w,y:y*sy+ty,size:s2,screen:CUR});
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
/* ══ THE AUDIT MUST GIVE THE SAME ANSWER TWICE ══
   warmUp() fires combatHit(), which picks its target at random - so which
   component drew a repair key, and which plate grew a DAMAGED row, changed from
   run to run. A collision could hide behind a lucky draw, and one already had:
   the REPAIR key sitting on TILT was found by accident rather than by this
   file. Seeding Math.random makes the same two components take the hit every
   run AND keeps the real fault effects the hit sets - a jammed bank, a stuck
   PORV, a rejected load - which is coverage a hand-written damage list loses.
   A separate pass below then damages EVERY component at once, which is the
   worst case for the key and for the rows a damaged plate grows. */
let rngSeed=20260824;
Math.random=()=>{ rngSeed=(rngSeed*1103515245+12345)&0x7fffffff;
                  return rngSeed/0x7fffffff; };
const M=new Function(src.replace(/layoutMetrics\(\); layout\(\); requestAnimationFrame\(tick\);/,'layoutMetrics();')+
 '; return {drawDesign,drawOperate,drawOverlay,drawHelp,topbar,commission,step,sample,combatHit,'+
 'ui:()=>ui,setScreen:v=>screen=v,S:()=>S,D:()=>D,setSplit,setSel:v=>sel=v,parts:()=>LAY.parts,'+
 'setDmg:v=>S.dmgParts=v,'+
 'drawTip,forceTip:t=>{isTouch=true;touchTip=Object.assign({},t,{until:1e15});},'+
 'TSCALE:()=>TSCALE,OVL:()=>ovlList(),ovlSet:v=>ovlOpen=v};')();

function cap(name,fn){ CUR=name; M.ui().widgets=[]; M.ui().tips=[]; try{fn();}catch(e){console.log('ERR',name,e.message);} }
/* A TOOLTIP ONLY DRAWS ON HOVER, so until now nothing in this file ever ran
   one. That was survivable while a tip was a title and a sentence. It is not,
   now that a plate row's tip draws the SCALE the number lives on: two end
   figures, a boundary figure per zone and a label per setpoint, all sized and
   placed against a box that grew for them.

   Each is captured ALONE. Two tooltip boxes in one frame overlap by
   construction - only ever one is on screen - so drawing them together reports
   a stacking order as a collision, which is the same trap the overlays are
   captured alone for. */
function capTips(tag){
  /* indexed, not titled: a plant carries four shield blocks and the plate and
     the row that own a condenser are both called CONDENSER, so a name off the
     title alone drops several boxes into one bucket and the collision check
     then reports one tooltip lying over another */
  M.ui().tips.slice().forEach((t,i)=>
    cap(tag+i+':'+(t.title||'?'),()=>{ M.forceTip(t); M.drawTip(); }));
}
function warmUp(){
  M.commission();
  for(let i=0;i<300;i++){ M.step(0.02); if(i%5===0) M.sample(); }
  M.combatHit(); M.combatHit();
}
/* BEFORE any of that. The bench is reachable with no plant commissioned - P is
   still null there - and ctlFor() is called on the bench to reserve the control
   rows, so everything it builds eagerly has to survive that. This exact path
   threw on P.flowMin and the auditor could not see it, because warmUp() had
   already commissioned a plant before anything was ever drawn. */
M.setScreen('design');
cap('precommission:topbar',M.topbar);
cap('precommission:design',M.drawDesign);

warmUp();

function sweep(tag){
  M.setScreen('design'); cap(tag+'topbar',M.topbar); cap(tag+'design',M.drawDesign);
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
  M.setScreen('help'); cap(tag+'help',M.drawHelp);
}
sweep('');
/* optional kit changes what the bench and the panel draw, so audit those paths too */
M.D().rps=false; warmUp(); sweep('norps:'); M.D().rps=true;
/* The stock sweep leaves the core selected, so it never draws the rod-drive
   inspector at all - and the split control strip and the per-bank table are the
   densest text in the plant. Select the rods and walk every mode. */
warmUp(); M.setSel('rods'); sweep('rods:');
/* SPLIT with the banks actually apart: the strip grows a row per bank and each
   row carries a button and a labelled slider in the same width the ganged one
   gave a slider alone. Four banks is the worst case the bench will sell. */
M.setSplit(true);
for(let b=0;b<M.S().rodZDem.length;b++) M.S().rodZDem[b]=0.15+b*0.25;
M.S().bankAuto[1]=false;
for(let i=0;i<600;i++) M.step(0.02);
sweep('split:');
/* mid-regang, which is the one state with a third button label */
M.setSplit(false); for(let i=0;i<20;i++) M.step(0.02);
sweep('ganging:');
/* and the fewest banks, where every row is widest and the labels have most room
   to be wrong about how many banks there are */
M.D().nbank=2; warmUp(); M.setSel('rods'); M.setSplit(true);
for(let i=0;i<200;i++) M.step(0.02);
sweep('split2:'); M.D().nbank=4; warmUp(); M.setSel('core');
/* Both inspectors show only the selected component's panel, so a sweep that never
   selects a part never draws that part's panel at all. The bench turbine and
   condenser panels shipped unaudited exactly this way. Walk every part instead of
   naming the interesting ones - the list is short and it cannot go stale. */
warmUp();
for(const part of M.parts()) { M.setSel(part.id); sweep('sel:'+part.id+':'); }
M.setSel('core');

/* EVERY component broken at once. This is the worst case the plant can draw:
   every symbol carries a repair key, every plate grows a STATUS row, and the
   two margins are as tall as they ever get. Two random hits never reach it. */
warmUp(); M.setDmg(M.parts().map(p=>p.id)); sweep('alldmg:');
warmUp();

/* A number that came out NaN or undefined still draws happily - no error, no
   overflow, just a broken readout sitting on the panel. Nothing caught that
   before, so it goes here where every draw path is already being walked. */
console.log('=== BROKEN VALUES IN DRAWN TEXT ===');
{ let n=0;
  for(const t of TEXTS) if(/NaN|undefined|Infinity/.test(t.t)){
    console.log(`  [${t.screen}] "${t.t.slice(0,60)}"`); n++; }
  console.log(n?`  ${n} broken value(s)`:'  none'); }

/* Every size drawn must be a step of the documented scale. An off-scale size is
   somebody typing a number instead of picking one, and it is also how fitTxt()
   would show up if it ever shrank a label to something arbitrary. TSCALE is the
   scale itself, imported rather than copied. */
console.log('\n=== TEXT OFF THE DOCUMENTED TYPE SCALE ===');
{ const scale=M.TSCALE(); let n=0; const seen={};
  for(const t of TEXTS) if(!scale.includes(t.size) && !seen[t.size]){
    seen[t.size]=1;
    console.log(`  ${t.size}px  e.g. [${t.screen}] "${t.t.slice(0,40)}"`); n++; }
  console.log(n?`  ${n} off-scale size(s)`:'  none'); }

console.log('\n=== TEXT OUTSIDE THE 12..748 CONTENT MARGINS ===');
let n=0;
for(const t of TEXTS){
  if(t.x0<11.5 || t.x1>748.5){
    console.log(`  [${t.screen}] "${t.t.slice(0,42)}" x ${t.x0.toFixed(0)}..${t.x1.toFixed(0)} size ${t.size}`); n++; }
}
console.log(n?`  ${n} overflow(s)`:'  none');

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
