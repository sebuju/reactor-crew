"use strict";
/* recording: the snapshot, the restore, and the comparison that proves them */

/* ═══════════════ ALL SIM STATE LIVES ON S ═══════════════
   A snapshot of the plant is a clone of S and nothing else. That one sentence
   is what makes every future feature recordable for free: add a field to S and
   it is snapshotted, scrubbed, branched and replayed without a second list to
   keep in step. Put sim state anywhere else and none of that happens. The way
   to catch a breach: run the plant, take a snapshot, run on, restore, run the
   same span again and compare, under a wall clock that ADVANCES. State parked
   in a module global is not restored, so the two futures diverge and the first
   differing PATH names the field. A wall-clock read inside the tick does the
   same. It needs no list of field names.

   Three things that are NOT on S, each for a stated reason:
     - P, the commissioned constants. Frozen for the life of a run by
       definition, and a recording carries the design as a header instead.
     - the trend rings in trends.js. Every channel is a pure function of S, so
       they are rebuilt rather than recorded - 366 KiB per keyframe otherwise.
     - the display smoothing in pipes.js. A picture of the last few frames, not
       a fact about the plant; pipeReset() clears it when the clock moves. */

/* ══ ONE GENERIC CLONER, AND IT THROWS RATHER THAN GUESSES ══
   Four cases cover everything S carries today: a scalar, a Float64Array, an
   array, and a plain object. Anything else is a design error - a Map, a class
   instance, a DOM node, a function - and this says so on the spot instead of
   copying the REFERENCE into the snapshot, which would leave the future free
   to mutate the past. That throw is why the all-state-on-S rule holds.

   Not JSON.stringify: a Float64Array degrades to {"0":...} and comes back a
   plain object, and Infinity - which s.perV genuinely holds at rest - comes
   back null. Not structuredClone either: it is slower here, and above all it
   copies the unexpected happily instead of complaining about it. Crossing a
   PROCESS boundary is a different job with a different answer; that one lives
   in store.js, deliberately wider and slower. */
function snapVal(v){
  if(v === null || typeof v !== "object") return v;
  if(v instanceof Float64Array) return new Float64Array(v);
  if(Array.isArray(v)) return v.map(snapVal);
  if(Object.getPrototypeOf(v) === Object.prototype){
    const o = {}; for(const k in v) o[k] = snapVal(v[k]); return o; }
  throw new Error("snapS: S carries a " + Object.prototype.toString.call(v) +
                  ", which cannot be snapshotted - sim state must be plain");
}
const snapS = s => snapVal(s);

/* ══ A RESTORE CLONES ON THE WAY OUT TOO ══
   Handing the snapshot itself back would let the very next tick mutate the
   keyframe, so the SECOND seek to that keyframe lands somewhere else and the
   further back you scrub the more wrong it gets. This is the bug the whole
   recording layer dies of if it is got wrong, and it costs one clone to avoid. */
function restoreS(snap){ S = snapVal(snap);
  // see resetPlant(): no display, nothing to clear
  if(typeof pipeReset==="function") pipeReset();
  if(typeof fxReset==="function") fxReset();
  return S; }

/* ══ WHERE TWO STATES FIRST DISAGREE, NOT WHETHER ══
   A boolean answer to "did the round trip hold" is a failing test with no
   lead. This returns the PATH of the first difference, so a caller can
   print `s.parts.xe: 12.4 vs 12.7` and point at the thing that leaked.
   Object.is, so a NaN matches a NaN - s.perV is Infinity at rest and a NaN
   anywhere is a fault we want reported as a value, not as a mismatch. */
function eqWhere(a, b, path){
  path = path || "s";
  if(a === null || typeof a !== "object" || b === null || typeof b !== "object")
    return Object.is(a, b) ? null : path + ": " + a + " vs " + b;
  const ta = a instanceof Float64Array, tb = b instanceof Float64Array;
  if(ta !== tb) return path + ": typed " + ta + " vs " + tb;
  if(ta || Array.isArray(a)){
    if(a.length !== b.length) return path + ".length: " + a.length + " vs " + b.length;
    for(let i = 0; i < a.length; i++){
      const w = eqWhere(a[i], b[i], path + "[" + i + "]"); if(w) return w; }
    return null;
  }
  for(const k in a){ const w = eqWhere(a[k], b[k], path + "." + k); if(w) return w; }
  for(const k in b) if(!(k in a)) return path + "." + k + ": missing vs " + b[k];
  return null;
}
const eqS = (a, b) => eqWhere(a, b) === null;

/* ═══════════════ EVERY INPUT IS AN ACT ═══════════════
   One table. Each row is a thing that can be DONE to a running plant - by the
   player at the panel, by a replay reading a tape, or by a scenario timeline -
   and `apply(s, ...args)` is the only code anywhere that performs it. Three
   things that used to need three implementations now need one row:

     add an entry to ACT and you get, in one move, a recordable player input,
     a replayable command, and a scenario timeline event.

   That is the whole reason the funnel exists. A panel button that writes S
   itself is invisible to all three: it cannot be recorded, so a tape of the run
   plays back into a different plant; it cannot be replayed, so a scrub past it
   loses it; and a scenario cannot ask for it, so the only way to script the
   situation is to write a second copy of the act inside the script. A direct
   write to S from plant.js or control-room.js is a bug.

   ── the arguments are SIM units, never panel units ──
   A slider on the panel reads 0..100 % and the plant holds 0..1, and exactly one
   of those two can be the thing that is recorded. It is the plant's: `act` is
   how a SCENARIO talks to the reactor as well as how the panel does, and a
   script that has to know a widget's display scale is a script coupled to a
   renderer. So every `/100` stays at the CALL SITE - flowDem, rodCommon,
   rodBank and loadDem are all fractions here - and tiltDem (-1..1) and boronDem
   (pcm) are already the plant's own numbers and are passed straight through.

   ── refusals live in the act, not at the call site ──
   Every guard a row needs is inside its `apply`, or inside the sim function it
   calls: `autoToggle` already refuses a system that was never fitted,
   `repairStart` refuses a walled-in component, `tankOpen` refuses a tank
   dump. The panel therefore does not have to remember any of them, and neither
   does a scenario - both get the same answer from the same line.

   ── `sched:false` ──
   Marks a row a scenario must NOT be allowed to schedule. `reset` is the only
   one today: it throws the plant away and builds a new one, which is not
   something that can happen part-way through a scripted run without the run
   ceasing to be about the plant it started with.

   ── `cont:true` ──
   Marks a row whose LAST argument is a continuous value and whose arguments
   BEFORE it name which track that value belongs to. A slider fires one act per
   drag frame, so the recorder is allowed to keep only the last of a run of them
   on the same tick - see recAct(). A toggle is never `cont`: two toggles in one
   tick are a real pair of inputs and dropping one inverts the plant.

   ── `part` ──
   Names the machine this order is FOR, off the row's own arguments. A wrecked
   one takes no orders (actDo() below); a row with no `part` is an order to the
   plant rather than to a box - a scram, a blackout, a repair party.

   ── `rec:false` ──
   Marks a row that is not part of any tape. `reset` again, and for the same
   reason it is `sched:false`: it is the boundary BETWEEN two recordings, not an
   event inside one, so it starts a fresh root take instead of being written to
   the take it ended. */
