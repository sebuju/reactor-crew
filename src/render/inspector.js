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
function railPick(well,ids,name){
  if(!well.head) return well;
  well.head.classList.add("kit-rule-pick");
  well.head.addEventListener("click",()=>{ sel=ids[0]; });
  KIT.tip(well.head,name||"",
    "Click to select this component. It lights up on the plant, and a leader runs from it to this panel.");
  return well;
}

/* ══ A RAIL ONLY SYNCS THE PANELS YOU CAN SEE ══
   Both rails rebuild every panel's data table on every frame - readoutsFor() in
   the control room, paramsFor() on the bench - and a rail is a tall scroller,
   so most of those panels are past its bottom edge. An IntersectionObserver
   marks the ones actually on screen and the sync loops skip the rest. The
   margin makes a panel live before it scrolls in, so nothing is ever seen
   catching up.

   With no observer (headless) every panel counts as visible, because a gate
   that skips the work would skip the auditor's coverage of it with it. */
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
    out.push({key:row[0],val,bar,barKind,txt:null,col:null,lim:row[4]?row[4].lim:null});
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
    if(H.col!==col){ H.val.style.color=col; H.col=col; }
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
    const bar=KIT.seg({cells:20});
    const val=KIT.el("span","insp-stat-val"); val.textContent=st[1];
    el.append(lab,bar.el,val);
    bar.set(st[2],cssCol(st[3]));
    if(st[4]) KIT.tip(el,st[0],st[4]);
    container.appendChild(el);
    out.push({val,bar});
  }
  return out;
}
function statRowsSync(container,stats){
  const sig=stats.map(s=>s[0]).join("|");
  if(sig!==container._sig){ container.innerHTML=""; container._h=statRowsBuild(container,stats); container._sig=sig; }
  stats.forEach((st,i)=>{ const H=container._h[i]; if(!H) return;
    if(H.val.textContent!==st[1]) H.val.textContent=st[1];
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
  const rdo=(title,tip,val)=>B.push({kind:"readout",title,tip,val});
  const tog=(title,tip,key,mass)=>B.push({kind:"toggle",title,tip,key,mass});
  const note=(text,color)=>B.push({kind:"note",text,color});

  if(!p.access && p.grp!=="shield")
    note("NO ACCESS. This component is walled in on every side. No repair party could ever reach it, and the unit cannot be commissioned like this.","var(--c-red)");

  /* ONE PANEL FOR THE REACTOR AND ITS DRIVES. They were two, and each carried
     its OWN copy of the lattice plan - the same canvas twice, over one shared
     pen, so whichever panel synced last decided what a click on either plan
     did and the other panel's tools could never be selected at all. They are
     one machine to configure: the clusters go into the assemblies, and the
     drives are bolted to the head that carries them. So the rods FOLD into
     this panel (they are a gang, dbRailBuild()) and there is exactly one plan,
     with every pen on it. Two boxes on the plant, one panel - clicking either
     brings this up. */
  if(id==="core"){
    B.gang="reactor"; B.gangPlain=true;
    B.push({kind:"latplan"});
    B.push({kind:"lattools",tools:LATPEN_CORE.concat(LATPEN_RODS)});
    B.push({kind:"latdimrack"});
    opt("REACTOR TYPE","The coolant and moderator family. Sets power density, operating pressure, grace time and the sign of the void coefficient. It also decides how much heat a given lattice makes: the same assemblies rate differently in a different family.","arch",ARCH);
    opt("FUEL","Sets beta - your reaction time before prompt criticality - plus excess reactivity and core density.","fuel",FUEL);
    B.push({kind:"bulkrow",label:"LATTICE",items:LATPRE.map((pr,i)=>({name:pr[0],tip:pr[2],fn:()=>latPreset(i)}))});
    B.push({kind:"readlist",rows:()=>LATREAD.map(r=>[r[0],r[1](),null,r[2]])});
    B.push({kind:"rule",title:"ROD DRIVES",
      tip:"The control rod drive mechanisms, bolted to the vessel head. Everything below this line belongs to them, not to the fuel: what drives the clusters in, what they are made of, and how the banks are grouped. They ride on the head and move with the reactor, which is why they share this panel."});
    opt("SCRAM SYSTEM","How the rods are driven in during an emergency shutdown.","scram",SCRAM);
    opt("ABSORBER","What the clusters are made of. This used to be solved for, until a fully-inserted bank came to whatever CONTROL BANK WORTH was set to. Now you buy a material, put the clusters where you want them, and the worth is what the solve measures.","__abs",ABSORB);
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
    opt("ROD FOLLOWER","What occupies the channel below the absorber. It decides whether inserting the bank is monotonic: a graphite follower displaces water at the bottom of the core and adds reactivity there before any absorber arrives.","foll",FOLL);
    B.push({kind:"sdmnote"});
    B.push({kind:"bulkrow",label:"SPREAD",items:[1,2,3,4].map(n=>({name:String(n),
      tip:"Clear every cluster and lay "+n+" bank"+(n>1?"s":"")+" again, spread by area over the core the way the stock lattice does - so each bank covers about the same share of the fuel."+
        (n<2?" One bank has nothing to lean a flux tilt against, so tilt trim and SPLIT mode have no work to do."
            :" Fewer banks sit nearer the flux and so measure a little more worth; watch CONTROL BANK WORTH below say by how much."),
      fn:()=>{ latLayBanks(n); latRevolve(); }}))});
    B.push({kind:"readlist",rows:()=>LATREAD_RODS.map(r=>[r[0],r[1](),r[3]?r[3]():null,r[2]])});
  }
  /* No blocks of its own: every one of them is on the reactor panel above,
     and this marks the drives as the second member of that gang so clicking
     the drives on the plant brings the same panel up. */
  else if(id==="rods"){ B.gang="reactor"; B.gangPlain=true; }
  else if(id==="pzr"){
    sld("DESIGN PRESSURE","Loop pressure as a multiple of this coolant's nominal. Higher raises the boiling point, so it buys thermal margin and resists voiding, but the vessel gets much heavier and a breach more violent.","pdes",.7,1.25,v=>(v*ARCH[D.arch].P0).toFixed(1)+" MPa",.05,v=>(v-0.7)*220);
    sld("PRESSURIZER VOLUME","Size of the steam bubble. A big pressurizer damps pressure swings so the relief valve rarely lifts. A small one is light but pressure whips around on every load change.","pzr",.5,2,v=>v.toFixed(2)+" x",.05,v=>(v-0.5)*45);
    note("Pressure is what keeps the rest of the loop liquid. Every design choice here trades vessel mass against how much boiling margin you carry.");
  }
  else if(id.startsWith("sg")){
    seg_("COOLANT LOOPS","Parallel primary loops. More loops means losing one costs a smaller share of your flow, and each pipe is smaller so a break is less severe.","loops",["1","2","3","4"],1);
    opt("GENERATOR TYPE","U-tube units hold a lot of secondary water that keeps removing heat for minutes after feedwater is lost. Once-through units are light, respond instantly, and boil dry just as fast.","sg",SGT);
    /* MEASURED, not the label this used to carry: a placed tank and pump
       (layout.js) piped to the generator, but the flow itself is not solved
       until the secondary conserves water - so what this buys today is the
       stated dump term below, and NOTHING measurable on grace time (that is
       set by the coolant family and the generator type, off sgInertiaK(),
       not by this). Stock plant, scram, 600 s: on runs the loop a few
       degrees cooler than off, and P.graceK does not move for it. */
    note("Emergency feedwater is a TANK, not a fitting on this pump: add one, set it to the secondary side and give it the LOW SG LEVEL rule. Its arm switch lives on the tank.");
    note("Height matters more than anything else on this component. Sitting above the reactor, it drives natural circulation with no pumps at all.");
    B.gang="sg";
  }
  else if(roleHead(p.role)){
    const key={get:()=>pumpSizeOf(id),set:v=>{ D.pumpSize[id]=v; }};
    B.push({kind:"slider",title:"PUMP SIZE",key,min:0,max:1,step:.05,
      fmt:v=>(pumpCap(v)*100).toFixed(0)+" % capacity",massFn:v=>pumpCap(v)*PUMP_MASS,
      tip:"How much this pump can carry on its own. Bigger costs more mass, but it is also what a junction actually shares with a neighbouring loop if you tie the two together - a pump running at its own rated point has nothing spare to lend."});
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
    sld("TURBINE SIZE","How many stages the machine has. A big turbine turns more of the heat into electricity and can swallow a bigger overload, but it is heavy. The percentage is what this reactor's steam conditions plus this machine actually deliver together, so changing the reactor makes the same slider read differently.","turb",0,1,v=>(ARCH[D.arch].eff*(0.92+0.16*v)*100).toFixed(1)+" % gross",.05,v=>v*50);
    B.push({kind:"readlist",rows:()=>{ const d=derived(); return [
      ["RATED OUTPUT",(D.power*d.eff).toFixed(0)+" MWe",null,"Electrical power at 100% reactor power with the condenser keeping up. This is the number the ship gets, and it is the whole reason the reactor is here."],
      ["MAX LOAD",(d.loadMax*100).toFixed(0)+" %",null,"The furthest the load slider will go in the control room. Overpower is not free reach: it is turbine you paid mass for."]]; }});
    note("In the full game this is where weapons and ship systems draw from. A hit here rejects load instantly and the reactor has nowhere to put its heat. Right-click the plant to remove it - no turbine, no electricity.");
  }
  else if(p.role==="cond"){
    sld("CONDENSER SIZE","The heat sink, and it sets two things at once. It caps how much steam can be dumped straight past a tripped turbine, so a generous unit absorbs a scram without the relief valve ever lifting. It also sets how much steam you can condense at full draw: overload a small condenser and backpressure eats your electrical output while the reactor goes on making the heat.","condCap",0,1,v=>(20+60*v).toFixed(0)+" % dump",.05,v=>v*40);
    B.push({kind:"readlist",rows:()=>{ const d=derived(); return [
      ["CONDENSING CAPACITY",(d.condCap*100).toFixed(0)+" % of rated",null,"How much steam this unit turns back into water. Draw more than this and exhaust pressure climbs, which costs the turbine work. Match it to the turbine's max load or accept the loss."],
      ["TURBINE CAN DRAW",(d.loadMax*100).toFixed(0)+" %",null,"The turbine's own ceiling, shown here so the mismatch is visible from either component."]]; }});
    B.push({kind:"note",dyn:()=>{ const d=derived();
      return {text:(d.condShort
        ?"This condenser is far smaller than the turbine can overload to. Sustained overpower will hand a large part of itself straight back as backpressure."
        :"Condenser is matched to the turbine. A brief overload costs little or nothing.")
        +" Right-click the plant to remove it - the turbine has nowhere to exhaust to without one.",
        color:d.condShort?"var(--c-amber)":null}; }});
  }
  else if(id==="ctrl"){
    opt("INSTRUMENT CHANNELS","How many independent sensors watch each parameter. This decides whether you can tell a broken gauge from a real emergency.","chan",CHAN);
    tog("REACTOR PROTECTION SYSTEM","The automatic trips. Fitted, it scrams the core on high flux, low DNBR, high or low pressure, high fuel temperature, low flow, core void or low subcooling. Leave it off and none of that happens: the reactor will run itself to destruction and wait for you to notice.","rps",55);
    B.push({kind:"slider",title:"RPS TRIP MARGIN",key:"rpsm",min:0,max:1,step:.05,
      fmt:v=>(v*100).toFixed(0)+" % permissive",when:()=>D.rps,
      tip:"How much overhead the automatic protection allows before it scrams. Conservative trips at 110% flux and 1.18 DNBR, so the plant is hard to damage and you can never push it. Permissive lets you reach 132% and 1.02 DNBR, which is real combat performance and a much smaller margin for error."});
    note("Crew dose during an accident falls with distance from the reactor and drops sharply for every shield block between the two. Move this room and watch the dose figure in RESULTS.");
  }
  else if(id==="cont"){
    opt("CONTAINMENT","What holds the radioactivity in when fuel fails. Sets how much of a release reaches your crew.","cont",CONT);
    tog("CORE CATCHER","A cooled basin under the vessel. It will not save the fuel, but it stops a melted core burning through and breaching the vessel, which keeps the release contained.","catcher",PART_MASS.catcher);
    note("Containment does nothing for the reactor and everything for the people around it. It is pure insurance, and it is heavy. Right-click the plant to fit or remove it without opening this list.");
  }
  /* ══ ONE PANEL, EVERY TANK ══
     There is no menu of kinds anywhere in this game, and this is why: an
     accumulator, a boron tank, a relief tank and a hotwell are these eight
     knobs at four settings. Every one of them writes D.tanks[id] through the
     normal design path, so designSig() sees it and the plant re-commissions.
     FLUID_IDS/AUTO_IDS are read off the tables themselves, so adding a
     substance or an opening rule adds an entry here for free. */
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
    B.push({kind:"readlist",rows:()=>{ const sd=tankSide(id);
      return [["PLUMBED TO", sd? sd.toUpperCase() : "NOTHING", sd?null:C.amber,
        sd==="primary" ? "This tank has a node in the pressure solve and one edge into the loop, so what it delivers is fought for against loop pressure."
        : sd==="secondary" ? "This tank is on the far side of the generator tubes: it answers to the generator's own secondary pressure, not to the loop's."
        : "Nothing is piped to this tank, so it is on no side at all - it has no edge, it can deliver nothing, and it is counted by nothing. Draw a run from it."]]; }});
    sld("CAPACITY","How big it is, as a share of whichever side you piped it into. It costs mass in proportion, and it is what turns a solved flow into a level.",
      acc("vol"),5,100,v=>v.toFixed(0)+" %",5,v=>v*0.4);
    sld("FILL AT COMMISSIONING","How full it starts. A source ships full; a tank meant to catch something ships empty, and its gas charge is set at whatever level you leave here.",
      acc("level"),0,100,v=>v.toFixed(0)+" %",5);
    B.push({kind:"toggle",title:"PRESSURISED BY PUMPS",mass:12,
      key:{get:()=>!!t().pump, set:v=>{ t().pump = v?{p:11.0,bus:"bkp"}:null; }},
      tip:"A set of pumps holds a steady pressure until the tank is dry - and dies with the bus, so a blackout kills it. Off, the tank is passive: whatever gas charge you give it below is all it has, which is exactly why a passive tank is the one injection path a blackout does not kill."});
    B.push({kind:"toggle",title:"GAS CHARGE",mass:8,
      key:{get:()=>!!t().gas, set:v=>{ t().gas = v?{p0:4.5,frac:0.35}:null; }},
      tip:"A cover gas above the liquid. It is what makes the pressure mean anything: a vented tank never pressurises, so it can have no back-pressure and no rupture disc. It expands as a source empties and is compressed as a sink fills."});
    sld("CHARGE PRESSURE","What the gas holds at the commissioning level. It falls as a source drains and rises as a sink fills - that taper is the whole difference between an accumulator and a pump.",
      {get:()=>t().gas?t().gas.p0:0, set:v=>{ if(t().gas) t().gas.p0=v; }},
      0.05,15,v=>v.toFixed(2)+" MPa",0.05);
    B.push({kind:"toggle",title:"CHECK VALVE",mass:4,
      key:acc("check"),
      tip:"A non-return valve on the tank's own line. With one, the tank can only ever push OUT - which is what makes it a source. Without one it fills as readily as it drains, which is what makes it a sink."});
    B.push({kind:"toggle",title:"RUPTURE DISC",mass:2,
      key:{get:()=>!!t().burst, set:v=>{ t().burst = v?{at:1.4,drain:6.0,rel:0.004}:null; }},
      tip:"A disc that lets go once the tank is full enough to push its gas past the setpoint. Past that the tank is an opening to containment and what was in it is on the floor. This is the TMI-2 sequence, and it does not reseat."});
    B.push({kind:"optlist",title:"OPENS ITSELF ON",key:{get:()=>AUTO_IDS.indexOf(t().auto),
        set:i=>{ t().auto=AUTO_IDS[i]; }},base:0,
      tip:"When this tank lines itself up without being asked. The operator's own valve is always there beside it - this only ever OPENS, it never overrides a switch.",
      items:AUTO_IDS.map(a=>({name:AUTORULE[a].label,tip:""}))});
  }
  else if(id==="bkp"){
    opt("BACKUP POWER","What keeps the coolant pumps turning when main power is lost. Test it with the Station Blackout fault in the control room.","bkp",BKP);
    note("With no backup, a blackout leaves you nothing but natural circulation - which is set by how high you put the steam generators and how tall you made the core.");
  }
  else {
    note(p.tip);
    B.push({kind:"note",text:"NO ADJUSTABLE PARAMETERS"});
    B.plain = p.access || p.grp==="shield";
  }
  return B;
}

/* ══ WHAT A FITTING LETS YOU SET ══
   paramsFor()'s sibling, same block kinds, same consumer - a fitting is not in
   LAY.parts, which is the only reason it had nowhere to put a control. Only a
   relief valve has anything to adjust: its lift and reseat pressures are
   MECHANICAL, chosen when it is built, so they live in D.fit beside the tap and
   never on S. The arming switch is the opposite - it is worked during a
   transient - and lives on the valve's own canvas strip (fitStrip(), plant.js).
   A tee and a throttle have no design-time setting at all; their whole
   behaviour is the position the operator gives them. */
function paramsForFit(fid){
  const B=[], j=D.fit[fid]; if(!j) return B;
  const P0=ARCH[D.arch].P0*D.pdes;
  const sld=(title,tip,key,min,max,fmt,step)=>B.push({kind:"slider",title,tip,key,min,max,fmt,step});
  const rdo=(title,tip,val)=>B.push({kind:"readout",title,tip,val});
  if(j.mode!=="relief"){
    B.push({kind:"note",text:"NO ADJUSTABLE PARAMETERS. This fitting is worked from the plant view."});
    B.plain=true;
    return B;
  }
  sld("LIFT PRESSURE",
    "The pressure this valve opens itself at, as a multiple of the loop's design pressure. Low and it lifts on every transient and spends its stick chances early; high and pressure climbs further before anything vents, toward a vessel that bursts at about 122%.",
    {get:()=>reliefSet(fid).lift,
     // the deadband is dragged down with the lift point, or a valve dialled
     // low would end up reseating above its own lift and chatter every tick
     set:v=>{ j.lift=v; if(reliefSet(fid).reseat > v-0.01) j.reseat=+(v-0.01).toFixed(2); }},
    1.02,1.20,v=>(v*P0).toFixed(2)+" MPa",.01);
  sld("RESEAT PRESSURE",
    "The pressure it shuts again at. The gap up to the lift point is the deadband, and it is what stops the valve chattering on its own setpoint - it cannot be dragged above the lift point, because a valve that reseats above where it lifts has no shut state at all.",
    {get:()=>reliefSet(fid).reseat,
     set:v=>{ j.reseat=Math.min(v, +(reliefSet(fid).lift-0.01).toFixed(2)); }},
    1.00,1.19,v=>(v*P0).toFixed(2)+" MPa",.01);
  rdo("DEADBAND","How far pressure has to fall, once this valve has lifted, before it shuts again. A wide band lifts once and clears the transient; a narrow one cycles.",
    ()=>{ const r=reliefSet(fid); return ((r.lift-r.reseat)*P0).toFixed(2)+" MPa"; });
  /* Nothing showed this before, so a relief tank sited across the plant cost
     vent rate silently. It is a commissioned figure - it reads the routed
     branch pipe - so the bench shows the length that drives it instead. */
  rdo("BRANCH LENGTH","How far this valve has to vent to reach the relief tank. A short, fat run vents faster; a long one is a relief path that cannot keep up with the transient it was fitted for.",
    ()=>{ const r=(pipeNetwork()||[]).find(q=>q.key==="xtie:"+fid);
          return r? plen(r.pts).toFixed(1)+" m" : "unrouted"; });
  return B;
}

/* ══ THE TWO PLATES THAT BELONG TO THE WHOLE DESIGN ══
   RESULTS (what it adds up to) and REVIEW (what is wrong with it) point at no
   component - data only, built into HTML by design-bench.js. */
function benchResultsData(){
  const d=derived();
  return {mass:d.mass,over:d.over,eq:(d.mass-layMass),ship:layMass,dens:d.dens,excess:d.excess,
    stats:planStats(d).concat(layoutStats(PLANT_LM||layoutMetrics()))};
}
function benchReviewData(){
  const d=derived(), LM=PLANT_LM||layoutMetrics();
  return {issues:designIssues(d,LM),hard:designBlocked(d,LM)};
}
