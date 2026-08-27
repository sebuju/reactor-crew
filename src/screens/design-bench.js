"use strict";
/* the design screen - the plant view (canvas) plus an HTML rail of panels */

/* ONE ACCESSOR FOR EVERY PARAM BLOCK. A block's `key` is either a field name
   on D or an explicit {get,set} pair - the latter for anything that does not
   live at the top level of D, a tank's own config (D.tanks[id]) above all.
   The slider already understood both; every other kind read D[key] directly,
   which is how a tank panel would have had to invent a second mechanism. */
const blockAcc = key => typeof key==="string"
  ? {get:()=>D[key], set:v=>{ D[key]=v; }} : key;
/* What the plant would weigh with this block set to that value. It has to
   WRITE the value to ask, so it puts it back - through the same accessor, so
   a nested key is restored as exactly as a flat one. */
function massWith(key,i){ const a=blockAcc(key), o=a.get(); a.set(i);
  const m=derived().mass; a.set(o); return m; }

/* Nameplate pump capacity vs what a loop's own ceiling will ever pass right
   now - netFlowK()'s per-group min(groupSize,up) clamp (pipenet.js), read
   here as-commissioned: every cross-tie starts shut (resetPlant()), so each
   loop is its own singleton group and the clamp is just min(1,up) per loop.
   totalPumpCap() is damage-blind by construction (LAY.parts carries no
   damage), so it is exactly "what you built"; the per-loop sum is exactly
   "what a healthy loop's ceiling lets through", with dmg (default none - the
   bench has no damage) taking the pumps a live caller lost out of it. One
   function for both readouts, so a spare pump cannot be explained one way on
   the bench and a different way on the pump panel.
   Approximate for a MULTI-loop plant with unequal loop lengths: this treats
   every loop's ceiling as worth the same 1.0, where netFlowK() weights each
   loop by its own P.netRefByLoop. Exact for the single-loop stock case. */
function pumpGauge(dmg){
  dmg = dmg || [];
  const {n} = loopMap();
  let delivered = 0;
  for(let i=0;i<n;i++) delivered += Math.min(1, loopPumpCap(i, dmg));
  return {installed: totalPumpCap(), delivered, n};
}

