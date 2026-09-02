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
 return [
  ["THERMOSIPHON HEAD",M.head.toFixed(1)+" cells",clamp((M.head+1)/4,0,1),M.head<0.5?C.amber:C.green,
   "How far the steam generators sit above the reactor. Hot water rises into them and cold water falls back with no pumps at all. Raise the generators and a blackout stops being fatal."],
  ["PRIMARY PIPE RUN",M.pipe.toFixed(1)+" m",clamp(M.pipe/60,0,1),M.pipe>40?C.amber:C.green,
   "Total hot and cold leg length. Long runs add friction so your pumps deliver less flow, and give more pipe for a hit to find. They also add coolant mass, which is thermal inertia in your favour."],
  ["FLOW PENALTY",((1-M.flowK)*100).toFixed(0)+" %",1-M.flowK,(1-M.flowK)>.2?C.amber:C.green,
   "Pumping loss from pipe friction. A short straight run from reactor to steam generator costs nothing; a sprawling layout quietly caps the flow you can ever achieve. Loops share the core's flow, so this is what the AVERAGE loop costs: a second loop does not buy flow, and a sprawling one still spends it."],
  ["PUMP CAPACITY",corePumpCap().toFixed(1)+" / "+totalPumpCap().toFixed(1)+" pumps",
   totalPumpCap()>0?clamp(corePumpCap()/totalPumpCap(),0,1):1,C.cyan,
   "How much pump is on the CORE's own circuit, against every pump on the ship. Each one develops its own stated head, so a second pump on a loop is real extra flow and not a spare that buys nothing - and the pumps that are not on this number are turning the feedwater and the cooling water, which are two other circuits doing two other jobs."],
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
  /* A SHARE, the way PUMP CAPACITY is, because turbPiped() is counted - one
     unpiped turbine of two costs half the output, not all of it. */
  ["STEAM CIRCUIT",(M.turbConn*turbCount()).toFixed(0)+" / "+turbCount()+" turbines",M.turbConn,
   M.turbConn<1?C.red:C.green,
   "Whether each turbine is in a circuit that can actually run: a generator raising steam into it, and a condenser to exhaust into. An unpiped turbine spins on nothing and makes no electricity, and a generator with nowhere to send its steam boils into a closed vessel and takes no heat out of its loop."],
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
  for(const id of holdTankIds()){ if(holdPlumbed(id)) continue;
    w.push(["SOFT","No pipe reaches "+partName(partOf(id))+". It holds nothing: the pressure of the circuit it stands on will drift off programme and stay there.",id]); }
  /* ══ WHAT A HOLD TANK CAN BE WRONG ABOUT ══
     All soft: the bench warns and never refuses. Two on one circuit is the
     case netRef() demotes; a check valve on a surge line is a one-way line
     that cannot surge; a vessel alone on its circuit is holding nothing. */
  { const byCirc={};
    for(const id of holdTankIds()){ const t=D.tanks[id], ci=tankCircuit(id);
      (byCirc[ci]||(byCirc[ci]=[])).push(id);
      if(t.check) w.push(["SOFT",partName(partOf(id))+" holds pressure through a check valve. A surge line carries the loop both ways - a one-way line is not one.",id]);
      if(!holdPlumbed(id)) continue;
      if(ci===null||ci===undefined||ci<0)
        w.push(["SOFT",partName(partOf(id))+" is on no circuit. It holds nothing at all.",id]); }
    /* A SETPOINT ABOVE WHAT THE WEAKEST THING ON THE CIRCUIT WILL TAKE. Every
       wall on the plant is a real thickness now, so this is a comparison and
       not a rule of thumb. */
    for(const ci of holdCircs()){ const set=holdSetP(ci), lim=plantRating(ci);
      if(lim>0 && set>lim) w.push(["SOFT","The "+circName(ci).toLowerCase()+" is held at "+
        set.toFixed(1)+" MPa and the thinnest wall on it is built for "+lim.toFixed(1)+
        " MPa. Something on that circuit lets go before the relief valve does. Widen the wall or drop the setpoint.",
        holdOnCirc(ci)[0]||null]); }
    for(const ci in byCirc) if(byCirc[ci].length>1)
      w.push(["SOFT","More than one vessel is set to hold "+circName(+ci)+". Only the first is used; the rest run as ordinary tanks.",byCirc[ci][1]]); }
  if(!M.pzrOK) w.push(["SOFT","A pressure vessel is not the highest point of its loop. Its steam bubble cannot form properly, so pressure damping drops to 45%.",holdTankIds()[0]||null]);
  /* The same standing pzrConn has, for the other half of the plant. A steam
     circuit is a generator, a turbine and somewhere to reject the heat; miss
     any one of the three and the machines are decorations the bench used to
     price, draw and never mention. */
  for(const id of (M.sgNoSteam||[]))
    w.push(["SOFT","This steam generator has no steam path to a turbine that can exhaust. It boils into a closed vessel, so it takes no heat out of its loop at all.",id]);
  /* THERE IS NO INVISIBLE LID. A shell with nothing fitted to relieve it
     bursts, so the bench says so - and still builds it, because refusing is
     not what this bench does. */
  for(const id of (M.sgNoRelief||[]))
    w.push(["SOFT","No relief valve is fitted anywhere on this generator's steam side. Nothing will let the pressure go if the steam cannot get away, and the shell bursts at 1.5x its design pressure. Place a fitting on the steam line and set it to RELIEF.",id]);
  if(M.turbConn!==undefined && M.turbConn<1)
    w.push(["SOFT","A turbine is not in a complete steam circuit - it needs a generator feeding it AND a condenser to exhaust into. Unpiped, it makes no electricity.","turb"]);
  for(const id of (M.pumpNoDis||[]))
    w.push(["SOFT","Nothing is piped to this pump's DISCHARGE. A pump pushes the way its casing is cast - suction on one face, discharge on the other - so it is pushing into a blank plate and moves nothing. Draw a run from the discharge, or turn the pump round.",id]);
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
  /* A run whose two ends are the SAME node. It is drawn, it costs mass, and no
     pressure difference across it is possible - so it can never carry
     anything. The bench warns; it never refuses. A run between two different
     faces of one machine is a recirculation line and is not this. */
  if(selfRuns().length) w.push(["SOFT",selfRuns().length===1?"One run goes from a nozzle straight back to the same one. Both ends are the same point in the plant, so no pressure can ever push anything along it - it costs mass and carries nothing.":selfRuns().length+" runs go from a nozzle straight back to the same one. Both ends of each are the same point in the plant, so nothing can ever flow along them - they cost mass and carry nothing.",null]);
  /* ONE ROW PER PART IN LIMBO, so the review panel names the machine and
     warnFor() can put the red dot on it. HARD: two machines in the same cells
     is not a plant anybody could build, and every occupancy question below -
     repair access, exposure, where a nozzle may sit - answers nonsense while
     it is true. It is drawn, not refused, so the fix is to drag it out. */
  for(const p of LAY.parts.filter(q=>q.limbo))
    w.push(["HARD",partName(p)+" is standing where it does not fit - on another machine, or off the grid. Drag it clear.",p.id]);
  if(M.access<1) w.push(["RED","Some equipment is walled in with no adjacent free cell. It could never be repaired once damaged.",null]);
  if(M.exposure>0.3) w.push(["SOFT","Over 30% of the plant sits in hull cells. Expect to lose something every time you are hit.",null]);
  if(sgCount()>1&&M.sep<3) w.push(["SOFT","Redundant loops are adjacent. One hit will take out both.",null]);
  return w;
}

