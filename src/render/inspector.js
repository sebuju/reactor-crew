"use strict";
// the one place a canvas-palette hex is translated to its CSS custom property
const C2VAR={};
(function(){ if(typeof C==="undefined") return;
  for(const k in C) if(typeof C[k]==="string" && C[k][0]==="#")
    C2VAR[C[k]]="var(--c-"+k.replace(/([A-Z])/g,"-$1").toLowerCase()+")"; })();
const cssCol=c=>c?(C2VAR[c]||c):"";

// held as an id so a stale pick cannot swallow a canvas pick
let railPickId=null;
const railSelfPick=()=>{ const self = railPickId!==null && railPickId===sel;
  railPickId=null; return self; };

// a machine's company is a fact about what it is plumbed to: no name test, no table
function panelGroup(p){
  const li=loopOf(p.id); if(li!=null) return "loop"+li;
  const G=nodeGraph(), ns=G.nodesOf[p.id]||[];
  if(!ns.length) return p.pin&&p.pin.to ? panelGroup(partOf(p.pin.to)||p) : "support";
  return "circ"+G.circuit[ns[0]];
}
function panelGroupRank(k){
  if(k==="support") return 3e6;
  if(k.startsWith("loop")) return 1e6 + (+k.slice(4));
  const n=+k.slice(4);
  return n===nodeGraph().coreCirc ? 0 : 2e6 + n;
}
function railPick(well,ids,name){
  if(!well.head) return well;
  well.head.classList.add("kit-rule-pick");
  well.el._pickId=ids[0];
  MOUSE.on(well.head,{click(){ sel=ids[0]; railPickId=ids[0]; }});
  KIT.tip(well.head,name||"",
    "Click to select this component. It lights up on the plant, and a leader runs from it to this panel.");
  return well;
}
// bubbles, so railPick() has already moved `sel`: compares the well under the pointer, never a remembered id
function railBlank(rail){
  MOUSE.on(rail,{click(e){
    const w=e.target.closest&&e.target.closest(".kit-well");
    if(!w || w._pickId!==sel) sel=null;
  }});
}

// with no observer (headless) every panel counts as visible: a gate that skips the work skips the check
function railWatch(scroller){
  if(typeof IntersectionObserver!=="function") return {add(el){ el._vis=true; },free(){}};
  const io=new IntersectionObserver(es=>{ for(const e of es) e.target._vis=e.isIntersecting; },
                                    {root:scroller,rootMargin:"200px"});
  return {add(el){ el._vis=true; io.observe(el); }, free(){ io.disconnect(); }};
}
const railSeen = el => el._vis!==false;

// a row is [label,value,color,tip,band,signedBar] or {sec}/{viz}; both checks run per panel per frame, so neither may allocate
function fieldRowsMatch(h,rows){
  if(!h || h.length!==rows.length) return false;
  for(let i=0;i<rows.length;i++){ const r=rows[i], H=h[i];
    if(r.sec){ if(H.sec!==r.sec) return false; }
    else if(r.viz){ if(H.viz!==r.viz) return false; }
    else if(H.key!==r[0]) return false; }
  return true;
}
function limSame(a,b){
  if(!a||!b) return !a===!b;
  if(a.length!==b.length) return false;
  for(let i=0;i<a.length;i++) if(a[i][0]!==b[i][0]||a[i][1]!==b[i][1]) return false;
  return true;
}
// {sec:"NAME"} rows build the same .db-grid the bench does; a sectionless list stays a plain column
function fieldRowsBuild(container,rows){
  const out=[];
  let viz=null;
  let grid=null, sec=null;
  if(rows.some(r=>r.sec)){
    grid=KIT.el("div","db-grid insp-grid"); container.appendChild(grid);
    sec=KIT.el("div","db-section"); grid.appendChild(sec);
  }
  const put=el=>(sec||container).appendChild(el);
  for(const row of rows){
    if(row.sec){
      // the leading section is minted empty above, so the first heading fills it rather than leaving a blank cell
      if(sec.childElementCount){ sec=KIT.el("div","db-section"); grid.appendChild(sec); }
      sec.appendChild(KIT.rule(row.sec).el);
      out.push({sec:row.sec}); continue; }
    // its own canvas, painted through hostPaint(): the rail is opaque, so drawing on #cv would put it under the panel
    if(row.viz){
      const c=KIT.el("canvas","insp-viz insp-viz-"+row.viz);
      if(row.tip) KIT.tip(c,row.title||row.viz,row.tip);
      put(c);
      (viz||(viz={}))[row.viz]=c;
      out.push({viz:row.viz}); continue;
    }
    const el=KIT.el("div","insp-row");
    const lab=KIT.el("span","insp-row-lab"); lab.textContent=row[0];
    // value and delta are two spans in ONE cell: a third column would shift every value the moment a delta appeared
    const val=KIT.el("span","insp-row-val");
    const num=KIT.el("span"), dlt=KIT.el("span","insp-row-dlt");
    val.append(num,dlt);
    el.append(lab,val);
    let bar=null,barKind=null;
    if(row[4]){ bar=KIT.band({lo:row[4].lo,hi:row[4].hi,zones:row[4].zones,dp:row[4].dp,lim:row[4].lim,
                              marks:row[4].marks,v:row[4].v});
      barKind="band"; el.appendChild(bar.el); }
    else if(row[5]){ bar=KIT.segMark({signed:true,full:row[5].full,dp:row[5].dp}); barKind="sig"; el.appendChild(bar.el); }
    if(row[3]) KIT.tip(el,row[0],row[3]);
    put(el);
    // txt/col are what was last WRITTEN: reading the element back is a DOM read per row per frame, and colours come back reformatted
    out.push({key:row[0],el,val,num,dlt,bar,barKind,txt:null,col:null,dtxt:null,dcol:null,
              lim:row[4]?row[4].lim:null});
  }
  container._viz=viz;
  return out;
}
function fieldRowsSync(container,rows){
  let h=container._h, rebuild=!fieldRowsMatch(h,rows);
  if(!rebuild) for(let i=0;i<rows.length;i++){
    const H=h[i];
    if(H.barKind==="band" && !limSame(rows[i][4].lim,H.lim)){ rebuild=true; break; }
  }
  if(rebuild){ container.innerHTML=""; h=container._h=fieldRowsBuild(container,rows); }
  for(let i=0;i<rows.length;i++){
    const H=h[i], row=rows[i];
    if(!H||row.sec||row.viz) continue;
    if(H.txt!==row[1]){ H.num.textContent=row[1]; H.txt=row[1]; }
    const d=row.dlt;
    if(H.dtxt!==(d?d.text:"")){ H.dtxt=d?d.text:""; H.dlt.textContent=H.dtxt; }
    const dcol=d?cssCol(d.col):"";
    if(H.dcol!==dcol){ H.dcol=dcol; H.dlt.style.color=dcol; }
    const col=cssCol(row[2]);
    if(H.col!==col){
      H.val.style.color=col;
      // a ledger term (row[5]) is exempt: there the colour keys the picture beside it, it is not a verdict
      const sev = row[5] ? null : row[2];
      H.el.classList.toggle("red",sev===C.red);
      H.el.classList.toggle("amber",sev===C.amber);
      H.col=col;
    }
    if(H.barKind==="band"){ H.bar.set(row[4].v,row[4].mv); H.lim=row[4].lim; }
    else if(H.barKind==="sig") H.bar.set(row[5].f,row[5].m,col);
  }
}

// a stat row is [label,value,frac,color,tip]
function statRowsBuild(container,stats){
  const out=[];
  for(const st of stats){
    const el=KIT.el("div","insp-stat");
    const lab=KIT.el("span","insp-stat-lab"); lab.textContent=st[0];
    const bar=KIT.seg({cells:20, solid:true});
    const val=KIT.el("span","insp-stat-val"); val.textContent=st[1];
    el.append(lab,bar.el,val);
    bar.set(st[2],cssCol(st[3]));
    if(st[4]) KIT.tip(el,st[0],st[4]);
    container.appendChild(el);
    out.push({val,bar,el});
  }
  return out;
}
function statRowsSync(container,stats){
  const sig=stats.map(s=>s[0]).join("|");
  if(sig!==container._sig){ container.innerHTML=""; container._h=statRowsBuild(container,stats); container._sig=sig; }
  stats.forEach((st,i)=>{ const H=container._h[i]; if(!H) return;
    if(H.val.textContent!==st[1]) H.val.textContent=st[1];
    // the DRIVEN BY block carries live figures, so the tip is a sync and not a build
    if(st[4]) KIT.tip(H.el,st[0],st[4]);
    H.bar.set(st[2],cssCol(st[3])); });
}

// every block is {kind,...}; `key` is a D field name or a {get,set} pair. B.gang = identical set, B.plain = nothing to adjust
const MEASURED_TIP="Every number on this list is an OUTPUT of the design. Not one of them is a value you can set - to move one of these, move a knob above it.";