function planStats(d){ return [
  ["POWER DENSITY",d.dens.toFixed(0)+" kW/L",clamp(d.dens/320,0,1),C.cyan,
   "Power per litre of core. Higher means a smaller, lighter reactor, and less material to soak up heat when cooling fails."],
  ["GRACE TIME",d.grace.toFixed(0)+" s",clamp(d.grace/900,0,1),C.green,
   "How long the core survives a total loss of cooling before fuel fails. The number that decides whether a repair under fire is possible at all."],
  ["DELAYED NEUTRONS",d.beta+" pcm",clamp(d.beta/700,0,1),d.beta<400?C.red:C.green,
   "Beta: the share of neutrons arriving seconds late instead of instantly. It is the entire margin a human has to react in."],
  ["SHUTDOWN MARGIN",d.sdm.toFixed(0)+" pcm",clamp(d.sdm/2000,0,1),d.sdm<200?C.red:C.green,
   "How firmly the BANK ALONE holds the core down once it cools and the xenon decays. It is usually negative, and that is not a fault: the plant is commissioned critical with equilibrium xenon in it, so when that xenon decays after a trip its whole worth comes back as positive reactivity, and the fuel cooling hands back Doppler on top. Rods do not win that argument on a real plant either - boron does. Borate after every scram. The bench blocks a design only when full boration cannot hold it either."],
  ["THERMAL MARGIN",d.dnbr.toFixed(2)+" DNBR",clamp((d.dnbr-1)/2.5,0,1),d.dnbr<1.4?C.amber:C.green,
   "DNBR, the Departure from Nucleate Boiling Ratio: how far the fuel is from the point where cooling bubbles join into one insulating steam film. Sets your real overload ceiling, not the power rating."],
  ["VOID COEFFICIENT",(d.aV>0?"+":"")+d.aV.toFixed(0)+" pcm",clamp(Math.abs(d.aV)/1600,0,1),d.aV>0?C.red:C.blue,
   "What happens when steam forms in the core. Negative shuts the reactor down as it boils. Positive means boiling adds power, which adds boiling."],
  ["MODERATOR COEFF",d.aM.toFixed(0)+" pcm/K",clamp(Math.abs(d.aM)/70,0,1),d.aM>0?C.red:C.blue,
   "Feedback from coolant temperature, set by your lattice pitch. Strongly negative makes the plant follow turbine load by itself."],
  ["PEAKING FACTOR",d.Fq.toFixed(2)+" Fq",1-clamp((d.Fq-1.8)/1.2,0,1),d.Fq>2.6?C.amber:C.green,
   "How lopsided power is across the core. The hottest pin sets the limit for the whole reactor, so a flat core can run harder."],
  ["XENON PIT DEPTH",d.xeW.toFixed(0)+" pcm",clamp(d.xeW/2700,0,1),d.xeW<800?C.green:C.amber,
   "How badly xenon locks you out after a shutdown. At 2700 pcm a scram costs roughly three minutes dead in the water."],
  ["SCRAM TRAVEL",(1/d.scram).toFixed(1)+" s",clamp(d.scram/2.5,0,1),C.green,
   "How long a full emergency rod insertion takes. In a fast transient, two seconds versus half a second is the whole game."],
  ["OPERATING PRESS",d.P0.toFixed(1)+" MPa",clamp(d.P0/18,0,1),d.P0>12?C.amber:C.green,
   "Loop pressure. Buys thermal margin and demands a heavy vessel that fails violently."],
  ["EXCESS REACTIVITY",d.excess.toFixed(0)+" pcm",clamp(d.excess/8000,0,1),C.cyan,
   "Reactivity built into the fresh core that must be held down at all times by rods, boron and burnable poison."],
  ["NEUTRON LEAKAGE",d.leak.toFixed(0)+" pcm",clamp(d.leak/900,0,1),d.leak>500?C.amber:C.cyan,
   "Reactivity thrown away through the core surface, driven by how far your height-to-diameter ratio is from a squat cylinder."],
  ["CONTAINMENT",((1-CONT[D.cont].rel)*100).toFixed(0)+" % held",1-CONT[D.cont].rel,
   CONT[D.cont].rel>.5?C.red:C.green,
   "Fraction of a radiological release that stays inside the plant instead of reaching your crew."],
  ["INSTRUMENT TRUST",((1-CHAN[D.chan].noise)*100).toFixed(0)+" %",1-CHAN[D.chan].noise,
   CHAN[D.chan].noise>.6?C.amber:C.green,
   "How much you can believe your own gauges. Single-channel readings visibly jitter and a failed sensor is undetectable."],
];}
function layoutStats(M){
 const G=pumpGauge();
 return [
  ["THERMOSIPHON HEAD",M.head.toFixed(1)+" cells",clamp((M.head+1)/4,0,1),M.head<0.5?C.amber:C.green,
   "How far the steam generators sit above the reactor. Hot water rises into them and cold water falls back with no pumps at all. Raise the generators and a blackout stops being fatal."],
  ["PRIMARY PIPE RUN",M.pipe.toFixed(1)+" m",clamp(M.pipe/60,0,1),M.pipe>40?C.amber:C.green,
   "Total hot and cold leg length. Long runs add friction so your pumps deliver less flow, and give more pipe for a hit to find. They also add coolant mass, which is thermal inertia in your favour."],
  ["FLOW PENALTY",((1-M.flowK)*100).toFixed(0)+" %",1-M.flowK,(1-M.flowK)>.2?C.amber:C.green,
   "Pumping loss from pipe friction. A short straight run from reactor to steam generator costs nothing; a sprawling layout quietly caps the flow you can ever achieve."],
  ["PUMP CAPACITY",G.delivered.toFixed(1)+" / "+G.installed.toFixed(1)+" pumps",
   G.installed>0?clamp(G.delivered/G.installed,0,1):1,
   G.delivered<G.installed-1e-9?C.amber:C.green,
   "What a spare pump actually buys, right now. A loop's ceiling only ever passes one healthy pump's worth, however many more you plumb into it - so DELIVERED sits under INSTALLED the moment a spare is connected, and that is the ceiling doing its job, not a wasted pump. It does nothing to this number until the day a pump on that loop is damaged or destroyed, when it is what brings DELIVERED straight back instead of leaving the loop starved."],
  ["COOLANT INERTIA",((M.inertiaK-1)*100).toFixed(0)+" % grace",clamp((M.inertiaK-1)*3,0,1),C.cyan,
   "Extra water in long pipe runs takes longer to heat, so transients develop more slowly and you get more time to react. The one genuine reward for a spread-out layout."],
  ["HULL EXPOSURE",(M.exposure*100).toFixed(0)+" %",M.exposure,M.exposure>.2?C.red:C.green,
   "Share of equipment sitting in the outer ring, where incoming fire lands. Anything out there is a candidate the next time you take a hit."],
  ["REPAIR ACCESS",(M.access*100).toFixed(0)+" %",M.access,M.access<1?C.red:C.green,
   "Fraction of equipment with at least one free adjacent cell. A component walled in on all four sides cannot be repaired at all, however badly you need it."],
  ["CREW DOSE RATE",M.dose.toFixed(2)+" x",clamp(M.dose/2,0,1),M.dose>1?C.amber:C.green,
   "Radiation reaching the control room during an accident, solved along the straight line from reactor to crew. A shield only pays for itself if it actually stands on that line - one parked off to the side blocks nothing, whatever a bounding box would have said. Any other equipment sitting on the line helps a little too, just less than a shield built for the job."],
  ["SURVEY PEAK",M.peak.v.toFixed(2)+" x",clamp(M.peak.v/RAD_CEIL,0,1),ZONE[zoneOf(M.peak.v)].col,
   "The crew dose rate above is one seat, in one room. This is the hottest cell any repair party could ever be sent to stand in"+(M.peak.who?" - right now, beside "+partName(M.peak.who):"")+". A layout that is comfortable in the control room and lethal at the pumps has not been shielded, it has been decorated."],
  ["PRESSURIZER LINK",M.pzrConn?"plumbed":"NOT PLUMBED",M.pzrConn?1:0,
   M.pzrConn?C.green:C.red,
   "Whether any pipe reaches the pressurizer from the loop at all. A vessel nobody plumbed in holds nothing: pressure follows whatever the loop is doing instead of the programme, and it will not come back. The bench will still let you build it - it just will not pretend it works."],
  ["PRESSURIZER HEAD",M.pzrOK?"at loop top":"BELOW LOOP TOP",M.pzrOK?1:0.2,
   M.pzrOK?C.green:C.red,
   "The pressurizer works by holding a steam bubble at the highest point of the primary loop. Mount it below the reactor or the steam generators and the bubble cannot sit where it needs to: pressure control loses more than half its damping and every load change whips the loop pressure around."],
  ["INJECTION HEAD",M.injZ.toFixed(1)+" m",clamp((M.injZ+2)/8,0,1),
   M.injZ<1?C.amber:C.green,
   "Emergency injection is gravity fed. A tank mounted high above the reactor drains in fast with no power at all; one level with or below the core barely trickles. This is the WORST of the tanks that could inject - each tank's own head is on its own panel."],
  ["LOOP SEPARATION",sgCount()>1?M.sep.toFixed(0)+" cells":"n/a",sgCount()>1?clamp(M.sep/8,0,1):1,
   sgCount()>1&&M.sep<4?C.amber:C.green,
   "Distance between redundant loops. Park two steam generators next to each other and a single hit takes out both, making the redundancy you paid for worthless."],
];}
function layoutWarnings(M){ const w=[];
  /* SOFT, deliberately. The game never refuses a bad order - it carries it
     out and shows the cost - so an unplumbed pressurizer commissions, runs
     and loses its pressure, and that is the lesson. What it must not do is
     happen SILENTLY, which is what it did until this row existed. */
  if(!M.pzrConn) w.push(["SOFT","No pipe reaches the pressurizer. It holds nothing: loop pressure will drift off programme and stay there.","pzr"]);
  if(!M.pzrOK) w.push(["SOFT","The pressurizer is not the highest point of the primary loop. Its steam bubble cannot form properly, so pressure damping drops to 45%.","pzr"]);
  if(M.head<0) w.push(["SOFT","Steam generators sit BELOW the reactor. Natural circulation runs backwards - there is no passive cooling at all.",null]);
  /* A HYDRAULIC SHORT BETWEEN THE TWO SIDES, named and not refused. The tubes
     are the only crossing a plant is meant to have; a pipe drawn round them
     puts primary water into a generator's shell and secondary water into the
     loop, and the solve prices it honestly because every run is an edge. This
     could not be reached while the secondary carried no flow. */
  /* NOT COUNTED. One pipe drawn round the tubes puts several runs on the same
     side of the short - the feed line into that generator is then carrying
     primary water too - so a count would report more pipes than the designer
     drew. The fault is that the two sides are joined at all. */
  if(crossTies().length) w.push(["SOFT","The primary side is piped into a generator's shell, going round its tubes. Whatever is in one side will end up in the other: primary water into the steam, and steam pressure into the loop.",null]);
  if(M.access<1) w.push(["HARD","Some equipment is walled in with no adjacent free cell. It could never be repaired once damaged.",null]);
  if(M.exposure>0.3) w.push(["SOFT","Over 30% of the plant sits in hull cells. Expect to lose something every time you are hit.",null]);
  if(sgCount()>1&&M.sep<3) w.push(["SOFT","Redundant loops are adjacent. One hit will take out both.",null]);
  return w;
}

function designIssues(d,M){ return (d||derived()).warn.concat(layoutWarnings(M||layoutMetrics())); }
function designBlocked(d,M){ return designIssues(d,M).some(w=>w[0]==="HARD"); }
function warnFor(id){
  const p=LAY.parts.find(q=>q.id===id);
  if(p && !p.access && p.grp!=="shield") return C.red;
  const w=designIssues(null,PLANT_LM).filter(q=>q[2]===id);
  if(!w.length) return null;
  return w.some(q=>q[0]==="HARD")?C.red:C.amber;
}

