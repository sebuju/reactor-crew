"use strict";
// `data` is a memo key, not a layer: every entry naming one shares a single per-frame solve
const LAYER_DATA={
  rad: L => { const K = L ? P.radK : radGeom(), g = occupied(null);
              return {f:radSolve(K, radSrc(L)), g, K, cells:partyCells()}; },
  // reads the field drawPlant() already refreshed; a layer may not run the solve itself
  press: L => ({runs: L ? pipeRuns(L) : pipeNetwork()}),
  // machines only: a compartment layer is what is IN the room, and it lies over the pipework and the walls
  room: L => ({T: L ? L.roomT : null, g: occupied(null, {pipes:false, ports:false, mat:false})}),
};

// slot is fixed per layer, so a reading does not move when a neighbouring layer is switched off
function layerRunLine(runs, slot, val, col, fmt){
  const anch=pipeAnchors(runs);
  for(const r of runs){
    if(!pipeHovShow(r.key)) continue;
    const v=val(r);
    if(v===null||v===undefined||!isFinite(v)) continue;
    const a=anch[r.key];
    if(!a) continue;
    pipeStackLine(a.x,a.y,slot,fmt(v),col(v));
  }
}
// red at both ends: a line that cannot hold its own column up is as broken as one about to lift a relief
const pressCol = v => { const p0=Math.max(0.1,P.P0);
  return v<=0?C.red : v>=p0*1.06?C.red : v>=p0?C.amber : v<p0*0.55?C.blue : C.cyan; };
// two decimals of MPa prints a condenser under vacuum as "0.00", which reads as a missing measurement
const pressFmt = v => Math.abs(v)<0.1 ? (v*1000).toFixed(0)+" kPa" : v.toFixed(2)+" MPa";
const pressLayer = (d,L) => layerRunLine(d.runs, 1, r => pipeRunP(r,L), pressCol, pressFmt);
// coloured by margin, not value: zero is where a pump loses its head
const subcCol = v => v<=0 ? C.red : v<15 ? C.amber : C.blue;
const subcLayer = (d,L) => layerRunLine(d.runs, 3, r => pipeRunSc(r,L), subcCol,
                                        v=>v.toFixed(0)+" K sub");
const tempLayer = (d,L) => layerRunLine(d.runs, 2, r => pipeRunT(r,L), ()=>C.ink,
                                        v=>v.toFixed(0)+" K");