function measBoxRows(id){
  const p=partOf(id); if(!p) return [];
  const t=partMassOf(id), all=derived().mass, ts=partTsurv(p), pb=partPburst(p);
  const R=[["MASS",t.toFixed(t<10?1:0)+" t",null,
    "What this box costs the ship, off the same door the mass budget reads. Every tonnage the knobs above quote is inside this one figure."]];
  if(all>0) R.push(["SHARE OF SHIP",(t/all*100).toFixed(1)+" %",t/all>.25?C.amber:null,
    "How much of the whole plant's mass is this one machine. Past a quarter of the ship in one box, it is the design decision, and everything else is detail."]);
  R.push(["FOOTPRINT",p.w+" x "+p.h+" cells",null,
    "How much deck it stands on. Deck is what a panel needs to see the skin, what a repair party walks through, and what the next machine has not got."]);
  if(ts) R.push(["METAL SURVIVES TO",ts.toFixed(0)+" K",null,
    "How hot the compartment air may get before this box is damaged by the room it is standing in. Its own title bar reads the temperature it is actually at."]);
  if(pb) R.push(["BLAST LIMIT",pb.toFixed(0)+" kPa",null,
    "The overpressure it takes from a hydrogen burn in the same compartment before it is wrecked."]);
  R.push(["ACCESS",partAccess(p)?"reachable":"WALLED IN",partAccess(p)?C.green:C.red,
    "Whether a repair party can reach this box at all. Walled in on every side it stays broken for the rest of the run, whatever you send."]);
  return R;
}
// appended to the panel's own MEASURED list, never pushed as a second one
function measAttach(B,id){
  let hit=null;
  (function walk(bs){ for(const b of bs){
    if(b.kind==="readlist" && b.title==="MEASURED") hit=b;
    else if(b.blocks) walk(b.blocks); } })(B);
  if(!hit) return B;
  const was=hit.rows;
  hit.rows=()=>was().concat(measBoxRows(id));
  return B;
}
function paramsFor(p){
  const B=[], id=p.id;
  let T=B, G=null, R=B, TB=null;
  const GRID=cols=>{ const g={kind:"grid",cols,blocks:[]}; R.push(g); G=g; return g; };
  // one panel, one thing at a time: everything after a TAB() lands under that tab
  const TAB=(title,tip)=>{ if(!TB){ TB={kind:"tabs",tabs:[]}; B.push(TB); }
    const t={title,tip,blocks:[]}; TB.tabs.push(t); R=T=t.blocks; G=null; return t; };
  const SEC=(title,tip,span,rowspan)=>{ const s={kind:"section",blocks:[]};
    if(title) s.title=title; if(tip) s.tip=tip; if(span) s.span=span; if(rowspan) s.rowspan=rowspan;
    G.blocks.push(s); T=s.blocks; return s; };
  const opt=(title,tip,key,items,base)=>T.push({kind:"optlist",title,tip,key,base:base||0,
    items:items.map(o=>({name:o.name,tip:o.note||o.tip||""}))});
  // `sug` is the AUTO key's own tip: where the suggestion comes from, never repeated in the field's tip
  const sld=(title,tip,key,min,max,fmt,step,massFn,sug,suggest)=>T.push({kind:"slider",title,tip,key,min,max,fmt,step,massFn,sug,suggest});
  // a MACHINE'S OWN QUANTITY, in its own units
  const num=(title,tip,key,unit,dp,suggest,massFn,sug)=>T.push({kind:"num",title,tip,key,unit,dp,suggest,massFn,sug});
  const rdo=(title,tip,val)=>T.push({kind:"readout",title,tip,val});
  const tog=(title,tip,key,mass)=>T.push({kind:"toggle",title,tip,key,mass});
  const note=(text,color)=>T.push({kind:"note",text,color});
  // advice goes on the panel's own title bar, where every other explanation on this screen is read
  const help=t=>{ if(t) B.tip = B.tip ? B.tip+"\n\n"+t : t; };

  if(!partAccess(p))
    note("NO ACCESS. This component is walled in on every side. No repair party could ever reach it, so it is lost for good the moment it is damaged.","var(--c-red)");

  // a preset comes first because it WRITES what is under it
  if(p.role==="core"){ const cD=coreD(id);
    B.gang="reactor"; B.gangPlain=true; B.cols=3;
    // the canvas column is one and a half standard columns; the knobs and MEASURED take one each
    B.colw=[390,260,260];
    // designForget() FIRST: a family change moves the rating, and every baked figure was priced off the old one
    B.head=[{kind:"menu",label:"PRESETS",
      tip:"Whole drawings you can begin with. Every one of them lays out fuel, moderator and banks with the same pens you have - a preset cannot describe a reactor you could not have drawn yourself.",
      blocks:[
      {kind:"bulkrow",label:"REACTOR",items:ARCHPRE.map((pr,i)=>({name:pr[0],tip:pr[2],fn:()=>{ designForget(); archPreset(cD,i); designBake(); }}))},
      {kind:"bulkrow",label:"LATTICE",items:LATPRE.map((pr,i)=>({name:pr[0],tip:pr[2],fn:()=>latPreset(cD,i)}))},
      {kind:"bulkrow",label:"SPREAD",items:[1,2,3,4].map(n=>({name:String(n),
        tip:"Clear every cluster and lay "+n+" bank"+(n>1?"s":"")+" again, spread by area over the core the way the stock lattice does - so each bank covers about the same share of the fuel."+
          (n<2?" One bank has nothing to lean a flux tilt against, so tilt trim and SPLIT mode have no work to do."
              :" Fewer banks sit nearer the flux and so measure a little more worth; watch CONTROL BANK WORTH below say by how much."),
        fn:()=>{ latLayBanks(cD,n); latRevolve(cD); }}))}]}];
    // a knob belongs beside the surface it moves
    GRID(3);
    T=SEC(null,null,2).blocks;
    T.push(
      {kind:"rule",title:"RADIAL PLAN",
       tip:"The core seen from above - the r axis of the solve, revolved about the middle. Only a quarter of it is authored: draw in any quadrant and the other three follow, because the solve has one radius and not four. Every pen here is a toggle: click a slot to lay the thing down, click it again to take it away, and hold SHIFT while you drag to clear whatever you cross. The section below has pens of its own."});
    const meas=SEC(null,null,1,4).blocks;
    const planDraw=SEC(null,null,1).blocks;
    const planK=SEC(null,null,1).blocks;
    const secHead=SEC(null,null,2).blocks;
    const secDraw=SEC(null,null,1).blocks;
    const secK=SEC(null,null,1).blocks;

    T=planDraw;
    T.push({kind:"lattools",pen:"plan",tools:LATPEN_CORE.concat(LATPEN_RODS)},
      {kind:"latplan",core:id},{kind:"latread",pen:"plan",core:id});

    T=planK;
    opt("COOLANT","What flows through the core. It sets operating pressure, where it boils, how much power a litre of core makes, and how well it moderates. It no longer decides the void coefficient: that is measured off what you draw.",bagAcc(cD,"cool",()=>cD.cool),COOLANT);
    // the setter must latMeasure() itself: an optlist is not a lattice edit, so nothing else re-blends densK
    {
      const zs=latZonesUsed(cD), one=zs.length<2;
      for(const z of zs)
        opt(one?"FUEL":"FUEL ZONE "+(z+1),
          "Sets beta - your reaction time before prompt criticality - plus excess reactivity and core density."+
          (one?" Paint zones on the plan below and this becomes one row per zone, which is how a real core is loaded."
              :" This row loads the slots you painted as zone "+(z+1)+". The core's beta, density and excess are the blend; its melt limit is the WORST fuel in it."),
          bagAcc(cD.zoneFuel,z,()=>zoneFuelOf(cD,z),()=>latMeasure(cD)),FUEL);
    }
    num("PIN DIAMETER","How fat one fuel pin is, on a fixed 12.6 mm rod pitch. It is the one dimension inside the assembly you can set, and it moves nearly everything: a thin pin has more surface per unit of fuel, so the hottest pin takes more power before it reaches its flux ceiling, and it stores less heat to carry into a melt when the flow stops. It also carries more clad, which eats neutrons, and leaves more water, which walks the moderation ratio to the right. A fat pin is the opposite trade in every line.",
        figScale(FIG.rodD.acc(id),1000),
        "mm",1,()=>ROD_D0*1000,null,
        "The reference pin every stock lattice is drawn with. It is a fixed figure and it does not follow the rest of the design.");
    opt("MODERATOR","What a moderator BLOCK is made of. It only matters if you draw blocks with the MODERATOR pen - and in a helium or sodium core, blocks are the only moderation there is.",bagAcc(cD,"mod",()=>cD.mod),MODER);
    opt("ABSORBER","What the clusters are made of. This used to be solved for, until a fully-inserted bank came to whatever CONTROL BANK WORTH was set to. Now you buy a material, put the clusters where you want them, and the worth is what the solve measures.",bagAcc(cD.lat,"abs",()=>cD.lat.abs,()=>latRevolve(cD)),ABSORB);

    T=secHead;
    T.push(
      {kind:"rule",title:"AXIAL SECTION",
       tip:"The core in elevation - the z axis of the solve, on a fixed metric scale. These pens are its own, so a plan pen never stands the section down, and the top of the fuel column is a handle you can drag whichever pen is up."});
    T=secDraw;
    T.push({kind:"lattools",pen:"sec",tools:LATPEN_SEC},
      {kind:"latsection",core:id},{kind:"latread",pen:"sec",core:id});
    T=secK;
    opt("REFLECTOR","What is wrapped round the core. You buy the material here; how many cells of it there are on each face is drawn in the section.",bagAcc(cD,"refl",()=>cD.refl),LATREFL.map(n=>({name:n})));
    sld("CHIMNEY HEIGHT","How tall the standpipe above the core is. It is a feature of the vessel, not of any one loop, and it is what natural circulation leans on when the pumps are gone - taller buys grace time and costs steel.",bagAcc(cD,"chim",()=>cD.chim),0,1,v=>v.toFixed(2)+" x",.05,v=>v*38);
    meas.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>LATREAD
      .map(r=>[r[0],r[1](cD),r[3]?r[3](cD):null,r[2]])});
    { const vd=()=>derived(id), a=()=>COOLANT[cD.cool];
      if(cD.tube){
      num("TUBE BORE","How wide one fuel channel is. This core has no vessel: every channel is its own pressure boundary, standing in a graphite stack that sits at room pressure under a shield.",
          FIG.tubeBore.acc(id),
          "mm",0,()=>tubeBoreSuggest(cD),null,
          "What the lattice pitch leaves round one bundle.");
      num("TUBE WALL","How thick one channel's wall is. It is what a channel is RATED for and what every channel weighs, the same Barlow every run on the board gets. A channel lets go one at a time, at its own hottest spot, at the same margin over its rating every pipe has.",
          FIG.tubeWall.acc(id),
          "mm",1,()=>tubeWallSuggest(vd().P0,a(),cD),v=>tubeMass(vd().P0,a(),cD,v),
          "Barlow at this channel's own bore and the pressure this circuit is held at, in this coolant.");
      num("CAVITY VOLUME","The sealed space round the stack that a torn channel discharges into. It has its own relief, sized for one channel; past that the shield above it lifts.",
          FIG.cavVol.acc(id),
          "m3",0,()=>cavVolSuggest(cD),null,
          "The stack's envelope times the void graphite leaves.");
      num("SHIELD MASS","The slab over the cavity. Its weight over the cavity's area is the pressure the cavity will take: past it the shield lifts, every channel is torn at its top weld and the whole core is open.",
          FIG.shieldT.acc(id),
          "t",0,()=>shieldSuggest(cD),null,
          "A slab of steel-serpentinite over the stack, at the stack's own footprint.");
      meas.push({kind:"readlist",title:"CHANNELS",tip:MEASURED_TIP,rows:()=>{ const d=vd(); return [
        ["CHANNELS",tubeCount(cD).toFixed(0),null,"How many fuel channels the lattice has, each its own pressure boundary."],
        ["RATED FOR",d.vesselRated.toFixed(2)+" MPa",d.vesselRated<d.P0?C.red:null,"What one channel's wall will take, off the published hoop-stress relation. Under the setpoint, the channels are the weakest thing on this circuit."],
        ["BURSTS AT",d.vesselBurst.toFixed(2)+" MPa",d.vesselBurst<d.P0?C.red:null,"Where a channel at operating temperature actually lets go. A hot channel goes sooner: its wall is weaker, and it fails first."],
        ["SHIELD LIFTS AT",(shieldLiftP(cD)*1000).toFixed(0)+" kPa",null,"The cavity pressure that lifts the shield. Past this the whole core is open to the room."],
        ["MASS",d.vesselMass.toFixed(0)+" t",null,"Every channel's zirconium at this wall, plus the shield."]]; }}); }
      else {
      num("VESSEL WALL","How thick the reactor vessel's steel is. It is what the vessel is RATED for and what it weighs, the same as any run on the board. The vessel lets go at the same margin over its rating every pipe has - buy wall and you buy the margin an excursion has to beat.",
          FIG.vesselWall.acc(id),
          "mm",0,()=>vesselWallSuggest(vd().P0,a(),cD),v=>vesselShellMass(vd().P0,a(),cD,v),
          "Barlow at the pressure this vessel is held at, over the lattice's own envelope, floored at the plate a vessel this size is built from.");
      meas.push({kind:"readlist",title:"VESSEL",tip:MEASURED_TIP,rows:()=>{ const d=vd(); return [
        ["RATED FOR",d.vesselRated.toFixed(2)+" MPa",d.vesselRated<d.P0?C.red:null,"What the wall you bought will take, off the published hoop-stress relation - the same rating every run on the board carries. Under the setpoint, this vessel is the weakest thing on its circuit."],
        ["BURSTS AT",d.vesselBurst.toFixed(2)+" MPa",d.vesselBurst<d.P0?C.red:null,"Where the vessel actually lets go. A rating has its margin inside it; past this the vessel is open and the core is in the room."],
        ["MASS",d.vesselMass.toFixed(0)+" t",null,"What the vessel weighs: its shell at this wall over the lattice's own envelope and a downcomer round it."]]; }}); } }

    T=B;
  }
  else if(p.role==="rods"){ const cD=coreD(coreOf(id));
    if(cD){
    GRID(1); SEC("ROD DRIVES");
    opt("SCRAM SYSTEM","How the rods are driven in during an emergency shutdown.",bagAcc(cD,"scram",()=>cD.scram),SCRAM);
    num("ROD DRIVE SPEED","How fast the drives walk the bank under normal control, as a percentage of full travel every second - the reference drive strokes end to end in 83 s. A fast core answers a rod before you have finished moving it and wants a motor to match; a graphite pile does not. It does NOT touch the scram, which drops on the system above. A motor that strokes twice as fast is twice the machine, and the mass hint is what that costs on every bank you have.",
        figScale(FIG.rodSpd.acc(coreOf(id)),100),
        "%/s",2,()=>ROD_SPD0*100,v=>cD.nbank*ROD_BANK_T*(v/100/ROD_SPD0-1),
        "The reference drive, which strokes end to end in 83 s. It is a fixed figure and it does not follow the core.");
    opt("ROD FOLLOWER","What occupies the channel below the absorber. It decides whether inserting the bank is monotonic: a graphite follower displaces water at the bottom of the core and adds reactivity there before any absorber arrives.",bagAcc(cD,"foll",()=>cD.foll),FOLL);
    T.push({kind:"slider",title:"AUTO ROD OUT LIMIT",key:"arLo",min:0,max:1,step:.01,
      fmt:v=>(v*100).toFixed(0)+" %",
      tip:"The furthest OUT the temperature controller may walk the bank on its own. Pull it out and the controller has more authority over coolant temperature and you have less shutdown margin, because the position your margin was measured from is the position it is allowed to leave. Your own demand is never bound by it."});
    T.push({kind:"slider",title:"AUTO ROD IN LIMIT",key:"arHi",min:0,max:1,step:.01,
      fmt:v=>(v*100).toFixed(0)+" %",
      tip:"The furthest IN the controller may drive the bank on its own. Deeper insertion buys it more authority and costs thermal margin, because a deep bank peaks the power. Set it at or below the out limit and the band closes to nothing, which parks the controller where it stands."});
    SEC();
    T.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>LATREAD_RODS
      .map(r=>[r[0],r[1](cD),r[3]?r[3](cD):null,r[2]])});
    T.push({kind:"sdmnote"});
    }
  }
  else if(p.role==="sg"){
    GRID(1); SEC("GENERATOR");
    opt("GENERATOR TYPE","U-tube units hold a lot of secondary water that keeps removing heat for minutes after feedwater is lost. Once-through units are light, respond instantly, and boil dry just as fast. Each generator is its own machine, so a U-tube on one loop and a once-through on another is a legal plant.",
        bagAcc(D.sgType,id,()=>sgTypeOf(id)),SGT);
    num("TRANSFER COEFFICIENT","How fast heat crosses this generator's tubes, in kilowatts per kelvin. Buy more and the same core raises hotter steam at a smaller temperature difference; buy less and the primary runs hotter for the same power.",
        FIG.sgUA.acc(id),
        "kW/K",0,()=>sgUASuggest(),()=>0,
        "This core's rated power, shared over the generators on the board, across the approach the coolant programme leaves. Left on AUTO, commissioning then walks it onto rated power exactly; state a figure and that trim stops.");
    num("DESIGN PRESSURE","What THIS shell is built to hold, in megapascals. It is what the safety valve lifts against, what the shell bursts a fifth above, and the pressure the turbine's enthalpy drop is taken from - so buying a higher one raises the steam this generator can make and everything downstream has to take it.",
        FIG.sgDesP.acc(id),
        "MPa",2,()=>sgDesPSuggest(),()=>0,
        "Saturation a fixed approach below the primary's own coolant programme, which is where an untouched plant sits.");
    SEC();
    T.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>{ const r=sgRowOf(id); return [
      ["SHELL BURSTS AT",sgBurstP(id).toFixed(2)+" MPa",null,"Where the shell itself lets go, off the design pressure above. Nothing stops it getting there except a relief valve you placed on its steam nozzle."],
      ["SECONDARY WATER",r.water.toFixed(0)+" t",null,"What is in THIS shell at 100 % level. It is what goes on removing heat after the feedwater stops, and it is the whole of the difference between the two types."],
      ["SHELL STEEL",sgShellT(id).toFixed(1)+" t",null,"The pressure shell itself, off its own water charge as a vessel at the wall its design pressure needs. Raise the pressure above and this goes up with it."],
      ["TUBE BUNDLE",sgTubeT(id).toFixed(1)+" t",null,"The tubes, priced off the transfer coefficient you bought. A bigger UA is more tube, and more tube is more steel."]]; }});
    help("Emergency feedwater is a TANK, not a fitting on this pump: add one, set it to the secondary side and give it the LOW SG LEVEL rule. Its arm switch lives on the tank.");
    help("Height matters more than anything else on this component. Sitting above the reactor, it drives natural circulation with no pumps at all.");
  }
  else if(p.role==="ihx"){
    GRID(1); SEC("EXCHANGER");
    num("TRANSFER COEFFICIENT","How fast heat crosses this exchanger's tubes, in kilowatts per kelvin of temperature difference. A big one gives back some of the shell temperature the second stage costs you, and it is a bigger flywheel after a trip. It is also the heaviest single thing you can buy per tonne of benefit.",
        FIG.ihxUA.acc(id),
        "kW/K",0,()=>ihxUASuggest(),v=>v*IHX_T_PER_UA,
        "Two and a half times one generator's own coefficient, so the barrier costs less temperature than the generator in front of it.");
    SEC();
    T.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>{ const served=ihxFeeds(id); return [
      ["FEEDS",served.length?nameList(served):"nothing",null,"Which stages stand on this exchanger's second circuit. Traced off the drawing - give the second side a pump, a tank and its own runs, exactly like the primary."]]; }});
    help("A second heat transfer stage, and it is a BARRIER. The primary heats this exchanger and this exchanger heats whatever stands on its second circuit, so a tube rupture in one of those generators leaks THAT circuit's coolant into the shell and costs no release at all. Two conductances in series cost a temperature drop, so the same core raises colder steam and makes less electricity - that is the price of the barrier.");
    help("Four faces and no fold: hot side left to right, second side top to bottom. The second side is a real circuit and needs its own pump and its own expansion tank, or nothing crosses.");
  }
  else if(roleHead(p.role)){
    GRID(1); SEC("PUMP");
    num("DEVELOPED HEAD","The pressure rise this pump makes at its rated flow, in megapascals. It is what pushes water from the SUCTION face to the DISCHARGE face and nothing else decides which way it goes - so a pump has to beat whatever pressure stands on the far side before a drop moves.",
        FIG.pumpHead.acc(id),
        "MPa",2,()=>pumpHeadSuggest(id),()=>pumpMassOf(id),
        "The loop this pump is piped into, walked on the drawing: the friction its own circuit puts in front of it at rated flow.");
    num("RATED FLOW","The mass of coolant this pump moves per second at that head. Head and flow together are the machine: the flow is the bore of the casing, so a bigger pump passes more water for the same head.",
        FIG.pumpFlow.acc(id),
        "kg/s",0,()=>pumpFlowSuggest(id),()=>0,
        "What this pump's own duty needs at rated power: the core's heat over its design temperature rise, or the rejection for a circulating water pump. A preset leaves this one on AUTO, because the pump's box on the grid follows the stored figure.");
    num("ROTOR INERTIA","Seconds of rated shaft power the rotor and its flywheel store. It is how the pump coasts when the bus is lost: speed halves in twice this, and the head falls with the square of speed. A flywheeled coolant pump stores five to ten seconds; a feed pump about one.",
        FIG.pumpRotor.acc(id),
        "s",1,()=>pumpRotorSuggest(id),()=>0,
        "What the pump is piped to, off the drawing: six seconds for a coolant pump, one for a feed pump, two for anything else.");
    SEC();
    // what this pump is FOR, off the drawing rather than off its id: there is one pump role
    T.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>[ secGensOf(id).length
      ?["DUTY","FEEDWATER",null,"Piped to a generator's shell, so this is a FEEDWATER pump: it holds that generator's level through its own regulating valve, and the level controller's switch is the FEED CTRL bypass."]
      :primaryPump(id)
        ?["DUTY","COOLANT",null,"In a coolant loop, so this is a COOLANT pump. Flow is the single biggest input to thermal margin, and the first thing a blackout takes off you."]
        :["DUTY","PIPED TO NOTHING",C.amber,"Piped to nothing that reaches a core or a generator. It develops its own head and pools capacity with nobody - draw a run from it, or right-click the plant to remove it."]]});
  }
  else if(p.role==="turb"){
    GRID(1); SEC("TURBINE");
    num("STEAM SWALLOW","The mass of steam this machine takes per second, wide open. It is what the turbine IS - efficiency follows from it and is not a second thing to buy. Every turbine is sized on its own, so a big machine and a small one is a legal fleet.",
        FIG.turbKgs.acc(id),
        "kg/s",0,()=>turbKgsSuggest(),v=>v*TURB_T_PER_KGS,
        "All the steam this plant raises at full power: the core's rated heat over the feed-to-steam rise at the shell pressure.");
    SEC();
    T.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>{ const d=derived(); return [
      ["EFFICIENCY",(COOLANT[priD().cool].eff*turbEffOf(id)*100).toFixed(1)+" % gross",null,"What this turbine on its own turns into electricity. It is DERIVED from the swallow above, by the law that isentropic efficiency rises slowly with machine size - a set ten times bigger is a few points better, not twice as good."],
      ["RATED OUTPUT",(d.rated*d.eff).toFixed(0)+" MWe",null,"Electrical power at 100% reactor power with the condenser keeping up. This is the number the ship gets, and it is the whole reason the reactor is here."],
      ["MAX LOAD",(d.loadMax*100).toFixed(0)+" %",null,"The furthest the load slider will go in the control room, as a share of the steam this plant raises at full power. A matched machine reads 100 %. Overpower is not free reach: it is turbine you paid mass for."]]; }});
    help("In the full game this is where weapons and ship systems draw from. A hit here rejects load instantly and the reactor has nowhere to put its heat.");
  }
  else if(p.role==="cond"){
    GRID(1); SEC("CONDENSER");
    num("CONDENSING DUTY","How fast heat crosses this condenser's tubes, in kilowatts per kelvin. It is what the machine IS: it sets how much steam you can condense at full draw, and it sizes the circulating water flow with it. Overload a small condenser and backpressure eats your electrical output while the reactor goes on making the heat.",
        FIG.condUA.acc(id),
        "kW/K",0,()=>condUASuggest(),v=>v*COND_T_PER_UA,
        "This plant's rated rejection - what the core makes less what the turbine turns into electricity - carried at the terminal difference this machine is built for.");
    num("DUMP CAPACITY","The steam this unit will take straight past the turbine, per second. On a plant that boils in its own core the bypass is open whenever the governor is closing, so this is what lets it follow a load change without a safety valve lifting; on a subcooled plant it opens on a scram.",
        FIG.condDump.acc(id),
        "kg/s",0,()=>condDumpSuggest(),()=>0,
        "Half the steam this plant raises at full power.");
    SEC();
    T.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>{ const d=derived(); return [
      ["PLANT CAPACITY",(d.condCap*100).toFixed(0)+" % of full-load duty",null,"Every condenser on the plant added up, against the heat this plant actually rejects at full power. Draw more than this and exhaust pressure climbs, which costs the turbine work. Match it to the turbine's max load or accept the loss."],
      ["TURBINE CAN DRAW",(d.loadMax*100).toFixed(0)+" %",null,"The turbine's own ceiling, on the same basis as the row above, so the mismatch is visible from either component."],
      ["TERMINAL DIFFERENCE",COND_DT0+" K",null,"How far this machine sits above the sink it rejects into, at rated duty. Duty DIVIDES it: a half-size unit sits twice as far above the radiator for the same heat."],
      ["DESIGN BACKPRESSURE",condPDes().toFixed(4)+" MPa",null,"The exhaust pressure the turbine was built for - the anchor every other figure on this side is priced against. It is a stated design point and a bad radiator does not move it."],
      ["VACUUM FLOOR",COND_P0+" MPa",null,"The best vacuum this plant can ever pull, set by air leaking in and nothing else. An oversized condenser runs down onto this and stops paying."],
      ["TURBINE TRIPS AT",TURB_TRIP_P+" MPa",null,"The exhaust pressure the last-stage blading will not take. The stop valve shuts, and it does not reset."],
      ["VACUUM LOST AT",COND_ATM+" MPa",null,"Past atmospheric the condenser relieves and the air is in for good. This is the second failure, and it is the end of the heat sink."]]; }});
    T.push({kind:"readlist",rows:()=>{ const short=derived().condShort; return [
      ["MATCH",short?"UNDERSIZED":"MATCHED",short?C.amber:null, short
        ?"This condenser is far smaller than the turbine can draw. It runs hotter for the same heat, so the exhaust pressure climbs and the output falls with it - a unit at a third of duty gives back roughly a tenth of the plant's electricity at rest, before any overload."
        :"Condenser is matched to the turbine. A brief overload costs little or nothing, and a bigger unit runs down onto the vacuum limit and stops paying."]]; }});
  }
  // design-time figures only: the bench has no S, and AT RATED is the expression the tick integrates against
  else if(p.role==="radiator"){
    GRID(1); SEC("PANEL");
    num("RADIATING AREA","The surface this panel actually radiates from, in square metres. The box on the grid is a PICTURE of it, snapped to whole cells, so a small plant draws a small panel. Rejection goes as the FOURTH power of panel temperature, so area does not buy heat directly - it buys a colder panel, which buys backpressure, which buys output and overload headroom.",
        FIG.radArea.acc(id),
        "m²",0,()=>radAreaSuggest(id),v=>v*RAD_MASS_M2*radCoatOf(id).massK,
        "This plant's whole rejection at the design panel temperature, divided by the panels on the board and by this coating's emissivity. Add a panel and every panel on AUTO shrinks to share it.");
    num("COOLANT SIDE","How fast the water going through this panel can hand its heat to the surface, in kilowatts per kelvin. AREA decides what the panel can radiate; this decides what its tubes can collect, and a panel plumbed to nothing collects nothing whatever either figure says.",
        FIG.radUA.acc(id),
        "kW/K",0,()=>radUASuggest(id),null,
        "This panel's own share of the rejection, carried on a "+RAD_DT0+" K approach between its water and its surface.");
    opt("COATING","What the panel is finished with. Emissivity is how much of a black body's radiation it actually sheds - and the good coatings are heavy and fragile.",
        bagAcc(D.radCoat,id,()=>D.radCoat[id]??1),RADCOAT.map(r=>({name:r[0]})));
    SEC();
    T.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>{ const d=derived(), live=radLive(id);
      const tr=radTRated(d.eff);
      return [
      ["CAN SHED",live?"YES":"NO",null,"A panel radiates only through the skin. One face of its own footprint against the hull is enough. Walled in on every side it sheds nothing at all: measured, the stock pair moved inboard trips the turbine in under two minutes and the plant makes no electricity."],
      ["SHEDDING",live?(radArea(id)/1e6).toFixed(2)+" Mm²":"0",null,"What this panel is worth as fitted. Blind, it is zero however big the box is."],
      ["EMISSIVITY",radCoatOf(id).emis.toFixed(2),null,"The share of a perfect black body's radiation this finish actually sheds, at the same temperature."],
      ["PLANT AT RATED",isFinite(tr)?tr.toFixed(0)+" K":"no sink",null,"Where every panel on the ship would sit with the reactor at full power. Design is "+RAD_TDES+" K; above it the condenser runs hotter and the turbine gives work back, below it the plant runs down onto its vacuum floor and stops paying."]]; }});
    help("Every watt this plant does not turn into electricity leaves as light, through these panels and nowhere else - and rejection goes as the fourth power of their temperature, so the overload the ship can take is set by area and by nothing else. A blind panel is not a slow leak: it is the whole heat sink gone. So is an unplumbed one: a panel cools the water running through it, so where you pipe it is what it cools.");
  }
  else if(p.role==="ctrl"){
    B.cols=3;   // the automation graph reads across: this panel states its own width
    TAB("PROTECTION","What trips this plant without being asked: the margin the automatic protection allows, how fast it acts, and every setpoint that follows from the two.");
    GRID(3); SEC(null,null,2);
    // there is no "is an RPS fitted" toggle: fitting one is wiring one in the cabinet below
    T.push({kind:"slider",title:"RPS TRIP MARGIN",key:"rpsm",min:0,max:1,step:.05,
      fmt:v=>(v*100).toFixed(0)+" %",
      tip:"How much overhead the automatic protection allows before it scrams. Conservative trips at 110% flux and 1.18 DNBR, so the plant is hard to damage and you can never push it. Permissive lets you reach 132% and 1.02 DNBR, which is real combat performance and a much smaller margin for error. Every setpoint it moves is printed in MEASURED below."});
    T.push({kind:"slider",title:"TRIP RESPONSE",key:"rpsLag",min:0,max:.5,step:.02,
      fmt:v=>(v*1000).toFixed(0)+" ms",
      tip:"How long a channel must stand made before the breakers open - the protection logic settling and the rod coils letting go. A real solid-state system takes 50 to 100 ms; relay logic takes several times that. Long is not only slow: it is also what stops a spike that clears by itself from scramming the plant, so the fastest setting trips on transients the slower one rides out."});
    help("Crew dose during an accident falls with distance from the reactor and drops sharply for every shield block between the two. Move this room and watch the dose figure in RESULTS.");
    SEC();
    // rpsSetRows() (step.js) is the one door onto the setpoints
    T.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>{
      const M=PLANT_LM||layoutMetrics(), wired=scramWiredD(), K=rpsBenchK();
      const R=[["PROTECTION",wired?(scramArmedD()?"ARMED":"WIRED, OFF"):"NONE",wired?null:C.amber,
       "Whether anything scrams this core without you. It is read off the control cabinet below: a protection system is a scram block somebody wired, and every preset ships one switched OFF so a new plant runs its faults out instead of tripping on the first."]];
      for(const r of rpsSetRows(K))
        R.push([r.name, r.val==null ? "at commissioning"
                      : (Math.abs(r.val)>=100?r.val.toFixed(0):r.val.toFixed(2))+(r.unit?" "+r.unit:""),
          r.val==null?C.ink2:null,
          "Where the "+r.name.toLowerCase()+" channel scrams, in the unit it is read in. The margin slider moves it. Blank until commissioning means the setpoint is priced off a figure measured on the settled plant - its own subcooling or void at rest - which this design does not have until it is built."]);
      R.push(["CREW DOSE RATE",M.dose.toFixed(2)+" x",M.dose>1?C.amber:null,
       "Radiation reaching this room during an accident, solved along the straight line from the reactor. Paint standing on that line is what lowers it."]);
      return R; }});
    TAB("AUTOMATION","Every block in this cabinet, one section to a tab, sources at the top and the demands they drive at the bottom. A wire says what it carries. Hover a block to read it, click it to wire it, tune it or switch it off.");
    T.push({kind:"ctlgraph",live:false});   // no title: the tab is the heading
    help("Everything that acts on the plant without being asked, except the protection system, is wired here out of blocks: transmitters, setpoints, arithmetic, PID, limits, and the demands they land on. A preset ships the stock controllers already wired; take them apart, retune them or build your own. Automation runs on electricity: with the switchboard dark and no backup, every block holds its last output.");
  }
  else if(p.role==="fitting") return paramsForFit(id);
  else if(p.role==="tank"){
    B.cols=2;
    GRID(2); SEC("VESSEL");
    const t=()=>D.tanks[id];
    const acc=(f)=>({get:()=>t()[f], set:v=>{ t()[f]=v; }});
    const FLUID_IDS=Object.keys(FLUID), AUTO_IDS=Object.keys(AUTORULE);
    T.push({kind:"optlist",title:"CONTENTS",key:{get:()=>FLUID_IDS.indexOf(t().fluid),
        set:i=>{ t().fluid=FLUID_IDS[i]; }},base:0,
      tip:"What is in the tank. This is the whole of what makes one tank different from another: activity, reactivity worth and what a burst disc puts into the air all follow from it.",
      items:FLUID_IDS.map(f=>({name:FLUID[f].label,
        tip:(FLUID[f].boron?"Worth "+FLUID[f].boron+" pcm per 1 % of loop inventory delivered. ":"")
           +(FLUID[f].act?"Active - a full tank of it is a place a repair party would rather not stand.":"Not active.")}))});
    // a readout, never a selector: which circuit a tank is on is read off the runs you drew
    T.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>{ const ci=tankCircuit(id);
      return [["PLUMBED TO", ci===null ? "NOTHING" : circName(ci), ci===null?C.amber:null,
        ci===null ? "Nothing is piped to this tank, so it is on no circuit at all - it has no edge, it can deliver nothing, and it is counted by nothing. Draw a run from it."
        : tankPrimary(id) ? "This tank has a node in the pressure solve and one edge into the loop, so what it delivers is fought for against loop pressure."
        : "This tank is on the far side of a heat exchanger: it answers to that circuit's own pressure, not to the core loop's."]]; }});
    sld("CAPACITY","How big it is, in cubic metres. It costs the steel of a shell that size at the pressure it has to hold, and it is what turns a solved flow into a level.",
      acc("vol"),5,100,v=>v.toFixed(0)+" m3",5,v=>tankMassOf(id,v));
    sld("ASPECT","What SHAPE that volume is on the grid, width against height. The area is the volume either way - this only decides whether it stands as a tall column or lies as a wide drum, and a shape that fits the deck you have is worth having.",
      {get:()=>tankAspect(id), set:v=>{ t().aspect=v; }},
      0.25,4,v=>v.toFixed(2)+" w:h",0.25);
    // a pressurizer is a tank whose gas space is controlled: two rows, no pressurizer part
    SEC("PRESSURE");
    T.push({kind:"toggle",title:"PRESSURE CONTROL",mass:0,
      key:{get:()=>!!t().hold, set:v=>{ t().hold = v?{p:null}:null; }},
      tip:"Make this vessel hold the pressure of whatever circuit it is piped to. Its gas charge stops being consulted - that is what CONTROLLED means - and its line becomes the surge line, ordinary pipe carrying the loop both ways. One per circuit: a second one on the same circuit is demoted and warned about."});
    sld("SETPOINT","The pressure this vessel holds its circuit at. Higher raises the boiling point, so it buys thermal margin and resists voiding - and every machine on the circuit needs the wall to take it, which is steel.",
      {get:()=>t().hold?FIG.holdP.acc(id).get():0,
       set:v=>{ if(t().hold) FIG.holdP.acc(id).set(v); },
       raw:()=>t().hold?FIG.holdP.acc(id).raw():undefined,
       clr:()=>{ if(t().hold) FIG.holdP.acc(id).clr(); }},
      0.2,22,v=>v.toFixed(1)+" MPa",0.1,null,
      "Enough over saturation at this circuit's own hot leg to keep it liquid, off the coolant it carries.",
      ()=>holdPSuggest(tankCircuit(id)));
    sld("FILL AT COMMISSIONING","How full it starts. A source ships full; a tank meant to catch something ships empty, and its gas charge is set at whatever level you leave here.",
      acc("level"),0,100,v=>v.toFixed(0)+" %",5);
    SEC("GAS CHARGE");
    T.push({kind:"toggle",title:"GAS CHARGE",mass:8,
      key:{get:()=>!!t().gas, set:v=>{ t().gas = v?{p0:4.5,frac:0.35}:null; }},
      tip:"A cover gas above the liquid. It is what makes the pressure mean anything: a vented tank never pressurises, so it can have no back-pressure and no rupture disc. It expands as a source empties and is compressed as a sink fills."});
    sld("CHARGE PRESSURE","What the gas holds at the commissioning level. It falls as a source drains and rises as a sink fills - that taper is the whole difference between an accumulator and a pump.",
      {get:()=>t().gas?t().gas.p0:0, set:v=>{ if(t().gas) t().gas.p0=v; }},
      0.05,15,v=>v.toFixed(2)+" MPa",0.05);
    sld("GAS SPACE","How much of the tank is gas rather than liquid. A big space holds its pressure up as the tank drains, so the flow tapers late; a small one collapses as soon as it starts moving.",
      {get:()=>t().gas?t().gas.frac:0, set:v=>{ if(t().gas) t().gas.frac=v; }},
      0.05,0.8,v=>(v*100).toFixed(0)+" %",0.05);
    SEC("SAFETY");
    T.push({kind:"toggle",title:"CHECK VALVE",mass:4,
      key:acc("check"),
      tip:"A non-return valve on the tank's own line. With one, the tank can only ever push OUT - which is what makes it a source. Without one it fills as readily as it drains, which is what makes it a sink."});
    T.push({kind:"toggle",title:"RUPTURE DISC",mass:2,
      key:{get:()=>!!t().burst, set:v=>{ t().burst = v?{at:1.4,drain:6.0,rel:0.004}:null; }},
      tip:"A disc that lets go once the tank is full enough to push its gas past the setpoint. Past that the tank is an opening to containment and what was in it is on the floor. This is the TMI-2 sequence, and it does not reseat."});
    sld("DISC SETPOINT","The pressure the disc lets go at. Set it high and the tank takes more before it fails; set it too high and the tank itself is the weaker part.",
      {get:()=>t().burst?t().burst.at:0, set:v=>{ if(t().burst) t().burst.at=v; }},
      0.2,6,v=>v.toFixed(1)+" MPa",0.1);
    sld("DISC DRAIN RATE","How fast the tank empties once the disc has gone. It is a hole, not a valve, so this is the size of the hole.",
      {get:()=>t().burst?t().burst.drain:0, set:v=>{ if(t().burst) t().burst.drain=v; }},
      1,20,v=>v.toFixed(1)+" %/s",0.5);
    sld("DISC RELEASE","What each point of level dumped costs in release. It follows what is in the tank - clean water is nearly free and contaminated water is not.",
      {get:()=>t().burst?t().burst.rel:0, set:v=>{ if(t().burst) t().burst.rel=v; }},
      0,0.02,v=>v.toFixed(3),0.001);
    T.push({kind:"optlist",title:"OPENS ITSELF ON",key:{get:()=>AUTO_IDS.indexOf(t().auto),
        set:i=>{ t().auto=AUTO_IDS[i]; }},base:0,
      tip:"When this tank lines itself up without being asked. The operator's own valve is always there beside it - this only ever OPENS, it never overrides a switch.",
      items:AUTO_IDS.map(a=>({name:AUTORULE[a].label,tip:""}))});
  }
  else if(p.role==="bkp"){
    GRID(1); SEC("BACKUP");
    opt("BACKUP POWER","What keeps the coolant pumps turning when main power is lost. Test it with the Station Blackout fault in the control room.","bkp",BKP);
    help("With no backup, a blackout leaves you nothing but natural circulation - which is set by how high you put the steam generators and how tall you made the core.");
    SEC();
    T.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>[
      ["PUMP POWER HELD",(BKP[D.bkp].bk*100).toFixed(0)+" %",D.bkp?null:C.amber,
       "What share of rated pump power this set carries through a blackout. Nothing here means the pumps stop dead and only natural circulation is left."]]});
  }
  else {
    GRID(1); SEC();
    help(p.tip);
    T.push({kind:"note",text:"NO ADJUSTABLE PARAMETERS"});
    B.plain = partAccess(p);
    // nothing to set is not nothing to measure: measAttach() fills this list
    T.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>[]});
  }
  return measAttach(B,id);
}

