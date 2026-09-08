"use strict";
/* `key` coalesces a run of entries; replace, never edit - keyframes share the objects. */
let LOG=[];
function logE(sev,msg,why,key){
  const e={t:S?S.t:0,tick:S?S.tick:0,sev,msg,why,key:key||null};
  const last=LOG[LOG.length-1];
  if(key && last && last.key===key) LOG[LOG.length-1]=e;
  else LOG.push(e);
  if(LOG.length>240) LOG.shift();
}

const LOGSEV={
  alarm:{sym:"!", tag:"[ALARM]", col:()=>C.red},
  warn :{sym:"^", tag:"[WARN ]", col:()=>C.amber},
  act  :{sym:">", tag:"[ACT  ]", col:()=>C.cyan},
  info :{sym:"-", tag:"[INFO ]", col:()=>C.ink2},
};
const logSev=e=>LOGSEV[e.sev]||LOGSEV.info;
