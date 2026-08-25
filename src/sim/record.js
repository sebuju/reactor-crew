"use strict";
/* recording: the snapshot, the restore, and the comparison that proves them */

/* ═══════════════ ALL SIM STATE LIVES ON S ═══════════════
   A snapshot of the plant is a clone of S and nothing else. That one sentence
   is what makes every future feature recordable for free: add a field to S and
   it is snapshotted, scrubbed, branched and replayed without a second list to
   keep in step. Put sim state anywhere else and none of that happens - so the
   rule is not a convention, it is checked. audit-physics runs the plant, takes
   a snapshot, runs on, restores, runs the same span again and asserts the two
   futures are identical to the last bit, under a wall clock that ADVANCES.
   State parked in a module global is not restored, so the futures diverge and
   the auditor names the field. A wall-clock read inside the tick does the
   same. That is the whole enforcement, and it needs no list of field names.

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
   to mutate the past. That throw is half of why the all-state-on-S rule holds;
   the auditor is the other half.

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
  if(typeof pipeReset==="function") pipeReset();   // see resetPlant(): no display, nothing to clear
  return S; }

/* ══ WHERE TWO STATES FIRST DISAGREE, NOT WHETHER ══
   A boolean answer to "did the round trip hold" is a failing test with no
   lead. This returns the PATH of the first difference, so the auditor can
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
   situation is to write a second copy of the act inside the script. The rule is
   checked - `audit-geometry.js` reads plant.js and control-room.js and fails on
   a direct write to S from either.

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
   `repairStart` refuses a walled-in component, `boronDump` refuses a second
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
  flowDem  : {lab:"PUMP DEMAND",  cont:true, log:v=>(v*100).toFixed(0)+" %", apply:(s,v)=>{ s.flowDem=v; }},
  rodCommon: {lab:"ROD DEMAND",   cont:true, log:v=>(v*100).toFixed(1)+" %", apply:(s,v)=>{ setCommon(v); }},
  rodBank  : {lab:"BANK DEMAND",  cont:true, log:(b,v)=>"BANK "+(b+1)+" TO "+(v*100).toFixed(1)+" %",
              apply:(s,b,v)=>{ s.rodZDem[b]=v; }},
  bankAuto : {lab:"BANK AUT/MAN", log:b=>"BANK "+(b+1)+" NOW "+(S.bankAuto[b]?"MANUAL":"AUTO"),
              apply:(s,b)=>{ s.bankAuto[b]=!s.bankAuto[b]; }},
  split    : {lab:"ROD MODE",     log:on=>on?"SPLIT":"GANG", apply:(s,on)=>{ setSplit(on); }},
  tiltDem  : {lab:"TILT TRIM",    cont:true, log:v=>v.toFixed(2), apply:(s,v)=>{ s.tiltDem=v; }},
  boronDem : {lab:"BORON DEMAND", cont:true, log:v=>v.toFixed(0)+" pcm", apply:(s,v)=>{ s.boronDem=v; }},
  /* The one-shot dump, and it is one-shot HERE rather than in the two buttons
     that ask for it. It used to be written out twice - once on the reactor's
     control strip and once on the fault harness - with the guard, the arithmetic
     and the log entry copied, and the two copies had already drifted apart in
     their wording. A pressurised dump, so it moves the actual AND the demand:
     writing only the actual lets the boration walk drag it straight back. */
  boronDump: {lab:"EMERG BORON",  nolog:true, apply:(s)=>{
    if(s.borInjUsed) return;
    s.borInjUsed=true; s.boron-=4000; s.boronDem-=4000;
    logE("alarm","EMERGENCY BORON INJECTED",
      "4000 pcm of poison dumped into the loop. The reactor is shut down hard and cannot be restarted this run.");
  }},
  /* logCoal, not cont: a load slider drag must collapse in the LOG the way a
     rod drag does, but `cont` is a fact about the TAPE and adding it here would
     quietly change what a recorded scenario replays. */
  loadDem  : {lab:"LOAD DEMAND",  logCoal:true, log:v=>(v*100).toFixed(0)+" %", apply:(s,v)=>{ s.loadDem=v; }},
  porvBlock: {lab:"PORV BLOCK",   log:()=>S.porvBlocked?"OPENED":"SHUT", apply:(s)=>{ s.porvBlocked=!s.porvBlocked; }},
  hpi      : {lab:"HPI",          log:()=>S.hpi?"OFF":"ON", apply:(s)=>{ s.hpi=!s.hpi; }},
  scram    : {lab:"MANUAL SCRAM", apply:(s)=>{ manualScram(); }},
  resetTrip: {lab:"TRIP RESET",   apply:(s)=>{ resetTrip(); }},
  byp      : {lab:"BYPASS",       log:k=>AUTOSYS[k].name+" "+(S.byp[k]?"ARMED":"BYPASSED"),
              apply:(s,k)=>{ autoToggle(k); }},
  /* The P.junc test is the refusal, not decoration: without it a scenario line
     naming a junction this design never had would put a phantom key on S, and a
     phantom key on S is snapshotted, restored and compared like a real one. */
  junc     : {lab:"JUNCTION",     log:id=>id.toUpperCase()+" "+(S.juncOpen[id]?"SHUT":"OPEN"),
              apply:(s,id)=>{ if(P.junc[id]) s.juncOpen[id]=!s.juncOpen[id]; }},
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
  porvArm  : {lab:"PORV STICKS",  log:()=>"ARMED FOR NEXT LIFT", apply:(s)=>{ s.porvArm=true; }},
  rodJam   : {lab:"ROD JAM",      log:()=>S.rodJam?"CLEARED":"JAMMED", apply:(s)=>{ s.rodJam=!s.rodJam; }},
  porvStick: {lab:"STUCK PORV",   apply:(s)=>{ s.porvOpen=true; s.porvBlocked=false; }},
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
function actDo(k, a){ actLog(k, a); ACT[k].apply(S, ...a); }

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
                pitch:LAT.pitch, len:LAT.len,
                reflR:LAT.reflR, reflT:LAT.reflT, reflB:LAT.reflB, abs:LAT.abs},
    latSig   : latSig(),
    /* where the player sited each component, and where they dragged each
       plate. Neither is in D and both change what the plant IS - pipe run,
       thermosiphon head, exposure - so a tape without them replays into a
       different reactor. */
    parts    : LAY ? LAY.parts.map(p => ({id:p.id, x:p.x, y:p.y})) : [],
    junc     : snapVal(D.junc),
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
   Unequal means something in the design is not in the head - a part the player
   PLACED rather than moved, for instance, since placedParts is layout state
   that buildLayout() owns and the head does not carry. That must fail loudly
   and visibly, because the alternative is a verdict about a plant you did not
   design, which is the worst thing this feature could possibly do. */
