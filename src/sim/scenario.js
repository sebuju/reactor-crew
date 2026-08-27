"use strict";
/* the scenario: what is scripted to happen, and what must not */

/* ═══════════════ A SCENARIO IS GESTURES AND LIMITS ═══════════════
   Two halves, and they are deliberately independent of each other:

     gest   - what is DONE to the plant, and when. Compiles to acts.
     limits - what the plant was not allowed to do while that happened.

   Nothing about a limit reaches step(). A limit is judged AFTER the fact, off
   the trend archive the run already wrote, which is why you can edit a limit
   and re-judge a finished run without re-simulating a single tick. Put a limit
   inside the tick and that stops being true the moment you touch it: the plant
   would have to be run again to find out what the new limit says about the old
   run, and a debrief that re-simulates is a debrief that can disagree with the
   run it is describing.

   ── ONE SCENARIO IS BEING EDITED AT A TIME ──
   `SCN` is that one, the way `LAT` is the one lattice being drawn. Presets are
   never mutated; `scnClone()` starts editing a copy of one.

   ── NONE OF THIS IS ON S ──
   A scenario is a script, not plant state - the same reason `TR` (the transport
   rate) is not on S. It must not be snapshotted, scrubbed or replayed: a
   recording holds what the scenario DID, as acts on the tape, and re-reading
   the script during a replay would apply all of it a second time. */

/* dt is 0.02 everywhere in this build and buying speed by lengthening it is
   forbidden (see record.js), so a sim second is exactly 50 ticks. Gestures are
   authored in seconds because that is what a person types; the tape and the
   keyframes index by tick, because a float second cannot key a keyframe. */
const SCN_TPS     = 50;
const scnTicks    = t => Math.max(0, Math.round(t*SCN_TPS));
/* How finely a ramp is cut into acts. One act per half second is far coarser
   than the tick and far finer than the plant's own lags - LOAD_TAU is 2 s - so
   the staircase is invisible in the response and the tape stays readable: a
   60 s ramp is 120 events, not 3000. */
const SCN_RAMP_DT = 0.5;

/* ═══════════════ THE AUTHORING PALETTE ═══════════════
   ── THE EXTENSION RULE ──
   An event type IS an `ACT` key. Add a row to `ACT` in record.js and you get, in
   one move, a recordable player input, a replayable command and a scenario
   event - there is no separate scenario-event table to keep in step with it.

   A GESTURE is only needed when the AUTHORING shape differs from the ACT shape.
   Two things make them differ, and both are here:
     - units. `ACT` rows take SIM units, so a slider's `/100` lives at its call
       site. A person authoring a drill types 60, not 0.6, so the conversion
       lives in scnCompile() - one place, named below on every row that needs it.
     - arity. A ramp is ONE gesture and MANY acts. Everything else in v1 is one
       gesture, one act, and those rows exist only to carry a label, the arg
       shapes an editor needs, and the unit conversion.

   ── WHAT A ROW CARRIES ──
     lab   the palette label
     act   the ACT key it compiles to; null for a row with no sim effect
     args  the shape a person fills in: label, unit, and the range if bounded
     emit  (a, ctx, put) -> pushes acts. `put(dtSeconds, actArgs)` stamps them
           relative to the gesture's own time. `ctx` is the compile's running
           picture of what the SCRIPT has commanded so far - today that is the
           load, which a ramp needs a start value for.

   ── TOGGLES ARE TOGGLES, AND THAT IS NOT A SHORTCUT ──
   `byp` toggles in `ACT`, so it toggles here. Authoring it as "set this
   bypass ON" would be a promise this layer cannot keep: the act flips
   whatever the switch is currently at, and a compiled track cannot know that.
   In a scripted run it is exact anyway - resetPlant() leaves every bypass off,
   and in an unattended run the script is the only thing that touches them - so a toggle at t=20 IS "bypass it at 20 s". The day
   a set-state act exists in `ACT`, this row changes to name it and gains its
   `on` argument; until then the shape here is the shape underneath it. */