/* right-click, held still and released: add or remove - see .claude/CLAUDE.md */
function ctxResolveDesign(p,extra){
  /* A TAP DRAG THAT LANDED. Both ends are already places the player pointed
     at, so this menu is not about the pixel under the cursor at all - it asks
     the one thing the gesture cannot: which fitting these two taps are. Ahead
     of the view test for that reason: the pair is settled whatever the release
     point resolves to, and it is the release point that opened this menu. */
  if(extra && extra.tapPair) return {x:p.x,y:p.y,tapPair:extra.tapPair};
  const pt=vIn(p)?vPt(p):null;
  if(!pt) return null;
  const gx=Math.floor((pt.x-GX)/CELL), gy=rowAt(pt.y);
  const part=partAt([pt.x,pt.y]);   // layout.js - the same lookup the port drag's drop test uses
  const net=pipeNetwork();
  let fitting=null;
  for(const fid in D.fit){ const j=D.fit[fid];
    const jp=juncPt(net,j.aKey,j.aT);
    if(jp && Math.hypot(jp.pt[0]-pt.x,jp.pt[1]-pt.y)<10){ fitting=fid; break; } }
  let tapKey=null, tapT=null, runRid=null, tapK=null;
  // Stage 1 makes every run an edge, tappable, hittable and able to spill -
  // the surge line included, so it is no longer excluded here. What is kept
  // is a UI decision, not a physics one: tapping a fitting's own branch
  // (xtie:*) is not a plant a right-click should offer to build, because the
  // result would be a tee spliced onto a tee rather than onto a real run.
  if(!part && !fitting) for(const r of net){
    if(!r.key || r.k.startsWith("xtie")) continue; // LABEL: a UI choice (no tee-on-a-tee), not a network permission
    const near=nearestOn(r.pts,[pt.x,pt.y]);
    // tapK: the run's kind, kept ONLY as a label for the context menu's
    // header (Stage 7a) - never read to decide what the run may do.
    if(near.d<8){ tapKey=r.key; tapT=near.t; runRid=r.rid||null; tapK=r.k; break; }
  }
  return {x:p.x,y:p.y,cell:{gx,gy},part,fitting,tapKey,tapT,tapK,runRid};
}
// Stage 7a: the menu header names the thing it is ABOUT - a part, a run, a
// fitting, or the plant itself for a bare cell. Never a menu item, so it
// carries no fn and cannot be clicked - see drawCtxMenu() (core/ui.js).
function ctxTitleDesign(hit){
  if(hit.fitting) return FITNAME[D.fit[hit.fitting].mode]+" "+hit.fitting.toUpperCase();
  if(hit.part) return partName(hit.part);
  if(hit.tapKey!=null) return pipeLabel(hit.tapK)||"PIPE";
  return "PLANT";
}
/* WHICH RUN THE PLAYER JUST POINTED AT, and where along it. This is a
   RESOLVER, not a picker: the point is one the player aimed, and the only
   question is which polyline it landed on. That is the whole difference from
   nearestRunOfLoop(), which this replaces - that one took a point the player
   chose for the NEAR end and searched a whole loop for a far end nobody had
   pointed at.
   `skip` keeps a tee off its own host run: a tee spliced onto the run it
   already taps is a tee on itself, not a cross-tie. Untargeted clicks return
   null, which the caller treats as a cancel - there is nothing to refuse. */
function nearestRunTo(pt,skip){
  let best=null, bd=1e9;
  for(const r of pipeNetwork()){
    if(!r.key || r.key===skip || r.k.startsWith("xtie")) continue;
    const near=nearestOn(r.pts,pt);
    // rid as well as key: a TAP run stores the D.run id it lands on (plus its
    // kind as the fallback), so a caller authoring one needs both.
    if(near.d<bd){ bd=near.d; best={key:r.key,t:near.t,rid:r.rid||null}; }
  }
  /* The reach the PORT drag's own drop test uses (CELL*0.85, portDrop() in
     layout.js), for the same reason and to the same feel: a drop is aimed
     with a mouse, not with a caret. 12 plant units was the first guess and it
     is about 1.9 SCREEN pixels at fit zoom - a target nobody can hit, which
     is most of why the tap handle read as missing entirely. */
  return bd<=CELL*0.85 ? best : null;     // aimed at a pipe, not at empty deck
}
/* Stage 7a: a REMOVE offer belongs to the thing under the cursor. hit.part
   decides - a click on a component offers REMOVE, one item, about that
   part; a click on nothing offers no removal at all. The old shape built a
   fixed FIT/REMOVE prefix before it ever looked at hit, so right-clicking
   dead space offered to remove equipment that was nowhere near the cursor.
   fittableList()'s FIT side survives on the bare-cell fallback below - a
   part that is not yet fitted has no box on the grid to click. */
