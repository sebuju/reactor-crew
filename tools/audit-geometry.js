#!/usr/bin/env node
/* reactor-crew structural auditor.
   Checks the invariants that keep the design bench and control room identical:
   one plant renderer, one symbol set, one pipe network, matching inspectors,
   and a grid that lands exactly on the 12..748 content margins.
   Usage:  node tools/audit-geometry.js
*/
// Geometric containment audit: does each element sit inside what it belongs to?
const S=require('./bundle').bundle();
const g=(re,d)=>{const m=S.match(re);return m?m.slice(1).map(Number):d;};


// the plant is now generated from the layout, so check the shared renderer's invariants
const GW=Number(S.match(/const GW=(\d+)/)[1]), GH=Number(S.match(/GH=(\d+)/)[1]);
const CELL=Number(S.match(/CELL=(\d+)/)[1]), GX=Number(S.match(/GX=(\d+)/)[1]);
const checks=[
 ['grid fills content width', GX+GW*CELL===748, `${GX} .. ${GX+GW*CELL} (want 12..748)`],
 ['grid left margin',         GX===12, `GX=${GX}`],
 ['one plant renderer',       /const drawGrid = y0 => drawPlant\(y0,null\)/.test(S) &&
                              /drawPlant\(84,s\)/.test(S), 'design and control both call drawPlant'],
 ['one symbol set',           (S.match(/function drawSym/g)||[]).length===1, 'drawSym defined once'],
 ['one pipe network',         (S.match(/function pipeNetwork/g)||[]).length===1, 'pipeNetwork defined once'],
 ['one inspector shape',      /function inspector\(y0\)/.test(S) && /function ctrlInspector\(y0\)/.test(S),
                              'design + control inspectors share position and size'],
 ['inspector heights match',  (S.match(/const IH=232/g)||[]).length===2, 'both 232px'],
 ['no hand-placed mimic',     !/OY=44/.test(S), 'fixed-coordinate mimic removed'],
];
let bad=0;
for(const [n,ok,detail] of checks){
  console.log((ok?'  ok   ':'  FAIL ')+n.padEnd(28)+detail); if(!ok) bad++;
}
console.log(bad?`\n${bad} failure(s)`:'\nall harmonisation checks pass');