const GEST = {
  loadStep :{lab:"LOAD STEP",  act:"loadDem", lane:"load", span:"point",
    args:[{lab:"TO", u:"%", min:0, max:100, def:80}],
    emit:(a,ctx,put)=>{ ctx.load=a[0]/100; put(0,[ctx.load]); }},

  /* ── THE RAMP STARTS WHERE THE SCRIPT LEFT IT, NOT WHERE THE PLANT IS ──
     A compiled track is static, so "ramp to 60% over a minute" has to get its
     start from somewhere the compiler can see. That is the last load the
     SCRIPT commanded, seeded at 1.0 because that is where resetPlant() puts
     loadDem. It is a scripted profile and not a servo: in an unattended run the
     script owns the load and the two are the same number, and in live play a
     ramp still ENDS on `to` whatever the operator did to the slider first - it
     just gets there from the script's idea of where it began. */
  loadRamp :{lab:"LOAD RAMP",  act:"loadDem", lane:"load", span:"ramp",
    args:[{lab:"TO", u:"%", min:0, max:100, def:60}, {lab:"OVER", u:"s", def:60}],
    emit:(a,ctx,put)=>{
      const to=a[0]/100, secs=Math.max(0,a[1]||0), from=ctx.load;
      const n=Math.max(1,Math.round(secs/SCN_RAMP_DT));
      for(let i=1;i<=n;i++) put(secs*i/n, [from+(to-from)*i/n]);
      ctx.load=to; }},

  flowStep :{lab:"PUMP STEP",  act:"flowDem", lane:"pump", span:"point",
    args:[{lab:"TO", u:"%", min:0, max:110, def:100}],
    emit:(a,ctx,put)=>put(0,[a[0]/100])},
  rodStep  :{lab:"ROD STEP",   act:"rodCommon", lane:"rod", span:"point",
    args:[{lab:"TO", u:"%", min:0, max:100, def:50}],
    emit:(a,ctx,put)=>put(0,[a[0]/100])},
  /* pcm is the plant's own unit for boron, so it passes straight through - the
     same reason ACT.boronDem takes pcm and not a slider reading. */
  boronStep:{lab:"BORON STEP", act:"boronDem", lane:"boron", span:"point",
    args:[{lab:"TO", u:"pcm", def:-500}],
    emit:(a,ctx,put)=>put(0,[a[0]])},

  scram    :{lab:"SCRAM",      act:"scram", lane:"rod", span:"point",    args:[], emit:(a,ctx,put)=>put(0,[])},
  hit      :{lab:"COMBAT HIT", act:"hit", lane:"dmg", span:"point",
    args:[{lab:"PART", u:"id", def:"turb"}],
    emit:(a,ctx,put)=>put(0,[a[0]])},
  repair   :{lab:"REPAIR",     act:"repair", lane:"dmg", span:"point",
    args:[{lab:"PART", u:"id", def:"turb"}],
    emit:(a,ctx,put)=>put(0,[a[0]])},
  blackout :{lab:"BLACKOUT",   act:"blackout", lane:"sys", span:"latch", pair:0,
    args:[{lab:"ON", u:"on", def:true}],
    emit:(a,ctx,put)=>put(0,[!!a[0]])},
  /* The one-shot that commands a die instead of rolling it (DICE.porvStick).
     A scripted run stands every die down, so this is the only way the relief
     valve fails to reseat - which is exactly the point of s.diceOff. */
  porvArm  :{lab:"PORV STICKS",act:"porvArm", lane:"sys", span:"point", args:[], emit:(a,ctx,put)=>put(0,[])},
  byp      :{lab:"BYPASS",     act:"byp", lane:"sys", span:"latch",
    args:[{lab:"SYSTEM", u:"sys", def:"rps"}],
    emit:(a,ctx,put)=>put(0,[a[0]])},
  /* A VALVE IS A POSITION, not a switch. This row was JUNCTION and it toggled
     S.juncOpen - a two-position gate on a tap-shaped cross-tie. A fitting is a
     box with a mode now, and the gated one is a throttle, so the script sets
     it where it wants it, 0..1, the same as every other continuous demand. */
  valve    :{lab:"VALVE",      act:"valveDem", lane:"sys", span:"latch",
    args:[{lab:"ID", u:"id", def:""},{lab:"TO", u:"%", min:0, max:100, def:0}],
    emit:(a,ctx,put)=>put(0,[a[0], a[1]/100])},

  /* The one row with no act: a caption on the timeline for whoever is being
     taught. It compiles to nothing at all, which is why `act:null` rather than
     an ACT row that does nothing - a no-op act would still land on the tape. */
  note     :{lab:"NOTE",       act:null, lane:"note", span:"point",
    args:[{lab:"TEXT", u:"text", def:""}]},
};
const GESTKEYS = Object.keys(GEST);