function ctxItemsDesign(hit){
  /* WHICH FITTING, and nothing else - both taps are settled. Every row here
     builds the identical geometry and differs only in `mode`, which is what
     makes this a type question rather than a placement one. A branch throttle
     is on the list because it is the same two taps too, and until now it could
     not be authored at all: the in-line offer passes a null far end. */
  if(hit.tapPair){ const t=hit.tapPair;
    return [
      {label:"TEE",             fn:()=>{ addFit('tee',t.aKey,t.aT,t.bKey,t.bT); }},
      {label:"RELIEF VALVE",    fn:()=>{ addFit('relief',t.aKey,t.aT,t.bKey,t.bT,PIPE_BORE.relief); }},
      {label:"THROTTLE, BRANCH",fn:()=>{ addFit('throttle',t.aKey,t.aT,t.bKey,t.bT); }},
    ];
  }
  if(hit.fitting)
    return [{label:"REMOVE", fn:()=>{ removeFit(hit.fitting); }}];
  if(hit.part){
    // a FITTABLE slot's part exists on the grid only while it IS fitted
    // (cont/turb/cond), so clicking it can only ever mean REMOVE.
    const f=fittableList().find(x=>x.id===hit.part.id);
    if(f) return f.get()
      ? [{label:"REMOVE", fn:()=>{ f.set(false); }}]
      : [{label:"ADD "+f.label, fn:()=>{ f.set(true); }}];
    // Every tank is an instance the player added, so every tank can be taken
    // away again - including the three the stock plant ships with. Zero tanks
    // is a legal plant.
    if(hit.part.role==="tank" || hit.part.id.startsWith("pumpX") || hit.part.id.startsWith("sgX"))
      return [{label:"REMOVE", fn:()=>{ removePart(hit.part.id); }}];
    return [];   // a base component (core, rods, pzr...) offers no menu at all
  }
  if(hit.tapKey!=null){
    // a run under the cursor: disconnect it outright, or splice something
    // onto it - a pipe, not a component, so "exactly one" does not apply
    // here (Stage 7a is only about REMOVE).
    const items=[];
    if(hit.runRid) items.push({label:"DISCONNECT", fn:()=>{ removeRun(hit.runRid); }});
    // a throttle needs nothing beyond the one tap it sits on - it can splice
    // straight into the run it's on, so it is always on offer here, even on
    // a single-loop plant with no second run to tie to
    items.push({label:"ADD THROTTLE HERE", fn:()=>{ addFit('throttle',hit.tapKey,hit.tapT,null,null); }});
    /* NO RELIEF VALVE OFFER HERE, and no tee. Both need a SECOND tap, and this
       menu knew only the one under the cursor - so it picked the far end
       itself: reliefHeaderKey() found the first run of kind "relief" on the
       plant and dropped the discharge at exactly t=0.5 along it, a point
       nobody chose. Drag a tap onto the pipe you mean instead
       (pipeTapHandles(), plant.js) and the menu that opens on the drop asks
       only WHICH fitting it is. Nothing about the old behaviour is lost:
       fitBKey() still re-resolves a relief valve's far tap every frame, and a
       valve whose discharge reaches no tank still vents into the room. */
    /* NO TEE AND NO SURGE-LINE OFFER HERE EITHER, for the same reason there is
       no CONNECT offer: both are DRAWN now. A tee is pulled out of the square
       riding the pipe under the pointer and dropped on the pipe you mean; a
       surge line is a PORT drag - out of the pressurizer's own nozzle - let go
       over the pipe you want it to tap. The menu row this replaces still chose
       which run of the right kind to land on and left the fraction along it to
       the router, so half the geometry was authored by nobody. */
    return items;
  }
  // a genuinely bare cell: nothing is under the cursor, so no REMOVE
  // belongs here - only offers that create or connect something.
  const items=fittableList().filter(f=>!f.get()).map(f=>({label:"ADD "+f.label, fn:()=>{ f.set(true); }}));
  if(hit.cell){
    const {gx,gy}=hit.cell;
    if(gx>=0 && gy>=0 && gx<GW && gy<GH){
      /* ONE ENTRY, no submenu of kinds. It places the single default tank
         config (TANK_DEFAULT, pipenet.js); what goes in it, what is behind it
         and how it is plumbed are set afterwards on its own panel. Not gated
         on a count - four tanks is a legal plant. */
      items.push({label:"ADD TANK HERE", fn:()=>{ addTank(gx,gy); }});
      items.push({label:"ADD SPARE PUMP HERE", fn:()=>{
        placePart(n=>({id:"pumpX"+n,name:"RCP SPARE",w:1,h:1,x:gx,y:gy,col:"#57d38c",
          grp:"pump",tip:"A spare coolant pump, placed where you put it. Right-click a free port to CONNECT it - unplumbed, it does nothing at all.",
          role:"pump"}));
      }});
      /* Stage 3b: no D.loops++ - that used to conjure a generator, a pump
         and four routed runs in one act. This adds exactly the ONE part it
         names, the same standing ADD SPARE PUMP HERE already has; it pays
         its own SGT[D.sg].mass (derived(), design.js) the moment it exists,
         and does nothing at all until wired up through CONNECT. */
      items.push({label:"ADD STEAM GENERATOR HERE", fn:()=>{
        placePart(n=>({id:"sgX"+n,name:"STEAM GEN SPARE",w:1,h:2,x:gx,y:gy,col:"#5fd2e2",
          grp:"sg",tip:"An additional steam generator, placed where you put it. Right-click a free port to CONNECT it - unplumbed, it does nothing at all.",
          role:"sg"}));
      }});
      /* A SECOND TURBINE AND A SECOND CONDENSER. Both used to be one part,
         present or absent, and every reader that priced or gated them read
         that flag - so a hit on the one turbine zeroed the plant's output and
         a second could not exist to carry it. They are COUNTED now
         (turbCount()/condCount(), layout.js), the third time this codebase has
         made that move. The STOCK unit stays behind its own fittable
         checkbox, so "no turbine at all" is still a legal design and the bench
         still warns about it; these are the extra ones. */
      items.push({label:"ADD TURBINE HERE", fn:()=>{
        placePart(n=>({id:"turbX"+n,name:"TURBINE SPARE",w:3,h:1,x:gx,y:gy,col:"#f0a830",
          grp:"sec",tip:"An additional turbine, placed where you put it. It swallows its own share of steam and carries its own share of the load - lose one of two and you lose half the output, not all of it. Right-click a free port to CONNECT it.",
          role:"turb"}));
      }});
      items.push({label:"ADD CONDENSER HERE", fn:()=>{
        placePart(n=>({id:"condX"+n,name:"CONDENSER SPARE",w:3,h:1,x:gx,y:gy,col:"#5aa9d6",
          grp:"sec",tip:"An additional condenser, placed where you put it. It is heat sink and it is where the feed pumps draw from, so a second one is a second place for both. Right-click a free port to CONNECT it.",
          role:"cond"}));
      }});
    }
  }
  /* NO CONNECT OFFER HERE. It used to pick the nearest free port to the click
     and then the nearest free port to THAT, so the plant a right-click built
     was decided by two guesses the player never saw and could not aim. A run
     is drawn now: pull it out of a port square and drop it on the machine you
     mean (pipePorts(), plant.js). Both ends are chosen by the hand, so there
     is nothing left here for a default-picker to get wrong. */
  return items;
}
ctxAdd({sc:"design", resolve:ctxResolveDesign, items:ctxItemsDesign, title:ctxTitleDesign});

/* ─────────────── THE FUEL LATTICE, IN PLAN (canvas - genuinely graphical) ───────────────
   Drawn into its OWN <canvas> in the CORE and RODS panels by hostPaint(), which
   swaps the ctx the shared primitives (fillRect/txt/frame/dot...) write to. Not
   on #cv: the rail is opaque and paints over it, so anything drawn there would
   be both invisible and unclickable - see hostPaint() in plant.js. */
const LATPEN={tool:"fuel",bank:0,hover:null,last:null};

function latRingPhi(){
  const T=corePredict(derived()), phi=T.phiCold, r=new Float64Array(XNR);
  let mx=1e-9;
  for(let i=0;i<XNR;i++){
    let s=0; for(let j=0;j<XNZ;j++) s+=phi[XIX(i,j)];
    r[i]=s/XNZ; if(r[i]>mx) mx=r[i];
  }
  for(let i=0;i<XNR;i++) r[i]/=mx;
  return r;
}
const latRingOf=(u,v)=>Math.min(XNR-1,
  Math.floor(Math.hypot(u+.5,v+.5)*LAT.pitch/LM.dr));
function latSlotPhi(u,v,ph){
  const t=Math.hypot(u+.5,v+.5)*LAT.pitch/LM.dr-0.5;
  const i0=Math.floor(t), f=clamp(t-i0,0,1);
  const a=ph[clamp(i0,0,XNR-1)], b=ph[clamp(i0+1,0,XNR-1)];
  return a+(b-a)*f;
}
function latShare(u,v,ph){
  let tot=0;
  for(let a=0;a<LQ;a++) for(let b=0;b<LQ;b++)
    if(LAT.slot[LIX(a,b)]) tot+=latSlotPhi(a,b,ph);
  return tot>1e-9? latSlotPhi(u,v,ph)/(4*tot) : 0;
}
function latAct(u,v,shift){
  const q=LIX(u,v);
  if(LATPEN.tool==="fuel"){
    const nv=shift?L_EMPTY:(LAT.slot[q]?L_EMPTY:L_FUEL);
    if(LAT.slot[q]===nv) return;
    LAT.slot[q]=nv; if(!nv) LAT.rod[q]=-1;
  } else if(LATPEN.tool==="pois"){
    if(!LAT.slot[q]) return;
    LAT.slot[q]=LAT.slot[q]===L_POIS?L_FUEL:L_POIS;
  } else {
    if(!LAT.slot[q]) return;
    const nv=LAT.rod[q]===LATPEN.bank?-1:LATPEN.bank;
    if(LAT.rod[q]===nv) return;
    LAT.rod[q]=nv;
  }
  latRevolve();
}