const holdLayer = (d,L) => {
  if(LAYERS.hold.on || pipeHov) layerRunLine(d.runs, 4, r => pipeRunHoldKg(r,L), ()=>C.ink, holdFmt);
  pipeHoldMarks(L);
};

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
  // live:true unlike the rad rows: a dose rate is a real answer on an uncommissioned arrangement, a pressure is not
  press:{group:"PLUMBING", label:"PRESSURE",    seam:"over",  data:"press", live:true, on:false,
        draw:pressLayer,
        tip:"The pressure in every run, in MPa. Pressure is a place, not a number: it is highest at a pump's discharge, lowest at its suction, and it falls across every metre of pipe and every throttle in between. Turn this on to see where the head your pumps make actually goes."},
  temp: {group:"PLUMBING", label:"TEMPERATURE", seam:"over",  data:"press", live:true, on:false,
        draw:tempLayer,
        tip:"How hot what is in each run actually is, in kelvin, off the enthalpy the transport carried there - never off what the run was drawn for. It is the other half of the state point: a pressure alone does not say whether a line is holding water or steam, and the two together do."},
  subc: {group:"PLUMBING", label:"SUBCOOLING",  seam:"over",  data:"press", live:true, on:false,
        draw:subcLayer,
        tip:"How far the water in each run is from boiling AT ITS OWN PRESSURE. Zero is where it flashes: a pump whose suction reads zero has nothing solid to pump and loses its head, and the highest point of the loop is where it happens first. This is the picture behind the rule that the pressurizer belongs at the top."},
  hold: {group:"PLUMBING", label:"HOLDUP",      seam:"over",  data:"press", live:true, on:false,
        draw:holdLayer,
        tip:"What is standing in every run and in every machine, in kilograms - the run's reading on the run, the machine's under its box. A pipe is a small tank: its bore and its length are real inventory, so it stores, it springs, and the flow has to turn the whole lot over before what is in it changes. Half of a run's water is counted at the machine on each of its ends, unless that end's nozzle valve is shut - a shut valve leaves the line on its far side, where it actually is."},
  // a layer that paints on a healthy plant is a survey and ships off; one silent until it matters is an annunciator and ships on
  heat: {group:"COMPARTMENT", label:"HEAT",        seam:["env","over"], data:"room", live:true, on:false,
        draw:heatLayer,
        tip:"Where the heat is, in one picture. The cells are banded by air temperature, AMBIENT to UNTENABLE, with the band edges set at the temperatures machines actually give up at rather than at round numbers. Every machine prints its own skin temperature, coloured against what THAT box was built for where it has a limit, and under it the kilowatts it is putting into the room - plus into the air, minus out of it. Heat is a place. It comes off every hot surface, it comes in a flood out of anything venting steam into the room instead of into a tank, a machine is a WALL to it, and the only sink is the hull - so a compact plant runs hotter than a spread-out one."},
  roomh:{group:"COMPARTMENT", label:"H2 CLOUD",   seam:"env",   data:"room", live:true, on:true,
        draw:roomH2Layer,
        tip:"Where the hydrogen off the cladding has ended up. It leaves the primary with the steam, at whatever hole the steam left through, and then it is a gas fourteen times lighter than air, collecting under the deckhead of a SEALED compartment - the only thing that takes it out again is the ventilation set, or a fire. VIOLET is the gas, and the hard violet line is the 4 % flammable limit: inside it, the room is a bomb waiting for something at 773 K. Amber and moving is a flame front, and how fast it crosses a cell is a property of the mixture. No figure is printed - point at a cell for the reading. This is the Fukushima sequence, drawn."},
  roomo:{group:"COMPARTMENT", label:"OXYGEN",     seam:"env",   data:"room", live:true, on:false,
        draw:roomO2Layer,
        tip:"What is left in each cell to burn WITH. It draws DEPLETION only - a cell holding what air actually holds prints nothing, because the question is where a fire has eaten its own air. Blue and labelled is under 5% by volume, the limiting oxygen concentration: nothing ignites there whatever else is in it, which is how a sealed corner smothers its own fire and leaves the hydrogen unburnt."},
  roomn:{group:"COMPARTMENT", label:"METAL POOL", seam:"env",   data:"room", live:true, on:true,
        draw:roomNaLayer,
        tip:"Sodium that has come out of a pipe and is lying on the deck. It is a PLACE: it falls, it runs along the deck and through the machines' frames, and floats on any water under it, a part-full cell is drawn part full, and how far it spread is what decides how fast it burns - a puddle is slow, the same metal spread thin over a bay is not. Dim grey is metal that is not alight; AMBER, labelled with its own temperature, is metal that is. Only the top of a stack burns, because only the top of a stack has air on it. It needs no spark: it comes out of the pipe hundreds of degrees past the temperature it lights itself at, and it goes out only when the pool is gone, the metal has cooled, or the OXYGEN layer says the bay has nothing left to burn with."},
  roomp:{group:"COMPARTMENT", label:"BLAST",      seam:["under","skin"], data:"room", live:true, on:true,
        draw:roomPLayer,
        tip:"What the blast has done to the machines. A dark bite into a machine's side is the scar of every wave that has passed that face, and it grows with each one: two half hits mark like one full one. The same soot lies on every pipe and wall the waves passed. It never fades; a repair does not clean it. Point at a cell for its worst reading."},
  roompn:{group:"COMPARTMENT", label:"PRESSURE NOW", seam:"env",  data:"room", live:true, on:true,
        draw:roomPNowLayer,
        tip:"The wave, and nothing else: how steeply the pressure changes across a cell, which is what a schlieren photograph of a blast shows. A still room at any pressure is black. Machines and pipes lean away from a front as it hits them, and spring back when it has passed."},
  contz:{group:"COMPARTMENT", label:"CONTAINMENT", seam:"under", data:"room", live:true, on:false,
        draw:contZones,
        tip:"Every bounded region, tinted, and every wall cell banded by its own margin to its own rating. The bands are the WALL'S limits and not round numbers: HELD, WORKING, AT RATED, and OPENING at the pressure it actually splits at. What a cell can take is a property of the SHAPE - stress is p*R/t, so the middle of a long flat side is weak and a corner braces itself. Paint a square region and a round one of the same area and read this: the square has a weakest cell in the middle of its longest side and the round one has none at all. No figure is printed per cell - one reading per region, at its centroid, and point at a cell for the rest."},
  flood:{group:"COMPARTMENT", label:"FLOODING",    seam:"env",   data:"room", live:true, on:true,
        draw:floodLayer,
        tip:"Water on the floor, cell by cell. Water is a place: it lands where it came out, it falls, it runs along the floor toward level and it stands where it stands - deepest under the break while it is still arriving. A part-full cell is drawn part full. A machine box does not stop it: it runs in through the frame, under and out the other side, and a machine it stands two thirds of the way up is drowned. Only painted structure is a floor or a wall to it. It paints nothing at all until there is water somewhere, which is why it ships on."},
  flow: {group:"PLUMBING", label:"FLOW METERS", seam:"over",  data:null,    live:true, on:false,
        draw:(d,L)=>pipeMeters(pipeRuns(L),L),
        tip:"The top line of every run's readings: what that run is carrying, in kg/s. The figure goes amber and takes a minus sign when a run reverses, and red when it is being pushed past its rating. The pressurizer's own dial is not on this switch - it is the only gauge that plant pressure has, so it is always drawn."},
};
const LAYER_ORDER=Object.keys(LAYERS);