const ACT = {
  /* ── the panel ──
     `log` formats the VALUE for the event log; the row's `lab` already names
     the control. `nolog:true` marks a row that writes its own entry and must
     not be announced twice. See actLog() below. */
  /* THE COOLANT PUMP ORDER - every pump that serves the core, in one line,
     the way the board's own RCP speed demand addresses them all. Keeps its
     exact one-argument signature so a tape or a scenario written before pumps
     had individual demands still means what it meant. */
  flowDem  : {lab:"PUMP DEMAND",  cont:true, log:v=>(v*100).toFixed(0)+" %",
              apply:(s,v)=>{ for(const id of pumpIds()) if(primaryPump(id)) s.flowDemBy[id]=v; }},
  /* ONE PUMP'S OWN ORDER. Guarded like ACT.tankOpen: a tape naming a pump
     this design never had is a no-op, not a phantom key on S. */
  /* p.name, NOT partName(): that lives in src/core/ui.js, which the scenario
     worker deliberately excludes from the sim's own loaded subset, and an ACT
     row is replayed in there. Same choice, and the same reason, as the repair
     dispatch line in step.js. */
  pumpDem  : {lab:"PUMP DEMAND",  cont:true, part:id=>id,
              log:(id,v)=>{ const p=partOf(id);
                return (p?p.name:id)+" TO "+(v*100).toFixed(0)+" %"; },
              apply:(s,id,v)=>{ if(s.flowDemBy[id]!==undefined) s.flowDemBy[id]=v; }},
  rodCommon: {lab:"ROD DEMAND",   cont:true, part:()=>roleId("rods"), log:v=>(v*100).toFixed(1)+" %", apply:(s,v)=>{ setCommon(v); }},
  rodBank  : {lab:"BANK DEMAND",  cont:true, part:()=>roleId("rods"), log:(b,v)=>"BANK "+(b+1)+" TO "+(v*100).toFixed(1)+" %",
              apply:(s,b,v)=>{ s.rodZDem[b]=v; }},
  bankAuto : {lab:"BANK AUT/MAN", part:()=>roleId("rods"), log:b=>"BANK "+(b+1)+" NOW "+(S.bankAuto[b]?"MANUAL":"AUTO"),
              apply:(s,b)=>{ s.bankAuto[b]=!s.bankAuto[b]; }},
  split    : {lab:"ROD MODE",     part:()=>roleId("rods"),     log:on=>on?"SPLIT":"GANG", apply:(s,on)=>{ setSplit(on); }},
  tiltDem  : {lab:"TILT TRIM",    cont:true, part:()=>roleId("rods"), log:v=>v.toFixed(2), apply:(s,v)=>{ s.tiltDem=v; }},
  boronDem : {lab:"BORON DEMAND", cont:true, log:v=>v.toFixed(0)+" pcm", apply:(s,v)=>{ s.boronDem=v; }},
  /* logCoal, not cont: a load slider drag must collapse in the LOG the way a
     rod drag does, but `cont` is a fact about the TAPE and adding it here would
     quietly change what a recorded scenario replays. */
  loadDem  : {lab:"LOAD DEMAND",  logCoal:true, log:v=>(v*100).toFixed(0)+" %", apply:(s,v)=>{ s.loadDem=v; }},
  /* Addresses the PRESSURIZER'S relief fitting - primaryRelief() (step.js),
     the first one placed - so this keeps its exact no-argument signature
     for a tape or a scenario written before redundancy existed. A second or
     third relief path is worked through the fitting's own generic controls,
     not this one. No-op if the plant has none: a legal design choice (see
     the bench warning, design.js) cannot leave a phantom block valve on S. */
  porvBlock: {lab:"PORV BLOCK",   part:()=>primaryRelief(),   log:()=>{ const fid=primaryRelief();
                return (fid && S.reliefBlocked[fid])?"OPENED":"SHUT"; },
              apply:(s)=>{ const fid=primaryRelief(); if(fid) s.reliefBlocked[fid]=!s.reliefBlocked[fid]; }},
  /* ONE ACT FOR EVERY TANK'S VALVE, and it replaced three: HPI's on/off, the
     one-shot EMERG BORON dump and HOTWELL DUMP. There is no latch on the
     boron one any more - a tank that is empty is empty, which is the same
     refusal expressed by the physics instead of by a flag, and it can be shut
     again because a real valve can. Guarded like ACT.valveDem: a tape naming a
     tank this design never had is a no-op, not a phantom key on S. */
  tankOpen : {lab:"TANK VALVE",   part:id=>id,   log:id=>(D.tanks[id]?D.tanks[id].name:id)+" "+(S.tankOpen[id]?"SHUT":"OPEN"),
              apply:(s,id)=>{ if(s.tankOpen[id]!==undefined) s.tankOpen[id]=!s.tankOpen[id]; }},
  /* A tank's overboard dump. It is the answer to a tube rupture filling the
     hotwell with primary water, and it never refuses: open it on a healthy
     plant and you are throwing away the water the feed pumps live on. */
  /* A tank's own arm switch. Every automatic system is fitted and then armed;
     for a tank the rule is the system and the tank is where the switch lives,
     so two reserves can be armed independently and neither hangs off a
     component that is not part of it. */
  tankByp  : {lab:"TANK AUTO",    part:id=>id,    log:id=>(D.tanks[id]?D.tanks[id].name:id)+" "+(S.tankByp[id]?"ARMED":"BYPASSED"),
              apply:(s,id)=>{ if(s.tankByp[id]!==undefined) s.tankByp[id]=!s.tankByp[id]; }},
  /* ONE ISOLATION VALVE PER PORT, worked by clicking the nozzle on the mimic.
     Guarded exactly like ACT.tankOpen: a tape naming a port this design never
     had is a no-op, not a phantom key on S. */
  portShut : {lab:"PORT VALVE",   part:pid=>"port:"+pid,   log:pid=>portLabel(pid)+" "+(S.portShut[pid]?"OPENED":"SHUT"),
              apply:(s,pid)=>{ if(s.portShut[pid]!==undefined) s.portShut[pid]=!s.portShut[pid]; }},
  tankDump : {lab:"TANK DUMP",    part:id=>id,    log:id=>(D.tanks[id]?D.tanks[id].name:id)+" DUMP "+(S.tankDump[id]?"SHUT":"OPEN"),
              apply:(s,id)=>{ if(s.tankDump[id]!==undefined) s.tankDump[id]=!s.tankDump[id]; }},
  scram    : {lab:"MANUAL SCRAM", apply:(s)=>{ manualScram(); }},
  resetTrip: {lab:"TRIP RESET",   apply:(s)=>{ resetTrip(); }},
  /* The master switch. For relief it also drives every valve's own arm to
     match, so the master and the individuals can never disagree - and a tape
     recorded before per-valve arming existed still means exactly what it
     meant: one line, every valve. */
  byp      : {lab:"BYPASS",       log:k=>AUTOSYS[k].name+" "+(S.byp[k]?"ARMED":"BYPASSED"),
              apply:(s,k)=>{ if(!autoToggle(k)) return;
                if(k==="porv") for(const fid of reliefFitIds()) s.porvByp[fid]=s.byp[k]; }},
  /* One relief valve's own arm, and one relief valve's own block valve. Both
     carry the P.fittings guard ACT.valveDem carries, and for the same
     reason: a scenario line naming a fitting this design never had would
     otherwise put a phantom key on S, and a phantom key on S is snapshotted,
     restored and compared like a real one. Scoped to mode==="relief" because
     S.porvByp carries keys for relief fittings only (resetPlant(), step.js). */
  porvByp  : {lab:"PORV ARM",     part:fid=>fid,     log:fid=>fid.toUpperCase()+" "+(S.porvByp[fid]?"ARMED":"BYPASSED"),
              apply:(s,fid)=>{ if(P.fittings[fid] && P.fittings[fid].mode==="relief")
                s.porvByp[fid]=!s.porvByp[fid]; }},
  porvBlockOf:{lab:"BLOCK VALVE", part:fid=>fid, log:fid=>fid.toUpperCase()+" "+(S.reliefBlocked[fid]?"OPENED":"SHUT"),
              apply:(s,fid)=>{ if(P.fittings[fid] && P.fittings[fid].mode==="relief")
                s.reliefBlocked[fid]=!s.reliefBlocked[fid]; }},
  /* A THROTTLE'S POSITION, and it is the ONE valve act. ACT.junc is gone with
     S.juncOpen too: a two-position switch on a gated cross-tie and a slider on a
     throttle were one edge in the solve wearing two controls (see FIT,
     pipenet.js - a throttle at 1 is bit-identical to an open tee and at 0 to
     a shut one), and a tee COMPONENT has no gate to work at all. Sim units
     0..1 like every other demand; the panel's /100 stays at the call site.
     The P.fittings test is the refusal, not decoration: without it a scenario
     line naming a fitting this design never had would put a phantom key on S,
     and a phantom key on S is snapshotted, restored and compared like a real
     one. Scoped to mode==="throttle" because S.valveDem carries keys for a
     throttle only (resetPlant(), step.js). */
  valveDem : {lab:"VALVE DEMAND", cont:true, part:id=>id, log:(id,v)=>id.toUpperCase()+" TO "+(v*100).toFixed(0)+" %",
              apply:(s,id,v)=>{ if(P.fittings[id] && P.fittings[id].mode==="throttle") s.valveDem[id]=v; }},
  /* nolog: repairStart() writes REPAIR PARTY DISPATCHED itself, and it is the
     one that knows whether the order was refused for want of access. */
  repair   : {lab:"REPAIR PARTY", nolog:true, apply:(s,id)=>{ repairStart(id); }},
  /* ── things done TO the plant: combat, faults, the harness ──
     Identical rows to the panel's, deliberately. A scenario that wants to stick
     a PORV open reaches the plant by the same line the fault-injection button
     does, so there is never a "test" path and a "real" path to keep in step. */
  /* nolog: combatHit() logs the damage effect it actually rolled, which says
     far more than the order to roll one. */
  hit      : {lab:"COMBAT HIT",   nolog:true, apply:(s,id)=>{ combatHit(id); }},
  blackout : {lab:"BLACKOUT",     log:on=>(on===undefined?!S.blackout:!!on)?"ON":"RESTORED",
              apply:(s,on)=>{ s.blackout = on===undefined ? !s.blackout : !!on; }},
  /* Same primaryRelief() scope as porvBlock above - the one-shot the DICE
     table (rng.js) commands instead of rolling for. */
  porvArm  : {lab:"PORV STICKS",  log:()=>"ARMED FOR NEXT LIFT",
              apply:(s)=>{ const fid=primaryRelief(); if(fid) s.reliefArm[fid]=true; }},
  rodJam   : {lab:"ROD JAM",      log:()=>S.rodJam?"CLEARED":"JAMMED", apply:(s)=>{ s.rodJam=!s.rodJam; }},
  /* All four flags, matching DMGFX.pzr (step.js) exactly. Setting only open
     and unblocked left the valve stuck in fact - nothing reseats it - while
     reliefAnyStuck() (step.js) stayed false, so "PORV FAILED TO RESEAT" never
     lit and the board silently disagreed with the plant. */
  porvStick: {lab:"STUCK PORV",   apply:(s)=>{ const fid=primaryRelief();
                if(fid){ s.reliefOpen[fid]=true; s.reliefBlocked[fid]=false;
                         s.reliefAuto[fid]=true; s.reliefStuck[fid]=true; } }},
  /* recRoot() and not just resetPlant(): a reset is where one recording ends
     and the next begins, so the tape has to be told. It is the one act that
     does its own bookkeeping, and it is `rec:false` so the event itself lands
     on neither side of the join. */
  reset    : {lab:"RESET PLANT",  sched:false, rec:false,
              apply:(s)=>{ resetPlant(); recRoot(); }},
};
const ACTKEYS = Object.keys(ACT);