/* x,y,w,h are the host canvas's own box, origin 0,0, in the fixed HOST_K scale
   hostPaint() sets - not plant layout units. */
function latPlan(x,y,w,h){
  const AX=15;
  // the readout line under the grid has to fit INSIDE the box now: hostPaint()
  // clips to the host element, where before this spilled onto #cv
  const gx=x+AX, gy=y+3, gw=w-AX, gh=h-19;
  const cs=gh/(LQ+0.6), p=LAT.pitch, ph=latRingPhi();
  /* CORE and RODS each own a lattice plan, so both paint through here every
     frame. The hover has to be tagged with the canvas it was taken in, or the
     second call clears what the first just found and the ring highlight lands
     on the plan the pointer is NOT over. */
  const me=ui.host, hov0=LATPEN.hover;
  const hv=(hov0&&hov0.host===me)? hov0 : null, hRing=hv? latRingOf(hv.u,hv.v) : -1;
  let rMax=0;
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++)
    if(LAT.slot[LIX(u,v)]) rMax=Math.max(rMax,Math.hypot(u+1,v+1)*p);

  fillRect(gx,gy,gw,gh,C.well);
  const CX=gx, CY=gy+gh;
  ctx.save(); ctx.beginPath(); ctx.rect(gx,gy,gw,gh); ctx.clip();
  if(hRing>=0){
    const r0=hRing*LM.dr/p*cs, r1=(hRing+1)*LM.dr/p*cs;
    ctx.beginPath(); ctx.arc(CX,CY,r1,-Math.PI/2,0);
    ctx.arc(CX,CY,r0,0,-Math.PI/2,true); ctx.closePath();
    ctx.fillStyle="rgba(240,168,48,.10)"; ctx.fill();
  }
  ctx.strokeStyle="rgba(95,210,226,.16)"; ctx.lineWidth=1;
  for(let i=1;i<XNR;i++){
    ctx.beginPath(); ctx.arc(CX,CY,i*LM.dr/p*cs,-Math.PI/2,0); ctx.stroke();
  }
  if(rMax>0){
    ctx.save(); ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.arc(CX,CY,rMax/p*cs,-Math.PI/2,0);
    ctx.strokeStyle=C.cyan; ctx.lineWidth=1.2; ctx.stroke(); ctx.restore();
  }
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++){
    const X=gx+u*cs, Y=gy+gh-(v+1)*cs, q=LIX(u,v);
    const s=LAT.slot[q], rod=LAT.rod[q];
    if(!s){ fillRect(X+cs/2-1,Y+cs/2-1,2,2,"#1b2c33"); continue; }
    const col=s===L_POIS?"#12303c":"#4a3208", ink=s===L_POIS?C.blue:C.amber;
    fillRect(X+1,Y+1,cs-2,cs-2,col);
    frame(X+1,Y+1,cs-2,cs-2,lerpC(col,ink,.42));
    const r=cs*.30*Math.sqrt(clamp(latSlotPhi(u,v,ph),.04,1));
    ctx.beginPath(); ctx.arc(X+cs/2,Y+cs/2,r,0,7);
    ctx.fillStyle=ink; ctx.globalAlpha=s===L_POIS?.9:.55; ctx.fill(); ctx.globalAlpha=1;
    if(rod>=0){
      const on=LATPEN.tool==="rod"&&LATPEN.bank===rod;
      fillRect(X+3,Y+3,cs-6,cs-6,on?C.amber:C.metal);
      txt(String(rod+1),X+cs/2,Y+cs/2+3,
        {size:7.5,weight:700,align:"center",color:C.well});
    }
  }
  ctx.restore();
  frame(gx,gy,gw,gh,C.edge);
  ctx.save(); ctx.setLineDash([9,3,2,3]);
  line(CX,gy-2,CX,CY+4,C.rail,1); line(gx-AX+9,CY,gx+gw,CY,C.rail,1);
  ctx.restore();
  ctx.save(); ctx.translate(x+6,gy+gh/2); ctx.rotate(-Math.PI/2);
  txt("REACTOR AXIS",0,0,{size:6,sp:1.2,align:"center",color:C.rail});
  ctx.restore();

  const wd=push({x:gx,y:gy,w:gw,h:gh,type:"paint",fn:(pt,e)=>{
    const u=Math.floor((pt.x-gx)/cs), v=LQ-1-Math.floor((pt.y-gy)/cs);
    if(u<0||u>=LQ||v<0||v>=LQ) return;
    const id=u+","+v; if(id===LATPEN.last) return;
    LATPEN.last=id; latAct(u,v,e&&e.shiftKey);
  }});
  // clear only OUR hover: the other plan's is not ours to stand down
  if(hov0&&hov0.host===me) LATPEN.hover=null;
  if(hov(wd)){
    const u=Math.floor((ui.ptr.x-gx)/cs), v=LQ-1-Math.floor((ui.ptr.y-gy)/cs);
    if(u>=0&&u<LQ&&v>=0&&v<LQ) LATPEN.hover={host:me,u,v};
  }
  if(!ui.drag) LATPEN.last=null;

  if(hv) fitTxt("S "+hv.u+","+hv.v+"  RING "+hRing+
      "  r"+(Math.hypot(hv.u+.5,hv.v+.5)*p).toFixed(2)+"m"+
      (LAT.slot[LIX(hv.u,hv.v)]
        ? "  "+(latShare(hv.u,hv.v,ph)*100).toFixed(2)+"%"
        : "  EMPTY"),
      gx,gy+gh+11,gw,{size:6.5,sp:.3,color:C.amber});
  else fitTxt(latCount()+" ASSEMBLIES / DOT IS FLUX",
      gx,gy+gh+11,gw,{size:6.5,sp:.5,color:C.ink2});
}
/* the canvas TIP() is no use here: drawTip() paints it on #cv, under the rail.
   The HTML #tip is position:fixed and clears everything. */
const LATPLAN_TIP="The core, laid out looking down at it. Click or drag to place assemblies, poison pins or rod clusters; hold SHIFT to clear. Rated power, core H/D, lattice pitch, burnable poison, bank count and control bank worth are all MEASUREMENTS of what you lay out here - not one of them is a number you can set. The faint arcs are the fourteen mesh rings the solver sorts your assemblies into, and the dot in each assembly is the flux at its own radius.";

