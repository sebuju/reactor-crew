"use strict";
/* the reference screen */

const HELP=[
 ["h","READING THE DIAGRAM"],
 ["d","PIPE COLOUR","Primary piping is tinted by the water temperature inside it, blue near 520 K and red near 630 K. If hot and cold legs converge in colour, heat is not being removed."],
 ["d","PACKETS IN THE PIPES","Each bolus sliding down a line is fluid actually moving, at a speed proportional to the flow, and its bright face points the way it is going. Primary packets track pump setting, secondary packets track load demand. A line with nothing moving in it has no circulation."],
 ["d","FLOW METERS","Every line carries a needle at the middle of its longest straight run, reading that run's own real flow in kg/s and which way it is going - a short loop and a long loop are judged against what each was, itself, built to carry, not a shared plant guess. Hover it for per cent of that run's own rating. The needle runs on past the mark into a red band, because you are allowed to push a line past its rating - it just tells you that you are. The pressurizer carries the same gauge reading pressure, and its band opens at the relief valve setpoint."],
 ["d","FILL LEVELS","The shaded column inside the pressurizer, steam generator and vessel is the real level, drawn to scale. The vessel column turns red when thermal margin is lost."],
 ["d","VALVE SYMBOLS","Bowties are valves. Green is closed and holding, red is open and passing flow."],
 ["d","ELECTRICAL OUTPUT","The turbine box reads the megawatts the ship is actually getting, not a percentage. It turns amber when condenser backpressure is taking some of that output back off you."],
 ["d","RADIATION LAYERS","Four switches on the rail, on both screens. RAD ZONES fills the floor in five bands, from CLEAR through EXCLUSION, and draws the boundary line where a shield's shadow actually falls. CELL DOSE prints the exact number in every free cell. REPAIR CELLS outlines just the cells a body could physically stand in beside something. PART DOSE prints, on the machine itself, what reaching it will cost. This is the survey: a machine is drawn over the field, and the cells left visible under it are the cells you can actually send someone to stand in."],
 ["h","DESIGN BENCH"],
 ["d","COOLANT","What flows through the core. It sets operating pressure, where it boils, how much power a litre of core makes, how good a cycle the steam can drive - and how well it slows a neutron. It does NOT set the void coefficient any more. Six fluids, each with a real ancestor."],
 ["d","THE PLAN AND THE SECTION","Two canvases, one pen bar. The PLAN is a quarter of the core looking down: fuel, poison and rod clusters go there. The SECTION is the same core in elevation: drag the top of the fuel column for its length, and paint reflector onto the rim, the lid and the floor. Everything about the shape of this reactor is drawn on one of the two, and every number under MEASURED is an output of them."],
 ["d","MODERATION","A neutron out of fission is too fast to be much use, and something has to slow it down. Draw MODERATOR blocks into the lattice, or let the coolant do it, or do neither and run a fast core. MODERATION RATIO on the panel is the measurement, and it decides prompt lifetime, the moderator coefficient, the void coefficient and how much enrichment it takes to go critical at all. Nothing here is a number you can type: pack graphite around water channels and the void coefficient goes positive by itself, which is the RBMK preset and the Chernobyl core."],
 ["d","REACTOR PRESETS","The six old reactor types survive as DRAWINGS. Each one picks a coolant and a block material, sets the pitch, lays the fuel, packs the moderator and spreads the banks - with the same pens you have. A preset cannot describe a reactor you could not have drawn yourself."],
 ["d","FUEL","Sets delayed neutron fraction and excess reactivity. Low-enriched uranium gives 650 pcm of margin before prompt criticality; plutonium MOX gives 300."],
 ["d","SCRAM SYSTEM","Gravity is fail-safe but slow and direction dependent. Springs are fast and need charge. Boron injection is near instant and irreversible for the mission."],
 ["d","INSTRUMENT CHANNELS","How many sensors watch each parameter. One channel means a failed sensor is indistinguishable from reality; three channels vote a liar out."],
 ["d","TURBINE SIZE","Sets two things at once: how much of the heat becomes electricity, and how far past rated power the load slider will go. The reactor sets the ceiling on efficiency, because hotter steam drives a better cycle, and the turbine decides how much of that ceiling you capture."],
 ["d","CONDENSER SIZE","The heat sink, and it also sets two things. It caps the steam dump that absorbs a turbine trip, and it caps how much steam you can condense at full draw. Overload a small condenser and backpressure eats your output while the reactor goes on making the heat."],
 ["d","MASS BUDGET",BUDGET+" tonnes total. A bigger core, a heavier vessel and every safeguard compete for the same allowance, so a safe plant is a small one unless you give something up."],
 ["d","GRACE TIME","How long the core survives total loss of cooling. It is the single number that decides whether a combat repair is possible at all."],
 ["h","GAUGES"],
 ["d","DNBR","Departure from nucleate boiling ratio, the margin before the steam film on the cladding goes continuous and cooling collapses. Above 1.30 is safe, 1.00 is failure. This, not the power rating, limits how hard you can push."],
 ["d","SUBCOOLING","How far the hot leg sits below boiling at current pressure. Your honest inventory indicator: it collapses toward zero before anything else admits the loop is voiding."],
 ["d","PZR LEVEL","Water level in the pressurizer. This gauge can lie. When the core voids, steam pushes water up the surge line and level reads high while the loop empties."],
 ["d","INVENTORY","How much water is actually in the loop. A real plant has no such instrument; it is shown here for training and would be hidden in the shipping build."],
 ["d","FUEL TEMP","Average centreline temperature, driving Doppler feedback. Past the damage temperature of the fuel you picked, it takes damage regardless of DNBR. The FUEL TEMP gauge says where that is."],
 ["h","CONTROLS"],
 ["d","CONTROL BANK","Rod insertion. Fast, but it travels at only 1.2 percent per second, and deep insertion raises power peaking which quietly eats DNBR."],
 ["d","COOLANT PUMPS","Primary flow. Raising it buys thermal margin; dropping it heats the fuel and pushes power down through Doppler."],
 ["d","BORON","Dissolved poison in pcm. Slow and loop-wide, your coarse trim, and the only way out of a deep xenon pit."],
 ["d","LOAD DEMAND","Turbine draw. Increasing it cools the primary, which raises power on its own through the negative moderator coefficient. Ride that instead of fighting it."],
 ["d","SCRAM","Clicked on the diagram beside the rod drives. Always safe, never free: the xenon that follows locks you out of power for roughly three minutes."],
 ["d","BLOCK VALVE / TANK VALVES","All worked on the diagram. Every relief valve carries its own two-switch strip: BLOCK shuts a valve that will not reseat, and AUTO/BYP decides whether that one valve may lift by itself. Every tank carries the same two: its own isolation valve, and a dump valve that puts its contents over the side. A tank injecting into the loop refills it and adds vessel fatigue the entire time it runs."],
 ["d","TANKS","There is ONE tank component and it has no kind. You add one at the bench, say what is in it, what is behind it and where it is plumbed, and the physics follows. Water behind a check valve with a gas charge is a passive accumulator that works in a blackout. The same tank full of borated water is emergency poison. Empty, with no check valve, plumbed to the relief header, it is a relief tank. On the secondary side it is emergency feedwater. Four tanks is a legal plant and so is none."],
 ["d","FITTINGS","A fitting is a tap on a pipe, not a machine in a cell. Right-click any run at the design bench to put one on it: a JUNCTION ties two runs together, a THROTTLE chokes one down, and a RELIEF VALVE vents to whatever tank you plumbed the relief header to. It costs a spool piece and its own branch pipe, and it moves with the run it taps - move a machine upstream and the tap comes with it. Every fitting has its own panel in both rails, and clicking its symbol on the diagram brings that panel up."],
 ["d","LIFT AND RESEAT","A relief valve is dialled at the bench, not in a transient - the setpoints are mechanical. LIFT is the pressure it opens itself at; RESEAT is the pressure it shuts again at, and the gap between them is its deadband. A wide band lifts once and clears the transient. A narrow one reseats straight back into the same pressure and cycles, and every lift is another 18 per cent chance of sticking open. Fit more than one valve and give them different lift points, and the plant sheds pressure in stages instead of betting everything on one valve."],
 ["h","THE ANNUNCIATOR"],
 ["d","WHERE IT IS","A component on the plant lights ONE lamp when any alarm of its own is up - the lamp says HERE. The stack floating at the top left of the control room says WHAT, listing every alarm that is currently lit and nothing that is not. This board is the third thing: every alarm the plant can raise, including the twenty that are dark, so you can learn what a lamp will mean before it lights. Hover any tile."],
 ["ann","ANNUNCIATOR BOARD"],
 ["h","REACTIVITY LEDGER"],
 ["d","WHERE IT IS","On the reactor's own plate in the control room, under a REACTIVITY head, because every term in it is a property of the core. Each row carries its bar where an ordinary row carries a hairline."],
 ["d","HOW TO READ IT","Terms are in pcm; beta for your chosen fuel is one dollar. Bars left of centre shut the reactor down, right of centre push it up. Net rho near zero is steady state."],
 ["d","DOPPLER","Fuel temperature feedback, instant and always stabilising, the thing that stops a runaway before you can."],
 ["d","XENON","Xe-135 poison. Slow, has memory, and the reason power history matters. Runs on a 400x compressed clock, so a nine hour transient plays in about eighty seconds."],
 ["d","VOID","Steam in the core. Negative in a water design, but if you commissioned a graphite or sodium plant it is positive, and voiding adds power instead of removing it."],
 ["h","TWO DRILLS WORTH RUNNING"],
 ["d","THE XENON PIT","Sit at 100 percent, hit SCRAM, then try to return to power immediately. Rods fully out will not do it. Diluting boron is the only way back, and it takes time you would not have in a fight."],
 ["d","THE TMI-2 TRAP","Inject the stuck PORV fault. Pressure falls while pressurizer level rises. The relief tank fills, and past its rupture disc what was in it is on the containment floor. The correct move is to watch subcooling collapse, close the block valve, then open the injection tank's valve, and accept the vessel fatigue."],
];
/* HELP is HTML now; the array above is still the one source of the prose. */
let helpAnnTiles=null;