let layerCache={};
function layerTick(){ layerCache={}; }

function layerData(id, L){
  if(!id) return null;
  return layerCache[id] || (layerCache[id]=LAYER_DATA[id](L));
}

// a layer that draws on both sides of the machines states both seams; the pass tells its draw which one it is in
const layerSeam=(l,seam)=> Array.isArray(l.seam) ? l.seam.indexOf(seam)>=0 : l.seam===seam;

// "skin" runs once per machine, on its box and under its name, and hands the draw that machine
function layerPass(seam, L, p){
  for(const k of LAYER_ORDER){
    const l=LAYERS[k];
    const woke = l.group==="PLUMBING" && (pipeHov || (k==="hold" && holdHov));
    if((!l.on && !woke) || !layerSeam(l,seam) || (l.live && !L)) continue;
    ctx.save();
    l.draw(layerData(l.data, L), L, seam, p);
    ctx.restore();
  }
}

function layerToggle(k){ LAYERS[k].on=!LAYERS[k].on; }
function layerMenu(){
  const m=KIT.menuKey({label:"LAYERS", cls:"plant-layers",
    tip:"Every overlay the plant view can draw, grouped by what it surveys. A layer is a view and never a fact: switching one on changes nothing about the plant, only what you are shown of it."});
  // grouped, not in LAYER_ORDER: that is the DRAW order and a single walk prints a group twice
  for(const group of LAYER_ORDER.map(k=>LAYERS[k].group).filter((g,i,a)=>a.indexOf(g)===i)){
    m.menu.appendChild(KIT.rule(group).el);
    for(const k of LAYER_ORDER){
      const l=LAYERS[k];
      if(l.group!==group) continue;
      const b=KIT.button(l.label, {sunk:true, on:l.on,
        onClick:()=>{ layerToggle(k); b.set({on:l.on}); }});
      b.el.classList.add("layer-switch");
      KIT.tip(b.el, l.label, l.tip);
      m.menu.appendChild(b.el);
    }
  }
  return m;
}
