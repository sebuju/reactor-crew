"use strict";
/* the reference screen */

/* ─────────────── REFERENCE ─────────────── */
const HELP=[
 ["h","READING THE DIAGRAM"],
 ["d","PIPE COLOUR","Primary piping is tinted by the water temperature inside it, blue near 520 K and red near 630 K. If hot and cold legs converge in colour, heat is not being removed."],
 ["d","PACKETS IN THE PIPES","Each bolus sliding down a line is fluid actually moving, at a speed proportional to the flow, and its bright face points the way it is going. Primary packets track pump setting, secondary packets track load demand. A line with nothing moving in it has no circulation."],
 ["d","FLOW METERS","Every line carries a needle at the middle of its longest straight run, reading real flow against what that line was built for. Hover it for per cent of design. The needle runs on past the mark into a red band, because you are allowed to push a line past its rating - it just tells you that you are. The pressurizer carries the same gauge reading pressure, and its band opens at the relief valve setpoint."],
 ["d","FILL LEVELS","The shaded column inside the pressurizer, steam generator and vessel is the real level, drawn to scale. The vessel column turns red when thermal margin is lost."],
 ["d","VALVE SYMBOLS","Bowties are valves. Green is closed and holding, red is open and passing flow."],
 ["d","ELECTRICAL OUTPUT","The turbine box reads the megawatts the ship is actually getting, not a percentage. It turns amber when condenser backpressure is taking some of that output back off you."],
 ["h","DESIGN BENCH"],
 ["d","ARCHETYPE","Six coolant and moderator families, each with a real ancestor. They differ in power density, grace time, operating pressure and, critically, the sign of the void coefficient."],
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
 ["d","FUEL TEMP","Average centreline temperature, driving Doppler feedback. Past 1500 K the fuel takes damage regardless of DNBR."],
 ["h","CONTROLS"],
 ["d","CONTROL BANK","Rod insertion. Fast, but it travels at only 1.2 percent per second, and deep insertion raises power peaking which quietly eats DNBR."],
 ["d","COOLANT PUMPS","Primary flow. Raising it buys thermal margin; dropping it heats the fuel and pushes power down through Doppler."],
 ["d","BORON","Dissolved poison in pcm. Slow and loop-wide, your coarse trim, and the only way out of a deep xenon pit."],
 ["d","LOAD DEMAND","Turbine draw. Increasing it cools the primary, which raises power on its own through the negative moderator coefficient. Ride that instead of fighting it."],
 ["d","SCRAM","Clicked on the diagram beside the rod drives. Always safe, never free: the xenon that follows locks you out of power for roughly three minutes."],
 ["d","BLOCK VALVE / HPI","Both clicked on the diagram. The block valve shuts a PORV that will not reseat. HPI refills the loop and adds vessel fatigue the entire time it runs."],
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
 ["d","THE TMI-2 TRAP","Inject the stuck PORV fault. Pressure falls while pressurizer level rises. The correct move is to watch subcooling collapse, close the block valve, then start HPI, and accept the vessel fatigue."],
];
/* ══ THE FULL BOARD, AS REFERENCE ══
   This used to be an overlay called ALARMS in the control room, opened by a key
   over the plant. Twenty-six tiles do not belong on top of a plant view and
   twenty of them are dark at any moment, so the LIT ones went to a floating
   stack there and the board came here - where everything else that explains
   rather than reports already lives.
   It draws dark on an uncommissioned plant: the reference is worth reading
   before you have built anything, and a[2] would ask a null plant how it feels. */
const ANN_COLS=6, ANN_TILE=40;
const annBoardH=()=>Math.ceil(ANN.length/ANN_COLS)*ANN_TILE;
function annBoard(x,y,w){
  const colw=(w+6)/ANN_COLS, tw_=Math.round(colw)-6;
  ANN.forEach((a,i)=>{
    const tx=Math.round(x+(i%ANN_COLS)*colw), ty=y+Math.floor(i/ANN_COLS)*ANN_TILE;
    const on = (P&&S) ? a[2](S) : false;
    const col=a[1]==="red"?C.red:a[1]==="amber"?C.amber:C.blue;
    const lit=on&&!(a[1]==="red"&&performance.now()%900<450);
    fillRect(tx,ty,tw_,34, lit?col:C.panel); frame(tx,ty,tw_,34, lit?col:C.edge);
    txt(pad(i+1,2),tx+5,ty+11,{size:6.5,color:lit?"#2a0a06":"#2c3f45"});
    fitTxt(a[0],tx+tw_/2,ty+23,tw_-8,{size:8,weight:700,sp:1.1,align:"center",
        color:lit?"#120404":"#33484e"});
    TIP(tx,ty,tw_,34,a[0]+(on?"  [ LIT ]":"  [ clear ]"),a[3]);
  });
  return annBoardH();
}
function drawHelp(){
  const maxw=716, o={size:10,color:"#9fb4b9"};
  ctx.save(); ctx.beginPath(); ctx.rect(0,44,W,H-44); ctx.clip();
  const run=(from,to)=>{
    let y=44+30-helpScroll;
    for(let i=from;i<to;i++){
      const it=HELP[i];
      if(it[0]==="h"){ y+=12;
        if(y>30&&y<H+30) rule(it[1],12,y,maxw,C.amber);
        y+=22;
      } else if(it[0]==="ann"){
        if(y>-annBoardH()&&y<H+30) annBoard(12,y,maxw);
        y+=annBoardH()+12;
      } else {
        const n=wrapCount(it[2],maxw-14,o);
        if(y>10&&y<H+70){
          chip(12,y-7,C.cyan);
          txt(it[1],22,y,{size:9.5,weight:700,sp:1.4,color:C.cyan});
          wrap(it[2],22,y+15,maxw-14,14,o);
        }
        y+=15+n*14+12;
      }
    }
    return y;
  };
  const bot=run(0,HELP.length)+helpScroll;
  helpMax=Math.max(0,bot-H+40);
  ctx.restore();
  if(screen==="help") setPageH(bot+40);
  push({x:0,y:44,w:W,h:H-44,type:"scroll"});
  if(helpMax>0){
    fillRect(W-16,48,4,H-56,C.well);
    const th=Math.max(28,(H-56)*(H-44)/(helpMax+H-44));
    fillRect(W-16,48+(H-56-th)*(helpScroll/helpMax),4,th,C.amber);
  }
}
