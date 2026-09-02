#!/usr/bin/env node
/* Can the plant run with no display at all?

   src/sim/runworker.js loads the sim into a Web Worker so a scenario can be
   flown on a thread of its own, and a worker has no document, no window and no
   canvas. Two facts make that possible, and both are quiet the moment they stop
   being true:

     - WHAT THE SIM IS, as a positive rule: core/text.js, data/, sim/. Read out
       of index.html here, so load order still lives in one place.
     - THE SHIM IS TWO LINES: `screen` and `layout()`, which are the only things
       commission() reaches for on its way out. No stub of anything else.

   Reach for a screen from inside the sim and the page keeps working perfectly -
   only the worker dies, in a browser, silently, and every run falls back to the
   slower sliced path forever with nobody the wiser. So this is FLOWN rather
   than inspected: build the subset, commission a plant, run a real scenario,
   and require it to have recorded something.

   It is a separate process on purpose. audit-geometry has stubbed document and
   window on its own globals long before it gets here, and a test for their
   absence has to actually be absent.

   Usage:  node tools/nodom-probe.js        (prints the sample count, or throws) */
const fs = require('fs'), path = require('path');
const { ROOT, scriptPaths } = require('./bundle');

const SIMONLY = p =>
  p === 'src/core/text.js' || p.startsWith('src/data/') || p.startsWith('src/sim/');

const files = scriptPaths().filter(SIMONLY);
if (!files.length) throw new Error('no sim files found in index.html');

const shim = 'let screen="operate"; function layout(){}';
const src = [shim].concat(files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))).join('\n');

const M = new Function(src +
  '; return {commission,latDefault,layoutMetrics,buildStockPlumbing,scnRun,scnClone,' +
  'LAY:()=>LAY,SCNPRE:()=>SCNPRE};')();

M.layoutMetrics();
M.latDefault();
/* THE SHIP HAS TO BE BUILT. D ships as a BLANK GRID - nothing is on it because
   the code put it there - so this used to fly an empty plant and report a
   healthy sample count for a reactor that was not there. */
M.buildStockPlumbing();
if (!M.LAY().parts.length) throw new Error('the stock plant built nothing');
M.commission();
const r = M.scnRun(M.scnClone(M.SCNPRE()[0]));
if (!r.take.trN) throw new Error('the run recorded nothing');
process.stdout.write(files.length + ' sim files, no DOM, ' + r.take.trN + ' samples recorded');
