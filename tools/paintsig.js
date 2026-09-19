#!/usr/bin/env node
// node tools/paintsig.js [screen] [pre] [frames] [pause|run|burst] [--dump=<file>] - the canvas call stream of N painted frames, hashed
const fs = require('fs'), crypto = require('crypto');
const { paintBoot } = require('./bundle');

const flags = process.argv.slice(2).filter(a => a.startsWith('--')), rest = process.argv.slice(2).filter(a => !a.startsWith('--'));
const scr = rest[0] || 'operate', pre = +(rest[1] || 0), N = +(rest[2] || 60), mode = rest[3] || 'pause';
const dumpTo = (flags.find(a => a.startsWith('--dump=')) || '').slice(7);

const hash = crypto.createHash('sha256'), dump = dumpTo ? fs.openSync(dumpTo, 'w') : null;
let on = false, n = 0;
const rec = line => { if (!on) return; n++; hash.update(line + '\n'); if (dump !== null) fs.writeSync(dump, line + '\n'); };

const { frame } = paintBoot(scr, pre, mode, {rec});
on = true;
for (let k = 0; k < N; k++){ rec('frame ' + k); frame(); }
if (dump !== null) fs.closeSync(dump);
console.log(scr.padEnd(9) + ' pre' + pre + ' ' + mode.padEnd(5) + ' ' + N + ' frames  ' + n + ' calls  ' + hash.digest('hex').slice(0, 16));
