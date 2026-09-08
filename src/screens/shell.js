"use strict";

let screen="design";
const plantScreen=()=>screen==="design"||screen==="operate";

function layout(){
  if(typeof document!=="undefined" && document.body) document.body.dataset.screen=screen;
  resize();
}

/* screens draw into 0..H, but the canvas covers TOPBAR_H..H: resize() offsets the transform */
const winPx=()=>(typeof innerHeight==="number"&&innerHeight>200)?innerHeight:900;

function resize(){
  const cssW=Math.max(740,(stage&&stage.clientWidth)||0), sc=cssW/W, dpr=devicePixelRatio||1;
  const stagePx=(stage&&stage.clientHeight)||(winPx()-TOPBAR_H*sc);   // pre-layout estimate
  H=Math.max(420,stagePx/sc+TOPBAR_H);
  const bodyH=H-TOPBAR_H;
  cv.style.width=cssW+"px"; cv.style.height=(bodyH*sc)+"px";
  cv.width=Math.round(W*sc*dpr); cv.height=Math.round(bodyH*sc*dpr);
  ctx.setTransform(sc*dpr,0,0,sc*dpr,0,-TOPBAR_H*sc*dpr);
  uiDirty();                       // resizing the backing store clears it
}
addEventListener("resize",resize);

let shellEls=null;

function shellInit(){
  if(typeof document==="undefined" || !document.documentElement) return;
  const tabs=[...document.querySelectorAll("#tabs .tab")];
  shellEls={
    tabs,
    plantLine:document.getElementById("plant-line"),
    clock:document.getElementById("clock"),
    clockRow:document.getElementById("clock-row"),
  };
  for(const btn of tabs){
    const k=btn.dataset.screen;
    MOUSE.on(btn,{click(){
      const dis=(k==="operate"||k==="scenario")&&designBlocked();
      if(dis) return;
      /* the tab that started a prewarm is the one gesture that must not restart it */
      if(prewarmBusy()){ if(k==="operate") return; prewarmCancel(); }
      /* an unchanged design keeps the plant that is already running */
      if(k==="operate"&&(!P||P.dsig!==designSig())){ prewarmStart(); return; }
      if(k==="scenario"&&!P){ commission(); trBench(); trRateFit(); }
      /* the bench writes D.start and the room writes S, so leaving puts the plant back */
      if(k==="design" && P && S && !scnArmed() && REC.mode==="live") resetPlant();
      if(k==="scenario"&&!scnArmed()) TR.paused=true;
      // a menu or a tool addresses one screen's plant, so neither outlives the screen
      ctxClose();
      TOOL.active="select";
      screen=k; layout();
    }});
  }
  shellInitTooltip();
  shellInitCtxMenu();
  shellInitBrandMenu();
}

/* a `list` row builds the next page instead of doing a job, so it leaves the box up */
const BRANDMENU = [
  ["DUMP STATE",       () => dumpState()],
  ["SAVE IMAGE",       () => dumpImage()],
  ["SAVE TIMELINE",    () => dumpTimeline()],
  ["SAVE SNAPSHOT",    () => dumpSnapSave()],
  ["LOAD SNAPSHOT",    null, "list"],
  ["PURGE SNAPSHOTS",  () => dumpPurge()],
];

function shellInitBrandMenu(){
  const box = document.getElementById("brandmenu"), brand = document.getElementById("brand-title");
  if(!box || !brand) return;
  ctxSuppress(box);
  const close = () => KIT.show(box, false);
  const run = fn => {
    close();
    Promise.resolve().then(fn).then(m => console.log("[dump] " + m),
                                    e => console.warn("[dump] failed: " + e.message));
  };
  const page = (title, rows) => {
    box.textContent = "";
    const h = KIT.el("div", "ctx-title"); h.textContent = title;
    box.appendChild(h);
    for(const [label, fn] of rows)
      box.appendChild(KIT.button(label, {flat:true, onClick:fn}).el);
  };
  /* no server is no list, so the browser's own file picker is the load */
  const loadPage = async () => {
    const names = await dumpSnapNames();
    if(names === null) return run(() => dumpSnapPick());
    if(!names.length) return run(async () => "NO SNAPSHOTS: save one first.");
    page("LOAD SNAPSHOT", names.map(n => [n.replace(/^rc_|_snap\.json$/g, ""),
                                          () => run(() => dumpSnapLoad(n))]));
  };
  const build = () => page("DEBUG", BRANDMENU.map(([label, fn, kind]) =>
    [label, kind === "list" ? loadPage : () => run(fn)]));
  MOUSE.on(brand, {click(){
    const open = box.classList.contains("kit-hide");
    if(open) build();
    KIT.show(box, open);
    const r = brand.getBoundingClientRect();
    box.style.left = r.left + "px";
    box.style.top = r.bottom + 4 + "px";
  }});
  MOUSE.pre({down(e){ if(!e.target.closest("#brandmenu") && e.target !== brand) close(); }});
}

