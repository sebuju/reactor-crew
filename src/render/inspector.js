"use strict";
/* paramsFor(): what a component lets you set, as DATA (kind-tagged blocks, no
   draw closures) - consumed by design-bench.js's paramBlockBuild/Sync.
   Also: the two shared row builders both screens read a component through
   (fieldRows for label+value(+band) lists, statRows for the RESULTS bars),
   and the two summary blocks that belong to the whole design rather than to
   any one component (benchResults/benchReview). */

/* readoutsFor()/planStats()/layoutStats() are shared with the canvas palette
   (C.red etc, core/constants.js) and hand back its raw hex values - this is
   the one place those get translated to the CSS custom properties the same
   palette is also written into (cssVarsBoot()), so an HTML row never carries
   a literal hex colour. */
const C2VAR={};
(function(){ if(typeof C==="undefined") return;
  for(const k in C) if(typeof C[k]==="string" && C[k][0]==="#")
    C2VAR[C[k]]="var(--c-"+k.replace(/([A-Z])/g,"-$1").toLowerCase()+")"; })();
const cssCol=c=>c?(C2VAR[c]||c):"";

/* ══ A PANEL'S TITLE BAR PICKS ITS COMPONENT ══
   The other half of "clicking a component brings its panel up". The rail is a
   list of every component on the ship, so it is also the way to get AROUND the
   plant - and until now the only way to select something was to find it on the
   drawing, which is hard for the parts that are small or behind something.
   Both rails call this, because two rails with a copy each is how the two
   would end up disagreeing about what a title bar does. */
/* WHERE THE PICK CAME FROM, because the two rails answer it the same way: a
   selection made on the DRAWING has to scroll the rail to the panel, and a
   selection made ON that panel's own title bar must not - the panel is already
   under the pointer, and scrolling it to the top pulled it out from under the
   click that made it. Held as the id rather than a flag so a stale one cannot
   swallow the next canvas pick; the sync clears it on the frame it reads it. */
let railPickId=null;
const railSelfPick=()=>{ const self = railPickId!==null && railPickId===sel;
  railPickId=null; return self; };
function railPick(well,ids,name){
  if(!well.head) return well;
  well.head.classList.add("kit-rule-pick");
  well.el._pickId=ids[0];
  well.head.addEventListener("click",()=>{ sel=ids[0]; railPickId=ids[0]; });
  KIT.tip(well.head,name||"",
    "Click to select this component. It lights up on the plant, and a leader runs from it to this panel.");
  return well;
}
/* The mirror of "a click on bare deck deselects": a rail is as much of the
   screen as the canvas is, so a click in it that lands anywhere but the
   selected panel drops the selection too. Bubbles, so railPick()'s own handler
   has already moved `sel` by the time this asks - which is why it compares
   against the well under the pointer rather than remembering the old id. */
function railBlank(rail){
  rail.addEventListener("click",e=>{
    const w=e.target.closest&&e.target.closest(".kit-well");
    if(!w || w._pickId!==sel) sel=null;
  });
}

/* ══ A RAIL ONLY SYNCS THE PANELS YOU CAN SEE ══
   Both rails rebuild every panel's data table on every frame - readoutsFor() in
   the control room, paramsFor() on the bench - and a rail is a tall scroller,
   so most of those panels are past its bottom edge. An IntersectionObserver
   marks the ones actually on screen and the sync loops skip the rest. The
   margin makes a panel live before it scrolls in, so nothing is ever seen
   catching up.

   With no observer (headless) every panel counts as visible, because a gate
   that skips the work would skip every headless reader's coverage with it. */
function railWatch(scroller){
  if(typeof IntersectionObserver!=="function") return {add(el){ el._vis=true; },free(){}};
  const io=new IntersectionObserver(es=>{ for(const e of es) e.target._vis=e.isIntersecting; },
                                    {root:scroller,rootMargin:"200px"});
  return {add(el){ el._vis=true; io.observe(el); }, free(){ io.disconnect(); }};
}
const railSeen = el => el._vis!==false;

/* ══ ONE ROW LIST, TWO SCREENS ══
   readoutsFor() rows and the bench's MEASURED rows are the same shape -
   [label,value,color,tip,band,signedBar] or {sec}. A signedBar carries `m`,
   the limit marks in track fractions, so a centre-zero row can say where the
   line is exactly the way a band's `lim` does. Built once, and checked against
   the handles that build made, so a row set that changes shape (a STATUS row
   appearing on damage, a TRIP mark appearing when a bypass is thrown) rebuilds
   instead of silently misaligning against the old DOM. */

/* Both checks run per panel per frame, so neither may allocate. They compare
   against the handles the last build made rather than building a signature
   string to compare. `lim` in particular is a fresh array literal every frame
   (readoutsFor), so identity can never match it and a JSON string per band row
   per frame was the whole cost of asking. */
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
function fieldRowsBuild(container,rows){
  const out=[];
  let viz=null;
  for(const row of rows){
    if(row.sec){ container.appendChild(KIT.rule(row.sec).el); out.push({sec:row.sec}); continue; }
    /* A genuinely graphical row keeps its own <canvas>, painted by the screen
       through hostPaint() - the rail is opaque, so drawing it on #cv would put
       it under the panel. Same arrangement the lattice plan uses. */
    if(row.viz){
      const c=KIT.el("canvas","insp-viz insp-viz-"+row.viz);
      if(row.tip) KIT.tip(c,row.title||row.viz,row.tip);
      container.appendChild(c);
      /* handed back on the container so the screen paints it off this build
         instead of re-querying the whole screen for it every frame. It cannot
         go stale: a rebuild replaces the canvas and this map together. */
      (viz||(viz={}))[row.viz]=c;
      out.push({viz:row.viz}); continue;
    }
    const el=KIT.el("div","insp-row");
    const lab=KIT.el("span","insp-row-lab"); lab.textContent=row[0];
    const val=KIT.el("span","insp-row-val");
    el.append(lab,val);
    let bar=null,barKind=null;
    if(row[4]){ bar=KIT.band({lo:row[4].lo,hi:row[4].hi,zones:row[4].zones,dp:row[4].dp,lim:row[4].lim,v:row[4].v});
      barKind="band"; el.appendChild(bar.el); }
    else if(row[5]){ bar=KIT.segMark({signed:true,full:row[5].full,dp:row[5].dp}); barKind="sig"; el.appendChild(bar.el); }
    if(row[3]) KIT.tip(el,row[0],row[3]);
    container.appendChild(el);
    /* txt/col are what was last WRITTEN. Asking the element back costs a DOM
       read per row per frame, and for a colour outside the palette it is also
       wrong: #00ffff goes in and rgb(0, 255, 255) comes out, so the guard never
       held and those rows repainted on every frame. Same cache the kit keeps
       for a cell's fill (kit.js). */
    out.push({key:row[0],el,val,bar,barKind,txt:null,col:null,lim:row[4]?row[4].lim:null});
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
    if(H.txt!==row[1]){ H.val.textContent=row[1]; H.txt=row[1]; }
    const col=cssCol(row[2]);
    if(H.col!==col){
      H.val.style.color=col;
      /* THE ROW CARRIES ITS OWN SEVERITY, so the master caution and the rail
         panel it was copied from are washed by the same rule off the same
         fact. Written here rather than by either caller: two of them setting
         it is how the copy and the original end up disagreeing.
         A LEDGER TERM IS EXEMPT, and row[5] is the test. A centre-zero bar is
         what makes a row a term in a balance - the reactivity stack and the
         heat stack - and there the colour is the KEY to the picture beside it,
         not a verdict: fuel is red and decay is amber whatever the plant is
         doing. Washing those painted eight permanent alarm stripes onto a
         healthy reactor panel. */
      const sev = row[5] ? null : row[2];
      H.el.classList.toggle("red",sev===C.red);
      H.el.classList.toggle("amber",sev===C.amber);
      H.col=col;
    }
    if(H.barKind==="band"){ H.bar.set(row[4].v); H.lim=row[4].lim; }
    else if(H.barKind==="sig") H.bar.set(row[5].f,row[5].m,col);
  }
}

