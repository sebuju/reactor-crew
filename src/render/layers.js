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
     "over" - drawn AFTER the component loop and BEFORE pipeGauges(), for
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
   pipeFlow()/pipeGauges() already are: a reading with no plant behind it is
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
};

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

   EVERY LAYER STARTS OFF. The plant diagram is the thing being read; a layer
   is a question asked OF it, and a question nobody asked should not already
   be answered over the top of the machines. Defaulting even one on would also
   make the first screenshot of the plant a screenshot of an overlay, and hide
   the fact that the switches exist at all - a survey you never turned on
   teaches nothing about where the shielding went. */
const LAYERS={
  radz:{label:"RAD ZONES",    seam:"under", data:"rad", live:false, on:false,
        draw:radZones,
        tip:"Area dose rate as a survey map: five bands from CLEAR to EXCLUSION, hard edges between them. Turn this on to see the shape of the hazard, not just a number for it."},
  radn:{label:"CELL DOSE",    seam:"under", data:"rad", live:false, on:false,
        draw:radNumbers,
        tip:"The dose rate printed in every grid cell, same units the bench already quotes. 144 numbers is a lot of ink for a glance - ask for it when you need the exact figure rather than the band."},
  radp:{label:"REPAIR CELLS", seam:"under", data:"rad", live:false, on:false,
        draw:radCells,
        tip:"Every cell a repair party could actually stand in to work a job. Turn this on before you send anyone anywhere - it is the answer to \"where can I put a body\", not just \"how hot is it here\"."},
  radc:{label:"PART DOSE",    seam:"over",  data:"rad", live:false, on:false,
        draw:radPart,
        tip:"What each machine costs to reach, from the coldest free cell beside it - the triage number - the figure you read before deciding who goes to fix what."},
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
  return layerCache[id] || (layerCache[id]=LAYER_DATA[id](L));
}

/* the one place LAYER_ORDER is walked to draw. Called twice by drawPlant(),
   once per seam - see the two call sites there for why each is where it is. */
function layerPass(seam, L){
  for(const k of LAYER_ORDER){
    const l=LAYERS[k];
    if(!l.on || l.seam!==seam || (l.live && !L)) continue;
    ctx.save();
    l.draw(layerData(l.data, L), L);
    ctx.restore();
  }
}

function layerToggle(k){ LAYERS[k].on=!LAYERS[k].on; }

/* One switch per layer, built into whatever rail container a screen hands
   in - control room and design bench both call this rather than hand-roll a
   button per layer, the same reason there is one AUTOSYS and one bypRow()
   rather than a copy per system. A layer with no switch here has no way to
   be turned off, so audit-dom.js counts exactly LAYER_ORDER.length of these
   on both screens' rails. */
function layerSwitches(container){
  for(const k of LAYER_ORDER){
    const l=LAYERS[k];
    const b=KIT.button(l.label, {sunk:true, on:l.on,
      onClick:()=>{ layerToggle(k); b.set({on:l.on}); }});
    b.el.classList.add("layer-switch");
    KIT.tip(b.el, l.label, l.tip);
    container.appendChild(b.el);
  }
}