/* ONE LIST PER PASS. warnFor() below asks for this once per PART to pull out
   that part's own rows, so the whole review - derived(), the lattice warnings
   and a crossTies() walk - was being run twenty-odd times a frame, and again
   at 10 Hz from shellSync(). Cached on layPass() (layout.js), which is the
   same window the node graph is settled in, so it cannot outlive a frame or a
   tick and D cannot move under it. Only the no-argument form: a caller that
   hands in its own `d` is asking about a plant that is not on the board (the
   inspector's preview), and that is nobody else's answer. */
let dbIssues=null, dbIssuesPass=0;
/* ══ WITHOUT A REACTOR THERE IS NOTHING TO REVIEW ══
   Every figure derived().warn and latWarn() judge - shutdown margin, boron
   demand, void, peaking, the turbine's share of the steam this plant raises -
   is about a reactor, and the lattice is a DRAWING that exists whether or not
   one is on the board. So a ship with nothing on it read nine warnings about a
   machine nobody had placed. It says the one useful thing instead.
   RED and never HARD: a blank grid commissions.
   layoutWarnings() STAYS either way - those are objections about boxes that DO
   exist, and one of them is the HARD that refuses a part standing in a bad
   cell. Hiding that would let a broken arrangement commission. */
const NO_CORE=[["RED","There is no reactor on this ship. Place one, and the rest of the design has something to be judged against.",null]];
function designIssues(d,M){
  const lay=()=>layoutWarnings(M||layoutMetrics());
  if(d) return roleOf("core") ? d.warn.concat(latWarn(),lay()) : NO_CORE.concat(lay());
  const p=layPass();                      // 0 = outside a window, so not cacheable
  if(p && dbIssuesPass===p) return dbIssues;
  const out = roleOf("core") ? derived().warn.concat(latWarn(),lay())
                             : NO_CORE.concat(lay());
  if(p){ dbIssues=out; dbIssuesPass=p; }
  return out;
}
function designBlocked(d,M){ return designIssues(d,M).some(warnHard); }
function warnFor(id){
  const p=partOf(id);
  if(p && !p.access && p.grp!=="shield") return C.red;
  const w=designIssues(null,PLANT_LM).filter(q=>q[2]===id);
  if(!w.length) return null;
  return w.some(warnRed)?C.red:C.amber;
}

// which port a plant-space point lands on, or null - the same small square
// PORTG (plant.js) draws a mark in
function portHit(pt){
  const gx=Math.floor((pt[0]-GX)/CELL), gy=rowAt(pt[1]);
  return portAtCell(gx,gy);
}
/* right-click, held still and released: add or remove - see .claude/CLAUDE.md
   A PORT under the cursor wins over everything else it happens to sit on -
   see uiDown()'s own right-click split (core/ui.js): a quick tap never
   reaches this at all, only a held-and-released or a drag does. */
function ctxResolveDesign(p){
  const pt=vIn(p)?vPt(p):null;
  if(!pt) return null;
  const gx=Math.floor((pt.x-GX)/CELL), gy=rowAt(pt.y);
  const port=portHit([pt.x,pt.y]);
  const part=partAt([pt.x,pt.y]);   // layout.js - the same lookup the part drag's drop test uses
  // a pipe is a CELL, so "which pipe is under the cursor" is one lookup and
  // not a distance to a polyline
  const pipe = (!port && !part && D.pipes[gx+","+gy]) ? gx+","+gy : null;
  return {x:p.x,y:p.y,cell:{gx,gy},port,part,pipe};
}
// Stage 7a: the menu header names the thing it is ABOUT - a part, a run, a
// fitting, or the plant itself for a bare cell. Never a menu item, so it
// carries no fn and cannot be clicked - see shellInitCtxMenu() (screens/shell.js).
function ctxTitleDesign(hit){
  if(hit.port){ const pt=D.ports[hit.port], p=partOf(pt.p);
    return (p?partName(p):"")+" PORT"; }
  if(hit.part) return partName(hit.part);
  if(hit.pipe){ const keys=pipeMap().cellOwner[hit.pipe];
    return (keys && pipeLabel(keys[0].split(":")[0], keys[0])) || "PIPE"; }
  return "PLANT";
}
/* Stage 7a: a REMOVE offer belongs to the thing under the cursor. hit.part
   decides - a click on a component offers REMOVE, one item, about that
   part; a click on nothing offers no removal at all. The old shape built a
   fixed FIT/REMOVE prefix before it ever looked at hit, so right-clicking
   dead space offered to remove equipment that was nowhere near the cursor. */