function shellInitCtxMenu(){
  const box=document.getElementById("ctxmenu");
  if(!box) return;
  ctxSuppress(box);
  ctxHide=()=>{ box.textContent=""; KIT.show(box,false); };
  ctxShow=hit=>{
    const R=hit&&ctxFor(), items=R?R.items(hit):[];
    if(!items.length){ ctxClose(); return; }
    box.textContent="";
    /* never a row: not a button, so it cannot be clicked or focused */
    const title=R.title?R.title(hit):"";
    if(title){ const h=KIT.el("div","ctx-title"); h.textContent=title; box.appendChild(h); }
    for(const it of items)
      box.appendChild(KIT.button(it.label,{flat:true,
        onClick:()=>{ it.fn(); ctxClose(); uiDirty(); }}).el);
    KIT.show(box,true);
    const r=box.getBoundingClientRect();
    box.style.left=Math.max(4,Math.min(hit.cx, innerWidth -r.width -4))+"px";
    box.style.top =Math.max(4,Math.min(hit.cy, innerHeight-r.height-4))+"px";
  };
  // uiDown() covers the canvas; this covers the rails and the topbar
  MOUSE.pre({down(e){
    if(!e.target.closest("#ctxmenu")) ctxClose();
  }});
}

const SCNTIP_ON="Say what the reactor is FOR. Lay out a timeline of what will happen to it - load changes, battle damage, a blackout - and the limits it has to hold while they do. RUN flies it with nobody at the panel and says PASS or FAIL and which limit broke. Unlike CONTROL, opening this never rebuilds a plant that is already running.";
const OPTIP_ON="The live control room. Opening it commissions the current design. Run the plant, push it past its limits, and repair it when it bites back. Visiting the bench puts the plant back where it was commissioned, and changing anything there rebuilds the unit from scratch the next time you come back here.";
const LOCKTIP="Locked while a machine is standing where it does not fit. Drag it clear on the design bench.";

function shellClock(){
  /* blank, not hidden: the row keeps its box, so the topbar beside it never shifts */
  const live = !!SIMSCREEN[screen];
  shellEls.clockRow.classList.toggle("blank", !live);
  /* achieved, never asked for: 50 ticks is one second of plant time */
  const ts = (TR.sps/50).toFixed(1)+"x";
  const clk=Math.round(TR.sps)+" TPS / "+ts;
  if(shellEls.clock.textContent!==clk) shellEls.clock.textContent=clk;
  /* only a finite rate promises anything, and only a running plant can be behind */
  const owed = live && typeof TR.rate==="number" && isFinite(TR.rate) && !TR.paused && S;
  shellEls.clock.classList.toggle("slow", !!owed && TR.sps < 50*TR.rate*0.9);
}
function shellSync(){
  helpSync();
  if(!shellEls) return;
  /* a validation run spends its frames on the sim, and designBlocked() walks the plant */
  if(trQuiet()){ shellClock(); return; }
  /* this runs off-frame, so it opens a settle window of its own; nothing below writes D or LAY */
  laySettle();
  const blocked=designBlocked();
  for(const btn of shellEls.tabs){
    const k=btn.dataset.screen, on=screen===k,
          dis=(k==="operate"||k==="scenario")&&blocked;
    btn.classList.toggle("on",on);
    btn.classList.toggle("dis",dis);
    if(k==="operate") btn.dataset.tipBody = dis?LOCKTIP:OPTIP_ON;
    else if(k==="scenario") btn.dataset.tipBody = dis?LOCKTIP:SCNTIP_ON;
  }
  /* P does not move when the design does, so an unmatched signature reads derived() */
  const fresh = P && P.dsig===designSig();
  let line;
  if(!roleOf("core")) line="NO REACTOR";
  else if(fresh) line=`${P.id} ${P.rated.toFixed(0)} MWt ${(P.rated*P.eff).toFixed(0)} MWe`;
  else { const d=derived();
    line=`${d.a.id} ${d.rated.toFixed(0)} MWt ${(d.rated*d.eff).toFixed(0)} MWe`; }
  if(shellEls.plantLine.textContent!==line){ shellEls.plantLine.textContent=line;
    shellEls.plantLine.classList.toggle("idle",!fresh); }
  shellClock();
  layRelease();
}