/* A stat row - [label,value,frac,color,tip] - the RESULTS panel's shape. */
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

/* ══ WHAT A COMPONENT LETS YOU SET, AS DATA ══
   Every block is {kind,...}. `key` on a slider/optlist/segsel block is a
   plain D field name, or a {get,set} pair for a per-part field (pump size).
   B.gang marks a set of identical components (paramBlockBuild's caller keeps
   the first and lends it the others' ids); B.plain marks nothing to adjust. */
function paramsFor(p){
  const B=[], id=p.id;
  const opt=(title,tip,key,items,base)=>B.push({kind:"optlist",title,tip,key,base:base||0,
    items:items.map(o=>({name:o.name,tip:o.note||o.tip||""}))});
  const seg_=(title,tip,key,labels,base)=>B.push({kind:"segsel",title,tip,key,labels,base:base||0});
  const sld=(title,tip,key,min,max,fmt,step,massFn)=>B.push({kind:"slider",title,tip,key,min,max,fmt,step,massFn});
  // a MACHINE'S OWN QUANTITY, in its own units - see the "num" block (design-bench.js)
  const num=(title,tip,key,unit,dp,suggest,massFn)=>B.push({kind:"num",title,tip,key,unit,dp,suggest,massFn});
  const rdo=(title,tip,val)=>B.push({kind:"readout",title,tip,val});
  const tog=(title,tip,key,mass)=>B.push({kind:"toggle",title,tip,key,mass});
  const note=(text,color)=>B.push({kind:"note",text,color});

  if(!p.access)
    note("NO ACCESS. This component is walled in on every side. No repair party could ever reach it, so it is lost for good the moment it is damaged.","var(--c-red)");

  /* ONE PANEL FOR THE REACTOR AND ITS DRIVES. They were two, and each carried
     its OWN copy of the lattice plan - the same canvas twice, over one shared
     pen, so whichever panel synced last decided what a click on either plan
     did and the other panel's tools could never be selected at all. They are
     one machine to configure: the clusters go into the assemblies, and the
     drives are bolted to the head that carries them. So the rods FOLD into
     this panel (they are a gang, dbRailBuild()) and there is exactly one plan,
     with every pen on it. Two boxes on the plant, one panel - clicking either
     brings this up. */
  /* ══ PRESETS, BUY, DRAW, READ, FIT THE DRIVES, VERDICT ══
     A PRESET COMES FIRST BECAUSE IT WRITES WHAT IS UNDER IT: archPreset() buys
     every material on the panel, so below them it overwrote the rows you had
     just picked. blockSig() keys the rail's rebuild on kind+title, so
     reordering costs nothing. */
  if(p.role==="core"){
    B.gang="reactor"; B.gangPlain=true;
    B.push({kind:"rule",title:"PRESETS",
      tip:"Whole drawings you can begin with. Every one of them lays out fuel, moderator and banks with the same pens you have - a preset cannot describe a reactor you could not have drawn yourself."});
    /* designForget() FIRST, the same order plantPreset() keeps: a family change
       moves the rating by 30x, and every machine figure already baked was
       priced off the family before it - a helium plant kept a PWR's 937 000 m2
       of panel and its 6.9 MPa shell. */
    B.push({kind:"bulkrow",label:"REACTOR",items:ARCHPRE.map((pr,i)=>({name:pr[0],tip:pr[2],fn:()=>{ designForget(); archPreset(i); }}))});
    B.push({kind:"bulkrow",label:"LATTICE",items:LATPRE.map((pr,i)=>({name:pr[0],tip:pr[2],fn:()=>latPreset(i)}))});
    B.push({kind:"bulkrow",label:"SPREAD",items:[1,2,3,4].map(n=>({name:String(n),
      tip:"Clear every cluster and lay "+n+" bank"+(n>1?"s":"")+" again, spread by area over the core the way the stock lattice does - so each bank covers about the same share of the fuel."+
        (n<2?" One bank has nothing to lean a flux tilt against, so tilt trim and SPLIT mode have no work to do."
            :" Fewer banks sit nearer the flux and so measure a little more worth; watch CONTROL BANK WORTH below say by how much."),
      fn:()=>{ latLayBanks(n); latRevolve(); }}))});
    opt("COOLANT","What flows through the core. It sets operating pressure, where it boils, how much power a litre of core makes, and how well it moderates. It no longer decides the void coefficient: that is measured off what you draw.","cool",COOLANT);
    /* One FUEL row per loading zone that has fuel in it. The setter must
       latMeasure() itself: an optlist is not a lattice edit, so nothing else
       would re-blend densK into D.power. */
    {
      const zs=latZonesUsed(), one=zs.length<2;
      for(const z of zs)
        opt(one?"FUEL":"FUEL ZONE "+(z+1),
          "Sets beta - your reaction time before prompt criticality - plus excess reactivity and core density."+
          (one?" Paint zones on the plan below and this becomes one row per zone, which is how a real core is loaded."
              :" This row loads the slots you painted as zone "+(z+1)+". The core's beta, density and excess are the blend; its melt limit is the WORST fuel in it."),
          bagAcc(D.zoneFuel,z,()=>zoneFuelOf(z),latMeasure),FUEL);
    }
    // a feature of the VESSEL, which is what its own tooltip already said -
    // it never belonged on the pressurizer's panel
    sld("CHIMNEY HEIGHT","How tall the standpipe above the core is. It is a feature of the vessel, not of any one loop, and it is what natural circulation leans on when the pumps are gone - taller buys grace time and costs steel.","chim",0,1,v=>v.toFixed(2)+" x",.05,v=>v*38);
    opt("MODERATOR","What a moderator BLOCK is made of. It only matters if you draw blocks with the MODERATOR pen - and in a helium or sodium core, blocks are the only moderation there is.","mod",MODER);
    seg_("REFLECTOR","What is wrapped round the core. You buy the material here; how many cells of it there are on each face is drawn in the section.","refl",LATREFL);
    opt("ABSORBER","What the clusters are made of. This used to be solved for, until a fully-inserted bank came to whatever CONTROL BANK WORTH was set to. Now you buy a material, put the clusters where you want them, and the worth is what the solve measures.","__abs",ABSORB);
    B.push({kind:"lattools",pen:"plan",title:"RADIAL PLAN",
      tools:LATPEN_CORE.concat(LATPEN_RODS),
      tip:"A quarter of the core seen from above - the r axis of the solve, revolved about the corner of the first slot. Every pen here is a toggle: click a slot to lay the thing down, click it again to take it away, and hold SHIFT while you drag to clear whatever you cross. The section below has pens of its own."});
    B.push({kind:"latplan"});
    B.push({kind:"lattools",pen:"sec",title:"AXIAL SECTION",
      tools:LATPEN_SEC,
      tip:"The core in elevation - the z axis of the solve, on a fixed metric scale. These pens are its own, so a plan pen never stands the section down, and the top of the fuel column is a handle you can drag whichever pen is up."});
    B.push({kind:"latsection"});
    B.push({kind:"rule",title:"MEASURED",
      tip:"Every number on this list is an OUTPUT of the drawing above. Not one of them is a value you can set - if you want one of them to move, move the drawing."});
    /* ONE list, one mapper. LATREAD and LATREAD_RODS carry the same four
       columns, so a row can move between them without changing shape. */
    B.push({kind:"readlist",rows:()=>LATREAD.concat(LATREAD_RODS)
      .map(r=>[r[0],r[1](),r[3]?r[3]():null,r[2]])});
    opt("SCRAM SYSTEM","How the rods are driven in during an emergency shutdown.","scram",SCRAM);
    num("ROD DRIVE SPEED","How fast the drives walk the bank under normal control, as a percentage of full travel every second - the reference drive strokes end to end in 83 s. A fast core answers a rod before you have finished moving it and wants a motor to match; a graphite pile does not. It does NOT touch the scram, which drops on the system above. A motor that strokes twice as fast is twice the machine, and the mass hint is what that costs on every bank you have.",
        {get:()=>D.rodSpd*100, set:v=>{ D.rodSpd=v/100; dTouch(); }},
        "%/s",2,()=>ROD_SPD0*100,v=>D.nbank*ROD_BANK_T*(v/100/ROD_SPD0-1));
    opt("ROD FOLLOWER","What occupies the channel below the absorber. It decides whether inserting the bank is monotonic: a graphite follower displaces water at the bottom of the core and adds reactivity there before any absorber arrives.","foll",FOLL);
    tog("AUTOMATIC ROD CONTROL","A controller that holds coolant temperature on program so the plant follows load by itself. It only ever drives the bank inside the travel band you set below; you can always override it.","autorod",26);
    /* THE BAND THE CONTROLLER WORKS IN, as two handles rather than two
       constants. AUTOSYS.rod's own tooltip has always promised "the travel
       band set on the rod-drive panel" and there was no such control - the
       numbers were real, live and invisible. Hidden with the controller
       itself: with nothing automatic fitted there is no band to set. */
    B.push({kind:"slider",title:"AUTO ROD OUT LIMIT",key:"arLo",min:0,max:1,step:.01,
      when:()=>D.autorod, fmt:v=>(v*100).toFixed(0)+" %",
      tip:"The furthest OUT the temperature controller may walk the bank on its own. Pull it out and the controller has more authority over coolant temperature and you have less shutdown margin, because the position your margin was measured from is the position it is allowed to leave. Your own demand is never bound by it."});
    B.push({kind:"slider",title:"AUTO ROD IN LIMIT",key:"arHi",min:0,max:1,step:.01,
      when:()=>D.autorod, fmt:v=>(v*100).toFixed(0)+" %",
      tip:"The furthest IN the controller may drive the bank on its own. Deeper insertion buys it more authority and costs thermal margin, because a deep bank peaks the power. Set it at or below the out limit and the band closes to nothing, which parks the controller where it stands."});
    B.push({kind:"sdmnote"});
  }
  /* No blocks of its own: every one of them is on the reactor panel above,
     and this marks the drives as the second member of that gang so clicking
     the drives on the plant brings the same panel up. */
  else if(p.role==="rods"){ B.gang="reactor"; B.gangPlain=true; }
  else if(p.role==="sg"){
    opt("GENERATOR TYPE","U-tube units hold a lot of secondary water that keeps removing heat for minutes after feedwater is lost. Once-through units are light, respond instantly, and boil dry just as fast. Each generator is its own machine, so a U-tube on one loop and a once-through on another is a legal plant.",
        bagAcc(D.sgType,id,()=>sgTypeOf(id)),SGT);
    /* The type row says how much water is in it; this says how fast heat
       crosses the tubes. They were one figure and they are not the same
       question - a big-inventory shell with poor tubes is a real machine. */
    num("TRANSFER COEFFICIENT","How fast heat crosses this generator's tubes, in kilowatts per kelvin. Buy more and the same core raises hotter steam at a smaller temperature difference; buy less and the primary runs hotter for the same power. SUGGEST matches it to this core at its own rated power.",
        {get:()=>sgUAOf(id),set:v=>{ D.sgUA[id]=v; }},
        "kW/K",0,()=>sgUASuggest(),()=>0);
    num("DESIGN PRESSURE","What THIS shell is built to hold, in megapascals. It is what the safety valve lifts against, what the shell bursts a fifth above, and the pressure the turbine's enthalpy drop is taken from - so buying a higher one raises the steam this generator can make and everything downstream has to take it. SUGGEST is a share of the primary's own setpoint, which is where an untouched plant sits.",
        {get:()=>sgDesPOf(id),set:v=>{ D.sgDesP[id]=v; }},
        "MPa",2,()=>sgDesPSuggest(),()=>0);
    B.push({kind:"readlist",rows:()=>{ const r=sgRowOf(id); return [
      ["SHELL BURSTS AT",sgBurstP(id).toFixed(2)+" MPa",null,"Where the shell itself lets go, off the design pressure above. Nothing stops it getting there except a relief valve you placed on its steam nozzle."],
      ["SECONDARY WATER",r.water.toFixed(0)+" t",null,"What is in THIS shell at 100 % level. It is what goes on removing heat after the feedwater stops, and it is the whole of the difference between the two types."],
      ["SHELL STEEL",sgShellT(id).toFixed(1)+" t",null,"The pressure shell itself, off its own water charge as a vessel at the wall its design pressure needs. Raise the pressure above and this goes up with it."],
      ["TUBE BUNDLE",sgTubeT(id).toFixed(1)+" t",null,"The tubes, priced off the transfer coefficient you bought. A bigger UA is more tube, and more tube is more steel."]]; }});
    /* MEASURED, not the label this used to carry: a placed tank and pump
       (layout.js) piped to the generator, but the flow itself is not solved
       until the secondary conserves water - so what this buys today is the
       stated dump term below, and NOTHING measurable on grace time (that is
       set by the coolant family and the generator type, off sgInertiaK(),
       not by this). Stock plant, scram, 600 s: on runs the loop a few
       degrees cooler than off, and P.graceK does not move for it. */
    note("Emergency feedwater is a TANK, not a fitting on this pump: add one, set it to the secondary side and give it the LOW SG LEVEL rule. Its arm switch lives on the tank.");
    note("Height matters more than anything else on this component. Sitting above the reactor, it drives natural circulation with no pumps at all.");
  }
  else if(p.role==="ihx"){
    num("TRANSFER COEFFICIENT","How fast heat crosses this exchanger's tubes, in kilowatts per kelvin of temperature difference. A big one gives back some of the shell temperature the second stage costs you, and it is a bigger flywheel after a trip. It is also the heaviest single thing you can buy per tonne of benefit. SUGGEST matches it to the generators in front of it.",
        {get:()=>ihxUAOf(id),set:v=>{ D.ihxUA[id]=v; }},
        "kW/K",0,()=>ihxUASuggest(),v=>v*IHX_T_PER_UA);
    B.push({kind:"readlist",rows:()=>{ const served=ihxSgs(id); return [
      ["FEEDS",served.length?nameList(served):"nothing",null,"Which generators this exchanger heats. It is whatever is on the loop you spliced it into - splice it in with a hot leg and a cold leg, exactly like a generator."],
      ["EXCHANGER MASS",(ihxUAOf(id)*IHX_T_PER_UA).toFixed(0)+" t",null,"The vessel and the intermediate coolant behind it. It is the whole price of the second stage, and it is heavy."]]; }});
    note("A second heat transfer stage, and it is a BARRIER. The primary heats this exchanger and this exchanger heats the generators on its loop, so a tube rupture in one of those generators leaks THIS loop's coolant into the shell and costs no release at all. Two conductances in series cost a temperature drop, so the same core raises colder steam and makes less electricity - that is the price of the barrier.");
    note("The intermediate loop is not solved as its own hydraulic circuit - it is a temperature and a heat capacity, the same standing the steam side has. Its pumps are not modelled.");
  }
  else if(roleHead(p.role)){
    num("DEVELOPED HEAD","The pressure rise this pump makes at its rated flow, in megapascals. It is what pushes water from the SUCTION face to the DISCHARGE face and nothing else decides which way it goes - so a pump has to beat whatever pressure stands on the far side before a drop moves. SUGGEST asks the drawing what that is.",
        {get:()=>pumpHead(id),set:v=>{ D.pumpHead[id]=v; }},
        "MPa",2,()=>pumpHeadSuggest(id),()=>pumpMassOf(id));
    num("RATED FLOW","The mass of coolant this pump moves per second at that head. Head and flow together are the machine: the flow is the bore of the casing, so a bigger pump passes more water for the same head.",
        {get:()=>pumpFlow(id),set:v=>{ D.pumpFlow[id]=v; }},
        "kg/s",0,()=>pumpFlowSuggest(id),()=>0);
    /* WHAT THIS PUMP IS FOR, off the drawing rather than off its id. There is
       one pump role: a coolant pump is a pump the loop walk reaches from a
       generator, a feed pump is one that reaches a generator's SHELL, and a
       pump piped to neither is a pump somebody placed and has not wired up. */
    note(secGensOf(id).length
      ?"Piped to a generator's shell, so this is a FEEDWATER pump: it holds that generator's level through its own regulating valve, and the level controller's switch is the FEED CTRL bypass."
      :primaryPump(id)
        ?"In a coolant loop, so this is a COOLANT pump. Flow is the single biggest input to thermal margin, and the first thing a blackout takes off you."
        :"Piped to nothing that reaches a core or a generator. It develops its own head and pools capacity with nobody - draw a run from it, or right-click the plant to remove it.");
  }
  else if(p.role==="turb"){
    num("STEAM SWALLOW","The mass of steam this machine takes per second, wide open. It is what the turbine IS - efficiency follows from it and is not a second thing to buy. Every turbine is sized on its own, so a big machine and a small one is a legal fleet. SUGGEST matches it to the steam this plant will actually raise.",
        {get:()=>turbKgs(id),set:v=>{ D.turbKgs[id]=v; }},
        "kg/s",0,()=>turbKgsSuggest(),v=>v*TURB_T_PER_KGS);
    B.push({kind:"readlist",rows:()=>{ const d=derived(); return [
      ["EFFICIENCY",(COOLANT[D.cool].eff*turbEffOf(id)*100).toFixed(1)+" % gross",null,"What this turbine on its own turns into electricity. It is DERIVED from the swallow above, by the law that isentropic efficiency rises slowly with machine size - a set ten times bigger is a few points better, not twice as good."],
      ["RATED OUTPUT",(D.power*d.eff).toFixed(0)+" MWe",null,"Electrical power at 100% reactor power with the condenser keeping up. This is the number the ship gets, and it is the whole reason the reactor is here."],
      ["MAX LOAD",(d.loadMax*100).toFixed(0)+" %",null,"The furthest the load slider will go in the control room, as a share of the steam this plant raises at full power. A matched machine reads 100 %. Overpower is not free reach: it is turbine you paid mass for."]]; }});
    note("In the full game this is where weapons and ship systems draw from. A hit here rejects load instantly and the reactor has nowhere to put its heat.");
  }
  else if(p.role==="cond"){
    num("CONDENSING DUTY","How fast heat crosses this condenser's tubes, in kilowatts per kelvin. It is what the machine IS: it sets how much steam you can condense at full draw, and it sizes the circulating water flow with it. Overload a small condenser and backpressure eats your electrical output while the reactor goes on making the heat. SUGGEST matches it to this plant's rated rejection.",
        {get:()=>condUA(id),set:v=>{ D.condUA[id]=v; }},
        "kW/K",0,()=>condUASuggest(),v=>v*COND_T_PER_UA);
    num("DUMP CAPACITY","The steam this unit will take straight past the turbine, per second. On a plant that boils in its own core the bypass is open whenever the governor is closing, so this is what lets it follow a load change without a safety valve lifting; on a subcooled plant it opens on a scram.",
        {get:()=>condDump(id),set:v=>{ D.condDump[id]=v; }},
        "kg/s",0,()=>condDumpSuggest(),()=>0);
    B.push({kind:"readlist",rows:()=>{ const d=derived(); return [
      ["PLANT CAPACITY",(d.condCap*100).toFixed(0)+" % of full-load duty",null,"Every condenser on the plant added up, against the heat this plant actually rejects at full power. Draw more than this and exhaust pressure climbs, which costs the turbine work. Match it to the turbine's max load or accept the loss."],
      ["TURBINE CAN DRAW",(d.loadMax*100).toFixed(0)+" %",null,"The turbine's own ceiling, on the same basis as the row above, so the mismatch is visible from either component."],
      ["TERMINAL DIFFERENCE",COND_DT0+" K",null,"How far this machine sits above the sink it rejects into, at rated duty. Duty DIVIDES it: a half-size unit sits twice as far above the radiator for the same heat."],
      ["DESIGN BACKPRESSURE",condPDes().toFixed(4)+" MPa",null,"The exhaust pressure the turbine was built for - the anchor every other figure on this side is priced against. It is a stated design point and a bad radiator does not move it."],
      ["VACUUM FLOOR",COND_P0+" MPa",null,"The best vacuum this plant can ever pull, set by air leaking in and nothing else. An oversized condenser runs down onto this and stops paying."],
      ["TURBINE TRIPS AT",TURB_TRIP_P+" MPa",null,"The exhaust pressure the last-stage blading will not take. The stop valve shuts, and it does not reset."],
      ["VACUUM LOST AT",COND_ATM+" MPa",null,"Past atmospheric the condenser relieves and the air is in for good. This is the second failure, and it is the end of the heat sink."]]; }});
    B.push({kind:"note",dyn:()=>{ const d=derived();
      return {text:d.condShort
        ?"This condenser is far smaller than the turbine can draw. It runs hotter for the same heat, so the exhaust pressure climbs and the output falls with it - a unit at a third of duty gives back roughly a tenth of the plant's electricity at rest, before any overload."
        :"Condenser is matched to the turbine. A brief overload costs little or nothing, and a bigger unit runs down onto the vacuum limit and stops paying.",
        color:d.condShort?"var(--c-amber)":null}; }});
  }
  /* ══ THE ONLY WAY HEAT LEAVES THE SHIP ══
     Design-time figures only: the bench has no S, so PANEL TEMPERATURE and
     what a panel is actually shedding live on the control-room rail. AT RATED
     is radTAt(), the same expression the tick integrates against, so the
     bench and the plant cannot quote two different sinks. */
  else if(p.role==="radiator"){
    num("RADIATING AREA","The surface this panel actually radiates from, in square metres. The box on the grid is a PICTURE of it, snapped to whole cells, so a small plant draws a small panel. Rejection goes as the FOURTH power of panel temperature, so area does not buy heat directly - it buys a colder panel, which buys backpressure, which buys output and overload headroom. SUGGEST matches the fleet to this plant's own rejection at the design sink.",
        {get:()=>radAreaOf(id),set:v=>{ D.radArea[id]=v; }},
        "m²",0,()=>radAreaSuggest(id),v=>v*RAD_MASS_M2*radCoatOf(id).massK);
    num("COOLANT SIDE","How fast the water going through this panel can hand its heat to the surface, in kilowatts per kelvin. AREA decides what the panel can radiate; this decides what its tubes can collect, and a panel plumbed to nothing collects nothing whatever either figure says. SUGGEST carries this panel's own design rejection on a "+RAD_DT0+" K approach.",
        {get:()=>radUAOf(id),set:v=>{ D.radUA[id]=v; }},
        "kW/K",0,()=>radUASuggest(id));
    opt("COATING","What the panel is finished with. Emissivity is how much of a black body's radiation it actually sheds - and the good coatings are heavy and fragile.",
        bagAcc(D.radCoat,id,()=>D.radCoat[id]??1),RADCOAT.map(r=>({name:r[0]})));
    B.push({kind:"readlist",rows:()=>{ const d=derived(), live=radLive(id);
      const tr=radTRated(d.eff);
      return [
      ["CAN SHED",live?"YES":"NO",null,"A panel radiates only through the skin. One face of its own footprint against the hull is enough. Walled in on every side it sheds nothing at all: measured, the stock pair moved inboard trips the turbine in under two minutes and the plant makes no electricity."],
      ["SHEDDING",live?(radArea(id)/1e6).toFixed(2)+" Mm²":"0",null,"What this panel is worth as fitted. Blind, it is zero however big the box is."],
      ["EMISSIVITY",radCoatOf(id).emis.toFixed(2),null,"The share of a perfect black body's radiation this finish actually sheds, at the same temperature."],
      ["PLANT AT RATED",isFinite(tr)?tr.toFixed(0)+" K":"no sink",null,"Where every panel on the ship would sit with the reactor at full power. Design is "+RAD_TDES+" K; above it the condenser runs hotter and the turbine gives work back, below it the plant runs down onto its vacuum floor and stops paying."],
      ["PANEL MASS",radMass(id).toFixed(0)+" t",null,"Structure and coolant. Area is not free and the ceramic finish is the heaviest of the three."]]; }});
    note("Every watt this plant does not turn into electricity leaves as light, through these panels and nowhere else - and rejection goes as the fourth power of their temperature, so the overload the ship can take is set by area and by nothing else. A blind panel is not a slow leak: it is the whole heat sink gone. So is an unplumbed one: a panel cools the water running through it, so where you pipe it is what it cools.");
  }
  else if(p.role==="ctrl"){
    opt("INSTRUMENT CHANNELS","How many independent sensors watch each parameter. This decides whether you can tell a broken gauge from a real emergency.","chan",CHAN);
    tog("REACTOR PROTECTION SYSTEM","The automatic trips. Fitted, it scrams the core on high flux, low DNBR, high or low pressure, high fuel temperature, low flow, core void or low subcooling. Leave it off and none of that happens: the reactor will run itself to destruction and wait for you to notice.","rps",55);
    B.push({kind:"slider",title:"RPS TRIP MARGIN",key:"rpsm",min:0,max:1,step:.05,
      fmt:v=>(v*100).toFixed(0)+" % permissive",when:()=>D.rps,
      tip:"How much overhead the automatic protection allows before it scrams. Conservative trips at 110% flux and 1.18 DNBR, so the plant is hard to damage and you can never push it. Permissive lets you reach 132% and 1.02 DNBR, which is real combat performance and a much smaller margin for error."});
    note("Crew dose during an accident falls with distance from the reactor and drops sharply for every shield block between the two. Move this room and watch the dose figure in RESULTS.");
  }
  /* ══ ONE PANEL, EVERY TANK ══
     There is no menu of kinds anywhere in this game, and this is why: an
     accumulator, a boron tank, a relief tank and a hotwell are these eight
     knobs at four settings. Every one of them writes D.tanks[id] through the
     normal design path, so designSig() sees it and the plant re-commissions.
     FLUID_IDS/AUTO_IDS are read off the tables themselves, so adding a
     substance or an opening rule adds an entry here for free. */
  else if(p.role==="fitting") return paramsForFit(id);
  else if(p.role==="tank"){
    const t=()=>D.tanks[id];
    const acc=(f)=>({get:()=>t()[f], set:v=>{ t()[f]=v; }});
    const FLUID_IDS=Object.keys(FLUID), AUTO_IDS=Object.keys(AUTORULE);
    B.push({kind:"optlist",title:"CONTENTS",key:{get:()=>FLUID_IDS.indexOf(t().fluid),
        set:i=>{ t().fluid=FLUID_IDS[i]; }},base:0,
      tip:"What is in the tank. This is the whole of what makes one tank different from another: activity, reactivity worth and what a burst disc puts into the air all follow from it.",
      items:FLUID_IDS.map(f=>({name:FLUID[f].label,
        tip:(FLUID[f].boron?"Worth "+FLUID[f].boron+" pcm per 1 % of loop inventory delivered. ":"")
           +(FLUID[f].act?"Active - a full tank of it is a place a repair party would rather not stand.":"Not active.")}))});
    /* THE "PLUMBED TO" SELECTOR IS DELETED. It asked the designer to declare
       what the drawing already said, and let the two disagree with nothing to
       catch it - a tank marked PRIMARY and piped into the secondary was a
       legal, silent lie. tankSide() reads it off the runs instead
       (layout.js), so there is one fact and it comes from the pipe you drew.
       This row is a READOUT now, and it says "not connected" honestly. */
    B.push({kind:"readlist",rows:()=>{ const ci=tankCircuit(id);
      return [["PLUMBED TO", ci===null ? "NOTHING" : circName(ci), ci===null?C.amber:null,
        ci===null ? "Nothing is piped to this tank, so it is on no circuit at all - it has no edge, it can deliver nothing, and it is counted by nothing. Draw a run from it."
        : tankPrimary(id) ? "This tank has a node in the pressure solve and one edge into the loop, so what it delivers is fought for against loop pressure."
        : "This tank is on the far side of a heat exchanger: it answers to that circuit's own pressure, not to the core loop's."]]; }});
    /* CUBIC METRES, and it always was: tankKg() is vol*TANK_RHO and partVol()
       hands it back as holdup. The row said "%" and quoted 0.4 t/m^3 against
       tankMass()'s 0.5 - two units and two prices for one number. It is a real
       quantity in its own units now, and the mass hint is the mass term. */
    sld("CAPACITY","How big it is, in cubic metres. It costs the steel of a shell that size at the pressure it has to hold, and it is what turns a solved flow into a level.",
      acc("vol"),5,100,v=>v.toFixed(0)+" m3",5,v=>tankMassOf(id,v));
    sld("ASPECT","What SHAPE that volume is on the grid, width against height. The area is the volume either way - this only decides whether it stands as a tall column or lies as a wide drum, and a shape that fits the deck you have is worth having.",
      {get:()=>tankAspect(id), set:v=>{ t().aspect=v; }},
      0.25,4,v=>v.toFixed(2)+" w:h",0.25);
    /* ══ A PRESSURIZER IS A TANK WHOSE GAS SPACE IS CONTROLLED ══
       Two rows, and there is no pressurizer part any more. Put one on a second
       circuit and that circuit gets its own pressure. */
    B.push({kind:"toggle",title:"PRESSURE CONTROL",mass:0,
      key:{get:()=>!!t().hold, set:v=>{ t().hold = v?{p:null}:null; }},
      tip:"Make this vessel hold the pressure of whatever circuit it is piped to. Its gas charge stops being consulted - that is what CONTROLLED means - and its line becomes the surge line, ordinary pipe carrying the loop both ways. One per circuit: a second one on the same circuit is demoted and warned about."});
    sld("SETPOINT","The pressure this vessel holds its circuit at. Higher raises the boiling point, so it buys thermal margin and resists voiding - and every machine on the circuit needs the wall to take it, which is steel.",
      {get:()=>t().hold?(t().hold.p||holdSetP(tankCircuit(id))):0,
       set:v=>{ if(t().hold) t().hold.p=v; }},
      0.2,22,v=>v.toFixed(1)+" MPa",0.1);
    sld("FILL AT COMMISSIONING","How full it starts. A source ships full; a tank meant to catch something ships empty, and its gas charge is set at whatever level you leave here.",
      acc("level"),0,100,v=>v.toFixed(0)+" %",5);
    B.push({kind:"toggle",title:"GAS CHARGE",mass:8,
      key:{get:()=>!!t().gas, set:v=>{ t().gas = v?{p0:4.5,frac:0.35}:null; }},
      tip:"A cover gas above the liquid. It is what makes the pressure mean anything: a vented tank never pressurises, so it can have no back-pressure and no rupture disc. It expands as a source empties and is compressed as a sink fills."});
    sld("CHARGE PRESSURE","What the gas holds at the commissioning level. It falls as a source drains and rises as a sink fills - that taper is the whole difference between an accumulator and a pump.",
      {get:()=>t().gas?t().gas.p0:0, set:v=>{ if(t().gas) t().gas.p0=v; }},
      0.05,15,v=>v.toFixed(2)+" MPa",0.05);
    sld("GAS SPACE","How much of the tank is gas rather than liquid. A big space holds its pressure up as the tank drains, so the flow tapers late; a small one collapses as soon as it starts moving.",
      {get:()=>t().gas?t().gas.frac:0, set:v=>{ if(t().gas) t().gas.frac=v; }},
      0.05,0.8,v=>(v*100).toFixed(0)+" %",0.05);
    B.push({kind:"toggle",title:"CHECK VALVE",mass:4,
      key:acc("check"),
      tip:"A non-return valve on the tank's own line. With one, the tank can only ever push OUT - which is what makes it a source. Without one it fills as readily as it drains, which is what makes it a sink."});
    B.push({kind:"toggle",title:"RUPTURE DISC",mass:2,
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
    B.push({kind:"optlist",title:"OPENS ITSELF ON",key:{get:()=>AUTO_IDS.indexOf(t().auto),
        set:i=>{ t().auto=AUTO_IDS[i]; }},base:0,
      tip:"When this tank lines itself up without being asked. The operator's own valve is always there beside it - this only ever OPENS, it never overrides a switch.",
      items:AUTO_IDS.map(a=>({name:AUTORULE[a].label,tip:""}))});
  }
  else if(p.role==="bkp"){
    opt("BACKUP POWER","What keeps the coolant pumps turning when main power is lost. Test it with the Station Blackout fault in the control room.","bkp",BKP);
    note("With no backup, a blackout leaves you nothing but natural circulation - which is set by how high you put the steam generators and how tall you made the core.");
  }
  else {
    note(p.tip);
    B.push({kind:"note",text:"NO ADJUSTABLE PARAMETERS"});
    B.plain = p.access;
  }
  return B;
}

/* ══ WHAT A FITTING LETS YOU SET ══
   A branch of paramsFor(), reached the way a tank's panel is: WHAT it is
   (mode) and how big it is (bore) are the design, and the position it is
   worked to is not. A relief valve's lift and reseat pressures are MECHANICAL,
   chosen when it is built, so they live in D.fittings and never on S; the
   arming switch is the opposite - it is worked during a transient - and lives
   on the valve's own control strip (ctlFor(), plant.js). */
/* ══ A RUN IS A MACHINE TOO, AND IT HAS A PANEL ══
   D.bore and D.wall have been hooks with no writer: runBoreMm()/runWallMm()
   read them and nothing ever set one, so a pipe was the last thing on the
   plant whose own size the player could not state. It is not a PART - it has
   no box and no id in LAY - so it is addressed by its RUN KEY, which is the
   name pipeMap() gives it and the name every other reader already uses.
   `sel` carries that key: a run key always contains a colon and a part id
   never does, so the two selection spaces cannot collide and every
   partOf(sel) reader already answers null for one. */
const runOfKey = key => pipeNetwork().find(r=>r.key===key) || null;
const isRunKey = k => typeof k==="string" && k.indexOf(":")>=0 && !!runOfKey(k);
function paramsForRun(key){
  const B=[], r=runOfKey(key); if(!r) return B;
  const num=(title,tip,k,unit,dp,suggest,massFn)=>B.push({kind:"num",title,tip,key:k,unit,dp,suggest,massFn});
  /* MASS IS PER METRE OF THIS RUN, so the hint prices the change the slider
     would actually make rather than a metre of pipe in the abstract. */
  const massAt=(bore,wall)=>shellTPerM(bore,wall)*r.L;
  num("BORE","How wide this run is, inside the pipe. It is the whole of what the run conducts: a narrow leg is a real restriction and a wide one costs steel and holds more water. SUGGEST is what a run of this kind ships at.",
      {get:()=>runBoreMm(r), set:v=>{ D.bore[r.key]=v; dTouch(); }},
      "mm",0,()=>boreMm(r.k),v=>massAt(v,runWallMm(r)));
  num("WALL","How thick the steel is. It is what the run is RATED for and it is what the run weighs - the two are the same number seen from either end. SUGGEST is the thickness this bore needs at the pressure this run actually carries.",
      {get:()=>runWallMm(r), set:v=>{ D.wall[r.key]=v; dTouch(); }},
      "mm",1,()=>wallSuggestMm(runBoreMm(r), runDesignP(r), PRIMARY_K[r.k]?COOLANT[D.cool]:null),
      v=>massAt(runBoreMm(r),v));
  B.push({kind:"readlist",rows:()=>{
    const c=pipeMap().byKey[r.key], a=c&&partOf(c.a), b=c&&partOf(c.b);
    const rate=runRating(r), held=runDesignP(r);
    return [
      ["RUNS FROM",(a?partName(a):"?")+" ⇒ "+(b?partName(b):"?"),null,
       "The two machines this run joins. It is traced off the pipe you drew, never authored - move either machine and this follows."],
      ["LENGTH",r.L.toFixed(1)+" m",null,"How far it actually goes, cell by cell. Length is resistance and it is mass."],
      ["HOLDS",runVol(r).toFixed(2)+" m3",null,"The water standing in it, off the bore and the length. A node with volume has a time constant, which is why a long fat leg is slow to change temperature."],
      /* WHAT IS IN IT, in words. The meter above says kilograms a second and a
         kilogram of wet steam is not a kilogram of water: this is the same
         reading the pipe is drawn in (pipePhaseCol, pipes.js), stated. */
      ["CARRYING",(()=>{ const q=pipePhase(r,S);
        if(!q) return "NOTHING";
        return Math.abs(q[0]-q[1])<0.02 ? pipePhaseWord((q[0]+q[1])/2)
          : pipePhaseWord(q[0])+" to "+pipePhaseWord(q[1]); })(),null,
       "The phase of what is actually in this run, at each of its own two ends - off the enthalpy field, never off what the run was drawn for. A run with no path in the network carries nothing and says so."],
      ["CARRIES",held.toFixed(2)+" MPa",null,"The pressure this run is actually asked to hold - its circuit's own setpoint, or the shell design pressure on the secondary."],
      ["RATED FOR",rate.toFixed(2)+" MPa",rate<held?C.red:null,
       "What the wall above will take, off the published hoop-stress relation. Under what it carries, this pipe is the thing that lets go first."],
      ["BURSTS AT",runBurstP(r).toFixed(2)+" MPa",runBurstP(r)<held?C.red:null,
       "Where this run actually splits open. A rating has its margin inside it, so a pipe held past the rating is not open yet - past this it is, at one cell, and it does not close again."],
      ["MASS",massAt(runBoreMm(r),runWallMm(r)).toFixed(1)+" t",null,"What this run weighs: the shell it is, at the wall it has, over the length it runs."]]; }});
  return B;
}
function paramsForFit(fid){
  const B=[], j=D.fittings[fid]; if(!j) return B;
  const MODE_IDS=["tee","throttle","relief"];
  B.push({kind:"optlist",title:"FITTING",base:0,
    key:{get:()=>MODE_IDS.indexOf(j.mode), set:i=>{ j.mode=MODE_IDS[i]; }},
    tip:"What this fitting IS. All three are the same box in the same cell - a tee is a plain junction with no gate at all, a throttle is a valve you work by hand, and a relief valve works itself off a setpoint.",
    items:[{name:"TEE",tip:"A junction. Four faces, one node, no gate: it costs the line nothing and closes nothing."},
           {name:"THROTTLE",tip:"A valve you set and it holds. Wide open it costs the line nothing at all; shut it is a real break in the pipe."},
           {name:"RELIEF VALVE",tip:"Lifts on its own at its own setpoint and blows the line down through whatever is piped behind it. Leave its outlet unpiped and it vents straight into the room."}]});
  /* MILLIMETRES, like the pipe it sits in. It was 0.1-1 "x" of a full-bore
     leg, so a valve and its own line stated the same quantity in two units.
     boreK()/fitBoreK() (pipenet.js) are the one conversion into the solve. */
  B.push({kind:"slider",title:"BORE",step:BORE_REF/20,min:BORE_REF/10,max:BORE_REF*1.5,
    key:{get:()=>j.bore, set:v=>{ j.bore=v; }},
    fmt:v=>v.toFixed(0)+" mm",
    tip:"How wide the valve is. A wide relief valve vents faster; a wide throttle costs the line less when it is open. It is steel either way, so it is on the mass budget.",
    massFn:v=>FIT_MASS*(v/FIT_BORE0)});
  const sld=(title,tip,key,min,max,fmt,step)=>B.push({kind:"slider",title,tip,key,min,max,fmt,step});
  const rdo=(title,tip,val)=>B.push({kind:"readout",title,tip,val});
  if(j.mode!=="relief") return B;
  /* MEGAPASCALS, not a multiple. They were fractions of reliefRefP(), so the
     number on the panel was not the number on the valve and moving the
     circuit's setpoint moved every relief valve on the plant with it. The
     span is this valve's own reference either side, so a 0.2 MPa sodium loop
     and a 15.5 MPa water one both get a slider they can work in. */
  const dp = v => v<1 ? v.toFixed(3) : v.toFixed(2);
  const lo = reliefRefP(fid)*0.9, hi = reliefRefP(fid)*1.35;
  const stp = Math.max(0.005, +(reliefRefP(fid)*0.01).toFixed(3));
  sld("LIFT PRESSURE",
    "The pressure this valve opens itself at. Low and it lifts on every transient and spends its stick chances early; high and pressure climbs further before anything vents, toward a vessel that bursts at about 122% of what it holds.",
    {get:()=>reliefSet(fid).lift,
     // the deadband is dragged down with the lift point, or a valve dialled
     // low would end up reseating above its own lift and chatter every tick
     set:v=>{ j.lift=v; if(reliefSet(fid).reseat > v-stp) j.reseat=v-stp; }},
    lo,hi,v=>dp(v)+" MPa",stp);
  sld("RESEAT PRESSURE",
    "The pressure it shuts again at. The gap up to the lift point is the deadband, and it is what stops the valve chattering on its own setpoint - it cannot be dragged above the lift point, because a valve that reseats above where it lifts has no shut state at all.",
    {get:()=>reliefSet(fid).reseat,
     set:v=>{ j.reseat=Math.min(v, reliefSet(fid).lift-stp); }},
    lo,hi,v=>dp(v)+" MPa",stp);
  rdo("DEADBAND","How far pressure has to fall, once this valve has lifted, before it shuts again. A wide band lifts once and clears the transient; a narrow one cycles.",
    ()=>{ const r=reliefSet(fid); return dp(r.lift-r.reseat)+" MPa"; });
  /* Nothing showed this before, so a relief tank sited across the plant cost
     vent rate silently. It is a commissioned figure - it reads the routed
     branch pipe - so the bench shows the length that drives it instead. */
  /* WHERE THE DISCHARGE ACTUALLY GOES, asked of the drawing. A valve whose
     outlet reaches no tank is not broken - it vents into the room, which is a
     real design and the bench NAMES it rather than refusing it. */
  rdo("DISCHARGES TO","Where what this valve passes ends up. Pipe its outlet to a tank and the discharge is caught. Stand it against the skin and the discharge goes outside, which spares the compartment but is still a release. Leave it inboard and unpiped and it goes straight into the air the crew is breathing.",
    ()=>{ const t=P&&P.net&&P.net.fitTarget&&P.net.fitTarget[fid];
          if(t) return (D.tanks[t]&&D.tanks[t].name)||t.toUpperCase();
          return (P&&P.net&&P.net.fitVentOut&&P.net.fitVentOut[fid]) ? "ATMOSPHERE" : "THE ROOM"; });
  return B;
}

/* ══ THE TWO PLATES THAT BELONG TO THE WHOLE DESIGN ══
   RESULTS (what it adds up to) and REVIEW (what is wrong with it) point at no
   component - data only, built into HTML by design-bench.js. */
/* ══ AND WITH NO REACTOR THERE IS NOTHING TO ADD UP ══
   Every row here is a figure ABOUT a machine - power density, grace time,
   shutdown margin, peaking, the pipe run, the crew's dose - and the lattice is
   a DRAWING that exists whether or not a vessel stands on the arrangement
   grid. A blank ship read a full plate of a plant nobody had built. The mass
   line stays, because 0 t is the honest answer and the budget is still there
   to be spent against. */
function benchResultsData(){
  const d=derived(), core=!!roleOf("core"), M=PLANT_LM||layoutMetrics();
  const stats=(core?planStats(d).concat(layoutStats(M)):[]).concat(containStats());
  return {mass:d.mass,over:d.over,eq:(d.mass-layMass),ship:layMass,
    dens:core?d.dens:0, excess:core?d.excess:0,
    // the row's tip and what DRIVES it are one string by the time a row is drawn
    stats:stats.map(r=>[r[0],r[1],r[2],r[3],(r[4]||"")+statDrv(r[0],d,M)])};
}
/* ══ AND THE REGION A PLANT HAS APPEARS IN THE REVIEW ══
   Not gated on a reactor, unlike every row above: a containment is a fact
   about the drawing and it is a real answer on a ship with no vessel in it.
   Nothing here is gated on a count either - two enclosures is a legal plant. */
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

/* ══ A PAINTED CELL IS SELECTABLE, AND SO IS WHAT IT ENCLOSES ══
   A cell is not a part, so it is addressed by its CELL KEY - "mat:x,y", which
   carries a colon and a comma and so can collide with neither a part id nor a
   run key. The panel states the CELL's own figures and its REGION's, because
   standing on a wall is how you ask about the thing it encloses; the selection
   is never a region index, which is derived and renumbers the moment the paint
   changes. */
const isMatKey = k => typeof k==="string" && k.indexOf("mat:")===0
                   && !!matCell(+k.slice(4,k.indexOf(",")), +k.slice(k.indexOf(",")+1));
const matKeyXY = k => { const i=k.indexOf(","); return [+k.slice(4,i), +k.slice(i+1)]; };
function paramsForMat(key){
  const B=[], [x,y]=matKeyXY(key);
  if(!matCell(x,y)) return B;
  const s = (typeof S!=="undefined") ? S : null, live = !!(s && s.roomP);
  B.push({kind:"optlist",title:"MATERIAL",base:0,
    /* IT ALSO LOADS THE BRUSH. Picking a material here is the only place one
       is picked at all, so the next stroke lays what the player just chose -
       otherwise every cell would have to be painted and then converted. */
    key:{get:()=>MAT.findIndex(m=>m.id===matCell(x,y).m),
         set:i=>{ matCell(x,y).m=MAT[i].id; matPen=MAT[i].id; buildLayout(); }},
    tip:"What this cell is made of. Only a GAS-TIGHT material makes a closed shape a containment; the other two are shielding and nothing else.",
    items:MAT.map(m=>({name:m.name, tip:m.tip}))});
  /* APPLIED TO THE WHOLE REGION, not to the one cell: a wall with one thick
     cell in it is not a thicker wall. The suggestion is Barlow at this cell's
     own local span, which is what makes a long flat side ask for more steel
     than a corner does. */
  B.push({kind:"num",title:"THICKNESS",unit:"mm",dp:0,
    tip:"How thick the wall is. It is what the cell is RATED for and it is what the cell weighs. SUGGEST is Barlow against the FLAT SPAN this cell is in the middle of - so a long straight wall asks for a thick one and a corner asks for almost nothing.",
    key:{get:()=>matThick(x,y), set:v=>{ const g=matRegionAt(x,y);
      if(g) for(const i of g.wall) (D.mat[(i%GW)+","+((i/GW)|0)]||{}).t=v;
      else matCell(x,y).t=v;
      buildLayout(); }},
    suggest:()=>matThickSuggest(x,y),
    massFn:v=>v/1000*MPC*ROOM_DEPTH*matRow(matCell(x,y).m).rho/1000});
  B.push({kind:"readlist",rows:()=>{
    const g=matRegionAt(x,y);
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
    /* THE WEAKEST CELL IS THE SINGLE MOST USEFUL LINE ON THIS PANEL: it names
       the cell that will go, before it goes. */
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
        ["HELD BACK",((1-contRelAt(s,x,y))*100).toFixed(0)+" %",null,
         "How much of a release leaving inside this region stays inside it. It is the weakest material on this wall, not a menu row - and it is zero the moment the wall opens."]);
    }
    /* WHAT IS STANDING ON ITS FLOOR, and what that has reached. A break inside
       a containment does not vanish out of the book - it lands, it is a real
       depth and it drowns what it touches - so both are read off the same
       regionFlooded() the FLOODING layer draws from. */
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
      /* THE WHOLE BOUNDARY'S MASS, beside the one cell's above: a wall is
         bought by the ring and not by the cell the hand happens to be on. */
      ["WALL MASS",g.wall.reduce((a,i)=>a+matCellMass(i%GW,(i/GW)|0),0).toFixed(1)+" t",null,
       "What this whole boundary weighs, summed off the paint at its own thickness. A bigger enclosure has a longer flat span, a longer span needs a thicker wall, and this is where that is paid."]);
    return rows; }});
  return B;
}
