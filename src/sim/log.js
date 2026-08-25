"use strict";
/* event log */

/* ═══════════════ EVENT LOG ═══════════════
   Not on S, and it does not have to be: recNew() copies it into a take's
   baseLog and recTick() into every keyframe, so a seek puts it back with the
   plant (see record.js). `tick` rides along beside `t` because the transport
   strip places each entry on the scrub bar, and the scrub bar is indexed in
   ticks - deriving it from t/0.02 would put the derivation in the renderer.

   `key` COALESCES. A dragged slider fires one act per frame, and each of those
   is a real input the log is now supposed to carry; without this a single sweep
   of the pump demand buries the last four things that actually went wrong.
   Same rule recAct() uses on the tape - the entries are the same input - except
   that only a RUN of them collapses, so an alarm landing between two nudges
   still separates them. The entry is REPLACED, never edited: keyframes share
   the objects, and editing one would rewrite the log a scrub lands on. */
let LOG=[];
function logE(sev,msg,why,key){
  const e={t:S?S.t:0,tick:S?S.tick:0,sev,msg,why,key:key||null};
  const last=LOG[LOG.length-1];
  if(key && last && last.key===key) LOG[LOG.length-1]=e;
  else LOG.push(e);
  if(LOG.length>240) LOG.shift();
}

/* One table: how an entry reads on the scrub lane, in the rail, and on canvas.
   Three views of one severity, so a new one cannot be given a colour in the
   strip and forgotten in the log. */
const LOGSEV={
  alarm:{sym:"!", tag:"[ALARM]", col:()=>C.red},
  warn :{sym:"^", tag:"[WARN ]", col:()=>C.amber},
  act  :{sym:">", tag:"[ACT  ]", col:()=>C.cyan},
  info :{sym:"-", tag:"[INFO ]", col:()=>C.ink2},
};
const logSev=e=>LOGSEV[e.sev]||LOGSEV.info;