/* commission() is a second of solves; nothing may paint the half-built P it leaves */
const PREWARM_MS=24;
let pwGen=null, pwEls=null, pwFrac=0, pwStage="";
const prewarmBusy=()=>!!pwGen;
function prewarmStart(){
  tipHide(); ctxClose();
  pwGen=commissionGen(); pwFrac=0; pwStage="";
  prewarmSync(true);
}
/* commission() overwrites P on its first statement, so there is nothing to put back */
function prewarmCancel(){
  if(!pwGen) return;
  pwGen=null; P=null; S=null;
  prewarmSync(false); uiDirty();
}
function prewarmStep(){
  if(!pwGen) return false;
  const t0=performance.now();
  do{
    let r;
    try{ r=pwGen.next(); }catch(e){ pwGen=null; prewarmSync(false); throw e; }
    /* the benchmark measures the plant just built; it runs on a snapshot and puts it back */
    if(r.done){ pwGen=null; trBench(); trRateFit(); prewarmSync(false); uiDirty(); return false; }
    pwFrac=r.value.frac; pwStage=r.value.stage;
  }while(performance.now()-t0<PREWARM_MS);
  prewarmSync(true);
  return true;
}
function prewarmSync(on){
  if(!pwEls){
    const box=typeof document!=="undefined" && document.getElementById("prewarm");
    if(!box) return;
    pwEls={box, stage:box.querySelector(".pw-stage"), pct:box.querySelector(".pw-pct"),
           fill:box.querySelector(".pw-fill")};
  }
  KIT.show(pwEls.box,on);
  if(!on) return;
  pwEls.stage.textContent=pwStage;
  pwEls.pct.textContent=Math.round(pwFrac*100)+"%";
  pwEls.fill.style.width=(pwFrac*100).toFixed(1)+"%";
}