/* The one dispatch. It throws on an unknown key rather than returning false,
   because every caller is source code or a tape this build wrote: an unknown
   act is a typo or a tape from another version, and both want saying out loud
   at the moment they happen rather than a plant that quietly ignores an order.

   ── RECORDED BEFORE IT IS PERFORMED, and that order is load-bearing ──
   An act arriving during a replay forks the tape, and the fork's base is a
   snapshot of S taken right there. Apply first and the branch would start from
   a plant that has already DONE the thing, and then do it again on the way
   past - a toggle would cancel itself out and a scram would arrive twice.
   The same order is what puts a REFUSED act on the tape: the recording is the
   INPUT, not the effect, and replaying the same input into the same plant earns
   the same refusal from the same line. */
function act(k, ...a){
  if(!ACT[k]) throw new Error("act: no such act "+k);
  recAct(k, a);
  actDo(k, a);
  return true;
}

/* ══ THE LOG CARRIES THE CREW'S HALF OF THE RUN TOO ══
   The event log used to say only what the PLANT did, so a debrief could not
   tell a transient somebody caused from one they merely watched.

   It goes THROUGH actDo(), never inside act(), and that is the whole reason
   this pair exists: a replay reaches the plant by applyDue(), not by act(), and
   a seek restores LOG from a keyframe and then re-derives everything after it.
   Log only in act() and the entries between the keyframe and the playhead would
   simply be missing on the way past - the log would be different depending on
   whether you had scrubbed. Both paths call actDo(), so they cannot differ.

   The `key` is the act plus its TRACK - every argument except the value - so a
   drag on bank 1 does not swallow bank 2's entry. Same rule recAct() uses, for
   the same reason, and see logE() for why only a RUN of them collapses. */
