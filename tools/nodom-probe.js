#!/usr/bin/env node
// node tools/nodom-probe.js - prints the sample count, or throws
const fs = require('fs'), path = require('path');
const { ROOT, scriptPaths } = require('./bundle');

const SIMONLY = p =>
  p === 'src/core/text.js' || p.startsWith('src/data/') || p.startsWith('src/sim/') || p.startsWith('src/eng/');

const files = scriptPaths().filter(SIMONLY);
if (!files.length) throw new Error('no sim files found in index.html');

const shim = 'let screen="operate"; function layout(){}';
const src = [shim].concat(files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))).join('\n');

const M = new Function(src +
  '; return {commission,layoutMetrics,plantPreset,scnRun,scnClone,' +
  'LAY:()=>LAY,SCNPRE:()=>SCNPRE};')();

M.layoutMetrics();

/* the ship the bench's preset buttons build, through the same door: an open-coded build is a second plant that drifts from the one the game flies */
M.plantPreset(0);
if (!M.LAY().parts.length) throw new Error('the stock plant built nothing');
M.commission();
// 30 s of the scenario, not its 180: the question is whether a take records, and 180 s of ticks alone is over the probe's 15 s
const scn = M.scnClone(M.SCNPRE()[0]); scn.secs = 30;
const r = M.scnRun(scn);
if (!r.take.trN) throw new Error('the run recorded nothing');
process.stdout.write(files.length + ' sim files, no DOM, ' + r.take.trN + ' samples recorded');