const LATPEN_CORE=[
  ["FUEL","fuel",
   "Lay an assembly, or lift one out. Every square is four assemblies in the finished core, because the axis runs along the corner of the first slot. Rated power, core diameter and H/D are all counted off this, so an outer square is worth far more than an inner one - it carries a bigger annulus."],
  ["POISON","pois",
   "Swap an assembly between plain fuel and one carrying burnable poison pins. Poison holds down fresh excess reactivity that would otherwise be held by boron, and unlike boron it is graded: put it where the flux peaks and it flattens the core. It only works on a slot that already has fuel in it."],
];
const LATPEN_RODS=[
  ["CLUSTER","rod",
   "Drop a control cluster into an assembly, in whichever bank is selected below. The cluster is drawn as a block with its bank number on it. Count buys no worth - a fully inserted bank covers the core once however many you fit - so what you are choosing here is how near the flux each bank sits, and how many things can jam."],
];

const LATREFL=["NONE","STEEL","BERYL","GRAPH"];
const LATDIMS=[
  ["ACTIVE LENGTH","len",0.6,5.0,v=>v.toFixed(2)+" m",
   "How tall the fuel column is. Against the diameter the lattice revolves to, this is the core's H/D."],
  ["RIM REFLECTOR","reflR",0,3,v=>v.toFixed(1)+" cells",
   "Reflector thickness around the side of the core. One cell is worth most of what a reflector has to give and the two after it are diminishing returns - but every one of them is weighed."],
  ["LID REFLECTOR","reflT",0,3,v=>v.toFixed(1)+" cells",
   "Reflector over the top. Its own face with its own albedo, so a bare lid leaks whatever the rim happens to be doing."],
  ["FLOOR REFLECTOR","reflB",0,3,v=>v.toFixed(1)+" cells",
   "Reflector under the core. Leave it bare and the flux is pushed upward - a real way to shape a core, and a real way to ruin one."],
];

const LATREAD=[
  ["RATED POWER",()=>D.power.toFixed(0)+" MWt",
   "Not chosen. Fuel volume times the power density your family and pitch buy. Lay one more assembly and this rises by that annulus."],
  ["CORE H / D",()=>D.hd.toFixed(2),
   "The shape the lattice revolves to, against the active length you dimensioned."],
  ["LATTICE PITCH",()=>(LAT.pitch*100).toFixed(1)+" cm",
   "Assembly spacing, in centimetres. Tighter under-moderates: stronger, safer moderator feedback but less thermal margin."],
  ["BURNABLE POISON",()=>D.poison.toFixed(0)+" pcm",
   "The volume mean of the pins you placed."],
  ["CORE DIAMETER",()=>LM.dia.toFixed(2)+" m",
   "The equal-area diameter of the fuel you laid out."],
  ["ASSEMBLIES",()=>String(latCount()),
   "How many fuel assemblies the core has. The plan shows a quarter of them."],
];
const LATREAD_RODS=[
  ["CONTROL BANK WORTH",()=>D.rodw.toFixed(0)+" pcm",
   "Measured, not bought: the bank is driven fully in and the flux-weighted worth is read straight off the solve. The handles are the absorber material and how near the flux you put the clusters, not their count.",
   ()=>null],
  ["ROD BANKS",()=>String(D.nbank),
   "How many distinct banks your clusters are grouped into. One bank cannot tilt anything.",
   ()=>D.nbank<2?"var(--c-amber)":null],
  ["CLUSTER RINGS",()=>String(LM.chan.length),
   "How many of the fourteen mesh rings have a cluster somewhere in them.",
   ()=>null],
  ["SHUTDOWN MARGIN",()=>derived().sdm.toFixed(0)+" pcm",
   "How firmly the BANK ALONE holds the core down once it cools and the xenon decays.",
   ()=>derived().sdm<200?"var(--c-red)":null],
];