function actLog(k, a){
  const r = ACT[k];
  if(r.nolog || r.rec === false) return;
  const det = r.log ? r.log(...a) : "";
  const coal = r.cont || r.logCoal;
  logE("act", r.lab + (det ? " / " + det : ""),
    "Ordered from the panel" + (det ? ": " + det + "." : "."),
    coal ? "act:" + k + ":" + a.slice(0, -1).join(",") : null);
}
/* ══ A WRECKED MACHINE TAKES NO ORDERS ══
   A destroyed pump still accepted a speed demand, a destroyed valve still
   stroked and a wrecked rod drive still took the bank somewhere it could not
   go - the panel greyed its keys out (ctlDead(), plant.js) while the act
   underneath went through anyway, which is a board disagreeing with its own
   plant. `part` on a row names the machine the order is FOR, off the row's own
   arguments; wrecked, the order is not carried out and not logged.
   IN actDo(), never in act(): a replay reaches the plant through actDo() too,
   so the refusal has to be on the path both take or a tape would replay orders
   the live run refused. The act is still RECORDED - the recording is the
   input, and the same input meets the same refusal on the way past. */
const actDead = (k, a) => { const f = ACT[k].part;
  if(!f) return false;
  const id = f(...a);
  return partWrecked(S,id); };
function actDo(k, a){ if(actDead(k, a)) return; actLog(k, a); ACT[k].apply(S, ...a); }

/* ═══════════════ THE TAPE ═══════════════
   A recording is a FOREST, not a list. You play, you scrub back, you try it the
   other way - and the run you scrubbed away from is still a run somebody may
   want to see again, so it stays as the parent and the second attempt hangs off
   it as a child. `REC` is the whole of that tree plus where the needle is.

   ── WHAT IS ACTUALLY RECORDED IS THE INPUT ──
   A take is a design header, a base state, and a list of acts with the tick
   each landed on. Everything else in it - the keyframes, the trend archive - is
   a CACHE of what those inputs already imply, kept so a scrub does not have to
   re-simulate ten minutes to show you second 600. Eviction may throw any of the
   cache away and the recording is still whole. It may never throw away an act.

   ── THE ROOT IS LAZY, AND THAT IS WHAT KEEPS step.js CLEAN ──
   Nothing in the sim calls the recorder. resetPlant() does not know it exists,
   commission() does not know it exists, step() does not know it exists. The
   first recTick() or recAct() after a new plant appears finds no take it can
   write to and starts one on the spot, off the live S. So the recording layer
   is a reader of the sim and never a participant in it, which is the only way
   the "all sim state lives on S" rule above can stay checkable: a recorder the
   tick had to call would be state the tick depends on. */
/* MEASURED, not chosen. A keyframe is a real clone of S and costs 11.1 KB of
   heap; 900 of them is 9.5 MB, and at one per 5 sim-seconds that is 75 minutes
   of history before the thinning ever has to start. The trend archive beside it
   is 2.1 KB per sim-second and an event is 121 bytes, so a run costs about
   4.3 KB of sim-second with nobody touching it. Re-measure before moving these:
   the count is the honest handle, because the size of S is not ours to choose. */
const REC_MAX_ROOTS = 8;      // whole runs kept; the 9th evicts the oldest lineage
const REC_MAX_KEYS  = 900;    // keyframes across the whole forest, ~9.5 MB of plant
const KF_TICKS      = 250;    // 5 sim-seconds between keyframes, before thinning
/* ══ A KEYFRAME IS PRICED IN WALL TIME, SO ITS SPACING FOLLOWS THE RATE ══
   KF_TICKS is a SIM-time gap. At 1x that is one snapshot every five seconds of
   your life; at 3500 ticks a second it is fourteen a second, each a clone of
   the whole of S that is KEPT - measured at ~600 B per tick against the 152 B
   the tick itself allocates, and unlike the tick's own garbage it survives into
   old space. That is what the frame spikes on a fast run are.
   So the gap is stretched to hold the cost per WALL second roughly flat, capped
   at 4x. What it buys back is scrub cost: up to 20 sim-seconds re-derived
   instead of 5, which is about a second of re-simulation. Keyframes are a cache
   and may always be thrown away (recEvict()), so this trades one against the
   other and touches nothing a recording has to be able to reproduce. */
const KF_PER_SEC = 2, KF_MAX_STRETCH = 4;
const kfSpan = t => KF_TICKS * t.thin *
  clamp(Math.round(TR.sps/KF_PER_SEC/KF_TICKS), 1, KF_MAX_STRETCH);

const REC = { roots:[], takes:[], cur:0, mode:"live", keyCount:0 };

/* ══ THE DESIGN HEADER, FROZEN ══
   P is not on S and never will be - it is frozen for the life of a run by
   definition - so a recording carries the design it was built from instead.
   Captured once per ROOT and shared by every branch under it, because a branch
   is a different way of OPERATING the same plant; the day you change the design
   you have commissioned, and commissioning resets, and a reset is a new root.

   Written to be JSON-round-trippable on purpose, unlike a keyframe: a header is
   the part of a tape that has to survive being saved to a file and read back by
   another build. So the lattice's Uint8Array/Int8Array plans come across as
   plain arrays, and latSig()/designSig() ride along beside them so a tape that
   no longer matches the bench can say so instead of quietly drawing the wrong
   core. Frozen all the way down, because a header that can be edited after the
   fact is not a header, it is a guess. */
function recFreeze(o){
  if(o && typeof o === "object"){ for(const k in o) recFreeze(o[k]); Object.freeze(o); }
  return o;
}
function recHead(){
  return recFreeze({
    D        : snapVal(D),
    lat      : {slot:Array.from(LAT.slot), rod:Array.from(LAT.rod),
                zone:Array.from(LAT.zone),
                pitch:LAT.pitch, len:LAT.len,
                reflR:LAT.reflR, reflT:LAT.reflT, reflB:LAT.reflB, abs:LAT.abs},
    latSig   : latSig(),
    /* where the player sited each component, and where they dragged each
       plate. Neither is in D and both change what the plant IS - pipe run,
       thermosiphon head, exposure - so a tape without them replays into a
       different reactor. */
    parts    : LAY ? LAY.parts.map(p => ({id:p.id, x:p.x, y:p.y})) : [],
    /* NO `placed` LINE. Machines live in D.machines, which the D line above
       already carries whole - the same standing tanks and fittings have, and
       the whole point of a machine being one object rather than two halves
       that can disagree. */
    dsig     : designSig(),
    seed     : S ? S.seed : 0,
  });
}