/* a canvas widget carries no data-tip-title, so tipHover() hands its answer here */
let tipSync=()=>{}, tipHide=()=>{};
function shellInitTooltip(){
  const tip=document.getElementById("tip");
  if(!tip) return;
  let cur=null, curRail=null, curGroup=null, owner=null, cvKey=null, bar=null;
  // nothing is hoverable while a prewarm is up: the box would stand on the bar
  const show=el=>{ if(prewarmBusy()) return; cur=el; curRail=railOf(el); curGroup=el.closest(".cr-group"); owner="html";
    tip.innerHTML=`<b>${el.dataset.tipTitle||""}</b><p>${el.dataset.tipBody||""}</p>`;
    bar=null;
    KIT.show(tip,true);
    const b=el.getBoundingClientRect();
    /* every panel on these two screens stands ON the drawing */
    if(plantScreen()){ viewAt=""; placeView(); return; }
    const a=curRail?null:vitalsAnchor();
    if(a) placeAnchor(a);
    else if(curRail) place(curGroup?curGroup.getBoundingClientRect().top:b.top+b.height/2, !!curGroup);
    else placeBy(b); };
  const hide=()=>{ cur=null; curRail=null; curGroup=null; owner=null; cvKey=null; bar=null; KIT.show(tip,false); };
  tipHide=hide;
  MOUSE.doc({
    over(e){ const el=e.target.closest("[data-tip-title]");
      if(el && el!==cur) show(el); },
    out(e){ const el=e.target.closest("[data-tip-title]");
      if(el && el===cur && !(e.relatedTarget && el.contains(e.relatedTarget))) hide(); }});
  /* measured, not a constant: the rail's width is declared in the stylesheet */
  const railOf=el=>{ const r=el.closest(".db-rail,.cr-rail,.scn-rail"); return r&&r.offsetParent?r:null; };
  const vitalsAnchor=()=>{ const v=document.querySelector(".cr-vitals");
    return v&&v.offsetParent?v.getBoundingClientRect():null; };
  const placeAnchor=b=>{
    const gap=8, r=tip.getBoundingClientRect();
    tip.style.left=Math.max(4,Math.min(b.right+gap, innerWidth-r.width-4))+"px";
    tip.style.top=Math.max(4,Math.min(b.top, innerHeight-r.height-4))+"px";
  };
  /* atTop = the y IS the top of the box, so a tip inside a group sits level with it */
  const place=(clientY,atTop)=>{
    const gap=12, r=tip.getBoundingClientRect();
    const x=Math.max(4, curRail.getBoundingClientRect().left-gap-r.width);
    const y=Math.max(4, Math.min(atTop?clientY:clientY-r.height/2, innerHeight-r.height-4));
    tip.style.left=x+"px"; tip.style.top=y+"px";
  };
  const placeBy=b=>{
    const gap=8, r=tip.getBoundingClientRect();
    const below=b.bottom+gap, y=below+r.height<=innerHeight-4?below:Math.max(4,b.top-gap-r.height);
    tip.style.left=Math.max(4, Math.min(b.left, innerWidth-r.width-4))+"px";
    tip.style.top=y+"px";
  };
  MOUSE.doc({move(e){
    if(cur&&curRail&&!curGroup&&!plantScreen()) place(e.clientY); }});

  /* the VIEW box, not the canvas: viewRectCss() is the room the opaque rails leave */
  let viewAt="";
  const placeView=()=>{
    const v=viewRectCss(), r=tip.getBoundingClientRect();
    const x=Math.max(4,Math.min(v.right-r.width-6, innerWidth-r.width-4));
    const y=Math.max(4,Math.min(v.bottom-r.height-6,innerHeight-r.height-4));
    const at=x+","+y; if(at===viewAt) return; viewAt=at;
    tip.style.left=x+"px"; tip.style.top=y+"px";
  };
  // the shape of the scale, not its value: a live needle goes through set()
  const barSig=g=>!g?"":[g.lo,g.hi,g.dp,g.zones.map(z=>z[0]).join(","),
                         (g.lim||[]).map(L=>L[0]+L[1]).join(",")].join("|");
  const buildCanvas=t=>{
    const g=t.g;
    viewAt="";                       // a new box is a new size, so re-park it
    tip.textContent="";
    const head=KIT.el("div","tip-head");
    const b=KIT.el("b"); b.textContent=t.title||""; head.appendChild(b);
    if(g){
      const z=bandZone(g);
      const zs=KIT.el("span","tip-verdict"); zs.textContent=z[2]; zs.style.color=z[1];
      head.appendChild(zs);
      for(const L of (g.lim||[])){
        const ls=KIT.el("span","tip-lim"); ls.textContent=L[1]+" "+L[0].toFixed(g.dp);
        head.appendChild(ls);
      }
    }
    tip.appendChild(head);
    const p=KIT.el("p"); p.textContent=t.body||""; tip.appendChild(p);
    bar = g ? KIT.band({lo:g.lo,hi:g.hi,zones:g.zones,dp:g.dp,lim:g.lim,v:g.v}) : null;
    if(bar) tip.appendChild(bar.el);
  };
  /* the HTML source wins: a rail sits on top of the canvas, whatever the hit test reads */
  tipSync=()=>{
    if(owner==="html") return;
    const t=tipHover();
    if(!t){ if(owner==="canvas") hide(); return; }
    const key=[t.title||"",t.body||"",barSig(t.g)].join("␟");
    if(key!==cvKey || owner!=="canvas"){
      cvKey=key; owner="canvas"; buildCanvas(t); KIT.show(tip,true);
    }
    if(bar) bar.set(t.g.v);
    placeView();
  };
}

/* a circuit may match several names, so the order here is what picks exactly one */
function circNames(){
  const G=nodeGraph();
  const partsOn=[]; for(let i=0;i<G.nCirc;i++) partsOn.push([]);
  for(const p of LAY.parts){
    const ns=G.nodesOf[p.id]||[]; const seen={};
    for(const n of ns){ const c=G.circuit[n];
      if(c===undefined || seen[c]) continue; seen[c]=1; partsOn[c].push(p); }
  }
  const piped={};
  for(const c of pipeTrace().conns){
    const a=partOf(c.a), b=partOf(c.b); if(!a||!b) continue;
    piped[G.circuit[a.id+c.sa]]=1; piped[G.circuit[b.id+c.sb]]=1;
  }
  const raw=[];
  for(let i=0;i<G.nCirc;i++){
    const has=r=>partsOn[i].some(p=>p.role===r);
    raw.push(!piped[i] ? "UNPIPED"
      : G.coreCircs[i]===1 ? "PRIMARY"
      : has("radiator") ? "COOLING"
      : has("turb") ? "SECONDARY"
      : "INTERMEDIATE");
  }
  // a name earned twice is numbered, in index order, so it is still one name
  const seen={}, total={};
  for(const n of raw) total[n]=(total[n]||0)+1;
  return raw.map(n=>{ seen[n]=(seen[n]||0)+1;
    return total[n]>1 ? n+" "+seen[n] : n; });
}
function circName(ci){
  if(ci===null || ci===undefined || ci<0) return "UNCONNECTED";
  return circNames()[ci] || "UNCONNECTED";
}
