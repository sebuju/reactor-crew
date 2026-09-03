"use strict";
/* plant view layer registry - see .claude/CLAUDE.md

   ═══════════ THE TABLE ═══════════
   One entry, one layer - the same shape AUTOSYS in step.js gives a bypass:
   name a thing once, and the draw pass, the panel switch and (later) the
   annunciator are all generated off this table instead of re-typed at every
   call site that wants one.

   `seam` is not z-order trivia, it is a real question asked once per layer,
   answered at the call sites in plant.js:
     "under" - drawn AFTER pipeFlow() and BEFORE the component loop, so a
       layer paints over the pipes and under the machines. That is exactly
       the room a repair party can walk through: you cannot survey the
       inside of a vessel, so the space a layer is allowed to cover is the
       space a body could stand in. It is also the one seam that never lands
       on a value tag, a control strip or a bypass row, because every one of
       those is drawn by the component loop that comes after it.
     "over" - drawn AFTER the component loop and BEFORE pipeFitMarks(), for
       anything that annotates one component rather than the room around it
       (a badge, a ring, a highlight pinned to a machine). Painted over the
       machine on purpose, the way a gauge is bolted to the outside of the
       thing it reads.

   `data` names a memo key, not a layer. The four radiation layers below all
   name the same `data` id ("rad"), so the expensive half of the work -
   solving the field - runs ONCE a frame no matter how many of them are on.
   See layerData().

   `live` marks a layer that only means anything against a running plant - it
   needs S, and the bench passes L===null. Skipped there exactly the way
   pipeFlow() already is: a reading with no plant behind it is
   not an empty state, it is a lie dressed as data.

   THE CONTRACT - rules, not prose, because a rule is checkable and a mood is not:
     - A layer DRAWS. It never writes S, D, P or LAY. It is a view of the
       plant, never a fact about one. Something that needs to change the
       plant needs act(), not a draw callback with a side effect smuggled in.
     - Layer on/off lives on THIS table and nowhere else.
         Not in S - it is not sim state, and if it were it would ride the
         record/replay tape in src/sim/record.js, so replaying a run would
         also replay which displays a spectator had switched on.
         Not in D - it is not a design parameter, and every toggle would
         churn designSig() as though turning a display on redesigned the
         plant.
         Not in ACT - it is not a player action ON the plant; it never
         reaches step() and step() never asks about it.
       In memory only. It resets on reload, the same as VIEW's pan and zoom -
       nobody expects a scroll position to survive a refresh either. Do NOT
       wire it to src/data/store.js.
     - ctx.save()/restore() around every draw() call is the PLUMBING's job in
       layerPass(), never the layer's. A layer that sets an alpha or a clip
       and forgets to undo it would corrupt whatever draws after it - and
       "what draws after it" is a fact about LAYER_ORDER that the layer
       itself has no business knowing.
*/


/* one solve, shared by all four - see the `data` note above. Live reads
   P.radK, frozen at commissioning by layoutMetrics(): a commissioned plant is
   welded down, its shielding does not move, so the kernel is a build-time
   fact and re-solving it every frame would be paying for a rebuild that can
   never happen. The bench has no P yet (nothing has been commissioned), and
   its whole point is showing the arrangement changing under the player's own
   drag, so it calls radGeom() straight off LAY.parts instead. */
const LAYER_DATA={
  rad: L => { const K = L ? P.radK : radGeom(), g = occupied(null);
              return {f:radSolve(K, radSrc(L)), g, K, cells:partyCells()}; },
  /* A LAYER MUST NOT SOLVE, and pressure is the trap in that rule. The
     network's factorisation is cached onto P.net.Af by netFactored(), so a
     draw callback that asked the solve for a pressure would be a layer
     writing to P - and audit-geometry scans the view files for `S.` writes
     only, so it would sail through. drawPlant() refreshes the field once a
     frame (pipeFieldRefresh(), pipes.js), exactly the way it already does for
     pipeDrop, and this hands the layers what is already there.
     PRESSURE and SUBCOOLING share this one id on purpose: `data` is a memo
     key, so two layers naming it cost one refresh, not two - the same reason
     the four radiation layers cost one field. */
  press: L => ({runs: L ? pipeRuns(L) : pipeNetwork()}),
  /* THE FIELD IS ALREADY THERE. Unlike `rad`, which solves a kernel, and
     unlike `press`, which reads a refresh, the room field is STATE (s.roomT)
     - the tick integrated it and this hands over the array. That is the
     difference the two files are built around, and it is why this row is the
     cheapest one in the table rather than the dearest. */
  room: L => ({T: L ? L.roomT : null, g: occupied(null)}),
};