function ctxItemsDesign(hit){
  /* DECISION 2: a port's only offer is REMOVE PORT, which takes the port's own
     pipe with it (removePort(), layout.js) exactly as removing a part takes
     its runs. The SUCT/DISCH rows are gone: the FACE decides which side of an
     internal path a port is on, so naming it was a label that could disagree
     with the plumbing and change nothing. */
  if(hit.port)
    return [{label:"REMOVE PORT", fn:()=>{ removePort(hit.port); }}];
  if(hit.part){
    /* ANYTHING ON THE BOARD, THE PLAYER CAN TAKE OFF - there is one
       mechanism now, so there is one offer. A machine, a tank and a fitting
       are three dictionaries on D and nothing here asks which. A blank grid
       is a legal plant: it reads as a ship with nothing on it.
       A RIDER SAYS WHAT ACTUALLY GOES: the rod drives are bolted to the
       vessel head, so removing them removes the reactor, and the row names it
       rather than letting the player find out afterwards. */
    const host=hit.part.pin && partOf(hit.part.pin.to);
    return [{label:host?("REMOVE "+partName(host)):"REMOVE",
             fn:()=>{ removePart(hit.part.id); }}];
  }
  if(hit.pipe){
    /* A PIPE CELL UNDER THE CURSOR. The whole connection is what a player
       usually means, so both offers are here - one cell, or every cell the
       walk through this one reaches. */
    const keys=pipeMap().cellOwner[hit.pipe]||[];
    const items=[{label:"REMOVE CELL", fn:()=>{ delete D.pipes[hit.pipe]; buildLayout(); }}];
    if(keys.length) items.push({label:"REMOVE RUN", fn:()=>{
      for(const key of keys){ const c=pipeMap().byKey[key]; if(!c) continue;
        for(const [x,y] of c.cells) delete D.pipes[x+","+y]; }
      buildLayout(); }});
    return items;
  }
  // a genuinely bare cell: nothing is under the cursor, so no REMOVE
  // belongs here - only offers that create or connect something.
  const items=[];
  if(hit.cell){
    const {gx,gy}=hit.cell;
    if(gx>=0 && gy>=0 && gx<GW && gy<GH){
      /* ONE ENTRY, no submenu of kinds. It places the single default tank
         config (TANK_DEFAULT, pipenet.js); what goes in it, what is behind it
         and how it is plumbed are set afterwards on its own panel. Not gated
         on a count - four tanks is a legal plant. */
      items.push({label:"ADD TANK", fn:()=>{ addTank(gx,gy); }});
      /* ONE ENTRY, no submenu of kinds - the same argument ADD TANK
         makes. It places the single default fitting config (FIT_DEFAULT,
         pipenet.js); whether it is a tee, a throttle or a relief valve is a
         knob on its own panel afterwards, because all three are one box in
         one cell and only the mode differs. */
      items.push({label:"ADD VALVE", fn:()=>{ addFitting(gx,gy); }});
      /* ONE ROW PER KIND OF MACHINE, off MACHINE (layout.js) and nothing
         else - so adding a kind of machine is adding a row there, and no row
         here can offer a machine the mint table cannot build. Nothing is
         gated on a count, and nothing is SPARE: whether a second pump is
         redundancy is read off the drawing. */
      for(const kind in MACHINE) if(!machRides(kind))
        items.push({label:"ADD "+MACHINE[kind].name,
                    fn:()=>{ addMachine(kind,gx,gy); }});
    }
  }
  /* NO CONNECT OFFER HERE. A pipe is laid cell by cell with the PIPE tool and
     a port is placed by clicking the cell beside a machine, so there is
     nothing left here for a menu row to pick for it. */
  return items;
}
ctxAdd({sc:"design", resolve:ctxResolveDesign, items:ctxItemsDesign, title:ctxTitleDesign});
// ESC PUTS THE TOOL BACK - the one way out of a mode, and the same key that
// used to cancel a pipe in flight
keyAdd({k:"Escape", sc:"design", lab:"SELECT", fn:()=>{ TOOL.active="select"; }});

/* ─────────────── THE FUEL LATTICE, IN PLAN (canvas - genuinely graphical) ───────────────
   Drawn into its OWN <canvas> in the CORE and RODS panels by hostPaint(), which
   swaps the ctx the shared primitives (fillRect/txt/frame/dot...) write to. Not
   on #cv: the rail is opaque and paints over it, so anything drawn there would
   be both invisible and unclickable - see hostPaint() in plant.js. */
/* ONE PEN PER SURFACE. A pen bar governs the canvas it stands over: `plan` is
   the pens that author r, `sec` the pens that author z. A single shared pen
   meant five of the six left the other canvas inert. */
