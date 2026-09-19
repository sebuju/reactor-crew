#!/usr/bin/env node
// node --expose-gc tools/pktalloc.js [pre] [ticksPerFrame] [frames] [--warm=N] [--shm=off] [--worker=off]
// bytes per tick and per frame on both sides of the worker link, then the page's trend ring against the worker's take archive
const { headless, workerRealm, measure } = require('./bundle');

const argv = process.argv.slice(2), flag = k => { const a = argv.find(x => x.startsWith('--'+k+'=')); return a ? a.split('=')[1] : null; };
const pos = argv.filter(a => !a.startsWith('--'));
const pre = +(pos[0] || 0), tpf = +(pos[1] || 25), frames = +(pos[2] || 40), warm = +(flag('warm') || 3000);
if(flag('shm') === 'off') global.location = {search: '?shm=off', href: ''};

const PG = headless('{plantPreset,layFresh,commissionGen,recHead,simApply,simTick,chAt,CHKEYS,SHM_ON,hlen:()=>hlen,' +
  'ST:()=>ST,REC:()=>REC,trSegs,trAt,trTick}');
PG.plantPreset(pre); PG.layFresh();
{ const g = PG.commissionGen(); while(!g.next().done); }
// no worker: the page steps the plant and is its own archive
if(flag('worker') === 'off'){
  for(let k = 0; k < 600; k++) PG.simTick();
  ringCheck('page alone', PG, PG.chAt, PG.hlen());
  process.exit(0);
}
const head = structuredClone(PG.recHead());

const { W, self, posted } = workerRealm('{simFrame,TR,ST:()=>ST,REC:()=>REC,trSegs,trAt,trTick,chAt,CHKEYS,hlen:()=>hlen}');

const ask = msg => { self.onmessage({data: msg}); const m = posted.pop();
  if(!m || m.t !== 'packet') throw new Error('worker: ' + (m && m.msg || 'no packet')); return m; };
const frame = () => { W.simFrame(tpf*0.02); PG.simApply(structuredClone(ask({t: 'frame'}))); };

// the page's window, newest last, against the same samples read back out of the archive recSample() wrote
function ringCheck(name, R, at, n){
  const rec = R.REC(), take = rec.takes[rec.cur], tick = R.ST().sc[SC_TICK];
  const idx = [];
  for(const s of R.trSegs(take, tick)) for(let i = s[1]; i < s[2]; i++) idx.push([s[0], i]);
  const keys = PG.CHKEYS();
  let why = null;
  if(!n) why = 'ring empty';
  else if(n > idx.length) why = 'ring holds ' + n + ' samples, archive ' + idx.length;
  else for(const k of keys){ for(let i = 0; i < n && !why; i++){
    const [t, j] = idx[idx.length - n + i], a = R.trAt(t, k, j), b = at(k, i);
    if(!Object.is(a, b)) why = k + '[' + i + '] tick ' + R.trTick(t, j) + ': ring ' + b + ', archive ' + a; }
    if(why) break; }
  console.log(name.padEnd(16) + (why ? 'FAIL  ' + why : 'PASS  ' + n + ' samples x ' + keys.length + ' channels'));
  return !why;
}
const checks = stage => {
  ringCheck(stage + ' worker', W, W.chAt, W.hlen());
  ringCheck(stage + ' page', W, PG.chAt, PG.hlen());
};

(async () => {
  self.onmessage({data: {t: 'init', base: ''}});
  self.onmessage({data: {t: 'live', head, seed: 1, diceOff: true, rate: 1, paused: true}});
  await new Promise(r => setImmediate(r));
  const err = posted.find(m => m.t === 'err'); if(err) throw new Error('worker: ' + err.msg);
  posted.length = 0;
  W.TR.paused = false; W.TR.rate = 1;
  for(let k = 0; k < Math.ceil(warm/tpf); k++) frame();

  let bt = 0, bp = 0, bc = 0, ba = 0;
  const t0 = W.ST().sc[SC_TICK];
  for(let f = 0; f < frames; f++){
    bt += measure(() => W.simFrame(tpf*0.02))[0];
    let m, c;
    bp += measure(() => { m = ask({t: 'frame'}); })[0];
    bc += measure(() => { c = structuredClone(m); })[0];
    ba += measure(() => PG.simApply(c))[0];
  }
  const ticks = W.ST().sc[SC_TICK] - t0, per = x => (x/frames).toFixed(0).padStart(7) + ' B/frame';
  console.log('preset ' + pre + '  ' + (PG.SHM_ON ? 'shared memory' : 'clone path') + '  ' + ticks + ' ticks in ' + frames + ' frames after ' + warm + ' warm');
  console.log('worker ticks   ' + (bt/ticks).toFixed(1).padStart(7) + ' B/tick');
  console.log('worker packet  ' + per(bp));
  console.log('page clone     ' + per(bc));
  console.log('page apply     ' + per(ba));

  checks('live');
  const back = W.ST().sc[SC_TICK] - 500;
  PG.simApply(structuredClone(ask({t: 'seek', take: W.REC().cur, tick: back})));
  checks('seek');
  PG.simApply(structuredClone(ask({t: 'branch', take: W.REC().cur, tick: back})));
  for(let k = 0; k < Math.ceil(200/tpf); k++) frame();
  checks('branch');
})().catch(e => { console.error(e); process.exit(1); });