function helpBuildDOM(){
  const root=document.getElementById("help-doc");
  if(!root) return;
  root.innerHTML="";
  for(const it of HELP){
    if(it[0]==="h"){
      const h=document.createElement("div"); h.className="help-h";
      const s=document.createElement("span"); s.textContent=it[1];
      h.appendChild(s); root.appendChild(h);
    } else if(it[0]==="ann"){
      root.appendChild(helpBuildAnnBoard());
    } else {
      const d=document.createElement("div"); d.className="help-d";
      const t=document.createElement("div"); t.className="help-d-title";
      const m=document.createElement("span"); m.className="help-chip";
      t.appendChild(m); t.appendChild(document.createTextNode(it[1]));
      const p=document.createElement("p"); p.className="help-d-body"; p.textContent=it[2];
      d.appendChild(t); d.appendChild(p); root.appendChild(d);
    }
  }
}

function helpBuildAnnBoard(){
  const grid=document.createElement("div"); grid.className="help-ann";
  helpAnnTiles=ANN.map((a,i)=>{
    const tile=document.createElement("div"); tile.className="ann-tile";
    tile.dataset.tipTitle=a[0]+"  [ clear ]"; tile.dataset.tipBody=a[3];
    const num=document.createElement("span"); num.className="ann-num"; num.textContent=pad(i+1,2);
    const label=document.createElement("span"); label.className="ann-label"; label.textContent=a[0];
    tile.appendChild(num); tile.appendChild(label); grid.appendChild(tile);
    return {el:tile,row:a};
  });
  return grid;
}

/* Board draws dark on an uncommissioned plant - a[2](S) must not run without S. */
function helpSync(){
  if(screen!=="help" || !helpAnnTiles) return;
  for(const {el,row} of helpAnnTiles){
    const on=(P&&S)?row[2](S):false;
    el.classList.toggle("lit",on);
    el.classList.toggle("red",row[1]==="red");
    el.classList.toggle("amber",row[1]==="amber");
    el.classList.toggle("blue",row[1]!=="red"&&row[1]!=="amber");
    el.classList.toggle("blink",on&&row[1]==="red");
    el.dataset.tipTitle=row[0]+(on?"  [ LIT ]":"  [ clear ]");
  }
}

function drawHelp(){}