/* ══════════ HTML: the component panel rail ══════════ */
function paramBlockMk(block){
  switch(block.kind){
    case "optlist": {
      const a=blockAcc(block.key);
      const root=KIT.el("div","db-block");
      const r=KIT.rule(block.title); root.appendChild(r.el); KIT.tip(r.el,block.title,block.tip);
      const ol=KIT.optList(block.items,{onSelect:i=>a.set(block.base+i)});
      root.appendChild(ol.el);
      return {el:root,sync(){
        const deltas=block.items.map((_,i)=>massWith(block.key,block.base+i));
        const lo=Math.min(...deltas);
        ol.set(a.get()-block.base, deltas.map(v=>v-lo));
      }};
    }
    case "segsel": {
      const a=blockAcc(block.key);
      const root=KIT.el("div","db-block");
      const r=KIT.rule(block.title); root.appendChild(r.el); KIT.tip(r.el,block.title,block.tip);
      const ss=KIT.segSel(block.labels,{onSelect:i=>a.set(block.base+i)});
      root.appendChild(ss.el);
      return {el:root,sync(){
        const deltas=block.labels.map((_,i)=>massWith(block.key,block.base+i));
        const lo=Math.min(...deltas);
        ss.set(a.get()-block.base, deltas.map(v=>v-lo));
      }};
    }
    case "slider": {
      const a=blockAcc(block.key);
      const get=()=>a.get();
      const set=v=>{ a.set(block.step?Math.round(v/block.step)*block.step:v); };
      const row=KIT.sliderRow({title:block.title,min:block.min,max:block.max,step:block.step,
        fmt:block.fmt,massFn:!!block.massFn,tip:block.tip,onChange:set});
      return {el:row.el,sync(b){
        KIT.show(row.el,!(b.when&&!b.when()));
        const v=get();
        row.set(v,null,b.massFn?b.massFn(v)-b.massFn(block.min):undefined);
      }};
    }
    case "readout": {
      const r=KIT.readout({title:block.title,tip:block.tip});
      return {el:r.el,sync(b){ r.set(typeof b.val==="function"?b.val():b.val); }};
    }
    case "toggle": {
      const a=blockAcc(block.key);
      const t=KIT.toggle({label:block.title,mass:block.mass,tip:block.tip,onToggle:()=>{ a.set(!a.get()); }});
      return {el:t.el,sync(){ t.set(!!a.get()); }};
    }
    case "note": {
      const p=KIT.el("p","db-note");
      return {el:p,sync(b){
        const v=b.dyn?b.dyn():{text:b.text,color:b.color};
        if(p.textContent!==v.text) p.textContent=v.text;
        p.style.color=v.color||"";
      }};
    }
    case "readlist": {
      const box=KIT.el("div","db-readlist");
      return {el:box,sync(b){ fieldRowsSync(box, b.rows()); }};
    }
    case "sdmnote": {
      const seg=KIT.seg({cells:18});
      const p=KIT.el("p","db-note");
      const wrap_=KIT.el("div","db-block"); wrap_.append(seg.el,p);
      return {el:wrap_,sync(){
        const d=derived(), s = d.sdm<200 ? "Not enough. After a trip it creeps back to power."
                                         : "Enough to hold this core down after a trip, cold.";
        seg.set(clamp(d.sdm/2000,0,1), d.sdm<200?"var(--c-red)":"var(--c-green)");
        p.textContent=s;
      }};
    }
    case "bulkrow": {
      const root=KIT.el("div","db-bulkrow");
      const lab=KIT.el("span","db-bulkrow-lab"); lab.textContent=block.label;
      root.appendChild(lab);
      for(const it of block.items){
        const b=KIT.button(it.name,{size:6.5,onClick:it.fn});
        KIT.tip(b.el,it.name,it.tip);
        root.appendChild(b.el);
      }
      return {el:root,sync(){}};
    }
    case "rule": {
      const r=KIT.rule(block.title);
      if(block.tip) KIT.tip(r.el,block.title,block.tip);
      return {el:r.el,sync(){}};
    }
    case "lattools": {
      const root=KIT.el("div","db-block");
      const r=KIT.rule("PEN"); root.appendChild(r.el);
      KIT.tip(r.el,"PEN","What clicking on the plan does. Every tool is a toggle: click a slot to lay the thing down, click it again to take it away, and hold SHIFT while you drag to clear whatever you cross.");
      const row=KIT.el("div","db-toolrow");
      const btns=block.tools.map(t=>{
        const b=KIT.button(t[0],{size:7,onClick:()=>{ LATPEN.tool=t[1]; }});
        KIT.tip(b.el,t[0]+" PEN",t[2]); row.appendChild(b.el); return {b,k:t[1]};
      });
      root.appendChild(row);
      const bankRow=KIT.el("div","db-bankrow");
      const bankBtns=[0,1,2,3].map(b=>{
        const bt=KIT.button("BANK "+(b+1),{size:6.5,onClick:()=>{ LATPEN.bank=b; }});
        KIT.tip(bt.el,"BANK "+(b+1),"Which bank the clusters you draw belong to. Draw clusters at different radii into different banks and you can lean the flux; put them all in one and there is nothing to lean against.");
        bankRow.appendChild(bt.el); return bt;
      });
      root.appendChild(bankRow);
      return {el:root,sync(){
        if(!block.tools.some(t=>t[1]===LATPEN.tool)) LATPEN.tool=block.tools[0][1];
        btns.forEach(o=>o.b.set({on:LATPEN.tool===o.k}));
        const showBank=LATPEN.tool==="rod";
        KIT.show(bankRow,showBank);
        if(showBank) bankBtns.forEach((bt,i)=>bt.set({on:LATPEN.bank===i}));
      }};
    }
    case "latdimrack": {
      const root=KIT.el("div","db-block");
      const r=KIT.rule("SECTION"); root.appendChild(r.el);
      KIT.tip(r.el,"SECTION","The core in ELEVATION, where the plan above is the core looking down. How tall the fuel column is, and how much reflector is packed around the sides, the lid and the floor. Everything here is dimensioned in the section, so it decides core H/D and where the flux leaks away - the plan decides how wide the core is, this decides what shape it revolves to.");
      const refl=KIT.segSel(LATREFL,{onSelect:i=>{ D.refl=i; }});
      root.appendChild(refl.el);
      const rows=LATDIMS.map(d=>{
        const sl=KIT.sliderRow({title:d[0],min:d[2],max:d[3],step:(d[3]-d[2])/200,fmt:d[4],tip:d[5],
          onChange:v=>{ LAT[d[1]]=clamp(v,d[2],d[3]); latRevolve(); }});
        root.appendChild(sl.el);
        return {sl,d};
      });
      return {el:root,sync(){
        refl.set(D.refl);
        rows.forEach(({sl,d})=>sl.set(LAT[d[1]],null));
      }};
    }
    case "latplan": {
      const cv2=KIT.el("canvas","db-latplan-canvas");
      KIT.tip(cv2,"FUEL LATTICE / QUARTER PLAN",LATPLAN_TIP);
      hostForward(cv2);
      return {el:cv2,sync(){}};   // painted by dbSync() via hostPaint(), not here
    }
    default: return {el:KIT.el("div"),sync(){}};
  }
}
function blockSig(blocks){ return blocks.map(b=>b.kind+":"+(b.title||b.label||"")).join("|"); }
function dbPanelSync(container,blocks){
  const sig=blockSig(blocks);
  if(sig!==container._sig || !container._h){
    container.innerHTML="";
    container._h=blocks.map(b=>{ const h=paramBlockMk(b); container.appendChild(h.el); return h; });
    container._sig=sig;
  }
  blocks.forEach((b,i)=>{ const h=container._h[i]; if(h&&h.sync) h.sync(b); });
}

/* THE HEADING IS THE NAME FIELD. It was a NAME row inside the panel, under a
   title bar already showing the same word - so the panel said the name twice
   and only one of them could be typed into. rule()'s `edit` (kit.js) makes the
   title bar itself the input: the DEFAULT name is its placeholder, so a blank
   box still reads as the machine it is. It lives in the head and not in the
   body on purpose - dbPanelSync() wipes the body's innerHTML on every
   signature change, and an input living there would be torn down and rebuilt
   under the player's own cursor mid-keystroke. */
function dbNameWell(p){
  const def=p.name;   // DEFAULT NAME: the placeholder and the tip both offer the name a blank falls back to, so this is the one name partName() must NOT be asked for
  const well=KIT.well({title:def,edit:{maxLength:NAME_CAP,onChange:v=>{ setPartName(p.id,v); }}});
  if(well.nameInput)
    KIT.tip(well.nameInput,"NAME",
      "Type to rename this machine. Clear the box and it goes back to \""+def+"\". Clicking anywhere on this bar also selects the machine on the plant.");
  return well;
}
/* one panel per component (or gang) */
function dbRailBuild(rail,watch){
  rail.innerHTML="";
  const panels=[], gangs={};
  for(const p of LAY.parts){
    const B=paramsFor(p); if(!B.length&&!B.gang || B.plain) continue;
    /* A GANG IS TWO MACHINES SHARING ONE PANEL, and it now covers two cases
       with one mechanism. Identical components (three pumps) fold together and
       the head carries an "x3" suffix; machines that are simply married - the
       reactor and the drives bolted to its head - fold together with no suffix
       at all, because they are not copies of each other. Either way the FIRST
       one to arrive owns the well and lends the others its selection, so
       clicking either machine on the plant lights the same panel. */
    const g=gangs[B.gang];
    if(B.gang && g){
      g.ids.push(p.id);
      if(!g.noSfx) g.well.setSfx("x"+g.ids.length);
      continue;
    }
    const well=dbNameWell(p); rail.appendChild(well.el);
    const body=KIT.el("div","db-panel-body"); well.body.appendChild(body);
    const h={p,ids:[p.id],well,body,B,on:null,noSfx:!!B.gangPlain};
    railPick(well,h.ids,partName(p));
    watch.add(well.el);
    if(B.gang) gangs[B.gang]=h;
    panels.push(h);
  }
  /* A fitting is not in LAY.parts, so it never had a panel - which is why a
     relief valve's setpoints had nowhere to be set. One well per fitting,
     built from paramsForFit() exactly the way a component's is built from
     paramsFor(). The rail is rebuilt whenever the fitting set changes (LAY is
     rebuilt on fitSig(), layout.js), so this list cannot go stale. */
  const fits=[];
  for(const fid in D.fit){
    const B=paramsForFit(fid); if(!B.length||B.plain) continue;
    const name=FITNAME[D.fit[fid].mode]+" "+fid.toUpperCase();
    const well=KIT.well({title:name}); rail.appendChild(well.el);
    const body=KIT.el("div","db-panel-body"); well.body.appendChild(body);
    railPick(well,[fid],name);
    watch.add(well.el);
    fits.push({fid,well,body,on:null});
  }
  const results=KIT.well({title:"RESULTS"}); rail.appendChild(results.el);
  const review=KIT.well({title:"DESIGN REVIEW"}); rail.appendChild(review.el);
  // one switch per LAYERS entry, built once per rail rebuild - see
  // layerSwitches() in render/layers.js. The SAME helper the control room
  // calls: a layer switch is not redrawn per screen, it is drawn once.
  const layers=KIT.well({title:"LAYERS"}); rail.appendChild(layers.el);
  layerSwitches(layers.body);
  return {panels,fits,results,review};
}
/* the rail scrolls to a newly selected panel ONCE, on the frame sel changes -
   every frame would fight the user's own scrolling */
