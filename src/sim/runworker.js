"use strict";
/* the scenario runner and the live plant, on a thread of its own */

/* The whole display shim: commission() reaches for both on its way out. */
let screen = "operate";
function layout(){}

const WORKER_SIM = p =>
  p === "src/core/text.js" || p.startsWith("src/data/") || p.startsWith("src/sim/") || p.startsWith("src/eng/");

let ready = false;

function loadSim(base){
  /* XMLHttpRequest, not fetch: synchronous, like the importScripts() it feeds. */
  const x = new XMLHttpRequest();
  x.open("GET", base + "index.html", false);
  x.send(null);
  if(x.status && x.status >= 400) throw new Error("index.html: HTTP " + x.status);
  const list = [];
  const re = /<script src="([^"]+)"><\/script>/g;
  let m; while((m = re.exec(x.responseText))) if(WORKER_SIM(m[1])) list.push(base + m[1]);
  if(!list.length) throw new Error("no sim files found in index.html");
  importScripts.apply(null, list);
  return list.length;
}

const wNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

let pumpOn = false, pumpPrev = 0;

/* the port yields in microseconds, the trick main.js uses to run without vsync, and only a slice that owes
   a tick NOW may have it: between ticks a finite rate spun this thread at ~150 kHz, tracing every wake. */
let pumpChan = null;
/* 4, because a nested setTimeout is clamped there anyway: asking for 1 bought no steadier a tick rate */
const PUMP_IDLE_MS = 4;
/* paused is asked before the rate: a plant stopped at MAX keeps that rate and would spin on it */
const pumpWait = () => scnBusy() ? 0
  : TR.paused ? PUMP_IDLE_MS
  : (TR.rate === Infinity || TR.rate === TR_VLD) ? 0
  : clamp(Math.round((0.02 - simAcc)/TR.rate*1000), 0, PUMP_IDLE_MS);
function pumpNext(){
  const ms = pumpWait();
  if(ms > 0){ setTimeout(pump, ms); return; }
  if(!pumpChan){ pumpChan = new MessageChannel(); pumpChan.port1.onmessage = pump; }
  pumpChan.port2.postMessage(0);
}
/* no vsync and no paint share: the pump yields only so an act or a frame request can land between slices */
function pump(){
  if(!pumpOn) return;
  const t = wNow();
  let dt = (t - pumpPrev)/1000; pumpPrev = t;
  if(dt > 0.25) dt = 0.25;
  try{ simFrame(dt); }
  catch(err){ pumpOn = false;
    self.postMessage({t:"err", msg:String((err && err.message) || err)}); return; }
  pumpNext();
}

async function liveBegin(msg){
  if(!recApplyHead(msg.head)) throw new Error("design did not rebuild identically");
  commission();
  /* a snapshot IS the plant: it lands after commission() and before the root, dumpApply()'s own order */
  if(msg.snap){ restoreS(msg.snap); LOG = Array.isArray(msg.log) ? msg.log.slice() : []; logResync(); }
  else {
    ST.sc[SC_SEED] = ST.sc[SC_RNG] = msg.seed >>> 0;
    /* written, not acted: recAct() would open a root of its own before the one below, as scnSliceGo() found */
    ST.sc[SC_DICEOFF] = msg.diceOff ? 1 : 0;
  }
  recRoot();
  initHist();
  TR.rate = msg.rate === undefined ? 1 : msg.rate;
  TR.paused = !!msg.paused;
  pumpOn = true; pumpPrev = wNow();
  pump();
}

/* the state and the trend ring ride shared memory (`shm.js`); only what cannot - the log, the take tree - is
   posted, and only when it moved. A shape that moved remakes the buffer and sends one clone to rebuild on. */
let SHM = null, logSeenN = -1, logSeenE = null, recSeen = "", histSent = null, histTot = 0, shmTick = -1;
function logMoved(){
  const n = LOG.length, e = LOG[n-1] || null;
  if(n === logSeenN && e === logSeenE) return false;
  logSeenN = n; logSeenE = e; return true;
}
function recMoved(){
  const t = REC.takes[REC.cur];
  const tag = REC.cur+"/"+REC.mode+"/"+REC.takes.length+"/"+REC.roots.length+
              (t ? "/"+t.evs.length+"/"+t.tick0+"/"+t.verdict+"/"+t.assisted : "");
  if(tag === recSeen) return false;
  recSeen = tag; return true;
}
function packet(jump){
  const m = {t:"packet", jump:!!jump, tick:ST.sc[SC_TICK], sps:TR.sps, tickX:TR.tickX, tickMs:TR.tickMs};
  const tot = histTotal(), n = tot - histTot; histTot = tot;
  if(SHM_ON){ if(histBuf !== histSent){ histSent = histBuf; m.hshm = histBuf; } }
  else if(jump || histBuf !== histSent || n > HN){ histSent = histBuf; m.hfull = histBuf.slice(0); }
  else if(n > 0) m.hb = histBlock(n);
  if(logMoved()) m.log = LOG.slice();
  /* the take's own end, never the plant tick: in a replay the plant stands short of it, and the viewer would cut the recorded future */
  if(recMoved()) m.rec = recSummary(); else if(recCur()) m.tickEnd = recCur().tickEnd;
  if(SHM_ON){
    if(ST.sc[SC_TICK] !== shmTick){
      if(!(SHM && shmPush(SHM))){ SHM = shmNew(engSnapLen()); shmPush(SHM);
        m.shm = SHM.sab; m.log = LOG.slice(); m.rec = recSummary(); }
      shmTick = ST.sc[SC_TICK];
    }
    m.seq = SHM.seq;
  } else m.st = engSnap(engSnapNew());
  return m;
}

self.onmessage = function(e){
  const msg = e.data || {};
  try{
    if(msg.t === "init"){
      const n = loadSim(msg.base);
      ready = true;
      self.postMessage({t:"ready", files:n});
      return;
    }
    if(!ready) throw new Error(msg.t + " before init");
    if(msg.t === "run"){
      if(!recApplyHead(msg.head)) throw new Error("design did not rebuild identically");
      commission();
      const r = scnRun(msg.scn);
      self.postMessage({t:"done", take:r.take, verdict:r.verdict, endS:snapS()});
      return;
    }
    if(msg.t === "live"){
      liveBegin(msg).then(() => self.postMessage({t:"liveok", tick:ST.sc[SC_TICK]}),
        err => self.postMessage({t:"err", msg:String((err && err.message) || err)}));
      return; }
    /* every input still goes through act(): posting one across a thread is transport, not a second dispatch */
    if(msg.t === "act"){ act.apply(null, [msg.k].concat(msg.a || [])); return; }
    if(msg.t === "rate"){
      if(msg.rate !== undefined){ if(msg.rate !== TR.rate) tickReset(); TR.rate = msg.rate; }
      TR.paused = !!msg.paused;
      if(msg.step1) TR.step1 = (TR.step1 || 0) + msg.step1;
      return;
    }
    if(msg.t === "frame"){ self.postMessage(packet()); return; }
    if(msg.t === "seek"){ seek(msg.take, msg.tick); self.postMessage(packet(true)); return; }
    if(msg.t === "branch"){ recBranch(msg.take, msg.tick); self.postMessage(packet(true)); return; }
    if(msg.t === "bench"){ trBench(); self.postMessage({t:"bench", tickMs:TR.tickMs, rateMax:TR.rateMax}); return; }
    if(msg.t === "stop"){ pumpOn = false; return; }
  }catch(err){
    self.postMessage({t:"err", msg:String((err && err.message) || err)});
  }
};