/* `sched:false` marks an ACT a scenario must never be allowed to schedule -
   `reset` today, because throwing the plant away part-way through a scripted
   run ends the run being about the plant it started with. Asserted here at load
   rather than checked at compile: a palette row naming such an act is a coding
   error in THIS file, and a coding error should not wait for somebody to author
   the scenario that trips over it. */
for(const k of GESTKEYS){
  const a = GEST[k].act; if(!a) continue;
  if(!ACT[a]) throw new Error("GEST."+k+" compiles to "+a+", which is not an act");
  if(ACT[a].sched === false)
    throw new Error("GEST."+k+" schedules "+a+", which is marked sched:false");
}

/* ═══════════════ LANES, AND HOW WIDE A BLOCK IS ═══════════════
   The timeline draws one lane per THING BEING COMMANDED, and an event is a
   block in its lane whose WIDTH IS ITS DURATION. That is only honest if every
   gesture says for itself where it belongs and how long it lasts, so `lane` and
   `span` are fields on the GEST row - the same rule AUTOSYS, DICE and ACT
   already follow. A fourteenth gesture declares those two and the renderer
   needs no edit; leave them off and the assert below says so at load.

   The three spans, and why there are three rather than one:

     ramp   draws its own OVER seconds as a wedge. It is the one span that
            owns its length, so it is the one whose right edge drags.
     latch  runs to the next event with the same key AND the same first argument.
            Two BYPASS events naming different systems are two different
            switches; paired by gesture alone, one would draw as the end of the
            other.
     point  is instant. A 3-unit marker with its label beside it, because a
            block one pixel wide with a word in it is a lie about both.

   A STEP (loadStep, flowStep, rodStep, boronStep) is `point`, not a span of
   its own kind. It used to be `hold`, drawn as a bar running to whatever
   commanded that lane next - which drew the DEMAND'S lifetime, not the
   EVENT's. The event is one act firing at one tick; how long the plant then
   sits at that demand is a fact about the plant, and the actuator tables in
   the project notes (rate limits, lags) already say it, on a curve this
   timeline does not draw. Confusing the two is what made a lone LOAD STEP
   with nothing after it in its lane draw as a bar the width of the whole
   run for a command that fires once.

   A lane is not a track in the recording and it never reaches the sim: it is
   how the timeline is read. scnCompile() has never asked and still does not.

   ── LANES ARE SCENARIO DATA NOW, AND A LANE HAS NO KIND OF ITS OWN ──
   `SCN.lanes` is per-scenario; a lane is just an `id`. `SCNLANE` here is only
   the default set a fresh scenario seeds from, and `GEST[k].lane` is only
   where a NEW event of that kind first lands - not a constraint on it after.
   Every event carries its own `.lane` and can move to any lane; its kind is
   picked on the inspector strip, unrelated to which lane it sits in.
   `scnNormalize()` fills in `.lanes`/`.lane` for a scenario from outside this
   file (fresh, cloned, or loaded), so nothing downstream has to check. */
const SCNLANE = ["load","pump","rod","boron","sys","dmg","note"];
const SPANKIND = {ramp:1, latch:1, point:1};
for(const k of GESTKEYS){
  const G=GEST[k];
  if(!SCNLANE.includes(G.lane))
    throw new Error("GEST."+k+" names lane "+G.lane+", which is not in SCNLANE");
  if(!SPANKIND[G.span])
    throw new Error("GEST."+k+" has span "+G.span+", which is not one of "+Object.keys(SPANKIND));
}
/* the one span that owns its own length, and the argument that IS that length -
   the renderer drags this arg and nothing else, so a second draggable edge
   cannot appear without a row here saying what it writes */
const RAMPARG = {loadRamp:1};

/* ═══════════════ BUILDING ONE ═══════════════
   The helpers a player's edits call, and the ONLY way a scenario is built.
   Presets below are these working in bulk - never a second way to make one -
   the same rule latLayFuel()/latLayBanks() hold for the lattice. */
/* Fills in `.lanes`/`.lane` on a scenario from outside this file (fresh,
   cloned, or loaded) so nothing downstream has to check they exist. */
