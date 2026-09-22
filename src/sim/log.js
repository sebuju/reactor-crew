"use strict";
/* `key` coalesces a run of entries; replace, never edit - keyframes share the objects. */
let LOG=[];
const LOG_MAX=240;
/* ST.sc[SC_EVCOUNT] as far as LOG has read the event ring */
let logSeen=0;
function logE(sev,msg,why,key){
  const sc=ST&&ST.sc;
  const e={t:sc?sc[SC_T]:0,tick:sc?sc[SC_TICK]:0,sev,msg,why,key:key||null};
  const last=LOG[LOG.length-1];
  if(key && last && last.key===key) LOG[LOG.length-1]=e;
  else LOG.push(e);
  if(LOG.length>LOG_MAX) LOG.shift();
}
/* the tick writes codes into the ring; the lines are built here, outside it, and only when something happened */
function logDrain(){
  if(!ST) return;
  const sc=ST.sc, n=sc[SC_EVCOUNT];
  if(n===logSeen) return;
  const from=Math.max(logSeen, n-EV_N), h=sc[SC_EVHEAD];
  for(let j=from;j<n;j++){
    const k=((h-(n-j))%EV_N+EV_N)%EV_N;
    if(ST.evCode[k]===EV_NONE) continue;
    /* raw: the text is built on view (logResolve), not on drain. A storm
       writes hundreds of ring rows a tick; each row here is six numbers,
       and only the rows a panel actually shows ever become strings. */
    LOG.push({t:sc[SC_T],tick:ST.evTick[k],code:ST.evCode[k],a:ST.evA[k],b:ST.evB[k],key:null});
    if(LOG.length>LOG_MAX) LOG.shift();
  }
  logSeen=n;
}
/* one ring row as text, memoized onto the entry: every reader (panels, packets
   carry the raw row and the page resolves it, saves stringify it resolved) */
function logResolve(e){
  if(e.code === undefined || e.sev !== undefined) return e;
  const r=eEventTextOf(e.code, e.a, e.b);
  e.sev=r[0]; e.msg=r[1]; e.why=r[2];
  return e;
}
/* after a restore the ring is the snapshot's, and LOG is the one saved beside it */
const logResync=()=>{ logSeen=ST?ST.sc[SC_EVCOUNT]:0; };

const LOGSEV={
  alarm:{sym:"!", tag:"[ALARM]", col:()=>C.red},
  warn :{sym:"^", tag:"[WARN ]", col:()=>C.amber},
  act  :{sym:">", tag:"[ACT  ]", col:()=>C.cyan},
  info :{sym:"-", tag:"[INFO ]", col:()=>C.ink2},
};
const logSev=e=>LOGSEV[logResolve(e).sev]||LOGSEV.info;
