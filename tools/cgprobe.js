#!/usr/bin/env node
// node tools/cgprobe.js [--secs=N] [--hit=pipe:28,15|none] [--pre=N] [--quiet]  : gas solve iterations under a break, state hash at the end
const M = require('./bundle').headless(
  '{plantPreset,buildLayout,commission,step,S:()=>S,act,GW:()=>GW,GH:()=>GH,roomCgIt:()=>roomCgIt,CG_MAX:()=>CG_MAX,ledgerKg}');
const { performance: perf } = require('perf_hooks');
const crypto = require('crypto');
const arg = k => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
M.plantPreset(+(arg('pre') || 0)); M.buildLayout(); M.commission();
const s = M.S(); s.diceOff = true;
const secs = +(arg('secs') || 6), hit = arg('hit') || 'pipe:28,15', quiet = process.argv.includes('--quiet');
if (hit !== 'none') M.act('hit', hit);
let t = 0, tot = 0, capT = 0, msT = 0;
for (let k = 0; k < secs; k++) {
  let cap = 0, sum = 0, mx = 0;
  const t0 = perf.now();
  for (let j = 0; j < 50; j++) { M.step(0.02); const it = M.roomCgIt(); sum += it; if (it > mx) mx = it; if (it >= M.CG_MAX()) cap++; }
  const ms = (perf.now() - t0) / 50; t += 1; tot += sum; capT += cap; msT += ms;
  let pmax = -1e9, pmin = 1e9; for (let i = 0; i < s.roomP.length; i++) { if (s.roomP[i] > pmax) pmax = s.roomP[i]; if (s.roomP[i] < pmin) pmin = s.roomP[i]; }
  if (!quiet) console.log('t ' + t.toFixed(0).padStart(3) + ' it mean ' + (sum / 50).toFixed(1).padStart(6) + ' max ' + String(mx).padStart(4) + ' capped ' + String(cap).padStart(2) + '/50  ms ' + ms.toFixed(2) + '  roomP ' + pmin.toFixed(1) + '..' + pmax.toFixed(1) + ' kPa  res ' + (s.massRes || 0).toFixed(3));
}
const h = crypto.createHash('md5');
for (const k of ['roomP', 'roomM', 'roomPU', 'roomPV', 'roomT', 'roomH2', 'roomO2', 'roomVap', 'roomWater', 'roomPool', 'roomPoolE']) if (s[k]) h.update(Buffer.from(s[k].buffer));
console.log('secs ' + secs + ' it/tick ' + (tot / (secs * 50)).toFixed(1) + ' capped ' + capT + '/' + secs * 50 + ' ms/tick ' + (msT / secs).toFixed(2) + ' ledger ' + M.ledgerKg(s).toFixed(4) + ' res ' + (s.massRes || 0).toFixed(4) + ' hash ' + h.digest('hex'));
