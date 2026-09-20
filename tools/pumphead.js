#!/usr/bin/env node
// node tools/pumphead.js
// Job 12 (docs/plan-nocode-gaps.md): the RBMK feed pump buys 21.5 MPa and throttles two
// thirds of it away (docs/fidelity.md, "...once it IS drawn as a direct cycle"). The row is
// UNCLASSIFIED because PUMP_MARGIN and pumpAhead() price every pump on every preset, and
// nobody has read the bought-vs-delivered gap on the other eight presets. This prints that
// table so the row can be classed MODEL (shared pricing over-buys everywhere) or BUILD
// (only the RBMK drawing moves).
const M = require('./bundle').headless(
 '{commission,step,D:()=>D,ST:()=>ST,PT:()=>PT,IX:()=>IX,plantPreset,buildLayout,'+
 'PLANTPRE:()=>PLANTPRE,pumpIds,pumpHead,pumpDisNode,pumpSucNode,uiNodeP,loopHeadAt,'+
 'pumpBounds,pumpAhead,PUMP_MARGIN:()=>PUMP_MARGIN,NPSH_K:()=>NPSH_K,pumpNPSH,'+
 'PUMP_H0:()=>PUMP_H0,partName}');

const ST = () => M.ST(), sc = () => M.ST().sc;
const f = (v, d) => (v === null || v === undefined || Number.isNaN(v)) ? '-' : (+v).toFixed(d === undefined ? 3 : d);
const run = secs => { for (let i = 0; i < secs * 50; i++) { M.step(0.02); if (sc()[SC_BREACH]) break; } };

// re-derives pumpHeadSuggest()'s own split (src/data/layout.js) so the two contributions
// that make up the bought figure are visible separately, not just their sum
function boughtBreakdown(id) {
  const base = (M.loopHeadAt(id) ?? M.PUMP_H0());
  const ahead = M.pumpAhead(id);
  if (ahead) {
    const aheadMPa = M.NPSH_K() * M.pumpNPSH(ahead);
    return { base, margin: 0, ahead: aheadMPa, aheadOf: ahead, bought: base + aheadMPa };
  }
  const b = M.pumpBounds(id);
  const marginMPa = (b.hi === null) ? 0 : (b.hi - b.lo) * M.PUMP_MARGIN();
  return { base, margin: marginMPa, ahead: 0, aheadOf: null, bought: base + marginMPa, shell: b.shell };
}

const PRE = M.PLANTPRE();
const only = (process.argv.find(a => /^--pre=/.test(a)) || '').split('=')[1];
const pick = only ? only.split(',').map(Number) : PRE.map((_, i) => i);
const SETTLE = +((process.argv.find(a => /^--secs=/.test(a)) || '').split('=')[1]) || 2;

console.log('preset       pump        kind    margin   ahead    bought  delivered  boughtRatio   disP    sucP');
for (const i of pick) {
  M.plantPreset(i); M.buildLayout(); M.commission();
  run(SETTLE);
  for (const id of M.pumpIds()) {
    const bd = boughtBreakdown(id);
    const bought = M.pumpHead(id); // D.pumpHead[id] ?? pumpHeadSuggest(id) - should equal bd.bought
    const dis = M.uiNodeP(M.pumpDisNode(id)), suc = M.uiNodeP(M.pumpSucNode(id));
    const delivered = (dis === undefined || suc === undefined || dis === null || suc === null) ? null : dis - suc;
    const kind = bd.aheadOf ? ('booster>' + bd.aheadOf) : (bd.shell ? 'feed' : 'loop');
    const ratio = (delivered && delivered > 1e-6) ? bought / delivered : null;
    console.log(
      PRE[i][0].padEnd(13) + id.padEnd(12) + kind.padEnd(8) +
      f(bd.margin, 3).padStart(7) + '  ' + f(bd.ahead, 3).padStart(6) + '  ' +
      f(bought, 3).padStart(8) + '  ' + f(delivered, 3).padStart(9) + '  ' + f(ratio, 2).padStart(9) + '  ' +
      f(dis, 3).padStart(7) + ' ' + f(suc, 3).padStart(7));
  }
}