/* One line per run, in the run's OWN slot of the stack pipes.js lays out
   (pipeStackLine): the anchor is pipeRunAnchor(), the same point the flow
   meter asks for, so a run's three readings are one block of text rather than
   three instruments scattered along a pipe. `over` puts these under the
   fitting glyphs and the deferred value tags, which draw after the over pass.

   THE SLOT IS PER LAYER and it is fixed: pressure is always the middle line
   and subcooling always the bottom one, whether or not the other two are
   switched on. A line that moved up when a neighbour was switched off would
   be a reading you have to find again every time you change what is on. */
function layerRunLine(runs, slot, val, col, fmt){
  /* NOTHING STANDS DOWN. This used to run its own private clash test and drop
     the second of two overlapping readings - a VIEW declutter that hid a
     number the solve had already worked out, and it did it silently, so the
     only way to know a pipe had a pressure was to hover it. Placement is one
     frame-scoped allocator now (pipeAnchors(), pipes.js): every run is offered
     several points along its own polyline and takes the first clear of the
     machines and of every stack already placed. The three quantities on one
     run still share one point, which is the property that mattered.
     What IS still refused is a value that does not exist: null, undefined or
     non-finite draws nothing, because a missing reading has to read as
     missing. */
  const anch=pipeAnchors(runs);
  for(const r of runs){
    if(!pipeHovShow(r.key)) continue;   // one run in focus while the pointer is on it - pipeHovResolve() (pipes.js)
    const v=val(r);
    if(v===null||v===undefined||!isFinite(v)) continue;
    const a=anch[r.key];
    if(!a) continue;
    pipeStackLine(a.x,a.y,slot,fmt(v),col(v));
  }
}
/* Absolute, in MPa, on the same 1.35x design-point scale everything else on
   this plant reads pressure against. Blue is well under the design point,
   amber is over it, red is where the relief valve is about to talk. */
const pressCol = v => { const p0=Math.max(0.1,P.P0);
  /* AT OR BELOW ZERO ABSOLUTE THERE IS NO LIQUID LEFT TO BE AT A PRESSURE.
     Red at both ends, because a line that cannot hold its own column up is as
     broken as one about to lift a relief valve. */
  return v<=0?C.red : v>=p0*1.06?C.red : v>=p0?C.amber : v<p0*0.55?C.blue : C.cyan; };
/* A CONDENSER UNDER VACUUM IS NOT ZERO. Two decimals of MPa is the right
   precision for a 15 MPa loop and prints the whole secondary low-pressure end
   as "0.00", which reads as a missing measurement rather than a small one - so
   below a tenth of an MPa the same number is printed in kPa. One quantity, one
   place, two units, the way any gauge with a useful range is marked. */
const pressFmt = v => Math.abs(v)<0.1 ? (v*1000).toFixed(0)+" kPa" : v.toFixed(2)+" MPa";
const pressLayer = (d,L) => layerRunLine(d.runs, 1, r => pipeRunP(r,L), pressCol, pressFmt);
/* Coloured by MARGIN, not by value: what matters about subcooling is how close
   to zero it is, because zero is where the water in that pipe stops being
   water - which is where a pump loses its head and where the loop stops
   circulating. */
const subcCol = v => v<=0 ? C.red : v<15 ? C.amber : C.blue;
const subcLayer = (d,L) => layerRunLine(d.runs, 2, r => pipeRunSc(r,L), subcCol,
                                        v=>v.toFixed(0)+" K sub");

/* THE FOUR RADIATION LAYERS. See src/render/rad.js for the draw functions and
   the zone table they share - this table only says where each one goes down
   and what it starts as.

   Defaults: the survey (radz), the repair map (radp) and the triage numbers
   (radc) are what a crew glances at on the way into a job, so they start on.
   CELL DOSE (radn) prints a number in every one of 144 cells - useful when
   you want the exact figure, dense enough that it should be a deliberate
   ask rather than the first thing on screen, so it starts off.

   `live:false` on all four, and deliberately: unlike a pipe flow or a gauge
   reading, a dose rate is a real answer even with no plant commissioned -
   layoutMetrics() already asks radSrc(null) for the bench's own dose warning,
   "what does this arrangement shine like at rating" is a design question with
   a design answer, and the whole point of showing it on the bench is to see
   the shape change under a dragged shield BEFORE committing to it.

   EVERY RADIATION LAYER STARTS OFF, and every PIPE layer starts on. They are
   two different kinds of question. A radiation survey is asked OF the plant -
   nobody asked it, it paints over the machines, and answering it unbidden
   makes the first look at the plant a look at an overlay. The three pipe
   instruments are not an overlay at all: they are the gauges on the pipework,
   flow, pressure and subcooling, one per run and each in its own place on the
   run. A plant drawn with no instruments on it is not a cleaner picture, it is
   a plant you cannot read - and the flow meters were never a layer in the
   first place, they were simply always drawn. */
