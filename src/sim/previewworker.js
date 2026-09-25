"use strict";
/* The hover preview's measurement, on a thread of its own: the bench hands over the hovered design as a
   recording head and gets back the measured core figures, so the ~0.25 s rating solve never runs on the
   paint. runworker.js is imported for its loadSim()/WORKER_SIM, the same way the sim worker boots. */
importScripts("runworker.js");

let pvInit = false;

/* what pvRows() installs on the bench side, and nothing the solve does not already carry */
function coreFields(c){
  const M = latM(c);
  return {pitch:c.pitch, hd:c.hd, nbank:c.nbank, power:c.power, poison:c.poison, rodw:c.rodw,
          enrBurn:M.enrBurn, rev:M.rev, cache:coreCacheOf(c)};
}
function preview(head){
  recApplyHead(head);                 // its own sig check is skipped: the head carries the un-measured preview value
  const cores = {}, rows = {};
  for(const id of coreIds()){ const c = D.cores[id]; cores[id] = coreFields(c); rows[id] = derived(id); }
  rows[""] = derived();
  return {cores, derived:rows};
}

self.onmessage = function(e){
  const msg = e.data || {};
  try{
    if(msg.t === "init"){ const n = loadSim(msg.base); pvInit = true; self.postMessage({t:"ready", files:n}); return; }
    if(!pvInit) throw new Error(msg.t + " before init");
    if(msg.t === "preview"){
      const r = preview(msg.head);
      self.postMessage({t:"preview", seq:msg.seq, commit:!!msg.commit, cores:r.cores, derived:r.derived});
      return;
    }
  }catch(err){
    self.postMessage({t:"err", msg:String((err && err.message) || err)});
  }
};