/* ══ PUTTING A HEAD BACK ON ══
   recHead() says what plant a recording is about; this is how something that
   is NOT that plant becomes it. Only one thing needs it today - the worker
   that runs a scenario on another thread starts from stock defaults and has to
   be told which reactor to build - but the shape is the same one a saved
   recording would need to be reopened, which is why it lives beside recHead()
   rather than inside the worker.

   IT RETURNS WHETHER IT WORKED, and the caller must ask. A head carries every
   term of designSig(), so rebuilding it and re-signing is a complete check:
   equal signatures mean the same reactor down to where each part stands.
   Unequal means something in the design is not in the head. That must fail
   loudly and visibly, because the alternative is a verdict about a plant you
   did not design, which is the worst thing this feature could possibly do.

   D.pipes, D.ports and D.start are NOT part of that gap - they ride the
   `D: snapVal(D)` line above exactly like D.machines, D.fittings and D.tanks
   do, because they live on D. What they do NOT do is go through
   act(): laying a pipe, placing a port and moving a bench control are design
   edits, the same as addFitting() and removePart() already are, so none of
   them is a recorded, scrubbable INPUT on the tape - a replay only ever sees
   them because the head it started from already had them, never at the tick
   the player actually made the edit. Giving D edits their own place in ACT is
   real work nobody has asked for; this states the gap rather than papering
   over it. */
function recApplyHead(h){
  Object.assign(D, snapVal(h.D));
  LAT.slot.set(h.lat.slot); LAT.rod.set(h.lat.rod);
  LAT.zone.set(h.lat.zone||new Uint8Array(LQ*LQ));
  LAT.pitch=h.lat.pitch; LAT.len=h.lat.len;
  LAT.reflR=h.lat.reflR; LAT.reflT=h.lat.reflT; LAT.reflB=h.lat.reflB; LAT.abs=h.lat.abs;
  latRevolve();                       // rebuilds LM and the D fields the lattice measures
  /* The head's own machinery came back with D above, so the board is already
     this plant's; the cell restore below only moves what is on it. */
  buildLayout();
  for(const q of h.parts){ const p=partOf(q.id); if(p){ p.x=q.x; p.y=q.y; } }
  layoutMetrics();
  return designSig() === h.dsig;
}
/* ══ ONE TAKE ══
   id/parent/kids are the tree. head is shared with the root. base+baseLog are
   the plant at tick0. keys are the cache. evs are the recording. tr/trT/trN are
   the trend archive, filled by recSample() in trends.js. */
function recNew(parent, head){
  const t = {
    id:REC.takes.length, parent, head,
    t0:S.t, tick0:S.tick,
    base:snapS(S), baseLog:LOG.slice(),
    keys:[], evs:[],
    tr:{}, trT:[], trN:0,
    tickEnd:S.tick, nextKey:S.tick + KF_TICKS,
    kids:[], label:null, verdict:null,
    /* ASSISTED means "this run was not flown straight through". Any take with a
       parent is a take somebody scrubbed back into, and a child of such a take
       inherits it for free because it has a parent too. A later phase prints
       PASS (ASSISTED) off this. */
    assisted:parent !== null,
    thin:1,                       // keyframe spacing multiplier; doubles on eviction
  };
  REC.takes.push(t);
  return t;
}
/* Takes are TOMBSTONED, never spliced out: `id` is the index, every parent and
   every kid list holds one, and a compaction would have to rewrite all of them
   to save eight bytes a take. A dead slot is null and lineage() stops at it. */
const recCur = () => REC.takes[REC.cur] || null;

function recRoot(){
  const t = recNew(null, recHead());
  REC.roots.push(t.id);
  REC.cur = t.id; REC.mode = "live";
  recTrimRoots();
  return t;
}

/* ══ THE LAZY ROOT, AND THE CLOCK THAT WENT BACKWARDS ══
   Two ways to need a fresh root, and only one of them is a reset. The other is
   a re-commission: the bench writes a new design, commission() calls
   resetPlant(), S.tick goes back to zero, and nothing told the tape. Without
   this the recorder would stitch a second plant onto the first one's track and
   every tick index in it would name two different moments. So the test is on
   the clock itself rather than on being notified - the sim stays ignorant of
   the recorder, which is the whole point. Only ever asked in live mode: a seek
   moves S.tick backwards on purpose. */
function recBoot(){
  const t = recCur();
  if(!t || S.tick < t.tick0 || S.tick < t.tickEnd) return recRoot();
  return t;
}

/* ══ RECORDING AN INPUT ══ */
const recSameTrack = (x, y) => {
  if(x.length !== y.length) return false;
  for(let i = 0; i < x.length-1; i++) if(x[i] !== y[i]) return false;   // all but the value
  return true;
};
function recAct(k, a){
  if(!S || ACT[k].rec === false) return;
  /* ── WATCHING DOES NOT FORK; TOUCHING DOES ──
     "scrub back and play again = a branch" taken literally would fork on the
     replay itself, so merely reviewing a run forward would litter the tree with
     takes identical to the one you were watching. The fork is the moment you
     put your hand on something, which is also the first moment the two futures
     can actually differ. */
  if(REC.mode !== "live") recBranch(REC.cur, S.tick);
  const t  = recBoot();
  const ev = {tick:S.tick, seq:t.evs.length, k, a:a.slice()};
  /* ── A DRAGGED SLIDER IS ONE INPUT PER TICK, NOT ONE PER FRAME ──
     Replace the last event instead of appending when it is the same act, on the
     same track, on the same tick. SAME TICK is not a tuning choice, it is the
     only coalescing that is provably free: nothing stepped between the two
     writes, so the earlier one was already overwritten before the plant could
     read it. Coalescing across ticks would delete a value the sim actually ran
     on and move the survivor in time.
     SAME TRACK is why the comparison is on every argument except the last:
     rodBank takes (bank, value), so comparing the whole list would never
     coalesce and comparing none of it would let a drag on bank 1 eat bank 2's
     event. `cont:true` in ACT marks the rows this is allowed for - a toggle
     takes no value and two of them on one tick are two real inputs. */
  const last = t.evs[t.evs.length-1];
  if(last && ACT[k].cont && last.k === k && last.tick === ev.tick && recSameTrack(last.a, a)){
    ev.seq = last.seq; t.evs[t.evs.length-1] = ev; return;
  }
  t.evs.push(ev);
}