const LAYERS={
  radz:{group:"RADIATION", label:"RAD ZONES",    seam:"under", data:"rad", live:false, on:false,
        draw:radZones,
        tip:"Area dose rate as a survey map: five bands from CLEAR to EXCLUSION, hard edges between them. Turn this on to see the shape of the hazard, not just a number for it. It ships OFF, and that is stated here rather than only in the table above: a radiation survey is asked OF the plant, and answering it unbidden would make the first look at the machines a look at an overlay."},
  radn:{group:"RADIATION", label:"CELL DOSE",    seam:"under", data:"rad", live:false, on:false,
        draw:radNumbers,
        tip:"The dose rate printed in every grid cell, same units the bench already quotes. 144 numbers is a lot of ink for a glance - ask for it when you need the exact figure rather than the band. It ships OFF, and that is stated here rather than only in the table above: a radiation survey is asked OF the plant, and answering it unbidden would make the first look at the machines a look at an overlay."},
  radp:{group:"RADIATION", label:"REPAIR CELLS", seam:"under", data:"rad", live:false, on:false,
        draw:radCells,
        tip:"Every cell a repair party could actually stand in to work a job. Turn this on before you send anyone anywhere - it is the answer to \"where can I put a body\", not just \"how hot is it here\". It ships OFF, and that is stated here rather than only in the table above: a radiation survey is asked OF the plant, and answering it unbidden would make the first look at the machines a look at an overlay."},
  radc:{group:"RADIATION", label:"PART DOSE",    seam:"over",  data:"rad", live:false, on:false,
        draw:radPart,
        tip:"What each machine costs to reach, from the coldest free cell beside it - the triage number - the figure you read before deciding who goes to fix what. It ships OFF, and that is stated here rather than only in the table above: a radiation survey is asked OF the plant, and answering it unbidden would make the first look at the machines a look at an overlay."},
  /* live:true, unlike the four radiation layers above. A dose rate is a real
     answer on an uncommissioned arrangement; a pressure is not - there is no
     plant to have one yet, and inventing one would be a lie dressed as data. */
  press:{group:"PLUMBING", label:"PRESSURE",    seam:"over",  data:"press", live:true, on:false,
        draw:pressLayer,
        tip:"The pressure in every run, in MPa. Pressure is a place, not a number: it is highest at a pump's discharge, lowest at its suction, and it falls across every metre of pipe and every throttle in between. Turn this on to see where the head your pumps make actually goes."},
  subc: {group:"PLUMBING", label:"SUBCOOLING",  seam:"over",  data:"press", live:true, on:false,
        draw:subcLayer,
        tip:"How far the water in each run is from boiling AT ITS OWN PRESSURE. Zero is where it flashes: a pump whose suction reads zero has nothing solid to pump and loses its head, and the highest point of the loop is where it happens first. This is the picture behind the rule that the pressurizer belongs at the top."},
  /* THE FIVE ROOM LAYERS - ONE PER FIELD ON S, and that is the rule rather
     than a count: s.roomT, s.roomH2, s.roomO2 and s.roomP are all places, so
     all four are askable, and PART TEMP is the per-machine reading off the
     first of them. src/render/room.js has the draw functions and the band
     tables; this table only says where each goes down and what it starts as.
     `live:true` on all five, unlike the four radiation layers: a dose rate is
     a real answer on an uncommissioned arrangement and a room temperature is
     not, because a room is only hot once machines are running in it. The
     bench skips them.
     FOUR OF THE FIVE SHIP OFF, and the one that does not is the one that draws
     NOTHING on a healthy plant. That is the whole test, and it is a better one
     than "a survey is asked OF the plant": AIR TEMP, OXYGEN and PART TEMP
     paint every cell or every box the moment they are on, so leaving them on
     would make the first look at the machines a look at an overlay - the same
     argument every radiation layer makes. H2 CLOUD paints nothing at all until
     there is hydrogen in the room, and that is an event you cannot answer if
     you find out about it by remembering to ask: a layer that is silent until
     it matters is an ANNUNCIATOR, and an annunciator is not switched on when
     you want the alarm.
     BLAST SHIPPED ON UNDER THAT SAME RULE AND HAS LEFT IT, because the reading
     stopped being an event. It is the high-water mark now, so it paints for
     the rest of the run over every cell that has ever been hurt - which is a
     SURVEY of past damage, not an annunciator, and a survey is asked for. */
  roomz:{group:"COMPARTMENT", label:"AIR TEMP",    seam:"under", data:"room", live:true, on:false,
        draw:roomZones,
        tip:"Air temperature in every cell of the compartment, as a survey map: five bands from AMBIENT to UNTENABLE. Heat is a place. It comes off every hot surface, it comes in a flood out of anything venting steam into the room instead of into a tank, a machine is a WALL to it, and the only sink is the hull - so a compact plant runs hotter than a spread-out one. The band edges are the machines' own limits, not round numbers."},
  roomh:{group:"COMPARTMENT", label:"H2 CLOUD",   seam:"under", data:"room", live:true, on:true,
        draw:roomH2Layer,
        tip:"Where the hydrogen off the cladding has ended up. It leaves the primary with the steam, at whatever hole the steam left through, and then it is a gas fourteen times lighter than air, collecting under the deckhead of a SEALED compartment - the only thing that takes it out again is the ventilation set, or a fire. VIOLET is the gas, and the hard violet line is the 4 % flammable limit: inside it, the room is a bomb waiting for something at 773 K. Amber and moving is a flame front, and how fast it crosses a cell is a property of the mixture. No figure is printed - point at a cell for the reading. This is the Fukushima sequence, drawn."},
  roomo:{group:"COMPARTMENT", label:"OXYGEN",     seam:"under", data:"room", live:true, on:false,
        draw:roomO2Layer,
        tip:"What is left in each cell to burn WITH. It draws DEPLETION only - a cell holding what air actually holds prints nothing, because the question is where a fire has eaten its own air. Blue and labelled is under 5% by volume, the limiting oxygen concentration: nothing ignites there whatever else is in it, which is how a sealed corner smothers its own fire and leaves the hydrogen unburnt."},
  roomp:{group:"COMPARTMENT", label:"BLAST",      seam:"under", data:"room", live:true, on:false,
        draw:roomPLayer,
        tip:"What a blast did to each cell, and it STAYS. Overpressure is banded against the machines' own limits rather than round numbers: 20 kPa takes a cabinet, 70 heavy rotating plant, 120 a pipe and 200 a pressure vessel - blue, green, amber, red, bright red. The compartment relieves itself in about half a second, so what is drawn is the HIGH-WATER MARK: the worst each cell has ever seen, never fading, dark with soot in proportion to it and coloured by what that pressure was enough to break. A compartment that has been blown apart three times looks like it, and stays that way until something cleans it. The cells the wave is in right now pulse. No figure is printed - point at a cell for the reading."},
  roomc:{group:"COMPARTMENT", label:"PART TEMP",  seam:"over",  data:"room", live:true, on:false,
        draw:roomPart,
        tip:"What each machine is standing in, in kelvin, coloured against what THAT machine was built for. The room field says the compartment is hot; this says which box is about to be damaged by it. Structure - shielding, containment, the core catcher - prints nothing, because a room temperature is not how any of them fails."},
  /* The flow readings, and ONLY those. The pressurizer's dial used to ride
     this switch too and does not any more: a flow meter is one of three
     readings on a run and belongs on the same switch as the other two, while
     the dial is the only instrument the plant's own pressure has and is not on
     a run at all - so turning the pipe labels off blanked the one gauge with
     nothing standing in for it. pipeVessel() is drawn unconditionally by
     drawPlant(), at this exact seam. Not the break plumes either - those go
     down before the pass, because an effect is not an instrument. */
  flow: {group:"PLUMBING", label:"FLOW METERS", seam:"over",  data:null,    live:true, on:false,
        draw:(d,L)=>pipeMeters(pipeRuns(L),L),
        tip:"The top line of every run's readings: what that run is carrying, in kg/s. The figure goes amber and takes a minus sign when a run reverses, and red when it is being pushed past its rating. The pressurizer's own dial is not on this switch - it is the only gauge that plant pressure has, so it is always drawn."},
};
const LAYER_ORDER=Object.keys(LAYERS);