function scnNormalize(scn){
  if(!scn.lanes) scn.lanes = SCNLANE.map(id=>({id}));
  for(const e of scn.gest) if(!e.lane) e.lane = (GEST[e.k]&&GEST[e.k].lane) || scn.lanes[0].id;
  return scn;
}
const scnNew   = (id,name) => scnNormalize({id, name, seed:1, secs:120, gest:[], limits:[]});
const scnGest  = (scn,t,k,...a) => { scn.gest.push({t, k, a, lane:GEST[k].lane}); return scn; };
const scnLimit = (scn,id,ch,cmp,v,grace) => {
  scn.limits.push({id, ch, cmp, v, grace:grace||0}); return scn; };
/* A preset is never mutated: editing one starts with a copy of it, down to the
   argument arrays, or two runs of the same preset would be the same objects. */
const scnClone = pre => scnNormalize({
  id:pre.id, name:pre.name, seed:pre.seed, secs:pre.secs,
  gest  : pre.gest.map(g => ({t:g.t, k:g.k, a:g.a.slice(), lane:g.lane})),
  limits: pre.limits.map(L => Object.assign({}, L)),
  lanes : pre.lanes && pre.lanes.map(L => Object.assign({}, L)),
});

/* ═══════════════ COMPILING ═══════════════
   Gestures in, a flat tick-sorted act track out. This is where percent becomes
   fraction and where a ramp becomes its hundred and twenty acts. Two orderings
   matter and neither is left to the sort's stability:
     - gestures are walked in AUTHORED time order, because `ctx` carries the
       running load a ramp starts from;
     - the emitted acts carry their emission index, so two acts that round onto
       the same tick keep the order they were written in. */
function scnCompile(scn){
  const raw = [];
  const gs = scn.gest.map((g,i)=>({g,i}))
                     .sort((x,y)=> (x.g.t - y.g.t) || (x.i - y.i));
  const ctx = {load:1};                 // resetPlant() commissions at loadDem 1
  for(const {g} of gs){
    const R = GEST[g.k];
    if(!R) throw new Error("scnCompile: no such gesture "+g.k);
    if(!R.act) continue;                // a note is a caption, not an event
    R.emit(g.a||[], ctx, (dt,a)=>raw.push({t:g.t+dt, seq:raw.length, k:R.act, a}));
  }
  raw.sort((x,y)=> (x.t - y.t) || (x.seq - y.seq));
  return raw.map(e => ({tick:scnTicks(e.t), k:e.k, a:e.a}));
}

/* ═══════════════ FIRING ═══════════════
   `scnArm()` compiles once and buckets the track by tick; `scnDue(tick)` fires
   the bucket. Three properties, each load-bearing:

   ── THROUGH act(), ALWAYS ──
   A scenario event reaches the plant by the same line the panel does, so it is
   recorded on the tape, replays like any other input, and earns the same
   refusals from the same guards. There is no scenario path and no player path.

   ── LIVE ONLY ──
   During a replay the recorded copies of these acts are what drive the plant.
   Firing the script again on top of them would apply every one of them twice.

   ── NO CURSOR: THE TEST IS TICK EQUALITY ──
   Which is what makes a branch behave. Scrub back to tick T and touch
   something: recAct() branches, the recorder goes live, and the plant walks
   forward from T again - so every scenario event stamped T or later meets its
   own tick a second time and fires onto the new take, exactly as it did onto
   the old one. A cursor would have had to be rewound by hand, by something that
   knows a seek happened, which is the sort of second bookkeeping this whole
   layer exists to avoid. */
let SCNRUN = null;
/* `o` is what RUN never needed and PLAY does: the tick to stop firing on,
   the take the run is being judged about, and what to do once it ends.
   RUN drives its own while-loop to `scn.secs` and judges the take itself
   the moment that loop exits, so it never passes `o` and scnDue() below
   never has anything to end on its own account - the two runners still
   share the one arm/fire mechanism, they just finish differently. */
function scnArm(scn,o){
  const track = scnCompile(scn), by = new Map();
  for(const e of track){
    const l = by.get(e.tick);
    if(l) l.push(e); else by.set(e.tick, [e]);
  }
  SCNRUN = {scn, track, by, end:o&&o.end, take:o&&o.take, onEnd:o&&o.onEnd};
  return SCNRUN;
}
const scnDisarm = () => { SCNRUN = null; };
const scnArmed  = () => SCNRUN ? SCNRUN.scn : null;