// a run is not a PART, so it is addressed by its run key: a key always has a colon and a part id never does
/* the panel's unit over the figure's own: FIG states metres and fractions, a field states mm and per cent */
const figScale = (a,k) => ({get:()=>a.get()*k, set:v=>a.set(v/k),
  raw:()=>{ const v=a.raw(); return v===undefined?undefined:v*k; }, clr:a.clr});
const runOfKey = key => pipeNetwork().find(r=>runIdOf(r)===key) || null;
const isRunKey = k => typeof k==="string" && k.indexOf(":")>=0 && (!!runOfKey(k) || !!D.runs[k]);
// a run with a loose end has no bore and no length, because both are read off the connection
function paramsForLooseRun(rid){
  const r=D.runs[rid];
  const end=c=>{ const pid=portAtCell(c[0],c[1]);
    const p=pid!=null && partOf(D.ports[pid].p);
    return p ? partName(p) : "loose at "+c[0]+","+c[1]; };
  const grid={kind:"grid",cols:1,blocks:[]};
  const s={kind:"section",blocks:[]}; grid.blocks.push(s);
  s.blocks.push({kind:"note", text: runErr(rid) || "NOT CONNECTED YET"});
  s.blocks.push({kind:"readlist", title:"THIS PIPE", tip:
    "A pipe is one object you place. Drag an end onto a cell beside a machine and a nozzle appears there; with a machine on both ends it becomes a run and gets its own size.",
    rows:()=>[
      ["END A", end(r.a), null, "Drag the dot to move it. Right click it to take the whole pipe off."],
      ["END B", end(r.b), null, "Drag the dot to move it. Right click it to take the whole pipe off."],
      ["WAYPOINTS", String(r.pins.length), null, "Cells this pipe has to go through. Drag the pipe itself to pull one out; right click it to drop it."],
      ["PIPEWORK", (r.cells||[]).length ? (r.cells.length+" cells") : "NONE - DRAWN AS A LINE", null,
       "No pipe is laid until BOTH ends land on a machine: until then the line is what you have drawn, and it takes no deck off the runs that are plumbed."],
    ]});
  return [grid];
}
function paramsForRun(key){
  const B=[], r=runOfKey(key);
  if(!r) return D.runs[key] ? paramsForLooseRun(key) : B;
  // written under the run's own name, never the derived key: a key is rebuilt whenever the geometry moves
  const id=runIdOf(r);
  const grid={kind:"grid",cols:1,blocks:[]}; B.push(grid);
  const runS={kind:"section",title:"RUN",blocks:[]}; grid.blocks.push(runS);
  const measS={kind:"section",blocks:[]}; grid.blocks.push(measS);
  const num=(title,tip,k,unit,dp,suggest,massFn,sug)=>runS.blocks.push({kind:"num",title,tip,key:k,unit,dp,suggest,massFn,sug});
  // over THIS run's length, so the hint prices the change the slider would actually make
  const massAt=(bore,wall)=>shellTPerM(bore,wall)*r.L;
  num("BORE","How wide this run is, inside the pipe. It is the whole of what the run conducts: a narrow leg is a real restriction and a wide one costs steel and holds more water.",
      FIG.bore.acc(r),
      "mm",0,()=>boreMm(r.k),v=>massAt(v,runWallMm(r)),
      "The nominal bore a run of this kind ships at, scaled to this plant's own rating.");
  num("WALL","How thick the steel is. It is what the run is RATED for and it is what the run weighs - the two are the same number seen from either end.",
      FIG.wall.acc(r),
      "mm",1,()=>wallSuggestMm(runBoreMm(r), runDesignP(r), PRIMARY_K[r.k]?COOLANT[priD().cool]:null),
      v=>massAt(runBoreMm(r),v),
      "Barlow at this run's own bore and the highest pressure the circuit it stands on can put in it, penalised for the coolant it carries.");
  measS.blocks.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>{
    const c=pipeMap().byKey[r.key], a=c&&partOf(c.a), b=c&&partOf(c.b);
    const rate=runRating(r), held=runDesignP(r);
    const rec=D.runs[id], node=runNodeOf(r.key), area=Math.PI/4*Math.pow(runBoreMm(r)/1000,2);
    const endRow=(which,pid)=>{ if(pid==null||!D.ports[pid]) return null;
      const shut=S&&S.portShut&&S.portShut[pid], wrecked=S&&portWrecked(S,pid);
      return ["END "+which, portLabel(pid)+(wrecked?" - WRECKED":shut?" - SHUT":""),
        wrecked?C.red:shut?C.amber:null,
        "The nozzle this end of the pipe stands on, and the valve in it. Shut, this end passes nothing at all; wrecked, the body is an opening and cannot be worked."]; };
    // a row that has no answer is absent, never a blank line - filtered here so the RISE row can decline
    return [].concat([
      ["RUNS FROM",(a?partName(a):"?")+" ⇒ "+(b?partName(b):"?"),null,
       "The two machines this run joins. It is traced off the pipe you drew, never authored - move either machine and this follows."],
      endRow("A",c&&c.pa), endRow("B",c&&c.pb),
      ["LENGTH",r.L.toFixed(1)+" m",null,"How far it actually goes, cell by cell. Length is resistance and it is mass."],
      rec?["ROUTE",(rec.cells||[]).length+" cells, "+rec.pins.length+" waypoints",null,
        "The pipework this run is laying, and how many cells you have told it to go through on the way. Drag the line to pull a waypoint out of it; right click a waypoint to drop it."]:null,
      ["FLOW AREA",area.toFixed(4)+" m2",null,
       "The hole the bore makes. It is what the solve conducts through, and it is what sets the speed of the water at any given flow."],
      (()=>{ const za=nodeZ(r.a+r.sa), zb=nodeZ(r.b+r.sb);
        if(za===null||zb===null) return null;
        const dz=zb-za;
        return ["RISE",(dz>=0?"+":"")+dz.toFixed(1)+" m",null,
          "How much higher the far end stands than the near one, along RUNS FROM above. It is a real column of fluid: it adds to the pressure at the low end and it is what drives circulation with every pump stopped. Raise a steam generator above the reactor and this is the number that cools the core in a blackout."]; })(),
      ["HOLDS",runVol(r).toFixed(2)+" m3",null,"The water standing in it, off the bore and the length. A node with volume has a time constant, which is why a long fat leg is slow to change temperature."],
      // the same reading the pipe is DRAWN in (pipePhaseCol), stated in words
      ["CARRYING",(()=>{ const q=pipePhase(r,S);
        if(!q) return "NOTHING";
        return Math.abs(q[0]-q[1])<0.02 ? pipePhaseWord((q[0]+q[1])/2)
          : pipePhaseWord(q[0])+" to "+pipePhaseWord(q[1]); })(),null,
       "The phase of what is actually in this run, at each of its own two ends - off the enthalpy field, never off what the run was drawn for. A run with no path in the network carries nothing and says so."],
      // each declines rather than printing a zero
      (()=>{ const p=pipeRunP(r,S); return p===null?null:
        ["PRESSURE",p.toFixed(3)+" MPa",null,
         "What the water in this run is actually standing at, off the solved field at the run's own node - not the setpoint it was sized for."]; })(),
      (()=>{ const t=pipeRunT(r,S); return t===null?null:
        ["TEMPERATURE",t.toFixed(1)+" K",null,
         "The temperature of what is in it, off the enthalpy at its own node."]; })(),
      (()=>{ const q=pipeFieldOn?pipeRunKg(r.key,r.k,S):NaN;
        return !isFinite(q) ? null : ["FLOW",(q<0?"":"+")+q.toFixed(1)+" kg/s",null,
         "What is crossing it this instant, signed along RUNS FROM above - so a minus sign means it is running the other way."]; })(),
      (()=>{ const q=pipeFieldOn?pipeRunKg(r.key,r.k,S):NaN, rho=S?netRhoAt(S,node):NaN;
        if(!isFinite(q)||!isFinite(rho)||rho<=0||area<=0) return null;
        return ["SPEED",Math.abs(q/(rho*area)).toFixed(1)+" m/s",null,
         "How fast the fluid is moving in it, off that flow, that bore and what the fluid weighs. Past about 10 m/s a water line erodes and sings; a steam line runs far faster."]; })(),
      (()=>{ const ref=(P&&P.netRefKg) ? P.netRefKg[r.key] : undefined;
        return !isFinite(ref) ? null : ["FLOW AS BUILT",Math.abs(ref).toFixed(1)+" kg/s",null,
         "What this run carries with the plant commissioned, undamaged and every valve wide. It is the scale the flow meter on the deck reads against."]; })(),
      (()=>{ const d=pipeDrop[r.key];
        return d===undefined||!isFinite(d) ? null : ["HEAD SPENT",(d*100).toFixed(0)+" %",null,
         "The share of the loop's whole pump head this one run eats getting the water along it - its length, its bore and anything throttling it."]; })(),
      ["CARRIES",held.toFixed(2)+" MPa",null,"The pressure this run is actually asked to hold - its circuit's own setpoint, or the shell design pressure on the secondary."],
      ["RATED FOR",rate.toFixed(2)+" MPa",rate<held?C.red:null,
       "What the wall above will take, off the published hoop-stress relation. Under what it carries, this pipe is the thing that lets go first."],
      ["BURSTS AT",runBurstP(r).toFixed(2)+" MPa",runBurstP(r)<held?C.red:null,
       "Where this run actually splits open. A rating has its margin inside it, so a pipe held past the rating is not open yet - past this it is, at one cell, and it does not close again."],
      ["MASS",massAt(runBoreMm(r),runWallMm(r)).toFixed(1)+" t",null,"What this run weighs: the shell it is, at the wall it has, over the length it runs."]]).filter(Boolean); }});
  return B;
}
function paramsForFit(fid){
  const B=[], j=D.fittings[fid]; if(!j) return B;
  const grid={kind:"grid",cols:1,blocks:[]}; B.push(grid);
  const fitS={kind:"section",title:"FITTING",blocks:[]}; grid.blocks.push(fitS);
  const measS={kind:"section",blocks:[]}; grid.blocks.push(measS);
  const MODE_IDS=["tee","throttle","relief"];
  fitS.blocks.push({kind:"optlist",title:"FITTING",base:0,
    key:{get:()=>MODE_IDS.indexOf(j.mode), set:i=>{ j.mode=MODE_IDS[i]; }},
    tip:"What this fitting IS. All three are the same box in the same cell - a tee is a plain junction with no gate at all, a throttle is a valve you work by hand, and a relief valve works itself off a setpoint.",
    items:[{name:"TEE",tip:"A junction. Four faces, one node, no gate: it costs the line nothing and closes nothing."},
           {name:"THROTTLE",tip:"A valve you set and it holds. Wide open it costs the line nothing at all; shut it is a real break in the pipe."},
           {name:"RELIEF VALVE",tip:"Lifts on its own at its own setpoint and blows the line down through whatever is piped behind it. Leave its outlet unpiped and it vents straight into the room."}]});
  // millimetres, like the pipe it sits in; boreK()/fitBoreK() are the one conversion into the solve
  fitS.blocks.push({kind:"slider",title:"BORE",step:BORE_REF/20,min:BORE_REF/10,max:BORE_REF*1.5,
    key:{get:()=>j.bore ?? fitBoreSuggest(fid), set:v=>{ j.bore=v; }},
    fmt:v=>v.toFixed(0)+" mm",
    tip:"How wide the valve is. A wide relief valve vents faster; a wide throttle costs the line less when it is open. It is steel either way, so it is on the mass budget.",
    massFn:v=>FIT_MASS*(v/FIT_BORE0)});
  const reliefS={kind:"section",title:"RELIEF VALVE",blocks:[]};
  const sld=(title,tip,key,min,max,fmt,step,massFn,sug,suggest)=>reliefS.blocks.push({kind:"slider",title,tip,key,min,max,fmt,step,massFn,sug,suggest});
  const rdo=(title,tip,val)=>reliefS.blocks.push({kind:"readout",title,tip,val});
  measS.blocks.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>[
    ["FLOW AREA",(Math.PI/4*Math.pow(fitBoreMm(fid)/1000,2)).toFixed(4)+" m2",null,
     "The hole the bore above makes. It is what the solve conducts through - a valve wide open is this area, and shut it is none of it."]]});
  if(j.mode!=="relief") return measAttach(B,fid);
  grid.blocks.push(reliefS);
  reliefS.blocks.push({kind:"toggle",title:"SPRING SAFETY",
    key:{get:()=>!!j.spring, set:v=>{ if(v) j.spring=true; else delete j.spring; }},
    tip:"What works this valve. Off, it is a power-operated relief valve: a block in the control room lifts it, and with the cabinet dark it stays shut. On, it is a code safety valve - a spring against the pressure, lifting and reseating at the setpoints below with no power, no wiring and no way to hold it shut. Real plants carry both."});
  // the span is this valve's own reference either side, so any loop pressure gets a workable slider
  const dp = v => v<1 ? v.toFixed(3) : v.toFixed(2);
  const lo = reliefRefP(fid)*0.9, hi = reliefRefP(fid)*1.35;
  const stp = Math.max(0.005, +(reliefRefP(fid)*0.01).toFixed(3));
  sld("LIFT PRESSURE",
    "The pressure this valve opens itself at. Low and it lifts on every transient and spends its stick chances early; high and pressure climbs further before anything vents, toward a vessel that bursts at about 122% of what it holds.",
    {get:()=>reliefSet(fid).lift,
     // the deadband is dragged down with the lift point, or the valve reseats above its own lift and chatters
     set:v=>{ j.lift=v; if(reliefSet(fid).reseat > v-stp) j.reseat=v-stp; },
     raw:()=>j.lift==null?undefined:j.lift, clr:()=>{ j.lift=null; }},
    lo,hi,v=>dp(v)+" MPa",stp,null,
    "A margin over what this valve stands in front of: the design pressure of the shells it reaches, or the circuit's own setpoint when it reaches none.",
    ()=>reliefLiftSuggest(fid));
  sld("RESEAT PRESSURE",
    "The pressure it shuts again at. The gap up to the lift point is the deadband, and it is what stops the valve chattering on its own setpoint - it cannot be dragged above the lift point, because a valve that reseats above where it lifts has no shut state at all.",
    {get:()=>reliefSet(fid).reseat,
     set:v=>{ j.reseat=Math.min(v, reliefSet(fid).lift-stp); },
     raw:()=>j.reseat==null?undefined:j.reseat, clr:()=>{ j.reseat=null; }},
    lo,hi,v=>dp(v)+" MPa",stp,null,
    "The same reference as the lift point, a few per cent lower, so the valve has a deadband to shut in.",
    ()=>reliefReseatSuggest(fid));
  rdo("DEADBAND","How far pressure has to fall, once this valve has lifted, before it shuts again. A wide band lifts once and clears the transient; a narrow one cycles.",
    ()=>{ const r=reliefSet(fid); return dp(r.lift-r.reseat)+" MPa"; });
  // asked of the drawing: an outlet reaching no tank is not broken, it vents into the room
  rdo("DISCHARGES TO","Where what this valve passes ends up. Pipe its outlet to a tank and the discharge is caught. Stand it against the skin and the discharge goes outside, which spares the compartment but is still a release. Leave it inboard and unpiped and it goes straight into the air the crew is breathing.",
    ()=>{ const t=P&&P.net&&P.net.fitTarget&&P.net.fitTarget[fid];
          if(t) return (D.tanks[t]&&D.tanks[t].name)||t.toUpperCase();
          return (P&&P.net&&P.net.fitVentOut&&P.net.fitVentOut[fid]) ? "ATMOSPHERE" : "THE ROOM"; });
  return measAttach(B,fid);
}