function recApplyHead(h){
  Object.assign(D, snapVal(h.D));
  LAT.slot.set(h.lat.slot); LAT.rod.set(h.lat.rod);
  LAT.pitch=h.lat.pitch; LAT.len=h.lat.len;
  LAT.reflR=h.lat.reflR; LAT.reflT=h.lat.reflT; LAT.reflB=h.lat.reflB; LAT.abs=h.lat.abs;
  latRevolve();                       // rebuilds LM and the D fields the lattice measures
  for(const q of h.parts){ const p=LAY.parts.find(x=>x.id===q.id); if(p){ p.x=q.x; p.y=q.y; } }
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
   next-due tick rather than a modulo; calling it every tick works too and is
   what the auditor does.

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
    t.nextKey = S.tick + KF_TICKS*t.thin;
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
   for the tab that was in the background: dt arrives clamped at 0.25, which is
   200 ticks owed at 16x, and paying that debt in one frame blocks for long
   enough that the next frame owes just as much again. The backlog is shed
   instead - the plant loses time it was not being watched for, which is the
   right thing to lose.

   TR is NOT on S. How fast you are watching is not a property of the reactor,
   so it must not be snapshotted, scrubbed or replayed - a recording made at
   16x plays back at whatever rate you are sitting at now. */
const TR = {rate:1, paused:false, step1:0};
const TICK_CAP  = 48;
const SIMSCREEN = {operate:1, scenario:1};
let simAcc = 0;

function simTick(){
  /* the scenario fires BEFORE the step it precedes, the same ordering
     recPlay() uses: an act stamped tick T is applied by the step that
     carries the plant past T, so a live run and a replay of it agree. */
  scnDue(S.tick);
  step(0.02);
  if(S.tick % SAMP_TICKS === 0) sample();
}
function simFrame(dt){
  if(!P || !SIMSCREEN[screen]){ simAcc=0; return; }
  /* a scenario draining takes the whole frame: it is already stepping the
     plant on its own budget, and letting the live accumulator step it too
     would run the run at two speeds at once. */
  if(scnBusy()){ simAcc=0; scnDrain(); return; }
  if(TR.paused){
    /* paused still honours a single-step, and still keyframes - otherwise a
       plant nudged forward one tick at a time would never lay one down */
    simAcc=0;
    while(TR.step1>0){ TR.step1--; if(!recPlay()) break; simTick(); }
    recTick(); return;
  }
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
  if(n>=TICK_CAP) simAcc=0;
  recTick();                       // once a frame, after the ticks it covers
}
const trRate=r=>{ TR.rate=r; TR.paused=false; };
const trPause=()=>{ TR.paused=!TR.paused; };
const trStep=()=>{ TR.paused=true; TR.step1++; };

/* THE KEYSTROKES LIVE WITH THE STRIP THAT DRAWS THEM, in transport.js. They
   were here first, next to the functions they call, and that put a UI
   registration inside the tape - which is the layer a headless runner wants to
   load on its own, with no screens and no keyboard anywhere. trPause/trRate/
   trStep stay here because they are the driver; who presses them does not. */