function scnDue(tick){
  if(!SCNRUN || REC.mode !== "live") return;
  const R=SCNRUN;
  const due = R.by.get(tick);
  if(due) for(const e of due) act(e.k, ...e.a);
  /* PLAY's own end: judged and disarmed from here because this is the one
     place both runners already call every tick - a poll placed anywhere
     else would be a second clock for the same question. */
  if(R.end!=null && (tick>=R.end || S.breach)){
    scnDisarm();
    const verdict = scnJudge(R.take, R.scn.limits);
    R.take.verdict = verdict;
    if(R.onEnd) R.onEnd({take:R.take, verdict});
  }
}

/* ═══════════════ THE VERDICT ═══════════════
   `scnJudge(take, limits)` is a pure function of a trend archive and a list of
   limits. It simulates nothing, reads no live state and writes none - hand it
   the same take with a different limit list and it answers about the same run.
   That is the whole point: a limit is a question you ask of a run, so you may
   change the question afterwards without changing the answer to the old one.

   A limit states the REQUIREMENT, never the fault: `{ch:"dnbr", cmp:">", v:1.3}`
   reads "DNBR must stay above 1.3", and a sample that fails it is a violation.
   That way the number in the limit is the line you would draw on the chart.

   `grace` is how long the violation must hold before it counts, in seconds, and
   it is measured in TICKS internally - ten samples of 0.1 s added up as floats
   do not reach 1.0, and a limit that fires a sample late depending on rounding
   is not a limit. KNOWN RESOLUTION: the archive samples every SAMP_TICKS, so
   grace resolves to 0.1 s and a violation shorter than one sample interval can
   fall between two samples unseen. That is the price of judging the archive
   rather than the tick, and judging the tick is what would put limits inside
   step(). Choose a grace of 0 for a latch and a real one for anything noisy. */
/* THE ONE WAY A VERDICT IS SPELT. take.verdict is the object scnJudge handed
   back - the rows are the useful part and a string would throw them away - so
   anything that wants to PRINT one asks here. The branch picker drew the object
   itself once, which reads [object Object] on any real run and was invisible
   only because the auditor's fixture had put a string there by hand. */
const scnVerdLab = v => !v ? "" : v.pass ? (v.assisted ? "PASS (ASSISTED)" : "PASS") : "FAIL";
const scnVerdCol = v => !v ? C.ink2 : v.pass ? (v.assisted ? C.amber : C.green) : C.red;

function scnJudge(take, limits){
  const segs = trSegs(take, take.tickEnd);
  const rows = (limits||[]).map(L => {
    if(!limCh(L.ch)) throw new Error("scnJudge: no such channel "+L.ch);
    const g = scnTicks(L.grace||0), up = L.cmp === ">";
    let start=null, brokeAt=null, worst=null, worstAt=null;
    for(const sg of segs){
      const t = sg[0];
      if(!t.tr[L.ch]) continue;         // a take from before this channel existed
      for(let i=sg[1]; i<sg[2]; i++){
        const tk = trTick(t,i), x = trAt(t,L.ch,i);
        if(up ? x > L.v : x < L.v) start = null;
        else {
          if(start === null) start = tk;
          if(brokeAt === null && tk - start >= g) brokeAt = tk;
        }
        /* the worst value is the one furthest on the wrong side of the line,
           which is the direction the limit is written in */
        if(worst === null || (up ? x < worst : x > worst)){ worst = x; worstAt = tk; }
      }
    }
    return {L, broke:brokeAt !== null, tick:brokeAt, worst, worstAt};
  });
  return {
    pass  : rows.every(r => !r.broke),
    rows,
    /* Carried, not computed. A take with a parent is a run somebody scrubbed
       back into, so a PASS on it is a PASS with help - and a child of such a
       take inherits it for free, because it has a parent too. */
    assisted : !!take.assisted,
  };
}