// with no reactor there is nothing to add up; the mass line stays, because 0 t is the honest answer
function benchResultsData(){
  const d=derived(), core=!!roleOf("core"), M=PLANT_LM||layoutMetrics();
  const stats=(core?planStats(d).concat(layoutStats(M)):[]).concat(containStats());
  return {mass:d.mass,over:d.over,eq:(d.mass-layMass),ship:layMass,
    dens:core?d.dens:0, excess:core?d.excess:0,
    stats:stats.map(r=>[r[0],r[1],r[2],r[3],(r[4]||"")+statDrv(r[0],d,M)])};
}
// not gated on a reactor, unlike every row above: a containment is a fact about the drawing
function containStats(){
  const gs=matRegionsBounded();
  if(!matCells().length) return [];
  if(!gs.length) return [["CONTAINMENT","OPEN",0,C.red,
    "Nothing painted on this ship encloses anything: every fill reaches the hull. The structure is shielding and there is no containment."]];
  let lo=Infinity, at=null;
  for(const g of gs) for(const i of g.wall){ const x=i%GW, y=(i/GW)|0, r=matRating(x,y);
    if(r<lo){ lo=r; at=[x,y]; } }
  const vol=gs.reduce((a,g)=>a+matRegVol(g),0);
  return [
    ["CONTAINMENT",gs.length===1?"SEALED":gs.length+" REGIONS SEALED",1,C.green,
     "The fill came back bounded. A closed shape painted in a gas-tight material holds its gas, its heat and most of a release - and it stops doing all three the instant one cell of it is opened."],
    ["CONTAINED VOLUME",vol.toFixed(0)+" m3",clamp(vol/4000,0,1),C.cyan,
     "How much compartment is walled in. A bigger volume is slower to pressurise and much more expensive to wall, because a longer flat span needs a thicker wall to hold the same pressure."],
    ["WEAKEST WALL",lo.toFixed(2)+" MPa"+(at?"  at "+at[0]+","+at[1]:""),clamp(lo/MAT_PDES,0,1),
     lo<MAT_PDES?C.amber:C.green,
     "What the poorest cell of the boundary will take, and where it is. It is the middle of the longest flat side, which is where a real flat-walled pressure boundary fails - draw the enclosure rounder and this figure rises with nothing else changing."]];
}
function benchReviewData(){
  const d=derived(), LM=PLANT_LM||layoutMetrics();
  return {issues:designIssues(d,LM),hard:designBlocked(d,LM)};
}

