"use strict";
/* the reference screen */

/* ─────────────── REFERENCE ─────────────── */
const HELP=[
 ["h","READING THE DIAGRAM"],
 ["d","PIPE COLOUR","Primary piping is tinted by the water temperature inside it, blue near 520 K and red near 630 K. If hot and cold legs converge in colour, heat is not being removed."],
 ["d","DASH ANIMATION","Moving dashes mean flow, at a speed proportional to it. Primary dashes track pump setting, secondary dashes track load demand. A stalled line means no circulation."],
 ["d","FILL LEVELS","The shaded column inside the pressurizer, steam generator and vessel is the real level, drawn to scale. The vessel column turns red when thermal margin is lost."],
 ["d","VALVE SYMBOLS","Bowties are valves. Green is closed and holding, red is open and passing flow."],
 ["h","DESIGN BENCH"],
 ["d","ARCHETYPE","Six coolant and moderator families, each with a real ancestor. They differ in power density, grace time, operating pressure and, critically, the sign of the void coefficient."],
 ["d","FUEL","Sets delayed neutron fraction and excess reactivity. Low-enriched uranium gives 650 pcm of margin before prompt criticality; plutonium MOX gives 300."],
 ["d","SCRAM SYSTEM","Gravity is fail-safe but slow and direction dependent. Springs are fast and need charge. Boron injection is near instant and irreversible for the mission."],
 ["d","INSTRUMENT CHANNELS","How many sensors watch each parameter. One channel means a failed sensor is indistinguishable from reality; three channels vote a liar out."],
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
 ["h","REACTIVITY LEDGER"],
 ["d","HOW TO READ IT","Terms are in pcm; beta for your chosen fuel is one dollar. Bars left of centre shut the reactor down, right of centre push it up. Net rho near zero is steady state."],
 ["d","DOPPLER","Fuel temperature feedback, instant and always stabilising, the thing that stops a runaway before you can."],
 ["d","XENON","Xe-135 poison. Slow, has memory, and the reason power history matters. Runs on a 400x compressed clock, so a nine hour transient plays in about eighty seconds."],
 ["d","VOID","Steam in the core. Negative in a water design, but if you commissioned a graphite or sodium plant it is positive, and voiding adds power instead of removing it."],
 ["h","TWO DRILLS WORTH RUNNING"],
 ["d","THE XENON PIT","Sit at 100 percent, hit SCRAM, then try to return to power immediately. Rods fully out will not do it. Diluting boron is the only way back, and it takes time you would not have in a fight."],
 ["d","THE TMI-2 TRAP","Inject the stuck PORV fault. Pressure falls while pressurizer level rises. The correct move is to watch subcooling collapse, close the block valve, then start HPI, and accept the vessel fatigue."],
];
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