/* ═══════════════ THE UNATTENDED RUN ═══════════════
   Reset, seed, stand the dice down, and tick to the end through exactly the
   path the live game uses - so what comes out is an ORDINARY recording, on the
   ordinary forest, that scrubs and branches like one somebody flew by hand.

   ── THE ORDER OF THE FIRST FOUR LINES IS THE WHOLE TRICK ──
   recRoot() takes `base:snapS(S)`, so the seed and the dice switch have to be
   ON the plant before the root is opened. Seed after it and the take's base
   holds the random seed resetPlant() drew, and a replay from that base is a
   different run that happens to start the same way.

   ── STOPS ON A BREACH, AND NOT ON A MELT ──
   A breach is the end of the pressure boundary and the physics past it is not
   calibrated for anything; `run()` in audit-physics.js has always stopped
   there, so scnRun and the auditor's own runner agree about when a plant has
   stopped being a plant. A MELT is not a stop: release, dose and fuel damage
   all keep meaning something afterwards, and a limit about exactly those is the
   most likely reason somebody wrote a scenario that melts a core on purpose.
   Truncating the archive would make such a limit read as never broken.

   BLOCKING, on purpose. A sliced or worker-threaded version is a later phase;
   this one has to be correct first, and it is what the auditor drives. */
function scnRun(scn, onProgress){
  const was = SCNRUN;
  resetPlant();
  seedRng(S, scn.seed >>> 0);
  S.diceOff = true;
  recRoot();
  const take = recCur();
  take.label = scn.name;

  scnArm(scn);
  const end = scnTicks(scn.secs);
  /* onProgress is optional and coarse on purpose: it exists for the worker,
     which has nothing else to say while it is busy, and a callback every
     tick would cost more than the tick. */
  const every = Math.max(1, Math.round(end/50));
  while(S.tick < end){
    simTick();                          // scnDue() fires from inside it
    recTick();
    if(onProgress && S.tick % every === 0) onProgress(S.tick/end);
    if(S.breach) break;
  }
  SCNRUN = was;

  const verdict = scnJudge(take, scn.limits);
  take.verdict = verdict;
  return {take, verdict};
}

/* ═══════════════ RUNNING IT WITHOUT FREEZING THE PAGE ═══════════════
   scnRun() is the reference runner and it blocks: a 600 s scenario is 30,000
   ticks, and paying that in one go locks the tab for about a second with no
   way to say so. scnRunAsync() pays it in slices instead, out of the frame
   loop, so the progress bar moves and the window still answers.

   IT IS THE SAME LOOP. Not a second runner - the slice calls simTick() and
   recTick() exactly as scnRun() does, which is what makes the recording it
   produces an ORDINARY recording: the take it hands back can be scrubbed,
   branched and re-judged like any other, with nothing special about it.
   audit-physics asserts the two runners land on the same plant bit-for-bit,
   because the moment they can disagree, one of them is lying about the design.

   WHAT IT COSTS THE LIVE SESSION: the same thing scnRun() costs. It calls
   resetPlant() and opens a new ROOT take, so the plant you were flying is
   replaced. Your old run is not destroyed - it is a root in the forest and the
   TAKES picker will still seek into it - but the panel is looking at the
   scenario's plant from the moment RUN is pressed. That is the least
   surprising reading of a key labelled RUN, and the alternative (running a
   scenario against a second hidden plant) would put two live plants in one
   global scope, which this codebase deliberately does not have.

   BUDGET, not a tick count. 8 ms leaves a 60 Hz frame most of its time for the
   drawing, and a slow machine takes more frames rather than dropping them. */
const SCN_BUDGET = 8;
let SCNJOB = null;
const scnBusy = () => !!SCNJOB;
const scnFrac = () => SCNJOB ? Math.min(1, S.tick / Math.max(1, SCNJOB.end)) : 0;

/* ══ A RUN GOES TO ANOTHER THREAD IF IT CAN, AND SLICES IF IT CANNOT ══
   The worker is the better answer: the plant runs flat out on a core of its
   own and this thread never stutters at all, which is what an hour-long
   scenario needs. But it cannot always start - a page opened straight off
   the filesystem has a null origin, and a worker refuses to load into one -
   so the slice is not a consolation prize, it is the path a file:// session
   always takes. Both run the SAME scnRun()/simTick() code and audit-physics
   pins them to the same plant bit-for-bit.

   FAILURE IS TIMED, not just caught. A worker that throws on construction is
   easy; a worker that loads and then never answers is the one that would
   hang a run forever, so the handshake has a deadline and a miss falls
   through to the slice like any other failure. A slow run is a nuisance; a
   run that never finishes is a bug you cannot even report. */