let dbLastSel=null;
function dbRailSync(state){
  const moved = sel!==dbLastSel; dbLastSel=sel;
  for(const h of state.panels){
    const on=h.ids.includes(sel);
    if(h.on!==on){ h.well.el.classList.toggle("on",on); h.on=on; }
    if(on && moved) KIT.reveal(h.well.el,"start");
    // a rename does not rebuild LAY, so the title has to be re-read here
    // every sync, not just once at build time - cheap, since setTitle()/
    // KIT.tip() are themselves guarded no-ops when nothing changed.
    /* The heading SHOWS the display name and the placeholder offers the
       default, so a cleared box reads as the machine's own name rather than as
       an empty bar. */
    const nm=partName(h.p);
    h.well.setName(nm);
    KIT.tip(h.well.head,nm);
    // paramsFor() rebuilds the whole block list, so it is only asked for a
    // panel that is actually on screen - see railWatch() in inspector.js
    if(!railSeen(h.well.el) && !(on&&moved)) continue;
    const cur=paramsFor(LAY.parts.find(q=>q.id===h.p.id)||h.p);
    dbPanelSync(h.body,cur);
  }
  for(const h of state.fits){
    const on=h.fid===sel;
    if(h.on!==on){ h.well.el.classList.toggle("on",on); h.on=on; }
    if(on && moved) KIT.reveal(h.well.el,"start");
    if(!railSeen(h.well.el) && !(on&&moved)) continue;
    dbPanelSync(h.body,paramsForFit(h.fid));
  }
  { const rd=benchResultsData();
    const body=state.results.body;
    if(!body.firstChild){
      const mass=KIT.el("div","db-mass"); body.appendChild(mass);
      const massBar=KIT.seg({cells:48}); body.appendChild(massBar.el);
      const massVal=KIT.el("div","db-mass-val"); body.appendChild(massVal);
      const statBox=KIT.el("div","db-stats"); body.appendChild(statBox);
      body._h={massVal,massBar,statBox};
    }
    const {massVal,massBar,statBox}=body._h;
    massBar.set(clamp(rd.mass/BUDGET,0,1), rd.over?"var(--c-red)":(rd.mass/BUDGET>.9?"var(--c-amber)":"var(--c-green)"));
    massVal.textContent=rd.mass.toFixed(0)+" / "+BUDGET+" t   EQUIPMENT "+rd.eq.toFixed(0)+
      "t   PIPING+SHIELD "+rd.ship.toFixed(0)+"t   CORE "+rd.dens.toFixed(0)+" kW/L   EXCESS "+rd.excess.toFixed(0)+" pcm";
    massVal.style.color=rd.over?"var(--c-red)":"";
    statRowsSync(statBox, rd.stats);
  }
  { const rv=benchReviewData();
    const body=state.review.body;
    if(!body._list) body._list=(()=>{ const d=KIT.el("div","db-review-list"); body.appendChild(d); return d; })();
    const list=body._list, sig=rv.issues.map(w=>w[1]).join("|");
    if(list._sig!==sig){
      list.innerHTML=""; list._sig=sig;
      if(!rv.issues.length){ const ok=KIT.el("p","db-review-ok");
        ok.textContent="NO OBJECTIONS - THIS PLANT IS INTERNALLY CONSISTENT"; list.appendChild(ok); }
      for(const w of rv.issues){
        const row=KIT.el("div","db-review-row "+(w[0]==="HARD"?"hard":"warn"));
        const tag=KIT.el("span","db-review-tag"); tag.textContent=w[0]==="HARD"?"BLOCK":"WARN";
        const txt2=KIT.el("span"); txt2.textContent=w[1];
        row.append(tag,txt2); list.appendChild(row);
      }
    }
    state.review.el.classList.toggle("blocked",rv.hard);
  }
}

let DB=null;
function dbBuild(){
  const mount=document.getElementById("scr-design");
  if(!mount) return null;
  const root=KIT.el("div","db-root");
  const head=KIT.el("div","db-head");
  const cap=KIT.el("span","db-head-cap");
  cap.textContent="longitudinal section, looking to port / up is up / click a component to configure it, drag to move it";
  const arr=KIT.button("AUTO-ARRANGE",{size:8,onClick:()=>{ LAY=null; layoutMetrics(); }});
  KIT.tip(arr.el,"AUTO-ARRANGE","Resets every component to its default position.");
  head.append(cap,arr.el);
  const rail=KIT.el("div","db-rail");
  root.append(head,rail);
  mount.appendChild(root);
  return {root,head,rail,state:null,watch:null};
}
function dbSync(){
  if(!DB) return;
  if(DB.rail._layFit!==LAY) {
    if(DB.watch) DB.watch.free();
    DB.watch=railWatch(DB.rail);
    DB.state=dbRailBuild(DB.rail,DB.watch); DB.rail._layFit=LAY;
  }
  dbRailSync(DB.state);
  /* the fuel lattice plan is genuinely graphical and stays canvas - but its own
     canvas, because the rail it lives in is opaque over #cv. See hostPaint(). */
  document.querySelectorAll("#scr-design .db-latplan-canvas").forEach(cv2=>hostPaint(cv2,latPlan));
}
if(typeof document!=="undefined" && document.documentElement) DB=dbBuild();

function drawDesign(){
  dbSync();
  const railBox=DB? hostRect(DB.rail) : null;
  // measured off the head row, not a magic reserve - the design screen has no
  // transport strip above it, so there is no fixed band to hard-code
  const headBox=DB? hostRect(DB.head) : null;
  const vy = headBox? headBox.y+headBox.h : TOPBAR_H;
  const vh=Math.max(120,H-vy);
  const vw = railBox ? Math.max(200, railBox.x) : W;
  drawPlant(vy,null,vh,0,vw);
  { const st=DB&&DB.state;
    const h = st && (st.panels.find(o=>o.ids.includes(sel)) || st.fits.find(o=>o.fid===sel));
    if(h) leaderLine(h.well.el,DB.rail); }
  drawCtxMenu();
}