/* ══ KEYFRAMES ══
   Called once per FRAME, not once per tick - main.js runs the sim out of an
   accumulator, so a frame is sometimes two ticks and sometimes none, and a
   keyframe on an exact multiple would simply be missed. Hence a threshold and a
   next-due tick rather than a modulo; calling it every tick works too.

   `ei` is the number of events already on the track when the key was taken, and
   it is what stops a keyframe and an act that share a tick from fighting. A
   frame handles input first and takes its keyframe after, so an act stamped
   tick T can already be IN the state a keyframe at tick T holds. Replaying from
   that key with the cursor at 0 would apply it a second time. Starting the
   cursor at `ei` cannot: the key says how far down the track it already is.

   `lg` is a shallow slice of LOG. Entries are pushed and never edited, so the
   objects can be shared; only the array needs copying. */
function recTick(){
  if(REC.mode !== "live") return;      // a replay re-derives the plant; it does not record it
  const t = recBoot();
  t.tickEnd = S.tick;
  if(S.tick >= t.nextKey){
    t.keys.push({tick:S.tick, S:snapS(S), lg:LOG.slice(), ei:t.evs.length});
    REC.keyCount++;
    t.nextKey = S.tick + kfSpan(t);
    if(REC.keyCount > REC_MAX_KEYS) recEvict();
  }
}

/* ══ EVICTION THINS, IT NEVER TRUNCATES ══
   THE INPUTS ARE THE RECORDING; THE KEYFRAMES ARE A CACHE AND MAY ALWAYS BE
   THROWN AWAY. So the way to get under the limit is to halve the keyframe
   density of the oldest take that has any to spare, and then the next oldest,
   until it fits - a scrub into thinned history costs a longer re-simulate and
   lands on exactly the same plant. Truncating instead would cost history that
   nothing can compute again, and it would cost it from the far end, which is
   the part a debrief is most likely to want.
   `base` is never a candidate: without it a take has no state to start from at
   all. Neither is `evs`, ever, for the reason above. */
function recEvict(){
  while(REC.keyCount > REC_MAX_KEYS){
    let o = null;
    for(const t of REC.takes) if(t && t.keys.length > 1 && (!o || t.id < o.id)) o = t;
    if(!o) return;                       // nothing left with a key to spare
    o.thin *= 2;
    const keep = o.keys.filter((_, i) => i % 2 === 0);
    REC.keyCount -= o.keys.length - keep.length;
    o.keys = keep;
  }
}
/* A ROOT AND ITS WHOLE SUBTREE GO TOGETHER, because half a lineage is not a
   recording: a child's base is a state its parent's history explains, and
   without the parent there is nothing to explain it. The lineage the needle is
   standing in is skipped rather than dropped - you cannot evict what somebody
   is looking at. */
function recDrop(id){
  const t = REC.takes[id]; if(!t) return;
  for(const k of t.kids) recDrop(k);
  REC.keyCount -= t.keys.length;
  REC.takes[id] = null;
}
function recTrimRoots(){
  while(REC.roots.length > REC_MAX_ROOTS){
    const i = REC.roots.findIndex(r => !lineage(REC.cur).some(t => t.id === r));
    if(i < 0) return;
    recDrop(REC.roots[i]); REC.roots.splice(i, 1);
  }
}

/* ══ SEEKING, AND BRANCHING ══ */
function lineage(takeId){
  const out = [];
  for(let t = REC.takes[takeId]; t; t = t.parent === null ? null : REC.takes[t.parent])
    out.unshift(t);
  return out;
}
/* Every act stamped `tick`, in the order they were recorded. `from` is an index
   hint: evs are tick-sorted by construction, so a forward walk hands back the
   cursor it reached and the next tick starts there instead of rescanning the
   track. Called with no hint it is the plain O(n) scan its name promises. */
function applyDue(take, tick, from){
  let i = from | 0;
  while(i < take.evs.length && take.evs[i].tick <  tick) i++;
  while(i < take.evs.length && take.evs[i].tick === tick){
    const ev = take.evs[i++]; actDo(ev.k, ev.a);
  }
  return i;
}

/* ── seek ──
   A tick can belong to an ANCESTOR: a branch made at 10 s shares every second
   before that with its parent, and holds nothing of its own to replay them
   from. So the take that OWNS the tick is the deepest one in the lineage that
   had started by then, and it is that take's base, keyframes and events the
   replay uses - which is also why REC.cur ends up on the owner rather than on
   whatever was asked for. Touching the plant there branches off the run that
   actually contains the moment.

   The events for a tick are applied BEFORE the step() that carries the plant
   past it, because that is exactly the order the live recorder produced:
   recAct() stamps ev.tick = S.tick, the tick that has already completed.

   sample() is in the loop, and it is not there for the strip chart - histFill()
   below deals with that. It is there because sample() is where the reactor
   period differentiates itself, and s.perN/perT/perV are ON S. Replay without
   it and a seek lands on a plant whose period reading came from another
   timeline. REC.mode goes to "replay" FIRST for the same reason from the other
   side: the archive must not take a second copy of samples it already holds. */
function seek(takeId, tick){
  const line = lineage(takeId);
  if(!line.length) return null;
  let own = line[0];
  for(const t of line) if(t.tick0 <= tick) own = t;
  tick = Math.max(own.tick0, Math.min(tick, own.tickEnd));

  REC.mode = "replay";
  let src = {tick:own.tick0, S:own.base, lg:own.baseLog, ei:0};
  for(const k of own.keys) if(k.tick <= tick && k.tick >= src.tick) src = k;
  restoreS(src.S); LOG = src.lg.slice();

  let i = src.ei;
  while(S.tick < tick){
    i = applyDue(own, S.tick, i);
    step(0.02);
    if(S.tick % SAMP_TICKS === 0) sample();
  }
  REC.cur = own.id;
  histFill(own, tick);
  return S;
}

/* ── branch ──
   The plant is put where the branch point is if it is not there already, and
   then a new take is opened off the state as it stands. `base` is a snapshot
   and never a reference to the parent's keyframe, so the child running on
   cannot rewrite the parent's past. */
function recBranch(takeId, tick){
  if(tick !== undefined && (REC.cur !== takeId || S.tick !== tick)) seek(takeId, tick);
  const p = REC.takes[takeId] || null;
  const t = recNew(p ? p.id : null, p ? p.head : recHead());
  if(p) p.kids.push(t.id); else { REC.roots.push(t.id); }
  REC.cur = t.id; REC.mode = "live";
  if(!p) recTrimRoots();
  return t;
}

/* ── one tick of a replay ──
   The frame loop's hook: apply this tick's recorded acts and say whether the
   plant may step on. A replay re-applies its OWN track and stops dead at the
   end of it - running past tickEnd would be simulating a future nobody
   recorded and calling it a recording. Nothing here goes through act(), which
   is what keeps watching from forking. */