let layerCache={};
/* called once a frame, from drawPlant() - drops last frame's memo so a stale
   dose field, say, never survives into a frame where the plant has moved on.
   The cache is the whole mechanism: there is no frame COUNTER, because only
   one screen draws in a frame and "the memo was not cleared yet" is the only
   question layerData() ever needs to ask. */
function layerTick(){ layerCache={}; }

/* memoised per frame: the first layer naming a `data` id pays for it, every
   later one in the same frame gets the cached object back. */
function layerData(id, L){
  // `data:null` is a layer with nothing to share - it reads caches that were
  // already refreshed for the frame and computes nothing worth memoising
  if(!id) return null;
  return layerCache[id] || (layerCache[id]=LAYER_DATA[id](L));
}

/* the one place LAYER_ORDER is walked to draw. Called twice by drawPlant(),
   once per seam - see the two call sites there for why each is where it is. */
function layerPass(seam, L){
  for(const k of LAYER_ORDER){
    const l=LAYERS[k];
    /* A HOVERED RUN DRAWS ITS OWN READINGS WITH THE SWITCH OFF. The three
       PLUMBING rows are gauges on the pipework rather than a survey painted
       over it, so pointing at one pipe is enough to ask that pipe what it is
       doing. It puts NOTHING extra on the picture: pipeHovShow() (pipes.js)
       is already the filter, and it passes exactly the run under the pointer.
       The switch still decides what is drawn unasked, which is what a switch
       on this menu means. */
    if((!l.on && !(l.group==="PLUMBING" && pipeHov)) || l.seam!==seam || (l.live && !L)) continue;
    ctx.save();
    l.draw(layerData(l.data, L), L);
    ctx.restore();
  }
}