const SCN_HANDSHAKE = 4000;
let SCNW = null;
function scnWorkerGo(scn, onProgress, onDone, onFail){
  if(typeof Worker !== "function" || typeof location === "undefined") return false;
  const base = location.href.replace(/[^/]*$/, "");
  let w;
  try{ w = new Worker("src/sim/runworker.js"); }catch(e){ return false; }
  SCNW = w;
  let done = false;
  const give = why => { if(done) return; done = true;
    try{ w.terminate(); }catch(e){} if(SCNW===w) SCNW=null; onFail(why); };
  const timer = setTimeout(()=>give("the worker did not answer"), SCN_HANDSHAKE);
  w.onerror = () => give("the worker could not load");
  w.onmessage = ev => {
    const m = ev.data || {};
    if(m.t === "ready"){ clearTimeout(timer); w.postMessage({t:"run", scn, head:recHead()}); }
    else if(m.t === "prog"){ if(onProgress) onProgress(m.f); }
    else if(m.t === "err"){ clearTimeout(timer); give(m.msg); }
    else if(m.t === "done"){
      clearTimeout(timer); done = true;
      try{ w.terminate(); }catch(e){} if(SCNW===w) SCNW=null;
      const take = scnGraft(m.take, m.endS);
      if(onProgress) onProgress(1);
      onDone({take, verdict:m.verdict});
    }
  };
  w.postMessage({t:"init", base});
  return true;
}

/* The worker built the run in its own forest, so it arrives as a stranger:
   its ids mean nothing here. It is adopted as a ROOT - it began from a
   resetPlant() and has no parent in this session - and the plant is left
   standing where the run ended, which is what the verdict is about. */
function scnGraft(take, endS){
  take.id = REC.takes.length; take.parent = null; take.kids = [];
  REC.takes.push(take); REC.roots.push(take.id); REC.cur = take.id;
  REC.keyCount += take.keys.length;
  restoreS(endS);
  REC.mode = "live";
  recTrimRoots();
  return take;
}

function scnRunAsync(scn, onProgress, onDone){
  scnCancel();                          // one run at a time; a second RUN replaces the first
  const slice = () => scnSliceGo(scn, onProgress, onDone);
  /* the thread first, the slice if it will not start OR if it falls over
     later - a worker that dies mid-run must not take the run with it */
  if(scnWorkerGo(scn, onProgress, onDone, why => {
        logE("info","SCENARIO RUN ON THIS THREAD",
          "A background thread was not available ("+why+"), so the run is being "+
          "sliced across frames instead. It is the same run and the same answer, "+
          "just slower and sharing the page with the drawing.");
        slice(); })) return scnCancel;
  return slice();
}

function scnSliceGo(scn, onProgress, onDone){
  resetPlant();
  seedRng(S, scn.seed >>> 0);
  S.diceOff = true;
  /* order is load-bearing: recRoot() takes base:snapS(S), so the seed and the
     stood-down dice must already be on S or the take's base carries the random
     seed resetPlant() drew and a replay from base is a different run */
  recRoot();
  const take = recCur();
  take.label = scn.name;
  scnArm(scn);
  SCNJOB = {scn, take, end:scnTicks(scn.secs), onProgress, onDone, was:SCNRUN};
  TR.paused = true;                     // the live driver stands off while a run drains
  return scnCancel;
}

function scnCancel(){
  if(SCNW){ try{ SCNW.terminate(); }catch(e){} SCNW=null; }
  if(!SCNJOB) return false;
  SCNJOB = null;
  scnDisarm();
  return true;
}

/* Called once a frame by simFrame(), which hands the whole frame over while a
   run is in flight - nothing else should be stepping the plant at the same
   time as this is. Returns true while there is still work to do. */
function scnDrain(){
  if(!SCNJOB) return false;
  const j = SCNJOB, t0 = performance.now();
  while(S.tick < j.end && performance.now() - t0 < SCN_BUDGET){
    simTick(); recTick();
    if(S.breach) break;                 // the same terminal stop the blocking runner uses
  }
  if(j.onProgress) j.onProgress(scnFrac());
  if(S.tick >= j.end || S.breach){
    const verdict = scnJudge(j.take, j.scn.limits);
    j.take.verdict = verdict;
    SCNJOB = null; scnDisarm();
    if(j.onDone) j.onDone({take:j.take, verdict});
    return false;
  }
  return true;
}

/* ═══════════════ PRESETS ═══════════════
   Three authored drills, built by calling the same three helpers a player's
   edits call - presets are the palette working in bulk, never a second way to
   build a scenario. Each is passable by the DEFAULT plant, measured rather than
   hoped: audit-physics.js runs them.

   The seed is shared and fixed. Every die is stood down in a scripted run, so
   it decides nothing today - it is here because the moment a scenario wants
   free-play dice for one specific thing, the run has to be reproducible. */