const LATPEN={plan:"fuel",sec:"len",bank:0,hover:null,last:null};

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
  if(LATPEN.plan==="mod"){
    const nv=shift?L_EMPTY:(LAT.slot[q]===L_MOD?L_FUEL:L_MOD);
    if(LAT.slot[q]===nv) return;
    LAT.slot[q]=nv; if(nv!==L_FUEL) LAT.rod[q]=-1;
  } else if(LATPEN.plan==="fuel"){
    const nv=shift?L_EMPTY:(LAT.slot[q]?L_EMPTY:L_FUEL);
    if(LAT.slot[q]===nv) return;
    LAT.slot[q]=nv; if(!nv) LAT.rod[q]=-1;
  } else if(LATPEN.plan==="pois"){
    if(!latFuel(q)) return;
    LAT.slot[q]=LAT.slot[q]===L_POIS?L_FUEL:L_POIS;
  } else if(LATPEN.plan==="zone"){
    if(!latFuel(q)) return;
    const nv=shift?0:(LAT.zone[q]+1)%LAT_NZ;
    if(LAT.zone[q]===nv) return;
    LAT.zone[q]=nv;
  } else if(LATPEN.plan==="rod"){
    if(!latFuel(q)) return;
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
    if(s===L_MOD){
      fillRect(X+1,Y+1,cs-2,cs-2,"#2a2622");
      frame(X+1,Y+1,cs-2,cs-2,C.graph);
      hatch(X+2,Y+2,cs-4,cs-4,C.graph,.55);
      continue;
    }
    const col=s===L_POIS?"#12303c":"#4a3208", ink=s===L_POIS?C.blue:C.amber;
    fillRect(X+1,Y+1,cs-2,cs-2,col);
    const zn=LAT.zone[q];
    frame(X+1,Y+1,cs-2,cs-2,zn? C.cyan : lerpC(col,ink,.42));
    // a zone is a rim, not a fill: the flux dot and the poison colour still own
    // the middle of the slot, and zone one draws nothing at all
    if(zn) txt(String(zn+1),X+cs-2.5,Y+7,
      {size:6,weight:700,align:"right",color:C.cyan});
    const r=cs*.30*Math.sqrt(clamp(latSlotPhi(u,v,ph),.04,1));
    ctx.beginPath(); ctx.arc(X+cs/2,Y+cs/2,r,0,7);
    ctx.fillStyle=ink; ctx.globalAlpha=s===L_POIS?.9:.55; ctx.fill(); ctx.globalAlpha=1;
    if(rod>=0){
      const on=LATPEN.plan==="rod"&&LATPEN.bank===rod;
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
    const u=Math.floor((pt.x-gx)/cs), v=Math.floor((gy+gh-pt.y)/cs);
    if(u<0||u>=LQ||v<0||v>=LQ) return;
    const id=u+","+v; if(id===LATPEN.last) return;
    LATPEN.last=id; latAct(u,v,e&&e.shiftKey);
  }});
  // clear only OUR hover: the other plan's is not ours to stand down
  if(hov0&&hov0.host===me) LATPEN.hover=null;
  if(hov(wd)){
    const u=Math.floor((ui.ptr.x-gx)/cs), v=Math.floor((gy+gh-ui.ptr.y)/cs);
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
/* a rail control is a DOM node, so it carries its own data-tip-title and the
   canvas TIP() is not needed: same box either way (shellInitTooltip). */
const LATPLAN_TIP="The core, laid out looking down at it. Click or drag to place assemblies, poison pins or rod clusters; hold SHIFT to clear. Rated power, core H/D, lattice pitch, burnable poison, bank count and control bank worth are all MEASUREMENTS of what you lay out here - not one of them is a number you can set. The faint arcs are the fourteen mesh rings the solver sorts your assemblies into, and the dot in each assembly is the flux at its own radius.";

const LATPEN_CORE=[
  ["FUEL","fuel",
   "Lay an assembly, or lift one out. Every square is four assemblies in the finished core, because the axis runs along the corner of the first slot. Rated power, core diameter and H/D are all counted off this, so an outer square is worth far more than an inner one - it carries a bigger annulus."],
  ["POISON","pois",
   "Swap an assembly between plain fuel and one carrying burnable poison pins. Poison holds down fresh excess reactivity that would otherwise be held by boron, and unlike boron it is graded: put it where the flux peaks and it flattens the core. It only works on a slot that already has fuel in it."],
  ["ZONE","zone",
   "Put an assembly into a different LOADING ZONE. Each zone that has slots in it gets its own FUEL row above, so you can load fresh high-enrichment fuel on the rim and burnt fuel toward the centre - which is how a real core is loaded, and the main way of flattening peaking without spending poison. Click cycles a slot through the three zones, SHIFT puts it back to zone one. It only works on a slot that already has fuel in it."],
  ["MODERATOR","mod",
   "Pack a slot with a block of moderator instead of an assembly. It makes no power and it costs you the fuel that was there, and in exchange the neutrons in this core are slowed down. That is the whole of the void coefficient: if the coolant does the moderating, boiling it off shuts the core down; if these blocks do, the coolant is only a poison and boiling it off ADDS power. A block is core material, so the fuel either side of it is still one reactor."],
];
const LATPEN_RODS=[
  ["CLUSTER","rod",
   "Drop a control cluster into an assembly, in whichever bank is selected below. The cluster is drawn as a block with its bank number on it. Count buys no worth - a fully inserted bank covers the core once however many you fit - so what you are choosing here is how near the flux each bank sits, and how many things can jam."],
];

const LATREFL=["NONE","STEEL","BERYL","GRAPH"];

/* ─────────────── THE CORE IN SECTION (canvas, the second host) ───────────────
   The sim is 2-D (r, z) and the plan authors only r. This is z: the fuel
   column's height and the reflector on each of its three faces, which were
   four sliders and are now a drawing. It goes through the SAME hostForward()
   + hostPaint() door latPlan() uses - there is one host-canvas mechanism.

   The scale is METRIC and FIXED, not fitted to the core. That is what makes
   the ACTIVE LENGTH drag track the pointer: a fitted scale would rescale the
   picture under the hand that is dragging it. */
const SEC_W=5.0, SEC_H=5.8;        // metres of section the canvas shows
const SEC_FLOOR=0.55;              // metres of room left under the core for the floor band
const LAT_LEN_MIN=0.6, LAT_LEN_MAX=5.0;
/* THE HIT TEST AND THE DRAW READ THIS, and nothing else works out where the
   core is. Anchoring one off a copy of the other is the bug this bench has
   already shipped once. */
function latSecGeom(x,y,w,h){
  const gx=x+3, gy=y+3, gw=w-6, gh=h-19;
  const K=Math.min(gw/SEC_W, gh/SEC_H);
  return {gx,gy,gw,gh,K,CX:gx+gw/2,CY:gy+gh-SEC_FLOOR*K};
}
function latSectionAct(G,pt,shift){
  const rr=Math.abs(pt.x-G.CX)/G.K, zz=(G.CY-pt.y)/G.K;
  if(LATPEN.sec==="len"){
    const nv=clamp(zz,LAT_LEN_MIN,LAT_LEN_MAX);
    if(Math.abs(nv-LAT.len)<1e-9) return;
    LAT.len=nv; latRevolve(); return;
  }
  if(LATPEN.sec!=="refl") return;
  const dr=LM.dr, dz=LM.dz, halfW=(XNR-0.5)*dr;
  let face=null, k=0;
  if(zz>LAT.len){ face="reflT"; k=Math.ceil((zz-LAT.len)/dz); }
  else if(zz<0){ face="reflB"; k=Math.ceil(-zz/dz); }
  else if(rr>halfW){ face="reflR"; k=Math.ceil((rr-halfW)/dr); }
  if(!face) return;
  const nv=clamp(shift?k-1:k,0,LAT_REFLMAX);
  if(LAT[face]===nv) return;
  LAT[face]=nv; latRevolve();
}
function latSection(x,y,w,h){
  const G=latSecGeom(x,y,w,h), {gx,gy,gw,gh,K,CX,CY}=G;
  const dr=LM.dr, dz=LM.dz, cw=dr*K, ch=dz*K, NC=XNR*2-1;
  const halfW=(XNR-0.5)*dr*K, colH=LAT.len*K;
  fillRect(gx,gy,gw,gh,C.well);
  ctx.save(); ctx.beginPath(); ctx.rect(gx,gy,gw,gh); ctx.clip();

  // the reflector band, at the thickness each face was given, in the tone of
  // the material bought - the same REFLC row the control room's section uses
  const rc=REFLC[D.refl];
  if(rc){
    const bt=LAT.reflT*ch, bb=LAT.reflB*ch, br=LAT.reflR*cw;
    ctx.globalAlpha=.30;
    if(br>0){ fillRect(CX-halfW-br,CY-colH-bt,br,colH+bt+bb,rc);
              fillRect(CX+halfW,CY-colH-bt,br,colH+bt+bb,rc); }
    if(bt>0) fillRect(CX-halfW,CY-colH-bt,2*halfW,bt,rc);
    if(bb>0) fillRect(CX-halfW,CY,2*halfW,bb,rc);
    ctx.globalAlpha=1;
  }
  /* The fuel column, mirrored about the centreline exactly the way
     coreField() does it (plant.js), so the bench section and the control
     room's section are the same picture of the same core. */
  for(let c=0;c<NC;c++){
    const i=Math.abs(c-(XNR-1)), cx=CX+(c-(XNR-1))*cw-cw/2;
    const ff=clamp(LM.frac[i],0,1), oo=clamp(LM.occ[i],0,1);
    for(let j=0;j<XNZ;j++){
      const cy=CY-(j+1)*ch;
      if(oo<.02){ fillRect(cx+cw/2-1,cy+ch/2-1,2,2,"#1b2c33"); continue; }
      if(ff>.02){ ctx.globalAlpha=.20+.55*ff; fillRect(cx+.4,cy+.4,cw-.8,ch-.8,C.amber); }
      if(oo-ff>.02){ ctx.globalAlpha=.20+.55*(oo-ff); fillRect(cx+.4,cy+.4,cw-.8,ch-.8,C.graph); }
      ctx.globalAlpha=1;
    }
  }
  frame(CX-halfW,CY-colH,2*halfW,colH,C.edge);
  ctx.save(); ctx.setLineDash([9,3,2,3]);
  line(CX,gy,CX,CY,C.rail,1); line(gx,CY,gx+gw,CY,C.rail,1);
  ctx.restore();
  ctx.restore();
  frame(gx,gy,gw,gh,C.edge);

  const wd=push({x:gx,y:gy,w:gw,h:gh,type:"paint",fn:(pt,e)=>{
    latSectionAct(G,pt,e&&e.shiftKey);
  }});
  /* THE COLUMN TOP IS A HANDLE, NOT A PEN: with a plan pen up latSectionAct()
     returned at its first line and the whole section was inert. Grabbed by its
     OFFSET, and stood down only under the REFLECTOR pen, whose first lid cell
     is the same band of picture. */
  let grab=null;
  const hw=LATPEN.sec==="refl" ? {x:-1e4,y:-1e4,w:0,h:0}
    : push({x:CX-halfW-4,y:CY-colH-6,w:2*halfW+8,h:12,type:"paint",fn:pt=>{
    if(grab===null) grab=(CY-colH)-pt.y;
    const nv=clamp((CY-(pt.y+grab))/K,LAT_LEN_MIN,LAT_LEN_MAX);
    if(Math.abs(nv-LAT.len)<1e-9) return;
    LAT.len=nv; latRevolve();
  }});
  const lit=LATPEN.sec==="len"||hov(hw)||ui.drag===hw;
  fillRect(CX-halfW,CY-colH-1.6,2*halfW,3.2,lit?C.amber:C.rail);
  fitTxt(hov(wd)||hov(hw)
      ? "LEN "+LAT.len.toFixed(2)+" m  H/D "+D.hd.toFixed(2)+
        "  RIM "+LAT.reflR+"  LID "+LAT.reflT+"  FLOOR "+LAT.reflB
      : "ELEVATION / DRAG TOP, PAINT FACES",
    gx,gy+gh+11,gw,{size:6.5,sp:.3,color:hov(wd)||hov(hw)?C.amber:C.ink2});
}
const LATSECTION_TIP="The core in ELEVATION, where the plan is the core looking down. Everything vertical is drawn here: how tall the fuel column is, and how many cells of reflector are packed on the rim, the lid and the floor. Use the LENGTH pen and drag the top of the column; use the REFLECTOR pen and click a cell outside a face to pack it out to there, SHIFT to lift it back. Core H/D is what the two canvases make between them.";
const LATPEN_SEC=[
  ["REFLECTOR","refl",
   "Pack reflector onto a face of the core, in the section. Click the cell you want the band to reach and the face is filled out to it; hold SHIFT to take a cell back off. One cell is worth most of what a reflector has to give and the two after it are diminishing returns - but every one of them is weighed on the mass budget."],
  ["LENGTH","len",
   "Drag the top of the fuel column to set the active length. Against the diameter the plan revolves to, this is the core's H/D - and a tall narrow core leaks harder at both ends while a squat one leaks at the rim."],
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
  ["MODERATOR BLOCKS",()=>String(latModCount()),
   "How many slots you packed with solid moderator instead of fuel. They make no power and they are on the mass budget, and in a helium or sodium core they are the only moderation there is."],
  ["ACTIVE LENGTH",()=>LAT.len.toFixed(2)+" m",
   "How tall the fuel column is. Drawn in the section with the LENGTH pen, not set here."],
  ["REFLECTOR CELLS",()=>LAT.reflR+" rim / "+LAT.reflT+" lid / "+LAT.reflB+" floor",
   "How many cells of reflector are packed on each face. Painted in the section with the REFLECTOR pen. Leave the floor bare and the flux is pushed upward - a real way to shape a core, and a real way to ruin one."],
  ["CORE MEAN EXCESS",()=>fuelBlend().excess.toFixed(0)+" pcm",
   "The excess reactivity of the loading, blended by fuel volume over the zones you painted. Zoning does not change this - it moves reactivity from one ring to another, which is what flattens peaking."],
  ["DELAYED FRACTION",()=>fuelBlend().beta.toFixed(0)+" pcm",
   "Beta for the core as loaded. Mixing MOX into a uranium core lands this between the two, and it is the distance to prompt criticality.",
   ()=>fuelBlend().beta<450?"var(--c-amber)":null],
  ["FUEL DAMAGE LIMIT",()=>fuelBlend().tdmg.toFixed(0)+" K",
   "Where the fuel starts taking damage. It is the WORST fuel in the core, not the average one: melt is a local event, so one zone of metallic fuel cannot hide behind four of ceramic."],
  ["MODERATION RATIO",()=>modRatio().toFixed(2),
   "Moderating volume over fuel volume, counted off the drawing: the coolant between the assemblies plus any blocks you packed, each scaled by how well its own material slows a neutron. This one number decides prompt lifetime, the moderator coefficient, the void coefficient and how much enrichment it takes to go critical at all. Near zero is a FAST core."],
  ["PROMPT LIFETIME",()=>(derived().Lam*1e6).toFixed(2)+" us",
   "How long a neutron generation lasts, in microseconds. A thermal core is tens of microseconds and forgiving; a fast core is fractions of one, and every reactivity mistake arrives that much faster."],
  ["VOID COEFFICIENT",()=>derived().aV.toFixed(0)+" pcm",
   "What steam in the core is worth. Negative means voiding shuts the reactor down. Positive means voiding ADDS power, and nothing in the code decides that - it falls out of whether the coolant is the moderator or only an absorber sitting in somebody else's moderator.",
   ()=>derived().aV>0?"var(--c-amber)":null],
  ["MODERATOR COEFF",()=>derived().aM.toFixed(0)+" pcm/K",
   "What heating the coolant is worth. It is the negative feedback that makes the plant follow load by itself, and it is only as strong as the share of the moderation the coolant actually provides."],
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
        const q=block.items.map((_,i)=>massWith(block.key,block.base+i));
        const lo=Math.min(...q);
        ol.set(a.get()-block.base, q.map(v=>v-lo));
      }};
    }
    case "segsel": {
      const a=blockAcc(block.key);
      const root=KIT.el("div","db-block");
      const r=KIT.rule(block.title); root.appendChild(r.el); KIT.tip(r.el,block.title,block.tip);
      const ss=KIT.segSel(block.labels,{onSelect:i=>a.set(block.base+i)});
      root.appendChild(ss.el);
      return {el:root,sync(){
        const q=block.labels.map((_,i)=>massWith(block.key,block.base+i));
        const lo=Math.min(...q);
        ss.set(a.get()-block.base, q.map(v=>v-lo));
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
    /* A MACHINE'S OWN QUANTITY, in its own units. A slider is still right for a
       genuine fraction of its own travel - a rod, a valve, a demand - so only
       "how big is this machine" comes here. It never clamps: the SUGGEST
       affordance fills the field with a value matched to the rest of the
       design, and the designer is free to ignore it. */
    case "num": {
      const a=blockAcc(block.key);
      const root=KIT.el("div","db-block");
      const r=KIT.rule(block.title); root.appendChild(r.el); KIT.tip(r.el,block.title,block.tip);
      const n=KIT.numInput({unit:block.unit,dp:block.dp,tip:block.tip,title:block.title,
        suggest:block.suggest, onChange:v=>a.set(v)});
      root.appendChild(n.el);
      const mass=KIT.el("span","kit-sliderrow-mass"); root.appendChild(mass);
      return {el:root,sync(b){
        KIT.show(root,!(b.when&&!b.when()));
        n.set(a.get());
        KIT.setText(mass, b.massFn ? b.massFn(a.get()).toFixed(0)+" t" : "");
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
      // a GRID, not a wrapping flex row: every preset is one column wide, so a
      // row that wraps leaves the odd ones the same size as the rest
      const cells=KIT.el("div","db-bulkrow-btns");
      for(const it of block.items){
        const b=KIT.button(it.name,{size:6.5,onClick:it.fn});
        KIT.tip(b.el,it.name,it.tip);
        cells.appendChild(b.el);
      }
      root.appendChild(cells);
      return {el:root,sync(){}};
    }
    case "rule": {
      const r=KIT.rule(block.title);
      if(block.tip) KIT.tip(r.el,block.title,block.tip);
      return {el:r.el,sync(){}};
    }
    // block.pen names which surface's pen this bar sets, and the bar stands
    // directly over that surface's canvas
    case "lattools": {
      const pen=block.pen, root=KIT.el("div","db-block");
      const r=KIT.rule(block.title); root.appendChild(r.el);
      KIT.tip(r.el,block.title,block.tip);
      const row=KIT.el("div","db-toolrow");
      /* PICKING A PEN CHANGES NO DESIGN, so dbRailSync()'s signature gate never
         reaches this block's sync() - the bar stayed lit on the last pen until
         something was actually drawn. The click lights its own button. */
      const lit=()=>{
        if(!block.tools.some(t=>t[1]===LATPEN[pen])) LATPEN[pen]=block.tools[0][1];
        btns.forEach(o=>o.b.set({on:LATPEN[pen]===o.k}));
        const showBank=LATPEN[pen]==="rod";
        KIT.show(bankRow,showBank);
        if(showBank) bankBtns.forEach((bt,i)=>bt.set({on:LATPEN.bank===i}));
      };
      const btns=block.tools.map(t=>{
        const b=KIT.button(t[0],{size:7,onClick:()=>{ LATPEN[pen]=t[1]; lit(); }});
        KIT.tip(b.el,t[0]+" PEN",t[2]); row.appendChild(b.el); return {b,k:t[1]};
      });
      root.appendChild(row);
      const bankRow=KIT.el("div","db-bankrow");
      const bankBtns=[0,1,2,3].map(b=>{
        const bt=KIT.button("BANK "+(b+1),{size:6.5,onClick:()=>{ LATPEN.bank=b; lit(); }});
        KIT.tip(bt.el,"BANK "+(b+1),"Which bank the clusters you draw belong to. Draw clusters at different radii into different banks and you can lean the flux; put them all in one and there is nothing to lean against.");
        bankRow.appendChild(bt.el); return bt;
      });
      root.appendChild(bankRow);
      return {el:root,sync:lit};
    }
    case "latplan": {
      const cv2=KIT.el("canvas","db-latplan-canvas");
      KIT.tip(cv2,"FUEL LATTICE / QUARTER PLAN",LATPLAN_TIP);
      hostForward(cv2);
      return {el:cv2,sync(){}};   // painted by dbSync() via hostPaint(), not here
    }
    case "latsection": {
      const cv2=KIT.el("canvas","db-latsection-canvas");
      KIT.tip(cv2,"THE CORE / SECTION",LATSECTION_TIP);
      hostForward(cv2);
      return {el:cv2,sync(){}};
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
function dbRailBuild(rail,vitals,watch){
  rail.innerHTML=""; vitals.innerHTML="";
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
  /* ══ AND THE RUN YOU PICKED, IN THE SAME WELL ══
     A run is not a part, so it gets no per-panel well of its own in the loop
     above. It gets the foot of PIPES: the list of what is joined up and the
     size of the one you picked out of it are the same subject, and two wells
     put the answer a scroll away from the question. Picked from a row here or
     by clicking the pipe on the drawing; both write `sel`, which is the same
     selection every machine already uses. */
  const pipes=KIT.well({title:"PIPES"}); rail.appendChild(pipes.el);
  const pipeList=KIT.el("div","db-pipe-list"); pipes.body.appendChild(pipeList);
  const runBody=KIT.el("div","db-panel-body"); pipes.body.appendChild(runBody);
  watch.add(pipes.el);
  /* the verdict on the design stands over the plant it judges, not at the foot
     of a rail the player has to scroll past every machine to reach */
  const results=KIT.well({title:"RESULTS"}); vitals.appendChild(results.el);
  const review=KIT.well({title:"DESIGN REVIEW"}); vitals.appendChild(review.el);
  return {panels,results,review,pipesWell:pipes,pipeList,runBody};
}
/* ══ WHAT IS ACTUALLY CONNECTED ══
   One row per traced connection - from, to, and how long it is - plus a line
   for every pipe cell that reaches nothing. This is the whole point of tracing
   rather than authoring: "is this joined up" becomes a question the bench can
   answer and print, instead of a thing the player has to read off the picture. */
function pipeRailSync(body,wellEl){
  const M=pipeMap();
  /* THE SIZE IS IN THE LIST, not only on the panel under it: bore and wall are
     what the player sets, and one run at a time on a panel is no way to see
     that one leg is half the width of the one it feeds. Off the run itself
     (runOfKey), so a row and the panel below cannot disagree. */
  /* the ends read in the run's OWN colour, off the same table the drawing
     strokes it with, so the list and the picture cannot name two different
     fluids for one run */
  const PC=pipeColours(null);
  const rows=M.conns.map(c=>{
    const a=partOf(c.a), b=partOf(c.b), r=runOfKey(c.key);
    return [(pipeLabel(c.k,c.key)||"PIPE"),
            (a?partName(a):c.a)+" ⇒ "+(b?partName(b):c.b),
            c.L.toFixed(1), r?Math.round(runBoreMm(r)):"-",
            r?runWallMm(r).toFixed(0):"-", c.key, pipeCol(PC,c.k)];
  });
  const loose=M.orphan.length, dead=M.dangling.filter(d=>d.cells.length).length;
  // sel is in the signature: a row lights when it is the picked one, so the
  // list has to rebuild when the pick moves
  const sig=rows.map(r=>r.join("/")).join("|")+"|"+loose+"|"+dead+"|"+sel;
  if(body._sig===sig) return;
  body._sig=sig; body.innerHTML=""; body._rows={};
  if(!rows.length){ const p=KIT.el("p","db-review-ok");
    p.textContent="NOTHING IS PIPED UP"; body.appendChild(p); }
  /* ONE GRID, so a column is a column. Five spans per row against one template
     (db-pipe-row, plant-screens.css) - the head carries the units, so no cell
     below has to repeat them. */
  const cells=(row,vals,endsCol)=>{
    const CLS=["db-pipe-kind","db-pipe-ends","db-pipe-len","db-pipe-bore","db-pipe-wall"];
    vals.forEach((v,i)=>{ const s=KIT.el("span",CLS[i]); s.textContent=v;
      if(i===1 && endsCol) s.style.color=endsCol;
      row.appendChild(s); });
  };
  if(rows.length){
    const head=KIT.el("div","db-pipe-row db-pipe-head");
    cells(head,["RUN","FROM ⇒ TO","m","BORE mm","WALL mm"]);
    body.appendChild(head);
  }
  for(const r of rows){
    const row=KIT.el("div","db-pipe-row"+(sel===r[5]?" on":""));
    cells(row,[r[0],r[1],r[2],r[3],r[4]],r[6]);
    body.appendChild(row); body._rows[r[5]]=row;
    /* THE ROW IS THE PICK - the way at a run that is hard to click on a
       crowded drawing. Three things, and the third is why it never worked:
       railBlank() (inspector.js) drops the selection on any rail click that
       does not land in the well whose _pickId IS the selection, and it BUBBLES
       - so this handler set `sel` and railBlank cleared it again a moment
       later, every time. PIPES is the panel for whichever run is picked, so it
       carries that run as its _pickId, set here rather than at the next sync
       because railBlank asks before any sync runs.
       railPickId is the same flag a panel's own title bar sets: a pick made IN
       the rail must not scroll the rail out from under the hand that made it. */
    row.addEventListener("click",()=>{
      sel=r[5]; railPickId=r[5];
      if(wellEl) wellEl._pickId=r[5];
      uiDirty(); });
    KIT.tip(row,r[0],"Click to select this run. Its bore and its wall are at the foot of this panel, and it lights up on the drawing.");
  }
  const warn=t=>{ const row=KIT.el("div","db-review-row warn");
    const tag=KIT.el("span","db-review-tag"); tag.textContent="WARN";
    const s=KIT.el("span"); s.textContent=t; row.append(tag,s); body.appendChild(row); };
  if(dead)  warn(dead+" pipe run"+(dead===1?"":"s")+" reach a port at one end and nothing at the other.");
  if(loose) warn(loose+" pipe cell"+(loose===1?"":"s")+" belong to no run at all.");
}
/* the rail scrolls to a newly selected panel ONCE, on the frame sel changes -
   every frame would fight the user's own scrolling */
let dbLastSel=null, dbPanelSig=null;
/* PRICING AN OPTION WRITES THE DESIGN, so an ungated sync is not merely a
   wasted read. massWith() sets D[key] to ask what the plant would weigh, and
   D.cool/D.fuel/D.foll are in corePredict()'s cache key while __abs re-runs
   latRevolve() - so every option list burned a full core solve per option,
   every frame, 5.6 ms of it on the reactor panel alone. designSig() is the
   signature five other caches here already key on, and costs 0.017 ms. */
function dbRailSync(state){
  // see railSelfPick() - a pick made on a panel's own title bar does not scroll
  const moved = sel!==dbLastSel && !railSelfPick(); dbLastSel=sel;
  const sig=designSig()+"|"+sel, fresh=sig!==dbPanelSig; dbPanelSig=sig;
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
    const seen=railSeen(h.well.el), shown=seen&&!h.seen; h.seen=seen;
    if(!seen && !(on&&moved)) continue;
    // scrolling is not a design change, so a panel arriving on screen has to
    // ask for its first sync itself - the signature cannot know it moved
    if(!fresh && !shown) continue;
    const cur=paramsFor(partOf(h.p.id)||h.p);
    dbPanelSync(h.body,cur);
  }
  if(!fresh) return;
  pipeRailSync(state.pipeList,state.pipesWell.el);
  /* AND THE WELL OWNS THE PICKED RUN. Same reason as the row's own handler:
     railBlank() clears a selection whose well does not claim it, so working
     the BORE field on a run picked off the drawing would have dropped the run
     the field belongs to. */
  state.pipesWell.el._pickId = isRunKey(sel) ? sel : null;
  /* THE SELECTED RUN'S OWN PANEL. Its own two number fields go through
     dbPanelSync() exactly as a machine's do, so a run is configured with the
     same widgets, the same SUGGEST and the same mass hint as everything else
     on the board. Nothing picked is a real state and says so. */
  { const r = isRunKey(sel) ? sel : null;
    dbPanelSync(state.runBody, r
      ? [{kind:"rule",title:pipeLabel(pipeMap().byKey[r].k, r)||"PIPE RUN"}].concat(paramsForRun(r))
      : [{kind:"note",text:"No run picked. Click a pipe on the drawing, or a row above, to set its bore and its wall."}]);
    // A PICK MADE ON THE DRAWING BRINGS UP THE PANEL, the same way a machine's
    // does - the whole well, "start", not the row inside it: the fields the
    // pick was made to reach are at its FOOT, and scrolling the row to the top
    // leaves them below the fold. A pick made in the rail scrolls nothing
    // (railPickId, on the row's own click).
    if(r && moved) KIT.reveal(state.pipesWell.el,"start"); }
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
        const row=KIT.el("div","db-review-row "+(warnRed(w)?"red":"warn"));
        const tag=KIT.el("span","db-review-tag"); tag.textContent=warnHard(w)?"BLOCK":"WARN";
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
  /* ONE SWITCH PER TOOL, over the top-left of the plant it addresses. It lived
     at the bottom of the rail, under every machine panel, which on a tall
     plant is off-screen - a tool nobody can find is a tool the bench does not
     have. Each key manages its own state off the TOOL table, so there is
     nothing here for a per-frame sync to keep in step with. */
  const tools=KIT.el("div","db-tools"), btns=[];
  for(const t of TOOLS.filter(t=>t.sc==="design")){
    const b=KIT.button(t.label,{size:8, sunk:true, on:TOOL.active===t.id,
      onClick:()=>{ TOOL.active=t.id; for(const q of btns) q.b.set({on:TOOL.active===q.id}); }});
    b.el.classList.add("tool-switch");
    KIT.tip(b.el, t.label, t.tip);
    tools.appendChild(b.el); btns.push({id:t.id,b});
  }
  /* WHOLE PLANTS, over the plant they replace. Not a panel row: a preset
     rebuilds the loops, the tanks and every run, so it is about the bench and
     not about whatever part happens to be selected. Designer-only for free -
     db-head lives inside #scr-design. */
  const pres=KIT.el("div","db-bulkrow");
  const plab=KIT.el("span","db-bulkrow-lab"); plab.textContent="PLANT";
  const pbtns=KIT.el("div","db-bulkrow-btns");
  // first, because it is what every preset is laid over
  const rst=KIT.button("RESET",{size:8,onClick:()=>{ plantClear(); urlPreset(null); sel=null; uiDirty(); }});
  KIT.tip(rst.el,"RESET","Takes the whole ship off the grid: every machine, tank, fitting, port and pipe, and the core back to the stock lattice. What is left is the blank grid a new design starts from, and it still commissions.");
  pbtns.appendChild(rst.el);
  PLANTPRE.forEach((pr,i)=>{
    const b=KIT.button(pr[0],{size:8,onClick:()=>{ plantPreset(i); urlPreset(i); sel=roleId("core"); uiDirty(); }});
    KIT.tip(b.el,pr[0],pr[2]);
    pbtns.appendChild(b.el);
  });
  pres.append(plab,pbtns);
  head.append(tools,pres);
  const rail=KIT.el("div","db-rail");
  railBlank(rail);
  const vitals=KIT.el("div","db-vitals");
  root.append(head,vitals,rail);
  mount.appendChild(root);
  return {root,head,rail,vitals,state:null,watch:null};
}
function dbSync(){
  if(!DB) return;
  if(DB.rail._layFit!==LAY) {
    if(DB.watch) DB.watch.free();
    DB.watch=railWatch(DB.rail);
    DB.state=dbRailBuild(DB.rail,DB.vitals,DB.watch); DB.rail._layFit=LAY;
    dbPanelSig=null;                // new DOM, so the old signature says nothing about it
  }
  dbRailSync(DB.state);
  /* the fuel lattice plan is genuinely graphical and stays canvas - but its own
     canvas, because the rail it lives in is opaque over #cv. See hostPaint(). */
  document.querySelectorAll("#scr-design .db-latplan-canvas").forEach(cv2=>hostPaint(cv2,latPlan));
  document.querySelectorAll("#scr-design .db-latsection-canvas").forEach(cv2=>hostPaint(cv2,latSection));
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
  // the verdict panel is opaque, so measure it on the left the way drawOperate()
  // measures the vitals panel
  const vitBox = DB? hostRect(DB.vitals) : null;
  const vx = vitBox ? vitBox.x+vitBox.w : 0;
  const vw = (railBox ? Math.max(200, railBox.x) : W) - vx;
  drawPlant(vy,null,vh,vx,vw);
  zoomKeySync(DB&&DB.root);
  { const st=DB&&DB.state;
    const h = st && st.panels.find(o=>o.ids.includes(sel));
    if(h) leaderLine(h.well.el,DB.rail); }
}