function recPlay(){
  if(REC.mode === "live") return true;
  const t = recCur();
  if(!t || S.tick >= t.tickEnd) return false;
  applyDue(t, S.tick);
  return true;
}
/* ══════════ SPEED IS MORE TICKS, NEVER A BIGGER dt ══════════
   The one thing this must not do is buy speed by lengthening the step. dt is
   exactly 0.02 at every rate, SECS and SOR_SWEEPS are untouched, and that is
   why 16x lands on the same plant as 1x rather than a plausible-looking
   different one. What the multiplier scales is the ACCUMULATOR, so a frame
   simply owes more ticks.

   TICK_CAP is a FRAME BUDGET and not a rate limit. At 60 Hz, 16x asks for
   about 13 ticks a frame, so the cap never bites in normal running. It exists
   for the tab that was in the background: dt arrives clamped at 0.25 s, which
   is 200 ticks owed at 16x, and paying that in one frame blocks for long
   enough that the next frame owes just as much again. What is left over is the
   BACKLOG, bounded at TR_DEBT_MAX below.

   TR is NOT on S. How fast you are watching is not a property of the reactor,
   so it must not be snapshotted, scrubbed or replayed - a recording made at
   16x plays back at whatever rate you are sitting at now. */
/* tickMs/tps/rateMax are trBench()'s answer - null until something has
   measured this plant on this machine, which is "offer everything". */
const TR = {rate:1, paused:false, step1:0, sps:0, vldSeen:null, vldHit:null, vldRev:0,
            tickMs:null, tps:0, rateMax:Infinity};
/* VLD is MAX with a stop condition and no picture. The alarms already lit when
   it starts are the ones you signed off, so only a tile that was NOT lit then
   halts the run - and the halt is a drop to 1x, so the plant is still running
   when you look up. Not a rate: nothing owes it ticks. */
const TR_VLD = "vld";
const trAnnSet = () => { const o=Object.create(null); for(const k in S.annOn) if(S.annOn[k]) o[k]=1; return o; };
/* NOT A SWEEP. The tick keeps the lit set and counts its transitions
   (annStep(), step.js), so a run whose board is standing still costs one
   integer compare a tick here instead of 42 predicates, half of which walk the
   drawing. The diff only runs on the ticks the board actually moved. */
const trVldCheck = () => {
  if(S.annRev===TR.vldRev) return;
  TR.vldRev=S.annRev;
  for(const k in S.annOn) if(S.annOn[k] && !TR.vldSeen[k]){ TR.vldHit=k; return; }
};
/* the one predicate for "the screen is deliberately stale" - main.js skips the
   frame on it and shellSync() keeps only the clock. */
const trQuiet = () => TR.rate===TR_VLD && !TR.paused && !!P && !!SIMSCREEN[screen];
const TICK_CAP  = 48;
/* WHAT A BACKLOG MAY GROW TO, s of plant time - see the accumulator below. */
const TR_DEBT_MAX = 0.5;
/* MAX is a TIME budget, not a multiplier: there is no rate that owes it ticks,
   it simply steps until the frame's share of milliseconds is spent. The cap is
   what leaves the browser room to paint and to answer the hand. */
const TR_MAX_MS = 12;
/* VLD paints nothing, so the room MAX leaves for the paint is room it can
   spend. It is barely longer than MAX because the frame is no longer paced by
   the screen either (nextFrame(), main.js): the loop comes straight back, so a
   longer budget buys almost no share and costs the hand its answer. */
const TR_VLD_MS = 16;
const trNow = () => (typeof performance!=="undefined" ? performance.now() : Date.now());
const SIMSCREEN = {operate:1, scenario:1};
let simAcc = 0;

function simTick(){
  /* the scenario fires BEFORE the step it precedes, the same ordering
     recPlay() uses: an act stamped tick T is applied by the step that
     carries the plant past T, so a live run and a replay of it agree. */
  scnDue(S.tick);
  /* The window step() takes, widened to cover sample() too - see laySettle()
     (layout.js). The trend channels ask the drawing the same questions the
     tick does, and outside the window every one of them re-proves the cache. */
  laySettle();
  step(0.02);
  if(S.tick % SAMP_TICKS === 0) sample();
  if(TR.vldSeen && !TR.vldHit) trVldCheck();
  layRelease();
  spsN++;
}
/* Counted here and not in simFrame() so a scenario drain, which steps the plant
   on its own budget, is in the figure too. Averaged over a window: a frame's own
   tick count divided by a frame's own dt is a number that never settles. */
let spsN=0, spsT=0;
function spsFrame(dt){
  spsT += dt;
  if(spsT>=0.5){ TR.sps = spsN/spsT; spsN=0; spsT=0; }
}
/* ══════════ WHAT THIS MACHINE CAN ACTUALLY HOLD ══════════
   A rate is a PROMISE of plant seconds per second, and a big plant on a slow
   machine cannot keep it: the frame owes 50*rate ticks and pays what it can,
   so 1x silently ran at 33 TPS and 4x at 70 - faster, but nowhere near four
   times. The strip may only offer a rate the tick cost says is reachable, so
   the tick cost has to be MEASURED, on this plant, on this machine.
   Measured on a SNAPSHOT and put back: the benchmark must leave the plant on
   the tick it was commissioned on. S is the whole of sim state, so the clone
   covers everything the ticks touched except LOG, which is trimmed by hand.
   Not simTick(): the scenario, the trend sample and the TPS window are not
   this measurement's business, and step() is what the cost is made of. */
/* THE FIRST TICKS OF A RUN ARE NOT WHAT A RUN COSTS. commission() has taken
   exactly one step(), so the tick is cold: measured 5.4 ms over the first five
   and 2.7 over the next forty of the same plant. Timing the cold ones halves
   every rate the strip then offers, so they are thrown away. */
const TRB_WARM=6;
/* ── THE CHEAPEST ROUND IS THE MEASUREMENT, NOT THE AVERAGE ──
   Four measurements of one plant in one browser came back 2.95, 6.16, 2.51 and
   7.06 ms: the spread is the machine's, not the plant's - a background tab, a
   collection, another core taken away. An average carries every one of those
   into the rate the strip then refuses to offer. The FASTEST round is the one
   round nothing else was happening during, which is the cost of a tick. */
const TRB_ROUNDS=5, TRB_PER=8;
/* THE SHARE OF A SECOND THE TICKS MAY HAVE. MAX's own budget against a 60 Hz
   frame - the rest is the paint and the hand. Refresh-independent on purpose:
   priced off the frame period it would exceed 1 on a 120 Hz screen, which is
   the loop promising more milliseconds a second than a second has. */