const SCN_SEED = 20260824;
const SCNPRE = [
  /* ── LOAD FOLLOW ──
     The plant's own job, done properly: down to 60% and back, slowly enough
     that the T-avg controller can hold the temperature with rod travel alone.
     Nothing may trip and thermal margin may not be spent to do it. */
  (()=>{ const s = scnNew("loadfollow","LOAD FOLLOW");
    s.seed = SCN_SEED; s.secs = 180;
    scnGest(s, 10, "note", "TAKE THE SET DOWN TO 60% OVER A MINUTE");
    scnGest(s, 10, "loadRamp", 60, 60);
    scnGest(s, 90, "note", "HOLD, THEN BACK UP");
    scnGest(s,110, "loadRamp",100, 60);
    scnLimit(s,"no trip",  "trip", "<", 1,    0);
    scnLimit(s,"dnbr",     "dnbr", ">", 1.30, 0.5);
    scnLimit(s,"t-avg",    "tavg", "<", 590,  0.5);
    return s; })(),

  /* ── STATION BLACKOUT ──
     Offsite power goes and the backup supply picks the coolant pumps up at half
     flow, so the plant rides it down to about 38% on its own feedback and comes
     back through an overshoot when the supply returns. That overshoot is where
     the margin actually goes, which is why the DNBR limit is the one that has
     something to say here. A trip is not forbidden: tripping is a correct
     answer to losing your pumps, and forbidding it would be teaching the
     opposite of the lesson.
     The DNBR bar was 1.30 and is 1.10. Half pump flow costs margin twice over
     now: once on the flow itself, and again on subcooling, because the core's
     temperature rise is told about flow (s.coreDT, step.js) instead of being
     pinned at its rated value - half the flow really is twice the rise, and a
     hotter hot leg really is closer to saturation. Measured on the default
     plant with nobody touching anything, DNBR bottoms at 1.123 at t=57s. A
     bar the do-nothing run cannot clear is not a lesson, it is a broken
     scenario. */
  (()=>{ const s = scnNew("blackout","STATION BLACKOUT");
    s.seed = SCN_SEED; s.secs = 150;
    scnGest(s, 20, "note", "OFFSITE POWER LOST");
    scnGest(s, 20, "blackout", true);
    scnGest(s,100, "note", "SUPPLY RESTORED - WATCH THE OVERSHOOT");
    scnGest(s,100, "blackout", false);
    scnLimit(s,"no melt",  "melt",   "<", 1,    0);
    scnLimit(s,"no breach","breach", "<", 1,    0);
    scnLimit(s,"dnbr",     "dnbr",   ">", 1.10, 0.5);
    return s; })(),

  /* ── ACTION DAMAGE ──
     A hit on the rod drives, and then a load change while the bank cannot
     answer it - which is the whole lesson: the damage costs you nothing until
     the plant is asked to do something. The repair party is sent while the
     ramp is still running, and the controller picks the temperature back up
     when the drives come back.
     The rod drives are the target because their damage is REAL and reversible.
     A hit on the instrument cabinet reads well and does nothing the sim can
     measure - s.noiseMul is written by DMGFX and read by nothing - so putting
     one in a preset would be teaching a fault that is not there. */
  (()=>{ const s = scnNew("action","ACTION DAMAGE");
    s.seed = SCN_SEED; s.secs = 180;
    scnGest(s, 20, "note", "ROD DRIVE HIT - THE BANK IS STUCK WHERE IT STANDS");
    scnGest(s, 20, "hit", "rods");
    scnGest(s, 30, "loadRamp", 70, 30);
    scnGest(s, 45, "repair", "rods");
    scnGest(s,120, "note", "DRIVES BACK - TAKE THE SET UP AGAIN");
    scnGest(s,120, "loadRamp", 100, 30);
    scnLimit(s,"no trip",  "trip", "<", 1,    0);
    scnLimit(s,"dnbr",     "dnbr", ">", 1.35, 0.5);
    scnLimit(s,"t-avg",    "tavg", "<", 590,  0.5);
    return s; })(),
];

/* The one being edited. A copy of the first preset, because a blank timeline is
   a worse place to start than a drill you can take apart. */
let SCN = scnClone(SCNPRE[0]);