// keyed "mat:x,y" so it collides with neither a part id nor a run key; never a region index, which renumbers
const isMatKey = k => typeof k==="string" && k.indexOf("mat:")===0
                   && !!matCell(+k.slice(4,k.indexOf(",")), +k.slice(k.indexOf(",")+1));
const matKeyXY = k => { const i=k.indexOf(","); return [+k.slice(4,i), +k.slice(i+1)]; };
function matDefaultKey(){
  const gs=matRegionsBounded();
  let lo=Infinity, at=null;
  for(const g of gs) for(const i of g.wall){ const x=i%GW, y=(i/GW)|0, r=matRating(x,y);
    if(r<lo){ lo=r; at=[x,y]; } }
  if(at) return "mat:"+at[0]+","+at[1];
  const cs=matCells();
  return cs.length ? "mat:"+cs[0] : null;
}
// the control room sets no thickness and buys no material
const paramsForMatLive = key =>
  paramsForMat(key).filter(b=>b.kind==="readlist"||b.kind==="note");
function matPanelTitle(key){
  const [x,y]=matKeyXY(key), c=matCell(x,y);
  if(!c) return "WALL";
  const cs = matSealCells(x,y);
  return matRow(c.m).name+"  "+(cs ? "SEAL  "+cs.length+" CELLS" : x+","+y);
}
function paramsForMat(key){
  const B=[], [x,y]=matKeyXY(key);
  if(!matCell(x,y)) return B;
  B.cols=2;
  const grid={kind:"grid",cols:2,blocks:[]}; B.push(grid);
  const wallS={kind:"section",title:"WALL",blocks:[]}; grid.blocks.push(wallS);
  const measS={kind:"section",blocks:[]}; grid.blocks.push(measS);
  const WB=wallS.blocks, MB=measS.blocks;
  const s = (typeof S!=="undefined") ? S : null, live = !!(s && s.roomP);
  WB.push({kind:"optlist",title:"MATERIAL",base:0,
    // it also loads the brush: this is the only place a material is picked, so the next stroke lays it
    key:{get:()=>MAT.findIndex(m=>m.id===matCell(x,y).m),
         set:i=>{ matCell(x,y).m=MAT[i].id; matPen=MAT[i].id; buildLayout(); }},
    tip:"What this cell is made of. Only a GAS-TIGHT material makes a closed shape a containment; the other two are shielding and nothing else.",
    items:MAT.map(m=>({name:m.name, tip:m.tip}))});
  // applied to the whole SEAL, not the region's `wall` set, which misses a painted box's four corners
  WB.push({kind:"num",title:"THICKNESS",unit:"mm",dp:0,
    tip:"How thick the wall is. It is what the cell is RATED for and it is what the cell weighs.",
    sug:"Barlow against the FLAT SPAN this cell is in the middle of, so a long straight wall asks for a thick one and a corner asks for almost nothing. Setting it writes the whole seal, not one cell.",
    key:{get:()=>matThick(x,y), set:v=>{ const cs=matSealCells(x,y);
      if(cs) for(const i of cs) (D.mat[(i%GW)+","+((i/GW)|0)]||{}).t=v;
      else matCell(x,y).t=v;
      buildLayout(); },
      raw:()=>matCell(x,y).t,
      clr:()=>{ const cs=matSealCells(x,y);
        if(cs) for(const i of cs) delete (D.mat[(i%GW)+","+((i/GW)|0)]||{}).t;
        else delete matCell(x,y).t;
        buildLayout(); }},
    suggest:()=>matThickSuggest(x,y),
    massFn:v=>v/1000*MPC*ROOM_DEPTH*matRow(matCell(x,y).m).rho/1000});
  MB.push({kind:"readlist",title:"MEASURED",tip:MEASURED_TIP,rows:()=>{
    const g=matSealAt(x,y);
    const rate=matRating(x,y), burst=matBurstP(x,y);
    const rows=[
      ["SPAN",(matSpan(x,y)*MPC).toFixed(1)+" m   arm "+(matSpanEff(x,y)*MPC).toFixed(1)+" m",null,
       "The flat length of wall this cell lies in, and the ARM it actually stresses on - twice the distance to the nearer turn, because a turn is a support. Stress is p*R/t, so the arm IS the radius: a cell beside a corner has almost none, a cell at mid-span has the whole half-length, and a round enclosure turns everywhere and has no weak cell at all."],
      ["RATED FOR",rate.toFixed(2)+" MPa",null,
       "What this cell will take, off the published hoop-stress relation against its own span."],
      ["BURSTS AT",burst.toFixed(2)+" MPa",null,
       "Where it actually lets go. A rating has its margin inside it, so a wall held past the rating is not open yet."],
      ["MASS",matCellMass(x,y).toFixed(2)+" t",null,"What this cell weighs: its thickness of its own material over one cell of hull."]];
    if(!g){ rows.push(["ENCLOSES","NOTHING",C.ink2,
      "This cell is not part of any closed shape. Every fill beside it reaches the hull, so it is shielding and never a containment."]);
      return rows; }
    let lo=Infinity, at=null;
    for(const i of g.wall){ const X=i%GW, Y=(i/GW)|0, r=matRating(X,Y);
      if(r<lo){ lo=r; at=[X,Y]; } }
    const pr = live ? regionDP(s, g) : null;
    const open = g.wall.filter(i=>s && matOpen(s, i%GW, (i/GW)|0)).length;
    rows.push(
      ["ENCLOSES",g.cells.length+" cells   "+matRegVol(g).toFixed(0)+" m3",null,
       "How big the enclosed volume is. A big region is slow to pressurise and expensive to wall, because a longer span needs a thicker wall."],
      ["WALL",g.wall.length+" cells   "+matRegPerim(g).toFixed(0)+" m",null,"How much wall there is round it."],
      ["EQUIVALENT DIAMETER",matRegEqD(g).toFixed(1)+" m",null,"A circle of the same plan area. It is the figure the thickness suggestion is taken against."],
      ["STATE",open?"OPEN AT "+open+" CELL"+(open>1?"S":""):"SEALED",open?C.red:C.green,
       "Whether the boundary is still closed. A wrecked cell does not delete the compartment - it puts an ORIFICE in it, and the compartment then blows down through that hole at a rate set by how many cells are open and how much pressure is behind them. The seal drawn round the region on the plant goes the instant the first one opens."],
      ["WEAKEST",at?at[0]+","+at[1]+"   "+lo.toFixed(2)+" MPa":"-",null,
       "The cell of this wall with the least rating - the middle of its longest flat side. This is the cell that will go first, named before it goes."]);
    if(pr!==null){
      rows.push(["PRESSURE",pr.toFixed(3)+" MPa",pr>lo?C.red:null,
        "What the region is holding ABOVE the ship outside it, off its own gas law: a closed volume at a temperature is at a pressure. A wall is judged on the difference across it, never on the absolute. An open region has none, because an open region is the ship."],
      ["MARGIN",(lo*PIPE_BURST_K-pr).toFixed(3)+" MPa",(lo*PIPE_BURST_K-pr)<0?C.red:null,
        "How far the region is from opening at its weakest cell. A real difference, not a ratio."]);
      let Tm=0, h2=0, o2=1;
      for(const i of g.cells){ Tm+=s.roomT[i];
        h2=Math.max(h2, roomH2Frac(s,i)); o2=Math.min(o2, roomO2Frac(s,i)); }
      Tm/=g.cells.length;
      const burning=g.cells.some(i=>s.roomFlame[i]>0);
      rows.push(["AIR TEMP",Tm.toFixed(0)+" K",null,"The mean air temperature over the region. It is what the pressure above follows from."],
        ["HYDROGEN",(h2*100).toFixed(1)+" %",h2>=H2_LFL?C.red:null,
         "The worst cell in the region. A sealed region cannot vent it, so a charge collects here and nowhere else - which is exactly why containments blow their own walls out."],
        ["OXYGEN",(o2*100).toFixed(1)+" %"+(o2<O2_LOC?"  SMOTHERED":""),o2<O2_LOC?C.blue:null,
         "What is left to burn with. A tight region cannot draw fresh air, so a fire in one eats its own and goes out with the hydrogen unburnt - until the wall opens."],
        ["ATMOSPHERE",burning?"BURNING":(h2>=H2_LFL&&o2>=O2_LOC?"FLAMMABLE":"INERT"),
         burning?C.red:(h2>=H2_LFL?C.amber:C.green),"One word for the three readings above."],
        ["HELD BACK",((1-regionRel(s,g))*100).toFixed(0)+" %",null,
         "How much of a release leaving inside this region stays inside it. It is the weakest material on this wall, not a menu row - and it is zero the moment the wall opens."]);
    }
    if(live){ const f=regionFlooded(s,g);
      if(f){ const line=f.bot+1-f.rows;
        const wet=LAY.parts.filter(q=>matRegionOf(q)===g && q.y+q.h>line).map(q=>partName(q));
        rows.push(["FLOODED TO",f.d.toFixed(1)+" m   "+(regionSump(s,g)/1000).toFixed(1)+" t",
          f.d>0?C.blue:null,
          "How deep the water discharged into this region is standing. It fills from the bottom cell up and it cannot pass the deckhead - what will not fit never enters the compartment's book at all."],
          ["HOLDS",wet.length?wet.join(", "):"nothing yet",wet.length?C.red:null,
           "What the water line has reached. A machine under it is drowned, and it takes the same red hatch every wrecked machine takes."]); } }
    const inside=LAY.parts.filter(q=>matRegionOf(q)===g).map(q=>partName(q));
    rows.push(["CONTAINS",inside.length?inside.join(", "):"nothing",null,
      "The machines standing inside this region. They are what its pressure will crush and what its wall is holding the release of."],
      ["WALL MASS",g.wall.reduce((a,i)=>a+matCellMass(i%GW,(i/GW)|0),0).toFixed(1)+" t",null,
       "What this whole boundary weighs, summed off the paint at its own thickness. A bigger enclosure has a longer flat span, a longer span needs a thicker wall, and this is where that is paid."]);
    return rows; }});
  return B;
}
