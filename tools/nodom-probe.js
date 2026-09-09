#!/usr/bin/env node
// node tools/nodom-probe.js - prints the sample count, or throws
const fs = require('fs'), path = require('path');
const { ROOT, scriptPaths } = require('./bundle');

const SIMONLY = p =>
  p === 'src/core/text.js' || p.startsWith('src/data/') || p.startsWith('src/sim/');

const files = scriptPaths().filter(SIMONLY);
if (!files.length) throw new Error('no sim files found in index.html');

const shim = 'let screen="operate"; function layout(){}';
const src = [shim].concat(files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))).join('\n');

const M = new Function(src +
  '; return {commission,layoutMetrics,buildStockPlumbing,scnRun,scnClone,' +
  'LAY:()=>LAY,SCNPRE:()=>SCNPRE};')();

M.layoutMetrics();

/* the REFERENCE ship, which carries a condensate pump: a feed pump drawing straight off a hotwell has only the column between them, and it cavitates */
M.buildStockPlumbing({cpump: true});
if (!M.LAY().parts.length) throw new Error('the stock plant built nothing');
M.commission();
const r = M.scnRun(M.scnClone(M.SCNPRE()[0]));
if (!r.take.trN) throw new Error('the run recorded nothing');
process.stdout.write(files.length + ' sim files, no DOM, ' + r.take.trN + ' samples recorded');