function layerToggle(k){ LAYERS[k].on=!LAYERS[k].on; }
/* ══ ONE MENU, HUNG OFF THE PLANT VIEW BESIDE THE ZOOM KEY ══
   Both screens call this from zoomKeySync() (render/plant.js) rather than
   hand-roll a button per layer, the same reason there is one AUTOSYS and one
   bypRow() rather than a copy per system. A layer with no switch here has no
   way to be turned off, so audit-dom.js counts exactly LAYER_ORDER.length of
   them on both screens.

   It lives over the plant and not on the rail because a layer paints the
   PLANT: the switch and the thing it switches are now the same glance, and
   neither rail has to be scrolled past every machine to reach one.

   The headings are read OFF the entries, in LAYER_ORDER, so a new layer joins
   its group by naming it - there is no second table of groups to keep in step
   with the first. */
function layerMenu(){
  const wrap=KIT.el("div","plant-layers");
  const menu=KIT.el("div","plant-layers-menu kit-hide");
  const key=KIT.button("LAYERS",{sunk:true});
  key.el.classList.add("plant-layers-key");
  KIT.tip(key.el,"LAYERS","Every overlay the plant view can draw, grouped by what it surveys. A layer is a view and never a fact: switching one on changes nothing about the plant, only what you are shown of it.");
  /* GROUPED BY GROUP, not by where the entry sits in LAYER_ORDER - that order
     is the DRAW order and FLOW METERS is last in it, so a single walk printed
     PLUMBING twice with the room layers between the halves. */
  for(const group of LAYER_ORDER.map(k=>LAYERS[k].group).filter((g,i,a)=>a.indexOf(g)===i)){
    menu.appendChild(KIT.rule(group).el);
    for(const k of LAYER_ORDER){
      const l=LAYERS[k];
      if(l.group!==group) continue;
      const b=KIT.button(l.label, {sunk:true, on:l.on,
        onClick:()=>{ layerToggle(k); b.set({on:l.on}); }});
      b.el.classList.add("layer-switch");
      KIT.tip(b.el, l.label, l.tip);
      menu.appendChild(b.el);
    }
  }
  /* ONE HANDLER OPENS AND SHUTS IT, and it is the document's, not the key's -
     the same idiom the context menu uses (shell.js). A press anywhere but
     inside the menu shuts it, including on the key, so the plant under it
     never loses the first click aimed past it. A key with its own click
     handler could not do this: the press would shut the menu and the click
     would reopen it. Captured, because the plant is a canvas and swallows
     presses that land on it. */
  document.addEventListener("pointerdown", e => {
    if(menu.contains(e.target)) return;
    const open=key.el.contains(e.target)&&menu.classList.contains("kit-hide");
    KIT.show(menu,open); key.set({on:open}); }, true);
  wrap.append(key.el,menu);
  return {el:wrap};
}
