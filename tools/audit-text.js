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
  let tx=0,ty=0,rot=0; const stack=[];
  const size=()=>parseFloat(st.font.match(/([\d.]+)px/)[1]);
  const sp=()=>parseFloat(st.letterSpacing)||0;
  const wOf=t=>String(t).length*(0.60*size()+sp());
  return new Proxy(st,{
    get(t,k){
      if(k in st && typeof st[k]!=='function') return st[k];
      switch(k){
        case 'measureText': return t2=>({width:wOf(t2)});
        case 'save': return ()=>{ stack.push([tx,ty,rot]); };
        case 'restore': return ()=>{ const v=stack.pop(); if(v)[tx,ty,rot]=v; };
        case 'translate': return (dx,dy)=>{ tx+=dx; ty+=dy; };
        case 'rotate': return r=>{ rot+=r; };
        case 'fillText': return (t2,x,y)=>{
          const w=wOf(t2), a=st.textAlign, s2=size();
          if(Math.abs(rot)>1e-6){          // rotated: swap the bounding box axes
            TEXTS.push({t:String(t2),x0:tx+x-s2,x1:tx+x+s2,y:ty+y,size:s2,screen:CUR,rot:true});
          } else {
            const x0 = (a==='right'? x-w : a==='center'? x-w/2 : x)+tx;
            TEXTS.push({t:String(t2),x0,x1:x0+w,y:y+ty,size:s2,screen:CUR});
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
const M=new Function(src.replace(/layoutMetrics\(\); layout\(\); requestAnimationFrame\(tick\);/,'layoutMetrics();')+
 '; return {drawDesign,drawMimic,drawAnnunciator,drawTrend,drawLog,'+
 'drawLedger,drawFaults,drawDamage,drawHelp,topbar,commission,step,sample,combatHit,'+
 'ui:()=>ui,setScreen:v=>screen=v,S:()=>S};')();

function cap(name,fn){ CUR=name; M.ui().widgets=[]; M.ui().tips=[]; try{fn();}catch(e){console.log('ERR',name,e.message);} }
M.setScreen('design'); cap('topbar',M.topbar); cap('design',M.drawDesign);
M.commission(); M.setScreen('operate');
for(let i=0;i<300;i++){ M.step(0.02); if(i%5===0) M.sample(); }
M.combatHit(); M.combatHit();
let PY=0;
cap('plant',()=>{PY=M.drawMimic();});
cap('annun',()=>M.drawAnnunciator(PY)); cap('damage',()=>M.drawDamage(PY+128));
cap('trend',()=>M.drawTrend(PY+250));   cap('log',()=>M.drawLog(PY+438));
cap('ledger',()=>M.drawLedger(PY+636)); cap('faults',()=>M.drawFaults(PY+800));
M.setScreen('help'); cap('help',M.drawHelp);

console.log('=== TEXT OUTSIDE THE 12..748 CONTENT MARGINS ===');
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