const TRB_SHARE = TR_MAX_MS/(1000/60);
function trBench(){
  if(!P||!S){ TR.tickMs=null; TR.tps=0; TR.rateMax=Infinity; return; }
  const snap=snapS(S), lg=LOG.length;
  const tick=()=>{ laySettle(); step(0.02); layRelease(); };
  for(let i=0;i<TRB_WARM;i++) tick();
  let ms=Infinity;
  for(let r=0;r<TRB_ROUNDS;r++){
    const t0=trNow();
    for(let i=0;i<TRB_PER;i++) tick();
    const m=(trNow()-t0)/TRB_PER;
    if(m<ms) ms=m;
  }
  restoreS(snap); LOG.length=lg;
  // a clock with no resolution (a stubbed one, a hardened browser) measured nothing
  if(!(ms>0)){ TR.tickMs=null; TR.tps=0; TR.rateMax=Infinity; return; }
  TR.tickMs=ms;
  TR.tps=TRB_SHARE*1000/ms;
  TR.rateMax=TR.tps/50;
  /* Names no rate: TR_RATES is the strip's table and lives in transport.js,
     which the tape layer may not reach for (see the keystroke note below). */
  console.log("BENCH  "+ms.toFixed(2)+" ms/tick, best of "+TRB_ROUNDS+" rounds of "+TRB_PER+" -> "+
    TR.tps.toFixed(0)+" TPS sustainable, so "+TR.rateMax.toFixed(2)+"x is the fastest honest rate");
}
/* Returns whether the plant MOVED this frame. main.js paints on that, so the
   answer has to come from here rather than be re-derived from screen and
   TR.paused - those two say what the loop is meant to be doing, not what it
   actually got done. */
function simFrame(dt){
  spsFrame(dt);
  if(!P || !SIMSCREEN[screen]){ simAcc=0; return false; }
  /* once a frame, whether or not one is painted: the ticks below read the
     cached design signatures and this is the pass that proves them (layFresh(),
     layout.js). A VLD run paints nothing and would otherwise never ask. */
  layFresh();
  /* a scenario draining takes the whole frame: it is already stepping the
     plant on its own budget, and letting the live accumulator step it too
     would run the run at two speeds at once. */
  if(scnBusy()){ simAcc=0; scnDrain(); return true; }
  if(TR.paused){
    /* paused still honours a single-step, and still keyframes - otherwise a
       plant nudged forward one tick at a time would never lay one down */
    simAcc=0;
    let k=0;
    while(TR.step1>0){ TR.step1--; if(!recPlay()) break; simTick(); k++; }
    recTick(); return k>0;
  }
  if(TR.rate===Infinity||TR.rate===TR_VLD){
    /* no accumulator at all: an unbounded rate owes an unbounded number of
       ticks, so the debt is meaningless and carrying it would only shed it. */
    simAcc=0;
    const vld=TR.rate===TR_VLD;
    // armed here, so the stash is the plant one tick before the run
    if(vld && !TR.vldSeen){ TR.vldSeen=trAnnSet(); TR.vldRev=S.annRev; }
    const t0=trNow(), budget=vld?TR_VLD_MS:TR_MAX_MS; let m=0;
    while(trNow()-t0 < budget){
      if(!recPlay()){ TR.paused=true; break; }
      simTick(); m++;
      if(TR.vldHit){
        logE("warn","VALIDATION RUN HALTED / "+TR.vldHit,
          "A tile that was not lit when the validation run started has come up, so the run has dropped back to 1x with the plant still going.");
        trRate(1); break;
      }
    }
    recTick();
    return m>0;
  }
  /* ══ 4X IS FOUR SECONDS OF PLANT PER SECOND OF YOURS ══
     A rate is a promise about the WALL, so the wall is what it is paid in.
     This owed a fixed number of ticks per FRAME instead, which made the
     promise depend on how many frames a second arrived: a 120 Hz screen ran 1X
     at 2x, and a frame that overran its own period - drawing is not free -
     delivered 4X as 3.3x, with no backlog to show for it because the shortfall
     was never counted as one. Both are the same mistake, and it is fixed here
     rather than by measuring the refresh, which only ever corrected the first.
     Wall time therefore comes back in, and the two things it used to break are
     handled where they belong: a run is a tape of TICKS and acts are stamped
     in ticks, so a replay is unaffected by how fast anyone watched, and a
     backgrounded tab is a dt of 0.25 s (main.js) against a bounded backlog. */
  simAcc += dt * TR.rate;
  let n=0;
  while(simAcc>=0.02 && n<TICK_CAP){
    /* recPlay() BEFORE the step, every tick: it re-applies the take's own
       recorded acts and refuses once the tape runs out. A replay that ran on
       past its end would be simulating a future nobody recorded and filing it
       as one. */
    if(!recPlay()){ simAcc=0; TR.paused=true; break; }
    simTick();
    simAcc-=0.02; n++;
  }
  /* THE DEBT IS CARRIED, AND BOUNDED. A frame that ran long is paid off by the
     frames after it, which is what makes a rate hold across a stutter. What it
     may never do is grow without end: a machine that cannot hold the rate at
     all would otherwise owe more every frame for as long as it is left, and
     the half second here is the point where the honest answer is the TPS
     readout going amber rather than an hour of plant nobody watched. */
  if(simAcc > TR_DEBT_MAX) simAcc = TR_DEBT_MAX;
  recTick();                       // once a frame, after the ticks it covers
  return n>0;
}
const trRate=r=>{ TR.rate=r; TR.paused=false; TR.vldSeen=null; TR.vldHit=null; TR.vldRev=0; };
const trPause=()=>{ TR.paused=!TR.paused; };
/* shift is ten, on both keys and both buttons: one 0.02 s tick is the right
   grain to look at and the wrong grain to travel in. */
const TR_STEP_BIG=10;
const trStepN = e => e&&e.shiftKey ? TR_STEP_BIG : 1;
const trStep=e=>{ TR.paused=true; TR.step1+=trStepN(e); };
/* ── BACKWARDS IS A SEEK, NOT AN UN-STEP ──
   A tick cannot be undone: step() is not invertible and nothing keeps the state
   it overwrote. So one tick back is one tick of SCRUB - restore the nearest
   keyframe and re-derive forward to tick-1, exactly what the scrub bar does,
   one tick wide. It costs up to KF_TICKS of re-simulation and it is exact.
   REC.cur and not trTip: seek() walks the lineage for whoever owns the target
   tick, so stepping back over a fork point lands on the parent by itself.
   A queued forward step is dropped - it was ordered before you changed your
   mind about which way you were going, and firing it after would cancel this. */
const trStepBack=e=>{ TR.paused=true; TR.step1=0; if(S) seek(REC.cur, S.tick-trStepN(e)); };

/* THE KEYSTROKES LIVE WITH THE STRIP THAT DRAWS THEM, in transport.js. They
   were here first, next to the functions they call, and that put a UI
   registration inside the tape - which is the layer a headless runner wants to
   load on its own, with no screens and no keyboard anywhere. trPause/trRate/
   trStep/trStepBack stay here because they are the driver; who presses them
   does not. */
