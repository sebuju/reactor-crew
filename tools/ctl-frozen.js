#!/usr/bin/env node
// node tools/ctl-frozen.js [out.json] — per-preset frozen block table for the
// live ctl path (plan §7): id/sig/arg/name per block. The browser builds the
// same shape natively from S.blkBy at commission; this file exists so the
// native live-probe harness can verify derivation against gate dumps.
'use strict';
const fs = require('fs'), path = require('path');
const { headless, ROOT } = require('./bundle');

const M = headless('{PRE:()=>PLANTPRE,plantPreset,buildLayout,commission,S:()=>S,D:()=>D,P:()=>P,' +
  'coreIds:()=>coreIds(),blkName:(id)=>nameFor(id,""),rodsOf:(id)=>rodsOf(id),roleId:(r)=>roleId(r)}');
const out = { presets: [] };
const tbl = [];
const seedNum = v => (v === undefined || v === null || (typeof v === 'number' && isNaN(v))) ? 'NaN' : String(v);
for (const k of Object.keys(M.PRE())) {
  M.plantPreset(+k); M.buildLayout(); M.commission();
  const S = M.S();
  const blkBy = S.blkBy || {};
  const ids = Object.keys(blkBy);
  const rows = ids.map(id => {
    const b = blkBy[id];
    return {
      id,
      mode: b.mode || '',
      sig: b.sig || '',
      arg: (b.arg === null || b.arg === undefined) ? '' : String(b.arg),
      name: M.blkName(id),
    };
  });
  out.presets.push({ key: String(k), name: M.PRE()[k][0], blocks: rows });
  const used = {};
  for (const r of rows) if (r.mode === 'source') used[r.sig || '(none)'] = (used[r.sig || '(none)'] || 0) + 1;
  console.log('preset ' + k + ' ' + M.PRE()[k][0] + ' blocks=' + rows.length + ' sources=' + JSON.stringify(used));
  tbl.push('preset|' + k);
  for (const r of rows) tbl.push('blk|' + r.id + '|' + r.mode + '|' + r.sig + '|' + r.arg + '|' + r.name + '|' + seedNum(blkBy[r.id].out) + '|' + seedNum(blkBy[r.id].f));
  tbl.push('meta|turb=' + (M.roleId('turb') || '') + '|ctrl=' + (M.roleId('ctrl') || '') + '|steamRef=' + (M.P().steamRef || 0));
}
const dst = process.argv[2] || path.join(ROOT, 'tools', 'ctl-frozen.json');
fs.writeFileSync(dst, JSON.stringify(out, null, 1));
const tblDst = dst.replace(/\.json$/, '.tbl');
const tblLines = [];
{
  let pi = 0;
  for (const k of Object.keys(M.PRE())) {
    M.plantPreset(+k); M.buildLayout(); M.commission();
    const S = M.S();
    tblLines.push('preset|' + k);
    for (const id of M.coreIds()) tblLines.push('rods|' + id + '=' + (M.rodsOf(id) || ''));
    pi++;
  }
}
fs.writeFileSync(tblDst, tbl.join('\n') + '\n' + tblLines.join('\n') + '\n');
console.log('wrote ' + dst + ' + ' + tblDst);
